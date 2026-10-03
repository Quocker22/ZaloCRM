// SPDX-License-Identifier: AGPL-3.0-or-later
// Nhật ký máy in — bảng `print_logs` (hợp đồng: HOP-DONG-NHAT-KY-MAY-IN.md §3).
//
// Chủ giao 24/09: "hết giấy, kẹt giấy, lỗi không in được thì cần báo log về
// zalocrm; trong phần Máy in cần có log cho toàn bộ, search dễ dàng".
//
// BA LUẬT của module này:
//   1. GHI NHẬT KÝ KHÔNG BAO GIỜ CHẶN VIỆC IN. `ghiNhatKy` là fire-and-forget,
//      nuốt mọi lỗi (bảng chưa migrate, DB chập chờn) và chỉ logger.warn.
//      Một hệ thống in dừng vì không ghi được log là tệ hơn không có log.
//   2. KHÔNG LƯU TOKEN máy in (ai cầm token mạo danh được máy in). Chỉ lưu
//      may_in_id + may_in_ten; agent_job_id cắt tiền tố token.
//   3. TÌM KHÔNG DẤU: cột `tu_khoa` = chữ thường + bỏ dấu của các trường người
//      ta hay gõ tìm. Gõ "loc beco het giay" ra đúng dòng "Lộc Beco … Hết giấy".
import { logger } from '../../../shared/utils/logger.js';
import { boDau } from './ten-file-in.js';

export type MucDo = 'thong_tin' | 'canh_bao' | 'loi';

interface MoTaMa {
  nhan: string;
  mucDo: MucDo;
}

/**
 * Mã sự cố / trạng thái máy in — DÙNG CHUNG với app PC và giao diện (hợp đồng
 * §1). Nhãn = NGUYÊN VĂN cột "Nhãn tiếng Việt" của hợp đồng — giao diện
 * (frontend may-in-nhan.ts) dùng cùng chữ, sửa một bên thì sửa cả hai. Thứ tự khai báo = thứ tự ưu tiên khi nhiều cờ cùng lúc (app tự quyết).
 */
export const MA_SU_CO = {
  het_giay: { nhan: 'Hết giấy', mucDo: 'loi' },
  ket_giay: { nhan: 'Kẹt giấy', mucDo: 'loi' },
  offline: { nhan: 'Máy in offline / mất kết nối máy in', mucDo: 'loi' },
  mo_nap: { nhan: 'Nắp máy in đang mở', mucDo: 'loi' },
  can_xu_ly: { nhan: 'Máy in cần người xử lý', mucDo: 'loi' },
  loi_may_in: { nhan: 'Máy in báo lỗi', mucDo: 'loi' },
  het_muc: { nhan: 'Hết mực / sắp hết mực', mucDo: 'canh_bao' },
  khong_tim_thay_may_in: { nhan: 'Không tìm thấy máy in trong Windows', mucDo: 'loi' },
  loi_sumatra: { nhan: 'Không gọi được / SumatraPDF lỗi', mucDo: 'loi' },
  loi_pdf: { nhan: 'File PDF hỏng', mucDo: 'loi' },
  khong_xac_nhan: { nhan: 'Đã gửi máy in nhưng không xác nhận được đã in', mucDo: 'loi' },
  binh_thuong: { nhan: 'Máy in bình thường (đã hết sự cố)', mucDo: 'thong_tin' },
} as const satisfies Record<string, MoTaMa>;

export type MaSuCo = keyof typeof MA_SU_CO;

