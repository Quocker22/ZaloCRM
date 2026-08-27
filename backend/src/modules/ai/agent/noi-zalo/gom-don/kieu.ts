// SPDX-License-Identifier: AGPL-3.0-or-later
// Kiểu của máy trạng thái gom đơn.
// Spec: docs/superpowers/specs/2026-08-07-luong-len-don-slot-design.md
//
// Vì sao tồn tại: 4 lần vá luồng lên đơn trong tối 07/08 mà bug vẫn đổi hình
// dạng (hỏi lại SL đã có, lặp y hệt câu hỏi). Quy trình lên đơn giờ do CODE
// quyết — LLM chỉ trích slot từ câu nói, không được quyết hỏi gì tiếp.
import type { KhachHang } from '../../../odoo/tools/tra-khach-hang.js';
import type { SanPham } from '../../../odoo/tools/tra-san-pham.js';

/** Một dòng hàng đang gom: từ khoá NV gõ → ứng viên → SP đã chốt. */
export interface DongGom {
  tuKhoa: string;
  sl: number | null;
  /**
   * Đơn giá NHÂN VIÊN BÁO trong câu ("10 cái NB x 170k" → 170000).
   *
   * Anh Quốc chốt 10/08: giá NV báo THẮNG giá hệ thống — họ đã chốt với khách
   * rồi, giá Odoo có thể cũ. Cũng là đường để SP chưa nhập giá vẫn lên đơn
   * được (bug demo 17:17: kẹt cứng vì SP giá 1đ).
   */
  donGia?: number;
  /**
   * Chiết khấu % nhân viên báo NGAY lúc lên đơn (0-100).
   *
   * Ca thật 03:23 11/08: "…giá 230k triết khấu 8%" — máy không có ô này nên
   * bỏ qua, ra 23.000.000đ; nhân viên phải nhắc lại một lượt nữa mới đúng
   * 21.160.000đ. Anh Quốc: "cái lên đơn chưa lên thêm được chiết khấu nữa".
   */
  chietKhau?: number;
  /**
   * Ứng viên đến từ đường GẦN ĐÚNG (P1.2) — NV chọn xong thì lựa chọn đó là
   * ALIAS đáng học (sp-alias.ts). Ứng viên thường không có cờ này.
   */
  ungVienGanDung?: boolean;
  /**
   * DANH SÁCH ĐÃ ĐƯA RA HỎI — giữ lại sau khi chốt để quyết "có đáng học
   * alias không". `ungVien` bị xoá ngay lúc chốt (nó là trạng thái "đang
   * treo"), nên nếu không sao lại thì tới lúc học đã không còn gì để soi.
   *
   * Ca 12:33 18/08: 3 ứng viên chỉ khác nhau MÀU → "led zz thấu kính" là tên
   * chung, không phải biệt danh của SP nào — xem `laTenChungBienThe`.
   */
  ungVienDaHoi?: Array<{ id: number; ten: string; gia: number }>;
  /**
   * Dòng HÀNG TẶNG: giá 0đ và tên dòng gắn "(tặng)".
   *
   * Đo trên Odoo prod 11/08: 34/597 dòng có giá 0đ — nhưng KHÔNG phải quà tặng
   * hết. Trong đó có dòng 428 con ốc, 107 sợi cáp: phụ kiện đi kèm, cũng 0đ.
   * Không dòng nào ghi chữ "tặng" nên báo cáo không tách nổi hai loại.
   *
   * Nên tặng kèm phải để lại DẤU trong tên dòng, không chỉ đặt giá 0.
   */
  tang?: boolean;
  daChot?: Pick<SanPham, 'id' | 'ten' | 'gia'>;
  /** >1 kết quả tra — chờ NV chọn. */
  ungVien?: SanPham[];
  /** Tra rồi mà 0 kết quả — báo NV gõ lại, đừng im. */
  khongThay?: boolean;
}

