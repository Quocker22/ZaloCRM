// SPDX-License-Identifier: AGPL-3.0-or-later
// Cấu hình máy in từ env — MỘT biến bật/tắt cả tính năng:
//
//   AI_MAY_IN_IPP_URL=ipp://<ip-máy-in>:631/ipp/print   (qua cầu Tailscale PC shop)
//   AI_MAY_IN_TIMEOUT_MS=15000                          (tuỳ chọn)
//
// Chưa đặt URL → null: tool in_hoa_don không đăng ký, cron không chạy —
// bot không bao giờ hứa in khi hệ không có máy in.
import type { IppClientConfig } from './ipp-client.js';

export function ippConfigTuEnv(env: NodeJS.ProcessEnv = process.env): IppClientConfig | null {
  const uri = env.AI_MAY_IN_IPP_URL?.trim();
  if (!uri) return null;
  const t = Number(env.AI_MAY_IN_TIMEOUT_MS);
  return {
    uri,
    timeoutMs: Number.isFinite(t) && t > 0 ? t : 15_000,
    nguoiGui: 'zalocrm',
  };
}
