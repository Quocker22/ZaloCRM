# Hợp đồng v5.1 — Hàng đợi in hiện rõ + Huỷ lệnh in có xác nhận + Mức độ log app

> **v5.1 (sau giám sát thiết kế 25/09) THAY THẾ mọi chỗ mâu thuẫn ở phần dưới.** Đọc mục 8 trước.


25/09/2026. Áp cho ba phần: backend ZaloCRM (Fastify/Prisma), giao diện ZaloCRM (Vue, trang Cài đặt › Máy in),
app máy in Windows (Rust, print-agent). Bổ sung cho hợp đồng nhật ký máy in v4 (`ZaloCRM/docs/may-in/HOP-DONG-NHAT-KY-MAY-IN.md`)
và hợp đồng `nhat-ky-app` (25/09). Không phá tương thích: app cũ / backend cũ không có tính năng thì hành vi cũ giữ nguyên.

## 0. Yêu cầu của chủ (nguyên văn ý)

- Hoá đơn gửi lúc máy in lỗi (vd 10 bản) phải **hiện ở cả app máy in lẫn ZaloCRM** — không được "im lặng rồi in lại toàn bộ".
- **Huỷ được lệnh in** ở cả hai nơi. Huỷ phải **báo kết quả thật**: thành công (chắc chắn không in) hoặc KHÔNG thành công (kèm lý do,
  kèm việc cần làm). Không bao giờ báo "đã huỷ" khi không chắc.
- UI/UX phần máy in (app + ZaloCRM) làm cẩn trọng.
- Log app trên ZaloCRM phải lọc được lỗi (vd hết giấy phải thấy trong nhóm sự cố/lỗi).

## 1. Bất biến (vi phạm = sai hợp đồng)

- B1. "Đã huỷ" (`da_huy`) CHỈ khi chắc chắn không một byte nào của hoá đơn tới máy in: (a) job còn `cho_in` trên server và chuyển
  `cho_in → da_huy` bằng cập nhật CÓ ĐIỀU KIỆN; hoặc (b) app xác nhận job chưa bắt đầu in (chưa gọi Sumatra) hoặc đã xoá khỏi hàng
  đợi Windows theo đúng thủ tục an toàn hiện có (`spooler::go_job_khoi_hang_doi`: tạm dừng → đọc lại → job SẠCH (chưa PRINTING,
  0 trang, cờ ⊆ {SPOOLING, PAUSED, BLOCKED_DEVQ}) → xoá → kiểm đã biến mất).
- B2. Cron chuyển `cho_in → dang_gui` phải CÓ ĐIỀU KIỆN (`updateMany where {id, trangThai:'cho_in'}` → count 1 mới gửi). Count 0
  (vừa bị huỷ) → bỏ job, không gửi. Hiện `hang-doi-in.ts` dùng `update` không điều kiện — PHẢI sửa.
- B3. Job đã vào bộ nhớ máy in / đã bắt đầu in → KHÔNG huỷ được từ xa: trả lỗi rõ + hướng dẫn (tắt máy in rồi bật lại xoá bộ nhớ —
  hoá đơn đó sẽ không in; kiểm giấy ra trước khi in lại).
- B4. Không lộ token máy in ở bất kỳ payload/nhật ký/UI nào (luật cũ).
- B5. Mọi yêu cầu huỷ (thành công/thất bại) ghi `print_logs` (`da_huy` / `huy_that_bai`) kèm nguồn (CRM + tên người / app máy in).

## 2. Trạng thái `print_jobs.trang_thai`

Hiện có: `cho_in`, `dang_gui`, `da_gui` (IPP cũ), `da_in`, `khong_ro`, `loi`. THÊM:
- `da_huy` — đã huỷ chắc chắn (B1). Kết thúc. Cron KHÔNG BAO GIỜ nhặt (DIEU_KIEN_NHAT_JOB không gồm).
- `bo_qua` — người quản lý "bỏ khỏi hàng đợi" một job `khong_ro` mà hệ thống không huỷ được (app không còn giữ). KHÔNG khẳng định
  gì về giấy; chỉ để danh sách sạch. Kết thúc.

"Đang chờ" (hàng đợi hiện ra) = `cho_in` ∪ `dang_gui` ∪ `da_gui` ∪ `khong_ro` (khong_ro: chỉ trong 3 ngày gần nhất).

