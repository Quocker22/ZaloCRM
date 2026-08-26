// SPDX-License-Identifier: AGPL-3.0-or-later
// RANH GIỚI in_hoa_don: chỉ NHÂN VIÊN, và chỉ khi hệ có máy in (deps.themJobIn).
// Hàng rào ở tầng registry, không phải prompt (cùng nếp ranh-gioi.test.ts).
import { describe, it, expect, vi } from 'vitest';
import { buildStaffRegistry } from '../../../src/modules/ai/agent/staff-agent.js';
import { buildCustomerRegistry } from '../../../src/modules/ai/agent/customer-agent.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';

const odoo = { searchRead: vi.fn(async () => []), execute: vi.fn(async () => 1) } as unknown as OdooClient;

describe('ranh giới in_hoa_don', () => {
  it('CÓ themJobIn + odooUrl → registry nhân viên có in_hoa_don', () => {
    const r = buildStaffRegistry({
      odoo, conversationId: 'c', seq: 0, ghiNhanChuyenSale: async () => {},
      themJobIn: async () => {}, odooUrl: 'http://odoo',
    });
    expect(r.definitions().map((d) => d.name)).toContain('in_hoa_don');
  });

  it('KHÔNG có themJobIn (chưa cấu hình máy in) → tool KHÔNG đăng ký', () => {
    const r = buildStaffRegistry({ odoo, conversationId: 'c', seq: 0, ghiNhanChuyenSale: async () => {}, odooUrl: 'http://odoo' });
    expect(r.definitions().map((d) => d.name)).not.toContain('in_hoa_don');
  });

  it('CÓ themJobIn nhưng THIẾU odooUrl (không xuất hoá đơn được) → tool KHÔNG đăng ký', () => {
    const r = buildStaffRegistry({ odoo, conversationId: 'c', seq: 0, ghiNhanChuyenSale: async () => {}, themJobIn: async () => {} });
    expect(r.definitions().map((d) => d.name)).not.toContain('in_hoa_don');
  });

  it('registry KHÁCH tuyệt đối không có in_hoa_don', () => {
    const r = buildCustomerRegistry({ odoo, ghiNhanChuyenSale: async () => {} });
    expect(r.definitions().map((d) => d.name)).not.toContain('in_hoa_don');
  });
});
