// SPDX-License-Identifier: AGPL-3.0-or-later
// Khoá các sửa của vòng giám sát 1 (25/09) — mỗi describe ghi mã phát hiện:
//   V1  kết quả về qua kết nối MỚI của cùng máy vẫn khớp job đang chờ
//   V2  trangThai lạ → khong_ro (không bao giờ thành "thử lại")
//   V3  token máy in không lọt qua chữ app gửi lên; id job không chứa token
//   V4  cầu dao theo máy: máy lỗi thì giữ hoá đơn ở cho_in, máy hết lỗi thì in tiếp;
//       lỗi do MÁY IN không tiêu lượt thử; job dang_gui mồ côi → khong_ro
//   N   chip tình trạng không kẹt; mất kết nối lâu mới cảnh báo; route nhật ký.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { registerAgentWs } from '../../../src/modules/ai/may-in/agent-ws.js';
import { AgentRegistry, AgentRotGiuaChung, type JobIn as JobApp } from '../../../src/modules/ai/may-in/agent-registry.js';
import {
  chayMotLuotIn,
  donJobMoCoi,
  MS_JOB_MO_COI,
  type PrismaHangDoiIn,
  type JobIn,
  type SuKienHangDoi,
} from '../../../src/modules/ai/may-in/hang-doi-in.js';
import { LoiIpp, LoiKhongRo } from '../../../src/modules/ai/may-in/ipp-client.js';
import { taoGhiNhatKy, type MucNhatKy, type PrismaNhatKy } from '../../../src/modules/ai/may-in/nhat-ky.js';
import { traNhatKy } from '../../../src/modules/ai/may-in/print-agent-routes.js';

const TOKEN = 'tokHN_bi_mat_khong_duoc_lo_9x7';
const jobApp = (id: string): JobApp => ({ id, name: `AI-X-${id}.pdf`, pdfBase64: 'A', paperSize: 'A5', tray: 'tray-2', copies: 1 });
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('V1 — registry khoá job đang chờ theo MÁY, không theo kết nối', () => {
  it('app nối lại bằng kết nối Y khi X chưa rớt → kết quả qua Y khớp job gửi qua X', async () => {
    const reg = new AgentRegistry({ msChoKetQua: 5_000 });
    reg.dangKy(TOKEN, () => {}); // X
    const p = reg.guiJob(TOKEN, jobApp('j1'));
    reg.dangKy(TOKEN, () => {}); // Y thay X trong bảng
    expect(reg.nhanKetQua(TOKEN, 'j1', { trangThai: 'da_in' })).toBe(true);
    await expect(p).resolves.toEqual({ trangThai: 'da_in' });
  });

  it('X rớt hẳn SAU khi Y đã nối → job gửi qua X vẫn chờ (không thành khong_ro oan)', async () => {
    const reg = new AgentRegistry({ msChoKetQua: 5_000 });
    const huyX = reg.dangKy(TOKEN, () => {});
    const p = reg.guiJob(TOKEN, jobApp('j2'));
    reg.dangKy(TOKEN, () => {});
    huyX();
    expect(reg.nhanKetQua(TOKEN, 'j2', { trangThai: 'da_in' })).toBe(true);
    await expect(p).resolves.toEqual({ trangThai: 'da_in' });
  });

  it('kết nối CUỐI CÙNG rớt → reject AgentRotGiuaChung như cũ', async () => {
    const reg = new AgentRegistry({ msChoKetQua: 5_000 });
    const huy = reg.dangKy(TOKEN, () => {});
    const p = reg.guiJob(TOKEN, jobApp('j3'));
    huy();
    await expect(p).rejects.toBeInstanceOf(AgentRotGiuaChung);
  });

  it('kết quả của máy KHÁC không khớp được job của máy này', async () => {
    const reg = new AgentRegistry({ msChoKetQua: 5_000 });
    reg.dangKy(TOKEN, () => {});
    void reg.guiJob(TOKEN, jobApp('j4')).catch(() => {});
    expect(reg.nhanKetQua('tokKhac_12345678', 'j4', { trangThai: 'da_in' })).toBe(false);
  });
});

