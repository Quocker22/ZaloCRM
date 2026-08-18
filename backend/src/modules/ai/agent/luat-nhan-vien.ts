// SPDX-License-Identifier: AGPL-3.0-or-later
// LUẬT NHÂN VIÊN DẶN — trí nhớ dài hạn của bot, do chính nhân viên đắp qua chat.
//
// Anh Quốc 12/08 (sau chuỗi 19:42-19:48): "tôi vẫn cảm giác nó tù tù sao á,
// cảm giác nó không linh động được" — rồi chốt "làm cái memory luật nhân viên
// dặn đi". Nhân viên nói "nhớ là khách X luôn giảm 5%", "từ giờ đừng hỏi kho
// với khách quen" một lần, bot phải nhớ cho MỌI lượt sau — không phải dặn lại
// mỗi hội thoại.
//
// ─── VÌ SAO TÁI DÙNG AiGuideline CHỨ KHÔNG BẢNG MỚI ───
// Schema AiGuideline có sẵn cột `vai: 'khach' | 'nhanvien'` từ ngày đầu mà
// chưa ai nối vế nhân viên. Tái dùng được cả: (1) không cần migration,
// (2) UI quản lý guideline sẵn có tự thấy các luật này, (3) cùng một khái
// niệm — condition/action/mucDo — không đẻ khái niệm thứ hai lệch dần.
//
// ─── VÌ SAO NẠP THẲNG, KHÔNG QUA MATCHER LLM (V1) ───
// Luồng khách match guideline từng lượt bằng LLM (học Parlant). Luật nhân
// viên V1 đếm bằng chục chứ không bằng trăm, và mỗi lượt matcher là thêm một
// cú gọi model. Nạp hết trong TRẦN KÝ TỰ cứng (ưu tiên bat_buoc rồi mới
// nhất) — vượt trần thì cắt và LOG, không phình prompt âm thầm (bài học
// "prompt phình thì vỡ"). Đông luật tới mức chật trần thì mới đáng đầu tư
// matcher — lúc đó đã có dữ liệu thật để tính.
import { logger } from '../../../shared/utils/logger.js';
import type { ToolDefinition } from './types.js';

export const ghiLuatDefinition: ToolDefinition = {
  name: 'ghi_luat',
  description:
    'GHI NHỚ LÂU DÀI một lời dặn của nhân viên — áp dụng cho MỌI hội thoại sau. ' +
    'GỌI KHI nhân viên dặn kiểu: "nhớ là...", "từ giờ...", "luôn luôn...", ' +
    '"khách X thì cứ...", "đừng bao giờ hỏi... nữa". ' +
    'KHÔNG gọi cho yêu cầu một-lần ("lên đơn cho...", "tra tồn...").',
  inputSchema: {
    type: 'object',
    properties: {
      luat: {
        type: 'string',
        description: 'Lời dặn, MỘT câu gọn, đúng ý nhân viên nói — không chép cả đoạn hội thoại',
      },
      pham_vi: {
        type: 'string',
        description: 'Khi nào áp dụng, nếu nhân viên có giới hạn (vd "khách Led Kim Long", "đơn nhập hàng"). Không nêu thì bỏ trống.',
      },
    },
    required: ['luat'],
  },
};

export const quenLuatDefinition: ToolDefinition = {
  name: 'quen_luat',
  description:
    'BỎ một luật đã ghi nhớ trước đây. GỌI KHI nhân viên nói "quên luật...", ' +
    '"bỏ cái luật...", "không cần ... nữa" về một lời dặn cũ.',
  inputSchema: {
    type: 'object',
    properties: {
      tu_khoa: { type: 'string', description: 'Vài chữ nằm trong luật cần quên' },
    },
    required: ['tu_khoa'],
  },
};

