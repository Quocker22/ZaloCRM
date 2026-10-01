// SPDX-License-Identifier: AGPL-3.0-or-later
// uid nào của một tin zca-js được đem hỏi hồ sơ (getUserInfo) — THUẦN, theo đúng model tin của zca-js 2.1.2
// (src/models/Message.ts):
//   UserMessage  (type 0, :90-100): threadId = uidFrom == "0" ? idTo : uidFrom (người kia); isSelf = uidFrom == "0";
//                uidFrom "0" được thay bằng uid của nick.
//   GroupMessage (type 1, :113-120): threadId = idTo = MÃ NHÓM; isSelf = uidFrom == "0"; uidFrom "0" ⇒ uid của nick.
// Mọi uid ở đây là uid THEO NICK nhận tin (nick khác thấy cùng người dưới uid khác).
//
// Lỗi cũ (listener 'message'): tin CHÍNH nick gửi trong NHÓM hỏi getUserInfo(threadId) = getUserInfo(MÃ NHÓM) ⇒ tốn một lời
// gọi mỗi tin + Zalo trả globalId/username GIỮ CHỖ dùng chung (contacts/backfill-global-id.ts: 't_ggzbdcmi80'). Đường
// 'old_messages' đã đúng (chỉ hỏi threadId khi 1-1).

export interface TinZcaToiThieu {
  /** ThreadType: 0 = User, 1 = Group. */
  type?: number;
  isSelf?: boolean;
  threadId?: string;
  data?: { uidFrom?: unknown; idTo?: unknown } | null;
}

/** uid người cần hỏi hồ sơ cho tin này; `null` = không hỏi (tin chính nick gửi trong nhóm, thiếu uid). */
export function uidHoiHoSoTinDen(m: TinZcaToiThieu): string | null {
  const nhom = m.type === 1;
  if (m.isSelf) {
    if (nhom) return null;
    const t = String(m.threadId || m.data?.idTo || '').trim();
    return t || null;
  }
  const u = String(m.data?.uidFrom ?? '').trim();
  return u && u !== '0' ? u : null;
}
