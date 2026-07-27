#!/bin/sh
# Boot: schema + seeds, then server. Each seed step is idempotent and may return non-zero on a
# re-run/no-op; that must NOT stop the boot, so each is guarded. `exec` hands PID 1 to the server
# for correct signal handling (graceful shutdown).
#
# Environment switch (single boot path for staging AND production):
#   SANAD_SEED_DEMO=0   → PRODUCTION: no demo data/accounts. An initial admin is created ONCE from
#                         SANAD_ADMIN_USER / SANAD_ADMIN_PASS. Real data is imported later in-app.
#   (unset / anything)  → STAGING/DEV: demo business data + demo personas (unchanged behavior).
node --experimental-sqlite scripts/migrate.js || true
node --experimental-sqlite scripts/seed-rbac.js || true
# staging/dev only — self-guards and exits early when SANAD_SEED_DEMO=0
node --experimental-sqlite scripts/seed-staging.js || true
# production only — self-guards; no-op unless SANAD_ADMIN_USER/PASS are set and no admin exists yet
node --experimental-sqlite scripts/seed-admin.js || true
# حسابات الأدوار السبعة الناقصة. سببها أن `seed-staging.js` يتوقف عند `hasData()`، وهي أُضيفت
# بعد أن امتلأت قاعدة staging — فلم تُنشأ قط، وبقي المسح يغطّي عشرة أدوار من سبعة عشر.
# يُشغَّل بنفس مفتاح بقية بذور العرض (يتخطّى نفسه عند SANAD_SEED_DEMO=0)، وهو **متعذّر التنفيذ
# من خارج الشبكة**: منفذ قاعدة البيانات غير مبلوغ من بيئة التطوير، فالإقلاع هو الطريق الوحيد.
# آمن للتكرار: يمسّ `app_user` و`department` و`employee` فقط، ولا يقترب من تعديلات `seed.js`
# على مالكي القطاعات والمشاريع والفرص الحقيقية — ويحرس ذلك اختبار لقطة على الجداول كلها.
node --experimental-sqlite scripts/seed-roles.js --apply || echo "role accounts skipped"
# idempotent legacy-history backfill (INSERT … ON CONFLICT DO NOTHING) — no-op without legacy data
node --experimental-sqlite scripts/backfill-legacy-activity.js || echo "backfill skipped"
# توحيد العملاء يُشغَّل مرة واحدة بعد النشر عبر `railway run` (لا في الإقلاع) كي لا يخاطر بتعليقه.
exec node --experimental-sqlite src/server.js
