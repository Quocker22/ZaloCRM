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
//                          User{ userId, globalId, zaloName, displayName, … } } }. Tối đa LO_UID uid mỗi lần gọi.
//   findUser(phone)      — category 'friend_lookup' (chung quota chiến dịch tìm khách). Trả UserBasic{ uid, globalId,
//                          zalo_name, display_name }. Dùng ÍT (≤ TRAN_TIM_SDT_NGAY/nick/ngày), chỉ khi còn thiếu.
// Đã đo LIVE trên staging qua VTMT (docs/77 cach-crm-nhan-dien.md §5): getUserInfo trả globalId cho cả người KHÔNG phải
// bạn (isFr=0) nhưng CHỈ với uid theo góc của chính nick gọi (uid nick khác ⇒ rỗng); getUserInfo(ownId) trả globalId +
// phoneNumber; findUser(sđt nick CRM khác) trả uid theo góc nick gọi + globalId trùng. Lỗi 216 bị zca-js nuốt ⇒ rỗng.
// globalId CỦA CHÍNH nick lưu lúc nối (ghiHoSoNickKetNoi — zalo-pool đã gọi getUserInfo(ownId)) ⇒ nick đang tắt vẫn được
// nhận ra ở nick khác. SĐT dùng cho findUser nick lấy từ hồ sơ sống đó, KHÔNG BAO GIỜ từ zalo_accounts.phone (gõ tay —
// staging gõ lẫn VTMT/Tiểu Mã). Không bao giờ hỏi getUserInfo trên MÃ NHÓM (Zalo trả globalId giữ chỗ).
//
// Ngân sách: tối đa TI_LE_NGAN_SACH_TRA (40%) trần NGÀY 'query' của mỗi nick (đếm trong bộ nhớ, như đọc danh sách nhóm).
// Đọc lại sau TUOI_DANH_TINH_MS (7 ngày) hoặc khi nick nối lại (danhDauNickKetNoiLaiDanhTinh). Lỗi ⇒ không ghi globalId ⇒
// không nối (đóng an toàn — nhóm vẫn Khách/im).
//
// "Nhiễm": một globalId mà HAI uid khác nhau trên CÙNG một nick mang ⇒ globalId giữ chỗ (vd của nhóm / thực thể không có
// globalId thật — xem contacts/backfill-global-id.ts) ⇒ bỏ khỏi mọi luật nối.
import { prisma } from '../../shared/database/prisma-client.js';
import { runSystemQuery, withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';

export const LO_UID = 50;
export const TUOI_DANH_TINH_MS = 7 * 24 * 60 * 60_000;
export const THU_LAI_LOI_MS = 60 * 60_000;
export const TI_LE_NGAN_SACH_TRA = 0.4;
export const TRAN_TIM_SDT_NGAY = 10;
export const THU_LAI_SDT_MS = 7 * 24 * 60 * 60_000;

export interface HoSoZalo {
  globalId: string | null;
  ten: string | null;
  /** phoneNumber (chỉ lưu cho dòng nick tự nhìn mình). */
  sdt?: string | null;
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

/** Bóc kết quả getUserInfo (khoá "<uid>_0" hoặc "<uid>"). THUẦN. */
export function bocThongTin(kq: unknown, uids: readonly string[]): Map<string, HoSoZalo> {
  const ra = new Map<string, HoSoZalo>();
  const p = (kq as { changed_profiles?: Record<string, Record<string, unknown>> } | null)?.changed_profiles ?? {};
  for (const u of uids) {
    const h = p[`${u}_0`] ?? p[u];
    if (!h) continue;
    ra.set(u, {
      globalId: sachGlobalId(h.globalId),
      ten: String(h.zaloName ?? h.zalo_name ?? h.displayName ?? h.display_name ?? '').trim() || null,
      sdt: chuanSdt(String(h.phoneNumber ?? '')),
    });
  }
  return ra;
}

const apiMacDinh: ZaloDanhTinhApi = {
  async thongTin(nickId, uids) {
    const { zaloOps } = await import('../../shared/zalo-operations.js');
    return bocThongTin(await zaloOps.getUserInfo(nickId, uids as unknown as string), uids);
  },
  async timSdt(nickId, sdt) {
    const { zaloOps } = await import('../../shared/zalo-operations.js');
    const f = (await zaloOps.findUser(nickId, sdt)) as { uid?: unknown; globalId?: unknown; zalo_name?: unknown; display_name?: unknown } | null;
    if (!f?.uid) return null;
    return { uid: String(f.uid), globalId: sachGlobalId(f.globalId), ten: String(f.display_name ?? f.zalo_name ?? '').trim() || null };
  },
};

let api: ZaloDanhTinhApi = apiMacDinh;
let moiNick = false;
let nickDungTest: string[] | null = null;
let layTran: (nick: string) => Promise<number> = async (nick) => {
  const { getEffectiveLimit } = await import('../zalo/sdk-limit-service.js');
  return Math.max(1, Math.floor((await getEffectiveLimit(nick, 'query')).daily * TI_LE_NGAN_SACH_TRA));
};
const daDung = new Map<string, { ngay: string; so: number; sdt: number }>();
const daTimSdt = new Map<string, number>();

/** Chỉ cho test: cổng Zalo giả (null = thật) + dùng MỌI nick (kể cả không 'connected'), ngân sách ngày (null = thật). */
export function _datZaloDanhTinhChoTest(a: ZaloDanhTinhApi | null, o: { tranNgay?: number | null; nickDung?: string[] | null } = {}): void {
  api = a ?? apiMacDinh;
  moiNick = !!a;
  nickDungTest = o.nickDung ?? null;
  if (o.tranNgay !== undefined) {
    layTran = o.tranNgay === null
      ? async (nick) => {
        const { getEffectiveLimit } = await import('../zalo/sdk-limit-service.js');
        return Math.max(1, Math.floor((await getEffectiveLimit(nick, 'query')).daily * TI_LE_NGAN_SACH_TRA));
      }
      : async () => o.tranNgay as number;
  }
  daDung.clear();
  daTimSdt.clear();
}

function ngay(): string {
  return new Date().toISOString().slice(0, 10);
}

function soDaDung(nick: string): { so: number; sdt: number } {
  const d = daDung.get(nick);
  return d && d.ngay === ngay() ? d : { so: 0, sdt: 0 };
}

function dung(nick: string, loai: 'so' | 'sdt'): void {
  const h = ngay();
  const d = daDung.get(nick);
  const x = d && d.ngay === h ? d : { ngay: h, so: 0, sdt: 0 };
  x[loai]++;
  daDung.set(nick, x);
}

export interface KetQuaLay {
  /** Số lần gọi getUserInfo. */
  goi: number;
  /** Số uid đã ghi (có hoặc không có globalId). */
  uid: number;
  /** Số lần findUser. */
  timSdt: number;
  /** Số lô hỏng (lỗi Zalo / hết giờ) — không ghi gì cho lô đó. */
  loi: number;
}

type Dong = { zaloUid: string; globalId: string | null; layLuc: Date; loi: string | null };

/**
 * Giai đoạn MẠNG: đọc globalId sống cho uid cần của MỌI nick dùng được của org (theo ngân sách), ghi bảng hệ thống.
 * Thứ tự ưu tiên mỗi nick Y: uid của chính Y → uid nhân viên thấy ở Y → thành viên nhóm của Y (bản đọc danh sách) → người
 * gửi trong nhóm của Y. Rồi findUser(sđt) cho nick X / nhân viên có sđt mà Y chưa thấy. Không bao giờ ném.
 */
export async function layDanhTinhZalo(orgId: string): Promise<KetQuaLay> {
  const kq: KetQuaLay = { goi: 0, uid: 0, timSdt: 0, loi: 0 };
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
        const coSan = new Map<string, Dong>((await prisma.botQuyenDanhTinh.findMany({
          where: { orgId, zaloAccountId: y.id }, select: { zaloUid: true, globalId: true, layLuc: true, loi: true },
        })).map((r) => [r.zaloUid, r]));
        const canDoc = (u: string) => {
          const r = coSan.get(u);
          if (!r) return true;
          if (u === y.zaloUid && r.globalId) return false; // globalId của chính nick không đổi
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
        them(y.zaloUid);
        for (const r of nvUid) if (r.zaloAccountId === y.id) them(r.zaloUid);
        const ds = await prisma.botNhomDanhSach.findMany({
          where: { orgId, zaloAccountId: y.id }, select: { uids: true }, orderBy: { conversationId: 'asc' },
        });
        for (const d of ds) for (const u of d.uids) them(u);
        const nguoiGui = await prisma.$queryRaw<Array<{ uid: string }>>`
          SELECT DISTINCT m.sender_uid AS uid FROM conversations c JOIN messages m ON m.conversation_id = c.id
          WHERE c.org_id = ${orgId} AND c.zalo_account_id = ${y.id} AND c."threadType" = 'group' AND c.is_virtual = false
            AND m.is_local = false AND m.sender_uid IS NOT NULL AND m.sender_uid <> ''
            AND m.sent_at > now() - interval '90 days'
          LIMIT 2000`.catch(() => []);
        for (const r of nguoiGui) them(r.uid);

        const tran = await layTran(y.id).catch(() => 1);
        for (let i = 0; i < muon.length; i += LO_UID) {
          if (soDaDung(y.id).so >= tran) {
            logger.info(`[bot-quyen-danh-tinh] nick ${y.id}: hết ngân sách đọc hồ sơ Zalo hôm nay (${tran}) — còn ${muon.length - i} uid`);
            break;
          }
          const lo = muon.slice(i, i + LO_UID);
          dung(y.id, 'so');
          kq.goi++;
          let hoSo: Map<string, HoSoZalo>;
          try {
            hoSo = await api.thongTin(y.id, lo);
          } catch (err) {
            kq.loi++;
            logger.warn(`[bot-quyen-danh-tinh] getUserInfo qua nick ${y.id} lỗi — không ghi (đóng an toàn):`, err instanceof Error ? err.message : err);
            continue;
          }
          for (const u of lo) {
            const h = hoSo.get(u);
            const data = {
              globalId: h?.globalId ?? null, ten: h?.ten ?? null, nguon: 'zalo_api', layLuc: new Date(), loi: h ? null : 'khong_tra',
              // SĐT CHỈ của chính nick (tìm lại nick này từ nick khác khi nó tắt) — không lưu SĐT người khác.
              soDienThoai: u === y.zaloUid ? (h?.sdt ?? null) : null,
            };
            await prisma.botQuyenDanhTinh.upsert({
              where: { orgId_zaloAccountId_zaloUid: { orgId, zaloAccountId: y.id, zaloUid: u } },
              create: { orgId, zaloAccountId: y.id, zaloUid: u, ...data },
              update: data,
            });
            kq.uid++;
          }
        }

        // findUser(sđt): nick X khác (hồ sơ SỐNG của X đã lưu: globalId + SĐT thật) mà Y chưa thấy uid nào mang globalId
        // đó; nhân viên có SĐT mà chưa có uid nào ở nick Y.
        const hoSoNick = new Map<string, { gid: string | null; sdt: string | null }>();
        for (const x of tatCaNick) {
          const r = await prisma.botQuyenDanhTinh.findFirst({
            where: { orgId, zaloAccountId: x.id, zaloUid: x.zaloUid! }, select: { globalId: true, soDienThoai: true },
          });
          if (r) hoSoNick.set(x.id, { gid: sachGlobalId(r.globalId), sdt: r.soDienThoai });
        }
        const gidThayTuY = new Set((await prisma.botQuyenDanhTinh.findMany({
          where: { orgId, zaloAccountId: y.id, globalId: { not: null } }, select: { globalId: true },
        })).map((r) => r.globalId!));
        const sdtCanTim: string[] = [];
        for (const x of tatCaNick) {
          const h = hoSoNick.get(x.id);
          if (x.id === y.id || !h?.sdt || !h.gid || gidThayTuY.has(h.gid)) continue;
          sdtCanTim.push(h.sdt);
        }
        const nvCoUidY = new Set(nvUid.filter((r) => r.zaloAccountId === y.id).map((r) => r.nhanVienId));
        for (const n of nvSdt) if (!nvCoUidY.has(n.id)) for (const so of n.sdt) sdtCanTim.push(so);
        for (const sdt of [...new Set(sdtCanTim)]) {
          const khoa = `${y.id}|${sdt}`;
          if (bayGio - (daTimSdt.get(khoa) ?? 0) < THU_LAI_SDT_MS) continue;
          if (soDaDung(y.id).sdt >= TRAN_TIM_SDT_NGAY) break;
          daTimSdt.set(khoa, bayGio);
          dung(y.id, 'sdt');
          kq.timSdt++;
          try {
            const f = await api.timSdt(y.id, sdt);
            if (!f?.uid) continue;
            const data = { globalId: f.globalId, ten: f.ten, nguon: 'zalo_find_user', layLuc: new Date(), loi: null, timTheoSdt: sdt };
            await prisma.botQuyenDanhTinh.upsert({
              where: { orgId_zaloAccountId_zaloUid: { orgId, zaloAccountId: y.id, zaloUid: f.uid } },
              create: { orgId, zaloAccountId: y.id, zaloUid: f.uid, ...data },
              update: data,
            });
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
 * gọi thêm Zalo. Không bao giờ ném.
 */
export async function ghiHoSoNickKetNoi(zaloAccountId: string, ownId: string, profile: Record<string, unknown> | null | undefined): Promise<void> {
  try {
    if (!ownId || !profile) return;
    const nick = await runSystemQuery(() => prisma.zaloAccount.findUnique({ where: { id: zaloAccountId }, select: { orgId: true } }));
    if (!nick) return;
    const h = bocThongTin({ changed_profiles: { [ownId]: profile } }, [ownId]).get(ownId);
    if (!h) return;
    await withTenant(nick.orgId, () => prisma.botQuyenDanhTinh.upsert({
      where: { orgId_zaloAccountId_zaloUid: { orgId: nick.orgId, zaloAccountId, zaloUid: ownId } },
      create: { orgId: nick.orgId, zaloAccountId, zaloUid: ownId, globalId: h.globalId, ten: h.ten, soDienThoai: h.sdt ?? null, nguon: 'zalo_api' },
      update: { globalId: h.globalId, ten: h.ten, soDienThoai: h.sdt ?? null, nguon: 'zalo_api', layLuc: new Date(), loi: null },
    }));
  } catch (err) {
    logger.warn(`[bot-quyen-danh-tinh] lưu hồ sơ nick ${zaloAccountId} lúc nối lỗi:`, err instanceof Error ? err.message : err);
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
  /** `${nick}|${uid}` → globalId sạch (null = không có / nhiễm / lệch). */
  gid: (nick: string | null, uid: string) => string | null;
  /** globalId → mọi {nick, uid} mang nó (đã bỏ nhiễm). */
  theoGid: Map<string, Array<{ nick: string; uid: string; layLuc: Date }>>;
  /** globalId bị nhiễm. */
  nhiem: Set<string>;
  /** `${nick}|${uid}` → lúc đọc. */
  layLuc: (nick: string, uid: string) => Date | null;
}

/**
 * Đọc bảng danh tính của org + luật nhiễm. THUẦN phần tính (`dungBanDanhTinh`). uid không biết nick (`nick` null) ⇒ lấy
 * globalId nếu MỌI dòng của uid đó (mọi nick) đồng ý.
 */
export async function docBanDanhTinh(orgId: string): Promise<BanDanhTinh> {
  const rows = await prisma.botQuyenDanhTinh.findMany({
    where: { orgId }, select: { zaloAccountId: true, zaloUid: true, globalId: true, layLuc: true },
  });
  return dungBanDanhTinh(rows);
}

export function dungBanDanhTinh(
  rows: ReadonlyArray<{ zaloAccountId: string; zaloUid: string; globalId: string | null; layLuc: Date }>,
): BanDanhTinh {
  const nhiem = new Set<string>();
  const trenNick = new Map<string, Set<string>>(); // `${nick}|${gid}` → uids
  for (const r of rows) {
    const g = sachGlobalId(r.globalId);
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
    const g0 = sachGlobalId(r.globalId);
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
