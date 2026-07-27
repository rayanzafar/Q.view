// عقد المساعد مع واجهته: ما يقوله الخادم بنفسه بدل أن تخمّنه اللوحة.
//
// ثلاث ثغرات كانت تُجبر المتصفح على حِيَل توافقية، وكل واحدة منها عطلٌ في الخادم لا في الواجهة:
//   ① المعاينة تُحفظ بمهلة خمس عشرة دقيقة ولا تُعاد لحظةُ انتهائها بالاسم الموثَّق، فتقول
//      اللوحة «لدقائق قليلة» بدل «حتى 03:20» ولا تعرف متى تُعطّل زرّ التأكيد.
//   ② مواصفة النموذج بلا شروط: «سبب التعطيل» يُعرض دائماً ولا يُطلب أبداً، فيمرّ المستخدم
//      بالمعاينة ويؤكّد ثم تردّه الخدمة — وهو بالضبط الرفض بعد التأكيد الذي وُجدت المعاينة
//      لمنعه. و«سبب التراجع عن الفوز» لا يمكن للوحة أن تعرف حالته أصلاً: صفّ الفرصة لا يقول
//      هل هي مكسوبة.
//   ③ ردّ الدردشة لا يسمّي نيّته ولا حقل اختياره، فاختيار المستخدم من قائمة الالتباس يضيع:
//      يُعاد تصنيف نصّ الخيار من جديد فيُجاب بجواب عام.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-ai-contract.db');
process.env.SANAD_DB = TEST_DB;
delete process.env.AI_ENGINE;

let db, server, base, DEMO_PW;
const cookies = {};
const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };

