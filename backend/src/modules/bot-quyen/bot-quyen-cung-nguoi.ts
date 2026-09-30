// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §8b, 30/09) — nhận ra CÙNG MỘT NGƯỜI qua nhiều nick Zalo.
//
// Zalo cấp uid KHÁC NHAU cho cùng một người ở mỗi nick nhìn (cả mã nhóm cũng khác theo nick). Đo trên staging 30/09:
//   "Trần Hưng"  = 3395858500519725514 (nick Cẩm Loan)  = 3835588809400259343 (nick Vận Tải Minh Thức)
//   "Viết Quốc"  = 5809610033196845429 (nick Cẩm Loan)  = 5369941570764297136 (nick Vận Tải Minh Thức)
// Bot chạy trên MỘT nick và chỉ thấy uid theo nick đó ⇒ nhân viên phải mang uid của MỌI nick.
//
// HAI bằng chứng chắc chắn (không đoán theo tên):
//   cung_tin   — mã tin nhắn Zalo (`zalo_msg_id`) là TOÀN CỤC: cùng một tin trong một nhóm có hai nick CRM được ghi hai lần
//                (mỗi nick một hội thoại) với cùng `zalo_msg_id` và `sender_uid` theo từng nick. Đo staging: 236 tin của Trần
//                Hưng, 39 tin của Viết Quốc ghép đúng một-một, 0 tin ghép lệch.
//   global_id  — `globalId` Zalo (không đổi theo nick) đã lưu ở friends.zalo_global_id / group_members.global_id.
// Gộp bằng union-find có RÀO: một người chỉ có MỘT uid ở mỗi nick — liên kết làm một nhóm có hai uid khác nhau cùng nick
// bị BỎ (dữ liệu lệch ⇒ không gộp, không đoán). Liên kết mạnh (nhiều tin chung) xét trước.
import { prisma } from '../../shared/database/prisma-client.js';

export type NguonLienKet = 'cung_tin' | 'global_id';

export interface LienKet {
  a: string;
  nickA: string;
  b: string;
  nickB: string;
  /** Số tin chung (cung_tin) — độ mạnh để xếp thứ tự. global_id: 1. */
  so: number;
  nguon: NguonLienKet;
}

export interface UidTheoNick {
  zaloUid: string;
  zaloAccountId: string;
}

/** Hàm tìm gốc/gộp — THUẦN. Trả uid → danh sách mọi {uid, nick} cùng người (kể cả chính nó), chỉ cho uid có liên kết. */
export function gomNguoi(lienKet: readonly LienKet[]): Map<string, UidTheoNick[]> {
  const cha = new Map<string, string>();
  const nickCua = new Map<string, string>();
  // Mỗi gốc: nick → uid (rào "một uid mỗi nick").
  const theoNick = new Map<string, Map<string, string>>();
  const goc = (x: string): string => {
    let r = x;
    while (cha.get(r) !== r) r = cha.get(r)!;
    let y = x;
    while (cha.get(y) !== r) { const t = cha.get(y)!; cha.set(y, r); y = t; }
    return r;
  };
  const them = (uid: string, nick: string): boolean => {
    const cu = nickCua.get(uid);
    if (cu !== undefined) return cu === nick; // cùng uid mà khác nick ⇒ dữ liệu lệch
    nickCua.set(uid, nick);
    cha.set(uid, uid);
    theoNick.set(uid, new Map([[nick, uid]]));
    return true;
  };
  const xep = [...lienKet].sort((x, y) => (x.nguon === y.nguon ? 0 : x.nguon === 'cung_tin' ? -1 : 1)
    || y.so - x.so || (x.a + x.b < y.a + y.b ? -1 : x.a + x.b > y.a + y.b ? 1 : 0));
  for (const l of xep) {
    if (!l.a || !l.b || l.a === l.b || l.nickA === l.nickB) continue;
    if (!them(l.a, l.nickA) || !them(l.b, l.nickB)) continue;
    const ga = goc(l.a);
    const gb = goc(l.b);
    if (ga === gb) continue;
    const ma = theoNick.get(ga)!;
    const mb = theoNick.get(gb)!;
    let va = false;
    for (const [nick, uid] of mb) if (ma.has(nick) && ma.get(nick) !== uid) { va = true; break; }
    if (va) continue;
    for (const [nick, uid] of mb) ma.set(nick, uid);
    cha.set(gb, ga);
    theoNick.delete(gb);
  }
  const ra = new Map<string, UidTheoNick[]>();
  for (const uid of cha.keys()) {
    const g = goc(uid);
    const ds = [...theoNick.get(g)!].map(([zaloAccountId, zaloUid]) => ({ zaloUid, zaloAccountId }))
      .sort((x, y) => (x.zaloUid < y.zaloUid ? -1 : x.zaloUid > y.zaloUid ? 1 : 0));
    ra.set(uid, ds);
  }
  return ra;
}

/**
 * Liên kết cùng-người của org. `uids` có ⇒ chỉ liên kết chạm tới các uid đó (đọc rẻ cho vài nhân viên); không ⇒ cả org
 * (dùng cho "Chờ gán", có bản gom 60 s). Chỉ tin nhóm thật (không hội thoại ảo, không tin local).
 */
