// مركز القطاع ملفَّ Excel — ستّ أوراقٍ هي فصول الشاشة.
//
// ما يحرسه هذا الملف بترتيب أهميته:
//   ١) **الباب قبل الملفّ**: قائدُ قطاعٍ ينزّل قطاعه، وقائدُ قطاعٍ آخر يُردّ ٤٠٣ — والرفض
//      يقع **قبل** بناء أي حمولة، فلا رقمَ يُستعلم عنه في قطاعٍ خارج النطاق.
//   ٢) **الأوراق بأسمائها وترتيبها**، وأوّلُ صفوفها تحمل القطاع والسنة وتاريخ الإخراج.
//   ٣) **الحجب غيابٌ لا فراغ**: حمولةٌ بلا كلفةٍ ولا هامش تُخرِج ملفاً بلا سطور كلفةٍ وبلا
//      عمود هامشٍ وبلا أعمدة مطابقة — لا أعمدةً فارغةً تُسائَل عنها.
//   ٤) **كل تنزيلٍ يترك أثره** في سجل النظام باسم مركز القطاع.
//
// وحدةُ الحمولة (`src/modules/finance/command-center.js`) تُبنى في وحدة عملٍ أخرى من الخطة
// نفسها، فالاختبار يحقن بديلاً مبنيّاً باليد (`tests/fixtures/command-center-stub.js`) عبر
// بابِ الحقن `_loaders` — والمسار والترويسات والبوابة والأثر كلُّها حقيقية لا محقونة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-ccexp-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
const XLSX = await import('../../vendor/xlsx/xlsx.mjs');
const { fullDataset, redactedDataset, loaderOf } = await import('../fixtures/command-center-stub.js');
const ccExport = await import('../../src/modules/finance/command-center-export.js');

const T = '2026-01-10T08:00:00.000Z';
const YR = new Date().getUTCFullYear() - 1;
let server, base;

const person = (id, username, role, sector, scope) => ({ id, username, role_id: role, sector_id: sector, scope });
const LEAD = person('u_lead', 'lead', 'sector_lead', 'S1', 'sector');
const OTHER = person('u_other', 'other', 'sector_lead', 'S2', 'sector');

async function http(path, as) {
  const r = await fetch(base + path, {
    headers: { cookie: `sanad_sid=sess_${as}; sanad_csrf=t` }, redirect: 'manual',
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, headers: r.headers, buf, text: buf.toString('utf8') };
}
// قراءةُ الملفّ بأوراقه كلها — `parseWorkbook` تقرأ الورقة الأولى وحدها، وهذا ملفُّ فصول.
const book = (buf) => {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheets = {};
  for (const n of wb.SheetNames) {
    sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '', blankrows: true });
  }
  return { names: wb.SheetNames, sheets };
};
const NAMES = ['قائمة الدخل', 'المشاريع', 'الفرص', 'العملاء', 'الفريق والطاقة', 'المصادر والمطابقة'];
const useDataset = (d) => { ccExport._loaders.buildCommandCenterDataset = loaderOf(d); };

before(async () => {
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع الاستشارات', active: 1, sort_order: 2, created_at: T });
  for (const u of [LEAD, OTHER]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.username, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
    await db.insert('session', { id: 'sess_' + u.username, user_id: u.id, created_at: T,
      expires_at: new Date(Date.now() + 86400000).toISOString() });
  }
  useDataset(() => fullDataset({ year: YR }));
  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  ccExport._loaders.buildCommandCenterDataset = null;
  server?.closeAllConnections?.();
  if (server) await new Promise((res) => server.close(res));
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ── ٠) بابُ الحقن بابُ اختبارٍ لا بابُ تشغيل ─────────────────────────────────────────────
test('بابُ الحقن مغلقٌ في المصدر: مسارُ التشغيل يقرأ وحدة الحمولة الحقيقية لا بديلاً', () => {
  assert.equal(typeof ccExport.exportCommandCenter, 'function');
  const src = readFileSync(join(ROOT, 'src/modules/finance/command-center-export.js'), 'utf8');
  assert.match(src, /_loaders\s*=\s*\{\s*buildCommandCenterDataset:\s*null\s*\}/,
    'بابُ الحقن يأتي مملوءاً من المصدر — فقد يُصدَّر ملفٌّ من حمولةٍ ليست حمولة الشاشة');
  assert.match(src, /import\('\.\/command-center\.js'\)/, 'مسارُ التشغيل لا يستدعي وحدة الحمولة');
});

// ── ١) الملفّ وبابه ───────────────────────────────────────────────────────────
test('قائد القطاع ينزّل ملفَّ مركز القطاع — بايتاتُه ملفُّ Excel وترويساته ترويسات تنزيل', async () => {
  const r = await http(`/api/sectors/S1/command-center.xlsx?year=${YR}`, 'lead');
  assert.equal(r.status, 200);
  assert.match(String(r.headers.get('content-type')), /spreadsheetml\.sheet/);
  assert.match(String(r.headers.get('content-disposition')), /attachment; filename="sector-S1-command-center\.xlsx"/);
  assert.match(String(r.headers.get('content-disposition')), /filename\*=UTF-8''/);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.buf[0], 0x50, 'أول بايت ليس توقيع ملفّ Excel');
  assert.equal(r.buf[1], 0x4b);
});

