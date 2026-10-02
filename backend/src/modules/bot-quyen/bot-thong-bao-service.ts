// SPDX-License-Identifier: AGPL-3.0-or-later
// THÔNG BÁO CHỦ ĐỘNG (docs/78 C2) — nghiệp vụ luật thông báo + ảnh chụp bản đồ tin.
//
// Bất biến (như bot-quyen-service.ts):
//   • kiểm cứng theo ảnh chụp danh mục MỚI NHẤT (bot-thong-bao-luat.ts) — chưa có ảnh chụp ⇒ không tạo/sửa được luật (409);
//     XOÁ luật luôn được (bớt tin gửi đi không bao giờ làm lộ dữ liệu);
//   • mỗi thay đổi ghi MỘT dòng BotQuyenNhatKy (doi_tuong='luat_thong_bao', trước/sau) TRONG CÙNG giao dịch;
//   • ghi của một org nối đuôi nhau (pg_advisory_xact_lock) — ảnh chụp đọc TRONG giao dịch đó;
//   • mọi truy vấn lọc theo orgId.
import type { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import {
  LoiLuatThongBao, docLuatVao, docAnhChup, danhMucTuAnh, kiemTheoDanhMuc, ghepLuatCongKhai,
  type Dich, type LuatBotDoc, type CheDo,
} from './bot-thong-bao-luat.js';

type Tx = Parameters<Parameters<typeof tenantTransaction>[0]>[0];
type Body = Record<string, unknown>;

const DAI_LY_DO = 500;

function laBody(x: unknown): Body {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Body) : {};
}

function docLyDo(x: unknown): string | null {
  if (x === undefined || x === null) return null;
  if (typeof x !== 'string') throw new LoiLuatThongBao(400, 'DU_LIEU_KHONG_HOP_LE', 'lyDo phải là chuỗi');
  const t = x.trim();
  if (t.length > DAI_LY_DO) throw new LoiLuatThongBao(400, 'DU_LIEU_KHONG_HOP_LE', `lyDo dài quá ${DAI_LY_DO} ký tự`);
  return t || null;
}

async function khoaOrg(tx: Tx, orgId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-thong-bao:${orgId}`}))`;
}

export interface LuatView {
  id: string;
  loai: string;
  dich: Dich[];
  cheDo: CheDo;
  dieuKien: Record<string, unknown>;
  gomGiay: number;
  lich: Record<string, unknown> | null;
  phienBan: number;
  suaBoi: string | null;
  suaLuc: Date;
}

type DongLuat = {
  id: string; loai: string; dich: Prisma.JsonValue; cheDo: string; dieuKien: Prisma.JsonValue; gomGiay: number;
  lich: Prisma.JsonValue | null; phienBan: number; suaBoi: string | null; suaLuc: Date;
};

function view(r: DongLuat): LuatView {
  return {
    id: r.id, loai: r.loai, dich: (r.dich ?? []) as unknown as Dich[], cheDo: r.cheDo as CheDo,
    dieuKien: (r.dieuKien ?? {}) as Record<string, unknown>, gomGiay: r.gomGiay,
    lich: (r.lich ?? null) as Record<string, unknown> | null, phienBan: r.phienBan, suaBoi: r.suaBoi, suaLuc: r.suaLuc,
  };
}

/** Ảnh nhật ký — đúng các ô ảnh hưởng hành vi bot. */
function anh(v: LuatView): object {
  return { loai: v.loai, dich: v.dich, cheDo: v.cheDo, dieuKien: v.dieuKien, gomGiay: v.gomGiay, lich: v.lich, phienBan: v.phienBan };
}

async function ghiNhatKy(tx: Tx, d: { orgId: string; aiId: string; id: string; truoc: object | null; sau: object | null; lyDo: string | null }) {
  await tx.botQuyenNhatKy.create({
    data: {
      orgId: d.orgId, aiId: d.aiId, doiTuong: 'luat_thong_bao', doiTuongId: d.id, lyDo: d.lyDo,
      ...(d.truoc ? { truoc: d.truoc as Prisma.InputJsonValue } : {}),
      ...(d.sau ? { sau: d.sau as Prisma.InputJsonValue } : {}),
    },
  });
}

async function danhMucTrong(tx: Tx, orgId: string) {
  const a = await tx.botBanDoTin.findUnique({ where: { orgId }, select: { composer: true } });
  return a ? danhMucTuAnh(a.composer) : null;
}

