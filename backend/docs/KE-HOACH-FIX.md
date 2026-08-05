# Kế hoạch fix 7 vấn đề — mỗi vấn đề một lần research

Sinh từ bản đánh giá khách quan 05/08/2026. Mỗi mục: kết quả research →
cách làm đã chọn (kèm lý do) → các bước cụ thể → tiêu chí xong → ước lượng.

Thứ tự làm đề xuất (rẻ + chặn rủi ro trước): **2 → 6b → 5 → 7 → 1 → 4 → 3 → 6a**.

---

## 1. Độ tin cậy chưa được chứng minh (4/10 — BLOCKING)

**Hiện trạng.** Chưa model nào chạy qua bộ 263 case. Chỉ đo 12 mẫu chọn tool
(gemini-2.5-flash-lite 83%). Không biết bot sai ở đâu, sai bao nhiêu.

**Research.** Chuẩn ngành đánh giá agent ([confident-ai](https://www.confident-ai.com)):
cần CẢ HAI lớp — (a) **offline**: bộ dữ liệu cố định chạy trong CI, chặn hồi quy
trước khi deploy; (b) **online**: chấm điểm mẫu hội thoại thật trong production.
Đánh giá ở 3 tầng: câu trả lời cuối / chuỗi tool (trajectory) / từng lượt.
Agent chết vì lỗi cộng dồn và tool fail im lặng — đúng hai bug ta đã gặp.

**Cách làm chọn.** Offline trước, online sau. Offline dùng bộ case sẵn có;
online tận dụng `tool_call_logs` + `ai_suggestions` đã ghi sẵn.

**Bước làm.**
1. Chia 263 case thành 3 bậc: ~30 case "sống còn" (chốt đơn, giá, trần tiền,
   chống bịa) / ~80 case thường / còn lại là đuôi. Bậc 1 phải đạt 100%.
2. Chấm 3 tầng cho mỗi case: đúng tool được gọi? đúng thứ tự? câu cuối đạt?
   (đã có sẵn khung so sánh tool trong lần đo 12 mẫu — mở rộng nó).
3. Chạy bậc 1 (~30 case) trước — chi phí ~4k đ, vừa túi $0.60 OpenRouter.
   Chạy đủ 263 case (~8k đ) **cần anh duyệt nạp thêm tiền**.
4. Script `npm run eval:agent` + ghi kết quả vào file JSON theo ngày để so
   giữa các lần sửa prompt.
5. Online: cron tuần đọc `tool_call_logs`, đếm % lượt có tool fail, % lượt
   `chua_hoan_tat`, % lượt im lặng — in báo cáo vào Telegram (dùng hạ tầng ở mục 5).

**Xong khi.** Bậc 1 đạt 100%, tổng ≥90%; con số hiển thị được sau mỗi lần đổi prompt.
**Ước lượng.** 1–2 ngày code + tiền chạy eval (chờ duyệt).

---

## 2. Khách có thể nhận SỰ IM LẶNG khi bot bí

**Hiện trạng.** `luong-khach.ts` khi `chua_hoan_tat` hoặc lỗi sau tool → im lặng
hoàn toàn. Nhân viên KHÔNG được báo — khách chờ vô vọng nếu nhân viên không mở CRM.

**Research.** Chuẩn handoff ([eesel](https://www.eesel.ai), [cresta](https://cresta.com),
[gleap](https://gleap.io)): (a) KHÔNG BAO GIỜ để khách rơi vào im lặng — luôn có
một câu giữ chân; (b) khách xin gặp người = chuyển NGAY, không hỏi lại;
(c) gói ngữ cảnh cho nhân viên: khách là ai, hỏi gì, bot đã tra gì, kẹt ở đâu;
(d) ngoài giờ: hẹn giờ phản hồi cụ thể thay vì hứa suông.

**Cách làm chọn.** Giữ nguyên nguyên tắc "không để hai hệ nói hai chuyện",
nhưng thay IM LẶNG bằng: một câu giữ chân + báo nhân viên kèm gói ngữ cảnh.
Tận dụng `ghiNhanChuyenSale` đã có sẵn trong `customer-agent.ts` — hiện chỉ log.

**Bước làm.**
1. `noi-zalo/bao-nhan-vien.ts` mới: gửi tin vào thread nhân viên/nhóm sale
   (env `AI_AGENT_THREAD_BAO_SALE`) với gói ngữ cảnh: tên khách, sđt, 3 tin
   cuối, tool đã chạy, lý do kẹt, link CRM.
2. Ba điểm nối trong `luong-khach.ts`:
   - `chua_hoan_tat` → gửi khách "Dạ anh/chị chờ em chút, em kiểm tra rồi báo
     lại ngay ạ" + báo nhân viên. (Câu này KHÔNG hứa nội dung — không vi phạm
     `khoeDaLenDon`.)
   - catch sau tool → tương tự.
   - `ghiNhanChuyenSale` (bot chủ động xin chuyển) → báo nhân viên thật.
3. Chống spam báo: mỗi conversation chỉ báo 1 lần / 10 phút.
4. Test func: 3 điểm nối đều gọi báo; báo lỗi không làm vỡ luồng trả khách.

**Xong khi.** Không còn nhánh code nào kết thúc mà khách không nhận gì và
nhân viên không biết gì. **Ước lượng.** Nửa ngày. Làm ĐẦU TIÊN — rẻ nhất, đỡ mất khách nhất.

---

## 3. Hai hệ trả lời song song (nợ lớn nhất kiến trúc)

**Hiện trạng.** Agent + luồng RAG cũ (auto-reply-wiring) cùng sống; luật tồn kho
nằm ở 6 file; hai nguồn prompt; hai đường gửi Zalo.

**Research.** Strangler fig ([Microsoft](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig),
[techdebt.best](https://techdebt.best/playbooks/strangler-fig/)): façade định tuyến
giữa cũ/mới, dồn traffic dần, đo parity, chỉ xoá hệ cũ khi metric xác nhận —
kill switch là khả năng quay về hệ cũ tức thì. **Ta ĐÃ CÓ đủ hạ tầng này**:
message-handler là façade, env switch là kill switch, `soToolDaChay` là luật nhường.

**Cách làm chọn.** Không viết thêm hạ tầng — chỉ chạy đúng trình tự strangler:
đo → chuyển hết → để nguội → xoá. KHÔNG xoá gì trước khi mục 1 (eval) có số.

**Bước làm.**
1. Đếm thực tế: bao nhiêu % tin khách đang rơi xuống RAG cũ (grep log
   `nhường luồng cũ` 7 ngày). Nếu ~0% thì hệ cũ đã chết lâm sàng rồi.
2. Sau khi eval bậc 1 đạt 100% (mục 1): sửa các đường nhường còn lại thành
   báo-nhân-viên (mục 2) thay vì rơi xuống RAG — RAG cũ hết đường vào.
3. Để nguội 2 tuần, theo dõi log. Kill switch vẫn là `AI_AGENT_KHACH=0`.
4. Xoá theo lớp: auto-reply-wiring → rag-reply → intent/industry-prompts.
   Mỗi lớp một commit riêng để revert được từng phần.
5. Dồn luật tồn kho về MỘT file (`cong-tac.ts` hoặc file luật riêng) TRƯỚC khi
   xoá — không được để luật chỉ còn sống trong file sắp xoá.

**Xong khi.** Một tin khách chỉ có đúng MỘT hệ trả lời; grep "tồn kho" ra 1 nơi.
**Ước lượng.** 1 ngày code + 2 tuần để nguội. Làm SAU mục 1 và 2.

---

## 4. Prompt đắt (3.009 token/lượt) và mong manh

**Research.** [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching):
Gemini implicit caching TỰ ĐỘNG khi prefix ≥1.024 token **giống hệt từng ký tự**
giữa các lần gọi; token cache đọc giá 0,25x — tổng thể rẻ hơn 60–80%.
OpenRouter tự quản cache Gemini, không phải khai báo gì. Điều kiện duy nhất:
phần đầu prompt bất biến, phần động (tên khách, lịch sử, tri thức) dồn về CUỐI.

**Cách làm chọn.** KHÔNG nén trước (nén đổi chữ = vỡ cache = đắt hơn).
Sắp xếp lại để ăn cache trước — được 60–80% mà không đổi một chữ nội dung.
Nén chỉ làm sau, nếu vẫn cần, và phải qua eval mục 1.

**Bước làm.**
1. `customer-agent.ts`: tách prompt thành [phần TĨNH: luật + persona + mô tả
   tool] đứng đầu, [phần ĐỘNG: bizName, tri thức, tên khách] xuống cuối system
   prompt hoặc xuống message. Kiểm tra phần tĩnh ≥1.024 token (hiện ~3.009 —
   thừa).
2. Chú ý bẫy: `bizName` đang nằm đầu prompt → phá cache mọi lượt. Tool
   definitions cũng phải cùng thứ tự mọi lần gọi.
3. Đo thật: 10 lượt liên tiếp, xem `cached_tokens` trong response usage của
   OpenRouter; kỳ vọng lượt 2+ có cache hit.
4. (Sau, tuỳ chọn) nén phần tĩnh xuống ~1.200 token — CHỈ khi eval mục 1 chạy
   lại vẫn đạt ngưỡng.

**Xong khi.** `cached_tokens > 0` ổn định từ lượt 2; chi phí/lượt giảm ≥50%.
**Ước lượng.** Nửa ngày. Độc lập, làm được bất cứ lúc nào sau mục 1 có baseline.

---

## 5. Vận hành mù — không cảnh báo, disk 92%, rác

**Research.** Cho MỘT máy Docker, chuẩn gọn nhất 2026 là
[Uptime Kuma](https://github.com/louislam/uptime-kuma) ([hướng dẫn Telegram](https://blog.zulfahmy.net/blog/setup-uptime-kuma-with-telegram-alerts-using-docker/)):
50–200 MB RAM, monitor được HTTP/container Docker/disk qua push, báo Telegram
tức thì, check mỗi 60s. Không cần Prometheus/Grafana cho quy mô này.

**Cách làm chọn.** Uptime Kuma trên gnha-inco + bot Telegram. Kèm dọn rác một lần.

**Bước làm.**
1. Dọn NGAY (disk 92% là bom hẹn giờ): `docker system prune` container/image
   rác đã nhận diện, xoá stack thử tạo nhầm, `docker logs` quá cỡ → gắn
   `max-size` vào compose. Mục tiêu <75%.
2. Uptime Kuma container (cổng nội bộ, sau tunnel). Monitor: CRM :3080 /
   Odoo prod (gnha-crm-dev) / Odoo test :8069 / Dokploy :3000 / container
   zalo-crm-app (Docker monitor) / disk (push monitor + cron script 1 dòng).
3. Bot Telegram qua BotFather, nối vào Uptime Kuma, kéo anh vào group nhận báo.
4. Ghi vào `docs/HA-TANG.md`: URL Kuma, chỗ đổi cấu hình báo.
5. Embedding chết (score 0.00): chỉ TẮT đường gọi + ghi chú — sửa hay xoá hẳn
   quyết sau mục 3 (nó thuộc hệ RAG cũ).
6. 22 script one-off: dồn vào `scripts/archive/`, giữ lại cái nào còn chạy cron.

**Xong khi.** Rớt container/đầy disk/sập web → Telegram kêu trong ≤2 phút.
**Ước lượng.** Nửa ngày. Làm sớm — không code, toàn lợi.

---

## 6. Rủi ro nền tảng: zca-js bị ban + spam đốt tiền LLM

**Research.** [SECURITY.md của zca-js](https://github.com/RFS-ADRENO/zca-js/blob/main/SECURITY.md)
xác nhận thẳng: dùng có thể bị khoá tài khoản Zalo; giảm rủi ro = tôn trọng
nhịp gửi (ta đã có humanPace), không gửi ồ ạt. Không có thuốc tiên — rủi ro
này chỉ GIẢM được, không xoá được. Rate limit chống cost-DoS thì không ai làm
hộ — phải tự làm trong code.

**Cách làm chọn.** Chia đôi: (6b) rate limit — làm ngay, rẻ; (6a) giảm rủi ro
ban — quy trình + phương án lùi.

**Bước làm — 6b (rate limit, làm trước).**
1. `noi-zalo/gioi-han.ts`: đếm tin/khách trong cửa sổ trượt (Map trong RAM là
   đủ — một tiến trình). Env: `AI_AGENT_MAX_TIN_GIO=15`, `AI_AGENT_MAX_TIN_NGAY=60`.
2. Quá giờ → bot trả 1 câu duy nhất "em xin phép trả lời sau ạ" rồi im +
   báo nhân viên (mục 2). Quá ngày → im + báo. KHÔNG gọi LLM nữa — chặn TRƯỚC
   cổng LLM trong `luong-khach.ts`, qua `dung()` để có log.
3. Test: 16 tin/giờ → tin 16 không tạo request LLM.

**Bước làm — 6a (giảm rủi ro ban).**
1. Giữ humanPace mọi tin gửi khách (đã có); thêm jitter nếu chưa.
2. Số điện thoại đăng nhập Zalo dự phòng + quy trình khôi phục session ghi vào
   `docs/HA-TANG.md` (mất nick = mất kênh bán).
3. Theo dõi: nếu Zalo OA (API chính thức) khả thi về giá cho shop → cân nhắc
   sau, KHÔNG làm bây giờ.

**Xong khi.** 1.000 tin spam tốn đúng 15 lượt LLM/giờ; quy trình mất-nick có giấy tờ.
**Ước lượng.** 6b: nửa ngày. 6a: 1 giờ viết quy trình.

---

## 7. Năm file test bảo mật đỏ vĩnh viễn

**Hiện trạng.** 5 file cần DB thật, đỏ trên máy không có DB → `npm test` không
bao giờ xanh toàn phần → người ta quen mắt bỏ qua màu đỏ = mù hồi quy thật.

**Research.** Vitest chuẩn ([docs](https://vitest.dev/api/test)): 
`test.runIf(dieuKien)` / `describe.skipIf(...)` — skip có điều kiện theo env,
hiện SKIP (vàng) thay vì FAIL (đỏ). Có thể gói thành helper dùng lại
([pattern](https://zenn.dev/terrierscript/articles/2023-04-21-vitest-skipif-runif)).

**Cách làm chọn.** Helper `testCanDb` + tách lệnh chạy. Không dời file, không
sửa nội dung test.

**Bước làm.**
1. `tests/helpers/can-db.ts`: `export const coDb = !!process.env.DATABASE_URL_TEST;`
   `export const describeCanDb = describe.skipIf(!coDb);`
2. 5 file đổi `describe` → `describeCanDb` (sửa 1 dòng import + 1 dòng khai báo mỗi file).
3. `package.json`: `test` (mặc định, skip DB) và `test:db` (đòi DB, chạy trong
   CI/máy có DB). CI nào có DB thì PHẢI chạy `test:db` — skip không phải là quên.
4. README test: ghi rõ vì sao skip, chạy full thế nào.

**Xong khi.** `npm test` xanh 100% trên máy trần; 5 file hiện "skipped" có lý do;
máy có DB chạy `test:db` xanh. **Ước lượng.** 1–2 giờ. Rẻ nhất danh sách.

---

## Tổng chi phí & thứ tự

| Thứ tự | Mục | Công | Tiền |
|---|---|---|---|
| 1 | #2 báo nhân viên thay im lặng | 0,5 ngày | 0 |
| 2 | #6b rate limit | 0,5 ngày | 0 |
| 3 | #5 Uptime Kuma + dọn disk | 0,5 ngày | 0 |
| 4 | #7 test skipIf | 1–2 giờ | 0 |
| 5 | #1 eval bậc 1 (30 case) | 1–2 ngày | ~4k đ (đủ $0.60) |
| 6 | #4 sắp prompt ăn cache | 0,5 ngày | 0 (tiết kiệm 60–80%) |
| 7 | #3 khai tử RAG cũ | 1 ngày + 2 tuần nguội | 0 |
| 8 | #6a quy trình chống ban | 1 giờ | 0 |
| — | #1 eval đủ 263 case | — | ~8k đ — **chờ anh duyệt** |
