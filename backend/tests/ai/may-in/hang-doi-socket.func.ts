// SPDX-License-Identifier: AGPL-3.0-or-later
// Socket `/print-agent` — hàng đợi + huỷ từ app (hợp đồng hàng đợi/huỷ v5.1 §8.7) qua
// socket.io THẬT (server + client thật, DB giả): `hang_doi` trong cau-hinh; snapshot
// `hang-doi` {choIn, chuaXacNhan, capNhat} ngay sau cau-hinh, CHỈ job của máy đó; chỉ gửi
// khi đổi, ≤ 1 lần/giây; `lay-hang-doi`; `yeu-cau-huy` / `yeu-cau-bo-theo-doi` có ack đúng
// phạm vi máy; nguồn nhật ký = thong-tin-app.may; thay đổi trong tiến trình (huỷ REST, tạm
// giữ, claim của cron) đẩy snapshot cho đúng máy; kết quả trễ không đổi được job thì không
// coi là bằng chứng máy in chạy (§8.3); lệnh đã huỷ/bỏ không tính "lệnh in mới hơn" (§8.4).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  registerAgentWs,
  HO_TRO_APP,
  dieuKienLenhInMoiHon,
  type AgentWsDeps,
} from '../../../src/modules/ai/may-in/agent-ws.js';
import { AgentRegistry } from '../../../src/modules/ai/may-in/agent-registry.js';
import { AgentClient } from '../../../src/modules/ai/may-in/agent-client.js';
import { chayMotLuotIn, type PrismaHangDoiIn } from '../../../src/modules/ai/may-in/hang-doi-in.js';
import { taoDichVuHangDoi, type HangDoiIn, type KetQuaHuy } from '../../../src/modules/ai/may-in/huy-lenh-in.js';
import type { MucNhatKy } from '../../../src/modules/ai/may-in/nhat-ky.js';
import { khopWhere, printJobGia } from './prisma-gia-hang-doi.js';

const HN = 'tokHN_bi_mat_khong_duoc_lo_9x7';   // máy mặc định (env)
const HCM = 'tokHCM_bi_mat_rat_dai_1234567';
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Dong = Record<string, any>;
function job(id: string, them: Dong = {}): Dong {
  return {
    id, orgId: 'org1', hoaDonId: 7000, soHoaDon: `INV/${id}`, report: 'r', trangThai: 'cho_in', lanThu: 0, loiCuoi: null,
    ippJobId: null, agentToken: HN, conversationId: null,
    createdAt: new Date(Date.UTC(2026, 8, 25, 1, 0, Number(id.replace(/\D/g, '')) || 0)), updatedAt: new Date(), ...them,
  };
}

