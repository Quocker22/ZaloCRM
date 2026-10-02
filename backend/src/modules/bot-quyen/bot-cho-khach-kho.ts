// SPDX-License-Identifier: AGPL-3.0-or-later
// Nguồn thông số kỹ thuật cho bot = KHO TRI THỨC CỦA CRM (knowledge_documents / knowledge_chunks) — docs/79, sửa 02/10 tối
// (chủ: thông số kỹ thuật nằm ở kho tri thức CRM, không phải kb_documents của bot).
//
// Hai đường tìm, cùng một bộ xếp hạng (`xepHangDoan` — hybrid vector + từ khoá y như agent CRM):
//   • KHÁCH  (POST /api/public/cho-khach/tim):  CHỈ tài liệu đã DUYỆT "khách xem được" mà băm nội dung HIỆN TẠI (§3b, tính từ
//     CHÍNH các đoạn vừa đọc để xếp hạng — không đọc lại giữa chừng) == băm lúc duyệt. Chưa duyệt / đổi sau duyệt ⇒ không bao giờ.
//   • NHÂN VIÊN (POST /api/public/tai-lieu-ky-thuat/tim): mọi tài liệu của org — NV vốn đọc cả kho (tool tra_tri_thuc cũ).
// Lưới chung: mỗi đoạn trả bot bị bỏ DÒNG có giá/tiền, SĐT, đường dẫn/email, số tồn, liên hệ mua bán (không đụng dòng thông số).
// Bot còn bộ kiểm riêng (đường khách: số phải có trong nguồn, không giá/SĐT/link).
import { prisma } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';
import { generateEmbedding } from '../ai/knowledge/embedding.js';
import { xepHangDoan, type EmbedConfig } from '../ai/knowledge/knowledge-service.js';
import { doanCoGia } from '../ai/odoo/tools/tra-tri-thuc.js';
import { LoiChoKhach, bamNoiDungTaiLieu, soKyTu } from './bot-cho-khach-hop-dong.js';

/** Mẫu đầu nội dung cho người duyệt nhìn (code point). */
export const MAU_KY_TU = 300;
export const SO_DOAN_TOI_DA = 5;
const SO_DOAN_MAC_DINH = 3;
const DAI_TRUY_VAN = 500;
const DAI_TEN = 500;
const DAI_MA = 128;
const NEO_NHOM_TOI_DA = 8;
const NEO_LUA_CHON_TOI_DA = 6;
const DANG_NEO = /^[0-9a-z]{1,40}$/;
/** Ứng viên tối thiểu lấy từ bộ xếp hạng (thực tế: mọi ứng viên sau lọc neo). */
const UNG_VIEN = 40;

function boDau(s: string): string {
  return s.normalize('NFC').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
}

// ── Băm (hợp đồng §3b) ──────────────────────────────────────────────────────────────────────────────────────────────

