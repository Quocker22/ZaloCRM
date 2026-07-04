// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * bulk-campaign-service.ts — Community bulk friend-request / message over a CustomerList.
 *
 * Design: STATELESS. There is no BulkCampaign table — campaign "state" is derived from
 * existing rows (friendship_attempts) so no migration is needed and it can never drift:
 *   - A "campaign" = (customerList × nick × message).
 *   - Eligible    = contacts whose phone is in the list, have a phone, not yet attempted
 *                   by this nick, consent not revoked.
 *   - Progress    = friendship_attempts for those contacts (state sent/accepted/no_zalo/error).
 *   - Run a batch = pick next N eligible → attemptFriendRequest each, throttled, respecting
 *                   the nick's daily cap (zalo_accounts.daily_friend_add_cap).
 *
 * Contacts join CustomerListEntry by phone: contact.phoneNormalized is "84…"; entry stores
 * phoneE164 "+84…" and phoneLocal "0…". We match on either.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { attemptFriendRequest } from './campaign-service.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { getCampaignCatalogs } from './catalog-image.js';
import { generateEmbedding } from '../ai/knowledge/embedding.js';
import { searchKnowledge, type IngestDeps } from '../ai/knowledge/knowledge-service.js';
import { humanPace } from '../ai/knowledge/human-pace.js';
import { logger } from '../../shared/utils/logger.js';

export interface BulkStats {
  listId: string;
  listName: string;
  totalInList: number;   // contacts in CRM matched to this list (have a phone)
  eligible: number;      // not yet attempted by this nick
  attempted: number;     // attempted (any state) by this nick
  accepted: number;      // already friends
  noZalo: number;        // phone confirmed to have no Zalo
  pending: number;       // sent, waiting for accept
  errored: number;
  dailyCap: number;      // friend-add cap of this nick
  sentToday: number;     // friend-requests this nick already sent today
}

