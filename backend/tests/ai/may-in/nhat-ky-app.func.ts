// SPDX-License-Identifier: AGPL-3.0-or-later
// Nhật ký APP máy in — nhận lô (lưu, không lộ token, gửi lại không trùng, ack đúng
// QUA_TAI / CHUA_MIGRATE / …, không bao giờ ném), đọc hai chiều con trỏ, tải về .txt,
// dọn 30 ngày, route admin; và event `nhat-ky-app` qua socket.io THẬT (ack).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  taoNhanNhatKyApp,
  taoGioiHanNhatKyApp,
  timNhatKyApp,
  sinhNoiDungTaiVe,
  donNhatKyAppCu,
  phanTichThamSoApp,
  SU_KIEN_BO_DONG,
  type PrismaNhatKyApp,
} from '../../../src/modules/ai/may-in/nhat-ky-app.js';
import { registerAgentWs, HO_TRO_APP } from '../../../src/modules/ai/may-in/agent-ws.js';
import { AgentRegistry } from '../../../src/modules/ai/may-in/agent-registry.js';
import { traNhatKyApp, traTaiVeNhatKyApp } from '../../../src/modules/ai/may-in/print-agent-routes.js';
import { logger } from '../../../src/shared/utils/logger.js';
import { dichVuHangDoiRong } from './prisma-gia-hang-doi.js';

const TOKEN = 'tokBiMatRatDaiKhongDuocLo_8f3k';
const BAY_GIO = Date.parse('2026-09-25T10:20:00.000Z');
const P2021 = () => Object.assign(new Error('The table `public.print_app_logs` does not exist'), { code: 'P2021' });

type Hang = Record<string, unknown>;

/** Prisma giả: createMany tôn trọng UNIQUE(khoa) + skipDuplicates như Postgres. */
function prismaGia(opts: { createNem?: () => Error } = {}) {
  const hang: Hang[] = [];
  let dem = 0;
  const p: PrismaNhatKyApp = {
    printAppLog: {
      createMany: vi.fn(async ({ data, skipDuplicates }) => {
        if (opts.createNem) throw opts.createNem();
        let count = 0;
        for (const d of data) {
          if (hang.some((h) => h.khoa === d.khoa)) {
            if (skipDuplicates) continue;
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          }
          hang.push({ id: `c${String(++dem).padStart(4, '0')}`, nhanLuc: new Date(BAY_GIO), ...d });
          count++;
        }
        return { count };
      }),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 4 })),
    },
    printAgent: {
      findUnique: vi.fn(async ({ where }) => (where.token === TOKEN ? { id: 'mayHN', orgId: 'org1', ten: 'Máy HN' } : null)),
      findFirst: vi.fn(async () => null),
    },
  };
  return { p, hang };
}

const dong = (i: number, them: Record<string, unknown> = {}) => ({
  luc: new Date(BAY_GIO - 60_000 + i).toISOString(), suKien: 'vet_in', noiDung: `job=${i} t=1ms`, ...them,
});
const lo = (n: number, them: Record<string, unknown> = {}) => ({ dong: Array.from({ length: n }, (_, i) => dong(i)), boQua: 0, phienBan: '0.2.4', ...them });

