// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool GHI: tạo đơn hàng NHÁP (sale.order state=draft) trong Odoo.
//
// Đây là tool duy nhất được phép ghi. Ba ràng buộc tuyệt đối:
//
//  1. CHỈ TẠO DRAFT. Không gọi action_confirm(), không _auto_validate_picking(),
//     không _create_invoices(). Ba cái đó động vào kho thật và sổ kế toán thật.
//     Ngay cả ở local cũng không gọi — vì action_confirm() sinh phiếu xuất kho,
//     làm lệch số tồn, khiến chính test tồn kho cho kết quả rác.
//
//  2. IDEMPOTENCY BẮT BUỘC. Vòng lặp có retry; retry không khoá = 2 đơn 1 khách.
//     Tra client_order_ref trước khi tạo, có rồi thì trả đơn cũ.
//
//  3. KHÔNG TẠO KHÁCH. partner_id phải do tra_khach_hang cung cấp. Không tìm
//     thấy khách thì chuyển sale, không tự tạo (phone không unique → rác vĩnh viễn).

import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import { sinhKhoaDon, IDEMPOTENCY_PREFIX } from '../idempotency.js';
import { NGUONG_GIA_AO } from './tra-san-pham.js';

export interface DongDon {
  san_pham_id: number;
  so_luong: number;
  /**
   * Đơn giá NHÂN VIÊN BÁO (đồng). Chỉ có tác dụng khi deps.choPhepDatGia.
   *
   * Anh Quốc chốt 10/08: NV báo 170k thì đơn ghi 170k dù Odoo để 132k — họ đã
   * chốt với khách, giá Odoo có thể cũ. Đây CŨNG là đường để SP chưa nhập giá
   * vẫn lên đơn được (bug demo 17:17: kẹt cứng vì SP giá 1đ).
   */
  don_gia?: number;
  /**
   * Chiết khấu % (0-100) nhân viên báo. Cùng cổng `choPhepDatGia` với đơn giá:
   * luồng KHÁCH tuyệt đối không được đặt — khách điều khiển câu chữ thì điều
   * khiển được chiết khấu ("giảm cho tôi 99%").
   *
   * Ca thật 03:23 11/08: nhân viên nói "giá 230k triết khấu 8%" ngay từ đầu mà
   * đơn vẫn ra 23.000.000đ, phải nhắc thêm một lượt mới thành 21.160.000đ.
   */
  chiet_khau?: number;
  /**
   * Dòng HÀNG TẶNG: ghi giá 0đ VÀ gắn "(tặng)" vào tên dòng. Cùng cổng
   * `choPhepDatGia` với giá — khách điều khiển câu chữ thì "tặng tôi 10 cái" là
   * mất hàng thật.
   *
   * Vì sao phải đánh dấu vào TÊN chứ không chỉ để giá 0 (đo prod 11/08): 34/597
   * dòng đang có giá 0đ, nhưng trong đó có 428 con ốc và 107 sợi cáp — phụ kiện
   * đi kèm, không phải quà tặng. Không dòng nào ghi chữ "tặng" nên báo cáo
   * không tách nổi hai loại. Từ nay quà tặng thật luôn có dấu.
   */
  tang?: boolean;
}

export type KetQuaTaoDon =
  | { trangThai: 'da_tao'; donId: number; maDon: string; khoa: string; tongTien: number }
  | { trangThai: 'da_ton_tai'; donId: number; maDon: string; khoa: string }
  | { trangThai: 'loi'; lyDo: string };

