// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT — ĐỌC DANH SÁCH THÀNH VIÊN nhóm để tính MẶC ĐỊNH chức năng nhóm (docs/77 §8).
//
// Bảng bot_nhom_danh_sach giữ bản đọc getGroupInfo của từng hội thoại nhóm. Mặc định chỉ tính trên bản ĐỦ và TƯƠI
// (`dayDu` ∧ ¬`canDocLai`, `sales` thêm hạn tuổi — bot-quyen-mac-dinh.ts); còn lại "chưa xếp loại" ⇒ bot im. Làm tươi:
//
//   1. Zalo báo thành viên đổi (group_event join/leave/remove_member/block_member — zalo-listener-factory.ts)
//      ⇒ `danhDauNhomDoiThanhVien`: UPSERT cờ cần đọc lại NGAY (kể cả nhóm CHƯA có dòng — đua với lần đọc đầu) rồi đọc.
//   2. Nick kết nối (lại) (listener 'connected') ⇒ `danhDauNickKetNoiLai`: đánh dấu NGAY mọi nhóm của nick, nhưng GOM
//      lần đọc: tối đa một lượt đọc / GOM_KET_NOI_LAI_MS / nick (vòng lặp "session hết hạn ⇒ nối lại" không đốt lượt).
//   3. Vòng quét 60 s (`quetMotVong`): nhóm chưa có bản đọc + bản đang cần đọc lại đã tới giờ thử (`thu_lai_sau`).
//   4. Vòng đọc lại định kỳ ~30 phút (`quetDinhKy`): bản đã tươi, ưu tiên nhóm mặc định `sales` (hướng rủi ro), trong
//      ngân sách; hết ngân sách thì `sales` quá TUOI_TOI_DA_SALES_MS tự mất mặc định (bot im) — không phục vụ bản cũ.
//
// Lỗi: lùi thử lại 1 phút × 2^(n−1) tới 24 giờ (`lucThuLai`). "Zalo không trả nhóm" (nick đã rời / nhóm giải tán) là
// trạng thái DỪNG (`khong_tra`) — không thử lại tới khi có sự kiện thành viên / nối lại.
//
// Ngân sách (review P1-2): getGroupInfo tính vào trần `group_read` của nick (sdk-limit-service: 1000/ngày, 20/30 s) CHUNG
// với "Quét group" và ngăn thành viên. Tính năng này dùng tối đa TI_LE_NGAN_SACH (40%) trần NGÀY của mỗi nick, trong đó
// đọc định kỳ tối đa TI_LE_DINH_KY (một nửa) ⇒ luôn còn chỗ cho đọc gấp (sự kiện thành viên). Nhịp: tối đa nửa trần
// burst của nick. Đếm theo ngày UTC như zalo-rate-limiter, bộ đếm bot-quyen-ngan-sach.ts (Redis nếu có ⇒ khởi động lại
// KHÔNG đếm lại từ 0 — D7; không có Redis ⇒ RAM, trần của rate-limiter vẫn là chốt chặn cuối).
//
// Đua "đọc ↔ đánh dấu": lần đọc ghi mốc BẮT ĐẦU; cờ chỉ gỡ nếu KHÔNG có lần đánh dấu nào CÙNG LÚC hoặc sau mốc đó
// (`danh_dau_luc >= bat_dau` ⇒ giữ cờ — cùng mili-giây cũng giữ). Đọc lỗi không bao giờ gỡ cờ.
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { boSungUidNhanVien } from './bot-quyen-nhan-vien-uid.js';
import { layDanhTinhZalo, danhDauNickKetNoiLaiDanhTinh } from './bot-quyen-danh-tinh.js';
import { docNickCrm, nickCongTyTheoNick } from './bot-quyen-nick-crm.js';
import { runSystemQuery, withTenant } from '../../shared/tenant/tenant-context.js';
import { daDungHomNay, ghiDung, _datNganSachChoTest } from './bot-quyen-ngan-sach.js';
import { tinhMacDinhNhom, cauDoiMacDinhTuDong } from './bot-quyen-mac-dinh.js';

/** Đọc thông tin NHIỀU nhóm của một nick (zca-js getGroupInfo). Tiêm được — test thay bằng hàm giả. */
export type DocThongTinNhom = (zaloAccountId: string, groupIds: string[]) => Promise<unknown>;

export const LO_NHOM = 20;
export const HET_GIO_DOC_MS = 15_000;
/** Vòng quét nhóm thiếu / đến giờ thử lại. */
export const CHU_KY_QUET_MS = 60_000;
/** Vòng đọc lại định kỳ bản đã tươi. */
export const CHU_KY_DINH_KY_MS = 30 * 60_000;
export const THU_LAI_TOI_THIEU_MS = 60_000;
export const THU_LAI_TOI_DA_MS = 24 * 60 * 60_000;
/** Phần trần group_read/ngày của nick mà tính năng này được dùng. */
export const TI_LE_NGAN_SACH = 0.4;
/** Phần ngân sách trên mà đọc ĐỊNH KỲ được dùng (phần còn lại dành cho đọc gấp). */
export const TI_LE_DINH_KY = 0.5;
/** Nick nối lại liên tục ⇒ tối đa một lượt đọc mọi nhóm của nick mỗi khoảng này (vẫn đánh dấu ngay). */
export const GOM_KET_NOI_LAI_MS = 5 * 60_000;
/** Người dùng "tự động" trong nhật ký (cột ai_id không FK). */
export const AI_TU_DONG = 'tu_dong';
const TRAN_MOI_VONG = 400;
const TRAN_DINH_KY = 2000;