/**
 * Kho xuất hàng của đơn (sale.order.warehouse_id).
 *
 * Đo prod 11/08: 291/300 đơn gần nhất dùng TT, 9 đơn dùng HCM. Nên MẶC ĐỊNH là
 * không đặt gì — để Odoo tự lấy TT như xưa nay. CHỈ đặt khi nhân viên nói rõ.
 *
 * Anh Quốc chốt 11/08 (nguyên văn): "mặc định là lấy kho TT nhé, không cần hỏi
 * nhân viên luôn, cứ lấy từ TT nào nhân viên nói sửa sang kho khác thì sửa
 * thôi". Máy KHÔNG hỏi kho — bảng này chỉ để dịch chữ NV nói sang id.
 */
export const KHO: ReadonlyArray<{ id: number; ma: string; ten: string }> = [
  { id: 2, ma: 'TT', ten: 'Chi nhánh trung tâm' },
  { id: 3, ma: 'HCM', ten: 'Hồ Chí Minh' },
  { id: 4, ma: 'KB', ten: 'Kho B' },
];

/** Đơn nháp đang sửa (chế 'sua'). */
export interface DonSua {
  id: number;
  ma: string;
  tong: number;
  /**
   * Dòng THẬT của đơn (nạp từ sale.order.line lúc chốt đơn sửa, 14/08).
   * Có nó thì "giá 175k đó" (đơn 1 dòng) hay "sửa giá nguồn" (khớp tên dòng)
   * xử được bằng CODE — SL giữ nguyên theo đơn, không bắt NV đọc lại.
   * Ca thật 22:32-22:33 14/08: thiếu nó nên máy hỏi "sửa gì" rồi kẹt,
   * đường thoát còn đọc nhầm kịch bản luồng khách ("gõ SĐT hoặc mã KH").
   */
  dong?: Array<{ spId: number; ten: string; sl: number; gia: number }>;
  /**
   * 'mua' = PHIẾU NHẬP (purchase.order) — sửa đi tool sua_don_mua, giá là giá
   * NHẬP (16/08, ca P04525). Thiếu = 'ban' (phiên cũ trong DB vẫn chạy đúng).
   */
  loai?: 'ban' | 'mua';
}