## 3. API REST (backend, dưới `/api/v1/may-in-agents`, chỉ owner/admin như `/nhat-ky`, 403 `CHI_ADMIN`)

### 3.1 `GET /hang-doi?mayInId=` → `{ items: MucHangDoi[], capNhat: ISO }`

```ts
interface MucHangDoi {
  id: string;              // print_jobs.id
  soHoaDon: string;
  tenKhach: string | null; // lấy từ print_logs gần nhất có print_job_id = id (có sẵn ten_khach)
  mayInId: string | null; mayInTen: string | null;  // từ agent_token → print_agents (KHÔNG trả token)
  trangThai: 'cho_in' | 'dang_gui' | 'da_gui' | 'khong_ro';
  lyDo: string;            // câu cho người đọc, vd "Tạm giữ — máy in Hết giấy (từ 18:45)", "Đang gửi xuống máy in",
                           // "Chưa xác nhận đã in — có thể đang nằm trong máy in", "Chờ app máy in kết nối lại"
  tamGiu: boolean;         // cho_in + cầu dao máy đó đang ngắt
  lanThu: number;
  tao: string; capNhat: string;  // ISO
  huy: 'chac_chan' | 'hoi_app' | 'khong';  // gợi ý UI: cho_in → chac_chan; dang_gui/da_gui/khong_ro → hoi_app
}
```
Sắp xếp: `tao` tăng dần (cũ trước — đúng thứ tự sẽ in). Tối đa 500.

### 3.2 `POST /hang-doi/huy` body `{ ids: string[] (1..50) }` → `{ ketQua: KetQuaHuy[] }`

```ts
interface KetQuaHuy {
  id: string; soHoaDon: string | null;
  ok: boolean;
  trangThaiMoi: string | null;  // 'da_huy' khi ok; trạng thái hiện tại khi không ok
  cach?: 'chua_gui' | 'app_chua_in' | 'xoa_hang_doi_windows' | 'da_huy_truoc';  // ok = true
  loi?: 'DA_IN' | 'DA_VAO_MAY_IN' | 'DANG_IN' | 'DANG_GUI' | 'APP_MAT_KET_NOI' | 'APP_KHONG_TRA_LOI'
      | 'KHONG_THAY' | 'KHONG_TIM_THAY' | 'APP_CU';          // ok = false
  noiDung: string;              // câu tiếng Việt cho người đọc (vì sao + việc cần làm)
}
```
Thuật toán mỗi id (tuần tự trong một request, mỗi job độc lập):
1. `updateMany where {id, orgId, trangThai:'cho_in'} data {trangThai:'da_huy', loiCuoi:'Đã huỷ bởi <nguồn>'}` → count 1 ⇒ ok, `cach:'chua_gui'`.
2. Không → đọc job. Không có / khác org ⇒ `KHONG_TIM_THAY`. `da_huy` ⇒ ok `cach:'da_huy_truoc'`. `da_in` ⇒ `DA_IN`.
   `loi`/`bo_qua` (kết thúc, không tự in lại) ⇒ `updateMany {trangThai: in [loi]}`→`da_huy`, ok `cach:'chua_gui'` (loi: app chưa in / đã
   gỡ khỏi hàng đợi — không bao giờ tự gửi lại); `bo_qua` ⇒ ok `da_huy_truoc`.
3. `dang_gui` / `da_gui` / `khong_ro` ⇒ hỏi app đích (agent_token của job):
   - App không kết nối ⇒ `APP_MAT_KET_NOI`. App kết nối nhưng `cau-hinh` không có `huy_lenh` (app cũ) ⇒ `APP_CU`.
   - Emit `huy-job` (mục 4.2), chờ `ket-qua-huy` khớp `yeuCauId` tối đa 15 s; hết giờ ⇒ `APP_KHONG_TRA_LOI`.
   - App ok ⇒ `updateMany where {id, trangThai in [dang_gui, da_gui, khong_ro]}` → `da_huy`; ok với `cach` của app.
     (Nếu count 0 vì kết quả in về đúng lúc: đọc lại, `da_in` ⇒ `DA_IN`.)
   - App không ok ⇒ trả `loi` + `noiDung` của app, job giữ nguyên trạng thái.
