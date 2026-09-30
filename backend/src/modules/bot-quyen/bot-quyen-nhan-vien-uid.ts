// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §8b, 30/09) — MỌI uid Zalo của một nhân viên (bảng bot_nhan_vien_uid).
//
// Một người = một BotNhanVien; mỗi nick nhìn người đó bằng một uid KHÁC ⇒ một dòng BotNhanVienUid cho mỗi uid. Mọi chỗ
// hỏi "uid này có phải nhân viên không" (mặc định nhóm, nhãn thành viên, "Chờ gán", payload cho bot) đọc bảng này, KHÔNG
// đọc BotNhanVien.zaloUid (chỉ là uid lúc gán).
//
// Bổ sung tự động (`boSungUidNhanVien`): uid của CÙNG người ở nick khác — bằng chứng chắc (bot-quyen-cung-nguoi.ts: cùng
// mã tin nhắn trong nhóm chung, cùng globalId). uid đã thuộc nhân viên KHÁC ⇒ không cướp, chỉ cảnh báo (hai dòng nhân viên
// là cùng một người — chủ gộp tay). Mỗi lần thêm ghi một dòng nhật ký "tự động".
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';
import { docLienKet, gomNguoi, nickCuaUid, type LienKet, type NguonLienKet } from './bot-quyen-cung-nguoi.js';

/** = bot-quyen-danh-sach.ts AI_TU_DONG (không import để tránh vòng import; test khoá bằng nhau). */
export const AI_TU_DONG_UID = 'tu_dong';

export type NguonUid = 'chon' | NguonLienKet;

export interface UidMoi {
  zaloUid: string;
  zaloAccountId: string | null;
  nguon: NguonUid;
}

type NvTomTat = { id: string; tenGoi: string; vai: string; trangThai: string };

/**
 * uid → nhân viên sở hữu: MỌI uid ở bot_nhan_vien_uid + uid chính (BotNhanVien.zaloUid — luôn tính, kể cả dòng thiếu
 * bảng uid). `uids` có ⇒ chỉ các uid đó.
 */
export async function nhanVienTheoUid(orgId: string, uids?: readonly string[]): Promise<Map<string, NvTomTat>> {
  const loc = uids ? [...uids] : null;
  const chon = { id: true, tenGoi: true, vai: true, trangThai: true } as const;
  const [chinh, phu] = await Promise.all([
    prisma.botNhanVien.findMany({ where: { orgId, ...(loc ? { zaloUid: { in: loc } } : {}) }, select: { zaloUid: true, ...chon } }),
    prisma.botNhanVienUid.findMany({
      where: { orgId, ...(loc ? { zaloUid: { in: loc } } : {}) }, select: { zaloUid: true, nhanVien: { select: chon } },
    }),
  ]);
  const ra = new Map<string, NvTomTat>();
  for (const r of phu) ra.set(r.zaloUid, r.nhanVien);
  for (const { zaloUid, ...nv } of chinh) ra.set(zaloUid, nv);
  return ra;
}

/** uid → trạng thái của nhân viên sở hữu (mọi uid của mọi NV trong org). */
export async function trangThaiTheoUid(orgId: string): Promise<Map<string, string>> {
  const m = await nhanVienTheoUid(orgId);
  return new Map([...m].map(([uid, nv]) => [uid, nv.trangThai]));
}

function nguonCua(uid: string, lienKet: readonly LienKet[]): NguonLienKet {
  return lienKet.some((l) => l.nguon === 'cung_tin' && (l.a === uid || l.b === uid)) ? 'cung_tin' : 'global_id';
}

/**
 * `uids` (đã chọn) + mọi uid CÙNG người ở nick khác. Nick của từng uid kèm theo (null = chưa gặp ở đâu). THUẦN phần gộp;
 * đọc liên kết + nick từ DB.
 */
export async function uidCungNguoi(orgId: string, uids: readonly string[]): Promise<UidMoi[]> {
  const chon = [...new Set(uids.filter(Boolean))];
  if (chon.length === 0) return [];
  const lienKet = await docLienKet(orgId, chon);
  const nhom = gomNguoi(lienKet);
  const ra = new Map<string, UidMoi>();
  for (const u of chon) ra.set(u, { zaloUid: u, zaloAccountId: null, nguon: 'chon' });
  for (const u of chon) {
    for (const x of nhom.get(u) ?? []) {
      const cu = ra.get(x.zaloUid);
      if (cu) { cu.zaloAccountId = cu.zaloAccountId ?? x.zaloAccountId; continue; }
      ra.set(x.zaloUid, { zaloUid: x.zaloUid, zaloAccountId: x.zaloAccountId, nguon: nguonCua(x.zaloUid, lienKet) });
    }
  }
  const thieu = [...ra.values()].filter((x) => !x.zaloAccountId).map((x) => x.zaloUid);
  if (thieu.length > 0) {
    const nick = await nickCuaUid(orgId, thieu);
    for (const u of thieu) ra.get(u)!.zaloAccountId = nick.get(u) ?? null;
  }
  return [...ra.values()].sort((a, b) => (a.zaloUid < b.zaloUid ? -1 : a.zaloUid > b.zaloUid ? 1 : 0));
}

const lanBoSung = new Map<string, number>();
export const NHIP_BO_SUNG_MS = 60_000;

