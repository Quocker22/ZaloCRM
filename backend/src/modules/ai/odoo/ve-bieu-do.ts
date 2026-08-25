// SPDX-License-Identifier: AGPL-3.0-or-later
// BIỂU ĐỒ CỘT → ẢNH PNG gửi Zalo (25/08/2026).
//
// Anh Quyết: "thống kê doanh số khách hàng… lập dạng biểu đồ cột để theo dõi
// khách qua từng tháng". Cùng kỹ thuật với anh-bang.ts (SVG → sharp): không
// cần trình duyệt, không cần Odoo render, ảnh hiện thẳng trong khung chat —
// đường ảnh đã chứng minh chạy mỗi ngày với hoá đơn.
//
// Hai kiểu: cột DỌC theo thời gian (tháng → doanh số) và cột NGANG cho bảng
// xếp hạng (top khách/sản phẩm). Số trên cột rút gọn ("12,5tr") để đọc được
// trên điện thoại; số chính xác đã có trong text tóm tắt bot gửi kèm.
import sharp from 'sharp';

export interface DuLieuBieuDo {
  tieuDe: string;
  /** Dòng phụ dưới tiêu đề, vd "Hoá đơn đã vào sổ · 03/2026 – 08/2026". */
  phuDe?: string;
  nhan: string[];
  giaTri: number[];
  /** Dòng ghi chú cuối ảnh, vd "Tổng 152,3tr · TB 25,4tr/tháng". */
  ghiChu?: string;
}

/** Thoát ký tự XML — tên khách có thể chứa &, <, ". */
function thoat(s: string | number): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Rút gọn tiền VNĐ cho nhãn trên cột: 12.500.000 → "12,5tr"; 850.000 → "850k";
 * 1.250.000.000 → "1,25 tỷ"; 0 → "0".
 */
export function rutGonTien(n: number): string {
  const v = Math.abs(n);
  const dau = n < 0 ? '-' : '';
  const fmt = (x: number, d: number): string =>
    x.toFixed(d).replace(/\.?0+$/, '').replace('.', ',');
  if (v >= 1e9) return `${dau}${fmt(v / 1e9, 2)} tỷ`;
  if (v >= 1e6) return `${dau}${fmt(v / 1e6, 1)}tr`;
  if (v >= 1e3) return `${dau}${fmt(v / 1e3, 0)}k`;
  return `${dau}${Math.round(v)}`;
}

const MAU_COT = '#1565d8';
const MAU_COT_DAM = '#0d47a1';

/**
 * Cột DỌC: nhãn trục X (tháng), chiều cao cột tỷ lệ giá trị. Cột cao nhất tô
 * đậm để nhìn ra tháng đỉnh ngay. Giá trị 0 vẫn vẽ nhãn "0" — tháng không
 * bán phải THẤY là không bán, không được biến mất khỏi trục.
 */
