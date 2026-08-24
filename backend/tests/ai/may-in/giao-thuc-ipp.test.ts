// SPDX-License-Identifier: AGPL-3.0-or-later
// Giao thức IPP 1.1 (RFC 8010) — encode request / decode response, THUẦN BYTE.
//
// Vì sao tự viết ~150 dòng thay vì npm `ipp`: lib gốc chết từ 2022, callback
// CommonJS không types; bề mặt mình cần chỉ là Print-Job + Get-Job-Attributes
// với máy in HP 4003 nhận PDF trực tiếp. Tự viết thì test khoá được từng byte.
import { describe, it, expect } from 'vitest';
import {
  maHoaPrintJob,
  maHoaGetJobAttributes,
  giaiMaPhanHoi,
  OP_PRINT_JOB,
  OP_GET_JOB_ATTRIBUTES,
} from '../../../src/modules/ai/may-in/giao-thuc-ipp.js';

/** Dựng response IPP giả từng byte — như máy in thật trả về. */
function phanHoiGia(opts: { status: number; requestId: number; jobId?: number; jobState?: number }): Buffer {
  const cac: Buffer[] = [];
  const dau = Buffer.alloc(8);
  dau.writeUInt8(1, 0); // version 1.1
  dau.writeUInt8(1, 1);
  dau.writeUInt16BE(opts.status, 2);
  dau.writeUInt32BE(opts.requestId, 4);
  cac.push(dau);
  // operation-attributes-group: charset + natural-language (máy in luôn trả)
  cac.push(Buffer.from([0x01]));
  cac.push(thuocTinh(0x47, 'attributes-charset', Buffer.from('utf-8')));
  cac.push(thuocTinh(0x48, 'attributes-natural-language', Buffer.from('en')));
  if (opts.jobId !== undefined || opts.jobState !== undefined) {
    cac.push(Buffer.from([0x02])); // job-attributes-group
    if (opts.jobId !== undefined) {
      const v = Buffer.alloc(4);
      v.writeInt32BE(opts.jobId);
      cac.push(thuocTinh(0x21, 'job-id', v)); // integer
    }
    if (opts.jobState !== undefined) {
      const v = Buffer.alloc(4);
      v.writeInt32BE(opts.jobState);
      cac.push(thuocTinh(0x23, 'job-state', v)); // enum
    }
  }
  cac.push(Buffer.from([0x03])); // end-of-attributes
  return Buffer.concat(cac);
}

function thuocTinh(tag: number, ten: string, giaTri: Buffer): Buffer {
  const t = Buffer.from(ten);
  const b = Buffer.alloc(1 + 2 + t.length + 2 + giaTri.length);
  let o = 0;
  b.writeUInt8(tag, o); o += 1;
  b.writeUInt16BE(t.length, o); o += 2;
  t.copy(b, o); o += t.length;
  b.writeUInt16BE(giaTri.length, o); o += 2;
  giaTri.copy(b, o);
  return b;
}

describe('maHoaPrintJob', () => {
  const pdf = Buffer.from('%PDF-1.4 fake');
  const goi = maHoaPrintJob({
    uri: 'ipp://192.168.1.50:631/ipp/print',
    tenJob: 'INV-2026-00042',
    nguoiGui: 'zalocrm',
    requestId: 7,
    pdf,
  });

  it('mở đầu bằng version 1.1 + operation-id Print-Job + request-id', () => {
    expect(goi[0]).toBe(0x01);
    expect(goi[1]).toBe(0x01);
    expect(goi.readUInt16BE(2)).toBe(OP_PRINT_JOB);
    expect(goi.readUInt32BE(4)).toBe(7);
  });

  it('charset utf-8 phải là thuộc tính ĐẦU TIÊN (RFC bắt buộc thứ tự)', () => {
    // byte 8 = tag nhóm operation-attributes, byte 9 = value-tag charset
    expect(goi[8]).toBe(0x01);
    expect(goi[9]).toBe(0x47);
    const tenDaiTai = goi.readUInt16BE(10);
    expect(goi.subarray(12, 12 + tenDaiTai).toString()).toBe('attributes-charset');
  });

  it('mang đủ printer-uri, job-name, document-format application/pdf', () => {
    const chuoi = goi.toString('latin1');
    expect(chuoi).toContain('printer-uri');
    expect(chuoi).toContain('ipp://192.168.1.50:631/ipp/print');
    expect(chuoi).toContain('job-name');
    expect(chuoi).toContain('INV-2026-00042');
    expect(chuoi).toContain('document-format');
    expect(chuoi).toContain('application/pdf');
  });

  it('PDF nằm NGUYÊN VẸN ngay sau byte end-of-attributes 0x03', () => {
    const viTri03 = goi.indexOf(0x03, 8); // sau header, delimiter đầu là 0x01
    // tìm 0x03 đứng ở vị trí delimiter thật: PDF là phần đuôi
    expect(goi.subarray(goi.length - pdf.length).equals(pdf)).toBe(true);
    expect(goi[goi.length - pdf.length - 1]).toBe(0x03);
    expect(viTri03).toBeGreaterThan(8);
  });
});

describe('maHoaGetJobAttributes', () => {
  it('op-id đúng và mang job-id dạng integer', () => {
    const goi = maHoaGetJobAttributes({ uri: 'ipp://x/ipp/print', jobId: 42, requestId: 9 });
    expect(goi.readUInt16BE(2)).toBe(OP_GET_JOB_ATTRIBUTES);
    const chuoi = goi.toString('latin1');
    expect(chuoi).toContain('job-id');
    // giá trị 42 nằm trong 4 byte BE cuối của thuộc tính job-id
    const viTri = goi.indexOf('job-id', 0, 'latin1') + 'job-id'.length + 2;
    expect(goi.readInt32BE(viTri)).toBe(42);
  });
});

describe('giaiMaPhanHoi', () => {
  it('đọc status thành công + job-id máy in cấp', () => {
    const kq = giaiMaPhanHoi(phanHoiGia({ status: 0x0000, requestId: 7, jobId: 118 }));
    expect(kq.status).toBe(0x0000);
    expect(kq.thanhCong).toBe(true);
    expect(kq.thuocTinh['job-id']).toBe(118);
  });

  it('status lỗi client (0x0400+) → thanhCong=false, vẫn đọc được thuộc tính', () => {
    const kq = giaiMaPhanHoi(phanHoiGia({ status: 0x0400, requestId: 7 }));
    expect(kq.thanhCong).toBe(false);
  });

  it('đọc job-state dạng enum (9 = completed)', () => {
    const kq = giaiMaPhanHoi(phanHoiGia({ status: 0x0000, requestId: 3, jobId: 118, jobState: 9 }));
    expect(kq.thuocTinh['job-state']).toBe(9);
  });

  it('gói cụt (chưa đủ 8 byte header) → ném lỗi rõ ràng, không đọc bừa', () => {
    expect(() => giaiMaPhanHoi(Buffer.from([1, 1, 0]))).toThrow(/IPP/);
  });
});
