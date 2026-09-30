// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT — ĐỌC DANH SÁCH THÀNH VIÊN nhóm để tính MẶC ĐỊNH chức năng nhóm (docs/77 §8).
//
// Bảng bot_nhom_danh_sach giữ bản đọc getGroupInfo của từng hội thoại nhóm. Mặc định chỉ tính trên bản ĐỦ và TƯƠI
// (`dayDu` ∧ ¬`canDocLai` — bot-quyen-mac-dinh.ts); còn lại "chưa xếp loại" ⇒ bot im. Bản tươi nhờ ba đường:
//
//   1. Zalo báo thành viên đổi (group_event join/leave/remove_member/block_member — zalo-listener-factory.ts)
//      ⇒ `danhDauNhomDoiThanhVien`: đánh dấu cần đọc lại NGAY (mặc định tắt — bot im) rồi xếp hàng đọc lại.
//   2. Nick kết nối (lại) (listener 'connected' — gồm lần khởi động CRM và mỗi lần WS nối lại) ⇒ `danhDauNickKetNoiLai`:
//      mọi nhóm của nick bị đánh dấu (sự kiện lúc mất kết nối đã mất), rồi đọc lại hết.
//   3. Vòng quét 60 s (`startBotQuyenDanhSachCron`): đọc nhóm còn thiếu bản đọc (hội thoại nhóm mới) và thử lại bản
//      lỗi — chỉ nick đang kết nối.
//
// Đua "đọc ↔ đánh dấu": lần đọc ghi mốc BẮT ĐẦU; khi ghi kết quả, cờ chỉ gỡ nếu KHÔNG có lần đánh dấu nào sau mốc đó
// (`danh_dau_luc > bat_dau` ⇒ giữ cờ). Nhóm bị đánh dấu trong lúc đang đọc được xếp hàng lại.
//
// getGroupInfo nhận MẢNG id ⇒ đọc theo lô LO_NHOM nhóm/nick/lần gọi, qua zaloOps (đã có rate-limit group_read).
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { runSystemQuery, withTenant } from '../../shared/tenant/tenant-context.js';

/** Đọc thông tin NHIỀU nhóm của một nick (zca-js getGroupInfo). Tiêm được — test thay bằng hàm giả. */
export type DocThongTinNhom = (zaloAccountId: string, groupIds: string[]) => Promise<unknown>;

export const LO_NHOM = 20;
export const HET_GIO_DOC_MS = 15_000;
const NGHI_GIUA_LO_MS = 300;
/** Bản lỗi / thiếu được thử lại sau khoảng này (vòng quét). */
export const THU_LAI_SAU_MS = 60_000;
const TRAN_MOI_VONG = 400;

/** Loại group_event làm đổi thành viên. */
export const SU_KIEN_DOI_THANH_VIEN: ReadonlySet<string> = new Set(['join', 'leave', 'remove_member', 'block_member']);

export interface KetQuaPhanTich {
  uids: string[];
  dayDu: boolean;
}

/**
 * Thành viên của MỘT nhóm trong kết quả getGroupInfo: gộp memberIds + memVerList ("<uid>_<ver>") + currentMems như
 * group-scan-worker. `dayDu` = có ít nhất một uid, `hasMoreMember` = 0 và đủ `totalMember`. Khoá đúng id — KHÔNG lấy
 * nhóm đầu tiên (đọc theo lô: nhóm khác trong lô không được nhận nhầm). `null` = Zalo không trả nhóm này. Thuần.
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
  return { uids: duy.sort(), dayDu: duy.length > 0 && conThieu === 0 && (tong === null || duy.length >= tong) };
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

// ── Hàng đợi (một tiến trình, một vòng chạy) ────────────────────────────────

const choDoc = new Set<string>();
let dangChay: Promise<void> | null = null;
let docThongTin: DocThongTinNhom = docMacDinh;
let nghiMs = NGHI_GIUA_LO_MS;

/** Chỉ cho test: thay bộ đọc Zalo + bỏ nghỉ giữa lô. */
export function _datBoDocChoTest(doc: DocThongTinNhom | null): void {
  docThongTin = doc ?? docMacDinh;
  nghiMs = doc ? 0 : NGHI_GIUA_LO_MS;
}

