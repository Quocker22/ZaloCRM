// SPDX-License-Identifier: AGPL-3.0-or-later
// Đổi nhà cung cấp LLM cho bot — sửa DB, KHÔNG cần sửa code hay deploy.
//
// VÌ SAO KHÔNG CẦN CODE MỚI: DeepSeek dùng đúng định dạng OpenAI, và
// `duongDanChat()` đã ghép `${baseUrl}/v1/chat/completions` cho provider
// 'openai'. Chỉ cần trỏ base URL sang api.deepseek.com là xong.
//
// Cả luồng RAG cũ (ai-service.ts) lẫn agent mới (noi-zalo.ts) đều đọc cùng
// nguồn này, nên đổi một lần là cả hai đổi theo.
//
// CHẠY:
//   npx tsx --env-file-if-exists=.env scripts/doi-llm.ts xem
//   npx tsx --env-file-if-exists=.env scripts/doi-llm.ts deepseek <api-key>
//   npx tsx --env-file-if-exists=.env scripts/doi-llm.ts 9router          (quay lại)
import { prisma } from '../src/shared/database/prisma-client.js';

const CAU_HINH = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    ghiChu: 'cache prompt tự động → rẻ hơn ~50 lần cho phần lặp lại',
  },
  '9router': {
    baseUrl: 'https://ai.byhung.com',
    model: 'ag/gemini-3-flash',
    ghiChu: 'miễn phí nhưng chậm 11-12s mỗi lượt (đo 2026-08-04)',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-3.1-flash-lite',
    ghiChu: 'nhanh (0,8s) nhưng KHÔNG cache — đắt gấp 4 DeepSeek',
  },
} as const;

type Ten = keyof typeof CAU_HINH;

async function xem(): Promise<void> {
  const cfg = await prisma.aiConfig.findFirst();
  if (!cfg) {
    console.log('Chưa có AiConfig nào.');
    return;
  }
  const url = await prisma.appSetting.findFirst({
    where: { orgId: cfg.orgId, settingKey: `ai_${cfg.provider}_base_url` },
  });
  const key = await prisma.appSetting.findFirst({
    where: { orgId: cfg.orgId, settingKey: `ai_${cfg.provider}_api_key` },
  });
  console.log('  provider :', cfg.provider);
  console.log('  model    :', cfg.model);
  console.log('  base URL :', url?.valuePlain ?? '(chưa đặt)');
  console.log('  api key  :', key?.valuePlain ? `${key.valuePlain.slice(0, 8)}… (${key.valuePlain.length} ký tự)` : '(mã hoá hoặc trống)');
  console.log('  auto-reply:', cfg.autoReplyEnabled ? 'BẬT' : 'tắt');
}

async function doi(ten: Ten, apiKey?: string): Promise<void> {
  const c = CAU_HINH[ten];
  const cfg = await prisma.aiConfig.findFirst();
  if (!cfg) throw new Error('Chưa có AiConfig — không biết đổi cho tổ chức nào.');

  // Provider giữ nguyên 'openai': DeepSeek/9router đều là OpenAI-compat, và
  // đổi provider sẽ làm mất key đã lưu của provider cũ.
  await prisma.aiConfig.update({ where: { orgId: cfg.orgId }, data: { model: c.model } });

  const datSetting = async (khoa: string, giaTri: string) => {
    const cu = await prisma.appSetting.findFirst({ where: { orgId: cfg.orgId, settingKey: khoa } });
    if (cu) await prisma.appSetting.update({ where: { id: cu.id }, data: { valuePlain: giaTri } });
    else await prisma.appSetting.create({ data: { orgId: cfg.orgId, settingKey: khoa, valuePlain: giaTri } });
  };

  await datSetting(`ai_${cfg.provider}_base_url`, c.baseUrl);
  if (apiKey) await datSetting(`ai_${cfg.provider}_api_key`, apiKey);

  console.log(`  ĐÃ ĐỔI sang ${ten}`);
  console.log(`    base URL : ${c.baseUrl}`);
  console.log(`    model    : ${c.model}`);
  console.log(`    ${c.ghiChu}`);
  if (!apiKey) console.log('    (giữ nguyên api key cũ)');
  console.log('\n  Đổi có hiệu lực NGAY — không cần deploy lại.');
}

const [lenh, key] = process.argv.slice(2);
try {
  if (!lenh || lenh === 'xem') await xem();
  else if (lenh in CAU_HINH) await doi(lenh as Ten, key);
  else {
    console.log('Dùng: doi-llm.ts xem | deepseek <key> | 9router | gemini <key>');
    process.exit(1);
  }
} catch (err) {
  console.error('LỖI:', err instanceof Error ? err.message : err);
  process.exit(1);
}
process.exit(0);
