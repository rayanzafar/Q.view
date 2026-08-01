// الطاقة الاستيعابية · فترات التسكين · المراحل · وثائق المشروع.
//
// أربعة أعطال كان المنتج يقع فيها ويحرسها هذا الملف:
//   ١) نسب التسكين تُقارن بمئة ثابتة في الكود، فنصفُ المتفرّغ يبدو محمَّلاً ٥٠٪ وهو مكتمل.
//   ٢) «مجموع تسكينه» و«نسبته على هذا المشروع» رقمان مختلفان، وعرضُ الثاني وحده يجعل مديراً
//      يضيف على شخصٍ بلغ مئةً وأربعين في مكانٍ لا يراه.
//   ٣) الشخص يُقرأ محمَّلاً طوال مدة المشروع بينما تسكينه شهران — فتُحجب أشهر متاحة بلا سبب.
//   ٤) جدول المستندات يحمل عمود المشروع منذ الموجة الثانية ولا يكتبه مسار واحد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-cap-'));
process.env.SANAD_DB = join(dir, 'c.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const db = await import('../../src/core/db/index.js');
const rbac = await import('../../src/core/rbac/index.js');
const cap = await import('../../src/modules/pmo/capacity.js');
const gov = await import('../../src/modules/pmo/governance.js');
const projects = await import('../../src/modules/pmo/projects.js');

const TS = '2026-07-01T00:00:00Z';
const YEAR = 2026;
const U = (id, role, sector, scope) => ({ id, username: id, role_id: role, sector_id: sector, scope,
  projectIds: new Set(['CP1']), teamIds: new Set() });
const lead = U('c_lead', 'sector_lead', 'S1', 'sector');
const outsider = U('c_out', 'sector_lead', 'S2', 'sector');
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });

before(async () => {
  await rbac.initRbac();
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع الاختبار', kind: 'delivery', active: 1, created_at: TS });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع آخر', kind: 'delivery', active: 1, created_at: TS });
  for (const u of [lead, outsider]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.username, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, password_hash: 'x', active: 1, created_at: TS });
  }
  await db.insert('project', { id: 'CP1', name_ar: 'مشروع الطاقة', sector_id: 'S1', owner_user_id: 'c_lead',
    status: 'IN_PROGRESS', contract_value_halalas: 1_000_000_00, start_date: '2026-01-01', end_date: '2026-12-31', created_at: TS });
  await db.insert('project', { id: 'CP2', name_ar: 'مشروع مجاور', sector_id: 'S1', status: 'IN_PROGRESS', created_at: TS });
  // متفرّغ كامل · نصف متفرّغ (طاقته ٥٠) · متاح تماماً
  await db.insert('employee', { id: 'EF', name_ar: 'موظف متفرّغ', job_title: 'مستشار', sector_id: 'S1', active: 1, created_at: TS });
  await db.insert('employee', { id: 'EH', name_ar: 'موظف نصف متفرّغ', job_title: 'محلل', sector_id: 'S1', active: 1, capacity_pct: 50, created_at: TS });
  await db.insert('employee', { id: 'EA', name_ar: 'موظف متاح', job_title: 'مساعد', sector_id: 'S1', active: 1, created_at: TS });
  // التسكين: يوليو فقط على المشروع، ويوليو أيضاً على المجاور — فالمجموع يتجاوز والفردي لا.
  await db.insert('allocation', { id: 'AL1', employee_id: 'EF', person_name_ar: 'موظف متفرّغ', project_id: 'CP1',
    sector_id: 'S1', type: 'lead', year: YEAR, monthly_json: JSON.stringify({ 7: 0.8, 8: 0.5 }), source: 'manual', created_at: TS });
  await db.insert('allocation', { id: 'AL2', employee_id: 'EF', person_name_ar: 'موظف متفرّغ', project_id: 'CP2',
    sector_id: 'S1', type: 'member', year: YEAR, monthly_json: JSON.stringify({ 7: 0.6 }), source: 'manual', created_at: TS });
  await db.insert('allocation', { id: 'AL3', employee_id: 'EH', person_name_ar: 'موظف نصف متفرّغ', project_id: 'CP1',
    sector_id: 'S1', type: 'member', year: YEAR, monthly_json: JSON.stringify({ 7: 0.6 }), source: 'manual', created_at: TS });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('الطاقة تُقرأ من الموظف لا من مئة ثابتة — نصف المتفرّغ يتجاوز عند ٦٠٪', async () => {
  const { team } = await cap.projectTeamLoad(lead, 'CP1', { year: YEAR, month: 7 });
  const half = team.find((t) => t.employeeId === 'EH');
  assert.equal(half.capacityPct, 50);
  assert.equal(half.totalPct, 60);
  assert.equal(half.over, true, 'ستون على طاقة خمسين تجاوز — والمقارنة بمئة كانت تخفيه');
  assert.equal(half.overBy, 10, 'ويُقال مقدارُ التجاوز، فالرقم وحده لا يُصرِّح بالمشكلة');
});

