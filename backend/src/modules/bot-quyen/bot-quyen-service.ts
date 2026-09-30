// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §3) — nghiệp vụ quản trị: nhóm (chức năng), nhân viên (vai/trạng thái), nhật ký.
//
// Bất biến giữ ở đây (routes chỉ là vỏ HTTP):
//   • giá trị enum đúng docs/77 §2 (bot-quyen-luat.ts) — DB còn CHECK chặn lần hai;
//   • `lyDo` bắt buộc khi HẠ (mất năng lực) hoặc KHOÁ (trạng thái đi xuống / bỏ xếp loại nhóm / TẠO NV
//     đã khoa|nghi hoặc vai cong_ty);
//   • luôn còn ≥ 1 NV admin hoat_dong: đổi vai HAY đổi trạng thái của admin hoạt động cuối ⇒ từ chối;
//   • mỗi thay đổi ghi MỘT dòng BotQuyenNhatKy (trước/sau/lý do) TRONG CÙNG giao dịch với thay đổi;
//   • mọi truy vấn lọc theo orgId.
// Mọi giao dịch ghi của một org nối đuôi nhau qua pg_advisory_xact_lock (khoá theo org): hai admin
// hạ HAI admin cuối cùng lúc không thể cùng thấy "còn người kia" rồi cùng thành công.
import type { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import {
  CHUC_NANG_NHOM, VAI_NV, TRANG_THAI_NV,
  laChucNang, laVai, laTrangThai,
  laHaChucNang, laHaVai, laHaTrangThai, laAdminHoatDong, laKhoaKhiTao,
  type ChucNangNhom, type VaiNv, type TrangThaiNv,
} from './bot-quyen-luat.js';
import { tinhMacDinhNhom, chucNangHieuLuc, type MacDinhNhom } from './bot-quyen-mac-dinh.js';
import { ghiNhanDoiMacDinh, AI_TU_DONG } from './bot-quyen-danh-sach.js';
import { boSungUidNhanVien, trangThaiTheoUid, uidCungNguoi, type NguonUid } from './bot-quyen-nhan-vien-uid.js';
import { logger } from '../../shared/utils/logger.js';

/** Sau thay đổi NV: mặc định các nhóm có thể đổi ⇒ ghi nhật ký "tự động" (góp ý chủ (4)). Không làm hỏng thay đổi NV. */
async function ghiNhanSauDoiNv(orgId: string): Promise<void> {
  await ghiNhanDoiMacDinh(orgId).catch((err) => logger.warn('[bot-quyen] ghi nhận mặc định sau đổi NV lỗi:', err));
}

export class LoiBotQuyen extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'LoiBotQuyen';
  }
}

const DAI_TEN = 100;
const DAI_UID = 64;
const DAI_GHI_CHU = 500;
const DAI_LY_DO = 500;

// ── Đọc đầu vào ─────────────────────────────────────────────────────────────

type Body = Record<string, unknown>;

function laBody(x: unknown): Body {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Body) : {};
}

/** undefined = không gửi; chuỗi đã trim (có thể rỗng). Sai kiểu / quá dài ⇒ 400. */
function chuoi(x: unknown, ten: string, dai: number): string | undefined {
  if (x === undefined) return undefined;
  if (typeof x !== 'string') throw new LoiBotQuyen(400, 'DU_LIEU_KHONG_HOP_LE', `${ten} phải là chuỗi`);
  const t = x.trim();
  if (t.length > dai) throw new LoiBotQuyen(400, 'DU_LIEU_KHONG_HOP_LE', `${ten} dài quá ${dai} ký tự`);
  return t;
}

/** undefined = không gửi (giữ nguyên); null / '' = xoá; còn lại chuỗi đã trim. */
function chuoiHoacNull(x: unknown, ten: string, dai: number): string | null | undefined {
  if (x === null) return null;
  const t = chuoi(x, ten, dai);
  return t === '' ? null : t;
}

function docLyDo(x: unknown): string | null {
  return chuoiHoacNull(x, 'lyDo', DAI_LY_DO) ?? null;
}

function canLyDo(lyDo: string | null, viec: string): void {
  if (!lyDo) throw new LoiBotQuyen(400, 'THIEU_LY_DO', `Cần ghi lý do khi ${viec}`);
}