/** Băm nội dung tài liệu từ các đoạn knowledge_chunks: sắp ord tăng dần (phá hoà theo id), nối "\n", chuẩn hoá §3, sha256. */
export function bamTuDoan(doan: ReadonlyArray<{ id: string; ord: number; content: string }>): string | null {
  const s = [...doan].sort((a, b) => a.ord - b.ord || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return bamNoiDungTaiLieu(s.map((x) => x.content));
}

// ── Dòng bẩn + dấu hiệu nội bộ ─────────────────────────────────────────────────────────────────────────────────────

const CHU_NOI_BO: Array<[string, string]> = [
  ['bang gia', 'bảng giá'], ['bao gia', 'báo giá'], ['gia von', 'giá vốn'], ['gia nhap', 'giá nhập'], ['gia dai ly', 'giá đại lý'],
  ['gia si', 'giá sỉ'], ['chiet khau', 'chiết khấu'], ['noi bo', 'nội bộ'], ['cong no', 'công nợ'], ['hoa hong', 'hoa hồng'],
  ['ton kho', 'tồn kho'], ['so luong ton', 'số lượng tồn'],
];

/** Một DÒNG có giá/tiền? "3000K", "60 bóng/m", "16,7 triệu màu", "50.000 giờ", "Giá trị" KHÔNG phải tiền. */
export function dongCoGia(dong: string): boolean {
  if (doanCoGia(dong)) return true;
  const k = boDau(dong);
  if (/\bgia\s*(ban|von|si|le|nhap|dai ly|tot|niem yet|khuyen mai|uu dai|goc|tham khao)\b/.test(k)) return true;
  if (/\b(chiet khau|giam gia|bang gia|bao gia)\b/.test(k)) return true;
  if (/\d[\d.,]*\s*(?:₫|đ|vnđ|vnd|usd)(?![a-zà-ỹ])/i.test(dong)) return true;
  if (/(?:^|[^\w])\$\s*\d|\d\s*\$/.test(dong)) return true;
  if (/(?<![\w.,])\d[\d.,]*\s?k(?![a-zA-Z0-9])/.test(dong)) return true;   // "120k", "1200k", "1.200k" — K HOA là nhiệt độ màu
  if (/\d\s?tr(?:\d|(?![a-zà-ỹ]))/i.test(dong)) return true;                           // "1tr2", "1,2tr"
  return false;
}

const RE_SDT = /(?<!\d)(?:\+?84[\s.-]?|0)(?:[35789]\d|2\d{2})(?:[\s.-]?\d){7}(?!\d)/;
const RE_LINK = /\b(?:https?:\/\/|www\.)|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|vn|net|org|info|biz|io|cn|dev|shop|store|xyz)\b/i;
const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const RE_TON = /\b(?:ton(?:\s*kho)?|so luong ton|sl ton|hang ton|con hang|con lai|stock|in stock|inventory)\s*[:=]?\s*\d|\bcon\s*\d[\d.,]*\s*(?:tam|cai|cuon|bo|chiec|met|m|hop|thung|module)\b/;
/** Tiêu đề cột bảng mang giá/tồn ⇒ bỏ CẢ CỘT (dòng hàng chỉ là số trơn, không tự lộ nghĩa). */
const RE_COT_BAN = /\b(?:gia|don gia|thanh tien|price|cost|ton|ton kho|sl ton|stock|inventory|con hang|so luong|sl|chiet khau|ck)\b/;
const RE_LIEN_HE = /\b(?:lien he|hotline|zalo|goi ngay|inbox|nhan tin|san hang|san so luong|co san hang)\b/;

/** Dòng KHÔNG được tới bot: giá/tiền, SĐT, đường dẫn, email, số tồn, liên hệ mua bán. */
export function dongBan(dong: string): boolean {
  const k = boDau(dong);
  return dongCoGia(dong) || RE_SDT.test(dong) || RE_LINK.test(dong) || RE_EMAIL.test(dong) || RE_TON.test(k) || RE_LIEN_HE.test(k);
}

const laDongBang = (d: string): boolean => (d.match(/\|/g) ?? []).length >= 2 || (d.match(/\t/g) ?? []).length >= 1;
const laDongKe = (d: string): boolean => /^[\s|:+-]+$/.test(d) && d.includes('-');

function oBang(d: string): { cells: string[]; tach: string } {
  const tach = (d.match(/\|/g) ?? []).length >= 2 ? '|' : '\t';
  let t = d.trim();
  if (tach === '|') t = t.replace(/^\|/, '').replace(/\|$/, '');
  return { cells: t.split(tach).map((x) => x.trim()), tach };
}

/**
 * Bảng (markdown "|" hoặc tab): dòng ĐẦU là tiêu đề; cột nào có tiêu đề giá/tồn/số lượng/chiết khấu ⇒ bỏ cả cột ở MỌI dòng của
 * bảng (giá "120" trong ô không có chữ "đ" nên lưới theo dòng không bắt được). Sau đó vẫn qua lưới theo dòng.
 */
