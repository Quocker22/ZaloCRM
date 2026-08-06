// SPDX-License-Identifier: AGPL-3.0-or-later
// BÓC chuỗi mention Zalo khỏi nội dung đưa cho agent.
//
// Bug thật 06/08/2026 13:02: nhân viên tag bot trong nhóm — "@Led Nelia Anh
// Dương Tuấn Anh". Để nguyên thì model thấy một cái tên lạ lơ lửng đầu câu,
// cộng với lịch sử gán vai ngược, nó lú hẳn: nhai lại câu tồn kho cũ, không
// gọi tool nào.
//
// Cắt bằng pos/len Zalo trả về — chính xác từng ký tự, không đoán bằng regex
// (tên hiển thị chứa được mọi ký tự, regex là đoán mò). Chỉ ảnh hưởng bản đưa
// agent; bản lưu DB giữ nguyên để FE còn render mention.

export interface MentionZalo {
  uid: string;
  pos: number;
  len: number;
}

/** Cắt mọi mention khỏi content theo pos/len, gộp khoảng trắng thừa. */
export function bocMention(content: string, mentions?: MentionZalo[] | null): string {
  const goc = String(content ?? '');
  if (!mentions?.length) return goc;

  let s = goc;
  // Cắt từ PHẢI sang trái để pos của mention trước không bị lệch.
  for (const m of [...mentions].sort((a, b) => b.pos - a.pos)) {
    if (m.pos >= 0 && m.len > 0 && m.pos + m.len <= s.length) {
      s = s.slice(0, m.pos) + s.slice(m.pos + m.len);
    }
  }
  return s.replace(/[^\S\n]{2,}/g, ' ').trim();
}