/** Loại group_event làm đổi thành viên. */
export const SU_KIEN_DOI_THANH_VIEN: ReadonlySet<string> = new Set(['join', 'leave', 'remove_member', 'block_member']);

export interface KetQuaPhanTich {
  uids: string[];
  dayDu: boolean;
}

/**
 * Thành viên của MỘT nhóm trong kết quả getGroupInfo: gộp memberIds + memVerList ("<uid>_<ver>") + currentMems như
 * group-scan-worker. `dayDu` = có ít nhất một uid, `hasMoreMember` = 0 và `totalMember` là SỐ và đã đủ (thiếu
 * totalMember ⇒ không chắc đủ ⇒ không đủ). Khoá đúng id — KHÔNG lấy nhóm đầu tiên. `null` = Zalo không trả nhóm này.
 */
export function phanTichNhom(info: unknown, groupId: string): KetQuaPhanTich | null {
  const map = (info as { gridInfoMap?: Record<string, unknown> } | null)?.gridInfoMap;
  const g = map && typeof map === 'object' ? (map[groupId] as Record<string, unknown> | undefined) : undefined;
  if (!g || typeof g !== 'object') return null;
  const mang = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
  const uids = [
    ...mang(g.memberIds).map(String),
    ...mang(g.memVerList).map((e) => String(e).split('_')[0]),
    ...mang(g.currentMems).map((m) => String((m as { id?: unknown } | null)?.id ?? '')),
  ].filter((u) => u.length > 0);
  const duy = [...new Set(uids)];
  const tong = typeof g.totalMember === 'number' ? g.totalMember : null;
  const conThieu = typeof g.hasMoreMember === 'number' ? g.hasMoreMember : 0;
  return { uids: duy.sort(), dayDu: duy.length > 0 && conThieu === 0 && tong !== null && duy.length >= tong };
}

/** Giờ thử lại sau lần lỗi thứ `soLanLoi` (≥ 1): 1 phút × 2^(n−1), tối đa 24 giờ. Thuần. */
export function lucThuLai(soLanLoi: number, bayGio: Date): Date {
  const n = Math.max(1, Math.trunc(soLanLoi));
  const ms = n > 20 ? THU_LAI_TOI_DA_MS : Math.min(THU_LAI_TOI_THIEU_MS * 2 ** (n - 1), THU_LAI_TOI_DA_MS);
  return new Date(bayGio.getTime() + ms);
}

/** Số lần gọi getGroupInfo/ngày/nick tính năng này được dùng, từ trần group_read ngày. Thuần. */
export function tranNganSach(tranNgayGroupRead: number): number {
  if (!(tranNgayGroupRead > 0)) return 0;
  return Math.max(1, Math.floor(tranNgayGroupRead * TI_LE_NGAN_SACH));
}

function hetGio<T>(p: Promise<T>, ms: number): Promise<T> {
  let hen: NodeJS.Timeout | undefined;
  const cho = new Promise<never>((_, rej) => {
    hen = setTimeout(() => rej(new Error(`Zalo không trả lời sau ${Math.round(ms / 1000)} giây`)), ms);
  });
  return Promise.race([p, cho]).finally(() => clearTimeout(hen));
}

const docMacDinh: DocThongTinNhom = async (accountId, groupIds) => {
  const { zaloOps } = await import('../../shared/zalo-operations.js');
  return zaloOps.getGroupInfo(accountId, groupIds);
};

async function tranGroupRead(nick: string): Promise<{ daily: number; burst: number; burstWindowMs: number }> {
  const { getEffectiveLimit } = await import('../zalo/sdk-limit-service.js');
  return getEffectiveLimit(nick, 'group_read');
}

const tranNgayThat = async (nick: string): Promise<number> => tranNganSach((await tranGroupRead(nick)).daily);

// ── Trạng thái tiến trình (một tiến trình, một vòng chạy) ───────────────────

type UuTien = 'gap' | 'dinh_ky';
const choDoc = new Map<string, UuTien>();
let dangChay: Promise<void> | null = null;
let docThongTin: DocThongTinNhom = docMacDinh;
let dongHo: () => Date = () => new Date();
let nghiCoDinh: number | null = null;
let layTranNgay: (nick: string) => Promise<number> = tranNgayThat;
/** Loại ngân sách ngày (bot-quyen-ngan-sach.ts) của việc đọc danh sách nhóm. */
const NS_DOC_NHOM = 'ds_group_read';
const daCanhBao = new Map<string, string>();
/** nick → mốc (ms) lượt đọc gần nhất (hoặc đã hẹn) do nối lại. */
const docKetNoiLuc = new Map<string, number>();

/** Chỉ cho test: thay bộ đọc Zalo + bỏ nghỉ giữa lô. */
export function _datBoDocChoTest(doc: DocThongTinNhom | null): void {
  docThongTin = doc ?? docMacDinh;
  nghiCoDinh = doc ? 0 : null;
}