function boCotBan(dong: string[]): string[] {
  const ra: string[] = [];
  let i = 0;
  while (i < dong.length) {
    if (!laDongBang(dong[i])) { ra.push(dong[i]); i++; continue; }
    let j = i;
    while (j < dong.length && (laDongBang(dong[j]) || laDongKe(dong[j]))) j++;
    const khoi = dong.slice(i, j);
    const dau = oBang(khoi[0]);
    const bo = new Set(dau.cells.map((c, k) => (RE_COT_BAN.test(boDau(c)) ? k : -1)).filter((k) => k >= 0));
    for (const d of khoi) {
      if (laDongKe(d)) continue;
      if (bo.size === 0) { ra.push(d); continue; }
      const giu = oBang(d).cells.filter((_, k) => !bo.has(k));
      if (giu.some((c) => c)) ra.push(dau.tach === '|' ? `| ${giu.join(' | ')} |` : giu.join('\t'));
    }
    i = j;
  }
  return ra;
}

/** Bỏ cột giá/tồn của bảng, rồi bỏ dòng bẩn; giữ dòng còn lại theo thứ tự. Mọi dòng bẩn ⇒ ''. */
export function lamSachChoKhach(noiDung: string): string {
  return boCotBan(noiDung.replace(/\r\n?/g, '\n').split('\n')).filter((d) => d.trim() && !dongBan(d)).join('\n').trim();
}

/** Tiêu đề tài liệu cũng tới khách/NV — có giá/SĐT/link/tồn ⇒ thay bằng nhãn trung tính. */
export function tieuDeSach(tieuDe: string): string {
  return tieuDe && !dongBan(tieuDe) ? tieuDe : 'Tài liệu kỹ thuật';
}

/**
 * Lý do một tài liệu "có vẻ nội bộ" — xét tiêu đề + TOÀN VĂN (CRM giữ toàn văn ⇒ bảng giá ở trang cuối vẫn thấy). Chỉ để
 * NHẮC người duyệt; dòng giá/SĐT/link vẫn bị bỏ khi trả bot dù tài liệu đã duyệt.
 */
export function dauHieuNoiBo(tieuDe: string, doan: readonly string[]): string[] {
  const ra: string[] = [];
  const k = ` ${boDau(`${tieuDe}\n${doan.join('\n')}`).replace(/[^a-z0-9]+/g, ' ')} `;
  for (const [c, hien] of CHU_NOI_BO) if (k.includes(` ${c} `)) ra.push(`chữ “${hien}”`);
  let gia = 0;
  let sdt = 0;
  let link = 0;
  let ton = 0;
  for (const d of doan.join('\n').split('\n')) {
    if (!d.trim()) continue;
    if (dongCoGia(d)) gia++;
    if (RE_SDT.test(d)) sdt++;
    if (RE_LINK.test(d) || RE_EMAIL.test(d)) link++;
    if (RE_TON.test(boDau(d))) ton++;
  }
  if (gia) ra.push(`${gia} dòng có giá/tiền (bot bỏ các dòng này)`);
  if (ton) ra.push(`${ton} dòng có số tồn (bot bỏ)`);
  if (sdt) ra.push(`${sdt} dòng có số điện thoại (bot bỏ)`);
  if (link) ra.push(`${link} dòng có đường dẫn/email (bot bỏ)`);
  return ra;
}

/**
 * NÊN LOẠI TRỪ khỏi đường khách — tín hiệu MẠNH, hẹp hơn `dauHieuNoiBo` (vốn đếm cả dòng link/email/giá lẻ — datasheet nào cũng có,
 * 02/10 khuya đề xuất nhầm 23/29 datasheet): chữ nội bộ (bảng giá, giá đại lý, công nợ…) ở tiêu đề/toàn văn, HOẶC tài liệu mà
 * ≥ 20% dòng (và ≥ 5 dòng) có giá/tiền/số tồn — bảng giá, catalog giá + tồn.
 */
