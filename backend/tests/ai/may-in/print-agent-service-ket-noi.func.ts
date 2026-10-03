// SPDX-License-Identifier: AGPL-3.0-or-later
// print-agent-service.ts — GET /may-in-agents (danhSachMayIn, trang Cài đặt › Máy in) trả thêm
// `ketNoi` / `heDieuHanh` / `banBuild` / `phienBan` của app ĐANG nối (registry, thong-tin-app);
// null khi app offline / app cũ / chưa gửi. Token vẫn chỉ lộ 4 ký tự cuối.
// (giám sát vòng 2) GET / mở cho mọi người đăng nhập: IP LAN, cổng Windows, hệ điều hành CHỈ cho
// owner/admin — thành viên thường chỉ thấy loại kết nối (traDanhSachMayIn).
import { describe, it, expect, vi, afterEach } from 'vitest';

const { prismaGia } = vi.hoisted(() => ({
  prismaGia: { printAgent: { findMany: vi.fn() } },
}));
vi.mock('../../../src/shared/database/prisma-client.js', () => ({ prisma: prismaGia }));

import { danhSachMayIn, type MayInAnToan } from '../../../src/modules/ai/may-in/print-agent-service.js';
import { agentRegistry } from '../../../src/modules/ai/may-in/agent-registry.js';
import { traDanhSachMayIn } from '../../../src/modules/ai/may-in/print-agent-routes.js';

describe('GET /may-in-agents (traDanhSachMayIn) — chi tiết mạng chỉ cho owner/admin', () => {
  const MAY: MayInAnToan = {
    id: 'mHN', orgId: 'o1', ten: 'Máy HN', tokenDuoi: 'HN01', warehouseIds: [2], laMacDinh: true, online: true, tinhTrang: null,
    ketNoi: {
      loai: 'wsd', laMang: true, cong: 'WSD-3f2a', ip: '192.168.1.23', nguonIp: 'pnpx',
      mayTraLoi: 'sẵn sàng (IPP)', moTa: 'Mạng LAN (WSD) · 192.168.1.23 · máy báo sẵn sàng',
    },
    heDieuHanh: 'Windows 7 SP1 (6.1.7601)', banBuild: 'win7', phienBan: '0.2.8',
    createdAt: new Date('2026-09-10T00:00:00Z'), updatedAt: new Date('2026-09-10T00:00:00Z'),
  };
  const lay = vi.fn(async () => [MAY, { ...MAY, id: 'mCu', ketNoi: null, heDieuHanh: null }]);

  it('owner / admin → đủ IP, cổng, câu trả lời, hệ điều hành', async () => {
    for (const role of ['owner', 'admin']) {
      const kq = await traDanhSachMayIn({ orgId: 'o1', role }, { lay });
      expect(kq.code).toBe(200);
      expect(kq.body.mayIn[0]).toEqual(MAY);
    }
    expect(lay).toHaveBeenLastCalledWith('o1');
  });

  it('thành viên thường → chỉ loại + laMang + nhãn loại; KHÔNG IP / cổng / hệ điều hành ở bất kỳ đâu', async () => {
    const kq = await traDanhSachMayIn({ orgId: 'o1', role: 'member' }, { lay });
    expect(kq.body.mayIn[0].ketNoi).toEqual({
      loai: 'wsd', laMang: true, cong: null, ip: null, nguonIp: null, mayTraLoi: null, moTa: 'Mạng LAN (WSD)',
    });
    expect(kq.body.mayIn[0]).toMatchObject({ heDieuHanh: null, phienBan: '0.2.8', online: true, ten: 'Máy HN' });
    expect(kq.body.mayIn[1].ketNoi).toBeNull();
    const chu = JSON.stringify(kq.body);
    for (const bi of ['192.168.1.23', 'WSD-3f2a', 'Windows 7', 'pnpx']) expect(chu, bi).not.toContain(bi);
  });
});

const TOKEN_HN = 'token-hn-bi-mat-0123456789abcdef-HN01';
const TOKEN_HCM = 'token-hcm-bi-mat-0123456789abcdef-HC02';
const TOKEN_CU = 'token-app-cu-0123456789abcdef-CU03';

