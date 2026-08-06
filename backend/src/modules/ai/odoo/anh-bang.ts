// SPDX-License-Identifier: AGPL-3.0-or-later
// BẢNG → ẢNH PNG — phương án lùi khi zca-js không gửi được file .xlsx.
//
// Bug thật 06/08/2026: bot nói "xem file Excel đính kèm" nhưng file không tới.
// zca-js upload .xlsx thành công (có fileUrl trong log) nhưng bước gửi vào
// thread rớt ÂM THẦM — không ném lỗi, không có file. zca-js không có API
// sendFile riêng, chỉ có sendMessage+attachments xử .xlsx qua nhánh "others"
// hay hỏng. Đường ẢNH thì đã chứng minh chạy (hoá đơn gửi ảnh tốt mỗi ngày).
//
// Dựng SVG rồi sharp → PNG: không cần Odoo, không cần trình duyệt, không phụ
// thuộc font hệ thống (SVG text tự render). Nhìn trên điện thoại đẹp hơn Excel
// mà không mở nổi trên Zalo.
import sharp from 'sharp';
import type { BangExcel } from './xuat-excel.js';

const CAO_HANG = 34;
const DEM = 16;
const RONG_MIN = 520;
const CO_CHU = 14;

/** Ước lượng bề rộng cột theo ký tự dài nhất — đủ để bảng không tràn/thừa. */
function beRongCot(cot: string[], dong: Array<Array<string | number>>): number[] {
  return cot.map((ten, i) => {
    const daiNhat = Math.max(ten.length, ...dong.map((d) => String(d[i] ?? '').length));
    return Math.min(Math.max(daiNhat * 8 + 20, 70), 340);
  });
}

/** Thoát ký tự XML — tên SP có thể chứa &, <, ", ' làm hỏng SVG. */
function thoat(s: string | number): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Render một BangExcel thành PNG. Chỉ vẽ tối đa `toiDa` hàng — bảng dài thì
 * ảnh vẫn đọc được, phần đuôi đã có trong text tóm tắt.
 */
export async function bangRaAnh(bang: BangExcel, toiDa = 30): Promise<Buffer> {
  const dongVe = bang.dong.slice(0, toiDa);
  const rong = beRongCot(bang.cot, dongVe);
  const wCot = rong.reduce((a, b) => a + b, 0);
  const W = Math.max(wCot + DEM * 2, RONG_MIN);
  const soHang = dongVe.length + (bang.tongCong ? 1 : 0);
  const H = DEM * 2 + 60 + (soHang + 1) * CAO_HANG;

  const oCot = (i: number) => DEM + rong.slice(0, i).reduce((a, b) => a + b, 0);
  const chuoiHang = (cells: Array<string | number>, y: number, dam: boolean) =>
    cells
      .map((c, i) => {
        const canPhai = typeof c === 'number' || /^[\d.,]+/.test(String(c));
        const x = canPhai ? oCot(i) + rong[i] - 8 : oCot(i) + 8;
        const so = typeof c === 'number' ? c.toLocaleString('vi-VN') : c;
        return `<text x="${x}" y="${y}" font-size="${CO_CHU}" ${dam ? 'font-weight="700"' : ''} ` +
          `text-anchor="${canPhai ? 'end' : 'start'}" fill="#1a1a1a">${thoat(so)}</text>`;
      })
      .join('');

  let y = DEM + 24;
  const parts: string[] = [
    `<text x="${DEM}" y="${y}" font-size="18" font-weight="700" fill="#0b6b3a">${thoat(bang.tieuDe)}</text>`,
  ];
  y += 22;
  parts.push(
    `<text x="${DEM}" y="${y}" font-size="12" fill="#666">Kỳ: ${thoat(bang.ky ?? 'toàn bộ')} · ${new Date().toLocaleString('vi-VN')}</text>`,
  );
  y += 20;

  // Header
  parts.push(`<rect x="${DEM}" y="${y}" width="${wCot}" height="${CAO_HANG}" fill="#0b6b3a"/>`);
  parts.push(
    bang.cot
      .map((c, i) => `<text x="${oCot(i) + 8}" y="${y + 22}" font-size="${CO_CHU}" font-weight="700" fill="#fff">${thoat(c)}</text>`)
      .join(''),
  );
  y += CAO_HANG;

  dongVe.forEach((d, r) => {
    if (r % 2 === 1) parts.push(`<rect x="${DEM}" y="${y}" width="${wCot}" height="${CAO_HANG}" fill="#f2f7f4"/>`);
    parts.push(chuoiHang(d, y + 22, false));
    y += CAO_HANG;
  });

  if (bang.tongCong) {
    parts.push(`<rect x="${DEM}" y="${y}" width="${wCot}" height="${CAO_HANG}" fill="#e0efe7"/>`);
    parts.push(chuoiHang(bang.tongCong, y + 22, true));
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>${parts.join('')}</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
