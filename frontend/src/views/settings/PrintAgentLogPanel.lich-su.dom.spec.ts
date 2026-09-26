// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// PrintAgentLogPanel — hai thẻ "Đã in (N)" | "Đã huỷ (N)" ngay sau "Hàng đợi in" (26/09, lịch sử 30
// ngày): N = số của CẢ org (GET /lich-su/dem) nạp lúc gắn + mỗi nhịp 15 giây + khi mở thẻ; không
// lấy được → thẻ chỉ hiện chữ, không báo lỗi; thẻ chỉ gắn (và gọi API) từ lần đầu được chọn, nhớ
// trong localStorage; `?nhatKy=da_in|da_huy` mở thẳng; tạm giữ vẫn thắng thẻ đã nhớ.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { HangDoiIn, MucHangDoi, TrangLichSu, TrangNhatKy } from '@/api/print-agents';

vi.mock('@/composables/use-toast', () => ({ useToast: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }) }));
vi.mock('@/api/print-agents', () => ({
  layNhatKy: vi.fn(),
  layNhatKyApp: vi.fn(),
  taiVeNhatKyApp: vi.fn(),
  huyLenhIn: vi.fn(),
  boTheoDoiLenhIn: vi.fn(),
  layLichSuIn: vi.fn(),
  layDemLichSuIn: vi.fn(),
  maHttpCuaLoi: (e: { response?: { status?: number } } | null) => e?.response?.status,
  laYeuCauDaHuy: (e: { code?: string } | null) => e?.code === 'ERR_CANCELED',
}));

import { layNhatKy, layLichSuIn, layDemLichSuIn } from '@/api/print-agents';
import PrintAgentLogPanel from './PrintAgentLogPanel.vue';

const vo = (the: string) => defineComponent({
  name: `Vo${the}`,
  setup(_, { slots }) {
    return () => h(the, slots.default?.());
  },
});
const VUETIFY_VO = {
  VSwitch: vo('div'), VBtn: vo('button'), VSpacer: vo('span'), VTextField: vo('div'), VSelect: vo('div'),
  VAlert: vo('div'), VProgressLinear: vo('div'), VTable: vo('table'), VChip: vo('span'), VIcon: vo('i'),
  VProgressCircular: vo('span'), VDialog: vo('div'), VCard: vo('div'), VCardText: vo('div'), VCardActions: vo('div'),
  VThemeProvider: vo('div'),
};

const MAY = [{ id: 'mHN', ten: 'Máy HN', warehouseIds: [], laMacDinh: true, tokenDuoi: 'ab12', online: true }];
const trangLichSu = (id: string, trangThai: 'da_in' | 'da_huy'): TrangLichSu => ({
  items: [{
    id, soHoaDon: `INV/${id}`, tenKhach: null, mayInId: 'mHN', mayInTen: 'Máy HN', trangThai,
    tao: '2026-09-26T06:00:00.000Z', ketThuc: '2026-09-26T06:01:00.000Z', lyDo: null,
  }],
  tiepTheo: null, tong: 1, tu: '2026-08-27T07:00:00.000Z',
});
const tamGiu = (): HangDoiIn => ({
  choIn: [{
    id: 'g1', soHoaDon: 'INV/g1', tenKhach: null, mayInId: 'mHN', mayInTen: 'Máy HN', trangThai: 'cho_in', nhom: 'cho_in',
    lyDo: 'Tạm giữ', tamGiu: true, lanThu: 0, tao: '2026-09-26T06:00:00.000Z', capNhat: '2026-09-26T06:00:00.000Z', huy: 'chac_chan',
  } satisfies MucHangDoi],
  chuaXacNhan: [], capNhat: '2026-09-26T07:00:00.000Z',
});

function gan(props: Record<string, unknown> = {}) {
  return mount(PrintAgentLogPanel, { props: { mayIns: MAY, ...props }, global: { components: VUETIFY_VO } });
}
type W = ReturnType<typeof gan>;
const nhanThe = (w: W) => w.findAll('[role="tab"]').map((b) => b.text());
const dangChon = (w: W) => w.findAll('[role="tab"]').filter((b) => b.attributes('aria-selected') === 'true').map((b) => b.attributes('id'));
const goiLichSu = (tt: string) => vi.mocked(layLichSuIn).mock.calls.filter((c) => c[0].trangThai === tt);

