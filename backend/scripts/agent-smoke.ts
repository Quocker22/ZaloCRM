// SPDX-License-Identifier: AGPL-3.0-or-later
// Chạy thử luồng nhân viên tag bot với LLM THẬT + Odoo THẬT.
//
// VÌ SAO CẦN: toàn bộ 209 test hiện tại đều MOCK LLM. Chúng chứng minh vòng lặp,
// tool, và idempotency chạy đúng — nhưng KHÔNG trả lời được câu hỏi quan trọng nhất:
//   "Model THẬT có tự quyết định gọi tool đúng thứ tự không?"
// Đây là rủi ro lớn nhất còn lại, và nó rẻ để kiểm chứng.
//
// KHÔNG gửi Zalo. Chỉ đọc/ghi Odoo local. Đơn tạo ra là DRAFT và được xoá sau khi chạy.
//
// Chạy:
//   LLM_BASE=https://... LLM_KEY=... LLM_MODEL=... \
//   ODOO_URL=http://localhost:8069 ODOO_DB=nelia_prod \
//   ODOO_USERNAME=admin ODOO_PASSWORD=admin \
//     npx tsx scripts/agent-smoke.ts "@bot tra giá đèn COB"

import { OdooClient } from '../src/modules/ai/odoo/client.js';
import { chayLenhNhanVien, type ToolCallLog } from '../src/modules/ai/agent/staff-agent.js';
import { generateWithAnthropicTools } from '../src/modules/ai/providers/anthropic.js';
import { generateWithOpenaiCompatTools } from '../src/modules/ai/providers/openai-compat.js';
import type { ToolAwareGenerate } from '../src/modules/ai/agent/types.js';

const LLM_BASE = process.env.LLM_BASE ?? 'http://localhost:11434/v1';
const LLM_KEY = process.env.LLM_KEY ?? process.env.OPENAI_API_KEY ?? 'sk-noop';
const LLM_MODEL = process.env.LLM_MODEL ?? 'gpt-4o-mini';
/** 'anthropic' dùng API Messages; mọi giá trị khác dùng OpenAI-compatible (9router). */
const LLM_KIND = process.env.LLM_KIND ?? 'openai';

const lenh = process.argv[2] ?? '@bot tra giá đèn COB';

function thieuCauHinh(): string | null {
  for (const k of ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_PASSWORD']) {
    if (!process.env[k]) return k;
  }
  return null;
}

const thieu = thieuCauHinh();
if (thieu) {
  console.error(`Thiếu biến môi trường: ${thieu}`);
  process.exit(1);
}

const odoo = new OdooClient({
  url: process.env.ODOO_URL!,
  db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!,
  password: process.env.ODOO_PASSWORD!,
});

/** Chọn adapter theo LLM_KIND. Cả hai đều khớp interface ToolAwareGenerate. */
const generate: ToolAwareGenerate = async (a) => {
  if (LLM_KIND === 'anthropic') {
    return generateWithAnthropicTools({
      baseUrl: LLM_BASE, apiKey: LLM_KEY, model: LLM_MODEL, ...a,
    });
  }
  return generateWithOpenaiCompatTools({
    url: `${LLM_BASE}/chat/completions`,
    apiKey: LLM_KEY, model: LLM_MODEL, ...a,
  });
};

const donDaTao: number[] = [];

async function main() {
  console.log('┌────────────────────────────────────────────────────────────┐');
  console.log('│  CHẠY THỬ AGENT — LLM THẬT + ODOO THẬT                     │');
  console.log('└────────────────────────────────────────────────────────────┘');
  console.log(`LLM   : ${LLM_MODEL} (${LLM_KIND}) @ ${LLM_BASE}`);
  console.log(`Odoo  : ${process.env.ODOO_DB} @ ${process.env.ODOO_URL}`);
  console.log(`Lệnh  : "${lenh}"\n`);

  await odoo.authenticate();
  console.log('✓ Đăng nhập Odoo OK\n');

  const batDau = Date.now();
  const log: ToolCallLog[] = [];

  const kq = await chayLenhNhanVien(
    {
      odoo,
      generate,
      ghiNhanChuyenSale: async (yc) => {
        console.log(`  → CHUYỂN SALE: ${yc.lyDo} — ${yc.tomTat}`);
      },
      ghiLog: (l) => {
        log.push(l);
        const dau = l.thanhCong ? '✓' : '✗';
        console.log(`  ${dau} [vòng ${l.iteration}] ${l.toolName}(${JSON.stringify(l.input)})  ${l.durationMs}ms`);
        const tomTat = l.output.length > 200 ? `${l.output.slice(0, 200)}…` : l.output;
        console.log(`      ${tomTat.replace(/\n/g, '\n      ')}`);
      },
    },
    {
      bizName: 'LEDNELIA - shop đèn LED & phụ kiện điện',
      conversationId: `smoke-${Date.now()}`,
      seq: 0,
      message: { content: lenh, isSelf: true },
    },
  );

  const giay = ((Date.now() - batDau) / 1000).toFixed(1);
  console.log(`\n${'─'.repeat(62)}`);

  if (kq.trangThai === 'khong_phai_lenh') {
    console.log('KẾT QUẢ: không nhận diện là lệnh (thiếu tag @bot hoặc động từ lệnh)');
    return;
  }

  if (kq.trangThai === 'chua_hoan_tat') {
    console.log(`KẾT QUẢ: CHƯA HOÀN TẤT — ${kq.lyDo}`);
  } else {
    console.log('KẾT QUẢ: XONG\n');
    console.log(`Bot trả lời:\n  ${kq.traLoi.replace(/\n/g, '\n  ')}`);
  }

  console.log(`\n${'─'.repeat(62)}`);
  console.log(`Thời gian     : ${giay}s`);
  console.log(`Số tool đã gọi: ${log.length}`);
  console.log(`Thứ tự gọi    : ${log.map((l) => l.toolName).join(' → ') || '(không gọi tool nào)'}`);
  const loi = log.filter((l) => !l.thanhCong).length;
  console.log(`Tool lỗi      : ${loi}/${log.length}`);

  const u = kq.usage;
  console.log(`\nToken:`);
  console.log(`  input (giá đầy đủ) : ${u.inputTokens}`);
  console.log(`  output             : ${u.outputTokens}`);
  console.log(`  đọc từ cache       : ${u.cacheReadTokens}${u.cacheReadTokens > 0 ? '  ← cache CÓ chạy' : ''}`);
  console.log(`  ghi vào cache      : ${u.cacheWriteTokens}`);

  // Ghi nhận đơn đã tạo để dọn.
  const don = await odoo.searchRead<{ id: number; name: string }>(
    'sale.order',
    [['client_order_ref', 'like', 'zalo:smoke-%']],
    ['id', 'name'],
  );
  donDaTao.push(...don.map((d) => d.id));
  if (don.length > 0) {
    console.log(`\nĐơn nháp đã tạo: ${don.map((d) => d.name).join(', ')}`);
  }
}

async function don() {
  if (donDaTao.length === 0) return;
  for (const id of donDaTao) {
    try {
      await odoo.execute('sale.order', 'unlink', [[id]]);
    } catch { /* bỏ qua */ }
  }
  console.log(`Đã dọn ${donDaTao.length} đơn thử nghiệm.`);
}

main()
  .then(don)
  .catch(async (err) => {
    console.error('\n✗ LỖI:', err instanceof Error ? err.message : err);
    await don();
    process.exit(1);
  });