export interface TaoDonDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
  /**
   * Cho phép đặt `don_gia` per dòng. CHỈ luồng NHÂN VIÊN.
   *
   * Luồng KHÁCH tuyệt đối không: khách điều khiển câu chữ nên sẽ điều khiển
   * được giá ("bán tôi 1đ"). Mặc định false = hành vi cũ (Odoo tự lấy giá).
   */
  choPhepDatGia?: boolean;
  /** id hội thoại Zalo — thành phần của khoá chống trùng. */
  conversationId: string;
  /** Số thứ tự lần chốt trong hội thoại. Chốt đơn thứ 2 thì tăng lên. */
  seq: number;
  /**
   * Trần tiền cho MỘT đơn. Vượt → không tạo, chuyển sale.
   *
   * Chỉ đặt cho LUỒNG KHÁCH: khách điều khiển được nội dung câu chữ, nên cũng
   * điều khiển được số lượng bot điền. Đo thật 2026-08-04: khách gõ "lấy tôi
   * 1000 cuộn" và bot tính ra 500.000.000đ — không ai duyệt.
   *
   * Nhân viên KHÔNG có trần: họ chịu trách nhiệm cho đơn mình lên.
   */
  tranTien?: number;
  /**
   * Chặn tạo đơn thứ hai quá gần đơn trước trong CÙNG hội thoại (giây).
   *
   * Bug thật 2026-08-05 20:57: nhân viên lên đơn S13797 (1 cái, 78.000đ) rồi
   * nhắn "10 cái mà" để SỬA số lượng. Bot hiểu thành lệnh mới, tạo hẳn đơn
   * S13798 cho khách KHÁC (780.000đ). Khoá chống trùng không cứu được: hai
   * tin khác nhau → hai `seq` khác nhau → hai khoá khác nhau.
   *
   * Người ta không lên hai đơn thật cách nhau 20 giây trong một hội thoại;
   * nhưng người ta RẤT hay sửa đơn vừa lên. Nghi ngờ thì hỏi lại — tạo nhầm
   * đơn tốn công dò và xoá, hỏi lại chỉ tốn một câu.
   *
   * 0 hoặc không đặt → tắt hàng rào (giữ nguyên hành vi cũ cho test).
   */
  chanDonLienKeGiay?: number;
}

/** Field đọc lại sau khi tạo, để xác nhận đơn đúng như mong đợi. */
const FIELDS_DON = ['id', 'name', 'state', 'amount_total', 'client_order_ref'];

/**
 * Tạo đơn nháp. An toàn khi gọi lại nhiều lần với cùng conversationId + seq.
 *
 * Luồng:
 *   1. Sinh khoá từ (conversationId, seq)
 *   2. Tra Odoo xem khoá đã dùng chưa → có thì trả đơn cũ, KHÔNG tạo mới
 *   3. Kiểm tra dòng hàng hợp lệ
 *   4. create() với state mặc định = draft
 *   5. Đọc lại để xác nhận, và KIỂM TRA state đúng là draft
 */
