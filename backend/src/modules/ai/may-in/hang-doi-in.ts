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
  /**
   * Token của print_agents (máy in) đích cho job này — Task 3 ghi lúc tạo
   * job (tra kho hoá đơn → chonMayIn). Task 5: cron đọc field này để resolve
   * ĐÚNG client cho từng job (xem DepsChayLuot.chonClient). null = job cũ
   * trước tính năng nhiều chi nhánh, hoặc tra kho fail lúc tạo job — coi như
   * máy MẶC ĐỊNH (tương thích ngược, HN không gián đoạn).
   */
  agentToken: string | null;
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
  /**
   * Token của print_agents (máy in) đích — Task 3 (nhiều máy in theo chi
   * nhánh): in-hoa-don.ts tra kho hoá đơn rồi gọi chonMayIn trước khi xếp
   * hàng. Không truyền/undefined → cột agent_token = null, cron (Task 5) coi
   * null = máy mặc định (tương thích job cũ, HN không gián đoạn).
   */
  agentToken?: string;
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
      agentToken: p.agentToken ?? null,
    },
  });
}

export interface ClientMayIn {
  inPdf(pdf: Buffer, tenJob: string): Promise<{
    jobId: number | null;
    phanHoi: PhanHoiIpp;
    /**
     * true = việc IN ĐÃ XONG THẬT khi Promise này resolve (kênh đồng bộ —
     * AgentClient: agent chỉ báo kết quả SAU khi máy in vật lý đã in xong).
     * Bỏ trống/false = như IPP: gửi xong chỉ là ĐàNG_GỬI, còn cần lượt cron
     * sau gọi traTrangThaiJob() xác minh mới biết in xong hay chưa.
     *
     * VÌ SAO field opt-in thay vì suy từ jobId==null: IppClient cũng có thể
     * hợp lệ trả jobId null (máy in không trả job-id trong phản hồi) mà VẪN
     * cần xác minh qua đường bất đồng bộ — không được lấy "không có jobId"
     * làm tín hiệu "đã xong", hai chuyện độc lập nhau.
     */
    daInXong?: boolean;
  }>;
  traTrangThaiJob(jobId: number): Promise<{ jobState: number | null; phanHoi: PhanHoiIpp }>;
}

export interface DepsChayLuot {
  prisma: PrismaHangDoiIn;
  /**
   * ĐƯỜNG CŨ (trước Task 5) — 1 client dùng chung cho MỌI job, bất kể
   * agentToken. Giữ lại CHỈ để tương thích ngược với test/gọi nơi khác chưa
   * cập nhật; nếu `chonClient` có mặt thì `chonClient` LUÔN thắng.
   */
  client?: ClientMayIn;
  /**
   * ĐƯỜNG MỚI (Task 5, "cron gửi job theo máy đích") — factory resolve
   * client THEO agentToken của TỪNG job, để job HN đi máy HN, job HCM đi máy
   * HCM, không còn 1 AgentClient duy nhất cho mọi job (khác cron.ts trước
   * Task 5). Hợp đồng:
   *   - agentToken null (job cũ / tra kho fail) → trả client máy MẶC ĐỊNH.
   *   - agentToken có giá trị nhưng máy đó chưa từng biết tới / cấu hình sai
   *     → được phép trả null: xuLyMotJob() coi như "chưa gửi được gì", GIỮ
   *     cho_in, KHÔNG bao giờ rơi về máy khác (anh Quốc chốt: sai địa chỉ
   *     còn tệ hơn chưa in). Phân biệt với "máy có nhưng ĐANG offline" — ca
   *     đó vẫn trả một ClientMayIn (vd AgentClient(registry, token, cfg)),
   *     và chính ClientMayIn đó ném AgentKhongOnline/LoiIpp(guiDuoc=false)
   *     khi gọi inPdf — hai đường đều KẾT THÚC ở cùng một chỗ (catch LoiIpp
   *     bên dưới → cho_in, lanThu+1), nên cron.ts nên ưu tiên đường thứ hai
   *     (luôn trả client thật, để lỗi rõ + lanThu tăng, dễ quan sát bằng
   *     loiCuoi) — factory trả null chỉ dùng khi THẬT SỰ không biết máy nào.
   */
  chonClient?: (agentToken: string | null) => ClientMayIn | null;
  /** Tải PDF hoá đơn từ Odoo (HoaDonAnhClient.taiPdf). */
  taiPdf: (hoaDonId: number, report: string) => Promise<Buffer>;
  /** Trần job mỗi lượt — vòng nền không được biến thành trận in ồ ạt. */
  gioiHan?: number;
  onLoi?: (jobId: string, err: unknown) => void;
}

