// SPDX-License-Identifier: AGPL-3.0-or-later
// Thông báo chủ động (docs/78 C2) — luật THUẦN: kiểm cứng đích + ảnh chụp + payload bot (không DB).
import { describe, it, expect } from 'vitest';
import {
  docDich, docLuatVao, docAnhChup, danhMucTuAnh, danhMucHop, kiemTheoDanhMuc, ghepLuatCongKhai, LoiLuatThongBao, docThamSoGieo,
  LUAT_CHU_CHON_02_10, kiemNhayCamDinh, khoaCanh, chuanLuatIdDem, docDoiSoatEcho,
  type ComposerAnh, type DemCanh,
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
  id, ten: id, pha: 'chot', kieu, de_xuat: false, dich_goc: ['nhom_goc'], nhay_cam, khi_nao: null, vi_du: null, nguon_cau: null,
  ghi_chu: null, dan_toi: [], ai_soan: 'ma', ly_do_khoa: null, goi_y: null,
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
  it('nhóm KHÁCH: composer nhạy cảm ⇒ 400 LO_DU_LIEU; composer KHÔNG nhạy cảm cũng 400 — bot chưa hỗ trợ đích nhóm khách (Codex v2 #6)', () => {
    expect(loi(() => kiemTheoDanhMuc('xuat_hoa_don_tool', [{ kieu: 'chuc_nang', gia_tri: 'khach' }], DM, new Set())).code)
      .toBe('LO_DU_LIEU_NHOM_KHACH');
    expect(loi(() => kiemTheoDanhMuc('chao', [{ kieu: 'chuc_nang', gia_tri: 'khach' }], DM, new Set())))
      .toEqual({ status: 400, code: 'BOT_CHUA_HO_TRO_NHOM_KHACH' });
    expect(kiemTheoDanhMuc('chao', [{ kieu: 'chuc_nang', gia_tri: 'kho' }], DM, new Set()).id).toBe('chao');
    expect(kiemTheoDanhMuc('xuat_hoa_don_tool', [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }], DM, new Set()).id).toBe('xuat_hoa_don_tool');
  });
  it('đích NV phải có trong danh sách NV của org', () => {
    expect(loi(() => kiemTheoDanhMuc('chao', [{ kieu: 'nv', gia_tri: 'u9' }], DM, new Set(['u1']))).code).toBe('NV_KHONG_CO');
    expect(kiemTheoDanhMuc('chao', [{ kieu: 'nv', gia_tri: 'u1' }], DM, new Set(['u1'])).id).toBe('chao');
  });
});

