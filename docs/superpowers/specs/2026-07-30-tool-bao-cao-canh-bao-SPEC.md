# SPEC: Tool báo cáo lãnh đạo + cảnh báo động

> Dành cho AI/dev thực hiện. Đọc hết trước khi viết dòng code đầu tiên.
> Ngày: 2026-07-30 · Hệ: `ZaloCRM-fork` ↔ Odoo 17 `incokit_pos`

## 0. Tóm tắt cho người vội

Thêm **3 tool đọc** vào `backend/src/modules/ai/odoo/tools/`, đăng ký vào **registry nhân viên** (KHÔNG đăng ký vào registry khách), và **1 method Python mới** trong Odoo.

| Việc | File | Loại |
|---|---|---|
| 1. `bao_cao_ban_hang` | `odoo/tools/bao-cao-ban-hang.ts` (mới) | TS |
| 2. `bao_cao_tong_quan` | `odoo/tools/bao-cao-tong-quan.ts` (mới) | TS |
| 3. `canh_bao_ton_kho` | `odoo/tools/canh-bao-ton-kho.ts` (mới) | TS |
| 4. `get_low_stock_data()` | `incokit_dashboard_overview.py` (sửa) | **Python/Odoo** |
| 5. Đăng ký 3 tool | `agent/staff-agent.ts` (sửa) | TS |

Việc 4 nằm ở **repo khác** (`lednelia/code`), cần `-u incokit_pos` sau khi sửa.

**Không đụng:** `customer-agent.ts`, `loop.ts`, `registry.ts`, `client.ts`, và 6 tool đang có.

---

## 1. Vì sao làm việc này

4 mục tiêu ban đầu của bot: (a) trợ lý bán hàng, (b) xuất hóa đơn, (c) **báo cáo lãnh đạo**, (d) **cảnh báo sản phẩm động**.

Hiện trạng: 6 tool phủ tốt (a). Mục (c) và (d) đang ở **0%** — không tool nào chạm báo cáo.

Điểm mấu chốt: **Odoo đã có sẵn 2 method public trả đúng số liệu cần**, đã encode mọi luật lọc phải trả giá bằng bug thật mới có được (lọc hóa đơn KV `'Đã hủy'`, lọc theo kỳ thay vì lifetime, lọc chi nhánh). Việc này chỉ là **bọc chúng lại thành tool**, không phải tính toán gì mới.

---

## 2. LUẬT BẤT DI BẤT DỊCH

Đọc kỹ 4 luật này. Vi phạm bất kỳ luật nào là làm sai spec.

### Luật 1 — Bot KHÔNG BAO GIỜ tự tính tổng

Tool **chỉ được gọi method Odoo có sẵn** rồi định dạng kết quả. Tuyệt đối KHÔNG:

- Viết SQL
- Gọi `searchRead` rồi tự `.reduce()` / `.map()` cộng số
- Tự tính %, tự tính chênh lệch, tự cộng doanh thu nhiều dòng

**Lý do (quan trọng, đọc kỹ):** 3 bug đắt nhất lịch sử hệ này đều là **bug đọc/tổng hợp**, không phải bug ghi:
- Bridge cộng đôi 1,45 tỷ
- Footer tính lifetime thay vì theo kỳ (5,6 tỷ vs 21 tỷ thật)
- Tổng bán thổi phồng 206 → 115 tỷ vì đếm cả hóa đơn "Đã hủy"

Mỗi cái mất nhiều ngày truy vết. Bot tự tính tổng = tái tạo đúng lớp bug đó, với tốc độ máy. `unlink` sai thì thấy ngay; **số sai thì lãnh đạo tin và quyết định theo**.

Nếu lãnh đạo hỏi câu mà method sẵn không trả lời được (ví dụ "doanh thu riêng đèn downlight tháng này") → bot phải nói **"chưa có báo cáo này"**. Đây là luật cứng ở tầng tool, không phải lời khuyên trong prompt.

### Luật 2 — Mọi con số phải kèm NGUỒN và KỲ

Hệ này từng có lỗi "2 màn hình ra 2 số". Mọi output của tool báo cáo phải ghi rõ nguồn + khoảng thời gian, ví dụ:

```
Nguồn: Báo cáo bán hàng · Kỳ: 01/07–30/07/2026
```

Để khi lãnh đạo thấy số lạ, họ đối chiếu được với màn hình.

### Luật 3 — VND không có phần thập phân

`_post_init_hook` đặt decimal precision = 0. Format tiền: `1.234.567đ`, **không** `1,234,567.00`.

Dùng `Math.round(n).toLocaleString('vi-VN')`.

### Luật 4 — 3 tool này CHỈ vào registry nhân viên

