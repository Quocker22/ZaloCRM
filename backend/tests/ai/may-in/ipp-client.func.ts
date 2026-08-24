// SPDX-License-Identifier: AGPL-3.0-or-later
// IppClient — gửi gói IPP qua HTTP POST tới máy in. Test với server giả
// node:http nói đúng giao thức byte, KHÔNG mock fetch: đường đi thật từ
// encode → HTTP → decode.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { IppClient, LoiIpp, LoiKhongRo } from '../../../src/modules/ai/may-in/ipp-client.js';
import { giaiMaPhanHoi, OP_PRINT_JOB } from '../../../src/modules/ai/may-in/giao-thuc-ipp.js';

/** Máy in giả: nhận gói IPP, trả kịch bản đặt trước. */
function mayInGia() {
  const daNhan: Buffer[] = [];
  let kichBan: (goi: Buffer, res: http.ServerResponse) => void = (goi, res) => {
    // mặc định: Print-Job OK cấp job-id 118; Get-Job OK trả state completed
    const op = goi.readUInt16BE(2);
    const requestId = goi.readUInt32BE(4);
    res.setHeader('content-type', 'application/ipp');
    res.end(
      op === OP_PRINT_JOB
        ? goiPhanHoi(0x0000, requestId, { 'job-id': 118 })
        : goiPhanHoi(0x0000, requestId, { 'job-id': 118, 'job-state': 9 }),
    );
  };
  const server = http.createServer((req, res) => {
    const phan: Buffer[] = [];
    req.on('data', (c) => phan.push(c));
    req.on('end', () => {
      const goi = Buffer.concat(phan);
      daNhan.push(goi);
      kichBan(goi, res);
    });
  });
  return {
    server,
    daNhan,
    datKichBan(f: typeof kichBan) { kichBan = f; },
  };
}

function goiPhanHoi(status: number, requestId: number, so: Record<string, number>): Buffer {
  const cac: Buffer[] = [];
  const dau = Buffer.alloc(8);
  dau.writeUInt8(1, 0); dau.writeUInt8(1, 1);
  dau.writeUInt16BE(status, 2);
  dau.writeUInt32BE(requestId, 4);
  cac.push(dau, Buffer.from([0x02]));
  for (const [ten, giaTri] of Object.entries(so)) {
    const t = Buffer.from(ten);
    const b = Buffer.alloc(1 + 2 + t.length + 2 + 4);
    let o = 0;
    b.writeUInt8(ten === 'job-state' ? 0x23 : 0x21, o); o += 1;
    b.writeUInt16BE(t.length, o); o += 2;
    t.copy(b, o); o += t.length;
    b.writeUInt16BE(4, o); o += 2;
    b.writeInt32BE(giaTri, o);
    cac.push(b);
  }
  cac.push(Buffer.from([0x03]));
  return Buffer.concat(cac);
}

const may = mayInGia();
let uri = '';

beforeAll(async () => {
  await new Promise<void>((r) => may.server.listen(0, '127.0.0.1', r));
  const { port } = may.server.address() as AddressInfo;
  // ipp:// đổi thành http:// cùng cổng — client phải tự hiểu
  uri = `ipp://127.0.0.1:${port}/ipp/print`;
});
afterAll(async () => {
  await new Promise((r) => may.server.close(r));
});

const PDF = Buffer.from('%PDF-1.4 hoa don');

describe('IppClient.inPdf', () => {
  it('gửi đúng gói Print-Job, PDF nguyên vẹn, nhận job-id máy in cấp', async () => {
    const client = new IppClient({ uri });
    const kq = await client.inPdf(PDF, 'INV/2026/00042');
    expect(kq.jobId).toBe(118);

    const goi = may.daNhan.at(-1)!;
    expect(goi.readUInt16BE(2)).toBe(OP_PRINT_JOB);
    expect(goi.subarray(goi.length - PDF.length).equals(PDF)).toBe(true);
    // job-name mang số hoá đơn để nhìn hàng đợi máy in là biết của ai
    expect(goi.toString('latin1')).toContain('INV/2026/00042');
  });

  it('máy in trả status lỗi IPP (0x0400) → ném LoiIpp, KHÔNG phải LoiKhongRo', async () => {
    may.datKichBan((goi, res) => {
      res.setHeader('content-type', 'application/ipp');
      res.end(goiPhanHoi(0x0400, goi.readUInt32BE(4), {}));
    });
    const client = new IppClient({ uri });
    await expect(client.inPdf(PDF, 'x')).rejects.toBeInstanceOf(LoiIpp);
  });

  it('HTTP 500 → ném LoiIpp kèm mã HTTP', async () => {
    may.datKichBan((_goi, res) => { res.statusCode = 500; res.end('boom'); });
    const client = new IppClient({ uri });
    await expect(client.inPdf(PDF, 'x')).rejects.toThrow(/500/);
  });

  it('không kết nối được (connection refused) → LoiIpp guiDuoc=false — retry an toàn', async () => {
    // Cổng vừa được cấp rồi giải phóng — chắc chắn ECONNREFUSED thật (port 1
    // không dùng được: nằm trong danh sách bad-port của chuẩn fetch, undici
    // chặn trước khi mở socket).
    const tam = http.createServer();
    await new Promise<void>((r) => tam.listen(0, '127.0.0.1', r));
    const congTrong = (tam.address() as AddressInfo).port;
    await new Promise((r) => tam.close(r));
    const client = new IppClient({ uri: `ipp://127.0.0.1:${congTrong}/ipp/print`, timeoutMs: 2000 });
    const loi = await client.inPdf(PDF, 'x').catch((e) => e);
    expect(loi).toBeInstanceOf(LoiIpp);
    expect((loi as LoiIpp).guiDuoc).toBe(false);
  });

  it('timeout GIỮA CHỪNG (đã nối, không thấy trả lời) → LoiKhongRo — CẤM retry mù', async () => {
    may.datKichBan(() => { /* im lặng, không bao giờ trả lời */ });
    const client = new IppClient({ uri, timeoutMs: 300 });
    await expect(client.inPdf(PDF, 'x')).rejects.toBeInstanceOf(LoiKhongRo);
  });
});

describe('IppClient.traTrangThaiJob', () => {
  it('trả job-state từ máy in (9 = completed)', async () => {
    may.datKichBan((goi, res) => {
      res.setHeader('content-type', 'application/ipp');
      res.end(goiPhanHoi(0x0000, goi.readUInt32BE(4), { 'job-id': 118, 'job-state': 9 }));
    });
    const client = new IppClient({ uri });
    const kq = await client.traTrangThaiJob(118);
    expect(kq.jobState).toBe(9);
  });
});
