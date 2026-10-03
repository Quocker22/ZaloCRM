// SPDX-License-Identifier: AGPL-3.0-or-later
// Lịch sử in — hai danh sách "Đã in" và "Đã huỷ" trong khu Hàng đợi & nhật ký máy in
// (Cài đặt › Máy in), cùng kiểu thẻ "Hàng đợi in". Chủ giao 26/09: "log 30 ngày thôi".
//
// BỐN QUYẾT ĐỊNH của module này:
//   1. CHỈ ĐỌC DB: print_jobs (+ print_agents cho tên máy, + print_logs cho tên khách — dòng mới
//      nhất có tên của cùng job, như hàng đợi). KHÔNG gọi Odoo, KHÔNG ghi gì.
//   2. MỐC 30 NGÀY = updated_at, không phải created_at: `da_in`/`da_huy` là trạng thái KẾT THÚC
//      (mọi lần ghi của hàng đợi đều có điều kiện trạng thái — hang-doi-in.ts ghiCoDieuKien,
//      huy-lenh-in.ts, agent-ws kết quả trễ — không lần ghi nào xuất phát từ hai trạng thái này),
//      nên updated_at = đúng lúc in xong / lúc huỷ. Lọc theo created_at sẽ giấu hoá đơn tạo 31
//      ngày trước mà hôm nay mới in (kết quả trễ), và xếp theo giờ tạo thì tờ vừa in không nằm
//      trên đầu. Cửa sổ CUỐN "30 ngày gần nhất" tính từ bây giờ — cùng cách dọn nhật ký
//      (donNhatKyCu), nên tên khách lấy từ print_logs gần như luôn còn.
//   3. "Đã huỷ" = CHỈ `da_huy` (huỷ CHẮC CHẮN, không byte nào tới máy in). `bo_qua` ("Bỏ khỏi
//      hàng đợi") KHÔNG BAO GIỜ được gọi là huỷ (hợp đồng hàng đợi/huỷ v5.1 §8.5, §8.10): hệ
//      thống không biết hoá đơn đó đã in hay chưa. Nó vẫn tra được ở Nhật ký in (sự kiện "Bỏ
//      theo dõi lệnh in").
//   4. CHỈ LỌC hiển thị 30 ngày — KHÔNG xoá print_jobs: agent-ws vẫn đọc lệnh cũ (kết quả in
//      trễ, "có lệnh in mới hơn cùng hoá đơn" — dieuKienLenhInMoiHon tính cả `da_in`), xoá là
//      đổi hành vi chống in đôi.
//
// Không lộ token máy in: mục chỉ mang id + tên máy; `lyDo` đi qua cheToken.
import { cheToken, catChu, docConTro, SO_NGAY_GIU_NHAT_KY, ThamSoSai } from './nhat-ky.js';
import { tenKhachTheoJob } from './huy-lenh-in.js';

export type TrangThaiLichSu = 'da_in' | 'da_huy';
export const TRANG_THAI_LICH_SU: readonly TrangThaiLichSu[] = ['da_in', 'da_huy'];

/** Cửa sổ lịch sử — cùng hạn giữ nhật ký máy in / nhật ký app (chủ chốt 26/09: 30 ngày). */
export const SO_NGAY_LICH_SU = SO_NGAY_GIU_NHAT_KY;
const NGAY_MS = 24 * 3600 * 1000;

export interface MucLichSu {
  /** print_jobs.id */
  id: string;
  soHoaDon: string;
  tenKhach: string | null;
  /** Từ agent_token → print_agents (của CHÍNH org). KHÔNG BAO GIỜ trả token. */
  mayInId: string | null;
  mayInTen: string | null;
  trangThai: TrangThaiLichSu;
  /** ISO — lúc tạo lệnh in. */
  tao: string;
  /** ISO — lúc kết thúc (updated_at): giờ in xong (`da_in`) / giờ huỷ (`da_huy`). */
  ketThuc: string;
  /** `da_huy`: "Đã huỷ bởi ZaloCRM (Chị Hoa)"… — đã che token, cắt 160 ký tự. `da_in`: thường null. */
  lyDo: string | null;
}

