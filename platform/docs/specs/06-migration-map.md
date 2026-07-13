# 06 — خريطة الترحيل (Legacy → Relational)

**المنصة:** سند Enterprise OS — رؤية الخبراء (EVC) · **الإصدار:** v1
**المصدر:** `platform/seed/legacy-state.snapshot.json` (revision 890) + `platform/seed/legacy-users.snapshot.json`
**الهدف:** المخطط العلائقي في `platform/migrations/001_init.sql` (SQLite للتطوير، متوافق مع PostgreSQL)
**المنفّذ المرجعي:** `platform/scripts/migrate-legacy.js` — هذا المستند هو المواصفة السلطوية لذلك السكربت.
**تاريخ:** 2026-07-13

> **قاعدة حاكمة عليا:** لا يُحذف أي سجل مصدري ولا أي مبلغ مالي مطلقًا. عند فقد ربط مرجعي (FK) نُبقي السجل ونجعل المفتاح `NULL` مع تدوين ملاحظة في تقرير المطابقة — **link-or-null، never-drop**. اللقطة المصدرية تبقى للقراءة فقط ولا يُكتب عليها إطلاقًا (انظر `platform/seed/PROVENANCE.txt`).

---

## 1. المبادئ العامة للترحيل (Global Rules)

هذه القواعد تُطبَّق على كل الحقول ما لم يُنصّ على خلافها في جداول التعيين:

| # | القاعدة | التفصيل |
|---|---------|---------|
| G1 | **المال بالهللات (halalas)** | كل حقل `*Sar` في المصدر → عمود `*_halalas` صحيح في الهدف عبر `toHalalas(sar) = Math.round(Number(sar||0) * 100)` (`src/core/util/ids.js`). لا كسور عائمة تُخزَّن. |
| G2 | **المنطقيات → 0/1** | `true/false` → `1/0`. الافتراض عند الغياب مذكور لكل حقل (غالبًا `active` غائب ⇒ `1`). |
| G3 | **الأوقات ISO-8601 UTC نصًّا** | تُنسخ كما هي إن وُجدت، وإلا `nowIso()`. تواريخ اليوم (`startDate`/`endDate`) تُنسخ نصًّا كـ `YYYY-MM-DD`. |
| G4 | **المعرّفات تُحفَظ كما هي** | معرّفات المصدر الوصفية (`u_…`,`p_…`,`o_…`,`c_…`,`dlv_…`) تُنقل حرفيًّا كـ Primary Key للحفاظ على كل الروابط الداخلية. الكيانات المشتقّة (contract/invoice/department/position/allocation) تأخذ معرّفًا جديدًا `id(prefix)`. |
| G5 | **حلّ المفاتيح الأجنبية = link-or-null** | قبل كتابة أي FK نتحقق من وجود الأب في الجدول الهدف (`SELECT id FROM parent WHERE id=?`). موجود ⇒ نربط. غير موجود ⇒ `NULL` + ملاحظة مطابقة. **لا نتخطى السجل ولا نحذفه.** |
| G6 | **الحذف منطقي (soft-delete)** | لا حذف فعلي في الهدف. `active=false` في المصدر ⇒ `active=0` (والسجل يبقى). عمود `deleted_at` يبقى `NULL` لكل المُرحَّل. |
| G7 | **الترتيب حرج (Load Order)** | يُحمَّل الأب قبل الابن: sector/stage → client/supplier → service → employee(+department+position) → app_user → opportunity → project(+contract) → deliverable(+invoice) → revenue_line/cost_line/allocation → budget → activity. |
| G8 | **معاملة ذرّية واحدة (single tx)** | كل الترحيل داخل `tx(() => { … })`. أي استثناء ⇒ تراجع كامل (rollback) ولا تُترك قاعدة نصف مُرحَّلة. |
| G9 | **قابلية إعادة التشغيل (idempotent-in-dev)** | يبدأ السكربت بـ `DELETE FROM` لجداول البيانات المُرحَّلة فقط (قائمة `dataTables`)، فإعادة التشغيل تعطي نفس النتيجة. **لا يمسّ** جداول النظام المزروعة (`role`, `workflow_definition`, `report_definition`, `kpi_definition`, `email_template`). |

**جداول البيانات المُدارة (تُفرَّغ ثم تُعاد):**
`sector, stage, client, supplier, service, service_package, opportunity, opportunity_sector, project, deliverable, revenue_line, cost_line, allocation, employee, department, position, app_user, login_history, budget, contract, invoice` + (توسعة هذا المستند: `audit_log`).

---

## 2. جرد المصدر ومراسي المطابقة (Source Inventory & Anchors)

**أعداد المجموعات المصدرية (revision 890):**

| المجموعة | العدد | المجموعة | العدد | المجموعة | العدد |
|----------|:----:|----------|:----:|----------|:----:|
| sectors | 4 | opportunities | 134 | team | 29 |
| practices | 5 | projects | 43 | users | 26 |
| services | 15 | deliverables | 342 | directory | 25 |
| (service packages) | 20 | revenueLines | 31 | activity | 443 |
| suppliers | 33 | costLines | 148 | stages | 6 |
| clients | 90 | allocations | 47 | priorities | 4 |
| budget | 1 | importLog | 1 | sessions / directives | 0 / 0 |

**المراسي المالية (يجب أن تتطابق قبل/بعد بفارق ≤ خطأ التقريب للهللة):**