describe('vòng 2 — registry giữ TẬP kết nối mỗi máy', () => {
  it('kết nối "ma" đăng ký SAU rồi tự ngắt → kết nối thật vẫn nhận job (bản một ô: máy im in)', async () => {
    const reg = new AgentRegistry({ msChoKetQua: 5_000 });
    const nhanThat: unknown[] = [];
    reg.dangKy(TOKEN, (m) => nhanThat.push(m));           // B — kết nối thật
    const huyMa = reg.dangKy(TOKEN, () => {});             // A — ma, nối sau
    huyMa();                                               // A tự ngắt
    expect(reg.coAgent(TOKEN)).toBe(true);
    void reg.guiJob(TOKEN, jobApp('jB')).catch(() => {});
    expect(nhanThat).toHaveLength(1);
  });
});

describe('V4 — cầu dao trong registry', () => {
  it('ngắt → giữ; hết 3 phút → cho ĐÚNG MỘT job đi thử; đóng → gửi bình thường', () => {
    let bayGio = 1_000_000;
    const reg = new AgentRegistry({ bayGio: () => bayGio });
    expect(reg.xetCauDao(TOKEN)).toBe('gui');
    expect(reg.ngatCauDao(TOKEN, 'het_giay', 'Hết giấy').moi).toBe(true);
    expect(reg.ngatCauDao(TOKEN, 'het_giay', 'Hết giấy').moi).toBe(false);
    expect(reg.xetCauDao(TOKEN)).toBe('giu');
    expect(reg.dangGiu()).toEqual([TOKEN]);
    bayGio += 3 * 60_000;
    expect(reg.dangGiu()).toEqual([]); // tới lượt thử → không loại khỏi truy vấn
    expect(reg.xetCauDao(TOKEN)).toBe('thu');
    // Hỏi KHÔNG tiêu lượt (vòng 2): chỉ khi job thử thật sự được gửi mới tính.
    expect(reg.xetCauDao(TOKEN)).toBe('thu');
    reg.daGuiThu(TOKEN);
    expect(reg.xetCauDao(TOKEN)).toBe('giu');
    expect(reg.dongCauDao(TOKEN)?.ma).toBe('het_giay');
    expect(reg.xetCauDao(TOKEN)).toBe('gui');
  });

  it('báo "bình thường" tới ngay sau lúc ngắt (< 5 s, gói cũ) KHÔNG đóng; sau đó thì đóng', () => {
    let bayGio = 1_000_000;
    const reg = new AgentRegistry({ bayGio: () => bayGio });
    reg.ngatCauDao(TOKEN, 'ket_giay', 'Kẹt giấy');
    bayGio += 1_000;
    expect(reg.dongCauDaoTheoTrangThai(TOKEN)).toBeNull();
    expect(reg.xetCauDao(TOKEN)).toBe('giu');
    bayGio += 10_000;
    expect(reg.dongCauDaoTheoTrangThai(TOKEN)?.ma).toBe('ket_giay');
    expect(reg.xetCauDao(TOKEN)).toBe('gui');
  });
});

