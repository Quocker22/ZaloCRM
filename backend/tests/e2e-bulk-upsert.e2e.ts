/**
 * e2e-bulk-upsert.e2e.ts — REAL end-to-end test of POST /api/public/contacts/bulk
 * against a REAL Postgres (no prisma mocks). Proves idempotency + fill-empty at the
 * database level, exactly as the Google Maps scraper will exercise it.
 *
 * Run with a real DB:
 *   DATABASE_URL=postgresql://zcrm:zcrm@localhost:5433/zcrm \
 *     npx vitest run --config vitest.e2e.config.ts
 *
 * This file is NOT part of the default unit suite (it needs a live DB). See
 * vitest.e2e.config.ts which includes only *.e2e.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { prisma } from '../src/shared/database/prisma-client.js';
import { publicApiRoutes } from '../src/modules/api/public-api-routes.js';

const API_KEY = 'e2e-test-key';
let app: FastifyInstance;
let orgId: string;

async function post(payload: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/public/contacts/bulk',
    headers: { 'x-api-key': API_KEY },
    payload,
  });
}

beforeAll(async () => {
  // Seed a real org + the public_api_key setting the auth middleware looks up.
  const org = await prisma.organization.create({ data: { name: 'E2E Org' } });
  orgId = org.id;
  await prisma.appSetting.create({
    data: { orgId, settingKey: 'public_api_key', valuePlain: API_KEY },
  });

  app = Fastify();
  await app.register(publicApiRoutes);
  await app.ready();
});

afterAll(async () => {
  // Clean up everything this test created so reruns stay deterministic.
  await prisma.contact.deleteMany({ where: { orgId } });
  await prisma.appSetting.deleteMany({ where: { orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await app.close();
  await prisma.$disconnect();
});

describe('E2E bulk upsert against real Postgres', () => {
  it('creates a contact, then is idempotent on the same externalKey (no duplicate row)', async () => {
    const contact = {
      externalKey: 'gmaps:e2e-place-1',
      fullName: 'Nhà hàng E2E',
      phone: '0901234567',
      province: 'TP.HCM',
      district: 'Quận 1',
    };

    const res1 = await post({ source: 'gmaps', contacts: [contact] });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().summary).toMatchObject({ created: 1, updated: 0, error: 0 });

    // Second push, same externalKey → must UPDATE, not create a duplicate.
    const res2 = await post({ source: 'gmaps', contacts: [contact] });
    expect(res2.json().summary).toMatchObject({ created: 0, updated: 1, error: 0 });

    // DB truth: exactly ONE contact for this externalKey.
    const rows = await prisma.contact.findMany({
      where: { orgId, externalKey: 'gmaps:e2e-place-1' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].fullName).toBe('Nhà hàng E2E');
    expect(rows[0].phoneNormalized).toBe('84901234567'); // normalized at the DB
    expect(rows[0].consentStatus).toBe('implicit');
    expect(rows[0].source).toBe('gmaps');
  });

  it('never overwrites a sale-edited field on re-import', async () => {
    const ext = 'gmaps:e2e-place-2';
    // Initial import with no name.
    await post({ contacts: [{ externalKey: ext, phone: '0907654321' }] });
    // Sale edits the name by hand.
    await prisma.contact.updateMany({
      where: { orgId, externalKey: ext },
      data: { fullName: 'TÊN SALE SỬA' },
    });
    // Re-import tries to set a different name.
    await post({ contacts: [{ externalKey: ext, fullName: 'TÊN TỪ IMPORT', phone: '0907654321' }] });

    const row = await prisma.contact.findFirst({ where: { orgId, externalKey: ext } });
    expect(row?.fullName).toBe('TÊN SALE SỬA'); // sale edit preserved, NOT overwritten
  });

  it('processes a mixed batch: created + duplicate + error, in one request', async () => {
    const res = await post({
      contacts: [
        { externalKey: 'gmaps:e2e-place-3', fullName: 'Mới', phone: '0912345678' },
        { externalKey: 'gmaps:e2e-place-1', fullName: 'Trùng' }, // already exists from test 1
        { phone: '0900000000' }, // missing externalKey → error
      ],
    });
    const body = res.json();
    expect(body.summary).toMatchObject({ created: 1, updated: 1, error: 1 });
    expect(body.results[2]).toMatchObject({ index: 2, status: 'error', reason: 'missing_external_key' });
  });
});