/** Chỉ cho test: đồng hồ (mốc bắt đầu đọc / đánh dấu) và ngân sách ngày (null = như thật). Luôn xoá bộ đếm. */
export function _datMoiTruongChoTest(o: { dongHo?: (() => Date) | null; tranNgay?: ((nick: string) => Promise<number>) | null } = {}): void {
  if (o.dongHo !== undefined) dongHo = o.dongHo ?? (() => new Date());
  if (o.tranNgay !== undefined) layTranNgay = o.tranNgay ?? tranNgayThat;
  _datNganSachChoTest({ loai: [NS_DOC_NHOM] });
  daCanhBao.clear();
  docKetNoiLuc.clear();
}

function ngayUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dauNgayMaiUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(24, 0, 0, 0);
  return x;
}

/** Số lần gọi getGroupInfo hôm nay (UTC) của nick do tính năng này. */
export async function soLanDaDocHomNay(nick: string): Promise<number> {
  return daDungHomNay(nick, NS_DOC_NHOM, dongHo());
}

async function dung(nick: string): Promise<void> {
  await ghiDung(nick, NS_DOC_NHOM, dongHo());
}

/** Xếp hàng đọc lại danh sách. `gap` (sự kiện, nhóm mới, chủ bấm) đi trước `dinh_ky`. Trả promise xong vòng hiện tại. */
export function xepHangDocLai(conversationIds: Iterable<string>, uuTien: UuTien = 'gap'): Promise<void> {
  for (const id of conversationIds) {
    if (!id) continue;
    if (uuTien === 'gap' || !choDoc.has(id)) choDoc.set(id, uuTien);
  }
  if (!dangChay) {
    dangChay = chay().finally(() => { dangChay = null; });
  }
  return dangChay;
}

/** Chờ hàng đợi rỗng (test). */
export async function choHangDoiXong(): Promise<void> {
  while (dangChay) await dangChay;
}

type ConvDoc = { id: string; orgId: string; zaloAccountId: string; externalThreadId: string | null };
type Lo = { nick: string; orgId: string; ds: ConvDoc[]; uuTien: UuTien };

function catLo<T>(ds: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ds.length; i += n) out.push(ds.slice(i, i + n));
  return out;
}

