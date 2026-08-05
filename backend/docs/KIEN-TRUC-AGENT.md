# Kiến trúc module Agent

Bản đồ cho người mới vào: đọc file này 10 phút là biết tin nhắn đi đâu, sửa gì
ở file nào, và vì sao code trông như vậy. Mỗi quy tắc ở đây đều rút từ một bug
thật đã trả giá — có ghi ngày để tra lại lịch sử.

## Tin nhắn đi qua đâu

```
Zalo (zca-js)
  │
  ▼
message-handler.ts ─── lưu tin vào DB, rồi rẽ nhánh (fire-and-forget):
  │
  ├─ tin BẤT KỲ ──► noi-zalo/luong-nhan-vien.ts ── xuLyTinNhanVien()
  │                   cổng: công tắc → nhận lệnh → thread → LLM
  │                   (UID nhân viên: MỌI tin là lệnh; nick shop: cần @bot)
  │
  └─ tin KHÁCH ──► laLenhNhanVien()? ─ true → thôi (luồng NV đã nhận)
                     │ false
                     ▼
                   noi-zalo/luong-khach.ts ── xuLyTinKhach()
                     │ true  → xong (RAG cũ PHẢI bỏ qua)
                     │ false → auto-reply-wiring.ts (luồng RAG cũ) đỡ lấy
                     ▼
                   agent chạy vòng lặp tool (loop.ts):
                     LLM → gọi tool (Odoo) → LLM → … → câu trả lời
                     │
                     ▼
                   gui-zalo.ts: tin + ảnh SP + hoá đơn + QR
```

## File nào làm gì

### Lõi agent (`src/modules/ai/agent/`)

| File | Trách nhiệm | Không được chứa |
|---|---|---|
| `types.ts` | kiểu chung: AgentTurn, ToolDefinition… | logic |
| `loop.ts` | vòng lặp LLM↔tool, chạy tool song song | biết gì về Zalo/Odoo |
| `registry.ts` | đăng ký tool, thực thi an toàn | tool cụ thể |
| `staff-command.ts` | cổng BẢO MẬT nhận lệnh NV + prompt NV | gọi mạng |
| `staff-agent.ts` | registry 12 tool NV + `chayLenhNhanVien` | gửi Zalo |
| `customer-agent.ts` | registry 4-6 tool khách + `chayTuVanKhach` + hàng rào chống bịa | gửi Zalo |
| `ghi-log-tool.ts` | ghi ToolCallLog xuống DB, không bao giờ ném | — |

### Lớp nối Zalo (`src/modules/ai/agent/noi-zalo/`)

| File | Trách nhiệm | Bug gốc dẫn tới việc tách |
|---|---|---|
| `cong-tac.ts` | MỌI biến env ở một chỗ, hàm thuần | dò công tắc phải grep cả module |
| `llm.ts` | dựng hàm gọi LLM per-org, ghép URL | URL thiếu `/v1` → 404 âm thầm (04/08) |
| `du-lieu.ts` | Odoo client, lịch sử, tri thức, seq chống trùng | seq đếm log → 2 đơn/1 ý định (04/08) |
| `gui-zalo.ts` | MỌI thứ gửi ra Zalo | logic gửi rải 4 chỗ, sửa sót |
| `dung.ts` | dừng-PHẢI-có-log | 2 cổng im lặng → mất 1 tiếng dò tay (05/08) |
| `bao-nhan-vien.ts` | bot bí → giữ chân khách + báo nhân viên | mọi nhánh bí đều im lặng, khách chờ vô vọng (05/08) |
| `gioi-han.ts` | trần tin/khách TRƯỚC cổng LLM | không có trần → spam 1.000 tin đốt ~200k đ (05/08) |
| `luong-nhan-vien.ts` | handler luồng NV | — |
| `luong-khach.ts` | handler luồng khách + luật nhường RAG | nhường sai → khách nhận câu RAG nói tồn kho (05/08) |
| `../noi-zalo.ts` | barrel re-export — điểm vào DUY NHẤT | — |

**Quy tắc phụ thuộc** (trên được import dưới, không ngược lại):

