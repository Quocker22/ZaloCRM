// SPDX-License-Identifier: AGPL-3.0-or-later
// AgentRegistry — quản lý agent PC-cầu-nối đang online qua WebSocket, gửi
// job in và chờ kết quả theo id. Test KHÔNG dựng WS thật (đó là việc của
// agent-ws.ts ở Task 3) — chỉ kiểm hành vi đăng ký/gửi/nhận của registry.
import { describe, it, expect } from 'vitest';
import { AgentRegistry } from '../../../src/modules/ai/may-in/agent-registry.js';

describe('AgentRegistry', () => {
  it('đăng ký agent rồi thấy online, huỷ thì offline', () => {
    const r = new AgentRegistry();
    const huy = r.dangKy('org1', () => {});
    expect(r.coAgent('org1')).toBe(true);
    huy();
    expect(r.coAgent('org1')).toBe(false);
  });

  it('guiJob đẩy job cho agent và resolve khi có kết quả', async () => {
    const r = new AgentRegistry();
    let daGui: any = null;
    r.dangKy('org1', (msg) => { daGui = msg; });
    const p = r.guiJob('org1', { id: 'j1', pdfBase64: 'AAAA', paperSize: 'A5', tray: 'tray-2', copies: 1 });
    expect(daGui).toMatchObject({ loai: 'in', job: { id: 'j1', paperSize: 'A5' } });
    r.nhanKetQua('j1', { trangThai: 'da_in' });
    await expect(p).resolves.toEqual({ trangThai: 'da_in' });
  });

  it('agent rớt khi đang chờ kết quả → reject để hàng đợi vào khong_ro', async () => {
    const r = new AgentRegistry();
    const huy = r.dangKy('org1', () => {});
    const p = r.guiJob('org1', { id: 'j2', pdfBase64: 'A', paperSize: 'A5', tray: 'tray-2', copies: 1 });
    huy();
    await expect(p).rejects.toThrow(/agent/i);
  });

  it('không agent → reject "chưa gửi được"', async () => {
    const r = new AgentRegistry();
    await expect(r.guiJob('org1', { id: 'j3', pdfBase64: 'A', paperSize: 'A5', tray: 'tray-2', copies: 1 })).rejects.toThrow();
  });
});
