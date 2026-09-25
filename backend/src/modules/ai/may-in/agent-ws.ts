// SPDX-License-Identifier: AGPL-3.0-or-later
// agent-ws.ts — Namespace socket.io RIÊNG `/print-agent` cho agent PC-cầu-nối
// (chương trình chạy tại shop, nối máy in vật lý). KHÔNG dùng chung namespace
// gốc/JWT user (socket-auth.ts) vì agent không phải người dùng đăng nhập —
// nó chỉ có 1 quyền hẹp: nhận job in + báo kết quả.
//
// VÌ SAO namespace riêng thay vì thêm nhánh rẽ vào registerSocketAuth: namespace
// khác của socket.io có handshake/middleware độc lập — không sợ đụng logic
// room org/user hiện có, và agent rớt mạng không ảnh hưởng socket user khác.
//
// Task 4 (10/09, nhiều chi nhánh) — ĐIỂM SINH TỬ: trước đây auth chỉ so
// `authToken === process.env.AI_MAY_IN_AGENT_TOKEN` (1 token duy nhất cho cả
// hệ, key registry = orgId). Giờ nhiều máy = nhiều token (bảng print_agents,
// Task 1), registry key đổi sang TOKEN (agent-registry.ts). Handshake phải:
//
//   1. Token khớp 1 dòng trong print_agents  → NHẬN, key registry = token đó.
//   2. Token KHÔNG có trong bảng NHƯNG == env AI_MAY_IN_AGENT_TOKEN cũ → VẪN
//      NHẬN (tương thích agent HN cũ đang chạy prod, khai đúng token env này
//      trước khi bảng print_agents tồn tại hoặc trước khi dòng HN được seed —
//      xem plan-may-in-nhieu-chi-nhanh.md "Global Constraints"). Agent HN
//      TUYỆT ĐỐI không được gián đoạn bởi việc đổi sang định tuyến theo token.
//   3. Token không khớp gì cả → reject 'unauthorized'.
//
// So token dùng timingSafeEqual (chống timing attack), giống mẫu so authToken
// bản cũ — KHÔNG so bằng `===` cho chuỗi bí mật.
import type { Server, Socket } from 'socket.io';
import { timingSafeEqual } from 'node:crypto';
import { logger } from '../../../shared/utils/logger.js';
import { prisma } from '../../../shared/database/prisma-client.js';
import { AgentRegistry, type KetQuaAgent, type NguCanhJob } from './agent-registry.js';
import { tachPrintJobId } from './agent-client.js';
import {
  ghiNhatKy as ghiNhatKyThat,
  laMaSuCo,
  laMaChanIn,
  laMaChoMayKhongTieuLuot,
  laMaCapMayIn,
  nhanCua,
  catChu,
  cheToken,
  catTienToToken,
  orgMacDinhTuEnv,
  type MucNhatKy,
} from './nhat-ky.js';
import {
  nhanNhatKyApp as nhanNhatKyAppThat,
  taoGioiHanNhatKyApp,
  type AckNhatKyApp,
  type NhanNhatKyApp,
} from './nhat-ky-app.js';
import {
  taoDichVuHangDoi,
  type DichVuHangDoi,
  type KetQuaBoTheoDoi,
  type KetQuaHuy,
  type NguonYeuCau,
  type PhamViHangDoi,
} from './huy-lenh-in.js';
import { taoBoGuiHangDoi, MS_GUI_HANG_DOI_TOI_THIEU } from './hang-doi-app.js';

interface KetQuaTuAgent {
  jobId: string;
  trangThai: 'da_in' | 'loi' | 'khong_ro';
  loiCuoi?: string;
  loai?: string;
  conTrongHangDoi?: boolean;
}

/** Dòng print_jobs tối thiểu để dựng lại ngữ cảnh job sau khi backend khởi động lại. */
export interface JobTraLai {
  id: string;
  orgId: string;
  soHoaDon: string;
  agentToken: string | null;
  /** Lần đổi trạng thái cuối — trước mốc khởi động tiến trình = mồ côi của tiến trình trước. */
  updatedAt: Date;
}

/** Mốc tiến trình này khởi động — job `dang_gui` đổi TRƯỚC mốc này là mồ côi. */
const MOC_KHOI_DONG = new Date();

/**
 * Khả năng backend quảng bá cho app qua event `cau-hinh` (hợp đồng §2).
 * `nhat_ky_app` (25/09): app gửi TOÀN BỘ nhật ký .txt cục bộ qua event `nhat-ky-app` (nhat-ky-app.ts).
 * `hang_doi` (25/09, hợp đồng hàng đợi/huỷ v5.1 §8.7): server đẩy `hang-doi`; app hỏi lại bằng
 * `lay-hang-doi`, huỷ bằng `yeu-cau-huy` (ack KetQuaHuy), bỏ theo dõi bằng `yeu-cau-bo-theo-doi`.
 */
export const HO_TRO_APP = ['khong_ro', 'su_co', 'trang_thai_may_in', 'nhat_ky_app', 'hang_doi'] as const;

/** Thời gian chờ `thong-tin-app` trước khi ghi nhật ký `app_ket_noi` — gộp 2 sự kiện làm 1 dòng. */
const MS_CHO_THONG_TIN = 1500;
/** Mất kết nối quá chừng này mà chưa nối lại → dòng cảnh báo `app_offline_lau`. */
const MS_OFFLINE_LAU = 2 * 60_000;
/**
 * Kết quả trễ tới đúng lúc hàng đợi CHƯA kịp ghi khong_ro (vừa hết hạn chờ,
 * lệnh update còn đang bay) → cập nhật trúng 0 dòng. Thử lại một lần sau chừng này.
 */
