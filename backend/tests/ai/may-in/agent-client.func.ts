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
    // Fix round 1 (review, Task 5): guiJob() chỉ resolve SAU khi agent báo
    // 'da_in' — máy in vật lý đã in xong THẬT lúc đây. Thiếu daInXong:true
    // thì hang-doi-in.ts ghi da_gui rồi kẹt mãi (ippJobId luôn null nên
    // xacMinh() không bao giờ xác minh được).
    expect(kq.daInXong).toBe(true);
  });

  it('job gửi app có name = "<tên gốc>-<id>.pdf", luôn chứa id (chủ chốt 24/09)', async () => {
    const reg = { guiJob: vi.fn(async () => ({ trangThai: 'da_in' })) } as any;
    const c = new AgentClient(reg, 'tokHN', { paperSize: 'A5', tray: 'tray-2' });
    await c.inPdf(Buffer.from('%PDF'), 'AI-INV_2026_030045-Anh_Loc_Beco');
    const job = reg.guiJob.mock.calls[0][1];
    expect(Object.keys(job).sort()).toEqual(['copies', 'id', 'name', 'paperSize', 'pdfBase64', 'tray']);
    expect(job.name).toBe(`AI-INV_2026_030045-Anh_Loc_Beco-${job.id}.pdf`);
    // Id KHÔNG chứa token (25/09): id nằm trong tên file → hàng đợi in Windows.
    expect(job.id).toMatch(/^\d{13}-\d+$/);
    expect(job.id).not.toContain('tokHN');
    expect(job.name).not.toContain('tokHN');
  });

  it('hai máy khác nhau không bao giờ nhận trùng id job', async () => {
    const reg = { guiJob: vi.fn(async () => ({ trangThai: 'da_in' })) } as any;
    const hn = new AgentClient(reg, 'tokHN', { paperSize: 'A5', tray: 'tray-2' });
    const hcm = new AgentClient(reg, 'tokHCM', { paperSize: 'A5', tray: 'tray-2' });
    for (let i = 0; i < 5; i++) {
      await hn.inPdf(Buffer.from('%PDF'), 'AI-X');
      await hcm.inPdf(Buffer.from('%PDF'), 'AI-X');
    }
    const ids = reg.guiJob.mock.calls.map((c: any[]) => c[1].id);
    expect(new Set(ids).size).toBe(10);
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

describe('id job mang id print_jobs (tìm lại được sau khi backend khởi động lại)', () => {
  it('"<printJobId>-<ms>" khi có ngữ cảnh; tachPrintJobId tách ngược đúng; id lạ → null', async () => {
    const { tachPrintJobId } = await import('../../../src/modules/ai/may-in/agent-client.js');
    const reg = { guiJob: vi.fn(async () => ({ trangThai: 'da_in' })), ghiNguCanh: vi.fn() } as any;
    const c = new AgentClient(reg, 'tokHN', { paperSize: 'A5', tray: 'tray-2' });
    await c.inPdf(Buffer.from('%PDF'), 'AI-INV_1-Khach', { printJobId: 'cmf1a2b3c4d5e6f7g8h9i0j1k', orgId: 'o', soHoaDon: 'INV/1', tenKhach: null });
    const job = reg.guiJob.mock.calls[0][1];
    expect(job.id).toMatch(/^cmf1a2b3c4d5e6f7g8h9i0j1k-\d{13}$/);
    expect(job.name).toBe(`AI-INV_1-Khach-${job.id}.pdf`);
    expect(reg.ghiNguCanh).toHaveBeenCalledWith(job.id, expect.objectContaining({ token: 'tokHN', printJobId: 'cmf1a2b3c4d5e6f7g8h9i0j1k' }));
    expect(tachPrintJobId(job.id)).toBe('cmf1a2b3c4d5e6f7g8h9i0j1k');
    expect(tachPrintJobId('1790251200000-7')).toBeNull();
    expect(tachPrintJobId('tokHN-1790251200000-7')).toBeNull();
  });
});

describe('id print_jobs dạng UUID — đúng dạng trên prod (Hermes uuid4, in lại tay gen_random_uuid)', () => {
  it('id job "<uuid>-<ms>" và tách ngược được; uuid sai dạng / id có token → null', async () => {
    const { tachPrintJobId, laIdPrintJob } = await import('../../../src/modules/ai/may-in/agent-client.js');
    const UUID = '3f2b9c4e-8a1d-4e6f-9b7a-0c5d2e1f4a3b';
    const reg = { guiJob: vi.fn(async () => ({ trangThai: 'da_in' })), ghiNguCanh: vi.fn() } as any;
    const c = new AgentClient(reg, 'tokHN', { paperSize: 'A5', tray: 'tray-2' });
    await c.inPdf(Buffer.from('%PDF'), 'AI-INV_2026_030045-Anh_Loc', { printJobId: UUID, orgId: 'o', soHoaDon: 'INV/2026/030045', tenKhach: 'Anh Lộc' });
    const job = reg.guiJob.mock.calls[0][1];
    expect(job.id).toMatch(new RegExp(`^${UUID}-\\d{13}$`));
    expect(job.name).toBe(`AI-INV_2026_030045-Anh_Loc-${job.id}.pdf`);
    expect(job.name.length).toBeLessThan(200); // app rơi về tên cũ khi > 200
    expect(tachPrintJobId(job.id)).toBe(UUID);
    expect(laIdPrintJob(UUID)).toBe(true);
    expect(tachPrintJobId('3f2b9c4e-8a1d-4e6f-9b7a-1790251200000')).toBeNull();
    expect(tachPrintJobId(`tokHN-${UUID}-1790251200000`)).toBeNull();
  });
});
