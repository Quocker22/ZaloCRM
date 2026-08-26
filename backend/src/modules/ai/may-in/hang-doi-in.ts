// SPDX-License-Identifier: AGPL-3.0-or-later
// Hàng đợi in hoá đơn — bảng `print_jobs`, cron nhặt từng job xử lý.
//
// VÌ SAO KHÔNG in thẳng trong tool: máy in ở LAN shop, PC cầu nối có thể tắt,
// Odoo render có thể chậm — tool phải trả lời nhân viên NGAY ("đã xếp hàng"),
// còn chuyện in để vòng nền lo, in bù được khi máy in sống lại.
//
// LUẬT A3 (chống in đôi — cùng họ chống đơn trùng tool-ghi Odoo):
//   lỗi RÕ  (chưa tới máy in / máy in từ chối)  → retry, có trần.
//   lỗi KHÔNG RÕ (đã nối mà không thấy trả lời) → khong_ro. Có ippJobId thì
//   CHỈ được hỏi trạng thái; không có id thì ĐỨNG YÊN chờ người quyết —
//   muốn in lại, nhân viên gọi tool lần nữa (tạo job mới, có dấu vết).
import { JOB_STATE, type PhanHoiIpp } from './giao-thuc-ipp.js';
import { LoiIpp, LoiKhongRo } from './ipp-client.js';

/** Quá số lần này mà máy in vẫn từ chối/không tới được → loi, chờ người xem. */
export const MAX_LAN_THU = 5;

export type TrangThaiJob = 'cho_in' | 'dang_gui' | 'da_gui' | 'da_in' | 'khong_ro' | 'loi';

export interface JobIn {
  id: string;
  orgId: string;
  conversationId: string | null;
  hoaDonId: number;
  soHoaDon: string;
  report: string;
  trangThai: TrangThaiJob;
  lanThu: number;
  ippJobId: number | null;
  loiCuoi: string | null;
}

