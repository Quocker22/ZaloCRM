# Ảnh catalog báo giá cho chiến dịch hàng loạt — Thiết kế

**Ngày:** 2026-07-03
**Trạng thái:** Approved (user "làm đi")

## Mục tiêu

Trong chiến dịch **nhắn tin hàng loạt** (bulk campaign), cho phép đính kèm **1 ảnh catalog báo giá**:
tự động lấy top N (6-9) sản phẩm CÓ GIÁ + CÓ ẢNH từ KB, ghép thành 1 ảnh grid (mỗi ô: ảnh SP +
tên + giá), gửi kèm tin nhắn cho mỗi khách. Giúp khách thấy sản phẩm + giá ngay, tăng chuyển đổi.

## Quyết định đã chốt (từ brainstorm)

- **1 ảnh chung cho cả chiến dịch** (ghép 1 lần, cache, gửi lại cùng file) — không phải mỗi khách 1 ảnh.
- **Tự động chọn 6-9 SP** có giá + ảnh (tiêu chí: đa dạng nhóm, không trùng nhóm).
- **Gộp thành 1 ảnh catalog** (grid), không gửi nhiều ảnh rời — quan trọng để chống Zalo flag.
- Bật/tắt qua **1 checkbox "Đính kèm bảng báo giá"** trong màn tạo chiến dịch.

## Kiến trúc

### File mới (của tôi)

**`backend/src/modules/campaign/catalog-image.ts`**
- `pickCatalogProducts(orgId, n, lookup, imageMap): Promise<CatalogItem[]>` — chọn ≤ n SP có ảnh
  (từ `_kb_match.json`) VÀ tra được giá (KB search + `parsePriceFromChunk` của order-checkout).
  Đa dạng nhóm: nhóm hoá theo từ khoá đầu tên (nguồn / led dây / module / dây / phụ kiện), mỗi
  nhóm tối đa 2 SP để catalog không trùng lặp. `CatalogItem = { name, price, imagePath }`.
- `renderCatalogImage(items, outPath): Promise<string>` — dùng **sharp** ghép grid:
  - Cols = 3 (grid 2×3 hoặc 3×3 tùy số item). Mỗi ô: ảnh SP resize 240×240 (cover) + dải text
    dưới (tên rút gọn ≤ 28 ký tự + giá đậm) render bằng SVG overlay.
  - Nền trắng, tiêu đề "BẢNG GIÁ THAM KHẢO — <shop>" phía trên. Xuất PNG.
- `getCampaignCatalog(orgId): Promise<string|null>` — cache theo orgId (RAM + TTL 10 phút): trả path
  PNG đã ghép, hoặc `null` nếu < 3 SP có giá+ảnh (không đủ để làm catalog).

### File WIP của user — CHỈ THÊM NHÁNH, không sửa logic cũ, KHÔNG commit

**`backend/src/modules/campaign/bulk-campaign-service.ts`**
- `runMessageBatch` nhận thêm optional `attachPriceList?: boolean`.
- Nếu bật: đầu batch gọi `getCampaignCatalog(orgId)` 1 lần (path hoặc null). Trong vòng lặp mỗi khách,
  sau khi `sendMessage(text)` thành công + catalog != null → `humanPace(60)` rồi
  `zaloOps.sendImage(zaloAccountId, uid, 0, [catalogPath])`. Lỗi gửi ảnh → log, KHÔNG chặn (khách đã
  nhận text; state vẫn 'sent').

**`backend/src/modules/campaign/campaign-routes.ts`**
- Route chạy message batch: đọc thêm `attachPriceList` từ body, truyền vào `runMessageBatch`.

**`frontend/src/views/marketing/BulkCampaignView.vue`**
- Thêm 1 checkbox "📋 Đính kèm bảng báo giá (ảnh sản phẩm + giá)" dưới ô nội dung tin. Truyền
  `attachPriceList` khi gọi API chạy chiến dịch.

## Chống Zalo flag

- **1 ảnh/khách** (catalog gộp), không nhiều ảnh rời.
- Ảnh ghép **1 lần/chiến dịch** (cache) → CPU nhẹ, cùng 1 file.
- Tái dùng `humanPace` giữa text→ảnh + delay 800ms giữa các khách (đã có trong batch).

## Xử lý lỗi

| Tình huống | Xử lý |
|---|---|
| < 3 SP có giá+ảnh | `getCampaignCatalog` trả null → gửi text bình thường, không ảnh, log warn |
| sharp ghép lỗi | catch → trả null → gửi text, log error |
| sendImage lỗi 1 khách | log, tiếp tục; khách đã nhận text, state='sent' |

## Test

- Unit (`catalog-image.test.ts`): `pickCatalogProducts` trả SP có giá+ảnh, mỗi nhóm ≤ 2, ≤ n;
  `renderCatalogImage` xuất file PNG hợp lệ (magic bytes) với input mock.
- Manual: bật checkbox trong 1 chiến dịch → verify ảnh catalog ghép đúng (ảnh+tên+giá) trước khi gửi.

## Ngoài phạm vi

- Chọn SP thủ công / catalog theo ngành từng khách (đã chốt: tự động chung).
- Xem trước catalog trên UI (có thể thêm sau).
