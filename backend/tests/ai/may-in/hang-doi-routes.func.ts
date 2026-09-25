// SPDX-License-Identifier: AGPL-3.0-or-later
// REST hàng đợi in (print-agent-routes.ts): GET /hang-doi, POST /hang-doi/huy,
// POST /hang-doi/bo-theo-doi — CHỈ owner/admin (403 CHI_ADMIN như /nhat-ky), `ids` 1..50,
// org LUÔN từ phiên, nguồn nhật ký "ZaloCRM (<tên người dùng>)".
import { describe, it, expect, vi } from 'vitest';
import { traHangDoi, traHuyLenhIn, traBoTheoDoi, docIds } from '../../../src/modules/ai/may-in/print-agent-routes.js';
import type { DichVuHangDoi } from '../../../src/modules/ai/may-in/huy-lenh-in.js';

function dichVuGia() {
  return {
    layHangDoi: vi.fn(async () => ({ choIn: [], chuaXacNhan: [], capNhat: '2026-09-25T12:00:00.000Z' })),
    huyLenhIn: vi.fn(async (_pv, ids: string[]) => ids.map((id) => ({ id, soHoaDon: null, ok: true, trangThaiMoi: 'da_huy', cach: 'chua_gui', noiDung: 'x' }))),
    boTheoDoi: vi.fn(async (_pv, ids: string[]) => ids.map((id) => ({ id, ok: true, noiDung: 'y' }))),
  } satisfies DichVuHangDoi;
}

const ADMIN = { id: 'u1', email: 'hoa@shop.vn', orgId: 'o1', role: 'admin' };

describe('docIds — {ids: 1..50 mã lệnh in}', () => {
  it('hợp lệ / sai dạng', () => {
    expect(docIds({ ids: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(docIds({ ids: [] })).toBeNull();
    expect(docIds({ ids: Array.from({ length: 51 }, (_, i) => `id${i}`) })).toBeNull();
    expect(docIds({ ids: Array.from({ length: 50 }, (_, i) => `id${i}`) })).toHaveLength(50);
    expect(docIds({ ids: ['a', 42] })).toBeNull();
    expect(docIds({ ids: ['', 'a'] })).toBeNull();
    expect(docIds({ ids: ['x'.repeat(65)] })).toBeNull();
    expect(docIds({ ids: 'a' })).toBeNull();
    expect(docIds(null)).toBeNull();
  });
});

describe('GET /hang-doi (traHangDoi)', () => {
  it('member → 403 CHI_ADMIN; admin → org từ phiên (không từ query), mayInId chuyển tiếp', async () => {
    const dv = dichVuGia();
    expect(await traHangDoi({ ...ADMIN, role: 'member' }, {}, { dichVu: dv })).toEqual({ code: 403, body: { error: 'CHI_ADMIN' } });
    expect(dv.layHangDoi).not.toHaveBeenCalled();
    const kq = await traHangDoi({ ...ADMIN, role: 'owner' }, { orgId: 'oKhac', mayInId: 'mayHCM' }, { dichVu: dv });
    expect(kq.code).toBe(200);
    expect(kq.body).toEqual({ choIn: [], chuaXacNhan: [], capNhat: '2026-09-25T12:00:00.000Z' });
    expect(dv.layHangDoi).toHaveBeenCalledWith({ loai: 'org', orgId: 'o1' }, { mayInId: 'mayHCM' });
    await traHangDoi(ADMIN, {}, { dichVu: dv });
    expect(dv.layHangDoi).toHaveBeenLastCalledWith({ loai: 'org', orgId: 'o1' }, { mayInId: null });
  });
});

describe('POST /hang-doi/huy (traHuyLenhIn)', () => {
  it('member → 403; ids sai → 400 THAM_SO_SAI; không gọi dịch vụ', async () => {
    const dv = dichVuGia();
    expect((await traHuyLenhIn({ ...ADMIN, role: 'member' }, { ids: ['a'] }, { dichVu: dv })).code).toBe(403);
    const sai = await traHuyLenhIn(ADMIN, { ids: [] }, { dichVu: dv });
    expect(sai).toMatchObject({ code: 400, body: { error: 'THAM_SO_SAI' } });
    expect(dv.huyLenhIn).not.toHaveBeenCalled();
  });

  it('org từ phiên; nguồn = tên người dùng (tra DB); trả {ketQua} đúng thứ tự', async () => {
    const dv = dichVuGia();
    const kq = await traHuyLenhIn({ ...ADMIN, orgId: 'o1' }, { ids: ['b', 'a'], orgId: 'oKhac' }, {
      dichVu: dv, layTenNguoiDung: async (id) => (id === 'u1' ? 'Chị Hoa' : null),
    });
    expect(kq.code).toBe(200);
    expect((kq.body as { ketQua: Array<{ id: string }> }).ketQua.map((k) => k.id)).toEqual(['b', 'a']);
    expect(dv.huyLenhIn).toHaveBeenCalledWith({ loai: 'org', orgId: 'o1' }, ['b', 'a'], { loai: 'crm', ten: 'Chị Hoa' });
  });

  it('tra tên lỗi / không có tên → rơi về email, vẫn huỷ', async () => {
    const dv = dichVuGia();
    await traHuyLenhIn(ADMIN, { ids: ['a'] }, { dichVu: dv, layTenNguoiDung: async () => { throw new Error('db'); } });
    expect(dv.huyLenhIn).toHaveBeenLastCalledWith(expect.anything(), ['a'], { loai: 'crm', ten: 'hoa@shop.vn' });
    await traHuyLenhIn(ADMIN, { ids: ['a'] }, { dichVu: dv, layTenNguoiDung: async () => null });
    expect(dv.huyLenhIn).toHaveBeenLastCalledWith(expect.anything(), ['a'], { loai: 'crm', ten: 'hoa@shop.vn' });
  });

  it('dịch vụ lỗi (DB) → NÉM (Fastify 500) — không bịa kết quả', async () => {
    const dv = dichVuGia();
    dv.huyLenhIn.mockRejectedValueOnce(new Error('db down'));
    await expect(traHuyLenhIn(ADMIN, { ids: ['a'] }, { dichVu: dv, layTenNguoiDung: async () => 'X' })).rejects.toThrow('db down');
  });
});

describe('POST /hang-doi/bo-theo-doi (traBoTheoDoi)', () => {
  it('member → 403; ids sai → 400; admin → {ketQua} với nguồn ZaloCRM', async () => {
    const dv = dichVuGia();
    expect((await traBoTheoDoi({ ...ADMIN, role: 'member' }, { ids: ['a'] }, { dichVu: dv })).code).toBe(403);
    expect((await traBoTheoDoi(ADMIN, {}, { dichVu: dv })).code).toBe(400);
    const kq = await traBoTheoDoi(ADMIN, { ids: ['k1'] }, { dichVu: dv, layTenNguoiDung: async () => 'Anh Quốc' });
    expect(kq).toEqual({ code: 200, body: { ketQua: [{ id: 'k1', ok: true, noiDung: 'y' }] } });
    expect(dv.boTheoDoi).toHaveBeenCalledWith({ loai: 'org', orgId: 'o1' }, ['k1'], { loai: 'crm', ten: 'Anh Quốc' });
  });
});
