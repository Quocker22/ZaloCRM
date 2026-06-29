// SPDX-License-Identifier: AGPL-3.0-or-later
// Harness eval hội thoại đa lượt qua pipeline RAG THẬT (search KB + history + prompt + LLM).
// KHÔNG gửi Zalo. Dùng để review chất lượng bot + tinh chỉnh prompt/KB.
//
// Chạy: DATABASE_URL=... npx tsx scripts/kb-eval.ts <orgId> <scenarioFile.json>
// scenarioFile: [{ "name": "...", "goal": "...", "turns": ["câu khách 1", "câu 2", ...] }]
import { readFileSync } from 'node:fs';
import { prisma } from '../src/shared/database/prisma-client.js';
import { generateEmbedding } from '../src/modules/ai/knowledge/embedding.js';
import { searchKnowledge, type IngestDeps } from '../src/modules/ai/knowledge/knowledge-service.js';
import { buildRagSystemPrompt, parseRagReply, decideAction, type HistoryTurn } from '../src/modules/ai/knowledge/rag-reply.js';
import { classifyIntent, intentHint, INTERNAL_REPLY, COMPLAINT_REPLY } from '../src/modules/ai/knowledge/intent.js';

const OLLAMA = 'http://localhost:11434/v1';      // embedding luôn local
const LLM_BASE = process.env.LLM_BASE ?? 'http://localhost:11434/v1'; // LLM: Ollama hoặc 9router
const LLM_MODEL = process.env.LLM_MODEL ?? 'gemma2:9b';
const BIZ = 'LEDNELIA - shop đèn LED & phụ kiện điện';

async function llm(system: string, prompt: string): Promise<string> {
  // KHÔNG gửi response_format: gemini qua 9router trả rỗng khi có param này.
  // parseRagReply đã xử lý ```json fence / prose lẫn JSON.
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], stream: false }),
  });
  const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return d.choices?.[0]?.message?.content ?? '';
}

interface Scenario { name: string; goal: string; turns: string[] }

async function runScenario(deps: IngestDeps, orgId: string, sc: Scenario) {
  const embedCfg = { provider: 'local', model: 'bge-m3', baseUrl: OLLAMA };
  const history: HistoryTurn[] = [];
  console.log(`\n${'='.repeat(70)}`);
  console.log(`KỊCH BẢN: ${sc.name}`);
  console.log(`MỤC ĐÍCH: ${sc.goal}`);
  console.log('='.repeat(70));
  for (const turn of sc.turns) {
    console.log(`\n  KHÁCH: ${turn}`);
    const intent = classifyIntent(turn);
    let reply: string;
    let tag: string;
    if (intent === 'internal') {
      reply = INTERNAL_REPLY;
      tag = `GỬI/internal`;
    } else if (intent === 'complaint') {
      reply = COMPLAINT_REPLY;
      tag = `HANDOFF/complaint`;
    } else {
      const hits = await searchKnowledge(deps, orgId, turn, 6, embedCfg);
      const system = buildRagSystemPrompt(BIZ, hits.map((h) => h.content), history, intentHint(intent));
      const rep = parseRagReply(await llm(system, turn));
      const action = decideAction(rep, { autoReplyEnabled: true, threshold: 0.6 });
      reply = rep.reply;
      tag = `${action === 'send' ? 'GỬI' : 'HANDOFF'}/${intent}${rep.needsHuman ? ' needs_human' : ''} conf=${rep.confidence}`;
    }
    console.log(`  BOT [${tag}]: ${reply}`);
    history.push({ role: 'customer', content: turn });
    history.push({ role: 'shop', content: reply });
  }
}

async function main() {
  const orgId = process.argv[2];
  const file = process.argv[3];
  if (!orgId || !file) { console.error('usage: tsx scripts/kb-eval.ts <orgId> <scenario.json>'); process.exit(1); }
  const scenarios = JSON.parse(readFileSync(file, 'utf8')) as Scenario[];
  const deps: IngestDeps = { prisma: prisma as unknown as IngestDeps['prisma'], embed: generateEmbedding };
  console.log(`Model LLM: ${LLM_MODEL} | ${scenarios.length} kịch bản`);
  for (const sc of scenarios) await runScenario(deps, orgId, sc);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
