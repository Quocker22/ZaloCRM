// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Bẫy focus cho hộp thoại hướng dẫn / hộp xác nhận / bottom sheet (tự rà vòng 2 — a11y).
import { describe, it, expect, afterEach } from 'vitest';
import { bayFocus } from './bay-focus';

function dung(): { mo: HTMLButtonElement; hop: HTMLElement; a: HTMLButtonElement; b: HTMLInputElement; c: HTMLButtonElement } {
  document.body.innerHTML = '';
  const mo = document.createElement('button'); mo.textContent = 'mở'; document.body.append(mo);
  const hop = document.createElement('div');
  hop.innerHTML = '<button id="a">a</button><button disabled>x</button><input id="b"><span tabindex="-1">bỏ</span><button id="c">c</button>';
  document.body.append(hop);
  return { mo, hop, a: hop.querySelector('#a')!, b: hop.querySelector('#b')!, c: hop.querySelector('#c')! };
}
const tab = (el: Element, shift = false) => {
  const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};

afterEach(() => { document.body.innerHTML = ''; });

describe('bayFocus', () => {
  it('mở ⇒ focus phần tử đầu (hoặc phần tử chỉ định); Tab ở cuối ⇒ về đầu; Shift+Tab ở đầu ⇒ về cuối', () => {
    const { mo, hop, a, c } = dung();
    mo.focus();
    const go = bayFocus(hop);
    expect(document.activeElement).toBe(a);
    c.focus();
    expect(tab(c).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a);
    expect(tab(a, true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(c);
    go();
  });

  it('Tab giữa chừng để trình duyệt tự đi (không chặn)', () => {
    const { hop, a } = dung();
    const go = bayFocus(hop);
    expect(tab(a).defaultPrevented).toBe(false);
    go();
  });

  it('đóng ⇒ trả focus về phần tử đã mở; focus đầu theo phần tử chỉ định', () => {
    const { mo, hop, b } = dung();
    mo.focus();
    const go = bayFocus(hop, { dau: b });
    expect(document.activeElement).toBe(b);
    go();
    expect(document.activeElement).toBe(mo);
  });

  it('phần tử mở đã bị gỡ khỏi DOM ⇒ không ném lỗi', () => {
    const { mo, hop } = dung();
    mo.focus();
    const go = bayFocus(hop);
    mo.remove();
    expect(() => go()).not.toThrow();
  });
});