async function uidNvTrong(tx: Tx, orgId: string, dich: Dich[]): Promise<Set<string>> {
  const can = dich.filter((d) => d.kieu === 'nv').map((d) => d.gia_tri!);
  if (can.length === 0) return new Set();
  const [chinh, phu] = await Promise.all([
    tx.botNhanVien.findMany({ where: { orgId, zaloUid: { in: can } }, select: { zaloUid: true } }),
    tx.botNhanVienUid.findMany({ where: { orgId, zaloUid: { in: can } }, select: { zaloUid: true } }),
  ]);
  return new Set([...chinh, ...phu].map((r) => r.zaloUid));
}

// ── Đọc (admin) ─────────────────────────────────────────────────────────────

export async function danhSachLuat(orgId: string): Promise<{ luat: LuatView[]; banDo: { phienBan: string; luc: Date } | null }> {
  const [rows, banDo] = await Promise.all([
    prisma.botLuatThongBao.findMany({ where: { orgId }, orderBy: [{ loai: 'asc' }] }),
    prisma.botBanDoTin.findUnique({ where: { orgId }, select: { phienBan: true, luc: true } }),
  ]);
  return { luat: rows.map(view), banDo };
}

export async function docBanDo(orgId: string) {
  return prisma.botBanDoTin.findUnique({ where: { orgId }, select: { phienBan: true, composer: true, dem: true, luc: true } });
}

// ── Ghi (admin) ─────────────────────────────────────────────────────────────

export async function taoLuat(orgId: string, aiId: string, body: unknown): Promise<LuatView> {
  const b = laBody(body);
  if (typeof b.loai !== 'string' || !b.loai.trim() || b.loai.length > 64) {
    throw new LoiLuatThongBao(400, 'DU_LIEU_KHONG_HOP_LE', 'loai (id composer) bắt buộc');
  }
  const loai = b.loai.trim();
  const v = docLuatVao(b);
  const lyDo = docLyDo(b.lyDo);
  const dich = v.dich ?? [];
  return tenantTransaction(async (tx) => {
    await khoaOrg(tx, orgId);
    kiemTheoDanhMuc(loai, dich, await danhMucTrong(tx, orgId), await uidNvTrong(tx, orgId, dich));
    const co = await tx.botLuatThongBao.findUnique({ where: { orgId_loai: { orgId, loai } }, select: { id: true } });
    if (co) throw new LoiLuatThongBao(409, 'DA_CO_LUAT', `Loại tin "${loai}" đã có luật — sửa luật đó thay vì tạo mới`);
    const r = await tx.botLuatThongBao.create({
      data: {
        orgId, loai, dich: dich as unknown as Prisma.InputJsonValue,
        // H12: luật mới mặc định `bong` (ghi không gửi) — chủ xem số rồi mới bật.
        cheDo: v.cheDo ?? 'bong',
        dieuKien: (v.dieuKien ?? {}) as Prisma.InputJsonValue,
        gomGiay: v.gomGiay ?? 0,
        ...(v.lich ? { lich: v.lich as Prisma.InputJsonValue } : {}),
        suaBoi: aiId,
      },
    });
    const moi = view(r);
    await ghiNhatKy(tx, { orgId, aiId, id: r.id, truoc: null, sau: anh(moi), lyDo });
    return moi;
  });
}

