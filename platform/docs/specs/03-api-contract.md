# 03 — عقد الـREST API — منصة «سند» (Enterprise OS)

**الحالة:** Draft v1 قابل للتنفيذ المباشر · **المالك التقني:** فريق المنصة (Platform)
**يعتمد على:** `docs/02-analysis-report.md` · `platform/docs/specs/02-rbac.md` · `platform/migrations/001_init.sql` · `platform/src/core/**`
**المعمارية:** Modular Monolith · Node.js 22 (ESM) · Express 5 · `node:sqlite` (dev) / PostgreSQL (prod) · التفويض على الخادم حصراً.

> هذا العقد **مصدر الحقيقة الوحيد** لسطح الـHTTP. كل مسار هنا يقابل مباشرة نمط الوحدات في `src/modules/*` ونواة `src/core/*`. المعرّفات والأكواد والحقول بالإنجليزية؛ الشرح بالعربية. المبالغ في الاستجابات أعداد صحيحة (هللات) والمدخلات بالريال (انظر §1.6). التفويض يُنفَّذ بطبقتين: وسيط المسار `requirePermission(resource, action)` ثم فحص الصف `can(user, action, resource, row)` (انظر §1.3).

---

## 0. الفهرس

1. الاصطلاحات الموحّدة (Global Conventions) — إلزامية لكل مسار
   1. المسار الأساسي والإصدار
   2. المصادقة والجلسات وCSRF
   3. نموذج التفويض في العقد (Permission Notation)
   4. مغلّف الاستجابة (Response Envelope) والترقيم (Pagination)
   5. الترشيح والفرز (Filtering / Sorting)
   6. المال والتواريخ والمعرّفات واللغة
   7. مغلّف الأخطاء (Error Envelope) وجدول الرموز الكامل
   8. الحزم القياسية للأخطاء (Standard Error Sets)
   9. Idempotency والتزامن التفاؤلي (Optimistic Concurrency)
   10. حجب الحقول الحساسة في الاستجابة (Field Redaction)
   11. التدقيق وتحديد المعدل (Audit / Rate limiting)
2. auth — المصادقة
3. iam — المستخدمون والأدوار والصلاحيات
4. org — الهيكل التنظيمي
5. crm — الفرص والعملاء والعروض والتسعير والخدمات
6. pmo — المحافظ والبرامج والمشاريع والمهام والمعالم والمخرجات والمخاطر والقضايا
7. timesheets — الجداول الزمنية
8. workflow — سير الاعتمادات
9. finance — العقود والفواتير والتحصيل والمصروفات والموازنات والمشتريات
10. reports — التقارير واللقطات والـKPI
11. email — القوالب والجدولة والمعاينة والاختبار والسجلات
12. ai — المساعد الذكي
13. notifications — الإشعارات
14. audit — سجل التدقيق
15. ملاحق: سجل بادئات المعرّفات · كتالوج الموارد×الأفعال · خريطة الحقول الحساسة · قائمة اختبار القبول

---

# 1. الاصطلاحات الموحّدة (Global Conventions)

## 1.1 المسار الأساسي والإصدار

- كل المسارات تحت البادئة **`/api`** (مطابق للكود القائم: `/api/auth/login`).
- الإصدار عبر ترويسة اختيارية `Accept-Version: 1` (الافتراضي `1`). لا نضمّن رقم الإصدار في المسار حالياً؛ أي كسر توافق مستقبلي يرفع الترويسة إلى `2` مع إبقاء `1` مدة إهمال معلنة.
- `Content-Type: application/json; charset=utf-8` لكل طلب/استجابة ذات جسم. `charset=utf-8` إلزامي (محتوى عربي).
- كل الاستجابات تحمل `X-Request-Id` (UUID) لتتبّع السجل عبر التدقيق.

## 1.2 المصادقة والجلسات وCSRF

- **الجلسة عبر كوكي** `sanad_sid` (من `config.sessionCookie`): `HttpOnly; SameSite=Lax; Secure` (في الإنتاج)؛ العمر `SESSION_TTL_HOURS` (افتراضي 12h). تُحلّ في `attachContext()` إلى `req.ctx.user`.
  - **والعمر نافذةُ خمولٍ تتدحرج لا مهلةً مطلقة** (ADR-0012، ترحيلة 035): كل طلبٍ لمستخدمٍ ثابت الهوية يدفع `expires_at` و`maxAge` إلى «الآن + النافذة»، بخانق كتابةٍ (`SESSION_TOUCH_MINUTES`، افتراضي 5) وسقفٍ مطلق من لحظة الدخول (`SESSION_MAX_DAYS`، افتراضي 30). كان العمر يُحسب مرةً واحدة عند الدخول ولا يُلمَس بعدها.
  - **وانتهاء الجلسة يُعلَن**: طلبُ صفحةٍ يحمل كعكةً ميتة يُحوَّل إلى `/login?e=7` («انتهت مدة جلستك») وتُحفظ وجهته (كعكة `sanad_next`، مسارات `/app/` فقط) فيعود إليها بعد دخوله؛ وطلبُ JSON يأخذ `401` بدل تحويلةٍ إلى HTML.
- **CSRF (Double-Submit):** كوكي غير-HttpOnly `sanad_csrf` يُصدَر عند تسجيل الدخول؛ كل طلب **يغيّر الحالة** (`POST/PATCH/PUT/DELETE`) يجب أن يحمل ترويسة `X-CSRF-Token` مطابقة لقيمة الكوكي. الفشل → `403 csrf_invalid`. طلبات `GET/HEAD` معفاة.
- المسارات العامة الوحيدة (بلا جلسة): `POST /api/auth/login` و`GET /api/health`. كل ما عداها يتطلب `requireAuth()` → عند الغياب `401 unauthorized`.
- لا يُقرأ أي دور/نطاق من العميل إطلاقاً؛ الـPrincipal يُبنى من قاعدة البيانات (`resolveUser`).

## 1.3 نموذج التفويض في العقد (Permission Notation)

كل مسار يذكر صلاحيته بالصيغة: **`resource:action@scope`**.

- `resource` ∈ كتالوج الموارد (§ملحق ب) — سلسلة `snake_case` مطابقة لعمود `role_permission.resource`.
- `action` ∈ `{ read, create, update, delete, approve, export, admin }`.
- `@scope` ∈ `{ company, sector, department, project, team, own }` = **أدنى** نطاق يكفي؛ النطاق الأوسع يحتويه (Rank: company⊃sector⊃department⊃project≈team⊃own).
- **التنفيذ بطبقتين:**
  1. وسيط المسار: `requirePermission(resource, action)` — يرفض `403` إن لم يملك المستخدم أي منح `(resource, action)` بأي نطاق.
  2. فحص الصف داخل المعالج: `can(user, action, resource, row)` — يتحقق أن نطاق المنح يصل سمات الصف (`sector_id/department_id/project_id/owner_user_id/...`). القوائم تُقيَّد عبر `scopeFilter(user, resource, action)` الذي يحقن `WHERE`.
- علامة `—` في حقل الصلاحية = مسار ذاتي (self) لا يتطلب منحاً في المصفوفة (مثل `/auth/me`)، لكنه يتطلب جلسة.
- `admin` (`role_permission` wildcard `*:admin@company`) يجتاز كل الفحوص عبر منح مولّدة، لا عبر تجاوز الدالة (القراءة الحساسة تُدقَّق).

## 1.4 مغلّف الاستجابة (Response Envelope) والترقيم

**عنصر مفرد** (GET/POST/PATCH لكيان): يُعاد الكائن مباشرة (بلا تغليف)، مطابقاً لنمط الكود القائم:
```json
{ "id": "opp_x9…", "title_ar": "…", "value_halalas": 1200000, "…": "…" }
```

**قائمة** (list): مغلّفة بـ`data` + `meta`:
```json
{
  "data": [ { "…": "…" } ],
  "meta": { "limit": 50, "offset": 0, "count": 50, "total": 134, "has_more": true }
}
```

**الترقيم (Pagination):**
- `?limit=` (افتراضي **50**، أقصى **200**). `?offset=` (افتراضي 0). القوائم الكبيرة تدعم أيضاً `?cursor=` (معتم، base64 لـ`{last_sort_key,last_id}`) للتصفح المستقر؛ عند إرسال `cursor` يُتجاهل `offset`.
- `meta.total` يُحسب فقط عند `?count=true` (تجنّب `COUNT(*)` المكلف افتراضياً)؛ وإلا `total=null` ويُعتمد `has_more`.
- ترويسة `X-Total-Count` تعكس `meta.total` عند توفّره.

**الإجراءات (Actions)** غير الـCRUD (اعتماد/نقل مرحلة/تشغيل تقرير…) تُعاد ككائن الكيان المتأثّر بعد العملية، أو `{ "ok": true, "…": "…" }` عند عدم وجود كيان ناتج.

## 1.5 الترشيح والفرز (Filtering / Sorting)

- **الترشيح** عبر معاملات استعلام باسم الحقل: `?status=IN_PROGRESS&sector_id=SOLUTIONS&year=2026`. القيم المتعددة بفاصلة: `?status=TODO,IN_PROGRESS`. المدى بلاحقة `_from`/`_to`: `?due_date_from=2026-01-01&due_date_to=2026-03-31`. البحث النصي الحر: `?q=` (يطبّق على `name_ar/title_ar/code`).
- **الفرز:** `?sort=field` تصاعدي، `?sort=-field` تنازلي (بادئة `-`). حقول الفرز المسموحة محدودة لكل مورد (تُرفض غير المسموحة بـ`400 invalid_sort`). الافتراضي مذكور لكل قائمة.
- كل الترشيحات تُطبَّق **بعد** حقن قيد النطاق (`scopeFilter`)؛ لا يوسّع أي فلتر رؤية المستخدم.
- المعاملات غير المعروفة تُتجاهَل بصمت (forward-compat) عدا `sort` غير الصالح.

## 1.6 المال والتواريخ والمعرّفات واللغة

- **المال:** يُخزَّن ويُعاد كعدد صحيح بالهللة في حقول `*_halalas` (1 ريال = 100 هللة، ADR-0002). **الاستجابات تُعيد `*_halalas` فقط.** **المدخلات تقبل `*_sar`** (رقم بالريال) ويحوّلها الخادم عبر `toHalalas()` = `round(sar*100)`. إن أُرسل حقل `*_halalas` في الكتابة يُقبل كما هو (مسار الترحيل/التكامل). لا تُرسَل قيم عشرية للهللات.
- **التواريخ:** ISO-8601 UTC نصية (`2026-07-13T09:20:00.000Z`) لطوابع الوقت؛ والتواريخ المجرّدة `YYYY-MM-DD` لحقول `*_date`. الأشهر أعداد `1..12` (حقل `month`)، والسنة عدد (`year`).
- **المعرّفات:** نصية `prefix_random` (base64url، §ملحق أ). المعرّفات القديمة تُحفظ كما هي عند الترحيل.
- **اللغة/الاتجاه:** `Accept-Language: ar|en` (افتراضي `ar`). رسائل الأخطاء والمُسمّيات المُعرَّبة تتبعها. الحقول ثنائية اللغة تُعاد دائماً (`name_ar` + `name_en`)؛ العميل يختار. لا يؤثّر هذا على أسماء الحقول (إنجليزية ثابتة).
- **Booleans** كـ`true/false` في JSON؛ تُخزَّن `0/1` في SQLite (يعالجها الـrepository).
- **Enum**: القيم النصية للحالات كما وردت في المخطط (بعضها عربي: `client.type ∈ {حكومي, خاص, داخلي, شبه حكومي}`؛ `employment_type ∈ {أساسي, موسمي, متعاقد}`) — تُرسَل حرفياً.

