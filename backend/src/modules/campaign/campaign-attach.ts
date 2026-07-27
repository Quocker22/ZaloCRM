// SPDX-License-Identifier: AGPL-3.0-or-later
// Ảnh đính kèm THỦ CÔNG cho chiến dịch gửi hàng loạt: chủ shop tự tải ảnh của mình (poster
// khuyến mãi, ảnh SP cụ thể…) để gửi kèm mỗi tin — khác catalog báo giá tự động (catalog-image.ts).
// Lưu vào volume product-images/attach/<orgId>/ để BỀN qua redeploy + CÙNG máy với worker gửi
// (zca-js sendImage cần path local, không dùng URL).
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../product-images');

/** Thư mục lưu ảnh đính kèm của 1 org (nằm trong volume product-images để bền qua redeploy). */
export function attachUploadDir(orgId: string): string {
  // orgId là UUID từ auth (không phải input người dùng) nhưng vẫn siết để chắc chắn không traversal.
  const safe = orgId.replace(/[^a-zA-Z0-9-]/g, '');
  return join(IMG_DIR, 'attach', safe);
}

/** Tên file ảnh đính kèm hợp lệ (UUID + đuôi ảnh) — chống path traversal khi serve/gửi. */
export function isSafeAttachName(name: string): boolean {
  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(name);
}

/** Đổi danh sách tên file (từ FE) → path tuyệt đối HỢP LỆ + TỒN TẠI (bỏ tên bẩn/không có). */
export async function resolveAttachPaths(orgId: string, names: string[]): Promise<string[]> {
  const { existsSync } = await import('node:fs');
  const dir = attachUploadDir(orgId);
  const out: string[] = [];
  for (const n of names) {
    if (!isSafeAttachName(n)) continue;
    const full = join(dir, n);
    if (existsSync(full)) out.push(full);
  }
  return out;
}