/** userId (nếu có) phải thuộc CÙNG org — chống gán chéo tổ chức (như agent-operator-routes). */
async function kiemUser(orgId: string, userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const u = await prisma.user.findFirst({ where: { id: userId, orgId }, select: { id: true } });
  if (!u) throw new LoiBotQuyen(400, 'USER_KHONG_HOP_LE', 'Tài khoản CRM không thuộc tổ chức này');
}

// ── Giao dịch + nhật ký ─────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof tenantTransaction>[0]>[0];

/** Nối đuôi mọi giao dịch ghi quyền bot của MỘT org (nhả khi giao dịch kết thúc). */
async function khoaOrg(tx: Tx, orgId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-quyen:${orgId}`}))`;
}

async function ghiNhatKy(
  tx: Tx,
  d: { orgId: string; aiId: string; doiTuong: 'nhom' | 'nhan_vien'; doiTuongId: string; truoc: object | null; sau: object | null; lyDo: string | null },
): Promise<void> {
  // truoc/sau = null ⇒ BỎ ô (cột jsonb nullable mặc định SQL NULL). KHÔNG dùng Prisma.DbNull: extension
  // strip-null-bytes (prisma-client.ts) chép sâu `data` thành object thường ⇒ DbNull thành `{}`.
  await tx.botQuyenNhatKy.create({
    data: {
      orgId: d.orgId, aiId: d.aiId, doiTuong: d.doiTuong, doiTuongId: d.doiTuongId, lyDo: d.lyDo,
      ...(d.truoc ? { truoc: d.truoc as Prisma.InputJsonValue } : {}),
      ...(d.sau ? { sau: d.sau as Prisma.InputJsonValue } : {}),
    },
  });
}

function giongNhau(a: object, b: object): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Tên người cập nhật (User CRM cùng org) — cột *BoiId/aiId không có FK. */
async function tenNguoi(orgId: string, ids: Array<string | null | undefined>): Promise<Map<string, { id: string; fullName: string }>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (uniq.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { orgId, id: { in: uniq } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u]));
}

// ── Nhóm ────────────────────────────────────────────────────────────────────

type AnhNhom = { chucNang: string; tenDangKy: string; ghiChu: string | null };

function anhNhom(r: AnhNhom): AnhNhom {
  return { chucNang: r.chucNang, tenDangKy: r.tenDangKy, ghiChu: r.ghiChu ?? null };
}

export interface NhomView {
  conversationId: string;
  externalThreadId: string | null;
  tenNhom: string | null;
  soThanhVien: number | null;
  lastMessageAt: Date | null;
  /** Hội thoại đã ẩn trong CRM (xoá mềm / nick đã xoá) nhưng vẫn đang được xếp loại. */
  daAn: boolean;
  nick: { id: string; displayName: string | null; zaloUid: string | null; status: string };
  /** Chủ xếp TƯỜNG MINH (dòng BotNhom) — null = không xếp (theo mặc định). */
  chucNang: ChucNangNhom | null;
  tenDangKy: string | null;
  ghiChu: string | null;
  capNhatLuc: Date | null;
  capNhatBoi: { id: string; fullName: string } | null;
  /** Mặc định theo thành viên (docs/77 §8) — tính cả khi đã xếp tường minh (để trang nói "mặc định sẽ là…"). */
  macDinh: MacDinhNhom & { loiDoc: string | null; thuLuc: Date | null; thuLaiSau: Date | null; khongTra: boolean };
  /** Chức năng bot đang dùng: tường minh nếu có, không thì mặc định (null = chưa xếp loại ⇒ bot im). */
  chucNangHieuLuc: ChucNangNhom | null;
  laMacDinh: boolean;
}

/**
 * MỌI hội thoại NHÓM của org, nối trái BotNhom (chưa xếp loại ⇒ chucNang null). Kể cả hội thoại đã
 * xoá mềm / của nick đã xoá — gắn `daAn: true` để trang tự quyết hiện hay lọc (nhóm đã xếp loại vẫn
 * nằm trong cấu hình gửi bot, không được biến mất khỏi trang).
 */