/** Nghỉ giữa hai vòng lô: đủ để mỗi nick dùng tối đa NỬA trần burst group_read (nửa kia cho "Quét group"…). */
async function nghiGiua(nicks: string[]): Promise<void> {
  let ms = nghiCoDinh ?? 0;
  if (nghiCoDinh === null) {
    for (const nick of nicks) {
      const t = await tranGroupRead(nick).catch(() => ({ burst: 20, burstWindowMs: 30_000, daily: 1000 }));
      ms = Math.max(ms, Math.ceil(t.burstWindowMs / Math.max(1, Math.floor(t.burst / 2))));
    }
  }
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

async function chay(): Promise<void> {
  while (choDoc.size > 0) {
    const tatCa = [...choDoc.entries()];
    const chon = [...tatCa.filter(([, u]) => u === 'gap'), ...tatCa.filter(([, u]) => u === 'dinh_ky')].slice(0, TRAN_MOI_VONG);
    for (const [id] of chon) choDoc.delete(id);
    const uuTien = new Map(chon);
    let convs: ConvDoc[] = [];
    try {
      // Hội thoại đã xoá / nick đã lưu trữ: không đọc (P1-2, P2-4).
      convs = await runSystemQuery(() => prisma.conversation.findMany({
        where: { id: { in: [...uuTien.keys()] }, threadType: 'group', deletedAt: null, zaloAccount: { archivedAt: null } },
        select: { id: true, orgId: true, zaloAccountId: true, externalThreadId: true },
      }));
    } catch (err) {
      logger.warn('[bot-quyen-danh-sach] không đọc được hội thoại cần đọc lại:', err);
      continue;
    }
    const thuTu = new Map([...uuTien.keys()].map((id, i) => [id, i]));
    convs.sort((a, b) => (thuTu.get(a.id) ?? 0) - (thuTu.get(b.id) ?? 0));
    const nhom = new Map<string, { orgId: string; gap: ConvDoc[]; dinhKy: ConvDoc[] }>();
    for (const c of convs) {
      if (!c.externalThreadId) continue;
      const n = nhom.get(c.zaloAccountId) ?? { orgId: c.orgId, gap: [], dinhKy: [] };
      (uuTien.get(c.id) === 'gap' ? n.gap : n.dinhKy).push(c);
      nhom.set(c.zaloAccountId, n);
    }
    const theoNick = new Map<string, Lo[]>();
    for (const [nick, n] of nhom) {
      theoNick.set(nick, [
        ...catLo(n.gap, LO_NHOM).map((ds) => ({ nick, orgId: n.orgId, ds, uuTien: 'gap' as const })),
        ...catLo(n.dinhKy, LO_NHOM).map((ds) => ({ nick, orgId: n.orgId, ds, uuTien: 'dinh_ky' as const })),
      ]);
    }
    // Xoay vòng giữa các nick: mỗi vòng một lô / nick rồi nghỉ theo nhịp burst.
    const conLo = () => [...theoNick.values()].some((ds) => ds.length > 0);
    while (conLo()) {
      const daGoi: string[] = [];
      for (const [nick, ds] of theoNick) {
        const lo = ds.shift();
        if (lo && await xuLyLo(lo)) daGoi.push(nick);
      }
      if (daGoi.length > 0 && conLo()) await nghiGiua(daGoi);
    }
  }
}

/** Một lô: kiểm ngân sách, đọc, ghi, rồi ghi nhận mặc định đổi. Trả true nếu đã gọi Zalo. */
async function xuLyLo(lo: Lo): Promise<boolean> {
  let tran: number;
  try {
    tran = await layTranNgay(lo.nick);
  } catch {
    tran = tranNganSach(1000);
  }
  const da = await soLanDaDocHomNay(lo.nick);
  const choPhep = lo.uuTien === 'gap' ? da < tran : da < Math.floor(tran * TI_LE_DINH_KY);
  if (!choPhep) {
    if (lo.uuTien === 'gap') {
      const loi = `Nick đã dùng hết ${tran} lượt đọc danh sách nhóm hôm nay (${Math.round(TI_LE_NGAN_SACH * 100)}% trần `
        + 'group_read) — đọc lại từ 07:00 sáng mai';
      for (const c of lo.ds) {
        await ghiHetNganSach(c, dongHo(), loi)
          .catch((err) => logger.warn(`[bot-quyen-danh-sach] ghi hết lượt nhóm ${c.id} lỗi:`, err));
      }
    }
    const khoa = `${ngayUtc(dongHo())}:${lo.uuTien}`;
    if (daCanhBao.get(lo.nick) !== khoa) {
      daCanhBao.set(lo.nick, khoa);
      logger.warn(`[bot-quyen-danh-sach] nick ${lo.nick} hết ngân sách đọc ${lo.uuTien} hôm nay (${da}/${tran}) — bỏ ${lo.ds.length} nhóm`);
    }
    return false;
  }
  await dung(lo.nick);
  await docMotLo(lo.nick, lo.ds);
  await ghiNhanDoiMacDinh(lo.orgId, lo.ds.map((c) => c.id))
    .catch((err) => logger.warn('[bot-quyen-danh-sach] ghi nhận mặc định đổi lỗi:', err));
  return true;
}

type KieuLoi = 'loi' | 'khong_tra';

async function ghi(c: ConvDoc, batDau: Date, kq: KetQuaPhanTich | null, loi: string | null, kieu: KieuLoi): Promise<void> {
  const bayGio = dongHo();
  await withTenant(c.orgId, async () => {
    if (kq) {
      // Gỡ cờ CHỈ khi không có lần đánh dấu nào CÙNG LÚC / sau lúc bắt đầu đọc (P2-3: >=). Bị đánh dấu trong lúc đọc
      // ⇒ giữ nguyên cả `thu_lai_sau` (lượt đọc đã gom của lần nối lại).
      await prisma.$executeRaw`
        INSERT INTO bot_nhom_danh_sach (id, org_id, conversation_id, zalo_account_id, uids, day_du, doc_luc, can_doc_lai,
                                        danh_dau_luc, thu_luc, loi, so_lan_loi, thu_lai_sau, khong_tra)
        VALUES (gen_random_uuid()::text, ${c.orgId}, ${c.id}, ${c.zaloAccountId}, ${kq.uids}::text[], ${kq.dayDu}, ${bayGio},
                false, ${batDau}, ${bayGio}, NULL, 0, NULL, false)
        ON CONFLICT (conversation_id) DO UPDATE SET
          zalo_account_id = EXCLUDED.zalo_account_id, uids = EXCLUDED.uids, day_du = EXCLUDED.day_du,
          doc_luc = EXCLUDED.doc_luc, thu_luc = EXCLUDED.thu_luc, loi = NULL, so_lan_loi = 0, khong_tra = false,
          can_doc_lai = bot_nhom_danh_sach.danh_dau_luc >= ${batDau},
          thu_lai_sau = CASE WHEN bot_nhom_danh_sach.danh_dau_luc >= ${batDau} THEN bot_nhom_danh_sach.thu_lai_sau END`;
    } else if (kieu === 'khong_tra') {
      // Zalo không trả nhóm ⇒ DỪNG (không thử lại theo lịch) + không mặc định. Nhưng bị đánh dấu CÙNG LÚC / sau lúc bắt
      // đầu (vd nick vừa được thêm lại — `join`) ⇒ câu trả lời này đã cũ ⇒ không dừng.
      await prisma.$executeRaw`
        INSERT INTO bot_nhom_danh_sach (id, org_id, conversation_id, zalo_account_id, can_doc_lai, danh_dau_luc, thu_luc, loi,
                                        so_lan_loi, thu_lai_sau, khong_tra)
        VALUES (gen_random_uuid()::text, ${c.orgId}, ${c.id}, ${c.zaloAccountId}, true, ${batDau}, ${bayGio}, ${loi}, 1, NULL, true)
        ON CONFLICT (conversation_id) DO UPDATE SET thu_luc = EXCLUDED.thu_luc, loi = EXCLUDED.loi, can_doc_lai = true,
          so_lan_loi = bot_nhom_danh_sach.so_lan_loi + 1,
          khong_tra = bot_nhom_danh_sach.danh_dau_luc < ${batDau}`;
    } else {
      // Lỗi: giữ bản cũ, KHÔNG BAO GIỜ gỡ cờ (dòng đang đánh dấu vẫn đánh dấu ⇒ không mặc định; dòng mới ⇒ cần đọc lại).
      // Lùi: thử lại sau 1 phút × 2^(n−1), tối đa 24 giờ; giữ mốc hẹn muộn hơn đã có.
      const dau = lucThuLai(1, bayGio);
      await prisma.$executeRaw`
        INSERT INTO bot_nhom_danh_sach (id, org_id, conversation_id, zalo_account_id, can_doc_lai, danh_dau_luc, thu_luc, loi,
                                        so_lan_loi, thu_lai_sau)
        VALUES (gen_random_uuid()::text, ${c.orgId}, ${c.id}, ${c.zaloAccountId}, true, ${batDau}, ${bayGio}, ${loi}, 1, ${dau})
        ON CONFLICT (conversation_id) DO UPDATE SET thu_luc = EXCLUDED.thu_luc, loi = EXCLUDED.loi,
          so_lan_loi = bot_nhom_danh_sach.so_lan_loi + 1,
          thu_lai_sau = GREATEST(
            COALESCE(bot_nhom_danh_sach.thu_lai_sau, EXCLUDED.thu_luc),
            EXCLUDED.thu_luc + LEAST(interval '1 minute' * power(2, LEAST(bot_nhom_danh_sach.so_lan_loi, 20)),
                                     interval '24 hours'))`;
    }
  });
}

/** Hết ngân sách đọc gấp: ghi lý do, hẹn sang ngày mai (UTC), không tính là lỗi (không lùi), không gỡ cờ. */
async function ghiHetNganSach(c: ConvDoc, bayGio: Date, loi: string): Promise<void> {
  const mai = dauNgayMaiUtc(bayGio);
  await withTenant(c.orgId, () => prisma.$executeRaw`
    INSERT INTO bot_nhom_danh_sach (id, org_id, conversation_id, zalo_account_id, can_doc_lai, danh_dau_luc, loi, thu_lai_sau)
    VALUES (gen_random_uuid()::text, ${c.orgId}, ${c.id}, ${c.zaloAccountId}, true, ${bayGio}, ${loi}, ${mai})
    ON CONFLICT (conversation_id) DO UPDATE SET loi = EXCLUDED.loi,
      thu_lai_sau = GREATEST(COALESCE(bot_nhom_danh_sach.thu_lai_sau, EXCLUDED.thu_lai_sau), EXCLUDED.thu_lai_sau)`);
}

async function docMotLo(nick: string, ds: ConvDoc[]): Promise<void> {
  const batDau = dongHo();
  let info: unknown = null;
  let loiChung: string | null = null;
  try {
    info = await hetGio(docThongTin(nick, ds.map((c) => c.externalThreadId!)), HET_GIO_DOC_MS);
  } catch (err) {
    loiChung = (err instanceof Error ? err.message : String(err)).slice(0, 300);
  }
  for (const c of ds) {
    const kq = loiChung ? null : phanTichNhom(info, c.externalThreadId!);
    const loi = loiChung
      ?? (kq ? null : 'Zalo không trả thông tin nhóm này (nick đã rời nhóm / nhóm đã giải tán?) — chờ sự kiện thành viên hoặc lần nối lại');
    try {
      await ghi(c, batDau, kq, loi, loiChung ? 'loi' : 'khong_tra');
    } catch (err) {
      logger.warn(`[bot-quyen-danh-sach] ghi bản đọc nhóm ${c.id} lỗi:`, err);
    }
  }
  if (loiChung) logger.warn(`[bot-quyen-danh-sach] đọc ${ds.length} nhóm của nick ${nick} lỗi: ${loiChung}`);
}

// ── Đánh dấu ────────────────────────────────────────────────────────────────

/**
 * UPSERT cờ "cần đọc lại" (review P1-1): nhóm CHƯA có dòng cũng được tạo dòng đánh dấu — nên sự kiện thành viên đua với
 * lần đọc ĐẦU TIÊN không bị mất (lần đọc đó thấy `danh_dau_luc >= bat_dau` ⇒ giữ cờ). Gỡ trạng thái dừng + bộ lùi (sự
 * kiện là tín hiệu mạnh). `thuLaiSau` = mốc đọc đã gom (nối lại) hoặc null (đọc ngay).
 */
async function upsertDanhDau(orgId: string, ids: string[], bayGio: Date, thuLaiSau: Date | null): Promise<void> {
  if (ids.length === 0) return;
  await withTenant(orgId, () => prisma.$executeRaw`
    INSERT INTO bot_nhom_danh_sach (id, org_id, conversation_id, zalo_account_id, can_doc_lai, danh_dau_luc, thu_lai_sau)
    SELECT gen_random_uuid()::text, c.org_id, c.id, c.zalo_account_id, true, ${bayGio}::timestamp(3), ${thuLaiSau}::timestamp(3)
    FROM conversations c
    WHERE c.org_id = ${orgId} AND c.id = ANY(${ids}::text[])
    ON CONFLICT (conversation_id) DO UPDATE SET
      can_doc_lai = true,
      danh_dau_luc = GREATEST(bot_nhom_danh_sach.danh_dau_luc, EXCLUDED.danh_dau_luc),
      zalo_account_id = EXCLUDED.zalo_account_id,
      khong_tra = false, so_lan_loi = 0,
      thu_lai_sau = EXCLUDED.thu_lai_sau`);
}

/** Zalo báo thành viên nhóm đổi ⇒ mặc định của nhóm tắt NGAY (bot im) tới khi đọc lại xong. */
export async function danhDauNhomDoiThanhVien(orgId: string, zaloAccountId: string, groupId: string): Promise<void> {
  const conv = await withTenant(orgId, () => prisma.conversation.findFirst({
    where: {
      orgId, zaloAccountId, externalThreadId: groupId, threadType: 'group', deletedAt: null,
      zaloAccount: { archivedAt: null },
    },
    select: { id: true },
  }));
  if (!conv) return; // chưa có hội thoại (vòng quét đọc khi có) / đã xoá / nick lưu trữ
  await upsertDanhDau(orgId, [conv.id], dongHo(), null);
  void xepHangDocLai([conv.id], 'gap');
}

/**
 * Nick kết nối (lại) ⇒ mọi nhóm của nick bị đánh dấu NGAY (sự kiện lúc mất kết nối không bao giờ tới). Lượt ĐỌC gom:
 * tối đa một lượt / GOM_KET_NOI_LAI_MS / nick — lần nối lại trong khoảng đó chỉ hẹn `thu_lai_sau` = lượt kế, vòng quét
 * 60 s đọc khi tới giờ (review P2-6: vòng lặp session hết hạn ⇒ nối lại liên tục không đốt group_read).
 */
export async function danhDauNickKetNoiLai(orgId: string, zaloAccountId: string): Promise<void> {
  const nick = await withTenant(orgId, () => prisma.zaloAccount.findFirst({
    where: { id: zaloAccountId, orgId }, select: { archivedAt: true },
  }));
  if (!nick || nick.archivedAt) return;
  const convs = await withTenant(orgId, () => prisma.conversation.findMany({
    where: { orgId, zaloAccountId, threadType: 'group', deletedAt: null, externalThreadId: { not: null } },
    select: { id: true },
  }));
  const ids = convs.map((c) => c.id);
  const bayGio = dongHo();
  const now = bayGio.getTime();
  const truoc = docKetNoiLuc.get(zaloAccountId);
  // Chưa đọc lần nào / lượt gần nhất đã xa ⇒ đọc ngay. Đã HẸN một lượt trong tương lai ⇒ giữ hẹn đó (không đẩy lùi mãi).
  // Vừa đọc ⇒ hẹn lượt kế đúng GOM_KET_NOI_LAI_MS sau lượt đó.
  const docNgay = truoc === undefined || now - truoc >= GOM_KET_NOI_LAI_MS;
  const moc = docNgay ? now : Math.max(truoc, truoc + (truoc > now ? 0 : GOM_KET_NOI_LAI_MS));
  docKetNoiLuc.set(zaloAccountId, moc);
  await upsertDanhDau(orgId, ids, bayGio, docNgay ? null : new Date(moc));
  if (docNgay) void xepHangDocLai(ids, 'gap');
  // Danh tính Zalo nhìn từ nick này ⇒ đọc lại ở vòng kế (§8b-an-toàn).
  await danhDauNickKetNoiLaiDanhTinh(orgId, zaloAccountId)
    .catch((err) => logger.warn('[bot-quyen-danh-sach] đánh dấu đọc lại danh tính lỗi:', err));
}

/** Chủ bấm "Đọc lại thành viên" trên trang (hoặc sau khi chủ bỏ xếp tường minh về mặc định). */
export async function yeuCauDocLai(orgId: string, conversationId: string): Promise<boolean> {
  const conv = await withTenant(orgId, () => prisma.conversation.findFirst({
    where: { id: conversationId, orgId, threadType: 'group' }, select: { id: true },
  }));
  if (!conv) return false;
  void xepHangDocLai([conv.id], 'gap');
  return true;
}

// ── Ghi nhận mặc định TỰ ĐỔI (nhật ký "tự động", góp ý chủ (4)) ─────────────

type Tx = Parameters<Parameters<typeof tenantTransaction>[0]>[0];

/**
 * So mặc định HIỆN TẠI (không xét hạn tuổi — hết hạn là tạm thời, không ghi) với `mac_dinh_cuoi` (mặc định KHÁC NULL
 * gần nhất) của từng nhóm. Đổi sales↔khach ⇒ cập nhật `mac_dinh_cuoi` + (nếu nhóm đang THEO mặc định — không có BotNhom)
 * một dòng BotQuyenNhatKy ai_id=AI_TU_DONG. Mặc định null (đang đọc lại, thiếu, lỗi) KHÔNG ghi và không xoá mốc ⇒
 * sales → (im) → sales không sinh dòng nào; lần đầu có mặc định chỉ đặt mốc. Giao dịch + khoá org (cùng khoá với thay
 * đổi của chủ) ⇒ hai lần gọi đồng thời không ghi trùng. Gọi sau mỗi lô đọc, sau thay đổi NV, và vòng định kỳ.
 */
export async function ghiNhanDoiMacDinh(orgId: string, conversationIds?: string[]): Promise<number> {
  if (conversationIds && conversationIds.length === 0) return 0;
  return withTenant(orgId, () => tenantTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-quyen:${orgId}`}))`;
    const rows = await tx.botNhomDanhSach.findMany({
      where: {
        orgId,
        ...(conversationIds ? { conversationId: { in: conversationIds } } : {}),
        conversation: { deletedAt: null, zaloAccount: { archivedAt: null } },
      },
      select: {
        id: true, conversationId: true, uids: true, dayDu: true, canDocLai: true, docLuc: true, macDinhCuoi: true,
        conversation: {
          select: {
            externalThreadId: true, zaloAccountId: true, botNhom: { select: { id: true } },
            zaloAccount: { select: { zaloUid: true, privacyMode: true } },
          },
        },
      },
    });
    if (rows.length === 0) return 0;
    const [nhanVien, nicks, nickCrmDs] = await Promise.all([
      tx.botNhanVien.findMany({
        where: { orgId }, select: { zaloUid: true, trangThai: true, tenGoi: true, uids: { select: { zaloUid: true } } },
      }),
      tx.zaloAccount.findMany({ where: { orgId, zaloUid: { not: null } }, select: { zaloUid: true } }),
      docNickCrm(orgId, tx),
    ]);
    const nickCongTy = nickCongTyTheoNick(nickCrmDs);
    // MỌI uid của mọi NV (docs/77 §8b): mỗi nick nhìn một uid.
    const trangThaiNv = new Map<string, string>();
    const tenNv = new Map<string, string>();
    for (const n of nhanVien) {
      for (const uid of [n.zaloUid, ...n.uids.map((u) => u.zaloUid)]) {
        trangThaiNv.set(uid, n.trangThai);
        tenNv.set(uid, n.tenGoi);
      }
    }
    const nickCrm = new Set(nicks.map((n) => n.zaloUid!).filter(Boolean));
    let soGhi = 0;
    for (const r of rows) {
      const md = tinhMacDinhNhom(r, {
        nickUid: r.conversation.zaloAccount.zaloUid, trangThaiNv, nickCrm, nickCongTy: nickCongTy.get(r.conversation.zaloAccountId),
      });
      if (!md.chucNang || md.chucNang === r.macDinhCuoi) continue;
      await tx.botNhomDanhSach.update({ where: { id: r.id }, data: { macDinhCuoi: md.chucNang } });
      if (!r.macDinhCuoi || r.conversation.botNhom) continue;
      // Tên người ngoài: KHÔNG ghi tên của nhóm thuộc nick Riêng tư (nhật ký đọc được bởi mọi owner/admin).
      let ten: string[] = [];
      if (md.chucNang === 'khach' && r.conversation.zaloAccount.privacyMode !== 'main') {
        ten = await tenNguoiNgoai(tx, r.conversationId, r.conversation.zaloAccountId, r.conversation.externalThreadId,
          md.nguoiNgoai.slice(0, 3), tenNv, trangThaiNv);
      }
      await tx.botQuyenNhatKy.create({
        data: {
          orgId, aiId: AI_TU_DONG, doiTuong: 'nhom', doiTuongId: r.conversationId,
          truoc: { chucNang: r.macDinhCuoi, macDinh: true },
          sau: { chucNang: md.chucNang, macDinh: true },
          lyDo: cauDoiMacDinhTuDong(md.chucNang, ten, md.soNguoiNgoai),
        },
      });
      soGhi++;
    }
    return soGhi;
  }));
}