/** Bỏ dấu + thường hoá để so tên không phân biệt dấu/hoa thường. */
function chuanTen(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Tên nhân viên nhắc có KHỚP tên khách trong Odoo không?
 *
 * Khách trong DB có tên dài ("Anh Vấn - Hà Đông [KH...]"), nhân viên chỉ gõ
 * "Vấn". Khớp khi MỌI từ đặc trưng nhân viên nhắc (bỏ "anh/chị/a/c") đều xuất
 * hiện trong tên partner. Đủ để bắt lệch rõ ràng (Vấn vs Huy Chung) mà không
 * chặn oan cách gõ tắt.
 */
export function tenKhopKhach(tenNhac: string, tenPartner: string): boolean {
  const XUNG = new Set(['anh', 'chi', 'a', 'c', 'em', 'ông', 'ong', 'ba', 'co', 'cô', 'chú', 'chu']);
  const tuNhac = chuanTen(tenNhac).split(' ').filter((t) => t.length >= 2 && !XUNG.has(t));
  if (tuNhac.length === 0) return true; // chỉ có xưng hô → không đủ cơ sở bác, cho qua
  const tenP = chuanTen(tenPartner);
  return tuNhac.every((t) => tenP.includes(t));
}

export async function taoDonNhap(
  deps: TaoDonDeps,
  input: {
    khach_hang_id: number; dong: DongDon[]; y_dinh?: 'moi' | 'sua'; ten_khach?: string;
    /**
     * Kho xuất hàng (sale.order.warehouse_id). Cùng cổng `choPhepDatGia`: khách
     * không có việc gì phải quyết kho của công ty.
     *
     * KHÔNG truyền = giữ nguyên hành vi cũ, Odoo tự lấy kho mặc định. Đo prod
     * 11/08: 291/300 đơn gần nhất dùng kho TT, nên mặc định vốn đã đúng cho
     * gần như mọi đơn — chỉ đặt khi nhân viên nói rõ.
     */
    kho_id?: number;
  },
): Promise<KetQuaTaoDon> {
  const partnerId = Number(input.khach_hang_id);
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    return { trangThai: 'loi', lyDo: 'khach_hang_id không hợp lệ. Dùng tra_khach_hang để lấy id đúng.' };
  }

  // ── XÁC MINH KHÁCH KHỚP TÊN ────────────────────────────────────────────
  // Bug thật 07/08 (S13810): nhân viên "lên đơn anh Vấn" nhưng model KHÔNG tra
  // khách, bịa id=1629 (Huy Chung) từ danh sách cũ trong lịch sử → đơn ra sai
  // tên. Đọc partner thật theo id và so với tên nhân viên nhắc: lệch → chặn,
  // bắt tra lại. Chặn ở CODE vì đây là dữ liệu bẩn (đơn sai khách) khó dò.
  const partner = await deps.odoo.searchRead<Record<string, unknown>>(
    'res.partner', [['id', '=', partnerId]], ['id', 'name'], { limit: 1 },
  );
  if (partner.length === 0) {
    return { trangThai: 'loi', lyDo: `Không có khách id=${partnerId}. Dùng tra_khach_hang để lấy id đúng, ĐỪNG bịa id.` };
  }
  const tenPartner = String(partner[0].name ?? '');
  const tenNhac = (input.ten_khach ?? '').trim();
  if (tenNhac && !tenKhopKhach(tenNhac, tenPartner)) {
    return {
      trangThai: 'loi',
      lyDo:
        `Khách id=${partnerId} trong hệ thống là "${tenPartner}", KHÔNG khớp tên "${tenNhac}" ` +
        'nhân viên nhắc. Có thể id lấy nhầm từ danh sách cũ. Hãy gọi tra_khach_hang với tên/mã KH ' +
        'đúng để lấy id chính xác, ĐỪNG tự lấy id từ lịch sử.',
    };
  }

  const dong = Array.isArray(input.dong) ? input.dong : [];
  if (dong.length === 0) {
    return { trangThai: 'loi', lyDo: 'Đơn phải có ít nhất 1 dòng hàng.' };
  }

  for (const d of dong) {
    if (!Number.isInteger(Number(d?.san_pham_id)) || Number(d.san_pham_id) <= 0) {
      return { trangThai: 'loi', lyDo: `san_pham_id không hợp lệ: ${JSON.stringify(d?.san_pham_id)}. Dùng tra_san_pham để lấy id.` };
    }
    const sl = Number(d?.so_luong);
    if (!Number.isFinite(sl) || sl <= 0) {
      return { trangThai: 'loi', lyDo: `Số lượng phải > 0, nhận được ${JSON.stringify(d?.so_luong)}.` };
    }
  }

  let khoa: string;
  try {
    khoa = sinhKhoaDon(deps.conversationId, deps.seq);
  } catch (err) {
    return { trangThai: 'loi', lyDo: err instanceof Error ? err.message : String(err) };
  }

  // ── CHỐT CHẶN TRÙNG ĐƠN ────────────────────────────────────────────────
  // Phải chạy TRƯỚC create, và trước cả kiểm giá: đơn đã tồn tại thì không cần
  // kiểm gì nữa, tiết kiệm một round-trip XML-RPC ở đúng ca retry (ca hay xảy ra).
  const daCo = await deps.odoo.searchRead<Record<string, unknown>>(
    'sale.order',
    [['client_order_ref', '=', khoa]],
    FIELDS_DON,
    { limit: 1 },
  );
  if (daCo.length > 0) {
    return {
      trangThai: 'da_ton_tai',
      donId: Number(daCo[0].id),
      maDon: String(daCo[0].name ?? ''),
      khoa,
    };
  }

  // ── CHẶN ĐƠN LIỀN KỀ (nhân viên đang SỬA đơn, không phải lên đơn mới) ──
  //
  // Bug thật 05/08/2026: lên đơn S13797 (1 cái) xong, nhân viên nhắn "10 cái
  // mà" để sửa. Bot tạo hẳn đơn S13798 cho khách khác. Khoá chống trùng không
  // cứu được vì hai tin → hai seq → hai khoá.
  //
  // Chặn ở TOOL chứ không ở prompt: prompt lèo lái được, mà hậu quả ở đây là
  // dữ liệu bẩn trong Odoo — thứ phải dò và xoá bằng tay.
  //
  // NHƯNG (anh chốt 07/08): "lên/tạo đơn" = LUÔN đơn mới, chỉ "sửa/thêm/bớt"
  // mới là sửa. Nên chỉ chặn khi model xác định y_dinh='sua'. y_dinh='moi'
  // (mặc định) → bỏ qua chặn, tạo đơn mới thẳng — nhân viên chủ động lên đơn
  // tiếp cho cùng khách là việc hợp lệ, không phải sửa nhầm.
  const nguongGiay = input.y_dinh === 'sua' ? Number(deps.chanDonLienKeGiay ?? 0) : 0;
  if (nguongGiay > 0) {
    const moc = new Date(Date.now() - nguongGiay * 1000)
      .toISOString().slice(0, 19).replace('T', ' '); // Odoo dùng UTC 'YYYY-MM-DD HH:MM:SS'
    // Mọi đơn của hội thoại này, bất kể seq: `zalo:<conversationId>:*`
    const tienToHoiThoai = `${IDEMPOTENCY_PREFIX}:${String(deps.conversationId).trim()}:`;
    const gan = await deps.odoo.searchRead<Record<string, unknown>>(
      'sale.order',
      [
        ['client_order_ref', 'like', `${tienToHoiThoai}%`],
        ['create_date', '>=', moc],
        // CÙNG KHÁCH mới chặn. Đo thật 05/08 khi kiểm hàng rào: nhân viên lên
        // đơn cho khách MỚI ngay sau một đơn khác cũng bị chặn — sai, đó là
        // việc thật hợp lệ. Sửa đơn thì bao giờ cũng cùng khách; lên đơn cho
        // người khác thì partner_id khác.
        ['partner_id', '=', partnerId],
      ],
      ['id', 'name', 'amount_total', 'create_date'],
      { limit: 1, order: 'create_date desc' },
    );
    if (gan.length > 0) {
      return {
        trangThai: 'loi',
        lyDo:
          `Vừa tạo đơn ${gan[0].name} (${Number(gan[0].amount_total ?? 0).toLocaleString('vi-VN')}đ) ` +
          `trong hội thoại này cách đây chưa tới ${nguongGiay} giây. ` +
          'Nếu nhân viên đang SỬA đơn đó (đổi số lượng, đổi hàng) thì KHÔNG tạo đơn mới — ' +
          `hãy trả lời rằng đơn ${gan[0].name} cần sửa tay trên Odoo. ` +
          'Chỉ khi nhân viên nói rõ đây là đơn KHÁC thì mới tạo, và phải hỏi lại trước.',
      };
    }
  }

  // ── CHẶN SP CHƯA CÓ GIÁ / KHÔNG TỒN TẠI ────────────────────────────────
  // Đơn có SP giá 0 là đơn sai: tổng tiền sai, và sale phải sửa tay. Chặn ở đây
  // rẻ hơn nhiều so với để đơn rác vào hệ thống rồi đi dọn.
  const spIds = dong.map((d) => Number(d.san_pham_id));
  const spInfo = await deps.odoo.searchRead<Record<string, unknown>>(
    'product.product',
    [['id', 'in', spIds]],
    ['id', 'name', 'list_price', 'active'],
  );

  const thieu = spIds.filter((id) => !spInfo.some((s) => Number(s.id) === id));
  if (thieu.length > 0) {
    return { trangThai: 'loi', lyDo: `Không tìm thấy sản phẩm id=${thieu.join(', ')}. Dùng tra_san_pham để lấy id đúng.` };
  }

  // Chặn cả giá 0 LẪN giá ảo (placeholder 1đ). DB có 63 SP để đúng 1đ — tạo đơn
  // với giá đó là ghi nhận doanh thu sai, sale phải sửa tay.
  //
  // NGOẠI LỆ (10/08): dòng có `don_gia` do NHÂN VIÊN báo thì không chặn — giá
  // đã có nguồn gốc là người, không phải bot bịa. Bug demo 17:17: SP giá 1đ
  // làm kẹt cả phiên dù NV đã báo 13k/thanh.
  //
  // NGOẠI LỆ 2 (11/08): dòng TẶNG cũng không chặn — hàng tặng vốn 0đ, đòi nó có
  // giá hợp lệ là mâu thuẫn. Chỉ SP nào CHỈ xuất hiện ở dòng tặng mới được
  // miễn: SP vừa bán vừa tặng thì dòng bán vẫn phải có giá thật.
  const coGiaNvBao = new Set(
    deps.choPhepDatGia
      ? dong.filter((d) => Number(d.don_gia) > 0).map((d) => Number(d.san_pham_id))
      : [],
  );
  const chiLaTang = new Set(
    deps.choPhepDatGia
      ? spIds.filter((id) => dong.filter((d) => Number(d.san_pham_id) === id).every((d) => d.tang === true))
      : [],
  );
  const khongGia = spInfo.filter(
    (s) => Number(s.list_price ?? 0) <= NGUONG_GIA_AO
      && !coGiaNvBao.has(Number(s.id)) && !chiLaTang.has(Number(s.id)),
  );
  if (khongGia.length > 0) {
    const ten = khongGia
      .map((s) => `${s.name} (id=${s.id}, giá ${Number(s.list_price ?? 0)}đ)`)
      .join(', ');
    return {
      trangThai: 'loi',
      lyDo:
        `Sản phẩm chưa có giá hợp lệ: ${ten}. ` +
        'KHÔNG tạo đơn với giá 0đ hay giá tạm. Dùng chuyen_sale để sale báo giá và lên đơn thủ công.',
    };
  }

  // ── TRẦN TIỀN (chỉ luồng khách) ────────────────────────────────────────
  // Tính TRƯỚC khi tạo: `amount_total` chỉ có sau khi Odoo ghi xong, lúc đó
  // chặn là muộn — đơn đã nằm trong hệ thống rồi.
  //
  // Odoo tự tính giá cuối (thuế, pricelist) nên con số này là ƯỚC LƯỢNG. Đủ để
  // chặn đơn lớn bất thường, không dùng để báo cho khách.
  if (deps.tranTien && deps.tranTien > 0) {
    const giaTheoId = new Map(spInfo.map((s) => [Number(s.id), Number(s.list_price ?? 0)]));
    const uocTong = dong.reduce(
      (t, d) => t + (giaTheoId.get(Number(d.san_pham_id)) ?? 0) * Number(d.so_luong ?? 0),
      0,
    );
    if (uocTong > deps.tranTien) {
      return {
        trangThai: 'loi',
        lyDo:
          `Đơn ước tính ${Math.round(uocTong).toLocaleString('vi-VN')}đ, vượt trần ` +
          `${deps.tranTien.toLocaleString('vi-VN')}đ cho đơn tự động. ` +
          'Dùng chuyen_sale để nhân viên xác nhận và lên đơn.',
      };
    }
  }

  // ── TẠO ĐƠN ────────────────────────────────────────────────────────────
  // Lệnh (0, 0, {...}) là cú pháp Odoo để tạo bản ghi con cùng bản ghi cha.
  //
  // price_unit CHỈ truyền khi caller cho phép VÀ nhân viên có báo giá. Mặc
  // định vẫn để Odoo tự lấy pricelist — bot tự nghĩ ra giá là cách bịa số tinh
  // vi nhất, luật đó không đổi. Cái đổi (10/08) là: giá do NGƯỜI báo thì được
  // ghi, vì nó có nguồn gốc kiểm chứng được trong chat.
  const tenTheoId = new Map(spInfo.map((s) => [Number(s.id), String(s.name ?? '')]));
  const orderLine = dong.map((d) => {
    // Dòng TẶNG đi cùng cổng với giá (11/08) — luồng khách không được tự cho
    // mình hàng 0đ. Ghi CẢ giá 0 LẪN dấu "(tặng)" trong tên: chỉ giá 0 thì
    // không tách được với phụ kiện đi kèm (428 ốc, 107 cáp đang 0đ trên prod).
    const tang = deps.choPhepDatGia === true && d.tang === true;
    const giaNv = deps.choPhepDatGia ? Number(d.don_gia) : 0;
    // Chiết khấu đi cùng cổng với giá, và chỉ nhận 0-100: ghi bừa là sai tiền
    // thật của khách.
    const ckTho = deps.choPhepDatGia ? Number(d.chiet_khau) : 0;
    const ck = Number.isFinite(ckTho) && ckTho > 0 && ckTho <= 100 ? ckTho : 0;
    if (tang) {
      return [0, 0, {
        product_id: Number(d.san_pham_id),
        product_uom_qty: Number(d.so_luong),
        name: `${tenTheoId.get(Number(d.san_pham_id)) ?? ''} (tặng)`.trim(),
        price_unit: 0,
      }];
    }
    return [
      0,
      0,
      {
        product_id: Number(d.san_pham_id),
        product_uom_qty: Number(d.so_luong),
        ...(giaNv > 0 ? { price_unit: giaNv } : {}),
        ...(ck > 0 ? { discount: ck } : {}),
      },
    ];
  });

  // Kho: chỉ ghi khi caller được phép VÀ đưa id nguyên dương. id rác (0, âm,
  // NaN) → bỏ qua để Odoo dùng mặc định, KHÔNG ghi bừa một kho sai.
  const khoTho = deps.choPhepDatGia ? Number(input.kho_id) : Number.NaN;
  const khoId = Number.isInteger(khoTho) && khoTho > 0 ? khoTho : 0;

  let donId: number;
  try {
    donId = await deps.odoo.execute<number>('sale.order', 'create', [
      {
        partner_id: partnerId,
        // BẮT BUỘC truyền rõ: sale_order.py:115 tự điền field này từ sequence
        // nếu để trống → mất chốt chặn mà không có cảnh báo nào.
        client_order_ref: khoa,
        ...(khoId > 0 ? { warehouse_id: khoId } : {}),
        order_line: orderLine,
      },
    ]);
  } catch (err) {
    return { trangThai: 'loi', lyDo: `Odoo từ chối tạo đơn: ${err instanceof Error ? err.message : String(err)}` };
  }

  // ── XÁC NHẬN ───────────────────────────────────────────────────────────
  const vuaTao = await deps.odoo.searchRead<Record<string, unknown>>(
    'sale.order',
    [['id', '=', donId]],
    FIELDS_DON,
    { limit: 1 },
  );
  if (vuaTao.length === 0) {
    return { trangThai: 'loi', lyDo: `Đã tạo đơn id=${donId} nhưng đọc lại không thấy. Cần kiểm tra thủ công.` };
  }

  // Đơn KHÔNG được ở trạng thái khác draft. Nếu khác, nghĩa là có automation
  // nào đó tự xác nhận — phải báo động chứ không im lặng bỏ qua.
  const state = String(vuaTao[0].state ?? '');
  if (state !== 'draft') {
    return {
      trangThai: 'loi',
      lyDo: `Đơn id=${donId} có state='${state}' thay vì 'draft'. Có automation tự xác nhận — cần kiểm tra ngay.`,
    };
  }

  return {
    trangThai: 'da_tao',
    donId,
    maDon: String(vuaTao[0].name ?? ''),
    khoa,
    tongTien: Number(vuaTao[0].amount_total ?? 0),
  };
}