export async function danhSachNhom(orgId: string, loc: { zaloAccountId?: string }): Promise<NhomView[]> {
  const rows = await prisma.conversation.findMany({
    where: {
      orgId,
      threadType: 'group',
      ...(loc.zaloAccountId ? { zaloAccountId: loc.zaloAccountId } : {}),
    },
    select: {
      id: true, externalThreadId: true, groupName: true, groupMembersCount: true, lastMessageAt: true, deletedAt: true,
      zaloAccount: { select: { id: true, displayName: true, zaloUid: true, status: true, archivedAt: true } },
      botNhom: { select: { chucNang: true, tenDangKy: true, ghiChu: true, capNhatLuc: true, capNhatBoiId: true } },
      botNhomDanhSach: {
        select: { uids: true, dayDu: true, canDocLai: true, docLuc: true, thuLuc: true, loi: true, thuLaiSau: true, khongTra: true },
      },
    },
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
  });
  const [nguoi, nhanVien, nicks] = await Promise.all([
    tenNguoi(orgId, rows.map((r) => r.botNhom?.capNhatBoiId)),
    trangThaiTheoUid(orgId),
    prisma.zaloAccount.findMany({ where: { orgId, zaloUid: { not: null } }, select: { zaloUid: true } }),
  ]);
  // MỌI uid của mọi NV (mỗi nick một uid — docs/77 §8b): thành viên nhóm là uid THEO NICK của nhóm.
  const trangThaiNv = nhanVien;
  const nickCrm = new Set(nicks.map((n) => n.zaloUid!));
  const bayGio = new Date();
  return rows.map((r) => {
    const tuongMinh = r.botNhom && laChucNang(r.botNhom.chucNang) ? r.botNhom.chucNang : null;
    const daAn = r.deletedAt !== null || r.zaloAccount.archivedAt !== null;
    const md = tinhMacDinhNhom(r.botNhomDanhSach, { nickUid: r.zaloAccount.zaloUid, trangThaiNv, nickCrm, bayGio, daAn });
    const hl = chucNangHieuLuc(tuongMinh, md);
    return {
    conversationId: r.id,
    externalThreadId: r.externalThreadId,
    tenNhom: r.groupName,
    soThanhVien: r.groupMembersCount,
    lastMessageAt: r.lastMessageAt,
    daAn: r.deletedAt !== null || r.zaloAccount.archivedAt !== null,
    nick: { id: r.zaloAccount.id, displayName: r.zaloAccount.displayName, zaloUid: r.zaloAccount.zaloUid, status: r.zaloAccount.status },
    chucNang: tuongMinh,
    tenDangKy: r.botNhom?.tenDangKy ?? null,
    ghiChu: r.botNhom?.ghiChu ?? null,
    capNhatLuc: r.botNhom?.capNhatLuc ?? null,
    capNhatBoi: (r.botNhom?.capNhatBoiId && nguoi.get(r.botNhom.capNhatBoiId)) || null,
    macDinh: {
      ...md, loiDoc: r.botNhomDanhSach?.loi ?? null, thuLuc: r.botNhomDanhSach?.thuLuc ?? null,
      thuLaiSau: r.botNhomDanhSach?.thuLaiSau ?? null, khongTra: r.botNhomDanhSach?.khongTra ?? false,
    },
    chucNangHieuLuc: hl.chucNang as ChucNangNhom | null,
    laMacDinh: hl.macDinh,
    };
  });
}

async function timNhomTrongOrg(tx: Tx, orgId: string, conversationId: string): Promise<void> {
  const conv = await tx.conversation.findFirst({
    where: { id: conversationId, orgId, threadType: 'group' }, select: { id: true },
  });
  if (!conv) throw new LoiBotQuyen(404, 'KHONG_TIM_THAY_NHOM', 'Không tìm thấy hội thoại nhóm này');
}

export interface BotNhomView {
  conversationId: string;
  chucNang: string;
  tenDangKy: string;
  ghiChu: string | null;
  capNhatLuc: Date;
  capNhatBoiId: string | null;
}

function botNhomView(r: BotNhomView): BotNhomView {
  return {
    conversationId: r.conversationId, chucNang: r.chucNang, tenDangKy: r.tenDangKy,
    ghiChu: r.ghiChu, capNhatLuc: r.capNhatLuc, capNhatBoiId: r.capNhatBoiId,
  };
}

