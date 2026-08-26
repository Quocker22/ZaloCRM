// SPDX-License-Identifier: AGPL-3.0-or-later
// ẢNH GỬI TRƯỚC, LỆNH TAG SAU — ca thật nhóm "Dậy học cho AI" 16:19 26/08/2026:
//
//   16:19:29  Quyết: [ảnh hoá đơn cũ INV/2026/028232]      ← KHÔNG tag bot
//   16:19:53  Quyết: "@Tiểu Mã Nelia đơn như này nhưng số lượng 20m mỗi loại"
//   16:21:09  Bot  : "…cho em xin thông tin cụ thể loại hàng và mã đơn…"
//   16:22:19  Quyết: "@Viết Quốc vẫn chưa dùng ảnh để đọc đc :')"
//
// Ảnh không tag thì cổng nhóm bỏ qua (đúng — nhân viên gửi ảnh cho khách suốt
// ngày); lệnh tag sau đó nói "đơn như này" mà bot không có "này" nào để nhìn.
// Người thật gửi ảnh rồi mới gõ lệnh là chuyện rất thường; bắt họ gửi lại ảnh
// kèm caption (như 16:23:14) là bắt họ học cách nói chuyện với máy.
//
// Luật: lệnh tag KHÔNG kèm ảnh, câu có CHỈ DẤU đang nói về một thứ vừa gửi
// ("như này", "trong ảnh", "khách trong hình", hoặc câu rất ngắn kiểu "đây e")
// → lấy ảnh GẦN NHẤT của CHÍNH người đó trong CỬA SỔ ngắn, đọc, ghép vào lệnh
// y như ảnh có caption (`ghepCauTuAnh`). Cùng nếp với tag trống lấy tin trước
// (`gopTinTruocKhiTag`) và PDF lấy lời nhắn trước (`docVaChuyenTiep`).
//
// Không có chỉ dấu → KHÔNG ghép: nhân viên gửi ảnh sản phẩm cho khách rồi tag
// bot hỏi công nợ là hai việc khác nhau; ghép bừa vừa tốn một lần đọc ảnh vừa
// nhét dữ liệu lạ vào lệnh.

/** Ảnh gửi trước lệnh bao lâu thì còn được coi là "cái này". */
export const CUA_SO_ANH_TRUOC_MS = 3 * 60_000;

const CHI_DAU = [
  /như (này|vậy|thế|trên|hình|ảnh)/i,
  /(trong|theo|ở|từ) (ảnh|hình)/i,
  /(ảnh|hình) (trên|này|kia|vừa|đó|đây)/i,
  /(đơn|cái|hàng|khách|mã|giá|bảng|hoá đơn|hóa đơn|phiếu) (này|đó|kia|trên)/i,
  /đọc (ảnh|hình)/i,
  /lấy (từ|trong|theo) (ảnh|hình)/i,
];

/** Câu rất ngắn kiểu "đây", "đây e", "đây ạ", "này nhé" — chỉ về thứ vừa gửi. */
const CAU_NGAN_CHI = /^\s*(đây|này|đó)(\s+(e|em|a|anh|ạ|nhé|nha|ne|nè|ơi|bot))*\s*[.!]?\s*$/i;

/**
 * Câu lệnh có đang chỉ về một thứ "vừa gửi" không?
 *
 * Bỏ tag/mention trước khi xét (câu thật mang "@Tiểu Mã Nelia" ở đầu).
 */
export function canAnhTruocDo(noiDung: string): boolean {
  // Chỉ bỏ MỖI token tag ("@bot", "@Tiểu") — bỏ luôn 2 chữ sau tag thì nuốt
  // mất "đơn như" của chính câu thật (test khoá ca 16:19).
  const cau = String(noiDung ?? '').replace(/@\S+/g, ' ').trim();
  if (!cau) return false;
  if (CAU_NGAN_CHI.test(cau)) return true;
  return CHI_DAU.some((r) => r.test(cau));
}

export interface AnhTruocDo {
  url: string;
  /** Thời điểm gửi ảnh. */
  sentAt: Date;
}

export interface GhepAnhTruocDoDeps {
  /** Ảnh GẦN NHẤT của chính người gửi trong hội thoại (caller lọc theo senderUid). */
  timAnh: () => Promise<AnhTruocDo | null>;
  /** Đọc ảnh → chữ; null = đọc hỏng. */
  docAnh: (url: string, chuThich: string) => Promise<string | null>;
  /** Ghép chữ đọc được + lời nhắn theo đúng nếp ảnh có caption. */
  ghep: (chuThich: string, moTa: string) => string;
  bayGio?: () => number;
}

/**
 * Trả câu lệnh ĐÃ GHÉP nội dung ảnh, hoặc null khi không có gì để ghép
 * (không có chỉ dấu / không có ảnh / ảnh quá cũ / đọc hỏng). Null nghĩa là
 * "để nguyên câu", không bao giờ là lỗi chặn lượt.
 */
export async function ghepAnhTruocDo(deps: GhepAnhTruocDoDeps, noiDung: string): Promise<string | null> {
  if (!canAnhTruocDo(noiDung)) return null;
  const anh = await deps.timAnh().catch(() => null);
  if (!anh) return null;
  const tuoi = (deps.bayGio ?? Date.now)() - anh.sentAt.getTime();
  if (tuoi < 0 || tuoi > CUA_SO_ANH_TRUOC_MS) return null;
  const moTa = await deps.docAnh(anh.url, noiDung).catch(() => null);
  if (!moTa) return null;
  return deps.ghep(noiDung, moTa);
}
