// SPDX-License-Identifier: AGPL-3.0-or-later
// Render chuỗi VietQR → ảnh PNG tạm (để zaloOps.sendImage gửi cho khách).
// Tài khoản nhận tiền đọc từ Odoo (không có → không gen QR, caller bỏ qua).
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import QRCode from 'qrcode';
import { generateVietQrPayload, stripAccents } from './vietqr.js';
import { taiKhoanNhanTien } from '../odoo/tai-khoan-ngan-hang.js';
import type { OdooClient } from '../odoo/client.js';

export interface QrConfig {
  bankBin: string;
  accountNo: string;
  accountName?: string;
}

/**
 * Cấu hình TK nhận tiền — TỪ ODOO (res.partner.bank của công ty), không còn
 * env AI_QR_* (17/08/2026). Odoo không có TK tra được BIN → null → caller bỏ
 * qua QR. Xem tai-khoan-ngan-hang.ts.
 */
export async function getQrConfig(odoo: Pick<OdooClient, 'searchRead'>): Promise<QrConfig | null> {
  const tk = await taiKhoanNhanTien(odoo);
  if (!tk) return null;
  return { bankBin: tk.bankBin, accountNo: tk.accountNo, ...(tk.accountName ? { accountName: tk.accountName } : {}) };
}

/** Nội dung chuyển khoản: "DH <tên khách> <hhmm>" — bỏ dấu, <=25 ký tự. */
export function buildTransferNote(customerName: string, hhmm: string): string {
  const base = `DH ${stripAccents(customerName || 'khach')} ${hhmm}`;
  return base.slice(0, 25).trim();
}

/**
 * Sinh ảnh QR PNG cho 1 đơn. Trả đường dẫn file tạm (caller gửi qua sendImage rồi
 * có thể xoá). amount phải > 0. Lỗi render → throw (caller nuốt + fallback báo sale).
 */
export async function renderVietQrImage(
  cfg: QrConfig,
  amount: number,
  note: string,
): Promise<string> {
  const payload = generateVietQrPayload({
    bankBin: cfg.bankBin,
    accountNo: cfg.accountNo,
    amount,
    description: note,
  });
  const dir = join(tmpdir(), 'zcrm-qr');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `qr-${Date.now()}.png`);
  const dataUrl = await QRCode.toDataURL(payload, { margin: 2, width: 512, errorCorrectionLevel: 'M' });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  await writeFile(file, Buffer.from(base64, 'base64'));
  return file;
}
