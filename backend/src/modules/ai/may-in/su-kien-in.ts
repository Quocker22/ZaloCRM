// SPDX-License-Identifier: AGPL-3.0-or-later
// Sự kiện in BỀN (docs/78 C1, Codex P0-3) — nguồn cho trạm thông báo của bot: in xong / thất bại / không rõ / huỷ…
//
// VÌ SAO không dựa nhật ký print_logs: `ghiNhatKy` là fire-and-forget (nhat-ky.ts luật 1) — DB chập một nhịp là mất
// dòng, mà mất dòng "in thất bại" là kho không bao giờ được báo. Ở đây:
//   1. Sự kiện đổi trạng thái do TRIGGER DB ghi (migration 20261002090300, Codex v1 #4): AFTER INSERT (tạo job) + AFTER
//      UPDATE OF trang_thai — phủ MỌI đường ghi (mã này, bot psycopg, SQL tay, image cũ sau khi lùi). Mã CRM KHÔNG tự INSERT
//      print_su_kien nữa (ghi cả hai = hai dòng).
//      `capNhatJobCoSuKien` = khoá dòng job (`FOR UPDATE`) + đặt mã lý do `zalocrm.ma_loi` (transaction-local) + UPDATE CÓ
//      ĐIỀU KIỆN trong MỘT giao dịch; trigger đọc mã đó. Thử lại cho_in → cho_in vẫn là sự kiện vì có mã.
//   2. `taoJobCoSuKien` = INSERT job; sự kiện tạo (tu null → cho_in) do trigger.
//   3. Sự cố máy in (`ghiSuCoIn`, `print_su_co`) — không gắn trạng thái job; ghi CÓ CHỜ, gộp theo (org, máy, nhom_su_co),
//      lỗi thì thử lại; người gọi không chờ được thì đưa vào hàng thử lại (`HangThuLaiSuCo`). Xem mục "Sự cố máy in".
// Hàm 1–2 NÉM khi DB lỗi — đúng như updateMany trơn trước đây (người gọi đã xử lý lỗi ghi job).
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { logger } from '../../../shared/utils/logger.js';
import { catChu, cheToken, laMaCapMayIn, orgMacDinhTuEnv } from './nhat-ky.js';

type Dong = Record<string, unknown>;

