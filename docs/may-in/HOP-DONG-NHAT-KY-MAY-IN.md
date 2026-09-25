# Hợp đồng: báo sự cố máy in + nhật ký máy in (v4, 25/09/2026)

> v3 = v2 + sửa sau vòng giám sát 1. v4 = v3 + sửa sau vòng giám sát 2. Mỗi vòng có 3 giám sát độc lập, một trong số đó chạy harness kịch bản đầu-cuối trên mã thật. Chỗ đổi đánh dấu **[v3]** / **[v4]**.

Chủ giao: *"nếu hết giấy, kẹt giấy, lỗi không in được thì cần báo log về zalocrm; trong phần Máy in cần có log cho toàn bộ,
search dễ dàng; app trên Windows cần báo ngay nếu có lỗi liên quan"*.

Ba phần làm song song theo **đúng** hợp đồng này:
- **backend**: `ZaloCRM/backend`, nhánh `feat/ten-file-in`;
- **app PC**: `print-agent`, nhánh `feat/ten-file-in`;
- **giao diện**: `ZaloCRM/frontend`, trang `PrintAgentsPage.vue`.

Mọi tên biến/hàm mới viết **tiếng Việt không dấu**, theo lối mã sẵn có.

## 0. Bất biến KHÔNG ĐƯỢC PHÁ

1. **Chống in đôi.** `loi` = backend sẽ gửi lại. App chỉ gửi `loi` khi **chắc chắn không một byte nào của job đã rời máy tính tới máy in**. **[v3]** Cụ thể là cả ba điều kiện sau, xét lúc thấy lỗi **và** xét lại sau khi tạm dừng job:
   - chưa từng thấy `PRINTING`;
   - `PagesPrinted = 0`;
   - cờ job không có `ERROR`, `PAPEROUT`, `USER_INTERVENTION`, `RESTART`, `PRINTING`, `PRINTED`, `DELETING`, `DELETED`, `OFFLINE`, `COMPLETE`. Tức là job chỉ đang `SPOOLING`, `PAUSED`, `BLOCKED_DEVQ` hoặc không có cờ nào.

   Khi đủ ba điều kiện mà máy in (cấp máy) đang báo sự cố chặn in, hoặc job có `BLOCKED_DEVQ`: tạm dừng job → đọc lại → xoá → kiểm đã hết → `loi`.
   - **Chỉ xoá khi đã hết cửa sổ theo dõi 15 s** mà job vẫn còn sạch. Cờ cấp máy có thể báo sai dai dẳng trong khi máy vẫn in được, ví dụ khay khác hết giấy hoặc SNMP báo sai. Nếu máy in được thật, job sẽ chuyển sang `PRINTING` trong 15 s đó và không còn bị xoá.
   - Cầu dao ở backend (§3.1) giữ các job sau, nên mỗi lần máy lỗi chỉ tốn một cửa sổ 15 s.
   - **[v4] Cờ nền.** App chụp cờ CẤP MÁY ở lần đọc đầu tiên của job. Mã sự cố đã có sẵn trong ảnh chụp đó không được tính chống lại job.
     - Ví dụ thật: máy HP 4003 qua WSD ở HN bật `ERROR` suốt mà vẫn in được.
     - Job `PRINTING` rồi rời hàng đợi sạch → `da_in`, dù cờ nền vẫn còn.
     - Chỉ sự cố cấp máy **mới** xuất hiện sau ảnh chụp mới làm job thành `khong_ro` (kể cả ở bước đọc thêm ~2 s sau khi job rời hàng đợi).
     - Cờ trên chính job vẫn tính như cũ.
   - **[v4] Không dồn hoá đơn sau job kẹt.** Nhận job mới mà hàng đợi có job (của app hay chương trình khác, không `DELETING`) mang `PAPEROUT`/`ERROR`/`OFFLINE`/`USER_INTERVENTION`, hoặc danh sách theo dõi tiếp có job của mình đang kẹt: app **không in** và trả ngay `loi` với mã của job kẹt.
     - An toàn vì chưa byte nào rời máy.
     - Ngoại lệ: job kẹt chỉ vì `BLOCKED_DEVQ` (lỗi riêng một job) thì vẫn in.
     - Job kẹt chỉ mang cờ chung chung (`loi_may_in`) thì báo **`can_xu_ly`**. Hoá đơn bị từ chối không hỏng gì, còn `loi_may_in` thì tiêu lượt thử: cứ ~15 phút một hoá đơn vô tội sẽ thành `that_bai`.
     - **[v4, vòng 3]** Không coi là job kẹt: `PAUSED` (NV tạm dừng job kẹt, hàng đợi vẫn in job sau), `PRINTED`, `COMPLETE`, `RETAINED`, `DELETING`, `DELETED`. Mã kẹt nhớ từ theo dõi tiếp chỉ dùng khi chưa quá 60 s.
     - **[v4, vòng 3]** Chỉ từ chối khi kết nối hiện tại đã nhận `cau-hinh`. Backend cũ không có cầu dao, mỗi lần từ chối sẽ tiêu một lượt.
   - **[v4, vòng 3] Máy in không tồn tại** (đổi tên trong Windows, `ERROR_INVALID_PRINTER_NAME` lúc kiểm trước khi in) → `loi(khong_tim_thay_may_in)` ngay, không gọi Sumatra. Mã này không tiêu lượt: hoá đơn chờ tới khi NV chọn lại máy in rồi tự in.
   - **[v4, vòng 3] Cờ nền chụp TRƯỚC khi gọi Sumatra.** Sự cố bắt đầu trong lúc Sumatra chạy là sự cố mới, không phải nền.
   - **[kiểm cuối] Sự cố NỀN không bao giờ là lý do xoá job.** Luật xoá ở trên chỉ tính sự cố cấp máy **mới**.
     - Job sạch chờ hết 15 s mà máy chỉ báo sự cố nền → `khong_ro(<mã nền>)`, job nằm lại và được theo dõi tiếp. Mã nền giúp backend ngắt cầu dao.
     - Ca thật: máy WSD ngủ + `ERROR` nền, job cần hơn 15 s mới bắt đầu in. Bản trước xoá job → gửi thử → lại xoá trước khi máy kịp thức → lặp vô hạn.
   - **[kiểm cuối]** Theo dõi tiếp: job còn **kẹt** ở lần cuối thấy nó rồi biến mất mà không lần đọc nào thấy in sạch. Tình huống này có thể là nạp giấy rồi máy in nốt rất nhanh, hoặc NV xoá tay. App vẫn báo `da_in` (không báo động giả mỗi lần nạp giấy) nhưng kèm `loiCuoi` "In xong sau khi hết sự cố … nếu cửa hàng đã xoá tay hàng đợi máy in thì kiểm lại". Backend ghi dòng này ở mức `canh_bao`.
   - **[v4, vòng 3] Job sạch bị gỡ vì `ERROR` chung chung cấp máy** → báo `can_xu_ly`. `loi_may_in` chỉ còn cho `BLOCKED_DEVQ` (lỗi riêng một job). Với mọi mã **tiêu lượt**, câu trên dải và nhật ký KHÔNG hứa "TỰ in lại" mà nói "thử lại vài lần; nếu vẫn lỗi sẽ báo thất bại".
   - **[v4, vòng 3] In nhiều bản (copies>1) thiếu bản** (bản sau bị gỡ sạch) → `khong_ro`, `conTrongHangDoi:false`, câu "Đã in k/n bản — bản còn lại CHƯA in (đã gỡ khỏi hàng đợi)". Không trả `loi`, vì gửi lại sẽ thừa tờ.
     - Trước đây job mới xếp sau job kẹt, hết 15 s thành `khong_ro(khong_xac_nhan)` với câu "kiểm rồi mới in lại". Quản lý in lại, job tự in → 2 tờ.
   - **[v4]** Vòng kiểm sau lệnh xoá: nếu thấy job của ta đã bắt đầu in thì trả `khong_ro` (không `loi`). Sau lệnh tạm dừng, chờ ≥500 ms rồi mới đọc lại.

   Mọi ca khác đều ra `khong_ro` và **để job nằm lại** hàng đợi, không xoá. Nó tự in khi hết lỗi, và app theo dõi tiếp để báo `da_in` trễ (§4).
   - Vì sao: cờ `PAPEROUT`/`ERROR` do port monitor bật **trong lúc đang gửi byte**. Máy in mạng có thể đã đệm một phần, xoá rồi gửi lại là in đôi.
   - Tương tự, máy in báo lỗi mà job không còn trong hàng đợi (có thể đang nằm trong bộ nhớ máy in) cũng là `khong_ro`.