export function nenLoaiTru(tieuDe: string, doan: readonly string[]): string[] {
  const ra: string[] = [];
  const k = ` ${boDau(`${tieuDe}\n${doan.join('\n')}`).replace(/[^a-z0-9]+/g, ' ')} `;
  for (const [c, hien] of CHU_NOI_BO) if (k.includes(` ${c} `)) ra.push(`chữ “${hien}”`);
  const dong = doan.join('\n').split('\n').filter((d) => d.trim());
  const ban = dong.filter((d) => dongCoGia(d) || RE_TON.test(boDau(d))).length;
  const tieuDeBan = /\b(gia|ton)\b/.test(boDau(tieuDe));
  if (ban >= 5 && ban / Math.max(1, dong.length) >= 0.2) ra.push(`${ban}/${dong.length} dòng có giá/tồn`);
  else if (tieuDeBan && ban > 0) ra.push('tiêu đề nói giá/tồn');
  return ra;
}

export function mauNoiDung(doan: readonly string[]): string | null {
  const s = doan.join('\n').trim();
  if (!s) return null;
  const a = Array.from(s);
  return a.length > MAU_KY_TU ? a.slice(0, MAU_KY_TU).join('') : s;
}

// ── Token / neo định danh SP ────────────────────────────────────────────────────────────────────────────────────────

/** Token như bot (`khach.nguon._tap_token_tai_lieu`): [0-9a-z]+ sau khi bỏ dấu, kèm ghép 2–3 token liền nhau. */
export function tapToken(text: string): Set<string> {
  const t = boDau(text).match(/[0-9a-z]+/g) ?? [];
  const ra = new Set(t);
  for (let i = 0; i < t.length; i++) {
    if (i + 1 < t.length) ra.add(t[i] + t[i + 1]);
    if (i + 2 < t.length) ra.add(t[i] + t[i + 1] + t[i + 2]);
  }
  return ra;
}

/** Mọi nhóm neo phải có ít nhất một lựa chọn trong tập token. Không neo ⇒ true. */
export function khopNeo(neo: readonly (readonly string[])[] | null | undefined, tap: Set<string>): boolean {
  if (!neo || neo.length === 0) return true;
  return neo.every((g) => g.some((x) => tap.has(x)));
}

// ── Yêu cầu tìm ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SanPhamTim {
  ten: string | null;
  ma: string | null;
  /** Nhóm neo định danh (bot dựng): đoạn (kèm tiêu đề tài liệu) phải khớp MỌI nhóm. */
  neo?: string[][];
}

export interface YeuCauTim {
  truyVan: string;
  soDoan: number;
  sanPham: SanPhamTim | null;
}

function saiTim(msg: string): never {
  throw new LoiChoKhach(400, 'YEU_CAU_TIM_KHONG_HOP_LE', msg);
}

function chuoiTuyChon(x: unknown, ten: string, toiDa: number): string | null {
  if (x === undefined || x === null) return null;
  if (typeof x !== 'string') saiTim(`${ten} phải là chuỗi hoặc null`);
  const t = x.trim();
  if (soKyTu(t) > toiDa) saiTim(`${ten} dài quá ${toiDa} ký tự`);
  return t || null;
}

