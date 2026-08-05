// SPDX-License-Identifier: AGPL-3.0-or-later
// TEST CẦN DB THẬT — skip có chủ đích thay vì đỏ vĩnh viễn.
//
// Bug gốc (bản đánh giá 05/08/2026): 5 file test bảo mật cần Postgres đã
// migrate, đỏ trên mọi máy không có DB → `npm test` không bao giờ xanh toàn
// phần → người ta quen mắt bỏ qua màu đỏ → lỗi MỚI lẫn vào đám đỏ cũ, không ai
// phát hiện. Bộ test đỏ sẵn nguy hiểm hơn thiếu test.
//
// Cách dùng: file cần DB đổi `describe(` → `describeCanDb(`. Máy trần thấy
// SKIP (vàng, có chủ đích); máy có DB chạy `npm run test:db` — ở đó skip là
// KHÔNG được phép, phải xanh thật.
//
// Vì sao opt-in bằng env riêng thay vì tự dò DATABASE_URL: biến đó thường được
// đặt sẵn trong .env kể cả khi DB không chạy/chưa migrate — dò nó là dò sai.
import { describe } from 'vitest';

/** Máy này có DB test sẵn sàng chưa — đặt CO_DB_TEST=1 để xác nhận. */
export const coDb = process.env.CO_DB_TEST === '1';

/** `describe` chỉ chạy khi có DB; không có thì SKIP (vàng), không FAIL (đỏ). */
export const describeCanDb = describe.skipIf(!coDb);
