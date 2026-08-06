# Báo cáo Odoo qua Zalo cho nhân viên — thiết kế

Ngày: 2026-08-06 · Trạng thái: đã duyệt hướng, chờ duyệt spec
Người dùng: nhân viên nội bộ (danh sách `AI_AGENT_UID_NHANVIEN`), hỏi qua Zalo.

## Yêu cầu đã chốt (hỏi đáp 06/08)

1. Phạm vi: **chỉ Odoo** (không gồm số liệu chat CRM).
2. Cả 4 nhóm: doanh thu & lợi nhuận · kho & nhập hàng · khách hàng & công nợ ·
   đơn hàng & vận hành.
3. Chính xác kiểu **B**: cho phép tổng hợp linh hoạt từ dữ liệu thô, nhưng
   **Odoo tính** (`read_group`) — model không bao giờ tự cộng.
4. Phân quyền kiểu **A**: mọi nhân viên trong danh sách xem được hết
   (kể cả lợi nhuận, công nợ tổng).
5. Hình thức kiểu **B**: text; kết quả dài thì text tóm tắt + file `.xlsx`.

## Hướng đã chọn: LAI HAI TẦNG (hướng 3/3)

- Tầng 1 — tool chuyên cho câu hỏi hằng ngày: chính xác, dễ chọn với
  gemini-2.5-flash-lite (đo 83% chọn tool đúng với tool đơn giản).
- Tầng 2 — một tool truy vấn linh hoạt cho đuôi dài câu hỏi tổ hợp.
- Hai hướng bị loại: chỉ-tool-cố-định (trượt mục tiêu "hỏi gì cũng đáp ứng"),
  chỉ-tool-linh-hoạt (flash-lite dễ chọn sai bảng/số đo cho cả ca đơn giản).

## Kiến trúc

```
Nhân viên hỏi qua Zalo (luồng NV hiện có — KHÔNG đổi cổng/luồng)
  │
  ▼  staff-agent registry (mở rộng)
  ├─ TẦNG 1 — ca hằng ngày:
  │    bao_cao_tong_quan, bao_cao_ban_hang, canh_bao_ton_kho,
  │    xuat_cong_no, tra_ton_kho          ← 5 tool CŨ giữ nguyên
  │    don_cho_xac_nhan                   ← MỚI: đơn nháp chờ xác nhận
  │    top_san_pham                       ← MỚI: bán chạy / ế theo kỳ
  │
  ├─ TẦNG 2 — bao_cao_linh_hoat (MỚI):
  │    model điền form đóng: bang + do + nhom_theo + loc + sap_xep + gioi_han
  │    code kiểm whitelist → dựng domain → Odoo read_group tính
  │
  └─ XUẤT: ≤15 dòng → text · >15 dòng → text (tổng + top 5) + file .xlsx
```

CHỈ đăng ký vào registry NHÂN VIÊN — khách không bao giờ thấy (ranh giới bảo
mật hiện có, có test đếm tool khoá lại).

## Thành phần mới

| File | Việc | Không được chứa |
|---|---|---|
| `odoo/tools/don-cho-xac-nhan.ts` | đơn draft: mã, khách, tiền, tuổi đơn | gửi Zalo |
| `odoo/tools/top-san-pham.ts` | top bán chạy/ế theo kỳ từ `sale.order.line`. Định nghĩa Ế = còn tồn (>0) nhưng 0 bán trong kỳ — không phải "bán ít" | gửi Zalo |
| `odoo/tools/bao-cao-linh-hoat.ts` | whitelist + dựng domain + read_group | tên field Odoo lộ ra model |
| `odoo/xuat-excel.ts` | mảng dữ liệu → buffer .xlsx (`exceljs`) | biết gì về Odoo/Zalo |
| `noi-zalo/gui-file.ts` | gửi file qua zca-js | logic báo cáo |

## Tool linh hoạt — hợp đồng

Model điền form từ **danh mục đóng**, không viết truy vấn:

