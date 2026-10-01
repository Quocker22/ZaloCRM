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
import { daDungHomNay, ghiDung } from './bot-quyen-ngan-sach.js';
import { NS_DOC_NHOM, tranNganSach } from './bot-quyen-danh-sach.js';

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
  /**
   * D6: ĐỀ XUẤT đang chờ nối uid này vào nhân viên CÓ SẴN (bot_nhan_vien_uid_de_xuat) ⇒ trang hiện "Nối" / "Không phải"
   * THAY cho "Đặt làm nhân viên" (tránh tạo NV thứ hai cho cùng người — vd Trần Hưng 3835… ở nick VTMT).
   */
  deXuatNhanVien: Array<{ id: string; tenGoi: string; vai: string; soTin: number | null }>;
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
  /**
   * Các nick CRM KHÁC của org (chọn cho "Đây là nick CRM …") — KỂ CẢ nick đã lưu trữ (`daLuuTru`; D2: staging Tiểu Mã
   * Nelia đã lưu trữ mà vẫn ở trong nhóm, bản trước không đánh dấu được). Nick lưu trữ vẫn là người CÔNG TY.
   */
  nickKhac: Array<{ id: string; ten: string; daLuuTru: boolean }>;
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

/**
 * Tên thành viên từ kết quả zca-js getGroupMembersInfo — `{ profiles: { [memberId]: GroupMemberProfile{ id, displayName,
 * zaloName, … } } }` (getGroupMembersInfo.ts:4-20). uid = trường `id` (không có ⇒ khoá bỏ đuôi phiên bản "_0" mà zca-js
 * thêm vào friend_pversion_map — :36). CHỈ lấy TÊN: globalId của endpoint này KHÔNG dùng (D1 — LIVE trả globalId của nick
 * gọi). THUẦN.
 */
export function bocHoSoThanhVien(kq: unknown): Map<string, string> {
  const ra = new Map<string, string>();
  const p = (kq as { profiles?: Record<string, { id?: unknown; displayName?: unknown; zaloName?: unknown } | null> } | null)?.profiles;
  if (!p || typeof p !== 'object') return ra;
  for (const [k, h] of Object.entries(p)) {
    if (!h) continue;
    const uid = String(h.id ?? k).trim().replace(/_\d+$/, '');
    const ten = String(h.displayName || h.zaloName || '').trim();
    if (uid && ten && !ra.has(uid)) ra.set(uid, ten);
  }
  return ra;
}

/** Đường Zalo thật — như group-routes.ts `/members`. Import động: không kéo zalo-pool khi nạp module. */
export const docThanhVienZaloMacDinh: DocThanhVienZalo = async (accountId, groupId) => {
  const { zaloOps } = await import('../../shared/zalo-operations.js');
  const uids = uidTuThongTinNhom(await zaloOps.getGroupInfo(accountId, groupId), groupId);
  if (uids.length === 0) return [];

  let ten = new Map<string, string>();
  try {
    ten = bocHoSoThanhVien(await zaloOps.getGroupMembersInfo(accountId, uids));
  } catch {
    // Tên là phụ — không có hồ sơ vẫn trả đủ uid (như group-scan-worker).
  }
  return uids.map((uid) => ({ zaloUid: uid, ten: ten.get(uid) || uid }));
};

// ── P3-4: ngăn Thành viên đọc Zalo trong NGÂN SÁCH group_read của Quyền bot + đệm ngắn ─────────────────────────────
/** Mỗi lần đọc Zalo của ngăn = getGroupInfo + getGroupMembersInfo (group_read). */
export const LOI_GOI_MOI_LAN_DOC = 2;
/** Đệm kết quả đọc Zalo theo (nick, nhóm) — mở lại ngăn / đánh dấu nick CRM rồi tải lại trong khoảng này không gọi Zalo. */
export const DEM_THANH_VIEN_MS = 2 * 60_000;
const demThanhVien = new Map<string, { luc: number; tho: ThanhVienTho[] }>();
let layTranDocNhom: (nick: string) => Promise<number> = async (nick) => {
  const { getEffectiveLimit } = await import('../zalo/sdk-limit-service.js');
  return tranNganSach((await getEffectiveLimit(nick, 'group_read')).daily);
};

