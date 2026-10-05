// SPDX-License-Identifier: AGPL-3.0-or-later
// Xưng hô (docs/79 T1) trên Postgres THẬT:
//   • API quản trị: GET /nhan-vien trả `goi` (đã chọn) + GỢI Ý goiGoiY/goiNguon/goiGoiYLyDo từ Contact.gender của MỌI uid
//     (khoá tay thắng Zalo tự điền, mâu thuẫn ⇒ null + lý do, cách ly org, hội thoại nick khác không tính, Contact đã gộp ⇒
//     xét bản chính) — và KHÔNG BAO GIỜ tự ghi `goi`; PUT/POST ghi `goi` + nhật ký trước/sau; giá trị sai ⇒ 400.
//   • Payload công khai /api/public/bot-quyen: nhan_vien[].goi = chủ chọn ?? gợi ý (TỰ ĐỘNG 05/10 — gồm giới tính hồ sơ Zalo
//     bot_quyen_danh_tinh.gioi_tinh, mức thấp nhất), phien_ban đổi theo goi.
//   • GET /api/public/nguoi-zalo/goi: khoá (401/403 khoá riêng), org lấy từ khoá, CHỈ trả khi khoá tay, không lộ gì khác.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import { registerBotQuyenRoutes } from '../src/modules/bot-quyen/bot-quyen-routes.js';
import { botQuyenPublicRoutes } from '../src/modules/bot-quyen/bot-quyen-public-routes.js';
import { botNguoiZaloPublicRoutes } from '../src/modules/bot-quyen/bot-nguoi-zalo-routes.js';

const ORG_A = 'test-bqg-org-a';
const ORG_B = 'test-bqg-org-b';
const OWNER = 'test-bqg-owner';
const OWNER_B = 'test-bqg-owner-b';
const NICK_A = 'test-bqg-nick-a';
const NICK_A2 = 'test-bqg-nick-a2';
const NICK_B = 'test-bqg-nick-b';
const UID_NICK_A = 'tbqgnicka';
const UID_NICK_A2 = 'tbqgnicka2';
const UID_NICK_B = 'tbqgnickb';
const KHOA_A = 'test-bqg-khoa-a';
const KHOA_B = 'test-bqg-khoa-b';
const KHOA_RIENG_B = 'test-bqg-khoa-rieng-b';
const BASE = '/api/v1/bot-quyen';

async function donDep() {
  const orgs = [ORG_A, ORG_B];
  await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.botNhanVien.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.botQuyenDanhTinh.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.conversation.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.contact.updateMany({ where: { orgId: { in: orgs } }, data: { mergedInto: null } });
  await prisma.contact.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.zaloAccount.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.appSetting.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.user.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
}

let app: FastifyInstance;

function token(userId: string): string {
  const orgId = userId === OWNER_B ? ORG_B : ORG_A;
  return app.jwt.sign({ id: userId, email: `${userId}@x.com`, role: 'owner', orgId, typ: 'access' });
}

