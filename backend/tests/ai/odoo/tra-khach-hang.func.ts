// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tool tra_khach_hang.
// Trọng tâm: TUYỆT ĐỐI không tạo res.partner. Khách trùng lặp là rác vĩnh viễn.
import { describe, it, expect, vi } from 'vitest';
import {
  traKhachHang,
  dinhDangKhachHang,
  bienTheSdt,
} from '../../../src/modules/ai/odoo/tools/tra-khach-hang.js';

const fakeOdoo = (rows: Record<string, unknown>[]) => ({
  searchRead: vi.fn(async () => rows),
});

const kh = (over: Record<string, unknown> = {}) => ({
  id: 10,
  name: 'Chị Lan',
  ref: 'KH00001',
  phone: '0912345678',
  mobile: false,
  incokit_receivable_balance: 0,
  ...over,
});

describe('bienTheSdt', () => {
  it('sinh đủ 3 dạng vì DB Odoo lưu tự do (không chuẩn hoá, không unique)', () => {
    const v = bienTheSdt('0912345678');
    expect(v).toContain('0912345678');
    expect(v).toContain('+84912345678');
    expect(v).toContain('84912345678');
  });

  it('nhập dạng nào cũng ra cùng bộ biến thể', () => {
    const a = [...bienTheSdt('0912345678')].sort();
    const b = [...bienTheSdt('+84912345678')].sort();
    const c = [...bienTheSdt('84912345678')].sort();
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('SĐT không parse được → vẫn thử nguyên văn (biết đâu DB lưu đúng vậy)', () => {
    expect(bienTheSdt('123')).toEqual(['123']);
  });

  it('chuỗi rỗng → mảng rỗng', () => {
    expect(bienTheSdt('   ')).toEqual([]);
  });
});

describe('traKhachHang — ba trạng thái', () => {
  it('đúng 1 khách → tim_thay', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo([kh()]) }, { sdt: '0912345678' });

    expect(kq.trangThai).toBe('tim_thay');
    if (kq.trangThai === 'tim_thay') {
      expect(kq.khach.id).toBe(10);
      expect(kq.khach.ma).toBe('KH00001');
    }
  });

  it('không có → khong_thay, kèm các SĐT đã thử (để người tra tay)', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo([]) }, { sdt: '0912345678' });

    expect(kq.trangThai).toBe('khong_thay');
    if (kq.trangThai === 'khong_thay') {
      expect(kq.sdtDaTra).toContain('0912345678');
    }
  });

  it('nhiều khách trùng SĐT → nhieu_ket_qua, KHÔNG tự chọn', async () => {
    // Dữ liệu trùng có thật vì phone không unique. Bot đoán bừa là ghi nhầm đơn.
    const kq = await traKhachHang(
      { odoo: fakeOdoo([kh({ id: 10 }), kh({ id: 11, name: 'Chị Lan (cũ)' })]) },
      { sdt: '0912345678' },
    );

    expect(kq.trangThai).toBe('nhieu_ket_qua');
  });
});