/** Chỉ cho test: trần ngân sách đọc nhóm/ngày (null = thật). Luôn xoá đệm. */
export function _datThanhVienChoTest(o: { tranNgay?: ((nick: string) => Promise<number>) | null } = {}): void {
  if (o.tranNgay !== undefined) {
    layTranDocNhom = o.tranNgay ?? (async (nick) => {
      const { getEffectiveLimit } = await import('../zalo/sdk-limit-service.js');
      return tranNganSach((await getEffectiveLimit(nick, 'group_read')).daily);
    });
  }
  demThanhVien.clear();
}

/**
 * Đọc thành viên từ Zalo cho ngăn: đệm DEM_THANH_VIEN_MS (`lamMoi` bỏ qua đệm), mỗi lần gọi thật tính LOI_GOI_MOI_LAN_DOC
 * lượt vào ngân sách `ds_group_read` của nick (chung với đọc danh sách nhóm — bot-quyen-danh-sach.ts). Hết ngân sách ⇒ ném
 * (người gọi rơi về người đã nhắn). Trả kèm mốc đọc.
 */
async function docZaloCoNganSach(
  docZalo: DocThanhVienZalo, nick: string, groupId: string, lamMoi: boolean, hetGioMs: number,
): Promise<{ tho: ThanhVienTho[]; luc: Date }> {
  const khoa = `${nick}|${groupId}`;
  const dem = demThanhVien.get(khoa);
  if (!lamMoi && dem && Date.now() - dem.luc < DEM_THANH_VIEN_MS) return { tho: dem.tho, luc: new Date(dem.luc) };
  const tran = await layTranDocNhom(nick).catch(() => 1);
  if (await daDungHomNay(nick, NS_DOC_NHOM) + LOI_GOI_MOI_LAN_DOC > tran) {
    throw new Error('Đã dùng hết ngân sách đọc nhóm Zalo hôm nay của nick này');
  }
  for (let i = 0; i < LOI_GOI_MOI_LAN_DOC; i++) await ghiDung(nick, NS_DOC_NHOM);
  const tho = await hetGio(docZalo(nick, groupId), hetGioMs);
  if (tho.length > 0) demThanhVien.set(khoa, { luc: Date.now(), tho });
  return { tho, luc: new Date() };
}

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
      const doc = await docZaloCoNganSach(opts.docZalo, conv.zaloAccountId, conv.externalThreadId, !!opts.lamMoi,
        opts.hetGioMs ?? HET_GIO_ZALO_MS);
      tho = doc.tho;
      if (tho.length === 0) throw new Error('Zalo không trả danh sách thành viên');
      nguon = 'zalo';
      nguonLuc = doc.luc;
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
  const dx = uids.length === 0 ? [] : await prisma.botNhanVienUidDeXuat.findMany({
    where: { orgId, zaloUid: { in: uids } },
    select: { zaloUid: true, soTin: true, nhanVien: { select: { id: true, tenGoi: true, vai: true } } },
    orderBy: [{ zaloUid: 'asc' }, { nhanVienId: 'asc' }],
  });
  const deXuatNv = new Map<string, ThanhVienNhom['deXuatNhanVien']>();
  for (const r of dx) deXuatNv.set(r.zaloUid, [...(deXuatNv.get(r.zaloUid) ?? []), { ...r.nhanVien, soTin: r.soTin }]);
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
      deXuatNhanVien: !nv && !nc ? deXuatNv.get(uid) ?? [] : [],
    };
  }).sort((a, b) => a.ten.localeCompare(b.ten, 'vi'));

  const nickKhac = (await prisma.zaloAccount.findMany({
    where: { orgId, id: { not: conv.zaloAccountId } }, select: { id: true, displayName: true, archivedAt: true },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
  })).map((n) => ({ id: n.id, ten: n.displayName?.trim() || 'Nick chưa đặt tên', daLuuTru: !!n.archivedAt }))
    .sort((a, b) => Number(a.daLuuTru) - Number(b.daLuuTru)); // nick đang dùng lên trước
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
