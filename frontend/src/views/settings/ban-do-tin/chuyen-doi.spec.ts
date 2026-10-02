// SPDX-License-Identifier: AGPL-3.0-or-later
// Hợp đồng (docs/may-in/HOP-DONG-BAN-DO-TIN.md) → dữ liệu trình bày: mã pha/đích lạ, đích luật → hàng, số đếm gộp,
// "24h sẽ gửi N" = tổng bong/24h của luật, đổi một hàng không làm mất đích NV.
import { describe, it, expect } from 'vitest';
import {
  bong24hCuaLuat, crmTuApi, doiHangTrongDich, dungAnhChup, gopDem, hangNguon, hangTuDichLuat, hangTuMaDich, luatTuApi,
} from './chuyen-doi';
import type { BanDoApi, DemApi, LuatApi } from './hop-dong';

const BAN_DO: BanDoApi = {
  phienBan: 'a1b2c3d4e5f60718',
  luc: '2026-10-02T03:00:00.000Z',
  composer: [
    { id: 'xuat_hoa_don_tool', kieu: 'ban_sao', nhay_cam: ['tien'], ten: 'Xuất hoá đơn', pha: 'xuat_hd', de_xuat: false,
      dich_goc: ['nhom_goc'], khi_nao: 'Khi xuất', vi_du: 'Đã xuất', nguon_cau: 'a.py:1', ghi_chu: null,
      dan_toi: [{ den: 'in_sau_chot', kieu: 'nghiep_vu', vi_sao: 'in tiếp' }] },
    { id: 'in_sau_chot', kieu: 'ban_sao', nhay_cam: [], ten: null, pha: 'pha_moi_chua_co', de_xuat: true,
      dich_goc: ['g_kho', 'kenh_la'], khi_nao: null, vi_du: null, nguon_cau: null, ghi_chu: null, dan_toi: [] },
    { id: 'the_don', kieu: 'khoa', nhay_cam: ['gia'], ten: 'Thẻ đơn', pha: 'len_don', de_xuat: false, dich_goc: [],
      khi_nao: null, vi_du: null, nguon_cau: null, ghi_chu: null, dan_toi: [{ den: 'nguon_may_in', kieu: 'chan' }] },
  ],
  nguon: [
    { id: 'nguon_may_in', ten: 'Máy in', pha: 'in', mo_ta: null, dan_toi: [{ den: 'in_sau_chot', kieu: 'su_kien' }] },
    { id: 'nguon_zalo_oa', ten: null, pha: null, mo_ta: null, dan_toi: [] },
  ],
  dem: [
    { khoa_canh: 'xuat_hoa_don_tool→nhom_goc|goc', composer: 'xuat_hoa_don_tool', dich_kieu: 'nhom_goc', luat_id: null, ket_qua: 'da_gui', cua_so: '7d', so: 12 },
    { khoa_canh: 'xuat_hoa_don_tool→g_ketoan|L1', composer: 'xuat_hoa_don_tool', dich_kieu: 'g_ketoan', luat_id: 'L1', ket_qua: 'bong', cua_so: '24h', so: 3 },
    { khoa_canh: 'xuat_hoa_don_tool→g_ketoan|L1', composer: 'xuat_hoa_don_tool', dich_kieu: 'g_ketoan', luat_id: 'L1', ket_qua: 'bong', cua_so: '7d', so: 9 },
    { khoa_canh: 'xuat_hoa_don_tool→nv|L1', composer: 'xuat_hoa_don_tool', dich_kieu: 'nv', luat_id: 'L1', ket_qua: 'bong', cua_so: '24h', so: 2 },
    { khoa_canh: 'xuat_hoa_don_tool→nv|L1', composer: 'xuat_hoa_don_tool', dich_kieu: 'nv', luat_id: 'L1', ket_qua: 'chan_tam_im', cua_so: '24h', so: 5 },
    { khoa_canh: 'chua_khai→la|goc', composer: 'chua_khai', dich_kieu: 'khong_biet', luat_id: null, ket_qua: 'loi', cua_so: '7d', so: 1 },
  ],
};
const LUAT: LuatApi = {
  id: 'L1', loai: 'xuat_hoa_don_tool', cheDo: 'bong', dieuKien: {}, gomGiay: 0, lich: null, phienBan: 4, suaBoi: 'u', suaLuc: '2026-10-02T03:00:00.000Z',
  dich: [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }, { kieu: 'nv', gia_tri: 'uid-1' }, { kieu: 'nguoi_gay_ra', gia_tri: null }],
};

