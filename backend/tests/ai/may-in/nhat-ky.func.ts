// SPDX-License-Identifier: AGPL-3.0-or-later
// Nhật ký máy in — ghi (fire-and-forget, không lộ token, không bao giờ ném),
// đọc có phân trang, dọn cũ; registry hạn chờ (lỗi 13.1); AgentClient ánh xạ
// khong_ro / loi+mã / hết giờ. Hợp đồng HOP-DONG-NHAT-KY-MAY-IN.md.
import { describe, it, expect, vi } from 'vitest';
import {
  taoGhiNhatKy,
  timNhatKy,
  donNhatKyCu,
  phanTichThamSo,
  type PrismaNhatKy,
} from '../../../src/modules/ai/may-in/nhat-ky.js';
import {
  AgentRegistry,
  AgentHetGioCho,
  AgentKhongOnline,
  AgentRotGiuaChung,
} from '../../../src/modules/ai/may-in/agent-registry.js';
import { AgentClient } from '../../../src/modules/ai/may-in/agent-client.js';
import { LoiIpp, LoiKhongRo } from '../../../src/modules/ai/may-in/ipp-client.js';

const TOKEN = 'tokBiMatRatDaiKhongDuocLo_8f3k';

function prismaGia(opts: { createNem?: boolean } = {}) {
  const dong: Array<Record<string, unknown>> = [];
  const p: PrismaNhatKy = {
    printLog: {
      create: vi.fn(async ({ data }) => {
        if (opts.createNem) throw new Error('relation "print_logs" does not exist');
        const r = { id: `c${dong.length + 1}`, createdAt: new Date('2026-09-25T02:00:00.000Z'), ...data };
        dong.push(r);
        return r;
      }),
      findMany: vi.fn(async ({ take }) => dong.slice(0, take as number)),
      deleteMany: vi.fn(async () => ({ count: 3 })),
    },
    printAgent: {
      findUnique: vi.fn(async ({ where }) => (where.token === TOKEN ? { id: 'mayHN', orgId: 'org1', ten: 'May HN' } : null)),
    },
  };
  return { p, dong };
}

