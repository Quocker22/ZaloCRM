// SPDX-License-Identifier: AGPL-3.0-or-later
// Nhật ký APP máy in — bảng `print_app_logs` (25/09).
//
// App Windows (print-agent) ghi mọi việc nó làm vào một file .txt trên máy tính
// ở chi nhánh. Muốn biết vì sao một tờ không ra, trước đây phải nhờ người ở shop
// gửi file đó. Từ 25/09 app gửi TOÀN BỘ các dòng đó lên qua event `nhat-ky-app`
// (namespace /print-agent, agent-ws.ts) — trang Cài đặt › Nhật ký app máy in xem,
// tìm, tải về được theo từng máy.
//
// KHÁC `print_logs` (nhat-ky.ts): print_logs là nhật ký NGHIỆP VỤ do backend viết
// (mỗi hoá đơn vài dòng, lưu 90 ngày); bảng này là log THÔ của app (nhiều dòng,
// lưu 30 ngày). Hai bảng không trộn.
//
// HỢP ĐỒNG với app (app viết song song theo đúng chữ này — đừng đổi):
//   - backend quảng bá `nhat_ky_app` trong `cau-hinh.hoTro` (HO_TRO_APP);
//   - app emit `nhat-ky-app` CÓ ack, payload
//       { dong: [{ luc, suKien, noiDung }] (1..500), boQua, phienBan };
//     `boQua` = số dòng app bỏ từ lô trước vì bộ đệm đầy;
//   - backend ack { ok: true, soDong } SAU khi đã lưu, hoặc { ok: false, loi: '<MÃ>' }.
//     Không ack / ok:false → app gửi lại NGUYÊN lô ⇒ lưu phải lặp-được: mỗi dòng có
//     khoá sha1(token, luc, suKien, noiDung) UNIQUE + createMany skipDuplicates.
//
// BA LUẬT (cùng tinh thần nhat-ky.ts):
//   1. KHÔNG LƯU TOKEN: che token trong chữ TRƯỚC khi cắt; khoá là sha1 (không đảo được).
//   2. KHÔNG BAO GIỜ NÉM ra socket: mọi lỗi thành ack ok:false — app tự gửi lại sau.
//   3. KHÔNG TIN DỮ LIỆU MẠNG: dòng sai thì bỏ, chữ cắt trần, giới hạn lô/phút mỗi socket.
import { createHash } from 'node:crypto';
import { logger } from '../../../shared/utils/logger.js';
import { boDau } from './ten-file-in.js';
import {
  catChu,
  cheToken,
  docConTro,
  docNgay,
  orgMacDinhTuEnv,
  taoTraMayIn,
  taoTuKhoa,
  ThamSoSai,
  type MayInTom,
} from './nhat-ky.js';

// ── Hằng hợp đồng ────────────────────────────────────────────────────────────

export const TRAN_DONG_MOT_LO = 500;
export const TRAN_SU_KIEN = 64;
export const TRAN_NOI_DUNG = 4000;
export const TRAN_PHIEN_BAN = 40;
/** `luc` của app đi trước đồng hồ máy chủ quá chừng này → dòng sai, bỏ. */
const MS_TUONG_LAI_TOI_DA = 24 * 3600 * 1000;
/**
 * `luc` trước mốc này → dòng sai, bỏ. Hợp đồng chỉ nói "ngày hợp lệ", nhưng Date của JS
 * nhận cả năm −200000 mà Postgres thì không: một dòng như thế làm hỏng CẢ lô, app gửi
 * lại mãi không qua. Máy tính hết pin CMOS thường về 2000-01-01 — vẫn nhận.
 */
const MS_LUC_SOM_NHAT = Date.UTC(2000, 0, 1);
/** Dòng giả ghi khi app báo đã bỏ dòng vì bộ đệm đầy. */
export const SU_KIEN_BO_DONG = 'app_bo_dong';
/** Tên máy khi token không có trong print_agents — cùng chữ với nhat-ky.ts. */
const TEN_MAY_ENV = 'Máy mặc định (env)';

/** Giới hạn tần suất MỖI SOCKET: quá thì ack QUA_TAI, app gửi lại sau. */
export const GIOI_HAN_LO_MOI_PHUT = 20;
export const GIOI_HAN_DONG_MOI_PHUT = 5000;

export type MaLoiNhatKyApp = 'SAI_DU_LIEU' | 'QUA_TAI' | 'CHUA_MIGRATE' | 'KHONG_RO_ORG' | 'LOI_LUU';
export type AckNhatKyApp = { ok: true; soDong: number } | { ok: false; loi: MaLoiNhatKyApp };

