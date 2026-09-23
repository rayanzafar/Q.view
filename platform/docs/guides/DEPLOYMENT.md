# دليل النشر — سند

## المتطلبات
- Node.js ≥ 22.5
- إنتاجًا: PostgreSQL 14+ (يُفعَّل عبر `DATABASE_URL`)، خزنة أسرار، مزوّد SMTP.

## متغيرات البيئة (إنتاج)
| المتغير | الغرض |
|---------|-------|
| `NODE_ENV=production` | يفعّل فحوص الأسرار وSecure cookies |
| `SESSION_SECRET` | سرُّ بيئةٍ إلزامي — الإقلاع الإنتاجي يتوقف بدونه (ولا يوقّع الجلسات: الجلسة رمزٌ مبهم في القاعدة — ADR-0012) |
| `DATABASE_URL` | Postgres (إلزامي إنتاجًا) |
| `PORT` / `HOST` | منفذ الاستماع |
| `PLATFORM_URL` | رابط المنصة في روابط البريد |
| `MAIL_TRANSPORT=smtp` + `SMTP_HOST/PORT/USER/PASS` + `MAIL_FROM` | البريد الفعلي |
| `OPENAI_API_KEY` (اختياري) | تفعيل المساعد الذكي المحوكم |

## خطوات النشر
1. `npm ci`
2. تهيئة قاعدة البيانات: `npm run migrate` (على Postgres عبر طبقة المستودعات — انظر ADR-0001؛ محوّل Postgres يُضاف عند النشر).
3. `node scripts/seed-rbac.js` (الأدوار والصلاحيات).
4. الترحيل الأولي للبيانات (مرة واحدة، من لقطة/تصدير معتمد): `npm run migrate-legacy` ثم راجع `data/migration-reconciliation.json`.
5. إنشاء مستخدم admin وضبط كلمات المرور (لا تُنشر الحسابات التجريبية في الإنتاج).
6. `NODE_ENV=production npm start` خلف عاكس عكسي (TLS) — مثل Nginx/Railway.
7. الجدولة/البريد: يعمل داخليًا؛ للحجم الأكبر انقل `core/jobs/scheduler.js` إلى عامل مستقل (Redis/BullMQ).

## ما قبل الإطلاق
- استبدل transport البريد بـ SMTP وأرسل نسخة اختبار.
- عطّل/احذف الحسابات التجريبية `demo.*`.
- فعّل نسخة احتياطية مجدولة (Postgres: `pg_dump`؛ SQLite: `scripts/backup.js`).
- راجع `docs/PRODUCTION-READINESS.md` — البنود ⛔/🔐.
