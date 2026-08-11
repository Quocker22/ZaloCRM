// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: NƠI NHẬN THÔNG BÁO đọc từ DB, không còn cứng trong env.
//
// Bug gốc (11/08/2026, anh Quốc): việc báo nhân viên đi qua ĐÚNG MỘT env
// AI_AGENT_THREAD_BAO_SALE — một nhóm Zalo cố định, muốn đổi phải sửa env trên
// server rồi restart, và không phân được ai nhận việc gì.
//
// Hợp đồng test này khoá:
//   1. CHƯA cấu hình đích nào trong DB → rơi về env như cũ (tương thích ngược,
//      prod đang chạy bằng env — không được làm hỏng).
//   2. CÓ đích trong DB → dùng DB, BỎ QUA env (DB thắng, không cộng dồn).
//   3. Đích TẮT (enabled=false) → không gửi tới đó.
//   4. Org khác KHÔNG thấy đích của nhau (RLS tenant).
//   5. Lọc theo loại việc: "khách cần hỗ trợ" vs "bot gặp sự cố".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const timNhieu = vi.fn();
vi.mock('../../../src/shared/database/prisma-client.js', () => ({
  prisma: { agentNotifyTarget: { findMany: (...a: unknown[]) => timNhieu(...a) } },
}));

import {
  layDichBao,
  xoaCacheDichBao,
  LOAI_VIEC,
  type LoaiViec,
} from '../../../src/modules/ai/agent/noi-zalo/dich-bao.js';
import { logger } from '../../../src/shared/utils/logger.js';

/** Một dòng như Prisma trả về. */
function dong(p: Partial<{
  id: string; tenGoi: string; loaiDich: string; threadId: string;
  nhanKhachCanHoTro: boolean; nhanBotSuCo: boolean;
}> = {}) {
  return {
    id: p.id ?? 'dich-1',
    tenGoi: p.tenGoi ?? 'Nhóm sale',
    loaiDich: p.loaiDich ?? 'nhom',
    threadId: p.threadId ?? 'thread-db-1',
    nhanKhachCanHoTro: p.nhanKhachCanHoTro ?? true,
    nhanBotSuCo: p.nhanBotSuCo ?? true,
  };
}

let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  delete process.env.AI_AGENT_THREAD_BAO_SALE;
  delete process.env.AI_AGENT_THREAD_BAO_SALE_LOAI;
  xoaCacheDichBao();
  timNhieu.mockReset().mockResolvedValue([]);
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = goc;
  vi.restoreAllMocks();
});

