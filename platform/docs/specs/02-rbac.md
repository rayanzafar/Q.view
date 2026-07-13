# 02 — نموذج الصلاحيات المؤسسي (RBAC/ABAC) — منصة «سند»

**الحالة:** Draft v1 قابل للتنفيذ · **المالك التقني:** فريق المنصة (Platform) · **يعتمد على:** `docs/02-analysis-report.md` + `platform/seed/legacy-state.snapshot.json` (revision 890)
**المعمارية:** Modular Monolith · Node.js 22 (ESM) · Express 5 · `node:sqlite` (dev) / PostgreSQL (prod) عبر Repository layer · تفويض مُنفَّذ **على الخادم** حصراً.
**المبدأ الحاكم:** *Deny-by-default + Least Privilege*. كل طلب يُرفض ما لم يوجد Grant صريح يطابق `(resource, action)` ويُحقّق النطاق `scope`؛ والحقول الحساسة تُحجب على الخادم عند التسلسل (serialization) لا في المتصفح.

> هذا المستند مصدر الحقيقة الوحيد للتفويض. طبقة العرض (React) لا تُنفّذ أمناً — تُخفي عناصر UI فقط لتجربة أنظف. أي قرار وصول حقيقي يمرّ عبر `can()` و`scopeWhere()` و`project()` الموصوفة أدناه.

---

## 0. الفهرس
1. المفاهيم الأساسية (Principal / Resource / Action / Scope / Grant)
2. نموذج النطاق الهرمي وتحويله إلى شروط استعلام
3. كتالوج الموارد (مطابق لجداول نموذج البيانات)
4. كتالوج الأدوار الستة عشر
5. مصفوفة الصلاحيات التفصيلية (لكل مجموعة موارد)
6. أوراق منح الأدوار (Role Grant Sheets — المصدر القابل للبذر)
7. الحقول الحساسة والحجب على مستوى الحقل خادمياً
8. قواعد النطاق لكل مورد (Query Constraints)
9. سلّم الاعتمادات (Approval Ladder) ودلالة `approve`
10. الدالة المرجعية `can(user, action, resource, target)` + `scopeWhere()` + `project()`
11. معمارية الإنفاذ (Middleware Pipeline) والتدقيق
12. المستخدم الخارجي (external) وقيوده
13. ترحيل الأدوار من «سند» القديمة
14. مصفوفة اختبار القبول
15. قرارات مفتوحة

---

## 1. المفاهيم الأساسية

النموذج هجين **RBAC ثم ABAC**: الدور يمنح `(resource, action)` عند `scope` معيّن؛ ثم يُقيَّد الوصول الفعلي بسمات الهدف (attributes: `sectorId`, `departmentId`, `projectId`, `ownerId`…) عبر تحقّق النطاق.

| المفهوم | التعريف | المصدر |
|--------|---------|--------|
| **Principal** | السياق الأمني للمستخدم المُصادَق: أدواره وعضوياته الهرمية. يُبنى مرة واحدة لكل طلب من قاعدة البيانات (لا من ترويسة العميل). | `iam_user`, `iam_user_role`, `org_membership` |
| **Resource** | نوع كيان يُحمى (`project`, `revenue_line`, `employee`…). سلسلة أحرف صغيرة مفردة قانونية `snake_case`. | كتالوج القسم 3 |
| **Action** | فعل ∈ `{read, create, update, delete, approve, export, admin}`. | القسم 1.1 |
| **Scope** | مدى الوصول ∈ `{company, sector, department, project, team, own}` مرتّب من الأوسع للأضيق. | القسم 2 |
| **Grant** | صف صريح `(role, resource, action, scope, field_policy?)` يمنح فعلاً واحداً على مورد عند نطاق. غيابه = رفض. | `iam_role_grant` |

### 1.1 دلالة الأفعال (Action semantics)

| Action | الدلالة الدقيقة |
|--------|------------------|
| `read` | جلب صف/قائمة. يخضع لحجب الحقول (القسم 7). |
| `create` | إنشاء صف جديد؛ يُتحقَّق من أن سمات الصف المقترح تقع داخل النطاق الممنوح، ومن أن الحقول الحساسة في الحمولة مسموح كتابتها. |
| `update` | تعديل صف قائم؛ يُتحقَّق النطاق على **الصف الحالي**، والحقول الحساسة في الحمولة عبر سياسة الحقل للكتابة. |
| `delete` | حذف. القاعدة: الحذف **منطقي** (`active=false` / `deletedAt`) افتراضياً؛ الحذف الفعلي = `admin` فقط. |
| `approve` | اتخاذ قرار في محرك سير العمل (اعتماد/رفض) على `approval_request`. مقيَّد إضافياً بسقف مالي (القسم 9). |
| `export` | تصدير مجمّع (Excel/CSV/تقرير). يُعامل كـ`read` واسع + قيد إضافي: التصدير يُدقَّق دوماً، ويطبّق حجب الحقول على كل صف مُصدَّر. |
| `admin` | إدارة تهيئة نوع المورد نفسه (تعريف القطاعات، إسناد الأدوار، تهيئة سير العمل، إعدادات المساعد الذكي). ليست superset تلقائياً — تُمنح صراحةً. |

**قاعدة صارمة:** لا يوجد فعل `*` (wildcard). دور `admin` يحصل على كل الأفعال عبر منح صريحة مولّدة، لا عبر تجاوز الفحص.

---

## 2. نموذج النطاق الهرمي (Scope)

النموذج التنظيمي المرن (غير Hard-coded): `Company → Sector → Department → Unit → Team → Position → Employee`. النطاقات مشتقّة منه مع نطاقين عرضيّين للتنفيذ (`project`, `own`).

الترتيب من الأوسع إلى الأضيق (Rank):

```
company (6) ⊃ sector (5) ⊃ department (4) ⊃ project (3*) ≈ team (2*) ⊃ own (1)
```

> `project` و`team` نطاقان *عرضيّان* (cross-cutting): «فرق المشاريع/الفرص/البرامج/لجان الاعتماد» منفصلة عن الهيكل التنظيمي (كما يقتضي التصميم). لذلك عضوية المشروع/الفريق تأتي من جداول عضوية مستقلة، لا من `department`.

### 2.1 دلالة كل نطاق (Containment predicate)

لكل نطاق دالة `holds(principal, resource, target) → bool`:

| Scope | يتحقّق عندما | الحقل المرجعي على الهدف |
|-------|--------------|--------------------------|
| `company` | دائماً `true` | — |
| `sector` | `target.sectorId ∈ principal.sectorIds` | `sectorId` (موجود على كل كيان تجاري/تشغيلي) |
| `department` | `target.departmentId ∈ principal.departmentIds` | `departmentId` (جديد؛ في القديم كان نصاً حراً `team.dept`) |
| `project` | `target.projectId ∈ principal.projectIds` أو (`resource=project` و `target.id ∈ principal.projectIds`) | `projectId` / `id` |
| `team` | `target.teamId ∈ principal.teamIds` أو الهدف موظف/تسكين ينتمي لفريق ∈ `teamIds` | `teamId` / عبر `personId→employee.teamId` |
| `own` | الهدف يخصّ المستخدم شخصياً (مالك/موضوع/منشئ) | `ownerId==userId` ∨ `personId==employeeId` ∨ `userId==userId` ∨ (`resource=user|employee` و `id==self`) |

**احتواء تلقائي:** لأن كل صف يحمل `sectorId` (وقريباً `departmentId`)، فإن منحاً عند `sector` يشمل تلقائياً عناصر `own`/`team`/`project`/`department` داخل نفس القطاع — لا حاجة لمنح متعدد. الأضيق يُمنح فقط حين نريد تقييداً فعلياً (مثل consultant عند `project`+`own`).

### 2.2 بناء الـPrincipal (مرة واحدة لكل طلب)