/** Bề mặt Prisma tối thiểu — nhận cả PrismaClient thật lẫn bản giả trong test. */
export interface PrismaHangDoiIn {
  printJob: {
    create: (a: { data: Record<string, unknown> }) => Promise<unknown>;
    findMany: (a: { where?: Record<string, unknown>; orderBy?: unknown; take?: number }) => Promise<JobIn[]>;
    update: (a: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
}

/**
 * Đuôi đánh dấu job in KHÔNG GIÁ (26/08). Ghi vào cột `report` sẵn có thay vì
 * thêm cột: bảng print_jobs trên prod tạo tay bằng SQL, thêm cột là thêm một
 * lần migration tay nữa. Cron tách đuôi ra trước khi gọi Odoo.
 */
export const HAU_TO_KHONG_GIA = '#khong_gia';

export function tachReport(report: string): { report: string; khongGia: boolean } {
  return report.endsWith(HAU_TO_KHONG_GIA)
    ? { report: report.slice(0, -HAU_TO_KHONG_GIA.length), khongGia: true }
    : { report, khongGia: false };
}

export interface ThamSoThemJob {
  orgId: string;
  conversationId?: string;
  hoaDonId: number;
  soHoaDon: string;
  report: string;
}

/** Xếp một hoá đơn vào hàng in. Không đụng máy in — cron lo. */
export async function themJobIn(prisma: PrismaHangDoiIn, p: ThamSoThemJob): Promise<void> {
  await prisma.printJob.create({
    data: {
      orgId: p.orgId,
      conversationId: p.conversationId ?? null,
      hoaDonId: p.hoaDonId,
      soHoaDon: p.soHoaDon,
      report: p.report,
      trangThai: 'cho_in',
      lanThu: 0,
    },
  });
}

export interface ClientMayIn {
  inPdf(pdf: Buffer, tenJob: string): Promise<{ jobId: number | null; phanHoi: PhanHoiIpp }>;
  traTrangThaiJob(jobId: number): Promise<{ jobState: number | null; phanHoi: PhanHoiIpp }>;
}

export interface DepsChayLuot {
  prisma: PrismaHangDoiIn;
  client: ClientMayIn;
  /** Tải PDF hoá đơn từ Odoo (HoaDonAnhClient.taiPdf). */
  taiPdf: (hoaDonId: number, report: string) => Promise<Buffer>;
  /** Trần job mỗi lượt — vòng nền không được biến thành trận in ồ ạt. */
  gioiHan?: number;
  onLoi?: (jobId: string, err: unknown) => void;
}

/**
 * Một lượt cron: nhặt job đang dở, mỗi job xử lý TUẦN TỰ (một máy in, in song
 * song chỉ trộn giấy). Lỗi một job không phá lượt.
 */
export async function chayMotLuotIn(deps: DepsChayLuot): Promise<void> {
  const cac = await deps.prisma.printJob.findMany({
    where: { trangThai: { in: ['cho_in', 'dang_gui', 'da_gui', 'khong_ro'] } },
    orderBy: { createdAt: 'asc' },
    take: deps.gioiHan ?? 10,
  });
  for (const job of cac) {
    try {
      await xuLyMotJob(deps, job);
    } catch (err) {
      // Không được để một job hỏng chặn cả hàng — ghi nhận rồi đi tiếp.
      deps.onLoi?.(job.id, err);
    }
  }
}

async function xuLyMotJob(deps: DepsChayLuot, job: JobIn): Promise<void> {
  // Job đã từng chạm máy in (crash giữa chừng, timeout…) → CHỈ xác minh.
  if (job.trangThai !== 'cho_in') {
    await xacMinh(deps, job);
    return;
  }

  if (job.lanThu >= MAX_LAN_THU) {
    await deps.prisma.printJob.update({
      where: { id: job.id },
      data: { trangThai: 'loi', loiCuoi: `Quá ${MAX_LAN_THU} lần thử: ${job.loiCuoi ?? 'không rõ'}` },
    });
    return;
  }

  // Lấy PDF TRƯỚC khi đánh dấu dang_gui: Odoo lỗi thì chưa gửi gì, retry rẻ.
  let pdf: Buffer;
  try {
    pdf = await deps.taiPdf(job.hoaDonId, job.report);
  } catch (err) {
    await deps.prisma.printJob.update({
      where: { id: job.id },
      data: { trangThai: 'cho_in', lanThu: job.lanThu + 1, loiCuoi: `Odoo không trả PDF: ${loi(err)}` },
    });
    return;
  }

  // Đánh dấu dang_gui TRƯỚC khi gọi máy in — crash giữa chừng thì lượt sau
  // thấy dang_gui và chỉ xác minh, không gửi lại mù.
  await deps.prisma.printJob.update({ where: { id: job.id }, data: { trangThai: 'dang_gui' } });
  try {
    const kq = await deps.client.inPdf(pdf, job.soHoaDon);
    await deps.prisma.printJob.update({
      where: { id: job.id },
      data: { trangThai: 'da_gui', ippJobId: kq.jobId, loiCuoi: null },
    });
  } catch (err) {
    if (err instanceof LoiKhongRo) {
      await deps.prisma.printJob.update({
        where: { id: job.id },
        data: { trangThai: 'khong_ro', loiCuoi: loi(err) },
      });
      return;
    }
    if (err instanceof LoiIpp) {
      await deps.prisma.printJob.update({
        where: { id: job.id },
        data: { trangThai: 'cho_in', lanThu: job.lanThu + 1, loiCuoi: loi(err) },
      });
      return;
    }
    throw err;
  }
}

/** Hỏi máy in về job đã có id; không có id thì đứng yên (chờ người quyết). */
async function xacMinh(deps: DepsChayLuot, job: JobIn): Promise<void> {
  if (job.ippJobId == null) return;
  let jobState: number | null;
  try {
    jobState = (await deps.client.traTrangThaiJob(job.ippJobId)).jobState;
  } catch {
    return; // máy in không trả lời được — giữ nguyên, lượt sau hỏi tiếp
  }
  if (jobState === JOB_STATE.completed) {
    await deps.prisma.printJob.update({ where: { id: job.id }, data: { trangThai: 'da_in', loiCuoi: null } });
  } else if (jobState === JOB_STATE.canceled || jobState === JOB_STATE.aborted) {
    await deps.prisma.printJob.update({
      where: { id: job.id },
      data: { trangThai: 'loi', loiCuoi: `Máy in huỷ job (job-state=${jobState})` },
    });
  }
  // pending/processing → giữ nguyên, lượt sau hỏi tiếp.
}

function loi(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
