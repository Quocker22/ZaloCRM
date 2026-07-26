// SPDX-License-Identifier: AGPL-3.0-or-later
// Harness eval + AUTO-GRADE: chạy nhiều kịch bản đa lượt qua pipeline RAG thật, rồi
// tự chấm lỗi mỗi câu trả lời (rỗng, lặp, bịa giá, quá dài, sai persona). Xuất:
//  - <out>.jsonl  : từng lượt (kịch bản, intent, reply, flags)
//  - stdout       : tóm tắt + danh sách lượt CÓ LỖI (để review, không phải đọc tay hết)
//
// Chạy: DATABASE_URL=... LLM_BASE=... LLM_MODEL=... npx tsx scripts/kb-eval-grade.ts <orgId> <scenarios.json> <out.jsonl>
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { prisma } from '../src/shared/database/prisma-client.js';
import { generateEmbedding } from '../src/modules/ai/knowledge/embedding.js';
import { searchKnowledge, type IngestDeps } from '../src/modules/ai/knowledge/knowledge-service.js';
import { buildRagSystemPrompt, parseRagReply, decideAction, type HistoryTurn } from '../src/modules/ai/knowledge/rag-reply.js';
import { classifyIntent, intentHint, INTERNAL_REPLY, COMPLAINT_REPLY } from '../src/modules/ai/knowledge/intent.js';

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
  } finally {
    clearTimeout(t);
  }
}

async function llm(system: string, prompt: string): Promise<string> {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await llmOnce(system, prompt);
      if (r.trim()) return r;
    } catch {
      /* timeout / network — retry once */
    }
  }
  return '';
}

interface Scenario { name: string; goal: string; turns: string[] }

// Auto-grader: trả danh sách flag lỗi cho 1 câu trả lời.
function grade(reply: string, chunks: string[], history: HistoryTurn[], intent: string): string[] {
  const flags: string[] = [];
  const r = reply.trim();
  if (!r) { flags.push('EMPTY'); return flags; }
  // 1. Bịa giá: reply có số tiền mà KB chunk VÀ lịch sử đều KHÔNG chứa số đó.
  // (giá đã báo ở history là hợp lệ — khách hỏi lại, bot nhắc lại).
  const priceMatches = r.match(/\b\d{1,3}([.,]\d{3})+\s*(đ|d|vnđ)?\b/gi) ?? [];
  const known = (chunks.join(' ') + ' ' + history.map((h) => h.content).join(' ')).replace(/[.,]/g, '');
  for (const p of priceMatches) {
    const num = p.replace(/[^\d]/g, '');
    if (num.length >= 4 && !known.includes(num)) flags.push(`FABRICATED_PRICE:${p.trim()}`);
  }
  // 2. Lặp: reply gần trùng TOÀN BỘ câu shop gần nhất (>=70% token chung), không chỉ mở đầu.
  const lastShop = [...history].reverse().find((h) => h.role === 'shop')?.content ?? '';
  if (lastShop && r.length > 20) {
    const setA = new Set(r.toLowerCase().split(/\s+/));
    const setB = new Set(lastShop.toLowerCase().split(/\s+/));
    const inter = [...setA].filter((w) => setB.has(w)).length;
    const overlap = inter / Math.max(setA.size, setB.size);
    if (overlap >= 0.7) flags.push('REPEAT_PREV');
  }
  // 3. Quá dài (chat Zalo nên ngắn): > 400 ký tự.
  if (r.length > 400) flags.push('TOO_LONG');
  // 4. Sai persona: lộ là AI/bot/model.
  if (/\b(tôi là (một )?(trợ lý|mô hình|ai|chatbot)|language model|gpt|gemini|claude)\b/i.test(r)) flags.push('BROKE_PERSONA');
  // 5. Lạc đề bán hàng khi intent=internal mà vẫn giới thiệu sản phẩm (chỉ check nếu không phải template).
  return flags;
}

async function main() {
  const [orgId, file, out] = process.argv.slice(2);
  if (!orgId || !file || !out) { console.error('usage: tsx kb-eval-grade.ts <orgId> <scenarios.json> <out.jsonl>'); process.exit(1); }
  const scenarios = JSON.parse(readFileSync(file, 'utf8')) as Scenario[];
  const deps: IngestDeps = { prisma: prisma as unknown as IngestDeps['prisma'], embed: generateEmbedding };
  const embedCfg = { provider: 'local', model: 'bge-m3', baseUrl: OLLAMA };
  writeFileSync(out, '');

  let total = 0, flagged = 0;
  const flagCounts: Record<string, number> = {};
  const problems: string[] = [];

  for (const sc of scenarios) {
    const history: HistoryTurn[] = [];
    for (const turn of sc.turns) {
      total++;
      const intent = classifyIntent(turn);
      let reply: string, chunks: string[] = [];
      if (intent === 'internal') reply = INTERNAL_REPLY;
      else if (intent === 'complaint') reply = COMPLAINT_REPLY;
      else {
        const hits = await searchKnowledge(deps, orgId, turn, 6, embedCfg);
        chunks = hits.map((h) => h.content);
        const system = buildRagSystemPrompt(BIZ, chunks, history, intentHint(intent));
        reply = parseRagReply(await llm(system, turn)).reply;
      }
      const flags = intent === 'internal' || intent === 'complaint' ? [] : grade(reply, chunks, history, intent);
      flags.forEach((f) => { const k = f.split(':')[0]; flagCounts[k] = (flagCounts[k] ?? 0) + 1; });
      if (flags.length) { flagged++; problems.push(`[${sc.name}] KHÁCH: ${turn}\n   BOT(${intent}): ${reply.slice(0, 160)}\n   ⚠ ${flags.join(', ')}`); }
      appendFileSync(out, JSON.stringify({ scenario: sc.name, goal: sc.goal, turn, intent, reply, flags }) + '\n');
      history.push({ role: 'customer', content: turn });
      history.push({ role: 'shop', content: reply });
    }
  }

  console.log(`\n===== TỔNG: ${total} lượt | ${flagged} lượt có lỗi (${((flagged/total)*100).toFixed(0)}%) =====`);
  console.log('Lỗi theo loại:', JSON.stringify(flagCounts));
  if (problems.length) {
    console.log(`\n----- ${problems.length} LƯỢT CÓ LỖI (để review) -----`);
    problems.slice(0, 40).forEach((p) => console.log('\n' + p));
    if (problems.length > 40) console.log(`\n... và ${problems.length - 40} lượt nữa (xem ${out})`);
  } else {
    console.log('\n✅ Không phát hiện lỗi tự động nào.');
  }
  console.log(`\nChi tiết: ${out}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
