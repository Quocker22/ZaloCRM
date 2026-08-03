// SPDX-License-Identifier: AGPL-3.0-or-later
// Cầu nối Zalo (server prod) ↔ agent + Odoo (máy local).
//
// VÌ SAO CHẠY LOCAL THAY VÌ TRÊN SERVER (đo thật 2026-08-03):
//   Server prod KHÔNG gọi được Odoo local — ping 100% mất gói, dù chiều ngược
//   lại thông (149ms qua DERP). Tailscale ACL chặn một chiều vì hai máy khác
//   chủ (`vietquoc.dev` vs `xuanhungptit`).
//   Chạy bot ở đây thì Odoo nằm ngay cạnh, và chiều local→server vẫn gọi được.
//
// LUỒNG (KÉO, không phải webhook):
//   Nhân viên gõ "@bot ..." trên Zalo
//     → cầu nối này KÉO tin mới qua GET /api/public/conversations/:id/messages
//     → chạy agent (Odoo local)
//     → gửi trả lời qua POST /api/public/messages/send
//
// VÌ SAO KÉO CHỨ KHÔNG WEBHOOK (đo thật 2026-08-03): webhook đòi server prod
// gọi ngược về máy này, mà (1) prod nằm tailnet KHÁC (`tail36e8a` vs
// `tailf1230d`) nên chỉ thấy nhau qua node chia sẻ một chiều, và (2)
// `assertSafeOutboundUrl` bắt buộc HTTPS — máy dev không có chứng chỉ hợp lệ.
// Chiều local→prod thì luôn thông, nên kéo là đường duy nhất chạy được.
//
// CHỈ LUỒNG NHÂN VIÊN (anh chốt 2026-08-03): khách vẫn đi luồng RAG cũ trên
// server, không bị ảnh hưởng. Bot mới chỉ phản hồi tin có tag @bot.
//
// CHẠY:
//   PROD_URL=http://100.107.48.28:3000 PROD_API_KEY=... \
//   ODOO_URL=http://localhost:8069 ODOO_DB=nelia_prod \
//   ODOO_USERNAME=bot_zalo ODOO_PASSWORD=<mật khẩu bot_zalo> \
//   LLM_BASE=... LLM_KEY=... LLM_MODEL=... \
//     npx tsx --env-file-if-exists=.env scripts/cau-noi-zalo.ts
//
// PROD_API_KEY lấy ở giao diện CRM: Cài đặt → API & Webhook → Public API key.

import { OdooClient } from '../src/modules/ai/odoo/client.js';
import { HoaDonAnhClient } from '../src/modules/ai/odoo/hoa-don-anh.js';
import { chayLenhNhanVien, type ToolCallLog } from '../src/modules/ai/agent/staff-agent.js';
import { nhanDienLenhNhanVien } from '../src/modules/ai/agent/staff-command.js';
import { taoGhiLog } from '../src/modules/ai/agent/ghi-log-tool.js';
import { generateWithOpenaiCompatTools } from '../src/modules/ai/providers/openai-compat.js';
import { searchKnowledge } from '../src/modules/ai/knowledge/knowledge-service.js';
import { generateEmbedding } from '../src/modules/ai/knowledge/embedding.js';
import type { ToolAwareGenerate } from '../src/modules/ai/agent/types.js';

const PROD_URL = process.env.PROD_URL ?? 'http://100.107.48.28:3000';
const PROD_API_KEY = process.env.PROD_API_KEY ?? '';
const BIZ = process.env.BIZ_NAME ?? 'LEDNELIA - shop đèn LED & phụ kiện điện';
/** Nhịp kéo. 3s: nhân viên chờ được, mà một ngày cũng chỉ ~28k request. */
const NHIP_MS = Number(process.env.CAU_NOI_NHIP_MS ?? 3000);
/** Số hội thoại kéo mỗi vòng, ưu tiên hoạt động gần nhất. */
const SO_HOI_THOAI = Number(process.env.CAU_NOI_SO_HOI_THOAI ?? 30);

// KHÔNG chạy bằng `admin`. Đo thật 2026-08-03 với user `bot_zalo` (group_staff):
//   - `standard_price` bị Odoo CHẶN ở tầng quyền, không chỉ lọc trong code.
//   - Báo cáo bán hàng tự bỏ tab `by_profit` (cột cost/profit) — admin thì thấy.
// Hàng rào nằm ở Odoo nên prompt có bị lèo lái cũng không lấy được giá vốn.
const VAI_CANH_BAO = 'admin';

