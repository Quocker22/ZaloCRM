// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 §8b-an-toàn) — vá review bảo mật "một NV = nhiều uid Zalo", trên Postgres THẬT:
//   P0   globalId KHÔNG BAO GIỜ là bằng chứng tự nối (chỉ gợi ý ở "Là NV đã có…");
//   P1-1 bằng chứng tin chung CHẶT (mã máy chủ, cùng nhóm, ±5 s, cùng loại, ≥ 2 tin) — mỗi luật một test;
//   rào đặc quyền: chỉ NV sales được tự gắn, vai khác ⇒ đề xuất; đổi vai lên ⇒ hạ về đề xuất;
//   P1-2 gỡ uid (DELETE) + từ chối — máy không nối lại; P2 thêm tay: lý do, không nick CRM, phải đã thấy trong tin;
//   P1-4 đóng an toàn khi truy vấn liên kết hỏng/hết giờ;
//   nick CRM nhìn từ nick khác (ví dụ staging: Tiểu Mã Nelia, Cẩm Loan nhìn từ Vận Tải Minh Thức) ⇒ nhóm nhân viên.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { Prisma } from '@prisma/client';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import { registerBotQuyenRoutes } from '../src/modules/bot-quyen/bot-quyen-routes.js';
import { _xoaBanGom } from '../src/modules/bot-quyen/bot-quyen-nguoi-da-nhan.js';
import { docCauHinhCongKhai, _thongKeBoNho } from '../src/modules/bot-quyen/bot-quyen-cong-khai.js';
import { boSungUidNhanVien, _xoaNhipBoSung } from '../src/modules/bot-quyen/bot-quyen-nhan-vien-uid.js';
import {
  docLienKet, docCoHetGio, _epLienKetHong, _soLanLienKetHong,
} from '../src/modules/bot-quyen/bot-quyen-cung-nguoi.js';
import { _datBoDocChoTest, choHangDoiXong } from '../src/modules/bot-quyen/bot-quyen-danh-sach.js';
import { _datZaloDanhTinhChoTest, layDanhTinhZalo, ghiHoSoNickKetNoi, type ZaloDanhTinhApi } from '../src/modules/bot-quyen/bot-quyen-danh-tinh.js';
import { chayDanhTinh, _danhTinhChoTest } from '../src/modules/bot-quyen/bot-quyen-service.js';

const ORG = 'test-bqat-org';
const OWNER = 'test-bqat-owner';
const A = 'test-bqat-nick-a';
const B = 'test-bqat-nick-b';
const A_UID = 'a-tu-nhin';
const B_UID = 'b-tu-nhin';
const BASE = '/api/v1/bot-quyen';
const GOC = Date.now() - 3 * 3600_000;

let app: FastifyInstance;
let so = 0;
const ma = (n: number) => String(8_210_000_000_000 + n);

async function donDep() {
  await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhomDanhSach.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhom.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhanVien.deleteMany({ where: { orgId: ORG } });
  await prisma.botNickCrmUid.deleteMany({ where: { orgId: ORG } });
  await prisma.botQuyenDanhTinh.deleteMany({ where: { orgId: ORG } });
  await prisma.friend.deleteMany({ where: { orgId: ORG } });
  await prisma.contact.deleteMany({ where: { orgId: ORG } });
  await prisma.groupMember.deleteMany({ where: { orgId: ORG } });
  await prisma.message.deleteMany({ where: { conversation: { orgId: ORG } } });
  await prisma.conversation.deleteMany({ where: { orgId: ORG } });
  await prisma.zaloAccount.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { orgId: ORG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
}

/** Bạn bè của một nick mang globalId (friends.contact_id bắt buộc ⇒ tạo liên hệ). */
async function banBe(acc: string, uid: string, gid: string) {
  so++;
  const c = await prisma.contact.create({ data: { orgId: ORG, fullName: `lh-${so}` } as never, select: { id: true } });
  await prisma.friend.create({ data: { orgId: ORG, contactId: c.id, zaloAccountId: acc, zaloUidInNick: uid, zaloGlobalId: gid } });
}

async function nick(id: string, zaloUid: string, displayName: string) {
  await prisma.zaloAccount.create({ data: { id, orgId: ORG, ownerUserId: OWNER, zaloUid, displayName, status: 'disconnected' } });
}
async function nhom(id: string, nickId: string, ten: string) {
  await prisma.conversation.create({
    data: { id, orgId: ORG, zaloAccountId: nickId, threadType: 'group', externalThreadId: `ext-${id}`, groupName: ten, lastMessageAt: new Date() },
  });
}
type TuyTin = { giay?: number; loai?: string; cli?: string | null; senderType?: string };
async function tin(conversationId: string, msg: string, senderUid: string, o: TuyTin = {}) {
  so++;
  await prisma.message.create({
    data: {
      id: `test-bqat-m${so}`, conversationId, zaloMsgId: msg, zaloCliMsgId: o.cli ?? null, senderType: o.senderType ?? 'contact',
      senderUid, senderName: senderUid, content: `tin ${msg}`, contentType: o.loai ?? 'text',
      sentAt: new Date(GOC + (o.giay ?? 0) * 1000),
    },
  });
}
/** Cùng một tin nhóm, hai nick cùng ghi. `lechGiay` = độ lệch sent_at ở bản của nick B. */
async function tinChung(ca: string, cb: string, msg: string, ua: string, ub: string, giay: number, o: { lechGiay?: number; loaiB?: string; cli?: string } = {}) {
  await tin(ca, msg, ua, { giay, cli: o.cli });
  await tin(cb, msg, ub, { giay: giay + (o.lechGiay ?? 0), loai: o.loaiB, cli: o.cli });
}

function token(): string {
  return app.jwt.sign({ id: OWNER, email: `${OWNER}@x.com`, role: 'owner', orgId: ORG, typ: 'access' });
}
async function goi(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url: `${BASE}${url}`, headers: { authorization: `Bearer ${token()}` }, ...(payload ? { payload } : {}) });
}
/** Cổng Zalo GIẢ: bảng nick → uid → globalId; sđt `${nick}|${sđt}` → kết quả findUser; đếm số lần gọi. */
function giaZalo(
  bang: Record<string, Record<string, string>>,
  sdt: Record<string, { uid: string; globalId: string | null; ten?: string }> = {},
  o: { nem?: boolean } = {},
): ZaloDanhTinhApi & { dem: { thongTin: number; sdt: number }; hoi: string[]; tra: string[] } {
  const dem = { thongTin: 0, sdt: 0 };
  const hoi: string[] = [];
  const tra: string[] = [];
  return {
    dem, hoi, tra,
    async thongTin(nick, uids) {
      dem.thongTin++;
      hoi.push(...uids);
      if (o.nem) throw new Error('Zalo lỗi (giả)');
      const m = new Map<string, { globalId: string | null; ten: string | null }>();
      for (const u of uids) if (bang[nick]?.[u] !== undefined) m.set(u, { globalId: bang[nick][u], ten: null });
      return m;
    },
    async timSdt(nick, so) {
      dem.sdt++;
      tra.push(`${nick}|${so}`);
      const k = sdt[`${nick}|${so}`];
      return k ? { uid: k.uid, globalId: k.globalId, ten: k.ten ?? null } : null;
    },
  };
}

