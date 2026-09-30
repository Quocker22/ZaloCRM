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
  xepHangDocLai, choHangDoiXong, danhDauNhomDoiThanhVien, danhDauNickKetNoiLai, quetMotVong, quetDinhKy,
  ghiNhanDoiMacDinh, soLanDaDocHomNay, _datBoDocChoTest, _datMoiTruongChoTest, AI_TU_DONG, GOM_KET_NOI_LAI_MS,
  type DocThongTinNhom,
} from '../src/modules/bot-quyen/bot-quyen-danh-sach.js';
import { _thongKeBoNho } from '../src/modules/bot-quyen/bot-quyen-cong-khai.js';
import { themNhanVien, suaNhanVien, docNhatKy } from '../src/modules/bot-quyen/bot-quyen-service.js';
import { withTenant } from '../src/shared/tenant/tenant-context.js';
import { TUOI_TOI_DA_SALES_MS } from '../src/modules/bot-quyen/bot-quyen-mac-dinh.js';

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
  await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: ORG } });
  await prisma.groupMember.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhomDanhSach.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhom.deleteMany({ where: { orgId: ORG } });
  await prisma.botNhanVien.deleteMany({ where: { orgId: ORG } });
  await prisma.conversation.deleteMany({ where: { orgId: ORG } });
  await prisma.zaloAccount.deleteMany({ where: { orgId: ORG } });
  await prisma.appSetting.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { orgId: ORG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
}

