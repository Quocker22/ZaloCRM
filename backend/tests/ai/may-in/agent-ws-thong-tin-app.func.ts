// SPDX-License-Identifier: AGPL-3.0-or-later
// agent-ws.ts — `thong-tin-app` của app ≥ 0.2.8 (ketNoi / heDieuHanh / banBuild) qua socket.io THẬT:
//   - dòng app_ket_noi thêm "<moTa kết nối>" + hệ điều hành; app cũ (5 trường) ghi y như trước;
//   - thong-tin-app tới SAU dòng đó: KHÔNG ghi app_ket_noi thứ hai; chỉ khi loai / ip / mayTraLoi
//     đổi thì MỘT dòng app_ket_noi_doi, tối đa 1 dòng / msGiuaDoiKetNoi / socket (đổi dồn → tới hạn
//     ghi trạng thái MỚI NHẤT; đổi rồi quay về như cũ → không ghi);
//   - registry giữ bản mới nhất cho trang Cài đặt › Máy in; hết kết nối → bỏ.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { registerAgentWs } from '../../../src/modules/ai/may-in/agent-ws.js';
import { AgentRegistry } from '../../../src/modules/ai/may-in/agent-registry.js';
import type { MucNhatKy } from '../../../src/modules/ai/may-in/nhat-ky.js';
import { dichVuHangDoiRong } from './prisma-gia-hang-doi.js';

const TOKEN = 'tokHN_bi_mat_khong_duoc_lo_9x7';
const MS_GIUA_DOI = 300;

const ketNoi = (them: Record<string, unknown> = {}) => ({
  loai: 'wsd', laMang: true, cong: 'WSD-3f2a9c', ip: '192.168.1.23', nguonIp: 'pnpx',
  mayTraLoi: 'sẵn sàng (IPP)', moTa: 'Mạng LAN (WSD) · 192.168.1.23', ...them,
});
const ttMoi = (them: Record<string, unknown> = {}) => ({
  phienBan: '0.2.8', mayIn: 'HP 4003', may: 'KHO-HN', khay: 'tray-2', khoGiay: 'A5',
  ketNoi: ketNoi(), heDieuHanh: 'Windows 7 SP1', banBuild: 'win7', ...them,
});

