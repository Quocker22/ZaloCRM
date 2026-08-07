// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tool gui_hoa_don + module render ảnh.
//
// Trọng tâm số 1: hóa đơn IN DƯ NỢ của khách (đo thật: 93.951.424đ trên đơn
// S13788) nên TUYỆT ĐỐI không được lọt sang luồng khách.
import { describe, it, expect, vi } from 'vitest';
import {
  guiHoaDon, dinhDangGuiHoaDon, guiHoaDonDefinition,
} from '../../../src/modules/ai/odoo/tools/gui-hoa-don.js';
import { linkXuLyDon } from '../../../src/modules/ai/odoo/hoa-don-anh.js';
import { buildStaffRegistry } from '../../../src/modules/ai/agent/staff-agent.js';
import { buildCustomerRegistry } from '../../../src/modules/ai/agent/customer-agent.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';
import type { HoaDonAnhClient } from '../../../src/modules/ai/odoo/hoa-don-anh.js';

const DON = {
  id: 26691, name: 'S13788', amount_total: 19500000,
  partner_id: [1879, 'LED - Anh Đoàn Bình - Long Biên'], state: 'draft',
};

const fakeOdoo = (rows: unknown[] = [DON]) =>
  ({ searchRead: vi.fn(async () => rows) }) as unknown as
    Pick<OdooClient, 'searchRead'> & { searchRead: ReturnType<typeof vi.fn> };

const fakeAnh = (over: Partial<HoaDonAnhClient> = {}) =>
  ({
    render: vi.fn(async () => ({
      duLieu: Buffer.from('PNG-gia'), tenFile: 'hoa-don-S13788.png',
    })),
    ...over,
  }) as unknown as HoaDonAnhClient;

const deps = (odoo = fakeOdoo(), anhClient = fakeAnh()) => ({
  odoo, anhClient, odooUrl: 'http://localhost:8069',
});

