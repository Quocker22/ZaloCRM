// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 §3.2) — API quản trị /api/v1/bot-quyen trên Postgres THẬT.
//
// Khoá: chỉ owner/admin (NV thường ⇒ 403), enum sai ⇒ 400, thiếu lý do khi hạ/khoá ⇒ 400,
// admin hoạt động cuối cùng ⇒ 409 (đổi vai HAY đổi trạng thái), nhật ký đủ trước/sau cùng
// giao dịch, cách ly theo org, nhãn thành viên nhóm (NV / nick CRM / người ngoài) + nguồn.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import { registerBotQuyenRoutes } from '../src/modules/bot-quyen/bot-quyen-routes.js';
import type { DocThanhVienZalo } from '../src/modules/bot-quyen/bot-quyen-thanh-vien.js';

const ORG_A = 'test-bq-org-a';
const ORG_B = 'test-bq-org-b';
const OWNER = 'test-bq-owner';
const ADMIN = 'test-bq-admin';
const MEMBER = 'test-bq-member';
const OWNER_B = 'test-bq-owner-b';
const NICK_A = 'test-bq-nick-a';
const NICK_A2 = 'test-bq-nick-a2';
const NICK_B = 'test-bq-nick-b';
const NICK_A_UID = 'test-bq-uid-nick-a';
const NICK_A2_UID = 'test-bq-uid-nick-a2';
const G1 = 'test-bq-conv-g1';
const G2 = 'test-bq-conv-g2';
const G3 = 'test-bq-conv-g3'; // nhóm của nick thứ hai
const U1 = 'test-bq-conv-u1'; // hội thoại 1-1 — không phải nhóm
const GB = 'test-bq-conv-gb'; // nhóm của org B

const BASE = '/api/v1/bot-quyen';

async function donDep() {
  const orgs = [ORG_A, ORG_B];
  await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.botNhom.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.botNhanVien.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.groupMember.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.conversation.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.zaloAccount.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.user.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
}

async function gieo() {
  await prisma.organization.create({ data: { id: ORG_A, name: 'BQ Org A' } });
  await prisma.organization.create({ data: { id: ORG_B, name: 'BQ Org B' } });
  const u = (id: string, orgId: string, role: string, fullName: string) =>
    prisma.user.create({ data: { id, orgId, email: `${id}@x.com`, passwordHash: 'x', fullName, role, isActive: true } });
  await u(OWNER, ORG_A, 'owner', 'Chủ A');
  await u(ADMIN, ORG_A, 'admin', 'Quản trị A');
  await u(MEMBER, ORG_A, 'member', 'Sale A');
  await u(OWNER_B, ORG_B, 'owner', 'Chủ B');
  await prisma.zaloAccount.create({ data: { id: NICK_A, orgId: ORG_A, ownerUserId: OWNER, zaloUid: NICK_A_UID, displayName: 'Nick LED HN' } });
  await prisma.zaloAccount.create({ data: { id: NICK_A2, orgId: ORG_A, ownerUserId: OWNER, zaloUid: NICK_A2_UID, displayName: 'Nick LED HCM' } });
  await prisma.zaloAccount.create({ data: { id: NICK_B, orgId: ORG_B, ownerUserId: OWNER_B, zaloUid: 'test-bq-uid-nick-b', displayName: 'Nick B' } });
  const g = (id: string, orgId: string, zaloAccountId: string, ext: string, groupName: string, lastMin: number) =>
    prisma.conversation.create({
      data: {
        id, orgId, zaloAccountId, threadType: 'group', externalThreadId: ext, groupName,
        groupMembersCount: 7, lastMessageAt: new Date(Date.now() - lastMin * 60_000),
      },
    });
  await g(G1, ORG_A, NICK_A, 'test-bq-ext-g1', 'Nhóm Sales HN', 1);
  await g(G2, ORG_A, NICK_A, 'test-bq-ext-g2', 'Nhóm Kho', 2);
  await g(G3, ORG_A, NICK_A2, 'test-bq-ext-g3', 'Nhóm HCM', 3);
  await g(GB, ORG_B, NICK_B, 'test-bq-ext-gb', 'Nhóm org B', 1);
  await prisma.conversation.create({
    data: { id: U1, orgId: ORG_A, zaloAccountId: NICK_A, threadType: 'user', externalThreadId: 'test-bq-ext-u1' },
  });
}

let app: FastifyInstance;
let docZalo: DocThanhVienZalo;

async function dungApp(them: { hetGioZaloMs?: number } = {}): Promise<FastifyInstance> {
  const a = Fastify({ logger: false });
  await a.register(fastifyJwt, { secret: config.jwtSecret });
  // Bộ đọc Zalo trực tiếp là I/O mạng — test thay bằng hàm giả qua tuỳ chọn plugin.
  await a.register(registerBotQuyenRoutes, {
    prefix: BASE,
    docThanhVienZalo: (accountId: string, groupId: string) => docZalo(accountId, groupId),
    ...them,
  });
  await a.ready();
  return a;
}

function token(userId: string): string {
  const role = userId === OWNER || userId === OWNER_B ? 'owner' : userId === ADMIN ? 'admin' : 'member';
  const orgId = userId === OWNER_B ? ORG_B : ORG_A;
  return app.jwt.sign({ id: userId, email: `${userId}@x.com`, role, orgId, typ: 'access' });
}

