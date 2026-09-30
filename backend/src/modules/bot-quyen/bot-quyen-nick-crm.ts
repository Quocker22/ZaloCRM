// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §8b-an-toàn) — nick CRM của org NHÌN TỪ nick khác (bảng bot_nick_crm_uid).
//
// Sự cố staging sau vòng 3: nick "Tiểu Mã Nelia" (uid tự nhìn 630640428799521839) là thành viên 2945555577789699285 khi nhìn
// từ nick Vận Tải Minh Thức; nick "Cẩm Loan" là 1359961729460490730 nhìn từ Vận Tải. Uid theo nick ⇒ không khớp
// ZaloAccount.zaloUid ⇒ bị đếm là NGƯỜI NGOÀI ⇒ mọi nhóm có hai nick CRM mặc định Khách.
//
// Nhận ra (máy, `boSungNickCrm`) — DANH TÍNH CHẮC trước (bot-quyen-danh-tinh.ts): uid nhìn từ nick Y có globalId SỐNG trùng
// globalId sống của chính nick X (getUserInfo của X về chính mình; hoặc findUser(X.phone) qua Y) ⇒ nguon zalo_global_id,
// HIỆU LỰC. Bằng chứng PHỤ — tin chung chặt (bot-quyen-cung-nguoi.ts) với phía `a` = uid X tự nhìn mình ⇒ nguon cung_tin,
// CHỈ là ĐỀ XUẤT (chủ bấm "Đúng là nick X" = chu_xac_nhan / "Không phải" = tuChoi). Chủ đánh dấu tay ở ngăn Thành viên
// ("Đây là nick CRM …") ⇒ chu_chon. Chủ gỡ ⇒ `tuChoi` (máy không nhận lại).
// HIỆU LỰC (NGUON_HIEU_LUC) là "người công ty" cho: mặc định nhóm (không phải người ngoài), nhãn thành viên (`nick_crm`),
// "Chờ gán" (loại), và bot (payload `nick_crm` ⇒ bảng nick_bot của bot, rào tạm im). KHÔNG phải nhân viên: không ra lệnh bot.
import type { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';
import { docLienKetHoacNull, uidDaThayTrongTin } from './bot-quyen-cung-nguoi.js';
import { docBanDanhTinh } from './bot-quyen-danh-tinh.js';

/** Nguồn làm dòng nick CRM HIỆU LỰC. `cung_tin` = đề xuất. */
export const NGUON_HIEU_LUC = ['zalo_global_id', 'chu_chon', 'chu_xac_nhan'] as const;

/** = bot-quyen-danh-sach.ts AI_TU_DONG (không import để tránh vòng import; test khoá bằng nhau). */
const AI_TU_DONG = 'tu_dong';

export interface NickCrmNhin {
  /** Nick Y — nick nhìn uid này. */
  zaloAccountId: string;
  zaloUid: string;
  /** Nick X của org. */
  nickId: string;
  nguon: string;
}

type Db = Pick<typeof prisma, 'botNickCrmUid'>;

/** Mọi nick CRM nhìn từ nick khác đang HIỆU LỰC (nguồn chắc, không bị chủ gỡ — đề xuất cung_tin KHÔNG tính). */
export async function docNickCrm(orgId: string, db: Db = prisma): Promise<NickCrmNhin[]> {
  return db.botNickCrmUid.findMany({
    where: { orgId, tuChoi: false, nguon: { in: [...NGUON_HIEU_LUC] } },
    select: { zaloAccountId: true, zaloUid: true, nickId: true, nguon: true },
    orderBy: [{ zaloAccountId: 'asc' }, { zaloUid: 'asc' }],
  });
}

/** Nick Y → tập uid là nick CRM khác khi nhìn từ Y. THUẦN. */
export function nickCongTyTheoNick(ds: readonly NickCrmNhin[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const r of ds) {
    const s = m.get(r.zaloAccountId) ?? new Set<string>();
    s.add(r.zaloUid);
    m.set(r.zaloAccountId, s);
  }
  return m;
}

export class LoiNickCrm extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

type Muon = { zaloAccountId: string; zaloUid: string; nickId: string; nguon: 'zalo_global_id' | 'cung_tin'; bangChung: Prisma.InputJsonValue };

/**
 * Máy nhận ra nick CRM nhìn từ nick khác cho MỘT org. Trả số dòng HIỆU LỰC đổi (thêm/xoá). Dòng chủ đánh dấu / xác nhận /
 * đã gỡ không bao giờ bị máy đụng.
 *   • globalId sống (chắc): mọi uid nhìn từ Y mang globalId của nick X ⇒ zalo_global_id; hết khớp ⇒ xoá.
 *   • tin chung (phụ): ⇒ đề xuất cung_tin (không hiệu lực); truy vấn lỗi/hết giờ ⇒ giữ nguyên đề xuất cũ.
 */
export async function boSungNickCrm(orgId: string): Promise<number> {
  return withTenant(orgId, async () => {
    const nicks = await prisma.zaloAccount.findMany({ where: { orgId, zaloUid: { not: null } }, select: { id: true, zaloUid: true } });
    const tuNhin = new Map(nicks.filter((n) => n.zaloUid).map((n) => [n.id, n.zaloUid!]));
    const uidTuNhin = new Set(tuNhin.values());
    if (tuNhin.size < 2) return 0;
    const ban = await docBanDanhTinh(orgId);
    const muon = new Map<string, Muon>();
    const lech = new Set<string>();
    const dat = (m: Muon) => {
      const k = `${m.zaloAccountId}|${m.zaloUid}`;
      const cu = muon.get(k);
      if (cu && cu.nickId !== m.nickId) { lech.add(k); return; }
      if (!cu || (cu.nguon === 'cung_tin' && m.nguon === 'zalo_global_id')) muon.set(k, m);
    };
    // (1) globalId sống: globalId của nick X = globalId X tự đọc về chính mình.
    for (const [x, uidX] of tuNhin) {
      const g = ban.gid(x, uidX);
      if (!g) continue;
      for (const r of ban.theoGid.get(g) ?? []) {
        if (r.nick === x || r.uid === tuNhin.get(r.nick) || uidTuNhin.has(r.uid)) continue;
        dat({
          zaloAccountId: r.nick, zaloUid: r.uid, nickId: x, nguon: 'zalo_global_id',
          bangChung: { globalId: g, layLucNick: ban.layLuc(x, uidX)?.toISOString() ?? null, layLuc: r.layLuc.toISOString() },
        });
      }
    }
    // (2) tin chung (phụ ⇒ đề xuất).
    const lienKet = await docLienKetHoacNull(orgId, [...uidTuNhin]);
    for (const l of lienKet ?? []) {
      if (tuNhin.get(l.nickA) !== l.a) continue; // phía a phải là nick X tự gửi
      if (l.b === tuNhin.get(l.nickB) || uidTuNhin.has(l.b)) continue;
      dat({ zaloAccountId: l.nickB, zaloUid: l.b, nickId: l.nickA, nguon: 'cung_tin', bangChung: { soTin: l.so, maTin: l.maTin } });
    }
    for (const k of lech) {
      logger.warn(`[bot-quyen] uid ${k} khớp HAI nick CRM khác nhau — không nhận là nick CRM (dữ liệu lệch)`);
      muon.delete(k);
    }
    let doi = 0;
    await tenantTransaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-quyen:${orgId}`}))`;
      const coSan = await tx.botNickCrmUid.findMany({ where: { orgId } });
      const theoKhoa = new Map(coSan.map((r) => [`${r.zaloAccountId}|${r.zaloUid}`, r]));
      for (const [k, v] of [...muon].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const cu = theoKhoa.get(k);
        if (cu) {
          // Chủ đã quyết (chu_chon / chu_xac_nhan / tuChoi) ⇒ không đụng. Máy: cập nhật bằng chứng, nâng cung_tin ⇒ globalId.
          if (cu.tuChoi || cu.nguon === 'chu_chon' || cu.nguon === 'chu_xac_nhan') continue;
          if (cu.nguon === v.nguon && cu.nickId === v.nickId) {
            await tx.botNickCrmUid.update({ where: { id: cu.id }, data: { bangChung: v.bangChung } });
            continue;
          }
          if (v.nguon !== 'zalo_global_id') continue;
          await tx.botNickCrmUid.update({ where: { id: cu.id }, data: { nguon: v.nguon, nickId: v.nickId, bangChung: v.bangChung } });
        } else {
          await tx.botNickCrmUid.create({ data: { orgId, ...v } });
        }
        if (v.nguon !== 'zalo_global_id') continue; // đề xuất: không nhật ký, không đổi hiệu lực
        await tx.botQuyenNhatKy.create({
          data: {
            orgId, aiId: AI_TU_DONG, doiTuong: 'nick_crm', doiTuongId: v.nickId,
            sau: { nhinTu: v.zaloAccountId, zaloUid: v.zaloUid, nguon: v.nguon, bangChung: v.bangChung } as Prisma.InputJsonValue,
            lyDo: 'nhận ra nick CRM nhìn từ nick khác — globalId đọc trực tiếp từ Zalo trùng',
          },
        });
        doi++;
      }
      for (const r of coSan) {
        const k = `${r.zaloAccountId}|${r.zaloUid}`;
        if (r.tuChoi || muon.has(k)) continue;
        if (r.nguon === 'zalo_global_id') {
          await tx.botNickCrmUid.delete({ where: { id: r.id } });
          await tx.botQuyenNhatKy.create({
            data: {
              orgId, aiId: AI_TU_DONG, doiTuong: 'nick_crm', doiTuongId: r.nickId,
              truoc: { nhinTu: r.zaloAccountId, zaloUid: r.zaloUid, nguon: r.nguon, bangChung: r.bangChung } as Prisma.InputJsonValue,
              lyDo: 'globalId đọc lại từ Zalo không còn trùng — thôi coi là nick CRM',
            },
          });
          doi++;
        } else if (r.nguon === 'cung_tin' && lienKet !== null) {
          await tx.botNickCrmUid.delete({ where: { id: r.id } }); // đề xuất hết bằng chứng
        }
      }
    });
    return doi;
  });
}

