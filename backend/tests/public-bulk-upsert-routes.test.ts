import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    appSetting: { findFirst: vi.fn().mockResolvedValue({ orgId: 'org-1' }) },
    contact: { findFirst: (...a: any[]) => findFirst(...a), create: (...a: any[]) => create(...a), update: (...a: any[]) => update(...a) },
  },
}));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { publicApiRoutes } from '../src/modules/api/public-api-routes.js';

async function build(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(publicApiRoutes);
  return app;
}

beforeEach(() => { findFirst.mockReset(); create.mockReset(); update.mockReset(); });

describe('POST /api/public/contacts/bulk', () => {
  it('creates a new contact when externalKey not seen', async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({ id: 'c-1' });
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/api/public/contacts/bulk',
      headers: { 'x-api-key': 'k' },
      payload: { source: 'gmaps', contacts: [{ externalKey: 'gmaps:abc', phone: '0901234567', fullName: 'A' }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary).toEqual({ created: 1, updated: 0, error: 1 - 1 });
    expect(body.results[0]).toMatchObject({ index: 0, status: 'created', contactId: 'c-1' });
    await app.close();
  });

  it('updates (fills empty) when externalKey already exists, never overwrites non-null', async () => {
    findFirst.mockResolvedValue({ id: 'c-9', fullName: 'Sale Edited', phone: null });
    update.mockResolvedValue({ id: 'c-9' });
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/api/public/contacts/bulk',
      headers: { 'x-api-key': 'k' },
      payload: { contacts: [{ externalKey: 'gmaps:abc', phone: '0901234567', fullName: 'Import Name' }] },
    });
    const body = res.json();
    expect(body.results[0]).toMatchObject({ index: 0, status: 'updated', contactId: 'c-9' });
    // fullName already set on existing → must NOT be in update payload
    const updateArg = update.mock.calls[0][0];
    expect(updateArg.data.fullName).toBeUndefined();
    // phone was null on existing → fillable
    expect(updateArg.data.phoneNormalized).toBe('84901234567');
    await app.close();
  });

  it('reports error for item missing externalKey', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/api/public/contacts/bulk',
      headers: { 'x-api-key': 'k' },
      payload: { contacts: [{ phone: '0901234567' }] },
    });
    const body = res.json();
    expect(body.results[0]).toMatchObject({ index: 0, status: 'error', reason: 'missing_external_key' });
    expect(body.summary.error).toBe(1);
    await app.close();
  });

  it('rejects a batch larger than 500', async () => {
    const app = await build();
    const contacts = Array.from({ length: 501 }, (_, i) => ({ externalKey: `gmaps:${i}` }));
    const res = await app.inject({
      method: 'POST', url: '/api/public/contacts/bulk',
      headers: { 'x-api-key': 'k' }, payload: { contacts },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
