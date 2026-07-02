// SPDX-License-Identifier: AGPL-3.0-or-later
// Render chuỗi VietQR → ảnh PNG tạm (để zaloOps.sendImage gửi cho khách).
// Cấu hình tài khoản nhận tiền qua env (chưa set → không gen QR, caller báo sale).
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import QRCode from 'qrcode';
import { generateVietQrPayload, stripAccents } from './vietqr.js';

export interface QrConfig {
  bankBin: string;
  accountNo: string;
  accountName?: string;
}

/** Đọc cấu hình TK nhận tiền từ env. Thiếu BIN hoặc STK → null (chưa cấu hình). */
export function getQrConfig(): QrConfig | null {
  const bankBin = process.env.AI_QR_BANK_BIN?.trim();
  const accountNo = process.env.AI_QR_ACCOUNT_NO?.trim();
  if (!bankBin || !accountNo) return null;
  return { bankBin, accountNo, accountName: process.env.AI_QR_ACCOUNT_NAME?.trim() || undefined };
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