/** Kiểm thân POST …/tim. Sai ⇒ 400 YEU_CAU_TIM_KHONG_HOP_LE. */
export function docYeuCauTim(body: unknown): YeuCauTim {
  if (!body || typeof body !== 'object' || Array.isArray(body)) saiTim('Thân phải là object JSON');
  const b = body as Record<string, unknown>;
  const truyVan = chuoiTuyChon(b.truy_van, 'truy_van', DAI_TRUY_VAN);
  if (!truyVan) saiTim('truy_van bắt buộc');
  let soDoan = SO_DOAN_MAC_DINH;
  if (b.so_doan !== undefined && b.so_doan !== null) {
    if (typeof b.so_doan !== 'number' || !Number.isInteger(b.so_doan) || b.so_doan < 1 || b.so_doan > SO_DOAN_TOI_DA) {
      saiTim(`so_doan là số nguyên 1–${SO_DOAN_TOI_DA}`);
    }
    soDoan = b.so_doan;
  }
  let sanPham: SanPhamTim | null = null;
  if (b.san_pham !== undefined && b.san_pham !== null) {
    if (typeof b.san_pham !== 'object' || Array.isArray(b.san_pham)) saiTim('san_pham phải là object hoặc null');
    const s = b.san_pham as Record<string, unknown>;
    sanPham = { ten: chuoiTuyChon(s.ten, 'san_pham.ten', DAI_TEN), ma: chuoiTuyChon(s.ma, 'san_pham.ma', DAI_MA) };
    if (s.neo !== undefined && s.neo !== null) {
      if (!Array.isArray(s.neo) || s.neo.length > NEO_NHOM_TOI_DA) saiTim(`san_pham.neo là mảng ≤ ${NEO_NHOM_TOI_DA} nhóm`);
      sanPham.neo = s.neo.map((g, i) => {
        if (!Array.isArray(g) || g.length < 1 || g.length > NEO_LUA_CHON_TOI_DA
            || !g.every((x) => typeof x === 'string' && DANG_NEO.test(x))) {
          saiTim(`san_pham.neo[${i}] là mảng 1–${NEO_LUA_CHON_TOI_DA} chuỗi [0-9a-z]{1,40}`);
        }
        return g as string[];
      });
    }
  }
  return { truyVan, soDoan, sanPham };
}

/** Đoạn nói ĐÚNG mã SP (bỏ dấu/gạch/khoảng) lên đầu; phần còn lại giữ thứ tự. Mã < 3 ký tự ⇒ không đổi. */
export function uuTienTheoSanPham<T extends { tieuDe: string; noiDung: string }>(ds: readonly T[], sp: SanPhamTim | null): T[] {
  const ma = sp?.ma ? boDau(sp.ma).replace(/[^0-9a-z]+/g, '') : '';
  if (ma.length < 3) return [...ds];
  const co = (x: T) => boDau(`${x.tieuDe}\n${x.noiDung}`).replace(/[^0-9a-z]+/g, '').includes(ma);
  return [...ds.filter(co), ...ds.filter((x) => !co(x))];
}

// ── Đọc kho ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Bề mặt Prisma tối thiểu (client thường lẫn client giao dịch đều khớp — kiểu sinh của hai client không hợp nhau). */
export interface KhoDb {
  knowledgeDocument: {
    findMany(args: { where: Record<string, unknown>; select: { id: true; title: true; source: true; updatedAt: true } }):
      Promise<Array<{ id: string; title: string; source: string; updatedAt: Date }>>;
  };
  knowledgeChunk: {
    findMany(args: { where: Record<string, unknown>; select: { id: true; documentId: true; ord: true; content: true } }):
      Promise<Array<{ id: string; documentId: string; ord: number; content: string }>>;
  };
}

export interface TaiLieuKho {
  id: string;
  tieuDe: string;
  nguon: string;
  capNhatLuc: Date;
  /** Đoạn theo ord tăng dần (phá hoà theo id). */
  doan: string[];
  /** §3b — null = không đoạn / rỗng (không duyệt được). */
  noiDungBam: string | null;
}

