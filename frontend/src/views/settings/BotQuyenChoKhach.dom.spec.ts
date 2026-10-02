// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Tab "Cho khách" của trang Quyền bot (docs/79 T5), gắn với API giả:
//   • hai phần "Tài liệu dùng trả lời khách" + "Mô tả sản phẩm đã duyệt"; cảnh báo hãy LOẠI TRỪ tài liệu nội bộ / bảng giá;
//   • (02/10 tối) bot dùng MỌI tài liệu TRỪ loại trừ: tick hàng loạt ⇒ "Loại trừ" / "Dùng lại cho khách" ⇒ gửi đúng id + lý do;
//     nút từng dòng; bộ lọc "Bot đang dùng / Đã loại trừ / Nên xem"; tìm kiếm; xem mẫu + toàn văn; lô 500;
//   • mô tả: chip "Mô tả đã đổi — cần duyệt lại", duyệt gửi ĐÚNG băm đang hiển thị, 409 MO_TA_DA_DOI ⇒ hiện câu + tải lại;
//   • trang Quyền bot có tab "Cho khách".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, h, inject, provide } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import type { DsMoTa, DsTaiLieuChoKhach } from '@/api/bot-cho-khach';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@/composables/use-toast', () => ({ useToast: () => toast }));
vi.mock('@/api/bot-cho-khach', () => ({
  layTaiLieuChoKhach: vi.fn(),
  loaiTruTaiLieuChoKhach: vi.fn(),
  boLoaiTruTaiLieuChoKhach: vi.fn(),
  layMoTaChoKhach: vi.fn(),
  duyetMoTaChoKhach: vi.fn(),
  boDuyetMoTaChoKhach: vi.fn(),
  layToanVanTaiLieu: vi.fn(),
}));
vi.mock('@/api/bot-quyen', () => ({
  layNguoiDungCrm: vi.fn().mockResolvedValue([]),
  layDanhSachNhom: vi.fn().mockResolvedValue([]),
  layNhatKy: vi.fn().mockResolvedValue([]),
  layDanhSachNhanVien: vi.fn().mockResolvedValue([]),
  layNguoiDaNhan: vi.fn().mockResolvedValue({ tong: 0, trang: 1, moiTrang: 30, gomLuc: null, ungVien: [] }),
}));

import {
  layTaiLieuChoKhach, loaiTruTaiLieuChoKhach, boLoaiTruTaiLieuChoKhach, layMoTaChoKhach, duyetMoTaChoKhach, boDuyetMoTaChoKhach,
  layToanVanTaiLieu,
} from '@/api/bot-cho-khach';
import BotQuyenChoKhachTab from '@/components/bot-quyen/BotQuyenChoKhachTab.vue';
import BotQuyenPage from './BotQuyenPage.vue';

// ── Vỏ Vuetify (khuôn BotQuyenPage.dom.spec.ts) ──
const vo = (the: string) => defineComponent({
  name: `Vo${the}`,
  setup(_, { slots }) {
    return () => h(the, slots.default?.());
  },
});
const VoDialog = defineComponent({
  name: 'VoDialog',
  props: { modelValue: Boolean },
  setup(p, { slots }) {
    return () => (p.modelValue ? h('div', { class: 'vo-dialog' }, slots.default?.()) : null);
  },
});
const VoNhap = defineComponent({
  name: 'VoNhap',
  props: { modelValue: { type: [String, Number], default: '' }, label: String },
  emits: ['update:modelValue'],
  setup(p, { emit }) {
    return () => h('label', { class: 'vo-nhap' }, [
      h('span', p.label),
      h('input', { value: p.modelValue ?? '', onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value) }),
    ]);
  },
});
const VoTabs = defineComponent({
  name: 'VoTabs',
  props: { modelValue: String },
  emits: ['update:modelValue'],
  setup(_, { slots, emit }) {
    provide('voTabs', (v: string) => emit('update:modelValue', v));
    return () => h('div', { role: 'tablist' }, slots.default?.());
  },
});
const VoTab = defineComponent({
  name: 'VoTab',
  props: { value: String },
  setup(p, { slots }) {
    const chon = inject<(v: string) => void>('voTabs')!;
    return () => h('button', { role: 'tab', onClick: () => chon(p.value!) }, slots.default?.());
  },
});
const VUETIFY_VO = {
  VBtn: vo('button'), VIcon: vo('i'), VAlert: vo('div'), VDialog: VoDialog, VCard: vo('div'), VCardText: vo('div'),
  VCardActions: vo('div'), VCardTitle: vo('div'), VSpacer: vo('span'), VTextField: VoNhap, VTable: vo('table'),
  VProgressLinear: vo('div'), VDivider: vo('hr'), VTabs: VoTabs, VTab: VoTab, VThemeProvider: vo('div'),
};

