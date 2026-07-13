# 00 — تقرير مراجعة التماسك بين مواصفات «سند» (Independent Architecture Review)

**المُراجِع:** مراجع معماري مستقل · **التاريخ:** 2026-07-13
**النطاق المُراجَع:** `platform/docs/specs/01..06` مقابل `docs/02-analysis-report.md` و`platform/seed/legacy-state.snapshot.json` (revision 890).
**الطريقة:** فحص صارم لخمسة محاور: (1) سلامة المفاتيح الأجنبية · (2) تغطية الصلاحيات · (3) تغطية الترحيل · (4) اتساق حجب البيانات الحساسة · (5) تناقضات التسمية.

> **الحكم العام: مشكلات كبيرة (major-issues).** المواصفات غنية ومتقنة منفردةً، لكن **لا يوجد توافق على مستوى أسماء الأعمدة/الجداول والمفردات بين SPEC-01 (نموذج البيانات) من جهة وSPEC-03/06 (API/الترحيل) من جهة أخرى**. أخطرها ثلاثة: تضارب تسمية/وحدة الأعمدة المالية (`_sar` مقابل `_halalas`)، وغياب SPEC-04 (قوالب البريد) كليًّا، وجداول الهيكل التنظيمي (`department/unit/team`) غير الموجودة في نموذج البيانات. يجب حسمها قبل كتابة `001_init.sql` و`migrate-legacy.js`.

---

## ملخص تنفيذي بالخطورة

| # | الخطورة | المحور | المشكلة (سطر واحد) |
|---|---------|--------|---------------------|
| C1 | Critical | تسمية/FK | الأعمدة المالية `*_sar NUMERIC` في SPEC-01 مقابل `*_halalas INTEGER` في SPEC-03/06 — الترحيل يكتب لأعمدة غير موجودة. |
| C2 | Critical | حجب/تغطية | SPEC-04 (قوالب البريد) **غير موجود**؛ يستحيل التحقق من حجب الرواتب/الهوامش في البريد والتقارير المُرسَلة. |
| C3 | Critical | FK/تنظيم | جداول `department`/`unit`/`team` ومساراتها في SPEC-03/06 لا مقابل لها في SPEC-01 (الذي يستخدم `org_unit`+`org_unit_type` فقط). |
| H1 | High | حجب | تصنيفا `VALUE` و`CONTACT_PII` غير مُفعَّلين في API (§1.10 "planned") رغم إلزام RBAC §7 بحجبهما عن viewer/external. |
| H2 | High | صلاحيات | موارد `task` و`timesheet`/`time_entry` (ومسارات §6.3/§7 في API) غير موجودة في كتالوج RBAC §3 ولا أوراق المنح §6. |
| H3 | High | FK/ترحيل | عمود `allocation.monthly_json` (API §9.5 + الترحيل §3.13) غير موجود في SPEC-01؛ والترحيل لا يملأ `allocation_month` فتنكسر مؤشرات KPI. |
| H4 | High | FK | `app_user.role_id` المفرد (API/الترحيل) يناقض علاقة `user_role` M:N في SPEC-01/RBAC. |
| H5 | High | FK/صلاحيات | `role_permission` بلا عمود `scope` (SPEC-01) بينما منح RBAC وAPI §3.2 مبنية على `(resource,action,scope)`. |
| M1 | Medium | FK | `sector.lead_employee_id`→employee (SPEC-01) مقابل `lead_user_id`→app_user (SPEC-03/06): اسم وهدف FK مختلفان. |
| M2 | Medium | تسمية/FK | أعمدة `audit_log` غير متطابقة: `actor_user_id/entity/changes` (SPEC-01) مقابل `user_id/resource/detail_json` (API/الترحيل). |
| M3 | Medium | تسمية | `pipeline_stage`↔`stage` و`user_login_history`↔`login_history` بين SPEC-01 وSPEC-03/06. |
| M4 | Medium | تسمية | مفردات الموارد/الأفعال: `activity`↔`audit`↔`audit_log` · `team_org`↔`team` · `role_grant/iam_*/org_membership`↔`role_permission/app_user/membership` · أفعال `view/edit/import`↔`read/update`. |
| M5 | Medium | تسمية | معالجة `client.type` بثلاث طرق: `client_type` مُطبَّع (SPEC-01) · enum عربي `type` (API) · نص خام (الترحيل). |
| M6 | Medium | FK | حقول `employee.line_manager_id/department_id/unit_id` (API/الترحيل) غير موجودة في SPEC-01 (`primary_org_unit_id`). |
| M7 | Medium | ترحيل/تسمية | SPEC-01 §14 يدّعي ترحيل `practice/client_alias/budget_line/stage_history/allocation_month` بينما SPEC-06 يؤجّلها (D1/D5) أو يخزّنها JSON. |
| L1 | Low | دلالة | `membership`: SPEC-01 هيكلي بحت (employee↔org_unit/position) مع جداول `*_member` منفصلة؛ API §3.3 يخلط `group_kind=project/opportunity/committee`. |
| L2 | Low | تسمية | كوكي الجلسة `sanad_sid` (API) مقابل `evc_session` (RBAC + `app_session`). |
| L3 | Low | تسمية | `proposal.status`: 7 قيم بأحرف كبيرة (SPEC-01) مقابل 4 قيم بأحرف صغيرة (API). |
| L4 | Low | تسمية | عدد الأدوار: 9 (تعليق SPEC-01 §4.9) مقابل 16 (RBAC/API). |
| L5 | Low | صلاحيات | مورد RBAC `payment` مقابل `collection`/`contract_payment` في SPEC-01/API. |

