// SPDX-License-Identifier: AGPL-3.0-or-later
// Thông báo chủ động (docs/78 C2) — luật THUẦN: kiểm cứng đích + ảnh chụp + payload bot (không DB).
import { describe, it, expect } from 'vitest';
import {
  docDich, docLuatVao, docAnhChup, danhMucTuAnh, kiemTheoDanhMuc, ghepLuatCongKhai, LoiLuatThongBao,
  type ComposerAnh,
} from '../src/modules/bot-quyen/bot-thong-bao-luat.js';

function loi(fn: () => unknown): { status: number; code: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof LoiLuatThongBao) return { status: e.status, code: e.code };
    throw e;
  }
  throw new Error('không ném');
}

const C = (id: string, kieu: ComposerAnh['kieu'], nhay_cam: string[] = []): ComposerAnh => ({
  id, ten: id, pha: 'chot', kieu, dich_goc: 'nhom_goc', nhay_cam, mo_ta_khi_nao: null, vi_du: null,
});
const DM = new Map([C('xuat_hoa_don_tool', 'ban_sao', ['tien']), C('the_don', 'khoa', ['gia']), C('chao', 'thuan')].map((c) => [c.id, c]));

describe('docDich', () => {
  it('nhom_goc KHÔNG BAO GIỜ là đích (gửi đôi) ⇒ 400 DICH_NHOM_GOC', () => {
    expect(loi(() => docDich([{ kieu: 'nhom_goc' }]))).toEqual({ status: 400, code: 'DICH_NHOM_GOC' });
  });
  it('kiểu lạ / chức năng lạ / nv rỗng / nguoi_gay_ra kèm giá trị ⇒ 400', () => {
    expect(loi(() => docDich([{ kieu: 'nhom', gia_tri: 'x' }])).code).toBe('DICH_KHONG_HOP_LE');
    expect(loi(() => docDich([{ kieu: 'chuc_nang', gia_tri: 'giam_doc' }])).code).toBe('DICH_KHONG_HOP_LE');
    expect(loi(() => docDich([{ kieu: 'nv', gia_tri: ' ' }])).code).toBe('DICH_KHONG_HOP_LE');
    expect(loi(() => docDich([{ kieu: 'nguoi_gay_ra', gia_tri: 'u1' }])).code).toBe('DICH_KHONG_HOP_LE');
    expect(loi(() => docDich('ke_toan')).code).toBe('DICH_KHONG_HOP_LE');
    expect(loi(() => docDich(Array.from({ length: 21 }, (_, i) => ({ kieu: 'nv', gia_tri: `u${i}` })))).code).toBe('DICH_KHONG_HOP_LE');
  });
  it('khử trùng + sắp xếp ổn định', () => {
    expect(docDich([
      { kieu: 'nv', gia_tri: 'u2' }, { kieu: 'chuc_nang', gia_tri: 'kho' }, { kieu: 'nguoi_gay_ra' }, { kieu: 'chuc_nang', gia_tri: 'kho' },
    ])).toEqual([
      { kieu: 'chuc_nang', gia_tri: 'kho' }, { kieu: 'nguoi_gay_ra', gia_tri: null }, { kieu: 'nv', gia_tri: 'u2' },
    ]);
  });
});

describe('docLuatVao', () => {
  it('cheDo/gomGiay/dieuKien/lich sai hình ⇒ 400', () => {
    expect(loi(() => docLuatVao({ cheDo: 'on' })).code).toBe('DU_LIEU_KHONG_HOP_LE');
    expect(loi(() => docLuatVao({ gomGiay: -1 })).code).toBe('DU_LIEU_KHONG_HOP_LE');
    expect(loi(() => docLuatVao({ gomGiay: 1.5 })).code).toBe('DU_LIEU_KHONG_HOP_LE');
    expect(loi(() => docLuatVao({ dieuKien: [] })).code).toBe('DU_LIEU_KHONG_HOP_LE');
    expect(loi(() => docLuatVao({ dieuKien: { x: 'y'.repeat(5000) } })).code).toBe('DU_LIEU_KHONG_HOP_LE');
    expect(docLuatVao({ lich: null })).toEqual({ lich: null });
  });
});

