// SPDX-License-Identifier: AGPL-3.0-or-later
// XƯNG HÔ (docs/79 T1, 02/10) — bot gọi một người là "anh" hay "chị".
//
// Nguồn sự thật DUY NHẤT cho NHÂN VIÊN là ô `BotNhanVien.goi` (anh | chi | null) do người giữ trang Quyền bot chọn. CRM chỉ
// GỢI Ý từ `Contact.gender` của các Contact khớp mọi uid của người đó — KHÔNG BAO GIỜ tự ghi `goi`:
//   • giá trị NV đã SỬA TAY (Contact.genderLocked — contact-routes.ts PUT đặt genderLocked = !!gender) thắng giá trị Zalo
//     tự điền (SDK chỉ điền khi trống; Zalo có thể trả 0 = "Nam" mặc định cho người lạ — docs/79 nghiên cứu §6);
//   • hai giá trị khác nhau ở CÙNG mức ⇒ không gợi ý (null + lý do) — gọi sai giới tệ hơn gọi trung tính.
//
// Với NGƯỜI ZALO bất kỳ (khách trong nhóm — đường khách của bot, docs/79 T4): API công khai
// GET /api/public/nguoi-zalo/goi chỉ trả anh/chị khi Contact của (nick, uid) đã KHOÁ TAY (chủ chốt 02/10: "gọi khách anh/chị
// khi giới tính đã được NV xác nhận"); còn lại null ⇒ bot xưng "mình".
//
// Contact của một uid: (a) Contact.zaloUid = uid (uid Zalo là theo nick nhìn, nên chuỗi uid đã chỉ đúng một người), và
// (b) Contact của hội thoại 1-1 (threadType user) trên nick đó có external_thread_id = uid. Contact đã gộp (mergedInto) ⇒
// xét thêm Contact chính (NV thường sửa giới trên bản chính).
import { prisma } from '../../shared/database/prisma-client.js';

export const GOI_NV = ['anh', 'chi'] as const;
export type GoiNv = (typeof GOI_NV)[number];
export type NguonGoi = 'khoa_tay' | 'zalo_tu_dien';
/** Vì sao không có gợi ý: chưa có giới · hai giá trị khoá tay khác nhau · hai giá trị Zalo tự điền khác nhau · khoá tay "khác". */
export type LyDoKhongGoiY = 'chua_co_gioi' | 'mau_thuan_khoa_tay' | 'mau_thuan_zalo' | 'khoa_tay_khac';

export interface GioiContact {
  gender: string | null;
  genderLocked: boolean;
}

export interface GoiGoiY {
  goi: GoiNv | null;
  nguon: NguonGoi | null;
  lyDo: LyDoKhongGoiY | null;
}

export function laGoi(x: unknown): x is GoiNv {
  return typeof x === 'string' && (GOI_NV as readonly string[]).includes(x);
}

/** male ⇒ anh · female ⇒ chi · còn lại (other/unknown/trống) ⇒ null. */
export function goiTuGioi(gender: string | null | undefined): GoiNv | null {
  const g = (gender ?? '').trim().toLowerCase();
  return g === 'male' ? 'anh' : g === 'female' ? 'chi' : null;
}

/** Contact có giới đã khoá tay thật (khoá + có giá trị; sửa tay bỏ trống là MỞ khoá). */
function laKhoaTay(c: GioiContact): boolean {
  return c.genderLocked && !!(c.gender ?? '').trim();
}

/** Tập giá trị khoá tay: 'anh' | 'chi' | 'khac' (giới khoá tay không phải nam/nữ). */
function giaTriKhoaTay(ds: readonly GioiContact[]): Set<GoiNv | 'khac'> {
  return new Set(ds.filter(laKhoaTay).map((c) => goiTuGioi(c.gender) ?? 'khac'));
}