describe('docAnhChup — hợp đồng ảnh chụp (Codex v1 #7, hop-dong-ban-do-tin.md)', () => {
  const dem1 = { khoa_canh: 'chao→nhom_goc|goc', composer: 'chao', dich_kieu: 'nhom_goc', luat_id: null, ket_qua: 'da_gui', cua_so: '7d', so: 3 };
  const tot = {
    phien_ban: 'v1',
    composer: [
      { id: 'chao', kieu: 'thuan', ai_soan: 'ma', nhay_cam: ['gia', 'gia'], la: 'bỏ', dan_toi: [['in_sau_chot', 'nghiep_vu']] },
      { id: 'in_sau_chot', kieu: 'ban_sao', ai_soan: 'ma' },
    ],
    dem: [dem1],
  };
  it('chuẩn hoá: bỏ trường lạ, khử trùng nhay_cam, dan_toi dạng cặp ⇒ {den, kieu}, dich_goc chuỗi ⇒ mảng', () => {
    const a = docAnhChup({ ...tot, composer: [...tot.composer.slice(0, 1), { id: 'in_sau_chot', kieu: 'ban_sao', ai_soan: 'ma', dich_goc: 'nhom_goc' }] });
    expect(a.composer[0]).toEqual({
      id: 'chao', ten: null, pha: null, kieu: 'thuan', de_xuat: false, dich_goc: [], nhay_cam: ['gia'], khi_nao: null, vi_du: null,
      nguon_cau: null, ghi_chu: null, dan_toi: [{ den: 'in_sau_chot', kieu: 'nghiep_vu' }], ai_soan: 'ma', ly_do_khoa: null, goi_y: null,
    });
    expect(a.composer[1].dich_goc).toEqual(['nhom_goc']);
    expect(a.dem).toEqual([dem1]);
    expect(a.nguon).toEqual([]);
  });
  it('giữ đủ khi_nao / vi_du / nguon_cau / ghi_chu / de_xuat / dan_toi (kèm vi_sao) và nguồn giả', () => {
    const a = docAnhChup({
      ...tot,
      composer: [{
        id: 'chao', ten: 'Chào', pha: 'hoi', kieu: 'thuan', ai_soan: 'ma', de_xuat: true, dich_goc: ['nhom_goc', 'nv'], nhay_cam: [],
        khi_nao: 'Khi NV chào', vi_du: 'Dạ chào anh', nguon_cau: 'adapter.py:1', ghi_chu: 'ghi chú',
        dan_toi: [{ den: 'in_sau_chot', kieu: 'hoi_lai', vi_sao: 'vì thế' }, ['in_sau_chot', 'nghiep_vu']],
      }, { id: 'in_sau_chot', kieu: 'ban_sao', ai_soan: 'ma' }],
      nguon: [{ id: 'nguon_may_in', ten: 'Máy in', pha: 'in', mo_ta: 'CRM C1', dan_toi: [['in_sau_chot', 'su_kien']] }],
      pha: [{ id: 'hoi', ten: 'Hỏi' }], dich: ['nhom_goc'],
    });
    expect(a.composer[0]).toEqual({
      id: 'chao', ten: 'Chào', pha: 'hoi', kieu: 'thuan', de_xuat: true, dich_goc: ['nhom_goc', 'nv'], nhay_cam: [],
      khi_nao: 'Khi NV chào', vi_du: 'Dạ chào anh', nguon_cau: 'adapter.py:1', ghi_chu: 'ghi chú',
      dan_toi: [{ den: 'in_sau_chot', kieu: 'hoi_lai', vi_sao: 'vì thế' }, { den: 'in_sau_chot', kieu: 'nghiep_vu' }],
      ai_soan: 'ma', ly_do_khoa: null, goi_y: null,
    });
    expect(a.nguon).toEqual([{ id: 'nguon_may_in', ten: 'Máy in', pha: 'in', mo_ta: 'CRM C1', dan_toi: [{ den: 'in_sau_chot', kieu: 'su_kien' }] }]);
  });
  it('bổ sung 02/10: giữ ai_soan / ly_do_khoa (chỉ composer khoá) / goi_y; rỗng ⇒ null', () => {
    const a = docAnhChup({
      ...tot,
      composer: [
        { id: 'the_don', kieu: 'khoa', ai_soan: 'mau', ly_do_khoa: 'Mã chốt chỉ ở nhóm gốc', goi_y: '' },
        { id: 'chao', kieu: 'thuan', ai_soan: 'model', goi_y: 'Ứng viên: thêm nhóm Kế toán', ly_do_khoa: null },
        { id: 'in_sau_chot', kieu: 'ban_sao', ai_soan: 'anh' },
      ],
    });
    expect(a.composer.map((c) => [c.id, c.ai_soan, c.ly_do_khoa, c.goi_y])).toEqual([
      ['the_don', 'mau', 'Mã chốt chỉ ở nhóm gốc', null],
      ['chao', 'model', null, 'Ứng viên: thêm nhóm Kế toán'],
      ['in_sau_chot', 'anh', null, null],
    ]);
  });
  it('bổ sung 02/10: dòng đếm KHỐI GỐC (luat_id null, khoa_canh "…|goc") cho mọi mã hàng bản đồ; ket_qua "bo" nhận', () => {
    const MA_HANG = ['nhom_goc', 'dm_nguoi_go', 'nguoi_giu_ma', 'chu_don', 'g_kho', 'g_admin', 'g_ketoan', 'g_sales', 'g_kythuat', 'nv', 'g_khach'];
    const dem = MA_HANG.map((d) => ({ khoa_canh: `chao→${d}|goc`, composer: 'chao', dich_kieu: d, luat_id: null, ket_qua: 'da_gui', cua_so: '24h', so: 2 }));
    dem.push({ ...dem[0], ket_qua: 'bo' });
    expect(docAnhChup({ ...tot, dem }).dem).toEqual(dem);
  });
  it('khoaCanh = "<composer>→<dich_kieu>|<luat_id|goc>"', () => {
    expect(khoaCanh('chao', 'nhom_goc', null)).toBe('chao→nhom_goc|goc');
    expect(khoaCanh('in_sau_chot', 'g_kho', 'l1')).toBe('in_sau_chot→g_kho|l1');
  });
  it('sai hình ⇒ 400 ANH_CHUP_KHONG_HOP_LE (composer, dan_toi, nguon, dem)', () => {
    const sai: unknown[] = [
      null, { ...tot, phien_ban: '' }, { ...tot, composer: [] },
      { ...tot, composer: [{ id: 'Chao', kieu: 'thuan', ai_soan: 'ma' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', ai_soan: 'ma' }, { id: 'a', kieu: 'khoa', ai_soan: 'ma' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'bi_mat', ai_soan: 'ma' }] },
      // bổ sung 02/10: ai_soan thiếu / ngoài 4 giá trị / sai kiểu; ly_do_khoa ở composer KHÔNG khoá; goi_y / ly_do_khoa sai kiểu
      { ...tot, composer: [{ id: 'a', kieu: 'thuan' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', ai_soan: 'nguoi' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', ai_soan: 'MA' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', ai_soan: null }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', ai_soan: ['ma'] }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', ai_soan: 'ma', ly_do_khoa: 'không phải khoá' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'khoa', ai_soan: 'ma', ly_do_khoa: 3 }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', ai_soan: 'ma', goi_y: { x: 1 } }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', ai_soan: 'ma', nhay_cam: ['Giá'] }] },
      // dan_toi: đích không có trong ảnh chụp, kiểu cạnh lạ, hình lạ
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', ai_soan: 'ma', dan_toi: [['khong_co', 'nghiep_vu']] }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', ai_soan: 'ma', dan_toi: [{ den: 'a', kieu: 'ban_sao' }] }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', ai_soan: 'ma', dan_toi: 'a' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', ai_soan: 'ma', dich_goc: [3] }] },
      { ...tot, nguon: [{ id: 'chao', ten: 'trùng id composer' }] },
      // dem: thiếu khoá cạnh / cửa sổ, khoá cạnh không khớp, kết quả lạ, cửa sổ lạ, số âm, trường lạ, trùng
      { ...tot, dem: [{ so: 12 }] },
      { ...tot, dem: [{ ...dem1, khoa_canh: undefined }] },
      { ...tot, dem: [{ ...dem1, cua_so: undefined }] },
      { ...tot, dem: [{ ...dem1, khoa_canh: 'chao→g_kho|goc' }] },
      { ...tot, dem: [{ ...dem1, ket_qua: 'gui_roi' }] },
      { ...tot, dem: [{ ...dem1, cua_so: '30d' }] },
      { ...tot, dem: [{ ...dem1, so: -1 }] },
      { ...tot, dem: [{ ...dem1, la: 1 }] },
      { ...tot, dem: [dem1, dem1] },
      { ...tot, dem: Array.from({ length: 5001 }, () => dem1) },
    ];
    for (const b of sai) expect(loi(() => docAnhChup(b)).code, JSON.stringify(b)?.slice(0, 120)).toBe('ANH_CHUP_KHONG_HOP_LE');
  });
});