```js
// يُبنى بعد المصادقة، من قاعدة البيانات فقط — لا يُقرأ أي شيء من العميل.
principal = {
  userId:            'u_rayan_zafar',
  employeeId:        'e_rayan_zafar',      // ربط user↔employee (قد يكون null لحساب نظامي)
  roles:             ['sector_lead'],       // من iam_user_role
  sectorIds:         ['SOLUTIONS'],         // من org_membership (نوع=sector) — قد يكون متعدداً
  departmentIds:     ['dep_ai_data'],       // من org_membership (نوع=department)
  teamIds:           ['team_ai'],           // org + project teams
  projectIds:        ['p_1','p_7'],         // عضوية فرق المشاريع (أي دور)
  managedProjectIds: ['p_1'],               // مجموعة فرعية: مدير/PM للمشروع
  isExternal:        false,
  externalShareIds:  []                     // للـexternal فقط: معرّفات مشاركة صريحة
}
```

عضويات متعددة مدعومة (مستخدم في قطاعين، أو PM لعدة مشاريع). `sectorIds`/`departmentIds` مصفوفات دائماً.

---

## 3. كتالوج الموارد

مطابق لجداول نموذج البيانات (القديم في اللقطة + كيانات To-Be المفقودة). كل مورد له مفتاح `resource` قانوني.

### 3.1 الهيكل التنظيمي (Org)
| resource | يقابل | ملاحظة |
|----------|-------|--------|
| `company` | إعداد المؤسسة الجذر | كيان واحد |
| `sector` | `sectors[]` | `targetSalesSar/targetRevenueSar/targetGrossMarginPct` = حقول مالية حساسة |
| `department` | جديد (كان `team.dept` نصاً) | كيان صريح تحت القطاع |
| `unit` | جديد | تحت الإدارة |
| `team_org` | جديد | فريق تنظيمي (يُفصل عن فرق المشاريع) |
| `position` | جديد | مسمّى وظيفي |
| `employee` | `team[]` | يحمل **`salarySar`** (أعلى حساسية) |

### 3.2 الهوية والوصول (IAM)
| resource | يقابل | ملاحظة |
|----------|-------|--------|
| `user` | `users[]` | يحمل **`loginHistory[].ip`**, `failedAttempts`, `lockedUntil` |
| `role` | `SANAD_ROLES` | تعريف الأدوار |
| `role_grant` | جديد (`iam_role_grant`) | منح الصلاحيات — تهيئتها = `admin` فقط |
| `membership` | جديد (`org_membership`) | عضوية المستخدم في قطاع/إدارة/فريق |
| `directory` | `directory[]` | دليل هوية خفيف |
| `session` | جلسات الدخول | كوكي `evc_session` |
| `ai_config` | `/api/ai/config` | تهيئة المساعد الذكي |

### 3.3 التجاري والتشغيلي (Commercial / Delivery)
| resource | يقابل | حقول حساسة |
|----------|-------|-----------|
| `client` | `clients[]` | contact PII |
| `supplier` | `suppliers[]` | `email/phone/contactPerson` (PII) |
| `service` | `services[]` | `packages[].costSar` (تكلفة) |
| `opportunity` | `opportunities[]` | **`valueSar`** (قيمة تجارية) |
| `project` | `projects[]` | **`budgetSar/actualSpendSar/profitSar/marginPct/contractValueSar/poValueSar`** |
| `deliverable` | `deliverables[]` | `amountSar/invoicedSar` (مالي) |
| `allocation` | `allocations[]` | ربط شخص×مشروع (يكشف تسكين الأفراد) |

### 3.4 المالية والتعاقد (Financial — بعضها To-Be)
| resource | يقابل | حقول حساسة |
|----------|-------|-----------|
| `revenue_line` | `revenueLines[]` | **`amountSar`** |
| `cost_line` | `costLines[]` | **`amountSar`** (تكلفة، منها الرواتب) |
| `contract` | To-Be | `contractValueSar`, دفعات |
| `invoice` | To-Be | مبالغ |
| `payment` | To-Be | مبالغ/تحصيل |
| `purchase_order` | To-Be | `poValueSar`, تكلفة المورّد |
| `budget` | `budget{}` + `sector` targets | مستهدفات/هوامش/افتراضات تكلفة |

### 3.5 الحوكمة والنظام (Governance / System)
| resource | يقابل | ملاحظة |
|----------|-------|--------|
| `approval_request` | To-Be | كيان سير العمل — محور `approve` |
| `document` | `attachments[]` To-Be | وثائق/مرفقات |
| `activity` | `activity[]` | سجل التدقيق (read-only، لا يُعدَّل أبداً) |
| `data_quality` | وحدة الجودة | مشكلات مصنّفة |
| `import_export` | وحدة `data` | استيراد/تصدير |
| `report` | لوحات/تقارير | مجمّعات للقراءة |
| `notification` | To-Be | تنبيهات |
| `settings` | `meta{}` | إعدادات المؤسسة |

---

## 4. كتالوج الأدوار الستة عشر

| # | role (code) | الاسم العربي | النطاق الأساسي | نقطة الهبوط | الغرض (least privilege) |
|---|-------------|--------------|----------------|-------------|--------------------------|
| 1 | `admin` | مدير النظام | `company` | `users` | إدارة تقنية كاملة (نظام/هوية/تهيئة). وصول break-glass للحقول الحساسة **مع تدقيق إلزامي**. |
| 2 | `ceo_office` | مكتب الرئيس التنفيذي | `company` | `ceo` | رؤية شركة كاملة (قراءة/تصدير) + اعتماد أعلى سلّم. **لا** إدارة هوية، **لا** رواتب أفراد. |
| 3 | `sector_lead` | قائد قطاع | `sector` | `dashboard` | إدارة كاملة داخل قطاعه (تجاري/مشاريع/إيراد/موازنة) + اعتماد ضمن سقف القطاع. |
| 4 | `department_manager` | مدير إدارة | `department` | `followup` | إدارة مشاريع/تسكين/موظفي إدارته + اعتماد ضمن سقف الإدارة. |
| 5 | `line_manager` | مدير مباشر | `team` | `followup` | إدارة فريقه المباشر: تسكين فريقه، اعتماد طلبات مرؤوسيه (own/team). ضيّق. |
| 6 | `project_manager` | مدير مشروع | `project` | `projects` | إدارة المشاريع المُسنَدة إليه فقط (`managedProjectIds`): مخرجات/تسكين/تكلفة/إيراد المشروع. |
| 7 | `bd_manager` | مدير تطوير أعمال | `sector` | `pipeline` | الفرص/العملاء/الخدمات ضمن قطاعه. **لا** مشاريع/تسكين/إيراد. يرى القيمة لا الهامش/التكلفة. |
| 8 | `finance` | المالية | `company` (مالي) | `revenue` | الإيراد/التكلفة/الفواتير/الدفعات/الموازنة + اعتماد مالي. يرى التكلفة/الهامش/الرواتب (كلفة). |
| 9 | `procurement` | المشتريات | `sector`/`company` | `services` | الموردون/أوامر الشراء/تكلفة الباقات + اعتماد PO ضمن سقف. يرى تكلفة الموردين لا الرواتب. |
| 10 | `hr` | الموارد البشرية | `company` (HR) | `team` | الموظفون/الوظائف/الإدارات/الرواتب + طلبات HR. **لا** يرى IP/أمن الحسابات. |
| 11 | `operations` | العمليات | `company` (تشغيلي) | `portfolio` | تنسيق التنفيذ عبر القطاعات: مشاريع/تسكين/مخرجات (read/update). يرى التكلفة لا الهامش لا الرواتب. |
| 12 | `consultant` | استشاري | `project`+`own` | `followup` | يرى ويحدّث مخرجاته ضمن مشاريعه المُسنَدة، يرى تسكينه وملفه ذاتياً. **لا** ماليات غيره. |
| 13 | `employee` | موظف | `own` | `followup` | ملفه الشخصي، تسكينه، راتبه (own)، الدليل، الوثائق المنشورة. الأضيق. |
| 14 | `approver` | معتمِد | حسب التوجيه | `followup` | دور وظيفي عرضي: قراءة الطلبات المُوجَّهة إليه + `approve` ضمن نطاق/سقف التوجيه فقط. |
| 15 | `viewer` | مشاهد | `sector`/`company` (مُسنَد) | `dashboard` | قراءة فقط ضمن نطاق مُسنَد. **بلا** حقول حساسة (رواتب/تكلفة/هامش/IP). |
| 16 | `external` | مستخدم خارجي | `own` (مشاركات صريحة) | بوابة خارجية | شريك/عميل/مورّد: يرى فقط ما شورك معه صراحةً. عزل تام عن الداخل. |