Đăng ký vào `buildStaffRegistry()` trong `agent/staff-agent.ts`.

**TUYỆT ĐỐI KHÔNG** đăng ký vào `buildCustomerRegistry()` (`agent/customer-agent.ts`).

Lý do: doanh thu, lợi nhuận, top khách hàng là **thông tin nội bộ**. Registry khách cố ý không có `tra_khach_hang` vì nó lộ công nợ — cùng nguyên tắc đó áp cho báo cáo.

---

## 3. Việc 4 (Python/Odoo) — LÀM TRƯỚC

> Repo: `/Users/dinhvietquoc/Documents/workspaces/lednelia/code`
> File: `custom_addons/incokit_pos/models/incokit_dashboard_overview.py`

### Vấn đề

Module đã có logic cảnh báo tồn kho tốt ở `_build_low_stock_html()` (khoảng dòng 88-181), nhưng:

1. Nó trả về **chuỗi HTML** — không dùng được cho tin nhắn Zalo
2. Tên bắt đầu bằng `_` → **Odoo chặn gọi qua RPC** (`odoo/models.py:145` `check_method_name()`)

### Cần làm

Thêm method public **tái dùng nguyên SQL đã có**:

```python
@api.model
def get_low_stock_data(self, days_ahead=14, limit=15, warehouse_ids=None):
    """Cảnh báo SP sắp hết — trả list dict thay vì HTML để đẩy ra Zalo/API.

    Cùng nguồn SQL với _build_low_stock_html để KHÔNG có 2 nguồn sự thật.

    Trả: [{'product_id': int, 'ten': str, 'ton': float,
           'bq_ngay': float, 'so_ngay_con': float, 'muc_do': 'danger'|'warning'}]
    """
```

**Bắt buộc giữ nguyên các bộ lọc nhiễu đã kiểm chứng** trong SQL hiện có:
- Cửa sổ bán 30 ngày
- `HAVING COUNT(DISTINCT am.invoice_date) >= 3 AND SUM(aml.quantity) >= 5` (loại đơn bulk 1 lần làm nhiễu)
- `detailed_type = 'product'`
- Loại tên chứa VAT/thuế/giảm giá/discount/phí (biến `_NON_PRODUCT_NAME_FILTER`)
- Tồn = `SUM(stock_quant.quantity)` tại location `usage='internal'`, `HAVING > 0`
- `muc_do = 'danger'` khi `so_ngay_con <= 7`, còn lại `'warning'`

**Sau đó refactor `_build_low_stock_html()` gọi lại `get_low_stock_data()`** rồi render HTML. Đây là điểm quan trọng: nếu để 2 nơi cùng tính, chúng sẽ lệch nhau — đúng lớp bug mà spec này chống.

### Triển khai

```bash
cd /Users/dinhvietquoc/Documents/workspaces/lednelia/code
# sửa file, rồi:
docker exec incokit_odoo odoo -c /etc/odoo/odoo.conf -d nelia_prod \
  -u incokit_pos --stop-after-init --no-http
docker restart incokit_odoo
```

Chỉ sửa Python thì restart là đủ, nhưng chạy `-u` cho chắc.

---

## 4. Việc 1-3 (TypeScript) — 3 tool mới

### 4.1 Khuôn mẫu bắt buộc

Mọi tool trong repo này theo đúng khuôn sau. **Bám theo, đừng sáng tạo cấu trúc mới** — xem `odoo/tools/tra-ton-kho.ts` (121 dòng) làm mẫu ngắn gọn nhất.

Mỗi file export đúng 3 thứ:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: <mô tả 1 dòng>
//
// <Vì sao tool này tồn tại — bối cảnh, bug thật nếu có>

import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';

// 1. Hàm chạy thật
export async function tenTool(
  deps: { odoo: Pick<OdooClient, 'execute'> },
  input: { ... },
): Promise<KetQua> { ... }

// 2. Định nghĩa gửi cho LLM
export const tenToolDefinition: ToolDefinition = {
  name: 'ten_tool',
  description: '...',   // PHẢI nói KHI NÀO gọi, không chỉ nói làm gì
  inputSchema: { type: 'object', properties: { ... }, required: [...] },
  // mutates: true  ← chỉ cho tool GHI. 3 tool này là ĐỌC nên BỎ QUA field này
};

