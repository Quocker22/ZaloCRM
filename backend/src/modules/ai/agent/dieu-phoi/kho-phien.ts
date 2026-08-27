// SPDX-License-Identifier: AGPL-3.0-or-later
// KHO PHIÊN ĐƠN — Redis (TTL) với dự phòng trong bộ nhớ. Không thêm bảng DB:
// phiên là thứ sống 30 phút, mất thì dựng lại từ lịch sử chat, không phải
// dữ liệu phải bảo toàn (khác đơn Odoo).
import { getRedis } from '../../../../shared/redis-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { type PhienDon, phienTrong } from './phien-don.js';

export const HAN_PHIEN_DON_GIAY = 30 * 60;
const trongBoNho = new Map<string, { phien: PhienDon; hetHan: number }>();

function khoa(conversationId: string): string {
  return `dieu-phoi:phien:${conversationId}`;
}

export async function docPhienDon(conversationId: string, vai: PhienDon['vai']): Promise<PhienDon> {
  try {
    const redis = await getRedis();
    if (redis) {
      const raw = await redis.get(khoa(conversationId));
      if (raw) {
        const p = JSON.parse(raw) as PhienDon;
        if (p && Array.isArray(p.dong)) return { ...p, vai };
      }
      return phienTrong(vai);
    }
  } catch (err) {
    logger.warn({ err, conversationId }, '[dieu-phoi] đọc phiên lỗi — dùng phiên trống');
  }
  const m = trongBoNho.get(conversationId);
  if (m && m.hetHan > Date.now()) return { ...m.phien, vai };
  return phienTrong(vai);
}

export async function luuPhienDon(conversationId: string, phien: PhienDon): Promise<void> {
  try {
    const redis = await getRedis();
    if (redis) {
      await redis.set(khoa(conversationId), JSON.stringify(phien), 'EX', HAN_PHIEN_DON_GIAY);
      return;
    }
  } catch (err) {
    logger.warn({ err, conversationId }, '[dieu-phoi] lưu phiên lỗi — giữ trong bộ nhớ');
  }
  trongBoNho.set(conversationId, { phien, hetHan: Date.now() + HAN_PHIEN_DON_GIAY * 1000 });
}

export async function xoaPhienDon(conversationId: string): Promise<void> {
  trongBoNho.delete(conversationId);
  try {
    const redis = await getRedis();
    if (redis) await redis.del(khoa(conversationId));
  } catch (err) {
    logger.warn({ err, conversationId }, '[dieu-phoi] xoá phiên lỗi');
  }
}