**تعدّد الأدوار:** المستخدم قد يحمل أكثر من دور (مثال: `sector_lead` + `approver`). الصلاحية = **اتحاد** منح كل أدواره. النطاق الأوسع بين المنح المتطابقة هو الفعّال.

---

## 5. مصفوفة الصلاحيات التفصيلية

**مفتاح الأكواد:** `R`=read · `C`=create · `U`=update · `D`=delete · `A`=approve · `X`=export · `M`=admin. اللاحقة = النطاق: `/co`=company · `/sec`=sector · `/dep`=department · `/prj`=project · `/tm`=team · `/own`=own. **خلية فارغة = رفض (deny-by-default).** أي دور غير مذكور في مجموعة = لا وصول إطلاقاً.

### 5.1 مجموعة الهيكل التنظيمي (Org)

| resource | admin | ceo_office | hr | sector_lead | dept_manager | line_manager | employee |
|----------|-------|-----------|----|-------------|--------------|--------------|----------|
| `company` | `RUM/co` | `R/co` | | | | | |
| `sector` | `RCUD·M/co` | `R/co` | | `RU/sec` | | | |
| `department` | `RCUD/co` | `R/co` | `RCUD/co` | `RU/sec` | `RU/dep` | `R/dep` | `R/own` |
| `unit` | `RCUD/co` | `R/co` | `RCUD/co` | `RU/sec` | `RCU/dep` | `R/tm` | `R/own` |
| `team_org` | `RCUD/co` | `R/co` | `RCUD/co` | `RU/sec` | `RCU/dep` | `RU/tm` | `R/own` |
| `position` | `RCUD/co` | `R/co` | `RCUD/co` | `R/sec` | `R/dep` | `R/tm` | `R/own` |
| `employee` | `RCUD/co` | `R/co`※ | `RCUD/co` | `R/sec`※ | `RU/dep`※ | `R/tm`※ | `R/own` |

※ حقل `salarySar` محجوب لكل هذه الأدوار عدا `admin`,`hr`,`finance` وصاحب الملف (`own`) — انظر القسم 7.

### 5.2 مجموعة الهوية والوصول (IAM)

| resource | admin | hr | (self / أي مستخدم) |
|----------|-------|----|--------------------|
| `user` | `RCUD·M/co`※IP | `RCU/co` (بلا رفع دور، بلا حقول أمن) | `R·U/own` (ملفه: الاسم/البريد/كلمة المرور الذاتية فقط) |
| `role` | `R·M/co` | `R/co` | `R/own` (يرى أدواره) |
| `role_grant` | `R·M/co` | | |
| `membership` | `RCUD/co` | `RCUD/co` | `R/own` |
| `directory` | `RCUD/co` | `RCU/co` | `R/co` (قراءة الدليل متاحة للجميع الداخليين) |
| `session` | `RD/co` (إنهاء جلسات) | | `RD/own` (إنهاء جلساته) |
| `ai_config` | `R·M/co` | | |

※ `loginHistory[].ip/userAgent`, `failedAttempts`, `lockedUntil` = `admin` فقط (أو `own` لسجلّه الشخصي). **hr لا يرى أمن الحسابات.** قواعد النظام: لا يستطيع أحد رفع دوره أو تعطيل حسابه ذاتياً؛ رفع دور/منح `admin` = `admin` فقط (إنفاذ خادمي).

### 5.3 مجموعة التجاري والتشغيلي (Commercial / Delivery)

| resource | admin | ceo_office | sector_lead | dept_manager | bd_manager | project_manager | operations | consultant | viewer |
|----------|-------|-----------|-------------|--------------|-----------|-----------------|-----------|-----------|--------|
| `client` | `RCUD/co` | `R/co` | `RCUD/sec` | `R/dep` | `RCUD/sec` | `R/prj` | `R/co` | `R/prj` | `R/sec` |
| `supplier` | `RCUD/co` | `R/co` | `RU/sec` | `R/dep` | `RU/sec` | `R/prj` | `R/co` | | `R/sec` |
| `service` | `RCUD/co` | `R/co` | `RCUD/sec` | `R/dep` | `RCUD/sec` | `R/prj` | `R/co` | `R/sec` | `R/sec` |
| `opportunity` | `RCUD·X/co` | `RX/co` | `RCUD·X/sec` | `R/dep` | `RCUD·X/sec` | `R/prj` | `R/co` | | `R/sec`§ |
| `project` | `RCUD·X/co` | `RX/co` | `RCUD·X/sec` | `RCU·X/dep` | `R/sec` | `RU·X/prj` | `RU·X/co` | `R/prj` | `R/sec`§ |
| `deliverable` | `RCUD/co` | `R/co` | `RCUD/sec` | `RCU/dep` | | `RCU·A/prj` | `RU/co` | `RU/prj·own` | `R/sec` |
| `allocation` | `RCUD/co` | `R/co` | `RCUD/sec` | `RCUD/dep` | | `RCUD/prj` | `RCUD/co` | `R/own` | `R/sec` |

§ للـ`viewer`: القيمة التجارية `valueSar/contractValueSar/poValueSar` وكل حقول التكلفة/الهامش محجوبة (القسم 7). `deliverable` لـ`consultant` مقيّد بمخرجات مُسنَدة إليه أو ضمن مشاريعه.

### 5.4 مجموعة المالية والتعاقد (Financial)

| resource | admin | ceo_office | finance | procurement | sector_lead | dept_manager | project_manager | operations |
|----------|-------|-----------|---------|-------------|-------------|--------------|-----------------|-----------|
| `revenue_line` | `RCUD·X/co` | `RX/co` | `RCUD·A·X/co` | | `RU·X/sec` | `R/dep` | `R/prj` | `R/co` |
| `cost_line` | `RCUD·X/co` | `RX/co` | `RCUD·A·X/co` | `R/co` | `RU·X/sec` | `R/dep` | `RU/prj` | `R/co` |
| `contract` | `RCUD/co` | `R/co` | `RCU·A·X/co` | `R/co` | `RU/sec` | `R/dep` | `R/prj` | `R/co` |
| `invoice` | `RCUD/co` | `R/co` | `RCUD·A·X/co` | | `R/sec` | `R/dep` | `R/prj` | |
| `payment` | `RCUD/co` | `R/co` | `RCUD·A·X/co` | | `R/sec` | | `R/prj` | |
| `purchase_order` | `RCUD/co` | `R/co` | `R·A/co` | `RCUD·A·X/co` | `R/sec` | `R/dep` | `RC/prj` | `R/co` |
| `budget` | `RCUD/co` | `R·A/co` | `RCU·A·X/co` | | `RCU·A/sec` | `R/dep` | | `R/co` |

`finance` هو المالك المالي (يرى التكلفة/الهامش/الرواتب-ككلفة). `procurement` يرى تكلفة المورّدين/PO لا الرواتب ولا هامش المشروع. اعتماد `approve` مقيّد بالسقف (القسم 9).

### 5.5 مجموعة الحوكمة والنظام (Governance / System)

| resource | admin | ceo_office | approver | finance | sector_lead | hr | data owner/كلّ داخلي |
|----------|-------|-----------|----------|---------|-------------|----|----------------------|
| `approval_request` | `R·A·M/co` | `R·A/co` | `R·A/(routed)` | `R·A/co` | `R·A/sec` | `R·A/dep` | `RC/own` (إنشاء طلب على عمله) |
| `document` | `RCUD/co` | `R/co` | `R/(routed)` | `R/co` | `RCUD/sec` | `RCUD/co` | `RCU/own·prj` |
| `activity` (تدقيق) | `RX/co` | `RX/co` | | `R/co` | `R/sec` | `R/dep` | `R/own` (نشاطه فقط) |
| `data_quality` | `RU/co` | `R/co` | | `R/co` | `RU/sec` | | `R/sec` (قراءة) |
| `import_export` | `M/co` | | | `M/co`(مالي) | `M/sec` | `M/co`(HR) | `X/own·scope` (تصدير ما يراه) |
| `report` | `RX/co` | `RX/co` | | `RX/co` | `RX/sec` | `RX/dep` | `R/scope` |
| `notification` | `RCUD/co` | `R/own` | `R/own` | `R/own` | `R/own` | `R/own` | `R/own` |
| `settings` | `RU·M/co` | `R/co` | | `R/co` | `R/sec` | `R/co` | |

