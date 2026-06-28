// SPDX-License-Identifier: AGPL-3.0-or-later

export interface RagReply {
  reply: string;
  confidence: number;
  needsHuman: boolean;
  reason: string;
}
export type Action = 'send' | 'handoff';

/** System prompt: role + KB chunks + JSON contract (incl. needs_human criteria). */
export function buildRagSystemPrompt(bizName: string, kbChunks: string[]): string {
  const docs = kbChunks.length ? kbChunks.map((c) => `- ${c}`).join('\n') : '(không có tài liệu liên quan)';
  return [
    `Bạn là trợ lý tư vấn của ${bizName}. Trả lời khách bằng tiếng Việt, ngắn gọn, thân thiện,`,
    'CHỈ dựa trên TÀI LIỆU dưới đây. Nếu không chắc, đừng bịa.',
    '',
    '=== TÀI LIỆU ===',
    docs,
    '',
    '=== ĐỊNH DẠNG TRẢ LỜI ===',
    'CHỈ trả về một object JSON, không kèm văn bản nào khác, theo schema:',
    '{"reply": string, "confidence": number (0..1), "needs_human": boolean, "reason": string}',
    'Đặt needs_human=true khi: khách hỏi GIÁ/HỢP ĐỒNG cụ thể, KHIẾU NẠI, câu NGOÀI tài liệu,',
    'hoặc khách XIN GẶP NGƯỜI. confidence là mức bạn chắc câu trả lời đúng và đủ.',
  ].join('\n');
}

/** Extract the first {...} block and parse. On any failure, default to a safe handoff. */
export function parseRagReply(raw: string): RagReply {
  let s = raw.trim();
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    return {
      reply: typeof o.reply === 'string' ? o.reply : '',
      confidence: typeof o.confidence === 'number' ? o.confidence : 0,
      needsHuman: o.needs_human === true,
      reason: typeof o.reason === 'string' ? o.reason : '',
    };
  } catch {
    return { reply: '', confidence: 0, needsHuman: true, reason: 'parse-failed' };
  }
}

/** Decision lives in code, never in the LLM. Send only when confident AND auto enabled. */
export function decideAction(rep: RagReply, opts: { autoReplyEnabled: boolean; threshold: number }): Action {
  if (opts.autoReplyEnabled && !rep.needsHuman && rep.confidence >= opts.threshold) return 'send';
  return 'handoff';
}
