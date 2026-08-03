# Đánh giá SPEC tool báo cáo + cảnh báo

> **ĐÃ TRIỂN KHAI XONG 2026-07-30.** Kết quả thực tế ở §G cuối file. Hai lỗi
> chặn đường ở §A đã vá; số lỗi `None` thực tế là **8 chỗ**, không phải 2.


> Đối tượng: `2026-07-30-tool-bao-cao-canh-bao-SPEC.md`
> Ngày đánh giá: 2026-07-30 · Người đánh giá: Claude
> Phương pháp: đối chiếu từng khẳng định với code thật ở **cả hai repo**, và
> **gọi thật Odoo local** (`nelia_prod`) để kiểm chứng, không chỉ đọc code.

## Kết luận ngắn

Spec **chất lượng cao** — đúng gần như toàn bộ khẳng định kỹ thuật, và phần
"Luật bất di bất dịch" là thứ đáng giữ nguyên. Nhưng **chưa làm theo được ngay**:
có **1 lỗi chặn đường** (Tool 1 sẽ chết ngay lần gọi đầu) và **1 lỗi cú pháp**
khiến cả 3 tool đều ném exception.

Cả hai lỗi đều thuộc loại chỉ lộ ra khi **gọi thật**, không lộ ra khi đọc code.

| | |
|---|---|
| Khẳng định đã kiểm | 18 |
| Đúng | 16 |
| Sai (chặn đường) | 2 |
| Ước lượng sau khi vá | Làm được, ~1 ngày |

---

## A. Hai lỗi phải sửa trước khi code

### A1. 🔴 CHẶN ĐƯỜNG — `get_sales_report_data` không gọi được qua XML-RPC

**Spec §4.3 giả định Tool 1 chỉ cần bọc method sẵn. Không đúng.**

Mọi cách gọi đều chết:

```
this_month (không truyền gì thêm)  LOI: cannot marshal None unless allow_none is enabled
this_month + warehouse_ids: []     LOI: cannot marshal None unless allow_none is enabled
custom thiếu ngày                  LOI: cannot marshal None unless allow_none is enabled
custom đủ ngày                     LOI: cannot marshal None unless allow_none is enabled
```

**Nguyên nhân** — `incokit_sales_report.py:482-483`:

```python
"time_range": {
    "df": df.isoformat() if df else None,   # ← None
    "dt": dt.isoformat() if dt else None,   # ← None
    "preset": time_preset,
},
```

`_resolve_range()` trả `None` cho preset không phải `custom`. Dict chứa `None`,
mà endpoint `/xmlrpc/2` của Odoo khởi tạo **không bật `allow_none`** → chết khi
mã hoá phản hồi.

**Vì sao chưa ai phát hiện:** UI gọi qua **JSON-RPC**
(`static/src/js/sales_report.js:46`), vốn cho phép `null`. Method chạy tốt trên
màn hình hằng ngày. Còn `OdooClient` của ZaloCRM dùng **XML-RPC**. Method chưa
bao giờ được gọi qua đường này.

**Không vá được từ TypeScript.** `client.ts:104` đọc `<nil/>` được, nhưng lỗi
xảy ra phía Odoo lúc *ghi* phản hồi — trước khi byte nào về tới client.

**Cách sửa** (Python, cùng repo với Việc 4 — gộp chung một lần `-u`):

```python
"time_range": {
    "df": df.isoformat() if df else False,   # False thay None
    "dt": dt.isoformat() if dt else False,
    "preset": time_preset,
},
```

`False` là quy ước "rỗng" chuẩn của Odoo (`phone`, `default_code`… đều dùng),
mã hoá XML-RPC được, và JS coi là falsy y như `null` → **UI không đổi hành vi**.

Phải rà cả `get_dashboard_data` cho cùng lỗi. Hiện nó chạy được với
`time_preset: 'today'`, nhưng nên kiểm mọi preset trước khi tin.

**Hệ quả với spec:** §0 ghi "1 method Python mới". Thực tế là **1 method mới +
1 sửa lỗi**. Việc 4 không còn là bước tuỳ chọn làm trước — nó **bắt buộc** phải
xong trước Tool 1.

---

### A2. 🔴 SAI CÚ PHÁP — `args` phải là `[]`, không phải `[[]]`

**Spec §4.2** viết:

```ts
[[]],   // args: [] rỗng vì là @api.model
```

Kiểm thật trên Odoo local:

```
args = []    → OK — keys: kpi,revenue_chart,branch_chart,top_products
args = [[]]  → LOI: TypeError: get_dashboard_data() got multiple values for
                    argument 'time_preset'
```

`[[]]` là mảng chứa **một** phần tử (mảng rỗng), nên Odoo đẩy phần tử đó vào
tham số vị trí đầu — chính là `time_preset` — rồi `time_preset` trong kwargs
thành trùng.