---

## 1) سلامة المفاتيح الأجنبية (FK Integrity)

**السؤال:** هل كل علاقة في عقد الـAPI ونموذج الترحيل مدعومة بجدول/عمود في نموذج البيانات؟

الإجابة: **لا، جزئيًا** — الأغلبية مدعومة، لكن توجد فجوات جوهرية:

### 1.1 [C1] تضارب تسمية/وحدة الأعمدة المالية `_sar` مقابل `_halalas`
- SPEC-01 يعرّف الأعمدة المالية باسم ووحدة الريال: `salary_sar`, `budget_sar`, `value_sar`, `amount_sar`, `contract_value_sar`, `target_sales_sar`… بنوع `NUMERIC(18,2)` (**75 ظهورًا لـ `_sar`، صفر لـ `_halalas`**).
- SPEC-03 (API) يُعيد ويقبل `*_halalas` أعدادًا صحيحة (`value_halalas`, `salary_halalas`, `budget_halalas`… **35 ظهورًا**)، وSPEC-06 (الترحيل) يكتب صراحةً إلى `*_halalas` عبر `toHalalas()` (**29 ظهورًا**، ويُسمّي القاعدة الحاكمة G1).
- **الأثر:** سكربت الترحيل والـAPI يكتبان/يقرآن أعمدة `*_halalas` **غير موجودة في DDL نموذج البيانات**. هذا كسر بنيوي مباشر (لن يعمل `INSERT`). يجب توحيد القرار: إمّا تسمية الأعمدة `*_halalas INTEGER` في SPEC-01 (المتّسق مع ADR-0002 المذكور في API)، أو تعديل API/الترحيل لاستخدام `*_sar NUMERIC`. الموصى به: `*_halalas` (يتفق مع الكود القائم والمرجعية المالية).

### 1.2 [C3] جداول الهيكل التنظيمي غير الموجودة
- SPEC-01 ينمذج ما دون القطاع كشجرة واحدة `org_unit` + `org_unit_type` (Department/Unit/Team مرنة) — **لا توجد جداول `department` أو `unit` أو `team`**.
- SPEC-03 §4.2 يعرّف مسارات `/api/departments`, `/api/units`, `/api/teams` ومخططات `Department`/`Unit`/`Team`، وSPEC-06 §3.6 يولّد جدول `department` (4 صفوف)، وملحق أ في API يخصّص بادئات `dep_`/`team_`. RBAC §3.1 يستخدم موارد `department`/`unit`/`team_org`.
- **الأثر:** كل FK يشير إلى `department_id`/`unit_id`/`team_id` بلا جدول هدف في SPEC-01. يجب إمّا إضافة الجداول الصريحة، أو إعادة كتابة API/الترحيل على `org_unit`(+`type_id`). القرار المفتوح OQ-1/D2 يعترف بهذا لكنه لم يُحسم قبل كتابة العقود.