const MS_THU_LAI_TRE = 3_000;

/** Chữ sau dấu "—" của một câu nhật ký, bỏ trống thì không thêm gì. */
function them(chu: string | null | undefined): string {
  return chu ? ` — ${chu}` : '';
}

/** Dòng print_agents tối thiểu cần cho handshake — deps test chỉ cần trả field này. */
export interface MayInTraVe {
  token: string;
}

export interface AgentWsDeps {
  /**
   * Tra 1 dòng print_agents theo token. Mặc định = query Prisma thật.
   * Inject được cho test (socket thật, DB giả) — xem agent-ws.func.ts.
   */
  layMayInTheoToken?: (token: string) => Promise<MayInTraVe | null>;
  /** Ghi nhật ký máy in — mặc định singleton thật (fire-and-forget). */
  ghiNhatKy?: (m: MucNhatKy) => void;
  /**
   * Kết quả ĐẾN TRỄ (sau hạn chờ): cập nhật print_jobs CHỈ KHI job còn
   * `khong_ro` — trả số dòng đã đổi. Mặc định Prisma thật.
   *   - `da_in` → da_in.
   *   - `thu_lai` (app báo `loi` = đã xoá sạch job, chưa byte nào ra máy — §0.1)
   *     → về cho_in để hàng đợi gửi lại; `tangLanThu` false khi lỗi do MÁY IN.
   *     Bản trước ghi `loi` CUỐI CÙNG: hoá đơn không bao giờ in trong khi app
   *     bảo NV "hệ thống sẽ TỰ gửi in lại" (giám sát vòng 2, V2).
   */
  capNhatJobTre?: (printJobId: string, kq: KetQuaTre, loiCuoi: string | null, tuy?: { choPhepDangGui?: boolean }) => Promise<number>;
  /**
   * Tra print_jobs theo id — dựng lại ngữ cảnh khi bộ nhớ đã mất (backend khởi
   * động lại giữa lúc in: mỗi lần deploy). Mặc định Prisma thật.
   */
  layJobTheoId?: (printJobId: string) => Promise<JobTraLai | null>;
  /**
   * Hoá đơn của job này đã có lệnh in MỚI HƠN (cùng org, hoá đơn, mẫu in) mà
   * chưa `loi` không — người trực thấy "không rõ" nên đã in lại. Kết quả trễ
   * `loi` khi đó KHÔNG được kéo job cũ về cho_in (thành 2 tờ). Mặc định Prisma thật.
   */
  coLenhInMoiHon?: (printJobId: string) => Promise<boolean>;
  /**
   * Nhận một lô `nhat-ky-app` → ack (nhat-ky-app.ts). Mặc định singleton thật (Prisma).
   * Không bao giờ ném — lỗi thành `{ ok: false, loi }`, app tự gửi lại.
   */
  nhanNhatKyApp?: NhanNhatKyApp;
  /**
   * Hàng đợi + huỷ lệnh in (huy-lenh-in.ts). Mặc định: Prisma thật + registry của namespace này
   * + ghiNhatKy ở trên. Test tiêm bản dựng trên Prisma giả.
   */
  dichVuHangDoi?: DichVuHangDoi;
  /** Cho test rút ngắn giới hạn 1 snapshot/giây/socket. */
  msGuiHangDoi?: number;
  /**
   * Org của máy mặc định (env AI_MAY_IN_ORG_ID — cùng org cron + nhật ký dùng): job agent_token
   * NULL chỉ thuộc phạm vi socket máy mặc định khi ở org này. Mặc định đọc env.
   */
  orgMacDinh?: () => string | null;
  /** Cho test — mặc định lúc nạp module. */
  mocKhoiDong?: Date;
  /** Cho test rút ngắn MS_CHO_THONG_TIN / MS_OFFLINE_LAU / MS_THU_LAI_TRE. */
  msChoThongTin?: number;
  msOfflineLau?: number;
  msThuLaiTre?: number;
}

export type KetQuaTre =
  | { trangThai: 'da_in' }
  | { trangThai: 'thu_lai'; tangLanThu: boolean }
  /** `loi` trễ mà hoá đơn đã có lệnh in mới hơn → chốt `loi`, không gửi lại. */
  | { trangThai: 'loi' };

async function capNhatJobTreThat(
  printJobId: string,
  kq: KetQuaTre,
  loiCuoi: string | null,
  tuy: { choPhepDangGui?: boolean } = {},
): Promise<number> {
  const data = kq.trangThai === 'da_in'
    ? { trangThai: 'da_in', loiCuoi: null }
    : kq.trangThai === 'loi'
      ? { trangThai: 'loi', loiCuoi }
      : { trangThai: 'cho_in', loiCuoi, ...(kq.tangLanThu ? { lanThu: { increment: 1 } } : {}) };
  const trangThai = tuy.choPhepDangGui ? { in: ['khong_ro', 'dang_gui'] } : 'khong_ro';
  const r = await prisma.printJob.updateMany({ where: { id: printJobId, trangThai }, data });
  return r.count;
}

async function layJobTheoIdThat(printJobId: string): Promise<JobTraLai | null> {
  return prisma.printJob.findUnique({
    where: { id: printJobId },
    select: { id: true, orgId: true, soHoaDon: true, agentToken: true, updatedAt: true },
  });
}

/** Lệnh cùng hoá đơn ở các trạng thái này không tính là "đã có lệnh in mới hơn". */
export const TRANG_THAI_KHONG_PHAI_LENH_MOI = ['loi', 'da_huy', 'bo_qua'];

