// SPDX-License-Identifier: AGPL-3.0-or-later
// ẢNH PHIẾU NHẬP tự vẽ — BÁM MẪU "PHIẾU NHẬP HÀNG" của app ERP incokit.
//
// Ba vòng góp ý thật của anh Quốc (16-17/08), mỗi vòng một bài:
//   1. Render report Odoo → ra "Yêu cầu báo giá" chuẩn Odoo ("đâu phải phiếu
//      custom của tôi") — prod không có report purchase custom.
//   2. Vẽ bảng kiểu báo cáo → "gửi hình này gọi là hóa đơn đấy hả?".
//   3. Thêm đầu chứng từ vẫn chưa đạt → anh gửi MẪU THẬT từ app ERP
//      ("phiếu nhập trên app nó như này mà"): logo + khối công ty, tiêu đề
//      PHIẾU NHẬP HÀNG xanh giữa trang, Số/Ngày, hai cột NCC|Kho-Người tạo-
//      Trạng thái, bảng kẻ ô STT/Mã SP/Tên/ĐVT/SL/Đơn giá/Thành tiền, khối
//      tổng (Tổng SL/Tiền hàng/Thuế/Tổng cộng xanh), ba ô ký tên.
//   Mẫu đó nằm ở repo app-erp (không đụng được từ đây) — dựng lại bằng SVG
//   cùng kỹ thuật anh-bang; logo đọc từ res.company.logo của chính Odoo.
import sharp from 'sharp';
import type { OdooClient } from './client.js';

const XANH_DUONG = '#1a73e8';
const tien = (n: number): string => `${Math.round(n).toLocaleString('vi-VN')} đ`;

/** Thoát ký tự XML — tên SP/NCC có thể chứa &, <, " làm hỏng SVG. */
function thoat(s: string | number): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Bỏ tiền tố "[mã]" và cắt gọn ở ranh giới từ cho vừa cột. */
export function gonTen(ten: string, tran = 40): string {
  // Bỏ luôn hậu tố đơn vị "(cái)/(tấm)…" — cột ĐVT đã có, để lại là đè cột.
  const sach = ten
    .replace(/^\[[^\]]*\]\s*/, '')
    .replace(/\s*\((cái|tấm|mét|cuộn|bộ|thanh|bóng|m|c)[^)]*\)\s*$/i, '')
    .trim();
  if (sach.length <= tran) return sach;
  const cat = sach.slice(0, tran);
  const cuoi = cat.lastIndexOf(' ');
  return `${(cuoi > tran * 0.6 ? cat.slice(0, cuoi) : cat).trimEnd()}…`;
}

/** Mã SP từ tiền tố "[...]" trong tên dòng Odoo — không có thì rỗng. */
export function maTuTen(ten: string): string {
  const m = /^\[([^\]]{1,18})\]/.exec(ten.trim());
  return m ? m[1] : '';
}

/** Nhãn trạng thái phiếu cho người đọc — không nhả chữ Odoo thô. */
export function nhanTrangThai(state: string): string {
  return state === 'draft' ? 'Nháp' : state === 'sent' ? 'Đã gửi NCC'
    : state === 'purchase' ? 'Đã xác nhận' : state === 'done' ? 'Hoàn tất'
      : state === 'cancel' ? 'Đã huỷ' : state;
}

export interface DuLieuPhieuNhap {
  ma: string;
  ngay: string;
  trangThai: string;
  khoNhan: string;
  nguoiTao: string;
  ncc: { ten: string; sdt?: string; diaChi?: string };
  congTy: { ten: string; diaChi: string; sdt?: string; email?: string };
  /** PNG/JPEG base64 từ res.company.logo — thiếu thì vẽ chữ thay logo. */
  logoB64?: string;
  dong: Array<{ ma: string; ten: string; dvt: string; sl: number; gia: number; thanhTien: number }>;
  thue: number;
}

