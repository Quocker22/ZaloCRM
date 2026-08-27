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
import { lamSachPhuPhi } from '../../../odoo/tools/phu-phi.js';
import { boDau } from '../../../odoo/tools/tra-san-pham.js';

export interface KetQuaTrich {
  /** Tên/mã khách — ĐÃ bỏ xưng hô (anh/chị/em). */
  khach?: string;
  dong?: Array<{ sp: string; sl?: number; gia?: number; chietKhau?: number; tang?: boolean }>;
  /** SP nhân viên muốn BỎ khỏi đơn đang gom ("bỏ 300 thanh led tỏa"). */
  boDong?: string[];
  /** NV báo đây là KHÁCH MỚI, kèm thông tin để tạo ("khách mới", tên + SĐT). */
  khachMoi?: { ten: string; sdt?: string; diaChi?: string };
  huy?: boolean;
  /**
   * Nhân viên GẬT ("ok", "đúng rồi", "chốt đi").
   *
   * KHÔNG còn dùng để chốt đơn — bước đó bỏ 11/08 (anh Quốc: "nếu mọi thứ đã
   * rõ ràng thì lên đơn báo giá luôn"). Chỗ duy nhất còn đọc ô này là hàng rào
   * GIÁ BẤT THƯỜNG: khi máy hỏi lại "anh/chị báo 8đ mà hệ thống 230.000đ, giá
   * đúng là bao nhiêu?" thì cái gật ở đây là câu trả lời cho chính con số đó.
   */
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
   *
   * PHÂN BIỆT VỚI `dong[].chietKhau` (sửa 11/08): chiết khấu đứng NGAY SAU một
   * sản phẩm thì thuộc RIÊNG sản phẩm đó. Câu thật:
   *   "100 cái thẻ nhận v7512 x giá 230k triết khấu 8%. 10 cái ovp k2 x giá 2300k"
   * — 8% chỉ của thẻ nhận. Áp cho cả đơn là bớt nhầm 1.840.000đ ở dòng ovp.
   */
  chietKhauDon?: number;
  /**
   * PHỤ PHÍ nói trong câu (24/08): "thêm 70k ship" → [{ten:'Phí vận chuyển',
   * tien:70000}]; "phí lắp đặt 200k" → [{ten:'Phí lắp đặt', tien:200000}].
   * Mỗi khoản thành MỘT DÒNG ở cuối đơn. Ca thật 23:08 24/08: S15179 mất 70k
   * ship vì máy chưa có ô này.
   */
  phuPhi?: Array<{ ten: string; tien: number }>;
  /**
   * Kho xuất hàng NV nói trong câu ("kho HCM", "lấy kho Hồ Chí Minh") — dạng mã
   * hoặc tên; code map sang id qua KHO, không tin số model tự bịa.
   */
  kho?: string;
  /**
   * VAT nhân viên yêu cầu, tính bằng PHẦN TRĂM ("có VAT" → 8, "VAT 10%" → 10).
   *
   * Anh Quốc chốt 11/08: dùng cơ chế thuế sẵn có của Odoo (account.tax), không
   * dựng sản phẩm giả. Mặc định 8% vì đo prod: 175/175 đơn có VAT trong
   * 05-07/2026 đều dùng "VAT 8%" (tax_id=4).
   */
  vat?: number;
  /** SỬA đơn đã có (spec 08/08) thay vì lên đơn mới. */
  sua?: boolean;
  /**
   * NHẬP HÀNG — đơn MUA từ nhà cung cấp (11/08), ngược chiều với lên đơn bán.
   *
   * Ca thật 22:09 nhóm Test-AI: "@bot rồi tạo phiếu nhập hàng giúp tôi luôn" →
   * bot đáp "chưa có tool tạo phiếu nhập hàng ... nằm ngoài phạm vi em hỗ trợ",
   * dù quyền ghi purchase.order vốn đã có.
   *
   * Để LLM quyết chứ không chỉ regex, cùng lý do với `lenDon` (bug 22:09 10/08:
   * "lên cho anh Huấn" trượt regex nên mất luôn luật giá). Regex chỉ là lối tắt.
   */
  nhapHang?: boolean;
  /** Mã đơn NV nhắc ("sửa đơn S13820") — dạng S + số. */
  maDon?: string;
  /**
   * LỰA CHỌN MỀM từ danh sách bot vừa hỏi (12/08 tối — "tai linh động").
   *
   * "1aaaaaa"/"a b" đã có đường CODE tất định (apDungChon). Hai ô này dành
   * cho cách nói NGƯỜI: "lấy loại rẻ nhất", "cái đầu tiên ấy", "chọn loại có
   * giá đi" — model đọc danh sách bot vừa hỏi (kèm giá) rồi quy ra số/chữ.
   * Code VALIDATE lại bằng chính apDungChon — model chỉ đề xuất, phạm vi và
   * an toàn vẫn do code giữ.
   */
  chonKhach?: number;
  chonSp?: string[];
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
            gia: { type: 'number', description: 'Đơn giá nhân viên báo, ĐỔI RA ĐỒNG khi CÓ hậu tố: "170k"→170000, "1tr2"→1200000. Số TRẦN không hậu tố ("x1700", "giá 1800đ") là ĐỒNG sẵn — GIỮ NGUYÊN 1700/1800, TUYỆT ĐỐI không nhân nghìn.' },
            chietKhau: {
              type: 'number',
              description:
                'Chiết khấu PHẦN TRĂM của RIÊNG dòng này, khi câu nói chiết khấu NGAY SAU ' +
                'sản phẩm này: "100 cái thẻ v7512 giá 230k triết khấu 8%" → dòng thẻ v7512 ' +
                'có chietKhau=8. Chiết khấu chỉ thuộc sản phẩm đứng TRƯỚC nó, KHÔNG lan sang ' +
                'sản phẩm nói sau đó.',
            },
            tang: {
              type: 'boolean',
              description:
                'true khi đây là hàng TẶNG KÈM (giá 0đ): "tặng 1 cái", "khuyến mãi thêm 2 cái", ' +
                '"biếu anh 1 cuộn". Dòng tặng là dòng RIÊNG, KHÔNG gộp vào dòng bán: ' +
                '"10 cái ovp k2 giá 2300k tặng 1 cái" → HAI dòng, dòng bán sl=10 gia=2300000 ' +
                'và dòng tặng sl=1 tang=true. KHÔNG điền gia cho dòng tặng.',
            },
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
      chietKhauDon: {
        type: 'number',
        description:
          'Chiết khấu % cho CẢ ĐƠN — CHỈ khi câu nói chiết khấu TÁCH RIÊNG, không kèm ' +
          'tên sản phẩm nào: "triết khấu 8% nữa em", "giảm 5% đi". ' +
          'Câu có chiết khấu đi LIỀN SAU một sản phẩm thì KHÔNG dùng ô này — ' +
          'điền vào dong[].chietKhau của chính sản phẩm đó.',
      },
      phuPhi: {
        type: 'array',
        description:
          'PHỤ PHÍ nói trong câu — "thêm 70k ship"/"ship 70k"/"70k tiền vận chuyển" → ' +
          '[{ten:"Phí vận chuyển", tien:70000}]. Phí khác giữ đúng tên nhân viên nói: ' +
          '"phí lắp đặt 200k" → [{ten:"Phí lắp đặt", tien:200000}]. ' +
          'Tiền ĐỔI RA ĐỒNG như ô gia ("70k"→70000). ' +
          'ĐÂY KHÔNG phải dòng hàng — KHÔNG điền vào dong. Câu không nhắc phí thì bỏ trống.',
        items: {
          type: 'object',
          properties: {
            ten: { type: 'string', description: 'Tên khoản phí: ship/vận chuyển/cước → "Phí vận chuyển"' },
            tien: { type: 'number', description: 'Số tiền (đồng), đổi hậu tố k/tr như ô gia' },
          },
          required: ['ten', 'tien'],
        },
      },
      kho: {
        type: 'string',
        description:
          'Kho xuất hàng nếu câu có nói: "kho HCM"/"lấy kho Hồ Chí Minh" → "HCM"; ' +
          '"kho trung tâm"/"kho TT" → "TT"; "kho B"/"kho KB" → "KB". ' +
          'Câu KHÔNG nhắc kho thì bỏ trống — đừng đoán.',
      },
      vat: {
        type: 'number',
        description:
          'VAT tính bằng PHẦN TRĂM khi nhân viên nói đơn này có thuế: ' +
          '"có VAT"/"xuất VAT"/"lấy hoá đơn đỏ"/"đơn này có thuế" → 8 (mức mặc định của công ty); ' +
          '"VAT 10%"/"thuế 10%" → 10; "VAT 5%" → 5. ' +
          'Câu KHÔNG nhắc VAT/thuế thì BỎ TRỐNG — đừng tự thêm thuế vào đơn. ' +
          'CHÚ Ý: "xuất hoá đơn"/"gửi lại hoá đơn" (xin gửi ảnh hoá đơn) KHÔNG phải VAT.',
      },
      sua: { type: 'boolean', description: 'true khi nhân viên SỬA đơn đã có (thêm hàng/đổi số lượng), không phải lên đơn mới' },
      nhapHang: {
        type: 'boolean',
        description:
          'true khi nhân viên muốn NHẬP HÀNG / tạo ĐƠN MUA từ NHÀ CUNG CẤP — hàng shop mua VÀO: ' +
          '"tạo phiếu nhập hàng", "nhập hàng của nhà cung cấp X", "làm đơn mua", ' +
          '"order hàng Trung Quốc", "đặt hàng bên X về", "nhập lô hàng về". ' +
          'NGƯỢC CHIỀU với lenDon (bán RA cho khách). Dấu hiệu: có NHÀ CUNG CẤP, ' +
          'hoặc có chữ nhập/mua/order hàng về. Khi nhapHang=true thì tên trong ô `khach` ' +
          'là tên NHÀ CUNG CẤP.',
      },
      chon_khach: {
        type: 'number',
        description:
          'KHI bot vừa hỏi danh sách khách/NCC đánh số 1) 2)...: số nhân viên chọn, kể cả nói ' +
          'mềm ("lấy cái đầu", "NCC thứ nhất" → 1). Không chắc thì BỎ TRỐNG.',
      },
      chon_sp: {
        type: 'array',
        items: { type: 'string' },
        description:
          'KHI bot vừa hỏi các nhóm hàng a) b) c): chữ nhân viên chọn cho TỪNG NHÓM theo đúng ' +
          'THỨ TỰ trong câu hỏi ("loại rẻ nhất cho cả hai" → nhìn giá trong danh sách mà quy ra, ' +
          'vd ["a","c"]). Nhóm nào không rõ thì dùng "?" giữ chỗ. Không chắc toàn bộ thì BỎ TRỐNG.',
      },
      maDon: { type: 'string', description: 'Mã đơn nhân viên nhắc, dạng S13820' },
      huy: { type: 'boolean', description: 'true khi nhân viên muốn huỷ đơn đang gom' },
      xacNhan: { type: 'boolean', description: 'true khi nhân viên gật/đồng ý (ok, đúng rồi, giá đó chuẩn)' },
      ngoaiLe: { type: 'boolean', description: 'true khi câu KHÔNG liên quan việc lên đơn' },
    },
  },
};