Trớ trêu: đây **đúng là cạm bẫy mà chính §4.2 cảnh báo**, chỉ khác tên tham số.
`client.ts:254` đã làm đúng: `this.execute(model, 'search_read', [], {...})`.

**Sửa:** đổi `[[]]` thành `[]` trong ví dụ §4.2. Một ký tự, nhưng bỏ qua thì cả
3 tool đều ném exception ngay lần gọi đầu.

---

## B. Những gì spec nói ĐÚNG (đã kiểm từng cái)

| # | Khẳng định | Kết quả |
|---|---|---|
| 1 | Repo `lednelia/code` tồn tại | ✅ |
| 2 | `incokit_dashboard_overview.py` tồn tại | ✅ 32KB |
| 3 | `_build_low_stock_html()` ở dòng 88 | ✅ đúng dòng 88 |
| 4 | Nó kết thúc quanh dòng 181 | ✅ method kế ở 182 |
| 5 | `get_low_stock_data()` CHƯA tồn tại | ✅ `AttributeError` khi gọi |
| 6 | `get_dashboard_data` có 8 tham số, đúng thứ tự | ✅ khớp chính xác |
| 7 | `get_sales_report_data` có 4 tham số | ✅ khớp |
| 8 | `_NON_PRODUCT_NAME_FILTER` là biến có thật | ✅ dòng 79, dùng ở 120 và 415 |
| 9 | SQL lọc `detailed_type='product'` | ✅ |
| 10 | SQL có `HAVING COUNT(DISTINCT ...) >= 3` | ✅ |
| 11 | SQL lọc `usage='internal'`, `HAVING > 0` | ✅ |
| 12 | `danger` khi `<= 7` ngày | ✅ |
| 13 | Cửa sổ bán 30 ngày | ✅ `sales_window = 30` |
| 14 | `_post_init_hook` đặt decimal precision = 0 | ✅ `__init__.py:112-117` |
| 15 | `types.ts` yêu cầu description có điều kiện kích hoạt | ✅ đúng nguyên văn |
| 16 | `execute(model, method, args, kwargs)` | ✅ `client.ts:221-226` |
| 17 | Cạm bẫy "multiple values for 'fields'" có thật | ✅ ghi ở `client.ts:245` |
| 18 | `registry.has()` tồn tại (test §5 dùng) | ✅ dòng 109 |

Một sai số vô hại: `tra-ton-kho.ts` là **134** dòng, spec ghi 121.

---

## C. Ba điểm spec làm rất tốt

**1. Luật 1 (cấm bot tự tính tổng) — giữ nguyên, đừng nới.**

Lập luận "unlink sai thì thấy ngay; số sai thì lãnh đạo tin và quyết định theo"
là lý do đúng để đặt luật ở **tầng tool** chứ không phải trong prompt. Prompt
có thể bị model bỏ qua; code thì không. Cùng nguyên tắc mà `tra_san_pham` dùng
danh sách trắng field thay vì dặn model "đừng đọc giá vốn".

**2. Yêu cầu `_build_low_stock_html()` gọi lại `get_low_stock_data()`.**

Đây là phần tôi đánh giá cao nhất. Spec không chỉ thêm cái mới mà còn buộc cái
cũ dùng chung nguồn — chặn "2 nguồn sự thật" ngay từ đầu, thay vì để nó thành
bug sau 3 tháng. Ca test §5 (hai hàm ra cùng số) chính là chốt chặn cho việc đó.

**3. Test "3 tool KHÔNG có trong registry khách".**

Test này bảo vệ một **ranh giới bảo mật**, không phải một hành vi. Nó chống
được lỗi mà không ai cố ý gây ra — refactor sau này gom registry cho gọn. Đúng
loại test đáng viết.

---

## D. Bốn điểm nên bổ sung

### D1. Chưa nói cách xác định quyền user

§4.3 bảo "nếu `by_profit` không có trong tabs → nói không có quyền". Nhưng
§4.4 lại bảo `inventory_value` thì *"nếu không chắc → bỏ qua field này"*.

"Không chắc" là trạng thái không nên tồn tại trong code. `get_sales_report_data`
đã trả `can_export: is_manager_admin` — dùng cờ đó làm nguồn quyết định duy nhất
cho cả hai tool, thay vì đoán.

### D2. Thiếu ngưỡng độ dài đầu ra

§4.3 nói "tối đa ~10 dòng" cho tool 1, §4.5 không nói gì cho tool 3
(`limit=15` mặc định). Một tin Zalo 15 dòng đã khó đọc trên điện thoại.

Đề nghị: thống nhất **tối đa 10 dòng + 1 dòng tổng** cho cả ba tool, phần dư
báo "còn N mục nữa" — cùng quy ước `CÒN NỮA` mà `tra_san_pham` đang dùng.