`activity` مورد **للقراءة فقط بنيوياً**: لا `create/update/delete` لأي دور (يُكتب بواسطة طبقة التدقيق فقط، القسم 11). `import` كتابي وحسّاس → يقتصر على مالكي البيانات ضمن نطاقهم؛ **الاستيراد لا يتجاوز فحص النطاق** (لا يستطيع sector_lead استيراد بيانات قطاع آخر).

> الأدوار `line_manager, consultant, employee, viewer, external` غير مذكورة في مجموعة المالية/الحوكمة = **لا وصول** (عدا `approval_request` و`document/own` و`notification/own` و`report/scope` المشتركة، و`external` المعزول في القسم 12).

---

## 6. أوراق منح الأدوار (Role Grant Sheets)

المصدر القابل للبذر مباشرةً في `iam_role_grant` (كل سطر = صف). الصيغة: `resource: actions @scope [field_policy]`. هذه أوراق **مُطبَّعة** (النطاق الأوسع فقط؛ الأضيق مُحتوى تلقائياً).

```yaml
# ============ 1) admin ============ (break-glass, كل قراءة حساسة تُدقَّق)
admin:
  '*catalog*': generate  # يولَّد صراحةً: كل (resource × action) @company عدا القيود البنيوية
  # قيود بنيوية تبقى: activity=read/export فقط ; salary read => audited
  # role_grant, role, ai_config, settings: admin @company

# ============ 2) ceo_office ============
ceo_office:
  sector: read @company
  department: read @company
  employee: read @company        # salary محجوب (policy: PAYROLL)
  client: read @company
  supplier: read @company
  service: read @company
  opportunity: [read, export] @company
  project: [read, export] @company
  deliverable: read @company
  allocation: read @company
  revenue_line: [read, export] @company
  cost_line: [read, export] @company
  contract: read @company
  invoice: read @company
  payment: read @company
  purchase_order: read @company
  budget: [read, approve] @company        # اعتماد أعلى السلّم
  approval_request: [read, approve] @company
  document: read @company
  activity: [read, export] @company
  report: [read, export] @company

# ============ 3) sector_lead ============
sector_lead:
  sector: [read, update] @sector
  department: [read, update] @sector
  employee: read @sector                  # salary محجوب
  client: [read, create, update, delete] @sector
  supplier: [read, update] @sector
  service: [read, create, update, delete] @sector
  opportunity: [read, create, update, delete, export] @sector
  project: [read, create, update, delete, export] @sector
  deliverable: [read, create, update, delete] @sector
  allocation: [read, create, update, delete] @sector
  revenue_line: [read, update, export] @sector
  cost_line: [read, update, export] @sector
  contract: [read, update] @sector
  budget: [read, create, update, approve] @sector
  approval_request: [read, approve] @sector   # ضمن سقف القطاع
  document: [read, create, update, delete] @sector
  data_quality: [read, update] @sector
  import_export: admin @sector
  report: [read, export] @sector
  activity: read @sector

# ============ 4) department_manager ============
department_manager:
  department: [read, update] @department
  unit: [read, create, update] @department
  team_org: [read, create, update] @department
  employee: [read, update] @department     # salary محجوب
  project: [read, create, update, export] @department
  deliverable: [read, create, update] @department
  allocation: [read, create, update, delete] @department
  cost_line: read @department
  budget: read @department
  approval_request: [read, approve] @department   # ضمن سقف الإدارة
  document: [read, create, update] @department
  report: [read, export] @department
  activity: read @department

# ============ 5) line_manager ============
line_manager:
  team_org: [read, update] @team
  employee: read @team                     # salary محجوب
  allocation: [read, create, update] @team
  project: read @team                      # margin/cost محجوب
  deliverable: read @team
  approval_request: [read, approve] @team  # طلبات مرؤوسيه (own/team) ضمن سقف مبدئي
  document: [read, create] @team
  report: read @team

# ============ 6) project_manager ============
project_manager:
  project: [read, update, export] @project      # فقط managedProjectIds
  deliverable: [read, create, update, approve] @project
  allocation: [read, create, update, delete] @project
  cost_line: [read, update] @project
  revenue_line: read @project
  purchase_order: [read, create] @project
  approval_request: [read, approve] @project     # اعتماد مخرجات ضمن سقف PM
  document: [read, create, update] @project
  client: read @project
  supplier: read @project
  report: read @project

# ============ 7) bd_manager ============
bd_manager:
  opportunity: [read, create, update, delete, export] @sector   # valueSar مرئي
  client: [read, create, update, delete] @sector
  supplier: [read, update] @sector
  service: [read, create, update, delete] @sector
  project: read @sector                    # margin/cost محجوب
  report: read @sector
  activity: read @sector

# ============ 8) finance ============
finance:
  revenue_line: [read, create, update, delete, approve, export] @company
  cost_line: [read, create, update, delete, approve, export] @company
  contract: [read, create, update, approve, export] @company
  invoice: [read, create, update, delete, approve, export] @company
  payment: [read, create, update, delete, approve, export] @company
  purchase_order: [read, approve] @company
  budget: [read, create, update, approve, export] @company
  project: [read, export] @company          # margin/cost مرئي
  deliverable: read @company
  employee: read @company                   # salary مرئي (ككلفة رواتب)
  client: read @company
  supplier: read @company
  approval_request: [read, approve] @company  # اعتماد مالي ضمن سقف المالية
  report: [read, export] @company
  import_export: admin @company             # مالي فقط
  activity: read @company

# ============ 9) procurement ============
procurement:
  supplier: [read, create, update, delete] @company
  purchase_order: [read, create, update, delete, approve, export] @company
  service: [read, update] @company          # packages.costSar مرئي
  contract: read @company                   # عقود الموردين
  project: read @company                    # margin محجوب ; cost مرئي
  approval_request: [read, approve] @company  # اعتماد PO ضمن سقف المشتريات
  document: [read, create] @company
  report: [read, export] @company

# ============ 10) hr ============
hr:
  department: [read, create, update, delete] @company
  unit: [read, create, update, delete] @company
  team_org: [read, create, update, delete] @company
  position: [read, create, update, delete] @company
  employee: [read, create, update, delete] @company   # salary مرئي + قابل للكتابة
  membership: [read, create, update, delete] @company
  user: [read, create, update] @company     # بلا رفع دور، بلا حقول أمن (IP)
  directory: [read, create, update] @company
  approval_request: [read, approve] @department  # طلبات HR
  document: [read, create, update, delete] @company
  report: [read, export] @department
  import_export: admin @company             # HR فقط

# ============ 11) operations ============
operations:
  project: [read, update, export] @company   # margin محجوب ; cost مرئي
  deliverable: [read, update] @company
  allocation: [read, create, update, delete] @company
  client: read @company
  supplier: read @company
  cost_line: read @company
  revenue_line: read @company
  document: [read, create] @company
  report: [read, export] @company
  activity: read @company

# ============ 12) consultant ============
consultant:
  project: read @project                     # margin/cost/value محجوب
  deliverable: [read, update] @project       # + own
  allocation: read @own
  employee: read @own                        # salary/own مرئي لنفسه فقط
  service: read @sector
  client: read @project
  approval_request: [read, create] @own      # يرفع طلبات على عمله
  document: [read, create, update] @project
  report: read @project

# ============ 13) employee ============
employee:
  employee: [read, update] @own              # ملفه ; salary/own مرئي
  allocation: read @own
  user: [read, update] @own                  # اسم/بريد/كلمة مرور ذاتية
  directory: read @company
  department: read @own
  approval_request: [read, create] @own
  document: read @own                        # + منشورة/prj
  notification: read @own
  report: read @own

# ============ 14) approver ============ (يُركَّب فوق دور آخر عادةً)
approver:
  approval_request: [read, approve] @routed  # النطاق = توجيه الطلب (departmentId/sectorId/limit)
  document: read @routed                     # الوثائق المرفقة بالطلب المُوجَّه
  # لا وصول لأي مورد آخر عبر هذا الدور — القراءة تقتصر على محتوى الطلب المُوجَّه

# ============ 15) viewer ============
viewer:
  # كل الحقول الحساسة محجوبة (PAYROLL/COST/MARGIN/VALUE/SECURITY_PII)
  sector: read @sector
  department: read @sector
  opportunity: read @sector                  # valueSar محجوب
  project: read @sector                      # كل الماليات محجوبة (عدّاد/حالة/تقدّم فقط)
  deliverable: read @sector                  # amountSar محجوب
  client: read @sector
  service: read @sector
  report: read @sector
  activity: read @sector                     # بلا حقول IP

# ============ 16) external ============ (معزول — القسم 12)
external:
  document: read @share                      # فقط externalShareIds
  approval_request: [read, approve] @share   # اعتماد عميل/مورّد على بند شورك معه
  invoice: read @share                       # فاتورته هو فقط (إن أُتيح)
  # لا أي مورد داخلي. لا قوائم. لا قطاعات. لا ماليات داخلية.
```

