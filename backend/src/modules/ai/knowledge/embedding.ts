// SPDX-License-Identifier: AGPL-3.0-or-later
import { embedOpenAICompat } from './providers/embedding-openai.js';
import { embedGemini } from './providers/embedding-gemini.js';

export interface EmbedOpts {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  texts: string[];
}

/** text → vector. Batch for ingest; search calls with a single-element array. */
export async function generateEmbedding(opts: EmbedOpts): Promise<number[][]> {
  const { provider, model, apiKey, baseUrl, texts } = opts;
  if (provider === 'local' || provider === 'openai' || provider === 'qwen') {
    if (!baseUrl) throw new Error('embedding: baseUrl required for openai-compat provider');
    return embedOpenAICompat(baseUrl, apiKey, model, texts);
  }
  if (provider === 'gemini') {
    if (!apiKey || !baseUrl) throw new Error('embedding: gemini requires apiKey + baseUrl');
    return embedGemini(baseUrl, apiKey, model, texts);
  }
  throw new Error(`embedding: unknown provider ${provider}`);
}
