# Hợp đồng "Cho khách": bot → CRM → bot (docs/79 T5, 02/10)

Đường khách của bot (docs/79 T3/T4) chỉ được dùng **tài liệu kho tri thức (RAG) đã đánh dấu "khách xem được"** và **mô tả bán
hàng (`description_sale`) đã duyệt**. Người giữ trang duyệt ở tab **"Cho khách"** của trang Quyền bot (CRM). Hợp đồng gồm ba bên:

| bên | việc | mã |
|---|---|---|
| bot | đẩy danh mục (`POST /api/public/cho-khach/danh-muc`), đọc duyệt (`GET /api/public/cho-khach/duyet`), **so băm trước khi dùng mô tả VÀ tài liệu** | repo bot (T4) |
| CRM | kiểm danh mục, lưu bản mới nhất, lưu duyệt + nhật ký | `backend/src/modules/bot-quyen/bot-cho-khach-*.ts` |
| giao diện | tab "Cho khách" (`/api/v1/bot-quyen/cho-khach/*`, owner/admin) | `frontend/src/components/bot-quyen/BotQuyenChoKhachTab.vue` |

Đổi hợp đồng = đổi file này + `bot-cho-khach-hop-dong.ts` + test `backend/tests/bot-cho-khach-hop-dong.test.ts` (vector băm §3, §3b).

## 1. Khoá

Như `POST /api/public/ban-do-tin`: header `x-api-key` = `public_api_key` (chung) **hoặc** khoá riêng của bot
`app_settings(setting_key='bot_ban_do_tin_api_key')`. Org đã đặt khoá riêng ⇒ cả hai route dưới **chỉ** nhận khoá riêng
(khoá chung ⇒ `403 CAN_KHOA_RIENG_BOT`). Org lấy TỪ KHOÁ — không có tham số org. Thiếu/sai khoá ⇒ `401`.

## 2. Bot → CRM: `POST /api/public/cho-khach/danh-muc`

Thân ≤ **8 MB**. CRM giữ **một** danh mục mỗi org (bản mới nhất thay bản cũ). Sai ở BẤT KỲ chỗ nào ⇒ `400`, bản cũ giữ nguyên.

```jsonc
{
  "phien_ban": "a1b2c3…",            // bắt buộc, chuỗi 1–128 (bot tự đặt, vd sha256 nội dung) — CRM trả lại ở GET duyệt
  "tai_lieu": [                      // bắt buộc, 0–5000, id duy nhất
    {
      "id": "0b6a3c1e-…",            // kb_documents.id — ^[A-Za-z0-9_-]{1,64}$
      "tieu_de": "Datasheet P10",    // 1–500 (cắt khoảng trắng hai đầu)
      "loai": "pdf",                 // kb_documents.loai_file — ≤ 64 | null | vắng
      "nguon": "file-zalo",          // kb_documents.nguon — ≤ 64 | null | vắng
      "so_doan": 12,                 // số dòng kb_chunks của tài liệu, nguyên ≥ 0
      "cap_nhat_luc": "2026-09-30T02:00:00Z", // kb_documents.updated_at — ISO 8601 | null (CRM lưu dạng toISOString)
      "mau_noi_dung": "Module P10…", // TUỲ CHỌN — đầu nội dung để người duyệt nhìn; CRM cắt còn 300 ký tự (code point)
      "noi_dung_bam": "954417e5…"    // BẮT BUỘC có mặt — sha256 §3b của NỘI DUNG ĐẦY ĐỦ | null khi tài liệu rỗng
    }
  ],
  "san_pham": [                      // bắt buộc, 0–20000, product_id duy nhất
    {
      "product_id": 1234,            // id product.template trên Odoo (nơi description_sale sống) — nguyên dương
      "ma": "LED-01",                // default_code — ≤ 128 | null
      "ten": "Led dây 12V",          // 1–500
      "mo_ta_ban": "Điện áp 12V\nIP65", // description_sale nguyên văn — ≤ 20000 | null
      "mo_ta_bam": "cff3e472…"       // sha256 §3 của mo_ta_ban | null khi không có mô tả
    }
  ]
}
```

