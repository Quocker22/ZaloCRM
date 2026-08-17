// SPDX-License-Identifier: AGPL-3.0-or-later
// 17/08/2026 — công tắc agent chuyển từ env AI_AGENT_* sang CRM (ai_configs).
// Anh Quốc: "mấy cái này tôi handle trên zalocrm hết". Khoá: đọc DB + cache
// 30s + fail-safe TẮT khi DB lỗi/chưa nạp + env chỉ là lối tắt test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const findUnique = vi.fn();
vi.mock('../../../../src/shared/database/prisma-client.js', () => ({
  prisma: { aiConfig: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

const mod = await import('../../../../src/modules/ai/agent/noi-zalo/cong-tac.js');

beforeEach(() => {
  mod.xoaCacheCongTac();
  findUnique.mockReset();
  delete process.env.AI_AGENT_NHANVIEN; delete process.env.AI_AGENT_KHACH; delete process.env.AI_AGENT_KHACH_TU_CHOT;
});
afterEach(() => { mod.xoaCacheCongTac(); });

describe('công tắc agent đọc từ CRM', () => {
  it('chưa nạp → TẮT hết (fail-safe: không tự bật agent)', () => {
    expect(mod.batLuongNhanVien()).toBe(false);
    expect(mod.batLuongKhach()).toBe(false);
    expect(mod.batKhachTuChotDon()).toBe(false);
  });

  it('nạp từ DB → phản ánh đúng 3 cột; lần 2 trong 30s KHÔNG query lại (cache)', async () => {
    findUnique.mockResolvedValue({ agentNhanVienEnabled: true, agentKhachEnabled: true, agentKhachTuChotEnabled: false });
    await mod.napCongTacAgent('o1');
    expect(mod.batLuongNhanVien()).toBe(true);
    expect(mod.batLuongKhach()).toBe(true);
    expect(mod.batKhachTuChotDon()).toBe(false);
    await mod.napCongTacAgent('o1');
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('DB lỗi → dùng cache cũ; không có cache → tắt, KHÔNG ném', async () => {
    findUnique.mockRejectedValue(new Error('db chết'));
    const kq = await mod.napCongTacAgent('o2');
    expect(kq.nhanVien).toBe(false);
    expect(mod.batLuongNhanVien()).toBe(false);
  });

  it('sửa trên CRM → xoaCacheCongTac → lần nạp sau đọc giá trị mới', async () => {
    findUnique.mockResolvedValueOnce({ agentNhanVienEnabled: false, agentKhachEnabled: false, agentKhachTuChotEnabled: false });
    await mod.napCongTacAgent('o3');
    expect(mod.batLuongNhanVien()).toBe(false);
    mod.xoaCacheCongTac();
    findUnique.mockResolvedValueOnce({ agentNhanVienEnabled: true, agentKhachEnabled: false, agentKhachTuChotEnabled: false });
    await mod.napCongTacAgent('o3');
    expect(mod.batLuongNhanVien()).toBe(true);
  });

  it('env AI_AGENT_* chỉ là LỐI TẮT test: có đặt thì thắng DB', async () => {
    findUnique.mockResolvedValue({ agentNhanVienEnabled: false, agentKhachEnabled: false, agentKhachTuChotEnabled: false });
    await mod.napCongTacAgent('o4');
    process.env.AI_AGENT_KHACH = '1';
    expect(mod.batLuongKhach()).toBe(true);
    expect(mod.batLuongNhanVien()).toBe(false);
  });
});
