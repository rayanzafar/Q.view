// «في فرص مسكّنة على إدارة الابتكار وأبغى أنقلها على الذكاء… لازم في الواجهة شي يساعدني لما
// أضغط على الفرصة عشان أتحكّم بكل عملياتها: نقل قطاع، نقل إدارة، أو تغيير المبلغ» — بلسان المالك.
//
// وكانت صفحة الفرصة تملك حقلين لا غير: الخطوة التالية، والمرحلة. أما القيمة والقطاع والإدارة
// والمسؤول والجهة والسنة فتُكتب مرةً عند الإنشاء ثم **لا يمسّها شيء في المنتج كله** — فتصحيح
// رقمٍ واحد كان يعني فتح القاعدة من خلف الشاشة، وهو ما جاء المالك لإنهائه.
//
// وأثقلها الإدارة: صار الترشيح بها قائماً على شاشة الفرص، فيصل المالك إلى فرصةٍ عبر إدارتها
// ثم لا يجد فيها باباً يغيّرها — يفلتر بها ولا يملكها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-oppctl-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, rbac, opps, P;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company' };
const CTX = { user: ADMIN, ip: '127.0.0.1' };
const readOpp = (id) => db.get('SELECT * FROM opportunity WHERE id = ?', [id]);

before(async () => {
  db = await import('../../src/core/db/index.js');
  rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  opps = await import('../../src/modules/crm/opportunities.js');
  P = await import('../../src/web/pages.js');

  // قطاعا تسليم ووحدة مساندة — والإدارتان اللتان ذكرهما المالك بالاسم.
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('sector', { id: 'CONS', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1, created_at: T });
  await db.insert('sector', { id: 'SHARED', name_ar: 'الخدمات المشتركة', kind: 'support', active: 1, created_at: T });
  await db.insert('department', { id: 'D_INNO', name_ar: 'إدارة الابتكار', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_AI', name_ar: 'إدارة الذكاء الاصطناعي', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_OTHER', name_ar: 'إدارة استشارات الأعمال', sector_id: 'CONS', active: 1, created_at: T });

  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة الاقتصاد والتخطيط', created_at: T });
  await db.insert('client', { id: 'CL2', name_ar: 'الهيئة العامة للإحصاء', created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_bd', username: 'bd', name_ar: 'رئيس تطوير الأعمال', role_id: 'bd_head', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_off', username: 'off', name_ar: 'حساب موقوف', role_id: 'consultant', scope: 'own', active: 0, created_at: T });
});

after(() => rmSync(dir, { recursive: true, force: true }));

const mkOpp = async (over = {}) => (await opps.createOpportunity(CTX, {
  title_ar: 'منصة تحليلات', sector_id: 'SOL', department_id: 'D_INNO',
  client_id: 'CL', value_sar: 1000, stage_id: 'PROPOSAL', ...over,
})).id;

// ── سيناريو المالك حرفياً ─────────────────────────────────────────────────────
test('الفرصة تُنقل من إدارة الابتكار إلى إدارة الذكاء داخل قطاعها', async () => {
  const oid = await mkOpp();
  assert.equal((await readOpp(oid)).department_id, 'D_INNO', 'الفرصة لم تُولَد على إدارتها أصلاً');
  await opps.updateOpportunity(CTX, oid, { department_id: 'D_AI' });
  assert.equal((await readOpp(oid)).department_id, 'D_AI', 'نقل الإدارة لم يُكتب');
});

test('وإدارةٌ من قطاعٍ آخر تُرَدّ برسالة عربية تقول ما العمل', async () => {
  const oid = await mkOpp();
  await assert.rejects(
    () => opps.updateOpportunity(CTX, oid, { department_id: 'D_OTHER' }),
    (e) => /قطاعاً آخر/.test(e.message) && /اختر إدارة/.test(e.message),
    'قُبِلت إدارة من قطاعٍ آخر — فتُحسب في إدارةٍ لا تعمل على الفرصة وتغيب عن قطاعها');
  assert.equal((await readOpp(oid)).department_id, 'D_INNO', 'تغيّرت الإدارة رغم الرفض');
});

// نفس الحارس على باب الإنشاء — وإلا دخل الخلل من الباب الآخر.
test('ولا تُولَد فرصةٌ على إدارةٍ من غير قطاعها', async () => {
  await assert.rejects(
    () => opps.createOpportunity(CTX, { title_ar: 'فرصة', sector_id: 'SOL', department_id: 'D_OTHER' }),
    (e) => /قطاعاً آخر/.test(e.message));
});

// ── نقل القطاع: الإدارة تُرفَع معه ───────────────────────────────────────────
// إدارةُ القطاع القديم لا تتبع القطاع الجديد. لو بقيت لصار مجموع الإدارات مخالفاً لمجموع
// القطاعات آخر السنة — بلا شاشةٍ واحدة تقول أين الفرق.
test('نقل القطاع يرفع الإدارة القديمة — فلا فرصةٌ في قطاعٍ بإدارة قطاعٍ آخر', async () => {
  const oid = await mkOpp();
  await opps.updateOpportunity(CTX, oid, { sector_id: 'CONS' });
  const row = await readOpp(oid);
  assert.equal(row.sector_id, 'CONS', 'القطاع لم يُنقل');
  assert.equal(row.department_id, null, 'بقيت إدارة القطاع القديم على فرصةٍ غادرته');
});

test('وزرّ النقل على القائمة يرفعها كذلك — بابان وحكمٌ واحد', async () => {
  const oid = await mkOpp();
  await opps.moveSector(CTX, oid, 'CONS', 'أنسب لخبرة القطاع الآخر');
  const row = await readOpp(oid);
  assert.equal(row.sector_id, 'CONS');
  assert.equal(row.department_id, null, 'الباب الثاني يترك الإدارة القديمة — نسختان من الحكم');
});