describe('dem.luat_phien_ban_tu — phiên bản luật THẤP NHẤT trong các tin được đếm (Codex v2 #5, tuỳ chọn)', () => {
  const tot = { phien_ban: 'v1', composer: [{ id: 'in_sau_chot', kieu: 'ban_sao', ai_soan: 'ma' }] };
  const dl = { khoa_canh: 'in_sau_chot→g_kho|L1', composer: 'in_sau_chot', dich_kieu: 'g_kho', luat_id: 'L1', ket_qua: 'bong', cua_so: '24h', so: 4 };
  it('nhận số nguyên ≥ 1 (dòng luật) hoặc null; vắng ⇒ round-trip KHÔNG thêm trường (bot cũ)', () => {
    expect(docAnhChup({ ...tot, dem: [{ ...dl, luat_phien_ban_tu: 3 }] }).dem).toEqual([{ ...dl, luat_phien_ban_tu: 3 }]);
    expect(docAnhChup({ ...tot, dem: [{ ...dl, luat_phien_ban_tu: null }] }).dem).toEqual([{ ...dl, luat_phien_ban_tu: null }]);
    expect(docAnhChup({ ...tot, dem: [dl] }).dem[0]).not.toHaveProperty('luat_phien_ban_tu');
  });
  it('sai hình ⇒ 400: 0, âm, lẻ, chuỗi; có số mà luat_id null (dòng khối gốc không có luật)', () => {
    for (const v of [0, -1, 1.5, '2']) {
      expect(loi(() => docAnhChup({ ...tot, dem: [{ ...dl, luat_phien_ban_tu: v }] })).code, String(v)).toBe('ANH_CHUP_KHONG_HOP_LE');
    }
    const goc = { khoa_canh: 'in_sau_chot→nhom_goc|goc', composer: 'in_sau_chot', dich_kieu: 'nhom_goc', luat_id: null, ket_qua: 'da_gui', cua_so: '24h', so: 1 };
    expect(loi(() => docAnhChup({ ...tot, dem: [{ ...goc, luat_phien_ban_tu: 2 }] })).code).toBe('ANH_CHUP_KHONG_HOP_LE');
  });
  it('gộp hai dòng cùng cạnh (đổi loai → id) ⇒ lấy MIN; một bên không biết (vắng/null) ⇒ null (không hứa cấu hình mới)', () => {
    const LUAT = [{ id: 'L1', loai: 'in_sau_chot' }];
    const cu = { ...dl, luat_id: 'in_sau_chot', khoa_canh: 'in_sau_chot→g_kho|in_sau_chot' };
    expect(chuanLuatIdDem([{ ...dl, luat_phien_ban_tu: 3 }, { ...cu, luat_phien_ban_tu: 2 }] as DemCanh[], LUAT).dem)
      .toEqual([{ ...dl, so: 8, luat_phien_ban_tu: 2 }]);
    expect(chuanLuatIdDem([{ ...dl, luat_phien_ban_tu: 3 }, cu] as DemCanh[], LUAT).dem).toEqual([{ ...dl, so: 8, luat_phien_ban_tu: null }]);
    expect(chuanLuatIdDem([dl, cu] as DemCanh[], LUAT).dem[0]).not.toHaveProperty('luat_phien_ban_tu');
  });
});