/** Dựng ba nick staging (Vận Tải, Tiểu Mã, Cẩm Loan), hai nhóm của Vận Tải + bản đọc thành viên, và bảng globalId thật. */
async function dungStaging(o: { tmTrongDanhSach?: boolean } = {}) {
  const VT = 'test-bqat-vt', TM = 'test-bqat-tm', CL = 'test-bqat-cl';
  const VT_SELF = '619833576870383279', TM_SELF = '630640428799521839', CL_SELF = '632106073555356463';
  const TM_TU_VT = '2945555577789699285', CL_TU_VT = '1359961729460490730', VT_TU_CL = '1333113565670020202';
  const HUNG_CL = '3395858500519725514', HUNG_VT = '3835588809400259343';
  const QUOC_VT = '5369941570764297136', QUOC_CL = '5809610033196845429';
  await prisma.zaloAccount.create({ data: { id: VT, orgId: ORG, ownerUserId: OWNER, zaloUid: VT_SELF, displayName: 'Vận Tải Minh Thức', status: 'disconnected', phone: '0902000001' } });
  await prisma.zaloAccount.create({ data: { id: TM, orgId: ORG, ownerUserId: OWNER, zaloUid: TM_SELF, displayName: 'Tiểu Mã Nelia', status: 'disconnected', phone: '0902000002' } });
  await prisma.zaloAccount.create({ data: { id: CL, orgId: ORG, ownerUserId: OWNER, zaloUid: CL_SELF, displayName: 'Cẩm Loan', status: 'disconnected' } });
  await nhom('p1-vt', VT, 'private 1');
  await nhom('ln-vt', VT, 'Led Nelia, Trần Hưng');
  await nhom('ai-cl', CL, 'AI dev test');
  await tin('p1-vt', ma(2001), HUNG_VT);
  await tin('ai-cl', ma(2002), HUNG_CL);
  await tin('ai-cl', ma(2003), QUOC_CL);
  await tin('p1-vt', ma(2004), QUOC_VT);
  for (const [cid, khac] of [['p1-vt', TM_TU_VT], ['ln-vt', CL_TU_VT]] as const) {
    const uids = [VT_SELF, HUNG_VT, QUOC_VT, ...(o.tmTrongDanhSach === false && khac === TM_TU_VT ? [] : [khac])];
    await prisma.botNhomDanhSach.create({ data: { orgId: ORG, conversationId: cid, zaloAccountId: VT, uids, dayDu: true, canDocLai: false, docLuc: new Date() } });
  }
  await prisma.botNhomDanhSach.create({ data: { orgId: ORG, conversationId: 'ai-cl', zaloAccountId: CL, uids: [CL_SELF, HUNG_CL, QUOC_CL, VT_TU_CL], dayDu: true, canDocLai: false, docLuc: new Date() } });
  // globalId KHÔNG đổi theo nick nhìn — cùng người/nick ⇒ cùng globalId.
  const bang: Record<string, Record<string, string>> = {
    [VT]: { [VT_SELF]: 'G-VT', [HUNG_VT]: 'G-HUNG', [QUOC_VT]: 'G-QUOC', [TM_TU_VT]: 'G-TM', [CL_TU_VT]: 'G-CL' },
    [TM]: { [TM_SELF]: 'G-TM' },
    [CL]: { [CL_SELF]: 'G-CL', [HUNG_CL]: 'G-HUNG', [QUOC_CL]: 'G-QUOC', [VT_TU_CL]: 'G-VT' },
  };
  return {
    VT, TM, CL, VT_SELF, TM_SELF, CL_SELF, TM_TU_VT, CL_TU_VT, HUNG_CL, HUNG_VT, QUOC_VT, QUOC_CL, bang,
    don: async () => {
      const cids = ['p1-vt', 'ln-vt', 'ai-cl'];
      await prisma.botNhomDanhSach.deleteMany({ where: { orgId: ORG } });
      await prisma.botNhanVien.deleteMany({ where: { orgId: ORG } });
      await prisma.message.deleteMany({ where: { conversationId: { in: cids } } });
      await prisma.conversation.deleteMany({ where: { id: { in: cids } } });
      await prisma.zaloAccount.deleteMany({ where: { id: { in: [VT, TM, CL] } } });
    },
  };
}

const lienKetGiua = async (x: string, y: string) => (await docLienKet(ORG, [x])).filter((l) => l.b === y);

/** Kịch bản CHUẨN (đủ mọi luật): P (pa ở A, pb ở B) 2 tin chung + Q (qa/qb) 1 tin chung ⇒ trùng thành viên. */
async function kichBanChuan(p: string, ten = 'Nhóm chung') {
  await nhom(`${p}-a`, A, ten);
  await nhom(`${p}-b`, B, ten);
  await tinChung(`${p}-a`, `${p}-b`, ma(so * 10 + 1), `${p}pa`, `${p}pb`, 0);
  await tinChung(`${p}-a`, `${p}-b`, ma(so * 10 + 2), `${p}pa`, `${p}pb`, 60);
  await tinChung(`${p}-a`, `${p}-b`, ma(so * 10 + 3), `${p}qa`, `${p}qb`, 120);
}

