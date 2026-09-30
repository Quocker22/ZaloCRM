// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 §8b) — MỘT nhân viên, NHIỀU uid Zalo (mỗi nick một uid), trên Postgres THẬT.
//
// Tái hiện đúng lỗi staging 30/09: nick Cẩm Loan (CL) và nick Vận Tải Minh Thức (VT) cùng ở nhóm "AI dev test"; Zalo cấp
// cho Trần Hưng uid 3395… ở CL và 3835… ở VT (mã nhóm cũng khác). Chủ gán Hưng bằng dòng của CL ⇒ bot (nick VT) không
// nhận ra anh, "Chờ gán" vẫn còn dòng của VT. Mã tin nhắn Zalo là toàn cục ⇒ cùng tin ghi ở hai hội thoại = bằng chứng.
// §8b-an-toàn (vòng sửa review bảo mật): bằng chứng tin chung CHẶT (mã máy chủ Zalo, cùng nhóm, ±5 s, cùng loại, ≥ 2 tin);
// vai đặc quyền (admin…) ⇒ ĐỀ XUẤT thay vì tự gắn; nick CRM nhìn từ nick khác nhận ra bằng cùng luật.
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

// Nick để 'disconnected': vòng quét danh sách thành viên (toàn cục, chỉ nick connected) không nhặt nhóm của file này
// khi các file DB khác chạy song song.
async function donDep() {
  await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhomDanhSach.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhom.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhanVien.deleteMany({ where: { orgId: ORG } });
  await prisma.botNickCrmUid.deleteMany({ where: { orgId: ORG } });
  await prisma.message.deleteMany({ where: { conversation: { orgId: ORG } } });
  await prisma.conversation.deleteMany({ where: { orgId: ORG } });
  await prisma.zaloAccount.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { orgId: ORG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
}

let app: FastifyInstance;
let so = 0;
const GOC = Date.now();
/** Mã tin MÁY CHỦ Zalo (snowflake ≈ 8,2·10¹², không giống mốc ms). */
const ma = (n: number) => String(8_200_000_000_000 + n);
/** Một tin Zalo (mã `msg`) ghi ở một hội thoại — mốc giờ theo `phutTruoc` (hai nick ghi cùng tin ⇒ cùng mốc). */
async function tin(conversationId: string, msg: string, senderUid: string, senderName: string, phutTruoc: number, senderType = 'contact') {
  so++;
  await prisma.message.create({
    data: {
      id: `test-bqu-m${so}`, conversationId, zaloMsgId: msg, senderType, senderUid, senderName, content: `tin ${msg}`,
      sentAt: new Date(GOC - phutTruoc * 60_000),
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
async function goi(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url: `${BASE}${url}`, headers: { authorization: `Bearer ${token()}` }, ...(payload ? { payload } : {}) });
}

describeCanDb('bot-quyen — một nhân viên nhiều uid (mỗi nick một uid)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.organization.create({ data: { id: ORG, name: 'BQU' } });
    await prisma.user.create({ data: { id: OWNER, orgId: ORG, email: `${OWNER}@x.com`, passwordHash: 'x', fullName: 'Chủ', role: 'owner', isActive: true } });
    await prisma.zaloAccount.create({ data: { id: CL, orgId: ORG, ownerUserId: OWNER, zaloUid: CL_UID, displayName: 'Cẩm Loan', status: 'disconnected' } });
    await prisma.zaloAccount.create({ data: { id: VT, orgId: ORG, ownerUserId: OWNER, zaloUid: VT_UID, displayName: 'Vận Tải Minh Thức', status: 'disconnected' } });
    await prisma.zaloAccount.create({ data: { id: N3, orgId: ORG, ownerUserId: OWNER, zaloUid: 'uid-nick-3', displayName: 'Nick 3' } });
    const conv = (id: string, nick: string, loai: string, ext: string, groupName?: string) => prisma.conversation.create({
      data: { id, orgId: ORG, zaloAccountId: nick, threadType: loai, externalThreadId: ext, groupName, lastMessageAt: new Date() },
    });
    // Cùng nhóm "AI dev test" — mã nhóm KHÁC theo nick.
    await conv('test-bqu-g-cl', CL, 'group', '1753469850074106815', 'AI dev test');
    await conv('test-bqu-g-vt', VT, 'group', '166544585134854522', 'AI dev test');
    await conv('test-bqu-dm-hung', VT, 'user', HUNG_VT);
    await conv('test-bqu-g-n3', N3, 'group', 'g-n3', 'Nhóm nick 3');
    await tinChung(ma(1), HUNG_CL, HUNG_VT, 'Trần Hưng', 30);
    await tinChung(ma(2), HUNG_CL, HUNG_VT, 'Trần Hưng', 20);
    await tinChung(ma(3), QUOC_CL, QUOC_VT, 'Viết Quốc', 15);
    await tinChung(ma(31), QUOC_CL, QUOC_VT, 'Viết Quốc', 14);
    // Nick VT tự gửi: uid của chính nick; nick CL thấy bằng uid khác (1333…) ⇒ nick CRM nhìn từ CL.
    for (const [m, p] of [[ma(4), 10], [ma(41), 9]] as const) {
      await tin('test-bqu-g-cl', m, '1333113565670020202', 'Vận Tải Minh Thức', p);
      await tin('test-bqu-g-vt', m, VT_UID, 'Vận Tải Minh Thức', p, 'self');
    }
    await tin('test-bqu-dm-hung', ma(5), HUNG_VT, 'Trần Hưng', 5);
    await tin('test-bqu-g-vt', ma(6), 'khach-vt', 'Khách', 3);
    await tin('test-bqu-g-n3', ma(7), 'hung-n3', 'Trần Hưng', 2);
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
    await prisma.botNickCrmUid.deleteMany({ where: { orgId: ORG } });
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
    // Nick VT nhìn từ nick CL là uid khác (1333…) — cùng tin với uid VT tự nhìn mình ⇒ là nick của org ⇒ không ở Chờ gán.
    expect(ds.flatMap((u) => u.uids.map((x) => x.zaloUid))).not.toContain('1333113565670020202');
    const quoc = ds.find((u) => u.ten === 'Viết Quốc')!;
    expect(quoc.uids.map((x) => [x.nick.id, x.zaloUid])).toEqual([[CL, QUOC_CL], [VT, QUOC_VT]]);
  });

  it('gán ADMIN bằng uid của nick KHÁC nick bot (lỗi staging) ⇒ uid nick bot là ĐỀ XUẤT (không tự gắn); "Nối" ⇒ chu_xac_nhan', async () => {
    const r = await goi('POST', '/nhan-vien', { zaloUid: HUNG_CL, tenGoi: 'Trần Hưng', vai: 'admin' });
    expect(r.statusCode).toBe(201);
    const nv = r.json().nhanVien;
    expect(nv.zaloUid).toBe(HUNG_CL);
    expect(nv.uids).toEqual([
      { zaloUid: HUNG_CL, nick: { id: CL, ten: 'Cẩm Loan', zaloUid: CL_UID }, nguon: 'chon', bangChung: null },
    ]);
    expect(nv.deXuat).toEqual([{
      zaloUid: HUNG_VT, nick: { id: VT, ten: 'Vận Tải Minh Thức', zaloUid: VT_UID }, soTin: 2,
      bangChung: { soTin: 2, maTin: [ma(1), ma(2)] },
    }]);
    // Payload cho bot: CHỈ uid chủ chọn.
    let cfg = await docCauHinhCongKhai(ORG);
    expect(cfg.nhan_vien).toEqual([{
      zalo_uid: HUNG_CL, ten_goi: 'Trần Hưng', vai: 'admin', trang_thai: 'hoat_dong',
      uids: [{ nick_uid: CL_UID, uid: HUNG_CL, nguon: 'chu_chon' }],
    }]);
    // "Chờ gán": dòng gộp của Hưng biến mất (đã là NV dưới HUNG_CL).
    const cho = (await goi('GET', '/nguoi-da-nhan')).json().ungVien as Array<{ uids: Array<{ zaloUid: string }> }>;
    expect(cho.flatMap((u) => u.uids.map((x) => x.zaloUid))).not.toContain(HUNG_VT);

    const noi = await goi('POST', `/nhan-vien/${nv.id}/de-xuat/${HUNG_VT}/noi`, {});
    expect(noi.statusCode).toBe(200);
    expect(noi.json().nhanVien.uids.map((u: { zaloUid: string; nguon: string }) => [u.zaloUid, u.nguon]))
      .toEqual([[HUNG_CL, 'chon'], [HUNG_VT, 'chu_xac_nhan']]);
    expect(noi.json().nhanVien.deXuat).toEqual([]);
    cfg = await docCauHinhCongKhai(ORG);
    expect(cfg.nhan_vien[0].uids).toEqual([
      { nick_uid: CL_UID, uid: HUNG_CL, nguon: 'chu_chon' }, { nick_uid: VT_UID, uid: HUNG_VT, nguon: 'chu_xac_nhan' },
    ]);
    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG, doiTuong: 'nhan_vien' }, orderBy: { luc: 'asc' } });
    expect(nk.at(-1)).toMatchObject({ aiId: OWNER, sau: { uids: [HUNG_CL, HUNG_VT], xacNhan: { zaloUid: HUNG_VT, soTin: 2 } } });
    // Nối lại ⇒ 404 (đề xuất không còn)
    expect((await goi('POST', `/nhan-vien/${nv.id}/de-xuat/${HUNG_VT}/noi`, {})).statusCode).toBe(404);
  });

  it('gán SALES ⇒ tin chung vẫn CHỈ là đề xuất (bằng chứng phụ, mọi vai); payload chỉ uid chủ chọn', async () => {
    const r = await goi('POST', '/nhan-vien', { zaloUid: HUNG_CL, tenGoi: 'Trần Hưng', vai: 'sales' });
    expect(r.statusCode).toBe(201);
    expect(r.json().nhanVien.uids.map((u: { zaloUid: string }) => u.zaloUid)).toEqual([HUNG_CL]);
    expect(r.json().nhanVien.deXuat).toEqual([expect.objectContaining({ zaloUid: HUNG_VT, soTin: 2, bangChung: { soTin: 2, maTin: [ma(1), ma(2)] } })]);
    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG, doiTuong: 'nhan_vien' } });
    expect(nk).toHaveLength(1);
    expect(nk[0].sau).toMatchObject({ uids: [HUNG_CL], deXuat: [HUNG_VT] });
    const cfg = await docCauHinhCongKhai(ORG);
    expect(cfg.nhan_vien[0].uids).toEqual([{ nick_uid: CL_UID, uid: HUNG_CL, nguon: 'chu_chon' }]);
  });

  it('D5: uid máy SUY RA (tin chung) thuộc NV khác KHÔNG chặn thêm mới — chỉ uid CHỦ CHỌN phải chưa có chủ', async () => {
    const hung = (await goi('POST', '/nhan-vien', { zaloUid: HUNG_CL, tenGoi: 'Trần Hưng', vai: 'admin' })).json().nhanVien;
    expect(hung.deXuat.map((d: { zaloUid: string }) => d.zaloUid)).toEqual([HUNG_VT]); // tin chung ⇒ chỉ đề xuất
    // HUNG_VT chỉ là ĐỀ XUẤT của Hưng (chưa ai sở hữu) ⇒ chủ vẫn thêm được; uid suy ra HUNG_CL (đã có chủ) không chặn.
    const r = await goi('POST', '/nhan-vien', { zaloUid: HUNG_VT, tenGoi: 'Hưng VT', vai: 'sales' });
    expect(r.statusCode).toBe(201);
    expect(r.json().nhanVien.deXuat).toEqual([]); // HUNG_CL đã thuộc Trần Hưng ⇒ không đề xuất
    // đề xuất HUNG_VT của Trần Hưng hết nghĩa (uid đã có chủ) ⇒ xoá
    expect(await prisma.botNhanVienUidDeXuat.count({ where: { orgId: ORG, zaloUid: HUNG_VT } })).toBe(0);
    // uid CHỦ CHỌN đã có chủ ⇒ vẫn 409, nói tên
    const trung = await goi('POST', '/nhan-vien', { zaloUid: 'khac-x', zaloUids: [HUNG_CL], tenGoi: 'X', vai: 'sales' });
    expect(trung.statusCode).toBe(409);
    expect(trung.json()).toMatchObject({ code: 'NHAN_VIEN_DA_CO' });
    expect(trung.json().error).toContain('Trần Hưng');
    expect(await prisma.botNhanVien.count({ where: { orgId: ORG } })).toBe(2);
  });

  it('gán kèm zaloUids (dòng "Chờ gán" đã gộp) + POST /nhan-vien/:id/uid thêm uid nick thứ ba (lyDo bắt buộc)', async () => {
    const r = await goi('POST', '/nhan-vien', { zaloUid: QUOC_VT, zaloUids: [QUOC_CL], tenGoi: 'Viết Quốc', vai: 'admin' });
    expect(r.statusCode).toBe(201);
    expect(r.json().nhanVien.uids.map((u: { zaloUid: string; nguon: string }) => [u.zaloUid, u.nguon]))
      .toEqual([[QUOC_VT, 'chon'], [QUOC_CL, 'chon']].sort());
    const hung = (await goi('POST', '/nhan-vien', { zaloUid: HUNG_VT, tenGoi: 'Trần Hưng', vai: 'sales' })).json().nhanVien;
    // thiếu lý do ⇒ 400
    const thieu = await goi('POST', `/nhan-vien/${hung.id}/uid`, { zaloUid: 'hung-n3' });
    expect(thieu.statusCode).toBe(400);
    expect(thieu.json().code).toBe('THIEU_LY_DO');
    const them = await goi('POST', `/nhan-vien/${hung.id}/uid`, { zaloUid: 'hung-n3', lyDo: 'cùng người ở nick 3' });
    expect(them.statusCode).toBe(200);
    expect(them.json().doi).toBe(true);
    const uid3 = them.json().nhanVien.uids.find((u: { zaloUid: string }) => u.zaloUid === 'hung-n3');
    expect(uid3).toMatchObject({ nick: { id: N3 }, nguon: 'chon' });
    // chạy lại ⇒ không đổi; uid của NV khác ⇒ 409; thiếu uid ⇒ 400; NV lạ ⇒ 404
    expect((await goi('POST', `/nhan-vien/${hung.id}/uid`, { zaloUid: 'hung-n3', lyDo: 'x' })).json().doi).toBe(false);
    expect((await goi('POST', `/nhan-vien/${hung.id}/uid`, { zaloUid: QUOC_CL, lyDo: 'x' })).statusCode).toBe(409);
    expect((await goi('POST', `/nhan-vien/${hung.id}/uid`, { lyDo: 'x' })).statusCode).toBe(400);
    expect((await goi('POST', '/nhan-vien/khong-co/uid', { zaloUid: 'hung-n3', lyDo: 'x' })).statusCode).toBe(404);
    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG, doiTuongId: hung.id }, orderBy: { luc: 'asc' } });
    expect(nk.at(-1)).toMatchObject({ lyDo: 'cùng người ở nick 3', sau: { uids: [HUNG_VT, 'hung-n3'].sort() } });
    // uid nick kia (tin chung) vẫn là đề xuất
    expect(await prisma.botNhanVienUidDeXuat.findMany({ where: { nhanVienId: hung.id } })).toEqual([expect.objectContaining({ zaloUid: HUNG_CL })]);
  });

  it('dòng CŨ (một uid) ⇒ mở trang Nhân viên tạo ĐỀ XUẤT tin chung cho MỌI vai (không tự gắn)', async () => {
    const quoc = await prisma.botNhanVien.create({ data: { orgId: ORG, zaloUid: QUOC_CL, tenGoi: 'Viết Quốc', vai: 'admin' } });
    await prisma.botNhanVienUid.create({ data: { orgId: ORG, nhanVienId: quoc.id, zaloUid: QUOC_CL, nguon: 'chon' } });
    const hung = await prisma.botNhanVien.create({ data: { orgId: ORG, zaloUid: HUNG_CL, tenGoi: 'Trần Hưng', vai: 'sales' } });
    await prisma.botNhanVienUid.create({ data: { orgId: ORG, nhanVienId: hung.id, zaloUid: HUNG_CL, nguon: 'chon' } });
    const r = await goi('GET', '/nhan-vien');
    expect(r.statusCode).toBe(200);
    const ds = r.json().nhanVien as Array<{ id: string; uids: Array<{ zaloUid: string; nguon: string }>; deXuat: Array<{ zaloUid: string; soTin: number }> }>;
    const q = ds.find((x) => x.id === quoc.id)!;
    expect(q.uids.map((u) => u.zaloUid)).toEqual([QUOC_CL]);
    expect(q.deXuat).toEqual([expect.objectContaining({ zaloUid: QUOC_VT, soTin: 2, nick: expect.objectContaining({ id: VT }) })]);
    const h = ds.find((x) => x.id === hung.id)!;
    expect(h.uids.map((u) => u.zaloUid)).toEqual([HUNG_CL]);
    expect(h.deXuat).toEqual([expect.objectContaining({ zaloUid: HUNG_VT, soTin: 2 })]);
    expect(await prisma.botQuyenNhatKy.count({ where: { orgId: ORG, doiTuong: 'nhan_vien' } })).toBe(0);
    // lần hai: không đề xuất mới
    _xoaNhipBoSung();
    expect(await boSungUidNhanVien(ORG)).toMatchObject({ them: 0, deXuat: 0, haCap: 0 });
  });

  it('lưới an toàn: dòng cung_tin (bản trước tự gắn) ⇒ chuyển về đề xuất + nhật ký', async () => {
    const hung = await prisma.botNhanVien.create({ data: { orgId: ORG, zaloUid: HUNG_CL, tenGoi: 'Trần Hưng', vai: 'admin' } });
    await prisma.botNhanVienUid.create({ data: { orgId: ORG, nhanVienId: hung.id, zaloUid: HUNG_CL, nguon: 'chon' } });
    // CHECK mới không cho ghi 'cung_tin' — giả dòng còn sót bằng SQL tay (bỏ CHECK trong giao dịch test rồi đặt lại).
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE bot_nhan_vien_uid DROP CONSTRAINT bot_nhan_vien_uid_nguon_check');
      await tx.$executeRawUnsafe(`INSERT INTO bot_nhan_vien_uid (id, org_id, nhan_vien_id, zalo_uid, nguon) VALUES ('test-bqu-cu', '${ORG}', '${hung.id}', '${HUNG_VT}', 'cung_tin')`);
      await tx.botNhanVienUid.findMany({ where: { nhanVienId: hung.id } });
    }).catch(() => undefined);
    const coCu = await prisma.botNhanVienUid.count({ where: { nhanVienId: hung.id, zaloUid: HUNG_VT } });
    _xoaNhipBoSung();
    const kq = await boSungUidNhanVien(ORG);
    await prisma.$executeRawUnsafe(`ALTER TABLE bot_nhan_vien_uid DROP CONSTRAINT IF EXISTS bot_nhan_vien_uid_nguon_check`);
    await prisma.$executeRawUnsafe(`ALTER TABLE bot_nhan_vien_uid ADD CONSTRAINT bot_nhan_vien_uid_nguon_check CHECK (nguon IN ('chon', 'chu_xac_nhan', 'zalo_global_id'))`);
    expect(coCu).toBe(1);
    expect(kq.haCap).toBe(1);
    expect(await prisma.botNhanVienUid.count({ where: { nhanVienId: hung.id, zaloUid: HUNG_VT } })).toBe(0);
    expect(await prisma.botNhanVienUidDeXuat.count({ where: { nhanVienId: hung.id, zaloUid: HUNG_VT } })).toBe(1);
    const nk = await prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG, doiTuongId: hung.id } });
    expect(nk[0]).toMatchObject({ aiId: 'tu_dong', sau: { thanhDeXuat: [HUNG_VT] } });
  });

  it('không cướp: uid cùng người đã thuộc NV KHÁC ⇒ giữ nguyên hai dòng', async () => {
    const a = await prisma.botNhanVien.create({ data: { orgId: ORG, zaloUid: HUNG_CL, tenGoi: 'Hưng CL', vai: 'sales' } });
    const b = await prisma.botNhanVien.create({ data: { orgId: ORG, zaloUid: HUNG_VT, tenGoi: 'Hưng VT', vai: 'sales' } });
    await prisma.botNhanVienUid.create({ data: { orgId: ORG, nhanVienId: a.id, zaloUid: HUNG_CL, nguon: 'chon' } });
    await prisma.botNhanVienUid.create({ data: { orgId: ORG, nhanVienId: b.id, zaloUid: HUNG_VT, nguon: 'chon' } });
    expect(await boSungUidNhanVien(ORG)).toMatchObject({ them: 0, deXuat: 0 });
    expect(await prisma.botNhanVienUid.count({ where: { nhanVienId: a.id } })).toBe(1);
    expect(await prisma.botNhanVienUid.count({ where: { nhanVienId: b.id } })).toBe(1);
    // nick được điền cho dòng thiếu nick
    expect((await prisma.botNhanVienUid.findFirst({ where: { nhanVienId: b.id } }))!.zaloAccountId).toBe(VT);
  });

  it('mặc định nhóm: thành viên là uid THEO NICK của nhóm — NV nối ở nick kia vẫn được nhận ⇒ sales; nick CRM tin chung = ĐỀ XUẤT', async () => {
    // Hưng sales, Quốc admin — cả hai: tin chung ⇒ đề xuất ⇒ chủ nối.
    const hung = (await goi('POST', '/nhan-vien', { zaloUid: HUNG_CL, tenGoi: 'Trần Hưng', vai: 'sales' })).json().nhanVien;
    const quoc = (await goi('POST', '/nhan-vien', { zaloUid: QUOC_CL, tenGoi: 'Viết Quốc', vai: 'admin' })).json().nhanVien;
    await prisma.botNhomDanhSach.create({
      data: {
        orgId: ORG, conversationId: 'test-bqu-g-vt', zaloAccountId: VT, uids: [VT_UID, HUNG_VT, QUOC_VT], dayDu: true,
        canDocLai: false, docLuc: new Date(),
      },
    });
    // chưa nối ⇒ uid VT của hai người là người ngoài ⇒ khach
    expect((await docCauHinhCongKhai(ORG)).nhom).toEqual([expect.objectContaining({ conversation_id: 'test-bqu-g-vt', chuc_nang: 'khach' })]);
    expect((await goi('POST', `/nhan-vien/${hung.id}/de-xuat/${HUNG_VT}/noi`, {})).statusCode).toBe(200);
    expect((await goi('POST', `/nhan-vien/${quoc.id}/de-xuat/${QUOC_VT}/noi`, { lyDo: 'đúng anh Quốc' })).statusCode).toBe(200);
    const cfg = await docCauHinhCongKhai(ORG);
    expect(cfg.nhom).toEqual([expect.objectContaining({ conversation_id: 'test-bqu-g-vt', chuc_nang: 'sales', mac_dinh: true })]);
    const nhom = (await goi('GET', '/nhom?zaloAccountId=' + VT)).json().nhom;
    expect(nhom.find((n: { conversationId: string }) => n.conversationId === 'test-bqu-g-vt'))
      .toMatchObject({ chucNangHieuLuc: 'sales', macDinh: { lyDo: 'toan_nhan_vien', soNguoiNgoai: 0 } });
    await prisma.groupMember.createMany({
      data: [HUNG_VT, 'khach-vt'].map((u) => ({ orgId: ORG, zaloAccountId: VT, groupId: '166544585134854522', memberUid: u, displayName: u })),
    });
    const tv = (await goi('GET', '/nhom/test-bqu-g-vt/thanh-vien')).json();
    expect(tv.thanhVien.find((t: { zaloUid: string }) => t.zaloUid === HUNG_VT)).toMatchObject({ loai: 'nhan_vien', nhanVien: { tenGoi: 'Trần Hưng' } });
    // Nhóm của nick CL: nick VT hiện bằng uid 1333… — tin chung ⇒ chỉ ĐỀ XUẤT nick CRM (chưa hiệu lực, chưa gửi bot).
    await prisma.groupMember.createMany({
      data: ['1333113565670020202', HUNG_CL].map((u) => ({ orgId: ORG, zaloAccountId: CL, groupId: '1753469850074106815', memberUid: u, displayName: u })),
    });
    _xoaNhipBoSung();
    expect((await boSungUidNhanVien(ORG)).nickCrm).toBe(0);
    let tvCl = (await goi('GET', '/nhom/test-bqu-g-cl/thanh-vien')).json();
    expect(tvCl.thanhVien.find((t: { zaloUid: string }) => t.zaloUid === '1333113565670020202'))
      .toMatchObject({ loai: 'nguoi_ngoai', nickCrm: null, nickCrmDeXuat: { id: VT, ten: 'Vận Tải Minh Thức', soTin: 2 } });
    expect((await docCauHinhCongKhai(ORG)).nick_crm).toEqual([]);
    // Chủ bấm "Đúng là nick Vận Tải" ⇒ chu_xac_nhan, hiệu lực.
    expect((await goi('POST', '/nhom/test-bqu-g-cl/nick-crm', { zaloUid: '1333113565670020202', nickId: VT })).json()).toEqual({ doi: true });
    tvCl = (await goi('GET', '/nhom/test-bqu-g-cl/thanh-vien')).json();
    expect(tvCl.thanhVien.find((t: { zaloUid: string }) => t.zaloUid === '1333113565670020202'))
      .toMatchObject({ loai: 'nick_crm', laNickCrm: true, nickCrm: { id: VT, nguon: 'chu_xac_nhan' }, nickCrmDeXuat: null });
    expect(tvCl.thanhVien.find((t: { zaloUid: string }) => t.zaloUid === HUNG_CL)).toMatchObject({ loai: 'nhan_vien', laNickCrm: false });
    expect((await docCauHinhCongKhai(ORG)).nick_crm).toEqual([{ nick_uid: CL_UID, uid: '1333113565670020202', nick_ten: 'Vận Tải Minh Thức' }]);
    await prisma.groupMember.deleteMany({ where: { orgId: ORG } });
  });
});
