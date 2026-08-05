/**
 * noi-zalo-that.e2e.ts — E2E ĐƯỜNG ĐI THẬT của một tin nhắn.
 *
 * Vì sao cần: các e2e cũ đều mock LLM, nên bug "lượt treo vĩnh viễn ở bước gọi
 * LLM" (05/08/2026) lọt qua hết. Test này gọi ĐÚNG hàm mà message-handler gọi
 * (`xuLyTinNhanVien`), với LLM THẬT + Odoo THẬT + DB THẬT — không mock gì.
 *
 * Nó khoá hai hợp đồng mà bug đã phá:
 *   1. Một lượt PHẢI kết thúc trong hạn giờ — treo vĩnh viễn là FAIL.
 *   2. Zalo PHẢI nhận được đúng một tin trả lời (hoặc tin báo lỗi) — im lặng là FAIL.
 *
 * Chạy:
 *   ODOO_URL=... ODOO_DB=... ODOO_USERNAME=... ODOO_PASSWORD=... \
 *   DATABASE_URL=... CO_DB_TEST=1 \
 *     npx vitest run --config vitest.e2e.config.ts tests/ai/agent/noi-zalo-that.e2e.ts
 *
 * KHÔNG gửi gì lên Zalo thật: `zaloOps.sendMessage` bị chặn và ghi lại.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Chặn TRƯỚC mọi import khác — module gửi Zalo được nạp ở tầng sâu.
const tinDaGui: Array<{ threadId: string; msg: string }> = [];
vi.mock('../../../src/shared/zalo-operations.js', () => ({
  zaloOps: {
    sendMessage: vi.fn(async (_acc: string, threadId: string, _t: number, m: { msg: string }) => {
      tinDaGui.push({ threadId, msg: m.msg });
    }),
    sendImage: vi.fn(async () => {}),
  },
}));

const { prisma } = await import('../../../src/shared/database/prisma-client.js');
const { xuLyTinNhanVien } = await import('../../../src/modules/ai/agent/noi-zalo/luong-nhan-vien.js');

const coDb = process.env.CO_DB_TEST === '1';
const duOdoo = Boolean(process.env.ODOO_URL && process.env.ODOO_DB
  && process.env.ODOO_USERNAME && process.env.ODOO_PASSWORD);

/** Hạn giờ test = hạn giờ agent + 15s biên. Vượt nghĩa là hàng rào hỏng. */
const HAN_TEST = (Number(process.env.AI_AGENT_HAN_GIO_MS) || 90_000) + 15_000;

let orgId = '';
let conversationId = '';
let messageId = '';
let accountId = '';
let contactId = '';

describe.skipIf(!coDb || !duOdoo)('E2E đường đi thật — tin nhân viên', () => {
  beforeAll(async () => {
    const org = await prisma.organization.findFirst({ select: { id: true } });
    if (!org) throw new Error('DB chưa có tổ chức nào — không chạy e2e được');
    orgId = org.id;

    // Bật đúng những công tắc luồng nhân viên cần.
    process.env.AI_AGENT_NHANVIEN = '1';

    const acc = await prisma.zaloAccount.findFirst({ where: { orgId }, select: { id: true } });
    if (!acc) throw new Error('DB chưa có tài khoản Zalo nào');
    accountId = acc.id;

    const ct = await prisma.contact.create({
      data: { orgId, zaloUid: `e2e-${Date.now()}`, fullName: 'E2E Test', phone: null },
      select: { id: true },
    });
    contactId = ct.id;

    const conv = await prisma.conversation.create({
      data: { orgId, zaloAccountId: accountId, contactId, threadType: 'user' },
      select: { id: true },
    });
    conversationId = conv.id;

    const msg = await prisma.message.create({
      data: {
        orgId, conversationId, senderType: 'self', content: '@bot chào',
        contentType: 'text', sentAt: new Date(),
      },
      select: { id: true },
    });
    messageId = msg.id;
  });

  afterAll(async () => {
    if (conversationId) {
      await prisma.message.deleteMany({ where: { conversationId } });
      await prisma.aiSuggestion.deleteMany({ where: { conversationId } });
      await prisma.conversation.deleteMany({ where: { id: conversationId } });
    }
    if (contactId) await prisma.contact.deleteMany({ where: { id: contactId } });
  });

  it(
    'một lượt KẾT THÚC trong hạn giờ và Zalo nhận được tin — treo/im lặng là FAIL',
    async () => {
      const t0 = Date.now();
      const daXuLy = await xuLyTinNhanVien({
        orgId,
        bizName: 'LEDNELIA',
        conversationId,
        messageId,
        content: '@bot chào',
        senderUid: null,
        isSelf: true,
      });
      const giay = (Date.now() - t0) / 1000;

      // eslint-disable-next-line no-console
      console.log(`\n  Lượt xong sau ${giay.toFixed(1)}s · daXuLy=${daXuLy} · ${tinDaGui.length} tin gửi đi`);
      for (const t of tinDaGui) {
        // eslint-disable-next-line no-console
        console.log(`  → "${t.msg.slice(0, 120)}"`);
      }

      // Hợp đồng 1: phải KẾT THÚC, không treo.
      expect(daXuLy).toBe(true);

      // Hợp đồng 2: Zalo phải nhận được ít nhất một tin — trả lời thật hoặc
      // báo lỗi. Im lặng hoàn toàn chính là bug gốc.
      expect(tinDaGui.length).toBeGreaterThan(0);
    },
    HAN_TEST,
  );
});
