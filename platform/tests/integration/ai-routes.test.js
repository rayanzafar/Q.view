// المساعد عبر الشبكة الحقيقية: العقد مع الواجهة، وحدود الكتابة، ودورة حياة المعاينة.
//
// أهم فحص في هذا الملف هو **ثابت السلامة**: `POST /api/ai/chat` لا يعيد رمز تأكيد أبداً مهما
// كان النص. الكتابة تبدأ من `POST /api/ai/preview` بحمولة مبنيّة معرّفاتها صادرة من الخادم —
// فخطأ في «فهم» جملة لا يمكن أن يُنشئ مهمة ولا أن ينقل فرصة، بنيوياً لا احتمالياً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-ai-routes.db');
process.env.SANAD_DB = TEST_DB;
delete process.env.AI_ENGINE;

let db, server, base, DEMO_PW;
const cookies = {};
const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };

const USERS = ['demo.admin', 'demo.pm', 'demo.bd', 'demo.employee', 'demo.procurement',
  'demo.sectorlead', 'demo.consultant', 'demo.officecoord', 'demo.officemember'];

before(async () => {
  wipe();
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  const seedMod = await import('../../scripts/seed.js');
  const { seedFixture } = await import('../../scripts/lib/seed-fixture.mjs');
  DEMO_PW = seedMod.DEMO_PW;
  await migrate();
  await seedRbac();
  await seedMod.seed();
  await seedFixture();

  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [i, u] of USERS.entries()) {
    const r = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close', 'x-forwarded-for': `10.44.0.${i + 1}` },
      body: JSON.stringify({ username: u, password: DEMO_PW }),
    });
    assert.equal(r.status, 200, `دخول ${u}`);
    cookies[u] = r.headers.getSetCookie().find((c) => c.startsWith('sanad_sid=')).split(';')[0];
    await r.text();
  }
});

after(async () => {
  server?.closeAllConnections?.();
  await new Promise((r) => (server ? server.close(r) : r()));
  await db?.close();
  wipe();
});

const req = async (u, path, { method = 'GET', body } = {}) => {
  const r = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { cookie: cookies[u], 'content-type': 'application/json', connection: 'close' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* غير مهم */ }
  return { status: r.status, text, json };
};
const chat = (u, message, opts) => req(u, '/api/ai/chat', { method: 'POST', body: { message, opts } });

// ── الحالة والاقتراحات ────────────────────────────────────────────────────────
test('الحالة: المحرّك محلي، وبطاقات الاقتراح مُرشَّحة بمنح كل دور', async () => {
  const admin = await req('demo.admin', '/api/ai/status');
  assert.equal(admin.status, 200);
  assert.equal(admin.json.mode, 'local');
  assert.equal(admin.json.modeLabel, 'محلي');
  assert.equal(admin.json.configured, false);
  const keys = (r) => r.json.suggestions.map((s) => s.intent);
  assert.ok(keys(admin).includes('weekly_report'), 'مدير النظام يرى الموجز الأسبوعي');
  assert.ok(admin.json.suggestions.every((s) => s.label_ar && ['read', 'write'].includes(s.kind)));

  const proc = await req('demo.procurement', '/api/ai/status');
  assert.ok(!keys(proc).includes('weekly_report'), 'المشتريات لا يُعرض له الموجز الأسبوعي');
  const emp = await req('demo.employee', '/api/ai/status');
  assert.ok(!keys(emp).includes('move_opportunity_stage'), 'الموظف لا يُعرض له نقل الفرص');
  assert.ok(keys(emp).includes('suggest_priorities'), 'وأولوياته متاحة له');
});

// ── ثابت السلامة: الدردشة لا تكتب ولا تُصدر رمز تأكيد ─────────────────────────
test('ثابت السلامة: لا رمز تأكيد في أي رد دردشة لأي دور مهما كان النص', async () => {
  const prompts = [
    'أنشئ مهمة عاجلة لمراجعة وثيقة المتطلبات غداً',
    'انقل الفرصة منصة خدمات الزوار إلى فائزة',
    'حدّث حالة مهمة إعداد وثيقة المتطلبات إلى منجزة',
    'غيّر كل شيء الآن',
    'لخّص حالة مشروع منصة الخدمات الموحدة',
  ];
  const beforeTasks = Number((await db.get('SELECT COUNT(*) n FROM task')).n);
  const beforeOpps = (await db.get("SELECT stage_id FROM opportunity WHERE id = 'FX-OPP-1'")).stage_id;
  for (const u of USERS) {
    for (const p of prompts) {
      const r = await chat(u, p);
      assert.ok([200, 403].includes(r.status), `${u} ← ${p} حالة غير متوقعة ${r.status}`);
      if (r.status !== 200) continue;
      assert.ok(!('applyToken' in r.json), `${u}: الدردشة أعادت رمز تأكيد — ${p}`);
      assert.ok(!('previewId' in r.json), `${u}: الدردشة أعادت معرّف معاينة — ${p}`);
      assert.ok(!('preview' in r.json), `${u}: الدردشة أعادت معاينة جاهزة — ${p}`);
      assert.ok(typeof r.json.reply === 'string' && r.json.reply.length > 0);
    }
  }
  assert.equal(Number((await db.get('SELECT COUNT(*) n FROM task')).n), beforeTasks, 'الدردشة لم تُنشئ مهمة');
  assert.equal((await db.get("SELECT stage_id FROM opportunity WHERE id = 'FX-OPP-1'")).stage_id, beforeOpps,
    'الدردشة لم تُحرّك فرصة');
});

