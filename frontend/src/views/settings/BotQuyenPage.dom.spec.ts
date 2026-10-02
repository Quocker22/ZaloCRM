// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// BotQuyenPage — trang Cài đặt › Hệ thống › "Quyền bot" (docs/77 §3.3), gắn với API giả:
//   • nhóm chưa xếp loại hiện nhãn ĐỎ "Bot đang im — chưa xếp loại";
//   • ngăn thành viên cảnh báo "người ngoài làm bot im" (trừ nhóm Khách);
//   • thay đổi làm bot BỚT quyền mà không ghi lý do ⇒ bị chặn ngay trong hộp, KHÔNG gửi lên máy chủ;
//   • lỗi backend (409 ADMIN_CUOI…) hiện nguyên câu `error` trong toast + trong hộp.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, h, inject, provide, type PropType } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import type { NhanVien, NhatKy, NhomView, ThanhVienNhom, TrangNguoiDaNhan } from '@/api/bot-quyen';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@/composables/use-toast', () => ({ useToast: () => toast }));
vi.mock('@/api/bot-quyen', () => ({
  layDanhSachNhom: vi.fn(),
  layThanhVienNhom: vi.fn(),
  luuChucNangNhom: vi.fn(),
  boXepLoaiNhom: vi.fn(),
  layDanhSachNhanVien: vi.fn(),
  themNhanVien: vi.fn(),
  suaNhanVien: vi.fn(),
  layNhatKy: vi.fn(),
  layNguoiDungCrm: vi.fn(),
  layNguoiDaNhan: vi.fn(),
  docLaiThanhVienNhom: vi.fn(),
  themUidNhanVien: vi.fn(),
  goUidNhanVien: vi.fn(),
  noiDeXuat: vi.fn(),
  tuChoiDeXuat: vi.fn(),
  danhDauNickCrm: vi.fn(),
  goNickCrm: vi.fn(),
}));

import {
  layDanhSachNhom, layThanhVienNhom, luuChucNangNhom, boXepLoaiNhom,
  layDanhSachNhanVien, themNhanVien, suaNhanVien, layNhatKy, layNguoiDungCrm, layNguoiDaNhan, docLaiThanhVienNhom,
  themUidNhanVien, goUidNhanVien, noiDeXuat, tuChoiDeXuat, danhDauNickCrm, goNickCrm,
} from '@/api/bot-quyen';
import BotQuyenPage from './BotQuyenPage.vue';