/** Phần Prisma client cần — hẹp để test bằng fake, cùng mẫu guideline-store. */
export interface PrismaLuatNv {
  aiGuideline: {
    findMany: (args: {
      where: { orgId: string; vai: string; enabled: boolean };
      orderBy?: Array<Record<string, 'asc' | 'desc'>>;
    }) => Promise<Array<{ id: string; ten: string; condition: string; action: string; mucDo: string }>>;
    create: (args: {
      data: {
        orgId: string; ten: string; vai: string; condition: string; action: string;
        mucDo: string; ghiChu: string; nguon?: string; nguonHoiThoai?: string;
      };
    }) => Promise<{ id: string; ten: string }>;
    updateMany: (args: {
      where: { orgId: string; vai: string; id: { in: string[] } };
      data: { enabled: boolean };
    }) => Promise<{ count: number }>;
  };
}

/**
 * Trần ký tự cho khối luật nạp vào prompt mỗi lượt.
 *
 * ~900 ký tự ≈ 15-20 luật một dòng. Đây là chi phí ĐỘNG (không nằm trong
 * prefix cache như system prompt) nên phải giữ chặt hơn cả trần system.
 */
const TRAN_KY_TU = 900;

/** Luật dài quá một câu dặn là dấu hiệu model bịa/chép cả đoạn hội thoại. */
const TRAN_MOT_LUAT = 200;

/**
 * Nạp luật để chèn vào ngữ cảnh lượt chạy. Trả [] khi không có/DB lỗi —
 * luật là gia vị, không bao giờ được là lý do bot câm (cùng khế ước
 * guideline-store).
 */
export async function napLuatNhanVien(prisma: PrismaLuatNv, orgId: string): Promise<string[]> {
  try {
    const hang = await prisma.aiGuideline.findMany({
      where: { orgId, vai: 'nhanvien', enabled: true },
      // bat_buoc trước (mucDo asc: 'bat_buoc' < 'thuong'), rồi MỚI NHẤT trước —
      // luật vừa dặn hôm qua đáng tin hơn luật ba tháng trước.
      orderBy: [{ mucDo: 'asc' }, { createdAt: 'desc' }],
    });
    const ra: string[] = [];
    let tong = 0;
    for (const h of hang) {
      const dong = h.condition && h.condition !== 'mọi tình huống'
        ? `${h.action} (khi: ${h.condition})`
        : h.action;
      if (tong + dong.length > TRAN_KY_TU) {
        logger.warn(
          { orgId, tongLuat: hang.length, daNap: ra.length },
          '[luat-nv] vượt trần ký tự — cắt bớt luật cũ, cân nhắc dọn bằng quen_luat',
        );
        break;
      }
      ra.push(dong);
      tong += dong.length;
    }
    return ra;
  } catch (err) {
    logger.warn({ err, orgId }, '[luat-nv] nạp luật lỗi — chạy không luật');
    return [];
  }
}

/** Khối chèn vào userMessage — export riêng để test khoá format. */
export function khoiLuatChoPrompt(luat: string[]): string {
  if (!luat.length) return '';
  return (
    '[Luật nhân viên đã dặn từ trước — LÀM THEO, trừ khi tin mới nói khác]\n' +
    luat.map((l) => `- ${l}`).join('\n')
  );
}

export interface KetQuaGhiLuat {
  ok: boolean;
  loi?: string;
  ten?: string;
  /** Luật NÀY đã có sẵn (trùng hệt sau chuẩn hoá) — không đẻ bản ghi mới. */
  daCoSan?: boolean;
}

/**
 * Ghi một luật mới. `phamVi` là điều kiện áp dụng ("khách Led Kim Long",
 * "đơn nhập hàng") — bỏ trống = mọi tình huống.
 */
