import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';

/**
 * Bản Community KHÔNG có `src/_ee/` (Automation, Marketing, Lead Pool, Facebook) —
 * commit 24160d73 "feat(open-core): B6 — move Automation + Marketing behind _ee"
 * chuyển code sang bundle riêng nhưng KHÔNG chuyển test theo.
 *
 * 29 file dưới đây import trực tiếp module `_ee`, nên ở bản Community chúng đỏ
 * VĨNH VIỄN — không phải lỗi thật, chỉ là test cho code không tồn tại. Bộ test đỏ
 * sẵn nguy hiểm hơn thiếu test: lỗi MỚI lẫn vào đám đỏ cũ, không ai phát hiện.
 *
 * `vi.mock` và `import` tĩnh đều resolve trước khi `describe.skipIf` chạy, nên
 * skip trong file KHÔNG cứu được — phải loại ở tầng config.
 *
 * Có `src/_ee/` (bản Extension) → danh sách này rỗng, 29 file tự chạy lại.
 */
const CO_EE = existsSync(new URL('./src/_ee', import.meta.url));
const TEST_CAN_EE = CO_EE ? [] : [
      'tests/alias-template.test.ts',
      'tests/block-logger.test.ts',
      'tests/block-reason-catalog.test.ts',
      'tests/block-types.test.ts',
      'tests/care-notify-privacy.test.ts',
      'tests/care-session-service.test.ts',
      'tests/engine-gates.test.ts',
      'tests/lead-notify.test.ts',
      'tests/lead-pool-submit-note.test.ts',
      'tests/materialize-from-event.test.ts',
      'tests/quota-kind-separation.test.ts',
      'tests/reconcile-stuck-steps.test.ts',
      'tests/regression-m51-4-dup-status.test.ts',
      'tests/regression-m52-reply-pause.test.ts',
      'tests/regression-m57-reaction.test.ts',
      'tests/render-template-vars.test.ts',
      'tests/security/hmac.test.ts',
      'tests/sequence-jobid-multistream.test.ts',
      'tests/sequence-schedule-calculator.test.ts',
      'tests/sequence-step-worker-block.test.ts',
      'tests/sequence-types.test.ts',
      'tests/trigger-types.test.ts',
      'tests/unit/facebook-form-discovery.test.ts',
      'tests/unit/facebook-token-refresh-cron.test.ts',
      'tests/unit/facebook-webhook.test.ts',
      'tests/unit/lead-field-mapper.test.ts',
      'tests/unit/round-robin-assigner.test.ts',
      'tests/unit/zalo-field-mapper.test.ts',
      'tests/worker-token-passthrough.test.ts',
];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', ...TEST_CAN_EE],
    // 2026-06-11 — DATABASE_URL giả để test UNIT (hàm thuần) import được prisma-client
    // mà không cần DB thật (prisma init lazy, không connect). Test cần DB thật override
    // qua env runtime. Đảm bảo privacy-redact-regression chạy ở mọi máy/CI.
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test',
    },
    coverage: {
      provider: 'v8',
      include: ['src/modules/**/*.ts', 'src/shared/**/*.ts'],
    },
  },
});
