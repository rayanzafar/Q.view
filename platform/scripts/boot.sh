#!/bin/sh
# Boot: schema + seeds, then server. Each seed step is idempotent and may return non-zero on a
# re-run/no-op; that must NOT stop the boot, so each is guarded. `exec` hands PID 1 to the server
# for correct signal handling (graceful shutdown).
#
# Environment switch (single boot path for staging AND production):
#   SANAD_SEED_DEMO=0   → PRODUCTION: no demo data/accounts. An initial admin is created ONCE from
#                         SANAD_ADMIN_EMAIL (required — it is the login identity) plus optional
#                         SANAD_ADMIN_PASS / SANAD_ADMIN_USER. Real data is imported later in-app.
#   (unset / anything)  → STAGING/DEV: demo business data + demo personas (unchanged behavior).
#
# The schema migration is the ONE step that must be FATAL: booting on a stale/half-applied schema
# would run the server green against the wrong shape (exit 0, restart policy never fires, /ready
# only pings). Every seed/backfill step below stays guarded (idempotent, may no-op on a re-run).
node --experimental-sqlite scripts/migrate.js || { echo "!! فشلت الترحيلة — يُوقَف الإقلاع كي لا يعمل الخادم على مخطط قديم" >&2; exit 1; }
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
# تصفير عدّاد المراحل مرةً واحدة (طابعه في schema_migration): الفرص المستوردة تحمل تواريخ
# النظام القديم فتُقرأ كلها «متوقّفة» في اليوم الأول. يتخطّى نفسه بعد أول تشغيل.
node --experimental-sqlite scripts/reset-stage-clock.js || echo "stage clock reset skipped"

# أمرُ مالكٍ على البيانات الحيّة: صلاحية «فرص إدارة الابتكار» لسجى وهادي. مرةً واحدة بطابع في
# schema_migration، ولا يخمّن: اسمٌ لا يُحسَم (صفر أو أكثر من واحد) يُترك ويُقال سببه في السجل.
# قرارات المالك على الأشخاص (نقل عمر حمزة إلى تطوير الأعمال، وحساب هادي كرمي) — قبل المنح
# والإشغال لأن كليهما يقرأ سجلّ الموظفين والحسابات.
node --experimental-sqlite scripts/apply-owner-people.js || echo "owner people skipped"
node --experimental-sqlite scripts/apply-owner-grants.js || echo "owner grants skipped"
# نسب الإشغال من كشف توزيع مايو ٢٠٢٦ (تسكين المشاريع وحده — لا راتب ولا سطر «قطاع …»).
# مرةً واحدة بطابع في schema_migration، ولا يخمّن: ما لا يُحسَم يُترك ويُطبَع سببه في السجل.
node --experimental-sqlite scripts/apply-utilization-may2026.js || echo "utilization skipped"
# المرآة بين المشاريع والفرص: كل مشروع له فرصته المكسوبة وكل فرصة مكسوبة لها مشروعها. يربط ما
# له فرصة قائمة بالاسم قبل أن يُنشئ شيئاً (فلا ازدواج في المبيعات)، ويُعلِّم مشاريع السنوات
# الماضية «تاريخي» فلا يتحرّك رقمٌ أُعلن من قبل. مرةً واحدة بطابع في schema_migration.
node --experimental-sqlite scripts/backfill-project-opportunities.js || echo "project-opportunity mirror skipped"
# التسكين الرجعي لإدارات الفرص: فرصةٌ بلا إدارة تُنسب إلى إدارة مالكها (أو منشئها) إن كانت من
# قطاعها نفسه، وتُكتب مرآتها معها. مرةً واحدة بطابع في schema_migration، وما لا يُحسم يُترك.
node --experimental-sqlite scripts/backfill-opportunity-departments.js || echo "opportunity department attribution skipped"
# التسكين الرجعي لإدارات المشاريع: مشروعٌ بلا إدارة يُنسب إلى إدارة فرصته المصدر (إن كانت من
# قطاعه) أو إدارة مالكه — وبها تُقصّ قائمةُ مدير الإدارة إلى إدارته لا قطاعه. مرةً واحدة بطابع
# في schema_migration، وما لا يُحسم يُترك «بلا إدارة» (يبقى يتيماً يظهر في قطاعه).
node --experimental-sqlite scripts/backfill-project-departments.js || echo "project department attribution skipped"
# idempotent legacy-history backfill (INSERT … ON CONFLICT DO NOTHING) — no-op without legacy data
node --experimental-sqlite scripts/backfill-legacy-activity.js || echo "backfill skipped"
# توحيد العملاء يُشغَّل مرة واحدة بعد النشر عبر `railway run` (لا في الإقلاع) كي لا يخاطر بتعليقه.
exec node --experimental-sqlite src/server.js