| المرساة | القيمة المصدرية (SAR) |
|---------|----------------------:|
| إجمالي قيمة الفرص `opportunities[].valueSar` | 1,279,326,693.70 |
| إجمالي أسطر الإيراد `revenueLines[].amountSar` | 61,188,430.18 |
| إجمالي قيمة العقود المشتقّة `projects[].contractValueSar` (>0) | 67,931,813.70 |
| إجمالي مبالغ المخرجات `deliverables[].amountSar` | 87,997,805.50 |
| إجمالي مبالغ الفواتير المشتقّة (INVOICED+PAID) | 15,556,052.30 |
| إجمالي أسطر التكلفة `costLines[].amountSar` | 14,499,912.69 |
| إجمالي رواتب الفريق `team[].salarySar` | 369,544.50 |

---

## 3. خرائط التعيين تفصيلًا (Collection → Table Mappings)

صيغة كل جدول: **حقل المصدر → عمود الهدف** + التحويل/الملاحظة. الأعمدة الهدفية غير المذكورة تأخذ قيمها الافتراضية من `001_init.sql` (`created_at=nowIso()`, `deleted_at=NULL`, الحقول الحوكمية `created_by/updated_by=NULL`).

### 3.1 `sectors` (4) → `sector` (4)

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| `id` | `sector.id` | كما هو (`SOLUTIONS`,`CONSULTING`,`STRATEGIC`,`SAP`) |
| `nameAr` | `name_ar` | — |
| `nameEn` | `name_en` | `|| null` |
| `color` | `color` | `|| null` |
| `leadId` | `lead_user_id` | **يُضبَط `NULL` في تمريرة الترحيل** (المستخدمون لم يُحمَّلوا بعد وقت تحميل القطاعات؛ G7)، ثم يُعاد ربطه في خطوة ما بعد الترحيل §5.2. |
| `targetSalesSar` | `target_sales_halalas` | `toHalalas` |
| `targetRevenueSar` | `target_revenue_halalas` | `toHalalas` |
| `targetGrossMarginPct` | `target_margin_pct` | `|| 0` |
| `active` | `active` | `?1:0` |
| `placeholder` | `is_placeholder` | `?1:0` (STRATEGIC/SAP ⇒ `1`) |
| `managerId` | — | لا عمود؛ يُلتقَط عبر `department.manager_user_id`/الأدوار لاحقًا (قرار §7). |
| — | `sort_order` | `0` |

> القطاعان STRATEGIC وSAP يُرحَّلان كسجلات فعلية بعلم `is_placeholder=1` — لا تُسقَط، بل تُميَّز حتى تُفعَّل ببيانات لاحقًا.

### 3.2 `stages` (6) → `stage` (6)

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| `id` | `stage.id` | كما هو |
| `nameAr`/`nameEn` | `name_ar`/`name_en` | — |
| `defaultWinPct` | `default_win_pct` | `?? null` (ON_HOLD = null) |
| `order` | `sort_order` | `|| 0` (تُحفَظ الفجوة: WON=5 وليس 4 — تُنقَل كما هي دون تصحيح) |
| `color` | `color` | — |
| — | `is_won` | `id==='WON' ? 1 : 0` |
| — | `is_lost` | `id==='LOST' ? 1 : 0` |

### 3.3 `clients` (90) → `client` (90)

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| `id`,`code`,`nameAr`,`nameEn` | `id`,`code`,`name_ar`,`name_en` | `code/nameEn || null` |
| `type` | `type` | `|| null` — **71 عميلًا سيبقون بـ `type=NULL`** (انظر معالجة الفجوة §4.1) |
| `active` | `active` | `=== false ? 0 : 1` (الغياب ⇒ 1) |
| `aliases[]` | — | **لا تُسقَط.** تُحفَظ كـ `contact`? لا — الأسماء البديلة ليست جهات اتصال. تُرحَّل إلى جدول `client_alias` (توسعة §7-قرار D5) أو تُبقى في `notes` مؤقتًا. حتى صدور القرار: تُسلسَل في عمود مؤقت/تقرير مطابقة ولا تُفقَد. |
| `internal` (علم قديم) | — | يُدمَج في `type='داخلي'` عند الوجود (عميل واحد). |

> `contact` تبقى فارغة (لا جهات اتصال في المصدر). `sector_market` = `NULL`.

### 3.4 `suppliers` (33) → `supplier` (33)

تعيين مباشر 1:1: `id, nameAr→name_ar, nameEn→name_en, org, contactPerson→contact_person, phone, email, status(||'active'), notes`. الحقول الفارغة نصًّا تبقى كما هي. المورّد الوهمي `sup_x` **يبقى** كسجل (لا يُحذف) لكنه لا يُربَط من الباقات (§3.5).

### 3.5 `services` (15) → `service` (15) + `service_package` (20)

**service:**
`id, nameAr→name_ar, nameEn→name_en, category, sectorId→sector_id (link-or-null), status(||'active'), summary`. `owner_user_id=NULL` (ownerId المصدري غالبًا null). الحقول `links[]`,`attachments[]`,`audit[]`,`source` لا تُرحَّل إلى الجدول الأساسي (تُحفَظ في اللقطة؛ يمكن نقل `audit[]`→`audit_log` مستقبلًا).

**service_package** (لكل عنصر في `service.packages[]`):

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| `pk.id` | `id` | `|| id('pk')` |
| (الأب) | `service_id` | `sv.id` |
| `pk.nameAr` | `name_ar` | `|| ''` |
| `pk.priceSar` | `price_halalas` | `toHalalas` (كلها 0 حاليًا — تُعبَّأ لاحقًا) |
| `pk.costSar` | `cost_halalas` | `toHalalas` — **حقل حساس** (redaction) |
| `pk.supplierId` | `supplier_id` | `=== 'sup_x' ? NULL : link-or-null` (2 باقتان تُصفَّران) |
| `pk.notes` | `notes` | — |

### 3.6 `team` (29) → `employee` (29) + توليد `department` (4) + `position` (4)

