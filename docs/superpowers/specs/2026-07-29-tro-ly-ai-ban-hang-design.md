# Trợ lý AI bán hàng — Thiết kế

> Ngày: 2026-07-29 · Trạng thái: chờ duyệt spec
>
> Hệ đích: `ZaloCRM-fork` (Fastify + Prisma + Postgres) ↔ `incokit_pos` (Odoo 17, DB `nelia_prod`)

## 1. Mục tiêu

Một bot AI phục vụ **nhân viên nội bộ** qua Zalo, làm 4 việc:

1. **Trợ lý bán hàng** — tra sản phẩm, tồn kho, khách hàng, giá; soạn đơn nháp.
2. **Báo cáo lãnh đạo** — hỏi tiếng Việt, trả số liệu khớp màn hình.
3. **Cảnh báo động** — tồn sắp hết, lệch công nợ/tồn, doanh số bất thường.
4. **Xác nhận 2 bước** — mọi thao tác ghi phải được người gõ đồng ý.

Giai đoạn này **không mở cho khách hàng cuối**. Lý do ở §9.

### Nguyên tắc bất di bất dịch

**Bot không có đường ghi riêng.** Mọi thao tác ghi đi qua đúng code nghiệp vụ mà UI đang dùng.

Đây không phải nguyên tắc trừu tượng. Lịch sử `incokit_pos` cho thấy mọi lệch công nợ/tồn kho đều sinh ra từ hai đường ghi song song vào cùng một sự thật: bridge KV cộng đôi 1,45 tỷ, footer cộng lifetime thay vì theo kỳ, tổng bán thổi phồng 206→115 tỷ. Thêm một đường ghi thứ ba do LLM điều khiển sẽ tái tạo đúng lớp bug đó, với tốc độ máy.

## 2. Nền đã có — kế thừa, không viết lại

Rà soát `backend/src/modules/ai/` cho thấy ~1.940 dòng cầu nối Odoo **viết riêng cho `incokit_pos`**, kèm ~3.700 dòng test. Đánh giá: **8/10, kế thừa**.

| Thành phần | Đường dẫn | Trạng thái |
|---|---|---|
| Vòng lặp tool-calling | `agent/loop.ts` | Trần 8 vòng, kiểm `stopReason`, có test |
| Registry tool | `agent/registry.ts` | Thêm tool = 1 file + 1 dòng `.register()` |
| Nhận lệnh NV | `agent/staff-command.ts` | Cổng `isSelf`, có test |
| Điểm hội tụ | `agent/staff-agent.ts` | **Chưa ai gọi** — xem §3 |
| Client XML-RPC | `odoo/client.ts` | 281 dòng, timeout 20s, có test |
| Chống trùng đơn | `odoo/idempotency.ts` | Khoá `zalo:{conv}:{seq}` |
| 5 tool Odoo | `odoo/tools/` | tra SP / tồn / KH, tạo đơn nháp, chuyển sale |
| Đa provider LLM | `provider-registry.ts` | Có override base-URL |

Vài quyết định trong code cho thấy tác giả hiểu rõ rủi ro đặc thù của hệ này:

- `tra-san-pham.ts:19,22` — **hai lớp** chặn giá vốn (allowlist + forbidden-list), phòng cả khi ACL Odoo cấu hình sai.
- `tao-don-nhap.ts:131-135` — **cố ý không truyền `price_unit`**, để Odoo tự lấy giá. Comment: *"đặt giá là cách bịa số tinh vi nhất"*.
- `tao-don-nhap.ts:163-171` — đọc lại sau `create()`, **báo động nếu `state != 'draft'`** thay vì im lặng bỏ qua.

Ba điểm này đúng tinh thần *"đừng tin số stored, tính lại từ nguồn gốc"* của `ARCHITECTURE.md`.

## 3. Khoảng trống cần lấp

### 3.1 Agent chưa được nối dây

