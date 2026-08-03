// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tool tra_tri_thuc.
//
// Trọng tâm số 1: KHÔNG trả lời câu hỏi về TIỀN. Tài liệu có thể ghi giá cũ —
// đó chính là bug thật đã khiến dự án bỏ RAG (bot báo giảm 50% vì đọc giá từ
// KB cũ). Hàng rào phải nằm trong CODE, không chỉ trong prompt.
import { describe, it, expect, vi } from 'vitest';
import {
  traTriThuc, dinhDangTriThuc, laCauHoiVeTien, doanCoGia, boDau, traTriThucDefinition,
} from '../../../src/modules/ai/odoo/tools/tra-tri-thuc.js';
import { buildCustomerRegistry } from '../../../src/modules/ai/agent/customer-agent.js';
import { buildStaffRegistry } from '../../../src/modules/ai/agent/staff-agent.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';

const fakeOdoo = () =>
  ({ searchRead: vi.fn(async () => []), execute: vi.fn() }) as unknown as OdooClient;

const deps = (hits: Array<{ content: string; score?: number }> = []) => ({
  timDoan: vi.fn(async () => hits),
});

const DOAN = [
  { content: 'L7-Series\nIP65\nWarranty 2Y\nBeam Angle 175°', score: 0.9 },
];

