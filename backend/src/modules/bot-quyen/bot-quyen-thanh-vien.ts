// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §3.2) — thành viên của một hội thoại NHÓM + nhãn với bot:
//   nhan_vien   uid có trong BotNhanVien của org (kèm vai/trạng thái — kể cả cong_ty: người công ty)
//   nick_crm    uid là một nick Zalo của CRM trong org (chính nick nhìn nhóm, nick bot…) — không phải
//               người ngoài (bot cũng loại nick bot khỏi "người ngoài", docs/76 tam_im)
//   nguoi_ngoai còn lại — bot sẽ im phía NV ở nhóm có người ngoài (trừ nhóm khach)
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
  nhanVien: { id: string; tenGoi: string; vai: string; trangThai: string } | null;
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
}

/** Hạn giờ gọi Zalo — quá hạn thì rơi về người đã nhắn, không treo trang. */
const HET_GIO_ZALO_MS = 10_000;

/** Một lần quét ghi cùng một mốc cho cả nhóm; nới 10 phút cho lần quét bị ngắt rồi chạy tiếp. */
const CUA_SO_LAN_QUET_MS = 10 * 60_000;

/** Đường Zalo thật — như group-routes.ts `/members`. Import động: không kéo zalo-pool khi nạp module. */
export const docThanhVienZaloMacDinh: DocThanhVienZalo = async (accountId, groupId) => {
  const { zaloOps } = await import('../../shared/zalo-operations.js');
  type Grid = { memVerList?: unknown[] };
  const info = (await zaloOps.getGroupInfo(accountId, groupId)) as { gridInfoMap?: Record<string, Grid> } | null;
  const grid = info?.gridInfoMap?.[groupId] ?? Object.values(info?.gridInfoMap ?? {})[0];
  const rawIds = Array.isArray(grid?.memVerList) ? grid.memVerList : [];
  const uids = [...new Set(rawIds.map((k) => String(k).split('_')[0]).filter(Boolean))];
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

function hetGio<T>(p: Promise<T>, ms: number): Promise<T> {
  let hen: NodeJS.Timeout | undefined;
  const cho = new Promise<never>((_, reject) => {
    hen = setTimeout(() => reject(new Error(`Zalo không trả lời sau ${Math.round(ms / 1000)} giây`)), ms);
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
  opts: { lamMoi?: boolean; docZalo: DocThanhVienZalo },
): Promise<KetQuaThanhVien | null> {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId, threadType: 'group' },
    select: { id: true, zaloAccountId: true, externalThreadId: true },
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
      tho = await hetGio(opts.docZalo(conv.zaloAccountId, conv.externalThreadId), HET_GIO_ZALO_MS);
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

  const [nhanVien, nick] = uids.length === 0 ? [[], []] : await Promise.all([
    prisma.botNhanVien.findMany({
      where: { orgId, zaloUid: { in: uids } },
      select: { id: true, zaloUid: true, tenGoi: true, vai: true, trangThai: true },
    }),
    prisma.zaloAccount.findMany({ where: { orgId, zaloUid: { in: uids } }, select: { zaloUid: true } }),
  ]);
  const nvTheoUid = new Map(nhanVien.map((n) => [n.zaloUid, n]));
  const uidNick = new Set(nick.map((n) => n.zaloUid));

  const thanhVien: ThanhVienNhom[] = uids.map((uid) => {
    const nv = nvTheoUid.get(uid);
    const loai: LoaiThanhVien = nv ? 'nhan_vien' : uidNick.has(uid) ? 'nick_crm' : 'nguoi_ngoai';
    return {
      zaloUid: uid,
      ten: theoUid.get(uid)!.ten,
      loai,
      nhanVien: nv ? { id: nv.id, tenGoi: nv.tenGoi, vai: nv.vai, trangThai: nv.trangThai } : null,
    };
  }).sort((a, b) => a.ten.localeCompare(b.ten, 'vi'));

  return {
    conversationId: conv.id,
    nguon,
    nguonLuc,
    loiZalo,
    thanhVien,
    soNguoiNgoai: thanhVien.filter((t) => t.loai === 'nguoi_ngoai').length,
  };
}