const dongMay = (id: string, token: string) => ({
  id, orgId: 'o1', ten: `Máy ${id}`, token, warehouseIds: [2], laMacDinh: id === 'mHN',
  createdAt: new Date('2026-09-10T00:00:00Z'), updatedAt: new Date('2026-09-10T00:00:00Z'),
});

const huyDangKy: Array<() => void> = [];
afterEach(() => {
  for (const h of huyDangKy.splice(0)) h();
});

describe('danhSachMayIn — kết nối máy in / hệ điều hành / bản build', () => {
  it('app đang nối có thong-tin-app mới → trả đủ; app cũ → kết nối null; offline → mọi trường null', async () => {
    prismaGia.printAgent.findMany.mockResolvedValue([dongMay('mHN', TOKEN_HN), dongMay('mHCM', TOKEN_HCM), dongMay('mCu', TOKEN_CU)]);
    huyDangKy.push(agentRegistry.dangKy(TOKEN_HN, () => {}), agentRegistry.dangKy(TOKEN_CU, () => {}));
    const ketNoi = {
      loai: 'wsd' as const, laMang: true, cong: 'WSD-3f2a', ip: '192.168.1.23', nguonIp: 'pnpx' as const,
      mayTraLoi: 'sẵn sàng (IPP)', moTa: 'Mạng LAN (WSD) · 192.168.1.23 · máy báo sẵn sàng',
    };
    agentRegistry.capNhatThongTinApp(TOKEN_HN, { phienBan: '0.2.8', ketNoi, heDieuHanh: 'Windows 7 SP1 (6.1.7601)', banBuild: 'win7', luc: new Date() });
    agentRegistry.capNhatThongTinApp(TOKEN_CU, { phienBan: '0.2.7', ketNoi: null, heDieuHanh: null, banBuild: null, luc: new Date() });
    // Máy HCM offline: ghi cũng không giữ (không có kết nối nào)
    agentRegistry.capNhatThongTinApp(TOKEN_HCM, { phienBan: '0.2.8', ketNoi, heDieuHanh: 'Windows 10', banBuild: 'thuong', luc: new Date() });

    const ds = await danhSachMayIn('o1');
    expect(prismaGia.printAgent.findMany).toHaveBeenCalledWith({ where: { orgId: 'o1' }, orderBy: { createdAt: 'asc' } });
    const theo = Object.fromEntries(ds.map((m) => [m.id, m]));
    expect(theo.mHN).toMatchObject({ online: true, ketNoi, heDieuHanh: 'Windows 7 SP1 (6.1.7601)', banBuild: 'win7', phienBan: '0.2.8', tokenDuoi: 'HN01' });
    expect(theo.mCu).toMatchObject({ online: true, ketNoi: null, heDieuHanh: null, banBuild: null, phienBan: '0.2.7' });
    expect(theo.mHCM).toMatchObject({ online: false, ketNoi: null, heDieuHanh: null, banBuild: null, phienBan: null });
    expect(JSON.stringify(ds)).not.toContain('bi-mat');
  });

  it('app mất kết nối (hết mọi kết nối của máy) → thông tin bị bỏ, nối lại chưa gửi thì vẫn null', async () => {
    prismaGia.printAgent.findMany.mockResolvedValue([dongMay('mHN', TOKEN_HN)]);
    const huy = agentRegistry.dangKy(TOKEN_HN, () => {});
    agentRegistry.capNhatThongTinApp(TOKEN_HN, {
      phienBan: '0.2.8', ketNoi: { loai: 'usb', laMang: false, cong: 'USB001', ip: null, nguonIp: null, mayTraLoi: null, moTa: 'USB (USB001)' },
      heDieuHanh: 'Windows 10', banBuild: 'thuong', luc: new Date(),
    });
    expect((await danhSachMayIn('o1'))[0].ketNoi?.loai).toBe('usb');
    huy();
    expect((await danhSachMayIn('o1'))[0]).toMatchObject({ online: false, ketNoi: null, phienBan: null });
    huyDangKy.push(agentRegistry.dangKy(TOKEN_HN, () => {}));
    expect((await danhSachMayIn('o1'))[0]).toMatchObject({ online: true, ketNoi: null, heDieuHanh: null });
  });
});