/** Tài liệu của org kèm đoạn + băm (CRM tự tính) — `ids` để chỉ đọc vài tài liệu. Sắp theo tiêu đề. */
export async function docKho(db: KhoDb, orgId: string, ids?: readonly string[]): Promise<TaiLieuKho[]> {
  const [docs, chunks] = await Promise.all([
    db.knowledgeDocument.findMany({
      where: ids ? { orgId, id: { in: [...ids] } } : { orgId },
      select: { id: true, title: true, source: true, updatedAt: true },
    }),
    db.knowledgeChunk.findMany({
      where: ids ? { orgId, documentId: { in: [...ids] } } : { orgId },
      select: { id: true, documentId: true, ord: true, content: true },
    }),
  ]);
  const theoDoc = new Map<string, Array<{ id: string; ord: number; content: string }>>();
  for (const c of chunks) {
    const a = theoDoc.get(c.documentId) ?? [];
    a.push(c);
    theoDoc.set(c.documentId, a);
  }
  return docs.map((d) => {
    const ds = [...(theoDoc.get(d.id) ?? [])].sort((a, b) => a.ord - b.ord || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
      id: d.id, tieuDe: d.title, nguon: d.source, capNhatLuc: d.updatedAt, doan: ds.map((x) => x.content), noiDungBam: bamTuDoan(ds),
    };
  }).sort((a, b) => a.tieuDe.localeCompare(b.tieuDe, 'vi') || (a.id < b.id ? -1 : 1));
}

// ── Tìm ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DoanTim {
  tai_lieu_id: string;
  tieu_de: string;
  noi_dung: string;
  diem: number;
}

export interface DepsTim {
  embed: typeof generateEmbedding;
  cfg: EmbedConfig;
}

/** Cấu hình embedding như agent CRM (`du-lieu.ts:timTriThuc`). Thiếu EMBED_BASE_URL ⇒ embed ném ⇒ chỉ tìm theo từ khoá. */
export function depsTuEnv(): DepsTim {
  return {
    embed: generateEmbedding,
    cfg: {
      provider: process.env.EMBED_PROVIDER ?? 'openai',
      model: process.env.EMBED_MODEL ?? 'google/gemini-embedding-001',
      baseUrl: process.env.EMBED_BASE_URL || undefined,
      apiKey: process.env.EMBED_API_KEY,
    },
  };
}

interface HangDoan {
  id: string;
  documentId: string;
  ord: number;
  content: string;
  embedding: number[];
  embedDim: number;
}