describe('traKhachHang — CA THẬT 01:12 ngày 12/08 "anh Vấn"', () => {
  // NV: "@bot lên đơn cho anh Vấn 10 cái Led F5 12V Không Main Màu Đỏ giá 100k".
  // Bot đáp 'Có 10 khách tên "Vấn"' rồi liệt kê ANh Văn, A Hòa - Vạn Phúc,
  // A Nguyễn Văn Đại, A tuấn 1385 Phan Văn Trị... KHÔNG một ai tên Vấn.
  // Anh Quốc: "trong DB có 1 anh vấn thôi mà ????? càng làm càng sai à".
  //
  // Đo prod cùng lúc: ilike 'Vấn' nguyên văn ra ĐÚNG 1 người.
  // Đây là 10 dòng mà mẫu "v_n" của bản 11/08 lôi về, cộng người ĐÚNG ở cuối —
  // đúng tình huống người cần tìm nằm ngoài trang đầu.
  const raoRac = [
    kh({ id: 1, name: 'ANh Văn', ref: 'KH000101' }),
    kh({ id: 2, name: 'A Hòa - Vạn Phúc - Hà Đông', ref: 'KH000102' }),
    kh({ id: 3, name: 'A Linh - Gửi hàng về Văn phòng Anh huy Hải Dương', ref: 'KH000103' }),
    kh({ id: 4, name: 'A Nguyễn Văn Đại- Quảng Ninh', ref: 'KH000104' }),
    kh({ id: 5, name: 'A tuấn, 1385 Phan Văn Trị', ref: 'KH000105' }),
    kh({ id: 6, name: 'Chị Vân Hải Phòng', ref: 'KH000106' }),
    kh({ id: 7, name: 'Chú Vinh Nam Định', ref: 'KH000107' }),
    kh({ id: 8, name: 'Anh Vốn Thanh Hoá', ref: 'KH000108' }),
    kh({ id: 9, name: 'A Vụn Hà Nam', ref: 'KH000109' }),
    kh({ id: 10, name: 'Cô Vân Anh', ref: 'KH000110' }),
    kh({ id: 27, name: 'Anh Vấn Đà Nẵng', ref: 'KH000027', phone: '0934.786.998' }),
  ];

  it('gõ "Vấn" CÓ DẤU → ra ĐÚNG anh Vấn, KHÔNG kèm Văn/Vạn/Vân', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo(raoRac) }, { ten: 'Vấn' });

    // Lọc bỏ dấu chính xác cắt sạch 10 người kia → còn đúng 1 → tim_thay.
    expect(kq.trangThai).toBe('tim_thay');
    if (kq.trangThai === 'tim_thay') {
      expect(kq.khach.ten).toBe('Anh Vấn Đà Nẵng');
      expect(kq.khach.ma).toBe('KH000027');
    }
  });

  it('gõ "van" KHÔNG DẤU → vẫn tìm được anh Vấn (không phá bản vá 11/08)', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo(raoRac) }, { ten: 'van' });

    // Không dấu thì được nới — "Vấn", "Văn", "Vạn" đều là biến thể dấu hợp lệ
    // của "van" nên đều được giữ. Nhưng "Vinh"/"Vốn"/"Vụn" thì KHÔNG.
    expect(kq.trangThai).toBe('nhieu_ket_qua');
    if (kq.trangThai === 'nhieu_ket_qua') {
      const ten = kq.danhSach.map((k) => k.ten);
      expect(ten).toContain('Anh Vấn Đà Nẵng');
      expect(ten).toContain('ANh Văn');
      expect(ten).not.toContain('Chú Vinh Nam Định');
      expect(ten).not.toContain('Anh Vốn Thanh Hoá');
      expect(ten).not.toContain('A Vụn Hà Nam');
    }
  });

  it('truy vấn DB gõ có dấu là NGUYÊN VĂN, không nới', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { ten: 'Vấn' });

    const d = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(d).toContain('"vấn"');
    expect(d).not.toContain('"v_n"');
  });

  it('CA 2 — "van" không dấu: anh Vấn phải LỌT VÀO 10 dòng, và đứng ĐẦU', async () => {
    // ĐO PROD sau bản sửa vòng 1: "van" -> 10 kq + conNua:true, TOÀN Văn/Vạn/Vân,
    // KHÔNG có anh Vấn. Cờ conNua báo đúng nên hệ thống không nói dối — nhưng
    // người nhân viên cần lại không thấy, nên với họ vẫn là hỏng.
    //
    // Gốc rễ: xepHangKhach() chấm điểm SAU khi đã slice(0,10). Odoo trả theo thứ
    // tự chữ cái nên 10 dòng đầu toàn "Văn"/"Vạn"; "Anh Vấn Đà Nẵng" nằm dòng
    // ~11+, bị vứt TRƯỚC khi kịp được chấm điểm. Xếp hạng trên rác thì có xếp
    // cũng vô ích.
    //
    // Dựng đúng hình dạng đó: 12 người Văn/Vạn/Vân đứng trước, anh Vấn cuối bảng.
    const nhieuVan = [
      ...Array.from({ length: 12 }, (_, i) =>
        kh({ id: 100 + i, name: `ANh Văn ${i + 1}`, ref: `KH0001${i}` })),
      kh({ id: 27, name: 'Anh Vấn Đà Nẵng', ref: 'KH000027', phone: '0934.786.998' }),
    ];
    const kq = await traKhachHang({ odoo: fakeOdoo(nhieuVan) }, { ten: 'van' });

    expect(kq.trangThai).toBe('nhieu_ket_qua');
    if (kq.trangThai === 'nhieu_ket_qua') {
      const ten = kq.danhSach.map((k) => k.ten);
      // Tiêu chí đạt: phải NẰM TRONG 10 dòng hiển thị.
      expect(ten).toContain('Anh Vấn Đà Nẵng');
      // Và nằm ở NỬA TRÊN: trải đều cho mỗi biến thể một suất ngay vòng đầu,
      // nên "Vấn" (chỉ 1 người) phải xuất hiện trong 2 dòng đầu, không thể bị
      // 12 người "Văn" đẩy xuống đáy.
      expect(ten.indexOf('Anh Vấn Đà Nẵng')).toBeLessThan(2);
    }
  });

  it('CA 2 — mỗi BIẾN THỂ DẤU đều có mặt, không để một chữ chiếm sạch 10 chỗ', async () => {
    // Bản chất của CA 2: người gõ "van" CHƯA nói họ muốn Vấn hay Văn hay Vạn.
    // Bot không được đoán hộ, nhưng cũng không được cho một chữ chiếm hết chỗ
    // rồi để nhân viên tưởng chữ kia không có ai trong hệ thống.
    const ds = [
      ...Array.from({ length: 8 }, (_, i) => kh({ id: 300 + i, name: `ANh Văn ${i + 1}` })),
      ...Array.from({ length: 8 }, (_, i) => kh({ id: 400 + i, name: `A Vạn ${i + 1}` })),
      kh({ id: 27, name: 'Anh Vấn Đà Nẵng', ref: 'KH000027' }),
    ];
    const kq = await traKhachHang({ odoo: fakeOdoo(ds) }, { ten: 'van' });

    expect(kq.trangThai).toBe('nhieu_ket_qua');
    if (kq.trangThai === 'nhieu_ket_qua') {
      const ten = kq.danhSach.map((k) => k.ten).join(' | ');
      expect(ten).toContain('Vấn');
      expect(ten).toContain('Văn');
      expect(ten).toContain('Vạn');
    }
  });

  it('gõ CÓ DẤU thì KHÔNG trải đều — chỉ còn một biến thể, trải là việc thừa', async () => {
    // Trải đều chỉ dành cho ca người gõ chưa nói rõ dấu. Gõ "Vấn" thì tầng lọc
    // đã cắt sạch Văn/Vạn từ trước, không còn gì để trải.
    const kq = await traKhachHang(
      { odoo: fakeOdoo([
        kh({ id: 27, name: 'Anh Vấn Đà Nẵng' }),
        kh({ id: 28, name: 'Chị Vấn Hà Nội' }),
        kh({ id: 1, name: 'ANh Văn' }),
      ]) },
      { ten: 'Vấn' },
    );

    expect(kq.trangThai).toBe('nhieu_ket_qua');
    if (kq.trangThai === 'nhieu_ket_qua') {
      expect(kq.danhSach.map((k) => k.ten)).toEqual(['Anh Vấn Đà Nẵng', 'Chị Vấn Hà Nội']);
    }
  });

  it('CA 2 — cắt 10 dòng phải cắt THEO ĐIỂM, không theo thứ tự Odoo', async () => {
    // Chốt riêng cơ chế, để lần sau ai đổi thứ tự cắt là test này đỏ ngay:
    // người khớp sát nằm ở CUỐI danh sách DB trả về vẫn phải lên đầu.
    const ds = [
      ...Array.from({ length: 20 }, (_, i) =>
        kh({ id: 200 + i, name: `Chị Vân ${i + 1}`, ref: `KH0002${i}` })),
      kh({ id: 99, name: 'Van', ref: 'KH000099' }),   // khớp NGUYÊN VĂN, điểm 100
    ];
    const kq = await traKhachHang({ odoo: fakeOdoo(ds) }, { ten: 'van' });

    expect(kq.trangThai).toBe('nhieu_ket_qua');
    if (kq.trangThai === 'nhieu_ket_qua') {
      expect(kq.danhSach[0].ten).toBe('Van');
      expect(kq.danhSach).toHaveLength(10);
      // Vẫn phải báo còn nữa — 21 người khớp mà chỉ hiện 10.
      expect(kq.conNua).toBe(true);
    }
  });

  it('gõ CÓ DẤU mà DB lưu KHÔNG DẤU → dự phòng nới, vẫn tìm ra', async () => {
    // Chiều ngược của bản sửa: dữ liệu prod lẫn lộn, có bản ghi gõ vội không
    // dấu ("Anh Thuc Nam Dinh"). Tôn trọng dấu mà không có đường lùi thì lại
    // trả "không tìm thấy" khi DB CÓ người — đúng bug 23:15 11/08 quay lại.
    const odoo = {
      searchRead: vi.fn()
        .mockResolvedValueOnce([])                                            // tra 'thức' nguyên văn: rỗng
        .mockResolvedValueOnce([kh({ id: 5, name: 'Anh Thuc Nam Dinh' })]),   // dự phòng 'th_c': trúng
    };
    const kq = await traKhachHang({ odoo }, { ten: 'Thức' });

    expect(odoo.searchRead).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(odoo.searchRead.mock.calls[0][1])).toContain('"thức"');
    expect(JSON.stringify(odoo.searchRead.mock.calls[1][1])).toContain('"th_c"');
    expect(kq.trangThai).toBe('tim_thay');
  });

  it('gõ CÓ DẤU mà tra RA rồi thì KHÔNG gọi dự phòng', async () => {
    // Dự phòng chỉ được chạy khi đã rỗng sạch — có kết quả đúng dấu mà vẫn nới
    // là nới bừa, quay về đúng cái bug 10-người-sai.
    const odoo = fakeOdoo([kh({ name: 'Anh Vấn Đà Nẵng' })]);
    await traKhachHang({ odoo }, { ten: 'Vấn' });

    expect(odoo.searchRead).toHaveBeenCalledTimes(1);
  });

  it('xin DƯ dòng khi tra theo tên — người đúng hay nằm ngoài trang đầu', async () => {
    // Ca 01:12: 10 dòng rác đứng trước "Anh Vấn Đà Nẵng". Chỉ xin 11 dòng thì
    // lọc xong còn 0 và ta lại phải nhả nguyên 10 dòng rác cho nhân viên.
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { ten: 'van' });

    const opts = odoo.searchRead.mock.calls[0][3] as { limit: number };
    expect(opts.limit).toBeGreaterThan(11);
  });
});

