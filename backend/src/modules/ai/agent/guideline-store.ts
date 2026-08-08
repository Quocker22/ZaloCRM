// SPDX-License-Identifier: AGPL-3.0-or-later
// Nạp guideline từ DB cho một phiên luồng khách.
//
// Trả null trong MỌI trường hợp không dùng được (DB lỗi, bảng chưa migrate,
// kho rỗng chưa seed) — caller coi null là engine OFF, prompt tĩnh chạy như
// hôm nay. Guideline engine không bao giờ được là lý do bot câm.

import { locTheoPhien } from './guideline-prompt.js';
import type { GuidelineNap } from './customer-agent.js';

/** Phần Prisma client mà store cần — hẹp để test được bằng fake. */
export interface PrismaGuideline {
  aiGuideline: {
    findMany: (args: {
      where: { orgId: string; vai: string; enabled: boolean };
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
    }) => Promise<Array<{
      ten: string;
      condition: string;
      action: string;
      mucDo: string;
      tools: string[];
      stage: string | null;
      uuTien: number;
      yeuCau: string | null;
    }>>;
  };
}

export async function napGuidelineKhach(
  prisma: PrismaGuideline,
  orgId: string,
  tuChotDon: boolean,
): Promise<GuidelineNap[] | null> {
  try {
    const hang = await prisma.aiGuideline.findMany({
      where: { orgId, vai: 'khach', enabled: true },
      // Thứ tự ổn định (uuTien, ten) — cùng lý do sort tool: giữ prompt cache.
      orderBy: [{ uuTien: 'asc' }, { ten: 'asc' }],
    });
    if (hang.length === 0) return null;
    return locTheoPhien(hang, tuChotDon);
  } catch {
    return null;
  }
}
