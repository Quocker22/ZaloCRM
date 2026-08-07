# Luồng lên đơn = máy trạng thái slot — code cầm lái, LLM chỉ trích + soạn lời

Ngày: 2026-08-07 · Trạng thái: chờ duyệt

## Vì sao đập đi làm lại

Tối 07/08, SAU KHI đã vá 4 lần trong một buổi (be3808fe, eb0af187, 1ca54c55,
24e181f1), luồng vẫn hỏng kiểu mới — chat thật 21:07:

```
NV : lên đơn cho anh Hưng 10 cái nguồn NB nhé
Bot: Làm ơn cho em biết anh Hưng cần bao nhiêu cái ạ?   ← SL có sẵn trong câu
NV : (nhắn lại y nguyên)
Bot: (hỏi lại Y HỆT từng chữ)                            ← không nhích trạng thái
NV : 10 cái
Bot: ...có nhiều khách hàng tên Hưng, xin mã KH...       ← giờ mới tra khách
```

Quá 3 lần vá mà bug đổi hình dạng = kiến trúc sai. Gốc rễ: thứ tự "tra khách +
tra hàng → liệt kê chọn → chốt → báo giá" là LỜI DẶN trong prompt — model lúc
theo lúc không, prompt càng dài càng lờ. Chuyển: **code quyết hỏi gì/lúc nào;
LLM chỉ (1) trích slot từ câu nói, (2) không còn việc gì khác trong luồng này.**

Đây là viên gạch strangler đầu tiên của kiến trúc "mỗi quy tắc một ngăn"
(học Chatwoot Captain 07/08 + form/slot Rasa). Các luồng khác (báo cáo, tra
cứu, sửa đơn) GIỮ NGUYÊN agent hiện tại.

## Hành vi đích (chốt với anh Quốc 07/08)

- "lên đơn cho anh Hưng 10 cái nguồn NB" → tra khách "Hưng" + tra SP "nguồn NB"
  SONG SONG ngay lượt đầu.
- Nhiều ứng viên (khách và/hoặc SP) → MỘT tin liệt kê hết, đánh số, đủ thông
  tin để chọn (khách: tên + SĐT/mã KH · SP: tên + giá).
- Slot đã có KHÔNG BAO GIỜ hỏi lại. Tin lặp → nhắc lại đúng câu đang chờ.
- Đủ slot → tóm tắt đơn, chờ chốt ("đúng/ok/lên đi") → tạo đơn nháp Odoo →
  ảnh báo giá + link gửi NHÂN VIÊN trong chính cuộc chat (NV tự chuyển khách).

## Kiến trúc

```
tin NV ─► cổng nhận lệnh (nhanDienLenhNhanVien — giữ nguyên)
   │
   ├─ CÓ phiên gom đơn đang mở cho conversation này ──► máy trạng thái
   ├─ intent "lên đơn" (regex: (lên|tạo|đặt)\s+(đơn|hàng)) ──► máy trạng thái
   └─ còn lại ──► agent thường (chayLenhNhanVien — giữ nguyên)

MÁY TRẠNG THÁI (code thuần, file mới noi-zalo/gom-don.ts):
  1. trichSlot(tin, phienHienTai) — LLM structured output, temp 0:
       { khach?: string, dong?: [{sp: string, sl?: number}],
         chon?: string, huy?: boolean, xacNhan?: boolean }
  2. buocTiepTheo(phien) — HÀM THUẦN trả về MỘT trong:
       { loai: 'tra_cuu', ... }        → chạy tra_khach_hang/tra_san_pham song song
       { loai: 'hoi_chon', ... }       → render danh sách đánh số (template code)
       { loai: 'hoi_thieu', slot }     → hỏi đúng MỘT slot còn thiếu
       { loai: 'tom_tat_cho_chot' }    → tóm tắt đơn, chờ xác nhận
       { loai: 'tao_don' }             → tao_don_nhap (giữ verify id+tên 24e181f1
                                          làm hàng rào cuối) → báo giá + link
       { loai: 'huy' }                 → xoá phiên, xác nhận đã huỷ
  3. Lời gửi đi: TEMPLATE code (tất định). Không LLM soạn — hết bịa, hết lệch.
```

### Phiên gom đơn — bảng mới `phien_gom_don`

| Cột | Ghi chú |
|---|---|
| conversation_id (unique) | mỗi hội thoại tối đa 1 phiên |
| org_id | |
| slots JSONB | khách (ứng viên/đã chốt), dòng SP [{spUngVien/spId, sl, gia}] |
| trang_thai | 'gom' \| 'cho_chon' \| 'cho_chot' |
| het_han | now + 15 phút, chạm là bỏ (tránh phiên ma dính vĩnh viễn) |
| updated_at | |

Lưu DB (không in-memory) — restart container không mất phiên; test đọc được.

### Map câu chọn của NV (code trước, LLM sau)

"1", "1a", "KH001017", SĐT, gõ lại tên đúng một ứng viên → code map trực tiếp.
Không khớp → trichSlot xử (LLM đối chiếu câu với danh sách ứng viên trong phiên).

### Digression (bài học Rasa)

Giữa chừng NV hỏi việc khác ("tồn NB còn nhiêu?") → trichSlot trả không-slot →
định tuyến sang agent thường trả lời, PHIÊN GIỮ NGUYÊN; câu sau quay lại đơn.
"thôi/huỷ/bỏ đi" → huy=true → xoá phiên.

### Guard kế thừa (không viết lại)

- coTinKhachMoiHon + laXacNhanNgan: giữ nguyên vị trí hiện tại.
- chanDonLienKeGiay, verify id+tên trong tao_don_nhap: giữ — hàng rào cuối.

## Test — bộ kịch bản replay là hợp đồng

1. **Unit (thuần, không LLM)**: buocTiepTheo — đủ bảng trạng thái×sự kiện;
   map câu chọn; hết hạn phiên.
2. **Kịch bản replay (fixtures, fake Odoo + fake LLM trích slot)**: chat thật
   tối 07/08 ở trên là kịch bản #1 — chạy qua phải ra: lượt 1 tra song song,
   lượt 1 hỏi gộp khách+SP, không bao giờ hỏi SL. Thêm: nhắn lặp, digression,
   huỷ giữa chừng, nhiều SP, khách mới chưa có.
3. **Func (LLM thật)**: trichSlot với ~15 câu thật đã gặp (giọng miền, viết
   tắt, "10c", "nguồn NB", "cái 12V"...). Chạy trước mỗi lần deploy.

Mỗi bug thật về sau = thêm MỘT kịch bản replay + sửa đúng MỘT ngăn.

## Ngoài phạm vi (đợt sau)

- Sửa đơn (sua_don) vào máy trạng thái — đợt 2 sau khi lên đơn chạy ổn.
- Gửi báo giá thẳng cho khách (cần map chắc partner ↔ nick Zalo) — chưa làm.
- Luồng khách (customer-agent) — không đụng.