describe('traKhachHang — TRA THEO TÊN', () => {
  // Bug thật 2026-07-29: nhân viên gõ "anh qc hoàng sơn mua 50 ..." — không có
  // SĐT. Tool chỉ nhận sdt nên bot phải chuyển sale, dù khách CÓ trong DB.

  it('tra theo tên → tìm được', async () => {
    const kq = await traKhachHang(
      { odoo: fakeOdoo([kh({ name: 'qc hoàng sơn' })]) },
      { ten: 'qc hoàng sơn' },
    );
    expect(kq.trangThai).toBe('tim_thay');
  });

  it('tên nhiều từ → mỗi từ một AND (khớp dù thiếu từ ở giữa)', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { ten: 'hoàng sơn nam' });

    // Từ 11/08 từ KHÔNG DẤU được tra bằng mẫu nới ("nam" → "n_m") vì `ilike`
    // của Postgres prod không bỏ dấu. Từ 12/08 thì từ CÓ DẤU được giữ nguyên
    // văn ("hoàng" → "hoàng") — người gõ dấu là đã chỉ đích danh, nới ra là ra
    // 10 người sai như ca "anh Vấn" 01:12. Xem tim-khong-dau.ts.
    // Việc test khoá vẫn y nguyên: TÁCH TỪNG TỪ, không tra nguyên cụm.
    const d = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(d).toContain('"hoàng"');
    expect(d).toContain('"sơn"');
    expect(d).toContain('"n_m"');   // "nam" gõ không dấu → vẫn được nới
    // Nguyên cụm KHÔNG được xuất hiện — đó là bug cũ.
    expect(d).not.toContain('"hoàng sơn n_m"');
  });

  it('có CẢ sdt lẫn ten → ưu tiên sdt (chính xác hơn)', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { sdt: '0912345678', ten: 'chị Lan' });

    const d = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(d).toContain('phone');
    expect(d).not.toContain('chị');
  });

  it('không có gì → khong_thay, KHÔNG gọi Odoo', async () => {
    const odoo = fakeOdoo([]);
    const kq = await traKhachHang({ odoo }, {});

    expect(kq.trangThai).toBe('khong_thay');
    expect(odoo.searchRead).not.toHaveBeenCalled();
  });
});

