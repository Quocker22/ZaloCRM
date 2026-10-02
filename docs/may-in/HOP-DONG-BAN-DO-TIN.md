# Hợp đồng ảnh chụp "Bản đồ tin" — bot → CRM → giao diện (docs/78, chốt 02/10 sau Codex CRM v1 #7)

Ràng buộc ba bên: **bot** (B4 — đẩy ảnh chụp), **CRM** (`POST /api/public/ban-do-tin`, kiểm ở
`backend/src/modules/bot-quyen/bot-thong-bao-luat.ts` `docAnhChup`), **giao diện** (C3 — trang Bản đồ tin đọc
`GET /api/v1/bot-quyen/ban-do-tin`). Hai bản giống hệt nhau: `docs/78-thong-bao-chu-dong/hop-dong-ban-do-tin.md` (repo bot)
và `docs/may-in/HOP-DONG-BAN-DO-TIN.md` (repo ZaloCRM). Đổi hợp đồng = đổi CẢ HAI + `docAnhChup` + test round-trip
`backend/tests/bot-thong-bao-db.test.ts` ("hợp đồng ảnh chụp").

Sai hình ở BẤT KỲ chỗ nào ⇒ `400 ANH_CHUP_KHONG_HOP_LE`, ảnh chụp cũ giữ nguyên (không lưu nửa vời). Thân ≤ 1 MB.

## 1. Gốc

```jsonc
{
  "phien_ban": "a1b2c3d4e5f60718",   // bắt buộc, chuỗi 1–128 (bot: 16 hex đầu sha256 phần còn lại)
  "composer": [ /* §2, 1–300 phần tử, id duy nhất */ ],
  "nguon":    [ /* §3, 0–50, tuỳ chọn */ ],
  "dem":      [ /* §4, 0–5000, tuỳ chọn */ ],
  "pha": [...], "dich": [...]          // bot gửi kèm (bảng tên) — CRM NHẬN và BỎ QUA, không lưu
}
```

Trường lạ ở gốc / trong composer / trong nguồn: bỏ qua (không lưu). Trường lạ trong một dòng `dem`: **400** (số đếm là dữ
liệu đo — sai tên trường là mất số âm thầm).

## 2. Composer

| trường | kiểu | bắt buộc | ghi chú |
|---|---|---|---|
| `id` | `^[a-z][a-z0-9_.]{0,63}$` | có | duy nhất trong ảnh chụp, không trùng id nguồn |
| `kieu` | `khoa` \| `ban_sao` \| `thuan` | có | `khoa` = 🔒 không định tuyến được |
| `nhay_cam` | mảng nhãn `^[a-z][a-z0-9_]{0,31}$`, ≤ 20 | không (mặc định `[]`) | khử trùng + sắp xếp. Nhãn bot dùng: `gia sdt tien doanh_so lai` |
| `ten` | chuỗi ≤ 200 | không | |
| `pha` | chuỗi ≤ 64 | không | mã pha của bot (`hoi len_don chot xuat_hd in thu_tien kho bao_cao he_thong`) |
| `de_xuat` | boolean | không (mặc định `false`) | composer đề xuất mới (chưa có trong mã gửi) |
| `dich_goc` | mảng mã đích (hoặc MỘT chuỗi ⇒ mảng một phần tử), ≤ 20 | không (mặc định `[]`) | `nhom_goc dm_nguoi_go nguoi_giu_ma chu_don g_kho g_admin g_ketoan g_sales g_kythuat nv g_khach` |
| `khi_nao` | chuỗi ≤ 2000 | không | rỗng ⇒ `null` |
| `vi_du` | chuỗi ≤ 4000 | không | câu MẪU bot khai (không phải tin thật) |
| `nguon_cau` | chuỗi ≤ 1000 | không | file:dòng trong mã bot |
| `ghi_chu` | chuỗi ≤ 4000 | không | rỗng ⇒ `null` |
| `dan_toi` | mảng ≤ 60 cạnh | không (mặc định `[]`) | §2.1 |

### 2.1 Cạnh `dan_toi`

- Dạng chuẩn `{ "den": "<id>", "kieu": "<kiểu>", "vi_sao"?: "<≤ 500>" }`; CRM cũng nhận cặp `["<id>", "<kiểu>"]`
  (đúng `xuat_json()` của bot 02/10) và **lưu/trả về dạng chuẩn**.