## 1.7 مغلّف الأخطاء وجدول الرموز الكامل

**المغلّف** (من `core/http/errors.js` — لا يتغيّر):
```json
{ "error": { "code": "forbidden", "message": "صلاحيتك لا تسمح بهذا الإجراء", "details": null } }
```
- `code`: ثابت آلي (snake_case) للتفريع البرمجي.
- `message`: نص مُعرَّب صالح للعرض.
- `details`: كائن اختياري؛ لأخطاء التحقق مصفوفة حقول: `{ "fields": [ { "field": "value_sar", "code": "required", "message": "…" } ] }`.

**جدول رموز الأخطاء الكامل:**

| HTTP | code | متى يُرمى | مصدره في الكود |
|------|------|----------|-----------------|
| 400 | `bad_request` | جسم/معامل غير صالح بنيوياً | `badRequest()` |
| 400 | `invalid_sort` | حقل فرز غير مسموح | معالج القائمة |
| 401 | `unauthorized` | لا جلسة / منتهية | `unauthorized()` / `requireAuth` |
| 401 | `auth_failed` | فشل تسجيل الدخول (بيانات خاطئة) | `authRouter.login` |
| 401 | `account_locked` | حساب مقفل بعد محاولات فاشلة | `login` reason=locked |
| 401 | `account_inactive` | حساب معطّل | `login` reason=inactive |
| 403 | `forbidden` | لا منح `(resource,action)` أو خارج النطاق | `forbidden()` / `requirePermission` / `can` |
| 403 | `csrf_invalid` | ترويسة CSRF مفقودة/غير مطابقة | وسيط CSRF |
| 403 | `must_change_password` | العملية محظورة قبل تغيير كلمة المرور الإلزامية | وسيط سياسة كلمة المرور |
| 404 | `not_found` | كيان غير موجود أو خارج نطاق القراءة (لا نكشف الوجود) | `notFound()` |
| 409 | `conflict` | كتابة قديمة (stale) / خرق تفرّد (unique) | `conflict()` |
| 409 | `idempotency_conflict` | إعادة استخدام `Idempotency-Key` بجسم مختلف | وسيط Idempotency |
| 409 | `invalid_transition` | انتقال حالة غير مسموح (مرحلة/حالة اعتماد) | معالجات النقل |
| 422 | `validation_error` | فشل تحقق دلالي (حقول متعددة) مع `details.fields` | طبقة التحقق |
| 423 | `resource_locked` | الكيان في حالة تمنع التعديل (مثل فترة اعتُمدت) | معالجات الأعمال |
| 429 | `rate_limited` | تجاوز حد الطلبات (`Retry-After` بالثواني) | وسيط المعدل |
| 500 | `internal` | خطأ غير متوقع (يُسجَّل، لا يُفصح) | `errorHandler` |
| 503 | `ai_unavailable` | المساعد الذكي غير مُفعَّل/مفتاح مفقود | وحدة ai |

> **قاعدة عدم الكشف:** إذا كان الكيان موجوداً لكنه خارج نطاق القراءة، يُعاد `404 not_found` (لا `403`) لئلا نؤكّد وجوده. أما فشل *الفعل* على كيان يراه المستخدم فيُعاد `403 forbidden`.

## 1.8 الحزم القياسية للأخطاء (Standard Error Sets)

لتقليل التكرار، كل مسار يشير إلى **حزمة** + رموز خاصة. الحزم:

- **ERR/BASE** (كل مسار): `401 unauthorized`, `429 rate_limited`, `500 internal`.
- **ERR/WRITE** (كل POST/PATCH/DELETE): BASE + `403 csrf_invalid`, `403 forbidden`, `403 must_change_password`.
- **ERR/READ** (GET كيان): BASE + `403 forbidden`, `404 not_found`.
- **ERR/LIST** (GET قائمة): BASE + `400 invalid_sort`, `403 forbidden`.
- **ERR/CREATE**: WRITE + `400 bad_request`, `422 validation_error`, `409 conflict`, `409 idempotency_conflict`.
- **ERR/UPDATE**: WRITE + `400 bad_request`, `404 not_found`, `422 validation_error`, `409 conflict`.
- **ERR/DELETE**: WRITE + `404 not_found`, `409 conflict`.
- **ERR/APPROVE**: WRITE + `404 not_found`, `409 invalid_transition`, `423 resource_locked`.

في جداول المسارات، عمود «الأخطاء» يذكر الحزمة ثم أي رموز إضافية خاصة.

## 1.9 Idempotency والتزامن التفاؤلي

- **Idempotency (إنشاء آمن للتكرار):** كل `POST` مُنشئ يقبل ترويسة `Idempotency-Key: <uuid>` (يُوصى بها للعملاء غير الموثوقين شبكياً). الخادم يخزّن `(key, user_id) → (status, body_hash, response)` مدة 24h. إعادة نفس المفتاح بنفس الجسم → تُعاد الاستجابة المحفوظة (نفس `id`). إعادته بجسم مختلف → `409 idempotency_conflict`. الإجراءات غير المُنشئة (approve/transition) idempotent بطبيعتها عبر فحص الحالة.
- **التزامن التفاؤلي (تحديث آمن):** كل `PATCH`/`DELETE` على كيان قابل للتدقيق يقبل ترويسة `If-Match: "<updated_at>"` (قيمة `updated_at` التي رآها العميل) أو الحقل `expected_updated_at` في الجسم. إن اختلفت عن القيمة الحالية → `409 conflict` (`details.reason="stale_write"`) دون تطبيق. غياب الترويسة يعني «آخر كاتب يفوز» (مسموح للحقول غير الحرجة). الترويسة القديمة `X-Base-Revision` (نموذج الوثيقة الواحدة) **مهملة** ولا تُستخدم.
- استجابة كل كتابة ناجحة تُعيد `updated_at` الجديد ليستخدمه العميل في الطلب التالي، وترويسة `ETag: "<updated_at>"`.

## 1.10 حجب الحقول الحساسة في الاستجابة (Field Redaction)

- بعد جلب أي صف/قائمة، تمرّ عبر `redact(user, resource, row)` قبل التسلسل. الحقول المحجوبة تُعاد `null` مع علم `_redacted_<field>: true` (سلوك الكود الحالي).
- **بوابات الحجب المُنفَّذة حالياً** (`SENSITIVE_FIELDS` في `matrix.js`) — تُقرأ عبر منح `gate:read`:

| الحقل | البوابة (gate resource) | من يراه |
|-------|--------------------------|---------|
| `employee.salary_halalas` | `salary` | admin, hr, finance, صاحب الملف(own) |
| `project.actual_spend_halalas`, `cost_line.amount_halalas`, `pricing_line.unit_cost_halalas`, `service_package.cost_halalas`, `expense.amount_halalas` | `cost` | admin, ceo_office, finance, procurement, operations, sector_lead@sec, dept_mgr@dep, pm@own-prj |
| `project.margin_pct`, `proposal.margin_pct` | `margin` | admin, ceo_office, finance, sector_lead@sec, dept_mgr@dep, pm@own-prj |
| `app_user.ip`, `login_history.ip` | `ip` | admin, صاحب الحساب(own) |

- **بوابات مُخطّطة (roadmap، انظر `02-rbac.md` §7):** `VALUE` (قيم `opportunity.value_halalas`, `contract/invoice.*_halalas`) و`CONTACT_PII` (`supplier.email/phone`, `contact.email/phone`). المسارات أدناه تُشير إليها بـ«(gate: value/contact — planned)» حيث يلزم؛ إلى أن تُفعَّل، تُعاد كاملة لمن يملك قراءة المورد ضمن نطاقه.
- **حجب الكتابة:** حقل حساس في حمولة كتابة لا يملك المستخدم بوابته يُسقَط قبل الحفظ ويُسجَّل `blocked-field-write` (لا يُرفض الطلب كله).
- **التصدير (`export`)** يطبّق نفس الحجب لكل صف مُصدَّر ويُدقَّق دائماً.

## 1.11 التدقيق وتحديد المعدل

- **التدقيق:** كل عملية كتابة/اعتماد/تصدير/دخول تكتب صفاً في `audit_log` عبر `audit(ctx, {...})` (لا يُعطَّل). قراءة حقل حساس بواسطة `admin` (break-glass) تُسجَّل `sensitive-read`. `audit_log` مورد **للقراءة فقط** (لا API للكتابة/التعديل عليه).
- **تحديد المعدل:** حدود افتراضية لكل جلسة: `login` = 10/دقيقة لكل IP؛ الكتابة العامة = 120/دقيقة؛ القراءة = 600/دقيقة؛ `ai/*` = 20/دقيقة؛ `email/test-send` = 5/دقيقة. التجاوز → `429 rate_limited` + `Retry-After`.

---

# 2. auth — المصادقة

الوحدة: `src/modules/auth.routes.js`. لا تتطلب منح RBAC (ذاتية) عدا ما يُذكر.

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| POST | `/api/auth/login` | تسجيل الدخول؛ يُنشئ جلسة ويضبط كوكي `sanad_sid`+`sanad_csrf` | عام (بلا جلسة) | BASE + `401 auth_failed`, `401 account_locked`, `401 account_inactive`, `400 bad_request` |
| POST | `/api/auth/logout` | إنهاء الجلسة الحالية (revoke) ومسح الكوكي | — (جلسة) | ERR/WRITE |
| GET | `/api/auth/me` | ملف المستخدم الحالي + نطاقه + مجموعة صلاحياته المحسوبة | — (جلسة) | ERR/BASE + `401 unauthorized` |
| POST | `/api/auth/change-password` | تغيير كلمة مرور المستخدم الذاتية | — (جلسة) | ERR/WRITE + `400 bad_request`, `422 validation_error` |
| GET | `/api/auth/sessions` | جلسات المستخدم النشطة (لإدارتها ذاتياً) | `session:read@own` | ERR/LIST |
| DELETE | `/api/auth/sessions/:id` | إنهاء جلسة محددة للمستخدم | `session:delete@own` | ERR/DELETE |
| GET | `/api/health` | فحص حياة الخدمة (بلا مصادقة) | عام | — |

