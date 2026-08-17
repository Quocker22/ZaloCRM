// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: TRA TÀI KHOẢN NGÂN HÀNG / QR của shop — cho NHÂN VIÊN.
//
// Ca thật 22:27 17/08: NV "cho tôi QR của ngân hàng đi" → bot "bên em không có
// thông tin số tài khoản hay mã QR" — SAI: TK nằm sẵn trên Odoo (res.partner.
// bank công ty, 5 TK), bot chỉ chưa có tool để tra. QR trước đó chỉ tự sinh
// khi KHÁCH chốt đơn; NV muốn lấy để gửi tay thì bí.
//
// Trả về: danh sách TK (STK, chủ TK, ngân hàng) + sinh sẵn ẢNH QR cho TK mặc
// định (dòng đầu Odoo) — số tiền tuỳ chọn. Ảnh đi kênh riêng (nhanTepBaoCao),
// không qua LLM.
import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import { taiKhoanNhanTien, binTuTenNganHang } from '../tai-khoan-ngan-hang.js';
import { renderVietQrImage, buildTransferNote } from '../../knowledge/qr-image.js';
import { readFile } from 'node:fs/promises';

export interface KetQuaTraNganHang {
  danhSach: Array<{ stk: string; chuTk: string; nganHang: string; macDinh: boolean; coQr: boolean }>;
  qr?: { duLieu: Buffer; tenFile: string; soTien?: number; noiDung: string };
  lyDoKhongQr?: string;
}

export async function traNganHang(
  deps: { odoo: Pick<OdooClient, 'searchRead'> },
  input: { so_tien?: number; noi_dung?: string },
): Promise<KetQuaTraNganHang> {
  const [cty] = await deps.odoo.searchRead<Record<string, unknown>>(
    'res.company', [], ['id', 'partner_id'], { limit: 1 },
  );
  const partnerId = Array.isArray(cty?.partner_id) ? Number(cty.partner_id[0]) : 0;
  const ds = partnerId
    ? await deps.odoo.searchRead<Record<string, unknown>>(
      'res.partner.bank',
      [['partner_id', '=', partnerId], ['active', '=', true]],
      ['acc_number', 'acc_holder_name', 'bank_id', 'sequence'],
      { limit: 20, order: 'sequence asc, id asc' },
    )
    : [];
  const macDinh = await taiKhoanNhanTien(deps.odoo);
  const danhSach = ds.map((d) => {
    const nganHang = Array.isArray(d.bank_id) ? String(d.bank_id[1]) : '';
    const stk = String(d.acc_number ?? '').replace(/\s+/g, '');
    return {
      stk,
      chuTk: String(d.acc_holder_name ?? ''),
      nganHang,
      macDinh: macDinh?.accountNo === stk,
      coQr: binTuTenNganHang(nganHang) != null,
    };
  });
  const kq: KetQuaTraNganHang = { danhSach };
  if (!macDinh) {
    kq.lyDoKhongQr = danhSach.length
      ? 'có TK trên Odoo nhưng chưa tra được mã ngân hàng để sinh QR'
      : 'công ty chưa khai báo TK ngân hàng trên Odoo';
    return kq;
  }
  const soTien = Number.isFinite(Number(input.so_tien)) && Number(input.so_tien) > 0 ? Number(input.so_tien) : 0;
  const noiDung = (input.noi_dung ?? '').trim()
    || buildTransferNote('shop', new Date().toISOString().slice(11, 16).replace(':', ''));
  const file = await renderVietQrImage(macDinh, soTien, noiDung);
  kq.qr = {
    duLieu: await readFile(file),
    tenFile: `qr-${macDinh.accountNo}${soTien ? `-${soTien}` : ''}.png`,
    ...(soTien ? { soTien } : {}),
    noiDung,
  };
  return kq;
}

export function dinhDangTraNganHang(kq: KetQuaTraNganHang): string {
  if (!kq.danhSach.length) {
    return 'Công ty CHƯA khai báo tài khoản ngân hàng nào trên Odoo. Báo NV nhờ kế toán thêm TK vào Odoo (Công ty → Tài khoản ngân hàng) — thêm xong bot dùng được ngay.';
  }
  const dong = kq.danhSach.map((t) =>
    `- ${t.nganHang} · STK ${t.stk} · ${t.chuTk}${t.macDinh ? ' (MẶC ĐỊNH — QR dùng TK này)' : ''}`,
  ).join('\n');
  const qr = kq.qr
    ? `\nĐÃ GỬI ẢNH QR cho TK mặc định${kq.qr.soTien ? ` số tiền ${kq.qr.soTien.toLocaleString('vi-VN')}đ` : ' (không ghi số tiền, người chuyển tự điền)'}, nội dung "${kq.qr.noiDung}". Báo NV là QR ở ảnh trên; muốn QR TK khác thì kéo TK đó lên đầu trên Odoo.`
    : `\nKHÔNG sinh được QR: ${kq.lyDoKhongQr}.`;
  return `Tài khoản ngân hàng của shop (từ Odoo):\n${dong}${qr}`;
}

export const traNganHangDefinition: ToolDefinition = {
  name: 'tra_ngan_hang',
  description:
    'Tra TÀI KHOẢN NGÂN HÀNG của shop trên Odoo và gửi ẢNH QR chuyển khoản. ' +
    'GỌI KHI nhân viên hỏi: "số tài khoản", "stk", "QR ngân hàng", "gửi QR cho khách", ' +
    '"chuyển khoản vào đâu". Có thể kèm số tiền để QR điền sẵn. KHÔNG bao giờ trả lời ' +
    '"không có thông tin ngân hàng" mà chưa gọi tool này.',
  inputSchema: {
    type: 'object',
    properties: {
      so_tien: { type: 'number', description: 'Số tiền điền sẵn vào QR (đ). Bỏ trống = QR không số tiền.' },
      noi_dung: { type: 'string', description: 'Nội dung chuyển khoản, nếu NV nói. Bỏ trống = tự sinh.' },
    },
    required: [],
  },
};
