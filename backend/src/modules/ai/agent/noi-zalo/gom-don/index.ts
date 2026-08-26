// SPDX-License-Identifier: AGPL-3.0-or-later
// MÁY GOM ĐƠN — orchestrator. Code cầm lái toàn bộ quy trình lên đơn:
//   tin NV → (map chọn bằng code | trích slot LLM) → đắp phiên →
//   buocTiepTheo → tra cứu song song / hỏi bằng template / tạo đơn.
//
// Spec: docs/superpowers/specs/2026-08-07-luong-len-don-slot-design.md
// Vì sao: 4 lần vá prompt trong tối 07/08 mà luồng vẫn hỏng kiểu mới —
// từ nay quy trình là code, bug mới = thêm kịch bản replay + sửa đúng một ngăn.
import { logger } from '../../../../../shared/utils/logger.js';
import type { ToolAwareGenerate } from '../../types.js';
import type { ToolCallLog } from '../../staff-agent.js';
import type { OdooClient } from '../../../odoo/client.js';
import { traKhachHang, dinhDangKhachHang } from '../../../odoo/tools/tra-khach-hang.js';
import { taoKhachHang, dinhDangTaoKhach, CHIA_BO_PHANH } from '../../../odoo/tools/tao-khach-hang.js';
import { traSanPham, dinhDangSanPham, boDau, xungDotBienThe, laTenChungBienThe, NGUONG_GIA_AO } from '../../../odoo/tools/tra-san-pham.js';
import { taoDonNhap, dinhDangTaoDon } from '../../../odoo/tools/tao-don-nhap.js';
// PHIẾU NHẬP HÀNG (11/08) — ca thật 22:09-22:11: bot đáp "chưa có tool tạo
// phiếu nhập hàng ... nằm ngoài phạm vi em hỗ trợ" dù quyền ghi purchase.order
// vốn đã có (đo prod: create=true/write=true, 5 đơn mua thật đang chạy).
import { taoDonMua, dinhDangTaoDonMua, traNhaCungCap, dinhDangNhaCungCap, boTienToNcc } from '../../../odoo/tools/tao-don-mua.js';
import { suaDon, dinhDangSuaDon } from '../../../odoo/tools/sua-don.js';
import { suaDonMua, dinhDangSuaDonMua } from '../../../odoo/tools/sua-don-mua.js';
import { anhPhieuNhap } from '../../../odoo/anh-phieu-nhap.js';
// VAT: tra id account.tax theo % nhân viên nói. KHÔNG phải tool cho model —
// máy gom đơn gọi thẳng hàm, nên nó không có mặt trong registry (xem chú thích
// đầu tra-thue.ts). Đừng xoá vì "không thấy đăng ký ở đâu".
import { traThueBan } from '../../../odoo/tools/tra-thue.js';
import { guiHoaDon } from '../../../odoo/tools/gui-hoa-don.js';
import { IDEMPOTENCY_PREFIX } from '../../../odoo/idempotency.js';
import { linkXuLyDon, linkXuLyDonMua, type HoaDonAnhClient, type AnhHoaDon } from '../../../odoo/hoa-don-anh.js';
import { laXacNhanNgan } from '../cam-xuc.js';
import { KHO, type PhienGom, type HanhDong, type DonSua } from './kieu.js';
import { buocTiepTheo } from './buoc-tiep-theo.js';
import { apDungChon, apChonDeXuat, dangChoChon, LA_KHACH_MOI } from './chon.js';
import { laMaKh } from '../../../odoo/tools/tra-khach-hang.js';
import { renderLoiNhan } from './loi-nhan.js';
import { trichSlot, type KetQuaTrich } from './trich-slot.js';
import { docPhien, luuPhien, xoaPhien, type DbPhienGomDon } from './phien-store.js';

/** "lên/tạo/đặt + đơn/hàng" ở đầu từ — 'sửa đơn'/'báo cáo đơn' KHÔNG kích máy. */
const NHAN_LENH_LEN_DON = /(?:^|\s)(?:lên|len|tạo|tao|đặt|dat)\s+(?:đơn|don|hàng|hang)\b/i;

/**
 * Lệnh NHẬP HÀNG / ĐƠN MUA (11/08) — cửa vào chế 'nhap'.
 *
 * Bắt đúng câu thật của ca 22:09: "rồi tạo phiếu nhập hàng giúp tôi luôn", và
 * các cách nói cùng nghĩa: "phiếu nhập", "nhập hàng", "đơn mua", "đặt hàng NCC".
 *
 * PHẢI đứng TRƯỚC `NHAN_LENH_LEN_DON` khi kiểm, vì hai regex CHỒNG NHAU:
 * "tạo phiếu nhập hàng" khớp cả `tạo\s+hàng`? không — nhưng "nhập hàng" thì
 * `NHAN_LENH_LEN_DON` không bắt, còn "tạo đơn mua" thì CÓ ("tạo đơn"). Thứ tự
 * kiểm quyết định câu đó thành đơn bán hay đơn mua; nhập hàng thắng.
 *
 * Cố ý KHÔNG bắt "nhập kho"/"nhập tồn" một mình: đó có thể là hỏi tồn kho.
 */
const NHAN_LENH_NHAP_HANG =
  /(?:^|\s)(?:phiếu|phieu)\s+(?:nhập|nhap)\b|(?:^|\s)(?:nhập|nhap)\s+(?:hàng|hang|lô|lo)\b|(?:^|\s)(?:đơn|don)\s+(?:mua|nhập|nhap)\b|(?:^|\s)(?:mua|order|đặt|dat)\s+(?:hàng|hang)\s+(?:của|cua|từ|tu)\b/i;

/**
 * Lệnh SỬA đơn (spec 08/08): "sửa đơn…", "thêm 5 cáp vào đơn", "đổi thành 100".
 * Cố ý KHÔNG bắt "sửa chiết khấu" — việc đó vẫn của agent thường.
 */
const NHAN_LENH_SUA_DON =
  /(?:^|\s)(?:sửa|sua|thêm|them|bớt|bot|đổi|doi)\s+(?:\S+\s+){0,4}?(?:đơn|don|phiếu|phieu)\b|(?:^|\s)(?:sửa|sua)\s+(?:đơn|don|phiếu|phieu)\b/i;

/**
 * Câu THAM CHIẾU SỬA — chỉ có nghĩa khi hội thoại VỪA lên đơn xong (dấu
 * `daXong`, cửa sổ 15'). Ca thật 06:21-06:29 13/08, ba câu liên tiếp cùng một
 * ý "sửa cái đơn vừa lên" mà không câu nào chứa chữ "đơn":
 *   "6214 trắng ấm mà ???"          → đuôi "mà" + ? (trách máy làm sai)
 *   "xuất lại báo giá cho đúng đi"  → "xuất lại" / "cho đúng"
 *   "giá 1800 đó"                   → "giá … đó" (đọc giá cho dòng đang bàn)
 * Máy hiểu thành lệnh LÊN ĐƠN MỚI → hỏi "khách nào ạ?" → đơn trùng S13849.
 * Chạy trên chuỗi ĐÃ boDau (thường, không dấu). "sai(?! gon)" để "sài gòn"
 * không thành "sai". Đuôi "mà" bắt buộc kèm ?/! — "cho xin mã" thì không khớp.
 */
/**
 * PHÂN TÍCH CÂU SỬA GIÁ bằng CODE (14/08, ca thật 22:32-22:33).
 *
 * "giá 175k đó" rồi "sửa giá nguồn á" — model không có chỗ đặt (schema chỉ có
 * giá TRONG dòng {sp,sl,gia}), trả về tay trắng, máy hỏi "sửa gì" rồi kẹt.
 * Câu sửa giá có HÌNH DẠNG cố định nên bắt bằng regex, không nhờ model:
 *   "giá 175k (đó)"        → { gia: 175000 }
 *   "sửa giá nguồn (á)"    → { ten: 'nguồn' }
 *   "đổi giá cáp thành 20k"→ { ten: 'cáp', gia: 20000 }
 * HẸP có chủ ý: chỉ nhận câu MỞ ĐẦU bằng (sửa|đổi)?giá — "thêm 5 cáp giá 20k
 * vào đơn" mở đầu bằng "thêm" nên đi đường thường, không bị cướp.
 * Chạy trên chuỗi đã boDau.
 */
