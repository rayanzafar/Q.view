# عقود التسليم الشامل (Delivery 2) — مُجمَّدة

هذه العقود ثابتة لكل الحارات المتوازية. التوسيع مسموح؛ التعارض ممنوع. أي تعديل يمر عبر جلسة التكامل فقط.

## 1) مسارات الصفحات (خلف requireWeb + PAGE_ACCESS)

| المسار | الدالة | الملف | الوصول |
|---|---|---|---|
| `/app/clients` | `clientsPage` | `views/clients.js` | من يملك `read client` |
| `/app/client/:id` | `clientDetailPage` | `views/clients.js` | نفسه + نطاق |
| `/app/opportunity/:id` | `opportunityDetailPage` | `views/opportunity-detail.js` | من يملك `read opportunity` + نطاق |
| `/app/imports` | `importsPage` | `views/imports.js` | من يملك أي صلاحية io (انظر §5) |
| `/app/mail` | `mailPage` | `views/mail.js` | admin, ceo_office |
| `/app/sector` | `sectorPage` (v3) | `views/sector.js` | كما هو اليوم |
| `/app/team` | `teamPage` (v3) | `views/people.js` | كما هو اليوم |

`src/web/nav.js` (جديد): يصدّر `PAGE_ACCESS = { pageKey: (user) => boolean }` — يستهلكه `layout.js` (إظهار القائمة) و`routes.js` (403 عربية عند الرفض). مفاتيح الصفحات تُطابق `PAGES` في routes.js.

## 2) واجهات API الجديدة (Router مستقل لكل وحدة؛ سطر تركيب واحد في api.routes.js)

**العملاء — `src/modules/clients/clients.routes.js`:**
- `GET /api/clients?query&type&sector&sort` → قائمة بنطاق المستخدم + `last_activity_at`, `open_pipeline_halalas`, `fy_revenue_halalas`
- `POST /api/clients` {name_ar, name_en?, type, code?} → عميل
- `GET /api/clients/:id/360` → الحمولة المركّبة (§6)
- `PATCH /api/clients/:id` {name_ar?, name_en?, type?, sector_market?, active?}
- `POST /api/clients/:id/contacts` {name, title?, email?, phone?} · `PATCH /api/contacts/:id` · `DELETE /api/contacts/:id`

**الأنشطة — نفس router العملاء:**
- `GET /api/activities?client_id|opportunity_id|project_id|sector_id&limit=50&before=<iso>`
- `POST /api/activities` {kind, title, detail?, client_id?, opportunity_id?, project_id?} — sector_id يُستنتج

**فريق الفرصة — `src/modules/crm/oppteam.routes.js`:**
- `GET /api/opportunities/:id/team` → [{membership_id, employee_id, name_ar, role_in_group, allocation_pct}]
- `POST /api/opportunities/:id/team` {employee_id, role_in_group: lead|member|reviewer|sponsor, allocation_pct?}
- `DELETE /api/opportunities/team/:membershipId`

**العروض المحفوظة — `src/modules/views/views.routes.js`:**
- `GET /api/views?page=` · `POST /api/views` {page, name_ar, params_json} · `DELETE /api/views/:id` · `POST /api/views/:id/default`

**الاستيراد/التصدير — `src/modules/io/io.routes.js`:**
- `GET /api/io/types` → [{type, labelAr, canExport, canImport, columns:[{key,labelAr,required}]}]
- `GET /api/io/export/:type?format=xlsx|csv&template=1&…filters` → ملف (Content-Disposition; أسماء أعمدة عربية)
- `POST /api/io/import/:type/upload` (express.raw حد 15mb، ترويسة `x-file-name`) → {runId, headers, sample, autoMapping}
- `POST /api/io/import/:type/preview` {runId, mapping, mode:add|upsert|replace, keyField?} → {counts, rows:[…≤500 معاينة], errors}
- `POST /api/io/import/:type/apply` {runId, confirmToken} → {applied, created, updated, skipped, errors}
- `GET /api/io/runs?type=` · `GET /api/io/runs/:id` (مع صفوفه) · `POST /api/io/runs/:id/undo`

