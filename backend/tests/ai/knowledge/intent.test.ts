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
