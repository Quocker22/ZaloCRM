// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit test: lắp system prompt từ prompt lõi + guideline active, và tính bộ
// tool được phép đăng ký.
//
// Hai bất biến quan trọng:
//   1. Guideline `bat_buoc` LUÔN vào prompt — matcher nói gì kệ matcher.
//   2. Tool ghi chỉ được phép khi guideline mở nó ACTIVE — matcher không match
//      thì tao_don_nhap không tồn tại trong registry, model không gọi nổi.
import { describe, it, expect } from 'vitest';
import {
  lapPromptKhach,
  tinhToolChoPhep,
  TOOL_NEN,
} from '../../../src/modules/ai/agent/guideline-prompt.js';
import type { KetQuaMatch } from '../../../src/modules/ai/agent/guideline-matcher.js';

const G = (over: Partial<{
  id: string; action: string; mucDo: string; tools: string[]; uuTien: number;
}> = {}) => ({
  id: 'g1',
  action: 'Làm việc A.',
  mucDo: 'thuong',
  tools: [] as string[],
  uuTien: 100,
  ...over,
});

const match = (over: Partial<KetQuaMatch> = {}): KetQuaMatch => ({
  stage: 'tu_van', matchedIds: [], fallback: false, ...over,
});

describe('lapPromptKhach', () => {
  it('guideline bat_buoc LUÔN có mặt dù matcher không match', () => {
    const p = lapPromptKhach('LEDNELIA', match(), [
      G({ id: 'g10', action: 'Không hứa giảm giá.', mucDo: 'bat_buoc' }),
      G({ id: 'g2', action: 'Tra giá bằng tool.' }),
    ]);

    expect(p).toContain('Không hứa giảm giá.');
    expect(p).not.toContain('Tra giá bằng tool.');
  });

  it('guideline thuong chỉ vào khi được match', () => {
    const p = lapPromptKhach('LEDNELIA', match({ matchedIds: ['g2'] }), [
      G({ id: 'g2', action: 'Tra giá bằng tool.' }),
      G({ id: 'g7', action: 'Lên đơn ngay.' }),
    ]);

    expect(p).toContain('Tra giá bằng tool.');
    expect(p).not.toContain('Lên đơn ngay.');
  });

  it('fallback → nạp TOÀN BỘ (hành vi prompt tĩnh hôm nay)', () => {
    const p = lapPromptKhach('LEDNELIA', match({ fallback: true }), [
      G({ id: 'g2', action: 'Tra giá bằng tool.' }),
      G({ id: 'g7', action: 'Lên đơn ngay.' }),
    ]);

    expect(p).toContain('Tra giá bằng tool.');
    expect(p).toContain('Lên đơn ngay.');
  });

  it('sắp theo uuTien tăng dần, cùng uuTien thì theo id — ổn định cho cache', () => {
    const p = lapPromptKhach('LEDNELIA', match({ matchedIds: ['ga', 'gb', 'gc'] }), [
      G({ id: 'gc', action: 'Câu C.', uuTien: 50 }),
      G({ id: 'gb', action: 'Câu B.', uuTien: 100 }),
      G({ id: 'ga', action: 'Câu A.', uuTien: 100 }),
    ]);

    const viTri = (s: string) => p.indexOf(s);
    expect(viTri('Câu C.')).toBeLessThan(viTri('Câu A.'));
    expect(viTri('Câu A.')).toBeLessThan(viTri('Câu B.'));
  });

  it('prompt lõi có tên shop, KHÔNG ôm luật markdown (cổng ra boMarkdown lo)', () => {
    const p = lapPromptKhach('LEDNELIA', match(), []);

    expect(p).toContain('LEDNELIA');
    expect(p.toLowerCase()).not.toContain('markdown');
  });

  it('prompt lõi dưới 500 ký tự — CHỐT CHẶN chống phình', () => {
    // Đây là toàn bộ lý do guideline engine tồn tại: prompt tĩnh cũ phình từ
    // vài dòng lên ~2.900 ký tự (trần trong customer-agent.func.ts cứ phải nới
    // 2800 → 2950). Muốn thêm rule? INSERT vào ai_guidelines. Test này đỏ nghĩa
    // là có người đang lặp lại vết xe đổ.
    expect(lapPromptKhach('LEDNELIA', match(), []).length).toBeLessThan(500);
  });
});

describe('tinhToolChoPhep', () => {
  it('tool nền luôn có — kể cả khi không guideline nào match', () => {
    const cho = tinhToolChoPhep(match(), []);

    for (const t of TOOL_NEN) expect(cho.has(t)).toBe(true);
  });

  it('tool ghi CHỈ được phép khi guideline mở nó active', () => {
    const gs = [G({ id: 'g7', tools: ['tao_khach_hang', 'tao_don_nhap'] })];

    const khongMatch = tinhToolChoPhep(match(), gs);
    expect(khongMatch.has('tao_don_nhap')).toBe(false);

    const coMatch = tinhToolChoPhep(match({ matchedIds: ['g7'] }), gs);
    expect(coMatch.has('tao_don_nhap')).toBe(true);
    expect(coMatch.has('tao_khach_hang')).toBe(true);
  });

  it('fallback → mọi tool của mọi guideline enabled đều được phép (như hôm nay)', () => {
    const cho = tinhToolChoPhep(match({ fallback: true }), [
      G({ id: 'g7', tools: ['tao_don_nhap'] }),
    ]);

    expect(cho.has('tao_don_nhap')).toBe(true);
  });
});
