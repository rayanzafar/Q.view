// نوع العمل الداخلي (الترحيلة ٠٢٩): مهمةٌ بلا مشروع ولا فرصة عملٌ داخلي — لا «مشروع» بلا مشروع.
//
// العطل المسدود هنا وجهان:
//   ① الخدمة: طلبٌ لا يسمّي نوعه ولا جهةَ له كان يُكتب بالقيمة الافتراضية «مشروع» — وهي
//      حال كل إضافة سريعة قديمة من الشريط ومن صفحة الشخص.
//   ② المكتوب سلفاً: الترحيلة تصحّح الصفوف الكاذبة القائمة — «مشروعٌ» بلا مشروعٍ ولا فرصة
//      يصير «داخلياً» — ولا تمسّ الشخصية ولا مهمة المشروع الحقيقية.
// الوجه الثاني يُفحص على قاعدةٍ بمخطط ما قبل الترحيلة تُملأ ثم تُرحَّل — كما يقع على الخادم.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-m29-'));
process.env.SANAD_DB = join(dir, 'm.db');
const ROOT = new URL('../..', import.meta.url).pathname;
const MIG = resolve(ROOT, 'migrations');
const db = await import('../../src/core/db/index.js');
const T = '2026-07-01T00:00:00Z';
let tasks;
// `projectIds` كما يبنيها سياق الطلب لمن سُكِّن على المشروع — فرابط المشروع في الفحص الأخير
// يمرّ عبر بوابة «ما يصل إليه صاحب الطلب» الحقيقية لا حول أي حارس.
const EMP = { id: 'u_emp', username: 'emp', role_id: 'employee', scope: 'own', sector_id: 'SOL',
  projectIds: new Set(['PRJ']) };
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });

before(async () => {
  // ١) المخطط حتى ٠٢٨ فقط — الحال الذي تجده الترحيلة على الخادم.
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().filter((f) => f < '029');
  for (const f of files) {
    await db.exec(readFileSync(join(MIG, f), 'utf8'));
    await db.run('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)', [f, T]);
  }
  // الأدوار قبل الحسابات — حساب المستخدم يشير إلى دوره، والقيد الأجنبي يرفض حساباً بدور لم يُزرع.
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_emp', username: 'emp', role_id: 'employee', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('project', { id: 'PRJ', name_ar: 'منصة تحليلات', sector_id: 'SOL', status: 'IN_PROGRESS', created_at: T });

  // ٢) الحالات الثلاث كما هي مخزَّنة اليوم:
  // الصف الكاذب — إضافة سريعة قديمة: «مشروع» بلا مشروع ولا فرصة.
  await db.insert('task', { id: 'tsk_bad', title: 'ترتيب الملفات', work_kind: 'project',
    sector_id: 'SOL', assignee_user_id: 'u_emp', status: 'TODO', created_at: T, created_by: 'u_emp' });
  // الشخصية — نوعها صادق ولا تُمسّ.
  await db.insert('task', { id: 'tsk_personal', title: 'موعد شخصي', work_kind: 'personal',
    assignee_user_id: 'u_emp', status: 'TODO', created_at: T, created_by: 'u_emp' });
  // ومهمة المشروع الحقيقية — جهتها قائمة ولا تُمسّ.
  await db.insert('task', { id: 'tsk_real', title: 'إعداد خطة الاختبار', work_kind: 'project', project_id: 'PRJ',
    sector_id: 'SOL', assignee_user_id: 'u_emp', status: 'TODO', created_at: T, created_by: 'u_emp' });

  // ٣) الترحيلة تُشغَّل كما تُشغَّل على الخادم — بالسكربت نفسه لا بتنفيذ يدوي.
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  tasks = await import('../../src/modules/pmo/tasks.js');
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const row = (id) => db.get('SELECT * FROM task WHERE id = ?', [id]);

test('الترحيلة صحّحت الصف الكاذب: «مشروعٌ» بلا جهةٍ صار «داخلياً»', async () => {
  assert.equal((await row('tsk_bad')).work_kind, 'internal');
});

test('ولم تمسّ الشخصية ولا مهمة المشروع الحقيقية', async () => {
  assert.equal((await row('tsk_personal')).work_kind, 'personal', 'قلبت الترحيلة دفتر صاحبها عملاً للشركة');
  assert.equal((await row('tsk_real')).work_kind, 'project', 'أفسدت الترحيلة نوع مهمةٍ جهتُها قائمة');
});

test('ولا صفَّ كاذباً باقياً في الجدول كله', async () => {
  const stale = await db.all(`SELECT id FROM task
     WHERE work_kind = 'project' AND project_id IS NULL AND opportunity_id IS NULL`);
  assert.equal(stale.length, 0);
});

test('الإضافة السريعة بلا جهة تكتب «داخلياً» من اليوم — لا يتجدّد ما صحّحته الترحيلة', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مراجعة البريد' });
  assert.equal(t.work_kind, 'internal', 'عاد الافتراضي الأعمى «مشروع» على مهمةٍ بلا مشروع');
  assert.equal(t.project_id, null);
  assert.equal(t.opportunity_id, null);
});

test('والجهة الصريحة تبقى سيدة القرار: مشروعٌ مشروع، وشخصيةٌ شخصية', async () => {
  const p = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة على مشروع', project_id: 'PRJ' });
  assert.equal(p.work_kind, 'project');
  const me = await tasks.quickAddTask(ctx(EMP), { title: 'مذكرة خاصة', work_kind: 'personal' });
  assert.equal(me.work_kind, 'personal');
});
