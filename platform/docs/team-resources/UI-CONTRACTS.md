# عقود واجهة وحدة الفريق والموارد (المراحل C–G)

مرجعٌ ملزم لبناء الشاشات S01–S25 بالتوازي. اقرأ أولاً: `platform/CLAUDE.md`، `docs/team-resources/CONTRACTS.md` (أشكال الخدمات)، `docs/team-resources/EXECUTION-LOG.md` §1–§2 و§5 (الحقائق والقيود المعلنة)، وقسم الشاشات من الموجّه الأصلي (§4 و§11) مع صورة كل شاشة.

## 1. الهيكل المشترك — `src/web/views/team/_shell.js`
- كل صفحة تمرّ بـ`teamLayout({ user, path, section, title, subtitle, crumbs, actions, body, scripts, extraHead, year })`.
  - `path` ∈ `people|planning|work|analysis` (ثوابت `PATHS`), `section` مفتاح التبويب من `SECTION_TABS[path]`.
  - `crumbs`: `[{ label, href }]` بعد «الفريق › المسار» — آخر عنصر هو اسم الصفحة (يُعرض عريضاً بلا رابط).
  - `actions`: HTML أزرار الإجراء (يمين الرأس)، `scripts`: `['/static/pages/team-<x>.js']`.
  - العنوان الرئيسي يحمله رأس المنصة (`layout`) — **لا `<h1>` ثانٍ داخل الجسم**.
- مساعدات: `avatar(name)`, `person(name, job, { href, small })`, `pctChip(pct, band)` (`pct == null` ⇒ «—» خارج الارتباط), `typePill(type, label)`, `engagementPill(status, label)`, `stackBar(segs, { max })` (tones: proj/int/tent/over), `legend([[color,label]])`, `emptyState(title, sub)`, `monthLabel('YYYY-MM')`, `stepper(steps, currentIdx)`, `kv([[k, vHtml]])`, و`esc`, `pill`, `icon` معادة التصدير.
- الأصناف `tm-*` في `TEAM_CSS` (بطاقات، جداول، رقائق النسب `b-free|b-low|b-ok|b-near|b-over|b-out`، الدرج `tm-drawer`/`tm-scrim`، المصفوفة `tm-mx` مع تثبيت عمود المورد يميناً، النماذج `tm-form`، التنبيهات `tm-warn|tm-danger|tm-ok|tm-info`). أضِف أنماطاً خاصة بصفحتك داخل `<style>` في جسم الصفحة ببادئة `tm-<page>-` فقط.

## 2. المسارات وأسماء دوال الصفحات (ثابتة — `src/web/views/team/index.js` + `routes.js`)
| المسار | الدالة (ملف) | الشاشات |
|---|---|---|
| `/app/team` | `teamGatewayPage(user, opts)` — `gateway.js` | S01 |
| `/app/team/resources` | `resourcesPage(user, opts)` — `resources.js` | S02 + S03 (درج المعاينة) + S09 (درج الإضافة) |
| `/app/team/resources/:id` | `resourceProfilePage(user, employeeId, opts)` — `profile.js` | S04–S08، S10 (`?tab=overview|work|tasks|skills|engagement|audit`) + S09 (درج التعديل) |
| `/app/team/org` | `teamOrgPage(user, opts)` — `org.js` | S11 |
| `/app/team/people` | `teamPage` القائمة (views/people.js) — تبويب «حسابات الدخول» | — |
| `/app/team/work` | `teamWorkPage(user, opts)` — `work.js` | S12 |
| `/app/team/planning` | `planningPage(user, opts)` — `planning.js` | S13 + S14 + S15 (أدراج) |
| `/app/team/requests` | `requestsPage(user, opts)` — `requests.js` | S16 (القائمة + لوحة المراجعة) |
| `/app/team/requests/:id` | `requestDetailPage(user, requestId, opts)` — `requests.js` | S16 (طلب واحد) |
| `/app/team/analysis` | `analysisPage(user, opts)` — `analysis.js` | S17 |
| `/app/team/analysis/:employeeId` | `analysisCasePage(user, employeeId, opts)` — `analysis.js` | S18 (`?year=&month=`) |
| `/app/team/needs` | `needsPage(user, opts)` — `needs.js` | S19 + S20 (درج) |
| `/app/team/needs/:id` | `needCandidatesPage(user, needId, opts)` — `needs.js` | S21 |
| `/app/team/close` | `closePage(user, opts)` — `close.js` | S22 / S24 / S25 بحسب حالة الفترة (`?sector=&year=&month=`) |
| `/app/team/close/:employeeId` | `closeResourcePage(user, employeeId, opts)` — `close.js` | S23 (`?period=<periodId>`) |

