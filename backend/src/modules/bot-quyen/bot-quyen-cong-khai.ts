// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §3.2) — dựng payload CÔNG KHAI cho bot: {phien_ban, nhom, nhan_vien}.
//
// Đây là HỢP ĐỒNG với bridge Python của bot (poll ~60 s): khoá snake_case, giá trị lấy từ enum
// docs/77 §2, nhom sắp theo conversation_id, nhan_vien sắp theo zalo_uid. Bot so `phien_ban` để
// biết có cần áp lại không ⇒ phien_ban = sha256 (hex) của JSON CHUẨN (khoá sắp xếp đệ quy) của
// đúng hai mảng này: cùng dữ liệu ⇒ cùng chuỗi, đổi bất kỳ ô nào ⇒ chuỗi khác. Ô ngoài payload
// (ghi chú, người/lúc cập nhật) KHÔNG làm đổi phiên bản — bot không cần áp lại vì chúng.
//
// `nick_uid` (vòng sửa 1): uid Zalo của CHÍNH nick CRM nhìn nhóm (ZaloAccount.zaloUid của hội thoại, null khi
// nick chưa có uid). Bot nạp các uid này vào bảng nick_bot — tin của nick đó trong nhóm không bị coi là người
// ngoài. Nhóm chuyển sang nick khác / nick đổi uid ⇒ phien_ban đổi.
//
// MẶC ĐỊNH (docs/77 §8, 30/09): `chuc_nang` là chức năng HIỆU LỰC — chủ xếp tường minh (BotNhom) nếu có, không thì
// mặc định theo thành viên (toàn NV ⇒ sales, có người ngoài ⇒ khach — bot-quyen-mac-dinh.ts). `mac_dinh` = true khi
// giá trị là mặc định. Nhóm không xếp mà chưa biết đủ/tươi danh sách thành viên ⇒ VẮNG (bot: bỏ xếp loại ⇒ im).
// Mặc định tính lúc đọc (không lưu) ⇒ đổi NV / thành viên ⇒ payload đổi ⇒ phien_ban đổi ngay ở lần poll kế. `sales` mặc
// định từ bản đọc quá TUOI_TOI_DA_SALES_MS (6 giờ) ⇒ vắng (bot im) — phien_ban đổi đúng lúc qua hạn.
// Hội thoại đã xoá / nick đã lưu trữ: KHÔNG có mặc định (chủ xếp tường minh vẫn phát như trước).
//
// NHIỀU UID MỖI NHÂN VIÊN (docs/77 §8b, 30/09): Zalo cấp uid khác nhau cho cùng một người ở mỗi nick ⇒ mỗi dòng
// `nhan_vien` là MỘT người: `zalo_uid` = uid lúc gán (giữ cho bot bản cũ), `uids` = MỌI uid [{nick_uid, uid}] (kể cả
// `zalo_uid`; `nick_uid` = ZaloAccount.zaloUid của nick nhìn uid đó, null = chưa biết), sắp theo uid. Bot đăng ký MỌI uid
// làm danh tính của cùng một actor. Mặc định nhóm so thành viên với MỌI uid (thành viên là uid theo nick của nhóm).
//
// AN TOÀN (§8b-an-toàn, 30/09): mỗi uid mang `nguon` — `chu_chon` (uid lúc gán / chủ thêm tay; uid chính luôn là
// chu_chon), `zalo_global_id` (globalId CRM tự đọc từ Zalo trùng — chắc, mọi vai), `chu_xac_nhan` (chủ bấm "Nối" một đề
// xuất tin chung). `cung_tin` không còn được CRM phát (tin chung chỉ là đề xuất) — bot vẫn rào: chỉ nhận cho actor sales,
// KHÔNG BAO GIỜ chuyển danh tính giữa actor dựa trên nó.
// `nick_crm` = [{nick_uid, uid, nick_ten}] — nick CRM KHÁC của org nhìn từ nick `nick_uid` (bảng bot_nick_crm_uid): bot
// thêm vào nick_bot (không phải người ngoài, không phải nhân viên), sắp theo uid. phien_ban băm cả ba mảng.
import { createHash } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { tinhMacDinhNhom, chucNangHieuLuc } from './bot-quyen-mac-dinh.js';
import { docNickCrm, nickCongTyTheoNick } from './bot-quyen-nick-crm.js';

