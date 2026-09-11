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
//
// Guard: CHỈ admin/owner được ghi (POST/PUT/DELETE) — theo đúng khuôn
// agent-operator-routes.ts (mở RANH GIỚI BẢO MẬT: ai vào bảng này là cầm được
// token định tuyến job in thật của org). GET (list + khos) cho mọi user đã
// đăng nhập xem — không lộ gì nhạy cảm (token đã cắt đuôi).
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../../../config/index.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import {
  taoMayIn, danhSachMayIn, suaMayIn, xoaMayIn, danhSachKho, MayInKhongTimThay,
} from './print-agent-service.js';

function laAdmin(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * URL server để dán vào app print-agent-rs (cùng HTTP server Fastify, agent
 * nối WS namespace `/print-agent` — xem agent-ws.ts). Base lấy từ config.appUrl
 * (env APP_URL) — chính domain public backend đang chạy, KHÔNG phải hằng số
 * riêng cho máy in vì socket.io mount chung server với REST API.
 */
function layServerUrl(): string {
  return config.appUrl.replace(/\/+$/, '');
}

export async function registerPrintAgentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── Danh sách máy in (token chỉ hiện đuôi + trạng thái online) ──────────
  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user!;
    const mayIn = await danhSachMayIn(user.orgId);
    return reply.send({ mayIn });
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
