# Sửa đơn vào máy trạng thái — rõ thì chốt luôn, mơ hồ thì hỏi đúng chỗ

Ngày: 2026-08-08 · Trạng thái: chờ duyệt

## Bối cảnh — đây là ĐỒNG BỘ KIẾN TRÚC, không phải chữa bug

Soát prod trước khi làm: `sua_don` đang chạy TỐT. Ba ca sửa thật rạng sáng 08/08
(S13818, S13819, S13820) đều đúng — đổi SL + thêm dòng, tổng đọc lại từ Odoo
chính xác. Không có ca hỏng.

Nên nguyên tắc số một của đợt này: **KHÔNG được làm hỏng cái đang chạy tốt.**
Tool `sua_don` giữ nguyên từng dòng; máy trạng thái chỉ thay phần *quyết định
gọi nó với tham số gì*. Mọi hàng rào của tool (chỉ sửa đơn nháp, đọc lại tổng
từ Odoo, không tự tính tiền) vẫn là lớp cuối.

Lý do làm: hiện "sửa đơn" do agent thường + prompt quyết định. Cùng một câu
"sửa đơn thêm 1000 cáp" mà tra ra 11 sản phẩm thì model tự chọn — đúng cái lớp
bug đã trả giá ở luồng lên đơn (chọn nhầm SP/khách). Dời sang máy trạng thái để
nhập nhằng bị CODE bắt, không phụ thuộc model đoán.

## Hành vi đích (anh Quốc chốt 08/08)

> "Nếu mọi thứ đã rõ ràng thì chốt luôn, còn ví dụ nguồn NB có nhiều loại thì
> cũng cần phải hỏi lại chứ."

Cụ thể hoá:

- **Rõ hết** (biết đơn nào + đúng 1 SP + có SL) → GHI THẲNG Odoo, không hỏi
  chốt. Giữ nguyên tốc độ hiện nay.
- **Mơ hồ ở đâu hỏi đúng chỗ đó**, không hỏi vu vơ, không hỏi lại thứ đã biết:
  - nhiều SP khớp → liệt kê đánh số cho chọn (a, b, c… như lên đơn)
  - thiếu SL → hỏi SL của đúng món đó
  - nhiều đơn nháp trong hội thoại → liệt kê mã đơn + tổng tiền cho chọn
- **Đơn đã xác nhận/huỷ** → báo ngay ở máy, không gọi tool (tool vẫn chặn — hai
  lớp), kèm hướng dẫn "cần đổi thì làm trong Odoo".

## Kiến trúc — dùng lại bộ máy sẵn có

```
tin NV → cổng nhận lệnh (giữ nguyên)
   │
   ├─ NHẬN LỆNH SỬA: /(sửa|thêm|bớt|đổi).*(đơn)|thêm .* vào đơn/
   │  hoặc phiên sửa đang mở
   │        │
   │        ▼  PhienGom mở rộng: them `che: 'len' | 'sua'` + `donSua`
   │   trichSlot (thêm cờ y_dinh: 'sua') → dapSlot → buocTiepTheo
   │        │
   │        ├─ tra_cuu   : tra SP song song (như cũ) + tra ĐƠN nếu chưa biết
   │        ├─ hoi_chon  : liệt kê SP / liệt kê ĐƠN nháp cho chọn
   │        ├─ hoi_thieu : hỏi đúng slot thiếu
   │        └─ sua_don   : ĐỦ RÕ → gọi tool suaDon ngay, KHÔNG hỏi chốt
   │                       → báo "S13820: thêm 1000 × cáp… Tổng X → Y"
   │                       → gửi kèm ảnh báo giá mới (guiHoaDon)
   │
   └─ còn lại → agent thường (giữ nguyên)
```

### Thay đổi trong kiểu dữ liệu

`PhienGom` thêm hai trường, mặc định giữ nguyên hành vi lên đơn:

