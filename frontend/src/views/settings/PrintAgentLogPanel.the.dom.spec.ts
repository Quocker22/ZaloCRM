// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// PrintAgentLogPanel — hai thẻ "Nhật ký in" | "Log app": chọn một chạm, nhớ trong localStorage,
// `?nhatKy=app` (prop tabDau) mở thẳng Log app, thẻ Log app chỉ gắn khi được chọn, thẻ nào
// không được chọn thì nghỉ tự làm mới. (Hành vi cũ của thẻ "Nhật ký in" ở PrintAgentLogPanel.dom.spec.ts.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { TrangNhatKy, TrangNhatKyApp } from '@/api/print-agents';

vi.mock('@/api/print-agents', () => ({
  layNhatKy: vi.fn(),
  layNhatKyApp: vi.fn(),
  taiVeNhatKyApp: vi.fn(),
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

const VUETIFY_VO = {
  VSwitch: vo('div'), VBtn: vo('button'), VSpacer: vo('span'), VTextField: vo('div'), VSelect: vo('div'),
  VAlert: vo('div'), VProgressLinear: vo('div'), VTable: vo('table'), VChip: vo('span'),
  VIcon: vo('i'), VProgressCircular: vo('span'),
};

const MAY = [{ id: 'm1', ten: 'Máy HCM', warehouseIds: [], laMacDinh: true, tokenDuoi: 'ab12', online: true }];

function gan(props: Record<string, unknown> = {}) {
  return mount(PrintAgentLogPanel, { props: { mayIns: MAY, ...props }, global: { components: VUETIFY_VO } });
}

const nut = (w: ReturnType<typeof gan>, chu: string) => w.findAll('button').find((b) => b.text() === chu);

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

describe('PrintAgentLogPanel — thẻ Nhật ký in | Log app', () => {
  it('mặc định "Nhật ký in": KHÔNG gọi API nhật ký app; bấm "Log app" → gắn thẻ, gọi API, nhớ lựa chọn', async () => {
    const w = gan();
    await flushPromises();
    expect(layNhatKy).toHaveBeenCalledTimes(1);
    expect(layNhatKyApp).not.toHaveBeenCalled();
    expect(w.find('#nk-the-in').attributes('aria-selected')).toBe('true');

    await nut(w, 'Log app')!.trigger('click');
    await flushPromises();
    expect(layNhatKyApp).toHaveBeenCalledTimes(1);
    expect(ghi).toHaveBeenCalledWith('may-in:nhat-ky-the', 'app');
    expect(w.find('#nk-the-app').attributes('aria-selected')).toBe('true');
    expect((w.find('#nk-vung-in').element as HTMLElement).style.display).toBe('none');
    expect(w.find('#nk-vung-app').exists()).toBe(true);
    w.unmount();
  });

  it('`?nhatKy=app` (tabDau) mở thẳng Log app — bảng Nhật ký in chưa tải; chọn lại "Nhật ký in" mới tải', async () => {
    const w = gan({ tabDau: 'app' });
    await flushPromises();
    expect(layNhatKyApp).toHaveBeenCalledTimes(1);
    expect(layNhatKy).not.toHaveBeenCalled();
    await nut(w, 'Nhật ký in')!.trigger('click');
    await flushPromises();
    expect(layNhatKy).toHaveBeenCalledTimes(1);
    expect(ghi).toHaveBeenCalledWith('may-in:nhat-ky-the', 'in');
    w.unmount();
  });

  it('thẻ đã nhớ = app → mở Log app; URL "in" thắng thẻ đã nhớ', async () => {
    kho['may-in:nhat-ky-the'] = 'app';
    const a = gan();
    await flushPromises();
    expect(a.find('#nk-the-app').attributes('aria-selected')).toBe('true');
    a.unmount();
    vi.mocked(layNhatKyApp).mockClear();
    const b = gan({ tabDau: 'in' });
    await flushPromises();
    expect(b.find('#nk-the-in').attributes('aria-selected')).toBe('true');
    expect(layNhatKyApp).not.toHaveBeenCalled();
    b.unmount();
  });

  it('localStorage hỏng (chế độ riêng tư) → vẫn chạy, mặc định "Nhật ký in"', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
    });
    const w = gan();
    await flushPromises();
    expect(w.find('#nk-the-in').attributes('aria-selected')).toBe('true');
    await nut(w, 'Log app')!.trigger('click');
    await flushPromises();
    expect(w.find('#nk-the-app').attributes('aria-selected')).toBe('true');
    w.unmount();
  });

  it('đang ở Log app: nhịp 15 giây vẫn báo trang cha (chip máy in) nhưng bảng Nhật ký in nghỉ; quay lại thì làm mới ngay', async () => {
    const w = gan();
    await flushPromises();
    await nut(w, 'Log app')!.trigger('click');
    await flushPromises();
    vi.advanceTimersByTime(15_000);
    await flushPromises();
    expect(w.emitted('lamMoi')).toHaveLength(1);
    expect(layNhatKy).toHaveBeenCalledTimes(1);
    const truoc = vi.mocked(layNhatKyApp).mock.calls.length;
    await nut(w, 'Nhật ký in')!.trigger('click');
    await flushPromises();
    expect(layNhatKy).toHaveBeenCalledTimes(2);
    expect(vi.mocked(layNhatKy).mock.calls[1][1]).toMatchObject({ ngam: true });
    // Thẻ Log app không được chọn → nghỉ tự làm mới 5 giây
    vi.advanceTimersByTime(12_000);
    await flushPromises();
    expect(vi.mocked(layNhatKyApp).mock.calls.length).toBe(truoc);
    w.unmount();
  });
});