export const taoDonNhapDefinition: ToolDefinition = {
  name: 'tao_don_nhap',
  description:
    'Tạo đơn hàng NHÁP trong hệ thống. Đơn ở trạng thái nháp, sale sẽ xác nhận sau. ' +
    'GỌI KHI: khách đã chốt mua và bạn đã có đủ id khách (từ tra_khach_hang) và id sản phẩm ' +
    '(từ tra_san_pham). KHÔNG tự bịa id, KHÔNG lấy id khách từ danh sách/lịch sử cũ — ' +
    'khách MỚI phải gọi tra_khach_hang trước. KHÔNG đặt giá — hệ thống tự lấy giá đúng. ' +
    'Gọi lại nhiều lần với cùng nội dung là an toàn, sẽ không tạo đơn trùng. ' +
    'ten_khach: LUÔN truyền tên khách nhân viên vừa nhắc (vd "Vấn") — hệ thống đối chiếu với ' +
    'khách theo id, lệch thì chặn để khỏi lên đơn nhầm người. ' +
    'y_dinh: nhân viên nói "lên đơn"/"tạo đơn"/"đơn mới" → "moi"; nói "sửa"/"thêm"/"bớt"/' +
    '"đổi" cho đơn vừa tạo → "sua". Mặc định "moi".',
  inputSchema: {
    type: 'object',
    properties: {
      khach_hang_id: { type: 'integer', description: 'id khách, lấy từ tra_khach_hang' },
      ten_khach: { type: 'string', description: 'Tên khách nhân viên vừa nhắc (vd "Vấn"). LUÔN truyền để đối chiếu.' },
      y_dinh: {
        type: 'string',
        enum: ['moi', 'sua'],
        description: '"moi" = lên đơn mới (mặc định). "sua" = sửa đơn vừa tạo (đổi SL/hàng).',
      },
      dong: {
        type: 'array',
        description: 'Danh sách dòng hàng cần đặt',
        // Khai items rõ ràng: không có nó, model phải đoán cấu trúc từ description
        // và hay gửi sai (chuỗi thay vì số, tên field khác...).
        items: {
          type: 'object',
          properties: {
            san_pham_id: { type: 'integer', description: 'id sản phẩm, lấy từ tra_san_pham' },
            so_luong: { type: 'number', description: 'Số lượng, phải > 0' },
          },
          required: ['san_pham_id', 'so_luong'],
        },
      },
    },
    required: ['khach_hang_id', 'dong'],
  },
  mutates: true,
};

