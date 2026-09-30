// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 §8) — API quản trị trên Postgres THẬT:
//   • GET /nguoi-da-nhan: người đã nhắn (tin riêng + nhóm), bỏ người đã gán / nick của org, "đang sai bot" lên đầu,
//     tin cuối, tìm, phân trang, gán xong biến mất NGAY (bản gom 60 s không che thay đổi);
//   • GET /nhom mang mặc định (chip "mặc định" + lý do) + chức năng hiệu lực; POST /nhom/:id/doc-lai; DELETE ⇒ về mặc định.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import { registerBotQuyenRoutes } from '../src/modules/bot-quyen/bot-quyen-routes.js';
import { _xoaBanGom } from '../src/modules/bot-quyen/bot-quyen-nguoi-da-nhan.js';
import { _datBoDocChoTest, choHangDoiXong } from '../src/modules/bot-quyen/bot-quyen-danh-sach.js';

const ORG = 'test-bqn-org';
const OWNER = 'test-bqn-owner';
const MEMBER = 'test-bqn-member';
const NICK = 'test-bqn-nick';
const NICK2 = 'test-bqn-nick2';
const NICK_UID = 'bqn-uid-nick';
const NICK2_UID = 'bqn-uid-nick2';
const BASE = '/api/v1/bot-quyen';

