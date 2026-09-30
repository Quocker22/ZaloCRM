// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 §3.2) — API CÔNG KHAI GET /api/public/bot-quyen trên Postgres THẬT.
// Bridge của bot đọc route này mỗi ~60 s, nên hình JSON là HỢP ĐỒNG: {phien_ban, nhom, nhan_vien},
// snake_case, chỉ nhóm ĐÃ xếp loại, phien_ban đổi khi và chỉ khi nội dung đổi.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { botQuyenPublicRoutes } from '../src/modules/bot-quyen/bot-quyen-public-routes.js';

const ORG_A = 'test-bqp-org-a';
const ORG_B = 'test-bqp-org-b';
const KHOA_A = 'test-bqp-khoa-a';
const KHOA_B = 'test-bqp-khoa-b';
const URL = '/api/public/bot-quyen';

async function donDep() {
  const orgs = [ORG_A, ORG_B];
  await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.botNhom.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.botNhanVien.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.conversation.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.zaloAccount.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.appSetting.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.user.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
}

let app: FastifyInstance;

async function lay(khoa?: string) {
  return app.inject({ method: 'GET', url: URL, headers: khoa ? { 'x-api-key': khoa } : {} });
}

describeCanDb('bot-quyen — API công khai (x-api-key)', () => {
  beforeAll(async () => {
    await donDep();
    for (const [org, khoa, suffix] of [[ORG_A, KHOA_A, 'a'], [ORG_B, KHOA_B, 'b']] as const) {
      await prisma.organization.create({ data: { id: org, name: `BQP ${suffix}` } });
      await prisma.user.create({
        data: { id: `test-bqp-owner-${suffix}`, orgId: org, email: `test-bqp-owner-${suffix}@x.com`, passwordHash: 'x', fullName: 'Chủ', role: 'owner' },
      });
      await prisma.appSetting.create({ data: { orgId: org, settingKey: 'public_api_key', valuePlain: khoa } });
      await prisma.zaloAccount.create({
        data: { id: `test-bqp-nick-${suffix}`, orgId: org, ownerUserId: `test-bqp-owner-${suffix}`, zaloUid: `test-bqp-uid-nick-${suffix}` },
      });
    }
    for (const [id, org, nick, ext] of [
      ['test-bqp-c2', ORG_A, 'test-bqp-nick-a', 'ext-c2'],
      ['test-bqp-c1', ORG_A, 'test-bqp-nick-a', 'ext-c1'],
      ['test-bqp-c3', ORG_A, 'test-bqp-nick-a', 'ext-c3'], // chưa xếp loại — không vào payload
      ['test-bqp-cb', ORG_B, 'test-bqp-nick-b', 'ext-cb'],
    ] as const) {
      await prisma.conversation.create({ data: { id, orgId: org, zaloAccountId: nick, threadType: 'group', externalThreadId: ext } });
    }
    app = Fastify({ logger: false });
    await app.register(botQuyenPublicRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await donDep();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.botNhom.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.botNhanVien.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.botNhom.createMany({
      data: [
        { orgId: ORG_A, conversationId: 'test-bqp-c2', chucNang: 'sales', tenDangKy: 'Sales HN' },
        { orgId: ORG_A, conversationId: 'test-bqp-c1', chucNang: 'admin' },
        { orgId: ORG_B, conversationId: 'test-bqp-cb', chucNang: 'kho', tenDangKy: 'Kho B' },
      ],
    });
    await prisma.botNhanVien.createMany({
      data: [
        { orgId: ORG_A, zaloUid: '900', tenGoi: 'Hùng', vai: 'kho', trangThai: 'hoat_dong' },
        { orgId: ORG_A, zaloUid: '100', tenGoi: 'Quyết', vai: 'admin', trangThai: 'hoat_dong' },
        { orgId: ORG_A, zaloUid: '500', tenGoi: 'Lan', vai: 'cong_ty', trangThai: 'nghi' },
        { orgId: ORG_B, zaloUid: '100', tenGoi: 'Người org B', vai: 'sales', trangThai: 'hoat_dong' },
      ],
    });
  });

  it('thiếu khoá ⇒ 401', async () => {
    const res = await lay();
    expect(res.statusCode).toBe(401);
    expect(res.json()).not.toHaveProperty('nhan_vien');
  });

  it('sai khoá ⇒ 401', async () => {
    const res = await lay('khoa-sai');
    expect(res.statusCode).toBe(401);
    expect(res.json()).not.toHaveProperty('nhan_vien');
  });

  it('đúng khoá ⇒ đủ dữ liệu org đó, đúng hình hợp đồng (snake_case, sắp xếp, chỉ nhóm đã xếp loại)', async () => {
    const res = await lay(KHOA_A);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body)).toEqual(['phien_ban', 'nhom', 'nhan_vien']);
    expect(body.phien_ban).toMatch(/^[0-9a-f]{64}$/);
    expect(body.nhom).toEqual([
      { conversation_id: 'test-bqp-c1', external_thread_id: 'ext-c1', chuc_nang: 'admin', ten_dang_ky: '' },
      { conversation_id: 'test-bqp-c2', external_thread_id: 'ext-c2', chuc_nang: 'sales', ten_dang_ky: 'Sales HN' },
    ]);
    expect(body.nhan_vien).toEqual([
      { zalo_uid: '100', ten_goi: 'Quyết', vai: 'admin', trang_thai: 'hoat_dong' },
      { zalo_uid: '500', ten_goi: 'Lan', vai: 'cong_ty', trang_thai: 'nghi' },
      { zalo_uid: '900', ten_goi: 'Hùng', vai: 'kho', trang_thai: 'hoat_dong' },
    ]);
  });

  it('khoá org B chỉ thấy dữ liệu org B', async () => {
    const body = (await lay(KHOA_B)).json();
    expect(body.nhom).toEqual([
      { conversation_id: 'test-bqp-cb', external_thread_id: 'ext-cb', chuc_nang: 'kho', ten_dang_ky: 'Kho B' },
    ]);
    expect(body.nhan_vien).toEqual([
      { zalo_uid: '100', ten_goi: 'Người org B', vai: 'sales', trang_thai: 'hoat_dong' },
    ]);
  });

  it('phien_ban: không đổi gì ⇒ giữ nguyên (kể cả chỉ đổi ô ngoài hợp đồng); đổi NV / nhóm ⇒ đổi', async () => {
    const v1 = (await lay(KHOA_A)).json().phien_ban;
    expect((await lay(KHOA_A)).json().phien_ban).toBe(v1);

    // Ghi chú / người cập nhật không nằm trong payload ⇒ không đổi phiên bản.
    await prisma.botNhanVien.updateMany({ where: { orgId: ORG_A, zaloUid: '900' }, data: { ghiChu: 'chỉ ghi chú', capNhatBoiId: 'ai-do' } });
    expect((await lay(KHOA_A)).json().phien_ban).toBe(v1);

    await prisma.botNhanVien.updateMany({ where: { orgId: ORG_A, zaloUid: '900' }, data: { trangThai: 'khoa' } });
    const v2 = (await lay(KHOA_A)).json().phien_ban;
    expect(v2).not.toBe(v1);

    await prisma.botNhom.update({ where: { conversationId: 'test-bqp-c2' }, data: { chucNang: 'khach' } });
    const v3 = (await lay(KHOA_A)).json().phien_ban;
    expect(v3).not.toBe(v2);

    await prisma.botNhom.create({ data: { orgId: ORG_A, conversationId: 'test-bqp-c3', chucNang: 'ke_toan' } });
    const v4 = (await lay(KHOA_A)).json();
    expect(v4.phien_ban).not.toBe(v3);
    expect(v4.nhom.map((n: any) => n.conversation_id)).toEqual(['test-bqp-c1', 'test-bqp-c2', 'test-bqp-c3']);

    // Org B không đổi theo org A.
    const vb1 = (await lay(KHOA_B)).json().phien_ban;
    await prisma.botNhanVien.updateMany({ where: { orgId: ORG_A, zaloUid: '100' }, data: { tenGoi: 'Anh Quyết' } });
    expect((await lay(KHOA_B)).json().phien_ban).toBe(vb1);
  });
});