describe('taoNhanNhatKyApp — lưu một lô', () => {
  it('lưu đủ cột, tra máy theo token, KHÔNG lưu token ở bất kỳ cột nào; ack soDong', async () => {
    const { p, hang } = prismaGia();
    const nhan = taoNhanNhatKyApp({ prisma: p, bayGio: () => BAY_GIO });
    const ack = await nhan(TOKEN, {
      dong: [dong(1, { suKien: 'usb_doc', noiDung: `Mở C:\\Temp\\${TOKEN}-1727.pdf — Lộc Beco` })],
      boQua: 0,
      phienBan: '0.2.4',
    });
    expect(ack).toEqual({ ok: true, soDong: 1 });
    expect(hang).toHaveLength(1);
    expect(hang[0]).toMatchObject({
      orgId: 'org1', mayInId: 'mayHN', mayInTen: 'Máy HN', suKien: 'usb_doc', phienBan: '0.2.4',
      noiDung: 'Mở C:\\Temp\\…-1727.pdf — Lộc Beco',
    });
    expect(hang[0].luc).toEqual(new Date(BAY_GIO - 60_000 + 1));
    expect(String(hang[0].tuKhoa)).toContain('usb doc');
    expect(String(hang[0].tuKhoa)).toContain('loc beco');
    expect(String(hang[0].khoa)).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.stringify(hang)).not.toContain(TOKEN);
    expect(p.printAppLog.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it('gửi lại NGUYÊN lô (mất ack) → không trùng dòng, vẫn ok', async () => {
    const { p, hang } = prismaGia();
    const nhan = taoNhanNhatKyApp({ prisma: p, bayGio: () => BAY_GIO });
    expect(await nhan(TOKEN, lo(3))).toEqual({ ok: true, soDong: 3 });
    expect(await nhan(TOKEN, lo(3))).toEqual({ ok: true, soDong: 0 });
    expect(hang).toHaveLength(3);
    // Lô sau chồng mép lô trước (app gửi lại một phần) → chỉ dòng mới được thêm.
    expect(await nhan(TOKEN, { dong: [dong(2), dong(3), dong(4)] })).toEqual({ ok: true, soDong: 2 });
    expect(hang).toHaveLength(5);
  });

  it('boQua > 0 → thêm một dòng app_bo_dong (không đếm vào soDong); gửi lại không nhân đôi', async () => {
    const { p, hang } = prismaGia();
    const nhan = taoNhanNhatKyApp({ prisma: p, bayGio: () => BAY_GIO });
    expect(await nhan(TOKEN, lo(2, { boQua: 37 }))).toEqual({ ok: true, soDong: 2 });
    await nhan(TOKEN, lo(2, { boQua: 37 }));
    const bo = hang.filter((h) => h.suKien === SU_KIEN_BO_DONG);
    expect(bo).toHaveLength(1);
    expect(bo[0]).toMatchObject({ noiDung: 'App bỏ 37 dòng nhật ký (bộ đệm đầy)', mayInId: 'mayHN' });
    expect(hang).toHaveLength(3);
  });

  it('dòng sai bị bỏ riêng, phần còn lại vẫn lưu; lô không còn gì → ok soDong 0, không chạm DB', async () => {
    const { p, hang } = prismaGia();
    const nhan = taoNhanNhatKyApp({ prisma: p, bayGio: () => BAY_GIO });
    expect(await nhan(TOKEN, { dong: [dong(1), { luc: 'x', suKien: 'a' }, 42] })).toEqual({ ok: true, soDong: 1 });
    expect(hang).toHaveLength(1);
    (p.printAppLog.createMany as ReturnType<typeof vi.fn>).mockClear();
    expect(await nhan(TOKEN, { dong: [{ luc: 'x', suKien: 'a' }] })).toEqual({ ok: true, soDong: 0 });
    expect(p.printAppLog.createMany).not.toHaveBeenCalled();
  });

  it('payload sai dạng → ok:false SAI_DU_LIEU', async () => {
    const { p } = prismaGia();
    const nhan = taoNhanNhatKyApp({ prisma: p, bayGio: () => BAY_GIO });
    expect(await nhan(TOKEN, null)).toEqual({ ok: false, loi: 'SAI_DU_LIEU' });
    expect(await nhan(TOKEN, { lines: [] })).toEqual({ ok: false, loi: 'SAI_DU_LIEU' });
  });

  it('token không có trong print_agents → org mặc định (env), tên "Máy mặc định (env)"; không có org → KHONG_RO_ORG', async () => {
    const { p, hang } = prismaGia();
    const coOrg = taoNhanNhatKyApp({ prisma: p, bayGio: () => BAY_GIO, orgMacDinh: () => 'orgEnv' });
    expect(await coOrg('tokEnvHN_khac_12345', lo(1))).toEqual({ ok: true, soDong: 1 });
    expect(hang[0]).toMatchObject({ orgId: 'orgEnv', mayInId: null, mayInTen: 'Máy mặc định (env)' });
    const khongOrg = taoNhanNhatKyApp({ prisma: p, bayGio: () => BAY_GIO, orgMacDinh: () => null });
    expect(await khongOrg('tokEnvHN_khac_12345', lo(1))).toEqual({ ok: false, loi: 'KHONG_RO_ORG' });
  });

  it('cache máy in 60 giây: hai lô cùng token chỉ một lượt tra', async () => {
    const { p } = prismaGia();
    const nhan = taoNhanNhatKyApp({ prisma: p, bayGio: () => BAY_GIO });
    await nhan(TOKEN, lo(1));
    await nhan(TOKEN, { dong: [dong(9)] });
    expect(p.printAgent.findUnique).toHaveBeenCalledTimes(1);
  });

  it('quá tải (giới hạn của socket) → QUA_TAI, không chạm DB', async () => {
    const { p } = prismaGia();
    const nhan = taoNhanNhatKyApp({ prisma: p, bayGio: () => BAY_GIO });
    const gioiHan = taoGioiHanNhatKyApp({ bayGio: () => BAY_GIO });
    for (let i = 0; i < 10; i++) {
      expect(await nhan(TOKEN, { dong: Array.from({ length: 500 }, (_, j) => dong(i * 500 + j)) }, gioiHan)).toMatchObject({ ok: true });
    }
    (p.printAppLog.createMany as ReturnType<typeof vi.fn>).mockClear();
    expect(await nhan(TOKEN, lo(1), gioiHan)).toEqual({ ok: false, loi: 'QUA_TAI' });
    expect(p.printAppLog.createMany).not.toHaveBeenCalled();
  });

  it('bảng chưa migrate (P2021) → CHUA_MIGRATE, cảnh báo MỘT lần, không ném', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    try {
      const { p } = prismaGia({ createNem: P2021 });
      const nhan = taoNhanNhatKyApp({ prisma: p, bayGio: () => BAY_GIO });
      expect(await nhan(TOKEN, lo(1))).toEqual({ ok: false, loi: 'CHUA_MIGRATE' });
      expect(await nhan(TOKEN, lo(1))).toEqual({ ok: false, loi: 'CHUA_MIGRATE' });
      const canhBao = warn.mock.calls.filter((c) => String(c[c.length - 1]).includes('print_app_logs'));
      expect(canhBao).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('lỗi DB khác → LOI_LUU, không ném', async () => {
    const { p } = prismaGia({ createNem: () => new Error('connection reset') });
    const nhan = taoNhanNhatKyApp({ prisma: p, bayGio: () => BAY_GIO });
    await expect(nhan(TOKEN, lo(1))).resolves.toEqual({ ok: false, loi: 'LOI_LUU' });
  });
});

describe('timNhatKyApp — hai chiều con trỏ', () => {
  const rows = [
    { id: 'c3', luc: new Date('2026-09-25T10:00:03.000Z'), mayInId: 'm1', mayInTen: 'Máy HN', suKien: 'vet_in', noiDung: 'c', phienBan: '0.2.4', khoa: 'k', tuKhoa: 't' },
    { id: 'c2', luc: new Date('2026-09-25T10:00:02.000Z'), mayInId: 'm1', mayInTen: 'Máy HN', suKien: 'vet_in', noiDung: 'b', phienBan: null },
    { id: 'c1', luc: new Date('2026-09-25T10:00:01.000Z'), mayInId: null, mayInTen: null, suKien: 'su_co', noiDung: 'a', phienBan: null },
  ];

  it('mặc định mới nhất trước; dư 1 dòng → tiepTheo = "<ISO>|<id>" của dòng cuối; chỉ chọn cột cần', async () => {
    const { p } = prismaGia();
    (p.printAppLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
    const kq = await timNhatKyApp('org1', { ...phanTichThamSoApp({}), gioiHan: 2 }, { prisma: p });
    expect(kq.items.map((i) => i.id)).toEqual(['c3', 'c2']);
    expect(kq.items[0]).toEqual({
      id: 'c3', luc: '2026-09-25T10:00:03.000Z', mayInId: 'm1', mayInTen: 'Máy HN', suKien: 'vet_in', noiDung: 'c', phienBan: '0.2.4',
    });
    expect(kq.tiepTheo).toBe('2026-09-25T10:00:02.000Z|c2');
    const goi = (p.printAppLog.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(goi).toMatchObject({ take: 3, orderBy: [{ luc: 'desc' }, { id: 'desc' }] });
    expect(goi.select).not.toHaveProperty('khoa');
    expect(goi.select).not.toHaveProperty('tuKhoa');
  });

  it('có `sau` → CŨ nhất trước (asc) trong số dòng mới hơn; hết thì tiepTheo null', async () => {
    const { p } = prismaGia();
    (p.printAppLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([...rows].reverse());
    const t = phanTichThamSoApp({ sau: '2026-09-25T10:00:00.000Z|c0' });
    const kq = await timNhatKyApp('org1', t, { prisma: p });
    expect(kq.items.map((i) => i.id)).toEqual(['c1', 'c2', 'c3']);
    expect(kq.tiepTheo).toBeNull();
    expect((p.printAppLog.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].orderBy).toEqual([{ luc: 'asc' }, { id: 'asc' }]);
  });
});

describe('sinhNoiDungTaiVe — .txt cũ nhất trước, từng khúc, trần dòng', () => {
  /** findMany giả trên N dòng tăng dần, tôn trọng con trỏ `sau` + take. */
  function prismaNhieuDong(n: number) {
    const { p } = prismaGia();
    const tatCa = Array.from({ length: n }, (_, i) => ({
      id: `c${String(i).padStart(6, '0')}`, luc: new Date(BAY_GIO + i * 1000), mayInId: 'm1', mayInTen: 'Máy HN',
      suKien: 'vet_in', noiDung: `dòng ${i}`, phienBan: null,
    }));
    (p.printAppLog.findMany as ReturnType<typeof vi.fn>).mockImplementation(async (a: { where: { AND: Hang[] }; take: number }) => {
      const conTro = a.where.AND.find((x) => 'OR' in x) as { OR: [{ luc: { gt: Date } }] } | undefined;
      const tu = conTro ? conTro.OR[0].luc.gt.getTime() : -Infinity;
      return tatCa.filter((r) => r.luc.getTime() > tu).slice(0, a.take);
    });
    return p;
  }
  async function doc(g: AsyncGenerator<string>): Promise<string> {
    let s = '';
    for await (const k of g) s += k;
    return s;
  }

  it('đủ mọi dòng qua nhiều khúc, cũ nhất trước, không dòng cắt', async () => {
    const p = prismaNhieuDong(7);
    const txt = await doc(sinhNoiDungTaiVe('org1', phanTichThamSoApp({}), { prisma: p, loMoiLan: 3 }));
    const dongs = txt.trimEnd().split('\n');
    expect(dongs).toHaveLength(7);
    expect(dongs[0]).toBe(`${new Date(BAY_GIO).toISOString()}\t25/09 17:20:00\tMáy HN\tvet_in\tdòng 0`);
    expect(dongs[6]).toContain('dòng 6');
    expect(txt).not.toContain('ĐÃ CẮT');
    expect(p.printAppLog.findMany).toHaveBeenCalledTimes(3);
  });

  it('quá trần → dừng ở trần + một dòng cuối báo đã cắt; đúng trần thì không báo', async () => {
    const txt = await doc(sinhNoiDungTaiVe('org1', phanTichThamSoApp({}), { prisma: prismaNhieuDong(10), tran: 4, loMoiLan: 3 }));
    const dongs = txt.trimEnd().split('\n');
    expect(dongs).toHaveLength(5);
    expect(dongs[3]).toContain('dòng 3');
    expect(dongs[4]).toMatch(/^# ĐÃ CẮT: chỉ xuất 4 dòng/);
    const vuaDu = await doc(sinhNoiDungTaiVe('org1', phanTichThamSoApp({}), { prisma: prismaNhieuDong(4), tran: 4, loMoiLan: 3 }));
    expect(vuaDu).not.toContain('ĐÃ CẮT');
  });

  it('không có dòng nào → một dòng chú thích', async () => {
    const txt = await doc(sinhNoiDungTaiVe('org1', phanTichThamSoApp({}), { prisma: prismaNhieuDong(0) }));
    expect(txt).toBe('# Không có dòng nhật ký nào khớp bộ lọc.\n');
  });
});

describe('donNhatKyAppCu — giữ 30 ngày', () => {
  it('xoá dòng máy chủ NHẬN trước mốc 30 ngày; lỗi thì trả 0, không ném', async () => {
    const { p } = prismaGia();
    const bayGio = new Date('2026-12-31T00:00:00.000Z');
    expect(await donNhatKyAppCu(30, { prisma: p, bayGio })).toBe(4);
    expect(p.printAppLog.deleteMany).toHaveBeenCalledWith({ where: { nhanLuc: { lt: new Date('2026-12-01T00:00:00.000Z') } } });
    (p.printAppLog.deleteMany as ReturnType<typeof vi.fn>).mockRejectedValueOnce(P2021());
    expect(await donNhatKyAppCu(30, { prisma: p, bayGio })).toBe(0);
  });
});

describe('route GET /nhat-ky-app + /nhat-ky-app/tai-ve', () => {
  it('member → 403 CHI_ADMIN; tham số sai → 400 THAM_SO_SAI; org LUÔN từ phiên', async () => {
    const tim = vi.fn(async () => ({ items: [], tiepTheo: null }));
    expect(await traNhatKyApp({ orgId: 'o1', role: 'member' }, {}, { tim })).toEqual({ code: 403, body: { error: 'CHI_ADMIN' } });
    expect((await traNhatKyApp({ orgId: 'o1', role: 'admin' }, { tu: 'xyz' }, { tim })).code).toBe(400);
    const kq = await traNhatKyApp({ orgId: 'o1', role: 'owner' }, { orgId: 'oKhac', suKien: 'vet_in,su_co', sau: '2026-09-25T10:00:00.000Z|c1' }, { tim });
    expect(kq.code).toBe(200);
    expect(tim).toHaveBeenCalledWith('o1', expect.objectContaining({ suKien: ['vet_in', 'su_co'], sau: { luc: new Date('2026-09-25T10:00:00.000Z'), id: 'c1' } }));
  });

  it('bảng chưa migrate (P2021) → 503 CHUA_MIGRATE; lỗi khác vẫn ném', async () => {
    const thieu = vi.fn(async () => { throw P2021(); });
    expect(await traNhatKyApp({ orgId: 'o1', role: 'admin' }, {}, { tim: thieu })).toMatchObject({ code: 503, body: { error: 'CHUA_MIGRATE' } });
    await expect(traNhatKyApp({ orgId: 'o1', role: 'admin' }, {}, { tim: vi.fn(async () => { throw new Error('boom'); }) })).rejects.toThrow('boom');
  });

  it('tải về: 403 / 400 / 503 thành mã HTTP; thành công → tên file theo máy + nội dung, bỏ con trỏ', async () => {
    const admin = { orgId: 'o1', role: 'admin' };
    expect((await traTaiVeNhatKyApp({ orgId: 'o1', role: 'member' }, {})).code).toBe(403);
    expect((await traTaiVeNhatKyApp(admin, { den: 'xyz' })).code).toBe(400);
    const thieu = vi.fn(async function* () { throw P2021(); });
    expect(await traTaiVeNhatKyApp(admin, {}, { sinh: thieu as never })).toMatchObject({ code: 503, body: { error: 'CHUA_MIGRATE' } });

    const sinh = vi.fn(async function* () { yield 'a\n'; yield 'b\n'; });
    const kq = await traTaiVeNhatKyApp(admin, { mayInId: 'm1', truoc: '2026-09-25T10:00:00.000Z|c1' }, {
      sinh: sinh as never,
      layTenMay: async () => 'Máy Hồ Chí Minh',
      bayGio: () => new Date('2026-09-25T10:16:00.000Z'),
    });
    expect(kq.code).toBe(200);
    if (!('noiDung' in kq)) throw new Error('phải có nội dung');
    expect(kq.tenFile).toBe('nhat-ky-may-in-may-ho-chi-minh-20260925-1716.txt');
    let txt = '';
    for await (const k of kq.noiDung) txt += k;
    expect(txt).toBe('a\nb\n');
    expect(sinh).toHaveBeenCalledWith('o1', expect.objectContaining({ mayInId: 'm1', truoc: null, sau: null }));
  });
});

describe('agent-ws — event `nhat-ky-app` qua socket.io thật (ack)', () => {
  let httpServer: HttpServer;
  let io: IoServer;
  let port: number;
  let gia: ReturnType<typeof prismaGia>;
  let loiTao: (() => Error) | undefined;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    process.env.AI_MAY_IN_AGENT_TOKEN = 'token-env-khac';
    loiTao = undefined;
    gia = prismaGia();
    const createManyGoc = gia.p.printAppLog.createMany;
    gia.p.printAppLog.createMany = vi.fn(async (a) => {
      if (loiTao) throw loiTao();
      return createManyGoc(a);
    });
    httpServer = createServer();
    io = new IoServer(httpServer);
    registerAgentWs(io, new AgentRegistry({ msChoKetQua: 300 }), {
      layMayInTheoToken: async (t) => (t === TOKEN ? { token: TOKEN } : null),
      ghiNhatKy: () => {},
      layJobTheoId: async () => null,
      coLenhInMoiHon: async () => false,
      nhanNhatKyApp: taoNhanNhatKyApp({ prisma: gia.p }),
      dichVuHangDoi: dichVuHangDoiRong(),
      msChoThongTin: 50,
    });
    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    const addr = httpServer.address();
    if (addr && typeof addr === 'object') port = addr.port;
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    clients.length = 0;
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    delete process.env.AI_MAY_IN_AGENT_TOKEN;
  });

  async function noi(): Promise<{ c: ClientSocket; cauHinh: Promise<{ hoTro: string[] }> }> {
    const c = ioClient(`http://localhost:${port}/print-agent`, { auth: { token: TOKEN }, reconnection: false, transports: ['websocket'] });
    clients.push(c);
    const cauHinh = new Promise<{ hoTro: string[] }>((resolve) => c.on('cau-hinh', resolve));
    await new Promise<void>((resolve, reject) => {
      c.on('connect', () => resolve());
      c.on('connect_error', reject);
    });
    return { c, cauHinh };
  }
  const guiLo = (c: ClientSocket, payload: unknown) =>
    c.timeout(2000).emitWithAck('nhat-ky-app', payload) as Promise<Record<string, unknown>>;
  const dongMoi = (i: number) => ({ luc: new Date(Date.now() - 1000 + i).toISOString(), suKien: 'vet_in', noiDung: `job=${i}` });

  it('HO_TRO_APP có `nhat_ky_app` và được quảng bá qua cau-hinh', async () => {
    expect(HO_TRO_APP).toContain('nhat_ky_app');
    const { cauHinh } = await noi();
    expect((await cauHinh).hoTro).toContain('nhat_ky_app');
  });

  it('ack { ok: true, soDong } SAU khi lưu; gửi lại cùng lô → không trùng', async () => {
    const { c } = await noi();
    const payload = { dong: [dongMoi(1), dongMoi(2)], boQua: 0, phienBan: '0.2.4' };
    expect(await guiLo(c, payload)).toEqual({ ok: true, soDong: 2 });
    expect(gia.hang).toHaveLength(2);
    expect(await guiLo(c, payload)).toEqual({ ok: true, soDong: 0 });
    expect(gia.hang).toHaveLength(2);
    expect(JSON.stringify(gia.hang)).not.toContain(TOKEN);
  });

  it('quá 20 lô trong một phút trên CÙNG socket → QUA_TAI', async () => {
    const { c } = await noi();
    for (let i = 0; i < 20; i++) expect(await guiLo(c, { dong: [dongMoi(i)] })).toMatchObject({ ok: true });
    expect(await guiLo(c, { dong: [dongMoi(99)] })).toEqual({ ok: false, loi: 'QUA_TAI' });
  });

  it('bảng chưa migrate → ack CHUA_MIGRATE (không ném, socket vẫn sống)', async () => {
    loiTao = P2021;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    try {
      const { c } = await noi();
      expect(await guiLo(c, { dong: [dongMoi(1)] })).toEqual({ ok: false, loi: 'CHUA_MIGRATE' });
      loiTao = undefined;
      expect(await guiLo(c, { dong: [dongMoi(1)] })).toEqual({ ok: true, soDong: 1 });
    } finally {
      warn.mockRestore();
    }
  });

  it('payload sai → SAI_DU_LIEU; emit KHÔNG ack (app cũ) vẫn lưu, không làm hỏng socket', async () => {
    const { c } = await noi();
    expect(await guiLo(c, 'rac')).toEqual({ ok: false, loi: 'SAI_DU_LIEU' });
    c.emit('nhat-ky-app', { dong: [dongMoi(5)] });
    await new Promise((r) => setTimeout(r, 80));
    expect(gia.hang).toHaveLength(1);
    expect(c.connected).toBe(true);
  });
});