// ═══════════════════════════════════════════════════════════════════════════
describe('HÀNG RÀO TIỀN — chặn ở CODE, không chỉ prompt', () => {
  it.each([
    'led 3 bóng giá bao nhiêu',
    'cái này bao nhiêu tiền',
    'giá bán lẻ thế nào',
    'cho xin giá sỉ',
    'còn hàng không',
    'tồn kho bao nhiêu',
    'khách này công nợ bao nhiêu',
    'doanh thu tháng này',
    'giá vốn là bao nhiêu',
    'chiết khấu mấy phần trăm',
  ])('chặn: "%s"', async (q) => {
    const d = deps(DOAN);
    const kq = await traTriThuc(d, { cau_hoi: q });

    expect(kq.loai).toBe('cau_hoi_ve_tien');
    // KHÔNG tra — tiết kiệm round-trip cho câu vốn phải đi Odoo.
    expect(d.timDoan).not.toHaveBeenCalled();
  });

  it('bắt được cả khi gõ KHÔNG DẤU', async () => {
    const kq = await traTriThuc(deps(DOAN), { cau_hoi: 'gia bao nhieu' });
    expect(kq.loai).toBe('cau_hoi_ve_tien');
  });

  it('câu hỏi KỸ THUẬT thì KHÔNG chặn', async () => {
    for (const q of ['bảo hành mấy năm', 'IP mấy', 'công suất bao nhiêu W', 'lắp thế nào']) {
      expect((await traTriThuc(deps(DOAN), { cau_hoi: q })).loai).toBe('ok');
    }
  });

  it('đầu ra khi bị chặn CHỈ ĐÚNG sang tool Odoo', () => {
    const s = dinhDangTriThuc({ loai: 'cau_hoi_ve_tien', tuKhoa: 'gia bao nhieu' });

    expect(s).toContain('tra_san_pham');
    expect(s).toContain('tra_ton_kho');
    expect(s).toContain('xuat_cong_no');
    expect(s).toContain('KHÔNG tra tài liệu');
  });

  it('HÀNG RÀO THỨ HAI: đoạn tài liệu CÓ GIÁ bị bỏ (bug TT-049)', async () => {
    // Model có thể diễn đạt lại câu hỏi để lách hàng rào thứ nhất: hỏi
    // "@bot giá vốn led 3 bóng" nhưng gọi tool với "thông số led 3 bóng".
    // Chặn ở ĐẦU RA thì không lách được.
    const coGia = [{ content: 'Led 3 bóng\nGiá bán: 5.000đ', score: 1 }];
    const kq = await traTriThuc(deps(coGia), { cau_hoi: 'thông số led 3 bóng' });

    expect(kq.loai).toBe('khong_thay');
  });

  it('bỏ đoạn có giá NHƯNG giữ đoạn sạch', async () => {
    const tron = [
      { content: 'Bảng giá\nUnit Price: 195.000đ', score: 1 },
      { content: 'L7-Series IP65 Warranty 2Y', score: 0.9 },
    ];
    const kq = await traTriThuc(deps(tron), { cau_hoi: 'thông số L7' });

    expect(kq.loai).toBe('ok');
    if (kq.loai === 'ok') {
      expect(kq.doan).toHaveLength(1);
      expect(kq.doan[0].noiDung).toContain('Warranty 2Y');
    }
  });

  it('doanCoGia bắt các dạng giá thường gặp', () => {
    expect(doanCoGia('Giá bán: 5.000đ')).toBe(true);
    expect(doanCoGia('Agent price 120')).toBe(true);
    expect(doanCoGia('Unit Price 195000')).toBe(true);
    expect(doanCoGia('tổng 1.750.000 VND')).toBe(true);
    // Thông số kỹ thuật KHÔNG bị nhầm là giá.
    expect(doanCoGia('IP65 Warranty 2Y 175°')).toBe(false);
    expect(doanCoGia('AC185-265V 6W/Pcs 720-780 lm')).toBe(false);
  });

  it('laCauHoiVeTien trả về từ khoá bắt được', () => {
    expect(laCauHoiVeTien('cho hỏi giá bán')).toBe('gia ban');
    expect(laCauHoiVeTien('bảo hành mấy năm')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('boDau', () => {
  it('bỏ dấu tiếng Việt và đổi đ → d', () => {
    expect(boDau('Đèn LED Bảo Hành')).toBe('den led bao hanh');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('traTriThuc — luồng', () => {
  it('tìm được → trả đoạn', async () => {
    const kq = await traTriThuc(deps(DOAN), { cau_hoi: 'L7 bảo hành' });

    expect(kq.loai).toBe('ok');
    if (kq.loai === 'ok') expect(kq.doan[0].noiDung).toContain('Warranty 2Y');
  });

  it('không tìm thấy → BẢO model đừng suy đoán thông số', async () => {
    const s = dinhDangTriThuc(await traTriThuc(deps([]), { cau_hoi: 'đèn ABC bảo hành' }));

    expect(s).toContain('ĐỪNG suy đoán');
    expect(s).toContain('khách lắp hỏng hàng');
  });

  it('câu hỏi rỗng → không tra', async () => {
    const d = deps(DOAN);
    expect((await traTriThuc(d, { cau_hoi: '   ' })).loai).toBe('khong_thay');
    expect(d.timDoan).not.toHaveBeenCalled();
  });

  it('cắt còn tối đa 3 đoạn (tin Zalo dài là không ai đọc)', async () => {
    const nhieu = Array.from({ length: 10 }, (_, i) => ({ content: `doan ${i}`, score: 1 }));
    const kq = await traTriThuc(deps(nhieu), { cau_hoi: 'thông số' });

    if (kq.loai === 'ok') expect(kq.doan).toHaveLength(3);
  });

  it('đoạn quá dài bị cắt kèm dấu …', async () => {
    const dai = [{ content: 'x'.repeat(2000), score: 1 }];
    const kq = await traTriThuc(deps(dai), { cau_hoi: 'thông số' });

    if (kq.loai === 'ok') {
      expect(kq.doan[0].noiDung.length).toBeLessThan(800);
      expect(kq.doan[0].noiDung.endsWith('…')).toBe(true);
    }
  });

  it('BẢO model đừng bịa thông số không có trong đoạn', async () => {
    const s = dinhDangTriThuc(await traTriThuc(deps(DOAN), { cau_hoi: 'IP mấy' }));

    expect(s).toContain('ĐỪNG bịa');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Đăng ký registry', () => {
  const timDoan = async () => [];

  it('CẢ HAI vai đều có — khách cũng được hỏi bảo hành', () => {
    const kh = buildCustomerRegistry({
      odoo: fakeOdoo(), ghiNhanChuyenSale: async () => {}, timDoanTriThuc: timDoan,
    });
    const nv = buildStaffRegistry({
      odoo: fakeOdoo(), conversationId: 'c', seq: 0,
      ghiNhanChuyenSale: async () => {}, timDoanTriThuc: timDoan,
    });

    expect(kh.has('tra_tri_thuc')).toBe(true);
    expect(nv.has('tra_tri_thuc')).toBe(true);
  });

  it('KHÔNG truyền timDoanTriThuc → tool không đăng ký (bot không hứa suông)', () => {
    const kh = buildCustomerRegistry({ odoo: fakeOdoo(), ghiNhanChuyenSale: async () => {} });
    const nv = buildStaffRegistry({
      odoo: fakeOdoo(), conversationId: 'c', seq: 0, ghiNhanChuyenSale: async () => {},
    });

    expect(kh.has('tra_tri_thuc')).toBe(false);
    expect(nv.has('tra_tri_thuc')).toBe(false);
  });
});

describe('Định nghĩa tool', () => {
  it('mô tả có điều kiện kích hoạt', () => {
    expect(traTriThucDefinition.description).toContain('GỌI KHI');
  });

  it('mô tả CẤM RÕ dùng cho giá/tồn/công nợ', () => {
    const d = traTriThucDefinition.description;
    expect(d).toContain('TUYỆT ĐỐI KHÔNG');
    expect(d).toContain('GIÁ');
    expect(d).toContain('tra_san_pham');
  });

  it('chỉ ĐỌC — không mutates', () => {
    expect(traTriThucDefinition.mutates).toBeUndefined();
  });
});