## 3) DDL — `migrations/005_delivery2.sql` (نص نهائي ملزم)
الجداول الخمسة كما في خطة التنفيذ: `crm_activity` (مع `legacy_id TEXT UNIQUE`، source: legacy|app|import، فهارس client/opportunity/sector×at)، `import_run`، `import_row` (فهرس run + فهرس resource,resource_id)، `saved_view`، `document` (بيانات وصفية بلا blob). أنواع محمولة فقط (TEXT/INTEGER/REAL) — `migrate.js` يحوّلها لـPG تلقائياً.

## 4) الـBackfill
`scripts/backfill-legacy-activity.js`: يقرأ `seed/legacy-state.snapshot.json` → `activity[]` إلى `crm_activity` (`legacy_id = 'lg_'+id القديم`, source='legacy', ربط client/opportunity/project عبر خرائط الترحيل نفسها في migrate-legacy) و`importLog[]` إلى `import_run` (status='applied', mode='upsert', type='legacy'). INSERT فقط بـ`ON CONFLICT (legacy_id) DO NOTHING`؛ يدعم `--dry-run`؛ لا يحذف شيئاً أبداً. يسبقه `scripts/pg-backup.sh`.

## 5) صلاحيات io لكل نوع
| type | تصدير | استيراد |
|---|---|---|
| opportunities | `read opportunity` | `create/update opportunity` (نطاق الصف) |
| projects | `read project` | `create/update project` |
| clients | `read client` | `create/update client` |
| employees | `read employee` | `create/update employee` (الراتب يُصدَّر/يُستورَد فقط مع `read salary`) |
| staffing | `read allocation` | `create/update allocation` |
| revenues | `read revenue` (finance/admin/ceo_office) | `create revenue` (finance/admin) |
وضع `replace` = admin فقط + تصدير تلقائي مسبق يُخزَّن في run. صلاحية الصف تُفحص لكل صف — تجاوز النطاق = خطأ صف لا تخطٍّ صامت.

## 6) حمولة `clientOverview` (`GET /api/clients/:id/360`)
```
{ client, contacts[], kpis: { fy_revenue_halalas, lifetime_revenue_halalas, open_pipeline_halalas,
  weighted_pipeline_halalas, active_projects, open_ar_halalas, last_activity_at, relationship: 'نشطة|فاترة|خاملة' },
  activities[≤50], opportunities: { open[], won[], lost[], win_rate }, projects[], contracts[],
  invoices_summary: { invoiced, collected, outstanding, overdue }, documents[], yoy: [{year, revenue_halalas}],
  concentration_pct }
```
`relationship`: نشطة = نشاط ≤30 يوماً أو فرصة مفتوحة؛ فاترة ≤120؛ خاملة غير ذلك.

## 7) مفاتيح المعجم الأساسية (glossary.js — `G.*`)
attention "يحتاج انتباهك الآن" · needsDecision "بانتظار قرارك" · offTrack "خارج المسار" · onTrack "على المسار" · nextAction "الخطوة التالية" · noNextAction "بلا خطوة تالية" · stageAge "منذ {n} يوماً في هذه المرحلة" · weighted "القيمة المرجّحة" · raw "القيمة الإجمالية" · forecast "المتوقع نهاية السنة" · target "المستهدف" · actual "المحقق" · capacity "الطاقة الاستيعابية" · overloaded "فوق الطاقة" · underused "سعة متاحة" · onBench "غير مُسكَّن حالياً" · importAdd "إضافة الجديد فقط" · importUpsert "إضافة وتحديث" · importReplace "استبدال كامل" · undo "تراجع عن العملية" · dryPreview "معاينة قبل التنفيذ" · rowError "الصف {n}: {problem}" — والقائمة المحظورة: API, Schema, Entity, Adapter, Queue, Worker, Transaction, JSON, DB, null, undefined, NaN, "ID:".

## 8) قواعد التكامل (تذكير ملزم)
فروع الحارات لا تعدّل أبداً: `pages.js`، `layout.js`، `routes.js`، `nav.js`، `public/app.js`، `api.routes.js`. أسطر الربط (تصدير barrel، PAGES+PAGE_ACCESS، NAV، تركيب Router، scripts) تطبّقها جلسة التكامل حصراً عند الدمج.