/** Dựng SVG bám mẫu app — thuần, test khoá được nội dung. */
export function vePhieuNhapSvg(d: DuLieuPhieuNhap): string {
  const W = 760;
  const DEM = 24;
  const parts: string[] = [];
  let y = 22;

  // ── Khối đầu: logo trái + thông tin công ty phải ──
  if (d.logoB64) {
    parts.push(`<image x="${DEM}" y="${y}" width="180" height="86" preserveAspectRatio="xMinYMid meet" href="data:image/png;base64,${d.logoB64}"/>`);
  } else {
    parts.push(`<text x="${DEM}" y="${y + 52}" font-size="34" font-weight="700" fill="#0b6b3a">${thoat(d.congTy.ten.split(' ')[0] ?? '')}</text>`);
  }
  const xTT = 250;
  const dongTT = (nhan: string, gt: string, yy: number) =>
    `<text x="${xTT}" y="${yy}" font-size="13"><tspan font-weight="700">${thoat(nhan)}:&#160;</tspan>${thoat(gt)}</text>`;
  let yTT = y + 14;
  parts.push(dongTT('Công ty', d.congTy.ten, yTT)); yTT += 20;
  parts.push(dongTT('Địa chỉ', d.congTy.diaChi, yTT)); yTT += 20;
  parts.push(dongTT('Điện thoại', d.congTy.sdt ?? '', yTT)); yTT += 20;
  parts.push(dongTT('Email', d.congTy.email ?? '', yTT)); yTT += 12;
  y = Math.max(y + 92, yTT + 6);
  parts.push(`<line x1="${DEM}" y1="${y}" x2="${W - DEM}" y2="${y}" stroke="#111" stroke-width="2"/>`);
  y += 34;

  // ── Tiêu đề giữa trang ──
  parts.push(`<text x="${W / 2}" y="${y}" font-size="24" font-weight="700" text-anchor="middle" fill="${XANH_DUONG}">PHIẾU NHẬP HÀNG</text>`);
  y += 24;
  parts.push(`<text x="${W / 2}" y="${y}" font-size="13" text-anchor="middle">Số: <tspan font-weight="700">${thoat(d.ma)}</tspan> · Ngày ${thoat(d.ngay)}</text>`);
  y += 30;

  // ── Hai cột thông tin ──
  const xPhai = W / 2 + 10;
  const capTrai: Array<[string, string]> = [
    ['Nhà cung cấp', d.ncc.ten],
    ['Điện thoại', d.ncc.sdt ?? ''],
    ['Địa chỉ NCC', d.ncc.diaChi ?? ''],
  ];
  const capPhai: Array<[string, string]> = [
    ['Kho nhận', d.khoNhan],
    ['Người tạo', d.nguoiTao],
    ['Trạng thái', d.trangThai],
  ];
  for (let i = 0; i < 3; i++) {
    parts.push(`<text x="${DEM}" y="${y}" font-size="13"><tspan font-weight="700">${thoat(capTrai[i][0])}:&#160;</tspan>${thoat(capTrai[i][1])}</text>`);
    parts.push(`<text x="${xPhai}" y="${y}" font-size="13"><tspan font-weight="700">${thoat(capPhai[i][0])}:&#160;</tspan>${thoat(capPhai[i][1])}</text>`);
    y += 24;
  }
  y += 8;

  // ── Bảng kẻ ô: STT | Mã SP | Tên sản phẩm | ĐVT | SL | Đơn giá | Thành tiền ──
  const wBang = W - DEM * 2;
  // Đo từ ảnh thật P04530: "1.646.400.000 đ" cần ~120px, không thì end-anchor
  // tràn NGƯỢC sang cột Đơn giá. Tên nhường chỗ (đã gọn + bỏ hậu tố đơn vị).
  const rong = [36, 96, wBang - 36 - 96 - 52 - 64 - 102 - 126, 52, 64, 102, 126];
  const oCot = (i: number) => DEM + rong.slice(0, i).reduce((a, b) => a + b, 0);
  const CAO = 34;
  const tieuDeCot = ['STT', 'Mã SP', 'Tên sản phẩm', 'ĐVT', 'SL', 'Đơn giá', 'Thành tiền'];
  const yBang = y;
  // header
  tieuDeCot.forEach((c, i) => {
    parts.push(`<text x="${oCot(i) + rong[i] / 2}" y="${y + 22}" font-size="13" font-weight="700" text-anchor="middle" fill="#8a8f98">${thoat(c)}</text>`);
  });
  y += CAO;
  for (const [r, dg] of d.dong.entries()) {
    const oGiua = (i: number, gt: string, anchor = 'middle', x?: number) =>
      parts.push(`<text x="${x ?? oCot(i) + rong[i] / 2}" y="${y + 22}" font-size="13" text-anchor="${anchor}">${thoat(gt)}</text>`);
    oGiua(0, String(r + 1));
    oGiua(1, dg.ma.length > 12 ? `${dg.ma.slice(0, 11)}…` : dg.ma);
    oGiua(2, gonTen(dg.ten, 30), 'start', oCot(2) + 8);
    oGiua(3, dg.dvt);
    oGiua(4, dg.sl.toLocaleString('vi-VN'), 'end', oCot(4) + rong[4] - 6);
    oGiua(5, dg.gia > 0 ? tien(dg.gia) : 'chưa có', 'end', oCot(5) + rong[5] - 8);
    oGiua(6, dg.thanhTien > 0 ? tien(dg.thanhTien) : '—', 'end', oCot(6) + rong[6] - 8);
    y += CAO;
  }
  // kẻ ô
  const yCuoi = y;
  for (let i = 0; i <= 7; i++) {
    const x = i === 7 ? DEM + wBang : oCot(i);
    parts.push(`<line x1="${x}" y1="${yBang}" x2="${x}" y2="${yCuoi}" stroke="#333" stroke-width="1"/>`);
  }
  for (let r = 0; r <= d.dong.length + 1; r++) {
    const yy = yBang + r * CAO;
    parts.push(`<line x1="${DEM}" y1="${yy}" x2="${DEM + wBang}" y2="${yy}" stroke="#333" stroke-width="1"/>`);
  }
  y += 24;

  // ── Khối tổng, canh phải ──
  const tongSl = d.dong.reduce((t, x) => t + x.sl, 0);
  const tienHang = d.dong.reduce((t, x) => t + x.thanhTien, 0);
  const capTong: Array<[string, string, boolean]> = [
    ['Tổng số lượng', tongSl.toLocaleString('vi-VN'), false],
    ['Tổng tiền hàng', tien(tienHang), false],
    ['Thuế', tien(d.thue), false],
    ['Tổng cộng', tien(tienHang + d.thue), true],
  ];
  for (const [nhan, gt, dam] of capTong) {
    parts.push(`<text x="${W / 2 + 60}" y="${y}" font-size="14" font-weight="700" text-anchor="end" fill="${dam ? XANH_DUONG : '#111'}">${thoat(nhan)}:</text>`);
    parts.push(`<text x="${W - DEM}" y="${y}" font-size="14" ${dam ? `font-weight="700" fill="${XANH_DUONG}" text-decoration="underline"` : ''} text-anchor="end">${thoat(gt)}</text>`);
    y += 24;
  }
  y += 26;

  // ── Ba ô ký tên ──
  const kyTen = ['NGƯỜI LẬP PHIẾU', 'THỦ KHO', 'NHÀ CUNG CẤP'];
  kyTen.forEach((k, i) => {
    const x = DEM + (wBang / 6) + i * (wBang / 3);
    parts.push(`<text x="${x}" y="${y}" font-size="13" font-weight="700" text-anchor="middle">${thoat(k)}</text>`);
    parts.push(`<text x="${x}" y="${y + 18}" font-size="11" text-anchor="middle" fill="#666">(Ký, ghi rõ họ tên)</text>`);
  });
  y += 90;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}">` +
    `<rect width="${W}" height="${y}" fill="#ffffff"/>${parts.join('')}</svg>`
  );
}