/** Job không resolve được client nào (agentToken lạ / máy chưa cấu hình). */
class KhongCoClient extends Error {
  constructor(token: string | null) {
    super(`không tìm được client máy in cho agentToken=${token ?? 'null'}`);
    this.name = 'KhongCoClient';
  }
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

/**
 * Resolve client cho MỘT job cụ thể — tách riêng để xuLyMotJob() kiểm được
 * "có máy nào để gửi không" TRƯỚC khi tải PDF/đánh dấu dang_gui (rẻ, không
 * đụng Odoo lẫn máy in cho một job biết chắc chưa gửi được).
 *
 * `chonClient` (Task 5, đường mới) LUÔN thắng nếu có mặt. `client` (đường cũ)
 * chỉ dùng khi KHÔNG có `chonClient` — tương thích test/gọi nơi khác chưa cập
 * nhật theo agentToken (coi như "1 máy cho mọi job", đúng hành vi trước Task 5).
 */
function resolveClient(deps: DepsChayLuot, job: JobIn): ClientMayIn | null {
  if (deps.chonClient) return deps.chonClient(job.agentToken ?? null);
  return deps.client ?? null;
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

  // Resolve client TRƯỚC khi đụng Odoo/máy in — không biết gửi đi đâu thì
  // GIỮ NGUYÊN cho_in (KHÔNG tăng lanThu: đây không phải "máy từ chối", là
  // "chưa từng biết máy này" — vd agentToken lạ, cấu hình sai — tăng lanThu
  // sẽ âm thầm đưa job vào 'loi' sau MAX_LAN_THU dù chưa hề thử gửi lần nào.
  // TUYỆT ĐỐI không rơi về máy khác — anh Quốc chốt: sai địa chỉ tệ hơn chưa in).
  const client = resolveClient(deps, job);
  if (!client) {
    deps.onLoi?.(job.id, new KhongCoClient(job.agentToken ?? null));
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
    const kq = await client.inPdf(pdf, job.soHoaDon);
    // Kênh đồng bộ (AgentClient) báo daInXong=true: Promise chỉ resolve SAU
    // khi agent xác nhận máy in vật lý đã in xong — ghi thẳng da_in, không
    // qua da_gui chờ xác minh. Thiếu field này (IPP) → giữ nguyên đường cũ:
    // da_gui rồi lượt cron sau xacMinh() mới biết in xong hay chưa (fix
    // round 1 review Task 5 — trước đây MỌI kênh đều đi qua da_gui nên
    // AgentClient bị kẹt vĩnh viễn vì ippJobId luôn null khiến xacMinh() đứng
    // yên mãi).
    if (kq.daInXong) {
      await deps.prisma.printJob.update({
        where: { id: job.id },
        data: { trangThai: 'da_in', ippJobId: kq.jobId, loiCuoi: null },
      });
    } else {
      await deps.prisma.printJob.update({
        where: { id: job.id },
        data: { trangThai: 'da_gui', ippJobId: kq.jobId, loiCuoi: null },
      });
    }
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
  const client = resolveClient(deps, job);
  if (!client) return; // không biết máy nào để hỏi — giữ nguyên, không đoán bừa
  let jobState: number | null;
  try {
    jobState = (await client.traTrangThaiJob(job.ippJobId)).jobState;
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