for (const k of ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_PASSWORD', 'LLM_BASE', 'LLM_KEY', 'LLM_MODEL']) {
  if (!process.env[k]) {
    console.error(`Thiếu biến môi trường: ${k}`);
    process.exit(1);
  }
}
if (!PROD_API_KEY) {
  console.error('Thiếu PROD_API_KEY — lấy từ AppSetting `public_api_key` trên server prod.');
  process.exit(1);
}

const odoo = new OdooClient({
  url: process.env.ODOO_URL!, db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!, password: process.env.ODOO_PASSWORD!,
});
const anhClient = new HoaDonAnhClient({
  url: process.env.ODOO_URL!, db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!, password: process.env.ODOO_PASSWORD!,
});

/**
 * Hạn chờ LLM. Mặc định để provider tự quyết (12→20→30→40s, hợp với 9router).
 *
 * Model *reasoning* chạy local (qwen3) sinh cả khối `<think>` trước khi gọi
 * tool — đo thật thì vượt 40s với prompt nhân viên đầy đủ 11 tool, nên phải
 * nới bằng LLM_TIMEOUT_MS khi thử với Ollama.
 */
const LLM_TIMEOUT_MS = process.env.LLM_TIMEOUT_MS ? Number(process.env.LLM_TIMEOUT_MS) : undefined;

const generate: ToolAwareGenerate = (a) =>
  generateWithOpenaiCompatTools({
    url: `${process.env.LLM_BASE}/chat/completions`,
    apiKey: process.env.LLM_KEY!, model: process.env.LLM_MODEL!,
    ...(LLM_TIMEOUT_MS ? { timeoutMs: LLM_TIMEOUT_MS } : {}),
    ...a,
  });

/** Tra tài liệu kỹ thuật — nạp trễ, thiếu DB thì tool không đăng ký. */
let timDoanTriThuc:
  | ((q: string, k: number) => Promise<Array<{ content: string; score?: number }>>)
  | undefined;

/**
 * orgId của DB LOCAL — dùng cho tri thức và nhật ký tool.
 *
 * KHÔNG phải org trên prod. Log ghi ở máy này để chẩn đoán, còn `conversationId`
 * đi kèm là id của prod: đối chiếu được với CRM nhưng không join được bằng SQL.
 */
let orgId: string | null = null;

async function batTriThuc(): Promise<string> {
  if (!process.env.DATABASE_URL) return 'tắt (thiếu DATABASE_URL)';
  try {
    const { prisma } = await import('../src/shared/database/prisma-client.js');
    const org = await prisma.organization.findFirst({ select: { id: true } });
    if (!org) return 'tắt (chưa có tổ chức)';
    orgId = org.id;
    const n = await prisma.knowledgeChunk.count({ where: { orgId: org.id } });
    if (n === 0) return 'tắt (chưa nạp tài liệu)';
    const cfg = {
      provider: process.env.EMBED_PROVIDER ?? 'local',
      model: process.env.EMBED_MODEL ?? 'bge-m3',
      baseUrl: process.env.EMBED_BASE_URL ?? 'http://localhost:11434/v1',
    };
    timDoanTriThuc = async (q, k) =>
      (await searchKnowledge({ prisma, embed: generateEmbedding } as never, org.id, q, k, cfg))
        .map((h) => ({ content: h.content, score: h.score }));
    return `${n} chunk`;
  } catch (err) {
    return `tắt (${err instanceof Error ? err.message.slice(0, 50) : 'lỗi'})`;
  }
}

/**
 * Đếm lượt theo hội thoại — thành phần khoá chống trùng đơn.
 *
 * Chỉ giữ trong bộ nhớ: khởi động lại là mất, và cùng một lệnh gửi lại sẽ tạo
 * đơn MỚI thay vì trùng khoá. Chấp nhận được khi đang thử; lên production thật
 * thì `seq` phải lấy từ DB (đếm số lệnh đã xử lý của hội thoại đó).
 */
const demLuot = new Map<string, number>();

/** Chống xử lý lại cùng một tin khi webhook gửi trùng. */
const daXuLy = new Set<string>();

/**
 * Đích gửi tin, ghi lại khi kéo danh sách hội thoại.
 *
 * `/messages/send` cần `zaloAccountId` + `threadId`, nhưng tin nhắn chỉ cho
 * `conversationId`. KHÔNG tra được qua Prisma: DB local là bản dev (`zalocrm`
 * @ :5433), còn hội thoại nằm trong DB prod — id không tồn tại ở đây. Nên lấy
 * thẳng từ API prod lúc quét.
 *
 * Hội thoại 1-1 dùng `contact.zaloUid`; group mới có `externalThreadId`.
 */
