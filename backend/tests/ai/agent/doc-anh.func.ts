// SPDX-License-Identifier: AGPL-3.0-or-later
// ĐỌC ẢNH — bot nhìn được ảnh rồi lấy thông tin xử lý như một câu chữ.
//
// Anh Quốc 10/08: "làm bot đọc được ảnh". Và khi tôi tự thu hẹp thành "ảnh
// chuyển khoản", anh chỉnh: "ai nói bạn là đọc ảnh chuyển khoản????, chỉ đọc
// ảnh rồi lấy thông tin xử lý thôi" — tức MỌI loại ảnh: ảnh sản phẩm, ảnh
// danh sách hàng, ảnh viết tay, ảnh biên lai. Đọc xong đưa vào luồng bình
// thường, không phân loại trước.
//
// Đo thật trên prod 10/08: model prod deepseek-v4-flash KHÔNG nhìn được ảnh
// (OpenRouter 404 "No endpoints found that support image input") → phải dùng
// model riêng cho ảnh. A/B 9 model trên ảnh biên lai: gpt-4.1-mini 4/4 đúng
// (2,8s), gemini-2.5-flash-lite 4/4, qwen3-vl 4/4, mistral-small 4/4; các con
// :free đọc SAI hết (0/4). Chi phí con đắt nhất ~778đ/tháng ở 5 ảnh/ngày.
import { describe, it, expect } from 'vitest';
import { bocUrlAnh, laLoaiDocDuoc, loiDanDocAnh } from '../../../src/modules/ai/agent/noi-zalo/doc-anh.js';

describe('bocUrlAnh — lấy URL ảnh từ content Zalo lưu trong DB', () => {
  it('content JSON có href (dạng thật zca-js lưu)', () => {
    const c = JSON.stringify({
      title: '@Tiểu Mã Nelia tao sẽ rút hết tiền',
      description: '',
      href: 'http://100.107.48.28:3080/files/media/abc123.jpg',
      thumb: 'http://100.107.48.28:3080/files/media/abc123.jpg',
    });
    expect(bocUrlAnh(c)).toBe('http://100.107.48.28:3080/files/media/abc123.jpg');
  });

  it('không có href → dùng thumb', () => {
    const c = JSON.stringify({ title: 'x', thumb: 'http://s/t.jpg' });
    expect(bocUrlAnh(c)).toBe('http://s/t.jpg');
  });

  it('content là URL trần', () => {
    expect(bocUrlAnh('https://s/anh.png')).toBe('https://s/anh.png');
  });

  it('JSON hỏng / rỗng / không phải ảnh → null, KHÔNG ném lỗi', () => {
    expect(bocUrlAnh('{hỏng')).toBeNull();
    expect(bocUrlAnh('')).toBeNull();
    expect(bocUrlAnh(JSON.stringify({ title: 'không có link' }))).toBeNull();
  });

  it('title trong JSON KHÔNG bị nhầm thành URL', () => {
    // Bug dễ mắc: title chứa chữ "http" trong câu nói của khách.
    const c = JSON.stringify({ title: 'xem http này nhé', href: 'https://s/that.jpg' });
    expect(bocUrlAnh(c)).toBe('https://s/that.jpg');
  });
});

describe('laLoaiDocDuoc — loại nào đáng gửi cho model nhìn', () => {
  it('ảnh thì đọc', () => {
    expect(laLoaiDocDuoc('image')).toBe(true);
    expect(laLoaiDocDuoc('photo')).toBe(true);
  });

  it('sticker/gif KHÔNG đọc — tốn tiền mà chẳng có thông tin gì', () => {
    expect(laLoaiDocDuoc('sticker')).toBe(false);
    expect(laLoaiDocDuoc('gif')).toBe(false);
  });

  it('voice/video/file chưa đọc được — giữ đường báo nhân viên như cũ', () => {
    expect(laLoaiDocDuoc('voice')).toBe(false);
    expect(laLoaiDocDuoc('video')).toBe(false);
    expect(laLoaiDocDuoc('file')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LỜI DẶN ĐỌC ẢNH — ca thật 23:22 11/08.
//
// Ảnh trong ca đó là DANH SÁCH HÀNG (tên + số lượng từng dòng), không phải biên
// lai. Lời dặn cũ chỉ nói "Nếu là danh sách/đơn viết tay: chép lại từng dòng" —
// đúng ý nhưng KHÔNG nói rõ phải giữ SỐ LƯỢNG đi kèm từng dòng.
//
// Đo thật trên CHÍNH ảnh đó (gpt-4.1-mini, prod 11/08):
//   lời dặn CŨ  → "P10 full out: 10.000 tấm / P5 full out: 1460 tấm 242 thùng"
//                 dính liền, vài dòng đầu mất số lượng riêng
//   lời dặn MỚI → "P10 full out: 10.000 tấm" và "P5 full out: 1460 tấm"
//                 tách đúng từng dòng, đủ tên + số lượng
// Model mô tả chung chung thì máy gom đơn không trích được số lượng nào, và bot
// quay ra hỏi "Anh/chị nhập những hàng gì ạ?" cho thứ đã có sẵn trong ảnh.
describe('loiDanDocAnh — ảnh DANH SÁCH HÀNG phải ra đủ tên + số lượng', () => {
  it('dặn rõ mỗi dòng phải có TÊN HÀNG kèm SỐ LƯỢNG', () => {
    const dan = loiDanDocAnh('');
    expect(dan).toMatch(/số lượng/i);
    expect(dan).toMatch(/danh sách/i);
  });

  it('CẤM tóm tắt/gộp dòng — máy gom đơn cần từng dòng một', () => {
    const dan = loiDanDocAnh('');
    expect(dan).toMatch(/tóm tắt|gộp|bỏ sót/i);
  });

  it('vẫn giữ luật cũ: số chép NGUYÊN VĂN, không làm tròn', () => {
    const dan = loiDanDocAnh('');
    expect(dan).toMatch(/NGUYÊN VĂN/);
    expect(dan).toMatch(/5\.400\.000/);
  });

  it('lời nhắn kèm ảnh được nhét vào lời dặn (ngữ cảnh cho model)', () => {
    const dan = loiDanDocAnh('tạo phiếu nhập hàng giúp tôi');
    expect(dan).toContain('tạo phiếu nhập hàng giúp tôi');
  });
});
