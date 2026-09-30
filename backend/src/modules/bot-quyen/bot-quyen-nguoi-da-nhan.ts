// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT — "Chờ gán — người đã nhắn cho shop" (docs/77 §8, chủ 30/09: "danh sách tất cả những người đã nhắn tin cho
// shop, kiểu như /settings/crm/agent-operators; những người đã gán rồi sẽ không gán nữa").
//
// NGUỒN: cùng nguồn với "Chờ gán — nick vừa nhắn" của AgentOperatorsPage (agent-operator-routes.ts `/cho-gan`): bảng
// messages, tin ĐẾN (sender_type='contact') — nhưng KHÔNG giới hạn 7 ngày / 500 tin, và cả tin NHÓM:
//   tin riêng: hội thoại threadType='user' có ít nhất một tin đến; uid = external_thread_id (uid người kia NHÌN TỪ
//              nick đó); thời điểm = last_message_at; tên = tên CRM của liên hệ (nếu có).
//   nhóm:      mỗi (sender_uid, hội thoại nhóm) có tin đến — gom trong SQL (một lượt quét tin của các nhóm).
// Hội thoại ảo (is_virtual) bỏ. Zalo cấp uid KHÁC nhau cho cùng một người ở mỗi nick ⇒ gom theo uid rồi GỘP các uid của
// CÙNG người (docs/77 §8b — bot-quyen-cung-nguoi.ts: cùng mã tin nhắn trong nhóm chung của hai nick / cùng globalId) thành
// MỘT dòng mang mọi uid theo nick. Người đã là nhân viên dưới BẤT KỲ uid nào (kể cả uid chỉ biết qua liên kết, chưa lưu)
// ⇒ cả dòng biến mất; nick CRM khác nhìn từ một nick (uid khác uid nick tự nhìn mình) cũng vậy. Gán ⇒ gửi mọi uid.
//
// Tốc độ (đo 30/09 trên 2,1 triệu tin giả lập, 6.250 hội thoại): gom ≈ 0,5–0,8 s ⇒ giữ bản gom 60 s trong bộ nhớ theo org;
// loại trừ (đã là NV, nick của org) + đánh dấu "đang sai bot" đọc TƯƠI mỗi lần (bảng nhỏ) ⇒ gán xong biến mất ngay.
// Tin cuối chỉ đọc cho các dòng của TRANG đang xem (một truy vấn LATERAL, ≤ 100 dòng) — không N+1.
//
// RIÊNG TƯ (review P1-3, theo privacy/redact.ts `canSeeConversationContent`): nơi thuộc nick `privacyMode='main'` mà người
// xem KHÔNG phải chủ nick đã mở khoá PIN ⇒ tên lấy từ nơi đó (tên người gửi trong nhóm / tên liên hệ của tin riêng) KHÔNG
// hiện và KHÔNG dùng để tìm; tin cuối không lấy từ nơi đó. Còn nơi xem được thì dùng nơi đó. Không còn gì xem được ⇒
// `anTen` / `anTinCuoi` + `redacted`. Metadata (uid, nick, tên nhóm, thời điểm) giữ — như redactConversationRow. Bản gom
// 60 s dùng chung cho mọi người xem (chỉ chứa dữ liệu thô) — lọc theo người xem làm LÚC TRẢ.
import { prisma } from '../../shared/database/prisma-client.js';
import { canSeeConversationContent, type PrivacyContext } from '../privacy/redact.js';
import { docLienKet, gomNguoi } from './bot-quyen-cung-nguoi.js';

export interface NoiNhan {
  conversationId: string;
  loai: 'rieng' | 'nhom';
  tenNhom: string | null;
  nick: { id: string; ten: string };
  luc: Date | null;
}

/** Nơi kèm dữ liệu THÔ (chỉ trong bộ nhớ, không trả thẳng): tên thấy ở nơi đó + nick riêng tư của ai. */
export interface NoiTho extends NoiNhan {
  /** uid của người này NHÌN TỪ nick của nơi đó. */
  zaloUid: string;
  ten: string | null;
  nickRiengTu: boolean;
  nickChu: string | null;
}

export interface UidUngVien {
  zaloUid: string;
  nick: { id: string; ten: string };
}

export interface UngVienTho {
  /** uid chính = uid ở nơi mới nhất. */
  zaloUid: string;
  /** Mọi uid của người này (mỗi nick một uid) — ít nhất `zaloUid`. */
  uids: UidUngVien[];
  /** Mọi uid CHẮC là cùng người (kể cả uid chưa từng nhắn — vd uid nick tự nhìn mình) — chỉ để loại trừ. */
  uidLienKet?: string[];
  luc: Date | null;
  noi: NoiTho[];
}