describe('kiemTheoDanhMuc — luật cứng', () => {
  it('chưa có ảnh chụp ⇒ 409 CHUA_CO_BAN_DO (mọi thay đổi định tuyến bị từ chối)', () => {
    expect(loi(() => kiemTheoDanhMuc('chao', [], null, new Set()))).toEqual({ status: 409, code: 'CHUA_CO_BAN_DO' });
  });
  it('composer lạ ⇒ 400 COMPOSER_LA; composer khoá ⇒ 400 COMPOSER_KHOA', () => {
    expect(loi(() => kiemTheoDanhMuc('khong_co', [], DM, new Set())).code).toBe('COMPOSER_LA');
    expect(loi(() => kiemTheoDanhMuc('the_don', [{ kieu: 'chuc_nang', gia_tri: 'kho' }], DM, new Set())).code).toBe('COMPOSER_KHOA');
  });
  it('nhóm KHÁCH cho composer có dữ liệu nhạy cảm ⇒ 400; composer không nhạy cảm ⇒ được', () => {
    expect(loi(() => kiemTheoDanhMuc('xuat_hoa_don_tool', [{ kieu: 'chuc_nang', gia_tri: 'khach' }], DM, new Set())).code)
      .toBe('LO_DU_LIEU_NHOM_KHACH');
    expect(kiemTheoDanhMuc('chao', [{ kieu: 'chuc_nang', gia_tri: 'khach' }], DM, new Set()).id).toBe('chao');
    expect(kiemTheoDanhMuc('xuat_hoa_don_tool', [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }], DM, new Set()).id).toBe('xuat_hoa_don_tool');
  });
  it('đích NV phải có trong danh sách NV của org', () => {
    expect(loi(() => kiemTheoDanhMuc('chao', [{ kieu: 'nv', gia_tri: 'u9' }], DM, new Set(['u1']))).code).toBe('NV_KHONG_CO');
    expect(kiemTheoDanhMuc('chao', [{ kieu: 'nv', gia_tri: 'u1' }], DM, new Set(['u1'])).id).toBe('chao');
  });
});

describe('docAnhChup', () => {
  const tot = { phien_ban: 'v1', composer: [{ id: 'chao', kieu: 'thuan', nhay_cam: ['gia', 'gia'], la: 'bỏ' }], dem: [{ composer: 'chao', so: 3 }] };
  it('chuẩn hoá: bỏ trường lạ, khử trùng nhay_cam', () => {
    const a = docAnhChup(tot);
    expect(a.composer[0]).toEqual({ id: 'chao', ten: null, pha: null, kieu: 'thuan', dich_goc: null, nhay_cam: ['gia'], mo_ta_khi_nao: null, vi_du: null });
    expect(a.dem).toEqual([{ composer: 'chao', so: 3 }]);
  });
  it('sai hình ⇒ 400 ANH_CHUP_KHONG_HOP_LE', () => {
    const sai = [
      null, { ...tot, phien_ban: '' }, { ...tot, composer: [] },
      { ...tot, composer: [{ id: 'Chao', kieu: 'thuan' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan' }, { id: 'a', kieu: 'khoa' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'bi_mat' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', nhay_cam: ['Giá'] }] },
      { ...tot, dem: [{ so: -1 }] }, { ...tot, dem: [{ composer: 'a' }] }, { ...tot, dem: [{ so: 1, x: { y: 1 } }] },
      { ...tot, dem: Array.from({ length: 5001 }, () => ({ so: 1 })) },
    ];
    for (const b of sai) expect(loi(() => docAnhChup(b)).code).toBe('ANH_CHUP_KHONG_HOP_LE');
  });
});

describe('ghepLuatCongKhai — payload bot', () => {
  const dong = (o: Partial<{ loai: string; dich: unknown; cheDo: string; phienBan: number }> = {}) => ({
    loai: 'xuat_hoa_don_tool', dich: [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }], cheDo: 'bat', dieuKien: {}, gomGiay: 0,
    lich: null, phienBan: 1, ...o,
  });
  it('phien_ban ổn định theo nội dung (thứ tự dòng không ảnh hưởng), đổi khi một ô đổi', () => {
    const a = ghepLuatCongKhai([dong(), dong({ loai: 'chao', dich: [] })], DM);
    const b = ghepLuatCongKhai([dong({ loai: 'chao', dich: [] }), dong()], DM);
    expect(a.phien_ban).toBe(b.phien_ban);
    expect(a.luat.map((l) => l.loai)).toEqual(['chao', 'xuat_hoa_don_tool']);
    expect(ghepLuatCongKhai([dong({ cheDo: 'bong' })], DM).phien_ban).not.toBe(ghepLuatCongKhai([dong()], DM).phien_ban);
  });
  it('áp lại luật cứng với ảnh chụp HIỆN TẠI: bỏ nhom_goc, bỏ nhóm khách nhạy cảm, bỏ luật composer khoá', () => {
    const r = ghepLuatCongKhai([
      dong({ dich: [{ kieu: 'nhom_goc' }, { kieu: 'chuc_nang', gia_tri: 'khach' }, { kieu: 'chuc_nang', gia_tri: 'ke_toan' }] }),
      dong({ loai: 'the_don' }),
    ], DM);
    expect(r.luat).toEqual([expect.objectContaining({ loai: 'xuat_hoa_don_tool', dich: [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }] })]);
    expect(r.canh_bao).toHaveLength(3);
  });
  it('danhMucTuAnh chịu được jsonb hỏng', () => {
    expect(danhMucTuAnh(null).size).toBe(0);
    expect(danhMucTuAnh([{ id: 'a', kieu: 'thuan', nhay_cam: [] }, 3]).size).toBe(1);
  });
});
