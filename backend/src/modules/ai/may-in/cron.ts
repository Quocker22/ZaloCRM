// SPDX-License-Identifier: AGPL-3.0-or-later
// Cron MÁY IN — mỗi phút nhặt job trong print_jobs gửi ra máy in shop.
//
// Mẫu tu-soi: mutex lượt (lượt trước chưa xong thì bỏ lượt này), lỗi một lượt
// không giết cron. Mỗi phút là đủ: nhân viên bấm in xong ra máy in đứng đợi
// vài giây là bình thường ở shop; muốn nhanh hơn chỉnh AI_MAY_IN_CRON.
//
// Gate: chưa đặt AI_MAY_IN_IPP_URL → không bật gì cả (cùng biến với tool).
import cron from 'node-cron';
import { logger } from '../../../shared/utils/logger.js';
import { prisma } from '../../../shared/database/prisma-client.js';
import { layAnhClient } from '../agent/noi-zalo/du-lieu.js';
import { IppClient } from './ipp-client.js';
import { ippConfigTuEnv } from './tu-env.js';
import { chayMotLuotIn, type PrismaHangDoiIn } from './hang-doi-in.js';

let task: ReturnType<typeof cron.schedule> | null = null;
let dangChay = false;

export function startMayInCron(): void {
  if (task) return;
  const cfg = ippConfigTuEnv();
  if (!cfg) {
    logger.info('[may-in] AI_MAY_IN_IPP_URL chưa đặt — không bật cron in');
    return;
  }
  const anhClient = layAnhClient();
  if (!anhClient) {
    logger.warn('[may-in] có AI_MAY_IN_IPP_URL nhưng thiếu ODOO_URL — không tải được PDF, không bật cron');
    return;
  }
  const client = new IppClient(cfg);
  const lich = process.env.AI_MAY_IN_CRON ?? '* * * * *';
  task = cron.schedule(lich, async () => {
    if (dangChay) return; // lượt trước chưa xong — máy in chậm là chuyện thường
    dangChay = true;
    try {
      await chayMotLuotIn({
        prisma: prisma as unknown as PrismaHangDoiIn,
        client,
        taiPdf: (hoaDonId, report) => anhClient.taiPdf(hoaDonId, report),
        onLoi: (jobId, err) => logger.error({ err, jobId }, '[may-in] job lỗi'),
      });
    } catch (err) {
      logger.error({ err }, '[may-in] lượt in lỗi');
    } finally {
      dangChay = false;
    }
  });
  logger.info({ uri: cfg.uri, lich }, '[may-in] cron đã bật');
}

/** Cho test/shutdown: dừng và quên task. */
export function stopMayInCron(): void {
  task?.stop();
  task = null;
}