// ── Mức độ một dòng log app (hợp đồng hàng đợi/huỷ v5 §5 + §8.9) ─────────────
//
// Cột `muc_do` phân loại LÚC LƯU; migration 20260925200000_print_app_logs_muc_do backfill
// bằng CÙNG luật: câu SQL CASE trong migration được SINH từ đúng bảng luật dưới đây
// (sqlPhanLoaiMucDoApp) và test khoá "migration chứa đúng chuỗi sinh ra" + đối chiếu TS↔SQL
// trên Postgres thật khi có (CO_DB_TEST=1). Sửa luật = sửa bảng này + migration MỚI.
//
// So chữ trên dạng CHUẨN HOÁ NFC ở cả hai phía (JS `normalize('NFC')`, SQL `normalize(…, NFC)`)
// — "hết giấy" gõ NFD vẫn khớp. So PHÂN BIỆT hoa thường, đúng như hợp đồng viết.
// "Từ đầu tiên" = đoạn trước khoảng trắng đầu tiên (dấu cách/tab/xuống dòng) sau khi bỏ
// khoảng trắng đầu dòng.

export type MucDoApp = 'loi' | 'canh_bao' | 'thong_tin';
export type LocMucDoApp = MucDoApp | 'loi_canh_bao';

/** Điều kiện trên `noi_dung` của một luật (vắng = mọi nội dung). */
export type DieuKienNoiDungApp =
  /** chứa ít nhất một chuỗi */
  | { chua: readonly string[] }
  /** từ đầu tiên thuộc danh sách */
  | { tuDauLa: readonly string[] }
  /** từ đầu tiên KHÔNG thuộc danh sách */
  | { tuDauKhong: readonly string[] }
  /** từ đầu tiên bắt đầu bằng */
  | { tuDauBatDau: string };

export interface LuatMucDoApp {
  mucDo: Exclude<MucDoApp, 'thong_tin'>;
  /** Khớp NGUYÊN mã su_kien (một trong danh sách)… */
  suKien?: readonly string[];
  /** …hoặc mã bắt đầu bằng tiền tố này. */
  tienTo?: string;
  noiDung?: DieuKienNoiDungApp;
}

/**
 * Bảng luật — luật ĐẦU TIÊN khớp thắng; không luật nào khớp → `thong_tin`. Luật `loi` đứng
 * trước luật `canh_bao` (usb_doc vừa "hết giấy" vừa "KHONG DOC DUOC" là lỗi).
 * §8.9: `huy_that_bai` KHÔNG phải mã app (bỏ khỏi §5); app ghi `huy_yeu_cau` (thông tin) và
 * `huy_ket_qua` với nội dung bắt đầu `ok=true`/`ok=false` — `ok=false` là cảnh báo.
 */
export const LUAT_MUC_DO_APP: readonly LuatMucDoApp[] = [
  { mucDo: 'loi', suKien: ['su_co'] },
  // khong_in_het_giay, khong_in_hang_doi_ket, khong_in_khong_tim_thay_may_in, …
  { mucDo: 'loi', tienTo: 'khong_in_' },
  { mucDo: 'loi', suKien: ['ket_qua'], noiDung: { chua: ['trang_thai=loi', 'trang_thai=khong_ro'] } },
  { mucDo: 'loi', suKien: ['trang_thai_may_in'], noiDung: { tuDauKhong: ['binh_thuong', 'het_muc'] } },
  { mucDo: 'loi', suKien: ['usb_doc'], noiDung: { chua: ['TRỐNG', 'báo lỗi', 'hết giấy'] } },
  {
    mucDo: 'loi',
    suKien: ['theo_doi_tiep_mat', 'theo_doi_tiep_het_han', 'tu_choi_ket_noi', 'sumatra_qua_han', 'sumatra_loi_cho'],
  },
  // Bổ sung sau khi đối chiếu mã app 0.2.6 thật ghi ra (hợp đồng §5 sót): app đã tạm dừng một job
  // Windows mà KHÔNG cho chạy tiếp được — hoá đơn kẹt "Paused" trong hàng đợi Windows.
  { mucDo: 'loi', suKien: ['tiep_tuc_loi'] },
  { mucDo: 'canh_bao', suKien: ['trang_thai_may_in'], noiDung: { tuDauLa: ['het_muc'] } },
  { mucDo: 'canh_bao', suKien: ['usb_doc'], noiDung: { chua: ['KHONG DOC DUOC'] } },
  {
    mucDo: 'canh_bao',
    suKien: [
      'noi_that_bai', 'mat_ket_noi', 'gui_nhat_ky_loi', 'app_bo_dong', 'mat_job', 'ngat_client_cham',
      'hop_thu_tran', 'theo_doi_tiep_bo', 'bo_theo_doi',
    ],
  },
  { mucDo: 'canh_bao', suKien: ['huy_ket_qua'], noiDung: { tuDauBatDau: 'ok=false' } },
  // Bổ sung (app 0.2.6): mất kết nối quá lâu → dựng lại client; server không gửi cau-hinh trong
  // 10 s (bản cũ); theo dõi tiếp bỏ qua job lúc khởi động.
  { mucDo: 'canh_bao', suKien: ['noi_lai_tu_dau', 'server_ban_cu', 'theo_doi_tiep_bo_qua'] },
];

const nfc = (x: string): string => x.normalize('NFC');