/** Hội thoại nhóm của org (404 nếu không). */
async function nhomCua(orgId: string, conversationId: string) {
  const c = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId, threadType: 'group' },
    select: { id: true, zaloAccountId: true, externalThreadId: true },
  });
  if (!c) throw new LoiNickCrm(404, 'KHONG_TIM_THAY_NHOM', 'Không tìm thấy hội thoại nhóm này');
  return c;
}

/**
 * POST /nhom/:conversationId/nick-crm {zaloUid, nickId, lyDo?} — chủ đánh dấu "uid này (nhìn từ nick của nhóm) là nick CRM
 * X". uid phải là thành viên / người đã nhắn của nhóm; không phải nhân viên; X là nick khác của org.
 */
export async function danhDauNickCrm(
  orgId: string, aiId: string, conversationId: string, zaloUid: string, nickId: string, lyDo: string | null,
): Promise<{ doi: boolean }> {
  const c = await nhomCua(orgId, conversationId);
  if (!zaloUid) throw new LoiNickCrm(400, 'THIEU_ZALO_UID', 'Thiếu Zalo uid');
  const nick = await prisma.zaloAccount.findFirst({ where: { id: nickId, orgId }, select: { id: true, zaloUid: true } });
  if (!nick) throw new LoiNickCrm(400, 'NICK_KHONG_HOP_LE', 'Nick không thuộc tổ chức này');
  if (nick.id === c.zaloAccountId) throw new LoiNickCrm(400, 'NICK_KHONG_HOP_LE', 'Đây là nick của chính nhóm — không cần đánh dấu');
  const laNv = await prisma.botNhanVienUid.findFirst({ where: { orgId, zaloUid }, select: { nhanVien: { select: { tenGoi: true } } } });
  if (laNv) throw new LoiNickCrm(409, 'LA_NHAN_VIEN', `uid này đang là nhân viên “${laNv.nhanVien.tenGoi}” — gỡ ở tab Nhân viên trước`);
  const thay = (await uidDaThayTrongTin(orgId, [zaloUid])).has(zaloUid)
    || !!(c.externalThreadId && await prisma.groupMember.findFirst({
      where: { zaloAccountId: c.zaloAccountId, groupId: c.externalThreadId, memberUid: zaloUid }, select: { id: true },
    }))
    || !!(await prisma.botNhomDanhSach.findFirst({ where: { orgId, conversationId: c.id, uids: { has: zaloUid } }, select: { id: true } }));
  if (!thay) throw new LoiNickCrm(400, 'UID_CHUA_THAY', 'uid này chưa từng thấy trong nhóm (thành viên / tin nhắn)');
  return tenantTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-quyen:${orgId}`}))`;
    const cu = await tx.botNickCrmUid.findUnique({ where: { orgId_zaloAccountId_zaloUid: { orgId, zaloAccountId: c.zaloAccountId, zaloUid } } });
    if (cu && !cu.tuChoi && cu.nickId === nick.id && cu.nguon !== 'cung_tin') return { doi: false };
    await tx.botNickCrmUid.upsert({
      where: { orgId_zaloAccountId_zaloUid: { orgId, zaloAccountId: c.zaloAccountId, zaloUid } },
      create: { orgId, zaloAccountId: c.zaloAccountId, zaloUid, nickId: nick.id, nguon: 'chu_chon' },
      update: { nickId: nick.id, nguon: cu && cu.nguon === 'cung_tin' && cu.nickId === nick.id ? 'chu_xac_nhan' : 'chu_chon', tuChoi: false },
    });
    await tx.botQuyenNhatKy.create({
      data: {
        orgId, aiId, doiTuong: 'nick_crm', doiTuongId: nick.id, lyDo,
        ...(cu ? { truoc: { nhinTu: cu.zaloAccountId, zaloUid, nickId: cu.nickId, tuChoi: cu.tuChoi } } : {}),
        sau: { nhinTu: c.zaloAccountId, zaloUid, nickId: nick.id, nhom: c.id },
      },
    });
    return { doi: true };
  });
}

