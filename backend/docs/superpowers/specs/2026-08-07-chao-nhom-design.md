# Bot chào có ngữ cảnh khi được add vào nhóm

Ngày: 2026-08-07. Trạng thái: đã brainstorm + chốt 6 mục với anh.

## Mục tiêu

Khi nick bot vừa **được add** vào một nhóm Zalo: đọc ~30 tin gần nhất để nắm chủ
đề đang bàn, rồi **chủ động chào 1 lần** — theo khuôn cố định + 1 câu ngữ cảnh
nhẹ. Không cần ai tag. Mỗi nhóm chỉ chào đúng 1 lần.

## Quyết định đã chốt (6 câu)

1. Hướng: **đọc tin cũ → chào có ngữ cảnh** (không chỉ chào suông).
2. Phạm vi: **mọi nhóm được add, TRỪ nhóm trong blocklist**.
3. Đọc **30 tin gần nhất** (rẻ, bám chủ đề hiện tại).
4. Chống nói hớ: **khuôn cố định + tối đa 1 câu ngữ cảnh nhẹ**, guard bằng CODE
   (không tin lời dặn prompt). Cấm nhắc đơn/giá/khiếu nại cụ thể, cấm hứa hẹn.
5. Chào **đúng 1 lần/nhóm, vĩnh viễn** (cờ DB, ghi TRƯỚC khi gửi để chống lặp).
6. Màn chào là **ngoại lệ không cần tag**; các tin SAU vẫn theo luật "phải tag".

## Kiến trúc

### 1. Trigger — nhận diện "bot vừa được add"

Trong `zalo-listener-factory.ts` handler `group_event` (đã có ở ~line 974).
Payload zca-js chuẩn (models/GroupEvent.d.ts):
- `type === 'join'` — có thành viên vào nhóm
- `data.updateMembers[]` — mỗi phần tử `{ id, dName }` = người vừa vào
- `data.groupId`, `data.groupName`

Điều kiện trigger: `type === 'join'` **và** `updateMembers` chứa `id === zaloUid`
của chính account (lấy từ `zalo-pool` instance.zaloUid, hoặc `ZaloAccount.zaloUid`).

Dự phòng khi payload lệch: nếu không xác định được uid bot trong updateMembers
nhưng type='join' ở nhóm **chưa từng chào** → vẫn coi là trigger (vô hại vì mỗi
nhóm chỉ chào 1 lần; blocklist + cờ vẫn chặn lặp).

### 2. Cổng lọc (tuần tự, rớt cái nào → im)

File mới `noi-zalo/chao-nhom.ts`, hàm `chaoNhomKhiThem(deps)`:
1. Resolve orgId + tìm/ tạo Conversation cho nhóm (threadType=group).
2. Nếu `conversation.groupGreetedAt != null` → dừng (đã chào).
3. Nếu `conversation.botGroupBlocked === true` → dừng (blocklist).
4. **Đặt cờ `groupGreetedAt = now()` NGAY** (trước khi gọi LLM/gửi) — chống 2
   event trùng lọt cả hai. Nếu các bước sau lỗi, vẫn không chào lại (chấp nhận:
   thà mất 1 lời chào còn hơn spam).

### 3. Đọc bối cảnh + sinh lời chào

- `api.getGroupChatHistory(groupId, 30)` → gom text 30 tin, bỏ tin của chính bot,
  bỏ tin không phải text (ảnh/sticker), cắt mỗi tin ~200 ký tự.
- Nếu history rỗng/lỗi → chào **khuôn thuần** (không câu ngữ cảnh). Không chặn.
- Gọi LLM (`dungGenerate`, KHÔNG tool-calling) với prompt: "Dựa vào đoạn chat sau,
  viết TỐI ĐA 1 câu ngắn nêu chủ đề nhóm đang quan tâm, hoặc trả rỗng nếu không
  rõ. Cấm nhắc số tiền/đơn/khiếu nại/hứa hẹn." → lấy `cauNguCanh` (có thể rỗng).

### 4. Guard code chống nói hớ (KHÔNG tin LLM)

Hàm `locCauNguCanh(raw)` trong chao-nhom.ts:
- Bỏ nếu chứa từ cấm: số tiền (`\d[\d.,]*\s*(k|đ|vnd|nghìn|triệu)`), "đơn",
  "giá", "khiếu nại", "bồi thường", "hứa", "cam kết", "hoàn tiền", "ship", "cọc".
- Bỏ nếu dài > 120 ký tự hoặc > 1 câu (nhiều dấu chấm/xuống dòng).
- Bỏ nếu chứa số điện thoại / mã đơn (S\d+).
- Còn lại → dùng; rỗng → chào khuôn thuần.

Lời chào cuối = `KHUON_CHAO` (khuôn cố định) + (cauNguCanh đã lọc, nếu có).
`KHUON_CHAO` ví dụ: "Em chào cả nhà ạ 👋 Em là trợ lý của {tenShop}, hỗ trợ tư
vấn sản phẩm và báo giá. Cả nhà cần gì cứ nhắn em nhé!"

### 5. Gửi

`guiTin(dich, loiChao, true)` (giả nhịp người). threadType='group'. Ghi 1
Message senderType='self' để CRM thấy. Log 1 dòng `[chao-nhom] đã chào {groupId}`.

### 6. Ngoại lệ tag

Màn chào KHÔNG đi qua `xuLyTinKhach` (nơi có gate tag). Nó là nhánh riêng từ
`group_event`. Nên không bị gate tag chặn. Các tin nhắn thường SAU đó vẫn qua
`xuLyTinKhach` → vẫn theo luật "phải tag".

## Thay đổi schema

`Conversation`:
- `groupGreetedAt DateTime? @map("group_greeted_at")` — mốc đã chào (cờ 1 lần).
- `botGroupBlocked Boolean @default(false) @map("bot_group_blocked")` — blocklist
  nhóm (bật ở CRM sau; giai đoạn này chỉ cần cột + đọc).

Migration `add_group_greeting`.

## Xử lý lỗi

- getGroupChatHistory lỗi → chào khuôn thuần (đã đặt cờ rồi).
- LLM lỗi/timeout → chào khuôn thuần.
- guiTin lỗi → log warn; cờ đã set nên không thử lại (chấp nhận mất lời chào,
  ưu tiên không spam). Trường hợp này hiếm.

## Test

- `chao-nhom.func.ts`: `locCauNguCanh` bỏ đúng câu có tiền/đơn/giá/sđt/mã đơn/hứa
  hẹn; giữ câu sạch; cắt câu dài. Test guard là chính (đây là chỗ chống nói hớ).
- Test trigger: updateMembers chứa uid bot → true; không chứa + nhóm mới → true
  (dự phòng); nhóm đã greeted → false.

## Không làm (YAGNI)

- KHÔNG UI blocklist trong giai đoạn này (chỉ cột DB + đọc). Thêm sau nếu cần.
- KHÔNG chào lại khi kick-rồi-add (anh chốt 1 lần vĩnh viễn).
- KHÔNG tóm tắt history bằng lượt LLM riêng (chốt: 30 tin, 1 lượt).
