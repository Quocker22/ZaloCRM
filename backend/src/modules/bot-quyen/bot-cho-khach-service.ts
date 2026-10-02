// SPDX-License-Identifier: AGPL-3.0-or-later
// CHO KHÁCH (docs/79 T5) — nghiệp vụ: danh mục bot đẩy lên + duyệt tài liệu RAG / mô tả SP cho đường khách của bot.
//
// Bất biến:
//   • MẶC ĐỊNH ĐÓNG: tài liệu chỉ "khách xem được" khi có dòng duyệt VÀ còn trong danh mục mới nhất VÀ băm nội dung trong danh
//     mục == băm lúc duyệt (bot so thêm với băm nội dung hiện tại của nó); mô tả chỉ dùng được khi băm hiện tại == băm đã duyệt
//     (bot so — K2). Chưa có danh mục ⇒ không duyệt được gì (409) và bot nhận danh sách tài liệu rỗng.
//   • Duyệt mô tả / tài liệu phải mang băm người duyệt ĐANG NHÌN: khác băm trong danh mục hiện tại (bot vừa đẩy nội dung mới)
//     ⇒ 409 MO_TA_DA_DOI / TAI_LIEU_DA_DOI — không bao giờ duyệt hộ một nội dung chưa ai đọc. Cả lô hỏng nếu một mục hỏng (không duyệt nửa vời).
//   • MỖI mục duyệt / bỏ duyệt ghi MỘT dòng BotQuyenNhatKy trong CÙNG giao dịch; ghi của một org nối đuôi nhau
//     (pg_advisory_xact_lock) — danh mục đọc TRONG giao dịch đó.
//   • Mọi truy vấn lọc theo orgId; route công khai chạy trong withTenant(org của KHOÁ).
import type { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import {
  LoiChoKhach, docDanhMuc, dungDuyetCongKhai, DANG_BAM,
  type DuyetCongKhai, type SanPhamDanhMuc, type TaiLieuDanhMuc,
} from './bot-cho-khach-hop-dong.js';

type Tx = Parameters<Parameters<typeof tenantTransaction>[0]>[0];
type Body = Record<string, unknown>;

/** Một lần duyệt / bỏ duyệt tối đa chừng này mục. */
export const TOI_DA_MOT_LO = 500;
const DAI_LY_DO = 500;

function laBody(x: unknown): Body {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Body) : {};
}

function sai(msg: string): never {
  throw new LoiChoKhach(400, 'DU_LIEU_KHONG_HOP_LE', msg);
}

function docLyDo(x: unknown): string | null {
  if (x === undefined || x === null) return null;
  if (typeof x !== 'string') sai('lyDo phải là chuỗi');
  const t = x.trim();
  if (t.length > DAI_LY_DO) sai(`lyDo dài quá ${DAI_LY_DO} ký tự`);
  return t || null;
}

function docLo<T>(x: unknown, ten: string, docMuc: (v: unknown, i: number) => T): T[] {
  if (!Array.isArray(x) || x.length === 0) sai(`${ten} phải là mảng có ít nhất một mục`);
  if (x.length > TOI_DA_MOT_LO) sai(`${ten} tối đa ${TOI_DA_MOT_LO} mục một lần`);
  return x.map(docMuc);
}

const docIdTaiLieu = (v: unknown, i: number): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) sai(`ids[${i}] không hợp lệ`);
  return v;
};
const docMucTaiLieu = (v: unknown, i: number): { id: string; noiDungBam: string } => {
  const o = laBody(v);
  const id = docIdTaiLieu(o.id, i);
  if (typeof o.noiDungBam !== 'string' || !DANG_BAM.test(o.noiDungBam)) sai(`taiLieu[${i}].noiDungBam phải là 64 ký tự hex`);
  return { id, noiDungBam: o.noiDungBam };
};
const docProductId = (v: unknown, i: number): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) sai(`productIds[${i}] phải là số nguyên dương`);
  return v;
};

async function khoaOrg(tx: Tx, orgId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-cho-khach:${orgId}`}))`;
}

interface DanhMucLuu {
  phienBan: string;
  luc: Date;
  taiLieu: TaiLieuDanhMuc[];
  sanPham: SanPhamDanhMuc[];
}

