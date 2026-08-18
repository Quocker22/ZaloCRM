// SPDX-License-Identifier: AGPL-3.0-or-later
// RÚT BÀI HỌC từ một hội thoại đã nguội — model đọc lại, code quyết ghi gì.
//
// Anh Quốc chốt 18/08: bot TỰ ÁP NGAY, có nhật ký để gỡ. Nên hàng rào phải
// nằm hết ở đây, vì không có người duyệt chặn giữa:
//
//   1. CHỈ HỌC KHI CÓ MÙI. `chamDauHieu` (code) phải thấy vấn đề mới gọi model
//      — không thì mỗi hội thoại trơn tru cũng đẻ ra "bài học" rác.
//   2. WHITELIST LOẠI BÀI HỌC. Model chỉ được chọn trong tập đóng; loại lạ →
//      vứt. (Bài học "enum trong prompt phải có whitelist ở runtime".)
//   3. TRẦN 200 KÝ TỰ / luật + TỐI ĐA 2 luật một ca. Model rẻ hay viết văn;
//      luật dài là luật vô dụng, và một ca đẻ 5 luật là kho phình trong tuần.
//   4. CẤM ĐỤNG TIỀN & CẤM ĐỤNG LUẬT NGƯỜI. Luật tự học KHÔNG được nói về
//      giá/chiết khấu/VAT/công nợ (số tiền phải do NGƯỜI dặn), và không bao
//      giờ ghi đè/gỡ luật `nguon='nv_dan'`.
//   5. CHỐNG TRÙNG. ghiLuat sẵn có đã chặn trùng hệt; ở đây chặn thêm trùng
//      Ý (chuẩn hoá + so với luật đang có, bỏ nếu chứa nhau).
import { logger } from '../../../../shared/utils/logger.js';
import type { ToolAwareGenerate } from '../types.js';
import type { TinSoi, KetQuaDauHieu } from './dau-hieu.js';

/** Loại bài học ĐƯỢC PHÉP học tự động. Ngoài danh sách = vứt. */
export const LOAI_BAI_HOC = [
  'cach_hieu_y',      // NV/khách nói kiểu này nghĩa là gì
  'cach_tra_loi',     // trả lời gọn hơn / đừng hỏi lại thứ đã có
  'ten_goi_hang',     // cách shop gọi tên một mặt hàng
  'quy_trinh',        // thứ tự làm việc NV muốn
] as const;
export type LoaiBaiHoc = (typeof LOAI_BAI_HOC)[number];

/** Từ khoá TIỀN — luật tự học chạm vào là vứt (số tiền phải do người dặn). */
const CAM_TIEN = /\b(gia|giá|chiet khau|chiết khấu|vat|thue|thuế|cong no|công nợ|tien|tiền|đ\b|vnd|%)/i;

/**
 * LUẬT RỖNG NGHĨA — lời khuyên chung chung, không đổi được hành vi nào.
 *
 * Đo trên prod 18/08 sau MỘT NGÀY bật tự học: 5/5 luật bot tự rút đều thuộc
 * loại này, và chúng gây hại thật chứ không chỉ vô ích:
 *   · "Khi chưa chắc chắn yêu cầu … hãy hỏi ngắn gọn 1 câu để làm rõ"
 *   · "Khi người dùng gõ ký tự ngắn như '1 a a b' … hãy dừng lại và hỏi xác nhận"
 *   · "Khi nhận yêu cầu liên quan đến tin nhắn lạ … hãy xác nhận trước khi xử lý"
 * Tổng 847/900 ký tự trần → đẩy văng luật THẬT của anh Quốc ("Khách Led Kim
 * Long luôn chiết khấu 5%" tụt khỏi prompt, log 12:36:34 ghi rõ "vượt trần ký
 * tự — cắt bớt luật cũ"). Tệ hơn: chúng dạy bot phản xạ HỎI LẠI thay vì LÀM,
 * và 12:36:42 bot nhả đúng "Em cần biết rõ để xử lý đúng ạ." — một câu rỗng
 * sau 8 giây suy nghĩ.
 *
 * Luật đáng học phải NÊU ĐÍCH DANH thứ có thật trong việc buôn bán: tên hàng,
 * tên khách, tên bước ("phiếu nhập", "công nợ"), cách gọi tắt của shop. Còn
 * "hãy xác nhận trước khi xử lý" thì đúng với mọi bot trên đời — nó không phải
 * tri thức riêng của shop, và bot vốn đã được dạy điều đó trong system prompt.
 *
 * Cùng bài học với "hàng rào ở code, không vá prompt": thứ chặn được model rẻ
 * phải là luật tất định, không phải lời dặn thêm trong prompt.
 */
