// SPDX-License-Identifier: AGPL-3.0-or-later
// Hàng đợi in HIỆN RÕ + HUỶ lệnh in có xác nhận — hợp đồng
// docs/may-in/HOP-DONG-HANG-DOI-HUY-v5.md, mục 8 (v5.1, ưu tiên hơn mọi mục trên).
//
// Chủ giao 25/09: hoá đơn gửi lúc máy in lỗi phải HIỆN (ZaloCRM lẫn app máy in), huỷ được ở
// cả hai nơi, và huỷ phải báo kết quả THẬT — không bao giờ nói "đã huỷ" khi không chắc.
//
// BỐN LUẬT của module này:
//   1. HUỶ CHỈ LÀ DB, CÓ ĐIỀU KIỆN (§8.2): `cho_in → da_huy` bằng `updateMany where
//      {id, trangThai:'cho_in', <phạm vi>}`. count 1 = chắc chắn chưa byte nào rời máy chủ
//      (cron cũng chỉ claim có điều kiện — hang-doi-in.ts [G4]). Không hỏi app, không xoá
//      hàng đợi Windows (§8.1 bỏ giao thức huy-job).
//   2. KHÔNG NÓI "ĐÃ HUỶ" SAI: mọi trạng thái khác trả `ok:false` kèm lý do + việc cần làm;
//      `loi`/`bo_qua` là DA_KET_THUC (không đổi trạng thái). "Bỏ theo dõi" (`bo_qua`) KHÔNG
//      BAO GIỜ được gọi là huỷ — nó không chặn việc in.
//   3. PHẠM VI: REST = org của người dùng; socket = CHỈ job của chính máy đó (token socket,
//      hoặc agent_token NULL khi socket là máy mặc định env). Ngoài phạm vi = KHONG_TIM_THAY.
//   4. KHÔNG LỘ TOKEN (B4): mục hàng đợi chỉ mang id + tên máy; chữ lỗi đi qua cheToken.
import { logger } from '../../../shared/utils/logger.js';
import { MAX_LAN_THU } from './hang-doi-in.js';
import { catChu, cheToken, ghiNhatKy as ghiNhatKyThat, laMaSuCo, nhanCua, type MucNhatKy } from './nhat-ky.js';
import { agentRegistry, type CauDao } from './agent-registry.js';

// ── Kiểu dữ liệu hợp đồng (§3.1 + §8.6 + §8.7 — app viết song song theo đúng chữ này) ──

export type NhomHangDoi = 'cho_in' | 'chua_xac_nhan';
export type TrangThaiHangDoi = 'cho_in' | 'dang_gui' | 'da_gui' | 'khong_ro';

export interface MucHangDoi {
  /** print_jobs.id */
  id: string;
  soHoaDon: string;
  /** Từ dòng print_logs mới nhất CÓ tên khách của cùng print_job_id. */
  tenKhach: string | null;
  /** Từ agent_token → print_agents. KHÔNG BAO GIỜ trả token. */
  mayInId: string | null;
  mayInTen: string | null;
  trangThai: TrangThaiHangDoi;
  nhom: NhomHangDoi;
  /** Câu cho người đọc: "Tạm giữ — máy in Hết giấy (từ 18:45)", "Đang gửi xuống máy in"… */
  lyDo: string;
  /** cho_in + cầu dao máy đó đang ngắt. */
  tamGiu: boolean;
  lanThu: number;
  /** ISO */
  tao: string;
  capNhat: string;
  /** Gợi ý giao diện (§8.2): chỉ `cho_in` huỷ được CHẮC CHẮN. */
  huy: 'chac_chan' | 'khong';
}

export interface HangDoiIn {
  /** cho_in ∪ dang_gui ∪ da_gui — đang/sẽ in, cũ trước (đúng thứ tự sẽ in). */
  choIn: MucHangDoi[];
  /** khong_ro trong 3 ngày gần nhất. */
  chuaXacNhan: MucHangDoi[];
  /** ISO — lúc dựng snapshot. */
  capNhat: string;
}