- `kieu` ∈ `nghiep_vu | hoi_lai | su_kien | chan` (= `KIEU_LIEN_KET` của bot `lednelia_donhang/thong_bao/danh_muc.py`).
  Cạnh `ban_sao` KHÔNG khai ở đây — sinh từ luật (CRM). Giao diện tự ánh xạ sang tên vẽ của nó.
- `den` phải là id một composer hoặc một nguồn trong **CÙNG** ảnh chụp (không đường cụt) — sai ⇒ 400.
- Khử trùng theo `(den, kieu)`: giá trị của lần sau thắng, vị trí là của lần xuất hiện đầu.

## 3. Nguồn giả (`nguon`)

`{ "id", "ten"?, "pha"?, "mo_ta"? (≤ 2000), "dan_toi"? }` — khối không phải composer (máy in, Odoo, lịch…) chỉ để vẽ cạnh
vào composer. `id` cùng luật với composer và không trùng id composer. Bot hiện có `nguon_may_in`, `nguon_odoo`, `nguon_lich`.

## 4. Số đếm (`dem`) — một dòng mỗi (cạnh, kết quả, cửa sổ)

```jsonc
{
  "khoa_canh": "in_sau_chot→g_kho|luat-1",  // = "<composer>→<dich_kieu>|<luat_id ?? 'goc'>" — CRM kiểm KHỚP với 3 trường dưới
  "composer":  "in_sau_chot",                // id composer (có thể không có trong danh mục, vd `chua_khai`)
  "dich_kieu": "g_kho",                      // mã đích `^[a-z][a-z0-9_]{0,31}$`
  "luat_id":   "luat-1",                     // id luật CRM (bot_luat_thong_bao.id) | null = gửi ở nơi gốc
  "ket_qua":   "bong",                       // da_gui | chan_tam_im | loi | bong | chua_ro (= CHECK tin_gui_so.ket_qua của bot)
  "cua_so":    "24h",                        // 24h | 7d
  "so":        7                             // số nguyên ≥ 0
}
```

- Đủ 7 trường, không thêm trường nào; `(khoa_canh, ket_qua, cua_so)` duy nhất trong ảnh chụp.
- "24h sẽ gửi N" của giao diện = tổng `so` với `ket_qua = bong`, `cua_so = 24h` của các cạnh luật.
- Bot đếm từ sổ `tin_gui_so` (`composer, cid, luat_id, ket_qua`) — `dich_kieu` là KIỂU đích, không phải cid (không gửi
  định danh nhóm/người sang CRM).

## 5. Đọc lại (giao diện)

`GET /api/v1/bot-quyen/ban-do-tin` (owner/admin) → `{ banDo: { phienBan, composer, nguon, dem, luc } | null }` — đúng các
mảng đã chuẩn hoá ở §2–§4 (round-trip giữ nguyên mọi trường). `luc` = lúc CRM nhận ảnh chụp.

## 6. An toàn

- **Nhạy cảm DÍNH** (`bot_ban_do_tin.composer_dinh`): với composer đã biết, ảnh chụp mới gỡ nhãn `nhay_cam` hoặc bỏ `khoa`
  ⇒ `409 NHAY_CAM_DINH`, giữ bản cũ. Vắng mặt không xoá khỏi sổ.
- **Phát luật cho bot** (`GET /api/public/bot-thong-bao/luat`) kiểm theo HỢP ảnh chụp hiện tại ∪ sổ dính (Codex v1 #1):
  composer vắng khỏi ảnh chụp vẫn mang nhãn của sổ; composer không có ở cả hai ⇒ luật trả `dich: []` + `canh_bao`
  (fail closed). Trang quản trị (`GET /luat-thong-bao` → `canhBao`) thấy đúng cảnh báo đó.
- **Ảnh chụp ĐẦU TIÊN được tin** (sổ rỗng thì không có gì để so). Giảm rủi ro: đặt khoá RIÊNG của bot TRƯỚC lần đẩy đầu —
  `app_settings` dòng `(org_id, setting_key = 'bot_ban_do_tin_api_key', value_plain = <khoá ngẫu nhiên>)`. Có khoá riêng
  ⇒ `POST /api/public/ban-do-tin` chỉ nhận khoá đó (khoá chung `public_api_key` ⇒ `403 CAN_KHOA_RIENG_BOT`); `GET` luật nhận
  cả hai. Bot đặt khoá riêng vào env của bridge, không dùng chung với tích hợp khác.
- Không có nội dung tin thật trong ảnh chụp: `vi_du` là câu mẫu bot tự khai; số đếm không mang cid.
