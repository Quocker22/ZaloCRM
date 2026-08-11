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

/**
 * Chấm một dòng theo DOMAIN ODOO dạng PREFIX-NOTATION đầy đủ.
 *
 * VÌ SAO CẦN (thêm 12/08): các fake trước đây gom mọi điều kiện `name` rồi
 * `tokens.every(...)` — tức COI TẤT CẢ LÀ AND. Cách đó đúng khi mỗi từ khoá chỉ
 * sinh một điều kiện, nhưng từ vòng 3 mỗi từ nở ra một khối OR các biến thể dấu
 * ("long" → long|lòng|lóng|…). `every` khi đó đòi tên phải chứa ĐỒNG THỜI mọi
 * biến thể — không ai thoả, nên fake trả rỗng và test đỏ oan trong khi code
 * thật chạy đúng. Fake sai kiểu này NGUY HIỂM: nó vừa báo động giả, vừa có thể
 * che mất hồi quy thật ở lần sau.
 *
 * Hàm này đọc đúng ngữ pháp Odoo: '&' và '|' là toán tử TIỀN TỐ nhận HAI toán
 * hạng kế tiếp, '!' nhận một. Thiếu toán tử giữa hai điều kiện liền nhau thì
 * ngầm hiểu là AND (đúng như Odoo).
 *
 * `khop` do caller cung cấp — nó biết cách so từng bộ ba với dòng dữ liệu.
 */
export function khopDomain(
  domain: unknown[],
  khop: (dieuKien: unknown[]) => boolean,
): boolean {
  let i = 0;
  const doc = (): boolean => {
    const x = domain[i++];
    if (x === '&') { const a = doc(); const b = doc(); return a && b; }
    if (x === '|') { const a = doc(); const b = doc(); return a || b; }
    if (x === '!') return !doc();
    return Array.isArray(x) ? khop(x) : true;
  };
  // Nhiều mệnh đề nối tiếp không có toán tử → ngầm AND (quy ước của Odoo).
  let kq = true;
  while (i < domain.length) kq = doc() && kq;
  return kq;
}
