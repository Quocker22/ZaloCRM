// SPDX-License-Identifier: AGPL-3.0-or-later
// agent-ws.ts — event mới của hợp đồng §2 (cau-hinh, su-co, trang-thai-may-in,
// thong-tin-app, ket-qua khong_ro + kết quả trễ) qua socket.io THẬT, khoá
// registry theo TOKEN (khác agent-ws.func.ts cũ còn gọi theo orgId — đỏ sẵn
// trên prod từ Task 4, xem MAY-IN-HANDOFF §5.5).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { registerAgentWs, HO_TRO_APP } from '../../../src/modules/ai/may-in/agent-ws.js';
import { AgentRegistry, AgentHetGioCho } from '../../../src/modules/ai/may-in/agent-registry.js';
import type { MucNhatKy } from '../../../src/modules/ai/may-in/nhat-ky.js';
import { dichVuHangDoiRong } from './prisma-gia-hang-doi.js';

const TOKEN = 'tokHN_bi_mat_khong_duoc_lo_9x7';

describe('agent-ws — sự cố máy in + nhật ký', () => {
  let httpServer: HttpServer;
  let io: IoServer;
  let registry: AgentRegistry;
  let port: number;
  let nhatKy: MucNhatKy[];
  let capNhatJobTre: ReturnType<typeof vi.fn>;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    process.env.AI_MAY_IN_AGENT_TOKEN = 'token-env-khac';
    httpServer = createServer();
    io = new IoServer(httpServer);
    registry = new AgentRegistry({ msChoKetQua: 300 });
    nhatKy = [];
    capNhatJobTre = vi.fn(async () => 1);
    registerAgentWs(io, registry, {
      layMayInTheoToken: async (t) => (t === TOKEN ? { token: TOKEN } : null),
      ghiNhatKy: (m) => nhatKy.push(m),
      capNhatJobTre,
      // Không bao giờ để test chạm Prisma thật (DB giả của vitest.func.config).
      layJobTheoId: async () => null,
      coLenhInMoiHon: async () => false,
      dichVuHangDoi: dichVuHangDoiRong(),
      msChoThongTin: 100,
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

  async function noi(): Promise<{ c: ClientSocket; cauHinh: Promise<any> }> {
    const c = ioClient(`http://localhost:${port}/print-agent`, { auth: { token: TOKEN }, reconnection: false, transports: ['websocket'] });
    clients.push(c);
    const cauHinh = new Promise((resolve) => c.on('cau-hinh', resolve));
    await new Promise<void>((resolve, reject) => {
      c.on('connect', () => resolve());
      c.on('connect_error', reject);
    });
    return { c, cauHinh };
  }
  const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('kết nối → gửi cau-hinh quảng bá khả năng; thong-tin-app gộp vào dòng app_ket_noi', async () => {
    const { c, cauHinh } = await noi();
    expect(await cauHinh).toEqual({ hoTro: [...HO_TRO_APP] });
    c.emit('thong-tin-app', { phienBan: '0.4.0', mayIn: 'HP LaserJet 4003', may: 'PC-SHOP-HN', khay: 'tray-2', khoGiay: 'A5' });
    await cho(60);
    const dong = nhatKy.filter((m) => m.loai === 'app_ket_noi');
    expect(dong).toHaveLength(1);
    expect(dong[0].noiDung).toBe('App máy in kết nối (máy in "HP LaserJet 4003", máy tính PC-SHOP-HN, app v0.4.0)');
    expect(dong[0].agentToken).toBe(TOKEN); // chỉ để tra máy — nhat-ky.ts không lưu
  });

  it('su-co hết giấy trong lúc in → nhật ký kèm hoá đơn/khách, cập nhật tình trạng; gửi lặp chỉ 1 dòng', async () => {
    const { c } = await noi();
    registry.ghiNguCanh('job-1', { printJobId: 'pj1', orgId: 'org1', soHoaDon: 'INV/2026/030045', tenKhach: 'Anh Lộc', token: TOKEN });
    const sc = { jobId: 'job-1', loai: 'het_giay', chiTiet: 'Khay 2 trống', mayIn: 'HP 4003', luc: new Date().toISOString() };
    c.emit('su-co', sc);
    c.emit('su-co', sc);
    await cho(80);
    const dong = nhatKy.filter((m) => m.loai === 'het_giay');
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({ printJobId: 'pj1', soHoaDon: 'INV/2026/030045', tenKhach: 'Anh Lộc', orgId: 'org1' });
    expect(dong[0].noiDung).toBe('Hết giấy khi in hoá đơn INV/2026/030045 (máy in "HP 4003") — Khay 2 trống');
    expect(registry.layTinhTrang(TOKEN)?.ma).toBe('het_giay');
  });

  it('su-co mã lạ → bỏ qua, không ghi', async () => {
    const { c } = await noi();
    c.emit('su-co', { jobId: 'x', loai: 'DROP TABLE' });
    await cho(60);
    expect(nhatKy.filter((m) => m.loai !== 'app_ket_noi')).toHaveLength(0);
  });

  it('trang-thai-may-in: lần đầu bình thường không ghi; đổi sang kẹt giấy ghi; trùng không ghi; hết sự cố ghi', async () => {
    const { c } = await noi();
    c.emit('trang-thai-may-in', { trangThai: 'binh_thuong', mayIn: 'HP' });
    await cho(40);
    c.emit('trang-thai-may-in', { trangThai: 'ket_giay', mayIn: 'HP', chiTiet: 'Cửa sau' });
    await cho(40);
    c.emit('trang-thai-may-in', { trangThai: 'ket_giay', mayIn: 'HP' });
    await cho(40);
    c.emit('trang-thai-may-in', { trangThai: 'binh_thuong', mayIn: 'HP' });
    await cho(60);
    const dong = nhatKy.filter((m) => m.loai === 'ket_giay' || m.loai === 'binh_thuong');
    expect(dong.map((m) => m.loai)).toEqual(['ket_giay', 'binh_thuong']);
    expect(dong[1].noiDung).toBe('Máy in "HP" đã hết sự cố (Kẹt giấy), hoạt động bình thường');
  });

  it('ket-qua khong_ro tới kịp → registry nhận đúng trạng thái + mã', async () => {
    const { c } = await noi();
    c.on('job', (msg: any) => c.emit('ket-qua', { jobId: msg.job.id, trangThai: 'khong_ro', loai: 'ket_giay', loiCuoi: 'kẹt giữa chừng' }));
    const kq = await registry.guiJob(TOKEN, { id: 'j9', name: 'n', pdfBase64: 'A', paperSize: 'A5', tray: 'tray-2', copies: 1 });
    expect(kq).toEqual({ trangThai: 'khong_ro', loai: 'ket_giay', loiCuoi: 'kẹt giữa chừng' });
  });

  it('kết quả ĐẾN TRỄ sau hạn chờ → cập nhật job khong_ro thành da_in + nhật ký ket_qua_tre', async () => {
    const { c } = await noi();
    registry.ghiNguCanh('jTre', { printJobId: 'pjTre', orgId: 'org1', soHoaDon: 'INV/9', tenKhach: null, token: TOKEN });
    const p = registry.guiJob(TOKEN, { id: 'jTre', name: 'n', pdfBase64: 'A', paperSize: 'A5', tray: 'tray-2', copies: 1 });
    await expect(p).rejects.toBeInstanceOf(AgentHetGioCho); // hạn 300ms trong test
    c.emit('ket-qua', { jobId: 'jTre', trangThai: 'da_in' });
    await cho(80);
    expect(capNhatJobTre).toHaveBeenCalledWith('pjTre', { trangThai: 'da_in' }, null, { choPhepDangGui: false });
    const dong = nhatKy.find((m) => m.loai === 'ket_qua_tre')!;
    expect(dong.noiDung).toBe('Hoá đơn INV/9 đã in — app xác nhận sau hạn chờ (đã cập nhật trạng thái job)');
    expect(dong.mucDo).toBe('thong_tin');
  });

  it('mất kết nối → app_mat_ket_noi; tình trạng về null (giao diện không hiện trạng thái cũ)', async () => {
    const { c } = await noi();
    c.emit('trang-thai-may-in', { trangThai: 'het_giay', mayIn: 'HP' });
    await cho(40);
    expect(registry.layTinhTrang(TOKEN)?.ma).toBe('het_giay');
    c.disconnect();
    await cho(80);
    expect(nhatKy.map((m) => m.loai)).toContain('app_mat_ket_noi');
    expect(registry.layTinhTrang(TOKEN)).toBeNull();
  });
});