test('نية الكتابة من نص حر تعيد نموذجاً لا تخميناً', async () => {
  const r = await chat('demo.pm', 'أنشئ مهمة مراجعة المخرجات');
  assert.equal(r.status, 200);
  assert.equal(r.json.form?.type, 'task_create');
  const names = r.json.form.fields.map((f) => f.name);
  assert.deepEqual(names, ['title', 'projectId', 'dueDate', 'priority']);
  assert.ok(r.json.form.fields.find((f) => f.name === 'projectId').options_kind === 'project');
});

test('مساعدو المكتب: نموذج مهمة مسموح بلا تنفيذ، ومخاطر المشاريع محجوبة', async () => {
  const beforeTasks = Number((await db.get('SELECT COUNT(*) n FROM task')).n);
  for (const u of ['demo.officecoord', 'demo.officemember']) {
    assert.equal((await chat(u, 'ما المخاطر البارزة')).status, 403);
    const r = await chat(u, 'أنشئ مهمة متابعة العقد');
    assert.equal(r.status, 200);
    assert.equal(r.json.form?.type, 'task_create');
    assert.ok(!r.json.applyToken && !r.json.previewId);
  }
  assert.equal(Number((await db.get('SELECT COUNT(*) n FROM task')).n), beforeTasks);
});

// ── الخيارات: كل معرّف يظهر للواجهة صادر من الخادم ومُرشَّح بالنطاق ───────────
test('الخيارات: قائمة المشاريع مُرشَّحة بالنطاق، والفرص محجوبة عمّن لا يملكها', async () => {
  const pm = await req('demo.pm', '/api/ai/options/project');
  assert.equal(pm.status, 200);
  const ids = pm.json.options.map((o) => o.id);
  assert.ok(ids.includes('FX-PRJ-1'), 'مدير المشروع يرى مشروعه');
  assert.ok(pm.json.options.every((o) => o.label_ar && !/undefined/.test(o.label_ar)));

  const empOpts = await req('demo.employee', '/api/ai/options/opportunity');
  assert.equal(empOpts.status, 403, 'الموظف بلا قراءة فرص');
  const stages = await req('demo.bd', '/api/ai/options/stage');
  assert.equal(stages.status, 200);
  assert.ok(stages.json.options.some((o) => o.id === 'WON' && o.label_ar === 'مكسوبة'));
  const bad = await req('demo.admin', '/api/ai/options/somethingelse');
  assert.equal(bad.status, 400);
});

