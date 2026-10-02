// SPDX-License-Identifier: AGPL-3.0-or-later
// Mục menu "Bản đồ tin": Cài đặt → Hệ thống, cùng khuôn quyền với "Quyền bot".
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ canAccess: () => true }) }));
vi.mock('@ee/nav', () => ({ eeSettingsItems: {} }));
vi.mock('@ee/edition', () => ({ isExtension: false }));

import { SETTINGS_GROUPS } from '@/composables/use-settings-nav';

describe('menu Cài đặt → Hệ thống → Bản đồ tin', () => {
  it('có mục /settings/ban-do-tin, quyền admin như Quyền bot, tìm được bằng "bản đồ tin" / "composer" / "luồng tin"', () => {
    const heThong = SETTINGS_GROUPS.find((g) => g.id === 'system')!;
    const muc = heThong.items.find((i) => i.id === 'ban-do-tin')!;
    const mau = heThong.items.find((i) => i.id === 'bot-quyen')!;
    expect(muc.label).toBe('Bản đồ tin');
    expect(muc.route).toBe('/settings/ban-do-tin');
    expect(muc.permission).toBe('admin');
    expect(muc.resource).toBe(mau.resource);
    expect(muc.aliases).toEqual(expect.arrayContaining(['bản đồ tin', 'composer', 'luồng tin']));
  });
});
