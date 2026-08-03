# Research: giải pháp thay thế Pathway

> Ngày: 2026-08-02 · Yêu cầu: "còn repo nào làm được tương tự nhưng ngon hơn không"
> Phương pháp: khảo sát + **đo thật trên 7 tài liệu của anh** + kiểm hạ tầng sẵn có.

## Kết luận: đừng thay Pathway bằng framework khác — bỏ luôn framework

Phép thử hôm qua cho thấy thứ giết Pathway **không phải RAG**, mà là **Docling**
(bộ parse PDF của nó) ngốn hết 7,7GB RAM rồi im lặng mất tài liệu.

Đo lại chính 7 file đó bằng PyMuPDF:

| | Docling (trong Pathway) | **PyMuPDF** |
|---|---|---|
| 7 file, 72MB | **8–15 phút** | **1,17 giây** |
| File 18MB | **CHẾT** (`OOMKilled`, exit 137) | 0,04s |
| Trích được `Warranty 2Y`, `IP65` | ❌ mất trắng | ✅ đủ |
| RAM | >7,7GB | không đáng kể |
| Model ML | có (1–2GB tải về) | **không** |

**Nhanh hơn ~500 lần, và không chết.**

Khi bước tốn kém nhất chỉ mất hơn một giây, cả lý do tồn tại của một service
Python riêng biến mất.

---

## A. Đã khảo sát những gì

