// SPDX-License-Identifier: AGPL-3.0-or-later
// Lỗi API của trang Quyền bot: 4xx hiện NGUYÊN câu `error` của backend; 5xx/401 interceptor chung đã báo.
import { describe, it, expect } from 'vitest';
import { loiApi } from './bot-quyen-loi';

const loi = (status: number, data: unknown) => ({ response: { status, data } });

describe('loiApi', () => {
  it('4xx có error ⇒ câu backend + mã', () => {
    expect(loiApi(loi(409, { error: 'Đây là admin đang hoạt động cuối cùng — phải luôn còn ít nhất một admin', code: 'ADMIN_CUOI' }), 'Lưu thất bại'))
      .toEqual({ chu: 'Đây là admin đang hoạt động cuối cùng — phải luôn còn ít nhất một admin', ma: 'ADMIN_CUOI', status: 409, daBao: false });
    expect(loiApi(loi(403, { error: 'Chỉ owner/admin được quản lý quyền bot', code: 'CHI_ADMIN' }), 'x').chu)
      .toBe('Chỉ owner/admin được quản lý quyền bot');
  });
  it('4xx không có error ⇒ câu mặc định', () => {
    expect(loiApi(loi(400, {}), 'Lưu thất bại')).toMatchObject({ chu: 'Lưu thất bại', ma: null, daBao: false });
  });
  it('5xx ⇒ interceptor chung đã toast — không toast lần hai', () => {
    expect(loiApi(loi(500, { error: 'Internal Server Error' }), 'Lưu thất bại')).toMatchObject({
      chu: 'Máy chủ lỗi, vui lòng thử lại', daBao: true,
    });
  });
  it('401 ⇒ đã chuyển về đăng nhập — không toast', () => {
    expect(loiApi(loi(401, {}), 'x').daBao).toBe(true);
  });
  it('không có phản hồi (mất mạng) ⇒ câu kết nối', () => {
    expect(loiApi(new Error('Network Error'), 'x')).toMatchObject({
      chu: 'Không kết nối được máy chủ — thử lại.', status: null, daBao: false,
    });
  });
});
