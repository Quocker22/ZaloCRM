// SPDX-License-Identifier: AGPL-3.0-or-later
// XẾP HẠNG khách theo độ khớp GẦN NGUYÊN VĂN — và biết khi nào ĐƯỢC tự chốt.
//
// Yêu cầu anh Quốc 21:56 11/08/2026: "có cách nào search thông minh hơn không
// nhỉ? ví dụ trên nv nói 'a Long led' thì kết quả có kết quả là 'Anh Long Led'
// thì lấy luôn thôi còn mấy khách khác thì là khác hẳn tên mà".
//
// Dữ liệu trong các test này là DANH SÁCH THẬT lấy từ Odoo prod 11/08/2026
// (docker exec zalo-crm-app node …), không phải tên bịa — vì luật tự chốt chỉ
// đáng tin khi đo trên đúng thứ rác dữ liệu mà nó phải sống chung.
import { describe, it, expect } from 'vitest';
import { xepHangKhach } from '../../../src/modules/ai/odoo/tools/tra-khach-hang.js';

/** Dựng ứng viên tối giản — chỉ `ten` và `ma` là thứ luật xếp hạng nhìn tới. */
const kh = (ten: string, ma: string) => ({ id: 0, ten, ma, dienThoai: null, congNo: 0 });

// ── Ca 1: "a Long led" — DS thật 8 người, đo prod 11/08 ────────────────────
const LONG_LED = [
  kh('Anh Long Led', 'KH000117'),
  kh('LED - Anh Đoàn Bình - Long Biên', 'KH001695- ACDL'),
  kh('LED DIÊU LINH 64 TRẦN PHÚ HÀ KHÁNH HẠ LONG -  0979 090 091', 'KH001022'),
  kh('Led Hoàng Long', 'KH002802'),
  kh('Led Kim Long', 'KH001564- ACDL'),
  kh('Led Long Thành - Thái Bình', 'KH002615ACDL'),
  kh('Led Phi Long- HCM', 'KH000922-ACDL'),
  kh('led bảo long -Anh long - Sn 290 việt bắc tp thái nguyên 0962801888', 'KH000701- ACDL'),
];

// ── Ca 2: "anh Thức" — hai người NGANG NHAU, đo prod 11/08 ─────────────────
const THUC = [kh('Anh Thức CNC', 'KH002090'), kh('Anh Thức- Nam ĐỊnh', 'KH002559AC')];

// ── Ca 3: BẪY THẬT. Đêm 11/08 anh Quốc gõ "Cảnh tam kỳ" rồi chọn "Anh Cảnh -
// Led Việt - Tam Kỳ" (KH003067ACDL) — KHÔNG phải "Anh Cảnh Tam Kỳ" (KH000202)
// là cái khớp nguyên văn. Chốt theo điểm thuần là LẤY NHẦM KHÁCH.
const CANH = [
  kh('Anh Cảnh - Led Việt - Tam Kỳ', 'KH003067ACDL'),
  kh('Anh Cảnh Tam Kỳ', 'KH000202- ACDL'),
];

describe('xepHangKhach — chốt khi áp đảo, hỏi khi còn người "cùng kiểu tên"', () => {
  it('"a Long led" → tự chốt Anh Long Led; 7 người kia khác hẳn tên', () => {
    const kq = xepHangKhach('a Long led', LONG_LED);
    expect(kq.tuChot?.ten).toBe('Anh Long Led');
    expect(kq.tuChot?.ma).toBe('KH000117');
    // Xếp hạng phải đẩy đúng người lên đầu, không phụ thuộc thứ tự Odoo trả.
    expect(kq.danhSach[0].ten).toBe('Anh Long Led');
  });

  it('bỏ xưng hô CẢ HAI VẾ: "a" ~ "Anh" nên vẫn là khớp nguyên văn', () => {
    // NV gõ "a Long led", tên DB là "Anh Long Led" — khác mỗi xưng hô.
    expect(xepHangKhach('a Long led', LONG_LED).tuChot?.ten).toBe('Anh Long Led');
    expect(xepHangKhach('Long Led', LONG_LED).tuChot?.ten).toBe('Anh Long Led');
    expect(xepHangKhach('anh long led', LONG_LED).tuChot?.ten).toBe('Anh Long Led');
  });

  it('"anh Thức" → VẪN HỎI: hai người cùng bắt đầu bằng đúng cụm đó', () => {
    const kq = xepHangKhach('anh Thức', THUC);
    expect(kq.tuChot).toBeNull();
  });

  it('"Cảnh tam kỳ" → VẪN HỎI dù có người khớp nguyên văn (chống chốt nhầm khách)', () => {
    // "Anh Cảnh Tam Kỳ" khớp 100%, nhưng "Anh Cảnh - Led Việt - Tam Kỳ" giữ
    // ĐÚNG THỨ TỰ cảnh→tam→kỳ nên vẫn là "cùng kiểu tên" → không được chốt.
    // Đây là người anh Quốc THẬT SỰ chọn đêm 11/08.
    const kq = xepHangKhach('Cảnh tam kỳ', CANH);
    expect(kq.tuChot).toBeNull();
    // Vẫn xếp người khớp nguyên văn lên đầu cho dễ nhìn — chỉ không tự chốt.
    expect(kq.danhSach[0].ten).toBe('Anh Cảnh Tam Kỳ');
  });

  it('câu LỆNH dài, không phải tên → không chốt ai (chống hồi quy S13814 07/08)', () => {
    // Đơn S13814 phải huỷ vì mảnh chữ trong câu lệnh khớp bừa tên khách.
    expect(xepHangKhach('xuất hóa đơn LUÔN giúp tôi nhé', LONG_LED).tuChot).toBeNull();
    expect(xepHangKhach('xuất hóa đơn LUÔN giúp tôi nhé', CANH).tuChot).toBeNull();
  });

  it('từ khoá RỖNG / danh sách 1 người → không bịa ra chốt', () => {
    expect(xepHangKhach('', LONG_LED).tuChot).toBeNull();
    expect(xepHangKhach('a Long led', []).tuChot).toBeNull();
  });

  it('khớp một phần giữa tên dài không đủ để chốt', () => {
    // "Long" trần trụi khớp NHIỀU người → phải hỏi, đúng hành vi cũ.
    expect(xepHangKhach('Long', LONG_LED).tuChot).toBeNull();
    expect(xepHangKhach('Led', LONG_LED).tuChot).toBeNull();
  });
});
