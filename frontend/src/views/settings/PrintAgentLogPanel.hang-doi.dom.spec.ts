// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// PrintAgentLogPanel — ba thẻ "Hàng đợi in (N)" | "Nhật ký in" | "Log app" (hợp đồng hàng đợi/huỷ
// §6.1 + §8.6): N chỉ đếm lệnh đang/sẽ in; thẻ mặc định Hàng đợi nếu N > 0 ngược lại Nhật ký in
// (quyết MỘT lần lúc hàng đợi tới); URL `?nhatKy=hang_doi|in|app` và lựa chọn đã nhớ thắng mặc
// định; chip trên thẻ máy (`moHangDoi`) mở thẻ Hàng đợi lọc máy đó; thẻ Hàng đợi xin nạp lại qua
// sự kiện `taiLaiHangDoi`. (Hai thẻ cũ: PrintAgentLogPanel.the.dom.spec.ts — giữ nguyên.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { HangDoiIn, MucHangDoi, TrangNhatKy, TrangNhatKyApp } from '@/api/print-agents';

vi.mock('@/composables/use-toast', () => ({ useToast: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }) }));
vi.mock('@/api/print-agents', () => ({
  layNhatKy: vi.fn(),
  layNhatKyApp: vi.fn(),
  taiVeNhatKyApp: vi.fn(),
  huyLenhIn: vi.fn(),
  boTheoDoiLenhIn: vi.fn(),
  maHttpCuaLoi: (e: { response?: { status?: number } } | null) => e?.response?.status,
  laYeuCauDaHuy: (e: { code?: string } | null) => e?.code === 'ERR_CANCELED',
}));

import { layNhatKy, layNhatKyApp } from '@/api/print-agents';
import PrintAgentLogPanel from './PrintAgentLogPanel.vue';

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
  VSwitch: vo('div'), VBtn: vo('button'), VSpacer: vo('span'), VTextField: vo('div'), VSelect: vo('div'),
  VAlert: vo('div'), VProgressLinear: vo('div'), VTable: vo('table'), VChip: vo('span'), VIcon: vo('i'),
  VProgressCircular: vo('span'), VDialog: VoDialog, VCard: vo('div'), VCardText: vo('div'), VCardActions: vo('div'),
  VThemeProvider: vo('div'),
};

const MAY = [
  { id: 'mHN', ten: 'Máy HN', warehouseIds: [], laMacDinh: true, tokenDuoi: 'ab12', online: true },
  { id: 'mHCM', ten: 'Máy HCM', warehouseIds: [], laMacDinh: false, tokenDuoi: 'cd34', online: true },
];
const muc = (id: string, them: Partial<MucHangDoi> = {}): MucHangDoi => ({
  id, soHoaDon: `INV/${id}`, tenKhach: null, mayInId: 'mHN', mayInTen: 'Máy HN', trangThai: 'cho_in', nhom: 'cho_in',
  lyDo: 'Chờ tới lượt in', tamGiu: false, lanThu: 0, tao: '2026-09-25T02:48:00.000Z', capNhat: '2026-09-25T02:48:00.000Z',
  huy: 'chac_chan', ...them,
});
const hd = (n: number, them: Partial<MucHangDoi> = {}, chuaXacNhan: MucHangDoi[] = []): HangDoiIn => ({
  choIn: Array.from({ length: n }, (_, i) => muc(String(i + 1), them)), chuaXacNhan, capNhat: '2026-09-25T03:00:00.000Z',
});

function gan(props: Record<string, unknown> = {}) {
  return mount(PrintAgentLogPanel, { props: { mayIns: MAY, ...props }, global: { components: VUETIFY_VO } });
}
const nutThe = (w: ReturnType<typeof gan>, id: string) => w.find(`#${id}`);
const dangChon = (w: ReturnType<typeof gan>) => w.findAll('[role="tab"]').filter((b) => b.attributes('aria-selected') === 'true').map((b) => b.attributes('id'));

