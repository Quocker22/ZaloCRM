// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 §8b-an-toàn) — lỗi giám sát LIVE bắt được sau khi lên staging (30/09), trên Postgres THẬT:
//   D1 (P0) getGroupMembersInfo qua VTMT trả globalId CỦA CHÍNH VTMT (4LGTI…) cho MỌI thành viên ⇒ globalId của VTMT "nhiễm"
//           ⇒ không nhận ra ai. Nay: globalId thành viên CHỈ qua getUserInfo + rào (globalId của nick gọi trên uid khác ⇒
//           bỏ; cả lô cùng một globalId ⇒ bỏ); dòng hỏng không làm nhiễm; migration dọn dữ liệu staging; dòng nguồn cũ không
//           tính là tươi.
//   D2      nick đã lưu trữ vẫn chọn được ở "Đây là nick CRM…"; đánh dấu tay trái globalId sống ⇒ 409.
//   D3      getUserInfo thiếu một uid (lỗi 216 bị nuốt) KHÔNG hạ globalId tin được về null (nick CRM không chập chờn).
//   D6      thành viên / "Chờ gán" có ĐỀ XUẤT nối vào NV sẵn có ⇒ trả kèm `deXuatNhanVien`.
//   D7      vòng danh tính theo nhịp nửa-burst + ngân sách ngày đọc từ kho bền.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import { registerBotQuyenRoutes } from '../src/modules/bot-quyen/bot-quyen-routes.js';
import { _xoaBanGom } from '../src/modules/bot-quyen/bot-quyen-nguoi-da-nhan.js';
import { docCauHinhCongKhai, _thongKeBoNho } from '../src/modules/bot-quyen/bot-quyen-cong-khai.js';
import { _xoaNhipBoSung } from '../src/modules/bot-quyen/bot-quyen-nhan-vien-uid.js';
import { _epLienKetHong } from '../src/modules/bot-quyen/bot-quyen-cung-nguoi.js';
import { _datBoDocChoTest } from '../src/modules/bot-quyen/bot-quyen-danh-sach.js';
import {
  _datZaloDanhTinhChoTest, layDanhTinhZalo, ghiHoSoNickKetNoi, docBanDanhTinh, type ZaloDanhTinhApi,
} from '../src/modules/bot-quyen/bot-quyen-danh-tinh.js';
import { khoRam, khoaNganSach, ngayUtc, _datNganSachChoTest } from '../src/modules/bot-quyen/bot-quyen-ngan-sach.js';
import { chayDanhTinh, _danhTinhChoTest } from '../src/modules/bot-quyen/bot-quyen-service.js';

const ORG = 'test-bqgs-org';
const ORG2 = 'test-bqgs-org2';
const OWNER = 'test-bqgs-owner';
const BASE = '/api/v1/bot-quyen';
const GOC = Date.now() - 3 * 3600_000;
const MIGRATION = new URL('../prisma/migrations/20260930230000_bot_quyen_danh_tinh_sua_gid_nick/migration.sql', import.meta.url);

// Số thật staging (docs/77 cach-crm-nhan-dien.md §4–§5 + giám sát 30/09).
const VT = 'test-bqgs-vt', TM = 'test-bqgs-tm', CL = 'test-bqgs-cl';
// uid TỰ NHÌN của nick: zalo_accounts.zalo_uid UNIQUE toàn DB ⇒ thêm đuôi (file test khác dựng cùng số staging song song).
const VT_SELF = '619833576870383279-gs', TM_SELF = '630640428799521839-gs', CL_SELF = '632106073555356463-gs';
const TM_TU_VT = '2945555577789699285', CL_TU_VT = '1359961729460490730', VT_TU_CL = '1333113565670020202';
const HUNG_VT = '3835588809400259343', QUOC_VT = '5369941570764297136', HUNG_CL = '3395858500519725514';
const G_VT = '4LGTI0826CD3G07NBUGLTVSCHRN7QI80', G_HUNG = 'PODILQ0AIDDJ0211ASEAB2D36R8BD080';
const G_QUOC = 'OGGI1EMNLJHERLBGHBHK365CEMQOG580', G_TM = 'DBBPLBUOP78U5MIGGM0VTARUMCL0JE00', G_CL = 'E4U5VE6TUOJEFNPEG2TUKD82BJ19A8O0';
const THANH_VIEN_VT = [VT_SELF, TM_TU_VT, HUNG_VT, QUOC_VT, CL_TU_VT];