| Trường | Ý nghĩa |
|---|---|
| `che?: 'len' \| 'sua'` | thiếu = `'len'` (mọi phiên cũ trong DB vẫn đọc được) |
| `donSua?: { id, ma, tong }` | đơn đang sửa, đã chốt |
| `donUngVien?: Array<{id, ma, tong, luc}>` | >1 đơn nháp → chờ chọn |
| `donKhongThay?: boolean` | tra rồi không thấy đơn nào sửa được |

`HanhDong` thêm `{ loai: 'sua_don' }` và `{ loai: 'hoi_chon_don' }`.

### Tìm đơn để sửa

Thứ tự (cùng nếp `xuat_hoa_don` đã có):

1. NV nói mã đơn ("sửa đơn S13820") → dùng đúng đơn đó.
2. Không nói mã → tra đơn NHÁP của chính hội thoại này qua khoá idempotency
   `zalo:<conversationId>:%`, sắp mới nhất trước:
   - đúng 1 đơn → chốt luôn, không hỏi
   - nhiều đơn → liệt kê mã + tổng + giờ tạo cho NV chọn
   - 0 đơn → "Em không thấy đơn nháp nào trong cuộc này để sửa ạ."

Không bao giờ lấy đơn ngoài hội thoại khi NV không nói mã — chống sửa nhầm đơn
của người khác (cùng lý do với `xuat_hoa_don`).

### Ghi rồi mới báo — và báo bằng SỐ THẬT

Sau `suaDon` thành công: text nêu mã đơn, việc đã làm (đổi SL những gì, thêm gì),
`tổng trước → tổng sau` **đọc lại từ Odoo** (tool đã làm), rồi gửi ảnh báo giá
mới. Thất bại (đơn đã xác nhận, Odoo từ chối) → báo nguyên văn lý do, phiên giữ
nguyên để NV sửa thông tin rồi thử lại.

## Ranh giới — cái gì KHÔNG đổi

- `odoo/tools/sua-don.ts`: không sửa một dòng.
- Luồng lên đơn: mọi kịch bản replay hiện có phải xanh y nguyên.
- Agent thường vẫn giữ tool `sua_don` trong registry — máy không nhận (câu lạ,
  digression) thì agent thường vẫn xử được như hôm nay. Không bỏ tool.
- Không thêm cổng chốt cho sửa đơn (anh Quốc đã quyết).

## Test

1. **Unit `buocTiepTheo`** — bảng trạng thái chế `'sua'`: chưa biết đơn → tra;
   nhiều đơn → hoi_chon_don; nhiều SP → hoi_chon; thiếu SL → hoi_thieu; đủ rõ →
   sua_don ngay (KHÔNG qua tom_tat_cho_chot).
2. **Kịch bản replay** (fake Odoo + fake LLM), thêm vào bộ hiện có:
   - "sửa đơn thêm 1000 cáp 16 sợi nhỏ" khi có đúng 1 đơn nháp + SP khớp duy
     nhất → gọi `suaDon` NGAY trong lượt đó, đúng tham số, không hỏi gì.
   - Cùng câu nhưng "cáp" khớp 3 SP → liệt kê a/b/c, KHÔNG gọi suaDon; chọn "b"
     → mới gọi.
   - Hai đơn nháp trong hội thoại → liệt kê mã đơn cho chọn.
   - Đơn đã xác nhận → báo không sửa được, KHÔNG gọi tool.
   - Câu "sửa đơn" khi không có đơn nháp nào → báo rõ, không nổ.
3. **Toàn bộ suite cũ phải xanh** — đặc biệt replay lên đơn.

## Ngoài phạm vi

- Bỏ dòng khỏi đơn ("bỏ cáp ra") — tool hiện không hỗ trợ xoá dòng; làm sau nếu
  có ca thật.
- Sửa đơn đã xác nhận (phải huỷ/đảo trong Odoo) — không đụng.
- Sửa chiết khấu (`sua_chiet_khau`) — vẫn để agent thường.
