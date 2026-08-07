// SPDX-License-Identifier: AGPL-3.0-or-later
// Đọc/ghi phiên gom đơn (bảng phien_gom_don). TTL 15 phút: NV bỏ ngang thì
// phiên tự chết, không dính vĩnh viễn vào hội thoại làm mọi tin sau lạc vào máy.
//
// Nhận prisma dạng CẤU TRÚC tối thiểu (như PrismaGhiLog) thay vì
// Pick<PrismaClient,…>: client thật của app là bản $extends nên kiểu generic
// của Prisma không gán được, còn test thì mock bằng object thường.
import type { PhienGom } from './kieu.js';

export const HAN_PHIEN_PHUT = 15;

/** Dòng phien_gom_don tối thiểu mà store cần đọc. */
interface HangPhien {
  orgId: string;
  conversationId: string;
  slots: unknown;
  hetHan: Date;
}

export interface DbPhienGomDon {
  phienGomDon: {
    findUnique(a: { where: { conversationId: string } }): Promise<HangPhien | null>;
    upsert(a: {
      where: { conversationId: string };
      create: HangPhien;
      update: { slots: unknown; hetHan: Date };
    }): Promise<unknown>;
    deleteMany(a: { where: { conversationId: string } }): Promise<unknown>;
  };
}

type Db = DbPhienGomDon;

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
  // PhienGom → Json: serialize qua JSON để chắc chắn thuần dữ liệu.
  const slots = JSON.parse(JSON.stringify(input.phien)) as unknown;
  await db.phienGomDon.upsert({
    where: { conversationId: input.conversationId },
    create: { orgId: input.orgId, conversationId: input.conversationId, slots, hetHan },
    update: { slots, hetHan },
  });
}

export async function xoaPhien(db: Db, conversationId: string): Promise<void> {
  await db.phienGomDon.deleteMany({ where: { conversationId } });
}
