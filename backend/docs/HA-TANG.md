# Hạ tầng — máy nào là gì

Đo thật 2026-08-04. **Đọc file này trước khi chạy bất kỳ lệnh nào trên server.**

Tên máy gây nhầm lẫn: `gnha-crm-dev` nghe như máy dev nhưng **CHÍNH LÀ máy chạy
Odoo production**. Anh đã xác nhận 2026-08-03.

---

## Ba máy

| Địa chỉ | Tên | Vai trò |
|---|---|---|
| `100.107.48.28` | `gnha-inco` | **CRM PRODUCTION** + Odoo THỬ |
| `100.78.104.45` | `gnha-crm-dev` | **ODOO PRODUCTION** (tên gây hiểu nhầm) |
| `100.97.134.55` | `gnha-crm` | Supabase, KHÔNG liên quan bot |

Máy 1 và 2 cùng LAN `192.168.18.x`, cách nhau 1.4ms, cùng IP công cộng
`103.104.122.48`.

---

## `gnha-inco` — 100.107.48.28

Máy khoẻ: 31GB RAM, 8 CPU.

**Đĩa** (dọn 05/08/2026: 94% → 85%, thu ~9GB từ image treo + build cache +
journal): phần còn lại là dữ liệu SỐNG — Supabase của incokit chiếm 15GB ở
`/etc/dokploy/compose/incokit-supabase-vtolmv`, KHÔNG được đụng. Muốn xuống
nữa phải chuyển dự án khác đi hoặc mở rộng đĩa — việc của anh quyết.
Lệnh dọn an toàn lặp lại được: `docker image prune -f && docker builder
prune -f && journalctl --vacuum-size=100M` (KHÔNG dùng `system prune -a`
bừa — máy này chạy production của NHIỀU dự án khác nhau).

| Cổng | Là gì |
|---|---|
| **3080** | **Zalo CRM production** ← bot chạy ở đây |
| 3000 | Dokploy (giao diện deploy) |
| 3001 | Uptime Kuma (giám sát + báo Telegram, dựng 05/08/2026) |
| 8069 | Odoo **THỬ** (`incokit_odoo_prod`) |
| 5434 | Postgres của Odoo thử |

**BẪY**: cổng 3000 và 3080 đều trả 401 khi không có key. Phân biệt bằng nội dung:
- CRM (3080) → `{"error":"API key required"}`
- Dokploy (3000) → `{"message":"Unauthorized"}`

Container CRM:
```
zalo-crm-app  zalo-crm-db  zalo-crm-redis  zalo-crm-minio  zalo-crm-clamav
```
Dokploy project: `zalocrm-zalo-xayzqq`
Repo: `github.com/Quocker22/ZaloCRM`, nhánh `feat/kb-9router-handoff-fixes`
Compose Dokploy dùng: `docker-compose.yml`

Container Odoo THỬ (tên `incokit_*` — dễ nhầm với prod):
```
incokit_odoo_prod   incokit_db_prod   incokit_nginx_prod
```
- Database: **`nelia_test`** (bản sao prod, chép 2026-08-04)
- Filestore: 211MB — đã chép từ prod. Thiếu nó thì giao diện web hỏng.
- `bot_zalo` có thêm `base.group_partner_manager` (2026-08-04) để tạo khách mới.
  Giá vốn VẪN bị Odoo chặn — đã đo lại sau khi cấp quyền.
- Cấu hình: `/opt/incokit/odoo.prod.conf` — có `dbfilter = ^nelia_test$`
- Addon: `/opt/incokit/custom_addons/incokit_pos` (bản cũ lưu ở `incokit_pos.bak-20260804`)
- Domain ngoài: **https://led.incokit.com** (qua tunnel `incokit-cloudflared-vwktos`)
- DB `incokit` cũ (37 SP demo) KHÔNG dùng được — thiếu cột addon mới thêm, để
  nó phục vụ là Odoo lỗi 500 toàn bộ. Đó là lý do có `dbfilter`.

---

## `gnha-crm-dev` — 100.78.104.45  ⚠️ ODOO PRODUCTION

Máy yếu hơn: 7GB RAM, 4 CPU. Đĩa còn 83GB.

**Nhân viên dùng hằng ngày. Cẩn thận mọi thao tác ghi.**

```
lednelia-apperp-izk6cg-odoo-1   ← Odoo THẬT
lednelia-apperp-izk6cg-db-1     ← DB THẬT (nelia_prod)
lednelia-cloudflared-6lxtwr-cloudflared-1
```

- Database: **`nelia_prod`** — 1995 SP, 3719 khách, **7243 đơn**
- Dokploy project: `lednelia-apperp-izk6cg`
- Repo: `github.com/Quocker22/lednelia-pos`, nhánh `main`
- **Compose Dokploy dùng: `docker-compose.prod.yml`** (KHÔNG phải
  `docker-compose.yml` — thư mục có BA file compose)
