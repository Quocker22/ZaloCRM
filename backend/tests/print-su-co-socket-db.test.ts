// SPDX-License-Identifier: AGPL-3.0-or-later
// Sự cố máy in BỀN qua socket.io THẬT + Postgres THẬT (docs/78 C1, Codex v1 #2 + #3):
//   • "lưu rồi mới đánh dấu": DB chập ⇒ trạng thái máy chưa LƯU được thì nhịp báo trạng thái SAU ghi lại tới khi lưu được
//     (registry đổi trước không chặn nữa); khởi động lại ⇒ trạng thái đã lưu = dòng cuối trong DB;
//   • định danh một sự cố = (org, máy, nhom_su_co); hồi phục chỉ đóng ĐÚNG nhóm của nó; dấu RAM của socket xoá khi hồi phục.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { registerAgentWs } from '../src/modules/ai/may-in/agent-ws.js';
import { AgentRegistry } from '../src/modules/ai/may-in/agent-registry.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ghiSuCoIn, docTrangThaiMayDaLuu, taoHangThuLaiSuCo, type PrismaSuCoIn, type SuCoIn,
} from '../src/modules/ai/may-in/su-kien-in.js';
import { dichVuHangDoiRong } from './ai/may-in/prisma-gia-hang-doi.js';

const ORG = 'test-psc-org';
const TOKEN = 'test-psc-token-bi-mat-0123456789';