// One raw query computes every counter for the (list × nick) pair.
export async function getBulkStats(orgId: string, listId: string, zaloAccountId: string): Promise<BulkStats | null> {
  const list = await prisma.customerList.findFirst({ where: { id: listId, orgId }, select: { id: true, name: true } });
  if (!list) return null;

  const acct = await prisma.zaloAccount.findFirst({ where: { id: zaloAccountId, orgId }, select: { dailyFriendAddCap: true } });
  const dailyCap = acct?.dailyFriendAddCap ?? 30;

  const rows = await prisma.$queryRaw<Array<{
    total: bigint; attempted: bigint; accepted: bigint; no_zalo: bigint; pending: bigint; errored: bigint;
  }>>`
    WITH list_contacts AS (
      SELECT DISTINCT c.id
        FROM contacts c
        JOIN customer_list_entries e ON e.customer_list_id = ${listId}
         AND (('+' || c.phone_normalized) = e.phone_e164 OR c.phone_normalized = e.phone_local OR c.phone = e.phone_local)
       WHERE c.org_id = ${orgId} AND c.merged_into IS NULL
         AND (c.phone_normalized IS NOT NULL OR c.phone IS NOT NULL)
    ),
    att AS (
      SELECT lc.id, fa.state
        FROM list_contacts lc
        LEFT JOIN friendship_attempts fa ON fa.contact_id = lc.id AND fa.zalo_account_id = ${zaloAccountId}
    )
    SELECT
      COUNT(*)                                            AS total,
      COUNT(*) FILTER (WHERE state IS NOT NULL)           AS attempted,
      COUNT(*) FILTER (WHERE state = 'accepted')          AS accepted,
      COUNT(*) FILTER (WHERE state = 'no_zalo')           AS no_zalo,
      COUNT(*) FILTER (WHERE state = 'sent')              AS pending,
      COUNT(*) FILTER (WHERE state = 'error')             AS errored
    FROM att
  `;
  const r = rows[0];
  const total = Number(r?.total ?? 0);
  const attempted = Number(r?.attempted ?? 0);

  // Friend-requests this nick has sent today (across all lists) — to enforce daily cap.
  const todayRows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM friendship_attempts
     WHERE zalo_account_id = ${zaloAccountId}
       AND queued_at >= date_trunc('day', now())
  `;
  const sentToday = Number(todayRows[0]?.n ?? 0);

  return {
    listId: list.id, listName: list.name,
    totalInList: total,
    eligible: total - attempted,
    attempted,
    accepted: Number(r?.accepted ?? 0),
    noZalo: Number(r?.no_zalo ?? 0),
    pending: Number(r?.pending ?? 0),
    errored: Number(r?.errored ?? 0),
    dailyCap, sentToday,
  };
}

// Pick the next N eligible contacts in the list (not yet attempted by this nick).
async function pickEligibleInList(orgId: string, listId: string, zaloAccountId: string, limit: number) {
  return prisma.$queryRaw<Array<{ id: string; phone: string; name: string | null }>>`
    SELECT DISTINCT c.id,
           COALESCE(c.phone_normalized, c.phone) AS phone,
           COALESCE(c.crm_name, c.full_name)     AS name
      FROM contacts c
      JOIN customer_list_entries e ON e.customer_list_id = ${listId}
       AND (('+' || c.phone_normalized) = e.phone_e164 OR c.phone_normalized = e.phone_local OR c.phone = e.phone_local)
     WHERE c.org_id = ${orgId} AND c.merged_into IS NULL
       AND COALESCE(c.phone_normalized, c.phone) IS NOT NULL
       AND c.consent_status <> 'revoked'
       AND NOT EXISTS (
         SELECT 1 FROM friendship_attempts fa
          WHERE fa.contact_id = c.id AND fa.zalo_account_id = ${zaloAccountId}
       )
     LIMIT ${limit}
  `;
}

export interface RunBatchResult {
  requested: number;
  sent: number;
  results: Array<{ contactId: string; name: string | null; state: string; reason?: string }>;
  stoppedReason?: 'daily_cap_reached' | 'no_eligible';
}

/**
 * Send friend-requests to up to `batchSize` next-eligible contacts in the list.
 * Respects the nick's daily cap. Each send is REAL — caller must have confirmed.
 */
export async function runFriendBatch(args: {
  orgId: string; listId: string; zaloAccountId: string; message: string; batchSize: number;
}): Promise<RunBatchResult> {
  const { orgId, listId, zaloAccountId, message } = args;
  const stats = await getBulkStats(orgId, listId, zaloAccountId);
  if (!stats) throw new Error('list_not_found');

  const remainingToday = Math.max(0, stats.dailyCap - stats.sentToday);
  const want = Math.min(args.batchSize, remainingToday);
  if (want <= 0) return { requested: 0, sent: 0, results: [], stoppedReason: 'daily_cap_reached' };

  const picks = await pickEligibleInList(orgId, listId, zaloAccountId, want);
  if (picks.length === 0) return { requested: 0, sent: 0, results: [], stoppedReason: 'no_eligible' };

  const results: RunBatchResult['results'] = [];
  let sent = 0;
  for (const p of picks) {
    try {
      const outcome = await attemptFriendRequest({ orgId, zaloAccountId, contactId: p.id, phone: p.phone, message });
      results.push({ contactId: p.id, name: p.name, state: outcome.state, reason: (outcome as any).reason });
      if (outcome.state === 'sent') sent++;
    } catch (err: any) {
      results.push({ contactId: p.id, name: p.name, state: 'error', reason: String(err?.message ?? err) });
    }
    // Throttle: small gap between sends so we don't hammer Zalo.
    await new Promise(r => setTimeout(r, 1200));
  }
  return { requested: picks.length, sent, results };
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE phase — bulk-message contacts in the list. Zalo CHO PHÉP nhắn người lạ
// (chưa kết bạn): tin vào "tin nhắn chờ" của họ, trừ khi họ bật chặn tin người lạ.
// Vậy đối tượng = MỌI khách trong tệp có SĐT (kể cả chưa kết bạn), trừ:
//   - đã nhắn rồi (contact.lastOutboundAt set) → dedup
//   - đã biết chặn tin lạ (contact.strangerBlocked = true) → bỏ qua
// Để gửi cần zaloUid: bạn bè dùng friends.zaloUidInNick; người lạ dùng contact.zaloUid
// (nếu chưa có → findUser ngay trước khi gửi).
// ─────────────────────────────────────────────────────────────────────────────

export interface MsgStats {
  listId: string; listName: string;
  friends: number;     // tổng khách có SĐT trong tệp (tên field giữ nguyên để FE không vỡ)
  messaged: number;    // đã nhắn
  toMessage: number;   // chưa nhắn (kể cả người lạ)
  blocked: number;     // đã biết chặn tin người lạ
  dailyCap: number;
  sentToday: number;
}

export async function getMessageStats(orgId: string, listId: string, zaloAccountId: string): Promise<MsgStats | null> {
  const list = await prisma.customerList.findFirst({ where: { id: listId, orgId }, select: { id: true, name: true } });
  if (!list) return null;
  const acct = await prisma.zaloAccount.findFirst({ where: { id: zaloAccountId, orgId }, select: { dailyMessageCap: true } });
  const dailyCap = acct?.dailyMessageCap ?? 300;

  // stranger_blocked nằm ở bảng friends (per nick × người). LEFT JOIN để đếm ai đã bị
  // đánh dấu chặn tin lạ. Người lạ chưa có friend row → coi như chưa chặn.
  const rows = await prisma.$queryRaw<Array<{ friends: bigint; messaged: bigint; blocked: bigint }>>`
    WITH list_people AS (
      SELECT DISTINCT c.id, c.last_outbound_at,
             COALESCE(bool_or(f.stranger_blocked), false) AS blocked
        FROM contacts c
        JOIN customer_list_entries e ON e.customer_list_id = ${listId}
         AND (('+' || c.phone_normalized) = e.phone_e164 OR c.phone_normalized = e.phone_local OR c.phone = e.phone_local)
        LEFT JOIN friends f ON f.contact_id = c.id AND f.zalo_account_id = ${zaloAccountId}
       WHERE c.org_id = ${orgId} AND c.merged_into IS NULL
         AND (c.phone_normalized IS NOT NULL OR c.phone IS NOT NULL)
         AND (c.has_zalo IS NULL OR c.has_zalo = true)
       GROUP BY c.id, c.last_outbound_at
    )
    SELECT COUNT(*) AS friends,
           COUNT(*) FILTER (WHERE last_outbound_at IS NOT NULL) AS messaged,
           COUNT(*) FILTER (WHERE blocked = true) AS blocked
      FROM list_people
  `;
  const friends = Number(rows[0]?.friends ?? 0);
  const messaged = Number(rows[0]?.messaged ?? 0);
  const blocked = Number(rows[0]?.blocked ?? 0);

  const todayRows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM contacts
     WHERE last_outbound_by_zalo_account_id = ${zaloAccountId}
       AND last_outbound_at >= date_trunc('day', now())
  `;
  const sentToday = Number(todayRows[0]?.n ?? 0);

  return { listId: list.id, listName: list.name, friends, messaged, toMessage: friends - messaged - blocked, blocked, dailyCap, sentToday };
}

