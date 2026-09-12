# سند — منصة إدارة الأعمال المؤسسية (EVC) · إعادة البناء

منصة تشغيل مؤسسية لشركة رؤية الخبراء الاستشارية، أُعيد بناؤها من نموذج «الوثيقة الواحدة + تفويض في المتصفح» إلى **Modular Monolith** بقاعدة بيانات علائقية و**تفويض مُنفَّذ على الخادم** وحجب حقول حساسة وتدقيق ومحرك اعتمادات وPMO وسجل وقت وتقارير وبريد تنفيذي.

> المنصة **تعمل على staging** (`staging.os.evcsol.com`، نشر عبر Railway) ببيانات حقيقية مُرحّلة. حالة كل قدرة موثّقة في `docs/PRODUCTION-READINESS.md` — لا ادّعاء «جاهز للإنتاج» قبل استيفاء بواباته.
>
> **الأساس المحدَّث للقارئ الجديد:** `docs/ARCHITECTURE.md` + `docs/FEATURES.md` + `docs/KNOWN-ISSUES.md` — الكود وقرارات `docs/adr/` هما المرجع عند أي تعارض مع وثائق أقدم.
>
> صفحتا **«المالية»** و**«سجل الوقت»** مُعطَّلتان بقرار المالك (`src/core/policy/pages.js`: `finance: () => false`، `timesheet: () => false`) — بياناتهما باقية في النموذج وتغذّي بقية الشاشات، لكن لا صفحة مباشرة لهما.

## التشغيل محليًا (بلا أي تبعية شبكية)
```bash
cd platform
npm install                     # express + cookie-parser + pg + nodemailer
npm run migrate                 # إنشاء الschema (SQLite مدمج؛ Postgres إذا ضُبط DATABASE_URL)
node --experimental-sqlite scripts/seed-rbac.js   # الأدوار والصلاحيات
npm run migrate-legacy          # اختياري — يتطلب ملفات لقطة غير مرفوعة للمستودع (seed/*.snapshot.json أو *.demo.json)
npm run seed                    # إعدادات + حسابات تجريبية لكل دور
npm start                       # http://127.0.0.1:4000
```

## الحسابات التجريبية (UAT) — كلمة المرور `Sanad@2026`
| المستخدم | الدور | النطاق |
|----------|-------|--------|
| `demo.admin` | مدير النظام | الشركة (كل شيء + كل الحقول الحساسة) |
| `demo.ceo` | مكتب الرئيس التنفيذي | الشركة (قراءة + هوامش، بلا رواتب فردية) |
| `demo.sectorlead` | قائد قطاع الحلول | قطاعه (تعديل + اعتماد + تكلفة قطاعه) |
| `demo.bd` | مدير تطوير الأعمال | فرصه وعملاؤه (**بلا تكلفة**) |
| `demo.pm` | مدير مشروع | مشاريعه |
| `demo.hr` | الموارد البشرية | الشركة (موظفون + **رواتب**) |
| `demo.consultant` | استشاري | مشاريعه/مهامه |
| `demo.employee` | موظف | مهامه ووقته فقط |
| `demo.viewer` | مشاهدة فقط | قطاعه (بلا أي حقل حساس) |

> دور «المالية» أُلغي (الترحيلة `migrations/018_retire_finance_role.sql`): اعتماداته انتقلت إلى مكتب الرئيس التنفيذي، وحساب `demo.finance` عُطِّل. حسابات أدوار إضافية تُنشأ عبر `scripts/seed.js` و`scripts/seed-roles.js`.
>
> المستخدمون المُرحّلون من النظام القديم بلا كلمة مرور (لم تكن في اللقطة) — الدخول برمز عبر البريد متاح، ومدير النظام يدعو/يفعّل الحسابات.

## المعمارية (بإيجاز)
- **الواجهة:** SSR عربي RTL + تحسين تدريجي بجافاسكربت بسيط (بلا خطوة بناء). أصول Tailwind محلية.
- **الخادم:** Express (modular monolith)، `src/core/*` (نواة: db, auth, rbac, audit, http, jobs, mail, reports) و`src/modules/*` (نطاقات: crm, pmo, timesheets, workflow, finance, ...).
- **قاعدة البيانات:** محرّكان خلف طبقة وصول واحدة (`src/core/db/index.js`): **PostgreSQL عند ضبط `DATABASE_URL` (staging/الإنتاج — الحيّ منذ 2026-07)** وSQLite مدمج للتطوير والاختبارات، بـSQL محمول يعمل عليهما معًا (`docs/adr/ADR-0004-postgres-live.md`). المال بالهللات (أعداد صحيحة).
- **الأمان:** تفويض على الخادم حصريًا (`core/rbac`)، حجب حقول حساسة (رواتب/تكلفة/هوامش/IP)، جلسات كوكي HttpOnly، scrypt، قفل بعد محاولات، سجل تدقيق.
- **الاعتمادات:** محرك مسارات متعدد الخطوات بحدود مالية (`modules/workflow`).
- **التقارير والبريد:** تعريفات + جدولة + طابور + سجل إرسال + معاينة؛ الصلاحيات تُنفَّذ وقت البناء والإرسال لكل مستلم (`core/reports`, `core/mail`).

## الاختبارات
```bash
node --experimental-sqlite --test "tests/**/*.test.js"   # 1447 اختبارًا (tests/unit + integration + security) — 0 إخفاق
npm run e2e                                              # فحوص المتصفح (Playwright — tests/e2e/*.spec.mjs)
```

## الوثائق
- **الأساس المحدَّث:** `docs/ARCHITECTURE.md` · `docs/FEATURES.md` · `docs/KNOWN-ISSUES.md` — اقرأها أولًا.
- `docs/adr/` قرارات معمارية (ADR-0001…0004) · `docs/specs/` — الملزم الوحيد `docs/specs/07-contracts-delivery2.md`؛ الوثائق 01–06 مرجعية تاريخية والكود + ADRs يغلبان عند التعارض.
- `docs/PRODUCTION-READINESS.md` · `docs/SECURITY-REPORT.md` · `docs/CHANGELOG.md` · `docs/guides/*` (نشر/تراجع/أدمن/مستخدم)
