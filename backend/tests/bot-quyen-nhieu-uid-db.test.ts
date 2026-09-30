// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 §8b) — MỘT nhân viên, NHIỀU uid Zalo (mỗi nick một uid), trên Postgres THẬT.
//
// Tái hiện đúng lỗi staging 30/09: nick Cẩm Loan (CL) và nick Vận Tải Minh Thức (VT) cùng ở nhóm "AI dev test"; Zalo cấp
// cho Trần Hưng uid 3395… ở CL và 3835… ở VT (mã nhóm cũng khác). Chủ gán Hưng bằng dòng của CL ⇒ bot (nick VT) không
// nhận ra anh, "Chờ gán" vẫn còn dòng của VT. Mã tin nhắn Zalo là toàn cục ⇒ cùng tin ghi ở hai hội thoại = bằng chứng.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import { registerBotQuyenRoutes } from '../src/modules/bot-quyen/bot-quyen-routes.js';
import { _xoaBanGom } from '../src/modules/bot-quyen/bot-quyen-nguoi-da-nhan.js';
import { docCauHinhCongKhai, _thongKeBoNho } from '../src/modules/bot-quyen/bot-quyen-cong-khai.js';
import { boSungUidNhanVien, _xoaNhipBoSung } from '../src/modules/bot-quyen/bot-quyen-nhan-vien-uid.js';
import { _datBoDocChoTest, choHangDoiXong } from '../src/modules/bot-quyen/bot-quyen-danh-sach.js';

const ORG = 'test-bqu-org';
const OWNER = 'test-bqu-owner';
const CL = 'test-bqu-nick-cl';
const VT = 'test-bqu-nick-vt';
const N3 = 'test-bqu-nick-3';
const CL_UID = '632106073555356463';
const VT_UID = '619833576870383279';
const HUNG_CL = '3395858500519725514';
const HUNG_VT = '3835588809400259343';
const QUOC_CL = '5809610033196845429';
const QUOC_VT = '5369941570764297136';
const BASE = '/api/v1/bot-quyen';