`chayLenhNhanVien()` chỉ được tham chiếu trong chính module của nó và trong test — **không route/hook nào gọi**. Luồng đang chạy thật (`knowledge/ai-auto-reply-hook.ts`) là RAG một lượt, không tool-calling.

### 3.2 Race condition tạo đơn trùng — LỖI THẬT

`tao-don-nhap.ts:86-99` rồi `:139-147` làm: `searchRead(client_order_ref)` → nếu chưa có thì `create()`. Đây là TOCTOU.

**Đã kiểm chứng tận DB:** `models/sale_order.py` **không có `_sql_constraints` nào**. (11 khối `_sql_constraints` trong module đều thuộc model khác: `incokit_kiotviet_history.py`, `incokit_sales_channel.py:15`, `incokit_customer_group.py:19`.) Không có UNIQUE index trên `client_order_ref` → **không có lưới an toàn ở tầng DB**.

Hai request song song cùng khoá → cả hai cùng thấy "chưa có" → cả hai cùng `create` → **2 đơn cho 1 khách**. Webhook Zalo trùng là chuyện thường ngày.

Làm nặng thêm: `loop.ts:124` chạy tool bằng `Promise.all` **không phân biệt đọc/ghi**. `mutates: true` (`types.ts:27`) chỉ dùng để log, không dùng để chặn.

### 3.3 Không có trạng thái giữa 2 lượt chat

Không bảng Prisma nào lưu state hội thoại AI. "Nhớ" hiện tại chỉ là đọc 8 tin gần nhất rồi để LLM tự suy. Không đủ để xác nhận đơn: nếu LLM trích sai ở lượt 2, số tiền khác lượt 1 mà không ai đối chiếu.

### 3.4 Chưa có tool báo cáo / cảnh báo

0 tool nào chạm `incokit.sales_report`, `dashboard_overview`, `reconcile.audit`.

### 3.5 `chuyen-sale.ts` không có test

Tool duy nhất không được phủ. Logic đơn giản nhưng là **lối thoát cuối** của toàn hệ.

## 4. Kiến trúc

```
Nhân viên tag @bot trong Zalo
        │
        ▼
message-handler.ts ──► nhanDienLenhNhanVien()
        │               không phải lệnh → luồng RAG cũ, 0 token
        ▼
   runAgent()  ──── LLM qua ai.byhung.com/v1  (đổi config, không sửa code)
        │
        ▼
   ToolRegistry ── 5 tool cũ + 6 tool mới
        │
        ▼
   OdooClient (XML-RPC) ──► Odoo 17 / incokit_pos / nelia_prod
                            gọi ĐÚNG method mà UI gọi
```

### Ba tầng chốt chặn

| # | Tầng | Chặn gì | Cưỡng chế bởi |
|---|---|---|---|
| 1 | Odoo RBAC | User bot dưới `group_staff` → không đọc được giá vốn | **DB** |
| 2 | Tool allowlist | `FORBIDDEN_FIELDS` lọc lần cuối | Code JS |
| 3 | Không có tool nguy hiểm | Không có tool xác nhận đơn / sửa giá / xóa | Thiết kế registry |

Tầng 1 là hàng rào thật; tầng 2 là lưới an toàn phòng khi tầng 1 bị cấu hình sai. Cả hai cùng tồn tại là **cố ý**, không phải thừa.

## 5. Tool

### 5.1 Giữ nguyên 5 tool cũ

`tra_san_pham`, `tra_ton_kho`, `tra_khach_hang`, `tao_don_nhap`, `chuyen_sale`. Sửa `tao_don_nhap` theo §6 và §5.1.1.

#### 5.1.1 Bám đúng lối tạo đơn thật — và chiết khấu

**Lối tạo đơn thật của cửa hàng là FORM `sale.order`** (menu "Đặt hàng", action 515), **không phải** wizard `incokit.quick.sale`. Menu có cả hai lối nhưng khách chỉ dùng form.