/** DELETE /nhom/:conversationId/nick-crm/:zaloUid {lyDo} — chủ gỡ ⇒ `tuChoi` (máy không nhận lại). */
export async function goNickCrm(
  orgId: string, aiId: string, conversationId: string, zaloUid: string, lyDo: string,
): Promise<{ doi: boolean }> {
  const c = await nhomCua(orgId, conversationId);
  return tenantTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-quyen:${orgId}`}))`;
    const cu = await tx.botNickCrmUid.findUnique({ where: { orgId_zaloAccountId_zaloUid: { orgId, zaloAccountId: c.zaloAccountId, zaloUid } } });
    if (!cu || cu.tuChoi) return { doi: false };
    // gỡ dòng hiệu lực HOẶC từ chối một đề xuất (cung_tin) — cả hai ⇒ tuChoi (máy không nhận / đề xuất lại)
    await tx.botNickCrmUid.update({ where: { id: cu.id }, data: { tuChoi: true } });
    await tx.botQuyenNhatKy.create({
      data: {
        orgId, aiId, doiTuong: 'nick_crm', doiTuongId: cu.nickId, lyDo,
        truoc: { nhinTu: cu.zaloAccountId, zaloUid, nickId: cu.nickId, nguon: cu.nguon },
        sau: { nhinTu: cu.zaloAccountId, zaloUid, nickId: cu.nickId, tuChoi: true },
      },
    });
    return { doi: true };
  });
}
