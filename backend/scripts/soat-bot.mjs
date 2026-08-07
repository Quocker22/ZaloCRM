// SPDX-License-Identifier: AGPL-3.0-or-later
// SOÁT BOT (bản container) — chạy từ dist đã build: node scripts/soat-bot.mjs [số ngày]
// Bản .ts cùng thư mục là để chạy local (npx tsx). Hai bản cùng logic; .mjs
// import từ dist vì container KHÔNG có src. Xem soat-bot.ts để đọc giải thích.
import { prisma } from '../dist/shared/database/prisma-client.js';

const soNgay = Number(process.argv[2] ?? 7);
const tu = new Date(Date.now() - soNgay * 86_400_000);

const [suggestions, toolLogs] = await Promise.all([
  prisma.aiSuggestion.groupBy({ by: ['type'], where: { createdAt: { gte: tu } }, _count: true }),
  prisma.toolCallLog.findMany({
    where: { createdAt: { gte: tu } },
    select: { toolName: true, vai: true, thanhCong: true, durationMs: true, conversationId: true },
  }),
]);

console.log(`\n══════ SOÁT BOT — ${soNgay} ngày qua ══════\n`);

const agent = suggestions.find((s) => s.type === 'auto_reply_agent')?._count ?? 0;
const rag = suggestions.find((s) => s.type === 'auto_reply_rag')?._count ?? 0;
const tong = agent + rag;
console.log('── Lượt bot trả lời ──');
console.log(`  Agent mới : ${agent}${tong ? ` (${Math.round(agent / tong * 100)}%)` : ''}`);
console.log(`  RAG cũ    : ${rag}${tong ? ` (${Math.round(rag / tong * 100)}%)` : ''}`);
console.log(`  Tổng      : ${tong}`);

console.log('\n── Tool gọi (nhiều → ít) ──');
const theoTool = new Map();
for (const t of toolLogs) {
  const m = theoTool.get(t.toolName) ?? { tong: 0, loi: 0, ms: 0 };
  m.tong++; if (!t.thanhCong) m.loi++; m.ms += t.durationMs;
  theoTool.set(t.toolName, m);
}
for (const [ten, m] of [...theoTool.entries()].sort((a, b) => b[1].tong - a[1].tong)) {
  const loi = m.loi > 0 ? ` · LỖI ${m.loi} (${Math.round(m.loi / m.tong * 100)}%)` : '';
  console.log(`  ${ten.padEnd(20)} ${String(m.tong).padStart(4)} lần · ${Math.round(m.ms / m.tong)}ms tb${loi}`);
}
const tongLoi = toolLogs.filter((t) => !t.thanhCong).length;
console.log(`  ─ Tổng: ${toolLogs.length} lần gọi, ${tongLoi} lỗi (${toolLogs.length ? Math.round(tongLoi / toolLogs.length * 100) : 0}%)`);

console.log('\n── Nghi model đuối (lặp tool / loanh quanh) ──');
const theoConv = new Map();
for (const t of toolLogs) {
  if (!t.conversationId) continue;
  const c = theoConv.get(t.conversationId) ?? new Map();
  c.set(t.toolName, (c.get(t.toolName) ?? 0) + 1);
  theoConv.set(t.conversationId, c);
}
let soLap = 0, soLoanhQuanh = 0;
for (const [, c] of theoConv) {
  const tongGoi = [...c.values()].reduce((a, b) => a + b, 0);
  if ([...c.values()].some((n) => n >= 3)) soLap++;
  if (tongGoi >= 6) soLoanhQuanh++;
}
console.log(`  Hội thoại gọi 1 tool ≥3 lần : ${soLap}`);
console.log(`  Hội thoại gọi ≥6 tool       : ${soLoanhQuanh}`);
console.log('  → Hai số này cao = model hay lú, cân nhắc nâng gemini-2.5-flash cho lượt chính.');

console.log('\n── Lấy nốt từ LOG container (không có trong DB) ──');
console.log(`  docker logs --since ${soNgay * 24}h zalo-crm-app 2>&1 | grep -c 'ĐÃ báo nhân viên'   # handoff`);
console.log(`  docker logs --since ${soNgay * 24}h zalo-crm-app 2>&1 | grep -c 'khách bực/chửi'     # khách chửi`);
console.log(`  docker logs --since ${soNgay * 24}h zalo-crm-app 2>&1 | grep -c 'câu rỗng'           # model trả rỗng`);
console.log(`  docker logs --since ${soNgay * 24}h zalo-crm-app 2>&1 | grep -c 'có tin mới hơn'     # gộp tin\n`);

await prisma.$disconnect();
process.exit(0);
