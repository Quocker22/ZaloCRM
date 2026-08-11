// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool GHI: tạo PHIẾU NHẬP HÀNG — đơn mua (purchase.order state=draft) từ NCC.
//
// VÌ SAO CÓ FILE NÀY — ca thật 22:09-22:11 ngày 11/08/2026 (nhóm Test-AI):
//
//   22:09 NV : "@bot rồi tạo phiếu nhập hàng giúp tôi luôn"
//         Bot: "em hiện chỉ có tool lên đơn BÁN và quản lý tồn, chưa có tool
//               tạo phiếu nhập hàng (mua hàng) — em không thể tạo phiếu nhập
//               kho được ạ."
//   22:11 NV : "1 đơn hàng của hàng cung cấp trung quốc, 2 Màn hình LED: P10
//               full out: 10.000 tấm..."   (danh sách 13 dòng hàng)
//         Bot: "tính năng này nằm ngoài phạm vi em hỗ trợ"
//
// BOT NÓI SAI. Đo quyền trên prod cùng ngày bằng chính tài khoản bot_zalo:
//   purchase.order       write=true create=true
//   purchase.order.line  write=true create=true
//   stock.picking        write=true create=true
// và 5 đơn mua thật đang nằm đó (P04517-P04521), 4 đơn của NCC "Trung Quốc"
// (id=314) — đúng nhà cung cấp nhân viên nhắc. `lam_odoo` (ghi tự do) vốn cũng
// không cấm bảng này. Thiếu là thiếu TOOL CÓ TÊN, không thiếu quyền: model
// không nghĩ ra, và prompt không dặn gì (grep "nhap hang|purchase" trong
// staff-command.ts ra 0 kết quả). Cùng một lỗi với `canh_bao_ton_kho` và
// `gui_tai_lieu` — có sẵn mà bot trả lời "em không có công cụ".
//
// Ba ràng buộc tuyệt đối, bê nguyên từ `tao-don-nhap.ts` (đơn BÁN):
//
//  1. CHỈ TẠO DRAFT. Không button_confirm(), không button_approve(), không
//     action_create_invoice(). Xác nhận đơn mua là sinh phiếu nhập kho thật +
//     công nợ phải trả thật. Người xem lại rồi bấm trên Odoo.
//
//  2. IDEMPOTENCY BẮT BUỘC. Vòng lặp có retry; retry không khoá = 2 phiếu nhập
//     cùng một lô hàng. Khoá nhét vào `origin` (xem GHI CHÚ KHOÁ bên dưới).
//
//  3. KHÔNG TẠO NCC. partner_id phải do `tra_nha_cung_cap` cung cấp. Bài học ca
//     "khách rác Long" 11/08: bot tự bịa partner rồi xuất hoá đơn 21 triệu lên
//     đó. Không tìm thấy NCC thì BÁO, không tự tạo.
import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import { sinhKhoaDon } from '../idempotency.js';
import {
  locKhopBoDau, coDauTiengViet, boDau, dieuKienBienTheDauCum,
} from '../tim-khong-dau.js';
import { xepHangKhach } from './tra-khach-hang.js';

/**
 * GHI CHÚ KHOÁ: vì sao `origin` chứ không phải `partner_ref`.
 *
 * `sale.order` có `client_order_ref` để nhét khoá. `purchase.order` không có
 * field tương đương, nên phải chọn giữa hai field char rảnh:
 *   - `partner_ref` = "Vendor Reference" — SỐ PHIẾU CỦA CHÍNH NCC. Chiếm chỗ đó
 *     là cướp một ô nghiệp vụ thật, kế toán đối chiếu với NCC sẽ mất dữ liệu.
 *   - `origin` = "Source Document" — chứng từ nguồn sinh ra đơn này. Phiếu do
 *     bot Zalo tạo thì nguồn CHÍNH LÀ hội thoại Zalo. Đúng ngữ nghĩa.
 *
 * Đo prod 11/08: cả 5 đơn mua hiện có đều `origin=false` và `partner_ref=false`
 * — không đụng dữ liệu ai, và `origin` searchable nên tra khoá được.
 */
const FIELD_KHOA = 'origin';

/** Field đọc lại sau khi tạo, để xác nhận phiếu đúng như mong đợi. */
const FIELDS_DON = ['id', 'name', 'state', 'amount_total', FIELD_KHOA];

