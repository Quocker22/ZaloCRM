// SPDX-License-Identifier: AGPL-3.0-or-later
// Eval matcher guideline với LLM THẬT trên bộ fixture ca bug thật.
//
// Đo đúng cái thiết kế yêu cầu (THIET-KE-GUIDELINE-ENGINE.md §6): trước khi
// bật shadow/on phải biết matcher đúng bao nhiêu % trên các ca đã từng nổ.
//
// Chuẩn chấm (khớp triết lý "nghi ngờ thì true" của matcher):
//   - ĐẬU khi: mọi slug trong `phaiMatch` đều được match, KHÔNG slug nào trong
//     `khongDuocMatch` bị match, và stage nằm trong `stageDung`.
//   - Match THỪA rule khác không bị trừ điểm — thừa chỉ dẫn rẻ hơn thiếu.
//   - fallback (JSON hỏng/timeout) tính là TRƯỢT — fallback nhiều nghĩa là
//     model/prompt matcher có vấn đề, phải biết trước khi bật.
//
// CHẠY:  LLM_BASE=... LLM_KEY=... LLM_MODEL=... npm run test:kichban
// (chỉ cần LLM — không cần Odoo/Postgres. Thiếu env thì skip cả file.)
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { matchGuidelines } from '../../src/modules/ai/agent/guideline-matcher.js';
import { locTheoPhien } from '../../src/modules/ai/agent/guideline-prompt.js';
import { generateWithOpenaiCompatTools } from '../../src/modules/ai/providers/openai-compat.js';
import { generateWithAnthropicTools } from '../../src/modules/ai/providers/anthropic.js';
import type { ToolAwareGenerate } from '../../src/modules/ai/agent/types.js';
import { SEED_GUIDELINE_KHACH } from '../../prisma/seeds/guideline-khach-data.js';

const { LLM_BASE, LLM_KEY, LLM_MODEL } = process.env;
const LLM_KIND = process.env.LLM_KIND ?? 'openai';
const duCauHinh = Boolean(LLM_KEY && LLM_MODEL && (LLM_KIND === 'anthropic' || LLM_BASE));

/** Ngưỡng đậu để cho phép bật shadow → on. Thiết kế §6 đặt 90%. */
const NGUONG_DAU = 0.9;

const generate: ToolAwareGenerate = (a) =>
  LLM_KIND === 'anthropic'
    ? generateWithAnthropicTools({ apiKey: LLM_KEY!, model: LLM_MODEL!, ...a })
    : generateWithOpenaiCompatTools({
        url: `${LLM_BASE}/chat/completions`, apiKey: LLM_KEY!, model: LLM_MODEL!, ...a,
      });

interface CaFixture {
  id: string;
  name: string;
  hoiThoai: Array<{ vai: 'khach' | 'shop'; noiDung: string }>;
  tinMoi: string;
  stageDung: string[];
  phaiMatch: string[];
  khongDuocMatch: string[];
}

const cas: CaFixture[] = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../eval-scenarios/guideline-matcher.json', import.meta.url)),
    'utf8',
  ),
);

// Fixture viết theo phiên "khách tự chốt đơn" (biến thể chot-mua-tu-len-don).
const guidelines = locTheoPhien(SEED_GUIDELINE_KHACH, true)
  .filter((g) => g.mucDo === 'thuong')
  .map((g) => ({ id: g.ten, condition: g.condition, stage: g.stage }));

describe.skipIf(!duCauHinh)('matcher trên fixture ca bug thật (LLM thật)', () => {
  it(`đậu ≥ ${NGUONG_DAU * 100}% — điều kiện để được bật shadow/on`, async () => {
    const loi: string[] = [];

    for (const ca of cas) {
      const kq = await matchGuidelines(
        { generate, guidelines, timeoutMs: 15_000 },
        { message: ca.tinMoi, history: ca.hoiThoai },
      );

      const matched = new Set(kq.matchedIds);
      const thieu = ca.phaiMatch.filter((t) => !matched.has(t));
      const thua = ca.khongDuocMatch.filter((t) => matched.has(t));
      const saiStage = !ca.stageDung.includes(kq.stage);

      if (kq.fallback || thieu.length > 0 || thua.length > 0 || saiStage) {
        loi.push(
          `${ca.id} ${ca.name}: ` +
            (kq.fallback ? 'FALLBACK; ' : '') +
            (thieu.length ? `thiếu [${thieu}]; ` : '') +
            (thua.length ? `match cấm [${thua}]; ` : '') +
            (saiStage ? `stage '${kq.stage}' ∉ [${ca.stageDung}]` : ''),
        );
      }
    }

    const tyLeDau = (cas.length - loi.length) / cas.length;
    const baoCao = [
      `Matcher eval ${new Date().toISOString()} — model ${LLM_MODEL}`,
      `Đậu ${cas.length - loi.length}/${cas.length} (${(tyLeDau * 100).toFixed(0)}%)`,
      ...loi.map((l) => `  ✗ ${l}`),
    ].join('\n');
    // Lưu lại như ket-qua-gan-nhat.txt của bộ kichban chính — soát diff giữa các model.
    writeFileSync(
      fileURLToPath(new URL('./ket-qua-matcher.txt', import.meta.url)),
      baoCao + '\n',
    );
    console.log(baoCao);

    expect(tyLeDau, baoCao).toBeGreaterThanOrEqual(NGUONG_DAU);
  });
});