export const TEN_AN = '(ẩn — nick Riêng tư)';
export const TEN_CHUA_RO = '(chưa rõ tên)';

export interface UngVien {
  zaloUid: string;
  /** Mọi uid của người này theo nick (docs/77 §8b). Gán ⇒ gửi hết. */
  uids: UidUngVien[];
  ten: string;
  luc: Date | null;
  /** Tối đa 3 nơi gần nhất. */
  noi: NoiNhan[];
  soNoi: number;
  /** uid đang "được sai bot" ở trang agent-operators (AgentOperator bật) — gần như chắc là nhân viên. */
  dangSaiBot: boolean;
  tinCuoi: { noiDung: string; loai: string; luc: Date } | null;
  /** Tên chỉ thấy ở nick Riêng tư người xem không được xem ⇒ `ten` = TEN_AN. */
  anTen: boolean;
  /** Không có nơi nào người xem được xem nội dung ⇒ không có tin cuối. */
  anTinCuoi: boolean;
  redacted: boolean;
}

export interface TrangUngVien {
  tong: number;
  trang: number;
  moiTrang: number;
  ungVien: UngVien[];
  /** Lúc gom danh sách (bản giữ 60 s). */
  gomLuc: Date;
}

export const GIU_BAN_GOM_MS = 60_000;
export const MOI_TRANG_MAC_DINH = 30;
export const MOI_TRANG_TOI_DA = 100;
const SO_NOI_HIEN = 3;
const DAI_TIN = 120;