const SL_TOI_DA = 1_000_000_000; // đủ cho cả số lượng lẫn đơn giá (đồng)

/**
 * Mức VAT khi nhân viên chỉ nói "có VAT" mà không kèm số.
 *
 * 8% chứ không phải 10%: đo prod 11/08 — 175 đơn + 143 hoá đơn dùng VAT trong
 * 05-07/2026 đều là "VAT 8%" (tax_id=4), không đơn nào dùng mức khác.
 */
export const VAT_MAC_DINH = 8;

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
        // Dòng TẶNG thì giá luôn là 0 — bỏ luôn `gia`/`chietKhau` model có lỡ
        // điền. Hàng tặng có giá là mâu thuẫn tự thân, và chiết khấu trên 0đ
        // vẫn là 0đ nhưng làm báo cáo khó đọc.
        const tang = d.tang === true;
        return {
          sp: (d.sp as string).trim(),
          ...(sl !== undefined ? { sl } : {}),
          ...(!tang && gia !== undefined ? { gia } : {}),
          ...(!tang && ck !== undefined ? { chietKhau: ck } : {}),
          ...(tang ? { tang: true } : {}),
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
  // PHỤ PHÍ (24/08): nhận cả snake_case phu_phi — model hay đổi kiểu tên.
  const phuPhi = lamSachPhuPhi(raw.phuPhi ?? (raw as Record<string, unknown>).phu_phi);
  if (phuPhi.length > 0) kq.phuPhi = phuPhi;
  // VAT: model hay trả true/"true" cho câu "có VAT" (không kèm số) dù schema
  // khai number — nhận luôn, quy về mức mặc định 8% của công ty (đo prod:
  // 175/175 đơn có VAT trong 05-07/2026 đều là "VAT 8%", tax_id=4).
  //
  // Số phải trong (0, 100]: model bịa "150%" hay số âm thì BỎ hẳn, đừng đoán
  // sang 8% — sai thuế là sai sổ sách, thà không có rồi nhân viên thấy thiếu.
  if (raw.vat === true || raw.vat === 'true') {
    kq.vat = VAT_MAC_DINH;
  } else if (raw.vat != null && raw.vat !== false) {
    const v = Number(raw.vat);
    if (Number.isFinite(v) && v > 0 && v <= 100) kq.vat = v;
  }
  if (typeof raw.kho === 'string' && raw.kho.trim()) kq.kho = raw.kho.trim();
  if (raw.lenDon === true) kq.lenDon = true;
  if (raw.sua === true) kq.sua = true;
  // Nhận cả snake_case: model hay trả `nhap_hang` dù schema khai camelCase.
  if (raw.nhapHang === true || raw.nhap_hang === true) kq.nhapHang = true;
  if (typeof raw.maDon === 'string' && /^S\d+$/i.test(raw.maDon.trim())) {
    kq.maDon = raw.maDon.trim().toUpperCase();
  }
  if (raw.huy === true) kq.huy = true;
  if (raw.xacNhan === true || raw.xac_nhan === true) kq.xacNhan = true;
  if (raw.ngoaiLe === true || raw.ngoai_le === true) kq.ngoaiLe = true;
  // LỰA CHỌN MỀM — chỉ nhận hình dạng sạch: số 1-99, chữ a-j đơn (hoặc "?"
  // giữ chỗ nhóm chưa rõ). Model bịa gì khác thì vứt ô đó, các ô còn lại giữ.
  const ck = Number(raw.chon_khach ?? raw.chonKhach);
  if (Number.isInteger(ck) && ck >= 1 && ck <= 99) kq.chonKhach = ck;
  const cs = raw.chon_sp ?? raw.chonSp;
  if (Array.isArray(cs)) {
    const sach = cs
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim().toLowerCase())
      .filter((x) => /^[a-j?]$/.test(x));
    if (sach.length > 0 && sach.length === cs.length) kq.chonSp = sach;
  }
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

