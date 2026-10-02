// SPDX-License-Identifier: AGPL-3.0-or-later
// Xác nhận giới tính Contact (docs/79 T1, sửa tự soát P1) trên Postgres THẬT — PUT /api/v1/contacts/:id.
//
// Lỗi gốc: form hồ sơ gửi `gender` ở MỌI lần bấm Lưu và backend đặt genderLocked = !!gender ⇒ sửa SĐT / ghi chú cũng "khoá
// tay" giới tính Zalo tự điền ⇒ bot gọi khách "anh/chị" theo giới chưa ai xác nhận. Luật mới:
//   • dấu `gioi_tinh_xac_nhan_luc` / `_boi` CHỈ đặt khi giá trị giới tính THỰC ĐỔI (backend so với giá trị đang lưu);
//   • gửi lại đúng giá trị đang lưu ⇒ không khoá, không dấu (trừ `xacNhanGioi: true` — nút "Xác nhận" tường minh);
//   • bỏ trống ⇒ mở khoá + xoá dấu; sửa tên / SĐT / ghi chú KHÔNG BAO GIỜ đóng dấu.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import { contactRoutes } from '../src/modules/contacts/contact-routes.js';

const ORG = 'test-cgx-org';
const OWNER = 'test-cgx-owner';
const CT = 'test-cgx-ct';

let app: FastifyInstance;

async function donDep() {
  await prisma.contact.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { orgId: ORG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
}

async function sua(body: Record<string, unknown>) {
  const tk = app.jwt.sign({ id: OWNER, email: `${OWNER}@x.com`, role: 'owner', orgId: ORG, typ: 'access' });
  const r = await app.inject({ method: 'PUT', url: `/api/v1/contacts/${CT}`, headers: { authorization: `Bearer ${tk}` }, payload: body });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

async function doc() {
  return prisma.contact.findUniqueOrThrow({
    where: { id: CT }, select: { gender: true, genderLocked: true, gioiTinhXacNhanLuc: true, gioiTinhXacNhanBoi: true },
  });
}

describeCanDb('contact — xác nhận giới tính chỉ khi THỰC ĐỔI (docs/79 T1)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.organization.create({ data: { id: ORG, name: 'CGX' } });
    await prisma.user.create({ data: { id: OWNER, orgId: ORG, email: `${OWNER}@x.com`, passwordHash: 'x', fullName: 'Chủ', role: 'owner', isActive: true } });
    app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: config.jwtSecret });
    await app.register(contactRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await donDep();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.contact.deleteMany({ where: { orgId: ORG } });
    // Zalo tự điền NAM — chưa ai xác nhận.
    await prisma.contact.create({ data: { id: CT, orgId: ORG, fullName: 'Khách', phone: '0900000000', gender: 'male' } });
  });

  it('sửa tên / SĐT / ghi chú (form gửi kèm gender ĐÚNG giá trị đang lưu) ⇒ KHÔNG khoá, KHÔNG dấu', async () => {
    await sua({ fullName: 'Khách A', phone: '0911111111', notes: 'gọi lại', gender: 'male' });
    await sua({ notes: 'ghi chú khác' });
    expect(await doc()).toEqual({ gender: 'male', genderLocked: false, gioiTinhXacNhanLuc: null, gioiTinhXacNhanBoi: null });
  });

  it('đổi giới tính thật ⇒ khoá + dấu (lúc, người đổi); trả về trong response', async () => {
    const r = await sua({ gender: 'female' });
    const d = await doc();
    expect(d.gender).toBe('female');
    expect(d.genderLocked).toBe(true);
    expect(d.gioiTinhXacNhanLuc).toBeInstanceOf(Date);
    expect(d.gioiTinhXacNhanBoi).toBe(OWNER);
    expect(r.gioiTinhXacNhanLuc).toBeTruthy();
    // Lưu lại cả form sau đó (gender không đổi) ⇒ dấu GIỮ NGUYÊN, không làm mới.
    const luc = d.gioiTinhXacNhanLuc!.getTime();
    await sua({ fullName: 'Khách B', gender: 'female' });
    const d2 = await doc();
    expect(d2.gioiTinhXacNhanLuc!.getTime()).toBe(luc);
    expect(d2.genderLocked).toBe(true);
  });

  it('bỏ trống giới tính ⇒ mở khoá + xoá dấu', async () => {
    await sua({ gender: 'female' });
    await sua({ gender: '' });
    expect(await doc()).toEqual({ gender: null, genderLocked: false, gioiTinhXacNhanLuc: null, gioiTinhXacNhanBoi: null });
  });

  it('xacNhanGioi: true (nút "Xác nhận" tường minh) đóng dấu giá trị Zalo tự điền đang lưu; gender rỗng thì không', async () => {
    await sua({ gender: 'male', xacNhanGioi: true });
    const d = await doc();
    expect(d.genderLocked).toBe(true);
    expect(d.gioiTinhXacNhanBoi).toBe(OWNER);
    await prisma.contact.update({ where: { id: CT }, data: { gender: null, genderLocked: false, gioiTinhXacNhanLuc: null, gioiTinhXacNhanBoi: null } });
    await sua({ gender: '', xacNhanGioi: true });
    expect(await doc()).toEqual({ gender: null, genderLocked: false, gioiTinhXacNhanLuc: null, gioiTinhXacNhanBoi: null });
  });

  it('khoá CŨ không dấu: lưu form với cùng giá trị KHÔNG đóng dấu (khoá cũ giữ nguyên để SDK không đè)', async () => {
    await prisma.contact.update({ where: { id: CT }, data: { genderLocked: true } });
    await sua({ fullName: 'Khách C', gender: 'male' });
    expect(await doc()).toEqual({ gender: 'male', genderLocked: true, gioiTinhXacNhanLuc: null, gioiTinhXacNhanBoi: null });
  });
});