/** Prisma thật, "chập" khi `hong` bật — như DB mất kết nối (mọi truy vấn của lần ghi ném). */
let hong = false;
const prismaChap: PrismaSuCoIn = {
  printSuCo: { create: (a) => (hong ? Promise.reject(new Error('DB chập')) : prisma.printSuCo.create(a as never)) },
  printAgent: {
    findUnique: (a) => (hong ? Promise.reject(new Error('DB chập')) : prisma.printAgent.findUnique(a)),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction: (fn: (tx: any) => Promise<any>) => (hong ? Promise.reject(new Error('DB chập')) : prisma.$transaction(fn)),
  $queryRaw: (...a: unknown[]) => (hong ? Promise.reject(new Error('DB chập')) : (prisma.$queryRaw as (...x: unknown[]) => Promise<unknown>)(...a)),
};

async function suCoDb() {
  const r = await prisma.printSuCo.findMany({ where: { orgId: ORG }, orderBy: { id: 'asc' } });
  return r.map((x) => [x.maSuCo, x.nhomSuCo]);
}

const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Chờ tới khi điều kiện đúng (ghi DB bất đồng bộ sau sự kiện socket). */
async function choToi(dk: () => Promise<boolean>, ms = 3000): Promise<void> {
  const het = Date.now() + ms;
  while (Date.now() < het) {
    if (await dk()) return;
    await cho(20);
  }
}

describeCanDb('print_su_co qua socket THẬT — lưu rồi mới đánh dấu, định danh (org, máy, nhóm) (DB)', () => {
  let httpServer: HttpServer;
  let io: IoServer;
  let registry: AgentRegistry;
  let port: number;
  const clients: ClientSocket[] = [];

  async function donDep() {
    await prisma.printSuCo.deleteMany({ where: { orgId: ORG } });
    await prisma.printAgent.deleteMany({ where: { orgId: ORG } });
  }

  beforeAll(async () => {
    await donDep();
    await prisma.organization.upsert({ where: { id: ORG }, create: { id: ORG, name: 'PSC' }, update: {} });
  });
  afterAll(async () => {
    await donDep();
    await prisma.organization.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  /** Tệp hàng thử lại của "tiến trình" (null = chỉ RAM). Giữ qua tatServer/batServer = cùng volume sau khởi động lại. */
  let tepHang: string | null = null;

  /** Dựng server mới (= một tiến trình backend mới: registry + dấu RAM rỗng). */
  async function batServer(): Promise<void> {
    httpServer = createServer();
    io = new IoServer(httpServer);
    registry = new AgentRegistry({ msChoKetQua: 300 });
    hangServer = registerAgentWs(io, registry, {
      layMayInTheoToken: async (t) => (t === TOKEN ? { token: TOKEN } : null),
      ghiNhatKy: () => undefined,
      capNhatJobTre: vi.fn(async () => 1),
      ghiSuCo: (sc: SuCoIn) => ghiSuCoIn(sc, { prisma: prismaChap, cho: async () => undefined, orgMacDinh: () => ORG }),
      docTrangThaiMay: (t) => docTrangThaiMayDaLuu(t, { prisma: prismaChap, orgMacDinh: () => ORG }),
      layJobTheoId: async () => null,
      coLenhInMoiHon: async () => false,
      dichVuHangDoi: dichVuHangDoiRong(),
      msChoThongTin: 50,
      // hàng thử lại sự cố: nhịp ngắn cho test (thật: 30 s)
      msThuLaiSuCo: 50,
      tepThuLaiSuCo: tepHang,
    });
    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    const addr = httpServer.address();
    if (addr && typeof addr === 'object') port = addr.port;
  }

  let hangTam: { dung: () => void } | null = null;
  let hangServer: { dung: () => void } | undefined;
  async function tatServer(): Promise<void> {
    hangTam?.dung();
    hangTam = null;
    hangServer?.dung(); // tiến trình "chết": hàng thử lại của nó không chạy tiếp
    hangServer = undefined;
    for (const c of clients) c.disconnect();
    clients.length = 0;
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }

  beforeEach(async () => {
    hong = false;
    process.env.AI_MAY_IN_AGENT_TOKEN = 'token-env-khac';
    await donDep();
    await prisma.printAgent.create({ data: { orgId: ORG, ten: 'Máy HN', token: TOKEN, warehouseIds: [2] } });
    await batServer();
  });
  afterEach(async () => {
    hong = false;
    await tatServer();
    if (tepHang) rmSync(join(tepHang, '..'), { recursive: true, force: true });
    tepHang = null;
    delete process.env.AI_MAY_IN_AGENT_TOKEN;
  });

  async function noi(): Promise<ClientSocket> {
    const c = ioClient(`http://localhost:${port}/print-agent`, { auth: { token: TOKEN }, reconnection: false, transports: ['websocket'] });
    clients.push(c);
    await new Promise<void>((resolve, reject) => {
      c.on('connect', () => resolve());
      c.on('connect_error', reject);
    });
    return c;
  }

  it('máy RẢNH báo hết giấy lúc DB chập HAI nhịp ⇒ chưa có dòng; DB lên ⇒ nhịp kế ghi đúng MỘT dòng; về bình thường ⇒ hồi phục', async () => {
    const c = await noi();
    hong = true;
    c.emit('trang-thai-may-in', { trangThai: 'het_giay', mayIn: 'HP' });
    await cho(120);
    c.emit('trang-thai-may-in', { trangThai: 'het_giay', mayIn: 'HP' });
    await cho(120);
    expect(registry.layTinhTrang(TOKEN)?.ma).toBe('het_giay'); // registry đổi TRƯỚC — đúng, không phải nguồn bền
    hong = false;
    expect(await suCoDb()).toEqual([]);
    c.emit('trang-thai-may-in', { trangThai: 'het_giay', mayIn: 'HP' });
    await choToi(async () => (await suCoDb()).length > 0);
    expect(await suCoDb()).toEqual([['het_giay', 'het_giay']]);
    // Nhịp trùng sau khi đã lưu ⇒ không thêm dòng.
    c.emit('trang-thai-may-in', { trangThai: 'het_giay', mayIn: 'HP' });
    await cho(150);
    expect(await suCoDb()).toEqual([['het_giay', 'het_giay']]);
    c.emit('trang-thai-may-in', { trangThai: 'binh_thuong', mayIn: 'HP' });
    await choToi(async () => (await suCoDb()).length > 1);
    expect(await suCoDb()).toEqual([['het_giay', 'het_giay'], ['het_su_co', 'het_giay']]);
  });

  it('hồi phục lúc DB chập ⇒ nhịp "bình thường" sau ghi bù dòng hồi phục (registry đã về bình thường từ trước)', async () => {
    const c = await noi();
    c.emit('trang-thai-may-in', { trangThai: 'ket_giay', mayIn: 'HP' });
    await choToi(async () => (await suCoDb()).length > 0);
    hong = true;
    c.emit('trang-thai-may-in', { trangThai: 'binh_thuong', mayIn: 'HP' });
    await cho(150);
    hong = false;
    expect(await suCoDb()).toEqual([['ket_giay', 'ket_giay']]);
    c.emit('trang-thai-may-in', { trangThai: 'binh_thuong', mayIn: 'HP' });
    await choToi(async () => (await suCoDb()).length > 1);
    expect(await suCoDb()).toEqual([['ket_giay', 'ket_giay'], ['het_su_co', 'ket_giay']]);
  });

  it('khởi động lại backend giữa sự cố: trạng thái đã lưu = dòng cuối trong DB ⇒ "bình thường" đầu tiên ghi hồi phục; sự cố cũ không ghi lại', async () => {
    const c = await noi();
    c.emit('trang-thai-may-in', { trangThai: 'mo_nap', mayIn: 'HP' });
    await choToi(async () => (await suCoDb()).length > 0);
    await tatServer();
    await batServer(); // tiến trình mới: registry rỗng, dấu RAM rỗng
    const c2 = await noi();
    c2.emit('trang-thai-may-in', { trangThai: 'mo_nap', mayIn: 'HP' }); // vẫn mở nắp — đã lưu ⇒ không thêm
    await cho(150);
    expect(await suCoDb()).toEqual([['mo_nap', 'mo_nap']]);
    c2.emit('trang-thai-may-in', { trangThai: 'binh_thuong', mayIn: 'HP' });
    await choToi(async () => (await suCoDb()).length > 1);
    expect(await suCoDb()).toEqual([['mo_nap', 'mo_nap'], ['het_su_co', 'mo_nap']]);
    // Tiến trình mới mà máy đã bình thường từ trước ⇒ nhịp bình thường không ghi gì.
    await tatServer();
    await batServer();
    const c3 = await noi();
    c3.emit('trang-thai-may-in', { trangThai: 'binh_thuong', mayIn: 'HP' });
    await cho(150);
    expect(await suCoDb()).toHaveLength(2);
  });

  it('su-co hết giấy (không jobId) → in được (hồi phục) → hết giấy lại trong 10 phút ⇒ HAI sự cố (dấu RAM xoá khi hồi phục)', async () => {
    const c = await noi();
    c.on('job', (msg: { job: { id: string } }) => c.emit('ket-qua', { jobId: msg.job.id, trangThai: 'da_in' }));
    c.emit('su-co', { loai: 'het_giay', mayIn: 'HP' });
    await choToi(async () => (await suCoDb()).length > 0);
    registry.ghiNguCanh('jOk', { printJobId: 'pjOk', orgId: ORG, soHoaDon: 'INV/7', tenKhach: null, token: TOKEN });
    await registry.guiJob(TOKEN, { id: 'jOk', name: 'n', pdfBase64: 'A', paperSize: 'A5', tray: 'tray-2', copies: 1 });
    await choToi(async () => (await suCoDb()).length > 1);
    c.emit('su-co', { loai: 'het_giay', mayIn: 'HP' });
    await choToi(async () => (await suCoDb()).length > 2);
    expect(await suCoDb()).toEqual([['het_giay', 'het_giay'], ['het_su_co', 'het_giay'], ['het_giay', 'het_giay']]);
    expect(registry.layTinhTrang(TOKEN)?.ma).toBe('het_giay');
  });

  it('su-co lúc DB chập ⇒ vào hàng thử lại; DB lên ⇒ ghi bù (không mất); gửi lặp sau đó không nhân đôi', async () => {
    const c = await noi();
    hong = true;
    c.emit('su-co', { loai: 'ket_giay', mayIn: 'HP' });
    await cho(150);
    expect(await suCoDb()).toEqual([]);
    hong = false;
    await choToi(async () => (await suCoDb()).length > 0);
    expect(await suCoDb()).toEqual([['ket_giay', 'ket_giay']]);
    c.emit('su-co', { loai: 'ket_giay', mayIn: 'HP' });
    await cho(150);
    expect(await suCoDb()).toEqual([['ket_giay', 'ket_giay']]);
  });

  it('cầu dao ngắt vì hết giấy (tam_giu) + máy báo kẹt giấy ⇒ HAI nhóm; in được ⇒ hồi phục MỖI nhóm một dòng', async () => {
    const c = await noi();
    c.on('job', (msg: { job: { id: string } }) => c.emit('ket-qua', { jobId: msg.job.id, trangThai: 'da_in' }));
    registry.ghiNguCanh('jL1', { printJobId: 'pjL1', orgId: ORG, soHoaDon: 'INV/L1', tenKhach: null, token: TOKEN });
    c.emit('ket-qua', { jobId: 'jL1', trangThai: 'loi', loai: 'het_giay' }); // kết quả trễ do máy in ⇒ ngắt cầu dao
    await choToi(async () => (await suCoDb()).length > 0);
    c.emit('trang-thai-may-in', { trangThai: 'ket_giay', mayIn: 'HP' });
    await choToi(async () => (await suCoDb()).length > 1);
    expect(await suCoDb()).toEqual([['tam_giu', 'het_giay'], ['ket_giay', 'ket_giay']]);
    registry.ghiNguCanh('jOk', { printJobId: 'pjOk', orgId: ORG, soHoaDon: 'INV/8', tenKhach: null, token: TOKEN });
    await registry.guiJob(TOKEN, { id: 'jOk', name: 'n', pdfBase64: 'A', paperSize: 'A5', tray: 'tray-2', copies: 1 });
    await choToi(async () => (await suCoDb()).length > 3);
    const r = await suCoDb();
    expect(r.slice(0, 2)).toEqual([['tam_giu', 'het_giay'], ['ket_giay', 'ket_giay']]);
    expect(r.slice(2).sort()).toEqual([['het_su_co', 'ket_giay'], ['tiep_tuc_in', 'het_giay']]);
    // Nhịp "bình thường" sau đó: đã lưu hồi phục ⇒ không thêm.
    c.emit('trang-thai-may-in', { trangThai: 'binh_thuong', mayIn: 'HP' });
    await cho(150);
    expect(await suCoDb()).toHaveLength(4);
  });

  it('ghiSuCoIn: tam_giu het_giay rồi tam_giu ket_giay ⇒ HAI dòng (khác nhóm); hồi phục nhóm A KHÔNG đóng nhóm B; hai hồi phục hai nhóm ⇒ hai dòng', async () => {
    const d = { prisma: prismaChap, orgMacDinh: () => ORG };
    expect(await ghiSuCoIn({ maSuCo: 'tam_giu', maGoc: 'het_giay', agentToken: TOKEN }, d)).toBe('da_luu');
    expect(await ghiSuCoIn({ maSuCo: 'tam_giu', maGoc: 'ket_giay', agentToken: TOKEN }, d)).toBe('da_luu');
    expect(await ghiSuCoIn({ maSuCo: 'tam_giu', maGoc: 'ket_giay', agentToken: TOKEN }, d)).toBe('trung');
    expect(await ghiSuCoIn({ maSuCo: 'het_su_co', maGoc: 'het_giay', agentToken: TOKEN }, d)).toBe('da_luu');
    // Nhóm B (ket_giay) vẫn mở ⇒ tam_giu ket_giay lặp vẫn gộp.
    expect(await ghiSuCoIn({ maSuCo: 'tam_giu', maGoc: 'ket_giay', agentToken: TOKEN }, d)).toBe('trung');
    // Hồi phục nhóm B là dòng RIÊNG (bản cũ: "dòng mới nhất của máy đã là hồi phục" ⇒ gộp mất).
    expect(await ghiSuCoIn({ maSuCo: 'het_su_co', maGoc: 'ket_giay', agentToken: TOKEN }, d)).toBe('da_luu');
    expect(await ghiSuCoIn({ maSuCo: 'het_su_co', maGoc: 'ket_giay', agentToken: TOKEN }, d)).toBe('trung');
    // Nhóm A đã đóng ⇒ hết giấy lại là sự cố mới.
    expect(await ghiSuCoIn({ maSuCo: 'tam_giu', maGoc: 'het_giay', agentToken: TOKEN }, d)).toBe('da_luu');
    expect(await suCoDb()).toEqual([
      ['tam_giu', 'het_giay'], ['tam_giu', 'ket_giay'], ['het_su_co', 'het_giay'], ['het_su_co', 'ket_giay'], ['tam_giu', 'het_giay'],
    ]);
  });

  // ── Codex v2 #2: thứ tự ổn định (luc, thu_tu) + FIFO ─────────────────────────
  const d = () => ({ prisma: prismaChap, cho: async () => undefined, orgMacDinh: () => ORG });
  /** Nhóm đã ĐÓNG? = dòng cuối của nhóm theo (luc, thu_tu) là hồi phục. */
  async function nhomDong(nhom: string): Promise<boolean> {
    const r = (await prisma.$queryRaw`SELECT ma_su_co FROM print_su_co WHERE org_id = ${ORG} AND nhom_su_co = ${nhom}
      ORDER BY luc DESC, thu_tu DESC, id DESC LIMIT 1`) as Array<{ ma_su_co: string }>;
    return r.length > 0 && ['het_su_co', 'tiep_tuc_in'].includes(r[0].ma_su_co);
  }

  it('DB chập lúc het_giay + tam_giu, sống lại lúc tiep_tuc_in (hàng thử lại + DB thật) ⇒ ĐÚNG thứ tự, nhóm ĐÓNG; hết giấy lại trong 10 phút ⇒ sự cố MỚI', async () => {
    const h = taoHangThuLaiSuCo({ ghi: (sc) => ghiSuCoIn(sc, d()), msNhip: 60_000 });
    hangTam = h;
    hong = true;
    expect(await h.ghi({ maSuCo: 'het_giay', agentToken: TOKEN })).toBe('loi_db');
    expect(await h.ghi({ maSuCo: 'tam_giu', maGoc: 'het_giay', agentToken: TOKEN })).toBe('loi_db');
    hong = false;
    expect(await h.ghi({ maSuCo: 'tiep_tuc_in', maGoc: 'het_giay', agentToken: TOKEN })).toBe('da_luu');
    expect(await suCoDb()).toEqual([['het_giay', 'het_giay'], ['tam_giu', 'het_giay'], ['tiep_tuc_in', 'het_giay']]);
    expect(await nhomDong('het_giay')).toBe(true);
    expect(await h.ghi({ maSuCo: 'het_giay', agentToken: TOKEN })).toBe('da_luu'); // tái phát sau hồi phục = sự cố mới
    expect(await nhomDong('het_giay')).toBe(false);
    expect(await suCoDb()).toHaveLength(4);
  });

  it('dòng ghi TRỄ mang giờ cũ (id lớn hơn hồi phục) ⇒ truy vấn mở/đóng theo (luc, thu_tu) — không theo id: nhóm vẫn đóng, sự cố sau là MỚI', async () => {
    const t = Date.now();
    expect(await ghiSuCoIn({ maSuCo: 'tiep_tuc_in', maGoc: 'het_giay', agentToken: TOKEN, luc: new Date(t - 60_000), thuTu: (t - 60_000) * 1000 }, d())).toBe('da_luu');
    // het_giay xảy ra TRƯỚC hồi phục nhưng tới DB sau (id lớn hơn)
    expect(await ghiSuCoIn({ maSuCo: 'het_giay', agentToken: TOKEN, luc: new Date(t - 120_000), thuTu: (t - 120_000) * 1000 }, d())).toBe('da_luu');
    expect(await nhomDong('het_giay')).toBe(true);
    // bản cũ (so id): het_giay trễ "chưa có hồi phục sau nó" ⇒ gộp mất lần hết giấy thật này
    expect(await ghiSuCoIn({ maSuCo: 'het_giay', agentToken: TOKEN }, d())).toBe('da_luu');
    expect(await ghiSuCoIn({ maSuCo: 'het_giay', agentToken: TOKEN }, d())).toBe('trung');
    // trạng thái máy đã lưu đọc theo (luc, thu_tu)
    expect(await docTrangThaiMayDaLuu(TOKEN, d())).toBe('het_giay');
  });

  it('ghi bù cùng ma_ghi (đã commit, chưa kịp xoá khỏi tệp) ⇒ trung, đúng MỘT dòng; thu_tu + ma_ghi lưu đúng', async () => {
    const sc: SuCoIn = { maSuCo: 'ket_giay', agentToken: TOKEN, maGhi: '7d5c1a7e-0000-4000-8000-000000000001', luc: new Date(), thuTu: 1_900_000_000_000_000 };
    expect(await ghiSuCoIn(sc, d())).toBe('da_luu');
    // hồi phục chen giữa ⇒ lần sau KHÔNG gộp theo cửa sổ — chỉ ma_ghi giữ nó lại
    expect(await ghiSuCoIn({ maSuCo: 'het_su_co', maGoc: 'ket_giay', agentToken: TOKEN }, d())).toBe('da_luu');
    expect(await ghiSuCoIn(sc, d())).toBe('trung');
    const r = await prisma.printSuCo.findMany({ where: { orgId: ORG, maSuCo: 'ket_giay' } });
    expect(r).toHaveLength(1);
    expect(r[0].maGhi).toBe(sc.maGhi);
    expect(r[0].thuTu).toBe(1_900_000_000_000_000n);
  });

  it('Codex v2 #3 — khởi động lại TRƯỚC commit: su-co nhận lúc DB chập, tiến trình chết ⇒ tiến trình mới (cùng tệp) ghi bù đúng giờ nhận', async () => {
    tepHang = join(mkdtempSync(join(tmpdir(), 'psc-hang-')), 'cho.json');
    await tatServer();
    await batServer();
    const c = await noi();
    hong = true;
    const truoc = Date.now();
    c.emit('su-co', { loai: 'ket_giay', mayIn: 'HP' });
    await cho(150);
    expect(await suCoDb()).toEqual([]);
    await tatServer(); // chết khi CHƯA commit (DB vẫn chập)
    hong = false;
    await batServer(); // tiến trình mới, cùng volume
    await choToi(async () => (await suCoDb()).length > 0);
    const r = await prisma.printSuCo.findMany({ where: { orgId: ORG } });
    expect(r.map((x) => x.maSuCo)).toEqual(['ket_giay']);
    expect(r[0].luc.getTime()).toBeGreaterThanOrEqual(truoc - 5);
    expect(r[0].luc.getTime()).toBeLessThan(truoc + 150);
  });
});
