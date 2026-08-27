# Print Agent — in hoá đơn qua agent Rust, bỏ Tailscale

Ngày: 2026-08-27 · Trạng thái: đã duyệt thiết kế, chờ viết plan

## Vấn đề

Đường in hiện tại: ZaloCRM (.28) → Tailscale → SSH tunnel ngược (NSSM) →
socket-proxy → IPP thẳng tới máy in HP 4003 (192.168.1.112). Ba vấn đề:

1. **Rủi ro bảo mật**: máy shop đăng nhập Tailscale tài khoản CÁ NHÂN của anh
   → máy nhiều-người-dùng đó thành thành viên tailnet của anh. Bị chiếm =
   ở trong mạng riêng.
2. **Chắp vá**: SSH tunnel + socket-proxy + NSSM = 3 mảnh phải nuôi, đã chết
   vài lần (quyền key SYSTEM, timeout task…).
3. **A5 không chọn được khay**: Microsoft IPP Class Driver bỏ qua media-source
   → luôn kéo Tray 1 (A4). Máy có Tray 2 (A5) nhưng IPP không ép được.

## Giải pháp

Agent Rust chạy Windows Service ở máy shop, TỰ NỐI RA server (không VPN),
nhận job in (PDF do server render sẵn) rồi in QUA DRIVER HP (chọn khay A5 ăn).

```
NV nhắn Zalo "in đơn X"
  → ZaloCRM (.28): tool in_hoa_don → xuất hoá đơn → tải PDF từ Odoo
  → bảng print_jobs (như hiện tại)
  → cron/đẩy job → Agent (WebSocket, server→agent)
  → Agent in qua winspool (driver HP) → máy in → tờ A5
  → Agent báo kết quả → cập nhật print_jobs
```

## Thành phần

### 1. Print Agent (Rust) — MỚI, chạy ở máy shop
- 1 binary .exe, Windows Service (dùng windows-service crate). Không runtime.
- Kết nối WebSocket ra server (wss://), tự reconnect + heartbeat.
- Auth: 1 token cố định (config), chỉ quyền nhận job in + báo kết quả.
- Nhận job `{id, pdf_base64, paper_size:"A5", tray:"tray-2", copies}`:
  - giải mã PDF → in qua crate `printers`/winspool với driver HP đã cài,
    truyền paper size + tray. (A5/khay chọn được vì đi qua driver, không IPP.)
- Báo về `{id, ket_qua: da_in|loi, loi_cuoi?}`.
- Config file: server_url, token, printer_name, tray mặc định.
- KHÔNG biết Odoo, KHÔNG có VPN, KHÔNG thấy máy nào khác. Client câm.

### 2. Server-side (ZaloCRM .28) — SỬA
- Endpoint WebSocket cho agent (tách khỏi socket.io của web FE — agent dùng
  giao thức WS thô đơn giản, hoặc socket.io-client Rust; chốt ở plan).
  Xác thực bằng AGENT_TOKEN riêng (không phải JWT user).
- Đổi cron may-in: thay vì gửi IPP qua socket-proxy, RENDER PDF (đã có
  HoaDonAnhClient.taiPdf) rồi ĐẨY job {pdf_base64, paper_size, tray} qua WS.
- Agent offline → job giữ `cho_in`, agent nối lại → đẩy tiếp. Luật A3 (chống
  in đôi) GIỮ NGUYÊN: job đã `da_gui` mà mất phản hồi → khong_ro, chờ xác minh.
- Bảng print_jobs, hàng đợi, tool in_hoa_don: GIỮ NGUYÊN.

### 3. Gỡ bỏ (sau khi agent chạy ổn)
- SSH tunnel (authorized_keys trên .28), socket-proxy systemd (.28),
  NSSM service SSH (máy shop), Tailscale (máy shop).
- → Máy shop KHÔNG còn trong tailnet của anh. Hết rủi ro #1.

## Giữ nguyên
- Tool in_hoa_don, "in = xuất hoá đơn", bảng print_jobs, khổ A5 trong Odoo.

## Bảo mật
- Agent token chỉ nhận job in + báo kết quả. Thu hồi được từ server.
- PDF do server render, agent không chạm Odoo. Máy shop bị chiếm không lộ gì.
- wss:// (TLS): .28 ĐÃ có dokploy-traefik (cổng 80/443 công khai, cert tự
  động). Chỉ cần khai 1 route/domain cho endpoint agent → Traefik cấp cert.
  KHÔNG phải dựng HTTPS từ đầu.

## Test
- Server: WebSocket nhận job + đẩy + cập nhật print_jobs → test bằng agent
  giả (mock WS client), TDD như mọi tool.
- Agent Rust: job giả → in ra file PDF (dry-run) trước; rồi in thật ra máy.

## Rủi ro
- wss công khai: ĐÃ có Traefik/cert tự động trên .28 — chỉ khai route. (đã kiểm)
- Codebase Rust MỚI phải nuôi (build, ký, cập nhật máy shop). Anh chấp nhận.
- A5 phụ thuộc driver HP thật cài đúng trên máy shop + Tray 2 nạp giấy A5.
