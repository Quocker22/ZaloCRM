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

  // CHỦ NGỮ phải là BOT. Bug thật 23:38:44 10/08: khách gửi ảnh sản phẩm hỏi
  // "shop có cái này không", bot đọc ảnh đúng nhưng câu trả lời có chữ "gửi
  // ảnh" → hàng rào chặn, văng nguyên thông báo NỘI BỘ ra cho khách.
  //
  // Cụm "gui anh" trần khớp cả khi bot XIN khách gửi ("anh gửi ảnh giúp em") —
  // nghĩa ngược hẳn. Trước 10/08 bot chưa đọc được ảnh nên hiếm khi nói câu
  // này; giờ đọc được thì đụng liên tục.
  //
  // Chỉ chặn khi có "em/mình/shop" (hoặc "đã") ĐỨNG NGAY TRƯỚC động từ gửi.
  // "anh/chị/bạn gửi" là bảo người khác gửi → cho qua.
  const CHU_NGU_BOT = '(?:em|minh|shop|ben em|da)';
  const DO_GUI = '(?:anh|hinh|hoa don)';
  const re = new RegExp(
    `\\b${CHU_NGU_BOT}\\s+(?:da\\s+|se\\s+|dang\\s+)?gui\\s+(?:lai\\s+)?${DO_GUI}`,
    'i',
  );
  return re.test(t);
}

/**
 * Câu trả lời có KHOE đã/đang GỬI FILE TÀI LIỆU (catalog, datasheet PDF) không?
 *
 * VÌ SAO CẦN THÊM, bên cạnh `khoeDaGuiAnh`: từ 11/08/2026 bot gửi được cả FILE
 * qua tool `gui_tai_lieu`, không chỉ ẢNH hoá đơn. `khoeDaGuiAnh` chỉ soi
 * "gửi ảnh/hình/hoá đơn", nên câu "em gửi catalog cho anh rồi" lọt thẳng qua.
 *
 * Đây là lần thứ BA cùng một dạng bịa: `khoeDaGhi` (05/08 — "đã cập nhật đơn"
 * khi tool ghi bị chặn), `khoeDaGuiAnh` (07/08 DNH36805 — "em gửi lại ảnh đơn
 * hàng" khi chạy 0 tool). Mở thêm một đường GỬI mà không mở hàng rào theo là
 * mời bug đó quay lại lần ba — lần này với file, thứ người ta ngồi chờ.
 *
 * BẮT CHẶT theo đúng mẫu `khoeDaGuiAnh`: chỉ chặn khi CHỦ NGỮ là BOT. Bot XIN
 * người khác gửi ("anh gửi tài liệu qua giúp em") mang nghĩa NGƯỢC — chặn câu
 * đó thì văng nguyên thông báo NỘI BỘ ra cho khách (bug 23:38:44 10/08).
 *
 * KHÔNG bắt "gửi ảnh/hình/hoá đơn": để `khoeDaGuiAnh` lo, hai hàng rào đối
 * chiếu với hai bằng chứng khác nhau (ảnh hoá đơn vs tool gui_tai_lieu).
 */
export function khoeDaGuiTaiLieu(traLoi: string): boolean {
  const t = boDau(String(traLoi ?? ''));
  const CHU_NGU_BOT = '(?:em|minh|shop|ben em|da)';
  const DO_GUI = '(?:tai lieu|catalog(?:ue)?|cattalog|datasheet|file|pdf|ho so)';
  const re = new RegExp(
    `\\b${CHU_NGU_BOT}\\s+(?:da\\s+|se\\s+|dang\\s+)?gui\\s+(?:lai\\s+)?(?:\\w+\\s+)?${DO_GUI}`,
    'i',
  );
  if (!re.test(t)) return false;

  // ĐỀ NGHỊ / CÂU HỎI thì cho qua — "anh có cần em gửi catalog không ạ" là bot
  // XIN PHÉP, chưa gửi gì và cũng không khẳng định đã gửi. Chặn câu này là
  // chặn đúng hành vi mình MUỐN bot làm (hỏi trước khi gửi khi khớp nhiều
  // file), và người dùng sẽ nhận nguyên thông báo nội bộ thay vì câu hỏi.
  //
  // Cùng lý do đã khiến `khoeDaGuiAnh` phải soi chủ ngữ (bug 23:38:44 10/08):
  // hàng rào bắt quá rộng còn hại hơn không có hàng rào.
  //
  // CHỈ dấu hiệu HỎI thật. KHÔNG dùng "nhé/nha" làm dấu hiệu: đó là từ đệm cho
  // mềm câu, "em đã gửi tài liệu P10 cho anh NHÉ" vẫn là lời khẳng định đã gửi.
  const LA_DE_NGHI = /(?:\bco can\b|\bcan khong\b|\bco muon\b|\bmuon khong\b|\bkhong a\b|\bkhong \?|\?)/;
  return !LA_DE_NGHI.test(t);
}

