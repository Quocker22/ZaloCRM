// SPDX-License-Identifier: AGPL-3.0-or-later
// Cho khách (docs/79 T5) trên Postgres THẬT:
//   • quản trị /api/v1/bot-quyen/cho-khach/*: 401 không token, 403 NV thường (mọi route), cách ly org;
//   • tài liệu = KHO TRI THỨC CRM (knowledge_documents/chunks — sửa 02/10 tối), băm §3b CRM tự tính từ đoạn;
//   • duyệt tài liệu hàng loạt (chỉ id có trong kho), bỏ duyệt luôn được, nhật ký MỖI mục; toàn văn cho người duyệt;
//   • duyệt tài liệu gắn băm NỘI DUNG: kho nạp lại cùng id mà nội dung đổi ⇒ "doi_sau_duyet", GET công khai không trả nữa;
//     duyệt bằng băm cũ ⇒ 409 TAI_LIEU_DA_DOI; tài liệu rỗng (băm null) không duyệt được;
//   • (tìm — POST /cho-khach/tim + /tai-lieu-ky-thuat/tim: tests/bot-cho-khach-tim-db.test.ts);
//   • duyệt mô tả gắn băm: bot đẩy mô tả mới ⇒ "doi_sau_duyet", băm trong GET công khai vẫn là băm CŨ (bot so ⇒ không dùng);
//     duyệt bằng băm cũ ⇒ 409 MO_TA_DA_DOI; duyệt lại bằng băm mới ⇒ hiệu lực lại;
//   • công khai: POST danh mục (kiểm hình, băm lệch ⇒ 400, giữ bản cũ), GET duyệt (phien_ban ổn định/đổi đúng lúc, tài liệu
//     đã rời danh mục không trả), khoá riêng của bot.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import { registerBotQuyenRoutes } from '../src/modules/bot-quyen/bot-quyen-routes.js';
import { botChoKhachPublicRoutes } from '../src/modules/bot-quyen/bot-cho-khach-routes.js';
import { bamMoTa, bamNoiDungTaiLieu } from '../src/modules/bot-quyen/bot-cho-khach-hop-dong.js';
import { loaiTruTaiLieuNoiBo } from '../src/modules/bot-quyen/bot-cho-khach-service.js';

const ORG_A = 'test-bck-org-a';
const ORG_B = 'test-bck-org-b';
const OWNER = 'test-bck-owner';
const ADMIN = 'test-bck-admin';
const MEMBER = 'test-bck-member';
const OWNER_B = 'test-bck-owner-b';
const KHOA_A = 'test-bck-khoa-a';
const KHOA_B = 'test-bck-khoa-b';
const KHOA_BOT_A = 'test-bck-khoa-bot-a';
const BASE = '/api/v1/bot-quyen/cho-khach';
const ORGS = [ORG_A, ORG_B];

const MO_1 = 'Điện áp 12V\nIP65';
const MO_1_SUA = 'Điện áp 24V\nIP65';
const bamTl = (tieu_de: string) => bamNoiDungTaiLieu([`Nội dung ${tieu_de}`, 'Đoạn hai'])!;
const tl = (id: string, tieu_de: string, them: Record<string, unknown> = {}) => ({
  id, tieu_de, loai: 'pdf', nguon: 'file-zalo', so_doan: 3, cap_nhat_luc: '2026-09-30T02:00:00.000Z',
  mau_noi_dung: `Nội dung ${tieu_de}`, noi_dung_bam: bamTl(tieu_de), ...them,
});
const TEN_TL: Record<string, string> = { 'doc-1': 'Datasheet P10', 'doc-2': 'Bảng giá nội bộ', 'doc-3': 'Hướng dẫn lắp' };
/** Thân duyệt tài liệu với băm người duyệt ĐANG NHÌN (danh mục mặc định). */
const mucTl = (...ids: string[]) => ({ taiLieu: ids.map((id) => ({ id, noiDungBam: TEN_TL[id] ? bamTl(TEN_TL[id]) : 'e'.repeat(64) })) });

/** Nạp (lại) một tài liệu vào KHO TRI THỨC CRM của org — thay mọi đoạn. */
async function napKho(orgId: string, id: string, tieuDe: string, doan: string[]) {
  await prisma.knowledgeChunk.deleteMany({ where: { documentId: id } });
  await prisma.knowledgeDocument.upsert({
    where: { id }, create: { id, orgId, title: tieuDe, source: 'datasheet-pdf', content: doan.join('\n\n') },
    update: { title: tieuDe, content: doan.join('\n\n') },
  });
  if (doan.length > 0) {
    await prisma.knowledgeChunk.createMany({
      data: doan.map((content, ord) => ({
        orgId, documentId: id, ord, content, embedding: [1, 0, 0], embedProvider: 'test', embedModel: 'test', embedDim: 3,
      })),
    });
  }
}
/** Ba tài liệu mặc định của org A — đoạn khớp `bamTl`. */
async function napKhoMacDinh(orgId = ORG_A) {
  for (const [id, ten] of Object.entries(TEN_TL)) await napKho(orgId, id, ten, [`Nội dung ${ten}`, 'Đoạn hai']);
}
const sp = (product_id: number, mo: string | null, them: Record<string, unknown> = {}) => ({
  product_id, ma: `SP${product_id}`, ten: `Sản phẩm ${product_id}`, mo_ta_ban: mo, mo_ta_bam: bamMoTa(mo), ...them,
});
function danhMuc(o: { phien_ban?: string; tai_lieu?: unknown[]; san_pham?: unknown[] } = {}) {
  return {
    phien_ban: o.phien_ban ?? 'dm-1',
    tai_lieu: o.tai_lieu ?? [tl('doc-1', 'Datasheet P10'), tl('doc-2', 'Bảng giá nội bộ'), tl('doc-3', 'Hướng dẫn lắp')],
    san_pham: o.san_pham ?? [sp(11, MO_1), sp(12, 'Chống nước IP67'), sp(13, null)],
  };
}