let app: FastifyInstance;
let so = 0;
const ma = (n: number) => String(8_310_000_000_000 + n);

async function donDep() {
  for (const org of [ORG, ORG2]) {
    await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: org } });
    await prisma.botNhomDanhSach.deleteMany({ where: { orgId: org } });
    await prisma.botNhanVien.deleteMany({ where: { orgId: org } });
    await prisma.botNickCrmUid.deleteMany({ where: { orgId: org } });
    await prisma.botQuyenDanhTinh.deleteMany({ where: { orgId: org } });
    await prisma.message.deleteMany({ where: { conversation: { orgId: org } } });
    await prisma.conversation.deleteMany({ where: { orgId: org } });
    await prisma.zaloAccount.deleteMany({ where: { orgId: org } });
    await prisma.user.deleteMany({ where: { orgId: org } });
    await prisma.organization.deleteMany({ where: { id: org } });
  }
}

function token(): string {
  return app.jwt.sign({ id: OWNER, email: `${OWNER}@x.com`, role: 'owner', orgId: ORG, typ: 'access' });
}
async function goi(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url: `${BASE}${url}`, headers: { authorization: `Bearer ${token()}` }, ...(payload ? { payload } : {}) });
}
async function tin(conversationId: string, senderUid: string, giay = 0) {
  so++;
  await prisma.message.create({
    data: {
      id: `test-bqgs-m${so}`, conversationId, zaloMsgId: ma(so), senderType: 'contact', senderUid, senderName: senderUid,
      content: `tin ${so}`, contentType: 'text', sentAt: new Date(GOC + giay * 1000),
    },
  });
}

/**
 * Cổng Zalo GIẢ theo đúng các dạng trả LIVE: `bang` nick → uid → globalId (getUserInfo); `caLoCuaNickGoi` ⇒ trả globalId
 * của nick gọi cho MỌI uid (dạng getGroupMembersInfo đo LIVE qua VTMT); `thieu` = uid Zalo không trả (lỗi 216 bị nuốt).
 */
function giaZalo(
  bang: Record<string, Record<string, string>>,
  o: { caLoCuaNickGoi?: Record<string, string>; thieu?: Set<string> } = {},
): ZaloDanhTinhApi & { hoi: Array<{ nick: string; uids: string[] }> } {
  const hoi: Array<{ nick: string; uids: string[] }> = [];
  return {
    hoi,
    async thongTin(nick, uids) {
      hoi.push({ nick, uids: [...uids] });
      const m = new Map<string, { globalId: string | null; ten: string | null }>();
      for (const u of uids) {
        if (o.thieu?.has(u)) continue;
        const g = o.caLoCuaNickGoi?.[nick] ?? bang[nick]?.[u];
        if (g !== undefined) m.set(u, { globalId: g, ten: null });
      }
      return m;
    },
    async timSdt() { return null; },
  };
}
const BANG_THAT: Record<string, Record<string, string>> = {
  [VT]: { [VT_SELF]: G_VT, [HUNG_VT]: G_HUNG, [QUOC_VT]: G_QUOC, [TM_TU_VT]: G_TM, [CL_TU_VT]: G_CL },
  [TM]: { [TM_SELF]: G_TM },
  [CL]: { [CL_SELF]: G_CL, [HUNG_CL]: G_HUNG, [VT_TU_CL]: G_VT },
};