Điều này đã gây một lần làm sai: yêu cầu "thêm chiết khấu ở tạo đơn" được làm vào wizard `quick_sale` (`61c628f`), phải làm lại trên form `sale.order` (`0d2b59d`). Bot nhầm chỗ thì không sai một commit — sai hàng loạt đơn.

`tao-don-nhap.ts` gọi `create()` trực tiếp trên `sale.order` nên **đúng model**, nhưng nó **chưa biết 2 field chiết khấu mới** (`0d2b59d`):

| Field | Cấp | Ý nghĩa |
|---|---|---|
| `incokit_discount_value` + `incokit_discount_type` | dòng | CK theo % hoặc số tiền |
| `incokit_order_discount_value` + `incokit_order_discount_type` | đơn | CK tổng đơn, phân bổ xuống `discount%` từng dòng |

Cột `discount` gốc của Odoo bị **ẩn có chủ đích** trên form (đồng bộ ngầm qua onchange). Bot **không được ghi thẳng `discount`** — phải ghi `incokit_discount_*` và để onchange/compute của module tự phân bổ. Ghi thẳng `discount` là tạo đường ghi thứ hai, đúng thứ nguyên tắc §1 cấm.

**Giai đoạn 1: bot KHÔNG đặt chiết khấu.** Đơn nháp không CK, sale thêm CK khi xác nhận. Lý do: CK là đòn bẩy giá — cùng loại rủi ro với đặt giá, mà `tao-don-nhap.ts:131-135` đã cố ý không cho bot đặt giá. Nếu sau này cần, thêm tool riêng có ngưỡng CK tối đa và luôn qua xác nhận 2 bước.

Tool phải **nêu rõ trong câu trả lời** rằng đơn nháp chưa có chiết khấu, để sale không tưởng là đã áp.

#### 5.1.2 Chống trôi theo core

Core đang được nâng cấp liên tục (`61c628f`, `0d2b59d` xuất hiện sau khi spec này khởi thảo). Ràng buộc:

- **Không hard-code danh sách field** cho các model hay đổi. Dùng `fields_get()` để phát hiện field khả dụng, giao nhau với allowlist.
- `FORBIDDEN_FIELDS` vẫn hard-code — danh sách **cấm** phải tĩnh, không được co giãn theo schema.
- Có **một test khẳng định** tool không ghi `discount` trực tiếp, để lần refactor sau không lặng lẽ mở lại đường đó.

### 5.2 Sáu tool mới

| Tool | Gọi vào | Chữ ký nguồn |
|---|---|---|
| `bao_cao_ban_hang` | `incokit.sales_report` | `get_sales_report_data(time_preset, warehouse_ids, date_from, date_to)` — **đã public** |
| `bao_cao_tong_quan` | `incokit.dashboard_overview` | `get_dashboard_data(time_preset, warehouse_ids, ...)` — **đã public** |
| `canh_bao_ton_kho` | `incokit.dashboard_overview` | Method public **mới** (§5.3) |
| `doi_soat_lech` | `incokit.reconcile.audit` | `search_read` |
| `tra_don_hang` | `sale.order` | `search_read` — trả `name, partner_id, state, amount_total, date_order`; **không** trả `margin` hay giá vốn |
| `truy_van_sql` | Postgres read-only | §5.4 |

**Vì sao gọi method sẵn thay vì tự tính:** `get_sales_report_data` đã encode mọi luật lọc phải trả giá mới có — lọc hóa đơn KV `status_value != 'Đã hủy'`, lọc theo kỳ thay vì lifetime, lọc chi nhánh. Bot tự tính sẽ không biết những luật đó.

`get_sales_report_data` trả 4 tab: `by_time`, `by_profit` (chỉ manager/admin), `by_staff`, `by_branch`. Shape `{tabs, warehouses, time_range, can_export}`, mỗi tab có `{key, label, columns, rows, totals_row}`.