async function donDep() {
  await prisma.agentOperator.deleteMany({ where: { orgId: ORG } });
  await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhomDanhSach.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhom.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhanVien.deleteMany({ where: { orgId: ORG } });
  await prisma.message.deleteMany({ where: { conversation: { orgId: ORG } } });
  await prisma.conversation.deleteMany({ where: { orgId: ORG } });
  await prisma.contact.deleteMany({ where: { orgId: ORG } });
  await prisma.zaloAccount.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { orgId: ORG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
}

let app: FastifyInstance;
let so = 0;
async function tin(conversationId: string, senderUid: string, senderName: string, content: string, phutTruoc: number, senderType = 'contact') {
  so++;
  await prisma.message.create({
    data: {
      conversationId, zaloMsgId: `bqn-${so}`, senderType, senderUid, senderName, content,
      sentAt: new Date(Date.now() - phutTruoc * 60_000),
    },
  });
}

function token(userId: string): string {
  return app.jwt.sign({ id: userId, email: `${userId}@x.com`, role: userId === OWNER ? 'owner' : 'member', orgId: ORG, typ: 'access' });
}
async function goi(method: 'GET' | 'POST' | 'DELETE' | 'PUT', url: string, userId = OWNER, payload?: object) {
  return app.inject({ method, url: `${BASE}${url}`, headers: { authorization: `Bearer ${token(userId)}` }, ...(payload ? { payload } : {}) });
}

describeCanDb('bot-quyen — người đã nhắn + mặc định nhóm (API quản trị)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.organization.create({ data: { id: ORG, name: 'BQN' } });
    for (const [id, role] of [[OWNER, 'owner'], [MEMBER, 'member']] as const) {
      await prisma.user.create({ data: { id, orgId: ORG, email: `${id}@x.com`, passwordHash: 'x', fullName: id, role, isActive: true } });
    }
    await prisma.zaloAccount.create({ data: { id: NICK, orgId: ORG, ownerUserId: OWNER, zaloUid: NICK_UID, displayName: 'LED HN', status: 'connected' } });
    await prisma.zaloAccount.create({ data: { id: NICK2, orgId: ORG, ownerUserId: OWNER, zaloUid: NICK2_UID, displayName: 'LED HCM' } });
    await prisma.contact.create({ data: { id: 'test-bqn-ct1', orgId: ORG, fullName: 'Khách Đức' } });
    // Tin riêng: thời điểm = last_message_at của hội thoại (đặt khớp tin cuối).
    const conv = (id: string, nick: string, loai: string, ext: string, phutTruoc: number, groupName?: string, contactId?: string) =>
      prisma.conversation.create({
        data: { id, orgId: ORG, zaloAccountId: nick, threadType: loai, externalThreadId: ext, groupName, contactId,
          lastMessageAt: new Date(Date.now() - phutTruoc * 60_000) },
      });
    await conv('test-bqn-dm1', NICK, 'user', 'u-duc', 50, undefined, 'test-bqn-ct1');
    await conv('test-bqn-dm2', NICK2, 'user', 'u-hung-hcm', 40);
    await conv('test-bqn-dm3', NICK, 'user', 'u-chi-shop-nhan', 30); // chỉ shop nhắn — KHÔNG phải người đã nhắn
    await conv('test-bqn-g1', NICK, 'group', 'g-ext-1', 5, 'Nhóm Sales HN');
    await conv('test-bqn-g2', NICK, 'group', 'g-ext-2', 8, 'Nhóm Kho');
    await tin('test-bqn-dm1', 'u-duc', 'Đức Zalo', 'cho em báo giá led dây', 50);
    await tin('test-bqn-dm2', 'u-hung-hcm', 'Hưng', 'alo', 40);
    await tin('test-bqn-dm3', NICK_UID, 'Shop', 'chào anh', 30, 'self');
    await tin('test-bqn-g1', 'u-hung', 'Trần Hưng', 'lên đơn cho khách A', 20);
    await tin('test-bqn-g1', 'u-hung', 'Trần Hưng', 'tin mới nhất của Hưng', 5);
    await tin('test-bqn-g2', 'u-hung', 'Trần Hưng', 'kho còn không', 10);
    await tin('test-bqn-g1', 'u-lan', 'Lan', 'ok', 15);
    await tin('test-bqn-g1', NICK2_UID, 'LED HCM', 'nick khác nói', 12);
    await tin('test-bqn-g2', 'u-nv-roi', 'Đã là NV', 'x', 8);
    app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: config.jwtSecret });
    await app.register(registerBotQuyenRoutes, { prefix: BASE, docThanhVienZalo: async () => [] });
    await app.ready();
  });

  afterAll(async () => {
    _datBoDocChoTest(null);
    await choHangDoiXong();
    await app?.close();
    await donDep();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    _xoaBanGom();
    _datBoDocChoTest(async () => ({ gridInfoMap: {} }));
    await prisma.agentOperator.deleteMany({ where: { orgId: ORG } });
    await prisma.botNhomDanhSach.deleteMany({ where: { orgId: ORG } });
    await prisma.botNhom.deleteMany({ where: { orgId: ORG } });
    await prisma.botNhanVien.deleteMany({ where: { orgId: ORG } });
    await prisma.botNhanVien.create({ data: { orgId: ORG, zaloUid: 'u-nv-roi', tenGoi: 'NV cũ', vai: 'sales' } });
  });

  it('NV thường ⇒ 403', async () => {
    expect((await goi('GET', '/nguoi-da-nhan', MEMBER)).statusCode).toBe(403);
  });

  it('liệt kê người đã nhắn (riêng + nhóm), gom theo uid, bỏ NV đã gán + nick của org + hội thoại chỉ shop nhắn', async () => {
    const res = await goi('GET', '/nguoi-da-nhan');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.ungVien.map((u: any) => u.zaloUid)).toEqual(['u-hung', 'u-lan', 'u-hung-hcm', 'u-duc']);
    expect(body.tong).toBe(4);
    const hung = body.ungVien[0];
    expect(hung).toMatchObject({ ten: 'Trần Hưng', soNoi: 2, dangSaiBot: false });
    expect(hung.noi.map((n: any) => [n.loai, n.tenNhom, n.nick.ten])).toEqual([['nhom', 'Nhóm Sales HN', 'LED HN'], ['nhom', 'Nhóm Kho', 'LED HN']]);
    expect(hung.tinCuoi).toMatchObject({ noiDung: 'tin mới nhất của Hưng', loai: 'text' });
    const duc = body.ungVien.find((u: any) => u.zaloUid === 'u-duc');
    expect(duc).toMatchObject({ ten: 'Khách Đức', noi: [{ loai: 'rieng', nick: { ten: 'LED HN' } }] });
    expect(duc.tinCuoi.noiDung).toBe('cho em báo giá led dây');
    // Cùng người ở nick khác = uid khác = dòng riêng, nói rõ nick.
    expect(body.ungVien.find((u: any) => u.zaloUid === 'u-hung-hcm').noi[0].nick.ten).toBe('LED HCM');
  });

  it('người "đang sai bot" (agent-operators) có cờ + lên đầu', async () => {
    await prisma.agentOperator.create({ data: { orgId: ORG, zaloUid: 'u-duc', tenGoi: 'Đức' } });
    const body = (await goi('GET', '/nguoi-da-nhan')).json();
    expect(body.ungVien[0]).toMatchObject({ zaloUid: 'u-duc', dangSaiBot: true });
  });

  it('tìm không dấu + phân trang', async () => {
    expect((await goi('GET', '/nguoi-da-nhan?tuKhoa=duc')).json().ungVien.map((u: any) => u.zaloUid)).toEqual(['u-duc']);
    const t2 = (await goi('GET', '/nguoi-da-nhan?moiTrang=3&trang=2')).json();
    expect(t2).toMatchObject({ tong: 4, trang: 2, moiTrang: 3 });
    expect(t2.ungVien).toHaveLength(1);
  });

  it('gán xong (POST /nhan-vien) ⇒ biến mất ngay dù bản gom còn giữ', async () => {
    expect((await goi('GET', '/nguoi-da-nhan')).json().tong).toBe(4);
    const tao = await goi('POST', '/nhan-vien', OWNER, { zaloUid: 'u-lan', tenGoi: 'Lan', vai: 'kho' });
    expect(tao.statusCode, tao.body).toBe(201);
    const sau = (await goi('GET', '/nguoi-da-nhan')).json();
    expect(sau.tong).toBe(3);
    expect(sau.ungVien.map((u: any) => u.zaloUid)).not.toContain('u-lan');
  });

  it('GET /nhom: mặc định + lý do + chức năng hiệu lực; tường minh thắng; chưa đọc ⇒ không mặc định', async () => {
    await prisma.botNhanVien.create({ data: { orgId: ORG, zaloUid: 'u-hung', tenGoi: 'Hưng', vai: 'sales' } });
    await prisma.botNhomDanhSach.create({ data: { orgId: ORG, conversationId: 'test-bqn-g1', zaloAccountId: NICK, uids: [NICK_UID, 'u-hung'], dayDu: true, canDocLai: false, docLuc: new Date() } });
    await prisma.botNhomDanhSach.create({ data: { orgId: ORG, conversationId: 'test-bqn-g2', zaloAccountId: NICK, uids: [NICK_UID, 'u-hung', 'u-la', NICK2_UID], dayDu: true, canDocLai: false } });
    let ds = (await goi('GET', '/nhom')).json().nhom;
    const g1 = ds.find((n: any) => n.conversationId === 'test-bqn-g1');
    const g2 = ds.find((n: any) => n.conversationId === 'test-bqn-g2');
    expect(g1).toMatchObject({ chucNang: null, chucNangHieuLuc: 'sales', laMacDinh: true, macDinh: { chucNang: 'sales', lyDo: 'toan_nhan_vien' } });
    expect(g2).toMatchObject({ chucNangHieuLuc: 'khach', laMacDinh: true, macDinh: { lyDo: 'co_nguoi_ngoai', soNguoiNgoai: 2, soNickKhac: 1 } });

    await goi('PUT', '/nhom/test-bqn-g2', OWNER, { chucNang: 'kho' });
    ds = (await goi('GET', '/nhom')).json().nhom;
    expect(ds.find((n: any) => n.conversationId === 'test-bqn-g2')).toMatchObject({
      chucNang: 'kho', chucNangHieuLuc: 'kho', laMacDinh: false, macDinh: { chucNang: 'khach' },
    });
  });

  it('DELETE (về mặc định) xếp hàng đọc lại danh sách; POST /doc-lai cũng vậy; nhóm lạ ⇒ 404', async () => {
    const goiDoc: string[][] = [];
    _datBoDocChoTest(async (_nick, ids) => {
      goiDoc.push(ids);
      return { gridInfoMap: Object.fromEntries(ids.map((id) => [id, { memVerList: [`${NICK_UID}_0`], totalMember: 1 }])) };
    });
    await goi('PUT', '/nhom/test-bqn-g1', OWNER, { chucNang: 'sales' });
    const xoa = await goi('DELETE', '/nhom/test-bqn-g1', OWNER, { lyDo: 'về mặc định' });
    expect(xoa.statusCode, xoa.body).toBe(200);
    await choHangDoiXong();
    expect(goiDoc).toEqual([['g-ext-1']]);
    const g1 = (await goi('GET', '/nhom')).json().nhom.find((n: any) => n.conversationId === 'test-bqn-g1');
    expect(g1).toMatchObject({ chucNang: null, chucNangHieuLuc: 'sales', laMacDinh: true });

    expect((await goi('POST', '/nhom/test-bqn-g2/doc-lai')).json()).toEqual({ ok: true });
    await choHangDoiXong();
    expect(goiDoc).toEqual([['g-ext-1'], ['g-ext-2']]);
    expect((await goi('POST', '/nhom/khong-co/doc-lai')).statusCode).toBe(404);
  });
});
