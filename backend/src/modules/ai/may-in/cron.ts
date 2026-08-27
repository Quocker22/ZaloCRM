// SPDX-License-Identifier: AGPL-3.0-or-later
// Cron MÁY IN — mỗi phút nhặt job trong print_jobs gửi ra máy in shop.
//
// Mẫu tu-soi: mutex lượt (lượt trước chưa xong thì bỏ lượt này), lỗi một lượt
// không giết cron. Mỗi phút là đủ: nhân viên bấm in xong ra máy in đứng đợi
// vài giây là bình thường ở shop; muốn nhanh hơn chỉnh AI_MAY_IN_CRON.
//
// Gate: không chọn được client nào (xem chonClientMayIn) → không bật gì cả.
import cron from 'node-cron';
import { logger } from '../../../shared/utils/logger.js';
import { prisma } from '../../../shared/database/prisma-client.js';
import { layAnhClient } from '../agent/noi-zalo/du-lieu.js';
import { AgentClient } from './agent-client.js';
import { agentRegistry } from './agent-registry.js';
import { IppClient } from './ipp-client.js';
import { agentConfigTuEnv, ippConfigTuEnv } from './tu-env.js';
import { chayMotLuotIn, tachReport, type ClientMayIn, type PrismaHangDoiIn } from './hang-doi-in.js';

let task: ReturnType<typeof cron.schedule> | null = null;
let dangChay = false;

/**
 * Chọn client máy in cho cron — hàm THUẦN (không đọc process.env trực tiếp,
 * nhận qua deps) để test được không cần dựng cron.schedule/DB/Odoo (Task 4).
 *
 * Thứ tự ưu tiên: AgentClient (kênh chính, đi qua PC-cầu-nối shop, không cần
 * mở cổng máy in ra Tailscale) → IppClient (fallback, gọi IPP thẳng qua env
 * cũ) → null (không bật cron — thiếu cấu hình = tắt hẳn, cùng triết lý mọi
 * nơi khác trong module này).
 *
 * VÌ SAO registry KHÔNG truyền qua deps mặc định mà import singleton: cron
 * và WS layer (agent-ws.ts, Task 3) PHẢI thấy chung một AgentRegistry để
 * cron thấy được agent đã đăng ký qua WS — xem chú thích ở agent-registry.ts.
 * Test vẫn ghi đè được qua deps.registry khi cần cô lập trạng thái.
 */
export function chonClientMayIn(
  deps: { env?: NodeJS.ProcessEnv; registry?: typeof agentRegistry } = {},
): ClientMayIn | null {
  const env = deps.env ?? process.env;
  const registry = deps.registry ?? agentRegistry;
  const agentCfg = agentConfigTuEnv(env);
  if (agentCfg) {
    const { orgId, ...cfg } = agentCfg;
    return new AgentClient(registry, orgId, cfg);
  }
  const ippCfg = ippConfigTuEnv(env);
  if (ippCfg) {
    return new IppClient(ippCfg);
  }
  return null;
}

export function startMayInCron(): void {
  if (task) return;
  const client = chonClientMayIn();
  if (!client) {
    logger.info('[may-in] chưa cấu hình AI_MAY_IN_AGENT_TOKEN lẫn AI_MAY_IN_IPP_URL — không bật cron in');
    return;
  }
  const anhClient = layAnhClient();
  if (!anhClient) {
    logger.warn('[may-in] có cấu hình máy in nhưng thiếu ODOO_URL — không tải được PDF, không bật cron');
    return;
  }
  const lich = process.env.AI_MAY_IN_CRON ?? '* * * * *';
  task = cron.schedule(lich, async () => {
    if (dangChay) return; // lượt trước chưa xong — máy in chậm là chuyện thường
    dangChay = true;
    try {
      await chayMotLuotIn({
        prisma: prisma as unknown as PrismaHangDoiIn,
        client,
        // Job KHÔNG GIÁ (26/08) mang đuôi #khong_gia trong cột report — tách
        // ra rồi truyền cờ để Odoo render bản ẩn giá (incokit_hide_price).
        taiPdf: (hoaDonId, report) => {
          const r = tachReport(report);
          return anhClient.taiPdf(hoaDonId, r.report, { khongGia: r.khongGia });
        },
        onLoi: (jobId, err) => logger.error({ err, jobId }, '[may-in] job lỗi'),
      });
    } catch (err) {
      logger.error({ err }, '[may-in] lượt in lỗi');
    } finally {
      dangChay = false;
    }
  });
  // VÌ SAO không log uri/token: AgentClient không có uri máy in (agent PC tự
  // biết), IppClient thì có nhưng không đáng tách riêng nhánh log — kenh đủ
  // để biết cron bật đường nào mà không rò rỉ token agent ra log.
  logger.info({ kenh: client instanceof AgentClient ? 'agent' : 'ipp', lich }, '[may-in] cron đã bật');
}

/** Cho test/shutdown: dừng và quên task. */
export function stopMayInCron(): void {
  task?.stop();
  task = null;
}
