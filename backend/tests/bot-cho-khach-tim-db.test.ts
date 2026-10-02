// SPDX-License-Identifier: AGPL-3.0-or-later
// Tìm thông số trong KHO TRI THỨC CRM cho bot (docs/79, sửa 02/10 tối) — Postgres THẬT:
//   • POST /api/public/cho-khach/tim (đường KHÁCH, chủ chốt 02/10 tối): MỌI tài liệu của org TRỪ tài liệu loại trừ — không cần
//     duyệt; loại trừ ⇒ không bao giờ trả (kể cả khi khớp hơn); bỏ loại trừ ⇒ trả lại; cách ly org (org lấy từ khoá);
//   • POST /api/public/tai-lieu-ky-thuat/tim (đường NV): mọi tài liệu của org;
//   • cả hai: neo định danh SP lọc đoạn của SP khác; dòng giá/SĐT/link bị bỏ, dòng thông số giữ; 401/403/400.
// Embedding: test KHÔNG đặt EMBED_BASE_URL ⇒ xếp hạng chỉ theo từ khoá (đúng đường agent CRM khi embedding chết).
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { botChoKhachPublicRoutes } from '../src/modules/bot-quyen/bot-cho-khach-routes.js';

const ORG_A = 'test-bct-org-a';
const ORG_B = 'test-bct-org-b';
const KHOA_A = 'test-bct-khoa-a';
const KHOA_B = 'test-bct-khoa-b';
const KHOA_BOT_A = 'test-bct-khoa-bot-a';
const ORGS = [ORG_A, ORG_B];

const P3076 = ['Product name: Outdoor full color LED display module P3.076', 'Refresh rate: 3840Hz\nIP65\nGiá bán: 1.200.000đ',
  'Hotline: 0969.810.104\nModule size: 320x160mm (outdoor)'];
const P10 = ['Module P10 full color outdoor', 'Refresh rate: 1920Hz\nIP65'];
const BANG_GIA = ['Bảng giá nội bộ P3.076 3840Hz', 'P3.076 outdoor đại lý 900k'];

async function napKho(orgId: string, id: string, tieuDe: string, doan: string[]) {
  await prisma.knowledgeChunk.deleteMany({ where: { documentId: id } });
  await prisma.knowledgeDocument.upsert({
    where: { id }, create: { id, orgId, title: tieuDe, source: 'datasheet-pdf', content: doan.join('\n\n') },
    update: { title: tieuDe, content: doan.join('\n\n') },
  });
  await prisma.knowledgeChunk.createMany({
    data: doan.map((content, ord) => ({
      orgId, documentId: id, ord, content, embedding: [1, 0, 0], embedProvider: 'test', embedModel: 'test', embedDim: 3,
    })),
  });
}

async function loaiTru(orgId: string, id: string) {
  await prisma.botTaiLieuLoaiTru.create({ data: { orgId, taiLieuId: id, boi: 'test' } });
}

async function donDep() {
  await prisma.knowledgeChunk.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.knowledgeDocument.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.botTaiLieuLoaiTru.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.appSetting.deleteMany({ where: { orgId: { in: ORGS } } });
  await prisma.organization.deleteMany({ where: { id: { in: ORGS } } });
}

let pub: FastifyInstance;
const embedCu = process.env.EMBED_BASE_URL;

type Doan = { tai_lieu_id: string; tieu_de: string; noi_dung: string; diem: number };

async function tim(duong: 'cho-khach' | 'tai-lieu-ky-thuat', khoa: string, body: unknown) {
  return pub.inject({ method: 'POST', url: `/api/public/${duong}/tim`, headers: { 'x-api-key': khoa }, payload: body as object });
}
async function ketQua(duong: 'cho-khach' | 'tai-lieu-ky-thuat', khoa: string, body: unknown): Promise<Doan[]> {
  const r = await tim(duong, khoa, body);
  expect(r.statusCode, r.body).toBe(200);
  return (r.json() as { ket_qua: Doan[] }).ket_qua;
}

const CAU = { truy_van: 'thông số P3.076 out ốp lưng 3840HZ', so_doan: 5 };