export interface DongDonMua {
  san_pham_id: number;
  so_luong: number;
  /**
   * GIÁ NHẬP từ NCC (đồng) — KHÁC HẲN giá bán.
   *
   * KHÔNG BAO GIỜ lấy `list_price` (giá bán) làm giá trị mặc định cho ô này.
   * Sai bản chất, và ghi sai giá vốn thì mọi báo cáo lãi/lỗ về sau đều sai.
   *
   * Không có giá → ĐỂ TRỐNG, Odoo ghi 0 và người điền sau. Xem QUYẾT ĐỊNH GIÁ
   * NHẬP ở `taoDonMua`.
   */
  gia_nhap?: number;
}

export type KetQuaTaoDonMua =
  | {
      trangThai: 'da_tao'; donId: number; maDon: string; khoa: string;
      tongTien: number; soDong: number; soDongChuaCoGia: number;
    }
  | { trangThai: 'da_ton_tai'; donId: number; maDon: string; khoa: string }
  | { trangThai: 'loi'; lyDo: string };

export interface TaoDonMuaDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
  /** id hội thoại Zalo — thành phần của khoá chống trùng. */
  conversationId: string;
  /** Số thứ tự lần chốt trong hội thoại. Phiếu thứ 2 thì tăng lên. */
  seq: number;
}