/**
 * GUARD GIÁ NHÂN-NGHÌN-BỪA (vá 13/08 — ca thật 19:54 12/08, đơn 16 TỶ).
 *
 *   NV : "led Vũ Minh 9600 3b 6214 trắng x1700"
 *   Bot: 9600 × 1.700.000đ = 16.320.000.000đ   ← "x1700" bị dịch thành 1,7 TRIỆU
 *
 * Lời dặn "170k→170000" đúng cho số CÓ hậu tố; số TRẦN ("x1700") thì model
 * lúc giữ nguyên lúc tự nhân nghìn — không tất định. Hàng rào giá-lệch không
 * cứu được vì SP "chưa có giá" trong hệ thống, không có mốc so.
 *
 * Mốc so THẬT nằm ngay trong CÂU: nếu model trả giá X*1000 mà câu chứa đúng
 * số X đứng TRẦN (không hậu tố k/tr/nghìn... ngay sau) và KHÔNG chứa dạng đầy
 * đủ X*1000 → model đã nhân bừa, trả về X. Code tất định, chạy triệu lần như
 * một.
 */
const HAU_TO_NGHIN = /^(k|tr|m|củ|cu|nghìn|nghin|ngàn|ngan|triệu|trieu)/i;
/**
 * TÁCH SỐ LƯỢNG DÍNH ĐẦU TÊN HÀNG (vá 10:49 13/08). Model gộp "9600 3b 6214
 * trắng" thành MỘT tên sp, dòng thiếu sl → máy hỏi lại "lấy mấy cái" thứ đã
 * nằm sẵn trong câu (anh Quốc: "cái 9600 đó thì AI cũng phải nhận biết được
 * chứ?"). Số THUẦN ≥3 chữ số đứng ĐẦU tên hàng, khi dòng chưa có sl, gần như
 * chắc chắn là số lượng — "3b"/"6214" giữa chuỗi không bị đụng (mã hàng).
 */
/** "30b", "10000b", "4 cái", "160 thanh", "20m" — số lượng NV ghi TƯỜNG MINH kèm đơn vị. */
const SL_TUONG_MINH = /(?:^|\s)(\d{1,7})\s?(b|bong|bóng|c|cai|cái|thanh|m|met|mét|cuon|cuộn|chiec|chiếc|tam|tấm|bo|bộ|soi|sợi|goi|gói|thung|thùng)(?=\s|$|[,.;])/giu;

