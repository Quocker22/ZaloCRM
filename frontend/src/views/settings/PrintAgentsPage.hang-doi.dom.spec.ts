// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// PrintAgentsPage — chip "N đang chờ" trên thẻ máy in (hợp đồng hàng đợi/huỷ §6.1 + §8.6):
// N CHỈ đếm lệnh đang/sẽ in của máy đó; cam khi có hoá đơn tạm giữ, xanh khi chỉ đang chờ/gửi;
// bấm chip → thẻ "Hàng đợi in" lọc máy đó. Trang nạp hàng đợi lúc mở và khi thẻ Hàng đợi xin.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { HangDoiIn, MayIn, MucHangDoi } from '@/api/print-agents';

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isAdmin: true }) }));
vi.mock('@/composables/use-toast', () => ({ useToast: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }) }));
vi.mock('@/api/print-agents', () => ({
  layDanhSach: vi.fn(),
  layKhos: vi.fn(async () => []),
  tao: vi.fn(), sua: vi.fn(), xoa: vi.fn(),
  layHangDoi: vi.fn(),
  huyLenhIn: vi.fn(), boTheoDoiLenhIn: vi.fn(),
  layNhatKy: vi.fn(async () => ({ items: [], tiepTheo: null })),
  layNhatKyApp: vi.fn(async () => ({ items: [], tiepTheo: null })),
  taiVeNhatKyApp: vi.fn(),
  maHttpCuaLoi: (e: { response?: { status?: number } } | null) => e?.response?.status,
  laYeuCauDaHuy: (e: { code?: string } | null) => e?.code === 'ERR_CANCELED',
}));

import { layDanhSach, layHangDoi } from '@/api/print-agents';
import PrintAgentsPage from './PrintAgentsPage.vue';

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
const VUETIFY_VO = {
  VBtn: vo('button'), VIcon: vo('i'), VAlert: vo('div'), VDialog: VoDialog, VCard: vo('div'), VCardText: vo('div'),
  VCardActions: vo('div'), VSpacer: vo('span'), VTextField: vo('div'), VSelect: vo('div'), VSwitch: vo('div'),
  VTable: vo('table'), VProgressLinear: vo('div'), VProgressCircular: vo('span'), VChip: vo('span'),
  VThemeProvider: defineComponent({
    name: 'VoThemeProvider',
    props: { theme: String },
    setup(p, { slots }) {
      return () => h('div', { 'data-theme': p.theme }, slots.default?.());
    },
  }),
};

