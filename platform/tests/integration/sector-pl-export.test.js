// قائمة دخل القطاع — مخرجاها خارج الشاشة: ملفُّ Excel وورقة الطباعة.
//
// ما يحرسه هذا الملف بترتيب أهميته:
//   ١) **الباب قبل الملف**: قائدُ قطاعٍ يصدّر قطاعه، وقائدُ قطاعٍ آخر يُردّ ٤٠٣ — لا ملفَّ
//      مالٍ يخرج بعنوانٍ محرَّر. ومن يصدّر يترك أثراً في سجل النظام.
//   ٢) **بوابة الكلفة تحذف سطورها من الملفّ** كما تحذفها من الشاشة: من لا يراها لا يجدها
//      فارغةً في ملفّه، ولا يجد «مجمل الربح» ولا نسبته.
//   ٣) **الفارغ يُقال «لم يُسجَّل»** على الورقة، لا صفراً — والصفر في سطر كلفةٍ يُنتج مجمل
//      ربحٍ يساوي الإيراد كاملاً.
//   ٤) **المرشِّحات تُقرأ من العنوان فعلاً**: الفترة (`p=ytd` مقابل `p=m1`) والمشروع.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-plexp-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
// دورٌ اختباري يقرأ الإيراد والمستهدف ويصدّر التقارير، بلا بابَي الكلفة والهامش — لا يوجد في
// المصفوفة دورٌ بهذه التوليفة، وبناؤه في القاعدة أصدق من تزوير قرار المحرّك.
await db.run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_plreader','قارئ قائمة الدخل','PL Reader',0,'2026-01-01T00:00:00.000Z')");
for (const [res, act] of [['revenue_line', 'read'], ['budget', 'read'], ['project', 'read'], ['report', 'export']]) {
  await db.run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_plreader', res, act, 'sector']);
}
await (await import('../../src/core/rbac/index.js')).initRbac();
const { parseWorkbook } = await import('../../src/modules/io/xlsx.js');

const T = '2026-01-10T08:00:00.000Z';
// سنةٌ ماضية عمداً: «من بداية السنة» فيها السنةُ كاملة بلا تعلّقٍ بشهر تشغيل الاختبار.
const YR = new Date().getUTCFullYear() - 1;
let server, base;

const person = (id, username, role, sector, scope) => ({ id, username, role_id: role, sector_id: sector, scope });
const LEAD = person('u_lead', 'lead', 'sector_lead', 'S1', 'sector');
const OTHER = person('u_other', 'other', 'sector_lead', 'S2', 'sector');
const READER = person('u_reader', 'reader', 't_plreader', 'S1', 'sector');
// من تصرفهما شاشة القطاع إلى وجهها الشخصي: استشاريٌّ نطاقه مشاريعه، ومستخدمٌ خارجي نطاقه نفسه.
const CONSULT = person('u_cons', 'cons', 'consultant', 'S1', 'project');
const EXTERN = person('u_ext', 'ext', 'external', 'S1', 'own');

