// SPDX-License-Identifier: AGPL-3.0-or-later
// Hàng đợi in — luật A3 (chống in đôi, cùng họ chống đơn trùng tool-ghi Odoo):
// lỗi RÕ (chưa tới máy in / máy in từ chối) thì retry; lỗi KHÔNG RÕ (timeout
// giữa chừng) thì CẤM gửi lại mù — chỉ được hỏi trạng thái job đã có id, còn
// không id thì đứng yên chờ người quyết.
import { describe, it, expect, vi } from 'vitest';
import {
  themJobIn,
  chayMotLuotIn,
  MAX_LAN_THU,
  type PrismaHangDoiIn,
  type JobIn,
} from '../../../src/modules/ai/may-in/hang-doi-in.js';
import { LoiIpp, LoiKhongRo } from '../../../src/modules/ai/may-in/ipp-client.js';

/** Prisma giả giữ hàng trong RAM — đúng bề mặt hàng đợi cần. */
function prismaGia(hangSan: Array<Partial<JobIn>> = []) {
  let dem = 0;
  const hang: JobIn[] = hangSan.map((h) => ({
    id: h.id ?? `j${++dem}`,
    orgId: 'org1',
    conversationId: null,
    hoaDonId: 7001,
    soHoaDon: 'INV/2026/00042',
    report: 'incokit_pos.report_invoice_document_kiotviet',
    trangThai: 'cho_in',
    lanThu: 0,
    ippJobId: null,
    loiCuoi: null,
    ...h,
  } as JobIn));
  const prisma: PrismaHangDoiIn = {
    printJob: {
      create: vi.fn(async ({ data }) => {
        const j = { id: `j${++dem}`, ippJobId: null, loiCuoi: null, conversationId: null, ...data } as JobIn;
        hang.push(j);
        return j;
      }),
      findMany: vi.fn(async ({ where }) => {
        const muon = (where?.trangThai as { in?: string[] })?.in;
        return hang.filter((j) => !muon || muon.includes(j.trangThai)).map((j) => ({ ...j }));
      }),
      update: vi.fn(async ({ where, data }) => {
        const j = hang.find((x) => x.id === where.id)!;
        Object.assign(j, data);
        return { ...j };
      }),
    },
  };
  return { prisma, hang };
}

const clientOk = () => ({
  inPdf: vi.fn(async () => ({ jobId: 118, phanHoi: {} as never })),
  traTrangThaiJob: vi.fn(async () => ({ jobState: 9, phanHoi: {} as never })),
});
const taiPdfOk = () => vi.fn(async () => Buffer.from('%PDF-1.4'));

describe('themJobIn', () => {
  it('tạo hàng cho_in đủ trường để lượt cron sau tự chạy', async () => {
    const { prisma, hang } = prismaGia();
    await themJobIn(prisma, {
      orgId: 'org1', conversationId: 'c1', hoaDonId: 7001,
      soHoaDon: 'INV/2026/00042', report: 'incokit_pos.report_invoice_document_kiotviet',
    });
    expect(hang).toHaveLength(1);
    expect(hang[0]).toMatchObject({ trangThai: 'cho_in', lanThu: 0, hoaDonId: 7001 });
  });
});

describe('chayMotLuotIn — đường vui', () => {
  it('cho_in → gửi máy in → da_gui kèm ippJobId, job-name là số hoá đơn', async () => {
    const { prisma, hang } = prismaGia([{}]);
    const client = clientOk();
    const taiPdf = taiPdfOk();
    await chayMotLuotIn({ prisma, client, taiPdf });
    expect(taiPdf).toHaveBeenCalledWith(7001, 'incokit_pos.report_invoice_document_kiotviet');
    expect(client.inPdf).toHaveBeenCalledWith(expect.any(Buffer), 'INV/2026/00042');
    expect(hang[0]).toMatchObject({ trangThai: 'da_gui', ippJobId: 118 });
  });

  it('da_gui có ippJobId → xác minh máy in: completed → da_in', async () => {
    const { prisma, hang } = prismaGia([{ trangThai: 'da_gui', ippJobId: 118 }]);
    const client = clientOk();
    await chayMotLuotIn({ prisma, client, taiPdf: taiPdfOk() });
    expect(client.traTrangThaiJob).toHaveBeenCalledWith(118);
    expect(client.inPdf).not.toHaveBeenCalled();
    expect(hang[0].trangThai).toBe('da_in');
  });
});

