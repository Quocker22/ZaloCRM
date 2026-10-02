// SPDX-License-Identifier: AGPL-3.0-or-later
// bay-focus.ts — bẫy focus cho hộp thoại hướng dẫn, hộp xác nhận và bottom sheet (tự rà vòng 2 — a11y):
//   mở ⇒ focus phần tử đầu (hoặc `dau`); Tab/Shift+Tab xoay vòng TRONG hộp; đóng ⇒ trả focus về phần tử đã mở hộp.

const CHON_DUOC = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])', 'textarea:not([disabled])',
  'summary', '[tabindex]:not([tabindex="-1"])',
].join(',');

export const phanTuFocusDuoc = (goc: HTMLElement): HTMLElement[] =>
  [...goc.querySelectorAll<HTMLElement>(CHON_DUOC)].filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');

/** Gắn bẫy vào `goc`; trả hàm gỡ (gọi lúc đóng hộp). */
export function bayFocus(goc: HTMLElement, tc: { dau?: HTMLElement | null } = {}): () => void {
  const truoc = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
  (tc.dau ?? phanTuFocusDuoc(goc)[0] ?? goc).focus?.();

  function phim(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const ds = phanTuFocusDuoc(goc);
    if (!ds.length) { e.preventDefault(); return; }
    const dau = ds[0], cuoi = ds[ds.length - 1];
    const dang = document.activeElement;
    if (e.shiftKey && (dang === dau || !goc.contains(dang))) { e.preventDefault(); cuoi.focus(); }
    else if (!e.shiftKey && (dang === cuoi || !goc.contains(dang))) { e.preventDefault(); dau.focus(); }
  }
  goc.addEventListener('keydown', phim);
  return () => {
    goc.removeEventListener('keydown', phim);
    if (truoc && truoc.isConnected && typeof truoc.focus === 'function') truoc.focus();
  };
}
