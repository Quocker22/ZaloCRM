// SPDX-License-Identifier: AGPL-3.0-or-later
// AgentClient — bọc AgentRegistry thành ClientMayIn để chayMotLuotIn (hàng
// đợi in, hang-doi-in.ts) dùng được thay IppClient mà KHÔNG đổi gì ở hàng
// đợi. Registry giả (vi.fn) đủ vì hợp đồng cần test là PHÂN LOẠI LỖI khớp
// đúng message mà AgentRegistry thật ném ra (xem agent-registry.ts).
import { describe, it, expect, vi } from 'vitest';
import { AgentClient } from '../../../src/modules/ai/may-in/agent-client.js';
import { LoiIpp, LoiKhongRo } from '../../../src/modules/ai/may-in/ipp-client.js';

describe('AgentClient', () => {
  it('agent in xong → inPdf trả về bình thường', async () => {
    const reg = { guiJob: vi.fn(async () => ({ trangThai: 'da_in' })) } as any;
    const c = new AgentClient(reg, 'org1', { paperSize: 'A5', tray: 'tray-2' });
    await c.inPdf(Buffer.from('%PDF'), 'INV/1');
    expect(reg.guiJob).toHaveBeenCalledWith('org1', expect.objectContaining({ paperSize: 'A5', tray: 'tray-2' }));
  });

  it('không agent → LoiIpp guiDuoc=false', async () => {
    const reg = { guiJob: vi.fn(async () => { throw new Error('không có agent'); }) } as any;
    const c = new AgentClient(reg, 'org1', { paperSize: 'A5', tray: 'tray-2' });
    const e = await c.inPdf(Buffer.from('%PDF'), 'x').catch(x => x);
    expect(e).toBeInstanceOf(LoiIpp);
    expect(e.guiDuoc).toBe(false);
  });

  it('agent rớt khi đang in → LoiKhongRo', async () => {
    const reg = { guiJob: vi.fn(async () => { throw new Error('agent rớt giữa chừng'); }) } as any;
    const c = new AgentClient(reg, 'org1', { paperSize: 'A5', tray: 'tray-2' });
    await expect(c.inPdf(Buffer.from('%PDF'), 'x')).rejects.toBeInstanceOf(LoiKhongRo);
  });

  it('agent báo lỗi in → LoiIpp guiDuoc=true', async () => {
    const reg = { guiJob: vi.fn(async () => { throw new Error('máy in hết giấy'); }) } as any;
    const c = new AgentClient(reg, 'org1', { paperSize: 'A5', tray: 'tray-2' });
    const e = await c.inPdf(Buffer.from('%PDF'), 'x').catch(x => x);
    expect(e).toBeInstanceOf(LoiIpp);
    expect(e.guiDuoc).toBe(true);
  });

  it('traTrangThaiJob trả jobState null — agent không có khái niệm job-id máy in', async () => {
    const reg = { guiJob: vi.fn() } as any;
    const c = new AgentClient(reg, 'org1', { paperSize: 'A5', tray: 'tray-2' });
    await expect(c.traTrangThaiJob(1)).resolves.toMatchObject({ jobState: null });
  });
});