/** Cảnh báo dựng snapshot hàng đợi hỏng — tối đa 1 lần/phút cho khỏi ngập log. */
let lanCanhBaoHangDoi = 0;
function canhBaoHangDoi(err: unknown): void {
  if (Date.now() - lanCanhBaoHangDoi < 60_000) return;
  lanCanhBaoHangDoi = Date.now();
  logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[may-in] không dựng được snapshot hàng đợi cho app');
}

/** Payload từ app: object, hoặc mảng một phần tử (rust_socketio) — còn lại coi như rỗng. */
function bocPayload(x: unknown): Record<string, unknown> {
  const o = Array.isArray(x) ? x[0] : x;
  return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
}

async function coLenhInMoiHonThat(printJobId: string): Promise<boolean> {
  const j = await prisma.printJob.findUnique({
    where: { id: printJobId },
    select: { orgId: true, hoaDonId: true, report: true, createdAt: true },
  });
  if (!j) return false;
  const moi = await prisma.printJob.findFirst({ where: dieuKienLenhInMoiHon(printJobId, j), select: { id: true } });
  return moi !== null;
}

/**
 * Điều kiện "lệnh in MỚI HƠN cùng hoá đơn + mẫu in, còn hiệu lực". `loi` (thất bại), `da_huy`
 * (chắc chắn không in) và `bo_qua` (người quản lý bỏ) KHÔNG tính — hợp đồng hàng đợi/huỷ v5.1
 * §8.4: huỷ lệnh in lại thì kết quả trễ `loi` của lệnh cũ vẫn được đưa về cho_in như thường.
 */
export function dieuKienLenhInMoiHon(
  printJobId: string,
  j: { orgId: string; hoaDonId: number; report: string; createdAt: Date },
): Record<string, unknown> {
  return {
    orgId: j.orgId, hoaDonId: j.hoaDonId, report: j.report,
    createdAt: { gt: j.createdAt }, id: { not: printJobId }, trangThai: { notIn: TRANG_THAI_KHONG_PHAI_LENH_MOI },
  };
}

/** So 2 chuỗi timing-safe — độ dài khác nhau thì false ngay, KHÔNG ném lỗi
 * (timingSafeEqual của Node ném nếu 2 buffer khác length). */
