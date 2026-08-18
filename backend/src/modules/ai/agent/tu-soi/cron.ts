// SPDX-License-Identifier: AGPL-3.0-or-later
// Cron TỰ SOI — 10 phút một lượt, mỗi lượt quét tối đa 20 hội thoại đã nguội.
//
// Vì sao 10' mà không phải 1': hội thoại phải im 15' mới được soi, nên quét
// dày hơn chỉ tốn query chứ không sớm hơn được. Mutex: lượt trước chưa xong
// thì bỏ lượt này (mẫu bulk-campaign-cron).
import cron from 'node-cron';
import { logger } from '../../../../shared/utils/logger.js';
import { chayLuotTuSoi } from './chay-tu-soi.js';

let task: ReturnType<typeof cron.schedule> | null = null;
let dangChay = false;

export function startTuSoiCron(): void {
  if (task) return;
  task = cron.schedule('*/10 * * * *', async () => {
    if (dangChay) { logger.info('[tu-soi] lượt trước chưa xong — bỏ lượt này'); return; }
    dangChay = true;
    try {
      await chayLuotTuSoi();
    } catch (err) {
      logger.error({ err }, '[tu-soi] lượt quét lỗi');
    } finally {
      dangChay = false;
    }
  });
  logger.info('[tu-soi] cron đã bật (*/10 phút)');
}
