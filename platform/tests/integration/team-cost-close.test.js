// ── الإقفال الشهري لتوزيع التكلفة: من المسودة إلى الإصدار المصحَّح ─────────────────────────
//
// حالات القبول من الموجّه: T04 (النسبة من تكلفة الشهر لا من الطاقة)، T27 (المجموع ≠ 100%)،
// T28 (كود مالي مفقود يبقى استثناءً)، T29 (البنود الداخلية وغير المسكَّن إلى القطاع، وغير
// المرتبط يُستبعد بسبب)، T30 (مشروع مغلق اليوم كان قائماً في الشهر)، T31 (إقفالان متزامنان)،
// T32 (لا تعديل بعد الإقفال)، T33 (التصحيح إصدارٌ جديد والسابق محفوظ)، T34 (تعارض الإصدار)،
// T35 (المجموع 10000 والتصدير يطابق اللقطة)، T36 (الترحيل «لم يتم» دائماً).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-cost-close-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, C, resolveUser;
const T = new Date().toISOString();
// شهرٌ منقضٍ ثابت: حزيران 2026 — كل التواريخ أدناه تُقاس عليه.
const YEAR = 2026; const MONTH = 6; const KEY = '2026-06';

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });
const rowOf = (view, empId) => view.rows.find((r) => r.employeeId === empId);
const lineOf = (row, kind, id2) => row.lines.find((l) => l.target_kind === kind && l.target_id === id2);
const audits = (resource, action) => db.all('SELECT * FROM audit_log WHERE resource = ? AND action = ? ORDER BY at', [resource, action]);
// قارئ CSV صغير يحترم الاقتباس — كي يُقارَن الملف باللقطة حقلاً حقلاً.
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') { /* تجاهل */ }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const [head, ...rest] = rows;
  return rest.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