async function http(path, as) {
  const r = await fetch(base + path, {
    headers: { cookie: `sanad_sid=sess_${as}; sanad_csrf=t` }, redirect: 'manual',
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, headers: r.headers, buf, text: buf.toString('utf8') };
}
const sheetOf = (buf) => parseWorkbook(buf, 'x.xlsx');
const firstCol = (wb) => [wb.headers[0], ...wb.rows.map((r) => r[0])];

before(async () => {
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع الاستشارات', active: 1, sort_order: 2, created_at: T });
  for (const u of [LEAD, OTHER, READER, CONSULT, EXTERN]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.username, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
    await db.insert('session', { id: 'sess_' + u.username, user_id: u.id, created_at: T,
      expires_at: new Date(Date.now() + 86400000).toISOString() });
  }
  await db.insert('client', { id: 'C1', name_ar: 'جهة ألف', created_at: T });
  // عميلٌ ثانٍ لمشروع باء: قصُّ الورقة على عميلين معاً يحتاج عميلين اثنين.
  await db.insert('client', { id: 'C2', name_ar: 'جهة باء', created_at: T });
  await db.insert('department', { id: 'D1', name_ar: 'إدارة الدال', sector_id: 'S1', created_at: T });
  await db.insert('project', { id: 'P1', name_ar: 'مشروع ألف', sector_id: 'S1', client_id: 'C1', status: 'IN_PROGRESS', created_at: T });
  await db.insert('project', { id: 'P2', name_ar: 'مشروع باء', sector_id: 'S1', client_id: 'C2', status: 'IN_PROGRESS', created_at: T });
  // مشروعٌ خارج عدسة السنة المعروضة: مدّتُه في سنةٍ سابقة ولا بندَ إيرادٍ له في هذه السنة —
  // فصفحة القطاع لا تعرضه في قائمة مشاريعها، ولا يجوز أن يقصّ به ملفٌّ ولا ورقة.
  await db.insert('project', { id: 'P_OLD', name_ar: 'مشروع الجيم القديم', sector_id: 'S1', client_id: 'C1',
    status: 'DONE', start_date: `${YR - 2}-01-01`, end_date: `${YR - 2}-12-31`, created_at: T });
  // إيرادٌ صافٍ مميَّز لكل شهر كي يُقرأ أثرُ المرشِّح في نصّ الورقة: يناير 1,111 وفبراير 2,222
  await db.insert('revenue_line', { id: 'RL1', sector_id: 'S1', project_id: 'P1', year: YR, month: 1,
    amount_halalas: 127_765, net_amount_halalas: 111_100, created_at: T });
  await db.insert('revenue_line', { id: 'RL2', sector_id: 'S1', project_id: 'P2', year: YR, month: 2,
    amount_halalas: 255_530, net_amount_halalas: 222_200, created_at: T });
  await db.insert('budget', { id: 'B1', sector_id: 'S1', fiscal_year: YR, target_revenue_halalas: 1_200_000,
    target_sales_halalas: 0, created_at: T });

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

// ── ١) الملفّ وبابه ───────────────────────────────────────────────────────────
test('قائد القطاع ينزّل ملفَّ قائمة الدخل — بايتاتُه ملفُّ Excel وترويساته ترويسات تنزيل', async () => {
  const r = await http(`/api/sectors/S1/income-statement.xlsx?year=${YR}`, 'lead');
  assert.equal(r.status, 200);
  assert.match(String(r.headers.get('content-type')), /spreadsheetml\.sheet/);
  assert.match(String(r.headers.get('content-disposition')), /attachment; filename="sector-S1-income-statement\.xlsx"/);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.buf[0], 0x50, 'أول بايت ليس توقيع ملفّ Excel');
  assert.equal(r.buf[1], 0x4b);

  const wb = sheetOf(r.buf);
  const col = firstCol(wb).join('\n');
  for (const label of ['الإيراد', 'رواتب التشغيل', 'تكلفة الإيراد', 'مجمل الربح', 'نسبة مجمل الربح']) {
    assert.ok(col.includes(label), `${label} غائب عن الملفّ`);
  }
  assert.ok(col.includes('قطاع الحلول'), 'اسم القطاع غائب عن رأس الملفّ');
  assert.ok(col.includes(String(YR)), 'سنة الفترة غائبة عن رأس الملفّ');
  // الإيراد بالريال عدداً لا نصّاً ولا هللةً: يناير وفبراير معاً = 3,333
  const rev = wb.rows.find((x) => x[0] === 'الإيراد');
  assert.equal(rev[5], '3333', 'الفعلي يجب أن يكون بالريال عدداً');
});

test('قائد قطاعٍ آخر يُردّ عن قائمة دخل قطاعٍ ليس قطاعه', async () => {
  const r = await http(`/api/sectors/S1/income-statement.xlsx?year=${YR}`, 'other');
  assert.equal(r.status, 403);
});

test('كل تصديرٍ ناجح يترك أثره في سجل النظام', async () => {
  const before = await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'export' AND resource = 'report'");
  await http(`/api/sectors/S1/income-statement.xlsx?year=${YR}&p=m1`, 'lead');
  const row = await db.get(`SELECT user_id, sector_id, resource_id, detail_json FROM audit_log
     WHERE action = 'export' AND resource = 'report' ORDER BY at DESC, id DESC LIMIT 1`);
  const after_ = await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'export' AND resource = 'report'");
  assert.equal(after_.n, before.n + 1, 'لم يُسجَّل أثرُ التصدير');
  assert.equal(row.user_id, 'u_lead');
  assert.equal(row.sector_id, 'S1');
  assert.equal(row.resource_id, 'income-statement:S1');
  assert.match(String(row.detail_json || ''), /m1/);
});

// ── ٢) بوابة الكلفة ──────────────────────────────────────────────────────────
test('من لا يملك باب الكلفة ينزّل ملفاً بلا سطور الكلفة ولا مجمل الربح', async () => {
  const r = await http(`/api/sectors/S1/income-statement.xlsx?year=${YR}`, 'reader');
  assert.equal(r.status, 200);
  const col = firstCol(sheetOf(r.buf)).join('\n');
  assert.ok(col.includes('الإيراد'), 'سطر الإيراد غائب عمّن يملك قراءته');
  for (const hidden of ['رواتب التشغيل', 'أتعاب المستشارين', 'تكلفة الإيراد', 'مجمل الربح', 'نسبة مجمل الربح']) {
    assert.ok(!col.includes(hidden), `${hidden} تسرّب إلى ملفِّ من لا يملك باب الكلفة`);
  }
});

// ── ٣) ورقة الطباعة ──────────────────────────────────────────────────────────
test('ورقة الطباعة تعرض السطور التسعة، والكلفة فيها «لم يُسجَّل» لا صفراً', async () => {
  const r = await http(`/app/sector/income-statement?year=${YR}`, 'lead');
  assert.equal(r.status, 200);
  for (const label of ['الإيراد', 'رواتب التشغيل', 'أتعاب المستشارين', 'مصاريف التعاقد',
    'التراخيص', 'الإيجار', 'مصاريف تشغيلية أخرى', 'تكلفة الإيراد', 'مجمل الربح']) {
    assert.ok(r.text.includes(label), `${label} غائب عن الورقة`);
  }
  assert.ok(r.text.includes('قائمة الدخل — قطاع الحلول'), 'عنوان الورقة ليس باسم القطاع');
  assert.ok(r.text.includes('لم يُسجَّل'), 'الكلفة الفارغة لا تُقال «لم يُسجَّل»');
  assert.ok(!/>0 ر\.س/.test(r.text), 'كلفةٌ فارغة كُتبت صفراً');
  // الإيراد ليس المبيعات — جملةٌ حاضرة دائماً
  assert.ok(r.text.includes('الإيراد ما تحقق من عمل مُنجَز'), 'جملة الفرق بين الإيراد والمبيعات غائبة');
  // زرّ الطباعة موجود ومخفيٌّ عند الطباعة
  assert.ok(r.text.includes('data-action="dc-print"'), 'زرّ الطباعة غائب');
  assert.match(r.text, /@media print\{[\s\S]*\.tools\{display:none\}/);
});

test('ورقة الطباعة تقرأ الفترة من العنوان: «من بداية السنة» تضمّ الشهرين، ويناير وحده لا', async () => {
  const ytd = await http(`/app/sector/income-statement?year=${YR}&p=ytd`, 'lead');
  assert.equal(ytd.status, 200);
  // سنةٌ منقضية: «من بداية السنة» فيها هي السنةُ كاملةً — والاسم يقولها كما هي، فلا «حتى اليوم»
  // في سنةٍ لا يومَ جارياً فيها.
  assert.ok(ytd.text.includes('السنة كاملة'), 'اسم الفترة في سنةٍ منقضية ليس «السنة كاملة»');
  assert.ok(!ytd.text.includes('من بداية السنة'), '«من بداية السنة» بقيت اسماً لفترةٍ تغطي السنة كلها');
  assert.ok(ytd.text.includes('3,333'), 'الفترة الكاملة لا تجمع الشهرين');

  const jan = await http(`/app/sector/income-statement?year=${YR}&p=m1`, 'lead');
  assert.ok(jan.text.includes('يناير'), 'اسم الشهر المختار غائب');
  assert.ok(jan.text.includes('1,111'), 'إيراد يناير غائب عن فترة يناير');
  assert.ok(!jan.text.includes('3,333'), 'إيراد فبراير تسرّب إلى فترة يناير');
});

test('ترشيحٌ بمشروع: إيرادُه وحده، والخطة تُعلَن أنها للقطاع كله', async () => {
  const r = await http(`/app/sector/income-statement?year=${YR}&p=ytd&project=P2`, 'lead');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('مشروع باء'), 'اسم المشروع المُرشَّح غائب عن ترويسة الورقة');
  assert.ok(r.text.includes('2,222'), 'إيراد المشروع المُرشَّح غائب');
  assert.ok(!r.text.includes('1,111'), 'إيراد مشروعٍ آخر تسرّب إلى الترشيح');
  assert.ok(r.text.includes('الخطة على مستوى القطاع كله'), 'ملاحظة أن الخطة للقطاع كله غائبة');
});

test('قائمةٌ بفواصل: عميلان معاً يقصّان الورقة عليهما، ورأسُها يسمّيهما كليهما', async () => {
  // الشريط يكتب المختار قائمةً («client=c1,c2»)، فكانت الورقة والملفّ يقرآن أوّلَها وحده:
  // القارئ يختار عميلين ويطبع ورقةً تقول عميلاً واحداً.
  const both = await http(`/app/sector/income-statement?year=${YR}&p=y&client=C1,C2`, 'lead');
  assert.equal(both.status, 200);
  assert.ok(both.text.includes('جهة ألف') && both.text.includes('جهة باء'),
    'رأس الورقة لم يسمِّ العميلين المختارين');
  assert.ok(both.text.includes('3,333'), 'إيراد العميلين معاً لم يُجمع');

  const one = await http(`/app/sector/income-statement?year=${YR}&p=y&client=C2`, 'lead');
  assert.ok(one.text.includes('2,222') && !one.text.includes('3,333'), 'العميل الواحد لم يقصّ الورقة');

  // ومعرّفٌ لا وجود له داخل القائمة يسقط وحده ولا يُسقط رفيقه
  const mixed = await http(`/app/sector/income-statement?year=${YR}&p=y&client=C1,LA_WUJUD`, 'lead');
  assert.ok(mixed.text.includes('جهة ألف') && !mixed.text.includes('LA_WUJUD'));
  assert.ok(mixed.text.includes('1,111') && !mixed.text.includes('3,333'), 'المعرّف الساقط وسّع النطاق');

  // والملفّ يقرأ القائمة نفسها: رأسُه يسمّي العميلين وأرقامُه أرقامهما
  const xlsx = await http(`/api/sectors/S1/income-statement.xlsx?year=${YR}&p=y&client=C1,C2`, 'lead');
  assert.equal(xlsx.status, 200);
  const col = firstCol(sheetOf(xlsx.buf)).join('\n');
  assert.ok(col.includes('جهة ألف') && col.includes('جهة باء'), 'رأس الملفّ لم يسمِّ العميلين');
  const rev = sheetOf(xlsx.buf).rows.find((x) => x[0] === 'الإيراد');
  assert.equal(rev[5], '3333', 'الملفّ لم يجمع إيراد العميلين');
});

test('مشروعٌ من قطاعٍ آخر أو معرّفٌ لا وجود له: يُهمَل ولا يكسر الورقة', async () => {
  const r = await http(`/app/sector/income-statement?year=${YR}&project=P_LA_WUJUD&client=X&dept=Y`, 'lead');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('الإيراد'), 'الورقة لم تُبنَ بعد إهمال مرشِّحٍ لا وجود له');
  assert.ok(!r.text.includes('P_LA_WUJUD'), 'معرّفٌ محرَّر ظهر في الورقة');
});

// ── ٤) بابُ الورقة: من لا مركزَ قيادةٍ له لا ورقةَ ربحٍ له ────────────────────────────
// الورقة مسارٌ ثانٍ إلى الشاشة نفسها. فمن تصرفه `/app/sector` إلى وجهه الشخصي («قطاعي») يُردّ
// هنا كما يُردّ هناك — و**قبل** حلّ المرشِّحات، فلا يعود إليه اسمُ إدارةٍ أو عميلٍ أو مشروع.
test('الاستشاري والمستخدم الخارجي: الورقة خارج صلاحيتهما، وبلا أي اسمٍ مسرَّب', async () => {
  const SEEDED = ['قطاع الحلول', 'جهة ألف', 'إدارة الدال', 'مشروع ألف', 'مشروع باء', 'مشروع الجيم القديم'];
  for (const who of ['cons', 'ext']) {
    const r = await http(`/app/sector/income-statement?year=${YR}&dept=D1&client=C1&project=P1`, who);
    assert.equal(r.status, 403, `${who}: الورقة فُتحت لمن لا مركزَ قيادةٍ له`);
    assert.ok(r.text.includes('خارج صلاحياتك'), `${who}: الرفض ليس صفحة الرفض العربية`);
    for (const name of SEEDED) {
      assert.ok(!r.text.includes(name), `${who}: «${name}» تسرّب في جسم الرفض`);
    }
    assert.ok(!r.text.includes('الإيراد') && !r.text.includes('مجمل الربح'), `${who}: سطرٌ مالي في جسم الرفض`);
  }
});

test('قائد القطاع يفتح الورقة: ٢٠٠ وترويسة «لا يُخزَّن» كترويسة الملفّ', async () => {
  const r = await http(`/app/sector/income-statement?year=${YR}`, 'lead');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
});

test('كل فتحةِ ورقةٍ تترك أثرها في سجل النظام، موسومةً «طباعة»', async () => {
  const before = await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'export' AND resource = 'report'");
  await http(`/app/sector/income-statement?year=${YR}&p=m1`, 'lead');
  const after_ = await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'export' AND resource = 'report'");
  assert.equal(after_.n, before.n + 1, 'لم يُسجَّل أثرُ فتح الورقة');
  const row = await db.get(`SELECT user_id, sector_id, resource_id, detail_json FROM audit_log
     WHERE action = 'export' AND resource = 'report' ORDER BY at DESC, id DESC LIMIT 1`);
  assert.equal(row.user_id, 'u_lead');
  assert.equal(row.sector_id, 'S1');
  assert.equal(row.resource_id, 'income-statement:S1');
  const detail = JSON.parse(row.detail_json || '{}');
  assert.equal(detail.format, 'print', 'الأثر لا يفرّق الورقة عن الملفّ');
  assert.equal(detail.period, 'm1');
});

// ── ٥) المرشِّحات كما تقبلها الشاشة حرفاً ─────────────────────────────────────────────
test('مشروعٌ خارج عدسة السنة المعروضة: يُهمَل في الورقة وفي الملفّ معاً', async () => {
  const sheet = await http(`/app/sector/income-statement?year=${YR}&project=P_OLD`, 'lead');
  assert.equal(sheet.status, 200);
  assert.ok(!sheet.text.includes('مشروع الجيم القديم'), 'مشروعٌ لا تعرضه الشاشة في هذه السنة قصّ الورقة');
  assert.ok(sheet.text.includes('3,333'), 'الورقة لم تعد إلى القطاع كله بعد إهمال المشروع');

  const xl = await http(`/api/sectors/S1/income-statement.xlsx?year=${YR}&project=P_OLD`, 'lead');
  assert.equal(xl.status, 200);
  const col = firstCol(sheetOf(xl.buf)).join('\n');
  assert.ok(!col.includes('مشروع الجيم القديم'), 'مشروعٌ خارج عدسة السنة ظهر في رأس الملفّ');
  const rev = sheetOf(xl.buf).rows.find((x) => x[0] === 'الإيراد');
  assert.equal(rev[5], '3333', 'الملفّ لم يعد إلى القطاع كله بعد إهمال المشروع');
});

test('مشروعٌ خارج الإدارة المختارة: يُهمَل كما تُهمله قائمة مشاريع الشاشة', async () => {
  // «مشروع ألف» بلا إدارة مسجَّلة، فاختيارُ «إدارة الدال» يُخرجه من قائمة المشاريع المقبولة.
  const r = await http(`/app/sector/income-statement?year=${YR}&dept=D1&project=P1`, 'lead');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('إدارة الدال'), 'الإدارة المختارة غائبة عن ترويسة الورقة');
  assert.ok(!r.text.includes('مشروع ألف'), 'مشروعٌ خارج الإدارة المختارة قصّ الورقة');
});

test('«نسبة مجمل الربح» بلا مصطلحٍ إنجليزي مخترَع — في الورقة وفي الملفّ', async () => {
  const sheet = await http(`/app/sector/income-statement?year=${YR}`, 'lead');
  assert.ok(sheet.text.includes('نسبة مجمل الربح'), 'سطر النسبة غائب عن الورقة');
  assert.ok(!sheet.text.includes('Gross Profit %'), 'مصطلحٌ إنجليزي مخترَع بقي على الورقة');
  const wb = sheetOf((await http(`/api/sectors/S1/income-statement.xlsx?year=${YR}`, 'lead')).buf);
  const gp = wb.rows.find((x) => x[0] === 'نسبة مجمل الربح');
  assert.ok(gp, 'سطر النسبة غائب عن الملفّ');
  assert.equal(gp[1], '', 'خانة المصطلح الإنجليزي لسطر النسبة ليست فارغة');
});
