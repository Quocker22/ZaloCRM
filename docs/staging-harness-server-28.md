# Hệ thống HARNESS (cầm lái) — môi trường staging trên server .28

> **ĐỌC HẾT MỤC 0 TRƯỚC KHI GÕ LỆNH NÀO.** Áp dụng cho cả người lẫn AI agent.
> Tài liệu này là nguồn sự thật về staging. Sai một bước là đụng vào PROD đang phục vụ khách thật.

Tài liệu vận hành cho agent/người mới: dựng, chạy, cập nhật, test và dọn môi trường **staging**
trên server **.28**, dùng **Odoo staging `nelia_test`** — tách hoàn toàn khỏi prod.
Cập nhật lần cuối: **12/09/2026** (staging chuyển sang Dokploy autodeploy).

---

## 0. Bức tranh 30 giây

| | **PROD** (đừng đụng) | **STAGING / HARNESS** (tài liệu này) |
|---|---|---|
| Server bot | `.28` = `100.107.48.28` (Tailscale) | `.28` = `100.107.48.28` |
| Nhánh Git | `prod` | **`staging`** |
| Deploy | push `prod` → Dokploy tự build | **push `staging` → Dokploy tự build** (giống hệt prod) |
| Dokploy app | `zalo-lednelia` (`zalocrm-zalo-xayzqq`) | `zalo-lednelia-staging` (`zalocrm-zaloledneliastaging-fpajdy`) |
| File compose | `./docker-compose.yml` | **`./docker-compose.staging.yml`** |
| Bộ não luồng NV | máy gom đơn (`gom-don/`) + điều phối `dieu-phoi/lai.ts` | y hệt prod (staging = bản sao prod) |
| Máy in | BẬT (in ra máy thật ở shop) | **TẮT** — không có `AI_MAY_IN_AGENT_TOKEN`, cố ý |
| Container | `zalo-crm-app/db/redis/minio` | `zalo-stg-app/db/redis/minio/minio-init` |
| Cổng app | 3080 → https://zalocrm.incokit.com | **3081 → https://bot.vantaiminhthuc.com** |
| Odoo | `.45` = `100.78.104.45`, DB `nelia_prod`, https://quyetanh.com | `.28` container `incokit_odoo_prod`, DB **`nelia_test`**, https://led.incokit.com |
| Nick Zalo bot | Tiểu Mã Nelia (uid 630640428799521839) | **Vận Tải Minh Thức** (uid 619833576870383279) — lịch sử riêng, không chép từ Nelia |
| Công tắc | `AI_DIEU_PHOI=bong` (chạy bóng) | **`AI_DIEU_PHOI=lai`** |

### Luật vàng — nhận diện PROD trong 1 giây

**Thấy bất kỳ chữ nào sau đây là PROD, ĐỪNG GHI:**
`zalo-crm-*` · `zalocrm-zalo-xayzqq` · `quyetanh.com` · `nelia_prod` · `.45` / `100.78.104.45` · `zalocrm.incokit.com` · cổng `3080`

**Staging chỉ được động vào:**
`zalo-stg-*` · `zalocrm-zaloledneliastaging-fpajdy` · `zalocrm-staging_*` (volume) · `nelia_test` · `led.incokit.com` · `bot.vantaiminhthuc.com` · cổng `3081`

Kiểm nhanh trước khi chạy lệnh ghi:
```bash
docker inspect <container> --format '{{index .Config.Labels "com.docker.compose.project"}}'
# zalocrm-zaloledneliastaging-fpajdy = staging, an toàn
# zalocrm-zalo-xayzqq                = PROD, DỪNG LẠI
```

---

## 1. Server & truy cập

- **.28** — `ssh root@100.107.48.28` (Tailscale). Ubuntu, Docker + Docker Compose v2, Dokploy (quản lý **cả prod lẫn staging** — 2 app riêng, xem mục 5).
  Đĩa `/` ~175G (dùng ~50%). Mỗi lần build image ZaloCRM đẻ ~1GB layer; `docker image prune` khi đầy.
- **.45** — `ssh root@100.78.104.45` — Odoo **thật**. Chỉ dùng khi đồng bộ dữ liệu (đọc/pg_dump), không ghi.
- Bí mật (khoá LLM, DB pass, MinIO, JWT…) nằm trong env container prod; staging chép sang bằng `setup-env.sh` (mục 4). Không in ra log/chat.

---

## 2. Thư mục & file trên .28

**Từ 12/09/2026 code staging do Dokploy quản.** Thư mục Dokploy dùng để build:

```
/etc/dokploy/compose/zalocrm-zaloledneliastaging-fpajdy/
└─ code/                       # clone nhánh `staging` — Dokploy TỰ QUẢN
                               # ⚠️ ĐỪNG sửa/commit ở đây: mỗi lần deploy Dokploy
                               #    git reset --hard về GitHub, commit local MẤT SẠCH
```

