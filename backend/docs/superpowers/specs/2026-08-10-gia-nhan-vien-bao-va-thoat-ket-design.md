# Giá nhân viên báo + gỡ phiên kẹt — 4 bug từ chat nhóm thật 17:00-17:22 10/08

Ngày: 2026-08-10 · Trạng thái: chờ duyệt

## Chuyện gì đã xảy ra

Buổi demo thật với anh Quyết trong nhóm. Chuỗi hỏng:

```
17:04 Quyết: 10 cái 12v400w NB x 170k. 300 thanh tỏa ngoài trời lixin 13k/thanh. @bot lên đơn
17:04 Bot : "12v400w NB" có 2 loại: a) NB Ngoài Trời 132.000đ  b) Jinbo · 0đ     ← BUG 2
17:09 Quốc: (cho tên + SĐT khách mới)
17:09 Bot : "hệ thống chưa cho phép tạo khách mới trong lượt này"                 ← BUG 3
17:13 Bot : 10 × Nguồn 12V400W = 1.320.000đ (132k/cái, KHÔNG phải 170k NV báo)    ← BUG 4
           300 × Led thanh tỏa = 300đ (1đ/thanh, NV báo 13k)
17:17→17:22 mọi lệnh sau — kể cả "bỏ 300 thanh led tỏa rồi lên đơn" và
           "lên đơn cho anh Vấn 10 cái nguồn NB" — đều trả ĐÚNG MỘT câu lỗi cũ  ← BUG 1
```

Bug 1 là lỗi thiết kế của máy gom đơn: **phiên dính một SP không hợp lệ và
không có đường nào gỡ ra.** Nhân viên gõ 5 lệnh khác nhau, bot lặp một câu lỗi
— đúng cái cảm giác "bot hỏng" tệ nhất.

## Quyết định nghiệp vụ (anh Quốc chốt 10/08)

1. **Giá nhân viên báo THẮNG giá hệ thống.** NV nói 170k thì đơn ghi 170k, dù
   Odoo để 132k. Lý do: NV đã chốt với khách rồi; giá Odoo có thể cũ. Bot nói rõ
   trong câu tóm tắt để NV tự kiểm.
2. **SP chưa có giá (0đ/1đ) vẫn lên đơn được NẾU nhân viên báo giá.** Không ai
   báo giá thì mới chặn — và chặn NGAY LÚC CHỌN, kèm câu "SP này chưa có giá,
   anh/chị báo giá hoặc bỏ ra", không để kẹt tới lúc tạo đơn.

Điều này ĐẢO một luật cũ trong `tao-don-nhap.ts` ("bot không được quyền đặt
giá — đặt giá là cách bịa số tinh vi nhất"). Luật cũ đúng với LUỒNG KHÁCH (khách
điều khiển câu chữ → điều khiển được giá) nhưng sai với luồng nhân viên. Nên:

- **Luồng nhân viên**: cho truyền `don_gia` per dòng, nguồn gốc là câu NV nói.
- **Luồng khách**: TUYỆT ĐỐI không — `choKhachChotDon` không được truyền giá,
  giữ nguyên hàng rào cũ. Khách nói "bán tôi 1đ" không được thành đơn 1đ.

## Sửa gì

### A. Tool `tao_don_nhap` + `sua_don`: nhận `don_gia` tùy chọn

```ts
DongDon { san_pham_id: number; so_luong: number; don_gia?: number }
```

- Có `don_gia` > 0 → truyền `price_unit` vào order_line.
- Không có → như cũ (Odoo tự lấy pricelist).
- Kiểm tra giá 0đ/1đ CHỈ áp dụng cho dòng KHÔNG có `don_gia`. Có giá NV báo thì
  SP chưa nhập giá vẫn lên đơn được.
- `taoDonNhap` nhận thêm cờ `choPhepDatGia` (mặc định false). Registry nhân
  viên bật; registry khách KHÔNG.

### B. Máy gom đơn: nhớ giá NV báo

`DongGom` thêm `donGia?: number`. `trichSlot` trích thêm giá từ câu:
"10 cái 12v400w NB x 170k" → `{sp: '12v400w NB', sl: 10, gia: 170000}`;
"13k/thanh" → 13000. Chuẩn hoá k/tr/nghìn ở CODE, không để model tự nhân.

Tóm tắt trước khi chốt nêu rõ nguồn giá khi lệch:
```
10 × Nguồn NB Ngoài Trời 12V400W = 1.700.000đ  (giá anh/chị báo 170.000đ,
                                                hệ thống đang 132.000đ)
```

### C. Gỡ kẹt — phần quan trọng nhất

Ba đường thoát, thiếu cái nào cũng kẹt như hôm nay:

1. **Bỏ dòng khỏi phiên**: "bỏ 300 thanh led tỏa", "bỏ cáp ra", "không lấy X
   nữa" → `trichSlot` trả `boDong: ['led tỏa']` → xoá dòng khớp khỏi phiên.
2. **Lệnh lên đơn MỚI đè phiên cũ**: câu khớp `NHAN_LENH_LEN_DON` mà có tên
   khách khác → BỎ phiên đang gom, mở phiên mới. Hôm nay "lên đơn cho anh Vấn
   10 cái nguồn NB" bị nuốt vào phiên hỏng.
3. **Chặn SP không hợp lệ NGAY LÚC CHỐT DÒNG**: `traSanPham` trả SP có
   `gia <= NGUONG_GIA_AO` (10đ) mà NV chưa báo giá → không đưa vào `daChot`,
   hỏi luôn "SP này chưa có giá, anh/chị báo giá bao nhiêu hay bỏ ra?".
   Danh sách chọn cũng đánh dấu `(chưa có giá)` thay vì hiện "0đ".

Thêm hàng rào cuối: tạo đơn LỖI 2 lần liên tiếp cùng lý do → tự xoá phiên, báo
"Em bỏ đơn đang gom, anh/chị lên lại từ đầu giúp em" (chống lặp vô tận).

### D. Khách mới trong máy gom đơn

Máy hiện chỉ biết TRA khách. Thêm: NV nói "khách mới" / cho tên + SĐT mà tra
không ra → gọi `taoKhachHang` (tool đã có, tự chống trùng) rồi tiếp tục.

## Test

Kịch bản replay từ chính chat 10/08:
1. "10 cái 12v400w NB x 170k" → đơn ghi **170.000đ/cái**, tóm tắt nêu lệch giá.
2. SP giá 1đ + NV báo 13k → lên đơn được, giá 13k.
3. SP giá 1đ, NV KHÔNG báo giá → hỏi ngay lúc chọn, KHÔNG kẹt.
4. "bỏ 300 thanh led tỏa rồi lên đơn" → dòng đó biến mất, đơn còn 1 dòng.
5. Phiên đang hỏng + "lên đơn cho anh Vấn 10 cái nguồn NB" → phiên MỚI, không
   lặp lỗi cũ.
6. Tạo đơn lỗi 2 lần cùng lý do → phiên tự xoá.
7. Luồng KHÁCH: truyền don_gia bị bỏ qua (hàng rào không thủng).

## Ngoài phạm vi

- Sửa giá đơn đã tạo (`sua_chiet_khau` lo phần giảm giá) — không đụng.
- Tự cập nhật giá SP vào Odoo khi NV báo giá mới — nguy hiểm, để người làm.
