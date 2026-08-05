// SPDX-License-Identifier: AGPL-3.0-or-later
// Kiểu dùng chung của hai luồng nối Zalo.

/** Ngữ cảnh MỘT tin nhắn đến — message-handler dựng rồi giao cho luồng. */
export interface NgữCanhTin {
  orgId: string;
  bizName: string;
  conversationId: string;
  messageId: string;
  content: string;
  /** UID Zalo người gửi — để nhận nhân viên gõ từ nick cá nhân. */
  senderUid?: string | null;
  /** true khi tin do chính nick shop gửi. */
  isSelf?: boolean;
}
