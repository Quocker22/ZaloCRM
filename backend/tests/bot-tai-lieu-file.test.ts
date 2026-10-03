// SPDX-License-Identifier: AGPL-3.0-or-later
// docs/79 §PDF cho khách (03/10) — FILE PDF GỐC kèm câu trả lời thông số cho bot Hermes, phần KHÔNG cần DB:
//   • `timFileKemTriThuc` = đúng luật chọn file của `kemFileTriThuc` (agent CRM) — bot không viết lại bộ khớp;
//   • `docYeuCauFile` (thân sai ⇒ 400), `tenCoDauHieuNoiBo` (tên file nội bộ ⇒ đường khách bỏ);
//   • `layFileKemTriThuc` đường NV với kho/tải giả: trả bytes PDF; không khớp/không phải PDF/quá trần/tải lỗi ⇒ {file: null}.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timFileKemTriThuc, kemFileTriThuc, type TaiLieu } from '../src/modules/ai/odoo/tools/gui-tai-lieu.js';
import { docYeuCauFile, tenCoDauHieuNoiBo, layFileKemTriThuc, TRAN_FILE_BYTE } from '../src/modules/bot-quyen/bot-tai-lieu-file.js';
import { LoiChoKhach } from '../src/modules/bot-quyen/bot-cho-khach-hop-dong.js';

const KHO: TaiLieu[] = [
  { tieuDe: 'K10P.pdf', duongDan: 'http://x/k10p.pdf', kichThuoc: 100 },
  { tieuDe: 'K10.pdf', duongDan: 'http://x/k10.pdf', kichThuoc: 100 },
  { tieuDe: 'LLR -P10 -RGB OPLUNG.pdf', duongDan: 'http://x/p10op.pdf', kichThuoc: 100 },
  { tieuDe: 'LLR -P10- RGB -4S.pdf', duongDan: 'http://x/p104s.pdf', kichThuoc: 100 },
];

const thu = mkdtempSync(join(tmpdir(), 'tlf-'));
afterAll(() => rmSync(thu, { recursive: true, force: true }));
function tep(ten: string, noi: Buffer | string): string {
  const p = join(thu, ten);
  writeFileSync(p, noi);
  return p;
}
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2048, 0x20)]);

describe('timFileKemTriThuc — cùng luật kemFileTriThuc', () => {
  it('ca K10P: mã nguyên token ⇒ đúng file, không dính K10', () => {
    expect(timFileKemTriThuc('cho tôi thông số kỹ thuật ovp-k10p', undefined, KHO)?.tieuDe).toBe('K10P.pdf');
  });
  it('câu không phải thông số ⇒ null (cổng laCauHoiThongSo)', () => {
    expect(timFileKemTriThuc('k10p IP mấy', 'K10P', KHO)).toBeNull();
  });
  it('mơ hồ (hai file P10) ⇒ null; tiêu đề đoạn RAG đầu tiên gỡ được mơ hồ', () => {
    expect(timFileKemTriThuc('thông số p10 rgb', undefined, KHO)).toBeNull();
    expect(timFileKemTriThuc('thông số p10 rgb', 'LLR -P10- RGB -4S', KHO)?.tieuDe).toBe('LLR -P10- RGB -4S.pdf');
    // tên hai file chỉ khác một token ⇒ chấm 6 vs 5 < cách biệt ⇒ vẫn mơ hồ (đúng hành vi agent CRM — thà không gửi)
    expect(timFileKemTriThuc('thông số p10 rgb', 'LLR -P10 -RGB OPLUNG', KHO)).toBeNull();
  });
  it('kemFileTriThuc vẫn cho cùng kết quả (refactor không đổi hành vi)', async () => {
    const kq = await kemFileTriThuc({ liet: async () => KHO, taiVe: async (t) => `/tmp/${t.tieuDe}` },
      'thông số p10 rgb', 'LLR -P10- RGB -4S');
    expect(kq?.tieuDe).toBe('LLR -P10- RGB -4S.pdf');
  });
});

describe('docYeuCauFile / tenCoDauHieuNoiBo', () => {
  it('thân hợp lệ', () => {
    expect(docYeuCauFile({ cau_hoi: 'thông số k10p', duong: 'khach' })).toEqual({ cauHoi: 'thông số k10p', tieuDeDoan: '', duong: 'khach' });
  });
  it.each([[null], [[]], [{}], [{ cau_hoi: '', duong: 'khach' }], [{ cau_hoi: 'x', duong: 'ai' }],
    [{ cau_hoi: 'x'.repeat(501), duong: 'khach' }], [{ cau_hoi: 'x', duong: 'khach', tieu_de_doan: 5 }]])('thân sai %j ⇒ 400', (b) => {
    expect(() => docYeuCauFile(b)).toThrow(LoiChoKhach);
  });
  it('tên nội bộ', () => {
    for (const t of ['Bao gia P10 thang 9.pdf', 'Bảng giá đại lý.pdf', 'chiet-khau-q3.pdf', 'Cong no KH.pdf', 'noi bo P10.pdf',
      'P10 price.pdf', 'Hóa đơn 123.pdf', 'Giá P10.pdf']) expect(tenCoDauHieuNoiBo(t), t).toBe(true);
    for (const t of ['LLR -P10 -RGB OPLUNG.pdf', 'K10P.pdf', 'Thông số kỹ thuật module P5 SMD Pro 3840Hz.pdf', 'Giao thức DMX.pdf'])
      expect(tenCoDauHieuNoiBo(t), t).toBe(false);
  });
});

