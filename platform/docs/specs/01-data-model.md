# SPEC-01 — نموذج البيانات العلائقي الكامل لمنصة «سند» (Enterprise OS)

- **الحالة:** مسودة قابلة للتنفيذ (v1.0)
- **التاريخ:** 2026-07-13
- **المالك:** فريق منصة «سند» — رؤية الخبراء الاستشارية (EVC)
- **المرجعية:** `docs/02-analysis-report.md` (تحليل As-Is) · `platform/docs/adr/ADR-0001-architecture.md` · لقطة الترحيل `platform/seed/legacy-state.snapshot.json` (revision 890)
- **النطاق:** DDL منطقي كامل لكل النطاقات (التنظيم، CRM، PMO، الوقت، Workflow، المالية، الخدمات، التقارير/البريد، الحوكمة)، متوافق مع **SQLite (تطوير)** و**PostgreSQL (إنتاج)** عبر طبقة المستودعات المعتمدة في ADR-0001.

> هذا المستند مرجع تنفيذي مباشر لمهندس. كل جدول مُعرّف بأعمدته وأنواعه ومفاتيحه وفهارسه وقيوده وحقول تدقيقه ونطاق العزل (tenant/scope)، مع بيان كيفية تغطية حقول اللقطة الحالية في القسم 14.

---

## جدول المحتويات

