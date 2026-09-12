# عقود خدمات وحدة الفريق والموارد (المرحلة B)

مرجعٌ للبناء المتوازي. **اقرأ أولاً**: `platform/CLAUDE.md`، `docs/team-resources/EXECUTION-LOG.md` (§1–§2 و§5)، ثم الملفات المؤسِّسة القائمة فعلاً:
- `migrations/042_team_resources.sql` — الجداول والأعمدة الجديدة (لا تعديل عليها؛ ترحيلة جديدة إن لزم).
- `src/modules/team/capacity-model.js` — الحساب الصرف (وحدتان: نسبة من طاقة المورد · وحدات الدوام الكامل).
- `src/modules/team/capacity-read.js` — تحميل السياق وبناء الأرقام: `loadCapacityContext`, `monthItems`, `figuresFromContext`, `figuresFor`, `allocationFingerprint`, `targetLabelOf`, `billableOf`.
- `src/modules/team/access.js` — البوابات: `canReadResources`, `resourceScopeSql`, `resourceInScope`, `loadReadableResource`, `isSelf`, `canEditResource`, `canCreateResource`, `planningRights`, `isFinanceReviewer`, `canManagerReview`, `canReadClose`, `readerBreadth`, `resourceTypeOf`, `RESOURCE_TYPE_AR`.

## قواعد مشتركة (ملزمة)
1. القاعدة عبر `src/core/db/index.js` فقط، SQL محمول (بلا strftime، GROUP BY صارم، `CAST(? AS TEXT)` عند `IS NULL`، منطقيات 0/1)، أموال حلالات صحيحة، حذف ناعم، `tx()` للعمليات المركبة، `audit(ctx, …)` على كل كتابة.
2. الأخطاء: `badRequest/forbidden/notFound` بعربية محددة تقول ما حدث وما العمل. لا مصطلح تقني في أي نص يصل المستخدم.
3. الصلاحيات في الخدمة لا الواجهة؛ الصفوف والحقول والعدادات والتصدير تحت الحد نفسه. **لا مال** في قراءات الموارد (لا قيمة عقد/فاتورة/ميزانية/راتب) — أسماء الأعمال وفتراتها ونسبها فقط.
4. الحسابات كلها من `capacity-model.js` عبر `capacity-read.js` — لا معادلة ثانية.
5. كل ملف خدمة يملك ملف موجّهٍ خاصاً به `team-<area>.routes.js` يصدّر `Router` بنمط `h(fn)` كما في `identity.routes.js`، مسارات تحت `/team/...` (تُركَّب داخل `apiRouter` بواسطة المنسّق — **لا تعدّل `api.routes.js`**). لا تلمس ملفات خارج ملفاتك إلا بإذن مكتوب هنا.
6. الاختبارات بنمط المستودع (migrate + seed-rbac على قاعدة مؤقتة، `resolveUser` عبر جلسة لبناء المستخدم) — انظر `tests/security/personal-department-grants.test.js` نموذجاً. سمِّ كل اختبار بمعرّف حالة القبول (T01…T45) من الموجّه حيث ينطبق.
7. المخرجات JSON بسيطة (أرقام/نصوص/مصفوفات)، الشهر بمفتاح `YYYY-MM`، النسب أعداد صحيحة، والحالات مفاتيح إنجليزية داخلية مع تسميتها العربية في حقل مجاور (`_ar`) حيث تُعرض.
8. لا بيانات تجريبية بأسماء الصور في أي بذرة إنتاج.

---

