# Hợp đồng xưng hô "anh / chị" — CRM → bot (docs/79 T1, 02/10)

Bot (repo bot, docs/79 T2/T4) đọc hai thứ từ CRM. Mã: `backend/src/modules/bot-quyen/bot-quyen-goi.ts` (luật + đọc DB),
`bot-quyen-cong-khai.ts` (payload), `bot-nguoi-zalo-routes.ts` (route). Test khoá hợp đồng: `backend/tests/bot-quyen-goi.test.ts`
(thuần) và `backend/tests/bot-quyen-goi-db.test.ts` (Postgres thật).

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
- `anh`/`chi` CHỈ khi Contact của (nick, uid) có giới tính NV đã **sửa tay** trên CRM (`contacts.gender_locked = true`,
  `gender` male/female). Giới Zalo tự điền ⇒ `null` (Zalo có thể trả "Nam" mặc định cho người lạ). Nick không thuộc org,
  không có Contact, hai Contact khoá tay khác nhau, giới khoá "khác" ⇒ `null` ⇒ bot xưng "mình".
- Contact của (nick, uid): `contacts.zalo_uid = uid` trong org, cộng Contact của hội thoại 1-1 (`threadType = user`) trên
  nick đó có `external_thread_id = uid`; Contact đã gộp (`merged_into`) ⇒ xét cả bản chính.

## 3. Trang Quyền bot (chỉ CRM — để biết `goi` đến từ đâu)

`GET /api/v1/bot-quyen/nhan-vien` trả thêm `goi`, `goiGoiY`, `goiNguon` (`khoa_tay` | `zalo_tu_dien` | null), `goiGoiYLyDo`
(`chua_co_gioi` | `mau_thuan_khoa_tay` | `mau_thuan_zalo` | `khoa_tay_khac` | null) — gợi ý từ Contact của MỌI uid người đó,
khoá tay thắng Zalo tự điền, mâu thuẫn cùng mức ⇒ không gợi ý. `PUT /nhan-vien/:id {goi}` / `POST /nhan-vien {…, goi}` ghi
(sai ⇒ `400 GOI_KHONG_HOP_LE`), nhật ký `bot_quyen_nhat_ky` trước/sau cùng giao dịch. Cột "Gọi là": chọn là lưu; chip gợi ý
+ "Dùng"; "Áp gợi ý đã xác nhận" chỉ áp gợi ý `khoa_tay` cho dòng CHƯA chọn.
