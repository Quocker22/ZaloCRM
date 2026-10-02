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
| `nhay_cam` | mảng nhãn `^[a-z][a-z0-9_]{0,31}$`, ≤ 20 | không (mặc định `[]`) | khử trùng + sắp xếp. Nhãn bot dùng: `gia sdt tien doanh_so lai ten_khach` |
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
  "luat_id":   "luat-1",                     // `id` luật CRM (bot_luat_thong_bao.id — GET luật trả kèm, §6) | null = gửi ở nơi gốc
  "ket_qua":   "bong",                       // da_gui | chan_tam_im | loi | bong | chua_ro | bo (= CHECK tin_gui_so.ket_qua của bot; bo = nội dung rỗng)
  "cua_so":    "24h",                        // 24h | 7d
  "so":        7,                            // số nguyên ≥ 0
  "luat_phien_ban_tu": 2                     // TUỲ CHỌN (Codex CRM+UI v2 #5) — xem dưới
}
```

- 7 trường bắt buộc + 1 tuỳ chọn `luat_phien_ban_tu`, không thêm trường nào khác; `(khoa_canh, ket_qua, cua_so)` duy nhất
  trong ảnh chụp.
- `luat_phien_ban_tu` (số nguyên ≥ 1 | null | vắng): phiên bản luật (`phien_ban` của luật CRM lúc bot xếp tin —
  `tin_bao.phien_ban`) **THẤP NHẤT** trong các tin được đếm ở dòng này = `MIN(tin_bao.phien_ban)`. Chỉ dòng có `luat_id`
  (dòng `luat_id = null` mang số ⇒ 400). `null`/vắng = không biết (bot cũ). Giao diện: mọi dòng 24h của luật có
  `luat_phien_ban_tu ≥ phien_ban` hiện tại ⇒ số bóng 24h phản ánh ĐÚNG cấu hình đang xem; ngược lại hiện "chưa đủ dữ liệu
  cho cấu hình mới". CRM gộp hai dòng trùng (đổi `loai` → `id`) ⇒ MIN; một bên không biết ⇒ `null`. Bot chưa gửi thì vẫn
  hợp lệ — giao diện chỉ gọi là "số bóng lịch sử 24h".
- "24h sẽ gửi N" của giao diện = tổng `so` với `ket_qua = bong`, `cua_so = 24h` của các cạnh luật.
- `luat_id` là **`id`** của luật (uuid, lấy từ `GET /api/public/bot-thong-bao/luat` → `luat[].id`), KHÔNG phải `loai`.
  **Tương thích MỘT bản (02/10):** bot cũ gửi `loai` vào `luat_id` (và vào hậu tố `khoa_canh`) — CRM vẫn nhận, lúc lưu đổi
  sang `id` của luật cùng org mang `loai` đó và viết lại `khoa_canh`; hai dòng trùng (khoa_canh, ket_qua, cua_so) sau khi
  đổi ⇒ gộp (cộng `so`). `luat_id` không khớp id lẫn loai (luật đã xoá — số 7 ngày còn) ⇒ giữ nguyên. Đọc lại (§5) luôn ra
  `id` cho ảnh chụp lưu SAU 02/10; ảnh chụp lưu trước có thể còn `loai` ⇒ giao diện quy về luật theo `id`, không khớp thì
  thử `loai`. Bản sau sẽ bỏ nhánh `loai` (CRM log `warn` mỗi lần còn đổi).
- Bot đếm từ sổ `tin_gui_so` (`composer, cid, luat_id, ket_qua`) — `dich_kieu` là KIỂU đích, không phải cid (không gửi
  định danh nhóm/người sang CRM).

## 5. Đọc lại (giao diện)

`GET /api/v1/bot-quyen/ban-do-tin` (owner/admin) → `{ banDo: { phienBan, composer, nguon, dem, luc } | null }` — đúng các
mảng đã chuẩn hoá ở §2–§4 (round-trip giữ nguyên mọi trường). `luc` = lúc CRM nhận ảnh chụp.

## 6. An toàn

- **Nhạy cảm DÍNH** (`bot_ban_do_tin.composer_dinh`): với composer đã biết, ảnh chụp mới gỡ nhãn `nhay_cam` hoặc bỏ `khoa`
  ⇒ `409 NHAY_CAM_DINH`, giữ bản cũ. Vắng mặt không xoá khỏi sổ.
- **Phát luật cho bot** (`GET /api/public/bot-thong-bao/luat` → `{phien_ban, luat:[{id, loai, dich, che_do, dieu_kien,
  gom_giay, lich, phien_ban}], canh_bao}` — `id` có từ 02/10, là giá trị bot ghi vào `luat_id`) kiểm theo HỢP ảnh chụp hiện tại ∪ sổ dính (Codex v1 #1):
  composer vắng khỏi ảnh chụp vẫn mang nhãn của sổ; composer không có ở cả hai ⇒ luật trả `dich: []` + `canh_bao`
  (fail closed). Trang quản trị (`GET /luat-thong-bao` → `canhBao`) thấy đúng cảnh báo đó.
- **Nhóm khách** (`chuc_nang: khach`, Codex CRM+UI v2 #6): bot chưa có đích này (`dong_bo_luat.py` chỉ nhận
  `admin|kho|ke_toan|sales`). CRM từ chối LƯU (`POST/PUT` ⇒ `400 BOT_CHUA_HO_TRO_NHOM_KHACH`, composer nhạy cảm vẫn ra
  `LO_DU_LIEU_NHOM_KHACH` trước) và khi PHÁT bỏ đích đó + `canh_bao` "`<loai>: bỏ đích chuc_nang:khach — Bot chưa hỗ trợ gửi
  nhóm khách`" (dòng cũ / SQL tay). Giao diện khoá ô "Nhóm khách" kèm lý do.
- **Ảnh chụp ĐẦU TIÊN được tin** (sổ rỗng thì không có gì để so). Giảm rủi ro: đặt khoá RIÊNG của bot TRƯỚC lần đẩy đầu —
  `app_settings` dòng `(org_id, setting_key = 'bot_ban_do_tin_api_key', value_plain = <khoá ngẫu nhiên>)`. Có khoá riêng
  ⇒ `POST /api/public/ban-do-tin` chỉ nhận khoá đó (khoá chung `public_api_key` ⇒ `403 CAN_KHOA_RIENG_BOT`); `GET` luật nhận
  cả hai. Bot đặt khoá riêng vào env của bridge, không dùng chung với tích hợp khác.
- Không có nội dung tin thật trong ảnh chụp: `vi_du` là câu mẫu bot tự khai; số đếm không mang cid.

## Bổ sung 02/10 (sau vòng 2 giao diện) — trường composer bắt buộc thêm

| trường | kiểu | ý nghĩa | dùng ở bản đồ |
|---|---|---|---|
| `ai_soan` | `"ma" \| "model" \| "mau" \| "anh"` | ai soạn tin | nhãn khối Mã/Model/Mẫu/Ảnh (như bản mẫu chủ đã xem) |
| `ly_do_khoa` | string \| null | vì sao đích cố định (chỉ khi `kieu="khoa"`) | dòng 🔒 trong panel |
| `goi_y` | string \| null | gợi ý cấu hình (vd "Ứng viên: thêm nhóm Kế toán") | panel |

Số đếm cho khối gốc: bot gửi thêm dòng `dem` với `luat_id=null`, `dich_kieu` = đích gốc (`nhom_goc`/`dm_nguoi_go`/`nguoi_giu_ma`…), `khoa_canh="<composer>→<dich_kieu>|goc"` — để khối gốc cũng có số 24h/7d. `dich_kieu` của bot dùng đúng mã hàng bản đồ: `nhom_goc, dm_nguoi_go, nguoi_giu_ma, chu_don, g_kho, g_admin, g_ketoan, g_sales, g_kythuat, nv, g_khach`.
CRM chuẩn hoá phải GIỮ ba trường mới (kiểm kiểu; `ai_soan` ngoài 4 giá trị ⇒ 400).

CRM thực thi (`docAnhChup`, 02/10): `ai_soan` **thiếu** hoặc ngoài 4 giá trị (phân biệt hoa thường) ⇒ 400; `ly_do_khoa`/`goi_y`
là chuỗi ≤ 1000 hoặc null (rỗng ⇒ `null`, sai kiểu ⇒ 400); `ly_do_khoa` khác rỗng ở composer `kieu ≠ "khoa"` ⇒ 400. Ảnh chụp
đã lưu TRƯỚC 02/10 đọc ra ba trường = `null` (không đoán). Dòng đếm khối gốc đi đúng §4 (đã nhận từ trước — `luat_id=null`
⇔ hậu tố `|goc`); `ket_qua = "bo"` nhận theo §4.

## 7. Đối soát tin `chua_ro` (bổ sung 02/10)

`POST /api/public/ban-do-tin/doi-soat-echo` — CHỈ ĐỌC, cùng luật khoá như `POST /api/public/ban-do-tin` (§6: org đã có khoá
riêng ⇒ chỉ khoá riêng, khoá chung ⇒ `403 CAN_KHOA_RIENG_BOT`; thiếu/sai khoá ⇒ 401). Org lấy từ khoá.

```jsonc
// vào
{ "echo_ids": ["tb:812:0", "tb:812:1"] }      // 0–200 chuỗi, mỗi chuỗi 1–200 ký tự (cắt khoảng trắng), khử trùng
// ra 200
{ "co": ["tb:812:0"], "that_bai": [], "khong": ["tb:812:1"] }   // giữ thứ tự gửi lên
```

- `co` — có tin GỬI ĐI (`messages.sender_type = 'self'`) mang `client_echo_id` đó trong một hội thoại CỦA ORG ⇒ bot đổi
  `chua_ro` → `da_gui`.
- `that_bai` — tin có lưu nhưng Zalo từ chối (`metadata.sendStatus = 'failed'`; CRM lưu cả tin gửi hỏng) ⇒ KHÔNG phải đã gửi;
  bot tự quyết (`loi`), vẫn không gửi lại tự động.
- `khong` — không thấy (kể cả có ở org KHÁC) ⇒ bot giữ `chua_ro`.
- Sai hình (thiếu `echo_ids`, không phải mảng, > 200, phần tử rỗng / không phải chuỗi / > 200 ký tự) ⇒
  `400 DOI_SOAT_KHONG_HOP_LE`.
- Echo là `echoId` bot gửi kèm khi gửi tin qua `POST /api/v1/conversations/:id/messages` (CRM lưu vào `client_echo_id`,
  UNIQUE theo hội thoại, từ 15/06 — không thêm cột). Chỉ mục `messages_client_echo_id_idx` (riêng phần, migration
  `20261002090600_messages_idx_client_echo`, CONCURRENTLY) cho tra theo echo trên cả org.
