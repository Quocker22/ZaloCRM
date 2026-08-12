// SPDX-License-Identifier: AGPL-3.0-or-later
// DẤU VẾT KHI BOT SỬA CỘT NHẠY CẢM (giá vốn / margin) — KHÔNG PHẢI PHANH.
//
// BỐI CẢNH: `lam_odoo` ghi đè được `standard_price` trong khi `doc_odoo` còn
// không được ĐỌC cột đó (`locCotCam` chặn). Đề xuất ban đầu là bắt xác nhận
// như lệnh xoá.
//
// ANH QUỐC (chủ hệ thống) TỪ CHỐI, nguyên văn: "đừng siết chặt quá khó dùng".
//
// VÌ SAO QUYẾT ĐỊNH ĐÓ ĐÚNG: `lam_odoo` chỉ có trong registry NHÂN VIÊN (khách
// không chạm tới được — xem ranh-gioi.test.ts), mà nhân viên vốn đã đăng nhập
// thẳng Odoo sửa giá vốn bằng tay được. Chặn ở bot không chặn được gì thật, chỉ
// làm phiền người đang làm việc. Nên đổi PHANH → DẤU VẾT:
//   1. `logger.warn` có nhãn cố định để sau này grep ra ai/lúc nào sửa;
//   2. câu trả lời cho nhân viên NÊU RÕ đã đụng cột nào, giá trị bao nhiêu.
// Minh bạch, không chặn. Lệnh vẫn chạy đúng như trước.
//
// Bộ test này khoá đúng hai điều đó, VÀ khoá luôn điều ngược lại: lệnh thường
// (sửa list_price, xác nhận đơn) KHÔNG được dính thêm một chữ thừa nào.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lamOdoo, dinhDangLam } from '../../../../src/modules/ai/odoo/tong-quat/lam.js';
import { logger } from '../../../../src/shared/utils/logger.js';

