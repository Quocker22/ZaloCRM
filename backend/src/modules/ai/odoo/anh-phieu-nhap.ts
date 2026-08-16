// SPDX-License-Identifier: AGPL-3.0-or-later
// ẢNH PHIẾU NHẬP tự vẽ — dáng CHỨNG TỪ, không phải bảng báo cáo trần.
//
// Hai vòng góp ý thật của anh Quốc (16/08):
//   1. Render qua report Odoo → ra "Yêu cầu báo giá" chuẩn Odoo ("ủa phiếu
//      này đâu phải phiếu custom của tôi") — prod KHÔNG có report custom cho
//      purchase.order (đo: chỉ 2 mẫu chuẩn).
//   2. Vẽ bảng trần kiểu báo cáo → "gửi hình này gọi là hóa đơn đấy hả?" —
//      thiếu đầu chứng từ. Người bán hàng nhìn "hoá đơn" là nhìn: tên shop +
//      địa chỉ + SĐT, mã phiếu, NCC, rồi mới tới bảng hàng.
//
// Nên: SVG tự dựng (cùng kỹ thuật anh-bang: sharp, không Odoo, không trình
// duyệt) với bố cục chứng từ — đầu trái là CÔNG TY (đọc từ res.company của
// chính Odoo, không hardcode), đầu phải là khối PHIẾU NHẬP HÀNG + NCC.
import sharp from 'sharp';
import type { OdooClient } from './client.js';

const tien = (n: number): string => `${Math.round(n).toLocaleString('vi-VN')}đ`;

/** Thoát ký tự XML — tên SP/NCC có thể chứa &, <, " làm hỏng SVG. */
function thoat(s: string | number): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Gọn tên hàng cho vừa cột (nhìn ảnh thật P04528: tên dài tràn đè cột SL).
 * Bỏ tiền tố "[mã]" Odoo chèn (mã đã nằm trong tên), cắt ở ranh giới từ.
 */
export function gonTen(ten: string, tran = 40): string {
  const sach = ten.replace(/^\[[^\]]*\]\s*/, '').trim();
  if (sach.length <= tran) return sach;
  const cat = sach.slice(0, tran);
  const cuoi = cat.lastIndexOf(' ');
  return `${(cuoi > tran * 0.6 ? cat.slice(0, cuoi) : cat).trimEnd()}…`;
}

export interface DuLieuPhieuNhap {
  ma: string;
  ngay: string;
  ncc: { ten: string; sdt?: string };
  congTy: { ten: string; diaChi: string; sdt?: string };
  dong: Array<{ ten: string; sl: number; gia: number; thanhTien: number }>;
}