- Trường lạ: bỏ qua (không lưu).
- `noi_dung_bam` vắng, hoặc không phải 64 hex thường / `null` ⇒ `400 DANH_MUC_KHONG_HOP_LE`. CRM **không** có nội dung đầy đủ nên
  không tự tính lại được (khác `mo_ta_bam`) — bot chịu trách nhiệm tính đúng §3b; lệch cách tính chỉ làm tài liệu "không dùng
  được" (bot so băm của chính nó, §4 luật 2), không bao giờ làm lộ tài liệu chưa duyệt.
- `mo_ta_bam` **phải** bằng băm CRM tự tính từ `mo_ta_ban` (§3); lệch, hoặc có mô tả mà thiếu băm, hoặc không có mô tả mà có
  băm ⇒ `400 MO_TA_BAM_LECH` (nêu product_id + băm CRM tính). Mô tả rỗng sau chuẩn hoá = không có mô tả (CRM lưu `null`).
- Hình sai khác ⇒ `400 DANH_MUC_KHONG_HOP_LE`.
- `200 {ok: true, phien_ban, so_tai_lieu, so_san_pham}`.
- Nhật ký `bot_quyen_nhat_ky` (`doi_tuong='danh_muc_cho_khach'`, `ai_id='api_key:<id cài đặt>'`): lần đầu, và mỗi khi tập tài
  liệu / tập SP / băm mô tả đổi (số lượng + ≤ 50 id thêm/bỏ/đổi — không chép nội dung). Gửi lại y hệt ⇒ không ghi.
- Gửi khi: khởi động, sau mỗi lần đồng bộ kho tri thức, và sau mỗi lần `description_sale` đổi (kể cả NV sửa qua bot).
  Nên gửi cả SP **không** có mô tả (để trang có bộ lọc "Tất cả SP"); có thể bỏ SP ngừng bán.

## 3. Chuẩn hoá + băm mô tả (K2)

```
chuan(s) = s
  → Unicode NFC
  → "\r\n" và "\r" thành "\n"
  → tách theo "\n"; mỗi dòng: mỗi chuỗi ký tự thuộc lớp KT (dưới) thành MỘT dấu cách, rồi bỏ dấu cách ở hai đầu dòng
  → bỏ dòng rỗng
  → nối bằng "\n"
bam(s) = chuan(s) == "" ? null : hex_thuong(sha256(utf8(chuan(s))))

KT = [\t \v \f U+0020 U+00A0 U+1680 U+2000–U+200A U+2028 U+2029 U+202F U+205F U+3000 U+FEFF]
```

KT liệt kê **tường minh** — KHÔNG dùng `\s` / `strip()` (JS và Python khác nhau ở vài ký tự hiếm: U+001C–U+001F, U+0085,
U+FEFF). Python: `re.sub(r'[\t\v\f \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', dong)` rồi bỏ
một dấu cách đầu/cuối (sau khi gộp chỉ còn tối đa một).

Vector (bot PHẢI kiểm cùng giá trị):

| `mo_ta_ban` | `mo_ta_bam` |
|---|---|
| `"Điện áp 12V\nIP65"` | `cff3e472b1116ef9867dc369dad46aa544120d98453a1caa159daef1b39442a9` |
| `"  Điện  áp 12V \r\n\r\n\u00a0IP65 "` | như trên (chỉ khác khoảng trắng) |
| `"  \n\t "`, `null` | `null` |

NFC trong Python: `unicodedata.normalize('NFC', s)`. Lệch cách chuẩn hoá lộ ra ngay ở lần đẩy đầu (`400 MO_TA_BAM_LECH`), không
âm thầm.

## 3b. Băm nội dung tài liệu (duyệt tài liệu gắn NỘI DUNG)

```
noi_dung(doc) = nối các kb_chunks.noi_dung của doc, sắp theo kb_chunks.ord TĂNG DẦN, bằng "\n"
noi_dung_bam(doc) = bam(noi_dung(doc))          -- đúng chuan()/bam() §3: NFC, CRLF, lớp KT, bỏ dòng rỗng, sha256 hex thường
                  = null khi doc không có đoạn nào hoặc rỗng sau chuẩn hoá (tài liệu như vậy KHÔNG duyệt được)
```

SQL tham khảo (bot): `select string_agg(noi_dung, E'\n' order by ord) from kb_chunks where document_id = $1` rồi `bam()` trong
Python. Đoạn rỗng giữa chừng không đổi băm (dòng rỗng bị bỏ), đổi THỨ TỰ đoạn thì đổi băm.

