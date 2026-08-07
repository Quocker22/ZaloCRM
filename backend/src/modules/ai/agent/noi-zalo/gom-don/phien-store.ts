// SPDX-License-Identifier: AGPL-3.0-or-later
// Đọc/ghi phiên gom đơn (bảng phien_gom_don). TTL 15 phút: NV bỏ ngang thì
// phiên tự chết, không dính vĩnh viễn vào hội thoại làm mọi tin sau lạc vào máy.
//
// Nhận prisma dạng hẹp (chỉ delegate phienGomDon) để test mock bằng object thường.
import type { PrismaClient } from '@prisma/client';
import type { PhienGom } from './kieu.js';

export const HAN_PHIEN_PHUT = 15;

type Db = Pick<PrismaClient, 'phienGomDon'>;

/** Phiên còn hạn của hội thoại — quá hạn thì dọn luôn và trả null. */
export async function docPhien(db: Db, conversationId: string): Promise<PhienGom | null> {
  const row = await db.phienGomDon.findUnique({ where: { conversationId } });
  if (!row) return null;
  if (row.hetHan < new Date()) {
    await db.phienGomDon.deleteMany({ where: { conversationId } });
    return null;
  }
  return row.slots as unknown as PhienGom;
}

export async function luuPhien(
  db: Db,
  input: { orgId: string; conversationId: string; phien: PhienGom },
): Promise<void> {
  const hetHan = new Date(Date.now() + HAN_PHIEN_PHUT * 60_000);
  const slots = input.phien as unknown as never; // PhienGom → Json: chỉ code gom-don đọc lại
  await db.phienGomDon.upsert({
    where: { conversationId: input.conversationId },
    create: { orgId: input.orgId, conversationId: input.conversationId, slots, hetHan },
    update: { slots, hetHan },
  });
}

export async function xoaPhien(db: Db, conversationId: string): Promise<void> {
  await db.phienGomDon.deleteMany({ where: { conversationId } });
}