describeCanDb('bot-quyen — an toàn "một NV nhiều uid" (§8b-an-toàn)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.organization.create({ data: { id: ORG, name: 'BQAT' } });
    await prisma.user.create({ data: { id: OWNER, orgId: ORG, email: `${OWNER}@x.com`, passwordHash: 'x', fullName: 'Chủ', role: 'owner', isActive: true } });
    await nick(A, A_UID, 'Nick A');
    await nick(B, B_UID, 'Nick B');
    app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: config.jwtSecret });
    await app.register(registerBotQuyenRoutes, { prefix: BASE, docThanhVienZalo: async () => [] });
    await app.ready();
  });

  afterAll(async () => {
    _datBoDocChoTest(null);
    _datZaloDanhTinhChoTest(null, { tranNgay: null });
    await _danhTinhChoTest({ treMs: 3000 });
    await choHangDoiXong();
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
    await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: ORG } });
    await prisma.botNhomDanhSach.deleteMany({ where: { orgId: ORG } });
    await prisma.botNhanVien.deleteMany({ where: { orgId: ORG } });
    await prisma.botNickCrmUid.deleteMany({ where: { orgId: ORG } });
    await prisma.botQuyenDanhTinh.deleteMany({ where: { orgId: ORG } });
  });
  afterEach(async () => {
    _epLienKetHong(false);
    await _danhTinhChoTest();
  });

  // ── P1-1: luật tin chung CHẶT — đối chứng dương rồi từng luật ────────────────

  it('đối chứng: đủ mọi luật ⇒ có liên kết (2 tin, bằng chứng mang mã tin)', async () => {
    await kichBanChuan('dc');
    const l = await lienKetGiua('dcpa', 'dcpb');
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ nickA: A, nickB: B, so: 2 });
    expect(l[0].maTin).toHaveLength(2);
  });

  it('mã tin là cliMsgId dự phòng (zalo_msg_id = zalo_cli_msg_id) ⇒ KHÔNG liên kết', async () => {
    await nhom('cli-a', A, 'Nhóm cli');
    await nhom('cli-b', B, 'Nhóm cli');
    for (const [i, g] of [[1, 0], [2, 60]] as const) await tinChung('cli-a', 'cli-b', ma(900 + i), 'clipa', 'clipb', g, { cli: ma(900 + i) });
    await tinChung('cli-a', 'cli-b', ma(903), 'cliqa', 'cliqb', 120);
    expect(await lienKetGiua('clipa', 'clipb')).toEqual([]);
  });

  it('mã tin giống mốc thời gian ms (cliMsgId lưu vào zalo_msg_id, cột cli trống) ⇒ KHÔNG liên kết', async () => {
    await nhom('ts-a', A, 'Nhóm ts');
    await nhom('ts-b', B, 'Nhóm ts');
    for (const g of [0, 60]) {
      const msMoc = String(GOC + g * 1000 + 7);
      await tinChung('ts-a', 'ts-b', msMoc, 'tspa', 'tspb', g);
    }
    await tinChung('ts-a', 'ts-b', ma(913), 'tsqa', 'tsqb', 120);
    expect(await lienKetGiua('tspa', 'tspb')).toEqual([]);
  });

  it('khác tên nhóm ⇒ KHÔNG liên kết (không phải cùng nhóm Zalo)', async () => {
    await nhom('ten-a', A, 'Nhóm X');
    await nhom('ten-b', B, 'Nhóm Y');
    await tinChung('ten-a', 'ten-b', ma(921), 'tenpa', 'tenpb', 0);
    await tinChung('ten-a', 'ten-b', ma(922), 'tenpa', 'tenpb', 60);
    await tinChung('ten-a', 'ten-b', ma(923), 'tenqa', 'tenqb', 120);
    expect(await lienKetGiua('tenpa', 'tenpb')).toEqual([]);
  });

  it('cùng tên mà KHÔNG trùng thành viên (chỉ tin của một người là chung) ⇒ KHÔNG liên kết; thêm người thứ hai ⇒ có', async () => {
    await nhom('tv-a', A, 'Nhóm tv');
    await nhom('tv-b', B, 'Nhóm tv');
    await tinChung('tv-a', 'tv-b', ma(931), 'tvpa', 'tvpb', 0);
    await tinChung('tv-a', 'tv-b', ma(932), 'tvpa', 'tvpb', 60);
    expect(await lienKetGiua('tvpa', 'tvpb')).toEqual([]);
    await tinChung('tv-a', 'tv-b', ma(933), 'tvqa', 'tvqb', 120);
    expect(await lienKetGiua('tvpa', 'tvpb')).toHaveLength(1);
  });

  it('sent_at lệch > 5 giây ⇒ KHÔNG liên kết; lệch 5 giây vẫn nhận', async () => {
    await nhom('lech-a', A, 'Nhóm lệch');
    await nhom('lech-b', B, 'Nhóm lệch');
    await tinChung('lech-a', 'lech-b', ma(941), 'lechpa', 'lechpb', 0, { lechGiay: 6 });
    await tinChung('lech-a', 'lech-b', ma(942), 'lechpa', 'lechpb', 60, { lechGiay: 6 });
    await tinChung('lech-a', 'lech-b', ma(943), 'lechqa', 'lechqb', 120);
    expect(await lienKetGiua('lechpa', 'lechpb')).toEqual([]);
    await tinChung('lech-a', 'lech-b', ma(944), 'lechpa', 'lechpb', 180, { lechGiay: 5 });
    await tinChung('lech-a', 'lech-b', ma(945), 'lechpa', 'lechpb', 240, { lechGiay: -5 });
    expect((await lienKetGiua('lechpa', 'lechpb'))[0]).toMatchObject({ so: 2 });
  });

  it('khác content_type ⇒ KHÔNG liên kết', async () => {
    await nhom('ct-a', A, 'Nhóm ct');
    await nhom('ct-b', B, 'Nhóm ct');
    await tinChung('ct-a', 'ct-b', ma(951), 'ctpa', 'ctpb', 0, { loaiB: 'image' });
    await tinChung('ct-a', 'ct-b', ma(952), 'ctpa', 'ctpb', 60, { loaiB: 'image' });
    await tinChung('ct-a', 'ct-b', ma(953), 'ctqa', 'ctqb', 120);
    expect(await lienKetGiua('ctpa', 'ctpb')).toEqual([]);
  });

  it('chỉ MỘT tin chung ⇒ KHÔNG liên kết', async () => {
    await nhom('mot-a', A, 'Nhóm một');
    await nhom('mot-b', B, 'Nhóm một');
    await tinChung('mot-a', 'mot-b', ma(961), 'motpa', 'motpb', 0);
    await tinChung('mot-a', 'mot-b', ma(962), 'motqa', 'motqb', 60);
    await tinChung('mot-a', 'mot-b', ma(963), 'motqa', 'motqb', 120);
    expect(await lienKetGiua('motpa', 'motpb')).toEqual([]);
    expect(await lienKetGiua('motqa', 'motqb')).toHaveLength(1);
  });

  // ── P0: globalId không bao giờ là bằng chứng ─────────────────────────────

  it('P0: globalId CHUNG/giữ chỗ giữa uid của hai nick ⇒ KHÔNG nối (NV sales, vòng tự nối, Chờ gán) — chỉ gợi ý', async () => {
    await nhom('gid-a', A, 'Nhóm gid A');
    await nhom('gid-b', B, 'Nhóm gid B');
    await tin('gid-a', ma(971), 'gid-pa');
    await tin('gid-b', ma(972), 'gid-pb');
    // Zalo globalId giữ chỗ dùng chung (và group_members của hai nick cùng mang).
    for (const [acc, uid] of [[A, 'gid-pa'], [B, 'gid-pb']] as const) {
      await banBe(acc, uid, 'GID-GIU-CHO');
      await prisma.groupMember.create({ data: { orgId: ORG, zaloAccountId: acc, groupId: `ext-gid-${acc === A ? 'a' : 'b'}`, memberUid: uid, globalId: 'GID-GIU-CHO' } });
    }
    const nv = (await goi('POST', '/nhan-vien', { zaloUid: 'gid-pa', tenGoi: 'Người P', vai: 'sales' })).json().nhanVien;
    expect(nv.uids.map((u: { zaloUid: string }) => u.zaloUid)).toEqual(['gid-pa']);
    expect(await boSungUidNhanVien(ORG)).toMatchObject({ them: 0, deXuat: 0 });
    expect(await prisma.botNhanVienUid.count({ where: { nhanVienId: nv.id } })).toBe(1);
    const cho = (await goi('GET', '/nguoi-da-nhan?lamMoi=1')).json().ungVien as Array<{ uids: Array<{ zaloUid: string }>; goiYNhanVien: Array<{ id: string; lyDo: string }> }>;
    const pb = cho.find((u) => u.uids.some((x) => x.zaloUid === 'gid-pb'))!;
    expect(pb.uids.map((x) => x.zaloUid)).toEqual(['gid-pb']); // không gộp
    expect(pb.goiYNhanVien).toEqual([{ id: nv.id, tenGoi: 'Người P', lyDo: 'global_id' }]); // chỉ GỢI Ý
    const cfg = await docCauHinhCongKhai(ORG);
    expect(cfg.nhan_vien.find((x) => x.zalo_uid === 'gid-pa')!.uids.map((u) => u.uid)).toEqual(['gid-pa']);
  });

  it('P0: Friend.zaloGlobalId do user CRM ghi (ensure-by-uid) trùng globalId của NV ⇒ KHÔNG nối', async () => {
    await nhom('ug-a', A, 'Nhóm ug A');
    await nhom('ug-b', B, 'Nhóm ug B');
    await tin('ug-a', ma(981), 'ug-nv');
    await tin('ug-b', ma(982), 'ug-ke-gian');
    await banBe(A, 'ug-nv', 'GID-NV');
    const nv = (await goi('POST', '/nhan-vien', { zaloUid: 'ug-nv', tenGoi: 'Admin thật', vai: 'admin' })).json().nhanVien;
    // Một user CRM bất kỳ ghi globalId của admin vào friend của uid khác (đường ensure-by-uid cho phép ghi ô này).
    await banBe(B, 'ug-ke-gian', 'GID-NV');
    _xoaNhipBoSung();
    expect(await boSungUidNhanVien(ORG)).toMatchObject({ them: 0, deXuat: 0 });
    const ds = (await goi('GET', '/nhan-vien')).json().nhanVien as Array<{ id: string; uids: Array<{ zaloUid: string }>; deXuat: unknown[] }>;
    const x = ds.find((n) => n.id === nv.id)!;
    expect(x.uids.map((u) => u.zaloUid)).toEqual(['ug-nv']);
    expect(x.deXuat).toEqual([]);
    expect((await docCauHinhCongKhai(ORG)).nhan_vien.flatMap((n) => n.uids.map((u) => u.uid))).not.toContain('ug-ke-gian');
  });

  // ── Rào đặc quyền + đề xuất + gỡ/từ chối ─────────────────────────────────

  it('tin chung ⇒ ĐỀ XUẤT cho MỌI vai (sales lẫn admin), không tự gắn; "Không phải" ⇒ không đề xuất lại; "Nối" ⇒ chu_xac_nhan', async () => {
    await kichBanChuan('dv');
    const s = (await goi('POST', '/nhan-vien', { zaloUid: 'dvpa', tenGoi: 'P', vai: 'sales' })).json().nhanVien;
    expect(s.uids.map((u: { zaloUid: string }) => u.zaloUid)).toEqual(['dvpa']);
    expect(s.deXuat).toEqual([expect.objectContaining({ zaloUid: 'dvpb', soTin: 2 })]);
    const a = (await goi('POST', '/nhan-vien', { zaloUid: 'dvqa', tenGoi: 'Q', vai: 'admin' })).json().nhanVien;
    expect(a.uids.map((u: { zaloUid: string }) => u.zaloUid)).toEqual(['dvqa']);
    expect(a.deXuat).toEqual([]); // Q chỉ có MỘT tin chung ⇒ chưa đủ bằng chứng
    expect((await docCauHinhCongKhai(ORG)).nhan_vien.map((n) => n.uids.map((u) => u.uid))).toEqual([['dvpa'], ['dvqa']]);
    // "Không phải"
    expect((await goi('POST', `/nhan-vien/${s.id}/de-xuat/dvpb/tu-choi`, { lyDo: 'là em trai' })).json()).toEqual({ doi: true });
    _xoaNhipBoSung();
    expect(await boSungUidNhanVien(ORG)).toMatchObject({ deXuat: 0, them: 0 });
    expect(await prisma.botNhanVienUidDeXuat.count({ where: { nhanVienId: s.id } })).toBe(0);
    expect(await prisma.botNhanVienUidTuChoi.count({ where: { nhanVienId: s.id, zaloUid: 'dvpb' } })).toBe(1);
    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG, doiTuongId: s.id }, orderBy: { luc: 'asc' } });
    expect(nk.at(-1)).toMatchObject({ lyDo: 'là em trai', sau: { tuChoi: { zaloUid: 'dvpb', soTin: 2 } } });
  });

  it('P1-2: DELETE uid — lý do bắt buộc, không gỡ uid chính; gỡ uid nối bằng globalId ⇒ ghi từ chối + nhật ký bằng chứng; máy KHÔNG nối lại', async () => {
    await nhom('go-b', B, 'Nhóm gỡ');
    await tin('go-b', ma(1101), 'gopb');
    const g = giaZalo({ [A]: { [A_UID]: 'G-A', gopa: 'G-P' }, [B]: { [B_UID]: 'G-B', gopb: 'G-P' } });
    _datZaloDanhTinhChoTest(g);
    await tin('go-b', ma(1102), 'gopb');
    await nhom('go-a', A, 'Nhóm gỡ A');
    await tin('go-a', ma(1103), 'gopa');
    const p = (await goi('POST', '/nhan-vien', { zaloUid: 'gopa', tenGoi: 'P', vai: 'admin' })).json().nhanVien;
    await prisma.botNhomDanhSach.create({ data: { orgId: ORG, conversationId: 'go-b', zaloAccountId: B, uids: ['gopb'], dayDu: true, canDocLai: false, docLuc: new Date() } });
    await chayDanhTinh(ORG);
    let cfg = await docCauHinhCongKhai(ORG);
    expect(cfg.nhan_vien.find((n) => n.zalo_uid === 'gopa')!.uids).toEqual([
      { nick_uid: A_UID, uid: 'gopa', nguon: 'chu_chon' }, { nick_uid: B_UID, uid: 'gopb', nguon: 'zalo_global_id' },
    ]);
    expect((await goi('DELETE', `/nhan-vien/${p.id}/uid/gopb`, {})).json().code).toBe('THIEU_LY_DO');
    expect((await goi('DELETE', `/nhan-vien/${p.id}/uid/gopa`, { lyDo: 'x' })).json().code).toBe('KHONG_GO_UID_CHINH');
    const r = await goi('DELETE', `/nhan-vien/${p.id}/uid/gopb`, { lyDo: 'nối sai' });
    expect(r.statusCode).toBe(200);
    expect(r.json().nhanVien.uids.map((u: { zaloUid: string }) => u.zaloUid)).toEqual(['gopa']);
    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG, doiTuongId: p.id }, orderBy: { luc: 'asc' } });
    expect(nk.at(-1)).toMatchObject({
      lyDo: 'nối sai', sau: { uids: ['gopa'], goUid: { zaloUid: 'gopb', nguon: 'zalo_global_id', bangChung: { globalId: 'G-P', uidGoc: 'gopa' } } },
    });
    await chayDanhTinh(ORG);
    expect(await prisma.botNhanVienUid.count({ where: { nhanVienId: p.id } })).toBe(1);
    cfg = await docCauHinhCongKhai(ORG);
    expect(cfg.nhan_vien.find((n) => n.zalo_uid === 'gopa')!.uids.map((u) => u.uid)).toEqual(['gopa']);
    expect((await goi('DELETE', `/nhan-vien/${p.id}/uid/gopb`, { lyDo: 'x' })).json().doi).toBe(false);
    // chủ THÊM TAY lại ⇒ xoá từ chối
    expect((await goi('POST', `/nhan-vien/${p.id}/uid`, { zaloUid: 'gopb', lyDo: 'đúng là anh ấy' })).json().doi).toBe(true);
    expect(await prisma.botNhanVienUidTuChoi.count({ where: { nhanVienId: p.id } })).toBe(0);
  });

  it('P2: thêm tay — uid nick CRM (tự nhìn / nhìn từ nick khác) và uid chưa từng thấy bị từ chối; nick không làm admin', async () => {
    await kichBanChuan('p2');
    const nv = (await goi('POST', '/nhan-vien', { zaloUid: 'p2qa', tenGoi: 'Q', vai: 'kho' })).json().nhanVien;
    expect((await goi('POST', `/nhan-vien/${nv.id}/uid`, { zaloUid: B_UID, lyDo: 'x' })).json().code).toBe('UID_LA_NICK_CRM');
    await prisma.botNickCrmUid.create({ data: { orgId: ORG, zaloAccountId: A, zaloUid: 'b-nhin-tu-a', nickId: B, nguon: 'chu_chon' } });
    expect((await goi('POST', `/nhan-vien/${nv.id}/uid`, { zaloUid: 'b-nhin-tu-a', lyDo: 'x' })).json().code).toBe('UID_LA_NICK_CRM');
    expect((await goi('POST', `/nhan-vien/${nv.id}/uid`, { zaloUid: 'chua-thay-bao-gio', lyDo: 'x' })).json().code).toBe('UID_CHUA_THAY');
    expect((await goi('POST', '/nhan-vien', { zaloUid: 'p2x', zaloUids: ['chua-thay'], tenGoi: 'X', vai: 'sales' })).json().code).toBe('UID_CHUA_THAY');
    // uid chính của nick CRM làm admin ⇒ 400; làm người công ty thì được
    expect((await goi('POST', '/nhan-vien', { zaloUid: 'b-nhin-tu-a', tenGoi: 'Nick B', vai: 'admin' })).json().code).toBe('NICK_KHONG_LAM_ADMIN');
    const ct = await goi('POST', '/nhan-vien', { zaloUid: A_UID, tenGoi: 'Nick A', vai: 'cong_ty', lyDo: 'nick công ty' });
    expect(ct.statusCode).toBe(201);
    expect((await goi('PUT', `/nhan-vien/${ct.json().nhanVien.id}`, { vai: 'admin' })).json().code).toBe('NICK_KHONG_LAM_ADMIN');
    // SĐT sai ⇒ 400
    expect((await goi('PUT', `/nhan-vien/${nv.id}`, { soDienThoai: '12ab' })).json().code).toBe('SDT_KHONG_HOP_LE');
  });

  // ── P1-4: đóng an toàn ───────────────────────────────────────────────────

  it('P1-4: truy vấn quá statement_timeout ⇒ trả mặc định (không liên kết), đếm lần hỏng', async () => {
    const truoc = _soLanLienKetHong();
    const kq = await docCoHetGio(ORG, 'thử hết giờ', Prisma.sql`SELECT pg_sleep(0.5)`, 'MAC_DINH' as unknown, 50);
    expect(kq).toBe('MAC_DINH');
    expect(_soLanLienKetHong()).toBe(truoc + 1);
    // bộ ngắt: cùng truy vấn (org + tên) trong 30 phút ⇒ trả mặc định NGAY, không chạm DB
    expect(await docCoHetGio(ORG, 'thử hết giờ', Prisma.sql`SELECT 1 AS x`, 'MAC_DINH' as unknown)).toBe('MAC_DINH');
    expect(_soLanLienKetHong()).toBe(truoc + 1);
    _epLienKetHong(false); // xoá bộ ngắt
    expect(await docCoHetGio(ORG, 'thử hết giờ', Prisma.sql`SELECT 1 AS x`, 'MAC_DINH' as unknown)).toEqual([{ x: 1 }]);
  });

  it('P1-4: tin chung hỏng ⇒ KHÔNG xoá đề xuất đang có; Zalo lỗi ⇒ KHÔNG nối gì (nhóm vẫn Khách)', async () => {
    await kichBanChuan('hg');
    const nv = (await goi('POST', '/nhan-vien', { zaloUid: 'hgpa', tenGoi: 'P', vai: 'admin' })).json().nhanVien;
    expect(nv.deXuat.map((d: { zaloUid: string }) => d.zaloUid)).toEqual(['hgpb']);
    _epLienKetHong(true);
    _xoaNhipBoSung();
    expect(await boSungUidNhanVien(ORG)).toMatchObject({ them: 0, deXuat: 0 });
    expect(await prisma.botNhanVienUidDeXuat.count({ where: { nhanVienId: nv.id } })).toBe(1);
    _epLienKetHong(false);
    // Zalo ném lỗi ⇒ không ghi globalId ⇒ không nối
    const g = giaZalo({ [A]: { hgpa: 'G-HG' }, [B]: { hgpb: 'G-HG' } }, {}, { nem: true });
    _datZaloDanhTinhChoTest(g);
    await prisma.botNhomDanhSach.create({ data: { orgId: ORG, conversationId: 'hg-b', zaloAccountId: B, uids: ['hgpb', B_UID], dayDu: true, canDocLai: false, docLuc: new Date() } });
    const lay = await layDanhTinhZalo(ORG);
    expect(lay.loi).toBeGreaterThan(0);
    expect(await prisma.botQuyenDanhTinh.count({ where: { orgId: ORG, globalId: { not: null } } })).toBe(0);
    await chayDanhTinh(ORG);
    expect(await prisma.botNhanVienUid.count({ where: { nhanVienId: nv.id } })).toBe(1);
  });

  // ── DANH TÍNH CHẮC: globalId đọc TRỰC TIẾP từ Zalo (cổng giả trả số thật đo trên staging) ─────────────────

  it('globalId sống (số staging): Hưng/Quốc tự nối ở nick kia (kể cả admin); Tiểu Mã/Cẩm Loan nhìn từ Vận Tải là nick CRM ⇒ "private 1", "Led Nelia, Trần Hưng" thành Nhóm nhân viên', async () => {
    const s = await dungStaging();
    try {
      _datZaloDanhTinhChoTest(giaZalo(s.bang));
      const hung = (await goi('POST', '/nhan-vien', { zaloUid: s.HUNG_CL, tenGoi: 'Trần Hưng', vai: 'admin' })).json().nhanVien;
      const quoc = (await goi('POST', '/nhan-vien', { zaloUid: s.QUOC_VT, tenGoi: 'Viết Quốc', vai: 'admin' })).json().nhanVien;
      const chucNang = async () => Object.fromEntries((await docCauHinhCongKhai(ORG)).nhom
        .filter((n) => ['p1-vt', 'ln-vt'].includes(n.conversation_id)).map((n) => [n.conversation_id, n.chuc_nang]));
      expect(await chucNang()).toEqual({ 'p1-vt': 'khach', 'ln-vt': 'khach' }); // lỗi staging

      await chayDanhTinh(ORG);
      expect(await chucNang()).toEqual({ 'p1-vt': 'sales', 'ln-vt': 'sales' });
      const cfg = await docCauHinhCongKhai(ORG);
      expect(cfg.nick_crm).toEqual([
        { nick_uid: s.CL_SELF, uid: '1333113565670020202', nick_ten: 'Vận Tải Minh Thức' },
        { nick_uid: s.VT_SELF, uid: s.CL_TU_VT, nick_ten: 'Cẩm Loan' },
        { nick_uid: s.VT_SELF, uid: s.TM_TU_VT, nick_ten: 'Tiểu Mã Nelia' },
      ]);
      const uidsCua = (z: string) => cfg.nhan_vien.find((n) => n.zalo_uid === z)!.uids;
      expect(uidsCua(s.HUNG_CL)).toEqual([
        { nick_uid: s.CL_SELF, uid: s.HUNG_CL, nguon: 'chu_chon' }, { nick_uid: s.VT_SELF, uid: s.HUNG_VT, nguon: 'zalo_global_id' },
      ]);
      expect(uidsCua(s.QUOC_VT).map((u) => [u.uid, u.nguon]).sort()).toEqual([[s.QUOC_CL, 'zalo_global_id'], [s.QUOC_VT, 'chu_chon']].sort());
      // nick CRM KHÔNG là nhân viên
      expect(cfg.nhan_vien.flatMap((n) => n.uids.map((u) => u.uid))).not.toContain(s.TM_TU_VT);
      // nhật ký có bằng chứng: globalId + nick/lúc đọc hai phía
      const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG, doiTuongId: hung.id, aiId: 'tu_dong' } });
      expect(nk).toHaveLength(1);
      expect(nk[0].sau).toMatchObject({
        uids: [s.HUNG_CL, s.HUNG_VT],
        bangChung: { [s.HUNG_VT]: { globalId: 'G-HUNG', uidGoc: s.HUNG_CL, nhinTuGoc: s.CL, nhinTu: s.VT } },
      });
      expect((nk[0].sau as { bangChung: Record<string, { layLuc: string; layLucGoc: string }> }).bangChung[s.HUNG_VT].layLucGoc).toBeTruthy();
      void quoc;
      const nkNick = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG, doiTuong: 'nick_crm' } });
      expect(nkNick.map((r) => r.doiTuongId).sort()).toEqual([s.CL, s.TM, s.VT].sort()); // VT nhìn từ CL cũng nhận ra
      // chạy lại ⇒ không đổi gì
      const soNk = await prisma.botQuyenNhatKy.count({ where: { orgId: ORG } });
      await chayDanhTinh(ORG);
      expect(await prisma.botQuyenNhatKy.count({ where: { orgId: ORG } })).toBe(soNk);
    } finally {
      await s.don();
    }
  });

  it('nick Tiểu Mã TẮT, không có trong danh sách: hồ sơ sống lưu lúc nối (globalId + SĐT thật) ⇒ Vận Tải findUser ⇒ nhận ra; KHÔNG dùng zalo_accounts.phone', async () => {
    const s = await dungStaging({ tmTrongDanhSach: false });
    try {
      // zalo_accounts.phone gõ LẪN như staging (số của Tiểu Mã ghi ở VTMT và ngược lại) — không được dùng.
      await prisma.zaloAccount.update({ where: { id: s.VT }, data: { phone: '0847565324' } });
      await prisma.zaloAccount.update({ where: { id: s.TM }, data: { phone: '0876628854' } });
      // lúc Tiểu Mã còn nối: zalo-pool gọi getUserInfo(ownId) ⇒ lưu globalId + SĐT thật
      await ghiHoSoNickKetNoi(s.TM, s.TM_SELF, { globalId: 'G-TM', zaloName: 'Tiểu Mã Nelia', phoneNumber: '+84847565324' });
      const g = giaZalo(s.bang, { [`${s.VT}|84847565324`]: { uid: s.TM_TU_VT, globalId: 'G-TM', ten: 'Tiểu Mã Nelia' } });
      _datZaloDanhTinhChoTest(g, { nickDung: [s.VT, s.CL] }); // Tiểu Mã đang tắt
      await chayDanhTinh(ORG);
      expect(g.tra).toContain(`${s.VT}|84847565324`);
      expect(g.tra.some((t) => t.endsWith('0876628854') || t.endsWith('84876628854'))).toBe(false);
      expect((await docCauHinhCongKhai(ORG)).nick_crm.map((k) => k.uid)).toContain(s.TM_TU_VT);
      expect((await prisma.botQuyenDanhTinh.findFirst({ where: { orgId: ORG, zaloAccountId: s.VT, zaloUid: s.TM_TU_VT } }))?.nguon).toBe('zalo_find_user');
      // SĐT chỉ lưu cho dòng nick tự nhìn mình
      expect(await prisma.botQuyenDanhTinh.count({ where: { orgId: ORG, soDienThoai: { not: null }, NOT: { zaloUid: { in: [s.TM_SELF, s.VT_SELF, s.CL_SELF] } } } })).toBe(0);
      // không bao giờ hỏi getUserInfo trên MÃ NHÓM
      expect(g.hoi.filter((u) => u.startsWith('ext-'))).toEqual([]);
    } finally {
      await s.don();
    }
  });

  it('NV có SĐT (tài khoản CRM liên kết) mà globalId của uid chủ chọn CHƯA biết (nick đó tắt) ⇒ findUser + tên khớp ⇒ ĐỀ XUẤT (không tự gắn); tên lệch ⇒ không', async () => {
    await nhom('ph-a', A, 'Nhóm ph');
    await tin('ph-a', ma(1501), 'ph-nv');
    await prisma.user.create({ data: { id: 'test-bqat-u2', orgId: ORG, email: 'u2@x.com', passwordHash: 'x', fullName: 'Trần Hưng', role: 'member', isActive: true, phone: '0903111222' } });
    await prisma.user.create({ data: { id: 'test-bqat-u3', orgId: ORG, email: 'u3@x.com', passwordHash: 'x', fullName: 'Lê Lan', role: 'member', isActive: true, phone: '0903111333' } });
    try {
      const g = giaZalo({}, {
        [`${B}|84903111222`]: { uid: 'ph-hung-b', globalId: 'G-PH', ten: 'Hưng' },
        [`${B}|84903111333`]: { uid: 'ph-la-b', globalId: 'G-LA', ten: 'Nguyễn Văn Tèo' },
      });
      _datZaloDanhTinhChoTest(g, { nickDung: [B] }); // nick A (nơi uid chủ chọn) đang tắt ⇒ globalId NV chưa biết
      const hung = (await goi('POST', '/nhan-vien', { zaloUid: 'ph-nv', tenGoi: 'Trần Hưng', vai: 'admin', userId: 'test-bqat-u2' })).json().nhanVien;
      const lan = (await goi('POST', '/nhan-vien', { zaloUid: 'ph-a-lan', tenGoi: 'Lan', vai: 'sales', userId: 'test-bqat-u3' }).catch(() => null))?.json?.()?.nhanVien;
      void lan;
      await chayDanhTinh(ORG);
      const ds = (await goi('GET', '/nhan-vien')).json().nhanVien as Array<{ id: string; uids: Array<{ zaloUid: string }>; deXuat: Array<{ zaloUid: string; bangChung: { nguon: string; sdtDuoi: string } }> }>;
      const h = ds.find((x) => x.id === hung.id)!;
      expect(h.uids.map((u) => u.zaloUid)).toEqual(['ph-nv']);
      expect(h.deXuat).toEqual([expect.objectContaining({ zaloUid: 'ph-hung-b', bangChung: expect.objectContaining({ nguon: 'sdt_ten', sdtDuoi: '…222' }) })]);
      expect(await prisma.botNhanVienUidDeXuat.count({ where: { zaloUid: 'ph-la-b' } })).toBe(0);
    } finally {
      await prisma.botNhanVien.deleteMany({ where: { orgId: ORG } });
      await prisma.user.deleteMany({ where: { id: { in: ['test-bqat-u2', 'test-bqat-u3'] } } });
    }
  });

  it('globalId "giữ chỗ" (hai uid khác nhau trên CÙNG nick mang cùng globalId) ⇒ nhiễm ⇒ KHÔNG nối', async () => {
    await nhom('gc-a', A, 'Nhóm gc');
    await nhom('gc-b', B, 'Nhóm gc B');
    await tin('gc-a', ma(1201), 'gc-nv');
    await tin('gc-b', ma(1202), 'gc-x1');
    await tin('gc-b', ma(1203), 'gc-x2');
    await prisma.botNhomDanhSach.create({ data: { orgId: ORG, conversationId: 'gc-b', zaloAccountId: B, uids: ['gc-x1', 'gc-x2'], dayDu: true, canDocLai: false, docLuc: new Date() } });
    _datZaloDanhTinhChoTest(giaZalo({ [A]: { 'gc-nv': 'G-GIU-CHO' }, [B]: { 'gc-x1': 'G-GIU-CHO', 'gc-x2': 'G-GIU-CHO' } }));
    const nv = (await goi('POST', '/nhan-vien', { zaloUid: 'gc-nv', tenGoi: 'N', vai: 'sales' })).json().nhanVien;
    await chayDanhTinh(ORG);
    expect(await prisma.botQuyenDanhTinh.count({ where: { orgId: ORG, globalId: 'G-GIU-CHO' } })).toBe(3);
    expect(await prisma.botNhanVienUid.count({ where: { nhanVienId: nv.id } })).toBe(1);
  });

  it('globalId sống: SĐT nhân viên ⇒ nick khác findUser ⇒ nối CHỈ khi globalId trùng uid chủ chọn', async () => {
    await nhom('sd-a', A, 'Nhóm sđt');
    await tin('sd-a', ma(1301), 'sd-nv');
    const g = giaZalo({ [A]: { 'sd-nv': 'G-SD' } }, {
      [`${B}|84903000003`]: { uid: 'sd-nv-b', globalId: 'G-SD' },
      [`${B}|84903000004`]: { uid: 'nguoi-la-b', globalId: 'G-KHAC' },
    });
    _datZaloDanhTinhChoTest(g);
    const dung = (await goi('POST', '/nhan-vien', { zaloUid: 'sd-nv', tenGoi: 'Đúng', vai: 'kho', soDienThoai: '0903000003' })).json().nhanVien;
    expect(dung.soDienThoai).toBe('84903000003');
    await chayDanhTinh(ORG);
    expect((await prisma.botNhanVienUid.findMany({ where: { nhanVienId: dung.id }, orderBy: { zaloUid: 'asc' } })).map((u) => [u.zaloUid, u.nguon]))
      .toEqual([['sd-nv', 'chon'], ['sd-nv-b', 'zalo_global_id']]);
    // SĐT gõ nhầm sang người khác ⇒ globalId khác ⇒ KHÔNG nối
    await prisma.botNhanVien.update({ where: { id: dung.id }, data: { soDienThoai: '84903000004' } });
    _datZaloDanhTinhChoTest(g);
    await chayDanhTinh(ORG);
    expect(await prisma.botNhanVienUid.count({ where: { nhanVienId: dung.id, zaloUid: 'nguoi-la-b' } })).toBe(0);
  });

  it('globalId sống: NV có HAI globalId khác nhau (uid chọn lệch) ⇒ không nối gì; ngân sách ngày chặn số lần gọi', async () => {
    await nhom('lc-a', A, 'Nhóm lc');
    await nhom('lc-b', B, 'Nhóm lc B');
    for (const [c, u, i] of [['lc-a', 'lc-1', 1], ['lc-a', 'lc-2', 2], ['lc-b', 'lc-3', 3]] as const) await tin(c, ma(1400 + i), u);
    await prisma.botNhomDanhSach.create({ data: { orgId: ORG, conversationId: 'lc-b', zaloAccountId: B, uids: ['lc-3'], dayDu: true, canDocLai: false, docLuc: new Date() } });
    const g = giaZalo({ [A]: { 'lc-1': 'G-1', 'lc-2': 'G-2' }, [B]: { 'lc-3': 'G-1' } });
    _datZaloDanhTinhChoTest(g, { tranNgay: 1 });
    const nv = (await goi('POST', '/nhan-vien', { zaloUid: 'lc-1', zaloUids: ['lc-2'], tenGoi: 'L', vai: 'sales' })).json().nhanVien;
    await chayDanhTinh(ORG);
    expect(g.dem.thongTin).toBeLessThanOrEqual(2); // ≤ 1 lần / nick / ngày
    _datZaloDanhTinhChoTest(g, { tranNgay: 100 });
    await chayDanhTinh(ORG);
    expect(await prisma.botQuyenDanhTinh.count({ where: { orgId: ORG, zaloUid: { in: ['lc-1', 'lc-2', 'lc-3'] }, globalId: { not: null } } })).toBe(3);
    expect((await prisma.botNhanVienUid.findMany({ where: { nhanVienId: nv.id } })).map((u) => u.zaloUid).sort()).toEqual(['lc-1', 'lc-2']);
    _datZaloDanhTinhChoTest(null, { tranNgay: null });
  });
});