### D3. Chưa nói gì về `maxIterations` khi tool trả dữ liệu lớn

§4.6 kết luận "giữ 8" vì báo cáo là 1 lần gọi. Đúng về **số vòng lặp**, nhưng
bỏ sót **kích thước ngữ cảnh**: kết quả tool nằm lại trong lịch sử và bị tính
tiền lại ở **mọi vòng sau**. `get_dashboard_data` trả `revenue_chart` +
`branch_chart` + 3 danh sách top — dễ vài nghìn token.

Đề nghị thêm vào §4.4: **hàm `dinhDang` phải cắt trước khi trả cho LLM**,
không đẩy nguyên dict. Đây là lý do `tra_san_pham` hạ mặc định từ 5 → 3 kết quả.

### D4. Nên thêm ca test cho chính lỗi A1

Sau khi vá `None → False`, thêm một ca gọi **thật** qua XML-RPC với mọi preset
(`today`, `this_month`, `custom` đủ ngày, `custom` thiếu ngày). Lỗi này lọt lưới
vì UI dùng JSON-RPC — test đọc code sẽ không bao giờ bắt được, chỉ test gọi thật
mới bắt.

---

## E. Việc cần làm, theo thứ tự

1. **Vá `None` → `False`** trong `incokit_sales_report.py:482-483`
   (và rà `get_dashboard_data` cùng lỗi)
2. **Thêm `get_low_stock_data()`** — đúng như §3
3. **Refactor `_build_low_stock_html()`** gọi lại nó
4. `-u incokit_pos`, rồi **gọi thật mọi preset qua XML-RPC** để xác nhận bước 1
5. Sửa `[[]]` → `[]` trong spec §4.2
6. Viết 3 tool TS + test
7. Đăng ký vào `buildStaffRegistry()`, docstring 6 → **9 tool**

Bước 1-4 ở repo `lednelia`. Bước 5-7 ở `ZaloCRM-fork`. **Không đảo thứ tự**:
làm Tool 1 trước khi vá bước 1 sẽ mất thời gian truy vết một lỗi đã biết nguyên nhân.

---

## F. Ghi chú về cách kiểm chứng

Hai lỗi ở mục A **không thể phát hiện bằng đọc code**:

- A1 chỉ lộ khi gọi qua XML-RPC. Đọc Python thấy `None` là hợp lệ; nó chỉ sai
  trong ngữ cảnh XML-RPC.
- A2 chỉ lộ khi Odoo thật khớp tham số. `[[]]` trông rất hợp lý.

Cả hai đều tìm ra bằng cách chạy `execute()` thật lên `nelia_prod` và đọc thông
báo lỗi. Đó cũng là lý do §5 nên có ít nhất một ca gọi thật, không chỉ mock.

---

## G. Kết quả triển khai (2026-07-30)

### Đã làm

| # | Việc | File |
|---|---|---|
| 1 | Vá lỗi `None` (**8 chỗ**, spec đoán 2) | `incokit_sales_report.py`, `incokit_dashboard_overview.py` |
| 2 | Thêm `get_low_stock_data()` | `incokit_dashboard_overview.py` |
| 3 | `_build_low_stock_html()` gọi lại nó | `incokit_dashboard_overview.py` |
| 4 | 3 tool TS | `odoo/tools/bao-cao-{tong-quan,ban-hang}.ts`, `canh-bao-ton-kho.ts` |
| 5 | Đăng ký registry nhân viên, docstring 6→9 | `agent/staff-agent.ts` |
| 6 | Mục "Báo cáo" + cấm markdown trong prompt | `agent/staff-command.ts` |
| 7 | Test: 36 func + 19 E2E + 4 prompt + 1 chặn khách | `tests/ai/odoo/bao-cao.*`, … |

### Lỗi `None` — nhiều hơn spec dự đoán

Spec chỉ ra 1 chỗ (`time_range` của sales_report). Thực tế **8 chỗ**, tìm bằng
cách quét đệ quy phản hồi trong Odoo shell thay vì đọc code:

| Chỗ | File |
|---|---|
| `time_range.df/dt` ×2 | `incokit_sales_report.py` |
| `time_range.df/dt` ×2 | `incokit_dashboard_overview.py` (spec **không** nhắc) |
| `totals_row` khi tab rỗng ×4 | `incokit_sales_report.py` |
| `drill_df` / `drill_dt` | `incokit_sales_report.py` |
| `drill_warehouse_id` (HĐ chưa gán kho) | `incokit_sales_report.py` |

Chỗ cuối chỉ lộ ở `this_month` — 3/5 preset khác đã xanh khi nó vẫn hỏng. Nếu
chỉ thử một preset rồi kết luận "xong" thì đã bỏ sót.