`time_preset` ∈ `today | yesterday | last_7_days | this_month | last_month | custom`. Với `custom` **bắt buộc** truyền `date_from` + `date_to`, thiếu thì trả rỗng chứ không báo lỗi — tool phải kiểm và báo rõ.

### 5.3 Method public mới cho cảnh báo tồn kho

Module **chưa có** `stock.warehouse.orderpoint` hay `min_qty`. Cái duy nhất có là `_build_low_stock_html()` (`incokit_dashboard_overview.py:88-181`) — logic tốt nhưng trả **chuỗi HTML** và bắt đầu bằng `_` nên **Odoo chặn gọi qua RPC**.

Thêm method public **tái dùng nguyên SQL đó**, trả list dict:

```python
@api.model
def get_low_stock_data(self, days_ahead=14, limit=15, warehouse_ids=None):
    """Trả list dict thay vì HTML, để đẩy cảnh báo ra ngoài."""
    # [{product_id, ten, ton, bq_ngay, so_ngay_con, muc_do}]
```

Giữ nguyên các bộ lọc nhiễu đã kiểm chứng: cửa sổ bán 30 ngày; `HAVING COUNT(DISTINCT invoice_date) >= 3 AND SUM(quantity) >= 5` (loại đơn bulk một lần); `detailed_type='product'`; loại tên chứa VAT/thuế/giảm giá/phí.

Refactor `_build_low_stock_html()` gọi lại method mới để **một nguồn sự thật**, tránh đúng lỗi hai-đường-tính mà spec này chống.

### 5.4 `truy_van_sql` — năm lớp rào

Tool duy nhất cần rào riêng. Chỉ chạy khi báo cáo sẵn không đáp ứng.

1. **User Postgres read-only riêng** — `GRANT SELECT` thôi. LLM sinh `UPDATE` thì **DB từ chối**. Rào nằm ở quyền DB, không ở prompt.
2. `statement_timeout = 10s`.
3. `LIMIT` cưỡng chế (mặc định 200).
4. **Luôn dán kèm câu SQL + số dòng** vào câu trả lời.
5. Prompt yêu cầu ưu tiên báo cáo sẵn.

Lớp 1 là mấu chốt: prompt thì LLM lách được, `GRANT` thì không.

**Rủi ro còn lại, ghi rõ:** SQL sinh ra vẫn có thể **sai im lặng** — chạy thành công, ra số đẹp, nhưng sai. Benchmark BIRD-INTERACT: model frontier ~33% trên schema thật. Lớp 4 (dán SQL) là cách duy nhất để người đọc phát hiện. Vì vậy câu trả lời từ `truy_van_sql` **phải luôn kèm cảnh báo "số này chưa đối chiếu báo cáo chuẩn"**.

## 6. Vá race condition

### 6.1 UNIQUE index phía Odoo

Thêm vào `models/sale_order.py`:

```python
_sql_constraints = [
    ('incokit_bot_ref_uniq', 'UNIQUE(client_order_ref)',
     'Mã tham chiếu đơn đã tồn tại.'),
]
```

**Bắt buộc kiểm dữ liệu trùng sẵn trước khi thêm** — KV cũ có thể đã trùng:

```sql
SELECT client_order_ref, COUNT(*) FROM sale_order
WHERE client_order_ref IS NOT NULL
GROUP BY client_order_ref HAVING COUNT(*) > 1;
```

Nếu có trùng: dùng **partial index** chỉ áp cho khoá bot, không đụng dữ liệu lịch sử:

```sql
CREATE UNIQUE INDEX incokit_bot_order_ref_uniq
ON sale_order (client_order_ref)
WHERE client_order_ref LIKE 'zalo:%';
```

Phương án partial an toàn hơn và **được ưu tiên** trừ khi kiểm cho thấy không có trùng nào.

### 6.2 Bắt lỗi trùng phía tool