describe('traKhachHang — TRA THEO MÃ KH (ref) — bug S13803 07/08', () => {
  // Bug thật: bot in danh sách "[KH001017]", NV gõ lại "KH001017", tool không
  // tra theo ref nên bot lặp danh sách. Giờ nhận mã KH → tra bằng ref (unique).

  it('tham số `ma` → tra theo ref, tìm được đúng 1', async () => {
    const odoo = fakeOdoo([kh({ ref: 'KH001017' })]);
    const kq = await traKhachHang({ odoo }, { ma: 'KH001017' });
    expect(kq.trangThai).toBe('tim_thay');
    expect(JSON.stringify(odoo.searchRead.mock.calls[0][1])).toContain('ref');
  });

  it('NV gõ mã KH vào ô sdt/ten → tự nhận, chuyển sang tra ref', async () => {
    const odoo = fakeOdoo([kh({ ref: 'KH001017' })]);
    await traKhachHang({ odoo }, { sdt: 'KH001017' });
    expect(JSON.stringify(odoo.searchRead.mock.calls[0][1])).toContain('ref');

    const odoo2 = fakeOdoo([kh({ ref: 'KH002359AC' })]);
    await traKhachHang({ odoo: odoo2 }, { ten: 'KH002359AC' });
    expect(JSON.stringify(odoo2.searchRead.mock.calls[0][1])).toContain('ref');
  });

  it('số điện thoại KHÔNG bị nhầm là mã KH', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { sdt: '0912345678' });
    const d = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(d).toContain('phone');
    expect(d).not.toContain('"ref"');
  });

  it('vẫn chỉ tìm KHÁCH (customer_rank > 0) khi tra theo tên', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { ten: 'hoàng sơn' });

    expect(JSON.stringify(odoo.searchRead.mock.calls[0][1])).toContain('customer_rank');
  });

  it('tra tên hụt → gợi ý model đã hết đường, phải chuyển sale', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo([]) }, { ten: 'không có ai' });

    const s = dinhDangKhachHang(kq);
    expect(s).toContain('đã tra theo tên');
    expect(s).toContain('chuyen_sale');
  });

  it('tra SĐT hụt → gợi ý THỬ LẠI BẰNG TÊN trước khi bỏ cuộc', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo([]) }, { sdt: '0912345678' });

    expect(dinhDangKhachHang(kq)).toContain('`ten`');
  });
});

