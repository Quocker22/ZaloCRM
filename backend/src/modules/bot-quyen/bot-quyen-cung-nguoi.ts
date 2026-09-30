// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §8b) — nhận ra CÙNG MỘT NGƯỜI (và nick CRM) qua nhiều nick Zalo.
//
// Zalo cấp uid KHÁC NHAU cho cùng một người ở mỗi nick nhìn (cả mã nhóm cũng khác theo nick). Đo trên staging 30/09:
//   "Trần Hưng"  = 3395858500519725514 (nick Cẩm Loan)  = 3835588809400259343 (nick Vận Tải Minh Thức)
//   "Viết Quốc"  = 5809610033196845429 (nick Cẩm Loan)  = 5369941570764297136 (nick Vận Tải Minh Thức)
// Bot chạy trên MỘT nick và chỉ thấy uid theo nick đó ⇒ nhân viên phải mang uid của MỌI nick.
//
// MỘT bằng chứng duy nhất — CÙNG TIN NHẮN, luật CHẶT (§8b-an-toàn P1-1). Không đoán theo tên, KHÔNG dùng globalId (P0):
// friends.zalo_global_id ghi được bởi mọi user CRM (POST /conversations/ensure-by-uid), backfill chép globalId qua các liên
// hệ đã gộp, và Zalo có globalId giữ chỗ dùng chung ⇒ globalId chỉ được làm GỢI Ý ở luồng tay "Là NV đã có…".
//
// Một cặp (uid a ở nick A, uid b ở nick B) là cùng người khi có ≥ SO_TIN_TOI_THIEU tin KHÁC NHAU mà mỗi tin:
//   • có `zalo_msg_id` là mã MÁY CHỦ Zalo (snowflake): chỉ chữ số, khác `zalo_cli_msg_id`, và KHÔNG giống mốc thời gian
//     mili-giây (zalo-history-backfill / zalo-message-sync lưu `msgId || cliMsgId` — cliMsgId là Date.now() của máy
//     khách ⇒ trùng ngẫu nhiên giữa các nhóm được). Đo staging 30/09 (4.408 tin): mã máy chủ 8,21·10¹²–8,32·10¹², còn
//     cliMsgId ≈ 1,79·10¹² (= epoch ms của `sent_at`) ⇒ loại mọi mã lệch mốc `sent_at` dưới 2 ngày;
//   • được ghi ở HAI hội thoại nhóm (không ảo, không tin local) của HAI nick khác nhau, `sent_at` lệch ≤ LECH_GIAY_TOI_DA,
//     cùng `content_type`;
//   • hai hội thoại là CÙNG nhóm Zalo. DB không có mã nhóm toàn cục (mã nhóm khác theo nick; group_members.global_id là của
//     THÀNH VIÊN, không phải nhóm) ⇒ dùng: cùng tên nhóm (bỏ hoa/thường + khoảng trắng hai đầu, khác rỗng) VÀ trùng thành
//     viên — hai hội thoại có tin chung (luật trên) của ≥ 2 NGƯỜI GỬI khác nhau.
// Gộp bằng union-find có RÀO: một người chỉ có MỘT uid ở mỗi nick — liên kết làm một nhóm có hai uid khác nhau cùng nick
// bị BỎ (dữ liệu lệch ⇒ không gộp, không đoán). Liên kết mạnh (nhiều tin chung) xét trước.
//
// Mọi truy vấn chạy với `SET LOCAL statement_timeout` (HET_GIO_LIEN_KET_MS) — lỗi/hết giờ ⇒ KHÔNG liên kết nào (đóng
// an toàn) + WARNING. Chỉ mục: migration 20260930210100_messages_idx_lien_ket.
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { tenantTransaction } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

/** Số tin chung khác nhau tối thiểu cho một liên kết. */
export const SO_TIN_TOI_THIEU = 2;
/** Hai bản ghi của một tin lệch `sent_at` tối đa (giây). */
export const LECH_GIAY_TOI_DA = 5;
/** Hạn giờ mỗi truy vấn liên kết — quá ⇒ không liên kết (đóng an toàn). */
export const HET_GIO_LIEN_KET_MS = 3000;
/** Mã tin mẫu giữ làm bằng chứng. */
export const SO_MA_TIN_MAU = 5;