const RONG_NGHIA = new RegExp([
  'hãy (hỏi|xác nhận|kiểm tra|chủ động|dừng lại|làm rõ|tránh|đảm bảo|lưu ý)',
  'nên (hỏi|xác nhận|kiểm tra|chủ động|tránh)',
  'trước khi (xử lý|thao tác|trả lời|thực hiện)',
  'tránh (nhầm lẫn|hiểu lầm|sai sót|mâu thuẫn|dài dòng)',
  '(ngắn gọn|rõ ràng|chi tiết hơn|chính xác hơn)',
  'khi (chưa|không) (chắc chắn|rõ|hiểu)',
].join('|'), 'i');

/**
 * Bằng chứng luật NÓI VỀ VIỆC THẬT: có tên riêng/mã hàng/thuật ngữ nghiệp vụ.
 * Không có dấu hiệu nào trong số này thì luật chỉ là lời khuyên chung.
 */
const CO_VIEC_THAT = new RegExp([
  '\\b[a-z]*\\d{2,}[a-z]*\\b',        // mã hàng: 6313, 12v400w, P10
  'phiếu (nhập|xuất|kho)', 'đơn (mua|bán|nháp)', 'nhà cung cấp', 'ncc',
  'tồn kho', 'công nợ', 'hoá đơn', 'hóa đơn', 'bảo hành', 'chiết khấu',
  'ziczac', 'led', 'cuộn', 'bóng', 'thanh',
  // "nguồn" phải đi kèm dấu hiệu MẶT HÀNG. Trần trụi thì nó khớp cả "không rõ
  // nguồn" trong luật rác 18/08 ("yêu cầu liên quan đến tin nhắn lạ hoặc không
  // rõ nguồn … hãy xác nhận trước khi xử lý") — chữ "nguồn" ở đó nghĩa là
  // xuất xứ tin nhắn, không phải bộ nguồn LED.
  'nguồn (nb|atx|df|yl|xdf|\\d)', '(bộ|con|cái) nguồn',
].join('|'), 'i');

export interface BaiHoc {
  loai: LoaiBaiHoc;
  /** Câu dặn, ≤200 ký tự, viết như NV dặn bot. */
  noiDung: string;
  /** Khi nào áp dụng — vào cột condition. */
  phamVi?: string;
}

export interface KetQuaRut {
  nhanXet: string;
  baiHoc: BaiHoc[];
  /** Alias học được: NV gọi "X" = sản phẩm bot đã chốt id Y. */
  alias: Array<{ tuKhoa: string; productId: number; tenSp: string }>;
}

const LOI_DAN = `Bạn đang SOÁT LẠI một đoạn chat đã kết thúc giữa BOT bán hàng và người dùng, để rút kinh nghiệm cho bot.

NHIỆM VỤ:
1. Nói ngắn gọn bot làm CHƯA ỔN chỗ nào (2-3 câu, tiếng Việt, cụ thể).
2. Rút TỐI ĐA 2 bài học dạng câu dặn cho bot, MỖI CÂU ≤200 ký tự.

BÀI HỌC PHẢI:
- Là điều LẶP LẠI ĐƯỢC ở hội thoại sau, không phải chi tiết một lần (không ghi số đơn, tên khách cụ thể, con số tiền).
- KHÔNG nói về giá, chiết khấu, VAT, công nợ, số tiền — chỉ NGƯỜI mới được dặn bot về tiền.
- Viết như người dặn: "Khi ... thì ...".
- Thuộc một trong các loại: cach_hieu_y | cach_tra_loi | ten_goi_hang | quy_trinh.

KHÔNG CÓ gì đáng học (bot đã xử ổn, hoặc lỗi chỉ do dữ liệu thiếu) → trả baiHoc rỗng. Thà không học còn hơn học bậy.

Trả về DUY NHẤT JSON:
{"nhanXet":"...","baiHoc":[{"loai":"cach_hieu_y","noiDung":"Khi ... thì ...","phamVi":"(tuỳ chọn)"}]}`;

