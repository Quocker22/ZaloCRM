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
//   3. `ghiSuCoIn` = sự cố MÁY IN (`su-co`, `tam_giu`) — không gắn trạng thái job; ghi CÓ CHỜ, lỗi thử lại một lần,
//      vẫn lỗi thì logger.error (không bao giờ ném ra luồng in).
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

export interface SuCoIn {
  /** `MA_SU_CO` (nhat-ky.ts) hoặc `tam_giu`. */
  maSuCo: string;
  /** `tam_giu`: mã sự cố gây ngắt cầu dao (null = app không trả lời). */
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
}

export interface DepsSuCoIn {
  prisma?: PrismaSuCoIn;
  /** org khi token không có dòng print_agents (máy HN cũ khai qua env). */
  orgMacDinh?: () => string | null;
}

/** Ghi sự cố máy in. true = đã lưu. Không bao giờ ném. */
export async function ghiSuCoIn(sc: SuCoIn, deps: DepsSuCoIn = {}): Promise<boolean> {
  const thu = async (): Promise<boolean> => {
    const p = deps.prisma ?? ((await import('../../../shared/database/prisma-client.js')).prisma as unknown as PrismaSuCoIn);
    const may = sc.agentToken ? await p.printAgent.findUnique({ where: { token: sc.agentToken } }) : null;
    const orgId = sc.orgId ?? may?.orgId ?? (deps.orgMacDinh ?? orgMacDinhTuEnv)();
    if (!orgId) {
      logger.warn({ maSuCo: sc.maSuCo }, '[may-in] sự cố máy in không xác định được org — không lưu print_su_co');
      return false;
    }
    await p.printSuCo.create({
      data: {
        orgId,
        mayInId: may?.id ?? null,
        mayInTen: may?.ten ?? (sc.agentToken ? 'Máy mặc định (env)' : null),
        printJobId: catChu(sc.printJobId ?? null, 64),
        soHoaDon: catChu(sc.soHoaDon ?? null, 100),
        maSuCo: catChu(sc.maSuCo, MA_LOI_DAI) ?? sc.maSuCo,
        maGoc: catChu(sc.maGoc ?? null, MA_LOI_DAI),
        // Che TRƯỚC rồi mới cắt (như nhat-ky.ts) — token vắt qua mép không lọt nửa đầu.
        chiTiet: catChu(cheToken(sc.chiTiet ?? null, sc.agentToken), 1000),
      },
    });
    return true;
  };
  for (let lan = 0; lan < 2; lan++) {
    try {
      return await thu();
    } catch (err) {
      if (lan === 1) {
        logger.error({ err: err instanceof Error ? err.message : String(err), maSuCo: sc.maSuCo }, '[may-in] KHÔNG lưu được print_su_co');
      }
    }
  }
  return false;
}