let periodId;               // الإصدار 1 لقطاع الحلول
before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  C = await import('../../src/modules/team/cost-close.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });            // بلا مركز تكلفة ⇒ الرمز معرّفه
  await db.insert('sector', { id: 'CONS', name_ar: 'قطاع الاستشارات', kind: 'delivery', cost_center: 'CC-CONS', active: 1, created_at: T });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة الاقتصاد والتخطيط', created_at: T });

  const mkUser = (id2, role, sector = 'SOL', scope = 'own') => db.insert('app_user', {
    id: id2, username: id2, name_ar: 'حساب ' + id2, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_admin', 'admin', 'SOL', 'company');
  await mkUser('u_ceo', 'ceo_office', null, 'company');          // «المراجعة المالية» — لا دور مالية
  await mkUser('u_lead', 'sector_lead', 'SOL', 'sector');
  await mkUser('u_dm', 'department_manager');                     // مدير الابتكار
  await mkUser('u_dm2', 'department_manager');                    // مدير الذكاء
  await mkUser('u_emp', 'employee');
  await mkUser('u_hr', 'hr', 'SOL', 'company');

  await db.insert('department', { id: 'D_INNOV', sector_id: 'SOL', name_ar: 'إدارة الابتكار', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_AI', sector_id: 'SOL', name_ar: 'إدارة الذكاء', manager_user_id: 'u_dm2', active: 1, created_at: T });
  await db.insert('department', { id: 'D_CONS', sector_id: 'CONS', name_ar: 'إدارة الاستشارات', active: 1, created_at: T });

  const mkEmp = async (id2, name, dept, extra = {}, uid = null) => {
    await db.insert('employee', { id: id2, user_id: uid, name_ar: name, sector_id: extra.sector_id || 'SOL', department_id: dept,
      job_title: 'استشاري', active: 1, hire_date: '2025-01-01', created_at: T, ...extra });
    if (uid) await db.update('app_user', uid, { employee_id: id2 });
  };
  await mkEmp('e_dm', 'مدير الابتكار', 'D_INNOV', {}, 'u_dm');
  await mkEmp('e_dm2', 'مدير الذكاء', 'D_AI', {}, 'u_dm2');
  await mkEmp('e_a', 'أحمد الفاضل', 'D_INNOV');
  await mkEmp('e_half', 'نورة نصف الدوام', 'D_INNOV', { capacity_pct: 50 });          // T04
  await mkEmp('e_b', 'خالد الذكاء', 'D_AI');
  await mkEmp('e_self', 'موظف عادي', 'D_INNOV', {}, 'u_emp');
  await mkEmp('e_new', 'ملتحق لاحقاً', 'D_INNOV', { hire_date: '2026-07-15' });        // بعد الشهر ⇒ مستبعد
  await mkEmp('e_gone', 'مغادر سابق', 'D_INNOV', { end_date: '2026-05-20', active: 0 }); // قبل الشهر ⇒ مستبعد
  await mkEmp('e_c', 'مستشار', 'D_CONS', { sector_id: 'CONS' });

  const mkProject = (id2, name, extra = {}) => db.insert('project', { id: id2, name_ar: name, sector_id: 'SOL', client_id: 'CL',
    status: 'IN_PROGRESS', kind: 'external', start_date: '2026-01-01', created_at: T, ...extra });
  await mkProject('P_FIN', 'منصة البيانات الوطنية', { financial_code: 'FC-100' });
  await mkProject('P_NOFIN', 'مشروع بلا كود مالي');                                             // T28
  await mkProject('P_DONE', 'مشروع أُنجز في حزيران', { financial_code: 'FC-300', status: 'COMPLETED', end_date: '2026-06-30' }); // T30
  await mkProject('P_OLD', 'مشروع انتهى في أيار', { financial_code: 'FC-400', status: 'CANCELLED', end_date: '2026-05-31' });   // خارج الشهر
  await mkProject('P_CONS', 'مشروع استشاري', { financial_code: 'FC-200', sector_id: 'CONS' });

  // التسكين المؤكد لحزيران (نسبٌ من طاقة المورد ككسور 0–1.5 كما يخزّنها المنتج)
  const alloc = (id2, emp, target, mj, extra = {}) => db.insert('allocation', { id: id2, employee_id: emp, sector_id: 'SOL', type: 'member',
    year: YEAR, monthly_json: JSON.stringify(mj), source: 'manual', created_at: T, ...target, ...extra });
  await alloc('al_a1', 'e_a', { project_id: 'P_FIN', project_name: 'منصة البيانات الوطنية' }, { 6: 0.6 });
  await alloc('al_a2', 'e_a', { project_id: null, work_bucket: 'bd', project_name: 'تطوير أعمال' }, { 6: 0.2 });
  await alloc('al_a3', 'e_a', { project_id: 'P_OLD', project_name: 'مبدئي' }, { 6: 0.5 }, { status: 'tentative' });   // مبدئي لا يدخل
  await alloc('al_h1', 'e_half', { project_id: 'P_FIN', project_name: 'منصة البيانات الوطنية' }, { 6: 1 });         // نصف دوام بكامله
  await alloc('al_b1', 'e_b', { project_id: 'P_NOFIN', project_name: 'مشروع بلا كود مالي' }, { 6: 0.5 });
  await alloc('al_b2', 'e_b', { project_id: 'P_DONE', project_name: 'مشروع أُنجز في حزيران' }, { 6: 0.5 });
  await alloc('al_n1', 'e_new', { project_id: 'P_FIN', project_name: 'منصة البيانات الوطنية' }, { 6: 1 });        // لمورد غير مرتبط
  await alloc('al_c1', 'e_c', { project_id: 'P_CONS', project_name: 'مشروع استشاري' }, { 6: 0.5 }, { sector_id: 'CONS' });
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── T29: المسودة من التسكين المؤكد — البنود الداخلية وغير المسكَّن إلى القطاع، وغير المرتبط مستبعد ──
test('T29 — فتح الشهر ينشئ المسودة (الإصدار 1): المشاريع بأكوادها، والباقي على مركز تكلفة القطاع، وغير المرتبط مستبعد بسبب', async () => {
  const view = await C.periodOverview(await sess('u_ceo'), { sector: 'SOL', year: YEAR, month: MONTH });
  periodId = view.period.id;
  assert.equal(view.period.status, 'draft');
  assert.equal(view.period.status_ar, 'مسودة');
  assert.equal(view.period.version, 1);
  assert.equal(view.period.key, KEY);
  assert.ok(Array.isArray(view.period.stage_steps) && view.period.stage_steps[0].state === 'current');

  // أحمد: 60% مشروع + 20% تطوير أعمال + 20% بلا تسكين ⇒ 6000 للمشروع و4000 للقطاع
  const a = rowOf(view, 'e_a');
  assert.equal(a.projectsBp, 6000);
  assert.equal(a.sectorBp, 4000);
  assert.equal(a.unallocatedBp, 0, 'المجموع 10000 — لا بقية معلّقة');
  assert.equal(lineOf(a, 'project', 'P_FIN').fin_code, 'FC-100');
  const sec = lineOf(a, 'sector', 'SOL');
  assert.equal(sec.fin_code, 'SOL', 'بلا مركز تكلفة ⇒ معرّف القطاع نفسه رمزاً — لا رمز مخترَع');
  assert.match(sec.note, /عمل داخلي/);
  assert.match(sec.note, /غير مسكَّن 20%/);
  assert.equal(a.reviewStatus, 'draft');
  assert.deepEqual(a.exceptions, []);
  assert.ok(a.lines.every((l) => l.basis === 'allocation'));
  assert.ok(!('salary_halalas' in a) && !JSON.stringify(view).includes('salary'), 'لا مال في نظرة الإقفال');

  // بلا تسكين إطلاقاً ⇒ القطاع 10000
  const self = rowOf(view, 'e_self');
  assert.equal(self.sectorBp, 10000);
  assert.equal(self.projectsBp, 0);

  // المستبعدون بسبب مكتوب — ولا سطر تكلفة لهم ولو كان لهم تسكين
  const n = rowOf(view, 'e_new'); const g = rowOf(view, 'e_gone');
  assert.equal(n.reviewStatus, 'excluded');
  assert.equal(n.reviewStatus_ar, 'مستبعد');
  assert.equal(n.excluded.code, 'not_started');
  assert.match(n.excluded.label_ar, /2026-07-15/);
  assert.equal(n.lines.length, 0);
  assert.equal(g.excluded.code, 'ended');
  assert.equal(view.counters.excluded, 2);
  assert.ok(!view.rows.some((r) => r.employeeId === 'e_c'), 'مورد قطاعٍ آخر لا يدخل في هذه الفترة');

  // مركز التكلفة حين يكون مسجَّلاً
  const cons = await C.periodOverview(await sess('u_ceo'), { sector: 'CONS', period: KEY });
  const c = rowOf(cons, 'e_c');
  assert.equal(lineOf(c, 'project', 'P_CONS').shareBp, 5000);
  assert.equal(lineOf(c, 'sector', 'CONS').fin_code, 'CC-CONS');
  assert.equal(lineOf(c, 'sector', 'CONS').shareBp, 5000);

  // الأثر: إنشاء الفترة وتوليد المسودة
  assert.ok((await audits('cost_period', 'create')).length >= 2, 'إنشاء الفترة بلا أثر');
  const gen = await audits('cost_period', 'generate_draft');
  assert.ok(gen.some((r) => r.resource_id === periodId && r.user_id === 'u_ceo'), 'توليد المسودة بلا أثر');
});

test('T04 — مستشار نصف دوام مسكَّن بكامله على مشروع واحد ⇒ 10000 للمشروع (النسبة من تكلفة الشهر لا تُضرب في الطاقة)', async () => {
  const shares = await C.resourceShares(await sess('u_lead'), periodId, 'e_half');
  assert.equal(shares.lines.length, 1);
  assert.equal(shares.lines[0].target_id, 'P_FIN');
  assert.equal(shares.lines[0].shareBp, 10000);
  assert.equal(shares.lines[0].sharePct, '100.00');
  assert.equal(shares.totalBp, 10000);
  assert.equal(shares.reference.items[0].pct, 100, 'المرجع: 100% من طاقته');
  assert.equal(shares.reference.capacity.nominalPct, 50);
  assert.equal(shares.draftDiff_ar, 'مطابق للتسكين المؤكد للشهر');
  assert.equal(shares.canConfirm, true);
});

test('T28 — كود مالي مفقود يبقى استثناءً رغم اكتمال المجموع؛ يُحفظ التأكيد ويُمنع الإرسال حتى يُسجَّل الكود', async () => {
  const view = await C.periodOverview(await sess('u_lead'), { year: YEAR, month: MONTH });   // قطاعه هو
  const b = rowOf(view, 'e_b');
  assert.equal(b.totalBp, 10000);
  assert.ok(b.exceptions.some((x) => x.code === 'missing_fin_code'), 'الاستثناء غائب رغم غياب الكود');
  assert.match(b.exceptions.find((x) => x.code === 'missing_fin_code').label_ar, /كود مالي مفقود/);
  assert.equal(view.canSendToFinance, false);

  // مدير إدارة الذكاء يؤكد توزيع أهل إدارته كما هو — يُحفظ مؤكداً والاستثناء باقٍ
  const saved = await C.confirmShares(await ctxOf('u_dm2'), periodId, 'e_b', {
    lines: [{ target_kind: 'project', target_id: 'P_NOFIN', shareBp: 5000 }, { target_kind: 'project', target_id: 'P_DONE', shareBp: 5000 }],
    reason: 'كما في خطة حزيران',
  });
  assert.equal(saved.reviewStatus, 'confirmed');
  assert.ok(saved.exceptions.some((x) => x.code === 'missing_fin_code'));
  assert.equal(saved.lines[0].basis, 'allocation', 'مطابقٌ للمسودة ⇒ أساسه التسكين');

  await assert.rejects(async () => C.sendToFinance(await ctxOf('u_lead'), periodId), (e) => {
    assert.equal(e.status, 400);
    assert.match(e.message, /خالد الذكاء/);
    assert.match(e.message, /كود مالي مفقود/);
    return true;
  });
  // بعد تسجيل الكود على المشروع يزول الاستثناء بلا إعادة توليد
  await db.update('project', 'P_NOFIN', { financial_code: 'FC-500' });
  const again = await C.periodOverview(await sess('u_lead'), { year: YEAR, month: MONTH });
  assert.deepEqual(rowOf(again, 'e_b').exceptions, []);
  assert.equal(lineOf(rowOf(again, 'e_b'), 'project', 'P_NOFIN').fin_code, 'FC-500');
});

test('T30 — مشروع مكتمل/ملغى اليوم كان قائماً في الشهر بتواريخه يُقبل؛ ومشروع انتهى قبل الشهر يُرفض بالاسم', async () => {
  const b = await C.resourceShares(await sess('u_dm2'), periodId, 'e_b');
  const done = b.lines.find((l) => l.target_id === 'P_DONE');
  assert.equal(done.shareBp, 5000);
  assert.deepEqual(done.exceptions, [], 'المشروع المكتمل كان قائماً في حزيران — لا استثناء');
  await assert.rejects(async () => C.confirmShares(await ctxOf('u_dm'), periodId, 'e_a', {
    lines: [{ target_kind: 'project', target_id: 'P_OLD', shareBp: 10000 }],
  }), (e) => {
    assert.equal(e.status, 400);
    assert.match(e.message, /مشروع انتهى في أيار/);
    assert.match(e.message, /لم يكن قائماً/);
    return true;
  });
});

test('T27 — مجموع ≠ 10000: التأكيد يُرفض برسالة تسمّي المجموع، والصف يُعلَّم «المجموع لا يساوي 100%» ويمنع الإرسال', async () => {
  await assert.rejects(async () => C.confirmShares(await ctxOf('u_dm'), periodId, 'e_a', {
    lines: [{ target_kind: 'project', target_id: 'P_FIN', shareBp: 6000 }, { target_kind: 'sector', shareBp: 3000 }],
  }), (e) => {
    assert.equal(e.status, 400);
    assert.match(e.message, /90\.00%/);
    assert.match(e.message, /9000 نقطة أساس/);
    assert.equal(e.details.totalBp, 9000);
    return true;
  });
  // لا كسور ولا أصفار
  await assert.rejects(async () => C.confirmShares(await ctxOf('u_dm'), periodId, 'e_a', {
    lines: [{ target_kind: 'project', target_id: 'P_FIN', shareBp: 9999.5 }, { target_kind: 'sector', shareBp: 0.5 }],
  }), /نقاط أساس صحيحة/);
  // سطرٌ شارد يُخلّ بالمجموع ⇒ استثناء sum_mismatch ومانع بالاسم
  await db.insert('cost_share', { id: 'cs_stray', period_id: periodId, employee_id: 'e_self', target_kind: 'sector', target_id: 'SOL',
    fin_code: 'SOL', share_bp: 500, basis: 'allocation', review_status: 'draft', created_at: T });
  const view = await C.periodOverview(await sess('u_lead'), { year: YEAR, month: MONTH });
  const self = rowOf(view, 'e_self');
  assert.ok(self.exceptions.some((x) => x.code === 'sum_mismatch'));
  assert.match(self.exceptions.find((x) => x.code === 'sum_mismatch').label_ar, /105\.00%/);
  assert.ok(view.blockers_ar.some((b) => b.includes('موظف عادي') && b.includes('105.00%')));
  await assert.rejects(async () => C.sendToFinance(await ctxOf('u_lead'), periodId), /موظف عادي/);
  await db.update('cost_share', 'cs_stray', { deleted_at: T });
});

test('مراجعة المدير: تأكيد أهل إدارته فقط، والحالة تصير «مراجعة المدير»، ثم الإرسال والإعادة بسبب', async () => {
  // مدير الابتكار لا يؤكد لأهل الذكاء
  await assert.rejects(async () => C.confirmShares(await ctxOf('u_dm'), periodId, 'e_b', {
    lines: [{ target_kind: 'sector', shareBp: 10000 }],
  }), (e) => e.status === 403);
  // ولا يؤكد لمورد خارج الارتباط
  await assert.rejects(async () => C.confirmShares(await ctxOf('u_dm'), periodId, 'e_new', {
    lines: [{ target_kind: 'sector', shareBp: 10000 }],
  }), /خارج|بعد نهاية الشهر/);

  const a = await C.confirmShares(await ctxOf('u_dm'), periodId, 'e_a', {
    lines: [{ target_kind: 'project', target_id: 'P_FIN', shareBp: 7000 }, { target_kind: 'sector', shareBp: 3000 }],
    reason: 'عمل إضافي على المنصة في النصف الثاني', sourceRef: 'كشف الدوام',
  });
  assert.equal(a.reviewStatus, 'confirmed');
  assert.equal(a.lines.find((l) => l.target_kind === 'project').basis, 'manager', 'يختلف عن المسودة ⇒ تعديل المدير');
  assert.equal(a.lines[0].confirmed_by, 'u_dm');
  assert.match(a.draftDiff_ar, /يختلف عن التسكين المؤكد/);
  assert.equal(a.period.status, 'manager_review');

  const lead = await ctxOf('u_lead');
  await C.confirmShares(lead, periodId, 'e_half', { lines: [{ target_kind: 'project', target_id: 'P_FIN', shareBp: 10000 }] });
  await C.confirmShares(lead, periodId, 'e_self', { lines: [{ target_kind: 'sector', target_id: 'SOL', shareBp: 10000 }] });
  await C.confirmShares(lead, periodId, 'e_dm', { lines: [{ target_kind: 'sector', shareBp: 10000 }] });
  await C.confirmShares(lead, periodId, 'e_dm2', { lines: [{ target_kind: 'sector', shareBp: 10000 }] });

  const before = await C.periodOverview(lead.user, { year: YEAR, month: MONTH });
  assert.deepEqual(before.blockers_ar, []);
  assert.equal(before.counters.complete, before.counters.resources);
  assert.equal(before.canSendToFinance, true);
  // مدير إدارة لا يرسل القطاع كله
  await assert.rejects(async () => C.sendToFinance(await ctxOf('u_dm'), periodId), (e) => e.status === 403);
  const sent = await C.sendToFinance(lead, periodId);
  assert.equal(sent.period.status, 'finance_review');
  // عند المراجعة المالية لا تعديل من المدير
  await assert.rejects(async () => C.confirmShares(lead, periodId, 'e_a', { lines: [{ target_kind: 'sector', shareBp: 10000 }] }), (e) => {
    assert.equal(e.status, 409); assert.match(e.message, /المراجعة المالية/); return true;
  });
  // الإعادة بسبب
  const ceo = await ctxOf('u_ceo');
  await assert.rejects(async () => C.returnToManager(ceo, periodId, ''), /سبب/);
  await assert.rejects(async () => C.returnToManager(lead, periodId, 'سبب'), (e) => e.status === 403);
  const back = await C.returnToManager(ceo, periodId, 'راجع نسبة أحمد على المنصة');
  assert.equal(back.period.status, 'manager_review');
  assert.equal(back.period.finance_note, 'راجع نسبة أحمد على المنصة');
  const resent = await C.sendToFinance(lead, periodId);
  assert.equal(resent.period.status, 'finance_review');
  assert.equal(resent.canLock, false, 'قائد القطاع لا يقفل');
  assert.equal((await C.periodOverview(ceo.user, { sector: 'SOL', period: KEY })).canLock, true);
  assert.equal((await audits('cost_period', 'send_to_finance')).length, 2);
  assert.equal((await audits('cost_period', 'return_to_manager')).length, 1);
  assert.equal((await audits('cost_share', 'confirm')).length, 6, 'ست تأكيدات = ستة آثار');
});

test('T31 — إقفالان متزامنان بنفس الإصدار: واحد ينجح والآخر يُردّ بتعارض عربي، ولا إصدار ثانٍ', async () => {
  const ceo = await ctxOf('u_ceo');
  const admin = await ctxOf('u_admin');
  // إصدار مختلف ⇒ تعارض قبل أي كتابة
  await assert.rejects(async () => C.lockPeriod(ceo, periodId, { expectedVersion: 2 }), (e) => {
    assert.equal(e.status, 409); assert.match(e.message, /الإصدار/); return true;
  });
  await assert.rejects(async () => C.lockPeriod(ceo, periodId, {}), /رقم الإصدار/);

  const settle = (p) => p.then((v) => ({ ok: v }), (e) => ({ err: e }));
  const [r1, r2] = await Promise.all([
    settle(C.lockPeriod(ceo, periodId, { expectedVersion: 1 })),
    settle(C.lockPeriod(admin, periodId, { expectedVersion: 1 })),
  ]);
  const oks = [r1, r2].filter((r) => r.ok); const errs = [r1, r2].filter((r) => r.err);
  assert.equal(oks.length, 1, 'لم ينجح إقفال واحد بالضبط');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].err.status, 409);
  assert.match(errs[0].err.message, /للتو|مقفل/);
  assert.equal(oks[0].ok.status, 'locked');
  assert.equal(oks[0].ok.version, 1);

  const versions = await db.all('SELECT id, version, status, locked_snapshot_json, finance_locked_by, finance_locked_at FROM cost_period WHERE sector_id = ? AND year = ? AND month = ?', ['SOL', YEAR, MONTH]);
  assert.equal(versions.length, 1, 'ظهر إصدار ثانٍ');
  assert.equal(versions[0].status, 'locked');
  assert.ok(versions[0].locked_snapshot_json && versions[0].finance_locked_by && versions[0].finance_locked_at);
  assert.equal((await audits('cost_period', 'lock')).length, 1, 'أثر الإقفال يجب أن يُكتب مرة واحدة');
});

test('T32 — بعد الإقفال يُرفض تأكيد التوزيع وتوليد المسودة، ويُرفض الإقفال مرة ثانية', async () => {
  const lead = await ctxOf('u_lead');
  await assert.rejects(async () => C.confirmShares(lead, periodId, 'e_a', { lines: [{ target_kind: 'sector', shareBp: 10000 }] }), (e) => {
    assert.equal(e.status, 409); assert.match(e.message, /مقفل/); assert.match(e.message, /تصحيح/); return true;
  });
  await assert.rejects(async () => C.generateDraft(lead, periodId, { preserveConfirmed: false }), (e) => {
    assert.equal(e.status, 409); assert.match(e.message, /مقفل/); return true;
  });
  await assert.rejects(async () => C.lockPeriod(await ctxOf('u_ceo'), periodId, { expectedVersion: 1 }), /مقفل أصلاً/);
  const view = await C.periodOverview(lead.user, { year: YEAR, month: MONTH });
  assert.equal(view.period.status, 'locked');
  assert.equal(view.canGenerate, false);
  assert.equal(view.canSendToFinance, false);
  assert.ok(view.period.stage_steps.every((s) => s.state === 'done'));
  // والأسطر كما كانت — لم يمسّها شيء
  const a = rowOf(view, 'e_a');
  assert.equal(lineOf(a, 'project', 'P_FIN').shareBp, 7000);
  assert.equal(a.reviewStatus, 'confirmed');
});

test('T35 — كل مورد في اللقطة مجموعه 10000، والتصدير من اللقطة يطابقها حقلاً حقلاً بأعمدة العقد وبلا أي مال', async () => {
  const row = await db.get('SELECT locked_snapshot_json FROM cost_period WHERE id = ?', [periodId]);
  const snap = JSON.parse(row.locked_snapshot_json);
  const sums = new Map();
  for (const l of snap.lines) sums.set(l.employee_id, (sums.get(l.employee_id) || 0) + l.share_bp);
  assert.equal(sums.size, 6, 'ستة موارد مؤهلة في اللقطة');
  for (const [emp, s] of sums) assert.equal(s, 10000, `${emp}: المجموع ${s}`);
  assert.ok(snap.lines.every((l) => Number.isInteger(l.share_bp)), 'نقاط أساس صحيحة لا عائم');
  assert.equal(snap.excluded.length, 2);
  assert.ok(!JSON.stringify(snap).includes('salary') && !JSON.stringify(snap).includes('halalas'), 'لا مال في اللقطة');

  const out = await C.exportPeriod(await sess('u_ceo'), periodId);
  assert.equal(out.filename, `cost-close-SOL-${KEY}-v1.csv`);
  const lines = out.csv.split('\r\n').filter(Boolean);
  assert.equal(lines[0], 'resource_id,month,sector,target_kind,fin_code,share_bp,share_pct,basis,review_status,confirmed_by,confirmed_at,lock_version,correction_ref,note');
  const rows = parseCsv(out.csv);
  assert.equal(rows.length, snap.lines.length, 'عدد أسطر الملف ≠ عدد أسطر اللقطة');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const l = snap.lines[i];
    assert.equal(r.resource_id, l.employee_id);
    assert.equal(r.month, KEY);
    assert.equal(r.sector, 'SOL');
    assert.equal(r.target_kind, l.target_kind);
    assert.equal(r.fin_code, l.fin_code);
    assert.equal(Number(r.share_bp), l.share_bp);
    assert.equal(r.share_pct, (l.share_bp / 100).toFixed(2));
    assert.equal(r.basis, l.basis);
    assert.equal(r.review_status, 'confirmed');
    assert.equal(r.confirmed_by, l.confirmed_by);
    assert.equal(Number(r.lock_version), 1);
    assert.equal(r.correction_ref, '');
  }
  assert.ok(rows.some((r) => r.resource_id === 'e_a' && r.fin_code === 'FC-100' && r.share_bp === '7000' && r.basis === 'manager'));
  assert.ok(rows.every((r) => r.fin_code), 'كل سطر بكود مالي — لا فراغ');
  // التصدير للمراجعة المالية وحدها، ولا يُصدَّر شهر غير مقفل
  await assert.rejects(async () => C.exportPeriod(await sess('u_lead'), periodId), (e) => e.status === 403);
  const cons = await C.periodOverview(await sess('u_ceo'), { sector: 'CONS', period: KEY });
  await assert.rejects(async () => C.exportPeriod(await sess('u_ceo'), cons.period.id), /مقفل/);
  assert.ok((await audits('cost_period', 'export')).some((r) => r.resource_id === periodId && r.user_id === 'u_ceo'), 'التصدير بلا أثر');
});

test('T36 — حالة الترحيل «لم يتم» دائماً: في النظرة وفي الإقفال وفي الصف', async () => {
  const view = await C.periodOverview(await sess('u_ceo'), { sector: 'SOL', period: KEY });
  assert.deepEqual(view.transfer, { status: 'not_transferred', status_ar: 'لم يتم' });
  assert.deepEqual(view.period.transfer, { status: 'not_transferred', status_ar: 'لم يتم' });
  const row = await db.get('SELECT transfer_status FROM cost_period WHERE id = ?', [periodId]);
  assert.equal(row.transfer_status, 'not_transferred');
  const out = await C.exportPeriod(await sess('u_admin'), periodId);
  assert.equal(out.transfer.status_ar, 'لم يتم');
  assert.ok(!out.csv.includes('transfer'), 'لا عمود ترحيل في الملف — لا تكامل خارجي في هذه النسخة');
});

let v2Id;
test('T33 — التصحيح بعد الإقفال: طلب معلق بالقديم والمقترح، واعتماده ينشئ الإصدار 2 مقفلاً ويُبقي الإصدار 1 بلقطته', async () => {
  const dm = await ctxOf('u_dm');
  // بلا سبب ⇒ رفض؛ مطابق للمقفل ⇒ رفض؛ كود مفقود ⇒ رفض
  await assert.rejects(async () => C.createCorrection(dm, periodId, 'e_a', { proposed: [{ target_kind: 'sector', shareBp: 10000 }], reason: '' }), /سبب/);
  await assert.rejects(async () => C.createCorrection(dm, periodId, 'e_a', {
    proposed: [{ target_kind: 'project', target_id: 'P_FIN', shareBp: 7000 }, { target_kind: 'sector', shareBp: 3000 }], reason: 'لا تغيير',
  }), /مطابق/);
  await db.update('project', 'P_NOFIN', { financial_code: null });
  await assert.rejects(async () => C.createCorrection(dm, periodId, 'e_a', {
    proposed: [{ target_kind: 'project', target_id: 'P_NOFIN', shareBp: 10000 }], reason: 'تجربة كود مفقود',
  }), /بلا كود مالي/);
  await db.update('project', 'P_NOFIN', { financial_code: 'FC-500' });
  // مدير الابتكار لا يطلب تصحيحاً لأهل الذكاء
  await assert.rejects(async () => C.createCorrection(dm, periodId, 'e_b', { proposed: [{ target_kind: 'sector', shareBp: 10000 }], reason: 'خطأ' }), (e) => e.status === 403);

  const corr = await C.createCorrection(dm, periodId, 'e_a', {
    proposed: [{ target_kind: 'project', target_id: 'P_FIN', shareBp: 8000 }, { target_kind: 'sector', shareBp: 2000 }],
    reason: 'كشف الدوام النهائي يثبت 80% على المنصة', evidenceLabel: 'كشف دوام حزيران',
  });
  assert.equal(corr.status, 'pending');
  assert.equal(corr.status_ar, 'بانتظار القرار');
  assert.deepEqual(corr.previous.map((l) => [l.target_kind, l.share_bp]), [['project', 7000], ['sector', 3000]], 'القديم من اللقطة');
  assert.deepEqual(corr.proposed.map((l) => [l.target_kind, l.share_bp]), [['project', 8000], ['sector', 2000]]);
  assert.equal(corr.previous_version, 1);
  const stored = await db.get('SELECT proposed_json, status FROM cost_correction WHERE id = ?', [corr.id]);
  assert.ok(JSON.parse(stored.proposed_json).previous.length === 2, 'القديم محفوظ في الصف نفسه');
  // طلب ثانٍ معلق للمورد نفسه يُرفض
  await assert.rejects(async () => C.createCorrection(dm, periodId, 'e_a', { proposed: [{ target_kind: 'sector', shareBp: 10000 }], reason: 'مكرر' }), (e) => e.status === 409);
  // القرار للمراجعة المالية وحدها
  await assert.rejects(async () => C.decideCorrection(await ctxOf('u_lead'), corr.id, 'approve'), (e) => e.status === 403);
  await assert.rejects(async () => C.decideCorrection(await ctxOf('u_ceo'), corr.id, 'reject', ''), /سبب/);

  const snapBefore = (await db.get('SELECT locked_snapshot_json FROM cost_period WHERE id = ?', [periodId])).locked_snapshot_json;
  const linesBefore = (await db.get('SELECT COUNT(*) AS n FROM cost_share WHERE period_id = ? AND deleted_at IS NULL', [periodId])).n;
  const res = await C.decideCorrection(await ctxOf('u_ceo'), corr.id, 'approve', 'موافق');
  v2Id = res.period.id;
  assert.equal(res.period.version, 2);
  assert.equal(res.period.status, 'locked');
  assert.equal(res.period.supersedes_id, periodId);
  assert.equal(res.superseded.status, 'superseded');

  const v1 = await db.get('SELECT status, version, locked_snapshot_json FROM cost_period WHERE id = ?', [periodId]);
  assert.equal(v1.status, 'superseded');
  assert.equal(v1.locked_snapshot_json, snapBefore, 'لقطة الإصدار الأول تغيّرت');
  const v2 = await db.get('SELECT * FROM cost_period WHERE id = ?', [v2Id]);
  assert.equal(v2.version, 2);
  assert.equal(v2.status, 'locked');
  assert.equal(v2.supersedes_id, periodId);
  assert.equal(v2.finance_locked_by, 'u_ceo');
  assert.equal(v2.transfer_status, 'not_transferred');
  const s2 = JSON.parse(v2.locked_snapshot_json);
  const s1 = JSON.parse(snapBefore);
  const aLines = s2.lines.filter((l) => l.employee_id === 'e_a');
  assert.deepEqual(aLines.map((l) => [l.target_kind, l.share_bp, l.basis, l.correction_ref]), [['project', 8000, 'correction', corr.id], ['sector', 2000, 'correction', corr.id]]);
  assert.deepEqual(s2.lines.filter((l) => l.employee_id !== 'e_a'), s1.lines.filter((l) => l.employee_id !== 'e_a'), 'أسطر بقية الموارد نُسخت كما هي');
  assert.equal(s2.supersedes_id, periodId);
  assert.equal(s2.corrections.length, 1);
  const linesV2 = (await db.get('SELECT COUNT(*) AS n FROM cost_share WHERE period_id = ? AND deleted_at IS NULL', [v2Id])).n;
  assert.equal(linesV2, linesBefore, 'صفوف الإصدار الجديد بعدد صفوف السابق');
  const corrRow = await db.get('SELECT status, decided_by, result_period_id FROM cost_correction WHERE id = ?', [corr.id]);
  assert.deepEqual({ ...corrRow }, { status: 'approved', decided_by: 'u_ceo', result_period_id: v2Id });

  // النظرة تعرض الأحدث، والتصدير من الإصدار 2 يحمل مرجع التصحيح
  const view = await C.periodOverview(await sess('u_ceo'), { sector: 'SOL', period: KEY });
  assert.equal(view.period.id, v2Id);
  assert.equal(view.period.version, 2);
  assert.deepEqual(view.versions.map((v) => [v.version, v.status]), [[1, 'superseded'], [2, 'locked']]);
  assert.equal(lineOf(rowOf(view, 'e_a'), 'project', 'P_FIN').shareBp, 8000);
  const out = await C.exportPeriod(await sess('u_ceo'), v2Id);
  assert.equal(out.filename, `cost-close-SOL-${KEY}-v2.csv`);
  const rows = parseCsv(out.csv);
  assert.ok(rows.filter((r) => r.resource_id === 'e_a').every((r) => r.correction_ref === corr.id && r.lock_version === '2' && r.basis === 'correction'));
  // والإصدار السابق يبقى قابلاً للتصدير للتتبع
  assert.equal((await C.exportPeriod(await sess('u_ceo'), periodId)).version, 1);
  assert.ok((await audits('cost_correction', 'create')).length === 1 && (await audits('cost_correction', 'approve')).length === 1);
  assert.equal((await audits('cost_period', 'lock')).length, 2, 'إقفال الإصدار الجديد مؤثَّر');
});

test('T34 — تصحيح مبني على إصدار لم يعد الأحدث ⇒ تعارض إصدار، ولا طلب جديد على إصدار سابق', async () => {
  const ceo = await ctxOf('u_ceo');
  // طلبان على الإصدار 2 لموردين مختلفين
  const c1 = await C.createCorrection(await ctxOf('u_dm2'), v2Id, 'e_b', {
    proposed: [{ target_kind: 'project', target_id: 'P_DONE', shareBp: 10000 }], reason: 'كل الشهر على المشروع المنجَز',
  });
  const c2 = await C.createCorrection(await ctxOf('u_lead'), v2Id, 'e_half', {
    proposed: [{ target_kind: 'project', target_id: 'P_FIN', shareBp: 5000 }, { target_kind: 'sector', shareBp: 5000 }], reason: 'نصف الشهر تطوير أعمال',
  });
  const r1 = await C.decideCorrection(ceo, c1.id, 'approve');
  assert.equal(r1.period.version, 3);
  await assert.rejects(async () => C.decideCorrection(ceo, c2.id, 'approve'), (e) => {
    assert.equal(e.status, 409);
    assert.match(e.message, /لم يعد الأحدث/);
    assert.match(e.message, /الإصدار 3/);
    return true;
  });
  assert.equal((await db.get('SELECT status FROM cost_correction WHERE id = ?', [c2.id])).status, 'pending', 'الطلب يبقى معلقاً لا يُفقد');
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM cost_period WHERE sector_id = ? AND year = ? AND month = ?', ['SOL', YEAR, MONTH])).n, 3);
  // ولا يُنشأ طلب على إصدار سابق
  await assert.rejects(async () => C.createCorrection(await ctxOf('u_lead'), v2Id, 'e_half', { proposed: [{ target_kind: 'sector', shareBp: 10000 }], reason: 'قديم' }), (e) => {
    assert.equal(e.status, 409); assert.match(e.message, /لم يعد الأحدث/); return true;
  });
  // الرفض بسبب يُحفظ
  const rejected = await C.decideCorrection(ceo, c2.id, 'reject', 'أعد الطلب على الإصدار 3');
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.decision_note, 'أعد الطلب على الإصدار 3');
  assert.equal((await audits('cost_correction', 'reject')).length, 1);
  // قائمة التصحيحات في النظرة الأحدث فارغة، وفي الإصدار 2 تحمل الاثنين
  const v3 = await C.periodOverview(ceo.user, { sector: 'SOL', period: KEY });
  assert.equal(v3.period.version, 3);
  assert.equal(v3.corrections.length, 0);
  assert.equal((await C.listCorrections(ceo.user, v2Id)).length, 2);
});

test('إعادة التوليد الصريحة تحترم المؤكد إلا بطلب صريح، وتُخرج من صار خارج الارتباط', async () => {
  // شهر آخر (أيار) لقطاع الحلول — مسودة جديدة
  const lead = await ctxOf('u_lead');
  const may = await C.periodOverview(lead.user, { year: YEAR, month: 5 });
  assert.equal(may.period.status, 'draft');
  assert.ok(rowOf(may, 'e_gone').reviewStatus !== 'excluded', 'المغادر في 20 أيار كان مرتبطاً جزءاً من أيار');
  await C.confirmShares(lead, may.period.id, 'e_a', { lines: [{ target_kind: 'sector', shareBp: 10000 }], reason: 'كله داخلي في أيار' });
  const kept = await C.generateDraft(lead, may.period.id, { preserveConfirmed: true });
  assert.equal(lineOf(rowOf(kept, 'e_a'), 'sector', 'SOL').shareBp, 10000);
  assert.equal(rowOf(kept, 'e_a').reviewStatus, 'confirmed', 'المؤكد لم يُمسّ');
  // مورد صار خارج الارتباط بعد التوليد: أسطره تُزال ويُستبعد بسبب
  await db.update('employee', 'e_self', { end_date: '2026-04-30' });
  const full = await C.generateDraft(lead, may.period.id, { preserveConfirmed: false });
  assert.equal(rowOf(full, 'e_a').reviewStatus, 'draft', 'إعادة التوليد الكاملة تعيد الحساب من التسكين');
  assert.equal(rowOf(full, 'e_self').reviewStatus, 'excluded');
  assert.equal(full.period.status, 'draft', 'لم يبقَ مؤكد ⇒ الشهر مسودة');
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM cost_share WHERE period_id = ? AND employee_id = ? AND deleted_at IS NULL', [may.period.id, 'e_self'])).n, 0);
  await db.update('employee', 'e_self', { end_date: null });
  // شهر لم يبدأ بعد لا يُفتح
  await assert.rejects(async () => C.periodOverview(lead.user, { year: 2099, month: 1 }), /لم يبدأ/);
});

// ── الموجّه على تطبيق حقيقي: المسارات كما في UI-CONTRACTS §4، والملف نصّ CSV مع علامة الترتيب ──
test('الموجّه: النظرة والتصدير والرفض تمرّ بالمسارات المتعاقَد عليها وبغلاف الخطأ الموحّد', async () => {
  const express = (await import('express')).default;
  const { errorHandler } = await import('../../src/core/http/errors.js');
  const { teamCloseRouter } = await import('../../src/modules/team/team-close.routes.js');
  let CURRENT = await sess('u_ceo');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.ctx = { user: CURRENT, ip: '127.0.0.1' }; next(); });
  app.use('/api', teamCloseRouter);
  app.use(errorHandler());
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ov = await fetch(`${base}/api/team/close?sector=SOL&year=${YEAR}&month=${MONTH}`);
    assert.equal(ov.status, 200);
    const view = await ov.json();
    assert.equal(view.period.version, 3);
    assert.equal(view.period.status, 'locked');
    assert.equal(view.transfer.status_ar, 'لم يتم');

    const rs = await fetch(`${base}/api/team/close/${view.period.id}/resources/e_a`);
    assert.equal(rs.status, 200);
    assert.equal((await rs.json()).totalBp, 10000);

    const ex = await fetch(`${base}/api/team/close/${view.period.id}/export`);
    assert.equal(ex.status, 200);
    assert.equal(ex.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(ex.headers.get('content-disposition'), /attachment; filename="cost-close-SOL-2026-06-v3\.csv"/);
    assert.equal(ex.headers.get('cache-control'), 'private, no-store');
    // البايتات الخام: `text()` يحذف علامة الترتيب بحكم المعيار، والفحص هنا على ما يصل Excel فعلاً.
    const bytes = Buffer.from(await ex.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'الملف يبدأ بعلامة ترتيب البايتات كي تُقرأ العربية في Excel');
    const text = bytes.subarray(3).toString('utf8');
    assert.ok(text.startsWith('resource_id,month,sector,'));
    assert.equal(parseCsv(text).length, JSON.parse((await db.get('SELECT locked_snapshot_json FROM cost_period WHERE id = ?', [view.period.id])).locked_snapshot_json).lines.length);

    // مدير إدارة يطلب الإقفال ⇒ ٤٠٣ بغلاف الخطأ الموحّد ورسالة عربية
    CURRENT = await sess('u_dm');
    const lock = await fetch(`${base}/api/team/close/${view.period.id}/lock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 3 }) });
    assert.equal(lock.status, 403);
    const err = await lock.json();
    assert.equal(err.error.code, 'forbidden');
    assert.match(err.error.message, /مكتب الرئيس التنفيذي/);
    const exp = await fetch(`${base}/api/team/close/${view.period.id}/export`);
    assert.equal(exp.status, 403);

    // قرار بلا فعل صحيح ⇒ ٤٠٠ عربي؛ وطلب تصحيح بالمسار المتعاقَد عليه على إصدار مقفل
    CURRENT = await sess('u_ceo');
    const bad = await fetch(`${base}/api/team/close/corrections/nope/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'maybe' }) });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error.message, /اعتماد أو رفض/);
    const corr = await fetch(`${base}/api/team/close/${view.period.id}/resources/e_self/correction`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposed: [{ target_kind: 'project', target_id: 'P_FIN', shareBp: 2500 }, { target_kind: 'sector', shareBp: 7500 }], reason: 'ربع الشهر على المنصة' }) });
    assert.equal(corr.status, 200);
    const c = await corr.json();
    assert.equal(c.status, 'pending');
    assert.equal(c.previous_version, 3);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
