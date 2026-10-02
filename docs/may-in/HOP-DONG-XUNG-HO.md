# Hợp đồng xưng hô "anh / chị" — CRM → bot (docs/79 T1, 02/10)

Bot (repo bot, docs/79 T2/T4) đọc hai thứ từ CRM. Mã: `backend/src/modules/bot-quyen/bot-quyen-goi.ts` (luật + đọc DB),
`bot-quyen-cong-khai.ts` (payload), `bot-nguoi-zalo-routes.ts` (route). Test khoá hợp đồng: `backend/tests/bot-quyen-goi.test.ts`
(thuần), `backend/tests/bot-quyen-goi-db.test.ts` và `backend/tests/contact-gioi-xac-nhan-db.test.ts` (Postgres thật).

## 1. `GET /api/public/bot-quyen` — thêm `nhan_vien[].goi`

```jsonc
{ "phien_ban": "…", "nhom": [...], "nick_crm": [...],
  "nhan_vien": [
    { "zalo_uid": "100", "ten_goi": "Quyết", "vai": "admin", "trang_thai": "hoat_dong",
      "goi": "anh",                      // 'anh' | 'chi' | null — LUÔN có khoá; null = chưa chọn ⇒ bot gọi "anh/chị" như cũ
      "uids": [ { "nick_uid": "900", "uid": "100", "nguon": "chu_chon" } ] } ] }
```

- `goi` là giá trị NGƯỜI GIỮ TRANG Quyền bot đã chọn (cột `bot_nhan_vien.goi`, CHECK `anh|chi`). Gợi ý từ giới tính Zalo
  KHÔNG BAO GIỜ vào payload.
- `phien_ban` băm cả `goi` ⇒ đổi `goi` là đổi `phien_ban`. Bản thêm ô này làm `phien_ban` của mọi org đổi một lần lúc lên (bot
  áp lại — vô hại). Bot cũ bỏ qua khoá lạ.

## 2. `GET /api/public/nguoi-zalo/goi?nick_uid=<uid nick CRM>&uid=<uid người đó theo nick ấy>`

- Khoá: header `x-api-key` — `public_api_key` hoặc khoá riêng `bot_ban_do_tin_api_key` (như `doi-soat-echo`); org lấy TỪ KHOÁ.
  Org đã đặt khoá riêng ⇒ khoá chung bị `403 CAN_KHOA_RIENG_BOT`. Thiếu/sai khoá ⇒ `401`.
- Tham số: hai chuỗi 1–64 ký tự `[A-Za-z0-9_-]`, sai ⇒ `400 THAM_SO_KHONG_HOP_LE`. Giới hạn 600 lần/phút.
- Trả **đúng** `{ "goi": "anh" | "chi" | null, "nguon": "khoa_tay" | null }` — không tên, không id, không giới gốc.
- `anh`/`chi` CHỈ khi Contact của (nick, uid) có giới tính NV đã **xác nhận** trên CRM (`contacts.gioi_tinh_xac_nhan_luc IS NOT
  NULL`, `gender` male/female — §4). Giới Zalo tự điền ⇒ `null` (Zalo có thể trả "Nam" mặc định cho người lạ). **Khoá cũ không
  dấu** (`gender_locked = true` mà `gioi_tinh_xac_nhan_luc` NULL — form cũ khoá giới ở MỌI lần bấm Lưu) ⇒ `null` (sửa 02/10,
  tự soát P1; trước đó trả anh/chị). Nick không thuộc org, không có Contact, hai Contact đã xác nhận khác nhau, giới xác nhận
  "khác" ⇒ `null` ⇒ bot xưng "mình".
- `nguon: "khoa_tay"` giữ nguyên tên (không đổi hình hợp đồng) nhưng nghĩa là **"đã xác nhận"** (có dấu §4).
- Contact của (nick, uid): `contacts.zalo_uid = uid` trong org, cộng Contact của hội thoại 1-1 (`threadType = user`) trên
  nick đó có `external_thread_id = uid`; Contact đã gộp (`merged_into`) ⇒ xét cả bản chính.

## 3. Trang Quyền bot (chỉ CRM — để biết `goi` đến từ đâu)

`GET /api/v1/bot-quyen/nhan-vien` trả thêm `goi`, `goiGoiY`, `goiNguon` (`khoa_tay` | `zalo_tu_dien` | null), `goiGoiYLyDo`
(`chua_co_gioi` | `mau_thuan_khoa_tay` | `mau_thuan_zalo` | `khoa_tay_khac` | null) — gợi ý từ Contact của MỌI uid người đó,
đã xác nhận (§4) thắng Zalo tự điền (khoá cũ không dấu xếp cùng hạng Zalo tự điền), mâu thuẫn cùng mức ⇒ không gợi ý. `PUT /nhan-vien/:id {goi}` / `POST /nhan-vien {…, goi}` ghi
(sai ⇒ `400 GOI_KHONG_HOP_LE`), nhật ký `bot_quyen_nhat_ky` trước/sau cùng giao dịch. Cột "Gọi là": chọn là lưu; chip gợi ý
+ "Dùng"; "Áp gợi ý đã xác nhận" mở hộp liệt kê từng người + gợi ý, xác nhận xong mới áp gợi ý `khoa_tay` cho dòng CHƯA
chọn (lý do — nếu ghi — vào nhật ký từng dòng).

## 4. Dấu "NV đã xác nhận giới tính" (`contacts.gioi_tinh_xac_nhan_luc` / `_boi`, migration `20261002120000_contact_gioi_tinh_xac_nhan`)

Chỉ thêm hai cột NULL, không backfill. `PUT /api/v1/contacts/:id` (luật thuần `backend/src/modules/contacts/gioi-tinh-xac-nhan.ts`,
test `backend/tests/contact-gioi-xac-nhan-db.test.ts`):

| thân | đang lưu | kết quả |
|---|---|---|
| không có `gender` | — | không đụng giới / khoá / dấu |
| `gender` = giá trị đang lưu (form lưu cả form: sửa SĐT, tên, ghi chú…) | bất kỳ | **không đụng gì** — không khoá, không dấu; khoá cũ giữ nguyên |
| `gender` khác giá trị đang lưu, có giá trị | bất kỳ | ghi giới + `gender_locked = true` + dấu (lúc, user id) |
| `gender` rỗng / null khi đang có giới | có | xoá giới, mở khoá, **xoá dấu** |
| `gender` = giá trị đang lưu + `xacNhanGioi: true` (nút "Xác nhận" cạnh ô giới tính) | có giới | khoá + dấu |

`gender_locked` vẫn chỉ để chặn SDK/cron đè giới (nghĩa cũ), nay cũng chỉ bật khi giới THỰC ĐỔI. Giao diện: cột 4 khung chat
(ChatContactPanel) hiện "✓ đã xác nhận" khi có dấu, nút "Xác nhận" khi có giới chưa dấu; ba form hồ sơ chỉ gửi `gender` khi
ô giới tính đổi (`frontend/src/composables/gioi-tinh-xac-nhan.ts`). Tạo Contact mới (POST) không đóng dấu.