```
luong-*.ts  →  gui-zalo, du-lieu, llm, dung, cong-tac  →  (shared, odoo, knowledge)
```

`cong-tac.ts` không import gì ngoài chuẩn — vì thế test không cần mock.

## Bảy quy tắc — mỗi cái là một bug đã trả giá

1. **Thoát sớm PHẢI qua `dung(lyDo)`.** Hai cổng im lặng làm mất cả tiếng dò
   tay (05/08). `taoDung` ký kiểu trả `false` — viết cổng mới thiếu lý do là
   không gõ nổi. Grep `"] dừng:"` là ra mọi lần bot im.

2. **Ranh giới bảo mật nằm ở CODE, không ở prompt.** Khách lèo lái được prompt.
   Vì thế: registry khách không có tool công nợ/báo cáo; `isSelf`/UID kiểm ở
   `staff-command.ts`; trần tiền kiểm TRƯỚC khi tạo đơn; `khoeDaLenDon()` chặn
   bot nói "đã lên đơn" khi chưa gọi tool (bot bịa 4 lần liên tiếp, 05/08).

3. **Khoá chống trùng phải bất biến theo retry.** `seqTuMessageId` dẫn xuất từ
   messageId — cùng tin luôn cùng khoá. Đếm-số-lần vi phạm nguyên tắc này
   (04/08: gõ lại lệnh → 2 đơn).

4. **Không tin định dạng của gateway.** OpenRouter chèn khoảng trắng trước JSON
   (05/08 — `docJson`), 9router mặc định trả SSE, Gemini thêm tiền tố
   `default_api.` vào tên tool (05/08 — registry cắt tiền tố), model reasoning
   nhả `<think>` vào content (03/08 — `boSuyNghi`). Mọi chỗ nhận dữ liệu ngoài
   đều phải chịu được rác.

5. **Lỗi sau khi chạm dữ liệu → IM LẶNG, không nhường luồng khác.** Nhường sau
   khi agent đã tra Odoo nghĩa là hai hệ thống nói hai chuyện với cùng một
   khách (05/08). Nhường chỉ hợp lệ khi CHƯA gọi tool nào (`soToolDaChay`).

6. **Một nguồn cấu hình LLM.** `llm.ts` đọc AiConfig/AppSetting — cùng nguồn
   luồng RAG cũ. Ngày nào còn hai nguồn là ngày đó chúng lệch nhau.

7. **Prompt không được tự vi phạm luật của chính nó.** Prompt cấm markdown mà
   chứa 26 dấu `**` → bot bắt chước (05/08). Model học từ cái nó THẤY.

## Debug nhanh

Bot im? — grep theo thứ tự:

```bash
docker logs --since 10m zalo-crm-app | grep '"] dừng:'      # dừng ở cổng nào
docker logs --since 10m zalo-crm-app | grep 'BẮT ĐẦU xử lý'  # có vào handler không
docker logs --since 10m zalo-crm-app | grep '\[agent/'       # toàn bộ vòng đời
```

Bot trả lời sai? — xem nó đã hỏi Odoo gì:

```sql
select created_at, vai, tool_name, thanh_cong, duration_ms, left(output,80)
from tool_call_logs order by created_at desc limit 20;
```

Không có dòng tool nào = model tự bịa, không tra — đối chiếu quy tắc 2.

Máy nào là prod, cổng nào là gì: `docs/HA-TANG.md`.

## Thêm tool mới — 4 bước

1. `odoo/tools/<ten-tool>.ts`: hàm thuần nhận `deps` + `input`, trả kiểu
   `KetQua*` có nhánh lỗi; `dinhDang*()` cho model; `*Definition` có mô tả
   "GỌI KHI…" (model dè dặt nếu chỉ tả tool làm gì). Tool GHI: `mutates: true`.
2. Đăng ký vào `staff-agent.ts` và/hoặc `customer-agent.ts` — nhớ registry
   khách là RANH GIỚI BẢO MẬT, cân nhắc như quy tắc 2.
3. Test func: nhánh lỗi, nhánh rỗng, và MỘT bug thật nếu tool sinh ra từ nó.
4. Cập nhật số đếm tool trong test registry (`đăng ký đủ N tool`).
