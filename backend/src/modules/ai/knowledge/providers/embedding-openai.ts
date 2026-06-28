// SPDX-License-Identifier: AGPL-3.0-or-later

/** OpenAI-compatible /embeddings (Ollama local, OpenAI, Qwen). Batch input. */
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
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`embed openai-compat http ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  return (data.data ?? []).map((d) => d.embedding);
}