Thư mục cũ (thời build tay) — **giữ lại vì có `.env` và backup, ĐỪNG sửa code trong đó**:

```
/opt/zalocrm-staging/
├─ code/                       # BẢN THỪA từ thời build tay (có .git, nhánh staging).
│                              # Sửa ở đây KHÔNG có tác dụng — Dokploy build từ clone riêng.
├─ docker-compose.staging.yml  # BẢN CŨ ngoài repo. Bản đang chạy nằm TRONG repo.
├─ .env                        # env staging (chmod 600) — nguồn để dán vào ô Environment Dokploy
├─ setup-env.sh                # tạo .env từ env container prod + override staging
├─ seed-db.sh                  # (bản cũ) chép DB prod vào staging — xem mục 6 cách đúng
├─ start.sh / stop.sh          # bật/tắt app staging (start.sh còn dừng bot Minh Thức cũ)
├─ fix-prod-zalo.sql           # SQL sửa tai nạn quét QR nhầm prod 28/08 (tham khảo)
├─ relink.sql                  # (đã bỏ dùng) relink lịch sử — xem bài học mục 7
├─ prod.sql                    # dump DB CRM prod gần nhất
└─ backup-zalo-accounts-*.sql  # backup bảng zalo_accounts + conversations prod trước khi sửa
```

Odoo staging: config `/opt/incokit/odoo.prod.conf` (mount vào `/etc/odoo/odoo.conf`), addons `/opt/incokit/custom_addons/incokit_pos` (mount `/mnt/custom-addons`), dữ liệu/filestore volume `incokit_odoo_data_prod` (→ `/var/lib/odoo`, filestore `/var/lib/odoo/filestore/nelia_test`).

---

## 3. Container, mạng, cổng, volume

### 3.1 Staging (project `zalocrm-zaloledneliastaging-fpajdy`, network `..._default`)

> Project name do Dokploy đặt. **Volume vẫn mang tên cũ `zalocrm-staging_*`** vì compose khai
> `external: true` — cố ý, để giữ dữ liệu từ thời build tay.