### 1.3 [H3] `allocation.monthly_json` غير موجود + `allocation_month` غير مملوء
- SPEC-01 §7.4/7.5: جدول `allocation` **بلا** `monthly_json`؛ الإشغال الشهري يُطبَّع في `allocation_month(allocation_id, month, pct)`.
- API §9.5 ومخطط `Allocation`، وSPEC-06 §3.13، يستخدمان عمود `allocation.monthly_json` (JSON) ولا يملآن `allocation_month`.
- **الأثر:** (أ) عمود غير موجود؛ (ب) مؤشرات KPI (SPEC-05 §6.10 Resource Utilization، §7.1 Planned Hours) تقرأ `allocation_month.pct` عبر `JOIN allocation_month` — ستُرجِع صفرًا لكل البيانات المُرحَّلة. تناقض ثلاثي بين 01/03/05 و06.

### 1.4 [H4] نموذج الدور: `role_id` مفرد مقابل `user_role` M:N
- SPEC-01 §4.6/§4.9: `app_user` **بلا** `role_id`؛ الأدوار عبر `user_role` (M:N مع نطاق). RBAC §2.2 يبني `principal.roles` كمصفوفة.
- SPEC-03 (استجابة login ومخطط `User`) وSPEC-06 §3.7 يضعان `role_id` مفردًا على `app_user` (`role→role_id`).
- **الأثر:** تعدّد الأدوار (الذي يفترضه RBAC §4 «تعدّد الأدوار» وT-cases) غير ممثّل في مسار API/الترحيل.

### 1.5 [H5] `role_permission` بلا `scope`
- SPEC-01 §4.9: `role_permission(role_id, permission_id)` فقط — لا عمود `scope`. النطاق على `user_role.sector_id`.
- RBAC (منح `iam_role_grant` = resource×action×**scope**×field_policy) وAPI §3.2 (`/roles/:id/grants` تُعيد `{resource,action,scope}`) يفترضان نطاقًا **لكل منحة دور**.
- **الأثر:** لا يمكن تمثيل «دور له قراءة @sector لكن تحديث @own» في `role_permission`. يلزم عمود `scope` (أو جدول `role_grant` منفصل كما تسمّيه RBAC).

### 1.6 [M1] هدف FK لقائد القطاع
- SPEC-01: `sector.lead_employee_id` و`manager_employee_id` يشيران إلى `employee`.
- SPEC-03 §4.1 (مخطط Sector: `lead_user_id`) وSPEC-06 §3.1/§5.2 (`leadId→lead_user_id` يشير إلى `app_user`).
- تضارب في اسم العمود وهدف المرجع.

### 1.7 [M2] أعمدة `audit_log`
- SPEC-01 §12.1: `actor_user_id`, `actor_username`, `actor_role`, `entity`, `entity_id`, `changes`, `ignored_keys`.
- SPEC-03 §14 (مخطط AuditLog) وSPEC-06 §3.15: `user_id`, `username`, `role_id`, `resource`, `resource_id`, `detail_json`.
- تضارب أسماء أعمدة كامل لنفس الجدول.

### 1.8 [M6] حقول `employee`
- API §4.3/§4.2 والترحيل يشيران إلى `employee.line_manager_id`, `department_id`, `unit_id`, `dept_label`, `job_title`، بينما SPEC-01 §4.5 يستخدم `primary_org_unit_id`, `dept_legacy`, `role_title` ولا يملك `line_manager_id`.