`@routed` و`@share` نطاقان خاصّان: يُحلَّان من جدول توجيه/مشاركة صريح لا من عضوية القطاع (القسمان 9 و12).

---

## 7. الحقول الحساسة والحجب على مستوى الحقل خادمياً

الحجب يتم في **طبقة التسلسل** (serialization) قبل إرسال أي استجابة: لكل صف، تُطبَّق `project(principal, resource, row)` فتُحذف (لا تُصفَّر) الحقول التي لا يجوز قراءتها. الحذف (omission) مفضّل على التصفير لتفادي كشف *وجود* القيمة. الكتابة تُفلتَر بالمثل: حقول الحمولة الممنوعة تُسقَط قبل الكتابة (مع تسجيل محاولة).

### 7.1 تصنيفات الحساسية (Classifications)

| التصنيف | الحقول (resource.field) | من يقرأ (read) | من يكتب (write) |
|---------|--------------------------|----------------|-----------------|
| **PAYROLL** (رواتب) | `employee.salarySar` · `cost_line.amountSar` حين `type∈{رواتب,payroll}` | `admin`✦ · `hr` · `finance` · صاحب الملف (`own`) | `admin`✦ · `hr` · `finance` |
| **COST** (تكلفة) | `cost_line.amountSar` · `project.actualSpendSar` · `project.budgetSar` · `service.packages[].costSar` · `purchase_order.costSar` | `admin` · `ceo_office` · `finance` · `procurement` · `operations` · `sector_lead`@sec · `department_manager`@dep · `project_manager`@own-prj | `admin` · `finance` · `procurement`(موردين) · `sector_lead`@sec · `project_manager`@own-prj |
| **MARGIN** (هامش/ربح) | `project.marginPct` · `project.profitSar` · `sector.targetGrossMarginPct` · `budget.targetGrossMarginPct` · `budget.costAssumptions` | `admin` · `ceo_office` · `finance` · `sector_lead`@sec · `department_manager`@dep · `project_manager`@own-prj | `admin` · `finance` · `sector_lead`@sec |
| **VALUE** (قيمة تجارية) | `opportunity.valueSar` · `project.contractValueSar` · `project.poValueSar` · `project.revenueSar/revenueSarAllYears` · `revenue_line.amountSar` · `deliverable.amountSar/invoicedSar` · `contract/invoice/payment.*Sar` | `admin` · `ceo_office` · `finance` · `sector_lead`@sec · `department_manager`@dep · `bd_manager`@sec(فرص) · `project_manager`@own-prj · `procurement`(PO) · `operations` | حسب منح المورد + النطاق |
| **SECURITY_PII** (أمن/IP) | `user.loginHistory[].ip` · `user.loginHistory[].userAgent` · `user.failedAttempts` · `user.lockedUntil` | `admin` · صاحب الحساب (`own`) | `admin` (نظامياً فقط) |
| **CONTACT_PII** (تواصل) | `supplier.email/phone/contactPerson` · `client.contact*` · `user.email` · `employee` تواصل | من يملك منح إدارة على المورد ضمن نطاقه · `admin`·`ceo_office`·`hr`·`finance` | مالكو المورد ضمن النطاق |

✦ = وصول break-glass لـ`admin`: مسموح لكن **كل قراءة/تصدير لحقل PAYROLL بواسطة admin تُسجَّل في `activity`** بـ`kind='sensitive-read'` مع الحقل والصف والمستخدم. يُوصى مستقبلاً بفصل `security_admin` (نظام بلا بيانات أعمال) عن `hr` (بيانات بلا نظام) — قرار مفتوح OQ-3.

### 7.2 مصفوفة الرؤية النهائية للحقول الحساسة (Read)

`Y`=يرى · `own`=لملفه فقط · `sec/dep/prj`=ضمن نطاقه · فارغ=محجوب.

| Class | admin | ceo_office | finance | hr | procurement | operations | sector_lead | dept_mgr | pm | bd_manager | line_mgr | consultant | employee | viewer | external |
|-------|-------|-----------|---------|----|-------------|-----------|-------------|----------|----|-----------|----------|-----------|----------|--------|----------|
| PAYROLL | Y✦ | | Y | Y | | | | | | | | own | own | | |
| COST | Y | Y | Y | | Y | Y | sec | dep | prj | | | | | | |
| MARGIN | Y | Y | Y | | | | sec | dep | prj | | | | | | |
| VALUE | Y | Y | Y | | PO | Y | sec | dep | prj | sec※ | | | | | share |
| SECURITY_PII | Y | | | | | | | | | | | | own | | |
| CONTACT_PII | Y | Y | Y | Y | Y | Y | sec | dep | prj | sec | | prj | own | | |

※ `bd_manager` يرى VALUE للفرص/العملاء فقط (`opportunity.valueSar`)، لا هامش/تكلفة المشروع.

### 7.3 التنفيذ الخادمي للحجب (Field policy)

