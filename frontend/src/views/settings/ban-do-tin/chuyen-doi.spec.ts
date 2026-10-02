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
      dan_toi: [{ den: 'in_sau_chot', kieu: 'nghiep_vu', vi_sao: 'in tiếp' }], ai_soan: 'model', ly_do_khoa: null,
      goi_y: 'Ứng viên: thêm nhóm Kế toán.' },
    { id: 'in_sau_chot', kieu: 'ban_sao', nhay_cam: [], ten: null, pha: 'pha_moi_chua_co', de_xuat: true,
      dich_goc: ['g_kho', 'kenh_la'], khi_nao: null, vi_du: null, nguon_cau: null, ghi_chu: null, dan_toi: [],
      ai_soan: null, ly_do_khoa: null, goi_y: null }, // ảnh chụp lưu trước 02/10
    { id: 'the_don', kieu: 'khoa', nhay_cam: ['gia'], ten: 'Thẻ đơn', pha: 'len_don', de_xuat: false, dich_goc: [],
      khi_nao: null, vi_du: null, nguon_cau: null, ghi_chu: null, dan_toi: [{ den: 'nguon_may_in', kieu: 'chan' }],
      ai_soan: 'mau', ly_do_khoa: 'Mang mã chốt — chỉ ở nơi gốc', goi_y: null },
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

  it('bổ sung 02/10: ai_soan / ly_do_khoa / goi_y vào Composer; ảnh chụp cũ ⇒ ai_soan null, không có hai dòng kia', () => {
    const [x, y, z] = dungAnhChup({ banDo: BAN_DO, luat: { luat: [], banDo: null, canhBao: [] }, crm: null }).composer;
    expect([x.ai_soan, x.ly_do_khoa, x.goi_y]).toEqual(['model', undefined, 'Ứng viên: thêm nhóm Kế toán.']);
    expect([y.ai_soan, 'ly_do_khoa' in y, 'goi_y' in y]).toEqual([null, false, false]);
    expect([z.ai_soan, z.ly_do_khoa]).toEqual(['mau', 'Mang mã chốt — chỉ ở nơi gốc']);
  });

  it('bổ sung 02/10: dòng đếm KHỐI GỐC (luat_id null) — mọi mã dich_kieu của bot là đúng mã hàng, số vào gui:<khối>', () => {
    const MA = ['nhom_goc', 'dm_nguoi_go', 'nguoi_giu_ma', 'chu_don', 'g_kho', 'g_admin', 'g_ketoan', 'g_sales', 'g_kythuat', 'nv', 'g_khach'];
    for (const m of MA) expect(hangTuMaDich(m)).toBe(m);
    const dem: DemApi[] = MA.flatMap((m, i) => [
      { khoa_canh: `c→${m}|goc`, composer: 'c', dich_kieu: m, luat_id: null, ket_qua: 'da_gui', cua_so: '24h', so: i + 1 },
      { khoa_canh: `c→${m}|goc`, composer: 'c', dich_kieu: m, luat_id: null, ket_qua: 'bo', cua_so: '7d', so: 2 },
    ]);
    const d = Object.fromEntries(gopDem(dem).map((x) => [x.canh_id, x]));
    MA.forEach((m, i) => {
      expect(d[`gui:c@${m}`].h24.da_gui).toBe(i + 1);
      expect(d[`gui:c@${m}`].d7.bo).toBe(2);
      expect(d[`luat:c@${m}`]).toBeUndefined();
    });
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

  it('"số bóng lịch sử 24h" = tổng bong/24h của các dòng mang luat_id = id luật', () => {
    expect(bong24hCuaLuat(BAN_DO.dem as DemApi[], { id: 'L1', loai: 'xuat_hoa_don_tool' })).toMatchObject({ co: true, so: 5 });
    expect(bong24hCuaLuat(BAN_DO.dem as DemApi[], { id: 'L9', loai: 'khac' })).toMatchObject({ co: false, so: 0 });
  });

  it('Codex v2 #5: số bóng có phản ánh CẤU HÌNH HIỆN TẠI không — luat_phien_ban_tu, rồi tới mốc sửa luật so với lúc ảnh chụp', () => {
    const d = (so: number, pbt?: number | null, cua_so: '24h' | '7d' = '24h'): DemApi => ({
      khoa_canh: 'in_sau_chot→g_kho|L1', composer: 'in_sau_chot', dich_kieu: 'g_kho', luat_id: 'L1', ket_qua: 'bong', cua_so, so,
      ...(pbt !== undefined ? { luat_phien_ban_tu: pbt } : {}),
    });
    const L = (phien_ban: number, sua_luc?: string) => ({ id: 'L1', loai: 'in_sau_chot', phien_ban, ...(sua_luc ? { sua_luc } : {}) });
    const LUC = '2026-10-02T12:00:00.000Z';
    // bot gửi phiên bản: mọi dòng 24h ≥ phiên bản luật ⇒ đúng cấu hình; một dòng thấp hơn / null ⇒ chưa đủ
    expect(bong24hCuaLuat([d(4, 2), d(3, 3)], L(2), LUC)).toEqual({ co: true, so: 7, hop: 'du' });
    expect(bong24hCuaLuat([d(4, 1), d(3, 2)], L(2), LUC)).toEqual({ co: true, so: 7, hop: 'chua_du' });
    expect(bong24hCuaLuat([d(4, null)], L(2), LUC).hop).toBe('chua_du');
    expect(bong24hCuaLuat([d(4, 2), d(9, 1, '7d')], L(2), LUC).hop).toBe('du'); // chỉ xét cửa sổ 24h
    // bot cũ (không có trường): sửa luật ≥ 24h trước ảnh chụp ⇒ cửa sổ 24h trọn trong cấu hình hiện tại; gần hơn / sau ⇒ chưa đủ
    expect(bong24hCuaLuat([d(4)], L(2, '2026-10-01T11:00:00.000Z'), LUC).hop).toBe('du');
    expect(bong24hCuaLuat([d(4)], L(2, '2026-10-02T08:00:00.000Z'), LUC).hop).toBe('chua_du');
    expect(bong24hCuaLuat([d(4)], L(2, '2026-10-02T13:00:00.000Z'), LUC).hop).toBe('chua_du');
    expect(bong24hCuaLuat([d(4)], L(2), null).hop).toBe('chua_du');
  });

  it('tương thích một bản: ảnh chụp cũ mang luat_id = loai ⇒ vẫn quy về luật (fallback loai); không lẫn luật khác', () => {
    const dong = (luat_id: string, so: number, cua_so: '24h' | '7d' = '24h'): DemApi => ({
      khoa_canh: `in_sau_chot→g_kho|${luat_id}`, composer: 'in_sau_chot', dich_kieu: 'g_kho', luat_id, ket_qua: 'bong', cua_so, so,
    });
    const dem = [dong('in_sau_chot', 4), dong('in_sau_chot', 9, '7d'), dong('uuid-in', 2), dong('uuid-khac', 50)];
    expect(bong24hCuaLuat(dem, { id: 'uuid-in', loai: 'in_sau_chot' })).toMatchObject({ co: true, so: 6 });
    expect(bong24hCuaLuat([dong('in_sau_chot', 4)], { id: 'uuid-in', loai: 'in_sau_chot' })).toMatchObject({ co: true, so: 4 });
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
