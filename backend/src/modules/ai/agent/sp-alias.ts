// SPDX-License-Identifier: AGPL-3.0-or-later
// ALIAS SẢN PHẨM HỌC ĐƯỢC (P1.3, 12/08) — bot khôn dần theo cách shop gọi hàng.
//
// Đo 30 ngày prod: gần MỌI ca đơn-từ-ảnh chết ở "không tìm thấy sản phẩm",
// và một nửa trong đó là hàng CÓ THẬT nhưng gọi khác tên catalog ("Led hắt
// 3 bóng 6313" vs "3 Bóng Saso 6313"). Đường gần-đúng (P1.2) đưa ứng viên ra
// hỏi; khi nhân viên CHỌN, lựa chọn đó là tri thức — ghi lại, lần sau cùng
// tên gọi ấy máy khớp thẳng, không hỏi lại.
//
// CHỈ HỌC TỪ LỰA CHỌN TRÊN ĐƯỜNG GẦN ĐÚNG. Ứng viên thường (chọn 1 trong 3
// màu COB) không phải alias — học nó là lần sau "cob 24v" tự chốt màu xanh
// trong khi khách cần màu vàng. Cờ `ungVienGanDung` trên dòng phiên giữ ranh
// giới này.
//
// Alias chỉ lưu ID — tên/giá đọc lại từ Odoo mỗi lần dùng, không tin cache.
import { logger } from '../../../shared/utils/logger.js';
import { boDau } from '../odoo/tools/tra-san-pham.js';

export interface PrismaSpAlias {
  spAlias: {
    findUnique: (args: {
      where: { orgId_tenGoi: { orgId: string; tenGoi: string } };
    }) => Promise<{ productId: number; demDung: number; locked?: boolean } | null>;
    upsert: (args: {
      where: { orgId_tenGoi: { orgId: string; tenGoi: string } };
      create: { orgId: string; tenGoi: string; productId: number; tenSp: string };
      update: { productId: number; tenSp: string; demDung: { increment: number } };
    }) => Promise<unknown>;
  };
}

/** Tra alias theo tên gọi. null = chưa học / DB lỗi (đi đường tra thường). */
export async function traAliasSp(
  prisma: PrismaSpAlias,
  orgId: string,
  tuKhoa: string,
): Promise<number | null> {
  const tenGoi = boDau(tuKhoa);
  if (!tenGoi) return null;
  try {
    const r = await prisma.spAlias.findUnique({ where: { orgId_tenGoi: { orgId, tenGoi } } });
    return r?.productId ?? null;
  } catch (err) {
    logger.warn({ err, tuKhoa }, '[sp-alias] tra alias lỗi — đi đường tra thường');
    return null;
  }
}

/** Ghi/đè alias sau khi nhân viên chọn từ danh sách gần-đúng. Best-effort. */
export async function ghiAliasSp(
  prisma: PrismaSpAlias,
  input: { orgId: string; tuKhoa: string; productId: number; tenSp: string },
): Promise<void> {
  const tenGoi = boDau(input.tuKhoa);
  if (!tenGoi || tenGoi.length < 3) return; // tên gọi quá ngắn — alias vô nghĩa
  try {
    // KHOÁ SỬA TAY (nhóm C 15/08): admin đã locked thì đường học TỰ ĐỘNG phải
    // né — bot học lại mà đè là mất bản người sửa (đúng vết alias "trắng ấm").
    const cu = await prisma.spAlias.findUnique({
      where: { orgId_tenGoi: { orgId: input.orgId, tenGoi } },
    });
    if (cu?.locked) {
      logger.info({ tenGoi, productId: input.productId }, '[sp-alias] alias locked — bỏ qua học đè');
      return;
    }
    await prisma.spAlias.upsert({
      where: { orgId_tenGoi: { orgId: input.orgId, tenGoi } },
      create: { orgId: input.orgId, tenGoi, productId: input.productId, tenSp: input.tenSp },
      // NV chọn khác lần trước → tin lựa chọn MỚI (người sửa máy, không phải ngược lại).
      update: { productId: input.productId, tenSp: input.tenSp, demDung: { increment: 1 } },
    });
    logger.info({ tenGoi, productId: input.productId }, '[sp-alias] đã học alias mới');
  } catch (err) {
    logger.warn({ err, tuKhoa: input.tuKhoa }, '[sp-alias] ghi alias lỗi — bỏ qua');
  }
}