`opts` = استعلام الرابط كما هو (`{ ...req.query }`) — الفلاتر والفترة تُقرأ منه وتُكتب إليه (الحالة تُحفظ في الرابط). بوابة الصفحات في `routes.js` (قراءة الموظف؛ الإقفال فوقها `canReadClose`) — **الخدمة هي البوابة الحقيقية** وترمي `forbidden()`؛ لا تفحص الصلاحيات في العرض إلا لإظهار/إخفاء الأزرار عبر ما تعيده الخدمة (`rights`, `planning`, `canConfirm` …).

## 3. الروابط بين الشاشات (سياق مسبق التعبئة عبر الاستعلام)
- فتح ملف المورد: `/app/team/resources/<employeeId>`؛ تبويب محدد: `?tab=tasks`. الشخصُ ذو الحساب: زر «مهامه وملفه» → `/app/person/<userId>` القائمة.
- طلب تسكين بسياق: `/app/team/planning?new=1&employee=<id>&target=<project|bucket>:<id>&from=YYYY-MM&to=YYYY-MM&need=<needId>` — صفحة التخطيط تفتح درج S14 عند التحميل بهذا السياق.
- الخلية المتجاوزة: `/app/team/planning?fix=1&employee=<id>&month=YYYY-MM` يفتح S15.
- طلب بعينه: `/app/team/requests/<id>`؛ فلتر «بانتظار قراري»: `/app/team/requests?filter=pending_my_decision`.
- فحص الحالة: `/app/team/analysis/<employeeId>?year=&month=`؛ الاحتياج: `/app/team/needs/<id>`.
- الإقفال: `/app/team/close?sector=&year=&month=`؛ مورد داخل الفترة: `/app/team/close/<employeeId>?period=<periodId>`.
- العمل الأصلي: مشروع `/app/project/<id>`، فرصة `/app/opportunity/<id>`، المهمة `/app/tasks?open=<taskId>` (إن وُجد نمط فتحٍ مباشر في `views/pmo.js` فاستعمله، وإلا رابط مهام الشخص).

## 4. واجهة البرمجة (كلها تحت `/api/team/...` — مركّبة في `api.routes.js`)
JSON بسيط؛ الأخطاء `{ error: { message } }` بالعربية. المسارات **القياسية** (أي موجّه خلفي يخالفها يُصلَح عند الدمج — لا تخترع مساراً بديلاً في الواجهة):

| الخدمة | المسار |
|---|---|
| listResources | `GET /team/resources?q&sector&department&type&status&from&to&page&pageSize` |
| resourcePreview | `GET /team/resources/:id/preview?from&to` |
| resourceProfile | `GET /team/resources/:id/profile?year&month` |
| linkedWork | `GET /team/resources/:id/linked-work?window=current\|past` |
| resourceCapabilities / upsert / remove | `GET /team/resources/:id/capabilities` · `POST /team/resources/:id/capabilities` (بـ`id` للتعديل) · `DELETE /team/resources/:id/capabilities/:capId` |
| engagement / setCapacity | `GET /team/resources/:id/engagement` · `POST /team/resources/:id/capacity { capacity_pct, effective_from, note }` |
| createResource / updateResource | `POST /team/resources` · `PATCH /team/resources/:id` |
| resourceAudit | `GET /team/resources/:id/audit?filter=all\|profile\|capacity\|allocation` |
| orgResources | `GET /team/org?department&q` |
| planningMatrix | `GET /team/planning?from&to&sector&department&q&showTentative` |
| previewChange | `POST /team/allocations/preview` (جسم = `change`) |
| submitRequest | `POST /team/allocations/requests { change, idempotencyKey, expectedFingerprints, draft, needId }` |
| listRequests / getRequest | `GET /team/allocations/requests?filter&q&from&to` · `GET /team/allocations/requests/:id` |
| decideRequest / withdrawRequest | `POST /team/allocations/requests/:id/decide { action, note }` · `POST /team/allocations/requests/:id/withdraw` |
| listNeeds / createNeed / updateNeed / cancelNeed | `GET /team/needs?from&to&department&status&certainty` · `POST /team/needs` · `PATCH /team/needs/:id` · `POST /team/needs/:id/cancel` |
| candidates / requestFromCandidate | `GET /team/needs/:id/candidates?department&q` · `POST /team/needs/:id/request { employeeId, pct, allocStatus }` |
| utilizationTable | `GET /team/analysis?year&month&department&signal` |
| caseDetail / createFollowup / closeCase | `GET /team/analysis/:employeeId/case?year&month` · `POST /team/analysis/:employeeId/followup` · `POST /team/analysis/cases/:caseId/close { explanation }` |
| teamCommitments | `GET /team/work?year&month&department&by=work\|resource` |
| periodOverview / generateDraft | `GET /team/close?sector&year&month` · `POST /team/close/:periodId/draft { preserveConfirmed }` |
| resourceShares / confirmShares | `GET /team/close/:periodId/resources/:employeeId` · `POST /team/close/:periodId/resources/:employeeId/confirm { lines, reason, sourceRef }` |
| sendToFinance / returnToManager / lockPeriod | `POST /team/close/:periodId/send` · `POST /team/close/:periodId/return { reason }` · `POST /team/close/:periodId/lock { expectedVersion }` |
| exportPeriod | `GET /team/close/:periodId/export` (ملف CSV) |
| createCorrection / decideCorrection | `POST /team/close/:periodId/resources/:employeeId/correction { proposed, reason, evidenceLabel }` · `POST /team/close/corrections/:id/decide { action, note }` |

