// SPDX-License-Identifier: AGPL-3.0-or-later
// `ilike` của Postgres cho Odoo GIẢ trong test — dùng chung cho mọi fake.
//
// VÌ SAO PHẢI CÓ: các fake trước đây so khớp bằng `boDau(ten).includes(tuKhoa)`.
// Cách đó sai ở HAI đầu và che mất đúng con bug đang phải sửa:
//
//   1. Nó TỰ BỎ DẤU cả hai vế — trong khi Postgres prod KHÔNG bỏ dấu (extension
//      `unaccent` không bật). Đo thật 11/08: ['name','ilike','Nguon'] -> 0 kq
//      còn 'Nguồn' -> 5 kq. Fake bỏ dấu nên mọi lượt tra đều "chạy tốt", và bug
//      thật chỉ lộ ra ngoài prod (ca 23:15 11/08 — không chọn được NCC).
//
//   2. Nó không hiểu KÝ TỰ ĐẠI DIỆN. Bản vá không-dấu (tim-khong-dau.ts) tra
//      bằng mẫu LIKE dùng `_` ("tr_ng q__c"); `.includes()` coi `_` là chữ `_`
//      thật nên không khớp gì cả, test đỏ oan.
//
// Hàm này mô phỏng ĐÚNG hai tính chất quyết định của `ilike` thật:
//   · KHÔNG bỏ dấu, chỉ bỏ qua hoa/thường
//   · `_` = đúng một ký tự bất kỳ · `%` = chuỗi bất kỳ · `\_`, `\%` = chữ thường

/** Dịch mẫu LIKE sang regex. `\x` giữ nghĩa chữ, `_`/`%` là đại diện. */
export function ilike(mau: string, giaTri: string): boolean {
  let re = '';
  for (let i = 0; i < mau.length; i++) {
    const c = mau[i];
    if (c === '\\' && i + 1 < mau.length) {
      re += mau[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      continue;
    }
    if (c === '_') { re += '.'; continue; }
    if (c === '%') { re += '.*'; continue; }
    re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re, 'i').test(giaTri);
}

/**
 * Toán tử `ilike` của Odoo: bọc `%…%` quanh giá trị tra (khớp CHỨA).
 * Đây là dạng dùng ở hầu hết fake — `ilikeChua(d[2], row.name)`.
 */
export function ilikeChua(mau: string, giaTri: string): boolean {
  return ilike(`%${mau}%`, giaTri);
}
