// SPDX-License-Identifier: AGPL-3.0-or-later
// Cấu hình máy in từ env — MỘT biến bật/tắt cả tính năng:
//
//   AI_MAY_IN_IPP_URL=ipp://<ip-máy-in>:631/ipp/print   (qua cầu Tailscale PC shop)
//   AI_MAY_IN_TIMEOUT_MS=15000                          (tuỳ chọn)
//
// Chưa đặt URL → null: tool in_hoa_don không đăng ký, cron không chạy —
// bot không bao giờ hứa in khi hệ không có máy in.
import type { IppClientConfig } from './ipp-client.js';
import type { AgentClientConfig } from './agent-client.js';

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

/** Cấu hình AgentClient đọc từ env, cộng orgId — Task 4 (25/08). */
export interface AgentConfigTuEnv extends AgentClientConfig {
  orgId: string;
}

/**
 * Chưa có AI_MAY_IN_AGENT_TOKEN → null: agent-ws.ts (Task 3) cũng dùng đúng
 * biến này để bật/tắt namespace WS, nên "có token" đồng nghĩa "có kênh agent
 * để gửi job" — nhất quán 2 phía.
 *
 * VÌ SAO bắt buộc AI_MAY_IN_ORG_ID: cron chạy nền, không có request nào để
 * suy ra org — khác agent-ws.ts (orgId agent tự khai lúc connect WS). Thiếu
 * biến này thì KHÔNG được tự bịa/đoán org (vd "org mặc định") — coi như
 * kênh agent chưa cấu hình đủ, trả null để chonClientMayIn rơi về IPP/tắt.
 */
export function agentConfigTuEnv(env: NodeJS.ProcessEnv = process.env): AgentConfigTuEnv | null {
  const token = env.AI_MAY_IN_AGENT_TOKEN?.trim();
  if (!token) return null;
  const orgId = env.AI_MAY_IN_ORG_ID?.trim();
  if (!orgId) return null;
  return {
    orgId,
    paperSize: env.AI_MAY_IN_PAPER_SIZE?.trim() || 'A5',
    tray: env.AI_MAY_IN_TRAY?.trim() || 'tray-2',
  };
}

/**
 * Hệ có máy in qua BẤT KỲ kênh nào (IPP trực tiếp HOẶC agent PC-cầu-nối)?
 *
 * VÌ SAO tách hàm riêng thay vì gọi thẳng `ippConfigTuEnv() || agentConfigTuEnv()`
 * ở nơi dùng: fix round review Task 5 — luong-nhan-vien.ts trước đây chỉ gate
 * tool `in_hoa_don` bằng `ippConfigTuEnv()`. Triển khai thuần-agent (có
 * AI_MAY_IN_AGENT_TOKEN + AI_MAY_IN_ORG_ID, KHÔNG có AI_MAY_IN_IPP_URL) thì
 * cron in được (chonClientMayIn ưu tiên AgentClient — xem cron.ts) nhưng tool
 * KHÔNG đăng ký → nhân viên không gọi được lệnh in dù máy in đã sẵn sàng. Một
 * hàm thuần, test được độc lập, và dùng lại được ở mọi nơi cần cùng câu hỏi
 * "hệ có máy in không" mà không phải nhớ ghép đúng 2 hàm con mỗi lần.
 */
export function coMayIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(ippConfigTuEnv(env) || agentConfigTuEnv(env));
}
