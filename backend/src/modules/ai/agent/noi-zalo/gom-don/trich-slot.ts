// SPDX-License-Identifier: AGPL-3.0-or-later
// Việc DUY NHẤT của LLM trong máy gom đơn: đọc MỘT câu của nhân viên và trích
// slot ra JSON qua tool ghi_slot. Không quyết hỏi gì, không soạn lời.
//
// Model không gọi tool / lỗi / trả rác → {ngoaiLe:true}: máy nhường agent
// thường, KHÔNG đoán bừa. Mọi field validate kiểu ở code — model flash rẻ mấy
// cũng không phá được cấu trúc phiên.
import { logger } from '../../../../../shared/utils/logger.js';
import type { ToolAwareGenerate, ToolDefinition } from '../../types.js';
import type { PhienGom } from './kieu.js';

export interface KetQuaTrich {
  /** Tên/mã khách — ĐÃ bỏ xưng hô (anh/chị/em). */
  khach?: string;
  dong?: Array<{ sp: string; sl?: number; gia?: number; chietKhau?: number }>;
  /** SP nhân viên muốn BỎ khỏi đơn đang gom ("bỏ 300 thanh led tỏa"). */
  boDong?: string[];
  /** NV báo đây là KHÁCH MỚI, kèm thông tin để tạo ("khách mới", tên + SĐT). */
  khachMoi?: { ten: string; sdt?: string; diaChi?: string };
  huy?: boolean;
  xacNhan?: boolean;
  /** Câu không liên quan đơn hàng (digression) — máy nhường agent thường. */
  ngoaiLe?: boolean;
  /**
   * LÊN ĐƠN MỚI — cửa vào máy gom đơn, do LLM quyết (10/08).
   *
   * Trước đây dùng regex đoán chữ ("lên"+"đơn" dính nhau). Bug 22:09: "lên cho
   * anh Huấn khách mới 10 nguồn NB nhé" trượt regex → máy không chạy, mất luôn
   * luật giá NV báo. Vá regex từng chữ thì thiếu mãi; LLM giỏi hiểu câu chữ,
   * code giỏi giữ luật — để mỗi bên làm việc của mình.
   */
  lenDon?: boolean;
  /**
   * Chiết khấu % cho CẢ ĐƠN, khi nhân viên nói riêng một câu không kèm SP
   * ("triết khấu 8% nữa em" — ca thật 03:24:53 11/08).
   */
  chietKhauDon?: number;
  /** SỬA đơn đã có (spec 08/08) thay vì lên đơn mới. */
  sua?: boolean;
  /** Mã đơn NV nhắc ("sửa đơn S13820") — dạng S + số. */
  maDon?: string;
}

const ghiSlotDefinition: ToolDefinition = {
  name: 'ghi_slot',
  description:
    'LUÔN gọi tool này với thông tin trích được từ câu của nhân viên. ' +
    'Câu không liên quan đơn hàng thì gọi với ngoai_le=true.',
  inputSchema: {
    type: 'object',
    properties: {
      khach: {
        type: 'string',
        description:
          'Tên hoặc mã khách, BỎ xưng hô: "anh Hưng"→"Hưng". NHƯNG giữ nguyên ' +
          'biệt danh/từ ngành hàng dính với tên: "anh Long Led"→"Long Led", ' +
          '"chị Hoa Đèn"→"Hoa Đèn" — đó là MỘT PHẦN TÊN khách, không phải tên hàng.',
      },
      dong: {
        type: 'array',
        description: 'Các dòng hàng nhắc trong câu',
        items: {
          type: 'object',
          properties: {
            sp: { type: 'string', description: 'Tên/từ khoá sản phẩm' },
            sl: { type: 'number', description: 'Số lượng nếu câu có nói' },
            gia: { type: 'number', description: 'Đơn giá nhân viên báo, ĐỔI RA ĐỒNG: "170k"→170000, "13k/thanh"→13000, "1tr2"→1200000' },
            chietKhau: { type: 'number', description: 'Chiết khấu PHẦN TRĂM nếu câu có nói: "chiết khấu 8%"/"triết khấu 8"/"giảm 5%" → 8, 8, 5' },
          },
          required: ['sp'],
        },
      },
      boDong: {
        type: 'array', items: { type: 'string' },
        description: 'Tên/từ khoá SP nhân viên muốn BỎ khỏi đơn: "bỏ 300 thanh led tỏa", "không lấy cáp nữa"',
      },
      khachMoi: {
        type: 'object',
        description:
          'Nhân viên nói KHÁCH MỚI. Điền cả khi câu chỉ có đúng chữ "khách mới" ' +
          'mà KHÔNG kèm tên — lúc đó bỏ trống ten, máy tự lấy tên đã nhắc trước đó.',
        properties: {
          ten: { type: 'string', description: 'Tên khách nếu câu có nói, bỏ xưng hô' },
          sdt: { type: 'string', description: 'Số điện thoại nếu có' },
          diaChi: { type: 'string', description: 'Địa chỉ nếu có' },
        },
      },
      lenDon: {
        type: 'boolean',
        description:
          'true khi nhân viên muốn LÊN ĐƠN MỚI cho khách — bất kể họ dùng chữ gì: ' +
          '"lên đơn cho anh A", "lên cho anh A 10 cái X", "bán cho chị B 5 cuộn", ' +
          '"lấy cho anh C 3 cái". Dấu hiệu: có KHÁCH + có HÀNG. ' +
          'KHÔNG phải lên đơn: xuất hoá đơn, báo cáo, doanh số, tồn kho, công nợ, ' +
          'sửa đơn đã có (dùng sua=true), hỏi giá đơn thuần.',
      },
      chietKhauDon: { type: 'number', description: 'Chiết khấu % cho CẢ ĐƠN khi câu nói riêng không kèm tên SP: "chiết khấu 8% nữa", "giảm 5% đi" → 8, 5' },
      sua: { type: 'boolean', description: 'true khi nhân viên SỬA đơn đã có (thêm hàng/đổi số lượng), không phải lên đơn mới' },
      maDon: { type: 'string', description: 'Mã đơn nhân viên nhắc, dạng S13820' },
      huy: { type: 'boolean', description: 'true khi nhân viên muốn huỷ đơn đang gom' },
      xacNhan: { type: 'boolean', description: 'true khi nhân viên đồng ý chốt (ok, đúng rồi, lên đi)' },
      ngoaiLe: { type: 'boolean', description: 'true khi câu KHÔNG liên quan việc lên đơn' },
    },
  },
};