test('قائد قطاعٍ آخر يُردّ عن ملفِّ قطاعٍ ليس قطاعه', async () => {
  const r = await http(`/api/sectors/S1/command-center.xlsx?year=${YR}`, 'other');
  assert.equal(r.status, 403);
  assert.ok(!r.text.includes('قطاع الحلول'), 'اسمُ القطاع تسرّب في جسم الرفض');
});

// ── ٢) الأوراق وصفوفها الأولى ────────────────────────────────────────────────
test('الملفّ ستّ أوراقٍ بأسمائها وترتيبها، وكلُّ ورقةٍ تحمل القطاع والسنة وتاريخ الإخراج', async () => {
  const r = await http(`/api/sectors/S1/command-center.xlsx?year=${YR}`, 'lead');
  const wb = book(r.buf);
  assert.deepEqual(wb.names, NAMES);
  for (const n of NAMES) {
    const head = wb.sheets[n].slice(1, 4).map((row) => row[0]).join('\n');
    assert.ok(head.includes('قطاع الحلول'), `${n}: اسم القطاع غائب عن رأس الورقة`);
    assert.ok(head.includes(String(YR)), `${n}: السنة غائبة عن رأس الورقة`);
    assert.ok(head.includes('تاريخ إخراج الملفّ'), `${n}: تاريخ الإخراج غائب عن رأس الورقة`);
  }
});