| Container | Image | Cổng host | Ghi chú |
|---|---|---|---|
| `zalo-stg-app` | `zalocrm-zaloledneliastaging-fpajdy-app` (Dokploy build) | `0.0.0.0:3081 → 3000` | Node 20, entry `node dist/app.js`; healthcheck HTTP `/` |
| `zalo-stg-db` | `postgres:16-alpine` | `127.0.0.1:5437 → 5432` | user `crmuser`, db `zalocrm`; volume `zalocrm-staging_pg_data` |
| `zalo-stg-redis` | `redis:7-alpine` | `127.0.0.1:6382 → 6379` | phiên điều phối (TTL 30'), khoá việc; volume `zalocrm-staging_redis_data` |
| `zalo-stg-minio` | `minio/minio` | `0.0.0.0:9012 → 9000`, `127.0.0.1:9013 → 9001` | bucket `zalocrm-stg`; volume `zalocrm-staging_minio_data` |
| `zalo-stg-minio-init` | `minio/mc` | — | tạo bucket rồi thoát |

Volume khác: `zalocrm-staging_file_storage` (`/var/lib/zalo-crm/files`), `zalocrm-staging_product_images` (`/app/product-images`).

### 3.2 Odoo staging (network `incokit_default`)

| Container | Image | Cổng | Ghi chú |
|---|---|---|---|
| `incokit_odoo_prod` | `odoo:17.0` | 8069 nội bộ (qua Cloudflare tunnel → https://led.incokit.com) | `dbfilter = ^nelia_test$`, `list_db = False`, addons `/mnt/custom-addons` |
| `incokit_db_prod` | `postgres:15-alpine` | `0.0.0.0:5434 → 5432` | user `odoo`; DB `nelia_test` (+ `incokit` của tổ chức khác — đừng đụng) |

Tên container có chữ `prod` nhưng **đây là Odoo dev/staging của LEDNELIA** (lịch sử đặt tên). Tài khoản bot: `bot_zalo` (id 18), mật khẩu **giống prod**.

### 3.3 Cloudflare tunnel

`bot.vantaiminhthuc.com` do một tunnel cloudflared **token-based** (ingress cấu hình trên dashboard Cloudflare, không có file local) trỏ về `127.0.0.1:3081`. Vì không đổi được ingress từ server, staging **chiếm cổng 3081**; bot Minh Thức cũ (`vantaiminhthuc-zalobot-vt4vow-app-1`, cùng cổng) đã `docker stop` và để nguyên như vậy. Các container `vantaiminhthuc-*` khác (cms, web, plausible, db, redis) là của web vận tải, **không liên quan**, không đụng.

### 3.4 Prod (chỉ để nhận diện, KHÔNG đụng)

`zalo-crm-app` (3080), `zalo-crm-db` (5435), `zalo-crm-redis` (6381), `zalo-crm-minio` (9010/9011), `zalo-crm-clamav`, `zalo-crm-backup`; compose Dokploy tại `/etc/dokploy/compose/zalocrm-zalo-xayzqq/code`; network `zalocrm-zalo-xayzqq_default`.

---

## 4. Biến môi trường staging (`/opt/zalocrm-staging/.env`)

Tạo bằng `setup-env.sh`: lấy toàn bộ env của container `zalo-crm-app` (khoá LLM, MinIO, DB pass, JWT, ENCRYPTION_KEY…) rồi **ghi đè** các khoá sau:

| Khoá | Giá trị staging | Ý nghĩa |
|---|---|---|
| `APP_PORT` | `3081` | cổng host (khớp tunnel) |
| `APP_URL` | `https://bot.vantaiminhthuc.com` | URL công khai |
| `DB_PORT` / `REDIS_PORT` / `MINIO_PORT` / `MINIO_CONSOLE_PORT` | `5437` / `6382` / `9012` / `9013` | cổng host, không đụng prod |
| `ODOO_URL` / `ODOO_PUBLIC_URL` | `https://led.incokit.com` | Odoo staging |
| `ODOO_DB` | `nelia_test` | |
| `ODOO_USERNAME` / `ODOO_PASSWORD` | `bot_zalo` / (như prod) | |
| `AI_DIEU_PHOI` | `lai` | **cầm lái**. `bong` = chạy bóng (đường cũ trả lời), `0` = tắt |
| `AI_MAY_IN_IPP_URL`, `AI_MAY_IN_AGENT_TOKEN` | (bỏ) | không nối máy in |

`DATABASE_URL` và `REDIS_URL` do compose tự ghép (`db:5432`, `redis:6379`), không đặt trong `.env`.
Khoá LLM (OpenRouter → `deepseek/deepseek-v4-flash-0731`) lấy từ bảng `ai_configs` + khoá mã hoá `ENCRYPTION_KEY` (chép từ prod nên đọc được). Test staging **tính tiền token vào cùng tài khoản** với prod.

---

## 5. Build & deploy code mới

**Deploy staging = push nhánh `staging`.** Không rsync, không build tay, không copy file.

```bash
# 1. (máy dev) test xanh
cd backend && npx vitest run && npx vitest run --config vitest.func.config.ts

# 2. push -> Dokploy tự build + deploy (~3-8 phút)
git push origin staging
```

Xem tiến trình: Dokploy UI → app `zalo-lednelia-staging` → tab **Deployments**.

Prod y hệt, chỉ khác tên nhánh:
```bash
git push origin prod     # -> Dokploy app zalo-lednelia
```

### Cấu hình Dokploy staging (đã đặt, chỉ đọc để hiểu)

| Mục | Giá trị |
|---|---|
| App | `zalo-lednelia-staging` → appName `zalocrm-zaloledneliastaging-fpajdy` |
| Repository / Branch | `Quocker22/ZaloCRM` / **`staging`** |
| Compose Path | **`./docker-compose.staging.yml`** ⚠️ KHÔNG phải `./docker-compose.yml` (đó là PROD) |
| Trigger | On Push, Autodeploy BẬT |
| Environment | dán nguyên khối từ `/opt/zalocrm-staging/.env` (34 biến) |

### `docker-compose.staging.yml` khác compose prod ĐÚNG 3 điểm

1. **`container_name: zalo-stg-*`** (prod `zalo-crm-*`) — tránh trùng tên container trên cùng máy.
2. **`volumes: external: true`** trỏ vào `zalocrm-staging_*` — giữ dữ liệu staging (DB có lịch sử chat thật).
   Bỏ `external` đi là staging khởi động TRẮNG.
3. **Bỏ service `backup` + `clamav`** — staging không cần.

Mọi thứ khác giữ y hệt prod để staging soi đúng prod. Port/DB/Odoo tách bằng ENV.

### Bẫy đã gặp (12/09) — đọc trước khi deploy lần đầu trên máy mới

**"container name zalo-stg-db is already in use"**: stack build-tay cũ đang giữ tên container.
Dokploy dùng project name khác nên coi nó là container lạ. Xử:
```bash
cd /opt/zalocrm-staging && docker compose -f docker-compose.staging.yml down   # KHÔNG có -v
```
`down` không `-v` chỉ xoá container, **volume giữ nguyên**. Rồi bấm Deploy lại.

**Migration Prisma**: image đã `prisma generate`. Nhánh có migration mới thì:
```bash
docker exec zalo-stg-app npx prisma migrate deploy
```


## 6. Dữ liệu CRM staging

DB staging = **bản dump prod** (`prod.sql`), giữ nguyên hội thoại/tin để training/test. Cách làm đúng (đã học bằng tai nạn):

```bash
ssh root@100.107.48.28
cd /opt/zalocrm-staging
docker exec zalo-crm-db pg_dump -U crmuser -d zalocrm --no-owner --no-acl > prod.sql
docker stop zalo-stg-app      # hoặc Dokploy UI -> Stop
docker exec zalo-stg-db psql -U crmuser -d zalocrm -qc 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
docker exec -i zalo-stg-db psql -U crmuser -d zalocrm -q < prod.sql
# VÔ HIỆU các nick prod chép sang — KHÔNG được để staging dùng phiên Zalo của Nelia thật
docker exec zalo-stg-db psql -U crmuser -d zalocrm -c \
 "UPDATE zalo_accounts SET session_data=NULL, status='disconnected', archived_at=coalesce(archived_at, now())"
docker start zalo-stg-app     # hoặc Dokploy UI -> Start
```

**Cấm `DELETE FROM zalo_accounts`**: FK `conversations.zalo_account_id` ON DELETE CASCADE → xoá sạch hội thoại + tin.
Sau khi chép lại, **xoá hội thoại/tin của các nick prod** (mục 7) — không gắn sang nick test.

Luôn dùng `docker exec -i` khi đưa SQL qua stdin; thiếu `-i` psql không nhận gì và **im lặng không chạy**.

---

## 7. Nick Zalo test — KHÔNG chép lịch sử chat từ nick khác

- Nick test: **Vận Tải Minh Thức** (uid `619833576870383279`), quét QR tại https://bot.vantaiminhthuc.com → Cài đặt → Tài khoản Zalo → *Kết nối kênh* (web login `demo@shop.vn`, mật khẩu như prod). Dòng DB staging: `d952cf36-12c9-48cf-b9dc-cf89ff5fda25`.
- **Không dùng "Quét lại QR" trên thẻ nick khác; không quét ở zalocrm.incokit.com (prod)** — 28/08 đã ghi đè nhầm nick Nelia, phải hoán đổi lại bằng `fix-prod-zalo.sql` (`zalo_uid` có unique index → đặt uid tạm trước).
- **Bài học 29/08 — ID người trong chat 1-1 là ID theo từng nick nhìn thấy** (Trần Hưng = `1520…` dưới mắt Nelia, `3835…` dưới mắt Minh Thức). Chép hội thoại 1-1 của Nelia sang nick Minh Thức (relink `zalo_account_id`) làm bot trả lời vào thread vô nghĩa → Zalo `Tham số không hợp lệ [114]` cho mọi lệnh gửi/typing/xem hồ sơ. ID **nhóm** thì toàn cục nên nhóm vẫn chạy. Anh Quốc chốt: **hai nick không liên quan thì không đồng bộ lịch sử** — đã xoá sạch 31 hội thoại/3.5k tin chép từ Nelia khỏi nick test (29/08 17:49). Lịch sử Nelia để training vẫn có trong `prod.sql` và DB prod.
- Nick test tự đồng bộ hội thoại của chính nó khi có tin mới (backfill khi kết nối). Muốn xoá trắng lại: `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE zalo_account_id='<id nick>'); DELETE FROM conversations WHERE zalo_account_id='<id nick>';` rồi `docker restart zalo-stg-app`.
- Nhận diện NV: bảng NV của org (chép từ prod). NV nhắn **1-1** cho nick test (từ Zalo cá nhân, hai nick phải là bạn) → luồng NV, không cần tag; trong **nhóm** phải tag `@Vận Tải Minh Thức`. Không tạo được hội thoại 1-1 từ phía CRM web trước — tin đầu phải đi từ điện thoại vào.
- Ảnh cũ trong lịch sử trỏ `http://100.107.48.28:3080/files/media/…` (host prod) → không hiện trên domain staging, chỉ là cosmetic.

## 8. Odoo staging (`nelia_test`) — đồng bộ từ prod

Đã đồng bộ 28/08 16:00 (8.970 đơn tới S15485, 2.036 SP, filestore 210MB, code `incokit_pos`). Làm lại khi cần:

```bash
# (.45) dump
ssh root@100.78.104.45 'docker exec lednelia-apperp-izk6cg-db-1 pg_dump -U odoo -Fc nelia_prod > /tmp/nelia_prod.dump
  && docker exec lednelia-apperp-izk6cg-odoo-1 tar czf - -C /var/lib/odoo/filestore nelia_prod > /tmp/nelia_fs.tgz
  && docker exec lednelia-apperp-izk6cg-odoo-1 tar czf - -C /mnt/custom-addons incokit_pos > /tmp/incokit_pos.tgz'
# chuyển .45 → .28 (qua máy dev, ~110MB)
for f in nelia_prod.dump nelia_fs.tgz incokit_pos.tgz; do ssh root@100.78.104.45 "cat /tmp/$f" | ssh root@100.107.48.28 "cat > /tmp/$f"; done
# (.28) restore — Odoo dev gián đoạn vài phút
ssh root@100.107.48.28
docker stop incokit_odoo_prod
docker exec incokit_db_prod psql -U odoo -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='nelia_test' AND pid<>pg_backend_pid()"
docker exec incokit_db_prod psql -U odoo -d postgres -c 'DROP DATABASE nelia_test' && docker exec incokit_db_prod psql -U odoo -d postgres -c 'CREATE DATABASE nelia_test OWNER odoo'
docker cp /tmp/nelia_prod.dump incokit_db_prod:/tmp/ && docker exec incokit_db_prod pg_restore -U odoo -d nelia_test --no-owner --no-acl -j 4 /tmp/nelia_prod.dump
# tắt cron + mail để dev không tự chạy/gửi mail, khoá base url
docker exec incokit_db_prod psql -U odoo -d nelia_test -c "UPDATE ir_cron SET active=false; UPDATE ir_mail_server SET active=false; UPDATE fetchmail_server SET active=false; UPDATE ir_config_parameter SET value='https://led.incokit.com' WHERE key='web.base.url';"
# filestore + addon
docker run --rm -v incokit_odoo_data_prod:/v -v /tmp:/t alpine sh -c 'rm -rf /v/filestore/nelia_test && tar xzf /t/nelia_fs.tgz -C /v/filestore && mv /v/filestore/nelia_prod /v/filestore/nelia_test && chown -R 101:101 /v/filestore/nelia_test'
cd /opt/incokit/custom_addons && mv incokit_pos incokit_pos.bak-$(date +%Y%m%d) && tar xzf /tmp/incokit_pos.tgz
docker start incokit_odoo_prod
```

Kiểm: từ container staging `layOdoo().searchRead('res.users',[['login','=','bot_zalo']])` phải trả id 18.
**Filestore phải thuộc user odoo của container (`docker exec incokit_odoo_prod id` → uid 101)** — 29/08 chown nhầm 100:101 → Odoo không ghi được bundle assets → `/web` **màn hình trắng**, log `PermissionError … filestore/nelia_test/checklist`. Sửa: `docker run --rm -v incokit_odoo_data_prod:/v alpine chown -R 101:101 /v/filestore/nelia_test` rồi restart.
Lỗi log `res_users.incokit_must_change_password does not exist` là cron của DB `incokit` (tổ chức khác, có từ trước) — bỏ qua.

---

## 9. Kiến trúc bộ cầm lái (những gì agent cần biết để sửa)

Thư mục `backend/src/modules/ai/agent/dieu-phoi/`:

| File | Vai trò |
|---|---|
| `phien-don.ts` | **Object phiên cố định**: `khach`, `dong[] {ten, spId, soLuong, donGia, tang}`, `phuPhi`, `vatPhanTram`, `chietKhau…`, `giaoHang`, `thanhToan`; mỗi ô có trạng thái `da_co / thieu / mo_ho / tu_choi`. `bangChung` (khách/SP đã tra), `donVuaLen`, `dangHoi`, `choXacNhan`. `oConThieu()` quyết hỏi ô nào — code thuần. |
| `dieu-phoi.ts` | Một lượt model (DeepSeek, reasoning bật) qua harness `chayVongKiemChung`: được gọi tool tìm ≤3 vòng rồi PHẢI chốt bằng tool `cap_nhat_phien`. `apCapNhat` kiểm kiểu output (id/số/enum), không kiểm chữ. |
| `tool-tim.ts` | `tim_khach` / `tim_sp` trả JSON **có id**, tích luỹ vào `phien.bangChung`. |
| `lai.ts` | **Driver**: đọc phiên (Redis) → model → `doiChieuBangChung` (id phải nằm trong bằng chứng, bịa thì bỏ) → `traBu` (tra tất định ô thiếu id) → `soatSoTruocKhiGhi` (lượt model soát SL/giá) → đủ thì ghi Odoo (`tao_don_nhap`/`sua_don`/`tao_khach_hang`) → render tin từ object (`soanCauHoi`, `tomTatDon`). Vai `khach`: không tim_khach, không đặt giá, tóm tắt chờ "ok". |
| `bong.ts` | `cheDieuPhoi()` đọc `AI_DIEU_PHOI`; chạy bóng khi `bong`. |
| `kho-phien.ts` | phiên trong Redis `dieu-phoi:phien:<conversationId>`, TTL 30'. |

Nối vào luồng: `noi-zalo/luong-nhan-vien.ts` — khi `cheDieuPhoi()==='lai'` gọi `laiLuotNhanVien` **trước** máy gom đơn; `nhan=true` là xong; `khong_viec` → agent thường (báo cáo, in, tồn…); lỗi/quá giờ (45s) → rơi về gom đơn cũ. Luồng khách hiện **chưa** nối cầm lái (chỉ có mode khách trong `lai.ts`, chưa bật) — agent tư vấn cũ vẫn trả lời.

Nguyên tắc nhánh (anh Quốc 27/08): **không regex, không if/else trên chữ NV**. Model sai → sửa prompt (`DAN_LAI`/`DAN_KHACH`), object, hay vòng kiểm chứng; không thêm luật code đọc chữ. Hàng rào chỉ ở tầng dữ liệu (id trong bằng chứng, ô thiếu thì không ghi, giá khách không đặt).

Test: `backend/tests/ai/agent/dieu-phoi/*.test.ts` (tiêm `tim`/`ghi` giả, `kiemSo:false`).

---

## 9b. RAG & bộ nhớ của bot (chép nguyên từ prod, nằm trong DB staging)

Tất cả nằm trong DB CRM (`zalo-stg-db`, chép từ dump prod) + volume ảnh + Redis. Không có pgvector, không có dịch vụ vector ngoài.

### Tri thức (RAG) — `backend/src/modules/ai/knowledge/`

| Thành phần | Ở đâu | Số liệu 28/08 | Ghi chú |
|---|---|---|---|
| Tài liệu | bảng `knowledge_documents` (`title`, `source`, `content`) | 112 tài liệu | gồm 93 PDF datasheet nạp từ file Zalo (24/08), tài liệu chữ, và 1 tài liệu `source='sheet-muc-luc'` |
| Chunk + vector | bảng `knowledge_chunks` (`content`, `embedding Float[]`, `embed_provider/model/dim`) | 1.292 chunk, 3.072 chiều: 1.080 `gemini-embedding-001` + 212 `bge-m3` (đợt cũ) | vector là `double precision[]`, cosine tính trong Node (`cosine.ts`, `rank.ts`) |
| Embedding | `ai_configs`: `embed_provider=gemini`, `embed_model=gemini-embedding-001`, `embed_base_url=https://generativelanguage.googleapis.com`; khoá `EMBED_API_KEY` trong `.env` | | Gemini quota theo **phút** → 429 thì chờ ~65s; đổi provider = đổi số chiều = phải nạp lại toàn bộ |
| Tìm kiếm | `knowledge-service.ts#searchKnowledge` | top-k | **hybrid**: vector + khớp từ khoá, trộn xen kẽ 2 vector : 1 lexical; embed lỗi → rơi về lexical-only, không câm |
| Cờ org | `ai_configs`: `kb_enabled=t`, `auto_reply_enabled=t`, `auto_reply_confidence_threshold=0.5`, `guideline_engine_mode=off` | | luồng khách dùng `rag-reply.ts` (một lượt, KB nhồi prompt) song song với agent tool |
| Nạp | `POST /api/v1/ai/knowledge {title, content}` (JWT) hoặc script nạp file Zalo | | `ingestDocument` embed fail → đẻ tài liệu mồ côi 0 chunk; kiểm bằng `SELECT d.id FROM knowledge_documents d LEFT JOIN knowledge_chunks c ON c.document_id=d.id GROUP BY d.id HAVING count(c.id)=0` |
| Mục lục SP | `knowledge_documents` `source='sheet-muc-luc'` (`muc-luc.ts`) | | sinh **tất định** từ Google Sheet (nguồn sự thật thông số + ảnh) bằng `scripts/dong-bo-sheet.mjs` (chạy trong container: `docker exec zalo-stg-app node scripts/dong-bo-sheet.mjs`); nhét vào prompt mọi lượt để trả lời câu tổng hợp "shop có những dòng nào" |
| Kho file gửi được | **bảng `messages`** `content_type='file'` (`kho-tai-lieu.ts`) — không bảng riêng | | datasheet NV gửi vào nhóm là gửi lại được ngay; lọc bảng giá nội bộ ở code trước khi tool thấy; file tải về tmp trong container |
| Ảnh SP | volume `zalocrm-staging_product_images` → `/app/product-images` + `_kb_match.json` (`product-image.ts`) | 252 file (đã `docker cp` từ prod 28/08) | chỉ gửi khi câu trả lời nhắc đúng 1 SP có ảnh |

### Bộ nhớ (những gì bot "học"/nhớ)

| Bộ nhớ | Ở đâu | Số liệu | Cơ chế |
|---|---|---|---|
| **Luật NV dặn** | bảng `ai_guidelines` `vai='nhanvien'` (`luat-nhan-vien.ts`) | 46 luật | NV nói "từ giờ…" → tool `ghi_luat`/`quen_luat`; mỗi lượt nạp tối đa **900 ký tự** (~15–20 luật), luật > 200 ký tự bị coi là bịa; lọc luật rỗng nghĩa; `guideline_match_logs` = 0 vì engine match `off` |
| **Alias SP học được** | bảng `sp_alias` (`ten_goi` bỏ dấu → `product_id`, `dem_dung`, `locked`) (`sp-alias.ts`) | 43 alias | học khi NV chọn từ danh sách gần đúng; không học tên chung ("a" chọn màu); admin sửa tay → `locked=1`, bot không đè |
| **Phiên gom đơn (đường cũ)** | bảng `phien_gom_don` (hạn 15') | | máy gom đơn regex — staging không dùng khi `AI_DIEU_PHOI=lai` |
| **Phiên cầm lái** | Redis `zalo-stg-redis` key `dieu-phoi:phien:<conversationId>` (TTL 30') | | object phiên (mục 9) + bằng chứng tra cứu + đơn vừa lên + đang chờ chọn |
| **Khoá việc / hàng đợi** | Redis (khoá theo hội thoại + nội dung) | | chống 2 lượt xử cùng một tin |
| **Lịch sử hội thoại** | bảng `conversations`, `messages` (`layLichSu`) | nick test tự đồng bộ hội thoại của chính nó | ngữ cảnh cho agent + con điều phối; lịch sử Nelia để training nằm trong `prod.sql`/DB prod, KHÔNG chép sang nick khác (mục 7) |
| **Nhật ký quyết định** | bảng `tool_call_logs` (`vai`: `nhanvien`/`khach`/`giam_sat`/`dieu_phoi`) | | mọi tool, giám sát, điều phối ghi vào đây → đo 4 chỉ số bot |
| Danh sách NV | bảng NV của org (`agent-operator-service.ts`, `laNhanVienSync`) | | quyết ai đi luồng NV |

### Đồng bộ lại các thứ trên từ prod
- Luật NV, alias, tài liệu, chunk, mục lục: **đều nằm trong dump prod** → chạy lại mục 6 (lịch sử chat của Nelia thì không chép sang nick test — mục 7). Khoá `EMBED_API_KEY`/`ENCRYPTION_KEY` chép sẵn nên vector cũ đọc được ngay.
- Ảnh SP: `docker cp zalo-crm-app:/app/product-images /tmp/pi && docker cp /tmp/pi/. zalo-stg-app:/app/product-images/`.
- Mục lục sheet: chạy `dong-bo-sheet.mjs` trong container staging (cần khoá Google Sheet trong env — chép từ prod).
- Phiên Redis không cần chép (sống 30').

## 10. Replay trên dữ liệu thật (không gửi Zalo, không ghi Odoo)

Cách kiểm nhanh nhất một thay đổi: chạy driver trong container tạm với `dist` mới, Odoo đọc thật, ghi giả lập. Script mẫu ở scratchpad phiên trước: `replay-lai.mjs` (NV, 7 kịch bản 27/08) và `replay-lai-khach.mjs` (hội thoại khách 27–28/08). Khung:

```bash
# máy dev
cd ZaloCRM-dieu-phoi/backend && rm -rf dist && npx tsc -p tsconfig.json && tar czf /tmp/dist-lai.tgz dist
scp /tmp/dist-lai.tgz replay-lai.mjs root@100.107.48.28:/tmp/
# .28 — env lấy từ container staging (không in ra)
ssh root@100.107.48.28 'rm -rf /tmp/dist-lai && mkdir /tmp/dist-lai && tar xzf /tmp/dist-lai.tgz -C /tmp/dist-lai
 && docker inspect zalo-stg-app --format "{{range .Config.Env}}{{println .}}{{end}}" > /tmp/env-stg && chmod 600 /tmp/env-stg
 && docker run --rm --network zalocrm-zaloledneliastaging-fpajdy_default --env-file /tmp/env-stg -e AI_DIEU_PHOI=lai \
      -v /tmp/dist-lai/dist:/app/dist:ro -v /tmp/replay-lai.mjs:/app/replay-lai.mjs:ro \
      zalocrm-zaloledneliastaging-fpajdy-app node /app/replay-lai.mjs'
```

Script import từ `/app/dist/...`, phiên giữ trong `Map`, `deps.ghi` giả lập `taoDon/suaDon/taoKhach`, in `NV / LAI / BOT / PHIÊN` từng lượt. Tiêu chí: object gọi Odoo (khách id, SP id, SL, giá) đúng — không so chữ.

---

## 11. Vận hành hằng ngày

```bash
# trạng thái
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'zalo-stg|incokit_odoo'
# log bot (tin, tool, cầm lái)
docker logs -f --since 10m zalo-stg-app | grep -E '\[lai\]|\[agent/nv\]|\[dieu-phoi\]|ERROR'
# log điều phối trong DB (bảng tool_call_logs)
docker exec zalo-stg-db psql -U crmuser -d zalocrm -c "SELECT created_at, tool_name, left(output,200) FROM tool_call_logs WHERE tool_name IN ('dieu_phoi_lai','soat_so','tao_don_nhap','sua_don') ORDER BY created_at DESC LIMIT 20"
# phiên cầm lái đang mở
docker exec zalo-stg-redis redis-cli --scan --pattern 'dieu-phoi:phien:*'
# đổi biến môi trường: sửa ở Dokploy UI -> tab Environment -> Deploy
#   (KHÔNG sửa /opt/zalocrm-staging/.env nữa — file đó chỉ còn là bản gốc để dán)
# tắt / bật / deploy lại: Dokploy UI -> app zalo-lednelia-staging -> Start/Stop/Deploy
#   (start.sh / stop.sh cũ KHÔNG dùng nữa — chúng thao tác stack build-tay đã ngừng)
```

### Kiểm nhanh staging sống hay chết
```bash
curl -s -o /dev/null -w "staging: %{http_code}\n" https://bot.vantaiminhthuc.com/
curl -s -o /dev/null -w "prod:    %{http_code}\n" http://localhost:3080/     # phải luôn 200
docker ps --filter name=zalo-stg --format '{{.Names}}\t{{.Status}}'
```

Đơn test nằm trong Odoo staging https://led.incokit.com (đăng nhập tài khoản Odoo dev). Không cần huỷ.

---

## 12. Đừng làm

- Đừng chạy lệnh ghi lên `zalo-crm-db`, `zalo-crm-app`, `.45`, `nelia_prod`, `quyetanh.com`.
- Đừng `DELETE FROM zalo_accounts` (cascade). Đừng bật `session_data` của nick prod trong staging.
- Đừng quét QR ở zalocrm.incokit.com cho việc test; đừng "Quét lại QR" trên thẻ nick đang chạy.
- Đừng thêm regex/if-else đọc chữ NV vào `dieu-phoi/` — đó là lý do nhánh này tồn tại.
- Đừng `docker compose down -v` (mất volume DB/MinIO staging). `down` KHÔNG `-v` thì an toàn.
- Đừng chạy hai bot cùng một nick Zalo (prod + staging) — phiên sẽ đá nhau.

**Từ 12/09 (Dokploy) thêm:**
- Đừng sửa/commit code trong `/etc/dokploy/compose/*/code` — Dokploy `git reset --hard` mỗi lần
  deploy, commit local **mất sạch**. Sửa ở máy dev rồi push.
- Đừng đổi Compose Path của app staging sang `./docker-compose.yml` — đó là compose PROD
  (`container_name: zalo-crm-*`), deploy sẽ đâm vào container prod đang chạy.
- Đừng xoá `external: true` trong `docker-compose.staging.yml` — staging sẽ khởi động với
  volume rỗng, mất toàn bộ lịch sử chat.
- Đừng thêm `AI_MAY_IN_AGENT_TOKEN` / `AI_MAY_IN_IPP_URL` vào env staging — sẽ đẩy lệnh in
  xuống **máy in thật ở shop**. Thiếu 2 biến này là cố ý; code tự tắt tính năng in.
- Đừng nhúng token GitHub vào `git remote` trên server (nằm chữ thường trong `.git/config`).
- Đừng sửa code ở `/opt/zalocrm-staging/code` rồi tưởng đã deploy — thư mục đó là bản thừa.

---

## 13. Lịch sử thay đổi

- 27/08: tách nhánh `feat/dieu-phoi-cam-lai`; driver `lai.ts`; 11 commit; replay NV 7 kịch bản ×2 lần đúng 100% object ghi Odoo.
- 28/08: mode khách trong driver (chưa nối luồng); dựng staging `/opt/zalocrm-staging`; tai nạn quét QR nhầm prod và cách sửa (`fix-prod-zalo.sql`); trỏ bot.vantaiminhthuc.com → 3081; đồng bộ Odoo prod → `nelia_test`.
- **11-12/09: git-hoá staging + chuyển sang Dokploy autodeploy.**
  `/opt/zalocrm-staging/code` trước là copy tay không git. Đã: backup 5 lớp → đo diff với 3 nhánh
  (`prod` 3799 dòng / `feat/dieu-phoi-cam-lai` = `kb9` 1913 dòng — 2 nhánh này TRÙNG tree hash)
  → soi từng file xác nhận không có code người khác → tắt RAG sản phẩm (`RAG_SAN_PHAM=0`,
  drop bảng `product_index` 1292 dòng, dump giữ ở `/root/staging-backups/`) → dựng nhánh `staging`
  tách từ `prod` → thêm `docker-compose.staging.yml` vào repo → tạo Dokploy app.
  Bài học: (a) volume Docker prefix theo **project name**, prod và staging cùng khai `pg_data`
  vẫn KHÔNG đè nhau; (b) `container_name` cứng thì trùng, phải `down` stack cũ trước;
  (c) `git checkout -- .` + `git clean -fd` là 2 lệnh xoá code — backup trước, và lưu `git diff`
  ra file để hoàn tác được.
- 29/08: phát hiện ID 1-1 theo từng nick → bỏ relink lịch sử, xoá sạch hội thoại chép từ Nelia khỏi nick test; nhóm chạy OK, 1-1 phải bắt đầu từ điện thoại.