// Đối tượng nhắn: MỌI khách trong tệp (kể cả người lạ), chưa nhắn, chưa biết chặn tin lạ.
// uid lấy từ friends.zaloUidInNick (nếu là bạn) HOẶC contact.zaloUid (nếu đã findUser);
// null → sẽ findUser ngay trước khi gửi.
async function pickPeopleToMessage(orgId: string, listId: string, zaloAccountId: string, limit: number, includeSent = false) {
  // includeSent=true → gửi lại CẢ khách đã nhắn (bỏ điều kiện last_outbound_at IS NULL).
  // Dùng cho nút "Gửi lại" / demo — không phải reset DB thủ công.
  const notSentYet = includeSent ? Prisma.empty : Prisma.sql`AND c.last_outbound_at IS NULL`;
  return prisma.$queryRaw<Array<{ id: string; uid: string | null; phone: string; name: string | null }>>`
    SELECT DISTINCT c.id,
           COALESCE(f.zalo_uid_in_nick, c.zalo_uid)        AS uid,
           COALESCE(c.phone_normalized, c.phone)           AS phone,
           COALESCE(c.crm_name, c.full_name)               AS name
      FROM contacts c
      JOIN customer_list_entries e ON e.customer_list_id = ${listId}
       AND (('+' || c.phone_normalized) = e.phone_e164 OR c.phone_normalized = e.phone_local OR c.phone = e.phone_local)
      LEFT JOIN friends f ON f.contact_id = c.id AND f.zalo_account_id = ${zaloAccountId}
       AND f.relationship_kind = 'friend'
     WHERE c.org_id = ${orgId} AND c.merged_into IS NULL
       AND (c.phone_normalized IS NOT NULL OR c.phone IS NOT NULL)
       ${notSentYet}
       AND (c.has_zalo IS NULL OR c.has_zalo = true)
       AND NOT EXISTS (
         SELECT 1 FROM friends fb
          WHERE fb.contact_id = c.id AND fb.zalo_account_id = ${zaloAccountId} AND fb.stranger_blocked = true
       )
     LIMIT ${limit}
  `;
}

