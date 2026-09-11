// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * seed-print-agent-hn.ts — Seed máy in HN vào print_agents (Task 1, nhiều máy
 * in theo chi nhánh). HN KHÔNG được gián đoạn: dùng đúng token env hiện tại
 * (AI_MAY_IN_AGENT_TOKEN) — agent HN cũ (chưa đổi token) vẫn khớp qua tương
 * thích ở agent-ws.ts (Task 4), việc seed này chỉ đưa token đó vào bảng để
 * routing theo DB (chonMayIn, Task 2) nhìn thấy máy mặc định ngay từ đầu.
 *
 * Idempotent: upsert theo token — chạy lại nhiều lần không tạo trùng dòng.
 * warehouseIds=[2,4] (TT + KB về HN), laMacDinh=true — khớp Global Constraints
 * của plan-may-in-nhieu-chi-nhanh.md.
 *
 * Org: ưu tiên env AI_MAY_IN_ORG_ID (đã dùng ở tu-env.ts cho cùng tính năng);
 * thiếu thì tự tra org DUY NHẤT trong DB — nhiều hơn 1 org thì DỪNG, không đoán.
 *
 * Chạy:
 *   DATABASE_URL=... AI_MAY_IN_AGENT_TOKEN=... [AI_MAY_IN_ORG_ID=...] \
 *     npx tsx scripts/seed-print-agent-hn.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const WAREHOUSE_IDS_HN = [2, 4];

async function main() {
  const token = process.env.AI_MAY_IN_AGENT_TOKEN?.trim();
  if (!token) {
    console.warn('⚠ AI_MAY_IN_AGENT_TOKEN chưa đặt — bỏ qua seed máy in HN (không crash).');
    return;
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    let orgId = process.env.AI_MAY_IN_ORG_ID?.trim();
    if (!orgId) {
      const orgs = await prisma.organization.findMany({ select: { id: true }, take: 2 });
      if (orgs.length === 0) {
        console.warn('⚠ DB chưa có tổ chức nào — bỏ qua seed máy in HN.');
        return;
      }
      if (orgs.length > 1) {
        console.warn(
          '⚠ DB có nhiều hơn 1 tổ chức — không tự đoán org. Đặt env AI_MAY_IN_ORG_ID rồi chạy lại.',
        );
        return;
      }
      orgId = orgs[0].id;
    }

    const agent = await prisma.printAgent.upsert({
      where: { token },
      create: {
        orgId,
        ten: 'Máy HN',
        token,
        warehouseIds: WAREHOUSE_IDS_HN,
        laMacDinh: true,
      },
      update: {
        orgId,
        ten: 'Máy HN',
        warehouseIds: WAREHOUSE_IDS_HN,
        laMacDinh: true,
      },
    });
    console.log(`✅ print_agents: "${agent.ten}" (id=${agent.id}, org=${agent.orgId}, kho=${agent.warehouseIds}, mặc định=${agent.laMacDinh})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌ Lỗi seed máy in HN:', e);
  process.exit(1);
});