async function xepVaLoc(
  yc: YeuCauTim, rows: readonly HangDoan[], tieuDe: ReadonlyMap<string, string>, deps: DepsTim,
): Promise<DoanTim[]> {
  // Neo lọc TRƯỚC khi xếp hạng — topK không bị đoạn của SP khác chiếm chỗ.
  const neo = yc.sanPham?.neo ?? null;
  const ung = neo ? rows.filter((r) => khopNeo(neo, tapToken(`${tieuDe.get(r.documentId) ?? ''}\n${r.content}`))) : [...rows];
  if (ung.length === 0) return [];
  const cauTim = [yc.truyVan, yc.sanPham?.ten, yc.sanPham?.ma].filter(Boolean).join(' ');
  // Xếp hạng TRÊN MỌI ứng viên (không cắt topK trước — nhánh từ khoá của `xepHangDoan` dừng ở topK+3 hàng ĐẦU theo thứ tự
  // đọc, nên đoạn đúng mã nằm sau dễ bị bỏ), rồi ưu tiên đoạn chứa nhiều token PHÂN BIỆT (có chữ số: "p3076", "3840hz",
  // "v7512") của câu hỏi — tính trên tiêu đề + đoạn; hoà ⇒ giữ thứ tự hybrid.
  // Từ khoá tìm trên TIÊU ĐỀ + đoạn (mã SP hay chỉ nằm ở tiêu đề: "LLR- P3.076 .3840hz outdoor"); nội dung trả vẫn là đoạn gốc.
  const goc = new Map(ung.map((r) => [r.id, r.content]));
  const coTieuDe = ung.map((r) => ({ ...r, content: `${tieuDe.get(r.documentId) ?? ''}\n${r.content}` }));
  const hits = await xepHangDoan(deps.embed, coTieuDe, cauTim, Math.max(UNG_VIEN, ung.length), deps.cfg);
  // Có neo SP ⇒ MỌI ứng viên đã đúng SP: đoạn mà vector/từ khoá bỏ sót (câu ngắn "thông số P2.5" không có từ ≥ 3 ký tự,
  // embedding chết) vẫn được xét sau các đoạn đã xếp.
  if (neo) {
    const daXep = new Set(hits.map((h) => h.chunkId));
    for (const r of coTieuDe) if (!daXep.has(r.id)) hits.push({ chunkId: r.id, content: r.content, score: 0 });
  }
  const docCua = new Map(ung.map((r) => [r.id, r.documentId]));
  const phanBiet = [...tapToken(cauTim)].filter((t) => t.length >= 2 && /\d/.test(t));
  const diemPb = new Map(hits.map((h) => {
    const tap = tapToken(`${tieuDe.get(docCua.get(h.chunkId) ?? '') ?? ''}\n${h.content}`);
    return [h.chunkId, phanBiet.filter((t) => tap.has(t)).length];
  }));
  hits.sort((a, b) => (diemPb.get(b.chunkId) ?? 0) - (diemPb.get(a.chunkId) ?? 0));
  const daCo = new Set<string>();
  const ra: Array<{ tieuDe: string; noiDung: string; id: string; diem: number }> = [];
  for (const h of hits) {
    const id = docCua.get(h.chunkId);
    if (!id) continue;
    const sach = lamSachChoKhach(goc.get(h.chunkId) ?? '');
    if (!sach || daCo.has(sach)) continue;
    daCo.add(sach);
    ra.push({ tieuDe: tieuDeSach(tieuDe.get(id) ?? ''), noiDung: sach, id, diem: Number.isFinite(h.score) ? h.score : 0 });
  }
  return uuTienTheoSanPham(ra, yc.sanPham).slice(0, yc.soDoan)
    .map((x) => ({ tai_lieu_id: x.id, tieu_de: x.tieuDe, noi_dung: x.noiDung, diem: Math.round(x.diem * 1000) / 1000 }));
}

/** Đoạn KHÔNG kèm embedding (3072 chiều × ~1.300 đoạn = ~30 MB — đọc hết mỗi lần mất ~4,5 s trên staging, đo 02/10 khuya). */
const CHON_DOAN_NHE = { id: true, documentId: true, ord: true, content: true } as const;
/** Không neo SP: số ứng viên tối đa được đọc embedding (chọn theo số token trùng câu hỏi). */
const TRAN_UNG_VIEN_KHONG_NEO = 300;

/** Từ quá chung không dùng để chọn ứng viên khi không có neo. */
const TU_CHUNG_TIM = new Set(['thong', 'so', 'ky', 'thuat', 'cho', 'anh', 'chi', 'em', 'cua', 'la', 'bao', 'nhieu', 'gi', 'nao',
  'co', 'khong', 'va', 'voi', 'the', 'led', 'module']);

/**
 * Tìm chung cho hai đường: đọc đoạn NHẸ (không embedding) ⇒ chọn ứng viên (neo SP nếu có; không neo ⇒ đoạn có token trùng câu
 * hỏi, tối đa TRAN_UNG_VIEN_KHONG_NEO) ⇒ CHỈ đọc embedding của ứng viên ⇒ `xepVaLoc`. `loaiTru` = tài liệu bỏ (đường khách).
 */