async function docDanhMucLuu(db: Tx | typeof prisma, orgId: string): Promise<DanhMucLuu | null> {
  const r = await db.botChoKhachDanhMuc.findUnique({ where: { orgId } });
  if (!r) return null;
  return {
    phienBan: r.phienBan, luc: r.luc,
    taiLieu: (r.taiLieu ?? []) as unknown as TaiLieuDanhMuc[],
    sanPham: (r.sanPham ?? []) as unknown as SanPhamDanhMuc[],
  };
}

async function tenNguoi(orgId: string, ids: string[]): Promise<Map<string, { id: string; fullName: string }>> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { orgId, id: { in: uniq } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u]));
}

async function ghiNhatKy(tx: Tx, rows: Array<{
  orgId: string; aiId: string; doiTuong: string; doiTuongId: string; truoc: object | null; sau: object | null; lyDo: string | null;
}>): Promise<void> {
  if (rows.length === 0) return;
  await tx.botQuyenNhatKy.createMany({
    data: rows.map((d) => ({
      orgId: d.orgId, aiId: d.aiId, doiTuong: d.doiTuong, doiTuongId: d.doiTuongId, lyDo: d.lyDo,
      ...(d.truoc ? { truoc: d.truoc as Prisma.InputJsonValue } : {}),
      ...(d.sau ? { sau: d.sau as Prisma.InputJsonValue } : {}),
    })),
  });
}

// ── Công khai (bot) ─────────────────────────────────────────────────────────

/**
 * Lưu danh mục MỚI NHẤT (thay bản cũ). Nhật ký `danh_muc_cho_khach` (ai = api_key:<id>) khi lần đầu hoặc khi tập tài liệu /
 * băm mô tả đổi — số lượng + tối đa 50 id mỗi loại (không chép nội dung).
 */
export async function luuDanhMuc(
  orgId: string, body: unknown, apiKeyId: string | null = null,
): Promise<{ ok: true; phien_ban: string; so_tai_lieu: number; so_san_pham: number }> {
  const d = docDanhMuc(body);
  const aiId = `api_key:${apiKeyId ?? 'khong_ro'}`;
  await withTenant(orgId, () => tenantTransaction(async (tx) => {
    await khoaOrg(tx, orgId);
    const cu = await docDanhMucLuu(tx, orgId);
    const data = {
      phienBan: d.phien_ban,
      taiLieu: d.tai_lieu as unknown as Prisma.InputJsonValue,
      sanPham: d.san_pham as unknown as Prisma.InputJsonValue,
    };
    const r = await tx.botChoKhachDanhMuc.upsert({ where: { orgId }, create: { orgId, ...data }, update: { ...data, luc: new Date() } });
    const tlCu = new Set((cu?.taiLieu ?? []).map((t) => t.id));
    const tlMoi = new Set(d.tai_lieu.map((t) => t.id));
    const bamCu = new Map((cu?.sanPham ?? []).map((s) => [s.product_id, s.mo_ta_bam]));
    const themTl = [...tlMoi].filter((x) => !tlCu.has(x)).sort();
    const boTl = [...tlCu].filter((x) => !tlMoi.has(x)).sort();
    const moTaDoi = d.san_pham.filter((s) => bamCu.has(s.product_id) && bamCu.get(s.product_id) !== s.mo_ta_bam)
      .map((s) => s.product_id).sort((a, b) => a - b);
    const spMoi = d.san_pham.filter((s) => !bamCu.has(s.product_id)).length;
    const spBo = (cu?.sanPham ?? []).length - (d.san_pham.length - spMoi);
    if (!cu || themTl.length + boTl.length + moTaDoi.length + spMoi + spBo > 0) {
      await ghiNhatKy(tx, [{
        orgId, aiId, doiTuong: 'danh_muc_cho_khach', doiTuongId: r.id, lyDo: null,
        truoc: cu ? { phienBan: cu.phienBan, soTaiLieu: cu.taiLieu.length, soSanPham: cu.sanPham.length } : null,
        sau: {
          phienBan: d.phien_ban, soTaiLieu: d.tai_lieu.length, soSanPham: d.san_pham.length,
          themTaiLieu: themTl.slice(0, 50), boTaiLieu: boTl.slice(0, 50), moTaDoi: moTaDoi.slice(0, 50),
          soMoTaDoi: moTaDoi.length,
        },
      }]);
    }
  }));
  return { ok: true, phien_ban: d.phien_ban, so_tai_lieu: d.tai_lieu.length, so_san_pham: d.san_pham.length };
}