describe('traKhachHang — CHỈ ĐỌC', () => {
  it('không tìm thấy → KHÔNG có đường tạo partner (deps chỉ có searchRead)', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { sdt: '0912345678' });

    // Kiểu TypeScript đã chặn ở compile-time; đây là chốt chặn runtime.
    expect(Object.keys(odoo)).toEqual(['searchRead']);
    expect((odoo as Record<string, unknown>).execute).toBeUndefined();
  });

  it('chỉ tìm partner là KHÁCH (customer_rank > 0), không lấy nhà cung cấp', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { sdt: '0912345678' });

    expect(JSON.stringify(odoo.searchRead.mock.calls[0][1])).toContain('customer_rank');
  });

  it('tìm cả phone lẫn mobile (Odoo có 2 field riêng)', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { sdt: '0912345678' });

    const domain = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(domain).toContain('phone');
    expect(domain).toContain('mobile');
  });

  it('khách chỉ có mobile → vẫn lấy được số', async () => {
    const kq = await traKhachHang(
      { odoo: fakeOdoo([kh({ phone: false, mobile: '0912345678' })]) },
      { sdt: '0912345678' },
    );
    if (kq.trangThai === 'tim_thay') expect(kq.khach.dienThoai).toBe('0912345678');
  });

  it('SĐT rỗng → khong_thay, KHÔNG gọi Odoo', async () => {
    const odoo = fakeOdoo([]);
    const kq = await traKhachHang({ odoo }, { sdt: '' });

    expect(kq.trangThai).toBe('khong_thay');
    expect(odoo.searchRead).not.toHaveBeenCalled();
  });
});