/** Xếp hàng đọc lại danh sách của các hội thoại nhóm. Trả promise xong vòng hiện tại (test chờ được). */
export function xepHangDocLai(conversationIds: Iterable<string>): Promise<void> {
  for (const id of conversationIds) if (id) choDoc.add(id);
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

async function chay(): Promise<void> {
  while (choDoc.size > 0) {
    const ids = [...choDoc].slice(0, TRAN_MOI_VONG);
    for (const id of ids) choDoc.delete(id);
    let convs: ConvDoc[] = [];
    try {
      convs = await runSystemQuery(() => prisma.conversation.findMany({
        where: { id: { in: ids }, threadType: 'group' },
        select: { id: true, orgId: true, zaloAccountId: true, externalThreadId: true },
      }));
    } catch (err) {
      logger.warn('[bot-quyen-danh-sach] không đọc được hội thoại cần đọc lại:', err);
      continue;
    }
    const theoNick = new Map<string, ConvDoc[]>();
    for (const c of convs) {
      if (!c.externalThreadId) continue;
      const ds = theoNick.get(c.zaloAccountId) ?? [];
      ds.push(c);
      theoNick.set(c.zaloAccountId, ds);
    }
    for (const [nick, ds] of theoNick) {
      for (let i = 0; i < ds.length; i += LO_NHOM) {
        await docMotLo(nick, ds.slice(i, i + LO_NHOM));
        if (nghiMs > 0) await new Promise((r) => setTimeout(r, nghiMs));
      }
    }
  }
}

async function ghi(c: ConvDoc, batDau: Date, kq: KetQuaPhanTich | null, loi: string | null): Promise<void> {
  const bayGio = new Date();
  await withTenant(c.orgId, async () => {
    if (kq) {
      // Gỡ cờ CHỈ khi không có lần đánh dấu nào sau lúc bắt đầu đọc.
      await prisma.$executeRaw`
        INSERT INTO bot_nhom_danh_sach (id, org_id, conversation_id, zalo_account_id, uids, day_du, doc_luc, can_doc_lai,
                                        danh_dau_luc, thu_luc, loi)
        VALUES (gen_random_uuid()::text, ${c.orgId}, ${c.id}, ${c.zaloAccountId}, ${kq.uids}::text[], ${kq.dayDu}, ${bayGio},
                false, ${batDau}, ${bayGio}, NULL)
        ON CONFLICT (conversation_id) DO UPDATE SET
          zalo_account_id = EXCLUDED.zalo_account_id, uids = EXCLUDED.uids, day_du = EXCLUDED.day_du,
          doc_luc = EXCLUDED.doc_luc, thu_luc = EXCLUDED.thu_luc, loi = NULL,
          can_doc_lai = bot_nhom_danh_sach.danh_dau_luc > ${batDau}`;
    } else {
      // Lỗi: giữ bản cũ nhưng KHÔNG gỡ cờ (dòng mới ⇒ cần đọc lại).
      await prisma.$executeRaw`
        INSERT INTO bot_nhom_danh_sach (id, org_id, conversation_id, zalo_account_id, can_doc_lai, danh_dau_luc, thu_luc, loi)
        VALUES (gen_random_uuid()::text, ${c.orgId}, ${c.id}, ${c.zaloAccountId}, true, ${batDau}, ${bayGio}, ${loi})
        ON CONFLICT (conversation_id) DO UPDATE SET thu_luc = EXCLUDED.thu_luc, loi = EXCLUDED.loi`;
    }
  });
}

async function docMotLo(nick: string, ds: ConvDoc[]): Promise<void> {
  const batDau = new Date();
  let info: unknown = null;
  let loiChung: string | null = null;
  try {
    info = await hetGio(docThongTin(nick, ds.map((c) => c.externalThreadId!)), HET_GIO_DOC_MS);
  } catch (err) {
    loiChung = (err instanceof Error ? err.message : String(err)).slice(0, 300);
  }
  for (const c of ds) {
    const kq = loiChung ? null : phanTichNhom(info, c.externalThreadId!);
    const loi = loiChung ?? (kq ? null : 'Zalo không trả thông tin nhóm này (nick đã rời nhóm?)');
    try {
      await ghi(c, batDau, kq, loi);
    } catch (err) {
      logger.warn(`[bot-quyen-danh-sach] ghi bản đọc nhóm ${c.id} lỗi:`, err);
    }
  }
  if (loiChung) logger.warn(`[bot-quyen-danh-sach] đọc ${ds.length} nhóm của nick ${nick} lỗi: ${loiChung}`);
}

// ── Đánh dấu ────────────────────────────────────────────────────────────────

/** Zalo báo thành viên nhóm đổi ⇒ mặc định của nhóm tắt NGAY (bot im) tới khi đọc lại xong. */
export async function danhDauNhomDoiThanhVien(orgId: string, zaloAccountId: string, groupId: string): Promise<void> {
  const conv = await withTenant(orgId, () => prisma.conversation.findFirst({
    where: { orgId, zaloAccountId, externalThreadId: groupId, threadType: 'group' }, select: { id: true },
  }));
  if (!conv) return; // chưa có hội thoại — vòng quét sẽ đọc khi có
  await withTenant(orgId, () => prisma.botNhomDanhSach.updateMany({
    where: { conversationId: conv.id }, data: { canDocLai: true, danhDauLuc: new Date() },
  }));
  void xepHangDocLai([conv.id]);
}

/** Nick kết nối (lại) ⇒ mọi nhóm của nick bị đánh dấu + đọc lại (sự kiện lúc mất kết nối không bao giờ tới). */
export async function danhDauNickKetNoiLai(orgId: string, zaloAccountId: string): Promise<void> {
  await withTenant(orgId, () => prisma.botNhomDanhSach.updateMany({
    where: { orgId, zaloAccountId }, data: { canDocLai: true, danhDauLuc: new Date() },
  }));
  const convs = await withTenant(orgId, () => prisma.conversation.findMany({
    where: { orgId, zaloAccountId, threadType: 'group', deletedAt: null, externalThreadId: { not: null } },
    select: { id: true },
  }));
  void xepHangDocLai(convs.map((c) => c.id));
}

/** Chủ bấm "Đọc lại thành viên" trên trang (hoặc sau khi chủ bỏ xếp tường minh về mặc định). */
export async function yeuCauDocLai(orgId: string, conversationId: string): Promise<boolean> {
  const conv = await withTenant(orgId, () => prisma.conversation.findFirst({
    where: { id: conversationId, orgId, threadType: 'group' }, select: { id: true },
  }));
  if (!conv) return false;
  void xepHangDocLai([conv.id]);
  return true;
}

// ── Vòng quét 60 s ──────────────────────────────────────────────────────────

/** Một vòng quét: nhóm của nick đang kết nối mà chưa có bản đọc, hoặc bản đang cần đọc lại mà lần thử cũ ≥ 60 s. */
export async function quetMotVong(bayGio = new Date()): Promise<number> {
  const moc = new Date(bayGio.getTime() - THU_LAI_SAU_MS);
  const rows = await runSystemQuery(() => prisma.$queryRaw<Array<{ id: string }>>`
    SELECT c.id
    FROM conversations c
    JOIN zalo_accounts z ON z.id = c.zalo_account_id
    LEFT JOIN bot_nhom_danh_sach d ON d.conversation_id = c.id
    WHERE c."threadType" = 'group' AND c.deleted_at IS NULL AND c.external_thread_id IS NOT NULL
      AND z.status = 'connected' AND z.archived_at IS NULL
      AND (d.id IS NULL OR (d.can_doc_lai AND (d.thu_luc IS NULL OR d.thu_luc < ${moc})))
    ORDER BY c.last_message_at DESC NULLS LAST
    LIMIT ${TRAN_MOI_VONG}`);
  if (rows.length > 0) void xepHangDocLai(rows.map((r) => r.id));
  return rows.length;
}

let henGio: NodeJS.Timeout | null = null;

export function startBotQuyenDanhSachCron(): void {
  if (henGio) return;
  henGio = setInterval(() => {
    if (dangChay) return; // vòng trước chưa xong — không chồng
    quetMotVong().catch((err) => logger.warn('[bot-quyen-danh-sach] vòng quét lỗi:', err));
  }, THU_LAI_SAU_MS);
  henGio.unref?.();
  logger.info('[bot-quyen-danh-sach] vòng quét danh sách thành viên nhóm (60 s) đã chạy');
}
