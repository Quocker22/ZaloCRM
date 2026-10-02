// SPDX-License-Identifier: AGPL-3.0-or-later
// docs/79 T6 trên Postgres THẬT — cổng "trợ lý AI khách của CRM im ở nhóm bot phụ trách" tra ĐÚNG nguồn payload công khai:
//   chủ xếp tường minh (BotNhom, mọi giá trị) ⇒ im · mặc định theo thành viên (có người ngoài ⇒ khach; toàn NV ⇒ sales) ⇒ im
//   · nhóm chưa xếp (chưa đọc danh sách) ⇒ như cũ · DM ⇒ như cũ (không tra) · cách ly org.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { aiKhachPhaiImONhom, chucNangHieuLucCuaNhom, _xoaChoTest } from '../src/modules/bot-quyen/nhom-bot-phu-trach.js';
import { docCauHinhCongKhai, _thongKeBoNho } from '../src/modules/bot-quyen/bot-quyen-cong-khai.js';

const ORG = 'test-nbpt-org';
const ORG_B = 'test-nbpt-org-b';
const OWNER = 'test-nbpt-owner';
const NICK = 'test-nbpt-nick';
const NICK_UID = 'nbpt-uid-nick';
const G = (n: number) => `test-nbpt-g${n}`;
const DM = 'test-nbpt-dm';

async function donDep() {
  const orgs = [ORG, ORG_B];
  await prisma.botNhomDanhSach.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.botNhom.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.botNhanVien.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.conversation.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.zaloAccount.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.user.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
}

describeCanDb('nhóm bot phụ trách — tra thật (DB)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.organization.createMany({ data: [{ id: ORG, name: 'NBPT' }, { id: ORG_B, name: 'NBPT B' }] });
    await prisma.user.create({ data: { id: OWNER, orgId: ORG, email: `${OWNER}@x.com`, passwordHash: 'x', fullName: 'Chủ', role: 'owner' } });
    await prisma.zaloAccount.create({ data: { id: NICK, orgId: ORG, ownerUserId: OWNER, zaloUid: NICK_UID, status: 'connected' } });
    for (let n = 1; n <= 4; n++) {
      await prisma.conversation.create({
        data: { id: G(n), orgId: ORG, zaloAccountId: NICK, threadType: 'group', externalThreadId: `nbpt-ext-${n}` },
      });
    }
    await prisma.conversation.create({ data: { id: DM, orgId: ORG, zaloAccountId: NICK, threadType: 'user', externalThreadId: 'nbpt-kh' } });
    await prisma.botNhanVien.create({ data: { orgId: ORG, zaloUid: 'nv-a', tenGoi: 'An', vai: 'sales' } });
    // G1: chủ xếp tường minh `kho` · G2: mặc định, có người ngoài ⇒ khach · G3: mặc định toàn NV ⇒ sales · G4: chưa đọc
    await prisma.botNhom.create({ data: { orgId: ORG, conversationId: G(1), chucNang: 'kho', tenDangKy: 'Nhóm kho' } });
    const ds = (n: number, uids: string[]) => prisma.botNhomDanhSach.create({
      data: { orgId: ORG, conversationId: G(n), zaloAccountId: NICK, uids, dayDu: true, canDocLai: false, docLuc: new Date() },
    });
    await ds(2, [NICK_UID, 'nv-a', 'khach-x']);
    await ds(3, [NICK_UID, 'nv-a']);
  });

  afterAll(async () => {
    await donDep();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    _xoaChoTest();
    _thongKeBoNho(true);
  });

  const im = (conversationId: string, laNhom = true, orgId = ORG) =>
    aiKhachPhaiImONhom({ orgId, conversationId, laNhom, duong: 'test' });

  it('khớp đúng payload công khai: tường minh + mặc định có mặt, chưa xếp vắng', async () => {
    const ch = await docCauHinhCongKhai(ORG);
    const theoId = Object.fromEntries(ch.nhom.map((n) => [n.conversation_id, n.chuc_nang]));
    expect(theoId).toEqual({ [G(1)]: 'kho', [G(2)]: 'khach', [G(3)]: 'sales' });
    for (const n of [1, 2, 3, 4]) {
      expect(await chucNangHieuLucCuaNhom(ORG, G(n))).toBe(theoId[G(n)] ?? null);
    }
  });

  it('nhóm có chức năng hiệu lực ⇒ im; chưa xếp ⇒ không im; DM ⇒ không im', async () => {
    expect(await im(G(1))).toBe(true);
    expect(await im(G(2))).toBe(true);
    expect(await im(G(3))).toBe(true);
    expect(await im(G(4))).toBe(false);
    expect(await im(DM, false)).toBe(false);
  });

  it('cách ly org: hội thoại của org khác không làm org B im', async () => {
    expect(await im(G(1), true, ORG_B)).toBe(false);
  });
});