/** Tên hiển thị của ≤ 3 uid không phải NV: NV đã nghỉ (tên gọi) → "Quét group" → tên người gửi mới nhất → bỏ. */
async function tenNguoiNgoai(
  tx: Tx, conversationId: string, nick: string, groupId: string | null, uids: string[],
  tenNv: ReadonlyMap<string, string>, trangThaiNv: ReadonlyMap<string, string>,
): Promise<string[]> {
  if (uids.length === 0) return [];
  const ten = new Map<string, string>();
  for (const u of uids) {
    const t = tenNv.get(u);
    if (t && trangThaiNv.get(u) === 'nghi') ten.set(u, `${t} (đã nghỉ)`);
  }
  const conLai = () => uids.filter((u) => !ten.has(u));
  if (groupId && conLai().length > 0) {
    const gm = await tx.groupMember.findMany({
      where: { zaloAccountId: nick, groupId, memberUid: { in: conLai() } },
      select: { memberUid: true, displayName: true, zaloName: true },
    });
    for (const g of gm) {
      const t = (g.displayName || g.zaloName || '').trim();
      if (t) ten.set(g.memberUid, t);
    }
  }
  if (conLai().length > 0) {
    const msg = await tx.$queryRaw<Array<{ uid: string; ten: string }>>`
      SELECT DISTINCT ON (m.sender_uid) m.sender_uid AS uid, m.sender_name AS ten
      FROM messages m
      WHERE m.conversation_id = ${conversationId} AND m.sender_uid = ANY(${conLai()}::text[])
        AND m.sender_name IS NOT NULL AND m.sender_name <> ''
      ORDER BY m.sender_uid, m.sent_at DESC`;
    for (const m of msg) ten.set(m.uid, m.ten.trim());
  }
  return uids.map((u) => ten.get(u)).filter((t): t is string => !!t);
}