export interface PhienGom {
  /**
   * Đã áp luật chiết khấu NV dặn cho phiên này (12/08) — áp đúng MỘT lần,
   * không ghi đè con số NV chủ động nói trong phiên.
   */
  daApLuatCk?: boolean;
  khachTuKhoa: string | null;
  khachDaChot?: Pick<KhachHang, 'id' | 'ten' | 'ma' | 'dienThoai'>;
  khachUngVien?: KhachHang[];
  /**
   * Danh sách ứng viên CHẠM TRẦN tra cứu — còn khách trùng ngoài danh sách.
   * Bug 16:15 11/08: "Anh Long Led" nằm ngoài 10 người đầu mà không ai biết.
   */
  khachUngVienConNua?: boolean;
  /**
   * Khách này do MÁY TỰ CHỐT (khớp gần nguyên văn, áp đảo), nhân viên chưa hề
   * bấm chọn. Tóm tắt PHẢI nói rõ đã lấy ai + cách sửa nếu sai — anh Quốc
   * 21:56 11/08: "Khi tự chốt, PHẢI nói rõ đã chọn ai … ĐỪNG chốt im lặng."
   */
  khachTuChot?: boolean;
  khachKhongThay?: boolean;
  /**
   * Thông tin khách MỚI nhân viên cung cấp khi tra không ra ("khách mới",
   * kèm tên + SĐT). Bug demo 17:08 10/08: máy chỉ biết TRA, không có đường
   * TẠO nên bot đáp 'hệ thống chưa cho phép tạo khách mới trong lượt này'.
   */
  khachMoi?: { ten: string; sdt?: string; diaChi?: string };
  dong: DongGom[];
  /**
   * Nhân viên đã XÁC NHẬN lại giá lệch bất thường → thôi hỏi, ghi theo họ.
   *
   * Bug thật 10:09:33 11/08: model đọc "triết khấu 8%" rồi nhét số 8 vào ô ĐƠN
   * GIÁ (hệ thống 230.000đ). Bot in cả hai số cạnh nhau — lệch 28.750 lần —
   * rồi vẫn hỏi "Em chốt lên đơn nhé?". Gõ "ok" là đơn 800đ vào hệ thống.
   *
   * Hỏi lại ĐÚNG MỘT LẦN rồi tin người: luật 10/08 vẫn là "giá NV báo thắng
   * giá hệ thống". Cờ này là cái gật đó, không phải quyền bỏ qua hàng rào —
   * nó bị xoá mỗi khi nhân viên báo giá MỚI (xem dapSlot).
   */
  giaLechDaXacNhan?: boolean;
  /**
   * Máy vừa hỏi về giá lệch → câu kế của nhân viên là CÂU TRẢ LỜI cho nó.
   *
   * Cần cờ riêng vì câu đáp thường cụt lủn ("đúng rồi", "ừ", "ok") — không có
   * ngữ cảnh này thì không phân biệt được nó gật cho GIÁ hay gật chốt cả đơn.
   */
  daHoiGiaLech?: boolean;
  /**
   * Kho xuất hàng NV đã nói cho đơn này (id trong KHO). Không đặt = để Odoo tự
   * lấy kho mặc định TT — đúng hành vi 291/300 đơn hiện nay.
   *
   * CHỈ đặt được khi nhân viên nói rõ; máy không bao giờ hỏi (anh Quốc 11/08).
   */
  khoId?: number;
  /**
   * Chữ kho nhân viên nói mà KHÔNG map được sang kho nào có thật ("kho Đà
   * Nẵng"). Giữ lại để tóm tắt báo rõ.
   *
   * Im lặng bỏ qua là bẫy: nhân viên tưởng hàng xuất Đà Nẵng, thực tế Odoo lấy
   * TT — sai nơi xuất hàng mà không ai biết cho tới lúc giao.
   */
  khoKhongRo?: string;

  // ── PHỤ PHÍ (24/08/2026) ───────────────────────────────────────────────
  /**
   * Phụ phí NV báo trong câu ("thêm 70k ship", "phí lắp đặt 200k") — mỗi
   * khoản thành MỘT DÒNG ở cuối đơn (SL 1, giá = tiền phí).
   *
   * Ca thật 23:08 24/08: "lên đơn cho anh Vấn 1 cái nguồn NB, thêmm 70k ship"
   * → đơn S15179 ra 78.000đ, 70k ship bị VỨT LẶNG LẼ vì máy không có ô này.
   * Anh Quyết: "cứ thêm một hàng nữa là tiền ship ở cuối, linh động, một tiền
   * khác thì cũng cứ thêm một hàng vào".
   */
  phuPhi?: Array<{ ten: string; tien: number }>;

  // ── VAT (11/08/2026) ───────────────────────────────────────────────────
  /**
   * Phần trăm VAT nhân viên nói ("có VAT" → 8; "VAT 10%" → 10).
   *
   * KHÔNG nhắc gì = không đặt = KHÔNG gắn thuế, đúng hành vi hiện tại. Bot tự
   * thêm thuế vào đơn không ai xin là sửa tiền thật của khách.
   */
  vatPhanTram?: number;
  /**
   * id account.tax tra được cho `vatPhanTram` (tra động qua traThueBan).
   *
   * Đo prod 11/08: "VAT 8%" đang là id=4 — nhưng KHÔNG hard-code, vì id là cấu
   * hình Odoo chứ không phải hằng số nghiệp vụ.
   */
  vatThueId?: number;
  /**
   * Tra danh mục account.tax mà KHÔNG có mức % nhân viên nói (vd "VAT 5%":
   * prod chỉ có 0/4/8/10%).
   *
   * Phải nói RÕ trong tóm tắt, tuyệt đối không im lặng lên đơn không thuế —
   * nhân viên tưởng đơn có VAT mà hoá đơn ra không có là sai sổ sách, lúc phát
   * hiện thì đã xuất mất rồi.
   */
  vatKhongTra?: boolean;

