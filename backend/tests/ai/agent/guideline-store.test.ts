// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit test: nạp guideline từ DB cho một phiên luồng khách.
//
// Điểm an toàn quan trọng nhất: DB lỗi (bảng chưa migrate trên prod, mạng đứt)
// → trả null = engine coi như OFF, prompt tĩnh chạy như hôm nay. Guideline
// engine không bao giờ được là lý do bot câm.
import { describe, it, expect, vi } from 'vitest';
import { napGuidelineKhach } from '../../../src/modules/ai/agent/guideline-store.js';

const HANG = (over: Record<string, unknown> = {}) => ({
  ten: 'hoi-danh-muc', vai: 'khach', condition: 'khách hỏi shop bán gì',
  action: 'Dùng tra_danh_muc.', mucDo: 'thuong', tools: ['tra_danh_muc'],
  stage: 'khai_thac', uuTien: 100, yeuCau: null, ...over,
});

describe('napGuidelineKhach', () => {
  it('chỉ lấy vai=khach + enabled, và lọc biến thể theo tuChotDon', async () => {
    const findMany = vi.fn(async () => [
      HANG(),
      HANG({ ten: 'chot-tu-len-don', yeuCau: 'tu_chot_don' }),
      HANG({ ten: 'chot-chuyen-sale', yeuCau: 'khong_tu_chot_don' }),
    ]);

    const kq = await napGuidelineKhach({ aiGuideline: { findMany } }, 'org1', false);

    expect(findMany).toHaveBeenCalledWith({
      where: { orgId: 'org1', vai: 'khach', enabled: true },
      orderBy: [{ uuTien: 'asc' }, { ten: 'asc' }],
    });
    expect(kq?.map((g) => g.ten)).toEqual(['hoi-danh-muc', 'chot-chuyen-sale']);
  });

  it('DB lỗi → trả null (engine coi như OFF), không ném', async () => {
    const findMany = vi.fn(async () => { throw new Error('bảng chưa tồn tại'); });

    const kq = await napGuidelineKhach({ aiGuideline: { findMany } }, 'org1', true);

    expect(kq).toBeNull();
  });

  it('DB rỗng → trả null: chưa seed thì đừng bật engine với kho rule trống', async () => {
    const findMany = vi.fn(async () => []);

    const kq = await napGuidelineKhach({ aiGuideline: { findMany } }, 'org1', true);

    expect(kq).toBeNull();
  });
});