/** PUT /nhom/:conversationId — xếp loại / đổi chức năng / đổi tên đăng ký. */
export async function datChucNangNhom(
  orgId: string, aiId: string, conversationId: string, input: unknown,
): Promise<{ botNhom: BotNhomView; doi: boolean }> {
  const body = laBody(input);
  if (!laChucNang(body.chucNang)) {
    throw new LoiBotQuyen(400, 'CHUC_NANG_KHONG_HOP_LE', `Chức năng nhóm phải là một trong: ${CHUC_NANG_NHOM.join(', ')}`);
  }
  const chucNang = body.chucNang;
  const tenDangKy = chuoi(body.tenDangKy, 'tenDangKy', DAI_TEN);
  const ghiChu = chuoiHoacNull(body.ghiChu, 'ghiChu', DAI_GHI_CHU);
  const lyDo = docLyDo(body.lyDo);

  return tenantTransaction(async (tx) => {
    await khoaOrg(tx, orgId);
    await timNhomTrongOrg(tx, orgId, conversationId);
    const cu = await tx.botNhom.findUnique({ where: { conversationId } });
    const moi: AnhNhom = {
      chucNang,
      tenDangKy: tenDangKy ?? cu?.tenDangKy ?? '',
      ghiChu: ghiChu === undefined ? (cu?.ghiChu ?? null) : ghiChu,
    };
    if (cu && giongNhau(anhNhom(cu), moi)) return { botNhom: botNhomView(cu), doi: false };

    const chucNangCu = cu && laChucNang(cu.chucNang) ? cu.chucNang : null;
    if (laHaChucNang(chucNangCu, chucNang)) canLyDo(lyDo, 'hạ chức năng nhóm');

    const row = cu
      ? await tx.botNhom.update({ where: { id: cu.id }, data: { ...moi, capNhatBoiId: aiId } })
      : await tx.botNhom.create({ data: { orgId, conversationId, ...moi, capNhatBoiId: aiId } });
    await ghiNhatKy(tx, {
      orgId, aiId, doiTuong: 'nhom', doiTuongId: conversationId,
      truoc: cu ? anhNhom(cu) : null, sau: anhNhom(row), lyDo,
    });
    return { botNhom: botNhomView(row), doi: true };
  });
}

/** DELETE /nhom/:conversationId — bỏ xếp loại (nhóm về "chưa xếp loại" ⇒ bot im). */
export async function boXepLoaiNhom(
  orgId: string, aiId: string, conversationId: string, input: unknown,
): Promise<{ doi: boolean }> {
  const lyDo = docLyDo(laBody(input).lyDo);
  return tenantTransaction(async (tx) => {
    await khoaOrg(tx, orgId);
    await timNhomTrongOrg(tx, orgId, conversationId);
    const cu = await tx.botNhom.findUnique({ where: { conversationId } });
    if (!cu) return { doi: false };
    const chucNangCu = laChucNang(cu.chucNang) ? cu.chucNang : null;
    if (laHaChucNang(chucNangCu, null)) canLyDo(lyDo, 'bỏ xếp loại nhóm (bot sẽ im)');
    await tx.botNhom.delete({ where: { id: cu.id } });
    await ghiNhatKy(tx, {
      orgId, aiId, doiTuong: 'nhom', doiTuongId: conversationId, truoc: anhNhom(cu), sau: null, lyDo,
    });
    return { doi: true };
  });
}

// ── Nhân viên ───────────────────────────────────────────────────────────────

type AnhNhanVien = {
  zaloUid: string; tenGoi: string; vai: string; trangThai: string; userId: string | null; ghiChu: string | null;
};

function anhNhanVien(r: AnhNhanVien): AnhNhanVien {
  return {
    zaloUid: r.zaloUid, tenGoi: r.tenGoi, vai: r.vai, trangThai: r.trangThai,
    userId: r.userId ?? null, ghiChu: r.ghiChu ?? null,
  };
}

const CHON_NV = {
  id: true, zaloUid: true, tenGoi: true, vai: true, trangThai: true, userId: true, ghiChu: true,
  capNhatLuc: true, capNhatBoiId: true,
  user: { select: { id: true, fullName: true } },
  uids: { select: { zaloUid: true, zaloAccountId: true, nguon: true }, orderBy: { zaloUid: 'asc' } },
} as const;

type NvRow = Prisma.BotNhanVienGetPayload<{ select: typeof CHON_NV }>;

/** Một uid của nhân viên: uid theo nick nào (null = chưa biết), vì sao có (chọn / tự nhận ra). */
export interface UidNhanVienView {
  zaloUid: string;
  nick: { id: string; ten: string; zaloUid: string | null } | null;
  nguon: NguonUid | string;
}