export function phanTichCauSuaGia(cauBd: string): { gia?: number; ten?: string } | null {
  // MẪU 2 (17/08, ca 00:28): "<tên hàng> giá (nhập|bán)? <số> (nhé|nha…)" —
  // tên đứng TRƯỚC, không có "sửa"/"đó". Trước đây trượt hết fence, rơi vào
  // model và nó bịa thành phiếu nhập mới với NCC "NB" ("Nguồn NB ... giá nhập
  // 20099đ nhé" → "Em không tìm thấy nhà cung cấp NB").
  const m2 = /^(.{2,60}?)\s+gia(?:\s+nhap|\s+ban)?\s+(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(k|nghin|ngan)?\s*(?:d|dong|vnd)?\s*(?:nhe|nha|nho|a|voi|giup em|em)?\s*[.!]*$/.exec(cauBd.trim());
  if (m2) {
    let gia = Number(m2[2].replace(/[.,]/g, ''));
    if (m2[3]) gia *= 1000;
    const ten = m2[1].trim();
    if (ten && Number.isFinite(gia) && gia > 0) return { ten, gia };
  }
  const m = /^(?:sua |doi )?gia\b(.*)$/.exec(cauBd.trim());
  if (!m) return null;
  let duoi = m[1].trim();
  // Giá: số có thể kèm phân cách nghìn + hậu tố k/nghìn/ngàn. Số DÍNH chữ
  // (12v400w) không tính — đòi ranh giới không phải chữ-số ở hai đầu.
  const g = /(?:^|[^a-z0-9])(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(k|nghin|ngan)?(?=$|[^a-z0-9])/.exec(duoi);
  let gia: number | undefined;
  if (g) {
    gia = Number(g[1].replace(/[.,]/g, ''));
    if (g[2]) gia *= 1000;
    duoi = (duoi.slice(0, g.index) + ' ' + duoi.slice(g.index + g[0].length)).trim();
  }
  // Tên hàng: phần còn lại sau khi bỏ từ đệm.
  const ten = duoi
    .split(/\s+/)
    .filter((w) => !['a', 'ạ', 'đo', 'do', 'day', 'nhe', 'nha', 'thanh', 'con', 'lai', 'la', 'thoi', 'di', 'gium', 'giup', 'em', 'anh', 'chi', 'nhap', 'ban', 'moi'].includes(w))
    .join(' ')
    .trim();
  if (gia == null && !ten) return null;
  return { ...(gia != null ? { gia } : {}), ...(ten ? { ten } : {}) };
}

/** Câu CHỈ là một con số giá ("175k", "175.000đ") — dùng khi máy vừa hỏi giá mới. */
export function bocGiaTran(cauBd: string): number | null {
  const m = /^(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(k|nghin|ngan)?\s*(?:d|dong|vnd)?$/.exec(cauBd.trim());
  if (!m) return null;
  let gia = Number(m[1].replace(/[.,]/g, ''));
  if (m[2]) gia *= 1000;
  return gia;
}

const NHAN_THAM_CHIEU_SUA =
  /(?:^|\s)(?:sua|sai(?! gon)|nham|xuat lai|lam lai|in lai|gui lai|cho dung|doi (?:lai|gia|sang))(?=\s|$)|(?:^|\s)(?:gia|giam|chiet khau|vat)\b.{0,30}\b(?:do|day)[\s?!.~]*$|\bma\s*[?!]+[\s?!.~]*$/;

/**
 * Bỏ khối quote-reply mà message-handler chèn (`[Trả lời tin: "…"] câu thật`).
 *
 * Bug thật 23:14 07/08: nhân viên QUOTE danh sách khách rồi gõ "5" — cả danh
 * sách bị nhét vào câu nên máy không map nổi lựa chọn, nhường agent thường và
 * mất cổng chốt. Câu CHỌN/LỆNH luôn nằm ở đuôi; phần quote chỉ giữ cho LLM
 * trích slot (nó cần ngữ cảnh "cái này").
 */
const boQuote = (cau: string): string =>
  cau.replace(/^\[Trả lời tin: "[\s\S]{0,220}?"\]\s*/, '');

/**
 * Câu có mang khối NỘI DUNG ẢNH mà `luong-media` ghép vào không?
 *
 * Khối này do `docVaChuyenTiep` dựng sau khi bot đọc ảnh thành công:
 *   `<lời nhắn>\n[Khách gửi ảnh, nội dung trong ảnh: …]`
 *
 * ĐỪNG NHẦM với khối `[Trả lời tin: "…"]` mà `boQuote` cắt. Hai khối trông
 * giống nhau (đều là khối vuông trong câu) nhưng vai trò NGƯỢC nhau:
 *   [Trả lời tin: …]     → NGỮ CẢNH bot tự chèn, phải cắt khỏi câu CHỌN
 *                          (bug 23:14 07/08: quote danh sách rồi gõ "5").
 *   [Khách gửi ảnh: …]   → NỘI DUNG THẬT nhân viên gửi, phải GIỮ NGUYÊN.
 */
const coKhoiAnh = (cau: string): boolean => cau.includes('[Khách gửi ảnh');

/**
 * Lấy RIÊNG phần chữ đọc từ ảnh, bỏ hết lời nhắn và nhãn quanh nó.
 *
 * Dùng cho lượt TRÍCH LẠI khi model bỏ sót hàng trong ảnh (xem khối lý do ở
 * `xuLyGomDon`). Đưa mỗi danh sách hàng trần cho model — không lời nhắn, không
 * nhãn — thì nó không còn gì để bám vào mà coi khối ảnh là văn bản nền.
 *
 * Nhãn do `ghepCauTuAnh` (luong-media.ts) dựng, dạng:
 *   `[Khách gửi ảnh — ĐÂY LÀ NỘI DUNG THẬT …:\n<chữ đọc từ ảnh>]`
 * Dấu `:` cuối nhãn là ranh giới; nội dung ảnh chạy tới `]` cuối cùng. Cũng
 * chịu được chuỗi CŨ (`[Khách gửi ảnh, nội dung trong ảnh: …]`) để tin đang
 * bay giữa chừng lúc deploy không rơi mất.
 */
/**
 * BÓC DÒNG HÀNG TỪ NỘI DUNG ẢNH BẰNG CODE — không nhờ model chép lại nữa.
 *
 * ─── VÌ SAO CODE CHỨ KHÔNG PHẢI TRÍCH SLOT LẦN HAI (đo 18:39-18:41 12/08) ───
 * Hàng rào cũ khi model bỏ sót hàng trong ảnh là gọi `trichSlot` LẦN HAI với
 * riêng khối ảnh. Đo tận tay trên prod (bọc generate, in tool call): model
 * chính nhìn thẳng danh sách trần "- P10 full out: 10000 tấm\n…" mà VẪN trả
 * `{khach, nhapHang}` với 0 dòng — hai lượt liền. Cùng chuỗi đó lúc khác lại
 * trả đủ 17 dòng. Model rẻ KHÔNG TẤT ĐỊNH cho việc chép danh sách dài qua
 * tool call; xây tính năng trên nó là xây trên cát.
 *
 * Trong khi đó nội dung ảnh KHÔNG phải chữ tự do: `loiDanDocAnh` đã ép model
 * đọc ảnh xuất đúng dạng `"tên hàng: số lượng đơn vị"` mỗi dòng — đó là HỢP
 * ĐỒNG format của chính mình. Dữ liệu có hợp đồng thì parse bằng code: chạy
 * một tỉ lần ra một kết quả. Model chỉ còn là fallback cho dòng lệch chuẩn.
 *
 * Chịu các biến thể đo từ ảnh thật 12/08:
 *   "- P10 full out: 10.000 tấm | 242 thùng"  → sp="P10 full out", sl=10000
 *   "- DM: 12V400W: 1616"                     → sp="DM: 12V400W", sl=1616
 *     (HAI dấu ':' — cắt ở dấu CUỐI, tên hàng được chứa ':')
 *   "Tổng: 242 thùng"                         → BỎ (dòng tổng kết, không phải hàng)
 *   "- 5V60A mỏng: 1131"                      → sp="5V60A mỏng", sl=1131
 * Số kiểu VN: "10.000" là mười nghìn (chấm ngăn nghìn), giữ đúng.
 */
const TEN_KHONG_PHAI_HANG = /^(tổng|tong|cộng|cong|tổng cộng|total|ghi chú|note)$/i;
export function bocDongTuKhoiAnh(chiAnh: string): Array<{ sp: string; sl?: number }> {
  const dong: Array<{ sp: string; sl?: number }> = [];
  for (const tho of chiAnh.split('\n')) {
    // Bỏ bullet đầu dòng model hay thêm ("- ", "• ", "* ").
    const d = tho.replace(/^\s*[-•*]\s*/, '').trim();
    if (!d) continue;
    // Cắt ở dấu ':' CUỐI — tên hàng thật có ':' bên trong ("DM: 12V400W").
    const viTri = d.lastIndexOf(':');
    if (viTri <= 0) continue;
    const ten = d.slice(0, viTri).trim();
    if (!ten || TEN_KHONG_PHAI_HANG.test(ten)) continue;
    // Phần số: lấy TRƯỚC dấu '|' (phần sau là ghi chú phụ "| 242 thùng"),
    // rồi bóc số ĐẦU TIÊN. "10.000 tấm" → 10000; không có số → dòng mô tả, bỏ.
    const phanSo = d.slice(viTri + 1).split('|')[0].trim();
    const soKhop = phanSo.match(/\d[\d.,]*/);
    if (!soKhop) continue;
    const sl = Number(soKhop[0].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
    if (!Number.isFinite(sl) || sl <= 0) continue;
    dong.push({ sp: ten, sl });
  }
  return dong;
}

export function chiLayKhoiAnh(cau: string): string {
  const batDau = cau.indexOf('[Khách gửi ảnh');
  if (batDau < 0) return '';
  const ketKhoi = cau.lastIndexOf(']');
  const trongKhoi = ketKhoi > batDau ? cau.slice(batDau, ketKhoi) : cau.slice(batDau);
  // Bỏ phần nhãn: cắt từ dấu ':' ĐẦU TIÊN — nội dung ảnh có thể chứa ':'
  // ("P10 full out: 10.000 tấm") nên phải lấy dấu đầu, không phải dấu cuối.
  const sauNhan = trongKhoi.indexOf(':');
  return (sauNhan >= 0 ? trongKhoi.slice(sauNhan + 1) : trongKhoi).trim();
}

/**
 * Trích lại lời nhân viên để ĐƯA VÀO TIN GỬI RA ("Em vẫn chưa khớp được …").
 *
 * CA THẬT 11:52:46 ngày 12/08 — nhân viên gửi ảnh danh sách hàng viết tay kèm
 * lời "đây lấy từ trong ảnh ra", bot nhắn lại:
 *
 *   Em vẫn chưa khớp được "@Tiểu Mã Nelia đây lấy từ trong ảnh ra
 *   [Khách gửi ảnh, nội dung trong ảnh: P10 f" với nhà cung cấp nào ạ.
 *
 * Câu đó vô nghĩa với người đọc, vì `cauChon.slice(0, 80)` mắc HAI lỗi cùng lúc:
 *
 *   1. Cắt CỨNG ở ký tự thứ 80 — rơi đúng giữa chữ "full" của dòng đầu ảnh
 *      ("P10 full out: 10.000 tấm"). Đo lại: chuỗi trong ca thật dài đúng 80.
 *   2. Không bóc khối `[Khách gửi ảnh…]`. Khối đó là NỘI BỘ, `luong-media` ghép
 *      để model trích slot biết đâu là chữ đọc từ ảnh. Nó không bao giờ được
 *      xuất hiện trong tin gửi cho người.
 *
 * Anh Quốc nhìn câu này tưởng model đọc ảnh hụt, định đổi sang minimax-m3. ĐO
 * RỒI: model đọc ĐỦ cả 20 dòng — chỗ cắt nằm ở phía ta, trong tin gửi ra. Đổi
 * model không chữa được lỗi này. Đừng đi lại đường đó.
 *
 * Nên: bóc khối ảnh, bóc tag bot, rồi cắt ở RANH GIỚI TỪ. Trả chuỗi rỗng thì
 * caller phải bỏ luôn phần trích — hỏi trống còn hơn hỏi bằng câu cụt.
 */
export function trichLoiNhanVien(cau: string, tran = 80): string {
  // BÓC KHỐI ẢNH DÙ NÓ NẰM TRƯỚC HAY SAU LỜI NHẮN (sửa 12/08).
  //
  // Bản cũ giả định khối ảnh luôn ở CUỐI (`<lời nhắn>\n[Khách gửi ảnh…]`) nên
  // chỉ cần `slice(0, batDauKhoi)`. Từ 12/08 `ghepCauTuAnh` đảo lại — ảnh đi
  // TRƯỚC để model đọc kỹ hơn (xem khối lý do ở `luong-media.ts`). Giữ nguyên
  // bản cũ thì `batDauKhoi === 0`, lời nhắn bị vứt sạch và mọi câu "Em vẫn chưa
  // khớp được …" mất phần trích — hỏng đúng thứ nó sinh ra để chữa.
  //
  // Khối ảnh luôn đóng bằng `]` ở CUỐI khối và nội dung ảnh không chứa `]` cuối
  // dòng (mô tả model trả về là text thuần), nên cắt tới dấu `]` cuối cùng là
  // đủ chắc. Không thấy dấu đóng (model trả chuỗi dị) → bỏ từ khối trở đi, giữ
  // hành vi an toàn cũ: thà mất phần trích còn hơn nhả khối nội bộ ra ngoài.
  const batDauKhoi = cau.indexOf('[Khách gửi ảnh');
  let thoCoTag = cau;
  if (batDauKhoi >= 0) {
    const ketKhoi = cau.lastIndexOf(']');
    thoCoTag = ketKhoi > batDauKhoi
      ? `${cau.slice(0, batDauKhoi)} ${cau.slice(ketKhoi + 1)}`
      : cau.slice(0, batDauKhoi);
  }
  // Tag bot ("@Tiểu Mã Nelia") là thứ nhân viên gõ để gọi bot, không phải nội
  // dung — để lại chỉ tổ chiếm chỗ trong 80 ký tự ít ỏi.
  //
  // Mention Zalo là TÊN HIỂN THỊ CÓ DẤU CÁCH, nên `@\S+` sót đuôi. Nhưng nuốt
  // mọi từ viết hoa sau `@` thì ăn lẹm sang lời nhân viên: câu thật
  // "@Tiểu Mã Nelia đây lấy từ trong ảnh ra" mất luôn chữ "đây" (Đ hoa), và
  // "@bot Anh Long Led" mất tên khách — đúng bug 16:15 11/08.
  //
  // Chốt: chỉ bóc ở ĐẦU câu (mention Zalo luôn đứng đầu), và TÁCH HAI NHÁNH —
  // đây là chỗ dễ sai nhất, đã dính khi viết:
  //   `@bot` / `@ai`  → tên trọn vẹn, KHÔNG nuốt thêm gì. Nuốt tiếp là mất tên
  //                     khách: "@bot Anh Long Led" → "Led" (đúng bug 16:15 11/08).
  //   `@Tên Hiển Thị` → tên có dấu cách, nuốt thêm tối đa 2 từ hoa cho đủ
  //                     "Tiểu Mã Nelia", không đủ để lẹm sang câu lệnh.
  // Cùng bài toán mà `laChiCoTag` trong gop-tin.ts đã giải; chỗ này cần giữ
  // phần đuôi nên tách riêng thay vì dùng chung.
  const tho = thoCoTag
    .replace(/^\s*@\s*(?:(?:bot|ai)\b|[\p{Lu}][\p{L}]*(?:\s+[\p{Lu}][\p{L}]*){0,2})/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (tho.length <= tran) return tho;
  // Cắt ở khoảng trắng cuối cùng trước trần. Không có khoảng trắng nào (một từ
  // dài ngoằng) thì đành cắt cứng — nhưng vẫn báo bằng dấu … cho người biết.
  const cat = tho.slice(0, tran);
  const khoangTrang = cat.lastIndexOf(' ');
  return `${(khoangTrang > 0 ? cat.slice(0, khoangTrang) : cat).trimEnd()}…`;
}

/** Xưng hô đầu câu + đuôi lịch sự — bóc ra để lấy phần TÊN thật. */
const XUNG_HO_DAU = /^(?:anh|chị|chi|em|bác|bac|cô|co|chú|chu|ông|ong|bà|ba)\s+/i;
const DUOI_LICH_SU = /\s+(?:nhé|nhe|nha|nhá|ạ|đi|ơi|nè)\.?$/i;

/**
 * Câu trả lời của NV có phải TÊN KHÁCH RÕ HƠN từ khoá đang tra không?
 *
 * Bug thật 16:15 11/08: bot liệt 10 khách "Long", NV gõ "Anh Long Led" — LLM
 * trích lại cắt về "Long" → dapSlot thấy không đổi → không tra lại → bot lặp
 * nguyên danh sách vô hạn. Code phải tự nhận ra: câu NGẮN, CHỨA từ khoá cũ và
 * DÀI HƠN nó nghĩa là nhân viên đang nói rõ thêm tên — dùng nguyên câu (bỏ
 * xưng hô, bỏ đuôi lịch sự) làm từ khoá tra mới, không chờ LLM trích đúng.
 *
 * Cố ý HẸP: câu >6 từ (lệnh dài), không chứa từ khoá cũ ("9999", "ko thấy"),
 * hay y hệt từ khoá cũ → trả null, đi đường khác. Thà bỏ sót còn hơn tra bừa.
 */
export function tachTenRoHon(cau: string, tuKhoaCu: string): string | null {
  let s = cau.trim();
  for (let i = 0; i < 3; i++) s = s.replace(DUOI_LICH_SU, '').trim();
  s = s.replace(XUNG_HO_DAU, '').trim();
  if (!s || s.split(/\s+/).length > 6) return null;
  const sMoi = boDau(s);
  if (!/[a-z]/.test(sMoi)) return null; // toàn số/ký hiệu — không phải tên
  const cu = boDau(tuKhoaCu.trim());
  if (!cu || sMoi === cu || !sMoi.includes(cu)) return null;
  return s;
}

/**
 * Chữ nhân viên nói về kho → id kho thật. Trả null khi không chắc.
 *
 * Map ở CODE, không để model tự điền id: model bịa số là bịa nơi xuất hàng.
 * Nhận cả mã ("HCM", "TT", "KB") lẫn tên ("Hồ Chí Minh", "trung tâm", "kho B")
 * vì nhân viên gõ kiểu nào cũng có.
 */
export function mapKho(noi: string): number | null {
  const s = boDau(noi).replace(/\bkho\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!s) return null;
  for (const k of KHO) {
    const ma = boDau(k.ma);
    const ten = boDau(k.ten);
    // Khớp mã đứng RIÊNG một từ ("hcm", "tt", "kb") hoặc tên chứa nhau.
    if (s.split(' ').includes(ma) || s === ten || ten.includes(s) || s.includes(ten)) return k.id;
  }
  return null;
}

/**
 * ÁP LUẬT CHIẾT KHẤU NV DẶN VÀO PHIÊN — bằng CODE, mỗi phiên một lần.
 *
 * Ca thật 20:31-20:33 12/08 — NGAY sau khi memory luật vừa lên:
 *   20:31  NV : "nhớ là khách Led Kim Long luôn chiết khấu 5%"  → ghi_luat OK
 *   20:32  NV : "lên đơn cho Led Kim Long 10 cái nguồn NB"
 *   20:32  Bot: đơn S13839 = 1.260.000đ — KHÔNG chiết khấu
 *   20:33  NV : "sao không có chiết khấu 5%"
 * Luật nạp vào agent thường, nhưng ĐƠN do máy gom đơn tạo — máy trạng thái
 * không đọc prompt nên luật phải vào bằng CODE: match luật theo TÊN KHÁCH đã
 * chốt, parse "chiết khấu X%" bằng regex trên bản không dấu.
 *
 * Hai ranh giới cố ý:
 *   - Chỉ áp cho dòng CHƯA có chiết khấu: NV nói số khác trong phiên thì số
 *     của NV thắng (cùng luật "giá NV báo thắng giá hệ thống").
 *   - Cờ `daApLuatCk` chốt một lần mỗi phiên: NV xoá tay chiết khấu rồi thì
 *     lượt sau máy không tự điền lại.
 */
/**
 * Tiền tố pháp nhân/xưng hô hay dính vào tên khách Odoo mà nhân viên không
 * bao giờ gõ khi dặn luật: luật nói "Led Kim Long", Odoo lưu "Công Ty Led
 * Kim Long" (đo test 12/08 — match trượt vì chữ "công ty").
 */
const TIEN_TO_TEN = /^(cong ty|cty|tnhh|cua hang|shop|anh|chi|a|c)\s+/;
function lociTenKhach(ten: string): string {
  let t = boDau(ten).trim();
  for (let i = 0; i < 3; i++) {
    const sau = t.replace(TIEN_TO_TEN, '');
    if (sau === t) break;
    t = sau;
  }
  return t;
}

export function apLuatChietKhau(phien: PhienGom, luat: string[] | undefined): boolean {
  if (!luat?.length || phien.daApLuatCk || !phien.khachDaChot) return false;
  const tenKhach = lociTenKhach(phien.khachDaChot.ten);
  if (!tenKhach || tenKhach.split(/\s+/).length < 2) return false; // tên 1 từ quá dễ match nhầm
  let doi = false;
  for (const l of luat) {
    const khongDau = boDau(l);
    // Luật phải NHẮC TỚI khách này: tên khách (đã bóc tiền tố pháp nhân)
    // nằm trong luật. Luật chung chung không tự áp tiền.
    if (!khongDau.includes(tenKhach)) continue;
    const m = khongDau.match(/chiet khau\s+(\d+(?:[.,]\d+)?)\s*%/);
    if (!m) continue;
    const ck = Number(m[1].replace(",", "."));
    if (!Number.isFinite(ck) || ck <= 0 || ck > 100) continue;
    for (const d of phien.dong) {
      if (d.tang || d.chietKhau != null) continue;
      d.chietKhau = ck;
      doi = true;
    }
    phien.daApLuatCk = true;
    logger.info({ ck, khach: phien.khachDaChot.ten }, "[gom-don] áp chiết khấu theo luật NV dặn");
    break;
  }
  return doi;
}

export interface GomDonDeps {
  prisma: DbPhienGomDon;
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
  generate: ToolAwareGenerate;
  /** null = môi trường không render được ảnh — vẫn gửi text + link. */
  anhClient: HoaDonAnhClient | null;
  odooUrl: string;
  guiTin: (text: string) => Promise<void>;
  guiAnhHoaDon: (anh: AnhHoaDon) => Promise<void>;
  ghiLog: (l: ToolCallLog) => void;
  /**
   * Luật NV dặn (12/08) — caller nạp sẵn từ AiGuideline vai='nhanvien'. Máy
   * chỉ ăn các luật PARSE ĐƯỢC BẰNG CODE (hiện: "chiết khấu X%" theo khách);
   * luật chữ tự do là việc của agent thường.
   */
  luatNhanVien?: string[];
  /** Tra alias SP học được — null = chưa học, đi đường tra thường. */
  traAliasSp?: (tuKhoa: string) => Promise<number | null>;
  /** Ghi alias khi NV chọn từ danh sách GẦN ĐÚNG. Best-effort, không chặn luồng. */
  ghiAliasSp?: (v: { tuKhoa: string; productId: number; tenSp: string }) => Promise<void>;
}

/** Đắp kết quả trích LLM vào phiên. Trả true nếu phiên có thay đổi nội dung. */
export function dapSlot(p: PhienGom, trich: KetQuaTrich): boolean {
  let doi = false;
  if (trich.khach && !p.khachDaChot) {
    // Ở chế NHẬP, bỏ tiền tố "nhà cung cấp"/"cty"… trước khi so (11/08).
    //
    // Ca thật 23:16:15: lượt trước đã lưu từ khoá "Trung Quốc", nhân viên đáp
    // "Nhà cung cấp Trung Quốc" — model trả về nguyên văn cả tiền tố. Không bỏ
    // thì hai chuỗi khác nhau → máy tưởng NHÂN VIÊN ĐỔI NHÀ CUNG CẤP, xoá sạch
    // danh sách ứng viên vừa hiện và tra lại từ đầu. Đó chính là lý do lượt kế
    // (gõ mã "NCC000001") không còn danh sách nào để khớp, và bot quay về câu
    // hỏi mở đầu.
    const khachTrich = p.che === 'nhap' ? boTienToNcc(trich.khach) : trich.khach;
    const moi = boDau(khachTrich);
    if (!p.khachTuKhoa || boDau(p.khachTuKhoa) !== moi) {
      // Đổi khách giữa chừng → làm lại phần khách từ đầu, bỏ ứng viên cũ.
      p.khachTuKhoa = khachTrich;
      delete p.khachUngVien;
      delete p.khachUngVienConNua;
      delete p.khachKhongThay;
      doi = true;
    } else if (p.khachKhongThay) {
      // NHẮC LẠI ĐÚNG CÁI TÊN VỪA TRA HỤT → cho tra LẠI (vá 12/08).
      //
      // Ca thật 00:40-00:50: lượt 1 tra "Trung Quốc" hụt (bug tiền tố, đã sửa)
      // nên phiên đọng cờ `khachKhongThay`. Lượt 2 nhân viên nhắc lại đúng tên
      // đó — chuỗi TRÙNG nên nhánh trên không chạy, cờ hụt ở lại, và
      // `buocTiepTheo` nhả thẳng `khong_thay` mà KHÔNG tra lại lần nào.
      // Máy đã sửa được cách tra ở giữa hai lượt cũng vô ích: nó không bao giờ
      // hỏi Odoo lần thứ hai. Xoá cờ để lượt này tra lại thật sự.
      delete p.khachKhongThay;
      doi = true;
    }
  }
  if (trich.khachMoi && !p.khachDaChot) {
    // "khách mới" TRỐNG (không kèm tên): lấy tên đã nhắc ở lượt trước. Bug thật
    // 17:08 10/08 — bot hỏi chọn trong 10 anh Chiến, nhân viên đáp đúng hai chữ
    // "khách mới"; bắt gõ lại tên là vô lý vì họ vừa nói xong ở lượt trên.
    const ten = trich.khachMoi.ten || p.khachTuKhoa || '';
    if (ten) {
      p.khachMoi = { ...trich.khachMoi, ten };
      // Đã chốt là khách MỚI thì danh sách ứng viên cũ vô nghĩa — giữ lại thì
      // buoc-tiep-theo còn thấy `khachUngVien` và hỏi chọn tiếp.
      delete p.khachUngVien;
      delete p.khachKhongThay;
      // NV đưa tên khách mới → dùng luôn làm từ khoá tra (biết đâu đã có sẵn).
      if (!p.khachTuKhoa) p.khachTuKhoa = ten;
      doi = true;
    }
  }
  // BỎ DÒNG (spec 10/08) — chạy TRƯỚC khi thêm: "bỏ 300 thanh led tỏa rồi lên
  // đơn" vừa bỏ vừa nhắc tên món, không xử trước thì nó lại được thêm vào.
  for (const bo of trich.boDong ?? []) {
    const truoc = p.dong.length;
    p.dong = p.dong.filter((x) =>
      !(boDau(x.tuKhoa).includes(boDau(bo)) || boDau(bo).includes(boDau(x.tuKhoa))
        || (x.daChot && boDau(x.daChot.ten).includes(boDau(bo)))));
    if (p.dong.length !== truoc) doi = true;
  }
  for (const d of trich.dong ?? []) {
    // Món vừa bị bỏ trong CHÍNH câu này thì đừng thêm lại.
    if ((trich.boDong ?? []).some((b) => boDau(d.sp).includes(boDau(b)) || boDau(b).includes(boDau(d.sp)))) continue;
    // Dòng TẶNG không bao giờ gộp vào dòng BÁN, kể cả cùng SP: "10 cái ovp k2
    // giá 2300k tặng 1 cái" là hai dòng khác nhau trên đơn. Gộp thì đơn còn
    // đúng 1 cái giá 0đ — mất 10 cái đang bán.
    const cu = p.dong.find(
      (x) => Boolean(x.tang) === Boolean(d.tang)
        && (boDau(x.tuKhoa) === boDau(d.sp) || (x.daChot && boDau(x.daChot.ten).includes(boDau(d.sp)))),
    );
    if (cu) {
      if (d.sl != null && cu.sl !== d.sl) { cu.sl = d.sl; doi = true; }
      // Giá MỚI khác giá cũ → cái gật cho giá lệch trước đó hết hiệu lực.
      // Nhân viên xác nhận "8đ đúng rồi" xong lại báo "2đ" thì phải hỏi lại,
      // không được mượn cái gật cũ (hàng rào 11/08).
      if (d.gia != null && cu.donGia !== d.gia) {
        cu.donGia = d.gia; doi = true;
        delete p.giaLechDaXacNhan;
      }
      if (d.chietKhau != null && cu.chietKhau !== d.chietKhau) { cu.chietKhau = d.chietKhau; doi = true; }
    } else {
      // LUẬT GIÁ CHO DÒNG CHỜ GIÁ (26/08, ca 08:53 Anh Tài): máy vừa hỏi
      // "chưa có giá… báo giá giúp em" cho SP giá ảo; NV đáp "Giá 13k" hay
      // "led thanh toả trắng 12v lixin giá 13k". Model trích ra {sp, gia}
      // nhưng sp có thể là chữ NV gõ, không khớp tên hệ thống ở trên. Câu
      // CHỈ CÓ GIÁ (không SL) mà phiên có ĐÚNG MỘT dòng đang chờ giá thì đó
      // là giá cho dòng ấy — KHÔNG mở dòng mới rồi đi tra một SP nữa.
      const choGia = p.dong.filter(
        (x) => !x.tang && x.daChot && x.sl != null && !x.donGia && x.daChot.gia <= NGUONG_GIA_AO,
      );
      if (d.gia != null && d.sl == null && !d.tang && choGia.length === 1) {
        choGia[0].donGia = d.gia;
        delete p.giaLechDaXacNhan;
        doi = true;
        continue;
      }
      p.dong.push({
        tuKhoa: d.sp, sl: d.sl ?? null,
        ...(d.gia != null ? { donGia: d.gia } : {}),
        ...(d.chietKhau != null ? { chietKhau: d.chietKhau } : {}),
        ...(d.tang ? { tang: true } : {}),
      });
      doi = true;
    }
  }
  // Chiết khấu nói TÁCH RIÊNG một câu ("triết khấu 8% nữa em" — ca thật
  // 03:24:53 11/08) thì áp cho MỌI dòng đang gom: nhân viên nói cho cả đơn.
  //
  // KHÁC HẲN chiết khấu đi liền sau một sản phẩm (`dong[].chietKhau`), thứ chỉ
  // thuộc riêng sản phẩm đó — sửa 11/08 sau khi thấy câu thật
  // "100 thẻ v7512 giá 230k triết khấu 8%. 10 ovp k2 giá 2300k tặng 1 cái":
  // luật cũ áp 8% sang cả ovp k2, bớt nhầm 1.840.000đ.
  //
  // Dòng TẶNG được miễn: chiết khấu trên 0đ vẫn là 0đ, ghi vào chỉ làm bẩn đơn.
  const ckChung = trich.chietKhauDon;
  if (ckChung != null) {
    for (const x of p.dong) {
      if (x.tang) continue;
      if (x.chietKhau !== ckChung) { x.chietKhau = ckChung; doi = true; }
    }
  }
  // PHỤ PHÍ nói trong câu ("thêm 70k ship", "phí lắp đặt 200k") — GỘP theo
  // tên: cùng tên thì lấy số mới nhất (NV sửa "à 50k thôi"), tên mới thì thêm.
  // Ca thật 23:08 24/08: thiếu ô này nên "thêmm 70k ship" bị vứt lặng lẽ.
  for (const phi of trich.phuPhi ?? []) {
    const ds = (p.phuPhi ??= []);
    const cu = ds.find((x) => x.ten.toLowerCase() === phi.ten.toLowerCase());
    if (cu) {
      if (cu.tien !== phi.tien) { cu.tien = phi.tien; doi = true; }
    } else {
      ds.push({ ten: phi.ten, tien: phi.tien });
      doi = true;
    }
  }
  // KHO nhân viên nói trong câu ("kho HCM") → map mã/tên sang id qua bảng KHO.
  // Map ở CODE chứ không tin số model tự bịa: sai kho là xuất hàng sai nơi.
  //
  // Đây là ĐƯỜNG DUY NHẤT đặt kho từ 11/08: máy không hỏi kho nữa (anh Quốc
  // "không cần hỏi nhân viên luôn"), nên kho chỉ đổi khi NV chủ động nói.
  if (trich.kho) {
    const moi = mapKho(trich.kho);
    if (moi != null) {
      if (p.khoId !== moi) { p.khoId = moi; doi = true; }
      if (p.khoKhongRo) { delete p.khoKhongRo; doi = true; }
    } else if (p.khoKhongRo !== trich.kho) {
      // Không map được ("kho Đà Nẵng") → GIỮ LẠI để tóm tắt báo rõ. Nuốt im
      // thì NV tưởng xuất kho họ nói, thực tế Odoo lấy TT.
      p.khoKhongRo = trich.kho;
      doi = true;
    }
  }

  // Câu chỉ có SL ("10 cái") — LLM được dặn gắn vào món đang thiếu; nếu nó trả
  // dòng trùng tên món cũ thì nhánh trên đã xử. Không tự đoán gì thêm ở đây.
  return doi;
}

/** Field đọc từ sale.order khi tìm đơn để sửa. */
const FIELDS_DON_SUA = ['id', 'name', 'state', 'amount_total', 'create_date'];

/**
 * Tìm đơn NHÁP để sửa. Nói mã → đúng đơn đó; không nói → mọi đơn nháp của
 * CHÍNH hội thoại này (khoá idempotency), mới nhất trước.
 *
 * Không bao giờ với sang đơn ngoài hội thoại khi NV không nói mã — cùng lý do
 * với xuat_hoa_don: sửa nhầm đơn người khác là dữ liệu bẩn khó dò.
 */
async function timDonNhap(
  deps: GomDonDeps,
  conversationId: string,
  maDon?: string,
  loai: 'ban' | 'mua' = 'ban',
): Promise<DonSua[]> {
  // PHIẾU NHẬP cũng sửa được qua chat (16/08, ca P04525): đơn mua nằm ở
  // purchase.order, khoá idempotency nhét trong `origin` (xem tao-don-mua).
  const bang = loai === 'mua' ? 'purchase.order' : 'sale.order';
  const cotKhoa = loai === 'mua' ? 'origin' : 'client_order_ref';
  const loc = (rows: Array<Record<string, unknown>>): DonSua[] =>
    rows
      .filter((r) => ['draft', 'sent'].includes(String(r.state ?? '')))
      .map((r) => ({ id: Number(r.id), ma: String(r.name ?? ''), tong: Number(r.amount_total ?? 0), loai }));

  if (maDon) {
    const r = await deps.odoo.searchRead<Record<string, unknown>>(
      bang, [['name', '=', maDon]], FIELDS_DON_SUA, { limit: 1 },
    );
    return loc(r);
  }
  const r = await deps.odoo.searchRead<Record<string, unknown>>(
    bang,
    [[cotKhoa, 'like', `${IDEMPOTENCY_PREFIX}:${conversationId}:%`]],
    FIELDS_DON_SUA,
    { limit: 5, order: 'create_date desc' },
  );
  return loc(r);
}

/** Chạy các tra cứu của hành động tra_cuu SONG SONG, đắp kết quả vào phiên. */
async function chayTraCuu(
  deps: GomDonDeps,
  p: PhienGom,
  hd: Extract<HanhDong, { loai: 'tra_cuu' }>,
  ctx: { conversationId: string; maDon?: string; loaiDon?: 'ban' | 'mua' },
): Promise<void> {
  const viec: Array<Promise<void>> = [];
  if (hd.don) {
    viec.push((async () => {
      const ds = await timDonNhap(deps, ctx.conversationId, ctx.maDon, ctx.loaiDon ?? 'ban');
      if (ds.length === 1) {
        p.donSua = ds[0];
        // NẠP DÒNG THẬT của đơn (14/08, ca 22:32): "giá 175k đó" / "sửa giá
        // nguồn" chỉ xử được khi máy BIẾT đơn đang có dòng nào — SL giữ theo
        // đơn, không bắt NV đọc lại. Lỗi nạp không chặn sửa: thiếu dòng thì
        // các đường tắt sửa-giá đơn giản tự tắt, luồng sửa thường vẫn chạy.
        try {
          const laMua = ds[0].loai === 'mua';
          const lines = await deps.odoo.searchRead<Record<string, unknown>>(
            laMua ? 'purchase.order.line' : 'sale.order.line', [['order_id', '=', ds[0].id]],
            ['product_id', laMua ? 'product_qty' : 'product_uom_qty', 'price_unit'], { limit: 40 },
          );
          p.donSua.dong = lines
            .filter((l) => Array.isArray(l.product_id))
            .map((l) => ({
              spId: Number((l.product_id as [number, string])[0]),
              ten: String((l.product_id as [number, string])[1] ?? ''),
              sl: Number((laMua ? l.product_qty : l.product_uom_qty) ?? 0),
              gia: Number(l.price_unit ?? 0),
            }));
        } catch (err) {
          logger.warn({ err, donId: ds[0].id }, '[gom-don] nạp dòng đơn sửa lỗi — đường tắt sửa giá tắt');
        }
      }
      else if (ds.length > 1) p.donUngVien = ds;
      else p.donKhongThay = true;
    })());
  }
  // NHÀ CUNG CẤP (chế 'nhap', 11/08) — tra res.partner supplier_rank>0.
  //
  // Nhánh RIÊNG chứ không dùng lại nhánh khách: hai tập partner khác nhau và có
  // tên trùng nhau. Đo prod 11/08: "TRung Quốc" [KH001046] là KHÁCH nằm cạnh
  // "Trung Quốc" [NCC000001] là NCC (supplier_rank=5). Tra nhầm tập là treo
  // phiếu nhập vào một khách hàng.
  //
  // KHÔNG có nhánh tự chốt như khách (`tuChot`): NCC ít và cố định, mà chốt
  // nhầm NCC thì công nợ phải trả treo sai người. Nhiều kết quả thì hỏi.
  if (hd.ncc) {
    viec.push((async () => {
      const t0 = Date.now();
      const kq = await traNhaCungCap({ odoo: deps.odoo }, { ten: hd.ncc });
      deps.ghiLog({
        toolName: 'tra_nha_cung_cap', input: { ten: hd.ncc }, output: dinhDangNhaCungCap(kq),
        thanhCong: true, durationMs: Date.now() - t0, iteration: 0,
      });
      if (kq.trangThai === 'tim_thay') {
        p.khachDaChot = { id: kq.ncc.id, ten: kq.ncc.ten, ma: kq.ncc.ma, dienThoai: null };
        delete p.khachUngVienConNua;
      } else if (kq.trangThai === 'nhieu_ket_qua' && kq.tuChot) {
        // TỰ CHỐT NCC khi có tên khớp gần nguyên văn và áp đảo hẳn — cùng luật
        // với khách hàng (xepHangKhach), theo yêu cầu anh Quốc 23:17 11/08
        // "dùng luôn tính năng tìm khách hàng áp dụng qua đi".
        //
        // An toàn vì hàng rào giuThuTuTu vẫn chạy: còn NCC nào "cùng kiểu tên"
        // là không chốt, hỏi. Ca "Trung Quốc" có 2 NCC cùng bắt đầu bằng "Trung
        // Quốc" nên VẪN HỎI — đúng ý đồ, chốt nhầm là treo công nợ phải trả sai.
        // Và `khachTuChot` bắt tóm tắt phải nói rõ đã lấy ai để nhân viên soát.
        p.khachDaChot = { id: kq.tuChot.id, ten: kq.tuChot.ten, ma: kq.tuChot.ma, dienThoai: null };
        p.khachTuChot = true;
        delete p.khachUngVienConNua;
      } else if (kq.trangThai === 'nhieu_ket_qua') {
        // Ép về hình dạng KhachHang để dùng chung `apDungChon` + `renderLoiNhan`.
        p.khachUngVien = kq.danhSach.map((n) => ({
          id: n.id, ten: n.ten, ma: n.ma, dienThoai: null, congNo: 0,
        }));
        if (kq.conNua) p.khachUngVienConNua = true;
        else delete p.khachUngVienConNua;
      } else {
        p.khachKhongThay = true;
        delete p.khachUngVienConNua;
      }
    })());
  }
  if (hd.khach) {
    viec.push((async () => {
      const t0 = Date.now();
      const kq = await traKhachHang({ odoo: deps.odoo }, { ten: hd.khach });
      deps.ghiLog({
        toolName: 'tra_khach_hang', input: { ten: hd.khach }, output: dinhDangKhachHang(kq),
        thanhCong: true, durationMs: Date.now() - t0, iteration: 0,
      });
      if (kq.trangThai === 'tim_thay') {
        p.khachDaChot = { id: kq.khach.id, ten: kq.khach.ten, ma: kq.khach.ma, dienThoai: kq.khach.dienThoai };
        delete p.khachUngVienConNua;
      } else if (kq.trangThai === 'nhieu_ket_qua' && kq.tuChot) {
        // TỰ CHỐT khi có người khớp GẦN NGUYÊN VĂN và áp đảo hẳn (21:56 11/08).
        //
        // Ca thật: NV gõ "a Long led" → 8 khách, nhưng chỉ "Anh Long Led"
        // (KH000117) khớp nguyên văn, 7 người kia chỉ tình cờ trùng chữ "Long"
        // hoặc "Led" rời rạc ("Led Kim Long", "Led Hoàng Long"). Bắt chọn giữa
        // 8 cái tên trong đó 7 cái khác hẳn là làm phiền vô ích.
        //
        // Luật quyết định nằm trong xepHangKhach() — nó ĐÒI không còn ai "cùng
        // kiểu tên" mới cho chốt, nên ca bẫy "Cảnh tam kỳ" vẫn rơi xuống nhánh
        // hỏi bên dưới. Chốt nhầm khách nguy hiểm hơn bắt chọn.
        p.khachDaChot = {
          id: kq.tuChot.id, ten: kq.tuChot.ten, ma: kq.tuChot.ma, dienThoai: kq.tuChot.dienThoai,
        };
        // Đánh dấu để tóm tắt NÓI RÕ đã tự lấy ai — tuyệt đối không chốt im lặng.
        p.khachTuChot = true;
        delete p.khachUngVienConNua;
      } else if (kq.trangThai === 'nhieu_ket_qua') {
        p.khachUngVien = kq.danhSach;
        // Chạm trần → danh sách CHƯA ĐỦ, loi-nhan phải nói rõ (bug 16:15 11/08).
        if (kq.conNua) p.khachUngVienConNua = true;
        else delete p.khachUngVienConNua;
      } else {
        p.khachKhongThay = true;
        delete p.khachUngVienConNua;
      }
    })());
  }
  for (const tuKhoa of hd.sp) {
    const dong = p.dong.find((d) => boDau(d.tuKhoa) === boDau(tuKhoa) && !d.daChot && !d.ungVien && !d.khongThay);
    if (!dong) continue;
    viec.push((async () => {
      const t0 = Date.now();
      // ALIAS HỌC ĐƯỢC (P1.3) đi trước: NV từng chọn tên gọi này rồi thì khớp
      // thẳng — đọc lại tên/giá từ Odoo theo id, KHÔNG tin cache alias.
      if (deps.traAliasSp) {
        const aliasId = await deps.traAliasSp(tuKhoa);
        if (aliasId != null) {
          const sp = await deps.odoo.searchRead<Record<string, unknown>>(
            'product.product',
            [['id', '=', aliasId], ['active', '=', true], ['sale_ok', '=', true]],
            ['id', 'name', 'list_price'], { limit: 1 });
          // BIẾN THỂ XUNG KHẮC → KHÔNG tin alias (ca 06:05 13/08): alias học
          // sai "3b 6214 trắng ấm"→"…trắng (thanh)" tự chốt im lặng 3000 cái
          // sai màu vào S13848. Từ khoá nói "ấm" mà tên SP không có "ấm" thì
          // rơi xuống đường tra thường — nó sẽ liệt kê để NV chọn, và lựa
          // chọn mới ĐÈ alias cũ (ghiAliasSp upsert) — alias sai tự lành.
          if (sp.length && !xungDotBienThe(tuKhoa, String(sp[0].name ?? ''))) {
            dong.daChot = { id: Number(sp[0].id), ten: String(sp[0].name ?? ''), gia: Number(sp[0].list_price ?? 0) };
            deps.ghiLog({
              toolName: 'tra_san_pham', input: { ten: tuKhoa },
              output: `[alias học được] ${tuKhoa} → ${String(sp[0].name)}`,
              thanhCong: true, durationMs: Date.now() - t0, iteration: 0,
            });
            return;
          }
          if (sp.length) {
            logger.info(
              { tuKhoa, tenAlias: String(sp[0].name ?? '') },
              '[gom-don] alias có biến thể xung khắc — bỏ qua, tra thường',
            );
          }
          // SP của alias đã archive/đổi (hoặc xung khắc) — đi đường thường.
        }
      }
      const list = await traSanPham({ odoo: deps.odoo }, { ten: tuKhoa });
      deps.ghiLog({
        toolName: 'tra_san_pham', input: { ten: tuKhoa }, output: dinhDangSanPham(list, tuKhoa),
        thanhCong: true, durationMs: Date.now() - t0, iteration: 0,
      });
      // GẦN ĐÚNG (P1.2, 12/08): kết quả đến từ đường nới (tên gọi khác catalog
      // — "Led hắt 6313" ra "3 Bóng Saso 6313") thì DÙ CHỈ MỘT kết quả cũng
      // phải HỎI, không tự chốt: tự chốt hàng gần đúng là lên đơn sai mặt hàng.
      const meta = list as import('../../../odoo/tools/tra-san-pham.js').SanPhamList;
      // MỌI kết quả từ ĐƯỜNG NỚI đều phải HỎI, kể cả 1 kết quả (siết 22:06
      // 12/08 — CÓ CHỦ Ý, khác lần siết mù đã revert buổi tối): "P10 Full Out
      // 260626" nới-OR ra đúng 1 SP "P10 3 màu LLR 260409" giá 170k và TỰ
      // CHỐT — 10.000 tấm nhầm mặt hàng là 1,7 tỷ tiền sai. Hỏi thêm một
      // lượt rẻ hơn vô hạn so với nhập nhầm kho.
      const ganDung = meta.ganDung === true || meta.daNoiRong === true;
      if (list.length === 1 && !ganDung) {
        dong.daChot = { id: list[0].id, ten: list[0].ten, gia: list[0].gia };
      } else if (list.length >= 1) {
        dong.ungVien = list;
        // Sao lại để lúc chốt còn soi được "3 ứng viên này có phải cùng một
        // mặt hàng khác màu không" — quyết định học/không học alias.
        dong.ungVienDaHoi = list.map((x) => ({ id: x.id, ten: x.ten, gia: x.gia }));
        // Đáng học alias khi kết quả đến từ BẤT KỲ đường nới nào — tên gọi
        // của NV lệch catalog thật sự, lựa chọn của họ là tri thức.
        if (ganDung || meta.daNoiRong === true) dong.ungVienGanDung = true;
      } else {
        // GỢI Ý GẦN GIỐNG khi tay trắng (yêu cầu anh Quốc 22:06 12/08: "phải
        // gạch đầu dòng những sản phẩm đó rồi tra trong dữ liệu xem có sản
        // phẩm nào gần giống không thì gợi ý"). Ca thật: ảnh ghi "P10 Full
        // Out 260626" — 260626 là SỐ LÔ, catalog lưu lô cũ "...LLR 260330".
        // Bỏ mã số thuần dài (≥6 = số lô/ngày, không phải mã dòng hàng) rồi
        // tra lại "P10 Full Out" → ra ứng viên thật để CHỌN thay vì bó tay.
        // Kết quả vào ungVien + cờ học alias — chọn xong lần sau khớp thẳng.
        const tenBoLo = tuKhoa.replace(/\b\d{6,}\b/g, ' ').replace(/\s{2,}/g, ' ').trim();
        if (tenBoLo && tenBoLo !== tuKhoa && /[a-zà-ỹ]/i.test(tenBoLo)) {
          const goiY = await traSanPham({ odoo: deps.odoo }, { ten: tenBoLo });
          if (goiY.length) {
            dong.ungVien = goiY;
            dong.ungVienDaHoi = goiY.map((x) => ({ id: x.id, ten: x.ten, gia: x.gia }));
            dong.ungVienGanDung = true;
            deps.ghiLog({
              toolName: 'tra_san_pham', input: { ten: tenBoLo },
              output: `[gợi ý gần giống, bỏ số lô] ${dinhDangSanPham(goiY, tenBoLo)}`,
              thanhCong: true, durationMs: Date.now() - t0, iteration: 0,
            });
            return;
          }
        }
        dong.khongThay = true;
      }
    })());
  }
  await Promise.all(viec);

  // KHÔNG tra tồn theo kho ở đây nữa (bỏ 11/08 cùng câu hỏi kho).
  //
  // Vòng tra `tra_ton_kho` từng chạy chỗ này chỉ để biết hàng có nằm nhiều kho
  // không, tức chỉ phục vụ câu hỏi kho. Anh Quốc bỏ câu hỏi đó ("mặc định là
  // lấy kho TT nhé, không cần hỏi nhân viên luôn") nên vòng tra thành vô dụng —
  // và nó tốn một round-trip Odoo cho MỖI dòng hàng của MỌI đơn lên.
}

/** Tạo đơn + gửi báo giá (ảnh khi có, link luôn luôn) cho nhân viên. */
async function taoDonVaBaoGia(
  deps: GomDonDeps,
  p: PhienGom,
  input: { orgId: string; conversationId: string; seq: number },
  /**
   * Lượt này đã BỎ một phiên gom dở để bắt đầu việc mới → phải báo.
   *
   * Trước 11/08 câu báo đó luôn đi kèm một hành động NÓI (tóm tắt/hỏi), nên nó
   * nằm ở nhánh render cuối. Bỏ bước chốt thì lượt đè phiên có thể đi thẳng ra
   * đơn — im lặng ở đây là nhân viên không biết đơn nháp cũ đã bị bỏ.
   */
  daBoPhienCu = false,
): Promise<'xong' | 'loi'> {
  const dong = p.dong
    .filter((d) => d.daChot && d.sl != null)
    .map((d) => ({
      san_pham_id: d.daChot!.id,
      so_luong: d.sl!,
      // Giá NV báo thắng giá hệ thống (anh Quốc chốt 10/08).
      ...(d.donGia ? { don_gia: d.donGia } : {}),
      // Chiết khấu nói ngay lúc lên đơn (11/08) — không bắt nhắc lượt thứ hai.
      ...(d.chietKhau ? { chiet_khau: d.chietKhau } : {}),
      // Hàng tặng (11/08): tool ghi giá 0đ + gắn "(tặng)" vào tên dòng.
      ...(d.tang ? { tang: true } : {}),
    }));
  const t0 = Date.now();
  const donVao = {
    khach_hang_id: p.khachDaChot!.id, dong, y_dinh: 'moi' as const, ten_khach: p.khachDaChot!.ten,
    // Không chốt kho → KHÔNG gửi field, Odoo tự lấy kho mặc định (đúng 291/300 đơn).
    ...(p.khoId != null ? { kho_id: p.khoId } : {}),
    // VAT: chỉ gửi khi TRA ĐƯỢC id thật trong account.tax. Tra không ra
    // (vatKhongTra) thì lên đơn KHÔNG thuế — nhưng tóm tắt đã báo rõ cho nhân
    // viên trước đó, không im lặng.
    ...(p.vatThueId != null ? { thue_id: p.vatThueId } : {}),
    // PHỤ PHÍ (24/08): mỗi khoản một dòng ở CUỐI đơn — "thêm 70k ship".
    ...(p.phuPhi?.length ? { phu_phi: p.phuPhi } : {}),
  };
  const kq = await taoDonNhap(
    {
      odoo: deps.odoo, conversationId: input.conversationId,
      // KHOÁ CHỐNG TRÙNG THEO VIỆC, KHÔNG THEO TIN (vá 12/08).
      //
      // Ca thật 11:15-11:16 12/08: hai tin "đúng rồi" cách 8 giây → hai `seq`
      // khác nhau → hai khoá khác nhau → Odoo nhận CẢ HAI lệnh create, ra
      // S13834 (id 26751) và S13835 (id 26752) trùng hoàn toàn.
      //
      // `p.viecId` do phiên giữ, không đổi theo tin, nên mọi lượt xác nhận của
      // cùng một phiên ghi ra CÙNG khoá và lượt sau nhận `da_ton_tai`. Phiên
      // cũ trong DB chưa có ô này thì rơi về `input.seq` như trước — không cần
      // migrate. ĐỪNG đổi ngược lại: xem PhienGom.viecId.
      seq: p.viecId ?? input.seq,
      choPhepDatGia: true,
      // Nhân viên đã trả lời câu hỏi giá lệch ở máy gom đơn rồi → đừng bắt họ
      // xác nhận lần thứ hai ở cổng tool. Hỏi hai lần cho cùng một con số là
      // kiểu bot "điếc" mà hàng rào này sinh ra để tránh.
      ...(p.giaLechDaXacNhan ? { xacNhanGiaLech: true } : {}),
    },
    donVao,
  );
  deps.ghiLog({
    toolName: 'tao_don_nhap',
    input: { khach_hang_id: p.khachDaChot!.id, dong, ten_khach: p.khachDaChot!.ten },
    output: dinhDangTaoDon(kq, true),
    thanhCong: kq.trangThai !== 'loi', durationMs: Date.now() - t0, iteration: 0,
  });

  if (kq.trangThai === 'loi') {
    await deps.guiTin(`Không tạo được đơn: ${kq.lyDo}`);
    return 'loi'; // giữ phiên — NV sửa thông tin rồi chốt lại được
  }
  if (kq.trangThai === 'da_ton_tai') {
    await deps.guiTin(`Đơn này đã tạo trước đó rồi: ${kq.maDon}. Link xử lý: ${linkXuLyDon(deps.odooUrl, kq.donId)}`);
    return 'xong';
  }

  const tong = kq.tongTien.toLocaleString('vi-VN');
  // Ảnh báo giá: cố gắng render, hỏng thì vẫn phải có text + link (nếp
  // luong-nhan-vien: "gửi link DÙ ảnh lỗi").
  let daGuiAnh = false;
  if (deps.anhClient) {
    try {
      const hd = await guiHoaDon(
        { odoo: deps.odoo, anhClient: deps.anhClient, odooUrl: deps.odooUrl },
        { don_id: kq.donId },
      );
      if (hd?.anh) { await deps.guiAnhHoaDon(hd.anh); daGuiAnh = true; }
    } catch (err) {
      logger.warn({ err, donId: kq.donId }, '[gom-don] render/gửi ảnh báo giá lỗi (vẫn gửi link)');
    }
  }
  // TÓM TẮT ĐI KÈM TIN BÁO ĐƠN (11/08).
  //
  // Bỏ bước hỏi chốt thì tóm tắt mất chỗ đứng cũ — nhưng KHÔNG được mất luôn.
  // Nhân viên vẫn phải thấy bot hiểu gì: khách nào (kèm mã KH), từng dòng
  // hàng, giá họ báo khi lệch giá hệ thống, chiết khấu, tặng kèm, VAT, tổng.
  // Chỉ đổi thời điểm soát: trước đây soát rồi mới gật cho ghi; giờ ghi rồi
  // soát — đơn là đơn NHÁP, thấy sai thì nói "sửa đơn" là máy sửa ngay.
  //
  // Gộp vào MỘT tin thay vì gửi hai: hai tin liên tiếp trên Zalo dễ bị đọc
  // nhảy cóc, mà đây là một chuyện duy nhất — "đây là đơn em hiểu, và em đã
  // lên nó rồi".
  await deps.guiTin(
    `${daBoPhienCu ? 'Em bỏ đơn đang gom dở nhé.\n' : ''}` +
    `${renderLoiNhan({ loai: 'tom_tat_don' }, p)}\n` +
    `Em đã lên đơn nháp ${kq.maDon} cho ${p.khachDaChot!.ten}, tổng ${tong}đ.` +
    `${daGuiAnh ? ' Báo giá ở ảnh trên.' : ''} Link xử lý: ${linkXuLyDon(deps.odooUrl, kq.donId)}` +
    '\nSai chỗ nào anh/chị nhắn "sửa đơn ..." em sửa ngay ạ.',
  );
  p.daXong = { maDon: kq.maDon, tenKhach: p.khachDaChot!.ten };
  return 'xong';
}

/**
 * Tạo PHIẾU NHẬP HÀNG (đơn mua) rồi báo mã + link cho nhân viên.
 *
 * Ca thật 22:09-22:11 ngày 11/08 (nhóm Test-AI) — thứ hàm này sinh ra để sửa:
 *   NV : "@bot rồi tạo phiếu nhập hàng giúp tôi luôn"
 *   Bot: "em ... chưa có tool tạo phiếu nhập hàng (mua hàng)"
 *   NV : "1 đơn hàng của hàng cung cấp trung quốc, 2 Màn hình LED: P10 full
 *         out: 10.000 tấm..."   (13 dòng hàng)
 *   Bot: "tính năng này nằm ngoài phạm vi em hỗ trợ"
 *
 * KHÔNG gửi ảnh như đơn bán: `guiHoaDon` render báo giá BÁN cho khách. Phiếu
 * nhập là chứng từ nội bộ với NCC, không có "báo giá" nào để gửi — và phần lớn
 * dòng chưa có giá nên ảnh sẽ toàn số 0, gây hiểu nhầm hơn là giúp.
 */
async function taoPhieuNhapVaBao(
  deps: GomDonDeps,
  p: PhienGom,
  input: { conversationId: string; seq: number },
  daBoPhienCu = false,
): Promise<'xong' | 'loi'> {
  const dong = p.dong
    .filter((d) => d.daChot && d.sl != null)
    .map((d) => ({
      san_pham_id: d.daChot!.id,
      so_luong: d.sl!,
      // GIÁ NHẬP, KHÔNG phải giá bán. `d.donGia` là con số nhân viên đọc ra
      // trong câu — ở chế 'nhap' nó mang nghĩa giá NCC bán cho shop. Không có
      // thì KHÔNG gửi field, để Odoo ghi 0 và người điền sau (phiếu nháp).
      // TUYỆT ĐỐI không lấy `d.daChot.gia` (giá bán) làm giá nhập.
      ...(d.donGia ? { gia_nhap: d.donGia } : {}),
    }));
  const t0 = Date.now();

  // CHỐNG PHIẾU TRÙNG NỘI DUNG (17/08, ca P04528→P04531: CÙNG một ảnh danh
  // sách gửi lại 4 lần = 4 phiếu nháp giống hệt). Khoá viecId chỉ chặn trùng
  // TRONG một phiên; mỗi lần gửi lại ảnh là phiên mới, khoá mới. Ở đây so
  // NỘI DUNG: có phiếu NHÁP cùng hội thoại trùng HỆT tập (sản phẩm, SL) →
  // báo phiếu cũ thay vì đẻ bản sao. Muốn thêm phiếu thật sự giống hệt
  // (hiếm) thì nói "tạo phiếu nhập MỚI" — cờ choPhepTrung mở đường.
  // NV nói rõ "tạo phiếu MỚI" → nhường, không so trùng (không đi đường throw
  // kẻo log WARN đọc như lỗi trong khi là chủ ý của người).
  if (!p.choPhepTrung) try {
    const nhap2h = await timDonNhap(deps, input.conversationId, undefined, 'mua');
    const boMoi = dong.map((d) => `${d.san_pham_id}x${d.so_luong}`).sort().join('|');
    for (const cu2 of nhap2h.slice(0, 3)) {
      const lines = await deps.odoo.searchRead<Record<string, unknown>>(
        'purchase.order.line', [['order_id', '=', cu2.id]], ['product_id', 'product_qty'], { limit: 60 },
      );
      const boCu = lines
        .filter((l) => Array.isArray(l.product_id))
        .map((l) => `${Number((l.product_id as [number, string])[0])}x${Number(l.product_qty ?? 0)}`)
        .sort().join('|');
      if (boCu && boCu === boMoi) {
        await deps.guiTin(
          `Phiếu nhập với ĐÚNG các dòng này đã có rồi: ${cu2.ma} (đang nháp) — em không tạo bản trùng. ` +
          `Anh/chị sửa tiếp thì nhắn "sửa phiếu nhập ${cu2.ma} ..." hoặc "<tên hàng> giá nhập <giá>"; ` +
          'thật sự cần thêm một phiếu giống hệt thì nhắn "tạo phiếu nhập mới" ạ.',
        );
        p.daXong = { maDon: cu2.ma, tenKhach: p.khachDaChot?.ten ?? '' };
        return 'xong';
      }
    }
  } catch (err) {
    logger.warn({ err }, '[gom-don] so trùng nội dung phiếu lỗi — vẫn tạo như thường');
  }

  const vao = {
    nha_cung_cap_id: p.khachDaChot!.id,
    ten_ncc: p.khachDaChot!.ten,
    dong,
  };
  const kq = await taoDonMua(
    {
      odoo: deps.odoo, conversationId: input.conversationId,
      // CÙNG BỆNH với đơn bán — xem chú thích ở `taoDonVaBaoGia`. Phiếu nhập
      // cũng chốt bằng câu xác nhận ngắn ("ok", "đúng rồi"), nên hai tin cùng ý
      // cách vài giây cũng đẻ ra hai PHIẾU NHẬP trùng nếu khoá vẫn theo tin.
      // Khoá theo VIỆC (phiên) thì lượt sau nhận `da_ton_tai`.
      seq: p.viecId ?? input.seq,
    },
    vao,
  );
  deps.ghiLog({
    toolName: 'tao_don_mua', input: vao, output: dinhDangTaoDonMua(kq),
    thanhCong: kq.trangThai !== 'loi', durationMs: Date.now() - t0, iteration: 0,
  });

  if (kq.trangThai === 'loi') {
    await deps.guiTin(`Không tạo được phiếu nhập: ${kq.lyDo}`);
    return 'loi'; // giữ phiên — NV sửa thông tin rồi làm lại được
  }
  if (kq.trangThai === 'da_ton_tai') {
    await deps.guiTin(
      `Phiếu nhập này đã tạo trước đó rồi: ${kq.maDon}. Link: ${linkXuLyDonMua(deps.odooUrl, kq.donId)}`,
    );
    return 'xong';
  }

  const hang = p.dong
    .filter((d) => d.daChot && d.sl != null)
    .map((d) => `- ${d.daChot!.ten} × ${d.sl!.toLocaleString('vi-VN')}` +
      (d.donGia ? ` × ${d.donGia.toLocaleString('vi-VN')}đ` : ' (chưa có giá nhập)'))
    .join('\n');
  // NÓI RÕ số dòng chưa có giá: để trống là quyết định có chủ ý (phiếu nháp,
  // điền sau) nhưng im lặng về nó thì thành bẫy — kế toán nhận phiếu 0đ mà
  // không ai biết cần điền.
  const thieuGia = kq.soDongChuaCoGia > 0
    ? `\n${kq.soDongChuaCoGia}/${kq.soDong} dòng chưa có giá nhập — anh/chị vào link điền giá giúp em ạ.`
    : '';
  await deps.guiTin(
    `${daBoPhienCu ? 'Em bỏ việc đang làm dở nhé.\n' : ''}` +
    `Phiếu nhập hàng ${kq.maDon} — NCC ${p.khachDaChot!.ten}:\n${hang}\n` +
    `Em đã tạo phiếu NHÁP, chưa nhập kho và chưa ghi công nợ.${thieuGia}\n` +
    `Link kiểm tra rồi bấm Xác nhận: ${linkXuLyDonMua(deps.odooUrl, kq.donId)}`,
  );
  // Ảnh phiếu nhập — cùng lễ nghi với đơn bán (anh Quốc 22:41 16/08).
  await guiAnhPhieuNhap(deps, kq.donId, kq.maDon);
  p.daXong = { maDon: kq.maDon, tenKhach: p.khachDaChot!.ten };
  return 'xong';
}

/**
 * Gửi ẢNH phiếu nhập (report purchase chuẩn của Odoo) — best-effort, lỗi chỉ
 * log: text + link đã đi trước, thiếu ảnh không được chặn luồng.
 */
async function guiAnhPhieuNhap(deps: GomDonDeps, donId: number, maDon: string): Promise<void> {
  // TỰ VẼ, không qua report Odoo (16/08): prod không có report custom cho
  // purchase — render report ra "Yêu cầu báo giá" chuẩn Odoo, anh Quốc: "ủa
  // phiếu này đâu phải phiếu custom của tôi". Bộ vẽ bảng anh-bang là của mình.
  try {
    const anh = await anhPhieuNhap(deps.odoo, donId);
    if (anh) await deps.guiAnhHoaDon(anh);
  } catch (err) {
    logger.warn({ err, donId, maDon }, '[gom-don] vẽ/gửi ảnh phiếu nhập lỗi (đã có text+link)');
  }
}

/** Sửa PHIẾU NHẬP nháp — cặp đôi với suaDonVaBao của đơn bán (16/08). */
async function suaPhieuNhapVaBao(deps: GomDonDeps, p: PhienGom): Promise<'xong' | 'loi'> {
  const don = p.donSua!;
  const doi = p.dong
    .filter((d) => d.daChot && d.sl != null)
    .map((d) => ({
      san_pham_id: d.daChot!.id,
      so_luong: d.sl!,
      // donGia ở chế nhập là GIÁ NHẬP nhân viên báo — tool giữ nguyên khi thiếu.
      ...(d.donGia ? { gia_nhap: d.donGia } : {}),
    }));
  const t0 = Date.now();
  const kq = await suaDonMua({ odoo: deps.odoo }, { don_id: don.id, doi });
  deps.ghiLog({
    toolName: 'sua_don_mua', input: { don_id: don.id, doi },
    output: dinhDangSuaDonMua(kq), thanhCong: kq.ok,
    durationMs: Date.now() - t0, iteration: 0,
  });
  if (!kq.ok) {
    await deps.guiTin(`Không sửa được phiếu nhập ${don.ma}: ${kq.lyDo ?? 'Odoo từ chối'}`);
    return 'loi';
  }
  const mon = p.dong
    .filter((d) => d.daChot && d.sl != null)
    .map((d) => `${d.sl!.toLocaleString('vi-VN')} × ${d.daChot!.ten}${d.donGia ? ` @ ${d.donGia.toLocaleString('vi-VN')}đ` : ''}`)
    .join(', ');
  await deps.guiTin(
    `Đã sửa phiếu nhập ${kq.maDon}: ${mon}. ` +
    `Tổng ${(kq.tongTruoc ?? 0).toLocaleString('vi-VN')}đ → ${(kq.tongSau ?? 0).toLocaleString('vi-VN')}đ. ` +
    `Link: ${linkXuLyDonMua(deps.odooUrl, kq.donId)}`,
  );
  // Ảnh phiếu nhập sau sửa — cùng lễ nghi với đơn bán (anh Quốc 22:41 16/08:
  // "cũng chưa gửi được hình hóa đơn lên như bán hàng á"). Best-effort.
  await guiAnhPhieuNhap(deps, kq.donId, kq.maDon);
  p.daXong = { maDon: kq.maDon, tenKhach: p.khachDaChot?.ten ?? '' };
  return 'xong';
}

/**
 * Sửa đơn nháp: gọi tool suaDon rồi báo bằng SỐ THẬT (tool đọc lại từ Odoo),
 * kèm ảnh báo giá mới. Không hỏi chốt — mọi nhập nhằng đã chặn ở bước trước.
 */
async function suaDonVaBao(deps: GomDonDeps, p: PhienGom): Promise<'xong' | 'loi'> {
  const don = p.donSua!;
  // PHIẾU NHẬP đi tool riêng (16/08): purchase.order.line, giá là GIÁ NHẬP.
  if (don.loai === 'mua') return suaPhieuNhapVaBao(deps, p);
  // Tool phân biệt "đổi SL của SP đã có" với "thêm dòng mới" — nhưng nó tự dò
  // theo product_id: SP chưa có trong đơn thì `doi` tự thành thêm. Nên gom hết
  // vào `doi` là đúng cho cả hai ca, khỏi đoán trước đơn đang có gì.
  const doi = p.dong
    .filter((d) => d.daChot && d.sl != null)
    .map((d) => ({
      san_pham_id: d.daChot!.id,
      so_luong: d.sl!,
      // Bug 17:41 10/08: quên dòng này nên hoá đơn ghi 1đ/thanh thay vì giá NV báo.
      ...(d.donGia ? { don_gia: d.donGia } : {}),
      // Cùng lý do với giá: sửa một đường mà quên đường kia là lỗi lặp 3 lần.
      ...(d.chietKhau ? { chiet_khau: d.chietKhau } : {}),
      // Lần thứ TƯ của cùng bài học: hàng tặng phải chạy cả đường sửa đơn.
      ...(d.tang ? { tang: true } : {}),
      // Lần thứ NĂM: VAT cũng phải chạy cả đường sửa. Ca thật "đơn này xuất
      // VAT nữa em" sau khi đơn đã lên — vá mỗi đường tạo là bỏ sót ca này.
      ...(p.vatThueId != null ? { thue_id: p.vatThueId } : {}),
    }));
  const t0 = Date.now();
  const vaoSua = {
    don_id: don.id, doi,
    // Chỉ đổi kho khi NV nói rõ — không nói thì giữ nguyên kho đơn đang có.
    ...(p.khoId != null ? { kho_id: p.khoId } : {}),
  };
  const kq = await suaDon({ odoo: deps.odoo }, vaoSua);
  deps.ghiLog({
    toolName: 'sua_don', input: vaoSua,
    output: dinhDangSuaDon(kq), thanhCong: kq.ok,
    durationMs: Date.now() - t0, iteration: 0,
  });

  if (!kq.ok) {
    await deps.guiTin(`Không sửa được đơn ${don.ma}: ${kq.lyDo ?? 'Odoo từ chối'}`);
    return 'loi'; // giữ phiên — NV sửa thông tin rồi thử lại
  }

  const mon = p.dong
    .filter((d) => d.daChot && d.sl != null)
    .map((d) => `${d.sl} × ${d.daChot!.ten}`)
    .join(', ');
  await deps.guiTin(
    `Đã sửa đơn ${kq.maDon}: ${mon}. ` +
    `Tổng ${(kq.tongTruoc ?? 0).toLocaleString('vi-VN')}đ → ${(kq.tongSau ?? 0).toLocaleString('vi-VN')}đ. ` +
    `Link: ${linkXuLyDon(deps.odooUrl, kq.donId)}`,
  );

  // Ảnh báo giá MỚI — nhân viên cần thấy đơn sau khi sửa, như lúc lên đơn.
  if (deps.anhClient) {
    try {
      const hd = await guiHoaDon(
        { odoo: deps.odoo, anhClient: deps.anhClient, odooUrl: deps.odooUrl },
        { don_id: kq.donId },
      );
      if (hd?.anh) await deps.guiAnhHoaDon(hd.anh);
    } catch (err) {
      logger.warn({ err, donId: kq.donId }, '[gom-don] gửi ảnh sau sửa đơn lỗi (đã có text)');
    }
  }
  p.daXong = { maDon: kq.maDon, tenKhach: p.khachDaChot?.ten ?? '' };
  return 'xong';
}

/**
 * Xử một tin nhân viên qua máy gom đơn.
 * Trả `true` = máy đã nhận (đã gửi trả lời); `false` = không phải việc của máy
 * (không phải lệnh lên đơn / digression giữa phiên) — caller đưa agent thường.
 */
export async function xuLyGomDon(
  deps: GomDonDeps,
  input: {
    orgId: string; conversationId: string; seq: number; cau: string;
    /**
     * UID Zalo người gửi — ghi vào `phien.hoiUid` để lượt sau nhận ra "người
     * này đang được bot hỏi", khỏi bắt tag lại trong nhóm (bug 17:08 10/08).
     */
    senderUid?: string | null;
  },
): Promise<boolean> {
  // Câu để MAP/nhận lệnh là phần đuôi sau khối quote; câu đầy đủ (kèm quote)
  // chỉ dành cho LLM trích slot — nó cần ngữ cảnh "cái này".
  const cauChon = boQuote(input.cau);

  // MỘT cửa ghi phiên. Mọi đường ghi đều qua đây nên `hoiUid` không thể sót ở
  // một nhánh — bài học từ 3 lần vá một đường quên các đường còn lại.
  const ghiPhien = async (p: PhienGom): Promise<void> => {
    p.hoiUid = input.senderUid ?? null;
    await luuPhien(deps.prisma, {
      orgId: input.orgId, conversationId: input.conversationId, phien: p,
    });
  };

  // Đơn xong → phiên chết nhưng để lại DẤU (xem PhienGom.daXong): 15 phút sau
  // đó câu "giá 1800 đó" còn biết mình đang nói về đơn nào.
  const ketThucPhien = async (p: PhienGom): Promise<void> => {
    if (p.daXong) {
      await ghiPhien({ khachTuKhoa: null, dong: [], viecId: p.viecId, daXong: p.daXong });
    } else {
      await xoaPhien(deps.prisma, input.conversationId);
    }
  };

  let phien = await docPhien(deps.prisma, input.conversationId);
  // ĐƠN VỪA LÊN XONG (13/08) — dấu `daXong` đi chung bảng phiên nhưng KHÔNG
  // phải phiên mở: tách ra đây rồi coi phien = null để mọi nhánh cũ giữ nguyên.
  const donVuaLen = phien?.daXong ?? null;
  if (donVuaLen) phien = null;
  // NHẬP HÀNG kiểm TRƯỚC lên đơn: hai regex chồng nhau ở "tạo đơn mua" —
  // `NHAN_LENH_LEN_DON` bắt "tạo đơn" nên câu đó sẽ thành đơn BÁN nếu để nó
  // chạy trước. Ca thật 22:09 ("tạo phiếu nhập hàng") phải ra chế 'nhap'.
  const regexNhap = NHAN_LENH_NHAP_HANG.test(cauChon);
  // Tham chiếu sửa CHỈ sống trong cửa sổ đơn-vừa-lên và thua mọi lệnh tường
  // minh: "lên đơn cho anh Hà" ngay sau đơn cũ vẫn là lệnh lên đơn MỚI.
  const thamChieuSua =
    donVuaLen != null && !regexNhap && !NHAN_LENH_LEN_DON.test(cauChon)
    && (NHAN_THAM_CHIEU_SUA.test(boDau(cauChon))
      // "<tên hàng> giá nhập 20099đ nhé" ngay sau phiếu — là sửa giá phiếu đó.
      || phanTichCauSuaGia(boDau(cauChon)) != null);
  const laLenhSua = !regexNhap && (NHAN_LENH_SUA_DON.test(cauChon) || thamChieuSua);
  const regexLen = !regexNhap && !thamChieuSua && NHAN_LENH_LEN_DON.test(cauChon);

  // ── CỬA VÀO: regex CHỈ là lối tắt, LLM mới là người quyết ──────────────────
  //
  // Bug thật 22:09 10/08: "lên cho anh Huấn khách mới 10 nguồn NB nhé" — regex
  // đòi "lên"+"đơn" dính nhau nên trượt, máy không chạy, rơi xuống LLM tự do
  // và mất luôn luật "giá NV báo thắng giá hệ thống" → bot hỏi vặn giá 170k.
  //
  // Anh Quốc: "sao lòng vòng thế nhỉ????, có mỗi việc lên đơn". Đúng — vá
  // regex từng chữ ("lên đơn", "lên cho", "bán cho"…) thì thiếu mãi. LLM giỏi
  // hiểu câu chữ, code giỏi giữ luật; để mỗi bên làm việc của mình.
  //
  // Regex khớp → vào thẳng, KHỎI tốn lượt LLM cho ca thường gặp nhất.
  // Regex trượt và chưa có phiên → HỎI LLM một lượt: "đây có phải lệnh lên đơn
  // không". Nó nói không thì nhường agent thường như cũ.
  let trich: KetQuaTrich = {};
  let daHoiLlm = false;
  if (!phien && !regexLen && !laLenhSua && !regexNhap) {
    trich = await trichSlot(deps.generate, input.cau, null);
    daHoiLlm = true;
    // Nhận việc khi model thấy ĐƠN BÁN hoặc ĐƠN MUA — cùng một máy, hai chế.
    if (!trich.lenDon && !trich.nhapHang) return false;
  }

  // ĐƯỜNG TẮT SỬA GIÁ — CODE TRƯỚC, MODEL SAU (14/08, ca 22:32-22:33). Câu
  // hình dạng cố định ("giá 175k đó", "sửa giá nguồn á", hoặc con số trần khi
  // máy vừa hỏi giá) trong ngữ cảnh SỬA ĐƠN: model không có chỗ đặt slot này
  // (đo prod: trả tay trắng, máy kẹt hỏi "sửa gì" rồi đường thoát đọc nhầm
  // kịch bản luồng khách). Bắt bằng regex, chặn luôn lượt gọi model.
  const cauSuaGia: { gia?: number; ten?: string } | null =
    (thamChieuSua || phien?.che === 'sua')
      ? (phanTichCauSuaGia(boDau(cauChon))
        ?? (phien?.dongChoGia != null
          ? ((): { gia: number } | null => {
              // "13k/thanh", "13k/cái" — đúng mẫu máy gợi ý ("vd: 13k/thanh");
              // bỏ hậu tố đơn vị rồi mới bóc số.
              const g = bocGiaTran(boDau(cauChon).replace(/\s*\/\s*[a-z]+/g, ''));
              return g != null ? { gia: g } : null;
            })()
          : null))
      : null;
  // Chỉ khoá mồm model khi đường tắt THẬT SỰ áp được (sửa dòng ĐÃ có trên
  // đơn: phien.dong rỗng). Phiên đang gom dở (có dòng chờ giá/SL) thì câu
  // "Giá 13k" phải tới model — nó đọc khối "Bot vừa hỏi" mà gắn giá đúng
  // dòng. Ca thật 08:53 26/08: regex cướp lượt, khối áp giá không chạy vì
  // phien.dong ≠ rỗng → giá rơi vào khoảng không, hỏi lại 4 vòng.
  if (cauSuaGia && (phien?.dong.length ?? 0) === 0) daHoiLlm = true;

  // LỆNH TẠO-MỚI SP cũng là lệnh CODE — chặn luôn lượt gọi model (17/08, ca
  // 10:06:36: câu "thêm mới các sản phẩm đó luôn" vẫn đi qua trichSlot, model
  // trích bừa `khach` từ đó làm BAY 2 NCC đang treo trong phiên → NV chọn
  // xong 12 nhóm SP, máy quay lại hỏi "Phiếu nhập này của nhà cung cấp nào
  // ạ?" — anh Quốc: "lại quên ngữ cảnh rồi, là sao vậy????"). Khối thực thi
  // nằm phía dưới (lenhTaoMoi) — ở đây chỉ cần khoá mồm model.
  if (
    phien?.che === 'nhap'
    && /^(?:tao|them)\s+(?:san pham\s+|sp\s+)?moi\b/.test(boDau(cauChon))
    && !/vao (don|phieu)/.test(boDau(cauChon))
  ) {
    daHoiLlm = true;
  }

  const laLenhNhap = regexNhap || trich.nhapHang === true;
  // "tạo phiếu nhập MỚI"/"thêm phiếu nữa" = NV chủ động muốn bản nữa dù trùng.
  // (phieu|don) BẮT BUỘC — "thêm MỚI các sản phẩm" là tạo SP, không phải xin
  // phiếu trùng (đo e2e 17/08: regex cũ optional nên câu đó bật nhầm cờ).
  const choPhepTrung = /(tao|them)\s+(mot\s+)?(phieu|don)\s*(nhap\s*)?(hang\s*)?(moi|nua)\b/.test(boDau(cauChon));
  // Lệnh nhập hàng KHÔNG đồng thời là lệnh lên đơn: model có thể bật cả hai
  // (câu "tạo đơn mua" trông giống "tạo đơn"). Nhập hàng thắng — cùng lý do
  // thứ tự kiểm regex ở trên.
  const laLenhLen = !laLenhNhap && (regexLen || trich.lenDon === true);

  // ĐƯỜNG THOÁT 1 — lệnh LÊN ĐƠN MỚI đè phiên đang gom (spec 10/08).
  //
  // Bug demo 17:22 10/08: phiên dính SP giá 1đ, nhân viên gõ "lên đơn cho anh
  // Hoàng 10 cái nguồn NB" — khách KHÁC HẲN — mà bot vẫn trả đơn anh Vấn kèm
  // đúng câu lỗi cũ. Nói "lên đơn cho <người khác>" là bắt đầu việc mới, không
  // phải nói tiếp việc cũ. Phiên cũ bỏ đi, báo cho nhân viên biết.
  //
  // Lệnh NHẬP HÀNG cũng đè, VÀ đè cả phiên chế khác: đang gom đơn bán dở mà
  // nhân viên quay sang "tạo phiếu nhập hàng" là đổi hẳn việc — giữ phiên cũ
  // thì tên NCC rơi vào ô khách của đơn bán, ra đơn sai hoàn toàn.
  //
  // ─── ĐÈ PHIÊN PHẢI THẤY KHÁCH MỚI KHÁC (vá 12/08, ca 11:41 + 19:48) ───
  //
  // Regex chỉ đọc được ĐỘNG TỪ, không đọc được có KHÁCH MỚI hay không. Hai ca
  // thật cùng ngày, cùng một vết:
  //   11:43:56  "đúng rồi lên đơn đi"                     → câu GẬT
  //   19:48:29  "thôi bỏ các sản phẩm không rõ ràng lên đơn đi" → câu CHỐT
  // Cả hai chứa "lên đơn" → đường thoát cũ xoá phiên → mất "Led Kim Long" đã
  // cho từ đầu + mọi dòng đã khớp, bot hỏi lại "lên cho khách nào ạ?". Anh
  // Quốc: "rõ ràng là đã có thông tin khách hàng là led kim long rồi mà" /
  // "cảm giác nó tù tù... không linh động".
  //
  // Luật mới: lệnh LÊN ĐƠN chỉ đè phiên khi câu mang KHÁCH MỚI THẬT SỰ KHÁC
  // khách đang gom (trích slot rồi so, không đoán bằng regex). Không có khách
  // trong câu, hoặc khách TRÙNG → là nói tiếp việc cũ, phiên giữ nguyên.
  // Ràng buộc ngược 17:22 10/08 giữ nguyên: "lên đơn cho anh Hoàng" giữa
  // phiên Led Kim Long vẫn phải đè.
  //
  // Muốn so khách thì phải TRÍCH TRƯỚC khi quyết — nên trichSlot dời lên đây
  // cho nhánh này (có phiên + regex khớp lệnh). `daHoiLlm` bật để không gọi
  // lần hai cho cùng câu ở dưới.
  let daBoPhienCu = false;
  const doiChe = phien != null && laLenhNhap && phien.che !== 'nhap';
  if (phien && ((laLenhLen && phien.che !== 'sua') || doiChe)) {
    if (!daHoiLlm) {
      trich = await trichSlot(deps.generate, input.cau, phien);
      daHoiLlm = true;
    }
    const khachPhien = phien.khachDaChot?.ten ?? phien.khachTuKhoa ?? '';
    const khachCau = trich.khachMoi?.ten ?? trich.khach ?? '';
    const trungKhach =
      khachCau !== '' && khachPhien !== '' &&
      (boDau(khachPhien).includes(boDau(khachCau)) || boDau(khachCau).includes(boDau(khachPhien)));
    // Đổi chế (bán↔nhập) là đổi hẳn việc — đè không cần hỏi khách, như cũ.
    const khachMoiKhac = khachCau !== '' && !trungKhach;
    if (doiChe || khachMoiKhac) {
      await xoaPhien(deps.prisma, input.conversationId);
      phien = null;
      daBoPhienCu = true;
    }
  }

  // 1. Map lựa chọn bằng CODE trước — "1a"/mã KH/SĐT không tốn lượt LLM nào.
  let daChon = phien ? apDungChon(phien, cauChon) : false;
  // HỌC ALIAS (P1.3): NV vừa chọn một SP từ danh sách GẦN ĐÚNG → tên gọi đó
  // từ nay khớp thẳng. Fire-and-forget — học trượt không được chặn đơn.
  const hocAliasSauChon = (): void => {
    if (!phien || !deps.ghiAliasSp) return;
    for (const d of phien.dong) {
      if (d.daChot && d.ungVienGanDung) {
        // KHÔNG HỌC TÊN CHUNG CỦA NHIỀU BIẾN THỂ (18/08, ca 12:33→12:38).
        //
        // NV gõ "led zz thấu kính" → 3 màu → bấm "a" → hệ học "zz thấu kính =
        // màu Trung tính". Một phút sau ở nhóm khác, alias khớp thẳng nên bot
        // KHÔNG hỏi màu, tự lên đơn S14759; 12:38 anh Ánh phải sửa thành màu
        // Trắng 11000K. Bấm "a" là chọn CHO LẦN NÀY, không phải dạy máy một
        // luật vĩnh viễn. Xem `laTenChungBienThe` để biết luật phân biệt.
        if (laTenChungBienThe(d.ungVienDaHoi ?? [])) {
          logger.info(
            { tuKhoa: d.tuKhoa, soUngVien: (d.ungVienDaHoi ?? []).length },
            '[gom-don] tên chung của nhiều biến thể — KHÔNG học alias',
          );
          delete d.ungVienGanDung;
          delete d.ungVienDaHoi;
          continue;
        }
        void deps.ghiAliasSp({ tuKhoa: d.tuKhoa, productId: d.daChot.id, tenSp: d.daChot.ten });
        delete d.ungVienGanDung;
        delete d.ungVienDaHoi;
      }
    }
  };
  if (daChon) hocAliasSauChon();

  // TẠO SP MỚI THEO LỆNH TƯỜNG MINH (yêu cầu anh Quốc 22:06 12/08: "nếu người
  // dùng muốn tạo mới thì tạo luôn"). CHỈ chế NHẬP + phiên đang mở — hàng nhập
  // về là hàng thật sắp nằm kho, khác hẳn bot tự đẻ SP lúc bí (bài học "khách
  // rác Long"). Lệnh phải TƯỜNG MINH "tạo mới <tên>" — đó là consent, regex
  // bắt ở code, không nhờ model đoán ý.
  //
  // Quyền Odoo hiện CHẶN create (đo probe 22:1x) — bot nói thật + chỉ đường
  // cấp quyền; ai cấp xong là chạy ngay, không cần deploy lại.
  // Câu tự nhiên hơn cũng phải ăn (ca 09:52 17/08: "thêm mới các sản phẩm đó
  // luôn" trượt regex cũ → rơi vào agent tự do → hết giờ → nhả bảng cột).
  // Nhận: "tạo mới …", "thêm mới …", "tạo/thêm (sản phẩm) mới các SP đó/hết".
  // Đuôi là THAM CHIẾU CHUNG (đó/hết/luôn/không thấy…) → tạo cả danh sách
  // vừa báo không-thấy; đuôi là TÊN cụ thể → tạo đúng tên đó.
  const lenhTaoMoiTho = phien?.che === 'nhap'
    ? boDau(cauChon).match(/^(?:tao|them)\s+(?:san pham\s+|sp\s+)?moi\s*(.*)$/)
    : null;
  const lenhTaoMoi = lenhTaoMoiTho && !/vao (don|phieu)/.test(lenhTaoMoiTho[1]) ? lenhTaoMoiTho : null;
  if (lenhTaoMoi && phien) {
    const duoi = lenhTaoMoi[1].trim();
    const taoHet = duoi === ''
      || /^(het|luon|di|nhe|nha)$/.test(duoi)
      || /(cac|nhung)?\s*(san pham|sp|mat hang|hang)?\s*(do|khong (tim )?thay|con thieu|thieu|vua bao)/.test(duoi);
    // Đuôi tên cụ thể: lấy NGUYÊN VĂN từ cauChon (giữ dấu) chứ không phải bản
    // boDau — tên SP tạo ra phải có dấu tử tế.
    const tenCuThe = taoHet ? '' : cauChon.trim().replace(/^(?:tạo|them|thêm)\s+(?:sản phẩm\s+|sp\s+)?mới\s*/i, '').trim();
    // Phiên cũ (trước bản vá) lưu string[] — đỡ cả hai dạng trong 15' giao thời.
    const daBaoChuan = (phien.daBaoKhongThay ?? []).map((x) =>
      typeof x === 'string' ? { ten: x as string, sl: null } : x);
    const dsCanTaoTho = taoHet
      ? [
          ...phien.dong.filter((d) => d.khongThay).map((d) => ({ ten: d.tuKhoa, sl: d.sl })),
          ...daBaoChuan,
        ]
      : [{ ten: tenCuThe, sl: null }];
    const daThay = new Set<string>();
    const dsCanTao = dsCanTaoTho.filter((x) => {
      const k = boDau(x.ten);
      if (!k || daThay.has(k)) return false;
      daThay.add(k);
      return true;
    });
    const daTao: string[] = [];
    let biChanQuyen = false;
    for (const canTao of dsCanTao) {
      const tenTao = canTao.ten;
      try {
        const id = await deps.odoo.execute<number>('product.product', 'create', [{
          name: tenTao, purchase_ok: true, sale_ok: true,
        }]);
        // Dòng nào trong phiên khớp tên này thì chốt thẳng vào SP vừa tạo.
        const d = phien.dong.find((x) => boDau(x.tuKhoa) === boDau(tenTao) || boDau(tenTao).includes(boDau(x.tuKhoa)));
        if (d) {
          d.daChot = { id, ten: tenTao, gia: 0 };
          if (d.sl == null && canTao.sl != null) d.sl = canTao.sl;
          delete d.khongThay;
        } else {
          phien.dong.push({ tuKhoa: tenTao, sl: canTao.sl ?? null, daChot: { id, ten: tenTao, gia: 0 } });
        }
        daTao.push(tenTao);
      } catch {
        biChanQuyen = true;
        break;
      }
    }
    if (biChanQuyen) {
      await deps.guiTin(
        'Em chưa được cấp quyền tạo sản phẩm trên Odoo ạ (hệ thống báo phải liên hệ quản trị '
        + 'viên). Anh/chị nhờ kế toán tạo giúp, hoặc cấp quyền Tạo sản phẩm cho tài khoản bot '
        + 'thì lần sau em tạo thẳng được ạ.',
      );
      if (daTao.length === 0) { await ghiPhien(phien); return true; }
    }
    if (daTao.length > 0) {
      delete phien.daBaoKhongThay;
      await deps.guiTin(`Em đã tạo mới ${daTao.length} sản phẩm: ${daTao.map((t) => `"${t}"`).join(', ')} (giá nhập điền sau ạ).`);
      daChon = true; // câu đã xử bằng code — đừng đưa "tạo mới X" cho trích slot đoán
    } else if (!biChanQuyen) {
      await deps.guiTin('Em chưa thấy sản phẩm nào đang thiếu để tạo ạ — anh/chị nêu tên cụ thể: "tạo mới <tên hàng>".');
      await ghiPhien(phien);
      return true;
    }
  }

  // HUỶ PHẢI CHẮC — REGEX Ở CODE, TRƯỚC MODEL (vá 22:59 12/08). Ca thật:
  //   08:59:43  "bỏ đơn này đi"   → bot LẶP danh sách chọn, không huỷ
  //   08:59:53  "bỏ đơn này"      → vẫn không thoát
  // NV muốn ra mà máy giam lại là cảm giác tệ nhất của cả chuỗi. Lệnh thoát
  // là cửa an toàn — phải tất định như nút ESC, không được nhờ model đoán.
  // HẸP: câu CHỈ gồm động từ huỷ + "đơn/phiếu (này) (đi)" — "bỏ sản phẩm Card
  // HD khỏi đơn" có tên hàng chen giữa nên KHÔNG khớp, vẫn là bỏ dòng.
  const lenhHuy = phien != null && (
    /^(bỏ|bo|huỷ|huy|hủy|thôi|thoi)\s*(cái|cai)?\s*(đơn|don|phiếu|phieu)\s*(này|nay|nhập|nhap)?\s*(đi|di|nhé|nhe|nha|luôn|luon)?$/i
      .test(boQuote(input.cau).trim())
    || /làm lại từ đầu|lam lai tu dau/i.test(boDau(input.cau))
  );
  if (lenhHuy && phien) {
    await xoaPhien(deps.prisma, input.conversationId);
    await deps.guiTin('Em huỷ đơn đang gom rồi ạ. Cần lên lại anh/chị cứ nhắn nhé.');
    return true;
  }


  // Đã hỏi LLM ở cửa vào thì DÙNG LẠI kết quả — đừng gọi lần hai cho cùng câu.
  if (!daChon && !daHoiLlm) trich = await trichSlot(deps.generate, input.cau, phien);

  // ĐANG TREO CHỌN KHÁCH/NCC thì câu lạ KHÔNG được thành từ khoá tra mới
  // (vá 22:59 12/08). Ca thật 08:56: "1aaaaaa theo thứ tự từ trên xuống" bị
  // model trích thành tên NCC → máy đi tra → "chưa khớp được ... với nhà cung
  // cấp nào". Khi bot vừa đưa danh sách 1)/2), câu trả lời tự nhiên là LỰA
  // CHỌN — muốn tra người khác thật thì gõ mã KH/SĐT (vẫn cho qua).
  if (phien?.khachUngVien?.length && trich.khach && /\d/.test(trich.khach) && /[a-z]/i.test(boDau(trich.khach))
      && !laMaKh(trich.khach) && !/^0\d{9,10}$/.test(trich.khach.replace(/[\s.]/g, ''))) {
    delete trich.khach;
  }

  // LỰA CHỌN MỀM model đề xuất ("lấy loại rẻ nhất" → chon_sp) — validate và
  // áp bằng luật phạm vi của chon.ts; áp được thì cũng HỌC ALIAS như chọn tay.
  if (!daChon && phien && (trich.chonKhach != null || trich.chonSp?.length)) {
    if (apChonDeXuat(phien, trich.chonKhach, trich.chonSp)) {
      daChon = true;
      hocAliasSauChon();
    }
  }

  // ── TRA LẠI CATALOG KHI NV GÕ LẠI TÊN HÀNG (18/08, ca 11:51→12:00) ──
  //
  // Ca thật, anh Quốc gửi transcript kèm "cái gì thế này?": bot đưa nhầm 3 SP
  // "Led F30 ... ATX" cho từ khoá "led zz thấu kính", rồi NV gõ CHÍNH XÁC tên
  // hàng thật suốt 9 phút mà không thoát ra được:
  //   11:52:21 Ánh : "thấu kính 12v-30d"              → "Em vẫn chưa khớp được…"
  //   11:52:48 Ánh : "ziczac thấu kính 11000k đó"     → in LẠI 3 SP F30 cũ
  //   11:54:02 Ánh : "led dây ziczac thấu kính 12v-30d" → "Em vẫn chưa khớp…"
  //   11:54:44 Ánh : "ko chuẩn rồi"   11:55:09 Quyết: "sai mã hàng rồi"
  //   12:00:05 Quốc: "ziczac thấu kính nhé"           → "Em vẫn chưa khớp…"
  // "Led dây ziczac thấu kính 12V-30D" CÓ THẬT trong catalog, 75.000đ (id 2013/
  // 2014/2017). Nhưng khi danh sách đang treo, MỌI tầng của chon.ts chỉ so
  // trong `dong.ungVien` — tức so với đúng 3 SP SAI. Tra cứu ban đầu bỏ qua
  // dòng đã có `ungVien`, nên tên mới không bao giờ được tra lại. Máy tự nhốt
  // mình trong tập ứng viên sai: NV gõ đúng đến mấy cũng không có đường ra.
  //
  // Sửa: NV gõ lại TÊN HÀNG (không phải chữ chọn a/b/c) khi đang treo ứng viên
  // → TRA LẠI Odoo bằng tên mới; ra kết quả thì THAY ứng viên. Đây là cách một
  // người bán hàng thật xử sự: khách tả lại rõ hơn thì tra lại, chứ không bắt
  // họ chọn giữa mấy món mình vừa đưa nhầm.
  //
  // HẸP có chủ ý — chỉ chạy khi ĐỦ CẢ BỐN:
  //   · `apDungChon` đã trượt (câu không chọn được gì trong danh sách), VÀ
  //   · đang treo ĐÚNG MỘT dòng ứng viên (nhiều dòng thì không biết tả dòng nào), VÀ
  //   · MODEL TRÍCH RA ĐƯỢC TÊN HÀNG (`trich.dong[].sp`), VÀ
  //   · tên đó ≥2 chữ có nghĩa.
  //
  // Vế "model trích ra tên hàng" là hàng rào QUAN TRỌNG NHẤT, và nó phải nằm
  // SAU lượt trích slot chứ không trước (test replay 07/08 bắt được khi em đặt
  // nhầm chỗ: 4 ca đỏ). Lấy câu THÔ mà tra thì "xuất hóa đơn luôn giúp tôi
  // nhé" cũng bị đem đi tra sản phẩm và máy NUỐT luôn lượt digression — đúng
  // họ lỗi S13814 (dò mảnh chữ trong câu dài → chốt nhầm khách, đơn sai người).
  // Model đã phân biệt sẵn "câu này đang tả hàng" với "câu này là việc khác";
  // dùng lại kết luận đó rẻ hơn và đúng hơn regex tự chế.
  if (!daChon && phien && !trich.ngoaiLe) {
    const dongTreo = phien.dong.filter((d) => d.ungVien?.length && !d.daChot);
    const spTrich = (trich.dong ?? []).map((d) => (d.sp ?? '').trim()).filter(Boolean);
    const tenMoi = spTrich.length === 1 ? spTrich[0] : '';
    const duChu = boDau(tenMoi).split(/\s+/).filter((t) => t.length >= 2).length >= 2;
    if (dongTreo.length === 1 && duChu && !LA_KHACH_MOI.test(boDau(tenMoi))) {
      const t0 = Date.now();
      const traLai = await traSanPham({ odoo: deps.odoo }, { ten: tenMoi });
      // CHỈ THAY KHI TẬP ỨNG VIÊN THẬT SỰ KHÁC ĐI — y hệt thì thay chỉ làm bot
      // in lại đúng danh sách vừa bị chê, phí một lượt của NV.
      //
      // "KHÁC" gồm cả THU HẸP, không chỉ "có SP mới" (sửa sau khi test replay
      // 18/08 đỏ): NV gõ "led dây ziczac thấu kính 12v-30d" cho ra [2013, 2017]
      // — TẬP CON của [2013, 2017, 2014] đang treo. Đòi phải có id mới thì đúng
      // ca này bị bỏ qua, mà thu 3 → 2 chính là thứ NV vừa làm được bằng cách
      // tả rõ hơn. Chốt được luôn còn tốt hơn nữa.
      const idCu = new Set((dongTreo[0].ungVien ?? []).map((s) => s.id));
      const khacTapCu =
        traLai.length !== idCu.size || traLai.some((s) => !idCu.has(s.id));
      if (traLai.length > 0 && khacTapCu) {
        deps.ghiLog({
          toolName: 'tra_san_pham', input: { ten: tenMoi },
          output: `[tra lại khi NV gõ tên mới] ${dinhDangSanPham(traLai, tenMoi)}`,
          thanhCong: true, durationMs: Date.now() - t0, iteration: 0,
        });
        const meta = traLai as import('../../../odoo/tools/tra-san-pham.js').SanPhamList;
        const ganDung = meta.ganDung === true || meta.daNoiRong === true;
        // Đúng MỘT kết quả khớp thẳng (không qua đường nới) → chốt luôn: NV đã
        // gõ tên đầy đủ, bắt họ xác nhận thêm một lượt nữa là vô ích.
        if (traLai.length === 1 && !ganDung) {
          dongTreo[0].daChot = { id: traLai[0].id, ten: traLai[0].ten, gia: traLai[0].gia };
          delete dongTreo[0].ungVien;
        } else {
          dongTreo[0].ungVien = traLai;
          dongTreo[0].ungVienDaHoi = traLai.map((x) => ({ id: x.id, ten: x.ten, gia: x.gia }));
          if (ganDung) dongTreo[0].ungVienGanDung = true;
        }
        const tuKhoaCu = dongTreo[0].tuKhoa;
        // Tên NV vừa gõ mới là tên gọi thật của họ → alias học theo tên này.
        dongTreo[0].tuKhoa = tenMoi;
        logger.info(
          { tuKhoaCu, tenMoi, soKq: traLai.length },
          '[gom-don] NV gõ lại tên hàng — tra lại catalog, thay ứng viên',
        );
        daChon = true;
      }
    }
  }

  if (trich.huy && phien) {
    await xoaPhien(deps.prisma, input.conversationId);
    await deps.guiTin('Em huỷ đơn đang gom rồi ạ. Cần lên lại anh/chị cứ nhắn nhé.');
    return true;
  }
  // Digression: câu không liên quan đơn → nhường agent thường, phiên GIỮ NGUYÊN.
  //
  // NHƯNG lệnh LÊN ĐƠN RÕ RÀNG thì model KHÔNG có quyền phủ quyết (sửa 11/08).
  //
  // Ca thật 15:06→15:35 11/08 (nhóm Test-AI) — 28 phút, 8 lượt nhắc lại cho một
  // đơn đáng ra xong trong 1 lượt:
  //
  //   15:06:59  NV : "lên đơn cho chị phương ali 4 bóng lixin 4000k trung tính
  //                   trong nhà 500 bóng giá 2800 nhé"
  //   15:07:29  bot: "Dạ em đã chuyển việc lên đơn ... sang bộ phận sale xử lý ạ"
  //
  // Câu đó có ĐỦ khách + SP + SL + giá và KHỚP `NHAN_LENH_LEN_DON`. Cửa vào
  // (f99b06ac) định là "regex khớp → vào thẳng", nhưng regex chỉ giúp bỏ qua
  // lượt hỏi `lenDon`; xuống tới đây model vẫn cướp được lượt bằng ngoaiLe=true.
  // Nó rất dễ trả như vậy: prompt trích slot dạy "hoá đơn là ngoaiLe", còn câu
  // này thì dài và nhiễu ("4 bóng ... 500 bóng"). Bốn câu "lên đơn ..." trong ca
  // (15:06, 15:14, 15:20, 15:31) đều khớp regex và đều bị nhường như thế.
  //
  // Rơi xuống agent tự do là mất luật "giá NV báo thắng giá hệ thống" → bot quay
  // ra đòi giá chính thức rồi hứa "đã chuyển sale" 5 lần, dù chính sale đang
  // ngồi trong nhóm hỏi nó. Máy gom đơn vào cuộc lúc 15:32 thì đơn lên sau 3'.
  //
  // Luật: câu tự nó mang dấu hiệu lệnh lên đơn (regex) thì "không liên quan đơn
  // hàng" là câu trả lời TỰ MÂU THUẪN — bỏ qua, code cầm lái tiếp. Hàng rào HẸP
  // có chủ ý: chỉ cứu khi regex khớp, câu báo cáo/tồn kho vẫn nhường như cũ.
  //
  // ẢNH GIỮA PHIÊN cũng được cứu như vậy (vá 11/08, ca thật 23:22). Nhân viên
  // hay trả lời câu hỏi của bot BẰNG ẢNH: bot hỏi "nhập những hàng gì ạ?", họ
  // chụp danh sách hàng gửi vào. Lúc đó tin không có chữ nào giống lệnh, model
  // rất dễ gọi nó là digression — mà nhường agent tự do ở đây là bỏ rơi phiên
  // đang gom dở, đúng thứ máy trạng thái sinh ra để tránh.
  //
  // HẸP có chủ ý — PHẢI có phiên đang mở. Không có phiên thì ảnh vu vơ (ảnh
  // chuyển khoản, ảnh cái ghế) vẫn nhường agent thường như cũ; nếu không thì
  // mọi ảnh khách gửi đều bị lôi vào máy gom đơn.
  const anhGiuaPhien = phien != null && coKhoiAnh(input.cau);

  // CÂU NGẮN KHI PHIÊN ĐANG CHỜ TRẢ LỜI (vá 12/08, ca thật 00:40-00:50).
  //
  // Bước 3 của ca hỏng LẦN THỨ BA. Đo prod với phiên đang ở chế 'nhap':
  //   "ncc là Trung Quốc"  -> khach="Trung Quốc"  nhapHang=true  ĐÚNG
  //   "Trung Quốc" TRẦN    -> khach=undefined     ngoaiLe=true   HỎNG
  // Cùng một cái tên, chỉ khác chỗ có nhãn "ncc" dẫn đường hay không. Model
  // thấy hai chữ trơ trọi không có động từ nào thì đoán là chuyện phiếm.
  //
  // Nhưng phiên ĐANG MỞ MIỆNG HỎI đúng câu đó ("Phiếu nhập này của nhà cung cấp
  // nào ạ?"). Khi máy vừa hỏi xong, câu kế của nhân viên là CÂU TRẢ LỜI — gọi
  // nó "không liên quan đơn hàng" là câu trả lời tự mâu thuẫn, y hệt lập luận
  // của hàng rào lệnh-lên-đơn-rõ-ràng (15:06 11/08) và hàng rào khối ảnh
  // (23:22 11/08, commit f4a3c93b). Đây là lần thứ BA cùng một bài học nên
  // dựng hàng rào ở CODE, không vá prompt: prompt đã dặn rồi mà model vẫn
  // trả ngoaiLe cho ca này (đo prod, không phải phỏng đoán).
  //
  // HẸP có chủ ý, đủ bốn điều kiện mới cứu:
  //   1. có phiên đang mở, chưa chốt khách/NCC, không phải chế 'sua';
  //   2. phiên CHƯA CÓ TỪ KHOÁ NÀO (`khachTuKhoa == null`) — tức máy vừa hỏi
  //      "của nhà cung cấp nào ạ?" và còn tay trắng. Đây là vế QUYẾT ĐỊNH:
  //      phiên đã có từ khoá rồi thì câu ngắn giữa chừng là chuyện khác
  //      ("tồn kho NB còn nhiêu?" — kịch bản #2 của replay 07/08) và PHẢI
  //      tiếp tục nhường agent thường như cũ;
  //   3. câu NGẮN (≤6 từ) — đúng hình dạng một câu trả lời cộc lốc;
  //   4. câu có CHỮ (không phải toàn số/ký hiệu) — số đã có `apDungChon` lo.
  // Nhờ vậy "báo cáo doanh số hôm nay" hay "gửi lại hoá đơn" giữa phiên vẫn
  // rơi xuống agent thường đúng như trước.
  const dangChoChotKhach =
    phien != null && !phien.khachDaChot && phien.che !== 'sua'
    && phien.khachTuKhoa == null && !phien.khachUngVien?.length;
  const cauNganTraLoi =
    dangChoChotKhach
    && cauChon.trim().split(/\s+/).length <= 6
    && /[a-zà-ỹ]/i.test(cauChon);

  if (
    !daChon && trich.ngoaiLe && !regexLen && !laLenhSua && !regexNhap
    && !anhGiuaPhien && !cauNganTraLoi
  ) {
    return false;
  }

  // Câu ngắn được cứu ở trên nhưng model KHÔNG trích ra tên nào (nó bận gắn
  // ngoaiLe) → lấy CHÍNH CÂU đó làm tên để tra. Không làm bước này thì phiên
  // vào tới `dapSlot` với tay trắng, `buocTiepTheo` lại hỏi đúng câu vừa hỏi,
  // và nhân viên gõ "Trung Quốc" mười lần cũng vẫn nhận một câu hỏi.
  if (cauNganTraLoi && trich.ngoaiLe && !trich.khach && !trich.khachMoi) {
    trich = { ...trich, khach: cauChon.trim() };
    delete trich.ngoaiLe;
  }

  // ẢNH CÓ HÀNG MÀ MODEL TRÍCH RỖNG → TRÍCH LẠI RIÊNG KHỐI ẢNH (vá 12/08).
  //
  // CA THẬT 16:53:09 — ảnh danh sách hàng gửi KÈM NGAY LƯỢT ĐẦU:
  //   16:53:09  NV : [Ảnh ~20 dòng hàng] "tạo phiếu nhập hàng … NCC Trung Quốc"
  //   16:53:44  Bot: "Anh/chị nhập những hàng gì ạ?"   ← hỏi thứ đã có trong ảnh
  // Đo bằng test (`anh-luot-dau-16-53.test.ts`): đường ghép chuỗi media LÀNH,
  // câu vào máy có ĐỦ cả ý định lẫn danh sách hàng. Model lấy ý định + tên NCC
  // từ lời nhắn rồi BỎ QUA khối ảnh → `dong` rỗng → `buocTiepTheo` ra
  // `hoi_thieu:'sp'` → đúng câu 16:53:44.
  //
  // `anhGiuaPhien` ở trên KHÔNG cứu được ca này: nó đòi `phien != null`, mà ở
  // lượt ĐẦU chưa có phiên nào. Đó là lỗ hổng còn lại sau vá 11/08.
  //
  // VÌ SAO LÀ CODE CHỨ KHÔNG PHẢI PROMPT — lần thứ TƯ cùng một bài học (lệnh
  // lên đơn 15:06, khối ảnh 23:22, câu ngắn 00:40, giờ là đây). `trich-slot` ĐÃ
  // có ~10 dòng dặn về khối ảnh từ 11/08 mà 12/08 vẫn hỏng y hệt. Lời dặn nằm
  // cuối một prompt ~60 dòng chạy trên model rẻ thì không giữ được. Code thì giữ.
  //
  // HẸP có chủ ý: chỉ chạy khi câu CÓ khối ảnh, máy ĐÃ nhận việc (lên đơn/nhập/
  // sửa, qua regex hoặc model), và `dong` RỖNG. Ảnh vu vơ giữa câu chuyện khác
  // không chạm vào đây. Trích lần hai chỉ tốn thêm ~1 lần gọi model cho đúng ca
  // hỏng, không phải mọi ảnh.
  const daNhanViec =
    regexLen || regexNhap || laLenhSua || trich.lenDon || trich.nhapHang || trich.sua
    || phien != null;
  if (coKhoiAnh(input.cau) && daNhanViec && !trich.dong?.length && !trich.boDong?.length) {
    const chiAnh = chiLayKhoiAnh(input.cau);
    if (chiAnh) {
      // CODE TRƯỚC, MODEL SAU (đổi 12/08 tối, đo ca 18:39-18:41). Bản đầu của
      // hàng rào gọi trichSlot lần hai — đo prod: model nhìn danh sách trần
      // vẫn trả 0 dòng hai lượt liền, không tất định. Nội dung ảnh có hợp
      // đồng format từ `loiDanDocAnh` nên parse bằng code là đường chính;
      // trichSlot lần hai chỉ còn đỡ dòng lệch chuẩn (chữ tự do, không ':').
      let dongAnh: Array<{ sp: string; sl?: number; gia?: number }> = bocDongTuKhoiAnh(chiAnh);
      let nguon = 'code';
      if (!dongAnh.length) {
        const lai = await trichSlot(deps.generate, chiAnh, phien);
        dongAnh = lai.dong ?? [];
        nguon = 'model';
      }
      if (dongAnh.length) {
        logger.info(
          { conversationId: input.conversationId, soDong: dongAnh.length, nguon },
          '[gom-don] lấy dòng hàng từ khối ảnh — model lượt đầu bỏ sót',
        );
        // CHỈ lấy `dong`. Ý định/tên khách đã chốt ở lượt đầu (từ lời nhắn) —
        // khối ảnh không mang tên NCC, đoán từ đó là bịa (ca 11:51).
        trich = { ...trich, dong: dongAnh };
        delete trich.ngoaiLe;
      } else {
        // THẤT BẠI PHẢI CÓ VẾT (bài học cả buổi chiều 12/08): cả code lẫn
        // model đều không ra dòng nào từ khối ảnh — câu hỏi "nhập những hàng
        // gì" sắp lặp lại và log này là đầu mối duy nhất.
        logger.warn(
          { conversationId: input.conversationId, chiAnh: chiAnh.slice(0, 120) },
          '[gom-don] khối ảnh có mặt nhưng KHÔNG bóc được dòng hàng nào',
        );
      }
    }
  }

  // Chế phiên: câu có dấu hiệu sửa (regex HOẶC model trích sua=true) → 'sua'.
  // Phiên đã mở giữ nguyên chế của nó — đang gom đơn mới mà nói "thêm 5 cáp"
  // là thêm vào đơn ĐANG GOM, không phải sửa đơn cũ.
  // Chế NHẬP đứng trước chế SỬA: "thêm 2 dòng vào phiếu nhập" khớp cả hai
  // regex, mà ý nhân viên là nhập hàng.
  phien ??= {
    khachTuKhoa: null,
    dong: [],
    // SỐ HIỆU VIỆC — đặt MỘT LẦN lúc mở phiên, giữ nguyên tới lúc phiên chết.
    // Đây là thứ chặn ca 11:15-11:16 12/08 (hai tin "đúng rồi" cách 8 giây đẻ
    // ra S13834 + S13835): mọi lượt của CÙNG phiên ghi ra cùng một khoá chống
    // trùng, nên lượt thứ hai nhận `da_ton_tai` thay vì tạo đơn mới. Xem
    // PhienGom.viecId. Lấy `seq` của tin MỞ phiên làm số hiệu: nó đã là số
    // nguyên không âm sẵn (băm từ messageId) và duy nhất theo tin mở phiên.
    viecId: input.seq,
    ...(laLenhNhap
      ? { che: 'nhap' as const }
      : laLenhSua || trich.sua ? { che: 'sua' as const } : {}),
  };
  // ẢNH GHÉP LẠI LƯỢT SAU → CHẶN NHÓM TRÙNG LỒNG NHAU (16/08, ca 23:14:44
  // "số lượng trong hình có"): ảnh cũ bị ghép lại, model trích lại từ đầu và
  // đẻ nhóm MỚI trùng dòng đã chọn ("P10 full out" vs "P10 Full Out 260626")
  // — 16 nhóm, lựa chọn cũ bay sạch. Dòng mới mà tên chứa/bị chứa tên dòng
  // đang có thì là CÙNG mặt hàng — bỏ, giữ dòng cũ (đã chọn/đã chốt).
  if (coKhoiAnh(input.cau) && phien.dong.length > 0 && trich.dong?.length) {
    const cuBd = phien.dong.map((d) => boDau(d.tuKhoa));
    const truocLoc = trich.dong.length;
    trich = {
      ...trich,
      dong: trich.dong.filter((d) => {
        const m = boDau(d.sp);
        return !cuBd.some((c) => c.includes(m) || m.includes(c));
      }),
    };
    if (trich.dong!.length < truocLoc) {
      logger.info(
        { conversationId: input.conversationId, boDi: truocLoc - trich.dong!.length },
        '[gom-don] ảnh ghép lại — bỏ dòng trích trùng lồng với dòng đang có',
      );
    }
  }

  if (choPhepTrung) phien.choPhepTrung = true;

  const doiNoiDung = dapSlot(phien, trich);

  // SL TỪ ẢNH DO CODE GHÉP — NGUỒN CHÍNH (16/08, ca 23:12-23:14). Mô tả ảnh
  // CÓ đủ SL theo hợp đồng "tên: SL" ("P10 Full Out 260626: 10.000 tấm") mà
  // model trích slot làm RƠI sl trên đường vào phiên → chọn xong máy lại hỏi
  // "số lượng mỗi loại?" dù hình ghi sẵn — anh Quốc: "số lượng trong hình có".
  // Cùng bài 18:39 12/08: dữ liệu có hợp đồng format thì PARSE BẰNG CODE,
  // model chỉ là người chép. Map theo tên chứa nhau, chỉ điền ô đang trống.
  if (coKhoiAnh(input.cau)) {
    const chiAnhSl = chiLayKhoiAnh(input.cau);
    let daDien = 0;
    for (const da of chiAnhSl ? bocDongTuKhoiAnh(chiAnhSl) : []) {
      if (da.sl == null) continue;
      const spBd = boDau(da.sp);
      const dich = phien.dong.find(
        (d) => d.sl == null && (boDau(d.tuKhoa).includes(spBd) || spBd.includes(boDau(d.tuKhoa))),
      );
      if (dich) { dich.sl = da.sl; daDien += 1; }
    }
    if (daDien > 0) {
      logger.info(
        { conversationId: input.conversationId, daDien },
        '[gom-don] điền SL từ khối ảnh bằng code — model trích làm rơi',
      );
    }
  }

  // BỎ CÁC DÒNG CHƯA KHỚP RỒI ĐI TIẾP (vá 12/08, ca thật 19:48).
  //
  //   19:42  NV : [ảnh] "lên đơn cho anh Led Kim Long các sản phẩm trong ảnh"
  //   19:43  Bot: 'Em không tìm thấy sản phẩm: "QC-LHR15W...", ...'
  //   19:48  NV : "thôi bỏ các sản phẩm không rõ ràng lên đơn đi"
  //
  // Ý nhân viên: vứt mấy dòng máy không khớp được, chốt đơn với phần còn lại.
  // "Các sản phẩm không rõ ràng" không phải TÊN hàng nào nên `boDong` của model
  // không với tới — phải hiểu bằng code: dòng "không rõ ràng" = dòng chưa chốt
  // (khongThay / đang treo ứng viên / chưa tra ra). Anh Quốc: "cảm giác nó tù
  // tù... không linh động" — đây chính là cái tù: người thật hiểu ngay câu đó,
  // máy bắt gõ lại từng tên.
  //
  // HẸP có chủ ý: chỉ chạy khi (1) câu nói BỎ + cụm "không rõ/chưa khớp/không
  // thấy…", (2) phiên có dòng chưa chốt, VÀ (3) còn ít nhất MỘT dòng đã chốt —
  // bỏ đến rỗng đơn thì để máy hỏi tiếp như thường, không lặng lẽ ra đơn 0 dòng.
  const cauKhongDau = boDau(cauChon);
  const boDongMoHo =
    /\bbo\b.{0,40}(khong (ro|khop|thay|chot)|chua (ro|khop|thay|chot|co))/i.test(cauKhongDau);
  if (boDongMoHo && phien.dong.some((d) => !d.daChot) && phien.dong.some((d) => d.daChot)) {
    const truoc = phien.dong.length;
    phien.dong = phien.dong.filter((d) => d.daChot);
    logger.info(
      { conversationId: input.conversationId, boDi: truoc - phien.dong.length, conLai: phien.dong.length },
      '[gom-don] bỏ các dòng chưa khớp theo yêu cầu — giữ phần đã chốt đi tiếp',
    );
  }

  // Luật chiết khấu NV dặn — chạy MỖI lượt (khách có thể chốt ở lượt sau),
  // hàm tự chặn bằng cờ daApLuatCk + điều kiện khachDaChot.
  apLuatChietKhau(phien, deps.luatNhanVien);

  // ── VAT: nối `trich.vat` với danh mục thuế Odoo (sửa 11/08/2026) ────────
  //
  // ĐÂY LÀ CHỖ TỪNG ĐỨT. Đo prod 486 lượt gọi tool 04→11/08: `tra-thue.ts` 0
  // lần chạy. Không phải vì model không chọn tool (nó KHÔNG phải tool cho model,
  // và không cần phải là) — mà vì `dapSlot` chưa bao giờ đọc `trich.vat`, nên
  // `traThueBan()` không ai gọi. Bốn mảnh VAT (trích slot / tra thuế / tóm tắt /
  // ghi tax_id) đều có và đều có test xanh, chỉ thiếu đúng đoạn dây này — tính
  // năng VAT commit hôm nay chưa từng chạy một lần nào.
  //
  // Đặt NGOÀI `dapSlot` vì tra thuế là I/O sang Odoo, còn `dapSlot` là hàm
  // thuần đắp slot — giữ nó thuần thì test replay khỏi phải dựng Odoo giả.
  if (trich.vat != null && phien.vatPhanTram !== trich.vat) {
    phien.vatPhanTram = trich.vat;
    delete phien.vatThueId;
    delete phien.vatKhongTra;

    const thue = await traThueBan({ odoo: deps.odoo }, trich.vat);
    if (thue) {
      phien.vatThueId = thue.id;
    } else {
      // KHÔNG im lặng bỏ thuế: NV tưởng đơn có VAT mà hoá đơn ra không có là
      // sai sổ sách, lúc phát hiện thì đã xuất mất rồi. Cờ này khiến tóm tắt
      // báo rõ "hệ thống không có mức VAT đó".
      phien.vatKhongTra = true;
    }
  }

  // KHÔNG còn khối "đang chờ trả lời kho": máy không hỏi kho nữa nên không có
  // câu trả lời nào để chờ. Nhân viên nói kho thì `dapSlot` (qua trích slot +
  // mapKho) nhận, ở bất kỳ lượt nào.

  // ĐANG CHỜ TRẢ LỜI GIÁ LỆCH (hàng rào 11/08, bug 10:09:33).
  //
  // Máy vừa hỏi "anh/chị báo 8đ nhưng hệ thống 230.000đ — giá đúng là bao
  // nhiêu?". Hai kiểu trả lời:
  //   - báo giá MỚI ("230k") → dapSlot ở trên đã ghi đè donGia và xoá cờ; giá
  //     mới lại đi qua hàng rào một lần nữa, đúng như vậy.
  //   - khẳng định giá cũ ("đúng rồi", "ok", "giá đó chuẩn") → gật cho CHÍNH
  //     con số đó, ghi theo họ. Luật 10/08 không đổi: giá NV báo thắng giá hệ
  //     thống — hàng rào chỉ đòi hỏi lại MỘT lần, không có quyền phủ quyết.
  //
  // Bắt cờ TRƯỚC khi gọi buocTiepTheo để nhân viên không phải trả lời hai lượt.
  if (phien.daHoiGiaLech && !phien.giaLechDaXacNhan && trich.dong?.every((d) => d.gia == null) !== false) {
    if (trich.xacNhan || laXacNhanNgan(cauChon)) phien.giaLechDaXacNhan = true;
  }

  // ĐƯỜNG THOÁT 4 (bug 16:15 11/08): đang chờ chọn khách mà câu không map được
  // và LLM trích không đem lại từ khoá mới → thử chính CÂU của NV: nếu là "tên
  // rõ hơn" ("Anh Long Led" khi đang tra "Long") thì tra lại bằng tên đó.
  //
  // `!trich.khach` LÀ ĐIỀU KIỆN BẮT BUỘC, không phải phòng xa (ca thật 00:50:23
  // ngày 12/08 — hỏng LẦN THỨ BA). Chú thích trên vẫn viết "LLM trích không đem
  // lại từ khoá mới" nhưng CODE chưa bao giờ kiểm điều đó, nên đường thoát chạy
  // cả khi model đã trích ĐÚNG rồi và GHI ĐÈ đè lên kết quả sạch:
  //   NV : "ncc là Trung Quốc"
  //   LLM: khach="Trung Quốc"        ← trích đúng, dapSlot đã đắp vào phiên
  //   ĐT4: tachTenRoHon("ncc là Trung Quốc","Trung Quốc") = "ncc là Trung Quốc"
  //        (câu ≤6 từ, CHỨA từ khoá cũ, DÀI HƠN nó → khớp hết mọi điều kiện)
  //        → khachTuKhoa := "ncc là Trung Quốc"   ← ĐÈ MẤT TÊN SẠCH
  //   Odoo: mẫu `l_ tr_ng q__c` -> 0 kết quả (đo prod; "tr_ng q__c" ra 2 NCC).
  // Bot báo không-thấy rồi quay về câu hỏi mở đầu — đúng lượt 00:50:26.
  //
  // Đường thoát này sinh ra cho ca model trích THIẾU ("Anh Long Led" → "Long").
  // Model trích ĐỦ thì nó không có việc gì để làm: câu thô của nhân viên luôn
  // nhiễu hơn tên model đã bóc sạch, đè vào chỉ có thể làm tệ đi.
  if (!daChon && !trich.khach && phien.khachUngVien && !phien.khachDaChot && phien.khachTuKhoa) {
    const tenRoHon = tachTenRoHon(cauChon, phien.khachTuKhoa);
    if (tenRoHon) {
      phien.khachTuKhoa = tenRoHon;
      delete phien.khachUngVien;
      delete phien.khachUngVienConNua;
      delete phien.khachKhongThay;
    }
  }

  // KHÔNG còn khối "đổi nội dung thì huỷ cái gật cũ": bỏ bước chốt (11/08) thì
  // không còn cái gật nào để huỷ. Đơn không bao giờ nằm chờ giữa lúc tóm tắt và
  // lúc ghi nữa — đủ slot là ghi ngay trong chính lượt đó.

  // 2. Vòng quyết định: tra cứu chạy xong thì hỏi lại bộ não lần nữa.
  //    Trần 3 vòng: tra_cuu chỉ có thể xảy ra 1 lần cho mỗi loạt từ khoá mới,
  //    vòng sau chắc chắn ra hành động nói/tạo — trần chỉ là hàng rào lập trình sai.
  let hd = buocTiepTheo(phien);
  // Lượt này có thật sự hỏi Odoo lần nào không — dùng ở guard chống lặp cuối
  // hàm để phân biệt "danh sách vừa tra ra" với "NV gõ thứ máy không hiểu".
  let daTraLuotNay = false;
  for (let i = 0; hd.loai === 'tra_cuu' && i < 3; i++) {
    daTraLuotNay = true;
    // PHIẾU NHẬP hay ĐƠN BÁN? Suy theo thứ tự chắc chắn: mã NV đọc (P… = mua)
    // → mã đơn-vừa-lên → câu có chữ "phiếu/nhập" (16/08, ca P04525).
    const maDangBan = trich.maDon ?? (phien.che === 'sua' ? donVuaLen?.maDon : undefined);
    const loaiDon: 'ban' | 'mua' = maDangBan?.startsWith('P') ? 'mua'
      : maDangBan ? 'ban'
        : /phiếu|phieu|nhập|nhap/i.test(cauChon) ? 'mua' : 'ban';
    await chayTraCuu(deps, phien, hd, {
      conversationId: input.conversationId,
      loaiDon,
      // NV không đọc mã thì lấy mã ĐƠN VỪA LÊN — chính là cái đơn họ đang bàn
      // ("giá 1800 đó" ngay sau S13848 là sửa S13848, không phải đơn nào khác).
      ...(trich.maDon ? { maDon: trich.maDon }
        : phien.che === 'sua' && donVuaLen ? { maDon: donVuaLen.maDon } : {}),
    });
    hd = buocTiepTheo(phien);
  }

  // ÁP ĐƯỜNG TẮT SỬA GIÁ (14/08) — chạy SAU vòng tra để dòng thật của đơn đã
  // nằm trong phien.donSua.dong. Khớp dòng theo thứ tự chắc chắn giảm dần:
  // dòng đang treo chờ giá → khớp tên → đơn chỉ có một dòng.
  if (cauSuaGia && phien.che === 'sua' && phien.donSua?.dong?.length && phien.dong.length === 0) {
    const dsDong = phien.donSua.dong;
    const theoTen = cauSuaGia.ten
      ? dsDong.filter((d) => {
          const tenBd = boDau(d.ten);
          return cauSuaGia.ten!.split(/\s+/).every((w) => tenBd.includes(w));
        })
      : [];
    const dich = phien.dongChoGia != null
      ? dsDong.find((d) => d.spId === phien.dongChoGia)
      : theoTen.length === 1 ? theoTen[0]
        : !cauSuaGia.ten && dsDong.length === 1 ? dsDong[0]
          : undefined;
    if (dich && cauSuaGia.gia != null) {
      delete phien.dongChoGia;
      phien.dong.push({
        tuKhoa: dich.ten, sl: dich.sl, donGia: cauSuaGia.gia,
        daChot: { id: dich.spId, ten: dich.ten, gia: dich.gia },
      });
      hd = buocTiepTheo(phien); // đủ slot → sua_don ngay lượt này
    } else if (dich) {
      // Biết dòng, chưa biết giá — hỏi đúng MỘT con số, treo dòng chờ.
      phien.dongChoGia = dich.spId;
      const tin = `${dich.ten} đang ${dich.gia.toLocaleString('vi-VN')}đ (SL ${dich.sl.toLocaleString('vi-VN')}) — anh/chị muốn sửa giá thành bao nhiêu ạ?`;
      phien.tinCuoi = tin;
      await ghiPhien(phien);
      await deps.guiTin(tin);
      return true;
    } else {
      // Có giá mà không rõ dòng nào (đơn nhiều dòng) — liệt kê để NV gọi tên.
      const ds = dsDong.map((d) => `- ${d.ten} · ${d.gia.toLocaleString('vi-VN')}đ × ${d.sl.toLocaleString('vi-VN')}`).join('\n');
      const nhanDon = phien.donSua.loai === 'mua' ? 'Phiếu nhập' : 'Đơn';
      const tin = `${nhanDon} ${phien.donSua.ma} đang có:\n${ds}\nAnh/chị nhắn "sửa giá <tên hàng>${cauSuaGia.gia != null ? ` ${cauSuaGia.gia.toLocaleString('vi-VN')}đ` : ''}" giúp em ạ.`;
      phien.tinCuoi = tin;
      await ghiPhien(phien);
      await deps.guiTin(tin);
      return true;
    }
  }

  // TẠO KHÁCH MỚI (bug 3 demo 10/08) — tra không ra mà NV đã cho tên thì tạo
  // rồi chạy tiếp NGAY trong lượt này, không bắt nhân viên nhắc lại lần nữa.
  if (hd.loai === 'tao_khach') {
    const t0 = Date.now();
    const km = phien.khachMoi!;
    const kq = await taoKhachHang(
      { odoo: deps.odoo },
      {
        ten: km.ten,
        ...(km.sdt ? { dien_thoai: km.sdt } : {}),
        ...(km.diaChi ? { dia_chi: km.diaChi } : {}),
        // Tới nhánh này nghĩa là NHÂN VIÊN đã nói rõ "khách mới" — bỏ phanh
        // chặn trùng tên, nếu không bot từ chối tạo rồi bắt chọn lại trong
        // danh sách người cũ, đúng vòng lặp của bug 17:08 10/08.
        bo_phanh_trung_ten: true,
        [CHIA_BO_PHANH]: true as const,
      },
    );
    deps.ghiLog({
      toolName: 'tao_khach_hang', input: km, output: dinhDangTaoKhach(kq),
      thanhCong: kq.trangThai === 'ok', durationMs: Date.now() - t0, iteration: 0,
    });
    if (kq.trangThai === 'ok') {
      phien.khachDaChot = { id: kq.khach.id, ten: kq.khach.ten, ma: kq.khach.ma, dienThoai: km.sdt ?? null };
      delete phien.khachKhongThay;
      delete phien.khachMoi;
      hd = buocTiepTheo(phien);
    } else {
      await deps.guiTin(`Em chưa tạo được khách mới: ${kq.lyDo}`);
      await ghiPhien(phien);
      return true;
    }
  }

  // Chế SỬA: đủ rõ thì ghi THẲNG, không cổng chốt (anh Quốc chốt 08/08).
  if (hd.loai === 'sua_don') {
    const kq = await suaDonVaBao(deps, phien);
    if (kq === 'xong') await ketThucPhien(phien);
    else await ghiPhien(phien);
    return true;
  }

  // PHIẾU NHẬP HÀNG (11/08) — đủ NCC + hàng + SL là GHI THẲNG, không hỏi chốt,
  // nhất quán với việc bỏ bước chốt của lên đơn (commit 7d568b90).
  if (hd.loai === 'tao_don_mua') {
    const kq = await taoPhieuNhapVaBao(deps, phien, input, daBoPhienCu);
    if (kq === 'xong') {
      await ketThucPhien(phien);
      return true;
    }
    // ĐƯỜNG THOÁT 3 — lỗi hai lần liên tiếp thì bỏ phiên (chống kẹt 10/08).
    phien.soLanLoi = (phien.soLanLoi ?? 0) + 1;
    if (phien.soLanLoi >= 2) {
      await xoaPhien(deps.prisma, input.conversationId);
      await deps.guiTin(
        'Em bỏ phiếu nhập đang gom rồi ạ — nó bị kẹt. Anh/chị làm lại từ đầu giúp em nhé.',
      );
      return true;
    }
    await ghiPhien(phien);
    return true;
  }

  if (hd.loai === 'tao_don') {
    // KHÔNG còn cổng xác nhận ở đây (bỏ 11/08). Anh Quốc, nguyên văn: "tôi
    // muốn bỏ luôn cái bước chốt đơn này được không?, nếu mọi thứ đã rõ ràng
    // thì lên đơn báo giá luôn" — và khi được hỏi có giữ ngoại lệ nào không:
    // "Bỏ hoàn toàn, không hỏi gì nữa".
    //
    // Đủ slot = lên đơn. Tóm tắt vẫn in, nhưng nằm trong tin BÁO ĐƠN ĐÃ LÊN
    // (xem taoDonVaBaoGia) chứ không phải một lượt chờ gật riêng.
    //
    // LUẬT CHIẾT KHẤU NV DẶN — GỌI LẠI NGAY TRƯỚC KHI BUILD ĐƠN (vá lần 2
    // trong ngày 12/08, e2e bắt được trước khi báo): lời gọi sau dapSlot chạy
    // TRƯỚC vòng tra_cuu, mà ca 1-lượt ("lên đơn cho Led Kim Long 10 cái…")
    // thì khách chỉ được CHỐT bên trong vòng tra đó rồi đơn ra luôn cùng
    // lượt — luật chưa kịp áp. Đây là điểm hội tụ cuối: khách chắc chắn đã
    // chốt, dòng đơn chưa build. Cờ daApLuatCk giữ cho hai lời gọi không
    // giẫm nhau.
    apLuatChietKhau(phien, deps.luatNhanVien);
    const kq = await taoDonVaBaoGia(deps, phien, input, daBoPhienCu);
    if (kq === 'xong') {
      await ketThucPhien(phien);
      return true;
    }
    // ĐƯỜNG THOÁT 3 — tạo đơn LỖI hai lần liên tiếp thì bỏ phiên.
    // Bug demo 10/08: lỗi lặp 5 lần liền, nhân viên gõ gì cũng ra một câu.
    phien.soLanLoi = (phien.soLanLoi ?? 0) + 1;
    if (phien.soLanLoi >= 2) {
      await xoaPhien(deps.prisma, input.conversationId);
      await deps.guiTin(
        'Em bỏ đơn đang gom rồi ạ — nó bị kẹt. Anh/chị lên lại từ đầu giúp em nhé.',
      );
      return true;
    }
    await ghiPhien(phien);
    return true;
  }

  // 3. Hành động nói: render template, cập nhật cờ, lưu phiên.
  const loiBao = daBoPhienCu ? 'Em bỏ đơn đang gom dở nhé.\n' : '';
  let tin = loiBao + renderLoiNhan(hd, phien);
  // GUARD CHỐNG LẶP NGUYÊN VĂN (bug 16:15 11/08): gửi lại y hệt tin trước là
  // bot "điếc" — NV gõ gì cũng nhận một tường chữ. Trùng thì đổi thành câu
  // ngắn chỉ rõ các đường thoát. So với tin ĐÃ GỬI gần nhất nên hai lượt liên
  // tiếp không bao giờ giống hệt nhau.
  //
  // TRỪ KHI NHÂN VIÊN VỪA NHẮC LẠI ĐÚNG TÊN ĐANG CHỜ CHỌN (sửa 12/08).
  //
  // Ca thật 00:50:23 — lượt cuối của chuỗi hỏng LẦN THỨ BA:
  //   00:40:37  Bot: "Có 2 nhà cung cấp tên Trung Quốc: 1) … 2) … chọn giúp em"
  //   00:50:23  NV : "ncc là Trung Quốc"        ← nhắc lại chính cái tên đó
  //   00:50:26  Bot: "Em vẫn chưa khớp được … chọn SỐ THỨ TỰ trong DANH SÁCH TRÊN"
  //
  // Guard sinh ra cho ca "NV gõ thứ máy không hiểu" (16:15 11/08) — lúc đó lặp
  // lại tường chữ là vô ích. Nhưng đây KHÔNG phải ca đó: nhân viên trả lời đúng
  // trọng tâm, chỉ là chưa chọn số. Danh sách vẫn đang treo và VẪN LÀ câu trả
  // lời đúng cho họ; nuốt nó đi rồi bảo "chọn trong danh sách trên" là chỉ tới
  // một chỗ vừa bị chính mình xoá — nhân viên nhìn lên không thấy gì để chọn.
  //
  // Điều kiện HẸP, đủ hai vế mới tha:
  //   · lượt này ra `hoi_chon` (danh sách đang thật sự treo), VÀ
  //   · câu của NV có mang tên khớp từ khoá đang tra (`trich.khach`) hoặc lượt
  //     này vừa chạy tra cứu — tức NV nói đúng việc, không phải gõ linh tinh.
  // Câu vô nghĩa lặp lại không thoả vế hai nên vẫn rơi vào guard như cũ; test
  // "danh sách trên" khoá đúng chỗ đó.
  const nhacLaiDungViec = hd.loai === 'hoi_chon' && (daTraLuotNay || trich.khach != null);
  if (tin === phien.tinCuoi && !nhacLaiDungViec) {
    // ĐƯỜNG THOÁT PHẢI ĐÚNG NGỮ CẢNH (sửa 11/08).
    //
    // Ca thật 23:16:18: bot đang hỏi NHÀ CUNG CẤP nhưng đọc nguyên văn câu của
    // luồng khách — "gõ SĐT hoặc mã KH của khách", "nói khách mới nếu khách
    // chưa có". Sai việc, và "khách mới" ở chế nhập còn VÔ NGHĨA: bot không
    // được phép tự tạo NCC (gắn điều khoản thanh toán, công nợ phải trả, MST),
    // nên bày cho nhân viên một đường thoát không tồn tại.
    const laNhap = phien.che === 'nhap';
    // CHỈ MỜI "CHỌN SỐ THỨ TỰ" KHI THẬT SỰ CÓ DANH SÁCH ĐÁNH SỐ (sửa 12/08).
    //
    // Ca thật 00:50:26: bot bảo "Anh/chị chọn SỐ THỨ TỰ trong danh sách trên"
    // trong khi CHƯA TỪNG in danh sách nào — cả hai lượt trước đều là câu hỏi
    // trơ ("Phiếu nhập này của nhà cung cấp nào ạ?"). Nhân viên nhìn ngược lên
    // không thấy số nào để gõ; câu hướng dẫn chỉ tới một chỗ không tồn tại và
    // họ kẹt luôn ở đó 10 phút.
    //
    // `khachUngVien` là nguồn sự thật DUY NHẤT cho câu mời đó: chính nó sinh ra
    // danh sách đánh số trong `renderLoiNhan`. Không có nó thì đường thoát phải
    // là "gõ lại tên / gõ mã", tức thứ nhân viên làm được ngay.
    const coDanhSachDanhSo = Boolean(phien.khachUngVien?.length);
    const moiChonSo = coDanhSachDanhSo ? 'chọn SỐ THỨ TỰ trong danh sách trên, hoặc ' : '';
    // KHÁCH ĐÃ CHỐT, CHỈ CÒN SP TREO → ĐỪNG BÀY ĐƯỜNG THOÁT CỦA KHÁCH (12/08).
    //
    // Ca thật 11:53-11:58: sau khi "1" chốt xong khách, thứ duy nhất còn treo là
    // danh sách a/b/c của sản phẩm. Câu thoát cũ vẫn đọc nguyên văn luồng khách
    // — "gõ SĐT hoặc mã KH của khách", "nói khách mới nếu khách chưa có" — trong
    // khi khách đã xong từ lượt trước. Nhân viên đang bí ở chỗ CHỌN HÀNG mà bot
    // chỉ họ đi làm lại phần đã xong; đó là một lượt vứt đi và là lý do vòng hỏi
    // kéo tới 5 phút. Cùng họ lỗi với ca 23:16:18 11/08 (bot hỏi NCC mà đọc lời
    // của luồng khách) — đường thoát phải khớp việc ĐANG treo.
    const chiConSpTreo =
      !coDanhSachDanhSo && phien.dong.some((d) => d.ungVien?.length);
    // NCC/KHÁCH ĐÃ CHỐT THÌ ĐƯỜNG THOÁT KHÔNG ĐƯỢC HỎI LẠI NCC/KHÁCH (vá 12/08).
    //
    // ĐÂY LÀ GỐC CỦA CA "PHIÊN LÙI BƯỚC" 11:50→11:52 12/08 — không phải đường
    // thoát 4 như chẩn đoán trước (đường thoát 4 đã có `!phien.khachDaChot` từ
    // trước, đo lại thấy nó KHÔNG chạy trong ca này):
    //
    //   11:50:51  Bot: "Anh/chị nhập những hàng gì ạ?"   ← NCC đã chốt xong
    //   11:51:13  NV : [ảnh 20 dòng hàng] "đây lấy từ trong ảnh ra"
    //             model trả `ngoaiLe` (đo prod) → KHÔNG trích được dòng hàng nào
    //             → `buocTiepTheo` lại ra `hoi_thieu: sp`, render RA ĐÚNG câu cũ
    //             → `tin === phien.tinCuoi` → rơi vào guard chống lặp này
    //   11:52:46  Bot: 'Em vẫn chưa khớp được "…" với NHÀ CUNG CẤP nào ạ…'
    //
    // Guard chỉ nhìn `che === 'nhap'` rồi đọc nguyên văn lời của bước NCC, bất kể
    // NCC đã chốt từ lượt trước. Phiên KHÔNG mất NCC (`khachDaChot` còn nguyên
    // trong DB) — chỉ có TIN GỬI RA kéo nhân viên ngược về bước đã xong, nên họ
    // gõ lại tên NCC và vòng hỏi kéo dài thêm mấy phút.
    //
    // Cùng một bài học với hai hàng rào ngay trên (`chiConSpTreo`, `moiChonSo`):
    // đường thoát phải khớp việc ĐANG treo. Ở đây việc đang treo là HÀNG HOÁ.
    const khachDaXong = phien.khachDaChot != null;
    // Trích lời NHÂN VIÊN, không phải chuỗi thô: chuỗi thô mang cả khối
    // `[Khách gửi ảnh…]` nội bộ và bị chặt giữa chữ — xem `trichLoiNhanVien`.
    // Nhân viên chỉ gửi mỗi ảnh (không kèm chữ) thì phần trích rỗng: bỏ luôn vế
    // 'Em vẫn chưa khớp được "…"' thay vì nhắn ra một cặp ngoặc trống.
    const loiNv = trichLoiNhanVien(cauChon);
    const chuaKhop = (cai: string): string =>
      loiNv ? `Em vẫn chưa khớp được "${loiNv}" với ${cai} nào ạ. ` : `Em chưa rõ ${cai} ạ. `;
    // CHẾ SỬA có đường thoát RIÊNG (14/08, ca 22:33): việc đang treo là "sửa
    // gì trên đơn" — đọc kịch bản luồng khách ("gõ SĐT hoặc mã KH") là kéo NV
    // về một bước không tồn tại trong luồng này.
    const dangSuaDon = phien.che === 'sua' && phien.donSua != null;
    tin = dangSuaDon
      ? chuaKhop('dòng nào trên đơn') +
        `Anh/chị nhắn "sửa giá <tên hàng> <giá mới>" (vd: "sửa giá nguồn 175k"), ` +
        '"<tên hàng> + SL mới", hoặc "huỷ" giúp em ạ.'
      : khachDaXong
      ? chuaKhop('hàng nào') +
        (chiConSpTreo
          ? 'Anh/chị gõ CHỮ CÁI đầu dòng trong danh sách trên (vd: a), hoặc gõ lại tên hàng ' +
            'đầy đủ hơn, hoặc "huỷ" để làm lại giúp em.'
          : 'Anh/chị gõ giúp em TÊN HÀNG + SỐ LƯỢNG (mỗi món một dòng, vd: "nguồn NB-12V400W ' +
            '3030 cái"), hoặc "huỷ" để làm lại giúp em.')
      : laNhap
        ? chuaKhop('nhà cung cấp') +
          `Anh/chị ${moiChonSo}gõ lại TÊN NCC có dấu đầy đủ hoặc mã NCC (vd NCC000001), ` +
          'hoặc "huỷ" để làm lại giúp em. NCC chưa có trong hệ thống thì nhờ kế toán tạo trước ạ.'
        : chuaKhop('lựa chọn') +
          `Anh/chị ${moiChonSo}gõ SĐT hoặc mã KH của khách, ` +
          'nói "khách mới" nếu khách chưa có, hoặc "huỷ" để làm lại giúp em.';
  }
  phien.tinCuoi = tin;
  await deps.guiTin(tin);
  // Đánh dấu vừa hỏi giá lệch: câu kế của NV là câu trả lời cho chính nó.
  phien.daHoiGiaLech = hd.loai === 'hoi_gia_lech';
  if (hd.loai === 'khong_thay') {
    // Đã báo không thấy — dọn phần hỏng để NV gõ lại từ khoá khác. NHƯNG giữ
    // lại TÊN vừa báo (daBaoKhongThay): "thêm mới các sản phẩm đó luôn" ở
    // lượt sau cần biết "đó" là gì (ca 09:52 17/08).
    if (phien.khachKhongThay) { phien.khachTuKhoa = null; delete phien.khachKhongThay; }
    // Giữ CẢ SL gốc (17/08 vòng 2): "SP X 7 cái" → không thấy → tạo mới mà
    // quên SL là bắt NV đọc lại con số họ đã nói.
    const tenVuaBao = phien.dong.filter((d) => d.khongThay).map((d) => ({ ten: d.tuKhoa, sl: d.sl }));
    if (tenVuaBao.length) phien.daBaoKhongThay = tenVuaBao;
    phien.dong = phien.dong.filter((d) => !d.khongThay);
  }
  await ghiPhien(phien);
  return true;
}