`tao_don_nhap` phải bắt lỗi vi phạm unique từ Odoo và **coi đó là `da_ton_tai`**, không phải lỗi: search lại theo khoá rồi trả đơn cũ. Đây mới là chỗ đóng kín race — index chặn, tool xử lý hệ quả một cách êm.

### 6.3 Tuần tự hóa tool ghi

`loop.ts` phải chạy **tuần tự** các tool có `mutates: true`, song song các tool đọc. Biến `mutates` từ nhãn log thành nhãn có hiệu lực.

> **Vì sao vẫn cần, khi §7 đã chặn tool ghi để chờ xác nhận?** Vì hai thứ chặn ở hai thời điểm khác nhau. §7 chặn ở lượt *soạn* đơn; §6.3 bảo vệ lượt *chạy* sau khi người dùng đã gõ "đồng ý" — lúc đó tool ghi thật sự thực thi. Ngoài ra §7 là luật nghiệp vụ có thể đổi, còn §6.3 là thuộc tính của vòng lặp: bất kỳ tool ghi nào thêm về sau đều được bảo vệ mà không phải nhớ lại quy tắc này.

## 7. Xác nhận 2 bước

### 7.1 Bảng mới

```prisma
model AiPendingAction {
  id             String   @id @default(cuid())
  orgId          String
  conversationId String
  toolName       String
  payload        Json     // tham số đã chuẩn hoá
  tomTat         String   // đúng câu đã đọc cho người dùng
  seq            Int
  trangThai      String   @default("cho_xac_nhan")
  expiresAt      DateTime
  createdAt      DateTime @default(now())

  @@index([conversationId, trangThai])
}
```

`trangThai` ∈ `cho_xac_nhan | da_xac_nhan | het_han | da_huy`.

### 7.2 Luồng

```
NV: "@bot lên đơn cho chị Hoa 2 cuộn P10"
  │
  ├─ agent gọi tra_khach_hang, tra_san_pham   (đọc, chạy ngay)
  │
  ├─ agent định gọi tao_don_nhap
  │     → CHẶN LẠI. Ghi AiPendingAction, KHÔNG gọi Odoo.
  │
  └─ Bot: "Xác nhận đơn: chị Hoa — P10 ×2 — 760.000đ. Gõ 'đồng ý' để tạo."

NV: "đồng ý"
  │
  ├─ đọc AiPendingAction còn hạn
  ├─ đối chiếu tomTat ↔ payload
  └─ chạy tao_don_nhap với ĐÚNG payload đã lưu → đánh dấu da_xac_nhan
```

**Ba điểm quyết định:**

- **Chạy lại đúng payload đã lưu**, không để LLM dựng lại đơn từ trí nhớ. Đây là lý do bảng này tồn tại.
- **Hết hạn 10 phút** — giá và tồn có thể đổi. Quá hạn thì bắt soạn lại, không chạy.
- **Một pending mỗi hội thoại** — soạn đơn mới thì hủy đơn cũ, tránh gõ "đồng ý" trúng nhầm đơn.

### 7.3 Nhận diện đồng ý

Khớp **chính xác** một tập từ khóa (`đồng ý`, `ok`, `xác nhận`, `duyệt`, `chốt`) sau khi chuẩn hóa chữ thường + bỏ dấu. **Không dùng LLM để phán đoán ý định đồng ý** — đây là chốt an toàn cuối, không giao cho thứ có thể hiểu sai.

## 8. Cảnh báo động

Dùng `node-cron` sẵn có. Mỗi sáng 07:00.

| Cảnh báo | Nguồn | Điều kiện |
|---|---|---|
| Tồn sắp hết | `get_low_stock_data()` | Còn < 14 ngày bán |
| Lệch công nợ/tồn | `incokit.reconcile.audit` | Có bản ghi lệch mới |
| Doanh số bất thường | `get_dashboard_data()` | `delta_prev` vượt ngưỡng |

