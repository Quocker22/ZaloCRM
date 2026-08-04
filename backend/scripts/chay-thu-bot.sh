#!/usr/bin/env bash
# Sân chơi thử bot — KHÔNG đụng prod.
#
# Odoo LOCAL trên máy anh (bản sao: 1997 SP, 3720 khách, 7266 đơn — gần y hệt
# prod). Lên đơn thoải mái, đơn nằm trong Odoo local, prod không hề biết.
#
# Chạy:  bash scripts/chay-thu-bot.sh
# Rồi mở http://localhost:4545 — có 2 tab: vai KHÁCH và vai NHÂN VIÊN.
set -euo pipefail
cd "$(dirname "$0")/.."

# ── ĐIỀN API KEY ────────────────────────────────────────────────────────────
# Lấy trên CRM prod: Cài đặt → AI → API key (provider openai).
export LLM_KEY="${LLM_KEY:-}"
# ────────────────────────────────────────────────────────────────────────────

export LLM_BASE="${LLM_BASE:-https://ai.byhung.com/v1}"
export LLM_MODEL="${LLM_MODEL:-ag/gemini-3-flash}"

# Odoo LOCAL — KHÔNG phải prod. Đây là điểm mấu chốt: mọi đơn tạo ra nằm ở đây.
export ODOO_URL="${ODOO_URL:-http://localhost:8069}"
export ODOO_DB="${ODOO_DB:-nelia_prod}"
export ODOO_USERNAME="${ODOO_USERNAME:-bot_zalo}"
export ODOO_PASSWORD="${ODOO_PASSWORD:-bot_zalo_2026}"

if [ -z "$LLM_KEY" ]; then
  echo "Thiếu LLM_KEY."
  echo "  Sửa trong scripts/chay-thu-bot.sh, hoặc:"
  echo "    LLM_KEY=sk-... bash scripts/chay-thu-bot.sh"
  exit 1
fi

# Chặn nhầm prod: URL phải là localhost. Gõ nhầm một lần là đơn thử chui vào
# Odoo thật, lẫn với đơn nhân viên.
case "$ODOO_URL" in
  *localhost*|*127.0.0.1*) ;;
  *) echo "DỪNG: ODOO_URL=$ODOO_URL không phải máy local."
     echo "Script này để thử, không được trỏ vào Odoo thật."; exit 1 ;;
esac

# Odoo local sống chưa?
ma=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$ODOO_URL/web/login" || echo 000)
if [ "$ma" != "200" ]; then
  echo "Odoo local không phản hồi ($ma). Bật lên:"
  echo "  docker start incokit_odoo_prod incokit_db_prod"
  exit 1
fi

echo
echo "  Sân chơi thử bot"
echo "  Odoo  : $ODOO_DB @ $ODOO_URL  (LOCAL — prod không bị ảnh hưởng)"
echo "  LLM   : $LLM_MODEL"
echo "  Mở    : http://localhost:4545"
echo
exec npx tsx --env-file-if-exists=.env scripts/agent-playground.ts