test('«على هذا المشروع» و«مجموع تسكينه» رقمان لا واحد — بلا ازدواج حساب', async () => {
  const { team } = await cap.projectTeamLoad(lead, 'CP1', { year: YEAR, month: 7 });
  const full = team.find((t) => t.employeeId === 'EF');
  assert.equal(full.onThisPct, 80, 'نسبته هنا');
  assert.equal(full.otherPct, 60, 'وما عليه في مكانٍ آخر');
  assert.equal(full.totalPct, 140, 'والمجموع — لا 220 ولا 80');
  assert.equal(full.over, true);
  assert.equal(full.overBy, 40);
});

test('فترة التسكين تُقرأ من أشهرها — لا يُعتبر محمَّلاً طوال مدة المشروع', async () => {
  const { team } = await cap.projectTeamLoad(lead, 'CP1', { year: YEAR, month: 7 });
  const full = team.find((t) => t.employeeId === 'EF');
  assert.equal(full.period.from, 7);
  assert.equal(full.period.to, 8, 'المشروع سنة كاملة والتسكين شهران — والفرق هو بيت القصيد');
  assert.match(full.period.label, /يوليو/);
  // وفي شهرٍ خارج الفترة لا حِمل عليه من هذا المشروع أصلاً.
  const dec = await cap.projectTeamLoad(lead, 'CP1', { year: YEAR, month: 12 });
  assert.equal(dec.team.find((t) => t.employeeId === 'EF').onThisPct, 0);
});

test('«من المتاح» مرتَّب بالأقل تحميلاً، ولا يُخفي من تجاوز طاقته', async () => {
  const r = await cap.staffingCandidates(lead, 'CP1', { year: YEAR, month: 7 });
  const ids = r.candidates.map((c) => c.id);
  assert.ok(!ids.includes('EF') && !ids.includes('EH'), 'المُسكَّن على المشروع ليس مرشَّحاً له');
  assert.equal(ids[0], 'EA', 'المتاح تماماً أولاً');
  assert.equal(r.candidates[0].assignedPct, 0);
  assert.equal(r.candidates[0].remainingPct, 100);
});

test('حارس النطاق: من هو خارج المشروع لا يقرأ طاقته ولا مرشَّحيه', async () => {
  for (const fn of [cap.projectTeamLoad, cap.staffingCandidates]) {
    await assert.rejects(() => fn(outsider, 'CP1', { year: YEAR }), (e) => e.code === 'forbidden' || e.code === 'not_found');
  }
});