/** Từ đầu tiên (xem đầu mục). Cùng biểu thức với phía SQL. */
export function tuDauTien(noiDung: string): string {
  return /^[ \t\r\n]*([^ \t\r\n]*)/.exec(noiDung)?.[1] ?? '';
}

function khopLuat(l: LuatMucDoApp, suKien: string, noiDung: string): boolean {
  const theoMa = (l.suKien?.some((m) => nfc(m) === suKien) ?? false)
    || (l.tienTo !== undefined && suKien.startsWith(nfc(l.tienTo)));
  if (!theoMa) return false;
  const d = l.noiDung;
  if (!d) return true;
  if ('chua' in d) return d.chua.some((c) => noiDung.includes(nfc(c)));
  const tu = tuDauTien(noiDung);
  if ('tuDauLa' in d) return d.tuDauLa.some((c) => tu === nfc(c));
  if ('tuDauKhong' in d) return !d.tuDauKhong.some((c) => tu === nfc(c));
  return tu.startsWith(nfc(d.tuDauBatDau));
}

/** Mức của một dòng log app — trên chữ ĐÃ LƯU (đã che token, cắt trần), như backfill thấy. */
export function phanLoaiMucDoApp(suKien: string, noiDung: string): MucDoApp {
  const sk = nfc(suKien ?? '');
  const nd = nfc(noiDung ?? '');
  for (const l of LUAT_MUC_DO_APP) if (khopLuat(l, sk, nd)) return l.mucDo;
  return 'thong_tin';
}

/** Chuỗi SQL an toàn (chữ trong bảng luật do ta viết — vẫn nhân đôi dấu nháy cho chắc). */
const sqlChu = (x: string): string => `normalize('${nfc(x).replace(/'/g, "''")}', NFC)`;
const SQL_SU_KIEN = 'normalize("su_kien", NFC)';
const SQL_NOI_DUNG = 'normalize("noi_dung", NFC)';
// E'' để \t \r \n thành ký tự thật trước khi tới bộ regex — không phụ thuộc standard_conforming_strings.
const SQL_TU_DAU = `coalesce(substring(${SQL_NOI_DUNG} from E'^[ \\t\\r\\n]*([^ \\t\\r\\n]*)'), '')`;

function sqlLuat(l: LuatMucDoApp): string {
  const ma: string[] = [];
  if (l.suKien?.length) ma.push(`${SQL_SU_KIEN} IN (${l.suKien.map(sqlChu).join(', ')})`);
  if (l.tienTo !== undefined) ma.push(`left(${SQL_SU_KIEN}, ${[...nfc(l.tienTo)].length}) = ${sqlChu(l.tienTo)}`);
  const dkMa = ma.length > 1 ? `(${ma.join(' OR ')})` : ma[0];
  const d = l.noiDung;
  if (!d) return dkMa;
  let dkNd: string;
  if ('chua' in d) dkNd = `(${d.chua.map((c) => `strpos(${SQL_NOI_DUNG}, ${sqlChu(c)}) > 0`).join(' OR ')})`;
  else if ('tuDauLa' in d) dkNd = `${SQL_TU_DAU} IN (${d.tuDauLa.map(sqlChu).join(', ')})`;
  else if ('tuDauKhong' in d) dkNd = `${SQL_TU_DAU} NOT IN (${d.tuDauKhong.map(sqlChu).join(', ')})`;
  else dkNd = `left(${SQL_TU_DAU}, ${[...nfc(d.tuDauBatDau)].length}) = ${sqlChu(d.tuDauBatDau)}`;
  return `${dkMa} AND ${dkNd}`;
}

/**
 * Biểu thức SQL CASE tương đương `phanLoaiMucDoApp` trên cột "su_kien"/"noi_dung" — SINH từ
 * LUAT_MUC_DO_APP, dán nguyên văn vào migration backfill (test khoá hai bên khớp nhau).
 */
export function sqlPhanLoaiMucDoApp(): string {
  const nhanh = LUAT_MUC_DO_APP.map((l) => `    WHEN ${sqlLuat(l)} THEN '${l.mucDo}'`);
  return ['CASE', ...nhanh, "    ELSE 'thong_tin'", '  END'].join('\n');
}

// ── Đọc lô từ app ────────────────────────────────────────────────────────────

/** Một dòng đã kiểm + che token + cắt trần, kèm khoá chống trùng. */
export interface DongDaDoc {
  luc: Date;
  suKien: string;
  noiDung: string;
  khoa: string;
}

export interface LoDaDoc {
  dong: DongDaDoc[];
  /** Số phần tử `dong` app gửi (đã kẹp trần 500) — dùng tính giới hạn tần suất. */
  soNhan: number;
  /** Số phần tử bị bỏ vì sai. */
  soSai: number;
  boQua: number;
  phienBan: string | null;
}

