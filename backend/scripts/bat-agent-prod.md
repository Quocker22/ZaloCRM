# Bật agent trên prod

Ba bước, chạy theo thứ tự. Mỗi bước có cách kiểm ngay sau đó.

Hai máy:
- `gnha-inco` **100.107.48.28** — Zalo CRM (cổng 3080) + Dokploy (3000)
- `gnha-crm-dev` **100.78.104.45** — Odoo LEDNELIA thật (1995 SP, 3719 khách, 7243 đơn)

Cùng LAN `192.168.18.x`, cách nhau 1.4ms. Cùng IP công cộng `103.104.122.48`.

---

## Bước 1 — Mở cổng Odoo cho CRM gọi vào

Odoo đang nghe `127.0.0.1:8069`, máy khác không gọi được.

```bash
ssh root@100.78.104.45
cd /etc/dokploy/compose/lednelia-apperp-izk6cg/code
cp docker-compose.yml docker-compose.yml.bak-$(date +%Y%m%d)
sed -i 's|"127.0.0.1:8069:80"|"8069:80"|' docker-compose.yml
docker compose up -d nginx
```

Kiểm — chạy **trên máy CRM**:

```bash
ssh root@100.107.48.28 'curl -s -o /dev/null -w "%{http_code}\n" http://gnha-crm-dev:8069/web/login'
```

Phải ra `200`. Ra `000` là chưa mở được.

Kiểm luôn KHÔNG lộ ra internet — chạy **từ máy anh**:

```bash
curl -s -m 8 -o /dev/null -w "%{http_code}\n" http://103.104.122.48:8069/web/login
```

Phải ra `000` (không kết nối được). Ra `200` là router đang chuyển tiếp cổng ra
ngoài — **dừng lại**, hoàn tác bằng `docker-compose.yml.bak-*` rồi báo tôi.

---

## Bước 2 — Tạo user `bot_zalo` trên Odoo

Bot KHÔNG chạy bằng `admin`. Đo thật trên bản local: với `group_staff`, Odoo
chặn `standard_price` ở tầng quyền và tự bỏ tab lợi nhuận khỏi báo cáo bán hàng
— hàng rào nằm ở Odoo nên prompt có bị lèo lái cũng không lấy được giá vốn.

```bash
ssh root@100.78.104.45
MK="bz_$(openssl rand -hex 16)"
echo "MẬT KHẨU BOT: $MK"        # ← chép lại, bước 3 cần

cat > /tmp/tao-bot.py <<'PY'
import os
NHOM = ['base.group_user',
        'sales_team.group_sale_salesman_all_leads',
        'stock.group_stock_user',
        'account.group_account_invoice',
        'incokit_pos.group_staff']
mk = os.environ['MK_BOT']
u = env['res.users'].search([('login','=','bot_zalo')], limit=1)
ids = [env.ref(g).id for g in NHOM]
if not u:
    u = env['res.users'].create({'name':'Bot Zalo','login':'bot_zalo',
                                 'password':mk,'groups_id':[(6,0,ids)]})
    print('ĐÃ TẠO uid', u.id)
else:
    u.write({'groups_id':[(6,0,ids)],'password':mk}); print('ĐÃ CẬP NHẬT uid', u.id)
env.cr.commit()

b = env['res.users'].browse(u.id)
print('group_system :', b.has_group('base.group_system'), '(phải False)')
print('sale_manager :', b.has_group('sales_team.group_sale_manager'), '(phải False)')
print('group_staff  :', b.has_group('incokit_pos.group_staff'), '(phải True)')
try:
    env['product.product'].with_user(b).search_read([], ['standard_price'], limit=1)
    print('giá vốn: ĐỌC ĐƯỢC — KHÔNG ĐẠT, báo lại')
except Exception:
    print('giá vốn: CHẶN — đạt')
PY

docker cp /tmp/tao-bot.py lednelia-apperp-izk6cg-odoo-1:/tmp/
docker exec -i -e MK_BOT="$MK" lednelia-apperp-izk6cg-odoo-1 \
  odoo shell -d nelia_prod --no-http < /tmp/tao-bot.py
```

Bốn dòng cuối phải là: `False`, `False`, `True`, `CHẶN`.

---

## Bước 3 — Thêm biến môi trường cho CRM

Trên Dokploy (`http://100.107.48.28:3000`) → project **zalocrm-zalo** →
Environment, thêm:

```
ODOO_URL=http://gnha-crm-dev:8069
ODOO_DB=nelia_prod
ODOO_USERNAME=bot_zalo
ODOO_PASSWORD=<mật khẩu ở bước 2>
AI_AGENT_NHANVIEN=1
```

**Chưa thêm `AI_AGENT_KHACH`** — bật nhân viên trước, xem chạy ổn rồi mới tới khách.

LLM không cần khai: agent lấy từ AiConfig per-org, cùng nguồn luồng RAG cũ
(`openai` + `ag/gemini-3-flash`). Đổi model trên giao diện là cả hai luồng đổi theo.

Dùng TÊN MÁY chứ không phải `192.168.18.23`: IP đó là DHCP, đổi khi khởi động
lại router là bot mất Odoo. Tên máy phân giải qua Tailscale nhưng vẫn đi thẳng
qua LAN — đo thật 1.7ms, không qua relay.

Rồi bấm **Deploy**.

---

## Thử

Vào Zalo, trong hội thoại bất kỳ, **nhân viên** gõ:

```
@bot shop bán những gì
```

Xem log:

```bash
ssh root@100.107.48.28 'docker logs -f --tail 50 zalo-crm-app 2>&1 | grep -i agent'
```

Thấy `[agent] xong lệnh nhân viên` kèm thời gian là chạy được.

Câu thử tiếp, tăng dần:

| Câu | Kiểm điều gì |
|---|---|
| `@bot giá led 3 bóng` | tra sản phẩm, ưu tiên hàng có giá |
| `@bot bảo hành đèn led mấy năm` | tra tài liệu kỹ thuật |
| `@bot công nợ chị Yến` | đọc công nợ (chỉ nhân viên) |
| `@bot doanh thu tháng này` | báo cáo — **không** được thấy lợi nhuận/giá vốn |
| `@bot lên đơn chị Yến 10 cái led 12v` | **tạo đơn THẬT trong Odoo** |

Câu cuối tạo dữ liệu thật. Thử khi đã yên tâm với các câu trên.

---

## Tắt

Hỏng chỗ nào thì xoá `AI_AGENT_NHANVIEN` trên Dokploy rồi Deploy — luồng RAG cũ
chạy lại như chưa có gì. Không cần rollback code.

## Bật luồng khách

Khi nhân viên dùng ổn, thêm `AI_AGENT_KHACH=1` và Deploy. Từ lúc đó khách nhắn
sẽ do agent trả lời thay luồng RAG cũ.

Lưu ý về hành vi luồng khách:
- Bot bí thì **im lặng** để nhân viên vào trả lời, không gửi "em chưa xử lý được".
- Agent lỗi → tự nhường luồng RAG cũ, khách vẫn được trả lời.
- Không bao giờ nói tồn kho: luôn báo còn hàng, chuẩn bị hàng là việc nhân viên.