**توليد الإدارات (department) من `team.dept` (نص حر):** لكل ثنائية فريدة `(sectorId, dept)` حيث `dept` غير فارغ **والقطاع موجود** يُنشأ سجل `department` جديد بمعرّف `id('dep')`. النتيجة المتوقّعة **4 إدارات** كلها تحت SOLUTIONS:

| `team.dept` | `department.name_ar` | القطاع | عدد الأعضاء |
|-------------|----------------------|--------|:----------:|
| `Ai&Data` | Ai&Data | SOLUTIONS | 5 |
| `Innovation` | Innovation | SOLUTIONS | 1 |
| `الحلول` | الحلول | SOLUTIONS | 12 |
| `تطوير الأعمال` | تطوير الأعمال | SOLUTIONS | 1 |

> 10 أعضاء بلا `dept` ⇒ `department_id=NULL` (لا تُسقَط). لا يوجد عضو له `dept` بلا قطاع (0)، فلا إدارة تُفقَد. **لم يُشتَق `org_unit` ولا `line_manager`** — لا بيانات مصدرية لهما؛ تبقى `NULL` (fields موجودة، تُملأ لاحقًا).

**توليد المسمّيات (position) من `team.role` (نص حر):** لكل `role` فريد **غير فارغ** يُنشأ `position` بمعرّف `id('pos')` و`title_ar=role`. النتيجة **4 مسمّيات**: `AI & Data & Innovation Solutions`, `Sr.Consultant`, `BD Specialist`, `Consultant`. (12 بقيمة `""` و9 `null` ⇒ `position_id=NULL`).

**employee (لكل عضو):**

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| `id` | `employee.id` | كما هو |
| `nameAr`/`nameEn` | `name_ar`/`name_en` | — |
| `sectorId` | `sector_id` | link-or-null |
| (مُشتَق) | `department_id` | من كاش الإدارات أعلاه |
| (مُشتَق) | `position_id` | من كاش المسمّيات أعلاه |
| `role` | `job_title` | النص الحر الأصلي يُحفَظ أيضًا هنا |
| `dept` | `dept_label` | النص الحر الأصلي يُحفَظ للتتبّع |
| `salarySar` | `salary_halalas` | `toHalalas` — **حقل حساس** (إجمالي 369,544.50 SAR) |
| `type` | `employment_type` | `|| 'أساسي'` |
| `seasonal` | `seasonal` | `?1:0` |
| `status` | `status` | `|| 'نشط'` |
| `active` | `active` | `=== false ? 0 : 1` |
| `user_id` | `user_id` | `NULL` في التمريرة (الربط العكسي يتم من جهة `app_user.employee_id`، §3.7) |

### 3.7 `users` (26, من `legacy-users.snapshot.json`) → `app_user` (26) + `login_history`

> **مصدر المستخدمين هو ملف `legacy-users.snapshot.json` المنفصل** (26 مستخدمًا، متطابق مع `state.users`)، وليس كتلة `users` داخل `state`.

**تحويل الأدوار (`roleMap`):** `admin→admin` · `sector_manager→sector_lead` · `sector_lead→sector_lead` · `bd_manager→bd_manager` · `consultant→consultant` · `viewer→viewer` · `USER/user→employee`.
**النطاق (`scopeFor`):** `admin→company` · `sector_lead|ceo_office→sector` · غيرهم `own`.

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| `id` | `app_user.id` | كما هو |
| `username` | `username` | `|| null` (10 فقط لهم اسم دخول؛ 16 بلا) — **UNIQUE** |
| `email` | `email` | `|| null` — **UNIQUE** |
| `nameAr`/`nameEn` | `name_ar`/`name_en` | — |
| `role` | `role_id` | عبر `roleMap` (افتراضي `employee`) |
| — | `employee_id` | ربط بالاسم: `SELECT id FROM employee WHERE name_ar = u.nameAr` (يربط ~7 المتطابقين) — link-or-null |
| `sectorId`/`sector` | `sector_id` | أول موجود |
| (مُشتَق) | `scope` | عبر `scopeFor(role)` |
| — | `password_hash` | **`NULL` دائمًا** (كلمات المرور غير موجودة في اللقطة) |
| `active` | `active` | `=== false ? 0 : 1` |
| — | `must_change_pw` | **`1` دائمًا** (لا دخول حتى ضبط كلمة مرور) |
| `createdAt` | `created_at` | `|| nowIso()` |
| `loginHistory[]` | `login_history` (سجلات) | آخر 10 فقط `.slice(-10)`؛ لكل سجل: `id('lh'), user_id, at, ip, user_agent, ok`. **`ip` حقل حساس** (admin-only). المتوقّع ~36 سجلًا. |

الحقول غير المرحّلة إلى الأعمدة: `managedProjectIds[]` (يُعاد تمثيلها عبر `project.owner_user_id`/`membership`), `mustChangePassword` المصدري (نتجاوزه بـ 1), `failedAttempts`/`lockedUntil`/`lastLoginAt` (تُصفَّر في نظام جديد؛ يمكن نقل `lastLoginAt` اختياريًا).

### 3.8 `opportunities` (134) → `opportunity` (134) + `opportunity_sector` (132)

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| `id`,`code`,`titleAr` | `id`,`code`,`title_ar` | — |
| `clientId` | `client_id` | link-or-null (**1 فرصة** بعميل غير موجود ⇒ null) |
| `sectorId` | `sector_id` | link-or-null (**2 فرصة** بلا قطاع ⇒ null) |
| `ownerId` | `owner_user_id` | link-or-null ضد `app_user` (**39 فرصة** بمالك غير مُطابِق ⇒ null، منها 23 مالك `u_cons_*` غير موجود أصلًا و16 يشيرون لأعضاء فريق لا مستخدمين — §4.3) |
| `stage` | `stage_id` | `|| 'LEAD'` (fallback عند الغياب) |
| `winPct` | `win_pct` | `?? null` |
| `valueSar` | `value_halalas` | `toHalalas` (مرساة: 1,279,326,693.70 SAR) |
| `priority` | `priority` | `|| null` (P0–P3) |
| `year`,`source`,`nextAction`,`notes` | `year`,`source`,`next_action`,`notes` | — |
| `excludeFromSales` | `exclude_from_sales` | `?1:0` |
| `stageChangedAt` | `stage_changed_at` | `|| null` |
| `createdAt` | `created_at` | `|| nowIso()` |

