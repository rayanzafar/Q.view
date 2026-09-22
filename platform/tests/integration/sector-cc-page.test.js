// ── «مركز القطاع» — الشاشة الواحدة على الخادم ───────────────────────────────────────────
// ما يحرسه هذا الفحص بترتيب أهميته:
//   ١) **الحزم الثلاث تصل سليمة**: `cc-data` و`cc-view` و`cc-labels` موجودةٌ وتُقرأ، و`</`
//      مُهرَّبة فيها فلا يُغلق وسمُ النصّ البرمجي من داخل اسمٍ مسجَّل.
//   ٢) **الرابط يُحلّ على الخادم**: الفترة (`p` أو `months`) والمرشِّحات واللوحة المفتوحة —
//      ومعرّفٌ لا وجود له في الحمولة يسقط صامتاً ولا يُقصّ به شيء.
//   ٣) **الحجب بالغياب**: من لا يقرأ الكلفة لا تصله سطورُها في الوسم أصلاً.
//   ٤) **الوجه الشخصي باقٍ**: من نطاقه دون القطاع يبقى على «قطاعي».
//   ٥) **لا قيمة خام في وجه القارئ**: لا «undefined» ولا «NaN» ولا «[object».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-ccpage-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const db = await import('../../src/core/db/index.js');
// دورٌ يقرأ المشاريع والإيراد والمستهدف بلا بابَي الكلفة والهامش — لا توليفةَ كهذه في
// المصفوفة، وبناؤها في القاعدة أصدق من تزوير قرار المحرّك.
await db.run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_ccnocost','قارئ بلا كلفة','No Cost Reader',0,'2026-01-01T00:00:00.000Z')");
for (const [res, act] of [['revenue_line', 'read'], ['budget', 'read'], ['project', 'read'],
  ['opportunity', 'read'], ['report', 'read'], ['kpi', 'read'], ['client', 'read']]) {
  await db.run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_ccnocost', res, act, 'sector']);
}
// ودورٌ نطاقه «ما أعمل عليه» وحده: وجهُه الشخصي «قطاعي» لا مركز القطاع.
await db.run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_ccown','عضو فريق','Team Member',0,'2026-01-01T00:00:00.000Z')");
for (const [res, act] of [['project', 'read'], ['task', 'read']]) {
  await db.run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_ccown', res, act, 'own']);
}
await (await import('../../src/core/rbac/index.js')).initRbac();
const { sectorPage, sectorViewMode } = await import('../../src/web/views/sector.js');

const T = '2026-01-05T00:00:00Z';
// سنةٌ ماضية عمداً: لا تعلّق لأرقام الفحص بشهر تشغيله.
const YEAR = new Date().getUTCFullYear() - 1;
const person = (id, username, role, scope, sector = 'SOL') => ({ id, username, role_id: role, scope,
  sector_id: sector, projectIds: new Set(), teamIds: new Set() });
const LEAD = person('u_lead', 'lead', 'sector_lead', 'sector');
const NOCOST = person('u_nocost', 'nocost', 't_ccnocost', 'sector');
const MEMBER = person('u_member', 'member', 't_ccown', 'own');
const BOSS = person('u_boss', 'boss', 'admin', 'company', null);

let server, base;
const http = async (path, as) => {
  const r = await fetch(base + path, { headers: { cookie: `sanad_sid=sess_${as}` }, redirect: 'manual' });
  return { status: r.status, headers: r.headers, text: await r.text() };
};

