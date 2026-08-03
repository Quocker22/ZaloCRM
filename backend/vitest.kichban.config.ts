import { defineConfig } from 'vitest/config';

// Config riêng cho bộ câu hỏi chuẩn (tests/kich-ban/*.kichban.ts).
//
// VÌ SAO TÁCH khỏi vitest.e2e.config.ts:
//  - Mỗi ca gọi LLM THẬT (3-10s). 200 ca không thể vừa testTimeout 20s.
//  - Cần chạy có chọn lọc (một nhóm, một id) mà không kéo theo E2E khác.
//  - E2E khác cần Postgres; bộ này chỉ cần Odoo + LLM.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/kich-ban/**/*.kichban.ts'],
    fileParallelism: false,
    // Trần cho CẢ file: 200 ca × ~8s ÷ 4 luồng ≈ 7 phút, để dư gấp đôi.
    testTimeout: 900_000,
    hookTimeout: 120_000,
  },
});
