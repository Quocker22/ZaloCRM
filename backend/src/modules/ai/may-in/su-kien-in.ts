// SPDX-License-Identifier: AGPL-3.0-or-later
// Sự kiện in BỀN (docs/78 C1, Codex P0-3) — nguồn cho trạm thông báo của bot: in xong / thất bại / không rõ / huỷ…
//
// VÌ SAO không dựa nhật ký print_logs: `ghiNhatKy` là fire-and-forget (nhat-ky.ts luật 1) — DB chập một nhịp là mất
// dòng, mà mất dòng "in thất bại" là kho không bao giờ được báo. Ở đây:
//   1. `capNhatJobCoSuKien` = UPDATE print_jobs CÓ ĐIỀU KIỆN + INSERT print_su_kien trong MỘT giao dịch; sự kiện chỉ
//      sinh khi UPDATE đổi ĐÚNG một dòng (count 0 = job vừa bị huỷ / kết quả trễ đã chốt ⇒ không có chuyện gì xảy ra).
//      Dòng job bị khoá (`FOR UPDATE`) TRƯỚC khi UPDATE ⇒ `tu_trang_thai` là trạng thái THẬT lúc đổi (kể cả khi điều kiện
//      là một tập trạng thái), `org_id` đọc từ chính dòng job.
//   2. `taoJobCoSuKien` = INSERT job; sự kiện tạo (tu null → cho_in) do TRIGGER DB ghi cùng giao dịch (phủ cả job bot
//      INSERT thẳng bằng SQL).
//   3. `ghiSuCoIn` = sự cố MÁY IN (`su-co`, trạng thái máy rảnh, `tam_giu`, hồi phục) — không gắn trạng thái job; ghi CÓ
//      CHỜ, gộp theo sự cố đang mở (máy, mã), lỗi thì chờ 200 ms thử lại một lần, vẫn lỗi thì logger.error (không ném).
// Hàm 1–2 NÉM khi DB lỗi — đúng như updateMany trơn trước đây (người gọi đã xử lý lỗi ghi job).
import { logger } from '../../../shared/utils/logger.js';
import { catChu, cheToken, orgMacDinhTuEnv } from './nhat-ky.js';

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
 * UPDATE print_jobs có điều kiện + sự kiện cùng giao dịch. Trả số dòng đã đổi (0 hoặc 1) — người gọi giữ nguyên
 * nghĩa `count` như `updateMany` trước đây.
 */