before(async () => {
  for (const [id, name, order] of [['SOL', 'قطاع الحلول', 1], ['CON', 'قطاع الاستشارات', 2]]) {
    await db.insert('sector', { id, name_ar: name, kind: 'delivery', active: 1, sort_order: order,
      target_revenue_halalas: 100_000_000, target_sales_halalas: 100_000_000, created_at: T });
  }
  for (const u of [LEAD, NOCOST, MEMBER, BOSS]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.username, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  await db.insert('department', { id: 'D_AI', name_ar: 'إدارة الذكاء الاصطناعي', sector_id: 'SOL', created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await db.insert('client', { id: 'CL_A', name_ar: 'جهة ألف', created_at: T });
  await db.insert('project', { id: 'P_AI', name_ar: 'مشروع الذكاء', sector_id: 'SOL', status: 'IN_PROGRESS',
    rag: 'GREEN', start_date: `${YEAR}-01-15`, department_id: 'D_AI', client_id: 'CL_A', created_at: T });
  await db.insert('project', { id: 'P_CITY', name_ar: 'مشروع المدن', sector_id: 'SOL', status: 'IN_PROGRESS',
    rag: 'GREEN', start_date: `${YEAR}-01-15`, client_id: 'CL_A', created_at: T });
  await db.insert('revenue_line', { id: 'RL_AI', sector_id: 'SOL', project_id: 'P_AI', year: YEAR, month: 2,
    amount_halalas: 4_600_000_00, net_amount_halalas: 4_000_000_00, created_at: T });
  await db.insert('revenue_line', { id: 'RL_CITY', sector_id: 'SOL', project_id: 'P_CITY', year: YEAR, month: 5,
    amount_halalas: 2_300_000_00, net_amount_halalas: 2_000_000_00, created_at: T });
  await db.insert('opportunity', { id: 'O_1', title_ar: 'فرصة ألف', sector_id: 'SOL', client_id: 'CL_A',
    stage_id: 'LEAD', value_halalas: 1_000_000_00, win_pct: 10, created_at: T, updated_at: T });
  // جلسةٌ حيّة للمسار نفسه: ترويسةُ الصفحة لا تُقرأ إلا من ردٍّ حقيقي.
  await db.insert('session', { id: 'sess_lead', user_id: LEAD.id, created_at: T,
    expires_at: new Date(Date.now() + 86400000).toISOString() });
  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((res) => server.close(res));
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

const render = (user, opts) => sectorPage(user, { year: String(YEAR), ...opts });
const pack = (html, id) => {
  const open = `<script type="application/json" id="${id}">`;
  const from = html.indexOf(open);
  assert.ok(from > 0, `حزمة ${id} غائبة عن الصفحة`);
  const body = html.slice(from + open.length, html.indexOf('</script>', from));
  return JSON.parse(body);
};

test('الشاشة تُسلَّم كاملةً: الحاويات والحزم الثلاث تُقرأ', async () => {
  const h = await render(LEAD, {});
  for (const id of ['fbar', 'ccHero', 'ccBand', 'cPrj', 'cOpp', 'cCli', 'cMoney', 'cTeam', 'cFoot']) {
    assert.ok(h.includes(`id="${id}"`), `حاوية ${id} غائبة`);
  }
  assert.ok(h.includes('class="cc-page"'), 'جذر الصفحة لا يحمل صنف الشاشة');
  assert.ok(h.includes('/static/pages/sector.css'), 'ورقة أنماط الصفحة غير مربوطة');
  for (const s of ['sector-figures.js', 'pages/sector.js', 'sector-drawer.js']) {
    assert.ok(h.includes(s), `ملفّ ${s} غير محمَّل`);
  }
  const data = pack(h, 'cc-data');
  assert.equal(data.meta.sector.id, 'SOL');
  assert.equal(data.meta.year, YEAR);
  assert.ok(Array.isArray(data.lines) && data.lines.length, 'سطور قائمة الدخل غائبة عن الحمولة');
  const labels = pack(h, 'cc-labels');
  assert.equal(labels.MONTHS_AR.length, 12);
  assert.equal(labels.QUARTERS_AR.length, 4);
  assert.ok(labels.HEALTH_LABELS.GREEN, 'أسماء حالات المشروع غائبة');
  assert.equal(labels.notEnteredYet, 'لم يُسجَّل');
});

test('وسمُ النصّ البرمجي لا يُغلق من داخل البيانات', async () => {
  // اسمٌ عدائيّ في بيانٍ حقيقي: لو سُلسل كما هو لأغلق الوسم وفتح شيفرةً في الصفحة.
  await db.insert('client', { id: 'CL_X', name_ar: '</script><img src=x onerror=alert(1)>', created_at: T });
  await db.insert('project', { id: 'P_X', name_ar: 'مشروع الاختبار', sector_id: 'SOL', status: 'IN_PROGRESS',
    rag: 'GREEN', start_date: `${YEAR}-02-01`, client_id: 'CL_X', created_at: T });
  const h = await render(LEAD, {});
  assert.ok(!h.includes('</script><img'), 'وسمٌ عدائي مرّ إلى الصفحة كما هو');
  assert.ok(h.includes('\\u003c/script\\u003e'), '«</» لم تُهرَّب داخل الحزمة');
  const data = pack(h, 'cc-data');
  assert.ok(data.clients.some((c) => c.name.includes('</script>')), 'الاسم لم يصل إلى الحمولة كما سُجِّل');
});

test('لا قيمة خام في وجه القارئ', async () => {
  const h = await render(LEAD, {});
  const visible = h.replace(/<script type="application\/json"[\s\S]*?<\/script>/g, '');
  for (const bad of ['undefined', 'NaN', '[object']) {
    assert.ok(!visible.includes(bad), `«${bad}» ظهر في الصفحة`);
  }
});

test('الروابط العميقة تُحلّ على الخادم: الفترة والمرشِّحات واللوحة', async () => {
  const q = pack(await render(LEAD, { p: 'q1-q3' }), 'cc-view');
  assert.deepEqual(q.months, [1, 2, 3, 4, 5, 6, 7, 8, 9], '«من الربع الأول إلى الثالث» لم تُحلّ إلى تسعة أشهر');
  const m = pack(await render(LEAD, { months: '1,3,5' }), 'cc-view');
  assert.deepEqual(m.months, [1, 3, 5], 'قائمة الأشهر المتقطّعة لم تُحترم');
  const mixed = pack(await render(LEAD, { months: '5,1,99,3,x' }), 'cc-view');
  assert.deepEqual(mixed.months, [1, 3, 5], 'الأشهر لم تُرتَّب أو لم يسقط ما خرج عن الاثني عشر');
  const one = pack(await render(LEAD, { p: 'm4' }), 'cc-view');
  assert.deepEqual(one.months, [4], 'شهرٌ بعينه لم يُحلّ');
  const y = pack(await render(LEAD, { p: 'y' }), 'cc-view');
  assert.equal(y.months.length, 12, 'السنة كاملةً لم تُحلّ');
  // مدى أشهرٍ بلسانه، ورابطٌ قديمٌ حُفظ بمُنتقيَي «من/إلى» — قاعدةُ الفترة واحدة لا اثنتان.
  const mr = pack(await render(LEAD, { p: 'm3-m8' }), 'cc-view');
  assert.deepEqual(mr.months, [3, 4, 5, 6, 7, 8], '«من مارس إلى أغسطس» لم تُحلّ إلى ستة أشهر');
  const legacy = pack(await render(LEAD, { pa: '3', pb: '8' }), 'cc-view');
  assert.deepEqual(legacy.months, [3, 4, 5, 6, 7, 8], 'رابطٌ قديم بـpa/pb لم يُترجَم إلى مدىً');
  const legacyOne = pack(await render(LEAD, { pa: '5', pb: '5' }), 'cc-view');
  assert.deepEqual(legacyOne.months, [5], 'حدّان متساويان لم يُقرآ شهراً واحداً');
  const wins = pack(await render(LEAD, { pa: '3', pb: '8', months: '11' }), 'cc-view');
  assert.deepEqual(wins.months, [11], 'الأخصُّ (الأشهر الصريحة) لم يعلُ على الرابط القديم');
  // مشروعٌ موجودٌ وآخر لا وجود له: الأول يُقصّ به والثاني يسقط صامتاً
  const prj = pack(await render(LEAD, { project: 'P_AI,لا-وجود-له' }), 'cc-view');
  assert.deepEqual(prj.projects, ['P_AI'], 'معرّفٌ لا وجود له لم يسقط من حالة العرض');
  const cli = pack(await render(LEAD, { client: 'CL_A,P_AI' }), 'cc-view');
  assert.deepEqual(cli.clients, ['CL_A'], 'معرّفُ مشروعٍ قُبل في مكان العميل');
  const dept = pack(await render(LEAD, { dept: 'D_AI,none' }), 'cc-view');
  assert.deepEqual(dept.depts, ['D_AI'], 'إدارةٌ لا وجود لها لم تسقط');
});

test('ألسنة الشاشة القديمة تفتح لوحاتِ التفاصيل المقابلة', async () => {
  for (const [tab, k] of [['hr', 'team'], ['pl', 'pl'], ['ops', 'projects'], ['next', 'pace']]) {
    const v = pack(await render(LEAD, { tab }), 'cc-view');
    assert.deepEqual(v.open, { k }, `?tab=${tab} لم يفتح لوحته`);
  }
  const none = pack(await render(LEAD, { tab: 'pulse' }), 'cc-view');
  assert.equal(none.open, null, 'لسانٌ بلا لوحةٍ مقابلة فتح لوحةً');
  const bad = pack(await render(LEAD, { tab: 'لا-وجود-له' }), 'cc-view');
  assert.equal(bad.open, null, 'لسانٌ مجهول فتح لوحة');
});

test('الجدول الاحتياطي مُصيَّر على الخادم — فالشاشة لا تُسلَّم فارغة', async () => {
  const h = await render(LEAD, { p: 'y' });
  const band = h.slice(h.indexOf('id="ccBand"'), h.indexOf('class="c-pillars"'));
  assert.ok(band.includes('الإيراد'), 'سطر الإيراد غائب عن الجدول الاحتياطي');
  assert.ok(band.includes('رواتب التشغيل'), 'سطور الكلفة غائبة عن الجدول الاحتياطي');
  assert.ok(band.includes('مجمل الربح'), 'سطر مجمل الربح غائب');
  assert.ok(band.includes('لم يُسجَّل'), 'كلفةٌ غير مُدخَلة لم تُقَل «لم يُسجَّل»');
  assert.ok(!/>\(?0 ر\.س\)?</.test(band), 'قيمةٌ غائبة كُتبت صفراً');
});

test('الحجب بالغياب: من لا يقرأ الكلفة لا تصله سطورُها في الوسم', async () => {
  const h = await render(NOCOST, {});
  const data = pack(h, 'cc-data');
  const ids = data.lines.map((l) => l.id);
  for (const k of ['sal', 'con', 'ctr', 'lic', 'rent', 'oth', 'cor', 'gp']) {
    assert.ok(!ids.includes(k), `سطر الكلفة «${k}» وصل إلى من لا يقرؤها`);
  }
  assert.ok(ids.includes('rev'), 'سطر الإيراد غاب عمّن يقرؤه');
  assert.ok(data.notes.includes('costs_hidden'), 'الحمولة لا تقول إن الكلفة محجوبة');
  assert.equal(data.recon, undefined, 'مطابقةُ الكلفة وصلت إلى من لا يقرؤها');
  assert.ok(!JSON.stringify(data).includes('margin_pct'), 'الهامش وصل إلى من لا يقرؤه');
  assert.ok(!h.includes('رواتب التشغيل'), 'سطر الرواتب صُيِّر لمن لا يقرأ الكلفة');
});

test('من نطاقه دون القطاع يبقى على «قطاعي»', async () => {
  assert.equal(sectorViewMode(MEMBER).mode, 'personal');
  const h = await render(MEMBER, {});
  assert.ok(h.includes('<title>قطاعي'), 'الوجه الشخصي لم يُعرض');
  assert.ok(!h.includes('id="cc-data"'), 'حمولة مركز القطاع سُلِّمت لمن لا يقودها');
});

test('نطاق الشركة: المحوّل يعمل و?sector= يفتح القطاع المطلوب', async () => {
  assert.equal(sectorViewMode(BOSS).mode, 'command');
  const h = await render(BOSS, { sector: 'CON' });
  assert.equal(pack(h, 'cc-data').meta.sector.id, 'CON', '?sector= لم يفتح القطاع المطلوب');
  assert.ok(h.includes('sector=CON'), 'محوّل القطاع غائب عمّن نطاقه الشركة');
  // وبلا طلبٍ: أول قطاعات التسليم (لا قطاع مكتوب في الشيفرة)
  assert.equal(pack(await render(BOSS, {}), 'cc-data').meta.sector.id, 'SOL');
});

test('قطاعٌ خارج نطاق القارئ يُردّ صراحةً لا يُقصّ صامتاً', async () => {
  await assert.rejects(() => render(LEAD, { sector: 'CON' }), (e) => e.status === 403,
    'قطاعٌ أجنبيّ لم يُردّ بالرفض');
  // ولمن نطاقه قطاعُه: اسمٌ لا وجود له يُردّ بالرفض نفسه — فلا يفرّق الجوابُ بين «غير موجود»
  // و«موجودٌ وليس لك»، ولا يصير تخمينُ المعرّفات كشفاً.
  await assert.rejects(() => render(LEAD, { sector: 'لا-وجود-له' }), (e) => e.status === 403,
    'اسمٌ لا وجود له فُرِّق عن قطاعٍ خارج النطاق');
  await assert.rejects(() => render(BOSS, { sector: 'لا-وجود-له' }), (e) => e.status === 404,
    'ومن نطاقه الشركة: رابطٌ مكسور يُقال إنه مكسور');
  // ومحوّل القطاع لا يُعرض لمن لا نطاق له عليه
  assert.ok(!(await render(LEAD, {})).includes('&sector=SOL'), 'المحوّل ظهر لقائد قطاع');
});

test('الشاشة لا تُخزَّن: ترويسة «خاصّ ولا يُخزَّن» على `/app/sector` كما على ورقتها وملفّها', async () => {
  // الصفحة تزرع في وسمها حمولةً مالية مرشَّحةً بصلاحية قارئها بعينه — فنسخةٌ منها في ذاكرة
  // وسيطٍ أو في قرص المتصفّح تُقرأ عند من يفتح الجهاز بعده.
  const r = await http(`/app/sector?year=${YEAR}`, 'lead');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.ok(r.text.includes('id="cc-data"'), 'الصفحة المُسلَّمة ليست مركز القطاع');
});