describe('chayMotLuotIn — lỗi RÕ thì retry, quá trần thì dừng', () => {
  it('không tới được máy in → về cho_in, lanThu+1, ghi loiCuoi', async () => {
    const { prisma, hang } = prismaGia([{}]);
    const client = clientOk();
    client.inPdf.mockRejectedValueOnce(new LoiIpp('Không tới được máy in (ECONNREFUSED)', false));
    await chayMotLuotIn({ prisma, client, taiPdf: taiPdfOk() });
    expect(hang[0]).toMatchObject({ trangThai: 'cho_in', lanThu: 1 });
    expect(hang[0].loiCuoi).toContain('ECONNREFUSED');
  });

  it('quá MAX_LAN_THU → loi, không thử nữa', async () => {
    const { prisma, hang } = prismaGia([{ lanThu: MAX_LAN_THU }]);
    const client = clientOk();
    client.inPdf.mockRejectedValue(new LoiIpp('từ chối', true));
    await chayMotLuotIn({ prisma, client, taiPdf: taiPdfOk() });
    expect(hang[0].trangThai).toBe('loi');
    expect(client.inPdf).not.toHaveBeenCalled();
  });

  it('Odoo không trả được PDF → về cho_in retry (chưa gửi gì tới máy in)', async () => {
    const { prisma, hang } = prismaGia([{}]);
    const client = clientOk();
    const taiPdf = vi.fn(async () => { throw new Error('Odoo 500'); });
    await chayMotLuotIn({ prisma, client, taiPdf });
    expect(client.inPdf).not.toHaveBeenCalled();
    expect(hang[0]).toMatchObject({ trangThai: 'cho_in', lanThu: 1 });
  });
});

describe('chayMotLuotIn — lỗi KHÔNG RÕ thì cấm gửi lại mù (A3)', () => {
  it('timeout giữa chừng → khong_ro; lượt sau KHÔNG inPdf lại', async () => {
    const { prisma, hang } = prismaGia([{}]);
    const client = clientOk();
    client.inPdf.mockRejectedValueOnce(new LoiKhongRo('không thấy trả lời'));
    await chayMotLuotIn({ prisma, client, taiPdf: taiPdfOk() });
    expect(hang[0].trangThai).toBe('khong_ro');

    client.inPdf.mockClear();
    await chayMotLuotIn({ prisma, client, taiPdf: taiPdfOk() });
    expect(client.inPdf).not.toHaveBeenCalled(); // đứng yên chờ người quyết
    expect(hang[0].trangThai).toBe('khong_ro');
  });

  it('khong_ro NHƯNG đã có ippJobId → được phép hỏi máy in, completed → da_in', async () => {
    const { prisma, hang } = prismaGia([{ trangThai: 'khong_ro', ippJobId: 200 }]);
    const client = clientOk();
    await chayMotLuotIn({ prisma, client, taiPdf: taiPdfOk() });
    expect(client.traTrangThaiJob).toHaveBeenCalledWith(200);
    expect(hang[0].trangThai).toBe('da_in');
  });

  it('xác minh thấy máy in HUỶ job (state 7/8) → loi, đọc được lý do', async () => {
    const { prisma, hang } = prismaGia([{ trangThai: 'da_gui', ippJobId: 118 }]);
    const client = clientOk();
    client.traTrangThaiJob.mockResolvedValueOnce({ jobState: 8, phanHoi: {} as never });
    await chayMotLuotIn({ prisma, client, taiPdf: taiPdfOk() });
    expect(hang[0].trangThai).toBe('loi');
    expect(hang[0].loiCuoi).toMatch(/8/);
  });

  it('máy in đang xử lý (state 5) → giữ da_gui, lượt sau hỏi tiếp', async () => {
    const { prisma, hang } = prismaGia([{ trangThai: 'da_gui', ippJobId: 118 }]);
    const client = clientOk();
    client.traTrangThaiJob.mockResolvedValueOnce({ jobState: 5, phanHoi: {} as never });
    await chayMotLuotIn({ prisma, client, taiPdf: taiPdfOk() });
    expect(hang[0].trangThai).toBe('da_gui');
  });

  it('hỏi trạng thái mà máy in không trả lời được → GIỮ NGUYÊN, không đổi gì', async () => {
    const { prisma, hang } = prismaGia([{ trangThai: 'da_gui', ippJobId: 118 }]);
    const client = clientOk();
    client.traTrangThaiJob.mockRejectedValueOnce(new LoiKhongRo('im lặng'));
    await chayMotLuotIn({ prisma, client, taiPdf: taiPdfOk() });
    expect(hang[0].trangThai).toBe('da_gui');
  });
});
