// SPDX-License-Identifier: AGPL-3.0-or-later
// docs/79 §PDF cho khách (03/10) — POST /api/public/tai-lieu-ky-thuat/file trên Postgres THẬT:
//   • kho file = bảng messages (content_type='file', JSON {title, href}) qua `lietKeTaiLieu` THẬT; luật chọn = `kemFileTriThuc`;
//   • đường NV: file khớp ⇒ 200 application/pdf + x-tai-lieu-ten; không khớp ⇒ 204 + x-ly-do; bảng giá (locGiaNoiBo) không bao giờ;
//   • đường KHÁCH: chỉ file ứng với tài liệu kho tri thức CÙNG TÊN không bị loại trừ — loại trừ ⇒ 204 (NV vẫn được); file không có
//     tài liệu tương ứng (vd khách tự gửi vào nhóm) ⇒ 204; tên nội bộ ⇒ 204;
//   • cách ly org (org lấy từ khoá); 401 khoá sai; 400 thân sai.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npx vitest run tests/bot-tai-lieu-file-db.test.ts
import { it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { botChoKhachPublicRoutes } from '../src/modules/bot-quyen/bot-cho-khach-routes.js';
import type { TaiLieu } from '../src/modules/ai/odoo/tools/gui-tai-lieu.js';

const ORG_A = 'test-tlf-org-a';
const ORG_B = 'test-tlf-org-b';
const OWNER_A = 'test-tlf-owner-a';
const OWNER_B = 'test-tlf-owner-b';
const KHOA_A = 'test-tlf-khoa-a';
const KHOA_B = 'test-tlf-khoa-b';
const ORGS = [ORG_A, ORG_B];

const thu = mkdtempSync(join(tmpdir(), 'tlf-db-'));
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4096, 0x20)]);
const daTai: string[] = [];
/** Tải giả: mỗi file ⇒ một tệp PDF trên đĩa (đường thật tải CDN/đọc /files — ngoài phạm vi test này). */
async function taiVe(t: TaiLieu): Promise<string> {
  daTai.push(t.tieuDe);
  const p = join(thu, `${daTai.length}.pdf`);
  writeFileSync(p, PDF);
  return p;
}

let pub: FastifyInstance;
let so = 0;

async function donDep() {
  await prisma.message.deleteMany({ where: { conversation: { orgId: { in: ORGS } } } });
  await prisma.conversation.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.zaloAccount.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.knowledgeChunk.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.knowledgeDocument.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.botTaiLieuLoaiTru.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.appSetting.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.user.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.organization.deleteMany({ where: { id: { in: ORGS } } });
}

async function file(conv: string, title: string, senderType = 'self') {
  so++;
  await prisma.message.create({
    data: {
      id: `test-tlf-m${so}`, conversationId: conv, senderType, content: JSON.stringify({ title, href: `https://cdn.example/${so}.pdf`,
        params: JSON.stringify({ fileSize: 5000 }) }), contentType: 'file', sentAt: new Date(),
    },
  });
}

async function taiLieu(orgId: string, id: string, title: string) {
  await prisma.knowledgeDocument.create({ data: { id, orgId, title, source: 'datasheet-pdf', content: `${title}\nRefresh rate: 3840Hz` } });
}

async function goi(khoa: string, body: unknown) {
  return pub.inject({ method: 'POST', url: '/api/public/tai-lieu-ky-thuat/file', headers: { 'x-api-key': khoa }, payload: body as object });
}

