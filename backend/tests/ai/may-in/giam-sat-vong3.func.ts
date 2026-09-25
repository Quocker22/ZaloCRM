// SPDX-License-Identifier: AGPL-3.0-or-later
// Khoá các sửa của vòng giám sát 3 (25/09) — mỗi ca đã được giám sát dựng lại
// trên Postgres thật trước khi sửa:
//   V-a  dọn mồ côi không được ghi đè kết quả trễ vừa chốt (cập nhật CÓ ĐIỀU KIỆN)
//   V-b  `loi` trễ không kéo job cũ về cho_in khi hoá đơn đã có lệnh in mới (2 tờ)
//   V-c  kết quả trễ không đổi được job → không hứa "tự gửi lại", không ngắt cầu dao
//   N-a  token không lọt qua `lucApp`
//   N-b  "mồ côi" = đổi trạng thái TRƯỚC khi tiến trình khởi động, không phải "thiếu ngữ cảnh"
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { registerAgentWs, type AgentWsDeps } from '../../../src/modules/ai/may-in/agent-ws.js';
import { AgentRegistry } from '../../../src/modules/ai/may-in/agent-registry.js';
import { donJobMoCoi, MS_JOB_MO_COI, type PrismaHangDoiIn, type JobIn, type SuKienHangDoi } from '../../../src/modules/ai/may-in/hang-doi-in.js';
import type { MucNhatKy } from '../../../src/modules/ai/may-in/nhat-ky.js';

const TOKEN = 'tokHN_bi_mat_khong_duoc_lo_9x7';
// Dạng id THẬT trên prod (Hermes chèn uuid4) — vòng 3 bắt được bản trước chỉ nhận cuid.
const PJ = '3f2b9c4e-8a1d-4e6f-9b7a-0c5d2e1f4a3b';
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('V-a — dọn mồ côi cập nhật CÓ ĐIỀU KIỆN', () => {
  it('kết quả trễ đã chốt job giữa lúc đọc và lúc ghi → không ghi đè, không ghi nhật ký', async () => {
    const bayGio = Date.parse('2026-09-25T03:00:00Z');
    const job = { id: 'b', orgId: 'o', soHoaDon: 'INV/B', trangThai: 'dang_gui', ippJobId: null, updatedAt: new Date(bayGio - MS_JOB_MO_COI - 1) } as unknown as JobIn;
    const updateMany = vi.fn(async () => ({ count: 0 })); // kết quả trễ đã đổi dang_gui → da_in trước đó
    const update = vi.fn();
    const prisma = { printJob: { findMany: vi.fn(async () => [job]), update, updateMany, create: vi.fn() } } as unknown as PrismaHangDoiIn;
    const suKien: SuKienHangDoi[] = [];
    expect(await donJobMoCoi({ prisma, nhatKy: (e) => suKien.push(e) }, bayGio)).toBe(0);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'b', trangThai: 'dang_gui', ippJobId: null }, data: expect.objectContaining({ trangThai: 'khong_ro' }) });
    expect(update).not.toHaveBeenCalled();
    expect(suKien).toHaveLength(0);
  });
});