- Cổng 8069 nghe cả LAN từ 2026-08-04 (commit `563bd2c`) để CRM gọi XML-RPC
- Filestore: 207MB (đã chép sang bản thử 2026-08-04 — xem lỗi #3 bên dưới)

---

## Giám sát — Uptime Kuma (dựng 05/08/2026)

Container `uptime-kuma` trên gnha-inco, cổng **3001**, volume `uptime-kuma-data`,
có mount docker.sock để monitor được container. Restart always.

**Việc còn lại cần ANH làm một lần (bot không tự tạo tài khoản được):**

1. Mở `http://100.107.48.28:3001` (qua Tailscale) → tạo tài khoản admin.
2. Telegram: chat với `@BotFather` → `/newbot` → lấy token. Nhắn bot đó một
   tin bất kỳ rồi vào `https://api.telegram.org/bot<TOKEN>/getUpdates` lấy
   `chat.id`.
3. Trong Kuma: Settings → Notifications → Telegram → dán token + chat id →
   Default enabled.
4. Thêm monitor (mỗi cái interval 60s, retry 2):
   - HTTP `http://localhost:3080/api/public/conversations` — CRM (mong 401!
     dùng "Upside Down" = KHÔNG; chọn Accepted Status Codes có 401)
   - HTTP `https://quyetanh.com/web/login` — Odoo PROD qua domain
   - HTTP `http://localhost:8069/web/login` — Odoo THỬ
   - Docker Container `zalo-crm-app` (chọn Docker Host = socket đã mount)
   - Push monitor tên "disk-gnha-inco" — lấy URL push rồi cài cron dưới đây.
5. Cron disk trên gnha-inco (thay `<URL_PUSH>` bằng URL của monitor push):

```bash
cat > /etc/cron.hourly/bao-disk <<'EOF'
#!/bin/sh
# Đầy quá 85% thì KHÔNG ping — Kuma không nhận tín hiệu sẽ báo Telegram.
DUNG=$(df / --output=pcent | tail -1 | tr -dc '0-9')
[ "$DUNG" -lt 85 ] && curl -fsS -m 10 "<URL_PUSH>?status=up&msg=disk-${DUNG}%" >/dev/null
EOF
chmod +x /etc/cron.hourly/bao-disk
```

Xong bước 5 thì: container rớt / web sập / disk >85% → Telegram kêu trong ≤2 phút.

---

## Ba lỗi tôi đã mắc — đừng lặp lại

**1. Sửa nhầm file compose.** Thư mục Odoo có `docker-compose.yml`,
`docker-compose.prod.yml`, `docker-compose.local.yml`. Dokploy dùng file
`.prod.yml`. Kiểm bằng nhãn của chính container đang chạy:

```bash
docker inspect <container> --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}'
```

**2. `docker compose` không có `-p`.** Compose lấy tên project từ THƯ MỤC
(`code`), trong khi Dokploy chạy dưới tên `lednelia-apperp-izk6cg`. Kết quả:
tạo ra một stack THỨ HAI hoàn toàn mới thay vì sửa stack đang chạy — thêm 3
container rỗng và 2 volume rỗng.

**Đừng chạy `docker compose` tay trên máy Dokploy.** Sửa qua git rồi bấm Deploy.

**3. Sao chép Odoo mà quên FILESTORE.** Odoo lưu ảnh, tệp đính kèm và asset đã
biên dịch ở `/var/lib/odoo/filestore/<db>/`, NGOÀI database. Nạp mỗi dump SQL thì
giao diện web hỏng: bấm vào bất kỳ danh sách nào cũng ra `OwlError:
AssetsLoadingError`, log ghi `FileNotFoundError: .../filestore/...`.

Đo thật: prod 207MB filestore, bản thử chỉ 5.7MB sau khi nạp DB.

Chép kèm (chạy trên máy Odoo prod rồi chuyển sang):
```bash
# trên gnha-crm-dev (Odoo PROD)
docker exec lednelia-apperp-izk6cg-odoo-1 tar czf /tmp/fs.tgz -C /var/lib/odoo/filestore nelia_prod
docker cp lednelia-apperp-izk6cg-odoo-1:/tmp/fs.tgz /tmp/fs.tgz

# chuyển qua máy trung gian rồi sang gnha-inco, sau đó:
docker cp /tmp/fs.tgz incokit_odoo_prod:/tmp/fs.tgz
docker exec incokit_odoo_prod sh -c 'cd /var/lib/odoo/filestore && tar xzf /tmp/fs.tgz && mv nelia_prod nelia_test && chown -R odoo:odoo nelia_test'
```

Kiểm sau khi chép:
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://led.incokit.com/web/assets/54e3003/web_editor.backend_assets_wysiwyg.min.js   # 200
```

---

## Bot đang trỏ vào đâu

Biến trên Dokploy → project `zalocrm-zalo`:

```
ODOO_URL=http://incokit_nginx_prod   ← Odoo THỬ, cùng máy CRM
ODOO_DB=nelia_test                   ← bản sao, an toàn
```

Chuyển sang Odoo THẬT (chỉ khi đã yên tâm):
```
ODOO_URL=http://100.78.104.45:8069
ODOO_DB=nelia_prod
```

---

## Lệnh kiểm nhanh

```bash
# CRM production còn sống?
curl -s -o /dev/null -w '%{http_code}\n' http://100.107.48.28:3080/api/public/conversations   # 401 = sống

# Odoo THẬT còn sống? (không được động vào)
ssh root@100.78.104.45 'docker exec lednelia-apperp-izk6cg-db-1 psql -U odoo -d nelia_prod -tAc "select count(*) from sale_order"'

# Odoo THỬ còn sống?
curl -s -o /dev/null -w '%{http_code}\n' https://led.incokit.com/web/login   # 200 = sống

# Bot đang trỏ Odoo nào?
ssh root@100.107.48.28 'docker exec zalo-crm-app printenv ODOO_URL ODOO_DB'
```
