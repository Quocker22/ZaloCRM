// SPDX-License-Identifier: AGPL-3.0-or-later
// CỔNG BẢO MẬT cho tool `gui_tai_lieu` — ai được gửi tài liệu cho ai.
//
// QUYẾT ĐỊNH (11/08/2026): MỞ cho CẢ HAI luồng, cùng lý lẽ đã áp cho
// `tra_tri_thuc`. Datasheet là tài liệu kỹ thuật CÔNG KHAI của nhà sản xuất —
// khách mua LED cần xem thông số trước khi chốt. Đã soát nội dung thật của
// cả 8 file trên prod: KHÔNG file nào chứa "agent price / vip price / project
// price / giá vốn / giá nhập / cost price / wholesale price" — 0/8 dính.
//
// Nhưng "hôm nay sạch" KHÔNG phải là hàng rào. Nhân viên gửi file MỚI vào nhóm
// bất cứ lúc nào, và file mới có thể là bảng giá đại lý. Nên hàng rào nằm
// trong CODE (`locGiaNoiBo`), khoá bằng test dưới đây — không phải trong prompt
// và cũng không phải trong niềm tin rằng kho file mãi sạch.
import { describe, it, expect, vi } from 'vitest';
import { buildCustomerRegistry } from '../../../src/modules/ai/agent/customer-agent.js';
import { buildStaffRegistry } from '../../../src/modules/ai/agent/staff-agent.js';
import { locGiaNoiBo, type TaiLieu } from '../../../src/modules/ai/odoo/tools/gui-tai-lieu.js';
import { tinhToolChoPhep } from '../../../src/modules/ai/agent/guideline-prompt.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';

const fakeOdoo = () =>
  ({ searchRead: vi.fn(async () => []), execute: vi.fn() }) as unknown as OdooClient;

const khoTaiLieu = async (): Promise<TaiLieu[]> => [
  { tieuDe: 'LLR - P4 3840-7680HZ.pdf', duongDan: '/media/b5eb.pdf', kichThuoc: 2317395 },
];