export async function ghiLuat(
  prisma: PrismaLuatNv,
  input: {
    orgId: string; noiDung: string; phamVi?: string; conversationId?: string;
    /** 'nv_dan' (mặc định) | 'tu_hoc' — luật bot tự rút sau khi soi hội thoại. */
    nguon?: 'nv_dan' | 'tu_hoc';
  },
): Promise<KetQuaGhiLuat> {
  const noiDung = (input.noiDung ?? '').trim();
  if (!noiDung) return { ok: false, loi: 'Luật rỗng — phải có nội dung để nhớ.' };
  if (noiDung.length > TRAN_MOT_LUAT) {
    return {
      ok: false,
      loi: `Luật dài ${noiDung.length} ký tự (trần ${TRAN_MOT_LUAT}) — tóm gọn lại thành MỘT câu dặn.`,
    };
  }
  // Slug thời gian đủ duy nhất cho nguồn duy nhất là chat; không cần cuid đẹp.
  const ten = `nv-dan-${Date.now().toString(36)}`;
  try {
    // CHỐNG GHI TRÙNG (nhóm C 15/08, học TencentDB content_hash + merge
    // isCandidateRedundant): NV dặn lại đúng một câu đã có (hoặc model đề
    // xuất lại luật cũ) thì đừng đẻ bản ghi mới — kho luật phình toàn bản
    // sao, trần 900 ký tự bị chèn bởi chính mình. So sau CHUẨN HOÁ (thường,
    // gọn khoảng trắng); chỉ chặn trùng HỆT — "chiết khấu 5%" vs "6%" là hai
    // luật, để nguyên cho người quyết (quen_luat cái cũ).
    const chuan = (t: string): string => t.toLowerCase().replace(/\s+/g, ' ').trim();
    const dangCo = await prisma.aiGuideline.findMany({
      where: { orgId: input.orgId, vai: 'nhanvien', enabled: true },
    });
    const trung = dangCo.find((h) => chuan(h.action) === chuan(noiDung));
    if (trung) {
      return {
        ok: true,
        ten: trung.ten,
        daCoSan: true,
      };
    }
    await prisma.aiGuideline.create({
      data: {
        orgId: input.orgId,
        ten,
        vai: 'nhanvien',
        condition: (input.phamVi ?? '').trim() || 'mọi tình huống',
        action: noiDung,
        mucDo: 'thuong',
        nguon: input.nguon ?? 'nv_dan',
        ...(input.conversationId ? { nguonHoiThoai: input.conversationId } : {}),
        ghiChu: input.nguon === 'tu_hoc'
          ? `Bot TỰ HỌC sau khi soi lại hội thoại${input.conversationId ? ` ${input.conversationId}` : ''}`
          : `NV dặn qua chat${input.conversationId ? ` (hội thoại ${input.conversationId})` : ''}`,
      },
    });
    return { ok: true, ten };
  } catch (err) {
    logger.warn({ err, orgId: input.orgId }, '[luat-nv] ghi luật lỗi');
    return { ok: false, loi: 'Không ghi được vào hệ thống, thử lại sau.' };
  }
}

export interface KetQuaQuenLuat {
  ok: boolean;
  daTat: string[];
  loi?: string;
}

/**
 * Tắt các luật khớp từ khoá (soft — enabled=false, giữ dấu vết). Trả danh
 * sách nội dung đã tắt để bot đọc lại cho nhân viên soát.
 */
export async function quenLuat(
  prisma: PrismaLuatNv,
  input: { orgId: string; tuKhoa: string },
): Promise<KetQuaQuenLuat> {
  const tuKhoa = (input.tuKhoa ?? '').trim().toLowerCase();
  if (tuKhoa.length < 3) {
    return { ok: false, daTat: [], loi: 'Từ khoá quá ngắn — nêu một cụm trong luật cần quên (≥3 ký tự).' };
  }
  try {
    const hang = await prisma.aiGuideline.findMany({
      where: { orgId: input.orgId, vai: 'nhanvien', enabled: true },
      orderBy: [{ mucDo: 'asc' }, { createdAt: 'desc' }],
    });
    const khop = hang.filter(
      (h) => h.action.toLowerCase().includes(tuKhoa) || h.condition.toLowerCase().includes(tuKhoa),
    );
    if (!khop.length) return { ok: false, daTat: [], loi: `Không có luật nào chứa "${input.tuKhoa}".` };
    await prisma.aiGuideline.updateMany({
      where: { orgId: input.orgId, vai: 'nhanvien', id: { in: khop.map((h) => h.id) } },
      data: { enabled: false },
    });
    return { ok: true, daTat: khop.map((h) => h.action) };
  } catch (err) {
    logger.warn({ err, orgId: input.orgId }, '[luat-nv] quên luật lỗi');
    return { ok: false, daTat: [], loi: 'Không tắt được, thử lại sau.' };
  }
}