const USERS = ['demo.admin', 'demo.bd', 'demo.employee'];

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

  // مشروعان يتشاركان الاسم: حالة الالتباس لا تُثبَت بمشروع واحد.
  for (const [id, name] of [['FX-PRJ-A', 'مشروع التحول السحابي أ'], ['FX-PRJ-B', 'مشروع التحول السحابي ب']]) {
    await db.insert('project', { id, name_ar: name, sector_id: 'SOLUTIONS', status: 'IN_PROGRESS',
      rag: 'GREEN', progress_pct: 20, contract_value_halalas: 1000, created_at: '2026-01-15T08:00:00.000Z' });
  }

  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [i, u] of USERS.entries()) {
    const r = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close', 'x-forwarded-for': `10.55.0.${i + 1}` },
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
const fieldOf = (form, name) => (form?.fields || []).find((f) => f.name === name);

// ── ① لحظة انتهاء المعاينة تُعاد مع الرمز ─────────────────────────────────────
test('المعاينة تُعيد لحظة انتهائها كما حُفظت — فتُقال للمستخدم بوقتٍ حقيقي', async () => {
  const prev = await req('demo.employee', '/api/ai/preview', {
    method: 'POST', body: { type: 'task_create', fields: { title: 'مهمة لفحص المهلة' } } });
  assert.equal(prev.status, 200);
  assert.equal(typeof prev.json.expires_at, 'string', 'لحظة الانتهاء جزء من الردّ لا من التخمين');
  const at = Date.parse(prev.json.expires_at);
  assert.ok(!Number.isNaN(at), 'لحظة قابلة للقراءة: ' + prev.json.expires_at);
  assert.ok(at > Date.now(), 'في المستقبل');
  assert.ok(at - Date.now() <= 16 * 60000, 'وضمن مهلة المعاينة لا أبعد');

  const row = await db.get('SELECT expires_at FROM ai_activity_log WHERE id = ?', [prev.json.previewId]);
  assert.equal(prev.json.expires_at, row.expires_at, 'اللحظة نفسها المحفوظة — لا حساب ثانٍ في المتصفح');
});

test('المعاينة المنتهية: ما تعرضه اللوحة هو ما يفرضه الخادم عند التأكيد', async () => {
  const prev = await req('demo.employee', '/api/ai/preview', {
    method: 'POST', body: { type: 'task_create', fields: { title: 'مهمة تنتهي مهلتها' } } });
  await db.run('UPDATE ai_activity_log SET expires_at = ? WHERE id = ?', ['2020-01-01T00:00:00.000Z', prev.json.previewId]);
  const late = await req('demo.employee', '/api/ai/apply', { method: 'POST', body: { previewId: prev.json.previewId } });
  assert.equal(late.status, 400);
  assert.match(late.json.error.message, /انتهت صلاحية المعاينة/);
  assert.equal(Number((await db.get('SELECT applied FROM ai_activity_log WHERE id = ?', [prev.json.previewId])).applied), 0);
});

// ── ② شروط الحقول: الحقل يظهر ويُطلب في حالته وحدها ───────────────────────────
test('سبب التعطيل: شرطٌ من الخادم يجعله يظهر ويُطلب عند «مُعطَّل» وحدها', async () => {
  const r = await chat('demo.employee', '', { intent: 'update_task_status' });
  assert.equal(r.status, 200);
  const f = fieldOf(r.json.form, 'blockedReason');
  assert.ok(f, 'حقل سبب التعطيل موجود في المواصفة');
  assert.deepEqual(f.when, { field: 'status', equals: 'BLOCKED' }, 'شرط الظهور صريح من الخادم');
  assert.deepEqual(f.required_when, { field: 'status', equals: 'BLOCKED' }, 'وشرط الطلب مثله — فلا رفض بعد التأكيد');
});

test('الشرط يمنع الرفض بعد التأكيد: نفس القاعدة التي تفرضها خدمة المهام', async () => {
  // الخدمة ترفض «مُعطَّل» بلا سبب — والشرط أعلاه يجعل اللوحة تطلبه قبل المعاينة لا بعدها.
  const bare = await req('demo.employee', '/api/ai/preview', {
    method: 'POST', body: { type: 'task_status', fields: { taskId: 'FX-TSK-1', status: 'BLOCKED' } } });
  const rejected = await req('demo.employee', '/api/ai/apply', { method: 'POST', body: { previewId: bare.json.previewId } });
  assert.equal(rejected.status, 400);
  assert.match(rejected.json.error.message, /اكتب سبب التعطيل/);

  const good = await req('demo.employee', '/api/ai/preview', {
    method: 'POST', body: { type: 'task_status', fields: { taskId: 'FX-TSK-1', status: 'BLOCKED', blockedReason: 'بانتظار ردّ الجهة — يرفعه مدير المشروع' } } });
  const ok = await req('demo.employee', '/api/ai/apply', { method: 'POST', body: { previewId: good.json.previewId } });
  assert.equal(ok.status, 200);
  const t = await db.get("SELECT status, blocked_reason FROM task WHERE id = 'FX-TSK-1'");
  assert.equal(t.status, 'BLOCKED');
  assert.ok(t.blocked_reason);
  const audits = await db.all('SELECT action, resource, detail_json FROM audit_log WHERE resource_id = ?', ['FX-TSK-1']);
  assert.ok(audits.some((a) => a.action === 'update' && a.resource === 'task'), 'الخدمة دقّقت التغيير');
  assert.ok(audits.some((a) => /"via":"ai"/.test(a.detail_json || '')), 'وسطرٌ يقول إن مصدره المساعد');
});

test('قائمة الفرص تحمل «مكسوبة أم لا» — الحال الذي لا يستطيع المتصفح استنتاجه', async () => {
  const r = await req('demo.bd', '/api/ai/options/opportunity');
  assert.equal(r.status, 200);
  assert.ok(r.json.options.length > 0);
  assert.ok(r.json.options.every((o) => typeof o.won === 'boolean'), 'كل صفّ يقول حاله صراحةً');
  const won = r.json.options.find((o) => o.id === 'FX-OPP-5');
  const open = r.json.options.find((o) => o.id === 'FX-OPP-1');
  assert.equal(won.won, true, 'الفرصة المكسوبة تقول إنها مكسوبة');
  assert.equal(open.won, false, 'والمفتوحة تقول العكس — لا مطابقة أسماء مراحل');
});

test('سبب التراجع عن الفوز: شرطٌ مركّب يقرأ حال الفرصة المختارة ومرحلتها الجديدة', async () => {
  const r = await chat('demo.bd', '', { intent: 'move_opportunity_stage' });
  assert.equal(r.status, 200);
  const note = fieldOf(r.json.form, 'note');
  assert.ok(note, 'حقل السبب موجود');
  assert.ok(note.required_when && Array.isArray(note.required_when.all), 'شرط مركّب: حال الفرصة + المرحلة الجديدة');
  const [flag, stage] = note.required_when.all;
  assert.deepEqual(flag, { field: 'oppId', flag: 'won' }, 'يقرأ راية الصفّ المختار من القائمة');
  assert.equal(stage.field, 'stage');
  assert.ok(stage.not_equals !== undefined || Array.isArray(stage.not_in), 'ومرحلةٌ ليست مرحلة فوز');

  // والقاعدة نفسها هي التي تفرضها الخدمة عند التنفيذ.
  const bare = await req('demo.bd', '/api/ai/preview', {
    method: 'POST', body: { type: 'opp_stage', fields: { oppId: 'FX-OPP-5', stage: 'LEAD' } } });
  const rejected = await req('demo.bd', '/api/ai/apply', { method: 'POST', body: { previewId: bare.json.previewId } });
  assert.equal(rejected.status, 400);
  assert.match(rejected.json.error.message, /اكتب سبب التراجع/);
});

// ── ③ الردّ يسمّي نيّته وحقل اختياره ──────────────────────────────────────────
test('كل ردّ دردشة يسمّي نيّته — واختيار الالتباس يسمّي حقله', async () => {
  const one = await chat('demo.admin', 'ما أولوياتي اليوم');
  assert.equal(one.json.intent, 'suggest_priorities', 'الردّ يعرّف نيّته بنفسه');

  const many = await chat('demo.admin', 'لخّص حالة مشروع التحول السحابي');
  assert.equal(many.status, 200);
  assert.equal(many.json.intent, 'summarize_project');
  assert.ok(Array.isArray(many.json.choices) && many.json.choices.length === 2, 'مشروعان يتطابقان');
  assert.equal(many.json.choice_field, 'projectId', 'والردّ يقول بأي حقل يعود الاختيار');
  assert.ok(!('applyToken' in many.json) && !('preview' in many.json), 'ولا رمز تأكيد في ردّ قراءة');
});

test('الاختيار يعود بحقله فيصل إلى السجل المقصود بعينه — لا جواب عام', async () => {
  const many = await chat('demo.admin', 'لخّص حالة مشروع التحول السحابي');
  const picked = many.json.choices.find((c) => c.id === 'FX-PRJ-B');
  assert.ok(picked, 'الخيار المقصود ضمن القائمة');

  const back = await chat('demo.admin', 'لخّص حالة مشروع التحول السحابي',
    { intent: many.json.intent, [many.json.choice_field]: picked.id });
  assert.equal(back.status, 200);
  assert.equal(back.json.intent, 'summarize_project');
  assert.ok(!back.json.choices, 'لا التباس بعد الاختيار');
  assert.match(back.json.reply, /مشروع التحول السحابي ب/, 'الردّ عن المشروع المختار: ' + back.json.reply);
  assert.ok(!/ما أستطيعه لك الآن/.test(back.json.reply), 'ولا جواب القدرات العام');
});

test('اختيار حقل النموذج يصل كما هو: النموذج يعود مملوءاً بالسجل المختار', async () => {
  const ambiguous = await chat('demo.admin', 'أنشئ مهمة على مشروع التحول السحابي');
  assert.equal(ambiguous.json.intent, 'create_task');
  assert.equal(ambiguous.json.choice_field, 'projectId', 'حقل الاختيار هو حقل النموذج نفسه');
  assert.ok(ambiguous.json.choices?.length >= 2);

  const back = await chat('demo.admin', 'أنشئ مهمة على مشروع التحول السحابي',
    { intent: ambiguous.json.intent, [ambiguous.json.choice_field]: 'FX-PRJ-A' });
  assert.equal(back.status, 200);
  assert.equal(fieldOf(back.json.form, 'projectId').value, 'FX-PRJ-A', 'النموذج يفتح على المشروع المختار');
  assert.ok(!back.json.choices, 'ولا يُسأل عن الالتباس ثانيةً');
});
