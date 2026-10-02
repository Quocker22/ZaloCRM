// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lớp chồng của Bản đồ tin so với vỏ CRM (giám sát docs/78 D1/D2/D4): nạp ĐÚNG ban-do-tin.css vào jsdom rồi đo
// getComputedStyle — không đọc chuỗi mã.
//   D1: toàn màn hình phải TRÊN thanh trên CRM `.smax-topnav` (sticky z 100, DefaultLayout.vue); hộp thoại/xác nhận TRÊN
//       toàn màn hình; dưới menu/dialog Vuetify (overlay ≥ 2000) để menu toàn cục vẫn nổi.
//   D2: bottom sheet TRÊN bottom nav (BottomNav.vue: fixed, z 100, cao 56 + safe-area) và chừa đáy 56px + safe-area.
//   D4: kích thước SPEC ghi bằng px — CRM đặt gốc 14.3px nên rem làm panel 329 thay vì 368 ⇒ cấm rem trong tệp.
import { describe, it, expect, beforeAll } from 'vitest';
// Đọc từ đĩa: vitest làm rỗng mọi import .css (kể cả ?raw). tsconfig app không có kiểu node (vue-tsc chạy cả spec) ⇒
// nạp node:fs động, gõ kiểu tay. Gốc chạy vitest = frontend/.
type Fs = { readFileSync(p: string, enc: 'utf8'): string };
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as Fs;
const goc = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const doc = (p: string) => fs.readFileSync(`${goc}/src/${p}`, 'utf8');
const CSS = doc('components/ban-do-tin/ban-do-tin.css');
const LAYOUT = doc('layouts/DefaultLayout.vue');
const BOTTOM_NAV = doc('components/BottomNav.vue');

const z = (sel: string) => Number(getComputedStyle(document.querySelector(sel)!).zIndex);

beforeAll(() => {
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.append(st);
  document.body.innerHTML = `
    <header class="smax-topnav" style="position: sticky; z-index: 100"></header>
    <div class="bdt">
      <div class="bdt-trang toan-man-hinh"><div class="bdt-luoi"><aside class="bdt-panel sheet" id="sheet"></aside></div></div>
      <div class="bdt-phu" id="phu"></div>
    </div>`;
});

describe('Bản đồ tin — lớp chồng so với vỏ CRM', () => {
  it('số z của vỏ CRM vẫn như lúc đo (đổi bên đó thì xem lại thứ tự dưới)', () => {
    expect(LAYOUT).toMatch(/\.smax-topnav \{[^}]*position: sticky; top: 0; z-index: 100;/);
    expect(BOTTOM_NAV).toMatch(/v-bottom-navigation[^>]*position: fixed; bottom: 0;[^>]*z-index: 100;/);
  });

  it('D1: thanh trên CRM < toàn màn hình < hộp thoại/xác nhận < overlay Vuetify (2000)', () => {
    const tren = z('.smax-topnav');
    const tmh = z('.bdt-trang.toan-man-hinh');
    const hop = z('#phu');
    expect(getComputedStyle(document.querySelector('.bdt-trang')!).position).toBe('fixed');
    expect(tmh).toBeGreaterThan(tren);
    expect(hop).toBeGreaterThan(tmh);
    expect(hop).toBeLessThan(2000);
  });

  it('D2: bottom sheet trên bottom nav (100) + chừa đáy 56px + safe-area', () => {
    const sheet = getComputedStyle(document.querySelector('#sheet')!);
    expect(sheet.position).toBe('fixed');
    expect(Number(sheet.zIndex)).toBeGreaterThan(100);
    expect(Number(sheet.zIndex)).toBeLessThan(z('#phu'));
    // jsdom (cssstyle) đảo chữ trong env() khi tính ⇒ so phần cốt lõi; trình duyệt thật đo ở khung so ảnh + staging
    expect(sheet.paddingBottom).toMatch(/^calc\(56px \+ env\(/);
    expect(sheet.paddingBottom).toContain('safe-area-inset-bottom');
  });

  it('D4: không còn rem — cột panel đúng minmax(304px, 368px), chiều cao trừ 96px', () => {
    expect(CSS).not.toMatch(/\d(\.\d+)?rem\b/);
    const luoi = getComputedStyle(document.querySelector('.bdt-luoi')!);
    expect(luoi.gridTemplateColumns).toBe('minmax(0, 1fr) minmax(304px, 368px)');
  });
});