describe('layFileKemTriThuc (đường NV, kho/tải giả — không DB)', () => {
  const lay = (cau: string, taiVe: (t: TaiLieu) => Promise<string>, kho = KHO) =>
    layFileKemTriThuc('org-x', { cau_hoi: cau, duong: 'nhan_vien' }, { liet: async () => kho, taiVe });

  it('khớp ⇒ bytes PDF + tên file gốc', async () => {
    const kq = await lay('thông số k10p', async () => tep('a.pdf', PDF));
    expect(kq.file?.tieuDe).toBe('K10P.pdf');
    expect(kq.file?.data.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('không khớp ⇒ file null (khong_khop); không phải câu thông số ⇒ null', async () => {
    expect(await lay('thông số card r5s', async () => tep('b.pdf', PDF))).toEqual({ file: null, lyDo: 'khong_khop' });
    expect((await lay('k10p bảo hành mấy năm', async () => tep('c.pdf', PDF))).file).toBeNull();
  });
  it('thân không phải PDF (CDN trả HTML) ⇒ null', async () => {
    expect(await lay('thông số k10p', async () => tep('d.pdf', '<html>lỗi</html>'.padEnd(2000))))
      .toEqual({ file: null, lyDo: 'khong_phai_pdf' });
  });
  it('tải lỗi ⇒ null, không ném', async () => {
    expect(await lay('thông số k10p', async () => { throw new Error('CDN 404'); })).toEqual({ file: null, lyDo: 'tai_loi' });
  });
  it('quá trần (theo kích thước kho) ⇒ null', async () => {
    const kho = [{ tieuDe: 'K10P.pdf', duongDan: 'http://x/k', kichThuoc: TRAN_FILE_BYTE + 1 }];
    expect(await lay('thông số k10p', async () => tep('e.pdf', PDF), kho)).toEqual({ file: null, lyDo: 'qua_lon' });
  });
});

describe('dev 03/10 vòng 10 — tên file Zalo + file đúng tài liệu RAG', () => {
  it('file BOT TỰ DỰNG (đuôi -<10 hex>.pdf, kể cả %-mã hoá) bị loại; tên gốc giữ; tenFileGoc giải %-mã hoá', async () => {
    const { laFileBotDung, tenFileGoc } = await import('../src/modules/bot-quyen/bot-tai-lieu-file.js');
    const { chuanTen } = await import('../src/modules/ai/odoo/tools/gui-tai-lieu.js');
    for (const t of ['0-LLR-P10-RGB-4S-d9ead9e909.pdf', 'LLR-P10-RGB-4S-b00b1b8487.pdf', 'Ngu%E1%BB%93n-DF-12V400W-%C4%90%E1%BB%95-Keo-c3fc694508.pdf'])
      expect(laFileBotDung(t), t).toBe(true);
    for (const t of ['LLR P3.076-V2.0 OP LUNG.pdf', 'K10P.pdf', 'Datasheet BX-V7512.pdf']) expect(laFileBotDung(t), t).toBe(false);
    expect(tenFileGoc('Ngu%E1%BB%93n%2012V600W%20NB.pdf')).toBe(chuanTen('Nguồn 12V600W NB'));
  });
  it('kho chỉ có file bot dựng ⇒ không gửi gì (kho_rong)', async () => {
    const kq = await layFileKemTriThuc('org-x', { cau_hoi: 'thông số LLR P10 RGB 4S', duong: 'nhan_vien' },
      { liet: async () => [{ tieuDe: '0-LLR-P10-RGB-4S-d9ead9e909.pdf', duongDan: 'http://x', kichThuoc: 1000 }], taiVe: async () => tep('z.pdf', PDF) });
    expect(kq).toEqual({ file: null, lyDo: 'kho_rong' });
  });
  it('có tiêu đề tài liệu RAG ⇒ CHỈ file của đúng tài liệu đó (ốp lưng không nhận datasheet outdoor); không có ⇒ null', async () => {
    const kho = [{ tieuDe: 'LLR- P3.076 .3840hz outdoor.pdf', duongDan: 'http://x/o', kichThuoc: 1000 }];
    const tai = async () => tep('o.pdf', PDF);
    const op = await layFileKemTriThuc('org-x', { cau_hoi: 'cho anh thông số P3.076 out ốp lưng 3840HZ (tấm)', tieu_de_doan: 'LLR P3.076-V2.0 OP LUNG', duong: 'nhan_vien' },
      { liet: async () => kho, taiVe: tai });
    expect(op.file).toBeNull();
    const out = await layFileKemTriThuc('org-x', { cau_hoi: 'thông số LLR P3.076 3840hz outdoor', tieu_de_doan: 'LLR- P3.076 .3840hz outdoor', duong: 'nhan_vien' },
      { liet: async () => kho, taiVe: tai });
    expect(out.file?.tieuDe).toBe('LLR- P3.076 .3840hz outdoor.pdf');
  });
});