describe('socket /print-agent — hàng đợi + huỷ từ app (v5.1 §8.7)', () => {
  let httpServer: HttpServer;
  let io: IoServer;
  let port: number;
  let registry: AgentRegistry;
  let hang: Dong[];
  let pj: ReturnType<typeof printJobGia>;
  let nhatKy: MucNhatKy[];
  let dichVu: ReturnType<typeof taoDichVuHangDoi>;
  let capNhatJobTre: ReturnType<typeof vi.fn>;
  const clients: ClientSocket[] = [];

  async function dung(them: Partial<AgentWsDeps> = {}) {
    registerAgentWs(io, registry, {
      layMayInTheoToken: async (t) => ([HN, HCM].includes(t) ? { token: t } : null),
      ghiNhatKy: (m) => nhatKy.push(m),
      capNhatJobTre,
      layJobTheoId: async () => null,
      coLenhInMoiHon: async () => false,
      dichVuHangDoi: dichVu,
      orgMacDinh: () => 'org1',
      msGuiHangDoi: 60,
      msChoThongTin: 20,
      ...them,
    });
    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    const addr = httpServer.address();
    if (addr && typeof addr === 'object') port = addr.port;
  }

  beforeEach(() => {
    process.env.AI_MAY_IN_AGENT_TOKEN = HN;
    httpServer = createServer();
    io = new IoServer(httpServer);
    registry = new AgentRegistry({ msChoKetQua: 2000 });
    hang = [job('j1', { agentToken: HN }), job('j2', { agentToken: null }), job('j3', { agentToken: HCM }),
      job('j4', { agentToken: HCM, trangThai: 'khong_ro' })];
    pj = printJobGia(hang);
    nhatKy = [];
    capNhatJobTre = vi.fn(async () => 1);
    const prisma = {
      printJob: pj,
      printLog: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
      printAgent: {
        findMany: vi.fn(async (a: Dong) => [{ id: 'mayHN', ten: 'Máy HN', token: HN }, { id: 'mayHCM', ten: 'Máy HCM', token: HCM }]
          .filter((m) => khopWhere(m, a.where))),
        findFirst: vi.fn(async () => null),
      },
    };
    dichVu = taoDichVuHangDoi({ prisma: prisma as never, registry, ghiNhatKy: (m) => nhatKy.push(m), tokenMacDinh: HN });
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    clients.length = 0;
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    delete process.env.AI_MAY_IN_AGENT_TOKEN;
  });

  async function noi(token: string, may?: string) {
    const c = ioClient(`http://localhost:${port}/print-agent`, { auth: { token }, reconnection: false, transports: ['websocket'] });
    clients.push(c);
    const hangDoi: HangDoiIn[] = [];
    const cauHinh: unknown[] = [];
    c.on('hang-doi', (hd: HangDoiIn) => hangDoi.push(hd));
    c.on('cau-hinh', (x: unknown) => cauHinh.push(x));
    await new Promise<void>((r, j) => { c.on('connect', () => r()); c.on('connect_error', j); });
    if (may) c.emit('thong-tin-app', { phienBan: '0.2.6', may, mayIn: 'HP' });
    await cho(80);
    return { c, hangDoi, cauHinh };
  }

  const guiCoAck = <T>(c: ClientSocket, ev: string, payload: unknown, ms = 1500): Promise<T | 'het_gio'> =>
    new Promise((r) => {
      const hen = setTimeout(() => r('het_gio'), ms);
      c.emit(ev, payload, (kq: T) => {
        clearTimeout(hen);
        r(kq);
      });
    });

  it('cau-hinh quảng bá `hang_doi`; ngay sau đó `hang-doi` CHỈ job của máy đó, đúng dạng, không token', async () => {
    await dung();
    const hcm = await noi(HCM);
    expect(HO_TRO_APP).toContain('hang_doi');
    expect(hcm.cauHinh[0]).toEqual({ hoTro: [...HO_TRO_APP] });
    expect(hcm.hangDoi).toHaveLength(1);
    const hd = hcm.hangDoi[0];
    expect(Object.keys(hd).sort()).toEqual(['capNhat', 'choIn', 'chuaXacNhan']);
    expect(hd.choIn.map((m) => [m.id, m.nhom, m.huy, m.mayInTen])).toEqual([['j3', 'cho_in', 'chac_chan', 'Máy HCM']]);
    expect(hd.chuaXacNhan.map((m) => [m.id, m.nhom, m.huy])).toEqual([['j4', 'chua_xac_nhan', 'khong']]);
    expect(JSON.stringify(hd)).not.toContain(HCM);
    // Máy mặc định (env) thấy cả job agent_token NULL.
    const hn = await noi(HN);
    expect(hn.hangDoi[0].choIn.map((m) => m.id)).toEqual(['j1', 'j2']);
  });

  it('chỉ gửi khi ĐỔI: báo đổi mà nội dung như cũ → không gửi; `lay-hang-doi` → gửi lại ngay kể cả không đổi', async () => {
    await dung();
    const hcm = await noi(HCM);
    registry.baoDoiHangDoi(HCM);
    registry.baoDoiHangDoiTatCa(); // nhịp cron
    await cho(150);
    expect(hcm.hangDoi).toHaveLength(1);
    hcm.c.emit('lay-hang-doi');
    await cho(120);
    expect(hcm.hangDoi).toHaveLength(2);
    expect(hcm.hangDoi[1].choIn).toEqual(hcm.hangDoi[0].choIn);
  });

  it('yeu-cau-huy (ack) job của chính máy → KetQuaHuy ok; DB da_huy; nguồn = thong-tin-app.may; snapshot mới không còn job', async () => {
    await dung();
    const hcm = await noi(HCM, 'PC-SHOP-HCM');
    const kq = await guiCoAck<KetQuaHuy>(hcm.c, 'yeu-cau-huy', { printJobId: 'j3' });
    expect(kq).toEqual({ id: 'j3', soHoaDon: 'INV/j3', ok: true, trangThaiMoi: 'da_huy', cach: 'chua_gui', noiDung: 'Đã huỷ — hoá đơn chắc chắn không in' });
    expect(hang.find((j) => j.id === 'j3')!.trangThai).toBe('da_huy');
    const dong = nhatKy.filter((m) => m.loai === 'da_huy');
    expect(dong).toHaveLength(1);
    expect(dong[0].noiDung).toBe('Đã huỷ lệnh in hoá đơn INV/j3 — chắc chắn không in (nguồn: app máy in (PC-SHOP-HCM))');
    await cho(150);
    expect(hcm.hangDoi.at(-1)!.choIn).toEqual([]);
  });

  it('yeu-cau-huy job của MÁY KHÁC → ack KHONG_TIM_THAY, job đó giữ cho_in', async () => {
    await dung();
    const hcm = await noi(HCM, 'PC-SHOP-HCM');
    for (const id of ['j1', 'j2']) {
      const kq = await guiCoAck<KetQuaHuy>(hcm.c, 'yeu-cau-huy', { printJobId: id });
      expect(kq).toMatchObject({ id, ok: false, loi: 'KHONG_TIM_THAY', trangThaiMoi: null });
    }
    expect(hang.filter((j) => ['j1', 'j2'].includes(j.id)).map((j) => j.trangThai)).toEqual(['cho_in', 'cho_in']);
  });

  it('job agent_token NULL của org KHÁC org mặc định env → máy mặc định không thấy, không huỷ được', async () => {
    hang.push(job('j7', { agentToken: null, orgId: 'org2' }));
    await dung();
    const hn = await noi(HN, 'PC-SHOP-HN');
    expect(hn.hangDoi[0].choIn.map((m) => m.id)).toEqual(['j1', 'j2']);
    const kq = await guiCoAck<KetQuaHuy>(hn.c, 'yeu-cau-huy', { printJobId: 'j7' });
    expect(kq).toMatchObject({ ok: false, loi: 'KHONG_TIM_THAY' });
    expect(hang.find((j) => j.id === 'j7')!.trangThai).toBe('cho_in');
  });

  it('máy mặc định (token env) huỷ được job agent_token NULL; payload dạng mảng [obj] (rust_socketio) cũng nhận', async () => {
    await dung();
    const hn = await noi(HN, 'PC-SHOP-HN');
    const kq = await guiCoAck<KetQuaHuy>(hn.c, 'yeu-cau-huy', [{ printJobId: 'j2' }]);
    expect(kq).toMatchObject({ id: 'j2', ok: true, cach: 'chua_gui' });
  });

  it('thiếu printJobId → ack KHONG_TIM_THAY "Thiếu mã…"; id mang token bị che trước khi dùng (không lọt vào nhật ký)', async () => {
    await dung();
    const hcm = await noi(HCM, 'PC-SHOP-HCM');
    expect(await guiCoAck<KetQuaHuy>(hcm.c, 'yeu-cau-huy', {})).toMatchObject({ ok: false, loi: 'KHONG_TIM_THAY', noiDung: 'Thiếu mã lệnh in (printJobId).' });
    const kq = await guiCoAck<KetQuaHuy>(hcm.c, 'yeu-cau-huy', { printJobId: `x${HCM}` });
    expect(kq).toMatchObject({ ok: false, loi: 'KHONG_TIM_THAY' });
    // `agentToken` của MucNhatKy chỉ để tra máy — nhat-ky.ts không bao giờ lưu nó.
    expect(JSON.stringify([kq, nhatKy.map((m) => [m.noiDung, m.chiTiet])])).not.toContain(HCM);
    expect(nhatKy.find((m) => m.loai === 'huy_that_bai')!.noiDung).toContain('mã x…');
  });

  it('lỗi DB khi huỷ → KHÔNG ack (app hết giờ → "Chưa rõ — xem lại hàng đợi"), không bịa kết quả', async () => {
    await dung();
    const hcm = await noi(HCM);
    pj.updateMany.mockRejectedValueOnce(new Error('db down'));
    expect(await guiCoAck(hcm.c, 'yeu-cau-huy', { printJobId: 'j3' }, 400)).toBe('het_gio');
    expect(hang.find((j) => j.id === 'j3')!.trangThai).toBe('cho_in');
  });

  it('yeu-cau-bo-theo-doi (ack) — CHỈ khong_ro của chính máy: ok → bo_qua; cho_in → ok:false; máy khác → ok:false', async () => {
    await dung();
    const hcm = await noi(HCM, 'PC-SHOP-HCM');
    expect(await guiCoAck(hcm.c, 'yeu-cau-bo-theo-doi', { printJobId: 'j4' }))
      .toEqual({ id: 'j4', ok: true, noiDung: 'Đã bỏ khỏi hàng đợi — hệ thống KHÔNG biết hoá đơn đã in hay chưa' });
    expect(hang.find((j) => j.id === 'j4')!.trangThai).toBe('bo_qua');
    expect(await guiCoAck(hcm.c, 'yeu-cau-bo-theo-doi', { printJobId: 'j3' })).toMatchObject({ id: 'j3', ok: false });
    hang.push(job('j9', { agentToken: HN, trangThai: 'khong_ro' }));
    expect(await guiCoAck(hcm.c, 'yeu-cau-bo-theo-doi', { printJobId: 'j9' })).toMatchObject({ id: 'j9', ok: false });
    expect(nhatKy.filter((m) => m.loai === 'bo_theo_doi')).toHaveLength(1);
    expect(nhatKy.find((m) => m.loai === 'bo_theo_doi')!.noiDung).toContain('(nguồn: app máy in (PC-SHOP-HCM))');
  });

  it('huỷ từ ZaloCRM (REST, cùng registry) → CHỈ app của máy liên quan nhận snapshot mới', async () => {
    await dung();
    const hn = await noi(HN);
    const hcm = await noi(HCM);
    await dichVu.huyLenhIn({ loai: 'org', orgId: 'org1' }, ['j1'], { loai: 'crm', ten: 'Chị Hoa' });
    await cho(150);
    expect(hn.hangDoi).toHaveLength(2);
    expect(hn.hangDoi[1].choIn.map((m) => m.id)).toEqual(['j2']);
    expect(hcm.hangDoi).toHaveLength(1);
  });

  it('tạm giữ / tiếp tục (cầu dao) → snapshot có `tamGiu` + lý do; đóng cầu dao → hết tạm giữ', async () => {
    await dung();
    const hcm = await noi(HCM);
    registry.ngatCauDao(HCM, 'het_giay', 'Hết giấy');
    await cho(150);
    const giu = hcm.hangDoi.at(-1)!.choIn[0];
    expect(giu.tamGiu).toBe(true);
    expect(giu.lyDo).toMatch(/^Tạm giữ — máy in Hết giấy \(từ \d\d:\d\d\)$/);
    registry.dongCauDao(HCM);
    await cho(150);
    expect(hcm.hangDoi.at(-1)!.choIn[0].tamGiu).toBe(false);
  });

  it('≤ 1 lần/giây/socket: 10 thay đổi dồn trong 100 ms → gộp (không quá 2 lần gửi), lần cuối đúng nội dung cuối', async () => {
    await dung({ msGuiHangDoi: 400 });
    const hcm = await noi(HCM);
    await cho(400);
    const truoc = hcm.hangDoi.length;
    for (let k = 0; k < 10; k++) {
      hang.push(job(`n${k + 10}`, { agentToken: HCM }));
      registry.baoDoiHangDoi(HCM);
      await cho(10);
    }
    await cho(600);
    const moi = hcm.hangDoi.slice(truoc);
    expect(moi.length).toBeGreaterThanOrEqual(1);
    expect(moi.length).toBeLessThanOrEqual(2);
    expect(moi.at(-1)!.choIn).toHaveLength(11);
  });

  it('cron: claim + kết quả qua AgentClient thật → app nhận snapshot "đang gửi" rồi snapshot rỗng', async () => {
    await dung();
    hang.splice(0, hang.length, job('j5', { agentToken: HCM }));
    const hcm = await noi(HCM);
    hcm.c.on('job', (msg: any) => setTimeout(() => hcm.c.emit('ket-qua', { jobId: msg.job.id, trangThai: 'da_in' }), 150));
    await chayMotLuotIn({
      prisma: { printJob: pj } as unknown as PrismaHangDoiIn,
      chonClient: (t) => new AgentClient(registry, t ?? HN, { paperSize: 'A5', tray: 'tray-2' }),
      taiPdf: async () => Buffer.from('%PDF-1.4'),
      baoDoiHangDoi: (t) => registry.baoDoiHangDoi(t ?? HN),
    });
    await cho(200);
    expect(hang[0].trangThai).toBe('da_in');
    const trangThai = hcm.hangDoi.map((hd) => hd.choIn.map((m) => m.trangThai).join(','));
    expect(trangThai[0]).toBe('cho_in');
    expect(trangThai).toContain('dang_gui');
    expect(trangThai.at(-1)).toBe('');
  });

  it('§8.3: kết quả TRỄ `da_in` không đổi được job (job đã da_huy/bo_qua) → KHÔNG đóng cầu dao, KHÔNG xoá chip', async () => {
    await dung();
    capNhatJobTre.mockResolvedValue(0);
    const hcm = await noi(HCM);
    hcm.c.emit('trang-thai-may-in', { trangThai: 'het_giay', mayIn: 'HP' });
    await cho(60);
    registry.ngatCauDao(HCM, 'het_giay', 'Hết giấy');
    registry.ghiNguCanh('jTre', { printJobId: 'j3', orgId: 'org1', soHoaDon: 'INV/j3', tenKhach: null, token: HCM });
    hcm.c.emit('ket-qua', { jobId: 'jTre', trangThai: 'da_in' });
    await cho(250);
    expect(registry.xetCauDao(HCM)).toBe('giu');
    expect(registry.layTinhTrang(HCM)?.ma).toBe('het_giay');
    expect(nhatKy.map((m) => m.loai)).not.toContain('tiep_tuc_in');
  });

  it('kết quả trễ `da_in` ĐỔI được job (khong_ro → da_in) → vẫn đóng cầu dao như trước + đẩy snapshot', async () => {
    await dung();
    const hcm = await noi(HCM);
    registry.ngatCauDao(HCM, 'het_gio_cho', 'app im');
    await cho(150);
    const truoc = hcm.hangDoi.length;
    registry.ghiNguCanh('jTre2', { printJobId: 'j4', orgId: 'org1', soHoaDon: 'INV/j4', tenKhach: null, token: HCM });
    hang.find((j) => j.id === 'j4')!.trangThai = 'da_in'; // capNhatJobTre giả trả 1
    hcm.c.emit('ket-qua', { jobId: 'jTre2', trangThai: 'da_in' });
    await cho(200);
    expect(registry.xetCauDao(HCM)).toBe('gui');
    expect(nhatKy.map((m) => m.loai)).toContain('tiep_tuc_in');
    expect(hcm.hangDoi.length).toBeGreaterThan(truoc);
  });
});

describe('§8.4 — lệnh da_huy / bo_qua KHÔNG tính "lệnh in mới hơn"', () => {
  it('dieuKienLenhInMoiHon loại loi, da_huy, bo_qua; cho_in / da_in / khong_ro mới hơn vẫn tính', () => {
    const cu = { orgId: 'o', hoaDonId: 7, report: 'r', createdAt: new Date('2026-09-25T01:00:00Z') };
    const w = dieuKienLenhInMoiHon('cu', cu);
    const moi = (trangThai: string) => ({ id: `m_${trangThai}`, orgId: 'o', hoaDonId: 7, report: 'r', createdAt: new Date('2026-09-25T02:00:00Z'), trangThai });
    const tinh = ['cho_in', 'dang_gui', 'da_gui', 'da_in', 'khong_ro', 'loi', 'da_huy', 'bo_qua'].filter((t) => khopWhere(moi(t), w));
    expect(tinh).toEqual(['cho_in', 'dang_gui', 'da_gui', 'da_in', 'khong_ro']);
    expect(khopWhere({ ...moi('cho_in'), createdAt: new Date('2026-09-25T00:00:00Z') }, w)).toBe(false);
  });
});