/** Đọc phiếu + công ty + NCC + logo từ Odoo rồi vẽ PNG. */
export async function anhPhieuNhap(
  odoo: Pick<OdooClient, 'searchRead'>,
  donId: number,
): Promise<{ duLieu: Buffer; tenFile: string } | null> {
  const [don] = await odoo.searchRead<Record<string, unknown>>(
    'purchase.order', [['id', '=', donId]],
    ['name', 'partner_id', 'date_order', 'state', 'picking_type_id', 'create_uid', 'amount_tax'],
    { limit: 1 },
  );
  if (!don) return null;
  const nccId = Array.isArray(don.partner_id) ? Number(don.partner_id[0]) : 0;
  const [ncc] = nccId
    ? await odoo.searchRead<Record<string, unknown>>(
      'res.partner', [['id', '=', nccId]], ['name', 'phone', 'street', 'city'], { limit: 1 })
    : [undefined];
  // Logo lấy riêng: field binary nặng, lỗi cũng không được chặn phiếu.
  let logoB64: string | undefined;
  let congTy: Record<string, unknown> | undefined;
  try {
    [congTy] = await odoo.searchRead<Record<string, unknown>>(
      'res.company', [], ['name', 'street', 'city', 'phone', 'email', 'logo'], { limit: 1 },
    );
    if (congTy?.logo && typeof congTy.logo === 'string' && congTy.logo.length > 100) {
      logoB64 = congTy.logo;
    }
  } catch {
    [congTy] = await odoo.searchRead<Record<string, unknown>>(
      'res.company', [], ['name', 'street', 'city', 'phone', 'email'], { limit: 1 },
    );
  }
  const lines = await odoo.searchRead<Record<string, unknown>>(
    'purchase.order.line', [['order_id', '=', donId]],
    ['product_id', 'product_qty', 'price_unit', 'price_subtotal', 'product_uom'], { limit: 60 },
  );

  const khoTho = Array.isArray(don.picking_type_id) ? String(don.picking_type_id[1]) : '';
  const svg = vePhieuNhapSvg({
    ma: String(don.name ?? ''),
    ngay: don.date_order ? String(don.date_order).slice(0, 10).split('-').reverse().join('/') : '',
    trangThai: nhanTrangThai(String(don.state ?? '')),
    // "Chi nhánh trung tâm: Receipts" → "Chi nhánh trung tâm"
    khoNhan: khoTho.split(':')[0].trim(),
    nguoiTao: Array.isArray(don.create_uid) ? String(don.create_uid[1]) : '',
    ncc: {
      ten: ncc ? String(ncc.name ?? '') : (Array.isArray(don.partner_id) ? String(don.partner_id[1]) : ''),
      ...(ncc?.phone ? { sdt: String(ncc.phone) } : {}),
      diaChi: [ncc?.street, ncc?.city].filter(Boolean).map(String).join(', '),
    },
    congTy: {
      ten: congTy ? String(congTy.name ?? '') : '',
      diaChi: [congTy?.street, congTy?.city].filter(Boolean).map(String).join(', '),
      ...(congTy?.phone ? { sdt: String(congTy.phone) } : {}),
      ...(congTy?.email ? { email: String(congTy.email) } : {}),
    },
    ...(logoB64 ? { logoB64 } : {}),
    dong: lines
      .filter((l) => Array.isArray(l.product_id))
      .map((l) => {
        const tenTho = String((l.product_id as [number, string])[1] ?? '');
        return {
          ma: maTuTen(tenTho),
          ten: tenTho,
          dvt: Array.isArray(l.product_uom) ? String(l.product_uom[1]) : '',
          sl: Number(l.product_qty ?? 0),
          gia: Number(l.price_unit ?? 0),
          thanhTien: Number(l.price_subtotal ?? 0),
        };
      }),
    thue: Number(don.amount_tax ?? 0),
  });
  const duLieu = await sharp(Buffer.from(svg)).png().toBuffer();
  return { duLieu, tenFile: `phieu-nhap-${String(don.name ?? donId)}.png` };
}
