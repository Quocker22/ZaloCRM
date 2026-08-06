# Bảng "nhân viên được sai bot" — thay env AI_AGENT_UID_NHANVIEN

Ngày: 2026-08-06 · Đã duyệt hướng qua 6 câu hỏi trong hội thoại.

## Vấn đề

Nhận diện nhân viên hiện dựa vào env `AI_AGENT_UID_NHANVIEN` — danh sách UID
Zalo cứng, sửa phải deploy. Bug thật 06/08: Trần Hưng (không có trong env) hỏi
báo cáo → bị xử như KHÁCH → bot đi tư vấn sản phẩm thay vì báo cáo. Mỗi nhân
viên mới là một lần sót.

## Yêu cầu đã chốt

1. Quản lý nhân viên trong **CRM (DB + UI)**, không phải env.
2. Gắn `userId` (User CRM) — để về sau siết quyền có đường; đợt này CHƯA dùng.
3. Quyền xem báo cáo: **mọi nhân viên xem hết** (không phân bậc).
4. Cache RAM làm mới ngầm — **giữ cổng bảo mật ĐỒNG BỘ**, không async hoá.
5. Gán UID kiểu **"nhân viên nhắn thử → admin bấm Gán"** — không copy UID tay.
6. Tương thích ngược: env vẫn đọc **song song**, gỡ sau khi bảng ổn.

## Model DB

```prisma
model AgentOperator {
  id          String   @id @default(uuid())
  orgId       String   @map("org_id")
  zaloUid     String   @map("zalo_uid")
  userId      String?  @map("user_id")     // FK User, nullable
  tenGoi      String   @map("ten_goi")     // tên hiển thị
  enabled     Boolean  @default(true)
  createdById String?  @map("created_by_id")
  createdAt   DateTime @default(now()) @map("created_at")

  org  Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user User?        @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@unique([orgId, zaloUid])
  @@index([orgId, enabled])
  @@map("agent_operators")
}
```

`userId` nullable CÓ CHỦ ĐÍCH: gán được ngay cả khi UID chưa khớp User nào.

Không cần bảng "chờ gán" riêng: tin từ nick lạ đã nằm trong `messages`. Màn
chờ gán = truy vấn senderUid gần đây CHƯA có trong agent_operators.

## Nhận diện nhân viên (thay env)

`agent-operator-service.ts` — cache RAM theo pattern `sdk-limit-service.ts`:

- `Map<orgId, { uids: Set<string>; expiresAt: number }>`, TTL 60s.
- Nạp từ `AgentOperator where orgId, enabled=true`.
- **Hàm ĐỒNG BỘ** `laNhanVienSync(orgId, uid): boolean` đọc cache đã nạp.
  Cache miss → trả về kết quả env-only + kích nạp nền (không chặn).
- Có `napCache(orgId)` async gọi lúc khởi động + sau mỗi thao tác admin.
- Ghi vào bảng → `xoaCache(orgId)` ngay, khỏi chờ 60s.

**Tương thích ngược**: `laNhanVienSync` = (uid ∈ cache DB) HOẶC
(uid ∈ env AI_AGENT_UID_NHANVIEN). Env còn chạy tới khi gỡ.

**Đổi ở cổng bảo mật**: `nhanDienLenhNhanVien` hiện gọi `uidNhanVien(env)`.
Thay bằng `laNhanVienSync(orgId, uid)`. Chữ ký hàm KHÔNG async hoá — chỉ thêm
tham số `orgId` (message-handler đã có sẵn). Cổng vẫn đồng bộ, vẫn là ranh giới
CODE (quy tắc 2 KIEN-TRUC-AGENT.md).

## REST API (`/api/v1/agent-operators`, authMiddleware + admin)

```
GET    /                      liệt kê nhân viên đã gán (kèm User, enabled)
GET    /cho-gan               nick lạ gần đây chưa gán (senderUid + tên Zalo + tin cuối)
POST   /                      gán: { zaloUid, userId?, tenGoi } → tạo AgentOperator
PATCH  /:id                   bật/tắt enabled, đổi userId/tenGoi
DELETE /:id                   gỡ nhân viên (xoá bản ghi)
```

Mọi ghi → gọi `xoaCache(orgId)` để có hiệu lực tức thì.
`/cho-gan`: query messages 7 ngày, senderType='contact', senderUid NOT IN
(agent_operators của org), group theo senderUid, lấy tên + tin cuối.

## UI (màn "Nhân viên sai bot" trong CRM)

Theo pattern route/component hiện có. Hai danh sách:
- **Đã gán**: bảng tên + User + trạng thái + nút bật/tắt/gỡ.
- **Chờ gán**: nick lạ vừa nhắn → mỗi dòng có dropdown chọn User + nút "Gán".

Bấm Gán → POST → nick chuyển sang danh sách đã gán, biến mất khỏi chờ gán.

## Luồng dữ liệu

```
Nhân viên mới nhắn "@bot ..." lần đầu
  → chưa trong bảng → laNhanVienSync=false → xử như khách (như hiện tại)
  → tin lưu vào messages
Admin mở màn "Nhân viên sai bot" → thấy nick trong "Chờ gán"
  → chọn User + bấm Gán → POST → AgentOperator + xoaCache(org)
Nhân viên nhắn lại "@bot ..." → laNhanVienSync=true → luồng nhân viên ✅
```

## Xử lý lỗi

- Cache nạp lỗi (DB sập) → giữ cache cũ + fallback env; KHÔNG để nick nào mất
  quyền vì blip DB.
- Gán trùng zaloUid (unique) → 409, UI báo "nick này đã được gán".
- userId trỏ User đã xoá → onDelete SetNull, bản ghi vẫn sống (vẫn là nhân viên).

## Test

- Service: cache hit/miss, TTL hết hạn nạp lại, xoaCache sau ghi, fallback env
  khi DB lỗi, hợp nhất env ∪ DB.
- Cổng: `nhanDienLenhNhanVien` với uid trong bảng → nhận; ngoài bảng + không
  env → null; KHÁCH lạ vẫn bị chặn (bảo mật không nới).
- API: gán/bật-tắt/gỡ, /cho-gan lọc đúng nick chưa gán, 409 trùng.
- E2E nhẹ: gán một nick → laNhanVienSync đổi false→true sau xoaCache.

## Ngoài phạm vi (YAGNI)

- Phân bậc quyền (chủ/sale) — đã chốt xem hết. userId để sẵn đường, không dùng.
- Gỡ hẳn env — giữ song song đợt này, gỡ ở đợt sau khi bảng chạy ổn.
- Tự động gán từ ZaloAccount — đã chọn "nhắn thử → gán" thủ công.
