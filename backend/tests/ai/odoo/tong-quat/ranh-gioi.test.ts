// SPDX-License-Identifier: AGPL-3.0-or-later
// RANH GIỚI: 3 tool tổng quát chỉ dành cho NHÂN VIÊN.
// Khách điều khiển được câu chữ → sẽ điều khiển được lệnh Odoo. Hàng rào phải
// ở tầng registry, không phải prompt (prompt lèo lái được).
import { describe, it, expect, vi } from 'vitest';
import { buildStaffRegistry } from '../../../../src/modules/ai/agent/staff-agent.js';
import { buildCustomerRegistry } from '../../../../src/modules/ai/agent/customer-agent.js';
import type { OdooClient } from '../../../../src/modules/ai/odoo/client.js';

const odoo = { searchRead: vi.fn(async () => []), execute: vi.fn(async () => 1) } as unknown as OdooClient;

describe('ranh giới 3 tool Odoo tổng quát', () => {
  it('registry NHÂN VIÊN có đủ 3 tool', () => {
    const r = buildStaffRegistry({ odoo, conversationId: 'c', seq: 0, ghiNhanChuyenSale: async () => {} });
    const ten = r.definitions().map((d) => d.name);
    expect(ten).toContain('doc_odoo');
    expect(ten).toContain('lam_odoo');
    expect(ten).toContain('kham_pha_odoo');
  });

  it('registry KHÁCH TUYỆT ĐỐI không có', () => {
    const r = buildCustomerRegistry({ odoo, ghiNhanChuyenSale: async () => {} });
    const ten = r.definitions().map((d) => d.name);
    expect(ten).not.toContain('doc_odoo');
    expect(ten).not.toContain('lam_odoo');
    expect(ten).not.toContain('kham_pha_odoo');
  });
});