/** Chỉ cho test. */
export function _xoaNhipBoSung(): void {
  lanBoSung.clear();
}

/**
 * Bổ sung uid cùng người cho MỌI nhân viên của org + điền nick còn thiếu. `nhip` ⇒ bỏ qua nếu vừa chạy trong
 * NHIP_BO_SUNG_MS (đường GET trang). Trả số uid đã thêm. Không bao giờ ném cho người gọi đường đọc (bọc catch ở đó).
 */
export async function boSungUidNhanVien(orgId: string, o: { nhip?: boolean } = {}): Promise<number> {
  const bayGio = Date.now();
  if (o.nhip && bayGio - (lanBoSung.get(orgId) ?? 0) < NHIP_BO_SUNG_MS) return 0;
  lanBoSung.set(orgId, bayGio);
  return withTenant(orgId, async () => {
    const coSan = await prisma.botNhanVienUid.findMany({
      where: { orgId }, select: { id: true, nhanVienId: true, zaloUid: true, zaloAccountId: true },
    });
    if (coSan.length === 0) return 0;
    const lienKet = await docLienKet(orgId, coSan.map((r) => r.zaloUid));
    const nhom = gomNguoi(lienKet);
    const chuCua = new Map(coSan.map((r) => [r.zaloUid, r.nhanVienId]));
    const nickDaBiet = new Map<string, string>();
    for (const ds of nhom.values()) for (const x of ds) nickDaBiet.set(x.zaloUid, x.zaloAccountId);
    const thieuNick = coSan.filter((r) => !r.zaloAccountId && !nickDaBiet.has(r.zaloUid)).map((r) => r.zaloUid);
    const nickKhac = await nickCuaUid(orgId, thieuNick);

    // Theo từng NV: uid mới (chưa ai giữ). uid của NV khác ⇒ cảnh báo, không đụng.
    const moiTheoNv = new Map<string, UidMoi[]>();
    for (const r of coSan) {
      for (const x of nhom.get(r.zaloUid) ?? []) {
        const chu = chuCua.get(x.zaloUid);
        if (chu === r.nhanVienId) continue;
        if (chu !== undefined) {
          logger.warn(`[bot-quyen] uid ${x.zaloUid} và ${r.zaloUid} là CÙNG một người nhưng thuộc hai nhân viên khác nhau `
            + `(${chu} / ${r.nhanVienId}) — không tự gộp`);
          continue;
        }
        chuCua.set(x.zaloUid, r.nhanVienId);
        const ds = moiTheoNv.get(r.nhanVienId) ?? [];
        ds.push({ zaloUid: x.zaloUid, zaloAccountId: x.zaloAccountId, nguon: nguonCua(x.zaloUid, lienKet) });
        moiTheoNv.set(r.nhanVienId, ds);
      }
    }

    const dienNick = coSan
      .filter((r) => !r.zaloAccountId)
      .map((r) => ({ id: r.id, nick: nickDaBiet.get(r.zaloUid) ?? nickKhac.get(r.zaloUid) ?? null }))
      .filter((x): x is { id: string; nick: string } => !!x.nick);
    if (moiTheoNv.size === 0 && dienNick.length === 0) return 0;

    let soThem = 0;
    await tenantTransaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-quyen:${orgId}`}))`;
      for (const d of dienNick) {
        await tx.botNhanVienUid.updateMany({ where: { id: d.id, zaloAccountId: null }, data: { zaloAccountId: d.nick } });
      }
      for (const [nhanVienId, ds] of [...moiTheoNv].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const nv = await tx.botNhanVien.findFirst({
          where: { id: nhanVienId, orgId }, select: { id: true, tenGoi: true, uids: { select: { zaloUid: true } } },
        });
        if (!nv) continue;
        // Đọc lại trong khoá: uid có thể vừa được gán cho người khác.
        const daCo = new Set((await tx.botNhanVienUid.findMany({
          where: { orgId, zaloUid: { in: ds.map((x) => x.zaloUid) } }, select: { zaloUid: true },
        })).map((x) => x.zaloUid));
        const them = ds.filter((x) => !daCo.has(x.zaloUid));
        if (them.length === 0) continue;
        await tx.botNhanVienUid.createMany({
          data: them.map((x) => ({ orgId, nhanVienId, zaloUid: x.zaloUid, zaloAccountId: x.zaloAccountId, nguon: x.nguon })),
        });
        const truoc = nv.uids.map((x) => x.zaloUid).sort();
        await tx.botQuyenNhatKy.create({
          data: {
            orgId, aiId: AI_TU_DONG_UID, doiTuong: 'nhan_vien', doiTuongId: nhanVienId,
            truoc: { tenGoi: nv.tenGoi, uids: truoc },
            sau: { tenGoi: nv.tenGoi, uids: [...truoc, ...them.map((x) => x.zaloUid)].sort() },
            lyDo: `nhận ra cùng người ở nick khác (${them.map((x) => (x.nguon === 'cung_tin' ? 'cùng tin nhắn trong nhóm chung' : 'cùng globalId Zalo')).filter((v, i, a) => a.indexOf(v) === i).join(', ')})`,
          },
        });
        soThem += them.length;
      }
    });
    return soThem;
  });
}