2. **Ghi nhật ký không bao giờ chặn việc in.** Mọi ghi `print_logs` là fire-and-forget, có `catch`; bảng chưa tồn tại thì chỉ `logger.warn`.
3. **Không lộ token máy in** vào nhật ký, API hay giao diện: chỉ lưu `may_in_id` và `may_in_ten`.
   - **[v3]** Id job gửi app có dạng `<ms>-<n>`, **không chứa token**. Id nằm trong tên file, nên trước đây token hiện ở hàng đợi Windows, trên web của máy in, và lọt về ZaloCRM qua `loiCuoi`.
   - Backend che token trong mọi chữ app gửi lên (`loiCuoi`, `chiTiet`, `mayIn`, `thong-tin-app`) trước khi dùng.
   - `nhat-ky.ts` che lần cuối trước khi lưu (`cheToken`). **[v4]** Che **trước**, cắt độ dài **sau**, để token vắt qua mép cắt không lọt nửa đầu.
   - **[v4]** Id job gửi app có dạng `<printJobId>-<ms>`; không có id thì dùng `<ms>-<n>`.
     - `printJobId` là id của `print_jobs`: **UUID** trên prod (Hermes chèn `uuid4`, in lại tay dùng `gen_random_uuid()`) hoặc cuid (mặc định Prisma).
     - Tách bằng `^(.+)-(\d{13})$`, rồi kiểm phần đầu phải là UUID hoặc cuid.
     - Nhờ vậy kết quả hay sự cố **trễ** vẫn tìm được đúng dòng `print_jobs` sau khi backend khởi động lại (mỗi lần deploy).
     - Backend chỉ nhận khi dòng đó thuộc **đúng máy** gửi lên: token trùng, hoặc `NULL` = máy mặc định env.
     - Ngữ cảnh job trong bộ nhớ cũng gắn token. App của máy/org khác đoán được id cũng không đổi được `print_jobs` của org này, và không đọc được hoá đơn hay tên khách.
