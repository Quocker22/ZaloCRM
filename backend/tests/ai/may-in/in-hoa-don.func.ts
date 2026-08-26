// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool in_hoa_don — nhân viên nhắn "in hoá đơn S13811" → xếp hàng in ra máy
// in HP ở shop. KHÔNG ghi gì vào Odoo (chỉ đọc), KHÔNG in thẳng trong lượt
// chat (máy in chậm/tắt không được giữ chân nhân viên) — chỉ tạo job, cron in.
import { describe, it, expect, vi } from 'vitest';
import {
  inHoaDon,
  inHoaDonDefinition,
  dinhDangInHoaDon,
  type KetQuaInHoaDon,
} from '../../../src/modules/ai/odoo/tools/in-hoa-don.js';

const DON = {
  id: 26728, name: 'S13811', state: 'sale', amount_total: 780000,
  partner_id: [1894, 'A Tuấn Tospino'], invoice_ids: [7001],
};
const HOA_DON = { id: 7001, name: 'INV/2026/00042', state: 'posted', amount_total: 780000, move_type: 'out_invoice' };

function fakeOdoo(opts: { don?: typeof DON | null; hoaDon?: typeof HOA_DON | null } = {}) {
  const don = opts.don === undefined ? DON : opts.don;
  const hoaDon = opts.hoaDon === undefined ? HOA_DON : opts.hoaDon;
  const searchRead = vi.fn(async (model: string, domain: unknown[][]) => {
    if (model === 'sale.order') return don ? [{ ...don }] : [];
    if (model === 'account.move') {
      // tôn trọng điều kiện name khi tool tra theo số hoá đơn
      const dkTen = domain.find((d) => Array.isArray(d) && d[0] === 'name');
      if (dkTen && hoaDon && dkTen[2] !== hoaDon.name) return [];
      return hoaDon ? [{ ...hoaDon }] : [];
    }
    return [];
  });
  return { searchRead };
}

describe('inHoaDon', () => {
  it('theo mã đơn: tìm hoá đơn posted của đơn → xếp hàng in, trả số hoá đơn', async () => {
    const themJob = vi.fn(async () => {});
    const kq = await inHoaDon(
      { odoo: fakeOdoo(), conversationId: 'c1', themJob },
      { ma_don: 'S13811' },
    );
    expect(kq.trangThai).toBe('da_xep_hang');
    if (kq.trangThai !== 'da_xep_hang') return;
    expect(kq.soHoaDon).toBe('INV/2026/00042');
    expect(themJob).toHaveBeenCalledWith({
      conversationId: 'c1', hoaDonId: 7001,
      soHoaDon: 'INV/2026/00042',
      // 26/08 anh Quyết: mặc định in KHÔNG giá → job mang đuôi #khong_gia.
      report: 'incokit_pos.report_invoice_document_kiotviet#khong_gia',
    });
  });

  it('theo số hoá đơn trực tiếp (INV/…): không cần qua đơn bán', async () => {
    const themJob = vi.fn(async () => {});
    const kq = await inHoaDon(
      { odoo: fakeOdoo({ don: null }), themJob },
      { so_hoa_don: 'INV/2026/00042' },
    );
    expect(kq.trangThai).toBe('da_xep_hang');
    expect(themJob).toHaveBeenCalled();
  });

  it('đơn CHƯA có hoá đơn → chỉ đường sang xuat_hoa_don, KHÔNG xếp hàng', async () => {
    const themJob = vi.fn(async () => {});
    const kq = await inHoaDon(
      { odoo: fakeOdoo({ don: { ...DON, invoice_ids: [] }, hoaDon: null }), themJob },
      { ma_don: 'S13811' },
    );
    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('xuat_hoa_don');
    expect(themJob).not.toHaveBeenCalled();
  });

  it('hoá đơn còn NHÁP → từ chối in (chưa có số phát hành, in ra là rác)', async () => {
    const themJob = vi.fn(async () => {});
    const kq = await inHoaDon(
      { odoo: fakeOdoo({ hoaDon: { ...HOA_DON, state: 'draft', name: '/' } }), themJob },
      { ma_don: 'S13811' },
    );
    expect(kq.trangThai).toBe('loi');
    expect(themJob).not.toHaveBeenCalled();
  });

  it('không tìm thấy gì → lỗi nêu rõ cách gọi', async () => {
    const kq = await inHoaDon(
      { odoo: fakeOdoo({ don: null, hoaDon: null }), themJob: vi.fn() },
      { ma_don: 'S99999' },
    );
    expect(kq.trangThai).toBe('loi');
  });

  it('xếp hàng lỗi (DB hỏng) → lỗi trả về rõ ràng, không nói dối "đã xếp"', async () => {
    const themJob = vi.fn(async () => { throw new Error('DB down'); });
    const kq = await inHoaDon({ odoo: fakeOdoo(), themJob }, { ma_don: 'S13811' });
    expect(kq.trangThai).toBe('loi');
  });
});

describe('inHoaDonDefinition', () => {
  it('mô tả nói rõ KHI NÀO gọi và khác xuat_hoa_don thế nào', () => {
    expect(inHoaDonDefinition.name).toBe('in_hoa_don');
    expect(inHoaDonDefinition.description).toMatch(/in/i);
    expect(inHoaDonDefinition.description).toContain('xuat_hoa_don');
    expect(inHoaDonDefinition.inputSchema.required ?? []).toHaveLength(0);
  });
});

describe('dinhDangInHoaDon', () => {
  it('đã xếp hàng → nói rõ "xếp hàng in", KHÔNG nói "đã in" (chưa in xong)', () => {
    const kq: KetQuaInHoaDon = {
      trangThai: 'da_xep_hang', soHoaDon: 'INV/2026/00042', maDon: 'S13811',
      tenKhach: 'A Tuấn', tongTien: 780000,
    };
    const text = dinhDangInHoaDon(kq);
    expect(text).toContain('INV/2026/00042');
    expect(text.toLowerCase()).toContain('xếp hàng');
    expect(text.toLowerCase()).not.toContain('đã in xong');
  });

  it('lỗi → nêu lý do', () => {
    expect(dinhDangInHoaDon({ trangThai: 'loi', lyDo: 'x' })).toContain('x');
  });
});