**Ranh giới then chốt: luật phát hiện là SQL tất định; AI chỉ diễn giải thành câu tiếng Việt.**

AI không đi tìm bất thường — nó viết lại cái mà SQL đã tìm ra. Ranh giới này giữ cho cảnh báo không bao giờ bịa số. Nếu AI chết hoặc trả rác, cảnh báo vẫn gửi được ở dạng thô.

`reconcile.audit` đã có cron riêng chạy 1 lần/ngày (`data/reconcile_audit_data.xml`, `interval_type=days`). Cron cảnh báo chỉ **đọc kết quả**, không tự chạy `run_reconcile()` — tránh hai lịch quét cùng lúc.

**Chống làm phiền:** không gửi lại cùng một cảnh báo trong 24h (khoá theo `check_type + product_id/partner_id`). Không có gì đáng báo thì **không gửi tin nào**.

## 9. Phạm vi — điều KHÔNG làm

### 9.1 Không mở cho khách hàng cuối

`tra-khach-hang.ts` nhận **SĐT tùy ý** và trả về **tên + công nợ**. Không ràng buộc nào buộc SĐT đó thuộc về người đang chat.

Khách A nhắn *"cho xem công nợ số 0912345678"* → bot trả công nợ khách B. **Rò rỉ dữ liệu tài chính cho người lạ.**

Với NV nội bộ thì không sao — NV vốn có quyền xem. Mở cho khách cần bảng liên kết `conversationId` ↔ `res.partner` và tool chỉ tra được partner đã liên kết. Đây là **điều kiện tiên quyết**, thuộc spec sau.

### 9.2 Không có tool ghi nào khác ngoài `tao_don_nhap`

Không xác nhận đơn, không sửa giá, không thu tiền, không xóa. `action_confirm()` / `_create_invoices()` động vào kho thật và sổ kế toán thật — **chỉ người bấm**.

### 9.3 Không thay luồng RAG hiện có

Tin không tag bot vẫn đi luồng cũ. Không sửa `ai-auto-reply-hook.ts`.

## 10. Kiểm thử

| Hạng mục | Kiểu | Vì sao |
|---|---|---|
| Race: 2 lệnh song song cùng khoá → đúng 1 đơn | func | Lỗ hổng §3.2, hiện **chưa có test** |
| Pending hết hạn → từ chối chạy | func | Chống chạy đơn giá cũ |
| `tomTat` lệch `payload` → từ chối | func | Chống LLM đổi số giữa 2 lượt |
| Từ khóa đồng ý: chỉ khớp chính xác | unit | Chống "ok để tôi hỏi lại" bị hiểu là đồng ý |
| `chuyen_sale` | func | §3.5 — hiện chưa có test |
| Tool báo cáo trả rỗng khi thiếu `date_from` | func | `custom` thiếu ngày trả rỗng im lặng |
| `truy_van_sql` từ chối `UPDATE/DELETE/DROP` | func | Xác nhận quyền DB, không chỉ prompt |
| Giá vốn không lọt ra LLM | func | Đã có, giữ |
| Tool **không** ghi `discount` trực tiếp | func | §5.1.1 — chống mở lại đường ghi thứ hai |
| Đơn bot tạo có `incokit_discount_value = 0` | func | Khẳng định bot không tự đặt CK |

**Nguyên tắc kế thừa từ `tests/common.py`: assert theo NGUỒN CHÂN LÝ.** Tồn kho = `SUM(stock_quant)` internal, không dùng `qty_available`. Công nợ = `SUM(incokit_kiotviet_debt.value)`.

Test E2E chạm Odoo thật phải trỏ DB test, **không phải `nelia_prod`**.

## 11. Cấu hình