describe('ghiNhatKy', () => {
  it('ghi đủ trường, tra máy in theo token, KHÔNG lưu token ở bất kỳ cột nào', async () => {
    const { p, dong } = prismaGia();
    const ghi = taoGhiNhatKy({ prisma: p });
    const ok = await ghi.cho({
      loai: 'het_giay',
      noiDung: 'Hết giấy khi in hoá đơn INV/2026/030045',
      agentToken: TOKEN,
      printJobId: 'pj1',
      soHoaDon: 'INV/2026/030045',
      tenKhach: 'Anh Lộc Beco',
      agentJobId: `${TOKEN}-1727170000000-2`,
      chiTiet: { mayIn: 'HP 4003' },
    });
    expect(ok).toBe(true);
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({
      orgId: 'org1', mucDo: 'loi', loai: 'het_giay', mayInId: 'mayHN', mayInTen: 'May HN',
      soHoaDon: 'INV/2026/030045', tenKhach: 'Anh Lộc Beco', agentJobId: '…-1727170000000-2',
    });
    expect(String(dong[0].tuKhoa)).toContain('anh loc beco');
    expect(String(dong[0].tuKhoa)).toContain('het giay');
    expect(JSON.stringify(dong[0])).not.toContain(TOKEN);
  });

  it('bảng chưa migrate / DB lỗi → KHÔNG ném, trả false (in vẫn chạy)', async () => {
    const { p } = prismaGia({ createNem: true });
    const ghi = taoGhiNhatKy({ prisma: p });
    await expect(ghi.cho({ loai: 'da_in', noiDung: 'x', orgId: 'org1' })).resolves.toBe(false);
    expect(() => ghi({ loai: 'da_in', noiDung: 'x', orgId: 'org1' })).not.toThrow();
  });

  it('token không có trong print_agents → dùng org mặc định (máy HN khai bằng env)', async () => {
    const { p, dong } = prismaGia();
    const ghi = taoGhiNhatKy({ prisma: p, orgMacDinh: () => 'orgEnv' });
    await ghi.cho({ loai: 'app_ket_noi', noiDung: 'App kết nối', agentToken: 'tokEnvHN' });
    expect(dong[0]).toMatchObject({ orgId: 'orgEnv', mayInId: null, mayInTen: 'Máy mặc định (env)' });
    expect(JSON.stringify(dong[0])).not.toContain('tokEnvHN');
  });

  it('không biết org → bỏ qua, không ném', async () => {
    const { p, dong } = prismaGia();
    const ghi = taoGhiNhatKy({ prisma: p, orgMacDinh: () => null });
    await expect(ghi.cho({ loai: 'da_in', noiDung: 'x' })).resolves.toBe(false);
    expect(dong).toHaveLength(0);
  });

  it('cache máy in: 2 sự kiện cùng token chỉ 1 lượt tra', async () => {
    const { p } = prismaGia();
    const ghi = taoGhiNhatKy({ prisma: p });
    await ghi.cho({ loai: 'da_in', noiDung: 'a', agentToken: TOKEN });
    await ghi.cho({ loai: 'da_in', noiDung: 'b', agentToken: TOKEN });
    expect(p.printAgent.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('timNhatKy / donNhatKyCu', () => {
  it('lấy dư 1 dòng để biết còn trang sau; con trỏ = "<ISO>|<id>" của dòng cuối', async () => {
    const { p, dong } = prismaGia();
    const ghi = taoGhiNhatKy({ prisma: p });
    for (let i = 0; i < 3; i++) await ghi.cho({ loai: 'da_in', noiDung: `d${i}`, orgId: 'org1' });
    const t = { ...phanTichThamSo({}), gioiHan: 2 };
    const kq = await timNhatKy('org1', t, { prisma: p });
    expect(kq.items).toHaveLength(2);
    expect(kq.tiepTheo).toBe(`${kq.items[1].luc}|${kq.items[1].id}`);
    expect(p.printLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    expect(dong).toHaveLength(3);
    const het = await timNhatKy('org1', { ...t, gioiHan: 5 }, { prisma: p });
    expect(het.tiepTheo).toBeNull();
  });

  it('dọn nhật ký cũ hơn N ngày; lỗi thì trả 0, không ném', async () => {
    const { p } = prismaGia();
    const bayGio = new Date('2026-12-31T00:00:00.000Z');
    expect(await donNhatKyCu(90, { prisma: p, bayGio })).toBe(3);
    expect(p.printLog.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date('2026-10-02T00:00:00.000Z') } } });
    (p.printLog.deleteMany as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db'));
    expect(await donNhatKyCu(90, { prisma: p, bayGio })).toBe(0);
  });
});

describe('AgentRegistry — hạn chờ (lỗi 13.1) + ngữ cảnh + tình trạng', () => {
  it('app không trả lời trong hạn → reject AgentHetGioCho, dọn chờ; kết quả trễ trả false', async () => {
    vi.useFakeTimers();
    try {
      const r = new AgentRegistry({ msChoKetQua: 10_000 });
      r.dangKy(TOKEN, () => {});
      const p = r.guiJob(TOKEN, { id: 'j1', name: 'n', pdfBase64: 'A', paperSize: 'A5', tray: 'tray-2', copies: 1 });
      const kyVong = expect(p).rejects.toBeInstanceOf(AgentHetGioCho);
      vi.advanceTimersByTime(10_001);
      await kyVong;
      expect(r.nhanKetQua(TOKEN, 'j1', { trangThai: 'da_in' })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('kết quả tới kịp → resolve, huỷ hẹn giờ (không reject muộn)', async () => {
    const r = new AgentRegistry({ msChoKetQua: 50 });
    r.dangKy(TOKEN, () => {});
    const p = r.guiJob(TOKEN, { id: 'j2', name: 'n', pdfBase64: 'A', paperSize: 'A5', tray: 'tray-2', copies: 1 });
    expect(r.nhanKetQua(TOKEN, 'j2', { trangThai: 'da_in' })).toBe(true);
    await expect(p).resolves.toEqual({ trangThai: 'da_in' });
    await new Promise((res) => setTimeout(res, 80)); // quá hạn — không được có unhandled rejection
  });

  it('thông điệp lỗi KHÔNG chứa token đầy đủ (đi vào loi_cuoi + nhật ký)', () => {
    for (const e of [new AgentKhongOnline(TOKEN), new AgentRotGiuaChung(TOKEN), new AgentHetGioCho(TOKEN, 90_000)]) {
      expect(e.message).not.toContain(TOKEN);
      expect(e.message).toContain(TOKEN.slice(-4));
    }
  });

  it('ngữ cảnh job giữ tối đa 1.000 mục mới nhất', () => {
    const r = new AgentRegistry();
    for (let i = 0; i < 1005; i++) r.ghiNguCanh(`j${i}`, { printJobId: `p${i}`, orgId: 'o', soHoaDon: `S${i}`, tenKhach: null, token: TOKEN });
    expect(r.layNguCanh('j0')).toBeNull();
    expect(r.layNguCanh('j1004')?.soHoaDon).toBe('S1004');
  });

  it('tình trạng máy in: chỉ "đổi" khi khác mã; offline → null; nối lại giữ mã cũ', () => {
    const r = new AgentRegistry();
    const huy = r.dangKy(TOKEN, () => {});
    expect(r.capNhatTinhTrang(TOKEN, { ma: 'binh_thuong', luc: new Date() })).toEqual({ doi: true, maCu: null });
    expect(r.capNhatTinhTrang(TOKEN, { ma: 'het_giay', luc: new Date() })).toEqual({ doi: true, maCu: 'binh_thuong' });
    expect(r.capNhatTinhTrang(TOKEN, { ma: 'het_giay', luc: new Date() }).doi).toBe(false);
    expect(r.layTinhTrang(TOKEN)?.ma).toBe('het_giay');
    huy();
    expect(r.layTinhTrang(TOKEN)).toBeNull();
    r.dangKy(TOKEN, () => {});
    expect(r.capNhatTinhTrang(TOKEN, { ma: 'het_giay', luc: new Date() }).doi).toBe(false);
  });
});

describe('AgentClient — ánh xạ kết quả app (hợp đồng §3.1)', () => {
  const cfg = { paperSize: 'A5', tray: 'tray-2' };
  const nc = { printJobId: 'pj1', orgId: 'org1', soHoaDon: 'INV/2026/030045', tenKhach: 'Anh Lộc' };

  it('ghi ngữ cảnh TRƯỚC khi gửi job', async () => {
    const r = new AgentRegistry();
    let thayNguCanhLucGui = false;
    r.dangKy(TOKEN, (msg: any) => {
      thayNguCanhLucGui = r.layNguCanh(msg.job.id)?.printJobId === 'pj1';
      r.nhanKetQua(TOKEN, msg.job.id, { trangThai: 'da_in' });
    });
    await new AgentClient(r, TOKEN, cfg).inPdf(Buffer.from('%PDF'), 'AI-INV_2026_030045-Anh_Loc', nc);
    expect(thayNguCanhLucGui).toBe(true);
  });

  it('app báo khong_ro → LoiKhongRo (KHÔNG retry) mang mã sự cố', async () => {
    const reg = { guiJob: vi.fn(async () => ({ trangThai: 'khong_ro', loai: 'ket_giay', loiCuoi: 'kẹt khi đang in' })), ghiNguCanh: vi.fn() } as any;
    const e = await new AgentClient(reg, TOKEN, cfg).inPdf(Buffer.from('%PDF'), 'x', nc).catch((x) => x);
    expect(e).toBeInstanceOf(LoiKhongRo);
    expect(e.ma).toBe('ket_giay');
    expect(e.message).toBe('Kẹt giấy — kẹt khi đang in');
  });

  it('app báo loi + het_giay → LoiIpp(guiDuoc=true) có nhãn tiếng Việt + mã', async () => {
    const reg = { guiJob: vi.fn(async () => ({ trangThai: 'loi', loai: 'het_giay', loiCuoi: 'đã xoá khỏi hàng đợi' })), ghiNguCanh: vi.fn() } as any;
    const e = await new AgentClient(reg, TOKEN, cfg).inPdf(Buffer.from('%PDF'), 'x').catch((x) => x);
    expect(e).toBeInstanceOf(LoiIpp);
    expect(e.guiDuoc).toBe(true);
    expect(e.ma).toBe('het_giay');
    expect(e.message).toBe('Hết giấy — đã xoá khỏi hàng đợi');
  });

  it('mã lạ từ app bị bỏ (không tin mù dữ liệu mạng)', async () => {
    const reg = { guiJob: vi.fn(async () => ({ trangThai: 'loi', loai: '<script>', loiCuoi: 'x' })), ghiNguCanh: vi.fn() } as any;
    const e = await new AgentClient(reg, TOKEN, cfg).inPdf(Buffer.from('%PDF'), 'x').catch((x) => x);
    expect(e.ma).toBeUndefined();
    expect(e.message).toBe('x');
  });

  it('hết hạn chờ → LoiKhongRo mã het_gio_cho', async () => {
    const reg = { guiJob: vi.fn(async () => { throw new AgentHetGioCho(TOKEN, 90_000); }), ghiNguCanh: vi.fn() } as any;
    const e = await new AgentClient(reg, TOKEN, cfg).inPdf(Buffer.from('%PDF'), 'x').catch((x) => x);
    expect(e).toBeInstanceOf(LoiKhongRo);
    expect(e.ma).toBe('het_gio_cho');
  });
});
