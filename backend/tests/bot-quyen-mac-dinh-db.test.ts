// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot — MẶC ĐỊNH chức năng nhóm (docs/77 §8) trên Postgres THẬT:
//   • API công khai phát chức năng HIỆU LỰC + `mac_dinh`; nhóm chưa biết đủ danh sách vắng mặt (bot im);
//   • đổi danh sách NV / thành viên ⇒ mặc định tính lại ⇒ phien_ban đổi; chủ xếp tường minh luôn thắng;
//   • hàng đợi đọc danh sách (bộ đọc Zalo giả): ghi bản đọc, đánh dấu "cần đọc lại" tắt mặc định NGAY, đua đọc↔đánh dấu,
//     nick kết nối lại, vòng quét, lỗi Zalo.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach, afterEach, describe } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { botQuyenPublicRoutes } from '../src/modules/bot-quyen/bot-quyen-public-routes.js';
import {
  xepHangDocLai, choHangDoiXong, danhDauNhomDoiThanhVien, danhDauNickKetNoiLai, quetMotVong, _datBoDocChoTest,
  type DocThongTinNhom,
} from '../src/modules/bot-quyen/bot-quyen-danh-sach.js';

const ORG = 'test-bqm-org';
const KHOA = 'test-bqm-khoa';
const OWNER = 'test-bqm-owner';
const NICK = 'test-bqm-nick';
const NICK2 = 'test-bqm-nick2';
const NICK_UID = 'bqm-uid-nick';
const NICK2_UID = 'bqm-uid-nick2';
const G = (n: number) => `test-bqm-g${n}`;
const EXT = (n: number) => `bqm-ext-${n}`;

