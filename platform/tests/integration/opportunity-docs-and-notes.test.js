// «لازم يكون في مكان أحدّث فيه الفرص وأكتب ملاحظات عشان تُدوَّن مع الفرصة… وحط مكان أرفع فيه
// لنك الفرصة أو الملفات المتعلقة، وأيضاً مكان التكنكل بروبوزل، وأيضاً لنك الفايننشال بروبوزل»
// — بلسان المالك. ومعها: «لازم مكان يخلّيني أرجع للصفحة بعد ما أدخل على الفرصة وتفاصيلها».
//
// وثلاثتها كانت **موجودةً في القاعدة ومقطوعةً عن الشاشة**:
//   • `document.opportunity_id` عمودٌ منذ الترحيلة ٠٠٥ لم يُكتب فيه قط — بُني الجدول لثلاثة
//     أصحاب (عميل · مشروع · فرصة) ووُصِل اثنان وبقي الثالث معلّقاً.
//   • `crm_activity.detail` عمودٌ تقبله الخدمة ولا يعرضه النموذج — فمن أراد تدوين خلاصة
//     اجتماع حشرها في العنوان أو تركها خارج المنصة.
//   • ورابط الرجوع موجودٌ على صفحة المشروع منذ بنائها وغائبٌ عن صفحة الفرصة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-oppdoc-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps, docs, clients, P;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };
const CTX = { user: ADMIN, ip: '1' };
let OID;

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  opps = await import('../../src/modules/crm/opportunities.js');
  docs = await import('../../src/modules/crm/oppdocs.js');
  clients = await import('../../src/modules/clients/clients.js');
  P = await import('../../src/web/pages.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة الاقتصاد والتخطيط', created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  OID = (await opps.createOpportunity(CTX, { title_ar: 'منصة تحليلات', sector_id: 'SOL', client_id: 'CL', value_sar: 1150 })).id;
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── المستندات والروابط ───────────────────────────────────────────────────────
test('العرض الفني والمالي وإعلان المنافسة تُربَط بالفرصة وتُقرأ منها', async () => {
  for (const [kind, name] of [['tender', 'إعلان المنافسة على اعتماد'],
    ['technical', 'العرض الفني — النسخة الثانية'], ['financial', 'العرض المالي']]) {
    await docs.addOpportunityDocument(CTX, OID, { kind, name, url: 'https://drive.example.com/' + kind });
  }
  const r = await docs.opportunityDocuments(ADMIN, OID);
  assert.equal(r.documents.length, 3);
  assert.deepEqual(r.documents.map((x) => x.kind).sort(), ['financial', 'technical', 'tender']);
  assert.equal(r.canEdit, true);
});

test('وتظهر على صفحة الفرصة بأسمائها العربية لا برموزها', async () => {
  const html = await P.opportunityDetailPage(ADMIN, OID);
  assert.ok(html.includes('المستندات والروابط'), 'لا بطاقة مستندات على الصفحة');
  for (const label of ['إعلان المنافسة', 'العرض الفني', 'العرض المالي']) {
    assert.ok(html.includes(label), `«${label}» غائب عن الشاشة`);
  }
  assert.ok(!/>tender<|>technical<|>financial</.test(html), 'رمزٌ خام يظهر للمستخدم بدل اسمه العربي');
  assert.ok(html.includes('doc-url') && html.includes('doc-kind'), 'لا نموذج إضافة');
  // والشاشة تقول الحقيقة: رابطٌ لا نسخة.
  assert.ok(html.includes('تحفظ الرابط لا نسخةً من الملف'), 'الشاشة تُوهم برفع نسخة');
});

// رابطٌ يفتحه كل الفريق — فلا يُقبل إلا ما هو آمن.
test('ورابطٌ غير آمن يُرَدّ — الصفحة يفتحها كل الفريق', async () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x/y']) {
    await assert.rejects(() => docs.addOpportunityDocument(CTX, OID, { name: 'ملف', url: bad, kind: 'other' }),
      (e) => /https/.test(e.message), `قُبِل رابط «${bad}»`);
  }
});

test('ومستندٌ بلا رابط يُرَدّ برسالة تقول لماذا', async () => {
  await assert.rejects(() => docs.addOpportunityDocument(CTX, OID, { name: 'ملف بلا رابط', kind: 'other' }),
    (e) => /رابط/.test(e.message) && /نسخةً/.test(e.message));
});

test('والإزالة تُخفيه ولا تمحوه — والأثر مكتوب', async () => {
  const d = await docs.addOpportunityDocument(CTX, OID, { name: 'مسوّدة', url: 'https://x.example.com/a', kind: 'other' });
  await docs.deleteOpportunityDocument(CTX, d.id);
  const row = await db.get('SELECT deleted_at FROM document WHERE id = ?', [d.id]);
  assert.ok(row.deleted_at, 'حُذف الصفّ فعلياً بدل إخفائه');
  const a = await db.get(`SELECT * FROM audit_log WHERE resource='document' AND resource_id=? AND action='delete'`, [d.id]);
  assert.ok(a, 'إزالة مستند بلا أثر');
});

// من يقرأ الفرصة ولا يعدّلها لا يضيف إليها.
test('ومن لا يملك تعديل الفرصة لا يربط بها مستنداً', async () => {
  await db.insert('app_user', { id: 'u_v', username: 'v', name_ar: 'مشاهد', role_id: 'viewer', scope: 'company', active: 1, created_at: T });
  const viewer = { id: 'u_v', username: 'v', role_id: 'viewer', scope: 'company' };
  await assert.rejects(() => docs.addOpportunityDocument({ user: viewer, ip: '1' }, OID,
    { name: 'ملف', url: 'https://x.example.com/b', kind: 'other' }), (e) => /صلاحية/.test(e.message));
});

// ── الملاحظات تُدوَّن مع الفرصة ───────────────────────────────────────────────
test('التحديث يُسجَّل بعنوانه وملاحظته معاً — لا عنوانٌ وحده', async () => {
  const NOTE = 'اجتماع مع فريق الجهة: طلبوا تفصيل منهجية الترحيل وإضافة أثر التشغيل.';
  await clients.logActivity(CTX, { kind: 'meeting', title: 'اجتماع مراجعة العرض', detail: NOTE, opportunity_id: OID });
  const row = await db.get('SELECT title, detail FROM crm_activity WHERE opportunity_id = ? ORDER BY at DESC', [OID]);
  assert.equal(row.detail, NOTE, 'الملاحظة لم تُحفظ');
  const html = await P.opportunityDetailPage(ADMIN, OID);
  assert.ok(html.includes('اجتماع مراجعة العرض'), 'العنوان غائب عن الشاشة');
  assert.ok(html.includes('منهجية الترحيل'), 'الملاحظة محفوظة ولا تُعرض');
  assert.ok(html.includes('act-detail'), 'لا متّسع لكتابة ملاحظة على الشاشة');
});

// ── الرجوع ───────────────────────────────────────────────────────────────────
test('وصفحة الفرصة فيها طريق رجوعٍ إلى قائمة الفرص', async () => {
  const html = await P.opportunityDetailPage(ADMIN, OID);
  assert.ok(html.includes('href="/app/opportunities"'),
    'لا رابط رجوع — يدخل المستخدم من القائمة ولا يجد طريقاً إليها إلا زرّ المتصفّح');
});