export interface NhanVienView {
  id: string;
  /** uid LÚC GÁN (uid chính). Mọi uid — kể cả uid này — ở `uids`. */
  zaloUid: string;
  /** Mọi uid Zalo của người này, mỗi nick một uid (docs/77 §8b). Bot nhận ra người này qua BẤT KỲ uid nào. */
  uids: UidNhanVienView[];
  tenGoi: string;
  vai: string;
  trangThai: string;
  userId: string | null;
  user: { id: string; fullName: string } | null;
  ghiChu: string | null;
  capNhatLuc: Date;
  capNhatBoi: { id: string; fullName: string } | null;
}

async function nhanVienViews(orgId: string, rows: NvRow[]): Promise<NhanVienView[]> {
  const idNick = [...new Set(rows.flatMap((r) => r.uids.map((u) => u.zaloAccountId)).filter((x): x is string => !!x))];
  const [nguoi, nicks] = await Promise.all([
    tenNguoi(orgId, rows.map((r) => r.capNhatBoiId)),
    idNick.length === 0 ? [] : prisma.zaloAccount.findMany({
      where: { orgId, id: { in: idNick } }, select: { id: true, displayName: true, zaloUid: true },
    }),
  ]);
  const nick = new Map(nicks.map((n) => [n.id, { id: n.id, ten: n.displayName?.trim() || 'Nick chưa đặt tên', zaloUid: n.zaloUid }]));
  return rows.map((r) => ({
    id: r.id, zaloUid: r.zaloUid, tenGoi: r.tenGoi, vai: r.vai, trangThai: r.trangThai,
    uids: (r.uids.length > 0 ? r.uids : [{ zaloUid: r.zaloUid, zaloAccountId: null, nguon: 'chon' }]).map((u) => ({
      zaloUid: u.zaloUid, nick: (u.zaloAccountId && nick.get(u.zaloAccountId)) || null, nguon: u.nguon,
    })),
    userId: r.userId, user: r.user, ghiChu: r.ghiChu, capNhatLuc: r.capNhatLuc,
    capNhatBoi: (r.capNhatBoiId && nguoi.get(r.capNhatBoiId)) || null,
  }));
}

export async function danhSachNhanVien(orgId: string): Promise<NhanVienView[]> {
  // Tự bổ sung uid cùng người ở nick khác (≤ 1 lần / phút / org). Lỗi không làm hỏng trang.
  const them = await boSungUidNhanVien(orgId, { nhip: true })
    .catch((err) => { logger.warn('[bot-quyen] bổ sung uid cùng người lỗi:', err); return 0; });
  if (them > 0) await ghiNhanSauDoiNv(orgId);
  const rows = await prisma.botNhanVien.findMany({
    where: { orgId }, select: CHON_NV, orderBy: [{ tenGoi: 'asc' }, { zaloUid: 'asc' }],
  });
  return nhanVienViews(orgId, rows);
}

function kiemVai(x: unknown): VaiNv {
  if (!laVai(x)) throw new LoiBotQuyen(400, 'VAI_KHONG_HOP_LE', `Vai phải là một trong: ${VAI_NV.join(', ')}`);
  return x;
}

function kiemTrangThai(x: unknown): TrangThaiNv {
  if (!laTrangThai(x)) {
    throw new LoiBotQuyen(400, 'TRANG_THAI_KHONG_HOP_LE', `Trạng thái phải là một trong: ${TRANG_THAI_NV.join(', ')}`);
  }
  return x;
}

/** Danh sách uid kèm (tuỳ chọn): mảng chuỗi, mỗi chuỗi ≤ DAI_UID, tối đa 20. Sai ⇒ 400. */
function docDanhSachUid(x: unknown): string[] {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x) || x.length > 20) {
    throw new LoiBotQuyen(400, 'DU_LIEU_KHONG_HOP_LE', 'zaloUids phải là mảng tối đa 20 uid');
  }
  return [...new Set(x.map((u) => chuoi(u, 'zaloUids[]', DAI_UID)).filter((u): u is string => !!u))];
}

