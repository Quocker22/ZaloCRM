// SPDX-License-Identifier: AGPL-3.0-or-later
// Giao thức IPP 1.1 (RFC 8010/8011) — encode request / decode response, THUẦN BYTE.
//
// VÌ SAO TỰ VIẾT thay vì npm `ipp`: lib gốc ngừng bảo trì 2022 (callback,
// CommonJS, không types); bề mặt mình cần chỉ là Print-Job +
// Get-Job-Attributes với máy in HP 4003 nhận PDF trực tiếp — ~150 dòng có
// test khoá từng byte, không rước thêm dependency phải nuôi.
//
// KHÔNG có IO ở đây: file này chỉ Buffer↔object. HTTP nằm ở ipp-client.ts.

/** operation-id Print-Job (RFC 8011 §4.2.1). */
export const OP_PRINT_JOB = 0x0002;
/** operation-id Get-Job-Attributes (RFC 8011 §4.3.4). */
export const OP_GET_JOB_ATTRIBUTES = 0x0009;

// value-tag (RFC 8010 §3.5.2)
const TAG_INTEGER = 0x21;
const TAG_NAME = 0x42;
const TAG_KEYWORD = 0x44;
const TAG_URI = 0x45;
const TAG_CHARSET = 0x47;
const TAG_LANGUAGE = 0x48;
const TAG_MIME = 0x49;

const NHOM_OPERATION = 0x01;
const HET_THUOC_TINH = 0x03;

/** job-state enum (RFC 8011 §5.3.7). */
export const JOB_STATE = {
  pending: 3,
  pendingHeld: 4,
  processing: 5,
  processingStopped: 6,
  canceled: 7,
  aborted: 8,
  completed: 9,
} as const;

function thuocTinh(tag: number, ten: string, giaTri: Buffer): Buffer {
  const t = Buffer.from(ten, 'utf8');
  const b = Buffer.alloc(1 + 2 + t.length + 2 + giaTri.length);
  let o = 0;
  b.writeUInt8(tag, o); o += 1;
  b.writeUInt16BE(t.length, o); o += 2;
  t.copy(b, o); o += t.length;
  b.writeUInt16BE(giaTri.length, o); o += 2;
  giaTri.copy(b, o);
  return b;
}

function soNguyen(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
}

function dauGoi(operationId: number, requestId: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeUInt8(1, 0); // IPP 1.1 — HP 4003 hỗ trợ, và 1.1 là mẫu số chung
  b.writeUInt8(1, 1);
  b.writeUInt16BE(operationId, 2);
  b.writeUInt32BE(requestId, 4);
  return b;
}

/**
 * Thuộc tính mở đầu BẮT BUỘC ĐÚNG THỨ TỰ (RFC 8011 §4.1.4): charset trước,
 * natural-language sau, rồi mới tới các thuộc tính khác. Sai thứ tự là máy in
 * trả client-error-bad-request.
 */
function moDau(uri: string): Buffer[] {
  return [
    Buffer.from([NHOM_OPERATION]),
    thuocTinh(TAG_CHARSET, 'attributes-charset', Buffer.from('utf-8')),
    thuocTinh(TAG_LANGUAGE, 'attributes-natural-language', Buffer.from('en')),
    thuocTinh(TAG_URI, 'printer-uri', Buffer.from(uri)),
  ];
}

export interface ThamSoPrintJob {
  /** vd ipp://192.168.1.50:631/ipp/print */
  uri: string;
  /** Hiện trên màn hình máy in / hàng đợi — dùng số hoá đơn cho dễ truy. */
  tenJob: string;
  nguoiGui: string;
  requestId: number;
  pdf: Buffer;
}

/** Dựng gói Print-Job: header + thuộc tính + PDF nguyên vẹn ở đuôi. */
export function maHoaPrintJob(p: ThamSoPrintJob): Buffer {
  return Buffer.concat([
    dauGoi(OP_PRINT_JOB, p.requestId),
    ...moDau(p.uri),
    thuocTinh(TAG_NAME, 'requesting-user-name', Buffer.from(p.nguoiGui)),
    thuocTinh(TAG_NAME, 'job-name', Buffer.from(p.tenJob)),
    thuocTinh(TAG_MIME, 'document-format', Buffer.from('application/pdf')),
    Buffer.from([HET_THUOC_TINH]),
    p.pdf,
  ]);
}

export interface ThamSoGetJob {
  uri: string;
  jobId: number;
  requestId: number;
}

/** Dựng gói Get-Job-Attributes — hỏi trạng thái một job đã gửi. */
export function maHoaGetJobAttributes(p: ThamSoGetJob): Buffer {
  return Buffer.concat([
    dauGoi(OP_GET_JOB_ATTRIBUTES, p.requestId),
    ...moDau(p.uri),
    thuocTinh(TAG_INTEGER, 'job-id', soNguyen(p.jobId)),
    thuocTinh(
      TAG_KEYWORD,
      'requested-attributes',
      Buffer.from('job-state'),
    ),
    Buffer.from([HET_THUOC_TINH]),
  ]);
}

export interface PhanHoiIpp {
  /** status-code IPP: 0x0000-0x00FF = thành công. */
  status: number;
  thanhCong: boolean;
  requestId: number;
  /**
   * Thuộc tính đã giải mã, phẳng theo tên. Integer/enum → number, còn lại →
   * string. Trùng tên (additional-value) giữ giá trị ĐẦU — đủ cho job-id/state.
   */
  thuocTinh: Record<string, number | string>;
}

/**
 * Giải mã response IPP. Chỉ đọc tới end-of-attributes; phần data sau đó (nếu
 * có) không thuộc phạm vi mình dùng.
 */
export function giaiMaPhanHoi(goi: Buffer): PhanHoiIpp {
  if (goi.length < 9) {
    throw new Error(`Gói IPP cụt: ${goi.length} byte, cần tối thiểu 9`);
  }
  const status = goi.readUInt16BE(2);
  const requestId = goi.readUInt32BE(4);
  const thuocTinh: Record<string, number | string> = {};

  let o = 8;
  let tenTruoc = ''; // additional-value: name-length=0 nghĩa là cùng tên trước
  while (o < goi.length) {
    const tag = goi.readUInt8(o);
    o += 1;
    if (tag === HET_THUOC_TINH) break;
    if (tag < 0x10) continue; // delimiter nhóm (0x01, 0x02, 0x04, 0x05)

    if (o + 2 > goi.length) throw new Error('Gói IPP hỏng: thiếu name-length');
    const tenDai = goi.readUInt16BE(o);
    o += 2;
    if (o + tenDai > goi.length) throw new Error('Gói IPP hỏng: name vượt biên');
    const ten = tenDai > 0 ? goi.subarray(o, o + tenDai).toString('utf8') : tenTruoc;
    o += tenDai;

    if (o + 2 > goi.length) throw new Error('Gói IPP hỏng: thiếu value-length');
    const giaTriDai = goi.readUInt16BE(o);
    o += 2;
    if (o + giaTriDai > goi.length) throw new Error('Gói IPP hỏng: value vượt biên');
    const giaTri = goi.subarray(o, o + giaTriDai);
    o += giaTriDai;

    tenTruoc = ten;
    if (ten in thuocTinh) continue; // giữ giá trị đầu
    if ((tag === TAG_INTEGER || tag === 0x23) && giaTriDai === 4) {
      thuocTinh[ten] = giaTri.readInt32BE(0);
    } else {
      thuocTinh[ten] = giaTri.toString('utf8');
    }
  }

  return { status, thanhCong: status <= 0x00ff, requestId, thuocTinh };
}