/** Định dạng cho LLM. Nói rõ đơn là NHÁP để model không hứa "đã xong" với khách. */
/**
 * @param choNhanVien câu chữ cho LUỒNG NHÂN VIÊN. Mặc định là luồng khách.
 *
 *   Bug thật 06/08/2026: câu "chờ sale xác nhận — nói với khách là sale sẽ
 *   liên hệ" viết cho luồng KHÁCH, bị model nhại nguyên văn khi nói với chính
 *   nhân viên sale — "Đơn đang chờ anh sale xác nhận ạ" nghe ngớ ngẩn vì
 *   người nghe CHÍNH LÀ sale.
 */
export function dinhDangTaoDon(kq: KetQuaTaoDon, choNhanVien = false): string {
  if (kq.trangThai === 'loi') return `Không tạo được đơn: ${kq.lyDo}`;
  if (kq.trangThai === 'da_ton_tai') {
    return `Đơn này đã được tạo trước đó rồi: ${kq.maDon} (id=${kq.donId}). KHÔNG tạo lại.`;
  }
  const dau = `Đã tạo đơn NHÁP ${kq.maDon} (id=${kq.donId}), tổng ${kq.tongTien.toLocaleString('vi-VN')}đ. `;
  if (choNhanVien) {
    return (
      dau +
      'Ảnh hoá đơn + link xử lý được gửi kèm tự động. Báo nhân viên: đơn ở trạng thái nháp, ' +
      'anh/chị vào link để xác nhận. KHÔNG nói là đã xong hay đã giao.'
    );
  }
  return (
    dau +
    'Đơn đang chờ sale xác nhận — hãy nói với khách là đơn đã được ghi nhận và sale sẽ liên hệ xác nhận, ' +
    'KHÔNG nói là đã xong hay đã giao.'
  );
}