describeCanDb('tìm thông số trong kho tri thức CRM cho bot (DB)', () => {
  beforeAll(async () => {
    delete process.env.EMBED_BASE_URL;
    await donDep();
    await prisma.organization.create({ data: { id: ORG_A, name: 'BCT A' } });
    await prisma.organization.create({ data: { id: ORG_B, name: 'BCT B' } });
    await prisma.appSetting.create({ data: { orgId: ORG_A, settingKey: 'public_api_key', valuePlain: KHOA_A } });
    await prisma.appSetting.create({ data: { orgId: ORG_B, settingKey: 'public_api_key', valuePlain: KHOA_B } });
    pub = Fastify({ logger: false });
    await pub.register(botChoKhachPublicRoutes);
    await pub.ready();
  });

  afterAll(async () => {
    if (embedCu !== undefined) process.env.EMBED_BASE_URL = embedCu;
    await pub?.close();
    await donDep();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.knowledgeChunk.deleteMany({ where: { orgId: { in: ORGS } } });
    await prisma.knowledgeDocument.deleteMany({ where: { orgId: { in: ORGS } } });
    await prisma.botTaiLieuLoaiTru.deleteMany({ where: { orgId: { in: ORGS } } });
    await prisma.appSetting.deleteMany({ where: { orgId: ORG_A, settingKey: 'bot_ban_do_tin_api_key' } });
    await napKho(ORG_A, 'kb-p3076', 'LLR- P3.076 .3840hz outdoor', P3076);
    await napKho(ORG_A, 'kb-p10', 'LLR -P10 -RGB OPLUNG', P10);
    await napKho(ORG_A, 'kb-gia', 'Bảng giá đại lý', BANG_GIA);
  });

  it('KHÁCH: KHÔNG cần duyệt — câu P3.076 trả thông số từ RAG; dòng giá/SĐT bị bỏ, dòng thông số giữ', async () => {
    const kq = await ketQua('cho-khach', KHOA_A, CAU);
    expect(kq.length).toBeGreaterThan(0);
    expect(kq[0].tai_lieu_id).toBe('kb-p3076');
    const chu = kq.map((d) => d.noi_dung).join('\n');
    expect(chu).toContain('Refresh rate: 3840Hz');
    expect(chu).toContain('Module size: 320x160mm');
    expect(chu).not.toMatch(/Giá|1\.200\.000|0969|Hotline|900k/);
    expect(kq[0].tieu_de).toBe('LLR- P3.076 .3840hz outdoor');
  });

  it('KHÁCH: tài liệu loại trừ không bao giờ trả dù khớp hơn; bỏ loại trừ ⇒ trả lại; NV vẫn thấy', async () => {
    await loaiTru(ORG_A, 'kb-gia');
    await loaiTru(ORG_A, 'kb-p3076');
    const kq = await ketQua('cho-khach', KHOA_A, CAU);
    expect(kq.some((d) => d.tai_lieu_id === 'kb-gia' || d.tai_lieu_id === 'kb-p3076')).toBe(false);
    expect((await ketQua('tai-lieu-ky-thuat', KHOA_A, CAU)).some((d) => d.tai_lieu_id === 'kb-p3076')).toBe(true);
    await prisma.botTaiLieuLoaiTru.deleteMany({ where: { orgId: ORG_A, taiLieuId: 'kb-p3076' } });
    expect((await ketQua('cho-khach', KHOA_A, CAU))[0].tai_lieu_id).toBe('kb-p3076');
  });

  it('KHÁCH: nội dung nạp lại được dùng ngay (không còn cổng băm)', async () => {
    await napKho(ORG_A, 'kb-p3076', 'LLR- P3.076 .3840hz outdoor', [...P3076, 'Brightness: 5500 nits']);
    const chu = (await ketQua('cho-khach', KHOA_A, { truy_van: 'P3.076 brightness nits', so_doan: 5 })).map((d) => d.noi_dung).join('\n');
    expect(chu).toContain('5500 nits');
  });

  it('mã SP chỉ nằm ở TIÊU ĐỀ (đoạn không nhắc mã), không embedding ⇒ vẫn tìm ra theo từ khoá tiêu đề; tiêu đề có giá ⇒ nhãn trung tính', async () => {
    await napKho(ORG_A, 'kb-tieu-de', 'LLR- P2.5 .7680hz indoor', ['Điện áp: 5V\nKích thước: 320x160mm']);
    await napKho(ORG_A, 'kb-gia-tieu-de', 'P2.5 giá bán 900k', ['Độ sáng: 800 nits']);
    const kq = await ketQua('cho-khach', KHOA_A, { truy_van: 'thông số P2.5', so_doan: 5, san_pham: { ten: 'P2.5', ma: null, neo: [['p2']] } });
    const d = kq.find((x) => x.tai_lieu_id === 'kb-tieu-de');
    expect(d?.noi_dung).toBe('Điện áp: 5V\nKích thước: 320x160mm');
    expect(d?.tieu_de).toBe('LLR- P2.5 .7680hz indoor');
    const g = kq.find((x) => x.tai_lieu_id === 'kb-gia-tieu-de');
    expect(g?.tieu_de).toBe('Tài liệu kỹ thuật');
    expect(JSON.stringify(kq)).not.toMatch(/900k/);
  });

  it('thứ hạng (dev 02/10 khuya): tiêu đề trùng nhiều từ câu hỏi ("OP LUNG") thắng biến thể khác; đoạn thông số thắng đoạn đầu trang', async () => {
    await prisma.knowledgeChunk.deleteMany({ where: { orgId: ORG_A } });
    await prisma.knowledgeDocument.deleteMany({ where: { orgId: ORG_A } });
    await napKho(ORG_A, 'kb-deo', 'LLR- P3.076 outdoor dẻo-3840hz', ['Page 3 of 14\nP3.076-R-104*52-13S-1516', 'Refresh rate: 3840Hz\nKích thước: 320x160mm']);
    await napKho(ORG_A, 'kb-oplung', 'LLR P3.076-V2.0 OP LUNG', ['Page 1 of 12\nP3.076-HG-104x52-13S-1516',
      'Pixel pitch: 3.076mm\nRefresh rate: 1920Hz-3840Hz\nScan: 1/13\nInput: 5V DC']);
    const kq = await ketQua('cho-khach', KHOA_A, { truy_van: 'thông số P3.076 out ốp lưng 3840HZ (tấm)', so_doan: 2,
      san_pham: { ten: 'P3.076 out ốp lưng 3840HZ (tấm)', ma: null, neo: [['p3'], ['076']] } });
    expect(kq[0].tai_lieu_id).toBe('kb-oplung');
    expect(kq[0].noi_dung).toContain('Refresh rate: 1920Hz-3840Hz');
  });

  it('cách ly org: khoá B không thấy tài liệu của A; loại trừ của B không ảnh hưởng A', async () => {
    await loaiTru(ORG_B, 'kb-p3076');
    expect((await ketQua('cho-khach', KHOA_A, CAU))[0].tai_lieu_id).toBe('kb-p3076');
    expect(await ketQua('cho-khach', KHOA_B, CAU)).toEqual([]);
    expect(await ketQua('tai-lieu-ky-thuat', KHOA_B, CAU)).toEqual([]);
  });

  it('NHÂN VIÊN: mọi tài liệu của org (không cần duyệt), vẫn bỏ dòng giá', async () => {
    const kq = await ketQua('tai-lieu-ky-thuat', KHOA_A, CAU);
    const ids = new Set(kq.map((d) => d.tai_lieu_id));
    expect(ids.has('kb-p3076')).toBe(true);
    expect(kq.map((d) => d.noi_dung).join('\n')).not.toMatch(/Giá bán|900k|1\.200\.000/);
  });

  it('neo định danh SP: chỉ đoạn (kèm tiêu đề tài liệu) khớp MỌI nhóm neo', async () => {
    const kq = await ketQua('tai-lieu-ky-thuat', KHOA_A, {
      ...CAU, san_pham: { ten: 'P3.076 out ốp lưng 3840HZ', ma: null, neo: [['p3'], ['076']] },
    });
    expect(kq.length).toBeGreaterThan(0);
    expect(kq.every((d) => /P3\.076/.test(`${d.tieu_de}\n${d.noi_dung}`))).toBe(true);
    expect(kq.some((d) => d.tai_lieu_id === 'kb-p10')).toBe(false);
    const p10 = await ketQua('tai-lieu-ky-thuat', KHOA_A, { truy_van: 'P10 1920Hz', san_pham: { ten: 'P10', ma: null, neo: [['p10']] } });
    expect(new Set(p10.map((d) => d.tai_lieu_id))).toEqual(new Set(['kb-p10']));
  });

  it('đoạn đúng mã nằm SAU nhiều đoạn chỉ khớp từ chung vẫn lên đầu (xếp trên mọi ứng viên + token phân biệt)', async () => {
    await napKho(ORG_A, 'kb-0-nhieu', 'Catalogue chung', Array.from({ length: 60 }, (_, i) => `Outdoor module dòng ${i}`));
    const kq = await ketQua('tai-lieu-ky-thuat', KHOA_A, { truy_van: 'thông số P3.076 outdoor 3840Hz', so_doan: 1 });
    expect(kq[0].tai_lieu_id).toBe('kb-p3076');
  });

  it('so_doan giới hạn số đoạn trả', async () => {
    expect((await ketQua('tai-lieu-ky-thuat', KHOA_A, { truy_van: 'outdoor 3840Hz IP65 module', so_doan: 1 })).length).toBe(1);
  });

  it('khoá sai ⇒ 401; org có khoá riêng ⇒ khoá chung 403 CAN_KHOA_RIENG_BOT; thân sai ⇒ 400', async () => {
    expect((await tim('cho-khach', 'sai', CAU)).statusCode).toBe(401);
    await prisma.appSetting.create({ data: { orgId: ORG_A, settingKey: 'bot_ban_do_tin_api_key', valuePlain: KHOA_BOT_A } });
    for (const d of ['cho-khach', 'tai-lieu-ky-thuat'] as const) {
      const r = await tim(d, KHOA_A, CAU);
      expect([r.statusCode, r.json().code]).toEqual([403, 'CAN_KHOA_RIENG_BOT']);
      expect((await tim(d, KHOA_BOT_A, CAU)).statusCode).toBe(200);
      const b = await tim(d, KHOA_BOT_A, { truy_van: '', so_doan: 9 });
      expect([b.statusCode, b.json().code]).toEqual([400, 'YEU_CAU_TIM_KHONG_HOP_LE']);
    }
  });
});