// Render {tên khách} → contact name (fallback "bạn").
function renderMsg(template: string, name: string | null): string {
  return template.replace(/\{t[eê]n kh[aá]ch\}/gi, (name || 'bạn').trim());
}

// Nhận diện lỗi "khách chặn tin người lạ" (để đánh dấu + bỏ qua, không coi là lỗi hệ thống).
function isStrangerBlock(msg: string): boolean {
  return /chặn không nhận tin|người lạ|chưa thể gửi tin|không muốn nhận tin|Không thể nhận tin nhắn|Tham số không hợp lệ|\[zalo:\d+\]/i.test(msg);
}

export async function runMessageBatch(args: {
  orgId: string; listId: string; zaloAccountId: string; message: string; batchSize: number;
  attachPriceList?: boolean; includeSent?: boolean;
}): Promise<RunBatchResult> {
  const { orgId, listId, zaloAccountId, message } = args;
  const stats = await getMessageStats(orgId, listId, zaloAccountId);
  if (!stats) throw new Error('list_not_found');

  const remainingToday = Math.max(0, stats.dailyCap - stats.sentToday);
  const want = Math.min(args.batchSize, remainingToday);
  if (want <= 0) return { requested: 0, sent: 0, results: [], stoppedReason: 'daily_cap_reached' };

  const picks = await pickPeopleToMessage(orgId, listId, zaloAccountId, want, args.includeSent === true);
  if (picks.length === 0) return { requested: 0, sent: 0, results: [], stoppedReason: 'no_eligible' };

  // Nếu bật "đính kèm bảng báo giá": ghép bộ ảnh catalog (~24 SP, tách nhiều ảnh) dùng chung cả
  // batch (cache 10p). [] nếu < 3 SP có giá+ảnh hoặc lỗi ghép → gửi text bình thường, không chặn.
  // Tên shop lấy từ env AI_SHOP_NAME (vd 'LEDNELIA') nếu có, không thì tên org.
  let catalogPaths: string[] = [];
  if (args.attachPriceList) {
    try {
      const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, aiBizName: true } });
      const shopName = org?.aiBizName || org?.name || 'Shop';
      const deps: IngestDeps = { prisma: prisma as unknown as IngestDeps['prisma'], embed: generateEmbedding };
      const embedCfg = { provider: 'local', model: 'bge-m3', baseUrl: 'http://localhost:11434/v1' };
      const lookup = (q: string) => searchKnowledge(deps, orgId, q, 6, embedCfg);
      catalogPaths = await getCampaignCatalogs(orgId, shopName, lookup);
      if (catalogPaths.length === 0) logger.warn('[bulk-campaign] attachPriceList bật nhưng không đủ SP có giá+ảnh → gửi text');
    } catch (err) {
      logger.error('[bulk-campaign] ghép catalog lỗi, gửi text:', err);
    }
  }

  const results: RunBatchResult['results'] = [];
  let sent = 0;
  const now = new Date();
  for (const p of picks) {
    try {
      // Cần uid để gửi — người lạ chưa findUser thì tra cứu ngay.
      let uid = p.uid;
      if (!uid) {
        const user = await zaloOps.findUser(zaloAccountId, p.phone);
        uid = (user as any)?.uid ?? null;
        if (uid) {
          await prisma.contact.updateMany({ where: { id: p.id, zaloUid: null }, data: { zaloUid: uid, hasZalo: true } });
        } else {
          // số không có Zalo → đánh dấu để khỏi thử lại
          await prisma.contact.update({ where: { id: p.id }, data: { hasZalo: false } });
          results.push({ contactId: p.id, name: p.name, state: 'no_zalo' });
          await new Promise(r => setTimeout(r, 800));
          continue;
        }
      }
      const text = renderMsg(message, p.name);
      await zaloOps.sendMessage(zaloAccountId, uid, 0, { msg: text });
      // Đính kèm ảnh catalog báo giá — gửi TẤT CẢ ảnh trong 1 LẦN (zca-js nhận mảng attachments),
      // không lặp từng ảnh → 1 request, nhanh + ít bị Zalo flag. Lỗi gửi ảnh KHÔNG chặn: khách đã
      // nhận text, vẫn tính 'sent'. humanPace giãn text→ảnh (chống flag).
      if (catalogPaths.length > 0) {
        try {
          await humanPace(60);
          await zaloOps.sendImage(zaloAccountId, uid, 0, catalogPaths);
        } catch (err) {
          logger.warn('[bulk-campaign] gửi ảnh catalog lỗi (bỏ qua) contact=%s: %s', p.id, (err as Error).message);
        }
      }
      await prisma.contact.update({
        where: { id: p.id },
        data: {
          lastOutboundAt: now,
          lastOutboundPreview: text.slice(0, 120),
          lastOutboundByZaloAccountId: zaloAccountId,
          totalOutbound: { increment: 1 },
        },
      });
      results.push({ contactId: p.id, name: p.name, state: 'sent' });
      sent++;
    } catch (err: any) {
      const raw = String(err?.message ?? err);
      if (isStrangerBlock(raw)) {
        // Khách bật chặn tin người lạ → đánh dấu trên friend row (nếu có) để khỏi thử lại,
        // KHÔNG tính là lỗi hệ thống. Người lạ chưa có friend row thì chỉ ghi kết quả.
        await prisma.friend.updateMany({
          where: { contactId: p.id, zaloAccountId },
          data: { strangerBlocked: true, strangerBlockedAt: now },
        }).catch(() => {});
        results.push({ contactId: p.id, name: p.name, state: 'blocked', reason: 'chặn tin người lạ' });
      } else {
        results.push({ contactId: p.id, name: p.name, state: 'error', reason: raw });
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return { requested: picks.length, sent, results };
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGN LIST — mỗi Tệp khách hàng = 1 "chiến dịch" (tối đa 1 kết bạn + 1 nhắn tin).
// Trang "Chiến dịch" liệt kê tất cả để xem lại tiến trình.
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignRow {
  listId: string; listName: string; iconEmoji: string | null;
  totalContacts: number;
  friendSent: number; friendAccepted: number; friendTotal: number;
  messaged: number; messageTotal: number;
  replied: number;       // số khách đã nhắn lại SAU khi mình gửi (phản hồi)
  contacted: number;     // số khách mình đã chạm (gửi kết bạn hoặc nhắn tin)
  autoFriend: boolean; autoMessage: boolean;
  lastActivityAt: string | null;
}

export async function listCampaigns(orgId: string, zaloAccountId: string): Promise<CampaignRow[]> {
  const rows = await prisma.$queryRaw<Array<{
    list_id: string; list_name: string; icon_emoji: string | null;
    total_contacts: bigint; friend_sent: bigint; friend_accepted: bigint;
    friend_total: bigint; messaged: bigint; message_total: bigint;
    replied: bigint; contacted: bigint; last_activity: Date | null;
  }>>`
    WITH lc AS (
      SELECT cl.id AS list_id, cl.name AS list_name, cl.icon_emoji,
             c.id AS contact_id, c.has_zalo, c.last_outbound_at, c.last_inbound_at,
             fa.state AS fa_state, fa.queued_at AS fa_at
        FROM customer_lists cl
        JOIN customer_list_entries e ON e.customer_list_id = cl.id
        JOIN contacts c ON (('+' || c.phone_normalized) = e.phone_e164 OR c.phone_normalized = e.phone_local OR c.phone = e.phone_local)
                       AND c.org_id = ${orgId} AND c.merged_into IS NULL
        LEFT JOIN friendship_attempts fa ON fa.contact_id = c.id AND fa.zalo_account_id = ${zaloAccountId}
       WHERE cl.org_id = ${orgId} AND cl.archived_at IS NULL
    )
    SELECT list_id, list_name, icon_emoji,
           COUNT(DISTINCT contact_id)                                               AS total_contacts,
           COUNT(DISTINCT contact_id) FILTER (WHERE fa_state IS NOT NULL)            AS friend_sent,
           COUNT(DISTINCT contact_id) FILTER (WHERE fa_state = 'accepted')           AS friend_accepted,
           COUNT(DISTINCT contact_id) FILTER (WHERE has_zalo IS NULL OR has_zalo)    AS friend_total,
           COUNT(DISTINCT contact_id) FILTER (WHERE last_outbound_at IS NOT NULL)    AS messaged,
           COUNT(DISTINCT contact_id) FILTER (WHERE has_zalo IS NULL OR has_zalo)    AS message_total,
           -- contacted = mình đã chạm (gửi kết bạn HOẶC nhắn tin)
           COUNT(DISTINCT contact_id) FILTER (WHERE fa_state IS NOT NULL OR last_outbound_at IS NOT NULL) AS contacted,
           -- replied = khách nhắn lại SAU khi mình gửi
           COUNT(DISTINCT contact_id) FILTER (
             WHERE last_inbound_at IS NOT NULL AND last_outbound_at IS NOT NULL AND last_inbound_at > last_outbound_at
           )                                                                         AS replied,
           MAX(GREATEST(fa_at, last_outbound_at))                                    AS last_activity
      FROM lc
     GROUP BY list_id, list_name, icon_emoji
     ORDER BY last_activity DESC NULLS LAST, list_name
  `;

  // Trạng thái tự động (theo schedule) cho từng (list × mode).
  const schedules = await prisma.bulkCampaignSchedule.findMany({
    where: { orgId, zaloAccountId, enabled: true },
    select: { customerListId: true, mode: true },
  });
  const autoMap = new Map<string, { friend: boolean; message: boolean }>();
  for (const s of schedules) {
    const cur = autoMap.get(s.customerListId) || { friend: false, message: false };
    if (s.mode === 'friend') cur.friend = true; else cur.message = true;
    autoMap.set(s.customerListId, cur);
  }

  return rows.map(r => ({
    listId: r.list_id, listName: r.list_name, iconEmoji: r.icon_emoji,
    totalContacts: Number(r.total_contacts),
    friendSent: Number(r.friend_sent), friendAccepted: Number(r.friend_accepted), friendTotal: Number(r.friend_total),
    messaged: Number(r.messaged), messageTotal: Number(r.message_total),
    replied: Number(r.replied), contacted: Number(r.contacted),
    autoFriend: autoMap.get(r.list_id)?.friend ?? false,
    autoMessage: autoMap.get(r.list_id)?.message ?? false,
    lastActivityAt: r.last_activity ? r.last_activity.toISOString() : null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-SEND scheduling — toggle "tự động gửi 1 đợt/ngày" per (list × nick × mode).
// A cron runs all enabled schedules that haven't run yet today.
// ─────────────────────────────────────────────────────────────────────────────

export async function getSchedule(orgId: string, listId: string, zaloAccountId: string, mode: string) {
  return prisma.bulkCampaignSchedule.findUnique({
    where: { customerListId_zaloAccountId_mode: { customerListId: listId, zaloAccountId, mode } },
  }).then(s => (s && s.orgId === orgId) ? s : null);
}

export async function setSchedule(args: {
  orgId: string; listId: string; zaloAccountId: string; mode: string;
  enabled: boolean; message: string; perDay: number; userId: string;
}) {
  const { orgId, listId, zaloAccountId, mode, enabled, message, perDay, userId } = args;
  return prisma.bulkCampaignSchedule.upsert({
    where: { customerListId_zaloAccountId_mode: { customerListId: listId, zaloAccountId, mode } },
    create: { orgId, customerListId: listId, zaloAccountId, mode, enabled, message, perDay, createdById: userId },
    update: { enabled, message, perDay },
  });
}

// Run ONE schedule's daily batch (friend or message). Returns sent count.
async function runScheduleOnce(s: { id: string; orgId: string; customerListId: string; zaloAccountId: string; mode: string; message: string; perDay: number }): Promise<number> {
  const common = { orgId: s.orgId, listId: s.customerListId, zaloAccountId: s.zaloAccountId, message: s.message, batchSize: s.perDay };
  const result = s.mode === 'message' ? await runMessageBatch(common) : await runFriendBatch(common);
  await prisma.bulkCampaignSchedule.update({
    where: { id: s.id },
    data: { lastRunAt: new Date(), lastRunSent: result.sent },
  });
  return result.sent;
}

// Cron cycle: every enabled schedule that hasn't run since the start of today.
export async function runScheduleCycle(): Promise<{ ran: number; totalSent: number }> {
  const due = await prisma.$queryRaw<Array<{ id: string; org_id: string; customer_list_id: string; zalo_account_id: string; mode: string; message: string; per_day: number }>>`
    SELECT id, org_id, customer_list_id, zalo_account_id, mode, message, per_day
      FROM bulk_campaign_schedules
     WHERE enabled = true
       AND (last_run_at IS NULL OR last_run_at < date_trunc('day', now()))
  `;
  let ran = 0, totalSent = 0;
  for (const d of due) {
    try {
      const sent = await runScheduleOnce({
        id: d.id, orgId: d.org_id, customerListId: d.customer_list_id,
        zaloAccountId: d.zalo_account_id, mode: d.mode, message: d.message, perDay: d.per_day,
      });
      ran++; totalSent += sent;
    } catch {
      // per-schedule errors (e.g. nick disconnected) are swallowed; lastRunAt is NOT
      // updated so it retries next tick. The send itself records its own attempt rows.
    }
  }
  return { ran, totalSent };
}