describe('agent-ws — kết quả trễ (V-b, V-c, N-a, N-b)', () => {
  let httpServer: HttpServer;
  let io: IoServer;
  let port: number;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    process.env.AI_MAY_IN_AGENT_TOKEN = 'token-env-khac';
    httpServer = createServer();
    io = new IoServer(httpServer);
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

  async function dung(them: Partial<AgentWsDeps> = {}) {
    const registry = new AgentRegistry({ msChoKetQua: 300 });
    const nhatKy: MucNhatKy[] = [];
    const capNhatJobTre = vi.fn(async () => 1);
    registerAgentWs(io, registry, {
      layMayInTheoToken: async (t) => (t === TOKEN ? { token: TOKEN } : null),
      ghiNhatKy: (m) => nhatKy.push(m),
      capNhatJobTre,
      layJobTheoId: async () => null,
      coLenhInMoiHon: async () => false,
      msChoThongTin: 20,
      msThuLaiTre: 10,
      ...them,
    });
    const c = ioClient(`http://localhost:${port}/print-agent`, { auth: { token: TOKEN }, reconnection: false, transports: ['websocket'] });
    clients.push(c);
    await new Promise<void>((r, j) => { c.on('connect', () => r()); c.on('connect_error', j); });
    return { c, registry, nhatKy, capNhatJobTre };
  }

  it('V-b: hoá đơn đã có lệnh in MỚI → `loi` trễ chốt `loi` (không kéo về cho_in), không ngắt cầu dao', async () => {
    const { c, registry, nhatKy, capNhatJobTre } = await dung({ coLenhInMoiHon: async () => true });
    registry.ghiNguCanh('jX', { printJobId: 'pjX', orgId: 'o', soHoaDon: 'INV/X', tenKhach: null, token: TOKEN });
    c.emit('ket-qua', { jobId: 'jX', trangThai: 'loi', loai: 'het_giay' });
    await cho(80);
    expect(capNhatJobTre).toHaveBeenCalledWith('pjX', { trangThai: 'loi' }, expect.stringContaining('đã có lệnh in mới'), { choPhepDangGui: false });
    expect(registry.xetCauDao(TOKEN)).toBe('gui');
    expect(nhatKy.find((m) => m.loai === 'ket_qua_tre')!.noiDung).toContain('đã có lệnh in mới cho hoá đơn này, không tự gửi lại');
  });

  it('V-b: `da_in` trễ mà đã có lệnh in mới → vẫn chốt da_in nhưng nhật ký CẢNH BÁO có thể ra 2 tờ', async () => {
    const { c, registry, nhatKy } = await dung({ coLenhInMoiHon: async () => true });
    registry.ghiNguCanh('jY', { printJobId: 'pjY', orgId: 'o', soHoaDon: 'INV/Y', tenKhach: null, token: TOKEN });
    c.emit('ket-qua', { jobId: 'jY', trangThai: 'da_in' });
    await cho(80);
    const d = nhatKy.find((m) => m.loai === 'ket_qua_tre')!;
    expect(d.mucDo).toBe('canh_bao');
    expect(d.noiDung).toContain('có thể ra 2 tờ');
  });

  it('kiểm cuối: `da_in` trễ kèm ghi chú của app (job kẹt rồi biến mất) → nhật ký mức cảnh báo, giữ nguyên ghi chú', async () => {
    const { c, registry, nhatKy } = await dung();
    registry.ghiNguCanh('jG', { printJobId: 'pjG', orgId: 'o', soHoaDon: 'INV/G', tenKhach: null, token: TOKEN });
    c.emit('ket-qua', { jobId: 'jG', trangThai: 'da_in', loiCuoi: 'In xong sau khi hết sự cố (Hết giấy) — nếu cửa hàng đã xoá tay hàng đợi máy in thì kiểm lại hoá đơn này' });
    await cho(80);
    const d = nhatKy.find((m) => m.loai === 'ket_qua_tre')!;
    expect(d.mucDo).toBe('canh_bao');
    expect(d.noiDung).toContain('xoá tay hàng đợi');
  });

  it('V-c: `loi` trễ KHÔNG đổi được job (đã in / đã dọn tay) → không hứa tự gửi lại, không ngắt cầu dao', async () => {
    const { c, registry, nhatKy, capNhatJobTre } = await dung();
    capNhatJobTre.mockResolvedValue(0);
    registry.ghiNguCanh('jZ', { printJobId: 'pjZ', orgId: 'o', soHoaDon: 'INV/Z', tenKhach: null, token: TOKEN });
    c.emit('ket-qua', { jobId: 'jZ', trangThai: 'loi', loai: 'het_giay' });
    await cho(80);
    expect(registry.xetCauDao(TOKEN)).toBe('gui');
    expect(nhatKy.map((m) => m.loai)).not.toContain('tam_giu');
    const d = nhatKy.find((m) => m.loai === 'ket_qua_tre')!;
    expect(d.noiDung).toContain('KHÔNG tự gửi lại');
    expect(d.noiDung).not.toContain('sẽ tự gửi in lại');
  });

  it('N-a: token trong `luc` app gửi bị che (su-co và trang-thai-may-in)', async () => {
    const { c, nhatKy } = await dung();
    c.emit('su-co', { jobId: 'j', loai: 'ket_giay', luc: `${TOKEN}xx` });
    c.emit('trang-thai-may-in', { trangThai: 'het_giay', luc: `${TOKEN}yy` });
    await cho(60);
    expect(JSON.stringify(nhatKy.map((m) => m.chiTiet))).not.toContain(TOKEN.slice(0, 12));
  });

  it('N-b: job đổi trạng thái SAU khi tiến trình khởi động → không phải mồ côi (không nhận dang_gui); TRƯỚC → mồ côi', async () => {
    const mocKhoiDong = new Date('2026-09-25T03:00:00Z');
    for (const [updatedAt, moCoi] of [[new Date('2026-09-25T03:05:00Z'), false], [new Date('2026-09-25T02:55:00Z'), true]] as const) {
      const { c, capNhatJobTre } = await dung({
        mocKhoiDong,
        layJobTheoId: async (id) => ({ id, orgId: 'o', soHoaDon: 'INV/N', agentToken: TOKEN, updatedAt }),
      });
      c.emit('ket-qua', { jobId: `${PJ}-1727000000000`, trangThai: 'da_in' });
      await cho(80);
      expect(capNhatJobTre).toHaveBeenCalledWith(PJ, { trangThai: 'da_in' }, null, { choPhepDangGui: moCoi });
      c.disconnect();
    }
  });
});