describe('danhMucHop — ảnh chụp hiện tại ∪ sổ dính (Codex v1 #1)', () => {
  it('nhãn/khoá trong sổ dính cộng vào composer hiện tại; composer CHỈ còn trong sổ ⇒ có mặt, đánh dấu chi_trong_so_dinh', () => {
    const m = danhMucHop([C('a', 'ban_sao', []), C('t', 'thuan')], { a: { nhay_cam: ['tien'], khoa: false }, k: { nhay_cam: ['gia'], khoa: true } });
    expect(m.get('a')).toMatchObject({ nhay_cam: ['tien'], kieu: 'ban_sao' });
    expect(m.get('a')?.chi_trong_so_dinh).toBeFalsy();
    expect(m.get('k')).toMatchObject({ id: 'k', kieu: 'khoa', ai_soan: null, nhay_cam: ['gia'], chi_trong_so_dinh: true });
    expect(m.get('t')).toMatchObject({ nhay_cam: [], kieu: 'thuan' });
    expect(danhMucHop(null, null)).toBeNull();
    expect(danhMucHop(null, { k: { nhay_cam: ['gia'], khoa: false } })!.get('k')).toMatchObject({ chi_trong_so_dinh: true });
  });
  it('ghi luật: composer chỉ còn trong sổ dính ⇒ COMPOSER_LA (phải có trong ảnh chụp hiện tại)', () => {
    const m = danhMucHop([C('t', 'thuan')], { a: { nhay_cam: ['tien'], khoa: false } });
    expect(loi(() => kiemTheoDanhMuc('a', [], m, new Set())).code).toBe('COMPOSER_LA');
  });
});