4. **Tương thích hai chiều:**
   - backend mới + app cũ → app bỏ qua event lạ, in như cũ;
   - backend cũ + app mới → app không nhận `cau-hinh` nên **không** gửi `khong_ro`. Backend cũ hiểu mọi `trangThai` khác `loi` là đã in, nên gửi `khong_ro` cho nó là sai.
   - **[v4] LÙI THEO THỨ TỰ NGƯỢC: lùi APP trước, rồi mới lùi backend.** App 0.2.0 chạy với backend cũ rơi đúng vào ca treo 13.1.
   - **[v3] TRIỂN KHAI BACKEND TRƯỚC APP.**
     - Lý do: với backend cũ, app mới im lặng ở ca `khong_ro`, mà backend cũ chờ không có hạn, nên cron treo (13.1). Ca `khong_ro` ở app mới nhiều hơn app cũ (luật §0.1 chặt hơn).
     - App thấy server cũ (không có `cau-hinh` sau 10 s) thì hiện dòng nhỏ "Server ZaloCRM bản cũ — cần cập nhật server trước".
5. Không đổi payload `job` đã chốt: `{id, name, pdfBase64, paperSize, tray, copies}`.

## 1. Mã sự cố / trạng thái máy in (dùng chung ba phần)

| mã (`loai`) | Nhãn tiếng Việt (giao diện, app) | Mức |
|---|---|---|
| `het_giay` | Hết giấy | `loi` |
| `ket_giay` | Kẹt giấy | `loi` |
| `offline` | Máy in offline / mất kết nối máy in | `loi` |
| `mo_nap` | Nắp máy in đang mở | `loi` |
| `het_muc` | Hết mực / sắp hết mực | `canh_bao` |
| `can_xu_ly` | Máy in cần người xử lý | `loi` |
| `loi_may_in` | Máy in báo lỗi | `loi` |
| `khong_tim_thay_may_in` | Không tìm thấy máy in trong Windows | `loi` |
| `loi_sumatra` | Không gọi được / SumatraPDF lỗi | `loi` |
| `loi_pdf` | File PDF hỏng | `loi` |
| `khong_xac_nhan` | Đã gửi máy in nhưng không xác nhận được đã in | `loi` |
| `binh_thuong` | Máy in bình thường (đã hết sự cố) | `thong_tin` |

Ánh xạ Win32 (app):
- `PRINTER_STATUS_*`:
  - `PAPER_OUT`, `PAPER_PROBLEM` → `het_giay`;
  - `PAPER_JAM` → `ket_giay`;
  - `OFFLINE`, `NOT_AVAILABLE`, `SERVER_UNKNOWN` → `offline`;
  - `DOOR_OPEN` → `mo_nap`;
  - `NO_TONER`, `TONER_LOW` → `het_muc`;
  - `USER_INTERVENTION` → `can_xu_ly`;
  - `ERROR` → `loi_may_in`.
- `JOB_STATUS_*`:
  - `PAPEROUT` → `het_giay`;
  - `OFFLINE` → `offline`;
  - `USER_INTERVENTION` → `can_xu_ly`;
  - `ERROR`, `BLOCKED_DEVQ` → `loi_may_in`.
- Nhiều cờ cùng lúc: lấy theo thứ tự ưu tiên của bảng (`het_giay` > `ket_giay` > `offline` > `mo_nap` > `can_xu_ly` > `loi_may_in` > `het_muc`).
- **[v3]** Ánh xạ thêm:
  - `PRINTER_STATUS_PAUSED` → `can_xu_ly` ("Hàng đợi máy in đang tạm dừng");
  - `PRINTER_INFO_2.Attributes` có `WORK_OFFLINE` → `offline` ("Use Printer Offline").
- **[v3]** Cờ chung chung (`loi_may_in`/`can_xu_ly`, hoặc job chỉ có `ERROR`) thì app suy thêm từ chữ trạng thái của driver (`pStatus`, Anh + Việt):
  - "paper out/hết giấy" → `het_giay`;
  - "jam/kẹt" → `ket_giay`;
  - "door/cover open" → `mo_nap`;
  - "toner low" → `het_muc`;
  - "offline" → `offline`.

  Lý do: máy HP qua cổng WSD có thể chỉ bật `ERROR`.
- **[v3] Mã cấp MÁY và mã cấp JOB.**
  - `loi_sumatra`, `loi_pdf`, `khong_xac_nhan` là chuyện của một job: không đổi chip tình trạng máy, không ngắt cầu dao.
  - Các mã còn lại mô tả máy in.
  - "Chặn in" = mọi mã mức `loi` cấp máy (`het_giay`, `ket_giay`, `offline`, `mo_nap`, `can_xu_ly`, `loi_may_in`, `khong_tim_thay_may_in`).
  - **[v4] "Không tiêu lượt thử"** = chặn in **trừ `loi_may_in`**.
    - `loi_may_in` là lỗi chung chung, gồm cả `BLOCKED_DEVQ` ("driver không in được job này"). Nó vẫn tiêu lượt, để một job hỏng thật không lặp "gỡ → gửi lại" mãi.
    - Cầu dao vẫn ngắt với mọi mã chặn in.
  - **[v4]** Chữ driver nói kẹt ("jam", "kẹt") thì mã `het_giay` (cờ `PAPEROUT`/`PAPER_PROBLEM` chung chung) chuyển thành `ket_giay`.

## 2. Socket.io namespace `/print-agent`

### Backend → app
- `job` — **không đổi**: `{loai:"in", job:{id, name, pdfBase64, paperSize, tray, copies}}`.
- `cau-hinh` — **mới**, gửi ngay khi app kết nối xong: `{hoTro: ["khong_ro", "su_co", "trang_thai_may_in"]}`. App nhớ theo **từng kết nối**, và quên khi kết nối lại.

