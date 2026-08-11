# Kiến trúc module Agent

Bản đồ cho người mới vào: đọc file này 10 phút là biết tin nhắn đi đâu, sửa gì
ở file nào, và vì sao code trông như vậy. Mỗi quy tắc ở đây đều rút từ một bug
thật đã trả giá — có ghi ngày để tra lại lịch sử.

> **Muốn xem SƠ ĐỒ thay vì đọc chữ?** → **[`docs/SO-DO-LUONG.md`](SO-DO-LUONG.md)**
> — 3 sơ đồ Mermaid viết bằng ngôn ngữ nghiệp vụ cho người vận hành: (1) tổng
> quan tin Zalo vào đi đâu ai trả lời, (2) máy gom đơn hỏi gì tiếp theo,
> (3) các cổng chặn và mỗi cái chặn cái gì. File này (KIEN-TRUC-AGENT.md) giữ
> phần chi tiết kỹ thuật: file nào làm gì, quy tắc rút từ bug, cách debug.
> Sửa luồng thì phải sửa CẢ HAI.

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
  │                   │
  │                   ├─ MÁY GOM ĐƠN (gom-don/) chạy TRƯỚC agent thường:
  │                   │    "lên đơn" / phiên đang mở → code quyết quy trình,
  │                   │    LLM chỉ trích slot. Trả false → agent thường xử.
  │                   │    (spec 2026-08-07-luong-len-don-slot-design.md)
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

### Máy gom đơn (`noi-zalo/gom-don/`, spec `2026-08-07-luong-len-don-slot-design.md`)

Vì sao: 4 lần vá prompt trong tối 07/08 mà luồng lên đơn vẫn hỏng kiểu mới
(hỏi lại SL đã có, lặp y hệt câu hỏi — chat 21:07). Quy trình lên đơn giờ do
CODE quyết; LLM chỉ trích slot. Mỗi bug thật = thêm kịch bản vào
`tests/ai/agent/gom-don/replay-07-08.test.ts`, KHÔNG vá prompt.

| File | Trách nhiệm | Không được chứa |
|---|---|---|
| `kieu.ts` | PhienGom, DongGom, HanhDong | logic |
| `buoc-tiep-theo.ts` | bộ não: phiên → hành động kế tiếp (HÀM THUẦN) | I/O |
| `chon.ts` | map "1a"/mã KH/SĐT/mảnh tên → chốt ứng viên | gọi LLM |
| `loi-nhan.ts` | template lời gửi NV, tất định | LLM soạn lời |
| `trich-slot.ts` | LLM trích slot qua 1 tool ép + validate kiểu | quyết quy trình |
| `phien-store.ts` | phiên ở bảng `phien_gom_don`, TTL 15' | logic đơn |
| `index.ts` | orchestrator `xuLyGomDon` — nối tất cả, tra song song | prompt dài |

### Báo cáo qua Zalo (spec `docs/superpowers/specs/2026-08-06-bao-cao-zalo-design.md`)

| File | Trách nhiệm |
|---|---|
| `odoo/tools/don-cho-xac-nhan.ts` | đơn nháp chờ duyệt, đơn già nhất lên đầu |
| `odoo/tools/top-san-pham.ts` | bán chạy / Ế (= còn tồn, 0 bán trong kỳ) |
| `odoo/tools/bao-cao-linh-hoat.ts` | đuôi dài: form đóng → whitelist → Odoo `read_group` tính |
| `odoo/anh-bang.ts` | bảng → ẢNH PNG (SVG→sharp); MẶC ĐỊNH gửi báo cáo dài |
| `odoo/xuat-excel.ts` | dữ liệu → .xlsx; ngưỡng đính kèm 15 dòng |
| `noi-zalo/gui-zalo.ts:guiFile` | gửi file qua zca-js — .xlsx HAY RỚT âm thầm (06/08); nên báo cáo dùng ẢNH |

Ba hàng rào chính xác: Odoo cộng (model không tự cộng) · trả lời số kèm
nguồn + kỳ · rỗng ≠ lỗi ("kỳ này không có dữ liệu"). CHỈ registry nhân viên.

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

8. **Một cổng kiểm MỘT LẦN — kiểm lại với dữ liệu nghèo hơn là tự bắn chân.**
   `chayLenhNhanVien` kiểm cổng nhận lệnh lần hai nhưng chỉ có `content` +
   `isSelf`, KHÔNG có `senderUid` — nên tin từ UID nhân viên không gõ `@bot`
   bị chính nó từ chối, rồi thoát im lặng (05/08, mất một buổi truy). Đã sửa
   bằng cách truyền nội dung ĐÃ qua cổng xuống. Bài học rộng hơn: nhánh
   "không phải việc của tôi" ở TẦNG TRONG phải log — tầng ngoài đã cho qua thì
   tầng trong từ chối là hai cổng bất đồng, tức lỗi lập trình.

9. **Test mock LLM không bắt được lỗi tích hợp.** Mọi e2e cũ đều mock LLM nên
   bug số 8 lọt hết. `noi-zalo-that.e2e.ts` gọi ĐÚNG hàm message-handler gọi
   với LLM + Odoo + DB thật, khoá hai hợp đồng: lượt phải KẾT THÚC (không
   treo) và Zalo phải NHẬN được tin (không im lặng).

## Debug nhanh

Bot im? — grep theo thứ tự:

```bash
docker logs --since 10m zalo-crm-app | grep '"] dừng:'      # dừng ở cổng nào
docker logs --since 10m zalo-crm-app | grep 'BẮT ĐẦU xử lý'  # có vào handler không
docker logs --since 10m zalo-crm-app | grep '\[agent/'       # toàn bộ vòng đời
```

Thấy `BẮT ĐẦU` rồi im, không `XONG` cũng không `dừng`? Log chặng chỉ chỗ chết:
`đã lấy lịch sử` → `đã dựng tri thức — vào LLM` → `XONG`. Dòng cuối cùng thấy
được là chặng cuối cùng chạy xong.

Cách nhanh nhất để biết lỗi ở đâu — chạy code THẬT trong container production
thay vì đoán (đã dùng để tìm ra bug hai-cổng 05/08):

```bash
# viết script gọi thẳng dist/, copy vào rồi chạy
docker cp chan-doan.mjs zalo-crm-app:/app/ && docker exec zalo-crm-app node /app/chan-doan.mjs
```

Import từ `/app/dist/...`, đo mốc thời gian từng chặng. Nhớ `rm` sau khi xong.

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