**Bài học:** đừng vá theo danh sách đọc được, hãy quét dữ liệu thật. Lệnh dùng:

```python
def tim(o, d='', f=None):
    if f is None: f=[]
    if o is None: f.append(d or '(goc)')
    elif isinstance(o, dict):
        for k,v in o.items(): tim(v, f'{d}.{k}', f)
    elif isinstance(o, (list,tuple)):
        for i,v in enumerate(o): tim(v, f'{d}[{i}]', f)
    return f
```

### Khác spec — và lý do

**Container tên `incokit_odoo_prod`**, spec ghi `incokit_odoo` → lệnh trong §3
chạy sẽ báo "No such container".

**Bỏ `time_preset='custom'`** khỏi tool `bao_cao_ban_hang`. Spec §4.3 bắt tool
tự kiểm ngày thiếu, nhưng tool không nhận tham số ngày tuỳ ý — giữ `custom` chỉ
tạo ra ca "rows rỗng, không báo lỗi" mà không thêm giá trị. `enum` trong schema
chặn từ đầu, đơn giản hơn kiểm tra lúc chạy.

**Xoá cột `cost` nhưng GIỮ `profit`/`pct`.** Spec §4.4 nói "nếu không chắc thì
bỏ qua" — mơ hồ. Đã làm dứt khoát: `cost` là giá vốn → cấm; `profit` là tổng
theo hoá đơn, không suy ngược ra giá vốn từng mặt hàng → giữ, vì đó chính là số
lãnh đạo cần.

**Nới trần prompt 1500 → 1600 ký tự.** 9 tool cần thêm mục định tuyến. Cắt tiếp
là cắt vào nội dung có ích chỉ để chiều một con số tròn.

### Lỗi phát hiện thêm khi chạy thật

**Prompt nhân viên chưa bao giờ cấm markdown.** Bot trả lời đầy `**đậm**` và
danh sách đánh số — Zalo không render, hiện ra dấu sao. Lỗi có sẵn từ trước,
chỉ lộ khi câu trả lời dài. Đã thêm luật + test.

### Kiểm chứng

| Tầng | Kết quả |
|---|---|
| Unit | 632 xanh |
| Function | **295** (258 → 295, +37) |
| E2E Odoo thật | **46** (27 → 46, +19) |
| TypeScript | sạch |

**Mutation test:** tắt hàng rào `COT_CAM` → 4 test đỏ ngay. Test thật sự bắt lỗi.

**E2E gồm 10 ca preset** chống lỗi `marshal None` — loại lỗi chỉ lộ khi gọi
thật, và một ca chứng minh `bao_cao_tong_quan` với `bao_cao_ban_hang` ra **cùng
một số tổng** (chống 2 nguồn sự thật).

**HTML dashboard và tool cùng nguồn:** 11 SP trong `get_low_stock_data()` ↔ 12
`<tr>` trong HTML (1 header + 11 dòng), không SP nào lệch.

### Thử với LLM thật

| Hỏi | Tool | Kết quả |
|---|---|---|
| "@bot tháng này doanh thu bao nhiêu" | `bao_cao_tong_quan` | 5.718.613.816đ · 974 HĐ · giảm 37,6% |
| "@bot sản phẩm nào sắp hết hàng" | `canh_bao_ton_kho` | 6 SP mức GẤP, kèm tốc độ bán |
| "@bot nhân viên nào bán nhiều nhất" | `bao_cao_ban_hang` | Đinh Thị Minh Anh — 3.538.149.800đ |
| KHÁCH: "shop doanh thu bao nhiêu" | **0 tool** | từ chối, không lộ số |
| "@bot cho xem giá vốn" | `bao_cao_ban_hang` | báo lãi 471tr, **giá vốn 737.017.060đ KHÔNG lọt** |

Hàng rào giá vốn giữ được **dù bot chạy bằng user `admin`** (có `group_manager`,
tức Odoo *cho phép* đọc `standard_price`). Đây là hàng rào tầng code, độc lập
với quyền Odoo.

### Còn tồn đọng

1. **Chưa tạo user `bot_zalo`** với `group_staff`. Test hiện chạy bằng `admin`
   nên chưa kiểm được nhánh "user không đủ quyền → tab `by_profit` vắng mặt".
   Code đã xử lý và có test func, nhưng chưa xác nhận trên Odoo thật.
2. **Chưa có test phía Odoo** khẳng định `get_low_stock_data()` và
   `_build_low_stock_html()` ra cùng số (spec §5 yêu cầu). Đã kiểm thủ công một
   lần (11 SP ↔ 12 `<tr>`), nhưng chưa tự động hoá.
3. **Chưa nối vào luồng Zalo thật** — đúng phạm vi spec §8, việc riêng.
