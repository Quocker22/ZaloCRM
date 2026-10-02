// SPDX-License-Identifier: AGPL-3.0-or-later
// Độ đục theo SPEC §5 + hash (§7) + kiểm luật (docs/78 luật cứng) + ngân sách hiệu năng (P1/P2-10).
import { describe, it, expect } from 'vitest';
import { anhChupMau } from './client-mau';
import { dungMoHinh } from './mo-hinh';
import { doDucDuongNen, doDucDuongNoi, doDucKhoi, tinhTrangThai } from './trang-thai';
import { docHash, vietHash } from './hash';
import { dichKhoa, dsDichPanel, kiemDich } from './luat';
import { boDau, timKiem } from './tim';
import { dungBoCuc } from './bo-cuc';
import { dinhTuyen } from './dinh-tuyen';
import type { AnhChupBanDo, Composer, MaDich } from './kieu';

const a = anhChupMau();
const mh = dungMoHinh(a);
const c = (id: string) => a.composer.find((x) => x.id === id)!;

describe('độ đục theo trạng thái', () => {
  it('nghỉ: đường 0.35, khối 1, không đường nổi', () => {
    const kq = tinhTrangThai(mh, { chon: null, tro: null, troDong: null });
    expect(kq.che).toBe('nghi');
    expect(doDucDuongNen(kq.che)).toBe(0.35);
    expect(doDucKhoi(kq, mh.khoi[0].id)).toEqual({ opacity: 1, xam: false });
    expect(kq.noi.size).toBe(0);
  });

  it('rê khối: nền 0.10, đường liên quan 1 ×1.35, khối khác 0.4 KHÔNG xám', () => {
    const kq = tinhTrangThai(mh, { chon: null, tro: 'the_xem_truoc@nhom_goc', troDong: null });
    expect(doDucDuongNen(kq.che)).toBe(0.1);
    const l = [...kq.noi][0];
    expect(doDucDuongNoi(kq, l)).toEqual({ opacity: 1, heSo: 1.35 });
    expect(doDucKhoi(kq, 'kho_cong@nhom_goc')).toEqual({ opacity: 0.4, xam: false });
    expect(kq.badge).toEqual({});
  });

  it('chọn khối: nền 0.06, liên quan ×1.45 có chạy, khối khác 0.14 + xám, badge Đang xem/Đầu vào/Đầu ra', () => {
    const id = 'the_xem_truoc@nhom_goc';
    const kq = tinhTrangThai(mh, { chon: { kieu: 'khoi', id }, tro: null, troDong: null });
    expect(doDucDuongNen(kq.che)).toBe(0.06);
    expect(kq.chay).toBe(true);
    expect(kq.noi.size).toBe(mh.vao[id].length + mh.ra[id].length);
    expect(doDucKhoi(kq, 'kho_cong@nhom_goc')).toEqual({ opacity: 0.14, xam: true });
    expect(kq.badge[id].chu).toBe('Đang xem');
    expect(kq.badge['anh_bao_gia@nhom_goc'].chu).toBe('Đầu ra · P2');
    expect(kq.badge['cong_so_tra_loi@nhom_goc'].chu).toBe('Đầu vào · P2');
    expect(kq.phaSang.has('chot')).toBe(true);
  });

  it('rê dòng panel: đường đang trỏ ×2.2, đường liên quan khác 0.25', () => {
    const id = 'the_xem_truoc@nhom_goc';
    const tro = mh.ra[id][0].id;
    const kq = tinhTrangThai(mh, { chon: { kieu: 'khoi', id }, tro: null, troDong: tro });
    expect(doDucDuongNoi(kq, tro)).toEqual({ opacity: 1, heSo: 2.2 });
    expect(doDucDuongNoi(kq, mh.ra[id][1].id).opacity).toBe(0.25);
  });

  it('lọc loại / chọn liên kết: Điểm đi · Điểm đến', () => {
    const kq = tinhTrangThai(mh, { chon: { kieu: 'loai', id: 'ban_sao' }, tro: null, troDong: null });
    expect([...kq.noi].every((id) => mh.lienKetTheoId[id].loai === 'ban_sao')).toBe(true);
    const l = mh.lienKet[0];
    const kq2 = tinhTrangThai(mh, { chon: { kieu: 'lien_ket', id: l.id }, tro: null, troDong: null });
    expect(kq2.badge[l.tu].chu).toMatch(/^Điểm đi · P/);
    expect(kq2.badge[l.den].chu).toMatch(/^Điểm đến · P/);
  });
});

describe('hash', () => {
  it('đọc + viết khứ hồi mọi loại', () => {
    const ds = [
      { kieu: 'khoi', id: 'da_chot@nhom_goc' }, { kieu: 'pha', id: 'chot' }, { kieu: 'hang', id: 'g_kho' },
      { kieu: 'lien_ket', id: 'a@nhom_goc~b@g_kho' }, { kieu: 'loai', id: 'hoi_lai' },
    ] as const;
    for (const x of ds) expect(docHash(vietHash(x))).toEqual(x);
    expect(vietHash({ kieu: 'lien_ket', id: 'a@x~b@y' })).toBe('#lien-ket=a@x~b@y');
    expect(vietHash({ kieu: 'hang', id: 'g_kho' })).toBe('#dich=g_kho');
  });
  it('mã loại cũ (nguon / vong) vẫn mở được — quy về su_kien / hoi_lai', () => {
    expect(docHash('#loai=vong')).toEqual({ kieu: 'loai', id: 'hoi_lai' });
    expect(docHash('#loai=nguon')).toEqual({ kieu: 'loai', id: 'su_kien' });
  });
  it('hash rác ⇒ null', () => {
    for (const h of ['', '#', '#khoi=', '#loai=khong_co', '#lien-ket=abc', '#la=1', '#khoi=%E0%A4%A']) expect(docHash(h)).toBeNull();
  });
});

