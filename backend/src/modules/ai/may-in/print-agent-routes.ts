// SPDX-License-Identifier: AGPL-3.0-or-later
// print-agent-routes.ts — REST API quản lý máy in nhiều chi nhánh (Task 6).
//
// Mount prefix: /api/v1/may-in-agents
//
//   GET    /            liệt kê máy in của org (token CHỈ hiện đuôi + online)
//   GET    /khos        danh sách kho (KHO const, kieu.ts) — cho dropdown Vue (Task 7)
//   POST   /            tạo máy in mới -> trả {mayIn, token, serverUrl} (token đầy đủ 1 LẦN)
//   PUT    /:id         sửa tên/kho phục vụ/mặc định
//   DELETE /:id         xoá máy in
//   GET    /nhat-ky              nhật ký máy in (nghiệp vụ, print_logs) — CHỈ admin
//   GET    /nhat-ky-app          nhật ký APP máy in (log thô từ app, print_app_logs) — CHỈ admin
//   GET    /nhat-ky-app/tai-ve   tải về .txt cùng bộ lọc — CHỈ admin
//   GET    /hang-doi?mayInId=         hàng đợi in {choIn, chuaXacNhan, capNhat} — CHỈ admin
//   POST   /hang-doi/huy              huỷ lệnh in {ids: 1..50} → {ketQua: KetQuaHuy[]} — CHỈ admin
//   POST   /hang-doi/bo-theo-doi      bỏ theo dõi lệnh chưa xác nhận {ids} → {ketQua} — CHỈ admin
//   (hàng đợi/huỷ: hợp đồng docs/may-in/HOP-DONG-HANG-DOI-HUY-v5.md mục 8, huy-lenh-in.ts)
//   GET    /lich-su?trangThai=da_in|da_huy&mayInId=&truoc=&gioiHan=
//                                     "Đã in" / "Đã huỷ" 30 ngày {items, tiepTheo, tong, tu, capNhat} — CHỈ admin
//   GET    /lich-su/dem               số trên hai thẻ {daIn, daHuy, tu, capNhat} (cả org) — CHỈ admin
//   (lịch sử in: lich-su-in.ts — chỉ đọc DB, mốc 30 ngày theo updated_at)
//
// Guard: CHỈ admin/owner được ghi (POST/PUT/DELETE) — theo đúng khuôn
// agent-operator-routes.ts (mở RANH GIỚI BẢO MẬT: ai vào bảng này là cầm được
// token định tuyến job in thật của org). GET (list + khos) cho mọi user đã
// đăng nhập xem — không lộ gì nhạy cảm (token đã cắt đuôi).
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import { config } from '../../../config/index.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import {
  taoMayIn, danhSachMayIn, suaMayIn, xoaMayIn, danhSachKho, MayInKhongTimThay,
} from './print-agent-service.js';
import { phanTichThamSo, timNhatKy, ThamSoSai } from './nhat-ky.js';
import {
  phanTichThamSoApp,
  timNhatKyApp,
  sinhNoiDungTaiVe,
  tenFileTaiVe,
  laLoiChuaMigrate,
} from './nhat-ky-app.js';
import { taoDichVuHangDoi, laIdHopLe, type DichVuHangDoi } from './huy-lenh-in.js';
import { phanTichThamSoLichSu, timLichSuIn, demLichSuIn } from './lich-su-in.js';

