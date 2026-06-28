// SPDX-License-Identifier: AGPL-3.0-or-later
import { cosine } from './cosine.js';

export interface ScoredChunk {
  id: string;
  content: string;
  embedding: number[];
  embedDim: number;
}
export interface Hit {
  chunkId: string;
  content: string;
  score: number;
}

/**
 * Rank chunks by cosine to queryVec, descending. Chunks whose dimension differs
 * from the query (provider mismatch) score 0 via cosine and are dropped.
 */
export function rankChunks(queryVec: number[], chunks: ScoredChunk[], topK: number): Hit[] {
  const hits: Hit[] = [];
  for (const c of chunks) {
    const score = cosine(queryVec, c.embedding);
    if (score <= 0) continue;
    hits.push({ chunkId: c.id, content: c.content, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, Math.max(1, topK));
}