/**
 * Token "<số><đv>" nào THẬT là số lượng: "1m" trong "thanh toả 1m", "3b" trong
 * "3b 6214" (3 bóng) là MẢNH TÊN HÀNG, không phải SL (test cũ 13/08 + 26/08
 * đỏ khi thiếu rào này). Luật: đơn vị m/mét/b với số < 10 → tên hàng; token
 * ngay sau là mã số (≥3 chữ số) → tên hàng; số phải > 0.
 */
function laTokenSl(so: number, donVi: string, sau: string): boolean {
  if (!(so > 0)) return false;
  const dv = donVi.toLowerCase();
  if ((dv === 'm' || dv === 'met' || dv === 'mét' || dv === 'b') && so < 10) return false;
  if (/^\s*\d{3,}/.test(sau)) return false;
  return true;
}
function tokenSlThat(cau: string): Array<{ so: number; index: number }> {
  const ra: Array<{ so: number; index: number }> = [];
  for (const m of cau.matchAll(SL_TUONG_MINH)) {
    const sau = cau.slice(m.index! + m[0].length, m.index! + m[0].length + 6);
    if (laTokenSl(Number(m[1]), m[2], sau)) ra.push({ so: Number(m[1]), index: m.index! });
  }
  return ra;
}

/**
 * SL TƯỜNG MINH THẮNG (replay 27/08): "Lộc led 88 / 30b f30…" model lấy 88
 * (số nhà của khách) làm SL; "Red Sun : 2607 ấm 10000b" lấy 2607 (mã SP) làm
 * SL. NV đã ghi "30b"/"10000b" thì đó là số lượng, không bàn cãi. Chỉ áp khi
 * câu có ĐÚNG MỘT token tường minh và trích ra ĐÚNG MỘT dòng (nhiều dòng thì
 * model đã tự ghép từng dòng).
 */
/**
 * Tên hàng model trích còn dính SL tường minh ở ĐẦU ("270b Fi50 full 26803
 * đầu đục" — replay 27/08 làm tra SP ra F30 thay vì Fi50) → tách: SL = 270,
 * tên = phần còn lại. "3b 6214" (3 bóng) là mảnh tên → laTokenSl chặn.
 */
export function tachSlDauTenSp(trich: KetQuaTrich): void {
  for (const d of trich.dong ?? []) {
    const m = d.sp.match(/^(\d{1,7})\s?(b|bong|bóng|c|cai|cái|thanh|cuon|cuộn|chiec|chiếc|tam|tấm|bo|bộ|soi|sợi|goi|gói|thung|thùng)\s+(\S.{2,})$/iu);
    if (!m) continue;
    const so = Number(m[1]);
    if (!laTokenSl(so, m[2], m[3])) continue;
    // SL tường minh ở đầu tên THẮNG số model đoán (replay lần 3: model đưa
    // sl=5200 từ "x 5200" rồi để "30b" dính tên → tra "30b f30" ra hàng sai).
    d.sl = so;
    d.sp = m[3].trim();
  }
}

/**
 * Câu mở đầu bằng XƯNG HÔ + tên rồi tới số ("anh việt nguyễn xiển 400b 4 bóng…",
 * "chị phương ali 4 bóng lixin…") mà model trích khách CỤT ("việt" → 10 khách
 * tên Việt, replay 27/08) → lấy nguyên cụm trước số làm từ khoá khách. Chỉ áp
 * khi model không trích hoặc trích ra cụm NGẮN HƠN nằm trong cụm này.
 */
export function apKhachTheoXungHo(cau: string, trich: KetQuaTrich): void {
  if (trich.khachMoi) return;
  const m = cau.replace(/@\S+/g, ' ').trim()
    .match(/^(?:(?:lên|len)\s+(?:đơn|don)\s+(?:cho\s+)?|(?:đơn|don)\s+(?:cho\s+)?)?((?:anh|chị|chi|chú|chu|cô|co|bác|bac|cty|công ty|cong ty)\s+[^\d\/:,.;\n]{2,40}?)\s+(?=\d)/iu);
  if (!m) return;
  const cum = m[1].trim();
  if (cum.split(/\s+/).length < 3) return; // "anh Hưng" (2 từ) để model; ≥3 từ mới đáng ghi đè
  if (!trich.khach) { trich.khach = cum; return; }
  const cu = boDau(trich.khach).trim();
  const moi = boDau(cum);
  if (cu === moi || !moi.includes(cu) || trich.khach.split(/\s+/).length >= cum.split(/\s+/).length) return;
  trich.khach = cum;
}

export function apSlTuongMinh(cau: string, trich: KetQuaTrich): void {
  if (trich.dong?.length !== 1) return;
  const tk = tokenSlThat(cau).filter((m) => {
    // "x 5200" / "x5200đ" là giá, không phải SL: bỏ số đứng ngay sau 'x'.
    const truoc = cau.slice(Math.max(0, m.index - 3), m.index);
    return !/x\s*$/i.test(truoc);
  });
  if (tk.length !== 1) return;
  const sl = tk[0].so;
  const d = trich.dong[0];
  if (!Number.isFinite(sl) || sl <= 0 || d.sl === sl || d.tang) return;
  // Model ĐÃ có SL khác → chỉ ghi đè khi token đứng ĐẦU vế hàng ("… / 30b f30",
  // "= 16 sợi") hoặc CUỐI câu (trước "x 950₫"). Token nằm giữa tên ("10 cáp
  // 16 sợi nhỏ" — model lấy 10 đúng) là mảnh tên, không đụng.
  if (d.sl != null) {
    const truoc = cau.slice(0, tk[0].index).replace(/@\S+/g, '').trim();
    const sau = cau.slice(tk[0].index).replace(SL_TUONG_MINH, '').replace(/@\S+/g, '')
      .replace(/\b(x|giá|gia)\s*[\d.,]+\s*[kđ₫]?\b/giu, '').replace(/[\s.,;₫đk]+$/u, '').trim();
    const dauVe = truoc === '' || /[\/:.,\-=]$/.test(truoc);
    if (!dauVe && sau !== '') return;
  }
  logger.warn({ sp: d.sp, slCu: d.sl, slMoi: sl }, '[trich-slot] SL tường minh trong câu khác SL model trích — lấy SL tường minh');
  d.sl = sl;
}