/** Odoo giả: `searchRead` trả về id + giá trị cột cũ để kiểm phần "cũ → mới". */
function fake(soKhop = 1, cotCu: Record<string, unknown> = {}) {
  const searchRead = vi.fn(async () =>
    Array.from({ length: soKhop }, (_, i) => ({ id: i + 1, ...cotCu })));
  const execute = vi.fn(async (_m: string, method: string) =>
    (method === 'search_count' ? soKhop : true));
  return { searchRead, execute };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

/** Gộp mọi tham số của mọi lần warn thành một chuỗi — kiểm nội dung log. */
const logDaGhi = (): string =>
  warn.mock.calls.map((c) => c.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')).join('\n');

// ═══════════════════════════════════════════════════════════════════════════
describe('LỆNH VẪN CHẠY — dấu vết không được biến thành phanh', () => {
  it('sửa standard_price vẫn ghi thẳng vào Odoo, KHÔNG xin xác nhận', async () => {
    const odoo = fake(1, { standard_price: 70000 });

    const kq = await lamOdoo({ odoo } as never, {
      bang: 'product.product', viec: 'sua', loc: [['id', '=', 5]],
      du_lieu: { standard_price: 85000 },
    });

    expect(kq.trangThai).toBe('da_lam');
    const write = odoo.execute.mock.calls.find((c) => c[1] === 'write');
    expect((write![2] as unknown[])[1]).toMatchObject({ standard_price: 85000 });
  });

  it('tạo bản ghi có cột nhạy cảm vẫn create ngay', async () => {
    const odoo = fake(0);

    const kq = await lamOdoo({ odoo } as never, {
      bang: 'product.product', viec: 'tao',
      du_lieu: { name: 'SP mới', standard_price: 12000 },
    });

    expect(kq.trangThai).toBe('da_lam');
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'create')).toBe(true);
  });

  it('không thêm một lượt gọi Odoo nào cho lệnh THƯỜNG (không làm chậm)', async () => {
    const odoo = fake(1);

    await lamOdoo({ odoo } as never, {
      bang: 'product.template', viec: 'sua', loc: [['id', '=', 5]],
      du_lieu: { default_code: 'X1' },
    });

    // Đúng như trước khi có dấu vết: search_count + write, cộng 1 searchRead lấy id.
    expect(odoo.execute.mock.calls.map((c) => c[1])).toEqual(['search_count', 'write']);
    expect(odoo.searchRead).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('DẤU VẾT 1 — log grep được', () => {
  it('sửa giá vốn ghi logger.warn nêu bảng, cột, cũ → mới, hội thoại', async () => {
    const odoo = fake(1, { standard_price: 70000 });

    await lamOdoo({ odoo, conversationId: 'hoi-thoai-42' } as never, {
      bang: 'product.product', viec: 'sua', loc: [['id', '=', 5]],
      du_lieu: { standard_price: 85000 },
    });

    const s = logDaGhi();
    expect(warn).toHaveBeenCalled();
    // Nhãn cố định để `grep 'COT_NHAY_CAM'` ra ngay — đừng đổi chữ này.
    expect(s).toContain('COT_NHAY_CAM');
    expect(s).toContain('product.product');
    expect(s).toContain('standard_price');
    expect(s).toContain('70000');
    expect(s).toContain('85000');
    expect(s).toContain('hoi-thoai-42');
  });

  it('viec=tao cũng ghi log (giá vốn đặt lúc tạo cũng là giá vốn)', async () => {
    const odoo = fake(0);

    await lamOdoo({ odoo, conversationId: 'hoi-thoai-7' } as never, {
      bang: 'product.product', viec: 'tao',
      du_lieu: { name: 'SP mới', standard_price: 12000 },
    });

    const s = logDaGhi();
    expect(s).toContain('COT_NHAY_CAM');
    expect(s).toContain('standard_price');
    expect(s).toContain('12000');
  });

  it('mọi cột laCotCam() nhận diện đều vào log, không chỉ danh sách cứng', async () => {
    const odoo = fake(1, { total_cost: 1, margin_percent: 2 });

    await lamOdoo({ odoo } as never, {
      bang: 'x.bang', viec: 'sua', loc: [['id', '=', 1]],
      du_lieu: { total_cost: 9, margin_percent: 3, name: 'X' },
    });

    const s = logDaGhi();
    expect(s).toContain('total_cost');
    expect(s).toContain('margin_percent');
  });

  it('lệnh THƯỜNG không ghi log cảnh báo (đừng làm nhiễu nhật ký)', async () => {
    const odoo = fake(1);

    await lamOdoo({ odoo } as never, {
      bang: 'sale.order', viec: 'goi_nut', nut: 'action_confirm', loc: [['name', '=', 'S1']],
    });
    await lamOdoo({ odoo } as never, {
      bang: 'product.template', viec: 'sua', loc: [['id', '=', 5]], du_lieu: { default_code: 'X1' },
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it('bị chặn bởi phanh xoá / hàng loạt thì KHÔNG log (chưa ghi gì cả)', async () => {
    const odoo = fake(300, { standard_price: 1 });

    const kq = await lamOdoo({ odoo } as never, {
      bang: 'product.product', viec: 'sua', loc: [['id', '>', 0]],
      du_lieu: { standard_price: 5 },
    });

    expect(kq.trangThai).toBe('can_xac_nhan');
    expect(warn).not.toHaveBeenCalled();
  });

  it('đọc giá trị cũ hỏng thì vẫn ghi log và vẫn chạy lệnh', async () => {
    // Cột nhạy cảm có thể không đọc được (Odoo chặn quyền, tên cột lạ). Dấu vết
    // là thứ tốt-nhất-có-thể, không được phép làm rơi lệnh của nhân viên.
    const odoo = fake(1);
    odoo.searchRead = vi.fn(async (_b: string, _l: unknown, cot: string[]) => {
      if (cot.includes('standard_price')) throw new Error('Odoo tu choi doc cot');
      return [{ id: 1 }];
    }) as never;

    const kq = await lamOdoo({ odoo } as never, {
      bang: 'product.product', viec: 'sua', loc: [['id', '=', 1]],
      du_lieu: { standard_price: 5 },
    });

    expect(kq.trangThai).toBe('da_lam');
    expect(logDaGhi()).toContain('standard_price');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('DẤU VẾT 2 — câu trả lời cho nhân viên nói rõ', () => {
  it('câu trả lời nêu đã sửa giá vốn và giá trị mới', async () => {
    const odoo = fake(1, { standard_price: 70000 });

    const kq = await lamOdoo({ odoo } as never, {
      bang: 'product.product', viec: 'sua', loc: [['id', '=', 5]],
      du_lieu: { standard_price: 85000 },
    });
    const cau = dinhDangLam(kq);

    expect(cau).toContain('Đã sửa 1 bản ghi trên product.product');
    expect(cau.toLowerCase()).toContain('giá vốn');
    expect(cau).toContain('standard_price');
    expect(cau).toContain('85.000');
  });

  it('nhiều cột nhạy cảm thì liệt kê hết', async () => {
    const odoo = fake(1);

    const kq = await lamOdoo({ odoo } as never, {
      bang: 'x.bang', viec: 'sua', loc: [['id', '=', 1]],
      du_lieu: { standard_price: 1000, margin: 20, name: 'X' },
    });
    const cau = dinhDangLam(kq);

    expect(cau).toContain('standard_price');
    expect(cau).toContain('margin');
    // Cột thường không cần nêu — câu trả lời không phải bản sao của du_lieu.
    expect(cau).not.toContain('name');
  });

  it('lệnh thường giữ NGUYÊN câu cũ, không dính chữ thừa', async () => {
    const odoo = fake(1);

    const kq = await lamOdoo({ odoo } as never, {
      bang: 'product.template', viec: 'sua', loc: [['id', '=', 5]], du_lieu: { default_code: 'X1' },
    });

    expect(dinhDangLam(kq)).toBe('Đã sửa 1 bản ghi trên product.template.');
  });

  it('câu xin xác nhận (phanh xoá) KHÔNG bị đụng vào', () => {
    const cau = dinhDangLam({
      trangThai: 'can_xac_nhan', lyDo: 'xoa', soBanGhi: 47, moTa: 'sẽ xoá 47 đơn nháp',
    });
    expect(cau).toContain('sẽ xoá 47 đơn nháp');
    expect(cau).toContain('đồng ý');
  });
});