/** Dựng SVG chứng từ — thuần, test khoá được nội dung. */
export function vePhieuNhapSvg(d: DuLieuPhieuNhap): string {
  const XANH = '#0b6b3a';
  const W = 700;
  const DEM = 20;
  const CAO_HANG = 32;
  const wBang = W - DEM * 2;
  // cột: Tên hàng | SL | Giá nhập | Thành tiền
  const rong = [Math.round(wBang * 0.47), Math.round(wBang * 0.13), Math.round(wBang * 0.18), Math.round(wBang * 0.22)];
  const oCot = (i: number) => DEM + rong.slice(0, i).reduce((a, b) => a + b, 0);

  const parts: string[] = [];
  let y = 34;
  // ── Đầu trái: CÔNG TY ──
  parts.push(`<text x="${DEM}" y="${y}" font-size="20" font-weight="700" fill="${XANH}">${thoat(d.congTy.ten)}</text>`);
  // ── Đầu phải: PHIẾU ──
  parts.push(`<text x="${W - DEM}" y="${y}" font-size="20" font-weight="700" text-anchor="end" fill="#b3261e">PHIẾU NHẬP HÀNG ${thoat(d.ma)}</text>`);
  y += 20;
  parts.push(`<text x="${DEM}" y="${y}" font-size="12" fill="#444">${thoat(d.congTy.diaChi)}</text>`);
  parts.push(`<text x="${W - DEM}" y="${y}" font-size="12" text-anchor="end" fill="#444">Ngày: ${thoat(d.ngay)}</text>`);
  y += 18;
  if (d.congTy.sdt) parts.push(`<text x="${DEM}" y="${y}" font-size="12" fill="#444">ĐT: ${thoat(d.congTy.sdt)}</text>`);
  parts.push(`<text x="${W - DEM}" y="${y}" font-size="13" font-weight="700" text-anchor="end" fill="#1a1a1a">NCC: ${thoat(d.ncc.ten)}${d.ncc.sdt ? ` · ${thoat(d.ncc.sdt)}` : ''}</text>`);
  y += 14;
  parts.push(`<line x1="${DEM}" y1="${y}" x2="${W - DEM}" y2="${y}" stroke="${XANH}" stroke-width="2"/>`);
  y += 14;

  // ── Bảng ──
  const hang = (cells: Array<string>, yy: number, dam: boolean, mau = '#1a1a1a') =>
    cells.map((c, i) => {
      const canPhai = i > 0;
      const x = canPhai ? oCot(i) + rong[i] - 8 : oCot(i) + 8;
      return `<text x="${x}" y="${yy}" font-size="13" ${dam ? 'font-weight="700"' : ''} text-anchor="${canPhai ? 'end' : 'start'}" fill="${mau}">${thoat(c)}</text>`;
    }).join('');

  parts.push(`<rect x="${DEM}" y="${y}" width="${wBang}" height="${CAO_HANG}" fill="${XANH}"/>`);
  parts.push(['Tên hàng', 'SL', 'Giá nhập', 'Thành tiền'].map((c, i) => {
    const canPhai = i > 0;
    const x = canPhai ? oCot(i) + rong[i] - 8 : oCot(i) + 8;
    return `<text x="${x}" y="${y + 21}" font-size="13" font-weight="700" text-anchor="${canPhai ? 'end' : 'start'}" fill="#fff">${thoat(c)}</text>`;
  }).join(''));
  y += CAO_HANG;

  for (const [r, dg] of d.dong.entries()) {
    if (r % 2 === 1) parts.push(`<rect x="${DEM}" y="${y}" width="${wBang}" height="${CAO_HANG}" fill="#f2f7f4"/>`);
    parts.push(hang(
      [gonTen(dg.ten), dg.sl.toLocaleString('vi-VN'), dg.gia > 0 ? tien(dg.gia) : 'chưa có', dg.thanhTien > 0 ? tien(dg.thanhTien) : '—'],
      y + 21, false,
    ));
    y += CAO_HANG;
  }

  const tong = d.dong.reduce((t, x) => t + x.thanhTien, 0);
  parts.push(`<rect x="${DEM}" y="${y}" width="${wBang}" height="${CAO_HANG}" fill="#e0efe7"/>`);
  parts.push(hang(['TỔNG', '', '', tien(tong)], y + 21, true));
  y += CAO_HANG + 22;
  parts.push(`<text x="${DEM}" y="${y}" font-size="11" fill="#888">Phiếu NHÁP tạo qua trợ lý Zalo — anh/chị kiểm tra rồi bấm Xác nhận trên Odoo. Dòng "chưa có" là chưa điền giá nhập.</text>`);
  y += DEM;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}">` +
    `<rect width="${W}" height="${y}" fill="#ffffff"/>${parts.join('')}</svg>`
  );
}

/** Đọc phiếu + công ty + NCC từ Odoo rồi vẽ PNG. Lỗi → ném, caller log best-effort. */
export async function anhPhieuNhap(
  odoo: Pick<OdooClient, 'searchRead'>,
  donId: number,
): Promise<{ duLieu: Buffer; tenFile: string } | null> {
  const [don] = await odoo.searchRead<Record<string, unknown>>(
    'purchase.order', [['id', '=', donId]], ['name', 'partner_id', 'date_order'], { limit: 1 },
  );
  if (!don) return null;
  const nccId = Array.isArray(don.partner_id) ? Number(don.partner_id[0]) : 0;
  const [ncc] = nccId
    ? await odoo.searchRead<Record<string, unknown>>('res.partner', [['id', '=', nccId]], ['name', 'phone'], { limit: 1 })
    : [undefined];
  const [congTy] = await odoo.searchRead<Record<string, unknown>>(
    'res.company', [], ['name', 'street', 'city', 'phone'], { limit: 1 },
  );
  const lines = await odoo.searchRead<Record<string, unknown>>(
    'purchase.order.line', [['order_id', '=', donId]],
    ['product_id', 'product_qty', 'price_unit', 'price_subtotal'], { limit: 60 },
  );

  const svg = vePhieuNhapSvg({
    ma: String(don.name ?? ''),
    ngay: don.date_order ? String(don.date_order).slice(0, 10) : '',
    ncc: {
      ten: ncc ? String(ncc.name ?? '') : (Array.isArray(don.partner_id) ? String(don.partner_id[1]) : ''),
      ...(ncc?.phone ? { sdt: String(ncc.phone) } : {}),
    },
    congTy: {
      ten: congTy ? String(congTy.name ?? '') : '',
      diaChi: [congTy?.street, congTy?.city].filter(Boolean).map(String).join(', '),
      ...(congTy?.phone ? { sdt: String(congTy.phone) } : {}),
    },
    dong: lines
      .filter((l) => Array.isArray(l.product_id))
      .map((l) => ({
        ten: String((l.product_id as [number, string])[1] ?? ''),
        sl: Number(l.product_qty ?? 0),
        gia: Number(l.price_unit ?? 0),
        thanhTien: Number(l.price_subtotal ?? 0),
      })),
  });
  const duLieu = await sharp(Buffer.from(svg)).png().toBuffer();
  return { duLieu, tenFile: `phieu-nhap-${String(don.name ?? donId)}.png` };
}
