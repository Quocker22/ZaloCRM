// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit test: validate của route CRUD guideline.
//
// Trọng tâm: locData KHÔNG BAO GIỜ để lọt orgId/id từ body — sửa xuyên org qua
// mass-assignment là lỗ hổng kinh điển của route CRUD viết vội.
import { describe, it, expect } from 'vitest';
import { kiemTra, locData } from '../../../src/modules/ai/agent/guideline-routes.js';

const hopLe = {
  ten: 'rule-moi', vai: 'khach', condition: 'khách hỏi X', action: 'Làm Y.',
};

describe('kiemTra', () => {
  it('tạo mới thiếu field bắt buộc → báo đúng field', () => {
    expect(kiemTra({ ...hopLe, ten: undefined }, true)).toContain('ten');
    expect(kiemTra({ ...hopLe, condition: '  ' }, true)).toContain('condition');
    expect(kiemTra(hopLe, true)).toBeNull();
  });

  it('PATCH không đòi field bắt buộc nhưng vẫn chặn enum sai', () => {
    expect(kiemTra({}, false)).toBeNull();
    expect(kiemTra({ vai: 'admin' }, false)).toContain('vai');
    expect(kiemTra({ mucDo: 'quan_trong' }, false)).toContain('mucDo');
    expect(kiemTra({ stage: 'dang_yeu' }, false)).toContain('stage');
    expect(kiemTra({ stage: null }, false)).toBeNull();
    expect(kiemTra({ yeuCau: 'gi_do' }, false)).toContain('yeuCau');
    expect(kiemTra({ tools: ['a', 1] }, false)).toContain('tools');
    expect(kiemTra({ uuTien: 1.5 }, false)).toContain('uuTien');
    expect(kiemTra({ enabled: 'yes' }, false)).toContain('enabled');
  });
});

describe('locData — chống mass-assignment', () => {
  it('bỏ orgId/id/field lạ khỏi body, giữ field cho phép', () => {
    const ra = locData({
      ...hopLe,
      // Kẻ gõ nghịch nhét thêm:
      ...( { orgId: 'org-khac', id: 'id-doat', createdAt: 'x' } as Record<string, unknown>),
      enabled: false,
    });

    expect(ra).not.toHaveProperty('orgId');
    expect(ra).not.toHaveProperty('id');
    expect(ra).not.toHaveProperty('createdAt');
    expect(ra).toMatchObject({ ten: 'rule-moi', enabled: false });
  });

  it('field không gửi thì không xuất hiện (PATCH một phần không ghi đè)', () => {
    expect(Object.keys(locData({ enabled: true }))).toEqual(['enabled']);
  });
});
