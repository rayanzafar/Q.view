#!/bin/sh
# استعادة نسخة احتياطية مضغوطة (من pg-backup.sh) إلى قاعدة هدف — للطوارئ والتدريب.
# الهدف يجب أن يكون قاعدة **مخصّصة للاستعادة/فارغة**؛ لا يُوجَّه للإنتاج الحيّ إلا بقرار صريح
# ونافذة صيانة ونسخة طازجة قبله مباشرة. يفشل بوضوح عند أول خطأ (ON_ERROR_STOP).
#   DATABASE_URL="<target>" sh scripts/pg-restore.sh <backup.sql.gz>
#   sh scripts/pg-restore.sh <backup.sql.gz> "<target-url>"
set -e
FILE="$1"
URL="${DATABASE_URL:-$2}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "!! مرّر ملف النسخة: sh scripts/pg-restore.sh <backup.sql.gz> [target-url]" >&2; exit 1
fi
if [ -z "$URL" ]; then
  echo "!! قاعدة الهدف (DATABASE_URL) غير موجودة — مرّرها كمتغيّر بيئة أو وسيطاً ثانياً" >&2; exit 1
fi
if ! command -v psql >/dev/null 2>&1; then echo "!! psql غير مثبت في هذه البيئة" >&2; exit 2; fi
echo "استعادة $FILE → الهدف…"
gunzip -c "$FILE" | psql -v ON_ERROR_STOP=1 "$URL" >/dev/null
echo "✓ اكتملت الاستعادة بنجاح"
