// ── البحث العربي المتسامح على الأبواب الحقيقية: البحث الشامل وسجل الموارد ───────────────────
// ما لا يفرّقه القارئ لا يفرّقه البحث: همزةٌ أو تاءٌ مربوطة أو ألفٌ مقصورة أو رقمٌ هندي، والكلمات
// بأي ترتيب، وخطأٌ واحد في الكلمة الطويلة — والأدقّ يتقدّم. والقصير لا يُقارَب: «سلام» ليس «سالم».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-search-ar-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { insert, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { globalSearch } = await import('../../src/modules/search/search.js');
const { listResources } = await import('../../src/modules/team/resources.js');

const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', projectIds: new Set(), teamIds: new Set() };

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  await insert('app_user', { id: ADMIN.id, username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await insert('client', { id: 'C1', name_ar: 'مؤسسة الحوكمة الرقمية', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, is_won: 0, is_lost: 0, sort_order: 1, created_at: T });
  await insert('opportunity', { id: 'O1', title_ar: 'تفعيل حوكمة الذكاء الاصطناعي', client_id: 'C1', sector_id: 'SOL', owner_user_id: ADMIN.id,
    stage_id: 'LEAD', win_pct: 10, value_halalas: 100000, year: 2026, tender_no: 'T-4548', stage_changed_at: T, created_at: T, created_by: ADMIN.id });
  await insert('opportunity', { id: 'O2', title_ar: 'منصة خدمات الزوار', client_id: 'C1', sector_id: 'SOL', owner_user_id: ADMIN.id,
    stage_id: 'LEAD', win_pct: 10, value_halalas: 100000, year: 2026, stage_changed_at: T, created_at: T, created_by: ADMIN.id });
  const emp = (id, name_ar, job_title) => insert('employee', { id, name_ar, job_title, sector_id: 'SOL', active: 1, status: 'نشط', created_at: T });
  await emp('E1', 'أحمد الشهري', 'محلل بيانات');
  await emp('E2', 'سالم العمري', 'مدير مشاريع');
  await emp('E3', 'أحمد الشهري الثاني', 'مستشار');
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('البحث الشامل: الهمزة والألف المقصورة والرقم الهندي لا تخفي سجلاً، والتامّ يتقدّم', async () => {
  const byName = await globalSearch(ADMIN, 'احمد الشهرى');
  const emps = byName.filter((h) => h.category === 'employee').map((h) => h.id);
  assert.deepEqual(emps, ['E1', 'E3'], 'المطابقة التامة تتقدّم على البادئة');
  const fuzzy = await globalSearch(ADMIN, 'الحوكه');
  assert.ok(fuzzy.some((h) => h.category === 'opportunity' && h.id === 'O1'), 'خطأ واحد في كلمة طويلة أخفى الفرصة');
  assert.ok(fuzzy.some((h) => h.category === 'client' && h.id === 'C1'), 'الجهة لم تُلتقط بالمطابقة نفسها');
  assert.ok(!fuzzy.some((h) => h.id === 'O2'), 'فرصةٌ لا علاقة لها ظهرت');
  for (const q of ['4548', '٤٥٤٨', 'T-4548']) {
    const r = await globalSearch(ADMIN, q);
    assert.ok(r.some((h) => h.category === 'opportunity' && h.id === 'O1'), `رقم المنافسة «${q}» لا يُبحث به`);
  }
  const anyOrder = await globalSearch(ADMIN, 'الذكاء حوكمة');
  assert.ok(anyOrder.some((h) => h.id === 'O1'), 'ترتيب الكلمات أخفى الفرصة');
});

test('سجل الموارد: الاسم والمسمّى بالتطبيع نفسه، والعدّاد من المطابق فعلاً، والقصير لا يُقارَب', async () => {
  const a = await listResources(ADMIN, { q: 'احمد' });
  assert.deepEqual(a.rows.map((r) => r.id), ['E1', 'E3']); assert.equal(a.total, 2);
  const b = await listResources(ADMIN, { q: 'بيانات' });
  assert.deepEqual(b.rows.map((r) => r.id), ['E1'], 'المسمّى لا يُبحث فيه');
  const c = await listResources(ADMIN, { q: 'الشهرى' });
  assert.deepEqual(c.rows.map((r) => r.id), ['E1', 'E3']);
  const d = await listResources(ADMIN, { q: 'سلام' });
  assert.equal(d.total, 0, '«سلام» طابق «سالم» — كلمة قصيرة قُوربت');
  const paged = await listResources(ADMIN, { q: 'احمد', page: 2, pageSize: 1 });
  assert.deepEqual(paged.rows.map((r) => r.id), ['E3']); assert.equal(paged.total, 2, 'الترقيم فقد العدّاد');
  const none = await listResources(ADMIN, { q: '   ' });
  assert.equal(none.total, 3, 'فراغٌ عُدّ بحثاً');
});