**`opportunity_sector`:** عند وجود قطاع صالح `sid` يُدرَج صف `(opportunity_id, sid)` — النتيجة **132 صف** (134 ناقص 2 بلا قطاع). هذا الجدول M:N يمهّد للفرص العابرة للقطاعات مستقبلًا.

الحقول القديمة الزائدة (`practiceId/practice/practiceCode`, `stageRaw/stageCode`, `priorityCode`, `opportunityCode`, `reviewNeeded/reviewReason`, `contractDate`, `duration`, `expectedCloseAt`, `sourceYear`, `titleEn`) **لا تُرحَّل إلى أعمدة** (تبقى في اللقطة). `reviewNeeded=true` (3 فرص) يُلتقَط كتنبيه جودة بيانات في تقرير المطابقة، لا كعمود.

> **ملاحظة سلامة:** الفرصة والمشروع مرتبطان عبر `project.source_opp_id` (ضعيف اختياري) — لا نجبر علاقة 1:1.

### 3.9 `projects` (43) → `project` (43) + اشتقاق `contract` (23)

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| `id`,`code`,`financialCode`,`nameAr` | `id`,`code`,`financial_code`,`name_ar` | — |
| `clientId` | `client_id` | link-or-null (0 مفقود) |
| `sectorId` | `sector_id` | link-or-null |
| `ownerId` | `owner_user_id` | link-or-null (**28 مشروعًا** بمالك غير مُطابِق ⇒ null — §4.3) |
| `pm` | `pm_name` | `|| null` |
| `sourceOppId` | `source_opp_id` | link-or-null (**15 مشروعًا** بلا فرصة مصدر) |
| `status` | `status` | `|| 'IN_PROGRESS'` |
| `kind` | `kind` | `|| 'external'` (34 internal / 9 external) |
| `sectorProject` | `is_sector_project` | `?1:0` |
| `budgetSar` | `budget_halalas` | `toHalalas` |
| `actualSpendSar` | `actual_spend_halalas` | `toHalalas` — **حساس** |
| `revenueSar` | `revenue_halalas` | `toHalalas` |
| `contractValueSar` | `contract_value_halalas` | `toHalalas` |
| `poValueSar` | `po_value_halalas` | `toHalalas` |
| `marginPct` | `margin_pct` | `?? null` — **حساس** |
| `progressPct` | `progress_pct` | `|| 0` |
| `startDate`,`endDate` | `start_date`,`end_date` | — |
| `createdAt` | `created_at` | `|| nowIso()` |
| — | `rag` | `'GREEN'` (افتراضي؛ يُعاد اشتقاقه لاحقًا من الحالة المالية) |

**اشتقاق العقد (contract):** لكل مشروع بـ `Number(contractValueSar) > 0` (**23 مشروعًا**) يُنشأ سجل `contract` واحد:

| الهدف | القيمة |
|-------|--------|
| `id` | `id('con')` |
| `code` | `project.code` |
| `client_id` | من المشروع (link-or-null) |
| `project_id` | `project.id` |
| `sector_id` | من المشروع |
| `value_halalas` | `toHalalas(contractValueSar)` (إجمالي 67,931,813.70 SAR) |
| `start_date`/`end_date` | من المشروع |
| `status` | `project.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE'` |

> `contract_payment` لا يُشتَق (لا جدول دفعات تعاقدية في المصدر) — يُبنى تشغيليًا لاحقًا. الحقول المالية القديمة الغنية (`collectedSar`, `outstandingArSar`, `totalInvoicedSar`, `payablesSar`, `vendorCostSar`, `salaryCostSar`, `financials{}`, `excelInvoices/excelCollections/excelPayables`, `scenarioOptimistic`) **لا تُرحَّل إلى أعمدة project** لكنها مصدر إثراء مستقبلي لجداول invoice/collection/expense/purchase_order — تبقى محفوظة في اللقطة (لا فقد).

### 3.10 `deliverables` (342) → `deliverable` (342) + اشتقاق `invoice` (11)

يُتخطّى المخرج فقط إن كان مشروعه الأب **غير موجود** (0 حالة) أو كان معرّفه مكرّرًا فعليًا (0 حالة) — كلاهما حارس دفاعي.

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| `id` | `deliverable.id` | كما هو |
| `projectId` | `project_id` | يجب أن يوجد (وإلا `continue` — لا يقع فعليًا) |
| `nameAr` | `name_ar` | — |
| `amountSar` | `amount_halalas` | `toHalalas` |
| `month`,`year`,`phase` | `month`,`year`,`phase` | `|| null` |
| `phaseNameAr` | `phase_name_ar` | — |
| `status` | `status` | `|| 'PENDING'` (PENDING 83 / DELIVERED 248 / INVOICED 10 / PAID 1) |
| `deliveredAt` | `delivered_at` | — |
| `notes`,`sectorId` | `notes`,`sector_id` | `sector_id` غير محقّق بـ link-or-null هنا (يُنسخ كما هو) |
| — | `milestone_id`,`accepted_at` | `NULL` (لا بيانات مصدرية) |

**اشتقاق الفاتورة (invoice):** لكل مخرج حالته `INVOICED` أو `PAID` (**11 مخرجًا**، إجمالي 15,556,052.30 SAR) يُنشأ سجل `invoice`:

| الهدف | القيمة |
|-------|--------|
| `id` | `id('inv')` |
| `project_id` | `deliverable.projectId` |
| `deliverable_id` | `deliverable.id` |
| `sector_id` | `deliverable.sectorId` |
| `amount_halalas` | `toHalalas(amountSar)` |
| `issue_date` | `deliverable.deliveredAt` |
| `status` | `status==='PAID' ? 'PAID' : 'ISSUED'` (⇒ 1 PAID + 10 ISSUED) |

> **حقل `invoiceStatus` القديم** (`مفوتر`=264 / `لم يفوتر`=65 / null=13) لا يُستخدَم لاشتقاق الفواتير — الاشتقاق يعتمد `status` (INVOICED/PAID) حصرًا لتفادي التضخّم. التباين بين العدّين مُدوَّن كملاحظة جودة بيانات (§4.4). `collection` لا يُشتَق (لا دفعات مفصّلة موثوقة لكل فاتورة).

### 3.11 `revenueLines` (31) → `revenue_line` (31) — **never-drop مالي**

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| `id` | `revenue_line.id` | كما هو (تخطّي المكرّر الحقيقي فقط) |
| `projectId` | `project_id` | link-or-null — **إن فُقد المشروع نُبقي السطر بلا ربط + ملاحظة إلزامية** |
| `sectorId` | `sector_id` | — |
| `derivedFrom` | `deliverable_id` | link-or-null ضد `deliverable` |
| `amountSar` | `amount_halalas` | `toHalalas` (مرساة: 61,188,430.18 SAR — **يجب أن تتطابق تمامًا**) |
| `month`,`year`,`label` | `month`,`year`,`label` | — |
| `auto` | `auto` | `?1:0` (10 آلية من محرك R3) |
| `ruleId` | `rule_id` | — |

> **يتيم معروف واحد:** `rl_mraj7p1q28y` بقيمة **30,700,250 SAR** يشير لمشروع `p_fin_01160` غير موجود ⇒ يُرحَّل بـ `project_id=NULL` مع ملاحظة صريحة. **المبلغ لا يُفقَد** ويظل ضمن مجموع الإيراد. (`sourceProject`,`sourceOppId`,`finCode`,`source` لا تُرحَّل لأعمدة.)

### 3.12 `costLines` (148) → `cost_line` (148) — never-drop

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| — | `id` | `id('cl')` (المصدر لا يضمن تفرّد المعرّف ⇒ معرّف جديد) |
| `projectId` | `project_id` | link-or-null (0 يتيم حاليًا؛ عند الفقد يُبقى) |
| `sectorId` | `sector_id` | — |
| `type` | `type` | (رواتب/تعاقد باطني/أخرى) |
| `amountSar` | `amount_halalas` | `toHalalas` — **حساس** (مرساة: 14,499,912.69 SAR) |
| `month`,`year`,`source` | `month`,`year`,`source` | — |
| `label` | — | لا عمود (يُدمَج في `type`/يُهمَل نصيًّا) |

### 3.13 `allocations` (47) → `allocation` (47)

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| — | `id` | `id('al')` |
| `personId` | `employee_id` | link-or-null ضد `employee` (0 يتيم — كلها تُطابِق) |
| `personNameAr` | `person_name_ar` | يُحفَظ للأمان حتى لو فُقد `employee_id` |
| `projectId` | `project_id` | link-or-null |
| `projectName` | `project_name` | يُحفَظ نصيًّا |
| `sectorId`,`type` | `sector_id`,`type` | — |
| `monthly{}` | `monthly_json` | `JSON.stringify(monthly || {})` — مصفوفة الإشغال الشهري تُخزَّن JSON |
| `monthStart`,`monthEnd`,`year`,`source` | `month_start`,`month_end`,`year`,`source` | — |
| `allocPct`,`notes` | — | لا عمود مخصّص (يمكن ضمّها لـ monthly_json مستقبلًا) |

### 3.14 `budget` (1) → `budget` (1)

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| — | `id` | `id('bud')` |
| `fy` | `fiscal_year` | `|| 2026` |
| — | `sector_id` | `NULL` (موازنة على مستوى الشركة) |
| `targetRevenueSar` | `target_revenue_halalas` | `toHalalas` |
| `targetSalesSar` | `target_sales_halalas` | `toHalalas` |
| `targetGrossMarginPct` | `target_margin_pct` | `|| 0` |
| `costAssumptions{}` | `cost_assumptions_json` | `JSON.stringify` |
| `monthlyRevenue[]` | `monthly_json` | `JSON.stringify` (12 شهرًا previous/new) |

### 3.15 `activity` (443) → `audit_log` (443) — **توسعة هذا المستند**

> السكربت المرجعي الحالي لا يُرحّل `activity`؛ هذا المستند يوجب ترحيلها حفاظًا على سجل التدقيق التاريخي.

| المصدر | الهدف | التحويل |
|--------|-------|---------|
| `id` | `audit_log.id` | كما هو |
| `at` | `at` | — |
| `userId` | `user_id` | link-or-null ضد `app_user` |
| `username` | `username` | — |
| `role` | `role_id` | عبر `roleMap` (أو النص كما هو) |
| `kind` | `action` | `'state-save'` → قيمة `action` (أو تُطبَّع إلى `update`) |
| — | `resource` | `'legacy-state'` (مرجع تاريخي) |
| `sectorId` | `sector_id` | — |
| `changes[]` (+`ignoredKeys`) | `detail_json` | `JSON.stringify({changes, ignoredKeys})` (تُحفَظ فروقات was/now) |
| — | `ip` | `NULL` |

### 3.16 مجموعات مرجعية/زائدة (Reference & Redundant)

