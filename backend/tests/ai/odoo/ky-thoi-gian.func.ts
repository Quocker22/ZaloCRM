// SPDX-License-Identifier: AGPL-3.0-or-later
// BOT KHÔNG BIẾT HÔM NAY LÀ NGÀY NÀO — bộ test khoá cái lỗ hổng đó.
//
// ═══ HAI CA THẬT CÙNG NGÀY 11/08/2026 ════════════════════════════════════
// Ca 21:17 (nhóm Test-AI) — nhân viên: "@bot Anh muốn nó báo cáo theo ngày
// các sản phẩm bán ra hôm nay". Bot đáp:
//     "báo cáo bán ra + tồn kho hôm nay (20/06/2026) đây ạ:
//      Hôm nay bán ra 69 mã sản phẩm..."
// Anh Quốc: "sao lại 20/6/2026 ???" — lệch gần 2 THÁNG. Toàn bộ báo cáo sai
// kỳ nhưng trình bày y như thật, kèm cả danh sách 7 mã "bất thường". Nhân
// viên tin số đó đi kiểm kho là mất công vô ích.
//
// Ca 03:29 CÙNG NGÀY — bot tự thú, nguyên văn:
//     "Thực ra, em thấy dữ liệu đơn hàng trả về đang ở kỳ 2026-06-20 —
//      không rõ hôm nay là ngày nào"
// CÙNG MỘT NGÀY SAI. Đây là bằng chứng model không đoán ngẫu nhiên mà có xu
// hướng rơi về CÙNG một mốc bịa — nên "chạy lại cho may" không cứu được.
//
// ═══ NGUYÊN NHÂN GỐC ═════════════════════════════════════════════════════
// Model KHÔNG có đồng hồ. Prompt nhân viên không hề nêu ngày, mà inputSchema
// của 3 tool báo cáo lại MỜI model tự tính ngày ("Bỏ trống = HÔM NAY. 'Hôm
// qua' → điền ngày hôm qua"). Model không biết hôm nay là gì nên điền đại
// một ngày trông hợp lý — và code tin luôn.
//
// ═══ TEST KHÔNG ĐƯỢC PHỤ THUỘC NGÀY CHẠY THẬT ════════════════════════════
// Mọi test dưới đây TIÊM đồng hồ (`bayGio`). Gọi `new Date()` trần trong test
// nghĩa là hôm nay xanh, mai đỏ — đó là test rác, và trớ trêu là đúng loại
// lỗi mà chính bộ test này sinh ra để chặn.
import { describe, it, expect } from 'vitest';
import {
  ngayVietNam,
  giaiKy,
  chonKy,
  dongNgayHomNay,
  KY_HOP_LE,
} from '../../../src/modules/ai/odoo/ky-thoi-gian.js';

/**
 * Đồng hồ cố định = ĐÚNG thời điểm ca hỏng: 21:17 ngày 11/08/2026 giờ VN.
 * 21:17 giờ VN = 14:17 UTC cùng ngày.
 */
const LUC_21H17_11_08 = new Date('2026-08-11T14:17:00Z');