describe('ghepLuatCongKhai — payload bot', () => {
  const dong = (o: Partial<{ id: string; loai: string; dich: unknown; cheDo: string; phienBan: number }> = {}) => ({
    id: `id-${o.loai ?? 'xuat_hoa_don_tool'}`, loai: 'xuat_hoa_don_tool', dich: [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }], cheDo: 'bat', dieuKien: {}, gomGiay: 0,
    lich: null, phienBan: 1, ...o,
  });
  it('phien_ban ổn định theo nội dung (thứ tự dòng không ảnh hưởng), đổi khi một ô đổi', () => {
    const a = ghepLuatCongKhai([dong(), dong({ loai: 'chao', dich: [] })], DM);
    const b = ghepLuatCongKhai([dong({ loai: 'chao', dich: [] }), dong()], DM);
    expect(a.phien_ban).toBe(b.phien_ban);
    expect(a.luat.map((l) => l.loai)).toEqual(['chao', 'xuat_hoa_don_tool']);
    expect(ghepLuatCongKhai([dong({ cheDo: 'bong' })], DM).phien_ban).not.toBe(ghepLuatCongKhai([dong()], DM).phien_ban);
  });
  it('mỗi luật mang `id` (khoá số đếm luat_id) cạnh `loai`', () => {
    const r = ghepLuatCongKhai([dong(), dong({ loai: 'chao', dich: [] })], DM);
    expect(r.luat.map((l) => [l.id, l.loai])).toEqual([['id-chao', 'chao'], ['id-xuat_hoa_don_tool', 'xuat_hoa_don_tool']]);
  });
  it('áp lại luật cứng với ảnh chụp HIỆN TẠI: bỏ nhom_goc, bỏ nhóm khách nhạy cảm, bỏ luật composer khoá', () => {
    const r = ghepLuatCongKhai([
      dong({ dich: [{ kieu: 'nhom_goc' }, { kieu: 'chuc_nang', gia_tri: 'khach' }, { kieu: 'chuc_nang', gia_tri: 'ke_toan' }] }),
      dong({ loai: 'the_don' }),
    ], DM);
    expect(r.luat).toEqual([expect.objectContaining({ loai: 'xuat_hoa_don_tool', dich: [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }] })]);
    expect(r.canh_bao).toHaveLength(3);
  });
  it('Codex v2 #6 — luật cũ/SQL tay có nhóm khách (composer không nhạy cảm) ⇒ CRM bỏ khi phát + canh_bao "Bot chưa hỗ trợ gửi nhóm khách"', () => {
    const r = ghepLuatCongKhai([dong({ loai: 'chao', dich: [{ kieu: 'chuc_nang', gia_tri: 'khach' }, { kieu: 'chuc_nang', gia_tri: 'kho' }] })], DM);
    expect(r.luat[0].dich).toEqual([{ kieu: 'chuc_nang', gia_tri: 'kho' }]);
    expect(r.canh_bao).toEqual(['chao: bỏ đích chuc_nang:khach — Bot chưa hỗ trợ gửi nhóm khách']);
  });
  it('XUYÊN HỢP ĐỒNG CRM → bot (dong_bo_luat.chuyen_dich): mọi đích chuc_nang CRM phát nằm trong tập bot nhận', () => {
    // = lednelia-agent/lednelia_donhang/thong_bao/dong_bo_luat.py CHUC_NANG (admin|kho|ke_toan|sales → g_*); chức năng khác bot BỎ
    // + chỉ cảnh báo phía bot ⇒ CRM phải tự bỏ và hiện ở canhBao (không để trang báo "đang gửi" cho đích bot không gửi).
    const BOT_NHAN = new Set(['admin', 'kho', 'ke_toan', 'sales']);
    const tat = ['admin', 'sales', 'kho', 'ke_toan', 'khach'].map((g) => ({ kieu: 'chuc_nang', gia_tri: g }));
    const r = ghepLuatCongKhai([dong({ loai: 'chao', dich: tat })], DM);
    for (const d of r.luat[0].dich) if (d.kieu === 'chuc_nang') expect(BOT_NHAN.has(d.gia_tri!)).toBe(true);
    expect(r.luat[0].dich).toHaveLength(4);
    expect(r.canh_bao).toHaveLength(1);
  });
  it('fail closed (Codex v1 #1): composer KHÔNG có trong ảnh chụp lẫn sổ dính ⇒ bỏ MỌI đích của luật + cảnh báo; chưa có ảnh chụp ⇒ bỏ hết', () => {
    const r = ghepLuatCongKhai([dong({ loai: 'da_bo', dich: [{ kieu: 'chuc_nang', gia_tri: 'kho' }, { kieu: 'chuc_nang', gia_tri: 'khach' }] })], DM);
    expect(r.luat).toEqual([expect.objectContaining({ loai: 'da_bo', dich: [] })]);
    expect(r.canh_bao).toEqual([expect.stringMatching(/^da_bo: .*không có trong danh mục/)]);
    const k = ghepLuatCongKhai([dong()], null);
    expect(k.luat[0].dich).toEqual([]);
    expect(k.canh_bao).toHaveLength(1);
  });
  it('danhMucTuAnh chịu được jsonb hỏng', () => {
    expect(danhMucTuAnh(null).size).toBe(0);
    expect(danhMucTuAnh([{ id: 'a', kieu: 'thuan', ai_soan: 'ma', nhay_cam: [] }, 3]).size).toBe(1);
    // bản lưu trước 02/10 (chưa có ai_soan/ly_do_khoa/goi_y) ⇒ null, không đoán
    expect(danhMucTuAnh([{ id: 'cu', kieu: 'khoa', nhay_cam: [] }]).get('cu')).toMatchObject({ ai_soan: null, ly_do_khoa: null, goi_y: null });
  });
});

