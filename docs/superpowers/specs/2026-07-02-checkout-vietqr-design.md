# Thiết kế: Flow chốt đơn + VietQR cho bot Zalo

**Ngày:** 2026-07-02
**Bối cảnh:** Bot RAG tư vấn bán hàng LEDNELIA (ZaloCRM-fork, Node/TS). Đã có: auto-reply, gửi ảnh SP, handoff tạo group sale + tóm tắt. Mục tiêu tính năng này: cửa hàng nhỏ / bán mang đi — khách chốt đơn thì bot tự chốt + gen QR + báo sale.

## Quyết định đã chốt (với user)
- **Trích đơn:** bot đọc lại đơn cho khách XÁC NHẬN (SP + số lượng + tổng) trước khi gen QR. (không tự gen ngay)
- **Thiếu giá:** nếu bất kỳ món nào không có giá trong KB → KHÔNG gen QR, báo sale (handoff thường).
- **Theo dõi thanh toán:** KHÔNG. Bot chỉ gen QR + báo sale; sale tự kiểm tài khoản bank.
- **VietQR:** port thuật toán từ github.com/subiz/vietqr (Go) sang TS (không thêm dependency Go). Render ảnh QR bằng lib npm `qrcode`.
- **Tài khoản nhận tiền:** 1 TK cố định, cấu hình qua env. Chưa set → bot không gen QR, chỉ báo sale.
- **Gửi QR:** cho khách trong chat 1-1 khi đơn đã xác nhận + chọn chuyển khoản.

## Luồng tổng thể
```
Khách chat → bot tư vấn (như hiện tại)
  → Khách chốt đơn ("lấy 5 cuộn X, 2 cái Y")
  → Bot TRÍCH đơn [{name, qty}] + tra giá KB (code)
       ├─ có món THIẾU giá → báo sale (handoff thường, KHÔNG QR)
       └─ mọi món CÓ giá → CODE tính tổng (qty×unitPrice rồi cộng)
            → Bot đọc lại đơn xác nhận:
              "Đơn: 5×X=..., 2×Y=..., TỔNG=... đúng không ạ? CK hay tiền mặt?"
            → khách "đúng + chuyển khoản" → gen VietQR → gửi ẢNH QR cho khách
                                          → báo group sale (đơn+tổng+đã gửi QR)
            → khách "đúng + tiền mặt"     → chỉ báo group sale (không QR)
```

## Thành phần code

### a) Mở rộng RagReply (rag-reply.ts)
Thêm field optional vào JSON bot trả:
- `order?: Array<{ name: string; qty: number }>` — SP + số lượng khách chốt.
- `checkoutStage?: 'confirm' | 'pay_qr' | 'pay_cash'` — bước hiện tại.

Prompt dạy bot:
- Khách chốt đơn (nêu SP + số lượng rõ) → điền `order` + `checkoutStage='confirm'`, reply đọc lại đơn hỏi xác nhận + hỏi CK/tiền mặt. KHÔNG tự tính tổng trong reply (code tính).
- Khách xác nhận "đúng/ok" + chuyển khoản → `checkoutStage='pay_qr'`.
- Khách xác nhận + tiền mặt → `checkoutStage='pay_cash'`.

### b) order-checkout.ts
- `resolveOrder(order, kbLookup)`: mỗi món tra giá KB (tái dùng hybrid search + regex `Giá bán: (\d[\d.]*)đ`). Trả `{ items: [{name, qty, unitPrice}], total, missingPrice: boolean }`.
- **Tổng tính bằng CODE**: `sum(qty × unitPrice)`. Không nhờ LLM (giữ nguyên nguyên tắc chống bịa số — LLM chỉ trích tên+số lượng, code làm số học).
- `missingPrice=true` nếu có ≥1 món không tra được giá.

### c) vietqr.ts (port subiz)
- `generateVietQrPayload({ bankBin, accountNo, amount, description })` → chuỗi EMVCo TLV.
  Field: 00=01, 01=12(dynamic), 38(GUID A000000727 + BIN + STK + QRIBFTTA), 53=704(VND), 54=amount, 58=VN, 62>08=desc, 63=CRC16.
- `crc16(data)`: CCITT poly 0x1021, init 0xFFFF, tính cả literal "6304".
- Verify: `generateVietQrPayload(120000,'970415','0011001932418','ung ho lu lut')` khớp ví dụ subiz.
- Render ảnh: lib `qrcode` → PNG file tạm trong scratchpad → `zaloOps.sendImage`.

### d) Wire vào ai-auto-reply-hook + auto-reply-wiring
- Sau khi parse reply, nếu có `checkoutStage`:
  - `confirm`: gửi reply (đọc lại đơn) như thường — KHÔNG QR, KHÔNG handoff (chờ khách xác nhận).
  - `pay_qr`: gọi `resolveOrder`. `missingPrice` → báo sale (handoff), không QR. Đủ giá + có config TK → gen VietQR + gửi ảnh QR cho khách + báo group sale (đơn+tổng). Thiếu config TK → chỉ báo sale.
  - `pay_cash`: chỉ báo group sale (đơn+tổng, hình thức tiền mặt).
- Tóm tắt gửi group sale tái dùng handoff-group.ts, thêm dòng đơn+tổng+hình thức TT.

## Cấu hình (env)
- `AI_QR_BANK_BIN` — mã BIN ngân hàng (6 số).
- `AI_QR_ACCOUNT_NO` — số tài khoản.
- `AI_QR_ACCOUNT_NAME` — tên chủ TK (hiển thị, optional).
- Nội dung CK tự sinh: `DH <tên khách> <hhmm>` (bỏ dấu, ≤25 ký tự).
- Thiếu 1 trong (BIN, STK) → coi như chưa cấu hình → không gen QR, báo sale.

## Xử lý lỗi
- Gen QR lỗi / thiếu config / thiếu giá / resolveOrder throw → fallback báo sale (không chặn luồng, nuốt lỗi + log).
- Ảnh QR gửi lỗi (zca-js flaky) → vẫn báo sale, log.

## Test
- `crc16`: đối chiếu ví dụ subiz (payload cố định → CRC khớp).
- `generateVietQrPayload`: output khớp chuỗi subiz mẫu.
- `resolveOrder`: (1) đủ giá → tổng đúng; (2) thiếu giá 1 món → missingPrice=true; (3) tính tổng qty×price chính xác.
- Không phá guard chống bịa số hiện có (LLM vẫn không được tự cộng trong reply text).

## Ngoài phạm vi (giai đoạn sau)
- Đối soát thanh toán tự động (webhook bank/SePay/Casso).
- Model Order lưu DB (hiện chỉ trích on-the-fly).
- Map assignedUser→Zalo UID cho group.