// ── المعاينة والتأكيد ─────────────────────────────────────────────────────────
test('المعاينة ثم التأكيد: تُنفَّذ مرة واحدة، ورمز غيرك لا يعمل، ورمز مطبَّق لا يُعاد', async () => {
  const prev = await req('demo.bd', '/api/ai/preview', {
    method: 'POST', body: { type: 'opp_stage', fields: { oppId: 'FX-OPP-1', stage: 'QUALIFIED' } },
  });
  assert.equal(prev.status, 200);
  assert.ok(prev.json.applyToken, 'المعاينة تعيد رمز تأكيد');
  assert.match(prev.json.reply, /معاينة تغيير/);
  assert.ok(!/LEAD|QUALIFIED/.test(prev.json.reply), 'الرد بأسماء المراحل لا برموزها: ' + prev.json.reply);

  const stolen = await req('demo.sectorlead', '/api/ai/apply', { method: 'POST', body: { applyToken: prev.json.applyToken } });
  assert.equal(stolen.status, 400, 'رمز شخص آخر لا يُطبَّق');
  assert.match(stolen.json.error.message, /لا أجد هذه المعاينة/);

  const ok = await req('demo.bd', '/api/ai/apply', { method: 'POST', body: { applyToken: prev.json.applyToken } });
  assert.equal(ok.status, 200);
  assert.equal((await db.get("SELECT stage_id FROM opportunity WHERE id = 'FX-OPP-1'")).stage_id, 'QUALIFIED');
  const hist = await db.get("SELECT to_stage_id FROM opportunity_stage_history WHERE opportunity_id = 'FX-OPP-1' ORDER BY changed_at DESC LIMIT 1");
  assert.equal(hist.to_stage_id, 'QUALIFIED', 'سجل المراحل كُتب عبر الخدمة نفسها');

  const twice = await req('demo.bd', '/api/ai/apply', { method: 'POST', body: { applyToken: prev.json.applyToken } });
  assert.equal(twice.status, 400, 'المزلاج: لا تطبيق مرتين');
  assert.match(twice.json.error.message, /طُبِّقت من قبل/);

  const row = await db.get('SELECT applied, applied_at, approved_by, outcome FROM ai_activity_log WHERE id = ?', [prev.json.applyToken]);
  assert.equal(Number(row.applied), 1);
  assert.ok(row.applied_at, 'وقت التطبيق مكتوب');
  assert.ok(row.approved_by, 'من أكّد مكتوب — العمود كان فارغاً دائماً قبل اليوم');
});

