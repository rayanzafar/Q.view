// حارس مشغّل السيناريوهات + أدوات الإحصاء + نظافة البيانات الاصطناعية — فحوص صرفة بلا قاعدة بيانات.
//
// لماذا تُفحص هذه الثلاثة معاً: مشغّل السيناريوهات (scripts/scenarios.mjs) **يحذف صفوفاً**.
// أمانه كله قائم على ثلاث ركائز، وكسر أيٍّ منها يحوّله من أداة جودة إلى أداة إتلاف:
//   ① الحارس: لا يعمل إلا على قاعدة رمي.
//   ② الإحصاء: يكشف أي فرق قبل/بعد، بما فيه تعديل صفٍّ قائم لا يُغيّر العدد.
//   ③ الوسم: كل صف يزرعه يقول عن نفسه إنه تجربة، فلا يُقرأ يوماً كبيانات حقيقية.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const { assertThrowawayTarget, schemaTables, censusDiff } = await import('../../scripts/scenarios.mjs');
const D = await import('../../scripts/lib/scenario-data.mjs');

const ROOT = resolve(import.meta.dirname, '../..');
const OK = { dbFile: '/tmp/scn-throwaway.db', databaseUrl: null, nodeEnv: 'test', explicit: false, armed: false };

test('guard: a Postgres target is refused outright — no override flag exists', () => {
  assert.throws(() => assertThrowawayTarget({ ...OK, databaseUrl: 'postgres://user@host/db', armed: true }),
    /قاعدة خارجية/);
});

test('guard: production is refused even on a local file', () => {
  assert.throws(() => assertThrowawayTarget({ ...OK, nodeEnv: 'production', armed: true }), /الإنتاج/);
});

test('guard: the shared dev database (data/sanad.db) is refused', () => {
  assert.throws(() => assertThrowawayTarget({ ...OK, dbFile: resolve(ROOT, 'data/sanad.db'), armed: true }),
    /قاعدة التطوير/);
});

test('guard: an explicitly chosen path requires the intent flag (migrate-legacy precedent)', () => {
  assert.throws(() => assertThrowawayTarget({ ...OK, explicit: true, armed: false }), /SANAD_SCENARIOS=1/);
  assert.equal(assertThrowawayTarget({ ...OK, explicit: true, armed: true }), true);
});

test('guard: the default self-created throwaway path needs no flag — safe by construction', () => {
  assert.equal(assertThrowawayTarget(OK), true);
});

test('census: table list is derived from the migrations, not a hand-kept list', () => {
  const t = schemaTables();
  for (const must of ['audit_log', 'app_user', 'project', 'opportunity', 'task', 'time_entry', 'allocation', 'invoice'])
    assert.ok(t.includes(must), `${must} غائب عن قائمة الجداول`);
  // تعليق داخل ملف ترحيل يذكر «CREATE TABLE» نصاً — يجب ألا يُقرأ جدولاً
  assert.ok(!t.some((x) => x.includes('/')), 'لا اسم جدول مشوَّه من نص تعليق');
  assert.ok(t.length > 60, 'قائمة الجداول تبدو ناقصة');
});

test('census: a MUTATED existing row shows as one added + one removed (count alone would miss it)', () => {
  const before = new Map([['app_user', [{ id: 'u1', last_login_at: null }, { id: 'u2', last_login_at: null }]]]);
  const after = new Map([['app_user', [{ id: 'u1', last_login_at: '2026-07-27T00:00:00Z' }, { id: 'u2', last_login_at: null }]]]);
  const diff = censusDiff(before, after);
  assert.equal(diff.length, 1);
  assert.equal(diff[0].added.length, 1);
  assert.equal(diff[0].removed.length, 1);
  assert.equal(before.get('app_user').length, after.get('app_user').length, 'العدد نفسه — فالعدّ وحده لا يكفي دليلاً');
});

test('census: identical content in a different key order is NOT a difference', () => {
  const before = new Map([['t', [{ a: 1, b: 2 }]]]);
  const after = new Map([['t', [{ b: 2, a: 1 }]]]);
  assert.deepEqual(censusDiff(before, after), []);
});