4. Ghi `print_logs`: ok ⇒ `da_huy` (thong_tin) "Đã huỷ lệnh in hoá đơn X — chắc chắn không in (nguồn: …)"; không ok ⇒ `huy_that_bai`
   (canh_bao) "Không huỷ được lệnh in hoá đơn X: <noiDung>". Nguồn: "ZaloCRM (<tên người dùng>)" hoặc "app máy in (<tên máy tính>)".
5. Sau cùng: đẩy snapshot `hang-doi` cho app của máy liên quan (4.4).

### 3.3 `POST /hang-doi/bo-theo-doi` body `{ ids }` → `{ ketQua: {id, ok, noiDung}[] }`
CHỈ cho job `khong_ro` (còn lại ⇒ ok:false "chỉ bỏ theo dõi được lệnh chưa xác nhận"). `khong_ro → bo_qua` (có điều kiện). Ghi
`print_logs` `bo_theo_doi` (canh_bao) "Bỏ theo dõi hoá đơn X — hệ thống KHÔNG biết đã in hay chưa, kiểm giấy trước khi in lại".

## 4. Socket `/print-agent` (backend ↔ app)

`HO_TRO_APP` thêm `'huy_lenh'`, `'hang_doi'`. App quảng bá khả năng bằng `thong-tin-app` hiện có: thêm trường `khaNang: string[]`
(app 0.2.6 gửi `['huy_lenh','hang_doi']`). Backend nhớ theo socket; thiếu ⇒ coi là app cũ.

### 4.1 Server → app `job` (có sẵn). App lấy `printJobId` = phần `id` trước `-<ms>` cuối của `jobId`
(`jobId = <print_jobs.id>-<ms>` từ 25/09). Backend thêm trường `printJobId` vào payload `job` cho chắc (app ưu tiên trường này).

### 4.2 Server → app `huy-job` `{ yeuCauId: string, printJobId: string }`
(rust_socketio 0.6 KHÔNG trả lời được ack của server ⇒ trả lời bằng event riêng.)
App xử lý NGOÀI luồng callback socket (không chặn ping), rồi emit:

### 4.3 App → server `ket-qua-huy` `{ yeuCauId, printJobId, ok: boolean, cach?: 'app_chua_in'|'xoa_hang_doi_windows', loi?: string, noiDung: string }`
`loi` của app ∈ `DA_VAO_MAY_IN` (job đã rời hàng đợi Windows sang máy in / đang theo dõi qua USB), `DANG_IN` (đã thấy PRINTING / trang
đã in / cờ ngoài danh sách trắng), `DANG_GUI` (Sumatra đang nộp job, chưa thấy trong hàng đợi — thử lại sau vài giây), `KHONG_THAY`
(app không giữ job này: chưa nhận, đã xong, hoặc app đã khởi động lại).

App quyết theo nơi job đang nằm:
- Chưa bắt đầu (nằm trong hàng việc của worker, chưa gọi Sumatra) ⇒ đánh dấu huỷ, ok `app_chua_in`. Worker tới lượt job này: KHÔNG
  in, gửi `ket-qua {jobId, trangThai:'da_huy'}` (mục 4.5) để backend kết thúc lượt chờ.
- Đang in (worker đang xử lý): tìm job trong hàng đợi Windows (tên tài liệu chứa jobId) → `go_job_khoi_hang_doi` → xoá được ⇒ ok
  `xoa_hang_doi_windows`, và kết quả của lượt in này PHẢI thành `da_huy` (không phải `khong_ro`/`loi`); không an toàn ⇒ `DANG_IN`;
  không thấy trong hàng đợi mà Sumatra chưa xong ⇒ `DANG_GUI`; đã rời hàng đợi ⇒ `DA_VAO_MAY_IN`.
- Theo dõi tiếp (khong_ro): chế độ hàng đợi Windows ⇒ như "đang in" (xoá an toàn → bỏ khỏi danh sách theo dõi); chế độ USB (trong bộ
  nhớ máy in) ⇒ `DA_VAO_MAY_IN`.
- Không có ⇒ `KHONG_THAY`.

