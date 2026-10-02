// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { anhChupMau } from './danh-muc-mau';
import { demMau } from './client-mau';
import { dichHieuLuc, demTheoLoai, dungMoHinh } from './mo-hinh';
import type { AnhChupBanDo } from './kieu';

const anh = (): AnhChupBanDo => { const a = anhChupMau(); a.dem_7_ngay = demMau(a); return a; };

describe('mô hình bản đồ từ danh mục giả lập', () => {
  it('dựng đủ 46 composer từ du-lieu-mau.json, mỗi composer có ít nhất một khối', () => {
    const a = anh();
    expect(a.composer).toHaveLength(46);
    const mh = dungMoHinh(a);
    for (const c of a.composer) expect(mh.khoi.some((k) => k.nguon_id === c.id)).toBe(true);
    expect(a.mau).toBe(true);
  });

  it('hai luật chủ chọn 02/10 sinh khối bản sao Kế toán / Kho + đường "Bản sao theo luật"', () => {
    const mh = dungMoHinh(anh());
    expect(mh.khoiTheoId['xuat_hoa_don_tool@g_ketoan']?.ban_sao).toBe(true);
    expect(mh.khoiTheoId['in_sau_chot@g_kho']?.ban_sao).toBe(true);
    expect(mh.lienKetTheoId['xuat_hoa_don_tool@nhom_goc~xuat_hoa_don_tool@g_ketoan']?.loai).toBe('ban_sao');
    expect(mh.lienKetTheoId['in_sau_chot@nhom_goc~in_sau_chot@g_kho']?.loai).toBe('ban_sao');
  });

  it('đủ sáu loại đường, số thứ tự liên tục 1..n theo khối nguồn, vào/ra khớp', () => {
    const mh = dungMoHinh(anh());
    const dem = demTheoLoai(mh.lienKet);
    for (const v of Object.values(dem)) expect(v).toBeGreaterThan(0);
    expect(mh.lienKet.map((l) => l.so)).toEqual(mh.lienKet.map((_, i) => i + 1));
    const tong = Object.values(mh.vao).reduce((s, v) => s + v.length, 0);
    expect(tong).toBe(mh.lienKet.length);
    for (const l of mh.lienKet) expect(l.dem?.canh_id).toBe(l.id);
  });

  it('dichHieuLuc: khoa bỏ qua luật; ban_sao giữ nơi gốc; thuan thay đích; ban_sao tắt ⇒ không bản sao', () => {
    const a = anh();
    const c = (id: string) => a.composer.find((x) => x.id === id)!;
    expect(dichHieuLuc(c('the_xem_truoc'), { id: 'x', loai: 'the_xem_truoc', dich: ['g_kho'], che_do: 'bat', phien_ban: 1 }).goc).toEqual(['nhom_goc']);
    expect(dichHieuLuc(c('da_chot'), { id: 'x', loai: 'da_chot', dich: ['g_admin'], che_do: 'bat', phien_ban: 1 })).toEqual({ goc: ['nhom_goc'], banSao: ['g_admin'], cheDo: 'bat' });
    expect(dichHieuLuc(c('da_chot'), { id: 'x', loai: 'da_chot', dich: ['nhom_goc', 'g_admin'], che_do: 'tat', phien_ban: 1 }).banSao).toEqual([]);
    expect(dichHieuLuc(c('in_xong'), { id: 'x', loai: 'in_xong', dich: ['nv'], che_do: 'bat', phien_ban: 1 }).goc).toEqual(['nv']);
  });

  it('nguồn (máy in, Odoo, lịch) nối vào composer bằng đường "Sự kiện từ nguồn"', () => {
    const mh = dungMoHinh(anh());
    expect(mh.lienKetTheoId['n_may_in@n_may_in~in_xong@g_kho']?.loai).toBe('nguon');
    expect(mh.lienKetTheoId['n_odoo@n_odoo~don_chot_admin@g_admin']?.loai).toBe('nguon');
    expect(mh.khoi.filter((k) => k.loai_nut === 'crm').length).toBeGreaterThan(0);
  });
});