## B1 — `team/resources.js` (+ `team-resources.routes.js`) — S02/S03/S04/S05/S07/S08/S09/S10/S11
```js
export async function listResources(user, { q, sector, department, type, status, from, to, page = 1, pageSize = 25 })
// → { rows: [{ id, name_ar, job_title, resourceType, resourceType_ar, department_id, department_name, sector_id, sector_name,
//      engagement: { status: 'active'|'ending'|'ended'|'upcoming', end_date, hire_date, status_ar }, capacityPct,
//      period: { from, to }, availablePct (من periodFigures.availablePct — null ⇒ 'خارج الارتباط'), utilizationPct, band, userId }],
//     total, page, pageSize, period: { from, to }, basis_ar: 'المتاح محسوب من الطاقة التعاقدية المسجلة بعد التسكين المؤكد' }
// النطاق: resourceScopeSql. البحث: الاسم/المسمى/المهارة (resource_capability kind=skill). الفلاتر خادمية. العدّاد بنفس الشرط.
export async function resourcePreview(user, employeeId, { from, to })         // S03
// → { resource, figures: { confirmedPct, availablePct, tentativePct, band }, taskLoad: { level: 'low'|'medium'|'high'|'unmeasured', pct, unsized, open, basis_ar },
//     working: [{ kind, label, pct, status }], upcoming: [{ id, title, due, kind:'task'|'milestone' }] (≤5), userId, canOpenDossier, planning: planningRights }
export async function resourceProfile(user, employeeId, { year, month })       // S04
// → { resource (بلا راتب), figures (شهر الطلب)، distribution: items، upcoming30: [...], meta: { lastUpdatedAt, lastUpdatedBy }, tabs: {...}, rights: { edit, planning } }
export async function linkedWork(user, employeeId, { window: 'current'|'past' }) // S05
// من allocation (مشروع/بند) + membership (فرصة) — كل عمل مرة واحدة، مع الدور والفترة وحالة العمل والتسكين المرتبط إن وجد. لا مال.
export async function resourceCapabilities(user, employeeId)                   // S07: { skills, experiences, goals }
export async function upsertCapability(ctx, employeeId, data) / removeCapability(ctx, employeeId, id)
// المراجعة: reviewed_by يُكتب حين يكون الكاتب مديراً (ownsEmployee) أو HR؛ الذاتي source='self'.
export async function engagement(user, employeeId)                              // S08: { type, vendor, ref, hire_date, end_date, manager, account: { linked, active }, capacity: { currentPct, versions: [...], changes: [{ from, to, pct }] } }
export async function setCapacity(ctx, employeeId, { capacity_pct, effective_from, note })
// يكتب capacity_version ويحدّث employee.capacity_pct إن كان السريان اليوم أو قبله؛ يعيد أثره على الأشهر القادمة (figures قبل/بعد). يرفض تاريخاً ناقصاً. audit.
export async function createResource(ctx, data) / updateResource(ctx, employeeId, data)   // S09
// يغلّف org.createEmployee/updateEmployee ويضيف resource_type/vendor_name/engagement_ref/capacity(+version). تحذير تشابه اسم بلا دمج (org.assertNameFree يرفض التطابق؛ التشابه يُعاد كـ warnings[]).
export async function resourceAudit(user, employeeId, { filter: 'all'|'profile'|'capacity'|'allocation' })   // S10
// من audit_log: صفوف employee بالمعرّف + allocation/capacity_version/resource_capability/allocation_request الخاصة به. يعيد [{ at, actor, action_ar, kind, before, after, reason, ref: { kind, id } }]. لا حقول محجوبة (يُسقط أي مفتاح راتب).
export async function orgResources(user, { department, q })                     // S11: شجرة orgTree القائمة + موارد الإدارة المختارة + الارتباطات المشتركة (مسكَّنون على مشاريع إدارات أخرى)
```
اختبارات: `tests/integration/team-resources.test.js` — T16 (مورد بلا حساب يُخطَّط)، T17 (أرشفة بتاريخ تحفظ التاريخ)، S02 ترقيم صحيح (1–6 من 6)، بحث بالمهارة، S08 (0.5 FTE = 100% من طاقته)، إصدار طاقة بتاريخ مستقبلي لا يغيّر الحاضر، S10 يظهر قبل/بعد. `tests/security/team-resources-scope.test.js` — T37 (HR يرى الأسماء بلا مال، ولا راتب)، T38 (موظف يطلب مورداً خارج نطاقه ⇒ رفض؛ ملفه هو يُفتح).

