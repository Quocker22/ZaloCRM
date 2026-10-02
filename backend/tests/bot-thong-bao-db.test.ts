// SPDX-License-Identifier: AGPL-3.0-or-later
// Thông báo chủ động (docs/78 C2) — luật thông báo + ảnh chụp bản đồ tin trên Postgres THẬT:
//   • quản trị /api/v1/bot-quyen/luat-thong-bao: 401 không token, 403 NV thường (mọi route), kiểm cứng theo ảnh chụp,
//     chưa có ảnh chụp ⇒ 409, nhật ký trước/sau cùng giao dịch, phienBan chống ghi đè, cách ly org;
//   • công khai (x-api-key): GET luật (phien_ban ổn định/đổi đúng lúc, áp lại luật cứng), POST ảnh chụp (kiểm hình, thay bản cũ);
//   • migration gieo luật chủ chọn 02/10: chạy lặp không nhân đôi, không đè luật chủ đã sửa.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import { registerBotQuyenRoutes } from '../src/modules/bot-quyen/bot-quyen-routes.js';
import { botThongBaoPublicRoutes } from '../src/modules/bot-quyen/bot-thong-bao-routes.js';

const ORG_A = 'test-btb-org-a';
const ORG_B = 'test-btb-org-b';
const OWNER = 'test-btb-owner';
const ADMIN = 'test-btb-admin';
const MEMBER = 'test-btb-member';
const OWNER_B = 'test-btb-owner-b';
const KHOA_A = 'test-btb-khoa-a';
const KHOA_B = 'test-btb-khoa-b';
const BASE = '/api/v1/bot-quyen';
const ORGS = [ORG_A, ORG_B];

const ANH = {
  phien_ban: 'dm-1',
  composer: [
    { id: 'xuat_hoa_don_tool', ten: 'Xuất hoá đơn', pha: 'chot', kieu: 'ban_sao', dich_goc: 'nhom_goc', nhay_cam: ['tien'] },
    { id: 'in_sau_chot', ten: 'In sau chốt', pha: 'chot', kieu: 'ban_sao', dich_goc: 'nhom_goc', nhay_cam: [] },
    { id: 'the_don', ten: 'Thẻ đơn', pha: 'len_don', kieu: 'khoa', dich_goc: 'nhom_goc', nhay_cam: ['gia'] },
  ],
  dem: [{ composer: 'xuat_hoa_don_tool', dich_kieu: 'nhom_goc', ket_qua: 'da_gui', so: 12 }],
};

async function donDep() {
  await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.botLuatThongBao.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.botBanDoTin.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.botNhanVien.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.appSetting.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.user.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.organization.deleteMany({ where: { id: { in: ORGS } } });
}

let admin: FastifyInstance;
let pub: FastifyInstance;

function token(userId: string): string {
  const role = userId === OWNER || userId === OWNER_B ? 'owner' : userId === ADMIN ? 'admin' : 'member';
  return admin.jwt.sign({ id: userId, email: `${userId}@x.com`, role, orgId: userId === OWNER_B ? ORG_B : ORG_A, typ: 'access' });
}