function laAdmin(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * Nhật ký máy in — tìm không dấu, lọc máy/mức/loại/khoảng thời gian, tải thêm
 * bằng con trỏ (hợp đồng §3.5). CHỈ owner/admin: nhật ký có tên khách và số
 * hoá đơn. orgId LUÔN lấy từ phiên đăng nhập, không bao giờ từ query.
 * Tách khỏi route để test được không cần dựng JWT/Fastify.
 */
export async function traNhatKy(
  user: { orgId: string; role: string },
  query: Record<string, unknown>,
  deps: { tim?: typeof timNhatKy } = {},
): Promise<{ code: number; body: unknown }> {
  if (!laAdmin(user.role)) return { code: 403, body: { error: 'CHI_ADMIN' } };
  let thamSo;
  try {
    thamSo = phanTichThamSo(query ?? {});
  } catch (err) {
    if (err instanceof ThamSoSai) return { code: 400, body: { error: 'THAM_SO_SAI', message: err.message } };
    throw err;
  }
  try {
    return { code: 200, body: await (deps.tim ?? timNhatKy)(user.orgId, thamSo) };
  } catch (err) {
    // Bảng chưa tạo (deploy code trước khi chạy migration print_logs — Prisma
    // P2021): báo rõ thay vì 500 "Máy chủ lỗi" chung chung.
    if ((err as { code?: string })?.code === 'P2021') {
      return { code: 503, body: { error: 'CHUA_MIGRATE', message: 'Chưa tạo bảng nhật ký máy in (migration 20260925090000_print_logs)' } };
    }
    throw err;
  }
}

const CHUA_MIGRATE_APP = {
  error: 'CHUA_MIGRATE',
  message: 'Chưa tạo bảng/cột nhật ký app máy in (migration 20260925180000_print_app_logs + 20260925200000_print_app_logs_muc_do)',
} as const;

/** Đọc tham số nhật ký app — trả lỗi 400 thay vì ném. */
function docThamSoApp(query: Record<string, unknown>):
  | { thamSo: ReturnType<typeof phanTichThamSoApp> }
  | { code: number; body: unknown } {
  try {
    return { thamSo: phanTichThamSoApp(query ?? {}) };
  } catch (err) {
    if (err instanceof ThamSoSai) return { code: 400, body: { error: 'THAM_SO_SAI', message: err.message } };
    throw err;
  }
}

/**
 * Nhật ký APP máy in (nhat-ky-app.ts) — mọi dòng app Windows ghi vào file .txt ở shop.
 * Lọc máy/sự kiện/khoảng/từ khoá; `truoc` = trang cũ hơn, `sau` = dòng mới hơn (tự làm
 * mới). CHỈ owner/admin (cùng luật /nhat-ky). orgId LUÔN từ phiên đăng nhập.
 */
export async function traNhatKyApp(
  user: { orgId: string; role: string },
  query: Record<string, unknown>,
  deps: { tim?: typeof timNhatKyApp } = {},
): Promise<{ code: number; body: unknown }> {
  if (!laAdmin(user.role)) return { code: 403, body: { error: 'CHI_ADMIN' } };
  const doc = docThamSoApp(query);
  if ('code' in doc) return doc;
  try {
    return { code: 200, body: await (deps.tim ?? timNhatKyApp)(user.orgId, doc.thamSo) };
  } catch (err) {
    if (laLoiChuaMigrate(err)) return { code: 503, body: CHUA_MIGRATE_APP };
    throw err;
  }
}

// ── Hàng đợi in + huỷ lệnh in (huy-lenh-in.ts) ───────────────────────────────

/** Một dịch vụ dùng chung (registry singleton + env máy mặc định) — tạo lười. */
let dichVuMacDinh: DichVuHangDoi | null = null;
function dichVuHangDoi(): DichVuHangDoi {
  dichVuMacDinh ??= taoDichVuHangDoi();
  return dichVuMacDinh;
}

/** Trần id mỗi yêu cầu huỷ / bỏ theo dõi (hợp đồng §3.2). */
export const TRAN_ID_MOT_YEU_CAU = 50;

/** `{ ids: string[] }` 1..50 id hợp lệ → mảng id; sai → null (route trả 400). */
export function docIds(body: unknown): string[] | null {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > TRAN_ID_MOT_YEU_CAU) return null;
  return ids.every(laIdHopLe) ? (ids as string[]) : null;
}

const IDS_SAI = { error: 'THAM_SO_SAI', message: `ids phải là mảng 1..${TRAN_ID_MOT_YEU_CAU} mã lệnh in` } as const;

async function layTenNguoiDungThat(userId: string): Promise<string | null> {
  const { prisma } = await import('../../../shared/database/prisma-client.js');
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  return u?.fullName?.trim() || null;
}

/** Tên người dùng cho dòng nhật ký "nguồn: ZaloCRM (<tên>)" — lỗi thì rơi về email. */
async function tenNguoiDung(
  user: { id?: string; email?: string },
  lay: (id: string) => Promise<string | null>,
): Promise<string | null> {
  try {
    if (user.id) return (await lay(user.id)) ?? user.email ?? null;
  } catch {
    /* tra tên lỗi không được chặn việc huỷ */
  }
  return user.email ?? null;
}

