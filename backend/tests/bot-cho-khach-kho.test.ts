// SPDX-License-Identifier: AGPL-3.0-or-later
// Cho khách (docs/79, sửa 02/10 — nguồn = KHO TRI THỨC CRM): hàm THUẦN của bot-cho-khach-kho.ts.
//   • băm tài liệu từ CHÍNH các đoạn knowledge_chunks (ord tăng dần) — đúng §3b, cùng vector hợp đồng;
//   • dấu hiệu "có vẻ nội bộ" xét TOÀN VĂN (CRM giữ toàn văn) — bảng giá ở đoạn cuối vẫn thấy;
//   • làm sạch đoạn trả bot: bỏ DÒNG có giá/tiền/SĐT/đường dẫn/email/số tồn;
//   • kiểm thân POST /api/public/cho-khach/tim;
//   • ưu tiên đoạn nói đúng mã SP.
import { describe, it, expect } from 'vitest';
import {
  bamTuDoan, dauHieuNoiBo, lamSachChoKhach, docYeuCauTim, uuTienTheoSanPham, MAU_KY_TU, mauNoiDung, tapToken, khopNeo, dongCoGia,
} from '../src/modules/bot-quyen/bot-cho-khach-kho.js';
import { LoiChoKhach } from '../src/modules/bot-quyen/bot-cho-khach-hop-dong.js';

function loi(f: () => unknown): LoiChoKhach {
  try { f(); } catch (e) { if (e instanceof LoiChoKhach) return e; throw e; }
  throw new Error('không ném lỗi');
}

describe('bamTuDoan — băm theo đoạn knowledge_chunks (hợp đồng §3b)', () => {
  it('vector hợp đồng: sắp theo ord TĂNG DẦN bất kể thứ tự đọc', () => {
    expect(bamTuDoan([
      { id: 'b', ord: 1, content: 'Điện áp 5V\nCông suất 30W' }, { id: 'a', ord: 0, content: 'Module P10 full color' },
    ])).toBe('954417e52b60aaf91952023735fbdc9c657abde3387872de1d285fc05ba34c45');
  });
  it('không đoạn / toàn khoảng trắng ⇒ null (không duyệt được)', () => {
    expect(bamTuDoan([])).toBeNull();
    expect(bamTuDoan([{ id: 'a', ord: 0, content: '  ' }, { id: 'b', ord: 1, content: '\t' }])).toBeNull();
  });
  it('trùng ord ⇒ phá hoà theo id (tất định)', () => {
    const a = bamTuDoan([{ id: 'x2', ord: 0, content: 'B' }, { id: 'x1', ord: 0, content: 'A' }]);
    expect(a).toBe(bamTuDoan([{ id: 'x1', ord: 0, content: 'A' }, { id: 'x2', ord: 0, content: 'B' }]));
  });
});

describe('dauHieuNoiBo — xét tiêu đề + TOÀN VĂN', () => {
  it('datasheet sạch ⇒ không dấu hiệu', () => {
    expect(dauHieuNoiBo('LED Dây NEON 6x12', ['Điện áp hoạt động 12V DC', 'Chống nước IP65', 'Nhiệt độ màu 3000K'])).toEqual([]);
  });
  it('bảng giá nằm ở ĐOẠN CUỐI (sau 300 ký tự đầu) vẫn bắt', () => {
    const doan = ['x'.repeat(2000), 'Giá bán: 260.000đ'];
    expect(dauHieuNoiBo('Card thu BX-V7512', doan)).toEqual(expect.arrayContaining([expect.stringMatching(/giá/)]));
  });
  it('tiêu đề nội bộ + tồn kho + SĐT đều có lý do riêng', () => {
    const d = dauHieuNoiBo('Catalog LEDNELIA (giá + nhóm + tồn)', ['Tồn kho: 12 cuộn', 'HOTLINE : 0969.810.104']);
    expect(d.join(' | ')).toMatch(/tồn/);
    expect(d.join(' | ')).toMatch(/điện thoại/);
  });
  it('"3000K", "60 bóng/m", "IP65", "P10" không bị coi là tiền', () => {
    expect(dauHieuNoiBo('Led dây', ['3000K', '60 bóng/m', 'IP65', 'P10', '50.000 giờ'])).toEqual([]);
  });
});

describe('lamSachChoKhach — bỏ DÒNG bẩn trước khi gửi bot', () => {
  it('bỏ dòng giá, giữ dòng thông số', () => {
    expect(lamSachChoKhach('Tên: Card thu BX-V7512\nGiá bán: 260.000đ\nĐơn vị: Cái\n12 cổng HUB75'))
      .toBe('Tên: Card thu BX-V7512\nĐơn vị: Cái\n12 cổng HUB75');
  });
  it('bỏ SĐT, đường dẫn, email, số tồn, chiết khấu', () => {
    const s = lamSachChoKhach([
      'HOTLINE : 0969.810.104', 'www.lednelia.com', 'xem https://a.b/c', 'mail: a@b.vn', 'Tồn kho: 12', 'Chiết khấu 5%',
      'Điện áp 5V',
    ].join('\n'));
    expect(s).toBe('Điện áp 5V');
  });
  it('mọi dòng bẩn ⇒ chuỗi rỗng', () => {
    expect(lamSachChoKhach('Giá bán: 120.000đ\n0912345678')).toBe('');
  });
});

