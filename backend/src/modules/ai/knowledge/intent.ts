// SPDX-License-Identifier: AGPL-3.0-or-later
// Intent router (deterministic, hàm thuần). Phân loại tin khách TRƯỚC khi gọi LLM,
// để (1) chặn cứng câu nội bộ ở code (không tốn token, không rủi ro model bịa),
// (2) inject "hint" ép LLM trả lời đúng kiểu cho từng intent. Lý do: model nhỏ dễ
// trượt prompt dài — đẩy quyết định quan trọng ra code (như budget gate của scraper).

export type Intent =
  | 'internal'      // hỏi nội bộ (doanh thu, giá vốn, nhà cung cấp...) → chặn cứng
  | 'complaint'     // khiếu nại, sản phẩm lỗi → handoff sale ngay (rủi ro cao)
  | 'large_order'   // đơn rất lớn → handoff sale
  | 'order'         // ý định chốt số lượng cụ thể
  | 'discount'      // hỏi giảm giá/chiết khấu
  | 'warranty'      // hỏi bảo hành/đổi trả
  | 'shipping'      // hỏi giao hàng/ship
  | 'shop_info'     // hỏi địa chỉ/SĐT/giờ mở cửa
  | 'price'         // hỏi giá
  | 'stock'         // hỏi còn hàng/tồn
  | 'compare'       // so sánh 2 sản phẩm
  | 'general'       // bán chạy/phổ biến/có dòng nào
  | 'normal';       // còn lại (tư vấn thường / mơ hồ)

const INTERNAL_KW = [
  'giá vốn', 'giá nhập', 'giá gốc', 'giá sỉ nội bộ', 'lãi bao nhiêu', 'lời bao nhiêu',
  'biên lợi nhuận', 'lợi nhuận', 'doanh thu', 'doanh số', 'nhà cung cấp', 'nguồn hàng',
  'nhập ở đâu', 'nhập hàng ở', 'tồn kho tổng', 'số liệu bán', 'dữ liệu khách', 'kpi',
  'chính sách nội bộ', 'bao nhiêu nhân viên', 'lương',
];
// Khiếu nại RÕ RÀNG: cụm từ chỉ sản phẩm ĐÃ lỗi/đã có vấn đề (không mơ hồ).
// LƯU Ý: KHÔNG để 'lỗi rồi' trần (dính "xin lỗi rồi" = lời xin lỗi, không phải khiếu nại).
const COMPLAINT_KW = [
  'cháy rồi', 'bị cháy', 'bị hỏng', 'hỏng rồi', 'bị lỗi', 'hàng lỗi', 'sản phẩm lỗi', 'không sáng',
  'bị chập', 'bị đứt', 'bị hư', 'hư rồi', 'kém chất lượng', 'khiếu nại', 'trả hàng', 'hoàn tiền',
  'không dùng được', 'sai hàng', 'giao thiếu', 'bị vỡ', 'vỡ rồi', 'mới mua đã', 'dùng vài bữa đã',
];
// Từ ngắn mơ hồ ('hư','hỏng','tệ','kém chất lượng','trả hàng','hoàn tiền'...) CHỈ tính khiếu nại khi
// đi kèm dấu hiệu ĐÃ XẢY RA với ĐƠN CỦA CHÍNH KHÁCH. Loại trừ 4 nhóm (KHÔNG dùng \b — JS \b không
// nhận chữ tiếng Việt có dấu):
//  - Lo trước khi mua: "sợ hư", "có bền không", "hãng nào bền".
//  - Tin đồn/nghi ngờ trước mua: "nghe nói...", "có phải...không", "shop bán hàng giả không".
//  - PHÀN NÀN DỊCH VỤ (không phải sản phẩm lỗi): "xin lỗi", "trả lời/phản hồi chậm", "lừa đảo".
//  - HỎI CHÍNH SÁCH TRƯỚC MUA: "có chính sách đổi trả/hoàn tiền không", "cho đổi trả không",
//    "được trả lại không" → hỏi policy, KHÔNG phải khiếu nại đơn đã lỗi.
const PRESALE_CONCERN_RE =
  /(sợ|khỏi|tránh|đỡ|ít |hay bị|có bền|bền không|hãng nào|loại nào|mua loại|nghe nói|có phải|đúng không|fake|hàng giả|hàng nhái|xin lỗi|trả lời chậm|phản hồi chậm|trả lời thiếu|đừng báo sai|lừa đảo|chính sách|có cho|cho đổi|được đổi|được trả|có đổi trả|có hoàn tiền|có được|có nhận)/i;
