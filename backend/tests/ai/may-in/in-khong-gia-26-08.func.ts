// SPDX-License-Identifier: AGPL-3.0-or-later
// Anh Quyết 10:06–10:08 26/08: "@bot in đơn QC bách phát không in giá" → bot
// "chưa xử lý kịp" (model đi mò kham_pha_odoo 5 lần tìm khái niệm "in giá"),
// rồi: "Em lập trình hộ anh in đơn — đều là in đơn không giá". Anh Quốc: mặc
// định in không giá, NV nói "in có giá" mới in giá. Odoo có sẵn cờ
// incokit_hide_price — truyền qua ?context= của route PDF (đo thật INV/2026/028308).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { inHoaDon, inHoaDonDefinition, dinhDangInHoaDon } from '../../../src/modules/ai/odoo/tools/in-hoa-don.js';
import { tachReport, HAU_TO_KHONG_GIA } from '../../../src/modules/ai/may-in/hang-doi-in.js';
import { HoaDonAnhClient } from '../../../src/modules/ai/odoo/hoa-don-anh.js';

const HOA_DON = { id: 7001, name: 'INV/2026/028308', state: 'posted', amount_total: 1_140_000, move_type: 'out_invoice', partner_id: [1233, 'QC Bách Phát - Xã Đàn'] };
const odoo = { searchRead: vi.fn(async (model: string) => (model === 'account.move' ? [{ ...HOA_DON }] : [])) };

describe('in_hoa_don — mặc định KHÔNG giá, "in có giá" mới có giá', () => {
  it('không nói gì về giá → job đuôi #khong_gia, kết quả coGia=false, câu báo nói rõ bản không giá', async () => {
    const themJob = vi.fn(async () => {});
    const kq = await inHoaDon({ odoo: odoo as never, themJob }, { so_hoa_don: 'INV/2026/028308' });
    expect(kq.trangThai).toBe('da_xep_hang');
    expect(themJob.mock.calls[0][0]).toMatchObject({ report: `incokit_pos.report_invoice_document_kiotviet${HAU_TO_KHONG_GIA}` });
    expect(dinhDangInHoaDon(kq)).toContain('KHÔNG GIÁ');
  });
  it('co_gia=true → report gốc, câu báo nói bản có giá', async () => {
    const themJob = vi.fn(async () => {});
    const kq = await inHoaDon({ odoo: odoo as never, themJob }, { so_hoa_don: 'INV/2026/028308', co_gia: true });
    expect(themJob.mock.calls[0][0]).toMatchObject({ report: 'incokit_pos.report_invoice_document_kiotviet' });
    expect(dinhDangInHoaDon(kq)).toContain('CÓ GIÁ');
  });
  it('mô tả tool dặn mặc định không giá và cấm đi mò kham_pha_odoo', () => {
    expect(inHoaDonDefinition.description).toMatch(/MẶC ĐỊNH in KHÔNG GIÁ/);
    expect(inHoaDonDefinition.description).toMatch(/kham_pha_odoo/);
    expect(inHoaDonDefinition.inputSchema.properties).toHaveProperty('co_gia');
  });
});

describe('tachReport — cron tách đuôi trước khi gọi Odoo', () => {
  it('có đuôi → report gốc + khongGia=true; không đuôi → nguyên + false', () => {
    expect(tachReport('a.b#khong_gia')).toEqual({ report: 'a.b', khongGia: true });
    expect(tachReport('a.b')).toEqual({ report: 'a.b', khongGia: false });
  });
});

describe('HoaDonAnhClient.taiPdf — cờ khongGia → ?context=incokit_hide_price', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('URL có context hide_price khi khongGia, không có khi thường', async () => {
    const urls: string[] = [];
    const fetchGia = vi.fn(async (u: string, init?: RequestInit) => {
      if (u.includes('/web/session/authenticate')) {
        return { json: async () => ({ result: { uid: 18 } }), headers: { getSetCookie: () => ['session_id=abc; Path=/'] } } as never;
      }
      urls.push(u);
      void init;
      return {
        ok: true, status: 200, headers: { get: () => 'application/pdf' },
        arrayBuffer: async () => new TextEncoder().encode('%PDF-1.4 fake').buffer,
      } as never;
    });
    vi.stubGlobal('fetch', fetchGia);
    const c = new HoaDonAnhClient({ url: 'http://odoo', db: 'd', username: 'u', password: 'p' });
    await c.taiPdf(209029, 'incokit_pos.report_invoice_document_kiotviet', { khongGia: true });
    await c.taiPdf(209029, 'incokit_pos.report_invoice_document_kiotviet');
    expect(urls[0]).toBe('http://odoo/report/pdf/incokit_pos.report_invoice_document_kiotviet/209029?context=%7B%22incokit_hide_price%22%3Atrue%7D');
    expect(urls[1]).toBe('http://odoo/report/pdf/incokit_pos.report_invoice_document_kiotviet/209029');
  });
});