```js
// resource → field → classification  (خريطة تهيئة data-driven)
const FIELD_CLASS = {
  employee:      { salarySar: 'PAYROLL' },
  cost_line:     { amountSar: (row) => /رواتب|payroll/i.test(row.type||'') ? 'PAYROLL' : 'COST' },
  project:       { actualSpendSar:'COST', budgetSar:'COST',
                   marginPct:'MARGIN', profitSar:'MARGIN',
                   contractValueSar:'VALUE', poValueSar:'VALUE',
                   revenueSar:'VALUE', revenueSarAllYears:'VALUE' },
  opportunity:   { valueSar:'VALUE' },
  revenue_line:  { amountSar:'VALUE' },
  deliverable:   { amountSar:'VALUE', invoicedSar:'VALUE' },
  service:       { 'packages[].costSar':'COST' },
  sector:        { targetGrossMarginPct:'MARGIN' },
  budget:        { targetGrossMarginPct:'MARGIN', costAssumptions:'MARGIN' },
  user:          { 'loginHistory[].ip':'SECURITY_PII',
                   'loginHistory[].userAgent':'SECURITY_PII',
                   failedAttempts:'SECURITY_PII', lockedUntil:'SECURITY_PII',
                   email:'CONTACT_PII' },
  supplier:      { email:'CONTACT_PII', phone:'CONTACT_PII', contactPerson:'CONTACT_PII' },
};

// هل يقرأ المستخدم هذا التصنيف على هذا الصف؟
function canReadClass(principal, cls, resource, row) {
  const has = (r) => principal.roles.includes(r);
  const inSec = row.sectorId && principal.sectorIds.includes(row.sectorId);
  const inDep = row.departmentId && principal.departmentIds.includes(row.departmentId);
  const ownPrj = row.projectId && principal.managedProjectIds.includes(row.projectId)
              || (resource==='project' && principal.managedProjectIds.includes(row.id));
  const isOwn = ownerMatch(principal, resource, row);
  switch (cls) {
    case 'PAYROLL':
      return has('admin') || has('hr') || has('finance') || isOwn;
    case 'COST':
      return has('admin')||has('ceo_office')||has('finance')||has('procurement')||has('operations')
          || (has('sector_lead')&&inSec) || (has('department_manager')&&inDep) || (has('project_manager')&&ownPrj);
    case 'MARGIN':
      return has('admin')||has('ceo_office')||has('finance')
          || (has('sector_lead')&&inSec) || (has('department_manager')&&inDep) || (has('project_manager')&&ownPrj);
    case 'VALUE':
      return has('admin')||has('ceo_office')||has('finance')||has('operations')
          || (has('sector_lead')&&inSec) || (has('department_manager')&&inDep)
          || (has('bd_manager')&&inSec) || (has('project_manager')&&ownPrj) || (has('procurement'));
    case 'SECURITY_PII':
      return has('admin') || (resource==='user' && row.id===principal.userId);
    case 'CONTACT_PII':
      return has('admin')||has('ceo_office')||has('finance')||has('hr')||has('procurement')||has('operations')
          || (has('sector_lead')&&inSec) || (has('department_manager')&&inDep)
          || (has('bd_manager')&&inSec) || (has('project_manager')&&ownPrj) || isOwn;
    default: return true; // حقل غير مصنّف = عام
  }
}

// حجب صف واحد قبل التسلسل
function project(principal, resource, row) {
  const map = FIELD_CLASS[resource] || {};
  const out = { ...row };
  for (const [field, clsDef] of Object.entries(map)) {
    const cls = typeof clsDef === 'function' ? clsDef(row) : clsDef;
    if (field.includes('[].')) {                       // حقل داخل مصفوفة متداخلة
      const [arr, sub] = field.split('[].');
      if (Array.isArray(out[arr]) && !canReadClass(principal, cls, resource, row))
        out[arr] = out[arr].map(el => { const c={...el}; delete c[sub]; return c; });
    } else if (!canReadClass(principal, cls, resource, row)) {
      delete out[field];                               // حذف لا تصفير
      if (cls === 'PAYROLL' && principal.roles.includes('admin')) {} // (admin يرى؛ لن يصل هنا)
    }
  }
  if (principal.roles.includes('admin')) auditSensitiveRead(principal, resource, row); // break-glass
  return out;
}
```

### 7.4 حجب على مستوى الكتابة (Write filtering)

```js
// يُسقط أي حقل حساس لا يملك المستخدم كتابته، قبل تمرير الحمولة للـrepository.
function filterWrite(principal, resource, payload, currentRow) {
  const map = FIELD_CLASS[resource] || {};
  const clean = { ...payload };
  for (const field of Object.keys(payload)) {
    const clsDef = map[field]; if (!clsDef) continue;
    const cls = typeof clsDef === 'function' ? clsDef(currentRow||payload) : clsDef;
    if (!canWriteClass(principal, cls, resource, currentRow||payload)) {
      delete clean[field];
      audit(principal, 'blocked-field-write', { resource, field, cls });
    }
  }
  return clean;
}
// canWriteClass أضيق من القراءة: PAYROLL→{admin,hr,finance} ; MARGIN→{admin,finance,sector_lead@sec} ; ...
```

---

## 8. قواعد النطاق لكل مورد (Query Constraints)

لكل استعلام قائمة (list) يُحقن شرط `WHERE` مشتقّ من النطاق الممنوح للمستخدم على ذلك المورد. الدالة `scopeWhere(principal, resource, grantScope)` تُعيد جملة SQL مُعلَّمة (parameterized) لمنع الحقن. **لا استعلام يعمل بلا هذا الشرط.**

| المورد | مفتاح النطاق على الصف | ملاحظة الاشتقاق |
|--------|----------------------|------------------|
| `sector`, `department`, `unit`, `team_org`, `position` | `id`/`sectorId`/`departmentId` مباشر | العضوية من `org_membership` |
| `employee` | `sectorId`, `departmentId`, `teamId` | `own` = `id==principal.employeeId` |
| `client`, `supplier`, `service` | `sectorId` | supplier/client قد يكونان عابرين للقطاع → `company` لمن له `company` |
| `opportunity`, `project` | `sectorId` (+ `departmentId` مستقبلاً) | `project` عند نطاق `project` = `id ∈ projectIds` |
| `deliverable`, `cost_line`, `revenue_line`, `allocation` | `sectorId` + `projectId` | `own` (allocation) = `personId==employeeId` |
| `contract`, `invoice`, `payment`, `purchase_order` | `sectorId` + `projectId` | مالي؛ `finance` = `company` |
| `user` | `sectorId` | `own` = `id==userId` |
| `activity` | `sectorId` + `userId` | `own` = `userId==principal.userId` |
| `approval_request` | `routing.sectorId/departmentId` + `assigneeId` | `@routed` عبر جدول التوجيه |
| `document` | `sectorId`/`projectId`/`shareId` | `external` = `shareId ∈ externalShareIds` |

### 8.1 مولّد شرط النطاق

```js
// يُعيد { sql, params } يُدمج في WHERE بأمان
function scopeWhere(principal, resource, scope) {
  const p = principal;
  switch (scope) {
    case 'company':
      return { sql: '1=1', params: [] };
    case 'sector':
      return inClause(`${col(resource,'sector')}`, p.sectorIds);
    case 'department':
      return inClause(`${col(resource,'department')}`, p.departmentIds);
    case 'project':
      return resource === 'project'
        ? inClause('id', p.projectIds)
        : inClause('projectId', p.projectIds);
    case 'team':
      return inClause('teamId', p.teamIds); // أو join عبر employee لموارد الأفراد
    case 'own':
      return ownWhere(resource, p);          // ownerId=? OR personId=? OR userId=? ...
    case 'routed':
      return { sql: `assigneeId = ? OR routeSectorId IN (${qs(p.sectorIds)}) OR routeDeptId IN (${qs(p.departmentIds)})`,
               params: [p.userId, ...p.sectorIds, ...p.departmentIds] };
    case 'share':
      return inClause('shareId', p.externalShareIds); // external فقط
    default:
      return { sql: '1=0', params: [] };     // deny
  }
}

function inClause(column, values) {
  if (!values || values.length === 0) return { sql: '1=0', params: [] }; // لا عضوية = لا شيء
  return { sql: `${column} IN (${values.map(()=>'?').join(',')})`, params: [...values] };
}

// اختيار أوسع نطاق ممنوح للمستخدم على (resource, action) لبناء الاستعلام
function effectiveScope(principal, resource, action) {
  const RANK = { company:6, sector:5, department:4, project:3, team:2, own:1, routed:3, share:1 };
  let best = null;
  for (const g of grantsFor(principal.roles, resource, action))
    if (!best || RANK[g.scope] > RANK[best]) best = g.scope;
  return best; // null => لا منح => 403
}
```

**قاعدة القطع (fail-closed):** إذا كانت مصفوفة العضوية فارغة (`sectorIds=[]`) لنطاق مطلوب، يعيد `inClause` الشرط `1=0` → لا صفوف. لا يتحوّل غياب العضوية إلى «رؤية الكل» أبداً.

---

## 9. سلّم الاعتمادات (Approval Ladder) ودلالة `approve`

`approve` لا يكفي فيه امتلاك المنح؛ يجب أن يقع مبلغ الطلب ضمن سقف الدور، وأن يقع الطلب ضمن نطاق المعتمِد.

**السلّم الافتراضي (⚪ يحتاج إقرار الإدارة — OQ-5 / Q5 في التقرير):**

| مستوى الاعتماد | الدور | السقف (SAR) | النطاق |
|-----------------|-------|-------------|--------|
| L1 | `line_manager` / `project_manager` | ≤ 25,000 | team / project |
| L2 | `department_manager` | ≤ 100,000 | department |
| L3 | `sector_lead` | ≤ 500,000 | sector |
| L4 | `finance` (مالي) / `procurement` (شراء) | ≤ 1,000,000 | company (نوع مطابق) |
| L5 | `ceo_office` | ≤ 5,000,000 | company |
| L6 | مجلس/الرئيس التنفيذي (خارج المنصة) | > 5,000,000 | يوثَّق فقط |