// ── Vỏ Vuetify (khuôn các *.dom.spec.ts khác): thẻ HTML thường, ô nhập/chọn có v-model thật ──
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
  props: { modelValue: { type: [String, Number], default: '' }, label: String, readonly: Boolean },
  emits: ['update:modelValue'],
  setup(p, { emit }) {
    return () => h('label', { class: 'vo-nhap' }, [
      h('span', p.label),
      h('input', {
        value: p.modelValue ?? '',
        readonly: p.readonly,
        onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value),
      }),
    ]);
  },
});
type MucChon = Record<string, unknown>;
const VoChon = defineComponent({
  name: 'VoChon',
  props: {
    modelValue: { type: null as unknown as PropType<unknown>, default: null },
    items: { type: Array as PropType<MucChon[]>, default: () => [] },
    label: String,
    itemTitle: { type: String, default: 'title' },
    itemValue: { type: String, default: 'value' },
  },
  emits: ['update:modelValue'],
  setup(p, { emit }) {
    const gt = (it: MucChon) => (it[p.itemValue] ?? null);
    return () => h('label', { class: 'vo-chon' }, [
      h('span', p.label),
      h('select', {
        value: p.modelValue == null ? '' : String(p.modelValue),
        onChange: (e: Event) => {
          const s = (e.target as HTMLSelectElement).value;
          const it = p.items.find((x) => String(gt(x) ?? '') === s);
          emit('update:modelValue', it ? gt(it) : null);
        },
      }, p.items.map((it) => h('option', { value: String(gt(it) ?? '') }, String(it[p.itemTitle] ?? '')))),
    ]);
  },
});
const VoCongTac = defineComponent({
  name: 'VoCongTac',
  props: { modelValue: Boolean, label: String },
  emits: ['update:modelValue'],
  setup(p, { emit }) {
    return () => h('label', { class: 'vo-cong-tac' }, [
      h('input', { type: 'checkbox', checked: p.modelValue, onChange: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).checked) }),
      p.label,
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
/** v-menu: kích hoạt + nội dung luôn hiện (đủ để bấm mục). */
const VoMenu = defineComponent({
  name: 'VoMenu',
  setup(_, { slots }) {
    return () => h('div', { class: 'vo-menu' }, [slots.activator?.({ props: {} }), slots.default?.()]);
  },
});
const VoMucDs = defineComponent({
  name: 'VoMucDs',
  props: { title: String, subtitle: String },
  setup(p) {
    return () => h('button', { class: 'vo-muc' }, [p.title, p.subtitle ? ` (${p.subtitle})` : '']);
  },
});
const VUETIFY_VO = {
  VBtn: vo('button'), VIcon: vo('i'), VAlert: vo('div'), VDialog: VoDialog, VCard: vo('div'), VCardText: vo('div'),
  VCardActions: vo('div'), VSpacer: vo('span'), VTextField: VoNhap, VSelect: VoChon, VSwitch: VoCongTac,
  VTable: vo('table'), VProgressLinear: vo('div'), VChip: vo('span'), VDivider: vo('hr'), VTabs: VoTabs, VTab: VoTab,
  VThemeProvider: vo('div'), VMenu: VoMenu, VList: vo('div'), VListItem: VoMucDs, VCardTitle: vo('div'),
};

// ── Dữ liệu ──
const nick = { id: 'nickHN', displayName: 'Nick HN', zaloUid: '900', status: 'connected' };
const MD_CHUA_DOC = {
  chucNang: null, lyDo: 'chua_doc', soThanhVien: 0, soNguoiNgoai: 0, soNickKhac: 0, soNguoiNghi: 0, nguoiNgoai: [],
  docLuc: null, loiDoc: null, thuLuc: null, thuLaiSau: null, khongTra: false,
} as const;
// Mặc định (docs/77 §8): không nêu thì "chưa đọc danh sách" — chức năng hiệu lực = chức năng tường minh.
const nhom = (them: Partial<NhomView>): NhomView => {
  const r = {
    conversationId: 'c', externalThreadId: 't', tenNhom: 'Nhóm', soThanhVien: 6, lastMessageAt: null, daAn: false, nick,
    chucNang: null, tenDangKy: null, ghiChu: null, capNhatLuc: null, capNhatBoi: null,
    macDinh: { ...MD_CHUA_DOC, nguoiNgoai: [] as string[] }, ...them,
  } as NhomView;
  return { ...r, chucNangHieuLuc: them.chucNangHieuLuc ?? r.chucNang, laMacDinh: them.laMacDinh ?? !r.chucNang };
};
const DS_NHOM: NhomView[] = [
  nhom({ conversationId: 'c1', tenNhom: 'Nhóm mới lập' }),
  nhom({
    conversationId: 'c2', tenNhom: 'Sales HN', chucNang: 'admin', tenDangKy: 'Sales HN',
    capNhatLuc: '2026-09-30T02:00:00.000Z', capNhatBoi: { id: 'u1', fullName: 'Nguyễn A' },
  }),
  nhom({ conversationId: 'c3', tenNhom: 'Khách Minh Long', chucNang: 'khach', tenDangKy: '' }),
  nhom({ conversationId: 'c4', tenNhom: 'Nhóm cũ đã ẩn', daAn: true }),
  // Mặc định theo thành viên (docs/77 §8)
  nhom({
    conversationId: 'c5', tenNhom: 'Kho Đông Anh', chucNangHieuLuc: 'sales', laMacDinh: true,
    macDinh: { ...MD_CHUA_DOC, chucNang: 'sales', lyDo: 'toan_nhan_vien', soThanhVien: 4, nguoiNgoai: [] },
  }),
  nhom({
    conversationId: 'c6', tenNhom: 'Công trình Minh Long', chucNangHieuLuc: 'khach', laMacDinh: true,
    macDinh: { ...MD_CHUA_DOC, chucNang: 'khach', lyDo: 'co_nguoi_ngoai', soThanhVien: 5, soNguoiNgoai: 2, nguoiNgoai: ['a', 'b'] },
  }),
];
const CHO_GAN: TrangNguoiDaNhan = {
  tong: 2, trang: 1, moiTrang: 30, gomLuc: '2026-09-30T08:00:00.000Z',
  ungVien: [
    {
      // Cùng một người ở hai nick (docs/77 §8b) — một dòng, hai uid.
      zaloUid: '777', ten: 'Trần Hưng', luc: '2026-09-30T07:00:00.000Z', soNoi: 2, dangSaiBot: true,
      uids: [{ zaloUid: '777', nick: { id: 'nickHN', ten: 'Nick HN' } }, { zaloUid: '778', nick: { id: 'nickHCM', ten: 'Nick HCM' } }],
      anTen: false, anTinCuoi: false, redacted: false,
      tinCuoi: { noiDung: 'lên đơn cho khách A', loai: 'text', luc: '2026-09-30T07:00:00.000Z' },
      noi: [
        { conversationId: 'c5', loai: 'nhom', tenNhom: 'Kho Đông Anh', nick: { id: 'nickHN', ten: 'Nick HN' }, luc: null },
        { conversationId: 'd1', loai: 'rieng', tenNhom: null, nick: { id: 'nickHN', ten: 'Nick HN' }, luc: null },
      ],
    },
    {
      zaloUid: '888', ten: 'Khách Đức', luc: '2026-09-30T06:00:00.000Z', soNoi: 1, dangSaiBot: false, tinCuoi: null,
      uids: [{ zaloUid: '888', nick: { id: 'nickHCM', ten: 'Nick HCM' } }],
      anTen: false, anTinCuoi: false, redacted: false,
      noi: [{ conversationId: 'd2', loai: 'rieng', tenNhom: null, nick: { id: 'nickHCM', ten: 'Nick HCM' }, luc: null }],
    },
  ],
};
const THANH_VIEN_C2: ThanhVienNhom = {
  conversationId: 'c2', nguon: 'da_quet', nguonLuc: '2026-09-30T02:05:00.000Z', loiZalo: null, soNguoiNgoai: 2,
  thanhVien: [
    { zaloUid: '100', ten: 'Anh Quyết', loai: 'nhan_vien', laNickCrm: false, nhanVien: { id: 'n1', tenGoi: 'Quyết', vai: 'admin', trangThai: 'hoat_dong' } },
    { zaloUid: '900', ten: 'Nick HN', loai: 'nick_crm', laNickCrm: true, nhanVien: null },
    { zaloUid: '555', ten: 'Chị Lan', loai: 'nguoi_ngoai', laNickCrm: false, nhanVien: null },
    { zaloUid: '901', ten: 'Nick HCM', loai: 'nguoi_ngoai', laNickCrm: true, nhanVien: null },
  ],
};
const NV_QUYET: NhanVien = {
  id: 'n1', zaloUid: '100', tenGoi: 'Quyết', vai: 'admin', trangThai: 'hoat_dong', userId: null, user: null,
  uids: [
    { zaloUid: '100', nick: { id: 'nickHN', ten: 'Nick HN', zaloUid: '900' }, nguon: 'chon' },
    { zaloUid: '101', nick: { id: 'nickHCM', ten: 'Nick HCM', zaloUid: '901' }, nguon: 'zalo_global_id', bangChung: { globalId: 'G-Q', uidGoc: '100' } },
  ],
  deXuat: [{ zaloUid: '102', nick: { id: 'nickCL', ten: 'Nick CL', zaloUid: '902' }, soTin: 7 }],
  ghiChu: null, capNhatLuc: '2026-09-30T01:00:00.000Z', capNhatBoi: null,
};
const NHAT_KY: NhatKy[] = [{
  id: 'k1', luc: '2026-09-30T03:00:00.000Z', aiId: 'u1', ai: { id: 'u1', fullName: 'Nguyễn A' }, tuDong: false, doiTuong: 'nhom',
  doiTuongId: 'c2', tenDoiTuong: 'Sales HN', truoc: { chucNang: 'sales', tenDangKy: 'Sales HN', ghiChu: null },
  sau: { chucNang: 'admin', tenDangKy: 'Sales HN', ghiChu: null }, lyDo: 'nhóm quản lý',
}, {
  id: 'k2', luc: '2026-09-30T04:00:00.000Z', aiId: 'tu_dong', ai: null, tuDong: true, doiTuong: 'nhom',
  doiTuongId: 'c3', tenDoiTuong: 'Kho HN', truoc: { chucNang: 'sales', macDinh: true },
  sau: { chucNang: 'khach', macDinh: true }, lyDo: 'có người ngoài vào nhóm: Lạ Văn A',
}];

const loi409 = {
  response: { status: 409, data: { error: 'Đây là admin đang hoạt động cuối cùng — phải luôn còn ít nhất một admin', code: 'ADMIN_CUOI' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.mocked(layDanhSachNhom).mockResolvedValue(DS_NHOM.map((n) => ({ ...n })));
  vi.mocked(layThanhVienNhom).mockResolvedValue(structuredClone(THANH_VIEN_C2));
  vi.mocked(luuChucNangNhom).mockResolvedValue({ doi: true });
  vi.mocked(boXepLoaiNhom).mockResolvedValue({ doi: true });
  vi.mocked(layDanhSachNhanVien).mockResolvedValue([{ ...NV_QUYET }]);
  vi.mocked(layNhatKy).mockResolvedValue(NHAT_KY);
  vi.mocked(layNguoiDungCrm).mockResolvedValue([{ id: 'u1', fullName: 'Nguyễn A' }]);
  vi.mocked(layNguoiDaNhan).mockResolvedValue(structuredClone(CHO_GAN));
  vi.mocked(docLaiThanhVienNhom).mockResolvedValue(undefined);
});

function gan() {
  return mount(BotQuyenPage, { global: { components: VUETIFY_VO } });
}
type W = VueWrapper<InstanceType<typeof BotQuyenPage>>;
const nut = (w: W | ReturnType<W['find']>, chu: string) => {
  const b = w.findAll('button').find((x) => x.text().trim() === chu);
  if (!b) throw new Error(`Không thấy nút "${chu}"`);
  return b;
};
const hang = (w: W, id: string) => w.find(`tr[data-id="${id}"]`);

describe('BotQuyenPage — tab Nhóm', () => {
  it('dòng "hiệu lực trong khoảng 1 phút"; nhóm chưa xếp loại hiện nhãn ĐỎ "Bot đang im — chưa xếp loại"; nhóm đã ẩn giấu mặc định', async () => {
    const w = gan();
    await flushPromises();
    expect(w.text()).toContain('Thay đổi có hiệu lực trên bot trong khoảng 1 phút.');
    const im = hang(w, 'c1').find('.bq-bot');
    expect(im.text()).toContain('Bot đang im — chưa xếp loại');
    expect(im.classes()).toContain('bq-bot--do');
    expect(hang(w, 'c2').find('.bq-bot').text()).toContain('Bot trả lời trong nhóm');
    expect(hang(w, 'c2').find('.bq-bot').classes()).not.toContain('bq-bot--do');
    expect(hang(w, 'c3').find('.bq-bot').text()).toContain('Nhóm có khách — bot im');
    expect(hang(w, 'c4').exists()).toBe(false);
    await w.find('.vo-cong-tac input').setValue(true);
    expect(hang(w, 'c4').exists()).toBe(true);
    w.unmount();
  });

  it('ngăn thành viên: nguồn danh sách, nhãn từng người, cảnh báo người ngoài nguyên văn', async () => {
    const w = gan();
    await flushPromises();
    await nut(hang(w, 'c2'), 'Thành viên').trigger('click');
    await flushPromises();
    expect(layThanhVienNhom).toHaveBeenCalledWith('c2', { lamMoi: false });
    const ngan = w.find('.bq-ngan');
    expect(ngan.find('.bq-nguon').text()).toContain('Theo lần quét lúc 30/09/2026 09:05');
    expect(ngan.find('.bq-canh-bao').text()).toContain(
      'Nhóm có 2 người ngoài — bot sẽ im trong nhóm này cho tới khi anh/chị xếp họ là nhân viên hoặc người công ty, hoặc đổi nhóm sang Khách.',
    );
    expect(ngan.find('li[data-uid="100"]').text()).toContain('Nhân viên · Quản trị');
    expect(ngan.find('li[data-uid="900"]').text()).toContain('Nick của nhóm');
    expect(ngan.find('li[data-uid="555"]').text()).toContain('Người ngoài');
    expect(ngan.find('li[data-uid="901"]').text()).toContain('Nick CRM khác');
    // Chỉ người ngoài mới có nút xếp
    expect(ngan.find('li[data-uid="100"]').text()).not.toContain('Đặt làm nhân viên');
    expect(ngan.find('li[data-uid="555"]').text()).toContain('Đặt làm nhân viên');
    expect(ngan.find('li[data-uid="555"]').text()).toContain('Là người công ty (không dùng bot)');
    // "Đọc lại từ Zalo" = lamMoi
    await nut(ngan, 'Đọc lại từ Zalo').trigger('click');
    await flushPromises();
    expect(layThanhVienNhom).toHaveBeenLastCalledWith('c2', { lamMoi: true });
    w.unmount();
  });

  it('nhóm Khách có người ngoài ⇒ KHÔNG cảnh báo (bot vốn im)', async () => {
    vi.mocked(layThanhVienNhom).mockResolvedValue({ ...structuredClone(THANH_VIEN_C2), conversationId: 'c3' });
    const w = gan();
    await flushPromises();
    await nut(hang(w, 'c3'), 'Thành viên').trigger('click');
    await flushPromises();
    expect(w.find('.bq-ngan').exists()).toBe(true);
    expect(w.find('.bq-canh-bao').exists()).toBe(false);
    expect(w.text()).not.toContain('người ngoài — bot sẽ im');
    w.unmount();
  });

  it('đổi Quản trị → Khách KHÔNG ghi lý do ⇒ hộp báo cần lý do, không gửi; ghi lý do ⇒ lưu', async () => {
    const w = gan();
    await flushPromises();
    await nut(hang(w, 'c2'), 'Đổi').trigger('click');
    const hop = () => w.find('.bq-xep-loai');
    expect(hop().exists()).toBe(true);
    await hop().find('[data-gia-tri="khach"]').trigger('click');
    expect(hop().find('.bq-he-qua').text()).toContain('Nhóm có khách: bot im, không trả lời gì trong nhóm (giữ kín giá, SĐT, đơn).');
    await hop().find('[data-nut="luu"]').trigger('click');
    await flushPromises();
    expect(hop().exists()).toBe(true);
    expect(hop().find('.bq-loi').text()).toContain('Cần ghi lý do');
    expect(luuChucNangNhom).not.toHaveBeenCalled();

    await hop().find('[data-o="ly-do"] input').setValue('  nhóm có khách vào  ');
    await hop().find('[data-nut="luu"]').trigger('click');
    await flushPromises();
    expect(luuChucNangNhom).toHaveBeenCalledWith('c2', { chucNang: 'khach', tenDangKy: 'Sales HN', ghiChu: '', lyDo: 'nhóm có khách vào' });
    expect(w.find('.bq-xep-loai').exists()).toBe(false);
    expect(toast.success).toHaveBeenCalled();
    expect(layDanhSachNhom).toHaveBeenCalledTimes(2);
    w.unmount();
  });

  it('mỗi lựa chọn có câu hệ quả; "Theo mặc định" (bỏ xếp tường minh) không lý do ⇒ chặn', async () => {
    const w = gan();
    await flushPromises();
    await nut(hang(w, 'c2'), 'Đổi').trigger('click');
    const hop = w.find('.bq-xep-loai');
    expect(hop.find('[data-gia-tri="admin"]').text()).toContain('Mọi người trong nhóm hỏi được mọi thứ');
    expect(hop.find('[data-gia-tri="kho"]').text()).toContain('thêm quyền kho (nhập, chuyển kho)');
    // docs/77 §8: bỏ xếp tường minh = về mặc định theo thành viên (nhóm này chưa đọc được danh sách ⇒ bot im).
    expect(hop.find('[data-gia-tri="bo"]').text()).toContain('Theo mặc định (tự theo thành viên)');
    expect(hop.find('[data-gia-tri="bo"]').text()).toContain('chưa có — chưa đọc được danh sách thành viên (bot im)');
    await hop.find('[data-gia-tri="bo"]').trigger('click');
    await w.find('.bq-xep-loai [data-nut="luu"]').trigger('click');
    await flushPromises();
    expect(w.find('.bq-xep-loai .bq-loi').text()).toContain('Cần ghi lý do');
    expect(boXepLoaiNhom).not.toHaveBeenCalled();
    w.unmount();
  });

  it('xếp loại lần đầu (không bớt quyền) ⇒ không cần lý do; tên đăng ký mặc định = tên nhóm', async () => {
    const w = gan();
    await flushPromises();
    await nut(hang(w, 'c1'), 'Xếp loại').trigger('click');
    const hop = w.find('.bq-xep-loai');
    expect((hop.find('[data-o="ten-dang-ky"] input').element as HTMLInputElement).value).toBe('Nhóm mới lập');
    expect(hop.find('[data-gia-tri="bo"]').exists()).toBe(false);
    await hop.find('[data-gia-tri="sales"]').trigger('click');
    await hop.find('[data-nut="luu"]').trigger('click');
    await flushPromises();
    expect(luuChucNangNhom).toHaveBeenCalledWith('c1', { chucNang: 'sales', tenDangKy: 'Nhóm mới lập', ghiChu: '' });
    w.unmount();
  });

  it('lỗi backend 4xx ⇒ toast nguyên câu `error`, hộp vẫn mở', async () => {
    vi.mocked(luuChucNangNhom).mockRejectedValue({ response: { status: 400, data: { error: 'tenDangKy dài quá 100 ký tự', code: 'DU_LIEU_KHONG_HOP_LE' } } });
    const w = gan();
    await flushPromises();
    await nut(hang(w, 'c1'), 'Xếp loại').trigger('click');
    await w.find('.bq-xep-loai [data-gia-tri="sales"]').trigger('click');
    await w.find('.bq-xep-loai [data-nut="luu"]').trigger('click');
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith('tenDangKy dài quá 100 ký tự', expect.anything());
    expect(w.find('.bq-xep-loai .bq-loi').text()).toContain('tenDangKy dài quá 100 ký tự');
    w.unmount();
  });

  it('"Là người công ty" từ ngăn thành viên: thiếu lý do ⇒ chặn; có lý do ⇒ tạo vai cong_ty, nhãn + cảnh báo cập nhật', async () => {
    vi.mocked(themNhanVien).mockResolvedValue({
      ...NV_QUYET, id: 'n9', zaloUid: '901', tenGoi: 'Nick HCM', vai: 'cong_ty',
    });
    const w = gan();
    await flushPromises();
    await nut(hang(w, 'c2'), 'Thành viên').trigger('click');
    await flushPromises();
    await nut(w.find('li[data-uid="901"]'), 'Là người công ty (không dùng bot)').trigger('click');
    const hop = () => w.find('.bq-nv-dialog');
    expect(hop().exists()).toBe(true);
    expect((hop().find('[data-o="ten-goi"] input').element as HTMLInputElement).value).toBe('Nick HCM');
    await hop().find('[data-nut="luu"]').trigger('click');
    await flushPromises();
    expect(hop().find('.bq-loi').text()).toContain('Cần ghi lý do');
    expect(themNhanVien).not.toHaveBeenCalled();

    await hop().find('[data-o="ly-do"] input').setValue('nick chi nhánh HCM');
    await hop().find('[data-nut="luu"]').trigger('click');
    await flushPromises();
    expect(themNhanVien).toHaveBeenCalledWith(expect.objectContaining({
      zaloUid: '901', tenGoi: 'Nick HCM', vai: 'cong_ty', trangThai: 'hoat_dong', lyDo: 'nick chi nhánh HCM',
    }));
    expect(w.find('.bq-nv-dialog').exists()).toBe(false);
    expect(w.find('li[data-uid="901"]').text()).toContain('Người công ty (không dùng bot)');
    expect(w.find('.bq-canh-bao').text()).toContain('Nhóm có 1 người ngoài');
    w.unmount();
  });
});

describe('BotQuyenPage — mặc định chức năng nhóm (docs/77 §8)', () => {
  it('chip mặc định + lý do; cố định cho nhóm chủ chọn; chưa biết thành viên ⇒ "Chưa xếp loại" + nút Đọc lại', async () => {
    const w = gan();
    await flushPromises();
    expect(hang(w, 'c5').find('[data-o="chuc-nang"]').text()).toBe('Nhóm nhân viên (mặc định)');
    expect(hang(w, 'c5').find('[data-o="ly-do-mac-dinh"]').text()).toBe('toàn nhân viên (4 người)');
    expect(hang(w, 'c5').find('.bq-bot').text()).toContain('Bot trả lời trong nhóm');
    expect(hang(w, 'c6').find('[data-o="chuc-nang"]').text()).toBe('Khách (mặc định)');
    expect(hang(w, 'c6').find('[data-o="ly-do-mac-dinh"]').text()).toBe('có 2 người ngoài');
    expect(hang(w, 'c6').find('.bq-bot').text()).toContain('Nhóm có khách — bot im');
    expect(hang(w, 'c2').text()).toContain('cố định');
    expect(hang(w, 'c1').find('[data-o="ly-do-mac-dinh"]').text()).toBe('chưa đọc được danh sách thành viên');
    // Chỉ đếm nhóm bot im vì không xếp + không có mặc định (c1).
    expect(w.find('.bq-tom-tat').text()).toContain('1 nhóm chưa xếp loại');
    await nut(hang(w, 'c1'), 'Đọc lại').trigger('click');
    await flushPromises();
    expect(docLaiThanhVienNhom).toHaveBeenCalledWith('c1');
    expect(() => nut(hang(w, 'c5'), 'Đọc lại')).toThrow();
    w.unmount();
  });

  it('nhóm theo mặc định: "Cố định" mở hộp chọn sẵn giá trị mặc định, Lưu không cần lý do', async () => {
    const w = gan();
    await flushPromises();
    await nut(hang(w, 'c5'), 'Cố định').trigger('click');
    const hop = w.find('.bq-xep-loai');
    expect(hop.text()).toContain('Cố định chức năng nhóm');
    expect(hop.find('[data-o="mac-dinh"]').text()).toContain('Nhóm nhân viên — toàn nhân viên (4 người)');
    expect(hop.find('[data-gia-tri="sales"]').attributes('aria-checked')).toBe('true');
    expect(hop.find('[data-gia-tri="bo"]').exists()).toBe(false);
    await hop.find('[data-nut="luu"]').trigger('click');
    await flushPromises();
    expect(luuChucNangNhom).toHaveBeenCalledWith('c5', expect.objectContaining({ chucNang: 'sales' }));
    w.unmount();
  });

  it('ngăn thành viên theo chức năng HIỆU LỰC: nhóm mặc định Khách có người ngoài ⇒ không cảnh báo', async () => {
    vi.mocked(layThanhVienNhom).mockResolvedValue({ ...structuredClone(THANH_VIEN_C2), conversationId: 'c6' });
    const w = gan();
    await flushPromises();
    await nut(hang(w, 'c6'), 'Thành viên').trigger('click');
    await flushPromises();
    expect(w.find('.bq-ngan').text()).toContain('Khách (mặc định)');
    expect(w.find('.bq-canh-bao').exists()).toBe(false);
    w.unmount();
  });
});

describe('BotQuyenPage — Chờ gán: người đã nhắn cho shop (docs/77 §8)', () => {
  async function moTab() {
    const w = gan();
    await flushPromises();
    await nut(w, 'Nhân viên').trigger('click');
    await flushPromises();
    return w;
  }

  it('liệt kê người đã nhắn: tên, chip "đang sai bot", tin gần nhất, ở đâu (nick), vai chọn sẵn', async () => {
    const w = await moTab();
    expect(layNguoiDaNhan).toHaveBeenCalledWith(expect.objectContaining({ trang: 1, moiTrang: 30 }));
    const cg = w.find('.bq-cho-gan');
    expect(cg.text()).toContain('Chờ gán — người đã nhắn cho shop (2)');
    const hung = cg.find('tr[data-uid="777"]');
    expect(hung.text()).toContain('Trần Hưng');
    expect(hung.text()).toContain('đang sai bot');
    expect(hung.text()).toContain('lên đơn cho khách A');
    expect(hung.text()).toContain('Nhóm “Kho Đông Anh” · nick Nick HN');
    expect(hung.text()).toContain('Tin riêng · nick Nick HN');
    expect(cg.find('tr[data-uid="888"]').text()).not.toContain('đang sai bot');
    expect(cg.find('tr[data-uid="888"]').text()).toContain('Tin riêng · nick Nick HCM');
    expect((hung.find('select').element as HTMLSelectElement).value).toBe('sales');
    w.unmount();
  });

  it('chọn vai rồi Gán ⇒ hộp xác nhận điền sẵn (uid khoá, tên, vai) ⇒ tạo NV ⇒ tải lại cả hai danh sách', async () => {
    vi.mocked(themNhanVien).mockResolvedValue({ ...NV_QUYET, id: 'n7', zaloUid: '777', tenGoi: 'Trần Hưng', vai: 'kho' });
    const w = await moTab();
    const hung = w.find('.bq-cho-gan tr[data-uid="777"]');
    await hung.find('select').setValue('kho');
    await nut(hung, 'Gán').trigger('click');
    const hop = w.find('.bq-nv-dialog');
    expect(hop.text()).toContain('Gán “Trần Hưng” làm nhân viên');
    expect(hop.text()).toContain('Cùng một người ở 2 nick — gán cả 2 uid: 777 · nick Nick HN; 778 · nick Nick HCM');
    expect(hop.find('[data-o="zalo-uid"] input').attributes('readonly')).toBeDefined();
    expect((hop.find('[data-o="zalo-uid"] input').element as HTMLInputElement).value).toBe('777');
    expect((hop.find('[data-o="vai"] select').element as HTMLSelectElement).value).toBe('kho');
    const soLanTai = vi.mocked(layNguoiDaNhan).mock.calls.length;
    const soLanNv = vi.mocked(layDanhSachNhanVien).mock.calls.length;
    await hop.find('[data-nut="luu"]').trigger('click');
    await flushPromises();
    expect(themNhanVien).toHaveBeenCalledWith(expect.objectContaining({
      zaloUid: '777', zaloUids: ['778'], tenGoi: 'Trần Hưng', vai: 'kho',
    }));
    expect(vi.mocked(layNguoiDaNhan).mock.calls.length).toBeGreaterThan(soLanTai);
    expect(vi.mocked(layDanhSachNhanVien).mock.calls.length).toBeGreaterThan(soLanNv);
    w.unmount();
  });

  it('mỗi dòng hiện MỌI uid theo nick (docs/77 §8b)', async () => {
    const w = await moTab();
    const hung = w.find('.bq-cho-gan tr[data-uid="777"]');
    expect(hung.text()).toContain('777 · nick Nick HN');
    expect(hung.text()).toContain('778 · nick Nick HCM');
    w.unmount();
  });

  it('"Là NV đã có" ⇒ chọn NV ⇒ xác nhận ⇒ thêm MỌI uid của dòng vào NV đó ⇒ tải lại', async () => {
    vi.mocked(themUidNhanVien).mockResolvedValue({ nhanVien: { ...NV_QUYET }, doi: true });
    vi.mocked(layDanhSachNhanVien).mockResolvedValue([{ ...NV_QUYET }, { ...NV_QUYET, id: 'n9', tenGoi: 'Khách Đức', uids: [] }]);
    const w = await moTab();
    const duc = w.find('.bq-cho-gan tr[data-uid="888"]');
    const muc = duc.findAll('.vo-muc');
    // trùng tên lên đầu, có nhãn
    expect(muc[0].text()).toBe('Khách Đức (trùng tên)');
    await muc[1].trigger('click');
    expect(w.text()).toContain('Thêm Zalo này vào “Quyết”?');
    const soLanTai = vi.mocked(layNguoiDaNhan).mock.calls.length;
    // lý do BẮT BUỘC (§8b-an-toàn P2): chưa ghi ⇒ nút tắt, không gửi
    expect(w.find('[data-nut="xac-nhan-gop"]').attributes('disabled')).toBeDefined();
    await w.find('[data-nut="xac-nhan-gop"]').trigger('click');
    await flushPromises();
    expect(themUidNhanVien).not.toHaveBeenCalled();
    await w.find('[data-o="ly-do-gop"] input').setValue('cùng người ở nick HCM');
    await w.find('[data-nut="xac-nhan-gop"]').trigger('click');
    await flushPromises();
    expect(themUidNhanVien).toHaveBeenCalledWith('n1', { zaloUids: ['888'], lyDo: 'cùng người ở nick HCM' });
    expect(vi.mocked(layNguoiDaNhan).mock.calls.length).toBeGreaterThan(soLanTai);
    w.unmount();
  });

  it('gán vai người công ty ⇒ cần lý do (như mọi chỗ khác)', async () => {
    const w = await moTab();
    const duc = w.find('.bq-cho-gan tr[data-uid="888"]');
    await duc.find('select').setValue('cong_ty');
    await nut(duc, 'Gán').trigger('click');
    await w.find('.bq-nv-dialog [data-nut="luu"]').trigger('click');
    await flushPromises();
    expect(w.find('.bq-nv-dialog .bq-loi').text()).toContain('Cần ghi lý do');
    expect(themNhanVien).not.toHaveBeenCalled();
    w.unmount();
  });
});

describe('BotQuyenPage — tab Nhân viên', () => {
  async function moSuaQuyet() {
    const w = gan();
    await flushPromises();
    await nut(w, 'Nhân viên').trigger('click');
    await flushPromises();
    expect(hang(w, 'n1').text()).toContain('Quyết');
    expect(hang(w, 'n1').text()).toContain('100');
    // mọi uid của NV, theo nick (docs/77 §8b)
    expect(hang(w, 'n1').text()).toContain('nick Nick HN');
    expect(hang(w, 'n1').text()).toContain('101');
    expect(hang(w, 'n1').text()).toContain('nick Nick HCM · globalId Zalo trùng');
    await nut(hang(w, 'n1'), 'Sửa').trigger('click');
    return w;
  }

  it('khoá mà KHÔNG ghi lý do ⇒ chặn, không gửi; Zalo uid chỉ đọc khi sửa', async () => {
    const w = await moSuaQuyet();
    const hop = w.find('.bq-nv-dialog');
    expect(hop.find('[data-o="zalo-uid"] input').attributes('readonly')).toBeDefined();
    await hop.find('[data-o="trang-thai"] select').setValue('khoa');
    expect(w.find('.bq-nv-dialog .bq-he-qua').text()).toContain('không nhận lệnh');
    await w.find('.bq-nv-dialog [data-nut="luu"]').trigger('click');
    await flushPromises();
    expect(w.find('.bq-nv-dialog .bq-loi').text()).toContain('Cần ghi lý do');
    expect(suaNhanVien).not.toHaveBeenCalled();
    w.unmount();
  });

  it('ĐỀ XUẤT (tin chung): câu "Đề xuất: uid … — bằng chứng: N tin trùng"; "Nối" (lý do tuỳ chọn) / "Không phải" gọi đúng API', async () => {
    vi.mocked(noiDeXuat).mockResolvedValue({ nhanVien: { ...NV_QUYET }, doi: true });
    vi.mocked(tuChoiDeXuat).mockResolvedValue({ doi: true });
    const w = gan();
    await flushPromises();
    await nut(w, 'Nhân viên').trigger('click');
    await flushPromises();
    const dx = hang(w, 'n1').find('[data-de-xuat="102"]');
    expect(dx.text()).toContain('Đề xuất: uid 102 trên nick Nick CL có vẻ là cùng người — bằng chứng: 7 tin trùng');
    await dx.find('[data-nut="noi-de-xuat"]').trigger('click');
    expect(w.text()).toContain('Nối Zalo 102 vào “Quyết”?');
    await w.find('[data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(noiDeXuat).toHaveBeenCalledWith('n1', '102', undefined);
    await hang(w, 'n1').find('[data-de-xuat="102"] [data-nut="tu-choi-de-xuat"]').trigger('click');
    await w.find('[data-o="ly-do"] input').setValue('là em trai');
    await w.find('[data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(tuChoiDeXuat).toHaveBeenCalledWith('n1', '102', 'là em trai');
    w.unmount();
  });

  it('GỠ uid: không có nút cho uid chính; lý do bắt buộc ⇒ goUidNhanVien', async () => {
    vi.mocked(goUidNhanVien).mockResolvedValue({ nhanVien: { ...NV_QUYET }, doi: true });
    const w = gan();
    await flushPromises();
    await nut(w, 'Nhân viên').trigger('click');
    await flushPromises();
    expect(hang(w, 'n1').find('[data-uid="100"] [data-nut="go-uid"]').exists()).toBe(false);
    await hang(w, 'n1').find('[data-uid="101"] [data-nut="go-uid"]').trigger('click');
    expect(w.find('[data-nut="xac-nhan-ly-do"]').attributes('disabled')).toBeDefined();
    await w.find('[data-o="ly-do"] input').setValue('nối nhầm');
    await w.find('[data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(goUidNhanVien).toHaveBeenCalledWith('n1', '101', 'nối nhầm');
    w.unmount();
  });

  it('409 ADMIN_CUOI ⇒ toast + hộp hiện nguyên câu backend', async () => {
    vi.mocked(suaNhanVien).mockRejectedValue(loi409);
    const w = await moSuaQuyet();
    await w.find('.bq-nv-dialog [data-o="vai"] select').setValue('sales');
    await w.find('.bq-nv-dialog [data-o="ly-do"] input').setValue('chuyển sang bán hàng');
    await w.find('.bq-nv-dialog [data-nut="luu"]').trigger('click');
    await flushPromises();
    expect(suaNhanVien).toHaveBeenCalledWith('n1', expect.objectContaining({ vai: 'sales', lyDo: 'chuyển sang bán hàng' }));
    const cau = 'Đây là admin đang hoạt động cuối cùng — phải luôn còn ít nhất một admin';
    expect(toast.error).toHaveBeenCalledWith(cau, expect.anything());
    expect(w.find('.bq-nv-dialog .bq-loi').text()).toContain(cau);
    w.unmount();
  });
});

describe('BotQuyenPage — tab Nhân viên: "Gọi là" anh/chị (docs/79 T1)', () => {
  const nvGoi = (id: string, tenGoi: string, them: Partial<NhanVien>): NhanVien => ({
    ...NV_QUYET, id, tenGoi, zaloUid: `${id}-uid`, uids: [], deXuat: [],
    goi: null, goiGoiY: null, goiNguon: null, goiGoiYLyDo: null, ...them,
  });

  async function moTab(ds: NhanVien[]) {
    vi.mocked(layDanhSachNhanVien).mockResolvedValue(ds);
    const w = gan();
    await flushPromises();
    await nut(w, 'Nhân viên').trigger('click');
    await flushPromises();
    return w;
  }

  it('cột "Gọi là": chip gợi ý theo nguồn; "Dùng" ⇒ PUT goi ⇒ dòng hiện giá trị mới, chip tắt', async () => {
    vi.mocked(suaNhanVien).mockImplementation(async (id, p) => ({
      nhanVien: nvGoi(id, 'Quyết', { goi: p.goi ?? null, goiGoiY: 'anh', goiNguon: 'khoa_tay' }), doi: true,
    }));
    const w = await moTab([
      nvGoi('n1', 'Quyết', { goiGoiY: 'anh', goiNguon: 'khoa_tay' }),
      nvGoi('n2', 'Lan', { goiGoiY: 'chi', goiNguon: 'zalo_tu_dien' }),
      nvGoi('n3', 'Minh', { goiGoiYLyDo: 'mau_thuan_khoa_tay' }),
      nvGoi('n4', 'Tú', { goiGoiYLyDo: 'chua_co_gioi' }),
    ]);
    expect(w.find('thead').text()).toContain('Gọi là');
    expect(hang(w, 'n1').find('[data-goi-y]').text()).toContain('Gợi ý: Anh (theo giới tính Zalo đã xác nhận)');
    expect(hang(w, 'n2').find('[data-goi-y]').text()).toContain('Gợi ý: Chị (theo Zalo tự điền — chưa ai xác nhận)');
    expect(hang(w, 'n3').text()).toContain('mâu thuẫn');
    expect(hang(w, 'n3').find('[data-goi-y]').exists()).toBe(false);
    expect(hang(w, 'n4').find('[data-goi-y]').exists()).toBe(false);
    expect((hang(w, 'n1').find('[data-o="goi"] select').element as HTMLSelectElement).value).toBe('');

    await hang(w, 'n1').find('[data-nut="nhan-goi-y"]').trigger('click');
    await flushPromises();
    expect(suaNhanVien).toHaveBeenCalledWith('n1', { goi: 'anh' });
    expect((hang(w, 'n1').find('[data-o="goi"] select').element as HTMLSelectElement).value).toBe('anh');
    expect(hang(w, 'n1').find('[data-goi-y]').exists()).toBe(false);
    expect(toast.success).toHaveBeenCalled();
    w.unmount();
  });

  it('chọn tay trong ô: Chị ⇒ goi "chi"; "— chưa chọn" ⇒ goi null; lỗi ⇒ toast + tải lại', async () => {
    vi.mocked(suaNhanVien).mockImplementation(async (id, p) => ({ nhanVien: nvGoi(id, 'Lan', { goi: p.goi ?? null }), doi: true }));
    const w = await moTab([nvGoi('n2', 'Lan', { goi: 'anh' })]);
    await hang(w, 'n2').find('[data-o="goi"] select').setValue('chi');
    await flushPromises();
    expect(suaNhanVien).toHaveBeenLastCalledWith('n2', { goi: 'chi' });
    await hang(w, 'n2').find('[data-o="goi"] select').setValue('');
    await flushPromises();
    expect(suaNhanVien).toHaveBeenLastCalledWith('n2', { goi: null });

    vi.mocked(suaNhanVien).mockRejectedValue({ response: { status: 400, data: { error: 'Gọi là phải là một trong: anh, chi', code: 'GOI_KHONG_HOP_LE' } } });
    const soLanTai = vi.mocked(layDanhSachNhanVien).mock.calls.length;
    await hang(w, 'n2').find('[data-o="goi"] select').setValue('anh');
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith('Gọi là phải là một trong: anh, chi', expect.anything());
    expect(vi.mocked(layDanhSachNhanVien).mock.calls.length).toBeGreaterThan(soLanTai);
    w.unmount();
  });

  it('"Áp gợi ý đã xác nhận": chỉ dòng gợi ý KHOÁ TAY + chưa chọn; xong tải lại; không có dòng nào ⇒ không có nút', async () => {
    vi.mocked(suaNhanVien).mockImplementation(async (id, p) => ({ nhanVien: nvGoi(id, 'x', { goi: p.goi ?? null }), doi: true }));
    const w = await moTab([
      nvGoi('n1', 'Quyết', { goiGoiY: 'anh', goiNguon: 'khoa_tay' }),
      nvGoi('n2', 'Lan', { goiGoiY: 'chi', goiNguon: 'zalo_tu_dien' }),
      nvGoi('n3', 'Minh', { goi: 'anh', goiGoiY: 'chi', goiNguon: 'khoa_tay' }),
      nvGoi('n5', 'Hà', { goiGoiY: 'chi', goiNguon: 'khoa_tay' }),
    ]);
    const bulk = w.find('[data-nut="ap-goi-y-hang-loat"]');
    expect(bulk.text()).toContain('Áp gợi ý đã xác nhận (2)');
    const soLanTai = vi.mocked(layDanhSachNhanVien).mock.calls.length;
    await bulk.trigger('click');
    await flushPromises();
    expect(vi.mocked(suaNhanVien).mock.calls).toEqual([['n1', { goi: 'anh' }], ['n5', { goi: 'chi' }]]);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('2 người'));
    expect(vi.mocked(layDanhSachNhanVien).mock.calls.length).toBeGreaterThan(soLanTai);
    w.unmount();

    const w2 = await moTab([nvGoi('n2', 'Lan', { goiGoiY: 'chi', goiNguon: 'zalo_tu_dien' })]);
    expect(w2.find('[data-nut="ap-goi-y-hang-loat"]').exists()).toBe(false);
    w2.unmount();
  });
});

describe('BotQuyenPage — tab Nhật ký', () => {
  it('mỗi dòng là một câu dựng từ trước/sau + lý do', async () => {
    const w = gan();
    await flushPromises();
    await nut(w, 'Nhật ký').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Nguyễn A đổi nhóm “Sales HN” từ Bán hàng sang Quản trị — lý do: nhóm quản lý');
    w.unmount();
  });
  it('dòng mặc định TỰ ĐỔI: chip "Tự động" riêng, câu không có người làm (góp ý chủ (4))', async () => {
    const w = gan();
    await flushPromises();
    await nut(w, 'Nhật ký').trigger('click');
    await flushPromises();
    const tu = w.find('.bq-nk[data-id="k2"]');
    expect(tu.find('.bq-chip--tu-dong').text()).toBe('Tự động');
    expect(tu.text()).toContain('Nhóm “Kho HN”: Nhóm nhân viên (mặc định) → Khách (mặc định) — có người ngoài vào nhóm: Lạ Văn A');
    expect(w.find('.bq-nk[data-id="k1"] .bq-chip--tu-dong').exists()).toBe(false);
    w.unmount();
  });
});

describe('BotQuyenPage — Chờ gán: nick Riêng tư (review P1-3)', () => {
  it('tên + tin bị che hiện chữ che, không điền tên vào hộp gán', async () => {
    const trang = structuredClone(CHO_GAN);
    Object.assign(trang.ungVien[1], { ten: '(ẩn — nick Riêng tư)', anTen: true, anTinCuoi: true, redacted: true });
    vi.mocked(layNguoiDaNhan).mockResolvedValue(trang);
    const w = gan();
    await flushPromises();
    await nut(w, 'Nhân viên').trigger('click');
    await flushPromises();
    const dong = w.find('.bq-cho-gan tr[data-uid="888"]');
    expect(dong.text()).toContain('(ẩn — nick Riêng tư)');
    expect(dong.text()).toContain('▒▒▒ (nick Riêng tư)');
    expect(dong.find('.bq-ten--an').exists()).toBe(true);
    w.unmount();
  });
});

describe('BotQuyenPage — ngăn thành viên: nick CRM nhìn từ nick khác (§8b-an-toàn)', () => {
  it('đề xuất "có vẻ là nick X" ⇒ "Đúng là nick này" gọi danhDauNickCrm; "Đây là nick CRM…" chọn nick; nick đã nhận ra ⇒ "gỡ" cần lý do', async () => {
    const tv = structuredClone(THANH_VIEN_C2);
    tv.nickKhac = [{ id: 'nickHCM', ten: 'Nick HCM' }, { id: 'nickTM', ten: 'Tiểu Mã Nelia' }];
    Object.assign(tv.thanhVien[3], { nickCrmDeXuat: { id: 'nickHCM', ten: 'Nick HCM', soTin: 5 } });
    tv.thanhVien.push({
      zaloUid: '2945555577789699285', ten: 'Tiểu Mã', loai: 'nick_crm', laNickCrm: true, nhanVien: null,
      nickCrm: { id: 'nickTM', ten: 'Tiểu Mã Nelia', nguon: 'zalo_global_id' },
    });
    vi.mocked(layThanhVienNhom).mockResolvedValue(tv);
    vi.mocked(danhDauNickCrm).mockResolvedValue({ doi: true });
    vi.mocked(goNickCrm).mockResolvedValue({ doi: true });
    const w = gan();
    await flushPromises();
    await nut(hang(w, 'c2'), 'Thành viên').trigger('click');
    await flushPromises();
    const dong = (uid: string) => w.find(`.bq-tv[data-uid="${uid}"]`);
    expect(dong('2945555577789699285').text()).toContain('Nick CRM “Tiểu Mã Nelia”');
    expect(dong('2945555577789699285').text()).not.toContain('Người ngoài');
    expect(dong('901').text()).toContain('Có vẻ là nick CRM “Nick HCM” — bằng chứng: 5 tin trùng');
    await dong('901').find('[data-nut="dung-nick"]').trigger('click');
    await w.find('[data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(danhDauNickCrm).toHaveBeenCalledWith('c2', { zaloUid: '901', nickId: 'nickHCM' });
    // "Đây là nick CRM…" trên người ngoài khác
    await dong('555').find('[data-nick="nickTM"]').trigger('click');
    await w.find('[data-o="ly-do"] input').setValue('nick Tiểu Mã');
    await w.find('[data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(danhDauNickCrm).toHaveBeenCalledWith('c2', { zaloUid: '555', nickId: 'nickTM', lyDo: 'nick Tiểu Mã' });
    // gỡ nick đã nhận ra: lý do bắt buộc
    await dong('2945555577789699285').find('[data-nut="go-nick"]').trigger('click');
    expect(w.find('[data-nut="xac-nhan-ly-do"]').attributes('disabled')).toBeDefined();
    await w.find('[data-o="ly-do"] input').setValue('không phải');
    await w.find('[data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(goNickCrm).toHaveBeenCalledWith('c2', '2945555577789699285', 'không phải');
    w.unmount();
  });
});

describe('BotQuyenPage — giám sát LIVE 30/09 (D2, D6)', () => {
  it('D2: "Đây là nick CRM…" liệt kê cả nick ĐÃ LƯU TRỮ (nhãn "đã lưu trữ") và đánh dấu được', async () => {
    const tv = structuredClone(THANH_VIEN_C2);
    tv.nickKhac = [{ id: 'nickHCM', ten: 'Nick HCM', daLuuTru: false }, { id: 'nickTM', ten: 'Tiểu Mã Nelia', daLuuTru: true }];
    vi.mocked(layThanhVienNhom).mockResolvedValue(tv);
    vi.mocked(danhDauNickCrm).mockResolvedValue({ doi: true });
    const w = gan();
    await flushPromises();
    await nut(hang(w, 'c2'), 'Thành viên').trigger('click');
    await flushPromises();
    const dong = w.find('.bq-tv[data-uid="555"]');
    expect(dong.find('[data-nick="nickTM"]').text()).toBe('Tiểu Mã Nelia (đã lưu trữ)');
    expect(dong.find('[data-nick="nickHCM"]').text()).toBe('Nick HCM');
    await dong.find('[data-nick="nickTM"]').trigger('click');
    await w.find('[data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(danhDauNickCrm).toHaveBeenCalledWith('c2', { zaloUid: '555', nickId: 'nickTM' });
    w.unmount();
  });

  it('D6: ngăn Thành viên — uid có ĐỀ XUẤT nối vào NV sẵn có ⇒ hiện đề xuất + "Nối" / "Không phải", KHÔNG có "Đặt làm nhân viên"', async () => {
    const tv = structuredClone(THANH_VIEN_C2);
    tv.thanhVien.push({
      zaloUid: '3835588809400259343', ten: 'Trần Hưng', loai: 'nguoi_ngoai', laNickCrm: false, nhanVien: null,
      deXuatNhanVien: [{ id: 'n7', tenGoi: 'Trần Hưng', vai: 'admin', soTin: 236 }],
    });
    vi.mocked(layThanhVienNhom).mockResolvedValue(tv);
    vi.mocked(noiDeXuat).mockResolvedValue({ nhanVien: { ...NV_QUYET }, doi: true });
    vi.mocked(tuChoiDeXuat).mockResolvedValue({ doi: true });
    const w = gan();
    await flushPromises();
    await nut(hang(w, 'c2'), 'Thành viên').trigger('click');
    await flushPromises();
    const dong = () => w.find('.bq-tv[data-uid="3835588809400259343"]');
    expect(dong().text()).toContain('Có vẻ là nhân viên “Trần Hưng” (Quản trị) — bằng chứng: 236 tin trùng');
    expect(dong().text()).not.toContain('Đặt làm nhân viên');
    expect(w.find('.bq-tv[data-uid="555"]').text()).toContain('Đặt làm nhân viên');
    const soLanTai = vi.mocked(layThanhVienNhom).mock.calls.length;
    await dong().find('[data-nut="noi-de-xuat-nv"]').trigger('click');
    await w.find('[data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(noiDeXuat).toHaveBeenCalledWith('n7', '3835588809400259343', undefined);
    expect(vi.mocked(layThanhVienNhom).mock.calls.length).toBeGreaterThan(soLanTai);
    await dong().find('[data-nut="tu-choi-de-xuat-nv"]').trigger('click');
    await w.find('[data-o="ly-do"] input').setValue('em trai');
    await w.find('[data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(tuChoiDeXuat).toHaveBeenCalledWith('n7', '3835588809400259343', 'em trai');
    w.unmount();
  });

  it('D6: Chờ gán — dòng có ĐỀ XUẤT nối vào NV sẵn có ⇒ "Nối" / "Không phải" THAY cho "Gán"', async () => {
    const cg = structuredClone(CHO_GAN);
    cg.ungVien[0].deXuatNhanVien = [{ id: 'n7', tenGoi: 'Trần Hưng', zaloUid: '778', soTin: 236 }];
    vi.mocked(layNguoiDaNhan).mockResolvedValue(cg);
    vi.mocked(noiDeXuat).mockResolvedValue({ nhanVien: { ...NV_QUYET }, doi: true });
    const w = gan();
    await flushPromises();
    await nut(w, 'Nhân viên').trigger('click');
    await flushPromises();
    const hung = w.find('.bq-cho-gan tr[data-uid="777"]');
    expect(hung.text()).toContain('Có vẻ là nhân viên “Trần Hưng” (uid 778) — bằng chứng: 236 tin trùng');
    expect(hung.findAll('button').some((b) => b.text().trim() === 'Gán')).toBe(false);
    expect(w.find('.bq-cho-gan tr[data-uid="888"]').findAll('button').some((b) => b.text().trim() === 'Gán')).toBe(true);
    const soLanTai = vi.mocked(layNguoiDaNhan).mock.calls.length;
    await hung.find('[data-nut="noi-de-xuat-nv"]').trigger('click');
    await w.find('[data-nut="xac-nhan-ly-do"]').trigger('click');
    await flushPromises();
    expect(noiDeXuat).toHaveBeenCalledWith('n7', '778', undefined);
    expect(vi.mocked(layNguoiDaNhan).mock.calls.length).toBeGreaterThan(soLanTai);
    w.unmount();
  });
});
