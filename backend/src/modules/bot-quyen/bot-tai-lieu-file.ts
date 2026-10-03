// SPDX-License-Identifier: AGPL-3.0-or-later
// FILE TÀI LIỆU GỐC kèm câu trả lời thông số cho bot Hermes (docs/79 §PDF cho khách, 03/10 — chủ: "khi khách hỏi về tài liệu kỹ
// thuật, cần thêm file pdf luôn"; trước đây agent CRM luôn gửi kèm file PDF gốc + tóm tắt thông số).
//
//   POST /api/public/tai-lieu-ky-thuat/file  {cau_hoi, tieu_de_doan?, duong: "khach"|"nhan_vien"}
//     → 200 application/pdf (thân = file) + header `x-tai-lieu-ten` (encodeURIComponent tên file)
//     → 204 + header `x-ly-do` khi không có file nào đủ chắc (không phải lỗi).
//
// Bot KHÔNG viết lại bộ khớp file: route này chạy ĐÚNG luật của agent CRM (`kemFileTriThuc`): kho file = `lietKeTaiLieu` (bảng
// messages, đã qua `locGiaNoiBo` — chỉ .pdf, tên không dính từ khoá giá), cổng `laCauHoiThongSo`, `timFileDuyNhat` trên câu hỏi
// rồi trên tiêu đề đoạn RAG đầu tiên. Mơ hồ ⇒ không file.
//
// ĐƯỜNG KHÁCH chặt hơn (fail-closed):
//   • tên file có dấu hiệu nội bộ (báo giá, bảng giá, chiết khấu, công nợ, nội bộ, tồn kho, price/cost…) ⇒ bỏ;
//   • file PHẢI ứng với một tài liệu kho tri thức CÙNG TÊN (`chuanTen`, title = tên file bỏ .pdf) mà KHÔNG bị loại trừ
//     (`bot_tai_lieu_loai_tru`) — file không đối chiếu được (vd file khách tự gửi vào nhóm, chưa nạp RAG) KHÔNG BAO GIỜ tới khách.
// Cả hai đường: file ≤ TRAN_FILE_BYTE, thân phải bắt đầu "%PDF-" (CDN trả trang lỗi HTML ⇒ không gửi).
// KHÔNG log câu hỏi (chữ khách/NV gõ).
import { readFile, stat } from 'node:fs/promises';
import { prisma } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';
import { boDau, chuanTen, laCauHoiThongSo, timFileKemTriThuc, type TaiLieu } from '../ai/odoo/tools/gui-tai-lieu.js';
import { LoiChoKhach } from './bot-cho-khach-hop-dong.js';

/** Trần cỡ file gửi qua route (byte) — datasheet thật vài trăm KB tới vài MB. */
export const TRAN_FILE_BYTE = 20 * 1024 * 1024;
const DAI_CAU = 500;

export type DuongFile = 'khach' | 'nhan_vien';

export interface YeuCauFile {
  cauHoi: string;
  tieuDeDoan: string;
  duong: DuongFile;
}

function sai(msg: string): never {
  throw new LoiChoKhach(400, 'YEU_CAU_SAI', msg);
}

export function docYeuCauFile(body: unknown): YeuCauFile {
  if (!body || typeof body !== 'object' || Array.isArray(body)) sai('Thân phải là object JSON');
  const b = body as Record<string, unknown>;
  if (typeof b.cau_hoi !== 'string' || !b.cau_hoi.trim()) sai('cau_hoi bắt buộc');
  if ([...b.cau_hoi].length > DAI_CAU) sai(`cau_hoi ≤ ${DAI_CAU} ký tự`);
  let tieuDeDoan = '';
  if (b.tieu_de_doan !== undefined && b.tieu_de_doan !== null) {
    if (typeof b.tieu_de_doan !== 'string' || [...b.tieu_de_doan].length > DAI_CAU) sai(`tieu_de_doan là chuỗi ≤ ${DAI_CAU} ký tự`);
    tieuDeDoan = b.tieu_de_doan;
  }
  if (b.duong !== 'khach' && b.duong !== 'nhan_vien') sai('duong là "khach" hoặc "nhan_vien"');
  return { cauHoi: b.cau_hoi, tieuDeDoan, duong: b.duong };
}

/** Dấu hiệu NỘI BỘ trong tên file (bỏ dấu) — đường khách bỏ file. Rộng hơn `locGiaNoiBo` (vốn chỉ chặn từ khoá giá). */
const RE_TEN_NOI_BO = new RegExp(
  '\\b(?:bang gia|bao gia|gia von|gia nhap|gia dai ly|gia si|gia ban|chiet khau|noi bo|cong no|hoa hong|ton kho|doanh thu|'
  + 'loi nhuan|hop dong|hoa don|don hang|dat hang|price|pricing|cost|quotation|invoice|discount|internal|confidential|gia)\\b',
);

export function tenCoDauHieuNoiBo(ten: string): boolean {
  const k = boDau(ten).replace(/\.[a-z0-9]{2,4}$/, '').replace(/[_\-–—.]+/g, ' ');
  return RE_TEN_NOI_BO.test(k);
}

export interface DepsFile {
  /** Kho file gửi được của org (đã qua `locGiaNoiBo`). */
  liet: (orgId: string) => Promise<TaiLieu[]>;
  /** Tải về đĩa ⇒ đường dẫn cục bộ. */
  taiVe: (t: TaiLieu) => Promise<string>;
}