export interface TrangLichSu {
  /** Mới kết thúc trước (updated_at DESC, id DESC). */
  items: MucLichSu[];
  /** Con trỏ "<ketThuc ISO>|<id>" cho trang sau; null = hết. */
  tiepTheo: string | null;
  /** Tổng số lệnh khớp bộ lọc trong cửa sổ — CHỈ trang đầu (`truoc` vắng); trang sau: null. */
  tong: number | null;
  /** ISO — mốc đầu cửa sổ 30 ngày. */
  tu: string;
  /** ISO — lúc dựng câu trả lời. */
  capNhat: string;
}

export interface DemLichSu {
  /** Số lệnh `da_in` / `da_huy` của CẢ org (mọi máy) trong cửa sổ — số trên thẻ "Đã in (N)". */
  daIn: number;
  daHuy: number;
  tu: string;
  capNhat: string;
}

export interface ThamSoLichSu {
  trangThai: TrangThaiLichSu;
  mayInId: string | null;
  truoc: { luc: Date; id: string } | null;
  gioiHan: number;
}

/** Dòng print_jobs tối thiểu lịch sử cần. */
export interface JobLichSu {
  id: string;
  soHoaDon: string;
  trangThai: string;
  loiCuoi: string | null;
  agentToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CHON_JOB = {
  id: true, soHoaDon: true, trangThai: true, loiCuoi: true, agentToken: true, createdAt: true, updatedAt: true,
} as const;

/** Bề mặt Prisma tối thiểu — nhận PrismaClient thật lẫn bản giả trong test. */
export interface PrismaLichSu {
  printJob: {
    findMany: (a: {
      where: Record<string, unknown>;
      orderBy?: unknown;
      take?: number;
      select?: Record<string, boolean>;
    }) => Promise<JobLichSu[]>;
    count: (a: { where: Record<string, unknown> }) => Promise<number>;
  };
  printLog: {
    findMany: (a: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  };
  printAgent: {
    findMany: (a: Record<string, unknown>) => Promise<Array<{ id: string; ten: string; token: string }>>;
    findFirst: (a: Record<string, unknown>) => Promise<{ token: string } | null>;
  };
}

export interface DepsLichSu {
  /** Mặc định Prisma thật (nạp lười — test không cần DB). */
  prisma?: PrismaLichSu;
  /**
   * Token máy MẶC ĐỊNH (env AI_MAY_IN_AGENT_TOKEN) — job agent_token NULL thuộc máy này (như
   * hàng đợi). `undefined` = đọc env lúc gọi; `null` = hệ không có kênh app (thuần IPP).
   */
  tokenMacDinh?: string | null;
  bayGio?: () => number;
}

async function prismaThat(): Promise<PrismaLichSu> {
  const { prisma } = await import('../../../shared/database/prisma-client.js');
  return prisma as unknown as PrismaLichSu;
}

function tokenMacDinhCua(deps: DepsLichSu): string | null {
  if (deps.tokenMacDinh !== undefined) return deps.tokenMacDinh;
  return process.env.AI_MAY_IN_AGENT_TOKEN?.trim() || null;
}

/** Mốc đầu cửa sổ: bây giờ − 30 ngày (cuốn). */
export function mocDauLichSu(bayGio: number): Date {
  return new Date(bayGio - SO_NGAY_LICH_SU * NGAY_MS);
}

// ── Tham số ──────────────────────────────────────────────────────────────────

/**
 * Đọc query string → tham số đã kiểm. Ném ThamSoSai khi sai (route trả 400).
 *
 * Con trỏ `truoc` ở TƯƠNG LAI quá 1 ngày (vd năm 99999 — JS nhận, Prisma/Postgres thì không →
 * 500, giám sát vòng 2) → 400. Con trỏ CŨ HƠN mốc đầu cửa sổ không lỗi: timLichSuIn trả trang
 * rỗng mà không truy vấn (người đang "Tải thêm" lúc cửa sổ trượt qua dòng cuối không thấy lỗi).
 */
export function phanTichThamSoLichSu(query: Record<string, unknown>, bayGio: number = Date.now()): ThamSoLichSu {
  const trangThai = query.trangThai;
  if (typeof trangThai !== 'string' || !TRANG_THAI_LICH_SU.includes(trangThai as TrangThaiLichSu)) {
    throw new ThamSoSai(`trangThai phải là một trong: ${TRANG_THAI_LICH_SU.join(', ')}`);
  }
  const gioiHanTho = Number(query.gioiHan ?? 50);
  const gioiHan = Number.isFinite(gioiHanTho) ? Math.min(200, Math.max(1, Math.floor(gioiHanTho))) : 50;
  const truoc = docConTro(query.truoc, 'truoc');
  if (truoc && truoc.luc.getTime() > bayGio + NGAY_MS) {
    throw new ThamSoSai('truoc nằm ngoài khoảng thời gian cho phép');
  }
  return {
    trangThai: trangThai as TrangThaiLichSu,
    mayInId: typeof query.mayInId === 'string' && query.mayInId ? query.mayInId.slice(0, 100) : null,
    truoc,
    gioiHan,
  };
}

// ── Truy vấn ────────────────────────────────────────────────────────────────

/**
 * Điều kiện Prisma của một trang lịch sử — tách riêng để test được không cần DB. `may` = điều
 * kiện máy đã quy đổi (dieuKienMay). Con trỏ ổn định theo (updated_at DESC, id DESC): hai lệnh
 * kết thúc cùng mili-giây không bị mất/lặp giữa hai trang. `updated_at <= luc` đứng RIÊNG (ngoài
 * OR) để Postgres dùng làm CẬN TRÊN của index — trang 2+ không quét lại từ đầu cửa sổ.
 */
export function taoWhereLichSu(
  orgId: string,
  trangThai: TrangThaiLichSu,
  tu: Date,
  may: Record<string, unknown> | null,
  truoc: { luc: Date; id: string } | null,
): Record<string, unknown> {
  const va: Array<Record<string, unknown>> = [{ orgId }, { trangThai }, { updatedAt: { gte: tu } }];
  if (may) va.push(may);
  if (truoc) {
    va.push({ updatedAt: { lte: truoc.luc } });
    va.push({
      OR: [
        { updatedAt: { lt: truoc.luc } },
        { updatedAt: truoc.luc, id: { lt: truoc.id } },
      ],
    });
  }
  return { AND: va };
}

/**
 * `mayInId` → điều kiện theo agent_token (cùng luật hàng đợi): máy MẶC ĐỊNH gồm cả job
 * agent_token NULL. Máy không thuộc org / id lạ → `'khong_co'` (trả rỗng, không lộ gì).
 */
async function dieuKienMay(
  p: PrismaLichSu,
  orgId: string,
  mayInId: string | null,
  tokenMacDinh: string | null,
): Promise<Record<string, unknown> | null | 'khong_co'> {
  if (!mayInId) return null;
  const may = await p.printAgent.findFirst({ where: { id: mayInId, orgId }, select: { token: true } });
  if (!may) return 'khong_co';
  return may.token === tokenMacDinh
    ? { OR: [{ agentToken: may.token }, { agentToken: null }] }
    : { agentToken: may.token };
}

/** Một trang lịch sử "Đã in" / "Đã huỷ" của org (lọc một máy bằng `mayInId`). */
export async function timLichSuIn(
  orgId: string,
  t: ThamSoLichSu,
  deps: DepsLichSu = {},
): Promise<TrangLichSu> {
  const p = deps.prisma ?? (await prismaThat());
  const tokenMacDinh = tokenMacDinhCua(deps);
  const bayGio = (deps.bayGio ?? Date.now)();
  const tu = mocDauLichSu(bayGio);
  const chung = { tu: tu.toISOString(), capNhat: new Date(bayGio).toISOString() };

  // Con trỏ cũ hơn mốc đầu cửa sổ: trang sau chắc chắn rỗng — trả luôn, không truy vấn.
  if (t.truoc && t.truoc.luc.getTime() < tu.getTime()) return { items: [], tiepTheo: null, tong: null, ...chung };
  const may = await dieuKienMay(p, orgId, t.mayInId, tokenMacDinh);
  if (may === 'khong_co') return { items: [], tiepTheo: null, tong: t.truoc ? null : 0, ...chung };

  const [rows, tong] = await Promise.all([
    p.printJob.findMany({
      where: taoWhereLichSu(orgId, t.trangThai, tu, may, t.truoc),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: t.gioiHan + 1, // lấy dư 1 để biết còn trang sau
      select: CHON_JOB,
    }),
    // Đếm chỉ ở trang đầu — "Tải thêm" không trả lại tiền một lần COUNT.
    t.truoc ? Promise.resolve(null) : p.printJob.count({ where: taoWhereLichSu(orgId, t.trangThai, tu, may, null) }),
  ]);
  const coThem = rows.length > t.gioiHan;
  const trang = coThem ? rows.slice(0, t.gioiHan) : rows;

  const tokenCua = (j: JobLichSu): string | null => j.agentToken ?? tokenMacDinh;
  const tokens = [...new Set(trang.map(tokenCua).filter((x): x is string => !!x))];
  const mayTheoToken = new Map<string, { id: string; ten: string }>();
  if (tokens.length > 0) {
    // Chỉ máy của CHÍNH org — token trùng máy org khác thì không lộ tên máy đó.
    const cacMay = await p.printAgent.findMany({
      where: { token: { in: tokens }, orgId },
      select: { id: true, ten: true, token: true },
    });
    for (const m of cacMay) mayTheoToken.set(m.token, { id: m.id, ten: m.ten });
  }
  // Mọi dòng thuộc org này (where orgId) — tên khách chỉ lấy từ nhật ký CÙNG org.
  const tenKhach = await tenKhachTheoJob(p, trang.map((j) => ({ id: j.id, orgId })));

  const items: MucLichSu[] = trang.map((j) => {
    const token = tokenCua(j);
    const m = token ? mayTheoToken.get(token) : undefined;
    return {
      id: j.id,
      soHoaDon: j.soHoaDon,
      tenKhach: tenKhach.get(j.id) ?? null,
      mayInId: m?.id ?? null,
      // Máy khai bằng env (không có dòng print_agents) — cùng chữ với nhat-ky.ts / hàng đợi.
      mayInTen: m?.ten ?? (token && token === tokenMacDinh ? 'Máy mặc định (env)' : null),
      trangThai: j.trangThai as TrangThaiLichSu,
      tao: new Date(j.createdAt).toISOString(),
      ketThuc: new Date(j.updatedAt).toISOString(),
      lyDo: catChu(cheToken(j.loiCuoi, token), 160),
    };
  });
  const cuoi = items[items.length - 1];
  return { items, tiepTheo: coThem && cuoi ? `${cuoi.ketThuc}|${cuoi.id}` : null, tong, ...chung };
}

/** Số lệnh "Đã in" / "Đã huỷ" của cả org trong cửa sổ — cho số trên hai thẻ. */
export async function demLichSuIn(orgId: string, deps: DepsLichSu = {}): Promise<DemLichSu> {
  const p = deps.prisma ?? (await prismaThat());
  const bayGio = (deps.bayGio ?? Date.now)();
  const tu = mocDauLichSu(bayGio);
  const [daIn, daHuy] = await Promise.all(
    TRANG_THAI_LICH_SU.map((tt) => p.printJob.count({ where: taoWhereLichSu(orgId, tt, tu, null, null) })),
  );
  return { daIn, daHuy, tu: tu.toISOString(), capNhat: new Date(bayGio).toISOString() };
}
