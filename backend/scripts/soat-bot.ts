// SPDX-License-Identifier: AGPL-3.0-or-later
// SOÁT BOT — chỉ số vận hành đọc từ DB, chạy tay khi muốn xem (07/08/2026).
//
// "Theo dõi flash-lite vài ngày" mà không có mắt thì chỉ còn cách chờ anh gửi
// từng đoạn chat. Script này gom tool_call_logs + ai_suggestions thành con số:
// bot xử bao nhiêu lượt, gọi tool gì nhiều, tool nào hay lỗi, bao nhiêu ca
// nghi model rẻ đuối (gọi 1 tool nhiều lần / lượt dài bất thường).
//
// CHẠY (mặc định 7 ngày; đổi số ngày qua đối số):
//   ODOO... không cần — chỉ đọc Postgres của CRM.
//   npx tsx scripts/soat-bot.ts        # 7 ngày
//   npx tsx scripts/soat-bot.ts 1      # hôm nay
//
// Học Chatwoot bot_metrics_builder: 4 số cốt lõi (lượt, tool, lỗi, handoff).
// Handoff/chửi/rỗng nằm trong LOG container, không DB — cuối script in lệnh
// grep để lấy nốt.
import { prisma } from '../src/shared/database/prisma-client.js';

const soNgay = Number(process.argv[2] ?? 7);
const tu = new Date(Date.now() - soNgay * 86_400_000);

async function main() {
  const [suggestions, toolLogs] = await Promise.all([
    prisma.aiSuggestion.groupBy({
      by: ['type'],
      where: { createdAt: { gte: tu } },
      _count: true,
    }),
    prisma.toolCallLog.findMany({
      where: { createdAt: { gte: tu } },
      select: { toolName: true, vai: true, thanhCong: true, durationMs: true, conversationId: true },
    }),
  ]);

  console.log(`\n══════ SOÁT BOT — ${soNgay} ngày qua ══════\n`);

  // 1) Lượt bot trả lời (agent vs RAG cũ)
  const agent = suggestions.find((s) => s.type === 'auto_reply_agent')?._count ?? 0;
  const rag = suggestions.find((s) => s.type === 'auto_reply_rag')?._count ?? 0;
  const tong = agent + rag;
  console.log('── Lượt bot trả lời ──');
  console.log(`  Agent mới : ${agent}${tong ? ` (${Math.round(agent / tong * 100)}%)` : ''}`);
  console.log(`  RAG cũ    : ${rag}${tong ? ` (${Math.round(rag / tong * 100)}%)` : ''}`);
  console.log(`  Tổng      : ${tong}`);

  // 2) Tool được gọi + tỉ lệ lỗi
  console.log('\n── Tool gọi (nhiều → ít) ──');
  const theoTool = new Map<string, { tong: number; loi: number; ms: number }>();
  for (const t of toolLogs) {
    const m = theoTool.get(t.toolName) ?? { tong: 0, loi: 0, ms: 0 };
    m.tong++; if (!t.thanhCong) m.loi++; m.ms += t.durationMs;
    theoTool.set(t.toolName, m);
  }
  const sapTool = [...theoTool.entries()].sort((a, b) => b[1].tong - a[1].tong);
  for (const [ten, m] of sapTool) {
    const loi = m.loi > 0 ? ` · LỖI ${m.loi} (${Math.round(m.loi / m.tong * 100)}%)` : '';
    console.log(`  ${ten.padEnd(20)} ${String(m.tong).padStart(4)} lần · ${Math.round(m.ms / m.tong)}ms tb${loi}`);
  }
  const tongTool = toolLogs.length;
  const tongLoi = toolLogs.filter((t) => !t.thanhCong).length;
  console.log(`  ─ Tổng: ${tongTool} lần gọi, ${tongLoi} lỗi (${tongTool ? Math.round(tongLoi / tongTool * 100) : 0}%)`);

  // 3) Nghi model rẻ ĐUỐI: hội thoại gọi CÙNG 1 tool ≥3 lần (lặp vô ích),
  //    hoặc lượt gọi ≥6 tool (loanh quanh). Đây là tín hiệu để cân nhắc nâng model.
  console.log('\n── Nghi model đuối (lặp tool / loanh quanh) ──');
  const theoConv = new Map<string, Map<string, number>>();
  for (const t of toolLogs) {
    if (!t.conversationId) continue;
    const c = theoConv.get(t.conversationId) ?? new Map();
    c.set(t.toolName, (c.get(t.toolName) ?? 0) + 1);
    theoConv.set(t.conversationId, c);
  }
  let soLap = 0, soLoanhQuanh = 0;
  for (const [, c] of theoConv) {
    const tongGoi = [...c.values()].reduce((a, b) => a + b, 0);
    const lapNhieu = [...c.values()].some((n) => n >= 3);
    if (lapNhieu) soLap++;
    if (tongGoi >= 6) soLoanhQuanh++;
  }
  console.log(`  Hội thoại gọi 1 tool ≥3 lần : ${soLap}`);
  console.log(`  Hội thoại gọi ≥6 tool       : ${soLoanhQuanh}`);
  console.log(`  → Hai số này cao = model hay lú, cân nhắc nâng gemini-2.5-flash cho lượt chính.`);

  // 4) Handoff/chửi/rỗng nằm trong LOG — chỉ dẫn lấy nốt.
  console.log('\n── Lấy nốt từ LOG container (không có trong DB) ──');
  console.log('  ssh root@100.107.48.28 \\');
  console.log(`    "docker logs --since ${soNgay * 24}h zalo-crm-app 2>&1 | grep -c 'ĐÃ báo nhân viên'"       # số lần handoff`);
  console.log(`    "docker logs --since ${soNgay * 24}h zalo-crm-app 2>&1 | grep -c 'khách bực/chửi'"         # số lần khách chửi`);
  console.log(`    "docker logs --since ${soNgay * 24}h zalo-crm-app 2>&1 | grep -c 'trả câu rỗng'"           # số lần model trả rỗng`);
  console.log(`    "docker logs --since ${soNgay * 24}h zalo-crm-app 2>&1 | grep -c 'có tin mới hơn'"         # số lần gộp tin\n`);

  await prisma.$disconnect();
}

void main();