describe('agent-ws — V2, V3, chip tình trạng, cầu dao, mất kết nối lâu (socket.io THẬT)', () => {
  let httpServer: HttpServer;
  let io: IoServer;
  let registry: AgentRegistry;
  let port: number;
  let nhatKy: MucNhatKy[];
  let capNhatJobTre: ReturnType<typeof vi.fn>;
  let bayGio: number;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    process.env.AI_MAY_IN_AGENT_TOKEN = 'token-env-khac';
    httpServer = createServer();
    io = new IoServer(httpServer);
    bayGio = 1_000_000;
    registry = new AgentRegistry({ msChoKetQua: 300, bayGio: () => bayGio });
    // Mảng RIÊNG mỗi test: hẹn giờ "mất kết nối lâu" của test trước (sinh ra
    // khi afterEach ngắt kết nối) không được ghi lẫn sang test này.
    const cuaTestNay: MucNhatKy[] = [];
    nhatKy = cuaTestNay;
    capNhatJobTre = vi.fn(async () => 1);
    registerAgentWs(io, registry, {
      layMayInTheoToken: async (t) => (t === TOKEN ? { token: TOKEN } : null),
      ghiNhatKy: (m) => cuaTestNay.push(m),
      capNhatJobTre,
      layJobTheoId: async () => null,
      coLenhInMoiHon: async () => false,
      msChoThongTin: 50,
      msOfflineLau: 150,
      msThuLaiTre: 60,
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

  it('V2: trangThai lạ/thiếu → khong_ro (không bao giờ "loi" = gửi lại)', async () => {
    const c = await noi();
    c.on('job', (msg: any) => c.emit('ket-qua', { jobId: msg.job.id, trangThai: 'printed_ok' }));
    await expect(registry.guiJob(TOKEN, jobApp('jLa'))).resolves.toMatchObject({ trangThai: 'khong_ro' });
  });

  it('V3: token trong loiCuoi / chiTiet / mayIn app gửi lên bị che trước khi dùng', async () => {
    const c = await noi();
    c.on('job', (msg: any) => c.emit('ket-qua', {
      jobId: msg.job.id, trangThai: 'loi', loai: 'het_giay',
      loiCuoi: `SumatraPDF: không mở được C:\\Temp\\AI-INV-${TOKEN}-17-4.pdf`,
    }));
    const kq = await registry.guiJob(TOKEN, jobApp('jTok'));
    expect(kq.loiCuoi).not.toContain(TOKEN);
    expect(kq.loiCuoi).toContain('AI-INV-…-17-4.pdf');
    c.emit('su-co', { jobId: 'jTok', loai: 'ket_giay', chiTiet: `job ${TOKEN}-1`, mayIn: `HP ${TOKEN}` });
    await cho(60);
    expect(JSON.stringify(nhatKy)).not.toMatch(new RegExp(`${TOKEN}(?!["])`)); // agentToken chỉ để tra, nhat-ky không lưu
    const dong = nhatKy.find((m) => m.loai === 'ket_giay')!;
    expect(dong.noiDung).not.toContain(TOKEN);
    expect(JSON.stringify(dong.chiTiet)).not.toContain(TOKEN);
  });

  it('sự cố cấp JOB (PDF hỏng) không dán nhãn lên máy in; cấp MÁY (hết giấy) thì có', async () => {
    const c = await noi();
    c.emit('su-co', { jobId: 'a', loai: 'loi_pdf' });
    await cho(40);
    expect(registry.layTinhTrang(TOKEN)).toBeNull();
    c.emit('su-co', { jobId: 'b', loai: 'het_giay' });
    await cho(40);
    expect(registry.layTinhTrang(TOKEN)?.ma).toBe('het_giay');
  });

  it('app in được một hoá đơn → chip "Hết giấy" về bình thường + đóng cầu dao + nhật ký tiep_tuc_in', async () => {
    const c = await noi();
    c.emit('su-co', { jobId: 'b', loai: 'het_giay' });
    await cho(40);
    registry.ngatCauDao(TOKEN, 'het_giay', 'Hết giấy');
    registry.ghiNguCanh('jOk', { printJobId: 'pjOk', orgId: 'org1', soHoaDon: 'INV/7', tenKhach: null, token: TOKEN });
    c.on('job', (msg: any) => c.emit('ket-qua', { jobId: msg.job.id, trangThai: 'da_in' }));
    await registry.guiJob(TOKEN, jobApp('jOk'));
    await cho(20);
    expect(registry.layTinhTrang(TOKEN)?.ma).toBe('binh_thuong');
    expect(registry.xetCauDao(TOKEN)).toBe('gui');
    const loai = nhatKy.map((m) => m.loai);
    expect(loai).toContain('binh_thuong');
    expect(nhatKy.find((m) => m.loai === 'tiep_tuc_in')!.noiDung).toBe('Máy in hoạt động lại (đã in hoá đơn INV/7) — tiếp tục in các hoá đơn đang chờ');
  });

  it('sự cố CẤP MÁY: "bình thường" tới SAU lúc ngắt → đóng cầu dao; su-co "binh_thuong" xử như trạng thái', async () => {
    const c = await noi();
    c.emit('trang-thai-may-in', { trangThai: 'het_giay', mayIn: 'HP' });
    await cho(40);
    registry.ngatCauDao(TOKEN, 'het_giay', 'Hết giấy');
    bayGio += 10_000;
    c.emit('su-co', { loai: 'binh_thuong', mayIn: 'HP' });
    await cho(40);
    expect(registry.xetCauDao(TOKEN)).toBe('gui');
    expect(nhatKy.map((m) => m.loai)).toContain('tiep_tuc_in');
  });

  it('V1 vòng 2: sự cố chỉ JOB thấy (máy mạng) — "bình thường" cấp máy KHÔNG xoá chip, KHÔNG đóng cầu dao, KHÔNG ghi "hết lỗi"', async () => {
    const c = await noi();
    c.emit('su-co', { jobId: 'j', loai: 'het_giay', mayIn: 'HP' });
    await cho(40);
    registry.ngatCauDao(TOKEN, 'het_giay', 'Hết giấy');
    bayGio += 20_000;
    for (let i = 0; i < 3; i++) {
      c.emit('trang-thai-may-in', { trangThai: 'binh_thuong', mayIn: 'HP' });
      await cho(30);
    }
    expect(registry.layTinhTrang(TOKEN)?.ma).toBe('het_giay');
    expect(registry.xetCauDao(TOKEN)).toBe('giu');
    expect(nhatKy.map((m) => m.loai)).not.toContain('tiep_tuc_in');
    expect(nhatKy.map((m) => m.loai)).not.toContain('binh_thuong');
  });

  it('V3 vòng 2: app của máy KHÁC gửi kết quả mang id job của máy này → không đổi print_jobs, không lộ hoá đơn', async () => {
    const c = await noi();
    registry.ghiNguCanh('jCuaMayKhac', { printJobId: 'pjX', orgId: 'org2', soHoaDon: 'INV/X', tenKhach: 'Khách org2', token: 'tokHCM_khac_12345678' });
    c.emit('ket-qua', { jobId: 'jCuaMayKhac', trangThai: 'da_in' });
    c.emit('su-co', { jobId: 'jCuaMayKhac', loai: 'ket_giay' });
    await cho(150);
    expect(capNhatJobTre).not.toHaveBeenCalled();
    expect(JSON.stringify(nhatKy)).not.toContain('INV/X');
    expect(JSON.stringify(nhatKy)).not.toContain('Khách org2');
  });

  it('V2 vòng 2: `loi` TRỄ do máy in → job về cho_in KHÔNG tăng lượt + ngắt cầu dao; `loi` khác → cho_in tăng lượt', async () => {
    const c = await noi();
    registry.ghiNguCanh('jL1', { printJobId: 'pjL1', orgId: 'org1', soHoaDon: 'INV/L1', tenKhach: null, token: TOKEN });
    registry.ghiNguCanh('jL2', { printJobId: 'pjL2', orgId: 'org1', soHoaDon: 'INV/L2', tenKhach: null, token: TOKEN });
    c.emit('ket-qua', { jobId: 'jL1', trangThai: 'loi', loai: 'het_giay' });
    c.emit('ket-qua', { jobId: 'jL2', trangThai: 'loi', loai: 'loi_pdf' });
    await cho(80);
    expect(capNhatJobTre).toHaveBeenCalledWith('pjL1', { trangThai: 'thu_lai', tangLanThu: false }, 'Hết giấy', { choPhepDangGui: false });
    expect(capNhatJobTre).toHaveBeenCalledWith('pjL2', { trangThai: 'thu_lai', tangLanThu: true }, 'File PDF hỏng', { choPhepDangGui: false });
    expect(registry.xetCauDao(TOKEN)).toBe('giu');
    expect(nhatKy.filter((m) => m.loai === 'tam_giu')).toHaveLength(1);
  });

  it('backend khởi động lại (mất ngữ cảnh bộ nhớ): kết quả trễ tra DB theo id "<printJobId>-<ms>", CHỈ nhận khi đúng máy; job dang_gui mồ côi nhận luôn', async () => {
    const c = await noi();
    const layJob = async (id: string) => ({
      // updatedAt TRƯỚC lúc tiến trình khởi động = mồ côi của tiến trình trước.
      cmf0000000000000000000001: { id, orgId: 'org1', soHoaDon: 'INV/DB1', agentToken: TOKEN, updatedAt: new Date('2026-09-01T00:00:00Z') },
      cmf0000000000000000000002: { id, orgId: 'org2', soHoaDon: 'INV/DB2', agentToken: 'tokHCM_khac_12345678', updatedAt: new Date('2026-09-01T00:00:00Z') },
    } as Record<string, any>)[id] ?? null;
    // registerAgentWs của beforeEach không có layJobTheoId → dựng server thứ hai trên cùng io là không được;
    // thay vào đó gọi thẳng qua namespace mới với deps đủ.
    const io2 = new IoServer(httpServer, { path: '/sock2' });
    const nk2: MucNhatKy[] = [];
    const cap2 = vi.fn(async () => 1);
    registerAgentWs(io2, new AgentRegistry(), {
      layMayInTheoToken: async (t) => (t === TOKEN ? { token: TOKEN } : null),
      ghiNhatKy: (m) => nk2.push(m), capNhatJobTre: cap2, layJobTheoId: layJob, coLenhInMoiHon: async () => false,
      msChoThongTin: 20, msThuLaiTre: 10,
    });
    const c2 = ioClient(`http://localhost:${port}/print-agent`, { path: '/sock2', auth: { token: TOKEN }, reconnection: false, transports: ['websocket'] });
    clients.push(c2);
    await new Promise<void>((r, j) => { c2.on('connect', () => r()); c2.on('connect_error', j); });
    c2.emit('ket-qua', { jobId: 'cmf0000000000000000000001-1790251200000', trangThai: 'da_in' });
    c2.emit('ket-qua', { jobId: 'cmf0000000000000000000002-1790251200000', trangThai: 'da_in' });
    await cho(120);
    expect(cap2).toHaveBeenCalledTimes(1);
    expect(cap2).toHaveBeenCalledWith('cmf0000000000000000000001', { trangThai: 'da_in' }, null, { choPhepDangGui: true });
    expect(nk2.find((m) => m.loai === 'ket_qua_tre' && m.soHoaDon === 'INV/DB1')).toBeTruthy();
    expect(JSON.stringify(nk2)).not.toContain('INV/DB2');
    io2.close();
    void c;
  });

  it('khong_ro kèm conTrongHangDoi → registry nhận nguyên cờ', async () => {
    const c = await noi();
    c.on('job', (msg: any) => c.emit('ket-qua', { jobId: msg.job.id, trangThai: 'khong_ro', loai: 'het_giay', conTrongHangDoi: false }));
    await expect(registry.guiJob(TOKEN, jobApp('jCon'))).resolves.toEqual({ trangThai: 'khong_ro', loai: 'het_giay', conTrongHangDoi: false });
  });

  it('token vắt qua mép cắt 500 ký tự vẫn bị che TRỌN (che trước, cắt sau)', async () => {
    const c = await noi();
    c.on('job', (msg: any) => c.emit('ket-qua', { jobId: msg.job.id, trangThai: 'loi', loiCuoi: `${'x'.repeat(480)}${TOKEN}` }));
    const kq = await registry.guiJob(TOKEN, jobApp('jMep'));
    expect(kq.loiCuoi).not.toContain(TOKEN.slice(0, 15));
  });

  it('kết quả trễ tới lúc hàng đợi chưa kịp ghi khong_ro → thử cập nhật lại một lần', async () => {
    const c = await noi();
    capNhatJobTre.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    registry.ghiNguCanh('jT', { printJobId: 'pjT', orgId: 'org1', soHoaDon: 'INV/8', tenKhach: null, token: TOKEN });
    c.emit('ket-qua', { jobId: 'jT', trangThai: 'da_in' });
    await cho(150);
    expect(capNhatJobTre).toHaveBeenCalledTimes(2);
    expect(nhatKy.find((m) => m.loai === 'ket_qua_tre')!.noiDung).toContain('(đã cập nhật trạng thái job)');
  });

  it('mất kết nối: dòng app_mat_ket_noi mức thông tin; quá hạn mới cảnh báo app_offline_lau; nối lại ghi "sau N phút"', async () => {
    const c = await noi();
    await cho(70);
    c.disconnect();
    await cho(40);
    const mat = nhatKy.find((m) => m.loai === 'app_mat_ket_noi')!;
    expect(mat.mucDo ?? 'thong_tin').toBe('thong_tin');
    expect(nhatKy.map((m) => m.loai)).not.toContain('app_offline_lau');
    await cho(160);
    expect(nhatKy.map((m) => m.loai)).toContain('app_offline_lau');
    nhatKy.length = 0;
    await noi();
    await cho(80);
    expect(nhatKy.find((m) => m.loai === 'app_ket_noi')!.noiDung).toMatch(/— sau \d+ phút mất kết nối$/);
  });

  it('rớt rồi nối lại NGAY (chập chờn 13.6) → không có cảnh báo app_offline_lau', async () => {
    const c = await noi();
    c.disconnect();
    await cho(20);
    await noi();
    await cho(200);
    expect(nhatKy.map((m) => m.loai)).not.toContain('app_offline_lau');
  });
});

// ── Hàng đợi ────────────────────────────────────────────────────────────────

function prismaGia(hangSan: Array<Partial<JobIn>>) {
  let dem = 0;
  const hang: JobIn[] = hangSan.map((h) => ({
    id: h.id ?? `pj${++dem}`, orgId: 'org1', conversationId: null, hoaDonId: 7001 + dem,
    soHoaDon: `INV/2026/0300${40 + dem}`, report: 'incokit_pos.report_invoice_document_kiotviet',
    trangThai: 'cho_in', lanThu: 0, ippJobId: null, loiCuoi: null, agentToken: TOKEN, ...h,
  } as JobIn));
  const prisma: PrismaHangDoiIn = {
    printJob: {
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async ({ where }) => {
        const w = where as Record<string, any>;
        return hang.filter((j) => {
          if (w?.OR) return j.trangThai === 'cho_in';
          if (w?.updatedAt) return j.trangThai === w.trangThai && j.ippJobId === null
            && (j as any).updatedAt < w.updatedAt.lt;
          return true;
        }).map((j) => ({ ...j }));
      }),
      update: vi.fn(async ({ where, data }) => Object.assign(hang.find((x) => x.id === where.id)!, data)),
    },
  };
  return { prisma, hang };
}

function cauDaoThat(reg: AgentRegistry) {
  return {
    xet: (t: string | null) => reg.xetCauDao(t ?? TOKEN),
    ngat: (t: string | null, ma: string | null, lyDo: string) => reg.ngatCauDao(t ?? TOKEN, ma, lyDo),
    daThu: (t: string | null) => reg.daGuiThu(t ?? TOKEN),
    dangGiu: () => reg.dangGiu(),
  };
}

const taiPdf = async () => Buffer.from('%PDF-1.4');

describe('V4 — cầu dao trong hàng đợi', () => {
  it('job đầu hết giấy → tạm giữ các job sau của máy đó (cho_in, không tiêu lượt, không gửi), ghi tam_giu MỘT lần', async () => {
    const reg = new AgentRegistry();
    const { prisma, hang } = prismaGia([{}, {}, {}]);
    const inPdf = vi.fn(async () => { throw new LoiIpp('Hết giấy', true, undefined, 'het_giay'); });
    const suKien: SuKienHangDoi[] = [];
    await chayMotLuotIn({
      prisma, client: { inPdf, traTrangThaiJob: vi.fn() }, taiPdf,
      layTenKhach: async () => 'Anh Lộc', nhatKy: (e) => suKien.push(e), cauDao: cauDaoThat(reg),
    });
    expect(inPdf).toHaveBeenCalledTimes(1);
    expect(hang.map((j) => [j.trangThai, j.lanThu])).toEqual([['cho_in', 0], ['cho_in', 0], ['cho_in', 0]]);
    expect(suKien.filter((e) => e.loai === 'tam_giu')).toHaveLength(1);
    const choMay = suKien.filter((e) => e.loai === 'cho_may_in');
    expect(choMay).toHaveLength(2);
    expect(choMay[0].tenKhach).toBe('Anh Lộc');
  });

  it('app im quá hạn chờ (het_gio_cho) → ngắt; không xác nhận (khong_xac_nhan) → KHÔNG ngắt', async () => {
    for (const [ma, ngat] of [['het_gio_cho', true], ['khong_xac_nhan', false]] as const) {
      const reg = new AgentRegistry();
      const { prisma } = prismaGia([{}]);
      const inPdf = vi.fn(async () => { throw new LoiKhongRo('x', ma); });
      await chayMotLuotIn({ prisma, client: { inPdf, traTrangThaiJob: vi.fn() }, taiPdf, cauDao: cauDaoThat(reg) });
      expect(reg.xetCauDao(TOKEN)).toBe(ngat ? 'giu' : 'gui');
    }
  });

  it('tới lượt thử → gửi đúng một job, nhật ký ghi "gửi thử"; job thành công thì cả hàng in tiếp ở lượt sau', async () => {
    let bayGio = 1_000_000;
    const reg = new AgentRegistry({ bayGio: () => bayGio });
    reg.ngatCauDao(TOKEN, 'het_giay', 'Hết giấy');
    bayGio += 3 * 60_000;
    const { prisma, hang } = prismaGia([{}, {}]);
    const inPdf = vi.fn(async () => ({ jobId: null, phanHoi: {} as never, daInXong: true }));
    const suKien: SuKienHangDoi[] = [];
    const deps = { prisma, client: { inPdf, traTrangThaiJob: vi.fn() }, taiPdf, nhatKy: (e: SuKienHangDoi) => suKien.push(e), cauDao: cauDaoThat(reg) };
    await chayMotLuotIn(deps);
    expect(inPdf).toHaveBeenCalledTimes(1);
    expect(suKien.find((e) => e.loai === 'gui_may_in')!.noiDung).toContain('gửi thử');
    reg.dongCauDao(TOKEN); // agent-ws làm việc này khi nhận da_in
    await chayMotLuotIn(deps);
    expect(hang.map((j) => j.trangThai)).toEqual(['da_in', 'da_in']);
  });

  it('dòng that_bai mang tên khách (tìm theo tên khách ra cả dòng thất bại cuối)', async () => {
    const { prisma } = prismaGia([{ lanThu: 5, loiCuoi: 'x' }]);
    const suKien: SuKienHangDoi[] = [];
    await chayMotLuotIn({ prisma, client: { inPdf: vi.fn(), traTrangThaiJob: vi.fn() }, taiPdf, layTenKhach: async () => 'Chị Hoa', nhatKy: (e) => suKien.push(e) });
    expect(suKien.find((e) => e.loai === 'that_bai')!.tenKhach).toBe('Chị Hoa');
  });
});

describe('V4 — job dang_gui mồ côi (server khởi động lại giữa lúc chờ)', () => {
  it('quá 15 phút → khong_ro + nhật ký; job đang chờ thật (mới) không bị đụng', async () => {
    const bayGio = Date.parse('2026-09-25T03:00:00Z');
    const cu = new Date(bayGio - MS_JOB_MO_COI - 1_000);
    const moi = new Date(bayGio - 60_000);
    const { prisma, hang } = prismaGia([
      { id: 'coi', trangThai: 'dang_gui', updatedAt: cu } as Partial<JobIn>,
      { id: 'dangCho', trangThai: 'dang_gui', updatedAt: moi } as Partial<JobIn>,
    ]);
    const suKien: SuKienHangDoi[] = [];
    expect(await donJobMoCoi({ prisma, nhatKy: (e) => suKien.push(e) }, bayGio)).toBe(1);
    expect(hang.find((j) => j.id === 'coi')!.trangThai).toBe('khong_ro');
    expect(hang.find((j) => j.id === 'dangCho')!.trangThai).toBe('dang_gui');
    expect(suKien[0]).toMatchObject({ loai: 'khong_ro', chiTiet: { lyDo: 'mo_coi' } });
  });

  it('DB lỗi → trả 0, không ném (dọn dẹp không được chặn lượt in)', async () => {
    const prisma = { printJob: { findMany: vi.fn(async () => { throw new Error('db'); }) } } as unknown as PrismaHangDoiIn;
    await expect(donJobMoCoi({ prisma })).resolves.toBe(0);
  });
});

describe('nhật ký — tra máy lỗi thì KHÔNG nhớ null', () => {
  it('lần tra đầu lỗi DB, lần sau tra được → dòng sau mang đúng máy/org', async () => {
    const dong: Array<Record<string, unknown>> = [];
    let lan = 0;
    const p = {
      printLog: { create: vi.fn(async ({ data }) => { dong.push(data); return data; }), findMany: vi.fn(), deleteMany: vi.fn() },
      printAgent: {
        findUnique: vi.fn(async () => {
          lan += 1;
          if (lan === 1) throw new Error('timeout');
          return { id: 'mayHN', orgId: 'orgHN', ten: 'Máy HN' };
        }),
      },
    } as unknown as PrismaNhatKy;
    const ghi = taoGhiNhatKy({ prisma: p, orgMacDinh: () => 'orgEnv' });
    await ghi.cho({ loai: 'da_in', noiDung: 'a', agentToken: TOKEN });
    await ghi.cho({ loai: 'da_in', noiDung: 'b', agentToken: TOKEN });
    expect(dong[0]).toMatchObject({ orgId: 'orgEnv' });
    expect(dong[1]).toMatchObject({ orgId: 'orgHN', mayInId: 'mayHN', mayInTen: 'Máy HN' });
  });
});

describe('route GET /nhat-ky (traNhatKy)', () => {
  it('member → 403; tham số sai → 400; org LUÔN từ phiên, không từ query', async () => {
    const tim = vi.fn(async () => ({ items: [], tiepTheo: null }));
    expect((await traNhatKy({ orgId: 'o1', role: 'member' }, {}, { tim })).code).toBe(403);
    expect((await traNhatKy({ orgId: 'o1', role: 'admin' }, { mucDo: 'xyz' }, { tim })).code).toBe(400);
    const kq = await traNhatKy({ orgId: 'o1', role: 'owner' }, { orgId: 'oKhac', q: 'het giay' }, { tim });
    expect(kq.code).toBe(200);
    expect(tim).toHaveBeenCalledWith('o1', expect.objectContaining({ q: ['het', 'giay'] }));
    expect(tim).not.toHaveBeenCalledWith('oKhac', expect.anything());
  });

  it('bảng chưa migrate (Prisma P2021) → 503 CHUA_MIGRATE, lỗi khác vẫn ném', async () => {
    const thieuBang = vi.fn(async () => { throw Object.assign(new Error('table does not exist'), { code: 'P2021' }); });
    expect(await traNhatKy({ orgId: 'o1', role: 'admin' }, {}, { tim: thieuBang })).toMatchObject({ code: 503, body: { error: 'CHUA_MIGRATE' } });
    const loiKhac = vi.fn(async () => { throw new Error('boom'); });
    await expect(traNhatKy({ orgId: 'o1', role: 'admin' }, {}, { tim: loiKhac })).rejects.toThrow('boom');
  });
});
