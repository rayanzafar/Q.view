// ── فصل «قائمة الدخل» على مركز القطاع ────────────────────────────────────────────────────
// ما يحرسه هذا الفحص بترتيب أهميته:
//   ١) **الفصل في موضعه**: أولاً وافتراضاً (تعليمة المالك 2026-09-20) — ترتيبُ الألسنة قرارُ
//      قراءةٍ لا تفصيلٌ تجميلي، والمركز يفتح على «أين الربح؟».
//   ٢) **الأرقام أرقامُ المرشِّحات**: الفترة والمشروع يقصّان الإيراد المعروض، والملفُّ والورقة
//      يخرجان بالمرشِّحات نفسها حرفاً — وإلا قرأ القارئ شاشةً وطبع أخرى.
//   ٣) **ما لم يُدخَل يُقال ولا يُختلق**: الكلفة «لم يُسجَّل» لا صفراً، وشريطٌ واحد فوق كتلتها
//      حين تخلو كلُّها، وخطةُ إيرادٍ غائبةٌ تُقال ومعها بابُ تسجيلها.
//   ٤) **بوابة الكلفة تحذف سطورها من الشاشة** كما تحذفها من الملفّ: من لا يراها لا يجدها فارغة.
//   ٥) **لا قيمة خام في وجه القارئ**: لا «undefined» ولا «NaN» ولا فراغ برمجي في أي خلية.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-pltab-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const db = await import('../../src/core/db/index.js');
// دورٌ اختباري يقرأ المشاريع والإيراد والمستهدف بلا بابَي الكلفة والهامش — لا توليفةَ كهذه في
// المصفوفة، وبناؤها في القاعدة أصدق من تزوير قرار المحرّك.
await db.run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_plscreen','قارئ قائمة الدخل','PL Screen Reader',0,'2026-01-01T00:00:00.000Z')");
for (const [res, act] of [['revenue_line', 'read'], ['budget', 'read'], ['project', 'read'],
  ['opportunity', 'read'], ['report', 'read'], ['kpi', 'read']]) {
  await db.run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_plscreen', res, act, 'sector']);
}
// ودورٌ ثانٍ لا يقرأ الإيراد أصلاً: الفصل صار يُصيَّر مع كل تحميل، فلا بدّ أن يُخرج حالتَه
// المصمَّمة لمن لا يملكه — لا أن يُسقط الشاشة كلها في وجهه.
await db.run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_norev','قارئ بلا إيراد','No Revenue Reader',0,'2026-01-01T00:00:00.000Z')");
for (const [res, act] of [['project', 'read'], ['opportunity', 'read'], ['kpi', 'read']]) {
  await db.run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_norev', res, act, 'sector']);
}
await (await import('../../src/core/rbac/index.js')).initRbac();
const { sectorPage } = await import('../../src/web/views/sector.js');

const T = '2026-01-05T00:00:00Z';
// سنةٌ ماضية عمداً: لا تعلّق لأرقام الفحص بشهر تشغيله.
const YEAR = new Date().getUTCFullYear() - 1;
const person = (id, username, role, scope) => ({ id, username, role_id: role, scope, sector_id: 'SOL',
  projectIds: new Set(), teamIds: new Set() });
const LEAD = person('u_lead', 'lead', 'sector_lead', 'sector');
const NOCOST = person('u_nocost', 'nocost', 't_plscreen', 'sector');
const NOREV = person('u_norev', 'norev', 't_norev', 'sector');

