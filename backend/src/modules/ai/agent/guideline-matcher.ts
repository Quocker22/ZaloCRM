// SPDX-License-Identifier: AGPL-3.0-or-later
// Bộ match guideline — trái tim của guideline engine (docs/THIET-KE-GUIDELINE-ENGINE.md).
//
// Một call LLM rẻ TRƯỚC vòng agent: đọc tin khách + danh sách condition, trả về
// giai đoạn hội thoại và rule nào đúng với lượt này. Chỉ rule match mới vào
// system prompt — prompt hiệu dụng không phình theo tổng số rule.
//
// Kiểu ARQ (Attentive Reasoning Queries): bắt model trả lời TỪNG rule true/false
// trong một JSON đủ khoá, thay vì "liệt kê vài cái liên quan" — ép đọc hết,
// không bỏ sót. Thiếu khoá nghĩa là model chưa đọc hết → không tin kết quả.
//
// AN TOÀN LÀ SỐ MỘT: mọi đường lỗi (JSON hỏng, thiếu khoá, stage lạ, timeout,
// provider ném) đều rơi về fallback = nạp TOÀN BỘ guideline — đúng hành vi
// prompt tĩnh hôm nay. Matcher chỉ có thể làm TỐT HƠN hiện trạng, không tệ hơn.

import type { ToolAwareGenerate } from './types.js';

/** 4 giai đoạn hội thoại bán lẻ. Chỉ dùng để sắp prompt + analytics, KHÔNG lọc cứng. */
export const CAC_STAGE = ['khai_thac', 'tu_van', 'chot_don', 'sau_ban'] as const;
export type Stage = (typeof CAC_STAGE)[number];

export interface GuidelineDeMatch {
  id: string;
  condition: string;
  stage?: string | null;
}

export interface KetQuaMatch {
  stage: Stage;
  matchedIds: string[];
  /** true = matcher lỗi/không tin được → caller nạp toàn bộ guideline. */
  fallback: boolean;
}

export interface MatchDeps {
  /** Provider sẵn có của luồng khách. Matcher gọi với tools=[] — chỉ phân loại. */
  generate: ToolAwareGenerate;
  guidelines: GuidelineDeMatch[];
  /** Quá hạn → fallback. Mặc định 3000ms — khách đang chờ trên điện thoại. */
  timeoutMs?: number;
}

export interface MatchInput {
  message: string;
  /** Lịch sử cũ → mới. Chỉ 4 lượt cuối được đưa vào matcher — đủ ngữ cảnh. */
  history: Array<{ vai: 'khach' | 'shop'; noiDung: string }>;
}

const TIMEOUT_MS_MAC_DINH = 3000;
/** Số lượt lịch sử đưa vào matcher. Nhiều hơn là nhiễu, ít hơn mất ngữ cảnh. */
const SO_LUOT_LICH_SU = 4;

function fallback(guidelines: GuidelineDeMatch[]): KetQuaMatch {
  return { stage: 'tu_van', matchedIds: guidelines.map((g) => g.id), fallback: true };
}

/** Dựng prompt ARQ. Chỉ đưa condition, KHÔNG đưa action — matcher không cần biết làm gì. */
export function dungPromptMatcher(
  guidelines: GuidelineDeMatch[],
  input: MatchInput,
): string {
  const lichSu = input.history.slice(-SO_LUOT_LICH_SU);
  const dongLichSu = lichSu.map(
    (h) => `${h.vai === 'khach' ? 'KHÁCH' : 'SHOP'}: ${h.noiDung}`,
  );
  return [
    'Bạn là bộ định tuyến cho trợ lý bán hàng. Đọc hội thoại rồi trả về JSON',
    'đúng schema, không giải thích, không markdown.',
    '',
    '[Hội thoại]',
    ...dongLichSu,
    `KHÁCH (tin mới nhất): ${input.message}`,
    '',
    '[Câu hỏi 1] Khách đang ở giai đoạn nào?',
    '- khai_thac: mới vào, hỏi chung, chưa rõ cần gì',
    '- tu_van: hỏi giá / thông số / so sánh / còn hàng của SP cụ thể',
    '- chot_don: đã nói mua, chốt số lượng, hỏi thanh toán/ship',
    '- sau_ban: hỏi về đơn đã đặt, khiếu nại, đổi trả',
    '',
    '[Câu hỏi 2] Với TỪNG rule dưới đây, điều kiện có ĐÚNG với tin MỚI NHẤT',
    'không? Xét tin mới nhất trong ngữ cảnh hội thoại. Nghi ngờ thì chọn true',
    '(thà thừa chỉ dẫn còn hơn thiếu). Trả lời ĐỦ mọi rule.',
    ...guidelines.map((g) => `${g.id}: ${g.condition}`),
    '',
    'Trả về đúng dạng:',
    `{"stage": "...", "matched": {${guidelines.map((g) => `"${g.id}": true|false`).join(', ')}}}`,
  ].join('\n');
}

/** Cắt JSON ra khỏi text model trả (chịu được ```fence, chữ thừa quanh JSON). */
function tachJson(text: string): unknown {
  const dau = text.indexOf('{');
  const cuoi = text.lastIndexOf('}');
  if (dau < 0 || cuoi <= dau) throw new Error('không thấy JSON');
  return JSON.parse(text.slice(dau, cuoi + 1));
}

export async function matchGuidelines(
  deps: MatchDeps,
  input: MatchInput,
): Promise<KetQuaMatch> {
  const { guidelines } = deps;
  if (guidelines.length === 0) return { stage: 'tu_van', matchedIds: [], fallback: false };

  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS_MAC_DINH;

  let text: string;
  let henGio: ReturnType<typeof setTimeout> | undefined;
  try {
    const turn = await Promise.race([
      deps.generate({
        system: '',
        messages: [{ role: 'user', content: dungPromptMatcher(guidelines, input) }],
        tools: [],
      }),
      new Promise<never>((_, reject) => {
        henGio = setTimeout(() => reject(new Error('matcher timeout')), timeoutMs);
      }),
    ]);
    text = turn.text;
  } catch {
    return fallback(guidelines);
  } finally {
    clearTimeout(henGio);
  }

  try {
    const raw = tachJson(text) as { stage?: unknown; matched?: unknown };

    if (!CAC_STAGE.includes(raw.stage as Stage)) throw new Error(`stage lạ: ${String(raw.stage)}`);

    const matched = raw.matched as Record<string, unknown>;
    if (typeof matched !== 'object' || matched === null) throw new Error('thiếu matched');
    // ARQ: model phải trả lời ĐỦ mọi rule. Thiếu khoá = chưa đọc hết = không tin.
    for (const g of guidelines) {
      if (typeof matched[g.id] !== 'boolean') throw new Error(`thiếu khoá ${g.id}`);
    }

    return {
      stage: raw.stage as Stage,
      matchedIds: guidelines.filter((g) => matched[g.id] === true).map((g) => g.id),
      fallback: false,
    };
  } catch {
    return fallback(guidelines);
  }
}