> **جداول مؤكَّدة الوجود والسلامة (لا مشكلة):** opportunity↔client/sector/stage، project↔program/client/sector/opportunity، deliverable↔project، revenue_line/cost_line↔project، contract/invoice↔project، approval_request↔workflow، project_member/opportunity_member/committee_member. علاقات M:N (opportunity_sector, project_member) مدعومة بجداول ربط صريحة.

---

## 2) تغطية الصلاحيات (RBAC Coverage)

**السؤال:** هل كل مسار في عقد الـAPI له صلاحية محدّدة في نموذج RBAC؟

الإجابة: **الأغلبية نعم، مع فجوات مؤكدة:**

### 2.1 [H2] موارد مستخدمة في API وغائبة عن RBAC
- **`task` / `dependency`:** مسارات API §6.3 (`/api/tasks/*`, `/api/tasks/quick-add`, `/api/dependencies/*`) تستخدم `task:read/create/update@own/project/sector`. لكن **`task` غير مذكور في كتالوج موارد RBAC §3 ولا في أي ورقة منح §6** (بحث نصّي: صفر). لا دور يملك أي منحة على `task` ⇒ deny-by-default يمنع الجميع.
- **`timesheet` / `time_entry`:** مسارات API §7 كاملة تستخدم `timesheet:read/create/update/approve@own/team/sector`. **غير موجودة في RBAC** إطلاقًا. حتى الموظف لن يستطيع تسجيل ساعاته.
- **`milestone`:** مورد في ملحق ب (API) لكن غير مُعرَّف في RBAC (مساراته الفعلية تتّكئ على `project`/`deliverable`، فهو أقل خطورة لكنه غير متسق).
- **الأثر:** يجب إضافة `task`, `timesheet`, `time_entry` (وربما `milestone`) إلى كتالوج RBAC §3 وأوراق المنح §6 (على الأقل: employee/consultant `@own`, pm/line_manager/sector_lead `@project/team/sector` مع `approve`).

### 2.2 موارد RBAC بلا سطح API (اتجاه معاكس — أقل خطورة)
- `document` (منح كثيفة في RBAC §5.5) بلا أي مسار `/api/documents` (جدول `attachment` موجود بلا CRUD).
- `data_quality` (RBAC) بلا مسار API.
- `directory` (RBAC §3.2) بلا مسار API وبلا جدول (مُدمج في employee/app_user حسب الترحيل).
- `payment` (RBAC §3.4) — API يستخدم `collection`/`contract_payment` بدلًا منه [L5].

### 2.3 مسارات API بلا منح صريح — مقبولة (ذاتية/عامة)
`/api/health` (عام)، `/api/auth/login|logout|me|change-password` (ذاتية بجلسة) — موسومة `—` بوضوح ومتّسقة مع RBAC.

---

## 3) تغطية الترحيل (Migration Coverage)

**السؤال:** هل كل مجموعة قديمة في اللقطة لها تعيين؟

الإجابة: **نعم، كل مجموعات اللقطة مُغطّاة** (تحقّقنا من مفاتيح اللقطة الـ23: `meta, currentUserId, budget, activity, allocations, clients, costLines, deliverables, importLog, opportunities, practices, priorities, projects, revenueLines, sectors, services, stages, suppliers, team, users, sessions, directives, directory`). لا كيان قديم يُسقَط.

**لكن توجد تناقضات في *كيفية* التغطية بين SPEC-01 وSPEC-06 [M7]:**

| المجموعة | SPEC-01 §14 (يدّعي) | SPEC-06 (ينفّذ فعليًا) | الحكم |
|----------|---------------------|-------------------------|-------|
| `practices` (5) | → جدول `practice` | مؤجَّل D1؛ يبقى seed config لا صفوف | **تناقض** |
| `clients.aliases[]` | → `client_alias` | مؤجَّل D5؛ يبقى في notes/اللقطة | **تناقض** |
| `allocations.monthly{}` | → `allocation_month` (مطبَّع) | → `monthly_json` (JSON على allocation) | **تناقض** [مرتبط H3] |
| `budget.monthlyRevenue[]` | → `budget_line` | → `monthly_json` (JSON على budget) | **تناقض** |
| `opportunities` | +`stage_history` | لا يُنشئ stage_history | **تناقض** |
| `activity` (443) | → `audit_log` | → `audit_log` (توسعة §3.15) لكن بأعمدة مختلفة [M2] | جزئي |

