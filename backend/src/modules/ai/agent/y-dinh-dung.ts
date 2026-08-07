// SPDX-License-Identifier: AGPL-3.0-or-later
// Ý ĐỊNH DỪNG — người dùng bảo thôi thì bot KHÔNG được ghi thêm gì vào Odoo.
//
// Bug thật 05/08/2026 21:23, nặng nhất trong nhóm bug lên đơn:
//
//   21:23:18  bot: "Bạn có muốn thay đổi số lượng thành 10 cái không?"
//   21:23:32  NV : "tôi không muốn mua nữa đâu"
//   21:23:35  bot: gọi tao_don_nhap → tạo S13799, 780.000đ   ← NGƯỢC HẲN ý người
//
// Bot làm ngược lời người dùng vừa nói, ba giây sau. Prompt lúc đó bảo "hãy
// LÀM TIẾP việc đang dở" và model nghe theo.
//
// VÌ SAO PHẢI Ở CODE (quy tắc 2 trong KIEN-TRUC-AGENT.md): prompt là lời
// khuyên, model có thể lờ đi — nó vừa chứng minh điều đó. Hậu quả ở đây là ghi
// dữ liệu sai vào ERP, thứ phải dò và xoá bằng tay. Hàng rào phải là code.
//
// PHẠM VI HẸP CÓ CHỦ Ý: chỉ chặn tool GHI, và chỉ khi tin MỚI NHẤT có ý dừng.
// Không đụng tool đọc — người nói "thôi khỏi lên đơn, cho xem giá thôi" vẫn
// phải tra được giá.

/**
 * Cụm từ báo hiệu dừng lại. Cố ý NGẮN và RÕ — mỗi cụm đều là lời từ chối
 * thẳng, không phải câu lấp lửng.
 *
 * KHÔNG thêm những cụm mơ hồ ("chưa", "để xem", "hmm"): chặn nhầm một lệnh
 * thật cũng phiền như ghi nhầm một đơn.
 */
const CUM_DUNG = [
  // "không mua nữa" / "không muốn mua nữa" / "không định mua nữa"…
  // Bắt bằng cụm ĐUÔI "mua nua" gắn với phủ định ở đầu, thay vì liệt kê hết
  // các biến thể ở giữa — câu gốc gây bug là "tôi KHÔNG MUỐN mua nữa đâu",
  // liệt kê kiểu cũ ("khong mua nua") không bắt được vì có chữ "muốn" chen vào.
  'mua nua', 'lay nua', 'dat nua', 'can nua',
  'thoi khong', 'thoi ko', 'thoi khoi', 'huy don', 'huy di', 'huy nhe',
  'bo di', 'bo qua di', 'dung lai', 'khoan da', 'khoan cai',
  'de sau', 'de hom sau', 'de mai', 'thoi dung', 'nham roi bo',
];

/** Từ phủ định phải đứng TRƯỚC các cụm đuôi ở trên mới tính là lời dừng. */
const PHU_DINH = ['khong', 'ko', 'chang', 'chan', 'thoi'];

/** Cụm đuôi cần có phủ định đi kèm (khác với cụm tự nó đã rõ nghĩa dừng). */
const CAN_PHU_DINH = new Set(['mua nua', 'lay nua', 'dat nua', 'can nua']);

