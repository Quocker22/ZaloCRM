// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §3.2) — thành viên của một hội thoại NHÓM + nhãn với bot. Nhãn phải khớp cách BOT
// đếm người ngoài (docs/76 tam_im): uid là người ngoài trừ khi có trong actor_identities (⇐ BotNhanVien) hoặc
// trong bảng nick_bot của bot (⇐ `nick_uid` của payload công khai = nick CỦA CHÍNH hội thoại). Bot không biết
// gì về các nick CRM khác, nên:
//   nhan_vien   uid là MỘT trong các uid của một BotNhanVien của org (bot_nhan_vien_uid — mỗi nick một uid, docs/77 §8b;
//               kèm vai/trạng thái — kể cả cong_ty: người công ty)
//   nick_crm    uid là nick CRM CỦA CHÍNH hội thoại này (conversation.zaloAccount.zaloUid), HOẶC nick CRM KHÁC của org
//               nhìn từ nick của nhóm (bảng bot_nick_crm_uid — §8b-an-toàn: máy nhận ra bằng tin chung chặt hoặc chủ
//               đánh dấu "Đây là nick CRM …"; bot nhận qua payload `nick_crm` ⇒ nick_bot) — kèm `nickCrm` {id, ten}.
//   nguoi_ngoai còn lại — kể cả nick CRM khác CHƯA nhận ra (trang gợi ý "Đây là nick CRM …" / người công ty).
//   laNickCrm   true khi uid là MỘT nick Zalo bất kỳ của org (tự nhìn, hoặc đã nhận ra nhìn từ nick nhóm).
// Thứ tự xét: nhan_vien trước (nick CRM đã được xếp vai là nhân viên như mọi người), rồi nick_crm, rồi nguoi_ngoai.
//
// NGUỒN thành viên, theo thứ tự (trả kèm `nguon` để trang nói rõ đang xem gì):
//   1. da_quet  — bảng group_members (tính năng "Quét group" đã LƯU sẵn trong DB): không tốn lượt gọi
//                 Zalo, không cần nick đang kết nối. Chỉ lấy người thấy ở LẦN QUÉT MỚI NHẤT (người đã rời
//                 nhóm giữ lastSeenAt cũ). `?lamMoi=1` bỏ qua bước này.
//   2. zalo     — gọi Zalo trực tiếp (getGroupInfo → memVerList → getGroupMembersInfo), đúng đường của
//                 GET /zalo-accounts/:id/groups/:gid/members. Cần nick đang kết nối; có hạn giờ.
//   3. tin_nhan — Zalo lỗi/hết giờ/rỗng ⇒ những người ĐÃ NHẮN trong hội thoại (bảng messages). Thiếu
//                 người chưa từng nhắn; `loiZalo` nói vì sao phải rơi xuống đây.
import { prisma } from '../../shared/database/prisma-client.js';
import { nhanVienTheoUid } from './bot-quyen-nhan-vien-uid.js';
import { NGUON_HIEU_LUC } from './bot-quyen-nick-crm.js';

export interface ThanhVienTho {
  zaloUid: string;
  ten: string;
}

/** Đọc thành viên nhóm trực tiếp từ Zalo. Tiêm được (test thay bằng hàm giả — không gọi mạng). */
export type DocThanhVienZalo = (zaloAccountId: string, groupId: string) => Promise<ThanhVienTho[]>;

export type NguonThanhVien = 'da_quet' | 'zalo' | 'tin_nhan';
export type LoaiThanhVien = 'nhan_vien' | 'nick_crm' | 'nguoi_ngoai';

export interface ThanhVienNhom {
  zaloUid: string;
  ten: string;
  loai: LoaiThanhVien;
  /** uid là một nick Zalo của CRM trong org (bất kể nhãn). */
  laNickCrm: boolean;
  nhanVien: { id: string; tenGoi: string; vai: string; trangThai: string } | null;
  /** Nick CRM KHÁC của org mà uid này là (nhìn từ nick của nhóm) — null nếu không phải. */
  nickCrm: { id: string; ten: string; nguon: string } | null;
  /** ĐỀ XUẤT (tin chung — chưa hiệu lực): có vẻ là nick CRM X; chủ bấm "Đúng" (POST nick-crm) / "Không phải" (DELETE). */
  nickCrmDeXuat: { id: string; ten: string; soTin: number | null } | null;
}

export interface KetQuaThanhVien {
  conversationId: string;
  nguon: NguonThanhVien;
  /** da_quet: mốc lần quét mới nhất · zalo: lúc đọc · tin_nhan: null */
  nguonLuc: Date | null;
  /** Vì sao không đọc được từ Zalo (chỉ khi nguon='tin_nhan'). */
  loiZalo: string | null;
  thanhVien: ThanhVienNhom[];
  soNguoiNgoai: number;
  /** Các nick CRM KHÁC của org (chọn cho "Đây là nick CRM …"). */
  nickKhac: Array<{ id: string; ten: string }>;
}