/**
 * "<KHÁCH> / <hàng…>" — nếp gõ của NV Nelia (Kiên định công / 4n 24v600w…,
 * Lộc led 88 / 30b f30…, Qc Tv T / 4 pha 50w…). Vế trước dấu " / " là KHÁCH
 * nguyên văn; model hay cắt mất "88", "T&T" → khách sai người. Code ghi đè.
 */
export function apKhachTheoGachCheo(cau: string, trich: KetQuaTrich): void {
  // Bỏ khối hệ thống chèn ("[Trả lời tin: …]", "[Khách gửi ảnh…]") — trong đó
  // cũng có dấu "/" (test 11/08 đỏ: khách thành '[Trả lời tin: …').
  const sach = cau.replace(/\[Trả lời tin:[\s\S]*?\]\s*/gu, ' ').replace(/\[Khách gửi ảnh[\s\S]*\]\s*/gu, ' ');
  const m = sach.replace(/@\S+/g, ' ').trim().match(/^([^\/\n\[\]]{2,60}?)\s*\/\s*\S/u);
  if (!m) return;
  const khach = m[1].trim().replace(/[.,:;]+$/, '');
  if (!khach || /\d{3,}\s*(b|c|cai|thanh|m)\b/i.test(khach)) return; // vế trước là hàng, không phải khách
  if (trich.khach && trich.khach.trim().toLowerCase() === khach.toLowerCase()) return;
  logger.info({ cu: trich.khach, moi: khach }, '[trich-slot] khách theo dấu " / " — lấy nguyên văn vế trước');
  trich.khach = khach;
  delete trich.khachMoi;
}

export function tachSlDinhDauSp(trich: KetQuaTrich): void {
  for (const d of trich.dong ?? []) {
    if (d.sl != null) continue;
    // Có SL tường minh THẬT trong tên ("2607 ấm 10000b") → số đầu là MÃ, không
    // phải SL. "9600 3b 6214" thì "3b" là mảnh tên → vẫn tách 9600 như cũ.
    if (tokenSlThat(d.sp).length > 0) continue;
    const m = d.sp.match(/^(\d{3,})\s+(.{3,})$/);
    if (!m) continue;
    const so = Number(m[1]);
    if (!Number.isFinite(so) || so <= 0) continue;
    logger.info({ sp: d.sp, sl: so }, '[trich-slot] tách số lượng dính đầu tên hàng');
    d.sl = so;
    d.sp = m[2].trim();
  }
}

export function suaGiaNhanBua(cau: string, trich: KetQuaTrich): void {
  if (!trich.dong?.length) return;
  const c = cau.toLowerCase();
  for (const d of trich.dong) {
    if (d.gia == null || d.gia < 1000 || d.gia % 1000 !== 0) continue;
    const goc = d.gia / 1000;
    const chuoiGoc = String(goc);
    // Câu chứa dạng ĐẦY ĐỦ ("1700000" / "1.700.000") → model dịch đúng, đừng đụng.
    const dayDu = String(d.gia);
    const dayDuCham = dayDu.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    if (c.includes(dayDu) || c.includes(dayDuCham)) continue;
    // Tìm mọi vị trí số gốc đứng nguyên trong câu (không phải phần của số dài hơn).
    let coTran = false;
    let coHauTo = false;
    for (let i = c.indexOf(chuoiGoc); i >= 0; i = c.indexOf(chuoiGoc, i + 1)) {
      const truoc = i > 0 ? c[i - 1] : ' ';
      const sauIdx = i + chuoiGoc.length;
      // "Phần của số khác" = dính chữ số, hoặc dấu chấm NGĂN NGHÌN (chấm theo
      // sau bởi số — "1700.000"). Chấm CUỐI CÂU ("x1700. 36 cái") không tính.
      const sau = c[sauIdx] ?? ' ';
      const laSoDai = /\d/.test(truoc) || /\d/.test(sau)
        || (sau === '.' && /\d/.test(c[sauIdx + 1] ?? ' '));
      if (laSoDai) continue;
      const duoi = c.slice(sauIdx).replace(/^\s+/, '');
      if (HAU_TO_NGHIN.test(duoi)) coHauTo = true;
      else coTran = true;
    }
    if (coTran && !coHauTo) {
      logger.warn(
        { giaCu: d.gia, giaMoi: goc, sp: d.sp },
        '[trich-slot] model nhân nghìn bừa cho số trần — trả về đúng số trong câu',
      );
      d.gia = goc;
    }
  }
}

/**
 * "30b f30 full 26803 đầu trong x 5200" (27/08, ca thật 06:51): model lấy
 * 5200 làm SỐ LƯỢNG và bỏ giá → đơn S15339 5.200 bóng = 27 triệu. Nếp NV:
 * "<SL><đơn vị> <tên hàng> x <giá>" — số đứng sau "x" là GIÁ. Code sửa lại
 * khi: câu có đúng mẫu đó, dòng trích có sl == số-sau-x, và chưa có giá.
 */