async function donDep() {
  await prisma.knowledgeChunk.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.knowledgeDocument.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.botTaiLieuChoKhach.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.botTaiLieuLoaiTru.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.botMoTaDuyet.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.botChoKhachDanhMuc.deleteMany({ where: { orgId: { in: ORGS } } });
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

async function goi(method: 'GET' | 'POST', url: string, userId: string | null, payload?: unknown) {
  return admin.inject({
    method, url: `${BASE}${url}`,
    headers: userId ? { authorization: `Bearer ${token(userId)}` } : {},
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

async function guiDanhMuc(khoa: string, body: unknown = danhMuc()) {
  return pub.inject({ method: 'POST', url: '/api/public/cho-khach/danh-muc', headers: { 'x-api-key': khoa }, payload: body as object });
}

async function docDuyet(khoa: string) {
  const r = await pub.inject({ method: 'GET', url: '/api/public/cho-khach/duyet', headers: { 'x-api-key': khoa } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as {
    phien_ban: string; danh_muc_phien_ban: string | null; tai_lieu_cho_khach: Array<{ id: string; noi_dung_bam: string }>;
    mo_ta_da_duyet: Array<{ product_id: number; mo_ta_bam: string }>;
  };
}

async function idCongKhai(khoa: string) {
  return (await docDuyet(khoa)).tai_lieu_cho_khach.map((t) => t.id);
}

async function nhatKy(doiTuong: string, orgId = ORG_A) {
  return prisma.botQuyenNhatKy.findMany({ where: { orgId, doiTuong }, orderBy: [{ luc: 'asc' }, { doiTuongId: 'asc' }] });
}

describeCanDb('bot-cho-khach — duyệt tài liệu RAG + mô tả SP cho khách (DB)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.organization.create({ data: { id: ORG_A, name: 'BCK A' } });
    await prisma.organization.create({ data: { id: ORG_B, name: 'BCK B' } });
    const u = (id: string, orgId: string, role: string) =>
      prisma.user.create({ data: { id, orgId, email: `${id}@x.com`, passwordHash: 'x', fullName: `Tên ${id}`, role, isActive: true } });
    await u(OWNER, ORG_A, 'owner');
    await u(ADMIN, ORG_A, 'admin');
    await u(MEMBER, ORG_A, 'member');
    await u(OWNER_B, ORG_B, 'owner');
    await prisma.appSetting.create({ data: { orgId: ORG_A, settingKey: 'public_api_key', valuePlain: KHOA_A } });
    await prisma.appSetting.create({ data: { orgId: ORG_B, settingKey: 'public_api_key', valuePlain: KHOA_B } });
    admin = Fastify({ logger: false });
    await admin.register(fastifyJwt, { secret: config.jwtSecret });
    await admin.register(registerBotQuyenRoutes, { prefix: '/api/v1/bot-quyen' });
    await admin.ready();
    pub = Fastify({ logger: false });
    await pub.register(botChoKhachPublicRoutes);
    await pub.ready();
  });

  afterAll(async () => {
    await admin?.close();
    await pub?.close();
    await donDep();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.knowledgeChunk.deleteMany({ where: { orgId: { in: ORGS } } });
    await prisma.knowledgeDocument.deleteMany({ where: { orgId: { in: ORGS } } });
    await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: { in: ORGS } } });
    await prisma.botTaiLieuChoKhach.deleteMany({ where: { orgId: { in: ORGS } } });
    await prisma.botTaiLieuLoaiTru.deleteMany({ where: { orgId: { in: ORGS } } });
    await prisma.botMoTaDuyet.deleteMany({ where: { orgId: { in: ORGS } } });
    await prisma.botChoKhachDanhMuc.deleteMany({ where: { orgId: { in: ORGS } } });
    await prisma.appSetting.deleteMany({ where: { orgId: ORG_A, settingKey: 'bot_ban_do_tin_api_key' } });
  });

  // ── Quyền vào + cách ly ──────────────────────────────────────────────────────

  it('không token ⇒ 401; NV thường ⇒ 403 ở MỌI route (9/9), không ghi gì', async () => {
    await guiDanhMuc(KHOA_A);
    await napKhoMacDinh();
    expect((await goi('GET', '/tai-lieu', null)).statusCode).toBe(401);
    const cac = [
      await goi('GET', '/tai-lieu', MEMBER),
      await goi('GET', '/tai-lieu/doc-1/toan-van', MEMBER),
      await goi('POST', '/tai-lieu/duyet', MEMBER, mucTl('doc-1')),
      await goi('POST', '/tai-lieu/bo-duyet', MEMBER, { ids: ['doc-1'] }),
      await goi('POST', '/tai-lieu/loai-tru', MEMBER, { ids: ['doc-1'] }),
      await goi('POST', '/tai-lieu/bo-loai-tru', MEMBER, { ids: ['doc-1'] }),
      await goi('GET', '/mo-ta', MEMBER),
      await goi('POST', '/mo-ta/duyet', MEMBER, { sanPham: [{ productId: 11, moTaBam: bamMoTa(MO_1) }] }),
      await goi('POST', '/mo-ta/bo-duyet', MEMBER, { productIds: [11] }),
    ];
    expect(cac.map((r) => r.statusCode)).toEqual([403, 403, 403, 403, 403, 403, 403, 403, 403]);
    expect(await prisma.botTaiLieuLoaiTru.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await prisma.botTaiLieuChoKhach.count({ where: { orgId: ORG_A } })).toBe(0);
    expect(await prisma.botMoTaDuyet.count({ where: { orgId: ORG_A } })).toBe(0);
  });

  it('cách ly org: kho + duyệt của A không thấy/không đụng được từ B (khoá B, owner B)', async () => {
    await guiDanhMuc(KHOA_A);
    await napKhoMacDinh();
    expect((await goi('POST', '/tai-lieu/duyet', OWNER, mucTl('doc-1'))).statusCode).toBe(200);
    // Owner B: kho org B rỗng ⇒ không thấy tài liệu A, duyệt id của A ⇒ 409 (không có trong kho), toàn văn ⇒ 404, bỏ duyệt ⇒ 0.
    const dsB = (await goi('GET', '/tai-lieu', OWNER_B)).json();
    expect(dsB).toMatchObject({ kho: { soTaiLieu: 0 }, taiLieu: [], duyetNgoaiDanhMuc: [] });
    expect((await goi('POST', '/tai-lieu/duyet', OWNER_B, mucTl('doc-1'))).json().code).toBe('KHONG_CO_TRONG_DANH_MUC');
    expect((await goi('GET', '/tai-lieu/doc-1/toan-van', OWNER_B)).statusCode).toBe(404);
    expect((await goi('POST', '/tai-lieu/bo-duyet', OWNER_B, { ids: ['doc-1'] })).json()).toEqual({ doi: 0 });
    expect((await idCongKhai(KHOA_B))).toEqual([]);
    expect((await idCongKhai(KHOA_A))).toEqual(['doc-1']);
  });

  // ── Loại trừ (chủ chốt 02/10 tối: khách dùng MỌI tài liệu TRỪ loại trừ) ─────────

  it('loại trừ hàng loạt: id ngoài kho ⇒ 409 cả lô; lặp ⇒ không đổi; danh sách mang loaiTru/choKhach/deXuatLoaiTru; nhật ký mỗi mục', async () => {
    await napKhoMacDinh();
    const la = await goi('POST', '/tai-lieu/loai-tru', OWNER, { ids: ['doc-2', 'doc-khong-co'] });
    expect([la.statusCode, la.json().code]).toEqual([409, 'KHONG_CO_TRONG_DANH_MUC']);
    expect(await prisma.botTaiLieuLoaiTru.count({ where: { orgId: ORG_A } })).toBe(0);

    const ds0 = (await goi('GET', '/tai-lieu', OWNER)).json();
    expect(ds0.taiLieu.find((t: { id: string }) => t.id === 'doc-2')).toMatchObject({ choKhach: true, loaiTru: false, deXuatLoaiTru: true });

    expect((await goi('POST', '/tai-lieu/loai-tru', OWNER, { ids: ['doc-2', 'doc-2'], lyDo: 'bảng giá nội bộ' })).json()).toEqual({ doi: 1 });
    expect((await goi('POST', '/tai-lieu/loai-tru', ADMIN, { ids: ['doc-2'] })).json()).toEqual({ doi: 0 });
    const ds = (await goi('GET', '/tai-lieu', ADMIN)).json();
    expect(ds.taiLieu.find((t: { id: string }) => t.id === 'doc-2')).toMatchObject({
      choKhach: false, loaiTru: true, deXuatLoaiTru: false, loaiTruLyDo: 'bảng giá nội bộ', loaiTruBoi: { id: OWNER, fullName: `Tên ${OWNER}` },
    });
    expect(ds.taiLieu.find((t: { id: string }) => t.id === 'doc-1')).toMatchObject({ choKhach: true, loaiTru: false, deXuatLoaiTru: false });
    const nk = await nhatKy('tai_lieu_loai_tru');
    expect(nk.map((r) => [r.doiTuongId, r.aiId, r.lyDo, r.truoc, r.sau])).toEqual([[
      'doc-2', OWNER, 'bảng giá nội bộ', { tieuDe: 'Bảng giá nội bộ', choKhach: true }, { tieuDe: 'Bảng giá nội bộ', choKhach: false },
    ]]);

    // owner B không đụng được loại trừ của A
    expect((await goi('POST', '/tai-lieu/bo-loai-tru', OWNER_B, { ids: ['doc-2'] })).json()).toEqual({ doi: 0 });
    expect((await goi('POST', '/tai-lieu/loai-tru', OWNER_B, { ids: ['doc-1'] })).json().code).toBe('KHONG_CO_TRONG_DANH_MUC');

    expect((await goi('POST', '/tai-lieu/bo-loai-tru', ADMIN, { ids: ['doc-2', 'doc-1'], lyDo: 'xem lại' })).json()).toEqual({ doi: 1 });
    expect((await goi('GET', '/tai-lieu', ADMIN)).json().taiLieu.find((t: { id: string }) => t.id === 'doc-2'))
      .toMatchObject({ choKhach: true, loaiTru: false });
    expect((await nhatKy('tai_lieu_loai_tru')).length).toBe(2);
    expect((await goi('POST', '/tai-lieu/loai-tru', OWNER, { ids: [] })).statusCode).toBe(400);
  });

  it('loaiTruTaiLieuNoiBo (script chuyển đổi): ap=false chỉ liệt kê; ap=true loại tài liệu có dấu hiệu nội bộ; chạy lặp không đổi', async () => {
    await napKhoMacDinh();
    const xem = await loaiTruTaiLieuNoiBo(ORG_A, 'cli:test', false);
    expect(xem.doi).toBe(0);
    expect(xem.deXuat.map((t) => t.id)).toEqual(['doc-2']);
    expect(await prisma.botTaiLieuLoaiTru.count({ where: { orgId: ORG_A } })).toBe(0);
    expect((await loaiTruTaiLieuNoiBo(ORG_A, 'cli:test', true)).doi).toBe(1);
    expect((await loaiTruTaiLieuNoiBo(ORG_A, 'cli:test', true)).doi).toBe(0);
    const r = await prisma.botTaiLieuLoaiTru.findMany({ where: { orgId: ORG_A } });
    expect(r.map((x) => [x.taiLieuId, x.boi])).toEqual([['doc-2', 'cli:test']]);
    expect((await nhatKy('tai_lieu_loai_tru')).map((x) => x.aiId)).toEqual(['cli:test']);
  });

  it('loaiTruTaiLieuNoiBo: 501 tài liệu nội bộ ⇒ chia lô ≤ 500, loại đủ 501', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `noi-bo-${String(i).padStart(3, '0')}`);
    await prisma.knowledgeDocument.createMany({ data: ids.map((id) => ({ id, orgId: ORG_A, title: `Bảng giá ${id}`, source: 'x', content: 'x' })) });
    await prisma.knowledgeChunk.createMany({
      data: ids.map((id) => ({ orgId: ORG_A, documentId: id, ord: 0, content: 'Bảng giá đại lý', embedding: [1, 0, 0], embedProvider: 't', embedModel: 't', embedDim: 3 })),
    });
    expect((await loaiTruTaiLieuNoiBo(ORG_A, 'cli:test', true)).doi).toBe(501);
    expect(await prisma.botTaiLieuLoaiTru.count({ where: { orgId: ORG_A } })).toBe(501);
  });

  // ── Công khai: danh mục ─────────────────────────────────────────────────────

  it('POST danh mục: sai hình / băm lệch ⇒ 400 và GIỮ bản cũ; khoá sai ⇒ 401', async () => {
    expect((await guiDanhMuc(KHOA_A)).json()).toEqual({ ok: true, phien_ban: 'dm-1', so_tai_lieu: 3, so_san_pham: 3 });
    const lech = await guiDanhMuc(KHOA_A, danhMuc({ phien_ban: 'dm-2', san_pham: [sp(11, MO_1, { mo_ta_bam: bamMoTa(MO_1_SUA) })] }));
    expect([lech.statusCode, lech.json().code]).toEqual([400, 'MO_TA_BAM_LECH']);
    const hinh = await guiDanhMuc(KHOA_A, { phien_ban: 'dm-3', tai_lieu: 'x', san_pham: [] });
    expect([hinh.statusCode, hinh.json().code]).toEqual([400, 'DANH_MUC_KHONG_HOP_LE']);
    const dm = await prisma.botChoKhachDanhMuc.findUniqueOrThrow({ where: { orgId: ORG_A } });
    expect(dm.phienBan).toBe('dm-1');
    expect((await guiDanhMuc('khoa-sai')).statusCode).toBe(401);
  });

  it('khoá RIÊNG của bot: org đã đặt ⇒ khoá chung bị 403 CAN_KHOA_RIENG_BOT ở cả POST danh mục lẫn GET duyệt', async () => {
    await prisma.appSetting.create({ data: { orgId: ORG_A, settingKey: 'bot_ban_do_tin_api_key', valuePlain: KHOA_BOT_A } });
    const p = await guiDanhMuc(KHOA_A);
    expect([p.statusCode, p.json().code]).toEqual([403, 'CAN_KHOA_RIENG_BOT']);
    const g = await pub.inject({ method: 'GET', url: '/api/public/cho-khach/duyet', headers: { 'x-api-key': KHOA_A } });
    expect([g.statusCode, g.json().code]).toEqual([403, 'CAN_KHOA_RIENG_BOT']);
    expect((await guiDanhMuc(KHOA_BOT_A)).statusCode).toBe(200);
    expect((await docDuyet(KHOA_BOT_A)).danh_muc_phien_ban).toBe('dm-1');
  });

  it('nhật ký danh mục: lần đầu + khi tập tài liệu/băm đổi; gửi lại y hệt ⇒ không ghi', async () => {
    await guiDanhMuc(KHOA_A);
    await guiDanhMuc(KHOA_A, danhMuc({ phien_ban: 'dm-1b' }));
    await guiDanhMuc(KHOA_A, danhMuc({
      phien_ban: 'dm-2', tai_lieu: [tl('doc-1', 'Datasheet P10'), tl('doc-4', 'Mới')], san_pham: [sp(11, MO_1_SUA), sp(12, 'Chống nước IP67'), sp(13, null)],
    }));
    const nk = await nhatKy('danh_muc_cho_khach');
    expect(nk).toHaveLength(2);
    expect(nk[0].aiId).toMatch(/^api_key:/);
    expect(nk[1].sau).toMatchObject({ phienBan: 'dm-2', themTaiLieu: ['doc-4'], boTaiLieu: ['doc-2', 'doc-3'], moTaDoi: [11], soMoTaDoi: 1 });
  });

  it('phien_ban KHÔNG đổi ⇒ CRM không ghi lại (không viết lại tới 8 MB jsonb), luc giữ nguyên; vẫn kiểm hình (400 khi sai)', async () => {
    await guiDanhMuc(KHOA_A);
    const truoc = await prisma.botChoKhachDanhMuc.findUniqueOrThrow({ where: { orgId: ORG_A } });
    // Cùng phien_ban nhưng (giả sử bot sai) nội dung khác ⇒ 200, KHÔNG ghi: hợp đồng §2 — đổi nội dung PHẢI đổi phien_ban.
    const r = await guiDanhMuc(KHOA_A, danhMuc({ tai_lieu: [tl('doc-1', 'Datasheet P10')] }));
    expect(r.json()).toEqual({ ok: true, phien_ban: 'dm-1', so_tai_lieu: 1, so_san_pham: 3 });
    const sau = await prisma.botChoKhachDanhMuc.findUniqueOrThrow({ where: { orgId: ORG_A } });
    expect(sau.luc.getTime()).toBe(truoc.luc.getTime());
    expect((sau.taiLieu as unknown[]).length).toBe(3);
    expect(await nhatKy('danh_muc_cho_khach')).toHaveLength(1);
    // Sai hình vẫn 400 dù phien_ban trùng.
    expect((await guiDanhMuc(KHOA_A, { phien_ban: 'dm-1', tai_lieu: 'x', san_pham: [] })).statusCode).toBe(400);
  });

  // ── Tài liệu ────────────────────────────────────────────────────────────────

  it('kho rỗng ⇒ duyệt 409 KHONG_CO_TRONG_DANH_MUC; GET duyệt công khai rỗng (mặc định đóng)', async () => {
    const r = await goi('POST', '/tai-lieu/duyet', OWNER, mucTl('doc-1'));
    expect([r.statusCode, r.json().code]).toEqual([409, 'KHONG_CO_TRONG_DANH_MUC']);
    const d = await docDuyet(KHOA_A);
    expect(d).toMatchObject({ danh_muc_phien_ban: null, tai_lieu_cho_khach: [], mo_ta_da_duyet: [] });
  });

  it('duyệt hàng loạt: chỉ id có trong KHO (lô có id lạ ⇒ 409 cả lô, không ghi gì); trùng ⇒ không ghi lại; nhật ký MỖI mục', async () => {
    await napKhoMacDinh();
    const la = await goi('POST', '/tai-lieu/duyet', OWNER, mucTl('doc-1', 'doc-khong-co'));
    expect([la.statusCode, la.json().code]).toEqual([409, 'KHONG_CO_TRONG_DANH_MUC']);
    expect(await prisma.botTaiLieuChoKhach.count({ where: { orgId: ORG_A } })).toBe(0);

    expect((await goi('POST', '/tai-lieu/duyet', OWNER, { ...mucTl('doc-1', 'doc-3', 'doc-1'), lyDo: 'datasheet công khai' })).json())
      .toEqual({ doi: 2 });
    expect((await goi('POST', '/tai-lieu/duyet', ADMIN, mucTl('doc-1', 'doc-3'))).json()).toEqual({ doi: 0 });
    const nk = await nhatKy('tai_lieu_cho_khach');
    expect(nk.map((r) => [r.doiTuongId, r.aiId, r.lyDo])).toEqual([
      ['doc-1', OWNER, 'datasheet công khai'], ['doc-3', OWNER, 'datasheet công khai'],
    ]);
    expect(nk[0].truoc).toEqual({ tieuDe: 'Datasheet P10', choKhach: false });
    expect(nk[0].sau).toEqual({ tieuDe: 'Datasheet P10', choKhach: true, noiDungBam: bamTl('Datasheet P10') });

    const ds = (await goi('GET', '/tai-lieu', ADMIN)).json();
    expect(ds.kho.soTaiLieu).toBe(3);
    // sắp theo tiêu đề
    expect(ds.taiLieu.map((t: { id: string; choKhach: boolean; trangThai: string }) => [t.id, t.choKhach, t.trangThai])).toEqual([
      // choKhach (02/10 tối) = có nội dung + không loại trừ — KHÔNG phụ thuộc duyệt
      ['doc-2', true, 'chua_duyet'], ['doc-1', true, 'da_duyet'], ['doc-3', true, 'da_duyet'],
    ]);
    const d1 = ds.taiLieu.find((t: { id: string }) => t.id === 'doc-1');
    expect(d1).toMatchObject({ noiDungBam: bamTl('Datasheet P10'), noiDungBamDaDuyet: bamTl('Datasheet P10'), soDoan: 2, nguon: 'datasheet-pdf' });
    expect(d1).toMatchObject({ tieuDe: 'Datasheet P10', mauNoiDung: 'Nội dung Datasheet P10\nĐoạn hai', duyetBoi: { id: OWNER, fullName: `Tên ${OWNER}` } });
    // "Bảng giá nội bộ" ⇒ dấu hiệu nội bộ (chỉ nhắc)
    expect(ds.taiLieu[0].dauHieuNoiBo.join(' ')).toMatch(/bảng giá/);
    expect(d1.dauHieuNoiBo).toEqual([]);
    expect((await idCongKhai(KHOA_A))).toEqual(['doc-1', 'doc-3']);
  });

  it('bỏ duyệt hàng loạt: luôn được; chỉ mục đang duyệt mới ghi nhật ký', async () => {
    await napKhoMacDinh();
    await goi('POST', '/tai-lieu/duyet', OWNER, mucTl('doc-1', 'doc-3'));
    await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: ORG_A } });
    expect((await goi('POST', '/tai-lieu/bo-duyet', ADMIN, { ids: ['doc-1', 'doc-2'], lyDo: 'nhầm' })).json()).toEqual({ doi: 1 });
    const nk = await nhatKy('tai_lieu_cho_khach');
    expect(nk.map((r) => [r.doiTuongId, r.aiId, r.sau])).toEqual([['doc-1', ADMIN, { tieuDe: 'Datasheet P10', choKhach: false }]]);
    expect((await idCongKhai(KHOA_A))).toEqual(['doc-3']);
  });

  it('tài liệu đã duyệt bị xoá khỏi kho ⇒ không còn ở GET công khai, hiện ở duyetNgoaiDanhMuc, vẫn bỏ duyệt được', async () => {
    await napKhoMacDinh();
    await goi('POST', '/tai-lieu/duyet', OWNER, mucTl('doc-1', 'doc-3'));
    await prisma.knowledgeDocument.delete({ where: { id: 'doc-3' } });
    expect((await idCongKhai(KHOA_A))).toEqual(['doc-1']);
    expect((await goi('GET', '/tai-lieu', OWNER)).json().duyetNgoaiDanhMuc).toEqual(['doc-3']);
    expect((await goi('POST', '/tai-lieu/bo-duyet', OWNER, { ids: ['doc-3'] })).json()).toEqual({ doi: 1 });
  });

  it('duyệt tài liệu gắn băm NỘI DUNG: kho nạp lại cùng id mà nội dung đổi ⇒ hết hiệu lực; băm cũ ⇒ 409; duyệt lại ⇒ hiệu lực', async () => {
    await napKhoMacDinh();
    expect((await goi('POST', '/tai-lieu/duyet', OWNER, mucTl('doc-1', 'doc-3'))).json()).toEqual({ doi: 2 });
    expect((await docDuyet(KHOA_A)).tai_lieu_cho_khach).toEqual([
      { id: 'doc-1', noi_dung_bam: bamTl('Datasheet P10') }, { id: 'doc-3', noi_dung_bam: bamTl('Hướng dẫn lắp') },
    ]);

    // Kho tri thức CRM nạp lại doc-1 (cùng id, nội dung khác) ⇒ CRM tự tính băm mới.
    const bamMoi = bamNoiDungTaiLieu(['Nội dung Datasheet P10', 'Đoạn hai — đã sửa giá 125.000đ'])!;
    await napKho(ORG_A, 'doc-1', 'Datasheet P10', ['Nội dung Datasheet P10', 'Đoạn hai — đã sửa giá 125.000đ']);
    // Công khai: doc-1 KHÔNG còn (mặc định đóng) — chỉ doc-3 giữ nguyên.
    expect((await docDuyet(KHOA_A)).tai_lieu_cho_khach).toEqual([{ id: 'doc-3', noi_dung_bam: bamTl('Hướng dẫn lắp') }]);
    const ds = (await goi('GET', '/tai-lieu', OWNER)).json();
    expect(ds.taiLieu.find((t: { id: string }) => t.id === 'doc-1')).toMatchObject({
      id: 'doc-1', trangThai: 'doi_sau_duyet', choKhach: true, noiDungBam: bamMoi, noiDungBamDaDuyet: bamTl('Datasheet P10'),
    });

    // Người duyệt bấm trên trang CŨ (băm cũ) ⇒ 409 cả lô, không ghi gì.
    const cu = await goi('POST', '/tai-lieu/duyet', ADMIN, mucTl('doc-1', 'doc-2'));
    expect([cu.statusCode, cu.json().code]).toEqual([409, 'TAI_LIEU_DA_DOI']);
    expect(await prisma.botTaiLieuChoKhach.count({ where: { orgId: ORG_A, taiLieuId: 'doc-2' } })).toBe(0);

    // Duyệt lại bằng băm mới ⇒ hiệu lực; nhật ký trước/sau mang hai băm.
    await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: ORG_A } });
    expect((await goi('POST', '/tai-lieu/duyet', ADMIN, { taiLieu: [{ id: 'doc-1', noiDungBam: bamMoi }], lyDo: 'đã đọc lại' })).json())
      .toEqual({ doi: 1 });
    expect(await idCongKhai(KHOA_A)).toEqual(['doc-1', 'doc-3']);
    expect((await docDuyet(KHOA_A)).tai_lieu_cho_khach[0].noi_dung_bam).toBe(bamMoi);
    const nk = await nhatKy('tai_lieu_cho_khach');
    expect(nk.map((r) => [r.doiTuongId, r.aiId, r.truoc, r.sau])).toEqual([[
      'doc-1', ADMIN,
      { tieuDe: 'Datasheet P10', choKhach: true, noiDungBam: bamTl('Datasheet P10') },
      { tieuDe: 'Datasheet P10', choKhach: true, noiDungBam: bamMoi },
    ]]);
  });

  it('tài liệu rỗng (không đoạn — vd mục lục) không duyệt được ⇒ 409 TAI_LIEU_DA_DOI; trạng thái khong_noi_dung', async () => {
    await napKho(ORG_A, 'doc-1', 'Datasheet P10', ['Nội dung Datasheet P10', 'Đoạn hai']);
    await napKho(ORG_A, 'doc-9', 'Ảnh chưa OCR', []);
    const r = await goi('POST', '/tai-lieu/duyet', OWNER, { taiLieu: [{ id: 'doc-9', noiDungBam: 'a'.repeat(64) }] });
    expect([r.statusCode, r.json().code]).toEqual([409, 'TAI_LIEU_DA_DOI']);
    const ds = (await goi('GET', '/tai-lieu', OWNER)).json();
    expect(ds.taiLieu.find((t: { id: string }) => t.id === 'doc-9')).toMatchObject({ trangThai: 'khong_noi_dung', noiDungBam: null, choKhach: false, soDoan: 0 });
    expect(await idCongKhai(KHOA_A)).toEqual([]);
  });

  it('lô rỗng / quá 500 / id sai dạng ⇒ 400', async () => {
    await guiDanhMuc(KHOA_A);
    await napKhoMacDinh();
    const cac = [
      await goi('POST', '/tai-lieu/duyet', OWNER, mucTl()),
      await goi('POST', '/tai-lieu/duyet', OWNER, mucTl(...Array.from({ length: 501 }, (_, i) => `d${i}`))),
      await goi('POST', '/tai-lieu/duyet', OWNER, { taiLieu: [{ id: 'doc-1', noiDungBam: 'abc' }] }),
      await goi('POST', '/tai-lieu/duyet', OWNER, { ids: ['doc-1'] }),
      await goi('POST', '/tai-lieu/duyet', OWNER, mucTl('có dấu cách')),
      await goi('POST', '/mo-ta/duyet', OWNER, { sanPham: [{ productId: 11, moTaBam: 'abc' }] }),
      await goi('POST', '/mo-ta/bo-duyet', OWNER, { productIds: ['11'] }),
      await goi('GET', '/mo-ta?loc=la', OWNER),
    ];
    expect(cac.map((r) => r.statusCode)).toEqual([400, 400, 400, 400, 400, 400, 400, 400]);
  });

  // ── Mô tả: duyệt gắn băm (K2) ─────────────────────────────────────────────────

  it('duyệt mô tả gắn ĐÚNG băm: mô tả đổi ⇒ doi_sau_duyet, công khai giữ băm cũ; duyệt bằng băm cũ ⇒ 409; duyệt lại ⇒ hiệu lực', async () => {
    await guiDanhMuc(KHOA_A);
    const bam1 = bamMoTa(MO_1)!;
    expect((await goi('POST', '/mo-ta/duyet', OWNER, { sanPham: [{ productId: 11, moTaBam: bam1 }] })).json()).toEqual({ doi: 1 });
    expect((await docDuyet(KHOA_A)).mo_ta_da_duyet).toEqual([{ product_id: 11, mo_ta_bam: bam1 }]);
    let ds = (await goi('GET', '/mo-ta', OWNER)).json();
    expect(ds.dem).toEqual({ coMoTa: 2, daDuyet: 1, doiSauDuyet: 0, chuaDuyet: 1, tong: 3 });
    expect(ds.sanPham.map((s: { productId: number; trangThai: string }) => [s.productId, s.trangThai])).toEqual([[11, 'da_duyet'], [12, 'chua_duyet']]);

    // NV sửa description_sale qua bot ⇒ bot đẩy danh mục mới với băm mới.
    await guiDanhMuc(KHOA_A, danhMuc({ phien_ban: 'dm-2', san_pham: [sp(11, MO_1_SUA), sp(12, 'Chống nước IP67'), sp(13, null)] }));
    const bam2 = bamMoTa(MO_1_SUA)!;
    const cong = await docDuyet(KHOA_A);
    expect(cong.mo_ta_da_duyet).toEqual([{ product_id: 11, mo_ta_bam: bam1 }]); // băm CŨ — bot so với bam2 ⇒ không dùng
    expect(cong.mo_ta_da_duyet[0].mo_ta_bam).not.toBe(bam2);
    ds = (await goi('GET', '/mo-ta?loc=doi_sau_duyet', OWNER)).json();
    expect(ds.sanPham).toHaveLength(1);
    expect(ds.sanPham[0]).toMatchObject({ productId: 11, trangThai: 'doi_sau_duyet', moTaBam: bam2, moTaBamDaDuyet: bam1, moTaBan: MO_1_SUA });

    // Duyệt bằng băm người duyệt đã thấy TRƯỚC khi đổi ⇒ 409, không ghi.
    const cu = await goi('POST', '/mo-ta/duyet', OWNER, { sanPham: [{ productId: 11, moTaBam: bam1 }] });
    expect([cu.statusCode, cu.json().code]).toEqual([409, 'MO_TA_DA_DOI']);
    // Duyệt lại bằng băm mới ⇒ cập nhật, nhật ký trước/sau mang hai băm.
    expect((await goi('POST', '/mo-ta/duyet', ADMIN, { sanPham: [{ productId: 11, moTaBam: bam2 }], lyDo: 'đã đọc' })).json()).toEqual({ doi: 1 });
    expect((await docDuyet(KHOA_A)).mo_ta_da_duyet).toEqual([{ product_id: 11, mo_ta_bam: bam2 }]);
    const nk = await nhatKy('mo_ta_duyet');
    expect(nk.map((r) => [r.doiTuongId, r.aiId, r.truoc, r.sau])).toEqual([
      ['11', OWNER, null, { ten: 'Sản phẩm 11', moTaBam: bam1 }],
      ['11', ADMIN, { ten: 'Sản phẩm 11', moTaBam: bam1 }, { ten: 'Sản phẩm 11', moTaBam: bam2 }],
    ]);
  });

  it('chỉ đổi khoảng trắng của mô tả ⇒ cùng băm ⇒ duyệt vẫn hiệu lực', async () => {
    await guiDanhMuc(KHOA_A);
    await goi('POST', '/mo-ta/duyet', OWNER, { sanPham: [{ productId: 11, moTaBam: bamMoTa(MO_1) }] });
    await guiDanhMuc(KHOA_A, danhMuc({ phien_ban: 'dm-2', san_pham: [sp(11, '  Điện  áp 12V \r\n\r\nIP65 '), sp(12, 'Chống nước IP67'), sp(13, null)] }));
    const ds = (await goi('GET', '/mo-ta?loc=da_duyet', OWNER)).json();
    expect(ds.sanPham.map((s: { productId: number }) => s.productId)).toEqual([11]);
  });

  it('duyệt hàng loạt mô tả: một mục lệch/không có mô tả ⇒ 409 cả lô; SP không mô tả không duyệt được', async () => {
    await guiDanhMuc(KHOA_A);
    const lo = await goi('POST', '/mo-ta/duyet', OWNER, {
      sanPham: [{ productId: 11, moTaBam: bamMoTa(MO_1) }, { productId: 13, moTaBam: 'a'.repeat(64) }],
    });
    expect([lo.statusCode, lo.json().code]).toEqual([409, 'MO_TA_DA_DOI']);
    expect(await prisma.botMoTaDuyet.count({ where: { orgId: ORG_A } })).toBe(0);
    const ok = await goi('POST', '/mo-ta/duyet', OWNER, {
      sanPham: [{ productId: 11, moTaBam: bamMoTa(MO_1) }, { productId: 12, moTaBam: bamMoTa('Chống nước IP67') }],
    });
    expect(ok.json()).toEqual({ doi: 2 });
    expect((await nhatKy('mo_ta_duyet')).length).toBe(2);
  });

  it('bỏ duyệt mô tả hàng loạt + mô tả bị XOÁ sau duyệt vẫn hiện "doi_sau_duyet" (để bỏ duyệt)', async () => {
    await guiDanhMuc(KHOA_A);
    await goi('POST', '/mo-ta/duyet', OWNER, {
      sanPham: [{ productId: 11, moTaBam: bamMoTa(MO_1) }, { productId: 12, moTaBam: bamMoTa('Chống nước IP67') }],
    });
    await guiDanhMuc(KHOA_A, danhMuc({ phien_ban: 'dm-2', san_pham: [sp(11, MO_1), sp(12, null), sp(13, null)] }));
    const ds = (await goi('GET', '/mo-ta', OWNER)).json();
    expect(ds.sanPham.map((s: { productId: number; trangThai: string }) => [s.productId, s.trangThai])).toEqual([[11, 'da_duyet'], [12, 'doi_sau_duyet']]);
    await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: ORG_A } });
    expect((await goi('POST', '/mo-ta/bo-duyet', ADMIN, { productIds: [11, 12, 99] })).json()).toEqual({ doi: 2 });
    expect((await nhatKy('mo_ta_duyet')).map((r) => [r.doiTuongId, r.sau])).toEqual([['11', null], ['12', null]]);
    expect((await docDuyet(KHOA_A)).mo_ta_da_duyet).toEqual([]);
  });

  // ── Công khai: phien_ban ────────────────────────────────────────────────────

  it('GET duyệt: phien_ban ổn định khi không đổi, đổi khi duyệt/bỏ duyệt; danh_muc_phien_ban theo danh mục', async () => {
    await guiDanhMuc(KHOA_A);
    await napKhoMacDinh();
    const a = await docDuyet(KHOA_A);
    expect(a.danh_muc_phien_ban).toBe('dm-1');
    expect((await docDuyet(KHOA_A)).phien_ban).toBe(a.phien_ban);
    await goi('POST', '/tai-lieu/duyet', OWNER, mucTl('doc-1'));
    const b = await docDuyet(KHOA_A);
    expect(b.phien_ban).not.toBe(a.phien_ban);
    await goi('POST', '/mo-ta/duyet', OWNER, { sanPham: [{ productId: 11, moTaBam: bamMoTa(MO_1) }] });
    const c = await docDuyet(KHOA_A);
    expect(c.phien_ban).not.toBe(b.phien_ban);
    await goi('POST', '/mo-ta/bo-duyet', OWNER, { productIds: [11] });
    expect((await docDuyet(KHOA_A)).phien_ban).toBe(b.phien_ban);
  });

  it('nhật ký chung (/nhat-ky) hiện tên đối tượng cho dòng cho khách', async () => {
    await guiDanhMuc(KHOA_A);
    await napKhoMacDinh();
    await goi('POST', '/tai-lieu/duyet', OWNER, mucTl('doc-1'));
    await goi('POST', '/mo-ta/duyet', OWNER, { sanPham: [{ productId: 11, moTaBam: bamMoTa(MO_1) }] });
    const r = await admin.inject({ method: 'GET', url: '/api/v1/bot-quyen/nhat-ky', headers: { authorization: `Bearer ${token(OWNER)}` } });
    const ds = r.json().nhatKy as Array<{ doiTuong: string; tenDoiTuong: string | null }>;
    expect(ds.find((e) => e.doiTuong === 'tai_lieu_cho_khach')?.tenDoiTuong).toBe('Datasheet P10');
    expect(ds.find((e) => e.doiTuong === 'mo_ta_duyet')?.tenDoiTuong).toBe('Sản phẩm 11');
  });

  it('toàn văn: đoạn theo ord + băm + dấu hiệu nội bộ xét TOÀN VĂN (giá ở đoạn cuối vẫn thấy)', async () => {
    await napKho(ORG_A, 'doc-7', 'Card thu BX-V7512', ['Tên: Card thu BX-V7512', 'x'.repeat(400), 'Giá bán: 260.000đ']);
    const r = (await goi('GET', '/tai-lieu/doc-7/toan-van', ADMIN)).json();
    expect(r.doan).toEqual(['Tên: Card thu BX-V7512', 'x'.repeat(400), 'Giá bán: 260.000đ']);
    expect(r.noiDungBam).toBe(bamNoiDungTaiLieu(r.doan));
    expect(r.dauHieuNoiBo.join(' ')).toMatch(/giá/);
    expect((await goi('GET', '/tai-lieu/khong-co/toan-van', ADMIN)).statusCode).toBe(404);
    expect((await goi('GET', '/tai-lieu/c%C3%B3%20d%E1%BA%A5u/toan-van', ADMIN)).statusCode).toBe(400);
  });

  it('danh mục không có khoá tai_lieu (bot mới) ⇒ 200', async () => {
    const r = await guiDanhMuc(KHOA_A, { phien_ban: 'dm-x', san_pham: [sp(11, MO_1)] });
    expect(r.json()).toEqual({ ok: true, phien_ban: 'dm-x', so_tai_lieu: 0, so_san_pham: 1 });
  });
});