### 4.4 Server → app `hang-doi` `{ items: MucHangDoi[] }` — chỉ job của CHÍNH máy đó
Gửi khi: app vừa kết nối (sau `cau-hinh`); job của máy đó đổi trạng thái (tạo, gửi, kết quả, huỷ, tạm giữ/tiếp tục); tối đa 1 lần/giây
(gộp). App cũng có thể hỏi lại: app → server `lay-hang-doi` (không ack) ⇒ server trả `hang-doi`.

### 4.5 App → server `ket-qua` thêm `trangThai:'da_huy'` (chỉ khi `huy_lenh` được hỗ trợ). Backend: job `dang_gui` → `da_huy`
(có điều kiện), kết thúc lượt chờ của registry, KHÔNG thử lại, ghi `da_huy`.

### 4.6 App → server `yeu-cau-huy` `{ printJobId }` **có ack** ⇒ backend chạy đúng 3.2 cho id đó (nguồn = app máy in) rồi ack
`KetQuaHuy`. (App dùng `emit_with_ack` — đã chạy được, ack dạng `[obj]`.) Bước "hỏi app" ở 3.2.3 vẫn áp dụng (backend hỏi lại chính
app qua `huy-job`) — app phải xử lý `huy-job` trên luồng khác luồng đang chờ ack.

## 5. Mức độ log app (`print_app_logs.muc_do`)

Thêm cột `muc_do TEXT NOT NULL DEFAULT 'thong_tin'` + index `(org_id, muc_do, luc DESC)`; backend phân loại lúc lưu
(`phanLoaiMucDoApp(suKien, noiDung)`), migration backfill bằng CÙNG luật (SQL CASE). Luật:
- `loi`: `su_co`; `khong_in_*` (khong_in_het_giay, khong_in_hang_doi_ket, khong_in_khong_tim_thay_may_in); `ket_qua` có
  `trang_thai=loi` hoặc `trang_thai=khong_ro`; `trang_thai_may_in` khác `binh_thuong`/`het_muc`; `usb_doc` chứa `TRỐNG` hoặc
  `báo lỗi` hoặc `hết giấy`; `theo_doi_tiep_mat`, `theo_doi_tiep_het_han`; `tu_choi_ket_noi`; `sumatra_qua_han`, `sumatra_loi_cho`;
  `huy_that_bai`.
- `canh_bao`: `trang_thai_may_in het_muc`; `usb_doc` chứa `KHONG DOC DUOC`; `noi_that_bai`, `mat_ket_noi`, `gui_nhat_ky_loi`,
  `app_bo_dong`, `mat_job`, `ngat_client_cham`, `hop_thu_tran`, `theo_doi_tiep_bo`, `bo_theo_doi`.
- còn lại `thong_tin`.
API `/nhat-ky-app` thêm `mucDo` (`loi` | `canh_bao` | `thong_tin` | `loi_canh_bao`), item trả thêm `mucDo`.

## 6. UI/UX

### 6.1 ZaloCRM — trang Cài đặt › Máy in
- Thẻ máy in: thêm chip "N đang chờ" (màu cam nếu có job tạm giữ, xanh nếu chỉ đang gửi) — bấm vào mở tab Hàng đợi lọc máy đó.
- Mục dưới thành 3 tab: **Hàng đợi in (N)** | Nhật ký in | Log app. Tab mặc định: Hàng đợi nếu N>0, ngược lại Nhật ký in
  (người dùng chọn thì nhớ localStorage; `?nhatKy=` vẫn chạy; thêm `?nhatKy=hang_doi`).
- Tab Hàng đợi: bảng — ô chọn · Hoá đơn (+ khách) · Máy in · Trạng thái (chip + `lyDo`) · Chờ từ (giờ VN, "12 phút trước") · Hành động.
  - Hành động: nút "Huỷ" (đỏ nhạt). `huy='chac_chan'` ⇒ hộp xác nhận ngắn "Huỷ lệnh in INV…? Hoá đơn này sẽ KHÔNG được in." ;
    `hoi_app` ⇒ hộp xác nhận nói rõ "Hệ thống sẽ hỏi app máy in — chỉ huỷ được nếu hoá đơn chưa xuống máy in."
  - Chọn nhiều ⇒ "Huỷ N lệnh đã chọn". Có "Chọn tất cả của máy X".
  - Trong lúc chờ: dòng hiện "Đang huỷ…" (spinner), nút khoá. Xong: ok ⇒ dòng chuyển "Đã huỷ ✓" (xanh) rồi rời danh sách sau 3 s,
    toast tổng "Đã huỷ 3/4 lệnh". Không ok ⇒ dòng giữ lại, chip đỏ "Không huỷ được" + `noiDung` đầy đủ; job `khong_ro` không huỷ được
    thì hiện thêm nút "Bỏ khỏi hàng đợi" (3.3) có xác nhận nói rõ nó KHÔNG chặn việc in.
  - Tự làm mới 5 s (tạm dừng khi tab ẩn / đang có hộp xác nhận / đang huỷ). Rỗng: "Không có lệnh in nào đang chờ ✓".