export function suaSlGiaNhamX(cau: string, trich: KetQuaTrich): void {
  if (!trich.dong?.length) return;
  const c = cau.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  const m = c.match(/(?:^|\s)(\d{1,6})\s*(b|bong|c|cai|thanh|m|met|cuon|chiec|tam|bo)\b[^x]*?\bx\s*(\d[\d.]*)\s*(k|d)?\b/u);
  if (!m) return;
  const sl = Number(m[1]);
  const giaSo = Number(m[3].replace(/\./g, ''));
  if (!Number.isFinite(sl) || !Number.isFinite(giaSo) || sl === giaSo) return;
  const gia = m[4] === 'k' ? giaSo * 1000 : giaSo;
  for (const d of trich.dong) {
    if (d.gia == null && d.sl === giaSo) {
      logger.warn({ sp: d.sp, slCu: d.sl, slMoi: sl, gia }, '[trich-slot] model lấy giá sau "x" làm số lượng — sửa lại');
      d.sl = sl;
      d.gia = gia;
    }
  }
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
    'Câu NHẬP HÀNG / ĐƠN MUA từ NHÀ CUNG CẤP (hàng mua VÀO, ngược với bán ra)',
    '→ nhapHang=true: "tạo phiếu nhập hàng", "nhập hàng của nhà cung cấp",',
    '"đơn hàng của nhà cung cấp trung quốc", "làm đơn mua", "order hàng Trung',
    'Quốc", "đặt hàng bên X về". Lúc đó ô khach mang tên NHÀ CUNG CẤP, và giá',
    'trong câu là GIÁ NHẬP → vẫn điền vào gia như bình thường.',
    'Nhân viên nói KHÁCH MỚI ("khách mới", "khách này chưa có") hoặc đưa tên +',
    'SĐT của khách chưa có → điền khachMoi {ten, sdt}. Vẫn điền khach như bình thường.',
    'GIÁ nhân viên báo ("x 170k", "13k/thanh", "giá 1tr2") → điền gia, ĐỔI RA',
    'ĐỒNG (170k=170000). Câu BỎ hàng ("bỏ 300 thanh led tỏa", "không lấy cáp',
    'nữa", "bỏ X ra") → điền boDong, KHÔNG điền dong.',
    'CHIẾT KHẤU đi LIỀN SAU một sản phẩm là của RIÊNG sản phẩm đó:',
    '"100 cái thẻ v7512 giá 230k triết khấu 8%. 10 cái ovp k2 giá 2300k" →',
    'dòng thẻ v7512 có chietKhau=8, dòng ovp k2 KHÔNG có chiết khấu. Chỉ dùng',
    'chietKhauDon khi chiết khấu nói TÁCH RIÊNG, không kèm tên hàng nào',
    '("triết khấu 8% nữa em").',
    'PHỤ PHÍ ("thêm 70k ship", "ship 70k", "cước vận chuyển 50k", "phí lắp đặt',
    '200k") → điền phuPhi [{ten, tien}], tiền đổi ra đồng; ship/vận chuyển/cước',
    'quy về ten="Phí vận chuyển". Phụ phí KHÔNG phải dòng hàng — đừng cho vào dong.',
    'TẶNG KÈM ("tặng 1 cái", "khuyến mãi thêm 2", "biếu 1 cuộn") → thêm dòng',
    'RIÊNG với tang=true, KHÔNG điền gia. "10 cái ovp k2 giá 2300k tặng 1 cái"',
    '= HAI dòng: {sp:"ovp k2", sl:10, gia:2300000} và {sp:"ovp k2", sl:1, tang:true}.',
    'KHO nếu câu có nhắc ("kho HCM", "lấy kho Hồ Chí Minh", "kho trung tâm",',
    '"xuất kho B nhé", "đổi sang kho HCM") → điền kho, kể cả khi câu chỉ nói',
    'mỗi kho ở lượt sau (bot KHÔNG hỏi kho, nên đây là đường DUY NHẤT nhân viên',
    'đổi kho). Câu không nhắc thì bỏ trống, ĐỪNG đoán.',
    'VAT/THUẾ: câu nói đơn có thuế ("có VAT", "xuất VAT", "thêm vat", "lấy hoá',
    'đơn đỏ", "đơn này có thuế") → vat=8 (mức mặc định công ty); nói rõ mức',
    '("VAT 10%", "thuế 10%") → vat=10. Câu không nhắc thuế thì BỎ TRỐNG.',
    'PHÂN BIỆT: "xuất hoá đơn"/"gửi lại hoá đơn" một mình là xin GỬI ẢNH hoá',
    'đơn → ngoaiLe=true, KHÔNG phải vat. "Xuất VAT"/"hoá đơn đỏ" mới là thuế.',
    // ─── NỘI DUNG ẢNH (vá 11/08, ca thật 23:22) ────────────────────────────
    //
    //   23:22:31  NV : [Ảnh danh sách hàng] "@Tiểu Mã Nelia tạo phiếu nhập hàng
    //                   giúp tôi nhà cung cấp là Trung Quốc"
    //   23:22:43  Bot: "Có 2 nhà cung cấp tên Trung Quốc: 1)… 2)… chọn giúp em"
    //   23:22:49  NV : "1"
    //   23:22:50  Bot: "Anh/chị nhập những hàng gì ạ?"  ← HỎI THỨ ĐÃ CÓ TRONG ẢNH
    // Anh Quốc: "ủa là sao? sản phẩm rồi số lượng trong ảnh mà".
    //
    // Bot ĐÃ đọc ảnh thành công (log `[doc-anh] đã đọc ảnh`) và `luong-media`
    // ĐÃ ghép đúng chuỗi `<lời nhắn>\n[Khách gửi ảnh, nội dung trong ảnh: …]`.
    // Chuỗi đó cũng tới máy gom đơn NGUYÊN VẸN — `boQuote` neo `^` nên không
    // đụng tới khối ở cuối câu, và `nhanDienLenhNhanVien` chỉ cắt đúng cái tag
    // (đã đo lại từng hàm một, không hàm nào nuốt mất).
    //
    // Chỗ đứt là LỜI DẶN NÀY: nó viết cho "MỘT câu của nhân viên" và chưa từng
    // nhắc tới khối `[Khách gửi ảnh…]`. Model trích được ý định (nhapHang) và
    // tên NCC từ lời nhắn rồi coi khối ảnh là văn bản nền, BỎ QUA danh sách
    // hàng. Phiên vào chế 'nhap' với `dong` rỗng → `buocTiepTheo` trả
    // `hoi_thieu:'sp'` → đúng câu 23:22:50.
    //
    // Vá bằng lời dặn chứ không bằng regex bóc khối ở code: danh sách hàng viết
    // tay muôn hình vạn trạng ("P10 full out: 10.000 tấm", "10k tấm P10",
    // "P5 - 1460"), tách bằng chữ là thiếu mãi. Model vốn đã giỏi việc này —
    // nó chỉ cần được BẢO là khối đó mang hàng thật.
    'NỘI DUNG ẢNH: câu có thể kèm khối "[Khách gửi ảnh, nội dung trong ảnh: …]"',
    '— đó là chữ bot ĐỌC ĐƯỢC TỪ ẢNH nhân viên vừa gửi, KHÔNG phải văn bản nền.',
    'Đọc khối đó Y NHƯ nhân viên tự gõ ra: mọi tên hàng + số lượng trong ảnh đều',
    'phải vào `dong`. Ảnh danh sách hàng ("P10 full out: 10.000 tấm / P5 full out:',
    '1.460 tấm") → hai dòng {sp:"P10 full out", sl:10000} và {sp:"P5 full out",',
    'sl:1460}. Số trong ảnh giữ NGUYÊN VĂN, "10.000" là mười nghìn chứ không phải',
    '10. Có giá nhập trong ảnh thì điền `gia` như thường.',
    'Lời nhắn kèm ảnh cho Ý ĐỊNH (lên đơn / nhập hàng / sửa đơn) và tên khách hay',
    'nhà cung cấp; ẢNH cho DANH SÁCH HÀNG. Phải lấy CẢ HAI — chỉ lấy lời nhắn là',
    'bot quay ra hỏi lại thứ đã nằm sẵn trong ảnh (ca thật 23:22 11/08).',
    'Khối ảnh đứng MỘT MÌNH (không kèm lời nhắn) là nhân viên gửi ảnh BỔ SUNG cho',
    'việc đang gom → vẫn trích hàng vào `dong`, KHÔNG phải ngoaiLe.',
    'LỰA CHỌN MỀM: nếu khối "Bot vừa hỏi" bên dưới là DANH SÁCH đánh số/chữ thì',
    'câu nhân viên nhiều khả năng là LỰA CHỌN — kể cả nói kiểu người: "lấy loại',
    'rẻ nhất" (nhìn giá trong danh sách), "cái đầu tiên", "loại có giá ấy",',
    '"số 2 nhé" → điền chon_khach/chon_sp. KHÔNG điền khach/dong mới khi câu',
    'chỉ là lựa chọn. Không chắc thì bỏ trống hai ô đó.',
    'TRẢ LỜI GIÁ: nếu khối "Bot vừa hỏi" là câu hỏi GIÁ cho một sản phẩm ("Sản',
    'phẩm "X" chưa có giá… báo giá giúp em") thì câu chỉ nêu giá ("Giá 13k",',
    '"13k/thanh", "13 nghìn", "13.000") → dong=[{sp:"X" (tên đúng như bot hỏi),',
    'gia:13000}], KHÔNG điền sl, KHÔNG coi là hàng mới. NV nhắc kèm tên hàng',
    'theo cách gọi của họ ("led thanh toả trắng lixin giá 13k") → vẫn sp="X".',
    'CÂU TRỤ NHÂN VIÊN HAY GÕ: "khách SL tên-hàng xGIÁ" — "led Vũ Minh 9600 3b',
    '6214 trắng x1700" → khach="Vũ Minh" (led là ngành hàng dính tên), dong=',
    '[{sp:"3b 6214 trắng", sl:9600, gia:1700}]. SỐ ĐỨNG TRƯỚC TÊN HÀNG là SỐ',
    'LƯỢNG — đừng nhét số lượng hay tên khách vào sp; sp chỉ chứa TÊN HÀNG.',
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
  // NGỮ CẢNH SỐNG CÒN (12/08 tối): câu trả lời chỉ có nghĩa khi model THẤY
  // câu hỏi. "1aaaaaa"/"lấy loại rẻ nhất" đặt cạnh danh sách a/b/c kèm giá
  // thì model nào cũng hiểu; thiếu nó thì mọi lựa chọn mềm là câu đố.
  const botVuaHoi = phien?.tinCuoi ? `\nBot vừa hỏi:\n${phien.tinCuoi.slice(0, 700)}` : '';
  const nguoiDung = `Đang gom: ${taDangCo(phien)}${botVuaHoi}\nCâu nhân viên: "${cau}"`;

  try {
    const turn = await generate({
      system,
      messages: [{ role: 'user', content: nguoiDung }],
      tools: [ghiSlotDefinition],
      maxTokens: 400,
    });
    const call = turn.toolCalls.find((c) => c.name === 'ghi_slot');
    if (!call) return { ngoaiLe: true };
    const kq = lamSachTrich(call.input);
    suaGiaNhanBua(cau, kq);
    tachSlDinhDauSp(kq);
    suaSlGiaNhamX(cau, kq);
    tachSlDauTenSp(kq);
    apSlTuongMinh(cau, kq);
    apKhachTheoGachCheo(cau, kq);
    apKhachTheoXungHo(cau, kq);
    boSungGiaTuKhoiAnh(cau, kq);
    return kq;
  } catch (err) {
    // LLM sập không được làm máy sập: nhường agent thường xử câu này.
    logger.warn({ err }, '[gom-don] trichSlot lỗi — coi là ngoại lệ');
    return { ngoaiLe: true };
  }
}

