// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 zca-js-id.md) — trên Postgres THẬT, Zalo GIẢ có hình zca-js 2.1.2 (tests/helpers/zca-gia.ts):
//   P3-1  lô getUserInfo có uid DÙNG CHUNG globalId ⇒ hỏi lại riêng từng uid đó; chỉ uid vẫn trùng mới bị bỏ.
//   P3-3  mỗi vòng danh tính đúng MỘT dòng INFO có số đếm.
//   P3-4  ngăn Thành viên: đọc Zalo tính vào ngân sách ds_group_read + đệm ngắn.
//   Nghe  listener lưu globalId nó VỪA đọc cho người nói trong nhóm (không gọi thêm Zalo) ⇒ Trần Hưng 3395… (góc Cẩm Loan)
//         nối với 3835… (góc VTMT) dù lúc vòng danh tính chạy Cẩm Loan đã tắt.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { describeCanDb } from './helpers/can-db.js';
import { taoZcaGia, type HoSoGia } from './helpers/zca-gia.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import { logger } from '../src/shared/utils/logger.js';
import { registerBotQuyenRoutes } from '../src/modules/bot-quyen/bot-quyen-routes.js';
import { _xoaBanGom } from '../src/modules/bot-quyen/bot-quyen-nguoi-da-nhan.js';
import { _thongKeBoNho } from '../src/modules/bot-quyen/bot-quyen-cong-khai.js';
import { _xoaNhipBoSung } from '../src/modules/bot-quyen/bot-quyen-nhan-vien-uid.js';
import { _epLienKetHong } from '../src/modules/bot-quyen/bot-quyen-cung-nguoi.js';
import { _datBoDocChoTest, NS_DOC_NHOM } from '../src/modules/bot-quyen/bot-quyen-danh-sach.js';
import { _datThanhVienChoTest, type DocThanhVienZalo } from '../src/modules/bot-quyen/bot-quyen-thanh-vien.js';
import {
  _datZaloDanhTinhChoTest, layDanhTinhZalo, ghiHoSoNickKetNoi, ghiHoSoTuTinDen, docBanDanhTinh, taoApiTuZca,
} from '../src/modules/bot-quyen/bot-quyen-danh-tinh.js';
import { daDungHomNay, _datNganSachChoTest } from '../src/modules/bot-quyen/bot-quyen-ngan-sach.js';
import { chayDanhTinh, _danhTinhChoTest } from '../src/modules/bot-quyen/bot-quyen-service.js';

const ORG = 'test-bqzi-org';
const OWNER = 'test-bqzi-owner';
const BASE = '/api/v1/bot-quyen';

// Số thật staging (docs/77 cach-crm-nhan-dien.md §4–§5; đo lại 01/10 qua POST /zalo-user-info/batch).
const VT = 'test-bqzi-vt', CL = 'test-bqzi-cl';
const VT_SELF = '619833576870383279-zi', CL_SELF = '632106073555356463-zi';
const HUNG_VT = '3835588809400259343', QUOC_VT = '5369941570764297136', HUNG_CL = '3395858500519725514';
const CL_TU_VT = '1359961729460490730';
const G_VT = '4LGTI0826CD3G07NBUGLTVSCHRN7QI80', G_HUNG = 'PODILQ0AIDDJ0211ASEAB2D36R8BD080';
const G_QUOC = 'OGGI1EMNLJHERLBGHBHK365CEMQOG580', G_CL = 'E4U5VE6TUOJEFNPEG2TUKD82BJ19A8O0';
const BANG: Record<string, Record<string, HoSoGia>> = {
  [VT]: {
    [VT_SELF]: { globalId: G_VT, zaloName: 'Vận Tải Minh Thức' },
    [HUNG_VT]: { globalId: G_HUNG, zaloName: 'Trần Hưng' },
    [QUOC_VT]: { globalId: G_QUOC, zaloName: 'Viết Quốc' },
    [CL_TU_VT]: { globalId: G_CL, zaloName: 'Cẩm Loan' },
  },
  [CL]: { [CL_SELF]: { globalId: G_CL, zaloName: 'Cẩm Loan' }, [HUNG_CL]: { globalId: G_HUNG, zaloName: 'Trần Hưng' } },
};