// ═══════════════════════════════════════════════════════════════════════════
describe('ngayVietNam — lấy ngày theo GIỜ VIỆT NAM, không phải UTC', () => {
  it('21:17 ngày 11/08 giờ VN → 2026-08-11', () => {
    expect(ngayVietNam(LUC_21H17_11_08)).toBe('2026-08-11');
  });

  // VÌ SAO CẦN RIÊNG CA NÀY: `toISOString().slice(0,10)` (cách code cũ làm)
  // trả ngày UTC. Từ 00:00 đến 06:59 giờ VN thì UTC vẫn là NGÀY HÔM TRƯỚC,
  // nên báo cáo "hôm nay" của ca sáng sớm sẽ lấy nhầm sang hôm qua — lệch
  // đúng 1 ngày, âm thầm, mỗi ngày một lần.
  it('01:00 sáng giờ VN vẫn là NGÀY HÔM ĐÓ (UTC lúc này còn là hôm trước)', () => {
    // 01:00 ngày 12/08 giờ VN = 18:00 ngày 11/08 UTC.
    expect(ngayVietNam(new Date('2026-08-11T18:00:00Z'))).toBe('2026-08-12');
  });

  it('23:59 giờ VN chưa sang ngày mới', () => {
    // 23:59 ngày 11/08 giờ VN = 16:59 ngày 11/08 UTC.
    expect(ngayVietNam(new Date('2026-08-11T16:59:00Z'))).toBe('2026-08-11');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('giaiKy — TỪ KHOÁ ra ngày, code tính chứ không phải model', () => {
  it('hom_nay → đúng 11/08/2026 (ca thật 21:17)', () => {
    expect(giaiKy('hom_nay', LUC_21H17_11_08)).toEqual({ tu: '2026-08-11', den: '2026-08-11' });
  });

  it('hom_qua → 10/08/2026, kỳ đúng MỘT ngày', () => {
    expect(giaiKy('hom_qua', LUC_21H17_11_08)).toEqual({ tu: '2026-08-10', den: '2026-08-10' });
  });

  // Tuần bắt đầu THỨ HAI (chuẩn VN), không phải Chủ nhật kiểu Mỹ.
  // 11/08/2026 là thứ Ba → thứ Hai của tuần là 10/08.
  it('tuan_nay → từ thứ Hai 10/08 đến hôm nay 11/08', () => {
    expect(giaiKy('tuan_nay', LUC_21H17_11_08)).toEqual({ tu: '2026-08-10', den: '2026-08-11' });
  });

  it('tuan_nay khi hôm nay LÀ Chủ nhật vẫn lùi về thứ Hai TRƯỚC đó', () => {
    // 16/08/2026 là Chủ nhật → thứ Hai của tuần đó là 10/08.
    const chuNhat = new Date('2026-08-16T05:00:00Z');
    expect(giaiKy('tuan_nay', chuNhat)).toEqual({ tu: '2026-08-10', den: '2026-08-16' });
  });

  it('thang_nay → từ 01/08 đến hôm nay 11/08', () => {
    expect(giaiKy('thang_nay', LUC_21H17_11_08)).toEqual({ tu: '2026-08-01', den: '2026-08-11' });
  });

  // Tháng trước là kỳ ĐÃ ĐÓNG: phải hết ngày cuối tháng, không cắt ở hôm nay.
  it('thang_truoc → trọn tháng 7: 01/07 đến 31/07', () => {
    expect(giaiKy('thang_truoc', LUC_21H17_11_08)).toEqual({ tu: '2026-07-01', den: '2026-07-31' });
  });

  it('thang_truoc bắc qua NĂM: tháng 1 → trọn tháng 12 năm trước', () => {
    const thang1 = new Date('2027-01-05T05:00:00Z');
    expect(giaiKy('thang_truoc', thang1)).toEqual({ tu: '2026-12-01', den: '2026-12-31' });
  });

  it('thang_truoc ra đúng ngày cuối tháng 2 năm nhuận', () => {
    const thang3 = new Date('2028-03-10T05:00:00Z');
    expect(giaiKy('thang_truoc', thang3)).toEqual({ tu: '2028-02-01', den: '2028-02-29' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('chonKy — LỚP CHẶN CHÍNH: nhân viên nói "hôm nay" thì KHÔNG có đường ra ngày sai', () => {
  // ĐÂY LÀ TEST TÁI HIỆN CA THẬT 21:17 ngày 11/08/2026.
  it('CA THẬT: model điền tu_ngay=2026-06-20 nhưng CÓ ky=hom_nay → thắng là HÔM NAY', () => {
    const kq = chonKy({ ky: 'hom_nay', tu_ngay: '2026-06-20', den_ngay: '2026-06-20' }, LUC_21H17_11_08);
    expect(kq.tu).toBe('2026-08-11');
    expect(kq.den).toBe('2026-08-11');
    // Ngày 20/06 mà model bịa PHẢI biến mất hoàn toàn, không được lọt ra ngoài
    // dưới bất kỳ dạng nào — kể cả trong nhãn kỳ in cho người đọc.
    expect(JSON.stringify(kq)).not.toContain('2026-06-20');
  });

  it('KHÔNG có ky, KHÔNG có ngày → mặc định HÔM NAY (không phải kỳ bịa)', () => {
    expect(chonKy({}, LUC_21H17_11_08)).toMatchObject({ tu: '2026-08-11', den: '2026-08-11' });
  });

  it('nhân viên NÊU NGÀY CỤ THỂ ("từ 1/8 đến 5/8") → TÔN TRỌNG, không đè', () => {
    const kq = chonKy({ tu_ngay: '2026-08-01', den_ngay: '2026-08-05' }, LUC_21H17_11_08);
    expect(kq).toMatchObject({ tu: '2026-08-01', den: '2026-08-05' });
    expect(kq.canhBao).toBeUndefined();
  });

  it('chỉ có tu_ngay → kỳ đúng MỘT ngày đó, không kéo tới hôm nay', () => {
    // "hôm 5/8 bán gì" mà trả cả tuần tới hôm nay là sai tập mã cho kho.
    expect(chonKy({ tu_ngay: '2026-08-05' }, LUC_21H17_11_08)).toMatchObject({
      tu: '2026-08-05',
      den: '2026-08-05',
    });
  });

  it('ky lạ/rác → rơi về HÔM NAY, không ném lỗi và không dùng ngày model điền', () => {
    expect(chonKy({ ky: 'quy_nay' as never, tu_ngay: '2026-06-20' }, LUC_21H17_11_08)).toMatchObject({
      tu: '2026-08-11',
      den: '2026-08-11',
    });
  });

  it('ngày sai định dạng → bỏ qua, rơi về hôm nay chứ không nhét rác vào Odoo', () => {
    expect(chonKy({ tu_ngay: 'hôm nay' }, LUC_21H17_11_08)).toMatchObject({
      tu: '2026-08-11',
      den: '2026-08-11',
    });
  });

  it('tu_ngay > den_ngay (model điền ngược) → tự đảo lại, không trả kỳ rỗng', () => {
    expect(chonKy({ tu_ngay: '2026-08-05', den_ngay: '2026-08-01' }, LUC_21H17_11_08)).toMatchObject({
      tu: '2026-08-01',
      den: '2026-08-05',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('chonKy — CHẶN NGÀY VÔ LÝ (dấu vân tay của ngày bịa)', () => {
  // NGƯỠNG và VÌ SAO:
  //   · TƯƠNG LAI — dữ liệu bán hàng của ngày chưa tới KHÔNG THỂ tồn tại. Đây
  //     không phải "đáng ngờ" mà là chắc chắn sai, nên sửa thẳng về hôm nay.
  //   · QUÁ 1 NĂM — shop mở đơn hằng ngày; câu hỏi kiểm kho hằng ngày mà nhảy
  //     về hơn 1 năm trước gần như chắc chắn là model bịa. Chọn 1 năm (không
  //     phải 3 tháng) vì "doanh thu năm ngoái" là câu hỏi THẬT và hợp lệ —
  //     ngưỡng chặt quá sẽ chặn nhầm việc đúng.
  // Cả hai ca đều KHÔNG im lặng: `canhBao` buộc nơi gọi nói ra cho nhân viên
  // biết kỳ đã bị đổi. Im lặng sửa cũng là một kiểu bịa.
  it('ngày TƯƠNG LAI → kéo về hôm nay VÀ nêu cảnh báo', () => {
    const kq = chonKy({ tu_ngay: '2027-01-01', den_ngay: '2027-01-05' }, LUC_21H17_11_08);
    expect(kq).toMatchObject({ tu: '2026-08-11', den: '2026-08-11' });
    expect(kq.canhBao).toBeTruthy();
    expect(kq.canhBao).toContain('2027-01-01');
  });

  it('ngày QUÁ XA quá khứ (>1 năm) → kéo về hôm nay VÀ nêu cảnh báo', () => {
    const kq = chonKy({ tu_ngay: '2024-06-20', den_ngay: '2024-06-20' }, LUC_21H17_11_08);
    expect(kq).toMatchObject({ tu: '2026-08-11', den: '2026-08-11' });
    expect(kq.canhBao).toBeTruthy();
  });

  it('trong vòng 1 năm thì KHÔNG chặn — "năm ngoái tháng này" là câu hỏi thật', () => {
    const kq = chonKy({ tu_ngay: '2025-09-01', den_ngay: '2025-09-30' }, LUC_21H17_11_08);
    expect(kq).toMatchObject({ tu: '2025-09-01', den: '2025-09-30' });
    expect(kq.canhBao).toBeUndefined();
  });

  // Ca thật 20/06/2026 chỉ cách hôm nay ~52 ngày nên KHÔNG bị luật này bắt —
  // đây chính là lý do lớp `ky` (từ khoá) mới là hàng rào chính, còn luật này
  // chỉ là lưới vét ca lệch thô bạo. Ghi lại để người sau đừng tưởng luật này
  // một mình đủ cứu ca 21:17.
  it('20/06/2026 KHÔNG bị luật vô lý bắt — vì sao cần lớp ky làm hàng rào chính', () => {
    const kq = chonKy({ tu_ngay: '2026-06-20' }, LUC_21H17_11_08);
    expect(kq.canhBao).toBeUndefined();
    expect(kq.tu).toBe('2026-06-20');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('dongNgayHomNay — dòng ngày nhét vào prompt', () => {
  it('nêu đúng ngày hôm nay kiểu Việt Nam kèm thứ', () => {
    const d = dongNgayHomNay(LUC_21H17_11_08);
    expect(d).toContain('11/08/2026');
    expect(d).toContain('Thứ Ba');
  });

  // CHỐNG PHÁ CACHE PROMPT: prompt được cache theo NỘI DUNG. Nhét giờ/phút vào
  // là mỗi lượt một prefix khác nhau → cache miss 100%, token đắt gấp ~4 lần
  // (đọc cache 0,25×). Chỉ để NGÀY thì prefix chỉ đổi mỗi 24h.
  it('KHÔNG chứa giờ/phút — nhét giờ vào là phá cache prompt mỗi lượt', () => {
    const d = dongNgayHomNay(LUC_21H17_11_08);
    expect(d).not.toMatch(/\d{1,2}:\d{2}/);
    expect(d).not.toContain('21');
  });

  it('hai thời điểm KHÁC GIỜ trong CÙNG NGÀY cho chuỗi Y HỆT (cache còn nguyên)', () => {
    const sang = new Date('2026-08-11T02:00:00Z'); // 09:00 giờ VN
    const toi = new Date('2026-08-11T14:17:00Z'); // 21:17 giờ VN
    expect(dongNgayHomNay(sang)).toBe(dongNgayHomNay(toi));
  });

  it('ngắn — prompt nhân viên có trần ký tự', () => {
    expect(dongNgayHomNay(LUC_21H17_11_08).length).toBeLessThan(60);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('KY_HOP_LE — danh sách từ khoá model được chọn', () => {
  it('đủ 5 kỳ nhân viên hay nói', () => {
    expect([...KY_HOP_LE]).toEqual(['hom_nay', 'hom_qua', 'tuan_nay', 'thang_nay', 'thang_truoc']);
  });
});