- Log app: thêm hàng chip mức độ (Lỗi & cảnh báo · Lỗi · Cảnh báo · Thông tin · Tất cả) giống tab Nhật ký in; mỗi dòng có vạch màu
  theo mức; mặc định "Tất cả". Chip sự kiện giữ nguyên.
- Nhật ký in: nhãn cho mã mới `da_huy` ("Đã huỷ lệnh in"), `huy_that_bai` ("Không huỷ được lệnh in"), `bo_theo_doi`
  ("Bỏ theo dõi lệnh in").

### 6.2 App máy in (Slint)
- Thêm khối **HÀNG ĐỢI (N)** ngay trên "IN GẦN ĐÂY", chỉ hiện khi N>0 (N = mục từ snapshot `hang-doi` của server ∪ việc worker
  đang giữ chưa có trên server). Mỗi dòng: `INV… · khách` / chip trạng thái (Tạm giữ: Hết giấy · Đang gửi · Chưa xác nhận) /
  giờ / nút "Huỷ".
- Bấm "Huỷ" ⇒ dòng đổi thành xác nhận tại chỗ: "Huỷ lệnh in này? [Huỷ lệnh] [Thôi]" ⇒ "Đang huỷ…" ⇒ kết quả:
  "Đã huỷ ✓" (xanh, 5 s rồi biến mất) hoặc "Không huỷ được: <noiDung>" (đỏ, giữ tới khi bấm ✕).
- Dải cảnh báo đầu cửa sổ khi có job tạm giữ: "⏸ N hoá đơn đang chờ — máy in Hết giấy. Nạp giấy là tự in. Không cần in lại."
- "In gần đây" có nhãn mới "Đã huỷ" (xám).
- Mọi thao tác huỷ ghi nhật ký cục bộ (`huy_yeu_cau`, `huy_ket_qua`) — tự lên Log app.

## 7. Kiểm chứng bắt buộc

- Backend: test đơn vị + func (socket thật) cho: B2 (claim có điều kiện — huỷ chen giữa findMany và claim ⇒ không gửi), 3.2 mọi
  nhánh, 4.2/4.3 khớp yeuCauId + hết giờ, 4.5, 4.6 (kể cả vòng hỏi-lại app), snapshot 4.4 (gộp 1 s, đúng máy), phân loại mức độ (mọi
  luật mục 5) + backfill SQL khớp hàm TS trên mẫu.
- App: test thuần cho quyết định huỷ theo nơi job nằm (4.3), worker bỏ job đã huỷ + gửi `da_huy`, kết quả lượt in thành `da_huy` khi
  xoá thành công giữa chừng, snapshot → hàng UI, không chặn luồng callback. Test đầu-cuối với server socket.io thật (node) cho
  `huy-job`→`ket-qua-huy` và `yeu-cau-huy` có ack.
- Frontend: DOM spec cho tab Hàng đợi (xác nhận, đang huỷ, kết quả ok/không ok, bỏ theo dõi), chip mức độ Log app.


## 8. v5.1 — QUYẾT ĐỊNH SAU GIÁM SÁT (ưu tiên hơn mọi mục trên)

Giám sát chỉ ra: huỷ phía app (xoá hàng đợi Windows từ luồng khác, bảng trạng thái không nguyên tử) phá B1; và app gần như không
bao giờ giữ job "chưa bắt đầu" (cron tuần tự, `guiJob` chờ kết quả từng job ⇒ mỗi app tối đa 1 job đang bay, worker lấy ngay).
Trong sự cố hết giấy, với app 0.2.5 MỌI hoá đơn lúc lỗi là `cho_in` bị cầu dao giữ ⇒ huỷ được CHẮC CHẮN chỉ bằng DB. Vậy:

8.1 **BỎ** giao thức `huy-job` / `ket-qua-huy` (4.2, 4.3) và `ket-qua da_huy` (4.5). App KHÔNG xoá gì khỏi hàng đợi Windows trong bản này.

8.2 **Huỷ chỉ là DB, có điều kiện:** `cho_in → da_huy` (`updateMany where {id, trangThai:'cho_in', <phạm vi>}`). Kết quả:
- count 1 ⇒ `ok:true, cach:'chua_gui'`, noiDung "Đã huỷ — hoá đơn chắc chắn không in".
- count 0 ⇒ đọc lại job:
  - `da_huy` ⇒ `ok:true, cach:'da_huy_truoc'` (huỷ đồng thời / bấm hai lần);
  - `dang_gui` / `da_gui` ⇒ `ok:false, loi:'DANG_IN'`, noiDung "Hoá đơn đang được gửi/in ở máy in — không huỷ được nữa. Nếu không
    cần tờ này: bỏ tờ in ra." ;
  - `khong_ro` ⇒ `ok:false, loi:'CHUA_XAC_NHAN'`, noiDung "Hoá đơn đã gửi xuống máy in nhưng chưa xác nhận đã in — có thể đang
    nằm trong bộ nhớ máy in, không huỷ được từ xa. Muốn bỏ hẳn: xoá lệnh trong hàng đợi Windows (nếu còn), tắt máy in 10 giây
    (MỌI hoá đơn trong bộ nhớ máy sẽ mất) → bật lại → kiểm khay → in lại cái cần. Rồi bấm 'Bỏ khỏi hàng đợi'." ;
  - `da_in` ⇒ `ok:false, loi:'DA_IN'`; `loi` / `bo_qua` ⇒ `ok:false, loi:'DA_KET_THUC'` (KHÔNG đổi trạng thái, KHÔNG nói "đã huỷ");
  - không có / ngoài phạm vi ⇒ `ok:false, loi:'KHONG_TIM_THAY'`.
- Mã `loi` chỉ gồm: `DANG_IN`, `CHUA_XAC_NHAN`, `DA_IN`, `DA_KET_THUC`, `KHONG_TIM_THAY`. `KetQuaHuy.huy` gợi ý UI chỉ còn
  `'chac_chan'` (cho_in) | `'khong'` (còn lại). Nhiều id: xử lý TUẦN TỰ trong một transaction-free loop (mỗi cái chỉ 1–2 query,
  không chờ app), trả đủ `ketQua` theo đúng thứ tự `ids`.
- Phạm vi: REST = `orgId` của người dùng. Socket `yeu-cau-huy` = CHỈ job của chính máy đó: `agent_token = token socket`, hoặc
  (`agent_token IS NULL` và token socket = token env máy mặc định). Không khớp ⇒ `KHONG_TIM_THAY`.

8.3 **B2 mở rộng — MỌI lần ghi `print_jobs` trong cron có điều kiện trạng thái mong đợi** (`hang-doi-in.ts` mọi chỗ: nhận lỗi
PDF/app offline ⇒ `cho_in` chỉ khi đang `cho_in`; claim `cho_in → dang_gui`; kết quả `da_in`/`da_gui`/`khong_ro`/`cho_in`/`loi` chỉ
khi đang `dang_gui`; `xacMinh` chỉ khi đang `dang_gui|da_gui|khong_ro`; `donJobMoCoi` giữ điều kiện có sẵn). count 0 ⇒ DỪNG xử lý job
đó: không ghi nhật ký kết quả, không ngắt cầu dao, không gọi `mayInDaInDuoc`. `da_huy`/`bo_qua` không bao giờ bị ghi đè. Claim thất
bại (vừa bị huỷ) ⇒ KHÔNG gửi app. Có test cho TỪNG chỗ ghi (huỷ chen giữa ⇒ trạng thái vẫn `da_huy`, không gửi, không log sai).

8.4 `coLenhInMoiHon` (agent-ws.ts) loại `da_huy`, `bo_qua` khỏi "lệnh in mới hơn".