| المجموعة | العدد | المعالجة |
|----------|:----:|----------|
| **`practices`** | 5 | **لا يوجد جدول هدف في v1.** قرار مطلوب D1 (§7). حتى صدوره: تُحفَظ كبيانات مرجعية (seed config) ولا تُفقَد؛ إشارات الفرص/الخدمات إليها (`practiceId`, `service.category`) تبقى نصيًّا. الترحيل الفعلي مؤجَّل لجدول `practice`/`taxonomy`. |
| **`priorities`** | 4 | تعداد مرجعي (enum) وليس جدولًا. القيم `P0–P3` تُستخدَم مباشرة في `opportunity.priority` و`task.priority`. تُزرَع تسمياتها/ألوانها في seed config للنظام (لا صفوف بيانات). |
| **`directory`** | 25 | **زائد ومكرّر:** كل الـ25 معرّفًا موجود مسبقًا في `users` (تحقّق: 0 خارج users). لا صفوف جديدة — يُستخدَم فقط للتحقّق/إثراء `scope`/`sectorId` عند فراغها في app_user. |
| **`importLog`** | 1 | سجل اختبار وحيد `{at:"now",type:"test"}` — ضجيج. لا يُرحَّل (محفوظ في اللقطة). |
| **`sessions` / `directives`** | 0 / 0 | فارغة — لا شيء يُرحَّل. |
| **`meta`** | — | الحقول القياسية (`org`,`fiscalYear`,`currency`,`locale`) → إعدادات نظام (config). `syncLog[]`,`dataFixes[]`,`migrations{}`,`keyRevisions{}` → **provenance تاريخية**: تُحفَظ كما هي (اللقطة) ويُنصَح بإدراج ملخّصها في `audit_log` كأحداث ترحيل. `revision`/`X-Base-Revision` مُلغى مفهوميًّا (النظام الجديد يعتمد `updated_at` لكل صف + `audit_log`). |

---

## 4. معالجة الفجوات (Gap Handling)

### 4.1 العملاء بلا نوع (71 من 90)
`type=NULL` مسموح في المخطط. **لا نخترع نوعًا.** الإجراء:
1. تُرحَّل بـ `type=NULL` (بيانات محفوظة كاملة).
2. يُنتَج بند في تقرير المطابقة: «71 عميلًا بحاجة تصنيف نوع» مع قائمة المعرّفات.
3. يُقترَح قاعدة إلزام حقل `type` **عند التحرير التالي** لا عند الترحيل (لا نمنع الترحيل بسبب نقص قديم).
4. حملة تنظيف لاحقة (خارج الترحيل) يملكها قادة القطاعات (R8 في تقرير التحليل).

### 4.2 القطاعات القوالب (STRATEGIC, SAP)
تُرحَّل كسجلات فعلية بـ `is_placeholder=1` و`lead_user_id=NULL`. لا بياناتها تُفقَد ولا تُخترَع. تُميَّز في الواجهة والتقارير كـ«بانتظار التفعيل».

### 4.3 روابط الملاك الميتة (39 فرصة + 28 مشروعًا)
سبب: قطاع CONSULTING استُورد بمُعرّفات ملّاك `u_cons_*` (23 مُعرّفًا) لم تُنشأ كمستخدمين قط، إضافة إلى 16 فرصة تشير لأعضاء فريق (employees) لا مستخدمين (app_user).
الإجراء:
- `owner_user_id=NULL` لكل رابط غير مُطابِق (link-or-null) — **لا تُسقَط الفرصة/المشروع**.
- تقرير المطابقة يسرد المعرّفات الميتة الفريدة.
- **معالجة مقترحة (ما بعد الترحيل، §5.2):** خطوة اختيارية تنشئ `app_user` خفيفًا (directory-only، `password_hash=NULL`, `active` حسب الأصل) لكل `u_cons_*` مرجعي لاستعادة نسبة الملكية، أو تربط الملكية بـ `employee` عبر `membership(role_in_group='owner')`. القرار D3 (§7).

### 4.4 فجوة التحصيل/الفوترة
`invoiceStatus='مفوتر'` على 264 مخرجًا بينما `status IN (INVOICED,PAID)` على 11 فقط. لا نوفّق قسريًّا: نشتقّ الفواتير من `status` الرسمي (11) ونُدوّن التباين كمشكلة جودة بيانات لمراجعة المالية. المخرجات الـ248 «DELIVERED» غير المفوترة تظل مصدرًا لفواتير تشغيلية مستقبلية.

### 4.5 كلمات المرور مفقودة
اللقطة لا تحوي `password_hash`. كل `app_user` يُرحَّل بـ `password_hash=NULL` و`must_change_pw=1` ⇒ لا دخول حتى يضبط المسؤول كلمات المرور (يتماشى مع الإصلاح الأمني P0). حسابات العرض التجريبية تُنشأ من `scripts/seed.js` منفصلة.

### 4.6 الأسماء البديلة للعملاء (`aliases[]`) والحقول المالية الغنية
لا جدول `client_alias` في v1، ولا أعمدة للحقول المالية القديمة الغنية (collected/outstanding/…). **لا تُفقَد**: تبقى محفوظة في اللقطة المصدرية (للقراءة دائمًا) وتُدرَج في تقرير المطابقة كـ«بيانات محفوظة غير مُرحَّلة لأعمدة». قرارات D4/D5 (§7) تحسم إنشاء الجداول.

---

## 5. خطوات التنفيذ (Runbook)

### 5.0 المتطلّبات
Node.js 22 (علم `--experimental-sqlite`). كل الأوامر من مجلد `platform/`.

### 5.1 التسلسل الكامل