async function dungStaging(o: { tmLuuTru?: boolean } = {}) {
  const tao = (id: string, zaloUid: string, displayName: string, archivedAt: Date | null = null) =>
    prisma.zaloAccount.create({ data: { id, orgId: ORG, ownerUserId: OWNER, zaloUid, displayName, status: 'disconnected', archivedAt } });
  await tao(VT, VT_SELF, 'Vận Tải Minh Thức');
  await tao(TM, TM_SELF, 'Tiểu Mã Nelia', o.tmLuuTru ? new Date() : null);
  await tao(CL, CL_SELF, 'Cẩm Loan');
  await prisma.conversation.create({
    data: { id: 'bqgs-p1', orgId: ORG, zaloAccountId: VT, threadType: 'group', externalThreadId: 'ext-bqgs-p1', groupName: 'private 1', lastMessageAt: new Date() },
  });
  await prisma.conversation.create({
    data: { id: 'bqgs-ai', orgId: ORG, zaloAccountId: CL, threadType: 'group', externalThreadId: 'ext-bqgs-ai', groupName: 'AI dev test', lastMessageAt: new Date() },
  });
  for (const u of [HUNG_VT, QUOC_VT, TM_TU_VT, CL_TU_VT]) await tin('bqgs-p1', u);
  for (const u of [HUNG_CL, VT_TU_CL]) await tin('bqgs-ai', u);
  await prisma.botNhomDanhSach.create({ data: { orgId: ORG, conversationId: 'bqgs-p1', zaloAccountId: VT, uids: THANH_VIEN_VT, dayDu: true, canDocLai: false, docLuc: new Date() } });
  await prisma.botNhomDanhSach.create({ data: { orgId: ORG, conversationId: 'bqgs-ai', zaloAccountId: CL, uids: [CL_SELF, HUNG_CL, VT_TU_CL], dayDu: true, canDocLai: false, docLuc: new Date() } });
}

/** Chạy file migration dọn dữ liệu (từng câu — $executeRawUnsafe không nhận nhiều câu). */
async function chayMigration() {
  const cau = readFileSync(MIGRATION, 'utf8').split('\n').filter((d) => !d.trim().startsWith('--')).join('\n')
    .split(';').map((x) => x.trim()).filter(Boolean);
  for (const c of cau) await prisma.$executeRawUnsafe(c);
}

const dong = (nick: string, uid: string) => prisma.botQuyenDanhTinh.findUnique({
  where: { orgId_zaloAccountId_zaloUid: { orgId: ORG, zaloAccountId: nick, zaloUid: uid } },
});