async function goi(method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown, userId = OWNER) {
  return app.inject({
    method, url: `${BASE}${url}`, headers: { authorization: `Bearer ${token(userId)}` },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

async function congKhai(khoa: string) {
  return app.inject({ method: 'GET', url: '/api/public/bot-quyen', headers: { 'x-api-key': khoa } });
}

async function hoiGoi(khoa: string | null, q: Record<string, string>) {
  const qs = new URLSearchParams(q).toString();
  return app.inject({ method: 'GET', url: `/api/public/nguoi-zalo/goi?${qs}`, headers: khoa ? { 'x-api-key': khoa } : {} });
}

/** NV + mọi uid (uid → nick). */
async function taoNv(orgId: string, id: string, tenGoi: string, uids: Array<[string, string | null]>) {
  await prisma.botNhanVien.create({ data: { id, orgId, zaloUid: uids[0][0], tenGoi, vai: 'sales', trangThai: 'hoat_dong' } });
  await prisma.botNhanVienUid.createMany({
    data: uids.map(([zaloUid, zaloAccountId]) => ({ orgId, nhanVienId: id, zaloUid, zaloAccountId, nguon: 'chon' })),
  });
}

let soContact = 0;
/** `xacNhan` = NV đã đổi ô giới tính (dấu gioi_tinh_xac_nhan_luc); genderLocked không dấu = khoá CŨ, không được tin. */
async function taoContact(orgId: string, d: {
  zaloUid?: string; gender?: string | null; genderLocked?: boolean; xacNhan?: boolean; mergedInto?: string; id?: string;
}) {
  const id = d.id ?? `test-bqg-ct-${++soContact}`;
  await prisma.contact.create({
    data: {
      id, orgId, fullName: `KH ${id}`, zaloUid: d.zaloUid ?? null, gender: d.gender ?? null,
      genderLocked: d.genderLocked ?? false, mergedInto: d.mergedInto ?? null,
      gioiTinhXacNhanLuc: d.xacNhan ? new Date() : null, gioiTinhXacNhanBoi: d.xacNhan ? OWNER : null,
    } as never,
  });
  return id;
}

let soHt = 0;
async function taoHoiThoai(orgId: string, nick: string, uid: string, contactId: string) {
  await prisma.conversation.create({
    data: { id: `test-bqg-ht-${++soHt}`, orgId, zaloAccountId: nick, threadType: 'user', externalThreadId: uid, contactId },
  });
}

describeCanDb('bot-quyen — xưng hô (docs/79 T1)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.organization.create({ data: { id: ORG_A, name: 'BQG A' } });
    await prisma.organization.create({ data: { id: ORG_B, name: 'BQG B' } });
    for (const [id, org] of [[OWNER, ORG_A], [OWNER_B, ORG_B]] as const) {
      await prisma.user.create({ data: { id, orgId: org, email: `${id}@x.com`, passwordHash: 'x', fullName: 'Chủ', role: 'owner', isActive: true } });
    }
    await prisma.zaloAccount.create({ data: { id: NICK_A, orgId: ORG_A, ownerUserId: OWNER, zaloUid: UID_NICK_A, displayName: 'Nick HN' } });
    await prisma.zaloAccount.create({ data: { id: NICK_A2, orgId: ORG_A, ownerUserId: OWNER, zaloUid: UID_NICK_A2, displayName: 'Nick HCM' } });
    await prisma.zaloAccount.create({ data: { id: NICK_B, orgId: ORG_B, ownerUserId: OWNER_B, zaloUid: UID_NICK_B, displayName: 'Nick B' } });
    await prisma.appSetting.create({ data: { orgId: ORG_A, settingKey: 'public_api_key', valuePlain: KHOA_A } });
    await prisma.appSetting.create({ data: { orgId: ORG_B, settingKey: 'public_api_key', valuePlain: KHOA_B } });

    // ── Contact (org A) ──
    // Hùng: uid HN (Contact theo zaloUid, Zalo tự điền NAM) + uid HCM (Contact của hội thoại 1-1 trên nick HCM, NV khoá tay NỮ).
    await taoContact(ORG_A, { zaloUid: 'u-hung', gender: 'male' });
    await taoHoiThoai(ORG_A, NICK_A2, 'u-hung2', await taoContact(ORG_A, { gender: 'female', genderLocked: true, xacNhan: true }));
    // Lan: Zalo tự điền NỮ. Một hội thoại ở nick KHÁC (HCM) cùng chuỗi uid trỏ Contact khoá NAM — uid của Lan là theo nick HN
    // nên hội thoại đó KHÔNG được tính.
    await taoContact(ORG_A, { zaloUid: 'u-lan', gender: 'female' });
    await taoHoiThoai(ORG_A, NICK_A2, 'u-lan', await taoContact(ORG_A, { gender: 'male', genderLocked: true, xacNhan: true }));
    // Minh: hai giá trị khoá tay mâu thuẫn.
    await taoContact(ORG_A, { zaloUid: 'u-minh', gender: 'male', genderLocked: true, xacNhan: true });
    await taoHoiThoai(ORG_A, NICK_A, 'u-minh', await taoContact(ORG_A, { gender: 'female', genderLocked: true, xacNhan: true }));
    // Quân: bản phụ (đã gộp, chưa có giới) ⇒ bản chính khoá NAM.
    const chinh = await taoContact(ORG_A, { gender: 'male', genderLocked: true, xacNhan: true });
    await taoContact(ORG_A, { zaloUid: 'u-quan', mergedInto: chinh });
    // Tú (org A): không có Contact. Org B có Contact khoá tay cùng chuỗi uid — KHÔNG được lẫn sang.
    await taoContact(ORG_B, { zaloUid: 'u-tu', gender: 'female', genderLocked: true, xacNhan: true });
    // Khách (không phải NV) cho API công khai.
    await taoHoiThoai(ORG_A, NICK_A, 'u-khach-khoa', await taoContact(ORG_A, { gender: 'female', genderLocked: true, xacNhan: true }));
    await taoHoiThoai(ORG_A, NICK_A, 'u-khach-tu', await taoContact(ORG_A, { gender: 'male' }));
    await taoContact(ORG_B, { zaloUid: 'u-khach-b', gender: 'male', genderLocked: true, xacNhan: true });
    // Khoá CŨ không có dấu xác nhận (form lưu cả form từng khoá giới ở MỌI lần bấm Lưu) ⇒ hạng Zalo tự điền, API ⇒ null.
    await taoHoiThoai(ORG_A, NICK_A, 'u-khach-khoa-cu', await taoContact(ORG_A, { gender: 'female', genderLocked: true }));
    await taoContact(ORG_A, { zaloUid: 'u-cu', gender: 'male', genderLocked: true });

    app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: config.jwtSecret });
    await app.register(registerBotQuyenRoutes, { prefix: BASE, docThanhVienZalo: async () => { throw new Error('không gọi Zalo'); } });
    await app.register(botQuyenPublicRoutes);
    await app.register(botNguoiZaloPublicRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await donDep();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.botNhanVien.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.appSetting.deleteMany({ where: { orgId: ORG_B, settingKey: 'bot_ban_do_tin_api_key' } });
    await taoNv(ORG_A, 'test-bqg-nv-hung', 'Hùng', [['u-hung', NICK_A], ['u-hung2', NICK_A2]]);
    await taoNv(ORG_A, 'test-bqg-nv-lan', 'Lan', [['u-lan', NICK_A]]);
    await taoNv(ORG_A, 'test-bqg-nv-minh', 'Minh', [['u-minh', NICK_A]]);
    await taoNv(ORG_A, 'test-bqg-nv-quan', 'Quân', [['u-quan', null]]);
    await taoNv(ORG_A, 'test-bqg-nv-tu', 'Tú', [['u-tu', NICK_A]]);
    await taoNv(ORG_A, 'test-bqg-nv-cu', 'Cũ', [['u-cu', NICK_A]]);
    await prisma.botQuyenDanhTinh.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  });

  /** Dòng danh tính (giới tính hồ sơ Zalo) của uid nhìn từ nick. */
  async function hoSo(orgId: string, nick: string, uid: string, gioiTinh: string | null, nguon = 'zalo_user_info') {
    await prisma.botQuyenDanhTinh.create({
      data: { orgId, zaloAccountId: nick, zaloUid: uid, globalId: `G-${uid}`, nguon, gioiTinh, gioiTinhLuc: new Date() },
    });
  }

  async function dsNv() {
    const res = await goi('GET', '/nhan-vien');
    expect(res.statusCode, res.body).toBe(200);
    return new Map((res.json().nhanVien as Array<Record<string, unknown>>).map((n) => [n.tenGoi as string, n]));
  }

  it('GET /nhan-vien: gợi ý theo bảng (khoá tay thắng, mâu thuẫn, Contact đã gộp, cách ly org, nick khác) — không tự ghi goi', async () => {
    const ds = await dsNv();
    const goiY = (ten: string) => {
      const n = ds.get(ten)!;
      return { goi: n.goi, goiGoiY: n.goiGoiY, goiNguon: n.goiNguon, goiGoiYLyDo: n.goiGoiYLyDo };
    };
    expect(goiY('Hùng')).toEqual({ goi: null, goiGoiY: 'chi', goiNguon: 'khoa_tay', goiGoiYLyDo: null });
    expect(goiY('Lan')).toEqual({ goi: null, goiGoiY: 'chi', goiNguon: 'zalo_tu_dien', goiGoiYLyDo: null });
    expect(goiY('Minh')).toEqual({ goi: null, goiGoiY: null, goiNguon: null, goiGoiYLyDo: 'mau_thuan_khoa_tay' });
    expect(goiY('Quân')).toEqual({ goi: null, goiGoiY: 'anh', goiNguon: 'khoa_tay', goiGoiYLyDo: null });
    expect(goiY('Tú')).toEqual({ goi: null, goiGoiY: null, goiNguon: null, goiGoiYLyDo: 'chua_co_gioi' });
    // Khoá cũ không dấu xác nhận ⇒ chỉ là gợi ý hạng Zalo tự điền (KHÔNG vào "Áp gợi ý đã xác nhận").
    expect(goiY('Cũ')).toEqual({ goi: null, goiGoiY: 'anh', goiNguon: 'zalo_tu_dien', goiGoiYLyDo: null });
    // Đọc KHÔNG ghi: cột goi vẫn null, không có dòng nhật ký.
    expect(await prisma.botNhanVien.count({ where: { orgId: ORG_A, goi: { not: null } } })).toBe(0);
    expect(await prisma.botQuyenNhatKy.count({ where: { orgId: ORG_A, doiTuong: 'nhan_vien' } })).toBe(0);
  });

  it('PUT goi: ghi + nhật ký trước/sau; gửi lại y hệt ⇒ không đổi, không ghi; bỏ chọn (null) ⇒ ghi; sai giá trị ⇒ 400', async () => {
    const id = 'test-bqg-nv-hung';
    const r1 = await goi('PUT', `/nhan-vien/${id}`, { goi: 'chi' });
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r1.json()).toMatchObject({ doi: true, nhanVien: { goi: 'chi', goiGoiY: 'chi', goiNguon: 'khoa_tay' } });
    expect((await prisma.botNhanVien.findUniqueOrThrow({ where: { id } })).goi).toBe('chi');
    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG_A, doiTuongId: id } });
    expect(nk).toHaveLength(1);
    expect(nk[0].aiId).toBe(OWNER);
    expect(nk[0].truoc).not.toHaveProperty('goi');
    expect(nk[0].sau).toMatchObject({ goi: 'chi', tenGoi: 'Hùng' });

    const r2 = await goi('PUT', `/nhan-vien/${id}`, { goi: 'chi' });
    expect(r2.json().doi).toBe(false);
    expect(await prisma.botQuyenNhatKy.count({ where: { orgId: ORG_A, doiTuongId: id } })).toBe(1);

    const r3 = await goi('PUT', `/nhan-vien/${id}`, { goi: null, lyDo: 'chưa chắc' });
    expect(r3.json()).toMatchObject({ doi: true, nhanVien: { goi: null } });
    const cuoi = await prisma.botQuyenNhatKy.findFirstOrThrow({ where: { orgId: ORG_A, doiTuongId: id }, orderBy: { luc: 'desc' } });
    expect(cuoi.truoc).toMatchObject({ goi: 'chi' });
    expect(cuoi.sau).not.toHaveProperty('goi');
    expect(cuoi.lyDo).toBe('chưa chắc');

    for (const sai of ['chị', 'Anh', 'ong', 1, true]) {
      const r = await goi('PUT', `/nhan-vien/${id}`, { goi: sai });
      expect(r.statusCode).toBe(400);
      expect(r.json().code).toBe('GOI_KHONG_HOP_LE');
    }
    expect((await prisma.botNhanVien.findUniqueOrThrow({ where: { id } })).goi).toBeNull();
  });

  it('POST /nhan-vien nhận goi (vào nhật ký tạo); org khác không sửa được NV của org A', async () => {
    const r = await goi('POST', '/nhan-vien', { zaloUid: 'u-moi', tenGoi: 'Mới', vai: 'sales', goi: 'anh' });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().nhanVien.goi).toBe('anh');
    const nk = await prisma.botQuyenNhatKy.findFirstOrThrow({ where: { orgId: ORG_A, doiTuongId: r.json().nhanVien.id } });
    expect(nk.sau).toMatchObject({ goi: 'anh' });
    const cheo = await goi('PUT', '/nhan-vien/test-bqg-nv-lan', { goi: 'anh' }, OWNER_B);
    expect(cheo.statusCode).toBe(404);
    expect((await prisma.botNhanVien.findUniqueOrThrow({ where: { id: 'test-bqg-nv-lan' } })).goi).toBeNull();
  });

  it('payload công khai: goi = chủ chọn ?? gợi ý (TỰ ĐỘNG); chủ chọn tay ĐÈ; phien_ban đổi theo goi; nguồn KHÔNG vào payload', async () => {
    const v1 = (await congKhai(KHOA_A)).json();
    const cua = (v: { nhan_vien: Array<{ ten_goi: string; goi: string | null }> }, ten: string) => v.nhan_vien.find((n) => n.ten_goi === ten)!;
    const hung = cua(v1, 'Hùng');
    expect(Object.keys(hung)).toEqual(['zalo_uid', 'ten_goi', 'vai', 'trang_thai', 'goi', 'uids']);
    // Chưa ai chọn tay ⇒ bot nhận GỢI Ý: Hùng chị (khoá tay), Lan chị (Zalo tự điền), Quân anh; Minh mâu thuẫn / Tú chưa có ⇒ null.
    expect(hung.goi).toBe('chi');
    expect(cua(v1, 'Lan').goi).toBe('chi');
    expect(cua(v1, 'Quân').goi).toBe('anh');
    expect(cua(v1, 'Minh').goi).toBeNull();
    expect(cua(v1, 'Tú').goi).toBeNull();
    expect(JSON.stringify(v1)).not.toMatch(/goiGoiY|goi_goi_y|khoa_tay|zalo_tu_dien|zalo_ho_so/);
    // Không ghi gì vào ô chọn tay.
    expect(await prisma.botNhanVien.count({ where: { orgId: ORG_A, goi: { not: null } } })).toBe(0);
    // Chủ chọn tay ĐÈ gợi ý.
    await goi('PUT', '/nhan-vien/test-bqg-nv-hung', { goi: 'anh' });
    const v2 = (await congKhai(KHOA_A)).json();
    expect(cua(v2, 'Hùng').goi).toBe('anh');
    expect(v2.phien_ban).not.toBe(v1.phien_ban);
    expect((await congKhai(KHOA_A)).json().phien_ban).toBe(v2.phien_ban);
    // Về "Tự động" ⇒ lại theo gợi ý, phien_ban về đúng bản cũ.
    await goi('PUT', '/nhan-vien/test-bqg-nv-hung', { goi: null });
    expect((await congKhai(KHOA_A)).json().phien_ban).toBe(v1.phien_ban);
  });

  it('giới tính HỒ SƠ ZALO (bot_quyen_danh_tinh): NV không có Contact ⇒ gợi ý zalo_ho_so + payload; Contact thắng; mâu thuẫn ⇒ null; cách ly org', async () => {
    // Tú: không Contact ở org A — hồ sơ Zalo nam ở HAI nick (đồng ý) ⇒ anh.
    await hoSo(ORG_A, NICK_A, 'u-tu', 'male');
    await hoSo(ORG_A, NICK_A2, 'u-tu', 'male');
    // Lan: Contact Zalo tự điền nữ THẮNG hồ sơ nam.
    await hoSo(ORG_A, NICK_A, 'u-lan', 'male');
    // Cũ: hồ sơ nguồn KHÔNG tin được (zalo_api bản cũ) ⇒ bỏ qua — vẫn theo Contact.
    await hoSo(ORG_A, NICK_A2, 'u-cu', 'female', 'zalo_api');
    // Org B có dòng hồ sơ cùng chuỗi uid của Minh — KHÔNG lẫn sang org A.
    await hoSo(ORG_B, NICK_B, 'u-minh', 'female');
    const ds = await dsNv();
    const goiY = (ten: string) => {
      const n = ds.get(ten)!;
      return { goi: n.goi, goiGoiY: n.goiGoiY, goiNguon: n.goiNguon, goiGoiYLyDo: n.goiGoiYLyDo };
    };
    expect(goiY('Tú')).toEqual({ goi: null, goiGoiY: 'anh', goiNguon: 'zalo_ho_so', goiGoiYLyDo: null });
    expect(goiY('Lan')).toEqual({ goi: null, goiGoiY: 'chi', goiNguon: 'zalo_tu_dien', goiGoiYLyDo: null });
    expect(goiY('Cũ')).toEqual({ goi: null, goiGoiY: 'anh', goiNguon: 'zalo_tu_dien', goiGoiYLyDo: null });
    expect(goiY('Minh')).toEqual({ goi: null, goiGoiY: null, goiNguon: null, goiGoiYLyDo: 'mau_thuan_khoa_tay' });
    const v = (await congKhai(KHOA_A)).json();
    expect(v.nhan_vien.find((n: { ten_goi: string }) => n.ten_goi === 'Tú').goi).toBe('anh');

    // Hồ sơ hai nick MÂU THUẪN ⇒ không gợi ý (gọi sai giới tệ hơn).
    await prisma.botQuyenDanhTinh.updateMany({ where: { orgId: ORG_A, zaloAccountId: NICK_A2, zaloUid: 'u-tu' }, data: { gioiTinh: 'female' } });
    expect((await dsNv()).get('Tú')).toMatchObject({ goiGoiY: null, goiNguon: null, goiGoiYLyDo: 'mau_thuan_ho_so' });
    expect((await congKhai(KHOA_A)).json().nhan_vien.find((n: { ten_goi: string }) => n.ten_goi === 'Tú').goi).toBeNull();
  });

  it('GET /api/public/nguoi-zalo/goi: khoá + tham số', async () => {
    expect((await hoiGoi(null, { nick_uid: UID_NICK_A, uid: 'u-khach-khoa' })).statusCode).toBe(401);
    expect((await hoiGoi('sai', { nick_uid: UID_NICK_A, uid: 'u-khach-khoa' })).statusCode).toBe(401);
    for (const q of [{ uid: 'u-khach-khoa' }, { nick_uid: UID_NICK_A }, { nick_uid: UID_NICK_A, uid: '' },
      { nick_uid: UID_NICK_A, uid: 'x'.repeat(65) }, { nick_uid: "a' or 1=1", uid: 'u1' }]) {
      const r = await hoiGoi(KHOA_A, q as Record<string, string>);
      expect(r.statusCode, JSON.stringify(q)).toBe(400);
      expect(r.json().code).toBe('THAM_SO_KHONG_HOP_LE');
    }
  });

  it('GET /api/public/nguoi-zalo/goi: giới theo Zalo (chủ chốt 05/10) — xác nhận > Zalo tự điền > hồ sơ; không có / nick lạ / mâu thuẫn ⇒ null; không lộ gì khác', async () => {
    const r = await hoiGoi(KHOA_A, { nick_uid: UID_NICK_A, uid: 'u-khach-khoa' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ goi: 'chi', nguon: 'khoa_tay' });
    expect(Object.keys(r.json())).toEqual(['goi', 'nguon']);
    expect((await hoiGoi(KHOA_A, { nick_uid: UID_NICK_A, uid: 'u-khach-tu' })).json()).toEqual({ goi: 'anh', nguon: 'zalo_tu_dien' });
    // Khoá CŨ không có dấu xác nhận ⇒ null.
    expect((await hoiGoi(KHOA_A, { nick_uid: UID_NICK_A, uid: 'u-khach-khoa-cu' })).json()).toEqual({ goi: 'chi', nguon: 'zalo_tu_dien' });
    expect((await hoiGoi(KHOA_A, { nick_uid: UID_NICK_A, uid: 'u-khong-co' })).json()).toEqual({ goi: null, nguon: null });
    expect((await hoiGoi(KHOA_A, { nick_uid: 'nick-la', uid: 'u-khach-khoa' })).json()).toEqual({ goi: null, nguon: null });
    // Hội thoại của uid nằm ở nick HN — hỏi theo nick HCM thì không thấy Contact đó.
    expect((await hoiGoi(KHOA_A, { nick_uid: UID_NICK_A2, uid: 'u-khach-khoa' })).json()).toEqual({ goi: null, nguon: null });
    // NV: cùng luật (Hùng ở nick HCM khoá NỮ; Lan chỉ Zalo tự điền).
    expect((await hoiGoi(KHOA_A, { nick_uid: UID_NICK_A2, uid: 'u-hung2' })).json()).toEqual({ goi: 'chi', nguon: 'khoa_tay' });
    expect((await hoiGoi(KHOA_A, { nick_uid: UID_NICK_A, uid: 'u-lan' })).json()).toEqual({ goi: 'chi', nguon: 'zalo_tu_dien' });
    expect((await hoiGoi(KHOA_A, { nick_uid: UID_NICK_A, uid: 'u-minh' })).json()).toEqual({ goi: null, nguon: null });
  });

  it('GET /api/public/nguoi-zalo/goi: cách ly org (org lấy từ khoá) + khoá riêng của bot', async () => {
    // Khoá org A hỏi nick + uid của org B ⇒ null (nick lạ với org A).
    expect((await hoiGoi(KHOA_A, { nick_uid: UID_NICK_B, uid: 'u-khach-b' })).json()).toEqual({ goi: null, nguon: null });
    // Khoá org B hỏi nick + uid khách của org A ⇒ null.
    expect((await hoiGoi(KHOA_B, { nick_uid: UID_NICK_A, uid: 'u-khach-khoa' })).json()).toEqual({ goi: null, nguon: null });
    // Khoá org B, Contact org B (theo zaloUid) ⇒ thấy.
    expect((await hoiGoi(KHOA_B, { nick_uid: UID_NICK_B, uid: 'u-khach-b' })).json()).toEqual({ goi: 'anh', nguon: 'khoa_tay' });
    // Org B đặt khoá riêng ⇒ khoá chung 403, khoá riêng 200.
    await prisma.appSetting.create({ data: { orgId: ORG_B, settingKey: 'bot_ban_do_tin_api_key', valuePlain: KHOA_RIENG_B } });
    const r = await hoiGoi(KHOA_B, { nick_uid: UID_NICK_B, uid: 'u-khach-b' });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('CAN_KHOA_RIENG_BOT');
    expect((await hoiGoi(KHOA_RIENG_B, { nick_uid: UID_NICK_B, uid: 'u-khach-b' })).json()).toEqual({ goi: 'anh', nguon: 'khoa_tay' });
  });
});
