// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { buildSummaryPrompt, formatGroupSummary, groupName } from '../../../src/modules/ai/knowledge/handoff-group.js';

describe('handoff-group helpers', () => {
  it('buildSummaryPrompt: system nói RÕ là tóm tắt nội bộ cho sale, không phải nói khách', () => {
    const { system, prompt } = buildSummaryPrompt(
      'LEDNELIA',
      'Anh Quốc',
      [
        { role: 'customer', content: 'nguồn 12V 400W còn không' },
        { role: 'shop', content: 'dạ còn, giá 132.000đ' },
      ],
      '100 cái giá sỉ sao',
    );
    expect(system.toLowerCase()).toContain('sale');
    expect(system).toContain('KHÔNG phải nói với khách');
    expect(system.toLowerCase()).toContain('không bịa');
    expect(prompt).toContain('Anh Quốc');
    expect(prompt).toContain('nguồn 12V 400W còn không'); // lịch sử được đưa vào
    expect(prompt).toContain('100 cái giá sỉ sao'); // tin mới nhất
  });
  it('formatGroupSummary: có tiêu đề khách + nội dung + dòng ký', () => {
    const t = formatGroupSummary('Anh Quốc', '- Hỏi nguồn 12V 400W\n- Cần giá sỉ 100 cái');
    expect(t).toContain('Anh Quốc');
    expect(t).toContain('giá sỉ 100 cái');
    expect(t.toLowerCase()).toContain('sale');
  });
  it('formatGroupSummary: khách rỗng → "khách"', () => {
    expect(formatGroupSummary('', 'x').toLowerCase()).toContain('khách');
  });
  it('groupName: gọn + có tên khách', () => {
    expect(groupName('Anh Quốc')).toBe('Tư vấn: Anh Quốc');
    expect(groupName('').startsWith('Tư vấn')).toBe(true);
  });
});
