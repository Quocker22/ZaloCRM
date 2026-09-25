// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// PrintAgentAppLogPanel — hàng viên MỨC ĐỘ (hợp đồng hàng đợi/huỷ v5 §5 + §6.1): "Lỗi & cảnh báo ·
// Lỗi · Cảnh báo · Thông tin · Tất cả" như thẻ Nhật ký in, mặc định Tất cả, gửi `mucDo` lên API;
// mỗi dòng có vạch màu theo `mucDo` (hết giấy = lỗi phải nổi trong nhóm lỗi). Hàng viên sự kiện
// giữ nguyên (PrintAgentAppLogPanel.dom.spec.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { NhatKyApp, ThamSoNhatKyApp, TrangNhatKyApp } from '@/api/print-agents';

vi.mock('@/api/print-agents', () => ({
  layNhatKyApp: vi.fn(),
  taiVeNhatKyApp: vi.fn(),
  maHttpCuaLoi: (e: { response?: { status?: number } } | null) => e?.response?.status,
  laYeuCauDaHuy: (e: { code?: string } | null) => e?.code === 'ERR_CANCELED',
}));

import { layNhatKyApp } from '@/api/print-agents';
import PrintAgentAppLogPanel from './PrintAgentAppLogPanel.vue';

const vo = (the: string) => defineComponent({
  name: `Vo${the}`,
  setup(_, { slots }) {
    return () => h(the, slots.default?.());
  },
});
const VUETIFY_VO = {
  VSwitch: vo('div'), VBtn: vo('button'), VTextField: vo('div'), VSelect: vo('div'),
  VAlert: vo('div'), VProgressLinear: vo('div'), VIcon: vo('i'), VProgressCircular: vo('span'),
};
const MAY = [{ id: 'm1', ten: 'Máy HCM', warehouseIds: [], laMacDinh: true, tokenDuoi: 'ab12', online: true }];

const dong = (id: string, them: Partial<NhatKyApp> = {}): NhatKyApp => ({
  id, luc: '2026-09-25T02:59:00.000Z', mayInId: 'm1', mayInTen: 'Máy HCM', suKien: 'vet_in', noiDung: `nd ${id}`, phienBan: '0.2.6', ...them,
});

let goi: ThamSoNhatKyApp[] = [];

beforeEach(() => {
  goi = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-09-25T03:00:00Z'));
  vi.mocked(layNhatKyApp).mockReset();
  vi.mocked(layNhatKyApp).mockImplementation(async (thamSo = {}) => {
    goi.push(thamSo);
    return {
      items: [
        dong('a', { suKien: 'usb_doc', noiDung: 'cong=USB001 máy in báo hết giấy qua USB', mucDo: 'loi' }),
        dong('b', { suKien: 'mat_ket_noi', mucDo: 'canh_bao' }),
        dong('c', { suKien: 'vet_in', mucDo: 'thong_tin' }),
      ],
      tiepTheo: null,
    } satisfies TrangNhatKyApp;
  });
});
afterEach(() => {
  vi.useRealTimers();
});

function gan() {
  return mount(PrintAgentAppLogPanel, { props: { mayIns: MAY }, global: { components: VUETIFY_VO } });
}
const vienMuc = (w: ReturnType<typeof gan>) => w.find('[aria-label="Lọc theo mức độ"]');

describe('PrintAgentAppLogPanel — mức độ', () => {
  it('năm viên đúng chữ + thứ tự; mặc định "Tất cả" (không gửi mucDo)', async () => {
    const w = gan();
    await flushPromises();
    const vien = vienMuc(w).findAll('button');
    expect(vien.map((b) => b.text())).toEqual(['Lỗi & cảnh báo', 'Lỗi', 'Cảnh báo', 'Thông tin', 'Tất cả']);
    expect(vien[4].attributes('aria-checked')).toBe('true');
    expect(goi[0].mucDo).toBeUndefined();
    w.unmount();
  });

  it('bấm viên → tải lại với mucDo tương ứng; hàng viên sự kiện vẫn còn nguyên', async () => {
    const w = gan();
    await flushPromises();
    for (const [chu, ma] of [['Lỗi & cảnh báo', 'loi_canh_bao'], ['Lỗi', 'loi'], ['Cảnh báo', 'canh_bao'], ['Thông tin', 'thong_tin']] as const) {
      await vienMuc(w).findAll('button').find((b) => b.text() === chu)!.trigger('click');
      await flushPromises();
      expect(goi.at(-1)!.mucDo).toBe(ma);
    }
    await vienMuc(w).findAll('button').find((b) => b.text() === 'Tất cả')!.trigger('click');
    await flushPromises();
    expect(goi.at(-1)!.mucDo).toBeUndefined();
    expect(w.find('[aria-label="Lọc theo sự kiện"]').findAll('button').length).toBeGreaterThan(5);
    w.unmount();
  });

  it('vạch màu mỗi dòng theo mucDo: lỗi / cảnh báo / thông tin', async () => {
    const w = gan();
    await flushPromises();
    const cac = w.findAll('.nka-dong');
    expect(cac.map((d) => d.attributes('data-muc-do'))).toEqual(['loi', 'canh_bao', 'thong_tin']);
    expect(cac[0].classes()).toContain('nka-dong--muc-loi');
    expect(cac[1].classes()).toContain('nka-dong--muc-canh_bao');
    expect(cac[2].classes()).toContain('nka-dong--muc-thong_tin');
    w.unmount();
  });

  it('backend cũ không trả mucDo → suy từ tông sự kiện (su_co = lỗi) để vạch không biến mất', async () => {
    vi.mocked(layNhatKyApp).mockResolvedValueOnce({ items: [dong('x', { suKien: 'su_co' }), dong('y', { suKien: 'vet_in' })], tiepTheo: null });
    const w = gan();
    await flushPromises();
    expect(w.findAll('.nka-dong').map((d) => d.attributes('data-muc-do'))).toEqual(['loi', 'thong_tin']);
    w.unmount();
  });

  it('lọc mức mà rỗng → gợi ý chọn "Tất cả"', async () => {
    vi.mocked(layNhatKyApp).mockResolvedValue({ items: [], tiepTheo: null });
    const w = gan();
    await flushPromises();
    await vienMuc(w).findAll('button').find((b) => b.text() === 'Lỗi')!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Chọn mức "Tất cả" để xem cả dòng thông tin.');
    w.unmount();
  });
});