describe('layDichBao — TƯƠNG THÍCH NGƯỢC với env đang chạy trên prod', () => {
  it('CHƯA có đích nào trong DB + CÓ env → rơi về env, y như trước', async () => {
    process.env.AI_AGENT_THREAD_BAO_SALE = 'nhom-sale-env';

    const dich = await layDichBao('org-1', LOAI_VIEC.KHACH_CAN_HO_TRO);

    expect(dich).toEqual([{ threadId: 'nhom-sale-env', threadType: 1, tenGoi: 'env AI_AGENT_THREAD_BAO_SALE' }]);
  });

  it('CHƯA có đích trong DB + env LOAI=0 → chat 1-1, giữ đúng ngữ nghĩa env cũ', async () => {
    process.env.AI_AGENT_THREAD_BAO_SALE = 'nick-anh-quoc';
    process.env.AI_AGENT_THREAD_BAO_SALE_LOAI = '0';

    const dich = await layDichBao('org-1', LOAI_VIEC.KHACH_CAN_HO_TRO);

    expect(dich[0]!.threadType).toBe(0);
  });

  it('KHÔNG có đích DB và KHÔNG có env → mảng rỗng (caller chỉ còn log)', async () => {
    expect(await layDichBao('org-1', LOAI_VIEC.KHACH_CAN_HO_TRO)).toEqual([]);
  });

  it('DB LỖI → rơi về env, không để một blip DB nuốt mất tin báo', async () => {
    process.env.AI_AGENT_THREAD_BAO_SALE = 'nhom-sale-env';
    timNhieu.mockRejectedValueOnce(new Error('db sap'));

    const dich = await layDichBao('org-1', LOAI_VIEC.KHACH_CAN_HO_TRO);

    expect(dich[0]!.threadId).toBe('nhom-sale-env');
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('layDichBao — CÓ cấu hình trong DB thì DB thắng', () => {
  it('có đích DB → dùng DB và BỎ QUA env (không cộng dồn, khỏi dội tin hai nơi)', async () => {
    process.env.AI_AGENT_THREAD_BAO_SALE = 'nhom-sale-env';
    timNhieu.mockResolvedValue([dong({ threadId: 'thread-db-1', tenGoi: 'Nhóm trực khách' })]);

    const dich = await layDichBao('org-1', LOAI_VIEC.KHACH_CAN_HO_TRO);

    expect(dich).toEqual([{ threadId: 'thread-db-1', threadType: 1, tenGoi: 'Nhóm trực khách' }]);
    expect(dich.some((d) => d.threadId === 'nhom-sale-env')).toBe(false);
  });

  it('nhiều đích cùng bật → gửi cho TẤT CẢ', async () => {
    timNhieu.mockResolvedValue([
      dong({ id: 'd1', threadId: 'nhom-1' }),
      dong({ id: 'd2', threadId: 'nick-quoc', loaiDich: 'ca_nhan' }),
    ]);

    const dich = await layDichBao('org-1', LOAI_VIEC.KHACH_CAN_HO_TRO);

    expect(dich.map((d) => d.threadId)).toEqual(['nhom-1', 'nick-quoc']);
  });

  it('loaiDich=ca_nhan → threadType 0; loaiDich=nhom → threadType 1', async () => {
    timNhieu.mockResolvedValue([
      dong({ id: 'd1', threadId: 'nhom-1', loaiDich: 'nhom' }),
      dong({ id: 'd2', threadId: 'nick-1', loaiDich: 'ca_nhan' }),
    ]);

    const dich = await layDichBao('org-1', LOAI_VIEC.KHACH_CAN_HO_TRO);

    expect(dich[0]!.threadType).toBe(1);
    expect(dich[1]!.threadType).toBe(0);
  });
});

describe('layDichBao — RLS tenant + đích tắt + lọc loại việc (ở tầng truy vấn)', () => {
  it('truy vấn LUÔN lọc theo orgId — org khác không thấy đích của nhau', async () => {
    await layDichBao('org-a', LOAI_VIEC.KHACH_CAN_HO_TRO);

    expect(timNhieu.mock.calls[0]![0].where).toMatchObject({ orgId: 'org-a' });
  });

  it('truy vấn LUÔN lọc enabled=true — đích tắt không được nhận tin', async () => {
    await layDichBao('org-a', LOAI_VIEC.KHACH_CAN_HO_TRO);

    expect(timNhieu.mock.calls[0]![0].where).toMatchObject({ enabled: true });
  });

  it('việc "khách cần hỗ trợ" chỉ lấy đích có nhanKhachCanHoTro', async () => {
    await layDichBao('org-a', LOAI_VIEC.KHACH_CAN_HO_TRO);

    expect(timNhieu.mock.calls[0]![0].where).toMatchObject({ nhanKhachCanHoTro: true });
  });

  it('việc "bot gặp sự cố" chỉ lấy đích có nhanBotSuCo', async () => {
    await layDichBao('org-a', LOAI_VIEC.BOT_SU_CO);

    expect(timNhieu.mock.calls[0]![0].where).toMatchObject({ nhanBotSuCo: true });
  });

  it('org KHÁC nhau không dùng chung cache — mỗi org một khoá', async () => {
    timNhieu.mockResolvedValueOnce([dong({ threadId: 'cua-org-a' })]);
    timNhieu.mockResolvedValueOnce([dong({ threadId: 'cua-org-b' })]);

    const a = await layDichBao('org-a', LOAI_VIEC.KHACH_CAN_HO_TRO);
    const b = await layDichBao('org-b', LOAI_VIEC.KHACH_CAN_HO_TRO);

    expect(a[0]!.threadId).toBe('cua-org-a');
    expect(b[0]!.threadId).toBe('cua-org-b');
  });

  it('LOẠI VIỆC khác nhau không dùng chung cache — lọc khác thì kết quả khác', async () => {
    timNhieu.mockResolvedValueOnce([dong({ threadId: 'truc-khach' })]);
    timNhieu.mockResolvedValueOnce([dong({ threadId: 'ky-thuat' })]);

    const a = await layDichBao('org-a', LOAI_VIEC.KHACH_CAN_HO_TRO);
    const b = await layDichBao('org-a', LOAI_VIEC.BOT_SU_CO);

    expect(a[0]!.threadId).toBe('truc-khach');
    expect(b[0]!.threadId).toBe('ky-thuat');
  });
});

describe('cache — không query DB mỗi tin, nhưng admin sửa là hiệu lực NGAY', () => {
  it('gọi hai lần liên tiếp chỉ query DB MỘT lần (cache TTL)', async () => {
    timNhieu.mockResolvedValue([dong()]);

    await layDichBao('org-1', LOAI_VIEC.KHACH_CAN_HO_TRO);
    await layDichBao('org-1', LOAI_VIEC.KHACH_CAN_HO_TRO);

    expect(timNhieu).toHaveBeenCalledTimes(1);
  });

  it('xoaCacheDichBao(orgId) → lần gọi sau query lại DB (admin sửa có hiệu lực ngay)', async () => {
    timNhieu.mockResolvedValue([dong()]);
    await layDichBao('org-1', LOAI_VIEC.KHACH_CAN_HO_TRO);

    xoaCacheDichBao('org-1');
    await layDichBao('org-1', LOAI_VIEC.KHACH_CAN_HO_TRO);

    expect(timNhieu).toHaveBeenCalledTimes(2);
  });

  it('xoaCacheDichBao(org-1) KHÔNG đụng cache của org-2', async () => {
    timNhieu.mockResolvedValue([dong()]);
    await layDichBao('org-1', LOAI_VIEC.KHACH_CAN_HO_TRO);
    await layDichBao('org-2', LOAI_VIEC.KHACH_CAN_HO_TRO);

    xoaCacheDichBao('org-1');
    await layDichBao('org-2', LOAI_VIEC.KHACH_CAN_HO_TRO);

    expect(timNhieu).toHaveBeenCalledTimes(2); // org-2 vẫn dùng cache
  });
});

describe('LOAI_VIEC — hai loại việc tách được', () => {
  it('có đủ hai loại và giá trị ổn định (ghi vào DB nên không được đổi tuỳ tiện)', () => {
    const loai: Record<string, LoaiViec> = LOAI_VIEC;
    expect(loai.KHACH_CAN_HO_TRO).toBe('khach_can_ho_tro');
    expect(loai.BOT_SU_CO).toBe('bot_su_co');
  });
});