async function donDep() {
  await prisma.botNhomDanhSach.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhom.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhanVien.deleteMany({ where: { orgId: ORG } });
  await prisma.conversation.deleteMany({ where: { orgId: ORG } });
  await prisma.zaloAccount.deleteMany({ where: { orgId: ORG } });
  await prisma.appSetting.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { orgId: ORG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
}

async function banDoc(n: number, uids: string[], them: { dayDu?: boolean; canDocLai?: boolean } = {}) {
  await prisma.botNhomDanhSach.create({
    data: {
      orgId: ORG, conversationId: G(n), zaloAccountId: NICK, uids, dayDu: them.dayDu ?? true,
      canDocLai: them.canDocLai ?? false, docLuc: new Date(),
    },
  });
}

let app: FastifyInstance;
async function lay() {
  const res = await app.inject({ method: 'GET', url: '/api/public/bot-quyen', headers: { 'x-api-key': KHOA } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { phien_ban: string; nhom: Array<Record<string, unknown>> };
}
const nhomCua = (body: { nhom: Array<Record<string, unknown>> }, n: number) => body.nhom.find((x) => x.conversation_id === G(n));

describeCanDb('bot-quyen — mặc định chức năng nhóm (DB)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.organization.create({ data: { id: ORG, name: 'BQM' } });
    await prisma.user.create({ data: { id: OWNER, orgId: ORG, email: `${OWNER}@x.com`, passwordHash: 'x', fullName: 'Chủ', role: 'owner' } });
    await prisma.appSetting.create({ data: { orgId: ORG, settingKey: 'public_api_key', valuePlain: KHOA } });
    await prisma.zaloAccount.create({ data: { id: NICK, orgId: ORG, ownerUserId: OWNER, zaloUid: NICK_UID, status: 'connected' } });
    await prisma.zaloAccount.create({ data: { id: NICK2, orgId: ORG, ownerUserId: OWNER, zaloUid: NICK2_UID, status: 'disconnected' } });
    for (let n = 1; n <= 8; n++) {
      await prisma.conversation.create({
        data: { id: G(n), orgId: ORG, zaloAccountId: n === 8 ? NICK2 : NICK, threadType: 'group', externalThreadId: EXT(n) },
      });
    }
    app = Fastify({ logger: false });
    await app.register(botQuyenPublicRoutes);
    await app.ready();
  });

  afterAll(async () => {
    _datBoDocChoTest(null);
    await app?.close();
    await donDep();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.botNhomDanhSach.deleteMany({ where: { orgId: ORG } });
    await prisma.botNhom.deleteMany({ where: { orgId: ORG } });
    await prisma.botNhanVien.deleteMany({ where: { orgId: ORG } });
    await prisma.botNhanVien.createMany({
      data: [
        { orgId: ORG, zaloUid: 'a', tenGoi: 'An', vai: 'sales' },
        { orgId: ORG, zaloUid: 'b', tenGoi: 'Bình', vai: 'cong_ty' },
        { orgId: ORG, zaloUid: 'c', tenGoi: 'Cúc', vai: 'kho', trangThai: 'khoa' },
      ],
    });
  });

  describe('API công khai', () => {
    it('bảng mặc định: toàn NV ⇒ sales · người ngoài / nick khác ⇒ khach · thiếu / chờ đọc / chưa đọc ⇒ vắng · tường minh thắng', async () => {
      await banDoc(1, [NICK_UID, 'a', 'b', 'c']);        // toàn NV (kể cả cong_ty, NV khoá) + nick của nhóm
      await banDoc(2, [NICK_UID, 'a', 'x']);             // một người ngoài
      await banDoc(3, [NICK_UID, 'a', NICK2_UID]);       // nick CRM khác chưa là NV
      await banDoc(4, [NICK_UID, 'a'], { dayDu: false }); // danh sách thiếu
      await banDoc(5, [NICK_UID, 'a', 'x']);             // có người ngoài NHƯNG chủ xếp admin
      await banDoc(7, [NICK_UID, 'a'], { canDocLai: true }); // chờ đọc lại
      // G6: chưa có bản đọc
      await prisma.botNhom.create({ data: { orgId: ORG, conversationId: G(5), chucNang: 'admin', tenDangKy: 'Nhóm sếp' } });

      const body = await lay();
      expect(body.nhom.map((x) => x.conversation_id)).toEqual([G(1), G(2), G(3), G(5)]);
      expect(nhomCua(body, 1)).toEqual({
        conversation_id: G(1), external_thread_id: EXT(1), nick_uid: NICK_UID, chuc_nang: 'sales', ten_dang_ky: '', mac_dinh: true,
      });
      expect(nhomCua(body, 2)).toMatchObject({ chuc_nang: 'khach', mac_dinh: true });
      expect(nhomCua(body, 3)).toMatchObject({ chuc_nang: 'khach', mac_dinh: true });
      expect(nhomCua(body, 5)).toMatchObject({ chuc_nang: 'admin', mac_dinh: false, ten_dang_ky: 'Nhóm sếp' });
    });

    it('NV bị cho nghỉ / thêm NV ⇒ mặc định tính lại, phien_ban đổi; đổi lại như cũ ⇒ phien_ban như cũ', async () => {
      await banDoc(1, [NICK_UID, 'a', 'b']);
      await banDoc(2, [NICK_UID, 'a', 'x']);
      const v1 = await lay();
      expect(nhomCua(v1, 1)).toMatchObject({ chuc_nang: 'sales' });

      await prisma.botNhanVien.updateMany({ where: { orgId: ORG, zaloUid: 'b' }, data: { trangThai: 'nghi' } });
      const v2 = await lay();
      expect(nhomCua(v2, 1)).toMatchObject({ chuc_nang: 'khach', mac_dinh: true });
      expect(v2.phien_ban).not.toBe(v1.phien_ban);

      await prisma.botNhanVien.updateMany({ where: { orgId: ORG, zaloUid: 'b' }, data: { trangThai: 'hoat_dong' } });
      expect((await lay()).phien_ban).toBe(v1.phien_ban);

      // Người ngoài x được xếp là NV ⇒ G2 thành nhóm nhân viên.
      await prisma.botNhanVien.create({ data: { orgId: ORG, zaloUid: 'x', tenGoi: 'Xuân', vai: 'sales' } });
      const v3 = await lay();
      expect(nhomCua(v3, 2)).toMatchObject({ chuc_nang: 'sales', mac_dinh: true });
      expect(v3.phien_ban).not.toBe(v1.phien_ban);
    });

    it('chủ xếp tường minh đè mặc định (kể cả cùng giá trị: mac_dinh đổi ⇒ phien_ban đổi); bỏ xếp ⇒ về mặc định', async () => {
      await banDoc(1, [NICK_UID, 'a']);
      const v1 = await lay();
      await prisma.botNhom.create({ data: { orgId: ORG, conversationId: G(1), chucNang: 'sales' } });
      const v2 = await lay();
      expect(nhomCua(v2, 1)).toMatchObject({ chuc_nang: 'sales', mac_dinh: false });
      expect(v2.phien_ban).not.toBe(v1.phien_ban);
      await prisma.botNhom.deleteMany({ where: { conversationId: G(1) } });
      expect((await lay()).phien_ban).toBe(v1.phien_ban);
    });
  });

  describe('đọc danh sách thành viên (bộ đọc Zalo giả)', () => {
    let goi: Array<{ nick: string; ids: string[] }>;
    let traLoi: Record<string, { uids: string[]; tong?: number; conThieu?: number }>;
    let loiZalo: Error | null;
    let chan: Promise<void> | null;
    let moHet: Array<() => void> = [];
    /** Cổng giữ lần đọc Zalo đang chạy — afterEach luôn mở (không treo hàng đợi). */
    const giu = (): Promise<void> => new Promise((r) => { moHet.push(r); });

    const boDoc: DocThongTinNhom = async (nick, ids) => {
      goi.push({ nick, ids });
      if (chan) await chan;
      if (loiZalo) throw loiZalo;
      const gridInfoMap: Record<string, unknown> = {};
      for (const id of ids) {
        const t = traLoi[id];
        if (!t) continue;
        gridInfoMap[id] = {
          memVerList: t.uids.map((u) => `${u}_0`), totalMember: t.tong ?? t.uids.length, hasMoreMember: t.conThieu ?? 0,
        };
      }
      return { gridInfoMap };
    };

    beforeEach(() => {
      goi = [];
      traLoi = {};
      loiZalo = null;
      chan = null;
      _datBoDocChoTest(boDoc);
    });
    afterEach(async () => {
      chan = null;
      for (const mo of moHet) mo();
      moHet = [];
      await choHangDoiXong();
    });

    const docDong = (n: number) => prisma.botNhomDanhSach.findUnique({ where: { conversationId: G(n) } });

    it('đọc theo lô một lần gọi cho nhiều nhóm cùng nick; ghi uid + đủ/thiếu', async () => {
      traLoi = { [EXT(1)]: { uids: [NICK_UID, 'a'] }, [EXT(2)]: { uids: [NICK_UID, 'a', 'x'], tong: 5 } };
      await xepHangDocLai([G(1), G(2)]);
      await choHangDoiXong();
      expect(goi).toEqual([{ nick: NICK, ids: [EXT(1), EXT(2)] }]);
      expect(await docDong(1)).toMatchObject({ uids: [NICK_UID, 'a'].sort(), dayDu: true, canDocLai: false, loi: null });
      expect(await docDong(2)).toMatchObject({ dayDu: false, canDocLai: false });
      expect(nhomCua(await lay(), 1)).toMatchObject({ chuc_nang: 'sales', mac_dinh: true });
      expect(nhomCua(await lay(), 2)).toBeUndefined();
    });

    it('Zalo báo thành viên đổi ⇒ mặc định tắt NGAY (bot im) rồi đọc lại: người ngoài vào ⇒ khach', async () => {
      traLoi = { [EXT(1)]: { uids: [NICK_UID, 'a'] } };
      await xepHangDocLai([G(1)]);
      await choHangDoiXong();
      expect(nhomCua(await lay(), 1)).toMatchObject({ chuc_nang: 'sales' });

      traLoi = { [EXT(1)]: { uids: [NICK_UID, 'a', 'la'] } };
      chan = giu(); // giữ lần đọc lại để thấy trạng thái giữa chừng
      await danhDauNhomDoiThanhVien(ORG, NICK, EXT(1));
      expect(nhomCua(await lay(), 1)).toBeUndefined(); // đang chờ đọc lại ⇒ không có mặc định ⇒ bot im
      chan = null;
    });

    it('người ngoài vào: sau khi đọc lại xong ⇒ khach', async () => {
      traLoi = { [EXT(1)]: { uids: [NICK_UID, 'a', 'la'] } };
      await prisma.botNhomDanhSach.create({ data: { orgId: ORG, conversationId: G(1), zaloAccountId: NICK, uids: [NICK_UID, 'a'], dayDu: true, canDocLai: false } });
      await danhDauNhomDoiThanhVien(ORG, NICK, EXT(1));
      await choHangDoiXong();
      expect(nhomCua(await lay(), 1)).toMatchObject({ chuc_nang: 'khach', mac_dinh: true });
    });

    it('đua: bị đánh dấu TRONG LÚC đang đọc ⇒ lần đọc đó không gỡ cờ; lần đọc kế tiếp mới gỡ', async () => {
      traLoi = { [EXT(1)]: { uids: [NICK_UID, 'a'] } };
      chan = giu();
      const mo = moHet[moHet.length - 1];
      const xong = xepHangDocLai([G(1)]);
      while (goi.length === 0) await new Promise((r) => setTimeout(r, 5));
      // Lần đọc 1 đã BẮT ĐẦU. Dòng chưa có ⇒ tạo dòng rồi đánh dấu như sự kiện thật.
      await prisma.botNhomDanhSach.create({ data: { orgId: ORG, conversationId: G(1), zaloAccountId: NICK, canDocLai: true } });
      await new Promise((r) => setTimeout(r, 5));
      await danhDauNhomDoiThanhVien(ORG, NICK, EXT(1)); // xếp hàng lần đọc 2
      const soGoiTruoc = goi.length;
      chan = null;
      mo();
      await xong;
      await choHangDoiXong();
      expect(goi.length).toBe(soGoiTruoc + 1); // có lần đọc thứ hai
      expect(await docDong(1)).toMatchObject({ canDocLai: false, dayDu: true });
    });

    it('lần đọc bắt đầu trước khi bị đánh dấu mà không có lần đọc sau ⇒ cờ giữ nguyên', async () => {
      traLoi = { [EXT(1)]: { uids: [NICK_UID, 'a'] } };
      await prisma.botNhomDanhSach.create({
        data: { orgId: ORG, conversationId: G(1), zaloAccountId: NICK, canDocLai: true, danhDauLuc: new Date(Date.now() + 60_000) },
      });
      await xepHangDocLai([G(1)]);
      await choHangDoiXong();
      expect(await docDong(1)).toMatchObject({ canDocLai: true, uids: [NICK_UID, 'a'].sort() });
    });

    it('nick kết nối lại ⇒ mọi nhóm của nick bị đánh dấu rồi đọc lại (nhóm nick khác không đụng)', async () => {
      await banDoc(1, [NICK_UID, 'a']);
      await prisma.botNhomDanhSach.create({ data: { orgId: ORG, conversationId: G(8), zaloAccountId: NICK2, uids: [NICK2_UID], dayDu: true, canDocLai: false } });
      traLoi = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [EXT(n), { uids: [NICK_UID, 'a'] }]));
      chan = giu();
      await danhDauNickKetNoiLai(ORG, NICK);
      expect(await docDong(1)).toMatchObject({ canDocLai: true });
      expect(await docDong(8)).toMatchObject({ canDocLai: false });
      expect(nhomCua(await lay(), 1)).toBeUndefined();
      chan = null;
    });

    it('nick kết nối lại: sau khi đọc xong mọi nhóm của nick có bản đọc tươi', async () => {
      traLoi = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [EXT(n), { uids: [NICK_UID, 'a'] }]));
      await danhDauNickKetNoiLai(ORG, NICK);
      await choHangDoiXong();
      const dong = await prisma.botNhomDanhSach.findMany({ where: { orgId: ORG, zaloAccountId: NICK } });
      expect(dong).toHaveLength(7);
      expect(dong.every((d) => !d.canDocLai && d.dayDu)).toBe(true);
    });

    it('Zalo lỗi ⇒ ghi lỗi, dòng mới cần đọc lại (không mặc định); bản cũ giữ nguyên nhưng không gỡ cờ', async () => {
      loiZalo = new Error('rate limit');
      await xepHangDocLai([G(1)]);
      await choHangDoiXong();
      expect(await docDong(1)).toMatchObject({ canDocLai: true, loi: 'rate limit' });
      expect(nhomCua(await lay(), 1)).toBeUndefined();
    });

    it('Zalo không trả nhóm trong lô (nick đã rời nhóm) ⇒ lỗi riêng nhóm đó, nhóm khác vẫn ghi', async () => {
      traLoi = { [EXT(2)]: { uids: [NICK_UID, 'a'] } };
      await xepHangDocLai([G(1), G(2)]);
      await choHangDoiXong();
      expect(await docDong(1)).toMatchObject({ canDocLai: true });
      expect((await docDong(1))?.loi).toMatch(/không trả/);
      expect(await docDong(2)).toMatchObject({ canDocLai: false, dayDu: true });
    });

    it('vòng quét: đọc nhóm chưa có bản đọc của nick ĐANG kết nối, thử lại bản lỗi cũ ≥ 60 s; bỏ nick mất kết nối', async () => {
      traLoi = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [EXT(n), { uids: [NICK_UID, 'a'] }]));
      await banDoc(1, [NICK_UID, 'a']); // tươi — không đọc lại
      await prisma.botNhomDanhSach.create({
        data: { orgId: ORG, conversationId: G(2), zaloAccountId: NICK, canDocLai: true, thuLuc: new Date(), loi: 'x' }, // lỗi vừa xong — chưa thử lại
      });
      // Vòng quét chạy cho MỌI org — chỉ xét nhóm của org test (DB test có thể có org khác).
      const cuaOrg = (ids: string[]) => ids.filter((id) => id.startsWith('bqm-ext-')).sort();
      const so = await quetMotVong();
      await choHangDoiXong();
      expect(so).toBeGreaterThanOrEqual(5);
      expect(cuaOrg(goi.flatMap((g) => g.ids))).toEqual([3, 4, 5, 6, 7].map(EXT).sort()); // G8: nick mất kết nối
      expect(await docDong(8)).toBeNull();
      // 61 s sau, bản lỗi G2 được thử lại (G1 tươi, G3..G7 vừa đọc xong ⇒ không đọc lại).
      goi = [];
      await quetMotVong(new Date(Date.now() + 61_000));
      await choHangDoiXong();
      expect(cuaOrg(goi.flatMap((g) => g.ids))).toEqual([EXT(2)]);
    });
  });
});