- **ملاحظة صغيرة:** الحقل الجذري `currentUserId` في اللقطة غير مُعالَج صراحةً في SPEC-06 (تافه — مؤشر جلسة).
- **قوة الترحيل:** قاعدة «link-or-null / never-drop»، ومراسي المطابقة المالية السبعة، وDRY-RUN، وتقرير المطابقة — كلها ممتازة ومتّسقة داخليًا.

---

## 4) اتساق حجب البيانات الحساسة (Redaction Consistency)

**السؤال:** هل الرواتب/الهوامش/التكلفة/IP محجوبة اتساقًا عبر API والبريد والتقارير؟

الإجابة: **غير متّسقة — فجوتان حقيقيتان:**

### 4.1 [H1] `VALUE` و`CONTACT_PII` مُلزَمتان في RBAC لكن غير مُفعَّلتين في API
- RBAC §7.1/§7.2: `VALUE` (قيمة الفرصة، قيم العقد/الفاتورة/الإيراد، مبالغ المخرجات) و`CONTACT_PII` (بريد/هاتف المورّد والعميل) **محجوبة عن viewer/bd(للمشروع)/external**.
- API §1.10 يصرّح: البوابات المُنفَّذة فعليًا هي `salary/cost/margin/ip` فقط؛ و`value`/`contact` **"planned"** — «تُعاد كاملة لمن يملك قراءة المورد ضمن نطاقه» حتى تُفعَّل.
- **الأثر:** `viewer` سيرى `opportunity.value_halalas` و`revenue_line.amount_halalas` عبر API رغم أن RBAC §5.3/§5.4/T4 يوجب حجبها؛ وبريد/هاتف المورّد مكشوفان. تناقض مباشر بين SPEC-02 (سلطة الحجب) وSPEC-03 (التنفيذ). حتى قائمة القبول في API (ملحق د) تختبر cost/margin للـviewer فقط، لا value.

### 4.2 [C2] البريد والتقارير المُرسَلة غير مُغطّاة (SPEC-04 مفقود)
- **SPEC-04 (`04-email-templates.md`) غير موجود في المستودع** رغم إحالة API §11 وSPEC-05 إليه، وطلب المراجعة يفترض وجوده.
- نتيجةً لذلك **يستحيل التحقق** من: هل قوالب البريد ولقطات التقارير المُرسَلة (`report_snapshot.data_json`, `email_queue.body_html`) تطبّق `project()`/الحجب قبل الإرسال؟
- خطر ملموس: API §10 يقول إن `/reports/:id/run` يحجب «بحسب دور الطالب»، لكن البريد المجدول §11 يُرسَل إلى `recipient_group` بلا سياق دور واضح — أي دور/نطاق يُطبَّق على المحتوى المُرسَل؟ غير مُعرَّف. لقطة `report_snapshot` إن حُفظت غير محجوبة ثم أُرسلت = تسريب رواتب/هوامش. **يجب كتابة SPEC-04 ونصّه صراحةً على الحجب في مسار البريد.**

### 4.3 ما هو متّسق (إيجابي)
- `salary`/`cost`/`margin`/`ip` محجوبة اتساقًا: SPEC-01 يوسمها حساسة (§4.5، §14)، RBAC §7 يعرّف الطبقات، API §1.10 يُنفّذها، SPEC-05 §10 يرثها عبر `is_sensitive`. التصدير (`export`) يطبّق الحجب ويُدقَّق في الثلاثة. `password_hash` لا يُعاد أبدًا (متّسق).
- منطق «الحذف لا التصفير» (RBAC §7.3) مقابل «`null` + `_redacted_<field>:true`» (API §1.10) — **اختلاف سلوكي بسيط** (حذف الحقل مقابل تصفيره مع علم)؛ يُنصَح بتوحيده لأن الحذف يخفي وجود القيمة بينما العلم يكشفه.

