// ── صفحة الفرصة بتبويباتها (v5.24) والمطابقة العددية ─────────────────────────
//
// الصفحة صارت read-first بخمسة تبويبات، وكل الألواح تُرندر خادمياً (مخفيةً) — فكل النصوص
// المثبَّتة تبقى في رندرٍ واحد، والتبويب الابتدائي من `?tab=`. وسجل التدقيق للمدير العام
// وحده (بوابة صفحة التدقيق نفسها). والمطابقة: قائمة الفرص وملخص الخط يقولان الرقم نفسه —
// «رقم واحد حقيقة واحدة».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-opptabs-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps, P;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };
const CTX = { user: ADMIN, ip: '1' };
let OID;

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  opps = await import('../../src/modules/crm/opportunities.js');
  P = await import('../../src/web/pages.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1, default_win_pct: 10 });
  await db.insert('stage', { id: 'WON', name_ar: 'مكسوبة', is_won: 1, is_lost: 0, sort_order: 8, default_win_pct: 100 });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة التخطيط', created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_sl', username: 'sl', name_ar: 'قائد قطاع', role_id: 'sector_lead', scope: 'sector', sector_id: 'SOL', active: 1, created_at: T });
  OID = (await opps.createOpportunity(CTX, { title_ar: 'منصة التبويبات', sector_id: 'SOL', client_id: 'CL', value_sar: 2300 })).id;
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('رندر واحد يحمل التبويبات الخمسة وكل الأقسام المثبَّتة — لا HTML محذوف', async () => {
  const html = await P.opportunityDetailPage(ADMIN, OID);
  for (const tabPanel of ['opp-panel-overview', 'opp-panel-activity', 'opp-panel-docs', 'opp-panel-team', 'opp-panel-history']) {
    assert.ok(html.includes(tabPanel), `اللوح ${tabPanel} غائب`);
  }
  // العقود المثبَّتة القديمة كلها في الرندر نفسه:
  for (const pin of ['التحكم بالفرصة', 'oc-title', 'opp-control-save', 'المستندات والروابط',
    'doc-url', 'doc-kind', 'تحفظ الرابط لا نسخةً من الملف', 'act-title', 'team-emp-q',
    'سجل المراحل', 'opp-edit-tpl', 'opp-team-tpl']) {
    assert.ok(html.includes(pin), `«${pin}» غاب عن الرندر — عقد الحفظ انكسر`);
  }
  assert.ok(!html.includes('لا أيام'), '«لا أيام» ظهرت');
});

test('التبويب الابتدائي من ?tab= — والدخيل يسقط إلى النظرة العامة', async () => {
  const docs = await P.opportunityDetailPage(ADMIN, OID, { tab: 'docs' });
  assert.ok(/id="opp-panel-docs"[^>]*>/.test(docs) && !/id="opp-panel-docs"[^>]*hidden/.test(docs), 'تبويب المستندات لم يفتح');
  assert.ok(/id="opp-panel-overview"[^>]*hidden/.test(docs), 'النظرة العامة ظاهرة مع تبويبٍ آخر');
  const bad = await P.opportunityDetailPage(ADMIN, OID, { tab: '<script>alert(1)</script>' });
  assert.ok(!/id="opp-panel-overview"[^>]*hidden/.test(bad), 'قيمة دخيلة لم تسقط إلى النظرة العامة');
  assert.ok(!bad.includes('<script>alert(1)'), 'قيمة التبويب تُحقن في الصفحة');
});

test('سجل التدقيق للمدير العام وحده — بوابة صفحة التدقيق نفسها', async () => {
  const admin = await opps.opportunityDetail(ADMIN, OID);
  assert.ok(admin.auditTrail.length >= 1, 'المدير العام بلا سجل تدقيق');
  const sl = await db.get('SELECT * FROM app_user WHERE id = ?', ['u_sl']);
  const forSl = await opps.opportunityDetail(sl, OID);
  assert.equal(forSl.auditTrail.length, 0, 'سجل التدقيق تسرّب لغير المدير العام');
  const htmlSl = await P.opportunityDetailPage(sl, OID);
  assert.ok(!htmlSl.includes('سجل التدقيق'), 'بطاقة التدقيق ظاهرة لغير المدير العام');
});

test('مطابقة الأرقام: القائمة وملخص الخط يقولان الرقم نفسه لكل مرحلة', async () => {
  await opps.createOpportunity(CTX, { title_ar: 'ثانية', sector_id: 'SOL', client_id: 'CL', value_sar: 1150 });
  for (const user of [ADMIN, await db.get('SELECT * FROM app_user WHERE id = ?', ['u_sl'])]) {
    const list = await opps.listOpportunities(user);
    const sum = await opps.pipelineSummary(user);
    for (const s of sum) {
      const inList = list.filter((o) => o.stage_id === s.stage);
      assert.equal(inList.length, s.count, `عدّ «${s.name_ar}» مختلف بين القائمة والملخص (${user.username})`);
      assert.equal(inList.reduce((a, o) => a + (o.value_halalas || 0), 0), Number(s.value_halalas),
        `قيمة «${s.name_ar}» مختلفة بين القائمة والملخص (${user.username})`);
    }
  }
});

test('عمود «آخر نشاط» في القائمة يقرأ آخر تواصلٍ فعلاً ولا يغيّر العدّ', async () => {
  const before2 = (await opps.listOpportunities(ADMIN)).length;
  const clients = await import('../../src/modules/clients/clients.js');
  await clients.logActivity(CTX, { kind: 'call', title: 'اتصال متابعة', opportunity_id: OID });
  const rows = await opps.listOpportunities(ADMIN);
  assert.equal(rows.length, before2, 'ضمّ النشاط غيّر عدد الصفوف — الوصلة ضاعفت');
  const mine = rows.find((o) => o.id === OID);
  assert.ok(mine.last_activity_at, 'آخر نشاط فارغ بعد تسجيل تواصل');
});