test('census: a soft-deleted row still counts as present — removal must be proven, not assumed', () => {
  const before = new Map([['employee', [{ id: 'e1', deleted_at: null }]]]);
  const softDeleted = new Map([['employee', [{ id: 'e1', deleted_at: '2026-07-27T00:00:00Z' }]]]);
  assert.equal(censusDiff(before, softDeleted).length, 1, 'الحذف الناعم فرقٌ لا نظافة');
  const hardDeleted = new Map([['employee', []]]);
  assert.equal(censusDiff(before, hardDeleted)[0].removed.length, 1, 'والحذف الفعلي يظهر نقصاً');
});

test('data hygiene: every synthetic name carries the scenario mark — nothing can read as real EVC data', () => {
  const ds = D.buildDataset({ today: '2026-07-27' });
  const named = [
    ...ds.sectors.map((s) => s.name_ar), ...ds.departments.map((d) => d.name_ar),
    ...ds.people.map((p) => p.name_ar), ...ds.clients.map((c) => c.name_ar),
    ...ds.opportunities.map((o) => o.title_ar), ...ds.projects.map((p) => p.name_ar),
    ...ds.tasks.map((k) => k.title),
    ...ds.projects.flatMap((p) => p.deliverables.map((d) => d.name_ar)),
  ];
  assert.ok(named.length > 40, 'الحزمة الاصطناعية أصغر مما ينبغي');
  for (const n of named) assert.match(n, /سيناريو تجريبي/, `اسم بلا وسم: ${n}`);
  assert.equal(D.isScenarioName('أمانة العاصمة المقدسة'), false, 'اسمٌ واقعي لا يُقرأ وسماً');
  assert.equal(D.isScenarioName('مسؤول النظام (تجريبي)'), true, 'حسابات العرض موسومة أيضاً');
});

test('data hygiene: money is whole SAR only — no floats reach the halalas columns from the dataset', () => {
  const ds = D.buildDataset({ today: '2026-07-27' });
  const amounts = [
    ...ds.sectors.flatMap((s) => [s.target_sales_sar, s.target_revenue_sar]),
    ...ds.people.map((p) => p.salary_sar), ...ds.opportunities.map((o) => o.value_sar),
    ...ds.projects.map((p) => p.value_sar), ...ds.projects.flatMap((p) => p.deliverables.map((d) => d.amount_sar)),
    ...ds.revenues.map((r) => r.amount_sar),
  ].filter((v) => v != null);
  for (const v of amounts) assert.ok(Number.isInteger(v), `مبلغ غير صحيح: ${v}`);
});

test('data hygiene: dates come from the passed-in day — the same run twice gives the same dates', () => {
  const a = D.buildDataset({ today: '2026-07-27' });
  const b = D.buildDataset({ today: '2026-07-27' });
  const c = D.buildDataset({ today: '2026-03-01' });
  assert.deepEqual(a.tasks.map((x) => x.due_date), b.tasks.map((x) => x.due_date), 'تشغيلان بنفس اليوم = نفس التواريخ');
  assert.notDeepEqual(a.tasks.map((x) => x.due_date), c.tasks.map((x) => x.due_date), 'واليوم المُمرَّر هو ما يحرّكها');
  assert.equal(a.timesheet.period.start, '2026-07-18');
  assert.equal(a.timesheet.period.end, '2026-07-24');
});

test('purge order: every child table precedes its parent (the order the purge relies on)', () => {
  const at = (t2) => D.PURGE_ORDER.indexOf(t2);
  // أزواج مثبَّتة من مفاتيح الترحيلة 001: الابن يجب أن يسبق أباه وإلا رفض المحرّك الحذف.
  for (const [child, parent] of [
    ['invoice_line', 'invoice'], ['collection', 'invoice'], ['invoice', 'contract'], ['contract', 'project'],
    ['task', 'project'], ['deliverable', 'project'], ['allocation', 'project'], ['time_entry', 'task'],
    ['project', 'opportunity'],           // project.source_opp_id ⟵ opportunity
    ['opportunity', 'client'], ['employee', 'department'], ['department', 'sector'],
    ['approval_action', 'approval_request'],
  ]) {
    assert.ok(at(child) >= 0 && at(parent) >= 0, `${child}/${parent} خارج ترتيب المحو`);
    assert.ok(at(child) < at(parent), `${child} يجب أن يُحذف قبل ${parent}`);
  }
});