type NguoiDung = { id?: string; email?: string; orgId: string; role: string };

/** GET /hang-doi — hàng đợi của org (lọc một máy bằng `mayInId`). orgId LUÔN từ phiên. */
export async function traHangDoi(
  user: NguoiDung,
  query: Record<string, unknown>,
  deps: { dichVu?: DichVuHangDoi } = {},
): Promise<{ code: number; body: unknown }> {
  if (!laAdmin(user.role)) return { code: 403, body: { error: 'CHI_ADMIN' } };
  const mayInId = typeof query?.mayInId === 'string' && query.mayInId ? query.mayInId.slice(0, 100) : null;
  const body = await (deps.dichVu ?? dichVuHangDoi()).layHangDoi({ loai: 'org', orgId: user.orgId }, { mayInId });
  return { code: 200, body };
}

/** POST /hang-doi/huy — huỷ CHẮC CHẮN (chỉ cho_in), kết quả từng id đúng thứ tự. */
export async function traHuyLenhIn(
  user: NguoiDung,
  body: unknown,
  deps: { dichVu?: DichVuHangDoi; layTenNguoiDung?: (id: string) => Promise<string | null> } = {},
): Promise<{ code: number; body: unknown }> {
  if (!laAdmin(user.role)) return { code: 403, body: { error: 'CHI_ADMIN' } };
  const ids = docIds(body);
  if (!ids) return { code: 400, body: IDS_SAI };
  const ten = await tenNguoiDung(user, deps.layTenNguoiDung ?? layTenNguoiDungThat);
  const ketQua = await (deps.dichVu ?? dichVuHangDoi()).huyLenhIn({ loai: 'org', orgId: user.orgId }, ids, { loai: 'crm', ten });
  return { code: 200, body: { ketQua } };
}

/** POST /hang-doi/bo-theo-doi — CHỈ lệnh chưa xác nhận (khong_ro → bo_qua); KHÔNG chặn việc in. */
export async function traBoTheoDoi(
  user: NguoiDung,
  body: unknown,
  deps: { dichVu?: DichVuHangDoi; layTenNguoiDung?: (id: string) => Promise<string | null> } = {},
): Promise<{ code: number; body: unknown }> {
  if (!laAdmin(user.role)) return { code: 403, body: { error: 'CHI_ADMIN' } };
  const ids = docIds(body);
  if (!ids) return { code: 400, body: IDS_SAI };
  const ten = await tenNguoiDung(user, deps.layTenNguoiDung ?? layTenNguoiDungThat);
  const ketQua = await (deps.dichVu ?? dichVuHangDoi()).boTheoDoi({ loai: 'org', orgId: user.orgId }, ids, { loai: 'crm', ten });
  return { code: 200, body: { ketQua } };
}

// ── Lịch sử in "Đã in" / "Đã huỷ" (lich-su-in.ts) ────────────────────────────

/**
 * GET /lich-su — một trang "Đã in" hoặc "Đã huỷ" trong 30 ngày gần nhất (lọc máy bằng `mayInId`,
 * trang sau bằng con trỏ `truoc`). CHỈ owner/admin (có tên khách + số hoá đơn, như hàng đợi).
 * orgId LUÔN từ phiên đăng nhập, không bao giờ từ query.
 */
export async function traLichSu(
  user: { orgId: string; role: string },
  query: Record<string, unknown>,
  deps: { tim?: typeof timLichSuIn } = {},
): Promise<{ code: number; body: unknown }> {
  if (!laAdmin(user.role)) return { code: 403, body: { error: 'CHI_ADMIN' } };
  let thamSo;
  try {
    thamSo = phanTichThamSoLichSu(query ?? {});
  } catch (err) {
    if (err instanceof ThamSoSai) return { code: 400, body: { error: 'THAM_SO_SAI', message: err.message } };
    throw err;
  }
  return { code: 200, body: await (deps.tim ?? timLichSuIn)(user.orgId, thamSo) };
}

/** GET /lich-su/dem — số lệnh "Đã in" / "Đã huỷ" của cả org trong 30 ngày (số trên hai thẻ). */
export async function traDemLichSu(
  user: { orgId: string; role: string },
  deps: { dem?: typeof demLichSuIn } = {},
): Promise<{ code: number; body: unknown }> {
  if (!laAdmin(user.role)) return { code: 403, body: { error: 'CHI_ADMIN' } };
  return { code: 200, body: await (deps.dem ?? demLichSuIn)(user.orgId) };
}