/** Dựng transcript cho model — có nhãn vai, cắt tin quá dài. */
function dungTranscript(tin: TinSoi[]): string {
  return tin
    .map((t) => `${t.vai === 'nguoi' ? 'NGƯỜI' : 'BOT'}: ${t.noiDung.replace(/\s+/g, ' ').slice(0, 400)}`)
    .join('\n');
}

export function locBaiHoc(tho: unknown, luatDangCo: string[]): BaiHoc[] {
  if (!Array.isArray(tho)) return [];
  const chuan = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const daCo = luatDangCo.map(chuan);
  const ra: BaiHoc[] = [];
  for (const b of tho.slice(0, 2)) {
    const o = b as Record<string, unknown>;
    const loai = String(o.loai ?? '');
    const noiDung = String(o.noiDung ?? '').trim();
    if (!(LOAI_BAI_HOC as readonly string[]).includes(loai)) {
      logger.info({ loai }, '[tu-soi] bỏ bài học: loại ngoài whitelist');
      continue;
    }
    if (noiDung.length < 10 || noiDung.length > 200) {
      logger.info({ dai: noiDung.length }, '[tu-soi] bỏ bài học: độ dài không hợp lệ');
      continue;
    }
    if (CAM_TIEN.test(noiDung)) {
      logger.info({ noiDung }, '[tu-soi] bỏ bài học: chạm tiền/giá — chỉ người mới được dặn');
      continue;
    }
    // RỖNG NGHĨA: lời khuyên chung ("hãy hỏi xác nhận trước khi xử lý") mà
    // không nêu thứ gì có thật trong việc buôn bán — xem `RONG_NGHIA`. Đây là
    // hàng rào đắt nhất trong hàm: 5/5 luật prod 18/08 chết ở đây.
    if (RONG_NGHIA.test(noiDung) && !CO_VIEC_THAT.test(noiDung)) {
      logger.info({ noiDung }, '[tu-soi] bỏ bài học: rỗng nghĩa — lời khuyên chung, không nêu việc thật');
      continue;
    }
    const c = chuan(noiDung);
    if (daCo.some((x) => x.includes(c) || c.includes(x))) {
      logger.info({ noiDung }, '[tu-soi] bỏ bài học: trùng ý luật đang có');
      continue;
    }
    ra.push({
      loai: loai as LoaiBaiHoc,
      noiDung,
      ...(o.phamVi && String(o.phamVi).trim() ? { phamVi: String(o.phamVi).trim().slice(0, 100) } : {}),
    });
    daCo.push(c);
  }
  return ra;
}

/**
 * Gọi model soi lại hội thoại. Model trả rác/JSON hỏng → trả về rỗng (không
 * học gì) chứ không ném: tự-soi là việc nền, hỏng không được ảnh hưởng ai.
 */
export async function rutBaiHoc(
  generate: ToolAwareGenerate,
  input: { tin: TinSoi[]; cham: KetQuaDauHieu; vai: 'nhanvien' | 'khach'; luatDangCo: string[] },
): Promise<KetQuaRut> {
  const rong: KetQuaRut = { nhanXet: '', baiHoc: [], alias: [] };
  try {
    const r = await generate({
      system: LOI_DAN,
      messages: [{
        role: 'user',
        content:
          `Vai người dùng: ${input.vai === 'nhanvien' ? 'NHÂN VIÊN của shop' : 'KHÁCH HÀNG'}\n` +
          `Dấu hiệu code đã bắt: ${input.cham.dauHieu.join(', ') || 'không có'} (điểm ${input.cham.diem}/10)\n` +
          `Luật bot đang có (đừng lặp lại): ${input.luatDangCo.slice(0, 15).join(' | ') || 'chưa có'}\n\n` +
          `--- ĐOẠN CHAT ---\n${dungTranscript(input.tin)}`,
      }],
      tools: [],
      maxTokens: 800,
    });
    const text = String(r.text ?? '').trim();
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) { logger.info('[tu-soi] model không trả JSON — bỏ qua lượt soi'); return rong; }
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    return {
      nhanXet: String(j.nhanXet ?? '').slice(0, 500),
      baiHoc: locBaiHoc(j.baiHoc, input.luatDangCo),
      alias: [],
    };
  } catch (err) {
    logger.warn({ err }, '[tu-soi] rút bài học lỗi — bỏ qua (không ảnh hưởng luồng chat)');
    return rong;
  }
}