describe('dinhDangKhachHang — hướng dẫn model làm gì tiếp', () => {
  it('không thấy → NÓI RÕ cấm tự tạo + bảo dùng chuyen_sale', async () => {
    // Model đọc hướng dẫn trong tool result tốt hơn đọc quy tắc trong system prompt.
    const kq = await traKhachHang({ odoo: fakeOdoo([]) }, { sdt: '0912345678' });

    const s = dinhDangKhachHang(kq);
    expect(s).toContain('KHÔNG được tự tạo');
    expect(s).toContain('chuyen_sale');
  });

  it('nhiều kết quả → cấm tự chọn + bảo dùng chuyen_sale', async () => {
    const kq = await traKhachHang(
      { odoo: fakeOdoo([kh({ id: 10 }), kh({ id: 11 })]) },
      { sdt: '0912345678' },
    );

    const s = dinhDangKhachHang(kq);
    expect(s).toContain('KHÔNG tự chọn');
    expect(s).toContain('chuyen_sale');
  });

  it('có công nợ → BÁO CÓ nợ nhưng KHÔNG nêu số, bắt gọi xuat_cong_no', async () => {
    // Đổi sau bug 16:09 11/08: `incokit_receivable_balance` sai ở 29/40 khách
    // nợ nhiều nhất trên prod. Nêu số ở đây là model trả lời câu hỏi công nợ
    // bằng số sai mà không bao giờ gọi xuat_cong_no (nguồn đúng).
    const kq = await traKhachHang(
      { odoo: fakeOdoo([kh({ incokit_receivable_balance: 5000000 })]) },
      { sdt: '0912345678' },
    );

    const s = dinhDangKhachHang(kq);
    expect(s).toContain('ĐANG CÓ CÔNG NỢ');
    expect(s).toContain('xuat_cong_no');
    expect(s).not.toContain('5.000.000đ');
  });

  it('không nợ → không nhắc công nợ cho gọn', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo([kh()]) }, { sdt: '0912345678' });
    expect(dinhDangKhachHang(kq)).not.toContain('nợ');
  });
});

describe('traKhachHang — dấu cắt khi danh sách chạm trần', () => {
  // Bug thật 16:15 11/08: "lên đơn cho Anh long led" → tra "Long" ra đúng 10
  // người (trần limit), "Anh Long Led" nằm ngoài trang đầu nhưng KHÔNG có dấu
  // hiệu nào cho biết danh sách bị cắt. Nhân viên nhìn 10 người tưởng là tất
  // cả — anti-pattern "cắt im lặng làm agent nói dối".
  const nhieuKh = (n: number) =>
    Array.from({ length: n }, (_, i) => kh({ id: 100 + i, name: `Anh Long ${i}` }));

  it('kết quả chạm trần → conNua=true, danh sách vẫn đúng 10 người', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo(nhieuKh(11)) }, { ten: 'Long' });

    expect(kq.trangThai).toBe('nhieu_ket_qua');
    if (kq.trangThai === 'nhieu_ket_qua') {
      expect(kq.danhSach).toHaveLength(10);
      expect(kq.conNua).toBe(true);
    }
  });

  it('dưới trần → conNua không bật', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo(nhieuKh(3)) }, { ten: 'Long' });

    expect(kq.trangThai).toBe('nhieu_ket_qua');
    if (kq.trangThai === 'nhieu_ket_qua') {
      expect(kq.conNua).toBeFalsy();
    }
  });

  it('dinhDangKhachHang nói RÕ danh sách bị cắt + cách thu hẹp', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo(nhieuKh(11)) }, { ten: 'Long' });

    const text = dinhDangKhachHang(kq);
    expect(text).toMatch(/còn.*(khác|nữa)|chưa đủ|bị cắt/i);
    expect(text).toMatch(/thu hẹp|đầy đủ hơn|SĐT/i);
  });

  it('không chạm trần → KHÔNG có câu cảnh báo cắt', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo(nhieuKh(2)) }, { ten: 'Long' });

    expect(dinhDangKhachHang(kq)).not.toMatch(/bị cắt|chưa đủ/i);
  });
});