const MAY: MayIn[] = [
  { id: 'mHN', ten: 'Máy HN', warehouseIds: [], laMacDinh: true, tokenDuoi: 'ab12', online: true },
  { id: 'mHCM', ten: 'Máy HCM', warehouseIds: [], laMacDinh: false, tokenDuoi: 'cd34', online: true },
  { id: 'mDN', ten: 'Máy Đà Nẵng', warehouseIds: [], laMacDinh: false, tokenDuoi: 'ef56', online: false },
];
const muc = (id: string, them: Partial<MucHangDoi> = {}): MucHangDoi => ({
  id, soHoaDon: `INV/${id}`, tenKhach: null, mayInId: 'mHN', mayInTen: 'Máy HN', trangThai: 'cho_in', nhom: 'cho_in',
  lyDo: 'Chờ tới lượt in', tamGiu: false, lanThu: 0, tao: '2026-09-25T02:48:00.000Z', capNhat: '2026-09-25T02:48:00.000Z',
  huy: 'chac_chan', ...them,
});
const HANG_DOI: HangDoiIn = {
  choIn: [
    muc('1', { tamGiu: true, lyDo: 'Tạm giữ — máy in Hết giấy (từ 09:45)' }),
    muc('2', { tamGiu: true }),
    muc('3', { mayInId: 'mHCM', mayInTen: 'Máy HCM', trangThai: 'dang_gui', huy: 'khong' }),
  ],
  chuaXacNhan: [muc('9', { mayInId: 'mDN', mayInTen: 'Máy Đà Nẵng', trangThai: 'khong_ro', nhom: 'chua_xac_nhan', huy: 'khong' })],
  capNhat: '2026-09-25T03:00:00.000Z',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-09-25T03:00:00Z'));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.mocked(layDanhSach).mockReset();
  vi.mocked(layDanhSach).mockResolvedValue(MAY);
  vi.mocked(layHangDoi).mockReset();
  vi.mocked(layHangDoi).mockResolvedValue(HANG_DOI);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function gan() {
  return mount(PrintAgentsPage, { global: { components: VUETIFY_VO } });
}
const the = (w: ReturnType<typeof gan>, ten: string) => w.find(`article[aria-label="Máy in ${ten}"]`);

describe('PrintAgentsPage — chip "N đang chờ"', () => {
  it('đếm CHỈ lệnh đang/sẽ in của từng máy; cam khi có tạm giữ, xanh khi không; máy không có lệnh chờ → không chip', async () => {
    const w = gan();
    await flushPromises();
    expect(layHangDoi).toHaveBeenCalledTimes(1);
    const hn = the(w, 'Máy HN').find('.pa-cho-chip');
    expect(hn.text()).toBe('2 đang chờ');
    expect(hn.classes()).toContain('pa-cho-chip--cam');
    const hcm = the(w, 'Máy HCM').find('.pa-cho-chip');
    expect(hcm.text()).toBe('1 đang chờ');
    expect(hcm.classes()).toContain('pa-cho-chip--xanh');
    // Máy Đà Nẵng chỉ có lệnh "chưa xác nhận" — không tính vào chip
    expect(the(w, 'Máy Đà Nẵng').find('.pa-cho-chip').exists()).toBe(false);
    w.unmount();
  });

  it('bấm chip → thẻ "Hàng đợi in" được chọn, lọc đúng máy đó', async () => {
    const w = gan();
    await flushPromises();
    await the(w, 'Máy HCM').find('.pa-cho-chip').trigger('click');
    await flushPromises();
    expect(w.find('#nk-the-hang-doi').attributes('aria-selected')).toBe('true');
    expect(w.find('#nk-the-hang-doi').text()).toBe('Hàng đợi in (3)');
    expect(w.find('tr[data-id="3"]').exists()).toBe(true);
    expect(w.find('tr[data-id="1"]').exists()).toBe(false);
    w.unmount();
  });

  it('thẻ Hàng đợi đang mở → mỗi 5 giây trang nạp lại hàng đợi (ngầm) — chip trên thẻ máy cập nhật theo', async () => {
    const w = gan();
    await flushPromises();
    const truoc = vi.mocked(layHangDoi).mock.calls.length;
    vi.mocked(layHangDoi).mockResolvedValue({ ...HANG_DOI, choIn: HANG_DOI.choIn.slice(0, 1) });
    vi.advanceTimersByTime(5_000);
    await flushPromises();
    expect(vi.mocked(layHangDoi).mock.calls.length).toBeGreaterThan(truoc);
    expect(vi.mocked(layHangDoi).mock.calls.at(-1)![1]).toMatchObject({ ngam: true });
    expect(the(w, 'Máy HN').find('.pa-cho-chip').text()).toBe('1 đang chờ');
    expect(the(w, 'Máy HCM').find('.pa-cho-chip').exists()).toBe(false);
    w.unmount();
  });
});

describe('PrintAgentsPage — giám sát (LOW 6 + MEDIUM 5)', () => {
  it('đang mở hộp xác nhận huỷ → nhịp 15 giây KHÔNG nạp lại hàng đợi (danh sách không đổi dưới tay); đóng hộp thì chạy lại', async () => {
    const w = gan();
    await flushPromises();
    await the(w, 'Máy HN').find('.pa-cho-chip').trigger('click');
    await flushPromises();
    await w.find('#nk-vung-hang-doi').findAll('button').find((b) => b.text() === 'Huỷ')!.trigger('click');
    await flushPromises();
    const truoc = vi.mocked(layHangDoi).mock.calls.length;
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(vi.mocked(layHangDoi).mock.calls.length).toBe(truoc);
    await w.findAll('button').find((b) => b.text() === 'Giữ lại')!.trigger('click');
    vi.advanceTimersByTime(15_000);
    await flushPromises();
    expect(vi.mocked(layHangDoi).mock.calls.length).toBeGreaterThan(truoc);
    w.unmount();
  });

  it('cả trang ép theme sáng hsLight (MobileLayout mặc định theme tối — chữ Atlas tối trên nền tối)', async () => {
    const w = gan();
    await flushPromises();
    expect(w.find('[data-theme="hsLight"]').exists()).toBe(true);
    expect(w.find('[data-theme="hsLight"] .pa-page').exists()).toBe(true);
    w.unmount();
  });
});