```bash
# 0) نسخة احتياطية أولًا (لا تتخطَّ هذه الخطوة)
npm run backup                      # scripts/backup.js → data/backups/sanad-<ts>.db

# 1) تطبيق المخطط (idempotent، متتبَّع في schema_migration)
npm run migrate                     # يطبّق migrations/001_init.sql

# 2) زرع بيانات النظام (أدوار، workflows، تعريفات تقارير/KPI)
npm run seed                        # scripts/seed.js — لا يمسّه الترحيل

# 3) DRY-RUN — ترحيل + مطابقة دون التزام (انظر 5.3)
DRY_RUN=1 npm run migrate-legacy    # يطبع التقرير، ثم rollback

# 4) الترحيل الفعلي (معاملة ذرّية واحدة)
npm run migrate-legacy              # scripts/migrate-legacy.js
                                    # يكتب data/migration-reconciliation.json

# 5) التحقّق بعد الترحيل (استعلامات القبول §6)
npm test                            # tests/ + استعلامات القبول
```

### 5.2 خطوة ما بعد الترحيل (Post-Migration Backfill)
تُشغَّل بعد نجاح الخطوة 4 (داخل نفس المعاملة أو تمريرة لاحقة موثّقة):
1. **`sector.lead_user_id`**: `UPDATE sector SET lead_user_id = (SELECT id FROM app_user WHERE id = <legacy leadId>)` لكل قطاع بقائد صالح (SOLUTIONS→u_yasser_saleh, CONSULTING→u_hme). link-or-null.
2. **`employee.user_id`**: عكس ربط `app_user.employee_id` (الـ7 المتطابقين بالاسم) لضمان اتّجاهي العلاقة.
3. **(اختياري، قرار D3)** إنشاء app_users مرجعيين لـ`u_cons_*` أو ربط الملكية عبر `membership`.

### 5.3 آلية الـ DRY-RUN
السكربت يلتفّ حول `tx(() => …)`. لدعم dry-run دون التزام:
- تُقرأ راية البيئة `DRY_RUN`. عند `=1`: يُنفَّذ كامل منطق الإدراج داخل معاملة **ثم يُرمى استثناء مُتحكَّم `__DRY_RUN_ROLLBACK__`** بعد بناء تقرير المطابقة، فتتراجع المعاملة بالكامل — تبقى القاعدة كما كانت، ويُطبَع التقرير والمطابقة على stdout.
- عند غياب الراية: التزام طبيعي + كتابة `data/migration-reconciliation.json`.
- الفائدة: يرى المهندس أعداد الهدف والمجاميع المالية والملاحظات (الأيتام، الروابط الميتة) **قبل** أي كتابة دائمة.

نموذج تعديل الغلاف في `migrateLegacy()`:
```js
const DRY = process.env.DRY_RUN === '1';
try {
  tx(() => { /* … كل الإدراجات … */ buildReconciliation(); if (DRY) throw new Error('__DRY_RUN_ROLLBACK__'); });
} catch (e) { if (e.message !== '__DRY_RUN_ROLLBACK__') throw e; }
// طباعة التقرير في الحالتين؛ الكتابة للملف فقط إن !DRY
```

### 5.4 معالجة الأخطاء (Error Handling)
| الحالة | السلوك |
|--------|--------|
| أب مفقود لمفتاح أجنبي | `NULL` + ملاحظة (لا توقّف) — G5 |
| سطر مالي بمشروع مفقود | يُرحَّل بلا ربط + ملاحظة (never-drop) — §3.11 |
| معرّف مخرج مكرّر حقيقي | يُتخطّى الثاني (حارس دفاعي) + عدّاد في التقرير |
| خطأ إدراج/قيد (نوع/NOT NULL/UNIQUE) | استثناء ⇒ **rollback كامل للمعاملة**؛ لا كتابة جزئية. يُصلَح ثم يُعاد التشغيل (idempotent، G9) |
| فشل بعد الالتزام | استعادة من `data/backups/` (`guides/ROLLBACK.md`) |
| تعارض بيانات مالية (المجاميع لا تتطابق) | يُوقِف القبول (§6): يُحقَّق يدويًّا قبل الاعتماد؛ لا يُنشَر على الإنتاج |

### 5.5 التراجع (Rollback)
- قبل الالتزام: الـtx يتراجع تلقائيًّا.
- بعد الالتزام: `cp data/backups/sanad-<ts>.db data/sanad.db` (أو استرجاع لقطة PostgreSQL). اللقطة المصدرية غير قابلة للتلف (للقراءة فقط).

---

## 6. تقرير المطابقة والقبول (Reconciliation & Acceptance)

يُكتَب إلى `platform/data/migration-reconciliation.json`. **معيار القبول: كل الأعداد تتطابق، وكل مرساة مالية بفارق ≤ 0.01 SAR.**

### 6.1 مطابقة الأعداد (Source → Target)

| المصدر | العدد | الهدف | العدد المتوقّع | ملاحظة |
|--------|:----:|-------|:-------------:|--------|
| sectors | 4 | `sector` | 4 | — |
| stages | 6 | `stage` | 6 | — |
| clients | 90 | `client` | 90 | 71 بلا type |
| suppliers | 33 | `supplier` | 33 | sup_x يبقى |
| services | 15 | `service` | 15 | + `service_package` = 20 |
| team | 29 | `employee` | 29 | + `department` = 4، `position` = 4 |
| users | 26 | `app_user` | 26 | + `login_history` ≈ 36 |
| directory | 25 | (مدموج) | 0 جديد | زائد |
| opportunities | 134 | `opportunity` | 134 | + `opportunity_sector` = 132 |
| projects | 43 | `project` | 43 | + `contract` = 23 |
| deliverables | 342 | `deliverable` | 342 | + `invoice` = 11 |
| revenueLines | 31 | `revenue_line` | 31 | 1 بلا ربط مشروع |
| costLines | 148 | `cost_line` | 148 | — |
| allocations | 47 | `allocation` | 47 | — |
| budget | 1 | `budget` | 1 | — |
| activity | 443 | `audit_log` | 443 | توسعة §3.15 |
| practices | 5 | — | 0 (مؤجَّل D1) | محفوظة |
| priorities | 4 | — (enum) | 0 | seed config |