/** Mọi uid chưa thuộc nhân viên nào (trong khoá org). Có ⇒ 409 nói rõ thuộc ai. */
async function kiemUidChuaCoChu(tx: Tx, orgId: string, uids: string[]): Promise<void> {
  const co = await tx.botNhanVienUid.findMany({
    where: { orgId, zaloUid: { in: uids } },
    select: { zaloUid: true, nhanVien: { select: { tenGoi: true } } },
    orderBy: { zaloUid: 'asc' },
  });
  if (co.length > 0) {
    throw new LoiBotQuyen(409, 'NHAN_VIEN_DA_CO',
      `Người này đã là nhân viên “${co[0].nhanVien.tenGoi}” (Zalo ${co[0].zaloUid}) — sửa nhân viên đó thay vì thêm mới`);
  }
}

/**
 * POST /nhan-vien/:id/uid — thêm uid của CÙNG người ở nick khác (vd "Chờ gán" còn dòng của người này ở một nick mà máy
 * chưa tự nhận ra). uid kèm cả uid cùng người với nó. uid đã thuộc nhân viên khác ⇒ 409.
 */
export async function themUidNhanVien(
  orgId: string, aiId: string, id: string, input: unknown,
): Promise<{ nhanVien: NhanVienView; doi: boolean }> {
  const body = laBody(input);
  const mot = chuoi(body.zaloUid, 'zaloUid', DAI_UID);
  const chon = [...new Set([...(mot ? [mot] : []), ...docDanhSachUid(body.zaloUids)])];
  if (chon.length === 0) throw new LoiBotQuyen(400, 'THIEU_ZALO_UID', 'Thiếu Zalo uid');
  const lyDo = docLyDo(body.lyDo);
  const uids = await uidCungNguoi(orgId, chon);
  for (const u of uids) if (chon.includes(u.zaloUid)) u.nguon = 'chon';

  const ket = await tenantTransaction(async (tx) => {
    await khoaOrg(tx, orgId);
    const cu = await tx.botNhanVien.findFirst({ where: { id, orgId }, select: CHON_NV });
    if (!cu) throw new LoiBotQuyen(404, 'KHONG_TIM_THAY_NHAN_VIEN', 'Không tìm thấy nhân viên này');
    const cuaMinh = new Set(cu.uids.map((u) => u.zaloUid));
    const moi = uids.filter((u) => !cuaMinh.has(u.zaloUid));
    if (moi.length === 0) return { row: cu, doi: false };
    await kiemUidChuaCoChu(tx, orgId, moi.map((u) => u.zaloUid));
    await tx.botNhanVienUid.createMany({
      data: moi.map((u) => ({ orgId, nhanVienId: cu.id, zaloUid: u.zaloUid, zaloAccountId: u.zaloAccountId, nguon: u.nguon })),
    });
    const row = await tx.botNhanVien.update({ where: { id: cu.id }, data: { capNhatBoiId: aiId }, select: CHON_NV });
    await ghiNhatKy(tx, {
      orgId, aiId, doiTuong: 'nhan_vien', doiTuongId: cu.id,
      truoc: { tenGoi: cu.tenGoi, uids: [...cuaMinh].sort() },
      sau: { tenGoi: row.tenGoi, uids: row.uids.map((u) => u.zaloUid) }, lyDo,
    });
    return { row, doi: true };
  });
  if (ket.doi) await ghiNhanSauDoiNv(orgId);
  return { nhanVien: (await nhanVienViews(orgId, [ket.row]))[0], doi: ket.doi };
}

/**
 * POST /nhan-vien — thêm NV. Lý do bắt buộc khi tạo đã khoa/nghi hoặc vai cong_ty (laKhoaKhiTao);
 * còn lại tuỳ chọn, có thì ghi nhật ký.
 */