/** Bề mặt tối thiểu. Prisma THẬT luôn có `$transaction`; bản giả cũ trong test có thể thiếu (xem `capNhatJobCoSuKien`). */
export interface PrismaSuKienIn {
  printJob: {
    updateMany: (a: { where: Dong; data: Dong }) => Promise<{ count: number }>;
    create?: (a: { data: Dong }) => Promise<unknown>;
  };
  printSuKien?: { create: (a: { data: Dong }) => Promise<unknown> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction?: (fn: (tx: any) => Promise<any>) => Promise<any>;
}

export interface ThamSoDoiTrangThai {
  /** print_jobs.id — `where` PHẢI tự khoá đúng id này (điều kiện trạng thái/phạm vi do người gọi đặt). */
  id: string;
  where: Dong;
  /** Phải có `trangThai` (trạng thái đích). */
  data: Dong;
  maLoi?: string | null;
  /**
   * Chỉ dùng khi KHÔNG có giao dịch (bản giả trong test): trạng thái/org đã đọc trước. Đường thật đọc từ dòng đã khoá.
   */
  goiY?: { tu?: string | null; orgId?: string };
}

const MA_LOI_DAI = 64;

/** Chạy `fn` trong giao dịch: Prisma thật ⇒ `tenantTransaction` (không để extension RLS tách lệnh ra giao dịch khác). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function giaoDich<T>(p: PrismaSuKienIn, fn: (tx: any) => Promise<T>): Promise<T> {
  const { prisma, tenantTransaction } = await import('../../../shared/database/prisma-client.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((p as unknown) === (prisma as unknown)) return tenantTransaction(fn as any) as Promise<T>;
  return p.$transaction!(fn);
}

function sangCua(data: Dong): string {
  const s = data.trangThai;
  if (typeof s !== 'string' || !s) throw new Error('capNhatJobCoSuKien: data.trangThai bắt buộc');
  return s;
}

/**
 * UPDATE print_jobs có điều kiện; sự kiện do trigger ghi CÙNG giao dịch, mang `maLoi` qua `zalocrm.ma_loi`. Trả số dòng đã
 * đổi (0 hoặc 1) — người gọi giữ nguyên nghĩa `count` như `updateMany` trước đây.
 */
export async function capNhatJobCoSuKien(p: PrismaSuKienIn, a: ThamSoDoiTrangThai): Promise<number> {
  const sang = sangCua(a.data);
  const maLoi = catChu(a.maLoi ?? null, MA_LOI_DAI);
  if (!p.$transaction) {
    // Bản giả cũ (không giao dịch, không trigger): giả lập đúng một dòng như trigger nếu bản giả có bảng.
    const r = await p.printJob.updateMany({ where: a.where, data: a.data });
    if (r.count === 1 && p.printSuKien) {
      await p.printSuKien.create({
        data: { orgId: a.goiY?.orgId ?? '', jobId: a.id, tuTrangThai: a.goiY?.tu ?? null, sangTrangThai: sang, maLoi },
      });
    }
    return r.count;
  }
  return giaoDich(p, async (tx) => {
    const dong = (await tx.$queryRaw`SELECT trang_thai FROM print_jobs WHERE id = ${a.id} FOR UPDATE`) as Array<{
      trang_thai: string;
    }>;
    if (dong.length === 0) return 0;
    // Gán lại đúng trạng thái cũ mà không mã (không nên xảy ra) ⇒ vẫn là một lần thử lại: đặt mã chung để trigger ghi.
    const ma = maLoi ?? (dong[0].trang_thai === sang ? 'thu_lai' : '');
    await tx.$executeRaw`SELECT set_config('zalocrm.ma_loi', ${ma}, true)`;
    const r = (await tx.printJob.updateMany({ where: a.where, data: a.data })) as { count: number };
    return r.count;
  });
}

/**
 * INSERT job. Sự kiện tạo (null → trạng thái đầu) do TRIGGER `print_jobs_su_kien_tao` ghi CÙNG giao dịch (migration
 * 20261002090300) — trigger phủ cả job bot INSERT thẳng bằng psycopg và in lại bằng SQL tay; mã ở đây KHÔNG ghi thêm
 * (ghi cả hai = hai dòng tạo). Bản giả trong test không có trigger: giả lập đúng một dòng nếu bản giả có bảng sự kiện.
 */
export async function taoJobCoSuKien(p: PrismaSuKienIn, data: Dong): Promise<Dong> {
  const sang = sangCua(data);
  if (!p.printJob.create) throw new Error('taoJobCoSuKien: thiếu printJob.create');
  const job = (await p.printJob.create({ data })) as Dong;
  if (!p.$transaction && p.printSuKien) {
    await p.printSuKien.create({
      data: { orgId: job.orgId, jobId: job.id, tuTrangThai: null, sangTrangThai: sang, maLoi: null },
    });
  }
  return job;
}

// ── Sự cố máy in ────────────────────────────────────────────────────────────
//
// MỘT SỰ CỐ = (org, máy, nhom_su_co) (Codex v1 #3). Cùng một lần hết giấy sinh nhiều dòng: `su-co het_giay` (app thấy khi
// in), `het_giay` (máy rảnh báo trạng thái), `tam_giu` ma_goc=het_giay (cầu dao ngắt), rồi hồi phục `tiep_tuc_in` /
// `het_su_co` ma_goc=het_giay. Mọi dòng đó cùng `nhom_su_co = 'het_giay'` (= ma_goc ?? ma_su_co) — bot GOM theo
// (máy, nhom_su_co) và coi dòng hồi phục là đóng ĐÚNG nhóm đó; nhóm khác (kẹt giấy cùng lúc) vẫn mở.
//
// LƯU RỒI MỚI ĐÁNH DẤU (Codex v1 #2): registry/cầu dao trong RAM có thể đổi TRƯỚC, nhưng việc "đã ghi sự cố" chỉ được coi là
// xong khi `ghiSuCoIn` trả `da_luu`/`trung`. Người gọi:
//   • đường trạng thái máy (agent-ws `dongBoTrangThaiBen`) so trạng thái báo về với trạng thái ĐÃ LƯU (RAM, nạp lại từ dòng
//     cuối trong DB khi tiến trình mới chạy — `docTrangThaiMayDaLuu`) và ghi lại ở MỖI nhịp tới khi lưu được;
//   • sự cố một lần (`su-co`, `tam_giu`, hồi phục khi in được) đi qua MỘT hàng tuần tự `HangThuLaiSuCo` (Codex v2 #2 + #3):
//     xếp cuối hàng + đóng dấu (luc, thu_tu, ma_ghi) LÚC NHẬN, ghi TRƯỚC ra tệp đĩa, rồi mới ghi DB; DB lỗi ⇒ giữ, thử lại
//     theo nhịp; đường trạng thái máy chỉ ghi khi hàng rỗng. Truy vấn mở/đóng xếp theo (luc, thu_tu), không theo id.
//
// KHE CÒN LẠI (ghi rõ — Codex v2 #3): (a) app KHÔNG có ack cho `su-co` (print-agent net.rs emit trơn, hộp thư đi chỉ gửi lại
// khi emit LỖI) ⇒ sự kiện đã tới socket mà tiến trình chết TRƯỚC khi ghi tệp (vài µs, đồng bộ) hoặc gói nằm trong bộ đệm
// socket lúc chết thì mất — muốn kín phải thêm ack-sau-commit ở app (đổi giao thức, ngoài phạm vi CRM); (b) tệp nằm ở volume
// `file_storage`: mất volume / ghi tệp lỗi (log error một lần) ⇒ chỉ còn RAM; (c) trần 500 mục bỏ mục CŨ NHẤT khi DB chập
// rất lâu; (d) MỘT tiến trình backend mỗi volume (hai tiến trình chung tệp sẽ ghi đè nhau).

/** Mã HỒI PHỤC: `het_su_co` (máy về bình thường / gỡ chip) · `tiep_tuc_in` (đóng cầu dao — hoá đơn đang giữ được in tiếp). */
export const MA_HOI_PHUC = ['het_su_co', 'tiep_tuc_in'] as const;
/** Cửa sổ gộp sự cố cùng (máy, mã, nhóm) khi chưa có hồi phục của nhóm — dài hơn nhịp báo trạng thái (20 s). */
export const PHUT_GOP_SU_CO = 10;
const MS_CHO_THU_LAI_SU_CO = 200;
/** Trạng thái máy "không sự cố" (đường trạng thái máy). */
export const BINH_THUONG = 'binh_thuong';

export function laMaHoiPhuc(ma: string): boolean {
  return (MA_HOI_PHUC as readonly string[]).includes(ma);
}

/** `nhom_su_co` của một dòng — xem đầu mục. Thiếu ma_goc ở tam_giu/hồi phục = không rõ mã gốc (app không trả lời…). */
export function nhomSuCo(maSuCo: string, maGoc: string | null | undefined): string {
  if (maGoc) return maGoc;
  return maSuCo === 'tam_giu' || laMaHoiPhuc(maSuCo) ? 'khong_ro' : maSuCo;
}

export interface SuCoIn {
  /** `MA_SU_CO` (nhat-ky.ts), `tam_giu`, hoặc mã hồi phục `MA_HOI_PHUC`. */
  maSuCo: string;
  /** `tam_giu`: mã sự cố gây ngắt cầu dao (null = app không trả lời) · hồi phục: mã sự cố vừa hết. */
  maGoc?: string | null;
  /** Token máy in — CHỈ để tra id/tên/org, KHÔNG BAO GIỜ lưu. */
  agentToken?: string | null;
  orgId?: string | null;
  printJobId?: string | null;
  soHoaDon?: string | null;
  chiTiet?: string | null;
  /** Lúc CRM NHẬN sự cố — hàng thử lại đóng dấu lúc nhận, ghi bù giữ nguyên. Thiếu ⇒ giờ ghi. */
  luc?: Date;
  /** Thứ tự ổn định (µs, đơn điệu) — cùng `luc` quyết thứ tự trong nhóm: truy vấn mở/đóng xếp theo (luc, thu_tu), không theo id. */
  thuTu?: number;
  /** Mã ghi (uuid) — khử trùng ghi bù sau khởi động lại (cột UNIQUE `ma_ghi`). */
  maGhi?: string;
}

export interface PrismaSuCoIn {
  printSuCo: { create: (a: { data: Dong }) => Promise<unknown> };
  printAgent: { findUnique: (a: { where: { token: string } }) => Promise<{ id: string; orgId: string; ten: string } | null> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction?: (fn: (tx: any) => Promise<any>) => Promise<any>;
  /** Đọc trạng thái đã lưu (`docTrangThaiMayDaLuu`); bản giả không có ⇒ coi như chưa có dòng nào. */
  $queryRaw?: (...a: unknown[]) => Promise<unknown>;
}

export interface DepsSuCoIn {
  prisma?: PrismaSuCoIn;
  /** org khi token không có dòng print_agents (máy HN cũ khai qua env). */
  orgMacDinh?: () => string | null;
  /** Chờ giữa hai lần thử (test thay). */
  cho?: (ms: number) => Promise<void>;
}

/**
 * da_luu = đã ghi · trung = sự cố/hồi phục này ĐÃ có trong DB (gộp) · khong_luu = không bao giờ lưu được (không xác định
 * được org — thử lại vô ích) · loi_db = DB lỗi qua hai lần thử (CHƯA lưu — người gọi phải thử lại).
 */
export type KetQuaGhiSuCo = 'da_luu' | 'trung' | 'khong_luu' | 'loi_db';

/** Kết quả nghĩa là "đã nằm trong DB" — chỉ khi đó mới được đánh dấu đã ghi. */
export function daLuuSuCo(kq: unknown): boolean {
  return kq === 'da_luu' || kq === 'trung';
}

type TxRaw = { $queryRaw: (...a: unknown[]) => Promise<unknown> };

/**
 * Dòng này đã có trong DB? (trong giao dịch đã khoá theo máy) — định danh (org, máy, nhom_su_co), THỨ TỰ theo (luc, thu_tu)
 * của chính dòng định ghi (Codex v2 #2 — không theo id: dòng ghi bù có id lớn hơn mà xảy ra trước):
 *   - hồi phục: dòng TRƯỚC NÓ gần nhất của CÙNG nhóm đã là hồi phục (nhóm đã đóng) ⇒ trùng. Nhóm khác không đóng nhóm này.
 *   - sự cố: dòng cùng (org, máy, nhóm, mã) trong PHUT_GOP_SU_CO phút TRƯỚC nó mà giữa hai dòng chưa có hồi phục CỦA NHÓM
 *     ĐÓ ⇒ trùng.
 * `may_in_id` NULL (máy mặc định env không có dòng print_agents) so như một máy. `luc` timestamptz.
 */
async function daCoDongMo(
  tx: TxRaw, orgId: string, mayInId: string | null, ma: string, nhom: string, luc: Date, thuTu: bigint,
): Promise<boolean> {
  if (laMaHoiPhuc(ma)) {
    const r = (await tx.$queryRaw`
      SELECT ma_su_co FROM print_su_co
      WHERE org_id = ${orgId} AND may_in_id IS NOT DISTINCT FROM ${mayInId} AND nhom_su_co = ${nhom}
        AND (luc, thu_tu) < (${luc}::timestamptz, ${thuTu}::bigint)
      ORDER BY luc DESC, thu_tu DESC, id DESC LIMIT 1`) as Array<{ ma_su_co: string }>;
    return r.length > 0 && laMaHoiPhuc(r[0].ma_su_co);
  }
  const r = (await tx.$queryRaw`
    SELECT 1 FROM print_su_co r
    WHERE r.org_id = ${orgId} AND r.may_in_id IS NOT DISTINCT FROM ${mayInId}
      AND r.nhom_su_co = ${nhom} AND r.ma_su_co = ${ma}
      AND r.luc > ${luc}::timestamptz - make_interval(mins => ${PHUT_GOP_SU_CO}::int)
      AND (r.luc, r.thu_tu) <= (${luc}::timestamptz, ${thuTu}::bigint)
      AND NOT EXISTS (
        SELECT 1 FROM print_su_co h
        WHERE h.org_id = r.org_id AND h.may_in_id IS NOT DISTINCT FROM r.may_in_id
          AND h.nhom_su_co = r.nhom_su_co AND h.ma_su_co IN ('het_su_co', 'tiep_tuc_in')
          AND (h.luc, h.thu_tu) > (r.luc, r.thu_tu)
          AND (h.luc, h.thu_tu) < (${luc}::timestamptz, ${thuTu}::bigint))
    LIMIT 1`) as unknown[];
  return r.length > 0;
}

/** Thứ tự µs đơn điệu trong tiến trình — dòng ghi không qua hàng (bản giả, gọi thẳng). Hàng đóng dấu riêng (cùng thang). */
let thuTuTrongTienTrinh = 0;
function thuTuMoi(luc: Date): number {
  thuTuTrongTienTrinh = Math.max(luc.getTime() * 1000, thuTuTrongTienTrinh + 1);
  return thuTuTrongTienTrinh;
}

function choMacDinh(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function prismaSuCo(deps: { prisma?: PrismaSuCoIn }): Promise<PrismaSuCoIn> {
  return deps.prisma ?? ((await import('../../../shared/database/prisma-client.js')).prisma as unknown as PrismaSuCoIn);
}

/** Ghi sự cố máy in (gộp theo sự cố đang mở — xem `daCoDongMo`). Không bao giờ ném. */
export async function ghiSuCoIn(sc: SuCoIn, deps: DepsSuCoIn = {}): Promise<KetQuaGhiSuCo> {
  const thu = async (): Promise<KetQuaGhiSuCo> => {
    const p = await prismaSuCo(deps);
    const may = sc.agentToken ? await p.printAgent.findUnique({ where: { token: sc.agentToken } }) : null;
    const orgId = sc.orgId ?? may?.orgId ?? (deps.orgMacDinh ?? orgMacDinhTuEnv)();
    if (!orgId) {
      logger.warn({ maSuCo: sc.maSuCo }, '[may-in] sự cố máy in không xác định được org — không lưu print_su_co');
      return 'khong_luu';
    }
    const maSuCo = catChu(sc.maSuCo, MA_LOI_DAI) ?? sc.maSuCo;
    const maGoc = catChu(sc.maGoc ?? null, MA_LOI_DAI);
    const nhom = nhomSuCo(maSuCo, maGoc);
    const luc = sc.luc ?? new Date();
    const thuTu = BigInt(sc.thuTu ?? thuTuMoi(luc));
    const data = {
      orgId,
      mayInId: may?.id ?? null,
      mayInTen: may?.ten ?? (sc.agentToken ? 'Máy mặc định (env)' : null),
      printJobId: catChu(sc.printJobId ?? null, 64),
      soHoaDon: catChu(sc.soHoaDon ?? null, 100),
      maSuCo,
      maGoc,
      nhomSuCo: nhom,
      // Che TRƯỚC rồi mới cắt (như nhat-ky.ts) — token vắt qua mép không lọt nửa đầu.
      chiTiet: catChu(cheToken(sc.chiTiet ?? null, sc.agentToken), 1000),
      luc,
      thuTu,
      maGhi: catChu(sc.maGhi ?? null, 64),
    };
    if (!p.$transaction) {
      // Bản giả không giao dịch (test): không gộp.
      await p.printSuCo.create({ data });
      return 'da_luu';
    }
    return giaoDich(p as unknown as PrismaSuKienIn, async (tx) => {
      // Nối đuôi mọi lần ghi của CÙNG máy — hai `su-co` lặp tới cùng lúc không cùng lọt qua bước kiểm.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print_su_co:${orgId}:${data.mayInId ?? '-'}`}))`;
      // Ghi bù một mục ĐÃ commit (tệp hàng thử lại chưa kịp xoá trước khi chết) ⇒ đã có.
      if (data.maGhi && ((await tx.$queryRaw`SELECT 1 FROM print_su_co WHERE ma_ghi = ${data.maGhi} LIMIT 1`) as unknown[]).length) return 'trung';
      if (await daCoDongMo(tx, orgId, data.mayInId, maSuCo, nhom, luc, thuTu)) return 'trung';
      await tx.printSuCo.create({ data });
      return 'da_luu';
    });
  };
  for (let lan = 0; lan < 2; lan++) {
    try {
      return await thu();
    } catch (err) {
      if (lan === 1) {
        logger.error({ err: err instanceof Error ? err.message : String(err), maSuCo: sc.maSuCo }, '[may-in] CHƯA lưu được print_su_co — người gọi thử lại');
      } else {
        await (deps.cho ?? choMacDinh)(MS_CHO_THU_LAI_SU_CO);
      }
    }
  }
  return 'loi_db';
}

/**
 * Trạng thái máy ĐÃ LƯU theo DB — mã sự cố CẤP MÁY của dòng mới nhất (bỏ `tam_giu` và mã cấp job), hoặc `binh_thuong` khi
 * dòng mới nhất là hồi phục / chưa có dòng nào / không xác định được org. NÉM khi DB lỗi (người gọi thử lại nhịp sau).
 * Dùng khi tiến trình mới chạy (RAM trống): "trạng thái đã lưu = dòng cuối trong DB".
 */
export async function docTrangThaiMayDaLuu(
  agentToken: string | null, deps: { prisma?: PrismaSuCoIn; orgMacDinh?: () => string | null } = {},
): Promise<string> {
  const p = await prismaSuCo(deps);
  const may = agentToken ? await p.printAgent.findUnique({ where: { token: agentToken } }) : null;
  const orgId = may?.orgId ?? (deps.orgMacDinh ?? orgMacDinhTuEnv)();
  if (!orgId) return BINH_THUONG;
  if (typeof p.$queryRaw !== 'function') return BINH_THUONG;
  const r = (await (p as unknown as TxRaw).$queryRaw`
    SELECT ma_su_co FROM print_su_co
    WHERE org_id = ${orgId} AND may_in_id IS NOT DISTINCT FROM ${may?.id ?? null} AND ma_su_co <> 'tam_giu'
    ORDER BY luc DESC, thu_tu DESC, id DESC LIMIT 50`) as Array<{ ma_su_co: string }>;
  for (const d of r) {
    if (laMaHoiPhuc(d.ma_su_co)) return BINH_THUONG;
    if (laMaCapMayIn(d.ma_su_co) && d.ma_su_co !== BINH_THUONG) return d.ma_su_co;
  }
  return BINH_THUONG;
}

/** Hàng thử lại sự cố một lần — xem đầu mục "Sự cố máy in" và `taoHangThuLaiSuCo`. */
export interface HangThuLaiSuCo {
  /**
   * Xếp MỘT sự cố vào CUỐI hàng (đóng dấu `luc` + `thuTu` + `maGhi` NGAY lúc gọi — đồng bộ, trước mọi await), ghi nhật ký đĩa,
   * rồi xả hàng theo thứ tự. Trả kết quả của CHÍNH mục này; `loi_db` = chưa lưu, vẫn nằm trong hàng (thử lại theo nhịp).
   * `boSung` = ngữ cảnh tra chậm (org, job…): hàng CHỜ nó ở đầu hàng — mục sau không vượt.
   */
  ghi: (sc: SuCoIn, boSung?: Promise<Partial<SuCoIn>>) => Promise<KetQuaGhiSuCo>;
  /** Ghi NGAY khi hàng rỗng; hàng còn mục ⇒ `loi_db` KHÔNG ghi (đường trạng thái máy tự ghi lại ở nhịp sau — không vượt hàng). */
  ghiNeuRanh: (sc: SuCoIn) => Promise<KetQuaGhiSuCo>;
  /** Thử lại các mục đang chờ theo thứ tự; dừng ở mục đầu tiên vẫn `loi_db`. */
  xa: () => Promise<void>;
  soCho: () => number;
  dung: () => void;
}

export const MS_THU_LAI_SU_CO = 30_000;
/** Trần hàng chờ — DB chập lâu thì bỏ mục CŨ NHẤT (logger.error) thay vì phình RAM/đĩa. */
export const TRAN_HANG_THU_LAI_SU_CO = 500;

/**
 * Tệp nhật ký hàng thử lại mặc định: `PRINT_SU_CO_HANG_FILE`, không có thì `<UPLOAD_DIR>/may-in/su-co-cho.json` (volume
 * `file_storage` — bền qua redeploy). Trong vitest: KHÔNG có tệp (tránh test chéo nhau qua một tệp thật).
 */
export function tepHangThuLaiMacDinh(): string | null {
  if (process.env.PRINT_SU_CO_HANG_FILE !== undefined) return process.env.PRINT_SU_CO_HANG_FILE || null;
  if (process.env.VITEST) return null;
  return join(process.env.UPLOAD_DIR || '/var/lib/zalo-crm/files', 'may-in', 'su-co-cho.json');
}

interface MucCho {
  sc: SuCoIn;
  boSung?: Promise<Partial<SuCoIn>>;
  kq?: KetQuaGhiSuCo;
}

/**
 * MỘT hàng tuần tự cho MỌI sự cố một lần (Codex v2 #2): khi hàng còn mục, dòng mới XẾP SAU (không ghi vượt) — DB chập lúc
 * het_giay + tam_giu rồi sống lại lúc tiep_tuc_in thì DB nhận đúng het_giay → tam_giu → tiep_tuc_in.
 *
 * Thứ tự ỔN ĐỊNH lúc NHẬN: `luc` (giờ CRM lúc nhận, kẹp không lùi) + `thuTu` (= µs của luc, đơn điệu tăng kể cả qua khởi động
 * lại nhờ nạp mức cao nhất từ tệp) + `maGhi` (uuid, khử trùng ở DB). KHÔNG dùng `luc` của app: đồng hồ máy Windows ở kho lệch,
 * còn tam_giu/tiep_tuc_in do CRM sinh — trộn hai đồng hồ là đảo thứ tự; thứ tự TỚI CRM (một socket = TCP có thứ tự) mới là
 * thứ tự nhân quả. `luc` của app vẫn nằm ở nhật ký (`lucApp`).
 *
 * Bền qua khởi động lại (Codex v2 #3): app KHÔNG có ack cho `su-co` (print-agent net.rs emit trơn; hộp thư đi chỉ gửi lại khi
 * emit lỗi) và tam_giu/hồi phục do CRM tự sinh ⇒ không có ai gửi lại. Nên hàng GHI TRƯỚC ra đĩa (`tep`, ghi tạm + rename) ngay
 * lúc nhận — TRƯỚC lần ghi DB đầu — và xoá mục khỏi tệp sau khi DB trả `da_luu`/`trung`/`khong_luu`. Chết giữa chừng ⇒ tiến
 * trình mới nạp tệp, ghi bù; mục đã commit mà chưa kịp xoá khỏi tệp ⇒ `maGhi` trùng ⇒ `trung`. Khe còn lại: xem đầu mục.
 */
export function taoHangThuLaiSuCo(o: {
  ghi: (sc: SuCoIn) => Promise<unknown>;
  msNhip?: number;
  tran?: number;
  bayGio?: () => Date;
  /** đường tệp nhật ký (null/undefined = chỉ RAM) */
  tep?: string | null;
}): HangThuLaiSuCo {
  const cho: MucCho[] = [];
  const msNhip = o.msNhip ?? MS_THU_LAI_SU_CO;
  const tran = o.tran ?? TRAN_HANG_THU_LAI_SU_CO;
  const bayGio = o.bayGio ?? (() => new Date());
  let hen: ReturnType<typeof setTimeout> | null = null;
  let dangXa: Promise<void> | null = null;
  let daDung = false;
  let lucCuoi = 0;
  let thuTuCuoi = 0;
  let daBaoLoiTep = false;

  const ketQua = (x: unknown): KetQuaGhiSuCo =>
    x === 'da_luu' || x === 'trung' || x === 'khong_luu' || x === 'loi_db' ? x : 'loi_db';

  const dongDau = (sc: SuCoIn): SuCoIn => {
    const luc = Math.max((sc.luc ?? bayGio()).getTime(), lucCuoi);
    lucCuoi = luc;
    thuTuCuoi = Math.max(sc.thuTu ?? luc * 1000, thuTuCuoi + 1);
    return { ...sc, luc: new Date(luc), thuTu: thuTuCuoi, maGhi: sc.maGhi ?? randomUUID() };
  };

  const luuTep = (): void => {
    if (!o.tep || daDung) return;
    try {
      mkdirSync(dirname(o.tep), { recursive: true });
      const tam = `${o.tep}.${process.pid}.tmp`;
      writeFileSync(tam, JSON.stringify({ v: 1, muc: cho.map((m) => m.sc) }));
      renameSync(tam, o.tep);
      daBaoLoiTep = false;
    } catch (err) {
      if (!daBaoLoiTep) {
        logger.error({ err: err instanceof Error ? err.message : String(err), tep: o.tep }, '[may-in] KHÔNG ghi được tệp hàng thử lại sự cố — sự cố đang chờ chỉ còn trong RAM');
      }
      daBaoLoiTep = true;
    }
  };

  const napTep = (): void => {
    if (!o.tep || !existsSync(o.tep)) return;
    try {
      const d = JSON.parse(readFileSync(o.tep, 'utf8')) as { muc?: unknown };
      for (const x of Array.isArray(d.muc) ? d.muc : []) {
        const m = x as Record<string, unknown>;
        if (!m || typeof m.maSuCo !== 'string') continue;
        const luc = typeof m.luc === 'string' ? new Date(m.luc) : null;
        const sc: SuCoIn = {
          ...(m as unknown as SuCoIn),
          luc: luc && !Number.isNaN(+luc) ? luc : bayGio(),
          thuTu: typeof m.thuTu === 'number' ? m.thuTu : undefined,
          maGhi: typeof m.maGhi === 'string' ? m.maGhi : undefined,
        };
        cho.push({ sc: dongDau(sc) });
      }
      if (cho.length) logger.warn({ so: cho.length }, '[may-in] nạp hàng thử lại sự cố từ tệp — ghi bù');
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), tep: o.tep }, '[may-in] tệp hàng thử lại sự cố hỏng — bỏ qua');
    }
  };

