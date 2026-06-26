import { defineConfig } from 'vitest/config';

// E2E config: runs *.e2e.ts against a REAL database (no mocks).
// DATABASE_URL must point at a live Postgres with migrations applied.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.e2e.ts'],
    fileParallelism: false, // single DB, run serially
    testTimeout: 20000,
  },
});
