#!/usr/bin/env node
// مشغّل السيناريوهات — يملأ المنصة ببيانات اصطناعية لكل قطاع ولكل دور، يجرّب الحالات على
// الشبكة الحقيقية، ثم **يمحو كل ما زرعه ويُثبت أن المنصة رجعت كما كانت**.
//
// التشغيل:
//   node --experimental-sqlite scripts/scenarios.mjs            ← قاعدة رمي في مجلد النظام المؤقت، تُحذف بعده
//   node --experimental-sqlite scripts/scenarios.mjs --keep     ← يُبقي ملف القاعدة للفحص (يطبع مساره)
//   SANAD_SCENARIOS=1 node --experimental-sqlite scripts/scenarios.mjs --db <ملف>   ← وجهة صريحة
//   node --experimental-sqlite scripts/scenarios.mjs --today 2026-07-27  ← يوم مثبَّت تُشتقّ منه كل التواريخ
//   node --experimental-sqlite scripts/scenarios.mjs --compact  ← بلا مسح الصفحات لكل شخص (نسخة الفحص الآلي)
// يخرج بصفر إذا نجح كل فحص وكانت المنصة نظيفة بعد المحو، وبواحد فيما عدا ذلك.
// النسخة المختصرة نفسها مُشغَّلة داخل الفحص الآلي: tests/integration/scenario-harness.test.js
//
// ── حارس التدمير ──────────────────────────────────────────────────────────────
// هذا السكربت **يحذف صفوفاً**. تشغيله مرة واحدة بالخطأ على بيئة حيّة يمحو عمل المستخدمين.
// لذلك الأمان هنا **بنيوي لا تحذيري**، على أربع طبقات (assertThrowawayTarget أدناه):
//   ١) قاعدة خارجية (Postgres عبر DATABASE_URL) ⟵ رفض قاطع بلا أي مفتاح تجاوز. staging والإنتاج
//      لا يُلمسان من هنا أبداً، والنظام القديم os.evcsol.com للقراءة فقط بقرار معلن.
//   ٢) بيئة الإنتاج (NODE_ENV=production) ⟵ رفض قاطع.
//   ٣) قاعدة التطوير المعتادة (data/sanad.db) ⟵ رفض: فيها بيانات مُرحَّلة يعمل عليها الفريق.
//   ٤) وجهة صريحة من المشغّل (SANAD_DB أو ‎--db) ⟵ تتطلب إعلان نية صريحاً: SANAD_SCENARIOS=1
//      (نفس سابقة scripts/migrate-legacy.js: SANAD_ALLOW_LEGACY_WIPE=1).
// وفوق الأربع: فحصٌ على **محتوى** القاعدة نفسها قبل أي كتابة — أي صف في جدول أعمال يحمل اسماً
// بلا وسم «سيناريو تجريبي» أو «(تجريبي)» يعني بياناتٍ لم يُنشئها هذا المشغّل ⟵ رفض. فالوجهة
// الافتراضية ملفٌ جديد يصنعه المشغّل بنفسه، وأي وجهة أخرى يجب أن تُثبت أنها قاعدة رمي.
//
// ── الإحصاء (كيف يُثبَت المحو) ────────────────────────────────────────────────
// قبل الزرع وبعد المحو يُؤخذ **إحصاء كامل لكل جدول**: كل الصفوف بكل أعمدتها (لا عدّ فقط، ولا
// ترشيح `deleted_at IS NULL`). سببان صريحان:
//   • الحذف الناعم لا يحذف: الصف يبقى في الجدول بعلامة حذف. فإحصاءٌ يرشّح المحذوف ناعماً
//     «يثبت» نظافةً لا وجود لها. الإحصاء هنا يعدّ **كل** صف مهما كانت علامته.
//   • تعديل صف قائم لا يُغيّر عددها: لذلك المقارنة على **محتوى** الصف لا على العدد — تسجيل
//     الدخول مثلاً يعدّل آخر دخول على حسابات العرض، وهو أثر يجب أن يُرجَع لا أن يُتجاهَل.
// و`audit_log` استثناء **معلَن**: تدقيق كتاباتنا سلوكٌ صحيح، وسجل التدقيق لا يُحذف منه شيء.
// فيُفحص بقاعدة أخرى: لا صفَّ اختفى، وكل صف أُضيف منسوبٌ إلى أحد فاعلي التشغيل — ويُذكر عددهم.

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEV_DB = resolve(ROOT, 'data/sanad.db');

// ─────────────────────────────────────────────────────────────────────────────
// الحارس
// ─────────────────────────────────────────────────────────────────────────────
export function assertThrowawayTarget({ dbFile, databaseUrl, nodeEnv, explicit, armed }) {
  if (databaseUrl) {
    throw new Error('مشغّل السيناريوهات يحذف صفوفاً، ووجهته الحالية قاعدة خارجية (بيئة حيّة).\n'
      + 'لا يوجد مفتاح تجاوز: شغّله على قاعدة رمي محلية بلا عنوان قاعدة خارجية.');
  }
  if (nodeEnv === 'production') {
    throw new Error('مشغّل السيناريوهات لا يعمل في بيئة الإنتاج إطلاقاً.');
  }
  if (resolve(dbFile) === DEV_DB) {
    throw new Error('الوجهة هي قاعدة التطوير المعتادة (data/sanad.db) وفيها بيانات يعمل عليها الفريق.\n'
      + 'شغّل المشغّل بلا وجهة ليصنع قاعدة رمي بنفسه، أو مرّر ‎--db بملف مخصص.');
  }
  if (explicit && !armed) {
    throw new Error('حُدِّدت وجهة صريحة لقاعدة البيانات، والمشغّل يمحو ما يزرعه.\n'
      + 'إن كانت قاعدة رمي فعلاً: SANAD_SCENARIOS=1');
  }
  return true;
}

