// SPDX-License-Identifier: AGPL-3.0-or-later

/** Gemini embedContent — one request per text (API embeds a single content). */
export async function embedGemini(
  baseUrl: string,
  apiKey: string,
  model: string,
  texts: string[],
): Promise<number[][]> {
  const out: number[][] = [];
  for (const text of texts) {
    const url = `${baseUrl.replace(/\/$/, '')}/v1beta/models/${model}:embedContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text }] } }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`embed gemini http ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    out.push(data.embedding?.values ?? []);
  }
  return out;
}
