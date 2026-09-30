// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §8b) — MỌI uid Zalo của một nhân viên (bảng bot_nhan_vien_uid) + ĐỀ XUẤT + TỪ CHỐI.
//
// Một người = một BotNhanVien; mỗi nick nhìn người đó bằng một uid KHÁC ⇒ một dòng BotNhanVienUid cho mỗi uid. Mọi chỗ
// hỏi "uid này có phải nhân viên không" (mặc định nhóm, nhãn thành viên, "Chờ gán", payload cho bot) đọc bảng này, KHÔNG
// đọc BotNhanVien.zaloUid (chỉ là uid lúc gán).
//
// Nguồn một uid (`nguon`): chon (uid lúc gán / chủ thêm tay) · zalo_global_id (máy nối — globalId SỐNG trùng) ·
// chu_xac_nhan (chủ bấm "Nối" một đề xuất).
// §8b-an-toàn, DANH TÍNH CHẮC (quyết định người điều phối vòng 2):
//   • CHÍNH — globalId CRM tự đọc từ Zalo (bot-quyen-danh-tinh.ts, bảng hệ thống): uid ở nick khác mang CÙNG globalId sống
//     với uid chủ chọn/xác nhận của NV ⇒ tự gắn cho MỌI vai (kể cả admin — globalId Zalo là bằng chứng có thẩm quyền), nhật
//     ký kèm bằng chứng (globalId, nick + lúc đọc của hai phía). NV có hai globalId khác nhau ⇒ không nối gì (dữ liệu lệch).
//   • PHỤ — tin chung chặt (bot-quyen-cung-nguoi.ts) ⇒ ĐỀ XUẤT cho mọi vai (bot_nhan_vien_uid_de_xuat), KHÔNG tự gắn.
//   • cặp (NV, uid) chủ đã từ chối / đã gỡ (bot_nhan_vien_uid_tu_choi) ⇒ không bao giờ tự gắn / đề xuất lại;
//   • uid là nick CRM của org (tự nhìn hoặc nhìn từ nick khác) ⇒ không bao giờ là uid nhân viên;
//   • uid đã thuộc NV KHÁC ⇒ không cướp, chỉ cảnh báo.
// Lưới an toàn: dòng cung_tin (bản trước tự gắn bằng tin chung) ⇒ chuyển về đề xuất ở mỗi vòng.
import type { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';
import {
  bangChungGiua, docLienKetHoacNull, gomNguoi, nickCuaUid, type BangChung,
} from './bot-quyen-cung-nguoi.js';
import { boSungNickCrm, NGUON_HIEU_LUC } from './bot-quyen-nick-crm.js';
import { docBanDanhTinh, sdtNhanVien } from './bot-quyen-danh-tinh.js';

/** = bot-quyen-danh-sach.ts AI_TU_DONG (không import để tránh vòng import; test khoá bằng nhau). */
export const AI_TU_DONG_UID = 'tu_dong';

export type NguonUid = 'chon' | 'zalo_global_id' | 'chu_xac_nhan';

/** Nguồn uid TIN ĐƯỢC (hạt giống cho nối globalId / đề xuất). */
export const NGUON_TIN = ['chon', 'chu_xac_nhan', 'zalo_global_id'] as const;

/** uid suy ra là cùng người (chưa quyết gắn hay đề xuất). */
export interface UidSuyRa {
  zaloUid: string;
  zaloAccountId: string | null;
  bangChung: BangChung;
}

type NvTomTat = { id: string; tenGoi: string; vai: string; trangThai: string };
type Tx = Parameters<Parameters<typeof tenantTransaction>[0]>[0];

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

/** uid của MỌI nick CRM của org: uid tự nhìn (ZaloAccount.zaloUid) + nick nhìn từ nick khác (bot_nick_crm_uid hiệu lực). */
export async function uidNickCuaOrg(orgId: string, db: Pick<typeof prisma, 'zaloAccount' | 'botNickCrmUid'> = prisma): Promise<Set<string>> {
  const nick = await db.zaloAccount.findMany({ where: { orgId, zaloUid: { not: null } }, select: { zaloUid: true } });
  const nhin = await db.botNickCrmUid.findMany({
    where: { orgId, tuChoi: false, nguon: { in: [...NGUON_HIEU_LUC] } }, select: { zaloUid: true },
  });
  return new Set([...nick.map((n) => n.zaloUid!).filter(Boolean), ...nhin.map((n) => n.zaloUid)]);
}

/**
 * uid CÙNG người với `uids` ở nick khác (luật chặt), KHÔNG gồm chính `uids`, trừ uid nick CRM. Kèm nick + bằng chứng.
 * Truy vấn lỗi/hết giờ ⇒ [] (không suy ra gì).
 */
export async function suyRaCungNguoi(orgId: string, uids: readonly string[]): Promise<UidSuyRa[]> {
  const chon = [...new Set(uids.filter(Boolean))];
  if (chon.length === 0) return [];
  const [lienKet, nickOrg] = await Promise.all([docLienKetHoacNull(orgId, chon), uidNickCuaOrg(orgId)]);
  if (!lienKet) return [];
  const nhom = gomNguoi(lienKet);
  const daChon = new Set(chon);
  const ra = new Map<string, UidSuyRa>();
  for (const u of chon) {
    const ds = nhom.get(u) ?? [];
    const cung = new Set(ds.map((x) => x.zaloUid));
    for (const x of ds) {
      if (daChon.has(x.zaloUid) || ra.has(x.zaloUid) || nickOrg.has(x.zaloUid)) continue;
      const khac = new Set([...cung].filter((y) => y !== x.zaloUid));
      ra.set(x.zaloUid, { zaloUid: x.zaloUid, zaloAccountId: x.zaloAccountId, bangChung: bangChungGiua(x.zaloUid, khac, lienKet) });
    }
  }
  return [...ra.values()].sort((a, b) => (a.zaloUid < b.zaloUid ? -1 : a.zaloUid > b.zaloUid ? 1 : 0));
}

/** Nick nhìn thấy uid chính (chọn tay) — để hiển thị. */
export async function nickChoUidChon(orgId: string, uids: readonly string[]): Promise<Map<string, string>> {
  return nickCuaUid(orgId, uids);
}

function jsonBc(b: BangChung): Prisma.InputJsonValue {
  return { ...(b as unknown as Record<string, unknown>), soTin: b.soTin, maTin: b.maTin } as Prisma.InputJsonValue;
}

/**
 * TRONG giao dịch: ghi/cập nhật đề xuất cho MỘT NV (bỏ cặp đã từ chối, uid đã có chủ). Trả số dòng mới.
 */
export async function ghiDeXuat(tx: Tx, orgId: string, nhanVienId: string, ds: readonly UidSuyRa[]): Promise<number> {
  if (ds.length === 0) return 0;
  const uids = ds.map((x) => x.zaloUid);
  // Tuần tự: một giao dịch = một kết nối (Promise.all trên tx là truy vấn chồng trên cùng kết nối).
  const tuChoi = await tx.botNhanVienUidTuChoi.findMany({ where: { orgId, nhanVienId, zaloUid: { in: uids } }, select: { zaloUid: true } });
  const coChu = await tx.botNhanVienUid.findMany({ where: { orgId, zaloUid: { in: uids } }, select: { zaloUid: true } });
  const cu = await tx.botNhanVienUidDeXuat.findMany({ where: { orgId, nhanVienId, zaloUid: { in: uids } }, select: { zaloUid: true } });
  const bo = new Set([...tuChoi, ...coChu].map((x) => x.zaloUid));
  const daCo = new Set(cu.map((x) => x.zaloUid));
  let moi = 0;
  for (const x of ds) {
    if (bo.has(x.zaloUid)) continue;
    await tx.botNhanVienUidDeXuat.upsert({
      where: { orgId_nhanVienId_zaloUid: { orgId, nhanVienId, zaloUid: x.zaloUid } },
      create: { orgId, nhanVienId, zaloUid: x.zaloUid, zaloAccountId: x.zaloAccountId, soTin: x.bangChung.soTin || null, bangChung: jsonBc(x.bangChung) },
      update: { zaloAccountId: x.zaloAccountId, soTin: x.bangChung.soTin || null, bangChung: jsonBc(x.bangChung) },
    });
    if (!daCo.has(x.zaloUid)) moi++;
  }
  return moi;
}

/**
 * TRONG giao dịch: dòng cung_tin (bản trước tự gắn bằng tin chung) ⇒ chuyển về đề xuất + nhật ký. `nhanVienId` có ⇒ chỉ NV
 * đó. Trả số uid đã chuyển. Không bao giờ đụng uid chính.
 */
export async function haCapTuNoi(tx: Tx, orgId: string, aiId: string, nhanVienId?: string): Promise<number> {
  const rows = await tx.botNhanVienUid.findMany({
    where: { orgId, nguon: 'cung_tin', ...(nhanVienId ? { nhanVienId } : {}) },
    select: {
      id: true, zaloUid: true, zaloAccountId: true, bangChung: true, nhanVienId: true,
      nhanVien: { select: { vai: true, zaloUid: true, tenGoi: true } },
    },
  });
  const chuyen = rows.filter((r) => r.zaloUid !== r.nhanVien.zaloUid);
  const theoNv = new Map<string, typeof chuyen>();
  for (const r of chuyen) theoNv.set(r.nhanVienId, [...(theoNv.get(r.nhanVienId) ?? []), r]);
  for (const [nvId, ds] of theoNv) {
    const truoc = (await tx.botNhanVienUid.findMany({ where: { nhanVienId: nvId }, select: { zaloUid: true } }))
      .map((x) => x.zaloUid).sort();
    for (const r of ds) {
      const bc = (r.bangChung ?? null) as { soTin?: number } | null;
      await tx.botNhanVienUidDeXuat.upsert({
        where: { orgId_nhanVienId_zaloUid: { orgId, nhanVienId: nvId, zaloUid: r.zaloUid } },
        create: {
          orgId, nhanVienId: nvId, zaloUid: r.zaloUid, zaloAccountId: r.zaloAccountId,
          soTin: typeof bc?.soTin === 'number' ? bc.soTin : null, bangChung: (r.bangChung ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        update: {},
      });
      await tx.botNhanVienUid.delete({ where: { id: r.id } });
    }
    const goUids = ds.map((r) => r.zaloUid).sort();
    await tx.botQuyenNhatKy.create({
      data: {
        orgId, aiId, doiTuong: 'nhan_vien', doiTuongId: nvId,
        truoc: { tenGoi: ds[0].nhanVien.tenGoi, uids: truoc },
        sau: { tenGoi: ds[0].nhanVien.tenGoi, uids: truoc.filter((u) => !goUids.includes(u)), thanhDeXuat: goUids },
        lyDo: `tin chung chỉ là bằng chứng phụ — ${goUids.length} uid tự nối bằng tin chung thành đề xuất chờ chủ xác nhận`,
      },
    });
  }
  return chuyen.length;
}

const lanBoSung = new Map<string, number>();
export const NHIP_BO_SUNG_MS = 60_000;

/** Chỉ cho test. */
export function _xoaNhipBoSung(): void {
  lanBoSung.clear();
}

export interface KetQuaBoSung {
  /** uid tự gắn bằng globalId sống. */
  them: number;
  /** đề xuất mới (tin chung). */
  deXuat: number;
  /** uid tự nối bằng tin chung (bản cũ) đã chuyển về đề xuất. */
  haCap: number;
  /** dòng nick CRM hiệu lực đã thêm/xoá. */
  nickCrm: number;
}

type Gan = { zaloUid: string; zaloAccountId: string; bangChung: Prisma.InputJsonValue; globalId: string };

/**
 * Vòng tự nối (CHỈ DB — không gọi Zalo; giai đoạn mạng là bot-quyen-danh-tinh.layDanhTinhZalo) cho MỌI nhân viên của org:
 * nick CRM → nối globalId sống (mọi vai) → đề xuất tin chung (mọi vai) → dọn đề xuất → điền nick còn thiếu. `nhip` ⇒ bỏ
 * qua nếu vừa chạy trong NHIP_BO_SUNG_MS (đường GET trang). Truy vấn tin chung lỗi/hết giờ ⇒ không đụng đề xuất.
 */
export async function boSungUidNhanVien(orgId: string, o: { nhip?: boolean } = {}): Promise<KetQuaBoSung> {
  const khong: KetQuaBoSung = { them: 0, deXuat: 0, haCap: 0, nickCrm: 0 };
  const bayGio = Date.now();
  if (o.nhip && bayGio - (lanBoSung.get(orgId) ?? 0) < NHIP_BO_SUNG_MS) return khong;
  lanBoSung.set(orgId, bayGio);
  // Nick CRM trước: uid nick CRM không bao giờ được nối làm uid nhân viên.
  const nickCrm = await boSungNickCrm(orgId)
    .catch((err) => { logger.warn(`[bot-quyen] nhận ra nick CRM org ${orgId} lỗi:`, err); return 0; });
  return withTenant(orgId, async () => {
    const nvs = await prisma.botNhanVien.findMany({
      where: { orgId },
      select: { id: true, zaloUid: true, tenGoi: true, vai: true, uids: { select: { id: true, zaloUid: true, zaloAccountId: true, nguon: true } } },
      orderBy: { id: 'asc' },
    });
    if (nvs.length === 0) return { ...khong, nickCrm };
    // Hạt giống: uid TIN ĐƯỢC (uid chính + chon/chu_xac_nhan/zalo_global_id). Dòng cung_tin cũ sắp thành đề xuất.
    const hatGiong = (nv: typeof nvs[number]) => [
      { zaloUid: nv.zaloUid, zaloAccountId: nv.uids.find((u) => u.zaloUid === nv.zaloUid)?.zaloAccountId ?? null },
      ...nv.uids.filter((u) => u.zaloUid !== nv.zaloUid && (NGUON_TIN as readonly string[]).includes(u.nguon)),
    ];
    const [ban, lienKet, nickOrg, tuChoi] = [
      await docBanDanhTinh(orgId),
      await docLienKetHoacNull(orgId, [...new Set(nvs.flatMap((nv) => hatGiong(nv).map((u) => u.zaloUid)))]),
      await uidNickCuaOrg(orgId),
      await prisma.botNhanVienUidTuChoi.findMany({ where: { orgId }, select: { nhanVienId: true, zaloUid: true } }),
    ];
    const daTuChoi = new Set(tuChoi.map((r) => `${r.nhanVienId}|${r.zaloUid}`));
    const chuCua = new Map<string, string>();
    for (const nv of nvs) for (const u of hatGiong(nv)) chuCua.set(u.zaloUid, nv.id);
    const boQua = (nv: { id: string }, uid: string, goc: string) => {
      const chu = chuCua.get(uid);
      if (chu !== undefined && chu !== nv.id) {
        logger.warn(`[bot-quyen] uid ${uid} và ${goc} là CÙNG một người nhưng thuộc hai nhân viên khác nhau (${chu} / ${nv.id}) — không tự gộp`);
        return true;
      }
      return chu === nv.id || nickOrg.has(uid) || daTuChoi.has(`${nv.id}|${uid}`);
    };

    // (1) CHÍNH — globalId sống.
    const ganTheoNv = new Map<string, Gan[]>();
    for (const nv of nvs) {
      const goc = hatGiong(nv);
      const gids = new Map<string, { uid: string; nick: string | null }>();
      for (const u of goc) {
        const g = ban.gid(u.zaloAccountId, u.zaloUid);
        if (g && !gids.has(g)) gids.set(g, { uid: u.zaloUid, nick: u.zaloAccountId });
      }
      if (gids.size > 1) {
        logger.warn(`[bot-quyen] NV ${nv.id} có ${gids.size} globalId khác nhau (${[...gids.keys()].join(', ')}) — không nối theo globalId`);
        continue;
      }
      const [g, nguonG] = [...gids][0] ?? [];
      if (!g || !nguonG) continue;
      const ds: Gan[] = [];
      for (const r of ban.theoGid.get(g) ?? []) {
        if (goc.some((x) => x.zaloUid === r.uid) || ds.some((x) => x.zaloUid === r.uid) || boQua(nv, r.uid, nguonG.uid)) continue;
        ds.push({
          zaloUid: r.uid, zaloAccountId: r.nick, globalId: g,
          bangChung: {
            globalId: g, uidGoc: nguonG.uid, nhinTuGoc: nguonG.nick,
            layLucGoc: (nguonG.nick && ban.layLuc(nguonG.nick, nguonG.uid)?.toISOString()) || null,
            nhinTu: r.nick, layLuc: r.layLuc.toISOString(),
          },
        });
      }
      if (ds.length === 0) continue;
      for (const x of ds) chuCua.set(x.zaloUid, nv.id);
      ganTheoNv.set(nv.id, ds.sort((a, b) => (a.zaloUid < b.zaloUid ? -1 : 1)));
    }

    // (1b) SĐT nhân viên (ô SĐT / tài khoản CRM liên kết) ⇒ findUser qua nick khác (giai đoạn mạng) ⇒ dòng danh tính.
    //      globalId của NV đã biết ⇒ luật (1) lo (trùng thì gắn; lệch ⇒ SĐT ra người khác, bỏ + cảnh báo). Chưa biết (vd uid
    //      chủ chọn thuộc nick đang tắt) ⇒ tên Zalo khớp tên NV (như thông báo hệ thống) ⇒ ĐỀ XUẤT, không tự gắn.
    const deXuatSdt = new Map<string, UidSuyRa[]>();
    const sdtNv = await sdtNhanVien(orgId);
    if (sdtNv.length > 0) {
      const { nameLooksMatched } = await import('../system-notifications/system-notify-service.js');
      const timDuoc = await prisma.botQuyenDanhTinh.findMany({
        where: { orgId, timTheoSdt: { in: [...new Set(sdtNv.flatMap((n) => n.sdt))] } },
        select: { zaloAccountId: true, zaloUid: true, globalId: true, ten: true, timTheoSdt: true, layLuc: true },
      });
      for (const n of sdtNv) {
        const nv = nvs.find((x) => x.id === n.id);
        if (!nv) continue;
        const coGid = hatGiong(nv).some((u) => !!ban.gid(u.zaloAccountId, u.zaloUid));
        for (const r of timDuoc.filter((x) => x.timTheoSdt && n.sdt.includes(x.timTheoSdt))) {
          if (hatGiong(nv).some((u) => u.zaloUid === r.zaloUid) || (ganTheoNv.get(nv.id) ?? []).some((x) => x.zaloUid === r.zaloUid)) continue;
          if (coGid) {
            logger.warn(`[bot-quyen] SĐT của NV ${nv.id} ra uid ${r.zaloUid} (nick ${r.zaloAccountId}) mà globalId KHÁC — không nối`);
            continue;
          }
          if (boQua(nv, r.zaloUid, nv.zaloUid)) continue;
          if (!nameLooksMatched(r.ten, n.tenGoi) && !nameLooksMatched(r.ten, n.tenUser)) {
            logger.warn(`[bot-quyen] SĐT của NV ${nv.id} ra “${r.ten ?? '?'}” — tên không khớp, không đề xuất`);
            continue;
          }
          deXuatSdt.set(nv.id, [...(deXuatSdt.get(nv.id) ?? []), {
            zaloUid: r.zaloUid, zaloAccountId: r.zaloAccountId,
            bangChung: { soTin: 0, maTin: [], nguon: 'sdt_ten', sdtDuoi: `…${r.timTheoSdt!.slice(-3)}`, ten: r.ten, globalId: r.globalId } as never,
          }]);
        }
      }
    }

    // (2) PHỤ — tin chung ⇒ đề xuất (mọi vai).
    const nhom = lienKet ? gomNguoi(lienKet) : new Map();
    const deXuatTheoNv = new Map<string, UidSuyRa[]>();
    if (lienKet) {
      for (const nv of nvs) {
        const cua = new Set([...hatGiong(nv).map((u) => u.zaloUid), ...(ganTheoNv.get(nv.id) ?? []).map((x) => x.zaloUid)]);
        const thay = new Map<string, UidSuyRa>();
        for (const u of cua) {
          const ds = (nhom.get(u) ?? []) as Array<{ zaloUid: string; zaloAccountId: string }>;
          const cung = new Set(ds.map((x) => x.zaloUid));
          for (const x of ds) {
            if (cua.has(x.zaloUid) || thay.has(x.zaloUid) || boQua(nv, x.zaloUid, u)) continue;
            thay.set(x.zaloUid, {
              zaloUid: x.zaloUid, zaloAccountId: x.zaloAccountId,
              bangChung: bangChungGiua(x.zaloUid, new Set([...cung].filter((y) => y !== x.zaloUid)), lienKet),
            });
          }
        }
        if (thay.size > 0) deXuatTheoNv.set(nv.id, [...thay.values()].sort((a, b) => (a.zaloUid < b.zaloUid ? -1 : 1)));
      }
    }
    for (const [nvId, ds] of deXuatSdt) {
      const cu = deXuatTheoNv.get(nvId) ?? [];
      deXuatTheoNv.set(nvId, [...cu, ...ds.filter((x) => !cu.some((y) => y.zaloUid === x.zaloUid))]);
    }

    const thieuNick = nvs.flatMap((nv) => nv.uids).filter((u) => !u.zaloAccountId).map((u) => u.zaloUid);
    const nickKhac = await nickCuaUid(orgId, thieuNick);

    const kq: KetQuaBoSung = { them: 0, deXuat: 0, haCap: 0, nickCrm };
    await tenantTransaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-quyen:${orgId}`}))`;
      kq.haCap = await haCapTuNoi(tx, orgId, AI_TU_DONG_UID);
      for (const nv of nvs) {
        for (const u of nv.uids) {
          const n = !u.zaloAccountId ? nickKhac.get(u.zaloUid) : null;
          if (n) await tx.botNhanVienUid.updateMany({ where: { id: u.id, zaloAccountId: null }, data: { zaloAccountId: n } });
        }
      }
      for (const [nhanVienId, ds] of [...ganTheoNv].sort(([a], [b]) => (a < b ? -1 : 1))) {
        // Đọc lại trong khoá: uid có thể vừa được gán cho người khác / vừa bị từ chối.
        const nv = await tx.botNhanVien.findFirst({
          where: { id: nhanVienId, orgId }, select: { id: true, tenGoi: true, uids: { select: { zaloUid: true } } },
        });
        if (!nv) continue;
        const uids = ds.map((x) => x.zaloUid);
        const daCo = await tx.botNhanVienUid.findMany({ where: { orgId, zaloUid: { in: uids } }, select: { zaloUid: true } });
        const bi = await tx.botNhanVienUidTuChoi.findMany({ where: { orgId, nhanVienId, zaloUid: { in: uids } }, select: { zaloUid: true } });
        const bo = new Set([...daCo, ...bi].map((x) => x.zaloUid));
        const them = ds.filter((x) => !bo.has(x.zaloUid));
        if (them.length === 0) continue;
        await tx.botNhanVienUid.createMany({
          data: them.map((x) => ({
            orgId, nhanVienId, zaloUid: x.zaloUid, zaloAccountId: x.zaloAccountId, nguon: 'zalo_global_id', bangChung: x.bangChung,
          })),
        });
        await tx.botNhanVienUidDeXuat.deleteMany({ where: { orgId, nhanVienId, zaloUid: { in: them.map((x) => x.zaloUid) } } });
        const truoc = nv.uids.map((x) => x.zaloUid).sort();
        await tx.botQuyenNhatKy.create({
          data: {
            orgId, aiId: AI_TU_DONG_UID, doiTuong: 'nhan_vien', doiTuongId: nhanVienId,
            truoc: { tenGoi: nv.tenGoi, uids: truoc },
            sau: {
              tenGoi: nv.tenGoi, uids: [...truoc, ...them.map((x) => x.zaloUid)].sort(),
              bangChung: Object.fromEntries(them.map((x) => [x.zaloUid, x.bangChung])),
            },
            lyDo: `nhận ra cùng người ở nick khác — globalId đọc trực tiếp từ Zalo trùng (${them.map((x) => x.zaloUid).join(', ')})`,
          },
        });
        kq.them += them.length;
      }
      for (const [nhanVienId, ds] of deXuatTheoNv) {
        kq.deXuat += await ghiDeXuat(tx, orgId, nhanVienId, ds);
      }
      // Dọn đề xuất hết bằng chứng / uid đã có chủ / đã từ chối (chỉ khi đọc tin chung được — lỗi thì giữ nguyên).
      if (lienKet) {
        const muon = new Set([...deXuatTheoNv].flatMap(([nv, ds]) => ds.map((x) => `${nv}|${x.zaloUid}`)));
        const cu = await tx.botNhanVienUidDeXuat.findMany({ where: { orgId }, select: { id: true, nhanVienId: true, zaloUid: true } });
        const xoa = cu.filter((r) => !muon.has(`${r.nhanVienId}|${r.zaloUid}`)).map((r) => r.id);
        if (xoa.length > 0) await tx.botNhanVienUidDeXuat.deleteMany({ where: { id: { in: xoa } } });
      }
    });
    return kq;
  });
}
