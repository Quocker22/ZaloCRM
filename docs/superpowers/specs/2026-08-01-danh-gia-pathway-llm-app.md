# Đánh giá Pathway llm-app cho hệ LEDNELIA

> Ngày: 2026-08-01 · Nguồn: https://github.com/pathwaycom/llm-app
> Phương pháp: **clone repo về đọc code** (88MB, 18 file .py, 10 template),
> đối chiếu trang giấy phép, và so với 12 tool + hạ tầng đang chạy.
>
> Bản đầu tôi viết chỉ dựa trên README. Sau khi pull về đọc code thì phát hiện
> **3 điều README không nói** — xem §A2. Chúng không đổi kết luận, nhưng đổi
> hẳn mức độ chắc chắn.

## Kết luận ngắn (sau khi CHẠY THẬT với tài liệu của anh)

**Nó chạy được, và trả lời đúng.** Đo thật: 4-6 giây mỗi câu, không bịa số,
đọc được cả tài liệu tiếng Trung rồi trả lời tiếng Việt.

**Nhưng KHÔNG dùng cho giá/tồn/công nợ.** Hệ ta đọc thẳng Odoo qua tool —
luôn tươi tuyệt đối. Pathway chỉ hợp cho **tri thức dạng văn bản**: bảo hành,
thông số kỹ thuật, cách lắp đặt. Đó đúng là mảng bot đang thiếu.

| Câu hỏi | Dùng gì |
|---|---|
| "P10 giá bao nhiêu", "còn hàng không", "công nợ" | **Tool Odoo** (60-500ms) |
| "bảo hành mấy năm", "IP mấy", "công suất bao nhiêu" | **RAG** (4-6s) |

Đề nghị: **làm được, nhưng chưa phải bây giờ.** Còn 2 việc phải xong trước —
xem §D. Và có 3 việc khác đáng làm hơn — xem §E.

---

## A. Pathway là gì

| | |
|---|---|
| Ngôn ngữ | Python (lõi Rust) |
| Triển khai | Docker service riêng |
| Vector DB | Không cần — index trong bộ nhớ (usearch + Tantivy) |
| Nguồn dữ liệu | Google Drive, SharePoint, S3, Kafka, PostgreSQL, API |
| Giải quyết | RAG **thời gian thực**: tài liệu đổi → index tự cập nhật |

Điểm mạnh thật: hầu hết hệ RAG phải chạy job index lại định kỳ, giữa hai lần
chạy thì trả lời theo dữ liệu cũ. Pathway đồng bộ liên tục.

## A2. Ba điều README KHÔNG nói (chỉ thấy khi đọc code)

### 1. Giấy phép BSL, không phải MIT — và dự án anh là AGPL-3.0

`llm-app/pyproject.toml` ghi `license = "MIT"`. Nhưng đó là license của **bộ
template**. Thư viện lõi `pathway` mà mọi template `import` dùng **Business
Source License**, chỉ chuyển sang Apache 2.0 sau 4 năm.

BSL cho dùng production miễn phí, **trừ** bên cung cấp "Stream Data Processing
Services" (bán lại hạ tầng). LEDNELIA bán đèn LED nên không rơi vào diện cấm.

Nhưng dự án của anh là **AGPL-3.0** (`LICENSE` ở gốc repo, mọi file đều có
`SPDX-License-Identifier: AGPL-3.0-or-later`). Trộn AGPL với BSL trong cùng một
sản phẩm là chuyện cần người hiểu luật xem, không phải chuyện kỹ thuật. Nếu
Pathway chạy như **service riêng qua HTTP** (đúng cách nó được thiết kế) thì
ranh giới rõ hơn nhiều so với nhúng thư viện.

### 2. Telemetry BẬT SẴN trong mọi template

Cả 10 template đều có dòng này, không phải tuỳ chọn:

```python
pw.set_license_key("demo-license-key-with-telemetry")
```

Trang giấy phép xác nhận: dùng license key nghĩa là **đồng ý gửi dữ liệu sử
dụng ẩn danh về Pathway** qua OpenTelemetry collector.