## B2 — `team/allocations.js` + `team/allocation-settle.js` (+ `team-allocations.routes.js`) — S13/S14/S15/S16
```js
export async function planningMatrix(user, { from, to, sector, department, q, showTentative = true })   // S13
// → { period, months: [{ key, label_ar }], rows: [{ resource: {id,name,job_title,resourceType_ar,capacityPct,department_name}, cells: [{ key, state, confirmedPct, tentativePct, pendingPct, availablePct, overPct, items:[{label, pct, status, billable, kind}] }], period }], legend, basis_ar, total }
export async function previewChange(user, change)     // S14/S15 — change = { kind:'new'|'adjust'|'remove', employeeIds:[...] | employeeId, target:{kind:'project'|'bucket', id}, allocationId?, from:'YYYY-MM', to:'YYYY-MM', pct | months:{ 'YYYY-MM': pct }, allocStatus:'confirmed'|'tentative', billable, scope:'month'|'onward' }
// → { perResource: [{ employeeId, name, months: [{ key, current, added, after, availableAfter, conflict: bool, outOfEngagement: bool }], warnings_ar: [] }], reviewers: [{ userId, name, why_ar }], directApply: bool, fingerprints: { [employeeId]: fp }, previewId }
// التعارض = after > 100 (مؤكد) — يُعرض ولا يُمنع؛ خارج الارتباط يمنع التأكيد المؤكد (T11). المبدئي لا يُخصم.
export async function submitRequest(ctx, change, { idempotencyKey, expectedFingerprints, draft = false, needId })   // T18/T19
// لكل مورد صف allocation_request. directApply (planningRights.direct ⇒ ينفّذ فوراً عبر projects.assignEmployee/assignInternalWork/setAllocationMonths/unassignEmployee داخل tx، status='applied') وإلا 'pending' + raiseDirectApproval(STAFFING? لا — مسار جديد ALLOCATION_WORKFLOW_KEY='allocation_request' يُسجَّل في engine.DIRECT_WORKFLOWS بواسطة المنسّق؛ أنت تصدّر settleAllocationRequest(reqRow, approved, actorUserId) من allocation-settle.js) إلى managerOfEmployee (وإن غاب ⇒ 'pending' بلا معتمِد مع note_ar يقول ذلك — لا انتظار صامت). المفتاح المكرر يعيد الطلب السابق نفسه (لا حجزان).
// الاعتماد (settle): يعيد فحص البصمة والطاقة داخل المعاملة؛ اختلاف البصمة ⇒ الطلب 'returned' بسبب «تغيّرت الخطة منذ المعاينة» (S16/T20). عند approve يطبّق ويكتب applied_allocation_id.
export async function listRequests(user, { filter: 'all'|'mine'|'pending_my_decision', q, from, to })
export async function getRequest(user, id)  // مع الأثر بعد الاعتماد (before/after per month) والموافقات
export async function decideRequest(ctx, id, action: 'approve'|'return'|'reject', note)  // يمرّ بـ wf.actOnApproval إن كان له approval_request_id، وإلا (بلا معتمِد) يقرّره من يملك أمر المورد. الإعادة والرفض تحتاج سبباً (T21).
export async function withdrawRequest(ctx, id)  // صاحبه وقبل القرار
```
اختبارات: `tests/integration/team-allocations.test.js` — T02 (المبدئي منفصل في المصفوفة)، T07 (300% يبقى ويُعلَّم)، T14 (تعديل أكتوبر فقط يحفظ بقية الأشهر)، T18 (عبر إدارة أخرى لا يغيّر المؤكد قبل الاعتماد)، T19 (نفس idempotencyKey ⇒ طلب واحد)، T20 (طلبان متنافسان: الثاني يُعاد لاختلاف البصمة)، T21 (رفض بسبب محفوظ). `tests/security/team-allocations-scope.test.js` — من لا يملك «طلب تسكين» يُرفض؛ الموظف يرى طلباته هو فقط.