export interface NhomCongKhai {
  conversation_id: string;
  external_thread_id: string | null;
  nick_uid: string | null;
  chuc_nang: string;
  ten_dang_ky: string;
  /** true = chức năng MẶC ĐỊNH theo thành viên; false = chủ xếp tường minh. */
  mac_dinh: boolean;
}

/**
 * Nguồn một uid trong payload (§8b-an-toàn P1-3): chu_chon (chủ chọn) · zalo_global_id (globalId CRM đọc trực tiếp từ Zalo
 * trùng — chắc) · chu_xac_nhan (chủ nối đề xuất) · cung_tin (dự phòng cho giá trị lạ/cũ — CRM không còn phát; bot ít tin nhất).
 */
export type NguonUidCongKhai = 'chu_chon' | 'zalo_global_id' | 'chu_xac_nhan' | 'cung_tin';

export interface UidCongKhai {
  nick_uid: string | null;
  uid: string;
  nguon: NguonUidCongKhai;
}

/** Nick CRM khác của org nhìn từ một nick (§8b-an-toàn): người CÔNG TY, không phải người ngoài, không phải NV. */
export interface NickCrmCongKhai {
  /** uid (tự nhìn) của nick NHÌN — nick sở hữu các nhóm nơi uid này xuất hiện. null = CRM chưa biết. */
  nick_uid: string | null;
  uid: string;
  /** Tên nick X của org mà uid này là. */
  nick_ten: string;
}

/** DB `nguon` → payload. Giá trị lạ ⇒ cung_tin (ít quyền nhất phía bot). */
export function nguonCongKhai(nguon: string | null | undefined): NguonUidCongKhai {
  return nguon === 'chon' ? 'chu_chon'
    : nguon === 'chu_xac_nhan' ? 'chu_xac_nhan'
      : nguon === 'zalo_global_id' ? 'zalo_global_id' : 'cung_tin';
}

export interface NhanVienCongKhai {
  zalo_uid: string;
  ten_goi: string;
  vai: string;
  trang_thai: string;
  /** Mọi uid của người này (mỗi nick một uid), kể cả `zalo_uid`. */
  uids: UidCongKhai[];
}

export interface CauHinhCongKhai {
  phien_ban: string;
  nhom: NhomCongKhai[];
  nhan_vien: NhanVienCongKhai[];
  nick_crm: NickCrmCongKhai[];
}