async function goi(method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, userId: string | null, payload?: unknown) {
  return app.inject({
    method,
    url: `${BASE}${url}`,
    headers: userId ? { authorization: `Bearer ${token(userId)}` } : {},
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

async function taoNv(body: Record<string, unknown>, userId = OWNER) {
  const res = await goi('POST', '/nhan-vien', userId, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().nhanVien as { id: string; zaloUid: string; vai: string; trangThai: string };
}

describeCanDb('bot-quyen — API quản trị (JWT, owner/admin)', () => {
  beforeAll(async () => {
    await donDep();
    await gieo();
    docZalo = async () => { throw new Error('không nên gọi Zalo trong ca này'); };
    app = await dungApp();
  });

  afterAll(async () => {
    await app?.close();
    await donDep();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.botNhom.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.botNhanVien.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.groupMember.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.message.deleteMany({ where: { conversationId: { in: [G1, G2, G3] } } });
    docZalo = async () => { throw new Error('không nên gọi Zalo trong ca này'); };
  });

  // ── Quyền vào ──────────────────────────────────────────────────────────────

  it('không token ⇒ 401', async () => {
    const res = await goi('GET', '/nhom', null);
    expect(res.statusCode).toBe(401);
  });

  it('NV thường (role member) ⇒ 403 ở MỌI route (8/8), kể cả đọc; không ghi gì', async () => {
    const co = await prisma.botNhanVien.create({ data: { orgId: ORG_A, zaloUid: '4001', tenGoi: 'Có sẵn', vai: 'sales' } });
    const cac = [
      await goi('GET', '/nhom', MEMBER),
      await goi('GET', `/nhom/${G1}/thanh-vien`, MEMBER),
      await goi('PUT', `/nhom/${G1}`, MEMBER, { chucNang: 'admin' }),
      await goi('DELETE', `/nhom/${G1}`, MEMBER, { lyDo: 'x' }),
      await goi('GET', '/nhan-vien', MEMBER),
      await goi('POST', '/nhan-vien', MEMBER, { zaloUid: '111', tenGoi: 'Tự nâng', vai: 'admin' }),
      await goi('PUT', `/nhan-vien/${co.id}`, MEMBER, { vai: 'admin' }),
      await goi('GET', '/nhat-ky', MEMBER),
    ];
    expect(cac).toHaveLength(8);
    for (const r of cac) {
      expect(r.statusCode).toBe(403);
      expect(r.json().code).toBe('CHI_ADMIN');
    }
    expect(await prisma.botNhom.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await prisma.botNhanVien.count({ where: { orgId: ORG_A } })).toBe(1);
    expect(await prisma.botNhanVien.findUnique({ where: { id: co.id } })).toMatchObject({ vai: 'sales', tenGoi: 'Có sẵn' });
    expect(await prisma.botQuyenNhatKy.count({ where: { orgId: ORG_A } })).toBe(0);
  });

  it('owner và admin CRM đều vào được', async () => {
    expect((await goi('GET', '/nhom', OWNER)).statusCode).toBe(200);
    expect((await goi('GET', '/nhom', ADMIN)).statusCode).toBe(200);
  });

  it('user CRM bị khoá (isActive=false) dù token còn hạn ⇒ 401', async () => {
    await prisma.user.update({ where: { id: ADMIN }, data: { isActive: false } });
    try {
      const res = await goi('GET', '/nhom', ADMIN);
      expect(res.statusCode).toBe(401);
    } finally {
      await prisma.user.update({ where: { id: ADMIN }, data: { isActive: true } });
    }
  });

  // ── Nhóm ───────────────────────────────────────────────────────────────────

  it('GET /nhom: mọi hội thoại NHÓM của org (không 1-1, không org khác), chưa xếp loại ⇒ chucNang null', async () => {
    const res = await goi('GET', '/nhom', OWNER);
    expect(res.statusCode).toBe(200);
    const ds = res.json().nhom as Array<Record<string, any>>;
    expect(ds.map((n) => n.conversationId).sort()).toEqual([G1, G2, G3].sort());
    const g1 = ds.find((n) => n.conversationId === G1)!;
    expect(g1).toMatchObject({
      externalThreadId: 'test-bq-ext-g1',
      tenNhom: 'Nhóm Sales HN',
      soThanhVien: 7,
      chucNang: null,
      tenDangKy: null,
      nick: { id: NICK_A, displayName: 'Nick LED HN', zaloUid: NICK_A_UID },
    });
  });

  it('GET /nhom: hội thoại nhóm đã xoá mềm VẪN có trong danh sách, gắn daAn', async () => {
    await prisma.conversation.update({ where: { id: G2 }, data: { deletedAt: new Date() } });
    try {
      const ds = (await goi('GET', '/nhom', OWNER)).json().nhom as Array<Record<string, any>>;
      expect(ds.find((n) => n.conversationId === G2)).toMatchObject({ daAn: true });
      expect(ds.find((n) => n.conversationId === G1)).toMatchObject({ daAn: false });
    } finally {
      await prisma.conversation.update({ where: { id: G2 }, data: { deletedAt: null } });
    }
  });

  it('GET /nhom?zaloAccountId= lọc theo nick', async () => {
    const res = await goi('GET', `/nhom?zaloAccountId=${NICK_A2}`, OWNER);
    expect(res.json().nhom.map((n: any) => n.conversationId)).toEqual([G3]);
  });

  it('PUT /nhom: xếp loại lần đầu ⇒ ghi BotNhom + nhật ký (trước null, sau đủ ô), không cần lý do', async () => {
    const res = await goi('PUT', `/nhom/${G1}`, OWNER, { chucNang: 'sales', tenDangKy: 'Sales HN' });
    expect(res.statusCode, res.body).toBe(200);

    const row = await prisma.botNhom.findUnique({ where: { conversationId: G1 } });
    expect(row).toMatchObject({ orgId: ORG_A, chucNang: 'sales', tenDangKy: 'Sales HN', capNhatBoiId: OWNER });

    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG_A } });
    expect(nk).toHaveLength(1);
    expect(nk[0]).toMatchObject({ aiId: OWNER, doiTuong: 'nhom', doiTuongId: G1, lyDo: null });
    expect(nk[0].truoc).toBeNull();
    expect(nk[0].sau).toEqual({ chucNang: 'sales', tenDangKy: 'Sales HN', ghiChu: null });

    const ds = (await goi('GET', '/nhom', OWNER)).json().nhom as Array<Record<string, any>>;
    const g1 = ds.find((n) => n.conversationId === G1)!;
    expect(g1).toMatchObject({ chucNang: 'sales', tenDangKy: 'Sales HN', capNhatBoi: { id: OWNER, fullName: 'Chủ A' } });
  });

  it('PUT /nhom: chức năng sai / thiếu ⇒ 400, không ghi gì', async () => {
    for (const body of [{ chucNang: 'boss' }, { chucNang: 'cong_ty' }, {}, { chucNang: 'Admin' }]) {
      const res = await goi('PUT', `/nhom/${G1}`, OWNER, body);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('CHUC_NANG_KHONG_HOP_LE');
    }
    expect(await prisma.botNhom.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await prisma.botQuyenNhatKy.count({ where: { orgId: ORG_A } })).toBe(0);
  });

  it('PUT /nhom: hội thoại 1-1 hoặc nhóm của org KHÁC ⇒ 404', async () => {
    expect((await goi('PUT', `/nhom/${U1}`, OWNER, { chucNang: 'sales' })).statusCode).toBe(404);
    expect((await goi('PUT', `/nhom/${GB}`, OWNER, { chucNang: 'sales' })).statusCode).toBe(404);
    expect((await goi('PUT', '/nhom/khong-co', OWNER, { chucNang: 'sales' })).statusCode).toBe(404);
    expect(await prisma.botNhom.count({ where: { conversationId: GB } })).toBe(0);
  });

  it('PUT /nhom: hạ (sales → khach) thiếu lý do ⇒ 400; có lý do ⇒ 200 + nhật ký trước/sau/lý do', async () => {
    await goi('PUT', `/nhom/${G1}`, OWNER, { chucNang: 'sales' });

    const thieu = await goi('PUT', `/nhom/${G1}`, ADMIN, { chucNang: 'khach' });
    expect(thieu.statusCode).toBe(400);
    expect(thieu.json().code).toBe('THIEU_LY_DO');
    const khoangTrang = await goi('PUT', `/nhom/${G1}`, ADMIN, { chucNang: 'khach', lyDo: '   ' });
    expect(khoangTrang.statusCode).toBe(400);
    expect((await prisma.botNhom.findUnique({ where: { conversationId: G1 } }))!.chucNang).toBe('sales');

    const du = await goi('PUT', `/nhom/${G1}`, ADMIN, { chucNang: 'khach', lyDo: 'Khách vào nhóm' });
    expect(du.statusCode).toBe(200);
    expect((await prisma.botNhom.findUnique({ where: { conversationId: G1 } }))!.chucNang).toBe('khach');

    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG_A }, orderBy: { luc: 'asc' } });
    expect(nk).toHaveLength(2);
    expect(nk[1]).toMatchObject({ aiId: ADMIN, doiTuong: 'nhom', doiTuongId: G1, lyDo: 'Khách vào nhóm' });
    expect(nk[1].truoc).toEqual({ chucNang: 'sales', tenDangKy: '', ghiChu: null });
    expect(nk[1].sau).toEqual({ chucNang: 'khach', tenDangKy: '', ghiChu: null });
  });

  it('PUT /nhom: nâng (khach → admin) không cần lý do; gửi lại y hệt ⇒ không ghi nhật ký thừa', async () => {
    await goi('PUT', `/nhom/${G1}`, OWNER, { chucNang: 'khach' });
    expect((await goi('PUT', `/nhom/${G1}`, OWNER, { chucNang: 'admin' })).statusCode).toBe(200);
    const lap = await goi('PUT', `/nhom/${G1}`, OWNER, { chucNang: 'admin' });
    expect(lap.statusCode).toBe(200);
    expect(lap.json().doi).toBe(false);
    expect(await prisma.botQuyenNhatKy.count({ where: { orgId: ORG_A } })).toBe(2);
  });

  it('DELETE /nhom: bỏ xếp loại cần lý do; có lý do ⇒ xoá BotNhom + nhật ký (sau = null)', async () => {
    await goi('PUT', `/nhom/${G2}`, OWNER, { chucNang: 'kho', tenDangKy: 'Kho' });
    const thieu = await goi('DELETE', `/nhom/${G2}`, OWNER, {});
    expect(thieu.statusCode).toBe(400);
    expect(thieu.json().code).toBe('THIEU_LY_DO');
    expect(await prisma.botNhom.count({ where: { conversationId: G2 } })).toBe(1);

    const ok = await goi('DELETE', `/nhom/${G2}`, OWNER, { lyDo: 'Nhóm giải tán' });
    expect(ok.statusCode).toBe(200);
    expect(await prisma.botNhom.count({ where: { conversationId: G2 } })).toBe(0);
    const nk = await prisma.botQuyenNhatKy.findFirst({ where: { orgId: ORG_A, lyDo: 'Nhóm giải tán' } });
    expect(nk).toMatchObject({ doiTuong: 'nhom', doiTuongId: G2, aiId: OWNER });
    expect(nk!.truoc).toEqual({ chucNang: 'kho', tenDangKy: 'Kho', ghiChu: null });
    expect(nk!.sau).toBeNull();

    // nhóm org khác ⇒ 404
    expect((await goi('DELETE', `/nhom/${GB}`, OWNER, { lyDo: 'x' })).statusCode).toBe(404);
  });

  // ── Nhân viên ──────────────────────────────────────────────────────────────

  it('POST /nhan-vien: tạo ⇒ 201 + nhật ký; trùng zaloUid trong org ⇒ 409', async () => {
    const nv = await taoNv({ zaloUid: '5001', tenGoi: 'Quyết', vai: 'admin', lyDo: 'Chủ' });
    expect(nv).toMatchObject({ zaloUid: '5001', vai: 'admin', trangThai: 'hoat_dong' });
    const row = await prisma.botNhanVien.findUnique({ where: { id: nv.id } });
    expect(row).toMatchObject({ orgId: ORG_A, tenGoi: 'Quyết', capNhatBoiId: OWNER });

    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG_A } });
    expect(nk).toHaveLength(1);
    expect(nk[0]).toMatchObject({ doiTuong: 'nhan_vien', doiTuongId: nv.id, aiId: OWNER, lyDo: 'Chủ' });
    expect(nk[0].truoc).toBeNull();
    expect(nk[0].sau).toEqual({ zaloUid: '5001', tenGoi: 'Quyết', vai: 'admin', trangThai: 'hoat_dong', userId: null, ghiChu: null });

    const trung = await goi('POST', '/nhan-vien', OWNER, { zaloUid: '5001', tenGoi: 'Khác', vai: 'sales' });
    expect(trung.statusCode).toBe(409);
    expect(trung.json().code).toBe('NHAN_VIEN_DA_CO');
    expect(await prisma.botQuyenNhatKy.count({ where: { orgId: ORG_A } })).toBe(1);
  });

  it('POST /nhan-vien: cùng zaloUid ở org KHÁC không đụng nhau', async () => {
    await taoNv({ zaloUid: '5002', tenGoi: 'A', vai: 'sales' });
    await taoNv({ zaloUid: '5002', tenGoi: 'B', vai: 'kho' }, OWNER_B);
    expect(await prisma.botNhanVien.count({ where: { zaloUid: '5002' } })).toBe(2);
  });

  it('POST /nhan-vien: vai / trạng thái sai, thiếu uid/tên ⇒ 400; userId org khác ⇒ 400', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ zaloUid: '6001', tenGoi: 'X', vai: 'boss' }, 'VAI_KHONG_HOP_LE'],
      [{ zaloUid: '6001', tenGoi: 'X', vai: 'khach' }, 'VAI_KHONG_HOP_LE'],
      [{ zaloUid: '6001', tenGoi: 'X', vai: 'sales', trangThai: 'active' }, 'TRANG_THAI_KHONG_HOP_LE'],
      [{ tenGoi: 'X', vai: 'sales' }, 'THIEU_ZALO_UID'],
      [{ zaloUid: '6001', vai: 'sales' }, 'THIEU_TEN_GOI'],
      [{ zaloUid: '6001', tenGoi: 'X', vai: 'sales', userId: OWNER_B }, 'USER_KHONG_HOP_LE'],
    ];
    for (const [body, code] of cases) {
      const res = await goi('POST', '/nhan-vien', OWNER, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().code).toBe(code);
    }
    expect(await prisma.botNhanVien.count({ where: { orgId: ORG_A } })).toBe(0);
  });

  it('POST /nhan-vien: tạo ở trạng thái khoa/nghi hoặc vai cong_ty là KHOÁ ⇒ thiếu lý do 400; có lý do 201 + nhật ký', async () => {
    for (const body of [
      { zaloUid: '6101', tenGoi: 'K', vai: 'sales', trangThai: 'khoa' },
      { zaloUid: '6102', tenGoi: 'N', vai: 'kho', trangThai: 'nghi' },
      { zaloUid: '6103', tenGoi: 'C', vai: 'cong_ty' },
      { zaloUid: '6103', tenGoi: 'C', vai: 'cong_ty', lyDo: '   ' },
    ]) {
      const res = await goi('POST', '/nhan-vien', OWNER, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().code).toBe('THIEU_LY_DO');
    }
    expect(await prisma.botNhanVien.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await prisma.botQuyenNhatKy.count({ where: { orgId: ORG_A } })).toBe(0);

    const nghi = await taoNv({ zaloUid: '6102', tenGoi: 'N', vai: 'kho', trangThai: 'nghi', lyDo: 'Nghỉ từ 01/09' });
    expect(nghi.trangThai).toBe('nghi');
    await taoNv({ zaloUid: '6103', tenGoi: 'C', vai: 'cong_ty', lyDo: 'Kế toán thuê ngoài' });
    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG_A }, orderBy: { luc: 'asc' } });
    expect(nk.map((r) => r.lyDo)).toEqual(['Nghỉ từ 01/09', 'Kế toán thuê ngoài']);
    // Tạo bình thường (hoat_dong, vai dùng bot) vẫn không cần lý do.
    await taoNv({ zaloUid: '6104', tenGoi: 'S', vai: 'sales' });
  });

  it('POST /nhan-vien: userId cùng org được liên kết', async () => {
    const nv = await taoNv({ zaloUid: '6002', tenGoi: 'Sale', vai: 'sales', userId: MEMBER });
    const ds = (await goi('GET', '/nhan-vien', OWNER)).json().nhanVien as Array<Record<string, any>>;
    expect(ds.find((x) => x.id === nv.id)).toMatchObject({ userId: MEMBER, user: { id: MEMBER, fullName: 'Sale A' } });
  });

  it('admin hoạt động CUỐI CÙNG: đổi vai / khoá / nghỉ ⇒ 409, không đổi dòng, không ghi nhật ký', async () => {
    const a1 = await taoNv({ zaloUid: '7001', tenGoi: 'Admin 1', vai: 'admin' });
    const truoc = await prisma.botQuyenNhatKy.count({ where: { orgId: ORG_A } });
    for (const body of [
      { vai: 'sales', lyDo: 'thử hạ' },
      { vai: 'cong_ty', lyDo: 'thử hạ' },
      { trangThai: 'khoa', lyDo: 'thử khoá' },
      { trangThai: 'nghi', lyDo: 'thử nghỉ' },
    ]) {
      const res = await goi('PUT', `/nhan-vien/${a1.id}`, OWNER, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(409);
      expect(res.json().code).toBe('ADMIN_CUOI');
    }
    expect(await prisma.botNhanVien.findUnique({ where: { id: a1.id } })).toMatchObject({ vai: 'admin', trangThai: 'hoat_dong' });
    expect(await prisma.botQuyenNhatKy.count({ where: { orgId: ORG_A } })).toBe(truoc);

    // Admin KHOÁ không tính là admin hoạt động.
    await taoNv({ zaloUid: '7002', tenGoi: 'Admin khoá', vai: 'admin', trangThai: 'khoa', lyDo: 'Tạm khoá' });
    expect((await goi('PUT', `/nhan-vien/${a1.id}`, OWNER, { trangThai: 'khoa', lyDo: 'x' })).statusCode).toBe(409);

    // Có admin hoạt động thứ hai ⇒ hạ được.
    await taoNv({ zaloUid: '7003', tenGoi: 'Admin 2', vai: 'admin' });
    const ok = await goi('PUT', `/nhan-vien/${a1.id}`, OWNER, { vai: 'sales', lyDo: 'Chuyển sang bán hàng' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await prisma.botNhanVien.findUnique({ where: { id: a1.id } })).toMatchObject({ vai: 'sales' });
  });

  it('admin cuối: hạ MỌI admin cùng lúc (vai lẫn trạng thái) ⇒ đúng một admin còn lại, nhật ký khớp số thành công', async () => {
    const SO = 8;
    const ds = [];
    for (let i = 0; i < SO; i++) ds.push(await taoNv({ zaloUid: `71${i}`, tenGoi: `A${i}`, vai: 'admin' }));
    const nkTruoc = await prisma.botQuyenNhatKy.count({ where: { orgId: ORG_A } });
    const kq = await Promise.all(ds.map((a, i) => goi('PUT', `/nhan-vien/${a.id}`, i % 2 ? OWNER : ADMIN,
      i % 2 ? { vai: 'sales', lyDo: `đồng thời ${i}` } : { trangThai: 'nghi', lyDo: `đồng thời ${i}` })));
    const ma = kq.map((r) => r.statusCode);
    expect(ma.filter((m) => m === 200)).toHaveLength(SO - 1);
    expect(ma.filter((m) => m === 409)).toHaveLength(1);
    const conAdmin = await prisma.botNhanVien.count({ where: { orgId: ORG_A, vai: 'admin', trangThai: 'hoat_dong' } });
    expect(conAdmin).toBe(1);
    expect(await prisma.botQuyenNhatKy.count({ where: { orgId: ORG_A } })).toBe(nkTruoc + SO - 1);
  });

  it('PUT /nhan-vien: hạ vai / khoá thiếu lý do ⇒ 400; nâng / đổi tên không cần; nhật ký đủ trước/sau', async () => {
    await taoNv({ zaloUid: '8000', tenGoi: 'Admin', vai: 'admin' });
    const nv = await taoNv({ zaloUid: '8001', tenGoi: 'Hùng', vai: 'kho' });

    const haVai = await goi('PUT', `/nhan-vien/${nv.id}`, OWNER, { vai: 'sales' });
    expect(haVai.statusCode).toBe(400);
    expect(haVai.json().code).toBe('THIEU_LY_DO');
    const khoa = await goi('PUT', `/nhan-vien/${nv.id}`, OWNER, { trangThai: 'khoa' });
    expect(khoa.statusCode).toBe(400);
    expect(khoa.json().code).toBe('THIEU_LY_DO');
    expect(await prisma.botNhanVien.findUnique({ where: { id: nv.id } })).toMatchObject({ vai: 'kho', trangThai: 'hoat_dong' });

    expect((await goi('PUT', `/nhan-vien/${nv.id}`, OWNER, { vai: 'admin' })).statusCode).toBe(200);
    expect((await goi('PUT', `/nhan-vien/${nv.id}`, OWNER, { tenGoi: 'Anh Hùng' })).statusCode).toBe(200);

    const nghi = await goi('PUT', `/nhan-vien/${nv.id}`, ADMIN, { trangThai: 'nghi', lyDo: 'Đã nghỉ việc 30/09' });
    expect(nghi.statusCode, nghi.body).toBe(200);
    expect(nghi.json().nhanVien).toMatchObject({ trangThai: 'nghi', vai: 'admin', tenGoi: 'Anh Hùng' });

    const nk = await prisma.botQuyenNhatKy.findFirst({ where: { orgId: ORG_A, lyDo: 'Đã nghỉ việc 30/09' } });
    expect(nk).toMatchObject({ aiId: ADMIN, doiTuong: 'nhan_vien', doiTuongId: nv.id });
    expect(nk!.truoc).toEqual({ zaloUid: '8001', tenGoi: 'Anh Hùng', vai: 'admin', trangThai: 'hoat_dong', userId: null, ghiChu: null });
    expect(nk!.sau).toEqual({ zaloUid: '8001', tenGoi: 'Anh Hùng', vai: 'admin', trangThai: 'nghi', userId: null, ghiChu: null });
  });

  it('PUT /nhan-vien: enum sai ⇒ 400; đổi zaloUid ⇒ 400; NV org khác ⇒ 404', async () => {
    const nv = await taoNv({ zaloUid: '8101', tenGoi: 'X', vai: 'sales' });
    const vaiSai = await goi('PUT', `/nhan-vien/${nv.id}`, OWNER, { vai: 'giam_doc' });
    expect(vaiSai.statusCode).toBe(400);
    expect(vaiSai.json().code).toBe('VAI_KHONG_HOP_LE');
    const ttSai = await goi('PUT', `/nhan-vien/${nv.id}`, OWNER, { trangThai: 'tam_nghi' });
    expect(ttSai.statusCode).toBe(400);
    expect(ttSai.json().code).toBe('TRANG_THAI_KHONG_HOP_LE');
    const doiUid = await goi('PUT', `/nhan-vien/${nv.id}`, OWNER, { zaloUid: '9999' });
    expect(doiUid.statusCode).toBe(400);
    expect(doiUid.json().code).toBe('KHONG_DOI_ZALO_UID');

    const nvB = await taoNv({ zaloUid: '8102', tenGoi: 'B', vai: 'sales' }, OWNER_B);
    const cheo = await goi('PUT', `/nhan-vien/${nvB.id}`, OWNER, { tenGoi: 'Cướp' });
    expect(cheo.statusCode).toBe(404);
    expect(await prisma.botNhanVien.findUnique({ where: { id: nvB.id } })).toMatchObject({ tenGoi: 'B' });
  });

  it('GET /nhan-vien chỉ trả NV của org mình', async () => {
    await taoNv({ zaloUid: '8201', tenGoi: 'A', vai: 'sales' });
    await taoNv({ zaloUid: '8202', tenGoi: 'B', vai: 'sales' }, OWNER_B);
    const ds = (await goi('GET', '/nhan-vien', OWNER)).json().nhanVien as Array<Record<string, any>>;
    expect(ds.map((x) => x.zaloUid)).toEqual(['8201']);
  });

  // ── Nhật ký ────────────────────────────────────────────────────────────────

  it('GET /nhat-ky: mới nhất trước, có tên người đổi + tên đối tượng, limit, không lẫn org khác', async () => {
    await goi('PUT', `/nhom/${G1}`, OWNER, { chucNang: 'sales' });
    const nv = await taoNv({ zaloUid: '9001', tenGoi: 'Lan', vai: 'ke_toan' }, ADMIN);
    await taoNv({ zaloUid: '9002', tenGoi: 'Org B', vai: 'sales' }, OWNER_B);

    const res = await goi('GET', '/nhat-ky', OWNER);
    expect(res.statusCode).toBe(200);
    const ds = res.json().nhatKy as Array<Record<string, any>>;
    expect(ds).toHaveLength(2);
    expect(ds[0]).toMatchObject({
      doiTuong: 'nhan_vien', doiTuongId: nv.id, tenDoiTuong: 'Lan',
      aiId: ADMIN, ai: { id: ADMIN, fullName: 'Quản trị A' }, truoc: null,
    });
    expect(ds[1]).toMatchObject({ doiTuong: 'nhom', doiTuongId: G1, tenDoiTuong: 'Nhóm Sales HN', ai: { fullName: 'Chủ A' } });

    const mot = (await goi('GET', '/nhat-ky?limit=1', OWNER)).json().nhatKy;
    expect(mot).toHaveLength(1);
    expect(mot[0].doiTuongId).toBe(nv.id);
  });

  // ── Thành viên nhóm ────────────────────────────────────────────────────────

  it('thành viên: có bản QUÉT lưu sẵn ⇒ nguồn da_quet, chỉ lần quét mới nhất; nhãn NV / nick CRM / người ngoài', async () => {
    await taoNv({ zaloUid: 'u-nv', tenGoi: 'Hùng kho', vai: 'kho' });
    await taoNv({ zaloUid: 'u-ct', tenGoi: 'Kế toán thuê', vai: 'cong_ty', lyDo: 'Người công ty' });
    const cu = new Date(Date.now() - 86_400_000);
    const moi = new Date();
    const gm = (memberUid: string, displayName: string, lastSeenAt: Date) =>
      prisma.groupMember.create({
        data: { orgId: ORG_A, zaloAccountId: NICK_A, groupId: 'test-bq-ext-g1', memberUid, displayName, lastSeenAt, harvestedAt: cu },
      });
    await gm('u-nv', 'Hùng', moi);
    await gm('u-ct', 'Kế toán', moi);
    await gm(NICK_A_UID, 'Nick LED HN', moi);
    await gm(NICK_A2_UID, 'Nick LED HCM', moi); // nick CRM KHÁC của org — bot coi là người ngoài
    await gm('u-la', 'Khách lạ', moi);
    await gm('u-da-roi', 'Đã rời nhóm', cu); // lần quét cũ — không còn thấy ở lần mới

    const res = await goi('GET', `/nhom/${G1}/thanh-vien`, OWNER);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.nguon).toBe('da_quet');
    expect(new Date(body.nguonLuc).getTime()).toBe(moi.getTime());
    const theoUid = Object.fromEntries((body.thanhVien as any[]).map((t) => [t.zaloUid, t]));
    expect(Object.keys(theoUid).sort()).toEqual([NICK_A_UID, NICK_A2_UID, 'u-ct', 'u-la', 'u-nv'].sort());
    expect(theoUid['u-nv']).toMatchObject({ loai: 'nhan_vien', laNickCrm: false, ten: 'Hùng', nhanVien: { tenGoi: 'Hùng kho', vai: 'kho', trangThai: 'hoat_dong' } });
    expect(theoUid['u-ct']).toMatchObject({ loai: 'nhan_vien', laNickCrm: false, nhanVien: { vai: 'cong_ty' } });
    // Chỉ nick CỦA CHÍNH hội thoại này là nick_crm (bot nạp nó vào nick_bot qua nick_uid).
    expect(theoUid[NICK_A_UID]).toMatchObject({ loai: 'nick_crm', laNickCrm: true, nhanVien: null });
    // Nick CRM khác chưa có trong BotNhanVien: người ngoài với bot ⇒ đếm vào soNguoiNgoai, gắn laNickCrm.
    expect(theoUid[NICK_A2_UID]).toMatchObject({ loai: 'nguoi_ngoai', laNickCrm: true, nhanVien: null });
    expect(theoUid['u-la']).toMatchObject({ loai: 'nguoi_ngoai', laNickCrm: false, nhanVien: null });
    expect(body.soNguoiNgoai).toBe(2);
  });

  it('thành viên: nick CRM khác ĐÃ là nhân viên (vd cong_ty) ⇒ nhan_vien, không đếm người ngoài', async () => {
    await taoNv({ zaloUid: NICK_A2_UID, tenGoi: 'Nick HCM', vai: 'cong_ty', lyDo: 'Nick sales của công ty' });
    await prisma.groupMember.createMany({
      data: [
        { orgId: ORG_A, zaloAccountId: NICK_A, groupId: 'test-bq-ext-g1', memberUid: NICK_A_UID, displayName: 'Nick HN' },
        { orgId: ORG_A, zaloAccountId: NICK_A, groupId: 'test-bq-ext-g1', memberUid: NICK_A2_UID, displayName: 'Nick HCM' },
      ],
    });
    const body = (await goi('GET', `/nhom/${G1}/thanh-vien`, OWNER)).json();
    const theoUid = Object.fromEntries((body.thanhVien as any[]).map((t) => [t.zaloUid, t]));
    expect(theoUid[NICK_A2_UID]).toMatchObject({ loai: 'nhan_vien', laNickCrm: true, nhanVien: { vai: 'cong_ty' } });
    expect(theoUid[NICK_A_UID]).toMatchObject({ loai: 'nick_crm', laNickCrm: true });
    expect(body.soNguoiNgoai).toBe(0);
  });

  it('thành viên: nick của nhóm G3 là nick HCM ⇒ ở G3 nick HN mới là người ngoài', async () => {
    await prisma.groupMember.createMany({
      data: [
        { orgId: ORG_A, zaloAccountId: NICK_A2, groupId: 'test-bq-ext-g3', memberUid: NICK_A_UID, displayName: 'Nick HN' },
        { orgId: ORG_A, zaloAccountId: NICK_A2, groupId: 'test-bq-ext-g3', memberUid: NICK_A2_UID, displayName: 'Nick HCM' },
      ],
    });
    const body = (await goi('GET', `/nhom/${G3}/thanh-vien`, OWNER)).json();
    const theoUid = Object.fromEntries((body.thanhVien as any[]).map((t) => [t.zaloUid, t]));
    expect(theoUid[NICK_A2_UID]).toMatchObject({ loai: 'nick_crm', laNickCrm: true });
    expect(theoUid[NICK_A_UID]).toMatchObject({ loai: 'nguoi_ngoai', laNickCrm: true });
    expect(body.soNguoiNgoai).toBe(1);
  });

  it('thành viên: chưa quét ⇒ gọi Zalo trực tiếp (nguồn zalo); ?lamMoi=1 bỏ qua bản quét', async () => {
    const goiZalo: Array<[string, string]> = [];
    docZalo = async (accountId, groupId) => {
      goiZalo.push([accountId, groupId]);
      return [{ zaloUid: 'u-z1', ten: 'Người Z1' }, { zaloUid: NICK_A_UID, ten: 'Nick' }];
    };
    const res = await goi('GET', `/nhom/${G2}/thanh-vien`, OWNER);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ nguon: 'zalo', soNguoiNgoai: 1, loiZalo: null });
    expect(goiZalo).toEqual([[NICK_A, 'test-bq-ext-g2']]);
    const tv = Object.fromEntries((res.json().thanhVien as any[]).map((t) => [t.zaloUid, t]));
    expect(tv['u-z1']).toMatchObject({ loai: 'nguoi_ngoai', laNickCrm: false });
    expect(tv[NICK_A_UID]).toMatchObject({ loai: 'nick_crm', laNickCrm: true });

    await prisma.groupMember.create({
      data: { orgId: ORG_A, zaloAccountId: NICK_A, groupId: 'test-bq-ext-g1', memberUid: 'u-quet', displayName: 'Quét' },
    });
    expect((await goi('GET', `/nhom/${G1}/thanh-vien`, OWNER)).json().nguon).toBe('da_quet');
    const lamMoi = (await goi('GET', `/nhom/${G1}/thanh-vien?lamMoi=1`, OWNER)).json();
    expect(lamMoi.nguon).toBe('zalo');
    expect(lamMoi.thanhVien.map((t: any) => t.zaloUid).sort()).toEqual([NICK_A_UID, 'u-z1'].sort());
  });

  it('thành viên: Zalo lỗi ⇒ rơi về người đã nhắn trong nhóm (nguồn tin_nhan) + nêu lỗi', async () => {
    docZalo = async () => { throw new Error('Zalo account not connected'); };
    const m = (zaloMsgId: string, senderUid: string, senderName: string, phut: number, senderType = 'contact') =>
      prisma.message.create({
        data: { conversationId: G2, zaloMsgId, senderType, senderUid, senderName, content: 'x', sentAt: new Date(Date.now() - phut * 60_000) },
      });
    await m('bq-m1', 'u-a', 'A cũ', 30);
    await m('bq-m2', 'u-a', 'A mới', 5);
    await m('bq-m3', 'u-b', 'B', 10);
    await m('bq-m4', NICK_A_UID, 'Nick', 1, 'self');

    const res = await goi('GET', `/nhom/${G2}/thanh-vien`, OWNER);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.nguon).toBe('tin_nhan');
    expect(body.loiZalo).toContain('not connected');
    const theoUid = Object.fromEntries((body.thanhVien as any[]).map((t) => [t.zaloUid, t]));
    expect(Object.keys(theoUid).sort()).toEqual([NICK_A_UID, 'u-a', 'u-b'].sort());
    expect(theoUid['u-a'].ten).toBe('A mới');
    expect(theoUid[NICK_A_UID].loai).toBe('nick_crm');
    expect(body.soNguoiNgoai).toBe(2);
  });

  it('thành viên: Zalo TREO quá hạn giờ ⇒ rơi về người đã nhắn, loiZalo nói hết giờ', async () => {
    const appNgan = await dungApp({ hetGioZaloMs: 50 });
    try {
      let daGoi = 0;
      docZalo = () => { daGoi++; return new Promise(() => {}); }; // không bao giờ trả
      await prisma.message.create({
        data: { conversationId: G2, zaloMsgId: 'bq-m9', senderType: 'contact', senderUid: 'u-c', senderName: 'C', content: 'x', sentAt: new Date() },
      });
      const batDau = Date.now();
      const res = await appNgan.inject({
        method: 'GET', url: `${BASE}/nhom/${G2}/thanh-vien`, headers: { authorization: `Bearer ${token(OWNER)}` },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(Date.now() - batDau).toBeLessThan(5_000);
      expect(daGoi).toBe(1);
      expect(res.json()).toMatchObject({ nguon: 'tin_nhan', soNguoiNgoai: 1 });
      expect(res.json().loiZalo).toContain('không trả lời');
      expect(res.json().thanhVien.map((t: any) => t.zaloUid)).toEqual(['u-c']);
    } finally {
      await appNgan.close();
    }
  });

  it('thành viên: hội thoại 1-1 / org khác ⇒ 404', async () => {
    expect((await goi('GET', `/nhom/${U1}/thanh-vien`, OWNER)).statusCode).toBe(404);
    expect((await goi('GET', `/nhom/${GB}/thanh-vien`, OWNER)).statusCode).toBe(404);
  });
});