## 5. الصفحة المعروضة خادمياً (SSR) + عميل الصفحة
- الصفحة تستدعي الخدمة مباشرة (استيراد من `src/modules/team/*.js`) وتعرض الحالة الأولى كاملةً خادمياً (بلا «تحميل» فارغ عند الفتح). التفاعل اللاحق (الأدراج، الفلاتر السريعة، الحفظ) عبر `fetch` إلى `/api/team/...`.
- البيانات التي يحتاجها العميل تُحقن في `window.__SANAD` (مقصوصة بصلاحية القارئ في الخادم؛ استبدل `<` بـ`<` كما في `views/people.js`).
- عميل الصفحة: `src/web/public/pages/team-<x>.js` — IIFE، **تفويض `data-action` فقط** (لا `onclick`)، مساعد `api()` كما في `public/pages/staffing.js`، رسائل عبر `Sanad.toast` إن وُجد وإلا مساعد محلي كما في `staffing.js`. لا نجاح قبل ردّ الخادم؛ تعطيل زر الحفظ أثناء الإرسال؛ خطأ الخادم يُعرض بنصّه ويسمح بإعادة المحاولة بلا تكرار (احتفظ بـ`idempotencyKey` الذي أنتجته المعاينة).
- الأدراج: `tm-drawer` + `tm-scrim`، إغلاق بـEsc والزر، **وإعادة التركيز للعنصر الذي فتحها**، وتحذير قبل إغلاق نموذج به تعديلات (`confirm` عربي). سباق الطلبات: احتفظ بمعرّف آخر طلب وتجاهل الردود الأقدم.
- الحالات المطلوبة (§4.3): لا موارد / لا نتائج للبحث (رسالتان مختلفتان) / بيانات ناقصة («غير متاح» ≠ صفر) / فشل الطلب مع إعادة المحاولة / لا صلاحية / مورد مؤرشف / فترة مقفلة / تعارض إصدار. استعمل `emptyState` و`tm-warn|tm-danger|tm-info`.
- النصوص عربية فقط، بلا مصطلحات تقنية، الأزرار ≤ 3 كلمات. الأرقام في `<span class="tnum">`. الشهر يُعرض بـ`monthLabel`. الألوان لا تحمل المعنى وحدها (نص مصاحب). RTL: الأشهر في المصفوفة من اليمين إلى اليسار زمنياً.
- لا مال في أي شاشة من المسارات الأربعة عدا الإقفال (وهو نسب توزيع لا رواتب).

## 6. الاختبارات
- لكل ملف عرض اختبار `tests/integration/team-ui-<x>.test.js` بنمط المستودع (migrate + seed-rbac على قاعدة مؤقتة، `resolveUser` عبر جلسة — انظر `tests/security/personal-department-grants.test.js`): يبني بيانات صغيرة (قطاع، إدارة، موظفون، مشروع، تسكين) ثم يستدعي دالة الصفحة ويؤكد: (1) الحالة 200 والعناصر الأساسية بالعربية، (2) لا تسرّب `undefined|NaN|null|[object`, (3) حالة الفراغ، (4) حجب ما لا يملكه الدور (زر/تبويب لا يظهر)، (5) قبول الشاشة كما في الموجّه §11 (مثل S02: 6 من 6 ⇒ «1–6 من 6»).
- تشغيل: `node --experimental-sqlite --test tests/integration/team-ui-<x>.test.js` من `platform/`. لا تشغّل المجموعة الكاملة (وكلاء آخرون يعملون بالتوازي).
- خدمات المرحلة B قد تكون قيد الهبوط أثناء عملك: إن غاب ملف خدمة، ابنِ الصفحة على شكل العقد، واكتب الاختبار، وأبلغ في تقريرك ما لم تستطع تشغيله. **لا تنشئ خدمة بديلة ولا تعدّل ملفات خارج ملفاتك.**
