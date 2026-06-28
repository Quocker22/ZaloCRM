// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateEmbedding } from '../../../src/modules/ai/knowledge/embedding.js';

afterEach(() => vi.restoreAllMocks());

function mockFetchOnce(json: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => json,
  } as Response);
}

describe('generateEmbedding', () => {
  it('local (OpenAI-compat) parse data[].embedding', async () => {
    mockFetchOnce({ data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }] });
    const out = await generateEmbedding({ provider: 'local', model: 'bge-m3', baseUrl: 'http://x/v1', texts: ['a', 'b'] });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual([0.1, 0.2, 0.3]);
  });

  it('gemini parse embedding.values', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({ embedding: { values: [1, 2, 3] } }),
    } as Response);
    const out = await generateEmbedding({ provider: 'gemini', model: 'embedding-001', apiKey: 'k', baseUrl: 'http://g', texts: ['x'] });
    expect(out[0]).toEqual([1, 2, 3]);
  });

  it('provider lạ → throw', async () => {
    await expect(generateEmbedding({ provider: 'bogus', model: 'm', texts: ['a'] })).rejects.toThrow();
  });

  it('HTTP lỗi → throw', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, text: async () => 'err' } as Response);
    await expect(generateEmbedding({ provider: 'local', model: 'm', baseUrl: 'http://x/v1', texts: ['a'] })).rejects.toThrow();
  });
});
