// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { anhChupMau } from './client-mau';
import { dichHieuLuc, demTheoLoai, dungMoHinh, soTrenKhoi } from './mo-hinh';
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

  it('bổ sung 02/10: nhãn ai soạn trên MỌI khối composer (gốc lẫn bản sao), không trên khối nguồn/CRM; mẫu khai đủ 4 loại', () => {
    const a = anhChupMau();
    const mh = dungMoHinh(a);
    for (const k of mh.khoi) expect(k.soan).toBe(k.loai_nut === 'composer' ? mh.composer[k.nguon_id].ai_soan : null);
    expect(mh.khoiTheoId['in_sau_chot@g_kho']?.soan).toBe('ma');
    expect(new Set(a.composer.map((c) => c.ai_soan))).toEqual(new Set(['ma', 'model', 'mau', 'anh']));
    // ly_do_khoa chỉ ở composer khoá; goi_y đi theo bản mẫu chủ đã xem
    for (const c of a.composer) if (c.ly_do_khoa) expect(c.kieu).toBe('khoa');
    expect(a.composer.find((c) => c.id === 'xuat_hoa_don_tool')?.goi_y).toBe('Ứng viên: thêm nhóm Kế toán.');
  });

  it('bổ sung 02/10: số trên khối GỐC (24h + 7d, từ dòng đếm luat_id=null) và khối bản sao bóng', () => {
    const mh = dungMoHinh(anhChupMau());
    const goc = soTrenKhoi(mh.demKhoi['the_xem_truoc@nhom_goc'])!;
    expect(goc.gui24).toBeGreaterThan(0);
    expect(goc.gui7).toBeGreaterThanOrEqual(goc.gui24);
    expect(goc.chu).toMatch(/^24 giờ: \d+ đã gửi.* — 7 ngày: \d+ đã gửi/);
    const bong = soTrenKhoi(mh.demKhoi['in_sau_chot@g_kho'])!;
    expect(bong.chu).toMatch(/chạy bóng/);
    expect(bong.gui24).toBe(0);
    expect(bong.bong24).toBeGreaterThan(0);
    expect(soTrenKhoi(undefined)).toBeNull();
  });

  it('tự rà vòng 2: số CHÍNH trên khối = tin gửi THẬT (da_gui); bóng tách riêng; chú thích kể cả chưa rõ + bị chặn', () => {
    const so = (da_gui: number, bong: number, chua_ro: number, chan_tam_im: number, loi = 0, bo = 0) => ({ da_gui, bong, chua_ro, chan_tam_im, loi, bo });
    const r = soTrenKhoi({ canh_id: 'gui:x@nhom_goc', h24: so(17, 5, 2, 1), d7: so(120, 30, 4, 3, 1, 2) })!;
    expect(r).toEqual({
      gui24: 17, bong24: 5, gui7: 120, bong7: 30,
      chu: '24 giờ: 17 đã gửi · 5 chạy bóng · 2 chưa rõ · 1 bị chặn — 7 ngày: 120 đã gửi · 30 chạy bóng · 4 chưa rõ · 3 bị chặn · 1 lỗi · 2 bỏ (rỗng)',
    });
    // chỉ có bóng ⇒ số chính 0, không cộng bóng vào
    expect(soTrenKhoi({ canh_id: 'gui:y', h24: so(0, 6, 0, 0), d7: so(0, 40, 0, 0) })).toMatchObject({ gui24: 0, bong24: 6 });
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

  it('dichHieuLuc — BA kiểu (Codex v2 #1): khoa bỏ qua luật; ban_sao nơi gốc luôn gửi + luật THÊM bản sao; thuan CHỈ theo luật', () => {
    const a = anhChupMau();
    const c = (id: string) => a.composer.find((x) => x.id === id)!;
    const rong = { theoLuat: [], goiY: [] };
    expect(dichHieuLuc(c('the_xem_truoc'), luat('the_xem_truoc', ['g_kho'], 'bat'))).toEqual({ goc: ['nhom_goc'], banSao: [], cheDo: 'bat', ...rong });
    expect(dichHieuLuc(c('da_chot'), luat('da_chot', ['g_admin'], 'bat'))).toEqual({ goc: ['nhom_goc'], banSao: ['g_admin'], cheDo: 'bat', ...rong });
    expect(dichHieuLuc(c('da_chot'), luat('da_chot', ['g_admin'], 'tat')).banSao).toEqual([]);
    // thuan: KHÔNG có nơi gốc; đích + chế độ lấy từ luật; dich_goc chỉ là gợi ý (vẽ TẮT khi chưa có luật)
    expect(dichHieuLuc(c('in_xong'), luat('in_xong', ['nv', 'g_kho'], 'bong'))).toEqual({ goc: [], banSao: [], cheDo: 'bong', theoLuat: ['nv', 'g_kho'], goiY: [] });
    expect(dichHieuLuc(c('in_xong'), undefined)).toEqual({ goc: [], banSao: [], cheDo: 'tat', theoLuat: [], goiY: ['g_kho'] });
    expect(dichHieuLuc(c('in_xong'), luat('in_xong', ['g_admin'], 'tat'))).toEqual({ goc: [], banSao: [], cheDo: 'tat', theoLuat: ['g_admin'], goiY: [] });
  });

  it('thuan trên sơ đồ: chưa luật ⇒ khối GỢI Ý ở dich_goc, TẮT (không vẽ như đang gửi); có luật ⇒ đúng đích + chế độ của luật', () => {
    const a = anhChupMau();
    let k = dungMoHinh(a).khoiTheoId['in_xong@g_kho'];
    expect(k).toMatchObject({ ban_sao: false, che_do: 'tat', goi_y: true });
    expect(k.tags).toContain('Tắt');
    a.luat.push(luat('in_xong', ['g_admin'], 'bat'));
    let mh = dungMoHinh(a);
    expect(mh.khoiTheoId['in_xong@g_kho']).toBeUndefined();
    k = mh.khoiTheoId['in_xong@g_admin'];
    expect(k).toMatchObject({ ban_sao: false, che_do: 'bat', goi_y: false });
    expect(k.tags).not.toContain('Tắt');
    expect(k.tags).not.toContain('Bóng');
    // nguồn máy in vẫn nối tới khối theo luật; không có đường "bản sao" cho thuan
    expect(mh.lienKetTheoId['nguon_may_in@n_may_in~in_xong@g_admin']?.loai).toBe('su_kien');
    expect(mh.lienKet.some((l) => l.loai === 'ban_sao' && l.den.startsWith('in_xong@'))).toBe(false);
    a.luat[a.luat.length - 1] = luat('in_xong', ['g_admin'], 'tat');
    mh = dungMoHinh(a);
    expect(mh.khoiTheoId['in_xong@g_admin']).toMatchObject({ che_do: 'tat' });
    expect(mh.khoiTheoId['in_xong@g_admin'].tags).toContain('Tắt');
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
