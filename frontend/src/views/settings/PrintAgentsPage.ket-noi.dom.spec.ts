// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// PrintAgentsPage — dòng "máy in nối kiểu gì" trên thẻ mỗi máy (app ≥ 0.2.8, `ketNoi` trong
// GET /may-in-agents): "🔌 USB" · "🌐 <moTa mạng LAN>" · "Máy in chia sẻ" · không rõ / app cũ /
// offline → không hiện gì; dòng "Máy tính" = hệ điều hành + phiên bản app. Trang ép theme sáng.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { KetNoiMayIn, MayIn } from '@/api/print-agents';

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isAdmin: true }) }));
vi.mock('@/composables/use-toast', () => ({ useToast: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }) }));
vi.mock('@/api/print-agents', () => ({
  layDanhSach: vi.fn(),
  layKhos: vi.fn(async () => []),
  tao: vi.fn(), sua: vi.fn(), xoa: vi.fn(),
  layHangDoi: vi.fn(async () => ({ choIn: [], chuaXacNhan: [], capNhat: '' })),
  huyLenhIn: vi.fn(), boTheoDoiLenhIn: vi.fn(),
  layNhatKy: vi.fn(async () => ({ items: [], tiepTheo: null })),
  layNhatKyApp: vi.fn(async () => ({ items: [], tiepTheo: null })),
  taiVeNhatKyApp: vi.fn(),
  layDemLichSuIn: vi.fn(async () => null),
  layLichSuIn: vi.fn(async () => ({ items: [], tiepTheo: null, tong: 0, tu: null })),
  maHttpCuaLoi: (e: { response?: { status?: number } } | null) => e?.response?.status,
  laYeuCauDaHuy: (e: { code?: string } | null) => e?.code === 'ERR_CANCELED',
}));

import { layDanhSach } from '@/api/print-agents';
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

const kn = (them: Partial<KetNoiMayIn>): KetNoiMayIn => ({
  loai: null, laMang: null, cong: null, ip: null, nguonIp: null, mayTraLoi: null, moTa: null, ...them,
});
const may = (id: string, them: Partial<MayIn> = {}): MayIn => ({
  id, ten: `Máy ${id}`, warehouseIds: [], laMacDinh: false, tokenDuoi: id.slice(-4), online: true, ...them,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-09-26T08:00:00Z'));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.mocked(layDanhSach).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function gan(ds: MayIn[]) {
  vi.mocked(layDanhSach).mockResolvedValue(ds);
  const w = mount(PrintAgentsPage, { global: { components: VUETIFY_VO } });
  await flushPromises();
  return w;
}
const the = (w: Awaited<ReturnType<typeof gan>>, ten: string) => w.find(`article[aria-label="Máy in ${ten}"]`);

describe('PrintAgentsPage — dòng kết nối máy in', () => {
  it('USB → "🔌 USB"; mạng LAN (WSD) → "🌐 <moTa>"; chia sẻ → "Máy in chia sẻ"', async () => {
    const w = await gan([
      may('usb', { ketNoi: kn({ loai: 'usb', laMang: false, cong: 'USB001', moTa: 'USB (USB001)' }) }),
      may('wsd', {
        ketNoi: kn({
          loai: 'wsd', laMang: true, cong: 'WSD-3f2a', ip: '192.168.1.23', nguonIp: 'pnpx',
          mayTraLoi: 'sẵn sàng (IPP)', moTa: 'Mạng LAN (WSD) · 192.168.1.23 · máy báo sẵn sàng',
        }),
      }),
      may('chiase', { ketNoi: kn({ loai: 'chia_se', laMang: false, cong: '\\\\KHO\\HP' }) }),
    ]);
    const usb = the(w, 'Máy usb').find('.pa-ket-noi-may');
    expect(usb.text()).toBe('🔌 USB');
    expect(usb.classes()).toContain('pa-ket-noi-may--usb');
    expect(usb.attributes('title')).toBe('Cổng Windows: USB001');
    const wsd = the(w, 'Máy wsd').find('.pa-ket-noi-may');
    expect(wsd.text()).toBe('🌐 Mạng LAN (WSD) · 192.168.1.23 · máy báo sẵn sàng');
    expect(wsd.classes()).toContain('pa-ket-noi-may--mang');
    expect(wsd.attributes('title')).toBe('Cổng Windows: WSD-3f2a · IP lấy từ PnP-X (WSD)');
    expect(the(w, 'Máy chiase').find('.pa-ket-noi-may').text()).toBe('Máy in chia sẻ');
    // cả trang ép theme sáng (MobileLayout mặc định tối)
    expect(w.find('[data-theme="hsLight"]').exists()).toBe(true);
    w.unmount();
  });

  it('không rõ / app cũ / offline → KHÔNG hiện dòng kết nối', async () => {
    const w = await gan([
      may('cu', { ketNoi: null, phienBan: '0.2.7' }), // app cũ
      may('vang'), // backend cũ: không có trường nào
      may('khac', { ketNoi: kn({ loai: 'khac', laMang: false, cong: 'FILE:' }) }),
      may('off', { online: false, ketNoi: kn({ loai: 'usb', laMang: false }) }),
    ]);
    for (const ten of ['Máy cu', 'Máy vang', 'Máy khac', 'Máy off']) {
      expect(the(w, ten).find('.pa-ket-noi-may').exists(), ten).toBe(false);
    }
    w.unmount();
  });

  it('dòng "Máy tính": hệ điều hành + phiên bản app (+ "bản Win7"); không biết / offline → không có dòng', async () => {
    const w = await gan([
      may('w7', { heDieuHanh: 'Windows 7 SP1 (6.1.7601)', phienBan: '0.2.8', banBuild: 'win7', ketNoi: kn({ loai: 'usb', laMang: false }) }),
      may('cu', { phienBan: '0.2.7' }),
      may('trong'),
      may('off', { online: false, heDieuHanh: 'Windows 10', phienBan: '0.2.8' }),
    ]);
    const dongMayTinh = (ten: string) => the(w, ten).findAll('.pa-tt-dong').find((d) => d.find('dt').text() === 'Máy tính');
    expect(dongMayTinh('Máy w7')!.find('dd').text()).toBe('Windows 7 SP1 (6.1.7601) · app v0.2.8 · bản Win7');
    expect(dongMayTinh('Máy cu')!.find('dd').text()).toBe('app v0.2.7');
    expect(dongMayTinh('Máy trong')).toBeUndefined();
    expect(dongMayTinh('Máy off')).toBeUndefined();
    w.unmount();
  });
});