const dichGui = new Map<string, { zaloAccountId: string; threadId: string; threadType: string }>();

function ghiNhoDich(ht: HoiThoaiProd): void {
  const threadId = ht.externalThreadId ?? ht.contact?.zaloUid;
  if (!ht.zaloAccountId || !threadId) return;
  dichGui.set(ht.id, {
    zaloAccountId: ht.zaloAccountId,
    threadId,
    threadType: ht.threadType ?? 'user',
  });
}

async function guiTin(conversationId: string, noiDung: string): Promise<boolean> {
  const dich = dichGui.get(conversationId);
  if (!dich) {
    console.error(`  thiếu zaloAccountId/threadId cho hội thoại ${conversationId}`);
    console.error('  → server prod cần bản public-api-routes.ts mới (trả thêm 2 trường này).');
    return false;
  }
  try {
    const res = await fetch(`${PROD_URL}/api/public/messages/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': PROD_API_KEY },
      body: JSON.stringify({
        zaloAccountId: dich.zaloAccountId,
        threadId: dich.threadId,
        threadType: dich.threadType,
        content: noiDung,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`  gửi thất bại ${res.status}: ${(await res.text()).slice(0, 120)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('  gửi lỗi:', err instanceof Error ? err.message : err);
    return false;
  }
}

async function xuLyTin(data: Record<string, unknown>): Promise<void> {
  const conversationId = String(data.conversationId ?? '');
  const content = String(data.content ?? '');
  const messageId = String(data.messageId ?? '');
  if (!conversationId || !content) return;

  // Hai vòng kéo có thể chồng lấn ở ranh giới mốc thời gian — chặn trùng để
  // không tạo hai đơn từ cùng một lệnh.
  if (messageId && daXuLy.has(messageId)) return;
  if (messageId) {
    daXuLy.add(messageId);
    // Giữ 500 id gần nhất, đủ chống trùng mà không phình bộ nhớ.
    if (daXuLy.size > 500) daXuLy.delete(daXuLy.values().next().value as string);
  }

  // CỔNG RẺ: không tag @bot thì không gọi LLM. Kiểm ở đây thay vì để agent tự
  // lọc — tiết kiệm một vòng dựng registry cho mọi tin nhân viên gửi khách.
  if (!nhanDienLenhNhanVien({ content, isSelf: true })) return;

  const seq = (demLuot.get(conversationId) ?? 0) + 1;
  demLuot.set(conversationId, seq);

  const t0 = Date.now();
  console.log(`\n[${new Date().toLocaleTimeString('vi-VN')}] ${content.slice(0, 70)}`);

  const log: ToolCallLog[] = [];
  // Ghi xuống DB LOCAL để chẩn đoán, đồng thời giữ trong mảng để in ra terminal.
  const ghiDb = orgId
    ? taoGhiLog({
        prisma: (await import('../src/shared/database/prisma-client.js')).prisma,
        orgId, vai: 'nhanvien', conversationId,
        onError: (e) => { console.error('  ghi log lỗi:', e instanceof Error ? e.message : e); },
      })
    : null;

  try {
    const r = await chayLenhNhanVien(
      {
        odoo, generate,
        ghiNhanChuyenSale: async (yc) => { console.log(`  → chuyển sale: ${yc.lyDo}`); },
        ghiLog: (l) => { log.push(l); ghiDb?.(l); },
        anhClient, odooUrl: process.env.ODOO_URL!,
        timDoanTriThuc,
      },
      { bizName: BIZ, conversationId, seq, message: { content, isSelf: true } },
    );

    const giay = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  tool: ${log.map((l) => l.toolName).join(' → ') || '(không)'} | ${giay}s`);

    if (r.trangThai === 'xong') {
      console.log(`  trả lời: ${r.traLoi.slice(0, 100)}`);
      await guiTin(conversationId, r.traLoi);
      // Hóa đơn: API public hiện chỉ gửi TEXT, chưa nhận ảnh. Gửi link để nhân
      // viên bấm vào xem — thà vậy còn hơn im lặng.
      if (r.hoaDon) {
        await guiTin(conversationId, `Hóa đơn ${r.hoaDon.maDon}: ${r.hoaDon.link}`);
      }
    } else if (r.trangThai === 'chua_hoan_tat') {
      // Câu dở dang KHÔNG gửi cho khách — báo nhân viên tự xử.
      console.log(`  CHƯA XONG: ${r.lyDo}`);
      await guiTin(conversationId, `Bot chưa xử lý xong (${r.lyDo}). Anh/chị xử lý giúp nhé.`);
    }
  } catch (err) {
    console.error('  LỖI:', err instanceof Error ? err.message : err);
  }
}

/** Gọi API prod, trả null nếu hỏng (vòng kéo phải sống qua mọi trục trặc mạng). */
async function goiProd<T>(duong: string): Promise<T | null> {
  try {
    const res = await fetch(`${PROD_URL}${duong}`, {
      headers: { 'x-api-key': PROD_API_KEY },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error(`  GET ${duong} → ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`  GET ${duong} lỗi:`, err instanceof Error ? err.message : err);
    return null;
  }
}

interface HoiThoaiProd {
  id: string;
  threadType?: string;
  externalThreadId?: string | null;
  zaloAccountId?: string;
  lastMessageAt: string | null;
  contact?: { zaloUid?: string | null } | null;
}

interface TinProd {
  id: string;
  senderType: string;
  content: string | null;
  contentType: string | null;
  sentAt: string;
}

/**
 * Mốc thời gian đã quét, theo hội thoại.
 *
 * Vòng ĐẦU TIÊN chỉ ghi mốc mà KHÔNG xử lý: nếu không, bot khởi động lại sẽ
 * chạy lại mọi lệnh "@bot lên đơn" cũ trong lịch sử và tạo hàng loạt đơn trùng.
 */
const mocQuet = new Map<string, number>();

async function quetMotVong(): Promise<void> {
  const dsHt = await goiProd<{ conversations: HoiThoaiProd[] }>(
    `/api/public/conversations?limit=${SO_HOI_THOAI}`,
  );
  if (!dsHt) return;

  for (const ht of dsHt.conversations) {
    ghiNhoDich(ht);
    // Không có tin mới hơn mốc thì bỏ qua — tránh gọi API cho hội thoại tĩnh.
    const moc = mocQuet.get(ht.id);
    const lan = ht.lastMessageAt ? Date.parse(ht.lastMessageAt) : 0;
    if (moc !== undefined && lan <= moc) continue;

    const kq = await goiProd<{ messages: TinProd[] }>(
      `/api/public/conversations/${ht.id}/messages?limit=20`,
    );
    if (!kq) continue;

    const lanMoi = Math.max(moc ?? 0, ...kq.messages.map((m) => Date.parse(m.sentAt) || 0));

    // Lần đầu thấy hội thoại: chỉ ghi mốc, KHÔNG xử lý lịch sử.
    if (moc === undefined) {
      mocQuet.set(ht.id, lanMoi);
      continue;
    }
    mocQuet.set(ht.id, lanMoi);

    // API trả mới→cũ; đảo lại để xử lý đúng thứ tự nhân viên gõ.
    const moi = kq.messages
      .filter((m) => (Date.parse(m.sentAt) || 0) > moc)
      .filter((m) => m.senderType === 'self' && m.contentType === 'text' && m.content)
      .reverse();

    for (const m of moi) {
      await xuLyTin({ conversationId: ht.id, content: m.content!, messageId: m.id });
    }
  }
}

async function vongKeo(): Promise<never> {
  for (;;) {
    try {
      await quetMotVong();
    } catch (err) {
      console.error('vòng kéo lỗi:', err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, NHIP_MS));
  }
}

odoo.authenticate()
  .then(async () => {
    if (process.env.ODOO_USERNAME === VAI_CANH_BAO) {
      console.warn('\n  CẢNH BÁO: đang chạy bằng `admin` — bot ĐỌC ĐƯỢC giá vốn.');
      console.warn('  Dùng ODOO_USERNAME=bot_zalo để Odoo tự chặn.\n');
    }
    const triThuc = await batTriThuc();
    {
      console.log(`\n  Cầu nối Zalo ↔ agent (chế độ KÉO)`);
      console.log(`  Prod             : ${PROD_URL} — kéo mỗi ${NHIP_MS}ms`);
      console.log(`  Odoo             : ${process.env.ODOO_DB} @ ${process.env.ODOO_URL} (${process.env.ODOO_USERNAME})`);
      console.log(`  Tri thức         : ${triThuc}`);
      console.log(`  LLM              : ${process.env.LLM_MODEL}`);
      console.log(`\n  CHỈ xử lý tin NHÂN VIÊN có tag @bot. Khách đi luồng cũ.\n`);
    }
    await vongKeo();
  })
  .catch((err) => {
    console.error('Không kết nối được Odoo:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