/** Bỏ dấu để bắt cả khi người ta gõ không dấu. */
function boDau(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

/**
 * Tin này có phải lời DỪNG/HUỶ không?
 *
 * Chỉ xét tin MỚI NHẤT, không xét lịch sử: người nói "lúc nãy định thôi nhưng
 * giờ lấy đi" là ĐANG ĐẶT, không phải đang huỷ.
 */
export function laYDinhDung(noiDung: string): boolean {
  const t = boDau(String(noiDung ?? ''));
  if (!t.trim()) return false;

  return CUM_DUNG.some((cum) => {
    const i = t.indexOf(cum);
    if (i < 0) return false;
    // Cụm tự nó đã rõ nghĩa dừng ("huy don", "thoi khoi") → nhận luôn.
    if (!CAN_PHU_DINH.has(cum)) return true;
    // Cụm đuôi ("mua nua") chỉ tính khi có phủ định đứng trước trong cùng câu —
    // "không muốn MUA NỮA" là dừng, còn "giờ MUA NỮA đi" thì không.
    const truoc = t.slice(0, i);
    return PHU_DINH.some((p) => truoc.includes(p));
  });
}

/** Tool GHI vào Odoo — thứ bị chặn khi người dùng bảo dừng. */
export const TOOL_GHI = ['tao_don_nhap', 'tao_khach_hang', 'gui_hoa_don', 'sua_chiet_khau', 'sua_don'];

/** Tên tool này có ghi vào Odoo không (chịu được tiền tố `default_api.`). */
export function laToolGhi(tenTool: string): boolean {
  const ten = String(tenTool ?? '').split('.').pop() ?? '';
  return TOOL_GHI.includes(ten);
}

/**
 * Câu trả lời có KHOE đã ghi vào hệ thống không?
 *
 * Đo thật 05/08/2026: `tao_don_nhap` bị hàng rào chặn, nhưng bot vẫn đáp "Tôi
 * đã cập nhật đơn S13797 thành 10 cái" — nhân viên đọc xong tin là việc đã
 * xong, không sửa gì nữa. Chặn lời khoe khi KHÔNG có tool ghi nào chạy.
 *
 * Chỉ bắt lời khẳng định ĐÃ LÀM XONG. Không bắt câu hỏi ("cập nhật thành 10
 * cái nhé?") hay lời hứa ("em cập nhật ngay đây") — hai loại đó vô hại.
 */
export function khoeDaGhi(traLoi: string): boolean {
  const t = boDau(String(traLoi ?? ''));
  return [
    'da tao don', 'da len don', 'da ghi nhan don', 'da luu don', 'da dat don',
    'da cap nhat don', 'da sua don', 'da doi don', 'da chot don',
    'da tao khach', 'da them khach', 'da cap nhat so luong',
    'don da duoc tao', 'don da duoc cap nhat',
  ].some((c) => t.includes(c));
}

/**
 * Câu trả lời có KHOE đã/đang GỬI ẢNH hoá đơn không?
 *
 * Bug thật 07/08/2026 (DNH36805, trong nhóm): nhân viên "có gửi luôn đi", bot
 * đáp "Dạ, em gửi lại ảnh đơn hàng DNH36805..." nhưng chạy 0 tool — ẢNH KHÔNG
 * hề được gửi. `khoeDaGhi` không bắt vì câu này nói về GỬI ẢNH, không phải ghi
 * đơn; lại còn ở thì hiện tại ("em gửi") chứ không phải "đã ...".
 *
 * Bắt CẢ thì hiện tại/tương lai lẫn quá khứ — vì bot bịa hay dùng "em gửi lại
 * ảnh" như một lời khẳng định hành động đang xảy ra. Caller phải đối chiếu với
 * ảnh THẬT: chỉ chặn khi khoe mà KHÔNG có ảnh nào được tạo/gửi.
 */
export function khoeDaGuiAnh(traLoi: string): boolean {
  const t = boDau(String(traLoi ?? ''));
  return [
    'gui anh', 'gui lai anh', 'gui hinh', 'gui lai hinh', 'gui hoa don',
    'gui lai hoa don', 'gui anh hoa don', 'gui anh don', 'gui anh don hang',
    'da gui anh', 'da gui hoa don', 'da gui hinh',
  ].some((c) => t.includes(c));
}

/** Câu tool trả về khi bị chặn — nói cho model biết vì sao và phải làm gì. */
export function lyDoChan(tenTool: string): string {
  return (
    `KHÔNG thực hiện ${tenTool}: người dùng vừa nói DỪNG/HUỶ ở tin cuối. ` +
    'Hãy xác nhận đã dừng, KHÔNG ghi gì thêm vào hệ thống. ' +
    'Nếu lượt trước đã lỡ tạo đơn, nói rõ mã đơn để nhân viên huỷ trên Odoo.'
  );
}