---

## 5) تناقضات التسمية بين المواصفات (تجميع)

| البند | SPEC-01 (البيانات) | SPEC-02 (RBAC) | SPEC-03 (API) | SPEC-06 (الترحيل) |
|-------|--------------------|-----------------|----------------|--------------------|
| الأعمدة المالية | `*_sar` NUMERIC | — | `*_halalas` INT | `*_halalas` INT |
| مراحل الفرص | `pipeline_stage` | — | `stage` (`/api/stages`) | `stage` |
| سجل الدخول | `user_login_history` | `loginHistory` | `login_history` | `login_history` |
| سجل التدقيق | `audit_log` (+`actor_*`) | `activity` (مورد) | `audit` (مورد) | `audit_log` (+`user_id`) |
| الهيكل الفرعي | `org_unit`+`org_unit_type` | `department/unit/team_org` | `department/unit/team` | `department`(مُولَّد) |
| فريق تنظيمي (مورد) | — | `team_org` | `team` | — |
| كتالوج الصلاحيات | `role_permission` | `role_grant`/`iam_role_grant` | `role_permission` | `iam_role_grant` |
| حساب المستخدم | `app_user` | `iam_user` | `app_user` | `app_user` |
| العضوية | `membership` | `org_membership` | `membership` | `org_membership` |
| الأفعال | `view/edit/import` (أمثلة §4.9) | `read/update` (+`admin`) | `read/update` | — |
| قائد القطاع | `lead_employee_id`→emp | — | `lead_user_id`→user | `lead_user_id`→user |
| كوكي الجلسة | `evc_session` | `evc_session` | `sanad_sid`+`sanad_csrf` | — |
| نوع العميل | `client_type` مُطبَّع | — | `type` enum عربي | `type` نص خام |
| حالة العرض | 7 قيم UPPER | — | 4 قيم lower | — |
| عدد الأدوار | 9 (تعليق) | 16 | 16 | 9 مصدرية→16 |

---

## التوصيات (مرتبة بالأولوية)

1. **حسم وحدة/اسم الأعمدة المالية (C1)** عبر ADR ملزم: اعتماد `*_halalas INTEGER` في SPEC-01، وتحديث كل الـDDL. بلا هذا لا يُكتب `001_init.sql`.
2. **كتابة SPEC-04 (C2)** ونصّه صراحةً على تطبيق `project()`/الحجب على `email_queue.body_html` و`report_snapshot`، وتحديد الدور/النطاق الفعّال للبريد المجدول.
3. **حسم OQ-1/D2 (C3):** إمّا جداول `department/unit/team` صريحة أو توحيد الكل على `org_unit`؛ ثم مزامنة API §4 والترحيل §3.6 مع القرار.
4. **تفعيل بوابتي `value` و`contact` (H1)** في `redact()` قبل الإنتاج، وإضافة اختبار قبول: `viewer` لا يرى `value_halalas`.
5. **إضافة موارد `task`/`timesheet`/`time_entry`/`milestone` إلى RBAC (H2)** بكتالوج §3 وأوراق منح §6.
6. **توحيد التسكين (H3):** حذف `monthly_json`، وجعل الترحيل §3.13 يملأ `allocation_month` (فكّ `monthly{}`).
7. **توحيد نموذج الدور (H4/H5):** اعتماد `user_role` M:N + `scope` على المنح؛ وتعديل API/الترحيل لإسقاط `role_id` المفرد.
8. **جولة تطبيع أسماء (M1–M7, L1–L5):** توحيد `pipeline_stage`/`user_login_history`/`audit_log(actor_*)`/`lead_employee_id`، ومفردات الموارد (`activity` vs `audit`، `team_org` vs `team`) والأفعال (`read/update`)، ومعالجة `client.type` الموحّدة، وحسم تناقضات §3 (practice/client_alias/budget_line/stage_history) بمواءمة SPEC-01 §14 مع SPEC-06.

*نهاية التقرير.*
