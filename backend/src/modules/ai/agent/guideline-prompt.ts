// SPDX-License-Identifier: AGPL-3.0-or-later
// Lắp system prompt luồng khách từ prompt lõi + guideline active, và tính bộ
// tool được phép — nửa sau của guideline engine (nửa đầu: guideline-matcher.ts).
//
// PROMPT LÕI BẤT BIẾN — quy tắc số 1 của thiết kế: chỉ chứa thứ đúng với MỌI
// lượt. Muốn thêm rule nghiệp vụ? INSERT vào bảng ai_guidelines, KHÔNG sửa đây.
// Luật "Zalo không render markdown" cũng KHÔNG nằm đây nữa: model từng in
// "**đậm**" dù bị cấm ngay dòng đầu prompt (bug 16:42 08/08) — cổng ra
// boMarkdown() chặn bằng code rồi, prompt khỏi tốn chữ vô ích.

import type { KetQuaMatch } from './guideline-matcher.js';

export interface GuidelineActive {
  id: string;
  action: string;
  /** 'bat_buoc' → luôn nạp, bỏ qua matcher. 'thuong' → chỉ khi match. */
  mucDo: string;
  /** Tool chỉ được đăng ký khi guideline này active. */
  tools: string[];
  /** Nhỏ đứng trước trong prompt. */
  uuTien: number;
}

/**
 * Tool LUÔN đăng ký bất kể match gì — lối vào (tra SP), lối thoát (chuyển
 * sale), tri thức kỹ thuật và GỬI TÀI LIỆU (đều chỉ ĐỌC, vô hại, lượt nào
 * cũng có thể cần). Thiếu lối thoát thì lượt matcher trượt sẽ thành bot câm.
 * Tool GHI thì ngược lại: KHÔNG BAO GIỜ nằm đây — phải có guideline mở.
 *
 * `gui_tai_lieu` vào đây (11/08/2026) vì lý do y hệt `tra_tri_thuc`: khách xin
 * catalog ở BẤT KỲ lượt nào — lúc mới chào, giữa lúc hỏi giá, sau khi chốt.
 * Bắt nó phụ thuộc một guideline khớp đúng là tái tạo bug 03:17 cùng ngày
 * (bot không gửi được file dù file nằm sẵn) mỗi khi matcher trượt.
 */
export const TOOL_NEN = ['tra_san_pham', 'chuyen_sale', 'tra_tri_thuc', 'gui_tai_lieu'] as const;

/**
 * Lọc guideline theo cấu hình PHIÊN (khác matcher — matcher xét theo lượt):
 * `yeuCau` chọn biến thể "khách tự chốt đơn" hay "chuyển sale chốt".
 */
export function locTheoPhien<T extends { yeuCau?: string | null }>(
  guidelines: T[],
  tuChotDon: boolean,
): T[] {
  return guidelines.filter((g) => {
    if (g.yeuCau === 'tu_chot_don') return tuChotDon;
    if (g.yeuCau === 'khong_tu_chot_don') return !tuChotDon;
    return true;
  });
}

/** Guideline nào được nạp vào lượt này. */
function locActive(match: KetQuaMatch, guidelines: GuidelineActive[]): GuidelineActive[] {
  return guidelines
    .filter(
      (g) => g.mucDo === 'bat_buoc' || match.fallback || match.matchedIds.includes(g.id),
    )
    .sort((a, b) => a.uuTien - b.uuTien || a.id.localeCompare(b.id));
}

export function lapPromptKhach(
  bizName: string,
  match: KetQuaMatch,
  guidelines: GuidelineActive[],
): string {
  const active = locActive(match, guidelines);
  return [
    `Bạn là nhân viên tư vấn của ${bizName}, đang chat với KHÁCH HÀNG qua Zalo.`,
    'Lịch sự, có "dạ/ạ", gọi khách là "anh/chị", ngắn gọn — khách đọc trên điện thoại.',
    'Không nói id nội bộ, giá vốn, công nợ, số tồn kho. Không bịa số.',
    ...(active.length > 0
      ? ['', '## Chỉ dẫn cho tình huống hiện tại', '', ...active.map((g) => `- ${g.action}`)]
      : []),
  ].join('\n');
}

/**
 * Bộ tên tool được phép đăng ký vào registry lượt này.
 *
 * Đây là tầng chặn NẰM DƯỚI prompt: matcher không match guideline chốt đơn thì
 * `tao_don_nhap` không tồn tại trong registry — model không gọi nổi, kể cả khi
 * bị prompt injection dụ. Các hàng rào code cũ (laYDinhDung, trần tiền…) vẫn
 * chặn tiếp ở executor như trước, không thay thế nhau.
 */
export function tinhToolChoPhep(
  match: KetQuaMatch,
  guidelines: GuidelineActive[],
): Set<string> {
  return new Set([
    ...TOOL_NEN,
    ...locActive(match, guidelines).flatMap((g) => g.tools),
  ]);
}