describeCanDb('POST /api/public/tai-lieu-ky-thuat/file — file PDF gốc kèm thông số (DB)', () => {
  beforeAll(async () => {
    await donDep();
    for (const [org, owner, khoa] of [[ORG_A, OWNER_A, KHOA_A], [ORG_B, OWNER_B, KHOA_B]]) {
      await prisma.organization.create({ data: { id: org, name: org } });
      await prisma.user.create({ data: { id: owner, orgId: org, email: `${owner}@x.com`, passwordHash: 'x', fullName: 'Chủ', role: 'owner', isActive: true } });
      await prisma.appSetting.create({ data: { orgId: org, settingKey: 'public_api_key', valuePlain: khoa } });
      await prisma.zaloAccount.create({ data: { id: `${org}-nick`, orgId: org, ownerUserId: owner, zaloUid: `${org}-uid`, displayName: 'Nick', status: 'disconnected' } });
      await prisma.conversation.create({ data: { id: `${org}-g`, orgId: org, zaloAccountId: `${org}-nick`, threadType: 'group', externalThreadId: `${org}-ext`, groupName: 'NV', lastMessageAt: new Date() } });
    }
    await file(`${ORG_A}-g`, 'LLR -P10 -RGB OPLUNG.pdf');
    await file(`${ORG_A}-g`, 'K10P.pdf');
    await file(`${ORG_A}-g`, 'Bang gia dai ly P10.pdf');
    await file(`${ORG_A}-g`, 'Bao gia K6P.pdf');
    await file(`${ORG_A}-g`, 'Y2.pdf', 'contact');                   // khách tự gửi — không có tài liệu kho tri thức tương ứng
    await taiLieu(ORG_A, 'test-tlf-d1', 'LLR -P10 -RGB OPLUNG');
    await taiLieu(ORG_A, 'test-tlf-d2', 'K10P');
    await taiLieu(ORG_A, 'test-tlf-d3', 'Bao gia K6P');
    await file(`${ORG_B}-g`, 'Z9X.pdf');
    await taiLieu(ORG_B, 'test-tlf-d9', 'Z9X');
    pub = Fastify({ logger: false });
    await pub.register(botChoKhachPublicRoutes, { depsFile: { taiVe } });
    await pub.ready();
  });

  afterAll(async () => {
    await pub?.close();
    await donDep();
    rmSync(thu, { recursive: true, force: true });
  });

  it('NV: file khớp ⇒ 200 PDF + tên file gốc', async () => {
    const r = await goi(KHOA_A, { cau_hoi: 'thông số kỹ thuật ovp-k10p', duong: 'nhan_vien' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(decodeURIComponent(String(r.headers['x-tai-lieu-ten']))).toBe('K10P.pdf');
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('KHÁCH: file ứng với tài liệu kho tri thức không loại trừ ⇒ 200; tiêu đề đoạn RAG đầu tiên dùng được', async () => {
    const r = await goi(KHOA_A, { cau_hoi: 'cho xin thông số p10 ốp lưng', tieu_de_doan: 'LLR -P10 -RGB OPLUNG', duong: 'khach' });
    expect(r.statusCode, r.body).toBe(200);
    expect(decodeURIComponent(String(r.headers['x-tai-lieu-ten']))).toBe('LLR -P10 -RGB OPLUNG.pdf');
  });

  it('KHÁCH: tài liệu bị LOẠI TRỪ ⇒ 204 (NV vẫn nhận file); bỏ loại trừ ⇒ khách nhận lại', async () => {
    await prisma.botTaiLieuLoaiTru.create({ data: { orgId: ORG_A, taiLieuId: 'test-tlf-d2', boi: 'test' } });
    const k = await goi(KHOA_A, { cau_hoi: 'thông số k10p', duong: 'khach' });
    expect(k.statusCode).toBe(204);
    expect((await goi(KHOA_A, { cau_hoi: 'thông số k10p', duong: 'nhan_vien' })).statusCode).toBe(200);
    await prisma.botTaiLieuLoaiTru.deleteMany({ where: { orgId: ORG_A, taiLieuId: 'test-tlf-d2' } });
    expect((await goi(KHOA_A, { cau_hoi: 'thông số k10p', duong: 'khach' })).statusCode).toBe(200);
  });

  it('KHÁCH: file không đối chiếu được với kho tri thức (khách tự gửi) ⇒ 204; tên báo giá ⇒ 204', async () => {
    const y2 = await goi(KHOA_A, { cau_hoi: 'thông số y2', duong: 'khach' });
    expect(y2.statusCode).toBe(204);
    expect(y2.headers['x-ly-do']).toBe('khong_khop');
    expect((await goi(KHOA_A, { cau_hoi: 'thông số y2', duong: 'nhan_vien' })).statusCode).toBe(200);
    expect((await goi(KHOA_A, { cau_hoi: 'thông số k6p', duong: 'khach' })).statusCode).toBe(204);
  });

  it('bảng giá (locGiaNoiBo) không bao giờ — kể cả đường NV', async () => {
    const r = await goi(KHOA_A, { cau_hoi: 'thông số bang gia dai ly p10', duong: 'nhan_vien' });
    expect(decodeURIComponent(String(r.headers['x-tai-lieu-ten'] ?? ''))).not.toContain('Bang gia');
  });

  it('không phải câu thông số / không khớp ⇒ 204 + x-ly-do', async () => {
    const r = await goi(KHOA_A, { cau_hoi: 'k10p IP mấy', duong: 'nhan_vien' });
    expect(r.statusCode).toBe(204);
    expect(r.headers['x-ly-do']).toBe('khong_khop');
  });

  it('cách ly org: khoá org B không thấy file org A', async () => {
    expect((await goi(KHOA_B, { cau_hoi: 'thông số k10p', duong: 'nhan_vien' })).statusCode).toBe(204);
    const b = await goi(KHOA_B, { cau_hoi: 'thông số z9x', duong: 'khach' });
    expect(b.statusCode).toBe(200);
    expect(decodeURIComponent(String(b.headers['x-tai-lieu-ten']))).toBe('Z9X.pdf');
  });

  it('khoá sai ⇒ 401; thân sai ⇒ 400', async () => {
    expect((await goi('khoa-sai', { cau_hoi: 'thông số k10p', duong: 'khach' })).statusCode).toBe(401);
    expect((await goi(KHOA_A, { cau_hoi: 'thông số k10p', duong: 'ai' })).statusCode).toBe(400);
  });
});