// ── Vòng quét 60 s + đọc lại định kỳ ────────────────────────────────────────

/**
 * Một vòng quét: nhóm của nick đang kết nối (không lưu trữ, hội thoại chưa xoá) mà chưa có bản đọc, hoặc bản đang cần
 * đọc lại, KHÔNG ở trạng thái dừng, đã tới giờ thử (`thu_lai_sau`).
 */
export async function quetMotVong(bayGio = dongHo()): Promise<number> {
  const rows = await runSystemQuery(() => prisma.$queryRaw<Array<{ id: string }>>`
    SELECT c.id
    FROM conversations c
    JOIN zalo_accounts z ON z.id = c.zalo_account_id
    LEFT JOIN bot_nhom_danh_sach d ON d.conversation_id = c.id
    WHERE c."threadType" = 'group' AND c.deleted_at IS NULL AND c.external_thread_id IS NOT NULL
      AND z.status = 'connected' AND z.archived_at IS NULL
      AND (d.id IS NULL
           OR (d.can_doc_lai AND NOT d.khong_tra AND (d.thu_lai_sau IS NULL OR d.thu_lai_sau <= ${bayGio}::timestamp(3))))
    ORDER BY c.last_message_at DESC NULLS LAST
    LIMIT ${TRAN_MOI_VONG}`);
  if (rows.length > 0) void xepHangDocLai(rows.map((r) => r.id), 'gap');
  return rows.length;
}

