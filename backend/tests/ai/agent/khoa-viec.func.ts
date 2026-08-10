// SPDX-License-Identifier: AGPL-3.0-or-later
// KHOÁ VIỆC — chặn hai lượt cùng xử lý MỘT câu lệnh.
//
// Bug thật 21:34:22-24 10/08 (nhóm), do chính bản "tag trống nuốt tin trước"
// của tôi gây ra:
//   21:34:23.637  tin "lên đơn cho anh Thức" TỰ chạy (nhóm này không bắt tag)
//   21:34:24.674  tag trống chạy, nuốt LẠI đúng câu đó → chạy lần hai
//   21:34:26 + :28  bot trả lời HAI LẦN cùng nội dung
//
// Vì sao bảo vệ cũ không cứu: nó nhìn "bot đã trả lời chưa" trong lịch sử, mà
// lúc 21:34:24 bot CÒN ĐANG xử lý — chưa có tin nào để thấy. Hai lượt cách
// nhau 1 giây, chạy song song.
//
// Cần khoá đặt NGAY KHI BẮT ĐẦU, nguyên tử, theo nội dung việc.
import { describe, it, expect, beforeEach } from 'vitest';
import { thuGiuViec, _resetKhoaViecChoTest } from '../../../src/modules/ai/agent/noi-zalo/khoa-viec.js';

beforeEach(() => { _resetKhoaViecChoTest(); });

describe('thuGiuViec — chỉ một lượt được chạy', () => {
  it('lượt đầu giữ được việc', async () => {
    expect(await thuGiuViec('c1', 'lên đơn cho anh Thức')).toBe(true);
  });

  it('lượt hai CÙNG nội dung, cùng hội thoại → bị chặn (ca 21:34)', async () => {
    await thuGiuViec('c1', 'lên đơn cho anh Thức');
    expect(await thuGiuViec('c1', 'lên đơn cho anh Thức')).toBe(false);
  });

  it('nội dung KHÁC → không chặn nhau', async () => {
    await thuGiuViec('c1', 'lên đơn cho anh Thức');
    expect(await thuGiuViec('c1', 'xuất công nợ anh Vấn')).toBe(true);
  });

  it('hội thoại KHÁC → không chặn nhau (hai nhóm cùng lên đơn giống hệt)', async () => {
    await thuGiuViec('c1', 'lên đơn cho anh Thức');
    expect(await thuGiuViec('c2', 'lên đơn cho anh Thức')).toBe(true);
  });

  it('khác hoa/thường và khoảng trắng thừa vẫn tính là MỘT việc', async () => {
    await thuGiuViec('c1', 'Lên Đơn cho anh Thức');
    expect(await thuGiuViec('c1', 'lên đơn   cho anh thức  ')).toBe(false);
  });

  it('nội dung rỗng → luôn cho qua, không tự khoá mình', async () => {
    expect(await thuGiuViec('c1', '')).toBe(true);
    expect(await thuGiuViec('c1', '   ')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Trên PROD có Redis, ở test thì không — hai đường code khác nhau. Ca dưới ép
// chạy đúng nhánh Redis bằng client giả, vì đó mới là nhánh chạy thật.
describe('nhánh Redis (đường chạy trên prod)', () => {
  it('dùng SET NX EX — chỉ lượt đầu nhận "OK"', async () => {
    const goi: unknown[][] = [];
    const redisGia = {
      set: async (...a: unknown[]) => { goi.push(a); return goi.length === 1 ? 'OK' : null; },
    } as never;
    const lay = (async () => redisGia) as never;

    expect(await thuGiuViec('cR', 'lên đơn cho anh Thức', lay)).toBe(true);
    expect(await thuGiuViec('cR', 'lên đơn cho anh Thức', lay)).toBe(false);
    // Đúng cú pháp nguyên tử: SET key val EX <giây> NX
    expect(goi[0].slice(2)).toEqual(['EX', 100, 'NX']);
  });

  it('Redis NÉM lỗi → KHÔNG nuốt lệnh, rơi xuống khoá bộ nhớ', async () => {
    const lay = (async () => { throw new Error('redis chết'); }) as never;
    // Thà trả lời hai lần còn hơn im lặng nuốt lệnh của nhân viên.
    expect(await thuGiuViec('cErr', 'xuất công nợ anh Vấn', lay)).toBe(true);
  });

  it('Redis trả null (khoá đã có) → chặn, không tự ý chạy', async () => {
    const lay = (async () => ({ set: async () => null })) as never;
    expect(await thuGiuViec('cN', 'lên đơn cho anh Thức', lay)).toBe(false);
  });
});