/**
 * BÙ GIÁ TỪ KHỐI ẢNH (ca thật 16:23 26/08, nhóm "Dậy học cho AI").
 *
 * Ảnh hoá đơn cũ ghi rõ "Vỏ Neon 6mm Xanh Ngọc: 30 Mét, giá 9.000 đ" — model
 * đọc ảnh chép đúng (đo lại 23:30 cùng ngày), nhưng lượt trích slot thật đã
 * bỏ `gia`, đơn S15326 lên với giá hệ thống 12.000/13.000 → anh Quyết "sai
 * giá rồi". Chạy lại cùng câu thì trích ra đủ giá — tức LLM lúc có lúc không.
 * Khối ảnh do `loiDanDocAnh` ép định dạng "tên: SL đơn vị, giá X" nên đọc
 * bằng code được: dòng nào trích thiếu giá mà khớp tên một dòng trong ảnh
 * có giá → lấy giá đó. KHÔNG đè giá model đã trích (NV có thể báo giá mới
 * trong caption), KHÔNG đụng dòng tặng.
 */
export function boSungGiaTuKhoiAnh(cau: string, trich: KetQuaTrich): void {
  if (!trich.dong?.length) return;
  const iAnh = cau.indexOf('[Khách gửi ảnh');
  if (iAnh < 0) return;
  const khoi = cau.slice(iAnh);
  // "- Tên hàng (ghi chú): 30 Mét, giá 9.000 đ"  |  "Tên: 20 cái giá 170k"
  const giaTrongAnh: Array<{ ten: string; gia: number }> = [];
  for (const dong of khoi.split('\n')) {
    const m = dong.match(/^\s*[-•*]?\s*(.+?)\s*:\s*[\d.,]+\s*[^,]*?,?\s*giá\s*([\d.]+)\s*(k|nghìn|ngàn|tr|triệu|đ|d|vnd)?/i);
    if (!m) continue;
    const so = Number(m[2].replace(/\./g, '').replace(/,/g, '.'));
    if (!Number.isFinite(so) || so <= 0) continue;
    const hauTo = (m[3] ?? '').toLowerCase();
    const gia = hauTo === 'k' || hauTo === 'nghìn' || hauTo === 'ngàn' ? so * 1000
      : hauTo === 'tr' || hauTo === 'triệu' ? so * 1_000_000 : so;
    giaTrongAnh.push({ ten: chuanTenSo(m[1]), gia });
  }
  if (giaTrongAnh.length === 0) return;
  for (const d of trich.dong) {
    if (d.gia != null || d.tang) continue;
    const sp = chuanTenSo(d.sp);
    if (sp.length < 4) continue;
    const khop = giaTrongAnh.filter((g) => g.ten.includes(sp) || sp.includes(g.ten));
    if (khop.length !== 1) continue; // 0 = không có; ≥2 = mơ hồ, để máy hỏi
    logger.info({ sp: d.sp, gia: khop[0].gia }, '[trich-slot] bù giá từ khối ảnh (model trích thiếu)');
    d.gia = khop[0].gia;
  }
}