test('المرحلة كيانٌ له تواريخه — وتُجمع تحتها المخرجات والمعالم', async () => {
  const ph = await gov.createItem(ctx(lead), 'CP1', 'phase', { name_ar: 'التشخيص', start_date: '2026-01-01', end_date: '2026-06-30' });
  assert.equal(ph.name_ar, 'التشخيص');
  assert.equal(ph.status, 'NOT_STARTED');
  const d = await gov.createItem(ctx(lead), 'CP1', 'deliverable', { name_ar: 'تقرير', phase_id: ph.id });
  const m = await gov.createItem(ctx(lead), 'CP1', 'milestone', { name_ar: 'اعتماد التقرير', due_date: '2026-06-15', phase_id: ph.id });
  assert.equal(d.phase_id, ph.id);
  assert.equal(m.phase_id, ph.id);
  const payload = await gov.projectGovernance(lead, 'CP1');
  assert.ok(payload.phases.some((x) => x.id === ph.id), 'المراحل ضمن حمولة الصفحة لا استعلام موازٍ');
  const done = await gov.updateItem(ctx(lead), 'phase', ph.id, { status: 'DONE' });
  assert.equal(done.status, 'DONE');
});

test('نهاية المرحلة قبل بدايتها تُردّ برسالة يفهمها المستخدم', async () => {
  await assert.rejects(() => gov.createItem(ctx(lead), 'CP1', 'phase',
    { name_ar: 'مرحلة مقلوبة', start_date: '2026-09-01', end_date: '2026-03-01' }), /قبل بدايتها/);
});

test('وثائق المشروع: تُكتب وتُقرأ وتُحذف — والعمود كان معطَّلاً منذ إنشائه', async () => {
  const doc = await projects.addProjectDocument(ctx(lead), 'CP1', { name: 'نطاق العمل', kind: 'contract', url: 'https://example.com/s.pdf' });
  assert.equal(doc.project_id, 'CP1');
  const list = await projects.projectDocuments(lead, 'CP1');
  assert.equal(list.documents.length, 1);
  assert.equal(list.canEdit, true);
  await assert.rejects(() => projects.addProjectDocument(ctx(lead), 'CP1', { name: 'رابط خطر', url: 'javascript:alert(1)' }),
    /يبدأ بـ/, 'الرابط غير الآمن مردود — الصفحة يفتحها كل الفريق');
  await assert.rejects(() => projects.addProjectDocument(ctx(outsider), 'CP1', { name: 'دسّ' }),
    (e) => e.code === 'forbidden' || e.code === 'not_found');
  await projects.deleteProjectDocument(ctx(lead), doc.id);
  assert.equal((await projects.projectDocuments(lead, 'CP1')).documents.length, 0);
});

test('آخر التحديثات: عربيةٌ مقروءة، ولا تُطبع بنية مُرمَّزة في وجه القارئ', async () => {
  const ups = await projects.projectUpdates(lead, 'CP1', 20);
  assert.ok(ups.length, 'كل كتابة تركت أثراً');
  for (const u of ups) {
    assert.ok(!/[{}[\]]/.test(u.detail || ''), 'لا أقواس ولا بنية خام');
    assert.ok(!/undefined|null/.test(`${u.action}${u.resource}${u.detail}`), 'ولا قيمة تقنية');
  }
  assert.ok(ups.some((u) => u.resource), 'والمورد مسمّى بالعربية');
});

test('المهمة تُربط بمخرَجها — ومخرَج مشروعٍ آخر مردود', async () => {
  const tasks = await import('../../src/modules/pmo/tasks.js');
  const mine = await gov.createItem(ctx(lead), 'CP1', 'deliverable', { name_ar: 'مخرَج للمهمة' });
  const other = await gov.createItem(ctx(lead), 'CP2', 'deliverable', { name_ar: 'مخرَج جار' });
  const t = await tasks.quickAddTask(ctx(lead), { title: 'مهمة مرتبطة', project_id: 'CP1', deliverable_id: mine.id });
  assert.equal(t.deliverable_id, mine.id);
  await assert.rejects(() => tasks.quickAddTask(ctx(lead), { title: 'مهمة مغلوطة', project_id: 'CP1', deliverable_id: other.id }),
    /من مشروع آخر/, 'الربط عبر المشاريع يُفسد كل تجميع لاحق بصمت');
});