export type MaLoiHuy = 'DANG_IN' | 'CHUA_XAC_NHAN' | 'DA_IN' | 'DA_KET_THUC' | 'KHONG_TIM_THAY';

export interface KetQuaHuy {
  id: string;
  soHoaDon: string | null;
  ok: boolean;
  /** 'da_huy' khi ok; trạng thái hiện tại khi không ok; null khi không tìm thấy. */
  trangThaiMoi: string | null;
  /** Chỉ khi ok. */
  cach?: 'chua_gui' | 'da_huy_truoc';
  /** Chỉ khi không ok. */
  loi?: MaLoiHuy;
  /** Câu tiếng Việt cho người đọc: vì sao + việc cần làm. */
  noiDung: string;
}

export interface KetQuaBoTheoDoi {
  id: string;
  ok: boolean;
  noiDung: string;
}

/** Phạm vi được đụng tới (luật 3). */
export type PhamViHangDoi =
  | { loai: 'org'; orgId: string }
  | { loai: 'may'; token: string; tokenMacDinh: string | null };

/** Ai yêu cầu — ghi vào nhật ký (B5). */
export type NguonYeuCau = { loai: 'crm'; ten: string | null } | { loai: 'app'; may: string | null };

// ── Câu chữ (§8.2 nguyên văn) ────────────────────────────────────────────────

export const NOI_DUNG_HUY = {
  chuaGui: 'Đã huỷ — hoá đơn chắc chắn không in',
  daHuyTruoc: 'Đã huỷ trước đó — hoá đơn chắc chắn không in',
  dangIn:
    'Hoá đơn đang được gửi/in ở máy in — không huỷ được nữa. Nếu không cần tờ này: bỏ tờ in ra.',
  chuaXacNhan:
    "Hoá đơn đã gửi xuống máy in nhưng chưa xác nhận đã in — có thể đang nằm trong bộ nhớ máy in, không huỷ được từ xa. Muốn bỏ hẳn: xoá lệnh trong hàng đợi Windows (nếu còn), tắt máy in 10 giây (MỌI hoá đơn trong bộ nhớ máy sẽ mất) → bật lại → kiểm khay → in lại cái cần. Rồi bấm 'Bỏ khỏi hàng đợi'.",
  daIn: 'Hoá đơn đã in xong — không còn gì để huỷ.',
  loi: 'Lệnh in này đã thất bại và kết thúc — hệ thống không tự in lại, không còn gì để huỷ.',
  boQua: 'Lệnh in này đã được bỏ khỏi hàng đợi trước đó — hệ thống KHÔNG biết hoá đơn đã in hay chưa. Không còn gì để huỷ.',
  khongTimThay: 'Không tìm thấy lệnh in này (đã bị xoá, hoặc không thuộc máy in/tổ chức của bạn).',
} as const;

/** Bản ngắn cho dòng nhật ký `huy_that_bai` (§8.8 "noiDung ngắn"). */
const NGAN_THEO_LOI: Record<MaLoiHuy, string> = {
  DANG_IN: 'đang được gửi/in ở máy in — không huỷ được nữa',
  CHUA_XAC_NHAN: 'đã gửi xuống máy in nhưng chưa xác nhận đã in — không huỷ được từ xa',
  DA_IN: 'đã in xong',
  DA_KET_THUC: 'lệnh in đã kết thúc',
  KHONG_TIM_THAY: 'không tìm thấy lệnh in',
};

function nganCua(k: KetQuaHuy, job: Pick<JobHangDoi, 'trangThai'> | null): string {
  if (k.loi === 'DA_KET_THUC' && job?.trangThai === 'bo_qua') return 'lệnh in đã được bỏ khỏi hàng đợi trước đó';
  if (k.loi === 'DA_KET_THUC' && job?.trangThai === 'loi') return 'lệnh in đã thất bại và kết thúc';
  return NGAN_THEO_LOI[k.loi ?? 'KHONG_TIM_THAY'];
}