const B1 = 'a'.repeat(64);
const B2 = 'b'.repeat(64);
const B3 = 'c'.repeat(64);
const N1 = '1'.repeat(64);
const N2 = '2'.repeat(64);
const N3 = '3'.repeat(64);
const N4 = '4'.repeat(64);
const KHONG_LOAI = { loaiTru: false, loaiTruBoi: null, loaiTruLuc: null, loaiTruLyDo: null, deXuatLoaiTru: false };
const TAI_LIEU: DsTaiLieuChoKhach = {
  kho: { soTaiLieu: 5, luc: '2026-10-02T02:00:00.000Z' },
  duyetNgoaiDanhMuc: [],
  taiLieu: [
    { id: 'doc-1', tieuDe: 'Datasheet P10', loai: 'pdf', nguon: 'file-zalo', soDoan: 12, capNhatLuc: '2026-09-30T02:00:00.000Z',
      mauNoiDung: 'Module P10 full color 320x160', noiDungBam: N1, trangThai: 'chua_duyet', noiDungBamDaDuyet: null, choKhach: true,
      duyetBoi: null, duyetLuc: null, ...KHONG_LOAI },
    { id: 'doc-2', tieuDe: 'Bảng giá đại lý 2026', loai: 'pdf', nguon: 'file-zalo', soDoan: 4, capNhatLuc: null,
      mauNoiDung: 'Led dây 12V giá 125.000đ/m', noiDungBam: N2, trangThai: 'chua_duyet', noiDungBamDaDuyet: null, choKhach: true,
      duyetBoi: null, duyetLuc: null, ...KHONG_LOAI, deXuatLoaiTru: true },
    { id: 'doc-3', tieuDe: 'Hướng dẫn lắp', loai: null, nguon: 'nhap-tay', soDoan: 2, capNhatLuc: null,
      mauNoiDung: 'Bước 1: cắt nguồn', noiDungBam: N3, trangThai: 'chua_duyet', noiDungBamDaDuyet: null, choKhach: true,
      duyetBoi: null, duyetLuc: null, ...KHONG_LOAI },
    { id: 'doc-4', tieuDe: 'Catalogue 2026', loai: 'pdf', nguon: 'file-zalo', soDoan: 8, capNhatLuc: '2026-10-02T01:00:00.000Z',
      mauNoiDung: 'Catalogue led dây', noiDungBam: N4, trangThai: 'chua_duyet', noiDungBamDaDuyet: null, choKhach: false,
      duyetBoi: null, duyetLuc: null, ...KHONG_LOAI,
      loaiTru: true, loaiTruBoi: { id: 'u1', fullName: 'Nguyễn A' }, loaiTruLuc: '2026-10-02T03:00:00.000Z', loaiTruLyDo: 'bản cũ' },
    { id: 'doc-5', tieuDe: 'Ảnh chưa OCR', loai: 'jpg', nguon: 'file-zalo', soDoan: 0, capNhatLuc: null,
      mauNoiDung: null, noiDungBam: null, trangThai: 'khong_noi_dung', noiDungBamDaDuyet: null, choKhach: false,
      duyetBoi: null, duyetLuc: null, ...KHONG_LOAI },
  ],
};
const MO_TA: DsMoTa = {
  danhMuc: { phienBan: 'dm-1', luc: '2026-10-02T02:00:00.000Z' },
  dem: { coMoTa: 3, daDuyet: 1, doiSauDuyet: 1, chuaDuyet: 1, tong: 5 },
  sanPham: [
    { productId: 11, ma: 'LED-11', ten: 'Led dây 12V', moTaBan: 'Điện áp 12V\nIP65', moTaBam: B1, trangThai: 'da_duyet',
      moTaBamDaDuyet: B1, duyetBoi: { id: 'u1', fullName: 'Nguyễn A' }, duyetLuc: '2026-10-01T02:00:00.000Z' },
    { productId: 12, ma: 'LED-12', ten: 'Led thanh', moTaBan: 'Điện áp 24V', moTaBam: B2, trangThai: 'doi_sau_duyet',
      moTaBamDaDuyet: B3, duyetBoi: { id: 'u1', fullName: 'Nguyễn A' }, duyetLuc: '2026-10-01T02:00:00.000Z' },
    { productId: 13, ma: null, ten: 'Led hắt', moTaBan: 'Chống nước IP67', moTaBam: B3, trangThai: 'chua_duyet',
      moTaBamDaDuyet: null, duyetBoi: null, duyetLuc: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.mocked(layTaiLieuChoKhach).mockResolvedValue(structuredClone(TAI_LIEU));
  vi.mocked(layMoTaChoKhach).mockResolvedValue(structuredClone(MO_TA));
  vi.mocked(loaiTruTaiLieuChoKhach).mockResolvedValue({ doi: 2 });
  vi.mocked(boLoaiTruTaiLieuChoKhach).mockResolvedValue({ doi: 1 });
  vi.mocked(duyetMoTaChoKhach).mockResolvedValue({ doi: 1 });
  vi.mocked(boDuyetMoTaChoKhach).mockResolvedValue({ doi: 1 });
});

function gan() {
  return mount(BotQuyenChoKhachTab, { global: { components: VUETIFY_VO } });
}
type W = VueWrapper<InstanceType<typeof BotQuyenChoKhachTab>>;
const nut = (w: W | ReturnType<W['find']>, chu: string) => {
  const b = w.findAll('button').find((x) => x.text().trim() === chu);
  if (!b) throw new Error(`Không thấy nút "${chu}"`);
  return b;
};
const phan = (w: W, ten: 'tai-lieu' | 'mo-ta') => w.find(`[data-phan="${ten}"]`);
const tlHang = (w: W, id: string) => w.find(`tr[data-tl="${id}"]`);
const spHang = (w: W, id: number) => w.find(`tr[data-sp="${id}"]`);

describe('Tab "Cho khách" — tài liệu', () => {
  it('hai phần + cảnh báo nguyên văn; nhãn theo loại trừ (không theo duyệt); cờ "có vẻ nội bộ" ở bảng giá', async () => {
    const w = gan();
    await flushPromises();
    expect(phan(w, 'tai-lieu').find('h2').text()).toBe('Tài liệu dùng trả lời khách');
    expect(phan(w, 'mo-ta').find('h2').text()).toBe('Mô tả sản phẩm đã duyệt');
    const cb = w.find('[data-o="canh-bao-noi-bo"]').text();
    expect(cb).toContain('Bot dùng mọi tài liệu');
    expect(cb).toContain('trừ tài liệu bị loại trừ');
    expect(cb).toContain('loại trừ tài liệu nội bộ, bảng giá, báo giá, chiết khấu, công nợ');
    expect(w.find('.bq-ck-moc').text()).toContain('3 bot dùng trả lời khách · 1 loại trừ');
    expect(tlHang(w, 'doc-1').find('[data-o="trang-thai-tl"]').text()).toBe('Bot dùng trả lời khách');
    expect(tlHang(w, 'doc-4').find('[data-o="trang-thai-tl"]').text()).toBe('Không dùng cho khách');
    expect(tlHang(w, 'doc-4').find('[data-o="trang-thai-tl"]').attributes('title')).toContain('Loại trừ bởi Nguyễn A');
    expect(tlHang(w, 'doc-4').find('[data-o="trang-thai-tl"]').attributes('title')).toContain('bản cũ');
    expect(tlHang(w, 'doc-5').find('[data-o="trang-thai-tl"]').text()).toBe('Không có nội dung');
    expect(tlHang(w, 'doc-2').find('[data-o="noi-bo"]').text()).toBe('Có vẻ tài liệu nội bộ');
    expect(tlHang(w, 'doc-1').find('[data-o="noi-bo"]').exists()).toBe(false);
    w.unmount();
  });

  it('tìm không dấu lọc dòng; "Xem mẫu" hiện 300 ký tự đầu', async () => {
    const w = gan();
    await flushPromises();
    await phan(w, 'tai-lieu').find('.vo-nhap input').setValue('huong dan');
    expect(tlHang(w, 'doc-1').exists()).toBe(false);
    expect(tlHang(w, 'doc-3').exists()).toBe(true);
    expect(tlHang(w, 'doc-3').find('[data-o="mau"]').exists()).toBe(false);
    await nut(tlHang(w, 'doc-3'), 'Xem mẫu').trigger('click');
    expect(tlHang(w, 'doc-3').find('[data-o="mau"]').text()).toBe('Bước 1: cắt nguồn');
    w.unmount();
  });

  it('tick hàng loạt ⇒ "Loại trừ (2)" ⇒ hộp xác nhận ⇒ gửi đúng id + lý do ⇒ tải lại', async () => {
    const w = gan();
    await flushPromises();
    expect(w.find('[data-nut="loai-tru-tai-lieu"]').exists()).toBe(false);
    await tlHang(w, 'doc-2').find('input[type="checkbox"]').setValue(true);
    await tlHang(w, 'doc-3').find('input[type="checkbox"]').setValue(true);
    expect(w.find('[data-nut="loai-tru-tai-lieu"]').text()).toBe('Loại trừ (2)');
    expect(w.find('[data-nut="dung-lai-tai-lieu"]').exists()).toBe(false);
    await w.find('[data-nut="loai-tru-tai-lieu"]').trigger('click');
    const hop = w.find('.vo-dialog');
    expect(hop.text()).toContain('Loại trừ 2 tài liệu khỏi câu trả lời cho khách?');
    expect(hop.text()).toContain('Nhân viên hỏi thì bot vẫn đọc');
    await hop.find('[data-o="ly-do"] input').setValue('bảng giá');
    await hop.find('[data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(loaiTruTaiLieuChoKhach).toHaveBeenCalledWith(['doc-2', 'doc-3'], 'bảng giá');
    expect(layTaiLieuChoKhach).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalled();
    w.unmount();
  });

  it('chọn tất cả ⇒ tách đúng "Loại trừ" (chưa loại) và "Dùng lại cho khách" (đã loại); dùng lại nêu tài liệu có vẻ nội bộ', async () => {
    const ds = structuredClone(TAI_LIEU);
    ds.taiLieu[1] = { ...ds.taiLieu[1], loaiTru: true, choKhach: false, deXuatLoaiTru: false };
    vi.mocked(layTaiLieuChoKhach).mockResolvedValue(ds);
    const w = gan();
    await flushPromises();
    await phan(w, 'tai-lieu').find('input[data-o="chon-het"]').setValue(true);
    expect(w.find('[data-nut="loai-tru-tai-lieu"]').text()).toBe('Loại trừ (3)');
    expect(w.find('[data-nut="dung-lai-tai-lieu"]').text()).toBe('Dùng lại cho khách (2)');
    await w.find('[data-nut="dung-lai-tai-lieu"]').trigger('click');
    const hop = w.find('.vo-dialog');
    expect(hop.text()).toContain('Dùng lại 2 tài liệu để trả lời khách?');
    expect(hop.text()).toContain('Bảng giá đại lý 2026');
    expect(hop.find('[data-o="xem-toan-van"]').text()).toContain('Xem toàn văn');
    await hop.find('[data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(boLoaiTruTaiLieuChoKhach).toHaveBeenCalledWith(['doc-2', 'doc-4'], undefined);
    w.unmount();
  });

  it('bộ lọc: Bot đang dùng / Đã loại trừ / Nên xem (có vẻ nội bộ, chưa loại); nút từng dòng Loại trừ / Dùng lại', async () => {
    const w = gan();
    await flushPromises();
    const hien = () => w.findAll('tr[data-tl]').map((r) => r.attributes('data-tl'));
    expect(w.find('[data-loc-tl="de_xuat"]').text()).toContain('1');
    await w.find('[data-loc-tl="de_xuat"]').trigger('click');
    expect(hien()).toEqual(['doc-2']);
    await w.find('[data-loc-tl="loai_tru"]').trigger('click');
    expect(hien()).toEqual(['doc-4']);
    await w.find('[data-loc-tl="dung"]').trigger('click');
    expect(hien()).toEqual(['doc-1', 'doc-2', 'doc-3']);
    await tlHang(w, 'doc-1').find('[data-nut="loai-tru-mot"]').trigger('click');
    await w.find('.vo-dialog [data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(loaiTruTaiLieuChoKhach).toHaveBeenCalledWith(['doc-1'], undefined);
    await w.find('[data-loc-tl="tat_ca"]').trigger('click');
    expect(tlHang(w, 'doc-4').find('[data-nut="loai-tru-mot"]').exists()).toBe(false);
    await tlHang(w, 'doc-4').find('[data-nut="dung-lai-mot"]').trigger('click');
    await w.find('.vo-dialog [data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(boLoaiTruTaiLieuChoKhach).toHaveBeenCalledWith(['doc-4'], undefined);
    w.unmount();
  });

  it('409 KHONG_CO_TRONG_DANH_MUC ⇒ hiện nguyên câu + tải lại danh mục', async () => {
    vi.mocked(loaiTruTaiLieuChoKhach).mockRejectedValue({
      response: { status: 409, data: { error: 'Tài liệu không còn trong kho tri thức: doc-1 — tải lại trang', code: 'KHONG_CO_TRONG_DANH_MUC' } },
    });
    const w = gan();
    await flushPromises();
    await tlHang(w, 'doc-1').find('[data-nut="loai-tru-mot"]').trigger('click');
    await w.find('.vo-dialog [data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('không còn trong kho tri thức'), 8000);
    expect(layTaiLieuChoKhach).toHaveBeenCalledTimes(2);
    w.unmount();
  });

  it('nút "Xem toàn văn" tải đoạn của đúng tài liệu, bấm lại thì ẩn; không đoạn ⇒ không nút', async () => {
    vi.mocked(layToanVanTaiLieu).mockResolvedValue({
      id: 'doc-3', tieuDe: 'Hướng dẫn lắp', nguon: 'nhap-tay', noiDungBam: N3, doan: ['Bước 1: cắt nguồn', 'Bước 2: đấu dây'],
      dauHieuNoiBo: [],
    });
    const w = gan();
    await flushPromises();
    expect(nut(tlHang(w, 'doc-3'), 'Xem mẫu').exists()).toBe(true);
    expect(tlHang(w, 'doc-5').find('[data-nut="toan-van"]').exists()).toBe(false);
    await tlHang(w, 'doc-3').find('[data-nut="toan-van"]').trigger('click');
    await flushPromises();
    expect(layToanVanTaiLieu).toHaveBeenCalledWith('doc-3');
    expect(tlHang(w, 'doc-3').find('[data-o="toan-van"]').text()).toContain('Bước 2: đấu dây');
    await tlHang(w, 'doc-3').find('[data-nut="toan-van"]').trigger('click');
    expect(tlHang(w, 'doc-3').find('[data-o="toan-van"]').exists()).toBe(false);
    w.unmount();
  });

  it('cờ "có vẻ nội bộ" theo dauHieuNoiBo của backend (xét toàn văn) — lý do hiện ở title', async () => {
    const ds = structuredClone(TAI_LIEU);
    ds.taiLieu[0].dauHieuNoiBo = ['3 dòng có giá/tiền (bot bỏ các dòng này)'];
    ds.taiLieu[1].dauHieuNoiBo = [];
    vi.mocked(layTaiLieuChoKhach).mockResolvedValue(ds);
    const w = gan();
    await flushPromises();
    expect(tlHang(w, 'doc-1').find('[data-o="noi-bo"]').attributes('title')).toContain('3 dòng có giá/tiền');
    expect(tlHang(w, 'doc-2').find('[data-o="noi-bo"]').exists()).toBe(false);
    w.unmount();
  });

  it('"Chọn hết" > 500 ⇒ gửi theo lô 500 lần lượt + tiến độ; lô lỗi ⇒ báo lô nào, số mục, giữ chọn đúng các mục chưa lưu', async () => {
    const nhieu: DsTaiLieuChoKhach = {
      ...structuredClone(TAI_LIEU),
      taiLieu: Array.from({ length: 1201 }, (_, i) => ({
        ...structuredClone(TAI_LIEU.taiLieu[2]), id: `d-${i}`, tieuDe: `Tài liệu ${i}`, noiDungBam: N3,
      })),
    };
    vi.mocked(layTaiLieuChoKhach).mockResolvedValue(nhieu);
    let lan = 0;
    vi.mocked(loaiTruTaiLieuChoKhach).mockImplementation(async (ds) => {
      lan++;
      if (lan === 2) throw { response: { status: 409, data: { error: 'Tài liệu không còn trong kho tri thức', code: 'KHONG_CO_TRONG_DANH_MUC' } } };
      return { doi: ds.length };
    });
    const w = gan();
    await flushPromises();
    await phan(w, 'tai-lieu').find('input[data-o="chon-het"]').setValue(true);
    expect(w.find('[data-nut="loai-tru-tai-lieu"]').text()).toBe('Loại trừ (1201)');
    await w.find('[data-nut="loai-tru-tai-lieu"]').trigger('click');
    expect(w.find('.vo-dialog').text()).toContain('gửi thành 3 lần (mỗi lần tối đa 500)');
    await w.find('.vo-dialog [data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(vi.mocked(loaiTruTaiLieuChoKhach).mock.calls.map((c) => c[0].length)).toEqual([500, 500, 201]);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('701'));
    const hop = w.find('.vo-dialog');
    expect(hop.exists()).toBe(true); // còn lô lỗi ⇒ hộp giữ mở với báo cáo
    expect(hop.text()).toContain('Lô 2/3 (500 mục): Tài liệu không còn trong kho tri thức');
    expect(w.find('[data-nut="loai-tru-tai-lieu"]').text()).toBe('Loại trừ (500)');
    w.unmount();
  });

  it('kho tri thức rỗng ⇒ câu "chưa có tài liệu nào"; chưa có danh mục SP ⇒ "Bot chưa gửi danh mục sản phẩm"', async () => {
    vi.mocked(layTaiLieuChoKhach).mockResolvedValue({ kho: { soTaiLieu: 0, luc: '2026-10-02T02:00:00.000Z' }, taiLieu: [], duyetNgoaiDanhMuc: [] });
    vi.mocked(layMoTaChoKhach).mockResolvedValue({ danhMuc: null, sanPham: [], dem: { coMoTa: 0, daDuyet: 0, doiSauDuyet: 0, chuaDuyet: 0, tong: 0 } });
    const w = gan();
    await flushPromises();
    expect(phan(w, 'tai-lieu').text()).toContain('Kho tri thức của CRM chưa có tài liệu nào');
    expect(phan(w, 'mo-ta').text()).toContain('Bot chưa gửi danh mục sản phẩm');
    w.unmount();
  });
});

describe('Tab "Cho khách" — mô tả SP', () => {
  it('chip trạng thái: "Mô tả đã đổi — cần duyệt lại"; số đếm ở bộ lọc', async () => {
    const w = gan();
    await flushPromises();
    expect(spHang(w, 12).find('[data-o="trang-thai"]').text()).toBe('Mô tả đã đổi — cần duyệt lại');
    expect(spHang(w, 11).find('[data-o="trang-thai"]').text()).toBe('Đã duyệt');
    expect(spHang(w, 13).find('[data-o="trang-thai"]').text()).toBe('Chưa duyệt');
    expect(spHang(w, 12).text()).toContain('Điện áp 24V');
    expect(w.find('[data-loc="doi_sau_duyet"]').text()).toContain('1');
    w.unmount();
  });

  it('duyệt một SP gửi ĐÚNG băm đang hiển thị (không phải băm đã duyệt cũ)', async () => {
    const w = gan();
    await flushPromises();
    expect(spHang(w, 11).text()).not.toContain('Duyệt lại');
    await nut(spHang(w, 12), 'Duyệt lại').trigger('click');
    await flushPromises();
    expect(duyetMoTaChoKhach).toHaveBeenCalledWith([{ productId: 12, moTaBam: B2 }]);
    expect(layMoTaChoKhach).toHaveBeenCalledTimes(2);
    w.unmount();
  });

  it('409 MO_TA_DA_DOI ⇒ hiện nguyên câu + tải lại danh sách', async () => {
    vi.mocked(duyetMoTaChoKhach).mockRejectedValue({
      response: { status: 409, data: { error: 'Mô tả đã đổi hoặc không còn trong danh mục (SP 13) — tải lại, đọc mô tả mới rồi duyệt', code: 'MO_TA_DA_DOI' } },
    });
    const w = gan();
    await flushPromises();
    await nut(spHang(w, 13), 'Duyệt').trigger('click');
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Mô tả đã đổi hoặc không còn trong danh mục'), 6000);
    expect(layMoTaChoKhach).toHaveBeenCalledTimes(2);
    w.unmount();
  });

  it('bộ lọc gọi API với loc; duyệt hàng loạt chỉ gửi SP chưa duyệt/đã đổi; bỏ duyệt hàng loạt', async () => {
    const w = gan();
    await flushPromises();
    await w.find('[data-loc="doi_sau_duyet"]').trigger('click');
    await flushPromises();
    expect(layMoTaChoKhach).toHaveBeenLastCalledWith('doi_sau_duyet');
    await w.find('[data-loc="co_mo_ta"]').trigger('click');
    await flushPromises();
    await phan(w, 'mo-ta').find('input[data-o="chon-het"]').setValue(true);
    await w.find('[data-nut="duyet-mo-ta"]').trigger('click');
    await w.find('.vo-dialog [data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(duyetMoTaChoKhach).toHaveBeenCalledWith([{ productId: 12, moTaBam: B2 }, { productId: 13, moTaBam: B3 }], undefined);
    await phan(w, 'mo-ta').find('input[data-o="chon-het"]').setValue(true);
    await w.find('[data-nut="bo-duyet-mo-ta"]').trigger('click');
    await w.find('.vo-dialog [data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(boDuyetMoTaChoKhach).toHaveBeenCalledWith([11, 12], undefined);
    w.unmount();
  });
});

describe('BotQuyenPage — tab "Cho khách"', () => {
  it('có tab "Cho khách"; bấm vào thì nạp danh mục', async () => {
    const w = mount(BotQuyenPage, { global: { components: VUETIFY_VO } });
    await flushPromises();
    const tab = w.findAll('button[role="tab"]').find((b) => b.text() === 'Cho khách');
    expect(tab).toBeTruthy();
    await tab!.trigger('click');
    await flushPromises();
    expect(layTaiLieuChoKhach).toHaveBeenCalled();
    expect(w.find('[data-phan="tai-lieu"]').exists()).toBe(true);
    w.unmount();
  });
});