// فحص المحتوى: لا صفَّ في جداول الأعمال بلا وسم. يُنفَّذ بعد الترحيل وقبل أي كتابة.
async function assertNoForeignData(db, guarded, isSafeName) {
  const foreign = [];
  for (const { table, col } of guarded) {
    const rows = await db.all(`SELECT id, ${col} AS nm FROM ${table}`);
    const bad = rows.filter((r) => !isSafeName(r.nm));
    if (bad.length) foreign.push({ table, count: bad.length, sample: bad.slice(0, 3).map((r) => r.nm) });
  }
  if (foreign.length) {
    const lines = foreign.map((f) => `  • ${f.table}: ${f.count} صفاً (مثال: ${f.sample.join('، ')})`);
    throw new Error('القاعدة المستهدفة فيها بيانات لم يُنشئها هذا المشغّل — رفضٌ قبل أي كتابة أو حذف:\n'
      + lines.join('\n') + '\nقاعدة السيناريوهات يجب أن تكون قاعدة رمي: كل اسم فيها يحمل وسم التجربة.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// الإحصاء
// ─────────────────────────────────────────────────────────────────────────────
// أسماء الجداول تُقرأ من ملفات الترحيل نفسها — مصدر البنية الوحيد. جدولٌ يُضاف غداً يدخل
// الإحصاء تلقائياً، ولا قائمة يدوية تشيخ بصمت.
export function schemaTables() {
  const dir = resolve(ROOT, 'migrations');
  const names = new Set();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(resolve(dir, f), 'utf8');
    for (const m of sql.matchAll(/^\s*CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)\s*\(/gim)) names.add(m[1]);
  }
  return [...names].sort();
}

// موضع سطرٍ في الشيفرة يُحسب **وقت التشغيل** من نصٍّ مرساة، لا يُكتب رقماً ثابتاً: أي تعديل
// في ملفٍ فوق العيب يُزيح الرقم، فيصير تقرير العيوب يشير إلى سطر لا علاقة له بالموضوع — وهو
// أسوأ من ألّا يشير. وإن اختفت المرساة عاد الموضع «؟» وسقط الفحص عمداً: العيب تغيّر، فلينظر إنسان.
const SRC_LINES = new Map();
export function locate(relFile, anchor) {
  if (!SRC_LINES.has(relFile)) SRC_LINES.set(relFile, readFileSync(resolve(ROOT, relFile), 'utf8').split('\n'));
  const i = SRC_LINES.get(relFile).findIndex((l) => l.includes(anchor));
  return `${relFile}:${i >= 0 ? i + 1 : '؟'}`;
}

// تمثيل قابل للمقارنة لصف: مفاتيح مرتَّبة، فلا يخدع اختلافُ ترتيب الأعمدة المقارنة.
const canon = (row) => JSON.stringify(Object.keys(row).sort().map((k) => [k, row[k] === undefined ? null : row[k]]));

async function census(db, tables) {
  const out = new Map();
  for (const t of tables) out.set(t, await db.all(`SELECT * FROM ${t}`));
  return out;
}

// فرق مجموعتين من الصفوف (تعدّدية: صفّان متطابقان يُعدّان اثنين).
function diffRows(before = [], after = []) {
  const count = (rows) => {
    const m = new Map();
    for (const r of rows) { const k = canon(r); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const b = count(before), a = count(after);
  const added = [], removed = [];
  for (const [k, n] of a) { const d = n - (b.get(k) || 0); for (let i = 0; i < d; i++) added.push(JSON.parse(k)); }
  for (const [k, n] of b) { const d = n - (a.get(k) || 0); for (let i = 0; i < d; i++) removed.push(JSON.parse(k)); }
  return { added, removed };
}
const asObject = (pairs) => Object.fromEntries(pairs);

export function censusDiff(before, after) {
  const out = [];
  for (const t of before.keys()) {
    const { added, removed } = diffRows(before.get(t), after.get(t));
    if (added.length || removed.length) out.push({ table: t, added: added.map(asObject), removed: removed.map(asObject) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// تسجيل نتائج السيناريوهات
// ─────────────────────────────────────────────────────────────────────────────
class Recorder {
  constructor() { this.scenarios = []; this.defects = []; }
  open(key, title) {
    const s = { key, title, checks: [], error: null };
    this.scenarios.push(s);
    return new Probe(s, this);
  }
  get checks() { return this.scenarios.flatMap((s) => s.checks); }
  get failed() { return this.checks.filter((c) => !c.ok); }
  get passed() { return this.checks.filter((c) => c.ok); }
}

class Probe {
  constructor(scenario, recorder) { this.s = scenario; this.r = recorder; }
  #push(ok, label, detail) { this.s.checks.push({ ok, label, detail: detail || null }); return ok; }
  ok(cond, label, detail) { return this.#push(!!cond, label, cond ? null : detail); }
  eq(actual, expected, label) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    return this.#push(ok, label, ok ? null : `المتوقع ${JSON.stringify(expected)} والحاصل ${JSON.stringify(actual)}`);
  }
  status(res, expected, label) {
    const list = Array.isArray(expected) ? expected : [expected];
    const ok = list.includes(res.status);
    return this.#push(ok, label, ok ? null : `الحالة ${res.status} والمتوقع ${list.join(' أو ')} — ${String(res.text).slice(0, 180)}`);
  }
  // رسالة خطأ عربية: نتحقق أن المنصة قالت للمستخدم ماذا حدث، لا أنها ردّت رقماً فقط.
  says(res, re, label) {
    const msg = res.json?.error?.message || '';
    return this.#push(re.test(msg), label, `الرسالة: «${msg || String(res.text).slice(0, 120)}»`);
  }
  // عيب مؤكَّد: نُثبّت **السلوك القائم** كما هو ونُسجّل ما ينبغي أن يكون. إن عولج العيب سقط
  // التثبيت وقال ذلك صراحةً — فلا يبقى حارسٌ يحرس ماضياً انتهى، ولا يمرّ العيب صامتاً.
  defect({ id, label, actual, pinned, shouldBe, ref }) {
    const ok = JSON.stringify(actual) === JSON.stringify(pinned);
    this.r.defects.push({ id, label, ref, shouldBe, observed: actual, pinnedMatches: ok, scenario: this.s.key });
    return this.#push(ok, `عيب مثبَّت [${id}] — ${label}`,
      ok ? null : `السلوك تغيّر: كان ${JSON.stringify(pinned)} وصار ${JSON.stringify(actual)} — راجع التثبيت (ربما عولج العيب).`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// عميل الشبكة — **يستهلك كل جسم استجابة دائماً**
// ─────────────────────────────────────────────────────────────────────────────
// جسمٌ لا يُقرأ يُبقي محلّل undici معلَّقاً على مقبس حيّ؛ وعند إغلاق الخادم يُهدَم محلّل معلَّق
// فيرمي استثناءً غير ملتقَط (assert(!this.paused)) يُسقط التشغيل كله. الأمر توقيتي: يظهر في
// الفحص الآلي دون المحلي. الاستهلاك **داخل الدالة** يجعل التسريب مستحيلاً بنيوياً، لا معتمداً
// على انتباه كل موضع نداء.
function makeClient(base) {
  const cookies = new Map();
  const req = async (as, path, { method = 'GET', body, headers = {} } = {}) => {
    const jar = as ? cookies.get(as) : null;
    const r = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { 'content-type': 'application/json', connection: 'close', ...(jar ? { cookie: jar } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, headers: r.headers, text, json };
  };
  const login = async (username, password, ip) => {
    const r = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close', 'x-forwarded-for': ip },
      body: JSON.stringify({ username, password }),
    });
    const text = await r.text();                                  // يُستهلك هنا أيضاً
    if (r.status !== 200) throw new Error(`تعذّر دخول ${username}: ${r.status} ${text.slice(0, 120)}`);
    const cookie = r.headers.getSetCookie().find((c) => c.startsWith('sanad_sid=')).split(';')[0];
    cookies.set(username, cookie);
    return cookie;
  };
  return { req, login, cookies };
}

// ─────────────────────────────────────────────────────────────────────────────
// المشغّل
// ─────────────────────────────────────────────────────────────────────────────
export async function runHarness(opts = {}) {
  const log = opts.log || ((...a) => console.log(...a));
  const today = opts.today || '2026-07-27';
  const compact = !!opts.compact;

  const D = await import('./lib/scenario-data.mjs');
  const db = await import('../src/core/db/index.js');
  const { migrate } = await import('./migrate.js');
  const { seedRbac } = await import('./seed-rbac.js');
  const seedMod = await import('./seed.js');

  const dataset = D.buildDataset({ today });
  const tables = schemaTables();
  const rec = new Recorder();
  const created = [];                 // سجل ما أنشأناه صراحةً: { table, id }
  const remember = (table, id) => { if (id) created.push({ table, id }); return id; };

  // ① الإقلاع: بنية + منح + حسابات العرض. لا قطاعات بعد — فبيانات القطاعات من السيناريو نفسه.
  await migrate();
  await seedRbac();
  await assertNoForeignData(db, D.GUARDED_NAME_TABLES, D.isScenarioName);
  // بذر الحسابات يطبع كشفاً من ٢٠ سطراً في كل تشغيل — يُكتم مؤقتاً كي يبقى المخرَج تقريراً
  // واحداً مقروءاً. الكتم محصور بهذه الخطوة ويُعاد الأصل مهما حدث.
  const origLog = console.log;
  console.log = () => {};
  try { await seedMod.seed(); } finally { console.log = origLog; }

  // ② الإحصاء المرجعي — قبل أي صف من صفوف السيناريو
  const before = await census(db, tables);
  const runStart = new Date().toISOString();

  // ③ إقلاع التطبيق الحقيقي والدخول بكل الأدوار
  const { createApp } = await import('../src/server.js');
  const app = await createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const C = makeClient(base);

  const summary = { seeded: 0, tracked: 0, purged: 0, auditAdded: 0, runStart: null };
  let ids = null;
  let preClose = null;
  try {
    // حدّ محاولات الدخول عشر لكل عنوان (core/http/security.js) — لكل شخص عنوانه، بلا إضعاف الحدّ.
    await C.login('demo.admin', seedMod.DEMO_PW, '10.90.0.1');

    // ④ زرع البيانات الاصطناعية عبر الشبكة (خدماتها وحُرّاسها وتدقيقها — لا إدخال خام)
    ids = await seedScenarioData({ C, db, D, dataset, rec, remember, seedMod });
    summary.seeded = created.length;

    // ⑤ السيناريوهات
    for (const s of SCENARIOS) {
      if (compact && s.slow) continue;
      const t = rec.open(s.key, s.title);
      try { await s.run({ C, db, D, dataset, ids, rec, t, remember, today, seedMod }); }
      catch (e) { t.s.error = e.message; t.ok(false, 'اكتمل السيناريو بلا انقطاع', e.stack || e.message); }
    }
    // لقطة قبل إغلاق الخادم مباشرةً: ما يظهر بعدها كُتب **بعد** آخر استجابة — أي كتابةٌ لم
    // ينتظرها أحد. الفرق يُقاس ويُذكر في التقرير بدل أن يُخمَّن.
    preClose = await census(db, tables);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
  const postClose = await census(db, tables);
  const lateWrites = preClose ? censusDiff(preClose, postClose) : [];

  // ⑥ المحو — وترتيبه مقصود: نحذف ما ظهر، ثم نُرجع ما تغيّر، ثم نُحصي ونقارن.
  summary.tracked = created.length;
  const purge = await purgeEverything({ db, D, before, tables, created });
  summary.purged = purge.deleted;
  summary.runStart = runStart;

  // ⑦ الإحصاء بعد المحو + المقارنة
  const after = await census(db, tables);
  const diffs = censusDiff(before, after);
  const auditDiff = diffs.find((d) => d.table === 'audit_log');
  const residue = diffs.filter((d) => d.table !== 'audit_log');

  // سجل التدقيق: لا صفَّ اختفى، وكل صف أُضيف منسوبٌ إلى فاعل من فاعلي التشغيل.
  const actorNames = new Set(seedMod.DEMO_USERS.map((u) => u.u));
  const auditAdded = auditDiff?.added || [];
  const auditRemoved = auditDiff?.removed || [];
  const unattributed = auditAdded.filter((r) => !actorNames.has(r.username) || String(r.at) < runStart);
  summary.auditAdded = auditAdded.length;

  const tAudit = rec.open('census', 'الإحصاء بعد المحو');
  tAudit.eq(residue.map((d) => `${d.table}:+${d.added.length}/-${d.removed.length}`), [],
    'لا صفَّ زائد ولا ناقص في أي جدول بعد المحو (عدا سجل التدقيق)');
  tAudit.eq(auditRemoved.length, 0, 'سجل التدقيق لم يُحذف منه صف — السجل لا يُمحى');
  tAudit.eq(unattributed.map((r) => `${r.username}:${r.action}`), [],
    'كل سطر تدقيق أُضيف منسوبٌ إلى أحد فاعلي التشغيل');
  tAudit.ok(auditAdded.length > 0, 'الكتابات دُقِّقت فعلاً (سجل التدقيق نما)', 'لم يُكتب سطر تدقيق واحد!');

  return { recorder: rec, summary, diffs, residue, auditAdded, purge, lateWrites, dataset, ids };
}

// ─────────────────────────────────────────────────────────────────────────────
// الزرع
// ─────────────────────────────────────────────────────────────────────────────
async function seedScenarioData({ C, db, D, dataset, rec, remember, seedMod }) {
  const t = rec.open('seed', 'زرع البيانات الاصطناعية لكل قطاع ولكل شخص');
  const ids = { sector: {}, dept: {}, emp: {}, client: {}, opp: {}, project: {}, contract: {},
    task: {}, user: {}, deliverable: {}, invoice: {}, alloc: {} };

  // مراحل خط الفرص: الجدول الوحيد بلا خدمة في المنتج كله ⟵ إدخال مباشر، مذكور في التقرير.
  for (const s of D.STAGES) {
    if (!(await db.get('SELECT id FROM stage WHERE id = ?', [s.id]))) { await db.insert('stage', s); remember('stage', s.id); }
  }

  // القطاعات ووحدات المساندة
  for (const s of dataset.sectors) {
    const r = await C.req('demo.admin', '/api/org/sectors', { method: 'POST', body: {
      id: s.id, name_ar: s.name_ar, name_en: s.name_en, color: s.color, kind: s.kind,
      target_sales_sar: s.target_sales_sar, target_revenue_sar: s.target_revenue_sar,
      target_margin_pct: s.target_margin_pct, sort_order: s.sort_order } });
    t.status(r, 200, `إنشاء ${s.name_ar}`);
    ids.sector[s.id] = s.id; remember('sector', s.id);
  }

  // إدارتا العرض + ربط حسابَي «مدير إدارة» و«مدير مباشر» بسجلَي موظف — بدونها يبقى نطاق
  // «الإدارة» بلا معنى قابل للقياس (معرّف الإدارة يُستنتج من رابط الحساب بسجل الموظف).
  const demoOrg = await seedMod.seedDemoOrg();
  t.ok(demoOrg.seeded, 'بذر إدارات العرض وربط حساباتها');
  for (const d of demoOrg.departments || []) {
    remember('department', d.id);
    for (const e of d.staff) remember('employee', e);
  }

  // بقية الإدارات
  for (const d of dataset.departments) {
    const r = await C.req('demo.admin', '/api/org/departments', { method: 'POST',
      body: { sector_id: d.sector, name_ar: d.name_ar } });
    t.status(r, 200, `إنشاء ${d.name_ar}`);
    ids.dept[d.key] = r.json?.id; remember('department', r.json?.id);
  }

  // الأشخاص
  for (const p of dataset.people) {
    const r = await C.req('demo.admin', '/api/org/employees', { method: 'POST', body: {
      name_ar: p.name_ar, sector_id: p.sector, department_id: ids.dept[p.dept] || null,
      job_title: p.job_title, hire_date: p.hire_date, salary_sar: p.salary_sar } });
    t.status(r, 200, `إضافة ${p.name_ar}`);
    ids.emp[p.key] = r.json?.id; remember('employee', r.json?.id);
    if (p.link && r.json?.id) {
      const u = await db.get('SELECT id FROM app_user WHERE username = ?', [p.link]);
      const lr = await C.req('demo.admin', `/api/employees/${r.json.id}/link`, { method: 'POST', body: { user_id: u.id } });
      t.status(lr, 200, `ربط ${p.link} بسجل ${p.name_ar}`);
    }
  }

  // حسابات العرض السبعة عشر — لكل واحد عنوانه كي لا يصطدم بحدّ محاولات الدخول
  for (const [i, u] of seedMod.DEMO_USERS.entries()) {
    if (u.u !== 'demo.admin') await C.login(u.u, seedMod.DEMO_PW, `10.90.1.${i + 1}`);
    ids.user[u.u] = (await db.get('SELECT id FROM app_user WHERE username = ?', [u.u]))?.id;
  }
  t.eq(Object.values(ids.user).filter(Boolean).length, seedMod.DEMO_USERS.length, 'دخل الأشخاص السبعة عشر كلهم');

  // العملاء
  for (const c of dataset.clients) {
    const r = await C.req('demo.admin', '/api/clients', { method: 'POST', body: { name_ar: c.name_ar, type: c.type } });
    t.status(r, 200, `إضافة ${c.name_ar}`);
    ids.client[c.key] = r.json?.id; remember('client', r.json?.id);
  }

  // الفرص — كلٌّ بحساب مالكها هو
  for (const o of dataset.opportunities) {
    const r = await C.req(o.owner, '/api/opportunities', { method: 'POST', body: {
      title_ar: o.title_ar, sector_id: o.sector, client_id: ids.client[o.client],
      stage_id: o.stage_id, value_sar: o.value_sar, priority: o.priority, year: dataset.year,
      next_action: o.next_action } });
    t.status(r, 200, `إنشاء ${o.title_ar} بحساب ${o.owner}`);
    ids.opp[o.key] = r.json?.id; remember('opportunity', r.json?.id);
  }

  // المشاريع + عقودها + مخرجاتها (مسار استلام العمل — معاملة واحدة)
  for (const p of dataset.projects) {
    const r = await C.req(p.creator, '/api/intake/create', { method: 'POST', body: {
      name_ar: p.name_ar, sector_id: p.sector, client_id: ids.client[p.client] || null,
      owner_user_id: ids.user[p.owner], value_sar: p.value_sar, start_date: p.start_date,
      end_date: p.end_date, contract_code: p.contract_code, status: 'IN_PROGRESS',
      deliverables: p.deliverables } });
    t.status(r, 200, `إنشاء ${p.name_ar} بحساب ${p.creator}`);
    ids.project[p.key] = r.json?.project_id; remember('project', r.json?.project_id);
    ids.contract[p.key] = r.json?.contract_id; remember('contract', r.json?.contract_id);
    for (const d of await db.all('SELECT id FROM deliverable WHERE project_id = ?', [r.json?.project_id || ''])) {
      (ids.deliverable[p.key] ||= []).push(d.id); remember('deliverable', d.id);
    }
  }

  // المهام
  for (const k of dataset.tasks) {
    const r = await C.req(k.creator, '/api/tasks/quick', { method: 'POST', body: {
      title: k.title, project_id: ids.project[k.project], assignee_user_id: ids.user[k.assignee],
      priority: k.priority, due_date: k.due_date, sector_id: dataset.projects.find((p) => p.key === k.project)?.sector } });
    t.status(r, 200, `إنشاء ${k.title}`);
    ids.task[k.key] = r.json?.id; remember('task', r.json?.id);
  }

  // سجل الوقت
  for (const e of dataset.timesheet.entries) {
    const r = await C.req(dataset.timesheet.user, '/api/timesheets', { method: 'POST', body: {
      hours: e.hours, entry_date: e.date, task_id: e.task ? ids.task[e.task] : null,
      project_id: ids.project.sol_main, work_kind: e.task ? 'project' : 'internal',
      billable: e.billable, note: e.note } });
    t.status(r, 200, `تسجيل ${e.hours} ساعات في ${e.date}`);
    remember('time_entry', r.json?.id);
  }

  // بنود الإيراد المحقق: لا خدمة لها في المنتج (تُكتب من الاستيراد وحده) ⟵ إدخال مباشر موثَّق.
  const { id: mkId, nowIso, toHalalas } = await import('../src/core/util/ids.js');
  for (const rv of dataset.revenues) {
    const rid = mkId('rev');
    await db.insert('revenue_line', { id: rid, project_id: ids.project[rv.project],
      sector_id: dataset.projects.find((p) => p.key === rv.project)?.sector,
      amount_halalas: toHalalas(rv.amount_sar), month: rv.month, year: dataset.year,
      label: D.tag('إيراد مرحلي'), auto: 0, created_at: nowIso() });
    remember('revenue_line', rid);
  }
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────────
// السيناريوهات
// ─────────────────────────────────────────────────────────────────────────────
const SCENARIOS = [];
const scenario = (key, title, run, opts = {}) => SCENARIOS.push({ key, title, run, ...opts });

// ① دورة حياة الفرصة حتى تصير مشروعاً
scenario('opp-lifecycle', 'دورة حياة الفرصة: من الترشيح إلى الفوز ثم مشروع', async ({ C, db, D, t, ids, dataset, remember }) => {
  const body = { title_ar: D.tag('فرصة دورة الحياة الكاملة'), sector_id: 'SOLUTIONS',
    client_id: ids.client.gov, stage_id: 'LEAD', value_sar: 2_000_000, priority: 'P1', year: dataset.year };
  const created = await C.req('demo.bd', '/api/opportunities', { method: 'POST', body });
  t.status(created, 200, 'مدير تطوير الأعمال ينشئ فرصة في قطاعه');
  const oid = created.json?.id; remember('opportunity', oid);
  t.eq(created.json?.value_halalas, 200_000_000, 'القيمة تُخزَّن هللات صحيحة (٢ مليون ريال)');
  t.ok(Number.isInteger(created.json?.value_halalas), 'المال عدد صحيح لا كسر عشري');

  for (const stage of ['QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON']) {
    const mv = await C.req('demo.bd', `/api/opportunities/${oid}/stage`, { method: 'POST',
      body: { stage, note: D.tag('نقل تجريبي') } });
    t.status(mv, 200, `نقل الفرصة إلى مرحلة ${stage}`);
    t.eq(mv.json?.stage_id, stage, `المرحلة المخزَّنة صارت ${stage}`);
  }
  const hist = await db.all('SELECT to_stage_id FROM opportunity_stage_history WHERE opportunity_id = ? ORDER BY changed_at', [oid]);
  t.eq(hist.map((h) => h.to_stage_id), ['QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON'], 'سجل المراحل كتب الأربع نقلات بالترتيب');
  for (const h of hist) remember('opportunity_stage_history', (await db.get('SELECT id FROM opportunity_stage_history WHERE opportunity_id = ? AND to_stage_id = ?', [oid, h.to_stage_id]))?.id);

  // التحويل إلى مشروع: مرجع لا نسخة — العميل يُورَث، والقيمة تُدخَل من النموذج لا من الفرصة.
  const conv = await C.req('demo.sectorlead', '/api/intake/create', { method: 'POST', body: {
    name_ar: D.tag('مشروع من فرصة مكسوبة'), source_opp_id: oid, value_sar: 1_800_000,
    start_date: '2026-08-01', end_date: '2027-01-31', contract_code: 'SCN-C-WON' } });
  t.status(conv, 200, 'قائد القطاع يحوّل الفرصة المكسوبة إلى مشروع');
  remember('project', conv.json?.project_id); remember('contract', conv.json?.contract_id);
  const prj = await db.get('SELECT * FROM project WHERE id = ?', [conv.json?.project_id]);
  t.eq(prj?.source_opp_id, oid, 'المشروع يشير إلى فرصته المصدر');
  t.eq(prj?.client_id, ids.client.gov, 'عميل الفرصة يُورَث بمعرّفه نفسه — لا عميل ثانٍ بالاسم نفسه');
  t.eq(prj?.contract_value_halalas, 180_000_000, 'قيمة العقد من النموذج (١٫٨ مليون) لا من الفرصة (٢ مليون)');

  const again = await C.req('demo.sectorlead', '/api/intake/create', { method: 'POST', body: {
    name_ar: D.tag('مشروع ثانٍ لنفس الفرصة'), source_opp_id: oid, value_sar: 100_000 } });
  t.status(again, 400, 'الفرصة الواحدة لا تُنتج مشروعين');
  t.says(again, /مشروع بالفعل/, 'الرسالة تقول إن للفرصة مشروعاً وتدعو لفتحه');

  const mine = await C.req('demo.bd', '/api/opportunities');
  t.ok((mine.json || []).some((o) => o.id === oid), 'الفرصة تظهر في قائمة صاحبها');
});

// ② حدود القطاع على الفرص
scenario('sector-isolation', 'عزل القطاعات: لا أحد يقرأ أو يكتب خارج قطاعه', async ({ C, t, ids, D, dataset }) => {
  const consOpp = ids.opp.con_a;
  for (const u of ['demo.bd', 'demo.sectorlead', 'demo.ops', 'demo.pm', 'demo.viewer']) {
    const r = await C.req(u, `/api/opportunities/${consOpp}`);
    t.status(r, 403, `${u} لا يقرأ فرصة قطاع الاستشارات`);
  }
  for (const u of ['demo.admin', 'demo.ceo', 'demo.bdhead']) {
    const r = await C.req(u, `/api/opportunities/${consOpp}`);
    t.status(r, 200, `${u} يقرأ فرص القطاعات كلها بحكم نطاقه`);
  }
  const list = await C.req('demo.sectorlead', '/api/opportunities');
  t.ok((list.json || []).length > 0, 'قائد القطاع يرى فرص قطاعه');
  t.ok((list.json || []).every((o) => o.sector_id === 'SOLUTIONS'), 'ولا يرى فرصةً من قطاع آخر');

  const cross = await C.req('demo.bd', '/api/opportunities', { method: 'POST', body: {
    title_ar: D.tag('فرصة عابرة للقطاع'), sector_id: 'CONSULTING', value_sar: 1000, year: dataset.year } });
  t.status(cross, 403, 'مدير تطوير الأعمال لا ينشئ فرصة في قطاع غيره');
  t.says(cross, /نطاق/, 'الرسالة تقول إن الطلب خارج نطاق قطاعه');

  const projects = await C.req('demo.ops', '/api/projects');
  t.ok((projects.json || []).every((p) => p.sector_id === 'SOLUTIONS'), 'العمليات ترى مشاريع قطاعها وحده');
  t.ok(!(projects.json || []).some((p) => p.id === ids.project.con_main), 'مشروع الاستشارات خارج نطاق العمليات');
});

// ③ وحدة المساندة ليست قطاع تسليم
scenario('support-units', 'وحدات المساندة: لا فرصة تُنسب إليها، وأشخاصها مورد مشترك', async ({ C, t, ids, D, dataset }) => {
  const create = await C.req('demo.admin', '/api/opportunities', { method: 'POST', body: {
    title_ar: D.tag('فرصة على وحدة مساندة'), sector_id: 'SHARED', value_sar: 1000, year: dataset.year } });
  t.status(create, 400, 'إنشاء فرصة داخل وحدة مساندة مرفوض');
  t.says(create, /وحدة مساندة/, 'الرسالة تشرح الفرق وتطلب اختيار قطاع تسليم');

  const move = await C.req('demo.admin', `/api/opportunities/${ids.opp.sol_a}/sector`, { method: 'POST',
    body: { sector: 'BDU', note: D.tag('نقل تجريبي') } });
  t.status(move, 400, 'نقل فرصة إلى وحدة مساندة مرفوض');

  const staffing = await C.req('demo.sectorlead', `/api/projects/${ids.project.sol_main}/staffing`);
  t.status(staffing, 200, 'قائد القطاع يفتح شاشة تسكين مشروعه');
  const available = (staffing.json?.available || []).map((e) => e.id);
  t.ok(available.includes(ids.emp.shr_arch), 'شخص وحدة المساندة متاح للتسكين على مشروع أي قطاع');
  t.ok(!available.includes(ids.emp.con_adv), 'شخص قطاع تسليم آخر غير متاح');
});

// ④ التسكين ثم فتح المشروع
scenario('staffing-access', 'التسكين: من يُسكَّن على مشروع يفتحه فعلاً، ومن يُرفع عنه يخرج منه', async ({ C, db, t, ids, remember }) => {
  const pid = ids.project.sol_main;
  const beforeStaff = await C.req('demo.consultant', `/api/projects/${pid}`);
  t.status(beforeStaff, 403, 'الاستشاري لا يفتح المشروع قبل تسكينه عليه');

  const assign = await C.req('demo.sectorlead', `/api/projects/${pid}/staff`, { method: 'POST',
    body: { employeeId: ids.emp.sol_eng, type: 'member', pct: 60, fromMonth: 1, toMonth: 12 } });
  t.status(assign, 200, 'قائد القطاع يسكّن مهندس الحلول على المشروع');
  const alloc = (assign.json?.assigned || []).find((a) => a.employee_id === ids.emp.sol_eng);
  t.ok(alloc, 'التسكين ظهر في كشف المشروع');
  remember('allocation', alloc?.id); ids.alloc.sol_eng = alloc?.id;

  const afterStaff = await C.req('demo.consultant', `/api/projects/${pid}`);
  t.status(afterStaff, 200, 'الاستشاري المرتبط بذلك الموظف صار يفتح المشروع بعد التسكين');
  const page = await C.req('demo.consultant', `/app/project/${pid}`);
  t.status(page, 200, 'ويفتح صفحة المشروع نفسها لا الواجهة البرمجية وحدها');
  t.ok(!/undefined|NaN|\[object/.test(page.text), 'صفحة المشروع بلا قيم مكسورة');

  const dup = await C.req('demo.sectorlead', `/api/projects/${pid}/staff`, { method: 'POST',
    body: { employeeId: ids.emp.sol_eng, pct: 20 } });
  t.status(dup, 400, 'تسكين مكرر لنفس الشخص على نفس المشروع مرفوض');

  const cross = await C.req('demo.sectorlead', `/api/projects/${pid}/staff`, { method: 'POST',
    body: { employeeId: ids.emp.con_adv, pct: 50 } });
  t.status(cross, 400, 'تسكين شخص من قطاع تسليم آخر مرفوض');

  const shared = await C.req('demo.sectorlead', `/api/projects/${pid}/staff`, { method: 'POST',
    body: { employeeId: ids.emp.shr_arch, pct: 40 } });
  t.status(shared, 200, 'تسكين شخص من وحدة مساندة مسموح بلا نقل');
  remember('allocation', (shared.json?.assigned || []).find((a) => a.employee_id === ids.emp.shr_arch)?.id);

  const outsider = await C.req('demo.employee', `/api/projects/${pid}/staff`, { method: 'POST',
    body: { employeeId: ids.emp.sol_ba, pct: 50 } });
  t.status(outsider, 403, 'الموظف العادي لا يسكّن أحداً');

  // الرفع: الوصول يتبع التسكين — يُسحب معه.
  const off = await C.req('demo.sectorlead', `/api/projects/staff/${ids.alloc.sol_eng}`, { method: 'DELETE' });
  t.status(off, 200, 'رفع التسكين');
  const row = await db.get('SELECT deleted_at FROM allocation WHERE id = ?', [ids.alloc.sol_eng]);
  t.ok(row?.deleted_at, 'التسكين حُذف حذفاً ناعماً — الصف باقٍ بعلامة حذف');
  const afterOff = await C.req('demo.consultant', `/api/projects/${pid}`);
  t.status(afterOff, 403, 'وبعد الرفع لم يعد الاستشاري يفتح المشروع');

  // نُعيده كي تبقى بقية السيناريوهات على حالة معلومة
  const back = await C.req('demo.sectorlead', `/api/projects/${pid}/staff`, { method: 'POST',
    body: { employeeId: ids.emp.sol_eng, type: 'member', pct: 60 } });
  remember('allocation', (back.json?.assigned || []).find((a) => a.employee_id === ids.emp.sol_eng)?.id);
});

// ⑤ المهام
scenario('tasks', 'المهام: إنشاء وإسناد وتعطيل وإنجاز — وحدود الإسناد', async ({ C, db, t, ids, D, remember, today }) => {
  const t1 = await C.req('demo.pm', '/api/tasks/quick', { method: 'POST', body: {
    title: D.tag('مهمة من مدير المشروع'), project_id: ids.project.sol_main,
    assignee_user_id: ids.user['demo.employee'], priority: 'P1', due_date: today, sector_id: 'SOLUTIONS' } });
  t.status(t1, 200, 'مدير المشروع ينشئ مهمة ويُسندها لموظف قطاعه');
  const tid = t1.json?.id; remember('task', tid);

  const mine = await C.req('demo.employee', '/api/tasks/mine');
  t.ok((mine.json || []).some((x) => x.id === tid), 'المهمة ظهرت في «مهامي» عند المُسنَد إليه');

  const noReason = await C.req('demo.employee', `/api/tasks/${tid}`, { method: 'PATCH', body: { status: 'BLOCKED' } });
  t.status(noReason, 400, 'تعطيل مهمة بلا سبب مكتوب مرفوض');
  t.says(noReason, /سبب التعطيل/, 'والرسالة تقول ماذا يُكتب لا أن الحقل «مطلوب»');

  const blocked = await C.req('demo.employee', `/api/tasks/${tid}`, { method: 'PATCH',
    body: { blocked_reason: D.tag('بانتظار بيانات الجهة'), status: 'BLOCKED' } });
  t.status(blocked, 200, 'الموظف يعطّل مهمته ويكتب سبب التعطيل');
  t.eq(blocked.json?.status, 'BLOCKED', 'الحالة صارت معطَّلة');
  t.ok(blocked.json?.blocked_reason, 'سبب التعطيل محفوظ');

  const done = await C.req('demo.employee', `/api/tasks/${tid}`, { method: 'PATCH', body: { status: 'DONE' } });
  t.status(done, 200, 'إنجاز المهمة');
  t.eq(done.json?.status, 'DONE', 'الحالة صارت منجزة');
  t.eq(done.json?.progress_pct, 100, 'الإنجاز صار ١٠٠٪ تلقائياً');
  t.ok(done.json?.completed_at, 'تاريخ الإنجاز كُتب');

  const steal = await C.req('demo.employee', `/api/tasks/${tid}`, { method: 'PATCH',
    body: { assignee_user_id: ids.user['demo.consultant'] } });
  t.status(steal, 403, 'الموظف لا يدفع مهمته إلى قائمة شخص آخر');

  const outsider = await C.req('demo.external', '/api/tasks/quick', { method: 'POST',
    body: { title: D.tag('مهمة من حساب خارجي'), sector_id: 'SOLUTIONS' } });
  t.status(outsider, 403, 'حساب البوابة الخارجية لا ينشئ مهاماً في دفاتر الشركة');

  // زرع مهمة في قطاع غيره: نطاق «خاصتي» يُثبِّت القطاع على قطاع صاحبه بدل رفض الطلب.
  const planted = await C.req('demo.employee', '/api/tasks/quick', { method: 'POST',
    body: { title: D.tag('مهمة شخصية'), sector_id: 'CONSULTING' } });
  t.status(planted, 200, 'الموظف ينشئ مهمة لنفسه');
  remember('task', planted.json?.id);
  t.eq(planted.json?.sector_id, 'SOLUTIONS', 'قطاع المهمة ثُبِّت على قطاع صاحبها لا على ما أرسله');

  const team = await C.req('demo.employee', '/api/tasks/team');
  t.status(team, 403, 'الموظف لا يفتح لوحة «مهام فريقي»');
  const dbg = await db.get('SELECT COUNT(*) n FROM task WHERE deleted_at IS NULL');
  t.ok(Number(dbg.n) > 0, 'جدول المهام غير فارغ');
});

// ⑥ نطاق قراءة الأشخاص والمهام: إدارة ← قطاع ← شركة
scenario('read-scopes', 'حدود القراءة: إدارة أضيق من قطاع أضيق من شركة', async ({ C, t, ids }) => {
  const dept = await C.req('demo.deptmgr', '/api/org/roster');
  t.status(dept, 200, 'مدير الإدارة يفتح كشف الفريق');
  const deptNames = (dept.json?.roster || []).map((e) => e.name_ar);
  t.ok(deptNames.length > 0, 'كشفه غير فارغ');
  t.ok(!deptNames.some((n) => n.includes('ماجد السبيعي')), 'ولا يرى أشخاص إدارة أخرى في قطاعه');

  const sector = await C.req('demo.sectorlead', '/api/org/roster');
  t.status(sector, 200, 'قائد القطاع يفتح الكشف');
  const secIds = (sector.json?.roster || []).map((e) => e.id);
  t.ok(secIds.includes(ids.emp.sol_eng) && secIds.includes(ids.emp.sol_pmo), 'ويرى إدارات قطاعه كلها');
  t.ok(!secIds.includes(ids.emp.con_adv), 'ولا يرى قطاعاً آخر');
  t.ok(secIds.length > deptNames.length, 'كشف القطاع أوسع من كشف الإدارة');

  const company = await C.req('demo.hr', '/api/org/roster');
  t.status(company, 200, 'الموارد البشرية تفتح الكشف');
  const hrIds = (company.json?.roster || []).map((e) => e.id);
  t.ok(hrIds.includes(ids.emp.con_adv) && hrIds.includes(ids.emp.sap_fun), 'وترى القطاعات كلها');

  for (const u of ['demo.ops', 'demo.procurement', 'demo.approver', 'demo.external']) {
    const r = await C.req(u, '/api/org/roster');
    t.status(r, 403, `${u} بلا منح قراءة الأشخاص`);
  }

  const teamTasks = await C.req('demo.deptmgr', '/api/tasks/team');
  t.status(teamTasks, 200, 'مدير الإدارة يفتح مهام فريقه');
  const people = (teamTasks.json || []).map((g) => g.name);
  t.ok(!people.some((n) => String(n).includes('ماجد السبيعي')), 'ولا تظهر له مهام شخص من إدارة أخرى');

  // التصدير باب ثانٍ على البيانات نفسها — ويجب أن ينتهي عند الحدّ نفسه.
  const csv = await C.req('demo.deptmgr', '/api/io/export/employees?format=csv');
  t.status(csv, 200, 'مدير الإدارة يصدّر كشف الأشخاص');
  t.ok(!/الراتب/.test(csv.text), 'وبلا عمود الراتب — الختم قائم في التصدير أيضاً');
  t.ok(!csv.text.includes('مستشار تجريبي'), 'ولا يحمل أشخاصاً من قطاع آخر');
});

// ⑦ ختم الراتب
scenario('salary-seal', 'ختم الراتب: لا يراه إلا مدير النظام — على كل الأسطح', async ({ C, t, seedMod }) => {
  for (const u of seedMod.DEMO_USERS) {
    const roster = await C.req(u.u, '/api/org/roster');
    if (u.role === 'admin') {
      t.status(roster, 200, 'مدير النظام يفتح الكشف');
      t.ok(/"salary_halalas":\s*[1-9]/.test(roster.text), 'ويستقبل الراتب فعلاً');
    } else if (roster.status === 200) {
      t.ok(!/"salary_halalas"/.test(roster.text), `${u.u} لا يستقبل حقل الراتب إطلاقاً`);
    }
    for (const page of ['/app/team', '/app/staffing']) {
      const p = await C.req(u.u, page);
      if (p.status !== 200 || u.role === 'admin') continue;
      t.ok(!/emp-sal/.test(p.text), `${u.u} لا يرى عمود الراتب في ${page}`);
      t.ok(!/"salary_(halalas|sar)":\s*[1-9]/.test(p.text), `${u.u} لا تُضخّ له قيم رواتب في ${page}`);
    }
  }
});

// ⑧ حجب الكلفة والهامش
scenario('sensitive-money', 'الكلفة والهامش: مكشوفة لمكتب الرئيس التنفيذي، محجوبة عن تطوير الأعمال', async ({ C, t, ids }) => {
  const fin = await C.req('demo.ceo', `/api/projects/${ids.project.sol_main}`);
  t.status(fin, 200, 'مكتب الرئيس التنفيذي يقرأ المشروع');
  const bd = await C.req('demo.bd', `/api/projects/${ids.project.sol_main}`);
  t.status(bd, 200, 'تطوير الأعمال يقرأ المشروع');
  t.eq(bd.json?.actual_spend_halalas, null, 'ولا تصله الكلفة الفعلية');
  t.eq(bd.json?.margin_pct, null, 'ولا نسبة الهامش');
  t.eq(bd.json?._redacted_margin_pct, true, 'والحقل مُعلَّم كمحجوب لا كصفر');
  t.eq(fin.json?._redacted_margin_pct, undefined, 'ولا يُعلَّم شيء كمحجوب في نسخته');
  t.ok('margin_pct' in (fin.json || {}), 'وحقل الهامش يصلها كما هو');
});

// ⑨ سجل الوقت وسلسلة الاعتماد
scenario('timesheets', 'سجل الوقت: التسجيل والحدود ثم رفع الفترة واعتمادها', async ({ C, db, t, ids, D, dataset, remember }) => {
  const p = dataset.timesheet.period;
  const bad = await C.req('demo.employee', '/api/timesheets', { method: 'POST',
    body: { hours: 3, entry_date: '٢٠٢٦/٠٧/٠١' } });
  t.status(bad, 400, 'تاريخ بصيغة غير مفهومة مرفوض');
  t.says(bad, /سنة-شهر-يوم/, 'والرسالة تقول الصيغة المطلوبة');

  const over = await C.req('demo.employee', '/api/timesheets', { method: 'POST',
    body: { hours: 20, entry_date: p.end } });
  t.status(over, 400, 'أكثر من ١٦ ساعة في اليوم مرفوض');

  const ok1 = await C.req('demo.employee', '/api/timesheets', { method: 'POST', body: {
    hours: 8, entry_date: p.end, task_id: ids.task.main_rev, project_id: ids.project.sol_main, note: D.tag('عمل') } });
  t.status(ok1, 200, 'تسجيل ٨ ساعات على مهمة من مشروعه');
  remember('time_entry', ok1.json?.id);
  const ok2 = await C.req('demo.employee', '/api/timesheets', { method: 'POST', body: {
    hours: 9, entry_date: p.end, project_id: ids.project.sol_main } });
  t.status(ok2, 400, 'ولا يتجاوز مجموع اليوم السقف بعد ذلك');

  const task = await db.get('SELECT actual_hours FROM task WHERE id = ?', [ids.task.main_rev]);
  t.eq(Number(task?.actual_hours), 8, 'الساعات رُحِّلت إلى المهمة نفسها');

  const foreign = await C.req('demo.employee', '/api/timesheets', { method: 'POST', body: {
    hours: 2, entry_date: p.start, task_id: ids.task.con_rep } });
  t.status(foreign, 403, 'لا يسجّل وقتاً على مهمة خارج عمله');

  for (const u of ['demo.external', 'demo.viewer']) {
    const r = await C.req(u, '/api/timesheets', { method: 'POST', body: { hours: 1, entry_date: p.end } });
    t.status(r, 403, `${u} لا يسجّل ساعات على دفاتر الشركة`);
  }

  const sub = await C.req('demo.employee', '/api/timesheets/submit', { method: 'POST',
    body: { periodStart: p.start, periodEnd: p.end } });
  t.status(sub, 200, 'رفع فترة سجل الوقت للاعتماد');
  const periodId = sub.json?.id; remember('timesheet_period', periodId);
  t.eq(sub.json?.status, 'SUBMITTED', 'الفترة صارت مرفوعة');
  const attached = await db.get('SELECT COUNT(*) n FROM time_entry WHERE period_id = ?', [periodId]);
  t.ok(Number(attached.n) >= 3, 'قيود الفترة ارتبطت بها');

  const byPeer = await C.req('demo.consultant', `/api/timesheets/${periodId}/approve`, { method: 'POST', body: { approve: true } });
  t.status(byPeer, 403, 'زميل بلا صلاحية اعتماد لا يعتمد فترة غيره');

  // حدّ الإدارة في اتجاهيه: «موظف» يتبع إدارة البنية الرقمية، ومدير الإدارة يقود إدارة تحول
  // الأعمال — فاعتماده لفترة من إدارة أخرى مرفوض. وهذا هو الاتجاه الذي بلا إثباته يصير
  // «المدير اعتمد» جملةً بلا معنى: لا بدّ من فترة يملكها ولا يملك غيرها.
  const acrossDept = await C.req('demo.deptmgr', `/api/timesheets/${periodId}/approve`, { method: 'POST', body: { approve: true } });
  t.status(acrossDept, 403, 'مدير الإدارة لا يعتمد فترة موظف من إدارة أخرى في قطاعه');

  // ومن إدارته: المدير المباشر يسجّل وقته ويرفعه، فيعتمده مدير الإدارة نفسها.
  const own = await C.req('demo.linemgr', '/api/timesheets', { method: 'POST',
    body: { hours: 4, entry_date: p.end, project_id: ids.project.sol_main, note: D.tag('عمل إشرافي') } });
  t.status(own, 200, 'المدير المباشر يسجّل وقته هو');
  remember('time_entry', own.json?.id);
  const sub2 = await C.req('demo.linemgr', '/api/timesheets/submit', { method: 'POST',
    body: { periodStart: p.start, periodEnd: p.end } });
  t.status(sub2, 200, 'ويرفع فترته');
  remember('timesheet_period', sub2.json?.id);
  const byMgr = await C.req('demo.deptmgr', `/api/timesheets/${sub2.json?.id}/approve`, { method: 'POST', body: { approve: true } });
  t.status(byMgr, 200, 'مدير الإدارة يعتمد فترة شخصٍ من إدارته');
  t.eq(byMgr.json?.status, 'APPROVED', 'الفترة صارت معتمَدة');
  t.ok(byMgr.json?.approved_by, 'ومن اعتمدها مسجَّل على الفترة');
});

// ⑩ الاعتمادات وفصل المهام
scenario('approvals', 'مسار الاعتماد: من يرفع لا يعتمد، ومن ليس معتمِداً يُرَد', async ({ C, t, ids, remember }) => {
  const sub = await C.req('demo.bd', '/api/approvals', { method: 'POST',
    body: { workflowKey: 'opportunity_go_nogo', resource: 'opportunity', resourceId: ids.opp.sol_b } });
  t.status(sub, 200, 'مدير تطوير الأعمال يرفع فرصته لقرار المشاركة');
  const rid = sub.json?.id; remember('approval_request', rid);

  const selfAct = await C.req('demo.bd', `/api/approvals/${rid}/act`, { method: 'POST', body: { action: 'approve' } });
  t.status(selfAct, 403, 'ولا يعتمد طلباً رفعه بنفسه');

  const wrongRole = await C.req('demo.pm', `/api/approvals/${rid}/act`, { method: 'POST', body: { action: 'approve' } });
  t.status(wrongRole, 403, 'ومن ليس معتمِد الخطوة يُرَد');

  const gibberish = await C.req('demo.sectorlead', `/api/approvals/${rid}/act`, { method: 'POST', body: { action: 'ربما' } });
  t.status(gibberish, 400, 'القرار اعتماد أو رفض لا ثالث لهما');

  const queue = await C.req('demo.sectorlead', '/api/approvals/queue');
  t.ok((queue.json || []).some((q) => q.id === rid), 'الطلب ظهر في طابور قائد القطاع');

  const act = await C.req('demo.sectorlead', `/api/approvals/${rid}/act`, { method: 'POST',
    body: { action: 'approve', comment: 'موافق' } });
  t.status(act, 200, 'قائد القطاع يعتمد');
  t.eq(act.json?.status, 'APPROVED', 'الطلب أُغلق معتمَداً');

  const closed = await C.req('demo.sectorlead', `/api/approvals/${rid}/act`, { method: 'POST', body: { action: 'reject' } });
  t.status(closed, 400, 'ولا يُعاد التصرّف في طلب مُغلق');

  const ext = await C.req('demo.external', '/api/approvals', { method: 'POST',
    body: { workflowKey: 'opportunity_go_nogo', resource: 'opportunity', resourceId: ids.opp.sol_a } });
  t.status(ext, 403, 'حساب البوابة الخارجية لا يفتح مساراً داخلياً');
});

// ⑪ المال: المستخلص والتحصيل والذمم
scenario('finance', 'المال: مستخلص من مخرجات، تحصيل بحدوده، وأرقام بالهللات', async ({ C, db, t, ids, D, remember }) => {
  const contract = ids.contract.sol_main;
  const none = await C.req('demo.ceo', '/api/finance/progress-claim', { method: 'POST',
    body: { contractId: contract, periodLabel: D.tag('الدفعة الأولى') } });
  t.status(none, 400, 'بلا مخرجات مسلَّمة لا مستخلص');
  t.says(none, /مخرجات مؤهلة/, 'والرسالة تقول ما ينقص');

  // المسار الواقعي كاملاً: المخرج يُسلَّم أولاً ثم يُفوتَر. كان يمرّ سابقاً بلا تسليم لأن تمرير
  // المعرّفات صراحةً كان يُسقط شرطَي الحالة والانتماء معاً — وهو العيب الذي أُصلح. فصار
  // السيناريو يمشي على الحقيقة: تغيير حالة المخرج إلى «مُسلَّم» عبر مساره، ثم إصدار المستخلص.
  const delivered = await C.req('demo.pm', `/api/pmo/deliverable/${ids.deliverable.sol_main[0]}`,
    { method: 'PATCH', body: { status: 'DELIVERED' } });
  t.status(delivered, 200, 'مدير المشروع يعلّم المخرج مُسلَّماً');

  const claim = await C.req('demo.ceo', '/api/finance/progress-claim', { method: 'POST',
    body: { contractId: contract, deliverableIds: [ids.deliverable.sol_main[0]], periodLabel: D.tag('الدفعة الأولى') } });
  t.status(claim, 200, 'إصدار مستخلص بمخرجات محدَّدة');
  const invId = claim.json?.id; remember('invoice', invId);
  t.eq(claim.json?.amount_halalas, 25_000_000, 'قيمة المستخلص = قيمة المخرج (٢٥٠ ألف ريال) بالهللات');
  t.ok(Number.isInteger(claim.json?.amount_halalas), 'المبلغ عدد صحيح');
  const lines = await db.all('SELECT id FROM invoice_line WHERE invoice_id = ?', [invId]);
  for (const l of lines) remember('invoice_line', l.id);
  t.eq(lines.length, 1, 'بند واحد على الفاتورة');

  const bd = await C.req('demo.bdhead', '/api/finance/collections', { method: 'POST',
    body: { invoiceId: invId, amountSar: 1000 } });
  t.status(bd, 403, 'رئيس تطوير الأعمال يقرأ المال ولا يكتبه');

  const tooMuch = await C.req('demo.ceo', '/api/finance/collections', { method: 'POST',
    body: { invoiceId: invId, amountSar: 900_000 } });
  t.status(tooMuch, 400, 'تحصيل يتجاوز المتبقي مرفوض');

  const part = await C.req('demo.ceo', '/api/finance/collections', { method: 'POST',
    body: { invoiceId: invId, amountSar: 100_000, collectedAt: '2026-07-01', method: 'تحويل' } });
  t.status(part, 200, 'تحصيل جزئي');
  t.eq(part.json?.status, 'PARTIALLY_PAID', 'الفاتورة صارت محصَّلة جزئياً');
  for (const c of await db.all('SELECT id FROM collection WHERE invoice_id = ?', [invId])) remember('collection', c.id);

  const rest = await C.req('demo.ceo', '/api/finance/collections', { method: 'POST',
    body: { invoiceId: invId, amountSar: 150_000, collectedAt: '2026-07-05' } });
  t.status(rest, 200, 'تحصيل الباقي');
  t.eq(rest.json?.status, 'PAID', 'الفاتورة صارت مسدَّدة');
  for (const c of await db.all('SELECT id FROM collection WHERE invoice_id = ?', [invId])) remember('collection', c.id);

  const sum = await C.req('demo.ceo', '/api/finance/summary?year=2026');
  t.status(sum, 200, 'الملخص المالي على مستوى الشركة');
  for (const k of ['bookings_halalas', 'revenue_halalas', 'invoiced_halalas', 'collected_halalas', 'ar_halalas']) {
    t.ok(Number.isInteger(sum.json?.[k]), `${k} عدد صحيح بالهللات`);
  }
  t.eq(sum.json?.collected_halalas, 25_000_000, 'المحصَّل = ٢٥٠ ألف ريال بالهللات');

  const secSum = await C.req('demo.sectorlead', '/api/finance/summary?year=2026');
  t.status(secSum, 200, 'وقائد القطاع يرى ملخص قطاعه');
  t.ok(secSum.json.invoiced_halalas <= sum.json.invoiced_halalas, 'ورقم القطاع لا يتجاوز رقم الشركة');

  const byContract = await C.req('demo.ceo', '/api/finance/by-contract');
  t.ok((byContract.json || []).some((c) => c.id === contract), 'العقد يظهر في كشف العقود');

  const c360 = await C.req('demo.ceo', `/api/clients/${ids.client.gov}/360`);
  t.status(c360, 200, 'صفحة العميل المالية تفتح');
  t.ok(!/undefined|NaN/.test(c360.text), 'وبلا قيم مكسورة');
});

// ⑫ الحذف الناعم — والصدق حياله
scenario('soft-delete', 'الحذف الناعم: يختفي من الكشوف والصف باقٍ في الجدول', async ({ C, db, t, ids }) => {
  const eid = ids.emp.sol_leaver;
  const before = await C.req('demo.hr', '/api/org/roster');
  t.ok((before.json?.roster || []).some((e) => e.id === eid), 'الشخص ظاهر في الكشف قبل الحذف');

  const bySector = await C.req('demo.sectorlead', `/api/employees/${eid}`, { method: 'DELETE' });
  t.status(bySector, 403, 'قائد القطاع لا يحذف موظفاً — الحذف للموارد البشرية');

  const del = await C.req('demo.hr', `/api/employees/${eid}`, { method: 'DELETE' });
  t.status(del, 200, 'الموارد البشرية تحذف السجل');
  const after = await C.req('demo.hr', '/api/org/roster');
  t.ok(!(after.json?.roster || []).some((e) => e.id === eid), 'واختفى من الكشف فوراً');
  const row = await db.get('SELECT id, deleted_at, active FROM employee WHERE id = ?', [eid]);
  t.ok(row, 'والصف ما زال موجوداً في الجدول — الحذف الناعم لا يحذف');
  t.ok(row?.deleted_at, 'وعليه علامة الحذف');
  t.eq(row?.active, 0, 'وصار غير نشط');
});

// ⑬ حواجز الكتابة: التكرار، والحذف وفيه عمل، والحدود بين القطاعات
scenario('write-guards', 'حواجز الكتابة: لا اسم مكرر، ولا حذفَ يُخفي عملاً، ولا كتابةَ خارج الحدّ',
  async ({ C, t, ids, D, dataset }) => {
    const dupEmp = await C.req('demo.hr', '/api/org/employees', { method: 'POST',
      body: { name_ar: dataset.people[0].name_ar, sector_id: 'SOLUTIONS' } });
    t.status(dupEmp, 400, 'اسم موظف مكرر مرفوض');
    t.says(dupEmp, /مستخدم بالفعل/, 'والرسالة تدعو لاسم مختلف أو تعديل السجل القائم');

    // التطبيع لا الحرفية: مسافة زائدة وألف بلا همزة لا تصنعان شخصاً ثانياً.
    const near = dataset.people[0].name_ar.replace(/\s+/g, '  ').replace(/أ/g, 'ا');
    const dupNear = await C.req('demo.hr', '/api/org/employees', { method: 'POST',
      body: { name_ar: near, sector_id: 'SOLUTIONS' } });
    t.status(dupNear, 400, 'واسمٌ يختلف بالمسافات وصور الهمزة يُقرأ الاسم نفسه');

    const dupClient = await C.req('demo.bd', '/api/clients', { method: 'POST',
      body: { name_ar: dataset.clients[0].name_ar } });
    t.status(dupClient, 400, 'اسم عميل مكرر مرفوض');

    const depWithStaff = await C.req('demo.admin', `/api/org/departments/${ids.dept.sol_platform}`, { method: 'DELETE' });
    t.status(depWithStaff, 400, 'حذف إدارة وبها أشخاص مرفوض');
    t.says(depWithStaff, /انقلهم/, 'والرسالة تقول ماذا يُفعل قبل الحذف');

    const toSupport = await C.req('demo.admin', '/api/org/sectors/SOLUTIONS', { method: 'PATCH',
      body: { kind: 'support' } });
    t.status(toSupport, 400, 'تحويل قطاع تسليم فيه عمل إلى وحدة مساندة مرفوض');
    t.says(toSupport, /مشروع|فرصة/, 'والرسالة تعدّ العمل الذي يمنع التحويل');

    const foreignDept = await C.req('demo.sectorlead', '/api/org/departments', { method: 'POST',
      body: { sector_id: 'CONSULTING', name_ar: D.tag('إدارة في قطاع غيري') } });
    t.status(foreignDept, 403, 'قائد القطاع لا ينشئ إدارة في قطاع آخر');

    const moveOut = await C.req('demo.sectorlead', `/api/org/employees/${ids.emp.sol_ba}`, { method: 'PATCH',
      body: { sector_id: 'CONSULTING' } });
    t.status(moveOut, 403, 'ولا ينقل موظفه إلى قطاع لا يملك عليه صلاحية');

    for (const [path, body] of [['/api/opportunities', { title_ar: D.tag('فرصة من مشاهد') }],
      ['/api/projects', { name_ar: D.tag('مشروع من مشاهد') }], ['/api/clients', { name_ar: D.tag('عميل من مشاهد') }]]) {
      t.status(await C.req('demo.viewer', path, { method: 'POST', body }), 403, `المشاهد لا يكتب في ${path}`);
    }

    const foreignTask = await C.req('demo.employee', `/api/tasks/${ids.task.con_rep}`, { method: 'PATCH',
      body: { status: 'DONE' } });
    t.status(foreignTask, 403, 'الموظف لا يُنجز مهمة شخص آخر في قطاع آخر');

    const ghost = await C.req('demo.admin', '/api/projects/scn_project_ghost', { method: 'PATCH', body: { rag: 'RED' } });
    t.status(ghost, 404, 'تعديل مشروع غير موجود يردّ «غير موجود» لا خطأً عاماً');
    t.says(ghost, /غير موجود/, 'برسالة عربية واضحة');

    const badRag = await C.req('demo.pm', `/api/projects/${ids.project.sol_main}`, { method: 'PATCH',
      body: { rag: 'PURPLE' } });
    t.status(badRag, 400, 'وقيمة حالة غير معروفة تُرَد قبل الحفظ');
  });

// ⑭ مقاييس القيادة
scenario('leadership-metrics', 'أرقام القيادة: منحٌ قيادي لا مجرد اتساع نافذة', async ({ C, t }) => {
  const allowed = ['demo.admin', 'demo.ceo', 'demo.hr', 'demo.bdhead'];
  const denied = ['demo.sectorlead', 'demo.bd', 'demo.pm', 'demo.consultant', 'demo.employee',
    'demo.viewer', 'demo.deptmgr', 'demo.linemgr', 'demo.ops', 'demo.procurement', 'demo.approver', 'demo.external'];
  for (const u of allowed) t.status(await C.req(u, '/api/metrics/company'), 200, `${u} يقرأ أداء الشركة`);
  for (const u of denied) t.status(await C.req(u, '/api/metrics/company'), 403, `${u} لا يقرأ أداء الشركة`);
  const sec = await C.req('demo.sectorlead', '/api/metrics/sector/SOLUTIONS');
  t.status(sec, 200, 'قائد القطاع يقرأ مقاييس قطاعه');
  t.status(await C.req('demo.sectorlead', '/api/metrics/sector/CONSULTING'), 403, 'ولا يقرأ مقاييس قطاع آخر');
  t.status(await C.req('demo.external', '/api/metrics/sector/SOLUTIONS'), 403, 'والحساب الخارجي لا يقرأ مقاييس قطاع');
});

// ⑭ كل صفحة لكل شخص (بطيء — يُستثنى في الوضع المختصر)
scenario('pages', 'كل صفحة لكل شخص: الحالة مطابقة لسياسة الفتح وبلا قيم مكسورة', async ({ C, t, seedMod }) => {
  const { PAGE_ACCESS } = await import('../src/core/policy/pages.js');
  const pages = Object.keys(PAGE_ACCESS);
  for (const u of seedMod.DEMO_USERS) {
    const me = await C.req(u.u, '/auth/me');
    t.status(me, 200, `${u.u} جلسته حيّة`);
    const shape = { role_id: u.role, scope: u.scope, sector_id: u.sector ?? null };
    for (const page of pages) {
      const expect = PAGE_ACCESS[page](shape) ? 200 : 403;
      const r = await C.req(u.u, `/app/${page}`);
      t.status(r, expect, `${u.u} ← /app/${page}`);
      if (r.status === 200) {
        t.ok(!/undefined|NaN|\[object Object\]/.test(r.text), `${u.u} ← /app/${page} بلا قيم مكسورة`);
      }
    }
  }
}, { slow: true });

// ⑮ العيوب المؤكَّدة — تثبيتٌ للسلوك القائم مع بيان الصواب
// كان اسمها «عيوب مؤكَّدة» حين كانت تُثبِّت سلوكاً خاطئاً كي لا يمرّ صامتاً. عولجت كلها قبل
// التفعيل لكل الموظفين، فصارت تحرس **الصواب** بدل أن توثّق الخطأ — والاسم يتبع المعنى.
scenario('defects', 'حراسة ما عولج: كل عيب مثبَّت سابقاً صار فحصاً دائماً على الصواب', async ({ C, db, t, ids, D, remember }) => {
  const W = await import('../src/modules/workflow/engine.js');
  // ① [عولج — كان SCN-D1] المستخلص بمعرّفات صريحة كان يُسقط شرطَي الأهلية معاً: «المخرج من مشروع
  //    هذا العقد» و«حالته تسمح بالمطالبة». صار الشرطان قائمين مهما كان شكل الطلب، والرفض صريح
  //    يسمّي سببه. التثبيت تحوّل إلى فحصٍ دائم: عودة العطل تُسقط السيناريو لا تُبدّل رقم تثبيت.
  const foreignDeliverable = ids.deliverable.con_main[0];
  const cross = await C.req('demo.ceo', '/api/finance/progress-claim', { method: 'POST',
    body: { contractId: ids.contract.sol_side, deliverableIds: [foreignDeliverable] } });
  if (cross.status === 200) { remember('invoice', cross.json?.id);  // شبكة أمان لو عاد العطل: لا يبقى أثر
    for (const l of await db.all('SELECT id FROM invoice_line WHERE invoice_id = ?', [cross.json?.id])) remember('invoice_line', l.id); }
  t.status(cross, 400, 'مستخلص عقدِ قطاعٍ يرفض مخرج مشروع قطاع آخر');
  t.says(cross, /من مشروع آخر/, 'ويقول سبب الرفض بدل إسقاط المخرج بصمت');
  const foreignAfter = await db.get('SELECT status FROM deliverable WHERE id = ?', [foreignDeliverable]);
  t.ok(foreignAfter?.status !== 'INVOICED', 'والمخرج الغريب لم يُختم مفوتراً فيخسره مشروعه الحقيقي');

  // ② إنشاء موظف يكتب الراتب بلا بوابة الراتب — والختم مطبَّق على القراءة والتعديل وحدهما.
  const salaried = await C.req('demo.sectorlead', '/api/org/employees', { method: 'POST', body: {
    name_ar: D.tag('موظف براتب من قائد القطاع'), sector_id: 'SOLUTIONS', job_title: 'مختبِر', salary_sar: 12_345 } });
  if (salaried.status === 200) remember('employee', salaried.json?.id);
  const stored = salaried.json?.id ? await db.get('SELECT salary_halalas FROM employee WHERE id = ?', [salaried.json.id]) : null;
  // أُصلح: الختم صار يشمل الكتابة لا القراءة والتعديل وحدهما. قائد القطاع يُنشئ الموظف
  // ويُتجاهَل الراتب الذي أرسله — كما يفعل updateEmployee تماماً.
  t.ok(salaried.status === 200, 'قائد القطاع ما زال يُنشئ موظفاً في قطاعه');
  t.ok(stored?.salary_halalas == null,
    `الراتب المُرسَل من غير مالك بوابته لا يُكتب — المخزَّن: ${stored?.salary_halalas}`);

  // ③ الموظف بلا راتب معروف يُخزَّن صفراً — فلا يُفرَّق بين «صفر» و«غير معروف».
  const noSalary = await C.req('demo.hr', '/api/org/employees', { method: 'POST', body: {
    name_ar: D.tag('موظف بلا راتب مُدخَل'), sector_id: 'STRATEGIC', job_title: 'مختبِر' } });
  if (noSalary.status === 200) remember('employee', noSalary.json?.id);
  const zero = noSalary.json?.id ? await db.get('SELECT salary_halalas FROM employee WHERE id = ?', [noSalary.json.id]) : null;
  // أُصلح: «لم يُدخَل» و«بلا أجر» لم يعودا شيئاً واحداً. الفراغ يبقى فراغاً.
  t.ok(zero?.salary_halalas == null,
    `راتب غير مُدخَل يبقى فارغاً لا صفراً — المخزَّن: ${zero?.salary_halalas}`);

  // ④ [عولج — كان SCN-D4] سنة التسكين كانت من ساعة الخادم دائماً، فخطة السنة القادمة تُكتب
  // على العام الجاري صامتةً. صارت تُقبل من الطلب ضمن مدى معقول، والتكرار يُقاس داخل السنة.
  const alloc = await db.get('SELECT year FROM allocation WHERE project_id = ? AND deleted_at IS NULL LIMIT 1',
    [ids.project.sol_main]);
  t.ok(Number(alloc?.year) > 2000, `سنة التسكين مكتوبة: ${alloc?.year}`);
  const nextYear = new Date().getUTCFullYear() + 1;
  const planned = await C.req('demo.pm', `/api/projects/${ids.project.sol_main}/staff`, { method: 'POST',
    body: { employeeId: ids.emp.sol_ba, pct: 40, fromMonth: 1, toMonth: 6, year: nextYear } });
  t.status(planned, 200, 'مدير المشروع يخطّط تسكين السنة القادمة');
  const nextRow = await db.get('SELECT id, year FROM allocation WHERE project_id = ? AND employee_id = ? AND year = ? AND deleted_at IS NULL',
    [ids.project.sol_main, ids.emp.sol_ba, nextYear]);
  t.ok(!!nextRow, `تسكين ${nextYear} مكتوب بسنته لا بسنة الخادم`);
  if (nextRow) remember('allocation', nextRow.id);
  const badYear = await C.req('demo.pm', `/api/projects/${ids.project.sol_main}/staff`, { method: 'POST',
    body: { employeeId: ids.emp.sol_ba, pct: 10, year: new Date().getUTCFullYear() + 9 } });
  t.status(badYear, 400, 'وسنة خارج المدى تُرَدّ بدل أن تُكتب');

  // ⑤ [عولج — كان SCN-D5] سقف الخطوة كان مخزَّناً ولا يُطبَّق، فكل مبلغ يمرّ بكل خطوة —
  // حوكمة تُبطئ الصغير ولا تُميّز الكبير. صار السقف يُطبَّق: تُتخطّى الخطوة دون سقفها.
  const step = await db.get("SELECT workflow_id, step_order, min_amount_halalas FROM approval_step WHERE min_amount_halalas > 0 ORDER BY step_order LIMIT 1");
  if (step) {
    const cap = Number(step.min_amount_halalas);
    const below = await W.nextApplicableStep(step.workflow_id, step.step_order, Math.max(0, cap - 1));
    const above = await W.nextApplicableStep(step.workflow_id, step.step_order, cap);
    t.ok(below?.step_order !== step.step_order, 'مبلغ دون السقف لا يقف عند الخطوة ذات السقف');
    t.ok(above?.step_order === step.step_order, 'ومبلغ يبلغ السقف يقف عندها');
  } else {
    t.ok(true, 'لا خطوة بسقف في هذه البيانات — لا شيء يُقاس');
  }

  // ⑥ تصدير الأشخاص يقف عند القطاع لا عند الإدارة — بينما كشف الفريق نفسه يقف عند الإدارة.
  const csv = await C.req('demo.deptmgr', '/api/io/export/employees?format=csv');
  const otherDepartment = 'ماجد السبيعي';               // من إدارة أخرى داخل القطاع نفسه
  // أُصلح: التصدير صار يمرّ على دالة النطاق نفسها التي تحرس الشاشة (peopleScope)، فالملف
  // الذي يخرج من المنصة لا يحمل أكثر مما تحمله الشاشة — والملف لا يُسترجَع بعد إرساله.
  t.ok(csv.status === 200, 'مدير الإدارة ما زال يصدّر إدارته');
  t.ok(!csv.text.includes(otherDepartment),
    'ولا يحمل الملف اسماً من إدارة أخرى داخل القطاع نفسه');

  // ⑦ (خللٌ أُصلح) «مهام فريقي» كانت مشروطة بمنح **تعديل** المهام، فيُرَدّ «المدير المباشر»
  // ٤٠٣ على الشاشة الوحيدة التي وُجد الدور لها — وكل منحه قراءةٌ بنطاق إدارته. صارت الرؤية
  // على منح القراءة والكتابة وحدها على منح التعديل.
  const lm = await C.req('demo.linemgr', '/api/tasks/team');
  t.status(lm, 200, 'المدير المباشر يفتح لوحة مهام فريقه (قراءة)');
  const lmWrite = await C.req('demo.linemgr', '/api/tasks/bulk', { method: 'PATCH', body: { ids: ['x'], patch: { priority: 'P0' } } });
  t.ok(lmWrite.status !== 200 || (lmWrite.json?.updated === 0),
    'ولا يكتب فيها: التعديل يبقى على منح التعديل وحده');

  // ⑧ [عولج — كان SCN-D8] الفرصة المكسوبة كانت تعود إلى الترشيح بضغطة واحدة **والمبيعات
  // المعلنة تتغيّر بها** بلا سبب ولا أثر. صار التراجع يستوجب سبباً مكتوباً ويُسجَّل بقيمته.
  const back = await C.req('demo.bd', `/api/opportunities/${ids.opp.sol_a}/stage`, { method: 'POST', body: { stage: 'WON' } });
  t.status(back, 200, 'التقدّم إلى الفوز مفتوح كما كان');
  const bare = await C.req('demo.bd', `/api/opportunities/${ids.opp.sol_a}/stage`, { method: 'POST', body: { stage: 'LEAD' } });
  t.status(bare, 400, 'والتراجع بلا سبب مكتوب مردود');
  const withReason = await C.req('demo.bd', `/api/opportunities/${ids.opp.sol_a}/stage`,
    { method: 'POST', body: { stage: 'LEAD', note: 'العميل ألغى الترسية' } });
  t.status(withReason, 200, 'وبسببٍ مكتوب يمرّ');
  const revAudit = await db.get(
    "SELECT detail_json FROM audit_log WHERE resource = 'opportunity' AND resource_id = ? AND action = 'update' ORDER BY at DESC LIMIT 1",
    [ids.opp.sol_a]);
  t.ok(revAudit && JSON.parse(revAudit.detail_json).won_reversal === true,
    'ويُسجَّل التراجع حدثاً مميَّزاً لا تغيير مرحلة عادياً');
  for (const h of await db.all('SELECT id FROM opportunity_stage_history WHERE opportunity_id = ?', [ids.opp.sol_a])) {
    remember('opportunity_stage_history', h.id);
  }
});

// ⑯ دقّة المال والبحث: الهللات أعداد صحيحة، والبحث يرث نطاق قوائمه
scenario('money-and-search', 'المال بالهللات الصحيحة، والبحث لا يتجاوز نطاق صاحبه', async ({ C, db, t, ids, D, dataset, remember }) => {
  const frac = await C.req('demo.bd', '/api/opportunities', { method: 'POST', body: {
    title_ar: D.tag('فرصة بكسور عشرية'), sector_id: 'SOLUTIONS', value_sar: 12_345.67,
    stage_id: 'LEAD', year: dataset.year } });
  t.status(frac, 200, 'إنشاء فرصة بقيمة فيها كسر عشري');
  remember('opportunity', frac.json?.id);
  t.eq(frac.json?.value_halalas, 1_234_567, 'القيمة تُخزَّن ١٢٣٤٥٦٧ هللة بلا كسر');
  t.ok(Number.isInteger(frac.json?.value_halalas), 'والمخزَّن عدد صحيح');
  const raw = await db.get('SELECT value_halalas FROM opportunity WHERE id = ?', [frac.json?.id]);
  t.eq(raw?.value_halalas, 1_234_567, 'وفي الجدول نفسه كذلك');

  const pipeline = await C.req('demo.sectorlead', '/api/pipeline');
  t.status(pipeline, 200, 'ملخص خط الفرص');
  t.ok((pipeline.json || []).every((s) => Number.isInteger(s.value_halalas)), 'كل مجاميع المراحل أعداد صحيحة');

  const metrics = await C.req('demo.ceo', '/api/metrics/company');
  t.status(metrics, 200, 'مقاييس الشركة');
  t.ok(!/\d+\.\d{3,}/.test(JSON.stringify(metrics.json || {})), 'وبلا أرقام كسرية طويلة تشي بحساب عائم');

  const found = await C.req('demo.bd', `/api/search?q=${encodeURIComponent('فرصة دراسة حوكمة')}`);
  t.status(found, 200, 'البحث يعمل');
  const titles = JSON.stringify(found.json || []);
  t.ok(!titles.includes(ids.opp.con_a), 'ولا يُظهر فرصة قطاع لا يصل إليه صاحب البحث');
  const mineFound = await C.req('demo.bd', `/api/search?q=${encodeURIComponent('فرصة منصة الخدمات')}`);
  t.ok(JSON.stringify(mineFound.json || []).includes(ids.opp.sol_a), 'ويُظهر فرص قطاعه هو');
});

// ─────────────────────────────────────────────────────────────────────────────
// المساعد الذكي — أدوات مشتركة بين لِحاقَيه (الحوكمة السريع، والمصفوفة البطيئة)
// ─────────────────────────────────────────────────────────────────────────────
// سؤال المالك حرفياً: «هل إجاباته دقيقة؟». وهو سؤال قابل للإجابة **لأن المحرّك محلي حتمي**:
// نقارن الأرقام المذكورة في الردّ باستعلام مباشر على القاعدة تحت **نفس مرشّح النطاق**. مع
// محرّك لغوي خارجي لا يمكن هذا الفحص أصلاً — الإجابة تتغيّر من مرة إلى أخرى.
const AI_INTENTS = [
  { key: 'summarize_project', ar: 'ملخّص مشروع', msg: (d) => `لخّص حالة ${d.projects.find((p) => p.key === 'sol_main').name_ar}` },
  { key: 'weekly_report', ar: 'الموجز الأسبوعي', msg: () => 'اكتب الموجز التنفيذي الأسبوعي' },
  { key: 'detect_risks', ar: 'كشف المخاطر', msg: () => 'ما المخاطر البارزة' },
  { key: 'data_quality', ar: 'جودة البيانات', msg: () => 'افحص جودة البيانات' },
  { key: 'suggest_priorities', ar: 'الأولويات', msg: () => 'ما أولوياتي اليوم' },
  { key: 'create_task', ar: 'إنشاء مهمة', msg: () => 'أنشئ مهمة متابعة العرض' },
  { key: 'update_task_status', ar: 'تحديث حالة مهمة', msg: () => 'حدّث حالة مهمة المراجعة' },
];

// شكل الحساب كما تراه بوابات الصلاحيات (نفس حيلة سيناريو «كل صفحة لكل شخص»).
const shapeOf = (u) => ({ role_id: u.role, scope: u.scope, sector_id: u.sector ?? null,
  projectIds: new Set(), teamIds: new Set() });

// هل يُتوقَّع أن يجيب المساعد هذا الدور عن هذه النية — مشتقّاً من المنح نفسها لا من قائمة مكتوبة.
function aiAllows(rbac, policy, u, intentKey) {
  const s = shapeOf(u);
  switch (intentKey) {
    case 'weekly_report': return policy.seesCompanyPerformance(s);
    case 'summarize_project':
    case 'detect_risks': return !!rbac.effectiveScope(s, 'read', 'project');
    case 'create_task': return rbac.can(s, 'create', 'task');
    case 'update_task_status': return rbac.can(s, 'update', 'task');
    default: return true;
  }
}

// قيم يجب ألا تظهر في أي ردّ لأي دور: الرواتب المخزَّنة بكل صيغها + كلمة الراتب نفسها.
async function forbiddenMoney(db, fmtSar, toSar) {
  const rows = await db.all('SELECT salary_halalas FROM employee WHERE salary_halalas IS NOT NULL AND salary_halalas > 0');
  const out = new Set();
  for (const r of rows) {
    out.add(String(r.salary_halalas));
    out.add(String(toSar(r.salary_halalas)));
    out.add(fmtSar(r.salary_halalas));
    out.add(new Intl.NumberFormat('en-US').format(toSar(r.salary_halalas)));
  }
  return [...out];
}

const RAW_ENUM_IN_REPLY = /\b(RED|AMBER|GREEN|IN_PROGRESS|NOT_STARTED|ON_HOLD|TODO|BLOCKED|DONE|CANCELLED|QUALIFIED|NEGOTIATION|PROPOSAL|P0|P1|P2|P3)\b/;

// **النص الذي يقرأه المستخدم** من ردّ المساعد: الردّ + تسميات النموذج والخيارات. قيم الحقول
// (مثل رمز الأهمية) ليست نصاً معروضاً بل قيمة تُرسَل للخادم وتُعرَض للمستخدم بتسميتها العربية
// من «الخيارات» — نفس تمييز فاحص المعجم بين النص وقيم value/data-.
const aiVisibleText = (json) => {
  if (!json) return '';
  const parts = [json.reply || ''];
  const f = json.form;
  if (f) {
    parts.push(f.title_ar || '', f.submit_ar || '', f.hint_ar || '');
    for (const fld of f.fields || []) parts.push(fld.label_ar || '', fld.help_ar || '');
  }
  for (const c of json.choices || []) parts.push(c.label_ar || '');
  return parts.join(' · ');
};

// مطابقة رقم **ككلٍّ** لا كجزء من رقم أكبر: «20,000» موجودة داخل «1,020,000» فتُنتج إنذاراً
// كاذباً — وشركة استشارية أرقامُها تتصادف مع مبالغ الرواتب بحكم المقادير.
const containsNumber = (text, num) =>
  new RegExp(`(?<![\\d.,])${String(num).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d.,])`).test(text);

// فحصٌ يُطبَّق على **كل** ردّ من **كل** دور: ختم الراتب، وبلا قيم خام، وبلا رمز تأكيد.
function aiSealCheck(t, who, label, res, { salaries, foreignNames }) {
  const body = res.status === 200 ? aiVisibleText(res.json) : (res.json?.error?.message || '');
  for (const s of salaries) {
    if (containsNumber(body, s)) { t.ok(false, `${who} · ${label}: رقم راتب في الردّ`, s); return; }
  }
  t.ok(!/راتب/.test(body), `${who} · ${label}: لا ذكر للراتب في الردّ`);
  t.ok(!RAW_ENUM_IN_REPLY.test(body), `${who} · ${label}: بلا قيمة مخزَّنة خام في نصٍّ عربي`,
    (body.match(RAW_ENUM_IN_REPLY) || [])[0]);
  t.ok(!/undefined|NaN|\[object/.test(body), `${who} · ${label}: بلا قيم مكسورة`);
  if (res.status === 200) t.ok(!('applyToken' in (res.json || {})), `${who} · ${label}: الدردشة بلا رمز تأكيد`);
  for (const [name, reachable] of foreignNames) {
    if (!reachable) t.ok(!body.includes(name), `${who} · ${label}: لا يتسرّب اسم «${name}» من خارج نطاقه`);
  }
}

// ⑰ حوكمة المساعد (سريع — يبقى في الفحص الآلي)
scenario('ai-governance', 'المساعد: محرّك محلي، ولا كتابة بلا معاينة وتأكيد', async ({ C, db, D, t, ids, dataset, remember }) => {
  const rbac = await import('../src/core/rbac/index.js');
  const { fmtSar, toSar } = await import('../src/core/util/ids.js');

  // ① أول فحص وأهمّه: المحرّك محلي. مفتاح مزوّد في البيئة يُسقط اللِحاق صراحةً ولا يمرّ صامتاً.
  t.ok(!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY,
    'لا مفتاح مزوّد خارجي في بيئة التشغيل — قرار المالك أن يبقى المحرّك داخل المنصة');
  t.ok(process.env.AI_ENGINE !== 'provider', 'ولا إعلان نية لتشغيل مزوّد خارجي');
  const st = await C.req('demo.admin', '/api/ai/status');
  t.status(st, 200, 'حالة المساعد تُقرأ');
  t.eq(st.json?.mode, 'local', 'المحرّك محلي — لا تغادر بيانات الشركة المنصة');
  t.eq(st.json?.modeLabel, 'محلي', 'ويُقال ذلك للمستخدم بالعربية');
  t.eq(st.json?.configured, false, 'ولا مزوّد خارجي مفعَّل');
  t.ok(!/API|KEY|OPENAI|ANTHROPIC/i.test(st.json?.note || ''), 'ونصّ الحالة لا يسمّي إعداداً تقنياً');

  // بطاقات الاقتراح مُرشَّحة بمنح كل دور: لا تُعرض بطاقة لعملٍ يردّه الخادم.
  const procSt = await C.req('demo.procurement', '/api/ai/status');
  t.ok(!(procSt.json?.suggestions || []).some((s) => s.intent === 'weekly_report'),
    'المشتريات لا تُعرض له بطاقة أرقام الشركة');
  t.ok((procSt.json?.suggestions || []).every((s) => /[؀-ۿ]/.test(s.label_ar)), 'كل بطاقة بعنوان عربي');

  // ② ثابت السلامة: الدردشة لا تُصدر رمز تأكيد ولا تكتب شيئاً — لكل دور ولكل نصّ.
  const tasksBefore = Number((await db.get('SELECT COUNT(*) n FROM task')).n);
  const oppsBefore = Number((await db.get('SELECT COUNT(*) n FROM opportunity')).n);
  for (const u of ['demo.admin', 'demo.sectorlead', 'demo.employee', 'demo.external']) {
    for (const msg of ['أنشئ مهمة عاجلة الآن', 'انقل الفرصة إلى فائزة', 'غيّر كل شيء']) {
      const r = await C.req(u, '/api/ai/chat', { method: 'POST', body: { message: msg } });
      t.ok([200, 403].includes(r.status), `${u} ← «${msg}» ردٌّ مفهوم`, `الحالة ${r.status}`);
      if (r.status === 200) t.ok(!('applyToken' in r.json) && !('preview' in r.json),
        `${u}: الدردشة لا تُصدر رمز تأكيد مهما كان النص`);
    }
  }
  t.eq(Number((await db.get('SELECT COUNT(*) n FROM task')).n), tasksBefore, 'ولا مهمة واحدة أُنشئت من دردشة');
  t.eq(Number((await db.get('SELECT COUNT(*) n FROM opportunity')).n), oppsBefore, 'ولا فرصة تحرّكت');

  // ③ الخيارات: كل معرّف تعرضه الواجهة صادر من الخادم ومُرشَّح بالنطاق.
  const opts = await C.req('demo.sectorlead', '/api/ai/options/project');
  t.status(opts, 200, 'قائمة المشاريع للنموذج');
  const conName = dataset.projects.find((p) => p.key === 'con_main').name_ar;
  t.ok(!(opts.json?.options || []).some((o) => o.label_ar === conName),
    'ولا تُعرض عليه مشاريع قطاع آخر ليختارها أصلاً');
  t.status(await C.req('demo.employee', '/api/ai/options/opportunity'), 403, 'من لا يقرأ الفرص لا تُعرض له قائمتها');

  // ④ معاينة ثم تأكيد — دورة كاملة على فرصة من صنع هذا السيناريو
  const opp = await C.req('demo.bd', '/api/opportunities', { method: 'POST', body: {
    title_ar: D.tag('فرصة يحرّكها المساعد'), sector_id: 'SOLUTIONS', client_id: ids.client.gov,
    stage_id: 'LEAD', value_sar: 300_000, year: dataset.year } });
  t.status(opp, 200, 'فرصة للاختبار');
  const oid = opp.json?.id; remember('opportunity', oid);

  t.status(await C.req('demo.employee', '/api/ai/preview', { method: 'POST',
    body: { type: 'opp_stage', fields: { oppId: oid, stage: 'WON' } } }), 403, 'من لا يملك التعديل لا يعاين');
  const badStage = await C.req('demo.bd', '/api/ai/preview', { method: 'POST',
    body: { type: 'opp_stage', fields: { oppId: oid, stage: 'MEGA_WIN' } } });
  t.status(badStage, 400, 'مرحلة مجهولة تُرَدّ وقت المعاينة');
  t.says(badStage, /مرحلة غير معروفة/, 'والرسالة تدعو للاختيار من القائمة');

  const prev = await C.req('demo.bd', '/api/ai/preview', { method: 'POST',
    body: { type: 'opp_stage', fields: { oppId: oid, stage: 'QUALIFIED' } } });
  t.status(prev, 200, 'صاحب الفرصة يعاين نقلها');
  remember('ai_activity_log', prev.json?.applyToken);
  t.ok(!RAW_ENUM_IN_REPLY.test(prev.json?.reply || ''), 'ونصّ المعاينة بأسماء المراحل لا برموزها');
  t.eq((await db.get('SELECT stage_id FROM opportunity WHERE id = ?', [oid]))?.stage_id, 'LEAD',
    'ولا شيء يتغيّر قبل التأكيد');

  const stolen = await C.req('demo.sectorlead', '/api/ai/apply', { method: 'POST', body: { applyToken: prev.json?.applyToken } });
  t.status(stolen, 400, 'معاينة غيرك لا تُطبَّق ولو عرفت رمزها');
  t.says(stolen, /لا أجد هذه المعاينة/, 'ولا يُقال له إنها معاينة شخص آخر');

  const applied = await C.req('demo.bd', '/api/ai/apply', { method: 'POST', body: { applyToken: prev.json?.applyToken } });
  t.status(applied, 200, 'صاحبها يؤكّدها فتُنفَّذ');
  t.eq((await db.get('SELECT stage_id FROM opportunity WHERE id = ?', [oid]))?.stage_id, 'QUALIFIED', 'والمرحلة تغيّرت فعلاً');
  const hist = await db.get('SELECT id, to_stage_id FROM opportunity_stage_history WHERE opportunity_id = ? ORDER BY changed_at DESC LIMIT 1', [oid]);
  t.eq(hist?.to_stage_id, 'QUALIFIED', 'وسجل المراحل كتبته الخدمة نفسها — لا مسار موازٍ');
  remember('opportunity_stage_history', hist?.id);
  const logRow = await db.get('SELECT applied, approved_by, applied_at FROM ai_activity_log WHERE id = ?', [prev.json?.applyToken]);
  t.ok(Number(logRow?.applied) === 1 && logRow?.approved_by && logRow?.applied_at,
    'ومن أكّد التغيير ومتى مكتوبان في السجل');

  const twice = await C.req('demo.bd', '/api/ai/apply', { method: 'POST', body: { applyToken: prev.json?.applyToken } });
  t.status(twice, 400, 'المزلاج: لا تُطبَّق المعاينة مرتين');
  t.says(twice, /طُبِّقت من قبل/, 'والرسالة تقول ذلك صراحةً');

  // ⑤ المعاينة المنتهية: الموافقة مرتبطة بلحظتها لا مفتوحة إلى الأبد
  const stale = await C.req('demo.bd', '/api/ai/preview', { method: 'POST',
    body: { type: 'opp_stage', fields: { oppId: oid, stage: 'PROPOSAL' } } });
  remember('ai_activity_log', stale.json?.applyToken);
  await db.run('UPDATE ai_activity_log SET expires_at = ? WHERE id = ?', ['2020-01-01T00:00:00.000Z', stale.json?.applyToken]);
  const expired = await C.req('demo.bd', '/api/ai/apply', { method: 'POST', body: { applyToken: stale.json?.applyToken } });
  t.status(expired, 400, 'معاينة انتهت مهلتها لا تُطبَّق');
  t.says(expired, /انتهت صلاحية المعاينة/, 'والرسالة تقول ماذا يفعل');

  // ⑥ قواعد النقل تُورَث من الخدمة حرفياً — وهذا هو حارس التسريب الذي كان قائماً
  const won = await C.req('demo.bd', `/api/opportunities/${oid}/stage`, { method: 'POST',
    body: { stage: 'WON', note: D.tag('فوز') } });
  t.status(won, 200, 'الفرصة تُكسب');
  const bareBack = await C.req('demo.bd', '/api/ai/preview', { method: 'POST',
    body: { type: 'opp_stage', fields: { oppId: oid, stage: 'LEAD' } } });
  remember('ai_activity_log', bareBack.json?.applyToken);
  const bareApply = await C.req('demo.bd', '/api/ai/apply', { method: 'POST', body: { applyToken: bareBack.json?.applyToken } });
  t.status(bareApply, 400, 'التراجع عن الفوز عبر المساعد بلا سبب مكتوب مردود');
  t.says(bareApply, /اكتب سبب التراجع/, 'برسالة الخدمة نفسها لا برسالة عامة');
  t.eq((await db.get('SELECT stage_id FROM opportunity WHERE id = ?', [oid]))?.stage_id, 'WON', 'ولم تتغيّر الفرصة');

  const prj = await C.req('demo.sectorlead', '/api/intake/create', { method: 'POST', body: {
    name_ar: D.tag('مشروع من فرصة المساعد'), source_opp_id: oid, value_sar: 250_000,
    start_date: '2026-09-01', end_date: '2027-02-28', contract_code: 'SCN-C-AI' } });
  t.status(prj, 200, 'الفوز يُنتج مشروعاً');
  remember('project', prj.json?.project_id); remember('contract', prj.json?.contract_id);
  const withReason = await C.req('demo.bd', '/api/ai/preview', { method: 'POST',
    body: { type: 'opp_stage', fields: { oppId: oid, stage: 'LEAD', note: D.tag('سبب مكتوب') } } });
  remember('ai_activity_log', withReason.json?.applyToken);
  const blocked = await C.req('demo.bd', '/api/ai/apply', { method: 'POST', body: { applyToken: withReason.json?.applyToken } });
  t.status(blocked, 400, 'وحتى بسببٍ مكتوب: لا تراجع عن فوزٍ نشأ عنه مشروع');
  t.says(blocked, /نشأ عنها مشروع/, 'والرسالة تدلّ على المشروع');

  // ⑦ الكتابة الموسَّعة: مهمة تُنشأ وتُغيَّر حالتها عبر خدمة المهام بقواعدها
  const tp = await C.req('demo.employee', '/api/ai/preview', { method: 'POST',
    body: { type: 'task_create', fields: { title: D.tag('مهمة من المساعد'), priority: 'P1' } } });
  t.status(tp, 200, 'الموظف يعاين إنشاء مهمة لنفسه');
  remember('ai_activity_log', tp.json?.applyToken);
  const tApplied = await C.req('demo.employee', '/api/ai/apply', { method: 'POST', body: { applyToken: tp.json?.applyToken } });
  t.status(tApplied, 200, 'ويؤكّدها فتُنشأ');
  const newTask = tApplied.json?.resourceId; remember('task', newTask);
  const taskRow = await db.get('SELECT assignee_user_id, sector_id FROM task WHERE id = ?', [newTask]);
  t.eq(taskRow?.sector_id, 'SOLUTIONS', 'وقطاعها مثبَّت على قطاع صاحبها');
  t.eq(taskRow?.assignee_user_id, ids.user['demo.employee'], 'وهي مُسنَدة إليه هو لا إلى غيره');
  const aiAudit = await db.get("SELECT detail_json FROM audit_log WHERE resource_id = ? AND detail_json LIKE '%\"via\":\"ai\"%'", [newTask]);
  t.ok(!!aiAudit, 'وسطر تدقيق يقول إن مصدر التغيير المساعد');

  const blockNoReason = await C.req('demo.employee', '/api/ai/preview', { method: 'POST',
    body: { type: 'task_status', fields: { taskId: newTask, status: 'BLOCKED' } } });
  remember('ai_activity_log', blockNoReason.json?.applyToken);
  const blockApply = await C.req('demo.employee', '/api/ai/apply', { method: 'POST', body: { applyToken: blockNoReason.json?.applyToken } });
  t.status(blockApply, 400, 'تعطيل مهمة عبر المساعد بلا سبب مكتوب مردود');
  t.says(blockApply, /سبب التعطيل/, 'برسالة خدمة المهام نفسها');

  // ⑧ السجل: بوابته بوابة التدقيق
  t.status(await C.req('demo.admin', '/api/ai/activity'), 200, 'مدير النظام يقرأ سجل نشاط المساعد');
  t.status(await C.req('demo.sectorlead', '/api/ai/activity'), 403, 'وقائد القطاع بلا منح تدقيق لا يقرؤه');

  // ⑨ إثبات نطاق واحد + كنس الراتب على كل الأدوار (النسخة المختصرة من المصفوفة)
  const salaries = await forbiddenMoney(db, fmtSar, toSar);
  t.ok(salaries.length > 0, 'يوجد راتب مخزَّن فعلاً ليُختبر حجبه');
  await C.req('demo.admin', `/api/projects/${ids.project.con_main}`, { method: 'PATCH', body: { rag: 'RED' } });
  await C.req('demo.admin', `/api/projects/${ids.project.sol_main}`, { method: 'PATCH', body: { rag: 'RED' } });
  const solName = dataset.projects.find((p) => p.key === 'sol_main').name_ar;

  const risks = await C.req('demo.sectorlead', '/api/ai/chat', { method: 'POST', body: { message: 'ما المخاطر البارزة' } });
  t.status(risks, 200, 'قائد قطاع الحلول يسأل عن المخاطر');
  t.ok(risks.json?.reply.includes(solName), 'فيرى مشروع قطاعه الحرج');
  t.ok(!risks.json?.reply.includes(conName), 'ولا يرى مشروع قطاع الاستشارات الحرج');

  for (const u of (await import('./seed.js')).DEMO_USERS) {
    const sum = await C.req(u.u, '/api/ai/chat', { method: 'POST', body: { message: `لخّص حالة ${solName}` } });
    aiSealCheck(t, u.u, 'ملخّص مشروع', sum, { salaries, foreignNames: [] });
    if (sum.status !== 200 || !sum.json.reply.includes(solName)) continue;
    const hasCost = rbac.can(shapeOf(u), 'read', 'cost');
    if (hasCost) t.ok(/الصرف الفعلي/.test(sum.json.reply), `${u.u} يملك بوابة الكلفة فيرى الصرف`);
    else {
      t.ok(/التكلفة محجوبة عن دورك/.test(sum.json.reply), `${u.u}: الكلفة محجوبة بنصٍّ صريح`);
      t.ok(!/الصرف الفعلي/.test(sum.json.reply), `${u.u}: ولا رقم صرف في ردّه`);
    }
  }
});

// ⑱ مصفوفة المساعد: سبع نوايا × سبعة عشر دوراً (بطيء)
scenario('ai-matrix', 'المساعد: سبع نوايا × سبعة عشر دوراً — نطاقاً ودقةً', async ({ C, db, D, t, ids, dataset, remember, seedMod }) => {
  const rbac = await import('../src/core/rbac/index.js');
  const policy = await import('../src/core/policy/pages.js');
  const { fmtSar, toSar } = await import('../src/core/util/ids.js');
  const salaries = await forbiddenMoney(db, fmtSar, toSar);
  const conName = dataset.projects.find((p) => p.key === 'con_main').name_ar;
  const solName = dataset.projects.find((p) => p.key === 'sol_main').name_ar;

  // عميل بلا تصنيف: نُنشئه كي يكون لفحص جودة البيانات رقمٌ حقيقي يُقارَن، لا فراغ يُصدَّق.
  const c = await C.req('demo.admin', '/api/clients', { method: 'POST', body: { name_ar: D.tag('جهة بلا تصنيف نوع') } });
  t.status(c, 200, 'جهة بلا تصنيف نوع لفحص الجودة');
  remember('client', c.json?.id);

  // ① المصفوفة: لكل دور ولكل نية — الحالة مطابقة للمنح، والختم قائم، ولا تسريب عبر القطاعات
  for (const u of seedMod.DEMO_USERS) {
    const reachesCons = rbac.can(shapeOf(u), 'read', 'project', { sector_id: 'CONSULTING', id: ids.project.con_main });
    for (const intent of AI_INTENTS) {
      const r = await C.req(u.u, '/api/ai/chat', { method: 'POST', body: { message: intent.msg(dataset) } });
      const allowed = aiAllows(rbac, policy, u, intent.key);
      t.status(r, allowed ? 200 : 403, `${u.u} ← ${intent.ar}`);
      if (!allowed) t.says(r, /صلاحيتك|نطاقك|مدير النظام/, `${u.u} ← ${intent.ar}: الرفض يقول ماذا يفعل`);
      aiSealCheck(t, u.u, intent.ar, r, { salaries, foreignNames: [[conName, reachesCons]] });
    }
  }

  // ② الدقة: الرقم المذكور في الردّ = الرقم في القاعدة تحت نفس مرشّح النطاق
  // (أ) المخاطر: أسماء المشاريع الحرجة وعدد المهام المتأخرة لكل مشروع
  const risks = await C.req('demo.sectorlead', '/api/ai/chat', { method: 'POST', body: { message: 'ما المخاطر البارزة' } });
  const redRows = await db.all("SELECT name_ar FROM project WHERE rag = 'RED' AND deleted_at IS NULL AND sector_id = 'SOLUTIONS'");
  for (const row of redRows) t.ok(risks.json?.reply.includes(row.name_ar), `المخاطر تذكر «${row.name_ar}» كما في القاعدة`);
  const lateRows = await db.all(
    `SELECT p.name_ar, COUNT(*) n FROM task t JOIN project p ON p.id = t.project_id
      WHERE t.status != 'DONE' AND t.due_date IS NOT NULL AND substr(t.due_date,1,10) < ?
        AND t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.sector_id = 'SOLUTIONS'
      GROUP BY p.id, p.name_ar ORDER BY n DESC`, [dataset.today]);
  for (const row of lateRows.slice(0, 5)) {
    t.ok(risks.json?.reply.includes(`${row.name_ar}: ${row.n} مهمة متأخرة`),
      `عدد المهام المتأخرة في «${row.name_ar}» مطابق للقاعدة (${row.n})`);
  }

  // (ب) جودة البيانات: العدد المذكور = عدد الصفوف الناقصة فعلاً
  const dq = await C.req('demo.admin', '/api/ai/chat', { method: 'POST', body: { message: 'افحص جودة البيانات' } });
  const noType = Number((await db.get("SELECT COUNT(*) n FROM client WHERE (type IS NULL OR type = '') AND deleted_at IS NULL")).n);
  t.ok(dq.json?.reply.includes(`${noType} عميل بلا تصنيف نوع`), `عدد الجهات بلا تصنيف مطابق للقاعدة (${noType})`);

  // (ج) الأولويات: عناوين مهام صاحب الطلب هو، بترتيب الإلحاح نفسه
  const prio = await C.req('demo.employee', '/api/ai/chat', { method: 'POST', body: { message: 'ما أولوياتي اليوم' } });
  const myTasks = await db.all(
    `SELECT t.title FROM task t JOIN app_user u ON u.id = t.assignee_user_id
      WHERE u.username = 'demo.employee' AND t.status NOT IN ('DONE','CANCELLED') AND t.deleted_at IS NULL
      ORDER BY CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
               (t.due_date IS NULL), t.due_date, t.title LIMIT 6`);
  for (const row of myTasks) t.ok(prio.json?.reply.includes(row.title), `الأولويات تذكر «${row.title}» كما في القاعدة`);
  const foreign = await db.get("SELECT title FROM task WHERE id = ?", [ids.task.con_rep]);
  t.ok(!prio.json?.reply.includes(foreign?.title), 'ولا تذكر مهمة شخص آخر');

  // (د) الموجز الأسبوعي: الرقم نفسه الذي تعرضه شاشة القيادة — سطحان ورقم واحد
  const brief = await C.req('demo.ceo', '/api/ai/chat', { method: 'POST', body: { message: 'اكتب الموجز التنفيذي الأسبوعي' } });
  const metrics = await C.req('demo.ceo', '/api/metrics/company');
  t.status(metrics, 200, 'مقاييس الشركة تُقرأ للمقارنة');
  t.ok(brief.json?.reply.includes(fmtSar(metrics.json?.totals?.revenue)),
    `الإيراد في الموجز = الإيراد في شاشة القيادة (${fmtSar(metrics.json?.totals?.revenue)})`);
  t.ok(brief.json?.reply.includes(fmtSar(metrics.json?.pipeline_halalas)), 'وخط الفرص كذلك');

  // (هـ) ملخّص المشروع: الإنجاز وعدد المهام المتأخرة من القاعدة نفسها
  const sum = await C.req('demo.pm', '/api/ai/chat', { method: 'POST', body: { message: `لخّص حالة ${solName}` } });
  const prow = await db.get('SELECT progress_pct FROM project WHERE id = ?', [ids.project.sol_main]);
  t.ok(sum.json?.reply.includes(`الإنجاز: ${Math.round(prow?.progress_pct || 0)}%`), 'نسبة الإنجاز مطابقة للقاعدة');
  const late = Number((await db.get(
    `SELECT COUNT(*) n FROM task WHERE project_id = ? AND status != 'DONE' AND due_date IS NOT NULL
      AND substr(due_date,1,10) < ? AND deleted_at IS NULL`, [ids.project.sol_main, new Date().toISOString().slice(0, 10)])).n);
  t.ok(sum.json?.reply.includes(`متأخرة: ${late}`), `عدد المهام المتأخرة في الملخّص مطابق للقاعدة (${late})`);
}, { slow: true });

// ─────────────────────────────────────────────────────────────────────────────
// المحو
// ─────────────────────────────────────────────────────────────────────────────
// ثلاث مراحل بترتيب مقصود:
//   ١) حذف كل صف ظهر بعد الإحصاء المرجعي (عدا سجل التدقيق) — بترتيب الابن قبل الأب.
//   ٢) إرجاع كل صف قائم تغيّر محتواه (تسجيل الدخول يعدّل حسابات العرض، والربط يعدّل الحساب).
//   ٣) إعادة المحاولة مرتين: بعض الكتابات تصل متأخرة (تنبيهات المسار تُكتب بلا انتظار في
//      src/modules/workflow/engine.js) فتظهر بعد أول مسح — والنتيجة النهائية يجب أن تكون نظيفة.
async function purgeEverything({ db, D, before, tables, created }) {
  const trackedIds = new Set(created.filter((c) => c.id).map((c) => `${c.table}:${c.id}`));
  const order = [...D.PURGE_ORDER, ...tables.filter((t) => !D.PURGE_ORDER.includes(t))];
  const result = { deleted: 0, tracked: 0, untracked: {}, restored: [], passes: 0, blocked: [] };

  // الفارق الحاسم: **صفٌّ جديد** يُحذف، و**صفٌّ قائم تغيّر محتواه** يُرجَع ولا يُحذف. التمييز
  // بالمعرّف لا بالمحتوى: مقارنةٌ بالمحتوى وحده تقرأ تعديلَ صفٍّ قائم «صفاً جديداً» فتحذفه —
  // وهذا يعني حذف حسابات العرض لمجرد أن تسجيل الدخول كتب فيها «آخر دخول».
  const beforeIds = new Map(tables.map((t) => [t, new Set((before.get(t) || []).filter((r) => r.id != null).map((r) => r.id))]));

  // الحذف يتحمّل الفشل ويعيد المحاولة في الجولة التالية بدل أن ينهار: ترتيب الابن قبل الأب
  // معلَن في PURGE_ORDER، لكن الاعتماد عليه وحده يجعل أي مفتاح خارجي جديد يُسقط المحو كله.
  // والفشل هنا لا يُبتلع: ما بقي يظهر في مقارنة الإحصاء بعد المحو ويُعلَن صراحةً.
  const tryDelete = async (sql, params, key) => {
    try { await db.run(sql, params); return true; }
    catch (e) { result.blocked.push(`${key}: ${e.message}`); return false; }
  };

  for (let pass = 1; pass <= 5; pass++) {
    result.passes = pass;
    const now = await census(db, tables);
    let deletedThisPass = 0;
    result.blocked = [];
    for (const table of order) {
      if (table === 'audit_log' || !before.has(table)) continue;
      const seen = beforeIds.get(table) || new Set();
      const rows = now.get(table) || [];
      const keyed = rows.filter((r) => r.id !== undefined);
      const unkeyed = rows.filter((r) => r.id === undefined);
      const targets = keyed.filter((r) => !seen.has(r.id));
      // جدول بلا عمود معرّف (ربطٌ مركّب مثل opportunity_sector): الفارق بالمحتوى وحده.
      if (unkeyed.length) {
        const { added } = diffRows((before.get(table) || []).filter((r) => r.id === undefined), unkeyed);
        targets.push(...added.map(asObject));
      }
      for (const r of targets) {
        const key = `${table}:${r.id ?? '<بلا معرّف>'}`;
        const ok = r.id !== undefined
          ? await tryDelete(`DELETE FROM ${table} WHERE id = ?`, [r.id], key)
          : await tryDelete(
            `DELETE FROM ${table} WHERE ${Object.keys(r).map((c) => `${c} IS ?`).join(' AND ')}`,
            Object.keys(r).map((c) => r[c]), key);
        if (!ok) continue;
        if (r.id !== undefined && trackedIds.has(key)) result.tracked++;
        else result.untracked[table] = (result.untracked[table] || 0) + 1;
        deletedThisPass++;
      }
    }
    result.deleted += deletedThisPass;
    if (!deletedThisPass) break;
  }

  // إرجاع ما تغيّر من صفوف قائمة (بمعرّفها) إلى محتواه قبل التشغيل: تسجيل الدخول يكتب «آخر
  // دخول» على حسابات العرض، وربط الحساب بسجل موظف يكتب في الحساب — أثرٌ على صفوف لم نُنشئها،
  // فيُرجَع لا يُترك. وهو مذكور في التقرير صراحةً كي لا يبدو المحو أنظف مما هو.
  const nowRows = await census(db, tables);
  for (const table of tables) {
    const beforeById = new Map((before.get(table) || []).filter((r) => r.id != null).map((r) => [r.id, r]));
    for (const cur of (nowRows.get(table) || [])) {
      if (cur.id == null) continue;
      const orig = beforeById.get(cur.id);
      if (!orig || canon(orig) === canon(cur)) continue;
      const cols = Object.keys(orig).filter((c) => c !== 'id');
      await db.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...cols.map((c) => orig[c]), cur.id]);
      result.restored.push(`${table}:${cur.id}`);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// التقرير
// ─────────────────────────────────────────────────────────────────────────────
export function printReport(out, { verbose = true } = {}) {
  const { recorder, summary, residue, auditAdded, purge, lateWrites = [] } = out;
  const L = [];
  L.push('');
  L.push('════════ تقرير السيناريوهات ════════');
  for (const s of recorder.scenarios) {
    const bad = s.checks.filter((c) => !c.ok);
    L.push(`${bad.length ? '✗' : '✓'} ${s.title} — ${s.checks.length - bad.length}/${s.checks.length}`);
    if (verbose) for (const c of bad) L.push(`     ✗ ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
    if (s.error) L.push(`     ! انقطع: ${s.error}`);
  }
  L.push('');
  L.push('──── العيوب المؤكَّدة (سلوك قائم يخالف الصواب — لم يُعالَج هنا) ────');
  if (!recorder.defects.length) L.push('  لا شيء');
  for (const d of recorder.defects) {
    L.push(`  [${d.id}] ${d.label}`);
    L.push(`        الموضع: ${d.ref}`);
    L.push(`        الصواب: ${d.shouldBe}`);
    L.push(`        الحاصل: ${JSON.stringify(d.observed)}${d.pinnedMatches ? '' : '  ← تغيّر السلوك! راجع التثبيت'}`);
  }
  L.push('');
  L.push('──── المحو والإحصاء ────');
  L.push(`  صفوف زُرعت في مرحلة الزرع: ${summary.seeded} · وسُجِّلت إجمالاً خلال التشغيل: ${summary.tracked}`);
  const side = Object.entries(purge.untracked).map(([t2, n]) => `${t2}×${n}`).join('، ') || 'لا شيء';
  L.push(`  صفوف حُذفت: ${purge.deleted} (منها ${purge.tracked} مُسجَّلة صراحةً)`);
  L.push(`  آثار جانبية كتبها المنتج ولم يُعِد معرّفاتها: ${side}`);
  if (purge.blocked.length) L.push(`  حذوفات تعذّرت: ${purge.blocked.join(' | ')}`);
  L.push(`  صفوف قائمة أُرجعت إلى حالتها: ${purge.restored.length}`);
  L.push(`  جولات المسح (الأخيرة تحقّقٌ بلا حذف): ${purge.passes}`);
  const late = lateWrites.map((d) => `${d.table}×${d.added.length}`).join('، ');
  L.push(`  كتابات وصلت بعد آخر استجابة (بلا انتظار): ${late || 'لا شيء'}`);
  L.push(`  سطور تدقيق أُضيفت وبقيت عمداً: ${auditAdded.length}`);
  L.push(`  فروق متبقية بعد المحو (عدا سجل التدقيق): ${residue.length}`);
  for (const r of residue) L.push(`     ✗ ${r.table}: +${r.added.length} / -${r.removed.length}`);
  const failed = recorder.failed;
  L.push('');
  L.push(`النتيجة: ${recorder.passed.length} ناجح · ${failed.length} فاشل · ${recorder.defects.length} عيباً مثبَّتاً`);
  L.push(residue.length === 0 ? '✓ المنصة نظيفة: لا أثر لبيانات السيناريو بعد المحو.' : '✗ بقيت آثار — راجع الفروق أعلاه.');
  L.push('');
  return L.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// سطر الأوامر
// ─────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const arg = (name, def = null) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const has = (name) => argv.includes(name);

  // الوجهة الافتراضية **خارج المستودع** عمداً: ملف في مجلد النظام المؤقت. فلا ملف قاعدة يقع
  // يوماً داخل شجرة المشروع (ومنه إلى التزام بالخطأ)، والوجهة رمي بحكم موضعها لا بحكم وعدٍ.
  const explicitDb = arg('--db') || process.env.SANAD_DB || null;
  const dbFile = explicitDb ? resolve(explicitDb) : join(tmpdir(), 'sanad-scenarios', `scn-${process.pid}-${Date.now()}.db`);
  assertThrowawayTarget({
    dbFile,
    databaseUrl: process.env.DATABASE_URL || null,
    nodeEnv: process.env.NODE_ENV || 'development',
    explicit: !!explicitDb,
    armed: process.env.SANAD_SCENARIOS === '1',
  });
  mkdirSync(dirname(dbFile), { recursive: true });
  process.env.SANAD_DB = dbFile;                 // قبل استيراد أي وحدة تقرأ الإعدادات
  const keep = has('--keep') || !!explicitDb;

  console.log(`▶ قاعدة السيناريوهات: ${dbFile}${keep ? '  (ستبقى بعد التشغيل)' : ''}`);
  let code = 0;
  try {
    const out = await runHarness({ today: arg('--today', '2026-07-27'), compact: has('--compact') });
    console.log(printReport(out));
    code = (out.recorder.failed.length || out.residue.length) ? 1 : 0;
  } catch (e) {
    console.error('✗ تعذّر إكمال التشغيل:', e?.stack || e?.message || e);
    code = 1;
  } finally {
    try { const { close } = await import('../src/core/db/index.js'); await close(); } catch { /* لا شيء */ }
    if (!keep) for (const suf of ['', '-wal', '-shm']) rmSync(dbFile + suf, { force: true });
    else if (!existsSync(dbFile)) console.log('  (لم يُنشأ ملف القاعدة)');
  }
  process.exit(code);
}
