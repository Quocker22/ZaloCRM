// SPDX-License-Identifier: AGPL-3.0-or-later
// Việc DUY NHẤT của LLM trong máy gom đơn: đọc MỘT câu của nhân viên và trích
// slot ra JSON qua tool ghi_slot. Không quyết hỏi gì, không soạn lời.
//
// Model không gọi tool / lỗi / trả rác → {ngoaiLe:true}: máy nhường agent
// thường, KHÔNG đoán bừa. Mọi field validate kiểu ở code — model flash rẻ mấy
// cũng không phá được cấu trúc phiên.
import { logger } from '../../../../../shared/utils/logger.js';
import type { ToolAwareGenerate, ToolDefinition } from '../types.js';
import type { PhienGom } from './kieu.js';

export interface KetQuaTrich {
  /** Tên/mã khách — ĐÃ bỏ xưng hô (anh/chị/em). */
  khach?: string;
  dong?: Array<{ sp: string; sl?: number }>;
  huy?: boolean;
  xacNhan?: boolean;
  /** Câu không liên quan đơn hàng (digression) — máy nhường agent thường. */
  ngoaiLe?: boolean;
}

const ghiSlotDefinition: ToolDefinition = {
  name: 'ghi_slot',
  description:
    'LUÔN gọi tool này với thông tin trích được từ câu của nhân viên. ' +
    'Câu không liên quan đơn hàng thì gọi với ngoai_le=true.',
  inputSchema: {
    type: 'object',
    properties: {
      khach: { type: 'string', description: 'Tên hoặc mã khách, BỎ xưng hô: "anh Hưng"→"Hưng"' },
      dong: {
        type: 'array',
        description: 'Các dòng hàng nhắc trong câu',
        items: {
          type: 'object',
          properties: {
            sp: { type: 'string', description: 'Tên/từ khoá sản phẩm' },
            sl: { type: 'number', description: 'Số lượng nếu câu có nói' },
          },
          required: ['sp'],
        },
      },
      huy: { type: 'boolean', description: 'true khi nhân viên muốn huỷ đơn đang gom' },
      xacNhan: { type: 'boolean', description: 'true khi nhân viên đồng ý chốt (ok, đúng rồi, lên đi)' },
      ngoaiLe: { type: 'boolean', description: 'true khi câu KHÔNG liên quan việc lên đơn' },
    },
  },
};

const SL_TOI_DA = 100_000;

function nguyenDuong(x: unknown): number | undefined {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 && n <= SL_TOI_DA ? n : undefined;
}

/** Ép input thô của model về KetQuaTrich sạch — sai kiểu thì bỏ field đó. */
export function lamSachTrich(raw: Record<string, unknown>): KetQuaTrich {
  const kq: KetQuaTrich = {};
  if (typeof raw.khach === 'string' && raw.khach.trim()) kq.khach = raw.khach.trim();
  if (Array.isArray(raw.dong)) {
    const dong = raw.dong
      .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
      .filter((d) => typeof d.sp === 'string' && (d.sp as string).trim())
      .map((d) => {
        const sl = nguyenDuong(d.sl);
        return { sp: (d.sp as string).trim(), ...(sl !== undefined ? { sl } : {}) };
      });
    if (dong.length > 0) kq.dong = dong;
  }
  if (raw.huy === true) kq.huy = true;
  if (raw.xacNhan === true || raw.xac_nhan === true) kq.xacNhan = true;
  if (raw.ngoaiLe === true || raw.ngoai_le === true) kq.ngoaiLe = true;
  return kq;
}

function taDangCo(p: PhienGom | null): string {
  if (!p) return '(chưa có gì)';
  const dong = p.dong
    .map((d) => `${d.daChot?.ten ?? d.tuKhoa}${d.sl != null ? ` × ${d.sl}` : ' (chưa rõ SL)'}`)
    .join('; ');
  return [
    `khách: ${p.khachDaChot?.ten ?? p.khachTuKhoa ?? '(chưa có)'}`,
    `hàng: ${dong || '(chưa có)'}`,
  ].join(' · ');
}

export async function trichSlot(
  generate: ToolAwareGenerate,
  cau: string,
  phien: PhienGom | null,
): Promise<KetQuaTrich> {
  const system = [
    'Bạn trích thông tin ĐƠN HÀNG từ MỘT câu của nhân viên bán hàng (tiếng Việt,',
    'có thể viết tắt: "10c" = 10 cái). LUÔN gọi tool ghi_slot, không trả lời text.',
    'Chỉ trích cái CÓ trong câu — không đoán, không bịa. Bỏ xưng hô (anh/chị/em/bác)',
    'khỏi tên khách. Câu chỉ có số lượng ("10 cái") → điền sl cho món ĐANG THIẾU',
    'trong phần "đang gom". Câu không liên quan đơn (hỏi tồn kho, báo cáo, chào',
    'hỏi…) → ghi_slot với ngoaiLe=true.',
  ].join(' ');
  const nguoiDung = `Đang gom: ${taDangCo(phien)}\nCâu nhân viên: "${cau}"`;

  try {
    const turn = await generate({
      system,
      messages: [{ role: 'user', content: nguoiDung }],
      tools: [ghiSlotDefinition],
      maxTokens: 400,
    });
    const call = turn.toolCalls.find((c) => c.name === 'ghi_slot');
    if (!call) return { ngoaiLe: true };
    return lamSachTrich(call.input);
  } catch (err) {
    // LLM sập không được làm máy sập: nhường agent thường xử câu này.
    logger.warn({ err }, '[gom-don] trichSlot lỗi — coi là ngoại lệ');
    return { ngoaiLe: true };
  }
}
