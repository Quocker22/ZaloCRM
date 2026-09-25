// SPDX-License-Identifier: AGPL-3.0-or-later
// B2 mở rộng (hợp đồng hàng đợi/huỷ v5.1 §8.3): MỌI lần ghi print_jobs của cron có điều kiện
// trạng thái mong đợi. Mỗi chỗ ghi [G1]…[G11] (đánh dấu trong hang-doi-in.ts) có MỘT ca: một
// lệnh huỷ (hoặc bỏ theo dõi) CHEN GIỮA lúc cron đọc job và lúc cron ghi → trạng thái vẫn là
// `da_huy`, không gửi app, không ghi nhật ký kết quả sai, không ngắt cầu dao.
import { describe, it, expect, vi } from 'vitest';
import {
  chayMotLuotIn,
  donJobMoCoi,
  MAX_LAN_THU,
  MS_JOB_MO_COI,
  type DepsChayLuot,
  type JobIn,
  type PrismaHangDoiIn,
  type SuKienHangDoi,
} from '../../../src/modules/ai/may-in/hang-doi-in.js';
import { LoiIpp, LoiKhongRo } from '../../../src/modules/ai/may-in/ipp-client.js';
import { huyLenhIn } from '../../../src/modules/ai/may-in/huy-lenh-in.js';
import type { MucNhatKy } from '../../../src/modules/ai/may-in/nhat-ky.js';
import { printJobGia } from './prisma-gia-hang-doi.js';

const TOKEN = 'tokHN_bi_mat_khong_duoc_lo_9x7';

function jobMau(them: Partial<JobIn> & Record<string, unknown> = {}): JobIn {
  return {
    id: 'pj1', orgId: 'org1', conversationId: null, hoaDonId: 7001, soHoaDon: 'INV/2026/030067',
    report: 'incokit_pos.report_invoice_document_kiotviet', trangThai: 'cho_in', lanThu: 0, ippJobId: null,
    loiCuoi: null, agentToken: TOKEN, createdAt: new Date('2026-09-25T01:00:00Z'), updatedAt: new Date('2026-09-25T01:00:00Z'),
    ...them,
  } as JobIn;
}

/**
 * Chạy một lượt với "huỷ chen giữa": ngay TRƯỚC lần `updateMany` thứ `lanChen` (đếm từ 1),
 * job bị đổi sang `trangThaiChen` — đúng cái một lệnh huỷ đồng thời để lại trong DB.
 */
async function chayVoiHuyChen(o: {
  job: JobIn;
  lanChen: number;
  trangThaiChen?: string;
  inPdf?: (...a: unknown[]) => Promise<unknown>;
  traTrangThaiJob?: (...a: unknown[]) => Promise<unknown>;
  them?: Partial<DepsChayLuot>;
}) {
  const hang = [o.job as unknown as Record<string, unknown>];
  let lan = 0;
  const pj = printJobGia(hang, {
    truocKhiGhi: () => {
      lan += 1;
      if (lan === o.lanChen) hang[0].trangThai = o.trangThaiChen ?? 'da_huy';
    },
  });
  const prisma = { printJob: pj } as unknown as PrismaHangDoiIn;
  const suKien: SuKienHangDoi[] = [];
  const inPdf = vi.fn(o.inPdf ?? (async () => ({ jobId: null, phanHoi: {}, daInXong: true })));
  const traTrangThaiJob = vi.fn(o.traTrangThaiJob ?? (async () => ({ jobState: null, phanHoi: {} })));
  const cauDao = {
    xet: vi.fn(() => 'gui' as const),
    ngat: vi.fn(() => ({ moi: true })),
    daThu: vi.fn(),
    dangGiu: () => [],
  };
  const baoDoiHangDoi = vi.fn();
  await chayMotLuotIn({
    prisma,
    client: { inPdf, traTrangThaiJob } as never,
    taiPdf: async () => Buffer.from('%PDF-1.4'),
    layTenKhach: async () => 'Anh Lộc Beco',
    nhatKy: (e) => suKien.push(e),
    cauDao,
    baoDoiHangDoi,
    ...o.them,
  });
  const ketQuaGhi = await Promise.all(pj.updateMany.mock.results.map((r) => r.value));
  return { hang, suKien, inPdf, traTrangThaiJob, cauDao, baoDoiHangDoi, pj, ketQuaGhi };
}