/** JSON chuẩn: khoá object sắp xếp đệ quy, mảng giữ thứ tự, không khoảng trắng. */
export function jsonChuan(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(jsonChuan).join(',')}]`;
  const o = v as Record<string, unknown>;
  const khoa = Object.keys(o).filter((k) => o[k] !== undefined).sort(soSanh);
  return `{${khoa.map((k) => `${JSON.stringify(k)}:${jsonChuan(o[k])}`).join(',')}}`;
}

/** So theo điểm mã — không phụ thuộc locale máy chủ (localeCompare thì có). */
function soSanh(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ghép dòng DB thành payload + phiên bản. Thuần — test được không cần DB. */
export function ghepCauHinhCongKhai(
  nhom: ReadonlyArray<{
    conversationId: string; externalThreadId: string | null; nickUid: string | null; chucNang: string; tenDangKy: string;
    macDinh?: boolean;
  }>,
  nhanVien: ReadonlyArray<{
    zaloUid: string; tenGoi: string; vai: string; trangThai: string;
    uids?: ReadonlyArray<{ zaloUid: string; nickUid: string | null; nguon?: string }>;
  }>,
  nickCrm: ReadonlyArray<{ nickUid: string | null; zaloUid: string; nickTen: string }> = [],
): CauHinhCongKhai {
  const n: NhomCongKhai[] = nhom
    .map((r) => ({
      // Thứ tự khoá = thứ tự trong JSON trả về (hợp đồng): conversation_id, external_thread_id, nick_uid,
      // chuc_nang, ten_dang_ky, mac_dinh. Băm dùng JSON chuẩn (khoá sắp xếp) nên thứ tự này không ảnh hưởng phien_ban.
      conversation_id: r.conversationId,
      external_thread_id: r.externalThreadId,
      nick_uid: r.nickUid,
      chuc_nang: r.chucNang,
      ten_dang_ky: r.tenDangKy,
      mac_dinh: r.macDinh === true,
    }))
    .sort((a, b) => soSanh(a.conversation_id, b.conversation_id));
  const v: NhanVienCongKhai[] = nhanVien
    .map((r) => {
      const theoUid = new Map<string, UidCongKhai>();
      for (const u of r.uids ?? []) {
        if (!u.zaloUid || theoUid.has(u.zaloUid)) continue;
        // uid chính luôn là chủ chọn (dù dòng bảng uid ghi gì).
        theoUid.set(u.zaloUid, { nick_uid: u.nickUid, uid: u.zaloUid, nguon: u.zaloUid === r.zaloUid ? 'chu_chon' : nguonCongKhai(u.nguon) });
      }
      if (!theoUid.has(r.zaloUid)) theoUid.set(r.zaloUid, { nick_uid: null, uid: r.zaloUid, nguon: 'chu_chon' });
      const uids = [...theoUid.values()].sort((a, b) => soSanh(a.uid, b.uid));
      return { zalo_uid: r.zaloUid, ten_goi: r.tenGoi, vai: r.vai, trang_thai: r.trangThai, uids };
    })
    .sort((a, b) => soSanh(a.zalo_uid, b.zalo_uid));
  const k: NickCrmCongKhai[] = nickCrm
    .map((r) => ({ nick_uid: r.nickUid, uid: r.zaloUid, nick_ten: r.nickTen }))
    .sort((a, b) => soSanh(a.uid, b.uid) || soSanh(a.nick_uid ?? '', b.nick_uid ?? ''));
  const phien_ban = createHash('sha256').update(jsonChuan({ nhom: n, nhan_vien: v, nick_crm: k })).digest('hex');
  return { phien_ban, nhom: n, nhan_vien: v, nick_crm: k };
}

// ── Bộ nhớ đệm bản đọc danh sách (review P2-8) ─────────────────────────────
//
// Bot poll mỗi ~60 s. Nạp MỌI mảng uids của org mỗi lần là phí (hàng nghìn nhóm × vài chục uid). Giữ bản nạp theo org,
// khoá = (số dòng, max sua_so) — `sua_so` do trigger DB tăng ở MỌI lần INSERT/UPDATE dòng (kể cả ghi tay), xoá dòng làm
// đổi số dòng ⇒ khoá đổi ĐÚNG KHI dữ liệu đổi. Khoá tính từ CHÍNH các dòng vừa nạp (một câu lệnh = một snapshot) nên
// không bao giờ ghép khoá mới với dữ liệu cũ. Mặc định vẫn TÍNH LẠI mỗi lần từ NV / nick / BotNhom tươi + đồng hồ ⇒
// phien_ban vẫn đúng từng ô (chỉ bỏ được việc nạp uids).

type DongDanhSach = { uids: string[]; dayDu: boolean; canDocLai: boolean; docLuc: Date | null };
const boNho = new Map<string, { khoa: string; dong: Map<string, DongDanhSach> }>();
let soLanNap = 0;

/** Chỉ cho test: số lần đã NẠP uids từ DB (không tính lần dùng bộ nhớ đệm) + xoá bộ nhớ đệm. */
export function _thongKeBoNho(xoa = false): number {
  const n = soLanNap;
  if (xoa) { boNho.clear(); soLanNap = 0; }
  return n;
}

async function docDanhSachCoDem(orgId: string): Promise<Map<string, DongDanhSach>> {
  const [dau] = await prisma.$queryRaw<Array<{ so: number; max: string }>>`
    SELECT count(*)::int AS so, COALESCE(max(sua_so), 0)::text AS max FROM bot_nhom_danh_sach WHERE org_id = ${orgId}`;
  const cu = boNho.get(orgId);
  if (cu && cu.khoa === `${dau.so}:${dau.max}`) return cu.dong;
  const rows = await prisma.botNhomDanhSach.findMany({
    where: { orgId },
    select: { conversationId: true, uids: true, dayDu: true, canDocLai: true, docLuc: true, suaSo: true },
  });
  soLanNap++;
  let max = 0n;
  const dong = new Map<string, DongDanhSach>();
  for (const r of rows) {
    if (r.suaSo > max) max = r.suaSo;
    dong.set(r.conversationId, { uids: r.uids, dayDu: r.dayDu, canDocLai: r.canDocLai, docLuc: r.docLuc });
  }
  boNho.set(orgId, { khoa: `${rows.length}:${max.toString()}`, dong });
  return dong;
}

/**
 * Đọc cấu hình của MỘT org. Nhóm: chủ đã xếp (BotNhom) + nhóm có MẶC ĐỊNH (bản đọc đủ, tươi, `sales` chưa quá hạn tuổi;
 * hội thoại chưa xoá, nick chưa lưu trữ). Nhóm không có cả hai vắng mặt ⇒ bot coi là im. Mọi NV (kể cả khoa/nghi — bot
 * cần biết người nghỉ để im nhóm có họ). Truy vấn cố định (không N+1); uids qua bộ nhớ đệm.
 */
export async function docCauHinhCongKhai(orgId: string, bayGio: Date = new Date()): Promise<CauHinhCongKhai> {
  return withTenant(orgId, async () => {
    const [convs, nhanVien, nicks, danhSach, nickCrmDs] = await Promise.all([
      prisma.conversation.findMany({
        where: { orgId, threadType: 'group', OR: [{ botNhom: { isNot: null } }, { botNhomDanhSach: { isNot: null } }] },
        select: {
          id: true, externalThreadId: true, deletedAt: true, zaloAccountId: true,
          zaloAccount: { select: { zaloUid: true, archivedAt: true } },
          botNhom: { select: { chucNang: true, tenDangKy: true } },
        },
      }),
      prisma.botNhanVien.findMany({
        where: { orgId },
        select: {
          zaloUid: true, tenGoi: true, vai: true, trangThai: true,
          uids: { select: { zaloUid: true, zaloAccountId: true, nguon: true } },
        },
      }),
      prisma.zaloAccount.findMany({ where: { orgId }, select: { id: true, zaloUid: true, displayName: true } }),
      docDanhSachCoDem(orgId),
      docNickCrm(orgId),
    ]);
    const nickCongTy = nickCongTyTheoNick(nickCrmDs);
    // MỌI uid của mọi NV (docs/77 §8b) — thành viên nhóm là uid THEO NICK của nhóm.
    const trangThaiNv = new Map<string, string>();
    for (const n of nhanVien) {
      trangThaiNv.set(n.zaloUid, n.trangThai);
      for (const u of n.uids) trangThaiNv.set(u.zaloUid, n.trangThai);
    }
    const uidNick = new Map(nicks.map((n) => [n.id, n.zaloUid]));
    const tenNick = new Map(nicks.map((n) => [n.id, n.displayName ?? '']));
    const nickCrm = new Set(nicks.map((n) => n.zaloUid).filter((x): x is string => !!x));
    const nhom = [];
    for (const c of convs) {
      const nickUid = c.zaloAccount.zaloUid;
      const daAn = c.deletedAt !== null || c.zaloAccount.archivedAt !== null;
      const md = tinhMacDinhNhom(danhSach.get(c.id) ?? null, {
        nickUid, trangThaiNv, nickCrm, bayGio, daAn, nickCongTy: nickCongTy.get(c.zaloAccountId),
      });
      const hl = chucNangHieuLuc(c.botNhom?.chucNang ?? null, md);
      if (!hl.chucNang) continue;
      nhom.push({
        conversationId: c.id,
        externalThreadId: c.externalThreadId,
        nickUid,
        chucNang: hl.chucNang,
        tenDangKy: c.botNhom?.tenDangKy ?? '',
        macDinh: hl.macDinh,
      });
    }
    return ghepCauHinhCongKhai(nhom, nhanVien.map((n) => ({
      zaloUid: n.zaloUid, tenGoi: n.tenGoi, vai: n.vai, trangThai: n.trangThai,
      uids: n.uids.map((u) => ({
        zaloUid: u.zaloUid, nickUid: (u.zaloAccountId && uidNick.get(u.zaloAccountId)) || null, nguon: u.nguon,
      })),
    })), nickCrmDs.map((r) => ({
      nickUid: uidNick.get(r.zaloAccountId) ?? null, zaloUid: r.zaloUid,
      nickTen: tenNick.get(r.nickId)?.trim() || 'Nick CRM',
    })));
  });
}