before(async () => {
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1,
    target_revenue_halalas: 100_000_000, target_sales_halalas: 100_000_000, created_at: T });
  for (const u of [LEAD, NOCOST, NOREV]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.username, role_id: u.role_id,
      sector_id: 'SOL', scope: u.scope, active: 1, created_at: T });
  }
  await db.insert('department', { id: 'D_AI', name_ar: 'إدارة الذكاء الاصطناعي', sector_id: 'SOL', created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await db.insert('client', { id: 'CL_A', name_ar: 'جهة ألف', created_at: T });
  await db.insert('project', { id: 'P_AI', name_ar: 'مشروع الذكاء', sector_id: 'SOL', status: 'IN_PROGRESS',
    rag: 'GREEN', start_date: `${YEAR}-01-15`, department_id: 'D_AI', client_id: 'CL_A', created_at: T });
  await db.insert('project', { id: 'P_CITY', name_ar: 'مشروع المدن', sector_id: 'SOL', status: 'IN_PROGRESS',
    rag: 'GREEN', start_date: `${YEAR}-01-15`, client_id: 'CL_A', created_at: T });
  // إيرادٌ صافٍ مميَّز لكل مشروع وشهر: فبراير 4,000,000 لمشروع الذكاء، ومايو 2,000,000 للمدن.
  await db.insert('revenue_line', { id: 'RL_AI', sector_id: 'SOL', project_id: 'P_AI', year: YEAR, month: 2,
    amount_halalas: 4_600_000_00, net_amount_halalas: 4_000_000_00, created_at: T });
  await db.insert('revenue_line', { id: 'RL_CITY', sector_id: 'SOL', project_id: 'P_CITY', year: YEAR, month: 5,
    amount_halalas: 2_300_000_00, net_amount_halalas: 2_000_000_00, created_at: T });
  // لا صفَّ مستهدفٍ في جدول الموازنة عمداً: حالة «لا خطة» جزءٌ من المفحوص.
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const TAB_ORDER = ['pl', 'pulse', 'com', 'ops', 'cli', 'hr', 'next'];
const plPanel = (html) => {
  const from = html.indexOf('id="sec-panel-pl"');
  assert.ok(from > 0, 'لوحة فصل قائمة الدخل غائبة');
  return html.slice(from, html.indexOf('id="sec-panel-com"'));
};
const render = (user, opts) => sectorPage(user, { year: String(YEAR), ...opts });

const NINE = ['الإيراد', 'رواتب التشغيل', 'أتعاب المستشارين', 'مصاريف التعاقد', 'التراخيص',
  'الإيجار', 'مصاريف تشغيلية أخرى', 'تكلفة الإيراد', 'مجمل الربح (الخسارة)'];

test('«قائمة الدخل» هي اللسان الأول والفصل الافتراضي', async () => {
  const h = await render(LEAD, {});
  const order = [...h.matchAll(/id="sec-tab-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, TAB_ORDER, 'ترتيب الألسنة تغيّر');
  assert.equal(order[0], 'pl', '«قائمة الدخل» ليست اللسان الأول');
  // الهبوط بلا لسانٍ في العنوان: لوحةُ قائمة الدخل ظاهرةٌ محسوبةً، ولوحةُ «الإيقاع» مخفيّة
  assert.match(plPanel(h), /class="tabpanel">/, 'لوحة قائمة الدخل مخفيّة عند الهبوط');
  assert.ok(plPanel(h).includes('رواتب التشغيل'), 'جدول قائمة الدخل لم يُصيَّر عند الهبوط');
  assert.match(h, /id="sec-panel-pulse"[^>]*class="tabpanel" hidden/, 'لوحة «الإيقاع» ظاهرة بلا اختيارها');
});

test('لا نموذجَ خفيّاً يفتح الفصل: لسانُه زرُّ تبديلٍ كإخوته', async () => {
  const h = await render(LEAD, {});
  assert.ok(!h.includes('pl-tab-form'), 'النموذج الخفيّ لفتح الفصل بقي في الصفحة');
  assert.ok(!h.includes('اعرض قائمة الدخل'), 'حالةُ «افتح الفصل» البديلة بقيت');
  const btn = /<button[^>]*id="sec-tab-pl"[^>]*>/.exec(h);
  assert.ok(btn, 'زرّ لسان قائمة الدخل غائب');
  assert.match(btn[0], /type="button"/, 'زرّ اللسان ما زال زرّ إرسال');
  assert.match(btn[0], /data-action="sec-tab"/, 'زرّ اللسان لا يبدّل في المتصفح كإخوته');
});

test('ألسنةُ الروابط العميقة تبقى تعمل: tab=pulse وtab=com', async () => {
  for (const k of ['pulse', 'com', 'ops', 'cli', 'hr', 'next']) {
    const h = await render(LEAD, { tab: k });
    assert.match(h, new RegExp(`id="sec-panel-${k}"[^>]*class="tabpanel">`), `الرابط العميق ?tab=${k} لم يفتح فصله`);
    assert.match(h, /id="sec-panel-pl"[^>]*class="tabpanel" hidden/, `فصل قائمة الدخل بقي ظاهراً مع ?tab=${k}`);
  }
  // ولسانٌ مجهول يسقط إلى الافتراضي لا إلى صفحة خطأ
  const bad = await render(LEAD, { tab: 'لا-وجود-له' });
  assert.match(plPanel(bad), /class="tabpanel">/, 'لسانٌ مجهول لم يسقط إلى الفصل الافتراضي');
});

test('فتحُ الفصل يعرض السطور التسعة ونسبة مجمل الربح لقائد القطاع', async () => {
  const p = plPanel(await render(LEAD, { tab: 'pl' }));
  for (const label of NINE) assert.ok(p.includes(label), `${label} غائب عن الجدول`);
  assert.ok(p.includes('نسبة مجمل الربح'), 'سطر نسبة مجمل الربح غائب');
  assert.ok(p.includes('الإيراد ما تحقق من عمل مُنجَز'), 'جملة الفرق بين الإيراد والمبيعات غائبة');
  assert.ok(p.includes('بالريال السعودي · الأرقام بين قوسين تكاليف'), 'سطر وحدة القياس غائب');
});

test('الكلفة غير المُدخَلة تُقال «لم يُسجَّل» لا صفراً — وشريطٌ واحد فوق كتلتها', async () => {
  const p = plPanel(await render(LEAD, { tab: 'pl' }));
  assert.ok(p.includes('لم يُسجَّل'), 'الخلايا الفارغة لا تقول «لم يُسجَّل»');
  assert.ok(!/>\(?0 ر\.س\)?</.test(p), 'كلفةٌ فارغة كُتبت صفراً');
  // وبالفعل نفسه الذي في الخلايا («لم يُسجَّل») — حالةٌ واحدة لا حالتان.
  const strips = p.split('لم تُسجَّل تكاليف القطاع بعد').length - 1;
  assert.equal(strips, 1, 'شريط «لم تُسجَّل التكاليف» غائب أو مكرَّر');
  assert.ok(!p.includes('لم تُدخل تكاليف'), 'فعلٌ ثانٍ للحالة نفسها بقي في الشريط');
});

test('«نسبة مجمل الربح» بلا مصطلحٍ إنجليزي مخترَع على الشاشة', async () => {
  const p = plPanel(await render(LEAD, { tab: 'pl' }));
  assert.ok(p.includes('نسبة مجمل الربح'), 'سطر النسبة غائب');
  assert.ok(!p.includes('Gross Profit %'), 'مصطلحٌ إنجليزي مخترَع بقي في الجدول');
  // وبقية السطور تحتفظ بمصطلحاتها المتَّفق عليها
  assert.ok(p.includes('Gross Profit (Loss)'), 'المصطلح المتَّفق عليه لسطر النتيجة سقط');
});

test('لا قيمة خام في وجه القارئ داخل الفصل', async () => {
  for (const opts of [{ tab: 'pl' }, { tab: 'pl', p: 'ytd' }, { tab: 'pl', p: 'm3-m8' }, { tab: 'pl', project: 'P_AI' }]) {
    const p = plPanel(await render(LEAD, opts));
    assert.ok(!/undefined|NaN|\[object|>null<|&gt;null&lt;/.test(p), `قيمة خام في ${JSON.stringify(opts)}`);
  }
});

test('الفترة تقصّ الإيراد المعروض: السنة كاملةً ٦ ملايين، ومن مارس إلى أغسطس مليونان', async () => {
  const full = plPanel(await render(LEAD, { tab: 'pl' }));
  assert.ok(full.includes('6,000,000'), 'إيراد السنة كاملةً غائب');
  const ytd = plPanel(await render(LEAD, { tab: 'pl', p: 'ytd' }));
  assert.ok(ytd.includes('6,000,000'), '«من بداية السنة» لا تجمع الشهرين');
  const range = plPanel(await render(LEAD, { tab: 'pl', p: 'm3-m8' }));
  assert.ok(range.includes('2,000,000'), 'إيراد مايو غائب عن مدى مارس–أغسطس');
  assert.ok(!range.includes('6,000,000'), 'إيراد فبراير تسرّب إلى مدى لا يضمّه');
});

test('ترشيحٌ بمشروع: إيرادُه وحده، والخطة تُعلَن أنها للقطاع كله', async () => {
  const p = plPanel(await render(LEAD, { tab: 'pl', project: 'P_AI' }));
  assert.ok(p.includes('4,000,000'), 'إيراد المشروع المرشَّح غائب');
  assert.ok(!p.includes('6,000,000'), 'إيراد القطاع كله تسرّب إلى ترشيح المشروع');
  assert.ok(p.includes('الخطة على مستوى القطاع كله'), 'ملاحظة أن الخطة للقطاع كله غائبة');
});

test('رابطا الملفّ والورقة يحملان المرشِّحات نفسها حرفاً', async () => {
  const p = plPanel(await render(LEAD, { tab: 'pl', p: 'm3-m8', project: 'P_AI', dept: 'D_AI' }));
  const xlsx = p.match(/href="(\/api\/sectors\/SOL\/income-statement\.xlsx\?[^"]+)"/);
  const sheet = p.match(/href="(\/app\/sector\/income-statement\?[^"]+)"/);
  assert.ok(xlsx, 'رابط تنزيل الملفّ غائب عمّن يملك التصدير');
  assert.ok(sheet, 'رابط نسخة الطباعة غائب');
  for (const href of [xlsx[1], sheet[1]]) {
    for (const bit of [`year=${YEAR}`, 'p=m3-m8', 'project=P_AI', 'dept=D_AI']) {
      assert.ok(href.includes(bit), `${bit} غائب عن ${href}`);
    }
  }
});

test('من لا يملك باب الكلفة يرى سطر الإيراد وحده — ولا رابط تصدير', async () => {
  const p = plPanel(await render(NOCOST, { tab: 'pl' }));
  assert.ok(p.includes('الإيراد'), 'سطر الإيراد غائب عمّن يملك قراءته');
  for (const hidden of ['رواتب التشغيل', 'أتعاب المستشارين', 'تكلفة الإيراد', 'مجمل الربح']) {
    assert.ok(!p.includes(hidden), `${hidden} تسرّب إلى من لا يملك باب الكلفة`);
  }
  assert.ok(!p.includes('لم تُسجَّل تكاليف القطاع بعد'), 'شريط الكلفة ظهر لمن لا سطورَ كلفةٍ لديه');
  assert.ok(!p.includes('income-statement.xlsx'), 'رابط التصدير ظهر لمن لا يملك تصدير التقارير');
  assert.ok(p.includes('/app/sector/income-statement?'), 'رابط نسخة الطباعة غائب');
});

// ── الفصل صار افتراضياً، فتعثُّره لا يجوز أن يُسقط الشاشة ────────────────────────────────
test('من لا يقرأ الإيراد أصلاً يحصل على صفحةٍ كاملة وحالةِ «خارج صلاحياتك» في لوحته', async () => {
  const h = await render(NOREV, { tab: 'pl' });
  assert.ok(h.length > 5000, 'الصفحة لم تُصيَّر لمن لا يقرأ الإيراد');
  const p = plPanel(h);
  assert.ok(p.includes('قائمة الدخل خارج صلاحياتك'), 'حالة «خارج الصلاحيات» غائبة عن لوحة الفصل');
  assert.ok(!p.includes('الإيراد ما تحقق'), 'جدول القائمة صُيِّر لمن لا يقرأ الإيراد');
  assert.ok(!/undefined|NaN|\[object/.test(p), 'قيمة خام في حالة غياب الصلاحية');
  // وبقية الشاشة سليمةٌ حوله: الألسنة كلها في مكانها
  const order = [...h.matchAll(/id="sec-tab-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, TAB_ORDER, 'شريط الألسنة اختلّ حين تعذّرت قائمة الدخل');
});

// ── الهبوط الافتراضي يتبع القارئ، والترتيب لا يتبعه ──────────────────────────────────────
// أن تكون «قائمة الدخل» أول الألسنة قرارُ خريطةٍ للشاشة، وأن تكون أول ما يُفتَح قرارٌ لهذا
// القارئ بعينه: من لا سطرَ إيرادٍ له فيها يهبط على لوحةٍ لا شيء فيها إلا «خارج صلاحياتك» —
// شاشةٌ كاملة يُستقبَل صاحبها بالمنع وحده. فالهبوط يقع على «الإيقاع»، والترتيبُ كما هو.
test('بلا لسانٍ في العنوان: من لا يقرأ الإيراد يهبط على «الإيقاع»، والترتيب pl أولاً للجميع', async () => {
  const h = await render(NOREV, {});
  const order = [...h.matchAll(/id="sec-tab-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, TAB_ORDER, 'ترتيب الألسنة تغيّر بتغيّر القارئ');
  assert.equal(order[0], 'pl', '«قائمة الدخل» لم تعد أول الألسنة لمن لا يقرأ الإيراد');
  assert.match(h, /id="sec-panel-pulse"[^>]*class="tabpanel">/, 'الهبوط لم يقع على «الإيقاع»');
  assert.match(plPanel(h), /class="tabpanel" hidden/, 'لوحة «خارج صلاحياتك» فُتحت على القارئ');
  // ولسانٌ صريح في العنوان يُحترم كما كُتب: من طلب `?tab=pl` يرى الحالة المصمَّمة لا تحويلاً
  const explicit = plPanel(await render(NOREV, { tab: 'pl' }));
  assert.match(explicit, /class="tabpanel">/, '?tab=pl الصريح حُوِّل صامتاً');
  assert.ok(explicit.includes('قائمة الدخل خارج صلاحياتك'), 'الحالة المصمَّمة غائبة عن اللسان الصريح');
  // ومن يقرأ الإيراد يبقى هبوطه على «قائمة الدخل» كما هو
  const lead = await render(LEAD, {});
  assert.match(plPanel(lead), /class="tabpanel">/, 'هبوط قارئ الإيراد تحوّل عن قائمة الدخل');
  assert.match(lead, /id="sec-panel-pulse"[^>]*class="tabpanel" hidden/, '«الإيقاع» فُتحت لقارئ الإيراد');
});

test('خطةُ إيرادٍ غير مسجَّلة: تُقال ومعها بابُ تسجيلها — ولا تُقال تحت الترشيح', async () => {
  const p = plPanel(await render(LEAD, { tab: 'pl' }));
  assert.equal(p.split('لا مستهدف مسجَّل لهذا القطاع في هذه السنة').length - 1, 1,
    'ملاحظة غياب الخطة غائبة أو مكرَّرة');
  assert.ok(p.includes('/app/sector-targets?'), 'رابط مستهدفات القطاع غائب عمّن يفتحها');
  const scoped = plPanel(await render(LEAD, { tab: 'pl', project: 'P_AI' }));
  assert.ok(!scoped.includes('/app/sector-targets?'), 'رابط المستهدفات ظهر تحت ترشيحٍ خطتُه قطاعية');
});