// Khách PHỦ ĐỊNH keyword ("đừng báo khiếu nại", "không giảm giá", "chớ hoàn tiền") → keyword
// KHÔNG tính là ý định thật. Bắt cụm phủ định + keyword gần nhau (trong ~15 ký tự).
// KHÔNG dùng \b (JS \b không nhận chữ tiếng Việt có dấu như "đừng").
const NEGATED_RE =
  /(đừng|không|chớ|khỏi cần|khỏi|đâu có|chẳng)[^.!?]{0,15}?(khiếu nại|giảm giá|giảm|chiết khấu|hoàn tiền|trả hàng|bảo hành|bớt)/i;
const WARRANTY_KW = ['bảo hành', 'đổi trả', 'đổi hàng', 'bảo hành bao lâu', 'còn bảo hành'];
const SHIPPING_KW = ['giao hàng', 'giao tận', 'ship', 'vận chuyển', 'phí giao', 'mấy ngày tới', 'giao tới', 'gửi về'];
const SHOP_INFO_KW = ['shop ở đâu', 'địa chỉ', 'ở đâu vậy', 'số điện thoại', 'sđt', 'hotline', 'giờ mở cửa', 'mấy giờ mở', 'cửa hàng ở'];
const COMPARE_KW = ['cái nào', 'loại nào tốt hơn', 'so sánh', 'khác gì', 'nên chọn', 'sáng hơn', 'bền hơn', 'tốt hơn', 'hơn cái nào'];
const LARGE_ORDER_KW = [
  '1 triệu', 'một triệu', 'triệu bóng', 'triệu cái', 'lấy sỉ', 'mua sỉ', 'số lượng lớn',
  'số lượng nhiều', 'cả container', 'nguyên lô', 'đại lý', 'phân phối',
];
const DISCOUNT_KW = ['giảm giá', 'giảm không', 'chiết khấu', 'bớt', 'giá tốt', 'giá sỉ', 'rẻ hơn'];
const PRICE_KW = ['giá nhiêu', 'giá bao nhiêu', 'bao nhiêu tiền', 'bao nhiêu một', 'bao nhiêu 1', 'nhiêu tiền', 'giá sao', 'giá thế nào', 'mấy tiền'];
const STOCK_KW = ['còn không', 'còn hàng', 'còn hàng không', 'có sẵn', 'tồn bao nhiêu', 'còn bao nhiêu', 'có hàng'];
const ORDER_KW = ['lấy ', 'mua ', 'đặt hàng', 'chốt đơn', 'đặt mua', 'order'];
const GENERAL_KW = ['bán chạy', 'phổ biến', 'có những dòng', 'có dòng nào', 'loại nào nhiều', 'mẫu nào', 'có gì'];
const ORDER_QTY = /\b\d+\s*(cuộn|cái|m\b|mét|bộ|cây|thanh|hộp|thùng|bóng)/i;

function hasKw(text: string, kws: string[]): boolean {
  return kws.some((k) => text.includes(k));
}

