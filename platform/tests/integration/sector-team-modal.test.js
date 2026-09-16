// نافذة الفريق على مركز القيادة (v5.37) — القطاع ← إداراته القائمة ← أفرادها ← نافذة الشخص،
// وفئات العدّاد تُفتح، والطيف يرسم الجميع حتى ستين ثم «+N آخرون»، وعتبات الإشغال من مصدرها
// الواحد (v5.38)، وخليتا «تغطية خط الفرص» و«متوقفة تحتاج متابعة» تفتحان تفصيلهما في الصفحة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-teammodal-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, run, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
const { sectorPage } = await import('../../src/web/views/sector.js');
const { UTIL_BANDS } = await import('../../src/modules/pmo/capacity.js');

const T = '2026-01-05T00:00:00Z';
const YEAR = new Date().getUTCFullYear();
const U = (id, role, scope) => ({ id, username: id, name_ar: 'مستخدم ' + id, role_id: role, sector_id: 'SOLUTIONS', scope, projectIds: new Set(), teamIds: new Set() });
const lead = U('u_lead', 'sector_lead', 'sector');
const analyst = U('u_an', 'sector_analyst', 'sector');
const allMonths = (f) => JSON.stringify(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, f])));
const N_EMPS = 65;

before(async () => {
  await insert('role', { id: 'sector_analyst', name_ar: 'محلل قطاع', name_en: 'sector_analyst', is_system: 0, created_at: T });
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', kind: 'delivery', color: '#244A99', active: 1, sort_order: 1,
    target_revenue_halalas: 900_000_000, target_sales_halalas: 700_000_000, created_at: T });
  await insert('department', { id: 'D_AI', sector_id: 'SOLUTIONS', name_ar: 'إدارة الذكاء الاصطناعي', active: 1, created_at: T });
  await insert('department', { id: 'D_CITY', sector_id: 'SOLUTIONS', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  for (const u of [lead, analyst]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id, sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  await run('UPDATE sector SET lead_user_id = ? WHERE id = ?', ['u_lead', 'SOLUTIONS']);
  const grant = (role, resource, action, scope) =>
    run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', [role, resource, action, scope]);
  await grant('sector_analyst', 'project', 'read', 'sector');
  await grant('sector_analyst', 'opportunity', 'read', 'sector');
  await initRbac();
  await insert('client', { id: 'C1', name_ar: 'أمانة المنطقة', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0, color: '#94a3b8' });
  await insert('project', { id: 'P_AI', code: 'PRJ-1', name_ar: 'مشروع الذكاء', sector_id: 'SOLUTIONS', department_id: 'D_AI',
    client_id: 'C1', status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 40, created_at: T });
  // ٦٥ موظفاً: ٣٠ في الذكاء، ٣٠ في المدن، ٥ بلا إدارة — أحمالٌ متدرّجة تغطي الفئات الثلاث، وواحد على الحدّ تماماً
  for (let i = 0; i < N_EMPS; i++) {
    const dept = i < 30 ? 'D_AI' : i < 60 ? 'D_CITY' : null;
    await insert('employee', { id: `E${i}`, name_ar: `موظف رقم ${i}`, sector_id: 'SOLUTIONS', department_id: dept, job_title: 'استشاري', active: 1, created_at: T });
    const load = i === 0 ? UTIL_BANDS.FREE_BELOW / 100 : i % 3 === 0 ? 0 : i % 3 === 1 ? 0.5 : 1.2;
    if (load) await insert('allocation', { id: `A${i}`, employee_id: `E${i}`, person_name_ar: 'x', project_id: 'P_AI', project_name: 'مشروع الذكاء',
      sector_id: 'SOLUTIONS', type: 'member', year: YEAR, monthly_json: allMonths(load), source: 'manual', created_at: T });
  }
  // فرصة متوقفة (تجاوزت عمر مرحلتها) وأخرى طازجة
  await insert('opportunity', { id: 'O_STALE', code: 'OPP-1', title_ar: 'فرصة راكدة منذ شهور', sector_id: 'SOLUTIONS', client_id: 'C1',
    stage_id: 'LEAD', owner_user_id: 'u_lead', value_halalas: 400_000_00, win_pct: 10, year: YEAR, stage_changed_at: '2025-01-01T00:00:00Z', created_at: '2025-01-01T00:00:00Z' });
  await insert('opportunity', { id: 'O_FRESH', code: 'OPP-2', title_ar: 'فرصة جديدة', sector_id: 'SOLUTIONS', client_id: 'C1',
    stage_id: 'LEAD', owner_user_id: 'u_lead', value_halalas: 100_000_00, win_pct: 10, year: YEAR, stage_changed_at: new Date().toISOString(), created_at: new Date().toISOString() });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const tpl = (html, id) => { const m = html.match(new RegExp(`<template id="dd-${id}">([\\s\\S]*?)</template>`)); return m ? m[1] : null; };

test('خلية «قدرة الفريق» تفتح نافذة الفريق: الإدارات القائمة بأعدادها ثم كل الأفراد — وكل صفٍّ يفتح نافذة صاحبه', async () => {
  const html = await sectorPage(lead, { year: YEAR });
  assert.match(html, /data-dd="seccap"/, 'الخلية العلوية زرٌّ لا رابط');
  assert.ok(!/href="\/app\/staffing[^"]*" style="text-decoration:none"/.test(html), 'ولا رابط خام إلى لوحة التسكين في الصفّ العلوي');
  const t = tpl(html, 'seccap');
  assert.ok(t, 'قالب نافذة الفريق');
  assert.ok(t.includes('حسب الإدارة') && t.includes('data-dd="cap-dept-D_AI"') && t.includes('data-dd="cap-dept-D_CITY"') && t.includes('data-dd="cap-dept-none"'), 'الإدارتان وسلّة «بلا إدارة»');
  assert.ok(t.includes('بلا إدارة'));
  assert.equal((t.match(/data-action="cap-person"/g) || []).length, N_EMPS, 'كل الأفراد صفوفٌ تفتح نوافذهم');
  const d = tpl(html, 'cap-dept-D_AI');
  assert.ok(d && d.includes('إدارة الذكاء الاصطناعي'), 'نافذة الإدارة');
  assert.equal((d.match(/data-action="cap-person"/g) || []).length, 30, 'ثلاثون موظفاً في الذكاء');
  assert.ok(d.includes('data-dd="seccap"'), 'ومنها عودة إلى كل الفريق');
});

test('فئات العدّاد أزرارٌ تفتح قوائمها، والحدّ ٧٠٪ ليس «متاحاً» — العتبة من مصدرها الواحد', async () => {
  const html = await sectorPage(lead, { year: YEAR });
  for (const k of ['mid', 'free', 'over']) assert.ok(tpl(html, `cap-band-${k}`), `نافذة الفئة ${k}`);
  const over = tpl(html, 'cap-band-over');
  assert.ok(over.includes('موظف رقم 2') && !over.includes('موظف رقم 1 '), 'المتجاوزون وحدهم');
  // الموظف صفر على ٧٠٪ تماماً: ضمن الطاقة لا «متاح للعمل»
  const card = html.slice(html.indexOf('متاحون للعمل'), html.indexOf('يحتاجون إعادة توزيع'));
  assert.ok(!card.includes('موظف رقم 0<') && !card.includes('data-emp="E0"'), 'من على الحدّ ليس في قائمة المتاحين');
  assert.match(html, new RegExp(`class="cap-axis[^"]*"[^>]*data-over="${UTIL_BANDS.OVER_ABOVE}"`), 'العتبة على المحور للعميل');
  assert.ok(html.includes(`الحدود من قواعد التسكين نفسها: ${UTIL_BANDS.FREE_BELOW}% و${UTIL_BANDS.OVER_ABOVE}%`));
});

test('الطيف يرسم ستين ثم «+N آخرون» يفتح نافذة الفريق — لا قصٌّ صامت', async () => {
  const html = await sectorPage(lead, { year: YEAR });
  assert.equal((html.match(/class="cap-av[ "]/g) || []).length, 60);
  assert.match(html, /class="cap-axis dense"/, 'ازدحام: ثلاثة صفوف');
  assert.ok(html.includes('class="tnum">5</span> آخرون'), 'الخمسة الباقون مذكورون');
});

test('من لا يقرأ الموظفين: نافذة الفريق مجاميع بلا أسماء وبلا رابط إلى لوحة التسكين', async () => {
  const html = await sectorPage(analyst, { year: YEAR });
  const t = tpl(html, 'seccap');
  assert.ok(t, 'النافذة موجودة له أيضاً — الخلية لا تُردّ بـ403');
  assert.ok(!t.includes('موظف رقم') && !t.includes('/app/staffing'));
  assert.ok(t.includes('صلاحية عرض الفريق'));
  assert.equal(tpl(html, 'cap-band-over'), null, 'ولا نوافذ فئات له');
});

test('«تغطية خط الفرص» و«متوقفة تحتاج متابعة» تفتحان تفصيلهما في الصفحة', async () => {
  const html = await sectorPage(lead, { year: YEAR });
  assert.match(html, /data-dd="seccover"/);
  const c = tpl(html, 'seccover');
  assert.ok(c && c.includes('المتبقي من هدف المبيعات') && c.includes('data-dd="fnl-ALL"') && c.includes('/app/opportunities'));
  assert.match(html, /data-dd="fnl-stalled"/, 'رقم المتوقفة زرٌّ');
  const s = tpl(html, 'fnl-stalled');
  assert.ok(s && s.includes('فرصة راكدة منذ شهور') && !s.includes('فرصة جديدة'), 'الراكدة وحدها بالاسم');
  assert.ok(s.includes('في المرحلة'));
});

test('حارس الانحراف: لا عتبة حرفية في صفحة مركز القيادة ولا في عميلها', () => {
  const view = readFileSync(join(ROOT, 'src/web/views/sector.js'), 'utf8');
  const client = readFileSync(join(ROOT, 'src/web/public/pages/sector.js'), 'utf8');
  const code = view.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/[<>]=?\s*110\b/.test(code), 'لا مقارنة بـ110 حرفياً في الصفحة');
  assert.ok(!/[<>]=?\s*70\b/.test(code), 'لا مقارنة بـ70 حرفياً في الصفحة');
  assert.ok(!/v > 110/.test(client) && !/\/ 125 \*/.test(client), 'العميل يقرأ العتبات من المحور');
});
