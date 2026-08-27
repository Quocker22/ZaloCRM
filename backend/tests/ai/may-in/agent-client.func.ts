// SPDX-License-Identifier: AGPL-3.0-or-later
// AgentClient — bọc AgentRegistry thành ClientMayIn để chayMotLuotIn (hàng
// đợi in, hang-doi-in.ts) dùng được thay IppClient mà KHÔNG đổi gì ở hàng
// đợi. Registry giả (vi.fn) đủ cho test đơn vị hành vi trả về; NHƯNG phân
// loại lỗi (LoiIpp/LoiKhongRo) là hợp đồng SỐNG CÒN theo luật A3, nên cuối
// file có thêm 1 test end-to-end dùng AgentRegistry THẬT — không phải fake
// đoán message, để phát hiện lệch hợp đồng giữa 2 module thật.
import { describe, it, expect, vi } from 'vitest';
import { AgentClient } from '../../../src/modules/ai/may-in/agent-client.js';
import { AgentRegistry, AgentKhongOnline, AgentRotGiuaChung } from '../../../src/modules/ai/may-in/agent-registry.js';
import { LoiIpp, LoiKhongRo } from '../../../src/modules/ai/may-in/ipp-client.js';

describe('AgentClient', () => {
  it('agent in xong → inPdf trả về bình thường, jobId null (agent không nói IPP)', async () => {
    const reg = { guiJob: vi.fn(async () => ({ trangThai: 'da_in' })) } as any;
    const c = new AgentClient(reg, 'org1', { paperSize: 'A5', tray: 'tray-2' });
    const kq = await c.inPdf(Buffer.from('%PDF'), 'INV/1');
    expect(reg.guiJob).toHaveBeenCalledWith('org1', expect.objectContaining({ paperSize: 'A5', tray: 'tray-2' }));
    expect(kq.jobId).toBeNull();
  });

  it('không agent → LoiIpp guiDuoc=false', async () => {
    // Fake ném ĐÚNG loại lỗi mà AgentRegistry thật ném (AgentKhongOnline),
    // không phải chuỗi message tự đoán — vì AgentClient phân loại bằng
    // instanceof, fake giả string sai class sẽ không còn phản ánh đúng
    // hành vi thật (đó là lỗ hổng mà test tích hợp bên dưới bịt lại).
    const reg = { guiJob: vi.fn(async () => { throw new AgentKhongOnline('org1'); }) } as any;
    const c = new AgentClient(reg, 'org1', { paperSize: 'A5', tray: 'tray-2' });
    const e = await c.inPdf(Buffer.from('%PDF'), 'x').catch(x => x);
    expect(e).toBeInstanceOf(LoiIpp);
    expect(e.guiDuoc).toBe(false);
  });

  it('agent rớt khi đang in → LoiKhongRo', async () => {
    const reg = { guiJob: vi.fn(async () => { throw new AgentRotGiuaChung('org1'); }) } as any;
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

  describe('tích hợp với AgentRegistry thật (không fake message)', () => {
    it('registry thật: không agent online → AgentClient ném LoiIpp guiDuoc=false', async () => {
      const reg = new AgentRegistry();
      const c = new AgentClient(reg, 'org1', { paperSize: 'A5', tray: 'tray-2' });
      const e = await c.inPdf(Buffer.from('%PDF'), 'x').catch(x => x);
      expect(e).toBeInstanceOf(LoiIpp);
      expect(e.guiDuoc).toBe(false);
    });

    it('registry thật: agent rớt giữa lúc đang chờ → AgentClient ném LoiKhongRo', async () => {
      const reg = new AgentRegistry();
      const c = new AgentClient(reg, 'org1', { paperSize: 'A5', tray: 'tray-2' });
      const huy = reg.dangKy('org1', () => {
        // Agent "rớt" ngay khi vừa nhận job, trước khi kịp trả kết quả.
        huy();
      });
      await expect(c.inPdf(Buffer.from('%PDF'), 'x')).rejects.toBeInstanceOf(LoiKhongRo);
    });
  });
});
