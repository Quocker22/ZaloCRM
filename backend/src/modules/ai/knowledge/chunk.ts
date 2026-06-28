// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Split text into chunks of at most maxRunes runes, breaking on blank-line
 * paragraph boundaries. Accumulates paragraphs until adding the next would
 * exceed maxRunes. Never returns empty chunks.
 */
export function chunkText(text: string, maxRunes = 500): string[] {
  const paras = text.replace(/\r\n/g, '\n').split('\n\n');
  const chunks: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur.trim().length > 0) chunks.push(cur.trim());
    cur = '';
  };
  for (const raw of paras) {
    const p = raw.trim();
    if (!p) continue;
    if (cur.length > 0 && [...cur].length + [...p].length > maxRunes) flush();
    cur = cur.length > 0 ? `${cur}\n\n${p}` : p;
  }
  flush();
  return chunks;
}
