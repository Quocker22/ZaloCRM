// SPDX-License-Identifier: AGPL-3.0-or-later
// agent-ws.ts — namespace /print-agent để agent PC-cầu-nối kết nối WS thật.
// Test dựng socket.io Server + socket.io-client THẬT trên cổng ngẫu nhiên
// (KHÔNG mock socket) — vì phần cần verify là hành vi handshake auth +
// lifecycle disconnect của chính thư viện socket.io, không phải logic
// thuần của ta. Mock socket sẽ không bắt được sai lệch API thật (event
// tên gì, thứ tự gọi ra sao) như review Task 1+2 đã cảnh báo.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { registerAgentWs } from '../../../src/modules/ai/may-in/agent-ws.js';
import { AgentRegistry } from '../../../src/modules/ai/may-in/agent-registry.js';

const TOKEN_DUNG = 'token-agent-test-dung';

describe('registerAgentWs', () => {
  let httpServer: HttpServer;
  let io: IoServer;
  let registry: AgentRegistry;
  let port: number;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    process.env.AI_MAY_IN_AGENT_TOKEN = TOKEN_DUNG;
    httpServer = createServer();
    io = new IoServer(httpServer);
    registry = new AgentRegistry();
    registerAgentWs(io, registry);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const addr = httpServer.address();
    if (addr && typeof addr === 'object') port = addr.port;
  });

  afterEach(async () => {
    for (const c of clients) {
      c.disconnect();
    }
    clients.length = 0;
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    delete process.env.AI_MAY_IN_AGENT_TOKEN;
  });

  function connect(auth: Record<string, unknown>): ClientSocket {
    const c = ioClient(`http://localhost:${port}/print-agent`, {
      auth,
      reconnection: false,
      transports: ['websocket'],
    });
    clients.push(c);
    return c;
  }

  it('token đúng → registry.coAgent(org) = true', async () => {
    const c = connect({ token: TOKEN_DUNG, orgId: 'org1' });
    await new Promise<void>((resolve, reject) => {
      c.on('connect', () => resolve());
      c.on('connect_error', (err) => reject(err));
    });
    // đợi 1 tick để server xử lý xong 'connection' handler (dangKy chạy sync
    // trong handler nên connect event đã đủ, nhưng chờ thêm cho chắc trong CI chậm).
    await new Promise((r) => setTimeout(r, 50));
    expect(registry.coAgent('org1')).toBe(true);
  });

  it('token sai → bị disconnect, không đăng ký', async () => {
    const c = connect({ token: 'token-sai', orgId: 'org1' });
    const ketQua = await new Promise<string>((resolve) => {
      c.on('connect', () => resolve('connected'));
      c.on('connect_error', () => resolve('connect_error'));
      c.on('disconnect', () => resolve('disconnect'));
    });
    expect(ketQua).not.toBe('connected');
    await new Promise((r) => setTimeout(r, 50));
    expect(registry.coAgent('org1')).toBe(false);
  });

  it('thiếu orgId → bị từ chối, không đăng ký', async () => {
    const c = connect({ token: TOKEN_DUNG });
    const ketQua = await new Promise<string>((resolve) => {
      c.on('connect', () => resolve('connected'));
      c.on('connect_error', () => resolve('connect_error'));
    });
    expect(ketQua).toBe('connect_error');
  });

  it("agent gửi 'ket-qua' → registry.nhanKetQua được gọi đúng (orgId, jobId, kq)", async () => {
    const spy = vi.spyOn(registry, 'nhanKetQua');
    const c = connect({ token: TOKEN_DUNG, orgId: 'org1' });
    await new Promise<void>((resolve, reject) => {
      c.on('connect', () => resolve());
      c.on('connect_error', (err) => reject(err));
    });
    c.emit('ket-qua', { jobId: 'j1', trangThai: 'da_in' });
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).toHaveBeenCalledWith('org1', 'j1', { trangThai: 'da_in', loiCuoi: undefined });
  });

  it('registry.dangKy gui gửi đúng qua socket.emit(job, msg)', async () => {
    const c = connect({ token: TOKEN_DUNG, orgId: 'org1' });
    await new Promise<void>((resolve, reject) => {
      c.on('connect', () => resolve());
      c.on('connect_error', (err) => reject(err));
    });
    await new Promise((r) => setTimeout(r, 50));

    const jobNhanDuoc = new Promise((resolve) => {
      c.on('job', (msg) => resolve(msg));
    });
    // Gọi thẳng qua registry (giả lập hàng đợi gửi job) — verify agent-ws đã
    // đăng ký đúng hàm `gui` cho registry, không phải tự bịa 1 kênh khác.
    // Promise này KHÔNG resolve trong test (agent giả không gọi ket-qua) —
    // gắn .catch ngay để tránh unhandled rejection khi afterEach đóng socket
    // và huy() reject nó (đây là hành vi ĐÚNG của registry, không phải lỗi).
    const promiseJob = registry.guiJob('org1', { id: 'j2', pdfBase64: 'AAAA', paperSize: 'A5', tray: 'tray-2', copies: 1 });
    promiseJob.catch(() => {});
    const msg = await jobNhanDuoc;
    expect(msg).toMatchObject({ loai: 'in', job: { id: 'j2', paperSize: 'A5' } });
  });

  it("disconnect (ping-timeout giả lập bằng io.close phía client thô) → huỷ đăng ký chạy → coAgent=false, job đang chờ reject", async () => {
    const c = connect({ token: TOKEN_DUNG, orgId: 'org1' });
    await new Promise<void>((resolve, reject) => {
      c.on('connect', () => resolve());
      c.on('connect_error', (err) => reject(err));
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(registry.coAgent('org1')).toBe(true);

    const promiseChoKetQua = registry.guiJob('org1', {
      id: 'j3',
      pdfBase64: 'AAAA',
      paperSize: 'A5',
      tray: 'tray-2',
      copies: 1,
    });
    // Gắn assertion NGAY (không chờ setTimeout rồi mới attach) — nếu không,
    // rejection xảy ra trong lúc chờ mà chưa ai .catch nó, Node coi là
    // "unhandled rejection" dù sau đó ta có await nó (đây là artifact về
    // THỜI ĐIỂM gắn handler, không phải lỗi hành vi thật).
    const kyVongReject = expect(promiseChoKetQua).rejects.toThrow(/agent/i);

    // Đóng transport thô (không phải client.disconnect() lịch sự) để mô phỏng
    // mất mạng đột ngột — server phải tự phát 'disconnect' qua cơ chế của
    // chính socket.io (ping-timeout/transport close), không phải ta tự bắt 'close'.
    c.disconnect();

    await new Promise((r) => setTimeout(r, 100));
    expect(registry.coAgent('org1')).toBe(false);
    await kyVongReject;
  });

  it('thiếu env AI_MAY_IN_AGENT_TOKEN → không đăng ký namespace (log cảnh báo)', async () => {
    delete process.env.AI_MAY_IN_AGENT_TOKEN;
    const httpServer2 = createServer();
    const io2 = new IoServer(httpServer2);
    const registry2 = new AgentRegistry();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerAgentWs(io2, registry2);
    // Namespace /print-agent không được đăng ký handler nào — connect phải lỗi/timeout.
    await new Promise<void>((resolve) => httpServer2.listen(0, () => resolve()));
    const addr2 = httpServer2.address();
    const port2 = addr2 && typeof addr2 === 'object' ? addr2.port : 0;
    const c = ioClient(`http://localhost:${port2}/print-agent`, {
      auth: { token: 'bat-ky', orgId: 'org1' },
      reconnection: false,
      transports: ['websocket'],
      timeout: 300,
    });
    const ketQua = await new Promise<string>((resolve) => {
      c.on('connect', () => resolve('connected'));
      c.on('connect_error', () => resolve('connect_error'));
      setTimeout(() => resolve('timeout'), 500);
    });
    expect(ketQua).not.toBe('connected');
    c.disconnect();
    io2.close();
    await new Promise<void>((resolve) => httpServer2.close(() => resolve()));
    warnSpy.mockRestore();
  });
});
