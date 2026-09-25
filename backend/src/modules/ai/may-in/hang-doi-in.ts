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
import { taoTenFileIn } from './ten-file-in.js';
import { laMaChanIn, laMaChoMayKhongTieuLuot, nhanCua } from './nhat-ky.js';
import type { XetCauDao } from './agent-registry.js';

/** Quá số lần này mà máy in vẫn từ chối/không tới được → loi, chờ người xem. */
export const MAX_LAN_THU = 5;

/**
 * `da_huy` (v5.1, 25/09): đã huỷ CHẮC CHẮN — chỉ từ `cho_in` bằng cập nhật có điều kiện
 * (huy-lenh-in.ts), không một byte nào tới máy in. `bo_qua`: người quản lý bỏ khỏi hàng đợi
 * một job `khong_ro` — KHÔNG khẳng định gì về giấy. Cả hai là trạng thái KẾT THÚC: cron không
 * bao giờ nhặt (DIEU_KIEN_NHAT_JOB) và không bao giờ ghi đè (mọi lần ghi có điều kiện, §8.3).
 */
export type TrangThaiJob = 'cho_in' | 'dang_gui' | 'da_gui' | 'da_in' | 'khong_ro' | 'loi' | 'da_huy' | 'bo_qua';

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
    /**
     * Cập nhật CÓ ĐIỀU KIỆN — cách ghi DUY NHẤT của hàng đợi (hợp đồng v5.1 §8.3). Không còn
     * `update` trơn: giữa lúc đọc và lúc ghi, job có thể vừa bị huỷ (`da_huy`), bị bỏ theo dõi
     * (`bo_qua`) hay được kết quả trễ chốt — ghi không điều kiện là đè mất sự thật đó.
     */
    updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
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

/**
 * Ngữ cảnh job truyền xuống client lúc gửi — AgentClient ghi vào registry để
 * sự cố / kết quả app báo về (chỉ mang jobId) nối lại được với hoá đơn.
 */
export interface NguCanhGui {
  printJobId: string;
  orgId: string;
  soHoaDon: string;
  tenKhach: string | null;
}

/**
 * Sự kiện hàng đợi để ghi nhật ký (nhat-ky.ts). Hàng đợi KHÔNG tự ghi DB
 * nhật ký — chỉ báo qua callback, cron nối vào ghiNhatKy (fire-and-forget).
 */
export interface SuKienHangDoi {
  loai: string;
  noiDung: string;
  job: JobIn;
  tenKhach?: string | null;
  chiTiet?: Record<string, unknown>;
}

