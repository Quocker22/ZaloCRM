// SPDX-License-Identifier: AGPL-3.0-or-later
// Harness mô phỏng hội thoại ĐA LƯỢT qua pipeline RAG THẬT + FLOW CHỐT ĐƠN (order/checkout).
// Khác kb-eval-grade: harness này khi bot trả checkout_stage sẽ tự resolveOrder + tính tổng
// + mô phỏng gửi QR/tiền mặt, để transcript phản ánh ĐÚNG cái khách thấy (gồm ĐƠN + TỔNG + QR).
// KHÔNG gửi Zalo. Dùng review flow chốt đơn.
//   DATABASE_URL=... LLM_BASE=... LLM_MODEL=... npx tsx scripts/kb-eval-checkout.ts <orgId> <scen.json> <out.jsonl>
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { prisma } from '../src/shared/database/prisma-client.js';
import { generateEmbedding } from '../src/modules/ai/knowledge/embedding.js';
import { searchKnowledge, type IngestDeps } from '../src/modules/ai/knowledge/knowledge-service.js';
import { buildRagSystemPrompt, parseRagReply, type HistoryTurn } from '../src/modules/ai/knowledge/rag-reply.js';
import { classifyIntent, intentHint, INTERNAL_REPLY, COMPLAINT_REPLY } from '../src/modules/ai/knowledge/intent.js';
import { resolveOrder, formatOrderLines, formatVnd, type KbLookup } from '../src/modules/ai/knowledge/order-checkout.js';

const OLLAMA = 'http://localhost:11434/v1';
const LLM_BASE = process.env.LLM_BASE ?? 'http://localhost:11434/v1';
const LLM_MODEL = process.env.LLM_MODEL ?? 'gemma2:9b';
const BIZ = 'LEDNELIA - shop đèn LED & phụ kiện điện';

async function llmOnce(system: string, prompt: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 45000);
  try {
    const res = await fetch(`${LLM_BASE}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], stream: false }),
      signal: ctl.signal,
    });
    const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return d.choices?.[0]?.message?.content ?? '';
  } finally { clearTimeout(t); }
}
async function llm(s: string, p: string): Promise<string> {
  for (let i = 0; i < 2; i++) { try { const r = await llmOnce(s, p); if (r.trim()) return r; } catch { /* retry */ } }
  return '';
}

interface Scenario { name: string; goal: string; turns: string[] }

async function main() {
  const [orgId, file, out] = process.argv.slice(2);
  if (!orgId || !file || !out) { console.error('usage: tsx kb-eval-checkout.ts <orgId> <scen.json> <out.jsonl>'); process.exit(1); }
  const scenarios = JSON.parse(readFileSync(file, 'utf8')) as Scenario[];
  const deps: IngestDeps = { prisma: prisma as unknown as IngestDeps['prisma'], embed: generateEmbedding };
  const embedCfg = { provider: 'local', model: 'bge-m3', baseUrl: OLLAMA };
  const lookup: KbLookup = (q) => searchKnowledge(deps, orgId, q, 6, embedCfg);
  writeFileSync(out, '');
  let total = 0, checkoutTurns = 0, qrSent = 0, deferredMissingPrice = 0;

  for (const sc of scenarios) {
    const history: HistoryTurn[] = [];
    for (const turn of sc.turns) {
      total++;
      const intent = classifyIntent(turn);
      let reply: string;
      let checkoutInfo = '';
      if (intent === 'internal') reply = INTERNAL_REPLY;
      else if (intent === 'complaint') reply = COMPLAINT_REPLY;
      else {
        const hits = await searchKnowledge(deps, orgId, turn, 6, embedCfg);
        const system = buildRagSystemPrompt(BIZ, hits.map((h) => h.content), history, intentHint(intent));
        const rep = parseRagReply(await llm(system, turn));
        reply = rep.reply;
        // Mô phỏng flow chốt đơn để transcript có ĐƠN+TỔNG+QR như khách thấy.
        if (rep.checkoutStage && rep.order && rep.order.length) {
          checkoutTurns++;
          const resolved = await resolveOrder(rep.order, lookup);
          if (rep.checkoutStage === 'confirm') {
            if (!resolved.missingPrice) checkoutInfo = `\n[ĐƠN]\n${formatOrderLines(resolved)}`;
            else { checkoutInfo = `\n[ĐƠN có món THIẾU GIÁ → báo sale]\n${formatOrderLines(resolved)}`; deferredMissingPrice++; }
          } else if (rep.checkoutStage === 'pay_qr') {
            if (resolved.missingPrice || resolved.total <= 0) { checkoutInfo = '\n[→ FALLBACK báo sale: thiếu giá]'; deferredMissingPrice++; }
            else { checkoutInfo = `\n[→ GỬI QR ${formatVnd(resolved.total)} + báo sale]\n${formatOrderLines(resolved)}`; qrSent++; }
          } else if (rep.checkoutStage === 'pay_cash') {
            checkoutInfo = resolved.missingPrice ? '\n[→ FALLBACK báo sale: thiếu giá]' : `\n[→ TIỀN MẶT, báo sale]\n${formatOrderLines(resolved)}`;
          }
          reply = `${reply}${checkoutInfo}`;
        }
      }
      appendFileSync(out, JSON.stringify({ scenario: sc.name, goal: sc.goal, turn, intent, reply }) + '\n');
      history.push({ role: 'customer', content: turn });
      history.push({ role: 'shop', content: reply });
    }
  }
  console.log(`\n===== ${total} lượt | ${checkoutTurns} lượt CHỐT ĐƠN | ${qrSent} gửi QR | ${deferredMissingPrice} chuyển sale (thiếu giá) =====`);
  console.log(`Chi tiết: ${out}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
