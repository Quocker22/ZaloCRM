// SPDX-License-Identifier: AGPL-3.0-or-later
// Ảnh SP theo URL từ sheet — kế thừa NGUYÊN bộ luật an toàn của product-image:
// câu liệt kê không gửi, model-code phải khớp, nhiều SP cùng khớp thì im.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  timAnhSanPhamTheoReply, resetCacheAnhSp, duongDanCacheAnh,
} from '../../../src/modules/ai/knowledge/anh-san-pham.js';

const DS = [
  { ten: 'Nguồn NB Ngoài Trời 12V100W (cái)', urls: ['https://x.com/nb100-1.jpg', 'https://x.com/nb100-2.jpg'] },
  { ten: 'Nguồn NB Ngoài Trời 12V200W (cái)', urls: ['https://x.com/nb200.jpg'] },
  { ten: 'Led 3 bóng 7 màu RGB chip 5050', urls: ['https://x.com/5050-1.jpg', 'https://x.com/5050-2.jpg', 'https://x.com/5050-3.jpg', 'https://x.com/5050-4.jpg'] },
  { ten: 'Card BX-Y1A', urls: ['https://x.com/y1a.jpg'] },
];

function fakeDb(rows = DS) {
  return {
    anhSanPham: {
      findMany: vi.fn(async () => rows.map((r, i) => ({ id: String(i), orgId: 'o1', ten: r.ten, urls: r.urls }))),
    },
  };
}

beforeEach(() => resetCacheAnhSp());

describe('timAnhSanPhamTheoReply — luật an toàn gửi ảnh chủ động', () => {
  it('reply nhắc đúng 1 SP có code → trả urls của SP đó (tối đa 3)', async () => {
    const urls = await timAnhSanPhamTheoReply(fakeDb() as never, 'o1',
      'Nguồn NB ngoài trời 12V100W giá 78.000đ, còn hàng anh nhé');
    expect(urls).toEqual(['https://x.com/nb100-1.jpg', 'https://x.com/nb100-2.jpg']);
  });

  it('SP nhiều hơn 3 ảnh → cắt còn 3 (không dội bom khách)', async () => {
    const urls = await timAnhSanPhamTheoReply(fakeDb() as never, 'o1',
      'Led 3 bóng 7 màu RGB chip 5050 dùng điện 12V ạ');
    expect(urls).toHaveLength(3);
  });

  it('reply nói 12V100W thì KHÔNG được trả ảnh 12V200W (model-code phải khớp)', async () => {
    const urls = await timAnhSanPhamTheoReply(fakeDb() as never, 'o1',
      'Nguồn NB ngoài trời 12V100W ạ');
    expect(urls.join()).not.toContain('nb200');
  });

  it('câu LIỆT KÊ nhiều gạch đầu dòng → không gửi ảnh', async () => {
    const urls = await timAnhSanPhamTheoReply(fakeDb() as never, 'o1',
      '- Nguồn NB Ngoài Trời 12V100W\n- Nguồn NB Ngoài Trời 12V200W\n- Card BX-Y1A\nanh chọn loại nào ạ?');
    expect(urls).toEqual([]);
  });

  it('reply không nhắc SP nào → rỗng', async () => {
    expect(await timAnhSanPhamTheoReply(fakeDb() as never, 'o1', 'Dạ em chào anh ạ')).toEqual([]);
  });

  it('cache: 2 lượt liền chỉ query DB 1 lần', async () => {
    const db = fakeDb();
    await timAnhSanPhamTheoReply(db as never, 'o1', 'Card BX-Y1A còn hàng');
    await timAnhSanPhamTheoReply(db as never, 'o1', 'Card BX-Y1A giá tốt');
    expect(db.anhSanPham.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('duongDanCacheAnh — tải ảnh về đâu', () => {
  it('cùng URL → cùng đường dẫn (cache theo hash), giữ đuôi file', () => {
    const a = duongDanCacheAnh('https://x.com/nb100-1.jpg');
    expect(a).toBe(duongDanCacheAnh('https://x.com/nb100-1.jpg'));
    expect(a.endsWith('.jpg')).toBe(true);
    expect(a).not.toBe(duongDanCacheAnh('https://x.com/nb100-2.jpg'));
  });
});