### App → backend
- `ket-qua` — **mở rộng**: `{jobId, trangThai: "da_in"|"loi"|"khong_ro", loiCuoi?, loai?}`.
  - `loai` = mã ở §1 khi biết nguyên nhân.
  - `khong_ro` **chỉ** gửi khi `cau-hinh.hoTro` có `"khong_ro"`; nếu không thì im lặng như trước.
- `su-co` — **mới**, gửi **NGAY** khi quan sát lần đầu một sự cố trong lúc in một job (không chờ hết 15 giây theo dõi): `{jobId, loai, chiTiet?, mayIn, luc}`.
  - Mỗi (job, loai) **gửi một lần**.
  - Chỉ gửi khi `hoTro` có `"su_co"`.
- `trang-thai-may-in` — **mới**, gửi khi kết nối xong (trạng thái hiện tại) và **mỗi khi đổi** trạng thái máy in: `{trangThai, chiTiet?, mayIn, luc}`.
  - `trangThai` là mã ở §1, gồm cả `binh_thuong`.
  - App tự đọc trạng thái máy in định kỳ **mỗi 20 giây** khi rảnh (và mỗi lần theo dõi job).
  - Chỉ gửi khi `hoTro` có `"trang_thai_may_in"`.
- `thong-tin-app` — **mới**, gửi khi kết nối xong: `{phienBan, mayIn, khay, khoGiay, may}`.
  - `may` = tên máy tính.
  - Backend ghi nhật ký `app_ket_noi` kèm thông tin này. Không cần `hoTro`: backend cũ bỏ qua event lạ.

`luc` = ISO-8601 UTC. `mayIn` = tên máy in Windows app đang dùng.

**[v3] Gửi qua kết nối HIỆN TẠI + hộp thư đi.**
- App gửi `ket-qua`, `su-co`, `trang-thai-may-in` bằng socket của kết nối **hiện tại**. Thư viện tự nối lại sẽ thay socket bên trong, nên emit trên socket cũ hỏng mà không báo lỗi.
- Gửi hỏng thì cất vào hộp thư đi (tối đa 200 mục). Khi kết nối mới gửi `cau-hinh`, app lọc lại hộp thư theo `hoTro` mới rồi gửi.

**[v4] `ket-qua` khong_ro mang `conTrongHangDoi: bool`** (tuỳ chọn):
- `true`: lúc kết luận, job vẫn trong hàng đợi Windows và đã giao cho theo dõi tiếp. Backend ghi "còn trong hàng đợi máy in — sẽ tự in ra, app theo dõi và báo khi in xong — KHÔNG in lại".
- `false`: job không còn trong hàng đợi, có thể nằm trong bộ nhớ máy in. Backend ghi "có thể đang nằm trong bộ nhớ máy in — khắc phục xong đợi vài phút, chỉ in lại nếu vẫn không thấy ra".
- Vắng: câu cũ.

**[v4] Theo dõi tiếp mất dấu.** Job biến khỏi hàng đợi mà không đủ bằng chứng đã in (bị xoá tay hoặc huỷ), hoặc quá 12 giờ: app gửi `su-co {jobId, loai:"khong_xac_nhan", chiTiet:"… không còn trong hàng đợi Windows mà app không thấy in … in lại nếu chưa có"}`. Trước đây chỉ ghi file, nên ZaloCRM vẫn giữ câu "sẽ tự in ra" trong khi hoá đơn đã mất.

**[v4, vòng 3] Chỉ websocket.** App ép `TransportType::Websocket`.
- Trên polling, rust_socketio 0.6 không gọi callback khi engine đóng: luồng poll quay rỗng 100% CPU, `da_noi` kẹt `true`, cổng gửi chết. Giám sát đo bằng server socket.io thật: 1/23 lần nối lại rơi về polling.
- Mạng chặn websocket thì app **không nối được**. Nhật ký ghi rõ "app chỉ dùng websocket".
- Cloudflare Tunnel hỗ trợ websocket.

**[v4] Kết nối.**
- App tắt tự nối lại của rust_socketio (`.reconnect(false)`). Lý do: backoff của thư viện hết sau 15 phút rồi quay rỗng 100% CPU, và client đã "nghỉ" vẫn tự nối lại thành kết nối ma. App tự nối lại với backoff 1→30 s kèm jitter.
- Mutex một bản `Global\print-agent-lednelia`.
- Danh sách theo dõi tiếp sống qua lần bấm Lưu. Lúc khởi động, app nhận lại job `AI-`/`print-agent-` còn trong hàng đợi.
  - **[vòng 3]** Chỉ nhận job có `pMachineName` là chính máy này (hàng đợi có thể chia sẻ `\\PC\may`), và id tách từ tên file phải đúng dạng backend (uuid/cuid/`<ms>-<n>`/token cũ).
- **[vòng 3]** Bấm Lưu giữ nguyên trạng thái (cùng `Arc`), chỉ đổi cấu hình. Client bị thay thế tự nghỉ ngay lúc `open`, không đăng ký nhận job.
- **[vòng 3]** Dải cảnh báo giữ tối đa 5 ô chưa xử lý. Hiện ô mới nhất kèm "(+N cảnh báo khác)". Mỗi ô tự tắt theo luật của chính nó.
  - **[kiểm cuối]** Ô gộp theo **số hoá đơn**, vì mỗi lượt gửi thử có id job mới. Vượt trần thì bỏ ô `loi` cũ nhất trước.