let kho: Record<string, string>;
let ghi: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-09-25T03:00:00Z'));
  kho = {};
  ghi = vi.fn((k: string, v: string) => { kho[k] = v; });
  vi.stubGlobal('localStorage', { getItem: (k: string) => kho[k] ?? null, setItem: ghi });
  vi.mocked(layNhatKy).mockReset();
  vi.mocked(layNhatKy).mockResolvedValue({ items: [], tiepTheo: null } satisfies TrangNhatKy);
  vi.mocked(layNhatKyApp).mockReset();
  vi.mocked(layNhatKyApp).mockResolvedValue({ items: [], tiepTheo: null } satisfies TrangNhatKyApp);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PrintAgentLogPanel — thẻ "Hàng đợi in (N)"', () => {
  it('ba thẻ theo đúng thứ tự; N CHỈ đếm lệnh đang/sẽ in (không tính "chưa xác nhận")', async () => {
    const w = gan({ hangDoi: hd(3, {}, [muc('k', { trangThai: 'khong_ro', nhom: 'chua_xac_nhan', huy: 'khong' })]) });
    await flushPromises();
    expect(w.findAll('[role="tab"]').map((b) => b.text())).toEqual(['Hàng đợi in (3)', 'Nhật ký in', 'Log app']);
    w.unmount();
  });

  it('có lệnh chờ lúc gắn → mặc định Hàng đợi (Nhật ký in chưa tải); KHÔNG ghi nhớ lựa chọn tự động', async () => {
    const w = gan({ hangDoi: hd(2) });
    await flushPromises();
    expect(dangChon(w)).toEqual(['nk-the-hang-doi']);
    expect(w.find('#nk-vung-hang-doi').exists()).toBe(true);
    expect(w.text()).toContain('INV/1');
    expect(layNhatKy).not.toHaveBeenCalled();
    expect(ghi).not.toHaveBeenCalled();
    w.unmount();
  });

  it('hàng đợi tới SAU khi gắn: N > 0 → tự sang Hàng đợi MỘT lần; N về sau đổi không làm nhảy thẻ', async () => {
    const w = gan();
    await flushPromises();
    expect(dangChon(w)).toEqual(['nk-the-in']);
    expect(nutThe(w, 'nk-the-hang-doi').text()).toBe('Hàng đợi in');
    await w.setProps({ hangDoi: hd(2) });
    await flushPromises();
    expect(dangChon(w)).toEqual(['nk-the-hang-doi']);
    await nutThe(w, 'nk-the-in').trigger('click');
    await w.setProps({ hangDoi: hd(4) });
    await flushPromises();
    expect(dangChon(w)).toEqual(['nk-the-in']);
    expect(nutThe(w, 'nk-the-hang-doi').text()).toBe('Hàng đợi in (4)');
    w.unmount();
  });

  it('hàng đợi tới lần đầu RỖNG → ở Nhật ký in; lệnh mới tới sau đó không kéo người đang xem sang thẻ khác', async () => {
    const w = gan();
    await w.setProps({ hangDoi: hd(0) });
    await w.setProps({ hangDoi: hd(3) });
    await flushPromises();
    expect(dangChon(w)).toEqual(['nk-the-in']);
    w.unmount();
  });

  it('người dùng đã chọn "Nhật ký in" (nhớ) → giữ, kể cả khi đang có lệnh chờ; bấm Hàng đợi → nhớ "hang_doi"', async () => {
    kho['may-in:nhat-ky-the'] = 'in';
    const w = gan({ hangDoi: hd(5) });
    await flushPromises();
    expect(dangChon(w)).toEqual(['nk-the-in']);
    await nutThe(w, 'nk-the-hang-doi').trigger('click');
    await flushPromises();
    expect(dangChon(w)).toEqual(['nk-the-hang-doi']);
    expect(ghi).toHaveBeenCalledWith('may-in:nhat-ky-the', 'hang_doi');
    // mở thẻ → thẻ xin nạp lại hàng đợi (trang cha nạp)
    expect(w.emitted('taiLaiHangDoi')).toContainEqual([{ ngam: true }]);
    w.unmount();
  });

  it('(MEDIUM 3) có hoá đơn TẠM GIỮ → mở Hàng đợi DÙ thẻ đã nhớ là "in"/"app" (bản prod cũ đã nhớ sẵn)', async () => {
    for (const daNho of ['in', 'app']) {
      kho['may-in:nhat-ky-the'] = daNho;
      const a = gan({ hangDoi: hd(2, { tamGiu: true }) }); // có dữ liệu lúc gắn
      await flushPromises();
      expect(dangChon(a)).toEqual(['nk-the-hang-doi']);
      a.unmount();
      const b = gan(); // dữ liệu tới sau
      await flushPromises();
      expect(dangChon(b)).toEqual([daNho === 'in' ? 'nk-the-in' : 'nk-the-app']);
      await b.setProps({ hangDoi: hd(2, { tamGiu: true }) });
      await flushPromises();
      expect(dangChon(b)).toEqual(['nk-the-hang-doi']);
      b.unmount();
    }
    // …nhưng URL rõ ràng vẫn thắng
    const c = gan({ tabDau: 'in', hangDoi: hd(2, { tamGiu: true }) });
    await flushPromises();
    expect(dangChon(c)).toEqual(['nk-the-in']);
    c.unmount();
  });

  it('(MEDIUM 3) người dùng đã tự bấm thẻ trước khi dữ liệu tới → giữ lựa chọn đó', async () => {
    kho['may-in:nhat-ky-the'] = 'in';
    const w = gan();
    await flushPromises();
    await nutThe(w, 'nk-the-app').trigger('click');
    await w.setProps({ hangDoi: hd(2, { tamGiu: true }) });
    await flushPromises();
    expect(dangChon(w)).toEqual(['nk-the-app']);
    w.unmount();
  });

  it('(LOW 6) thẻ Hàng đợi báo tạm dừng (hộp xác nhận mở) → sự kiện tamDungHangDoi cho trang cha', async () => {
    const w = gan({ hangDoi: hd(1) });
    await flushPromises();
    await w.find('#nk-vung-hang-doi').findAll('button').find((b) => b.text() === 'Huỷ')!.trigger('click');
    expect(w.emitted('tamDungHangDoi')?.at(-1)).toEqual([true]);
    await w.findAll('button').find((b) => b.text() === 'Giữ lại')!.trigger('click');
    expect(w.emitted('tamDungHangDoi')?.at(-1)).toEqual([false]);
    w.unmount();
  });

  it('`?nhatKy=hang_doi` mở thẳng Hàng đợi (kể cả N = 0, chưa có dữ liệu); `?nhatKy=in` thắng mặc định', async () => {
    const a = gan({ tabDau: 'hang_doi', dangTaiHangDoi: true });
    await flushPromises();
    expect(dangChon(a)).toEqual(['nk-the-hang-doi']);
    expect(a.find('#nk-vung-hang-doi').text()).toContain('Đang tải hàng đợi in…');
    a.unmount();
    const b = gan({ tabDau: 'in', hangDoi: hd(2) });
    await flushPromises();
    expect(dangChon(b)).toEqual(['nk-the-in']);
    b.unmount();
  });

  it('chip "N đang chờ" trên thẻ máy (moHangDoi) → thẻ Hàng đợi, lọc đúng máy', async () => {
    const ds: HangDoiIn = { choIn: [muc('1'), muc('2', { mayInId: 'mHCM', mayInTen: 'Máy HCM' })], chuaXacNhan: [], capNhat: '' };
    const w = gan({ hangDoi: ds, tabDau: 'in' });
    await flushPromises();
    await w.setProps({ moHangDoi: { mayInId: 'mHCM', lan: 1 } });
    await flushPromises();
    expect(dangChon(w)).toEqual(['nk-the-hang-doi']);
    expect(w.find('tr[data-id="2"]').exists()).toBe(true);
    expect(w.find('tr[data-id="1"]').exists()).toBe(false);
    w.unmount();
  });

  it('nhịp 5 giây của thẻ Hàng đợi → sự kiện taiLaiHangDoi cho trang cha; đổi sang thẻ khác thì nghỉ', async () => {
    const w = gan({ hangDoi: hd(1) });
    await flushPromises();
    const dem = () => w.emitted('taiLaiHangDoi')?.length ?? 0;
    const truoc = dem();
    vi.advanceTimersByTime(5_000);
    expect(dem()).toBe(truoc + 1);
    await nutThe(w, 'nk-the-app').trigger('click');
    vi.advanceTimersByTime(5_000);
    expect(dem()).toBe(truoc + 1);
    w.unmount();
  });

  it('tạm giữ → số đếm trên thẻ tô cam', async () => {
    const w = gan({ hangDoi: hd(2, { tamGiu: true }) });
    await flushPromises();
    expect(nutThe(w, 'nk-the-hang-doi').find('.nk-the-dem--cam').exists()).toBe(true);
    w.unmount();
  });
});