/**
 * Bot đọc duyệt. `tai_lieu_cho_khach` = tài liệu đã duyệt CÒN trong danh mục mới nhất VỚI ĐÚNG băm nội dung lúc duyệt (không có
 * danh mục / nội dung đổi ⇒ không trả — mặc định đóng), kèm băm đó để bot so với nội dung hiện tại của nó. `mo_ta_da_duyet` = mọi duyệt kèm ĐÚNG băm lúc duyệt — bot chỉ dùng mô tả khi băm mô tả hiện tại của nó trùng.
 */
export async function docDuyetChoBot(orgId: string): Promise<DuyetCongKhai> {
  return withTenant(orgId, async () => {
    const [dm, tl, mt] = await Promise.all([
      docDanhMucLuu(prisma, orgId),
      prisma.botTaiLieuChoKhach.findMany({ where: { orgId }, select: { taiLieuId: true, noiDungBam: true } }),
      prisma.botMoTaDuyet.findMany({ where: { orgId }, select: { productId: true, moTaBam: true } }),
    ]);
    const bamDm = new Map((dm?.taiLieu ?? []).map((t) => [t.id, t.noi_dung_bam]));
    return dungDuyetCongKhai(tl.filter((r) => !!r.noiDungBam && bamDm.get(r.taiLieuId) === r.noiDungBam), mt, dm?.phienBan ?? null);
  });
}

// ── Quản trị: tài liệu ──────────────────────────────────────────────────────

/** `khong_noi_dung` = tài liệu rỗng (băm null) — không duyệt được. `doi_sau_duyet` = nội dung (hoặc rỗng) khác lúc duyệt. */
export type TrangThaiTaiLieu = 'khong_noi_dung' | 'chua_duyet' | 'da_duyet' | 'doi_sau_duyet';

export interface TaiLieuView {
  id: string;
  tieuDe: string;
  loai: string | null;
  nguon: string | null;
  soDoan: number;
  capNhatLuc: string | null;
  mauNoiDung: string | null;
  noiDungBam: string | null;
  trangThai: TrangThaiTaiLieu;
  /** Băm lúc duyệt (khác noiDungBam ⇔ doi_sau_duyet). */
  noiDungBamDaDuyet: string | null;
  /** = trangThai 'da_duyet' (bot dùng được). */
  choKhach: boolean;
  duyetBoi: { id: string; fullName: string } | null;
  duyetLuc: Date | null;
}

export async function danhSachTaiLieu(orgId: string): Promise<{
  danhMuc: { phienBan: string; luc: Date } | null; taiLieu: TaiLieuView[]; duyetNgoaiDanhMuc: string[];
}> {
  const [dm, duyet] = await Promise.all([
    docDanhMucLuu(prisma, orgId),
    prisma.botTaiLieuChoKhach.findMany({ where: { orgId } }),
  ]);
  const theoId = new Map(duyet.map((r) => [r.taiLieuId, r]));
  const nguoi = await tenNguoi(orgId, duyet.map((r) => r.duyetBoi));
  const taiLieu = (dm?.taiLieu ?? []).map((t): TaiLieuView => {
    const r = theoId.get(t.id);
    const trangThai: TrangThaiTaiLieu = !t.noi_dung_bam ? (r ? 'doi_sau_duyet' : 'khong_noi_dung')
      : !r ? 'chua_duyet' : r.noiDungBam === t.noi_dung_bam ? 'da_duyet' : 'doi_sau_duyet';
    return {
      id: t.id, tieuDe: t.tieu_de, loai: t.loai, nguon: t.nguon, soDoan: t.so_doan, capNhatLuc: t.cap_nhat_luc,
      mauNoiDung: t.mau_noi_dung, noiDungBam: t.noi_dung_bam, trangThai, noiDungBamDaDuyet: r?.noiDungBam ?? null,
      choKhach: trangThai === 'da_duyet',
      duyetBoi: r ? (nguoi.get(r.duyetBoi) ?? { id: r.duyetBoi, fullName: '' }) : null, duyetLuc: r?.luc ?? null,
    };
  });
  const coTrong = new Set(taiLieu.map((t) => t.id));
  return {
    danhMuc: dm ? { phienBan: dm.phienBan, luc: dm.luc } : null,
    taiLieu,
    duyetNgoaiDanhMuc: duyet.map((r) => r.taiLieuId).filter((id) => !coTrong.has(id)).sort(),
  };
}

