// SPDX-License-Identifier: AGPL-3.0-or-later
// NGÂN SÁCH THỜI GIAN cho một lượt agent.
//
// BUG LẶP ĐI LẶP LẠI: nhân viên nhận "Bot gặp lỗi (lượt agent quá hạn
// 90000ms). Anh/chị xử lý giúp nhé." Anh Quốc 11/08: "sao cứ lỗi ... hoài
// vậy????" rồi "bỏ cái báo lỗi đó đi được không".
//
// CHẨN ĐOÁN (đo thật trên prod 11/08) — không phải model chậm, mà là CÁC CON
// SỐ KHÔNG KHỚP NHAU:
//   - mọi tool call     : < 700ms (tool không hề chậm)
//   - một lượt gọi model: ~2s với đủ prompt thật + 22 tool
//   - khoảng trống giữa hai vòng trong ca treo: 32-62s
//   - agent lặp tối đa 8 vòng; MỖI vòng tự thử lại 4 lần, hạn chờ tăng dần
//     12s → 20s → 30s → 40s, cộng nghỉ giữa các lần 1s → 2s → 4s = 109 GIÂY
//     cho một vòng duy nhất.
//   → Hạn tổng 90s mà một mắt xích được phép chạy 109s. Chỉ cần gateway chậm
//     MỘT lần trong 8 vòng là cả lượt chết, bất kể nhân viên hỏi gì. Đó là lý
//     do lỗi lặp lại "hoài" và không liên quan tới nội dung câu hỏi.
//
// Hai mảnh ở đây:
//   1. `hanConLai` — mỗi lần gọi provider chỉ được chờ trong phần CÒN LẠI của
//      ngân sách, thay vì hạn cứng riêng của nó.
//   2. `tomTatDoDang` — hết giờ thì trả dữ liệu tool đã tra được thay vì vứt
//      hết rồi báo lỗi. Anh Quốc chốt: "trả lời bằng dữ liệu đã tra được".
//      CHỈ dùng cho luồng NHÂN VIÊN — xem ghi chú ngay trên hàm.
//
// ĐÃ XOÁ `chayCoHanGioMem` + `conDangThu` (11/08). Chúng được viết kèm bản sửa
// 272c58f2, có test đầy đủ, nhưng KHÔNG nơi nào gọi — code chết đúng nghĩa.
// Xoá thay vì đi tìm chỗ dùng, vì cả hai luồng đều đã có đường xử lý riêng và
// TỐT HƠN:
//   - luồng nhân viên: `chayCoHanGio` ném → catch bắt → `tomTatDoDang(daTra)`.
//     Bắt được CẢ lỗi thật (Odoo sập) lẫn hết giờ bằng một đường, trong khi
//     `chayCoHanGioMem` chỉ phủ hết giờ, còn lỗi thật vẫn phải có catch riêng.
//   - luồng khách: hết giờ TUYỆT ĐỐI không được trả output tool ra (rò dữ liệu
//     nội bộ — xem `tomTatDoDang`), nên trạng thái `do_dang` vô dụng ở đó.
// Để code chết nằm lại là bẫy cho người sau: đọc thấy tưởng hệ thống có cơ chế
// "hết giờ vẫn trả lời mềm", yên tâm dựa vào, mà thực ra nó chưa từng chạy.

/**
 * Hạn chờ thực tế cho lần gọi tiếp theo: nhỏ hơn giữa "hạn mong muốn" và
 * "phần còn lại của ngân sách".
 *
 * Trả 0 khi đã hết sạch — caller PHẢI dừng, gọi tiếp chỉ tổ chờ vô ích rồi bị
 * cắt ở tầng trên.
 */
export function hanConLai(input: {
  batDau: number;
  nganSachMs: number;
  bayGio: number;
  hanMongMuon: number;
}): number {
  const daTroi = input.bayGio - input.batDau;
  const conLai = input.nganSachMs - daTroi;
  if (conLai <= 0) return 0;
  return Math.min(input.hanMongMuon, conLai);
}

/**
 * Tóm tắt những gì tool đã tra được, để trả lời khi hết giờ.
 *
 * CHỈ DÙNG CHO LUỒNG NHÂN VIÊN. Hàm này trả NGUYÊN output của tool — mã khách
 * hàng, công nợ, dòng giá vốn. Với nhân viên đó đúng là thứ họ đang cần; với
 * KHÁCH thì đó là rò dữ liệu nội bộ (và khách cũng không hiểu "KH000027 · công
 * nợ 12.000.000đ" nghĩa là gì). Luồng khách hết giờ thì nhắn câu giữ chân rồi
 * báo nhân viên vào tiếp — có test khoá ở het-gio-khach-khong-lo-noi-bo.func.ts.
 *
 * Anh Quốc 11/08 chốt: hết giờ thì "trả lời bằng dữ liệu đã tra được". Bot
 * thường đã biết công nợ, đã tra xong khách — chỉ thiếu bước soạn câu cuối.
 * Vứt hết rồi báo lỗi là phí đúng thứ nhân viên đang cần.
 *
 * Chỉ lấy tool THÀNH CÔNG và có nội dung: kết quả lỗi đưa ra chỉ làm nhân viên
 * rối thêm. Lấy tool CUỐI CÙNG vì nó gần câu hỏi nhất (các tool trước thường
 * là bước tra trung gian: tra khách → tra SP → mới tới cái cần).
 */
export function tomTatDoDang(
  daTra: ReadonlyArray<{ toolName: string; output: string; thanhCong: boolean }>,
): string | null {
  const dung = daTra.filter((t) => t.thanhCong && String(t.output ?? '').trim());
  if (dung.length === 0) return null;
  const cuoi = dung[dung.length - 1];
  const noi = boChiDanNoiBo(cuoi.output.trim());
  if (!noi) return null;
  // Cắt cho vừa một tin Zalo — quá dài thì nhân viên cũng không đọc.
  return noi.length > 1200 ? `${noi.slice(0, 1200)}…` : noi;
}

/**
 * Output tool có hai phần: DỮ LIỆU (cho người) và LỜI DẶN MODEL ("LƯU Ý: …
 * KHÔNG báo 0đ … CHUYỂN SALE NGAY"). Bình thường model đọc lời dặn rồi soạn
 * câu; đường hết-giờ thì output đi THẲNG ra Zalo — ca thật 06:28:12 13/08 bot
 * dán nguyên "id=452 | … LƯU Ý: … Hãy thử LẠI ĐÚNG MỘT LẦN…" vào nhóm, nhân
 * viên đọc như bùa chú. Bóc lời dặn + nhãn `id=` trước khi gửi.
 */
export function boChiDanNoiBo(s: string): string {
  let t = s;
  const iLuuY = t.search(/\bLƯU Ý:/);
  if (iLuuY >= 0) t = t.slice(0, iLuuY).trimEnd();
  t = t.replace(/^id=\d+ \| /gm, '- ');
  return t.trim();
}