async function goi(method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, userId: string | null, payload?: unknown) {
  return admin.inject({
    method, url: `${BASE}${url}`,
    headers: userId ? { authorization: `Bearer ${token(userId)}` } : {},
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

async function guiAnh(khoa: string, body: unknown = ANH) {
  return pub.inject({ method: 'POST', url: '/api/public/ban-do-tin', headers: { 'x-api-key': khoa }, payload: body as object });
}

async function docLuat(khoa: string) {
  const r = await pub.inject({ method: 'GET', url: '/api/public/bot-thong-bao/luat', headers: { 'x-api-key': khoa } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { phien_ban: string; luat: Array<Record<string, unknown>>; canh_bao: string[] };
}

async function nhatKy(orgId = ORG_A) {
  return prisma.botQuyenNhatKy.findMany({ where: { orgId, doiTuong: 'luat_thong_bao' }, orderBy: { luc: 'asc' } });
}

describeCanDb('bot-thong-bao — luật thông báo + bản đồ tin (DB)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.organization.create({ data: { id: ORG_A, name: 'BTB A' } });
    await prisma.organization.create({ data: { id: ORG_B, name: 'BTB B' } });
    const u = (id: string, orgId: string, role: string) =>
      prisma.user.create({ data: { id, orgId, email: `${id}@x.com`, passwordHash: 'x', fullName: id, role, isActive: true } });
    await u(OWNER, ORG_A, 'owner');
    await u(ADMIN, ORG_A, 'admin');
    await u(MEMBER, ORG_A, 'member');
    await u(OWNER_B, ORG_B, 'owner');
    await prisma.appSetting.create({ data: { orgId: ORG_A, settingKey: 'public_api_key', valuePlain: KHOA_A } });
    await prisma.appSetting.create({ data: { orgId: ORG_B, settingKey: 'public_api_key', valuePlain: KHOA_B } });
    admin = Fastify({ logger: false });
    await admin.register(fastifyJwt, { secret: config.jwtSecret });
    await admin.register(registerBotQuyenRoutes, { prefix: BASE });
    await admin.ready();
    pub = Fastify({ logger: false });
    await pub.register(botThongBaoPublicRoutes);
    await pub.ready();
  });

  afterAll(async () => {
    await admin?.close();
    await pub?.close();
    await donDep();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: { in: ORGS } } });
    await prisma.botLuatThongBao.deleteMany({ where: { orgId: { in: ORGS } } });
    await prisma.botBanDoTin.deleteMany({ where: { orgId: { in: ORGS } } });
    await prisma.botNhanVien.deleteMany({ where: { orgId: { in: ORGS } } });
  });

  // ── Quyền vào ──────────────────────────────────────────────────────────────

  it('không token ⇒ 401; NV thường ⇒ 403 ở MỌI route (5/5), không ghi gì', async () => {
    expect((await goi('GET', '/luat-thong-bao', null)).statusCode).toBe(401);
    await guiAnh(KHOA_A);
    const l = await prisma.botLuatThongBao.create({ data: { orgId: ORG_A, loai: 'in_sau_chot' } });
    const cac = [
      await goi('GET', '/luat-thong-bao', MEMBER),
      await goi('POST', '/luat-thong-bao', MEMBER, { loai: 'xuat_hoa_don_tool', cheDo: 'bat' }),
      await goi('PUT', `/luat-thong-bao/${l.id}`, MEMBER, { cheDo: 'bat' }),
      await goi('DELETE', `/luat-thong-bao/${l.id}`, MEMBER),
      await goi('GET', '/ban-do-tin', MEMBER),
    ];
    expect(cac.map((r) => r.statusCode)).toEqual([403, 403, 403, 403, 403]);
    expect(await prisma.botLuatThongBao.count({ where: { orgId: ORG_A } })).toBe(1);
    expect((await prisma.botLuatThongBao.findUniqueOrThrow({ where: { id: l.id } })).cheDo).toBe('bong');
    expect(await nhatKy()).toHaveLength(0);
  });

  it('API công khai: thiếu / sai khoá ⇒ 401 (cả GET luật lẫn POST ảnh chụp)', async () => {
    expect((await pub.inject({ method: 'GET', url: '/api/public/bot-thong-bao/luat' })).statusCode).toBe(401);
    expect((await pub.inject({ method: 'GET', url: '/api/public/bot-thong-bao/luat', headers: { 'x-api-key': 'sai' } })).statusCode).toBe(401);
    expect((await guiAnh('sai')).statusCode).toBe(401);
    expect(await prisma.botBanDoTin.count({ where: { orgId: { in: ORGS } } })).toBe(0);
  });

  // ── Ảnh chụp ───────────────────────────────────────────────────────────────

  it('ảnh chụp: lưu bản MỚI NHẤT (thay bản cũ), sai hình ⇒ 400 không ghi; admin đọc được', async () => {
    expect((await guiAnh(KHOA_A, { ...ANH, composer: [{ id: 'X', kieu: 'thuan' }] })).statusCode).toBe(400);
    expect(await prisma.botBanDoTin.count({ where: { orgId: ORG_A } })).toBe(0);
    const r1 = await guiAnh(KHOA_A);
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r1.json()).toEqual({ ok: true, phien_ban: 'dm-1', so_composer: 3 });
    expect((await guiAnh(KHOA_A, { ...ANH, phien_ban: 'dm-2' })).statusCode).toBe(200);
    const rows = await prisma.botBanDoTin.findMany({ where: { orgId: ORG_A } });
    expect(rows).toHaveLength(1);
    expect(rows[0].phienBan).toBe('dm-2');
    const doc = await goi('GET', '/ban-do-tin', OWNER);
    expect(doc.json().banDo.composer).toHaveLength(3);
    expect(doc.json().banDo.dem).toEqual(ANH.dem);
  });

  it('ảnh chụp quá 1 MB ⇒ 413', async () => {
    const lon = { ...ANH, dem: Array.from({ length: 4000 }, (_, i) => ({ composer: 'x'.repeat(128), dich_kieu: 'y'.repeat(128), so: i })) };
    expect((await guiAnh(KHOA_A, lon)).statusCode).toBe(413);
  });

  // ── Kiểm cứng ──────────────────────────────────────────────────────────────

  it('chưa có ảnh chụp ⇒ tạo/sửa luật bị từ chối 409 kèm câu rõ; XOÁ vẫn được', async () => {
    const r = await goi('POST', '/luat-thong-bao', OWNER, { loai: 'in_sau_chot', dich: [{ kieu: 'chuc_nang', gia_tri: 'kho' }] });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('CHUA_CO_BAN_DO');
    expect(r.json().error).toMatch(/chưa gửi danh mục/);
    const l = await prisma.botLuatThongBao.create({ data: { orgId: ORG_A, loai: 'in_sau_chot' } });
    expect((await goi('PUT', `/luat-thong-bao/${l.id}`, OWNER, { cheDo: 'bat' })).statusCode).toBe(409);
    expect((await goi('DELETE', `/luat-thong-bao/${l.id}`, OWNER, { lyDo: 'dọn' })).statusCode).toBe(200);
    expect(await prisma.botLuatThongBao.count({ where: { orgId: ORG_A } })).toBe(0);
  });

  it('composer lạ / composer khoá / nhom_goc / nhóm khách + nhạy cảm / NV không có ⇒ 400, không ghi gì', async () => {
    await guiAnh(KHOA_A);
    const ca: Array<[unknown, string]> = [
      [{ loai: 'khong_co' }, 'COMPOSER_LA'],
      [{ loai: 'the_don', dich: [{ kieu: 'chuc_nang', gia_tri: 'kho' }] }, 'COMPOSER_KHOA'],
      [{ loai: 'in_sau_chot', dich: [{ kieu: 'nhom_goc' }] }, 'DICH_NHOM_GOC'],
      [{ loai: 'xuat_hoa_don_tool', dich: [{ kieu: 'chuc_nang', gia_tri: 'khach' }] }, 'LO_DU_LIEU_NHOM_KHACH'],
      [{ loai: 'in_sau_chot', dich: [{ kieu: 'nv', gia_tri: '9999' }] }, 'NV_KHONG_CO'],
      [{ loai: 'in_sau_chot', dich: [{ kieu: 'phong_ban', gia_tri: 'x' }] }, 'DICH_KHONG_HOP_LE'],
      [{ loai: 'in_sau_chot', cheDo: 'mo' }, 'DU_LIEU_KHONG_HOP_LE'],
    ];
    for (const [body, code] of ca) {
      const r = await goi('POST', '/luat-thong-bao', OWNER, body);
      expect([r.statusCode, r.json().code], JSON.stringify(body)).toEqual([400, code]);
    }
    expect(await prisma.botLuatThongBao.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await nhatKy()).toHaveLength(0);
    // Nhóm khách cho composer KHÔNG nhạy cảm + NV có thật ⇒ được.
    await prisma.botNhanVien.create({ data: { orgId: ORG_A, zaloUid: '4001', tenGoi: 'Kho', vai: 'kho' } });
    const ok = await goi('POST', '/luat-thong-bao', ADMIN, {
      loai: 'in_sau_chot', dich: [{ kieu: 'chuc_nang', gia_tri: 'khach' }, { kieu: 'nv', gia_tri: '4001' }, { kieu: 'nguoi_gay_ra' }],
    });
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it('SQL tay cũng không lưu được nhom_goc / chế độ lạ (CHECK của migration)', async () => {
    await expect(prisma.$executeRaw`INSERT INTO bot_luat_thong_bao (id, org_id, loai, dich) VALUES ('x1', ${ORG_A}, 'a', '[{"kieu":"nhom_goc"}]'::jsonb)`).rejects.toThrow();
    await expect(prisma.$executeRaw`INSERT INTO bot_luat_thong_bao (id, org_id, loai, che_do) VALUES ('x2', ${ORG_A}, 'a', 'mo')`).rejects.toThrow();
  });

  // ── Vòng đời + nhật ký + phien_ban ─────────────────────────────────────────

  it('tạo (mặc định bong) → sửa (phienBan +1) → sửa trùng (không đổi) → phienBan cũ 409 → xoá; nhật ký trước/sau đủ', async () => {
    await guiAnh(KHOA_A);
    const t = await goi('POST', '/luat-thong-bao', OWNER, { loai: 'in_sau_chot', dich: [{ kieu: 'chuc_nang', gia_tri: 'kho' }], lyDo: 'chủ chọn' });
    expect(t.statusCode, t.body).toBe(201);
    const l = t.json().luat;
    expect(l).toMatchObject({ loai: 'in_sau_chot', cheDo: 'bong', phienBan: 1, gomGiay: 0, suaBoi: OWNER });
    expect((await goi('POST', '/luat-thong-bao', OWNER, { loai: 'in_sau_chot' })).statusCode).toBe(409);

    const s = await goi('PUT', `/luat-thong-bao/${l.id}`, ADMIN, { cheDo: 'bat', gomGiay: 60, lich: { gio: '08-18' }, phienBan: 1 });
    expect(s.statusCode, s.body).toBe(200);
    expect(s.json().luat).toMatchObject({ cheDo: 'bat', gomGiay: 60, phienBan: 2, doi: true, suaBoi: ADMIN, lich: { gio: '08-18' } });

    const trung = await goi('PUT', `/luat-thong-bao/${l.id}`, ADMIN, { cheDo: 'bat' });
    expect(trung.json().luat).toMatchObject({ doi: false, phienBan: 2 });
    const cu = await goi('PUT', `/luat-thong-bao/${l.id}`, OWNER, { cheDo: 'tat', phienBan: 1 });
    expect([cu.statusCode, cu.json().code]).toEqual([409, 'PHIEN_BAN_CU']);

    const boLich = await goi('PUT', `/luat-thong-bao/${l.id}`, OWNER, { lich: null });
    expect(boLich.json().luat).toMatchObject({ lich: null, phienBan: 3 });
    expect((await prisma.botLuatThongBao.findUniqueOrThrow({ where: { id: l.id } })).lich).toBeNull();

    expect((await goi('DELETE', `/luat-thong-bao/${l.id}`, OWNER, { lyDo: 'thôi' })).statusCode).toBe(200);
    expect((await goi('DELETE', `/luat-thong-bao/${l.id}`, OWNER)).statusCode).toBe(404);

    const nk = await nhatKy();
    expect(nk.map((r) => [r.aiId, r.doiTuongId, r.lyDo])).toEqual([
      [OWNER, l.id, 'chủ chọn'], [ADMIN, l.id, null], [OWNER, l.id, null], [OWNER, l.id, 'thôi'],
    ]);
    expect(nk[0].truoc).toBeNull();
    expect(nk[0].sau).toMatchObject({ loai: 'in_sau_chot', cheDo: 'bong', dich: [{ kieu: 'chuc_nang', gia_tri: 'kho' }] });
    expect(nk[1].truoc).toMatchObject({ cheDo: 'bong', phienBan: 1 });
    expect(nk[1].sau).toMatchObject({ cheDo: 'bat', gomGiay: 60, phienBan: 2 });
    expect(nk[3].sau).toBeNull();
    // Trang Quyền bot đọc chung nhật ký.
    expect((await goi('GET', '/nhat-ky', OWNER)).json().nhatKy.filter((r: { doiTuong: string }) => r.doiTuong === 'luat_thong_bao')).toHaveLength(4);
  });

  it('GET luật cho bot: phien_ban ổn định khi không đổi, đổi khi sửa; ảnh chụp mới đánh dấu nhạy cảm ⇒ CRM bỏ đích nhóm khách', async () => {
    await guiAnh(KHOA_A);
    const t = await goi('POST', '/luat-thong-bao', OWNER, {
      loai: 'in_sau_chot', cheDo: 'bat', dich: [{ kieu: 'chuc_nang', gia_tri: 'kho' }, { kieu: 'chuc_nang', gia_tri: 'khach' }],
    });
    expect(t.statusCode, t.body).toBe(201);
    const a = await docLuat(KHOA_A);
    expect(a.luat).toEqual([{
      loai: 'in_sau_chot', che_do: 'bat', dieu_kien: {}, gom_giay: 0, lich: null, phien_ban: 1,
      dich: [{ kieu: 'chuc_nang', gia_tri: 'khach' }, { kieu: 'chuc_nang', gia_tri: 'kho' }],
    }]);
    expect((await docLuat(KHOA_A)).phien_ban).toBe(a.phien_ban);
    await goi('PUT', `/luat-thong-bao/${t.json().luat.id}`, OWNER, { gomGiay: 30 });
    const b = await docLuat(KHOA_A);
    expect(b.phien_ban).not.toBe(a.phien_ban);
    // Bot đổi danh mục: in_sau_chot nay mang giá ⇒ nhóm khách bị bỏ khi phát, có cảnh báo.
    await guiAnh(KHOA_A, { ...ANH, composer: ANH.composer.map((c) => (c.id === 'in_sau_chot' ? { ...c, nhay_cam: ['gia'] } : c)) });
    const c = await docLuat(KHOA_A);
    expect(c.luat[0].dich).toEqual([{ kieu: 'chuc_nang', gia_tri: 'kho' }]);
    expect(c.canh_bao).toHaveLength(1);
    expect(c.phien_ban).not.toBe(b.phien_ban);
  });

  it('cách ly org: org B không thấy / không sửa / không xoá luật org A; khoá B chỉ đọc luật B', async () => {
    await guiAnh(KHOA_A);
    await guiAnh(KHOA_B);
    const t = await goi('POST', '/luat-thong-bao', OWNER, { loai: 'in_sau_chot', dich: [{ kieu: 'chuc_nang', gia_tri: 'kho' }] });
    const id = t.json().luat.id;
    expect((await goi('GET', '/luat-thong-bao', OWNER_B)).json().luat).toEqual([]);
    expect((await goi('PUT', `/luat-thong-bao/${id}`, OWNER_B, { cheDo: 'bat' })).statusCode).toBe(404);
    expect((await goi('DELETE', `/luat-thong-bao/${id}`, OWNER_B)).statusCode).toBe(404);
    expect((await prisma.botLuatThongBao.findUniqueOrThrow({ where: { id } })).cheDo).toBe('bong');
    expect((await docLuat(KHOA_B)).luat).toEqual([]);
    expect((await docLuat(KHOA_A)).luat).toHaveLength(1);
    // NV của org B không dùng được làm đích cho org A.
    await prisma.botNhanVien.create({ data: { orgId: ORG_B, zaloUid: '5001', tenGoi: 'B', vai: 'kho' } });
    const r = await goi('PUT', `/luat-thong-bao/${id}`, OWNER, { dich: [{ kieu: 'nv', gia_tri: '5001' }] });
    expect(r.json().code).toBe('NV_KHONG_CO');
    expect((await nhatKy(ORG_B))).toHaveLength(0);
  });

  // ── Gieo luật chủ chọn 02/10 ───────────────────────────────────────────────

  it('migration gieo: hai luật (ke_toan / kho, bat, không nhom_goc); chạy lặp không nhân đôi, không đè luật chủ đã sửa', async () => {
    const sql = readFileSync(new URL('../prisma/migrations/20261002090200_bot_luat_thong_bao_gieo/migration.sql', import.meta.url), 'utf8');
    const cau = sql.split('\n').filter((d) => !d.trim().startsWith('--')).join('\n').split(/;\s*\n/).map((c) => c.trim()).filter(Boolean);
    // Gieo chạm MỌI org trong DB test ⇒ chạy trong giao dịch rồi huỷ (không để lại dòng cho file test khác).
    const HUY = new Error('huy');
    await expect(prisma.$transaction(async (tx) => {
      for (const c of cau) await tx.$executeRawUnsafe(c);
      const dau = await tx.botLuatThongBao.findMany({ where: { orgId: ORG_A }, orderBy: { loai: 'asc' } });
      expect(dau.map((r) => [r.loai, r.dich, r.cheDo, r.suaBoi])).toEqual([
        ['in_sau_chot', [{ kieu: 'chuc_nang', gia_tri: 'kho' }], 'bat', null],
        ['xuat_hoa_don_tool', [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }], 'bat', null],
      ]);
      await tx.botLuatThongBao.update({ where: { id: dau[0].id }, data: { cheDo: 'tat' } });
      for (const c of cau) await tx.$executeRawUnsafe(c);
      const sau = await tx.botLuatThongBao.findMany({ where: { orgId: { in: ORGS } } });
      expect(sau).toHaveLength(4); // 2 org × 2 luật — không nhân đôi
      expect(sau.find((r) => r.id === dau[0].id)?.cheDo).toBe('tat'); // không đè
      throw HUY;
    })).rejects.toBe(HUY);
    expect(await prisma.botLuatThongBao.count({ where: { orgId: { in: ORGS } } })).toBe(0);
  });
});
