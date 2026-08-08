// SPDX-License-Identifier: AGPL-3.0-or-later
// Seed guideline luồng khách vào bảng ai_guidelines.
// Idempotent theo (orgId, ten): đã có thì CẬP NHẬT nội dung (upsert) — chạy lại
// an toàn, và khi sửa data file thì chạy lại là DB khớp.
//
// Chạy:  npx tsx prisma/seeds/seed-guidelines.ts [orgId]
//   - Không truyền orgId → dùng org đầu tiên trong DB.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { SEED_GUIDELINE_KHACH } from './guideline-khach-data.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error('❌ DATABASE_URL chưa set'); process.exit(1); }
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const orgId = process.argv[2] ?? (await prisma.organization.findFirst())?.id;
  if (!orgId) { console.error('❌ Không có org nào trong DB'); process.exit(1); }

  let tao = 0;
  let capNhat = 0;
  for (const g of SEED_GUIDELINE_KHACH) {
    const data = {
      vai: g.vai,
      condition: g.condition,
      action: g.action,
      mucDo: g.mucDo,
      tools: g.tools,
      stage: g.stage,
      uuTien: g.uuTien,
      yeuCau: g.yeuCau,
      ghiChu: g.ghiChu,
    };
    const cu = await prisma.aiGuideline.findUnique({
      where: { orgId_ten: { orgId, ten: g.ten } },
    });
    await prisma.aiGuideline.upsert({
      where: { orgId_ten: { orgId, ten: g.ten } },
      create: { orgId, ten: g.ten, ...data },
      update: data, // KHÔNG đụng `enabled` — người vận hành tắt rule nào thì giữ nguyên
    });
    if (cu) capNhat += 1; else tao += 1;
  }
  console.log(`✅ Guideline khách cho org ${orgId}: tạo ${tao}, cập nhật ${capNhat}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