/** Gợi ý "Gọi là" cho NV — xem đầu file. Thuần. */
export function tinhGoiGoiY(ds: readonly GioiContact[]): GoiGoiY {
  const khoa = giaTriKhoaTay(ds);
  if (khoa.size > 1) return { goi: null, nguon: null, lyDo: 'mau_thuan_khoa_tay' };
  if (khoa.size === 1) {
    const [v] = [...khoa];
    return v === 'khac' ? { goi: null, nguon: null, lyDo: 'khoa_tay_khac' } : { goi: v, nguon: 'khoa_tay', lyDo: null };
  }
  const tu = new Set(ds.filter((c) => !laKhoaTay(c)).map((c) => goiTuGioi(c.gender)).filter((x): x is GoiNv => !!x));
  if (tu.size > 1) return { goi: null, nguon: null, lyDo: 'mau_thuan_zalo' };
  if (tu.size === 1) return { goi: [...tu][0], nguon: 'zalo_tu_dien', lyDo: null };
  return { goi: null, nguon: null, lyDo: 'chua_co_gioi' };
}

/** API công khai: CHỈ giá trị khoá tay, không mâu thuẫn; còn lại null. Thuần. */
export function tinhGoiKhoaTay(ds: readonly GioiContact[]): { goi: GoiNv | null; nguon: 'khoa_tay' | null } {
  const g = tinhGoiGoiY(ds);
  return g.nguon === 'khoa_tay' ? { goi: g.goi, nguon: 'khoa_tay' } : { goi: null, nguon: null };
}

// ── Đọc DB ──────────────────────────────────────────────────────────────────

/** Một uid cần tra + nick nhìn uid đó (id ZaloAccount; null = chưa biết ⇒ hội thoại 1-1 ở mọi nick của org). */
export interface UidCanTra {
  uid: string;
  nickIds: readonly string[] | null;
}

/**
 * Giới của mọi Contact khớp từng uid (trong org). Số truy vấn cố định (không N+1): Contact theo uid, hội thoại 1-1 theo
 * uid, Contact của hội thoại + Contact chính của bản đã gộp.
 */
export async function gioiTheoUid(orgId: string, can: readonly UidCanTra[]): Promise<Map<string, GioiContact[]>> {
  const uids = [...new Set(can.map((c) => c.uid).filter(Boolean))];
  const kq = new Map<string, GioiContact[]>();
  if (uids.length === 0) return kq;
  const nickCua = new Map<string, Set<string> | null>();
  for (const c of can) {
    if (!c.uid) continue;
    const cu = nickCua.get(c.uid);
    if (c.nickIds === null || cu === null) { nickCua.set(c.uid, null); continue; }
    nickCua.set(c.uid, new Set([...(cu ?? []), ...c.nickIds]));
  }

  const CHON = { id: true, zaloUid: true, gender: true, genderLocked: true, mergedInto: true } as const;
  // uid đã biết nick ⇒ tra theo (zalo_account_id, external_thread_id) — dùng index unique, không quét bảng hội thoại (đường
  // công khai bot gọi theo từng tin khách). uid chưa biết nick ⇒ theo external_thread_id ở mọi nick của org.
  const coNick = [...nickCua].filter((x): x is [string, Set<string>] => x[1] !== null);
  const khongNick = [...nickCua].filter(([, n]) => n === null).map(([u]) => u);
  const dieuKienHt = [
    ...coNick.filter(([, n]) => n.size > 0).map(([u, n]) => ({ zaloAccountId: { in: [...n] }, externalThreadId: u })),
    ...(khongNick.length > 0 ? [{ externalThreadId: { in: khongNick } }] : []),
  ];
  const [theoUid, hoiThoai] = await Promise.all([
    prisma.contact.findMany({ where: { orgId, zaloUid: { in: uids } }, select: CHON }),
    dieuKienHt.length === 0 ? [] : prisma.conversation.findMany({
      where: { orgId, threadType: 'user', contactId: { not: null }, OR: dieuKienHt },
      select: { externalThreadId: true, zaloAccountId: true, contactId: true },
    }),
  ]);
  const contact = new Map(theoUid.map((c) => [c.id, c]));
  const uidContact = new Map<string, Set<string>>(uids.map((u) => [u, new Set<string>()]));
  for (const c of theoUid) if (c.zaloUid) uidContact.get(c.zaloUid)?.add(c.id);
  for (const h of hoiThoai) {
    if (!h.externalThreadId || !h.contactId) continue;
    const nick = nickCua.get(h.externalThreadId);
    if (nick && !nick.has(h.zaloAccountId)) continue; // hội thoại của nick KHÁC — uid ở đó không phải người này
    uidContact.get(h.externalThreadId)?.add(h.contactId);
  }
  const thieu = [...new Set([...uidContact.values()].flatMap((s) => [...s]))].filter((id) => !contact.has(id));
  if (thieu.length > 0) {
    for (const c of await prisma.contact.findMany({ where: { orgId, id: { in: thieu } }, select: CHON })) contact.set(c.id, c);
  }
  const chinh = [...new Set([...contact.values()].map((c) => c.mergedInto).filter((x): x is string => !!x))]
    .filter((id) => !contact.has(id));
  if (chinh.length > 0) {
    for (const c of await prisma.contact.findMany({ where: { orgId, id: { in: chinh } }, select: CHON })) contact.set(c.id, c);
  }
  for (const [uid, ids] of uidContact) {
    const tat = new Set(ids);
    for (const id of ids) {
      const m = contact.get(id)?.mergedInto;
      if (m && contact.has(m)) tat.add(m);
    }
    kq.set(uid, [...tat].map((id) => contact.get(id)).filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({ gender: c.gender, genderLocked: c.genderLocked })));
  }
  return kq;
}