/** Mã sự kiện backend tự ghi (hợp đồng §3.3) + toàn bộ mã sự cố. */
export const MA_SU_KIEN: Record<string, MoTaMa> = {
  nhan_job: { nhan: 'Nhận lệnh in', mucDo: 'thong_tin' },
  gui_may_in: { nhan: 'Đã gửi xuống máy in', mucDo: 'thong_tin' },
  da_in: { nhan: 'Đã in', mucDo: 'thong_tin' },
  loi_thu_lai: { nhan: 'In lỗi — sẽ thử lại', mucDo: 'canh_bao' },
  app_offline_thu_lai: { nhan: 'App máy in chưa kết nối — sẽ thử lại', mucDo: 'canh_bao' },
  loi_odoo: { nhan: 'Odoo không trả PDF', mucDo: 'canh_bao' },
  khong_co_may_in: { nhan: 'Không tìm được máy in cho hoá đơn', mucDo: 'loi' },
  that_bai: { nhan: 'In thất bại (quá số lần thử)', mucDo: 'loi' },
  khong_ro: { nhan: 'Không rõ đã in chưa', mucDo: 'loi' },
  het_gio_cho: { nhan: 'App máy in không trả lời', mucDo: 'loi' },
  ket_qua_tre: { nhan: 'Kết quả in đến trễ', mucDo: 'thong_tin' },
  app_ket_noi: { nhan: 'App máy in kết nối', mucDo: 'thong_tin' },
  // App ≥ 0.2.8 gửi lại thong-tin-app khi CÁCH máy in nối đổi (USB/LAN, IP, máy có trả lời) —
  // agent-ws ghi tối đa 1 dòng/phút/kết nối (thong-tin-app.ts). Cùng chữ frontend may-in-nhan.ts.
  app_ket_noi_doi: { nhan: 'Kết nối máy in thay đổi', mucDo: 'thong_tin' },
  // App nối trước khi nhận ra máy in, rồi mới biết — MỘT dòng mỗi kết nối, KHÔNG phải "đổi".
  app_nhan_dien_ket_noi: { nhan: 'Đã nhận diện kết nối máy in', mucDo: 'thong_tin' },
  // thong_tin, không phải canh_bao: máy HN rớt-nối 3–5 lần/giờ (MAY-IN-HANDOFF
  // 13.6) — ~100 dòng/ngày sẽ che mất dòng hết giấy/kẹt giấy ở bộ lọc mặc định
  // "Lỗi & cảnh báo". Mất kết nối THẬT (quá 2 phút) ghi riêng app_offline_lau.
  app_mat_ket_noi: { nhan: 'App máy in mất kết nối', mucDo: 'thong_tin' },
  app_offline_lau: { nhan: 'App máy in mất kết nối quá 2 phút', mucDo: 'canh_bao' },
  // Cầu dao (agent-registry.ts): máy đang lỗi thì GIỮ hoá đơn ở cho_in thay vì
  // đổ tiếp vào hàng đợi Windows đang kẹt; máy hết lỗi thì tự in tiếp.
  tam_giu: { nhan: 'Tạm giữ hoá đơn — máy in đang lỗi', mucDo: 'canh_bao' },
  cho_may_in: { nhan: 'Hoá đơn chờ máy in hết lỗi', mucDo: 'thong_tin' },
  tiep_tuc_in: { nhan: 'Máy in hoạt động lại — tiếp tục in', mucDo: 'thong_tin' },
  // Hàng đợi + huỷ lệnh in (hợp đồng hàng đợi/huỷ v5.1 §8.8, huy-lenh-in.ts) — mỗi yêu cầu
  // MỘT dòng, kèm nguồn (ZaloCRM + tên người / app máy in + tên máy tính).
  da_huy: { nhan: 'Đã huỷ lệnh in', mucDo: 'thong_tin' },
  huy_that_bai: { nhan: 'Không huỷ được lệnh in', mucDo: 'canh_bao' },
  // canh_bao: bỏ theo dõi KHÔNG chặn việc in — hệ thống không biết hoá đơn đã in hay chưa.
  bo_theo_doi: { nhan: 'Bỏ theo dõi lệnh in', mucDo: 'canh_bao' },
  ...MA_SU_CO,
};

/**
 * Mã sự cố CẤP MÁY IN làm máy không in được — cầu dao ngắt theo các mã này
 * (khớp `MaSuCo::chan_in()` phía app = mức `loi`, trừ ba mã cấp JOB bên dưới).
 */
const MA_CHAN_IN: ReadonlySet<string> = new Set([
  'het_giay', 'ket_giay', 'offline', 'mo_nap', 'can_xu_ly', 'loi_may_in', 'khong_tim_thay_may_in',
]);

/** Mã cấp JOB (một file/một lần gọi Sumatra hỏng) — không nói gì về máy in. */
const MA_CAP_JOB: ReadonlySet<string> = new Set(['loi_sumatra', 'loi_pdf', 'khong_xac_nhan']);

export function laMaChanIn(ma: unknown): boolean {
  return typeof ma === 'string' && MA_CHAN_IN.has(ma);
}