/** Bỏ dấu + thường hoá để so tên không phân biệt dấu/hoa thường. */
function chuanTen(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Tên nhân viên nhắc có KHỚP tên NCC trong Odoo không?
 *
 * Cùng hàng rào với đơn bán (bug S13810 07/08: model bịa id khách từ danh sách
 * cũ trong lịch sử → đơn ra sai tên). Khớp khi MỌI từ đặc trưng nhân viên nhắc
 * đều xuất hiện trong tên partner.
 */
export function tenKhopNcc(tenNhac: string, tenPartner: string): boolean {
  const tuNhac = chuanTen(tenNhac).split(' ').filter((t) => t.length >= 2);
  if (tuNhac.length === 0) return true;
  const tenP = chuanTen(tenPartner);
  return tuNhac.every((t) => tenP.includes(t));
}

/**
 * Tạo phiếu nhập hàng NHÁP. An toàn khi gọi lại với cùng conversationId + seq.
 *
 * QUYẾT ĐỊNH GIÁ NHẬP — không có giá thì ĐỂ TRỐNG, không hỏi vặn.
 *
 * Đây là điểm khác biệt lớn nhất so với tool đơn BÁN, và tôi chọn ngược hẳn với
 * bên đó. Lý do bằng số đo, không phải cảm tính:
 *
 *   - Đơn BÁN chặn SP giá 0/1đ vì bán 0đ là MẤT TIỀN THẬT, và đơn ra là ghi
 *     nhận doanh thu sai.
 *   - Đơn MUA thì ngược: `price_unit` chỉ là giá dự kiến trên phiếu NHÁP, chưa
 *     vào sổ, chưa sinh công nợ. Sửa trên Odoo trước khi xác nhận là xong.
 *   - Nghiệp vụ THẬT vốn đã vậy: đơn P04520 trên prod (263.046.000đ, NCC Trung
 *     Quốc) có 3 dòng `price_unit=0` nằm cạnh 2 dòng 8.300đ. Người thật cũng
 *     tạo phiếu trước, điền giá sau.
 *   - Ca thật 22:11: nhân viên dán 13 dòng hàng, phần lớn KHÔNG kèm giá. Bắt
 *     hỏi đủ 13 giá trước khi cho tạo phiếu là dựng lại đúng bug demo 17:17
 *     10/08 (SP giá 1đ làm kẹt cứng cả phiên, 5 lệnh sau đều trả một câu lỗi).
 *
 * Bù lại KHÔNG được im lặng: kết quả trả về `soDongChuaCoGia` và câu báo cho
 * nhân viên nói rõ bao nhiêu dòng cần điền giá. Thiếu thông tin mà im là bẫy;
 * thiếu thông tin mà nói rõ thì người xử được.
 */
export async function taoDonMua(
  deps: TaoDonMuaDeps,
  input: { nha_cung_cap_id: number; dong: DongDonMua[]; ten_ncc?: string },
): Promise<KetQuaTaoDonMua> {
  const nccId = Number(input.nha_cung_cap_id);
  if (!Number.isInteger(nccId) || nccId <= 0) {
    return {
      trangThai: 'loi',
      lyDo: 'nha_cung_cap_id không hợp lệ. Dùng tra_nha_cung_cap để lấy id đúng.',
    };
  }

  // ── XÁC MINH NCC ───────────────────────────────────────────────────────
  // Đọc partner thật theo id: phải TỒN TẠI, phải LÀ NCC, và phải KHỚP TÊN
  // nhân viên nhắc. Ba lớp vì cả ba đều đã hỏng ở đâu đó rồi:
  //   - không tồn tại → bot bịa id (bug S13810)
  //   - không phải NCC → trên prod có "TRung Quốc" [KH001046] customer_rank=1
  //     nằm cạnh "Trung Quốc" [NCC000001] supplier_rank=5, tên gần y hệt
  //   - lệch tên → lấy id từ danh sách cũ trong lịch sử chat
  const partner = await deps.odoo.searchRead<Record<string, unknown>>(
    'res.partner', [['id', '=', nccId]], ['id', 'name', 'supplier_rank'], { limit: 1 },
  );
  if (partner.length === 0) {
    return {
      trangThai: 'loi',
      lyDo:
        `Không có nhà cung cấp id=${nccId}. Dùng tra_nha_cung_cap để lấy id đúng, ` +
        'ĐỪNG bịa id. KHÔNG được tự tạo nhà cung cấp mới.',
    };
  }
  const tenNcc = String(partner[0].name ?? '');
  if (Number(partner[0].supplier_rank ?? 0) <= 0) {
    return {
      trangThai: 'loi',
      lyDo:
        `"${tenNcc}" (id=${nccId}) không phải nhà cung cấp — đây là khách hàng. ` +
        'Đơn MUA phải treo vào nhà cung cấp. Dùng tra_nha_cung_cap để lấy đúng NCC.',
    };
  }
  const tenNhac = (input.ten_ncc ?? '').trim();
  if (tenNhac && !tenKhopNcc(tenNhac, tenNcc)) {
    return {
      trangThai: 'loi',
      lyDo:
        `Nhà cung cấp id=${nccId} trong hệ thống là "${tenNcc}", KHÔNG khớp tên ` +
        `"${tenNhac}" nhân viên nhắc. Có thể id lấy nhầm từ danh sách cũ. Hãy gọi ` +
        'tra_nha_cung_cap với tên đúng để lấy id chính xác.',
    };
  }

  const dong = Array.isArray(input.dong) ? input.dong : [];
  if (dong.length === 0) {
    return { trangThai: 'loi', lyDo: 'Phiếu nhập phải có ít nhất 1 dòng hàng.' };
  }

  for (const d of dong) {
    if (!Number.isInteger(Number(d?.san_pham_id)) || Number(d.san_pham_id) <= 0) {
      return {
        trangThai: 'loi',
        lyDo: `san_pham_id không hợp lệ: ${JSON.stringify(d?.san_pham_id)}. Dùng tra_san_pham để lấy id.`,
      };
    }
    const sl = Number(d?.so_luong);
    if (!Number.isFinite(sl) || sl <= 0) {
      return { trangThai: 'loi', lyDo: `Số lượng phải > 0, nhận được ${JSON.stringify(d?.so_luong)}.` };
    }
    // Giá nhập ÂM hoặc không phải số → chặn. Để trống thì được (xem QUYẾT ĐỊNH
    // GIÁ NHẬP), nhưng số RÁC thì không: ghi bừa vào giá vốn là sai sổ thật.
    if (d.gia_nhap !== undefined && d.gia_nhap !== null) {
      const g = Number(d.gia_nhap);
      if (!Number.isFinite(g) || g < 0) {
        return { trangThai: 'loi', lyDo: `Giá nhập không hợp lệ: ${JSON.stringify(d.gia_nhap)}. Bỏ trống nếu chưa có giá.` };
      }
    }
  }

  let khoa: string;
  try {
    khoa = sinhKhoaDon(deps.conversationId, deps.seq);
  } catch (err) {
    return { trangThai: 'loi', lyDo: err instanceof Error ? err.message : String(err) };
  }

  // ── CHỐT CHẶN TRÙNG ────────────────────────────────────────────────────
  // Chạy TRƯỚC create và trước cả kiểm SP: phiếu đã tồn tại thì không cần kiểm
  // gì nữa, tiết kiệm round-trip XML-RPC ở đúng ca retry.
  const daCo = await deps.odoo.searchRead<Record<string, unknown>>(
    'purchase.order', [[FIELD_KHOA, '=', khoa]], FIELDS_DON, { limit: 1 },
  );
  if (daCo.length > 0) {
    return {
      trangThai: 'da_ton_tai',
      donId: Number(daCo[0].id),
      maDon: String(daCo[0].name ?? ''),
      khoa,
    };
  }

  // ── KIỂM SP TỒN TẠI ────────────────────────────────────────────────────
  // CHỈ kiểm tồn tại, KHÔNG kiểm giá. Khác hẳn đơn bán: ở đây `list_price`
  // (giá bán) hoàn toàn không liên quan — SP mới toanh chưa đặt giá bán vẫn
  // nhập được bình thường, mua về rồi mới định giá bán.
  const spIds = dong.map((d) => Number(d.san_pham_id));
  const spInfo = await deps.odoo.searchRead<Record<string, unknown>>(
    'product.product', [['id', 'in', spIds]], ['id', 'name'],
  );
  const thieu = spIds.filter((id) => !spInfo.some((s) => Number(s.id) === id));
  if (thieu.length > 0) {
    return {
      trangThai: 'loi',
      lyDo: `Không tìm thấy sản phẩm id=${thieu.join(', ')}. Dùng tra_san_pham để lấy id đúng.`,
    };
  }

  // ── TẠO PHIẾU ──────────────────────────────────────────────────────────
  // Lệnh (0, 0, {...}) là cú pháp Odoo để tạo bản ghi con cùng bản ghi cha.
  //
  // `price_unit` CHỈ truyền khi nhân viên có báo giá nhập. Không báo thì KHÔNG
  // truyền gì — Odoo điền 0 (field required nhưng có default), người sửa sau.
  // TUYỆT ĐỐI không lấy `list_price` làm giá thay thế.
  const orderLine = dong.map((d) => {
    const gia = Number(d.gia_nhap);
    const coGia = Number.isFinite(gia) && gia > 0;
    return [
      0, 0,
      {
        product_id: Number(d.san_pham_id),
        product_qty: Number(d.so_luong),
        ...(coGia ? { price_unit: gia } : {}),
      },
    ];
  });
  const soDongChuaCoGia = dong.filter((d) => !(Number(d.gia_nhap) > 0)).length;

  let donId: number;
  try {
    donId = await deps.odoo.execute<number>('purchase.order', 'create', [
      {
        partner_id: nccId,
        // BẮT BUỘC truyền rõ — đây là chốt chặn trùng, để trống là mất nó.
        [FIELD_KHOA]: khoa,
        order_line: orderLine,
      },
    ]);
  } catch (err) {
    return {
      trangThai: 'loi',
      lyDo: `Odoo từ chối tạo phiếu nhập: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── XÁC NHẬN ───────────────────────────────────────────────────────────
  const vuaTao = await deps.odoo.searchRead<Record<string, unknown>>(
    'purchase.order', [['id', '=', donId]], FIELDS_DON, { limit: 1 },
  );
  if (vuaTao.length === 0) {
    return {
      trangThai: 'loi',
      lyDo: `Đã tạo phiếu nhập id=${donId} nhưng đọc lại không thấy. Cần kiểm tra thủ công.`,
    };
  }

  // Phiếu KHÔNG được ở trạng thái khác draft. Khác nghĩa là có automation tự
  // xác nhận — mà xác nhận đơn mua là sinh phiếu nhập kho + công nợ phải trả.
  // Phải báo động chứ không im lặng bỏ qua.
  const state = String(vuaTao[0].state ?? '');
  if (state !== 'draft') {
    return {
      trangThai: 'loi',
      lyDo: `Phiếu nhập id=${donId} có state='${state}' thay vì 'draft'. Có automation tự xác nhận — cần kiểm tra ngay.`,
    };
  }

  return {
    trangThai: 'da_tao',
    donId,
    maDon: String(vuaTao[0].name ?? ''),
    khoa,
    tongTien: Number(vuaTao[0].amount_total ?? 0),
    soDong: dong.length,
    soDongChuaCoGia,
  };
}

/* ------------------------------------------------------------------ */
/* TRA NHÀ CUNG CẤP                                                    */
/* ------------------------------------------------------------------ */

export interface NhaCungCap {
  id: number;
  ten: string;
  ma: string | null;
}

export type KetQuaTimNcc =
  | { trangThai: 'tim_thay'; ncc: NhaCungCap }
  | { trangThai: 'khong_thay'; tuKhoa: string }
  | {
      trangThai: 'nhieu_ket_qua';
      danhSach: NhaCungCap[];
      conNua?: boolean;
      /**
       * Ứng viên khớp GẦN NGUYÊN VĂN và áp đảo hẳn — caller được phép tự chốt.
       * Cùng luật với khách hàng, xem xepHangKhach(). Không ai áp đảo → vắng mặt.
       */
      tuChot?: NhaCungCap;
    };

/**
 * Tiền tố nhân viên hay gắn TRƯỚC tên nhà cung cấp — bỏ trước khi tra.
 *
 * Ca thật 23:16:15 ngày 11/08: nhân viên gõ nguyên văn "Nhà cung cấp Trung Quốc".
 * Tra cả cụm đó thì `ilike` ra 0 kết quả (đo prod), vì tên trong DB chỉ là
 * "Trung Quốc" — chữ "Nhà cung cấp" là NHÃN LOẠI, không phải một phần của tên.
 *
 * Đây là bản song song của XUNG_HO bên tra-khach-hang.ts ("anh/chị/em"): cùng ý
 * tưởng "bỏ chữ đưa đẩy ở đầu", nhưng khác tập chữ vì NCC là tổ chức chứ không
 * phải người. Cố nhét chung một hằng số là sai cả hai đầu — "anh" đứng đầu tên
 * NCC ("Anh Cường - Ao Sào", NCC000196 thật trên prod) là một phần của TÊN.
 */
const TIEN_TO_NCC = /^(nha\s+cung\s+cap|ncc|nha\s+cc|ben|cty|cong\s+ty|nha\s+may|shop|hang)\s+/;

/** Bỏ mọi tiền tố loại NCC ở đầu câu, lặp cho "ncc cty X". Giữ nguyên DẤU của phần tên. */
export function boTienToNcc(ten: string): string {
  let s = ten.trim();
  // So trên bản KHÔNG DẤU để bắt cả "nhà cung cấp" lẫn "nha cung cap", nhưng
  // CẮT trên chuỗi gốc để phần tên còn lại giữ nguyên dấu.
  for (;;) {
    const khongDau = s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd');
    const m = khongDau.match(TIEN_TO_NCC);
    if (!m) break;
    s = s.slice(m[0].length).trim();
  }
  // Cắt sạch thành rỗng ("nhà cung cấp" trơ trọi) → trả nguyên văn, để caller
  // xử nhánh không-tìm-thấy thay vì tra bằng chuỗi rỗng (lôi về cả bảng).
  return s || ten.trim();
}

/**
 * Chuỗi trông như MÃ NCC (ref). Đo prod 11/08: 186/200 NCC dùng dạng "NCC000001",
 * nhưng 2 NCC lại mang ref dạng "KH001046" và một số dùng tên tự do làm ref.
 * Nên nhận CẢ dạng chữ+số chung (giống laMaKh) chứ không khoá cứng tiền tố NCC.
 */
export function laMaNcc(s: string): boolean {
  return /^[A-Za-z]{2,4}\d{3,}[A-Za-z]*$/.test(s.trim());
}

/**
 * Tìm NCC theo tên hoặc mã. Chỉ ĐỌC, KHÔNG BAO GIỜ tạo res.partner.
 *
 * DÙNG LẠI ĐÚNG BỘ NÃO CỦA TRA KHÁCH HÀNG (yêu cầu anh Quốc 23:17 11/08: "bạn
 * dùng luôn tính năng tìm khách hàng áp dụng qua đi"): cùng `xepHangKhach` để
 * chấm điểm và quyết định tự chốt, không viết luật thứ hai lệch nhau.
 *
 * DẤU TIẾNG VIỆT — đo prod 11/08, cái bẫy thật:
 *   ilike 'trung quoc' → 0 kq  ·  ilike 'Trung Quốc' → 2 kq
 * Postgres ở đây KHÔNG bật `unaccent`. Cách vá: mauKhongDau() biến từ khoá
 * thành mẫu LIKE dùng `_` cho mọi chữ có thể mang dấu, nên tra được cả hai kiểu
 * gõ mà VẪN lọc ở tầng DB (không kéo bảng về). Xem tim-khong-dau.ts.
 *
 * Lọc `supplier_rank > 0` là bắt buộc: prod có "TRung Quốc" [KH001046] là KHÁCH
 * HÀNG nằm cạnh "Trung Quốc" [NCC000001] là NCC. Không lọc thì đơn mua treo vào
 * một khách hàng.
 */
export async function traNhaCungCap(
  deps: { odoo: Pick<OdooClient, 'searchRead'> },
  input: { ten?: string; ma?: string },
): Promise<KetQuaTimNcc> {
  const tenTho = (input.ten ?? '').trim();
  let ma = (input.ma ?? '').trim();
  // Nhân viên gõ thẳng mã vào ô tên ("NCC000001" — ca thật 23:16:53) → nhận ra
  // và chuyển sang tra theo `ref`, khoá chính xác, ra đúng một NCC.
  if (!ma && tenTho && laMaNcc(tenTho)) ma = tenTho;
  // Bỏ tiền tố "nhà cung cấp"/"cty"… trước khi tra tên (ca thật 23:16:15).
  const ten = ma ? '' : boTienToNcc(tenTho);
  if (!ten && !ma) return { trangThai: 'khong_thay', tuKhoa: '' };

  // Mã NCC (ref) là khoá chính xác → ưu tiên. Tên thì tra theo BIẾN THỂ DẤU
  // THẬT (sửa vòng 3, 12/08): mẫu `_` khớp quá rộng nên người/NCC đúng có thể
  // rớt ngoài trần Odoo trả về — xem tim-khong-dau.ts, ca "van" đo prod 12/08.
  const dieuKien: unknown[] = ma
    ? [['ref', '=ilike', ma]]
    : dieuKienBienTheDauCum('name', ten);

  const TRAN = 10;
  // Tra theo TÊN thì xin dư (gấp 5) để còn chỗ mà LỌC BỎ DẤU ngay dưới —
  // xem chú thích cùng chỗ trong tra-khach-hang.ts (ca 01:12 12/08).
  const soDong = ma ? TRAN + 1 : (TRAN + 1) * 5;
  let rows = await deps.odoo.searchRead<Record<string, unknown>>(
    'res.partner',
    ['&', ['supplier_rank', '>', 0], ...dieuKien],
    ['id', 'name', 'ref'],
    { limit: soDong },
  );

  // DỰ PHÒNG gõ CÓ DẤU mà DB lưu KHÔNG DẤU — y hệt bên khách hàng. Chỉ chạy
  // khi đã rỗng sạch, nên không nới bừa. Không có nhánh này thì luật tôn-trọng-
  // dấu lại dựng lại đúng bug 23:15 11/08 ("không tìm được nhà cung cấp").
  let tenLoc = ten;
  if (!ma && rows.length === 0 && coDauTiengViet(ten)) {
    tenLoc = boDau(ten);
    rows = await deps.odoo.searchRead<Record<string, unknown>>(
      'res.partner',
      ['&', ['supplier_rank', '>', 0], ...dieuKienBienTheDauCum('name', tenLoc)],
      ['id', 'name', 'ref'],
      { limit: soDong },
    );
  }

  // LỌC BỎ DẤU CHÍNH XÁC (sửa 12/08): mẫu `_` ở tầng DB khớp ký tự bất kỳ nên
  // "tr_ng q__c" ôm cả tên chỉ tình cờ cùng khung chữ. Cùng lỗi đã cho ra 10
  // "anh Vấn" sai bên khách hàng lúc 01:12 — NCC dùng chung mẫu nên chung bệnh.
  const rowsLoc = ma ? rows : locKhopBoDau(tenLoc, rows, (r) => String(r.name ?? ''));
  const conNua = rowsLoc.length > TRAN;
  const danhSach: NhaCungCap[] = rowsLoc.slice(0, TRAN).map((r) => ({
    id: Number(r.id),
    ten: String(r.name ?? ''),
    ma: r.ref ? String(r.ref) : null,
  }));

  if (danhSach.length === 0) return { trangThai: 'khong_thay', tuKhoa: ma || tenTho };
  if (danhSach.length === 1) return { trangThai: 'tim_thay', ncc: danhSach[0] };

  // XẾP HẠNG bằng CHÍNH hàm của tra khách hàng (yêu cầu 23:17 11/08).
  //
  // Cần thiết vì mẫu không dấu tra rộng hơn hẳn: "_" khớp ký tự bất kỳ nên
  // "tr_ng q__c" lôi về cả những tên chỉ tình cờ cùng khung chữ. DB lọc thô cho
  // rẻ, còn xepHangKhach chấm điểm tinh trên vài chục dòng đã về tới đây.
  //
  // `tuChot` chỉ nhả khi danh sách ĐỦ (không conNua) — y hệt luật bên khách:
  // chốt trên dữ liệu bị cắt là chốt liều, người đúng có thể nằm ngoài trang đầu.
  const xep = xepHangKhach(
    ten || ma,
    danhSach.map((n) => ({ id: n.id, ten: n.ten, ma: n.ma, dienThoai: null, congNo: 0 })),
  );
  const theoId = new Map(danhSach.map((n) => [n.id, n]));
  const dsXep = xep.danhSach.map((k) => theoId.get(k.id)!).filter(Boolean);
  const tuChot = xep.tuChot ? theoId.get(xep.tuChot.id) : undefined;

  return {
    trangThai: 'nhieu_ket_qua',
    danhSach: dsXep,
    ...(conNua ? { conNua } : {}),
    ...(tuChot && !conNua ? { tuChot } : {}),
  };
}

export const traNhaCungCapDefinition: ToolDefinition = {
  name: 'tra_nha_cung_cap',
  description:
    'Tìm NHÀ CUNG CẤP (bên bán hàng CHO shop) theo tên hoặc mã NCC. Trả về id để tạo phiếu nhập hàng. ' +
    'GỌI KHI: nhân viên nói "nhập hàng của <tên>", "đơn mua của <tên>", "order hàng Trung Quốc", ' +
    '"hàng cung cấp trung quốc". ' +
    'KHÁC tra_khach_hang: tool đó tìm KHÁCH MUA hàng của shop; tool này tìm bên BÁN hàng cho shop. ' +
    'GÕ NGUYÊN VĂN CÓ DẤU như nhân viên nói ("Trung Quốc", KHÔNG phải "trung quoc") — bỏ dấu là 0 kết quả. ' +
    'Tool này CHỈ TRA, KHÔNG tạo NCC mới. Không tìm thấy thì báo nhân viên, tuyệt đối không bịa id.',
  inputSchema: {
    type: 'object',
    properties: {
      ten: { type: 'string', description: 'Tên NCC, gõ nguyên văn CÓ DẤU. Vd "Trung Quốc", "Mogen Star"' },
      ma: { type: 'string', description: 'Mã NCC (ref), vd "NCC000001". Chính xác nhất — có thì ưu tiên.' },
    },
  },
};

/** Định dạng cho LLM. Hai nhánh không-dùng-được phải NÓI RÕ làm gì tiếp. */
export function dinhDangNhaCungCap(kq: KetQuaTimNcc): string {
  if (kq.trangThai === 'khong_thay') {
    return (
      `Không tìm thấy nhà cung cấp "${kq.tuKhoa}". ` +
      'Thử lại với tên ngắn hơn hoặc đúng DẤU tiếng Việt (vd "Trung Quốc" chứ không phải "trung quoc"). ' +
      'Vẫn không thấy → KHÔNG được tự tạo nhà cung cấp mới, hãy báo nhân viên để họ tạo trên Odoo.'
    );
  }
  if (kq.trangThai === 'nhieu_ket_qua') {
    const ds = kq.danhSach
      .map((n) => `- id=${n.id} | ${n.ten}${n.ma ? ` [${n.ma}]` : ''}`)
      .join('\n');
    const cat = kq.conNua
      ? '\nCHÚ Ý: danh sách BỊ CẮT — còn NCC khác chưa hiển thị. Tra lại với tên đầy đủ hơn.'
      : '';
    return (
      `Tìm thấy ${kq.danhSach.length} nhà cung cấp khớp:\n${ds}${cat}\n` +
      'KHÔNG tự chọn, KHÔNG tự nhặt id. Liệt kê cho nhân viên chọn rồi mới dùng id đó.'
    );
  }
  const n = kq.ncc;
  return `id=${n.id} | ${n.ten}${n.ma ? ` [${n.ma}]` : ''}`;
}

export const taoDonMuaDefinition: ToolDefinition = {
  name: 'tao_don_mua',
  description:
    'TẠO PHIẾU NHẬP HÀNG (đơn mua) NHÁP từ nhà cung cấp — hàng shop MUA VÀO, nhập kho. ' +
    'GỌI KHI nhân viên nói: "tạo phiếu nhập hàng", "nhập hàng từ nhà cung cấp", "làm đơn mua", ' +
    '"order hàng Trung Quốc", "đặt hàng nhà cung cấp", "nhập lô hàng về", "phiếu nhập kho". ' +
    'KHÁC tao_don_nhap: tool kia là đơn BÁN cho khách (hàng đi RA); tool này là đơn MUA từ NCC (hàng đi VÀO). ' +
    'CẦN: id nhà cung cấp (từ tra_nha_cung_cap) và id sản phẩm (từ tra_san_pham). KHÔNG bịa id. ' +
    'GIÁ NHẬP (gia_nhap): là giá NCC bán cho shop, KHÁC HẲN giá bán của sản phẩm. ' +
    'Nhân viên chưa báo giá thì BỎ TRỐNG — phiếu nháp, người điền sau. ' +
    'TUYỆT ĐỐI KHÔNG lấy giá bán trong hệ thống làm giá nhập. ' +
    'Phiếu tạo ra ở trạng thái NHÁP, người xem lại rồi tự xác nhận trên Odoo. ' +
    'Gọi lại nhiều lần với cùng nội dung là an toàn, không tạo phiếu trùng.',
  inputSchema: {
    type: 'object',
    properties: {
      nha_cung_cap_id: { type: 'integer', description: 'id nhà cung cấp, lấy từ tra_nha_cung_cap' },
      ten_ncc: {
        type: 'string',
        description: 'Tên NCC nhân viên vừa nhắc (vd "Trung Quốc"). LUÔN truyền để đối chiếu chống nhầm.',
      },
      dong: {
        type: 'array',
        description: 'Danh sách dòng hàng cần nhập',
        items: {
          type: 'object',
          properties: {
            san_pham_id: { type: 'integer', description: 'id sản phẩm, lấy từ tra_san_pham' },
            so_luong: { type: 'number', description: 'Số lượng nhập, phải > 0' },
            gia_nhap: {
              type: 'number',
              description:
                'Giá NHẬP từ NCC (đồng), chỉ điền khi nhân viên có báo. ' +
                'Chưa có giá thì BỎ TRỐNG — đừng lấy giá bán thay thế.',
            },
          },
          required: ['san_pham_id', 'so_luong'],
        },
      },
    },
    required: ['nha_cung_cap_id', 'dong'],
  },
  mutates: true,
};

/**
 * Định dạng cho LLM. Nói rõ phiếu là NHÁP để model không hứa "đã nhập kho".
 *
 * `soDongChuaCoGia` PHẢI xuất hiện trong câu: để trống giá là quyết định có chủ
 * ý (xem QUYẾT ĐỊNH GIÁ NHẬP), nhưng im lặng về nó thì thành bẫy — nhân viên
 * tưởng phiếu đủ, kế toán nhận phiếu 0đ mà không ai biết cần điền.
 */
export function dinhDangTaoDonMua(kq: KetQuaTaoDonMua): string {
  if (kq.trangThai === 'loi') return `Không tạo được phiếu nhập: ${kq.lyDo}`;
  if (kq.trangThai === 'da_ton_tai') {
    return `Phiếu nhập này đã được tạo trước đó rồi: ${kq.maDon} (id=${kq.donId}). KHÔNG tạo lại.`;
  }
  const dau =
    `Đã tạo phiếu nhập hàng NHÁP ${kq.maDon} (id=${kq.donId}), ${kq.soDong} dòng hàng` +
    (kq.tongTien > 0 ? `, tạm tính ${kq.tongTien.toLocaleString('vi-VN')}đ. ` : '. ');
  const thieuGia = kq.soDongChuaCoGia > 0
    ? `${kq.soDongChuaCoGia}/${kq.soDong} dòng CHƯA CÓ GIÁ NHẬP — báo nhân viên vào Odoo điền giá trước khi xác nhận. `
    : '';
  return (
    dau + thieuGia +
    'Báo nhân viên: phiếu ở trạng thái nháp, chưa nhập kho và chưa ghi công nợ. ' +
    'Anh/chị vào link kiểm tra rồi bấm Xác nhận trên Odoo. KHÔNG nói là đã nhập kho xong.'
  );
}
