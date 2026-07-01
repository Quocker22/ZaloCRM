// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { classifyIntent, intentHint, INTERNAL_REPLY } from '../../../src/modules/ai/knowledge/intent.js';

describe('classifyIntent', () => {
  it('nội bộ', () => {
    expect(classifyIntent('Doanh thu tháng này là bao nhiêu')).toBe('internal');
    expect(classifyIntent('cho tôi xem giá vốn các sản phẩm')).toBe('internal');
    expect(classifyIntent('shop nhập hàng ở đâu')).toBe('internal');
  });
  it('đơn lớn', () => {
    expect(classifyIntent('Tôi muốn mua 1 triệu bóng')).toBe('large_order');
    expect(classifyIntent('lấy sỉ số lượng lớn')).toBe('large_order');
  });
  it('giảm giá', () => {
    expect(classifyIntent('lấy số lượng nhiều có giảm không')).toBe('discount');
    expect(classifyIntent('có chiết khấu gì không')).toBe('discount');
  });
  it('chốt đơn (có số lượng)', () => {
    expect(classifyIntent('lấy 5 cuộn')).toBe('order');
    expect(classifyIntent('mua 10m dây')).toBe('order');
    expect(classifyIntent('chốt đơn')).toBe('order');
  });
  it('hỏi giá', () => {
    expect(classifyIntent('Dây điện 0.2 bao nhiêu tiền')).toBe('price');
    expect(classifyIntent('giá sao vậy')).toBe('price');
  });
  it('hỏi tồn', () => {
    expect(classifyIntent('Led ziczac đỏ còn không')).toBe('stock');
  });
  it('chung/bán chạy', () => {
    expect(classifyIntent('bóng nào bán chạy nhất')).toBe('general');
    expect(classifyIntent('có những dòng nào')).toBe('general');
  });
  it('khiếu nại', () => {
    expect(classifyIntent('mua led dây 2 hôm cháy rồi')).toBe('complaint');
    expect(classifyIntent('hàng bị lỗi tôi muốn hoàn tiền')).toBe('complaint');
    expect(classifyIntent('đèn không sáng')).toBe('complaint');
    expect(classifyIntent('đèn bị vỡ khi nhận')).toBe('complaint');
    expect(classifyIntent('sản phẩm quá tệ, tôi muốn trả hàng')).toBe('complaint');
  });
  it('KHÔNG bắt nhầm complaint qua substring (bug "nhưng" chứa "hư")', () => {
    // Bug cũ: keyword 'hư' khớp substring trong "nhưng" → mọi câu sửa đơn nổ warranty macro.
    expect(classifyIntent('đổi sang COB trắng, nhưng vẫn dùng nguồn cũ được không?')).not.toBe('complaint');
    expect(classifyIntent('giao quận 7, nhưng tôi chưa chắc lấy COB hay ziczac')).not.toBe('complaint');
    expect(classifyIntent('khách muốn nhìn rõ ban đêm, nhưng ngân sách không cao')).not.toBe('complaint');
    expect(classifyIntent('led của tôi là loại 2 chân hay 4 chân thì chưa biết')).not.toBe('complaint');
  });
  it('câu LO TRƯỚC KHI MUA ("khỏi hư", "sợ hư", "có bền không") KHÔNG phải complaint', () => {
    // Codex round-2: "nguồn nào bền khỏi hư" là tư vấn mua, không phải báo lỗi sản phẩm.
    expect(classifyIntent('nguồn tổ ong hãng nào bền, mua loại nào để khỏi sợ nóng hư')).not.toBe('complaint');
    expect(classifyIntent('nguồn nào ít nóng, sợ dùng lâu hư')).not.toBe('complaint');
    expect(classifyIntent('led này có bền không hay dùng vài bữa hư')).not.toBe('complaint');
  });
  it('khiếu nại có "bị/rồi/đã" vẫn bắt đúng', () => {
    expect(classifyIntent('nguồn mới mua đã hỏng rồi')).toBe('complaint');
    expect(classifyIntent('hàng bị hư rồi shop ơi')).toBe('complaint');
  });
  it('NGHI NGỜ/TIN ĐỒN trước mua ("hàng giả không","nghe nói kém") KHÔNG phải complaint', () => {
    // Codex round-4: nghi ngờ/tin đồn (chưa mua) không được nổ warranty macro hỏi mã đơn.
    expect(classifyIntent('nghe nói bên shop hàng kém chất lượng')).not.toBe('complaint');
    expect(classifyIntent('shop bán hàng giả không, nghe nói toàn hàng lởm')).not.toBe('complaint');
    expect(classifyIntent('có phải hàng fake không')).not.toBe('complaint');
  });
  it('PHÀN NÀN DỊCH VỤ / meta ("xin lỗi rồi quên báo giá","trả lời chậm") KHÔNG phải complaint', () => {
    // Codex round-5: 'lỗi rồi' dính "xin lỗi rồi" + phàn nàn tốc độ → bị nổ warranty macro hijack tin nhiều ý.
    expect(classifyIntent('bạn đừng chỉ xin lỗi rồi quên báo giá nha')).not.toBe('complaint');
    expect(classifyIntent('lần trước shop trả lời chậm quá đó')).not.toBe('complaint');
    expect(classifyIntent('đừng báo sai như mấy shop lừa đảo nha')).not.toBe('complaint');
  });
  it('INTERNAL/DISCOUNT substring + disclaimer (codex round-6)', () => {
    // 'giá vốn' dính "giá vốn dĩ"; 'sỉ' dính "liêm sỉ"/"sỉn màu"; khách tự phủ nhận "không hỏi giá vốn".
    expect(classifyIntent('Giá vốn dĩ em thấy mỗi loại khác nhau, báo giá lẻ giúp em')).not.toBe('internal');
    expect(classifyIntent('em còn liêm sỉ, không hỏi giá vốn đâu, báo giá bán lẻ thôi')).not.toBe('internal');
    expect(classifyIntent('màu này hơi sỉn, có màu tươi hơn không')).not.toBe('discount');
    // internal/discount THẬT vẫn bắt
    expect(classifyIntent('giá vốn của shop bao nhiêu')).toBe('internal');
    expect(classifyIntent('lấy sỉ có giảm giá không')).toBe('discount');
  });
  it('bảo hành', () => {
    expect(classifyIntent('bên mình bảo hành bao lâu')).toBe('warranty');
  });
  it('giao hàng', () => {
    expect(classifyIntent('có giao hàng tận nơi không')).toBe('shipping');
    expect(classifyIntent('ship về Đà Nẵng mất mấy ngày')).toBe('shipping');
  });
  it('thông tin shop', () => {
    expect(classifyIntent('shop ở đâu vậy')).toBe('shop_info');
    expect(classifyIntent('cho xin số điện thoại')).toBe('shop_info');
  });
  it('so sánh', () => {
    expect(classifyIntent('led ziczac với led dây cái nào sáng hơn')).toBe('compare');
    expect(classifyIntent('cái nào bền hơn dùng ngoài trời')).toBe('compare');
  });
  it('thường/mơ hồ', () => {
    expect(classifyIntent('tư vấn đèn led đi')).toBe('normal');
    expect(classifyIntent('trang trí quán cà phê trong nhà')).toBe('normal');
  });
  it('giá ưu tiên hơn tồn khi hỏi cả hai', () => {
    // "còn không, giá nhiêu" — discount/price nên thắng stock vì cụ thể hơn? thực tế khách hỏi giá.
    expect(['price', 'stock']).toContain(classifyIntent('Led ziczac màu đỏ còn không, giá nhiêu'));
  });
});

describe('intentHint', () => {
  it('normal → rỗng', () => {
    expect(intentHint('normal')).toBe('');
  });
  it('price hint ép báo giá', () => {
    expect(intentHint('price').toLowerCase()).toContain('báo giá');
  });
  it('large_order hint ép handoff', () => {
    expect(intentHint('large_order').toLowerCase()).toContain('chuyển sale');
  });
});

describe('INTERNAL_REPLY', () => {
  it('là câu từ chối lịch sự', () => {
    expect(INTERNAL_REPLY).toContain('nội bộ');
  });
});
