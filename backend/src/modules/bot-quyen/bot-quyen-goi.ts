// SPDX-License-Identifier: AGPL-3.0-or-later
// XƯNG HÔ (docs/79 T1, 02/10) — bot gọi một người là "anh" hay "chị".
//
// NHÂN VIÊN (sửa 05/10 — chủ: "bot nhắn đúng anh/chị TỰ ĐỘNG theo giới tính, không phải chọn tay"): bot dùng
// `BotNhanVien.goi` (người giữ trang chọn tay — luôn THẮNG) ?? GỢI Ý dưới đây (`goiHieuLuc`, payload /api/public/bot-quyen).
// CRM KHÔNG ghi gợi ý vào ô `goi` (ô đó chỉ là lựa chọn tay — "Tự động" = trống). Thứ tự nguồn gợi ý:
//   khoa_tay (Contact đã xác nhận) > zalo_tu_dien (Contact.gender Zalo tự điền) > zalo_ho_so (giới tính HỒ SƠ ZALO đọc trong
//   vòng danh tính — bot_quyen_danh_tinh.gioi_tinh, mọi uid của NV ở mọi nick; cho NV không có Contact, chỉ thấy trong nhóm).
// Chi tiết hai mức Contact:
//   • giá trị NV đã XÁC NHẬN (Contact.gioiTinhXacNhanLuc — contact-routes.ts PUT CHỈ đặt khi giá trị giới tính THỰC ĐỔI hoặc
//     nút "Xác nhận", gioi-tinh-xac-nhan.ts) thắng giá trị Zalo tự điền (SDK chỉ điền khi trống; Zalo có thể trả 0 = "Nam" mặc
//     định cho người lạ — docs/79 nghiên cứu §6). genderLocked KHÔNG có dấu (khoá cũ: form lưu cả form từng đặt khoá ở MỌI lần
//     bấm Lưu) KHÔNG được tin ⇒ xếp cùng hạng Zalo tự điền. Nhãn nguồn vẫn là 'khoa_tay' (giữ hợp đồng) = "đã xác nhận".
//     (Ghi chú "Zalo trả 0 = Nam mặc định cho người lạ" ở bản cũ là GIẢ THUYẾT chưa kiểm — đo PROD 05/10 không thấy thiên Nam.);
//   • hai giá trị khác nhau ở CÙNG mức ⇒ không gợi ý (null + lý do) — gọi sai giới tệ hơn gọi trung tính.
//
// Với NGƯỜI ZALO bất kỳ (khách trong nhóm — đường khách của bot, docs/79 T4): API công khai
// GET /api/public/nguoi-zalo/goi dùng CÙNG thứ tự với NV (chủ chốt 05/10 "giới tính lấy theo zalo luôn" — thay chốt 02/10 chỉ
// tin giá trị xác nhận); không có giới / mâu thuẫn ⇒ null ⇒ bot xưng "mình".
//
// Contact của một uid: (a) Contact.zaloUid = uid (uid Zalo là theo nick nhìn, nên chuỗi uid đã chỉ đúng một người), và
// (b) Contact của hội thoại 1-1 (threadType user) trên nick đó có external_thread_id = uid. Contact đã gộp (mergedInto) ⇒
// xét thêm Contact chính (NV thường sửa giới trên bản chính).
import { prisma } from '../../shared/database/prisma-client.js';
import { NGUON_TIN_DUOC } from './bot-quyen-danh-tinh.js';

export const GOI_NV = ['anh', 'chi'] as const;
export type GoiNv = (typeof GOI_NV)[number];
export type NguonGoi = 'khoa_tay' | 'zalo_tu_dien' | 'zalo_ho_so';
/** Vì sao không có gợi ý: chưa có giới · hai giá trị khoá tay khác nhau · hai giá trị Zalo tự điền khác nhau · khoá tay "khác". */
export type LyDoKhongGoiY = 'chua_co_gioi' | 'mau_thuan_khoa_tay' | 'mau_thuan_zalo' | 'khoa_tay_khac' | 'mau_thuan_ho_so';

