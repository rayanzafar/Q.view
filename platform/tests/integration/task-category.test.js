// تصنيف المهمة (الترحيلة ٠٢٩): وسمٌ وصفي مستقل عن نوع العمل — يُخزَّن من القائمة الجاهزة
// بمفتاحه، ومن الحقل الحر كما كُتب، ويُقصّ عند ستين حرفاً، والفراغ لا تصنيف.
// القاعدة واحدة في مسارَي الإنشاء والتعديل — فلا يختلف المخزَّن باختلاف الباب الذي دخل منه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-taskcat-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, tasks;
const T = new Date().toISOString();
const EMP = { id: 'u_emp', username: 'emp', name_ar: 'موظف', role_id: 'employee', scope: 'own', sector_id: 'SOL' };
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  tasks = await import('../../src/modules/pmo/tasks.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_emp', username: 'emp', role_id: 'employee', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('الإضافة السريعة تخزّن مفتاح التصنيف الجاهز كما هو', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'اجتماع المتابعة الأسبوعي', category: 'meeting_internal' });
  assert.equal(t.category, 'meeting_internal');
});

test('وبلا تصنيف — أو بفراغٍ أو بمسافات — يبقى العمود فارغاً لا نصاً فارغاً', async () => {
  const a = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة بلا تصنيف' });
  assert.equal(a.category, null);
  const b = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة بتصنيف فارغ', category: '' });
  assert.equal(b.category, null);
  const c = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة بمسافات', category: '   ' });
  assert.equal(c.category, null);
});

test('التصنيف الحر يُخزَّن كما كُتب — مقصوصَ الأطراف', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'زيارة ميدانية', category: '  زيارة ميدانية  ' });
  assert.equal(t.category, 'زيارة ميدانية');
});

test('والطويل يُقصّ عند ستين حرفاً — الوسم وسم لا فقرة', async () => {
  const long = 'م'.repeat(90);
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة بوسم طويل', category: long });
  assert.equal(t.category.length, 60);
  assert.equal(t.category, 'م'.repeat(60));
});

test('التعديل يقبل التصنيف بنفس القاعدة: كتابةً ومسحاً وقصاً', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة تتغيّر' });
  const w = await tasks.updateTask(ctx(EMP), t.id, { category: 'report' });
  assert.equal(w.category, 'report');
  const free = await tasks.updateTask(ctx(EMP), t.id, { category: '  ورشة عمل  ' });
  assert.equal(free.category, 'ورشة عمل');
  const capped = await tasks.updateTask(ctx(EMP), t.id, { category: 'ت'.repeat(80) });
  assert.equal(capped.category.length, 60);
  const cleared = await tasks.updateTask(ctx(EMP), t.id, { category: '' });
  assert.equal(cleared.category, null, 'مسحُ التصنيف يعيد الفراغ لا نصاً فارغاً');
});

test('وتعديلٌ لا يذكر التصنيف لا يمسّه', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة موسومة', category: 'followup' });
  const w = await tasks.updateTask(ctx(EMP), t.id, { title: 'مهمة موسومة — عنوان جديد' });
  assert.equal(w.category, 'followup', 'ضاع التصنيف في تعديلٍ لم يذكره');
});
