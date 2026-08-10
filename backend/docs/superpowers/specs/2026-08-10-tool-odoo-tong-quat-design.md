# Tool Odoo tổng quát — bot làm được mọi thao tác, không cần viết tool từng việc

Ngày: 2026-08-10 · Trạng thái: chờ duyệt

## Vì sao

Hai câu hỏi thật trong ngày, cùng một gốc:

- 17:52 chị Ánh: *"doanh số chi tiết theo từng sản phẩm"* → bot chịu, vì
  `bao_cao_linh_hoat` chỉ cho vài bảng/chiều khai sẵn.
- Anh Quốc: *"trên Odoo thao tác được cái gì thì AI làm luôn được không?
  phải viết nhiều tool khác nhau à?"*

Hiện có 18 tool cứng cho luồng nhân viên. Mỗi nghiệp vụ mới = viết tool mới +
test + deploy. Nhân viên còn muốn: xác nhận/huỷ đơn, thu tiền, công nợ, nhập
xuất kho, sửa giá SP, chiết khấu — "còn nhiều lắm". Viết tay không xuể; đây
đúng bệnh "càng thêm càng phình" anh Quốc nêu từ ngày đầu.

## Quyết định (anh Quốc chốt 10/08)

**Tự do có phanh.** Bot làm được mọi thao tác, trừ hai việc phải hỏi gật trước:
1. **XOÁ** (`unlink`) — bất kỳ bảng nào, bất kỳ số lượng.
2. **HÀNG LOẠT** — một lệnh đụng **trên 20 bản ghi**.

Việc ghi thông thường (xác nhận đơn, chiết khấu, nhập kho, thu tiền, sửa SP/
khách) → **làm luôn, không hỏi lại**.

Không có phanh nhân sự/lương: Odoo của LEDNELIA không dùng phân hệ đó.

## Ba tool thay 18 tool cứng

### 1. `doc_odoo` — đọc bất cứ gì

```
{ bang, loc?, cot?, nhom_theo?, do?, sap_xep?, gioi_han? }
```

Ánh xạ thẳng sang `search_read` / `read_group` của Odoo. Một tool trả lời được
"doanh số theo SP của khách X", "khách nào mua nhiều nhất quý 2", "SP nào chưa
bán tháng này" — không cần khai trước.

**Chặn cột nhạy cảm ở TẦNG NÀY** (giữ nguyên luật cũ của `tra_san_pham`):
`standard_price`, `cost`, `purchase_price`, `margin`, và mọi cột chứa
`cost`/`margin`. Bot xin cột cấm → trả lỗi rõ ràng, không im lặng bỏ qua.

### 2. `lam_odoo` — ghi

```
{ bang, viec: 'tao' | 'sua' | 'goi_nut', du_lieu?, loc?, nut?, xac_nhan? }
```

- `tao` → `create`
- `sua` → `write`
- `goi_nut` → gọi method (`action_confirm`, `action_post`, `button_validate`…)

**Phanh 1 — XOÁ**: `viec: 'xoa'` KHÔNG tồn tại trong schema. Muốn xoá phải qua
`goi_nut` với method `unlink`, và bị chặn cứng: đếm bản ghi khớp `loc`, trả về
`{ canXacNhan: true, soBanGhi: N, moTa: "sẽ xoá N đơn nháp..." }`. Lượt sau
nhân viên gật (`xac_nhan: true`) mới chạy.

**Phanh 2 — HÀNG LOẠT**: `loc` khớp > **20** bản ghi → cùng cơ chế xác nhận,
nêu rõ số lượng.

Cả hai phanh nằm trong CODE, không phải prompt.

### 3. `kham_pha_odoo` — bot tự học việc lạ

```
{ bang, hoi: 'cot' | 'nut' | 'tim_bang' }
```

Đọc `ir.model.fields` / `ir.model` để bot biết bảng nào có cột gì, gọi được
method nào. Đây là thứ cho phép "thao tác gì trên Odoo cũng làm được" mà không
ai phải khai trước.

## Bảng khai việc quen — `ThaoTacOdoo`

Anh Quốc chọn CẢ HAI cách dạy bot. Bảng này là tầng nhanh & chính xác:

| Cột | Ví dụ |
|---|---|
| `ten` | "xác nhận đơn" |
| `moTa` | "Đơn nháp → xác nhận bán. Nói: xác nhận đơn S13823" |
| `bang` | `sale.order` |
| `viec` | `goi_nut` |
| `nut` | `action_confirm` |
| `ghiChu` | vì sao có (link bug/yêu cầu) |

Thêm việc mới = INSERT một dòng (hoặc thêm trên giao diện CRM sau), **không
sửa code, không deploy**. Việc không có trong bảng → bot dùng `kham_pha_odoo`
tự suy.

Seed ban đầu theo danh sách anh Quốc nêu: xác nhận đơn, huỷ đơn, thu tiền,
xem/xoá công nợ, nhập kho, xuất kho, điều chỉnh tồn, sửa giá SP, sửa thông tin
khách, thêm/sửa chiết khấu.

## Ranh giới KHÔNG đụng

- **Máy gom đơn** vẫn cầm lái lên đơn/sửa đơn. Ba tool này KHÔNG thay
  `tao_don_nhap`/`sua_don` — quy trình chốt đơn do code quyết vẫn hơn LLM tự do,
  và nó vừa chạy tốt sau 4 vòng sửa.
- **Luồng KHÁCH tuyệt đối không có ba tool này.** Khách điều khiển câu chữ nên
  sẽ điều khiển được lệnh Odoo. Hàng rào ở tầng registry, không phải prompt.
- 18 tool cũ **giữ nguyên**: chúng nhanh hơn, có hàng rào riêng (verify tên
  khách, idempotency, chặn giá ảo). Ba tool mới là để làm những việc chưa có
  tool, không phải để thay thế.

## Nhật ký

Mọi lệnh GHI ghi vào `tool_call_logs` như hiện nay, thêm: bảng, việc, số bản
ghi đụng, và câu gốc của nhân viên. Có sự cố thì truy được ai bảo bot làm gì.

## Test

1. **Unit chặn cột cấm**: xin `standard_price` → lỗi; xin cột thường → qua.
2. **Unit phanh xoá**: `unlink` → luôn trả yêu-cầu-xác-nhận, KHÔNG gọi Odoo.
3. **Unit phanh hàng loạt**: lọc khớp 21 bản ghi → yêu cầu xác nhận; 20 → chạy.
4. **Xác nhận rồi mới chạy**: `xac_nhan: true` → gọi Odoo thật.
5. **Ranh giới**: registry KHÁCH không có ba tool này.
6. **Func với Odoo giả**: "doanh số theo SP của khách X" → dựng đúng
   `read_group`; "xác nhận đơn S13823" → gọi đúng `action_confirm`.
7. Toàn bộ suite cũ phải xanh — 18 tool cũ không đổi hành vi.

## Ngoài phạm vi

- Giao diện CRM quản lý bảng `ThaoTacOdoo` — bản đầu seed bằng SQL, giao diện làm sau.
- Cho bot tự chạy SQL thô — không bao giờ.
- Hoàn tác (undo) — Odoo không có; đó là lý do phanh xoá tồn tại.
