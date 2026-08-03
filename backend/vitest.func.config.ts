import { defineConfig } from 'vitest/config';

// Function test: chạy *.func.ts — kiểm thử từng tool với tầng I/O được MOCK.
//
// Vì sao tách khỏi unit (vitest.config.ts): tool có I/O (XML-RPC sang Odoo) nên
// không phải hàm thuần. Nhưng cũng không đáng dựng Odoo thật cho mỗi lần chạy
// như E2E. Tầng giữa này bắt được: gọi đúng model/method Odoo, xử lý lỗi đúng,
// và KHÔNG vượt quyền (vd không đọc giá vốn).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.func.ts'],
    // DATABASE_URL giả — giống vitest.config.ts, để import Prisma được mà
    // không cần DB thật (Prisma init lazy, không connect).
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test',
    },
  },
});