let app: FastifyInstance;
let so = 0;

function token(): string {
  return app.jwt.sign({ id: OWNER, email: `${OWNER}@x.com`, role: 'owner', orgId: ORG, typ: 'access' });
}
async function goi(method: 'GET' | 'POST', url: string, payload?: object) {
  return app.inject({ method, url: `${BASE}${url}`, headers: { authorization: `Bearer ${token()}` }, ...(payload ? { payload } : {}) });
}
async function tin(conversationId: string, senderUid: string) {
  so++;
  await prisma.message.create({
    data: {
      id: `test-bqzi-m${so}`, conversationId, zaloMsgId: String(8_420_000_000_000 + so), senderType: 'contact', senderUid,
      senderName: senderUid, content: `tin ${so}`, contentType: 'text', sentAt: new Date(),
    },
  });
}
async function donDep() {
  await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhomDanhSach.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhanVien.deleteMany({ where: { orgId: ORG } });
  await prisma.botNickCrmUid.deleteMany({ where: { orgId: ORG } });
  await prisma.botQuyenDanhTinh.deleteMany({ where: { orgId: ORG } });
  await prisma.message.deleteMany({ where: { conversation: { orgId: ORG } } });
  await prisma.conversation.deleteMany({ where: { orgId: ORG } });
  await prisma.zaloAccount.deleteMany({ where: { orgId: ORG } });
}
async function dung() {
  const tao = (id: string, zaloUid: string, displayName: string) =>
    prisma.zaloAccount.create({ data: { id, orgId: ORG, ownerUserId: OWNER, zaloUid, displayName, status: 'disconnected' } });
  await tao(VT, VT_SELF, 'Vận Tải Minh Thức');
  await tao(CL, CL_SELF, 'Cẩm Loan');
  await prisma.conversation.create({
    data: { id: 'bqzi-p1', orgId: ORG, zaloAccountId: VT, threadType: 'group', externalThreadId: 'ext-bqzi-p1', groupName: 'private 1', lastMessageAt: new Date() },
  });
  await prisma.conversation.create({
    data: { id: 'bqzi-ai', orgId: ORG, zaloAccountId: CL, threadType: 'group', externalThreadId: 'ext-bqzi-ai', groupName: 'AI dev test', lastMessageAt: new Date() },
  });
  for (const u of [HUNG_VT, QUOC_VT, CL_TU_VT]) await tin('bqzi-p1', u);
  await tin('bqzi-ai', HUNG_CL);
}
const dong = (nick: string, uid: string) => prisma.botQuyenDanhTinh.findUnique({
  where: { orgId_zaloAccountId_zaloUid: { orgId: ORG, zaloAccountId: nick, zaloUid: uid } },
});