1. [اتفاقيات النمذجة والأنواع](#1-اتفاقيات-النمذجة-والأنواع)
2. [التوافق بين SQLite و PostgreSQL](#2-التوافق-بين-sqlite-و-postgresql)
3. [الجداول المرجعية والإعدادات (Reference & Config)](#3-الجداول-المرجعية-والإعدادات)
4. [نطاق التنظيم (Organization)](#4-نطاق-التنظيم-organization)
5. [نطاق CRM](#5-نطاق-crm)
6. [نطاق PMO](#6-نطاق-pmo)
7. [نطاق الوقت والتسكين (Time & Resourcing)](#7-نطاق-الوقت-والتسكين)
8. [نطاق سير العمل والاعتمادات (Workflow)](#8-نطاق-سير-العمل-والاعتمادات-workflow)
9. [نطاق المالية (Finance)](#9-نطاق-المالية-finance)
10. [نطاق الخدمات والمنتجات (Services)](#10-نطاق-الخدمات-والمنتجات)
11. [نطاق التقارير والبريد (Reporting & Email)](#11-نطاق-التقارير-والبريد)
12. [نطاق الحوكمة والمشترك (Governance & Shared)](#12-نطاق-الحوكمة-والمشترك)
13. [ملخص علاقات M:N](#13-ملخص-علاقات-mn)
14. [تغطية حقول اللقطة الحالية (Snapshot Coverage)](#14-تغطية-حقول-اللقطة-الحالية)
15. [استراتيجية الفهرسة والأداء](#15-استراتيجية-الفهرسة-والأداء)
16. [ملاحظات الترحيل من الوثيقة الواحدة](#16-ملاحظات-الترحيل)

---

## 1. اتفاقيات النمذجة والأنواع

### 1.1 المفاتيح والمعرّفات
- **المفتاح الأساسي:** `id TEXT PRIMARY KEY` في كل جدول أعمال. القيمة **ULID مسبوق بلاحقة الكيان** (`emp_01J…`, `prj_01J…`, `opp_01J…`). سبب الاختيار:
  - يحافظ على **معرّفات اللقطة الوصفية** القائمة (`u_rayan_zafar`, `p_001`, `o_cons_1`) أثناء الترحيل دون كسر المراجع.
  - قابل للتوليد في الطبقة التطبيقية (لا حاجة لـ `SERIAL`/`AUTOINCREMENT` المختلف بين اللهجتين)، وقابل للفرز زمنيًا.
- **المفاتيح الأجنبية:** كلها `TEXT` تشير إلى `id` الهدف. سياسة الحذف الافتراضية `ON DELETE RESTRICT` (نعتمد الحذف المنطقي soft-delete)، ما لم يُذكر `ON DELETE CASCADE` لجداول الأبناء المملوكة بالكامل (detail/junction).
- **الأكواد التجارية** (`code`, `financial_code`) تبقى أعمدة `TEXT` منفصلة بقيود فريدة، لا كمفاتيح أساسية.

### 1.2 الأنواع المنطقية (Logical Domains)
يُكتب الـDDL بأنواع PostgreSQL، وتُترجمها طبقة المستودعات إلى SQLite حسب الجدول التالي:

| النوع المنطقي | PostgreSQL | SQLite (عبر المستودع) | الاستخدام |
|---------------|-----------|------------------------|-----------|
| `TEXT` | `TEXT` | `TEXT` | معرّفات، أكواد، نصوص |
| `BOOLEAN` | `BOOLEAN` | `INTEGER` (0/1) | أعلام |
| `TIMESTAMPTZ` | `TIMESTAMPTZ` | `TEXT` ISO-8601 UTC (`2026-07-13T19:02:41.087Z`) | أختام زمنية |
| `DATE` | `DATE` | `TEXT` (`YYYY-MM-DD`) | تواريخ يوم |
| `NUMERIC(18,2)` (نوع مجال `money_sar`) | `NUMERIC(18,2)` | `INTEGER` هللات (×100) أو `NUMERIC` | مبالغ مالية |
| `NUMERIC(6,3)` (نوع مجال `pct`) | `NUMERIC(6,3)` | `REAL` | نِسَب مئوية 0–100 |
| `INTEGER` | `INTEGER` | `INTEGER` | أعداد صحيحة، أشهر (1–12) |
| `JSONB` | `JSONB` | `TEXT` + `CHECK(json_valid(col))` | حقول مرنة/تفصيلية غير معيارية |

> **المال (`money_sar`):** الأرقام في اللقطة عشرية بالهللات (`756642.5`, `114054.62`). في PostgreSQL نستخدم `NUMERIC(18,2)` (دقة تامة). في SQLite توصي طبقة المستودعات بالتخزين كـ **عدد صحيح هللات** لتفادي انحراف `REAL`، مع التحويل عند القراءة/الكتابة. الـDDL أدناه يكتب `NUMERIC(18,2)` كعقد منطقي موحّد.

> **النِّسَب (`pct`):** نُوحّد كل النِّسَب على **0–100** بدقة `NUMERIC(6,3)`. اللقطة تخلط تمثيلين (`marginPct: 25` كنسبة، و`marginPct: 0.1358` كنسبة عشرية داخل `financials`) — الترحيل يضرب النسب العشرية ×100.

### 1.3 حقول التدقيق القياسية — الرمز `STD_AUDIT`
كل **جدول أعمال** يُذيَّل حرفيًا بالكتلة التالية (تُعرَّف هنا مرة واحدة وتُدرَج في كل `CREATE TABLE` مكتوبةً `-- STD_AUDIT`):

```sql
-- STD_AUDIT (تُدرَج حرفيًا في نهاية كل جدول أعمال)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT        REFERENCES app_user(id),   -- nullable لبيانات الترحيل/التمهيد
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   TEXT        REFERENCES app_user(id),
  deleted_at   TIMESTAMPTZ,                           -- الحذف المنطقي (soft-delete)
  deleted_by   TEXT        REFERENCES app_user(id),
  row_version  INTEGER     NOT NULL DEFAULT 1          -- تزامن تفاؤلي لكل صف (بديل revision العام)
```

- **الحذف المنطقي:** لا نحذف صفوف الأعمال فعليًا؛ نضبط `deleted_at`/`deleted_by`. كل الاستعلامات التشغيلية تُرشِّح `WHERE deleted_at IS NULL`. القيود الفريدة تُبنى كفهارس جزئية على غير المحذوف (القسم 1.5).
- **التزامن التفاؤلي:** `row_version` يحل محل عدّاد `revision` العام في نموذج الوثيقة الواحدة؛ يُزاد عند كل تحديث، ويُرفض التحديث إذا لم يطابق العميل النسخة (بديل ترويسة `X-Base-Revision`).
- **الدورة المرجعية company↔app_user:** `company.created_by → app_user`, و`app_user.company_id → company`. كلا المفتاحين يقبل NULL؛ التمهيد يُدرج صف الشركة النظامية أولًا (بـ `created_by = NULL`) ثم المستخدم النظامي. المفاتيح تُضاف كـ `DEFERRABLE INITIALLY DEFERRED` في PostgreSQL؛ وفي SQLite تُدار بترتيب الإدراج.

### 1.4 نطاق العزل (Tenant / Scope) — الرمز `STD_SCOPE`
- **`company_id`** حاضر في **كل جدول أعمال** (عدا الجداول المرجعية العامة والنظامية)، ويُشكّل حدّ العزل الأعلى (Enterprise OS متعدد الكيانات مستقبلًا). يُكتب:
  ```sql
  -- STD_SCOPE
    company_id TEXT NOT NULL REFERENCES company(id),
  ```
- **`sector_id`** حاضر في الجداول التي يجري تفويضها/ترشيحها على مستوى القطاع (opportunity, project, service, employee, revenue_line, …). قابل لأن يكون `NULL` للكيانات على مستوى الشركة. هو **مفتاح التفويض الخادمي** (RBAC scope) وفق ADR-0001.
- كل استعلام يمرّ عبر المستودع يُحقن فيه `company_id` (ومعه `sector_id` عند تقييد الدور بقطاعه).

### 1.5 الفهارس والقيود الفريدة
- كل مفتاح أجنبي يُفهرَس صراحةً (SQLite لا يُفهرِس FK تلقائيًا).
- **القيود الفريدة على غير المحذوف** تُنفَّذ كفهارس جزئية:
  ```sql
  CREATE UNIQUE INDEX ux_<t>_<cols> ON <t>(company_id, <cols>) WHERE deleted_at IS NULL;
  ```
  الفهارس الجزئية مدعومة في **كلا المحرّكين** (SQLite ≥ 3.8.0, PostgreSQL).
- التعدادات الثابتة تُنفَّذ بـ `CHECK (col IN (...))`؛ التعدادات **القابلة للتهيئة** (المراحل، الأولويات، أنواع العملاء، التخصصات، أنواع الوحدات) تُنفَّذ **كجداول مرجعية** بمفاتيح أجنبية — تحقيقًا لمتطلب «النموذج التنظيمي المرن غير الـHard-coded».

### 1.6 التسمية
- الجداول: مفرد `snake_case` (`project`, `time_entry`). جداول الربط: `<a>_<b>` (`project_member`, `opportunity_sector`).
- الجدول `app_user` بدل `user` (كلمة محجوزة في PostgreSQL) — يُشار إليه في الوثيقة بـ«user». الجدول `app_session` كذلك.
- الأعمدة الثنائية اللغة: `name_ar` / `name_en`، `title_ar` / `title_en`.

---

## 2. التوافق بين SQLite و PostgreSQL

| الموضوع | القرار الموحّد |
|---------|----------------|
| المفاتيح الأساسية | `TEXT` ULID تطبيقية — لا `SERIAL`/`AUTOINCREMENT`. |
| الوقت الافتراضي | `DEFAULT now()` في PostgreSQL؛ المستودع يحقن `CURRENT_TIMESTAMP`/ISO-UTC في SQLite. |
| Boolean | يُكتب `BOOLEAN`؛ يُخزَّن `INTEGER 0/1` في SQLite. |
| JSON | يُكتب `JSONB`؛ في SQLite `TEXT` مع `CHECK(json_valid(col))` وفهرسة عبر تعبيرات `json_extract` عند الحاجة. |
| المال | `NUMERIC(18,2)` منطقيًا؛ SQLite: هللات صحيحة عبر المستودع. |
| المفاتيح المؤجَّلة (DEFERRABLE) | تُستخدم في PostgreSQL لكسر الدورات المرجعية؛ SQLite يفرض FK عند الالتزام افتراضيًا مع `PRAGMA foreign_keys=ON` ويُدار بترتيب الإدراج. |
| الفهارس الجزئية | مدعومة في الاثنين. |
| `ON UPDATE`/التريغرات | تجنّبناها؛ `updated_at`/`row_version` يُداران في طبقة التطبيق لضمان سلوك موحّد. |
| المخطط (schema) | PostgreSQL: مخطط `sanad`؛ SQLite: قاعدة واحدة. الأسماء غير المؤهَّلة تعمل في الاثنين. |

---

## 3. الجداول المرجعية والإعدادات

> جداول صغيرة، بعضها **قابل للتهيئة من الإدارة** (سبب اختيار الجدول لا الـENUM). الجداول المرجعية النظامية البحتة (currency) تُعفى من `STD_SCOPE`؛ المرجعية القابلة للتهيئة على مستوى الشركة تحمل `company_id`.

### 3.1 `company` — الكيان/المستأجر الجذري
```sql
CREATE TABLE company (
  id            TEXT PRIMARY KEY,                 -- 'cmp_evc'
  code          TEXT NOT NULL,                    -- 'EVC'
  name_ar       TEXT NOT NULL,                    -- 'رؤية الخبراء الاستشارية'
  name_en       TEXT,
  domain        TEXT,                             -- 'evcsol.com'
  default_sector_id TEXT,                         -- FK → sector (يُضاف بعد إنشاء sector)
  fiscal_year   INTEGER NOT NULL DEFAULT 2026,
  currency_code TEXT NOT NULL DEFAULT 'SAR' REFERENCES currency(code),
  locale        TEXT NOT NULL DEFAULT 'ar-SA',
  timezone      TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  active        BOOLEAN NOT NULL DEFAULT true,
  settings      JSONB,                            -- إعدادات مرنة إضافية
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT,
  deleted_at TIMESTAMPTZ, deleted_by TEXT, row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_company_code ON company(code) WHERE deleted_at IS NULL;
```
- يغطّي `meta.org`, `meta.fiscalYear`, `meta.currency`, `meta.locale`, `meta.sector` (كـ default_sector).

### 3.2 `currency` — العملات (نظامي)
```sql
CREATE TABLE currency (
  code        TEXT PRIMARY KEY,     -- 'SAR'
  name_ar     TEXT NOT NULL,        -- 'ريال سعودي'
  name_en     TEXT NOT NULL,
  symbol      TEXT,                 -- 'ر.س'
  minor_units INTEGER NOT NULL DEFAULT 2,
  active      BOOLEAN NOT NULL DEFAULT true
);
```

### 3.3 `pipeline_stage` — مراحل الفرص (قابل للتهيئة)
```sql
CREATE TABLE pipeline_stage (
  id              TEXT PRIMARY KEY,          -- 'LEAD','QUALIFIED','PROPOSAL','WON','LOST','ON_HOLD'
  company_id      TEXT NOT NULL REFERENCES company(id),
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  default_win_pct NUMERIC(6,3),              -- 10,25,50,100,0,NULL(ON_HOLD)
  sort_order      INTEGER NOT NULL,          -- stages[].order
  is_won          BOOLEAN NOT NULL DEFAULT false,
  is_lost         BOOLEAN NOT NULL DEFAULT false,
  is_terminal     BOOLEAN NOT NULL DEFAULT false,
  color           TEXT,
  active          BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_stage_order ON pipeline_stage(company_id, sort_order);
CREATE INDEX ix_stage_company ON pipeline_stage(company_id);
```
- يغطّي مصفوفة `stages` (6 مراحل، `order`, `defaultWinPct`, `color`). ملاحظة: هذا جدول مرجعي بلا soft-delete كامل؛ الفهرس الفريد على `(company_id, sort_order)`.

### 3.4 `priority` — الأولويات (قابل للتهيئة)
```sql
CREATE TABLE priority (
  id         TEXT PRIMARY KEY,     -- 'P0'..'P3'
  company_id TEXT NOT NULL REFERENCES company(id),
  name_ar    TEXT NOT NULL,        -- 'P0 — حرجة'
  name_en    TEXT,
  rank       INTEGER NOT NULL,     -- 0..3
  color      TEXT,
  active     BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_priority_rank ON priority(company_id, rank);
```
- يغطّي `priorities` (P0–P3).

### 3.5 `practice` — التخصصات/الممارسات (قابل للتهيئة)
```sql
CREATE TABLE practice (
  id         TEXT PRIMARY KEY,     -- 'INNOVATION','AI_DATA','SMART_CITIES','OTHER',...
  company_id TEXT NOT NULL REFERENCES company(id),
  name_ar    TEXT NOT NULL,
  name_en    TEXT,
  color      TEXT,
  active     BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX ix_practice_company ON practice(company_id);
```
- يغطّي `practices` (5) و`opportunity.practiceId` و`project.practice` و`service.category` (تصنيف).

### 3.6 `client_type` — أنواع العملاء (قابل للتهيئة — يعالج فجوة الـ71 بلا تصنيف)
```sql
CREATE TABLE client_type (
  id         TEXT PRIMARY KEY,     -- 'GOV','PRIVATE','INTERNAL'
  company_id TEXT NOT NULL REFERENCES company(id),
  name_ar    TEXT NOT NULL,        -- 'حكومي','خاص','داخلي'
  name_en    TEXT,
  active     BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_client_type_name ON client_type(company_id, name_ar);
```

### 3.7 `service_category` و `cost_type` — تصنيفات قابلة للتهيئة
```sql
CREATE TABLE service_category (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id),
  name_ar TEXT NOT NULL, name_en TEXT, practice_id TEXT REFERENCES practice(id),
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE cost_type (               -- 'رواتب','انتداب','إعاشة','تأمينات','مقاولين',...
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id),
  name_ar TEXT NOT NULL, name_en TEXT,
  is_payroll BOOLEAN NOT NULL DEFAULT false,
  is_subcontract BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_cost_type_name ON cost_type(company_id, name_ar);
```
- `cost_type` يغطّي قيم `costLines[].type` النصية الحرة الحالية (رواتب/انتداب/إعاشة/تأمينات/تأمين صحي/رسوم بنكية/فواتير اتصالات/مقاولين) بتحويلها إلى مرجع.

### 3.8 `config` — إعدادات مفتاح/قيمة على مستوى الشركة
```sql
CREATE TABLE config (
  company_id TEXT NOT NULL REFERENCES company(id),
  key        TEXT NOT NULL,           -- 'excelSourceFile','defaultSector','appliedSeedVersion',...
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT REFERENCES app_user(id),
  PRIMARY KEY (company_id, key)
);
```
- يغطّي بقايا `meta` غير المهيكلة (`excelSourceFile`, `excelSourceSheets`, `appliedSeedVersion`, `bootstrapResetUsed`, `testMarker`, …).

### 3.9 `schema_migration` و `import_log` — تتبّع النظام
```sql
CREATE TABLE schema_migration (
  id         TEXT PRIMARY KEY,        -- 'solutionsTeamV1','financeSyncV1',...
  applied_at TIMESTAMPTZ NOT NULL,
  checksum   TEXT,
  notes      TEXT
);

CREATE TABLE import_log (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id),
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  type       TEXT NOT NULL,           -- 'alloc-matrix-v2','finance-sync','excel-import'
  source     TEXT,                    -- 'PROFILE_PPTX_2026','CONS_IMPORT','4-Sol Financial Rep Mar-2026.xlsx'
  entity     TEXT,                    -- الكيان المتأثر
  details    TEXT,
  payload    JSONB,                   -- تفاصيل/عدّادات
  created_by TEXT REFERENCES app_user(id)
);
CREATE INDEX ix_import_log_company_at ON import_log(company_id, at DESC);
```
- `schema_migration` يغطّي `meta.migrations{}`. `import_log` يغطّي `meta.syncLog[]`, `meta.dataFixes[]`, `meta.keyRevisions`, `importLog[]`.

---

## 4. نطاق التنظيم (Organization)

> **مبدأ التصميم:** الهيكل التنظيمي مرن غير مضمّن في الشيفرة. `sector` كيان صريح (يحمل مستهدفات مالية ويُشار إليه في كل مكان)، وما دونه (**Department → Unit → Team**) يُنمذَج كشجرة واحدة قابلة التوسّع `org_unit` بنوع مرجعي `org_unit_type`. **الوظائف** `position` و**الموظفون** `employee` منفصلون، و**العضوية** `membership` تربط الموظف بالوظيفة/الوحدة عبر الزمن. **فِرَق المشاريع/الفرص/البرامج/لجان الاعتماد منفصلة تمامًا** عن هذا الهيكل (جداول ربط في نطاقاتها).

### 4.1 `sector` — القطاع (كيان صريح بمستهدفات)
```sql
CREATE TABLE sector (
  id                     TEXT PRIMARY KEY,           -- 'SOLUTIONS','CONSULTING','STRATEGIC','SAP'
  -- STD_SCOPE
  company_id             TEXT NOT NULL REFERENCES company(id),
  code                   TEXT NOT NULL,
  name_ar                TEXT NOT NULL,
  name_en                TEXT,
  color                  TEXT,
  lead_employee_id       TEXT REFERENCES employee(id),   -- sectors.leadId
  manager_employee_id    TEXT REFERENCES employee(id),   -- sectors.managerId
  target_sales_sar       NUMERIC(18,2),                  -- targetSalesSar
  target_revenue_sar     NUMERIC(18,2),                  -- targetRevenueSar
  target_gross_margin_pct NUMERIC(6,3),                  -- targetGrossMarginPct
  sort_order             INTEGER,
  active                 BOOLEAN NOT NULL DEFAULT true,
  is_placeholder         BOOLEAN NOT NULL DEFAULT false, -- 'placeholder:true' (SAP/الاستراتيجية)
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_sector_code ON sector(company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX ix_sector_company ON sector(company_id);
CREATE INDEX ix_sector_lead ON sector(lead_employee_id);
```
- يغطّي `sectors[]` كاملًا (id, nameAr/En, color, leadId, managerId, target*, active, placeholder).

### 4.2 `org_unit_type` — أنواع وحدات الهيكل (قابل للتهيئة)
```sql
CREATE TABLE org_unit_type (
  id         TEXT PRIMARY KEY,     -- 'DEPARTMENT','UNIT','TEAM'  (قابل للإضافة)
  company_id TEXT NOT NULL REFERENCES company(id),
  name_ar    TEXT NOT NULL,        -- 'إدارة','وحدة','فريق'
  name_en    TEXT,
  depth_hint INTEGER,              -- ترتيب اعتيادي 1/2/3 (إرشادي لا إلزامي)
  active     BOOLEAN NOT NULL DEFAULT true
);
```
- يمنع Hard-coding مستويات الهيكل: يمكن إضافة نوع جديد (مثل «مكتب» أو «شعبة») دون تغيير الشيفرة.

### 4.3 `org_unit` — شجرة الوحدات التنظيمية (Department/Unit/Team مرنة)
```sql
CREATE TABLE org_unit (
  id               TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id       TEXT NOT NULL REFERENCES company(id),
  sector_id        TEXT REFERENCES sector(id),        -- الوحدة تحت قطاع (NULL = على مستوى الشركة)
  parent_id        TEXT REFERENCES org_unit(id),      -- شجرة ذاتية المرجع
  type_id          TEXT NOT NULL REFERENCES org_unit_type(id),
  code             TEXT,
  name_ar          TEXT NOT NULL,
  name_en          TEXT,
  lead_employee_id TEXT REFERENCES employee(id),      -- قائد الوحدة
  path             TEXT,                               -- 'sector/dept/unit' مادّي للاستعلام السريع
  depth            INTEGER,                            -- عمق محسوب
  sort_order       INTEGER,
  active           BOOLEAN NOT NULL DEFAULT true,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_org_unit_parent ON org_unit(parent_id);
CREATE INDEX ix_org_unit_sector ON org_unit(sector_id);
CREATE INDEX ix_org_unit_company ON org_unit(company_id);
CREATE INDEX ix_org_unit_path ON org_unit(company_id, path);
CREATE UNIQUE INDEX ux_org_unit_code ON org_unit(company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
```
- يرسم كيانًا حقيقيًا مكان `team[].dept` النصي الحر الحالي (فجوة Q4 في التحليل). المسار المادّي `path` + `depth` يسرّعان الاستعلامات الشجرية على كلا المحرّكين دون CTE عودي إلزامي.

### 4.4 `position` — الوظيفة/المقعد الوظيفي
```sql
CREATE TABLE position (
  id            TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id    TEXT NOT NULL REFERENCES company(id),
  sector_id     TEXT REFERENCES sector(id),
  org_unit_id   TEXT REFERENCES org_unit(id),
  code          TEXT,
  title_ar      TEXT NOT NULL,          -- 'مدير برنامج','محلل أعمال','استشاري'
  title_en      TEXT,
  grade         TEXT,                   -- درجة وظيفية اختيارية
  is_leadership BOOLEAN NOT NULL DEFAULT false,
  headcount     INTEGER NOT NULL DEFAULT 1,
  active        BOOLEAN NOT NULL DEFAULT true,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_position_unit ON position(org_unit_id);
CREATE INDEX ix_position_company ON position(company_id);
```
- يستوعب أدوار الفريق المذكورة في `project.financials.team[].roleAr` (مدير برنامج/مدير مشروع/محلل أعمال/استشاري) ككيانات قابلة لإعادة الاستخدام.

### 4.5 `employee` — الموظف (سجل الفريق/الموارد)
```sql
CREATE TABLE employee (
  id             TEXT PRIMARY KEY,        -- 'u_rayan_zafar' (يُحافظ عليه)
  -- STD_SCOPE
  company_id     TEXT NOT NULL REFERENCES company(id),
  sector_id      TEXT REFERENCES sector(id),          -- team.sectorId
  code           TEXT,
  name_ar        TEXT NOT NULL,           -- team.nameAr
  name_en        TEXT,                    -- team.nameEn
  role_title     TEXT,                    -- team.role (نص حر: 'AI & Data & Innovation Solutions')
  dept_legacy    TEXT,                    -- team.dept النصي (يُحفظ للترحيل، ثم يُهاجَر إلى org_unit)
  primary_org_unit_id TEXT REFERENCES org_unit(id),
  practice_id    TEXT REFERENCES practice(id),        -- team.practice
  salary_sar     NUMERIC(18,2),           -- team.salarySar  ← حقل حساس (حجب خادمي)
  employment_type TEXT NOT NULL DEFAULT 'CORE'
                   CHECK (employment_type IN ('CORE','SEASONAL','EXTERNAL')),  -- team.type أساسي/موسمي
  is_seasonal    BOOLEAN NOT NULL DEFAULT false,       -- team.seasonal
  is_external    BOOLEAN NOT NULL DEFAULT false,       -- team.external
  status         TEXT NOT NULL DEFAULT 'ACTIVE',       -- team.status 'نشط' → 'ACTIVE'
  start_month    INTEGER,                 -- team.startMonth (تعيين لاحق)
  end_month      INTEGER,                 -- team.endMonth (مغادرة)
  active         BOOLEAN NOT NULL DEFAULT true,        -- team.active
  notes          TEXT,                    -- team.notes
  added_by_note  TEXT,                    -- team.addedBy
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_employee_sector ON employee(sector_id);
CREATE INDEX ix_employee_company ON employee(company_id);
CREATE INDEX ix_employee_unit ON employee(primary_org_unit_id);
CREATE UNIQUE INDEX ux_employee_code ON employee(company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
```
- يغطّي `team[]` كاملًا. **`salary_sar` مُعلَّم حقلًا حسّاسًا** يُحجب على مستوى الخادم إلا لدور مخوَّل (يعالج R2/R6 من التحليل).

### 4.6 `app_user` — حساب الدخول (كيان «user»)
```sql
CREATE TABLE app_user (
  id                 TEXT PRIMARY KEY,     -- 'u_rayan_zafar'
  -- STD_SCOPE
  company_id         TEXT NOT NULL REFERENCES company(id),
  employee_id        TEXT REFERENCES employee(id),  -- ربط الحساب بالموظف (اختياري)
  sector_id          TEXT REFERENCES sector(id),    -- user.sectorId (نطاق الدور)
  scope              TEXT NOT NULL DEFAULT 'SECTOR'
                       CHECK (scope IN ('COMPANY','SECTOR')),  -- user.scope 'COMPANY'/''
  name_ar            TEXT,                 -- user.nameAr
  name_en            TEXT,                 -- user.nameEn
  username           TEXT,                 -- user.username
  email              TEXT,                 -- user.email
  password_hash      TEXT,                 -- bcrypt (كلفة 12) — لا يُعاد أبدًا في API
  must_change_password BOOLEAN NOT NULL DEFAULT false,  -- user.mustChangePassword
  failed_attempts    INTEGER NOT NULL DEFAULT 0,        -- user.failedAttempts
  locked_until       TIMESTAMPTZ,                       -- user.lockedUntil
  last_login_at      TIMESTAMPTZ,                       -- user.lastLoginAt
  active             BOOLEAN NOT NULL DEFAULT true,     -- user.active
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_user_username ON app_user(company_id, lower(username)) WHERE deleted_at IS NULL AND username IS NOT NULL;
CREATE UNIQUE INDEX ux_user_email ON app_user(company_id, lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE INDEX ix_user_sector ON app_user(sector_id);
CREATE INDEX ix_user_employee ON app_user(employee_id);
```
- يغطّي `users[]` عدا `role` (يُنقل إلى `user_role`), و`managedProjectIds[]` (يُنقل إلى `project_member`/جدول إدارة)، و`loginHistory[]` (جدول 4.7). ملاحظة: `lower()` في الفهرس مدعوم في الاثنين.

### 4.7 `user_login_history` — سجل الدخول
```sql
CREATE TABLE user_login_history (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id),
  user_id    TEXT NOT NULL REFERENCES app_user(id),
  at         TIMESTAMPTZ NOT NULL,      -- loginHistory[].at
  ip         TEXT,                      -- loginHistory[].ip  ← حساس (حجب خادمي، R2)
  user_agent TEXT,                      -- loginHistory[].userAgent
  ok         BOOLEAN NOT NULL           -- loginHistory[].ok
);
CREATE INDEX ix_login_hist_user_at ON user_login_history(user_id, at DESC);
```

### 4.8 `app_session` — جلسات المصادقة
```sql
CREATE TABLE app_session (
  id          TEXT PRIMARY KEY,          -- معرّف الكوكي 'evc_session'
  company_id  TEXT NOT NULL REFERENCES company(id),
  user_id     TEXT NOT NULL REFERENCES app_user(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX ix_session_user ON app_session(user_id);
CREATE INDEX ix_session_expires ON app_session(expires_at);
```
- يغطّي `sessions[]` (فارغة حاليًا) ويؤسّس لإدارة جلسات خادمية.

### 4.9 `role` و `permission` و `role_permission` و `user_role` — RBAC خادمي
```sql
CREATE TABLE role (
  id          TEXT PRIMARY KEY,     -- 'admin','ceo_office','sector_lead','bd_manager',
                                    -- 'project_manager','finance','operations','consultant','viewer'
  company_id  TEXT NOT NULL REFERENCES company(id),
  name_ar     TEXT NOT NULL,        -- 'مدير النظام','قائد قطاع',...
  name_en     TEXT,
  is_company_scope BOOLEAN NOT NULL DEFAULT false,   -- perm.isCompany (admin/ceo_office)
  is_system   BOOLEAN NOT NULL DEFAULT false,        -- أدوار نظامية غير قابلة للحذف
  active      BOOLEAN NOT NULL DEFAULT true,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_role_id ON role(company_id, id) WHERE deleted_at IS NULL;

-- كتالوج الصلاحيات: resource × action (يعكس ADR-0001: RBAC = resource × action × scope)
CREATE TABLE permission (
  id          TEXT PRIMARY KEY,     -- 'opps:edit','projects:edit','allocs:edit','revenue:edit',
                                    -- 'budget:edit','services:edit','data:import','sectors:admin','users:admin'
  resource    TEXT NOT NULL,        -- 'opportunity','project','allocation','revenue','budget',...
  action      TEXT NOT NULL,        -- 'view','create','edit','delete','approve','import','export','admin'
  name_ar     TEXT NOT NULL,
  description TEXT
);
CREATE UNIQUE INDEX ux_permission_res_act ON permission(resource, action);

CREATE TABLE role_permission (                 -- M:N دور ↔ صلاحية
  role_id       TEXT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_role (                        -- M:N مستخدم ↔ دور (مع نطاق)
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES company(id),
  user_id     TEXT NOT NULL REFERENCES app_user(id),
  role_id     TEXT NOT NULL REFERENCES role(id),
  scope_type  TEXT NOT NULL DEFAULT 'SECTOR' CHECK (scope_type IN ('COMPANY','SECTOR')),
  sector_id   TEXT REFERENCES sector(id),       -- نطاق التقييد عند scope_type='SECTOR'
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  TEXT REFERENCES app_user(id),
  active      BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_user_role ON user_role(user_id, role_id, COALESCE(sector_id,'*')) WHERE active;
CREATE INDEX ix_user_role_user ON user_role(user_id);
CREATE INDEX ix_user_role_role ON user_role(role_id);
```
- **يعالج R1 (التفويض من جهة المتصفح):** التفويض يصبح استعلامًا خادميًا: `user_role → role_permission → permission` مع فحص `scope`. يغطّي `SANAD_ROLES` (9 أدوار)، ومصفوفة `perm` (`canEditOpps`… إلخ)، و`user.role`/`user.scope`. `sector_manager` القديم يُطبَّع إلى `sector_lead` عند الترحيل.

### 4.10 `membership` — عضوية الموظف في الوظيفة/الوحدة (فصل الهيكل عن الفِرَق)
```sql
CREATE TABLE membership (
  id           TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id   TEXT NOT NULL REFERENCES company(id),
  employee_id  TEXT NOT NULL REFERENCES employee(id),
  org_unit_id  TEXT REFERENCES org_unit(id),
  position_id  TEXT REFERENCES position(id),
  is_primary   BOOLEAN NOT NULL DEFAULT true,     -- العضوية الأساسية للموظف
  allocation_pct NUMERIC(6,3) DEFAULT 100,        -- نسبة الانتساب للوحدة
  start_date   DATE,
  end_date     DATE,                              -- NULL = سارية
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_membership_employee ON membership(employee_id);
CREATE INDEX ix_membership_unit ON membership(org_unit_id);
CREATE UNIQUE INDEX ux_membership_primary ON membership(employee_id) WHERE is_primary AND end_date IS NULL AND deleted_at IS NULL;
```
- **هذا هو انتماء الموظف للهيكل الرسمي** — منفصل صراحةً عن انتمائه لفرق المشاريع (`project_member`) والفرص (`opportunity_member`) والبرامج (`program_member`) ولجان الاعتماد (`committee_member`). موظف واحد قد يكون في وحدة تنظيمية واحدة أساسية لكنه عضو في عدة فرق مشاريع في آنٍ واحد (M:N — القسم 13).


---

## 5. نطاق CRM

### 5.1 `client` — العميل
```sql
CREATE TABLE client (
  id             TEXT PRIMARY KEY,      -- 'c_monshaat_sme_authority'
  -- STD_SCOPE
  company_id     TEXT NOT NULL REFERENCES company(id),
  code           TEXT,                  -- 'MNSH'
  name_ar        TEXT NOT NULL,
  name_en        TEXT,
  client_type_id TEXT REFERENCES client_type(id),   -- بدل client.type النصي (يعالج فجوة الـ71)
  sector_id      TEXT REFERENCES sector(id),        -- القطاع المالك (اختياري)
  active         BOOLEAN NOT NULL DEFAULT true,
  notes          TEXT,
  source         TEXT,                  -- 'CONS_IMPORT'
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_client_code ON client(company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
CREATE INDEX ix_client_company ON client(company_id);
CREATE INDEX ix_client_type ON client(client_type_id);
```
- يغطّي `clients[]` (id, code, nameAr/En, type→client_type_id, active). حقل `type` النصي يُطبَّع: حكومي→GOV, خاص→PRIVATE, داخلي→INTERNAL, الفارغ→NULL (لمعالجة R8).

### 5.2 `client_alias` — أسماء بديلة/دمج مكرر
```sql
CREATE TABLE client_alias (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES company(id),
  client_id    TEXT NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  name_ar      TEXT,
  name_en      TEXT,
  merged_at    TIMESTAMPTZ,           -- aliases[].mergedAt
  note         TEXT                   -- aliases[].note
);
CREATE INDEX ix_client_alias_client ON client_alias(client_id);
```
- يغطّي `clients[].aliases[]` (دمج المكرر — «منشئات» → «منشآت»).

### 5.3 `contact` — جهات اتصال العميل
```sql
CREATE TABLE contact (
  id          TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id  TEXT NOT NULL REFERENCES company(id),
  client_id   TEXT REFERENCES client(id),
  name_ar     TEXT NOT NULL,
  name_en     TEXT,
  title       TEXT,                  -- المنصب لدى العميل
  email       TEXT,
  phone       TEXT,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  notes       TEXT,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_contact_client ON contact(client_id);
```
- كيان جديد (لا يوجد في اللقطة) — يسدّ فجوة CRM.

### 5.4 `opportunity` — الفرصة
```sql
CREATE TABLE opportunity (
  id                TEXT PRIMARY KEY,      -- 'o_cons_1'
  -- STD_SCOPE
  company_id        TEXT NOT NULL REFERENCES company(id),
  sector_id         TEXT REFERENCES sector(id),      -- القطاع الأساسي (opp.sectorId)؛ التعدد في opportunity_sector
  code              TEXT,                  -- 'CONS-1'
  title_ar          TEXT NOT NULL,         -- titleAr
  title_en          TEXT,                  -- titleEn
  client_id         TEXT REFERENCES client(id),
  stage_id          TEXT NOT NULL REFERENCES pipeline_stage(id),  -- opp.stage
  stage_raw         TEXT,                  -- opp.stageRaw (النص الأصلي قبل التطبيع)
  win_pct           NUMERIC(6,3),          -- opp.winPct
  value_sar         NUMERIC(18,2),         -- opp.valueSar
  owner_user_id     TEXT REFERENCES app_user(id),    -- opp.ownerId
  priority_id       TEXT REFERENCES priority(id),    -- opp.priority
  practice_id       TEXT REFERENCES practice(id),    -- opp.practiceId
  practice_raw      TEXT,                  -- opp.practice (نص)
  year              INTEGER,               -- opp.year
  source_year       INTEGER,               -- opp.sourceYear
  duration_months   INTEGER,               -- opp.duration
  exclude_from_sales BOOLEAN NOT NULL DEFAULT false, -- opp.excludeFromSales
  next_action       TEXT,                  -- opp.nextAction
  notes             TEXT,                  -- opp.notes
  risk_flags        JSONB,                 -- opp.riskFlags[]  (أعلام خفيفة)
  source            TEXT,                  -- opp.source
  stage_changed_at  TIMESTAMPTZ,           -- opp.stageChangedAt
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_opp_code ON opportunity(company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
CREATE INDEX ix_opp_sector_stage ON opportunity(sector_id, stage_id);
CREATE INDEX ix_opp_client ON opportunity(client_id);
CREATE INDEX ix_opp_owner ON opportunity(owner_user_id);
CREATE INDEX ix_opp_company ON opportunity(company_id);
CREATE INDEX ix_opp_stage ON opportunity(stage_id);
```
- يغطّي `opportunities[]` كاملًا. `riskFlags[]` أعلام مبسّطة تبقى JSONB؛ المخاطر الرسمية في `risk` (PMO). التخصص المتعدد ممكن عبر `opportunity_sector`.

### 5.5 `opportunity_sector` — M:N فرصة ↔ قطاعات (متطلب صريح)
```sql
CREATE TABLE opportunity_sector (
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id) ON DELETE CASCADE,
  sector_id      TEXT NOT NULL REFERENCES sector(id),
  is_primary     BOOLEAN NOT NULL DEFAULT false,     -- القطاع الأساسي
  share_pct      NUMERIC(6,3),                       -- توزيع القيمة على القطاعات (اختياري)
  PRIMARY KEY (opportunity_id, sector_id)
);
CREATE INDEX ix_opp_sector_sector ON opportunity_sector(sector_id);
```
- **يحقّق «فرصة ↔ عدة قطاعات».** اللقطة الحالية تحمل `sectorId` مفردًا؛ يُدرَج كصف `is_primary=true` عند الترحيل، مع إمكانية إضافة قطاعات لاحقة وتوزيع الحصص.

### 5.6 `opportunity_member` — M:N فرصة ↔ موظفون (فريق الفرصة، منفصل عن الهيكل)
```sql
CREATE TABLE opportunity_member (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES company(id),
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id) ON DELETE CASCADE,
  employee_id    TEXT NOT NULL REFERENCES employee(id),
  role_in_deal   TEXT,                  -- 'مطوّر أعمال','مسؤول تسعير',...
  added_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, employee_id, role_in_deal)
);
CREATE INDEX ix_opp_member_opp ON opportunity_member(opportunity_id);
CREATE INDEX ix_opp_member_emp ON opportunity_member(employee_id);
```
- فريق العمل على الفرصة **منفصل** عن الهيكل التنظيمي (`membership`) وعن فريق المشروع (`project_member`).

### 5.7 `tender` — المنافسة الرسمية (كيان جديد — سدّ فجوة R4)
```sql
CREATE TABLE tender (
  id                 TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id         TEXT NOT NULL REFERENCES company(id),
  sector_id          TEXT REFERENCES sector(id),
  opportunity_id     TEXT REFERENCES opportunity(id),   -- المنافسة المرتبطة بفرصة
  client_id          TEXT REFERENCES client(id),
  reference_no       TEXT,               -- رقم المنافسة الحكومية
  title_ar           TEXT NOT NULL,
  title_en           TEXT,
  platform           TEXT,               -- 'اعتماد'/'منافسات' وغيرها
  status             TEXT NOT NULL DEFAULT 'OPEN'
                       CHECK (status IN ('OPEN','SUBMITTED','SHORTLISTED','AWARDED','LOST','CANCELLED')),
  publish_date       DATE,
  questions_deadline DATE,
  submission_deadline DATE,
  award_date         DATE,
  bid_bond_sar       NUMERIC(18,2),      -- الضمان الابتدائي
  bid_bond_expiry    DATE,
  perf_bond_sar      NUMERIC(18,2),      -- ضمان حسن التنفيذ
  estimated_value_sar NUMERIC(18,2),
  notes              TEXT,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_tender_opp ON tender(opportunity_id);
CREATE INDEX ix_tender_sector ON tender(sector_id);
CREATE UNIQUE INDEX ux_tender_ref ON tender(company_id, reference_no) WHERE deleted_at IS NULL AND reference_no IS NOT NULL;
```

### 5.8 `proposal` — العرض (فني/مالي) — كيان جديد
```sql
CREATE TABLE proposal (
  id                 TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id         TEXT NOT NULL REFERENCES company(id),
  sector_id          TEXT REFERENCES sector(id),
  opportunity_id     TEXT REFERENCES opportunity(id),
  tender_id          TEXT REFERENCES tender(id),
  code               TEXT,
  title_ar           TEXT NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'DRAFT'
                       CHECK (status IN ('DRAFT','UNDER_REVIEW','APPROVED','SUBMITTED','ACCEPTED','REJECTED','WITHDRAWN')),
  currency_code      TEXT NOT NULL DEFAULT 'SAR' REFERENCES currency(code),
  total_price_sar    NUMERIC(18,2),      -- محسوب من pricing_line
  total_cost_sar     NUMERIC(18,2),
  margin_pct         NUMERIC(6,3),
  vat_rate           NUMERIC(6,3) DEFAULT 15,
  valid_until        DATE,
  submitted_at       TIMESTAMPTZ,
  notes              TEXT,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_proposal_opp ON proposal(opportunity_id);
CREATE INDEX ix_proposal_tender ON proposal(tender_id);
CREATE UNIQUE INDEX ux_proposal_code_ver ON proposal(company_id, code, version) WHERE deleted_at IS NULL AND code IS NOT NULL;
```

### 5.9 `pricing_line` — سطر تسعير في العرض
```sql
CREATE TABLE pricing_line (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES company(id),
  proposal_id   TEXT NOT NULL REFERENCES proposal(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL,
  service_id    TEXT REFERENCES service(id),          -- ربط بكتالوج الخدمات (اختياري)
  package_id    TEXT REFERENCES service_package(id),
  description_ar TEXT NOT NULL,
  qty           NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit          TEXT,                  -- 'شهر','دفعة','مخرج'
  unit_price_sar NUMERIC(18,2) NOT NULL DEFAULT 0,
  unit_cost_sar  NUMERIC(18,2),
  discount_pct  NUMERIC(6,3) DEFAULT 0,
  line_total_sar NUMERIC(18,2),        -- محسوب
  supplier_id   TEXT REFERENCES supplier(id),         -- تكلفة باطنية
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_pricing_proposal ON pricing_line(proposal_id);
CREATE UNIQUE INDEX ux_pricing_line_no ON pricing_line(proposal_id, line_no) WHERE deleted_at IS NULL;
```
- يستوعب هيكل `project.financials.team[]`/`vendors[]` عند إنشاء عرض من دراسة جدوى.

### 5.10 `stage_history` — سجل انتقالات مرحلة الفرصة
```sql
CREATE TABLE stage_history (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES company(id),
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id) ON DELETE CASCADE,
  from_stage_id  TEXT REFERENCES pipeline_stage(id),
  to_stage_id    TEXT NOT NULL REFERENCES pipeline_stage(id),
  win_pct        NUMERIC(6,3),
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by     TEXT REFERENCES app_user(id),
  note           TEXT
);
CREATE INDEX ix_stage_hist_opp ON stage_history(opportunity_id, changed_at);
```
- يعطّل الحاجة لتخمين تاريخ المرحلة من `stageChangedAt` المفرد؛ يبني سجلًا كاملًا لتقارير معدّل الفوز وزمن المراحل (فجوة تقارير في التحليل).


---

## 6. نطاق PMO

> التسلسل: **portfolio → program → project → workstream → (milestone, deliverable, task → subtask)**. سجل الحوكمة RAID+: **risk, issue, decision, change_request, action_item, lesson_learned**. الاعتماديات في `dependency`.

### 6.1 `portfolio` — المحفظة
```sql
CREATE TABLE portfolio (
  id          TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id  TEXT NOT NULL REFERENCES company(id),
  sector_id   TEXT REFERENCES sector(id),
  code        TEXT,
  name_ar     TEXT NOT NULL,
  name_en     TEXT,
  owner_user_id TEXT REFERENCES app_user(id),
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED','ON_HOLD')),
  target_revenue_sar NUMERIC(18,2),
  notes       TEXT,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_portfolio_sector ON portfolio(sector_id);
```

### 6.2 `program` — البرنامج
```sql
CREATE TABLE program (
  id           TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id   TEXT NOT NULL REFERENCES company(id),
  sector_id    TEXT REFERENCES sector(id),
  portfolio_id TEXT REFERENCES portfolio(id),
  code         TEXT,
  name_ar      TEXT NOT NULL,
  name_en      TEXT,
  manager_employee_id TEXT REFERENCES employee(id),
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED','ON_HOLD')),
  start_date   DATE,
  end_date     DATE,
  budget_sar   NUMERIC(18,2),
  notes        TEXT,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_program_portfolio ON program(portfolio_id);
CREATE INDEX ix_program_sector ON program(sector_id);
```

### 6.3 `program_member` — M:N برنامج ↔ موظفون (منفصل عن الهيكل)
```sql
CREATE TABLE program_member (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES company(id),
  program_id  TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employee(id),
  role_in_program TEXT,
  UNIQUE (program_id, employee_id, role_in_program)
);
CREATE INDEX ix_program_member_emp ON program_member(employee_id);
```

### 6.4 `project` — المشروع
```sql
CREATE TABLE project (
  id                    TEXT PRIMARY KEY,     -- 'p_cons_1','p_001'
  -- STD_SCOPE
  company_id            TEXT NOT NULL REFERENCES company(id),
  sector_id             TEXT REFERENCES sector(id),
  program_id            TEXT REFERENCES program(id),
  code                  TEXT,                 -- prj.code
  financial_code        TEXT,                 -- prj.financialCode
  name_ar               TEXT NOT NULL,        -- prj.nameAr
  name_en               TEXT,
  client_id             TEXT REFERENCES client(id),
  owner_user_id         TEXT REFERENCES app_user(id),   -- prj.ownerId
  pm_employee_id        TEXT REFERENCES employee(id),   -- prj.pm (نص → موظف)
  pm_name_raw           TEXT,                 -- prj.pm (النص الأصلي)
  source_opportunity_id TEXT REFERENCES opportunity(id),-- prj.sourceOppId
  practice_id           TEXT REFERENCES practice(id),   -- prj.practice
  dept_legacy           TEXT,                 -- prj.dept
  status                TEXT NOT NULL DEFAULT 'IN_PROGRESS'
                          CHECK (status IN ('IN_PROGRESS','COMPLETED','ON_HOLD','CANCELLED')),
  kind                  TEXT NOT NULL DEFAULT 'external'
                          CHECK (kind IN ('external','internal','product')),   -- prj.kind
  is_sector_project     BOOLEAN NOT NULL DEFAULT false, -- prj.sectorProject
  is_internal           BOOLEAN NOT NULL DEFAULT false, -- prj.internal
  is_ongoing            BOOLEAN NOT NULL DEFAULT false, -- prj.ongoing
  is_multi_year         BOOLEAN NOT NULL DEFAULT false, -- prj.multiYear
  start_year            INTEGER,              -- prj.startYear
  start_date            DATE,                 -- prj.startDate
  end_date              DATE,                 -- prj.endDate
  cash_end_date         DATE,                 -- prj.cashEndDate
  progress_pct          NUMERIC(6,3),         -- prj.progressPct
  budget_sar            NUMERIC(18,2),        -- prj.budgetSar
  budget_used_pct       NUMERIC(6,3),         -- prj.budgetUsedPct
  actual_spend_sar      NUMERIC(18,2),        -- prj.actualSpendSar
  planned_cost_sar      NUMERIC(18,2),        -- prj.plannedCostSar
  planned_revenue_sar   NUMERIC(18,2),        -- prj.plannedRevenueSar
  planned_profit_sar    NUMERIC(18,2),        -- prj.plannedProfitSar
  revenue_sar           NUMERIC(18,2),        -- prj.revenueSar
  revenue_all_years_sar NUMERIC(18,2),        -- prj.revenueSarAllYears
  cost_sar              NUMERIC(18,2),        -- prj.costSar
  profit_sar            NUMERIC(18,2),        -- prj.profitSar
  margin_pct            NUMERIC(6,3),         -- prj.marginPct
  salary_cost_sar       NUMERIC(18,2),        -- prj.salaryCostSar
  vendor_cost_sar       NUMERIC(18,2),        -- prj.vendorCostSar
  contract_value_sar    NUMERIC(18,2),        -- prj.contractValueSar
  contract_value_pre_vat_sar NUMERIC(18,2),   -- prj.contractValuePreVatSar
  po_value_sar          NUMERIC(18,2),        -- prj.poValueSar
  total_invoiced_sar    NUMERIC(18,2),        -- prj.totalInvoicedSar
  collected_sar         NUMERIC(18,2),        -- prj.collectedSar
  outstanding_ar_sar    NUMERIC(18,2),        -- prj.outstandingArSar
  payables_sar          NUMERIC(18,2),        -- prj.payablesSar
  review_needed         BOOLEAN NOT NULL DEFAULT false, -- prj.reviewNeeded
  review_reason         TEXT,                 -- prj.reviewReason
  client_mapping_confidence TEXT,             -- prj.clientMappingConfidence
  client_mapping_note   TEXT,                 -- prj.clientMappingNote
  financials            JSONB,                -- prj.financials{} (دراسة الجدوى الكاملة: scenarios/vendors/cashPlan)
  scenarios             JSONB,                -- prj.scenarioOptimistic + financials.scenarios
  source                TEXT,                 -- prj.source
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_project_code ON project(company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
CREATE UNIQUE INDEX ux_project_fincode ON project(company_id, financial_code) WHERE deleted_at IS NULL AND financial_code IS NOT NULL;
CREATE INDEX ix_project_sector_status ON project(sector_id, status);
CREATE INDEX ix_project_client ON project(client_id);
CREATE INDEX ix_project_owner ON project(owner_user_id);
CREATE INDEX ix_project_source_opp ON project(source_opportunity_id);
CREATE INDEX ix_project_program ON project(program_id);
```
- يغطّي `projects[]` كاملًا (كل الحقول المالية المستوردة). الحقول التفصيلية المعقّدة (`financials.cashPlan`, `vendors[]`, `team[]`, `feasibilityDoc`) تُحفظ في `financials JSONB`؛ الأرقام المجمّعة تُسطّح إلى أعمدة للاستعلام. الأعمدة المشتقّة (`total_invoiced_sar`, `collected_sar`, `outstanding_ar_sar`) ستُغذّى مستقبلًا من `invoice`/`collection` بدل الاستيراد.

### 6.5 `project_member` — M:N مشروع ↔ موظفون (متطلب صريح: موظف↔عدة مشاريع)
```sql
CREATE TABLE project_member (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES company(id),
  project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  employee_id  TEXT NOT NULL REFERENCES employee(id),
  position_id  TEXT REFERENCES position(id),        -- الدور في المشروع (مدير مشروع/محلل...)
  role_in_project TEXT,                              -- نص حر بديل
  is_lead      BOOLEAN NOT NULL DEFAULT false,       -- مدير المشروع
  start_date   DATE,
  end_date     DATE,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_project_member ON project_member(project_id, employee_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_project_member_emp ON project_member(employee_id);
```
- **يحقّق «موظف ↔ عدة مشاريع» و«مشروع ↔ عدة موظفين».** فريق المشروع منفصل عن الهيكل (`membership`) وعن التسكين الشهري الكمّي (`allocation`).

### 6.6 `workstream` — مسار عمل داخل المشروع
```sql
CREATE TABLE workstream (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES company(id),
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code        TEXT,
  name_ar     TEXT NOT NULL,
  lead_employee_id TEXT REFERENCES employee(id),
  sort_order  INTEGER,
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DONE','ON_HOLD')),
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_workstream_project ON workstream(project_id);
```

### 6.7 `milestone` — معلم
```sql
CREATE TABLE milestone (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES company(id),
  project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  workstream_id TEXT REFERENCES workstream(id),
  name_ar      TEXT NOT NULL,
  due_date     DATE,
  status       TEXT NOT NULL DEFAULT 'PLANNED'
                 CHECK (status IN ('PLANNED','IN_PROGRESS','ACHIEVED','MISSED','CANCELLED')),
  is_payment_milestone BOOLEAN NOT NULL DEFAULT false,  -- مرتبط بدفعة تعاقدية
  amount_sar   NUMERIC(18,2),
  achieved_at  DATE,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_milestone_project ON milestone(project_id, due_date);
```

### 6.8 `deliverable` — المخرَج
```sql
CREATE TABLE deliverable (
  id             TEXT PRIMARY KEY,      -- 'dlv_sd_01'
  -- STD_SCOPE
  company_id     TEXT NOT NULL REFERENCES company(id),
  sector_id      TEXT REFERENCES sector(id),        -- dlv.sectorId
  project_id     TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  workstream_id  TEXT REFERENCES workstream(id),
  milestone_id   TEXT REFERENCES milestone(id),
  name_ar        TEXT NOT NULL,         -- dlv.nameAr
  amount_sar     NUMERIC(18,2),         -- dlv.amountSar
  month          INTEGER,               -- dlv.month (1..12)
  year           INTEGER,               -- dlv.year
  phase          INTEGER,               -- dlv.phase
  phase_name_ar  TEXT,                  -- dlv.phaseNameAr
  status         TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','DELIVERED','INVOICED','PAID')),  -- dlv.status
  invoice_status TEXT,                  -- dlv.invoiceStatus ('مفوتر'/'لم يفوتر')
  invoiced_sar   NUMERIC(18,2),         -- dlv.invoicedSar
  progress_pct   NUMERIC(6,3),          -- dlv.progressPct
  delivered_at   DATE,                  -- dlv.deliveredAt
  notes          TEXT,                  -- dlv.notes / dlv._note
  source         TEXT,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_deliverable_project ON deliverable(project_id);
CREATE INDEX ix_deliverable_status ON deliverable(status);
CREATE INDEX ix_deliverable_period ON deliverable(year, month);
CREATE INDEX ix_deliverable_sector ON deliverable(sector_id);
```
- يغطّي `deliverables[]` كاملًا. **محرك R3** (مخرج INVOICED/PAID ⇒ سطر إيراد) يُنقل للخادم ويُنفَّذ كخدمة تكتب في `revenue_line` (القسم 9)، بدل منطق المتصفح.

### 6.9 `task` — المهمة (تشمل المهمة الفرعية subtask عبر parent_task_id)
```sql
CREATE TABLE task (
  id            TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id    TEXT NOT NULL REFERENCES company(id),
  project_id    TEXT REFERENCES project(id) ON DELETE CASCADE,
  workstream_id TEXT REFERENCES workstream(id),
  deliverable_id TEXT REFERENCES deliverable(id),
  parent_task_id TEXT REFERENCES task(id),           -- المهمة الفرعية (subtask) = مهمة بأب
  code          TEXT,
  title_ar      TEXT NOT NULL,
  description   TEXT,
  assignee_employee_id TEXT REFERENCES employee(id),
  status        TEXT NOT NULL DEFAULT 'TODO'
                  CHECK (status IN ('TODO','IN_PROGRESS','BLOCKED','IN_REVIEW','DONE','CANCELLED')),
  priority_id   TEXT REFERENCES priority(id),
  progress_pct  NUMERIC(6,3) DEFAULT 0,
  estimate_hours NUMERIC(10,2),
  planned_start DATE,
  planned_end   DATE,
  actual_start  DATE,
  actual_end    DATE,
  sort_order    INTEGER,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_task_project ON task(project_id);
CREATE INDEX ix_task_parent ON task(parent_task_id);
CREATE INDEX ix_task_assignee ON task(assignee_employee_id);
CREATE INDEX ix_task_status ON task(status);
```
- **قرار نمذجة:** «task» و«subtask» يُوحَّدان في جدول ذاتي المرجع (`parent_task_id`). المهمة الفرعية = صف مهمة له أب. هذا يتفادى تكرار المخطط ويدعم أي عمق تفريع؛ يُقيَّد العمق تطبيقيًا إلى مستويين (task/subtask) عند الحاجة.

### 6.10 `dependency` — اعتمادية بين المهام/المخرجات
```sql
CREATE TABLE dependency (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES company(id),
  project_id     TEXT REFERENCES project(id) ON DELETE CASCADE,
  predecessor_type TEXT NOT NULL CHECK (predecessor_type IN ('TASK','DELIVERABLE','MILESTONE')),
  predecessor_id TEXT NOT NULL,        -- مرجع بوليمورفي (يُحقَّق تطبيقيًا حسب النوع)
  successor_type TEXT NOT NULL CHECK (successor_type IN ('TASK','DELIVERABLE','MILESTONE')),
  successor_id   TEXT NOT NULL,
  dep_type       TEXT NOT NULL DEFAULT 'FS' CHECK (dep_type IN ('FS','SS','FF','SF')),
  lag_days       INTEGER NOT NULL DEFAULT 0,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_dependency_pred ON dependency(predecessor_type, predecessor_id);
CREATE INDEX ix_dependency_succ ON dependency(successor_type, successor_id);
CREATE UNIQUE INDEX ux_dependency ON dependency(predecessor_type,predecessor_id,successor_type,successor_id) WHERE deleted_at IS NULL;
```
- المرجع بوليمورفي (لا FK مباشر) لأنه يعبر أنواعًا؛ سلامته تُفرَض في طبقة الخدمة. الأنواع FS/SS/FF/SF قياسية (Finish-Start…).

### 6.11 سجل RAID+ — `risk`, `issue`, `decision`, `change_request`, `action_item`, `lesson_learned`
جميعها تتشارك نمطًا موحّدًا مرتبطًا بـ **حاوية بوليمورفية** (`scope_type`, `scope_id`) لتغطّي المخاطر على مستوى المشروع/البرنامج/الفرصة/الشركة.

```sql
-- 6.11.1 المخاطر
CREATE TABLE risk (
  id           TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id   TEXT NOT NULL REFERENCES company(id),
  sector_id    TEXT REFERENCES sector(id),
  scope_type   TEXT NOT NULL DEFAULT 'PROJECT'
                 CHECK (scope_type IN ('COMPANY','SECTOR','PORTFOLIO','PROGRAM','PROJECT','OPPORTUNITY')),
  scope_id     TEXT,                              -- معرّف الحاوية (بوليمورفي)
  code         TEXT,
  title_ar     TEXT NOT NULL,
  description  TEXT,
  category     TEXT,                              -- 'مالي','تشغيلي','تعاقدي',...
  probability  TEXT CHECK (probability IN ('LOW','MEDIUM','HIGH')),
  impact       TEXT CHECK (impact IN ('LOW','MEDIUM','HIGH')),
  severity     TEXT,                              -- محسوب (probability×impact)
  status       TEXT NOT NULL DEFAULT 'OPEN'
                 CHECK (status IN ('OPEN','MITIGATING','CLOSED','ACCEPTED','REALIZED')),
  mitigation   TEXT,
  owner_employee_id TEXT REFERENCES employee(id),
  due_date     DATE,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_risk_scope ON risk(scope_type, scope_id);
CREATE INDEX ix_risk_sector_status ON risk(sector_id, status);

-- 6.11.2 القضايا
CREATE TABLE issue (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES company(id),
  sector_id    TEXT REFERENCES sector(id),
  scope_type   TEXT NOT NULL DEFAULT 'PROJECT'
                 CHECK (scope_type IN ('COMPANY','SECTOR','PORTFOLIO','PROGRAM','PROJECT','OPPORTUNITY')),
  scope_id     TEXT,
  title_ar     TEXT NOT NULL,
  description  TEXT,
  priority_id  TEXT REFERENCES priority(id),
  status       TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
  raised_by_employee_id TEXT REFERENCES employee(id),
  assignee_employee_id  TEXT REFERENCES employee(id),
  resolved_at  TIMESTAMPTZ,
  resolution   TEXT,
  due_date     DATE,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_issue_scope ON issue(scope_type, scope_id);

-- 6.11.3 القرارات
CREATE TABLE decision (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES company(id),
  sector_id    TEXT REFERENCES sector(id),
  scope_type   TEXT NOT NULL DEFAULT 'PROJECT'
                 CHECK (scope_type IN ('COMPANY','SECTOR','PORTFOLIO','PROGRAM','PROJECT','OPPORTUNITY')),
  scope_id     TEXT,
  title_ar     TEXT NOT NULL,
  context      TEXT,
  decision_text TEXT NOT NULL,
  decided_by_employee_id TEXT REFERENCES employee(id),
  decided_at   TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','REJECTED','SUPERSEDED')),
  approval_request_id TEXT REFERENCES approval_request(id),  -- ربط بسير الاعتماد
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_decision_scope ON decision(scope_type, scope_id);

-- 6.11.4 طلبات التغيير
CREATE TABLE change_request (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES company(id),
  sector_id     TEXT REFERENCES sector(id),
  project_id    TEXT REFERENCES project(id) ON DELETE CASCADE,
  code          TEXT,
  title_ar      TEXT NOT NULL,
  description   TEXT,
  change_type   TEXT CHECK (change_type IN ('SCOPE','SCHEDULE','COST','QUALITY','OTHER')),
  cost_impact_sar NUMERIC(18,2),
  schedule_impact_days INTEGER,
  status        TEXT NOT NULL DEFAULT 'REQUESTED'
                  CHECK (status IN ('REQUESTED','UNDER_REVIEW','APPROVED','REJECTED','IMPLEMENTED')),
  requested_by_employee_id TEXT REFERENCES employee(id),
  approval_request_id TEXT REFERENCES approval_request(id),
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_cr_project ON change_request(project_id);

-- 6.11.5 بنود الإجراء (Action Items)
CREATE TABLE action_item (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES company(id),
  sector_id    TEXT REFERENCES sector(id),
  scope_type   TEXT NOT NULL DEFAULT 'PROJECT'
                 CHECK (scope_type IN ('COMPANY','SECTOR','PORTFOLIO','PROGRAM','PROJECT','OPPORTUNITY','MEETING')),
  scope_id     TEXT,
  title_ar     TEXT NOT NULL,
  assignee_employee_id TEXT REFERENCES employee(id),
  due_date     DATE,
  status       TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','DONE','CANCELLED')),
  completed_at TIMESTAMPTZ,
  source_ref   TEXT,                  -- مرجع الاجتماع/القرار المُولّد له
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_action_scope ON action_item(scope_type, scope_id);
CREATE INDEX ix_action_assignee ON action_item(assignee_employee_id, status);

-- 6.11.6 الدروس المستفادة
CREATE TABLE lesson_learned (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES company(id),
  sector_id    TEXT REFERENCES sector(id),
  project_id   TEXT REFERENCES project(id) ON DELETE CASCADE,
  title_ar     TEXT NOT NULL,
  category     TEXT,                  -- 'تجاري','تنفيذي','مالي','تعاقدي'
  what_happened TEXT,
  recommendation TEXT,
  impact       TEXT CHECK (impact IN ('LOW','MEDIUM','HIGH')),
  captured_by_employee_id TEXT REFERENCES employee(id),
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_lesson_project ON lesson_learned(project_id);
```
- ملاحظة ترتيب الإنشاء: `decision`/`change_request` تشيران إلى `approval_request` (القسم 8) — تُنشأ جداول Workflow قبلها، أو يُضاف الـFK لاحقًا بـ `ALTER TABLE`. المرجع البوليمورفي `scope_type/scope_id` يُغني عن ستة أعمدة FK ويُبقي السجل قابلًا للربط بأي حاوية.


---

## 7. نطاق الوقت والتسكين (Time & Resourcing)

> يضم كيانات الوقت المطلوبة (`timesheet_period`, `timesheet`, `time_entry`) **إضافةً إلى** التسكين الشهري الكمّي القائم في اللقطة (`allocation` + `allocation_month`) الذي يمثّل مصفوفة الإشغال الشهرية.

### 7.1 `timesheet_period` — فترة زمنية للاعتماد
```sql
CREATE TABLE timesheet_period (
  id          TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id  TEXT NOT NULL REFERENCES company(id),
  name_ar     TEXT NOT NULL,           -- 'يناير 2026'
  period_type TEXT NOT NULL DEFAULT 'MONTH' CHECK (period_type IN ('WEEK','MONTH','CUSTOM')),
  year        INTEGER NOT NULL,
  month       INTEGER,                 -- 1..12 (عند الشهري)
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','LOCKED','CLOSED')),
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_period ON timesheet_period(company_id, year, month, period_type) WHERE deleted_at IS NULL;
```

### 7.2 `timesheet` — سجل دوام الموظف لفترة
```sql
CREATE TABLE timesheet (
  id            TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id    TEXT NOT NULL REFERENCES company(id),
  sector_id     TEXT REFERENCES sector(id),
  period_id     TEXT NOT NULL REFERENCES timesheet_period(id),
  employee_id   TEXT NOT NULL REFERENCES employee(id),
  status        TEXT NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  total_hours   NUMERIC(10,2) NOT NULL DEFAULT 0,     -- مجمّع من time_entry
  billable_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  submitted_at  TIMESTAMPTZ,
  approval_request_id TEXT REFERENCES approval_request(id),
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_timesheet ON timesheet(period_id, employee_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_timesheet_employee ON timesheet(employee_id);
CREATE INDEX ix_timesheet_period ON timesheet(period_id);
```

### 7.3 `time_entry` — بند وقت مفصّل
```sql
CREATE TABLE time_entry (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES company(id),
  timesheet_id  TEXT NOT NULL REFERENCES timesheet(id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL REFERENCES employee(id),
  project_id    TEXT REFERENCES project(id),
  task_id       TEXT REFERENCES task(id),
  deliverable_id TEXT REFERENCES deliverable(id),
  work_date     DATE NOT NULL,
  hours         NUMERIC(6,2) NOT NULL,
  is_billable   BOOLEAN NOT NULL DEFAULT true,
  description   TEXT,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_time_entry_ts ON time_entry(timesheet_id);
CREATE INDEX ix_time_entry_project ON time_entry(project_id, work_date);
CREATE INDEX ix_time_entry_emp_date ON time_entry(employee_id, work_date);
```

### 7.4 `allocation` — تسكين شخص على مشروع (رأس)
```sql
CREATE TABLE allocation (
  id             TEXT PRIMARY KEY,      -- 'al_mx_6_7572_p_002'
  -- STD_SCOPE
  company_id     TEXT NOT NULL REFERENCES company(id),
  sector_id      TEXT REFERENCES sector(id),        -- alloc.sectorId
  employee_id    TEXT NOT NULL REFERENCES employee(id),   -- alloc.personId
  person_name_ar TEXT,                  -- alloc.personNameAr (يُحفظ للترحيل)
  project_id     TEXT REFERENCES project(id),       -- alloc.projectId
  project_name_raw TEXT,                -- alloc.projectName
  alloc_type     TEXT NOT NULL DEFAULT 'PROJECT',   -- alloc.type ('مشروع'→'PROJECT')
  year           INTEGER NOT NULL,      -- alloc.year
  month_start    INTEGER,               -- alloc.monthStart
  month_end      INTEGER,               -- alloc.monthEnd
  source         TEXT,                  -- alloc.source ('ALLOC_MATRIX')
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_alloc_employee ON allocation(employee_id, year);
CREATE INDEX ix_alloc_project ON allocation(project_id, year);
CREATE INDEX ix_alloc_sector ON allocation(sector_id);
CREATE UNIQUE INDEX ux_alloc ON allocation(employee_id, project_id, year) WHERE deleted_at IS NULL;
```

### 7.5 `allocation_month` — نسبة الإشغال الشهرية (تطبيع `monthly{}`)
```sql
CREATE TABLE allocation_month (
  id            TEXT PRIMARY KEY,
  allocation_id TEXT NOT NULL REFERENCES allocation(id) ON DELETE CASCADE,
  month         INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  pct           NUMERIC(6,3) NOT NULL     -- alloc.monthly[month]
);
CREATE UNIQUE INDEX ux_alloc_month ON allocation_month(allocation_id, month);
CREATE INDEX ix_alloc_month_month ON allocation_month(month);
```
- يطبّع `allocation.monthly{ "2":1, "3":1 }` إلى صفوف قابلة للاستعلام (مجموع إشغال الشخص/الشهر عبر مشاريع لكشف التعارض والسعة — فجوة أشير إليها في التحليل). يغطّي `allocations[]` كاملًا مع `allocation`.

---

## 8. نطاق سير العمل والاعتمادات (Workflow)

> يعالج R3 (غياب محرك الاعتمادات). التصميم: **`workflow_definition`** يعرّف نوع الكائن وقواعد التفعيل → **`approval_chain`** سلسلة (قد تتعدد بحسب الحد المالي) → **`approval_step`** خطوات مرتّبة (دور/مستخدم + عتبة) → عند إطلاق طلب على كائن يُنشأ **`approval_request`** مع نسخ الخطوات، وكل فعل يُسجَّل في **`approval_action`**.

### 8.1 `workflow_definition`
```sql
CREATE TABLE workflow_definition (
  id            TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id    TEXT NOT NULL REFERENCES company(id),
  sector_id     TEXT REFERENCES sector(id),        -- NULL = يسري على كل القطاعات
  code          TEXT NOT NULL,          -- 'PROPOSAL_APPROVAL','EXPENSE_APPROVAL','DELIVERABLE_SIGNOFF'
  name_ar       TEXT NOT NULL,
  target_entity TEXT NOT NULL,          -- 'proposal','expense','deliverable','change_request','purchase_order',...
  trigger_condition JSONB,              -- شروط التفعيل (مثل value_sar > X)
  is_active     BOOLEAN NOT NULL DEFAULT true,
  version       INTEGER NOT NULL DEFAULT 1,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_workflow_code ON workflow_definition(company_id, code, version) WHERE deleted_at IS NULL;
CREATE INDEX ix_workflow_entity ON workflow_definition(target_entity);
```

### 8.2 `approval_chain`
```sql
CREATE TABLE approval_chain (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES company(id),
  workflow_id   TEXT NOT NULL REFERENCES workflow_definition(id) ON DELETE CASCADE,
  name_ar       TEXT NOT NULL,          -- 'مسار حتى 500 ألف'
  min_amount_sar NUMERIC(18,2),         -- حد أدنى لتفعيل المسار (سقوف الاعتماد — Q5)
  max_amount_sar NUMERIC(18,2),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_chain_workflow ON approval_chain(workflow_id);
```

### 8.3 `approval_step`
```sql
CREATE TABLE approval_step (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES company(id),
  chain_id       TEXT NOT NULL REFERENCES approval_chain(id) ON DELETE CASCADE,
  step_order     INTEGER NOT NULL,       -- ترتيب الخطوة
  name_ar        TEXT NOT NULL,          -- 'اعتماد قائد القطاع'
  approver_type  TEXT NOT NULL CHECK (approver_type IN ('ROLE','USER','MANAGER','SECTOR_LEAD')),
  approver_role_id TEXT REFERENCES role(id),
  approver_user_id TEXT REFERENCES app_user(id),
  is_mandatory   BOOLEAN NOT NULL DEFAULT true,
  allow_delegate BOOLEAN NOT NULL DEFAULT true,
  sla_hours      INTEGER,                -- مهلة الخطوة
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_step_order ON approval_step(chain_id, step_order) WHERE deleted_at IS NULL;
```

### 8.4 `approval_request` — نسخة تشغيلية على كائن
```sql
CREATE TABLE approval_request (
  id             TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id     TEXT NOT NULL REFERENCES company(id),
  sector_id      TEXT REFERENCES sector(id),
  workflow_id    TEXT REFERENCES workflow_definition(id),
  chain_id       TEXT REFERENCES approval_chain(id),
  target_entity  TEXT NOT NULL,          -- 'proposal','expense',...
  target_id      TEXT NOT NULL,          -- معرّف الكائن (بوليمورفي)
  amount_sar     NUMERIC(18,2),          -- المبلغ محل الاعتماد (لاختيار المسار)
  status         TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','IN_PROGRESS','APPROVED','REJECTED','CANCELLED','WITHDRAWN')),
  current_step_order INTEGER,            -- الخطوة الحالية
  requested_by_user_id TEXT REFERENCES app_user(id),
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at     TIMESTAMPTZ,
  due_at         TIMESTAMPTZ,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_appreq_target ON approval_request(target_entity, target_id);
CREATE INDEX ix_appreq_status ON approval_request(company_id, status);
CREATE INDEX ix_appreq_requester ON approval_request(requested_by_user_id);
```

### 8.5 `approval_action` — كل فعل اعتماد (سجل غير قابل للتعديل)
```sql
CREATE TABLE approval_action (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES company(id),
  request_id     TEXT NOT NULL REFERENCES approval_request(id) ON DELETE CASCADE,
  step_order     INTEGER NOT NULL,
  step_id        TEXT REFERENCES approval_step(id),
  actor_user_id  TEXT NOT NULL REFERENCES app_user(id),
  action         TEXT NOT NULL CHECK (action IN ('APPROVE','REJECT','DELEGATE','COMMENT','REQUEST_CHANGES','WITHDRAW')),
  delegated_to_user_id TEXT REFERENCES app_user(id),
  comment        TEXT,
  acted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_appaction_request ON approval_action(request_id, acted_at);
CREATE INDEX ix_appaction_actor ON approval_action(actor_user_id);
```
- **append-only**: لا `updated_at`/soft-delete — كل فعل قيد دائم يخدم التدقيق (يتسق مع بند «سجل تدقيق غير قابل للتعديل» في ADR-0001). كائنات مثل `proposal`, `expense`, `deliverable`, `change_request`, `decision`, `purchase_order`, `timesheet`, `budget` تُطلق طلبات اعتماد عبر `approval_request.target_entity/target_id`.


---

## 9. نطاق المالية (Finance)

> يعالج R4 (غياب كيانات التعاقد/الفوترة/التحصيل/المشتريات). الدورة: **contract → contract_payment → invoice (+invoice_line) → collection**، والتكلفة عبر **cost_line/expense**، والإيراد عبر **revenue_line**، والتخطيط عبر **budget/budget_line**، والشراء عبر **supplier/purchase_order (+po_line)**.

### 9.1 `contract` — العقد
```sql
CREATE TABLE contract (
  id                 TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id         TEXT NOT NULL REFERENCES company(id),
  sector_id          TEXT REFERENCES sector(id),
  project_id         TEXT REFERENCES project(id),
  client_id          TEXT REFERENCES client(id),
  opportunity_id     TEXT REFERENCES opportunity(id),
  proposal_id        TEXT REFERENCES proposal(id),
  code               TEXT,               -- رقم العقد
  title_ar           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'DRAFT'
                       CHECK (status IN ('DRAFT','PENDING_SIGNATURE','ACTIVE','SUSPENDED','COMPLETED','TERMINATED')),
  currency_code      TEXT NOT NULL DEFAULT 'SAR' REFERENCES currency(code),
  value_pre_vat_sar  NUMERIC(18,2),      -- project.contractValuePreVatSar
  vat_rate           NUMERIC(6,3) DEFAULT 15,
  value_sar          NUMERIC(18,2),      -- project.contractValueSar (شامل الضريبة)
  po_value_sar       NUMERIC(18,2),      -- project.poValueSar
  start_date         DATE,
  end_date           DATE,
  signed_date        DATE,
  payment_terms      TEXT,               -- شروط الدفع النصية
  retention_pct      NUMERIC(6,3),       -- محتجز
  notes              TEXT,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_contract_code ON contract(company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
CREATE INDEX ix_contract_project ON contract(project_id);
CREATE INDEX ix_contract_client ON contract(client_id);
CREATE INDEX ix_contract_status ON contract(sector_id, status);
```

### 9.2 `contract_payment` — دفعة تعاقدية مجدولة
```sql
CREATE TABLE contract_payment (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES company(id),
  contract_id   TEXT NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  milestone_id  TEXT REFERENCES milestone(id),        -- دفعة مربوطة بمعلم
  deliverable_id TEXT REFERENCES deliverable(id),
  seq           INTEGER NOT NULL,        -- ترتيب الدفعة
  name_ar       TEXT,                    -- 'الدفعة الأولى — التأسيس'
  amount_sar    NUMERIC(18,2) NOT NULL,
  pct_of_contract NUMERIC(6,3),
  due_date      DATE,
  status        TEXT NOT NULL DEFAULT 'PLANNED'
                  CHECK (status IN ('PLANNED','DUE','INVOICED','PAID','CANCELLED')),
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_contract_payment_seq ON contract_payment(contract_id, seq) WHERE deleted_at IS NULL;
CREATE INDEX ix_contract_payment_due ON contract_payment(due_date, status);
```
- يستوعب `project.financials.cashPlan.dueInvoices[]` (جدول الدفعات المستحقة الشهرية) عند التطبيع.

### 9.3 `invoice` و `invoice_line` — الفاتورة
```sql
CREATE TABLE invoice (
  id               TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id       TEXT NOT NULL REFERENCES company(id),
  sector_id        TEXT REFERENCES sector(id),
  project_id       TEXT REFERENCES project(id),
  contract_id      TEXT REFERENCES contract(id),
  client_id        TEXT REFERENCES client(id),
  invoice_no       TEXT,                -- رقم الفاتورة
  status           TEXT NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','ISSUED','SENT','PARTIALLY_PAID','PAID','CANCELLED','OVERDUE')),
  issue_date       DATE,
  due_date         DATE,
  currency_code    TEXT NOT NULL DEFAULT 'SAR' REFERENCES currency(code),
  subtotal_sar     NUMERIC(18,2),       -- قبل الضريبة
  vat_rate         NUMERIC(6,3) DEFAULT 15,
  vat_amount_sar   NUMERIC(18,2),
  total_sar        NUMERIC(18,2),       -- شامل الضريبة
  collected_sar    NUMERIC(18,2) NOT NULL DEFAULT 0,   -- مجمّع من collection
  outstanding_sar  NUMERIC(18,2),       -- محسوب
  notes            TEXT,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_invoice_no ON invoice(company_id, invoice_no) WHERE deleted_at IS NULL AND invoice_no IS NOT NULL;
CREATE INDEX ix_invoice_project ON invoice(project_id);
CREATE INDEX ix_invoice_client_status ON invoice(client_id, status);
CREATE INDEX ix_invoice_due ON invoice(due_date, status);

CREATE TABLE invoice_line (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES company(id),
  invoice_id     TEXT NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
  deliverable_id TEXT REFERENCES deliverable(id),      -- سطر مقابل مخرج (R3)
  contract_payment_id TEXT REFERENCES contract_payment(id),
  line_no        INTEGER NOT NULL,
  description_ar TEXT NOT NULL,
  qty            NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price_sar NUMERIC(18,2) NOT NULL,
  line_total_sar NUMERIC(18,2) NOT NULL,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_invoice_line_invoice ON invoice_line(invoice_id);
CREATE INDEX ix_invoice_line_deliverable ON invoice_line(deliverable_id);
```
- **يربط المخرَج بالفاتورة** رسميًا — يعالج فجوة «248 مُسلَّم مقابل 11 مفوتر» (اختناق التحصيل). `deliverable.status = INVOICED` يصبح مشتقًّا من وجود `invoice_line`.

### 9.4 `collection` — التحصيل
```sql
CREATE TABLE collection (
  id            TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id    TEXT NOT NULL REFERENCES company(id),
  sector_id     TEXT REFERENCES sector(id),
  invoice_id    TEXT REFERENCES invoice(id),
  project_id    TEXT REFERENCES project(id),
  client_id     TEXT REFERENCES client(id),
  amount_sar    NUMERIC(18,2) NOT NULL,
  collected_date DATE NOT NULL,
  method        TEXT,                  -- 'تحويل','شيك',...
  reference_no  TEXT,
  notes         TEXT,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_collection_invoice ON collection(invoice_id);
CREATE INDEX ix_collection_project ON collection(project_id);
CREATE INDEX ix_collection_date ON collection(collected_date);
```
- يستوعب `project.financials.cashPlan` (المحصّل) و`project.collectedSar`/`excelCollections[]`. يمكّن تقارير أعمار الذمم (فجوة تقارير).

### 9.5 `expense` — المصروف
```sql
CREATE TABLE expense (
  id            TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id    TEXT NOT NULL REFERENCES company(id),
  sector_id     TEXT REFERENCES sector(id),
  project_id    TEXT REFERENCES project(id),
  cost_type_id  TEXT REFERENCES cost_type(id),
  supplier_id   TEXT REFERENCES supplier(id),
  purchase_order_id TEXT REFERENCES purchase_order(id),
  description_ar TEXT NOT NULL,
  amount_sar    NUMERIC(18,2) NOT NULL,
  vat_sar       NUMERIC(18,2),
  wht_sar       NUMERIC(18,2),         -- ضريبة الاستقطاع (financials.vendors[].wht5pct)
  expense_date  DATE,
  month         INTEGER,
  year          INTEGER,
  status        TEXT NOT NULL DEFAULT 'RECORDED'
                  CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','RECORDED','PAID','REJECTED')),
  approval_request_id TEXT REFERENCES approval_request(id),
  source        TEXT,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_expense_project ON expense(project_id, year, month);
CREATE INDEX ix_expense_supplier ON expense(supplier_id);
CREATE INDEX ix_expense_type ON expense(cost_type_id);
```

### 9.6 `cost_line` — سطر تكلفة (من اللقطة)
```sql
CREATE TABLE cost_line (
  id            TEXT PRIMARY KEY,      -- 'cl_cons_90ccd4'
  -- STD_SCOPE
  company_id    TEXT NOT NULL REFERENCES company(id),
  sector_id     TEXT REFERENCES sector(id),        -- cost.sectorId
  project_id    TEXT REFERENCES project(id),       -- cost.projectId
  cost_type_id  TEXT REFERENCES cost_type(id),     -- cost.type (نص → مرجع)
  cost_type_raw TEXT,                  -- cost.type الأصلي ('رواتب','انتداب',...)
  amount_sar    NUMERIC(18,2) NOT NULL,-- cost.amountSar
  month         INTEGER,               -- cost.month
  year          INTEGER,               -- cost.year
  source        TEXT,                  -- cost.source ('CONS_IMPORT')
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_cost_line_project ON cost_line(project_id, year, month);
CREATE INDEX ix_cost_line_sector ON cost_line(sector_id, year, month);
CREATE INDEX ix_cost_line_type ON cost_line(cost_type_id);
```
- يغطّي `costLines[]` كاملًا (148 سطرًا).

### 9.7 `revenue_line` — سطر إيراد (من اللقطة، مخرجات محرك R3)
```sql
CREATE TABLE revenue_line (
  id             TEXT PRIMARY KEY,      -- 'rl_dlv_dlv_sd_01'
  -- STD_SCOPE
  company_id     TEXT NOT NULL REFERENCES company(id),
  sector_id      TEXT REFERENCES sector(id),        -- rl.sectorId
  project_id     TEXT REFERENCES project(id),       -- rl.projectId
  source_project_raw TEXT,             -- rl.sourceProject ('01155')
  source_opportunity_id TEXT REFERENCES opportunity(id),  -- rl.sourceOppId
  deliverable_id TEXT REFERENCES deliverable(id),   -- rl.derivedFrom (R3)
  invoice_id     TEXT REFERENCES invoice(id),       -- ربط مستقبلي بالفاتورة الفعلية
  fin_code       TEXT,                 -- rl.finCode
  amount_sar     NUMERIC(18,2) NOT NULL,-- rl.amountSar
  month          INTEGER,               -- rl.month
  year           INTEGER,               -- rl.year
  label          TEXT,                  -- rl.label
  is_auto        BOOLEAN NOT NULL DEFAULT false,    -- rl.auto
  rule_id        TEXT,                  -- rl.ruleId ('R3')
  source         TEXT,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_revenue_auto ON revenue_line(deliverable_id) WHERE is_auto AND deleted_at IS NULL;
CREATE INDEX ix_revenue_project ON revenue_line(project_id, year, month);
CREATE INDEX ix_revenue_sector ON revenue_line(sector_id, year, month);
CREATE INDEX ix_revenue_deliverable ON revenue_line(deliverable_id);
```
- يغطّي `revenueLines[]` كاملًا. القيد الفريد `ux_revenue_auto` يفرض **سطر إيراد آلي واحد لكل مخرج** (منطق upsert لمحرك R3 المنقول للخادم).

### 9.8 `budget` و `budget_line` — الموازنة والمستهدفات
```sql
CREATE TABLE budget (
  id                 TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id         TEXT NOT NULL REFERENCES company(id),
  sector_id          TEXT REFERENCES sector(id),   -- NULL = موازنة الشركة
  fiscal_year        INTEGER NOT NULL,             -- budget.fy
  target_sales_sar   NUMERIC(18,2),                -- budget.targetSalesSar
  target_revenue_sar NUMERIC(18,2),                -- budget.targetRevenueSar
  target_gross_margin_pct NUMERIC(6,3),            -- budget.targetGrossMarginPct
  cost_assumptions   JSONB,                        -- budget.costAssumptions{} (نِسَب افتراضية)
  status             TEXT NOT NULL DEFAULT 'DRAFT'
                       CHECK (status IN ('DRAFT','APPROVED','LOCKED')),
  approval_request_id TEXT REFERENCES approval_request(id),
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_budget_sector_fy ON budget(company_id, COALESCE(sector_id,'*'), fiscal_year) WHERE deleted_at IS NULL;

CREATE TABLE budget_line (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES company(id),
  budget_id    TEXT NOT NULL REFERENCES budget(id) ON DELETE CASCADE,
  line_type    TEXT NOT NULL CHECK (line_type IN ('REVENUE','SALES','COST','MARGIN')),
  month        INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  previous_sar NUMERIC(18,2),          -- monthlyRevenue[].previousSar
  planned_sar  NUMERIC(18,2),          -- monthlyRevenue[].newSar
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_budget_line ON budget_line(budget_id, line_type, month) WHERE deleted_at IS NULL;
```
- يغطّي `budget{}` كاملًا: المستهدفات إلى أعمدة `budget`، `costAssumptions{}` إلى JSONB، و`monthlyRevenue[]` (previous/new شهريًا) إلى `budget_line`.

### 9.9 `supplier` — المورّد
```sql
CREATE TABLE supplier (
  id             TEXT PRIMARY KEY,      -- 'sup_forte_partners'
  -- STD_SCOPE
  company_id     TEXT NOT NULL REFERENCES company(id),
  code           TEXT,
  name_ar        TEXT NOT NULL,         -- sup.nameAr
  name_en        TEXT,                  -- sup.nameEn
  org            TEXT,                  -- sup.org
  contact_person TEXT,                  -- sup.contactPerson
  phone          TEXT,                  -- sup.phone
  email          TEXT,                  -- sup.email
  status         TEXT NOT NULL DEFAULT 'active',   -- sup.status
  notes          TEXT,                  -- sup.notes
  source         TEXT,                  -- sup.source
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_supplier_code ON supplier(company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
CREATE INDEX ix_supplier_company ON supplier(company_id);
```
- يغطّي `suppliers[]` كاملًا (33 موردًا).

### 9.10 `purchase_order` و `purchase_order_line` — أمر الشراء
```sql
CREATE TABLE purchase_order (
  id             TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id     TEXT NOT NULL REFERENCES company(id),
  sector_id      TEXT REFERENCES sector(id),
  supplier_id    TEXT NOT NULL REFERENCES supplier(id),
  project_id     TEXT REFERENCES project(id),
  po_no          TEXT,
  status         TEXT NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
  currency_code  TEXT NOT NULL DEFAULT 'SAR' REFERENCES currency(code),
  subtotal_sar   NUMERIC(18,2),
  vat_sar        NUMERIC(18,2),
  total_sar      NUMERIC(18,2),
  order_date     DATE,
  expected_date  DATE,
  approval_request_id TEXT REFERENCES approval_request(id),
  notes          TEXT,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_po_no ON purchase_order(company_id, po_no) WHERE deleted_at IS NULL AND po_no IS NOT NULL;
CREATE INDEX ix_po_supplier ON purchase_order(supplier_id);
CREATE INDEX ix_po_project ON purchase_order(project_id);

CREATE TABLE purchase_order_line (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES company(id),
  purchase_order_id TEXT NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  line_no        INTEGER NOT NULL,
  description_ar TEXT NOT NULL,
  qty            NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price_sar NUMERIC(18,2) NOT NULL,
  line_total_sar NUMERIC(18,2) NOT NULL,
  received_qty   NUMERIC(12,3) DEFAULT 0,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_po_line ON purchase_order_line(purchase_order_id, line_no) WHERE deleted_at IS NULL;
```
- يستوعب `project.financials.vendors[]` (قوائم الموردين وقيمهم) عند التحويل من دراسة الجدوى إلى أوامر شراء فعلية.


---

## 10. نطاق الخدمات والمنتجات (Services)

### 10.1 `service` — الخدمة
```sql
CREATE TABLE service (
  id             TEXT PRIMARY KEY,      -- 'svc_ppt_0'
  -- STD_SCOPE
  company_id     TEXT NOT NULL REFERENCES company(id),
  sector_id      TEXT REFERENCES sector(id),        -- svc.sectorId
  category_id    TEXT REFERENCES service_category(id),  -- svc.category (نص → مرجع)
  category_raw   TEXT,                  -- svc.category الأصلي
  owner_user_id  TEXT REFERENCES app_user(id),      -- svc.ownerId
  code           TEXT,
  name_ar        TEXT NOT NULL,         -- svc.nameAr
  name_en        TEXT,                  -- svc.nameEn
  summary        TEXT,                  -- svc.summary
  status         TEXT NOT NULL DEFAULT 'active',    -- svc.status
  source         TEXT,                  -- svc.source ('PROFILE_PPTX_2026')
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_service_sector ON service(sector_id);
CREATE INDEX ix_service_category ON service(category_id);
CREATE UNIQUE INDEX ux_service_code ON service(company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
```
- يغطّي `services[]`. `svc.audit[]` يُنقل إلى `audit_log`؛ `svc.links[]` إلى `service_link`؛ `svc.attachments[]` إلى `attachment`؛ `svc.packages[]` إلى `service_package`.

### 10.2 `service_package` — باقة خدمة (تطبيع `packages[]`)
```sql
CREATE TABLE service_package (
  id            TEXT PRIMARY KEY,      -- 'pk_ppt_0_0'
  company_id    TEXT NOT NULL REFERENCES company(id),
  service_id    TEXT NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  name_ar       TEXT NOT NULL,         -- packages[].nameAr
  name_en       TEXT,
  price_sar     NUMERIC(18,2) DEFAULT 0,   -- packages[].priceSar
  cost_sar      NUMERIC(18,2) DEFAULT 0,   -- packages[].costSar
  supplier_id   TEXT REFERENCES supplier(id),  -- packages[].supplierId
  notes         TEXT,                  -- packages[].notes
  sort_order    INTEGER,
  active        BOOLEAN NOT NULL DEFAULT true,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_package_service ON service_package(service_id);
CREATE INDEX ix_package_supplier ON service_package(supplier_id);
```
- يغطّي `services[].packages[]` كاملًا (الأسعار/التكاليف = 0 حاليًا؛ R8).

### 10.3 `service_link` — روابط الخدمة بكيانات أخرى (تطبيع `links[]`)
```sql
CREATE TABLE service_link (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES company(id),
  service_id  TEXT NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,          -- links[].kind ('sector',...)
  ref_id      TEXT,                   -- links[].refId ('SOLUTIONS')
  label       TEXT                    -- links[].label ('قطاع الحلول')
);
CREATE INDEX ix_service_link_service ON service_link(service_id);
CREATE INDEX ix_service_link_ref ON service_link(kind, ref_id);
```

---

## 11. نطاق التقارير والبريد (Reporting & Email)

### 11.1 `report_definition` — تعريف تقرير
```sql
CREATE TABLE report_definition (
  id            TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id    TEXT NOT NULL REFERENCES company(id),
  sector_id     TEXT REFERENCES sector(id),
  code          TEXT NOT NULL,        -- 'CEO_MONTHLY','SECTOR_PIPELINE','AR_AGING'
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  report_type   TEXT NOT NULL,        -- 'dashboard','table','financial','pipeline','ar_aging'
  query_spec    JSONB,                -- تعريف المصدر/المرشحات/الأعمدة
  output_formats JSONB,               -- ['pdf','xlsx','html']
  required_permission_id TEXT REFERENCES permission(id),  -- من يراه
  is_active     BOOLEAN NOT NULL DEFAULT true,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_report_code ON report_definition(company_id, code) WHERE deleted_at IS NULL;
```

### 11.2 `report_schedule` — جدولة التقرير
```sql
CREATE TABLE report_schedule (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES company(id),
  report_id     TEXT NOT NULL REFERENCES report_definition(id) ON DELETE CASCADE,
  recipient_group_id TEXT REFERENCES recipient_group(id),
  email_template_id  TEXT REFERENCES email_template(id),
  cron_expr     TEXT NOT NULL,        -- '0 8 1 * *' (أول كل شهر 8ص)
  timezone      TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  output_format TEXT NOT NULL DEFAULT 'pdf',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_run_at   TIMESTAMPTZ,
  next_run_at   TIMESTAMPTZ,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_report_schedule_report ON report_schedule(report_id);
CREATE INDEX ix_report_schedule_next ON report_schedule(next_run_at) WHERE is_active;
```

### 11.3 `recipient_group` و `recipient_group_member` — مجموعات المستلمين (M:N)
```sql
CREATE TABLE recipient_group (
  id          TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id  TEXT NOT NULL REFERENCES company(id),
  sector_id   TEXT REFERENCES sector(id),
  name_ar     TEXT NOT NULL,          -- 'القيادة','قادة القطاعات'
  description TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE recipient_group_member (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL REFERENCES recipient_group(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES app_user(id),
  employee_id  TEXT REFERENCES employee(id),
  email        TEXT,                  -- مستلم خارجي بلا حساب
  CHECK (user_id IS NOT NULL OR employee_id IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX ix_recipient_member_group ON recipient_group_member(group_id);
CREATE UNIQUE INDEX ux_recipient_member ON recipient_group_member(group_id, COALESCE(user_id,''), COALESCE(email,''));
```

### 11.4 `email_template` — قالب البريد
```sql
CREATE TABLE email_template (
  id           TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id   TEXT NOT NULL REFERENCES company(id),
  code         TEXT NOT NULL,         -- 'REPORT_DELIVERY','APPROVAL_REQUEST','INVOICE_DUE'
  name_ar      TEXT NOT NULL,
  subject_ar   TEXT NOT NULL,
  subject_en   TEXT,
  body_html_ar TEXT,
  body_html_en TEXT,
  variables    JSONB,                 -- المتغيرات المتاحة ({{recipientName}},...)
  is_active    BOOLEAN NOT NULL DEFAULT true,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_email_template_code ON email_template(company_id, code) WHERE deleted_at IS NULL;
```

### 11.5 `email_queue` — طابور الإرسال (in-process job queue، ADR-0001)
```sql
CREATE TABLE email_queue (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES company(id),
  template_id   TEXT REFERENCES email_template(id),
  to_email      TEXT NOT NULL,
  to_name       TEXT,
  cc            JSONB,
  subject       TEXT NOT NULL,
  body_html     TEXT,
  attachments   JSONB,                -- مراجع مرفقات/report_snapshot
  status        TEXT NOT NULL DEFAULT 'QUEUED'
                  CHECK (status IN ('QUEUED','SENDING','SENT','FAILED','CANCELLED')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  last_error    TEXT,
  source_ref    TEXT,                 -- 'report_schedule:<id>','approval_request:<id>'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT REFERENCES app_user(id)
);
CREATE INDEX ix_email_queue_status ON email_queue(status, scheduled_at);
CREATE INDEX ix_email_queue_company ON email_queue(company_id);
```

### 11.6 `email_log` — سجل الإرسال (append-only)
```sql
CREATE TABLE email_log (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES company(id),
  queue_id     TEXT REFERENCES email_queue(id),
  to_email     TEXT NOT NULL,
  subject      TEXT,
  status       TEXT NOT NULL,         -- 'SENT','FAILED','BOUNCED','OPENED'
  provider_msg_id TEXT,
  error        TEXT,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_email_log_queue ON email_log(queue_id);
CREATE INDEX ix_email_log_to ON email_log(to_email, logged_at);
```

### 11.7 `report_snapshot` — أرشيف التقارير المُولّدة
```sql
CREATE TABLE report_snapshot (
  id            TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id    TEXT NOT NULL REFERENCES company(id),
  sector_id     TEXT REFERENCES sector(id),
  report_id     TEXT REFERENCES report_definition(id),
  schedule_id   TEXT REFERENCES report_schedule(id),
  title         TEXT NOT NULL,
  format        TEXT NOT NULL,        -- 'pdf','xlsx','html'
  period_label  TEXT,                 -- 'يونيو 2026'
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  params        JSONB,                -- المرشحات المستخدمة
  data_json     JSONB,               -- لقطة البيانات (للتقارير القابلة لإعادة العرض)
  file_ref      TEXT,                 -- مرجع تخزين الملف (attachment)
  row_count     INTEGER,
  generated_by  TEXT REFERENCES app_user(id)
);
CREATE INDEX ix_report_snapshot_report ON report_snapshot(report_id, generated_at DESC);
```
- يعالج فجوة «التقارير عرضية لحظية لا مؤرشفة».

---

## 12. نطاق الحوكمة والمشترك (Governance & Shared)

### 12.1 `audit_log` — سجل التدقيق (append-only، غير قابل للتعديل)
```sql
CREATE TABLE audit_log (
  id           TEXT PRIMARY KEY,      -- 'act_mqgd7agfleel'
  -- STD_SCOPE
  company_id   TEXT NOT NULL REFERENCES company(id),
  sector_id    TEXT REFERENCES sector(id),        -- activity.sectorId
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),-- activity.at
  actor_user_id TEXT REFERENCES app_user(id),     -- activity.userId
  actor_username TEXT,                -- activity.username
  actor_role   TEXT,                  -- activity.role
  action       TEXT NOT NULL,         -- activity.kind ('state-save','create','update','delete','approve','login')
  entity       TEXT,                  -- الكيان المتأثر ('opportunity','project',...)
  entity_id    TEXT,
  changes      JSONB,                 -- activity.changes[] ([{key,was,now}])
  ignored_keys JSONB,                 -- activity.ignoredKeys
  ip           TEXT,                  -- حساس
  request_id   TEXT
);
CREATE INDEX ix_audit_entity ON audit_log(entity, entity_id, at DESC);
CREATE INDEX ix_audit_actor ON audit_log(actor_user_id, at DESC);
CREATE INDEX ix_audit_company_at ON audit_log(company_id, at DESC);
```
- يغطّي `activity[]` (443 قيدًا) و`services[].audit[]`. **بلا `updated_at`/soft-delete** — سجل دائم. في PostgreSQL يُنصح بجعله جدولًا مقسّمًا زمنيًا (partition by month) مستقبلًا.

### 12.2 `ai_activity_log` — سجل المساعد الذكي (حوكمة R10)
```sql
CREATE TABLE ai_activity_log (
  id            TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id    TEXT NOT NULL REFERENCES company(id),
  sector_id     TEXT REFERENCES sector(id),
  user_id       TEXT REFERENCES app_user(id),
  session_ref   TEXT,
  provider      TEXT NOT NULL DEFAULT 'openai',
  model         TEXT,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('CHAT','FILE_READ','IMAGE_READ','MUTATION','CONFIG')),
  prompt_summary TEXT,               -- ملخص/مقتطف (تصنيف البيانات المرسلة)
  affected_entity TEXT,              -- الكيان المُعدّل عند MUTATION
  affected_id    TEXT,
  proposed_changes JSONB,            -- التعديلات المقترحة/المطبّقة
  applied        BOOLEAN NOT NULL DEFAULT false,
  approved_by_user_id TEXT REFERENCES app_user(id),
  tokens_in      INTEGER,
  tokens_out     INTEGER,
  data_classification TEXT,          -- تصنيف حساسية البيانات المرسلة لطرف ثالث
  at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_ai_log_user ON ai_activity_log(user_id, at DESC);
CREATE INDEX ix_ai_log_entity ON ai_activity_log(affected_entity, affected_id);
CREATE INDEX ix_ai_log_mutation ON ai_activity_log(interaction_type, applied);
```
- يوثّق كل تعديل يجريه المساعد الذكي على الكيانات، ويربطه بمعتمِد بشري — يعالج فجوة الحوكمة/التدقيق/تسريب البيانات.

### 12.3 `notification` — الإشعارات
```sql
CREATE TABLE notification (
  id            TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id    TEXT NOT NULL REFERENCES company(id),
  sector_id     TEXT REFERENCES sector(id),
  recipient_user_id TEXT NOT NULL REFERENCES app_user(id),
  type          TEXT NOT NULL,       -- 'APPROVAL_PENDING','INVOICE_DUE','RISK_FLAGGED','DELIVERABLE_LATE','MENTION'
  title_ar      TEXT NOT NULL,
  body_ar       TEXT,
  entity        TEXT,                -- الكيان المصدر
  entity_id     TEXT,
  action_url    TEXT,
  priority      TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  is_read       BOOLEAN NOT NULL DEFAULT false,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT REFERENCES app_user(id)
);
CREATE INDEX ix_notification_recipient ON notification(recipient_user_id, is_read, created_at DESC);
CREATE INDEX ix_notification_entity ON notification(entity, entity_id);
```

### 12.4 `attachment` — المرفقات (بوليمورفي، مشترك)
```sql
CREATE TABLE attachment (
  id            TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id    TEXT NOT NULL REFERENCES company(id),
  entity        TEXT NOT NULL,       -- 'service','project','proposal','contract','deliverable',...
  entity_id     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INTEGER,
  storage_ref   TEXT NOT NULL,       -- مسار/مفتاح التخزين
  file_hash     TEXT,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by   TEXT REFERENCES app_user(id),
  deleted_at    TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id)
);
CREATE INDEX ix_attachment_entity ON attachment(entity, entity_id);
```
- يغطّي `services[].attachments[]` والحقل `attachments[]` أينما ورد، ويؤسّس لإدارة وثائق مركزية.


---

## 13. ملخص علاقات M:N

| العلاقة | جدول الربط | المفاتيح | ملاحظة |
|---------|------------|----------|--------|
| **موظف ↔ عدة مشاريع** (والعكس) | `project_member` | (project_id, employee_id) فريد | فريق المشروع، منفصل عن الهيكل |
| **فرصة ↔ عدة قطاعات** | `opportunity_sector` | PK(opportunity_id, sector_id) | `is_primary` + `share_pct` |
| موظف ↔ عدة فرص | `opportunity_member` | (opportunity_id, employee_id, role_in_deal) | فريق الفرصة |
| موظف ↔ عدة برامج | `program_member` | (program_id, employee_id, role) | فريق البرنامج |
| موظف ↔ الوحدات التنظيمية | `membership` | employee_id + org_unit_id/position_id | **الهيكل الرسمي** (منفصل عن الفرق) |
| موظف ↔ لجان الاعتماد | `committee_member` (§13.1) | (committee_id, employee_id) | لجان منفصلة عن الهيكل |
| دور ↔ صلاحيات | `role_permission` | PK(role_id, permission_id) | RBAC |
| مستخدم ↔ أدوار (بنطاق) | `user_role` | (user_id, role_id, sector_id) | تفويض خادمي |
| مجموعة مستلمين ↔ أعضاء | `recipient_group_member` | group_id + user/employee/email | توزيع التقارير |
| مخرَج ↔ فاتورة | `invoice_line` | deliverable_id ← invoice_id | ربط الفوترة |
| دفعة تعاقدية ↔ معلم/مخرج | `contract_payment` | milestone_id / deliverable_id | جدول الدفعات |
| عرض ↔ خدمات/باقات | `pricing_line` | proposal_id + service_id/package_id | بنود التسعير |

### 13.1 `committee` و `committee_member` — لجان الاعتماد (منفصلة عن الهيكل)
```sql
CREATE TABLE committee (
  id          TEXT PRIMARY KEY,
  -- STD_SCOPE
  company_id  TEXT NOT NULL REFERENCES company(id),
  sector_id   TEXT REFERENCES sector(id),
  code        TEXT,
  name_ar     TEXT NOT NULL,          -- 'لجنة اعتماد التسعير','لجنة الترسية'
  purpose     TEXT,
  committee_type TEXT,                -- 'ACCREDITATION','PRICING','AWARD','GOVERNANCE'
  quorum      INTEGER,                -- النصاب
  is_active   BOOLEAN NOT NULL DEFAULT true,
  -- STD_AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT REFERENCES app_user(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT REFERENCES app_user(id),
  deleted_at TIMESTAMPTZ, deleted_by TEXT REFERENCES app_user(id), row_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE committee_member (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES company(id),
  committee_id TEXT NOT NULL REFERENCES committee(id) ON DELETE CASCADE,
  employee_id  TEXT NOT NULL REFERENCES employee(id),
  role_in_committee TEXT,            -- 'رئيس','عضو','مقرر'
  is_voting    BOOLEAN NOT NULL DEFAULT true,
  start_date   DATE,
  end_date     DATE,
  UNIQUE (committee_id, employee_id)
);
CREATE INDEX ix_committee_member_emp ON committee_member(employee_id);
```
- **يجسّد فصل «لجان الاعتماد» عن الهيكل التنظيمي**: عضو اللجنة موظف من أي وحدة، وعضويته في اللجنة لا تغيّر انتماءه الهيكلي (`membership`). اللجان تُربط بسير الاعتماد عبر `approval_step.approver_type` مستقبلًا.

---

## 14. تغطية حقول اللقطة الحالية (Snapshot Coverage)

الجدول التالي يربط كل مجموعة في `legacy-state.snapshot.json` بالجداول المستهدفة (تغطية 100%):

| مجموعة اللقطة | العدد | الجدول/الجداول المستهدفة | ملاحظات التحويل |
|----------------|-------|--------------------------|------------------|
| `sectors[]` | 4 | `sector` | `placeholder→is_placeholder`, `leadId/managerId→employee` |
| `practices[]` | 5 | `practice` | مرجعي |
| `stages[]` | 6 | `pipeline_stage` | `order→sort_order`, أعلام is_won/is_lost/is_terminal |
| `priorities[]` | 4 | `priority` | `rank` من P0..P3 |
| `services[]` | 15 | `service` + `service_package` + `service_link` + `attachment` + `audit_log` | تفكيك المصفوفات المضمّنة |
| `suppliers[]` | 33 | `supplier` | مباشر |
| `clients[]` | 90 | `client` + `client_alias` | `type→client_type` (تطبيع الـ71 بلا نوع) |
| `opportunities[]` | 134 | `opportunity` + `opportunity_sector` + `stage_history` | `sectorId→صف primary`, `stageRaw→stage_raw` |
| `projects[]` | 43 | `project` (+`contract` مشتق من contractValue) | `financials{}→JSONB` + تسطيح المجمّعات |
| `deliverables[]` | 342 | `deliverable` (+`invoice_line` مستقبلًا) | `status`, `invoiceStatus→invoice_status` |
| `revenueLines[]` | 31 | `revenue_line` | `auto/ruleId/derivedFrom` محفوظة (R3) |
| `costLines[]` | 148 | `cost_line` | `type→cost_type` + `cost_type_raw` |
| `allocations[]` | 47 | `allocation` + `allocation_month` | تطبيع `monthly{}` |
| `team[]` | 29 | `employee` (+`membership`, `position`) | `dept→dept_legacy` ثم `org_unit`, `salarySar` حسّاس |
| `users[]` | 26 | `app_user` + `user_role` + `user_login_history` | `role→user_role`, `loginHistory→جدول` |
| `directory[]` | 25 | مغطّى بـ `employee`/`app_user` | دليل هوية خفيف يُدمج |
| `activity[]` | 443 | `audit_log` | `kind→action`, `changes[]→JSONB` |
| `meta{}` | — | `company` + `config` + `schema_migration` + `import_log` | تفكيك حسب الحقل |
| `budget{}` | — | `budget` + `budget_line` | `monthlyRevenue[]→budget_line`, `costAssumptions→JSONB` |
| `importLog[]` | 1 | `import_log` | مباشر |
| `sessions[]` | 0 | `app_session` | بنية جاهزة |
| `directives[]` | 0 | (بذرة مستقبلية) | تُوجَّه إلى `workflow_definition`/`notification` عند التفعيل |

**الحقول الحسّاسة الموسومة للحجب الخادمي (R1/R2):** `employee.salary_sar` · `user_login_history.ip` · `audit_log.ip` · `app_user.password_hash` (لا يُعاد أبدًا) · هوامش المشاريع/الأسعار حسب الدور.

---

## 15. استراتيجية الفهرسة والأداء

1. **كل مفتاح أجنبي مُفهرَس صراحةً** (SQLite لا يفهرس FK تلقائيًا، وPostgreSQL كذلك لا يفهرس جانب الإشارة).
2. **فهارس مركّبة للاستعلامات المتكررة:** `(sector_id, status)` على opportunity/project، `(year, month)` على cost_line/revenue_line/deliverable، `(entity, entity_id, at)` على audit_log.
3. **الفهارس الجزئية للحالة الحيّة:** كل القيود الفريدة على `WHERE deleted_at IS NULL` — تتفادى تعارض الأكواد بعد الحذف المنطقي وتصغّر حجم الفهرس.
4. **تفادي فهرسة الأعمدة الحسّاسة/الكبيرة:** `salary_sar`, `financials JSONB` لا تُفهرَس؛ استعلامات JSONB في PostgreSQL تستخدم GIN عند الحاجة، وفي SQLite تعبيرات `json_extract` مع فهارس تعبيرية عند الضرورة.
5. **مفاتيح ULID المرتّبة زمنيًا** تحسّن محلية الإدراج في الفهارس مقارنة بـUUIDv4 العشوائي.
6. **التجميعات المالية** (إيراد/تكلفة القطاع شهريًا) تُخدَم بفهارس `(sector_id, year, month)`؛ ولوحات القيادة الثقيلة تُبنى عليها Materialized Views في PostgreSQL (وجداول تلخيص مُحدَّثة بالخدمة في SQLite).

---

## 16. ملاحظات الترحيل من الوثيقة الواحدة

1. **ترتيب الإنشاء (لكسر الدورات المرجعية):**
   `currency → company (FK مؤجَّل لـ default_sector) → app_user (bootstrap, created_by NULL) → الجداول المرجعية → sector → employee → org_unit/position → باقي الجداول`.
   المفاتيح المتبادلة (`sector.lead_employee_id`, `company.default_sector_id`, و`decision/change_request/timesheet/budget/expense/po → approval_request`) تُضاف بعد إنشاء الجداول عبر `ALTER TABLE ... ADD CONSTRAINT` (أو `DEFERRABLE INITIALLY DEFERRED` في PostgreSQL).
2. **حفظ المعرّفات:** تُنقل معرّفات اللقطة كما هي (`u_rayan_zafar`, `p_001`) إلى `id` لتفادي كسر المراجع؛ السجلات الجديدة تستخدم ULID مسبوق.
3. **التطبيع أثناء الترحيل:**
   - `client.type` النصي → `client_type` (حكومي=GOV، خاص=PRIVATE، داخلي=INTERNAL، فارغ=NULL موسوم للتنظيف R8).
   - `cost_line.type` / `service.category` / `opportunity.practice` → مراجع مع الاحتفاظ بالنص الأصلي في `*_raw`.
   - `allocation.monthly{}` و`budget.monthlyRevenue[]` → صفوف مطبّعة.
   - `role` القديم `sector_manager` → `sector_lead` (كما في الكود الحالي).
4. **النسب:** ضرب النسب العشرية داخل `financials` (0.1358) ×100 لتوحيدها على 0–100.
5. **المشتقّات:** محرك R3 (مخرج مفوتر ⇒ إيراد) يُعاد تنفيذه **خادميًا** كخدمة تكتب `revenue_line` وتحترم القيد الفريد `ux_revenue_auto` (يعالج R9). `total_invoiced_sar`/`collected_sar`/`outstanding_ar_sar` على المشروع تُصبح مشتقّة من `invoice`/`collection` بدل الاستيراد.
6. **التزامن:** `row_version` لكل صف يحل محل `meta.revision` العام + `X-Base-Revision`.
7. **عدم الكتابة على الإنتاج:** وفق `PROVENANCE.txt`، اللقطة **مصدر ترحيل فقط**؛ الترحيل يبني قاعدة جديدة ولا يكتب على `os.evcsol.com`.

---

## ملحق — إحصاء الجداول

- **مرجعية/إعدادات (11):** company, currency, pipeline_stage, priority, practice, client_type, service_category, cost_type, config, schema_migration, import_log.
- **التنظيم (13):** sector, org_unit_type, org_unit, position, employee, app_user, user_login_history, app_session, role, permission, role_permission, user_role, membership.
- **CRM (10):** client, client_alias, contact, opportunity, opportunity_sector, opportunity_member, tender, proposal, pricing_line, stage_history.
- **PMO (16):** portfolio, program, program_member, project, project_member, workstream, milestone, deliverable, task, dependency, risk, issue, decision, change_request, action_item, lesson_learned.
- **الوقت (5):** timesheet_period, timesheet, time_entry, allocation, allocation_month.
- **Workflow (5):** workflow_definition, approval_chain, approval_step, approval_request, approval_action.
- **المالية (13):** contract, contract_payment, invoice, invoice_line, collection, expense, cost_line, revenue_line, budget, budget_line, supplier, purchase_order, purchase_order_line.
- **الخدمات (3):** service, service_package, service_link.
- **التقارير/البريد (8):** report_definition, report_schedule, recipient_group, recipient_group_member, email_template, email_queue, email_log, report_snapshot.
- **الحوكمة/مشترك (5):** audit_log, ai_activity_log, notification, attachment, (committee/committee_member).

**الإجمالي: 90 جدولًا** (11+13+10+16+5+5+13+3+8+6) يغطّي كل النطاقات المطلوبة وكل حقول اللقطة الحالية.