**[v3] `ket-qua` trễ** là hợp lệ và được mong đợi:
- job app báo `khong_ro` vẫn nằm trong hàng đợi Windows được app **theo dõi tiếp** (tối đa 12 giờ);
- khi job in xong, app gửi `ket-qua {jobId, trangThai:"da_in"}`;
- backend cập nhật job `khong_ro` thành `da_in` (§3.1).

## 3. Backend

### 3.1 Sửa lỗi dừng hệ thống (13.1) và đói hàng đợi (13.2)
- `AgentRegistry.guiJob` chờ tối đa `AI_MAY_IN_CHO_KET_QUA_MS` (mặc định **90 000**). Hết giờ thì reject bằng `AgentHetGioCho`, dọn khỏi `cho`. `AgentClient` ánh xạ lỗi này sang `LoiKhongRo`: job thành `khong_ro`, không thử lại, cron chạy tiếp.
- `ket-qua` `trangThai:"khong_ro"` → `AgentClient` ném `LoiKhongRo(loiCuoi)`. `trangThai:"loi"` kèm `loai` → thông điệp `LoiIpp` có nhãn tiếng Việt.
- `chayMotLuotIn` chỉ nhặt `cho_in`, **hoặc** `dang_gui/da_gui/khong_ro` **có** `ippJobId`. Job của app PC không bao giờ có `ippJobId`, nên job treo không còn chiếm chỗ.
- **Kết quả đến trễ** (sau khi hết giờ chờ): backend vẫn ghi nhật ký `ket_qua_tre`. Nếu job đó đang `khong_ro` và kết quả là `da_in` thì cập nhật `da_in`. Kết quả `loi` thì **[v4] về `cho_in`** (gửi lại) — v2 ghi "`loi`, không thử lại" và luật đó đã **bỏ**, xem các mục [v4] dưới đây. Tra được job nhờ bảng tra trong bộ nhớ `agentJobId → {printJobId, soHoaDon, tenKhach, mayInId}`: AgentClient ghi lúc gửi, giữ 1.000 mục gần nhất.
  - **[v3]** Cập nhật trúng 0 dòng (hàng đợi chưa kịp ghi `khong_ro`) thì thử lại một lần sau 3 s.
- **[v4] Registry giữ TẬP kết nối sống của mỗi máy** (cũ → mới); job đi qua kết nối mới nhất.
  - Kết nối nào rớt thì chỉ gỡ chính nó. Hết sạch kết nối mới là offline.
  - Lý do: kết nối "ma" đăng ký sau rồi tự ngắt từng xoá mất đăng ký, máy im in trong khi kết nối thật vẫn sống.
- **[v4] Kết quả/sự cố trễ khi đã mất ngữ cảnh trong bộ nhớ** (backend khởi động lại): tra `print_jobs` theo printJobId trong id job, kiểm đúng máy.
  - Dựng lại từ DB nghĩa là tiến trình này không có hàng chờ nào cho job đó. Vì vậy job còn `dang_gui` (mồ côi của tiến trình trước) được nhận kết quả thật luôn, không phải chờ dọn mồ côi 15 phút.
  - `loi` trễ → job về `cho_in` để gửi lại (app đã xoá sạch job, §0.1). Lượt thử theo luật "không tiêu lượt". Có mã chặn in thì ngắt cầu dao.
- **[v4, vòng 3] Luật chặt cho kết quả trễ:**
  - "Mồ côi" = job đổi trạng thái lần cuối **trước** lúc tiến trình này khởi động. "Thiếu ngữ cảnh cho đúng id" là chưa đủ, vì một lần gửi khác của cùng `print_job` có thể đang chờ.
  - `loi` trễ mà hoá đơn **đã có lệnh in mới hơn** (cùng org, hoá đơn, mẫu in, chưa `loi` — người trực thấy "không rõ" nên đã in lại) → chốt `loi`, **không** kéo job cũ về `cho_in` (tránh 2 tờ).
  - `da_in` trễ trong ca đó vẫn chốt `da_in`, nhưng nhật ký cảnh báo "có thể ra 2 tờ".
  - Kết quả trễ không đổi được dòng nào (job đã in hoặc đã dọn tay) → không hứa "tự gửi lại", không ngắt cầu dao.
  - Dọn mồ côi cập nhật **có điều kiện** (`dang_gui`, không `ippJobId`), để không ghi đè kết quả trễ vừa chốt.
- **[v3] Job đang chờ khoá theo MÁY (token), không theo kết nối.**
  - App nối lại bằng kết nối Y khi X chưa rớt hẳn: kết quả gửi qua Y vẫn khớp job gửi qua X.
  - Kết nối rớt mà máy còn kết nối khác: job vẫn chờ (hạn chờ vẫn canh). Hết sạch kết nối thì `AgentRotGiuaChung` như cũ.
