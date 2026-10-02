// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Tab "Cho khách" của trang Quyền bot (docs/79 T5), gắn với API giả:
//   • hai phần "Tài liệu khách xem được" + "Mô tả sản phẩm đã duyệt"; cảnh báo KHÔNG tick tài liệu nội bộ / bảng giá;
//   • tick hàng loạt ⇒ hộp xác nhận nêu tên tài liệu "có vẻ nội bộ" ⇒ gửi đúng id + lý do; tìm kiếm; xem mẫu nội dung;
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
  duyetTaiLieuChoKhach: vi.fn(),
  boDuyetTaiLieuChoKhach: vi.fn(),
  layMoTaChoKhach: vi.fn(),
  duyetMoTaChoKhach: vi.fn(),
  boDuyetMoTaChoKhach: vi.fn(),
}));
vi.mock('@/api/bot-quyen', () => ({
  layNguoiDungCrm: vi.fn().mockResolvedValue([]),
  layDanhSachNhom: vi.fn().mockResolvedValue([]),
  layNhatKy: vi.fn().mockResolvedValue([]),
  layDanhSachNhanVien: vi.fn().mockResolvedValue([]),
  layNguoiDaNhan: vi.fn().mockResolvedValue({ tong: 0, trang: 1, moiTrang: 30, gomLuc: null, ungVien: [] }),
}));

import {
  layTaiLieuChoKhach, duyetTaiLieuChoKhach, boDuyetTaiLieuChoKhach, layMoTaChoKhach, duyetMoTaChoKhach, boDuyetMoTaChoKhach,
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
const TAI_LIEU: DsTaiLieuChoKhach = {
  danhMuc: { phienBan: 'dm-1', luc: '2026-10-02T02:00:00.000Z' },
  duyetNgoaiDanhMuc: [],
  taiLieu: [
    { id: 'doc-1', tieuDe: 'Datasheet P10', loai: 'pdf', nguon: 'file-zalo', soDoan: 12, capNhatLuc: '2026-09-30T02:00:00.000Z',
      mauNoiDung: 'Module P10 full color 320x160', choKhach: true, duyetBoi: { id: 'u1', fullName: 'Nguyễn A' }, duyetLuc: '2026-10-01T02:00:00.000Z' },
    { id: 'doc-2', tieuDe: 'Bảng giá đại lý 2026', loai: 'pdf', nguon: 'file-zalo', soDoan: 4, capNhatLuc: null,
      mauNoiDung: 'Led dây 12V giá 125.000đ/m', choKhach: false, duyetBoi: null, duyetLuc: null },
    { id: 'doc-3', tieuDe: 'Hướng dẫn lắp', loai: null, nguon: 'nhap-tay', soDoan: 2, capNhatLuc: null,
      mauNoiDung: 'Bước 1: cắt nguồn', choKhach: false, duyetBoi: null, duyetLuc: null },
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
  vi.mocked(duyetTaiLieuChoKhach).mockResolvedValue({ doi: 2 });
  vi.mocked(boDuyetTaiLieuChoKhach).mockResolvedValue({ doi: 1 });
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
  it('hai phần + cảnh báo nội bộ nguyên văn; trạng thái từng tài liệu; cờ "có vẻ nội bộ" ở bảng giá', async () => {
    const w = gan();
    await flushPromises();
    expect(phan(w, 'tai-lieu').find('h2').text()).toBe('Tài liệu khách xem được');
    expect(phan(w, 'mo-ta').find('h2').text()).toBe('Mô tả sản phẩm đã duyệt');
    expect(w.find('[data-o="canh-bao-noi-bo"]').text()).toContain(
      'KHÔNG tick tài liệu nội bộ, bảng giá, báo giá, chiết khấu, công nợ',
    );
    expect(tlHang(w, 'doc-1').text()).toContain('Khách xem được');
    expect(tlHang(w, 'doc-2').text()).toContain('Chưa cho khách');
    expect(tlHang(w, 'doc-2').find('[data-o="noi-bo"]').exists()).toBe(true);
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

  it('tick hàng loạt ⇒ hộp xác nhận nêu tài liệu có vẻ nội bộ ⇒ gửi đúng id + lý do ⇒ tải lại', async () => {
    const w = gan();
    await flushPromises();
    expect(w.find('[data-nut="duyet-tai-lieu"]').exists()).toBe(false);
    await tlHang(w, 'doc-2').find('input[type="checkbox"]').setValue(true);
    await tlHang(w, 'doc-3').find('input[type="checkbox"]').setValue(true);
    await w.find('[data-nut="duyet-tai-lieu"]').trigger('click');
    const hop = w.find('.vo-dialog');
    expect(hop.text()).toContain('Cho khách xem 2 tài liệu?');
    expect(hop.text()).toContain('Bảng giá đại lý 2026');
    await hop.find('[data-o="ly-do"] input').setValue('datasheet công khai');
    await hop.find('[data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(duyetTaiLieuChoKhach).toHaveBeenCalledWith(['doc-2', 'doc-3'], 'datasheet công khai');
    expect(layTaiLieuChoKhach).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalled();
    w.unmount();
  });

  it('chọn tất cả (đang hiện) rồi "Bỏ cho khách" ⇒ chỉ gửi id đang cho khách', async () => {
    const w = gan();
    await flushPromises();
    await phan(w, 'tai-lieu').find('input[data-o="chon-het"]').setValue(true);
    await w.find('[data-nut="bo-duyet-tai-lieu"]').trigger('click');
    await w.find('.vo-dialog [data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(boDuyetTaiLieuChoKhach).toHaveBeenCalledWith(['doc-1'], undefined);
    w.unmount();
  });

  it('chưa có danh mục ⇒ câu "Bot chưa gửi danh mục"', async () => {
    vi.mocked(layTaiLieuChoKhach).mockResolvedValue({ danhMuc: null, taiLieu: [], duyetNgoaiDanhMuc: [] });
    vi.mocked(layMoTaChoKhach).mockResolvedValue({ danhMuc: null, sanPham: [], dem: { coMoTa: 0, daDuyet: 0, doiSauDuyet: 0, chuaDuyet: 0, tong: 0 } });
    const w = gan();
    await flushPromises();
    expect(phan(w, 'tai-lieu').text()).toContain('Bot chưa gửi danh mục tài liệu');
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