/**
 * Lỗi máy in RÕ NGUYÊN NHÂN (hết giấy, kẹt, mở nắp, offline…) — hoá đơn chờ
 * máy hết lỗi mà KHÔNG tiêu lượt thử. `loi_may_in` (lỗi chung chung, cả
 * BLOCKED_DEVQ "driver không in được job này") vẫn tiêu lượt: nếu không, một
 * job hỏng thật lặp "gỡ → gửi lại" mãi không bao giờ thành `loi` (giám sát V5).
 */
export function laMaChoMayKhongTieuLuot(ma: unknown): boolean {
  return laMaChanIn(ma) && ma !== 'loi_may_in';
}

/** Mã mô tả TRẠNG THÁI MÁY IN (được cập nhật chip tình trạng), khác mã cấp job. */
export function laMaCapMayIn(ma: unknown): boolean {
  return laMaSuCo(ma) && !MA_CAP_JOB.has(ma);
}

export function laMaSuCo(x: unknown): x is MaSuCo {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(MA_SU_CO, x);
}

/** Nhãn tiếng Việt của một mã; mã lạ trả nguyên mã (không bịa nhãn). */
export function nhanCua(ma: string | null | undefined): string {
  if (!ma) return '';
  return MA_SU_KIEN[ma]?.nhan ?? ma;
}

export function mucDoCua(ma: string): MucDo {
  return MA_SU_KIEN[ma]?.mucDo ?? 'canh_bao';
}

// ── Ghi ──────────────────────────────────────────────────────────────────────

export interface MucNhatKy {
  loai: string;
  noiDung: string;
  /** Không truyền → lấy theo máy in (token) hoặc org mặc định. */
  orgId?: string | null;
  /** Để tra may_in_id/ten — KHÔNG BAO GIỜ được lưu. */
  agentToken?: string | null;
  mucDo?: MucDo;
  printJobId?: string | null;
  soHoaDon?: string | null;
  tenKhach?: string | null;
  agentJobId?: string | null;
  chiTiet?: Record<string, unknown> | null;
}

export interface MayInTom {
  id: string;
  orgId: string;
  ten: string;
}

/** Bề mặt Prisma tối thiểu — nhận PrismaClient thật lẫn bản giả trong test. */
export interface PrismaNhatKy {
  printLog: {
    create: (a: { data: Record<string, unknown> }) => Promise<unknown>;
    findMany: (a: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
    deleteMany: (a: { where: Record<string, unknown> }) => Promise<{ count: number }>;
  };
  printAgent: {
    findUnique: (a: { where: { token: string } }) => Promise<MayInTom | null>;
  };
}

/** Trần độ dài chữ từ app gửi lên — không tin tưởng mù dữ liệu từ mạng. */
const TRAN_CHU = 1000;

export function catChu(s: unknown, tran = TRAN_CHU): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.length > tran ? `${t.slice(0, tran - 1)}…` : t;
}

/**
 * Id job gửi app TRƯỚC 25/09 có dạng "<token>-<ms>-<n>" — cắt tiền tố token
 * trước khi lưu (luật 2). Từ 25/09 agent-client.taoJobId sinh "<ms>-<n>" (không
 * còn token) nên hàm này chỉ còn là lưới cho kết quả trễ của job đời cũ.
 * Không khớp dạng có token → giữ 2 đoạn cuối.
 */
export function catTienToToken(agentJobId: string | null | undefined, token?: string | null): string | null {
  if (!agentJobId) return null;
  if (token && agentJobId.startsWith(`${token}-`)) return `…-${agentJobId.slice(token.length + 1)}`;
  const doan = agentJobId.split('-');
  return doan.length > 2 ? `…-${doan.slice(-2).join('-')}` : agentJobId;
}

/**
 * Từ khoá tìm: bỏ dấu, chữ thường, MỌI ký tự không phải chữ/số thành ranh từ.
 * Nhờ vậy "INV/2026/030045", "INV_2026_030045", "Anh_Loc_Beco" (tên file) và
 * "het_giay" (mã) đều tách về cùng một dãy từ — và từ tìm kiếm chỉ còn [a-z0-9],
 * không bao giờ mang "%"/"_" (ký tự đại diện của LIKE mà Prisma `contains`
 * không thoát).
 */