export async function themNhanVien(orgId: string, aiId: string, input: unknown): Promise<NhanVienView> {
  const body = laBody(input);
  const zaloUid = chuoi(body.zaloUid, 'zaloUid', DAI_UID);
  if (!zaloUid) throw new LoiBotQuyen(400, 'THIEU_ZALO_UID', 'Thiếu Zalo uid');
  const uidKem = docDanhSachUid(body.zaloUids);
  const tenGoi = chuoi(body.tenGoi, 'tenGoi', DAI_TEN);
  if (!tenGoi) throw new LoiBotQuyen(400, 'THIEU_TEN_GOI', 'Thiếu tên gọi');
  const vai = kiemVai(body.vai);
  const trangThai = body.trangThai === undefined ? 'hoat_dong' : kiemTrangThai(body.trangThai);
  const userId = chuoiHoacNull(body.userId, 'userId', DAI_UID) ?? null;
  const ghiChu = chuoiHoacNull(body.ghiChu, 'ghiChu', DAI_GHI_CHU) ?? null;
  const lyDo = docLyDo(body.lyDo);
  if (laKhoaKhiTao(vai, trangThai)) {
    canLyDo(lyDo, 'thêm nhân viên đang khoá / đã nghỉ / là người công ty (bot sẽ khoá Zalo này)');
  }
  await kiemUser(orgId, userId);
  // uid đã chọn + uid của CÙNG người ở nick khác (docs/77 §8b) — đọc trước giao dịch (đọc tin nhắn, không khoá).
  const uids = await uidCungNguoi(orgId, [zaloUid, ...uidKem]);
  for (const u of uids) if (uidKem.includes(u.zaloUid)) u.nguon = 'chon';

  const row = await tenantTransaction(async (tx) => {
    await khoaOrg(tx, orgId);
    const trung = await tx.botNhanVien.findUnique({ where: { orgId_zaloUid: { orgId, zaloUid } }, select: { id: true } });
    if (trung) throw new LoiBotQuyen(409, 'NHAN_VIEN_DA_CO', 'Zalo này đã có trong danh sách nhân viên');
    await kiemUidChuaCoChu(tx, orgId, uids.map((u) => u.zaloUid));
    const tao = await tx.botNhanVien.create({
      data: { orgId, zaloUid, tenGoi, vai, trangThai, userId, ghiChu, capNhatBoiId: aiId },
      select: { id: true },
    });
    await tx.botNhanVienUid.createMany({
      data: uids.map((u) => ({ orgId, nhanVienId: tao.id, zaloUid: u.zaloUid, zaloAccountId: u.zaloAccountId, nguon: u.nguon })),
    });
    const day = await tx.botNhanVien.findUniqueOrThrow({ where: { id: tao.id }, select: CHON_NV });
    await ghiNhatKy(tx, {
      orgId, aiId, doiTuong: 'nhan_vien', doiTuongId: tao.id, truoc: null,
      sau: { ...anhNhanVien(day), uids: day.uids.map((u) => u.zaloUid) }, lyDo,
    });
    return day;
  });
  await ghiNhanSauDoiNv(orgId);
  return (await nhanVienViews(orgId, [row]))[0];
}

/** PUT /nhan-vien/:id — đổi tên / vai / trạng thái / liên kết CRM / ghi chú. Không đổi zaloUid. */
export async function suaNhanVien(
  orgId: string, aiId: string, id: string, input: unknown,
): Promise<{ nhanVien: NhanVienView; doi: boolean }> {
  const body = laBody(input);
  const zaloUidGui = chuoi(body.zaloUid, 'zaloUid', DAI_UID);
  const tenGoi = chuoi(body.tenGoi, 'tenGoi', DAI_TEN);
  if (tenGoi === '') throw new LoiBotQuyen(400, 'THIEU_TEN_GOI', 'Tên gọi không được để trống');
  const vai = body.vai === undefined ? undefined : kiemVai(body.vai);
  const trangThai = body.trangThai === undefined ? undefined : kiemTrangThai(body.trangThai);
  const userId = chuoiHoacNull(body.userId, 'userId', DAI_UID);
  const ghiChu = chuoiHoacNull(body.ghiChu, 'ghiChu', DAI_GHI_CHU);
  const lyDo = docLyDo(body.lyDo);
  await kiemUser(orgId, userId);

  const ket = await tenantTransaction(async (tx) => {
    await khoaOrg(tx, orgId);
    const cu = await tx.botNhanVien.findFirst({ where: { id, orgId }, select: CHON_NV });
    if (!cu) throw new LoiBotQuyen(404, 'KHONG_TIM_THAY_NHAN_VIEN', 'Không tìm thấy nhân viên này');
    if (zaloUidGui !== undefined && zaloUidGui !== cu.zaloUid) {
      throw new LoiBotQuyen(400, 'KHONG_DOI_ZALO_UID', 'Không đổi được Zalo uid — thêm nhân viên mới cho Zalo khác');
    }
    const truoc = anhNhanVien(cu);
    const sau: AnhNhanVien = {
      zaloUid: cu.zaloUid,
      tenGoi: tenGoi ?? cu.tenGoi,
      vai: vai ?? cu.vai,
      trangThai: trangThai ?? cu.trangThai,
      userId: userId === undefined ? cu.userId : userId,
      ghiChu: ghiChu === undefined ? cu.ghiChu : ghiChu,
    };
    if (giongNhau(truoc, sau)) return { row: cu, doi: false };

    // Admin hoạt động cuối cùng: mọi đổi làm người này thôi là "admin hoat_dong" (hạ vai, khoá, nghỉ).
    if (laAdminHoatDong(truoc) && !laAdminHoatDong(sau)) {
      const conLai = await tx.botNhanVien.count({
        where: { orgId, vai: 'admin', trangThai: 'hoat_dong', id: { not: cu.id } },
      });
      if (conLai === 0) {
        throw new LoiBotQuyen(409, 'ADMIN_CUOI', 'Đây là admin đang hoạt động cuối cùng — phải luôn còn ít nhất một admin');
      }
    }
    if (laVai(truoc.vai) && laVai(sau.vai) && laHaVai(truoc.vai, sau.vai)) canLyDo(lyDo, 'hạ vai nhân viên');
    if (laTrangThai(truoc.trangThai) && laTrangThai(sau.trangThai) && laHaTrangThai(truoc.trangThai, sau.trangThai)) {
      canLyDo(lyDo, 'khoá / cho nghỉ nhân viên');
    }

    const row = await tx.botNhanVien.update({
      where: { id: cu.id },
      data: { tenGoi: sau.tenGoi, vai: sau.vai, trangThai: sau.trangThai, userId: sau.userId, ghiChu: sau.ghiChu, capNhatBoiId: aiId },
      select: CHON_NV,
    });
    await ghiNhatKy(tx, { orgId, aiId, doiTuong: 'nhan_vien', doiTuongId: cu.id, truoc, sau: anhNhanVien(row), lyDo });
    return { row, doi: true };
  });
  if (ket.doi) await ghiNhanSauDoiNv(orgId);
  return { nhanVien: (await nhanVienViews(orgId, [ket.row]))[0], doi: ket.doi };
}