/**
 * Khoá chống trùng của một dòng: sha1(token, luc, suKien, noiDung) — tính trên chữ GỐC
 * app gửi (hai dòng chỉ khác nhau sau ký tự thứ 4000 vẫn là hai dòng). Có token nên hai
 * máy ghi cùng một câu cùng một mili-giây không đè nhau. Ghép bằng ký tự phân cách
 * U+001F để "ab"+"c" và "a"+"bc" không ra cùng một khoá.
 */
export function taoKhoaDong(token: string, lucIso: string, suKien: string, noiDung: string): string {
  return createHash('sha1').update([token, lucIso, suKien, noiDung].join('\u001f')).digest('hex');
}

/** Chữ từ app: che token TRƯỚC rồi mới cắt (cắt trước thì token vắt qua mép lọt nửa đầu). */
function chuApp(x: unknown, token: string, tran: number): string | null {
  return catChu(x === null || x === undefined ? x : cheToken(String(x), token), tran);
}

function docDong(x: unknown, token: string, bayGio: number): DongDaDoc | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const { luc, suKien, noiDung } = x as Record<string, unknown>;
  if (typeof luc !== 'string' || typeof suKien !== 'string') return null;
  const t = new Date(luc);
  const ms = t.getTime();
  if (Number.isNaN(ms) || ms < MS_LUC_SOM_NHAT || ms > bayGio + MS_TUONG_LAI_TOI_DA) return null;
  // noiDung rỗng/vắng vẫn là một dòng (app có thể chỉ ghi mã sự kiện); kiểu lạ thì sai.
  const nd = noiDung === undefined || noiDung === null ? '' : typeof noiDung === 'string' ? noiDung : null;
  if (nd === null) return null;
  const suKienSach = chuApp(suKien, token, TRAN_SU_KIEN);
  if (!suKienSach) return null;
  return {
    luc: t,
    suKien: suKienSach,
    noiDung: chuApp(nd, token, TRAN_NOI_DUNG) ?? '',
    khoa: taoKhoaDong(token, t.toISOString(), suKien, nd),
  };
}

/**
 * Đọc payload `nhat-ky-app`. null = sai dạng hẳn (không phải object / `dong` không phải
 * mảng). Phần tử sai trong `dong` thì bỏ riêng nó (luật 3), không bỏ cả lô. Quá 500
 * phần tử (app sai hợp đồng) thì chỉ đọc 500 phần tử đầu.
 */
export function docLoNhatKyApp(payload: unknown, token: string, bayGio: number = Date.now()): LoDaDoc | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const o = payload as Record<string, unknown>;
  if (!Array.isArray(o.dong)) return null;
  const tho = o.dong.slice(0, TRAN_DONG_MOT_LO);
  const dong: DongDaDoc[] = [];
  for (const x of tho) {
    const d = docDong(x, token, bayGio);
    if (d) dong.push(d);
  }
  const boQuaSo = Number(o.boQua);
  const boQua = Number.isFinite(boQuaSo) && boQuaSo >= 1 ? Math.min(Math.floor(boQuaSo), 1_000_000_000) : 0;
  return {
    dong,
    soNhan: tho.length,
    soSai: tho.length - dong.length,
    boQua,
    phienBan: chuApp(o.phienBan, token, TRAN_PHIEN_BAN),
  };
}

/**
 * Dòng giả "App bỏ N dòng nhật ký (bộ đệm đầy)". Đặt ngay TRƯỚC dòng sớm nhất của lô
 * (chỗ hở nằm giữa lô trước và lô này) — gửi lại cùng lô ra cùng lúc, cùng khoá, nên
 * không thành hai dòng. Lô không còn dòng hợp lệ nào thì lấy giờ máy chủ.
 */
export function dongBoQua(token: string, lo: LoDaDoc, bayGio: number = Date.now()): DongDaDoc {
  const somNhat = lo.dong.reduce<number | null>((m, d) => (m === null || d.luc.getTime() < m ? d.luc.getTime() : m), null);
  const luc = new Date(somNhat === null ? bayGio : somNhat - 1);
  const noiDung = `App bỏ ${lo.boQua} dòng nhật ký (bộ đệm đầy)`;
  return { luc, suKien: SU_KIEN_BO_DONG, noiDung, khoa: taoKhoaDong(token, luc.toISOString(), SU_KIEN_BO_DONG, noiDung) };
}

// ── Giới hạn tần suất (mỗi socket) ───────────────────────────────────────────

export interface GioiHanNhatKyApp {
  /** true = cho qua (đã tính lô này vào cửa sổ); false = quá tải, lô KHÔNG được tính. */
  thu(soDong: number): boolean;
}

/**
 * Cửa sổ trượt 1 phút: tối đa 20 lô HOẶC 5000 dòng. Lô bị từ chối không tính — app
 * gửi lại sau không tự khoá mình thêm. App bắt kịp dòng tồn sau khi mất mạng lâu vẫn
 * qua được (5000 dòng/phút), chỉ chậm lại.
 */