**`POST /api/auth/login`**
- Request: `{ "username": "rayan", "password": "••••••" }`
- Response `200`: `{ "ok": true, "mustChangePassword": false, "user": { "id":"u_…", "username":"rayan", "name_ar":"…", "role_id":"sector_lead" }, "csrfToken":"…" }` — الكوكيان يُضبطان في الترويسات.
- سياسة القفل: بعد `maxFailedAttempts=6` يُقفل `lockMinutes=15` (`config`). المحاولات الفاشلة تُسجَّل في `login_history` (يتضمن `ip` الحساس).

**`GET /api/auth/me`**
- Response `200`:
```json
{
  "user": { "id":"u_…", "username":"rayan", "name_ar":"…", "name_en":"…",
            "role_id":"sector_lead", "sector_id":"SOLUTIONS", "scope":"sector",
            "employee_id":"emp_…", "must_change_pw": false },
  "permissions": [ { "resource":"opportunity","action":"read","scope":"sector" }, "…" ],
  "sectorIds": ["SOLUTIONS"], "projectIds": ["prj_1","prj_7"]
}
```
- `permissions` = منح دور المستخدم (لبناء إخفاء عناصر الواجهة فقط؛ ليست مصدر أمان).

**`POST /api/auth/change-password`**
- Request: `{ "currentPassword":"…", "newPassword":"…" }` — `newPassword` ≥ 8 أحرف (سياسة `service.changePassword`)؛ إن كانت `must_change_pw=1` لا يُشترط `currentPassword`.
- Response `200`: `{ "ok": true }`. يُبطل الجلسات الأخرى اختيارياً (`?revokeOthers=true`).

---

# 3. iam — المستخدمون والأدوار والصلاحيات

الوحدة: `src/modules/iam/*` (جداول `app_user`, `role`, `role_permission`, `membership`, `login_history`). إدارة الهوية = `admin`؛ وجزئياً `hr` (بلا رفع دور، بلا حقول أمن).

## 3.1 المستخدمون (`user`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/users` | قائمة المستخدمين (مُرقّمة، مُقيّدة بالنطاق) | `user:read@company` (admin/hr) · `user:read@sector` (مُخطّط) | ERR/LIST |
| POST | `/api/users` | إنشاء مستخدم | `user:create@company` | ERR/CREATE + `409 conflict` (username/email مكرر) |
| GET | `/api/users/:id` | تفاصيل مستخدم (حقول `ip/failed_attempts` محجوبة لغير admin/own) | `user:read@company` · أو `own` | ERR/READ |
| PATCH | `/api/users/:id` | تعديل مستخدم (الاسم/البريد/التفعيل/القطاع) | `user:update@company` | ERR/UPDATE + `409 conflict` |
| DELETE | `/api/users/:id` | تعطيل حساب (soft: `active=0/deleted_at`) | `user:delete@company` (admin) | ERR/DELETE + `422 validation_error` (منع تعطيل الذات) |
| POST | `/api/users/:id/roles` | إسناد دور (يستبدل/يضيف حسب الجسم) | `role:admin@company` (admin) | ERR/WRITE + `404 not_found`, `422 validation_error` |
| POST | `/api/users/:id/reset-password` | توليد كلمة مرور مؤقتة + `must_change_pw=1` | `user:update@company` | ERR/WRITE + `404 not_found` |
| POST | `/api/users/:id/activate` · `/deactivate` | تفعيل/تعطيل | `user:update@company` | ERR/WRITE + `422 validation_error` (لا يعطّل نفسه) |
| GET | `/api/users/:id/login-history` | سجل الدخول (يتضمن `ip` — admin/own فقط) | `user:read@company`(admin) · `own` | ERR/LIST |

**قواعد نظامية مُنفَّذة خادمياً (لا يتجاوزها العميل):**
- لا يستطيع مستخدم رفع دوره أو منح `admin` لنفسه؛ رفع الدور/منح admin = `admin` فقط.
- لا يعطّل المستخدم حسابه ولا يخفض دوره ذاتياً → `422 validation_error` (`code:self_lockout`).
- `hr` يُنشئ/يعدّل مستخدمين لكن **لا يرفع دوراً** ولا يرى حقول الأمن (`ip/failed_attempts/locked_until`).

**Schema `User` (استجابة):**
```json
{ "id":"u_…","username":"rayan","email":"r@evc.com.sa","name_ar":"…","name_en":"…",
  "role_id":"sector_lead","employee_id":"emp_…","sector_id":"SOLUTIONS","scope":"sector",
  "active":true,"must_change_pw":false,"last_login_at":"2026-07-13T…Z",
  "failed_attempts":0,"locked_until":null,           // gate: ip (admin/own) — محجوبة وإلا
  "created_at":"…","updated_at":"…" }
```
**Schema `UserCreate` (طلب):** `{ "username","email?","name_ar","name_en?","role_id","sector_id","scope?","employee_id?","temporaryPassword?" }` — إن غاب `temporaryPassword` يُولَّد ويُعاد مرة واحدة في الاستجابة مع `must_change_pw=true`.
**Schema `UserPatch`:** أي من `{ "email","name_ar","name_en","sector_id","scope","active" }`. `role_id` لا يُقبل هنا — يُغيَّر عبر `/roles`.

## 3.2 الأدوار والمنح (`role`, `role_permission`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/roles` | قائمة الأدوار (16 دوراً) + مُسمّياتها | `role:read@company` | ERR/LIST |
| POST | `/api/roles` | إنشاء دور مخصّص (غير نظامي) | `role:admin@company` | ERR/CREATE |
| GET | `/api/roles/:id` | تفاصيل دور + منحه | `role:read@company` | ERR/READ |
| PATCH | `/api/roles/:id` | تعديل مُسمّى دور (النظامية غير قابلة للحذف) | `role:admin@company` | ERR/UPDATE |
| DELETE | `/api/roles/:id` | حذف دور مخصّص (`is_system=0` فقط) | `role:admin@company` | ERR/DELETE + `422 validation_error` (system role) |
| GET | `/api/roles/:id/grants` | منح الدور `(resource,action,scope)` | `role:read@company` | ERR/LIST |
| PUT | `/api/roles/:id/grants` | استبدال مجموعة منح الدور بالكامل (تحديث ذرّي) | `role:admin@company` | ERR/UPDATE + `422 validation_error` |
| POST | `/api/roles/:id/grants` | إضافة منحة واحدة | `role:admin@company` | ERR/CREATE |
| DELETE | `/api/roles/:id/grants` | إزالة منحة `(resource,action,scope)` عبر الجسم | `role:admin@company` | ERR/DELETE |

- أي تعديل على المنح يستدعي `invalidateGrants()` فيعاد تحميل الذاكرة المؤقتة (`loadGrants`) — يسري فوراً بلا نشر.
- Schema منحة: `{ "resource":"opportunity","action":"read","scope":"sector" }`. التحقق: `resource` ∈ الكتالوج، `action` ∈ المجموعة، `scope` ∈ المجموعة، وإلا `422`.

## 3.3 العضويات (`membership`)