Comment trong code có nói cách tắt (*"To use Community, comment out the line
below"*), nhưng **README không hề nhắc** — ai làm theo hướng dẫn sẽ bật
telemetry mà không biết. Với hệ chạm vào dữ liệu khách hàng và công nợ, đây là
điều phải quyết định có ý thức.

### 3. Đây là BỘ TEMPLATE, không phải thư viện

`pyproject.toml` ghi `package-mode = false`. Repo 88MB nhưng chỉ **18 file
Python** — phần lớn là ảnh minh hoạ và tài liệu. Mỗi template là một
`app.py` + `Dockerfile` + `docker-compose.yml` để copy về sửa.

Nghĩa là: `git pull` không cập nhật được. Copy về sửa xong thì bản của mình là
một nhánh riêng, Pathway sửa lỗi thì phải tự merge tay.

Sức nặng thật nằm ở gói `pathway[all]` trên PyPI, không ở repo này.

---

## B. Vì sao KHÔNG hợp với phần đang chạy

### B1. Ta không có vấn đề "dữ liệu cũ"

Pathway giải bài toán: *tài liệu đổi mà index chưa cập nhật → bot trả lời sai.*

Hệ ta **không có index**. `tra_san_pham` gọi XML-RPC vào Odoo ngay lúc hỏi. Giá
đổi lúc 10h00, bot hỏi lúc 10h01 → thấy giá mới. Độ tươi không thể tốt hơn.

Đây chính là lý do dự án **bỏ KB/RAG** từ đầu: bug thật đã xảy ra khi giá parse
bằng regex từ text chunk trong KB — KB là ảnh chụp một thời điểm, giá đổi thì
KB sai và bot báo giảm 50% cho khách.

Thêm Pathway vào chỗ này là **quay lại đúng lớp bug đã trả giá để thoát ra**.

### B2. Chi phí tích hợp cao, lợi ích chồng chéo

| | Hiện tại | Nếu thêm Pathway |
|---|---|---|
| Service | Node + Odoo | Node + Odoo + **Python** |
| Nguồn sự thật | Odoo | Odoo + **index Pathway** |
| Khi lệch nhau | không thể lệch | phải điều tra bên nào đúng |

Điều thứ ba là nặng nhất. Cả kiến trúc hiện tại được dựng quanh **một nguồn sự
thật**: `_build_low_stock_html()` phải gọi lại `get_low_stock_data()`; tool báo
cáo cấm tự tính tổng. Thêm một index song song là mở lại cánh cửa đó.

### B3. Ta không có tài liệu để index

Pathway mạnh nhất với PDF, slide, hợp đồng. Dữ liệu LEDNELIA là **bảng có cấu
trúc** trong Postgres của Odoo: sản phẩm, khách, đơn, hoá đơn. SQL và XML-RPC
đọc thứ này chính xác hơn tìm kiếm ngữ nghĩa.

Hỏi "Nguồn ATX 12V400W giá bao nhiêu" — SQL trả **đúng một** con số. RAG trả
đoạn văn gần đúng nhất, rồi model đọc số từ đó. Với **tiền**, khác biệt này
không chấp nhận được.

---

## C. Một mảng Pathway HỢP — và ta đang thiếu thật

Bot hiện **không biết gì** ngoài dữ liệu Odoo. Nó không trả lời được:

- "đèn này bảo hành mấy tháng?"
- "chính sách đổi trả thế nào?"
- "công suất P10 bao nhiêu W, chạy nguồn mấy A?"
- "lắp led dây ngoài trời cần lưu ý gì?"

Đây là **tri thức sản phẩm và chính sách** — nằm trong tài liệu, catalogue,
datasheet nhà cung cấp, không nằm trong bảng nào của Odoo. Hiện bot gặp câu này
là `chuyen_sale`.

Đó đúng là chỗ RAG hợp: nội dung dạng văn bản, câu hỏi mở, không cần con số
chính xác tuyệt đối.

**Nhưng cần Pathway để làm việc đó không?** Chưa chắc:

| Cách | Chi phí | Phù hợp khi |
|---|---|---|
| Nhét thẳng vào prompt | ~0 | Chính sách ngắn (dưới 2.000 từ) |
| Bảng `tri_thuc` + full-text Postgres | thấp, dùng hạ tầng sẵn | Vài trăm mục hỏi-đáp |
| **Pathway** | thêm 1 service Python | Hàng nghìn trang PDF, đổi liên tục |

Hiện chưa có tài liệu nào được số hoá, nên **chưa biết mình ở cột nào**. Chọn
công cụ trước khi biết khối lượng dữ liệu là làm ngược.

---

## C1. CHẠY THẬT — phát hiện từ tài liệu thật của anh

> Anh nói đúng: "không thử thực tế thì sao đánh giá được". Mục này ghi những gì
> **chỉ lộ ra khi dựng thật** với `~/Downloads/data-led` (8 file, 72MB).

### Tài liệu anh đưa — khảo sát trước khi index

| File | Trang | Ký tự text | Ghi chú |
|---|---|---|---|
| Catalog Nelia.pdf | 16 | 12.184 | Catalog chính, có thông số 12V/24V/100W/220V |
| E Catalog ONBON.pdf | 8 | 23.109 | Card điều khiển, có mục bảo hành |
| 永杰霖电源产品图册 | — | — | Datasheet nguồn, **tiếng Trung** |
| 漫反射NV ×2, 低压漫反射参数 | 1 | ~1.000 | Thông số tán quang, tiếng Trung |
| 909f6b58…pdf | — | 18MB | Chưa rõ nội dung |
| **agent price and weight.xlsx** | — | 120 model | ⚠️ **GIÁ ĐẠI LÝ** — xem dưới |

Tin tốt: **mọi PDF đều trích được chữ**, không phải ảnh scan. Đây là điều kiện
tiên quyết — catalog LED rất hay là ảnh, và ảnh thì phải OCR (đắt hơn nhiều).

**File 18MB (909f6b58…) là mỏ vàng.** Datasheet L7-Series, tiếng Anh đầy đủ:

```
Size 420*13*0.73mm · AC185-265V · 6W/Pcs · 720-780 lm
Beam Angle 175° · Warranty 2Y · IP Rating IP65
```

Đây **chính xác** là loại tri thức bot đang thiếu — bảo hành, IP, công suất,
quang thông, góc chiếu. Hiện những câu này đều rơi vào `chuyen_sale`.

**Hai tài liệu Trung Quốc có phần song ngữ.** `永杰霖电源产品图册` (datasheet
nguồn) có mục ABOUT US tiếng Anh, chứng chỉ ROHS/GS/UL. Nhưng phần lớn nội dung
vẫn tiếng Trung — cần kiểm bot trả lời khách Việt bằng tiếng gì.

### ⚠️ Phát hiện quan trọng nhất: file Excel là GIÁ VỐN

`agent price and weight-1_1.xlsx` chứa các cột:

```
Agent Price For BX LED Controllers · VIP price · Project price
Agent price for Accessory&sensors · Retail Price
```

**120 model** kèm giá đại lý mua vào. Đây đúng là thứ toàn hệ đang chặn:
`tra_san_pham` dùng danh sách trắng field để không bao giờ đọc `standard_price`;
`bao_cao_ban_hang` xoá cột `cost` trước khi đưa cho LLM.

Index file này vào RAG là **mở cửa sau cho chính dữ liệu đó** — và cửa sau này
không có danh sách trắng nào canh, vì RAG trả về đoạn văn thô.

**Đã tách ra `khong-index/`, không đưa vào `data/`.**

Đây là loại rủi ro mà đọc README hay đọc code đều không thấy — chỉ lộ khi nhìn
vào dữ liệu thật sẽ được index.

### Embedding KHÔNG cần model thông minh — và nên chạy local

Anh hỏi đúng chỗ. Hai bước hoàn toàn khác nhau:

| Bước | Việc | Cần model mạnh? |
|---|---|---|
| **Embedding** | Đổi văn bản → vector để đo "gần nghĩa" | **Không** |
| **Sinh câu trả lời** | Đọc đoạn tìm được → viết trả lời | **Có** |

Embedding không suy luận, không viết chữ. Nó chỉ trả về một dãy số sao cho hai
câu cùng nghĩa thì hai dãy gần nhau. Dùng model đắt cho việc này là phí.

**Kết luận: dùng `SentenceTransformerEmbedder` chạy local.**

```yaml
$embedder: !pw.xpacks.llm.embedders.SentenceTransformerEmbedder
  model: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
  device: "cpu"
```

Chọn bản **đa ngôn ngữ** vì tài liệu của anh có ba thứ tiếng: Việt (Catalog
Nelia), Anh (datasheet L7-Series), Trung (永杰霖). Model chỉ-tiếng-Anh sẽ hỏng
với 3 file Trung Quốc.

Lợi ích so với gọi API:

| | API (OpenAI/Gemini) | Local |
|---|---|---|
| Tiền | trả theo token | **0đ** |
| Hạn ngạch | có (xem dưới) | **không** |
| Dữ liệu | gửi ra ngoài | **ở lại máy** |
| Cần mạng | có | không |
| Đánh đổi | — | **1,0GB đĩa** + RAM, chậm hơn chút |

(Đo thật: thư mục cache HuggingFace sau khi tải xong là **1,0GB**, không phải
~470MB như con số thường thấy cho model này — vì kéo theo cả tokenizer và
phụ thuộc.)

Điều cuối quan trọng với hệ này: tài liệu là catalog và datasheet nội bộ —
embedding local nghĩa là chúng **không rời khỏi máy**.

### Hạn ngạch Gemini FreeTier — chết giữa chừng

Trước khi chuyển sang local, tôi thử Google API key. Kết quả sau ~8 phút parse:

```
"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
"status": "RESOURCE_EXHAUSTED"
```

Kiểm riêng từng thứ:
- **Embedding: còn chạy**
- **Chat: 429 — hết hạn ngạch NGÀY**

Chỉ index 8 tài liệu đã đốt hết quota ngày của gói miễn phí. Nếu dùng
FreeTier cho production thì bot sẽ chết vào giữa buổi làm việc.

### Chi phí ẩn thứ hai: 9router KHÔNG có embedding

Template mặc định dùng `OpenAIEmbedder`. Kiểm thật trên 9router:

```
POST /v1/embeddings → {"error":"No credentials for provider: openai"}
GET  /v1/models     → 6 model, 0 embedding
```

Nghĩa là **không dùng lại được hạ tầng LLM hiện có**. Phải:
- đổi sang `GeminiEmbedder` + Google API key (đang thử), hoặc
- `SentenceTransformerEmbedder` chạy local (không tốn tiền nhưng nặng RAM), hoặc
- mở tài khoản OpenAI riêng chỉ để embedding

README không nói điều này vì nó giả định người dùng có OpenAI key.

### Chi phí ẩn thứ ba: Docker image 17,8GB

`docker build` cho **một** template mất **hơn 10 phút**, image nặng **17,8GB**.
Nó kéo theo lõi Rust + `pathway[all]` + Docling + model nhận dạng bảng.

Thêm nữa: image chỉ có bản `linux/amd64`. Máy Apple Silicon chạy qua giả lập
(`WARNING: platform ... does not match`), chậm hơn đáng kể.

Với server prod chạy Dokploy, 17,8GB là thứ phải tính vào dung lượng đĩa và
thời gian deploy.

### Chi phí ẩn thứ tư: parser PDF cũng đòi OpenAI

Đổi `$llm` và `$embedder` sang Gemini **vẫn chưa đủ**. Container chết ngay lúc
khởi động:

```
File "pathway/xpacks/llm/parsers.py", line 426, in __init__
  self.multimodal_llm = llms.OpenAIChat(...)
openai.OpenAIError: The api_key client option must be set...
```

`DoclingParser` có LLM **thứ ba** để đọc bảng/biểu đồ trong PDF, mặc định
`table_parsing_strategy: "llm"` → tạo `OpenAIChat` riêng.

Phải đổi thành `"docling"` (thuật toán thuần, không gọi LLM). Lưu ý: giá trị
hợp lệ **chỉ có `"docling"` hoặc `"llm"`** — tôi thử `"fast"` và nó im lặng bỏ
qua, vẫn tạo OpenAIChat.

Nghĩa là một template có **ba** điểm cần API key, không phải một. README chỉ
nói về `OPENAI_API_KEY` chung chung.

### Chi phí ẩn thứ năm: `app.yaml` bị nướng vào image

`Dockerfile` có `COPY . .` — sửa `app.yaml` trên máy **không có tác dụng** cho
tới khi build lại (10 phút). Lúc thử tôi mất một vòng vì tưởng cấu hình đã đổi.

Cách làm việc được: mount đè `-v "$PWD/app.yaml:/app/app.yaml:ro"`. Đây là điều
người vận hành cần biết, nếu không sẽ sửa cấu hình rồi tưởng nó không ăn thua.

### Chi phí ẩn thứ sáu: tên model Gemini trong tài liệu đã cũ

`models/text-embedding-004` (tên phổ biến trong tài liệu và ví dụ) trả **404**.
Hỏi thẳng API mới ra tên đúng hiện tại:

```
models/gemini-embedding-001
models/gemini-embedding-2-preview
models/gemini-embedding-2
```

### Chi phí ẩn thứ bảy: parse PDF rất chậm

Log thật: **56 giây cho MỘT tài liệu**. Với 8 file, lần khởi động đầu mất nhiều
phút mới trả lời được câu hỏi nào.

Đây là chi phí **một lần** (Pathway cache lại, tài liệu đổi mới parse lại),
nhưng nó nghĩa là: khởi động lại service = vài phút bot không trả lời được câu
hỏi tri thức. Cần tính khi deploy.

---

## C1b. KẾT QUẢ CHẠY THẬT — số đo, không phải suy đoán

Cấu hình cuối chạy được: **embedding local** + **LLM qua 9router** + **parser
docling** (không LLM).

### Tốc độ trả lời: 4-6 giây

| Câu hỏi | Thời gian | Kết quả |
|---|---|---|
| "LED NELIA là công ty gì?" | **5s** | ✅ đúng, lấy từ Catalog Nelia |
| "nguồn LED có những công suất nào" | **4s** | ✅ 100W/200W/300W kèm mã model |
| "led dây 12V thông số kỹ thuật" | **5s** | ✅ điện áp, công suất, kích thước, số led |
| "đèn LED thanh L7 bảo hành mấy năm" | 6s | ❌ *No information found* |

### Kiểm chứng: bot KHÔNG bịa

Bot trả về 4 mã sản phẩm. Dò ngược vào PDF gốc:

| Mã bot nói | Có thật trong |
|---|---|
| CQA-24V100WDF | 永杰霖电源产品图册 (**tiếng Trung**) |
| MA200SH5 | Catalog Nelia |
| ATX-5V300W | Catalog Nelia |
| D20-ATX-12V | Catalog Nelia |

**Không mã nào bịa.** Đáng chú ý: nó lấy được từ tài liệu tiếng Trung và trả
lời bằng tiếng Việt — embedding đa ngôn ngữ làm đúng việc.

### Vấn đề LỚN NHẤT: file 18MB làm container CHẾT VÌ HẾT RAM

Câu về L7-Series luôn trả "No information found". Tôi đoán sai **hai lần**:

1. *"Chunk bị cắt rời"* → sửa `chunk: true`. Vẫn hỏng.
2. *"Vượt trần 512 token"* → thêm `max_tokens: 400`. Vẫn hỏng.

Kiểm thẳng số chunk từ file đó: **0**. File có trong `list_documents` nhưng
không sinh ra chunk nào.

Parse riêng file đó trong container → tiến trình chết không một dòng log.
Cờ hệ thống nói rõ:

```
ExitCode=137  OOMKilled=true
```

**Docling ngốn quá 7,7GB RAM khi parse PDF 18MB.** Container bị kernel giết.

Hệ quả nghiêm trọng hơn "một câu hỏi hỏng":
- Pathway **vẫn liệt kê** file trong `list_documents` → nhìn như đã index
- Không có log lỗi ở tầng ứng dụng
- Nếu không dò tay thì tưởng dữ liệu đã vào, thực tế mất trắng một tài liệu

Với hệ trả lời khách hàng, **im lặng mất dữ liệu** nguy hiểm hơn báo lỗi.

### Bài học: phải giới hạn RAM và canh OOM

Nếu triển khai:
- Đặt `mem_limit` cho container và **theo dõi OOMKilled**
- Kiểm số chunk mỗi tài liệu sau khi index, không tin `list_documents`
- Tách PDF lớn (>10MB) thành file nhỏ trước khi đưa vào `data/`

### Chunk có tốt lên thật

Hai lần sửa không vô ích. Trước:
```
văn bản rời rạc, không ngữ cảnh
```
Sau:
```
HEADINGS: # LED HẮT 6113
CONTENT: Model: 6113, Điện áp: DC12V, Công suất: 1.2W, Quy cách: 200 led...
```

Giữ được tiêu đề và bảng — cải thiện thật cho 6 file còn lại.

### Kết luận từ chạy thật

| | |
|---|---|
| Có chạy được không? | **Có** — sau khi vá 7 chi phí ẩn |
| Trả lời đúng không? | **Có**, không bịa, đọc được cả tiếng Trung |
| Nhanh không? | **4-6s** — chấp nhận được cho câu hỏi kỹ thuật |
| Sẵn sàng dùng chưa? | **Chưa** — truy hồi cần tinh chỉnh, xem dưới |

Việc còn phải làm trước khi dùng thật: chỉnh chunk/splitter để bảng thông số
không bị cắt rời, và đo lại tỷ lệ trả lời đúng trên bộ câu hỏi thật.

---

## C2. NẾU áp vào project này thì đổi những gì

Trả lời cụ thể — đây là thứ thật sự thay đổi, không phải lý thuyết.

### Thêm vào hệ

| Thành phần | Chi tiết |
|---|---|
| Service Python mới | Docker container `pathwaycom/pathway`, cổng 8000 |
| Thư mục tài liệu | `./data` mount vào container — Pathway theo dõi và tự index |
| Tool thứ 13 | `tra_tri_thuc` gọi HTTP `POST localhost:8000/v1/pw_ai_answer` |
| Biến môi trường | `PATHWAY_PORT`, `PATHWAY_LICENSE_KEY`, `OPENAI_API_KEY` |

### KHÔNG đổi

- **12 tool hiện có** — giá, tồn, khách, đơn, báo cáo vẫn đi thẳng Odoo
- **Registry khách** — vẫn 4 tool, không thêm
- **Luồng lên đơn** — không đụng
- **Odoo** — không sửa gì

### Bot trả lời thêm được gì

Hiện tại những câu này đều rơi vào `chuyen_sale`:

```
"đèn này bảo hành mấy tháng?"
"P10 chạy nguồn mấy A?"
"chính sách đổi trả thế nào?"
"led dây ngoài trời lắp cần lưu ý gì?"
```

Sau khi có: bot đọc tài liệu rồi trả lời. **Với điều kiện tài liệu đã được số
hoá** — hiện chưa có file nào.

### Cái giá phải trả

**1. Thêm một ngôn ngữ vào hệ.** Đang thuần TypeScript. Thêm Python nghĩa là:
deploy 2 service, log 2 chỗ, ai sửa cũng phải biết cả hai. Server prod
(`100.107.48.28`, Dokploy) phải chạy thêm container.

**2. Chậm hơn tool Odoo.** Tool hiện tại 60-500ms (XML-RPC nội bộ). RAG phải
embed câu hỏi → tìm vector → gọi LLM tóm tắt → thường **2-5 giây**. Chấp nhận
được cho câu hỏi kỹ thuật, không chấp nhận được cho hỏi giá.

**3. Ranh giới mới phải canh.** Bot có 13 tool, trong đó 12 tool trả **số chính
xác** và 1 tool trả **văn bản gần đúng**. Model phải chọn đúng. Hỏi "P10 giá bao
nhiêu" mà nó gọi `tra_tri_thuc` thì đọc giá từ catalogue cũ — **đúng bug KB mà
dự án đã bỏ RAG để thoát ra**.

Phải chặn bằng code, không chỉ bằng prompt: `tra_tri_thuc` từ chối câu chứa
"giá", "bao nhiêu tiền", "còn hàng" và chỉ về tool Odoo.

**4. Telemetry + giấy phép.** Xem §A2 — phải tắt telemetry có ý thức, và xem
lại việc trộn BSL với AGPL-3.0.

### Ước lượng

| Việc | Thời gian |
|---|---|
| Dựng service + docker-compose | 0,5 ngày |
| Tool `tra_tri_thuc` + hàng rào chặn câu hỏi số | 0,5 ngày |
| Test (func + E2E + ca "hỏi giá không được dùng RAG") | 0,5 ngày |
| Số hoá tài liệu | **chưa ước lượng được — chưa có tài liệu nào** |

Ba việc đầu 1,5 ngày. Việc thứ tư là việc của anh và nhân viên, và nó quyết
định toàn bộ giá trị: **không có tài liệu thì service chạy nhưng trả lời rỗng**.

---

## D. Đề nghị (sau khi chạy thật)

**Làm được — nhưng còn 2 việc phải xong trước.**

### Trước khi dùng thật

**1. Chỉnh chunk cho bảng thông số.** Câu về L7-Series thất bại dù dữ liệu có
trong tài liệu — bảng bị Docling cắt rời, mất ngữ cảnh tên dòng sản phẩm. Cần
thử `$splitter` khác hoặc bật `chunk: true` trong parser rồi đo lại.

**2. Đo tỷ lệ đúng trên bộ câu hỏi thật.** Tôi mới thử 4 câu. Cần ~30 câu nhân
viên hay gặp, chấm đúng/sai như bộ `bo-cau-hoi.yaml` đang có cho bot.

### Nếu triển khai, ba ranh giới CỨNG

**1. Chỉ registry nhân viên trước.** Cho khách sau, khi đã tin độ chính xác.

**2. Chặn câu hỏi về SỐ ở tầng code.**

```
Câu hỏi về TIỀN/TỒN (giá, còn hàng, công nợ, doanh thu) → LUÔN tool Odoo
Câu hỏi về CHỮ (bảo hành, thông số, cách dùng)          → RAG
```

Không chỉ dặn trong prompt — `tra_tri_thuc` phải **tự từ chối** câu chứa "giá",
"bao nhiêu tiền", "còn hàng" và chỉ về tool Odoo. Để RAG trả lời câu về tiền là
tái tạo đúng bug KB mà dự án đã bỏ RAG để thoát ra.

**3. KHÔNG index file giá đại lý.** `agent price and weight.xlsx` chứa
`Agent price`/`VIP price` cho 120 model — đã tách sang `khong-index/`. Cần một
kiểm tra tự động chặn file có các cột này lọt vào `data/`.

### Chi phí thật (đo được)

| Khoản | Số |
|---|---|
| Docker image | **17,8GB** (chỉ có bản amd64) |
| Model embedding local | **1,0GB** đĩa |
| RAM lúc chạy | **4,6GB** |
| CPU lúc index | **~300%** (3 lõi) |
| Parse lần đầu | ~8-15 phút cho 8 file |
| Trả lời | **4-6 giây/câu** |
| Tiền API | **0đ cho embedding**, chat dùng 9router sẵn có |

Server prod (Dokploy) cần đủ đĩa cho 17,8GB và RAM cho 4,6GB.

---

## E. Việc đáng làm hơn ngay bây giờ

Đối chiếu với dữ liệu thật, ba việc này giá trị cao hơn hẳn Pathway:

**1. Nhập giá cho 895 sản phẩm.** Chỉ 250/1.208 SP (20,7%) có giá dùng được.
Đây là việc DỮ LIỆU, không phải code — nhưng nó chặn bot nhiều hơn mọi giới hạn
kỹ thuật cộng lại. Bot tra đúng, tìm đúng, rồi phải nói "chưa có giá".

**2. Bảng `ToolCallLog`.** `ghiLog` hiện chỉ là callback, không lưu đâu cả.
Nghiên cứu cho thấy tool call hỏng âm thầm 3-15% — không đo thì không biết bot
đang sai ở đâu.

**3. User `bot_zalo`** với `group_staff`. Bot đang chạy bằng `admin`
(`group_manager`) nên Odoo *cho phép* đọc giá vốn. Code đã chặn bằng danh sách
trắng field, nhưng đó là hàng rào duy nhất — chưa có hàng rào Odoo.

Ba việc này rẻ hơn tích hợp Pathway và gỡ đúng nút thắt đang có.