// Tập chữ cái tiếng Việt (có dấu) — dùng để xác định "ranh giới từ".
const VN_LETTER = 'a-zàáảãạăắằẳẵặâấầẩẫậeèéẻẽẹêếềểễệiìíỉĩịoòóỏõọôốồổỗộơớờởỡợuùúủũụưứừửữựyỳýỷỹỵđ';
const wordCache = new Map<string, RegExp>();
function wordRe(k: string): RegExp {
  let re = wordCache.get(k);
  if (!re) {
    // Bao biên: trước/sau keyword KHÔNG được là chữ cái tiếng Việt → khớp nguyên từ.
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(?<![${VN_LETTER}])${esc}(?![${VN_LETTER}])`, 'i');
    wordCache.set(k, re);
  }
  return re;
}

/**
 * Khớp keyword theo RANH GIỚI TỪ (whole-word), tránh bắt nhầm substring.
 * BẮT BUỘC cho keyword ngắn nguy hiểm: 'hư' nằm trong 'nhưng', 'tệ' trong 'tệp',
 * 'vỡ' / 'đứt' / 'chập' dễ dính chữ khác. Bug cũ: mọi câu có "nhưng" → complaint.
 */
function hasWord(text: string, kws: string[]): boolean {
  return kws.some((k) => wordRe(k).test(text));
}

/**
 * Classify customer message into a sales intent. Order matters: more specific /
 * higher-priority intents win (internal block first, then large order, etc.).
 */
// Khách TỰ PHỦ NHẬN hỏi thông tin nội bộ ("em không hỏi giá vốn đâu", "đâu phải hỏi giá vốn",
// "chứ không hỏi giá sỉ") → KHÔNG chặn như câu nội bộ thật. Chỉ cần có dấu phủ nhận gần cụm.
// "vốn dĩ" = trạng từ ("vốn dĩ đẹp") — 'giá vốn' dính "giá vốn dĩ" là giả, loại luôn.
// KHÔNG dùng \b (JS \b không nhận diện chữ tiếng Việt có dấu → khớp sai ở ranh giới).
const INTERNAL_DISCLAIM_RE = /(không hỏi|đâu hỏi|đâu phải|chứ không|không phải là|có phải đâu|không cần biết|vốn dĩ)/i;

export function classifyIntent(message: string): Intent {
  const t = message.toLowerCase().trim();
  // hasWord (whole-word) cho INTERNAL — 'giá vốn' KHÔNG dính "giá vốn dĩ", 'sỉ' KHÔNG dính "liêm sỉ".
  // + Bỏ qua khi khách TỰ PHỦ NHẬN đang hỏi ("không hỏi giá vốn đâu").
  if (hasWord(t, INTERNAL_KW) && !INTERNAL_DISCLAIM_RE.test(t)) return 'internal';
  // Khiếu nại ưu tiên cao (rủi ro): "mua về cháy rồi" phải handoff, không để đi bán tiếp.
  // Dùng hasWord (whole-word) — keyword ngắn KHÔNG được dính substring ("nhưng", "tệp"...).
  // NHƯNG nếu câu mang ý LO TRƯỚC KHI MUA ("nguồn nào bền khỏi hư", "sợ nóng") → KHÔNG phải
  // khiếu nại, để đi tiếp luồng tư vấn bán hàng (codex round-2: né bug warranty trên câu pre-sale).
  // + NEGATED_RE: khách phủ định ("đừng báo khiếu nại") → không tính complaint.
  if (hasWord(t, COMPLAINT_KW) && !PRESALE_CONCERN_RE.test(t) && !NEGATED_RE.test(t)) return 'complaint';
  // Discount: "lấy nhiều CÓ GIẢM KHÔNG" là hỏi giảm. hasWord — 'sỉ' KHÔNG dính "liêm sỉ".
  // + NEGATED_RE: "đừng giảm giá/làm tròn" → khách KHÔNG xin giảm, không tính discount.
  if (hasWord(t, DISCOUNT_KW) && !NEGATED_RE.test(t)) return 'discount';
  if (hasKw(t, LARGE_ORDER_KW)) return 'large_order';
  if (hasKw(t, WARRANTY_KW) && !NEGATED_RE.test(t)) return 'warranty';
  if (hasKw(t, SHIPPING_KW)) return 'shipping';
  if (hasKw(t, SHOP_INFO_KW)) return 'shop_info';
  // order intent: từ khóa mua + có số lượng (tránh bắt nhầm "mua gì để decor")
  if (hasKw(t, ORDER_KW) && (ORDER_QTY.test(t) || /\bchốt|đặt hàng|order\b/.test(t))) return 'order';
  if (hasKw(t, PRICE_KW)) return 'price';
  if (hasKw(t, STOCK_KW)) return 'stock';
  if (hasKw(t, COMPARE_KW)) return 'compare';
  if (hasKw(t, GENERAL_KW)) return 'general';
  return 'normal';
}

// Câu từ chối nội bộ — trả thẳng ở code, KHÔNG gọi LLM (an toàn tuyệt đối, 0 token).
export const INTERNAL_REPLY =
  'Dạ phần này là thông tin nội bộ nên em không cung cấp được ạ. Anh/chị cần tư vấn đèn LED hay kiểm tra mã hàng nào không ạ?';

// Khiếu nại — rủi ro cao, xử lý cố định ở code + handoff sale ngay (codex khuyến nghị).
// Không để LLM tự ứng biến trên tình huống nhạy cảm.
// Câu xin lỗi khiếu nại — nhận bizName (bỏ hardcode LEDNELIA), trung tính ngành.
export function complaintReply(bizName = 'bên em'): string {
  return (
    `Dạ ${bizName} xin lỗi anh/chị vì sự cố này ạ. Em sẽ chuyển ngay cho nhân viên hỗ trợ kiểm tra giúp mình. ` +
    'Anh/chị cho em xin SĐT/mã đơn và thông tin chi tiết sự việc để bên em xử lý nhanh nhất nhé.'
  );
}
// Giữ hằng số cũ cho nơi chưa truyền bizName (fallback).
export const COMPLAINT_REPLY = complaintReply();

/**
 * Hint chèn vào đầu prompt để ép LLM trả lời đúng kiểu cho intent đã phát hiện.
 * Trả '' cho 'normal' (không ép). 'internal' không dùng hint (đã chặn ở code).
 */
export function intentHint(intent: Intent): string {
  switch (intent) {
    case 'large_order':
      return 'INTENT: ĐƠN LỚN/SỈ. VẪN CHỐT ĐƠN như thường (điền order + checkout_stage): số lượng lớn KHÔNG phải lý do chuyển sale. "lấy hết"/"còn nhiêu lấy hết" → dùng số tồn kho làm qty. Chỉ chuyển sale nếu THIẾU GIÁ hoặc khách hỏi GIẢM GIÁ.';
    case 'order':
      return 'INTENT: CHỐT ĐƠN. BẮT BUỘC: xác nhận sản phẩm + số lượng khách nói (điền order + checkout_stage). KHÔNG hỏi lại nhu cầu trang trí. Chỉ chuyển sale nếu thiếu giá.';
    case 'discount':
      return 'INTENT: HỎI GIẢM GIÁ. BẮT BUỘC: nói giảm giá tùy số lượng (chưa có mức cố định), hỏi số lượng để chuyển sale. KHÔNG bịa mức giảm.';
    case 'price':
      return 'INTENT: HỎI GIÁ. BẮT BUỘC: câu đầu PHẢI báo giá sản phẩm lấy từ TÀI LIỆU nếu có. Nếu tài liệu ghi "Giá bán: chưa có" thì nói cần nhân viên kiểm tra giá. KHÔNG né để đi hỏi nhu cầu.';
    case 'stock':
      return 'INTENT: HỎI TỒN. BẮT BUỘC: câu đầu PHẢI nói còn/hết + số tồn từ TÀI LIỆU nếu có.';
    case 'general':
      return 'INTENT: HỎI CHUNG/BÁN CHẠY. BẮT BUỘC: dùng dữ liệu nhóm ngành + thống kê trong TÀI LIỆU. KHÔNG nói "bán chạy nhất". Nói "nhiều mẫu/phổ biến nhất là nhóm...".';
    case 'warranty':
      return 'INTENT: HỎI BẢO HÀNH/ĐỔI TRẢ. BẮT BUỘC: nếu TÀI LIỆU có chính sách bảo hành thì trả lời theo đó. NẾU KHÔNG CÓ → nói "chính sách bảo hành để nhân viên xác nhận chính xác cho mình", đặt needs_human=true. KHÔNG bịa số tháng/điều kiện.';
    case 'shipping':
      return 'INTENT: HỎI GIAO HÀNG. BẮT BUỘC: nếu TÀI LIỆU có chính sách giao hàng thì trả lời theo đó. NẾU KHÔNG CÓ (phí/thời gian cụ thể) → nói nhân viên sẽ xác nhận, đặt needs_human=true. KHÔNG bịa phí/thời gian.';
    case 'shop_info':
      return 'INTENT: HỎI THÔNG TIN SHOP (địa chỉ/SĐT/giờ). BẮT BUỘC: nếu TÀI LIỆU có thì trả lời. NẾU KHÔNG CÓ → nói nhân viên sẽ cung cấp, đặt needs_human=true. KHÔNG bịa địa chỉ/SĐT.';
    case 'compare':
      return 'INTENT: SO SÁNH SẢN PHẨM. BẮT BUỘC: nếu TÀI LIỆU không có thông số kỹ thuật (độ sáng/công suất/chống nước) → KHÔNG kết luận cái nào hơn. Nói chưa đủ thông số để kết luận, hỏi nhu cầu (trong nhà/ngoài trời) rồi gợi ý hướng hoặc chuyển nhân viên tư vấn.';
    default:
      return '';
  }
}