/** Loại nhật ký là KẾT QUẢ (không được có khi job đã bị huỷ chen giữa). */
const LOAI_KET_QUA = [
  'gui_may_in', 'da_in', 'that_bai', 'loi_odoo', 'app_offline_thu_lai', 'loi_thu_lai', 'khong_ro', 'het_gio_cho', 'tam_giu',
];
const loaiKetQua = (sk: SuKienHangDoi[]) => sk.map((e) => e.loai).filter((l) => LOAI_KET_QUA.includes(l));

describe('B2 mở rộng — huỷ chen giữa lúc đọc và lúc ghi ở TỪNG chỗ ghi', () => {
  it('[G1] quá MAX_LAN_THU (cho_in → loi): vẫn da_huy, không "In thất bại"', async () => {
    const r = await chayVoiHuyChen({ job: jobMau({ lanThu: MAX_LAN_THU, loiCuoi: 'Hết giấy' }), lanChen: 1 });
    expect(r.pj.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pj1', trangThai: 'cho_in' } }));
    expect(r.ketQuaGhi[0]).toEqual({ count: 0 });
    expect(r.hang[0].trangThai).toBe('da_huy');
    expect(r.inPdf).not.toHaveBeenCalled();
    expect(loaiKetQua(r.suKien)).toEqual([]);
    expect(r.baoDoiHangDoi).not.toHaveBeenCalled();
  });

  it('[G2] app chưa kết nối (cho_in → cho_in lanThu+1): vẫn da_huy, lanThu không đổi, không "chờ thử lại"', async () => {
    const r = await chayVoiHuyChen({ job: jobMau(), lanChen: 1, them: { coMay: () => false } });
    expect(r.hang[0]).toMatchObject({ trangThai: 'da_huy', lanThu: 0 });
    expect(r.inPdf).not.toHaveBeenCalled();
    expect(loaiKetQua(r.suKien)).toEqual([]);
  });

  it('[G3] Odoo không trả PDF (cho_in → cho_in lanThu+1): vẫn da_huy, không "Odoo không trả PDF"', async () => {
    const r = await chayVoiHuyChen({
      job: jobMau(), lanChen: 1, them: { taiPdf: async () => { throw new Error('Odoo 502'); } },
    });
    expect(r.hang[0]).toMatchObject({ trangThai: 'da_huy', lanThu: 0 });
    expect(r.inPdf).not.toHaveBeenCalled();
    expect(loaiKetQua(r.suKien)).toEqual([]);
  });

  it('[G4] CLAIM cho_in → dang_gui thất bại → KHÔNG gửi app, không "gửi xuống máy in", không tính lượt thử cầu dao', async () => {
    const r = await chayVoiHuyChen({ job: jobMau(), lanChen: 1 });
    expect(r.pj.updateMany).toHaveBeenCalledWith({ where: { id: 'pj1', trangThai: 'cho_in' }, data: { trangThai: 'dang_gui' } });
    expect(r.hang[0].trangThai).toBe('da_huy');
    expect(r.inPdf).not.toHaveBeenCalled();
    expect(r.cauDao.daThu).not.toHaveBeenCalled();
    expect(loaiKetQua(r.suKien)).toEqual([]);
  });

  it('[G4] lượt thử của cầu dao: claim thất bại thì lượt thử KHÔNG bị tiêu', async () => {
    const daThu = vi.fn();
    const r = await chayVoiHuyChen({
      job: jobMau(), lanChen: 1,
      them: { cauDao: { xet: () => 'thu', ngat: vi.fn(() => ({ moi: true })), daThu, dangGiu: () => [] } },
    });
    expect(r.inPdf).not.toHaveBeenCalled();
    expect(daThu).not.toHaveBeenCalled();
    expect(loaiKetQua(r.suKien)).toEqual([]);
  });

  it('[G5] kết quả da_in (dang_gui → da_in): job đã đổi chen giữa → giữ nguyên, không "Đã in"', async () => {
    const r = await chayVoiHuyChen({ job: jobMau(), lanChen: 2 });
    expect(r.inPdf).toHaveBeenCalledTimes(1); // gửi TRƯỚC khi có thay đổi — hợp lệ
    expect(r.pj.updateMany.mock.calls[1][0].where).toEqual({ id: 'pj1', trangThai: 'dang_gui' });
    expect(r.hang[0].trangThai).toBe('da_huy');
    expect(loaiKetQua(r.suKien)).toEqual(['gui_may_in']); // chỉ dòng gửi (đúng sự thật lúc đó)
  });

  it('[G6] kết quả da_gui (IPP, dang_gui → da_gui): job đã đổi chen giữa → giữ nguyên', async () => {
    const r = await chayVoiHuyChen({
      job: jobMau(), lanChen: 2, inPdf: async () => ({ jobId: 118, phanHoi: {} }),
    });
    expect(r.hang[0]).toMatchObject({ trangThai: 'da_huy', ippJobId: null });
    expect(r.baoDoiHangDoi).toHaveBeenCalledTimes(1); // chỉ lần claim thành công
  });

  it('[G7] kết quả không rõ (dang_gui → khong_ro): không "không rõ", KHÔNG ngắt cầu dao', async () => {
    const r = await chayVoiHuyChen({
      job: jobMau(), lanChen: 2, inPdf: async () => { throw new LoiKhongRo('app im', 'het_gio_cho'); },
    });
    expect(r.hang[0].trangThai).toBe('da_huy');
    expect(r.cauDao.ngat).not.toHaveBeenCalled();
    expect(loaiKetQua(r.suKien)).toEqual(['gui_may_in']);
  });

  it('[G8] lỗi rõ (dang_gui → cho_in thử lại): không hứa "thử lại", KHÔNG ngắt cầu dao, lanThu không đổi', async () => {
    const r = await chayVoiHuyChen({
      job: jobMau(), lanChen: 2, inPdf: async () => { throw new LoiIpp('Hết giấy', true, undefined, 'het_giay'); },
    });
    expect(r.hang[0]).toMatchObject({ trangThai: 'da_huy', lanThu: 0 });
    expect(r.cauDao.ngat).not.toHaveBeenCalled();
    expect(loaiKetQua(r.suKien)).toEqual(['gui_may_in']);
  });

  it('[G9] xacMinh completed (đã gửi → da_in): chỉ khi còn dang_gui|da_gui|khong_ro — da_huy giữ nguyên', async () => {
    const r = await chayVoiHuyChen({
      job: jobMau({ trangThai: 'da_gui', ippJobId: 118 }), lanChen: 1,
      traTrangThaiJob: async () => ({ jobState: 9, phanHoi: {} }),
    });
    expect(r.pj.updateMany.mock.calls[0][0].where).toEqual({ id: 'pj1', trangThai: { in: ['dang_gui', 'da_gui', 'khong_ro'] } });
    expect(r.hang[0].trangThai).toBe('da_huy');
    expect(r.inPdf).not.toHaveBeenCalled();
  });

  it('[G9] … và bỏ theo dõi chen giữa (khong_ro → bo_qua) cũng không bị ghi đè thành da_in', async () => {
    const r = await chayVoiHuyChen({
      job: jobMau({ trangThai: 'khong_ro', ippJobId: 200 }), lanChen: 1, trangThaiChen: 'bo_qua',
      traTrangThaiJob: async () => ({ jobState: 9, phanHoi: {} }),
    });
    expect(r.hang[0].trangThai).toBe('bo_qua');
  });

  it('[G10] xacMinh máy in huỷ job (đã gửi → loi): da_huy giữ nguyên', async () => {
    const r = await chayVoiHuyChen({
      job: jobMau({ trangThai: 'da_gui', ippJobId: 118 }), lanChen: 1,
      traTrangThaiJob: async () => ({ jobState: 8, phanHoi: {} }),
    });
    expect(r.hang[0]).toMatchObject({ trangThai: 'da_huy', loiCuoi: null });
  });

  it('[G11] dọn mồ côi (dang_gui → khong_ro): da_huy giữ nguyên, không nhật ký "không rõ", đếm 0', async () => {
    const bayGio = Date.parse('2026-09-25T03:00:00Z');
    const hang = [jobMau({ trangThai: 'dang_gui', updatedAt: new Date(bayGio - MS_JOB_MO_COI - 1_000) }) as unknown as Record<string, unknown>];
    const pj = printJobGia(hang, { truocKhiGhi: () => { hang[0].trangThai = 'da_huy'; } });
    const suKien: SuKienHangDoi[] = [];
    const baoDoiHangDoi = vi.fn();
    const n = await donJobMoCoi({ prisma: { printJob: pj } as unknown as PrismaHangDoiIn, nhatKy: (e) => suKien.push(e), baoDoiHangDoi }, bayGio);
    expect(n).toBe(0);
    expect(hang[0].trangThai).toBe('da_huy');
    expect(suKien).toEqual([]);
    expect(baoDoiHangDoi).not.toHaveBeenCalled();
  });

  it('hàng đợi KHÔNG còn `update` trơn nào — mọi lần ghi của một lượt đầy đủ đều là updateMany có điều kiện trạng thái', async () => {
    const r = await chayVoiHuyChen({ job: jobMau(), lanChen: 99 });
    expect(r.hang[0].trangThai).toBe('da_in');
    for (const [a] of r.pj.updateMany.mock.calls) expect(a.where).toHaveProperty('trangThai');
    expect(r.baoDoiHangDoi).toHaveBeenCalledTimes(2); // claim + da_in → hai snapshot cho app
    expect(r.baoDoiHangDoi).toHaveBeenCalledWith(TOKEN);
  });
});

describe('B2 — huỷ THẬT (huyLenhIn) trong lúc cron đang tải PDF', () => {
  it('người quản lý bấm Huỷ đúng lúc cron đang tải PDF → claim thất bại, không gửi app; nhật ký chỉ có "Đã huỷ"', async () => {
    const hang = [jobMau() as unknown as Record<string, unknown>];
    const pj = printJobGia(hang);
    const nhatKyHuy: MucNhatKy[] = [];
    const prismaHuy = {
      printJob: pj,
      printLog: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
      printAgent: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    };
    let ketQuaHuy: unknown;
    const suKien: SuKienHangDoi[] = [];
    const inPdf = vi.fn();
    await chayMotLuotIn({
      prisma: { printJob: pj } as unknown as PrismaHangDoiIn,
      client: { inPdf, traTrangThaiJob: vi.fn() },
      taiPdf: async () => {
        ketQuaHuy = await huyLenhIn({ loai: 'org', orgId: 'org1' }, ['pj1'], { loai: 'crm', ten: 'Chị Hoa' }, {
          prisma: prismaHuy as never, ghiNhatKy: (m) => nhatKyHuy.push(m), tokenMacDinh: null,
          registry: { layCauDao: () => null, coAgent: () => true },
        });
        return Buffer.from('%PDF-1.4');
      },
      nhatKy: (e) => suKien.push(e),
    });
    expect(ketQuaHuy).toEqual([expect.objectContaining({ ok: true, cach: 'chua_gui', trangThaiMoi: 'da_huy' })]);
    expect(inPdf).not.toHaveBeenCalled();
    expect(hang[0].trangThai).toBe('da_huy');
    expect(suKien.map((e) => e.loai)).toEqual(['nhan_job']);
    expect(nhatKyHuy.map((m) => m.loai)).toEqual(['da_huy']);
    expect(nhatKyHuy[0].noiDung).toBe('Đã huỷ lệnh in hoá đơn INV/2026/030067 — chắc chắn không in (nguồn: ZaloCRM (Chị Hoa))');
  });

  it('cron KHÔNG BAO GIỜ nhặt da_huy / bo_qua (DIEU_KIEN_NHAT_JOB)', async () => {
    const hang = [
      jobMau({ id: 'a', trangThai: 'da_huy' }), jobMau({ id: 'b', trangThai: 'bo_qua', ippJobId: 5 }),
    ] as unknown as Array<Record<string, unknown>>;
    const pj = printJobGia(hang);
    const inPdf = vi.fn();
    const traTrangThaiJob = vi.fn();
    await chayMotLuotIn({ prisma: { printJob: pj } as unknown as PrismaHangDoiIn, client: { inPdf, traTrangThaiJob }, taiPdf: async () => Buffer.from('x') });
    expect(inPdf).not.toHaveBeenCalled();
    expect(traTrangThaiJob).not.toHaveBeenCalled();
    expect(pj.updateMany).not.toHaveBeenCalled();
  });
});
