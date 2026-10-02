// SPDX-License-Identifier: AGPL-3.0-or-later
// Thông báo chủ động (docs/78 C2) — luật thông báo + ảnh chụp bản đồ tin trên Postgres THẬT:
//   • quản trị /api/v1/bot-quyen/luat-thong-bao: 401 không token, 403 NV thường (mọi route), kiểm cứng theo ảnh chụp,
//     chưa có ảnh chụp ⇒ 409, nhật ký trước/sau cùng giao dịch, phienBan chống ghi đè, cách ly org;
//   • công khai (x-api-key): GET luật (phien_ban ổn định/đổi đúng lúc, áp lại luật cứng), POST ảnh chụp (kiểm hình, thay bản cũ);
//   • gieo luật chủ chọn 02/10 (script quản trị qua service): cần ảnh chụp, bong mặc định, chạy lặp không nhân đôi/không đè.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import { registerBotQuyenRoutes } from '../src/modules/bot-quyen/bot-quyen-routes.js';
import { botThongBaoPublicRoutes } from '../src/modules/bot-quyen/bot-thong-bao-routes.js';
import { gieoLuatChuChon } from '../src/modules/bot-quyen/bot-thong-bao-service.js';

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
  dem: [{
    khoa_canh: 'xuat_hoa_don_tool→nhom_goc|goc', composer: 'xuat_hoa_don_tool', dich_kieu: 'nhom_goc', luat_id: null,
    ket_qua: 'da_gui', cua_so: '7d', so: 12,
  }],
};
const KHOA_BOT_A = 'test-btb-khoa-bot-a';

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

  it('hợp đồng ảnh chụp (Codex v1 #7): POST → GET quản trị giữ ĐỦ dan_toi/nguon_cau/khi_nao/vi_du/ghi_chu, nguồn giả, số đếm theo cạnh', async () => {
    const day = {
      phien_ban: 'a1b2c3d4e5f60718',
      pha: [{ id: 'chot', ten: 'Chốt' }], dich: ['nhom_goc', 'g_kho'], // bot gửi kèm — CRM bỏ qua (không lưu)
      composer: [
        {
          id: 'xuat_hoa_don_tool', ten: 'Xuất hoá đơn', pha: 'xuat_hd', kieu: 'ban_sao', de_xuat: false, dich_goc: ['nhom_goc'],
          nhay_cam: ['tien'], khi_nao: 'Sau khi xuất HĐ', vi_du: 'Em đã xuất S17440', nguon_cau: 'cong_cu/don_hang.py:2340',
          ghi_chu: 'Chữ do mã', dan_toi: [['in_sau_chot', 'nghiep_vu']],
        },
        {
          id: 'in_sau_chot', ten: 'In sau chốt', pha: 'in', kieu: 'ban_sao', de_xuat: true, dich_goc: ['nhom_goc'], nhay_cam: [],
          khi_nao: 'Sau lệnh in', vi_du: 'Em đã phát lệnh in', nguon_cau: 'cong_cu_tools.py:422', ghi_chu: '',
          dan_toi: [{ den: 'xuat_hoa_don_tool', kieu: 'hoi_lai', vi_sao: 'NV hỏi lại' }],
        },
      ],
      nguon: [{ id: 'nguon_may_in', ten: 'Máy in (sự kiện CRM)', pha: 'in', mo_ta: 'Bảng sự kiện in', dan_toi: [['in_sau_chot', 'su_kien']] }],
      dem: [
        { khoa_canh: 'xuat_hoa_don_tool→nhom_goc|goc', composer: 'xuat_hoa_don_tool', dich_kieu: 'nhom_goc', luat_id: null, ket_qua: 'da_gui', cua_so: '24h', so: 4 },
        { khoa_canh: 'xuat_hoa_don_tool→nhom_goc|goc', composer: 'xuat_hoa_don_tool', dich_kieu: 'nhom_goc', luat_id: null, ket_qua: 'da_gui', cua_so: '7d', so: 31 },
        { khoa_canh: 'in_sau_chot→g_kho|luat-1', composer: 'in_sau_chot', dich_kieu: 'g_kho', luat_id: 'luat-1', ket_qua: 'bong', cua_so: '24h', so: 7 },
        { khoa_canh: 'chua_khai→nhom_goc|goc', composer: 'chua_khai', dich_kieu: 'nhom_goc', luat_id: null, ket_qua: 'chan_tam_im', cua_so: '7d', so: 1 },
      ],
    };
    const r = await guiAnh(KHOA_A, day);
    expect(r.statusCode, r.body).toBe(200);
    const bd = (await goi('GET', '/ban-do-tin', OWNER)).json().banDo;
    expect(bd.phienBan).toBe(day.phien_ban);
    expect(bd.composer).toEqual([
      { ...day.composer[0], dan_toi: [{ den: 'in_sau_chot', kieu: 'nghiep_vu' }] },
      { ...day.composer[1], ghi_chu: null },
    ]);
    expect(bd.nguon).toEqual([{ ...day.nguon[0], dan_toi: [{ den: 'in_sau_chot', kieu: 'su_kien' }] }]);
    expect(bd.dem).toEqual(day.dem);
    expect(bd).not.toHaveProperty('pha');
    // Số đếm không khoá cạnh / không cửa sổ ⇒ 400, giữ bản cũ.
    const sai = await guiAnh(KHOA_A, { ...day, phien_ban: 'sai', dem: [{ so: 12 }] });
    expect([sai.statusCode, sai.json().code]).toEqual([400, 'ANH_CHUP_KHONG_HOP_LE']);
    expect((await goi('GET', '/ban-do-tin', OWNER)).json().banDo.phienBan).toBe(day.phien_ban);
  });

  it('khoá RIÊNG của bot cho ảnh chụp (bot_ban_do_tin_api_key): có khoá riêng ⇒ khoá công khai bị 403 khi POST ảnh chụp; khoá riêng POST + GET luật được; org không có khoá riêng giữ như cũ', async () => {
    await prisma.appSetting.create({ data: { orgId: ORG_A, settingKey: 'bot_ban_do_tin_api_key', valuePlain: KHOA_BOT_A } });
    try {
      const congKhai = await guiAnh(KHOA_A);
      expect([congKhai.statusCode, congKhai.json().code]).toEqual([403, 'CAN_KHOA_RIENG_BOT']);
      expect(await prisma.botBanDoTin.count({ where: { orgId: ORG_A } })).toBe(0);
      expect((await guiAnh(KHOA_BOT_A)).statusCode).toBe(200);
      expect((await docLuat(KHOA_BOT_A)).luat).toEqual([]);
      expect((await docLuat(KHOA_A)).luat).toEqual([]); // GET luật vẫn nhận khoá công khai
      expect((await guiAnh(KHOA_B)).statusCode).toBe(200); // org B chưa đặt khoá riêng
    } finally {
      await prisma.appSetting.deleteMany({ where: { orgId: ORG_A, settingKey: 'bot_ban_do_tin_api_key' } });
    }
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
    expect((await goi('PUT', `/luat-thong-bao/${l.id}`, OWNER, { cheDo: 'bat', phienBan: 1 })).statusCode).toBe(409);
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

    const trung = await goi('PUT', `/luat-thong-bao/${l.id}`, ADMIN, { cheDo: 'bat', phienBan: 2 });
    expect(trung.json().luat).toMatchObject({ doi: false, phienBan: 2 });
    const cu = await goi('PUT', `/luat-thong-bao/${l.id}`, OWNER, { cheDo: 'tat', phienBan: 1 });
    expect([cu.statusCode, cu.json().code]).toEqual([409, 'PHIEN_BAN_CU']);

    // P2: phienBan BẮT BUỘC khi sửa (thiếu ⇒ 400, không ghi đè mù).
    const thieu = await goi('PUT', `/luat-thong-bao/${l.id}`, OWNER, { cheDo: 'tat' });
    expect([thieu.statusCode, thieu.json().code]).toEqual([400, 'PHIEN_BAN_THIEU']);
    const boLich = await goi('PUT', `/luat-thong-bao/${l.id}`, OWNER, { lich: null, phienBan: 2 });
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
    await goi('PUT', `/luat-thong-bao/${t.json().luat.id}`, OWNER, { gomGiay: 30, phienBan: 1 });
    const b = await docLuat(KHOA_A);
    expect(b.phien_ban).not.toBe(a.phien_ban);
    // Bot đổi danh mục: in_sau_chot nay mang giá ⇒ nhóm khách bị bỏ khi phát, có cảnh báo.
    await guiAnh(KHOA_A, { ...ANH, composer: ANH.composer.map((c) => (c.id === 'in_sau_chot' ? { ...c, nhay_cam: ['gia'] } : c)) });
    const c = await docLuat(KHOA_A);
    expect(c.luat[0].dich).toEqual([{ kieu: 'chuc_nang', gia_tri: 'kho' }]);
    expect(c.canh_bao).toHaveLength(1);
    expect(c.phien_ban).not.toBe(b.phien_ban);
    // P2: trang quản trị thấy ĐÚNG cảnh báo bot nhận (đích bị bỏ khi phát).
    const ad = await goi('GET', '/luat-thong-bao', OWNER);
    expect(ad.json().canhBao).toEqual(c.canh_bao);
  });

  it('Codex v1 #1: composer BỊ BỎ khỏi ảnh chụp (không có trong sổ dính) ⇒ GET NGAY SAU bỏ mọi đích của luật đó + cảnh báo (fail closed)', async () => {
    await guiAnh(KHOA_A);
    const t = await goi('POST', '/luat-thong-bao', OWNER, {
      loai: 'in_sau_chot', cheDo: 'bat', dich: [{ kieu: 'chuc_nang', gia_tri: 'kho' }, { kieu: 'chuc_nang', gia_tri: 'khach' }],
    });
    expect(t.statusCode, t.body).toBe(201);
    expect((await docLuat(KHOA_A)).luat[0].dich).toHaveLength(2);
    const bo = await guiAnh(KHOA_A, { ...ANH, phien_ban: 'bo', composer: ANH.composer.filter((c) => c.id !== 'in_sau_chot') });
    expect(bo.statusCode, bo.body).toBe(200);
    const g = await docLuat(KHOA_A);
    expect(g.luat).toEqual([expect.objectContaining({ loai: 'in_sau_chot', dich: [] })]);
    expect(g.canh_bao).toEqual([expect.stringMatching(/^in_sau_chot: .*không có trong danh mục/)]);
    expect((await goi('GET', '/luat-thong-bao', OWNER)).json().canhBao).toEqual(g.canh_bao);
  });

  it('Codex v1 #1 (tái hiện): nhãn nhạy cảm DÍNH rồi bỏ composer khỏi ảnh chụp ⇒ GET vẫn bỏ đích nhóm khách (hợp sổ dính), giữ đích nội bộ', async () => {
    await guiAnh(KHOA_A);
    await goi('POST', '/luat-thong-bao', OWNER, {
      loai: 'in_sau_chot', cheDo: 'bat', dich: [{ kieu: 'chuc_nang', gia_tri: 'kho' }, { kieu: 'chuc_nang', gia_tri: 'khach' }],
    });
    await guiAnh(KHOA_A, { ...ANH, phien_ban: 'gia', composer: ANH.composer.map((c) => (c.id === 'in_sau_chot' ? { ...c, nhay_cam: ['gia'] } : c)) });
    expect((await docLuat(KHOA_A)).luat[0].dich).toEqual([{ kieu: 'chuc_nang', gia_tri: 'kho' }]);
    // Cùng khoá API: bỏ in_sau_chot ra khỏi ảnh chụp (được chấp nhận) — bản cũ phát lại đích khách ở GET kế tiếp.
    expect((await guiAnh(KHOA_A, { ...ANH, phien_ban: 'bo', composer: ANH.composer.filter((c) => c.id !== 'in_sau_chot') })).statusCode).toBe(200);
    const g = await docLuat(KHOA_A);
    expect(g.luat[0].dich).toEqual([{ kieu: 'chuc_nang', gia_tri: 'kho' }]);
    expect(g.canh_bao.some((x) => x.includes('khach'))).toBe(true);
  });

  it('cách ly org: org B không thấy / không sửa / không xoá luật org A; khoá B chỉ đọc luật B', async () => {
    await guiAnh(KHOA_A);
    await guiAnh(KHOA_B);
    const t = await goi('POST', '/luat-thong-bao', OWNER, { loai: 'in_sau_chot', dich: [{ kieu: 'chuc_nang', gia_tri: 'kho' }] });
    const id = t.json().luat.id;
    expect((await goi('GET', '/luat-thong-bao', OWNER_B)).json().luat).toEqual([]);
    expect((await goi('PUT', `/luat-thong-bao/${id}`, OWNER_B, { cheDo: 'bat', phienBan: 1 })).statusCode).toBe(404);
    expect((await goi('DELETE', `/luat-thong-bao/${id}`, OWNER_B)).statusCode).toBe(404);
    expect((await prisma.botLuatThongBao.findUniqueOrThrow({ where: { id } })).cheDo).toBe('bong');
    expect((await docLuat(KHOA_B)).luat).toEqual([]);
    expect((await docLuat(KHOA_A)).luat).toHaveLength(1);
    // NV của org B không dùng được làm đích cho org A.
    await prisma.botNhanVien.create({ data: { orgId: ORG_B, zaloUid: '5001', tenGoi: 'B', vai: 'kho' } });
    const r = await goi('PUT', `/luat-thong-bao/${id}`, OWNER, { dich: [{ kieu: 'nv', gia_tri: '5001' }], phienBan: 1 });
    expect(r.json().code).toBe('NV_KHONG_CO');
    expect((await nhatKy(ORG_B))).toHaveLength(0);
  });

  // ── Ảnh chụp: nhạy cảm DÍNH + nhật ký (tự rà P1-5) ─────────────────────────

  it('nhạy cảm DÍNH: ảnh chụp mới không gỡ được nhay_cam / không mở khoá composer (409, giữ bản cũ) — kể cả bỏ ra rồi thêm lại', async () => {
    expect((await guiAnh(KHOA_A)).statusCode).toBe(200);
    const gia = (doi: (c: (typeof ANH.composer)[number]) => object | null, pb = 'gia') => ({
      ...ANH, phien_ban: pb, composer: ANH.composer.map(doi).filter(Boolean),
    });
    const goNhayCam = await guiAnh(KHOA_A, gia((c) => (c.id === 'xuat_hoa_don_tool' ? { ...c, nhay_cam: [] } : c)));
    expect([goNhayCam.statusCode, goNhayCam.json().code]).toEqual([409, 'NHAY_CAM_DINH']);
    const moKhoa = await guiAnh(KHOA_A, gia((c) => (c.id === 'the_don' ? { ...c, kieu: 'thuan' } : c)));
    expect([moKhoa.statusCode, moKhoa.json().code]).toEqual([409, 'NHAY_CAM_DINH']);
    expect((await prisma.botBanDoTin.findUniqueOrThrow({ where: { orgId: ORG_A } })).phienBan).toBe('dm-1');
    // Bỏ composer ra (được) rồi thêm lại không nhạy cảm ⇒ vẫn 409 (sổ dính không quên).
    expect((await guiAnh(KHOA_A, gia((c) => (c.id === 'xuat_hoa_don_tool' ? null : c), 'bo'))).statusCode).toBe(200);
    expect((await guiAnh(KHOA_A, gia((c) => (c.id === 'xuat_hoa_don_tool' ? { ...c, nhay_cam: [] } : c), 'lai'))).statusCode).toBe(409);
    // Thêm nhạy cảm / thêm composer mới / khoá thêm thì luôn được.
    const them = await guiAnh(KHOA_A, {
      ...ANH, phien_ban: 'them',
      composer: [...ANH.composer.map((c) => (c.id === 'xuat_hoa_don_tool' ? { ...c, nhay_cam: ['sdt', 'tien'] } : c.id === 'in_sau_chot' ? { ...c, kieu: 'khoa' } : c)),
        { id: 'moi', kieu: 'thuan' }],
    });
    expect(them.statusCode, them.body).toBe(200);
    // Ảnh chụp giả đã bị từ chối ⇒ nhóm khách vẫn bị chặn cho composer nhạy cảm.
    const r = await goi('POST', '/luat-thong-bao', OWNER, { loai: 'xuat_hoa_don_tool', dich: [{ kieu: 'chuc_nang', gia_tri: 'khach' }] });
    expect(r.json().code).toBe('LO_DU_LIEU_NHOM_KHACH');
  });

  it('nhật ký ảnh chụp: ai = khoá API; chỉ ghi khi DANH MỤC đổi (số đếm đổi không ghi); lần bị từ chối cũng ghi', async () => {
    const khoa = await prisma.appSetting.findFirstOrThrow({ where: { orgId: ORG_A, settingKey: 'public_api_key' } });
    await guiAnh(KHOA_A);
    await guiAnh(KHOA_A, { ...ANH, dem: [{ ...ANH.dem[0], so: 3 }] });
    await guiAnh(KHOA_A, { ...ANH, phien_ban: 'dm-2', composer: [...ANH.composer, { id: 'moi', kieu: 'thuan' }] });
    await guiAnh(KHOA_A, { ...ANH, phien_ban: 'gia', composer: ANH.composer.map((c) => ({ ...c, nhay_cam: [] })) });
    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG_A, doiTuong: 'ban_do_tin' }, orderBy: { luc: 'asc' } });
    expect(nk.map((r) => r.aiId)).toEqual([`api_key:${khoa.id}`, `api_key:${khoa.id}`, `api_key:${khoa.id}`]);
    expect(nk[0]).toMatchObject({ truoc: null, sau: { phienBan: 'dm-1', soComposer: 3 } });
    expect(nk[1]).toMatchObject({ truoc: { phienBan: 'dm-1' }, sau: { phienBan: 'dm-2', soComposer: 4, them: ['moi'] } });
    expect(nk[2].lyDo).toMatch(/^Từ chối/);
    expect(nk[2].sau).toBeNull();
    // Trang Quyền bot đọc chung nhật ký.
    expect((await goi('GET', '/nhat-ky', OWNER)).json().nhatKy.filter((r: { doiTuong: string }) => r.doiTuong === 'ban_do_tin')).toHaveLength(3);
  });

  // ── Gieo luật chủ chọn 02/10 (script quản trị, KHÔNG migration) ─────────

  it('gieo luật chủ chọn: chưa có ảnh chụp ⇒ từ chối, không ghi; có ảnh chụp ⇒ hai luật qua ĐÚNG service (bong mặc định, nhật ký); chạy lặp không nhân đôi, không đè', async () => {
    await expect(gieoLuatChuChon(ORG_A, { aiId: 'cli:test' })).rejects.toMatchObject({ status: 409, code: 'CHUA_CO_BAN_DO' });
    expect(await prisma.botLuatThongBao.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await nhatKy()).toHaveLength(0);

    await guiAnh(KHOA_A);
    const kq = await gieoLuatChuChon(ORG_A, { aiId: 'cli:test' });
    expect(kq.map((k) => [k.loai, k.ketQua])).toEqual([['xuat_hoa_don_tool', 'tao'], ['in_sau_chot', 'tao']]);
    const dau = await prisma.botLuatThongBao.findMany({ where: { orgId: ORG_A }, orderBy: { loai: 'asc' } });
    expect(dau.map((r) => [r.loai, r.dich, r.cheDo, r.suaBoi])).toEqual([
      ['in_sau_chot', [{ kieu: 'chuc_nang', gia_tri: 'kho' }], 'bong', 'cli:test'],
      ['xuat_hoa_don_tool', [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }], 'bong', 'cli:test'],
    ]);
    expect((await nhatKy()).map((r) => [r.aiId, r.truoc, r.lyDo])).toEqual([
      ['cli:test', null, expect.stringMatching(/chủ chọn 02\/10/)], ['cli:test', null, expect.stringMatching(/chủ chọn 02\/10/)],
    ]);
    // Chủ sửa một luật rồi chạy lại ⇒ không đè, không nhân đôi.
    await prisma.botLuatThongBao.update({ where: { id: dau[0].id }, data: { cheDo: 'tat' } });
    const lai = await gieoLuatChuChon(ORG_A, { aiId: 'cli:test', cheDo: 'bat' });
    expect(lai.map((k) => k.ketQua)).toEqual(['da_co', 'da_co']);
    expect(await prisma.botLuatThongBao.count({ where: { orgId: ORG_A } })).toBe(2);
    expect((await prisma.botLuatThongBao.findUniqueOrThrow({ where: { id: dau[0].id } })).cheDo).toBe('tat');
    expect(await prisma.botLuatThongBao.count({ where: { orgId: ORG_B } })).toBe(0); // chỉ org được nêu
  });

  it('gieo luật chủ chọn: ảnh chụp thiếu một composer ⇒ từ chối CẢ HAI (không gieo nửa vời); chế độ bat khi nêu rõ', async () => {
    await guiAnh(KHOA_A, { ...ANH, composer: ANH.composer.filter((c) => c.id !== 'in_sau_chot') });
    await expect(gieoLuatChuChon(ORG_A, { aiId: 'cli:test' })).rejects.toMatchObject({ status: 400, code: 'COMPOSER_LA' });
    expect(await prisma.botLuatThongBao.count({ where: { orgId: ORG_A } })).toBe(0);
    await guiAnh(KHOA_A);
    await gieoLuatChuChon(ORG_A, { aiId: 'cli:test', cheDo: 'bat' });
    expect((await prisma.botLuatThongBao.findMany({ where: { orgId: ORG_A } })).map((r) => r.cheDo)).toEqual(['bat', 'bat']);
    await expect(gieoLuatChuChon('org-khong-co', { aiId: 'cli:test' })).rejects.toMatchObject({ status: 404 });
  });
});
