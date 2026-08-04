// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tool tạo khách hàng mới.
//
// Trọng tâm: KHÔNG TẠO TRÙNG. Khách trùng là rác vĩnh viễn — đối chiếu công nợ
// sau này sẽ sai, và không ai đi gộp thủ công 3700 khách. Đây là lý do tool cũ
// (`tra_khach_hang`) cố ý không bao giờ tạo; giờ được phép tạo thì phải chặn
// trùng bằng code, không phải bằng prompt.
import { describe, it, expect, vi } from 'vitest';
import {
  taoKhachHang, dinhDangTaoKhach, taoKhachHangDefinition, TIEN_TO_REF,
} from '../../../src/modules/ai/odoo/tools/tao-khach-hang.js';

const CU = { id: 42, name: 'Chị Yến Tân Mai', ref: 'zalo:u123' };

const odooGia = (rows: unknown[][] = [[], [], []]) => {
  let lan = 0;
  return {
    searchRead: vi.fn(async () => rows[lan++] ?? []),
    execute: vi.fn(async () => 777),
  };
};

describe('Chống trùng — LỚP 1: UID Zalo', () => {
  it('UID đã có → trả khách cũ, KHÔNG tạo', async () => {
    const odoo = odooGia([[CU]]);
    const kq = await taoKhachHang({ odoo, zaloUid: 'u123' }, { ten: 'Yến' });

    expect(kq).toEqual({ trangThai: 'ok', khach: { id: 42, ten: 'Chị Yến Tân Mai', ma: 'zalo:u123', daCo: true } });
    expect(odoo.execute).not.toHaveBeenCalled();
  });

  it('tra đúng ref "zalo:<uid>"', async () => {
    const odoo = odooGia([[CU]]);
    await taoKhachHang({ odoo, zaloUid: 'u123' }, { ten: 'Yến' });

    expect(odoo.searchRead.mock.calls[0][1]).toEqual([['ref', '=', `${TIEN_TO_REF}u123`]]);
  });

  it('gọi LẠI cùng UID → vẫn một khách (an toàn khi Zalo gửi trùng tin)', async () => {
    const odoo = odooGia([[CU], [CU]]);
    const a = await taoKhachHang({ odoo, zaloUid: 'u123' }, { ten: 'Yến' });
    const b = await taoKhachHang({ odoo, zaloUid: 'u123' }, { ten: 'Yến' });

    expect(a).toEqual(b);
    expect(odoo.execute).not.toHaveBeenCalled();
  });
});

describe('Chống trùng — LỚP 2: số điện thoại', () => {
  it('SĐT đã có → trả khách cũ', async () => {
    const odoo = odooGia([[], [CU]]); // lớp 1 trống, lớp 2 thấy
    const kq = await taoKhachHang({ odoo, zaloUid: 'moi' }, { ten: 'Yến', dien_thoai: '0912345678' });

    if (kq.trangThai === 'ok') expect(kq.khach.daCo).toBe(true);
    expect(odoo.execute).not.toHaveBeenCalled();
  });

  it('tra CẢ phone lẫn mobile — DB lưu không chuẩn hoá', async () => {
    const odoo = odooGia([[], [CU]]);
    await taoKhachHang({ odoo, zaloUid: 'moi' }, { ten: 'Yến', dien_thoai: '0912345678' });

    expect(JSON.stringify(odoo.searchRead.mock.calls[1][1])).toContain('mobile');
  });
});

describe('Chống trùng — LỚP 3: tên chính xác', () => {
  it('trùng tên CHÍNH XÁC → trả khách cũ', async () => {
    // Không truyền dien_thoai nên LỚP 2 bị bỏ qua → chỉ 2 lần searchRead.
    const odoo = odooGia([[], [CU]]);
    const kq = await taoKhachHang({ odoo, zaloUid: 'moi' }, { ten: 'Chị Yến Tân Mai' });

    if (kq.trangThai === 'ok') expect(kq.khach.daCo).toBe(true);
  });

  it('dùng "=" chứ KHÔNG "ilike" — "Chị Lan" không được khớp "Chị Lan (cũ)"', async () => {
    // Đo thật 2026-08-02 khi thử gộp khách trùng: so khớp "chứa" bắt nhầm hai
    // người khác nhau. Đó là lý do phải khớp chính xác.
    const odoo = odooGia([[], [], []]);
    await taoKhachHang({ odoo, zaloUid: 'moi' }, { ten: 'Chị Lan' });

    expect(JSON.stringify(odoo.searchRead.mock.calls.at(-1)![1])).toContain('"="');
  });

  it('NHIỀU người cùng tên → BÁO LỖI, để nhân viên chọn (đừng tạo thêm)', async () => {
    const odoo = odooGia([[], [CU, { ...CU, id: 43 }]]);
    const kq = await taoKhachHang({ odoo, zaloUid: 'moi' }, { ten: 'Chị Lan' });

    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
  });
});