```js
const APPROVAL_LIMIT = {                     // SAR ؛ تهيئة قابلة للتعديل
  line_manager: 25_000, project_manager: 25_000,
  department_manager: 100_000, sector_lead: 500_000,
  finance: 1_000_000, procurement: 1_000_000,
  ceo_office: 5_000_000, admin: Infinity,
};

function canApprove(principal, request) {
  // 1) نطاق: الطلب موجَّه للمستخدم أو ضمن نطاقه
  if (!holds(principal, 'approval_request',
             { sectorId:request.routeSectorId, departmentId:request.routeDeptId,
               projectId:request.projectId, assigneeId:request.assigneeId },
             effectiveScope(principal,'approval_request','approve'))) return false;
  // 2) سقف: أعلى سقف بين أدوار المستخدم ≥ مبلغ الطلب
  const cap = Math.max(...principal.roles.map(r => APPROVAL_LIMIT[r] ?? 0));
  if ((request.amountSar ?? 0) > cap) return false;
  // 3) فصل المهام: لا يعتمد المستخدم طلباً أنشأه هو
  if (request.createdBy === principal.userId) return false;
  return true;
}
```

**فصل المهام (Segregation of Duties):** المُنشئ لا يعتمد طلبه؛ اعتماد مصروف/عقد يتجاوز السقف يُصعَّد للمستوى الأعلى تلقائياً في سلسلة التوجيه.

---

## 10. الدالة المرجعية `can(user, action, resource, target)`

القلب المرجعي للتفويض. تُستدعى في كل مسار قبل أي عملية، وعلى كل صف قبل التسلسل. صافية (pure) وقابلة للاختبار.

```js
// ── مرتبة النطاق ─────────────────────────────────────────────
const SCOPE_RANK = { company:6, sector:5, department:4, project:3, team:2, own:1, routed:3, share:1 };

// ── تحقّق احتواء النطاق على هدف مُحدَّد ─────────────────────────
function holds(principal, resource, target, scope) {
  if (!scope) return false;
  if (!target) return true;                 // list/create-probe: القيد يُحقن عبر scopeWhere
  const p = principal;
  switch (scope) {
    case 'company':    return true;
    case 'sector':     return !!target.sectorId && p.sectorIds.includes(target.sectorId);
    case 'department': return !!target.departmentId && p.departmentIds.includes(target.departmentId);
    case 'project':    return resource === 'project'
                              ? p.projectIds.includes(target.id)
                              : !!target.projectId && p.projectIds.includes(target.projectId);
    case 'team':       return (!!target.teamId && p.teamIds.includes(target.teamId))
                              || (!!target.personEmployeeTeamId && p.teamIds.includes(target.personEmployeeTeamId));
    case 'own':        return ownerMatch(p, resource, target);
    case 'routed':     return target.assigneeId === p.userId
                              || p.sectorIds.includes(target.routeSectorId)
                              || p.departmentIds.includes(target.routeDeptId);
    case 'share':      return p.isExternal && p.externalShareIds.includes(target.shareId);
    default:           return false;
  }
}

function ownerMatch(p, resource, t) {
  if (resource === 'user')     return t.id === p.userId;
  if (resource === 'employee') return t.id === p.employeeId;
  return t.ownerId === p.userId
      || t.userId  === p.userId
      || (t.personId && t.personId === p.employeeId)
      || t.createdBy === p.userId;
}

// ── الدالة الرئيسية ──────────────────────────────────────────
// user   : principal مبنيّ من قاعدة البيانات
// action : 'read'|'create'|'update'|'delete'|'approve'|'export'|'admin'
// resource: مفتاح مورد قانوني
// target : الصف المستهدف (أو null لعمليات القائمة/الإنشاء الاستكشافية)
// opts   : { fields?, amountSar? } — للتحقق من الحقول الحساسة والسقف
function can(user, action, resource, target = null, opts = {}) {
  const p = user;

  // 0) external معزول: لا شيء خارج @share مهما كانت المنح
  if (p.isExternal && !['document','approval_request','invoice'].includes(resource))
    return deny('external-isolation');

  // 1) اجمع المنح المطابقة (resource, action) عبر كل الأدوار (اتحاد)
  const grants = grantsFor(p.roles, resource, action);
  if (grants.length === 0) return deny('no-grant');

  // 2) نطاق: أحد المنح يجب أن يحتوي الهدف
  const scoped = grants.some(g => holds(p, resource, target, g.scope));
  if (!scoped) return deny('out-of-scope');

  // 3) approve: تحقّق السقف + فصل المهام
  if (action === 'approve' && target && !canApprove(p, target))
    return deny('approval-limit-or-sod');

  // 4) حقول حساسة في الحمولة/القراءة المطلوبة
  if (opts.fields) {
    for (const f of opts.fields) {
      const cls = classOf(resource, f, target);
      if (!cls) continue;
      const ok = (action === 'read' || action === 'export')
        ? canReadClass(p, cls, resource, target)
        : canWriteClass(p, cls, resource, target);
      if (!ok) return deny(`field:${f}`); // أو: أسقِط الحقل بدل الرفض حسب سياسة المسار
    }
  }
  return allow(bestScope(p, resource, action));
}

const deny  = (reason) => ({ ok:false, reason });
const allow = (scope)  => ({ ok:true, scope });
function bestScope(p, resource, action) {
  return grantsFor(p.roles, resource, action)
    .map(g => g.scope).sort((a,b)=>SCOPE_RANK[b]-SCOPE_RANK[a])[0];
}

// ── grantsFor: يقرأ من iam_role_grant المُبذورة من القسم 6 ──────
function grantsFor(roles, resource, action) {
  return ROLE_GRANTS.filter(g =>
    roles.includes(g.role) && g.resource === resource && g.actions.includes(action));
}
```

**عقد الاستخدام:**
- **مسار قائمة:** `can(u,'read',resource)` (target=null) للتحقق من وجود منح → ثم `scopeWhere()` لحقن القيد → ثم `project()` على كل صف.
- **مسار صف مفرد:** حمّل الصف أولاً، ثم `can(u,action,resource,row,{fields})`؛ ممنوع الاعتماد على مُعرّف من العميل دون تحميل الصف والتحقق من نطاقه.
- **الإنشاء:** `can(u,'create',resource,proposedRow,{fields:Object.keys(body)})` — يتحقق أن سمات الصف المقترح داخل النطاق والحقول مسموحة.

---

## 11. معمارية الإنفاذ (Middleware Pipeline)

```
HTTP Request
  │
  ├─ 1. authenticate            ← كوكي evc_session (HttpOnly) → userId ؛ يرفض غير المصادَق
  ├─ 2. loadPrincipal           ← من DB: roles + org_membership (لا يثق بأي ترويسة عميل)
  ├─ 3. route.authorize(res,act) ← can(principal, act, res)  (بلا target: بوابة وجود منح)
  ├─ 4. repository.scopedQuery   ← يحقن scopeWhere(principal,res,effectiveScope) في WHERE
  │        └─ single-row: يحمّل الصف ثم can(...,row) قبل الكتابة/الحذف
  ├─ 5. filterWrite (كتابة فقط)  ← يسقط الحقول الحساسة غير المسموح كتابتها
  ├─ 6. serialize: project()     ← يحجب الحقول الحساسة على كل صف قبل الإرسال
  └─ 7. audit                    ← يكتب في activity (state-save / sensitive-read / blocked-*)
```

