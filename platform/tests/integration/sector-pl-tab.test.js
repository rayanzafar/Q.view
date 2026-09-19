// ── فصل «قائمة الدخل» على مركز القطاع ────────────────────────────────────────────────────
// ما يحرسه هذا الفحص بترتيب أهميته:
//   ١) **الفصل في موضعه**: ثانياً بعد «الإيقاع» — ترتيبُ الألسنة قرارُ قراءةٍ لا تفصيلٌ تجميلي،
//      والفصل الافتراضي يبقى «الإيقاع» كما كان.
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
await (await import('../../src/core/rbac/index.js')).initRbac();
const { sectorPage } = await import('../../src/web/views/sector.js');

const T = '2026-01-05T00:00:00Z';
// سنةٌ ماضية عمداً: لا تعلّق لأرقام الفحص بشهر تشغيله.
const YEAR = new Date().getUTCFullYear() - 1;
const person = (id, username, role, scope) => ({ id, username, role_id: role, scope, sector_id: 'SOL',
  projectIds: new Set(), teamIds: new Set() });
const LEAD = person('u_lead', 'lead', 'sector_lead', 'sector');
const NOCOST = person('u_nocost', 'nocost', 't_plscreen', 'sector');

before(async () => {
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1,
    target_revenue_halalas: 100_000_000, target_sales_halalas: 100_000_000, created_at: T });
  for (const u of [LEAD, NOCOST]) {
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

const PANEL_ORDER = ['pulse', 'pl', 'com', 'ops', 'cli', 'hr', 'next'];
const plPanel = (html) => {
  const from = html.indexOf('id="sec-panel-pl"');
  assert.ok(from > 0, 'لوحة فصل قائمة الدخل غائبة');
  return html.slice(from, html.indexOf('id="sec-panel-com"'));
};
const render = (user, opts) => sectorPage(user, { year: String(YEAR), ...opts });

const NINE = ['الإيراد', 'رواتب التشغيل', 'أتعاب المستشارين', 'مصاريف التعاقد', 'التراخيص',
  'الإيجار', 'مصاريف تشغيلية أخرى', 'تكلفة الإيراد', 'مجمل الربح (الخسارة)'];

test('«قائمة الدخل» هي اللسان الثاني، والفصل الافتراضي لم يتغيّر', async () => {
  const h = await render(LEAD, {});
  const order = [...h.matchAll(/id="sec-tab-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, PANEL_ORDER, 'ترتيب الألسنة تغيّر');
  assert.equal(order[1], 'pl', '«قائمة الدخل» ليست اللسان الثاني');
  assert.ok(h.includes('id="sec-tab-pl"'), 'لسان قائمة الدخل غائب');
  // الفصل الافتراضي «الإيقاع»: لوحته ظاهرة ولوحة قائمة الدخل مخفيّة
  assert.match(h, /id="sec-panel-pulse"[^>]*class="tabpanel"(?!\s*hidden)/, 'الفصل الافتراضي لم يعد «الإيقاع»');
  assert.match(plPanel(h), /class="tabpanel" hidden/, 'لوحة قائمة الدخل ظاهرة بلا اختيارها');
  // ولا حسابَ لفصلٍ لم يُفتح: الجدول لا يُصيَّر أصلاً
  assert.ok(!plPanel(h).includes('رواتب التشغيل'), 'جدول قائمة الدخل صُيِّر بلا فتح فصله');
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

test('خطةُ إيرادٍ غير مسجَّلة: تُقال ومعها بابُ تسجيلها — ولا تُقال تحت الترشيح', async () => {
  const p = plPanel(await render(LEAD, { tab: 'pl' }));
  assert.equal(p.split('لا مستهدف مسجَّل لهذا القطاع في هذه السنة').length - 1, 1,
    'ملاحظة غياب الخطة غائبة أو مكرَّرة');
  assert.ok(p.includes('/app/sector-targets?'), 'رابط مستهدفات القطاع غائب عمّن يفتحها');
  const scoped = plPanel(await render(LEAD, { tab: 'pl', project: 'P_AI' }));
  assert.ok(!scoped.includes('/app/sector-targets?'), 'رابط المستهدفات ظهر تحت ترشيحٍ خطتُه قطاعية');
});
