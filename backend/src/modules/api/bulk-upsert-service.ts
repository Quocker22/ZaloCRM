// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * bulk-upsert-service.ts — the per-contact upsert logic for POST /contacts/bulk,
 * extracted from the route handler so it is unit-testable and handles BOTH unique
 * constraints the contacts table enforces:
 *   1. (org_id, external_key)            — our import idempotency key
 *   2. (org_id, phone_normalized) alive  — ZaloCRM's own dedup-by-phone index
 *      (migration 20260529100000_wave_1_5_contact_dedup)
 *
 * A naive create-then-catch-P2002 that only re-fetches by external_key loses data
 * when two DIFFERENT businesses share a phone (a shared hotline — common in VN).
 * This service resolves the collision by phone too, never dropping the item.
 */
import type { PreparedContact } from './bulk-upsert-helpers.js';

// Minimal structural type for the bits of the Prisma client we use — keeps this
// module decoupled from the full PrismaClient and trivially mockable in tests.
export interface ContactDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<any | null>;
  create(args: { data: Record<string, unknown> }): Promise<any>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<any>;
}
export interface DbLike {
  contact: ContactDelegate;
}

export type UpsertStatus = 'created' | 'updated' | 'duplicate_phone';
export interface UpsertResult {
  status: UpsertStatus;
  contactId: string;
  externalKey: string;
}

/** Fields safe to fill on an existing row: only those currently null/undefined. */
function fillEmpty(existing: any, fillData: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fillData)) {
    if (existing[k] === null || existing[k] === undefined) data[k] = v;
  }
  return data;
}

function isP2002(e: any): boolean {
  return e?.code === 'P2002';
}

/**
 * True when the unique violation is on the phone index, not the external_key index.
 * `meta.target` is unreliable across Prisma driver adapters (the pg adapter omits it),
 * so we read it when present and fall back to the human-readable message, which
 * consistently names the constraint fields. Either signal mentioning "phone" wins.
 */
function isPhoneCollision(e: any): boolean {
  const target = e?.meta?.target;
  const targetStr = Array.isArray(target) ? target.join(',') : String(target ?? '');
  if (targetStr.includes('phone')) return true;
  const msg = String(e?.message ?? '');
  // e.g. "Unique constraint failed on the fields: (`org_id`,`phone_normalized`)"
  return /phone_normalized/i.test(msg) || /contacts_org_phone/i.test(msg);
}

/**
 * Upsert one prepared contact. Resolution order:
 *  - find by external_key → update (fill-empty) if present.
 *  - else create. On P2002:
 *      • external_key race → re-fetch by external_key, update.
 *      • phone collision   → find the alive row sharing the phone, annotate it with
 *        metadata.phoneSharedWith (so a human can reconcile branches sharing a
 *        hotline), and report 'duplicate_phone'. No row is created, no data lost.
 */
export async function upsertOneContact(
  db: DbLike,
  orgId: string,
  prepared: Extract<PreparedContact, { ok: true }>,
): Promise<UpsertResult> {
  const existing = await db.contact.findFirst({ where: { orgId, externalKey: prepared.externalKey } });
  if (existing) {
    const data = fillEmpty(existing, prepared.fillData);
    if (Object.keys(data).length > 0) await db.contact.update({ where: { id: existing.id }, data });
    return { status: 'updated', contactId: existing.id, externalKey: prepared.externalKey };
  }

  try {
    const c = await db.contact.create({ data: prepared.createData });
    return { status: 'created', contactId: c.id, externalKey: prepared.externalKey };
  } catch (e: any) {
    if (!isP2002(e)) throw e;

    if (isPhoneCollision(e) && prepared.phoneNormalized) {
      // Different business, shared phone. Attach this externalKey to the existing
      // alive row sharing the phone so the link is auditable; do not create a dup.
      const sharer = await db.contact.findFirst({
        where: { orgId, phoneNormalized: prepared.phoneNormalized },
      });
      if (sharer) {
        const prevMeta = (sharer.metadata as Record<string, unknown>) ?? {};
        const sharedWith = new Set<string>(
          Array.isArray((prevMeta as any).phoneSharedWith) ? (prevMeta as any).phoneSharedWith : [],
        );
        sharedWith.add(prepared.externalKey);
        await db.contact.update({
          where: { id: sharer.id },
          data: { metadata: { ...prevMeta, phoneSharedWith: Array.from(sharedWith) } },
        });
        return { status: 'duplicate_phone', contactId: sharer.id, externalKey: prepared.externalKey };
      }
      // Sharer vanished (raced away) — fall through to external_key re-fetch.
    }

    // external_key race (or phone sharer gone): the row now exists under our key.
    const now = await db.contact.findFirst({ where: { orgId, externalKey: prepared.externalKey } });
    if (!now) throw e;
    const data = fillEmpty(now, prepared.fillData);
    if (Object.keys(data).length > 0) await db.contact.update({ where: { id: now.id }, data });
    return { status: 'updated', contactId: now.id, externalKey: prepared.externalKey };
  }
}