async function timTrong(orgId: string, yc: YeuCauTim, loaiTru: ReadonlySet<string>, deps: DepsTim): Promise<DoanTim[]> {
  const ngoaiDoc = loaiTru.size > 0 ? { id: { notIn: [...loaiTru] } } : {};
  const ngoaiDoan = loaiTru.size > 0 ? { documentId: { notIn: [...loaiTru] } } : {};
  const [docs, nhe] = await Promise.all([
    prisma.knowledgeDocument.findMany({ where: { orgId, ...ngoaiDoc }, select: { id: true, title: true } }),
    prisma.knowledgeChunk.findMany({ where: { orgId, ...ngoaiDoan }, select: CHON_DOAN_NHE }),
  ]);
  const tieuDe = new Map(docs.map((d) => [d.id, d.title]));
  const hop = nhe.filter((r) => tieuDe.has(r.documentId) && !loaiTru.has(r.documentId));
  const neo = yc.sanPham?.neo ?? null;
  let ung: typeof hop;
  if (neo) {
    ung = hop.filter((r) => khopNeo(neo, tapToken(`${tieuDe.get(r.documentId) ?? ''}\n${r.content}`)));
  } else {
    const cau = [...tapToken([yc.truyVan, yc.sanPham?.ten, yc.sanPham?.ma].filter(Boolean).join(' '))]
      .filter((t) => t.length >= 2 && !TU_CHUNG_TIM.has(t));
    const diem = hop.map((r) => {
      const tap = tapToken(`${tieuDe.get(r.documentId) ?? ''}\n${r.content}`);
      return { r, d: cau.filter((t) => tap.has(t)).length };
    }).filter((x) => x.d > 0);
    diem.sort((a, b) => b.d - a.d);
    ung = diem.slice(0, TRAN_UNG_VIEN_KHONG_NEO).map((x) => x.r);
  }
  if (ung.length === 0) return [];
  const vec = new Map((await prisma.knowledgeChunk.findMany({
    where: { orgId, id: { in: ung.map((r) => r.id) } }, select: { id: true, embedding: true, embedDim: true },
  })).map((v) => [v.id, v]));
  const rows: HangDoan[] = ung.map((r) => ({ ...r, embedding: vec.get(r.id)?.embedding ?? [], embedDim: vec.get(r.id)?.embedDim ?? 0 }));
  return xepVaLoc(yc, rows, tieuDe, deps);
}

/**
 * KHÁCH (chủ chốt 02/10 tối): thông số kỹ thuật ai hỏi cũng trả lời được ⇒ MỌI tài liệu kho tri thức của org, TRỪ tài liệu admin
 * loại trừ (bot_tai_lieu_loai_tru). Không còn cổng duyệt-theo-băm. Cùng lưới neo SP + bỏ dòng giá/SĐT/link như đường NV.
 */
export async function timChoKhach(orgId: string, body: unknown, deps: DepsTim = depsTuEnv()): Promise<{ ket_qua: DoanTim[] }> {
  const yc = docYeuCauTim(body);
  return withTenant(orgId, async () => {
    const loaiTru = new Set((await prisma.botTaiLieuLoaiTru.findMany({ where: { orgId }, select: { taiLieuId: true } }))
      .map((r) => r.taiLieuId));
    const bd = Date.now();
    const ket_qua = await timTrong(orgId, yc, loaiTru, deps);
    logger.info({ orgId, soLoaiTru: loaiTru.size, soTra: ket_qua.length, ms: Date.now() - bd }, '[cho-khach] tìm thông số cho khách');
    return { ket_qua };
  });
}

/** NHÂN VIÊN: mọi tài liệu của org (NV vốn đọc cả kho — như tool tra_tri_thuc trước đây). Cùng lưới bỏ dòng bẩn. */
export async function timNoiBo(orgId: string, body: unknown, deps: DepsTim = depsTuEnv()): Promise<{ ket_qua: DoanTim[] }> {
  const yc = docYeuCauTim(body);
  return withTenant(orgId, async () => {
    const bd = Date.now();
    const ket_qua = await timTrong(orgId, yc, new Set(), deps);
    logger.info({ orgId, soTra: ket_qua.length, ms: Date.now() - bd }, '[tai-lieu-ky-thuat] tìm thông số cho NV');
    return { ket_qua };
  });
}
