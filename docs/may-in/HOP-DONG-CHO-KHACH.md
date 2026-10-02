# Hợp đồng "Cho khách": bot → CRM → bot (docs/79 T5, 02/10; sửa 02/10 tối — tài liệu = KHO TRI THỨC CRM)

Đường khách của bot (docs/79 T3/T4) chỉ được dùng **tài liệu kho tri thức (RAG) đã đánh dấu "khách xem được"** và **mô tả bán
hàng (`description_sale`) đã duyệt**. Người giữ trang duyệt ở tab **"Cho khách"** của trang Quyền bot (CRM).

**Sửa 02/10 tối (chủ):** thông số kỹ thuật nằm ở **kho tri thức CỦA CRM** (`knowledge_documents` / `knowledge_chunks`), không
phải `kb_documents` của bot (trống trên dev). Từ đây: CRM tự liệt kê tài liệu, tự tính băm §3b từ `knowledge_chunks`, giữ duyệt,
và **CRM phục vụ tìm kiếm** (§8): bot gọi `POST /api/public/cho-khach/tim` (khách — chỉ tài liệu đã duyệt) hoặc
`POST /api/public/tai-lieu-ky-thuat/tim` (nhân viên — cả kho). Bot **không** đẩy tài liệu trong danh mục nữa (`tai_lieu: []`), không
đọc `kb_chunks` cho câu thông số. Hợp đồng gồm ba bên:

| bên | việc | mã |
|---|---|---|
| bot | đẩy danh mục **SP** (`POST /api/public/cho-khach/danh-muc`), đọc duyệt mô tả (`GET /api/public/cho-khach/duyet`), **so băm trước khi dùng mô tả**, gọi tìm (§8) + kiểm neo định danh SP + bộ kiểm câu trả lời | repo bot (T4) |
| CRM | kiểm danh mục SP, liệt kê + băm tài liệu kho tri thức, lưu duyệt + nhật ký, **tìm** (lọc duyệt + băm, xếp hạng hybrid như agent CRM, bỏ dòng bẩn) | `backend/src/modules/bot-quyen/bot-cho-khach-*.ts` |
| giao diện | tab "Cho khách" (`/api/v1/bot-quyen/cho-khach/*`, owner/admin) — có "Xem toàn văn" | `frontend/src/components/bot-quyen/BotQuyenChoKhachTab.vue` |

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
  "tai_lieu": [                      // TUỲ CHỌN từ 02/10 tối (vắng = []), 0–5000, id duy nhất. Bot mới gửi [] — tài liệu là kho
                                     // tri thức CRM; CRM vẫn kiểm hình + lưu cho bot cũ nhưng KHÔNG đường nào dùng nữa
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
- **Mọi giới hạn độ dài đếm theo CODE POINT** (= `len()` của Python; emoji ngoài BMP = 1) — `phien_ban`, `tieu_de`, `ten`,
  `ma`, `loai`, `nguon`, `mo_ta_ban`, và cắt `mau_noi_dung`. (Sửa 02/10: trước đó CRM đếm đơn vị UTF-16 ⇒ chuỗi đúng trần có
  emoji bị `400` oan.)
- **`phien_ban` trùng bản CRM đang giữ ⇒ CRM KHÔNG ghi lại** (vẫn kiểm hình, vẫn `200` cùng thân trả lời; `luc` không đổi, không
  nhật ký) — tránh viết lại tới 8 MB mỗi lần đẩy lại. Bot **PHẢI** đổi `phien_ban` mỗi khi nội dung đổi (vd sha256 nội dung).
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

Từ 02/10 tối **CRM tự tính** trên `knowledge_chunks.content` của tài liệu (`ord` tăng dần, trùng `ord` ⇒ phá hoà theo `id`) —
`bot-cho-khach-kho.ts:bamTuDoan`. Đoạn rỗng giữa chừng không đổi băm (dòng rỗng bị bỏ), đổi THỨ TỰ đoạn thì đổi băm.

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
  "tai_lieu_cho_khach": [{ "id": "cmt72…", "noi_dung_bam": "954417e5…" }],
                                            // tài liệu đã duyệt mà băm §3b HIỆN TẠI trong kho tri thức CRM == băm lúc duyệt;
                                            // kèm băm LÚC DUYỆT; sắp theo id. THÔNG TIN — bot không cần (POST …/tim đã lọc)
  "mo_ta_da_duyet": [{ "product_id": 1234, "mo_ta_bam": "cff3e472…" }]  // mọi duyệt kèm băm LÚC DUYỆT, sắp theo product_id
}
```

Luật bot (bắt buộc — CRM không thay được):

1. **Mặc định đóng.** Chưa đọc được lần nào / lỗi mạng ⇒ coi như rỗng (không mô tả); có bản cũ thì giữ bản cũ đọc được gần nhất.
2. **Tài liệu: CRM lọc.** Từ 02/10 tối bot KHÔNG tự lọc tài liệu: đoạn cho khách CHỈ lấy qua `POST /api/public/cho-khach/tim` (§8),
   CRM chỉ trả đoạn của tài liệu đã duyệt mà băm hiện tại == băm duyệt (băm tính trên chính các hàng nó xếp hạng). Kho nạp lại
   tài liệu với nội dung khác ⇒ mất duyệt ngay (chip "Tài liệu đã đổi — cần duyệt lại").
3. **Mô tả gắn băm.** Chỉ dùng `description_sale` của SP khi `bam(description_sale hiện tại) == mo_ta_bam` đã duyệt của SP
   đó. Khác ⇒ coi như chưa duyệt (K2): NV sửa mô tả qua bot / trên Odoo là mất duyệt ngay, không đợi CRM.
4. Poll như `/api/public/bot-quyen` (~60 s); so `phien_ban` để biết có cần áp lại.
5. `danh_muc_phien_ban` khác `phien_ban` bot vừa gửi ⇒ CRM chưa có danh mục mới nhất — gửi lại danh mục.

## 5. Quản trị (owner/admin, JWT): `/api/v1/bot-quyen/cho-khach/*`

| route | thân / tham số | trả |
|---|---|---|
| `GET /tai-lieu` | — | `{kho: {soTaiLieu, luc}, taiLieu: [{id, tieuDe, loai (null), nguon (= knowledge_documents.source), soDoan, capNhatLuc, mauNoiDung (300 code point đầu), noiDungBam (§3b CRM tính), trangThai, noiDungBamDaDuyet, choKhach, dauHieuNoiBo: string[], duyetBoi, duyetLuc}], duyetNgoaiDanhMuc: string[]}` — tài liệu = kho tri thức CRM sắp theo tiêu đề; `dauHieuNoiBo` xét TOÀN VĂN (chữ "bảng giá/báo giá/chiết khấu/nội bộ/tồn kho…", số dòng có giá/SĐT/link/tồn — chỉ NHẮC); `duyetNgoaiDanhMuc` = đã duyệt nhưng tài liệu không còn trong kho; `choKhach` ⇔ `trangThai = 'da_duyet'` |
| `GET /tai-lieu/:id/toan-van` | — | `{id, tieuDe, nguon, noiDungBam, doan: string[], dauHieuNoiBo}` — toàn văn (đoạn theo `ord`) cho người duyệt; không có ⇒ `404 KHONG_CO_TAI_LIEU` |
| `POST /tai-lieu/duyet` | `{taiLieu: [{id, noiDungBam}] (1..500), lyDo?}` | `{doi}` — `noiDungBam` = băm người duyệt ĐANG NHÌN; id phải có trong kho (khác ⇒ `409 KHONG_CO_TRONG_DANH_MUC`, cả lô); băm khác kho hiện tại / tài liệu rỗng (băm `null`) ⇒ `409 TAI_LIEU_DA_DOI` cả lô; đã duyệt đúng băm ⇒ bỏ qua; duyệt lại sau khi đổi ⇒ ghi băm mới |
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

## 6. Dữ liệu (migration `20261002110000_bot_cho_khach`, chỉ thêm bảng + nới CHECK nhật ký; sửa 02/10 tối KHÔNG cần migration mới)

- `bot_cho_khach_danh_muc` (org duy nhất): `phien_ban`, `tai_lieu` jsonb (từ 02/10 tối: `[]`, không dùng), `san_pham` jsonb, `luc`.
- `bot_tai_lieu_cho_khach` (org, tai_lieu_id) duy nhất: `tai_lieu_id` = **`knowledge_documents.id` của CRM** (cuid — trước 02/10
  tối là `kb_documents.id` uuid của bot: dòng cũ như vậy không khớp tài liệu nào ⇒ không bao giờ dùng, hiện ở
  `duyetNgoaiDanhMuc` để bỏ duyệt), `noi_dung_bam` (CHECK `^[0-9a-f]{64}$`), `duyet_boi`, `luc`.
- `bot_mo_ta_duyet` (org, product_id) duy nhất: `mo_ta_bam` (CHECK `^[0-9a-f]{64}$`), `duyet_boi`, `luc`.
- `bot_quyen_nhat_ky.doi_tuong` nhận thêm `tai_lieu_cho_khach | mo_ta_duyet | danh_muc_cho_khach`.

## 7. Còn hở (biết trước)

- ~~Duyệt tài liệu gắn id, không gắn nội dung~~ — **đã đóng 02/10**: duyệt gắn `noi_dung_bam` (§3b). Từ 02/10 tối CRM tự tính
  băm từ kho của nó (không còn phụ thuộc bot tính đúng).
- Cờ "Có vẻ tài liệu nội bộ" chỉ là NHẮC — không chặn; nay xét TOÀN VĂN (bảng giá ở trang cuối vẫn thấy) + nút "Xem toàn văn".
  Dòng có giá/SĐT/link/tồn bị bỏ khi trả bot dù tài liệu đã duyệt; bộ kiểm câu trả lời của bot vẫn là lưới cuối.
- Đồng bộ kho tri thức CRM xoá + tạo lại tài liệu (id mới) ⇒ mất duyệt (fail-closed) — phải duyệt lại.
- Tìm khi embedding chết (thiếu `EMBED_BASE_URL`/nhà cung cấp lỗi) ⇒ chỉ nhánh từ khoá (như agent CRM).
- Giao diện "Chọn hết" > 500 mục: gửi lần lượt từng lô ≤ 500 (route giữ trần 500), báo tiến độ; lô lỗi (vd 409) không chặn lô
  sau, hộp báo lô nào lỗi + giữ chọn đúng các mục chưa lưu. Mỗi lô vẫn "cả lô hoặc không".

## 8. Bot → CRM: tìm đoạn thông số (sửa 02/10 tối)

| route | ai dùng | lọc |
|---|---|---|
| `POST /api/public/cho-khach/tim` | đường KHÁCH của bot | CHỈ tài liệu có dòng duyệt mà băm §3b HIỆN TẠI (tính trên chính các hàng đọc để xếp hạng) == băm lúc duyệt |
| `POST /api/public/tai-lieu-ky-thuat/tim` | đường NHÂN VIÊN (tool `tra_tri_thuc`) | mọi tài liệu của org |

Khoá như §1 (org đã đặt khoá riêng ⇒ chỉ khoá riêng). Thân ≤ 16 KB:

```jsonc
{
  "truy_van": "thông số P3.076 out ốp lưng 3840HZ",   // bắt buộc, 1–500 code point (cắt khoảng trắng hai đầu)
  "so_doan": 5,                                       // tuỳ chọn, nguyên 1–5 (mặc định 3)
  "san_pham": {                                       // tuỳ chọn | null
    "ten": "Module LLR P3.076 outdoor",               // ≤ 500 | null — ghép vào câu tìm
    "ma": "P3076-OUT",                                // ≤ 128 | null — đoạn chứa mã (bỏ dấu/gạch) được xếp lên đầu
    "neo": [["p3"], ["076"]]                          // tuỳ chọn, ≤ 8 nhóm × 1–6 chuỗi [0-9a-z]{1,40}: đoạn (kèm TIÊU ĐỀ tài liệu)
  }                                                   //   phải có ≥ 1 lựa chọn của MỖI nhóm trong tập token — lọc TRƯỚC khi xếp hạng
}
```

Token (cả CRM lẫn bot): bỏ dấu + chữ thường, chuỗi `[0-9a-z]+`, thêm ghép 2–3 token liền nhau ("BX-V7512" ⇒ `bxv7512`). Xếp hạng
= `xepHangDoan` (hybrid vector + từ khoá y như agent CRM — `searchKnowledge`) trên MỌI ứng viên, rồi ưu tiên đoạn chứa nhiều token
phân biệt (có chữ số) của câu tìm. Mỗi đoạn trả bị bỏ DÒNG có giá/tiền, SĐT, đường dẫn/email, số tồn, liên hệ mua bán (đoạn rỗng sau
khi bỏ ⇒ không trả); bỏ đoạn trùng.

`200 {ket_qua: [{tai_lieu_id, tieu_de, noi_dung, diem}]}` (≤ `so_doan`). Sai thân ⇒ `400 YEU_CAU_TIM_KHONG_HOP_LE`. CRM KHÔNG log
`truy_van`. Bot: lỗi ⇒ "kho tài liệu đang lỗi", KHÔNG rơi về Odoo/nguồn khác; luôn kiểm LẠI neo định danh SP + bộ kiểm câu trả lời.
