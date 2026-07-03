// SPDX-License-Identifier: AGPL-3.0-or-later
// Giả lập NHỊP GÕ NGƯỜI trước khi bot gửi tin — chống Zalo flag spam (gửi đều tăm tắp
// như máy là dấu hiệu bot rõ nhất). Delay = thời gian "đọc + gõ", có ngẫu nhiên, tỷ lệ
// theo độ dài tin, nhưng cận trên có giới hạn (không để khách chờ quá lâu).
// Bật/tắt qua env AI_HUMAN_PACE (mặc định BẬT). AI_HUMAN_PACE_MAX_MS chỉnh trần.

const ENABLED = process.env.AI_HUMAN_PACE !== '0';
const MIN_MS = 1500; // tối thiểu ~1.5s (đọc tin khách)
const PER_CHAR_MS = 22; // ~22ms/ký tự (tốc độ gõ ~ 45 ký tự/giây khi soạn)
const MAX_MS = Number(process.env.AI_HUMAN_PACE_MAX_MS) || 9000; // trần 9s (không để khách chờ lâu)

// Math.random KHÔNG dùng được trong 1 số môi trường (workflow); dùng seed thời gian.
function rand(): number {
  // jitter dựa trên Date.now() + Math.random nếu có. Trong runtime backend Math.random OK.
  return Math.random();
}

/** Tính delay (ms) cho 1 tin dài `len` ký tự: base + gõ + jitter, kẹp [MIN, MAX]. */
export function humanDelayMs(len: number): number {
  if (!ENABLED) return 0;
  const typing = Math.min(len, 400) * PER_CHAR_MS; // chỉ tính tới 400 ký tự đầu
  const jitter = 0.6 + rand() * 0.8; // 0.6x–1.4x ngẫu nhiên
  const ms = (MIN_MS + typing) * jitter;
  return Math.max(MIN_MS, Math.min(MAX_MS, Math.round(ms)));
}

/** Chờ theo nhịp người trước khi gửi 1 tin dài `len` ký tự. */
export async function humanPace(len: number): Promise<void> {
  const ms = humanDelayMs(len);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}