// 3. Định dạng kết quả cho LLM đọc
export function dinhDangTenTool(kq: KetQua): string { ... }
```

**Về `description`:** `agent/types.ts:11-15` ghi rõ — mô tả phải có **điều kiện kích hoạt** ("Gọi khi sếp hỏi doanh thu…"), vì model mới có xu hướng dè dặt gọi tool. Viết "Tool này trả doanh thu" là chưa đủ.

### 4.2 Gọi Odoo thế nào

`OdooClient` có 2 method dùng được (`odoo/client.ts`):

```ts
odoo.searchRead<T>(model, domain, fields, opts?)        // đọc bản ghi
odoo.execute<T>(model, method, args, kwargs)            // gọi method
```

**Cách gọi đúng — dùng `kwargs`, KHÔNG dồn hết vào positional:**

```ts
const kq = await odoo.execute<any>(
  'incokit.sales_report',
  'get_sales_report_data',
  [[]],                                  // args: [] rỗng vì là @api.model
  {                                      // kwargs: tham số đặt tên
    time_preset: 'this_month',
    warehouse_ids: null,
    date_from: null,
    date_to: null,
  },
);
```

⚠️ **Cạm bẫy đã gặp thật trên Odoo 17** (xem comment ở `odoo/client.ts` trên `searchRead`): trộn positional args với kwargs khiến Odoo khớp nhầm vị trí và ném

```
TypeError: ... got multiple values for argument 'fields'
```

Nên: **args chỉ chứa `[]` (do `@api.model`), mọi tham số còn lại đặt trong kwargs theo tên.** Cách này cũng miễn nhiễm khi Odoo thêm tham số mới vào giữa chữ ký.

### 4.3 Tool 1: `bao_cao_ban_hang`

**Gọi:** `incokit.sales_report` → `get_sales_report_data(time_preset, warehouse_ids, date_from, date_to)`

`time_preset` ∈ `today | yesterday | last_7_days | this_month | last_month | custom`

⚠️ **Bẫy:** với `custom` mà thiếu `date_from`/`date_to`, Odoo trả **rows rỗng, KHÔNG báo lỗi**. Tool phải tự kiểm và trả thông báo rõ ràng, đừng để bot nói "doanh thu 0đ".

**Trả về:**
```
{ tabs: [{key, label, columns, rows, totals_row}], warehouses, time_range, can_export }
```

4 tab: `by_time` (theo thời gian) · `by_profit` (lợi nhuận — **chỉ hiện với manager/admin**) · `by_staff` (nhân viên) · `by_branch` (chi nhánh).

`columns` = `[{key, label, type, width}]`, `type` ∈ `text | int | money`.

**Định dạng đầu ra:** đọc `totals_row` là chính (đó là số tổng). Không liệt kê hết rows — tin Zalo dài quá không ai đọc. Tối đa ~10 dòng, kèm dòng tổng. Cột `type: 'money'` format theo Luật 3.

**Nếu `by_profit` không có trong `tabs`** → user không đủ quyền. Nói "không có quyền xem lợi nhuận", **đừng đoán số**.

### 4.4 Tool 2: `bao_cao_tong_quan`

**Gọi:** `incokit.dashboard_overview` → `get_dashboard_data(time_preset, warehouse_ids, chart_granularity, top_product_by, top_staff_by, top_customer_by, date_from, date_to)`

**Trả về:** `{ kpi: {invoice_count, revenue, refund_count, refund_amount, delta_prev, prev_revenue}, revenue_chart, branch_chart, top_products, top_staff, top_customers, inventory_value, cashbook_expense, low_stock_html, time_range, warehouses, currency_symbol }`

**Định dạng:** ưu tiên `kpi` + `top_products` + `top_customers`. `delta_prev` là **% so kỳ trước** (đã cap ±999) — nói "tăng 12% so kỳ trước".

⚠️ **BỎ QUA `low_stock_html`** — đó là HTML, dùng tool 3 thay thế.

⚠️ **`inventory_value` tính theo `standard_price` (giá vốn).** Chỉ nêu khi user là manager/admin. Nếu không chắc → bỏ qua field này.

### 4.5 Tool 3: `canh_bao_ton_kho`

**Gọi:** `incokit.dashboard_overview` → `get_low_stock_data(days_ahead, limit, warehouse_ids)` (method tạo ở §3)

**Định dạng:** sắp theo `so_ngay_con` tăng dần, `muc_do='danger'` lên đầu. Ví dụ:

```
⚠️ 3 SP sắp hết (bán trung bình 30 ngày qua):
• Đèn LED âm trần 9W — còn 12, hết sau ~4 ngày
• Nguồn 12V 5A — còn 30, hết sau ~6 ngày
Nguồn: Cảnh báo tồn kho · 30/07/2026
```

Không có SP nào → nói rõ "không có SP nào sắp hết", **đừng trả chuỗi rỗng**.

### 4.6 Đăng ký vào registry

`agent/staff-agent.ts` → `buildStaffRegistry()`, thêm 3 khối `.register()` theo đúng mẫu 6 tool đang có:

```ts
.register({
  definition: baoCaoBanHangDefinition,
  run: async (input) =>
    dinhDangBaoCaoBanHang(await baoCaoBanHang({ odoo }, input as { ... })),
})
```

⚠️ **Cập nhật comment `maxIterations`.** Hiện `staff-agent` để trần 8. Thêm 3 tool không làm chuỗi gọi dài hơn (báo cáo là 1 lần gọi, không phải chuỗi), nên **giữ 8**. Nhưng sửa docstring "Dựng registry đủ 6 tool" → **9 tool**.

---

## 5. Test

Đặt tại `backend/tests/ai/odoo/`, đuôi `.func.ts` (chạy bằng `npm run test:func`). Xem `tra-ton-kho.func.ts` làm mẫu.

Mỗi tool tối thiểu 4 ca:

| Ca | Khẳng định |
|---|---|
| Đường vui | Gọi đúng model + method + args, format đúng |
| Odoo trả rỗng | Nói "không có dữ liệu", KHÔNG nói "0đ" |
| `custom` thiếu ngày | Báo lỗi rõ ràng (tool 1) |
| Odoo lỗi/timeout | Trả thông báo lỗi, KHÔNG throw làm sập agent |

**Một test bắt buộc cho toàn bộ spec:**

```ts
it('3 tool báo cáo KHÔNG có trong registry khách', () => {
  const r = buildCustomerRegistry({ odoo: fake, ghiNhanChuyenSale: async () => {} });
  const ten = r.definitions().map(d => d.name);
  expect(ten).not.toContain('bao_cao_ban_hang');
  expect(ten).not.toContain('bao_cao_tong_quan');
  expect(ten).not.toContain('canh_bao_ton_kho');
});
```

Test này chống việc lần refactor sau vô tình mở báo cáo cho khách.

Phía Odoo: thêm ca vào `custom_addons/incokit_pos/tests/` khẳng định `get_low_stock_data()` và `_build_low_stock_html()` **ra cùng số** (chống 2 nguồn sự thật).

---

## 6. Cấu hình

Không cần biến môi trường mới. Tool dùng lại `OdooClient` sẵn có.

⚠️ **User Odoo mà bot dùng quyết định bot thấy gì.** `standard_price` được bảo vệ bằng `groups="incokit_pos.group_manager"` ở tầng field (`product_template.py:11`), nên Odoo **tự động lọc** theo quyền của user đang gọi — không cần lọc thủ công.

Nghĩa là:
- Bot chạy dưới `group_staff` → không thấy lợi nhuận, `by_profit` không có trong `tabs`
- Bot chạy dưới `group_manager` → thấy đủ

**Tuyệt đối không dùng user admin cho bot** và không gọi `sudo()`.

---

## 7. Định nghĩa hoàn thành

- [ ] `get_low_stock_data()` chạy được, `_build_low_stock_html()` đã gọi lại nó
- [ ] 3 tool mới có đủ 3 export (hàm, definition, dinhDang)
- [ ] Đã đăng ký vào `buildStaffRegistry()`, docstring sửa thành 9 tool
- [ ] **KHÔNG** có trong `buildCustomerRegistry()` + có test khẳng định
- [ ] Mọi số tiền format VND không thập phân
- [ ] Mọi output kèm nguồn + kỳ
- [ ] Không có SQL, không có `.reduce()` cộng tiền trong 3 tool
- [ ] Test func xanh; `./run_e2e.sh` phía Odoo xanh

---

## 8. Việc KHÔNG làm trong spec này

- **Không** thêm tool ghi. 3 tool này chỉ đọc.
- **Không** đụng `customer-agent.ts` ngoài việc thêm test khẳng định.
- **Không** nối dây agent vào luồng tin nhắn — việc riêng, spec riêng.
- **Không** làm cron cảnh báo tự động. Spec này chỉ làm tool để bot **được hỏi** thì trả lời. Cron đẩy tin chủ động là bước sau.
- **Không** cho bot sinh SQL, kể cả `SELECT`.

---

## 9. Ghi chú cho người thực hiện

Hai method báo cáo đã public sẵn và đã được UI dùng hằng ngày — **số chúng trả về là số đang hiển thị trên màn hình**. Đó là lý do spec này chọn gọi lại chúng thay vì tự truy vấn: bảo đảm bot và màn hình **không bao giờ ra 2 số khác nhau**.

Nếu trong lúc làm, bạn thấy method sẵn không trả đúng thứ cần — **đừng tự viết truy vấn thay thế**. Hãy dừng lại và báo, vì đó là dấu hiệu cần thêm method trong Odoo (một lần, có test), không phải thêm phép tính trong TypeScript.