// ═══════════════════════════════════════════════════════════════════════════
describe('RANH GIỚI — hóa đơn KHÔNG được sang luồng khách', () => {
  // Report report_saleorder_kiotviet in DƯ NỢ. Cùng lý do khiến registry khách
  // cố ý không có tra_khach_hang.

  it('registry KHÁCH không có gui_hoa_don', () => {
    const r = buildCustomerRegistry({
      odoo: fakeOdoo() as unknown as OdooClient,
      ghiNhanChuyenSale: async () => {},
    });

    expect(r.definitions().map((d) => d.name)).not.toContain('gui_hoa_don');
  });

  it('registry NHÂN VIÊN CÓ gui_hoa_don khi đủ hạ tầng', () => {
    const r = buildStaffRegistry({
      odoo: fakeOdoo() as unknown as OdooClient,
      conversationId: 'c', seq: 0, ghiNhanChuyenSale: async () => {},
      anhClient: fakeAnh(), odooUrl: 'http://x',
    });

    expect(r.has('gui_hoa_don')).toBe(true);
  });

  it('THIẾU anhClient → KHÔNG đăng ký tool (bot không hứa suông)', () => {
    // Đăng ký mà không render được thì bot nói "đã gửi" rồi không gửi gì.
    const r = buildStaffRegistry({
      odoo: fakeOdoo() as unknown as OdooClient,
      conversationId: 'c', seq: 0, ghiNhanChuyenSale: async () => {},
    });

    expect(r.has('gui_hoa_don')).toBe(false);
    expect(r.definitions()).toHaveLength(15); // 07/08: +sua_don
  });

  it('có anhClient nhưng THIẾU odooUrl → cũng không đăng ký (link sẽ hỏng)', () => {
    const r = buildStaffRegistry({
      odoo: fakeOdoo() as unknown as OdooClient,
      conversationId: 'c', seq: 0, ghiNhanChuyenSale: async () => {},
      anhClient: fakeAnh(),
    });

    expect(r.has('gui_hoa_don')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('guiHoaDon — tìm đơn', () => {
  it('tìm theo don_id', async () => {
    const odoo = fakeOdoo();
    const kq = await guiHoaDon(deps(odoo), { don_id: 26691 });

    expect(kq?.maDon).toBe('S13788');
    expect(JSON.stringify(odoo.searchRead.mock.calls[0][1])).toContain('26691');
  });

  it('tìm theo ma_don khi không có id', async () => {
    const odoo = fakeOdoo();
    await guiHoaDon(deps(odoo), { ma_don: 'S13788' });

    expect(JSON.stringify(odoo.searchRead.mock.calls[0][1])).toContain('S13788');
  });

  it('ưu tiên don_id — không tra thêm bằng mã (đỡ 1 round-trip)', async () => {
    const odoo = fakeOdoo();
    await guiHoaDon(deps(odoo), { don_id: 26691, ma_don: 'S13788' });

    expect(odoo.searchRead).toHaveBeenCalledTimes(1);
  });

  it('không tìm thấy → null, KHÔNG ném lỗi', async () => {
    expect(await guiHoaDon(deps(fakeOdoo([])), { don_id: 999 })).toBeNull();
  });

  it('đọc đúng tổng tiền và tên khách', async () => {
    const kq = await guiHoaDon(deps(), { don_id: 26691 });

    expect(kq?.tongTien).toBe(19500000);
    expect(kq?.tenKhach).toContain('Anh Đoàn Bình');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('guiHoaDon — ảnh lỗi KHÔNG làm hỏng cả tool', () => {
  it('render thất bại → vẫn trả link, ghi lý do', async () => {
    // Thà gửi link không ảnh còn hơn không gửi gì.
    const anh = fakeAnh({
      render: vi.fn(async () => { throw new Error('wkhtmltopdf treo'); }),
    } as Partial<HoaDonAnhClient>);

    const kq = await guiHoaDon(deps(fakeOdoo(), anh), { don_id: 26691 });

    expect(kq?.anh).toBeNull();
    expect(kq?.loiAnh).toContain('wkhtmltopdf');
    expect(kq?.link).toContain('26691');
  });

  it('đầu ra vẫn hữu ích khi thiếu ảnh', async () => {
    const anh = fakeAnh({
      render: vi.fn(async () => { throw new Error('timeout'); }),
    } as Partial<HoaDonAnhClient>);

    const s = dinhDangGuiHoaDon(await guiHoaDon(deps(fakeOdoo(), anh), { don_id: 26691 }));

    expect(s).toContain('Không tạo được ảnh');
    expect(s).toContain('http://localhost:8069/web#id=26691');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('linkXuLyDon', () => {
  it('dựng link app Odoo dạng /web# (link thật anh đang dùng)', () => {
    const l = linkXuLyDon('http://localhost:8069', 26691);
    expect(l).toContain('http://localhost:8069/web#id=26691');
    expect(l).toContain('model=sale.order');
  });

  it('bỏ dấu / thừa ở cuối', () => {
    expect(linkXuLyDon('http://x:8069///', 5)).toContain('http://x:8069/web#id=5');
  });

  it('KHÔNG dùng link portal /my/orders (ai có link cũng xem được)', () => {
    expect(linkXuLyDon('http://x', 5)).not.toContain('/my/orders');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('dinhDangGuiHoaDon', () => {
  it('CẤM model mô tả nội dung ảnh (nó không nhìn thấy → sẽ bịa)', async () => {
    const s = dinhDangGuiHoaDon(await guiHoaDon(deps(), { don_id: 26691 }));

    expect(s).toContain('ĐỪNG mô tả lại nội dung');
    expect(s).toContain('ĐÃ được đính kèm');
  });

  it('nêu mã đơn, khách, tổng tiền và link', async () => {
    const s = dinhDangGuiHoaDon(await guiHoaDon(deps(), { don_id: 26691 }));

    expect(s).toContain('S13788');
    expect(s).toContain('Anh Đoàn Bình');
    expect(s).toContain('19.500.000đ');
    expect(s).toContain('/web#id=26691');
  });

  it('VND không thập phân — dùng dấu chấm kiểu VN', async () => {
    const s = dinhDangGuiHoaDon(await guiHoaDon(deps(), { don_id: 26691 }));

    expect(s).toContain('19.500.000đ');
    expect(s).not.toContain('19,500,000');       // không dùng dấu phẩy kiểu Mỹ
    // KHÔNG assert vắng ".00" — "19.500.000" vốn chứa chuỗi con đó. Phải khớp
    // phần thập phân THẬT: đúng 2 chữ số ngay trước "đ".
    expect(s).not.toMatch(/\d[.,]\d{2}đ/);
  });

  it('không tìm thấy đơn → chỉ dẫn rõ, KHÔNG chuỗi rỗng', () => {
    const s = dinhDangGuiHoaDon(null);

    expect(s).toContain('Không tìm thấy đơn');
    expect(s).toContain('tao_don_nhap');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Định nghĩa tool', () => {
  it('mô tả nói KHI NÀO gọi', () => {
    expect(guiHoaDonDefinition.description).toContain('GỌI KHI');
  });

  it('BẢO model gọi luôn sau khi tạo đơn', () => {
    expect(guiHoaDonDefinition.description).toContain('SAU KHI TẠO ĐƠN');
  });

  it('chỉ ĐỌC — không đánh dấu mutates', () => {
    expect(guiHoaDonDefinition.mutates).toBeUndefined();
  });

  it('cả hai tham số đều tuỳ chọn (bot có id hoặc mã đều gọi được)', () => {
    expect(guiHoaDonDefinition.inputSchema.required).toEqual([]);
  });
});