test('المعاينة تتحقق من المرحلة ومن ملكية الفرصة قبل أن تُحفظ', async () => {
  const bad = await req('demo.bd', '/api/ai/preview', {
    method: 'POST', body: { type: 'opp_stage', fields: { oppId: 'FX-OPP-2', stage: 'SUPERWON' } } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error.message, /مرحلة غير معروفة/);

  const foreign = await req('demo.bd', '/api/ai/preview', {
    method: 'POST', body: { type: 'opp_stage', fields: { oppId: 'FX-OPP-CONS', stage: 'WON' } } });
  assert.equal(foreign.status, 403, 'فرصة قطاع آخر لا تُعايَن أصلاً');

  const noGrant = await req('demo.employee', '/api/ai/preview', {
    method: 'POST', body: { type: 'opp_stage', fields: { oppId: 'FX-OPP-2', stage: 'WON' } } });
  assert.equal(noGrant.status, 403);
});

test('قواعد الخدمة تصعد كما هي: التراجع عن الفوز يستوجب سبباً مكتوباً', async () => {
  const prev = await req('demo.bd', '/api/ai/preview', {
    method: 'POST', body: { type: 'opp_stage', fields: { oppId: 'FX-OPP-5', stage: 'LEAD' } } });
  assert.equal(prev.status, 200, 'المعاينة تُبنى — القاعدة تخصّ التنفيذ لا العرض');
  const applied = await req('demo.bd', '/api/ai/apply', { method: 'POST', body: { applyToken: prev.json.applyToken } });
  assert.equal(applied.status, 400);
  assert.match(applied.json.error.message, /اكتب سبب التراجع قبل الحفظ/);
  assert.equal((await db.get("SELECT stage_id FROM opportunity WHERE id = 'FX-OPP-5'")).stage_id, 'WON',
    'ولم تتغيّر الفرصة');
  const row = await db.get('SELECT applied FROM ai_activity_log WHERE id = ?', [prev.json.applyToken]);
  assert.equal(Number(row.applied), 0, 'ورفضُ الخدمة أرجع المزلاج فبقيت المعاينة قابلة للتصحيح');

  const withReason = await req('demo.bd', '/api/ai/preview', {
    method: 'POST', body: { type: 'opp_stage', fields: { oppId: 'FX-OPP-5', stage: 'LEAD', note: 'العميل ألغى الترسية' } } });
  const ok = await req('demo.bd', '/api/ai/apply', { method: 'POST', body: { applyToken: withReason.json.applyToken } });
  assert.equal(ok.status, 200);
  assert.equal((await db.get("SELECT stage_id FROM opportunity WHERE id = 'FX-OPP-5'")).stage_id, 'LEAD');
});

test('إنشاء مهمة عبر المساعد يمرّ بخدمة المهام: يُدقَّق ويُثبَّت قطاعه', async () => {
  const prev = await req('demo.employee', '/api/ai/preview', {
    method: 'POST', body: { type: 'task_create', fields: { title: 'مهمة من المساعد', priority: 'P1', dueDate: '2026-09-01' } } });
  assert.equal(prev.status, 200);
  assert.match(prev.json.preview.summary, /مهمة من المساعد/);
  assert.ok(!/P1/.test(prev.json.preview.summary), 'الأهمية بالمعنى لا بالرمز: ' + prev.json.preview.summary);
  const ok = await req('demo.employee', '/api/ai/apply', { method: 'POST', body: { applyToken: prev.json.applyToken } });
  assert.equal(ok.status, 200);
  const t = await db.get('SELECT * FROM task WHERE id = ?', [ok.json.resourceId]);
  assert.equal(t.title, 'مهمة من المساعد');
  assert.equal(t.sector_id, 'SOLUTIONS', 'القطاع مثبَّت على قطاع صاحبه');
  const audits = await db.all("SELECT action, resource, detail_json FROM audit_log WHERE resource_id = ?", [t.id]);
  assert.ok(audits.some((a) => a.action === 'create' && a.resource === 'task'), 'الخدمة دقّقت الإنشاء');
  assert.ok(audits.some((a) => /"via":"ai"/.test(a.detail_json || '')), 'وسطرٌ يقول إن مصدره المساعد');
});

test('تغيير حالة مهمة: القاعدة نفسها — «مُعطَّل» بلا سبب مردود برسالة الخدمة', async () => {
  const prev = await req('demo.employee', '/api/ai/preview', {
    method: 'POST', body: { type: 'task_status', fields: { taskId: 'FX-TSK-2', status: 'BLOCKED' } } });
  assert.equal(prev.status, 200);
  const applied = await req('demo.employee', '/api/ai/apply', { method: 'POST', body: { applyToken: prev.json.applyToken } });
  assert.equal(applied.status, 400);
  assert.match(applied.json.error.message, /اكتب سبب التعطيل/);

  const good = await req('demo.employee', '/api/ai/preview', {
    method: 'POST', body: { type: 'task_status', fields: { taskId: 'FX-TSK-2', status: 'BLOCKED', blockedReason: 'بانتظار بيانات الجهة — يرفعه مدير المشروع' } } });
  const ok = await req('demo.employee', '/api/ai/apply', { method: 'POST', body: { applyToken: good.json.applyToken } });
  assert.equal(ok.status, 200);
  const t = await db.get("SELECT status, blocked_reason FROM task WHERE id = 'FX-TSK-2'");
  assert.equal(t.status, 'BLOCKED');
  assert.ok(t.blocked_reason);

  const foreign = await req('demo.employee', '/api/ai/preview', {
    method: 'POST', body: { type: 'task_status', fields: { taskId: 'FX-TSK-3', status: 'DONE' } } });
  assert.equal(foreign.status, 403, 'مهمة شخص آخر خارج نطاق الموظف');
});

// ── الصلاحيات على المسارات القياديّة والسجل ───────────────────────────────────
test('الموجز الأسبوعي: بوابته بوابة أرقام الشركة نفسها', async () => {
  const proc = await chat('demo.procurement', 'اكتب لي الموجز التنفيذي الأسبوعي');
  assert.equal(proc.status, 403, 'المشتريات يُردّ كما يُردّ على مقاييس الشركة');
  assert.match(proc.json.error.message, /خارج صلاحيتك/);
  assert.match(proc.json.error.message, /أولوياتي اليوم|ملخّص مشروع/, 'والرسالة تقول ماذا يطلب بدلاً منه');
  const metrics = await req('demo.procurement', '/api/metrics/company');
  assert.equal(metrics.status, 403, 'البابان متطابقان');
  const admin = await chat('demo.admin', 'اكتب لي الموجز التنفيذي الأسبوعي');
  assert.equal(admin.status, 200);
});

test('سجل نشاط المساعد: بمنح قراءة التدقيق، ونصّ المعاينة لمدير النظام وحده', async () => {
  const admin = await req('demo.admin', '/api/ai/activity');
  assert.equal(admin.status, 200);
  assert.ok(admin.json.rows.length > 0);
  assert.ok('preview_json' in admin.json.rows.find((r) => r.intent === 'move_opportunity_stage'));
  const pm = await req('demo.pm', '/api/ai/activity');
  assert.equal(pm.status, 403);
  assert.equal(pm.json.error.code, 'forbidden');
});

test('السجل: الطلب المرفوض يُسجَّل بنيّته ونتيجته بلا نصّه', async () => {
  await chat('demo.procurement', 'اكتب لي الموجز التنفيذي الأسبوعي سرّاً');
  const row = await db.get(
    "SELECT prompt, intent, outcome FROM ai_activity_log WHERE intent = 'weekly_report' AND outcome = 'denied' ORDER BY at DESC LIMIT 1");
  assert.ok(row, 'الرفض مسجَّل');
  assert.equal(row.prompt, null, 'ونصّ الطلب المرفوض لا يُحفظ');
});
