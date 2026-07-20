#!/bin/sh
# نسخة احتياطية إلزامية قبل أي هجرة/تعبئة بيانات على قاعدة حية.
# يستخدم DATABASE_URL من البيئة أو من `railway variables`. الملفات في data/backups (خارج git).
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$DIR/data/backups"
mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%d-%H%M%S)
URL="${DATABASE_URL:-$1}"
if [ -z "$URL" ]; then
  echo "!! DATABASE_URL غير موجود — مرّره كمتغير بيئة أو وسيط أول" >&2
  exit 1
fi
FILE="$OUT/staging-$STAMP.sql.gz"
if command -v pg_dump >/dev/null 2>&1; then
  pg_dump --no-owner --no-privileges "$URL" | gzip > "$FILE"
else
  echo "!! pg_dump غير مثبت في هذه البيئة" >&2
  exit 2
fi
SIZE=$(stat -c%s "$FILE" 2>/dev/null || stat -f%z "$FILE")
if [ "$SIZE" -lt 1000 ]; then
  echo "!! النسخة الاحتياطية مشبوهة الحجم ($SIZE بايت) — أوقف أي عملية تالية" >&2
  exit 3
fi
echo "✓ backup: $FILE ($SIZE bytes)"