| Biến | Ý nghĩa |
|---|---|
| `ODOO_URL` / `ODOO_DB` / `ODOO_USERNAME` / `ODOO_PASSWORD` | Tài khoản bot |
| `ODOO_READONLY_DSN` | Postgres read-only cho `truy_van_sql` |
| `AI_ALERT_CRON` | Lịch cảnh báo (mặc định `0 7 * * *`) |
| `AI_PENDING_TTL_MINUTES` | Hạn xác nhận (mặc định 10) |

**Tài khoản Odoo cho bot:** user riêng dưới `group_staff`, **không dùng admin**. Đây là tầng chốt chặn #1 — cấp nhầm `group_admin` thì lớp lọc field JS vẫn đứng, nhưng các quyền ghi khác sẽ mở toang. Lưu ý `models/ir_http.py` auto-grant `group_admin` cho **system/admin user** mỗi request — user bot phải nằm ngoài diện đó.

**LLM:** `ai.byhung.com` cắm qua `provider-registry.ts` — lưu base URL **không kèm `/v1`** vì `ai-service.ts:115` tự nối `/v1/chat/completions`.

## 12. Thứ tự triển khai

1. **Vá race** (§6) — làm trước vì tool ghi đã tồn tại và đã có thể chạy.
2. **Nối dây agent** (§3.1) — trợ lý sale chạy thật.
3. **Xác nhận 2 bước** (§7) — trước khi ai kịp dùng tool ghi nhiều.
4. **Tool báo cáo** (§5.2, §5.3).
5. **Cảnh báo cron** (§8).
6. **Bù test còn thiếu** (§10).

Bước 1 trước bước 2 là **có chủ đích**: nối dây trước khi vá race nghĩa là mở đường cho lỗi trùng đơn xảy ra trên tiền thật.

## 13. Rủi ro đã biết

| Rủi ro | Mức | Xử lý |
|---|---|---|
| SQL tự do trả số sai im lặng | **Cao** | Báo cáo sẵn làm mặc định; dán kèm SQL; ghi rõ "chưa đối chiếu" |
| LLM hiểu sai ý → soạn sai đơn | Trung bình | Xác nhận 2 bước; đơn chỉ ở `draft` |
| Trùng đơn do race | Cao → thấp sau §6 | UNIQUE index + tuần tự tool ghi |
| Tài khoản bot bị cấp quá quyền | Trung bình | `group_staff`; lọc field lớp 2 |
| Zalo cá nhân bị khóa do gửi nhiều | Trung bình | `humanPace` sẵn có; gộp cảnh báo 1 tin/ngày |
| Chi phí token vượt dự kiến | Thấp | Luồng RAG hiện **không** kiểm `maxDaily` — cần thêm đếm cho luồng agent |
| **Core đang nâng cấp → tool trôi theo schema** | Trung bình | §5.1.2: `fields_get()` thay vì hard-code field; test khẳng định ranh giới CK |
| Bot soạn đơn thiếu chiết khấu → sale sửa tay | Thấp | §5.1.1: nêu rõ "đơn nháp chưa có CK" trong câu trả lời |

Dòng cuối là phát hiện trong lúc rà soát: `AiConfig.maxDaily` (mặc định 500) **không được luồng auto-reply kiểm tra** — `runAutoReplyForMessage` gọi thẳng `generateText()`, bỏ qua quota gate. Luồng agent mới phải tự đếm, không thừa hưởng chốt nào.

## 14. Tiêu chí hoàn thành

- NV tag bot hỏi tồn/giá → trả đúng số khớp Odoo.
- NV soạn đơn → bot tóm tắt, chờ đồng ý, tạo đúng 1 đơn `draft`.
- Gõ "đồng ý" 2 lần → vẫn đúng 1 đơn.
- Hỏi doanh số tháng → số khớp màn hình Báo cáo bán hàng.
- Sáng có SP sắp hết → nhận đúng 1 tin cảnh báo.
- Toàn bộ test §10 xanh; `./run_e2e.sh` phía Odoo vẫn xanh.
- Không có đường nào bot gọi được `action_confirm` / `_create_invoices`.