/** Hạn giờ gọi Zalo — quá hạn thì rơi về người đã nhắn, không treo trang. */
export const HET_GIO_ZALO_MS = 10_000;

/** Một lần quét ghi cùng một mốc cho cả nhóm; nới 10 phút cho lần quét bị ngắt rồi chạy tiếp. */
const CUA_SO_LAN_QUET_MS = 10 * 60_000;

/**
 * uid thành viên từ kết quả getGroupInfo: `gridInfoMap[groupId].memVerList` = ["<uid>_<phiên bản>", …]
 * (không có khoá đúng id ⇒ nhóm đầu tiên, như group-routes `/members`). Gộp trùng, bỏ rỗng. Thuần.
 */
export function uidTuThongTinNhom(info: unknown, groupId: string): string[] {
  const map = (info as { gridInfoMap?: Record<string, { memVerList?: unknown }> } | null)?.gridInfoMap;
  if (!map || typeof map !== 'object') return [];
  const grid = map[groupId] ?? Object.values(map)[0];
  const raw = Array.isArray(grid?.memVerList) ? grid.memVerList : [];
  return [...new Set(raw.map((k) => String(k).split('_')[0]).filter(Boolean))];
}

/** Đường Zalo thật — như group-routes.ts `/members`. Import động: không kéo zalo-pool khi nạp module. */
export const docThanhVienZaloMacDinh: DocThanhVienZalo = async (accountId, groupId) => {
  const { zaloOps } = await import('../../shared/zalo-operations.js');
  const uids = uidTuThongTinNhom(await zaloOps.getGroupInfo(accountId, groupId), groupId);
  if (uids.length === 0) return [];

  type Prof = { id?: string; displayName?: string; zaloName?: string };
  let profiles: Record<string, Prof> = {};
  try {
    const prof = (await zaloOps.getGroupMembersInfo(accountId, uids)) as { profiles?: Record<string, Prof> } | null;
    profiles = prof?.profiles ?? {};
  } catch {
    // Tên là phụ — không có hồ sơ vẫn trả đủ uid (như group-scan-worker).
  }
  return uids.map((uid) => {
    const p = profiles[uid];
    return { zaloUid: uid, ten: p?.displayName || p?.zaloName || uid };
  });
};

/** Chờ `p` tối đa `ms`; quá hạn ⇒ từ chối (lời gọi gốc vẫn chạy tiếp nền — như `/members`). */
export function hetGio<T>(p: Promise<T>, ms: number): Promise<T> {
  let hen: NodeJS.Timeout | undefined;
  const khoang = ms >= 1000 ? `${Math.round(ms / 1000)} giây` : `${ms} ms`;
  const cho = new Promise<never>((_, reject) => {
    hen = setTimeout(() => reject(new Error(`Zalo không trả lời sau ${khoang}`)), ms);
  });
  return Promise.race([p, cho]).finally(() => clearTimeout(hen));
}

async function docBanQuet(
  orgId: string, zaloAccountId: string, groupId: string,
): Promise<{ luc: Date; thanhVien: ThanhVienTho[] } | null> {
  const where = { orgId, zaloAccountId, groupId };
  const agg = await prisma.groupMember.aggregate({ where, _max: { lastSeenAt: true } });
  const luc = agg._max.lastSeenAt;
  if (!luc) return null;
  const rows = await prisma.groupMember.findMany({
    where: { ...where, lastSeenAt: { gte: new Date(luc.getTime() - CUA_SO_LAN_QUET_MS) } },
    select: { memberUid: true, displayName: true, zaloName: true },
  });
  return {
    luc,
    thanhVien: rows.map((r) => ({ zaloUid: r.memberUid, ten: r.displayName || r.zaloName || r.memberUid })),
  };
}

async function docNguoiDaNhan(conversationId: string): Promise<ThanhVienTho[]> {
  // DISTINCT ON thay cho `distinct` của Prisma (Prisma lọc trùng TRONG RAM sau khi kéo hết tin).
  // Tên: tin mới nhất có tên.
  const rows = await prisma.$queryRaw<Array<{ sender_uid: string; sender_name: string | null }>>`
    SELECT DISTINCT ON (sender_uid) sender_uid, sender_name
    FROM messages
    WHERE conversation_id = ${conversationId} AND sender_uid IS NOT NULL AND sender_uid <> ''
    ORDER BY sender_uid, (sender_name IS NULL), sent_at DESC`;
  return rows.map((r) => ({ zaloUid: r.sender_uid, ten: r.sender_name || r.sender_uid }));
}

/**
 * Thành viên + nhãn của một hội thoại nhóm trong org. `null` = không có hội thoại NHÓM đó trong org.
 * Gọi trong request JWT (authMiddleware đã gắn tenant context).
 */
