// ── شاشات الإقفال الشهري S22–S25 (views/team/close.js) — عرضٌ من الخدمة الحقيقية على قاعدة مؤقتة ──
//
// يبني قطاعاً بمركز تكلفة وإدارتين وموارد لهم تسكينات مؤكدة في شهرٍ ماضٍ ثابت (يونيو 2026)،
// ثم يمرّ بالدورة كلها عبر الخدمة (تأكيد ⇐ إرسال ⇐ إقفال ⇐ تصحيح) ويؤكد في كل حالة أن الصفحة
// تعرض ما يليق بها: العدادات تتصالح مع الصفوف، الاستثناء بكوده المفقود ولو اكتمل المجموع، زر
// الإرسال المعطَّل يشرح موانعه، S23 بتذييل 100% وملاحظة «التأكيد لا يقفل»، S24 للقراءة عند
// المدير وبأزرار الإقفال عند المراجعة المالية، S25 بالتصدير والدرج وطلبات التصحيح — وبلا تسرّب
// (undefined/NaN/null/[object) وبلا كلمة «راتب» في أي شاشة. HR والموظف يُردّان بـ403.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-ui-close-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, resolveUser, close, view;
const T = new Date().toISOString();
const YEAR = 2026; const MONTH = 6;          // شهرٌ ماضٍ ثابت — لا يتغيّر بتغيّر ساعة الخادم
const SECTOR = 'SOL';

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });
const LEAK = /undefined|NaN|\[object|null(?![a-z])/;
const clean = (html, label) => {
  // SANAD_UI_DUMP=<dir> يكتب كل شاشة مُختبَرة ملفاً لمعاينتها — لا أثر له في التشغيل العادي.
  if (process.env.SANAD_UI_DUMP) writeFileSync(join(process.env.SANAD_UI_DUMP, label.replace(/[^\w؀-ۿ]+/g, '_') + '.html'), html);
  const m = LEAK.exec(html);
  assert.equal(m, null, `${label}: تسرّب «${m && m[0]}» قرب: ${m && html.slice(Math.max(0, m.index - 80), m.index + 40)}`);
  assert.ok(!/راتب|salary/i.test(html), `${label}: ظهر راتب في شاشة الإقفال`);
  assert.ok(html.includes('الإقفال الشهري'), `${label}: تبويب الإقفال غائب`);
};
const count = (html, re) => (html.match(re) || []).length;
const counter = (html, k) => Number((new RegExp(`data-counter="${k}">(\\d+)<`).exec(html) || [])[1]);

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  close = await import('../../src/modules/team/cost-close.js');
  view = await import('../../src/web/views/team/close.js');

  await db.insert('sector', { id: SECTOR, name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, cost_center: 'CC-SOL', created_at: T });
  await db.insert('sector', { id: 'CONS', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1, created_at: T });
  await db.insert('client', { id: 'CL', name_ar: 'جهة حكومية', created_at: T });

  const mkUser = (id2, role, sector = SECTOR, scope = 'own') => db.insert('app_user', {
    id: id2, username: id2, name_ar: 'حساب ' + id2, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_admin', 'admin', SECTOR, 'company');
  await mkUser('u_lead', 'sector_lead', SECTOR, 'sector');       // مراجعة المدير على القطاع كله
  await mkUser('u_ceo', 'ceo_office', SECTOR, 'company');        // «المراجعة المالية» (لا دور مالية — C1)
  await mkUser('u_dm', 'department_manager');                    // مدير إدارة البيانات — أهل إدارته فقط
  await mkUser('u_hr', 'hr', null, 'company');                   // لا يقرأ الإقفال
  await mkUser('u_emp', 'consultant');                           // موظف — لا يقرأ الإقفال

  await db.insert('department', { id: 'D_DATA', sector_id: SECTOR, name_ar: 'إدارة البيانات', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_AI', sector_id: SECTOR, name_ar: 'إدارة الذكاء', active: 1, created_at: T });

  const mkEmp = async (id2, { uid = null, dept, name, hire = '2025-01-01', end = null, cap = null, title = 'استشاري' }) => {
    await db.insert('employee', { id: id2, user_id: uid, name_ar: name, sector_id: SECTOR, department_id: dept, job_title: title,
      active: 1, hire_date: hire, end_date: end, capacity_pct: cap, created_at: T });
    if (uid) await db.update('app_user', uid, { employee_id: id2 });
  };
  await mkEmp('e_a', { dept: 'D_DATA', name: 'مورد الأول' });                                  // 60% على مشروع بكود ⇐ 40% للقطاع
  await mkEmp('e_b', { dept: 'D_DATA', name: 'مورد الثاني' });                                 // مشروع بلا كود + عمل داخلي ⇐ استثناء كود
  await mkEmp('e_c', { dept: 'D_AI', name: 'مورد الثالث', cap: 50 });                          // T04: نصف دوام مسكَّن بكامله ⇐ 100% للمشروع
  await mkEmp('e_d', { dept: 'D_AI', name: 'مورد الرابع' });                                   // عمل داخلي فقط ⇐ 100% للقطاع
  await mkEmp('e_left', { dept: 'D_DATA', name: 'مورد غادر', end: `${YEAR}-03-31` });          // خارج الارتباط ⇐ مستبعد بسبب
  await mkEmp('e_dm', { uid: 'u_dm', dept: 'D_DATA', name: 'مدير البيانات', title: 'مدير إدارة' });
  await mkEmp('e_emp', { uid: 'u_emp', dept: 'D_AI', name: 'استشاري الذكاء' });

  const mkProject = (id2, name, fin) => db.insert('project', { id: id2, name_ar: name, sector_id: SECTOR, department_id: 'D_DATA',
    owner_user_id: 'u_lead', client_id: 'CL', status: 'IN_PROGRESS', kind: 'external', financial_code: fin, created_at: T });
  await mkProject('P1', 'منصة البيانات', 'PRJ-001');
  await mkProject('P2', 'مشروع بلا كود', null);

  const alloc = (id2, emp, { project = null, bucket = null, pct }) => db.insert('allocation', {
    id: id2, employee_id: emp, project_id: project, work_bucket: bucket, sector_id: SECTOR, type: 'member',
    monthly_json: JSON.stringify({ [MONTH]: pct }), year: YEAR, status: 'confirmed', created_at: T });
  await alloc('al_a', 'e_a', { project: 'P1', pct: 0.6 });
  await alloc('al_b1', 'e_b', { project: 'P2', pct: 0.3 });
  await alloc('al_b2', 'e_b', { bucket: 'pmo', pct: 0.2 });
  await alloc('al_c', 'e_c', { project: 'P1', pct: 1 });
  await alloc('al_d', 'e_d', { bucket: 'bd', pct: 1 });
});
after(() => rmSync(dir, { recursive: true, force: true }));

let periodId;

// ── S22: المسودة والاستثناءات ─────────────────────────────────────────────────
test('S22 لقائد القطاع: المراحل والعدادات تتصالح مع الصفوف، والاستثناء بكوده المفقود، والإرسال معطَّل بموانعه', async () => {
  const lead = await sess('u_lead');
  const html = await view.closePage(lead, { year: YEAR, month: MONTH });
  clean(html, 'S22');
  const ov = await close.periodOverview(lead, { sector: SECTOR, year: YEAR, month: MONTH });
  periodId = ov.period.id;
  assert.equal(ov.period.status, 'draft');
  for (const s of ['المسودة', 'مراجعة المدير', 'المراجعة المالية', 'مقفل']) assert.ok(html.includes(`<i></i>${s}`), `مرحلة «${s}» غائبة عن المتتبّع`);
  assert.ok(html.includes('يونيو 2026'), 'اسم الشهر غائب');
  // العدادات = صفوف الجدول: 6 مؤهلين، لا مكتمل بعد، استثناء واحد (كود مفقود)، وواحد خارج التوزيع بسبب
  assert.equal(counter(html, 'resources'), 6);
  assert.equal(counter(html, 'complete'), 0);
  assert.equal(counter(html, 'exceptions'), 1);
  assert.equal(count(html, /<tr class="tm-row-click" data-emp="/g), 6, 'صفوف الجدول لا تساوي عداد الموارد');
  assert.ok(html.includes('خارج التوزيع هذا الشهر') && html.includes('مورد غادر') && html.includes('انتهى ارتباطه'), 'المستبعد بلا سبب مكتوب');
  assert.ok(html.includes('كود مالي مفقود') && html.includes('مشروع بلا كود'), 'استثناء الكود المفقود غائب');
  // أعمدة النسب بخانتين ونقاط أساس من الخدمة: 60% مشاريع / 40% قطاع للمورد الأول
  const rowA = html.slice(html.indexOf('data-emp="e_a"'), html.indexOf('data-emp="e_b"'));
  assert.ok(rowA.includes('60.00%') && rowA.includes('40.00%') && rowA.includes('0.00%'), 'نسب المورد الأول غير صحيحة');
  assert.ok(rowA.includes(`/app/team/close/e_a?period=${periodId}`), 'رابط الصف إلى S23 غائب');
  // الإرسال معطَّل ويشرح: «لا يمكن الإرسال» مع قائمة الموانع بالأسماء
  assert.ok(/data-action="close-send" disabled/.test(html), 'زر الإرسال ليس معطَّلاً');
  assert.ok(html.includes('لا يمكن الإرسال') && html.includes('بانتظار تأكيد المدير'), 'الموانع غير مذكورة تحت الزر');
  assert.ok(html.includes('data-action="close-regen"'), 'زر تحديث المسودة غائب لمن يراجع');
  assert.ok(html.includes('حالة الترحيل للنظام المالي') && html.includes('<b>لم يُرحَّل</b>'), 'سطر الترحيل غائب');
  assert.ok(html.includes('مراجعة الاستثناءات') && html.includes('exceptions=1'), 'زر مراجعة الاستثناءات غائب');
  assert.ok(html.includes('تأكيد المدير لا يقفل الشهر مالياً'));
  assert.ok(html.includes('/static/pages/team-close.js'));
  assert.ok(html.includes('"canSendToFinance":false'));
});

test('S22 فلتر الاستثناءات خادمي: صفٌّ واحد بكوده المفقود، مع عدّه ورابط «عرض الكل»', async () => {
  const lead = await sess('u_lead');
  const html = await view.closePage(lead, { year: YEAR, month: MONTH, exceptions: '1' });
  clean(html, 'S22/استثناءات');
  assert.equal(count(html, /<tr class="tm-row-click" data-emp="/g), 1);
  assert.ok(html.includes('data-emp="e_b"'));
  assert.ok(html.includes('عرض الكل'));
  assert.ok(html.includes('من <span class="tnum">6</span>'), 'عدّ الاستثناءات من المؤهلين غائب');
  assert.equal(counter(html, 'exceptions'), 1, 'العداد لا يتغيّر بالفلتر — يعكس الشهر كله');
});

test('S22 لمدير الإدارة: أهل إدارته فقط، والإرسال ليس بيده', async () => {
  const dm = await sess('u_dm');
  const html = await view.closePage(dm, { year: YEAR, month: MONTH });
  clean(html, 'S22/مدير إدارة');
  assert.equal(counter(html, 'resources'), 3, 'مدير الإدارة يرى غير أهل إدارته');
  assert.equal(count(html, /<tr class="tm-row-click" data-emp="/g), 3);
  assert.ok(!html.includes('data-emp="e_c"') && !html.includes('data-emp="e_d"'));
  assert.ok(/data-action="close-send" disabled/.test(html));
  assert.ok(!html.includes('data-action="close-lock"'));
});

test('S22 لصاحب نطاق الشركة بلا قطاع في الرابط: يختار أول قطاع ويعرض محدِّد القطاع وحالة الفراغ', async () => {
  const ceo = await sess('u_ceo');
  const html = await view.closePage(ceo, { year: YEAR, month: MONTH });
  clean(html, 'S22/افتراضي');
  assert.ok(html.includes('id="tm-close-sector"') && html.includes('قطاع الاستشارات') && html.includes('قطاع الحلول'), 'محدِّد القطاع غائب');
  assert.ok(html.includes('لا موارد في هذا القطاع لهذا الشهر'), 'حالة الفراغ غائبة لقطاعٍ بلا موارد');
  assert.equal(counter(html, 'resources'), 0);
});

// ── S23: توزيع مورد ──────────────────────────────────────────────────────────
test('S23: مرجع التسكين للقراءة، أسطر قابلة للتحرير، كود مفقود، والتذييل 100% مع «التأكيد لا يقفل»', async () => {
  const lead = await sess('u_lead');
  const html = await view.closeResourcePage(lead, 'e_b', { period: periodId });
  clean(html, 'S23');
  assert.ok(html.includes('مرجع التسكين للشهر') && html.includes('إدارة مشاريع') && html.includes('غير مسكَّن'), 'مرجع التسكين ناقص');
  assert.ok(html.includes('لا نسبة من الطاقة ولا مبلغاً'), 'ملاحظة «تكلفة لا FTE» غائبة');
  assert.ok(html.includes('data-kind="project" data-target="P2"') && html.includes('data-kind="sector" data-target="SOL"'), 'أسطر التوزيع غائبة');
  assert.ok(html.includes('كود مفقود') && html.includes('/app/project/P2'), 'الكود المفقود بلا إشارة إلى صفحة المشروع');
  assert.ok(html.includes('CC-SOL'), 'مركز تكلفة القطاع غائب');
  assert.equal(count(html, /class="tm-close-pct"/g), 2, 'حقول النسبة ليست بعدد الأسطر');
  assert.ok(html.includes('value="30.00"') && html.includes('value="70.00"'), 'النسب بخانتين من نقاط الأساس');
  assert.ok(html.includes('id="tm-close-total"') && html.includes('100.00%') && html.includes('يساوي 100% تماماً'));
  assert.ok(html.includes('الفرق عن المسودة') && html.includes('مطابق للتسكين المؤكد للشهر'));
  assert.ok(html.includes('data-action="close-confirm"') && html.includes('data-action="close-line-add"'));
  assert.ok(html.includes('تأكيد المدير لا يقفل الشهر مالياً'));
  assert.ok(html.includes('"canConfirm":true') && html.includes('"draft":[{"k":"project:P2","bp":3000},{"k":"sector:SOL","bp":7000}]'));
  // T04 في العرض: نصف دوام مسكَّن بكامله على مشروع ⇐ 100% له
  const c = await view.closeResourcePage(lead, 'e_c', { period: periodId });
  clean(c, 'S23/نصف دوام');
  assert.ok(c.includes('data-kind="project" data-target="P1"') && c.includes('value="100.00"'));
  assert.ok(c.includes('الطاقة التعاقدية <span class="tnum">50%</span>'));
  // بلا معرّف فترة: توجيه واضح لا خطأ صامت
  const none = await view.closeResourcePage(lead, 'e_b', {});
  clean(none, 'S23/بلا فترة');
  assert.ok(none.includes('افتح المورد من شاشة الإقفال الشهري'));
});

// ── الصلاحية: الخدمة هي البوابة ───────────────────────────────────────────────
test('الموارد البشرية والموظف لا يفتحان الإقفال ولا توزيع مورد — رفض 403 عربي', async () => {
  const hr = await sess('u_hr'); const emp = await sess('u_emp');
  await assert.rejects(() => view.closePage(hr, { sector: SECTOR, year: YEAR, month: MONTH }), (e) => e.status === 403 && /الإقفال/.test(e.message));
  await assert.rejects(() => view.closePage(emp, { year: YEAR, month: MONTH }), (e) => e.status === 403);
  await assert.rejects(() => view.closeResourcePage(emp, 'e_emp', { period: periodId }), (e) => e.status === 403);
  await assert.rejects(() => view.closeResourcePage(hr, 'e_a', { period: periodId }), (e) => e.status === 403);
});

// ── الدورة عبر الخدمة: تأكيد ⇐ إرسال ⇐ S24 ──────────────────────────────────
test('S24: بعد التأكيد والإرسال — للقراءة عند المدير، وأزرار الإقفال والإعادة عند المراجعة المالية', async () => {
  await db.update('project', 'P2', { financial_code: 'PRJ-002' });          // يُسجَّل الكود في صفحة المشروع
  const ctxLead = await ctxOf('u_lead'); const lead = ctxLead.user;
  for (const id of ['e_a', 'e_b', 'e_c', 'e_d', 'e_dm', 'e_emp']) {
    const r = await close.resourceShares(lead, periodId, id);
    await close.confirmShares(ctxLead, periodId, id, { lines: r.draft.map((l) => ({ target_kind: l.target_kind, target_id: l.target_id, shareBp: l.share_bp })), reason: 'مطابق للتسكين', sourceRef: 'manager_confirmation' });
  }
  const sent = await close.sendToFinance(ctxLead, periodId);
  assert.equal(sent.period.status, 'finance_review');

  const m = await view.closePage(lead, { year: YEAR, month: MONTH });
  clean(m, 'S24/مدير');
  assert.ok(m.includes('التوزيع الذي أكده المدير') && m.includes('الشهر عند المراجعة المالية'));
  assert.ok(!m.includes('data-action="close-lock"') && !m.includes('data-action="close-return"') && !m.includes('data-action="close-send"'));
  assert.equal(counter(m, 'complete'), 6);
  assert.equal(count(m, /<tr class="tm-row-click" data-emp="/g), 6);

  const ceo = await sess('u_ceo');
  const f = await view.closePage(ceo, { sector: SECTOR, year: YEAR, month: MONTH });
  clean(f, 'S24/مالية');
  assert.ok(/data-action="close-lock" data-version="1">/.test(f), 'زر الإقفال غائب أو معطَّل عند المراجعة المالية');
  assert.ok(f.includes('data-action="close-return"') && f.includes('سبب الإعادة مطلوب'));
  assert.ok(f.includes('جاهزية الإقفال') && f.includes('المصادر والاعتمادات') && f.includes('لا توجد استثناءات مفتوحة'));
  assert.ok(f.includes('حساب u_lead') && f.includes('من التسكين المؤكد'), 'من أكّد وماذا غائب');
  assert.ok(f.includes('id="tm-close-conflict"') && f.includes('تغيّرت النسخة منذ فتح الشاشة'), 'لافتة تعارض الإصدار غائبة');
  assert.ok(f.includes('حالة الترحيل للنظام المالي') && f.includes('<b>لم يُرحَّل</b>'));
  assert.ok(f.includes('"canLock":true') && f.includes('"canReturn":true') && f.includes('"version":1'));
  // S23 عند المراجعة المالية: للقراءة
  const r = await view.closeResourcePage(lead, 'e_a', { period: periodId });
  clean(r, 'S23/مالية');
  assert.ok(r.includes('لا تعديل على التوزيع حتى يُعاد إلى المدير') && !r.includes('data-action="close-confirm"'));
});

// ── الإقفال ⇐ S25 ────────────────────────────────────────────────────────────
test('S25: الشهر المقفل للقراءة — التصدير لمن يملكه، سجل الإصدارات، درج التصحيح، وS23 يشير إلى الدرج', async () => {
  const ctxCeo = await ctxOf('u_ceo');
  const locked = await close.lockPeriod(ctxCeo, periodId, { expectedVersion: 1 });
  assert.equal(locked.status, 'locked');

  const ceo = ctxCeo.user;
  const h = await view.closePage(ceo, { sector: SECTOR, year: YEAR, month: MONTH });
  clean(h, 'S25/مالية');
  assert.ok(h.includes('النسخة المعتمدة') && h.includes('التوزيع المعتمد'));
  assert.ok(h.includes(`href="/api/team/close/${periodId}/export" download`), 'رابط التصدير غائب');
  assert.ok(h.includes('سجل الإصدارات') && h.includes('حساب u_ceo'), 'سجل الإصدارات بلا من أقفل');
  assert.ok(h.includes('id="tm-close-correction-tpl"') && h.includes('id="tm-close-drawer"'), 'قالب درج التصحيح غائب');
  assert.ok(h.includes('الإصدار المرجعي') && h.includes('سبب التصحيح') && h.includes('الشاهد') && h.includes('تبقى النسخة الحالية سارية أثناء مراجعة الطلب'));
  assert.equal(count(h, /data-action="close-correct"/g), 6, 'زر طلب التصحيح ليس على كل صف');
  assert.ok(h.includes('"e_a":{"name":"مورد الأول","lines":[{"target_kind":"project","target_id":"P1","label":"منصة البيانات","fin_code":"PRJ-001","shareBp":6000'), 'لقطة الإقفال غير محقونة للدرج');
  assert.ok(h.includes('"canCorrect":true') && h.includes('"isFinance":true') && h.includes('"fin_code":"CC-SOL"'), 'بيانات الدرج (جهات التحميل) ناقصة');
  assert.ok(h.includes('لا طلبات تصحيح معلقة') && !h.includes('data-action="close-decide"'));
  assert.ok(!h.includes('data-action="close-send"') && !h.includes('data-action="close-lock"'));
  assert.equal(counter(h, 'resources'), 6);

  const lead = await sess('u_lead');
  const l = await view.closePage(lead, { year: YEAR, month: MONTH });
  clean(l, 'S25/مدير');
  assert.ok(!l.includes('/export'), 'قائد القطاع لا يصدّر — ظهر له رابط التصدير');
  assert.ok(l.includes('data-action="close-correct"'), 'قائد القطاع يطلب التصحيح');

  const r = await view.closeResourcePage(lead, 'e_a', { period: periodId });
  clean(r, 'S23/مقفل');
  assert.ok(r.includes('الشهر مقفل — التعديل عبر طلب تصحيح') && !r.includes('data-action="close-confirm"') && !r.includes('class="tm-close-pct"'));
  assert.ok(r.includes(`drawer=correction&amp;employee=e_a`), 'رابط درج التصحيح غائب');
});

test('S25: طلب تصحيح معلق يظهر بقرار الاعتماد/الرفض للمراجعة المالية فقط، واعتماده ينشئ الإصدار 2 ويبقي الأول', async () => {
  const ctxLead = await ctxOf('u_lead');
  const corr = await close.createCorrection(ctxLead, periodId, 'e_a', {
    proposed: [{ target_kind: 'project', target_id: 'P1', shareBp: 5000 }, { target_kind: 'sector', target_id: SECTOR, shareBp: 5000 }],
    reason: 'تصحيح توزيع العمل بعد مراجعة مدير المشروع', evidenceLabel: 'مذكرة مدير المشروع',
  });
  assert.equal(corr.status, 'pending');
  const ceo = await sess('u_ceo');
  const p = await view.closePage(ceo, { sector: SECTOR, year: YEAR, month: MONTH });
  clean(p, 'S25/تصحيح معلق');
  assert.ok(p.includes(`data-corr="${corr.id}"`) && p.includes('بانتظار الاعتماد') && p.includes('مذكرة مدير المشروع'));
  assert.ok(p.includes(`data-action="close-decide" data-id="${corr.id}" data-act="approve"`) && p.includes('data-act="reject"'));
  assert.ok(p.includes('المقترح:') && p.includes('50.00%') && p.includes('60.00%'), 'القديم والمقترح غائبان');
  const lead = ctxLead.user;
  const lp = await view.closePage(lead, { year: YEAR, month: MONTH });
  clean(lp, 'S25/تصحيح معلق/مدير');
  assert.ok(lp.includes('بانتظار الاعتماد') && !lp.includes('data-action="close-decide"'), 'قرار التصحيح ظهر لغير المراجعة المالية');

  const done = await close.decideCorrection(await ctxOf('u_ceo'), corr.id, 'approve', '');
  assert.equal(done.period.version, 2);
  const v2 = await view.closePage(ceo, { sector: SECTOR, year: YEAR, month: MONTH });
  clean(v2, 'S25/الإصدار 2');
  assert.ok(v2.includes('الإصدار <span class="tnum">2</span>'), 'الإصدار الجديد غير معروض');
  assert.ok(v2.includes('يحل محل الإصدار <span class="tnum">1</span>'), 'رابط الإصدار السابق غائب');
  assert.ok(v2.includes(`href="/api/team/close/${done.period.id}/export" download`));
  assert.ok(v2.includes('تصحيحات معتمدة أنتجت هذا الإصدار') && v2.includes('مورد الأول') && v2.includes('تصحيح توزيع العمل بعد مراجعة مدير المشروع'), 'التصحيح المعتمد غائب عن الإصدار الجديد');
  assert.ok(!v2.includes('data-action="close-decide"'));
  const rowA = v2.slice(v2.indexOf('data-emp="e_a"'), v2.indexOf('data-emp="e_b"'));
  assert.ok(rowA.includes('50.00%') && rowA.includes('تصحيح'), 'صف المورد المصحَّح لا يعرض النسبة الجديدة');
  assert.equal(count(v2, /data-action="close-correct"/g), 6, 'طلب التصحيح يُنشأ على الإصدار الأحدث');
  // الإصدار الأول يبقى للقراءة بمعرّفه، ويحمل سجل طلبه المعتمد، ولا يُطلب عليه تصحيح
  const old = await view.closePage(ceo, { sector: SECTOR, year: YEAR, month: MONTH, version: periodId });
  clean(old, 'S25/إصدار سابق');
  assert.ok(old.includes('هذا إصدار سابق للقراءة') && !old.includes('data-action="close-correct"'));
  assert.ok(old.includes('طلبات سابقة على هذا الإصدار') && old.includes(`data-corr="${corr.id}"`) && old.includes('الإصدار الأحدث'));
});