/**
 * Duyệt tài liệu: mỗi mục {id, noiDungBam} — noiDungBam là băm nội dung người duyệt ĐANG NHÌN, phải bằng băm trong danh mục hiện
 * tại (409 TAI_LIEU_DA_DOI nếu bot vừa nạp lại nội dung mới, hoặc tài liệu rỗng). Đã duyệt đúng băm đó ⇒ không đổi; duyệt lại sau
 * khi nội dung đổi ⇒ ghi băm mới. Cả lô hỏng nếu một mục hỏng.
 */
export async function duyetTaiLieu(orgId: string, aiId: string, body: unknown): Promise<{ doi: number }> {
  const b = laBody(body);
  const muc = docLo(b.taiLieu, 'taiLieu', docMucTaiLieu);
  const lyDo = docLyDo(b.lyDo);
  const theoIdGui = new Map<string, string>();
  for (const m of muc) {
    if (theoIdGui.has(m.id) && theoIdGui.get(m.id) !== m.noiDungBam) sai(`Tài liệu ${m.id} lặp với hai băm khác nhau`);
    theoIdGui.set(m.id, m.noiDungBam);
  }
  return tenantTransaction(async (tx) => {
    await khoaOrg(tx, orgId);
    const dm = await docDanhMucLuu(tx, orgId);
    if (!dm) throw new LoiChoKhach(409, 'CHUA_CO_DANH_MUC', 'Bot chưa gửi danh mục tài liệu — chưa duyệt được');
    const theoId = new Map(dm.taiLieu.map((t) => [t.id, t]));
    const ids = [...theoIdGui.keys()];
    const thieu = ids.filter((id) => !theoId.has(id));
    if (thieu.length > 0) {
      throw new LoiChoKhach(409, 'KHONG_CO_TRONG_DANH_MUC', `Tài liệu không còn trong danh mục bot gửi: ${thieu.slice(0, 5).join(', ')} — tải lại trang`);
    }
    const lech = ids.filter((id) => { const t = theoId.get(id)!; return !t.noi_dung_bam || t.noi_dung_bam !== theoIdGui.get(id); });
    if (lech.length > 0) {
      throw new LoiChoKhach(
        409, 'TAI_LIEU_DA_DOI',
        `Nội dung tài liệu đã đổi hoặc tài liệu rỗng (${lech.slice(0, 5).map((id) => `“${theoId.get(id)!.tieu_de}”`).join(', ')}) — tải lại, xem nội dung mới rồi duyệt`,
      );
    }
    const cu = new Map((await tx.botTaiLieuChoKhach.findMany({ where: { orgId, taiLieuId: { in: ids } } })).map((r) => [r.taiLieuId, r]));
    const nhat: Parameters<typeof ghiNhatKy>[1] = [];
    for (const [id, bam] of theoIdGui) {
      const r = cu.get(id);
      if (r?.noiDungBam === bam) continue;
      const tieuDe = theoId.get(id)!.tieu_de;
      if (r) await tx.botTaiLieuChoKhach.update({ where: { id: r.id }, data: { noiDungBam: bam, duyetBoi: aiId, luc: new Date() } });
      else await tx.botTaiLieuChoKhach.create({ data: { orgId, taiLieuId: id, noiDungBam: bam, duyetBoi: aiId } });
      nhat.push({
        orgId, aiId, doiTuong: 'tai_lieu_cho_khach', doiTuongId: id, lyDo,
        truoc: r ? { tieuDe, choKhach: true, noiDungBam: r.noiDungBam } : { tieuDe, choKhach: false },
        sau: { tieuDe, choKhach: true, noiDungBam: bam },
      });
    }
    await ghiNhatKy(tx, nhat);
    return { doi: nhat.length };
  });
}