describe('gieo luật chủ chọn 02/10 — tham số script', () => {
  it('--org bắt buộc; --che-do mặc định bong; chế độ lạ / cờ lạ ⇒ lỗi', () => {
    expect(docThamSoGieo(['--org', 'o1'])).toEqual({ orgId: 'o1', cheDo: 'bong' });
    expect(docThamSoGieo(['--org=o1', '--che-do=bat'])).toEqual({ orgId: 'o1', cheDo: 'bat' });
    expect(docThamSoGieo(['--che-do', 'tat', '--org', 'o2'])).toEqual({ orgId: 'o2', cheDo: 'tat' });
    expect(() => docThamSoGieo([])).toThrow(/--org/);
    expect(() => docThamSoGieo(['--org', 'o1', '--che-do', 'mo'])).toThrow(/che-do/);
    expect(() => docThamSoGieo(['--org', 'o1', '--xoa'])).toThrow(/--xoa/);
  });
  it('đúng hai luật chủ chọn: hoá đơn → kế toán, in → kho; không nhom_goc', () => {
    expect(LUAT_CHU_CHON_02_10).toEqual([
      { loai: 'xuat_hoa_don_tool', dich: [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }] },
      { loai: 'in_sau_chot', dich: [{ kieu: 'chuc_nang', gia_tri: 'kho' }] },
    ]);
  });
});

describe('kiemNhayCamDinh — nhạy cảm DÍNH theo id composer (tự rà P1-5)', () => {
  const dinh0 = {};
  it('lần đầu: sổ = ảnh chụp; không vi phạm', () => {
    const kq = kiemNhayCamDinh(dinh0, [C('a', 'ban_sao', ['tien']), C('k', 'khoa'), C('t', 'thuan')]);
    expect(kq.viPham).toEqual([]);
    expect(kq.dinh).toEqual({ a: { nhay_cam: ['tien'], khoa: false }, k: { nhay_cam: [], khoa: true } });
  });
  it('gỡ nhãn nhạy cảm / mở khoá ⇒ vi phạm; composer vắng mặt KHÔNG xoá khỏi sổ; thêm nhãn / khoá thêm ⇒ cộng vào sổ', () => {
    const { dinh } = kiemNhayCamDinh(dinh0, [C('a', 'ban_sao', ['tien']), C('k', 'khoa')]);
    expect(kiemNhayCamDinh(dinh, [C('a', 'ban_sao', []), C('k', 'khoa')]).viPham).toEqual(['a: bỏ nhãn nhạy cảm tien']);
    expect(kiemNhayCamDinh(dinh, [C('a', 'ban_sao', ['tien']), C('k', 'thuan')]).viPham).toEqual(['k: mở khoá (khoa → thuan)']);
    const vang = kiemNhayCamDinh(dinh, [C('k', 'khoa')]);
    expect(vang.viPham).toEqual([]);
    expect(vang.dinh.a).toEqual({ nhay_cam: ['tien'], khoa: false });
    const them = kiemNhayCamDinh(dinh, [C('a', 'khoa', ['gia', 'tien']), C('k', 'khoa')]);
    expect(them.viPham).toEqual([]);
    expect(them.dinh.a).toEqual({ nhay_cam: ['gia', 'tien'], khoa: true });
  });
});

