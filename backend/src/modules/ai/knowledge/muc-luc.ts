// SPDX-License-Identifier: AGPL-3.0-or-later
// MỤC LỤC SẢN PHẨM — nhóm B (15/08), học MemoryKnowledge index-builder.
//
// RAG top-k trả lời TỆ đúng loại câu tổng-hợp: "shop có những dòng đèn nào",
// "bên mình bán mấy loại nguồn" — không chunk nào CHỨA câu trả lời, nên bot
// hoặc bịa hoặc liệt kê lỗ chỗ theo vài chunk trúng. Mục lục là bản đồ toàn
// kho sinh TẤT ĐỊNH từ sheet (nguồn sự thật) lúc đồng bộ — vài trăm token,
// nhét thẳng vào ngữ cảnh mọi lượt, tự khớp sheet mỗi lần "đồng bộ tri thức".
//
// KHÔNG sinh bằng LLM (index.md của họ cũng vậy): việc gom nhóm + đếm là việc
// của code; trả tiền model cho nó vừa tốn vừa thêm một nguồn bịa.
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';

/** source của document mục lục trong knowledge_documents (script đồng bộ ghi). */
export const NGUON_MUC_LUC = 'sheet-muc-luc';

/**
 * Đọc mục lục của org. Best-effort: lỗi/chưa đồng bộ → null, lượt chat chạy
 * như cũ không mục lục — nhánh phụ không được kéo sập nhánh chính.
 */
export async function mucLucSanPham(orgId: string): Promise<string | null> {
  try {
    const doc = await prisma.knowledgeDocument.findFirst({
      where: { orgId, source: NGUON_MUC_LUC },
      select: { content: true },
    });
    return doc?.content?.trim() || null;
  } catch (err) {
    logger.warn({ err, orgId }, '[muc-luc] đọc mục lục lỗi — lượt này chạy không mục lục');
    return null;
  }
}

/**
 * Khối chèn vào ngữ cảnh. Câu rào "tham khảo" (học TencentDB l1-recall
 * injector): nội dung truy hồi/tra sẵn phải TỰ KHAI mức tin cậy — không có
 * dòng này model rẻ coi mục lục như trạng thái đơn hàng hiện tại, hoặc lấy
 * tên nhóm trả lời thay cho tra giá thật.
 */
export function khoiMucLucChoPrompt(mucLuc: string | null): string {
  if (!mucLuc) return '';
  return (
    '[DANH MỤC SẢN PHẨM của shop — THAM KHẢO để biết bên mình bán những dòng nào. ' +
    'KHÔNG phải trạng thái đơn hiện tại; giá/tồn/thông số vẫn phải tra tool như thường]\n' +
    mucLuc
  );
}