export async function layThanhVienNhom(
  orgId: string,
  conversationId: string,
  opts: { lamMoi?: boolean; docZalo: DocThanhVienZalo; hetGioMs?: number },
): Promise<KetQuaThanhVien | null> {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId, threadType: 'group' },
    select: { id: true, zaloAccountId: true, externalThreadId: true, zaloAccount: { select: { zaloUid: true } } },
  });
  if (!conv) return null;

  let nguon: NguonThanhVien | null = null;
  let nguonLuc: Date | null = null;
  let loiZalo: string | null = null;
  let tho: ThanhVienTho[] = [];

  if (!opts.lamMoi && conv.externalThreadId) {
    const quet = await docBanQuet(orgId, conv.zaloAccountId, conv.externalThreadId);
    if (quet) {
      nguon = 'da_quet';
      nguonLuc = quet.luc;
      tho = quet.thanhVien;
    }
  }

  if (!nguon) {
    try {
      if (!conv.externalThreadId) throw new Error('Hội thoại nhóm thiếu mã nhóm Zalo');
      tho = await hetGio(opts.docZalo(conv.zaloAccountId, conv.externalThreadId), opts.hetGioMs ?? HET_GIO_ZALO_MS);
      if (tho.length === 0) throw new Error('Zalo không trả danh sách thành viên');
      nguon = 'zalo';
      nguonLuc = new Date();
    } catch (err) {
      loiZalo = err instanceof Error ? err.message : String(err);
      tho = await docNguoiDaNhan(conv.id);
      nguon = 'tin_nhan';
      nguonLuc = null;
    }
  }

  // Gộp trùng uid (giữ tên đầu tiên có nghĩa).
  const theoUid = new Map<string, ThanhVienTho>();
  for (const t of tho) {
    if (!t.zaloUid) continue;
    if (!theoUid.has(t.zaloUid)) theoUid.set(t.zaloUid, t);
  }
  const uids = [...theoUid.keys()];

  // Nhân viên theo MỌI uid của họ (docs/77 §8b): thành viên là uid THEO NICK của nhóm này.
  const [nvTheoUid, nick] = uids.length === 0 ? [new Map(), []] as const : await Promise.all([
    nhanVienTheoUid(orgId, uids),
    prisma.zaloAccount.findMany({ where: { orgId, zaloUid: { in: uids } }, select: { zaloUid: true } }),
  ]);
  const uidNick = new Set(nick.map((n) => n.zaloUid));
  // Nick CRM khác nhìn từ nick của nhóm (§8b-an-toàn) — đọc bảng đã nhận ra (rẻ; không truy vấn tin nhắn mỗi lần mở ngăn).
  const nhin = uids.length === 0 ? [] : await prisma.botNickCrmUid.findMany({
    where: { orgId, zaloAccountId: conv.zaloAccountId, zaloUid: { in: uids }, tuChoi: false },
    select: { zaloUid: true, nguon: true, bangChung: true, nick: { select: { id: true, displayName: true } } },
  });
  const tenNick = (r: (typeof nhin)[number]) => r.nick.displayName?.trim() || 'Nick chưa đặt tên';
  const nickNhin = new Map(nhin.filter((r) => (NGUON_HIEU_LUC as readonly string[]).includes(r.nguon))
    .map((r) => [r.zaloUid, { id: r.nick.id, ten: tenNick(r), nguon: r.nguon }]));
  const nickDeXuat = new Map(nhin.filter((r) => r.nguon === 'cung_tin').map((r) => [r.zaloUid, {
    id: r.nick.id, ten: tenNick(r), soTin: typeof (r.bangChung as { soTin?: unknown } | null)?.soTin === 'number'
      ? (r.bangChung as { soTin: number }).soTin : null,
  }]));
  for (const u of nickNhin.keys()) uidNick.add(u);
  const uidNickNhom = conv.zaloAccount.zaloUid;

  const thanhVien: ThanhVienNhom[] = uids.map((uid) => {
    const nv = nvTheoUid.get(uid);
    const nc = nickNhin.get(uid) ?? null;
    const loai: LoaiThanhVien = nv ? 'nhan_vien' : uid === uidNickNhom || nc ? 'nick_crm' : 'nguoi_ngoai';
    return {
      zaloUid: uid,
      ten: theoUid.get(uid)!.ten,
      loai,
      laNickCrm: uidNick.has(uid),
      nhanVien: nv ? { id: nv.id, tenGoi: nv.tenGoi, vai: nv.vai, trangThai: nv.trangThai } : null,
      nickCrm: nc,
      nickCrmDeXuat: !nv && !nc ? nickDeXuat.get(uid) ?? null : null,
    };
  }).sort((a, b) => a.ten.localeCompare(b.ten, 'vi'));

  const nickKhac = (await prisma.zaloAccount.findMany({
    where: { orgId, id: { not: conv.zaloAccountId }, archivedAt: null }, select: { id: true, displayName: true }, orderBy: { displayName: 'asc' },
  })).map((n) => ({ id: n.id, ten: n.displayName?.trim() || 'Nick chưa đặt tên' }));
  return {
    conversationId: conv.id,
    nguon,
    nguonLuc,
    loiZalo,
    thanhVien,
    soNguoiNgoai: thanhVien.filter((t) => t.loai === 'nguoi_ngoai').length,
    nickKhac,
  };
}