export interface ClientMayIn {
  inPdf(pdf: Buffer, tenJob: string, nguCanh?: NguCanhGui): Promise<{
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
  /**
   * Tên khách của chứng từ — chỉ để ĐẶT TÊN FILE in (ten-file-in.ts). Tuỳ
   * chọn: thiếu hàm, hàm ném lỗi hay trả null đều in bình thường với tên
   * khách "Khong_ro" — việc in KHÔNG bao giờ bị chặn vì không đọc được tên.
   */
  layTenKhach?: (hoaDonId: number, report: string) => Promise<string | null>;
  /** Báo sự kiện để ghi nhật ký máy in — tuỳ chọn, không bao giờ được ném. */
  nhatKy?: (e: SuKienHangDoi) => void;
  /**
   * Cầu dao theo máy in (agent-registry.ts, CauDao) — tuỳ chọn. Thiếu thì mọi
   * job gửi như trước. `agentToken` null = máy mặc định (cron tự quy đổi).
   */
  cauDao?: {
    xet: (agentToken: string | null) => XetCauDao;
    ngat: (agentToken: string | null, ma: string | null, lyDo: string) => { moi: boolean };
    /** Job thử đã THẬT SỰ được gửi — tính lượt thử (xet không tự tính). */
    daThu?: (agentToken: string | null) => void;
    /**
     * Giá trị cột `agent_token` của các máy đang ngắt và chưa tới lượt thử
     * (`null` = máy mặc định). Job của chúng bị loại khỏi truy vấn lượt.
     */
    dangGiu?: () => Array<string | null>;
  };
  /**
   * App của máy này có đang kết nối không — tuỳ chọn. `false` thì KHÔNG tải
   * PDF từ Odoo, không ghi "gửi xuống máy in" (bản trước làm cả hai mỗi phút
   * cho mỗi job dù biết chắc chưa gửi được — giám sát vòng 2, V4).
   */
  coMay?: (agentToken: string | null) => boolean;
  /**
   * Báo "hàng đợi của máy này vừa đổi" sau MỖI lần ghi print_jobs thành công (claim, kết quả,
   * thử lại, thất bại…) — cron nối vào agentRegistry để đẩy snapshot `hang-doi` cho app
   * (hợp đồng v5.1 §8.7). `agentToken` = giá trị cột (null = máy mặc định). Không bao giờ ném.
   */
  baoDoiHangDoi?: (agentToken: string | null) => void;
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
  const giu = dangGiuAnToan(deps);
  const loaiTru = dieuKienLoaiTruMay(giu);
  const cac = await deps.prisma.printJob.findMany({
    where: loaiTru ? { AND: [DIEU_KIEN_NHAT_JOB, loaiTru] } : DIEU_KIEN_NHAT_JOB,
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
  // Job của máy đang giữ không vào lượt — vẫn ghi nhật ký "nhận lệnh" + "đang
  // chờ" (mỗi job MỘT lần) để hoá đơn mới tạo lúc máy hỏng không biến mất
  // khỏi nhật ký cho tới khi máy in được lại.
  if (giu.length > 0) await baoJobDangGiu(deps, giu);
}

function dangGiuAnToan(deps: DepsChayLuot): Array<string | null> {
  try {
    return deps.cauDao?.dangGiu?.() ?? [];
  } catch {
    return [];
  }
}

/**
 * Điều kiện Prisma LOẠI job của các máy đang giữ. Cẩn thận NULL: SQL
 * `agent_token NOT IN (…)` với agent_token NULL ra NULL = loại luôn dòng đó,
 * nên job máy mặc định (NULL) phải được giữ lại bằng một nhánh OR riêng —
 * trừ khi chính máy mặc định đang giữ.
 */
export function dieuKienLoaiTruMay(giu: Array<string | null>): Record<string, unknown> | null {
  if (giu.length === 0) return null;
  const tokens = giu.filter((t): t is string => t !== null);
  const giuMacDinh = giu.includes(null);
  if (tokens.length === 0) return { agentToken: { not: null } };
  const khongPhaiMayGiu = { agentToken: { notIn: tokens } };
  return giuMacDinh ? khongPhaiMayGiu : { OR: [{ agentToken: null }, khongPhaiMayGiu] };
}

function dieuKienChiMay(giu: Array<string | null>): Record<string, unknown> {
  const tokens = giu.filter((t): t is string => t !== null);
  const nhanh: Array<Record<string, unknown>> = [];
  if (tokens.length) nhanh.push({ agentToken: { in: tokens } });
  if (giu.includes(null)) nhanh.push({ agentToken: null });
  return nhanh.length === 1 ? nhanh[0] : { OR: nhanh };
}

async function baoJobDangGiu(deps: DepsChayLuot, giu: Array<string | null>): Promise<void> {
  if (!deps.nhatKy) return;
  let cac: JobIn[];
  try {
    cac = await deps.prisma.printJob.findMany({
      where: { AND: [{ trangThai: 'cho_in' }, dieuKienChiMay(giu)] },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
  } catch {
    return;
  }
  for (const job of cac) {
    if (daBao(deps).giu.has(job.id)) continue;
    // Chỉ tên đã nhớ: tới 50 job/lượt — không được chờ Odoo từng cái.
    const tenKhach = await tenKhachCua(deps, job, true);
    if (motLan(daBao(deps).nhan, job.id)) {
      baoNhatKy(deps, { loai: 'nhan_job', noiDung: `Nhận lệnh in hoá đơn ${job.soHoaDon}`, job, tenKhach });
    }
    motLan(daBao(deps).giu, job.id);
    baoNhatKy(deps, {
      loai: 'cho_may_in',
      noiDung: `Hoá đơn ${job.soHoaDon} đang chờ: máy in đang lỗi — sẽ tự in khi máy in hết lỗi`,
      job,
      tenKhach,
    });
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
    const loiCuoi = `Quá ${MAX_LAN_THU} lần thử: ${job.loiCuoi ?? 'không rõ'}`;
    // [G1] cho_in → loi. Vừa bị huỷ (da_huy) thì dừng: không ghi "In thất bại".
    if (!(await ghiCoDieuKien(deps, job, 'cho_in', { trangThai: 'loi', loiCuoi }))) return;
    baoNhatKy(deps, {
      loai: 'that_bai',
      noiDung: `In thất bại hoá đơn ${job.soHoaDon}. ${loiCuoi}`,
      job,
      tenKhach: await tenKhachCua(deps, job),
    });
    return;
  }

  if (motLan(daBao(deps).nhan, job.id)) {
    baoNhatKy(deps, {
      loai: 'nhan_job',
      noiDung: `Nhận lệnh in hoá đơn ${job.soHoaDon}`,
      job,
      tenKhach: await tenKhachCua(deps, job),
    });
  }

  // Resolve client TRƯỚC khi đụng Odoo/máy in — không biết gửi đi đâu thì
  // GIỮ NGUYÊN cho_in (KHÔNG tăng lanThu: đây không phải "máy từ chối", là
  // "chưa từng biết máy này" — vd agentToken lạ, cấu hình sai — tăng lanThu
  // sẽ âm thầm đưa job vào 'loi' sau MAX_LAN_THU dù chưa hề thử gửi lần nào.
  // TUYỆT ĐỐI không rơi về máy khác — anh Quốc chốt: sai địa chỉ tệ hơn chưa in).
  const client = resolveClient(deps, job);
  if (!client) {
    deps.onLoi?.(job.id, new KhongCoClient(job.agentToken ?? null));
    // Job này nằm cho_in và cron gặp lại mỗi phút — chỉ ghi nhật ký MỘT lần.
    if (motLan(daBao(deps).khongCoMay, job.id)) {
      baoNhatKy(deps, {
        loai: 'khong_co_may_in',
        noiDung: `Không tìm được máy in cho hoá đơn ${job.soHoaDon} — kiểm Cài đặt › Máy in`,
        job,
        tenKhach: await tenKhachCua(deps, job),
      });
    }
    return;
  }

  // Cầu dao: máy này vừa hỏng vì MÁY IN → giữ job ở cho_in (KHÔNG tăng lanThu,
  // KHÔNG đụng Odoo/máy in); máy hết lỗi thì lượt sau in tiếp. 'thu' = tới
  // lượt một job đi thử xem máy đã được chưa.
  const xet = deps.cauDao?.xet(job.agentToken ?? null) ?? 'gui';
  if (xet === 'giu') {
    if (motLan(daBao(deps).giu, job.id)) {
      baoNhatKy(deps, {
        loai: 'cho_may_in',
        noiDung: `Hoá đơn ${job.soHoaDon} đang chờ: máy in đang lỗi — sẽ tự in khi máy in hết lỗi`,
        job,
        // Chỉ tên đã nhớ: đường "giữ" không được chờ Odoo (Odoo treo = lượt treo).
        tenKhach: await tenKhachCua(deps, job, true),
      });
    }
    return;
  }

  // App máy này chưa kết nối → khỏi tải PDF / khỏi ghi "gửi xuống máy in".
  // Chính sách cũ giữ nguyên: mỗi phút một lượt, quá MAX_LAN_THU thì thất bại.
  if (deps.coMay && !deps.coMay(job.agentToken ?? null)) {
    // [G2] cho_in → cho_in (lanThu+1). Vừa bị huỷ thì dừng: không hứa "chờ thử lại".
    const daGhi = await ghiCoDieuKien(deps, job, 'cho_in', {
      trangThai: 'cho_in', lanThu: job.lanThu + 1, loiCuoi: 'App máy in chưa kết nối',
    });
    if (!daGhi) return;
    baoNhatKy(deps, {
      loai: 'app_offline_thu_lai',
      noiDung: `App máy in chưa kết nối — hoá đơn ${job.soHoaDon} chờ thử lại (lần ${job.lanThu + 1}/${MAX_LAN_THU})`,
      job,
      tenKhach: await tenKhachCua(deps, job),
    });
    return;
  }

  // Lấy PDF TRƯỚC khi đánh dấu dang_gui: Odoo lỗi thì chưa gửi gì, retry rẻ.
  let pdf: Buffer;
  try {
    pdf = await deps.taiPdf(job.hoaDonId, job.report);
  } catch (err) {
    // [G3] cho_in → cho_in (lanThu+1). Vừa bị huỷ (tải PDF có thể mất vài giây) thì dừng.
    const daGhi = await ghiCoDieuKien(deps, job, 'cho_in', {
      trangThai: 'cho_in', lanThu: job.lanThu + 1, loiCuoi: `Odoo không trả PDF: ${loi(err)}`,
    });
    if (!daGhi) return;
    baoNhatKy(deps, {
      loai: 'loi_odoo',
      noiDung: `Odoo không trả PDF hoá đơn ${job.soHoaDon} (lần ${job.lanThu + 1}/${MAX_LAN_THU}): ${loi(err)}`,
      job,
      // Odoo đang hỏng — chỉ dùng tên đã nhớ, không gọi Odoo thêm lần nữa.
      tenKhach: await tenKhachCua(deps, job, true),
    });
    return;
  }

  // Tên khách cho TÊN FILE in — đọc TRƯỚC dang_gui (còn trong vùng "chưa gửi
  // gì"). Lỗi/không có → "Khong_ro": tên file không bao giờ được chặn việc in.
  const tenKhach = await tenKhachCua(deps, job);
  const tenFile = taoTenFileIn({ soHoaDon: job.soHoaDon, tenKhach });
  const thu = xet === 'thu' ? ' (gửi thử — máy in đang tạm giữ)' : '';

  // Đánh dấu dang_gui TRƯỚC khi gọi máy in — crash giữa chừng thì lượt sau
  // thấy dang_gui và chỉ xác minh, không gửi lại mù.
  // [G4] CLAIM cho_in → dang_gui CÓ ĐIỀU KIỆN (B2): count 0 = vừa bị huỷ (tải PDF/tên khách
  // mất vài giây — đúng khe người quản lý bấm "Huỷ") → KHÔNG gửi app, không ghi "gửi xuống
  // máy in", không tính lượt thử của cầu dao.
  if (!(await ghiCoDieuKien(deps, job, 'cho_in', { trangThai: 'dang_gui' }))) return;
  if (xet === 'thu') {
    try {
      deps.cauDao?.daThu?.(job.agentToken ?? null);
    } catch {
      /* cầu dao hỏng không được chặn việc in */
    }
  }
  baoNhatKy(deps, {
    loai: 'gui_may_in',
    noiDung: `Gửi hoá đơn ${job.soHoaDon}${tenKhach ? ` (${tenKhach})` : ''} xuống máy in${thu}`,
    job,
    tenKhach,
    chiTiet: { tenFile, lanThu: job.lanThu, ...(thu ? { guiThu: true } : {}) },
  });
  try {
    const kq = await client.inPdf(pdf, tenFile, {
      printJobId: job.id,
      orgId: job.orgId,
      soHoaDon: job.soHoaDon,
      tenKhach,
    });
    // Kênh đồng bộ (AgentClient) báo daInXong=true: Promise chỉ resolve SAU
    // khi agent xác nhận máy in vật lý đã in xong — ghi thẳng da_in, không
    // qua da_gui chờ xác minh. Thiếu field này (IPP) → giữ nguyên đường cũ:
    // da_gui rồi lượt cron sau xacMinh() mới biết in xong hay chưa (fix
    // round 1 review Task 5 — trước đây MỌI kênh đều đi qua da_gui nên
    // AgentClient bị kẹt vĩnh viễn vì ippJobId luôn null khiến xacMinh() đứng
    // yên mãi).
    if (kq.daInXong) {
      // [G5] dang_gui → da_in. Job đã rời dang_gui (sửa tay, dọn) → không ghi "Đã in" đè.
      const daGhi = await ghiCoDieuKien(deps, job, 'dang_gui', { trangThai: 'da_in', ippJobId: kq.jobId, loiCuoi: null });
      if (!daGhi) return;
      baoNhatKy(deps, { loai: 'da_in', noiDung: `Đã in hoá đơn ${job.soHoaDon}`, job, tenKhach });
    } else {
      // [G6] dang_gui → da_gui (IPP, còn chờ xác minh).
      await ghiCoDieuKien(deps, job, 'dang_gui', { trangThai: 'da_gui', ippJobId: kq.jobId, loiCuoi: null });
    }
  } catch (err) {
    if (err instanceof LoiKhongRo) {
      // [G7] dang_gui → khong_ro. count 0 → DỪNG: không nhật ký "không rõ", không ngắt cầu dao.
      if (!(await ghiCoDieuKien(deps, job, 'dang_gui', { trangThai: 'khong_ro', loiCuoi: loi(err) }))) return;
      // Máy in đang chặn in: hoá đơn nằm trong hàng đợi/bộ nhớ máy in, TỰ RA
      // khi khắc phục (app theo dõi tiếp và báo trễ "đã in"). Không thì hướng
      // dẫn kiểm tay. Không bao giờ bảo "in lại" khi chưa kiểm — in đôi.
      const huongDan = huongDanKhongRo(err.ma, err.conTrongHangDoi);
      baoNhatKy(deps, {
        loai: err.ma === 'het_gio_cho' ? 'het_gio_cho' : 'khong_ro',
        noiDung: `Không rõ hoá đơn ${job.soHoaDon} đã in chưa — ${huongDan}. ${loi(err)}`,
        job,
        tenKhach,
        chiTiet: err.ma || err.conTrongHangDoi !== undefined
          ? { suCo: err.ma ?? null, ...(err.conTrongHangDoi !== undefined ? { conTrongHangDoi: err.conTrongHangDoi } : {}) }
          : undefined,
      });
      if (err.ma === 'het_gio_cho' || laMaChanIn(err.ma)) ngatCauDao(deps, job, err.ma ?? null, loi(err), tenKhach);
      return;
    }
    if (err instanceof LoiIpp) {
      // App đã xoá job khỏi hàng đợi vì MÁY IN lỗi (hết giấy…) — lỗi của máy,
      // không phải của hoá đơn: KHÔNG tiêu lượt thử (bản trước: hết giấy quá 5
      // phút là hoá đơn thành `loi` vĩnh viễn, NV phải in tay). Cầu dao giữ các
      // lượt sau tới khi máy hết lỗi.
      const doMayIn = err.guiDuoc && laMaChanIn(err.ma);
      const khongTieuLuot = err.guiDuoc && laMaChoMayKhongTieuLuot(err.ma);
      const lanThu = khongTieuLuot ? job.lanThu : job.lanThu + 1;
      // [G8] dang_gui → cho_in (thử lại). count 0 → DỪNG: không ngắt cầu dao, không hứa "sẽ thử lại".
      if (!(await ghiCoDieuKien(deps, job, 'dang_gui', { trangThai: 'cho_in', lanThu, loiCuoi: loi(err) }))) return;
      const lan = khongTieuLuot ? '(máy in lỗi — không tính lượt thử)' : `(lần ${lanThu}/${MAX_LAN_THU})`;
      if (doMayIn) ngatCauDao(deps, job, err.ma ?? null, loi(err), tenKhach);
      baoNhatKy(deps, err.guiDuoc
        ? {
            loai: 'loi_thu_lai',
            // Chỉ hứa "tự in lại khi máy hết lỗi" khi thật sự KHÔNG tiêu lượt —
            // `loi_may_in` tiêu lượt, quá MAX_LAN_THU là that_bai (vòng 3, VỪA-1).
            noiDung: `In lỗi hoá đơn ${job.soHoaDon} ${lan}: ${loi(err)} — ${khongTieuLuot ? 'hệ thống tự in lại khi máy in hết lỗi, KHÔNG in tay' : 'sẽ thử lại'}`,
            job,
            tenKhach,
            chiTiet: err.ma ? { suCo: err.ma } : undefined,
          }
        : {
            loai: 'app_offline_thu_lai',
            noiDung: `App máy in chưa kết nối — hoá đơn ${job.soHoaDon} chờ thử lại ${lan}`,
            job,
            tenKhach,
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
  // [G9]/[G10] CHỈ khi job còn ở một trạng thái "đã gửi" — bỏ theo dõi (bo_qua) hay sửa tay
  // giữa lúc hỏi máy in và lúc ghi thì giữ nguyên.
  if (jobState === JOB_STATE.completed) {
    await ghiCoDieuKien(deps, job, TRANG_THAI_DA_GUI, { trangThai: 'da_in', loiCuoi: null });
  } else if (jobState === JOB_STATE.canceled || jobState === JOB_STATE.aborted) {
    await ghiCoDieuKien(deps, job, TRANG_THAI_DA_GUI, { trangThai: 'loi', loiCuoi: `Máy in huỷ job (job-state=${jobState})` });
  }
  // pending/processing → giữ nguyên, lượt sau hỏi tiếp.
}

/**
 * Điều kiện nhặt job mỗi lượt — sửa lỗi 13.2 (hàng đợi đói): trước đây nhặt
 * 10 job CŨ NHẤT trong cho_in/dang_gui/da_gui/khong_ro, mà job dang_gui/
 * khong_ro của app PC không có ippJobId nên xacMinh() thoát ngay — chúng
 * chiếm chỗ MÃI MÃI, đủ 10 cái là job mới không bao giờ tới lượt (24/09:
 * INV/2026/030067 nằm chờ không một dòng log). Giờ chỉ nhặt job CÒN VIỆC ĐỂ
 * LÀM: cho_in, hoặc job đã gửi mà CÓ ippJobId để hỏi lại (đường IPP).
 */
/** Trạng thái "đã chạm máy in" — xacMinh chỉ được ghi khi job còn ở một trong số này. */
const TRANG_THAI_DA_GUI: TrangThaiJob[] = ['dang_gui', 'da_gui', 'khong_ro'];

export const DIEU_KIEN_NHAT_JOB = {
  OR: [
    { trangThai: 'cho_in' },
    { trangThai: { in: ['dang_gui', 'da_gui', 'khong_ro'] }, ippJobId: { not: null } },
  ],
};

/**
 * Job app PC ở `dang_gui` quá chừng này là MỒ CÔI: server khởi động lại giữa
 * lúc chờ app (hàng chờ trong bộ nhớ mất theo). Không bao giờ còn ai trả lời
 * nó, và DIEU_KIEN_NHAT_JOB (13.2) không nhặt nó — trước đây nằm im không một
 * dòng nhật ký. Lớn hơn hẳn hạn chờ tối đa (MS_CHO_TOI_DA 10 phút).
 */
export const MS_JOB_MO_COI = 15 * 60_000;

/**
 * Chuyển job mồ côi sang khong_ro (KHÔNG gửi lại — có thể đã in) + nhật ký.
 * Cron gọi trước mỗi lượt; lỗi thì nuốt — dọn dẹp không được chặn việc in.
 */
export async function donJobMoCoi(
  deps: Pick<DepsChayLuot, 'prisma' | 'nhatKy' | 'layTenKhach' | 'baoDoiHangDoi'>,
  bayGio: number = Date.now(),
): Promise<number> {
  let cac: JobIn[];
  try {
    cac = await deps.prisma.printJob.findMany({
      where: { trangThai: 'dang_gui', ippJobId: null, updatedAt: { lt: new Date(bayGio - MS_JOB_MO_COI) } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
  } catch {
    return 0;
  }
  let n = 0;
  const data = { trangThai: 'khong_ro', loiCuoi: 'Mồ côi: server khởi động lại khi đang chờ app máy in trả lời' };
  for (const job of cac) {
    try {
      // [G11] CÓ ĐIỀU KIỆN vẫn `dang_gui`: giữa lúc đọc danh sách và lúc ghi, kết quả
      // TRỄ của app (agent-ws, job mồ côi) có thể đã chốt da_in / đưa về cho_in —
      // ghi đè là mất kết quả thật (giám sát vòng 3, đo trên Postgres thật).
      const r = await deps.prisma.printJob.updateMany({
        where: { id: job.id, trangThai: 'dang_gui', ippJobId: null },
        data,
      });
      if (r.count === 0) continue;
      baoDoi(deps as DepsChayLuot, job);
      n += 1;
      baoNhatKy(deps as DepsChayLuot, {
        loai: 'khong_ro',
        noiDung: `Không rõ hoá đơn ${job.soHoaDon} đã in chưa — server khởi động lại khi đang chờ app máy in trả lời. Kiểm máy in rồi mới in lại (hệ thống KHÔNG tự in lại để tránh in đôi).`,
        job,
        // Chỉ tên đã nhớ: ngay sau khởi động lại, Odoo chết thì tới 20 × 30 s treo lượt.
        tenKhach: await tenKhachCua(deps as DepsChayLuot, job, true),
        chiTiet: { lyDo: 'mo_coi' },
      });
    } catch {
      /* dòng sau vẫn dọn */
    }
  }
  return n;
}

/** Câu hướng dẫn cho job khong_ro — KHÔNG bao giờ bảo in lại khi hoá đơn còn có thể tự ra. */
function huongDanKhongRo(ma: string | undefined, conTrongHangDoi: boolean | undefined): string {
  if (conTrongHangDoi === true) {
    return `hoá đơn còn trong hàng đợi máy in — sẽ tự in ra${laMaChanIn(ma) ? ' sau khi khắc phục' : ''}, app theo dõi và báo khi in xong — KHÔNG in lại`;
  }
  if (laMaChanIn(ma)) {
    return conTrongHangDoi === false
      ? 'hoá đơn có thể đang nằm trong bộ nhớ máy in — khắc phục xong đợi vài phút, chỉ in lại nếu vẫn không thấy ra'
      : 'hoá đơn đang chờ trong máy in, sẽ tự in ra sau khi khắc phục — KHÔNG in lại';
  }
  if (ma === 'het_gio_cho' || ma === undefined) {
    // App im quá hạn / rớt giữa chừng: app (nhất là bản cũ) để job NẰM LẠI hàng
    // đợi Windows — nó tự in khi máy/app chạy lại. In lại trước lúc đó = 2 tờ.
    return 'hoá đơn có thể vẫn nằm trong hàng đợi máy in ở cửa hàng và tự in ra khi máy/app hoạt động lại — kiểm hàng đợi và khay giấy trước, chỉ in lại khi chắc chắn chưa ra (hệ thống KHÔNG tự in lại)';
  }
  return 'kiểm máy in rồi mới in lại (hệ thống KHÔNG tự in lại để tránh in đôi)';
}

/**
 * Ghi print_jobs CÓ ĐIỀU KIỆN trạng thái mong đợi (hợp đồng v5.1 §8.3 — MỌI lần ghi của hàng
 * đợi đi qua đây, trừ donJobMoCoi giữ điều kiện riêng có sẵn). true = đã đổi đúng một dòng.
 * false = job đã rời trạng thái đó giữa lúc đọc và lúc ghi (vừa bị huỷ → `da_huy`, bị bỏ theo
 * dõi → `bo_qua`, kết quả trễ đã chốt…): người gọi DỪNG xử lý job — không ghi nhật ký kết quả,
 * không ngắt cầu dao, không gửi app. `da_huy`/`bo_qua` vì thế không bao giờ bị ghi đè.
 */
async function ghiCoDieuKien(
  deps: DepsChayLuot,
  job: JobIn,
  dangLa: TrangThaiJob | TrangThaiJob[],
  data: Record<string, unknown>,
): Promise<boolean> {
  const trangThai = Array.isArray(dangLa) ? { in: dangLa } : dangLa;
  const r = await deps.prisma.printJob.updateMany({ where: { id: job.id, trangThai }, data });
  if (r.count === 0) return false;
  baoDoi(deps, job);
  return true;
}

/** Báo hàng đợi của máy đổi (snapshot `hang-doi` cho app) — nuốt mọi lỗi, không chặn việc in. */
function baoDoi(deps: DepsChayLuot, job: JobIn): void {
  try {
    deps.baoDoiHangDoi?.(job.agentToken ?? null);
  } catch {
    /* snapshot hỏng không được chặn việc in */
  }
}

function ngatCauDao(deps: DepsChayLuot, job: JobIn, ma: string | null, lyDo: string, tenKhach: string | null): void {
  if (!deps.cauDao) return;
  let moi = false;
  try {
    moi = deps.cauDao.ngat(job.agentToken ?? null, ma, lyDo).moi;
  } catch {
    return;
  }
  if (!moi) return;
  baoNhatKy(deps, {
    loai: 'tam_giu',
    noiDung: `Tạm giữ các hoá đơn gửi tới máy in này (${ma ? nhanCua(ma) : 'app không trả lời'}, từ hoá đơn ${job.soHoaDon}) — hệ thống tự in tiếp khi máy in hết lỗi, không cần in tay`,
    job,
    tenKhach,
    chiTiet: { suCo: ma },
  });
}

// Chống ồn nhật ký cho sự kiện cron gặp lại mỗi phút — nhớ tối đa 2.000 job.
/**
 * Tập "đã ghi" gắn với CHÍNH hàm `nhatKy` (cron tạo một lần, dùng suốt đời
 * tiến trình) — không phải biến toàn module, để hai bộ deps (hai nguồn nhật
 * ký, hay hai test) không nuốt dòng của nhau.
 */
interface DaBao {
  nhan: Set<string>;
  khongCoMay: Set<string>;
  giu: Set<string>;
}
const daBaoTheoNhatKy = new WeakMap<object, DaBao>();
const DA_BAO_RONG: DaBao = { nhan: new Set(), khongCoMay: new Set(), giu: new Set() };

function daBao(deps: DepsChayLuot): DaBao {
  const k = deps.nhatKy;
  if (!k) return DA_BAO_RONG; // không ghi nhật ký thì nhớ gì cũng vô nghĩa
  let d = daBaoTheoNhatKy.get(k);
  if (!d) {
    d = { nhan: new Set(), khongCoMay: new Set(), giu: new Set() };
    daBaoTheoNhatKy.set(k, d);
  }
  return d;
}

/**
 * Tên khách đã đọc được theo job — mọi dòng nhật ký của hoá đơn đều mang tên
 * khách (tìm theo tên ra cả dòng thất bại cuối), mà Odoo chỉ bị hỏi một lần.
 * Chỉ nhớ khi đọc ra tên (lỗi/không có thì lần sau hỏi lại). Bộ nhớ gắn với
 * CHÍNH hàm `layTenKhach` (cron tạo một lần, dùng suốt đời tiến trình) — không
 * phải biến toàn module, để hai nguồn tên (hai bộ deps) không lẫn nhau.
 */
const tenKhachDaDoc = new WeakMap<object, Map<string, string>>();

async function tenKhachCua(deps: DepsChayLuot, job: JobIn, chiNho = false): Promise<string | null> {
  const lay = deps.layTenKhach;
  if (!lay) return null;
  let nhoCuaNguon = tenKhachDaDoc.get(lay);
  if (!nhoCuaNguon) {
    nhoCuaNguon = new Map();
    tenKhachDaDoc.set(lay, nhoCuaNguon);
  }
  const nho = nhoCuaNguon.get(job.id);
  if (nho !== undefined || chiNho) return nho ?? null;
  let ten: string | null = null;
  try {
    ten = await lay(job.hoaDonId, job.report);
  } catch {
    ten = null;
  }
  if (ten) {
    if (nhoCuaNguon.size >= 2000) nhoCuaNguon.clear();
    nhoCuaNguon.set(job.id, ten);
  }
  return ten;
}

function motLan(tap: Set<string>, id: string): boolean {
  if (tap.has(id)) return false;
  if (tap.size >= 2000) tap.clear();
  tap.add(id);
  return true;
}

/** Gọi callback nhật ký — nuốt mọi lỗi: nhật ký KHÔNG được làm hỏng việc in. */
function baoNhatKy(deps: DepsChayLuot, e: SuKienHangDoi): void {
  try {
    deps.nhatKy?.(e);
  } catch {
    /* nhật ký hỏng thì bỏ qua */
  }
}

function loi(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