عضوية الموظف في فرق/مشاريع/لجان (تفصل فرق المشاريع عن الهيكل التنظيمي).

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/memberships` | فلترة `?employee_id=&group_kind=&group_id=` | `membership:read@company` (admin/hr) · `@sector` (sector_lead) | ERR/LIST |
| POST | `/api/memberships` | إضافة عضوية (`group_kind ∈ team|project|opportunity|program|committee|department`) | `membership:create@company/sector` | ERR/CREATE |
| PATCH | `/api/memberships/:id` | تعديل الدور في المجموعة/التخصيص/التواريخ | `membership:update@…` | ERR/UPDATE |
| DELETE | `/api/memberships/:id` | إنهاء العضوية (soft) | `membership:delete@…` | ERR/DELETE |

- إضافة عضوية `group_kind=project` تؤثّر على `projectIds` في الـPrincipal (تُوسّع نطاق `project` للمستخدم المرتبط بالموظف).

---

# 4. org — الهيكل التنظيمي

الوحدة: `src/modules/org/*`. النموذج المرن: `Company → Sector → Department → Unit → Team → Position → Employee` (جداول `sector, department, org_unit, team, position, employee`). كلها CRUD متجانسة؛ أدناه المسارات ثم المخططات.

## 4.1 القطاعات (`sector`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/sectors` | قائمة القطاعات (`?active=&placeholder=`) | `sector:read@company/sector` | ERR/LIST |
| POST | `/api/sectors` | إنشاء قطاع | `sector:admin@company` (admin) | ERR/CREATE |
| GET | `/api/sectors/:id` | تفاصيل قطاع (مستهدفاته المالية) | `sector:read@…` | ERR/READ |
| PATCH | `/api/sectors/:id` | تعديل (الاسم/القائد/المستهدفات/التفعيل) | `sector:update@sector` (lead) · `admin@company` | ERR/UPDATE |
| DELETE | `/api/sectors/:id` | تعطيل قطاع (soft) | `sector:admin@company` | ERR/DELETE + `409 conflict` (توجد كيانات مرتبطة نشطة) |

- `sector.target_margin_pct` = حقل `margin`-class؛ محجوب للأدوار بلا بوابة margin (viewer).
- Schema `Sector`: `{ "id","name_ar","name_en","color","lead_user_id","target_sales_halalas","target_revenue_halalas","target_margin_pct","active","is_placeholder","sort_order","created_at","updated_at" }`.
- Schema `SectorCreate/Patch`: يقبل `target_sales_sar/target_revenue_sar` (تحويل) بدل الهللات.

## 4.2 الإدارات/الوحدات/الفرق/المناصب

نمط CRUD موحّد. الجدول التالي يلخّص المسارات؛ الصلاحية تتبع مصفوفة §5.1 في `02-rbac.md`.

| المورد | القائمة/الإنشاء | العنصر | الصلاحية الأساسية | ملاحظة النطاق |
|--------|------------------|--------|--------------------|----------------|
| `department` | `GET/POST /api/departments` | `GET/PATCH/DELETE /api/departments/:id` | admin/hr `@company`؛ sector_lead `update@sector`؛ dept_mgr `update@department` | فلترة `?sector_id=` |
| `unit` | `GET/POST /api/units` | `GET/PATCH/DELETE /api/units/:id` | admin/hr `@company`؛ dept_mgr `create/update@department` | فلترة `?department_id=` |
| `team` (تنظيمي) | `GET/POST /api/teams` | `GET/PATCH/DELETE /api/teams/:id` | admin/hr `@company`؛ dept_mgr `@department`؛ line_mgr `update@team` | `kind=org` افتراضياً؛ فرق المشاريع تُدار عبر memberships لا هنا |
| `position` | `GET/POST /api/positions` | `GET/PATCH/DELETE /api/positions/:id` | admin/hr `@company`؛ الباقون `read` | لا نطاق (قائمة مرجعية) |

**كل عنصر منها:**
- `GET قائمة`: ERR/LIST · `POST`: ERR/CREATE · `GET :id`: ERR/READ · `PATCH`: ERR/UPDATE · `DELETE`: ERR/DELETE (+`409 conflict` عند وجود أبناء نشطين).
- Schema (مثال `Department`): `{ "id","sector_id","name_ar","name_en","manager_user_id","active","created_at" }`.
- `unit`: يضيف `department_id`. `team`: يضيف `sector_id?,department_id?,lead_user_id,kind,ref_id`. `position`: `{ "id","title_ar","title_en","grade" }`.

## 4.3 الموظفون (`employee`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/employees` | قائمة (`?sector_id=&department_id=&team_id=&status=&active=`) | `employee:read@company`(admin/hr/finance/ceo) · `@sector`(sector_lead) · `@department`(dept_mgr) · `@team`(line_mgr) | ERR/LIST |
| POST | `/api/employees` | إنشاء موظف | `employee:create@company`(hr/admin) | ERR/CREATE |
| GET | `/api/employees/:id` | تفاصيل (`salary_halalas` محجوب — gate:salary) | `employee:read@…` · `own` | ERR/READ |
| PATCH | `/api/employees/:id` | تعديل (الراتب قابل للكتابة لـadmin/hr/finance فقط) | `employee:update@…`(hr/dept_mgr) · `own`(ملفه، بلا راتب) | ERR/UPDATE |
| DELETE | `/api/employees/:id` | إنهاء خدمة (soft) | `employee:delete@company`(hr/admin) | ERR/DELETE |
| GET | `/api/employees/:id/allocations` | تسكينات الموظف | `allocation:read@…` · `own` | ERR/LIST |

- Schema `Employee`: `{ "id","user_id","name_ar","name_en","sector_id","department_id","unit_id","position_id","line_manager_id","job_title","dept_label","salary_halalas","employment_type","seasonal","status","active","created_at","updated_at" }` — `salary_halalas` يُعاد `null`+`_redacted_salary_halalas:true` لغير المخوّلين.
- `EmployeeCreate/Patch`: يقبل `salary_sar` (تحويل)؛ يُسقَط صامتاً من الحمولة لمن لا يملك gate:salary.

## 4.4 الشجرة التنظيمية

| Method | Path | الوصف | الصلاحية |
|--------|------|-------|----------|
| GET | `/api/org/tree` | شجرة `sector→department→unit→team→employees` (مُقيّدة بالنطاق، بلا رواتب) | `sector:read@…` |
| GET | `/api/org/chart?sector_id=` | مخطط تنظيمي لقطاع | `sector:read@sector` |

---

# 5. crm — الفرص والعملاء والعروض والتسعير والخدمات

الوحدة: `src/modules/crm/*` (`opportunities.js` قائم). جداول: `opportunity, opportunity_stage_history, opportunity_sector, client, contact, stage, proposal, pricing_line, service, service_package, supplier`.

## 5.1 الفرص (`opportunity`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/opportunities` | قائمة مُقيّدة بالنطاق (`?stage=&sector_id=&priority=&owner_user_id=&year=&q=`) فرز افتراضي `-value_halalas` | `opportunity:read@sector` | ERR/LIST |
| POST | `/api/opportunities` | إنشاء فرصة | `opportunity:create@sector` (sector_lead/bd_manager) | ERR/CREATE |
| GET | `/api/opportunities/:id` | تفاصيل فرصة | `opportunity:read@…` | ERR/READ |
| PATCH | `/api/opportunities/:id` | تعديل حقول | `opportunity:update@…` | ERR/UPDATE |
| DELETE | `/api/opportunities/:id` | حذف منطقي | `opportunity:delete@sector` | ERR/DELETE |
| POST | `/api/opportunities/:id/stage` | نقل المرحلة (يحدّث `win_pct` + يسجّل التاريخ) | `opportunity:update@…` | ERR/APPROVE + `400 bad_request`(مرحلة مجهولة) |
| GET | `/api/opportunities/:id/stage-history` | سجل انتقالات المراحل | `opportunity:read@…` | ERR/LIST |
| POST | `/api/opportunities/:id/submit-go-nogo` | رفع قرار المشاركة لسير الاعتماد (`workflow: opportunity_go_nogo`) | `opportunity:update@…` + `approval_request:create@own` | ERR/APPROVE |
| POST | `/api/opportunities/:id/convert` | تحويل فرصة فائزة إلى مشروع (لا آلي؛ يدوي موجّه) | `project:create@sector` | ERR/CREATE + `409 invalid_transition`(ليست WON) |
| GET | `/api/pipeline/summary?sector_id=` | تجميع الفرص بالمراحل (عدد/قيمة) للوحات | `opportunity:read@sector` | ERR/LIST |

**Schema `Opportunity`:** `{ "id","code","title_ar","client_id","sector_id","owner_user_id","stage_id","win_pct","value_halalas","priority","year","source","next_action","notes","exclude_from_sales","stage_changed_at","created_at","updated_at" }` (`value_halalas` gate:value — planned).
**`OpportunityCreate`:** `{ "title_ar"(مطلوب),"client_id?","sector_id?"(افتراضي قطاع المستخدم),"owner_user_id?","stage_id?"(افتراضي LEAD),"value_sar?","priority?","year?","source?","next_action?","notes?","exclude_from_sales?" }`.
**`OpportunityPatch`:** أي من `{ "title_ar","client_id","priority","next_action","notes","win_pct","value_sar","exclude_from_sales" }` (المرحلة عبر `/stage` فقط).
**`POST /stage`** Request: `{ "to_stage":"PROPOSAL", "note?":"…" }` → Response: الفرصة بعد التحديث. القيم: `LEAD, QUALIFIED, PROPOSAL, WON, LOST, ON_HOLD`. الانتقال لأي مرحلة مسموح (لا قيد تسلسل صارم حالياً) لكن مرحلة مجهولة → `400`.

## 5.2 العملاء وجهات الاتصال (`client`, `contact`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/clients` | قائمة (`?type=&active=&q=`) | `client:read@sector` | ERR/LIST |
| POST | `/api/clients` | إنشاء عميل | `client:create@sector`(sector_lead/bd) | ERR/CREATE |
| GET | `/api/clients/:id` | تفاصيل + جهات الاتصال | `client:read@…` | ERR/READ |
| PATCH | `/api/clients/:id` | تعديل (بما فيه `type` لسدّ فجوة 71 بلا تصنيف) | `client:update@sector` | ERR/UPDATE |
| DELETE | `/api/clients/:id` | تعطيل (soft) | `client:delete@sector` | ERR/DELETE |
| POST | `/api/clients/:id/merge` | دمج عميل مكرر في آخر (aliases) | `client:update@sector` + `client:delete@sector` | ERR/WRITE + `409 conflict` |
| GET/POST | `/api/clients/:id/contacts` | جهات اتصال العميل (`email/phone` gate:contact — planned) | `client:read/update@…` | ERR/LIST · ERR/CREATE |
| PATCH/DELETE | `/api/contacts/:id` | تعديل/حذف جهة اتصال | `client:update@…` | ERR/UPDATE · ERR/DELETE |

**Schema `Client`:** `{ "id","code","name_ar","name_en","type","sector_market","active","created_at","updated_at" }`. `type ∈ {حكومي, خاص, داخلي, شبه حكومي}`.
**`ClientMerge`** Request: `{ "target_id":"cl_keep", "alias":true }` → يعيد التوجيه المراجع (opportunities/projects) للعميل الهدف ويحفظ اسم المصدر كـalias، ثم يعطّل المصدر.

## 5.3 العروض والتسعير (`proposal`, `pricing_line`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/opportunities/:oppId/proposals` | عروض الفرصة | `proposal:read@sector` | ERR/LIST |
| POST | `/api/opportunities/:oppId/proposals` | إنشاء عرض (نسخة) | `proposal:create@sector`(bd/sector_lead) | ERR/CREATE |
| GET | `/api/proposals/:id` | تفاصيل عرض (`margin_pct` محجوب — gate:margin) | `proposal:read@…` | ERR/READ |
| PATCH | `/api/proposals/:id` | تعديل عرض (draft فقط) | `proposal:update@…` | ERR/UPDATE + `423 resource_locked`(بعد submit) |
| POST | `/api/proposals/:id/submit-approval` | رفع للاعتماد (`workflow: proposal_approval`) | `proposal:update@…` + `approval_request:create@own` | ERR/APPROVE |
| POST | `/api/proposals/:id/approve` | قرار اعتماد العرض (يمرّ عبر محرك الاعتماد) | `proposal:approve@sector` | ERR/APPROVE |
| GET/POST | `/api/proposals/:id/pricing-lines` | بنود التسعير (`unit_cost_halalas` gate:cost) | `proposal:read/update@…` | ERR/LIST · ERR/CREATE |
| PATCH/DELETE | `/api/pricing-lines/:id` | تعديل/حذف بند | `proposal:update@…` | ERR/UPDATE · ERR/DELETE |

**Schema `Proposal`:** `{ "id","opportunity_id","version","kind","value_halalas","margin_pct","status","submitted_at","created_at" }`. `kind ∈ {technical, financial, combined}`. `status ∈ {draft, internal_review, approved, submitted}`.
**Schema `PricingLine`:** `{ "id","proposal_id","label","qty","unit_cost_halalas","unit_price_halalas" }` (يقبل `unit_cost_sar/unit_price_sar` كتابةً؛ `unit_cost_halalas` يُحجب قراءةً/يُسقَط كتابةً لمن لا يملك gate:cost).

## 5.4 الخدمات والباقات والموردون (`service`, `service_package`, `supplier`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/services` | كتالوج الخدمات (`?sector_id=&category=&status=`) | `service:read@sector` | ERR/LIST |
| POST/GET/PATCH/DELETE | `/api/services` · `/:id` | CRUD خدمة | `service:*@sector`(sector_lead/bd) | ERR/* |
| GET/POST | `/api/services/:id/packages` | باقات الخدمة (`cost_halalas` gate:cost) | `service:read/update@…` | ERR/LIST · ERR/CREATE |
| PATCH/DELETE | `/api/service-packages/:id` | تعديل/حذف باقة | `service:update@…` | ERR/UPDATE · ERR/DELETE |
| GET | `/api/suppliers` | قائمة الموردين (`email/phone/contact_person` gate:contact — planned) | `supplier:read@company/sector` | ERR/LIST |
| POST/GET/PATCH/DELETE | `/api/suppliers` · `/:id` | CRUD مورّد | `supplier:*@company`(procurement) · `update@sector`(sector_lead) | ERR/* |
| GET | `/api/stages` | ثوابت المراحل (6) + نِسَب الفوز | `opportunity:read@…` | ERR/LIST |

**Schema `Service`:** `{ "id","name_ar","name_en","category","sector_id","owner_user_id","status","summary","created_at","updated_at" }`.
**Schema `ServicePackage`:** `{ "id","service_id","name_ar","price_halalas","cost_halalas","supplier_id","notes" }`.
**Schema `Supplier`:** `{ "id","name_ar","name_en","org","contact_person","phone","email","status","notes","created_at" }`.

---

# 6. pmo — المحافظ/البرامج/المشاريع/المهام/المعالم/المخرجات/المخاطر/القضايا

الوحدة: `src/modules/pmo/*` (`projects.js`, `tasks.js` قائمان). جداول: `portfolio, program, project, workstream, milestone, deliverable, task, dependency, risk, issue, decision, change_request, action_item, lesson_learned`.

## 6.1 المحافظ والبرامج (`portfolio`, `program`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET/POST | `/api/portfolios` · `/:id` (GET/PATCH/DELETE) | CRUD محفظة (عبر القطاعات) | `project:read@company`(ceo/ops) · `admin` للإنشاء | ERR/* |
| GET/POST | `/api/programs` · `/:id` | CRUD برنامج (`?portfolio_id=&sector_id=`) | `project:read@sector`؛ `create/update` sector_lead | ERR/* |

## 6.2 المشاريع (`project`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/projects` | قائمة مُقيّدة (`?sector_id=&status=&rag=&kind=&owner_user_id=&program_id=&q=`) فرز `-updated_at` | `project:read@sector` | ERR/LIST |
| POST | `/api/projects` | إنشاء مشروع | `project:create@sector` | ERR/CREATE |
| GET | `/api/projects/:id` | تفاصيل (`actual_spend_halalas` gate:cost، `margin_pct` gate:margin) | `project:read@…` | ERR/READ |
| PATCH | `/api/projects/:id` | تعديل (الماليات قابلة للكتابة حسب البوابة) | `project:update@sector/project` | ERR/UPDATE |
| DELETE | `/api/projects/:id` | حذف منطقي | `project:delete@sector` | ERR/DELETE |
| GET | `/api/projects/:id/summary` | تجميع مالي/تقدّم/أعلام خطر للمشروع | `project:read@…` | ERR/READ |
| GET | `/api/projects/:id/team` | فريق المشروع (memberships) | `project:read@…` | ERR/LIST |
| GET | `/api/projects/:id/tasks` | مهام المشروع | `project:read@…` | ERR/LIST |
| GET | `/api/projects/:id/deliverables` | مخرجات المشروع | `deliverable:read@…` | ERR/LIST |
| GET | `/api/projects/:id/allocations` | تسكين المشروع | `allocation:read@…` | ERR/LIST |
| GET | `/api/portfolio/overview` | نظرة موحّدة على كل المشاريع (company) | `project:read@company` | ERR/LIST |

**Schema `Project`:** `{ "id","code","financial_code","name_ar","name_en","program_id","portfolio_id","client_id","sector_id","owner_user_id","pm_name","source_opp_id","status","rag","kind","is_sector_project","budget_halalas","actual_spend_halalas","revenue_halalas","contract_value_halalas","po_value_halalas","margin_pct","progress_pct","start_date","end_date","created_at","updated_at" }`. `status ∈ {NOT_STARTED, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED}`؛ `rag ∈ {GREEN, AMBER, RED}`؛ `kind ∈ {external, internal, product}`.
**`ProjectCreate`:** `{ "name_ar"(مطلوب),"sector_id?","client_id?","owner_user_id?","status?","rag?","kind?","budget_sar?","contract_value_sar?","start_date?","end_date?","source_opp_id?" }`.
**`ProjectPatch`:** `{ "name_ar","status","rag","progress_pct","start_date","end_date","pm_name","budget_sar","contract_value_sar" }`.

## 6.3 المهام + الإضافة السريعة (`task`, `dependency`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/tasks/mine` | «مهامي» (`?status=&today=true`) | `task:read@own` | ERR/LIST |
| GET | `/api/tasks` | مهام ضمن نطاق (`?project_id=&assignee_user_id=&status=&sector_id=`) | `task:read@project/sector` | ERR/LIST |
| POST | `/api/tasks/quick-add` | إضافة سريعة (عنوان فقط؛ المُسنَد=الذات افتراضاً) | `task:create@own` · `task:update@project`(لإسناد لغيره) | ERR/CREATE + `403 forbidden`(إسناد لغيره بلا صلاحية) |
| POST | `/api/tasks` | إنشاء كامل | `task:create@own/project` | ERR/CREATE |
| GET | `/api/tasks/:id` | تفاصيل مهمة | `task:read@…` · `own` | ERR/READ |
| PATCH | `/api/tasks/:id` | تعديل (`status=DONE` يضبط `completed_at`+`progress=100`) | `task:update@…` · `own` | ERR/UPDATE |
| DELETE | `/api/tasks/:id` | حذف منطقي | `task:update@project` · `own`(منشئها) | ERR/DELETE |
| POST | `/api/tasks/:id/dependencies` | إضافة تبعية (`depends_on_task_id`, `type`) | `task:update@…` | ERR/CREATE + `409 conflict`(دورة) |
| DELETE | `/api/dependencies/:id` | إزالة تبعية | `task:update@…` | ERR/DELETE |

**Schema `Task`:** `{ "id","parent_task_id","project_id","opportunity_id","sector_id","deliverable_id","work_kind","title","description","assignee_user_id","priority","status","start_date","due_date","estimate_hours","actual_hours","progress_pct","blocked_reason","recurring","created_at","completed_at" }`. `status ∈ {TODO, IN_PROGRESS, BLOCKED, IN_REVIEW, DONE, CANCELLED}`؛ `work_kind ∈ {project, opportunity, internal, product, proposal}`.
**`QuickAddTask`** Request: `{ "title"(مطلوب),"project_id?","sector_id?","assignee_user_id?","priority?","due_date?","work_kind?" }` → Response: كائن `Task`.

## 6.4 المعالم والمخرجات (`milestone`, `deliverable`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET/POST | `/api/projects/:id/milestones` | معالم المشروع | `project:read@…` · `deliverable:create@…` | ERR/LIST · ERR/CREATE |
| PATCH/DELETE | `/api/milestones/:id` | تعديل/حذف معلم | `project:update@…` | ERR/UPDATE · ERR/DELETE |
| GET | `/api/deliverables` | قائمة (`?project_id=&status=&sector_id=&year=&month=`) | `deliverable:read@sector` | ERR/LIST |
| POST | `/api/deliverables` | إنشاء مخرج | `deliverable:create@…`(pm/sector_lead) | ERR/CREATE |
| GET | `/api/deliverables/:id` | تفاصيل (`amount_halalas` gate:value — planned) | `deliverable:read@…` | ERR/READ |
| PATCH | `/api/deliverables/:id` | تعديل | `deliverable:update@…` | ERR/UPDATE |
| POST | `/api/deliverables/:id/status` | تغيير الحالة (يشغّل محرك الإيراد R3 عند INVOICED/PAID) | `deliverable:update@…` · `approve@project`(للاعتماد) | ERR/APPROVE + `409 invalid_transition` |
| DELETE | `/api/deliverables/:id` | حذف منطقي | `deliverable:delete@sector` | ERR/DELETE |

**Schema `Deliverable`:** `{ "id","project_id","milestone_id","name_ar","amount_halalas","month","year","phase","phase_name_ar","status","delivered_at","accepted_at","notes","sector_id","created_at","updated_at" }`. `status ∈ {PENDING, DELIVERED, ACCEPTED, INVOICED, PAID, REJECTED}`.
**`POST /status`** Request: `{ "to_status":"INVOICED", "note?":"…" }`. الانتقال إلى `INVOICED/PAID` يُنشئ/يحدّث `revenue_line` آلياً (محرك R3، `auto=1, rule_id='R3'`)؛ التراجع عنه يحذف السطر الآلي. انتقالات غير المنطقية (مثل `PAID→PENDING` دون صلاحية) → `409 invalid_transition`.

## 6.5 المخاطر والقضايا وبقية سجلّات المشروع

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET/POST | `/api/projects/:id/risks` | مخاطر المشروع | `project:read/update@…` | ERR/LIST · ERR/CREATE |
| PATCH/DELETE | `/api/risks/:id` | تعديل/حذف مخاطرة | `project:update@…` | ERR/UPDATE · ERR/DELETE |
| GET/POST | `/api/projects/:id/issues` | قضايا المشروع | `project:read/update@…` | ERR/LIST · ERR/CREATE |
| PATCH/DELETE | `/api/issues/:id` | تعديل/حذف قضية | `project:update@…` | ERR/UPDATE · ERR/DELETE |
| GET/POST | `/api/projects/:id/decisions` · `/change-requests` · `/action-items` · `/lessons` | سجلّات الحوكمة للمشروع | `project:read/update@…` | ERR/LIST · ERR/CREATE |
| PATCH/DELETE | `/api/{decisions,change-requests,action-items,lessons}/:id` | تعديل/حذف | `project:update@…` | ERR/UPDATE · ERR/DELETE |

**Schema `Risk`:** `{ "id","project_id","sector_id","title","probability","impact","exposure","mitigation","owner_user_id","status","created_at" }` (`probability/impact ∈ {low,medium,high}`؛ `status ∈ {OPEN,MITIGATING,CLOSED}`).
**Schema `Issue`:** `{ "id","project_id","title","severity","status","owner_user_id","opened_at","closed_at","created_at" }`.

---

# 7. timesheets — الجداول الزمنية

الوحدة: `src/modules/timesheets/timesheets.js` (قائم). جداول: `timesheet_period, time_entry`. حدّ `MAX_HOURS_PER_DAY=16`.

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/timesheets/entries` | قيودي (`?from=&to=`) | `timesheet:read@own` | ERR/LIST |
| POST | `/api/timesheets/entries` | إضافة قيد ساعات (تحقق ≤16/يوم؛ يرفع `actual_hours` للمهمة) | `timesheet:create@own` | ERR/CREATE + `400 bad_request`(ساعات/تاريخ) |
| PATCH | `/api/timesheets/entries/:id` | تعديل قيد (قبل الاعتماد) | `timesheet:update@own` | ERR/UPDATE + `423 resource_locked`(فترة معتمدة) |
| DELETE | `/api/timesheets/entries/:id` | حذف قيد (soft، قبل الاعتماد) | `timesheet:update@own` | ERR/DELETE + `423 resource_locked` |
| POST | `/api/timesheets/timer/start` | بدء مؤقّت حيّ (`task_id?/project_id?`) | `timesheet:create@own` | ERR/CREATE + `409 conflict`(مؤقّت يعمل) |
| POST | `/api/timesheets/timer/stop` | إيقاف المؤقّت → يحوّله لقيد ساعات | `timesheet:update@own` | ERR/WRITE + `404 not_found`(لا مؤقّت) |
| GET | `/api/timesheets/timer` | حالة المؤقّت الجاري | `timesheet:read@own` | ERR/READ |
| POST | `/api/timesheets/submit` | تقديم فترة (`period_start/period_end`) للاعتماد | `timesheet:create@own` | ERR/CREATE + `400 bad_request` |
| GET | `/api/timesheets/periods` | فتراتي (`?status=`) | `timesheet:read@own` | ERR/LIST |
| GET | `/api/timesheets/approvals` | فترات بانتظار اعتمادي (فريق/قطاع) | `timesheet:approve@team/sector` | ERR/LIST |
| POST | `/api/timesheets/periods/:id/approve` | اعتماد/رفض فترة | `timesheet:approve@team/sector/department` | ERR/APPROVE |
| GET | `/api/timesheets/utilization?user_id=&from=&to=` | نسبة الإشغال (billable/total) | `timesheet:read@own` · `@team/sector`(لغيره) | ERR/READ |

**Schema `TimeEntry`:** `{ "id","user_id","period_id","task_id","project_id","opportunity_id","work_kind","entry_date","hours","billable","note","timer_started_at","created_at","updated_at" }`. `work_kind ∈ {project, opportunity, proposal, product, internal, leave, training, bd}`.
**`AddEntry`** Request: `{ "entry_date"(YYYY-MM-DD, مطلوب),"hours"(0<h≤16, مطلوب),"task_id?","project_id?","opportunity_id?","work_kind?","billable?","note?" }`.
**`ApprovePeriod`** Request: `{ "approve": true|false, "comment?":"…" }` → Response: `TimesheetPeriod` بحالة `APPROVED/REJECTED`.

---

# 8. workflow — سير الاعتمادات

الوحدة: `src/modules/workflow/engine.js` (قائم). جداول: `workflow_definition, approval_step, approval_request, approval_action`. السقوف المالية في §9 من `02-rbac.md` (`APPROVAL_LIMIT`).

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/workflows` | تعريفات المسارات (`?target_resource=&active=`) | `settings:read@company` · admin | ERR/LIST |
| POST | `/api/workflows` | إنشاء تعريف مسار | `settings:admin@company` (admin) | ERR/CREATE |
| GET | `/api/workflows/:id` | تفاصيل + خطواته | `settings:read@company` | ERR/READ |
| PATCH | `/api/workflows/:id` | تعديل تعريف | `settings:admin@company` | ERR/UPDATE |
| PUT | `/api/workflows/:id/steps` | استبدال خطوات المسار (order/role/scope/min_amount) | `settings:admin@company` | ERR/UPDATE |
| POST | `/api/approvals` | رفع طلب اعتماد (`workflowKey, resource, resourceId, amount_sar?, sector_id?`) | `approval_request:create@own` | ERR/CREATE + `400 bad_request`(مسار مجهول) |
| GET | `/api/approvals` | طلبات ضمن نطاقي (`?status=&resource=&mine=true`) | `approval_request:read@sector/department` | ERR/LIST |
| GET | `/api/approvals/queue` | طابور بانتظار اعتمادي (دور+نطاق مطابق للخطوة) | `approval_request:approve@…` | ERR/LIST |
| GET | `/api/approvals/:id` | تفاصيل طلب + سجل إجراءاته | `approval_request:read@…` | ERR/READ |
| POST | `/api/approvals/:id/actions` | اتخاذ قرار (`approve/reject/return` + `comment?`) | `approval_request:approve@…` + `<resource>:approve@…` | ERR/APPROVE + `403 forbidden`(لست المعتمِد/فوق السقف), `400 bad_request`(الطلب مُغلق) |
| POST | `/api/approvals/:id/cancel` | إلغاء الطلب (المُنشئ فقط، وهو مفتوح) | `approval_request:update@own` | ERR/WRITE + `409 invalid_transition` |

**Schema `ApprovalRequest`:** `{ "id","workflow_id","resource","resource_id","requested_by","amount_halalas","sector_id","current_step","status","created_at","closed_at" }`. `status ∈ {PENDING, APPROVED, REJECTED, CANCELLED}`.
**`POST /actions`** Request: `{ "action":"approve|reject|return", "comment?":"…" }` → Response: `ApprovalRequest` بعد تقدّم الخطوة/الإغلاق.
**قواعد إنفاذ مؤكدة (من `engine.js`):**
- المعتمِد يجب أن يطابق `approver_role` للخطوة الحالية (أو `admin`) **و** يملك `can(user,'approve',resource,{sector_id})`.
- **فصل المهام:** المُنشئ لا يعتمد طلبه (`requested_by === user.id` → `403`).
- **السقف المالي:** `amount_halalas > cap(role)` → `403` (السلّم L1..L6). تجاوز السقف يصعّد للخطوة الأعلى.
- `approve` على آخر خطوة → `status=APPROVED` وإشعار المُنشئ؛ `reject` → `REJECTED`.

---

# 9. finance — العقود/الفواتير/التحصيل/المصروفات/الموازنات/المشتريات

الوحدة: `src/modules/finance/*`. جداول: `contract, contract_payment, invoice, collection, expense, cost_line, revenue_line, purchase_order, budget`. المالك المالي `finance@company`؛ `sector_lead@sector` جزئياً؛ حقول المبالغ gate:cost/value حسب المورد.

## 9.1 العقود والدفعات (`contract`, `contract_payment`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/contracts` | قائمة (`?client_id=&project_id=&sector_id=&status=`) | `contract:read@company/sector` | ERR/LIST |
| POST/GET/PATCH/DELETE | `/api/contracts` · `/:id` | CRUD عقد | `contract:create/update@company`(finance) · `update@sector`(lead) | ERR/* |
| POST | `/api/contracts/:id/sign` | توثيق التوقيع (`signed_at`, `status=ACTIVE`) | `contract:update@company` | ERR/APPROVE + `409 invalid_transition` |
| GET/POST | `/api/contracts/:id/payments` | دفعات العقد التعاقدية (مرتبطة بمعالم) | `contract:read/update@…` | ERR/LIST · ERR/CREATE |
| PATCH | `/api/contract-payments/:id` | تحديث حالة دفعة (`SCHEDULED→INVOICED→PAID`) | `contract:update@company` | ERR/UPDATE + `409 invalid_transition` |

**Schema `Contract`:** `{ "id","code","client_id","project_id","sector_id","value_halalas","start_date","end_date","status","signed_at","created_at" }`. `status ∈ {DRAFT, ACTIVE, COMPLETED, TERMINATED}`.
**Schema `ContractPayment`:** `{ "id","contract_id","label","amount_halalas","due_date","milestone_id","status" }`.

## 9.2 الفواتير والتحصيل (`invoice`, `collection`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/invoices` | قائمة (`?status=&client_id=&project_id=&overdue=true`) | `invoice:read@company/sector` | ERR/LIST |
| POST | `/api/invoices` | إنشاء فاتورة (يدوي أو من مخرج/دفعة) | `invoice:create@company`(finance) | ERR/CREATE |
| GET/PATCH/DELETE | `/api/invoices/:id` | تفاصيل/تعديل/إلغاء | `invoice:read/update@…` | ERR/* |
| POST | `/api/invoices/:id/issue` | إصدار (`DRAFT→ISSUED`, يضبط `issue_date/due_date`) | `invoice:approve@company` | ERR/APPROVE |
| GET/POST | `/api/invoices/:id/collections` | تحصيلات الفاتورة (تحدّث الحالة تلقائياً) | `invoice:read/update@company` | ERR/LIST · ERR/CREATE |
| GET | `/api/finance/ar-aging?sector_id=` | تقرير أعمار الذمم (buckets 0-30/31-60/61-90/90+) | `invoice:read@company` · `report:read@…` | ERR/LIST |

**Schema `Invoice`:** `{ "id","code","contract_id","project_id","client_id","deliverable_id","sector_id","amount_halalas","issue_date","due_date","status","created_at" }`. `status ∈ {DRAFT, ISSUED, PARTIALLY_PAID, PAID, OVERDUE, CANCELLED}`. إضافة `collection` مجموعها = المبلغ → `PAID`؛ أقل → `PARTIALLY_PAID`.
**Schema `Collection`:** `{ "id","invoice_id","amount_halalas","collected_at","method" }`.

## 9.3 المصروفات وأسطر التكلفة/الإيراد (`expense`, `cost_line`, `revenue_line`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/expenses` | قائمة (`?project_id=&sector_id=&status=&year=&month=`) (`amount_halalas` gate:cost) | `expense:read@sector/company` | ERR/LIST |
| POST/GET/PATCH/DELETE | `/api/expenses` · `/:id` | CRUD مصروف | `expense:create/update@sector`(lead) · `@company`(finance) | ERR/* |
| POST | `/api/expenses/:id/submit` | تقديم للاعتماد (`workflow: expense_approval`) | `expense:update@…` + `approval_request:create@own` | ERR/APPROVE |
| POST | `/api/expenses/:id/approve` | اعتماد/رفض مصروف (عبر المحرك، بسقف) | `expense:approve@sector/department/company` | ERR/APPROVE |
| GET | `/api/cost-lines` | أسطر التكلفة (`?project_id=&sector_id=&year=&type=`) (`amount_halalas` gate:cost/PAYROLL) | `cost_line:read@company/sector` | ERR/LIST |
| POST/PATCH/DELETE | `/api/cost-lines` · `/:id` | CRUD سطر تكلفة | `cost_line:create/update@company`(finance) · `update@sector`(lead) | ERR/* |
| GET | `/api/revenue-lines` | أسطر الإيراد (مشتقّة R3 + يدوية) (`?project_id=&sector_id=&year=&auto=`) | `revenue_line:read@company/sector` | ERR/LIST |
| POST/PATCH/DELETE | `/api/revenue-lines` · `/:id` | CRUD سطر إيراد يدوي (الآلي `auto=1` غير قابل للتعديل اليدوي) | `revenue_line:create/update@company`(finance) · `update@sector`(lead) | ERR/* + `423 resource_locked`(auto=1) |

**Schema `Expense`:** `{ "id","project_id","sector_id","type","amount_halalas","incurred_month","incurred_year","requested_by","status","created_at" }`. `status ∈ {DRAFT, SUBMITTED, APPROVED, REJECTED, PAID}`.
**Schema `RevenueLine`:** `{ "id","project_id","sector_id","deliverable_id","amount_halalas","month","year","label","auto","rule_id","created_at" }`. `auto=1` = مولّد آلياً من مخرج مفوتر (R3)؛ تعديله/حذفه يدوياً → `423 resource_locked` (يتغيّر بتغيير حالة المخرج).
**Schema `CostLine`:** `{ "id","project_id","sector_id","type","amount_halalas","month","year","source" }`. `type` نصي (`رواتب` → gate:salary/PAYROLL؛ غيره gate:cost).

## 9.4 المشتريات والموازنات (`purchase_order`, `budget`)

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/purchase-orders` | أوامر الشراء (`?supplier_id=&project_id=&status=`) | `purchase_order:read@company/sector` | ERR/LIST |
| POST/GET/PATCH/DELETE | `/api/purchase-orders` · `/:id` | CRUD أمر شراء | `purchase_order:create/update@company`(procurement) · `create@project`(pm) | ERR/* |
| POST | `/api/purchase-orders/:id/approve` | اعتماد PO (بسقف) | `purchase_order:approve@company` | ERR/APPROVE |
| GET | `/api/budgets` | الموازنات (`?fiscal_year=&sector_id=`) (`target_margin_pct` gate:margin) | `budget:read@company/sector` | ERR/LIST |
| POST | `/api/budgets` | إنشاء موازنة سنة/قطاع | `budget:create@sector`(lead) · `@company`(finance/ceo) | ERR/CREATE + `409 conflict`(موجودة لنفس السنة/القطاع) |
| GET/PATCH | `/api/budgets/:id` | تفاصيل/تعديل (المستهدفات + `cost_assumptions` + `monthly`) | `budget:read/update@…` | ERR/READ · ERR/UPDATE |
| POST | `/api/budgets/:id/approve` | اعتماد الموازنة (أعلى السلّم ceo) | `budget:approve@sector/company` | ERR/APPROVE |

**Schema `Budget`:** `{ "id","fiscal_year","sector_id","target_revenue_halalas","target_sales_halalas","target_margin_pct","cost_assumptions_json","monthly_json","created_at","updated_at" }`. `sector_id=null` = موازنة الشركة.
**Schema `PurchaseOrder`:** `{ "id","code","supplier_id","project_id","sector_id","amount_halalas","status","created_at" }`. `status ∈ {DRAFT, APPROVED, ISSUED, RECEIVED, PAID}`.

## 9.5 التسكين الشهري (`allocation`) — مالي/تشغيلي مشترك

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/allocations` | مصفوفة التسكين (`?sector_id=&project_id=&employee_id=&year=`) | `allocation:read@sector` · `own` | ERR/LIST |
| POST/GET/PATCH/DELETE | `/api/allocations` · `/:id` | CRUD تسكين (`monthly_json = {"2":1,"3":0.5}`) | `allocation:create/update/delete@sector`(lead) · `@project`(pm) | ERR/* |
| GET | `/api/allocations/matrix?sector_id=&year=` | عرض مصفوفي (أشخاص×أشهر) مع متوسط الإشغال | `allocation:read@sector` | ERR/LIST |

**Schema `Allocation`:** `{ "id","employee_id","person_name_ar","project_id","project_name","sector_id","type","monthly_json","month_start","month_end","year","source","created_at" }`.

---

# 10. reports — التقارير واللقطات والـKPI

الوحدة: `src/modules/reports/*` + `src/core/reports/*`. جداول: `report_definition, report_schedule, report_snapshot, kpi_definition, recipient_group, recipient`.

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/reports` | تعريفات التقارير (`?level=&active=`) | `report:read@scope` | ERR/LIST |
| POST/GET/PATCH/DELETE | `/api/reports` · `/:id` | CRUD تعريف تقرير | `report:read`؛ الإنشاء/التعديل `settings:admin`(admin) · `report:export`(sector_lead) | ERR/* |
| POST | `/api/reports/:id/run` | تشغيل التقرير الآن (`?sector_id=&period=&format=json|html`) → بيانات مُقيّدة بالنطاق ومحجوبة الحقول | `report:read@scope` | ERR/READ + `422 validation_error`(معاملات) |
| POST | `/api/reports/:id/export` | تصدير (Excel/CSV/PDF) — يُدقَّق دائماً | `report:export@scope` | ERR/WRITE + `403 forbidden` |
| GET | `/api/reports/:id/snapshots` | لقطات محفوظة | `report:read@scope` | ERR/LIST |
| POST | `/api/reports/:id/snapshots` | حفظ لقطة (أرشفة نتيجة تشغيل) | `report:export@scope` | ERR/CREATE |
| GET | `/api/reports/snapshots/:id` | لقطة محددة (`html`/`data_json`) | `report:read@scope` | ERR/READ |
| GET | `/api/kpis` | تعريفات المؤشرات + قيمها المحسوبة (`?level=&sector_id=`) | `report:read@scope`(kpi) | ERR/LIST |
| POST/PATCH/DELETE | `/api/kpis` · `/:id` | CRUD تعريف KPI | `settings:admin@company` | ERR/* |
| GET | `/api/dashboards/ceo` | لوحة الرئيس التنفيذي (تجميع الشركة، مخاطر، خط الأنابيب) | `report:read@company`(ceo/admin) | ERR/READ |
| GET | `/api/dashboards/sector/:sectorId` | مركز قيادة القطاع | `report:read@sector` | ERR/READ |
| GET | `/api/dashboards/followup` | «ما يحتاج انتباهي» (بنود حرجة/متأخرة ضمن النطاق) | `report:read@scope` | ERR/READ |

**Schema `ReportDefinition`:** `{ "id","key","name_ar","level","detail_level","locale","template_key","active","created_at" }`. `level ∈ {company, sector, program, project, team, employee}`.
**`POST /run`** Response: `{ "report_id","period_label","generated_at","scope_ref","data": {…}, "html?": "…" }` — كل الأرقام المالية محجوبة بحسب دور الطالب.
**Schema `ReportSnapshot`:** `{ "id","report_id","scope_ref","period_label","html","data_json","created_at","created_by" }`.

---

# 11. email — القوالب والجدولة والمعاينة والاختبار والسجلات

الوحدة: `src/modules/reports/email*` + `src/core/mail/*`. جداول: `email_template, report_schedule, recipient_group, recipient, email_queue, email_log`. النقل: `preview` (dev، يكتب `.html` في `data/outbox`) / `smtp` (prod).

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/email/templates` | قوالب البريد | `settings:read@company` | ERR/LIST |
| POST/GET/PATCH/DELETE | `/api/email/templates` · `/:id` | CRUD قالب | `settings:admin@company`(admin) | ERR/* |
| POST | `/api/email/templates/:id/preview` | معاينة القالب ببيانات عيّنة أو `sample_ref` (بلا إرسال) | `settings:read@company` | ERR/WRITE + `422 validation_error` |
| GET | `/api/email/schedules` | جدولة التقارير (`?report_id=&active=`) | `report:read@scope` | ERR/LIST |
| POST/GET/PATCH/DELETE | `/api/email/schedules` · `/:id` | CRUD جدول إرسال | `report:export@scope` · `settings:admin` | ERR/* |
| POST | `/api/email/schedules/:id/run-now` | تنفيذ الجدول الآن (تجهيز الطابور) | `report:export@scope` | ERR/WRITE |
| POST | `/api/email/test-send` | إرسال اختباري لمستلم واحد (مقيّد بالمعدل 5/دقيقة) | `settings:admin@company` · `report:export@scope` | ERR/WRITE + `429 rate_limited`, `503 ai_unavailable`(لو SMTP معطّل) |
| GET | `/api/email/recipient-groups` | مجموعات المستلمين | `settings:read@company` | ERR/LIST |
| POST/PATCH/DELETE | `/api/email/recipient-groups` · `/:id` | CRUD مجموعة + أعضاء | `settings:admin@company` | ERR/* |
| GET | `/api/email/queue` | طابور البريد (`?status=`) | `settings:read@company`(admin) | ERR/LIST |
| GET | `/api/email/logs` | سجل أحداث البريد (`?queue_id=&event=`) | `settings:read@company`(admin) · `audit:read@company` | ERR/LIST |
| POST | `/api/email/queue/:id/retry` | إعادة محاولة رسالة فاشلة | `settings:admin@company` | ERR/WRITE + `409 invalid_transition` |

**Schema `ReportSchedule`:** `{ "id","report_id","recipient_group_id","sector_id","project_id","frequency","day_of_week","day_of_month","send_time","active","last_run_at","next_run_at","created_at" }`. `frequency ∈ {daily, weekly, biweekly, monthly, quarterly, yearly, custom}`.
**Schema `EmailLog`:** `{ "id","queue_id","event","detail","at" }`. `event ∈ {enqueued, sent, failed, retried}`.
**`POST /test-send`** Request: `{ "template_id?","schedule_id?","to":"user@evc.com.sa","sample_ref?":"prj_…" }`.

---

# 12. ai — المساعد الذكي

الوحدة: `src/core/ai/*`. جدول: `ai_activity_log`. مُعطَّل ما لم يوجد مفتاح (`config.ai.enabled`). **حوكمة إلزامية:** كل تعديل يقترحه المساعد يمرّ بمرحلة *preview* ثم *apply* صريحة من مستخدم مخوّل؛ لا كتابة مباشرة. كل تفاعل يُسجَّل.

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/ai/config` | حالة تفعيل المساعد + المزوّد + النموذج (بلا مفتاح) | `ai_config:read@company`(admin) | ERR/READ + `503 ai_unavailable` |
| PATCH | `/api/ai/config` | تهيئة المساعد (تفعيل/نموذج/حدود) | `ai_config:admin@company`(admin) | ERR/UPDATE |
| POST | `/api/ai/chat` | سؤال/إجابة (قراءة فقط؛ لا تعديل) — النتيجة مقيّدة بنطاق المستخدم | `ai_config:read` أو منح المورد المُستعلَم عنه | ERR/WRITE + `503 ai_unavailable`, `429 rate_limited` |
| POST | `/api/ai/preview` | توليد **معاينة تغيير** مقترح (diff على كيانات) دون تطبيق | صلاحية `update` على المورد الهدف ضمن نطاقه | ERR/WRITE + `422 validation_error`, `503 ai_unavailable` |
| POST | `/api/ai/apply` | تطبيق معاينة مُعتمدة (`preview_id` + تأكيد) — يمرّ بنفس فحوص `can()` كتعديل يدوي | `<resource>:update@…` (لكل كيان في المعاينة) + تدقيق | ERR/WRITE + `403 forbidden`, `409 conflict`(معاينة منتهية/مطبّقة) |
| GET | `/api/ai/activity` | سجل تفاعلات المساعد (النيّة/التطبيق/المُعتمِد) | `audit:read@company`(admin) | ERR/LIST |

**`POST /ai/preview`** Response: `{ "preview_id":"aip_…","intent":"apply_change","changes":[ { "resource":"opportunity","resource_id":"opp_…","before":{…},"after":{…} } ],"warnings":[…] }`. المعاينة تنتهي بعد 15 دقيقة.
**`POST /ai/apply`** Request: `{ "preview_id":"aip_…","confirm":true }` → يطبّق كل تغيير عبر مسار الكتابة العادي (redaction + can + audit)؛ أي تغيير يفشل فحصه يُرفض ويُبلَّغ دون تطبيق الباقي (ذرّية جزئية موثّقة في `details`).
**Schema `AiActivity`:** `{ "id","at","user_id","prompt","intent","applied","preview_json","approved_by" }`. `intent ∈ {summarize, draft_email, suggest, apply_change}`.

---

# 13. notifications — الإشعارات

الوحدة: `src/modules/notifications/notify.js` (قائم). جدول: `notification`.

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/notifications` | إشعاراتي (`?unread=true`) — 100 الأحدث | `notification:read@own` | ERR/LIST |
| GET | `/api/notifications/unread-count` | عدّاد غير المقروء | `notification:read@own` | ERR/READ |
| POST | `/api/notifications/:id/read` | تعليم كمقروء | `notification:read@own`(ملكية ضمنية) | ERR/WRITE + `404 not_found` |
| POST | `/api/notifications/read-all` | تعليم الكل كمقروء | `notification:read@own` | ERR/WRITE |
| POST | `/api/notifications` | إرسال إشعار (نظامي/إداري) | `notification:create@company`(admin/النظام) | ERR/CREATE |

**Schema `Notification`:** `{ "id","user_id","kind","title","body","ref_resource","ref_id","read_at","created_at" }`. القراءة/التعليم مقيّدة بـ`user_id === session.user` (إنفاذ في `markRead`).

---

# 14. audit — سجل التدقيق

الوحدة: `src/core/audit/*`. جدول: `audit_log` (+ `ai_activity_log`). **للقراءة والتصدير فقط** — لا مسارات كتابة/تعديل/حذف.

| Method | Path | الوصف | الصلاحية | الأخطاء |
|--------|------|-------|----------|---------|
| GET | `/api/audit` | سجل التدقيق (`?resource=&resource_id=&user_id=&action=&sector_id=&at_from=&at_to=`) مُرقّم، فرز `-at` | `audit:read@company`(admin/ceo/finance) · `@sector`(sector_lead) · `@own` | ERR/LIST |
| GET | `/api/audit/:id` | قيد تدقيق مفرد | `audit:read@…` | ERR/READ |
| POST | `/api/audit/export` | تصدير السجل (CSV) — يُدقَّق ذاته | `audit:export@company` | ERR/WRITE + `403 forbidden` |
| GET | `/api/audit/resource/:resource/:id` | تاريخ التدقيق لكيان محدد | `audit:read@…` + `<resource>:read@…` | ERR/LIST |

**Schema `AuditLog`:** `{ "id","at","user_id","username","role_id","action","resource","resource_id","sector_id","detail_json","ip" }`. `ip` gate:ip (admin فقط). `action ∈ {create, update, delete, approve, submit, login, export, sensitive-read, blocked-field-write, ...}`.
- قيد النطاق: غير admin يرى فقط قيود ضمن `sector_id` من نطاقه؛ `own` = `user_id === self`.

---

# 15. الملاحق

## ملحق أ — سجل بادئات المعرّفات (ID prefixes)

| البادئة | الكيان | البادئة | الكيان |
|---------|--------|---------|--------|
| `u_` | app_user | `emp_` | employee |
| `sess_` | session | `lh_` | login_history |
| `sec_` | sector | `dep_` | department |
| `unit_` | org_unit | `team_` | team |
| `pos_` | position | `mbr_` | membership |
| `cl_` | client | `ct_` | contact |
| `opp_` | opportunity | `osh_` | opportunity_stage_history |
| `prop_` | proposal | `pl_` | pricing_line |
| `svc_` | service | `pkg_` | service_package |
| `sup_` | supplier | `pf_` | portfolio |
| `pgm_` | program | `prj_` | project |
| `ws_` | workstream | `ms_` | milestone |
| `dlv_` | deliverable | `tsk_` | task |
| `dep2_` | dependency | `rsk_` | risk |
| `iss_` | issue | `tsp_` | timesheet_period |
| `te_` | time_entry | `wf_` | workflow_definition |
| `apr_` | approval_request | `apa_` | approval_action |
| `con_` | contract | `cpm_` | contract_payment |
| `inv_` | invoice | `col_` | collection |
| `exp_` | expense | `cst_` | cost_line |
| `rl_` | revenue_line | `po_` | purchase_order |
| `bdg_` | budget | `alc_` | allocation |
| `rpt_` | report_definition | `sch_` | report_schedule |
| `snp_` | report_snapshot | `kpi_` | kpi_definition |
| `tpl_` | email_template | `eq_` | email_queue |
| `el_` | email_log | `rg_` | recipient_group |
| `ntf_` | notification | `aud_` | audit_log |
| `aip_` | ai_preview | `aia_` | ai_activity_log |

> ملاحظة: أسماء البادئات الفعلية في الكود تُمرَّر إلى `id(prefix)`؛ الجدول اقتراح موحّد. المعرّفات القديمة (`o_`, `p_`, `u_`…) تُحفظ كما هي عند الترحيل.

## ملحق ب — كتالوج الموارد × الأفعال (مرجع سريع للتفويض)

`resource` القانونية (عمود `role_permission.resource`)، والأفعال المتوقعة عليها في هذا العقد:

| resource | read | create | update | delete | approve | export | admin | بوابات حساسة |
|----------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---------------|
| `sector` | ✓ | ✓ | ✓ | ✓ | | | ✓ | margin (target) |
| `department`,`unit`,`team`,`position` | ✓ | ✓ | ✓ | ✓ | | | | — |
| `employee` | ✓ | ✓ | ✓ | ✓ | | | | salary |
| `user` | ✓ | ✓ | ✓ | ✓ | | | ✓ | ip |
| `role`,`role_permission` | ✓ | ✓ | ✓ | ✓ | | | ✓ | — |
| `membership` | ✓ | ✓ | ✓ | ✓ | | | | — |
| `client`,`contact` | ✓ | ✓ | ✓ | ✓ | | | | contact (planned) |
| `opportunity` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | value (planned) |
| `proposal` | ✓ | ✓ | ✓ | ✓ | ✓ | | | margin |
| `pricing_line` | ✓ | ✓ | ✓ | ✓ | | | | cost |
| `service`,`service_package` | ✓ | ✓ | ✓ | ✓ | | | | cost (pkg) |
| `supplier` | ✓ | ✓ | ✓ | ✓ | | | | contact (planned) |
| `portfolio`,`program` | ✓ | ✓ | ✓ | ✓ | | | | — |
| `project` | ✓ | ✓ | ✓ | ✓ | | ✓ | | cost, margin, value |
| `task`,`dependency` | ✓ | ✓ | ✓ | ✓ | ✓ | | | — |
| `milestone` | ✓ | ✓ | ✓ | ✓ | | | | — |
| `deliverable` | ✓ | ✓ | ✓ | ✓ | ✓ | | | value (planned) |
| `risk`,`issue`,`decision`,`change_request`,`action_item`,`lesson_learned` | ✓ | ✓ | ✓ | ✓ | | | | — |
| `timesheet`,`time_entry` | ✓ | ✓ | ✓ | ✓ | ✓ | | | — |
| `workflow_definition` | ✓ | ✓ | ✓ | | | | ✓ | — |
| `approval_request` | ✓ | ✓ | ✓ | | ✓ | | ✓ | — |
| `contract`,`contract_payment` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | value |
| `invoice`,`collection` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | value |
| `expense` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | cost |
| `cost_line` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | cost/salary |
| `revenue_line` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | value |
| `purchase_order` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | cost |
| `budget` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | margin |
| `allocation` | ✓ | ✓ | ✓ | ✓ | | | | — |
| `report`,`kpi` | ✓ | ✓ | ✓ | ✓ | | ✓ | | — |
| `report_schedule`,`email_template`,`recipient_group` | ✓ | ✓ | ✓ | ✓ | | | ✓ | — |
| `ai_config` | ✓ | | ✓ | | | | ✓ | — |
| `notification` | ✓ | ✓ | ✓ | ✓ | | | | — |
| `audit` | ✓ | | | | | ✓ | | ip |
| `settings` | ✓ | | ✓ | | | | ✓ | — |
| `import_export` | | | | | | ✓ | ✓ | — |
| البوابات (pseudo): `salary`,`cost`,`margin`,`ip`,`value`(planned),`contact`(planned) | read فقط | | | | | | | تُقرأ لكشف الحقل |

## ملحق ج — نموذج طلب/استجابة مرجعي كامل (مثال تطبيقي)

**إنشاء فرصة:**
```
POST /api/opportunities
Cookie: sanad_sid=…
X-CSRF-Token: …
Idempotency-Key: 6f1c…-…
Content-Type: application/json; charset=utf-8

{ "title_ar":"تحوّل رقمي لجهة حكومية","client_id":"cl_moh","sector_id":"SOLUTIONS",
  "value_sar": 1250000, "priority":"P1", "stage_id":"QUALIFIED" }
```
```
201 Created
ETag: "2026-07-13T09:20:01.221Z"

{ "id":"opp_Ab3…","code":null,"title_ar":"تحوّل رقمي لجهة حكومية","client_id":"cl_moh",
  "sector_id":"SOLUTIONS","owner_user_id":"u_rayan","stage_id":"QUALIFIED","win_pct":25,
  "value_halalas":125000000,"priority":"P1","year":2026,"source":"manual",
  "exclude_from_sales":false,"stage_changed_at":"2026-07-13T09:20:01.221Z",
  "created_at":"2026-07-13T09:20:01.221Z","updated_at":"2026-07-13T09:20:01.221Z" }
```
**فشل نطاق (قطاع آخر):**
```
403 Forbidden
{ "error": { "code":"forbidden","message":"خارج نطاق قطاعك","details":null } }
```
**كتابة قديمة (تزامن):**
```
PATCH /api/opportunities/opp_Ab3…    (If-Match: "قيمة قديمة")
409 Conflict
{ "error": { "code":"conflict","message":"تعارض","details":{"reason":"stale_write","current_updated_at":"…"} } }
```

## ملحق د — قائمة اختبار قبول العقد (عيّنة)

1. `viewer` يستدعي `GET /api/projects/:id` → يُعاد المشروع مع `actual_spend_halalas=null,_redacted_...=true`, `margin_pct=null`.
2. `bd_manager` من قطاع A يستدعي `GET /api/opportunities/:id` لفرصة قطاع B → `404 not_found` (عدم كشف).
3. مستخدم بلا `Idempotency-Key` يعيد نفس `POST` مرتين → كيانان (سلوك بلا مفتاح)؛ ومع نفس المفتاح → كيان واحد.
4. `POST /api/approvals/:id/actions` من المُنشئ نفسه → `403 forbidden` (فصل مهام).
5. `POST /api/deliverables/:id/status {to_status:"INVOICED"}` → يظهر `revenue_line` جديد `auto=1,rule_id="R3"`؛ ثم إعادته لـ`DELIVERED` تحذفه.
6. كل كتابة تُنتج قيد `audit_log`؛ قراءة `admin` لـ`employee.salary_halalas` تُنتج قيد `sensitive-read`.
7. `PATCH` بترويسة `If-Match` قديمة → `409 conflict` دون تعديل.
8. `hr` يحاول `POST /api/users/:id/roles {role_id:"admin"}` → `403` (لا رفع دور)؛ ورؤية `login-history` → بلا `ip`.

---

**نهاية العقد.** كل مسار أعلاه قابل للتنفيذ المباشر فوق النواة القائمة (`can/scopeFilter/redact/audit`, مغلّف الأخطاء, بادئات المعرّفات, تحويل الهللات). المسارات المعلَّمة «planned» تنتظر تفعيل بوابات `value/contact` في `redact()` حسب `02-rbac.md §7`.