export const NOI_DUNG_BO_THEO_DOI = {
  ok: 'Đã bỏ khỏi hàng đợi — hệ thống KHÔNG biết hoá đơn đã in hay chưa',
  daBoTruoc: 'Đã bỏ khỏi hàng đợi trước đó — hệ thống KHÔNG biết hoá đơn đã in hay chưa',
  khongTimThay: 'Không tìm thấy lệnh in này.',
  chiKhongRo: 'Chỉ bỏ theo dõi được lệnh chưa xác nhận đã in',
} as const;

/** Mô tả ngắn một trạng thái print_jobs — dùng trong câu trả lời "vì sao không được". */
const MO_TA_TRANG_THAI: Record<string, string> = {
  cho_in: 'đang chờ in (dùng "Huỷ" để huỷ chắc chắn)',
  dang_gui: 'đang được gửi xuống máy in',
  da_gui: 'đã gửi xuống máy in',
  da_in: 'đã in xong',
  loi: 'đã thất bại và kết thúc',
  da_huy: 'đã huỷ',
};

// ── Bề mặt Prisma + phụ thuộc ────────────────────────────────────────────────

/** Dòng print_jobs tối thiểu hàng đợi cần. */
export interface JobHangDoi {
  id: string;
  orgId: string;
  soHoaDon: string;
  trangThai: string;
  lanThu: number;
  loiCuoi: string | null;
  agentToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CHON_JOB = {
  id: true, orgId: true, soHoaDon: true, trangThai: true, lanThu: true, loiCuoi: true,
  agentToken: true, createdAt: true, updatedAt: true,
} as const;

/** Bề mặt Prisma tối thiểu — nhận PrismaClient thật lẫn bản giả trong test. */
export interface PrismaHangDoiHuy {
  printJob: {
    updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
    findFirst: (a: { where: Record<string, unknown>; select?: Record<string, boolean> }) => Promise<JobHangDoi | null>;
    findMany: (a: {
      where: Record<string, unknown>;
      orderBy?: unknown;
      take?: number;
      select?: Record<string, boolean>;
    }) => Promise<JobHangDoi[]>;
  };
  printLog: {
    findMany: (a: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  };
  printAgent: {
    findMany: (a: Record<string, unknown>) => Promise<Array<{ id: string; ten: string; token: string }>>;
    findFirst: (a: Record<string, unknown>) => Promise<{ token: string } | null>;
  };
}

/** Phần registry hàng đợi cần: cầu dao + app có nối không + báo "hàng đợi đổi". */
export interface RegistryHangDoi {
  layCauDao(token: string): CauDao | null;
  coAgent(token: string): boolean;
  baoDoiHangDoi?(token: string | null): void;
}

export interface DepsHangDoi {
  /** Mặc định Prisma thật (nạp lười — test không cần DB). */
  prisma?: PrismaHangDoiHuy;
  /** Mặc định singleton agentRegistry. */
  registry?: RegistryHangDoi;
  /** Nhật ký print_logs — mặc định singleton thật (fire-and-forget, không ném). */
  ghiNhatKy?: (m: MucNhatKy) => void;
  /**
   * Token máy MẶC ĐỊNH (env AI_MAY_IN_AGENT_TOKEN) — job agent_token NULL thuộc máy này.
   * `undefined` = đọc env lúc gọi; `null` = hệ không có kênh app (thuần IPP).
   */
  tokenMacDinh?: string | null;
  bayGio?: () => number;
}

async function prismaThat(): Promise<PrismaHangDoiHuy> {
  const { prisma } = await import('../../../shared/database/prisma-client.js');
  return prisma as unknown as PrismaHangDoiHuy;
}

function tokenMacDinhCua(deps: DepsHangDoi): string | null {
  if (deps.tokenMacDinh !== undefined) return deps.tokenMacDinh;
  return process.env.AI_MAY_IN_AGENT_TOKEN?.trim() || null;
}

// ── Phạm vi ──────────────────────────────────────────────────────────────────

/** Điều kiện Prisma của phạm vi (luật 3). Socket: CHỈ job của chính máy đó. */
export function dieuKienPhamVi(p: PhamViHangDoi): Record<string, unknown> {
  if (p.loai === 'org') return { orgId: p.orgId };
  // agent_token NULL = job cũ / tra kho lỗi → máy mặc định (cron quy về token env).
  if (p.tokenMacDinh && p.token === p.tokenMacDinh) {
    return { OR: [{ agentToken: p.token }, { agentToken: null }] };
  }
  return { agentToken: p.token };
}

export function chuNguon(n: NguonYeuCau): string {
  return n.loai === 'crm'
    ? `ZaloCRM (${n.ten?.trim() || 'không rõ người dùng'})`
    : `app máy in (${n.may?.trim() || 'không rõ tên máy tính'})`;
}

// ── Xem hàng đợi (§8.6 REST, §8.7 socket) ────────────────────────────────────

const GIO_MS = 3600 * 1000;
/** `khong_ro` hiện trong nhóm "Chưa xác nhận" bao lâu (§2, §8.6). */
export const MS_CHUA_XAC_NHAN = 3 * 24 * GIO_MS;
/** Trần mỗi nhóm (§3.1 "Tối đa 500"). */
export const TRAN_MUC_MOI_NHOM = 500;
const LECH_GIO_VN_MS = 7 * GIO_MS;
const hai = (n: number) => String(n).padStart(2, '0');

/** "HH:mm" giờ Việt Nam (UTC+7 cố định) — không theo múi giờ máy chủ. */
export function gioPhutVN(d: Date | number): string {
  const x = new Date(new Date(d).getTime() + LECH_GIO_VN_MS);
  return `${hai(x.getUTCHours())}:${hai(x.getUTCMinutes())}`;
}

/** Tình trạng máy (theo token) mà lý do của một mục cần. */
export interface TinhTrangMayHangDoi {
  cauDao: CauDao | null;
  /** App của máy đang kết nối. */
  coApp: boolean;
  /** Hệ có kênh app (có token máy mặc định) — thuần IPP thì không nói chuyện "app". */
  kenhApp: boolean;
}

/** Lý do + cờ tạm giữ của MỘT mục — hàm thuần. `token` chỉ để che, không bao giờ trả ra. */
export function lyDoCua(
  j: Pick<JobHangDoi, 'trangThai' | 'lanThu' | 'loiCuoi'>,
  tt: TinhTrangMayHangDoi,
  token: string | null,
): { lyDo: string; tamGiu: boolean } {
  const loiCuoi = catChu(cheToken(j.loiCuoi, token), 160);
  if (j.trangThai === 'cho_in') {
    if (tt.cauDao) {
      const ma = tt.cauDao.ma;
      const suCo = laMaSuCo(ma) ? `máy in ${nhanCua(ma)}` : ma ? nhanCua(ma) : 'máy in đang lỗi';
      return { lyDo: `Tạm giữ — ${suCo} (từ ${gioPhutVN(tt.cauDao.tu)})`, tamGiu: true };
    }
    if (tt.kenhApp && !tt.coApp) return { lyDo: 'Chờ app máy in kết nối lại', tamGiu: false };
    if (j.lanThu > 0 && loiCuoi) {
      return { lyDo: `Chờ gửi lại (đã thử ${j.lanThu}/${MAX_LAN_THU} lần) — lần trước: ${loiCuoi}`, tamGiu: false };
    }
    return { lyDo: 'Chờ tới lượt in', tamGiu: false };
  }
  if (j.trangThai === 'dang_gui') return { lyDo: 'Đang gửi xuống máy in', tamGiu: false };
  if (j.trangThai === 'da_gui') return { lyDo: 'Đã gửi xuống máy in — chờ máy in xác nhận in xong', tamGiu: false };
  return {
    lyDo: `Chưa xác nhận đã in — có thể đang nằm trong máy in${loiCuoi ? ` (${loiCuoi})` : ''}`,
    tamGiu: false,
  };
}

/** Tên khách theo job: dòng print_logs MỚI NHẤT có tên khách của cùng print_job_id. Lỗi → rỗng. */
async function tenKhachTheoJob(p: PrismaHangDoiHuy, ids: string[]): Promise<Map<string, string>> {
  const kq = new Map<string, string>();
  if (ids.length === 0) return kq;
  try {
    const rows = await p.printLog.findMany({
      where: { printJobId: { in: ids }, tenKhach: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { printJobId: true, tenKhach: true },
    });
    for (const r of rows) {
      const id = r.printJobId as string | null;
      const ten = r.tenKhach as string | null;
      if (id && ten && !kq.has(id)) kq.set(id, ten);
    }
  } catch (err) {
    // Bảng nhật ký chưa migrate / DB chập chờn — hàng đợi vẫn hiện, chỉ thiếu tên khách.
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, '[may-in] hàng đợi: không đọc được tên khách');
  }
  return kq;
}

/**
 * Dựng hàng đợi trong phạm vi. `mayInId` (chỉ REST) lọc theo một máy — quy đổi sang token
 * TRƯỚC khi truy vấn (máy mặc định thì gồm cả job agent_token NULL); id lạ → rỗng.
 */
export async function layHangDoi(
  phamVi: PhamViHangDoi,
  loc: { mayInId?: string | null } = {},
  deps: DepsHangDoi = {},
): Promise<HangDoiIn> {
  const p = deps.prisma ?? (await prismaThat());
  const registry = deps.registry ?? agentRegistry;
  const tokenMacDinh = tokenMacDinhCua(deps);
  const bayGio = (deps.bayGio ?? Date.now)();
  const capNhat = new Date(bayGio).toISOString();

  const va: Array<Record<string, unknown>> = [dieuKienPhamVi(phamVi)];
  if (loc.mayInId) {
    const may = await p.printAgent.findFirst({
      where: phamVi.loai === 'org' ? { id: loc.mayInId, orgId: phamVi.orgId } : { id: loc.mayInId },
      select: { token: true },
    });
    if (!may) return { choIn: [], chuaXacNhan: [], capNhat };
    va.push(may.token === tokenMacDinh ? { OR: [{ agentToken: may.token }, { agentToken: null }] } : { agentToken: may.token });
  }

  const [choIn, khongRo] = await Promise.all([
    p.printJob.findMany({
      where: { AND: [...va, { trangThai: { in: ['cho_in', 'dang_gui', 'da_gui'] } }] },
      orderBy: { createdAt: 'asc' },
      take: TRAN_MUC_MOI_NHOM,
      select: CHON_JOB,
    }),
    p.printJob.findMany({
      where: { AND: [...va, { trangThai: 'khong_ro' }, { updatedAt: { gte: new Date(bayGio - MS_CHUA_XAC_NHAN) } }] },
      orderBy: { createdAt: 'asc' },
      take: TRAN_MUC_MOI_NHOM,
      select: CHON_JOB,
    }),
  ]);

  const tatCa = [...choIn, ...khongRo];
  const tokenCua = (j: JobHangDoi): string | null => j.agentToken ?? tokenMacDinh;
  const tokens = [...new Set(tatCa.map(tokenCua).filter((t): t is string => !!t))];
  const mayTheoToken = new Map<string, { id: string; ten: string }>();
  if (tokens.length > 0) {
    const cacMay = await p.printAgent.findMany({ where: { token: { in: tokens } }, select: { id: true, ten: true, token: true } });
    for (const m of cacMay) mayTheoToken.set(m.token, { id: m.id, ten: m.ten });
  }
  const tenKhach = await tenKhachTheoJob(p, tatCa.map((j) => j.id));

  const ttTheoToken = new Map<string, TinhTrangMayHangDoi>();
  const tinhTrang = (token: string | null): TinhTrangMayHangDoi => {
    if (!token) return { cauDao: null, coApp: false, kenhApp: false };
    let tt = ttTheoToken.get(token);
    if (!tt) {
      tt = { cauDao: registry.layCauDao(token), coApp: registry.coAgent(token), kenhApp: tokenMacDinh !== null };
      ttTheoToken.set(token, tt);
    }
    return tt;
  };

  const thanhMuc = (j: JobHangDoi, nhom: NhomHangDoi): MucHangDoi => {
    const token = tokenCua(j);
    const may = token ? mayTheoToken.get(token) : undefined;
    const { lyDo, tamGiu } = lyDoCua(j, tinhTrang(token), token);
    return {
      id: j.id,
      soHoaDon: j.soHoaDon,
      tenKhach: tenKhach.get(j.id) ?? null,
      mayInId: may?.id ?? null,
      // Máy khai bằng env (không có dòng print_agents) — cùng chữ với nhat-ky.ts.
      mayInTen: may?.ten ?? (token && token === tokenMacDinh ? 'Máy mặc định (env)' : null),
      trangThai: j.trangThai as TrangThaiHangDoi,
      nhom,
      lyDo,
      tamGiu,
      lanThu: j.lanThu,
      tao: new Date(j.createdAt).toISOString(),
      capNhat: new Date(j.updatedAt).toISOString(),
      huy: j.trangThai === 'cho_in' ? 'chac_chan' : 'khong',
    };
  };

  return {
    choIn: choIn.map((j) => thanhMuc(j, 'cho_in')),
    chuaXacNhan: khongRo.map((j) => thanhMuc(j, 'chua_xac_nhan')),
    capNhat,
  };
}

// ── Huỷ (§8.2) ───────────────────────────────────────────────────────────────

/** Kết quả khi `cho_in → da_huy` KHÔNG đổi được dòng nào — phân loại theo trạng thái đọc lại. */
export function ketQuaKhiKhongHuyDuoc(id: string, job: Pick<JobHangDoi, 'soHoaDon' | 'trangThai'> | null): KetQuaHuy {
  if (!job) {
    return { id, soHoaDon: null, ok: false, trangThaiMoi: null, loi: 'KHONG_TIM_THAY', noiDung: NOI_DUNG_HUY.khongTimThay };
  }
  const chung = { id, soHoaDon: job.soHoaDon, trangThaiMoi: job.trangThai };
  switch (job.trangThai) {
    case 'da_huy':
      return { ...chung, ok: true, cach: 'da_huy_truoc', noiDung: NOI_DUNG_HUY.daHuyTruoc };
    case 'cho_in': // vừa quay lại cho_in giữa hai câu lệnh (kết quả "thử lại") — người gọi thử lần nữa
    case 'dang_gui':
    case 'da_gui':
      return { ...chung, ok: false, loi: 'DANG_IN', noiDung: NOI_DUNG_HUY.dangIn };
    case 'khong_ro':
      return { ...chung, ok: false, loi: 'CHUA_XAC_NHAN', noiDung: NOI_DUNG_HUY.chuaXacNhan };
    case 'da_in':
      return { ...chung, ok: false, loi: 'DA_IN', noiDung: NOI_DUNG_HUY.daIn };
    case 'bo_qua':
      return { ...chung, ok: false, loi: 'DA_KET_THUC', noiDung: NOI_DUNG_HUY.boQua };
    default: // `loi` và mọi trạng thái kết thúc khác — KHÔNG đổi trạng thái, KHÔNG nói "đã huỷ"
      return { ...chung, ok: false, loi: 'DA_KET_THUC', noiDung: NOI_DUNG_HUY.loi };
  }
}

/** Số lần thử `cho_in → da_huy` khi đọc lại thấy job VỪA quay về cho_in (hiếm: kết quả "thử lại"). */
const SO_LAN_THU_HUY = 3;

/** Id từ mạng/người dùng: chuỗi, không rỗng, ≤ 64 ký tự (uuid 36, cuid ~25). */
export function laIdHopLe(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0 && x.length <= 64;
}

/**
 * Huỷ từng id TUẦN TỰ (mỗi cái 1–2 câu lệnh, không chờ app), trả đủ kết quả theo đúng thứ tự
 * `ids`. Mỗi yêu cầu MỘT dòng nhật ký (`da_huy` / `huy_that_bai`); `da_huy_truoc` không ghi
 * lại (dòng `da_huy` của lần huỷ thật đã có — không ghi đôi). Lỗi DB thì NÉM (người gọi báo
 * "chưa rõ" — không bao giờ tự bịa kết quả).
 */
export async function huyLenhIn(
  phamVi: PhamViHangDoi,
  ids: string[],
  nguon: NguonYeuCau,
  deps: DepsHangDoi = {},
): Promise<KetQuaHuy[]> {
  const p = deps.prisma ?? (await prismaThat());
  const tokenMacDinh = tokenMacDinhCua(deps);
  const ghi = deps.ghiNhatKy ?? ghiNhatKyThat;
  const pv = dieuKienPhamVi(phamVi);
  const nguonChu = chuNguon(nguon);
  const ketQua: KetQuaHuy[] = [];
  const mayDoi = new Set<string | null>();

  for (const id of ids) {
    let kq: KetQuaHuy | null = null;
    let job: JobHangDoi | null = null;
    for (let lan = 0; lan < SO_LAN_THU_HUY && !kq; lan++) {
      const r = await p.printJob.updateMany({
        where: { AND: [{ id, trangThai: 'cho_in' }, pv] },
        data: { trangThai: 'da_huy', loiCuoi: `Đã huỷ bởi ${nguonChu}` },
      });
      job = await p.printJob.findFirst({ where: { AND: [{ id }, pv] }, select: CHON_JOB });
      if (r.count > 0) {
        kq = { id, soHoaDon: job?.soHoaDon ?? null, ok: true, trangThaiMoi: 'da_huy', cach: 'chua_gui', noiDung: NOI_DUNG_HUY.chuaGui };
      } else if (job?.trangThai !== 'cho_in' || lan === SO_LAN_THU_HUY - 1) {
        kq = ketQuaKhiKhongHuyDuoc(id, job);
      }
    }
    const k = kq!;
    ketQua.push(k);
    if (job) mayDoi.add(job.agentToken ?? tokenMacDinh);
    if (k.cach === 'da_huy_truoc') continue; // đã có dòng `da_huy` của lần huỷ thật

    const tenKhach = job ? (await tenKhachTheoJob(p, [id])).get(id) ?? null : null;
    const hd = k.soHoaDon ? `hoá đơn ${k.soHoaDon}` : `mã ${catChu(id, 64)}`;
    const nk: MucNhatKy = {
      loai: k.ok ? 'da_huy' : 'huy_that_bai',
      noiDung: k.ok
        ? `Đã huỷ lệnh in ${hd} — chắc chắn không in (nguồn: ${nguonChu})`
        : `Không huỷ được lệnh in ${hd}: ${nganCua(k, job)} (nguồn: ${nguonChu})`,
      orgId: job?.orgId ?? (phamVi.loai === 'org' ? phamVi.orgId : undefined),
      agentToken: job ? job.agentToken ?? tokenMacDinh : phamVi.loai === 'may' ? phamVi.token : null,
      printJobId: job?.id ?? null,
      soHoaDon: k.soHoaDon,
      tenKhach,
      chiTiet: {
        nguon: nguon.loai,
        ...(k.ok ? { cach: k.cach } : { loi: k.loi, trangThai: job?.trangThai ?? null }),
        ...(job ? {} : { id: catChu(id, 64) }),
      },
    };
    try {
      ghi(nk);
    } catch {
      /* nhật ký không được làm hỏng việc huỷ */
    }
  }
  baoDoiCacMay(deps, mayDoi);
  return ketQua;
}

// ── Bỏ theo dõi (§3.3 + §8.5) ────────────────────────────────────────────────

/**
 * CHỈ `khong_ro → bo_qua` (có điều kiện). KHÔNG chặn việc in, KHÔNG khẳng định gì về giấy —
 * chỉ để danh sách sạch. Ghi `bo_theo_doi` khi thật sự đổi được.
 */
export async function boTheoDoi(
  phamVi: PhamViHangDoi,
  ids: string[],
  nguon: NguonYeuCau,
  deps: DepsHangDoi = {},
): Promise<KetQuaBoTheoDoi[]> {
  const p = deps.prisma ?? (await prismaThat());
  const tokenMacDinh = tokenMacDinhCua(deps);
  const ghi = deps.ghiNhatKy ?? ghiNhatKyThat;
  const pv = dieuKienPhamVi(phamVi);
  const nguonChu = chuNguon(nguon);
  const ketQua: KetQuaBoTheoDoi[] = [];
  const mayDoi = new Set<string | null>();

  for (const id of ids) {
    const r = await p.printJob.updateMany({
      where: { AND: [{ id, trangThai: 'khong_ro' }, pv] },
      data: { trangThai: 'bo_qua', loiCuoi: `Bỏ khỏi hàng đợi bởi ${nguonChu} — không biết đã in hay chưa` },
    });
    const job = await p.printJob.findFirst({ where: { AND: [{ id }, pv] }, select: CHON_JOB });
    if (job) mayDoi.add(job.agentToken ?? tokenMacDinh);
    if (r.count > 0 && job) {
      ketQua.push({ id, ok: true, noiDung: NOI_DUNG_BO_THEO_DOI.ok });
      const tenKhach = (await tenKhachTheoJob(p, [id])).get(id) ?? null;
      try {
        ghi({
          loai: 'bo_theo_doi',
          noiDung: `Bỏ theo dõi hoá đơn ${job.soHoaDon} — hệ thống KHÔNG biết đã in hay chưa, kiểm giấy trước khi in lại (nguồn: ${nguonChu})`,
          orgId: job.orgId,
          agentToken: job.agentToken ?? tokenMacDinh,
          printJobId: job.id,
          soHoaDon: job.soHoaDon,
          tenKhach,
          chiTiet: { nguon: nguon.loai },
        });
      } catch {
        /* như trên */
      }
      continue;
    }
    if (!job) ketQua.push({ id, ok: false, noiDung: NOI_DUNG_BO_THEO_DOI.khongTimThay });
    else if (job.trangThai === 'bo_qua') ketQua.push({ id, ok: true, noiDung: NOI_DUNG_BO_THEO_DOI.daBoTruoc });
    else {
      const moTa = MO_TA_TRANG_THAI[job.trangThai] ?? job.trangThai;
      ketQua.push({ id, ok: false, noiDung: `${NOI_DUNG_BO_THEO_DOI.chiKhongRo} — lệnh này ${moTa}.` });
    }
  }
  baoDoiCacMay(deps, mayDoi);
  return ketQua;
}

function baoDoiCacMay(deps: DepsHangDoi, cac: Set<string | null>): void {
  const registry = deps.registry ?? agentRegistry;
  for (const t of cac) {
    try {
      registry.baoDoiHangDoi?.(t);
    } catch {
      /* snapshot hỏng không được làm hỏng việc huỷ */
    }
  }
}

// ── Gói lại theo một bộ phụ thuộc (routes + agent-ws dùng) ───────────────────

export interface DichVuHangDoi {
  layHangDoi: (phamVi: PhamViHangDoi, loc?: { mayInId?: string | null }) => Promise<HangDoiIn>;
  huyLenhIn: (phamVi: PhamViHangDoi, ids: string[], nguon: NguonYeuCau) => Promise<KetQuaHuy[]>;
  boTheoDoi: (phamVi: PhamViHangDoi, ids: string[], nguon: NguonYeuCau) => Promise<KetQuaBoTheoDoi[]>;
}

export function taoDichVuHangDoi(deps: DepsHangDoi = {}): DichVuHangDoi {
  return {
    layHangDoi: (pv, loc = {}) => layHangDoi(pv, loc, deps),
    huyLenhIn: (pv, ids, nguon) => huyLenhIn(pv, ids, nguon, deps),
    boTheoDoi: (pv, ids, nguon) => boTheoDoi(pv, ids, nguon, deps),
  };
}