describe('docYeuCauTim — thân POST /api/public/cho-khach/tim', () => {
  it('mặc định so_doan 3; cắt khoảng trắng', () => {
    expect(docYeuCauTim({ truy_van: '  thông số P10 ' })).toEqual({ truyVan: 'thông số P10', soDoan: 3, sanPham: null });
  });
  it('san_pham {ten, ma}', () => {
    expect(docYeuCauTim({ truy_van: 'ip', so_doan: 5, san_pham: { ten: 'Card thu BX-V7512', ma: null } }))
      .toEqual({ truyVan: 'ip', soDoan: 5, sanPham: { ten: 'Card thu BX-V7512', ma: null } });
  });
  it.each([
    [{}], [{ truy_van: '' }], [{ truy_van: 'x'.repeat(501) }], [{ truy_van: 'a', so_doan: 6 }], [{ truy_van: 'a', so_doan: 0 }],
    [{ truy_van: 'a', so_doan: 1.5 }], [{ truy_van: 'a', san_pham: 'x' }], [{ truy_van: 'a', san_pham: { ten: 1 } }],
    [{ truy_van: 'a', san_pham: { ten: 'b', ma: 'x'.repeat(129) } }], [[]], [null],
  ])('sai hình %j ⇒ 400 YEU_CAU_TIM_KHONG_HOP_LE', (b) => {
    const e = loi(() => docYeuCauTim(b));
    expect([e.status, e.code]).toEqual([400, 'YEU_CAU_TIM_KHONG_HOP_LE']);
  });
  it('trần độ dài đếm CODE POINT (emoji = 1)', () => {
    expect(docYeuCauTim({ truy_van: '😀'.repeat(500) }).truyVan).toHaveLength(1000);
  });
});

describe('uuTienTheoSanPham — đoạn nói đúng mã SP lên đầu (ổn định)', () => {
  const ds = [
    { tieuDe: 'Card thu BX-V7508', noiDung: 'BX-V7508 8 cổng' },
    { tieuDe: 'Thông số chung', noiDung: 'Card BX-V7512: 12 cổng' },
    { tieuDe: 'Card thu BX-V7516', noiDung: '16 cổng' },
  ];
  it('mã khớp (bỏ dấu gạch/khoảng) ⇒ lên đầu, phần còn lại giữ thứ tự', () => {
    expect(uuTienTheoSanPham(ds, { ten: 'Card thu', ma: 'bx v7512' }).map((x) => x.tieuDe))
      .toEqual(['Thông số chung', 'Card thu BX-V7508', 'Card thu BX-V7516']);
  });
  it('không SP / mã ngắn ⇒ giữ nguyên', () => {
    expect(uuTienTheoSanPham(ds, null)).toEqual(ds);
    expect(uuTienTheoSanPham(ds, { ten: 'x', ma: 'ab' })).toEqual(ds);
  });
});

describe('tapToken / khopNeo — neo định danh SP (như bot)', () => {
  it('"LLR- P3.076 .3840hz outdoor" có p3, 076, 3840hz, p3076', () => {
    const t = tapToken('LLR- P3.076 .3840hz outdoor');
    for (const x of ['p3', '076', '3840hz', 'p3076', 'outdoor']) expect(t.has(x)).toBe(true);
  });
  it('mọi nhóm phải khớp ít nhất một lựa chọn; không neo ⇒ khớp', () => {
    const t = tapToken('Card thu BX-V7512 (12 cổng)');
    expect(khopNeo([['v7512', 'bxv7512']], t)).toBe(true);
    expect(khopNeo([['v7512'], ['v7516']], t)).toBe(false);
    expect(khopNeo(null, t)).toBe(true);
    expect(khopNeo([], t)).toBe(true);
  });
});

describe('dongCoGia — không chặn thông số bình thường', () => {
  it.each(['Thông số | Giá trị', 'Nhiệt độ màu 3000K', '60 bóng/m', '16,7 triệu màu', 'Tuổi thọ 50.000 giờ', 'Tần số quét 3840Hz',
    'Kích thước 320x160mm', 'Điện áp 5V 40A', 'Chiều dài 5m/cuộn', 'Công suất 14,4W/m'])('"%s" KHÔNG là giá', (d) => {
    expect(dongCoGia(d)).toBe(false);
  });
  it.each(['Giá bán: 260.000đ', '120k/m', '1tr2', '1.200.000 VND', 'Giá đại lý liên hệ', 'Chiết khấu 5%', '$12'])(
    '"%s" là giá', (d) => { expect(dongCoGia(d)).toBe(true); });
});

describe('mauNoiDung', () => {
  it(`cắt ${MAU_KY_TU} code point`, () => {
    expect(mauNoiDung(['😀'.repeat(400)])).toBe('😀'.repeat(MAU_KY_TU));
    expect(mauNoiDung([])).toBeNull();
  });
});