Vector (bot PHẢI kiểm cùng giá trị):

| các đoạn theo `ord` | `noi_dung_bam` |
|---|---|
| `["Module P10 full color", "Điện áp 5V\nCông suất 30W"]` | `954417e52b60aaf91952023735fbdc9c657abde3387872de1d285fc05ba34c45` |
| `["Điện áp 12V", "IP65"]` | `cff3e472…` (bằng vector §3 — cùng văn bản sau khi nối) |
| `[]`, `["  ", "\t"]` | `null` |

## 4. CRM → bot: `GET /api/public/cho-khach/duyet`

```jsonc
{
  "phien_ban": "9f…",                       // sha256 hex của JSON chuẩn {tai_lieu_cho_khach, mo_ta_da_duyet} — đổi ⇔ nội dung đổi
  "danh_muc_phien_ban": "a1b2c3…",          // phien_ban danh mục CRM đang giữ | null (chưa nhận danh mục nào)
  "tai_lieu_cho_khach": [{ "id": "0b6a3c1e-…", "noi_dung_bam": "954417e5…" }],
                                            // tài liệu đã duyệt, CÒN trong danh mục mới nhất VÀ noi_dung_bam trong danh mục ==
                                            // băm lúc duyệt; kèm băm LÚC DUYỆT; sắp theo id tăng dần
  "mo_ta_da_duyet": [{ "product_id": 1234, "mo_ta_bam": "cff3e472…" }]  // mọi duyệt kèm băm LÚC DUYỆT, sắp theo product_id
}
```

Luật bot (bắt buộc — CRM không thay được):

1. **Mặc định đóng.** Tài liệu không có trong `tai_lieu_cho_khach` ⇒ không dùng cho khách. Chưa đọc được lần nào / lỗi mạng ⇒
   coi như rỗng (không tài liệu, không mô tả); có bản cũ thì giữ bản cũ đọc được gần nhất.
2. **Tài liệu gắn băm.** Chỉ dùng tài liệu cho khách khi `noi_dung_bam(doc)` (§3b) tính trên `kb_chunks` HIỆN TẠI của bot ==
   `noi_dung_bam` đã duyệt của nó. Khác ⇒ coi như chưa duyệt: kho tri thức nạp lại tài liệu cùng `kb_documents.id` (đồng bộ
   lại theo `nguon_id`) mà nội dung đổi là mất duyệt ngay, không đợi CRM — người giữ trang thấy chip "Tài liệu đã đổi — cần
   duyệt lại" sau lần đẩy danh mục kế tiếp.
3. **Mô tả gắn băm.** Chỉ dùng `description_sale` của SP khi `bam(description_sale hiện tại) == mo_ta_bam` đã duyệt của SP
   đó. Khác ⇒ coi như chưa duyệt (K2): NV sửa mô tả qua bot / trên Odoo là mất duyệt ngay, không đợi CRM.
4. Poll như `/api/public/bot-quyen` (~60 s); so `phien_ban` để biết có cần áp lại.
5. `danh_muc_phien_ban` khác `phien_ban` bot vừa gửi ⇒ CRM chưa có danh mục mới nhất — gửi lại danh mục.

## 5. Quản trị (owner/admin, JWT): `/api/v1/bot-quyen/cho-khach/*`