**مبادئ إلزامية:**
1. **الخادم مصدر القرار الوحيد.** الـPrincipal يُبنى من قاعدة البيانات؛ لا يُقرأ الدور/القطاع من جسم الطلب أو ترويسة.
2. **لا نقطة API عامة تُعيد كل الحالة.** يُلغى `GET /api/state` الشامل ويُستبدل بنقاط لكل مورد `GET /api/{resource}` تمر بالخط أعلاه (يعالج R1/R2 في التقرير).
3. **الحذف منطقي افتراضاً؛** الحذف الفعلي `admin` فقط.
4. **`activity` غير قابل للتعديل** — يُكتب فقط بواسطة طبقة التدقيق، ولا منح `create/update/delete` عليه لأي دور.
5. **التصدير يُدقَّق دوماً** ويطبّق `project()` على كل صف مُصدَّر (لا تصدير خام يتجاوز الحجب).
6. **قِيَم النظام المحمية:** لا يعطّل مستخدم حسابه، ولا يرفع دوره، ولا يمنح `admin` لنفسه — إنفاذ خادمي صريح في مسار `user.update`.

**شكل الاستجابة عند الرفض:** `403 { error:'forbidden', reason }` بلا كشف تفاصيل الصف. `404` للصفوف خارج النطاق تُفضَّل أحياناً لتفادي كشف الوجود (سياسة لكل مورد).

---

## 12. المستخدم الخارجي (external) وقيوده

`external` = شريك/عميل/مورّد يدخل بوابة معزولة. قيوده صارمة ومنفصلة عن منطق القطاعات:

- **عزل تام:** `can()` يرفض أي مورد ليس `document|approval_request|invoice` (السطر 0 في `can`).
- **لا نطاق قطاعي:** لا `sectorIds` فعّالة؛ الوصول عبر `externalShareIds` فقط (جدول `external_share` صريح: من شارك، ماذا، حتى متى).
- **لا قوائم داخلية:** لا يرى قائمة عملاء/مشاريع/موظفين. يرى فقط الصف المُشارَك معه عبر معرّف مشاركة.
- **حجب مالي كامل** عدا مستنداته الخاصة (فاتورته هو، إن فُعِّلت البوابة).
- **جلسة معزولة:** يُفضَّل مسار مصادقة/نطاق كوكي منفصل (`ext_session`) وحد معدّل أشد.
- **انتهاء صلاحية المشاركة:** كل `external_share` له `expiresAt`؛ بعده يسقط الوصول تلقائياً.

> إدخال مستخدمين خارجيين قرار إدارة مفتوح (Q9 في التقرير / OQ-6). حتى إقراره، لا تُنشأ حسابات `external` في الإنتاج.

---

## 13. ترحيل الأدوار من «سند» القديمة

خريطة تحويل الأدوار الفعلية (من اللقطة، revision 890) إلى النموذج الجديد:

| الدور القديم | العدد | → الجديد | ملاحظة |
|--------------|-------|----------|--------|
| `admin` | 1 | `admin` | تدوير كلمة المرور + إنشاء حساب مراجعة `viewer` (R13). |
| `sector_manager` | 3 | `sector_lead` | كان يُعامل كـ`sector_lead` في الكود. |
| `sector_lead` | 1 | `sector_lead` | — |
| `bd_manager` | 2 | `bd_manager` | — |
| `consultant` | 1 | `consultant` | يُربط بـ`employee` عبر `employeeId`. |
| `viewer` | 2 | `viewer` | (واحد معطّل يبقى `active=false`). |
| `USER` (بلا دخول) | 16 | `employee` بلا حساب دخول | سجلات فريق للتسكين/الرواتب؛ `user.active=false` أو بلا `username`. |
| — | 0 | `ceo_office`,`department_manager`,`line_manager`,`project_manager`,`finance`,`procurement`,`hr`,`operations`,`approver`,`external` | **غير مُسنَدة** — تُسنَد إداريّاً عند التفعيل (R11). |

خطوات الترحيل: (1) إنشاء `department`/`unit`/`team_org`/`position` من قيم `team.dept` النصية الحرة (إزالة التكرار). (2) إنشاء `org_membership` لكل مستخدم من `sectorId` القديم. (3) بذر `iam_role_grant` من أوراق القسم 6. (4) فصل `salarySar` وربطه بـ`employee` تحت سياسة PAYROLL. (5) إخفاء `loginHistory.ip` خلف SECURITY_PII.

---

## 14. مصفوفة اختبار القبول (Acceptance / Test Matrix)

حالات إلزامية تُغطّى باختبارات `node:test` (يجب أن تمرّ قبل الدمج):

| # | السيناريو | المتوقع |
|---|-----------|---------|
| T1 | `viewer` يطلب `GET /api/employee` | 200، وكل الصفوف بلا `salarySar` (غير موجود في JSON). |
| T2 | `sector_lead(SOLUTIONS)` يطلب مشاريع `CONSULTING` | لا صفوف من قطاع آخر (scopeWhere قطع). |
| T3 | `consultant` يطلب `project` ليس ضمن `projectIds` | 403/404. |
| T4 | `bd_manager` يقرأ مشروعاً | 200 لكن `marginPct/profitSar/actualSpendSar` محجوبة، `valueSar` للفرص ظاهرة. |
| T5 | `line_manager` يقرأ `employee` من فريقه | 200 بلا `salarySar`. |
| T6 | `employee` يقرأ ملفه | يرى `salarySar/own`، لا يرى راتب زميله. |
| T7 | غير `admin` يطلب `user.loginHistory` | `ip/userAgent/failedAttempts/lockedUntil` محجوبة؛ صاحب الحساب يرى سجلّه فقط. |
| T8 | `sector_lead` يعتمد مصروفاً 600,000 | 403 (تجاوز سقف 500k). |
| T9 | مُنشئ طلب يعتمد طلبه | 403 (فصل مهام). |
| T10 | مستخدم يحاول رفع دوره إلى `admin` عبر `PUT /api/user/self` | الحقل يُسقَط + محاولة تُدقَّق. |
| T11 | `finance` يصدّر الإيراد | 200 + قيد تدقيق export + الحجب مطبّق على الصفوف. |
| T12 | `admin` يقرأ راتباً | 200 + قيد `sensitive-read` في `activity`. |
| T13 | `external` يطلب `GET /api/project` | 403 (عزل). |
| T14 | مستخدم بلا عضوية قطاع يطلب مورداً سِعته `sector` | لا صفوف (fail-closed، لا «رؤية الكل»). |
| T15 | `procurement` يقرأ مشروعاً | يرى `cost` لا `marginPct`؛ يرى `poValueSar`. |

---

## 15. قرارات مفتوحة (Open Decisions)

| # | القرار | يعتمد عليه | المُجيب |
|---|--------|-----------|---------|
| OQ-1 | تأكيد الهيكل التنظيمي الرسمي (إدارات/وحدات تحت القطاع) لتثبيت نطاق `department` | Q4 في التقرير | الإدارة العليا |
| OQ-2 | حدود سلّم الاعتماد الفعلية (سقوف SAR لكل مستوى) | القسم 9 / Q5 | الإدارة + المالية |
| OQ-3 | فصل `security_admin` (نظام بلا بيانات) عن `admin` و`hr` لإلغاء break-glass على الرواتب | القسم 7 / R2 | الأمن + الإدارة |
| OQ-4 | من يرى الرواتب فعلاً: هل `sector_lead` يحتاج إجمالي رواتب قطاعه (aggregate) للموازنة؟ | القسم 7 / Q6 | HR + المالية |
| OQ-5 | هل تُبنى كيانات `contract/invoice/payment/purchase_order` داخل سند أم تكامل مع Odoo؟ | القسم 3.4 / Q1-Q2 | الإدارة + المالية |
| OQ-6 | تفعيل بوابة `external` (عميل/مورّد) ونطاق مشاركاتها | القسم 12 / Q9 | الإدارة العليا |
| OQ-7 | سياسة الاحتفاظ بـ`loginHistory.ip` ومدتها (خصوصية/امتثال) | القسم 7 / R2 / Q10 | الأمن + القانونية |
| OQ-8 | صلاحيات المساعد الذكي: هل يخضع لنفس `can()` بهوية المستخدم الطالب؟ (يُوصى: نعم — يرث نطاق المستخدم ولا يتجاوزه) | R10 / Q8 | الإدارة + الأمن |

---

*نهاية المستند. المصدر القابل للتنفيذ: أوراق القسم 6 (بذر `iam_role_grant`) + كود الأقسام 7/8/9/10 (منطق الإنفاذ) + مصفوفة القسم 14 (اختبارات القبول).*
