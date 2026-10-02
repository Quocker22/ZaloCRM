// SPDX-License-Identifier: AGPL-3.0-or-later
// Thông báo chủ động (docs/78 C2) — luật THUẦN: kiểm cứng đích + ảnh chụp + payload bot (không DB).
import { describe, it, expect } from 'vitest';
import {
  docDich, docLuatVao, docAnhChup, danhMucTuAnh, danhMucHop, kiemTheoDanhMuc, ghepLuatCongKhai, LoiLuatThongBao, docThamSoGieo,
  LUAT_CHU_CHON_02_10, kiemNhayCamDinh, khoaCanh,
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
  id, ten: id, pha: 'chot', kieu, de_xuat: false, dich_goc: ['nhom_goc'], nhay_cam, khi_nao: null, vi_du: null, nguon_cau: null,
  ghi_chu: null, dan_toi: [],
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

describe('docAnhChup — hợp đồng ảnh chụp (Codex v1 #7, hop-dong-ban-do-tin.md)', () => {
  const dem1 = { khoa_canh: 'chao→nhom_goc|goc', composer: 'chao', dich_kieu: 'nhom_goc', luat_id: null, ket_qua: 'da_gui', cua_so: '7d', so: 3 };
  const tot = {
    phien_ban: 'v1',
    composer: [
      { id: 'chao', kieu: 'thuan', nhay_cam: ['gia', 'gia'], la: 'bỏ', dan_toi: [['in_sau_chot', 'nghiep_vu']] },
      { id: 'in_sau_chot', kieu: 'ban_sao' },
    ],
    dem: [dem1],
  };
  it('chuẩn hoá: bỏ trường lạ, khử trùng nhay_cam, dan_toi dạng cặp ⇒ {den, kieu}, dich_goc chuỗi ⇒ mảng', () => {
    const a = docAnhChup({ ...tot, composer: [...tot.composer.slice(0, 1), { id: 'in_sau_chot', kieu: 'ban_sao', dich_goc: 'nhom_goc' }] });
    expect(a.composer[0]).toEqual({
      id: 'chao', ten: null, pha: null, kieu: 'thuan', de_xuat: false, dich_goc: [], nhay_cam: ['gia'], khi_nao: null, vi_du: null,
      nguon_cau: null, ghi_chu: null, dan_toi: [{ den: 'in_sau_chot', kieu: 'nghiep_vu' }],
    });
    expect(a.composer[1].dich_goc).toEqual(['nhom_goc']);
    expect(a.dem).toEqual([dem1]);
    expect(a.nguon).toEqual([]);
  });
  it('giữ đủ khi_nao / vi_du / nguon_cau / ghi_chu / de_xuat / dan_toi (kèm vi_sao) và nguồn giả', () => {
    const a = docAnhChup({
      ...tot,
      composer: [{
        id: 'chao', ten: 'Chào', pha: 'hoi', kieu: 'thuan', de_xuat: true, dich_goc: ['nhom_goc', 'nv'], nhay_cam: [],
        khi_nao: 'Khi NV chào', vi_du: 'Dạ chào anh', nguon_cau: 'adapter.py:1', ghi_chu: 'ghi chú',
        dan_toi: [{ den: 'in_sau_chot', kieu: 'hoi_lai', vi_sao: 'vì thế' }, ['in_sau_chot', 'nghiep_vu']],
      }, { id: 'in_sau_chot', kieu: 'ban_sao' }],
      nguon: [{ id: 'nguon_may_in', ten: 'Máy in', pha: 'in', mo_ta: 'CRM C1', dan_toi: [['in_sau_chot', 'su_kien']] }],
      pha: [{ id: 'hoi', ten: 'Hỏi' }], dich: ['nhom_goc'],
    });
    expect(a.composer[0]).toEqual({
      id: 'chao', ten: 'Chào', pha: 'hoi', kieu: 'thuan', de_xuat: true, dich_goc: ['nhom_goc', 'nv'], nhay_cam: [],
      khi_nao: 'Khi NV chào', vi_du: 'Dạ chào anh', nguon_cau: 'adapter.py:1', ghi_chu: 'ghi chú',
      dan_toi: [{ den: 'in_sau_chot', kieu: 'hoi_lai', vi_sao: 'vì thế' }, { den: 'in_sau_chot', kieu: 'nghiep_vu' }],
    });
    expect(a.nguon).toEqual([{ id: 'nguon_may_in', ten: 'Máy in', pha: 'in', mo_ta: 'CRM C1', dan_toi: [{ den: 'in_sau_chot', kieu: 'su_kien' }] }]);
  });
  it('khoaCanh = "<composer>→<dich_kieu>|<luat_id|goc>"', () => {
    expect(khoaCanh('chao', 'nhom_goc', null)).toBe('chao→nhom_goc|goc');
    expect(khoaCanh('in_sau_chot', 'g_kho', 'l1')).toBe('in_sau_chot→g_kho|l1');
  });
  it('sai hình ⇒ 400 ANH_CHUP_KHONG_HOP_LE (composer, dan_toi, nguon, dem)', () => {
    const sai: unknown[] = [
      null, { ...tot, phien_ban: '' }, { ...tot, composer: [] },
      { ...tot, composer: [{ id: 'Chao', kieu: 'thuan' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan' }, { id: 'a', kieu: 'khoa' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'bi_mat' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', nhay_cam: ['Giá'] }] },
      // dan_toi: đích không có trong ảnh chụp, kiểu cạnh lạ, hình lạ
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', dan_toi: [['khong_co', 'nghiep_vu']] }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', dan_toi: [{ den: 'a', kieu: 'ban_sao' }] }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', dan_toi: 'a' }] },
      { ...tot, composer: [{ id: 'a', kieu: 'thuan', dich_goc: [3] }] },
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

describe('danhMucHop — ảnh chụp hiện tại ∪ sổ dính (Codex v1 #1)', () => {
  it('nhãn/khoá trong sổ dính cộng vào composer hiện tại; composer CHỈ còn trong sổ ⇒ có mặt, đánh dấu chi_trong_so_dinh', () => {
    const m = danhMucHop([C('a', 'ban_sao', []), C('t', 'thuan')], { a: { nhay_cam: ['tien'], khoa: false }, k: { nhay_cam: ['gia'], khoa: true } });
    expect(m.get('a')).toMatchObject({ nhay_cam: ['tien'], kieu: 'ban_sao' });
    expect(m.get('a')?.chi_trong_so_dinh).toBeFalsy();
    expect(m.get('k')).toMatchObject({ id: 'k', kieu: 'khoa', nhay_cam: ['gia'], chi_trong_so_dinh: true });
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
    expect(danhMucTuAnh([{ id: 'a', kieu: 'thuan', nhay_cam: [] }, 3]).size).toBe(1);
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
