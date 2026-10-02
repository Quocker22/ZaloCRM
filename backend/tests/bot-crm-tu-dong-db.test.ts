// SPDX-License-Identifier: AGPL-3.0-or-later
// GET /api/v1/bot-quyen/ban-do-tin/crm-tu-dong trên Postgres THẬT: 401 không token, 403 NV thường, chỉ đọc dữ liệu CỦA ORG
// người gọi (đích báo, nhắc hẹn, máy in, nhóm chặn chào của org khác không lọt sang).
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import { registerBotQuyenRoutes } from '../src/modules/bot-quyen/bot-quyen-routes.js';

const ORG_A = 'test-crmtd-org-a';
const ORG_B = 'test-crmtd-org-b';
const ORGS = [ORG_A, ORG_B];
const URL = '/api/v1/bot-quyen/ban-do-tin/crm-tu-dong';
const NG = { a_owner: ['owner', ORG_A], a_member: ['member', ORG_A], b_admin: ['admin', ORG_B] } as const;
type Ai = keyof typeof NG;
const id = (ai: Ai) => `test-crmtd-${ai}`;

async function donDep() {
  await prisma.agentNotifyTarget.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.printAgent.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.aiConfig.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.user.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.organization.deleteMany({ where: { id: { in: ORGS } } });
}

let app: FastifyInstance;
const goi = (ai: Ai | null) => app.inject({
  method: 'GET', url: URL,
  headers: ai ? { authorization: `Bearer ${app.jwt.sign({ id: id(ai), email: `${id(ai)}@x.com`, role: NG[ai][0], orgId: NG[ai][1], typ: 'access' })}` } : {},
});

describeCanDb('bot-quyen — CRM tự động cho Bản đồ tin (DB)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.organization.create({ data: { id: ORG_A, name: 'CRMTD A', appointmentZaloReminderEnabled: true } });
    await prisma.organization.create({ data: { id: ORG_B, name: 'CRMTD B' } });
    for (const ai of Object.keys(NG) as Ai[]) {
      await prisma.user.create({ data: { id: id(ai), orgId: NG[ai][1], email: `${id(ai)}@x.com`, passwordHash: 'x', fullName: ai, role: NG[ai][0], isActive: true } });
    }
    await prisma.aiConfig.create({ data: { orgId: ORG_A, agentKhachEnabled: true } });
    await prisma.agentNotifyTarget.create({ data: { orgId: ORG_A, tenGoi: 'Nhóm trực A', threadId: 'thread-bi-mat-a', nhanBotSuCo: false } });
    await prisma.agentNotifyTarget.create({ data: { orgId: ORG_B, tenGoi: 'Nhóm của B', threadId: 'thread-bi-mat-b' } });
    await prisma.printAgent.create({ data: { orgId: ORG_B, ten: 'Máy B', token: 'test-crmtd-token-b' } });
    app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: config.jwtSecret });
    await app.register(registerBotQuyenRoutes, { prefix: '/api/v1/bot-quyen' });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await donDep();
    await prisma.$disconnect();
  });

  it('không token ⇒ 401; NV thường ⇒ 403', async () => {
    expect((await goi(null)).statusCode).toBe(401);
    const r = await goi('a_member');
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('CHI_ADMIN');
  });

  it('owner org A thấy đích + cấu hình CỦA A, không thấy của B, không lộ threadId', async () => {
    const r = await goi('a_owner');
    expect(r.statusCode, r.body).toBe(200);
    const m = Object.fromEntries((r.json().crm as Array<{ id: string }>).map((x) => [x.id, x])) as Record<string, any>;
    expect(m.crm_khach_can_ho_tro.dich.map((d: { ten: string }) => d.ten)).toContain('Nhóm trực A');
    expect(JSON.stringify(r.json())).not.toContain('Nhóm của B');
    expect(r.body).not.toContain('thread-bi-mat');
    // A bật nhắc Zalo nhưng chưa có nick hệ thống
    expect(m.crm_lich_hen_tao.ly_do_tat).toMatch(/nick hệ thống/);
    // máy in của B không tính cho A
    expect(m.crm_su_kien_in.bat).toBe(false);
  });

  it('admin org B thấy máy in của B và đích của B', async () => {
    const r = await goi('b_admin');
    expect(r.statusCode).toBe(200);
    const m = Object.fromEntries((r.json().crm as Array<{ id: string }>).map((x) => [x.id, x])) as Record<string, any>;
    expect(m.crm_su_kien_in.bat).toBe(true);
    expect(m.crm_bot_su_co.dich.map((d: { ten: string }) => d.ten)).toEqual(['Nhóm của B']);
    expect(m.crm_bot_su_co.ly_do_tat).toMatch(/Luồng bot tư vấn khách đang tắt/);
    expect(r.body).not.toContain('Nhóm trực A');
  });
});