- **[v3]** `trangThai` lạ hoặc thiếu → `khong_ro` (trước là `loi`, tức cho thử lại một kết quả mơ hồ).
- **[v3]** Hạn chờ `AI_MAY_IN_CHO_KET_QUA_MS` chỉ nhận giá trị từ 5 s tới 10 phút; ngoài khoảng đó thì dùng 90 s.
- **[v3] Job mồ côi.** Job `dang_gui` không có `ippJobId` mà quá 15 phút chưa đổi (server khởi động lại giữa lúc chờ) → `khong_ro` + nhật ký `khong_ro` (`chiTiet.lyDo = "mo_coi"`). Cron gọi `donJobMoCoi` trước mỗi lượt.
- **[v3] Cầu dao theo máy** (`AgentRegistry.ngatCauDao` / `xetCauDao` / `dongCauDao`).
  - **Ngắt** khi một job của máy:
    - ra `loi` hoặc `khong_ro` với mã chặn in (§1);
    - hoặc `het_gio_cho`.

    Không ngắt khi `khong_xac_nhan` hoặc app rớt giữa chừng.
  - **Khi ngắt:**
    - các job sau của máy **giữ `cho_in`**: không gửi, không tăng `lanThu`, mỗi job ghi một dòng `cho_may_in`;
    - dòng `tam_giu` ghi một lần mỗi lần ngắt.
  - **Đóng** khi:
    - app báo `da_in` (kể cả trễ);
    - hoặc app báo trạng thái máy không chặn in, tới **sau** lúc ngắt ít nhất 5 s.

    Lúc đóng ghi `tiep_tuc_in`.
  - **Thử lại:** không có bằng chứng nào thì cứ 3 phút cho **một** job đi thử (`gui_may_in` ghi "gửi thử").
  - **[v4] Luật đóng theo trạng thái.** Báo trạng thái không chặn in chỉ đóng cầu dao khi sự cố đang ghi nhận là **cấp máy** (chip nguồn `may`). Sự cố chỉ thấy trên **job** (chip nguồn `job`, máy in mạng) thì báo "bình thường" cấp máy bị bỏ qua: không xoá chip, không đóng cầu dao, không ghi "hết lỗi". Chỉ `da_in` mới gỡ.
    - Trước đây cầu dao bập bênh mỗi 20 s, và nhật ký ghi "báo hết lỗi" sai sự thật.
  - **[v4] Truy vấn lượt loại luôn job của máy đang giữ** (chưa tới lượt thử), cẩn thận với `agent_token` `NULL` = máy mặc định.
    - Trước đây ≥ 10 hoá đơn HN đang giữ chiếm trọn `take: 10`, và HCM không bao giờ tới lượt (lỗi 13.2 tái diễn).
    - Hoá đơn của máy đang giữ vẫn được ghi `nhan_job` + `cho_may_in` mỗi job một lần. Đường này không chờ Odoo lấy tên khách.
  - **[v4]** Hỏi cầu dao **không** tiêu lượt thử. Lượt thử chỉ bị tính khi job thử thật sự được gửi, nên Odoo lỗi đúng lúc đó không nuốt mất lượt.
- **[v4] App offline** → không tải PDF từ Odoo, không ghi "gửi xuống máy in". Chính sách giữ nguyên: mỗi phút một lượt, quá `MAX_LAN_THU` thì `that_bai`. Câu `app_offline_lau` nói đúng điều đó.
- **[v3]** `loi` có mã chặn in → job về `cho_in` **không tăng `lanThu`**. Đây là lỗi của máy, không phải của hoá đơn. Trước đây hết giấy quá 5 phút là hoá đơn thành `loi` vĩnh viễn. Lỗi khác vẫn tăng `lanThu` như cũ.

### 3.2 Bảng `print_logs` (migration `20260925090000_print_logs`, `IF NOT EXISTS`)

| cột | kiểu | ghi chú |
|---|---|---|
| `id` | text PK | cuid |
| `org_id` | text | |
| `created_at` | timestamp(3) default now | |
| `muc_do` | text | `thong_tin` \| `canh_bao` \| `loi` |
| `loai` | text | mã sự kiện (§3.3) |
| `noi_dung` | text | câu tiếng Việt đọc được ngay |
| `print_job_id` | text null | |
| `so_hoa_don` | text null | |
| `ten_khach` | text null | |
| `may_in_id` | text null | `print_agents.id` |
| `may_in_ten` | text null | |
| `agent_job_id` | text null | id job gửi app — **đã cắt tiền tố token**, chỉ giữ `…-<ms>-<n>` |
| `chi_tiet` | jsonb null | |
| `tu_khoa` | text | chữ thường, bỏ dấu, ghép từ `loai`, `noi_dung`, `so_hoa_don`, `ten_khach`, `may_in_ten`. Để tìm "loc beco" ra "Lộc Beco". **[v3]** Mọi ký tự không phải `[a-z0-9]` thành ranh từ, cả ở `tu_khoa` lẫn `q`. Vì vậy "INV/2026/030045" và "INV_2026_030045" tìm như nhau, và `q` không bao giờ mang `%`/`_` (ký tự đại diện LIKE) |

Index:
- `(org_id, created_at DESC)`;
- `(org_id, may_in_id, created_at DESC)`;
- `(org_id, muc_do, created_at DESC)`;
- `(print_job_id)`;
- `(so_hoa_don)`.

Giữ **90 ngày**: cron xoá cũ mỗi ngày một lần.

### 3.3 Mã sự kiện nhật ký (`loai`) do backend ghi