- `bang`: `don_hang` · `dong_don` · `khach_hang` · `ton_kho` · `nhap_hang`
  — map cứng sang model Odoo + BỘ LỌC NỀN bắt buộc trong code
  (vd `don_hang` mặc định loại đơn huỷ, trừ khi lọc `trang_thai: 'huy'` rõ ràng).
  LƯU Ý `nhap_hang`: phải KIỂM trên nelia_test xem `purchase.order` có dữ liệu
  thật không trước khi đưa vào whitelist — shop có thể nhập hàng ngoài Odoo.
  Không có dữ liệu → bỏ bảng này khỏi vòng 1, tool trả "chưa hỗ trợ".
- `do`: `tong_tien` · `so_luong` · `so_don` · `so_khach` — map cứng field aggregate.
- `nhom_theo`: `nhan_vien` · `chi_nhanh` · `san_pham` · `khach` · `ngay` · `thang`.
- `loc`: `tu_ngay/den_ngay` · `trang_thai` · `khach_id` · `san_pham_id` ·
  `nguong_tien` — từng khoá validate kiểu + biên trong code.
- `gioi_han`: trần cứng 200 dòng ở code, bất kể model xin bao nhiêu.
- Giá trị ngoài whitelist → tool trả lỗi KÈM danh sách hợp lệ (pattern registry
  hiện có — model tự sửa một lần).

### Hàng rào chính xác (3)

1. Odoo cộng qua `read_group` — model chỉ thấy kết quả đã tổng.
2. Câu trả lời số PHẢI kèm nguồn + kỳ (luật prompt hiện có, giữ nguyên).
3. Kết quả rỗng ≠ lỗi — tool nói "kỳ này không có dữ liệu", chống model đoán.

## Excel & gửi file

- Ngưỡng 15 dòng. File chứa: tiêu đề, kỳ dữ liệu, thời điểm xuất, dòng tổng.
- Ghi file tạm theo pattern `ghiAnhTam` (OS dọn; giữ lại truy vết khi tranh cãi).
- **RỦI RO SỐ 1**: zca-js chưa từng được dùng gửi file trong codebase này.
  Bước ĐẦU TIÊN của implementation: viết `gui-file.ts` + gửi thử một file
  .xlsx thật. **Phương án lùi đã chốt**: không gửi được file → render bảng
  thành ảnh PNG (tái dùng đường render hoá đơn) + text "cần bản Excel thì vào
  Odoo xuất". Không để dự án chết vì một hàm gửi file.

## Xử lý lỗi

Tái dùng bộ hàng rào hiện có, không kiểu lỗi mới:

- Tool lỗi/Odoo sập → `isError` kèm hướng dẫn; model nói "chưa lấy được báo
  cáo" — không có số thì không nói số (luật prompt "chưa có báo cáo này").
- Gửi file lỗi → vẫn gửi text tóm tắt (như hoá đơn: ảnh lỗi vẫn gửi link).
- Truy vấn nặng → trần 200 dòng + timeout Odoo có sẵn.

## Test & kiểm chứng

- Func test từng tool: nhánh rỗng, nhánh lỗi, whitelist chặn giá trị lạ,
  ngưỡng 15 dòng bật Excel đúng lúc.
- Test bảo mật: 3 tool mới KHÔNG có trong registry khách (cập nhật test đếm).
- Eval chọn tool: ~15 câu hỏi báo cáo thật chạy LLM thật — đo flash-lite chọn
  đúng tầng 1/tầng 2. Chỗ dễ gãy nhất của hướng lai; đo TRƯỚC khi bật.
- Kiểm chứng cuối trên container production với 3-5 câu hỏi thật
  (quy trình đã dùng cho các bản vá 05-06/08).

## Ngoài phạm vi (YAGNI)

- Báo cáo định kỳ tự đẩy (cron gửi nhóm mỗi sáng) — để vòng sau.
- Phân quyền nhiều bậc — đã chốt mọi nhân viên xem hết.
- Số liệu chat CRM — đã chốt chỉ Odoo.
- Biểu đồ/hình vẽ — text + Excel là đủ cho vòng này.