/** Bỏ dấu, bỏ phần trong ngoặc và ký tự lạ — để so tên hàng ảnh ↔ tên trích. */
function chuanTenSo(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Model trích tên hàng CỤT ("f30 full" từ câu "30b f30 full 26803 đầu trong x
 * 5200") → tra ra nhiều loại và bắt NV chọn, dù câu gốc đã nói rõ "trong".
 * Chọn ứng viên theo CÂU GỐC: từ phân biệt (không chung cho mọi ứng viên) của
 * ứng viên nào nằm trong câu nhiều nhất, duy nhất, và tên nó được câu phủ
 * ≥ 60% → chọn. Mọi ca hoà / phủ thấp ("4 bóng lixin" ra Led dây Lixin phủ
 * 2/13) → null, để hỏi như cũ. Chỉ dùng cho kết quả KHÔNG gần đúng.
 */
export function chonUngVienTheoCau<T extends { ten: string }>(cau: string, ungVien: T[]): T | null {
  if (ungVien.length < 2) return null;
  const veHang = cau.replace(/@\S+/g, ' ').split(/\s\/\s|\s:\s|:\s/u).pop() ?? cau;
  const tokCau = new Set(boDau(veHang).replace(/\bx\s*[\d.,]+\s*[kđ₫]?\b/gu, ' ').split(/[^a-z0-9]+/).filter((t) => t.length >= 2));
  const tokUv = ungVien.map((u) => new Set(boDau(u.ten).replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/).filter((t) => t.length >= 2)));
  const chung = [...tokUv[0]].filter((t) => tokUv.every((s) => s.has(t)));
  const diem = tokUv.map((s) => {
    const rieng = [...s].filter((t) => !chung.includes(t));
    const hit = rieng.filter((t) => tokCau.has(t)).length;
    const phu = s.size === 0 ? 0 : [...s].filter((t) => tokCau.has(t)).length / s.size;
    return { hit, phu };
  });
  const maxHit = Math.max(...diem.map((d) => d.hit));
  if (maxHit <= 0) return null;
  const top = diem.map((d, i) => ({ ...d, i })).filter((d) => d.hit === maxHit);
  if (top.length !== 1) return null;
  const chon = top[0];
  // Chặt: câu KHÔNG chứa từ nào của ứng viên khác mà ứng viên chọn thiếu
  // (câu nói "trong" thì "đục" không được xuất hiện), và tên được phủ ≥ 50%. Dùng
  // được cả cho kết quả đường nới (daNoiRong) vì điều kiện này chặt hơn
  // "1 kết quả nới = phải hỏi": phải có từ phân biệt do NV gõ ra.
  const tokChon = tokUv[chon.i];
  if (tokUv.some((s, i) => i !== chon.i && [...s].some((t) => tokCau.has(t) && !tokChon.has(t)))) return null;
  if (chon.phu < 0.5) return null;
  if (diem.some((d, i) => i !== chon.i && d.phu >= chon.phu)) return null;
  return ungVien[chon.i];
}