/** Bỏ duyệt luôn được (kể cả tài liệu đã rời danh mục / chưa có danh mục) — bớt thứ khách thấy không làm lộ gì. */
export async function boDuyetTaiLieu(orgId: string, aiId: string, body: unknown): Promise<{ doi: number }> {
  const b = laBody(body);
  const ids = [...new Set(docLo(b.ids, 'ids', docIdTaiLieu))];
  const lyDo = docLyDo(b.lyDo);
  return tenantTransaction(async (tx) => {
    await khoaOrg(tx, orgId);
    const co = await tx.botTaiLieuChoKhach.findMany({ where: { orgId, taiLieuId: { in: ids } }, select: { taiLieuId: true } });
    if (co.length === 0) return { doi: 0 };
    const dm = await docDanhMucLuu(tx, orgId);
    const ten = new Map((dm?.taiLieu ?? []).map((t) => [t.id, t.tieu_de]));
    await tx.botTaiLieuChoKhach.deleteMany({ where: { orgId, taiLieuId: { in: co.map((r) => r.taiLieuId) } } });
    await ghiNhatKy(tx, co.map((r) => ({
      orgId, aiId, doiTuong: 'tai_lieu_cho_khach', doiTuongId: r.taiLieuId, lyDo,
      truoc: { tieuDe: ten.get(r.taiLieuId) ?? null, choKhach: true }, sau: { tieuDe: ten.get(r.taiLieuId) ?? null, choKhach: false },
    })));
    return { doi: co.length };
  });
}

// ── Quản trị: mô tả SP ──────────────────────────────────────────────────────

export type TrangThaiMoTa = 'khong_mo_ta' | 'chua_duyet' | 'da_duyet' | 'doi_sau_duyet';
export const LOC_MO_TA = ['co_mo_ta', 'da_duyet', 'doi_sau_duyet', 'tat_ca'] as const;
export type LocMoTa = typeof LOC_MO_TA[number];

export interface MoTaView {
  productId: number;
  ma: string | null;
  ten: string;
  moTaBan: string | null;
  moTaBam: string | null;
  trangThai: TrangThaiMoTa;
  /** Băm lúc duyệt (khác moTaBam ⇔ doi_sau_duyet). */
  moTaBamDaDuyet: string | null;
  duyetBoi: { id: string; fullName: string } | null;
  duyetLuc: Date | null;
}

export async function danhSachMoTa(orgId: string, locRaw: unknown): Promise<{
  danhMuc: { phienBan: string; luc: Date } | null;
  sanPham: MoTaView[];
  dem: { coMoTa: number; daDuyet: number; doiSauDuyet: number; chuaDuyet: number; tong: number };
}> {
  const loc = (locRaw === undefined || locRaw === '' ? 'co_mo_ta' : locRaw) as LocMoTa;
  if (!LOC_MO_TA.includes(loc)) sai(`loc phải là một trong ${LOC_MO_TA.join(', ')}`);
  const [dm, duyet] = await Promise.all([
    docDanhMucLuu(prisma, orgId),
    prisma.botMoTaDuyet.findMany({ where: { orgId } }),
  ]);
  const theoId = new Map(duyet.map((r) => [r.productId, r]));
  const nguoi = await tenNguoi(orgId, duyet.map((r) => r.duyetBoi));
  const tatCa = (dm?.sanPham ?? []).map((s): MoTaView => {
    const r = theoId.get(s.product_id);
    const trangThai: TrangThaiMoTa = !s.mo_ta_bam ? (r ? 'doi_sau_duyet' : 'khong_mo_ta')
      : !r ? 'chua_duyet' : r.moTaBam === s.mo_ta_bam ? 'da_duyet' : 'doi_sau_duyet';
    return {
      productId: s.product_id, ma: s.ma, ten: s.ten, moTaBan: s.mo_ta_ban, moTaBam: s.mo_ta_bam, trangThai,
      moTaBamDaDuyet: r?.moTaBam ?? null,
      duyetBoi: r ? (nguoi.get(r.duyetBoi) ?? { id: r.duyetBoi, fullName: '' }) : null, duyetLuc: r?.luc ?? null,
    };
  });
  const dem = {
    coMoTa: tatCa.filter((s) => s.moTaBam).length,
    daDuyet: tatCa.filter((s) => s.trangThai === 'da_duyet').length,
    doiSauDuyet: tatCa.filter((s) => s.trangThai === 'doi_sau_duyet').length,
    chuaDuyet: tatCa.filter((s) => s.trangThai === 'chua_duyet').length,
    tong: tatCa.length,
  };
  const sanPham = tatCa.filter((s) => loc === 'tat_ca' ? true
    : loc === 'co_mo_ta' ? !!s.moTaBam || s.trangThai === 'doi_sau_duyet'
      : s.trangThai === loc);
  return { danhMuc: dm ? { phienBan: dm.phienBan, luc: dm.luc } : null, sanPham, dem };
}