export function taoTuKhoa(cac: Array<string | null | undefined>): string {
  return boDau(cac.filter(Boolean).join(' ')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Che token trong chữ đến từ app/mạng (loiCuoi, chiTiet, tên file tạm có thể
 * chứa id job đời cũ "<token>-…"). Luật 2 — lưới cuối trước khi lưu.
 */
export function cheToken<T>(giaTri: T, token: string | null | undefined): T {
  if (!token || token.length < 8 || giaTri === null || giaTri === undefined) return giaTri;
  if (typeof giaTri === 'string') return giaTri.split(token).join('…') as T;
  if (typeof giaTri === 'object') {
    const chu = JSON.stringify(giaTri);
    return chu.includes(token) ? (JSON.parse(chu.split(token).join('…')) as T) : giaTri;
  }
  return giaTri;
}

export interface DepsGhiNhatKy {
  /** Mặc định: Prisma thật (nạp lười — test không cần DB). */
  prisma?: PrismaNhatKy;
  /** org dùng khi token không có trong print_agents (máy HN cũ khai qua env). */
  orgMacDinh?: () => string | null;
  /** Đồng hồ — test tiêm được. */
  bayGio?: () => number;
}

/** org của máy khai bằng env (máy HN cũ, không có dòng trong print_agents). */
export function orgMacDinhTuEnv(): string | null {
  return process.env.AI_MAY_IN_ORG_ID?.trim() || null;
}

/**
 * Tra máy in theo token, nhớ 60s — mỗi sự kiện không đáng một lượt query.
 * Dùng chung cho nhật ký nghiệp vụ (print_logs) và nhật ký app (nhat-ky-app.ts).
 */
export function taoTraMayIn(bayGio: () => number = Date.now) {
  const cache = new Map<string, { may: MayInTom | null; het: number }>();
  return async function traMayIn(p: Pick<PrismaNhatKy, 'printAgent'>, token: string): Promise<MayInTom | null> {
    const c = cache.get(token);
    if (c && c.het > bayGio()) return c.may;
    let may: MayInTom | null;
    try {
      may = await p.printAgent.findUnique({ where: { token } });
    } catch {
      // Tra lỗi thì KHÔNG nhớ: nhớ null 60s là 60s dòng nhật ký rơi về org
      // mặc định với nhãn "Máy mặc định (env)" dù máy có trong bảng.
      return null;
    }
    if (cache.size > 200) cache.clear();
    cache.set(token, { may: may ? { id: may.id, orgId: may.orgId, ten: may.ten } : null, het: bayGio() + 60_000 });
    return may;
  };
}

async function prismaThat(): Promise<PrismaNhatKy> {
  const { prisma } = await import('../../../shared/database/prisma-client.js');
  return prisma as unknown as PrismaNhatKy;
}

/**
 * Tạo hàm ghi nhật ký. Trả về hàm có HAI dạng dùng:
 *   - `ghi(m)` — fire-and-forget (luồng in dùng dạng này);
 *   - `ghi.cho(m)` — Promise resolve true/false (test dùng để chờ).
 */
export function taoGhiNhatKy(deps: DepsGhiNhatKy = {}) {
  const bayGio = deps.bayGio ?? Date.now;
  const orgMacDinh = deps.orgMacDinh ?? orgMacDinhTuEnv;
  // Cache token → máy in 60s: mỗi sự kiện không đáng một lượt query.
  const layMayIn = taoTraMayIn(bayGio);

  async function cho(m: MucNhatKy): Promise<boolean> {
    try {
      const p = deps.prisma ?? (await prismaThat());
      const may = m.agentToken ? await layMayIn(p, m.agentToken) : null;
      const orgId = m.orgId ?? may?.orgId ?? orgMacDinh();
      if (!orgId) return false; // không biết org → không ghi được (org_id NOT NULL)
      // Che TRƯỚC rồi mới cắt — cắt trước thì token vắt qua mép bị lọt nửa đầu.
      const noiDung = catChu(cheToken(m.noiDung, m.agentToken), 2000) ?? nhanCua(m.loai);
      const soHoaDon = catChu(m.soHoaDon, 100);
      const tenKhach = catChu(m.tenKhach, 200);
      const chiTiet = cheToken(m.chiTiet ?? null, m.agentToken);
      const mayInTen = may?.ten ?? (m.agentToken ? 'Máy mặc định (env)' : null);
      await p.printLog.create({
        data: {
          orgId,
          mucDo: m.mucDo ?? mucDoCua(m.loai),
          loai: m.loai,
          noiDung,
          printJobId: m.printJobId ?? null,
          soHoaDon,
          tenKhach,
          mayInId: may?.id ?? null,
          mayInTen,
          agentJobId: catTienToToken(m.agentJobId, m.agentToken),
          chiTiet: chiTiet ?? undefined,
          tuKhoa: taoTuKhoa([m.loai, nhanCua(m.loai), noiDung, soHoaDon, tenKhach, mayInTen]),
        },
      });
      return true;
    } catch (err) {
      // Luật 1: KHÔNG ném. Bảng chưa migrate / DB lỗi → chỉ cảnh báo.
      logger.warn({ err: err instanceof Error ? err.message : String(err), loai: m.loai }, '[may-in] không ghi được nhật ký');
      return false;
    }
  }

  const ghi = (m: MucNhatKy): void => {
    void cho(m);
  };
  return Object.assign(ghi, { cho });
}

export type GhiNhatKy = ReturnType<typeof taoGhiNhatKy>;

/** Singleton cho luồng thật (cron, WS). */
export const ghiNhatKy = taoGhiNhatKy();

// ── Đọc / tìm ────────────────────────────────────────────────────────────────

export type LocMucDo = MucDo | 'loi_canh_bao';

export interface ThamSoNhatKy {
  q: string[];
  mayInId: string | null;
  mucDo: LocMucDo | null;
  loai: string | null;
  tu: Date;
  den: Date;
  truoc: { luc: Date; id: string } | null;
  gioiHan: number;
}

export class ThamSoSai extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThamSoSai';
  }
}