/**
 * Đọc lại định kỳ bản ĐÃ TƯƠI (góp ý chủ (3)): nhóm theo mặc định (không BotNhom), đọc lần cuối ≥ CHU_KY_DINH_KY_MS
 * trước, không dừng / chưa tới giờ thử. Ưu tiên `mac_dinh_cuoi = 'sales'` (hướng rủi ro), rồi bản cũ nhất. Chạy trong
 * phần ngân sách định kỳ (TI_LE_DINH_KY) — thiếu ngân sách thì `sales` quá TUOI_TOI_DA_SALES_MS tự im (mac-dinh.ts).
 */
export async function quetDinhKy(bayGio = dongHo()): Promise<number> {
  const moc = new Date(bayGio.getTime() - CHU_KY_DINH_KY_MS);
  const rows = await runSystemQuery(() => prisma.$queryRaw<Array<{ id: string }>>`
    SELECT d.conversation_id AS id
    FROM bot_nhom_danh_sach d
    JOIN conversations c ON c.id = d.conversation_id
    JOIN zalo_accounts z ON z.id = c.zalo_account_id
    WHERE NOT d.can_doc_lai AND NOT d.khong_tra
      AND (d.thu_lai_sau IS NULL OR d.thu_lai_sau <= ${bayGio}::timestamp(3))
      AND (d.doc_luc IS NULL OR d.doc_luc < ${moc}::timestamp(3))
      AND c.deleted_at IS NULL AND c.external_thread_id IS NOT NULL
      AND z.status = 'connected' AND z.archived_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM bot_nhom b WHERE b.conversation_id = d.conversation_id)
    ORDER BY COALESCE(d.mac_dinh_cuoi = 'sales', false) DESC, d.doc_luc ASC NULLS FIRST
    LIMIT ${TRAN_DINH_KY}`);
  if (rows.length > 0) void xepHangDocLai(rows.map((r) => r.id), 'dinh_ky');
  return rows.length;
}

