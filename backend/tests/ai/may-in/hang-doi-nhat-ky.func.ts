// SPDX-License-Identifier: AGPL-3.0-or-later
// Hàng đợi in — nhật ký từng bước + sửa lỗi 13.2 (hàng đợi đói). Hợp đồng §3.1, §3.3.
import { describe, it, expect, vi } from 'vitest';
import {
  chayMotLuotIn,
  DIEU_KIEN_NHAT_JOB,
  MAX_LAN_THU,
  type PrismaHangDoiIn,
  type JobIn,
  type SuKienHangDoi,
} from '../../../src/modules/ai/may-in/hang-doi-in.js';
import { LoiIpp, LoiKhongRo } from '../../../src/modules/ai/may-in/ipp-client.js';

/** Áp DIEU_KIEN_NHAT_JOB như Prisma — đủ cho 2 dạng điều kiện dùng ở đây. */
function khop(j: JobIn, dk: Record<string, unknown>): boolean {
  if (Array.isArray(dk.OR)) return (dk.OR as Array<Record<string, unknown>>).some((c) => khop(j, c));
  const tt = dk.trangThai as string | { in: string[] } | undefined;
  if (typeof tt === 'string' && j.trangThai !== tt) return false;
  if (tt && typeof tt === 'object' && !tt.in.includes(j.trangThai)) return false;
  if (dk.ippJobId && (dk.ippJobId as { not: null }).not === null && j.ippJobId === null) return false;
  return true;
}

let dem = 0;
function prismaGia(hangSan: Array<Partial<JobIn>>) {
  const hang: JobIn[] = hangSan.map((h) => ({
    id: h.id ?? `j${++dem}`, orgId: 'org1', conversationId: null, hoaDonId: 7001,
    soHoaDon: 'INV/2026/030045', report: 'incokit_pos.report_invoice_document_kiotviet',
    trangThai: 'cho_in', lanThu: 0, ippJobId: null, loiCuoi: null, agentToken: 'tokHN', ...h,
  } as JobIn));
  const prisma: PrismaHangDoiIn = {
    printJob: {
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async ({ where, take }) => hang.filter((j) => khop(j, where ?? {})).slice(0, take).map((j) => ({ ...j }))),
      update: vi.fn(async ({ where, data }) => Object.assign(hang.find((x) => x.id === where.id)!, data)),
    },
  };
  return { prisma, hang };
}

const client = (inPdf: (...a: any[]) => Promise<any>) => ({ inPdf: vi.fn(inPdf), traTrangThaiJob: vi.fn() });
const taiPdf = async () => Buffer.from('%PDF-1.4');

function chay(hang: Array<Partial<JobIn>>, c: ReturnType<typeof client>, them: Record<string, unknown> = {}) {
  const { prisma, hang: h } = prismaGia(hang);
  const suKien: SuKienHangDoi[] = [];
  const p = chayMotLuotIn({
    prisma, client: c, taiPdf, layTenKhach: async () => 'Anh Lộc Beco', nhatKy: (e) => suKien.push(e), ...them,
  });
  return { p, suKien, hang: h, prisma };
}

describe('lỗi 13.2 — hàng đợi không còn bị job treo chiếm chỗ', () => {
  it('10 job khong_ro/dang_gui KHÔNG có ippJobId không chặn job cho_in mới', async () => {
    const treo = Array.from({ length: 12 }, (_, i) => ({ id: `treo${i}`, trangThai: i % 2 ? 'khong_ro' : 'dang_gui' } as Partial<JobIn>));
    const c = client(async () => ({ jobId: null, phanHoi: {}, daInXong: true }));
    const { p, hang } = chay([...treo, { id: 'moi' }], c);
    await p;
    expect(c.inPdf).toHaveBeenCalledTimes(1);
    expect(hang.find((j) => j.id === 'moi')!.trangThai).toBe('da_in');
  });
  it('điều kiện vẫn nhặt job IPP đã gửi có ippJobId để xác minh', () => {
    expect(khop({ trangThai: 'da_gui', ippJobId: 5 } as JobIn, DIEU_KIEN_NHAT_JOB)).toBe(true);
    expect(khop({ trangThai: 'khong_ro', ippJobId: null } as JobIn, DIEU_KIEN_NHAT_JOB)).toBe(false);
    expect(khop({ trangThai: 'da_in', ippJobId: 5 } as JobIn, DIEU_KIEN_NHAT_JOB)).toBe(false);
  });
});