| route | thân / tham số | trả |
|---|---|---|
| `GET /tai-lieu` | — | `{danhMuc: {phienBan, luc} \| null, taiLieu: [{id, tieuDe, loai, nguon, soDoan, capNhatLuc, mauNoiDung, noiDungBam, trangThai, noiDungBamDaDuyet, choKhach, duyetBoi, duyetLuc}], duyetNgoaiDanhMuc: string[]}` — `choKhach` ⇔ `trangThai = 'da_duyet'` |
| `POST /tai-lieu/duyet` | `{taiLieu: [{id, noiDungBam}] (1..500), lyDo?}` | `{doi}` — `noiDungBam` = băm người duyệt ĐANG NHÌN; id phải có trong danh mục (khác ⇒ `409 KHONG_CO_TRONG_DANH_MUC`, cả lô); băm khác danh mục hiện tại / tài liệu rỗng (băm `null`) ⇒ `409 TAI_LIEU_DA_DOI` cả lô; chưa có danh mục ⇒ `409 CHUA_CO_DANH_MUC`; đã duyệt đúng băm ⇒ bỏ qua; duyệt lại sau khi đổi ⇒ ghi băm mới |
| `POST /tai-lieu/bo-duyet` | `{ids: string[1..500], lyDo?}` | `{doi}` — luôn được (kể cả id đã rời danh mục) |
| `GET /mo-ta` | `?loc=co_mo_ta` (mặc định) `\| da_duyet \| doi_sau_duyet \| tat_ca` | `{danhMuc, sanPham: [{productId, ma, ten, moTaBan, moTaBam, trangThai, moTaBamDaDuyet, duyetBoi, duyetLuc}], dem: {coMoTa, daDuyet, doiSauDuyet, chuaDuyet, tong}}` |
| `POST /mo-ta/duyet` | `{sanPham: [{productId, moTaBam}] (1..500), lyDo?}` | `{doi}` — `moTaBam` = băm người duyệt ĐANG NHÌN; khác băm trong danh mục hiện tại / SP không có mô tả ⇒ `409 MO_TA_DA_DOI` cả lô. Duyệt lại sau khi đổi ⇒ ghi băm mới |
| `POST /mo-ta/bo-duyet` | `{productIds: number[1..500], lyDo?}` | `{doi}` — luôn được |

`trangThai` mô tả: `khong_mo_ta` · `chua_duyet` · `da_duyet` (băm đã duyệt = băm hiện tại) · `doi_sau_duyet` (khác, kể cả mô tả
bị xoá sau khi duyệt). `trangThai` tài liệu: `khong_noi_dung` (băm `null`, không duyệt được) · `chua_duyet` · `da_duyet` ·
`doi_sau_duyet` (nội dung khác lúc duyệt, kể cả thành rỗng — giao diện: chip "Tài liệu đã đổi — cần duyệt lại" + bộ lọc
"Tài liệu đổi sau duyệt", nút "Duyệt lại"). Lỗi: `{error: <câu tiếng Việt>, code}`; NV thường ⇒ `403 CHI_ADMIN`.

Nhật ký: MỖI mục đổi một dòng `bot_quyen_nhat_ky` trong cùng giao dịch — `tai_lieu_cho_khach` (`doi_tuong_id` = id tài liệu,
trước/sau `{tieuDe, choKhach, noiDungBam?}` — duyệt lại sau khi đổi: trước/sau mang hai băm), `mo_ta_duyet` (`doi_tuong_id` = product_id, trước/sau `{ten, moTaBam}`, sau `null` = bỏ duyệt).

## 6. Dữ liệu (migration `20261002110000_bot_cho_khach`, chỉ thêm bảng + nới CHECK nhật ký)

- `bot_cho_khach_danh_muc` (org duy nhất): `phien_ban`, `tai_lieu` jsonb, `san_pham` jsonb, `luc`.
- `bot_tai_lieu_cho_khach` (org, tai_lieu_id) duy nhất: `noi_dung_bam` (CHECK `^[0-9a-f]{64}$`), `duyet_boi`, `luc`.
- `bot_mo_ta_duyet` (org, product_id) duy nhất: `mo_ta_bam` (CHECK `^[0-9a-f]{64}$`), `duyet_boi`, `luc`.
- `bot_quyen_nhat_ky.doi_tuong` nhận thêm `tai_lieu_cho_khach | mo_ta_duyet | danh_muc_cho_khach`.

## 7. Còn hở (biết trước)

- ~~Duyệt tài liệu gắn id, không gắn nội dung~~ — **đã đóng 02/10**: duyệt gắn `noi_dung_bam` (§3b, §4 luật 2). Còn lại: CRM
  không kiểm được bot tính băm đúng (không có nội dung đầy đủ) — tính sai chỉ làm tài liệu không dùng được, không làm lộ.
- Cờ "Có vẻ tài liệu nội bộ" trên giao diện chỉ là NHẮC (chữ "bảng giá", "chiết khấu", "nội bộ", số tiền trong mẫu…) — không chặn. Bộ
  kiểm câu trả lời của bot (không giá/tiền/SĐT, số phải có trong đoạn nguồn) vẫn là lưới cuối.