/**
 * Câu trả lời có HỨA "đã chuyển việc sang bộ phận sale" không?
 *
 * Ca thật 15:06→15:35 11/08/2026 (nhóm Test-AI) — bot nói câu này NĂM lần:
 *
 *   15:07:29  "Dạ em đã chuyển việc lên đơn ... sang bộ phận sale xử lý ạ.
 *              Sale sẽ xác nhận khách và lên đơn giúp anh/chị ngay."
 *   15:09:59 / 15:14:50 / 15:16:31 / 15:32:13  — lặp lại y hệt
 *
 * HAI cái sai chồng nhau:
 *   1. Tool `chuyen_sale` KHÔNG nằm trong registry NHÂN VIÊN — bỏ từ 07/08
 *      (staff-agent.ts): "người đang chat CHÍNH LÀ sale, không có ai để
 *      chuyển". Nên không tool nào chạy; câu đó model bịa ra 100%.
 *   2. Kể cả nếu tool chạy (luồng khách), nó chỉ gọi `ghiNhan` → đúng một
 *      dòng `logger.info` trong luong-nhan-vien.ts. Không gắn tag, không mở
 *      nhóm handoff, KHÔNG ai nhận được thông báo nào.
 *
 * Nhân viên đọc "đã chuyển, sale sẽ xử lý ngay" thì ngồi chờ một người không
 * bao giờ tới — trong ca này là 28 phút và 8 lượt nhắc lại.
 *
 * Đây là hàng rào THỨ TƯ cùng một họ: `khoeDaGhi` (05/08 — "đã cập nhật đơn"
 * khi tool ghi bị chặn), `khoeDaGuiAnh` (07/08 DNH36805 — "em gửi lại ảnh"
 * khi chạy 0 tool), `khoeDaGuiTaiLieu` (11/08). Mỗi lần đều cùng bài học:
 * prompt dặn được nhưng model lờ được, hàng rào phải là code.
 *
 * BẮT CHẶT theo đúng mẫu các hàm trên — phải hội đủ BA yếu tố:
 *   chủ ngữ BOT + động từ CHUYỂN + đích đến là BỘ PHẬN/NGƯỜI (sale, kinh doanh)
 *
 * Nhờ vậy các câu sau vẫn qua: "em chuyển đơn sang trạng thái xác nhận" (đích
 * là trạng thái, không phải người), "em đã chuyển khoản tiền cọc" (chuyển
 * khoản), "anh/chị liên hệ sale" (không có động từ chuyển của bot). Và câu
 * ĐÚNG mà ta muốn bot nói — "em không chuyển sang sale được, cho em xin giá" —
 * cũng không bị chặn vì có phủ định.
 */
export function khoeDaChuyenSale(traLoi: string): boolean {
  const t = boDau(String(traLoi ?? ''));

  // Bot nói nó KHÔNG chuyển được — đó chính là hành vi ĐÚNG, đừng chặn.
  // Cùng bài học với `khoeDaGuiAnh`: hàng rào bắt quá rộng hại hơn không có.
  if (/\b(?:khong|ko|chua)\s+(?:the\s+)?chuyen\b/.test(t)) return false;
  // Hỏi ý, chưa khẳng định đã làm ("có muốn em chuyển cho sale không ạ?").
  if (/(?:\bco muon\b|\bco can\b|\bmuon khong\b|\bkhong a\b|\?)/.test(t)) return false;

  const CHU_NGU_BOT = '(?:em|minh|shop|ben em|da)';
  // Đích đến phải là NGƯỜI/BỘ PHẬN. "sang trạng thái", "khoản" không tính.
  const DICH = '(?:bo phan\\s+)?(?:sale|sales|kinh doanh|ban hang)';
  const re = new RegExp(
    // "em đã chuyển (việc lên đơn này) sang/cho (bộ phận) sale"
    `\\b${CHU_NGU_BOT}\\s+(?:da\\s+|se\\s+|dang\\s+)?chuyen\\s+(?:[\\w\\s]{0,30}?\\s)?(?:sang|cho|qua|toi|den)\\s+${DICH}\\b`,
    'i',
  );
  return re.test(t);
}

/** Câu tool trả về khi bị chặn — nói cho model biết vì sao và phải làm gì. */
export function lyDoChan(tenTool: string): string {
  return (
    `KHÔNG thực hiện ${tenTool}: người dùng vừa nói DỪNG/HUỶ ở tin cuối. ` +
    'Hãy xác nhận đã dừng, KHÔNG ghi gì thêm vào hệ thống. ' +
    'Nếu lượt trước đã lỡ tạo đơn, nói rõ mã đơn để nhân viên huỷ trên Odoo.'
  );
}