describe('chuanLuatIdDem — luat_id của số đếm là id luật; nhận `loai` (tương thích một bản)', () => {
  const D = (luat_id: string | null, so: number, ket_qua: DemCanh['ket_qua'] = 'bong', dich_kieu = 'g_kho'): DemCanh => ({
    khoa_canh: khoaCanh('in_sau_chot', dich_kieu, luat_id), composer: 'in_sau_chot', dich_kieu, luat_id, ket_qua, cua_so: '24h', so,
  });
  const LUAT = [{ id: '0b9a-uuid', loai: 'in_sau_chot' }, { id: '7c1d-uuid', loai: 'xuat_hoa_don_tool' }];
  it('id luật ⇒ giữ nguyên; null (gốc) ⇒ giữ nguyên', () => {
    const vao = [D('0b9a-uuid', 3), D(null, 2, 'da_gui', 'nhom_goc')];
    expect(chuanLuatIdDem(vao, LUAT)).toEqual({ dem: vao, doiTuLoai: 0 });
  });
  it('luat_id = loai ⇒ đổi sang id + khoa_canh viết lại theo id', () => {
    const r = chuanLuatIdDem([D('in_sau_chot', 7)], LUAT);
    expect(r.dem).toEqual([D('0b9a-uuid', 7)]);
    expect(r.dem[0].khoa_canh).toBe('in_sau_chot→g_kho|0b9a-uuid');
    expect(r.doiTuLoai).toBe(1);
  });
  it('luat_id lạ (luật đã xoá, số đếm 7 ngày còn) ⇒ giữ nguyên, không bỏ số', () => {
    expect(chuanLuatIdDem([D('luat-da-xoa', 1)], LUAT).dem).toEqual([D('luat-da-xoa', 1)]);
  });
  it('id thắng loai khi trùng chuỗi (id của luật khác bằng đúng loai của luật này)', () => {
    const r = chuanLuatIdDem([D('in_sau_chot', 1)], [{ id: 'in_sau_chot', loai: 'x' }, { id: 'u2', loai: 'in_sau_chot' }]);
    expect(r.dem[0].luat_id).toBe('in_sau_chot');
  });
  it('một ảnh chụp lẫn hai dạng cho CÙNG cạnh ⇒ gộp một dòng (cộng `so`), vị trí lần đầu', () => {
    const r = chuanLuatIdDem([D('0b9a-uuid', 3), D(null, 1, 'da_gui', 'nhom_goc'), D('in_sau_chot', 4)], LUAT);
    expect(r.dem).toEqual([D('0b9a-uuid', 7), D(null, 1, 'da_gui', 'nhom_goc')]);
  });
});

describe('docDoiSoatEcho — thân POST /api/public/ban-do-tin/doi-soat-echo', () => {
  it('nhận mảng chuỗi, khử trùng giữ thứ tự, cắt khoảng trắng', () => {
    expect(docDoiSoatEcho({ echo_ids: ['tb:1:0', ' tb:2:0 ', 'tb:1:0'] })).toEqual(['tb:1:0', 'tb:2:0']);
    expect(docDoiSoatEcho({ echo_ids: [] })).toEqual([]);
  });
  it('sai hình ⇒ 400 DOI_SOAT_KHONG_HOP_LE: thiếu, không phải mảng, > 200, phần tử rỗng/không phải chuỗi/> 200 ký tự', () => {
    for (const b of [
      null, {}, { echo_ids: 'tb:1:0' }, { echo_ids: Array.from({ length: 201 }, (_, i) => `tb:${i}:0`) },
      { echo_ids: [''] }, { echo_ids: ['  '] }, { echo_ids: [1] }, { echo_ids: ['x'.repeat(201)] },
    ]) {
      expect(loi(() => docDoiSoatEcho(b))).toEqual({ status: 400, code: 'DOI_SOAT_KHONG_HOP_LE' });
    }
    expect(docDoiSoatEcho({ echo_ids: Array.from({ length: 200 }, (_, i) => `tb:${i}:0`) })).toHaveLength(200);
  });
});