| loai | mức | khi nào |
|---|---|---|
| `nhan_job` | thong_tin | cron bắt đầu xử lý một job `cho_in` lần đầu (`lanThu=0`) |
| `gui_may_in` | thong_tin | đã gửi job xuống app |
| `da_in` | thong_tin | app báo đã in |
| `loi_thu_lai` | canh_bao | app báo `loi` (kèm `loai` §1 nếu có) → sẽ thử lại |
| `app_offline_thu_lai` | canh_bao | máy đích chưa kết nối → giữ `cho_in`, thử lại |
| `loi_odoo` | canh_bao | Odoo không trả PDF |
| `khong_co_may_in` | loi | không tìm được máy in cho job |
| `that_bai` | loi | quá `MAX_LAN_THU` lần → `loi` |
| `khong_ro` | loi | không biết đã in chưa → `khong_ro` (không thử lại) |
| `het_gio_cho` | loi | app không trả lời trong `AI_MAY_IN_CHO_KET_QUA_MS` |
| `ket_qua_tre` | thong_tin | kết quả đến sau khi đã hết giờ chờ (**[v3]** mức `canh_bao` khi kết quả không phải `da_in`) |
| `app_ket_noi` | thong_tin | app kết nối (kèm `thong-tin-app` nếu có; **[v3]** "— sau N phút mất kết nối" nếu trước đó đã có `app_offline_lau`) |
| `app_mat_ket_noi` | thong_tin | app mất kết nối (kèm lý do). **[v3]** Hạ từ `canh_bao`: máy HN rớt-nối 3–5 lần/giờ |
| `app_offline_lau` | canh_bao | **[v3]** mất kết nối quá 2 phút mà chưa nối lại |
| `tam_giu` | canh_bao | **[v3]** cầu dao ngắt: tạm giữ hoá đơn của máy đang lỗi |
| `cho_may_in` | thong_tin | **[v3]** một hoá đơn đang chờ máy hết lỗi (một dòng mỗi job) |
| `tiep_tuc_in` | thong_tin | **[v3]** cầu dao đóng: máy in được lại |
| mã §1 (`het_giay`, `ket_giay`, …) | theo §1 | từ `su-co` hoặc `trang-thai-may-in` |
| `binh_thuong` | thong_tin | máy in hết sự cố |

Chống ồn: `trang-thai-may-in` trùng trạng thái cũ của cùng máy thì **không** ghi.

### 3.4 Trạng thái máy in hiện tại
- `AgentRegistry` giữ `tinhTrang: Map<token, {ma, chiTiet?, luc}>`, cập nhật theo `trang-thai-may-in` và `su-co`.
- **[v3] Cập nhật tình trạng.**
  - Chỉ `su-co` có mã **cấp máy** mới đổi tình trạng. `su-co binh_thuong` được xử như báo trạng thái.
  - App báo `da_in` trong khi tình trạng đang là mã chặn in → đặt `binh_thuong` + nhật ký `binh_thuong`. Lý do: máy in mạng hay chỉ bật cờ lỗi trên job, nên chip "Hết giấy" từng kẹt mãi.
  - App ép gửi `trang-thai-may-in` ở lần đọc lúc rảnh ngay sau một job có sự cố.
  - **[v4]** Backend: tình trạng nhớ **nguồn** — `may` khi đến từ `trang-thai-may-in`, `job` khi đến từ `su-co`.
  - **[v4]** App: gộp cờ kẹt của **mọi** job còn trong hàng đợi (của app hay chương trình khác, cùng luật với việc từ chối in ở §0.1) vào trạng thái lúc rảnh. Có job kẹt thì app báo mã của nó, không báo `binh_thuong`, để backend không đóng cầu dao trong khi app vẫn từ chối in. `chiTiet` không ghi tên tài liệu của chương trình khác.
- `GET /api/v1/may-in-agents` thêm vào mỗi máy: `tinhTrang: {ma, nhan, luc} | null`. Là `null` khi chưa biết hoặc app offline.

### 3.5 API nhật ký
`GET /api/v1/may-in-agents/nhat-ky` — **chỉ owner/admin** (403 `CHI_ADMIN`).

Tham số:

| tham số | ý nghĩa |
|---|---|
| `q` | chuỗi tự do, bỏ dấu và chữ thường, khớp `tu_khoa` (mọi từ phải có — AND) |
| `mayInId` | lọc một máy |
| `mucDo` | `loi` \| `canh_bao` \| `thong_tin` \| `loi_canh_bao` |
| `loai` | lọc một mã |
| `tu`, `den` | ISO; mặc định 7 ngày gần nhất |
| `truoc` | con trỏ `"<createdAtISO>|<id>"` để tải thêm |
| `gioiHan` | mặc định 50, tối đa 200 |

Trả về: `{ items: NhatKy[], tiepTheo: string | null }`, với
`NhatKy = { id, luc, mucDo, loai, noiDung, soHoaDon, tenKhach, mayInId, mayInTen, printJobId, chiTiet }`.
Sắp xếp `created_at DESC, id DESC`.

## 4. App PC (Rust)

1. Nhận `cau-hinh`, nhớ `hoTro` theo kết nối.
2. Theo dõi job:
   - lần đầu thấy sự cố thì gửi `su-co` **ngay** (qua kênh gửi thread-safe), rồi vẫn theo dõi tiếp như cũ;
   - quyết kết quả theo §0.1. Sự cố **trước khi in** và job còn trong hàng đợi thì xoá job (`SetJobW` `JOB_CONTROL_DELETE`), kiểm đã hết, rồi mới `loi`; không thì `khong_ro`. Job đã rời hàng đợi mà máy in đang lỗi (có thể nằm trong bộ nhớ máy in) → `khong_ro`, không `loi`.