## B3 — `team/needs.js` + `team/analysis.js` + `team/commitments.js` (+ `team-needs.routes.js`, `team-analysis.routes.js`) — S12/S17/S18/S19/S20/S21
```js
// needs.js
export async function listNeeds(user, { from, to, department, status, certainty })   // S19 → { rows:[{ id, role_ar, source:{kind,id,label}, period, headcount, ftePct, demand_ar:'مورد واحد × 50% FTE', certainty, certainty_ar, coverage:{ status, status_ar, gapPct, requestId? }, decide_by, owner }], summary:{ confirmed, tentative }, followups:[...] }
export async function createNeed(ctx, data) / updateNeed(ctx, id, data) / cancelNeed(ctx, id)   // S20 — تحقق خادمي من المصدر (مشروع/بند/فرصة ضمن صلاحية القارئ) والفترة والنسب والعدد؛ الحفظ لا يحجز.
export async function candidates(user, needId, { department, q })   // S21 → { need, rows:[{ employeeId, name, job_title, skills:[{ name, state:'verified'|'needs_confirmation'|'missing' }], availability:[{ key, availablePct (null ⇒ خارج الارتباط) }], pendingRequests:[{ id, pct, label }], fit_ar:[...] , eligible: bool, potentialOverPct }], basis_ar }
// الأهلية: قطاع مصدر العمل + وحدات المساندة (كما staffingCandidates)، وداخل فترة الارتباط لكل شهر (T25). لا نسبة ملاءمة رقمية.
export async function requestFromCandidate(ctx, needId, employeeId, { pct, allocStatus })   // ينشئ عبر allocations.submitRequest بـ needId؛ تكرار الطلب المعلق للاحتياج نفسه يُرفض برسالة تسمّي الطلب القائم.
// analysis.js
export const SIGNALS = { high_alloc_low_load:'تسكين يحتاج مراجعة', low_alloc_high_load:'التزامات لا تعكسها الخطة', internal_high:'مراجعة الأولويات والميزانية', high_load_pressure:'راجع توازن الالتزامات', data_missing:'بيانات غير مكتملة', capacity_freeing:'فرصة تخطيط', check_upcoming:'تحقق من الطلب القادم', none:'لا يوجد تعارض ظاهر' }
export async function utilizationTable(user, { year, month, department, signal })   // S17 → { rows:[{ employeeId, name, job_title, resourceType_ar, confirmedPct, billablePct, taskLoad:{ level, level_ar, pct, unsized, basis_ar }, coverage:{ state:'unavailable', state_ar:'غير متاحة', note_ar }, signal:{ key, label_ar } , hasCase }], definitions_ar:[...], asOf }
// عبء المهام: من task-load.js (taskLoadFor) — unsized فقط ⇒ 'unmeasured'؛ pct<40 low؛ ≤100 medium؛ >100 high. تُقال القاعدة في basis_ar.
export async function caseDetail(user, employeeId, { year, month })   // S18 → { resource, signal, evidence:[{ title_ar, value_ar, source:{ label_ar, href }, asOf }], questions_ar:[...], followup: existing case + task }
export async function createFollowup(ctx, employeeId, { year, month, action_ar, ownerUserId, dueDate, note })   // ينشئ مهمة عبر tasks.quickAddTask (work_kind internal، العنوان يذكر المورد) + analysis_case (مفتاح فريد ⇒ التكرار يعيد القائم بدل إنشاء ثانٍ)
export async function closeCase(ctx, caseId, { explanation })
// commitments.js
export async function teamCommitments(user, { year, month, department, by:'work'|'resource' })   // S12 → by work: [{ work:{kind,id,label,status_ar}, team:[{employeeId,name}], confirmedPct (Σ), nextCommitment:{ title, due }, blockers, tasks:[{ id, title, assignee, due, blocked_reason, status_ar }] }]; by resource: مقلوب. المهام تُعدّ مرة (distinct)، بلا مهام شخصية ولا معلَّقة (openLoadSql).
```
اختبارات: `tests/integration/team-needs.test.js` — T25 (مرشح متاح نوفمبر فقط ⇒ فجوة أكتوبر)، T26 (50% مؤكد + طلب 20% + احتياج 50% ⇒ تعارض محتمل 120% والمتاح 50%)، حفظ الاحتياج لا يحجز، طلب مكرر يُرفض. `tests/integration/team-analysis.test.js` — T23 (مهمة تُعدّ مرة)، T24 (بلا نسب ⇒ غير مقاس، التغطية غير متاحة)، متابعة تنشئ مهمة حقيقية ولا تتكرر، إغلاق الحالة يسجّل الفاعل.