describe('nhật ký từng bước', () => {
  it('đường vui: nhan_job → gui_may_in → da_in; inPdf nhận ngữ cảnh job', async () => {
    const c = client(async () => ({ jobId: null, phanHoi: {}, daInXong: true }));
    const { p, suKien } = chay([{ id: 'pj1' }], c);
    await p;
    expect(suKien.map((e) => e.loai)).toEqual(['nhan_job', 'gui_may_in', 'da_in']);
    expect(suKien[1].tenKhach).toBe('Anh Lộc Beco');
    expect(c.inPdf.mock.calls[0][2]).toEqual({ printJobId: 'pj1', orgId: 'org1', soHoaDon: 'INV/2026/030045', tenKhach: 'Anh Lộc Beco' });
  });

  it('app báo hết giấy (loi, đã xoá khỏi hàng đợi) → loi_thu_lai kèm mã, job về cho_in, KHÔNG tiêu lượt thử', async () => {
    const c = client(async () => { throw new LoiIpp('Hết giấy — đã xoá khỏi hàng đợi', true, undefined, 'het_giay'); });
    const { p, suKien, hang } = chay([{}], c);
    await p;
    const e = suKien.find((x) => x.loai === 'loi_thu_lai')!;
    expect(e.chiTiet).toEqual({ suCo: 'het_giay' });
    expect(e.noiDung).toContain('Hết giấy');
    expect(e.noiDung).toContain('KHÔNG in tay');
    // Lỗi của MÁY IN, không phải của hoá đơn: hết giấy 10 phút không được biến
    // hoá đơn thành `loi` vĩnh viễn (bản trước: lanThu+1 mỗi phút → quá 5 là hỏng).
    expect(hang[0]).toMatchObject({ trangThai: 'cho_in', lanThu: 0 });
  });

  it('lỗi KHÔNG do máy in (app báo loi không mã) → vẫn tiêu lượt thử như cũ', async () => {
    const c = client(async () => { throw new LoiIpp('Agent báo lỗi in', true); });
    const { p, hang } = chay([{}], c);
    await p;
    expect(hang[0]).toMatchObject({ trangThai: 'cho_in', lanThu: 1 });
  });

  it('app chưa kết nối → app_offline_thu_lai', async () => {
    const c = client(async () => { throw new LoiIpp('không có agent online', false); });
    const { p, suKien } = chay([{}], c);
    await p;
    expect(suKien.map((e) => e.loai)).toContain('app_offline_thu_lai');
  });

  it('hết hạn chờ (13.1) → het_gio_cho, job khong_ro, lượt SAU không gửi lại', async () => {
    const c = client(async () => { throw new LoiKhongRo('app không trả lời sau 90 giây', 'het_gio_cho'); });
    const { p, suKien, hang, prisma } = chay([{}], c);
    await p;
    expect(suKien.map((e) => e.loai)).toContain('het_gio_cho');
    expect(hang[0].trangThai).toBe('khong_ro');
    c.inPdf.mockClear();
    await chayMotLuotIn({ prisma, client: c, taiPdf });
    expect(c.inPdf).not.toHaveBeenCalled();
  });

  it('kẹt giấy giữa chừng (khong_ro) → khong_ro kèm mã', async () => {
    const c = client(async () => { throw new LoiKhongRo('Kẹt giấy', 'ket_giay'); });
    const { p, suKien } = chay([{}], c);
    await p;
    const e = suKien.find((x) => x.loai === 'khong_ro')!;
    expect(e.chiTiet).toEqual({ suCo: 'ket_giay' });
    // Máy in đang chặn in → hoá đơn nằm trong máy, tự ra khi gỡ kẹt: câu
    // hướng dẫn tuyệt đối không được bảo NV in lại.
    expect(e.noiDung).toContain('sẽ tự in ra sau khi khắc phục — KHÔNG in lại');
    expect(e.noiDung).not.toMatch(/rồi mới in lại/);
  });

  it('quá số lần thử → that_bai', async () => {
    const c = client(async () => ({ jobId: null, phanHoi: {}, daInXong: true }));
    const { p, suKien, hang } = chay([{ lanThu: MAX_LAN_THU, loiCuoi: 'Hết giấy' }], c);
    await p;
    expect(suKien.map((e) => e.loai)).toEqual(['that_bai']);
    expect(hang[0].trangThai).toBe('loi');
  });

  it('Odoo không trả PDF → loi_odoo', async () => {
    const c = client(async () => ({}));
    const { p, suKien } = chay([{}], c, { taiPdf: async () => { throw new Error('Odoo 502'); } });
    await p;
    expect(suKien.map((e) => e.loai)).toEqual(['nhan_job', 'loi_odoo']);
  });

  it('không tìm được máy in → khong_co_may_in CHỈ MỘT LẦN dù cron gặp lại nhiều lượt', async () => {
    const { prisma } = prismaGia([{ id: 'khongMay1' }]);
    const suKien: SuKienHangDoi[] = [];
    const deps = { prisma, chonClient: () => null, taiPdf, nhatKy: (e: SuKienHangDoi) => suKien.push(e) };
    await chayMotLuotIn(deps);
    await chayMotLuotIn(deps);
    await chayMotLuotIn(deps);
    expect(suKien.filter((e) => e.loai === 'khong_co_may_in')).toHaveLength(1);
  });

  it('callback nhật ký NÉM LỖI → việc in vẫn chạy trọn', async () => {
    const c = client(async () => ({ jobId: null, phanHoi: {}, daInXong: true }));
    const { hang, prisma } = prismaGia([{}]);
    await chayMotLuotIn({ prisma, client: c, taiPdf, nhatKy: () => { throw new Error('log hỏng'); } });
    expect(hang[0].trangThai).toBe('da_in');
  });
});
