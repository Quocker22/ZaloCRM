// SPDX-License-Identifier: AGPL-3.0-or-later
// NHÓM BOT PHỤ TRÁCH (docs/79 T6, 02/10) — trợ lý AI khách của CRM IM ở nhóm có chức năng trên trang Quyền bot.
//
// Vì sao: ở nhóm, trợ lý khách của CRM (luong-khach.ts) và đường khách của bot (Hermes, docs/79 T3) cùng nổ khi nick bị
// TAG — cùng một nick sẽ trả lời khách HAI lần, và lần của CRM có thể nói giá / gửi PDF (trái rào K3 "không giá"). Chủ
// chốt 02/10: nhóm bot đã xếp loại thì BOT trả lời, trợ lý CRM im.
//
// "Bot phụ trách" = nhóm có chức năng HIỆU LỰC (chủ xếp tường minh BotNhom, hoặc mặc định theo thành viên) — đọc bằng
// ĐÚNG hàm payload công khai /api/public/bot-quyen dùng (docCauHinhCongKhai), nên CRM im đúng những nhóm bot nhận. Mọi
// giá trị (khach/sales/kho/ke_toan/admin) đều tính: bot đang nghe nhóm đó.
//
// AN TOÀN: tra lỗi ⇒ IM ở nhóm (WARNING) — thà im một lượt còn hơn trả lời đôi. Tin riêng (DM) không bao giờ bị chặn ở
// đây (không tra). Nhóm chưa xếp loại ⇒ như cũ.
//
// Đệm 30 s theo org (cùng nhịp công tắc agent cong-tac.ts): đường RAG gọi cổng này ở MỌI tin nhóm khi auto-reply bật.
// Chỉ đệm bản đọc THÀNH CÔNG. Nhóm vừa xếp loại ⇒ tối đa 30 s CRM còn nói — bridge của bot cũng poll ~60 s.
//
// Lý do bỏ qua ghi log dạng `ai_khach_bo_qua: <lý do>` + đếm theo org trong tiến trình (trang Bản đồ tin › CRM tự động
// hiện số đếm — bot-crm-tu-dong.ts).
import { logger } from '../../shared/utils/logger.js';
import { docCauHinhCongKhai, type CauHinhCongKhai } from './bot-quyen-cong-khai.js';

export const TTL_NHOM_BOT_MS = 30_000;

export type LyDoAiKhachBoQua = 'nhom_do_bot_phu_trach' | 'tra_cuu_loi';

export interface PhuThuocNhomBot {
  doc?: (orgId: string) => Promise<CauHinhCongKhai>;
  bayGio?: () => number;
}

const dem = new Map<string, Record<LyDoAiKhachBoQua, number>>();
const boNhoNhom = new Map<string, { luc: number; nhom: Map<string, string> }>();

/** Chức năng HIỆU LỰC của nhóm (null = chưa xếp loại ⇒ bot im nhóm đó). Lỗi tra NÉM ra — caller quyết. */
export async function chucNangHieuLucCuaNhom(
  orgId: string, conversationId: string, pt: PhuThuocNhomBot = {},
): Promise<string | null> {
  const bayGio = (pt.bayGio ?? Date.now)();
  const cu = boNhoNhom.get(orgId);
  if (cu && bayGio - cu.luc < TTL_NHOM_BOT_MS) return cu.nhom.get(conversationId) ?? null;
  const ch = await (pt.doc ?? docCauHinhCongKhai)(orgId);
  const nhom = new Map(ch.nhom.map((n) => [n.conversation_id, n.chuc_nang]));
  boNhoNhom.set(orgId, { luc: bayGio, nhom });
  return nhom.get(conversationId) ?? null;
}

function tang(orgId: string, lyDo: LyDoAiKhachBoQua): void {
  const d = dem.get(orgId) ?? { nhom_do_bot_phu_trach: 0, tra_cuu_loi: 0 };
  d[lyDo]++;
  dem.set(orgId, d);
}

/**
 * Cổng của MỌI đường CRM tự trả lời khách (agent khách, RAG auto-reply, câu báo ảnh hỏng, chào nhóm): true ⇒ PHẢI IM.
 * `duong` = tên đường gọi (ghi vào log để biết ai bị chặn).
 */
export async function aiKhachPhaiImONhom(
  ctx: { orgId: string; conversationId: string; laNhom: boolean; duong: string },
  pt: PhuThuocNhomBot = {},
): Promise<boolean> {
  if (!ctx.laNhom) return false;
  try {
    const chucNang = await chucNangHieuLucCuaNhom(ctx.orgId, ctx.conversationId, pt);
    if (!chucNang) return false;
    tang(ctx.orgId, 'nhom_do_bot_phu_trach');
    logger.info(
      { ai_khach_bo_qua: 'nhom_do_bot_phu_trach', duong: ctx.duong, conversationId: ctx.conversationId, chucNang },
      `[ai/khach] ai_khach_bo_qua: nhom_do_bot_phu_trach — nhóm có chức năng "${chucNang}" trên trang Quyền bot, bot trả lời`,
    );
    return true;
  } catch (err) {
    tang(ctx.orgId, 'tra_cuu_loi');
    logger.warn(
      { err, ai_khach_bo_qua: 'tra_cuu_loi', duong: ctx.duong, conversationId: ctx.conversationId },
      '[ai/khach] ai_khach_bo_qua: tra_cuu_loi — không tra được nhóm bot phụ trách, IM ở nhóm cho an toàn',
    );
    return true;
  }
}

/** Số tin trợ lý CRM đã bỏ qua theo lý do (tiến trình hiện tại, từ lúc máy chủ chạy). */
export function demAiKhachBoQua(orgId: string): Record<LyDoAiKhachBoQua, number> {
  return { ...(dem.get(orgId) ?? { nhom_do_bot_phu_trach: 0, tra_cuu_loi: 0 }) };
}

export function _xoaChoTest(): void {
  dem.clear();
  boNhoNhom.clear();
}