async function banDoc(
  n: number, uids: string[], them: { dayDu?: boolean; canDocLai?: boolean; docLuc?: Date; macDinhCuoi?: string } = {},
) {
  await prisma.botNhomDanhSach.create({
    data: {
      orgId: ORG, conversationId: G(n), zaloAccountId: n === 8 ? NICK2 : NICK, uids, dayDu: them.dayDu ?? true,
      canDocLai: them.canDocLai ?? false, docLuc: them.docLuc ?? new Date(), macDinhCuoi: them.macDinhCuoi ?? null,
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
    _datMoiTruongChoTest({ dongHo: null, tranNgay: null });
    await app?.close();
    await donDep();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    _datMoiTruongChoTest({ dongHo: null, tranNgay: async () => 400 });
    _thongKeBoNho(true);
    await prisma.botQuyenNhatKy.deleteMany({ where: { orgId: ORG } });
    await prisma.groupMember.deleteMany({ where: { orgId: ORG } });
    await prisma.conversation.updateMany({ where: { orgId: ORG }, data: { deletedAt: null } });
    await prisma.zaloAccount.updateMany({ where: { orgId: ORG }, data: { archivedAt: null } });
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

    it('vòng quét: đọc nhóm chưa có bản đọc của nick ĐANG kết nối, thử lại bản lỗi khi tới giờ lùi; bỏ nick mất kết nối', async () => {
      traLoi = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [EXT(n), { uids: [NICK_UID, 'a'] }]));
      await banDoc(1, [NICK_UID, 'a']); // tươi — không đọc lại
      await prisma.botNhomDanhSach.create({
        data: {
          orgId: ORG, conversationId: G(2), zaloAccountId: NICK, canDocLai: true, thuLuc: new Date(), loi: 'x', soLanLoi: 1,
          thuLaiSau: new Date(Date.now() + 60_000), // lỗi vừa xong — lùi 1 phút
        },
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

    const cuaOrg = (ids: string[]) => ids.filter((id) => id.startsWith('bqm-ext-')).sort();
    const cho = () => new Promise((r) => setTimeout(r, 5));
    const tatCa = () => Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [EXT(n), { uids: [NICK_UID, 'a'] }]));

    // ── Review P1-1 / P2-3 ────────────────────────────────────────────────

    it('P1-1: sự kiện thành viên tới TRƯỚC khi lần đọc ĐẦU ghi dòng ⇒ không gỡ cờ; đọc lại LỖI ⇒ vẫn không mặc định', async () => {
      let lan = 0;
      let moCong: () => void = () => {};
      const cong = new Promise<void>((r) => { moCong = r; });
      moHet.push(moCong);
      _datBoDocChoTest(async (nick, ids) => {
        goi.push({ nick, ids });
        lan++;
        if (lan === 1) { await cong; return { gridInfoMap: { [EXT(1)]: { memVerList: [`${NICK_UID}_0`, 'a_0'], totalMember: 2 } } }; }
        throw new Error('Zalo lỗi tạm');
      });
      const xong = xepHangDocLai([G(1)]);
      while (goi.length === 0) await cho();
      expect(await docDong(1)).toBeNull(); // lần đọc đầu đang bay, CHƯA có dòng
      await danhDauNhomDoiThanhVien(ORG, NICK, EXT(1)); // người ngoài vào
      expect(await docDong(1)).toMatchObject({ canDocLai: true }); // upsert: dòng đánh dấu được TẠO
      moCong();
      await xong;
      await choHangDoiXong();
      expect(lan).toBe(2); // có lần đọc lại — và nó lỗi
      expect(await docDong(1)).toMatchObject({ canDocLai: true, uids: [NICK_UID, 'a'].sort(), loi: 'Zalo lỗi tạm' });
      expect(nhomCua(await lay(), 1)).toBeUndefined(); // KHÔNG phục vụ danh sách trước-khi-vào là `sales`
    });

    it('P2-3: đánh dấu CÙNG mili-giây với lúc bắt đầu đọc ⇒ giữ cờ (>=)', async () => {
      const T = new Date('2026-09-30T05:00:00.000Z');
      _datMoiTruongChoTest({ dongHo: () => T });
      await banDoc(1, [NICK_UID, 'a'], { docLuc: new Date('2026-09-30T04:00:00Z') });
      _datBoDocChoTest(async (nick, ids) => {
        goi.push({ nick, ids });
        // Sự kiện thành viên ghi mốc đúng bằng lúc bắt đầu đọc (đồng hồ ms trùng).
        await prisma.botNhomDanhSach.update({ where: { conversationId: G(1) }, data: { canDocLai: true, danhDauLuc: T } });
        return { gridInfoMap: { [EXT(1)]: { memVerList: [`${NICK_UID}_0`, 'a_0'], totalMember: 2 } } };
      });
      await xepHangDocLai([G(1)]);
      await choHangDoiXong();
      expect(await docDong(1)).toMatchObject({ canDocLai: true });
    });

    // ── Review P1-2 ───────────────────────────────────────────────────────

    it('P1-2: lỗi liên tiếp ⇒ lùi 1 → 2 phút; vòng quét không đọc trước giờ hẹn', async () => {
      let now = Date.now();
      _datMoiTruongChoTest({ dongHo: () => new Date(now) });
      loiZalo = new Error('rate limit');
      await xepHangDocLai([G(1)]);
      await choHangDoiXong();
      let d = await docDong(1);
      expect(d).toMatchObject({ soLanLoi: 1, canDocLai: true });
      expect(d!.thuLaiSau!.getTime() - now).toBe(60_000);

      now += 30_000;
      goi = [];
      await quetMotVong();
      await choHangDoiXong();
      expect(cuaOrg(goi.flatMap((g) => g.ids))).not.toContain(EXT(1));

      now = d!.thuLaiSau!.getTime();
      goi = [];
      await quetMotVong();
      await choHangDoiXong();
      expect(cuaOrg(goi.flatMap((g) => g.ids))).toContain(EXT(1));
      d = await docDong(1);
      expect(d!.soLanLoi).toBe(2);
      expect(d!.thuLaiSau!.getTime() - now).toBe(120_000);
    });

    it('P1-2: Zalo không trả nhóm ⇒ DỪNG (không thử lại, kể cả 2 ngày sau); sự kiện thành viên gỡ dừng + đọc lại', async () => {
      await xepHangDocLai([G(1)]);
      await choHangDoiXong();
      expect(await docDong(1)).toMatchObject({ khongTra: true, canDocLai: true });
      goi = [];
      await quetMotVong(new Date(Date.now() + 2 * 86_400_000));
      await choHangDoiXong();
      expect(cuaOrg(goi.flatMap((g) => g.ids))).not.toContain(EXT(1));

      traLoi = { [EXT(1)]: { uids: [NICK_UID, 'a'] } };
      await danhDauNhomDoiThanhVien(ORG, NICK, EXT(1));
      await choHangDoiXong();
      expect(await docDong(1)).toMatchObject({ khongTra: false, canDocLai: false, soLanLoi: 0, loi: null });
    });

    it('P1-2 / P2-4: hội thoại đã xoá / nick lưu trữ: không đọc, không đánh dấu, không mặc định (xếp tường minh vẫn phát)', async () => {
      traLoi = tatCa();
      await banDoc(1, [NICK_UID, 'a']);
      await banDoc(2, [NICK_UID, 'a']);
      await banDoc(8, [NICK2_UID]);
      await prisma.conversation.updateMany({ where: { id: { in: [G(1), G(3)] } }, data: { deletedAt: new Date() } });
      await prisma.botNhom.create({ data: { orgId: ORG, conversationId: G(3), chucNang: 'admin' } });
      await prisma.zaloAccount.update({ where: { id: NICK2 }, data: { archivedAt: new Date() } });

      const body = await lay();
      expect(nhomCua(body, 1)).toBeUndefined(); // đã xoá ⇒ không mặc định
      expect(nhomCua(body, 2)).toMatchObject({ chuc_nang: 'sales', mac_dinh: true });
      expect(nhomCua(body, 3)).toMatchObject({ chuc_nang: 'admin', mac_dinh: false });
      expect(nhomCua(body, 8)).toBeUndefined(); // nick lưu trữ

      await danhDauNhomDoiThanhVien(ORG, NICK, EXT(1));
      expect(await docDong(1)).toMatchObject({ canDocLai: false }); // không đánh dấu hội thoại đã xoá
      await xepHangDocLai([G(1), G(3)]);
      await danhDauNickKetNoiLai(ORG, NICK2);
      await choHangDoiXong();
      expect(goi.flatMap((g) => g.ids)).toEqual([]); // không đọc gì
      await quetMotVong();
      await choHangDoiXong();
      expect(cuaOrg(goi.flatMap((g) => g.ids))).not.toContain(EXT(1));
      expect(cuaOrg(goi.flatMap((g) => g.ids))).not.toContain(EXT(3));
    });

    it('P1-2: ngân sách/ngày/nick — hết ⇒ đọc gấp không gọi Zalo, ghi lý do + hẹn sang ngày mai; định kỳ chỉ dùng nửa', async () => {
      traLoi = tatCa();
      _datMoiTruongChoTest({ tranNgay: async () => 2 });
      await xepHangDocLai([G(1)]);
      await choHangDoiXong();
      await xepHangDocLai([G(2)]);
      await choHangDoiXong();
      await xepHangDocLai([G(3)]);
      await choHangDoiXong();
      expect(goi).toHaveLength(2);
      expect(await soLanDaDocHomNay(NICK)).toBe(2);
      const d3 = await docDong(3);
      expect(d3).toMatchObject({ canDocLai: true });
      expect(d3!.loi).toMatch(/hết 2 lượt/);
      const mai = new Date();
      mai.setUTCHours(24, 0, 0, 0);
      expect(d3!.thuLaiSau!.getTime()).toBe(mai.getTime());

      _datMoiTruongChoTest({ tranNgay: async () => 4 }); // định kỳ tối đa 2 lượt / ngày
      goi = [];
      for (const n of [1, 2, 4]) {
        await xepHangDocLai([G(n)], 'dinh_ky');
        await choHangDoiXong();
      }
      expect(goi).toHaveLength(2);
      await xepHangDocLai([G(5)]); // đọc gấp vẫn còn chỗ
      await choHangDoiXong();
      expect(goi).toHaveLength(3);
    });

    it('P2-6: nối lại liên tục ⇒ đánh dấu NGAY mỗi lần, nhưng đọc tối đa một lượt / 5 phút; vòng quét đọc lượt đã hẹn', async () => {
      const t0 = Date.now();
      let now = t0;
      let tick = 0; // đồng hồ luôn tiến ≥ 1 ms mỗi lần đọc (lần đọc do chính lần đánh dấu gây ra bắt đầu SAU nó)
      _datMoiTruongChoTest({ dongHo: () => new Date(now + tick++) });
      traLoi = tatCa();
      await danhDauNickKetNoiLai(ORG, NICK);
      await choHangDoiXong();
      expect(goi).toHaveLength(1);
      expect(nhomCua(await lay(), 1)).toMatchObject({ chuc_nang: 'sales' });

      const hen: number[] = [];
      for (const buoc of [10_000, 20_000, 200_000]) {
        now = t0 + buoc;
        await danhDauNickKetNoiLai(ORG, NICK);
        await choHangDoiXong();
        expect(goi).toHaveLength(1); // không đọc thêm
        const d = await docDong(1);
        expect(d).toMatchObject({ canDocLai: true }); // nhưng đánh dấu ngay ⇒ bot im
        hen.push(d!.thuLaiSau!.getTime());
      }
      expect(new Set(hen).size).toBe(1); // hẹn không bị đẩy lùi
      expect(Math.abs(hen[0] - (t0 + GOM_KET_NOI_LAI_MS))).toBeLessThan(50);
      expect(nhomCua(await lay(), 1)).toBeUndefined();

      goi = [];
      await quetMotVong();
      await choHangDoiXong();
      expect(cuaOrg(goi.flatMap((g) => g.ids))).not.toContain(EXT(1)); // chưa tới hẹn
      now = hen[0];
      await quetMotVong();
      await choHangDoiXong();
      expect(cuaOrg(goi.flatMap((g) => g.ids)).filter((x) => x === EXT(1))).toHaveLength(1);
      expect(await docDong(1)).toMatchObject({ canDocLai: false });
      expect(nhomCua(await lay(), 1)).toMatchObject({ chuc_nang: 'sales' });
    });

    // ── Góp ý chủ (3): đọc lại định kỳ + độ cũ tối đa ─────────────────────

    it('(3) đọc lại định kỳ: bản tươi ≥ 30 phút, sales trước, bỏ nhóm xếp tường minh; không còn ngân sách ⇒ sales > 6 giờ im', async () => {
      traLoi = tatCa();
      traLoi[EXT(2)] = { uids: [NICK_UID, 'x'] };
      const cu = new Date(Date.now() - TUOI_TOI_DA_SALES_MS - 60_000);
      await banDoc(2, [NICK_UID, 'x'], { docLuc: new Date(cu.getTime() - 60_000), macDinhCuoi: 'khach' }); // cũ hơn nhưng khach
      await banDoc(1, [NICK_UID, 'a'], { docLuc: cu, macDinhCuoi: 'sales' });
      await banDoc(3, [NICK_UID, 'a'], { docLuc: cu, macDinhCuoi: 'sales' });
      await prisma.botNhom.create({ data: { orgId: ORG, conversationId: G(3), chucNang: 'kho' } });
      await banDoc(4, [NICK_UID, 'a'], { macDinhCuoi: 'sales' }); // vừa đọc

      let body = await lay();
      expect(nhomCua(body, 1)).toBeUndefined(); // sales quá 6 giờ ⇒ im
      expect(nhomCua(body, 2)).toMatchObject({ chuc_nang: 'khach' }); // khach cũ vẫn giữ
      expect(nhomCua(body, 4)).toMatchObject({ chuc_nang: 'sales' });

      _datMoiTruongChoTest({ tranNgay: async () => 0 }); // hết ngân sách
      await quetDinhKy();
      await choHangDoiXong();
      expect(goi).toEqual([]);
      expect(nhomCua(await lay(), 1)).toBeUndefined(); // vẫn im — không phục vụ bản cũ

      _datMoiTruongChoTest({ tranNgay: async () => 400 });
      await quetDinhKy();
      await choHangDoiXong();
      expect(goi.map((g) => g.ids.filter((x) => x.startsWith('bqm-ext-')))).toEqual([[EXT(1), EXT(2)]]); // sales trước
      body = await lay();
      expect(nhomCua(body, 1)).toMatchObject({ chuc_nang: 'sales', mac_dinh: true });
    });

    // ── Góp ý chủ (4): nhật ký mặc định tự đổi ────────────────────────────

    const nhatKy = () => prisma.botQuyenNhatKy.findMany({ where: { orgId: ORG }, orderBy: { luc: 'asc' } });

    it('(4) mặc định tự đổi sau lần đọc ⇒ MỘT dòng "tự động" có tên người ngoài; gọi lại không trùng; im rồi đọc lại không ghi', async () => {
      traLoi = { [EXT(1)]: { uids: [NICK_UID, 'a'] } };
      await xepHangDocLai([G(1)]);
      await choHangDoiXong();
      expect(await docDong(1)).toMatchObject({ macDinhCuoi: 'sales' });
      expect(await nhatKy()).toEqual([]); // lần đầu có mặc định: chỉ đặt mốc

      await prisma.groupMember.create({
        data: { orgId: ORG, zaloAccountId: NICK, groupId: EXT(1), memberUid: 'la', displayName: 'Lạ Văn A' },
      });
      traLoi = { [EXT(1)]: { uids: [NICK_UID, 'a', 'la'] } };
      await danhDauNhomDoiThanhVien(ORG, NICK, EXT(1));
      await choHangDoiXong();
      let nk = await nhatKy();
      expect(nk).toHaveLength(1);
      expect(nk[0]).toMatchObject({
        aiId: AI_TU_DONG, doiTuong: 'nhom', doiTuongId: G(1),
        truoc: { chucNang: 'sales', macDinh: true }, sau: { chucNang: 'khach', macDinh: true },
        lyDo: 'có người ngoài vào nhóm: Lạ Văn A',
      });

      await Promise.all([ghiNhanDoiMacDinh(ORG), ghiNhanDoiMacDinh(ORG)]);
      await danhDauNhomDoiThanhVien(ORG, NICK, EXT(1)); // im (đang đọc lại) rồi đọc lại cùng danh sách
      await choHangDoiXong();
      nk = await nhatKy();
      expect(nk).toHaveLength(1);

      const view = await withTenant(ORG, () => docNhatKy(ORG, 10));
      expect(view[0]).toMatchObject({ tuDong: true, aiId: AI_TU_DONG, ai: null });
    });

    it('(4) đổi NV ⇒ ghi ngay; nhóm xếp tường minh chỉ cập nhật mốc; nick Riêng tư không ghi tên', async () => {
      await banDoc(1, [NICK_UID, 'a', 'b'], { macDinhCuoi: 'sales' });
      await banDoc(2, [NICK_UID, 'a', 'b'], { macDinhCuoi: 'sales' });
      await prisma.botNhom.create({ data: { orgId: ORG, conversationId: G(2), chucNang: 'sales' } });
      const b = await prisma.botNhanVien.findFirstOrThrow({ where: { orgId: ORG, zaloUid: 'b' } });

      await withTenant(ORG, () => suaNhanVien(ORG, OWNER, b.id, { trangThai: 'nghi', lyDo: 'nghỉ việc' }));
      let nk = (await nhatKy()).filter((x) => x.aiId === AI_TU_DONG);
      expect(nk).toHaveLength(1);
      expect(nk[0]).toMatchObject({ doiTuongId: G(1), lyDo: 'có người ngoài vào nhóm: Bình (đã nghỉ)' });
      expect(await docDong(2)).toMatchObject({ macDinhCuoi: 'khach' });

      await prisma.zaloAccount.update({ where: { id: NICK }, data: { privacyMode: 'main' } });
      try {
        await withTenant(ORG, () => suaNhanVien(ORG, OWNER, b.id, { trangThai: 'hoat_dong' }));
        await withTenant(ORG, () => themNhanVien(ORG, OWNER, { zaloUid: 'q', tenGoi: 'Quý', vai: 'sales' }));
        await prisma.botNhanVien.deleteMany({ where: { orgId: ORG, zaloUid: 'b' } });
        await ghiNhanDoiMacDinh(ORG); // xoá thẳng DB ⇒ vòng đối soát bắt
        nk = (await nhatKy()).filter((x) => x.aiId === AI_TU_DONG);
        expect(nk.map((x) => x.lyDo)).toEqual([
          'có người ngoài vào nhóm: Bình (đã nghỉ)',
          'mọi thành viên đều là nhân viên',
          'có 1 người không phải nhân viên trong nhóm', // nick Riêng tư ⇒ không tên
        ]);
      } finally {
        await prisma.zaloAccount.update({ where: { id: NICK }, data: { privacyMode: 'sub' } });
      }
    });

    // ── Review P2-8: bộ nhớ đệm API công khai ─────────────────────────────

    it('P2-8: poll lặp lại không nạp lại uids; đổi NV ⇒ phien_ban đổi ngay; ghi/xoá bản đọc (mọi đường) ⇒ nạp lại', async () => {
      await banDoc(1, [NICK_UID, 'a']);
      await banDoc(2, [NICK_UID, 'a', 'x']);
      const v1 = await lay();
      const v1b = await lay();
      expect(v1b.phien_ban).toBe(v1.phien_ban);
      expect(_thongKeBoNho()).toBe(1);

      await prisma.botNhanVien.create({ data: { orgId: ORG, zaloUid: 'x', tenGoi: 'Xuân', vai: 'sales' } });
      const v2 = await lay();
      expect(nhomCua(v2, 2)).toMatchObject({ chuc_nang: 'sales' });
      expect(v2.phien_ban).not.toBe(v1.phien_ban);
      expect(_thongKeBoNho()).toBe(1);

      await prisma.botNhomDanhSach.update({ where: { conversationId: G(1) }, data: { uids: [NICK_UID, 'a', 'y'] } });
      const v3 = await lay();
      expect(nhomCua(v3, 1)).toMatchObject({ chuc_nang: 'khach' });
      expect(_thongKeBoNho()).toBe(2);

      await prisma.botNhomDanhSach.delete({ where: { conversationId: G(1) } });
      const v4 = await lay();
      expect(nhomCua(v4, 1)).toBeUndefined();
      expect(_thongKeBoNho()).toBe(3);
      await prisma.botNhanVien.deleteMany({ where: { orgId: ORG, zaloUid: 'x' } });
    });
  });
});