test('ونقل القطاع وإدارته الجديدة يُحفظان معاً في خطوةٍ واحدة', async () => {
  const oid = await mkOpp();
  await opps.updateOpportunity(CTX, oid, { sector_id: 'CONS', department_id: 'D_OTHER' });
  const row = await readOpp(oid);
  assert.equal(row.sector_id, 'CONS');
  assert.equal(row.department_id, 'D_OTHER', 'الإدارة الجديدة دُقّقت على القطاع القديم لا الجديد');
});

test('ولا تُنقل فرصةٌ إلى وحدة مساندة — تختفي من مقارنة القطاعات بلا رسالة', async () => {
  const oid = await mkOpp();
  await assert.rejects(
    () => opps.updateOpportunity(CTX, oid, { sector_id: 'SHARED' }),
    (e) => /وحدة مساندة/.test(e.message));
  assert.equal((await readOpp(oid)).sector_id, 'SOL');
});

// ── بقيّة ما طلب المالك التحكّم به ────────────────────────────────────────────
test('المبلغ والمسؤول والجهة والسنة تُعدَّل كلها من صفحة الفرصة', async () => {
  const oid = await mkOpp();
  await opps.updateOpportunity(CTX, oid, {
    value_sar: 2500000, owner_user_id: 'u_bd', client_id: 'CL2', year: 2027,
    title_ar: 'منصة تحليلات — النسخة الثانية', win_pct: 65, priority: 'P1',
  });
  const row = await readOpp(oid);
  assert.equal(row.value_halalas, 250000000, 'المبلغ لم ينعكس بالهللات');
  assert.equal(row.owner_user_id, 'u_bd');
  assert.equal(row.client_id, 'CL2');
  assert.equal(row.year, 2027);
  assert.equal(row.title_ar, 'منصة تحليلات — النسخة الثانية');
  assert.equal(Number(row.win_pct), 65);
  assert.equal(row.priority, 'P1');
});

test('وحسابٌ موقوف لا يصير مسؤولاً عن فرصة', async () => {
  const oid = await mkOpp();
  await assert.rejects(
    () => opps.updateOpportunity(CTX, oid, { owner_user_id: 'u_off' }),
    (e) => /موقوف/.test(e.message));
});

test('وسنةٌ غير معقولة تُرَدّ بدل أن تُكتب', async () => {
  const oid = await mkOpp();
  await assert.rejects(
    () => opps.updateOpportunity(CTX, oid, { year: 12 }),
    (e) => /السنة/.test(e.message));
  assert.equal((await readOpp(oid)).year, new Date().getUTCFullYear());
});

// ── الأثر: كل نقلة مكتوبة ────────────────────────────────────────────────────
// نقلُ إيرادٍ متوقَّع بين إدارتين قرارُ عملٍ يُحاسَب عليه، فلا يمرّ بلا أثر يقول من نقله ومتى.
test('وكل نقلة مكتوبة في سجل التدقيق — من نقل وماذا نقل', async () => {
  const oid = await mkOpp();
  await opps.updateOpportunity(CTX, oid, { department_id: 'D_AI' });
  const a = await db.get(
    `SELECT * FROM audit_log WHERE resource = 'opportunity' AND action = 'update' AND resource_id = ?
      ORDER BY at DESC LIMIT 1`, [oid]);
  assert.ok(a, 'لا أثر إطلاقاً لنقل الإدارة');
  assert.equal(a.user_id, 'u_admin');
  assert.match(String(a.detail_json || ''), /D_AI/, 'الأثر لا يذكر الإدارة الجديدة');
});

// ── الشاشة ──────────────────────────────────────────────────────────────────
test('وصفحة الفرصة تعرض إدارتها وتفتح شريط التحكم لمن يملك التعديل', async () => {
  const oid = await mkOpp();
  const html = await P.opportunityDetailPage(ADMIN, oid);
  assert.ok(html.includes('إدارة الابتكار'), 'الصفحة لا تذكر الإدارة التي يُفلتَر بها');
  assert.ok(html.includes('التحكم بالفرصة'), 'لا شريط تحكّم');
  for (const el of ['oc-sector', 'oc-dept', 'oc-owner', 'oc-value', 'oc-client', 'oc-year']) {
    assert.ok(html.includes(el), `حقل «${el}» غائب عن شريط التحكم`);
  }
  assert.ok(html.includes('opp-control-save'), 'لا زرّ حفظ');
  // والقائمة تحمل إدارات القطاعين معاً كي يُنقل القطاع وإدارته في حفظةٍ واحدة.
  assert.ok(html.includes('إدارة الذكاء الاصطناعي') && html.includes('إدارة استشارات الأعمال'),
    'قائمة الإدارات لا تشمل إدارات القطاع الآخر — فنقل القطاع يحتاج فتح الصفحة مرتين');
});

test('ومن لا يملك التعديل لا يرى شريط التحكم أصلاً', async () => {
  const oid = await mkOpp();
  const reader = { id: 'u_r', username: 'r', name_ar: 'قارئ', role_id: 'consultant', scope: 'own', sector_id: 'SOL' };
  // القارئ لا يملك الفرصة (مسؤولها u_admin)، فقراءتها تُردّ — والردّ نفسه هو الحماية المطلوبة.
  await assert.rejects(() => P.opportunityDetailPage(reader, oid), () => true);
  // ومن يقرأ بلا تعديل: نُثبت الشرط على الشاشة مباشرةً عبر ما يحرسها (canEdit).
  const d = await opps.opportunityDetail(ADMIN, oid);
  assert.equal(d.canEdit, true, 'حتى المدير لا يملك التعديل — الشرط نفسه معطوب');
});
