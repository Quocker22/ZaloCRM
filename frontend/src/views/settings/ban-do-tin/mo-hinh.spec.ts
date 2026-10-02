// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { anhChupMau } from './client-mau';
import { dichHieuLuc, demTheoLoai, dungMoHinh } from './mo-hinh';
import type { Luat, MaDich } from './kieu';

const luat = (loai: string, dich: MaDich[], che_do: Luat['che_do']): Luat => ({ id: 'x', loai, dich, dich_tho: [], che_do, phien_ban: 1 });

describe('mô hình bản đồ từ ảnh chụp mẫu (đi qua hợp đồng → chuyen-doi)', () => {
  it('dựng đủ 46 composer, mỗi composer có ít nhất một khối; nhãn mẫu', () => {
    const a = anhChupMau();
    expect(a.composer).toHaveLength(46);
    const mh = dungMoHinh(a);
    for (const c of a.composer) expect(mh.khoi.some((k) => k.nguon_id === c.id)).toBe(true);
    expect(a.mau).toBe(true);
  });

  it('hai luật chủ chọn 02/10 sinh khối bản sao Kế toán / Kho + đường "Bản sao theo luật"; luật bóng gắn nhãn Bóng', () => {
    const mh = dungMoHinh(anhChupMau());
    expect(mh.khoiTheoId['xuat_hoa_don_tool@g_ketoan']?.ban_sao).toBe(true);
    expect(mh.khoiTheoId['in_sau_chot@g_kho']?.ban_sao).toBe(true);
    expect(mh.khoiTheoId['in_sau_chot@g_kho']?.tags).toContain('Bóng');
    expect(mh.lienKetTheoId['xuat_hoa_don_tool@nhom_goc~xuat_hoa_don_tool@g_ketoan']?.loai).toBe('ban_sao');
    expect(mh.lienKetTheoId['in_sau_chot@nhom_goc~in_sau_chot@g_kho']?.loai).toBe('ban_sao');
  });

  it('đủ sáu loại đường, số thứ tự liên tục 1..n, vào/ra khớp; số đếm chỉ gắn cạnh bản sao (luat:)', () => {
    const mh = dungMoHinh(anhChupMau());
    const dem = demTheoLoai(mh.lienKet);
    expect(Object.keys(dem).sort()).toEqual(['ban_sao', 'chan', 'crm', 'hoi_lai', 'nghiep_vu', 'su_kien']);
    for (const v of Object.values(dem)) expect(v).toBeGreaterThan(0);
    expect(mh.lienKet.map((l) => l.so)).toEqual(mh.lienKet.map((_, i) => i + 1));
    expect(Object.values(mh.vao).reduce((s, v) => s + v.length, 0)).toBe(mh.lienKet.length);
    for (const l of mh.lienKet) {
      if (l.loai === 'ban_sao') expect(l.dem?.canh_id).toBe(`luat:${l.den}`);
      else expect(l.dem).toBeUndefined();
    }
    expect(mh.demKhoi['the_xem_truoc@nhom_goc']?.d7.da_gui).toBeGreaterThan(0);
  });

  it('dichHieuLuc: khoa bỏ qua luật; nơi gốc LUÔN giữ (kể cả thuan); luật tắt ⇒ không bản sao', () => {
    const a = anhChupMau();
    const c = (id: string) => a.composer.find((x) => x.id === id)!;
    expect(dichHieuLuc(c('the_xem_truoc'), luat('the_xem_truoc', ['g_kho'], 'bat'))).toEqual({ goc: ['nhom_goc'], banSao: [], cheDo: 'bat' });
    expect(dichHieuLuc(c('da_chot'), luat('da_chot', ['g_admin'], 'bat'))).toEqual({ goc: ['nhom_goc'], banSao: ['g_admin'], cheDo: 'bat' });
    expect(dichHieuLuc(c('da_chot'), luat('da_chot', ['g_admin'], 'tat')).banSao).toEqual([]);
    expect(dichHieuLuc(c('in_xong'), luat('in_xong', ['nv', 'g_kho'], 'bong'))).toEqual({ goc: ['g_kho'], banSao: ['nv'], cheDo: 'bong' });
  });

  it('nguồn nối vào composer bằng "Sự kiện từ nguồn"; CRM tự động nối sang nguồn máy in bằng "CRM tự động"', () => {
    const mh = dungMoHinh(anhChupMau());
    expect(mh.lienKetTheoId['nguon_may_in@n_may_in~in_xong@g_kho']?.loai).toBe('su_kien');
    expect(mh.lienKetTheoId['nguon_odoo@n_odoo~don_chot_admin@g_admin']?.loai).toBe('su_kien');
    expect(mh.lienKetTheoId['crm_su_kien_in@crm_bot~nguon_may_in@n_may_in']?.loai).toBe('crm');
    expect(mh.khoiTheoId['crm_lich_hen_nhac@crm_sale']).toMatchObject({ loai_nut: 'crm', che_do: 'tat', tags: ['CRM', 'Tắt'] });
  });

  it('hàng "Nguồn khác" chỉ hiện khi có nguồn lạ', () => {
    const a = anhChupMau();
    expect(dungMoHinh(a).nhom.find((g) => g.id === 'nguon')!.hang).not.toContain('n_khac');
    a.nguon.push({ id: 'nguon_zalo_oa', ten: 'Zalo OA', pha: 'hoi', hang: 'n_khac', mo_ta: '', dan_toi: [], chi_xem: true });
    expect(dungMoHinh(a).nhom.find((g) => g.id === 'nguon')!.hang).toContain('n_khac');
  });
});
