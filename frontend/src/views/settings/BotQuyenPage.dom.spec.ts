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
import type { NhanVien, NhatKy, NhomView, ThanhVienNhom } from '@/api/bot-quyen';

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
}));

import {
  layDanhSachNhom, layThanhVienNhom, luuChucNangNhom, boXepLoaiNhom,
  layDanhSachNhanVien, themNhanVien, suaNhanVien, layNhatKy, layNguoiDungCrm,
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
const VUETIFY_VO = {
  VBtn: vo('button'), VIcon: vo('i'), VAlert: vo('div'), VDialog: VoDialog, VCard: vo('div'), VCardText: vo('div'),
  VCardActions: vo('div'), VSpacer: vo('span'), VTextField: VoNhap, VSelect: VoChon, VSwitch: VoCongTac,
  VTable: vo('table'), VProgressLinear: vo('div'), VChip: vo('span'), VDivider: vo('hr'), VTabs: VoTabs, VTab: VoTab,
  VThemeProvider: vo('div'),
};

// ── Dữ liệu ──
const nick = { id: 'nickHN', displayName: 'Nick HN', zaloUid: '900', status: 'connected' };
const nhom = (them: Partial<NhomView>): NhomView => ({
  conversationId: 'c', externalThreadId: 't', tenNhom: 'Nhóm', soThanhVien: 6, lastMessageAt: null, daAn: false, nick,
  chucNang: null, tenDangKy: null, ghiChu: null, capNhatLuc: null, capNhatBoi: null, ...them,
});
const DS_NHOM: NhomView[] = [
  nhom({ conversationId: 'c1', tenNhom: 'Nhóm mới lập' }),
  nhom({
    conversationId: 'c2', tenNhom: 'Sales HN', chucNang: 'admin', tenDangKy: 'Sales HN',
    capNhatLuc: '2026-09-30T02:00:00.000Z', capNhatBoi: { id: 'u1', fullName: 'Nguyễn A' },
  }),
  nhom({ conversationId: 'c3', tenNhom: 'Khách Minh Long', chucNang: 'khach', tenDangKy: '' }),
  nhom({ conversationId: 'c4', tenNhom: 'Nhóm cũ đã ẩn', daAn: true }),
];
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
  ghiChu: null, capNhatLuc: '2026-09-30T01:00:00.000Z', capNhatBoi: null,
};
const NHAT_KY: NhatKy[] = [{
  id: 'k1', luc: '2026-09-30T03:00:00.000Z', aiId: 'u1', ai: { id: 'u1', fullName: 'Nguyễn A' }, doiTuong: 'nhom',
  doiTuongId: 'c2', tenDoiTuong: 'Sales HN', truoc: { chucNang: 'sales', tenDangKy: 'Sales HN', ghiChu: null },
  sau: { chucNang: 'admin', tenDangKy: 'Sales HN', ghiChu: null }, lyDo: 'nhóm quản lý',
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

  it('mỗi lựa chọn có câu hệ quả; "Bỏ xếp loại" không lý do ⇒ chặn', async () => {
    const w = gan();
    await flushPromises();
    await nut(hang(w, 'c2'), 'Đổi').trigger('click');
    const hop = w.find('.bq-xep-loai');
    expect(hop.find('[data-gia-tri="admin"]').text()).toContain('Mọi người trong nhóm hỏi được mọi thứ');
    expect(hop.find('[data-gia-tri="kho"]').text()).toContain('thêm quyền kho (nhập, chuyển kho)');
    expect(hop.find('[data-gia-tri="bo"]').text()).toContain('Bot sẽ im trong nhóm này.');
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

describe('BotQuyenPage — tab Nhân viên', () => {
  async function moSuaQuyet() {
    const w = gan();
    await flushPromises();
    await nut(w, 'Nhân viên').trigger('click');
    await flushPromises();
    expect(hang(w, 'n1').text()).toContain('Quyết');
    expect(hang(w, 'n1').text()).toContain('100');
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

describe('BotQuyenPage — tab Nhật ký', () => {
  it('mỗi dòng là một câu dựng từ trước/sau + lý do', async () => {
    const w = gan();
    await flushPromises();
    await nut(w, 'Nhật ký').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Nguyễn A đổi nhóm “Sales HN” từ Bán hàng sang Quản trị — lý do: nhóm quản lý');
    w.unmount();
  });
});