3. Theo dõi máy in lúc rảnh: đọc `GetPrinterW` mỗi 20 giây; đổi trạng thái thì gửi `trang-thai-may-in`.
4. **Báo ngay trên máy tính shop:** có sự cố thì
   - giao diện hiện **dải cảnh báo đỏ** — **[v3] KHÔNG BAO GIỜ bảo NV "in lại"** (NV in tay + job tự in = 2 tờ). Câu theo kết quả:
     - `loi` (app đã xoá job): "⚠ <Nhãn> — hoá đơn <số> chưa in / <Việc cần làm>. Hệ thống sẽ TỰ gửi in lại khi máy in hết lỗi — KHÔNG in tay."
     - `khong_ro` có mã máy: "⚠ <Nhãn> — hoá đơn <số> đang chờ trong máy in / <Việc cần làm>. Hoá đơn sẽ TỰ in ra sau khi khắc phục — KHÔNG in lại."
     - `khong_ro` (`khong_xac_nhan`): "Chưa xác nhận được hoá đơn <số> đã in / Xem khay giấy. Nếu 5 phút không thấy ra, báo quản lý kiểm trên ZaloCRM — KHÔNG tự in lại."
     - Sự cố lúc rảnh: "⚠ <Nhãn> (máy in "<tên>") / <Việc cần làm>. Hoá đơn gửi tới sẽ chờ và tự in khi máy in hết lỗi."
   - Dải **tự tắt** khi một trong các việc sau xảy ra:
     - job đó được xác nhận in (theo dõi tiếp);
     - một job sau in xong;
     - trạng thái máy lúc rảnh về `binh_thuong` (với dải loại máy hoặc loại `loi`);
     - NV bấm **"Đã hiểu"**.
   - **nháy nút app trên taskbar / khay** (`FlashWindowEx`, hoặc đổi icon khay sang đỏ);
   - danh sách "In gần đây" hiện nhãn đúng: Đã in / Lỗi: `<nhãn>` / Không rõ: `<nhãn>`.
5. Ghi **file nhật ký** cục bộ `%LOCALAPPDATA%\print-agent\logs\print-agent-YYYY-MM-DD.log`: mỗi dòng một sự kiện, giữ 14 ngày.
6. Test thuần cho: ánh xạ cờ Win32 → mã; quyết kết quả khi có sự cố (xoá được / không xoá được); gửi `su-co` một lần mỗi (job, loai); không gửi `khong_ro` khi thiếu `hoTro`; nhãn giao diện.
6b. **[v3]** Việc thêm:
   - **Theo dõi tiếp:** một luồng duy nhất cho mọi job `khong_ro` còn nằm trong hàng đợi, đọc mỗi 1 s, giữ tối đa 12 giờ và 200 job. Kết luận in xong theo đúng luật `suy_ket_qua`, rồi gửi `da_in` trễ.
   - **Chống báo "đã in" sai:**
     - thấy `DELETING`/`DELETED`/`RESTART` thì lần vắng sau đó không tính là in xong;
     - EnumJobs lỗi là lỗi truy vấn, không phải hàng đợi rỗng;
     - rời hàng đợi sạch mà ~2 s sau máy báo sự cố chặn in → `khong_ro`.
   - **SumatraPDF chờ có hạn 60 s:** quá hạn thì dừng Sumatra, vẫn theo dõi spooler.
   - **Luồng rảnh** vẫn đọc máy in khi worker đang in quá 20 s.
   - **Một bản app, một kết nối:**
     - bấm Lưu thì dừng hẳn mạng/luồng cũ;
     - watchdog `disconnect()` client cũ trước khi dựng client mới;
     - named mutex chặn chạy hai bản.
   - **Lúc khởi động:** tiếp tục (resume) job của mình đang bị tạm dừng.
   - **Nút "In thử"** dùng PDF hợp lệ và chạy ở luồng riêng.
7. `cargo test` xanh; `cargo check --target x86_64-pc-windows-msvc` đạt.

## 5. Giao diện ZaloCRM (`PrintAgentsPage.vue`, Vuetify 4)

1. Cột **Trạng thái** của mỗi máy: Online/Offline như cũ, thêm chip đỏ/vàng theo `tinhTrang` (ví dụ "Hết giấy · 3 phút trước").
2. Mục **"Nhật ký máy in"** dưới bảng:
   - ô tìm kiếm (gõ tới đâu lọc tới đó, trễ 300 ms; tìm không dấu);
   - chọn máy in, chọn mức độ ("Lỗi & cảnh báo" mặc định bật nhanh), chọn khoảng thời gian (Hôm nay / 7 ngày / 30 ngày);
   - bảng: Thời gian (giờ VN) · Máy in · Mức (chip màu) · Sự kiện (nhãn tiếng Việt) · Hoá đơn · Khách · Nội dung. Bấm một dòng thì mở `chiTiet`;
   - nút "Tải thêm" theo `tiepTheo`; công tắc "Tự làm mới 15 giây" — **[v3] bật sẵn** (chip tình trạng + nhật ký tự mới khi người trực để trang mở);
   - **[v3]** API trả 503 `CHUA_MIGRATE` → câu "Máy chủ chưa tạo bảng nhật ký máy in (cần chạy migration print_logs)".
   - **[v4]** Lượt tự làm mới chạy ngầm (nhật ký + danh sách máy) **không bật toast 5xx chung** (`boQuaToast5xx`), chỉ báo ngay trong mục. Trước đây backend sập thì mỗi tab đang mở bắn toast đỏ mỗi 15 s.
3. Không phải admin thì mục nhật ký không hiện (API trả 403).
4. `api/print-agents.ts` thêm `layNhatKy(params)` và kiểu `NhatKy`, `TinhTrang`.
5. `npm run build` (vue-tsc) đạt.
