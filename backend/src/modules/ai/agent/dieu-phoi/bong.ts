// SPDX-License-Identifier: AGPL-3.0-or-later
// CHẠY BÓNG (shadow) con điều phối trên CẢ HAI luồng — anh Quốc 27/08: "áp
// dụng cho cả luồng khách và nhân viên". Giai đoạn 1: chạy SONG SONG với
// đường trả lời hiện tại, chỉ ghi phiên + log để đo (trích đúng/thiếu gì, hỏi
// ô nào), KHÔNG đổi câu trả lời. Có số đo thật rồi mới cho nó cầm lái.
//
// Fire-and-forget: caller `void chayBongDieuPhoi(...)` — không await, không
// bao giờ làm chậm hay chặn tin gửi cho người chat.
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { taoGhiLog, type PrismaGhiLog } from '../ghi-log-tool.js';
import { dungGenerate } from '../noi-zalo/llm.js';
import type { ToolAwareGenerate } from '../types.js';
import { dieuPhoiPhien, TIMEOUT_DIEU_PHOI_MS, type DauVaoDieuPhoi } from './dieu-phoi.js';
import type { DepsKiemChung } from '../harness/tool-kiem-chung.js';
import { docPhienDon, luuPhienDon } from './kho-phien.js';
import { tomTatPhien, type PhienDon } from './phien-don.js';

/** Công tắc: AI_DIEU_PHOI=0 tắt hẳn; mặc định chạy bóng. */
export function dieuPhoiDangBat(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_DIEU_PHOI !== '0';
}

export interface VaoBong {
  orgId: string;
  conversationId: string;
  vai: PhienDon['vai'];
  cauMoi: string;
  lichSu: DauVaoDieuPhoi['lichSu'];
  /** Bot đã trả lời gì (để log so sánh câu bot hỏi với ô máy bảo phải hỏi). */
  botTraLoi?: string;
  nguCanh?: string;
  /**
   * Dùng lại hàm gọi model của chính lượt (cùng key/URL/ngân sách) — không
   * dựng thêm một dungGenerate: test ngân sách/khoá việc đếm đúng 1 lần dựng.
   */
  generate?: ToolAwareGenerate;
  /** Odoo chỉ-đọc cho vòng kiểm chứng (harness). */
  odoo?: DepsKiemChung['odoo'];
}

export async function chayBongDieuPhoi(vao: VaoBong): Promise<void> {
  if (!dieuPhoiDangBat()) return;
  const t0 = Date.now();
  try {
    const generate = vao.generate ?? (await dungGenerate(vao.orgId, Date.now() + 15_000));
    if (!generate) return;
    const phienCu = await docPhienDon(vao.conversationId, vao.vai);
    const kq = await dieuPhoiPhien(generate, {
      phien: phienCu, cauMoi: vao.cauMoi, lichSu: vao.lichSu, ...(vao.nguCanh ? { nguCanh: vao.nguCanh } : {}),
    }, TIMEOUT_DIEU_PHOI_MS, { odoo: vao.odoo });
    if (kq.nguon === 'llm') await luuPhienDon(vao.conversationId, kq.phien);
    taoGhiLog({ prisma: prisma as unknown as PrismaGhiLog, orgId: vao.orgId, vai: 'dieu_phoi', conversationId: vao.conversationId })({
      toolName: 'dieu_phoi',
      input: { vai: vao.vai, cauMoi: vao.cauMoi.slice(0, 300), botTraLoi: vao.botTraLoi?.slice(0, 500), phienCu: tomTatPhien(phienCu).slice(0, 800) },
      output: JSON.stringify({
        nguon: kq.nguon, ms: kq.ms, soVong: kq.soVong, yDinh: kq.yDinh, che: kq.phien.che, canHoi: kq.canHoi, duDeLenDon: kq.duDeLenDon,
        luuY: kq.luuY, lyDo: kq.lyDo, bangChung: (kq.bangChung ?? []).map((b) => ({ tool: b.tool, input: b.input, output: b.output.slice(0, 300) })),
        phien: tomTatPhien(kq.phien).slice(0, 1200),
      }),
      thanhCong: kq.nguon === 'llm',
      durationMs: Date.now() - t0,
      iteration: 0,
    });
    logger.info(
      { conversationId: vao.conversationId, vai: vao.vai, yDinh: kq.yDinh, che: kq.phien.che, canHoi: kq.canHoi.map((c) => c.o), ms: kq.ms, nguon: kq.nguon },
      '[dieu-phoi] bóng',
    );
  } catch (err) {
    logger.warn({ err, conversationId: vao.conversationId }, '[dieu-phoi] bóng lỗi (không ảnh hưởng trả lời)');
  }
}
