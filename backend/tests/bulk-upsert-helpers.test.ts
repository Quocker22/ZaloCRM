import { describe, it, expect } from 'vitest';
import { prepareContact } from '../src/modules/api/bulk-upsert-helpers.js';

describe('prepareContact', () => {
  it('rejects input without externalKey', () => {
    const r = prepareContact({ phone: '0901234567' }, { orgId: 'org-1' });
    expect(r).toEqual({ ok: false, reason: 'missing_external_key' });
  });

  it('normalizes a valid VN phone to 84xxx', () => {
    const r = prepareContact({ externalKey: 'gmaps:abc', phone: '0901234567' }, { orgId: 'org-1' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.phoneNormalized).toBe('84901234567');
    expect(r.createData.phoneNormalized).toBe('84901234567');
    expect(r.createData.consentStatus).toBe('implicit');
    expect(r.createData.externalKey).toBe('gmaps:abc');
    expect(r.createData.orgId).toBe('org-1');
  });

  it('keeps contact but null phone when phone invalid', () => {
    const r = prepareContact({ externalKey: 'gmaps:abc', phone: 'not-a-phone' }, { orgId: 'org-1' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.phoneNormalized).toBeNull();
    expect(r.createData.phone).toBe('not-a-phone');     // raw kept
    expect(r.createData.phoneNormalized).toBeNull();
    expect(r.createData.metadata).toMatchObject({ noPhone: true });
    expect('phone' in r.fillData).toBe(false);          // don't fill phone from invalid
  });

  it('passes through province/district/tags and importBatchId', () => {
    const r = prepareContact(
      { externalKey: 'gmaps:abc', fullName: 'NH ABC', province: 'TP.HCM', district: 'Q1', tags: ['nha_hang'] },
      { orgId: 'org-1', importBatchId: 'batch-9' },
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.createData.fullName).toBe('NH ABC');
    expect(r.createData.province).toBe('TP.HCM');
    expect(r.createData.importBatchId).toBe('batch-9');
    expect(r.createData.tags).toEqual(['nha_hang']);
    expect(r.fillData.fullName).toBe('NH ABC');          // fillable
  });

  it('preserves caller metadata and merges noPhone flag', () => {
    const r = prepareContact(
      { externalKey: 'gmaps:abc', phone: 'bad', metadata: { placeId: 'ChIJ', rating: 4.5 } },
      { orgId: 'org-1' },
    );
    if (!r.ok) throw new Error('expected ok');
    // caller metadata kept...
    expect(r.createData.metadata).toMatchObject({ placeId: 'ChIJ', rating: 4.5 });
    // ...and noPhone added because the phone was present but invalid
    expect((r.createData.metadata as any).noPhone).toBe(true);
  });

  it('does not set noPhone when phone is simply absent', () => {
    const r = prepareContact({ externalKey: 'gmaps:abc' }, { orgId: 'org-1' });
    if (!r.ok) throw new Error('expected ok');
    expect((r.createData.metadata as any).noPhone).toBeUndefined();
  });

  it('defaults source to gmaps but honors an explicit source', () => {
    const def = prepareContact({ externalKey: 'gmaps:a' }, { orgId: 'o' });
    const cust = prepareContact({ externalKey: 'gmaps:b', source: 'tiktok' }, { orgId: 'o' });
    if (!def.ok || !cust.ok) throw new Error('expected ok');
    expect(def.createData.source).toBe('gmaps');
    expect(cust.createData.source).toBe('tiktok');
  });

  it('omits empty tags array from fillData', () => {
    const r = prepareContact({ externalKey: 'gmaps:abc', tags: [], fullName: 'X' }, { orgId: 'o' });
    if (!r.ok) throw new Error('expected ok');
    expect('tags' in r.fillData).toBe(false); // empty array not fillable
    expect(r.fillData.fullName).toBe('X');     // but non-empty value is
  });
});