describeCanDb('bot-quyen — lỗi giám sát LIVE (D1–D7)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.organization.create({ data: { id: ORG, name: 'BQGS' } });
    await prisma.organization.create({ data: { id: ORG2, name: 'BQGS2' } });
    await prisma.user.create({ data: { id: OWNER, orgId: ORG, email: `${OWNER}@x.com`, passwordHash: 'x', fullName: 'Chủ', role: 'owner', isActive: true } });
    app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: config.jwtSecret });
    await app.register(registerBotQuyenRoutes, { prefix: BASE, docThanhVienZalo: async () => [] });
    await app.ready();
  });

  afterAll(async () => {
    _datBoDocChoTest(null);
    _datZaloDanhTinhChoTest(null, { tranNgay: null });
    _datNganSachChoTest({ kho: null });
    await _danhTinhChoTest({ treMs: 3000 });
    await app?.close();
    await donDep();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    _xoaBanGom();
    _xoaNhipBoSung();
    _thongKeBoNho(true);
    _epLienKetHong(false);
    await _danhTinhChoTest({ treMs: -1 });
    _datZaloDanhTinhChoTest(giaZalo({}));
    _datBoDocChoTest(async () => ({ gridInfoMap: {} }));
    _datNganSachChoTest({ kho: null });
    const orgId = ORG;
    await prisma.botQuyenNhatKy.deleteMany({ where: { orgId } });
    await prisma.botNhomDanhSach.deleteMany({ where: { orgId } });
    await prisma.botNhanVien.deleteMany({ where: { orgId } });
    await prisma.botNickCrmUid.deleteMany({ where: { orgId } });
    await prisma.botQuyenDanhTinh.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await prisma.message.deleteMany({ where: { conversation: { orgId } } });
    await prisma.conversation.deleteMany({ where: { orgId } });
    await prisma.zaloAccount.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
  });

  // ── D1 ─────────────────────────────────────────────────────────────────────

  it('D1: Zalo trả globalId của NICK GỌI cho mọi thành viên (dạng LIVE) ⇒ không ghi globalId nào, globalId VTMT KHÔNG nhiễm, VTMT vẫn nhận ra từ Cẩm Loan', async () => {
    await dungStaging();
    // Lúc nối: zalo-pool lưu hồ sơ sống của chính VTMT (globalId đúng).
    await ghiHoSoNickKetNoi(VT, VT_SELF, { globalId: G_VT, zaloName: 'Vận Tải Minh Thức', phoneNumber: '+84876628854' });
    const g = giaZalo(BANG_THAT, { caLoCuaNickGoi: { [VT]: G_VT } });
    _datZaloDanhTinhChoTest(g);
    const kq = await layDanhTinhZalo(ORG);
    expect(kq.boRao).toBe(4);
    // VTMT đã có globalId tin được ⇒ không hỏi lại chính nó; 4 thành viên bị bỏ (cả lô cùng globalId)
    expect(g.hoi.find((x) => x.nick === VT)!.uids.sort()).toEqual([TM_TU_VT, HUNG_VT, QUOC_VT, CL_TU_VT].sort());
    const vt = await prisma.botQuyenDanhTinh.findMany({ where: { orgId: ORG, zaloAccountId: VT }, orderBy: { zaloUid: 'asc' } });
    expect(vt.filter((r) => r.globalId === G_VT).map((r) => r.zaloUid)).toEqual([VT_SELF]);
    expect(vt.filter((r) => r.zaloUid !== VT_SELF).every((r) => r.globalId === null && r.loi === 'lo_trung_gid')).toBe(true);
    const ban = await docBanDanhTinh(ORG);
    expect(ban.nhiem.has(G_VT)).toBe(false);
    await chayDanhTinh(ORG);
    const cfg = await docCauHinhCongKhai(ORG);
    // Cẩm Loan nhìn VTMT = 1333… (globalId đúng) ⇒ VTMT là nick CRM nhìn từ Cẩm Loan; KHÔNG ai ở VTMT bị nhận nhầm là VTMT
    expect(cfg.nick_crm).toEqual([{ nick_uid: CL_SELF, uid: VT_TU_CL, nick_ten: 'Vận Tải Minh Thức' }]);
  });

  it('D1: một uid mang globalId của nick gọi (lô lẫn) ⇒ bỏ RIÊNG uid đó; người khác ghi đúng; hỏi uid của chính nick TRƯỚC khi chưa biết globalId của nick', async () => {
    await dungStaging();
    const bang = structuredClone(BANG_THAT);
    bang[VT][TM_TU_VT] = G_VT; // Zalo trả sai cho riêng Tiểu Mã
    const g = giaZalo(bang);
    _datZaloDanhTinhChoTest(g);
    await layDanhTinhZalo(ORG);
    expect(g.hoi.find((x) => x.nick === VT)!.uids[0]).toBe(VT_SELF);
    expect((await dong(VT, TM_TU_VT))).toMatchObject({ globalId: null, loi: 'gid_cua_nick_goi' });
    expect((await dong(VT, HUNG_VT))).toMatchObject({ globalId: G_HUNG, nguon: 'zalo_user_info', loi: null });
    expect((await dong(VT, VT_SELF))).toMatchObject({ globalId: G_VT, nguon: 'zalo_user_info' });
  });

  it('D1: migration dọn đúng dữ liệu staging (xoá 4 dòng mang globalId VTMT, giữ dòng VTMT, chỉ trong org/nick đó), chạy lại vô hại; vòng kế đọc lại bằng getUserInfo ⇒ Hưng/Quốc nối, Tiểu Mã/Cẩm Loan là nick CRM', async () => {
    await dungStaging();
    // Dữ liệu staging sau bản 3f75953 (crm-sau-1.txt): 5 dòng nguồn 'zalo_api' cùng globalId VTMT.
    const cu = new Date();
    for (const u of THANH_VIEN_VT) {
      await prisma.botQuyenDanhTinh.create({ data: { orgId: ORG, zaloAccountId: VT, zaloUid: u, globalId: G_VT, nguon: 'zalo_api', layLuc: cu } });
    }
    // dòng cũ hợp lệ ở nick khác (không đụng, chỉ hết tươi)
    await prisma.botQuyenDanhTinh.create({ data: { orgId: ORG, zaloAccountId: CL, zaloUid: HUNG_CL, globalId: G_HUNG, nguon: 'zalo_api', layLuc: cu } });
    // org KHÁC: nick có globalId riêng, một dòng khác uid mang globalId VTMT ⇒ không phải globalId của nick ĐÓ ⇒ giữ
    await prisma.zaloAccount.create({ data: { id: 'test-bqgs-o2', orgId: ORG2, ownerUserId: OWNER, zaloUid: 'o2-self', displayName: 'O2', status: 'disconnected' } });
    await prisma.botQuyenDanhTinh.create({ data: { orgId: ORG2, zaloAccountId: 'test-bqgs-o2', zaloUid: 'o2-self', globalId: 'G-O2', nguon: 'zalo_api' } });
    await prisma.botQuyenDanhTinh.create({ data: { orgId: ORG2, zaloAccountId: 'test-bqgs-o2', zaloUid: 'o2-x', globalId: G_VT, nguon: 'zalo_api' } });

    expect((await docBanDanhTinh(ORG)).gid(VT, HUNG_VT)).toBeNull(); // nguồn cũ không phải bằng chứng
    await chayMigration();
    await chayMigration(); // idempotent
    const vt = await prisma.botQuyenDanhTinh.findMany({ where: { orgId: ORG, zaloAccountId: VT } });
    expect(vt.map((r) => [r.zaloUid, r.globalId, r.nguon])).toEqual([[VT_SELF, G_VT, 'zalo_nick_ket_noi']]);
    expect(await dong(CL, HUNG_CL)).toMatchObject({ globalId: G_HUNG, nguon: 'zalo_api' });
    expect((await dong(CL, HUNG_CL))!.layLuc.getTime()).toBe(0);
    expect(await prisma.botQuyenDanhTinh.count({ where: { orgId: ORG2 } })).toBe(2);

    const hung = (await goi('POST', '/nhan-vien', { zaloUid: HUNG_CL, tenGoi: 'Trần Hưng', vai: 'admin' })).json().nhanVien;
    const quoc = (await goi('POST', '/nhan-vien', { zaloUid: QUOC_VT, tenGoi: 'Viết Quốc', vai: 'admin' })).json().nhanVien;
    await ghiHoSoNickKetNoi(TM, TM_SELF, { globalId: G_TM, zaloName: 'Tiểu Mã Nelia' });
    await ghiHoSoNickKetNoi(CL, CL_SELF, { globalId: G_CL, zaloName: 'Cẩm Loan' });
    const g = giaZalo(BANG_THAT);
    _datZaloDanhTinhChoTest(g);
    await chayDanhTinh(ORG);
    // getUserInfo đọc lại mọi uid đã xoá + dòng cũ hết tươi
    expect(g.hoi.filter((x) => x.nick === VT).flatMap((x) => x.uids)).toEqual(expect.arrayContaining([TM_TU_VT, HUNG_VT, QUOC_VT, CL_TU_VT]));
    expect(g.hoi.filter((x) => x.nick === CL).flatMap((x) => x.uids)).toContain(HUNG_CL);
    const cfg = await docCauHinhCongKhai(ORG);
    expect(cfg.nick_crm.map((k) => k.uid).sort()).toEqual([CL_TU_VT, TM_TU_VT, VT_TU_CL].sort());
    expect(cfg.nhan_vien.find((n) => n.zalo_uid === HUNG_CL)!.uids.map((u) => [u.uid, u.nguon]))
      .toEqual([[HUNG_CL, 'chu_chon'], [HUNG_VT, 'zalo_global_id']]);
    void quoc;
    void hung;
  });

  it('D1: dòng nguồn cũ (zalo_api) dù vừa đọc vẫn KHÔNG tươi ⇒ đọc lại; dòng tin được còn tươi ⇒ không đọc lại', async () => {
    await dungStaging();
    await prisma.botQuyenDanhTinh.create({ data: { orgId: ORG, zaloAccountId: VT, zaloUid: HUNG_VT, globalId: G_HUNG, nguon: 'zalo_api' } });
    await prisma.botQuyenDanhTinh.create({ data: { orgId: ORG, zaloAccountId: VT, zaloUid: QUOC_VT, globalId: G_QUOC, nguon: 'zalo_user_info' } });
    const g = giaZalo(BANG_THAT);
    _datZaloDanhTinhChoTest(g);
    await layDanhTinhZalo(ORG);
    const hoiVt = g.hoi.filter((x) => x.nick === VT).flatMap((x) => x.uids);
    expect(hoiVt).toContain(HUNG_VT);
    expect(hoiVt).not.toContain(QUOC_VT);
    expect(await dong(VT, HUNG_VT)).toMatchObject({ nguon: 'zalo_user_info', globalId: G_HUNG });
  });

  // ── D3 ─────────────────────────────────────────────────────────────────────

  it('D3: getUserInfo THIẾU một uid (lỗi 216 bị nuốt) ⇒ giữ globalId tin được cũ + ghi lỗi; nick CRM không bị gỡ', async () => {
    await dungStaging();
    await ghiHoSoNickKetNoi(TM, TM_SELF, { globalId: G_TM, zaloName: 'Tiểu Mã Nelia' });
    _datZaloDanhTinhChoTest(giaZalo(BANG_THAT));
    await chayDanhTinh(ORG);
    expect((await docCauHinhCongKhai(ORG)).nick_crm.map((k) => k.uid)).toContain(TM_TU_VT);
    // đọc lại (nick nối lại) mà lần này Zalo không trả Tiểu Mã; và trả hồ sơ KHÔNG có globalId cho Cẩm Loan
    await prisma.botQuyenDanhTinh.updateMany({ where: { orgId: ORG, zaloAccountId: VT, zaloUid: { not: VT_SELF } }, data: { layLuc: new Date(0) } });
    const bang = structuredClone(BANG_THAT);
    bang[VT][CL_TU_VT] = '';
    _datZaloDanhTinhChoTest(giaZalo(bang, { thieu: new Set([TM_TU_VT]) }));
    await chayDanhTinh(ORG);
    expect(await dong(VT, TM_TU_VT)).toMatchObject({ globalId: G_TM, loi: 'khong_tra', nguon: 'zalo_user_info' });
    expect(await dong(VT, CL_TU_VT)).toMatchObject({ globalId: G_CL, loi: 'gid_rong' });
    expect((await dong(VT, TM_TU_VT))!.layLuc.getTime()).toBeGreaterThan(0);
    expect((await docCauHinhCongKhai(ORG)).nick_crm.map((k) => k.uid)).toEqual(expect.arrayContaining([TM_TU_VT, CL_TU_VT]));
    expect(await prisma.botQuyenNhatKy.count({ where: { orgId: ORG, lyDo: { contains: 'không còn trùng' } } })).toBe(0);
    // hồ sơ lúc nối không có globalId ⇒ cũng không hạ
    await ghiHoSoNickKetNoi(TM, TM_SELF, { zaloName: 'Tiểu Mã Nelia' });
    expect(await dong(TM, TM_SELF)).toMatchObject({ globalId: G_TM });
  });

  // ── D2 ─────────────────────────────────────────────────────────────────────

  it('D2: nick ĐÃ LƯU TRỮ vẫn có trong "Đây là nick CRM…" (daLuuTru) và đánh dấu được; uid nick lưu trữ vẫn là người công ty', async () => {
    await dungStaging({ tmLuuTru: true });
    const r = await goi('GET', '/nhom/bqgs-p1/thanh-vien');
    expect(r.statusCode).toBe(200);
    expect(r.json().nickKhac).toEqual([
      { id: CL, ten: 'Cẩm Loan', daLuuTru: false }, { id: TM, ten: 'Tiểu Mã Nelia', daLuuTru: true },
    ]);
    const d = await goi('POST', '/nhom/bqgs-p1/nick-crm', { zaloUid: TM_TU_VT, nickId: TM, lyDo: 'nick Tiểu Mã (đã lưu trữ)' });
    expect(d.statusCode).toBe(200);
    expect((await docCauHinhCongKhai(ORG)).nick_crm).toContainEqual({ nick_uid: VT_SELF, uid: TM_TU_VT, nick_ten: 'Tiểu Mã Nelia' });
    const tv = (await goi('GET', '/nhom/bqgs-p1/thanh-vien')).json().thanhVien as Array<{ zaloUid: string; loai: string }>;
    expect(tv.find((x) => x.zaloUid === TM_TU_VT)!.loai).toBe('nick_crm');
  });

  it('D2: đánh dấu tay mà globalId SỐNG của uid KHÁC globalId của nick chọn ⇒ 409 GLOBAL_ID_KHAC; trùng / chưa biết ⇒ được', async () => {
    await dungStaging();
    await ghiHoSoNickKetNoi(TM, TM_SELF, { globalId: G_TM, zaloName: 'Tiểu Mã Nelia' });
    await ghiHoSoNickKetNoi(CL, CL_SELF, { globalId: G_CL, zaloName: 'Cẩm Loan' });
    _datZaloDanhTinhChoTest(giaZalo(BANG_THAT));
    await layDanhTinhZalo(ORG);
    // Hưng (globalId PODILQ…) đánh dấu là nick Tiểu Mã ⇒ Zalo nói khác ⇒ chặn
    const sai = await goi('POST', '/nhom/bqgs-p1/nick-crm', { zaloUid: HUNG_VT, nickId: TM, lyDo: 'nhầm' });
    expect(sai.statusCode).toBe(409);
    expect(sai.json().code).toBe('GLOBAL_ID_KHAC');
    expect(await prisma.botNickCrmUid.count({ where: { orgId: ORG, zaloUid: HUNG_VT } })).toBe(0);
    // đúng nick ⇒ được
    expect((await goi('POST', '/nhom/bqgs-p1/nick-crm', { zaloUid: CL_TU_VT, nickId: CL, lyDo: 'đúng' })).statusCode).toBe(200);
    // nick chưa có globalId (chưa từng nối sau bản này) ⇒ không đủ bằng chứng để chặn ⇒ được
    await prisma.botQuyenDanhTinh.deleteMany({ where: { orgId: ORG, zaloAccountId: TM } });
    expect((await goi('POST', '/nhom/bqgs-p1/nick-crm', { zaloUid: TM_TU_VT, nickId: TM })).statusCode).toBe(200);
  });

  // ── D6 ─────────────────────────────────────────────────────────────────────

  it('D6: uid có ĐỀ XUẤT nối vào NV sẵn có ⇒ ngăn Thành viên + "Chờ gán" trả kèm deXuatNhanVien (trang hiện Nối/Không phải thay cho Đặt làm NV)', async () => {
    await dungStaging();
    const hung = (await goi('POST', '/nhan-vien', { zaloUid: HUNG_CL, tenGoi: 'Trần Hưng', vai: 'admin' })).json().nhanVien;
    await prisma.botNhanVienUidDeXuat.create({
      data: { orgId: ORG, nhanVienId: hung.id, zaloUid: HUNG_VT, zaloAccountId: VT, soTin: 236, bangChung: { soTin: 236, maTin: [] } },
    });
    const tv = (await goi('GET', '/nhom/bqgs-p1/thanh-vien')).json().thanhVien as Array<{ zaloUid: string; loai: string; deXuatNhanVien: unknown[] }>;
    expect(tv.find((x) => x.zaloUid === HUNG_VT)).toMatchObject({
      loai: 'nguoi_ngoai', deXuatNhanVien: [{ id: hung.id, tenGoi: 'Trần Hưng', vai: 'admin', soTin: 236 }],
    });
    expect(tv.find((x) => x.zaloUid === QUOC_VT)!.deXuatNhanVien).toEqual([]);
    const cho = (await goi('GET', '/nguoi-da-nhan?lamMoi=1')).json().ungVien as Array<{ uids: Array<{ zaloUid: string }>; deXuatNhanVien: unknown[] }>;
    const dongHung = cho.find((u) => u.uids.some((x) => x.zaloUid === HUNG_VT))!;
    expect(dongHung.deXuatNhanVien).toEqual([{ id: hung.id, tenGoi: 'Trần Hưng', zaloUid: HUNG_VT, soTin: 236 }]);
    expect(cho.find((u) => u.uids.some((x) => x.zaloUid === QUOC_VT))!.deXuatNhanVien).toEqual([]);
  });

  // ── D7 ─────────────────────────────────────────────────────────────────────

  it('D7: mỗi lời gọi getUserInfo chờ nhịp query; ngân sách ngày đọc từ kho BỀN (đã dùng hết trước khởi động lại ⇒ không gọi)', async () => {
    await dungStaging();
    const nhip: string[] = [];
    const g = giaZalo(BANG_THAT);
    _datZaloDanhTinhChoTest(g, { tranNgay: 2, nhip: async (nick, loai) => { nhip.push(`${nick}|${loai}`); } });
    await layDanhTinhZalo(ORG);
    expect(nhip.length).toBe(g.hoi.length);
    expect(nhip.every((x) => x.endsWith('|query'))).toBe(true);
    // "khởi động lại": RAM mới, kho bền còn số đã dùng = trần
    const kho = khoRam();
    for (const n of [VT, TM, CL]) for (let i = 0; i < 2; i++) await kho.tang(khoaNganSach(n, 'dt_query'), ngayUtc());
    const g2 = giaZalo(BANG_THAT);
    _datZaloDanhTinhChoTest(g2, { tranNgay: 2 });
    _datNganSachChoTest({ kho });
    await prisma.botQuyenDanhTinh.deleteMany({ where: { orgId: ORG } });
    await layDanhTinhZalo(ORG);
    expect(g2.hoi).toEqual([]);
  });
});
