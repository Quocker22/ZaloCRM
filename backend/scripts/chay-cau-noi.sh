#!/usr/bin/env bash
# Chạy cầu nối Zalo ↔ agent trên máy dev.
#
# Điền 4 giá trị bên dưới rồi:  bash scripts/chay-cau-noi.sh
#
# Odoo lấy từ .env (ODOO_URL/DB/USERNAME/PASSWORD) — không cần điền lại.
set -euo pipefail
cd "$(dirname "$0")/.."

# ── ĐIỀN VÀO ĐÂY ────────────────────────────────────────────────────────────
# Key public API của CRM prod.
# Lấy ở giao diện: Cài đặt → API & Webhook → Public API key (bấm tạo nếu chưa có).
export PROD_API_KEY="${PROD_API_KEY:-}"

# 9router. Model local (qwen3) mất 75-90s mỗi lượt vì sinh khối suy nghĩ dài —
# không dùng thật được, nên để trống là script sẽ báo lỗi thay vì chạy chậm.
export LLM_BASE="${LLM_BASE:-}"
export LLM_KEY="${LLM_KEY:-}"
export LLM_MODEL="${LLM_MODEL:-gemini-3-flash}"
# ────────────────────────────────────────────────────────────────────────────

# Cổng 3080 chứ KHÔNG phải 3000 — 3000 là Dokploy trên cùng máy, cũng trả 401.
export PROD_URL="${PROD_URL:-http://100.107.48.28:3080}"

thieu=()
[ -z "$PROD_API_KEY" ] && thieu+=("PROD_API_KEY")
[ -z "$LLM_BASE" ] && thieu+=("LLM_BASE")
[ -z "$LLM_KEY" ] && thieu+=("LLM_KEY")
if [ ${#thieu[@]} -gt 0 ]; then
  echo "Còn thiếu: ${thieu[*]}"
  echo "Sửa trực tiếp trong scripts/chay-cau-noi.sh, hoặc truyền vào:"
  echo "  PROD_API_KEY=zcrm_... LLM_BASE=... LLM_KEY=... bash scripts/chay-cau-noi.sh"
  exit 1
fi

# Kiểm prod trước khi chạy: sai key thì biết ngay thay vì chờ vòng kéo đầu.
ma=$(curl -s -m 15 -o /dev/null -w '%{http_code}' \
  -H "x-api-key: $PROD_API_KEY" "$PROD_URL/api/public/conversations?limit=1" || echo 000)
case "$ma" in
  200) ;;
  401) echo "Key sai hoặc chưa tạo (401). Vào CRM → Cài đặt → API & Webhook."; exit 1 ;;
  000) echo "Không gọi được $PROD_URL — kiểm tra Tailscale."; exit 1 ;;
  *)   echo "Prod trả HTTP $ma, không chạy tiếp."; exit 1 ;;
esac

# Cảnh báo nếu prod chưa có bản API mới: thiếu 2 trường này thì bot đọc được
# tin nhưng KHÔNG gửi trả lời được.
if ! curl -s -m 15 -H "x-api-key: $PROD_API_KEY" \
     "$PROD_URL/api/public/conversations?limit=1" | grep -q 'zaloAccountId'; then
  echo
  echo "  CẢNH BÁO: prod chưa trả zaloAccountId — bot sẽ đọc được nhưng KHÔNG trả lời được."
  echo "  Cần bấm Deploy trên Dokploy (commit efd5f9e4 đã push lên nhánh"
  echo "  feat/kb-9router-handoff-fixes)."
  echo
  read -r -p "  Vẫn chạy để xem luồng? [y/N] " tl
  [ "$tl" = "y" ] || exit 1
fi

exec npx tsx --env-file-if-exists=.env scripts/cau-noi-zalo.ts