/**
 * Duyệt mô tả: mỗi mục {productId, moTaBam} — moTaBam là băm người duyệt ĐANG NHÌN, phải bằng băm trong danh mục hiện tại
 * (409 MO_TA_DA_DOI nếu bot vừa đẩy mô tả mới). Đã duyệt đúng băm đó ⇒ không đổi. Duyệt lại sau khi mô tả đổi ⇒ ghi băm mới.
 */
export async function duyetMoTa(orgId: string, aiId: string, body: unknown): Promise<{ doi: number }> {
  const b = laBody(body);
  const muc = docLo(b.sanPham, 'sanPham', (v, i) => {
    const o = laBody(v);
    const productId = docProductId(o.productId, i);
    if (typeof o.moTaBam !== 'string' || !DANG_BAM.test(o.moTaBam)) sai(`sanPham[${i}].moTaBam phải là 64 ký tự hex`);
    return { productId, moTaBam: o.moTaBam };
  });
  const lyDo = docLyDo(b.lyDo);
  const theoSp = new Map<number, string>();
  for (const m of muc) {
    if (theoSp.has(m.productId) && theoSp.get(m.productId) !== m.moTaBam) sai(`productId ${m.productId} lặp với hai băm khác nhau`);
    theoSp.set(m.productId, m.moTaBam);
  }
  return tenantTransaction(async (tx) => {
    await khoaOrg(tx, orgId);
    const dm = await docDanhMucLuu(tx, orgId);
    if (!dm) throw new LoiChoKhach(409, 'CHUA_CO_DANH_MUC', 'Bot chưa gửi danh mục sản phẩm — chưa duyệt được');
    const spDm = new Map(dm.sanPham.map((s) => [s.product_id, s]));
    const lech: number[] = [];
    for (const [pid, bam] of theoSp) {
      const s = spDm.get(pid);
      if (!s || !s.mo_ta_bam || s.mo_ta_bam !== bam) lech.push(pid);
    }
    if (lech.length > 0) {
      throw new LoiChoKhach(
        409, 'MO_TA_DA_DOI',
        `Mô tả đã đổi hoặc không còn trong danh mục (SP ${lech.slice(0, 5).join(', ')}) — tải lại, đọc mô tả mới rồi duyệt`,
      );
    }
    const ids = [...theoSp.keys()];
    const cu = new Map((await tx.botMoTaDuyet.findMany({ where: { orgId, productId: { in: ids } } })).map((r) => [r.productId, r]));
    const nhat: Parameters<typeof ghiNhatKy>[1] = [];
    for (const [pid, bam] of theoSp) {
      const r = cu.get(pid);
      if (r?.moTaBam === bam) continue;
      const ten = spDm.get(pid)!.ten;
      if (r) await tx.botMoTaDuyet.update({ where: { id: r.id }, data: { moTaBam: bam, duyetBoi: aiId, luc: new Date() } });
      else await tx.botMoTaDuyet.create({ data: { orgId, productId: pid, moTaBam: bam, duyetBoi: aiId } });
      nhat.push({
        orgId, aiId, doiTuong: 'mo_ta_duyet', doiTuongId: String(pid), lyDo,
        truoc: r ? { ten, moTaBam: r.moTaBam } : null, sau: { ten, moTaBam: bam },
      });
    }
    await ghiNhatKy(tx, nhat);
    return { doi: nhat.length };
  });
}

/** Bỏ duyệt mô tả — luôn được. */
export async function boDuyetMoTa(orgId: string, aiId: string, body: unknown): Promise<{ doi: number }> {
  const b = laBody(body);
  const ids = [...new Set(docLo(b.productIds, 'productIds', docProductId))];
  const lyDo = docLyDo(b.lyDo);
  return tenantTransaction(async (tx) => {
    await khoaOrg(tx, orgId);
    const co = await tx.botMoTaDuyet.findMany({ where: { orgId, productId: { in: ids } } });
    if (co.length === 0) return { doi: 0 };
    const dm = await docDanhMucLuu(tx, orgId);
    const ten = new Map((dm?.sanPham ?? []).map((s) => [s.product_id, s.ten]));
    await tx.botMoTaDuyet.deleteMany({ where: { orgId, id: { in: co.map((r) => r.id) } } });
    await ghiNhatKy(tx, co.map((r) => ({
      orgId, aiId, doiTuong: 'mo_ta_duyet', doiTuongId: String(r.productId), lyDo,
      truoc: { ten: ten.get(r.productId) ?? null, moTaBam: r.moTaBam }, sau: null,
    })));
    return { doi: co.length };
  });
}