async function donDep() {
  await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhomDanhSach.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhom.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhanVien.deleteMany({ where: { orgId: ORG } });
  await prisma.message.deleteMany({ where: { conversation: { orgId: ORG } } });
  await prisma.conversation.deleteMany({ where: { orgId: ORG } });
  await prisma.zaloAccount.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { orgId: ORG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
}

let app: FastifyInstance;
let so = 0;
/** Một tin Zalo (mã `msg`) ghi ở một hội thoại. */
async function tin(conversationId: string, msg: string, senderUid: string, senderName: string, phutTruoc: number, senderType = 'contact') {
  so++;
  await prisma.message.create({
    data: {
      id: `test-bqu-m${so}`, conversationId, zaloMsgId: msg, senderType, senderUid, senderName, content: `tin ${msg}`,
      sentAt: new Date(Date.now() - phutTruoc * 60_000),
    },
  });
}
/** Cùng một tin nhóm, cả hai nick cùng ghi (mỗi nick một hội thoại, uid theo nick). */
async function tinChung(msg: string, uidCl: string, uidVt: string, ten: string, phutTruoc: number) {
  await tin('test-bqu-g-cl', msg, uidCl, ten, phutTruoc);
  await tin('test-bqu-g-vt', msg, uidVt, ten, phutTruoc);
}

function token(): string {
  return app.jwt.sign({ id: OWNER, email: `${OWNER}@x.com`, role: 'owner', orgId: ORG, typ: 'access' });
}
async function goi(method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) {
  return app.inject({ method, url: `${BASE}${url}`, headers: { authorization: `Bearer ${token()}` }, ...(payload ? { payload } : {}) });
}

describeCanDb('bot-quyen — một nhân viên nhiều uid (mỗi nick một uid)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.organization.create({ data: { id: ORG, name: 'BQU' } });
    await prisma.user.create({ data: { id: OWNER, orgId: ORG, email: `${OWNER}@x.com`, passwordHash: 'x', fullName: 'Chủ', role: 'owner', isActive: true } });
    await prisma.zaloAccount.create({ data: { id: CL, orgId: ORG, ownerUserId: OWNER, zaloUid: CL_UID, displayName: 'Cẩm Loan', status: 'connected' } });
    await prisma.zaloAccount.create({ data: { id: VT, orgId: ORG, ownerUserId: OWNER, zaloUid: VT_UID, displayName: 'Vận Tải Minh Thức', status: 'connected' } });
    await prisma.zaloAccount.create({ data: { id: N3, orgId: ORG, ownerUserId: OWNER, zaloUid: 'uid-nick-3', displayName: 'Nick 3' } });
    const conv = (id: string, nick: string, loai: string, ext: string, groupName?: string) => prisma.conversation.create({
      data: { id, orgId: ORG, zaloAccountId: nick, threadType: loai, externalThreadId: ext, groupName, lastMessageAt: new Date() },
    });
    // Cùng nhóm "AI dev test" — mã nhóm KHÁC theo nick.
    await conv('test-bqu-g-cl', CL, 'group', '1753469850074106815', 'AI dev test');
    await conv('test-bqu-g-vt', VT, 'group', '166544585134854522', 'AI dev test');
    await conv('test-bqu-dm-hung', VT, 'user', HUNG_VT);
    await conv('test-bqu-g-n3', N3, 'group', 'g-n3', 'Nhóm nick 3');
    await tinChung('m1', HUNG_CL, HUNG_VT, 'Trần Hưng', 30);
    await tinChung('m2', HUNG_CL, HUNG_VT, 'Trần Hưng', 20);
    await tinChung('m3', QUOC_CL, QUOC_VT, 'Viết Quốc', 15);
    // Mỗi nick tự gửi: uid của chính nick, nick kia thấy bằng uid khác.
    await tin('test-bqu-g-cl', 'm4', '1333113565670020202', 'Vận Tải Minh Thức', 10);
    await tin('test-bqu-g-vt', 'm4', VT_UID, 'Vận Tải Minh Thức', 10, 'self');
    await tin('test-bqu-dm-hung', 'm5', HUNG_VT, 'Trần Hưng', 5);
    await tin('test-bqu-g-vt', 'm6', 'khach-vt', 'Khách', 3);
    await tin('test-bqu-g-n3', 'm7', 'hung-n3', 'Trần Hưng', 2);
    app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: config.jwtSecret });
    await app.register(registerBotQuyenRoutes, { prefix: BASE, docThanhVienZalo: async () => [] });
    await app.ready();
  });

  afterAll(async () => {
    _datBoDocChoTest(null);
    await choHangDoiXong();
    await app?.close();
    await donDep();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    _xoaBanGom();
    _xoaNhipBoSung();
    _thongKeBoNho(true);
    _datBoDocChoTest(async () => ({ gridInfoMap: {} }));
    await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: ORG } });
    await prisma.botNhomDanhSach.deleteMany({ where: { orgId: ORG } });
    await prisma.botNhanVien.deleteMany({ where: { orgId: ORG } });
  });

  it('"Chờ gán": MỘT dòng mỗi người, mang uid của mọi nick', async () => {
    const r = await goi('GET', '/nguoi-da-nhan?lamMoi=1');
    expect(r.statusCode).toBe(200);
    const ds = r.json().ungVien as Array<{ zaloUid: string; ten: string; uids: Array<{ zaloUid: string; nick: { id: string } }> }>;
    const hung = ds.filter((u) => u.ten === 'Trần Hưng');
    // hung-n3 không có tin chung ⇒ máy KHÔNG đoán theo tên — vẫn là dòng riêng.
    expect(hung.map((u) => u.uids.map((x) => x.zaloUid).sort())).toEqual(
      expect.arrayContaining([[HUNG_CL, HUNG_VT].sort(), ['hung-n3']]),
    );
    expect(hung).toHaveLength(2);
    const quoc = ds.find((u) => u.ten === 'Viết Quốc')!;
    expect(quoc.uids.map((x) => [x.nick.id, x.zaloUid])).toEqual([[CL, QUOC_CL], [VT, QUOC_VT]]);
  });

  it('gán bằng uid của nick KHÁC nick bot (lỗi staging) ⇒ NV mang cả uid nick bot; "Chờ gán" hết cả hai dòng', async () => {
    const r = await goi('POST', '/nhan-vien', { zaloUid: HUNG_CL, tenGoi: 'Trần Hưng', vai: 'admin' });
    expect(r.statusCode).toBe(201);
    const nv = r.json().nhanVien;
    expect(nv.zaloUid).toBe(HUNG_CL);
    expect(nv.uids).toEqual([
      { zaloUid: HUNG_CL, nick: { id: CL, ten: 'Cẩm Loan', zaloUid: CL_UID }, nguon: 'chon' },
      { zaloUid: HUNG_VT, nick: { id: VT, ten: 'Vận Tải Minh Thức', zaloUid: VT_UID }, nguon: 'cung_tin' },
    ]);
    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG, doiTuong: 'nhan_vien' } });
    expect(nk).toHaveLength(1);
    expect((nk[0].sau as { uids: string[] }).uids).toEqual([HUNG_CL, HUNG_VT]);

    const cho = (await goi('GET', '/nguoi-da-nhan')).json().ungVien as Array<{ uids: Array<{ zaloUid: string }> }>;
    const conLai = cho.flatMap((u) => u.uids.map((x) => x.zaloUid));
    expect(conLai).not.toContain(HUNG_CL);
    expect(conLai).not.toContain(HUNG_VT);
    expect(conLai).toContain('hung-n3');

    // Payload cho bot: uid theo nick bot (VT) có mặt, kèm nick_uid.
    const cfg = await docCauHinhCongKhai(ORG);
    expect(cfg.nhan_vien).toEqual([{
      zalo_uid: HUNG_CL, ten_goi: 'Trần Hưng', vai: 'admin', trang_thai: 'hoat_dong',
      uids: [{ nick_uid: CL_UID, uid: HUNG_CL }, { nick_uid: VT_UID, uid: HUNG_VT }],
    }]);
  });

  it('người đã là NV dưới uid nick khác ⇒ thêm mới bằng uid kia bị chặn (409, nói tên)', async () => {
    expect((await goi('POST', '/nhan-vien', { zaloUid: HUNG_CL, tenGoi: 'Trần Hưng', vai: 'admin' })).statusCode).toBe(201);
    const r = await goi('POST', '/nhan-vien', { zaloUid: HUNG_VT, tenGoi: 'Hưng VT', vai: 'sales' });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: 'NHAN_VIEN_DA_CO' });
    expect(r.json().error).toContain('Trần Hưng');
    expect(await prisma.botNhanVien.count({ where: { orgId: ORG } })).toBe(1);
  });

  it('gán kèm zaloUids (dòng "Chờ gán" đã gộp) + POST /nhan-vien/:id/uid thêm uid nick thứ ba (không có tin chung)', async () => {
    const r = await goi('POST', '/nhan-vien', { zaloUid: QUOC_VT, zaloUids: [QUOC_CL], tenGoi: 'Viết Quốc', vai: 'admin' });
    expect(r.statusCode).toBe(201);
    expect(r.json().nhanVien.uids.map((u: { zaloUid: string; nguon: string }) => [u.zaloUid, u.nguon]))
      .toEqual([[QUOC_VT, 'chon'], [QUOC_CL, 'chon']].sort());
    const hung = (await goi('POST', '/nhan-vien', { zaloUid: HUNG_VT, tenGoi: 'Trần Hưng', vai: 'sales' })).json().nhanVien;
    const them = await goi('POST', `/nhan-vien/${hung.id}/uid`, { zaloUid: 'hung-n3', lyDo: 'cùng người ở nick 3' });
    expect(them.statusCode).toBe(200);
    expect(them.json().doi).toBe(true);
    const uid3 = them.json().nhanVien.uids.find((u: { zaloUid: string }) => u.zaloUid === 'hung-n3');
    expect(uid3).toMatchObject({ nick: { id: N3 }, nguon: 'chon' });
    // chạy lại ⇒ không đổi; uid của NV khác ⇒ 409; thiếu uid ⇒ 400; NV lạ ⇒ 404
    expect((await goi('POST', `/nhan-vien/${hung.id}/uid`, { zaloUid: 'hung-n3' })).json().doi).toBe(false);
    expect((await goi('POST', `/nhan-vien/${hung.id}/uid`, { zaloUid: QUOC_CL })).statusCode).toBe(409);
    expect((await goi('POST', `/nhan-vien/${hung.id}/uid`, {})).statusCode).toBe(400);
    expect((await goi('POST', '/nhan-vien/khong-co/uid', { zaloUid: 'x' })).statusCode).toBe(404);
    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG, doiTuongId: hung.id }, orderBy: { luc: 'asc' } });
    expect(nk.at(-1)).toMatchObject({ lyDo: 'cùng người ở nick 3', sau: { uids: [HUNG_CL, HUNG_VT, 'hung-n3'].sort() } });
  });

  it('dòng CŨ (một uid, như migration để lại) ⇒ mở trang Nhân viên tự bổ sung uid nick kia + nick + nhật ký "tự động"', async () => {
    const nv = await prisma.botNhanVien.create({ data: { orgId: ORG, zaloUid: QUOC_CL, tenGoi: 'Viết Quốc', vai: 'admin' } });
    await prisma.botNhanVienUid.create({ data: { orgId: ORG, nhanVienId: nv.id, zaloUid: QUOC_CL, nguon: 'chon' } });
    const r = await goi('GET', '/nhan-vien');
    expect(r.statusCode).toBe(200);
    expect(r.json().nhanVien[0].uids).toEqual([
      { zaloUid: QUOC_VT, nick: { id: VT, ten: 'Vận Tải Minh Thức', zaloUid: VT_UID }, nguon: 'cung_tin' },
      { zaloUid: QUOC_CL, nick: { id: CL, ten: 'Cẩm Loan', zaloUid: CL_UID }, nguon: 'chon' },
    ].sort((a, b) => (a.zaloUid < b.zaloUid ? -1 : 1)));
    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG, doiTuongId: nv.id } });
    expect(nk).toHaveLength(1);
    expect(nk[0]).toMatchObject({ aiId: 'tu_dong', truoc: { uids: [QUOC_CL] }, sau: { uids: [QUOC_VT, QUOC_CL].sort() } });
    expect(nk[0].lyDo).toContain('cùng tin nhắn');
    // lần hai: không ghi gì thêm
    _xoaNhipBoSung();
    expect(await boSungUidNhanVien(ORG)).toBe(0);
  });

  it('không cướp: uid cùng người đã thuộc NV KHÁC ⇒ giữ nguyên hai dòng', async () => {
    const a = await prisma.botNhanVien.create({ data: { orgId: ORG, zaloUid: HUNG_CL, tenGoi: 'Hưng CL', vai: 'admin' } });
    const b = await prisma.botNhanVien.create({ data: { orgId: ORG, zaloUid: HUNG_VT, tenGoi: 'Hưng VT', vai: 'sales' } });
    await prisma.botNhanVienUid.create({ data: { orgId: ORG, nhanVienId: a.id, zaloUid: HUNG_CL, nguon: 'chon' } });
    await prisma.botNhanVienUid.create({ data: { orgId: ORG, nhanVienId: b.id, zaloUid: HUNG_VT, nguon: 'chon' } });
    expect(await boSungUidNhanVien(ORG)).toBe(0);
    expect(await prisma.botNhanVienUid.count({ where: { nhanVienId: a.id } })).toBe(1);
    expect(await prisma.botNhanVienUid.count({ where: { nhanVienId: b.id } })).toBe(1);
    // nick được điền cho dòng thiếu nick
    expect((await prisma.botNhanVienUid.findFirst({ where: { nhanVienId: b.id } }))!.zaloAccountId).toBe(VT);
  });

  it('mặc định nhóm: thành viên là uid THEO NICK của nhóm — NV gán ở nick kia vẫn được nhận ⇒ sales', async () => {
    // Gán cả hai bằng uid nick CL; nhóm của nick VT chỉ có uid VT.
    await goi('POST', '/nhan-vien', { zaloUid: HUNG_CL, tenGoi: 'Trần Hưng', vai: 'admin' });
    await goi('POST', '/nhan-vien', { zaloUid: QUOC_CL, tenGoi: 'Viết Quốc', vai: 'admin' });
    await prisma.botNhomDanhSach.create({
      data: {
        orgId: ORG, conversationId: 'test-bqu-g-vt', zaloAccountId: VT, uids: [VT_UID, HUNG_VT, QUOC_VT], dayDu: true,
        canDocLai: false, docLuc: new Date(),
      },
    });
    const cfg = await docCauHinhCongKhai(ORG);
    expect(cfg.nhom).toEqual([expect.objectContaining({ conversation_id: 'test-bqu-g-vt', chuc_nang: 'sales', mac_dinh: true })]);
    const nhom = (await goi('GET', '/nhom?zaloAccountId=' + VT)).json().nhom;
    expect(nhom.find((n: { conversationId: string }) => n.conversationId === 'test-bqu-g-vt'))
      .toMatchObject({ chucNangHieuLuc: 'sales', macDinh: { lyDo: 'toan_nhan_vien', soNguoiNgoai: 0 } });
    // Nhãn thành viên (ngăn Thành viên): uid VT của Hưng là nhân viên.
    await prisma.groupMember.createMany({
      data: [HUNG_VT, 'khach-vt'].map((u) => ({ orgId: ORG, zaloAccountId: VT, groupId: '166544585134854522', memberUid: u, displayName: u })),
    });
    const tv = (await goi('GET', '/nhom/test-bqu-g-vt/thanh-vien')).json();
    expect(tv.thanhVien.find((t: { zaloUid: string }) => t.zaloUid === HUNG_VT)).toMatchObject({ loai: 'nhan_vien', nhanVien: { tenGoi: 'Trần Hưng' } });
    await prisma.groupMember.deleteMany({ where: { orgId: ORG } });
  });
});
