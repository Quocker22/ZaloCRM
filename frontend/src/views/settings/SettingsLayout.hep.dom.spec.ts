// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// SettingsLayout — màn hẹp (điện thoại, < 768px): sidebar 260px cố định từng chừa cho nội dung
// ~130px ở màn 390px (hàng đợi in không dùng được). Giờ sidebar là ngăn trượt: nút "Mục cài đặt"
// ở thanh đường dẫn mở/đóng, bấm nền mờ hoặc chuyển trang thì tự đóng. (Bố cục theo @media —
// jsdom không tính CSS; test khoá HÀNH VI mở/đóng + thuộc tính a11y.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, reactive, computed } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

const { route } = vi.hoisted(() => ({ route: { path: '/settings/crm/print-agents', fullPath: '/settings/crm/print-agents', query: {} as Record<string, string> } }));
const routeReactive = reactive(route);
vi.mock('vue-router', () => ({
  useRoute: () => routeReactive,
  useRouter: () => ({ replace: vi.fn() }),
}));
// RouterLink / RouterView là component toàn cục của vue-router — gắn vỏ qua global.components.
const RouterLink = defineComponent({ props: { to: String }, setup(p, { slots }) { return () => h('a', { href: p.to }, slots.default?.()); } });
const RouterView = defineComponent({ setup() { return () => h('div', { class: 'vo-router-view' }, 'Trang Máy in'); } });
vi.mock('@/composables/use-settings-nav', () => ({
  useSettingsNav: () => ({
    visibleGroups: computed(() => [{ id: 'he_thong', label: 'Hệ thống', icon: 'mdi-cog', items: [{ route: '/settings/crm/print-agents', label: 'Máy in', icon: 'mdi-printer' }] }]),
    activeItem: computed(() => ({ group: { id: 'he_thong', label: 'Hệ thống' }, item: { label: 'Máy in' } })),
    searchItems: () => [],
    defaultRoute: computed(() => '/settings/crm/print-agents'),
  }),
}));

import SettingsLayout from './SettingsLayout.vue';

const vo = (the: string) => defineComponent({ setup(_, { slots }) { return () => h(the, slots.default?.()); } });

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function gan() {
  return mount(SettingsLayout, { global: { components: { VIcon: vo('i'), RouterLink, RouterView } } });
}

describe('SettingsLayout — màn hẹp: sidebar thành ngăn trượt', () => {
  it('nút "Mục cài đặt" mở/đóng ngăn (aria-expanded + lớp mở); bấm nền mờ thì đóng', async () => {
    const w = gan();
    const nut = w.find('.sl-nut-menu');
    expect(nut.text()).toContain('Mục cài đặt');
    expect(nut.attributes('aria-controls')).toBe('sl-sidebar');
    expect(w.find('#sl-sidebar').exists()).toBe(true);
    expect(nut.attributes('aria-expanded')).toBe('false');
    expect(w.find('.settings-layout').classes()).not.toContain('settings-layout--mo-menu');
    await nut.trigger('click');
    expect(w.find('.settings-layout').classes()).toContain('settings-layout--mo-menu');
    expect(w.find('.sl-nut-menu').attributes('aria-expanded')).toBe('true');
    await w.find('.sl-man-che').trigger('click');
    expect(w.find('.settings-layout').classes()).not.toContain('settings-layout--mo-menu');
    expect(w.find('.sl-man-che').exists()).toBe(false);
    w.unmount();
  });

  it('chuyển trang (bấm một mục) → ngăn tự đóng; nội dung trang vẫn hiện', async () => {
    const w = gan();
    await w.find('.sl-nut-menu').trigger('click');
    routeReactive.fullPath = '/settings/crm/print-agents?nhatKy=hang_doi';
    await flushPromises();
    expect(w.find('.settings-layout').classes()).not.toContain('settings-layout--mo-menu');
    expect(w.find('.vo-router-view').text()).toBe('Trang Máy in');
    w.unmount();
  });
});