const MUC_DO_HOP_LE: LocMucDo[] = ['thong_tin', 'canh_bao', 'loi', 'loi_canh_bao'];

export function docNgay(s: unknown, tenThamSo: string): Date | null {
  if (s === undefined || s === null || s === '') return null;
  const d = new Date(String(s));
  if (Number.isNaN(d.getTime())) throw new ThamSoSai(`${tenThamSo} không phải ngày giờ hợp lệ`);
  return d;
}

/** Con trỏ phân trang "<ISO>|<id>" (vắng → null). Sai dạng → ThamSoSai. */
export function docConTro(s: unknown, tenThamSo: string): { luc: Date; id: string } | null {
  if (typeof s !== 'string' || !s) return null;
  const [lucTho, id] = s.split('|');
  const luc = docNgay(lucTho, tenThamSo);
  if (!luc || !id) throw new ThamSoSai(`${tenThamSo} phải có dạng "<ISO>|<id>"`);
  return { luc, id };
}

/** Đọc query string → tham số đã kiểm. Ném ThamSoSai khi sai (route trả 400). */
export function phanTichThamSo(query: Record<string, unknown>, bayGio: Date = new Date()): ThamSoNhatKy {
  const qTho = typeof query.q === 'string' ? query.q : '';
  // Mỗi từ phải có mặt (AND) — "loc het giay" tìm dòng có cả "loc" lẫn "het giay".
  const q = taoTuKhoa([qTho.slice(0, 200)]).split(' ').filter((t) => t.length > 0).slice(0, 8);

  const mucDoTho = typeof query.mucDo === 'string' && query.mucDo ? query.mucDo : null;
  if (mucDoTho && !MUC_DO_HOP_LE.includes(mucDoTho as LocMucDo)) {
    throw new ThamSoSai(`mucDo phải là một trong: ${MUC_DO_HOP_LE.join(', ')}`);
  }

  const den = docNgay(query.den, 'den') ?? bayGio;
  const tu = docNgay(query.tu, 'tu') ?? new Date(den.getTime() - 7 * 24 * 3600 * 1000);
  if (tu > den) throw new ThamSoSai('tu phải trước den');

  const truoc = docConTro(query.truoc, 'truoc');

  const gioiHanTho = Number(query.gioiHan ?? 50);
  const gioiHan = Number.isFinite(gioiHanTho) ? Math.min(200, Math.max(1, Math.floor(gioiHanTho))) : 50;

  return {
    q,
    mayInId: typeof query.mayInId === 'string' && query.mayInId ? query.mayInId : null,
    mucDo: mucDoTho as LocMucDo | null,
    loai: typeof query.loai === 'string' && query.loai ? query.loai.slice(0, 50) : null,
    tu,
    den,
    truoc,
    gioiHan,
  };
}