8.5 **Bỏ theo dõi** (3.3) giữ nguyên: CHỈ `khong_ro → bo_qua` có điều kiện; ok ⇒ "Đã bỏ khỏi hàng đợi — hệ thống KHÔNG biết hoá
đơn đã in hay chưa". UI KHÔNG BAO GIỜ hiện "Đã huỷ" cho `bo_qua`.

8.6 **Hàng đợi hiện:** `GET /hang-doi` trả hai nhóm: `choIn` = `cho_in` ∪ `dang_gui` ∪ `da_gui` (đang/sẽ in), và `chuaXacNhan` =
`khong_ro` 3 ngày gần nhất. Chip "N đang chờ" trên thẻ máy CHỈ đếm `choIn`. Mục thêm `nhom: 'cho_in' | 'chua_xac_nhan'`.

8.7 **Socket app:** `HO_TRO_APP` thêm `'hang_doi'`. Server → app `hang-doi` `{ choIn: MucHangDoi[], chuaXacNhan: MucHangDoi[],
capNhat: ISO }` CHỈ job của máy đó. Gửi: ngay sau `cau-hinh`; mỗi nhịp cron (mỗi phút) cho mỗi app đang nối; sau mỗi thay đổi
trong tiến trình (huỷ, bỏ theo dõi, claim, kết quả, tạm giữ/tiếp tục); CHỈ khi nội dung đổi so với lần gửi trước cho socket đó (so
chuỗi JSON đã sắp), tối đa 1 lần/giây. App → server `lay-hang-doi` (không payload) ⇒ server gửi `hang-doi` ngay (bỏ qua so trùng).
App → server `yeu-cau-huy` `{ printJobId }` CÓ ack ⇒ ack `KetQuaHuy` (8.2, phạm vi máy). App → server `yeu-cau-bo-theo-doi`
`{ printJobId }` có ack ⇒ ack `{id, ok, noiDung}` (8.5, phạm vi máy). Nguồn ghi nhật ký: "app máy in (<tên máy tính>)" lấy từ
`thong-tin-app.may`. App nhận `KetQuaHuy` bằng `emit_with_ack` timeout 20 s; hết giờ ⇒ UI "Chưa rõ — xem lại hàng đợi" và gửi
`lay-hang-doi`. App dùng thẳng `id` trong mục hàng đợi (không tự bóc từ jobId).

8.8 **Nhật ký `print_logs`:** `da_huy` (thong_tin) "Đã huỷ lệnh in hoá đơn X — chắc chắn không in (nguồn: …)"; `huy_that_bai`
(canh_bao) "Không huỷ được lệnh in hoá đơn X: <noiDung ngắn> (nguồn: …)"; `bo_theo_doi` (canh_bao). Thêm cả ba vào `MA_SU_KIEN`
backend + nhãn frontend. Mỗi yêu cầu MỘT dòng (không ghi đôi).

8.9 **Mức độ log app (mục 5) — sửa:** `huy_that_bai` không phải mã app. App ghi `huy_yeu_cau` (thong_tin) và `huy_ket_qua` với nội
dung bắt đầu `ok=true`/`ok=false` ⇒ `ok=false` là `canh_bao`. `trang_thai_may_in`: xét TỪ ĐẦU TIÊN của noi_dung (`het_giay …`).
So chữ bằng dạng đã chuẩn hoá NFC ở cả TS lẫn SQL backfill; test đối chiếu TS↔SQL trên cùng bộ mẫu.

8.10 **UX sửa:** nút trong hộp xác nhận "Huỷ lệnh in" / "Giữ lại" (không dùng chữ "Huỷ" trơn). Lệnh `huy='khong'` KHÔNG có nút Huỷ;
có nút "Vì sao không huỷ được?" (hiện noiDung) và, với nhóm chưa xác nhận, "Bỏ khỏi hàng đợi". Dải trên app khi có lệnh tạm giữ:
"⏸ N hoá đơn đang chờ — máy in Hết giấy. Nạp giấy là tự in. Hoá đơn nào không cần nữa: bấm Huỷ TRƯỚC khi nạp giấy." App mất kết
nối ⇒ khối hàng đợi ghi "(có thể chưa cập nhật — app đang mất kết nối)" và khoá nút huỷ.
