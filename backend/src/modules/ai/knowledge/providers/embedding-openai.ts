// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OpenAI-compatible /embeddings (OpenRouter, OpenAI, Qwen, Ollama local).
 *
 * TIMEOUT BẮT BUỘC (2026-08-05): trước đây `fetch` ở đây KHÔNG có hạn giờ.
 * Một `await` không hạn giờ nằm trên đường đi của tin khách là bom hẹn giờ —
 * host không phản hồi (khác với từ chối) là cả lượt agent treo vĩnh viễn: log
 * dừng ở "BẮT ĐẦU xử lý", không lỗi, không XONG, khách chờ mãi không ai biết.
 *
 * 20s vì đây là embedding một câu hỏi ngắn (~1s thực tế); quá 20s nghĩa là
 * hỏng chứ không phải chậm.
 */
const HAN_GIO_MS = Number(process.env.EMBED_TIMEOUT_MS) || 20_000;

export async function embedOpenAICompat(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  texts: string[],
): Promise<number[][]> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(HAN_GIO_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`embed openai-compat http ${res.status}: ${body}`);
  }
  // Đọc bằng text() rồi tự cắt: OpenRouter chèn khoảng trắng TRƯỚC dấu `{`,
  // `res.json()` của Node ném ngay (cùng bug đã trị ở openai-compat.ts).
  const raw = await res.text();
  const dau = raw.search(/[{[]/);
  if (dau < 0) throw new Error(`embed: phản hồi không phải JSON: ${JSON.stringify(raw.slice(0, 200))}`);
  const data = JSON.parse(raw.slice(dau)) as { data?: Array<{ embedding: number[] }> };
  return (data.data ?? []).map((d) => d.embedding);
}