export interface NhatKy {
  id: string;
  luc: string;
  mucDo: MucDo;
  loai: string;
  noiDung: string;
  soHoaDon: string | null;
  tenKhach: string | null;
  mayInId: string | null;
  mayInTen: string | null;
  printJobId: string | null;
  chiTiet: unknown;
}

/** Dựng where Prisma — tách riêng để test được không cần DB. */
export function taoWhereNhatKy(orgId: string, t: ThamSoNhatKy): Record<string, unknown> {
  const va: Array<Record<string, unknown>> = [
    { orgId },
    { createdAt: { gte: t.tu, lte: t.den } },
    ...t.q.map((tu) => ({ tuKhoa: { contains: tu } })),
  ];
  if (t.mayInId) va.push({ mayInId: t.mayInId });
  if (t.loai) va.push({ loai: t.loai });
  if (t.mucDo === 'loi_canh_bao') va.push({ mucDo: { in: ['loi', 'canh_bao'] } });
  else if (t.mucDo) va.push({ mucDo: t.mucDo });
  if (t.truoc) {
    // Con trỏ ổn định theo (created_at DESC, id DESC) — hai dòng cùng mili-giây không bị mất/lặp.
    va.push({
      OR: [
        { createdAt: { lt: t.truoc.luc } },
        { createdAt: t.truoc.luc, id: { lt: t.truoc.id } },
      ],
    });
  }
  return { AND: va };
}

export async function timNhatKy(
  orgId: string,
  t: ThamSoNhatKy,
  deps: { prisma?: PrismaNhatKy } = {},
): Promise<{ items: NhatKy[]; tiepTheo: string | null }> {
  const p = deps.prisma ?? (await prismaThat());
  const rows = await p.printLog.findMany({
    where: taoWhereNhatKy(orgId, t),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: t.gioiHan + 1, // lấy dư 1 để biết còn trang sau
  });
  const coThem = rows.length > t.gioiHan;
  const trang = coThem ? rows.slice(0, t.gioiHan) : rows;
  const items: NhatKy[] = trang.map((r) => ({
    id: String(r.id),
    luc: new Date(r.createdAt as string | Date).toISOString(),
    mucDo: r.mucDo as MucDo,
    loai: String(r.loai),
    noiDung: String(r.noiDung),
    soHoaDon: (r.soHoaDon as string | null) ?? null,
    tenKhach: (r.tenKhach as string | null) ?? null,
    mayInId: (r.mayInId as string | null) ?? null,
    mayInTen: (r.mayInTen as string | null) ?? null,
    printJobId: (r.printJobId as string | null) ?? null,
    chiTiet: r.chiTiet ?? null,
  }));
  const cuoi = items[items.length - 1];
  return { items, tiepTheo: coThem && cuoi ? `${cuoi.luc}|${cuoi.id}` : null };
}

/**
 * Số ngày giữ nhật ký máy in (`print_logs`) VÀ nhật ký app (`print_app_logs`) — chủ
 * chốt 26/09: "toàn bộ log chỉ lưu 30 ngày, sau đó dọn dẹp nhằm tránh tăng bộ nhớ"
 * (trước: nhật ký máy in 90 ngày, hợp đồng §3.2). App Windows cũng giữ file 30 ngày.
 */
export const SO_NGAY_GIU_NHAT_KY = 30;

/** Giữ nhật ký `SO_NGAY_GIU_NHAT_KY` ngày. Lỗi thì nuốt — dọn rác không được làm hỏng cron in. */
export async function donNhatKyCu(
  soNgay = SO_NGAY_GIU_NHAT_KY,
  deps: { prisma?: PrismaNhatKy; bayGio?: Date } = {},
): Promise<number> {
  try {
    const p = deps.prisma ?? (await prismaThat());
    const moc = new Date((deps.bayGio ?? new Date()).getTime() - soNgay * 24 * 3600 * 1000);
    const kq = await p.printLog.deleteMany({ where: { createdAt: { lt: moc } } });
    return kq.count;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[may-in] không dọn được nhật ký cũ');
    return 0;
  }
}