export async function suaLuat(orgId: string, aiId: string, id: string, body: unknown): Promise<LuatView & { doi: boolean }> {
  const b = laBody(body);
  const v = docLuatVao(b);
  const lyDo = docLyDo(b.lyDo);
  const phienBanGui = b.phienBan;
  if (phienBanGui !== undefined && (typeof phienBanGui !== 'number' || !Number.isInteger(phienBanGui))) {
    throw new LoiLuatThongBao(400, 'DU_LIEU_KHONG_HOP_LE', 'phienBan phải là số nguyên');
  }
  return tenantTransaction(async (tx) => {
    await khoaOrg(tx, orgId);
    const cu = await tx.botLuatThongBao.findFirst({ where: { id, orgId } });
    if (!cu) throw new LoiLuatThongBao(404, 'KHONG_TIM_THAY', 'Không tìm thấy luật thông báo này');
    if (phienBanGui !== undefined && phienBanGui !== cu.phienBan) {
      throw new LoiLuatThongBao(409, 'PHIEN_BAN_CU', 'Luật vừa được người khác sửa — tải lại rồi sửa tiếp');
    }
    const truoc = view(cu);
    const dich = v.dich ?? truoc.dich;
    const sau: LuatView = {
      ...truoc,
      dich,
      cheDo: v.cheDo ?? truoc.cheDo,
      dieuKien: v.dieuKien ?? truoc.dieuKien,
      gomGiay: v.gomGiay ?? truoc.gomGiay,
      lich: v.lich !== undefined ? v.lich : truoc.lich,
    };
    if (JSON.stringify(anh(sau)) === JSON.stringify(anh(truoc))) return { ...truoc, doi: false };
    kiemTheoDanhMuc(cu.loai, dich, await danhMucTrong(tx, orgId), await uidNvTrong(tx, orgId, dich));
    const r = await tx.botLuatThongBao.update({
      where: { id },
      data: {
        dich: dich as unknown as Prisma.InputJsonValue,
        cheDo: sau.cheDo,
        dieuKien: sau.dieuKien as Prisma.InputJsonValue,
        gomGiay: sau.gomGiay,
        // lich null ⇒ SQL NULL (không dùng Prisma.DbNull — extension strip-null-bytes biến nó thành {}; xem bot-quyen-service).
        ...(sau.lich ? { lich: sau.lich as Prisma.InputJsonValue } : {}),
        phienBan: { increment: 1 },
        suaBoi: aiId,
        suaLuc: new Date(),
      },
    });
    if (!sau.lich && truoc.lich) await tx.$executeRaw`UPDATE bot_luat_thong_bao SET lich = NULL WHERE id = ${id}`;
    const moi = { ...view(r), lich: sau.lich };
    await ghiNhatKy(tx, { orgId, aiId, id, truoc: anh(truoc), sau: anh(moi), lyDo });
    return { ...moi, doi: true };
  });
}

/** Xoá luật — luôn được (kể cả khi chưa có ảnh chụp): bớt tin gửi đi không làm lộ dữ liệu. */
export async function xoaLuat(orgId: string, aiId: string, id: string, body: unknown): Promise<{ ok: true }> {
  const lyDo = docLyDo(laBody(body).lyDo);
  return tenantTransaction(async (tx) => {
    await khoaOrg(tx, orgId);
    const cu = await tx.botLuatThongBao.findFirst({ where: { id, orgId } });
    if (!cu) throw new LoiLuatThongBao(404, 'KHONG_TIM_THAY', 'Không tìm thấy luật thông báo này');
    await tx.botLuatThongBao.delete({ where: { id } });
    await ghiNhatKy(tx, { orgId, aiId, id, truoc: anh(view(cu)), sau: null, lyDo });
    return { ok: true as const };
  });
}

// ── Công khai (bot) ─────────────────────────────────────────────────────────

export async function docLuatChoBot(orgId: string): Promise<LuatBotDoc> {
  return withTenant(orgId, async () => {
    const [rows, a] = await Promise.all([
      prisma.botLuatThongBao.findMany({
        where: { orgId },
        select: { loai: true, dich: true, cheDo: true, dieuKien: true, gomGiay: true, lich: true, phienBan: true },
      }),
      prisma.botBanDoTin.findUnique({ where: { orgId }, select: { composer: true } }),
    ]);
    return ghepLuatCongKhai(rows, a ? danhMucTuAnh(a.composer) : null);
  });
}

/** Lưu ảnh chụp MỚI NHẤT của org (thay bản cũ). */
export async function luuAnhChup(orgId: string, body: unknown): Promise<{ ok: true; phien_ban: string; so_composer: number }> {
  const a = docAnhChup(body);
  await withTenant(orgId, () => prisma.botBanDoTin.upsert({
    where: { orgId },
    create: {
      orgId, phienBan: a.phien_ban,
      composer: a.composer as unknown as Prisma.InputJsonValue, dem: a.dem as unknown as Prisma.InputJsonValue,
    },
    update: {
      phienBan: a.phien_ban, luc: new Date(),
      composer: a.composer as unknown as Prisma.InputJsonValue, dem: a.dem as unknown as Prisma.InputJsonValue,
    },
  }));
  return { ok: true, phien_ban: a.phien_ban, so_composer: a.composer.length };
}
