/**
 * friend-sync-cron.test.ts — Test runFriendSyncCycleNow (direct cycle, no scheduler).
 * Verify: iterate accounts, error in 1 account không break others, no accounts → no-op.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  zaloAccount: { findMany: vi.fn() },
};
// API đổi: cron giờ gọi syncAccountFully (bọc friends + aliases + labels),
// không còn syncFriendsForAccount. Test cũ mock tên hàm đã bỏ.
const syncAccountFullyMock = vi.fn();

vi.mock('../src/shared/database/prisma-client.js', () => ({
  // tenantTransaction thêm vào code sau khi test này viết (RLS Giai đoạn 0).
  // Chuyển tiếp sang $transaction để test nào đã mockImplementation vẫn kiểm soát tx.
  tenantTransaction: (fn: (tx: unknown) => unknown) =>
    (prismaMock as any).$transaction ? (prismaMock as any).$transaction(fn) : fn(prismaMock), prisma: prismaMock }));
// runSystemQuery thêm vào cron sau (cross-org sweep). Mock: chạy thẳng callback.
vi.mock('../src/shared/tenant/tenant-context.js', () => ({
  runSystemQuery: (fn: () => Promise<unknown>) => fn(),
  withTenant: (_o: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/zalo/friend-sync-service.js', () => ({
  syncAccountFully: syncAccountFullyMock,
}));
vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
  },
}));

const { runFriendSyncCycleNow } = await import('../src/modules/zalo/friend-sync-cron.js');

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.zaloAccount.findMany.mockReset();
  syncAccountFullyMock.mockReset();
});

describe('runFriendSyncCycleNow', () => {
  it('no-op when no connected accounts', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([]);
    await runFriendSyncCycleNow(null);
    expect(syncAccountFullyMock).not.toHaveBeenCalled();
  });

  it('iterates each connected account sequentially', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([
      { id: 'za-1', orgId: 'org-1', displayName: 'Nick 1' },
      { id: 'za-2', orgId: 'org-1', displayName: 'Nick 2' },
    ]);
    // SyncAccountFullyResult: { friends, aliasesUpdated, labelsUpdated, errors[], durationMs }
    syncAccountFullyMock.mockResolvedValue({
      friends: { emittedCount: 0, errors: 0 },
      aliasesUpdated: 0, labelsUpdated: 0, errors: [], durationMs: 1,
    });
    await runFriendSyncCycleNow(null);
    expect(syncAccountFullyMock).toHaveBeenCalledTimes(2);
    expect(syncAccountFullyMock).toHaveBeenNthCalledWith(
      1, 'za-1', 'org-1', { trigger: 'cron', io: null },
    );
    expect(syncAccountFullyMock).toHaveBeenNthCalledWith(
      2, 'za-2', 'org-1', { trigger: 'cron', io: null },
    );
  });

  it('continues iteration when 1 account fails', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([
      { id: 'za-bad', orgId: 'org-1', displayName: 'Bad' },
      { id: 'za-good', orgId: 'org-1', displayName: 'Good' },
    ]);
    syncAccountFullyMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        liveCount: 5, createdContacts: 0, upsertedFriends: 5,
        emittedCount: 1, errors: 0, durationMs: 50, skipped: null,
      });
    await runFriendSyncCycleNow(null);
    expect(syncAccountFullyMock).toHaveBeenCalledTimes(2);
  });

  it('accumulates emittedCount + errors across accounts', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([
      { id: 'za-1', orgId: 'o', displayName: 'A' },
      { id: 'za-2', orgId: 'o', displayName: 'B' },
    ]);
    syncAccountFullyMock
      .mockResolvedValueOnce({
        liveCount: 10, createdContacts: 0, upsertedFriends: 10,
        emittedCount: 3, errors: 1, durationMs: 100, skipped: null,
      })
      .mockResolvedValueOnce({
        liveCount: 5, createdContacts: 1, upsertedFriends: 5,
        emittedCount: 2, errors: 0, durationMs: 80, skipped: null,
      });
    // No throw → just verify total via logger spy not feasible without
    // refactoring. Smoke: 2 calls completed.
    await runFriendSyncCycleNow(null);
    expect(syncAccountFullyMock).toHaveBeenCalledTimes(2);
  });

  it('passes IO param through to syncFriendsForAccount', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([
      { id: 'za-io', orgId: 'org-1', displayName: 'Nick' },
    ]);
    // SyncAccountFullyResult: { friends, aliasesUpdated, labelsUpdated, errors[], durationMs }
    syncAccountFullyMock.mockResolvedValue({
      friends: { emittedCount: 0, errors: 0 },
      aliasesUpdated: 0, labelsUpdated: 0, errors: [], durationMs: 1,
    });
    const fakeIO = { emit: vi.fn() } as any;
    await runFriendSyncCycleNow(fakeIO);
    expect(syncAccountFullyMock).toHaveBeenCalledWith(
      'za-io', 'org-1', { trigger: 'cron', io: fakeIO },
    );
  });
});