export async function bieuDoCot(d: DuLieuBieuDo): Promise<Buffer> {
  const n = Math.max(1, d.nhan.length);
  const rongCot = n <= 6 ? 72 : n <= 9 ? 56 : 44;
  const khe = Math.round(rongCot * 0.45);
  const leTrai = 24, lePhai = 24;
  const dinh = 78, day = d.ghiChu ? 92 : 62;
  const caoVung = 260;
  const rong = Math.max(520, leTrai + lePhai + n * (rongCot + khe) + khe);
  const cao = dinh + caoVung + day;
  const max = Math.max(1, ...d.giaTri.map((v) => Math.max(0, v)));
  const iMax = d.giaTri.indexOf(Math.max(...d.giaTri));
  const trucY = dinh + caoVung;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rong}" height="${cao}" font-family="DejaVu Sans, Arial, sans-serif">`;
  svg += `<rect width="100%" height="100%" fill="#ffffff"/>`;
  svg += `<text x="${rong / 2}" y="30" text-anchor="middle" font-size="19" font-weight="bold" fill="#1a1a1a">${thoat(d.tieuDe)}</text>`;
  if (d.phuDe) svg += `<text x="${rong / 2}" y="52" text-anchor="middle" font-size="13" fill="#666">${thoat(d.phuDe)}</text>`;
  // Đường lưới ngang 4 mức
  for (let k = 1; k <= 4; k++) {
    const y = trucY - (caoVung * k) / 4;
    svg += `<line x1="${leTrai}" y1="${y}" x2="${rong - lePhai}" y2="${y}" stroke="#eee"/>`;
    svg += `<text x="${leTrai}" y="${y - 3}" font-size="10" fill="#999">${thoat(rutGonTien((max * k) / 4))}</text>`;
  }
  svg += `<line x1="${leTrai}" y1="${trucY}" x2="${rong - lePhai}" y2="${trucY}" stroke="#333"/>`;
  d.nhan.forEach((nhan, i) => {
    const v = Math.max(0, d.giaTri[i] ?? 0);
    const h = Math.round((v / max) * (caoVung - 24));
    const x = leTrai + khe + i * (rongCot + khe);
    const y = trucY - h;
    svg += `<rect x="${x}" y="${y}" width="${rongCot}" height="${h}" rx="4" fill="${i === iMax ? MAU_COT_DAM : MAU_COT}"/>`;
    svg += `<text x="${x + rongCot / 2}" y="${y - 6}" text-anchor="middle" font-size="12" font-weight="bold" fill="#1a1a1a">${thoat(rutGonTien(v))}</text>`;
    svg += `<text x="${x + rongCot / 2}" y="${trucY + 18}" text-anchor="middle" font-size="12" fill="#333">${thoat(nhan)}</text>`;
  });
  if (d.ghiChu) svg += `<text x="${rong / 2}" y="${cao - 22}" text-anchor="middle" font-size="13" fill="#444">${thoat(d.ghiChu)}</text>`;
  svg += '</svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Cột NGANG cho xếp hạng (top khách/SP): nhãn dài bên trái, cột kéo sang
 * phải, số ở đầu cột. Tối đa ~15 dòng — dài hơn thì bảng ảnh dễ đọc hơn.
 */
export async function bieuDoCotNgang(d: DuLieuBieuDo): Promise<Buffer> {
  const n = Math.max(1, d.nhan.length);
  const caoDong = 34;
  const leTrai = Math.min(260, 40 + Math.max(...d.nhan.map((s) => s.length), 4) * 8);
  const rong = 720, lePhai = 90;
  const dinh = 70, day = d.ghiChu ? 60 : 30;
  const cao = dinh + n * caoDong + day;
  const max = Math.max(1, ...d.giaTri.map((v) => Math.max(0, v)));
  const rongVung = rong - leTrai - lePhai;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rong}" height="${cao}" font-family="DejaVu Sans, Arial, sans-serif">`;
  svg += `<rect width="100%" height="100%" fill="#ffffff"/>`;
  svg += `<text x="${rong / 2}" y="30" text-anchor="middle" font-size="19" font-weight="bold" fill="#1a1a1a">${thoat(d.tieuDe)}</text>`;
  if (d.phuDe) svg += `<text x="${rong / 2}" y="52" text-anchor="middle" font-size="13" fill="#666">${thoat(d.phuDe)}</text>`;
  d.nhan.forEach((nhan, i) => {
    const v = Math.max(0, d.giaTri[i] ?? 0);
    const w = Math.round((v / max) * rongVung);
    const y = dinh + i * caoDong;
    const ten = nhan.length > 30 ? `${nhan.slice(0, 29)}…` : nhan;
    svg += `<text x="${leTrai - 10}" y="${y + 21}" text-anchor="end" font-size="13" fill="#1a1a1a">${thoat(`${i + 1}. ${ten}`)}</text>`;
    svg += `<rect x="${leTrai}" y="${y + 6}" width="${w}" height="${caoDong - 12}" rx="4" fill="${i === 0 ? MAU_COT_DAM : MAU_COT}"/>`;
    svg += `<text x="${leTrai + w + 8}" y="${y + 21}" font-size="12" font-weight="bold" fill="#1a1a1a">${thoat(rutGonTien(v))}</text>`;
  });
  if (d.ghiChu) svg += `<text x="${rong / 2}" y="${cao - 20}" text-anchor="middle" font-size="13" fill="#444">${thoat(d.ghiChu)}</text>`;
  svg += '</svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}
