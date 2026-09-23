// نقل الموظفين — الحدود التي يجب ألّا يعبرها النقل السهل.
//
// جعل النقل سهلاً يرفع كلفة أي ثغرة فيه: ما كان يتطلّب فتح نافذة لكل موظف صار دفعةً بنقرة.
// ولذلك يُثبَّت هنا ما وجدتُه مفتوحاً وأُغلق، وما كان مغلقاً ويجب أن يبقى:
//
//   ١) **القطاع الهدف كان بلا بوابة**: moveEmployee (وهو مسار مركَّب على
//      PATCH /api/org/employees/:id/move) كان يفحص قطاع الموظف الحالي وحده. فمن يملك «تعديل
//      موظف» بنطاق قطاعه كان يستطيع **دفع** أحد أهله إلى أي قطاع آخر: يظهر في كشف ذلك القطاع
//      وطاقته وتسكينه بلا قرارٍ من أحدٍ هناك. (الاتجاه المعاكس كان مغلقاً — فثغرةُ دفعٍ باتجاه
//      واحد، وهي ثغرة.) الشرط الآن نفسه المطبَّق في updateEmployee.
//   ٢) **إدارةٌ من قطاعٍ آخر**: لم يكن شيء يمنع «قطاع أ + إدارة تحت ب» — سجلٌّ يناقض نفسه
//      تعدّه شجرة الهيكل هنا وكشفُ القطاع هناك، فيختلف الرقمان ولا يُعرف الصحيح.
//   ٣) الدفعة لا تفتح باباً: كل موظف فيها يمرّ بالفحص نفسه، وسقوط واحد يُسقط الدفعة كلها
//      (معاملة واحدة) — فلا تبقى إدارةٌ منقولةً نصفها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-move-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { insert, get, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { moveEmployee, moveEmployees } = await import('../../src/modules/org/org.js');

const T = '2026-01-01T00:00:00Z';
const ctxOf = (u) => ({ user: u, ip: '127.0.0.1' });
const admin = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: null, projectIds: new Set(), teamIds: new Set() };
// قائد قطاع «أ» — منحه «تعديل موظف» بنطاق قطاعه وحده
const leadA = { id: 'u_lead_a', username: 'lead_a', role_id: 'sector_lead', scope: 'sector', sector_id: 'SA', projectIds: new Set(), teamIds: new Set() };

before(async () => {
  await insert('sector', { id: 'SA', name_ar: 'قطاع أ', active: 1, created_at: T });
  await insert('sector', { id: 'SB', name_ar: 'قطاع ب', active: 1, created_at: T });
  await insert('department', { id: 'DA1', sector_id: 'SA', name_ar: 'إدارة أ-١', active: 1, created_at: T });
  await insert('department', { id: 'DA2', sector_id: 'SA', name_ar: 'إدارة أ-٢', active: 1, created_at: T });
  await insert('department', { id: 'DB1', sector_id: 'SB', name_ar: 'إدارة ب-١', active: 1, created_at: T });
  for (const [id, name, sec, dep] of [
    ['e1', 'موظف أول', 'SA', 'DA1'], ['e2', 'موظف ثانٍ', 'SA', 'DA1'],
    ['e3', 'موظف ثالث', 'SA', null], ['e4', 'موظف رابع', 'SB', 'DB1'],
  ]) await insert('employee', { id, name_ar: name, sector_id: sec, department_id: dep, active: 1, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('قائد قطاع لا يدفع أحداً إلى قطاعٍ لا يملكه — بوابة القطاع الهدف', async () => {
  await assert.rejects(() => moveEmployee(ctxOf(leadA), 'e1', { sector_id: 'SB', department_id: 'DB1' }),
    (e) => { assert.match(e.message, /القطاع الهدف/); return true; });
  const after1 = await get('SELECT sector_id, department_id FROM employee WHERE id = ?', ['e1']);
  assert.equal(after1.sector_id, 'SA', 'بقي في قطاعه');
  assert.equal(after1.department_id, 'DA1', 'ولم تتغيّر إدارته');
});

test('ولا يسحب أحداً من قطاعٍ لا يملكه — الاتجاه المعاكس يبقى مغلقاً', async () => {
  await assert.rejects(() => moveEmployee(ctxOf(leadA), 'e4', { sector_id: 'SA', department_id: 'DA1' }));
  const after4 = await get('SELECT sector_id FROM employee WHERE id = ?', ['e4']);
  assert.equal(after4.sector_id, 'SB');
});

test('النقل داخل القطاع نفسه يعمل — الحدّ ليس على الحركة بل على العبور', async () => {
  await moveEmployee(ctxOf(leadA), 'e1', { sector_id: 'SA', department_id: 'DA2' });
  const r = await get('SELECT department_id FROM employee WHERE id = ?', ['e1']);
  assert.equal(r.department_id, 'DA2');
});

test('إدارةٌ من قطاعٍ آخر تُرفض — لا سجلَّ يناقض نفسه', async () => {
  await assert.rejects(() => moveEmployee(ctxOf(admin), 'e2', { sector_id: 'SA', department_id: 'DB1' }),
    (e) => { assert.match(e.message, /ليست تحت القطاع المختار/); return true; });
  // وكذلك حين يُغيَّر القطاع وحده فوق إدارةٍ قديمة — الطلب لا يذكر إدارةً والتناقض يقع مع ذلك
  await assert.rejects(() => moveEmployee(ctxOf(admin), 'e2', { sector_id: 'SB' }),
    (e) => { assert.match(e.message, /ليست تحت القطاع المختار/); return true; });
});

test('النقل إلى قطاع بلا إدارة خيارٌ مقصود لا قيمة غائبة', async () => {
  await moveEmployee(ctxOf(admin), 'e2', { sector_id: 'SB', department_id: null });
  const r = await get('SELECT sector_id, department_id FROM employee WHERE id = ?', ['e2']);
  assert.equal(r.sector_id, 'SB');
  assert.equal(r.department_id, null);
});

test('الدفعة تنقل الجميع، وسقوط واحد يُسقطها كلها بلا نقلٍ نصفيّ', async () => {
  const r = await moveEmployees(ctxOf(admin), { employeeIds: ['e1', 'e3'], sector_id: 'SA', department_id: 'DA1' });
  assert.equal(r.moved, 2);
  for (const id of ['e1', 'e3']) {
    const row = await get('SELECT department_id FROM employee WHERE id = ?', [id]);
    assert.equal(row.department_id, 'DA1');
  }
  // «e4» في قطاع ب: الدفعة كلها تسقط، ولا يتحرّك e1 الذي كان سينجح لولا رفيقه
  await assert.rejects(() => moveEmployees(ctxOf(leadA), { employeeIds: ['e1', 'e4'], sector_id: 'SA', department_id: 'DA2' }));
  const e1 = await get('SELECT department_id FROM employee WHERE id = ?', ['e1']);
  assert.equal(e1.department_id, 'DA1', 'لم يتحرّك — الدفعة ذرّية');
});

test('الدفعة الفارغة والدفعة بلا وجهة تُردّان برسالة عربية واضحة', async () => {
  await assert.rejects(() => moveEmployees(ctxOf(admin), { employeeIds: [] }),
    (e) => { assert.match(e.message, /اختر موظفاً واحداً/); return true; });
  await assert.rejects(() => moveEmployees(ctxOf(admin), { employeeIds: ['e1'] }),
    (e) => { assert.match(e.message, /حدّد القطاع أو الإدارة/); return true; });
});