## B4 — `team/cost-close.js` (+ `team-close.routes.js`) — S22/S23/S24/S25
```js
export async function periodOverview(user, { sector, year, month })   // S22 → ينشئ المسودة تلقائياً إن لم توجد (status draft، version 1) لمن يقرأ الإقفال. → { period:{ id, status, status_ar, version, stage_steps:[...] }, rows:[{ employeeId, name, resourceType_ar, projectsBp, sectorBp, unallocatedBp, exceptions:[{ code, label_ar }], reviewStatus, reviewStatus_ar }], counters:{ resources, complete, exceptions }, blockers_ar:[...], canSendToFinance, canLock, transfer:{ status:'not_transferred', status_ar } }
export async function generateDraft(ctx, periodId, { preserveConfirmed = true })   // من التسكين المؤكد للشهر: نسب المشاريع بنسبتها من المجموع؛ الجزء غير المسكن وبنود العمل الداخلي ⇒ القطاع (fin_code = sector.cost_center || sector.id). المورد غير المرتبط في الشهر (engagedDays=0) يُستبعد بسبب موثق. لا يمحو الأسطر المؤكدة (review_status='confirmed') إلا بإعادة توليدٍ صريح.
export async function resourceShares(user, periodId, employeeId)   // S23 → { reference: monthFigures items, lines:[{ id, target_kind, target_id, label, fin_code, shareBp }], totalBp, unallocatedBp, draftDiff_ar, canConfirm }
export async function confirmShares(ctx, periodId, employeeId, { lines:[{ target_kind, target_id, shareBp }], reason, sourceRef })   // T27: مجموع ≠ 10000 ⇒ badRequest عربي؛ T28: كود مفقود يبقى استثناء (يُحفظ مؤكداً؟ لا — يُحفظ ويبقى الصف استثناءً ويمنع الإرسال). T04: النسب من تكلفة الشهر لا FTE (0.5 FTE بالكامل = 10000 للمشروع).
export async function sendToFinance(ctx, periodId)   // draft/manager_review ⇒ finance_review إذا لا موانع (كل مورد مؤهل مؤكد ومجموعه 10000 وأكواده مكتملة). الموانع تُعاد بالعربية.
export async function returnToManager(ctx, periodId, reason)   // finance_review ⇒ manager_review بسبب (T21 نظير)
export async function lockPeriod(ctx, periodId, { expectedVersion })   // T31/T32: tx + إعادة تحقق + status='locked' + locked_snapshot_json + finance_locked_by/at؛ إصدار مختلف أو حالة مختلفة ⇒ conflict برسالة عربية. بعد الإقفال لا تعديل على الأسطر (T32).
export async function exportPeriod(user, periodId)   // T35/§9.4 → { filename, csv } أعمدة: resource_id, month, sector, target_kind, fin_code, share_bp, share_pct, basis, review_status, confirmed_by, confirmed_at, lock_version, correction_ref, note. من اللقطة المقفلة حصراً.
export async function createCorrection(ctx, periodId, employeeId, { proposed:[...], reason, evidenceLabel })   // S25/T33: على إصدار مقفل فقط؛ يحفظ القديم من اللقطة؛ يمرّ بمسار مراجعة (pending) — المعتمِد المراجع المالي.
export async function decideCorrection(ctx, correctionId, action:'approve'|'reject', note)   // T33/T34: approve ⇒ إصدار جديد locked يحمل كل أسطر السابق مع استبدال أسطر المورد، supersedes_id، والسابق status='superseded' مع بقاء لقطته؛ تصحيح ثانٍ مبني على إصدار لم يعد الأحدث ⇒ تعارض إصدار.
```
اختبارات: `tests/integration/team-cost-close.test.js` — T04, T27, T28, T29, T30 (مشروع مغلق الآن كان صحيحاً في الشهر: يُقبل إن كان نشطاً حينها بحسب start/end)، T31 (إقفالان متزامنان ⇒ واحد ينجح والآخر يُقرّ بالتعارض)، T32, T33, T34, T35 (المجموع 10000 والتصدير يطابق اللقطة), T36. `tests/security/team-close-scope.test.js` — مدير الإدارة لا يقفل (T «لا إقفال مالي»)، الموظف لا يقرأ الإقفال، HR لا يقفل.

## التنسيق (المنسّق يفعله بعد استلام الوكلاء)
- تسجيل `ALLOCATION_WORKFLOW_KEY` في `workflow/engine.js` (DIRECT_WORKFLOWS + DIRECT_SETTLERS) و`inbox.js`/`targets.js` بالاسم العربي «طلب تسكين».
- تركيب الموجّهات في `api.routes.js`، وصفحات الويب والتنقل والسياسة والمعجم وFEATURES وCHANGELOG وADR-0016.