describe('kiểm luật (tương đương rào server)', () => {
  it('khách + nhạy cảm ⇒ chặn; khách không nhạy cảm ⇒ cảnh báo mẫu rút gọn', () => {
    expect(kiemDich(c('xuat_hoa_don_tool'), 'g_khach')?.chan).toMatch(/cấm vào nhóm khách/);
    expect(kiemDich(c('in_xong'), 'g_khach')?.canh).toMatch(/công khai/);
  });
  it('sales + doanh số ⇒ báo từng người; kho + giá ⇒ bản che giá', () => {
    expect(kiemDich(c('bao_cao_soan_tin'), 'g_sales')?.canh).toMatch(/từng người/);
    expect(kiemDich(c('xuat_hoa_don_tool'), 'g_kho')?.canh).toMatch(/che giá/);
    expect(kiemDich(c('in_xong'), 'g_kho')).toBeNull();
  });
  it('danh sách tick: khoa chỉ nơi gốc; còn lại = nơi gốc + bản sao + đúng các hàng CRM nhận làm đích luật', () => {
    expect(dsDichPanel(c('the_xem_truoc'), [])).toEqual(['nhom_goc']);
    expect(dsDichPanel(c('da_chot'), ['g_ketoan'])).toEqual(['nhom_goc', 'g_ketoan', 'dm_nguoi_go', 'g_kho', 'g_admin', 'g_sales', 'nv', 'g_khach']);
  });
  it('dichKhoa: 🔒 nơi gốc (mọi kiểu), mọi đích của khoa, hàng CRM chưa có kiểu đích', () => {
    expect(dichKhoa(c('da_chot'), 'nhom_goc')).toMatch(/Nơi gốc/);
    expect(dichKhoa(c('in_xong'), 'g_kho')).toMatch(/Nơi gốc/);
    expect(dichKhoa(c('da_chot'), 'g_kho')).toBeNull();
    expect(dichKhoa(c('the_xem_truoc'), 'g_kho')).toMatch(/mã chốt/);
    expect(dichKhoa(c('da_chot'), 'g_kythuat')).toMatch(/chưa có kiểu đích/);
  });
});

describe('tìm không dấu', () => {
  it('gõ không dấu vẫn ra khối, đích, liên kết', () => {
    expect(boDau('Đã chốt')).toBe('da chot');
    const kq = timKiem(mh, 'xuat hoa don');
    expect(kq.some((r) => r.nhom === 'Khối' && r.chu === 'Xuất hoá đơn')).toBe(true);
    expect(timKiem(mh, 'ke toan').some((r) => r.nhom === 'Đích')).toBe(true);
    expect(timKiem(mh, 'outbox confirm').some((r) => r.nhom === 'Liên kết')).toBe(true);
  });
});

describe('hiệu năng (60 composer × 15 đích)', () => {
  it('dựng + định tuyến một lần, rồi mỗi lần bấm tính trạng thái ≤ 50 ms', () => {
    const lon: AnhChupBanDo = { ...a, composer: [], luat: [], dem: [] };
    const dich: MaDich[] = ['nhom_goc', 'dm_nguoi_go', 'chu_don', 'g_kho', 'g_admin', 'g_ketoan', 'g_sales', 'g_kythuat', 'nv', 'g_khach'];
    const goc = a.composer;
    for (let i = 0; i < 60; i++) {
      const g: Composer = goc[i % goc.length];
      lon.composer.push({ ...g, id: `c${i}`, kieu: 'ban_sao', dich_goc: ['nhom_goc'], dan_toi: [
        { den: `c${(i + 1) % 60}`, kieu: 'nghiep_vu' }, { den: `c${(i + 7) % 60}`, kieu: 'hoi_lai' }, { den: `c${(i + 13) % 60}`, kieu: 'chan' },
      ] });
      lon.luat.push({ id: `l${i}`, loai: `c${i}`, dich: dich.slice(0, 1 + (i % dich.length)), dich_tho: [], che_do: 'bat', phien_ban: 1 });
    }
    const m = dungMoHinh(lon);
    expect(m.khoi.length).toBeGreaterThan(300);
    const t0 = performance.now();
    dinhTuyen(dungBoCuc(m), m.lienKet);
    const tDung = performance.now() - t0;
    expect(tDung).toBeLessThan(500);
    let max = 0;
    for (const k of m.khoi.slice(0, 40)) {
      const t = performance.now();
      const kq = tinhTrangThai(m, { chon: { kieu: 'khoi', id: k.id }, tro: null, troDong: null });
      for (const b of m.khoi) doDucKhoi(kq, b.id);
      max = Math.max(max, performance.now() - t);
    }
    expect(max).toBeLessThan(50);
  });
});