// ── Nhật ký ─────────────────────────────────────────────────────────────────

export interface NhatKyView {
  id: string;
  luc: Date;
  aiId: string;
  ai: { id: string; fullName: string } | null;
  /** Dòng do HỆ THỐNG ghi (mặc định nhóm tự đổi theo thành viên / NV) — ai_id = AI_TU_DONG. */
  tuDong: boolean;
  doiTuong: string;
  doiTuongId: string;
  /** nhom: tên nhóm Zalo hiện tại · nhan_vien: tên gọi trong bản ghi (sau, hoặc trước nếu không có sau). */
  tenDoiTuong: string | null;
  truoc: Prisma.JsonValue;
  sau: Prisma.JsonValue;
  lyDo: string | null;
}

export async function docNhatKy(orgId: string, limitRaw: unknown): Promise<NhatKyView[]> {
  const n = Number.parseInt(String(limitRaw ?? ''), 10);
  const take = Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 100;
  const rows = await prisma.botQuyenNhatKy.findMany({
    where: { orgId }, orderBy: [{ luc: 'desc' }, { id: 'desc' }], take,
  });
  const nguoi = await tenNguoi(orgId, rows.map((r) => r.aiId));
  const idNhom = [...new Set(rows.filter((r) => r.doiTuong === 'nhom').map((r) => r.doiTuongId))];
  const nhom = idNhom.length === 0 ? [] : await prisma.conversation.findMany({
    where: { orgId, id: { in: idNhom } }, select: { id: true, groupName: true },
  });
  const tenNhom = new Map(nhom.map((c) => [c.id, c.groupName]));
  const tenTrongAnh = (x: Prisma.JsonValue): string | null => {
    if (x && typeof x === 'object' && !Array.isArray(x) && typeof x.tenGoi === 'string') return x.tenGoi;
    return null;
  };
  return rows.map((r) => ({
    id: r.id,
    luc: r.luc,
    aiId: r.aiId,
    ai: nguoi.get(r.aiId) ?? null,
    tuDong: r.aiId === AI_TU_DONG,
    doiTuong: r.doiTuong,
    doiTuongId: r.doiTuongId,
    tenDoiTuong: r.doiTuong === 'nhom' ? (tenNhom.get(r.doiTuongId) ?? null) : (tenTrongAnh(r.sau) ?? tenTrongAnh(r.truoc)),
    truoc: r.truoc,
    sau: r.sau,
    lyDo: r.lyDo,
  }));
}
