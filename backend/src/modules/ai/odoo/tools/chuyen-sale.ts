// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: chuyển việc cho người thật.
//
// Đây là "lối thoát" của bot. Mọi tool khác khi bí đều hướng model về đây:
// không tìm thấy khách, nhiều khách trùng, thiếu thông tin, khách khiếu nại,
// hoặc bất cứ tình huống nào model không chắc.
//
// Có tool này quan trọng hơn vẻ ngoài của nó: không có lối thoát rõ ràng thì
// model sẽ tự bịa ra cách xử lý — mà bịa trong ngữ cảnh bán hàng là bịa số.

import type { ToolDefinition } from '../../agent/types.js';

export type LyDoChuyen =
  | 'khong_tim_thay_khach'
  | 'nhieu_khach_trung'
  | 'thieu_thong_tin'
  | 'khieu_nai'
  | 'ngoai_tham_quyen'
  | 'khac';

export interface YeuCauChuyenSale {
  lyDo: LyDoChuyen;
  tomTat: string;
}

export interface ChuyenSaleDeps {
  /** Ghi nhận yêu cầu chuyển — thường là gắn tag + mở nhóm handoff. */
  ghiNhan: (yc: YeuCauChuyenSale) => Promise<void>;
}

/**
 * Chuyển việc cho sale. Luôn thành công về mặt tool — kể cả khi ghi nhận lỗi,
 * vì bản thân việc model quyết định chuyển đã là thông tin có giá trị.
 */
export async function chuyenSale(
  deps: ChuyenSaleDeps,
  input: { ly_do: string; tom_tat: string },
): Promise<{ daChuyen: boolean; lyDo: LyDoChuyen }> {
  const hopLe: LyDoChuyen[] = [
    'khong_tim_thay_khach',
    'nhieu_khach_trung',
    'thieu_thong_tin',
    'khieu_nai',
    'ngoai_tham_quyen',
    'khac',
  ];
  const lyDo = hopLe.includes(input.ly_do as LyDoChuyen) ? (input.ly_do as LyDoChuyen) : 'khac';
  const tomTat = (input.tom_tat ?? '').trim() || 'Không có tóm tắt';

  try {
    await deps.ghiNhan({ lyDo, tomTat });
  } catch {
    // Ghi nhận lỗi không được làm hỏng lượt — model vẫn cần biết là đã chuyển.
  }
  return { daChuyen: true, lyDo };
}

export const chuyenSaleDefinition: ToolDefinition = {
  name: 'chuyen_sale',
  description:
    'Chuyển việc cho nhân viên sale xử lý. GỌI KHI: không tìm thấy khách trong hệ thống, ' +
    'tìm thấy nhiều khách trùng số, thiếu thông tin để làm tiếp, khách khiếu nại, ' +
    'khách xin giảm giá ngoài thẩm quyền, hoặc bất cứ khi nào bạn không chắc chắn. ' +
    'Chuyển sale luôn tốt hơn đoán bừa.',
  inputSchema: {
    type: 'object',
    properties: {
      ly_do: {
        type: 'string',
        enum: [
          'khong_tim_thay_khach',
          'nhieu_khach_trung',
          'thieu_thong_tin',
          'khieu_nai',
          'ngoai_tham_quyen',
          'khac',
        ],
      },
      tom_tat: { type: 'string', description: 'Tóm tắt ngắn cho sale biết cần làm gì' },
    },
    required: ['ly_do', 'tom_tat'],
  },
  mutates: true,
};

export function dinhDangChuyenSale(kq: { daChuyen: boolean; lyDo: LyDoChuyen }): string {
  return `Đã chuyển cho sale (lý do: ${kq.lyDo}). Hãy báo lại ngắn gọn là việc đã được chuyển.`;
}