export async function docLienKet(orgId: string, uids?: readonly string[]): Promise<LienKet[]> {
  if (uids && uids.length === 0) return [];
  const loc = uids ? [...new Set(uids)] : null;
  const [tin, gid] = await Promise.all([
    loc
      ? prisma.$queryRaw<Array<{ a: string; nick_a: string; b: string; nick_b: string; so: number }>>`
          SELECT m1.sender_uid AS a, c1.zalo_account_id AS nick_a, m2.sender_uid AS b, c2.zalo_account_id AS nick_b,
                 count(*)::int AS so
          FROM conversations c1
          JOIN messages m1 ON m1.conversation_id = c1.id
          JOIN messages m2 ON m2.zalo_msg_id = m1.zalo_msg_id AND m2.conversation_id <> m1.conversation_id
          JOIN conversations c2 ON c2.id = m2.conversation_id
          WHERE c1.org_id = ${orgId} AND c2.org_id = ${orgId}
            AND c1."threadType" = 'group' AND c2."threadType" = 'group'
            AND c1.is_virtual = false AND c2.is_virtual = false AND c1.zalo_account_id <> c2.zalo_account_id
            AND m1.is_local = false AND m2.is_local = false AND m1.zalo_msg_id IS NOT NULL AND m1.zalo_msg_id <> ''
            AND m1.sender_uid = ANY(${loc}::text[]) AND m2.sender_uid IS NOT NULL AND m2.sender_uid <> ''
          GROUP BY 1, 2, 3, 4`
      : prisma.$queryRaw<Array<{ a: string; nick_a: string; b: string; nick_b: string; so: number }>>`
          WITH g AS (
            SELECT m.zalo_msg_id, m.sender_uid, c.zalo_account_id, m.conversation_id
            FROM conversations c JOIN messages m ON m.conversation_id = c.id
            WHERE c.org_id = ${orgId} AND c."threadType" = 'group' AND c.is_virtual = false
              AND m.is_local = false AND m.zalo_msg_id IS NOT NULL AND m.zalo_msg_id <> ''
              AND m.sender_uid IS NOT NULL AND m.sender_uid <> ''
          )
          SELECT x.sender_uid AS a, x.zalo_account_id AS nick_a, y.sender_uid AS b, y.zalo_account_id AS nick_b,
                 count(*)::int AS so
          FROM g x JOIN g y ON y.zalo_msg_id = x.zalo_msg_id AND y.conversation_id <> x.conversation_id
                           AND x.zalo_account_id < y.zalo_account_id
          GROUP BY 1, 2, 3, 4`,
    prisma.$queryRaw<Array<{ a: string; nick_a: string; b: string; nick_b: string }>>`
      WITH g AS (
        SELECT f.zalo_account_id AS nick, f.zalo_uid_in_nick AS uid, f.zalo_global_id AS gid FROM friends f
        WHERE f.org_id = ${orgId} AND f.zalo_global_id IS NOT NULL AND f.zalo_global_id <> ''
        UNION
        SELECT gm.zalo_account_id, gm.member_uid, gm.global_id FROM group_members gm
        WHERE gm.org_id = ${orgId} AND gm.global_id IS NOT NULL AND gm.global_id <> ''
      )
      SELECT DISTINCT x.uid AS a, x.nick AS nick_a, y.uid AS b, y.nick AS nick_b
      FROM g x JOIN g y ON y.gid = x.gid AND x.nick < y.nick
      WHERE ${loc === null} OR x.uid = ANY(${loc ?? []}::text[]) OR y.uid = ANY(${loc ?? []}::text[])`,
  ]);
  return [
    ...tin.map((r) => ({ a: r.a, nickA: r.nick_a, b: r.b, nickB: r.nick_b, so: r.so, nguon: 'cung_tin' as const })),
    ...gid.map((r) => ({ a: r.a, nickA: r.nick_a, b: r.b, nickB: r.nick_b, so: 1, nguon: 'global_id' as const })),
  ];
}

/**
 * Nick nhìn thấy mỗi uid (uid là theo nick): hội thoại riêng (external_thread_id), friends, group_members, người gửi
 * trong nhóm. Nhiều nick (không nên xảy ra) ⇒ lấy nơi gặp gần nhất.
 */
export async function nickCuaUid(orgId: string, uids: readonly string[]): Promise<Map<string, string>> {
  if (uids.length === 0) return new Map();
  const ds = [...new Set(uids)];
  const rows = await prisma.$queryRaw<Array<{ uid: string; nick: string }>>`
    SELECT DISTINCT ON (uid) uid, nick FROM (
      SELECT c.external_thread_id AS uid, c.zalo_account_id AS nick, c.last_message_at AS luc
      FROM conversations c
      WHERE c.org_id = ${orgId} AND c."threadType" = 'user' AND c.external_thread_id = ANY(${ds}::text[])
      UNION ALL
      SELECT f.zalo_uid_in_nick, f.zalo_account_id, f.updated_at FROM friends f
      WHERE f.org_id = ${orgId} AND f.zalo_uid_in_nick = ANY(${ds}::text[])
      UNION ALL
      SELECT gm.member_uid, gm.zalo_account_id, gm.last_seen_at FROM group_members gm
      WHERE gm.org_id = ${orgId} AND gm.member_uid = ANY(${ds}::text[])
      UNION ALL
      SELECT m.sender_uid, c.zalo_account_id, max(m.sent_at)
      FROM conversations c JOIN messages m ON m.conversation_id = c.id
      WHERE c.org_id = ${orgId} AND c."threadType" = 'group' AND m.sender_uid = ANY(${ds}::text[])
      GROUP BY 1, 2
    ) x
    ORDER BY uid, luc DESC NULLS LAST`;
  return new Map(rows.map((r) => [r.uid, r.nick]));
}