/** Gợi ý "Gọi là" cho từng NV (id ⇒ gợi ý) từ MỌI uid của người đó. */
export async function goiGoiYChoNhanVien(
  orgId: string,
  ds: ReadonlyArray<{ id: string; zaloUid: string; uids: ReadonlyArray<{ zaloUid: string; zaloAccountId: string | null }> }>,
): Promise<Map<string, GoiGoiY>> {
  const uidCuaNv = new Map<string, string[]>();
  const can: UidCanTra[] = [];
  for (const nv of ds) {
    const theoUid = new Map<string, string | null>();
    for (const u of nv.uids) theoUid.set(u.zaloUid, u.zaloAccountId);
    if (!theoUid.has(nv.zaloUid)) theoUid.set(nv.zaloUid, null);
    uidCuaNv.set(nv.id, [...theoUid.keys()]);
    for (const [uid, nick] of theoUid) can.push({ uid, nickIds: nick ? [nick] : null });
  }
  const gioi = await gioiTheoUid(orgId, can);
  return new Map(ds.map((nv) => [nv.id, tinhGoiGoiY((uidCuaNv.get(nv.id) ?? []).flatMap((u) => gioi.get(u) ?? []))]));
}

/**
 * GET /api/public/nguoi-zalo/goi — (nick_uid, uid) ⇒ {goi, nguon}. nick_uid = ZaloAccount.zaloUid của nick nhìn uid (trong
 * org của khoá); nick lạ ⇒ null. CHỈ trả anh/chị khi đã khoá tay. Không trả gì khác (không tên, không id Contact).
 */
export async function docGoiNguoiZalo(
  orgId: string, nickUid: string, uid: string,
): Promise<{ goi: GoiNv | null; nguon: 'khoa_tay' | null }> {
  const nicks = await prisma.zaloAccount.findMany({ where: { orgId, zaloUid: nickUid }, select: { id: true } });
  if (nicks.length === 0) return { goi: null, nguon: null };
  const gioi = await gioiTheoUid(orgId, [{ uid, nickIds: nicks.map((n) => n.id) }]);
  return tinhGoiKhoaTay(gioi.get(uid) ?? []);
}
