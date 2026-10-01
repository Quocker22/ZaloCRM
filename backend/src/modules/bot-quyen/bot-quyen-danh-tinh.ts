// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §8b-an-toàn) — DANH TÍNH CHẮC: globalId CRM tự đọc TRỰC TIẾP từ Zalo (bảng hệ thống bot_quyen_danh_tinh).
//
// Vì sao: Zalo cấp uid KHÁC NHAU cho cùng một người ở mỗi nick nhìn, còn `globalId` KHÔNG đổi theo nick (schema
// Friend.zaloGlobalId). Cột globalId của friends/group_members thì user CRM ghi được (POST /conversations/ensure-by-uid),
// backfill chép qua liên hệ đã gộp, và Zalo trả globalId "giữ chỗ" dùng chung ⇒ KHÔNG BAO GIỜ đọc các cột đó để nối.
// Ở đây CRM tự hỏi Zalo qua CHÍNH nick nhìn và lưu vào bảng mà không route người dùng nào ghi được.
//
// Lời gọi zca-js (qua zaloOps.exec ⇒ rate limiter + sdk-limit-service):
//   getUserInfo(uids[])  — category 'query' (2000/ngày, 30/30 s mặc định). Trả { changed_profiles: { "<uid>_0" | "<uid>":
//                          User{ userId, globalId, zaloName, displayName, … } } }. Tối đa LO_UID uid mỗi lần gọi. NGUỒN DUY
//                          NHẤT của globalId người khác (đo LIVE staging 30/09: Hưng 3835… → PODILQ…, Quốc 5369… → OGGI1EMN…,
//                          cả người không phải bạn).
//   findUser(phone)      — category 'friend_lookup' (chung quota chiến dịch tìm khách). Trả UserBasic{ uid, globalId,
//                          zalo_name, display_name }. Dùng ÍT (≤ TRAN_TIM_SDT_NGAY/nick/ngày), chỉ khi còn thiếu.
//   ⚠️ KHÔNG dùng getGroupMembersInfo cho globalId (giám sát LIVE 30/09, D1): qua VTMT nó trả globalId CỦA CHÍNH NICK GỌI
//   (4LGTI…) cho MỌI thành viên ⇒ 5 dòng cùng globalId ⇒ globalId của VTMT bị coi là "nhiễm" ⇒ không nhận ra ai.
// Rào (phòng thủ nhiều lớp, `locLoHoSo`): globalId = globalId của chính nick gọi mà uid ≠ uid của nick ⇒ bỏ; cả lô (> 1
// uid có globalId) trả CÙNG MỘT globalId ⇒ bỏ cả lô. Dòng bị bỏ KHÔNG BAO GIỜ làm "nhiễm" globalId của nick gọi
// (`dungBanDanhTinh` bỏ qua dòng mang globalId của chính nick nhìn trên uid khác).
// Đã đo LIVE trên staging qua VTMT (docs/77 cach-crm-nhan-dien.md §5): getUserInfo trả globalId cho cả người KHÔNG phải
// bạn (isFr=0) nhưng CHỈ với uid theo góc của chính nick gọi (uid nick khác ⇒ rỗng); getUserInfo(ownId) trả globalId +
// phoneNumber; findUser(sđt nick CRM khác) trả uid theo góc nick gọi + globalId trùng. Lỗi 216 bị zca-js nuốt ⇒ rỗng ⇒
// globalId TIN ĐƯỢC đã có KHÔNG bị hạ về null (giữ cũ, ghi `loi` — D3).
// globalId CỦA CHÍNH nick lưu lúc nối (ghiHoSoNickKetNoi — zalo-pool đã gọi getUserInfo(ownId)) ⇒ nick đang tắt vẫn được
// nhận ra ở nick khác. SĐT dùng cho findUser nick lấy từ hồ sơ sống đó, KHÔNG BAO GIỜ từ zalo_accounts.phone (gõ tay —
// staging gõ lẫn VTMT/Tiểu Mã). Không bao giờ hỏi getUserInfo trên MÃ NHÓM (Zalo trả globalId giữ chỗ).
//
// NGUỒN TIN ĐƯỢC (NGUON_TIN_DUOC): zalo_user_info · zalo_find_user · zalo_nick_ket_noi. Dòng nguồn khác (vd 'zalo_api' của
// bản trước — không phân biệt được getUserInfo với getGroupMembersInfo) KHÔNG dùng làm bằng chứng và KHÔNG tính là tươi
// (đọc lại ngay vòng kế).
//
// Ngân sách: tối đa TI_LE_NGAN_SACH_TRA (40%) trần NGÀY 'query' của mỗi nick — bộ đếm bot-quyen-ngan-sach.ts (Redis nếu
// có ⇒ khởi động lại không đếm lại từ 0). Nhịp: tối đa NỬA trần burst (query 30/30 s ⇒ 1 lần / 2 s; friend_lookup 15/30 s).
// Đọc lại sau TUOI_DANH_TINH_MS (7 ngày) hoặc khi nick nối lại (danhDauNickKetNoiLaiDanhTinh). Lỗi ⇒ không ghi globalId ⇒
// không nối (đóng an toàn — nhóm vẫn Khách/im).
//
// "Nhiễm": một globalId mà HAI uid khác nhau trên CÙNG một nick mang ⇒ globalId giữ chỗ (vd của nhóm / thực thể không có
// globalId thật — xem contacts/backfill-global-id.ts) ⇒ bỏ khỏi mọi luật nối.
import { prisma } from '../../shared/database/prisma-client.js';
import { runSystemQuery, withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';
import { daDungHomNay, ghiDung, choNhip, _datNganSachChoTest } from './bot-quyen-ngan-sach.js';

export const LO_UID = 50;
export const TUOI_DANH_TINH_MS = 7 * 24 * 60 * 60_000;
export const THU_LAI_LOI_MS = 60 * 60_000;
export const TI_LE_NGAN_SACH_TRA = 0.4;
export const TRAN_TIM_SDT_NGAY = 10;
export const THU_LAI_SDT_MS = 7 * 24 * 60 * 60_000;
/** P3-1: tối đa số uid hỏi lại RIÊNG mỗi lô (uid dùng chung globalId). Còn lại ⇒ bỏ như cũ. */
export const THU_LAI_TOI_DA = 10;
/** Listener: một (nick, uid) ghi hồ sơ nghe được tối đa một lần mỗi khoảng này (RAM). */
export const NGHE_LAI_MS = 6 * 60 * 60_000;

/** Nguồn dòng danh tính. Chỉ ba nguồn TIN ĐƯỢC mới làm bằng chứng + tính là tươi. */
export const NGUON_USER_INFO = 'zalo_user_info';
export const NGUON_FIND_USER = 'zalo_find_user';
export const NGUON_NICK_KET_NOI = 'zalo_nick_ket_noi';
export const NGUON_TIN_DUOC = [NGUON_USER_INFO, NGUON_FIND_USER, NGUON_NICK_KET_NOI] as const;
export function laNguonTinDuoc(n: string | null | undefined): boolean {
  return !!n && (NGUON_TIN_DUOC as readonly string[]).includes(n);
}

/** Loại ngân sách ngày (bot-quyen-ngan-sach.ts) của vòng danh tính. */
const NS_QUERY = 'dt_query';
const NS_SDT = 'dt_sdt';

export interface HoSoZalo {
  globalId: string | null;
  ten: string | null;
  /** phoneNumber (chỉ lưu cho dòng nick tự nhìn mình). */
  sdt?: string | null;
  /**
   * Zalo CÓ trả uid này nhưng không dùng được (globalId null): `uid_lech` — `userId` của hồ sơ ≠ uid hỏi (User.ts:5);
   * `khong_doi` — uid nằm trong `unchanged_profiles` (không mang globalId).
   */
  loi?: 'uid_lech' | 'khong_doi';
}

/** Cổng Zalo (tiêm được — test thay bằng bản giả trả số thật đo trên staging). */
export interface ZaloDanhTinhApi {
  /** getUserInfo qua nick `nickId` cho ≤ LO_UID uid. uid không có trong kết quả ⇒ vắng khỏi Map. */
  thongTin(nickId: string, uids: string[]): Promise<Map<string, HoSoZalo>>;
  /** findUser(sđt) qua nick `nickId` ⇒ uid NHÌN TỪ nick đó + globalId (null = không có tài khoản). */
  timSdt(nickId: string, sdt: string): Promise<{ uid: string; globalId: string | null; ten: string | null } | null>;
}

/** globalId sạch: chuỗi, bỏ khoảng trắng; rỗng / '0' ⇒ null. THUẦN. */
export function sachGlobalId(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s && s !== '0' && s !== 'null' && s !== 'undefined' ? s : null;
}

/** Bỏ đuôi phiên bản hồ sơ "_<n>" (zca-js gửi "<uid>_0" trong friend_pversion_map — getUserInfo.ts:30-35). THUẦN. */
export function uidTron(x: unknown): string {
  return String(x ?? '').trim().replace(/_\d+$/, '');
}

/**
 * Bóc kết quả zca-js getUserInfo — `{ changed_profiles, unchanged_profiles, phonebook_version }` (getUserInfo.ts:8-12), khoá
 * "<uid>" hoặc "<uid>_0". THUẦN.
 *   • CHỈ `changed_profiles`. Kết quả getGroupMembersInfo (`profiles`) KHÔNG BAO GIỜ được đọc ở đây (D1).
 *   • `userId` của hồ sơ (User.ts:5) có mà ≠ uid hỏi ⇒ `loi: 'uid_lech'`, không nhận globalId.
 *   • uid trong `unchanged_profiles` ⇒ `loi: 'khong_doi'` (Zalo không gửi lại hồ sơ, không có globalId).
 */
export function bocThongTin(kq: unknown, uids: readonly string[]): Map<string, HoSoZalo> {
  const ra = new Map<string, HoSoZalo>();
  const k = kq as { changed_profiles?: Record<string, Record<string, unknown>>; unchanged_profiles?: Record<string, unknown> } | null;
  const p = k?.changed_profiles ?? {};
  const khongDoi = k?.unchanged_profiles ?? {};
  for (const u of uids) {
    const h = p[u] ?? p[`${u}_0`];
    if (!h) {
      if (khongDoi[u] ?? khongDoi[`${u}_0`]) ra.set(u, { globalId: null, ten: null, sdt: null, loi: 'khong_doi' });
      continue;
    }
    const id = h.userId === undefined || h.userId === null || h.userId === '' ? null : uidTron(h.userId);
    if (id && id !== uidTron(u)) { ra.set(u, { globalId: null, ten: null, sdt: null, loi: 'uid_lech' }); continue; }
    ra.set(u, {
      globalId: sachGlobalId(h.globalId),
      ten: String(h.zaloName ?? h.zalo_name ?? h.displayName ?? h.display_name ?? '').trim() || null,
      sdt: chuanSdt(String(h.phoneNumber ?? '')),
    });
  }
  return ra;
}

export type LyDoBo = 'gid_cua_nick_goi' | 'lo_trung_gid';

export interface KetQuaLoc {
  /** Hồ sơ nhận (đã bỏ phần bị rào, chưa gồm `thuLai`). */
  hoSo: Map<string, HoSoZalo>;
  /** uid DÙNG CHUNG một globalId với uid khác trong lô ⇒ hỏi lại RIÊNG từng uid (P3-1) rồi `locSauThuLai`. */
  thuLai: string[];
  /** uid → lý do bị bỏ. */
  bo: Map<string, LyDoBo>;
}

/** globalId của chính nick gọi: `gidNick` nếu có, không thì lấy từ hồ sơ uid của nick (nếu có trong lô). THUẦN. */
function gidNickTu(hoSo: ReadonlyMap<string, HoSoZalo>, o: { uidNick: string | null; gidNick: string | null }): string | null {
  return o.gidNick ?? (o.uidNick ? hoSo.get(o.uidNick)?.globalId ?? null : null);
}

/**
 * RÀO D1 (giám sát LIVE 30/09) — THUẦN. `uidNick`/`gidNick` = uid + globalId của CHÍNH nick gọi.
 *   • uid ≠ uid của nick mà globalId = globalId của nick ⇒ bỏ (`gid_cua_nick_goi`) — không cần hỏi lại;
 *   • globalId mà ≥ 2 uid trong lô cùng mang (một người chỉ có MỘT uid ở một nick ⇒ globalId giữ chỗ / Zalo trả nhầm) ⇒
 *     CHỈ các uid đó vào `thuLai` (P3-1 — bản trước bỏ CẢ lô, mất luôn hồ sơ tốt của uid khác).
 */
export function locLoHoSo(
  lo: readonly string[], hoSo: ReadonlyMap<string, HoSoZalo>, o: { uidNick: string | null; gidNick: string | null },
): KetQuaLoc {
  const bo = new Map<string, LyDoBo>();
  const gidNick = gidNickTu(hoSo, o);
  const con = new Map<string, HoSoZalo>();
  for (const u of lo) {
    const h = hoSo.get(u);
    if (!h) continue;
    if (gidNick && h.globalId === gidNick && u !== o.uidNick) { bo.set(u, 'gid_cua_nick_goi'); continue; }
    con.set(u, h);
  }
  const theoGid = new Map<string, string[]>();
  for (const [u, h] of con) if (h.globalId) theoGid.set(h.globalId, [...(theoGid.get(h.globalId) ?? []), u]);
  const thuLai = [...theoGid.values()].filter((us) => us.length > 1).flat();
  for (const u of thuLai) con.delete(u);
  return { hoSo: con, thuLai, bo };
}

/**
 * Sau khi hỏi lại RIÊNG từng uid của `thuLai` — THUẦN. Nhận uid có globalId riêng; uid vẫn mang globalId của nick gọi ⇒
 * `gid_cua_nick_goi`; uid mà globalId vẫn trùng một uid khác (trong các lần hỏi riêng HOẶC uid đã nhận của lô) ⇒
 * `lo_trung_gid`. uid Zalo không trả lần hỏi riêng ⇒ vắng (người gọi ghi `khong_tra`).
 */
export function locSauThuLai(
  thuLai: readonly string[], rieng: ReadonlyMap<string, HoSoZalo>, daNhan: ReadonlyMap<string, HoSoZalo>,
  o: { uidNick: string | null; gidNick: string | null },
): { hoSo: Map<string, HoSoZalo>; bo: Map<string, LyDoBo> } {
  const bo = new Map<string, LyDoBo>();
  const gidNick = gidNickTu(daNhan, o);
  const dem = new Map<string, number>();
  for (const h of daNhan.values()) if (h.globalId) dem.set(h.globalId, (dem.get(h.globalId) ?? 0) + 1);
  for (const u of thuLai) {
    const g = rieng.get(u)?.globalId;
    if (g) dem.set(g, (dem.get(g) ?? 0) + 1);
  }
  const hoSo = new Map<string, HoSoZalo>();
  for (const u of thuLai) {
    const h = rieng.get(u);
    if (!h) continue;
    if (gidNick && h.globalId === gidNick && u !== o.uidNick) { bo.set(u, 'gid_cua_nick_goi'); continue; }
    if (h.globalId && (dem.get(h.globalId) ?? 0) > 1) { bo.set(u, 'lo_trung_gid'); continue; }
    hoSo.set(u, h);
  }
  return { hoSo, bo };
}

/** API zca-js của MỘT nick — đúng chữ ký zca-js 2.1.2 (getUserInfo.ts:25, findUser.ts:19). */
export interface ZcaDanhTinh {
  getUserInfo(userId: string | string[]): Promise<unknown>;
  findUser(phoneNumber: string): Promise<unknown>;
}

/**
 * Cổng danh tính dựng trên API zca-js (tiêm được: test đưa zca-js giả CÙNG HÌNH — tests/helpers/zca-gia.ts).
 *   thongTin: getUserInfo(uid TRƠN[]) — zca-js tự thêm "_0" (phiên bản hồ sơ), KHÔNG tự thêm ở đây.
 *   timSdt:   findUser(sđt) ⇒ UserBasic { uid (theo nick gọi), globalId, zalo_name, display_name } (User.ts:37-49).
 */
export function taoApiTuZca(layApi: (nickId: string) => ZcaDanhTinh): ZaloDanhTinhApi {
  return {
    async thongTin(nickId, uids) {
      return bocThongTin(await layApi(nickId).getUserInfo([...uids]), uids);
    },
    async timSdt(nickId, sdt) {
      const f = (await layApi(nickId).findUser(sdt)) as { uid?: unknown; globalId?: unknown; zalo_name?: unknown; display_name?: unknown } | null | undefined;
      if (!f?.uid) return null;
      return { uid: uidTron(f.uid), globalId: sachGlobalId(f.globalId), ten: String(f.display_name ?? f.zalo_name ?? '').trim() || null };
    },
  };
}

/** Đường thật: zaloOps (rate limiter + sdk-limit-service: getUserInfo = 'query', findUser = 'friend_lookup'). */
const apiMacDinh: ZaloDanhTinhApi = taoApiTuZca((nickId) => ({
  async getUserInfo(userId) {
    const { zaloOps } = await import('../../shared/zalo-operations.js');
    return zaloOps.getUserInfo(nickId, userId as unknown as string);
  },
  async findUser(phoneNumber) {
    const { zaloOps } = await import('../../shared/zalo-operations.js');
    return zaloOps.findUser(nickId, phoneNumber);
  },
}));

type LoaiNhip = 'query' | 'friend_lookup';
const BURST_MAC_DINH: Record<LoaiNhip, { burst: number; burstWindowMs: number }> = {
  query: { burst: 30, burstWindowMs: 30_000 }, friend_lookup: { burst: 15, burstWindowMs: 30_000 },
};
/** Chờ nhịp nửa-burst của nick cho loại lời gọi (trần hiệu lực của nick, như rate limiter). */
const nhipThat = async (nick: string, loai: LoaiNhip): Promise<void> => {
  let t = BURST_MAC_DINH[loai];
  try {
    const { getEffectiveLimit } = await import('../zalo/sdk-limit-service.js');
    t = await getEffectiveLimit(nick, loai);
  } catch { /* trần mặc định */ }
  await choNhip(nick, loai, t.burst, t.burstWindowMs);
};
const tranThat = async (nick: string): Promise<number> => {
  const { getEffectiveLimit } = await import('../zalo/sdk-limit-service.js');
  return Math.max(1, Math.floor((await getEffectiveLimit(nick, 'query')).daily * TI_LE_NGAN_SACH_TRA));
};

let api: ZaloDanhTinhApi = apiMacDinh;
let moiNick = false;
let nickDungTest: string[] | null = null;
let layTran: (nick: string) => Promise<number> = tranThat;
let nhip: (nick: string, loai: LoaiNhip) => Promise<void> = nhipThat;
const daTimSdt = new Map<string, number>();
/** `${nick}|${uid}` → lần cuối ghi hồ sơ nghe được từ listener (ghiHoSoTuTinDen). */
const daNghe = new Map<string, number>();

/**
 * Chỉ cho test: cổng Zalo giả (null = thật) + dùng MỌI nick (kể cả không 'connected'), ngân sách ngày (null = thật), nhịp
 * (mặc định: cổng giả ⇒ không chờ; null = thật). Luôn xoá bộ đếm ngày của vòng danh tính.
 */
export function _datZaloDanhTinhChoTest(
  a: ZaloDanhTinhApi | null,
  o: { tranNgay?: number | null; nickDung?: string[] | null; nhip?: ((nick: string, loai: LoaiNhip) => Promise<void>) | null } = {},
): void {
  api = a ?? apiMacDinh;
  moiNick = !!a;
  nickDungTest = o.nickDung ?? null;
  if (o.tranNgay !== undefined) layTran = o.tranNgay === null ? tranThat : async () => o.tranNgay as number;
  nhip = o.nhip !== undefined ? (o.nhip ?? nhipThat) : a ? async () => undefined : nhipThat;
  // P3-2: xoá CẢ bộ đếm ngày (dt_query / dt_sdt) LẪN mốc nhịp (query / friend_lookup — tên khác nhau).
  _datNganSachChoTest({ loai: [NS_QUERY, NS_SDT], nhip: ['query', 'friend_lookup'] });
  daTimSdt.clear();
  daNghe.clear();
}

export interface KetQuaLay {
  /** Số nick đã đọc. */
  nick: number;
  /** Số lần gọi getUserInfo (gồm `thuLai`). */
  goi: number;
  /** Số lần gọi getUserInfo hỏi lại RIÊNG một uid dùng chung globalId (P3-1). */
  thuLai: number;
  /** Số nick hết ngân sách ngày trước khi đọc xong. */
  hetNganSach: number;
  /** Số uid đã ghi (có hoặc không có globalId). */
  uid: number;
  /** Số lần findUser. */
  timSdt: number;
  /** Số lô hỏng (lỗi Zalo / hết giờ / lô bị rào D1) — không ghi globalId cho lô đó. */
  loi: number;
  /** Số uid bị rào D1 bỏ (globalId của chính nick gọi / lô trùng globalId). */
  boRao: number;
}

type Dong = { zaloUid: string; globalId: string | null; layLuc: Date; loi: string | null; nguon: string };

/**
 * Giai đoạn MẠNG: đọc globalId sống cho uid cần của MỌI nick dùng được của org (theo ngân sách), ghi bảng hệ thống.
 * Thứ tự ưu tiên mỗi nick Y: uid của chính Y → uid nhân viên thấy ở Y → thành viên nhóm của Y (bản đọc danh sách) → người
 * gửi trong nhóm của Y — TẤT CẢ bằng getUserInfo (không bao giờ getGroupMembersInfo — D1). Rồi findUser(sđt) cho nick X /
 * nhân viên có sđt mà Y chưa thấy. Không bao giờ ném.
 */
export async function layDanhTinhZalo(orgId: string): Promise<KetQuaLay> {
  const kq: KetQuaLay = { nick: 0, goi: 0, thuLai: 0, hetNganSach: 0, uid: 0, timSdt: 0, loi: 0, boRao: 0 };
  const batDau = Date.now();
  try {
    await withTenant(orgId, async () => {
      const nicks = await prisma.zaloAccount.findMany({
        where: {
          orgId, zaloUid: { not: null }, archivedAt: null,
          ...(nickDungTest ? { id: { in: nickDungTest } } : moiNick ? {} : { status: 'connected' }),
        },
        select: { id: true, zaloUid: true, phone: true },
        orderBy: { id: 'asc' },
      });
      if (nicks.length === 0) return;
      // Mọi nick của org (kể cả đã lưu trữ / đang tắt): hồ sơ sống của nick X để tìm X từ nick khác.
      const tatCaNick = await prisma.zaloAccount.findMany({
        where: { orgId, zaloUid: { not: null } }, select: { id: true, zaloUid: true },
      });
      const nvUid = await prisma.botNhanVienUid.findMany({
        where: { orgId, nguon: { in: ['chon', 'chu_xac_nhan', 'zalo_global_id'] } },
        select: { zaloUid: true, zaloAccountId: true, nhanVienId: true },
      });
      // SĐT nhân viên: ô SĐT của trang Quyền bot + SĐT tài khoản CRM liên kết (cơ chế thông báo hệ thống).
      const nvSdt = await sdtNhanVien(orgId);
      const bayGio = Date.now();
      for (const y of nicks) {
        kq.nick++;
        const uidY = y.zaloUid!;
        const coSan = new Map<string, Dong>((await prisma.botQuyenDanhTinh.findMany({
          where: { orgId, zaloAccountId: y.id },
          select: { zaloUid: true, globalId: true, layLuc: true, loi: true, nguon: true },
        })).map((r) => [r.zaloUid, r]));
        const gidTinDuoc = (u: string): string | null => {
          const r = coSan.get(u);
          return r && laNguonTinDuoc(r.nguon) ? sachGlobalId(r.globalId) : null;
        };
        // Tươi CHỈ khi nguồn tin được (dòng 'zalo_api' cũ ⇒ đọc lại ngay).
        const canDoc = (u: string) => {
          const r = coSan.get(u);
          if (!r || !laNguonTinDuoc(r.nguon)) return true;
          if (u === uidY) return !gidTinDuoc(u); // globalId của chính nick không đổi; chưa có ⇒ đọc (cần cho rào D1)
          if (r.loi) return bayGio - r.layLuc.getTime() > THU_LAI_LOI_MS;
          return bayGio - r.layLuc.getTime() > TUOI_DANH_TINH_MS;
        };
        // Mã NHÓM của nick này — không bao giờ hỏi getUserInfo trên mã nhóm (Zalo trả globalId giữ chỗ).
        const maNhom = new Set((await prisma.conversation.findMany({
          where: { orgId, zaloAccountId: y.id, threadType: 'group', externalThreadId: { not: null } }, select: { externalThreadId: true },
        })).map((c) => c.externalThreadId!));
        const muon: string[] = [];
        const them = (u: string | null | undefined) => {
          if (u && !maNhom.has(u) && !muon.includes(u) && canDoc(u)) muon.push(u);
        };
        /** Ghi một uid. D3: không bao giờ hạ globalId TIN ĐƯỢC đã có về null — giữ cũ, ghi `loi`. */
        const ghi = async (u: string, h: HoSoZalo | undefined, loiRao?: string) => {
          const cu = gidTinDuoc(u);
          const loi = loiRao ?? h?.loi ?? (h ? (h.globalId ? null : (cu ? 'gid_rong' : null)) : 'khong_tra');
          const khoa = { orgId_zaloAccountId_zaloUid: { orgId, zaloAccountId: y.id, zaloUid: u } };
          const luc = new Date();
          if (cu && !(h?.globalId && !loiRao && !h.loi)) {
            await prisma.botQuyenDanhTinh.update({ where: khoa, data: { layLuc: luc, loi } });
            coSan.set(u, { ...coSan.get(u)!, layLuc: luc, loi });
          } else {
            const g = loiRao || h?.loi ? null : h?.globalId ?? null;
            const data = {
              globalId: g, ten: loiRao ? null : h?.ten ?? null, nguon: NGUON_USER_INFO, layLuc: luc, loi,
              // SĐT CHỈ của chính nick (tìm lại nick này từ nick khác khi nó tắt) — không lưu SĐT người khác.
              soDienThoai: u === uidY && !loiRao ? (h?.sdt ?? null) : null,
            };
            await prisma.botQuyenDanhTinh.upsert({ where: khoa, create: { orgId, zaloAccountId: y.id, zaloUid: u, ...data }, update: data });
            coSan.set(u, { zaloUid: u, globalId: g, layLuc: luc, loi, nguon: NGUON_USER_INFO });
          }
          kq.uid++;
        };
        // getUserInfo: chính nick TRƯỚC (lô đầu — globalId của nick là mốc cho rào D1), uid NV thấy ở nick này, thành
        // viên nhóm (bản đọc danh sách — chỉ lấy uid), người gửi trong nhóm.
        them(uidY);
        for (const r of nvUid) if (r.zaloAccountId === y.id) them(r.zaloUid);
        const ds = await prisma.botNhomDanhSach.findMany({
          where: { orgId, zaloAccountId: y.id }, select: { uids: true }, orderBy: { conversationId: 'asc' },
        });
        for (const u of new Set(ds.flatMap((d) => d.uids))) them(u);
        const nguoiGui = await prisma.$queryRaw<Array<{ uid: string }>>`
          SELECT DISTINCT m.sender_uid AS uid FROM conversations c JOIN messages m ON m.conversation_id = c.id
          WHERE c.org_id = ${orgId} AND c.zalo_account_id = ${y.id} AND c."threadType" = 'group' AND c.is_virtual = false
            AND m.is_local = false AND m.sender_uid IS NOT NULL AND m.sender_uid <> ''
            AND m.sent_at > now() - interval '90 days'
          LIMIT 2000`.catch(() => []);
        for (const r of nguoiGui) them(r.uid);

        const tran = await layTran(y.id).catch(() => 1);
        /** Một lời gọi getUserInfo có ngân sách + nhịp. `null` = hết ngân sách (không gọi). Ném = lỗi Zalo. */
        const hoi = async (uids: string[]): Promise<Map<string, HoSoZalo> | null> => {
          if (await daDungHomNay(y.id, NS_QUERY) >= tran) return null;
          await nhip(y.id, 'query');
          await ghiDung(y.id, NS_QUERY);
          kq.goi++;
          return api.thongTin(y.id, uids);
        };
        let het = false;
        for (let i = 0; i < muon.length && !het; i += LO_UID) {
          const lo = muon.slice(i, i + LO_UID);
          let hoSo: Map<string, HoSoZalo> | null;
          try {
            hoSo = await hoi(lo);
          } catch (err) {
            kq.loi++;
            logger.warn(`[bot-quyen-danh-tinh] getUserInfo qua nick ${y.id} lỗi — không ghi (đóng an toàn):`, err instanceof Error ? err.message : err);
            continue;
          }
          if (!hoSo) { het = true; kq.hetNganSach++; break; }
          const rao = { uidNick: uidY, gidNick: gidTinDuoc(uidY) };
          const loc = locLoHoSo(lo, hoSo, rao);
          const bo = new Map(loc.bo);
          const nhan = new Map(loc.hoSo);
          // P3-1: uid dùng chung globalId ⇒ hỏi lại RIÊNG từng uid (tối đa THU_LAI_TOI_DA mỗi lô, trong ngân sách); hết lượt
          // / hết ngân sách / lỗi ⇒ uid đó bỏ (`lo_trung_gid`) — không bao giờ nhận globalId đang bị nghi.
          if (loc.thuLai.length > 0) {
            const rieng = new Map<string, HoSoZalo>();
            for (const [j, u] of loc.thuLai.entries()) {
              if (j >= THU_LAI_TOI_DA) break;
              try {
                const r = await hoi([u]);
                if (!r) { het = true; kq.hetNganSach++; break; }
                kq.thuLai++;
                const h = r.get(u);
                if (h) rieng.set(u, h);
              } catch (err) {
                kq.loi++;
                logger.warn(`[bot-quyen-danh-tinh] getUserInfo hỏi lại uid qua nick ${y.id} lỗi:`, err instanceof Error ? err.message : err);
              }
            }
            const sau = locSauThuLai(loc.thuLai.filter((u) => rieng.has(u)), rieng, nhan, rao);
            for (const [u, h] of sau.hoSo) nhan.set(u, h);
            for (const [u, l] of sau.bo) bo.set(u, l);
            for (const u of loc.thuLai) if (!nhan.has(u) && !bo.has(u)) bo.set(u, 'lo_trung_gid');
            const conBo = loc.thuLai.filter((u) => bo.get(u) === 'lo_trung_gid').length;
            if (conBo > 0) logger.warn(`[bot-quyen-danh-tinh] nick ${y.id}: ${conBo} uid vẫn dùng chung globalId sau khi hỏi riêng — bỏ các uid đó (rào D1)`);
          }
          kq.boRao += bo.size;
          for (const u of lo) await ghi(u, nhan.get(u), bo.get(u));
        }

        // findUser(sđt): nick X khác (hồ sơ SỐNG của X đã lưu: globalId + SĐT thật) mà Y chưa thấy uid nào mang globalId
        // đó; nhân viên có SĐT mà chưa có uid nào ở nick Y.
        const hoSoNick = new Map<string, { gid: string | null; sdt: string | null }>();
        for (const x of tatCaNick) {
          const r = await prisma.botQuyenDanhTinh.findFirst({
            where: { orgId, zaloAccountId: x.id, zaloUid: x.zaloUid!, nguon: { in: [...NGUON_TIN_DUOC] } },
            select: { globalId: true, soDienThoai: true },
          });
          if (r) hoSoNick.set(x.id, { gid: sachGlobalId(r.globalId), sdt: r.soDienThoai });
        }
        const gidY = gidTinDuoc(uidY);
        const gidThayTuY = new Set([...coSan.entries()]
          .filter(([u, r]) => laNguonTinDuoc(r.nguon) && r.globalId && !(r.globalId === gidY && u !== uidY))
          .map(([, r]) => r.globalId!));
        const sdtCanTim: string[] = [];
        for (const x of tatCaNick) {
          const h = hoSoNick.get(x.id);
          if (x.id === y.id || !h?.sdt || !h.gid || gidThayTuY.has(h.gid)) continue;
          sdtCanTim.push(h.sdt);
        }
        const nvCoUidY = new Set(nvUid.filter((r) => r.zaloAccountId === y.id).map((r) => r.nhanVienId));
        for (const n of nvSdt) if (!nvCoUidY.has(n.id)) for (const so of n.sdt) sdtCanTim.push(so);
        for (const sdt of [...new Set(sdtCanTim)]) {
          const khoaSdt = `${y.id}|${sdt}`;
          if (bayGio - (daTimSdt.get(khoaSdt) ?? 0) < THU_LAI_SDT_MS) continue;
          // Đã tra trong 7 ngày (dòng DB sống qua khởi động lại) ⇒ bỏ.
          const daTra = await prisma.botQuyenDanhTinh.findFirst({
            where: { orgId, zaloAccountId: y.id, timTheoSdt: sdt, layLuc: { gt: new Date(bayGio - THU_LAI_SDT_MS) } }, select: { id: true },
          });
          if (daTra) { daTimSdt.set(khoaSdt, bayGio); continue; }
          if (await daDungHomNay(y.id, NS_SDT) >= TRAN_TIM_SDT_NGAY) break;
          daTimSdt.set(khoaSdt, bayGio);
          await nhip(y.id, 'friend_lookup');
          await ghiDung(y.id, NS_SDT);
          kq.timSdt++;
          try {
            const f = await api.timSdt(y.id, sdt);
            if (!f?.uid) continue;
            if (f.uid === uidY || (gidY && f.globalId === gidY)) {
              kq.boRao++;
              logger.warn(`[bot-quyen-danh-tinh] findUser qua nick ${y.id} ra chính nick gọi (uid ${f.uid}) — bỏ (rào D1)`);
              continue;
            }
            const khoa = { orgId_zaloAccountId_zaloUid: { orgId, zaloAccountId: y.id, zaloUid: f.uid } };
            const cu = gidTinDuoc(f.uid);
            if (cu && !f.globalId) {
              await prisma.botQuyenDanhTinh.update({ where: khoa, data: { layLuc: new Date(), loi: 'gid_rong', timTheoSdt: sdt } });
            } else {
              const data = { globalId: f.globalId, ten: f.ten, nguon: NGUON_FIND_USER, layLuc: new Date(), loi: null, timTheoSdt: sdt };
              await prisma.botQuyenDanhTinh.upsert({ where: khoa, create: { orgId, zaloAccountId: y.id, zaloUid: f.uid, ...data }, update: data });
            }
            kq.uid++;
          } catch (err) {
            kq.loi++;
            logger.warn(`[bot-quyen-danh-tinh] findUser qua nick ${y.id} lỗi — bỏ qua:`, err instanceof Error ? err.message : err);
          }
        }
      }
    });
  } catch (err) {
    kq.loi++;
    logger.warn(`[bot-quyen-danh-tinh] đọc danh tính org ${orgId} lỗi:`, err);
  }
  // P3-3: MỘT dòng INFO mỗi vòng (đếm), để giám sát thấy vòng có chạy / tốn bao nhiêu mà không phải bật debug.
  if (kq.nick > 0 || kq.loi > 0) {
    logger.info(`[bot-quyen-danh-tinh] org ${orgId}: vòng danh tính — nick=${kq.nick} getUserInfo=${kq.goi} (hỏi lại riêng=${kq.thuLai}) `
      + `uid=${kq.uid} findUser=${kq.timSdt} rào=${kq.boRao} lỗi=${kq.loi} hết_ngân_sách=${kq.hetNganSach} ${Date.now() - batDau}ms`);
  }
  return kq;
}

/** SĐT chuẩn hoá 84xxxxxxxxx (bỏ khoảng trắng / + / 0 đầu). Sai ⇒ null. THUẦN. */
export function chuanSdt(x: string | null | undefined): string | null {
  const s = String(x ?? '').replace(/[\s.\-()]/g, '');
  if (!/^(0|\+?84)\d{8,10}$/.test(s)) return null;
  return s.replace(/^\+?84/, '84').replace(/^0/, '84');
}

/** NV → mọi SĐT (ô SĐT trang Quyền bot + User.phone của tài khoản CRM liên kết), đã chuẩn hoá. */
export async function sdtNhanVien(orgId: string): Promise<Array<{ id: string; tenGoi: string; tenUser: string | null; sdt: string[] }>> {
  const ds = await prisma.botNhanVien.findMany({
    where: { orgId, OR: [{ soDienThoai: { not: null } }, { userId: { not: null } }] },
    select: { id: true, tenGoi: true, soDienThoai: true, user: { select: { phone: true, fullName: true } } },
  });
  return ds.map((n) => ({
    id: n.id, tenGoi: n.tenGoi, tenUser: n.user?.fullName ?? null,
    sdt: [...new Set([chuanSdt(n.soDienThoai), chuanSdt(n.user?.phone)].filter((x): x is string => !!x))],
  })).filter((n) => n.sdt.length > 0);
}


/**
 * Lúc nick nối (zalo-pool đã gọi getUserInfo(ownId)): lưu globalId + SĐT thật của CHÍNH nick vào bảng hệ thống. Không
 * gọi thêm Zalo. globalId tin được đã có mà hồ sơ lần này không có ⇒ giữ cũ (D3). Không bao giờ ném.
 */
export async function ghiHoSoNickKetNoi(zaloAccountId: string, ownId: string, profile: Record<string, unknown> | null | undefined): Promise<void> {
  try {
    if (!ownId || !profile) return;
    const nick = await runSystemQuery(() => prisma.zaloAccount.findUnique({ where: { id: zaloAccountId }, select: { orgId: true } }));
    if (!nick) return;
    const h = bocThongTin({ changed_profiles: { [ownId]: profile } }, [ownId]).get(ownId);
    if (!h) return;
    await withTenant(nick.orgId, async () => {
      const khoa = { orgId_zaloAccountId_zaloUid: { orgId: nick.orgId, zaloAccountId, zaloUid: ownId } };
      const cu = await prisma.botQuyenDanhTinh.findUnique({ where: khoa, select: { globalId: true, nguon: true } });
      if (!h.globalId && cu && laNguonTinDuoc(cu.nguon) && sachGlobalId(cu.globalId)) {
        await prisma.botQuyenDanhTinh.update({
          where: khoa, data: { layLuc: new Date(), loi: 'gid_rong', ...(h.sdt ? { soDienThoai: h.sdt } : {}) },
        });
        return;
      }
      await prisma.botQuyenDanhTinh.upsert({
        where: khoa,
        create: { orgId: nick.orgId, zaloAccountId, zaloUid: ownId, globalId: h.globalId, ten: h.ten, soDienThoai: h.sdt ?? null, nguon: NGUON_NICK_KET_NOI },
        update: { globalId: h.globalId, ten: h.ten, soDienThoai: h.sdt ?? null, nguon: NGUON_NICK_KET_NOI, layLuc: new Date(), loi: null },
      });
    });
  } catch (err) {
    logger.warn(`[bot-quyen-danh-tinh] lưu hồ sơ nick ${zaloAccountId} lúc nối lỗi:`, err instanceof Error ? err.message : err);
  }
}

export type KetQuaNghe = 'ghi' | 'bo' | 'trung';

/**
 * Listener (tin NHÓM của người khác): `resolveZaloName` ĐÃ gọi getUserInfo(uidFrom) qua CHÍNH nick nhận (zalo-listener-factory)
 * — lưu globalId đó vào bảng hệ thống, KHÔNG gọi thêm Zalo, không tốn ngân sách. Trước đây CRM vứt globalId của tin nhóm
 * (chỉ tin 1-1 vào contact) ⇒ người chỉ nói trong nhóm (NV, nick CRM khác) chỉ được nhận ra khi vòng 30 phút kịp đọc lúc nick
 * còn nối. Nay: nick nào đang nối mà nghe một người nói là có globalId của người đó THEO nick đó, ngay lúc ấy.
 * Rào (đóng an toàn — mọi nhánh lạ ⇒ không ghi):
 *   • uid = uid của chính nick / mã nhóm của nick ⇒ bỏ; hồ sơ có `userId` ≠ uid ⇒ bỏ (bocThongTin);
 *   • chưa biết globalId tin được của chính nick (chưa lưu lúc nối) ⇒ bỏ (không kiểm được rào D1);
 *   • globalId = globalId của chính nick ⇒ bỏ (D1);
 *   • globalId rỗng ⇒ không ghi gì (D3: không hạ globalId tin được về null).
 * Mỗi (nick, uid) tối đa một lần / NGHE_LAI_MS (RAM). Không bao giờ ném.
 */
export async function ghiHoSoTuTinDen(
  zaloAccountId: string, uid: string, profile: Record<string, unknown> | null | undefined,
): Promise<KetQuaNghe> {
  try {
    const u = uidTron(uid);
    if (!u || !profile) return 'bo';
    const h = bocThongTin({ changed_profiles: { [u]: profile } }, [u]).get(u);
    if (!h || h.loi || !h.globalId) return 'bo';
    const khoaNghe = `${zaloAccountId}|${u}`;
    const bay = Date.now();
    if (bay - (daNghe.get(khoaNghe) ?? 0) < NGHE_LAI_MS) return 'trung';
    daNghe.set(khoaNghe, bay);
    const nick = await runSystemQuery(() => prisma.zaloAccount.findUnique({
      where: { id: zaloAccountId }, select: { orgId: true, zaloUid: true },
    }));
    if (!nick?.zaloUid || nick.zaloUid === u) return 'bo';
    return await withTenant(nick.orgId, async () => {
      const orgId = nick.orgId;
      const laNhom = await prisma.conversation.findFirst({
        where: { orgId, zaloAccountId, threadType: 'group', externalThreadId: u }, select: { id: true },
      });
      if (laNhom) return 'bo';
      const tuNhin = await prisma.botQuyenDanhTinh.findUnique({
        where: { orgId_zaloAccountId_zaloUid: { orgId, zaloAccountId, zaloUid: nick.zaloUid! } },
        select: { globalId: true, nguon: true },
      });
      const gidNick = tuNhin && laNguonTinDuoc(tuNhin.nguon) ? sachGlobalId(tuNhin.globalId) : null;
      // Chưa biết globalId của chính nick (hồ sơ lúc nối ghi bất đồng bộ) ⇒ bỏ lần này, cho phép thử lại ở tin sau.
      if (!gidNick) { daNghe.delete(khoaNghe); return 'bo'; }
      if (h.globalId === gidNick) return 'bo';
      const khoa = { orgId_zaloAccountId_zaloUid: { orgId, zaloAccountId, zaloUid: u } };
      const data = { globalId: h.globalId, ten: h.ten, nguon: NGUON_USER_INFO, layLuc: new Date(), loi: null, soDienThoai: null };
      await prisma.botQuyenDanhTinh.upsert({ where: khoa, create: { orgId, zaloAccountId, zaloUid: u, ...data }, update: data });
      return 'ghi' as const;
    });
  } catch (err) {
    logger.warn(`[bot-quyen-danh-tinh] lưu hồ sơ nghe được (nick ${zaloAccountId}) lỗi:`, err instanceof Error ? err.message : err);
    return 'bo';
  }
}

/** Nick vừa nối lại ⇒ đọc lại danh tính người khác nhìn từ nick đó ở vòng kế (globalId của chính nick giữ). */
export async function danhDauNickKetNoiLaiDanhTinh(orgId: string, zaloAccountId: string): Promise<void> {
  await withTenant(orgId, async () => {
    const nick = await prisma.zaloAccount.findFirst({ where: { id: zaloAccountId, orgId }, select: { zaloUid: true } });
    await prisma.botQuyenDanhTinh.updateMany({
      where: { orgId, zaloAccountId, ...(nick?.zaloUid ? { zaloUid: { not: nick.zaloUid } } : {}) },
      data: { layLuc: new Date(0) },
    });
  });
}

/** Bản đọc danh tính của org (chỉ DB). */
export interface BanDanhTinh {
  /** `${nick}|${uid}` → globalId sạch (null = không có / nhiễm / lệch / globalId của chính nick nhìn). */
  gid: (nick: string | null, uid: string) => string | null;
  /** globalId → mọi {nick, uid} mang nó (đã bỏ nhiễm). */
  theoGid: Map<string, Array<{ nick: string; uid: string; layLuc: Date }>>;
  /** globalId bị nhiễm. */
  nhiem: Set<string>;
  /** `${nick}|${uid}` → lúc đọc. */
  layLuc: (nick: string, uid: string) => Date | null;
}

/**
 * Đọc bảng danh tính của org (CHỈ dòng nguồn tin được) + luật nhiễm. THUẦN phần tính (`dungBanDanhTinh`). uid không biết
 * nick (`nick` null) ⇒ lấy globalId nếu MỌI dòng của uid đó (mọi nick) đồng ý.
 */
export async function docBanDanhTinh(orgId: string): Promise<BanDanhTinh> {
  const [rows, nicks] = await Promise.all([
    prisma.botQuyenDanhTinh.findMany({
      where: { orgId, nguon: { in: [...NGUON_TIN_DUOC] } },
      select: { zaloAccountId: true, zaloUid: true, globalId: true, layLuc: true },
    }),
    prisma.zaloAccount.findMany({ where: { orgId, zaloUid: { not: null } }, select: { id: true, zaloUid: true } }),
  ]);
  return dungBanDanhTinh(rows, new Map(nicks.map((n) => [n.id, n.zaloUid!])));
}

/**
 * `tuNhin` (nick → uid tự nhìn): dòng (nick Y, uid ≠ uid của Y) mang globalId CỦA CHÍNH Y là dòng hỏng (D1 — Zalo trả
 * globalId của nick gọi) ⇒ coi như không có globalId, KHÔNG làm nhiễm globalId của Y (Y vẫn nhận ra được ở nick khác).
 */
export function dungBanDanhTinh(
  rows: ReadonlyArray<{ zaloAccountId: string; zaloUid: string; globalId: string | null; layLuc: Date }>,
  tuNhin: ReadonlyMap<string, string> = new Map(),
): BanDanhTinh {
  const gidNick = new Map<string, string>();
  for (const r of rows) {
    const g = sachGlobalId(r.globalId);
    if (g && tuNhin.get(r.zaloAccountId) === r.zaloUid) gidNick.set(r.zaloAccountId, g);
  }
  const sach = (r: { zaloAccountId: string; zaloUid: string; globalId: string | null }): string | null => {
    const g = sachGlobalId(r.globalId);
    if (!g) return null;
    return gidNick.get(r.zaloAccountId) === g && tuNhin.get(r.zaloAccountId) !== r.zaloUid ? null : g;
  };
  const nhiem = new Set<string>();
  const trenNick = new Map<string, Set<string>>(); // `${nick}|${gid}` → uids
  for (const r of rows) {
    const g = sach(r);
    if (!g) continue;
    const k = `${r.zaloAccountId}|${g}`;
    const s = trenNick.get(k) ?? new Set<string>();
    s.add(r.zaloUid);
    trenNick.set(k, s);
    if (s.size > 1) nhiem.add(g);
  }
  const theoCap = new Map<string, { g: string | null; luc: Date }>();
  const theoUid = new Map<string, Set<string | null>>();
  const theoGid = new Map<string, Array<{ nick: string; uid: string; layLuc: Date }>>();
  for (const r of rows) {
    const g0 = sach(r);
    const g = g0 && !nhiem.has(g0) ? g0 : null;
    theoCap.set(`${r.zaloAccountId}|${r.zaloUid}`, { g, luc: r.layLuc });
    const s = theoUid.get(r.zaloUid) ?? new Set<string | null>();
    s.add(g);
    theoUid.set(r.zaloUid, s);
    if (g) theoGid.set(g, [...(theoGid.get(g) ?? []), { nick: r.zaloAccountId, uid: r.zaloUid, layLuc: r.layLuc }]);
  }
  return {
    nhiem,
    theoGid,
    gid: (nick, uid) => {
      if (nick) return theoCap.get(`${nick}|${uid}`)?.g ?? null;
      const s = theoUid.get(uid);
      if (!s || s.size !== 1) return null;
      return [...s][0];
    },
    layLuc: (nick, uid) => theoCap.get(`${nick}|${uid}`)?.luc ?? null,
  };
}