export interface GioiContact {
  gender: string | null;
  genderLocked: boolean;
  /** Dấu NV xác nhận (null = chưa ai xác nhận — kể cả khi genderLocked từ bản cũ). */
  gioiTinhXacNhanLuc: Date | null;
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

/** Contact có giới NV đã XÁC NHẬN (có dấu + có giá trị). genderLocked không dấu KHÔNG tính (khoá cũ không tin được). */
function laKhoaTay(c: GioiContact): boolean {
  return !!c.gioiTinhXacNhanLuc && !!(c.gender ?? '').trim();
}

/** Tập giá trị khoá tay: 'anh' | 'chi' | 'khac' (giới khoá tay không phải nam/nữ). */
function giaTriKhoaTay(ds: readonly GioiContact[]): Set<GoiNv | 'khac'> {
  return new Set(ds.filter(laKhoaTay).map((c) => goiTuGioi(c.gender) ?? 'khac'));
}

/**
 * Gợi ý "Gọi là" cho NV — xem đầu file. Thuần. `hoSo` = giới tính hồ sơ Zalo (bot_quyen_danh_tinh) của mọi uid — mức THẤP
 * NHẤT, chỉ dùng khi hai mức Contact không có gì. Mâu thuẫn ở một mức ⇒ null (KHÔNG rơi xuống mức thấp hơn).
 */
export function tinhGoiGoiY(ds: readonly GioiContact[], hoSo: ReadonlyArray<string | null> = []): GoiGoiY {
  const khoa = giaTriKhoaTay(ds);
  if (khoa.size > 1) return { goi: null, nguon: null, lyDo: 'mau_thuan_khoa_tay' };
  if (khoa.size === 1) {
    const [v] = [...khoa];
    return v === 'khac' ? { goi: null, nguon: null, lyDo: 'khoa_tay_khac' } : { goi: v, nguon: 'khoa_tay', lyDo: null };
  }
  const tu = new Set(ds.filter((c) => !laKhoaTay(c)).map((c) => goiTuGioi(c.gender)).filter((x): x is GoiNv => !!x));
  if (tu.size > 1) return { goi: null, nguon: null, lyDo: 'mau_thuan_zalo' };
  if (tu.size === 1) return { goi: [...tu][0], nguon: 'zalo_tu_dien', lyDo: null };
  const hs = new Set(hoSo.map((g) => goiTuGioi(g)).filter((x): x is GoiNv => !!x));
  if (hs.size > 1) return { goi: null, nguon: null, lyDo: 'mau_thuan_ho_so' };
  if (hs.size === 1) return { goi: [...hs][0], nguon: 'zalo_ho_so', lyDo: null };
  return { goi: null, nguon: null, lyDo: 'chua_co_gioi' };
}

/** Giá trị bot dùng cho NV: chủ chọn tay (anh/chi) thắng; trống ⇒ gợi ý (mọi nguồn); không có ⇒ null. Thuần. */
export function goiHieuLuc(goiChon: string | null | undefined, goiY: Pick<GoiGoiY, 'goi'> | null | undefined): GoiNv | null {
  return laGoi(goiChon) ? goiChon : goiY?.goi ?? null;
}

/** API công khai: CHỈ giá trị đã XÁC NHẬN (có dấu), không mâu thuẫn; còn lại null. Thuần. */
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

  const CHON = { id: true, zaloUid: true, gender: true, genderLocked: true, gioiTinhXacNhanLuc: true, mergedInto: true } as const;
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
      .map((c) => ({ gender: c.gender, genderLocked: c.genderLocked, gioiTinhXacNhanLuc: c.gioiTinhXacNhanLuc })));
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
  const [gioi, hoSo] = await Promise.all([gioiTheoUid(orgId, can), gioiHoSoTheoUid(orgId, [...new Set(can.map((c) => c.uid))])]);
  return new Map(ds.map((nv) => {
    const uids = uidCuaNv.get(nv.id) ?? [];
    return [nv.id, tinhGoiGoiY(uids.flatMap((u) => gioi.get(u) ?? []), uids.flatMap((u) => hoSo.get(u) ?? []))];
  }));
}

/**
 * Giới tính HỒ SƠ ZALO theo uid (mọi nick nhìn) từ bảng hệ thống bot_quyen_danh_tinh — CHỈ dòng nguồn tin được, có giới
 * (vòng danh tính chỉ ghi giới từ hồ sơ sạch — không rào D1 / uid lệch; lần đọc hỏng sau đó giữ giới cũ). Một truy vấn.
 */
export async function gioiHoSoTheoUid(orgId: string, uids: readonly string[]): Promise<Map<string, string[]>> {
  const kq = new Map<string, string[]>();
  const ds = uids.filter(Boolean);
  if (ds.length === 0) return kq;
  const rows = await prisma.botQuyenDanhTinh.findMany({
    where: { orgId, zaloUid: { in: ds }, nguon: { in: [...NGUON_TIN_DUOC] }, gioiTinh: { not: null } },
    select: { zaloUid: true, gioiTinh: true },
  });
  for (const r of rows) if (r.gioiTinh) kq.set(r.zaloUid, [...(kq.get(r.zaloUid) ?? []), r.gioiTinh]);
  return kq;
}

/**
 * GET /api/public/nguoi-zalo/goi — (nick_uid, uid) ⇒ {goi, nguon}. nick_uid = ZaloAccount.zaloUid của nick nhìn uid (trong
 * org của khoá); nick lạ ⇒ null. Chủ chốt 05/10: giới tính lấy THEO ZALO luôn — cùng thứ tự với NV (`tinhGoiGoiY`): NV đã xác
 * nhận > Zalo tự điền ở Contact > hồ sơ Zalo (getUserInfo, bot_quyen_danh_tinh); mâu thuẫn ⇒ null ⇒ bot gọi khách "mình".
 * (Giả thuyết cũ "Zalo trả Nam mặc định cho người ẩn giới" CHƯA từng được kiểm — đo PROD 05/10: 0 tên "Thị" bị ghi Nam, Zalo
 * trả Nữ 11/39 hồ sơ và để TRỐNG 4/39 ⇒ không có bằng chứng thiên Nam.) Không trả gì khác (không tên, không id Contact).
 */
export async function docGoiNguoiZalo(
  orgId: string, nickUid: string, uid: string,
): Promise<{ goi: GoiNv | null; nguon: NguonGoi | null }> {
  const nicks = await prisma.zaloAccount.findMany({ where: { orgId, zaloUid: nickUid }, select: { id: true } });
  if (nicks.length === 0) return { goi: null, nguon: null };
  const [gioi, hoSo] = await Promise.all([
    gioiTheoUid(orgId, [{ uid, nickIds: nicks.map((n) => n.id) }]),
    gioiHoSoTheoUid(orgId, [uid]),
  ]);
  const g = tinhGoiGoiY(gioi.get(uid) ?? [], hoSo.get(uid) ?? []);
  return { goi: g.goi, nguon: g.nguon };
}