let kho: Record<string, string>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-09-26T07:00:00Z'));
  kho = {};
  vi.stubGlobal('localStorage', { getItem: (k: string) => kho[k] ?? null, setItem: (k: string, v: string) => { kho[k] = v; } });
  vi.mocked(layNhatKy).mockReset();
  vi.mocked(layNhatKy).mockResolvedValue({ items: [], tiepTheo: null } satisfies TrangNhatKy);
  vi.mocked(layLichSuIn).mockReset();
  vi.mocked(layLichSuIn).mockImplementation(async (t) => trangLichSu(t.trangThai === 'da_in' ? 'in1' : 'huy1', t.trangThai));
  vi.mocked(layDemLichSuIn).mockReset();
  vi.mocked(layDemLichSuIn).mockResolvedValue({ daIn: 1234, daHuy: 3 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PrintAgentLogPanel — thẻ "Đã in" / "Đã huỷ"', () => {
  it('số của cả org trên thẻ (nhóm nghìn); hai thẻ CHƯA gắn → chưa gọi danh sách', async () => {
    const w = gan();
    await flushPromises();
    expect(nhanThe(w)).toEqual(['Hàng đợi in', 'Đã in (1.234)', 'Đã huỷ (3)', 'Nhật ký in', 'Log app']);
    expect(layLichSuIn).not.toHaveBeenCalled();
    expect(w.find('#nk-vung-da_in').exists()).toBe(false);
    w.unmount();
  });

  it('không lấy được số (lỗi máy chủ / backend cũ trả null) → thẻ chỉ hiện chữ, KHÔNG báo lỗi', async () => {
    vi.mocked(layDemLichSuIn).mockRejectedValueOnce({ response: { status: 500 } });
    const a = gan();
    await flushPromises();
    expect(nhanThe(a).slice(1, 3)).toEqual(['Đã in', 'Đã huỷ']);
    expect(a.findAll('.nk-loi')).toHaveLength(0); // không khung lỗi nào (Nhật ký in vẫn tải bình thường)
    expect(a.text()).not.toContain('Không tải được');
    a.unmount();
    vi.mocked(layDemLichSuIn).mockResolvedValueOnce(null);
    const b = gan();
    await flushPromises();
    expect(nhanThe(b).slice(1, 3)).toEqual(['Đã in', 'Đã huỷ']);
    b.unmount();
  });

  it('bấm "Đã in" → gắn danh sách da_in, nhớ lựa chọn, dòng phụ 30 ngày; "Đã huỷ" chưa gắn tới khi được chọn', async () => {
    const w = gan();
    await flushPromises();
    await w.find('#nk-the-da_in').trigger('click');
    await flushPromises();
    expect(dangChon(w)).toEqual(['nk-the-da_in']);
    expect(kho['may-in:nhat-ky-the']).toBe('da_in');
    expect(w.find('.nk-phu').text()).toContain('30 ngày gần nhất');
    expect(w.find('#nk-vung-da_in').text()).toContain('INV/in1');
    expect(goiLichSu('da_in')).toHaveLength(1);
    expect(goiLichSu('da_huy')).toHaveLength(0);
    expect(w.find('#nk-vung-da_huy').exists()).toBe(false);

    await w.find('#nk-the-da_huy').trigger('click');
    await flushPromises();
    expect(w.find('#nk-vung-da_huy').text()).toContain('INV/huy1');
    expect(w.find('#nk-vung-da_huy').text()).toContain('Hoá đơn chắc chắn không in');
    // mở thẻ lịch sử → số trên thẻ được nạp lại cho khớp
    expect(vi.mocked(layDemLichSuIn).mock.calls.length).toBeGreaterThanOrEqual(3);
    w.unmount();
  });

  it('`?nhatKy=da_huy` mở thẳng "Đã huỷ" (Nhật ký in không tải); thẻ đã nhớ "da_in" được giữ', async () => {
    const a = gan({ tabDau: 'da_huy' });
    await flushPromises();
    expect(dangChon(a)).toEqual(['nk-the-da_huy']);
    expect(goiLichSu('da_huy')).toHaveLength(1);
    expect(layNhatKy).not.toHaveBeenCalled();
    a.unmount();
    kho['may-in:nhat-ky-the'] = 'da_in';
    const b = gan({ hangDoi: { choIn: [], chuaXacNhan: [], capNhat: '' } });
    await flushPromises();
    expect(dangChon(b)).toEqual(['nk-the-da_in']);
    b.unmount();
  });

  it('có hoá đơn TẠM GIỮ → Hàng đợi thắng thẻ đã nhớ "da_huy"', async () => {
    kho['may-in:nhat-ky-the'] = 'da_huy';
    const w = gan({ hangDoi: tamGiu() });
    await flushPromises();
    expect(dangChon(w)).toEqual(['nk-the-hang-doi']);
    expect(layLichSuIn).not.toHaveBeenCalled();
    w.unmount();
  });

  it('nhịp 15 giây nạp lại số trên thẻ (kể cả khi đang ở thẻ khác); chỉ thẻ lịch sử ĐANG chọn tự làm mới danh sách', async () => {
    vi.mocked(layDemLichSuIn).mockResolvedValue({ daIn: 1, daHuy: 0 });
    const w = gan({ tabDau: 'da_in' });
    await flushPromises();
    await w.find('#nk-the-da_huy').trigger('click');
    await flushPromises();
    const inTruoc = goiLichSu('da_in').length;
    const huyTruoc = goiLichSu('da_huy').length;
    vi.mocked(layDemLichSuIn).mockResolvedValue({ daIn: 2, daHuy: 5 });
    vi.advanceTimersByTime(15_000);
    await flushPromises();
    expect(nhanThe(w).slice(1, 3)).toEqual(['Đã in (2)', 'Đã huỷ (5)']);
    expect(goiLichSu('da_in')).toHaveLength(inTruoc); // thẻ Đã in không được chọn → nghỉ
    expect(goiLichSu('da_huy').length).toBeGreaterThan(huyTruoc);
    w.unmount();
  });
});
