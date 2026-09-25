// SPDX-License-Identifier: AGPL-3.0-or-later
// HoaDonAnhClient.docTenKhach — đọc tên khách của hoá đơn để đặt tên file in
// "AI-<số HĐ>-<Ten_Khach>-<jobId>.pdf" (chủ chốt 24/09). Đi cùng phiên web với taiPdf.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { HoaDonAnhClient, HoaDonAnhError } from '../../../src/modules/ai/odoo/hoa-don-anh.js';

type TraLoi = { result?: unknown; error?: unknown };

function fetchGia(traLoiRead: TraLoi[]) {
  const goi: Array<{ url: string; body: any }> = [];
  let lanDangNhap = 0;
  const f = vi.fn(async (u: string, init?: RequestInit) => {
    if (u.includes('/web/session/authenticate')) {
      lanDangNhap += 1;
      return {
        json: async () => ({ result: { uid: 18 } }),
        headers: { getSetCookie: () => [`session_id=s${lanDangNhap}; Path=/`] },
      } as never;
    }
    goi.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
    const tl = traLoiRead.shift() ?? { result: [] };
    return { json: async () => tl } as never;
  });
  return { f, goi, soLanDangNhap: () => lanDangNhap };
}

describe('HoaDonAnhClient.docTenKhach', () => {
  afterEach(() => vi.unstubAllGlobals());
  const moi = () => new HoaDonAnhClient({ url: 'http://odoo', db: 'd', username: 'u', password: 'p' });

  it('đọc partner_id của account.move → trả tên hiển thị', async () => {
    const g = fetchGia([{ result: [{ id: 7001, partner_id: [1233, 'QC Bách Phát - Xã Đàn'] }] }]);
    vi.stubGlobal('fetch', g.f);
    expect(await moi().docTenKhach('account.move', 7001)).toBe('QC Bách Phát - Xã Đàn');
    expect(g.goi[0].url).toBe('http://odoo/web/dataset/call_kw/account.move/read');
    expect(g.goi[0].body.params).toMatchObject({ model: 'account.move', method: 'read', args: [[7001], ['partner_id']] });
  });

  it('chứng từ không có khách (partner_id=false) → null', async () => {
    const g = fetchGia([{ result: [{ id: 1, partner_id: false }] }]);
    vi.stubGlobal('fetch', g.f);
    expect(await moi().docTenKhach('account.move', 1)).toBeNull();
  });

  it('phiên hết hạn → đăng nhập lại MỘT lần rồi đọc được', async () => {
    const g = fetchGia([
      { error: { message: 'Session Expired', data: { name: 'odoo.http.SessionExpiredException' } } },
      { result: [{ id: 2, partner_id: [5, 'Chị Muội'] }] },
    ]);
    vi.stubGlobal('fetch', g.f);
    expect(await moi().docTenKhach('account.move', 2)).toBe('Chị Muội');
    expect(g.soLanDangNhap()).toBe(2);
  });

  it('Odoo trả lỗi khác → ném HoaDonAnhError (cron nuốt, in vẫn chạy với "Khong_ro")', async () => {
    const g = fetchGia([{ error: { message: 'AccessError', data: { name: 'odoo.exceptions.AccessError' } } }]);
    vi.stubGlobal('fetch', g.f);
    await expect(moi().docTenKhach('account.move', 3)).rejects.toBeInstanceOf(HoaDonAnhError);
  });
});