  const henLai = (ms = msNhip): void => {
    if (hen || daDung || cho.length === 0) return;
    hen = setTimeout(() => {
      hen = null;
      void xa();
    }, ms);
    (hen as { unref?: () => void }).unref?.();
  };

  const vongXa = async (): Promise<void> => {
    try {
      while (cho.length > 0 && !daDung) {
        const m = cho[0];
        if (m.boSung) {
          try {
            m.sc = { ...m.sc, ...(await m.boSung) };
          } catch { /* ngữ cảnh hỏng ⇒ ghi phần đã biết */ }
          m.boSung = undefined;
          luuTep();
        }
        let kq: KetQuaGhiSuCo;
        try {
          kq = ketQua(await o.ghi(m.sc));
        } catch {
          kq = 'loi_db';
        }
        if (daDung) return;
        if (kq === 'loi_db') break;
        m.kq = kq;
        if (cho[0] === m) cho.shift();
        luuTep();
      }
    } finally {
      dangXa = null;
      henLai();
    }
  };

  function xa(): Promise<void> {
    if (!dangXa) dangXa = vongXa();
    return dangXa;
  }

  napTep();
  henLai(0);

  return {
    ghi: async (scGoc, boSung) => {
      const m: MucCho = { sc: dongDau(scGoc), ...(boSung ? { boSung } : {}) };
      if (cho.length >= tran) {
        const bo = cho.shift();
        logger.error({ maSuCo: bo?.sc.maSuCo }, '[may-in] hàng thử lại sự cố đầy — BỎ mục cũ nhất');
      }
      cho.push(m);
      luuTep();
      // Vòng xả đang chạy (nếu có) đọc lại hàng mỗi bước nên sẽ tới mục này — trừ khi dừng vì DB lỗi ở mục đứng trước/chính nó.
      await xa();
      return m.kq ?? 'loi_db';
    },
    ghiNeuRanh: async (sc) => {
      if (cho.length > 0 || dangXa) return 'loi_db';
      try {
        return ketQua(await o.ghi(dongDau(sc)));
      } catch {
        return 'loi_db';
      }
    },
    xa,
    soCho: () => cho.length,
    dung: () => {
      daDung = true;
      if (hen) clearTimeout(hen);
      hen = null;
    },
  };
}

// ── Dọn ─────────────────────────────────────────────────────────────────────

/**
 * Giữ print_su_kien / print_su_co `soNgay` ngày (cùng nhịp donNhatKyCu ở cron.ts, 1 lần/ngày). CHỈ xoá dòng bot ĐÃ NHẬN
 * (`bot_nhan_luc` khác null) — dòng bot chưa nhận (bot ngừng chạy lâu) giữ lại để khi chạy lại bot vẫn thấy. Lỗi thì nuốt.
 */
export async function donSuKienDaNhan(
  soNgay = 30,
  deps: { bayGio?: Date } = {},
): Promise<{ suKien: number; suCo: number }> {
  try {
    const { prisma } = await import('../../../shared/database/prisma-client.js');
    const moc = new Date((deps.bayGio ?? new Date()).getTime() - soNgay * 24 * 3600 * 1000);
    const where = { botNhanLuc: { not: null }, luc: { lt: moc } };
    const [a, b] = await Promise.all([prisma.printSuKien.deleteMany({ where }), prisma.printSuCo.deleteMany({ where })]);
    return { suKien: a.count, suCo: b.count };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[may-in] không dọn được print_su_kien/print_su_co cũ');
    return { suKien: 0, suCo: 0 };
  }
}