/**
 * Vòng danh tính (docs/77 §8b-an-toàn) cho MỌI org có nhân viên hoặc ≥ 2 nick: đọc globalId SỐNG từ Zalo (ngân sách
 * 'query'), rồi nối — nick CRM nhìn từ nick khác, uid cùng người (globalId ⇒ tự gắn mọi vai; tin chung ⇒ đề xuất). Chạy
 * trước đối soát mặc định (uid / nick mới đổi mặc định nhóm).
 */
export async function doiSoatUidNhanVien(): Promise<void> {
  const orgs = await runSystemQuery(() => prisma.$queryRaw<Array<{ org_id: string }>>`
    SELECT org_id FROM bot_nhan_vien
    UNION
    SELECT org_id FROM zalo_accounts WHERE zalo_uid IS NOT NULL AND zalo_uid <> '' GROUP BY org_id HAVING count(*) >= 2`);
  for (const o of orgs) {
    await layDanhTinhZalo(o.org_id);
    await boSungUidNhanVien(o.org_id)
      .catch((err) => logger.warn(`[bot-quyen-danh-sach] bổ sung uid nhân viên org ${o.org_id} lỗi:`, err));
  }
}

/** Đối soát mặc định đổi cho MỌI org có bản đọc (lưới an toàn — thay đổi NV đã gọi riêng). */
export async function doiSoatMacDinh(): Promise<void> {
  const orgs = await runSystemQuery(() => prisma.$queryRaw<Array<{ org_id: string }>>`
    SELECT DISTINCT org_id FROM bot_nhom_danh_sach`);
  for (const o of orgs) {
    await ghiNhanDoiMacDinh(o.org_id)
      .catch((err) => logger.warn(`[bot-quyen-danh-sach] đối soát mặc định org ${o.org_id} lỗi:`, err));
  }
}

let henGio: NodeJS.Timeout | null = null;
let dinhKyLuc = 0;

export function startBotQuyenDanhSachCron(): void {
  if (henGio) return;
  henGio = setInterval(() => {
    if (dangChay) return; // vòng trước chưa xong — không chồng
    const now = Date.now();
    const dinhKy = now - dinhKyLuc >= CHU_KY_DINH_KY_MS;
    void (async () => {
      await quetMotVong();
      if (dinhKy) {
        dinhKyLuc = now;
        await quetDinhKy();
        await doiSoatUidNhanVien();
        await doiSoatMacDinh();
      }
    })().catch((err) => logger.warn('[bot-quyen-danh-sach] vòng quét lỗi:', err));
  }, CHU_KY_QUET_MS);
  henGio.unref?.();
  logger.info('[bot-quyen-danh-sach] vòng quét danh sách thành viên nhóm (60 s; đọc lại định kỳ 30 phút) đã chạy');
}