async function layTenMayThat(orgId: string, mayInId: string): Promise<string | null> {
  const { prisma } = await import('../../../shared/database/prisma-client.js');
  const may = await prisma.printAgent.findFirst({ where: { id: mayInId, orgId }, select: { ten: true } });
  return may?.ten ?? null;
}

export type KetQuaTaiVe =
  | { code: number; body: unknown }
  | { code: 200; tenFile: string; noiDung: AsyncIterable<string> };

/**
 * Tải về .txt (cùng bộ lọc, không con trỏ) — CŨ nhất trước, trần 200k dòng, đọc từng khúc.
 * Khúc ĐẦU được đọc trước khi trả để lỗi "chưa migrate"/DB còn thành mã HTTP đàng hoàng
 * (header chưa gửi); lỗi giữa chừng sau đó thì chỉ còn cách cắt kết nối.
 */
export async function traTaiVeNhatKyApp(
  user: { orgId: string; role: string },
  query: Record<string, unknown>,
  deps: {
    sinh?: typeof sinhNoiDungTaiVe;
    layTenMay?: (orgId: string, mayInId: string) => Promise<string | null>;
    bayGio?: () => Date;
  } = {},
): Promise<KetQuaTaiVe> {
  if (!laAdmin(user.role)) return { code: 403, body: { error: 'CHI_ADMIN' } };
  const doc = docThamSoApp(query);
  if ('code' in doc) return doc;
  const thamSo = { ...doc.thamSo, truoc: null, sau: null };
  const it = (deps.sinh ?? sinhNoiDungTaiVe)(user.orgId, thamSo)[Symbol.asyncIterator]();
  let dau: IteratorResult<string>;
  let tenMay: string | null = null;
  try {
    dau = await it.next();
    if (thamSo.mayInId) tenMay = (await (deps.layTenMay ?? layTenMayThat)(user.orgId, thamSo.mayInId)) ?? thamSo.mayInId;
  } catch (err) {
    if (laLoiChuaMigrate(err)) return { code: 503, body: CHUA_MIGRATE_APP };
    throw err;
  }
  async function* noiDung(): AsyncGenerator<string> {
    if (dau.done) return;
    yield dau.value;
    for (;;) {
      const r = await it.next();
      if (r.done) return;
      yield r.value;
    }
  }
  return { code: 200, tenFile: tenFileTaiVe(tenMay, (deps.bayGio ?? (() => new Date()))()), noiDung: noiDung() };
}

/**
 * URL server để dán vào app print-agent-rs (cùng HTTP server Fastify, agent
 * nối WS namespace `/print-agent` — xem agent-ws.ts). Base lấy từ config.appUrl
 * (env APP_URL) — chính domain public backend đang chạy, KHÔNG phải hằng số
 * riêng cho máy in vì socket.io mount chung server với REST API.
 */
function layServerUrl(): string {
  // Domain PUBLIC agent noi toi (Cloudflare tunnel), KHONG phai APP_URL noi bo.
  const base = (process.env.MAY_IN_SERVER_URL || config.appUrl || "").trim();
  return base.replace(/\/+$/, "");
}