describe('agent-ws — thong-tin-app: kết nối máy in (USB / LAN)', () => {
  let httpServer: HttpServer;
  let io: IoServer;
  let registry: AgentRegistry;
  let port: number;
  let nhatKy: MucNhatKy[];
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    process.env.AI_MAY_IN_AGENT_TOKEN = 'token-env-khac';
    httpServer = createServer();
    io = new IoServer(httpServer);
    registry = new AgentRegistry({ msChoKetQua: 300 });
    nhatKy = [];
    registerAgentWs(io, registry, {
      layMayInTheoToken: async (t) => (t === TOKEN ? { token: TOKEN } : null),
      ghiNhatKy: (m) => nhatKy.push(m),
      capNhatJobTre: async () => 1,
      layJobTheoId: async () => null,
      coLenhInMoiHon: async () => false,
      dichVuHangDoi: dichVuHangDoiRong(),
      msChoThongTin: 100,
      msGiuaDoiKetNoi: MS_GIUA_DOI,
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

  async function noi(): Promise<ClientSocket> {
    const c = ioClient(`http://localhost:${port}/print-agent`, { auth: { token: TOKEN }, reconnection: false, transports: ['websocket'] });
    clients.push(c);
    await new Promise<void>((resolve, reject) => {
      c.on('connect', () => resolve());
      c.on('connect_error', reject);
    });
    return c;
  }
  const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const dong = (loai: string) => nhatKy.filter((m) => m.loai === loai);

  it('app 0.2.8: dòng app_ket_noi có "<moTa>" + hệ điều hành; registry giữ ketNoi / heDieuHanh / banBuild / phienBan', async () => {
    const c = await noi();
    c.emit('thong-tin-app', ttMoi());
    await cho(60);
    expect(dong('app_ket_noi')).toHaveLength(1);
    expect(dong('app_ket_noi')[0].noiDung).toBe(
      'App máy in kết nối (máy in "HP 4003", máy tính KHO-HN, app v0.2.8, Mạng LAN (WSD) · 192.168.1.23, Windows 7 SP1)',
    );
    expect(dong('app_ket_noi')[0].chiTiet).toMatchObject({ ketNoi: { loai: 'wsd', ip: '192.168.1.23' }, heDieuHanh: 'Windows 7 SP1', banBuild: 'win7' });
    expect(registry.layThongTinApp(TOKEN)).toMatchObject({
      phienBan: '0.2.8', heDieuHanh: 'Windows 7 SP1', banBuild: 'win7',
      ketNoi: { loai: 'wsd', laMang: true, cong: 'WSD-3f2a9c', ip: '192.168.1.23', nguonIp: 'pnpx', mayTraLoi: 'sẵn sàng (IPP)' },
    });
  });

  it('app cũ (5 trường): dòng + chiTiet y như trước; registry có phienBan, kết nối null', async () => {
    const c = await noi();
    c.emit('thong-tin-app', { phienBan: '0.2.7', mayIn: 'HP LaserJet 4003', may: 'PC-SHOP-HN', khay: 'tray-2', khoGiay: 'A5' });
    await cho(60);
    expect(dong('app_ket_noi').map((m) => m.noiDung)).toEqual(['App máy in kết nối (máy in "HP LaserJet 4003", máy tính PC-SHOP-HN, app v0.2.7)']);
    expect(dong('app_ket_noi')[0].chiTiet).toEqual({ phienBan: '0.2.7', mayIn: 'HP LaserJet 4003', khay: 'tray-2', khoGiay: 'A5', may: 'PC-SHOP-HN' });
    expect(registry.layThongTinApp(TOKEN)).toMatchObject({ phienBan: '0.2.7', ketNoi: null, heDieuHanh: null, banBuild: null });
    // App cũ gửi lại (vd nối lại cùng socket) → không dòng nào thêm
    c.emit('thong-tin-app', { phienBan: '0.2.7', mayIn: 'HP LaserJet 4003', may: 'PC-SHOP-HN' });
    await cho(60);
    expect(nhatKy.map((m) => m.loai)).toEqual(['app_ket_noi']);
  });

  it('payload độc: mã lạ → null, laMang không boolean → null, khoá lạ bị bỏ, token bị che', async () => {
    const c = await noi();
    c.emit('thong-tin-app', {
      phienBan: '0.2.8',
      ketNoi: { loai: 'DROP TABLE', laMang: 'true', cong: 'USB001', ip: `h-${TOKEN}`, nguonIp: 'hack', moTa: 'x'.repeat(500), token: TOKEN },
      heDieuHanh: 'Windows 10', banBuild: 'root', laAdmin: true,
    });
    await cho(60);
    const tt = registry.layThongTinApp(TOKEN)!;
    expect(tt.ketNoi).toMatchObject({ loai: null, laMang: null, cong: 'USB001', ip: 'h-…', nguonIp: null });
    expect(tt.ketNoi!.moTa).toHaveLength(200);
    expect(tt.ketNoi).not.toHaveProperty('token');
    expect(tt.banBuild).toBeNull();
    // `agentToken` của MucNhatKy chỉ để tra máy — nhat-ky.ts KHÔNG lưu; mọi chữ còn lại không được mang token.
    expect(JSON.stringify([tt, nhatKy.map(({ agentToken: _bo, ...m }) => m)])).not.toContain(TOKEN);
  });

  it('gửi lại cùng kết nối (chỉ moTa/cổng đổi chữ) → KHÔNG dòng nào thêm, nhưng registry cập nhật', async () => {
    const c = await noi();
    c.emit('thong-tin-app', ttMoi());
    await cho(60);
    c.emit('thong-tin-app', ttMoi({ ketNoi: ketNoi({ moTa: 'Mạng LAN (WSD) · 192.168.1.23 · máy báo sẵn sàng', cong: 'WSD-khac' }) }));
    await cho(60);
    expect(nhatKy.map((m) => m.loai)).toEqual(['app_ket_noi']);
    expect(registry.layThongTinApp(TOKEN)!.ketNoi!.cong).toBe('WSD-khac');
  });

  it('kết nối đổi → MỘT dòng app_ket_noi_doi ngay; đổi dồn trong 1 phút → không thêm, tới hạn ghi MỘT dòng trạng thái mới nhất', async () => {
    const c = await noi();
    c.emit('thong-tin-app', ttMoi({ ketNoi: ketNoi({ mayTraLoi: 'không trả lời', moTa: 'LAN · không trả lời' }) }));
    await cho(60);
    c.emit('thong-tin-app', ttMoi({ ketNoi: ketNoi({ moTa: 'LAN · sẵn sàng' }) }));
    await cho(60);
    expect(dong('app_ket_noi_doi').map((m) => m.noiDung)).toEqual(['Kết nối máy in "HP 4003" đổi: LAN · sẵn sàng (trước: LAN · không trả lời)']);
    expect(dong('app_ket_noi_doi')[0].chiTiet).toMatchObject({ truoc: { mayTraLoi: 'không trả lời' }, sau: { mayTraLoi: 'sẵn sàng (IPP)' } });
    // Ba lần đổi liền nhau trong hạn chờ
    c.emit('thong-tin-app', ttMoi({ ketNoi: ketNoi({ mayTraLoi: 'không trả lời', moTa: 'LAN · không trả lời' }) }));
    c.emit('thong-tin-app', ttMoi({ ketNoi: ketNoi({ ip: '192.168.1.99', mayTraLoi: 'không trả lời', moTa: 'LAN · .99 · không trả lời' }) }));
    c.emit('thong-tin-app', ttMoi({ ketNoi: ketNoi({ loai: 'usb', laMang: false, ip: null, mayTraLoi: null, cong: 'USB001', moTa: 'USB (USB001)' }) }));
    await cho(80);
    expect(dong('app_ket_noi_doi')).toHaveLength(1);
    await cho(MS_GIUA_DOI + 50);
    expect(dong('app_ket_noi_doi').map((m) => m.noiDung)).toEqual([
      'Kết nối máy in "HP 4003" đổi: LAN · sẵn sàng (trước: LAN · không trả lời)',
      'Kết nối máy in "HP 4003" đổi: USB (USB001) (trước: LAN · sẵn sàng)',
    ]);
    expect(dong('app_ket_noi')).toHaveLength(1);
    expect(registry.layThongTinApp(TOKEN)!.ketNoi!.loai).toBe('usb');
  });

  it('đổi rồi QUAY VỀ như dòng gần nhất trong lúc chờ → không ghi gì', async () => {
    const c = await noi();
    c.emit('thong-tin-app', ttMoi());
    await cho(60);
    c.emit('thong-tin-app', ttMoi({ ketNoi: ketNoi({ mayTraLoi: 'không trả lời' }) })); // đổi #1 → ghi ngay
    await cho(40);
    c.emit('thong-tin-app', ttMoi()); // đổi #2 (quay lại) → hẹn
    c.emit('thong-tin-app', ttMoi({ ketNoi: ketNoi({ mayTraLoi: 'không trả lời' }) })); // như dòng gần nhất → huỷ hẹn
    await cho(MS_GIUA_DOI + 80);
    expect(dong('app_ket_noi_doi')).toHaveLength(1);
  });

  it('thong-tin-app tới SAU khi dòng app_ket_noi đã ghi vì hết giờ chờ → không app_ket_noi thứ hai; kết nối lần đầu biết → một dòng đổi', async () => {
    const c = await noi();
    await cho(150); // quá msChoThongTin (100 ms) → dòng app_ket_noi trơn
    c.emit('thong-tin-app', ttMoi());
    await cho(60);
    expect(dong('app_ket_noi').map((m) => m.noiDung)).toEqual(['App máy in kết nối']);
    expect(dong('app_ket_noi_doi').map((m) => m.noiDung)).toEqual(['Kết nối máy in "HP 4003" đổi: Mạng LAN (WSD) · 192.168.1.23 (trước: chưa rõ)']);
  });

  it('mất kết nối → registry bỏ thông tin app; đổi đang hẹn không ghi sau khi đã rớt', async () => {
    const c = await noi();
    c.emit('thong-tin-app', ttMoi());
    await cho(60);
    c.emit('thong-tin-app', ttMoi({ ketNoi: ketNoi({ mayTraLoi: 'không trả lời' }) })); // ghi ngay
    await cho(40);
    c.emit('thong-tin-app', ttMoi()); // hẹn
    await cho(40);
    c.disconnect();
    await cho(MS_GIUA_DOI + 80);
    expect(registry.layThongTinApp(TOKEN)).toBeNull();
    expect(dong('app_ket_noi_doi')).toHaveLength(1);
  });

  it('payload bọc mảng một phần tử (rust_socketio) vẫn đọc được', async () => {
    const c = await noi();
    c.emit('thong-tin-app', [ttMoi({ ketNoi: ketNoi({ loai: 'usb', laMang: false, moTa: 'USB (USB001)' }) })]);
    await cho(60);
    expect(registry.layThongTinApp(TOKEN)!.ketNoi!.loai).toBe('usb');
  });
});