describe('Tạo mới', () => {
  it('không trùng gì → tạo, trả id', async () => {
    const odoo = odooGia();
    const kq = await taoKhachHang({ odoo, zaloUid: 'u999' }, { ten: 'Anh Trung', dien_thoai: '0935717096' });

    expect(kq).toEqual({ trangThai: 'ok', khach: { id: 777, ten: 'Anh Trung', ma: 'zalo:u999', daCo: false } });
  });

  it('lưu ref = zalo:<uid> để nhân viên lọc ra bổ sung sau', async () => {
    const odoo = odooGia();
    await taoKhachHang({ odoo, zaloUid: 'u999' }, { ten: 'Anh Trung' });

    expect(odoo.execute.mock.calls[0][2][0]).toMatchObject({ ref: 'zalo:u999', customer_rank: 1 });
  });

  it('KHÔNG có UID vẫn tạo được (khách nhắn từ group)', async () => {
    const odoo = odooGia();
    const kq = await taoKhachHang({ odoo, zaloUid: null }, { ten: 'Anh Trung' });

    expect(kq.trangThai).toBe('ok');
    expect(odoo.execute.mock.calls[0][2][0]).not.toHaveProperty('ref');
  });

  it('gộp khoảng trắng thừa trong tên', async () => {
    const odoo = odooGia();
    await taoKhachHang({ odoo, zaloUid: null }, { ten: '  Anh   Trung  ' });

    expect(odoo.execute.mock.calls[0][2][0].name).toBe('Anh Trung');
  });

  it('Odoo ném → trả lỗi, KHÔNG ném ra ngoài', async () => {
    const odoo = { searchRead: vi.fn(async () => []), execute: vi.fn(async () => { throw new Error('access denied'); }) };
    const kq = await taoKhachHang({ odoo, zaloUid: 'u1' }, { ten: 'Test' });

    expect(kq.trangThai).toBe('loi');
  });
});

describe('Kiểm đầu vào', () => {
  it.each(['', '   ', 'A'])('tên "%s" → lỗi, không tạo rác', async (ten) => {
    const odoo = odooGia();
    expect((await taoKhachHang({ odoo, zaloUid: 'u1' }, { ten })).trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
  });
});

describe('Định dạng đầu ra', () => {
  it('khách CŨ → nói rõ ĐÃ CÓ, cấm tạo thêm', () => {
    const s = dinhDangTaoKhach({ trangThai: 'ok', khach: { id: 42, ten: 'Yến', ma: 'zalo:u1', daCo: true } });

    expect(s).toContain('ĐÃ CÓ');
    expect(s).toContain('KHÔNG tạo thêm');
  });

  it('khách MỚI → nói rõ đã tạo + id để lên đơn', () => {
    const s = dinhDangTaoKhach({ trangThai: 'ok', khach: { id: 777, ten: 'Trung', ma: null, daCo: false } });

    expect(s).toContain('Đã tạo khách mới');
    expect(s).toContain('777');
  });
});

describe('Định nghĩa tool', () => {
  it('đánh dấu mutates — đây là tool GHI', () => {
    expect(taoKhachHangDefinition.mutates).toBe(true);
  });

  it('mô tả có điều kiện kích hoạt và nói rõ tự chống trùng', () => {
    expect(taoKhachHangDefinition.description).toContain('GỌI KHI');
    expect(taoKhachHangDefinition.description).toContain('chống trùng');
  });

  it('chỉ TÊN là bắt buộc — khách Zalo thường không cho SĐT ngay', () => {
    expect(taoKhachHangDefinition.inputSchema.required).toEqual(['ten']);
  });
});