function soTokenAnToan(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function layMayInTuDb(token: string): Promise<MayInTraVe | null> {
  const agent = await prisma.printAgent.findUnique({ where: { token } });
  return agent ? { token: agent.token } : null;
}

/**
 * Đăng ký namespace `/print-agent`. Gọi SAU registerSocketAuth ở app.ts (thứ
 * tự không bắt buộc về mặt kỹ thuật vì đây là namespace khác, nhưng giữ cùng
 * chỗ để dễ đọc thứ tự khởi tạo realtime).
 *
 * Thiếu env AI_MAY_IN_AGENT_TOKEN → KHÔNG đăng ký namespace: không để hệ
 * thống mở một cửa WS không ai canh. Biến này vẫn là "chìa khoá tương thích
 * HN" (điểm 2 ở trên) dù bảng print_agents giờ là nguồn định tuyến chính —
 * thiếu nó thì tắt hẳn tính năng (nhất quán với tu-env.ts: thiếu cấu hình =
 * tắt hẳn).
 */
export function registerAgentWs(io: Server, registry: AgentRegistry, deps: AgentWsDeps = {}): void {
  const envToken = process.env.AI_MAY_IN_AGENT_TOKEN;
  if (!envToken) {
    logger.warn('[may-in] AI_MAY_IN_AGENT_TOKEN chưa đặt — không bật WS /print-agent');
    return;
  }
  const layMayInTheoToken = deps.layMayInTheoToken ?? layMayInTuDb;
  const ghiNhatKy: (m: MucNhatKy) => void = deps.ghiNhatKy ?? ghiNhatKyThat;
  const capNhatJobTre = deps.capNhatJobTre ?? capNhatJobTreThat;
  const layJobTheoId = deps.layJobTheoId ?? layJobTheoIdThat;
  const coLenhInMoiHon = deps.coLenhInMoiHon ?? coLenhInMoiHonThat;
  const nhanNhatKyApp = deps.nhanNhatKyApp ?? nhanNhatKyAppThat;
  const mocKhoiDong = deps.mocKhoiDong ?? MOC_KHOI_DONG;
  const msChoThongTin = deps.msChoThongTin ?? MS_CHO_THONG_TIN;
  const msOfflineLau = deps.msOfflineLau ?? MS_OFFLINE_LAU;
  const msThuLaiTre = deps.msThuLaiTre ?? MS_THU_LAI_TRE;
  const dichVuHangDoi = deps.dichVuHangDoi ?? taoDichVuHangDoi({ registry, tokenMacDinh: envToken, ghiNhatKy });
  const msGuiHangDoi = deps.msGuiHangDoi ?? MS_GUI_HANG_DOI_TOI_THIEU;
  const orgMacDinh = deps.orgMacDinh ?? orgMacDinhTuEnv;
  /** Máy đang mất kết nối: từ lúc nào, hẹn giờ cảnh báo, đã cảnh báo chưa. */
  const matKetNoi = new Map<string, { tu: number; hen: ReturnType<typeof setTimeout>; daBao: boolean }>();

  const nsp = io.of('/print-agent');

  nsp.use((socket, next) => {
    const authToken = socket.handshake.auth?.token as string | undefined;
    if (!authToken) {
      return next(new Error('unauthorized'));
    }
    void (async () => {
      let mayIn: MayInTraVe | null = null;
      try {
        mayIn = await layMayInTheoToken(authToken);
      } catch (err) {
        // Tra DB lỗi (mất kết nối, timeout...) KHÔNG được kéo sập agent HN —
        // đây chính là "HN không gián đoạn": máy HN khai đúng token env vẫn
        // phải được nhận dù bảng print_agents không tra được lúc này. Chỉ
        // token LẠ (không khớp env) mới bị ảnh hưởng bởi lỗi DB (reject —
        // an toàn, vì không xác minh được).
        logger.error({ err }, '[may-in] lỗi tra print_agents lúc handshake — chỉ nhận nếu khớp token HN cũ');
      }
      if (mayIn && soTokenAnToan(mayIn.token, authToken)) {
        socket.data.token = authToken;
        return next();
      }
      // Không có dòng trong bảng (hoặc tra lỗi) — tương thích HN: token ==
      // env cũ vẫn nhận, coi là máy HN.
      if (soTokenAnToan(authToken, envToken)) {
        socket.data.token = authToken;
        return next();
      }
      return next(new Error('unauthorized'));
    })();
  });

  nsp.on('connection', (socket: Socket) => {
    const token = socket.data.token as string;
    logger.info(`[may-in] agent kết nối (token ...${token.slice(-4)}, socket ${socket.id})`);

    const huy = registry.dangKy(token, (msg) => {
      socket.emit('job', msg);
    });
    // Nối lại sau một lần mất kết nối: huỷ cảnh báo đang hẹn; đã cảnh báo thì
    // dòng app_ket_noi nói rõ mất bao lâu.
    const mat = matKetNoi.get(token);
    let sauMatKetNoi = '';
    if (mat) {
      clearTimeout(mat.hen);
      matKetNoi.delete(token);
      if (mat.daBao) sauMatKetNoi = ` — sau ${Math.max(1, Math.round((Date.now() - mat.tu) / 60_000))} phút mất kết nối`;
    }
    /** Chữ từ app (mạng) → cắt độ dài + che token (luật 2 nhat-ky.ts). */
    // Che TRƯỚC rồi mới cắt: cắt trước thì token vắt qua mép bị lọt nửa đầu.
    const chuTuApp = (x: unknown, tran: number): string | null =>
      catChu(x === null || x === undefined ? x : cheToken(String(x), token), tran);

    // Quảng bá khả năng — app bản mới chỉ gửi khong_ro / su-co / trạng thái
    // máy in khi thấy event này (backend cũ không gửi → app giữ hành vi cũ).
    socket.emit('cau-hinh', { hoTro: [...HO_TRO_APP] });

    // ── Hàng đợi của CHÍNH máy này (v5.1 §8.7) ──────────────────────────────
    // Phạm vi máy: agent_token = token socket, hoặc NULL (trong org mặc định env) khi socket là máy mặc định.
    const phamViMay: PhamViHangDoi = { loai: 'may', token, tokenMacDinh: envToken, orgMacDinh: orgMacDinh() };
    const boGuiHangDoi = taoBoGuiHangDoi({
      lay: () => dichVuHangDoi.layHangDoi(phamViMay),
      gui: (hd) => socket.emit('hang-doi', hd),
      msToiThieu: msGuiHangDoi,
      onLoi: canhBaoHangDoi,
    });
    const boNgheHangDoi = registry.ngheDoiHangDoi(token, () => boGuiHangDoi.yeuCau());
    boGuiHangDoi.yeuCau({ boQuaSoTrung: true }); // ngay sau cau-hinh
    socket.on('lay-hang-doi', () => boGuiHangDoi.yeuCau({ boQuaSoTrung: true }));
    /** Nguồn ghi nhật ký — tên máy tính từ `thong-tin-app.may` (đã qua chuTuApp). */
    const nguonApp = (): NguonYeuCau => ({ loai: 'app', may: thongTinApp?.may ?? null });

    // Huỷ từ app — CÓ ack KetQuaHuy (§8.2, phạm vi máy). Lỗi DB thì KHÔNG ack: app hết giờ
    // 20 s → "Chưa rõ — xem lại hàng đợi" + `lay-hang-doi`. Không bao giờ bịa kết quả.
    socket.on('yeu-cau-huy', (payload: unknown, ack?: unknown) => {
      const traLoi = (kq: KetQuaHuy): void => {
        if (typeof ack === 'function') (ack as (kq: KetQuaHuy) => void)(kq);
      };
      const id = chuTuApp(bocPayload(payload).printJobId, 64);
      if (!id) {
        traLoi({ id: '', soHoaDon: null, ok: false, trangThaiMoi: null, loi: 'KHONG_TIM_THAY', noiDung: 'Thiếu mã lệnh in (printJobId).' });
        return;
      }
      dichVuHangDoi.huyLenhIn(phamViMay, [id], nguonApp()).then(
        (kq) => traLoi(kq[0]),
        (err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[may-in] yeu-cau-huy lỗi — không ack (app sẽ hỏi lại hàng đợi)'),
      ).catch((err: unknown) => logger.warn({ err }, '[may-in] yeu-cau-huy: không ack được'));
    });

    // Bỏ theo dõi từ app — CÓ ack {id, ok, noiDung} (§8.5, phạm vi máy).
    socket.on('yeu-cau-bo-theo-doi', (payload: unknown, ack?: unknown) => {
      const traLoi = (kq: KetQuaBoTheoDoi): void => {
        if (typeof ack === 'function') (ack as (kq: KetQuaBoTheoDoi) => void)(kq);
      };
      const id = chuTuApp(bocPayload(payload).printJobId, 64);
      if (!id) {
        traLoi({ id: '', ok: false, noiDung: 'Thiếu mã lệnh in (printJobId).' });
        return;
      }
      dichVuHangDoi.boTheoDoi(phamViMay, [id], nguonApp()).then(
        (kq) => traLoi(kq[0]),
        (err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[may-in] yeu-cau-bo-theo-doi lỗi — không ack'),
      ).catch((err: unknown) => logger.warn({ err }, '[may-in] yeu-cau-bo-theo-doi: không ack được'));
    });

    // ── Nhật ký kết nối: chờ thong-tin-app một chút để gộp thành 1 dòng ──
    let thongTinApp: Record<string, string | null> | null = null;
    let daGhiKetNoi = false;
    const ghiKetNoi = (): void => {
      if (daGhiKetNoi) return;
      daGhiKetNoi = true;
      clearTimeout(henGhiKetNoi);
      const mo = thongTinApp
        ? [
            thongTinApp.mayIn && `máy in "${thongTinApp.mayIn}"`,
            thongTinApp.may && `máy tính ${thongTinApp.may}`,
            thongTinApp.phienBan && `app v${thongTinApp.phienBan}`,
          ].filter(Boolean).join(', ')
        : '';
      ghiNhatKy({
        loai: 'app_ket_noi',
        noiDung: `App máy in kết nối${mo ? ` (${mo})` : ''}${sauMatKetNoi}`,
        agentToken: token,
        chiTiet: thongTinApp ? { ...thongTinApp } : null,
      });
    };
    const henGhiKetNoi = setTimeout(ghiKetNoi, msChoThongTin);

    socket.on('thong-tin-app', (tt: unknown) => {
      const o = (tt && typeof tt === 'object' ? tt : {}) as Record<string, unknown>;
      thongTinApp = {
        phienBan: chuTuApp(o.phienBan, 40),
        mayIn: chuTuApp(o.mayIn, 200),
        khay: chuTuApp(o.khay, 40),
        khoGiay: chuTuApp(o.khoGiay, 40),
        may: chuTuApp(o.may, 100),
      };
      ghiKetNoi();
    });

    socket.on('ket-qua', (kq: KetQuaTuAgent) => {
      if (!kq || typeof kq.jobId !== 'string') return;
      // Giá trị lạ/thiếu → khong_ro (KHÔNG thử lại). Bản trước ép thành 'loi' =
      // cho gửi lại một kết quả mơ hồ — đúng loại lỗi luật A3 cấm (giám sát V2).
      const trangThai = kq.trangThai === 'da_in' || kq.trangThai === 'loi' || kq.trangThai === 'khong_ro'
        ? kq.trangThai
        : 'khong_ro';
      const ketQua: KetQuaAgent = {
        trangThai,
        loiCuoi: chuTuApp(kq.loiCuoi, 500) ?? undefined,
        loai: laMaSuCo(kq.loai) ? kq.loai : undefined,
        ...(trangThai === 'khong_ro' && typeof kq.conTrongHangDoi === 'boolean' ? { conTrongHangDoi: kq.conTrongHangDoi } : {}),
      };
      if (registry.nhanKetQua(token, kq.jobId, ketQua)) {
        // Có người chờ = job hàng đợi CHÍNH tiến trình này vừa claim (`dang_gui`, có điều kiện —
        // hang-doi-in [G4]); huỷ chỉ đụng `cho_in`, bỏ theo dõi chỉ đụng `khong_ro` → job này
        // không thể đã bị huỷ/bỏ: `da_in` là bằng chứng máy in chạy.
        if (trangThai === 'da_in') mayInDaInDuoc(kq.jobId);
        return;
      }
      // Không ai chờ → kết quả ĐẾN TRỄ (đã hết hạn chờ, job thành khong_ro) —
      // gồm cả kết quả app "theo dõi tiếp" gửi khi job kẹt in ra sau khắc phục.
      void xuLyKetQuaTre(kq.jobId, ketQua);
    });

    /**
     * App vừa in được một hoá đơn = BẰNG CHỨNG máy in chạy: đóng cầu dao (hàng
     * đợi in tiếp các hoá đơn đang giữ) và xoá chip sự cố đang kẹt — máy in mạng
     * nhiều khi chỉ bật cờ lỗi trên JOB, không bao giờ gửi trạng thái cấp máy
     * "bình thường" để xoá (giám sát: chip "Hết giấy · 2 giờ trước").
     */
    function mayInDaInDuoc(jobId: string): void {
      const nc = registry.layNguCanhCua(token, jobId);
      const hd = nc ? ` hoá đơn ${nc.soHoaDon}` : ' một hoá đơn';
      const cu = registry.layTinhTrang(token);
      if (cu && laMaChanIn(cu.ma)) {
        registry.capNhatTinhTrang(token, { ma: 'binh_thuong', luc: new Date(), nguon: 'may' });
        ghiNhatKy({
          loai: 'binh_thuong',
          noiDung: `Máy in đã in được${hd} — hết sự cố (${nhanCua(cu.ma)})`,
          agentToken: token,
          orgId: nc?.orgId,
          chiTiet: { truoc: cu.ma, theo: 'da_in' },
        });
      }
      const cd = registry.dongCauDao(token);
      if (cd) {
        ghiNhatKy({
          loai: 'tiep_tuc_in',
          noiDung: `Máy in hoạt động lại (đã in${hd}) — tiếp tục in các hoá đơn đang chờ`,
          agentToken: token,
          orgId: nc?.orgId,
          chiTiet: { tamGiuTu: cd.tu.toISOString(), suCo: cd.ma },
        });
      }
    }

    /**
     * Ngữ cảnh job của ĐÚNG máy này: bộ nhớ trước; mất (backend khởi động lại)
     * thì tra DB theo id print_jobs nằm trong id job "<printJobId>-<ms>" — và
     * chỉ nhận khi dòng đó thuộc máy này (token trùng, hoặc NULL = máy mặc định
     * env). `moCoi` = job đổi trạng thái lần cuối TRƯỚC khi tiến trình này
     * khởi động → không hàng chờ nào của tiến trình này có thể đang giữ nó
     * (giám sát vòng 3: "không có ngữ cảnh cho ĐÚNG id này" chưa đủ — lần gửi
     * khác của cùng print_job có thể đang chờ).
     */
    async function nguCanhCua(jobId: string): Promise<{ nc: NguCanhJob; moCoi: boolean } | null> {
      const trongBoNho = registry.layNguCanhCua(token, jobId);
      if (trongBoNho) return { nc: trongBoNho, moCoi: false };
      const printJobId = tachPrintJobId(jobId);
      if (!printJobId) return null;
      try {
        const j = await layJobTheoId(printJobId);
        if (!j) return null;
        const dungMay = j.agentToken ? soTokenAnToan(j.agentToken, token) : soTokenAnToan(token, envToken);
        if (!dungMay) return null;
        return {
          nc: { printJobId: j.id, orgId: j.orgId, soHoaDon: j.soHoaDon, tenKhach: null, token },
          moCoi: new Date(j.updatedAt).getTime() < mocKhoiDong.getTime(),
        };
      } catch (err) {
        logger.warn({ err, jobId: catTienToToken(jobId, token) }, '[may-in] không tra được print_jobs cho kết quả/sự cố trễ');
        return null;
      }
    }

    /** Kết quả trễ: ghi nhật ký; job còn khong_ro thì chốt theo kết quả thật. */
    async function xuLyKetQuaTre(jobId: string, kq: KetQuaAgent): Promise<void> {
      // Chỉ job gửi cho ĐÚNG máy này (V3) — id của máy khác thì chỉ ghi nhật ký trơn.
      const tim = await nguCanhCua(jobId);
      const nc = tim?.nc ?? null;
      let daCapNhat = 0;
      let coMoiHon = false;
      const doMayIn = kq.trangThai === 'loi' && laMaChanIn(kq.loai);
      if (nc && (kq.trangThai === 'da_in' || kq.trangThai === 'loi')) {
        try {
          coMoiHon = await coLenhInMoiHon(nc.printJobId);
        } catch {
          coMoiHon = false;
        }
        const loiGoc = kq.trangThai === 'loi' ? (kq.loiCuoi ?? nhanCua(kq.loai)) || 'App báo lỗi (kết quả trễ)' : null;
        const loiCuoi = loiGoc && coMoiHon ? `${loiGoc} — đã có lệnh in mới cho hoá đơn này, không tự gửi lại` : loiGoc;
        const ketQuaTre: KetQuaTre = kq.trangThai === 'da_in'
          ? { trangThai: 'da_in' }
          : coMoiHon
            ? { trangThai: 'loi' }
            : { trangThai: 'thu_lai', tangLanThu: !laMaChoMayKhongTieuLuot(kq.loai) };
        // Job mồ côi của tiến trình trước (backend vừa khởi động lại) còn
        // `dang_gui`: nhận kết quả thật luôn, khỏi chờ dọn mồ côi 15 phút.
        const tuy = { choPhepDangGui: tim?.moCoi === true };
        const capNhat = async (): Promise<number> => {
          try {
            return await capNhatJobTre(nc.printJobId, ketQuaTre, loiCuoi, tuy);
          } catch (err) {
            logger.warn({ err, jobId: catTienToToken(jobId, token) }, '[may-in] không cập nhật được job từ kết quả trễ');
            return 0;
          }
        };
        daCapNhat = await capNhat();
        // Hàng đợi có thể chưa kịp ghi khong_ro (vừa hết hạn chờ) → thử lại một lần.
        if (!daCapNhat) {
          await new Promise((r) => setTimeout(r, msThuLaiTre));
          daCapNhat = await capNhat();
        }
      }
      // v5.1 §8.3: kết quả trễ KHÔNG đổi được job (job đã `da_huy`/`bo_qua`/đã chốt, hoặc không
      // phải job của máy này) → không coi là bằng chứng máy in chạy: không đóng cầu dao, không
      // xoá chip sự cố. Đổi được → hàng đợi của máy đổi, đẩy snapshot cho app.
      if (kq.trangThai === 'da_in' && daCapNhat > 0) mayInDaInDuoc(jobId);
      if (daCapNhat > 0) registry.baoDoiHangDoi(token);
      // Máy in lỗi (app đã xoá job) → giữ các hoá đơn sau như đường thường —
      // CHỈ khi kết quả này thật sự đổi được job (vòng 3: kết quả cũ/lạ của job
      // đã in hoặc đã dọn tay từng ngắt cầu dao oan + nêu hoá đơn đã in).
      if (doMayIn && nc && daCapNhat > 0 && !coMoiHon) {
        const { moi } = registry.ngatCauDao(token, kq.loai ?? null, kq.loiCuoi ?? nhanCua(kq.loai));
        if (moi) {
          ghiNhatKy({
            loai: 'tam_giu',
            noiDung: `Tạm giữ các hoá đơn gửi tới máy in này (${nhanCua(kq.loai)}, từ hoá đơn ${nc.soHoaDon}) — hệ thống tự in tiếp khi máy in hết lỗi, không cần in tay`,
            agentToken: token,
            orgId: nc.orgId,
            printJobId: nc.printJobId,
            soHoaDon: nc.soHoaDon,
            tenKhach: nc.tenKhach,
            chiTiet: { suCo: kq.loai ?? null },
          });
        }
      }
      // Câu nói ĐÚNG việc đã xảy ra với job — chỉ hứa "tự gửi lại" khi đã đưa về cho_in.
      const moTa = kq.trangThai === 'da_in'
        ? 'đã in'
        : kq.trangThai !== 'loi'
          ? 'không rõ'
          : !daCapNhat
            ? 'lỗi (trạng thái job không đổi — hệ thống KHÔNG tự gửi lại)'
            : coMoiHon
              ? 'lỗi — đã có lệnh in mới cho hoá đơn này, không tự gửi lại'
              : 'lỗi — app đã gỡ job, hệ thống sẽ tự gửi in lại';
      const canhBaoHaiTo = kq.trangThai === 'da_in' && coMoiHon
        ? ' — LƯU Ý: hoá đơn này đã có lệnh in mới, có thể ra 2 tờ'
        : '';
      ghiNhatKy({
        loai: 'ket_qua_tre',
        // `da_in` kèm ghi chú (app: job kẹt rồi biến mất, không thấy bước in
        // cuối — in nốt sau khi nạp giấy HOẶC bị xoá tay) → cảnh báo để còn kiểm.
        mucDo: kq.trangThai === 'da_in' && !coMoiHon && !kq.loiCuoi ? 'thong_tin' : 'canh_bao',
        noiDung: kq.trangThai === 'da_in' && nc
          ? `Hoá đơn ${nc.soHoaDon} đã in — app xác nhận sau hạn chờ${daCapNhat ? ' (đã cập nhật trạng thái job)' : ''}${them(kq.loiCuoi)}${canhBaoHaiTo}`
          : `Kết quả đến trễ${nc ? ` cho hoá đơn ${nc.soHoaDon}` : ''}: ${moTa}${them(kq.loiCuoi)}${daCapNhat ? ' (đã cập nhật trạng thái job)' : ''}`,
        agentToken: token,
        orgId: nc?.orgId,
        printJobId: nc?.printJobId,
        soHoaDon: nc?.soHoaDon,
        tenKhach: nc?.tenKhach,
        agentJobId: jobId,
        chiTiet: { trangThai: kq.trangThai, suCo: kq.loai ?? null, daCapNhat, ...(coMoiHon ? { coLenhInMoiHon: true } : {}) },
      });
    }

    // Sự cố trong lúc in một job — app gửi NGAY khi thấy lần đầu (hợp đồng §2).
    const daGhiSuCo = new Set<string>();
    socket.on('su-co', (sc: unknown) => {
      const o = (sc && typeof sc === 'object' ? sc : {}) as Record<string, unknown>;
      const loai = o.loai;
      if (!laMaSuCo(loai)) {
        logger.warn({ loai: String(loai).slice(0, 40) }, '[may-in] su-co mã lạ — bỏ qua');
        return;
      }
      // `su-co` "bình thường" không phải sự cố — xử như báo trạng thái máy.
      if (loai === 'binh_thuong') {
        xuLyTrangThai(o);
        return;
      }
      const jobId = typeof o.jobId === 'string' ? o.jobId.slice(0, 200) : null;
      const khoa = `${jobId ?? '-'}|${loai}`;
      if (daGhiSuCo.has(khoa)) return; // app lỡ gửi lặp → một dòng
      if (daGhiSuCo.size > 500) daGhiSuCo.clear();
      daGhiSuCo.add(khoa);
      const chiTiet = chuTuApp(o.chiTiet, 500);
      const mayIn = chuTuApp(o.mayIn, 200);
      // Chỉ mã CẤP MÁY IN mới là tình trạng máy; PDF hỏng/Sumatra lỗi/không xác
      // nhận là chuyện của MỘT job, không được dán nhãn lên máy in.
      if (laMaCapMayIn(loai)) {
        registry.capNhatTinhTrang(token, { ma: loai, chiTiet: chiTiet ?? undefined, luc: new Date(), nguon: 'job' });
      }
      // Ngữ cảnh có thể phải tra DB (backend vừa khởi động lại) — ghi bất đồng bộ.
      void (async () => {
        const nc = jobId ? (await nguCanhCua(jobId))?.nc ?? null : null;
        ghiNhatKy({
          loai,
          noiDung: `${nhanCua(loai)}${nc ? ` khi in hoá đơn ${nc.soHoaDon}` : ''}${mayIn ? ` (máy in "${mayIn}")` : ''}${them(chiTiet)}`,
          agentToken: token,
          orgId: nc?.orgId,
          printJobId: nc?.printJobId,
          soHoaDon: nc?.soHoaDon,
          tenKhach: nc?.tenKhach,
          agentJobId: jobId,
          chiTiet: { mayIn, chiTiet, lucApp: chuTuApp(o.luc, 40) },
        });
      })();
    });

    // Nhật ký .txt cục bộ của app (nhat-ky-app.ts) — lô 1..500 dòng, CÓ ack. App gửi
    // lại nguyên lô khi không có ack hoặc ok:false ⇒ ack CHỈ sau khi đã lưu; lưu thì
    // lặp-được (khoá sha1 + skipDuplicates). Giới hạn tần suất tính riêng từng socket.
    const gioiHanNhatKyApp = taoGioiHanNhatKyApp();
    socket.on('nhat-ky-app', (payload: unknown, ack?: unknown) => {
      const traLoi = (kq: AckNhatKyApp): void => {
        if (typeof ack === 'function') (ack as (kq: AckNhatKyApp) => void)(kq);
      };
      // nhanNhatKyApp không ném; `catch` chỉ là lưới cuối — không bao giờ để lỗi thoát ra socket.
      nhanNhatKyApp(token, payload, gioiHanNhatKyApp)
        .then(traLoi, () => traLoi({ ok: false, loi: 'LOI_LUU' }))
        .catch((err: unknown) => logger.warn({ err }, '[may-in] nhat-ky-app: không ack được'));
    });

    // Trạng thái máy in lúc rảnh / khi đổi — chỉ ghi nhật ký khi ĐỔI.
    socket.on('trang-thai-may-in', (tt: unknown) => {
      xuLyTrangThai((tt && typeof tt === 'object' ? tt : {}) as Record<string, unknown>);
    });

    function xuLyTrangThai(o: Record<string, unknown>): void {
      const ma = o.trangThai ?? o.loai;
      if (!laMaSuCo(ma) || !laMaCapMayIn(ma)) {
        logger.warn({ trangThai: String(ma).slice(0, 40) }, '[may-in] trang-thai-may-in mã lạ — bỏ qua');
        return;
      }
      const chiTiet = chuTuApp(o.chiTiet, 500);
      const mayIn = chuTuApp(o.mayIn, 200);
      const cu = registry.layTinhTrang(token);
      // Sự cố chỉ JOB mới thấy (cờ lỗi trên job, cấp máy vẫn "bình thường" —
      // máy in mạng): báo "bình thường" CẤP MÁY không chứng minh gì. Giữ chip
      // và cầu dao; chỉ `da_in` mới gỡ (mayInDaInDuoc). Bản trước: chip + cầu
      // dao bập bênh mỗi 20 s, nhật ký ghi "báo hết lỗi" sai sự thật (V1 vòng 2).
      if (!laMaChanIn(ma) && cu && laMaChanIn(cu.ma) && cu.nguon === 'job') return;
      // Máy báo KHÔNG chặn in sau một sự cố CẤP MÁY → đóng cầu dao (in tiếp).
      if (!laMaChanIn(ma) && cu && laMaChanIn(cu.ma) && cu.nguon === 'may') {
        const cd = registry.dongCauDaoTheoTrangThai(token);
        if (cd) {
          ghiNhatKy({
            loai: 'tiep_tuc_in',
            noiDung: `Máy in${mayIn ? ` "${mayIn}"` : ''} báo hết lỗi — tiếp tục in các hoá đơn đang chờ`,
            agentToken: token,
            chiTiet: { tamGiuTu: cd.tu.toISOString(), suCo: cd.ma },
          });
        }
      }
      const { doi, maCu } = registry.capNhatTinhTrang(token, { ma, chiTiet: chiTiet ?? undefined, luc: new Date(), nguon: 'may' });
      // Không đổi, hoặc lần đầu biết mà đang bình thường → không có gì đáng ghi.
      if (!doi || (maCu === null && ma === 'binh_thuong')) return;
      const noiDung = ma === 'binh_thuong'
        ? `Máy in${mayIn ? ` "${mayIn}"` : ''} đã hết sự cố${maCu ? ` (${nhanCua(maCu)})` : ''}, hoạt động bình thường`
        : `${nhanCua(ma)}${mayIn ? ` (máy in "${mayIn}")` : ''}${them(chiTiet)}`;
      ghiNhatKy({
        loai: ma,
        noiDung,
        agentToken: token,
        chiTiet: { mayIn, chiTiet, truoc: maCu, lucApp: chuTuApp(o.luc, 40) },
      });
    }

    // VÌ SAO dựa 'disconnect' của socket.io (không phải 'close' thô của
    // net/ws): socket.io tự phát 'disconnect' cả khi transport đóng gọn gàng
    // LẪN khi ping-timeout phát hiện kết nối nửa chết (agent mất mạng đột
    // ngột, không kịp gửi FIN). Bắt 'close' ở tầng TCP/HTTP thô sẽ bỏ sót ca
    // half-open — review Task 1+2 đã chỉ đích danh lỗ này: bỏ sót thì job
    // đang chờ treo Promise mãi mãi, không bao giờ rơi vào khong_ro.
    socket.on('disconnect', (reason) => {
      logger.info(`[may-in] agent token ...${token.slice(-4)} disconnect (${reason}) — huỷ đăng ký, reject job đang chờ`);
      ghiKetNoi(); // rớt trước khi kịp ghi dòng kết nối → vẫn ghi đủ cặp
      ghiNhatKy({
        loai: 'app_mat_ket_noi',
        noiDung: `App máy in mất kết nối (${reason})`,
        agentToken: token,
        chiTiet: { lyDo: String(reason) },
      });
      huy();
      boNgheHangDoi();
      boGuiHangDoi.dung();
      // Còn kết nối khác của cùng máy (app đã nối lại trước khi kết nối cũ
      // rớt hẳn) → không phải mất kết nối thật, không hẹn cảnh báo.
      if (registry.coAgent(token) || matKetNoi.has(token)) return;
      const tu = Date.now();
      const hen = setTimeout(() => {
        const m = matKetNoi.get(token);
        if (!m || registry.coAgent(token)) return;
        m.daBao = true;
        ghiNhatKy({
          loai: 'app_offline_lau',
          // Câu phải khớp đúng việc hàng đợi làm (hang-doi-in: app offline → thử
          // lại mỗi phút, quá MAX_LAN_THU lần thì thất bại) — V4 vòng 2.
          noiDung: `App máy in mất kết nối quá ${Math.round(msOfflineLau / 60_000) || 1} phút — hoá đơn gửi tới máy này sẽ thử lại vài phút rồi báo thất bại (cần in tay). Kiểm PC ở cửa hàng: bật máy, đăng nhập Windows, mở app.`,
          agentToken: token,
          chiTiet: { matTu: new Date(tu).toISOString(), lyDo: String(reason) },
        });
      }, msOfflineLau);
      (hen as { unref?: () => void }).unref?.();
      matKetNoi.set(token, { tu, hen, daBao: false });
    });
  });
}