// ═══════════════════════════════════════════════════════════════════════════
describe('ĐĂNG KÝ tool — cả hai luồng', () => {
  it('luồng NHÂN VIÊN có gui_tai_lieu khi được cấp kho tài liệu', () => {
    const r = buildStaffRegistry({
      odoo: fakeOdoo(), conversationId: 'c1', seq: 1,
      ghiNhanChuyenSale: vi.fn(),
      lietTaiLieu: khoTaiLieu,
    });
    expect(r.has('gui_tai_lieu')).toBe(true);
  });

  it('luồng KHÁCH CŨNG có — datasheet là tài liệu kỹ thuật công khai', () => {
    const r = buildCustomerRegistry({
      odoo: fakeOdoo(), ghiNhanChuyenSale: vi.fn(),
      lietTaiLieu: khoTaiLieu,
    });
    expect(r.has('gui_tai_lieu')).toBe(true);
  });

  it('KHÔNG cấp kho → tool KHÔNG đăng ký (khỏi hứa rồi không gửi được)', () => {
    const nv = buildStaffRegistry({
      odoo: fakeOdoo(), conversationId: 'c1', seq: 1, ghiNhanChuyenSale: vi.fn(),
    });
    const kh = buildCustomerRegistry({ odoo: fakeOdoo(), ghiNhanChuyenSale: vi.fn() });
    expect(nv.has('gui_tai_lieu')).toBe(false);
    expect(kh.has('gui_tai_lieu')).toBe(false);
  });

  it('cơ chế gate CÓ tác dụng lên tool này (set không chứa → không đăng ký)', () => {
    const r = buildCustomerRegistry({
      odoo: fakeOdoo(), ghiNhanChuyenSale: vi.fn(),
      lietTaiLieu: khoTaiLieu,
      toolChoPhep: new Set(['tra_san_pham', 'chuyen_sale']),
    });
    expect(r.has('gui_tai_lieu')).toBe(false);
  });

  it('nhưng THỰC TẾ guideline engine LUÔN cho qua — gui_tai_lieu nằm trong TOOL_NEN', () => {
    // Khách xin catalog ở BẤT KỲ lượt nào (mới chào, đang hỏi giá, sau khi
    // chốt). Bắt nó phụ thuộc một guideline khớp đúng là tái tạo bug 03:17
    // 11/08 mỗi lần matcher trượt. Cùng lý lẽ đã đưa `tra_tri_thuc` vào đây.
    const choPhep = tinhToolChoPhep(
      { matchedIds: [], stage: '', fallback: false } as never,
      [],
    );
    expect(choPhep.has('gui_tai_lieu')).toBe(true);

    const r = buildCustomerRegistry({
      odoo: fakeOdoo(), ghiNhanChuyenSale: vi.fn(),
      lietTaiLieu: khoTaiLieu,
      toolChoPhep: choPhep,
    });
    expect(r.has('gui_tai_lieu')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('HÀNG RÀO GIÁ NỘI BỘ — khoá ở CODE, không dựa vào kho file sạch', () => {
  it.each([
    'Bang gia dai ly 2026.pdf',
    'agent price list.pdf',
    'VIP price Q3.pdf',
    'giá vốn nhập khẩu.pdf',
    'project price LED.pdf',
    'cost price sheet.pdf',
    'BANG GIA SI thang 8.pdf',
    'wholesale price 2026.pdf',
  ])('LOẠI file "%s" khỏi kho gửi được', (ten) => {
    const kho: TaiLieu[] = [{ tieuDe: ten, duongDan: '/media/x.pdf', kichThuoc: 1000 }];
    expect(locGiaNoiBo(kho)).toHaveLength(0);
  });

  it('GIỮ 8 datasheet thật — chúng sạch (đã soát nội dung prod 11/08)', () => {
    const kho: TaiLieu[] = [
      'LLR - P4 3840-7680HZ.pdf', 'LLR - P5 Full Outdoor _3840HZ.pdf',
      'LLR -P10 -RGB OPLUNG.pdf', 'LLR -P10- RGB -4S.pdf',
      'LLR P3.076-V2.0 OP LUNG.pdf', 'LLR- P3.076 .3840hz outdoor.pdf',
      'LLR- P3.076 outdoor dẻo-3840hz.pdf', 'P10 SMD ĐỎ LLR ốp lưng.pdf',
    ].map((tieuDe) => ({ tieuDe, duongDan: '/media/x.pdf', kichThuoc: 1000 }));
    expect(locGiaNoiBo(kho)).toHaveLength(8);
  });

  it('lọc chạy TRƯỚC khi tool nhìn thấy — kho bẩn thì tool báo không thấy', async () => {
    const bang: TaiLieu[] = [
      { tieuDe: 'Bang gia dai ly 2026.pdf', duongDan: '/media/gia.pdf', kichThuoc: 5000 },
    ];
    const { guiTaiLieu } = await import('../../../src/modules/ai/odoo/tools/gui-tai-lieu.js');
    const taiVe = vi.fn(async () => '/tmp/x');
    const kq = await guiTaiLieu(
      { liet: async () => locGiaNoiBo(bang), taiVe },
      { yeu_cau: 'gửi bảng giá đại lý' },
    );
    expect(kq.loai).toBe('khong_thay');
    expect(taiVe).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CHỈ file TÀI LIỆU — không phải mọi thứ nhân viên từng gửi', () => {
  it('loại file báo cáo Excel nội bộ của chính bot', () => {
    const kho: TaiLieu[] = [
      { tieuDe: '1786439479260-top-san-pham-ban-chay-2026-08-11.xlsx', duongDan: '/m/a', kichThuoc: 7516 },
      { tieuDe: '1786158560521-don-nhap-cho-xac-nhan-2026-08-08.xlsx', duongDan: '/m/b', kichThuoc: 13521 },
    ];
    expect(locGiaNoiBo(kho)).toHaveLength(0);
  });
});

describe('TRÍCH NỘI DUNG kèm tin "đã gửi file" (anh Quốc 17:41 13/08: đừng cụt ngủn)', () => {
  const chay = async (trichTaiLieu?: (t: string) => Promise<string | null>) => {
    const r = buildStaffRegistry({
      odoo: fakeOdoo(), conversationId: 'c1', seq: 1, ghiNhanChuyenSale: vi.fn(),
      lietTaiLieu: khoTaiLieu,
      taiTaiLieu: async () => '/tmp/f.pdf',
      ...(trichTaiLieu ? { trichTaiLieu } : {}),
    });
    const kq = await r.executor()({
      id: 't1', name: 'gui_tai_lieu', input: { yeu_cau: 'LLR - P4 3840-7680HZ.pdf' },
    });
    return String(kq.content);
  };

  it('có trích → output tool kèm khối nội dung + lệnh tóm 3-4 ý, cấm bịa số', async () => {
    const ra = await chay(async () => 'P4 outdoor, độ sáng 5500 nits, IP65, quét 3840Hz');
    expect(ra).toContain('ĐÃ GỬI file');
    expect(ra).toContain('5500 nits');
    expect(ra).toMatch(/ĐỪNG bịa/);
  });

  it('trích lỗi/không có → tin báo gửi file vẫn nguyên vẹn như cũ', async () => {
    const ra = await chay(async () => { throw new Error('db chết'); });
    expect(ra).toContain('ĐÃ GỬI file');
    expect(ra).not.toContain('TRÍCH NỘI DUNG');
    expect(await chay()).toContain('ĐÃ GỬI file');
  });
});