async function depsMacDinh(): Promise<DepsFile> {
  const { lietKeTaiLieu, taiTaiLieuVe } = await import('../ai/knowledge/kho-tai-lieu.js');
  return { liet: lietKeTaiLieu, taiVe: taiTaiLieuVe };
}

export type KetQuaFile = { file: { tieuDe: string; data: Buffer } } | { file: null; lyDo: string };

/** Lọc kho cho ĐƯỜNG KHÁCH: bỏ tên nội bộ; chỉ giữ file cùng tên với tài liệu kho tri thức KHÔNG bị loại trừ. */
/**
 * File PDF do BOT TỰ DỰNG rồi gửi vào nhóm (`pdf_tai_lieu._ten_file`: "<tiêu-đề-nối-gạch>-<10 hex>.pdf", bot gửi thêm tiền tố
 * "0-") — KHÔNG phải tài liệu gốc. Chủ 03/10: phải gửi FILE GỐC; staging 03/10: 11/11 file PDF trong `messages` là file bot dựng.
 * Loại khỏi kho file ở MỌI đường.
 */
export function laFileBotDung(tieuDe: string): boolean {
  let t = String(tieuDe ?? '');
  try { t = decodeURIComponent(t); } catch { /* giữ nguyên */ }
  return /-[0-9a-f]{10}\.pdf$/i.test(t);
}

/** Tên file ⇒ khoá so với tiêu đề tài liệu kho tri thức (giải %-mã hoá của tên file Zalo). */
export function tenFileGoc(tieuDe: string): string {
  let t = String(tieuDe ?? '');
  try { t = decodeURIComponent(t); } catch { /* giữ nguyên */ }
  return chuanTen(t);
}

async function locChoKhach(orgId: string, kho: TaiLieu[]): Promise<TaiLieu[]> {
  const [docs, loai] = await Promise.all([
    prisma.knowledgeDocument.findMany({ where: { orgId }, select: { id: true, title: true } }),
    prisma.botTaiLieuLoaiTru.findMany({ where: { orgId }, select: { taiLieuId: true } }),
  ]);
  const boId = new Set(loai.map((r) => r.taiLieuId));
  const tenBo = new Set(docs.filter((d) => boId.has(d.id)).map((d) => chuanTen(d.title)));
  const tenDuoc = new Set(docs.filter((d) => !boId.has(d.id)).map((d) => chuanTen(d.title)));
  return kho.filter((t) => {
    const ten = tenFileGoc(t.tieuDe);
    return ten.length >= 2 && !tenBo.has(ten) && tenDuoc.has(ten) && !tenCoDauHieuNoiBo(t.tieuDe);
  });
}

/**
 * File kèm câu trả lời thông số — ĐÚNG luật `kemFileTriThuc` của agent CRM (+ lọc đường khách). Không có / mơ hồ / tải lỗi /
 * không phải PDF / quá trần ⇒ `{file: null, lyDo}` — KHÔNG ném (file là phần phụ, câu chữ của bot vẫn đi). Thân sai ⇒ ném
 * `LoiChoKhach` 400.
 */
export async function layFileKemTriThuc(orgId: string, body: unknown, deps?: Partial<DepsFile>): Promise<KetQuaFile> {
  const yc = docYeuCauFile(body);
  const d = { ...(await depsMacDinh()), ...(deps ?? {}) };
  return withTenant(orgId, async () => {
    let kho = (await d.liet(orgId)).filter((t) => !laFileBotDung(t.tieuDe));
    if (yc.duong === 'khach') kho = await locChoKhach(orgId, kho);
    if (kho.length === 0) return { file: null, lyDo: 'kho_rong' };
    // Có tiêu đề tài liệu RAG đã dùng để trả lời ⇒ file PHẢI là file của ĐÚNG tài liệu đó; không có ⇒ không kèm (KHÔNG rơi về
    // khớp theo câu hỏi — dev 03/10 vòng 10: câu "P3.076 ốp lưng" trả lời từ "LLR P3.076-V2.0 OP LUNG" mà kèm datasheet OUTDOOR).
    const khoaDoan = yc.tieuDeDoan ? chuanTen(yc.tieuDeDoan) : '';
    const f = khoaDoan
      ? (laCauHoiThongSo(yc.cauHoi) ? (kho.find((t) => tenFileGoc(t.tieuDe) === khoaDoan) ?? null) : null)
      : timFileKemTriThuc(yc.cauHoi, yc.tieuDeDoan, kho);
    if (!f) return { file: null, lyDo: 'khong_khop' };
    if (f.kichThuoc > TRAN_FILE_BYTE) return { file: null, lyDo: 'qua_lon' };
    let data: Buffer;
    try {
      const p = await d.taiVe(f);
      if ((await stat(p)).size > TRAN_FILE_BYTE) return { file: null, lyDo: 'qua_lon' };
      data = await readFile(p);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), orgId }, '[tai-lieu-file] tải file lỗi — không kèm file');
      return { file: null, lyDo: 'tai_loi' };
    }
    if (data.length > TRAN_FILE_BYTE) return { file: null, lyDo: 'qua_lon' };
    if (data.subarray(0, 5).toString('latin1') !== '%PDF-') return { file: null, lyDo: 'khong_phai_pdf' };
    logger.info({ orgId, duong: yc.duong, kb: Math.round(data.length / 1024) }, '[tai-lieu-file] trả file kèm thông số');
    return { file: { tieuDe: f.tieuDe, data } };
  });
}