/** Chữ thường, bỏ dấu, đ → d, gộp khoảng trắng (tìm theo tên). */
export function boDau(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface DongGom {
  uid: string;
  conversation_id: string;
  loai: string;
  luc: Date | null;
  ten: string | null;
  ten_nhom: string | null;
  nick_id: string;
  nick_ten: string | null;
  /** zalo_accounts.privacy_mode = 'main'. */
  nick_rieng_tu: boolean;
  nick_chu: string | null;
}

/** Gom dòng (uid, hội thoại) thành một ứng viên mỗi uid; nơi sắp mới nhất trước. Thuần. */
export function gomTheoUid(dong: readonly DongGom[]): UngVienTho[] {
  const m = new Map<string, UngVienTho>();
  for (const d of dong) {
    if (!d.uid) continue;
    const noi: NoiTho = {
      zaloUid: d.uid,
      conversationId: d.conversation_id,
      loai: d.loai === 'group' ? 'nhom' : 'rieng',
      tenNhom: d.loai === 'group' ? d.ten_nhom : null,
      nick: { id: d.nick_id, ten: d.nick_ten?.trim() || 'Nick chưa đặt tên' },
      luc: d.luc,
      ten: d.ten?.trim() || null,
      nickRiengTu: d.nick_rieng_tu === true,
      nickChu: d.nick_chu,
    };
    const cu = m.get(d.uid);
    if (!cu) {
      m.set(d.uid, { zaloUid: d.uid, uids: [{ zaloUid: d.uid, nick: noi.nick }], luc: d.luc, noi: [noi] });
      continue;
    }
    cu.noi.push(noi);
    if ((d.luc?.getTime() ?? 0) > (cu.luc?.getTime() ?? 0)) cu.luc = d.luc;
  }
  return [...m.values()].map((u) => ({
    ...u, noi: u.noi.sort((a, b) => (b.luc?.getTime() ?? 0) - (a.luc?.getTime() ?? 0)),
  }));
}

/**
 * Gộp ứng viên của CÙNG người (`nhom`: uid → mọi {uid, nick} cùng người — bot-quyen-cung-nguoi.gomNguoi). uid chính = uid ở
 * nơi mới nhất; nơi sắp mới nhất trước; `uids` sắp theo tên nick rồi uid. Thuần.
 */
export function gopTheoNguoi(ds: readonly UngVienTho[], nhom: ReadonlyMap<string, ReadonlyArray<{ zaloUid: string }>>): UngVienTho[] {
  const khoa = (uid: string): string => {
    const g = nhom.get(uid);
    return g && g.length > 0 ? g.map((x) => x.zaloUid).sort()[0] : uid;
  };
  const theoNguoi = new Map<string, UngVienTho[]>();
  for (const u of ds) {
    const k = khoa(u.zaloUid);
    const cu = theoNguoi.get(k);
    if (cu) cu.push(u); else theoNguoi.set(k, [u]);
  }
  const ra: UngVienTho[] = [];
  const lienKet = (ds2: readonly UngVienTho[]) => {
    const tat = new Set<string>();
    for (const u of ds2) for (const x of u.uids) for (const y of nhom.get(x.zaloUid) ?? []) tat.add(y.zaloUid);
    return tat.size > 0 ? [...tat].sort() : undefined;
  };
  for (const nhomUv of theoNguoi.values()) {
    if (nhomUv.length === 1) {
      const lk = lienKet(nhomUv);
      ra.push(lk ? { ...nhomUv[0], uidLienKet: lk } : nhomUv[0]);
      continue;
    }
    const noi = nhomUv.flatMap((u) => u.noi).sort((a, b) => (b.luc?.getTime() ?? 0) - (a.luc?.getTime() ?? 0));
    const luc = nhomUv.reduce<Date | null>((m, u) => ((u.luc?.getTime() ?? 0) > (m?.getTime() ?? 0) ? u.luc : m), null);
    const uids = nhomUv.flatMap((u) => u.uids)
      .sort((a, b) => a.nick.ten.localeCompare(b.nick.ten, 'vi') || (a.zaloUid < b.zaloUid ? -1 : 1));
    ra.push({ zaloUid: noi[0]?.zaloUid ?? nhomUv[0].zaloUid, uids, uidLienKet: lienKet(nhomUv), luc, noi });
  }
  return ra;
}

/** Người xem có được xem nội dung của nơi này không (chính sách CRM: nick main ⇒ chỉ chủ nick đã mở khoá). */
export type XemNoi = (noi: NoiTho) => boolean;

export function xemNoiTheo(ctx: PrivacyContext): XemNoi {
  return (noi) => canSeeConversationContent(
    { zaloAccount: { privacyMode: noi.nickRiengTu ? 'main' : 'sub', ownerUserId: noi.nickChu ?? '' } }, ctx,
  );
}

const xemHet: XemNoi = () => true;

/** Tên hiển thị = tên mới nhất ở nơi XEM ĐƯỢC. Chỉ nơi bị che có tên ⇒ ẩn. Thuần. */
export function tenHienThi(u: Pick<UngVienTho, 'noi'>, xem: XemNoi): { ten: string | null; an: boolean } {
  for (const n of u.noi) if (n.ten && xem(n)) return { ten: n.ten, an: false };
  return { ten: null, an: u.noi.some((n) => n.ten && !xem(n)) };
}

function boTho(n: NoiTho): NoiNhan & { zaloUid: string } {
  return { zaloUid: n.zaloUid, ...boThoCong(n) };
}

function boThoCong(n: NoiTho): NoiNhan {
  return { conversationId: n.conversationId, loai: n.loai, tenNhom: n.tenNhom, nick: n.nick, luc: n.luc };
}

/**
 * Bỏ uid đã gán / nick của org, đánh dấu đang sai bot, tìm (tên không dấu hoặc uid), sắp (đang sai bot trước, rồi mới
 * nhắn trước), phân trang. Thuần.
 */
export type UngVienLoc = Omit<UngVien, 'tinCuoi' | 'anTinCuoi' | 'redacted'> & {
  /** Nơi mới nhất người xem được xem nội dung (lấy tin cuối) — null = không có. Không trả ra API. */
  noiXemDuoc: (NoiNhan & { zaloUid: string }) | null;
};

export function locVaPhanTrang(
  ds: readonly UngVienTho[],
  o: {
    loaiTru: ReadonlySet<string>; dangSaiBot: ReadonlySet<string>; tuKhoa?: string; trang?: number; moiTrang?: number;
    xem?: XemNoi;
  },
): { tong: number; trang: number; moiTrang: number; ungVien: UngVienLoc[] } {
  const q = boDau(o.tuKhoa ?? '');
  const xem = o.xem ?? xemHet;
  const moiTrang = Math.min(Math.max(Math.trunc(o.moiTrang ?? MOI_TRANG_MAC_DINH) || MOI_TRANG_MAC_DINH, 1), MOI_TRANG_TOI_DA);
  const loc = ds
    // Đã là nhân viên dưới BẤT KỲ uid nào của người này ⇒ bỏ cả dòng.
    .filter((u) => !o.loaiTru.has(u.zaloUid) && !u.uids.some((x) => o.loaiTru.has(x.zaloUid))
      && !(u.uidLienKet ?? []).some((x) => o.loaiTru.has(x)))
    .map((u) => ({ u, t: tenHienThi(u, xem) }))
    // Tìm theo tên CHỈ trên tên người xem được thấy — tìm theo tên bị che là dò ra tên đó.
    .filter(({ u, t }) => !q || u.uids.some((x) => x.zaloUid.includes(q)) || u.zaloUid.includes(q)
      || boDau(t.ten ?? '').includes(q))
    .map(({ u, t }) => {
      const noiXem = u.noi.find((n) => xem(n));
      return {
        zaloUid: u.zaloUid,
        uids: u.uids,
        ten: t.ten ?? (t.an ? TEN_AN : TEN_CHUA_RO),
        anTen: t.an,
        luc: u.luc,
        noi: u.noi.slice(0, SO_NOI_HIEN).map(boThoCong),
        soNoi: u.noi.length,
        dangSaiBot: o.dangSaiBot.has(u.zaloUid) || u.uids.some((x) => o.dangSaiBot.has(x.zaloUid)),
        noiXemDuoc: noiXem ? boTho(noiXem) : null,
      };
    })
    .sort((a, b) => Number(b.dangSaiBot) - Number(a.dangSaiBot)
      || (b.luc?.getTime() ?? 0) - (a.luc?.getTime() ?? 0)
      || (a.zaloUid < b.zaloUid ? -1 : a.zaloUid > b.zaloUid ? 1 : 0));
  const soTrang = Math.max(1, Math.ceil(loc.length / moiTrang));
  const trang = Math.min(Math.max(Math.trunc(o.trang ?? 1) || 1, 1), soTrang);
  return { tong: loc.length, trang, moiTrang, ungVien: loc.slice((trang - 1) * moiTrang, trang * moiTrang) };
}

// ── DB ──────────────────────────────────────────────────────────────────────

const banGom = new Map<string, { luc: Date; ds: UngVienTho[] }>();
/** Lần gom ĐANG chạy theo org — yêu cầu làm mới đồng thời dùng chung một lần (review P2-9). */
const dangGom = new Map<string, Promise<{ luc: Date; ds: UngVienTho[] }>>();
let soLanGom = 0;

/** Chỉ cho test. Trả số lần đã gom từ DB. */
export function _xoaBanGom(): number {
  banGom.clear();
  const n = soLanGom;
  soLanGom = 0;
  return n;
}

export function _soLanGom(): number {
  return soLanGom;
}

async function gom(orgId: string): Promise<UngVienTho[]> {
  const dong = await prisma.$queryRaw<DongGom[]>`
    WITH conv AS (
      SELECT c.id, c."threadType" AS loai, c.external_thread_id, c.last_message_at, c.contact_id, c.group_name,
             c.zalo_account_id
      FROM conversations c
      WHERE c.org_id = ${orgId} AND c.is_virtual = false AND c.deleted_at IS NULL
    ),
    rieng AS (
      SELECT c.external_thread_id AS uid, c.id AS conversation_id, c.last_message_at AS luc,
             COALESCE(NULLIF(ct.crm_name, ''), ct.full_name) AS ten
      FROM conv c LEFT JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.loai = 'user' AND c.external_thread_id IS NOT NULL AND c.external_thread_id NOT LIKE 'virtual:%'
        AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_type = 'contact')
    ),
    nhom AS (
      -- Tên = tên người gửi của tin MỚI NHẤT có tên (không phải max() theo chữ cái — review P2-9).
      SELECT m.sender_uid AS uid, m.conversation_id, max(m.sent_at) AS luc,
             (array_agg(m.sender_name ORDER BY m.sent_at DESC)
                FILTER (WHERE m.sender_name IS NOT NULL AND m.sender_name <> ''))[1] AS ten
      FROM messages m
      WHERE m.conversation_id IN (SELECT id FROM conv WHERE loai = 'group')
        AND m.sender_type = 'contact' AND m.sender_uid IS NOT NULL AND m.sender_uid <> ''
      GROUP BY m.sender_uid, m.conversation_id
    ),
    tat_ca AS (
      SELECT uid, conversation_id, luc, ten FROM rieng
      UNION ALL
      SELECT uid, conversation_id, luc, ten FROM nhom
    )
    SELECT t.uid, t.conversation_id, c.loai, t.luc, t.ten, c.group_name AS ten_nhom, c.zalo_account_id AS nick_id,
           z.display_name AS nick_ten, (z.privacy_mode = 'main') AS nick_rieng_tu, z.owner_user_id AS nick_chu
    FROM tat_ca t
    JOIN conv c ON c.id = t.conversation_id
    JOIN zalo_accounts z ON z.id = c.zalo_account_id`;
  // Cùng người ở nhiều nick ⇒ một dòng (docs/77 §8b).
  return gopTheoNguoi(gomTheoUid(dong), gomNguoi(await docLienKet(orgId)));
}

async function tinCuoi(
  cap: Array<{ khoa: string; uid: string; cid: string; rieng: boolean }>,
): Promise<Map<string, UngVien['tinCuoi']>> {
  // Chỉ gọi với nơi người xem ĐƯỢC xem nội dung (locVaPhanTrang.noiXemDuoc). `uid` = uid THEO NICK của nơi đó; kết quả
  // theo `khoa` (uid chính của dòng).
  if (cap.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ uid: string; content: string | null; content_type: string; sent_at: Date }>>`
    SELECT x.khoa AS uid, t.content, t.content_type, t.sent_at
    FROM unnest(${cap.map((c) => c.khoa)}::text[], ${cap.map((c) => c.uid)}::text[], ${cap.map((c) => c.cid)}::text[],
                ${cap.map((c) => c.rieng)}::boolean[])
         AS x(khoa, uid, cid, rieng)
    JOIN LATERAL (
      SELECT m.content, m.content_type, m.sent_at FROM messages m
      WHERE m.conversation_id = x.cid AND m.sender_type = 'contact'
        AND (m.sender_uid = x.uid OR (x.rieng AND m.sender_uid IS NULL))
      ORDER BY m.sent_at DESC LIMIT 1
    ) t ON true`;
  return new Map(rows.map((r) => [r.uid, {
    noiDung: (r.content ?? '').replace(/\s+/g, ' ').trim().slice(0, DAI_TIN),
    loai: r.content_type,
    luc: r.sent_at,
  }]));
}

/**
 * GET /nguoi-da-nhan — người đã nhắn cho shop mà CHƯA có trong BotNhanVien (và không phải nick của org). Gọi trong
 * request JWT (tenant context sẵn). `lamMoi` bỏ bản gom 60 s — yêu cầu đồng thời dùng chung MỘT lần gom. `ctx` = người
 * xem (privacy): thiếu ⇒ coi như chưa mở khoá gì (che mọi nick Riêng tư).
 */
export async function danhSachNguoiDaNhan(
  orgId: string,
  o: { tuKhoa?: string; trang?: number; moiTrang?: number; lamMoi?: boolean; bayGio?: Date; ctx?: PrivacyContext } = {},
): Promise<TrangUngVien> {
  const bayGio = o.bayGio ?? new Date();
  let ban = banGom.get(orgId);
  if (!ban || o.lamMoi || bayGio.getTime() - ban.luc.getTime() > GIU_BAN_GOM_MS) {
    let p = dangGom.get(orgId);
    if (!p) {
      soLanGom++;
      p = gom(orgId)
        .then((ds) => { const b = { luc: bayGio, ds }; banGom.set(orgId, b); return b; })
        .finally(() => dangGom.delete(orgId));
      dangGom.set(orgId, p);
    }
    ban = await p;
  }
  const [nv, nick, op] = await Promise.all([
    prisma.botNhanVien.findMany({ where: { orgId }, select: { zaloUid: true, uids: { select: { zaloUid: true } } } }),
    prisma.zaloAccount.findMany({ where: { orgId, zaloUid: { not: null } }, select: { zaloUid: true } }),
    prisma.agentOperator.findMany({ where: { orgId, enabled: true }, select: { zaloUid: true } }),
  ]);
  // MỌI uid của mọi nhân viên (mỗi nick một uid — docs/77 §8b).
  const loaiTru = new Set<string>([
    ...nv.flatMap((x) => [x.zaloUid, ...x.uids.map((u) => u.zaloUid)]), ...nick.map((x) => x.zaloUid!),
  ]);
  const ctx: PrivacyContext = o.ctx ?? { viewerUserId: null, orgId, privacyUnlocked: false };
  const trang = locVaPhanTrang(ban.ds, {
    loaiTru, dangSaiBot: new Set(op.map((x) => x.zaloUid)), tuKhoa: o.tuKhoa, trang: o.trang, moiTrang: o.moiTrang,
    xem: xemNoiTheo(ctx),
  });
  const tin = await tinCuoi(trang.ungVien
    .filter((u) => u.noiXemDuoc)
    .map((u) => ({
      khoa: u.zaloUid, uid: u.noiXemDuoc!.zaloUid, cid: u.noiXemDuoc!.conversationId, rieng: u.noiXemDuoc!.loai === 'rieng',
    })));
  return {
    tong: trang.tong,
    trang: trang.trang,
    moiTrang: trang.moiTrang,
    ungVien: trang.ungVien.map(({ noiXemDuoc, ...u }) => ({
      ...u,
      tinCuoi: noiXemDuoc ? (tin.get(u.zaloUid) ?? null) : null,
      anTinCuoi: !noiXemDuoc,
      redacted: u.anTen || !noiXemDuoc,
    })),
    gomLuc: ban.luc,
  };
}