| Ứng viên | Kết luận | Vì sao |
|---|---|---|
| [RAGFlow](https://github.com/infiniflow/ragflow) | ❌ Loại | Đòi **16GB RAM, 50GB đĩa** — nặng hơn Pathway đã làm chết máy (7,7GB). Cần thêm Elasticsearch. |
| [Dify](https://github.com/langgenius/dify) | ❌ Quá tầm | Nền tảng LLM đầy đủ (visual builder, model routing). Ta chỉ cần tra tài liệu — mua cả nhà máy để đóng một cái ghế. |
| LangChain / LlamaIndex | ❌ Sai ngôn ngữ | Python. Hệ ta TypeScript. Thêm ngôn ngữ thứ hai vào production để làm một việc nhỏ. |
| AnythingLLM | ❌ Trùng chức năng | Là **ứng dụng chat** riêng, có UI riêng. Ta đã có Zalo CRM. |
| **PyMuPDF4LLM / PyMuPDF** | ✅ **Dùng** | Không model ML, không GPU. AGPL — **cùng giấy phép dự án**. |
| **pgvector + pg_trgm** | ✅ **Dùng** | Không service mới. Postgres đã có sẵn. |

### Lỗi OOM của Docling là bug đã biết, không phải tại tôi cấu hình sai

Ba issue mở trên GitHub Docling:
- [#3345 — OOM with Large PDF](https://github.com/docling-project/docling/issues/3345)
- [#2829 — High memory usage, memory not released](https://github.com/docling-project/docling/issues/2829)
- [#2786 — 3x memory consumption between versions](https://github.com/docling-project/docling/issues/2786)

Có người báo Python process ngốn tới **12GB**. Cách vá thường dùng là cắt PDF
thành từng 20 trang bằng `qpdf` trước khi parse — tức là phải dựng thêm một
bước tiền xử lý chỉ để giữ cho nó khỏi chết.

---

## B. Một điều tôi nói SAI hôm qua, sửa lại

Hôm qua tôi viết: *"File 18MB là mỏ vàng — datasheet L7-Series tiếng Anh đầy đủ."*

Kiểm kỹ hôm nay:

```
Pages: 1        (không phải nhiều trang)
Text:  684 ký tự
Ảnh:   2 ảnh lớn  ← 18MB nằm ở đây
```

File chỉ có **1 trang**. Phần lớn 18MB là **hai ảnh**. Chữ chỉ 684 ký tự —
nhưng may là đúng phần quan trọng nhất:

```
L7-Series · IP65 · 420*13*0.73mm · AC185-265V · 6W/Pcs
720-780 lm · Beam Angle 175° · Warranty 2Y
```

Nên nhận định "mỏ vàng" **vẫn đúng về nội dung**, nhưng sai về quy mô. Và điều
này giải thích luôn vì sao Docling chết: nó cố phân tích bố cục **hai ảnh lớn**
bằng model ML, trong khi chữ đã nằm sẵn dưới dạng text.

**Bài học:** trước khi chọn công cụ nặng, kiểm xem tài liệu có thật sự cần nó
không. Ở đây câu trả lời là **không** — mọi PDF đều có text lớp sẵn.

---

## C. Hạ tầng sẵn có — kiểm thật

```
Postgres (incokit_db_prod, PG15):
  ✅ unaccent   — đã cài
  ✅ pg_trgm    — đã cài
  ❌ vector     — CHƯA có
```

Thử `unaccent` với tiếng Việt:

```sql
SELECT unaccent('Đèn LED ngoài trời bảo hành 2 năm');
→ Den LED ngoai troi bao hanh 2 nam

SELECT similarity(unaccent('bao hanh'), unaccent('bảo hành'));
→ 1   (khớp tuyệt đối)
```

Nhân viên gõ không dấu vẫn tìm ra. Đây đúng thứ `tra_san_pham` đang tự làm bằng
hàm `boDau()` trong TypeScript — Postgres làm sẵn, nhanh hơn.

⚠️ Postgres của ZaloCRM (cổng 5433) **đang tắt** — đó cũng là lý do 5 suite
`tests/security/` fail suốt. Không liên quan việc này nhưng cần bật lại.

---

## D. Ba phương án, xếp theo chi phí

### D1. Full-text Postgres (KHUYẾN NGHỊ — làm trước)

```
PyMuPDF (Node gọi qua CLI) → text → bảng tri_thuc → pg_trgm + unaccent
```

| | |
|---|---|
| Service mới | **0** |
| Ngôn ngữ mới | **0** (PyMuPDF gọi qua CLI, hoặc `mupdf` binding Node) |
| Đĩa | vài MB |
| Parse 7 file | **1,17 giây** |
| Tra cứu | vài ms |
| Tiền | **0đ** |

Đủ tốt khi tài liệu vài trăm trang và câu hỏi dùng đúng từ khoá ("bảo hành",
"IP65", "công suất"). Với datasheet kỹ thuật thì phần lớn câu hỏi đúng dạng này.

**Hạn chế thật:** không hiểu câu hỏi diễn đạt khác từ trong tài liệu. Hỏi "đèn
này chống nước không" mà tài liệu ghi "IP65" thì không khớp.

### D2. Thêm pgvector khi D1 không đủ

Cài `vector` vào Postgres sẵn có, embedding chạy local (đã đo hôm qua:
**44ms/đoạn**, model 1,0GB).

Nghiên cứu cho thấy hybrid **pg_trgm + pgvector + RRF đạt ~84%** so với 62% khi
chỉ dùng vector — nên D1 không phải bước phí, nó là **một nửa** của D2.

Vẫn **0 service mới**, chỉ thêm một extension.

### D3. Pathway — chỉ khi cần đồng bộ thời gian thực từ Drive/SharePoint

Điểm mạnh thật của Pathway là **live sync** (kiểm chứng hôm qua: xoá file →
index tự cập nhật trong ~1 phút). Nếu tài liệu nằm trên Google Drive và nhân
viên sửa liên tục thì đáng cân nhắc.

Tài liệu hiện tại là **7 file tĩnh** — vài tháng mới đổi. Không cần.

---

## E. Đề nghị

**Làm D1.** Cụ thể:

1. Script Node gọi PyMuPDF trích text 7 file → `tri_thuc` (Postgres)
2. Index `pg_trgm` trên cột đã `unaccent`
3. Tool thứ 13 `tra_tri_thuc` — tra Postgres, không service ngoài
4. Đo trên ~30 câu thật. Dưới 70% đúng thì lên D2.

Ước lượng **1 ngày**, không thêm service, không thêm ngôn ngữ, 0đ vận hành.

### Ranh giới giữ nguyên (như đã chốt cho Pathway)

```
Câu về TIỀN/TỒN (giá, còn hàng, công nợ) → LUÔN tool Odoo
Câu về CHỮ (bảo hành, IP, công suất)      → tra_tri_thuc
```

Chặn ở tầng code, không chỉ prompt. Và **không index file giá đại lý**
(`agent price and weight.xlsx` — `Agent price`/`VIP price` cho 120 model).

---

## F. Bảng tổng kết

| Tiêu chí | Pathway | RAGFlow | Dify | **D1 (PyMuPDF+PG)** |
|---|---|---|---|---|
| Service mới | 1 (Python) | 2+ (Py+ES) | 3+ | **0** |
| RAM | 4,6GB | ≥16GB | ~8GB | **~0** |
| Đĩa | 17,8GB image | ≥50GB | ~10GB | **vài MB** |
| Parse 7 file | 8–15 phút | ? | ? | **1,17s** |
| File 18MB | **chết OOM** | ? | ? | **0,04s** |
| Giấy phép | BSL (khác AGPL) | Apache 2.0 | Apache 2.0 | **AGPL (khớp)** |
| Tiền vận hành | 0đ (local) | 0đ | 0đ | **0đ** |
| Live sync | ✅ | ✅ | ✅ | ❌ (không cần) |

Cột cuối thắng ở mọi tiêu chí trừ live sync — thứ ta không cần với 7 file tĩnh.