  // ── Chế SỬA ĐƠN (spec 2026-08-08) ──────────────────────────────────────
  /**
   * Thiếu = 'len' — phiên cũ đang nằm trong DB đọc lên vẫn chạy đúng luồng
   * lên đơn, không cần migrate dữ liệu.
   *
   * 'nhap' (11/08/2026) = PHIẾU NHẬP HÀNG, đơn MUA từ nhà cung cấp. Ca thật
   * 22:09-22:11 nhóm Test-AI: bot đáp "chưa có tool tạo phiếu nhập hàng" rồi
   * "tính năng này nằm ngoài phạm vi em hỗ trợ" — SAI, quyền ghi purchase.order
   * vốn đã có (đo prod: create=true, write=true, 5 đơn mua thật đang chạy).
   *
   * Dùng LẠI máy này thay vì dựng máy mới (anh Quốc: "dựa vào luồng lên đơn mà
   * làm nhé, tại hiện tại luồng lên đơn khá ok rồi"): nhập hàng là ĐÚNG bài
   * toán slot-form của lên đơn — thiếu đối tác thì hỏi đối tác, thiếu hàng thì
   * hỏi hàng, đủ thì ghi. Ca thật trải qua HAI lượt (22:09 nói ý định, 22:11
   * mới dán 13 dòng hàng) nên phiên gom TTL 15' là thứ bắt buộc phải có.
   *
   * `khachTuKhoa`/`khachDaChot`/`khachUngVien` ở chế này mang NHÀ CUNG CẤP.
   * Dùng chung ô thay vì thêm ô song song: mọi đường thoát kẹt (bỏ dòng, lệnh
   * mới đè phiên, lỗi 2 lần bỏ phiên), guard chống lặp, và `apDungChon` đều
   * đọc các ô đó — tách ô là phải nhân đôi cả năm thứ, mỗi cái một chỗ quên.
   */
  che?: 'len' | 'sua' | 'nhap';
  /**
   * SỐ HIỆU VIỆC — khoá chống trùng của đơn/phiếu mà phiên này sẽ ghi.
   *
   * ── VÌ SAO PHẢI CÓ (ca thật 11:15-11:16 ngày 12/08/2026) ────────────────
   *   11:15:52  NV : "đúng rồi"                    ← tin 1
   *   11:16:00  NV : "@Tiểu Mã Nelia đúng rồi"     ← tin 2, cách 8 GIÂY
   *   11:16:13  Bot: "Đã lên đơn nháp S13834 ..."  ← đơn 1 (id 26751)
   *   11:16:24  Bot: "Đã lên đơn nháp S13835 ..."  ← đơn 2 (id 26752) TRÙNG
   * HAI ĐƠN THẬT vào Odoo: cùng khách KH000027, cùng 10 × Led F5, cùng 1 triệu.
   *
   * Trước đây `seq` (thành phần khoá chống trùng `zalo:<conv>:<seq>`) sinh từ
   * messageId — HAI TIN thì HAI seq, nên hai lượt ra HAI khoá khác nhau và
   * hàng rào idempotency của `tao_don_nhap` không thấy gì trùng. Khoá đáng ra
   * phải nhận diện VIỆC, mà việc ở đây là "cái phiên đang gom này", không phải
   * "cái tin vừa gõ".
   *
   * Đặt MỘT LẦN lúc mở phiên rồi giữ nguyên suốt phiên: mọi lượt xác nhận của
   * cùng một phiên ghi ra CÙNG một khoá, nên lượt thứ hai nhận `da_ton_tai`.
   * Phiên bị xoá (đơn đã lên, huỷ, đè bằng lệnh mới) → phiên sau sinh số mới,
   * nên nhân viên lên đơn thứ hai thật vẫn ra đơn thứ hai thật.
   *
   * ĐỪNG dùng lại `seq` từ messageId cho đường ghi. Xem thêm khoa-viec.ts:
   * khoá theo NỘI DUNG CÂU không chặn nổi ca này vì "đúng rồi" và
   * "[Trả lời tin: ...] đúng rồi" băm ra hai mã khác nhau.
   *
   * Thiếu (phiên cũ trong DB trước bản vá) → rơi về `seq` của tin, đúng hành
   * vi cũ; không cần migrate dữ liệu.
   */
  viecId?: number;
  /** Đơn đã chốt để sửa. */
  donSua?: DonSua;
  /**
   * Đang chờ NV đọc GIÁ MỚI cho dòng này của đơn (spId) — đặt khi NV nói
   * "sửa giá <tên hàng>" mà chưa kèm số. Câu kế chỉ cần con số trần.
   */
  dongChoGia?: number;
  /** Nhiều đơn nháp trong hội thoại → chờ NV chọn. */
  donUngVien?: DonSua[];
  /** Tra rồi không có đơn nháp nào sửa được. */
  donKhongThay?: boolean;
  /**
   * DẤU "ĐƠN VỪA LÊN XONG" (13/08). Phiên chết sau khi tạo/sửa đơn, nhưng câu
   * chuyện thì chưa: ca thật 06:21-06:29 13/08 — NV phát hiện đơn S13848 sai
   * hàng, nhắn "xuất lại báo giá cho đúng đi" rồi "giá 1800 đó", máy mở phiên
   * MỚI tay trắng và hỏi "Đơn này lên cho khách nào ạ?" → NV điên tiết, cuối
   * cùng ra thêm đơn TRÙNG S13849 + khách trùng "Dương".
   *
   * Sau khi đơn xong, thay vì xoá phiên, lưu lại dấu này (TTL 15' của bảng
   * phiên tự dọn). Câu tham-chiếu-sửa trong cửa sổ đó ép chế 'sua' với đúng
   * mã đơn — docPhien vẫn trả phiên chứa dấu, xuLyGomDon tự tách ra và coi
   * như KHÔNG có phiên mở (mọi nhánh `!phien` giữ nguyên hành vi cũ).
   */
  daXong?: { maDon: string; tenKhach: string; dong?: Array<{ ten: string; sl: number }> };
  /**
   * NV nói RÕ "tạo phiếu nhập MỚI/thêm phiếu" — cho phép tạo phiếu trùng nội
   * dung với phiếu nháp đang có (17/08; guard chống-trùng-nội-dung sẽ nhường).
   */
  choPhepTrung?: boolean;
  /**
   * Tên các SP VỪA BÁO "không tìm thấy" ở lượt trước (17/08, ca 09:52).
   * Dòng khongThay bị dọn ngay sau khi báo — NV đáp "thêm mới các sản phẩm
   * đó luôn" thì "các sản phẩm đó" phải còn chỗ tra. Xoá sau khi tạo xong.
   */
  daBaoKhongThay?: Array<{ ten: string; sl?: number | null }>;
  /** Số lần tạo đơn thất bại liên tiếp — 2 lần thì bỏ phiên (chống kẹt 10/08). */
  soLanLoi?: number;
  /**
   * Tin máy đã gửi GẦN NHẤT — guard chống lặp nguyên văn (bug 16:15 11/08:
   * NV gõ gì cũng nhận lại đúng một tường chữ danh sách). Trùng thì đổi lời.
   */
  tinCuoi?: string;
  /**
   * UID Zalo của người ĐANG được bot hỏi (người mở phiên).
   *
   * Bug thật 17:07-17:08 10/08 trong nhóm: anh Quyết tag bot "lên đơn cho anh
   * chiến", bot liệt kê 10 anh Chiến; anh trả lời "khách mới" — KHÔNG tag —
   * nên cổng batBuocTag vứt câu đó, bot không bao giờ thấy. Phiên treo, nhân
   * viên tưởng bot lỗi.
   *
   * Bot vừa hỏi thì câu kế của CHÍNH người được hỏi là câu trả lời, không cần
   * tag lại. Người KHÁC trong nhóm nói chen thì vẫn phải tag — nếu không, bot
   * bốc câu tán gẫu của người ngoài làm câu chọn.
   */
  hoiUid?: string | null;
}