export function taoGioiHanNhatKyApp(tuy: {
  soLo?: number;
  soDong?: number;
  msCua?: number;
  bayGio?: () => number;
} = {}): GioiHanNhatKyApp {
  const soLoToiDa = tuy.soLo ?? GIOI_HAN_LO_MOI_PHUT;
  const soDongToiDa = tuy.soDong ?? GIOI_HAN_DONG_MOI_PHUT;
  const msCua = tuy.msCua ?? 60_000;
  const bayGio = tuy.bayGio ?? Date.now;
  const lich: Array<{ luc: number; soDong: number }> = [];
  return {
    thu(soDong: number): boolean {
      const nay = bayGio();
      while (lich.length && lich[0].luc <= nay - msCua) lich.shift();
      const daDung = lich.reduce((s, x) => s + x.soDong, 0);
      if (lich.length >= soLoToiDa || daDung + soDong > soDongToiDa) return false;
      lich.push({ luc: nay, soDong });
      return true;
    },
  };
}

// ── Lưu ──────────────────────────────────────────────────────────────────────

/** Bề mặt Prisma tối thiểu — nhận PrismaClient thật lẫn bản giả trong test. */
export interface PrismaNhatKyApp {
  printAppLog: {
    createMany: (a: { data: Array<Record<string, unknown>>; skipDuplicates?: boolean }) => Promise<{ count: number }>;
    findMany: (a: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
    deleteMany: (a: { where: Record<string, unknown> }) => Promise<{ count: number }>;
  };
  printAgent: {
    findUnique: (a: { where: { token: string } }) => Promise<MayInTom | null>;
    findFirst: (a: Record<string, unknown>) => Promise<{ ten: string } | null>;
  };
}

async function prismaThat(): Promise<PrismaNhatKyApp> {
  const { prisma } = await import('../../../shared/database/prisma-client.js');
  return prisma as unknown as PrismaNhatKyApp;
}

/**
 * Bảng chưa tạo (P2021) hoặc CỘT chưa có (P2022 — deploy code trước migration muc_do): ack
 * CHUA_MIGRATE, app giữ lô gửi lại sau; trang xem trả 503 nói rõ cần chạy migration.
 */
export function laLoiChuaMigrate(err: unknown): boolean {
  const ma = (err as { code?: string } | null)?.code;
  return ma === 'P2021' || ma === 'P2022';
}

export interface DepsNhatKyApp {
  /** Mặc định: Prisma thật (nạp lười — test không cần DB). */
  prisma?: PrismaNhatKyApp;
  /** org dùng khi token không có trong print_agents (máy HN cũ khai qua env). */
  orgMacDinh?: () => string | null;
  /** Đồng hồ — test tiêm được. */
  bayGio?: () => number;
}

/** Một lô `nhat-ky-app` của một socket → ack. KHÔNG BAO GIỜ ném (luật 2). */
export type NhanNhatKyApp = (token: string, payload: unknown, gioiHan?: GioiHanNhatKyApp) => Promise<AckNhatKyApp>;

/**
 * Tạo hàm nhận lô nhật ký app. `orgId`/`mayInId`/`mayInTen` tra theo token y như
 * `taoGhiNhatKy` (print_agents theo token, nhớ 60s, không có thì org mặc định env).
 */
export function taoNhanNhatKyApp(deps: DepsNhatKyApp = {}): NhanNhatKyApp {
  const bayGio = deps.bayGio ?? Date.now;
  const orgMacDinh = deps.orgMacDinh ?? orgMacDinhTuEnv;
  const traMayIn = taoTraMayIn(bayGio);
  let daBaoChuaMigrate = false;
  let daBaoKhongRoOrg = false;
  let lanBaoLoiCuoi = 0;

  return async function nhan(token, payload, gioiHan) {
    try {
      const lo = docLoNhatKyApp(payload, token, bayGio());
      if (!lo) return { ok: false, loi: 'SAI_DU_LIEU' };
      if (gioiHan && !gioiHan.thu(lo.soNhan)) return { ok: false, loi: 'QUA_TAI' };
      if (lo.soSai > 0) {
        logger.debug({ soSai: lo.soSai, soNhan: lo.soNhan }, '[may-in] nhat-ky-app: bỏ dòng sai');
      }
      if (lo.dong.length === 0 && lo.boQua === 0) return { ok: true, soDong: 0 };

      const p = deps.prisma ?? (await prismaThat());
      const may = await traMayIn(p, token);
      const orgId = may?.orgId ?? orgMacDinh();
      if (!orgId) {
        // org_id NOT NULL — không lưu được. Lỗi cấu hình: app giữ lô, gửi lại sau khi sửa.
        if (!daBaoKhongRoOrg) {
          daBaoKhongRoOrg = true;
          logger.warn(`[may-in] nhat-ky-app: token ...${token.slice(-4)} không có trong print_agents và thiếu AI_MAY_IN_ORG_ID — không lưu được`);
        }
        return { ok: false, loi: 'KHONG_RO_ORG' };
      }
      const chung = {
        orgId,
        mayInId: may?.id ?? null,
        mayInTen: may?.ten ?? TEN_MAY_ENV,
        phienBan: lo.phienBan,
      };
      const thanhHang = (d: DongDaDoc): Record<string, unknown> => ({
        ...chung,
        luc: d.luc,
        suKien: d.suKien,
        noiDung: d.noiDung,
        // Phân loại trên chữ ĐÃ LƯU — đúng thứ backfill SQL nhìn thấy.
        mucDo: phanLoaiMucDoApp(d.suKien, d.noiDung),
        khoa: d.khoa,
        tuKhoa: taoTuKhoa([d.suKien, d.noiDung]),
      });

      let soDong = 0;
      if (lo.dong.length > 0) {
        const kq = await p.printAppLog.createMany({ data: lo.dong.map(thanhHang), skipDuplicates: true });
        soDong = kq.count;
      }
      // Dòng "bỏ N dòng" ghi riêng để `soDong` chỉ đếm dòng của app. Lỗi ở đây → ok:false,
      // app gửi lại: dòng thật đã có sẵn (bỏ qua theo khoá), chỉ dòng này được ghi lại.
      if (lo.boQua > 0) {
        await p.printAppLog.createMany({ data: [thanhHang(dongBoQua(token, lo, bayGio()))], skipDuplicates: true });
      }
      return { ok: true, soDong };
    } catch (err) {
      if (laLoiChuaMigrate(err)) {
        if (!daBaoChuaMigrate) {
          daBaoChuaMigrate = true;
          logger.warn('[may-in] chưa tạo bảng/cột print_app_logs (migration 20260925180000_print_app_logs / 20260925200000_print_app_logs_muc_do) — app sẽ gửi lại nhật ký sau');
        }
        return { ok: false, loi: 'CHUA_MIGRATE' };
      }
      // DB chập chờn: app gửi lại vài giây một lần — báo tối đa 1 lần/phút cho khỏi ngập log.
      if (bayGio() - lanBaoLoiCuoi > 60_000) {
        lanBaoLoiCuoi = bayGio();
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[may-in] không lưu được nhật ký app');
      }
      return { ok: false, loi: 'LOI_LUU' };
    }
  };
}

/** Singleton cho luồng thật (agent-ws). */
export const nhanNhatKyApp = taoNhanNhatKyApp();

// ── Đọc / tìm ────────────────────────────────────────────────────────────────

export interface ThamSoNhatKyApp {
  q: string[];
  mayInId: string | null;
  /** Rỗng = mọi sự kiện; khớp NGUYÊN mã. */
  suKien: string[];
  /** Lọc mức (cột muc_do); null = mọi mức. */
  mucDo: LocMucDoApp | null;
  tu: Date;
  den: Date;
  /** Trang CŨ hơn (luc DESC, id DESC). */
  truoc: { luc: Date; id: string } | null;
  /** Dòng MỚI hơn (luc ASC, id ASC) — giao diện "tự làm mới" chỉ lấy phần mới. */
  sau: { luc: Date; id: string } | null;
  gioiHan: number;
}

const GIO_MS = 3600 * 1000;
const MUC_DO_APP_HOP_LE: LocMucDoApp[] = ['loi', 'canh_bao', 'thong_tin', 'loi_canh_bao'];

/**
 * Đọc query string → tham số đã kiểm. Ném ThamSoSai khi sai (route trả 400).
 * Mặc định 24 giờ gần nhất. Vắng `den` thì trần là "bây giờ + 1 ngày" — đúng trần lúc
 * NHẬN dòng: máy tính shop chạy nhanh giờ vài phút thì dòng mới nhất vẫn hiện.
 */
export function phanTichThamSoApp(query: Record<string, unknown>, bayGio: Date = new Date()): ThamSoNhatKyApp {
  const qTho = typeof query.q === 'string' ? query.q : '';
  // Mỗi từ phải có mặt (AND) — "job 1234 loi" tìm dòng có đủ ba từ.
  const q = taoTuKhoa([qTho.slice(0, 200)]).split(' ').filter((t) => t.length > 0).slice(0, 8);

  const mucDoTho = typeof query.mucDo === 'string' && query.mucDo ? query.mucDo : null;
  if (mucDoTho && !MUC_DO_APP_HOP_LE.includes(mucDoTho as LocMucDoApp)) {
    throw new ThamSoSai(`mucDo phải là một trong: ${MUC_DO_APP_HOP_LE.join(', ')}`);
  }

  const suKienTho = typeof query.suKien === 'string' ? query.suKien : '';
  const suKien = [...new Set(suKienTho.split(',').map((s) => s.trim().slice(0, TRAN_SU_KIEN)).filter(Boolean))].slice(0, 20);

  const denTho = docNgay(query.den, 'den');
  const tuTho = docNgay(query.tu, 'tu');
  const den = denTho ?? new Date(bayGio.getTime() + 24 * GIO_MS);
  const tu = tuTho ?? new Date((denTho ?? bayGio).getTime() - 24 * GIO_MS);
  if (tu > den) throw new ThamSoSai('tu phải trước den');

  const truoc = docConTro(query.truoc, 'truoc');
  const sau = docConTro(query.sau, 'sau');
  if (truoc && sau) throw new ThamSoSai('chỉ dùng một trong truoc / sau');

  const gioiHanTho = Number(query.gioiHan ?? 200);
  const gioiHan = Number.isFinite(gioiHanTho) ? Math.min(500, Math.max(1, Math.floor(gioiHanTho))) : 200;

  return {
    q,
    mayInId: typeof query.mayInId === 'string' && query.mayInId ? query.mayInId.slice(0, 100) : null,
    suKien,
    mucDo: mucDoTho as LocMucDoApp | null,
    tu,
    den,
    truoc,
    sau,
    gioiHan,
  };
}

/** Dựng where Prisma — tách riêng để test được không cần DB. */
export function taoWhereNhatKyApp(orgId: string, t: ThamSoNhatKyApp): Record<string, unknown> {
  const va: Array<Record<string, unknown>> = [
    { orgId },
    { luc: { gte: t.tu, lte: t.den } },
    ...t.q.map((tu) => ({ tuKhoa: { contains: tu } })),
  ];
  if (t.mayInId) va.push({ mayInId: t.mayInId });
  if (t.suKien.length === 1) va.push({ suKien: t.suKien[0] });
  else if (t.suKien.length > 1) va.push({ suKien: { in: t.suKien } });
  if (t.mucDo === 'loi_canh_bao') va.push({ mucDo: { in: ['loi', 'canh_bao'] } });
  else if (t.mucDo) va.push({ mucDo: t.mucDo });
  // Con trỏ ổn định theo (luc, id) — hai dòng cùng mili-giây không bị mất/lặp.
  if (t.truoc) {
    va.push({
      OR: [
        { luc: { lt: t.truoc.luc } },
        { luc: t.truoc.luc, id: { lt: t.truoc.id } },
      ],
    });
  }
  if (t.sau) {
    va.push({
      OR: [
        { luc: { gt: t.sau.luc } },
        { luc: t.sau.luc, id: { gt: t.sau.id } },
      ],
    });
  }
  return { AND: va };
}

export interface NhatKyApp {
  id: string;
  /** ISO — giờ của APP (máy tính shop), không phải giờ máy chủ nhận. */
  luc: string;
  mayInId: string | null;
  mayInTen: string | null;
  suKien: string;
  noiDung: string;
  phienBan: string | null;
  mucDo: MucDoApp;
}

const CHON_COT = {
  id: true, luc: true, mayInId: true, mayInTen: true, suKien: true, noiDung: true, phienBan: true, mucDo: true,
} as const;

const laMucDoApp = (x: unknown): x is MucDoApp => x === 'loi' || x === 'canh_bao' || x === 'thong_tin';

function thanhNhatKyApp(r: Record<string, unknown>): NhatKyApp {
  return {
    id: String(r.id),
    luc: new Date(r.luc as string | Date).toISOString(),
    mayInId: (r.mayInId as string | null) ?? null,
    mayInTen: (r.mayInTen as string | null) ?? null,
    suKien: String(r.suKien),
    noiDung: String(r.noiDung ?? ''),
    phienBan: (r.phienBan as string | null) ?? null,
    // Cột có sẵn (NOT NULL); giá trị lạ → tính lại theo luật thay vì trả rác.
    mucDo: laMucDoApp(r.mucDo) ? r.mucDo : phanLoaiMucDoApp(String(r.suKien), String(r.noiDung ?? '')),
  };
}

/**
 * Một trang nhật ký app. Mặc định mới nhất trước (luc DESC). Có `sau` thì ngược lại —
 * CŨ nhất trước trong số dòng mới hơn con trỏ, để `tiepTheo` (dòng cuối) nối tiếp được.
 * `tiepTheo` luôn là con trỏ đi TIẾP cùng chiều; null = hết.
 */
export async function timNhatKyApp(
  orgId: string,
  t: ThamSoNhatKyApp,
  deps: { prisma?: PrismaNhatKyApp } = {},
): Promise<{ items: NhatKyApp[]; tiepTheo: string | null }> {
  const p = deps.prisma ?? (await prismaThat());
  const chieu = t.sau ? 'asc' : 'desc';
  const rows = await p.printAppLog.findMany({
    where: taoWhereNhatKyApp(orgId, t),
    orderBy: [{ luc: chieu }, { id: chieu }],
    take: t.gioiHan + 1, // lấy dư 1 để biết còn trang sau
    select: CHON_COT,
  });
  const coThem = rows.length > t.gioiHan;
  const items = (coThem ? rows.slice(0, t.gioiHan) : rows).map(thanhNhatKyApp);
  const cuoi = items[items.length - 1];
  return { items, tiepTheo: coThem && cuoi ? `${cuoi.luc}|${cuoi.id}` : null };
}

// ── Tải về (.txt) ────────────────────────────────────────────────────────────

export const TRAN_DONG_TAI_VE = 200_000;
const LECH_GIO_VN_MS = 7 * GIO_MS;
const hai = (n: number) => String(n).padStart(2, '0');

/** Giờ Việt Nam (UTC+7 cố định) "dd/MM HH:mm:ss" — không theo múi giờ của máy chủ. */
export function gioVN(luc: Date | string): string {
  const d = new Date(new Date(luc).getTime() + LECH_GIO_VN_MS);
  return `${hai(d.getUTCDate())}/${hai(d.getUTCMonth() + 1)} ${hai(d.getUTCHours())}:${hai(d.getUTCMinutes())}:${hai(d.getUTCSeconds())}`;
}

/** Một cột của dòng .txt: TAB và xuống dòng trong chữ không được phá cột/dòng. */
function cotTxt(s: unknown): string {
  return String(s ?? '').replace(/\r\n|\r|\n/g, '\\n').replace(/\t/g, ' ');
}

/** `<luc ISO>\t<giờ VN dd/MM HH:mm:ss>\t<máy in>\t<suKien>\t<noiDung>` (không kèm "\n"). */
export function dongTaiVe(r: { luc: Date | string; mayInTen?: string | null; suKien: string; noiDung: string }): string {
  const luc = new Date(r.luc);
  return [luc.toISOString(), gioVN(luc), cotTxt(r.mayInTen || '—'), cotTxt(r.suKien), cotTxt(r.noiDung)].join('\t');
}

/** `nhat-ky-may-in-<ten hoặc tat-ca>-<yyyyMMdd-HHmm giờ VN>.txt` — chỉ ký tự ASCII an toàn. */
export function tenFileTaiVe(tenMay: string | null, bayGio: Date = new Date()): string {
  const ten = tenMay
    ? boDau(tenMay).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'may-in'
    : 'tat-ca';
  const d = new Date(bayGio.getTime() + LECH_GIO_VN_MS);
  const moc = `${d.getUTCFullYear()}${hai(d.getUTCMonth() + 1)}${hai(d.getUTCDate())}-${hai(d.getUTCHours())}${hai(d.getUTCMinutes())}`;
  return `nhat-ky-may-in-${ten}-${moc}.txt`;
}

/**
 * Nội dung file tải về, CŨ nhất trước, từng khúc (mỗi khúc một lượt query `loMoiLan`
 * dòng) — không dựng 200k dòng trong bộ nhớ. Bỏ qua con trỏ của `t`. Quá `tran` dòng
 * thì dừng, thêm một dòng cuối nói đã cắt.
 */
export async function* sinhNoiDungTaiVe(
  orgId: string,
  t: ThamSoNhatKyApp,
  deps: { prisma?: PrismaNhatKyApp; tran?: number; loMoiLan?: number } = {},
): AsyncGenerator<string> {
  const p = deps.prisma ?? (await prismaThat());
  const tran = deps.tran ?? TRAN_DONG_TAI_VE;
  const loMoiLan = deps.loMoiLan ?? 2000;
  let conTro: ThamSoNhatKyApp['sau'] = null;
  let daXuat = 0;
  for (;;) {
    const lay = Math.min(loMoiLan, tran - daXuat) + 1; // dư 1 để biết còn
    const rows = await p.printAppLog.findMany({
      where: taoWhereNhatKyApp(orgId, { ...t, truoc: null, sau: conTro }),
      orderBy: [{ luc: 'asc' }, { id: 'asc' }],
      take: lay,
      select: CHON_COT,
    });
    const trang = rows.slice(0, lay - 1).map(thanhNhatKyApp);
    if (trang.length > 0) yield `${trang.map(dongTaiVe).join('\n')}\n`;
    else if (daXuat === 0) yield '# Không có dòng nhật ký nào khớp bộ lọc.\n';
    daXuat += trang.length;
    if (rows.length < lay) return;
    if (daXuat >= tran) {
      yield `# ĐÃ CẮT: chỉ xuất ${tran} dòng cũ nhất — còn dòng mới hơn chưa xuất, thu hẹp khoảng thời gian hoặc bộ lọc.\n`;
      return;
    }
    const cuoi = trang[trang.length - 1];
    conTro = { luc: new Date(cuoi.luc), id: cuoi.id };
  }
}

/** Giữ nhật ký app 30 ngày (theo lúc máy chủ NHẬN). Lỗi thì nuốt — dọn rác không được làm hỏng cron in. */
export async function donNhatKyAppCu(
  soNgay = 30,
  deps: { prisma?: PrismaNhatKyApp; bayGio?: Date } = {},
): Promise<number> {
  try {
    const p = deps.prisma ?? (await prismaThat());
    const moc = new Date((deps.bayGio ?? new Date()).getTime() - soNgay * 24 * GIO_MS);
    const kq = await p.printAppLog.deleteMany({ where: { nhanLuc: { lt: moc } } });
    return kq.count;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[may-in] không dọn được nhật ký app cũ');
    return 0;
  }
}