export async function registerPrintAgentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── Danh sách máy in (token chỉ hiện đuôi + trạng thái online) ──────────
  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user!;
    const mayIn = await danhSachMayIn(user.orgId);
    return reply.send({ mayIn });
  });

  // ── Nhật ký máy in (xem traNhatKy) ────────────────────────────────────────
  app.get('/nhat-ky', async (
    req: FastifyRequest<{ Querystring: Record<string, unknown> }>,
    reply: FastifyReply,
  ) => {
    const kq = await traNhatKy(req.user!, req.query ?? {});
    return reply.code(kq.code).send(kq.body);
  });

  // ── Nhật ký APP máy in (xem traNhatKyApp / traTaiVeNhatKyApp) ────────────
  app.get('/nhat-ky-app', async (
    req: FastifyRequest<{ Querystring: Record<string, unknown> }>,
    reply: FastifyReply,
  ) => {
    const kq = await traNhatKyApp(req.user!, req.query ?? {});
    return reply.code(kq.code).send(kq.body);
  });

  app.get('/nhat-ky-app/tai-ve', async (
    req: FastifyRequest<{ Querystring: Record<string, unknown> }>,
    reply: FastifyReply,
  ) => {
    const kq = await traTaiVeNhatKyApp(req.user!, req.query ?? {});
    if (!('noiDung' in kq)) return reply.code(kq.code).send(kq.body);
    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${kq.tenFile}"`)
      .header('Cache-Control', 'no-store')
      .send(Readable.from(kq.noiDung));
  });

  // ── Hàng đợi in + huỷ lệnh in (xem traHangDoi / traHuyLenhIn / traBoTheoDoi) ──
  app.get('/hang-doi', async (
    req: FastifyRequest<{ Querystring: Record<string, unknown> }>,
    reply: FastifyReply,
  ) => {
    const kq = await traHangDoi(req.user!, req.query ?? {});
    return reply.code(kq.code).send(kq.body);
  });

  app.post('/hang-doi/huy', async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const kq = await traHuyLenhIn(req.user!, req.body ?? {});
    return reply.code(kq.code).send(kq.body);
  });

  app.post('/hang-doi/bo-theo-doi', async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const kq = await traBoTheoDoi(req.user!, req.body ?? {});
    return reply.code(kq.code).send(kq.body);
  });

  // ── Lịch sử in "Đã in" / "Đã huỷ" 30 ngày (xem traLichSu / traDemLichSu) ────
  app.get('/lich-su', async (
    req: FastifyRequest<{ Querystring: Record<string, unknown> }>,
    reply: FastifyReply,
  ) => {
    const kq = await traLichSu(req.user!, req.query ?? {});
    return reply.code(kq.code).send(kq.body);
  });

  app.get('/lich-su/dem', async (req: FastifyRequest, reply: FastifyReply) => {
    const kq = await traDemLichSu(req.user!);
    return reply.code(kq.code).send(kq.body);
  });

  // ── Danh sách kho chuẩn (dropdown Vue) ───────────────────────────────────
  app.get('/khos', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ khos: danhSachKho() });
  });

  // ── Tạo máy in mới -> trả token đầy đủ + serverUrl (CHỈ LẦN NÀY) ────────
  app.post('/', async (
    req: FastifyRequest<{ Body: { ten?: string; warehouseIds?: number[]; laMacDinh?: boolean } }>,
    reply: FastifyReply,
  ) => {
    const user = req.user!;
    if (!laAdmin(user.role)) return reply.code(403).send({ error: 'CHI_ADMIN' });

    const ten = req.body.ten?.trim();
    if (!ten) return reply.code(400).send({ error: 'THIEU_TEN' });
    const warehouseIds = Array.isArray(req.body.warehouseIds) ? req.body.warehouseIds : [];

    const { mayIn, token } = await taoMayIn({
      orgId: user.orgId,
      ten,
      warehouseIds,
      laMacDinh: req.body.laMacDinh ?? false,
    });

    return reply.code(201).send({ mayIn, token, serverUrl: layServerUrl() });
  });

  // ── Sửa tên/kho phục vụ/mặc định ─────────────────────────────────────────
  app.put('/:id', async (
    req: FastifyRequest<{ Params: { id: string }; Body: { ten?: string; warehouseIds?: number[]; laMacDinh?: boolean } }>,
    reply: FastifyReply,
  ) => {
    const user = req.user!;
    if (!laAdmin(user.role)) return reply.code(403).send({ error: 'CHI_ADMIN' });

    try {
      const mayIn = await suaMayIn(user.orgId, req.params.id, {
        ten: req.body.ten?.trim(),
        warehouseIds: req.body.warehouseIds,
        laMacDinh: req.body.laMacDinh,
      });
      return reply.send({ mayIn });
    } catch (err) {
      if (err instanceof MayInKhongTimThay) return reply.code(404).send({ error: 'KHONG_TIM_THAY' });
      throw err;
    }
  });

  // ── Xoá máy in ────────────────────────────────────────────────────────────
  app.delete('/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = req.user!;
    if (!laAdmin(user.role)) return reply.code(403).send({ error: 'CHI_ADMIN' });

    try {
      await xoaMayIn(user.orgId, req.params.id);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof MayInKhongTimThay) return reply.code(404).send({ error: 'KHONG_TIM_THAY' });
      throw err;
    }
  });
}