test('ورقةُ قائمة الدخل: البند ثم اثنا عشر شهراً ثم الخطة ثم المجموع، والمبالغ بالريال عدداً', async () => {
  const r = await http(`/api/sectors/S1/command-center.xlsx?year=${YR}`, 'lead');
  const rows = book(r.buf).sheets['قائمة الدخل'];
  assert.deepEqual(rows[0], ['البند', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو',
    'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'الخطة', 'المجموع']);
  const rev = rows.find((x) => x[0] === 'الإيراد');
  assert.ok(rev, 'سطر الإيراد غائب');
  assert.equal(rev[1], '1111', 'إيراد يناير ليس بالريال عدداً');
  assert.equal(rev[2], '2222', 'إيراد فبراير ليس بالريال عدداً');
  assert.equal(rev[3], '', 'شهرٌ لم يُسجَّل كُتب صفراً بدل الفراغ');
  assert.equal(rev[14], '3333', 'عمود المجموع لا يجمع ما سُجِّل');
  // الصفرُ المسجَّل يبقى صفراً، ويفترق عن الغياب: «أتعاب المستشارين» صفرُ يناير مسجَّل
  const con = rows.find((x) => x[0] === 'أتعاب المستشارين');
  assert.equal(con[1], '0', 'صفرٌ مسجَّل تحوّل إلى فراغ');
  assert.equal(con[2], '', 'غيابٌ تحوّل إلى صفر');
});

test('ورقة المشاريع: العميل والإدارة بأسمائهما، والحال بكلمتها لا برمزها المخزَّن', async () => {
  const r = await http(`/api/sectors/S1/command-center.xlsx?year=${YR}`, 'lead');
  const rows = book(r.buf).sheets['المشاريع'];
  assert.equal(rows[0][0], 'المشروع');
  assert.ok(rows[0].some((h) => h.includes('الهامش')), 'عمود الهامش غائب عمّن يملك بابه');
  const p1 = rows.find((x) => x[0] === 'مشروع ألف');
  assert.equal(p1[1], 'جهة ألف');
  assert.equal(p1[2], 'إدارة الدال');
  assert.ok(p1[3] && !/GREEN|AMBER|RED/.test(p1[3]), 'الحال كُتبت برمزها المخزَّن');
  assert.equal(p1[4], '9000', 'قيمة العقد ليست بالريال عدداً');
  assert.equal(p1[5], '1111', 'إيراد الفترة ليس مجموع أشهر المشروع');
  assert.equal(p1[8], '34', 'نسبة الهامش غائبة');
});

test('ورقة الفرص: اسمُ المرحلة عربيٌّ ورمزُها لا يُطبع، والشهر باسمه', async () => {
  const r = await http(`/api/sectors/S1/command-center.xlsx?year=${YR}`, 'lead');
  const rows = book(r.buf).sheets['الفرص'];
  const flat = rows.map((x) => x.join('|')).join('\n');
  assert.ok(!/QUALIFIED|NEGOTIATION/.test(flat), 'رمزُ مرحلةٍ مخزَّن ظهر في الورقة');
  const o2 = rows.find((x) => x[0] === 'فرصة باء');
  assert.equal(o2[2], 'تفاوض');
  assert.equal(o2[3], '25000', 'قيمة الفرصة ليست بالريال عدداً');
  assert.equal(o2[5], 'سبتمبر', 'شهر الإغلاق المتوقع ليس باسمه');
  assert.equal(o2[6], '75');
  assert.equal(o2[7], 'نعم', 'التوقّف لا يُقال بكلمة');
});

test('ورقتا العملاء والفريق: الحصة والعدد، ثم اثنا عشر شهراً للطاقة والمُسكَّن', async () => {
  const r = await http(`/api/sectors/S1/command-center.xlsx?year=${YR}`, 'lead');
  const wb = book(r.buf);
  const cli = wb.sheets['العملاء'];
  assert.equal(cli[0][0], 'العميل');
  const c2 = cli.find((x) => x[0] === 'جهة باء');
  assert.equal(c2[1], '67', 'حصة الإيراد غائبة');
  assert.equal(c2[2], '1', 'عدد المشاريع غائب');

  const team = wb.sheets['الفريق والطاقة'];
  assert.equal(team[0][0], 'الشهر');
  const dec = team.find((x) => x[0] === 'ديسمبر');
  assert.equal(dec[1], '17');
  assert.equal(dec[2], '21');
});

test('ورقة المصادر والمطابقة: شهرٌ بشهر، ثم آخر رفعٍ للمالية والشهر المقفل', async () => {
  const r = await http(`/api/sectors/S1/command-center.xlsx?year=${YR}`, 'lead');
  const rows = book(r.buf).sheets['المصادر والمطابقة'];
  assert.deepEqual(rows[0].slice(0, 2), ['الشهر', `فعلي المالية (ريال)`]);
  const jan = rows.find((x) => x[0] === 'يناير');
  assert.equal(jan[1], '500');
  assert.equal(jan[2], '490');
  assert.equal(jan[5], 'لا', 'نتيجة المطابقة لا تُقال بكلمة');
  const feb = rows.find((x) => x[0] === 'فبراير');
  assert.equal(feb[5], 'نعم');
  const flat = rows.map((x) => x[0]).join('\n');
  assert.ok(flat.includes('آخر رفعٍ لملفّ المالية'), 'معلومة آخر رفعٍ غائبة');
  assert.ok(flat.includes('مها العتيبي'), 'اسم من رفع الملفّ غائب');
  assert.ok(flat.includes('الشهر المقفل: فبراير'), 'الشهر المقفل غائب أو ليس باسمه');
  assert.ok(flat.includes('مصدر الإقفال'), 'مصدر الإقفال غائب');
  assert.ok(!/upload|override/i.test(rows.map((x) => x.join('|')).join('\n')), 'قيمةٌ مخزَّنة طُبعت خاماً');
});

// ── ٣) الحجب غيابٌ لا فراغ ───────────────────────────────────────────────────
test('حمولةٌ بلا كلفةٍ ولا هامش: لا سطورَ كلفةٍ ولا عمودَ هامشٍ ولا أعمدةَ مطابقة', async () => {
  useDataset(() => redactedDataset({ year: YR }));
  try {
    const r = await http(`/api/sectors/S1/command-center.xlsx?year=${YR}`, 'lead');
    assert.equal(r.status, 200);
    const wb = book(r.buf);
    assert.deepEqual(wb.names, NAMES, 'عددُ الأوراق تغيّر بتغيّر الصلاحية');

    const pl = wb.sheets['قائمة الدخل'].map((x) => x.join('|')).join('\n');
    assert.ok(pl.includes('الإيراد'), 'سطر الإيراد غاب عمّن يملك قراءته');
    for (const hidden of ['رواتب التشغيل', 'أتعاب المستشارين', 'تكلفة الإيراد', 'مجمل الربح']) {
      assert.ok(!pl.includes(hidden), `${hidden} تسرّب إلى ملفِّ من لا يملك باب الكلفة`);
    }
    const prj = wb.sheets['المشاريع'];
    assert.ok(!prj[0].some((h) => h.includes('الهامش')), 'عمود الهامش رُسم بلا بابه');
    assert.equal(prj[0].length, 8, 'عددُ أعمدة المشاريع لم ينقص بغياب الهامش');

    const rec = wb.sheets['المصادر والمطابقة'];
    assert.equal(rec[0].length, 1, 'أعمدةُ المطابقة رُسمت فارغةً بدل أن تغيب');
    assert.equal(rec[0][0], 'من أين تأتي الأرقام؟');
    const flat = rec.map((x) => x[0]).join('\n');
    assert.ok(!flat.includes('فعلي المالية'), 'عمودُ كلفةٍ تسرّب إلى ورقة المصادر');
    assert.ok(flat.includes('الشهر المقفل'), 'الشهر المقفل غاب مع غياب المطابقة');
    assert.ok(flat.includes('سطور الكلفة ونسبة الهامش خارج صلاحيتك'), 'سببُ الغياب لا يُقال للقارئ');
  } finally {
    useDataset(() => fullDataset({ year: YR }));
  }
});

// ── ٤) الأثر ─────────────────────────────────────────────────────────────────
test('كل تنزيلٍ ناجح يترك أثره في سجل النظام باسم مركز القطاع', async () => {
  const before_ = await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'export' AND resource = 'report'");
  await http(`/api/sectors/S1/command-center.xlsx?year=${YR}`, 'lead');
  const after_ = await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'export' AND resource = 'report'");
  assert.equal(after_.n, before_.n + 1, 'لم يُسجَّل أثرُ التنزيل');
  const row = await db.get(`SELECT user_id, sector_id, resource_id, detail_json FROM audit_log
     WHERE action = 'export' AND resource = 'report' ORDER BY at DESC, id DESC LIMIT 1`);
  assert.equal(row.user_id, 'u_lead');
  assert.equal(row.sector_id, 'S1');
  assert.equal(row.resource_id, 'command-center:S1');
  const detail = JSON.parse(row.detail_json || '{}');
  assert.equal(detail.year, YR);
  assert.deepEqual(detail.sheets, NAMES, 'الأثر لا يقول أيَّ أوراقٍ خرجت');
});

test('الرفضُ يقع قبل بناء الحمولة — لا استعلامَ يُطلق لقطاعٍ خارج النطاق', async () => {
  let called = 0;
  ccExport._loaders.buildCommandCenterDataset = async () => { called++; return fullDataset({ year: YR }); };
  try {
    await assert.rejects(
      () => ccExport.exportCommandCenter({ user: OTHER }, { sector: 'S1', year: YR }),
      (e) => e.status === 403,
    );
    assert.equal(called, 0, 'الحمولة بُنيت قبل الرفض');
  } finally {
    useDataset(() => fullDataset({ year: YR }));
  }
});

test('حمولةٌ جاهزةٌ تُمرَّر مباشرةً: نفسُ الملفّ بلا مرورٍ بوحدة الحمولة', async () => {
  const out = await ccExport.exportCommandCenter({ user: LEAD }, { sector: 'S1', year: YR },
    { _dataset: fullDataset({ year: YR }) });
  assert.match(out.mime, /spreadsheetml\.sheet/);
  assert.ok(out.filename.startsWith('مركز القطاع قطاع الحلول'), 'اسمُ الملفّ ليس باسم القطاع');
  assert.ok(out.filename.endsWith(`${YR}.xlsx`), 'اسمُ الملفّ بلا سنته');
  assert.deepEqual(book(out.buffer).names, NAMES);
});