export interface LienKet {
  a: string;
  nickA: string;
  b: string;
  nickB: string;
  /** Số tin chung khác nhau (≥ SO_TIN_TOI_THIEU). */
  so: number;
  /** ≤ SO_MA_TIN_MAU mã tin Zalo chung (bằng chứng — ghi nhật ký). */
  maTin: string[];
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
  const xep = [...lienKet].filter((l) => l.so >= SO_TIN_TOI_THIEU)
    .sort((x, y) => y.so - x.so || (x.a + x.b < y.a + y.b ? -1 : x.a + x.b > y.a + y.b ? 1 : 0));
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

export interface BangChung {
  soTin: number;
  maTin: string[];
}

/** Bằng chứng (số tin + mã tin mẫu) nối uid `x` với bất kỳ uid nào trong `voi` — liên kết TRỰC TIẾP mạnh nhất. THUẦN. */
export function bangChungGiua(x: string, voi: ReadonlySet<string>, lienKet: readonly LienKet[]): BangChung {
  let soTin = 0;
  const ma = new Set<string>();
  for (const l of lienKet) {
    if ((l.a === x && voi.has(l.b)) || (l.b === x && voi.has(l.a))) {
      soTin = Math.max(soTin, l.so);
      for (const m of l.maTin) if (ma.size < SO_MA_TIN_MAU) ma.add(m);
    }
  }
  return { soTin, maTin: [...ma].sort() };
}

/**
 * Điều kiện "mã tin là mã MÁY CHỦ Zalo" cho bí danh `m` (hằng trong mã — không nhận đầu vào). CASE giữ thứ tự: chỉ ép
 * kiểu số khi đã là chuỗi số. 172 800 000 ms = 2 ngày.
 */
function maMayChu(m: string): Prisma.Sql {
  return Prisma.raw(`(${m}.zalo_msg_id IS DISTINCT FROM ${m}.zalo_cli_msg_id AND CASE WHEN ${m}.zalo_msg_id ~ '^[0-9]{6,20}$' `
    + `THEN abs(${m}.zalo_msg_id::numeric - (extract(epoch FROM ${m}.sent_at) * 1000)) > 172800000 ELSE false END)`);
}

/** Hội thoại nhóm thật có tên (bí danh `c`). */
function nhomThat(c: string): Prisma.Sql {
  return Prisma.raw(`(${c}."threadType" = 'group' AND ${c}.is_virtual = false AND btrim(coalesce(${c}.group_name, '')) <> '')`);
}

type DongLienKet = { a: string; nick_a: string; b: string; nick_b: string; so: number; ma_tin: string[] | null };

/**
 * Truy vấn liên kết (một câu). CTE MATERIALIZED có chủ ý: bản inline để planner nối `cung_nhom` vào TỪNG dòng `cap` ⇒ đo
 * trên staging 30/09 (4.408 tin, chưa có chỉ mục mới) 11,3 s — materialized: kiểm "cùng nhóm" MỘT lần mỗi cặp hội thoại. `loc` = uid gốc (chỉ tin do các uid này gửi ở phía `a`); null = cả org (mỗi cặp một lần,
 * nick_a < nick_b).
 */
export function cauLienKet(orgId: string, loc: string[] | null): Prisma.Sql {
  const lech = Prisma.raw(`interval '${LECH_GIAY_TOI_DA} seconds'`);
  const locA = loc ? Prisma.sql`AND m.sender_uid = ANY(${loc}::text[])` : Prisma.empty;
  const motChieu = loc ? Prisma.empty : Prisma.sql`AND c2.zalo_account_id > m1.zalo_account_id`;
  return Prisma.sql`
    WITH m1 AS MATERIALIZED (
      SELECT m.zalo_msg_id, m.sender_uid, m.sent_at, m.content_type, m.conversation_id, c.zalo_account_id,
             lower(btrim(c.group_name)) AS ten_nhom
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.org_id = ${orgId} AND ${nhomThat('c')}
        AND m.zalo_msg_id IS NOT NULL AND m.is_local = false AND m.sender_uid IS NOT NULL AND m.sender_uid <> ''
        ${locA} AND ${maMayChu('m')}
    ), cap AS MATERIALIZED (
      SELECT m1.sender_uid AS a, m1.zalo_account_id AS nick_a, m2.sender_uid AS b, c2.zalo_account_id AS nick_b,
             m1.conversation_id AS c1, m2.conversation_id AS c2, m1.zalo_msg_id
      FROM m1
      JOIN messages m2 ON m2.zalo_msg_id = m1.zalo_msg_id AND m2.conversation_id <> m1.conversation_id
      JOIN conversations c2 ON c2.id = m2.conversation_id
      WHERE m2.zalo_msg_id IS NOT NULL AND m2.is_local = false
        AND c2.org_id = ${orgId} AND ${nhomThat('c2')} AND c2.zalo_account_id <> m1.zalo_account_id ${motChieu}
        AND lower(btrim(c2.group_name)) = m1.ten_nhom
        AND m2.sender_uid IS NOT NULL AND m2.sender_uid <> ''
        AND m2.content_type = m1.content_type
        AND m2.sent_at BETWEEN m1.sent_at - ${lech} AND m1.sent_at + ${lech}
        AND ${maMayChu('m2')}
    ), cap_nhom AS MATERIALIZED (
      SELECT c1, c2, min(a) AS a1, count(DISTINCT a) AS so_a FROM cap GROUP BY 1, 2
    ), cung_nhom AS MATERIALIZED (
      -- Trùng thành viên: tin chung (cùng luật) của ≥ 2 người gửi khác nhau giữa hai hội thoại.
      SELECT p.c1, p.c2 FROM cap_nhom p
      WHERE p.so_a >= 2 OR EXISTS (
        SELECT 1 FROM messages x
        JOIN messages y ON y.zalo_msg_id = x.zalo_msg_id AND y.conversation_id = p.c2
        WHERE x.conversation_id = p.c1 AND x.zalo_msg_id IS NOT NULL AND x.is_local = false
          AND y.zalo_msg_id IS NOT NULL AND y.is_local = false
          AND x.sender_uid IS NOT NULL AND x.sender_uid <> '' AND x.sender_uid <> p.a1
          AND y.content_type = x.content_type
          AND y.sent_at BETWEEN x.sent_at - ${lech} AND x.sent_at + ${lech}
          AND ${maMayChu('x')} AND ${maMayChu('y')})
    )
    SELECT cap.a, cap.nick_a, cap.b, cap.nick_b, count(DISTINCT cap.zalo_msg_id)::int AS so,
           (array_agg(DISTINCT cap.zalo_msg_id ORDER BY cap.zalo_msg_id))[1:${SO_MA_TIN_MAU}] AS ma_tin
    FROM cap JOIN cung_nhom USING (c1, c2)
    GROUP BY 1, 2, 3, 4
    HAVING count(DISTINCT cap.zalo_msg_id) >= ${SO_TIN_TOI_THIEU}`;
}

/** Đếm lần truy vấn liên kết hỏng/hết giờ (test + quan sát). */
let soLanHong = 0;
export function _soLanLienKetHong(dat?: number): number {
  if (dat !== undefined) soLanHong = dat;
  return soLanHong;
}

/** Chỉ cho test: ép MỌI truy vấn liên kết coi như hỏng (kiểm đường đóng an toàn của người gọi). Xoá cả bộ ngắt. */
let epHong = false;
export function _epLienKetHong(bat: boolean): void {
  epHong = bat;
  ngat.clear();
}

/**
 * Bộ ngắt: một truy vấn vừa hỏng/hết giờ ⇒ NGHI_SAU_HONG_MS không chạy lại (trả mặc định ngay — vẫn đóng an toàn). Đo
 * 30/09 trên 2,1 triệu tin: tin chung của nick tự gửi (đề xuất nick CRM) 77 s, "Chờ gán" cả org > 3 s ⇒ không để mỗi lần
 * mở trang tốn 3 s DB vô ích.
 * KHOÁ (D4, giám sát 30/09) = org + tên + DẠNG câu SQL + tham số (tập uid lọc…): câu cả org (không lọc — chậm) hết giờ
 * KHÔNG được ngắt luôn câu lọc vài uid của một NV (rẻ) dùng CÙNG tên — bản trước khoá theo (org, tên) nên một lần "Chờ
 * gán" hết giờ làm mọi vòng tự nối/đề xuất của org mù 30 phút.
 */
export const NGHI_SAU_HONG_MS = 30 * 60_000;
const ngat = new Map<string, number>();

/** Khoá bộ ngắt cho một truy vấn cụ thể. THUẦN. */
export function khoaNgat(orgId: string, ten: string, cau: Prisma.Sql): string {
  let thamSo = '';
  try {
    thamSo = JSON.stringify(cau.values, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch {
    thamSo = String(cau.values.length);
  }
  const bam = createHash('sha1').update(cau.sql).update('\u0000').update(thamSo).digest('hex').slice(0, 16);
  return `${orgId}|${ten}|${bam}`;
}

/**
 * Chạy MỘT truy vấn đọc với `SET LOCAL statement_timeout`. Lỗi/hết giờ ⇒ `macDinh` + WARNING (đóng an toàn — không bao giờ
 * ném cho người gọi). `hetGioMs` chỉ để test/đo.
 */
export async function docCoHetGio<T>(
  orgId: string, ten: string, cau: Prisma.Sql, macDinh: T, hetGioMs = HET_GIO_LIEN_KET_MS,
): Promise<T> {
  const ms = Math.max(1, Math.trunc(hetGioMs));
  const khoa = khoaNgat(orgId, ten, cau);
  if (!epHong && Date.now() - (ngat.get(khoa) ?? 0) < NGHI_SAU_HONG_MS) return macDinh;
  try {
    if (epHong) throw new Error('ép hỏng (test)');
    return await tenantTransaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${ms}`);
      return (await tx.$queryRaw(cau)) as T;
    }, { timeout: ms + 10_000, maxWait: 10_000 });
  } catch (err) {
    soLanHong++;
    if (!epHong) {
      const bay = Date.now();
      for (const [k, luc] of ngat) if (bay - luc >= NGHI_SAU_HONG_MS) ngat.delete(k); // không phình theo tập uid
      ngat.set(khoa, bay);
    }
    logger.warn(`[bot-quyen] ${ten} org ${orgId} lỗi/hết giờ — đóng an toàn (không liên kết):`,
      err instanceof Error ? err.message : err);
    return macDinh;
  }
}

/**
 * Liên kết cùng-người của org (luật chặt ở đầu file). `uids` có ⇒ chỉ liên kết mà phía `a` là một trong các uid đó (đọc
 * rẻ cho vài nhân viên / nick); không ⇒ cả org (dùng cho "Chờ gán", có bản gom 60 s). Lỗi/hết giờ ⇒ null (người gọi
 * PHẢI coi là "không biết" — không xoá gì dựa trên kết quả rỗng giả).
 */
export async function docLienKetHoacNull(
  orgId: string, uids?: readonly string[], o: { hetGioMs?: number } = {},
): Promise<LienKet[] | null> {
  const loc = uids ? [...new Set(uids)].filter(Boolean) : null;
  if (loc && loc.length === 0) return [];
  const rows = await docCoHetGio<DongLienKet[] | null>(orgId, 'đọc liên kết cùng người', cauLienKet(orgId, loc), null, o.hetGioMs);
  return rows === null ? null
    : rows.map((r) => ({ a: r.a, nickA: r.nick_a, b: r.b, nickB: r.nick_b, so: r.so, maTin: r.ma_tin ?? [] }));
}

/** Như docLienKetHoacNull nhưng lỗi/hết giờ ⇒ [] (không liên kết nào — đóng an toàn cho đường chỉ ĐỌC/HIỂN THỊ). */
export async function docLienKet(orgId: string, uids?: readonly string[], o: { hetGioMs?: number } = {}): Promise<LienKet[]> {
  return (await docLienKetHoacNull(orgId, uids, o)) ?? [];
}

/**
 * Nick nhìn thấy mỗi uid (uid là theo nick): hội thoại riêng (external_thread_id), friends, group_members, người gửi
 * trong nhóm. Nhiều nick (không nên xảy ra) ⇒ lấy nơi gặp gần nhất. Chỉ để HIỂN THỊ nick — không phải bằng chứng.
 */
export async function nickCuaUid(orgId: string, uids: readonly string[]): Promise<Map<string, string>> {
  const ds = [...new Set(uids)].filter(Boolean);
  if (ds.length === 0) return new Map();
  const rows = await docCoHetGio<Array<{ uid: string; nick: string }>>(orgId, 'đọc nick của uid', Prisma.sql`
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
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.org_id = ${orgId} AND c."threadType" = 'group' AND m.sender_uid = ANY(${ds}::text[])
      GROUP BY 1, 2
    ) x
    ORDER BY uid, luc DESC NULLS LAST`, []);
  return new Map(rows.map((r) => [r.uid, r.nick]));
}

/**
 * uid đã từng xuất hiện trong TIN NHẮN của org: người gửi (không tính tin local), hoặc người kia của hội thoại riêng có
 * tin. Lỗi/hết giờ ⇒ tập rỗng (đóng an toàn: người gọi coi như "chưa thấy" và từ chối).
 */
export async function uidDaThayTrongTin(orgId: string, uids: readonly string[]): Promise<Set<string>> {
  const ds = [...new Set(uids)].filter(Boolean);
  if (ds.length === 0) return new Set();
  const rows = await docCoHetGio<Array<{ uid: string }>>(orgId, 'kiểm uid đã thấy trong tin', Prisma.sql`
    SELECT u.uid FROM unnest(${ds}::text[]) AS u(uid)
    WHERE EXISTS (SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
                  WHERE m.sender_uid = u.uid AND m.sender_uid IS NOT NULL AND c.org_id = ${orgId} AND m.is_local = false)
       OR EXISTS (SELECT 1 FROM conversations c WHERE c.org_id = ${orgId} AND c."threadType" = 'user'
                  AND c.external_thread_id = u.uid AND c.is_virtual = false
                  AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.is_local = false))`, []);
  return new Set(rows.map((r) => r.uid));
}

/**
 * GỢI Ý globalId (P0: CHỈ để hiện ở luồng tay "Là NV đã có…", KHÔNG BAO GIỜ tự áp): uid → các uid khác mang cùng globalId
 * (friends / group_members). Đóng an toàn như trên.
 */
export async function goiYGlobalId(orgId: string, uids: readonly string[]): Promise<Map<string, string[]>> {
  const ds = [...new Set(uids)].filter(Boolean);
  if (ds.length === 0) return new Map();
  const rows = await docCoHetGio<Array<{ a: string; b: string }>>(orgId, 'gợi ý globalId', Prisma.sql`
    WITH g AS (
      SELECT f.zalo_uid_in_nick AS uid, f.zalo_global_id AS gid FROM friends f
      WHERE f.org_id = ${orgId} AND f.zalo_global_id IS NOT NULL AND f.zalo_global_id <> ''
      UNION
      SELECT gm.member_uid, gm.global_id FROM group_members gm
      WHERE gm.org_id = ${orgId} AND gm.global_id IS NOT NULL AND gm.global_id <> ''
    )
    SELECT DISTINCT x.uid AS a, y.uid AS b FROM g x JOIN g y ON y.gid = x.gid AND y.uid <> x.uid
    WHERE x.uid = ANY(${ds}::text[])`, []);
  const ra = new Map<string, string[]>();
  for (const r of rows) ra.set(r.a, [...(ra.get(r.a) ?? []), r.b].sort());
  return ra;
}