/**
 * Hành động kế tiếp — code quyết, KHÔNG phải model.
 * Mỗi lượt tin đúng MỘT hành động gửi đi (trừ tra_cuu: chạy xong gọi lại
 * buocTiepTheo để ra hành động nói được).
 */
export type HanhDong =
  | { loai: 'tra_cuu'; khach?: string; sp: string[]; don?: boolean; ncc?: string }
  | { loai: 'hoi_chon' }
  | { loai: 'hoi_chon_don' }
  /** 'ncc' chỉ có ở chế 'nhap' — hỏi NHÀ CUNG CẤP thay vì khách hàng. */
  | { loai: 'hoi_thieu'; thieu: 'khach' | 'sp' | 'sl' | 'ncc' }
  /** SP chưa có giá trong Odoo và NV cũng chưa báo giá — hỏi ngay, đừng để kẹt. */
  | { loai: 'hoi_gia'; sp: string[] }
  /**
   * Giá NV báo lệch VÔ LÝ so với giá hệ thống (ca thật 10:09:33 11/08: 8đ vs
   * 230.000đ) → hỏi lại ĐÚNG con số đó trước khi cho chốt.
   *
   * Hỏi chứ KHÔNG tự sửa và KHÔNG im lặng bỏ qua: số này có thể là model bịa
   * (ca thật), mà cũng có thể là giá thật nhân viên cố ý — chỉ họ mới biết.
   */
  | { loai: 'hoi_gia_lech'; lech: Array<{ ten: string; giaNv: number; giaHt: number }> }
  | { loai: 'khong_thay'; khach?: string; sp: string[] }
  | { loai: 'khong_thay_don' }
  /** Tra không ra khách nhưng NV đã cho tên → tạo khách mới rồi chạy tiếp. */
  | { loai: 'tao_khach' }
  /**
   * Tóm tắt đơn — LỜI KỂ, không phải câu hỏi. Không còn là một BƯỚC của bảng
   * trạng thái (bỏ 11/08 cùng bước chốt): `buocTiepTheo` không bao giờ trả ra
   * nó nữa. `taoDonVaBaoGia` render trực tiếp để ghép vào tin báo đơn đã lên.
   *
   * Giữ lại vì nội dung tóm tắt vẫn cần: nhân viên phải soát được bot hiểu
   * đúng khách nào, hàng gì, giá bao nhiêu — chỉ đổi thời điểm soát từ TRƯỚC
   * khi ghi thành SAU khi ghi (đơn nháp sửa được).
   */
  | { loai: 'tom_tat_don' }
  | { loai: 'tao_don' }
  /**
   * Chế 'nhap': đủ NCC + hàng + SL → tạo PHIẾU NHẬP thẳng, KHÔNG hỏi chốt.
   * Nhất quán với việc bỏ bước chốt của lên đơn (11/08, commit 7d568b90).
   */
  | { loai: 'tao_don_mua' }
  /** Chế 'sua': đủ rõ → ghi THẲNG Odoo, KHÔNG hỏi chốt (anh Quốc chốt 08/08). */
  | { loai: 'sua_don' };
