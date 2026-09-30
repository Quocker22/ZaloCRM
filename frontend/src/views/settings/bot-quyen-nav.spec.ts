// SPDX-License-Identifier: AGPL-3.0-or-later
// Mục menu "Quyền bot": Cài đặt → Hệ thống, cùng khuôn quyền với "Nhân viên sai bot" (permission admin,
// resource settings — owner/admin qua canAccess; backend chặn thêm owner/admin ở MỌI route).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ canAccess: () => true }) }));
vi.mock('@ee/nav', () => ({ eeSettingsItems: {} }));
vi.mock('@ee/edition', () => ({ isExtension: false }));

import { SETTINGS_GROUPS } from '@/composables/use-settings-nav';

describe('menu Cài đặt → Hệ thống → Quyền bot', () => {
  it('có mục /settings/bot-quyen, quyền giống mục Nhân viên sai bot, tìm được bằng "quyền bot" / "chức năng nhóm"', () => {
    const heThong = SETTINGS_GROUPS.find((g) => g.id === 'system')!;
    const muc = heThong.items.find((i) => i.id === 'bot-quyen')!;
    const mau = heThong.items.find((i) => i.id === 'agent-operators')!;
    expect(muc).toBeDefined();
    expect(muc.label).toBe('Quyền bot');
    expect(muc.route).toBe('/settings/bot-quyen');
    expect(muc.permission).toBe('admin');
    expect(muc.resource).toBe(mau.resource);
    expect(muc.aliases).toEqual(expect.arrayContaining(['quyền bot', 'phân quyền bot', 'chức năng nhóm']));
  });
});