### 6.2 مطابقة المجاميع المالية (قبل/بعد)

| المرساة | المصدر (SAR) | الهدف المتوقّع | تحقّق |
|---------|-------------:|---------------:|-------|
| قيمة الفرص | 1,279,326,693.70 | `SUM(value_halalas)/100` | = |
| الإيراد | 61,188,430.18 | `SUM(revenue_line.amount_halalas)/100` | = (يشمل اليتيم 30,700,250) |
| العقود | 67,931,813.70 | `SUM(contract.value_halalas)/100` | = |
| المخرجات | 87,997,805.50 | `SUM(deliverable.amount_halalas)/100` | = |
| الفواتير | 15,556,052.30 | `SUM(invoice.amount_halalas)/100` | = |
| التكاليف | 14,499,912.69 | `SUM(cost_line.amount_halalas)/100` | = |
| الرواتب | 369,544.50 | `SUM(employee.salary_halalas)/100` | = |

### 6.3 استعلامات القبول (Acceptance SQL)
```sql
-- الأعداد
SELECT 'opportunity' t, COUNT(*) n FROM opportunity
UNION ALL SELECT 'contract', COUNT(*) FROM contract       -- =23
UNION ALL SELECT 'invoice',  COUNT(*) FROM invoice        -- =11
UNION ALL SELECT 'department',COUNT(*) FROM department    -- =4
UNION ALL SELECT 'position', COUNT(*) FROM position;      -- =4

-- المجاميع المالية (يجب أن تساوي مصدرها)
SELECT SUM(value_halalas)/100.0  FROM opportunity;        -- 1279326693.70
SELECT SUM(amount_halalas)/100.0 FROM revenue_line;       -- 61188430.18

-- الأيتام المتوقَّعة (للتوثيق لا للفشل)
SELECT id, amount_halalas/100.0 FROM revenue_line WHERE project_id IS NULL;   -- rl_mraj7p1q28y
SELECT COUNT(*) FROM opportunity WHERE owner_user_id IS NULL;                 -- ~39
SELECT COUNT(*) FROM client WHERE type IS NULL;                               -- 71

-- سلامة مرجعية: لا FK يشير لأب غير موجود
SELECT COUNT(*) FROM deliverable d LEFT JOIN project p ON p.id=d.project_id WHERE p.id IS NULL; -- 0
```

### 6.4 قائمة الملاحظات المُلزَمة في التقرير (`report.notes`)
- «سطر إيراد `rl_mraj7p1q28y` (30,700,250 ريال) رُحِّل بلا ربط مشروع (`p_fin_01160` غير موجود).»
- «كلمات المرور غير موجودة في اللقطة → المستخدمون بلا دخول حتى الضبط (`must_change_pw=1`).»
- «اشتُقّت العقود من `contractValueSar` والفواتير من المخرجات INVOICED/PAID.»
- «39 فرصة و28 مشروعًا بمالك غير مُطابِق (منها 23 مُعرّف `u_cons_*`) ⇒ `owner_user_id=NULL`.»
- «71 عميلًا بلا `type` — بحاجة تصنيف.»
- «تباين الفوترة: `invoiceStatus=مفوتر` على 264 مخرجًا مقابل status INVOICED/PAID على 11 — مراجعة مالية.»

---

## 7. القرارات المفتوحة (Open Decisions)

| # | القرار | الأثر على الترحيل | الافتراض الحالي |
|---|--------|-------------------|-----------------|
| D1 | جدول `practice`/`taxonomy` للتخصصات الـ5؟ | يحدّد وجهة `practices` وحقول `practiceId` في الفرص/الخدمات | مؤجَّل؛ محفوظة كـ seed config لا جدول |
| D2 | ترحيل `org_unit` و`line_manager`؟ | لا مصدر بيانات؛ تبقى `NULL` | لا اشتقاق (نص `dept` فقط ⇒ department) |
| D3 | استعادة ملكية `u_cons_*` (39+28)؟ | إنشاء app_users مرجعيين أو ربط عبر `membership` | `owner_user_id=NULL` + ملاحظة (خطوة اختيارية §5.2) |
| D4 | جداول التحصيل الغنية (collection/expense/purchase_order) من الحقول المالية القديمة؟ | إثراء إضافي؛ لا فقد حاليًّا | لا تُرحَّل الآن (محفوظة في اللقطة) |
| D5 | جدول `client_alias` للأسماء البديلة؟ | يحفظ سجلّ الدمج | مؤجَّل؛ محفوظ في اللقطة/التقرير |
| D6 | تسمية `action` في audit_log (`state-save` كما هو أم تطبيع لـ`update`)؟ | اتّساق سجل التدقيق | يُحفَظ كما هو + `resource='legacy-state'` |

---

## 8. الخلاصة التنفيذية للمهندس

1. `backup → migrate → seed → DRY_RUN=1 migrate-legacy → migrate-legacy → post-migration backfill → acceptance SQL`.
2. القاعدة الذهبية: **لا حذف، لا فقد مالي، link-or-null**؛ كل انحراف يُدوَّن في `migration-reconciliation.json` لا يُصلَح قسرًا.
3. النتائج المتوقّعة قطعيًّا: 4 sector · 90 client · 134 opportunity · 43 project (+23 contract) · 342 deliverable (+11 invoice) · 31 revenue_line (منها 1 يتيم) · 29 employee (+4 department +4 position) · 26 app_user (بلا دخول) · 443 audit_log.
4. الأرقام المالية تُقفَل عند المطابقة: أي فرق يتجاوز التقريب يوقف القبول.
