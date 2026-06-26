import { describe, it, expect, vi } from 'vitest';
import { upsertOneContact } from '../src/modules/api/bulk-upsert-service.js';
import { prepareContact } from '../src/modules/api/bulk-upsert-helpers.js';

// A tiny in-memory contact store that emulates the two unique constraints the real
// DB enforces: (org, externalKey) and the partial (org, phoneNormalized WHERE alive).
function makeFakeDb() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    contact: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          rows.find((r) => {
            if (where.externalKey !== undefined) return r.orgId === where.orgId && r.externalKey === where.externalKey;
            if (where.phoneNormalized !== undefined) return r.orgId === where.orgId && r.phoneNormalized === where.phoneNormalized && r.mergedInto == null;
            return false;
          }) ?? null
        );
      }),
      create: vi.fn(async ({ data }: any) => {
        // enforce unique (org, externalKey). Mirror the REAL Prisma pg-adapter shape:
        // message names the fields, meta.target is absent (only modelName present).
        if (rows.some((r) => r.orgId === data.orgId && r.externalKey === data.externalKey)) {
          throw { code: 'P2002', meta: { modelName: 'Contact' }, message: 'Unique constraint failed on the fields: (`org_id`,`external_key`)' };
        }
        // enforce partial unique (org, phoneNormalized) for alive rows
        if (data.phoneNormalized && rows.some((r) => r.orgId === data.orgId && r.phoneNormalized === data.phoneNormalized && r.mergedInto == null)) {
          throw { code: 'P2002', meta: { modelName: 'Contact' }, message: 'Unique constraint failed on the fields: (`org_id`,`phone_normalized`)' };
        }
        const row = { id: 'c' + ++seq, mergedInto: null, ...data };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
  };
}

const ctx = { orgId: 'org-1' };

describe('upsertOneContact', () => {
  it('creates a brand-new contact', async () => {
    const db = makeFakeDb();
    const p = prepareContact({ externalKey: 'gmaps:1', phone: '0901234567', fullName: 'A' }, ctx);
    if (!p.ok) throw new Error('prep');
    const r = await upsertOneContact(db as any, 'org-1', p);
    expect(r.status).toBe('created');
    expect(db.rows).toHaveLength(1);
  });

  it('is idempotent on the same externalKey (update, fill-empty only)', async () => {
    const db = makeFakeDb();
    const p1 = prepareContact({ externalKey: 'gmaps:1', phone: '0901234567' }, ctx);
    const p2 = prepareContact({ externalKey: 'gmaps:1', phone: '0901234567', fullName: 'Import' }, ctx);
    if (!p1.ok || !p2.ok) throw new Error('prep');
    await upsertOneContact(db as any, 'org-1', p1);
    // sale edits the name
    db.rows[0].fullName = 'Sale Name';
    const r = await upsertOneContact(db as any, 'org-1', p2);
    expect(r.status).toBe('updated');
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].fullName).toBe('Sale Name'); // never overwritten
  });

  it('handles a PHONE collision (different externalKey, shared hotline) without data loss', async () => {
    const db = makeFakeDb();
    // Shared MOBILE hotline (fixed-line 028… numbers don't normalize, so use mobile).
    const a = prepareContact({ externalKey: 'gmaps:branchA', phone: '0909001122', fullName: 'Chi nhánh A' }, ctx);
    const b = prepareContact({ externalKey: 'gmaps:branchB', phone: '0909001122', fullName: 'Chi nhánh B' }, ctx);
    if (!a.ok || !b.ok) throw new Error('prep');

    const ra = await upsertOneContact(db as any, 'org-1', a);
    expect(ra.status).toBe('created');

    // Branch B shares the hotline → phone unique violation. Must NOT error/lose data.
    const rb = await upsertOneContact(db as any, 'org-1', b);
    expect(rb.status).toBe('duplicate_phone');
    expect(rb.contactId).toBe(ra.contactId); // links to the existing row sharing the phone
    // The existing row is annotated so a human can review the shared hotline.
    const shared = (db.rows[0].metadata as any)?.phoneSharedWith;
    expect(Array.isArray(shared) ? shared : []).toContain('gmaps:branchB');
    // No second row created (the phone index forbids it).
    expect(db.rows).toHaveLength(1);
  });

  it('handles a concurrent externalKey race (P2002 on external_key) as update', async () => {
    const db = makeFakeDb();
    const p = prepareContact({ externalKey: 'gmaps:race', phone: '0905550000', fullName: 'Race' }, ctx);
    if (!p.ok) throw new Error('prep');
    // Simulate: findFirst says "not there" but create loses the race.
    db.contact.findFirst.mockResolvedValueOnce(null);
    // Pre-insert the row so create throws P2002 on external_key.
    db.rows.push({ id: 'pre', orgId: 'org-1', externalKey: 'gmaps:race', phoneNormalized: '84905550000', mergedInto: null, fullName: null });
    const r = await upsertOneContact(db as any, 'org-1', p);
    expect(r.status).toBe('updated');
    expect(r.contactId).toBe('pre');
  });
});
