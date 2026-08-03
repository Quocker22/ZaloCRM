/**
 * friend-routes-all-nicks.test.ts — Integration test cho NEW /api/v1/friends-db/all-nicks
 * endpoint (cross-nick aggregate cho FriendsView "Tất cả nick" mode).
 *
 * Critical scenarios:
 *  - User access 0 nicks → empty result không throw
 *  - User access N nicks → flat merge với filter
 *  - Pagination deterministic across nicks
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { mockUser } from './test-helpers.js';

const prismaMock = {
  zaloAccount: { findMany: vi.fn(), findFirst: vi.fn() },
  zaloAccountAccess: { findMany: vi.fn() },
  friend: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
};

vi.mock('../src/shared/database/prisma-client.js', () => ({
  // tenantTransaction thêm vào code sau khi test này viết (RLS Giai đoạn 0).
  // Chuyển tiếp sang $transaction để test nào đã mockImplementation vẫn kiểm soát tx.
  tenantTransaction: (fn: (tx: unknown) => unknown) =>
    (prismaMock as any).$transaction ? (prismaMock as any).$transaction(fn) : fn(prismaMock), prisma: prismaMock }));
// requireGrant (RBAC preHandler) thêm vào route sau khi test này viết. Chưa mock
// → gọi Prisma thật → HTTP 500. Test kiểm tra route, không kiểm RBAC.
// privacy/redact thêm vào route sau khi test này viết (audit C7/H11 — redact PII
// của Friend thuộc nick non-owner). Chưa mock → gọi Prisma thật → route ném lỗi
// trước khi trả response, nên body thiếu accessibleNicks. Test này kiểm tra query
// + phân trang, không kiểm privacy (đã có test riêng) → pass-through.
vi.mock('../src/modules/privacy/redact.js', () => ({
  buildPrivacyContext: async () => ({ viewerUserId: 'u1', orgId: 'org-1', privacyUnlocked: true }),
  redactFriend: (f: unknown) => f,
}));
// getZaloScope thêm vào route sau khi test này viết (Zalo Account Mutation Gate
// 2026-05-27) — thay cho việc route tự query access + owned. Chưa mock →
// accessibleIds rỗng → route early-return { friends: [], total: 0 } và KHÔNG có
// accessibleNicks, nên assertion về query/phân trang đều trượt.
//
// Mock DỰA TRÊN chính prismaMock mà test đã dựng (access ∪ owned), giữ nguyên ý
// nghĩa "union of access + owned" mà test đang kiểm.
vi.mock('../src/modules/zalo/zalo-scope.js', () => ({
  getZaloScope: async () => {
    const access = await prismaMock.zaloAccountAccess.findMany();
    const owned = await prismaMock.zaloAccount.findMany();
    const ids = [...new Set([
      ...(access ?? []).map((a: any) => a.zaloAccountId),
      ...(owned ?? []).map((o: any) => o.id),
    ])];
    return { accessibleIds: ids, displayableIds: ids, canManageOrgWide: true };
  },
}));
vi.mock('../src/modules/rbac/rbac-middleware.js', () => ({
  requireGrant: () => async () => {},
}));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => { req.user = mockUser(); },
}));
vi.mock('../src/modules/zalo/zalo-route-helpers.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue({ id: 'za-1', orgId: 'org-1' }),
  checkAccess: vi.fn().mockResolvedValue(true),
  handleError: vi.fn().mockImplementation((reply: any, err: any) => {
    reply.status(500).send({ error: err?.message || 'Error' });
  }),
}));
vi.mock('../src/modules/zalo/friend-event-handler.js', () => ({
  markFriendRequestSent: vi.fn(),
  applyFriendTransition: vi.fn(),
}));
vi.mock('../src/modules/zalo/friend-sync-service.js', () => ({
  syncFriendsForAccount: vi.fn(),
}));
vi.mock('../src/modules/zalo/zalo-pool.js', () => ({
  zaloPool: { getIO: vi.fn().mockReturnValue(null) },
}));

const { friendRoutes } = await import('../src/modules/zalo/friend-routes.js');

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(friendRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.zaloAccountAccess.findMany.mockReset();
  prismaMock.zaloAccount.findMany.mockReset();
  prismaMock.friend.findMany.mockReset();
  prismaMock.friend.count.mockReset();
  prismaMock.friend.groupBy.mockReset();
});

describe('GET /api/v1/friends-db/all-nicks', () => {
  it('returns empty when user has 0 accessible nicks', async () => {
    prismaMock.zaloAccountAccess.findMany.mockResolvedValue([]);
    prismaMock.zaloAccount.findMany.mockResolvedValue([]);
    const res = await buildApp().inject({ method: 'GET', url: '/api/v1/friends-db/all-nicks' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.friends).toEqual([]);
    expect(body.total).toBe(0);
    expect(prismaMock.friend.findMany).not.toHaveBeenCalled();
  });

  it('queries Friend filtered by accessible accountIds (union of access + owned)', async () => {
    prismaMock.zaloAccountAccess.findMany.mockResolvedValue([
      { zaloAccountId: 'za-A' },
      { zaloAccountId: 'za-B' },
    ]);
    prismaMock.zaloAccount.findMany.mockResolvedValue([
      { id: 'za-B' }, // overlap with access
      { id: 'za-C' }, // owned but no access row
    ]);
    prismaMock.friend.findMany.mockResolvedValue([
      { id: 'f1', zaloAccountId: 'za-A', contact: { fullName: 'KH 1' } },
    ]);
    prismaMock.friend.count.mockResolvedValue(1);
    prismaMock.friend.groupBy.mockResolvedValue([
      { relationshipKind: 'friend', _count: 1 },
    ]);

    const res = await buildApp().inject({ method: 'GET', url: '/api/v1/friends-db/all-nicks' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accessibleNicks).toBe(3); // za-A, za-B, za-C
    expect(body.total).toBe(1);

    // Verify where clause included all 3 zaloAccountIds (dedup)
    const findCall = prismaMock.friend.findMany.mock.calls[0][0];
    expect(findCall.where.zaloAccountId.in.sort()).toEqual(['za-A', 'za-B', 'za-C']);
  });

  it('applies kind filter when provided', async () => {
    prismaMock.zaloAccountAccess.findMany.mockResolvedValue([{ zaloAccountId: 'za-A' }]);
    prismaMock.zaloAccount.findMany.mockResolvedValue([]);
    prismaMock.friend.findMany.mockResolvedValue([]);
    prismaMock.friend.count.mockResolvedValue(0);
    prismaMock.friend.groupBy.mockResolvedValue([]);

    await buildApp().inject({
      method: 'GET',
      url: '/api/v1/friends-db/all-nicks?kind=friend',
    });
    const where = prismaMock.friend.findMany.mock.calls[0][0].where;
    expect(where.relationshipKind).toBe('friend');
  });

  it('uses deterministic orderBy chain (lastInboundAt → lastOutboundAt → createdAt → id)', async () => {
    prismaMock.zaloAccountAccess.findMany.mockResolvedValue([{ zaloAccountId: 'za-A' }]);
    prismaMock.zaloAccount.findMany.mockResolvedValue([]);
    prismaMock.friend.findMany.mockResolvedValue([]);
    prismaMock.friend.count.mockResolvedValue(0);
    prismaMock.friend.groupBy.mockResolvedValue([]);

    await buildApp().inject({ method: 'GET', url: '/api/v1/friends-db/all-nicks' });
    const orderBy = prismaMock.friend.findMany.mock.calls[0][0].orderBy;
    expect(orderBy).toEqual([
      { lastInboundAt: { sort: 'desc', nulls: 'last' } },
      { lastOutboundAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('respects pagination params (page=2, limit=10)', async () => {
    prismaMock.zaloAccountAccess.findMany.mockResolvedValue([{ zaloAccountId: 'za-A' }]);
    prismaMock.zaloAccount.findMany.mockResolvedValue([]);
    prismaMock.friend.findMany.mockResolvedValue([]);
    prismaMock.friend.count.mockResolvedValue(0);
    prismaMock.friend.groupBy.mockResolvedValue([]);

    await buildApp().inject({
      method: 'GET',
      url: '/api/v1/friends-db/all-nicks?page=2&limit=10',
    });
    const call = prismaMock.friend.findMany.mock.calls[0][0];
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
  });
});