export async function capNhatJobCoSuKien(p: PrismaSuKienIn, a: ThamSoDoiTrangThai): Promise<number> {
  const sang = sangCua(a.data);
  const maLoi = catChu(a.maLoi ?? null, MA_LOI_DAI);
  if (!p.$transaction) {
    // Bản giả cũ (không giao dịch): giữ hành vi cũ; ghi sự kiện nếu bản giả có bảng.
    const r = await p.printJob.updateMany({ where: a.where, data: a.data });
    if (r.count === 1 && p.printSuKien) {
      await p.printSuKien.create({
        data: { orgId: a.goiY?.orgId ?? '', jobId: a.id, tuTrangThai: a.goiY?.tu ?? null, sangTrangThai: sang, maLoi },
      });
    }
    return r.count;
  }
  return giaoDich(p, async (tx) => {
    const dong = (await tx.$queryRaw`SELECT org_id, trang_thai FROM print_jobs WHERE id = ${a.id} FOR UPDATE`) as Array<{
      org_id: string;
      trang_thai: string;
    }>;
    if (dong.length === 0) return 0;
    const r = (await tx.printJob.updateMany({ where: a.where, data: a.data })) as { count: number };
    if (r.count !== 1) return r.count;
    await tx.printSuKien.create({
      data: { orgId: dong[0].org_id, jobId: a.id, tuTrangThai: dong[0].trang_thai, sangTrangThai: sang, maLoi },
    });
    return 1;
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
// MỘT SỰ CỐ = một `nhom_su_co` (docs/78 tự rà P1-4). Cùng một lần hết giấy sinh nhiều dòng: `su-co het_giay` (app thấy khi
// in), `het_giay` (máy rảnh báo trạng thái), `tam_giu` ma_goc=het_giay (cầu dao ngắt), rồi hồi phục `tiep_tuc_in` /
// `het_su_co` ma_goc=het_giay. Mọi dòng đó cùng `nhom_su_co = 'het_giay'` (= ma_goc ?? ma_su_co) — bot GOM theo
// (máy, nhom_su_co) và coi dòng hồi phục là đóng sự cố; không tự suy luận lại từ mã.

/** Mã HỒI PHỤC: `het_su_co` (máy về bình thường / gỡ chip) · `tiep_tuc_in` (đóng cầu dao — hoá đơn đang giữ được in tiếp). */
export const MA_HOI_PHUC = ['het_su_co', 'tiep_tuc_in'] as const;
/** Cửa sổ gộp sự cố cùng (máy, mã) khi chưa có hồi phục — dài hơn nhịp báo trạng thái (20 s) và nhịp thử lại cầu dao. */
export const PHUT_GOP_SU_CO = 10;
const MS_CHO_THU_LAI_SU_CO = 200;

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
}

export interface PrismaSuCoIn {
  printSuCo: { create: (a: { data: Dong }) => Promise<unknown> };
  printAgent: { findUnique: (a: { where: { token: string } }) => Promise<{ id: string; orgId: string; ten: string } | null> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction?: (fn: (tx: any) => Promise<any>) => Promise<any>;
}

export interface DepsSuCoIn {
  prisma?: PrismaSuCoIn;
  /** org khi token không có dòng print_agents (máy HN cũ khai qua env). */
  orgMacDinh?: () => string | null;
  /** Chờ giữa hai lần thử (test thay). */
  cho?: (ms: number) => Promise<void>;
}

/** da_luu = đã ghi · trung = gộp vào sự cố đang mở (không ghi) · khong_luu = không ghi được (thiếu org / DB lỗi). */
export type KetQuaGhiSuCo = 'da_luu' | 'trung' | 'khong_luu';

/**
 * Đã có dòng cùng sự cố đang mở? (trong giao dịch đã khoá theo máy+mã)
 *   - sự cố: dòng cùng (org, máy, mã) trong PHUT_GOP_SU_CO phút mà SAU nó chưa có dòng hồi phục của máy;
 *   - hồi phục: dòng mới nhất của máy đã là hồi phục (không có sự cố nào để đóng thêm).
 * `may_in_id` NULL (máy mặc định env không có dòng print_agents) so như một máy. `luc` là giờ UTC (Prisma gửi now() UTC vào
 * cột TIMESTAMP không múi giờ) ⇒ so với `now() AT TIME ZONE 'UTC'`, KHÔNG với CURRENT_TIMESTAMP (lệch theo TimeZone của DB).
 */
async function daCoDongMo(tx: { $queryRaw: (...a: unknown[]) => Promise<unknown> }, orgId: string, mayInId: string | null, ma: string): Promise<boolean> {
  if (laMaHoiPhuc(ma)) {
    const r = (await tx.$queryRaw`
      SELECT ma_su_co FROM print_su_co WHERE org_id = ${orgId} AND may_in_id IS NOT DISTINCT FROM ${mayInId}
      ORDER BY id DESC LIMIT 1`) as Array<{ ma_su_co: string }>;
    return r.length > 0 && laMaHoiPhuc(r[0].ma_su_co);
  }
  const r = (await tx.$queryRaw`
    SELECT 1 FROM print_su_co r
    WHERE r.org_id = ${orgId} AND r.may_in_id IS NOT DISTINCT FROM ${mayInId} AND r.ma_su_co = ${ma}
      AND r.luc > (now() AT TIME ZONE 'UTC') - make_interval(mins => ${PHUT_GOP_SU_CO}::int)
      AND NOT EXISTS (
        SELECT 1 FROM print_su_co h
        WHERE h.org_id = r.org_id AND h.may_in_id IS NOT DISTINCT FROM r.may_in_id AND h.id > r.id
          AND h.ma_su_co IN ('het_su_co', 'tiep_tuc_in'))
    LIMIT 1`) as unknown[];
  return r.length > 0;
}

/** Ghi sự cố máy in (gộp theo sự cố đang mở — xem `daCoDongMo`). Không bao giờ ném. */
export async function ghiSuCoIn(sc: SuCoIn, deps: DepsSuCoIn = {}): Promise<KetQuaGhiSuCo> {
  const thu = async (): Promise<KetQuaGhiSuCo> => {
    const p = deps.prisma ?? ((await import('../../../shared/database/prisma-client.js')).prisma as unknown as PrismaSuCoIn);
    const may = sc.agentToken ? await p.printAgent.findUnique({ where: { token: sc.agentToken } }) : null;
    const orgId = sc.orgId ?? may?.orgId ?? (deps.orgMacDinh ?? orgMacDinhTuEnv)();
    if (!orgId) {
      logger.warn({ maSuCo: sc.maSuCo }, '[may-in] sự cố máy in không xác định được org — không lưu print_su_co');
      return 'khong_luu';
    }
    const maSuCo = catChu(sc.maSuCo, MA_LOI_DAI) ?? sc.maSuCo;
    const maGoc = catChu(sc.maGoc ?? null, MA_LOI_DAI);
    const data = {
      orgId,
      mayInId: may?.id ?? null,
      mayInTen: may?.ten ?? (sc.agentToken ? 'Máy mặc định (env)' : null),
      printJobId: catChu(sc.printJobId ?? null, 64),
      soHoaDon: catChu(sc.soHoaDon ?? null, 100),
      maSuCo,
      maGoc,
      nhomSuCo: nhomSuCo(maSuCo, maGoc),
      // Che TRƯỚC rồi mới cắt (như nhat-ky.ts) — token vắt qua mép không lọt nửa đầu.
      chiTiet: catChu(cheToken(sc.chiTiet ?? null, sc.agentToken), 1000),
    };
    if (!p.$transaction) {
      // Bản giả không giao dịch (test): không gộp.
      await p.printSuCo.create({ data });
      return 'da_luu';
    }
    return giaoDich(p as unknown as PrismaSuKienIn, async (tx) => {
      // Nối đuôi các lần ghi CÙNG (org, máy, mã) — hai `su-co` lặp tới cùng lúc không cùng lọt qua bước kiểm.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print_su_co:${orgId}:${data.mayInId ?? '-'}`}))`;
      if (await daCoDongMo(tx, orgId, data.mayInId, maSuCo)) return 'trung';
      await tx.printSuCo.create({ data });
      return 'da_luu';
    });
  };
  for (let lan = 0; lan < 2; lan++) {
    try {
      return await thu();
    } catch (err) {
      if (lan === 1) {
        logger.error({ err: err instanceof Error ? err.message : String(err), maSuCo: sc.maSuCo }, '[may-in] KHÔNG lưu được print_su_co');
      } else {
        await (deps.cho ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(MS_CHO_THU_LAI_SU_CO);
      }
    }
  }
  return 'khong_luu';
}
