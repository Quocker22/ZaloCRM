import { normalizeVnPhone } from '../../shared/phone/normalize-vn-phone.js';

export interface BulkContactInput {
  externalKey?: string; fullName?: string; phone?: string;
  province?: string; district?: string; addressLine?: string;
  source?: string; tags?: string[]; metadata?: Record<string, unknown>;
}
export type PreparedContact =
  | { ok: true; externalKey: string; phoneNormalized: string | null;
      createData: Record<string, unknown>; fillData: Record<string, unknown> }
  | { ok: false; reason: 'missing_external_key' };

const FILLABLE = ['fullName', 'phone', 'province', 'district', 'addressLine'] as const;

export function prepareContact(
  input: BulkContactInput,
  ctx: { orgId: string; importBatchId?: string },
): PreparedContact {
  if (!input.externalKey) return { ok: false, reason: 'missing_external_key' };

  const norm = input.phone ? normalizeVnPhone(input.phone) : null;
  const phoneNormalized = norm?.valid && norm.phoneE164 ? norm.phoneE164.replace(/^\+/, '') : null;

  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  if (input.phone && !phoneNormalized) metadata.noPhone = true;

  const createData: Record<string, unknown> = {
    orgId: ctx.orgId,
    externalKey: input.externalKey,
    fullName: input.fullName ?? null,
    phone: input.phone ?? null,
    phoneNormalized,
    province: input.province ?? null,
    district: input.district ?? null,
    addressLine: input.addressLine ?? null,
    source: input.source ?? 'gmaps',
    tags: input.tags ?? [],
    metadata,
    consentStatus: 'implicit',
    importBatchId: ctx.importBatchId ?? null,
  };

  const fillData: Record<string, unknown> = {};
  for (const k of FILLABLE) {
    const v = (createData as any)[k];
    if (k === 'phone' && !phoneNormalized) continue;       // don't fill phone from invalid
    if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) fillData[k] = v;
  }
  if (phoneNormalized) fillData.phoneNormalized = phoneNormalized;

  return { ok: true, externalKey: input.externalKey, phoneNormalized, createData, fillData };
}