describe('chuyen-doi', () => {
  it('mã đích: của bot, của CRM (chức năng / nguoi_gay_ra), lạ ⇒ null', () => {
    expect(hangTuMaDich('g_kho')).toBe('g_kho');
    expect(hangTuMaDich('ke_toan')).toBe('g_ketoan');
    expect(hangTuMaDich('nguoi_gay_ra')).toBe('dm_nguoi_go');
    expect(hangTuMaDich('kenh_la')).toBeNull();
    expect(hangTuDichLuat({ kieu: 'nv', gia_tri: 'x' })).toBe('nv');
    expect(hangNguon('nguon_may_in')).toBe('n_may_in');
    expect(hangNguon('nguon_odoo')).toBe('n_odoo');
    expect(hangNguon('nguon_lich')).toBe('n_lich');
    expect(hangNguon('nguon_zalo_oa')).toBe('n_khac');
  });

  it('composer: tên/pha lạ, đích gốc lạ + rỗng, giữ đủ trường hợp đồng', () => {
    const a = dungAnhChup({ banDo: BAN_DO, luat: { luat: [LUAT], banDo: null, canhBao: ['cb'] }, crm: null });
    const [x, y, z] = a.composer;
    expect(x).toMatchObject({ id: 'xuat_hoa_don_tool', pha: 'xuat_hd', dich_goc: ['nhom_goc'], nhay_cam: ['tien'], khi_nao: 'Khi xuất',
      dan_toi: [{ den: 'in_sau_chot', kieu: 'nghiep_vu', vi_sao: 'in tiếp' }] });
    expect(y).toMatchObject({ ten: 'in_sau_chot', pha: 'he_thong', pha_la: 'pha_moi_chua_co', dich_goc: ['g_kho'], dich_goc_la: ['kenh_la'], de_xuat: true, khi_nao: '' });
    expect(z.dich_goc).toEqual(['nhom_goc']);
    expect(a.nguon.map((n) => [n.id, n.hang, n.ten])).toEqual([['nguon_may_in', 'n_may_in', 'Máy in'], ['nguon_zalo_oa', 'n_khac', 'nguon_zalo_oa']]);
    expect(a).toMatchObject({ phien_ban: 'a1b2c3d4e5f60718', luc: '2026-10-02T03:00:00.000Z', canh_bao: ['cb'], mau: false, crm: [], loi_crm: null });
    expect(a.dem_tho).toHaveLength(6);
  });

  it('luật: hàng bản sao + giữ dich_tho (zalo_uid) để sửa', () => {
    const l = luatTuApi(LUAT);
    expect(l).toMatchObject({ id: 'L1', dich: ['g_ketoan', 'nv', 'dm_nguoi_go'], che_do: 'bong', phien_ban: 4 });
    expect(l.dich_tho).toEqual(LUAT.dich);
  });

  it('số đếm: gộp theo khối (gui:) và phần qua luật (luat:), bỏ đích lạ', () => {
    const d = Object.fromEntries(gopDem(BAN_DO.dem).map((x) => [x.canh_id, x]));
    expect(d['gui:xuat_hoa_don_tool@nhom_goc'].d7.da_gui).toBe(12);
    expect(d['luat:xuat_hoa_don_tool@nhom_goc']).toBeUndefined();
    expect(d['luat:xuat_hoa_don_tool@g_ketoan']).toMatchObject({ d7: { bong: 9 }, h24: { bong: 3 } });
    expect(d['gui:xuat_hoa_don_tool@nv'].h24).toMatchObject({ bong: 2, chan_tam_im: 5 });
    expect(Object.keys(d).some((k) => k.includes('chua_khai'))).toBe(false);
  });

  it('"24h sẽ gửi N" = tổng bong/24h của các dòng mang luat_id', () => {
    expect(bong24hCuaLuat(BAN_DO.dem as DemApi[], 'L1')).toEqual({ co: true, so: 5 });
    expect(bong24hCuaLuat(BAN_DO.dem as DemApi[], 'L9')).toEqual({ co: false, so: 0 });
  });

  it('bật/tắt một hàng giữ nguyên mọi đích khác (kể cả đích NV)', () => {
    const them = doiHangTrongDich(LUAT.dich, 'g_kho', true);
    expect(them).toEqual([...LUAT.dich, { kieu: 'chuc_nang', gia_tri: 'kho' }]);
    expect(doiHangTrongDich(them, 'g_ketoan', false)).toEqual([LUAT.dich[1], LUAT.dich[2], { kieu: 'chuc_nang', gia_tri: 'kho' }]);
    expect(doiHangTrongDich(LUAT.dich, 'dm_nguoi_go', false)).toEqual(LUAT.dich.slice(0, 2));
    expect(doiHangTrongDich([], 'nv', true)).toEqual([]); // nv cần zalo_uid — thêm qua ô chọn NV
  });

  it('CRM tự động: loai_dich → hàng, cạnh kiểu crm, giữ bản gốc', () => {
    const n = crmTuApi({ id: 'crm_su_kien_in', ten: 'Máy in', pha: 'in', loai_dich: 'bot', bat: true, ly_do_tat: null, khi_nao: 'k',
      nguon_ma: 'm', chinh_o: null, dich: [], ghi_chu: null, dan_toi: [{ den: 'nguon_may_in', vi_sao: 'v' }] });
    expect(n).toMatchObject({ hang: 'crm_bot', pha: 'in', mo_ta: 'k', dan_toi: [{ den: 'nguon_may_in', kieu: 'crm', vi_sao: 'v' }] });
    expect(n.crm?.id).toBe('crm_su_kien_in');
  });
});