const SL_TOI_DA = 1_000_000_000; // đủ cho cả số lượng lẫn đơn giá (đồng)

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
        const gia = nguyenDuong(d.gia);
        // Chiết khấu chỉ nhận 0-100: model bịa "150%" hay số âm thì BỎ, đừng
        // ghi bừa vào đơn — sai chiết khấu là sai tiền thật của khách.
        const ckTho = Number(d.chietKhau);
        const ck = Number.isFinite(ckTho) && ckTho > 0 && ckTho <= 100 ? ckTho : undefined;
        return {
          sp: (d.sp as string).trim(),
          ...(sl !== undefined ? { sl } : {}),
          ...(gia !== undefined ? { gia } : {}),
          ...(ck !== undefined ? { chietKhau: ck } : {}),
        };
      });
    if (dong.length > 0) kq.dong = dong;
  }
  if (Array.isArray(raw.boDong)) {
    const bo = raw.boDong.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim());
    if (bo.length > 0) kq.boDong = bo;
  }
  const km = raw.khachMoi;
  if (typeof km === 'object' && km !== null) {
    const o = km as Record<string, unknown>;
    const ten = typeof o.ten === 'string' && o.ten.trim().length >= 2 ? o.ten.trim() : '';
    // Tên RỖNG vẫn nhận: nhân viên hay chỉ đáp "khách mới" khi bot đang hỏi
    // chọn (bug 17:08 10/08). Tên lấy từ phiên ở dapSlot — nó biết `khachTuKhoa`
    // của lượt trước, chỗ này thì không.
    kq.khachMoi = {
      ten,
      ...(typeof o.sdt === 'string' && o.sdt.trim() ? { sdt: o.sdt.trim() } : {}),
      ...(typeof o.diaChi === 'string' && o.diaChi.trim() ? { diaChi: o.diaChi.trim() } : {}),
    };
  }
  const ckDon = Number(raw.chietKhauDon);
  if (Number.isFinite(ckDon) && ckDon > 0 && ckDon <= 100) kq.chietKhauDon = ckDon;
  if (raw.lenDon === true) kq.lenDon = true;
  if (raw.sua === true) kq.sua = true;
  if (typeof raw.maDon === 'string' && /^S\d+$/i.test(raw.maDon.trim())) {
    kq.maDon = raw.maDon.trim().toUpperCase();
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
    'Câu bảo LÊN ĐƠN MỚI cho khách → lenDon=true, DÙ dùng chữ gì: "lên đơn cho',
    'anh A", "lên cho anh A 10 cái X", "bán cho chị B 5 cuộn", "lấy cho anh C 3',
    'cái", "xuất cho anh D 2 thùng". Dấu hiệu: có KHÁCH + có HÀNG (hoặc số lượng).',
    'Câu SỬA đơn đã có ("sửa đơn thêm 5 cáp", "đổi thành 100 cái", "thêm X vào',
    'đơn") → sua=true; có nhắc mã đơn (S13820) thì điền maDon.',
    'Nhân viên nói KHÁCH MỚI ("khách mới", "khách này chưa có") hoặc đưa tên +',
    'SĐT của khách chưa có → điền khachMoi {ten, sdt}. Vẫn điền khach như bình thường.',
    'GIÁ nhân viên báo ("x 170k", "13k/thanh", "giá 1tr2") → điền gia, ĐỔI RA',
    'ĐỒNG (170k=170000). Câu BỎ hàng ("bỏ 300 thanh led tỏa", "không lấy cáp',
    'nữa", "bỏ X ra") → điền boDong, KHÔNG điền dong.',
    'Chỉ trích cái CÓ trong câu — không đoán, không bịa. Bỏ xưng hô (anh/chị/em/bác)',
    'khỏi tên khách, nhưng GIỮ NGUYÊN biệt danh chứa từ ngành hàng — khách buôn hay',
    'tên kiểu "Long Led", "Hoa Đèn": "lên đơn cho anh Long Led" → khach="Long Led",',
    'KHÔNG cắt còn "Long" (bug thật 16:15 11/08 — tra sai người 2 lượt liền).',
    'Câu chỉ có số lượng ("10 cái") → điền sl cho món ĐANG THIẾU',
    'trong phần "đang gom". Câu không liên quan đơn (hỏi tồn kho, báo cáo, chào',
    'hỏi…) → ghi_slot với ngoaiLe=true. Câu xin XUẤT/GỬI (lại) HOÁ ĐƠN hay báo',
    'giá ("xuất hoá đơn", "gửi lại hoá đơn") cũng là ngoaiLe=true — "hoá đơn"',
    'KHÔNG BAO GIỜ là tên sản phẩm.',
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
