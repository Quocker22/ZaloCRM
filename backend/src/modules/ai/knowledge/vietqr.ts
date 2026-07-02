// SPDX-License-Identifier: AGPL-3.0-or-later
// VietQR (chuẩn Napas / EMVCo TLV) — port thuật toán từ github.com/subiz/vietqr (Go) sang TS.
// Sinh chuỗi payload EMVCo; render ảnh QR ở nơi khác (lib qrcode).
// Verify khớp ví dụ subiz: Generate(120000,"970415","0011001932418","ung ho lu lut").

/** Ghép 1 trường TLV: id (2 ký tự) + length (2 ký tự, zero-pad) + value. */
function tlv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

/** CRC16-CCITT (ISO/IEC 13239): poly 0x1021, init 0xFFFF. Trả 4 ký tự hex HOA. */
export function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Bỏ dấu tiếng Việt cho nội dung CK (ngân hàng/Zalo hiển thị chuẩn hơn). */
export function stripAccents(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export interface VietQrInput {
  bankBin: string; // mã BIN ngân hàng (6 số), vd '970415' = Vietinbank
  accountNo: string; // số tài khoản
  amount: number; // số tiền VND (nguyên)
  description?: string; // nội dung chuyển khoản (<=25 ký tự, bỏ dấu)
}

/**
 * Sinh chuỗi VietQR payload (EMVCo). Giống subiz.Generate.
 * Field: 00=01(format), 01=12(dynamic có amount), 38(merchant: GUID+BIN+STK+QRIBFTTA),
 *        53=704(VND), 54=amount, 58=VN, 62>08=description, 63=CRC.
 */
export function generateVietQrPayload(input: VietQrInput): string {
  const { bankBin, accountNo, amount } = input;
  const desc = input.description ? stripAccents(input.description).slice(0, 25) : '';

  // Field 38 — Merchant Account Information
  const acctInfo = tlv('00', bankBin) + tlv('01', accountNo); // acquirer BIN + consumer account
  const merchant = tlv('00', 'A000000727') + tlv('01', acctInfo) + tlv('02', 'QRIBFTTA');

  let payload =
    tlv('00', '01') + // Payload Format Indicator
    tlv('01', '12') + // Point of Initiation: 12 = dynamic (có số tiền)
    tlv('38', merchant) +
    tlv('53', '704') + // Currency VND
    tlv('54', String(Math.round(amount))) + // Amount
    tlv('58', 'VN'); // Country

  if (desc) {
    payload += tlv('62', tlv('08', desc)); // Additional data > purpose
  }

  // CRC: tính trên toàn chuỗi + literal "6304", rồi gắn 4 ký tự CRC.
  payload += '6304';
  return payload + crc16(payload);
}