describeCanDb('bot-quyen — mã Zalo theo zca-js (P3-1/3/4, nghe từ listener)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.organization.deleteMany({ where: { id: ORG } });
    await prisma.organization.create({ data: { id: ORG, name: 'BQZI' } });
    await prisma.user.create({ data: { id: OWNER, orgId: ORG, email: `${OWNER}@x.com`, passwordHash: 'x', fullName: 'Chủ', role: 'owner', isActive: true } });
    app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: config.jwtSecret });
    await app.register(registerBotQuyenRoutes, { prefix: BASE, docThanhVienZalo: async () => [] });
    await app.ready();
  });

  afterAll(async () => {
    _datBoDocChoTest(null);
    _datZaloDanhTinhChoTest(null, { tranNgay: null });
    _datThanhVienChoTest({ tranNgay: null });
    _datNganSachChoTest({ kho: null });
    await _danhTinhChoTest({ treMs: 3000 });
    await app?.close();
    await donDep();
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.organization.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    _xoaBanGom();
    _xoaNhipBoSung();
    _thongKeBoNho(true);
    _epLienKetHong(false);
    await _danhTinhChoTest({ treMs: -1 });
    _datBoDocChoTest(async () => ({ gridInfoMap: {} }));
    _datNganSachChoTest({ kho: null });
    _datThanhVienChoTest({ tranNgay: null });
    vi.restoreAllMocks();
    await donDep();
  });

  // ── P3-1 ─────────────────────────────────────────────────────────────────────

  it('P3-1: lô trả CÙNG globalId cho hai uid (chỉ khi hỏi cả lô) ⇒ hỏi lại riêng hai uid đó ⇒ nhận đúng; uid khác của lô KHÔNG bị bỏ', async () => {
    await dung();
    await ghiHoSoNickKetNoi(VT, VT_SELF, { userId: VT_SELF, globalId: G_VT, zaloName: 'Vận Tải Minh Thức' });
    const z = taoZcaGia(BANG, { chiKhiCaLo: { [VT]: { [HUNG_VT]: { globalId: 'G-GIU-CHO' }, [QUOC_VT]: { globalId: 'G-GIU-CHO' } } } });
    _datZaloDanhTinhChoTest(taoApiTuZca((n) => z.nick(n)), { nickDung: [VT] });
    const kq = await layDanhTinhZalo(ORG);
    const goiVt = z.goi.filter((g) => g.nick === VT);
    // zca-js gửi "<uid>_0"; lần 1 cả lô, rồi RIÊNG từng uid dùng chung
    expect(goiVt.map((g) => g.gui.length)).toEqual([3, 1, 1]);
    expect(goiVt.slice(1).map((g) => g.gui[0]).sort()).toEqual([`${HUNG_VT}_0`, `${QUOC_VT}_0`].sort());
    expect(kq.thuLai).toBe(2);
    expect(await dong(VT, HUNG_VT)).toMatchObject({ globalId: G_HUNG, loi: null, nguon: 'zalo_user_info' });
    expect(await dong(VT, QUOC_VT)).toMatchObject({ globalId: G_QUOC, loi: null });
    expect(await dong(VT, CL_TU_VT)).toMatchObject({ globalId: G_CL, loi: null });
  });

  it('P3-1: hỏi riêng vẫn ra CÙNG globalId ⇒ chỉ hai uid đó bỏ (lo_trung_gid); uid còn lại ghi đúng', async () => {
    await dung();
    await ghiHoSoNickKetNoi(VT, VT_SELF, { userId: VT_SELF, globalId: G_VT, zaloName: 'Vận Tải Minh Thức' });
    const z = taoZcaGia(BANG, { ghiDe: { [VT]: { [HUNG_VT]: { globalId: 'G-GIU-CHO' }, [QUOC_VT]: { globalId: 'G-GIU-CHO' } } } });
    _datZaloDanhTinhChoTest(taoApiTuZca((n) => z.nick(n)), { nickDung: [VT] });
    await layDanhTinhZalo(ORG);
    expect(await dong(VT, HUNG_VT)).toMatchObject({ globalId: null, loi: 'lo_trung_gid' });
    expect(await dong(VT, QUOC_VT)).toMatchObject({ globalId: null, loi: 'lo_trung_gid' });
    expect(await dong(VT, CL_TU_VT)).toMatchObject({ globalId: G_CL, loi: null });
  });

  it('userId lệch (Zalo trả hồ sơ người khác dưới khoá uid) ⇒ không nhận globalId, ghi loi uid_lech', async () => {
    await dung();
    await ghiHoSoNickKetNoi(VT, VT_SELF, { userId: VT_SELF, globalId: G_VT, zaloName: 'Vận Tải Minh Thức' });
    const z = taoZcaGia(BANG, { ghiDe: { [VT]: { [HUNG_VT]: { userId: QUOC_VT, globalId: G_QUOC } } } });
    _datZaloDanhTinhChoTest(taoApiTuZca((n) => z.nick(n)), { nickDung: [VT] });
    await layDanhTinhZalo(ORG);
    expect(await dong(VT, HUNG_VT)).toMatchObject({ globalId: null, loi: 'uid_lech' });
    expect(await dong(VT, QUOC_VT)).toMatchObject({ globalId: G_QUOC, loi: null });
  });

  // ── P3-3 ─────────────────────────────────────────────────────────────────────

  it('P3-3: mỗi vòng danh tính đúng MỘT dòng INFO, có số đếm', async () => {
    await dung();
    const z = taoZcaGia(BANG);
    _datZaloDanhTinhChoTest(taoApiTuZca((n) => z.nick(n)), { nickDung: [VT, CL] });
    const info = vi.spyOn(logger, 'info');
    await layDanhTinhZalo(ORG);
    const dongVong = info.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[bot-quyen-danh-tinh]'));
    expect(dongVong).toHaveLength(1);
    expect(dongVong[0]).toMatch(new RegExp(`org ${ORG}: vòng danh tính — nick=2 getUserInfo=2 \\(hỏi lại riêng=0\\) uid=6 findUser=0 rào=0 lỗi=0 hết_ngân_sách=0`));
  });

  // ── Nghe từ listener ─────────────────────────────────────────────────────────

  it('Nghe: listener lưu globalId nó vừa đọc ⇒ Hưng 3395… (Cẩm Loan) nối 3835… (VTMT) dù vòng danh tính chạy lúc Cẩm Loan ĐÃ TẮT', async () => {
    await dung();
    // Cẩm Loan nối: zalo-pool lưu hồ sơ chính nick; listener nghe Hưng nói trong nhóm (getUserInfo đã gọi trong resolveZaloName).
    await ghiHoSoNickKetNoi(CL, CL_SELF, { userId: CL_SELF, globalId: G_CL, zaloName: 'Cẩm Loan' });
    const zCl = taoZcaGia(BANG);
    const raw = (await zCl.nick(CL).getUserInfo(HUNG_CL)) as { changed_profiles: Record<string, Record<string, unknown>> };
    expect(await ghiHoSoTuTinDen(CL, HUNG_CL, raw.changed_profiles[HUNG_CL])).toBe('ghi');
    expect(await ghiHoSoTuTinDen(CL, HUNG_CL, raw.changed_profiles[HUNG_CL])).toBe('trung'); // một lần / 6 giờ
    // Cẩm Loan tắt; vòng danh tính chỉ đọc được qua VTMT.
    await ghiHoSoNickKetNoi(VT, VT_SELF, { userId: VT_SELF, globalId: G_VT, zaloName: 'Vận Tải Minh Thức' });
    const hung = (await goi('POST', '/nhan-vien', { zaloUid: HUNG_VT, tenGoi: 'Trần Hưng', vai: 'admin' })).json().nhanVien;
    const z = taoZcaGia(BANG);
    _datZaloDanhTinhChoTest(taoApiTuZca((n) => z.nick(n)), { nickDung: [VT] });
    await chayDanhTinh(ORG);
    expect(z.goi.every((g) => g.nick === VT)).toBe(true);
    const ban = await docBanDanhTinh(ORG);
    expect(ban.theoGid.get(G_HUNG)!.map((x) => `${x.nick}|${x.uid}`).sort()).toEqual([`${CL}|${HUNG_CL}`, `${VT}|${HUNG_VT}`].sort());
    expect((await prisma.botNhanVienUid.findMany({ where: { nhanVienId: hung.id }, orderBy: { zaloUid: 'asc' } })).map((u) => [u.zaloUid, u.nguon]))
      .toEqual([[HUNG_CL, 'zalo_global_id'], [HUNG_VT, 'chon']]);
  });

  it('Nghe: rào — globalId của chính nick / chưa biết globalId nick / mã nhóm / userId lệch / globalId rỗng ⇒ không ghi; không hạ globalId tin được', async () => {
    await dung();
    // chưa biết globalId của chính Cẩm Loan ⇒ bỏ (và tin sau thử lại được)
    expect(await ghiHoSoTuTinDen(CL, HUNG_CL, { userId: HUNG_CL, globalId: G_HUNG })).toBe('bo');
    await ghiHoSoNickKetNoi(CL, CL_SELF, { userId: CL_SELF, globalId: G_CL, zaloName: 'Cẩm Loan' });
    expect(await ghiHoSoTuTinDen(CL, HUNG_CL, { userId: HUNG_CL, globalId: G_HUNG })).toBe('ghi');
    expect(await ghiHoSoTuTinDen(CL, 'x-gid-nick', { userId: 'x-gid-nick', globalId: G_CL })).toBe('bo');
    expect(await ghiHoSoTuTinDen(CL, 'ext-bqzi-ai', { globalId: 'G-GIU-CHO' })).toBe('bo');
    expect(await ghiHoSoTuTinDen(CL, 'x-lech', { userId: 'khac', globalId: 'G-X' })).toBe('bo');
    expect(await ghiHoSoTuTinDen(CL, 'x-rong', { userId: 'x-rong', globalId: '' })).toBe('bo');
    expect(await ghiHoSoTuTinDen(CL, CL_SELF, { userId: CL_SELF, globalId: G_CL })).toBe('bo');
    expect((await prisma.botQuyenDanhTinh.findMany({ where: { orgId: ORG, zaloAccountId: CL }, orderBy: { zaloUid: 'asc' } }))
      .map((r) => [r.zaloUid, r.globalId, r.nguon])).toEqual([[HUNG_CL, G_HUNG, 'zalo_user_info'], [CL_SELF, G_CL, 'zalo_nick_ket_noi']]);
  });

  // ── P3-4 ─────────────────────────────────────────────────────────────────────

  it('P3-4: ngăn Thành viên — đọc Zalo tính 2 lượt vào ds_group_read; mở lại trong 2 phút dùng đệm; lamMoi đọc lại; hết ngân sách ⇒ rơi về người đã nhắn', async () => {
    await dung();
    let doc = 0;
    const docZalo: DocThanhVienZalo = async () => { doc++; return [{ zaloUid: HUNG_VT, ten: 'Trần Hưng' }, { zaloUid: QUOC_VT, ten: 'Viết Quốc' }]; };
    const app2 = Fastify({ logger: false });
    await app2.register(fastifyJwt, { secret: config.jwtSecret });
    await app2.register(registerBotQuyenRoutes, { prefix: BASE, docThanhVienZalo: docZalo });
    await app2.ready();
    try {
      _datThanhVienChoTest({ tranNgay: async () => 5 });
      const mo = (q = '') => app2.inject({ method: 'GET', url: `${BASE}/nhom/bqzi-p1/thanh-vien${q}`, headers: { authorization: `Bearer ${token()}` } });
      const r1 = (await mo()).json();
      expect([r1.nguon, doc, await daDungHomNay(VT, NS_DOC_NHOM)]).toEqual(['zalo', 1, 2]);
      const r2 = (await mo()).json();
      expect([r2.nguon, doc, await daDungHomNay(VT, NS_DOC_NHOM)]).toEqual(['zalo', 1, 2]); // đệm
      expect(r2.nguonLuc).toBe(r1.nguonLuc);
      expect([(await mo('?lamMoi=1')).json().nguon, doc, await daDungHomNay(VT, NS_DOC_NHOM)]).toEqual(['zalo', 2, 4]);
      const het = (await mo('?lamMoi=1')).json(); // 4 + 2 > 5
      expect([het.nguon, doc]).toEqual(['tin_nhan', 2]);
      expect(het.loiZalo).toContain('ngân sách');
      expect(het.thanhVien.map((t: { zaloUid: string }) => t.zaloUid).sort()).toEqual([CL_TU_VT, HUNG_VT, QUOC_VT].sort());
    } finally {
      await app2.close();
    }
  });
});
