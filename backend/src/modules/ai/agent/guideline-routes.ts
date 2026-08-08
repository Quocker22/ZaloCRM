// SPDX-License-Identifier: AGPL-3.0-or-later
// Route CRUD guideline — vận hành kho rule mà không cần deploy.
//
// Không có DELETE: tắt rule = PATCH enabled=false. `ghiChu` ghi lại vì sao rule
// tồn tại (bug nào, commit nào) — xoá bản ghi là xoá tri thức, nên không cho.
//
// Validate NÔNG có chủ ý (enum + bắt buộc), như triết lý registry.ts: nghiệp vụ
// "condition có match được không" là việc của matcher eval, không phải của route.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireGrant } from '../../rbac/rbac-middleware.js';
import { prisma } from '../../../shared/database/prisma-client.js';
import { CAC_STAGE } from './guideline-matcher.js';

const CAC_VAI = ['khach', 'nhanvien'];
const CAC_MUC_DO = ['bat_buoc', 'thuong'];
const CAC_YEU_CAU = ['tu_chot_don', 'khong_tu_chot_don'];

interface ThanGuideline {
  ten?: unknown;
  vai?: unknown;
  condition?: unknown;
  action?: unknown;
  mucDo?: unknown;
  tools?: unknown;
  stage?: unknown;
  uuTien?: unknown;
  yeuCau?: unknown;
  enabled?: unknown;
  ghiChu?: unknown;
}

/** Trả thông điệp lỗi đầu tiên, hoặc null nếu hợp lệ. `taoMoi` đòi đủ field bắt buộc. */
export function kiemTra(b: ThanGuideline, taoMoi: boolean): string | null {
  if (taoMoi) {
    for (const f of ['ten', 'vai', 'condition', 'action'] as const) {
      if (typeof b[f] !== 'string' || !(b[f] as string).trim()) return `thiếu '${f}'`;
    }
  }
  if (b.vai !== undefined && !CAC_VAI.includes(b.vai as string)) return `'vai' phải là ${CAC_VAI.join('|')}`;
  if (b.mucDo !== undefined && !CAC_MUC_DO.includes(b.mucDo as string)) return `'mucDo' phải là ${CAC_MUC_DO.join('|')}`;
  if (b.stage !== undefined && b.stage !== null && !CAC_STAGE.includes(b.stage as never)) {
    return `'stage' phải là ${CAC_STAGE.join('|')} hoặc null`;
  }
  if (b.yeuCau !== undefined && b.yeuCau !== null && !CAC_YEU_CAU.includes(b.yeuCau as string)) {
    return `'yeuCau' phải là ${CAC_YEU_CAU.join('|')} hoặc null`;
  }
  if (b.tools !== undefined && !(Array.isArray(b.tools) && b.tools.every((t) => typeof t === 'string'))) {
    return `'tools' phải là mảng chuỗi`;
  }
  if (b.uuTien !== undefined && !Number.isInteger(b.uuTien)) return `'uuTien' phải là số nguyên`;
  if (b.enabled !== undefined && typeof b.enabled !== 'boolean') return `'enabled' phải là boolean`;
  return null;
}

/** Chỉ giữ field cho phép sửa — orgId/id không bao giờ lấy từ body. */
export function locData(b: ThanGuideline) {
  const ra: Record<string, unknown> = {};
  for (const f of ['ten', 'vai', 'condition', 'action', 'mucDo', 'tools', 'stage', 'uuTien', 'yeuCau', 'enabled', 'ghiChu'] as const) {
    if (b[f] !== undefined) ra[f] = b[f];
  }
  return ra;
}

export function registerGuidelineRoutes(app: FastifyInstance) {
  app.get('/api/v1/ai/guidelines', async (request: FastifyRequest) => {
    const { vai } = request.query as { vai?: string };
    return prisma.aiGuideline.findMany({
      where: { orgId: request.user!.orgId, ...(vai ? { vai } : {}) },
      orderBy: [{ vai: 'asc' }, { uuTien: 'asc' }, { ten: 'asc' }],
    });
  });

  app.post(
    '/api/v1/ai/guidelines',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as ThanGuideline;
      const loi = kiemTra(body, true);
      if (loi) return reply.status(400).send({ error: loi });
      try {
        return await prisma.aiGuideline.create({
          data: { orgId: request.user!.orgId, ...(locData(body) as { ten: string; vai: string; condition: string; action: string }) },
        });
      } catch (err) {
        // P2002 = trùng (orgId, ten) — báo thẳng, đừng trả 500 mù.
        if ((err as { code?: string }).code === 'P2002') {
          return reply.status(409).send({ error: `guideline '${String(body.ten)}' đã tồn tại` });
        }
        throw err;
      }
    },
  );

  app.patch(
    '/api/v1/ai/guidelines/:id',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as ThanGuideline;
      const loi = kiemTra(body, false);
      if (loi) return reply.status(400).send({ error: loi });
      // updateMany + lọc orgId: không bao giờ sửa xuyên org, kể cả khi đoán được id.
      const kq = await prisma.aiGuideline.updateMany({
        where: { id, orgId: request.user!.orgId },
        data: locData(body),
      });
      if (kq.count === 0) return reply.status(404).send({ error: 'Không thấy guideline' });
      return prisma.aiGuideline.findUnique({ where: { id } });
    },
  );

  // Soát shadow mode: log matcher gần nhất, lọc được fallback để đo tỷ lệ lỗi.
  app.get('/api/v1/ai/guidelines/match-logs', async (request: FastifyRequest) => {
    const { limit, fallback } = request.query as { limit?: string; fallback?: string };
    return prisma.guidelineMatchLog.findMany({
      where: {
        orgId: request.user!.orgId,
        ...(fallback === '1' ? { fallback: true } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 50, 200),
    });
  });
}
