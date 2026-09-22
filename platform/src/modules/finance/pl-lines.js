// ── سطور قائمة الدخل: ما تُدخله المالية شهرياً، وما تقوله المطابقة مع سند ──────────────────
//
// هذه الوحدة هي الباب الوحيد إلى `pl_line_amount` (ترحيلة ٠٥٠): تكتب ما تعتمده المالية شهراً
// بشهرٍ وسطراً بسطر (فعلياً وخطةً)، وتقرؤه للشاشة وللقائمة وللورقة، وتقارنه بما سجّله أهل
// المشاريع في سند نفسه.
//
// ── قاعدتان تحكمان كل رقمٍ هنا ──────────────────────────────────────────────────────────
// ① **صفرٌ مُدخَل ليس فراغاً.** صفٌّ موجود بقيمة صفر خبرٌ («أُقفل الشهر ولا صرف على هذا
//    السطر»)، وغيابُ الصفّ خبرٌ آخر («لم يُدخَل بعد»). فالقارئ يعود بصفرٍ في الأولى وبفراغٍ
//    في الثانية — ولا يُحوَّل غيابٌ إلى صفر، لأن صفراً واحداً في سطر كلفةٍ يُنتج «مجمل ربحٍ»
//    يساوي الإيراد كاملاً، وهو رقمٌ يُبنى عليه قرار.
// ② **الخطة للقطاع كلّه.** لا خطة كلفةٍ لمشروعٍ أو عميلٍ أو إدارة. فحين يقصّ القارئ الشاشة
//    على أحدها تعود أعمدة الكلفة — محقّقةً وخطةً — فارغةً، كما تفعل قائمة الدخل بخطة الإيراد
//    حرفاً: قسمةُ رقم القطاع على مقصوصٍ منه تُخرج انحرافاً موهوماً.
//
// ── بابان معاً على الكتابة ──────────────────────────────────────────────────────────────
// المنحُ على المورد (`pl_line`) يقول «من له أن يكتب في هذا القطاع»، وبوابةُ الحقل الحساس
// (`cost`) تقول «من له أن يرى أرقام التكلفة أصلاً». ومن لا يرى الرقم لا يكتبه: كتابةٌ بلا
// رؤيةٍ تعني إدخالاً على العمياء ثم بلاغاً بالنجاح لا يستطيع صاحبه مراجعته.
//
// ملاحظة بنيوية: `income-statement.js` يستورد مُحمِّلَي الكلفة من هنا (المرحلة الثانية)،
// وهذه الوحدة تستورد منه أسماء السطور. فالحلقة مغلقةٌ بينهما عمداً، ولذلك **لا يُقرأ
// `COST_KEYS` في المستوى الأعلى من هذا الملف** بل داخل الدوال وحدها (كسولاً) — قراءةٌ عُلويّة
// كانت ستقع في منطقة الموت المؤقتة حين يُحمَّل هذا الملف أولاً.
import { all, get, run, insert, update, tx } from '../../core/db/index.js';
import { can, canSeeSensitive } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { targetYear } from '../org/sector-targets.js';
import { COST_KEYS, LINE_BY_KEY } from './income-statement.js';
import { PL_RECON_PCT, PL_RECON_MIN_HALALAS, plReconMatch } from '../../core/i18n/thresholds.js';

/** نوعا الصفّ: ما أُقفل فعلاً، وما وُضع للشهر نفسه خطةً. */
const KINDS = Object.freeze(['actual', 'plan']);

// المفاتيح التي تُكتب في القاعدة: سطور الكلفة الستة ومعها الإيراد (المالية تعتمد رقم إيرادها
// كما تعتمد كلفتها). و«تكلفة الإيراد» و«مجمل الربح» **محسوبان** لا مُدخَلان — كتابتهما تفتح
// بابَ رقمٍ يخالف مجموعَ ما تحته على الشاشة نفسها. تُقرأ كسولاً (انظر ملاحظة الحلقة أعلاه).
let _writable = null;
const writableKeys = () => (_writable ||= new Set(['rev', ...COST_KEYS]));

/** مفاتيح الكلفة كمصفوفة — قراءةٌ كسولة للسبب نفسه. */
const costKeys = () => COST_KEYS;

/** سطور تُقارَن بندياً مع سند: ما يُسجَّل في سند على مشروعٍ بعينه ويحتمل المقابلة. */
const COMPARABLE_KEYS = Object.freeze(['con', 'ctr', 'lic']);

/** سببُ امتناع المقابلة البندية — يُقال للقارئ بدل «لا يوجد» التي تُقرأ عطلاً. */
const NOT_COMPARABLE_AR = Object.freeze({
  sal: 'الرواتب من المالية فقط',
  rent: 'مصروف قطاع لا يُسجَّل على مشروع',
  oth: 'مصروف قطاع لا يُسجَّل على مشروع',
});

// ── تحقّقاتٌ تقول السبب والعلاج ──────────────────────────────────────────────────────────

function checkSectorId(sectorId) {
  const s = String(sectorId || '').trim();
  if (!s) throw badRequest('حدّد القطاع قبل حفظ سطور قائمة الدخل');
  return s;
}

function checkMonth(month) {
  const n = Number(month);
  if (!Number.isInteger(n) || n < 1 || n > 12) throw badRequest('حدّد الشهر برقم من 1 إلى 12');
  return n;
}

function checkKind(kind) {
  const k = String(kind || '').trim();
  if (!KINDS.includes(k)) throw badRequest('نوع السطر إما «فعلي» وإما «خطة» — اختر أحدهما');
  return k;
}

function checkLineKey(lineKey) {
  const k = String(lineKey || '').trim();
  if (!writableKeys().has(k)) {
    const line = LINE_BY_KEY[k];
    // «تكلفة الإيراد» و«مجمل الربح» يُقالان باسميهما لا بمفتاحيهما: القارئ يرى الاسم على الشاشة.
    if (line) throw badRequest(`سطر «${line.ar}» يُحسب من السطور التي فوقه — أدخل بنود الكلفة وسيظهر وحده`);
    throw badRequest('هذا البند ليس من بنود قائمة الدخل — اختر بنداً من القائمة المعتمدة');
  }
  return k;
}

// المبلغ بالهللة عدداً صحيحاً موجباً أو صفراً. الصفر مقبولٌ عمداً: هو خبر «أُقفل ولا صرف».
function checkAmount(amountHalalas) {
  const n = Number(amountHalalas);
  if (!Number.isSafeInteger(n)) throw badRequest('أدخل المبلغ رقماً صحيحاً بالهللة — صفراً أو مبلغاً موجباً');
  if (n < 0) throw badRequest('المبلغ لا يكون سالباً — صحّح الرقم أو احذف السطر');
  return n;
}

function checkNote(note) {
  if (note == null) return null;
  const t = String(note).trim();
  if (!t) return null;
  if (t.length > 1000) throw badRequest('اختصر الملاحظة إلى 1000 حرف كحد أقصى');
  return t;
}

// ── البوابتان ───────────────────────────────────────────────────────────────────────────

/**
 * بوابةُ الرؤية: من لا يرى أرقام التكلفة لا يكتبها ولا يقرؤها.
 *
 * والبوابتان معاً — الكلفة والهامش — كما في القراءة: الكاتب في قائمة الدخل يرى أثر ما يكتبه على
 * مجمل الربح لحظةَ كتابته، فلا يُفتح له بابُ الكتابة وبابُ النتيجة مغلق. والمصفوفة تمنحهما معاً
 * لكل دورٍ يملك الكتابة، فلا دور نظاميّ يتغيّر بهذا الشدّ.
 */
function assertCostGate(user) {
  if (!canSeeSensitive(user, 'cost') || !canSeeSensitive(user, 'margin')) {
    throw forbidden('أرقام التكلفة خارج صلاحيتك — راجع مدير النظام');
  }
}

function assertWrite(user, sectorId, action) {
  if (!can(user, action, 'pl_line', { sector_id: sectorId })) {
    throw forbidden('سطور قائمة الدخل لهذا القطاع خارج صلاحيتك');
  }
  assertCostGate(user);
}

// يُسأل قبل قراءة وجود الصفّ، كي لا يصير وجودُ الصفّ نفسه خبراً يخرج لمن لا يملك الكتابة أصلاً.
function assertMayWriteSector(user, sectorId) {
  const create = can(user, 'create', 'pl_line', { sector_id: sectorId });
  const upd = can(user, 'update', 'pl_line', { sector_id: sectorId });
  if (!create && !upd) throw forbidden('سطور قائمة الدخل لهذا القطاع خارج صلاحيتك');
  assertCostGate(user);
}

async function assertSectorExists(sectorId) {
  const s = await get('SELECT id FROM sector WHERE id = ? AND deleted_at IS NULL', [sectorId]);
  if (!s) throw notFound('القطاع غير موجود');
  return s;
}

// ── الكتابة ─────────────────────────────────────────────────────────────────────────────

const snapshot = (r) => (r ? {
  amount_halalas: Number(r.amount_halalas) || 0, note: r.note ?? null,
  source: r.source ?? null, revision: Number(r.revision) || 0,
} : null);

/**
 * إدخالٌ أو تحديثٌ لصفٍّ واحد على مفتاح التفرّد (قطاع، سنة، شهر، سطر، نوع).
 *
 * لا `ON CONFLICT` هنا: القراءةُ قبل الكتابة تُسلّم «قبل» و«بعد» للتدقيق وللتراجع عن الرفعة،
 * وهما ما يجعل الرقم قابلاً للمراجعة بعد شهر. والقراءة والكتابة داخل معاملةٍ واحدة يفتحها
 * المستدعي، فلا نافذة بينهما.
 *
 * @returns {Promise<{resource:'pl_line', resourceId:string, action:'create'|'update',
 *                    before:object|null, after:object}>}
 */
async function upsertPlLine(ctx, { sectorId, year, month, lineKey, kind, amountHalalas, note, source, importRunId } = {}) {
  const sec = checkSectorId(sectorId);
  const y = targetYear(year);
  const m = checkMonth(month);
  const key = checkLineKey(lineKey);
  const k = checkKind(kind);
  const amount = checkAmount(amountHalalas);
  const noteText = checkNote(note);
  const src = source == null ? null : String(source).trim() || null;
  const runId = importRunId == null ? null : String(importRunId).trim() || null;

  const existing = await get(
    'SELECT * FROM pl_line_amount WHERE sector_id = ? AND year = ? AND month = ? AND line_key = ? AND kind = ?',
    [sec, y, m, key, k]);
  const stamp = nowIso();
  const detailBase = { year: y, month: m, line_key: key, kind: k };

  if (!existing) {
    assertWrite(ctx?.user, sec, 'create');
    const rowId = id('pll');
    await insert('pl_line_amount', {
      id: rowId, sector_id: sec, year: y, month: m, line_key: key, kind: k,
      amount_halalas: amount, source: src, note: noteText, revision: 1,
      import_run_id: runId, created_by: ctx?.user?.id || null, created_at: stamp,
      updated_by: null, updated_at: null,
    });
    const after = await get('SELECT * FROM pl_line_amount WHERE id = ?', [rowId]);
    await audit(ctx, { action: 'create', resource: 'pl_line', resourceId: rowId, sectorId: sec,
      detail: { ...detailBase, source: src, before: null, after: snapshot(after) } });
    return { resource: 'pl_line', resourceId: rowId, action: 'create', before: null, after };
  }

  assertWrite(ctx?.user, sec, 'update');
  const before = existing;
  // الإصدار يرتفع مع كل تحديث فيُعرف أن الرقم صُحِّح — ولو عادت القيمة نفسها: إعادةُ الرفع
  // حدثٌ في حياة الرقم يقرؤه المراجع، لا لا-شيء.
  const revision = (Number(before.revision) || 0) + 1;
  await update('pl_line_amount', before.id, {
    amount_halalas: amount, source: src, note: noteText, revision,
    import_run_id: runId, updated_by: ctx?.user?.id || null, updated_at: stamp,
  });
  const after = await get('SELECT * FROM pl_line_amount WHERE id = ?', [before.id]);
  await audit(ctx, { action: 'update', resource: 'pl_line', resourceId: before.id, sectorId: sec,
    detail: { ...detailBase, source: src, before: snapshot(before), after: snapshot(after) } });
  return { resource: 'pl_line', resourceId: before.id, action: 'update', before, after };
}

// دفعةٌ واحدة: كلها أو لا شيء. ونصفُ رفعةٍ محفوظة أسوأ من رفعةٍ مردودة — القارئ يرى شهوراً
// أُدخلت وشهوراً لم تُدخل ولا يعرف أيّها أيّ.
async function savePlLines(ctx, { sectorId, year, rows, kind, source, importRunId } = {}) {
  const sec = checkSectorId(sectorId);
  const y = targetYear(year);
  const k = checkKind(kind);
  const list = Array.isArray(rows) ? rows : null;
  if (!list || !list.length) throw badRequest('لا توجد سطور للحفظ — أدخل مبلغاً واحداً على الأقل');
  assertMayWriteSector(ctx?.user, sec);

  // تكرارُ (شهر، سطر) في الدفعة نفسها يكتب الرقم ثم يكتب فوقه صامتاً، ويرفع الإصدار مرتين
  // على رفعةٍ واحدة. فالرد قبل الكتابة أصدق من أثرٍ لا يفسّر نفسه.
  const seen = new Set();
  for (const r of list) {
    const m = checkMonth(r?.month);
    const key = checkLineKey(r?.line_key ?? r?.lineKey);
    const sig = `${m}:${key}`;
    if (seen.has(sig)) {
      throw badRequest(`تكرّر بند «${LINE_BY_KEY[key].ar}» للشهر ${m} في الملف — احذف المكرر ثم أعد الحفظ`);
    }
    seen.add(sig);
  }

  return tx(async () => {
    await assertSectorExists(sec);
    const saved = [];
    for (const r of list) {
      saved.push(await upsertPlLine(ctx, {
        sectorId: sec, year: y, month: r.month, lineKey: r.line_key ?? r.lineKey,
        kind: k, amountHalalas: r.amount_halalas ?? r.amountHalalas, note: r.note,
        source, importRunId,
      }));
    }
    return { sector_id: sec, year: y, kind: k, saved };
  });
}

/**
 * حفظ ما أقفلته المالية فعلياً.
 * @param {{user:object, ip?:string}} ctx
 * @param {{sectorId:string, year:number,
 *          rows:Array<{month:number, line_key:string, amount_halalas:number, note?:string}>,
 *          source?:string, importRunId?:string}} payload
 * @returns {Promise<{sector_id:string, year:number, kind:'actual', saved:object[]}>}
 */
export async function savePlActuals(ctx, { sectorId, year, rows, source = 'manual', importRunId } = {}) {
  return savePlLines(ctx, { sectorId, year, rows, kind: 'actual', source, importRunId });
}

/**
 * حفظ خطة الشهر بالسطور نفسها.
 * @see savePlActuals — التوقيع نفسه، والنوع «خطة».
 */
export async function savePlPlan(ctx, { sectorId, year, rows, source = 'manual', importRunId } = {}) {
  return savePlLines(ctx, { sectorId, year, rows, kind: 'plan', source, importRunId });
}

/**
 * حذفٌ فعليّ لصفّ — لا حذف ناعم في هذا الجدول (ترحيلة ٠٥٠): الصفّ إما موجودٌ بقيمته وإما
 * غيرُ موجود، ولا حالةَ ثالثة تُقرأ صفراً أو فراغاً بحسب كاتب الاستعلام. يُستدعى من التراجع
 * عن رفعةٍ ومن تصحيح إدخالٍ يدوي.
 *
 * صلاحيةُ «تعديل» هي الحارس: المصفوفة تمنح الإنشاء والتعديل معاً لمن يملك السطور، فمن يكتب
 * الرقم يملك سحبه.
 */
export async function deletePlLine(ctx, lineId) {
  const rowId = String(lineId || '').trim();
  if (!rowId) throw badRequest('حدّد السطر المراد حذفه');
  return tx(async () => {
    const row = await get('SELECT * FROM pl_line_amount WHERE id = ?', [rowId]);
    if (!row) throw notFound('السطر لم يعد موجوداً — أعد فتح الصفحة');
    assertWrite(ctx?.user, row.sector_id, 'update');
    await run('DELETE FROM pl_line_amount WHERE id = ?', [rowId]);
    await audit(ctx, { action: 'delete', resource: 'pl_line', resourceId: rowId, sectorId: row.sector_id,
      detail: { year: row.year, month: row.month, line_key: row.line_key, kind: row.kind, before: snapshot(row), after: null } });
    return { resource: 'pl_line', resourceId: rowId, action: 'delete', before: row, after: null };
  });
}

// ── القراءة المحكومة ────────────────────────────────────────────────────────────────────

/**
 * سطور قطاعٍ في سنة، محكومةً ببابَيها: سطور الكلفة تحتاج بوابة التكلفة، وسطر الإيراد يقرؤه
 * من يقرأ الإيراد. وما لا يملكه القارئ **يُحذف** من القائمة ولا يُسلَّم فارغاً — صفٌّ فارغ
 * في شاشةٍ مالية يُقرأ «لا يوجد» والحقيقة «لا تملك رؤيته».
 *
 * @param {object} user
 * @param {string} sectorId
 * @param {number} year
 * @param {{kind?: 'actual'|'plan'}} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function listPlLines(user, sectorId, year, { kind } = {}) {
  if (!user) throw forbidden('سطور قائمة الدخل تُقرأ بحسابٍ مسجَّل الدخول');
  const sec = checkSectorId(sectorId);
  const y = targetYear(year);
  if (!can(user, 'read', 'pl_line', { sector_id: sec })) throw forbidden('سطور قائمة الدخل لهذا القطاع خارج صلاحيتك');
  const k = kind == null ? null : checkKind(kind);
  // بابان معاً كبقية قراءات الكلفة في المنصة (`assertCostGate` و«مركز القطاع» وقائمة الدخل):
  // من يقرأ سطور الكلفة يبلغ مجمل الربح بطرحةٍ واحدة، فبابُ الهامش شرطٌ معها لا زينة.
  const canCost = canSeeSensitive(user, 'cost') && canSeeSensitive(user, 'margin');
  const canRevenue = can(user, 'read', 'revenue_line', { sector_id: sec });
  const allowed = [...(canRevenue ? ['rev'] : []), ...(canCost ? costKeys() : [])];
  if (!allowed.length) throw forbidden('أرقام التكلفة خارج صلاحيتك — راجع مدير النظام');

  const params = [sec, y, ...allowed];
  const kindClause = k ? ' AND kind = ?' : '';
  if (k) params.push(k);
  const rows = await all(`SELECT * FROM pl_line_amount
      WHERE sector_id = ? AND year = ? AND line_key IN (${allowed.map(() => '?').join(',')})${kindClause}
      ORDER BY month, kind, line_key`, params);
  const order = new Map(['rev', ...costKeys()].map((key, i) => [key, i]));
  return rows
    .map((r) => ({
      id: r.id, sector_id: r.sector_id, year: r.year, month: r.month,
      line_key: r.line_key, ar: LINE_BY_KEY[r.line_key]?.ar || r.line_key, kind: r.kind,
      amount_halalas: Number(r.amount_halalas) || 0, source: r.source ?? null, note: r.note ?? null,
      revision: Number(r.revision) || 0, import_run_id: r.import_run_id ?? null,
      created_at: r.created_at, updated_at: r.updated_at ?? null,
    }))
    .sort((a, b) => (a.month - b.month) || String(a.kind).localeCompare(String(b.kind))
      || ((order.get(a.line_key) ?? 99) - (order.get(b.line_key) ?? 99)));
}

// ── مُحمِّلا قائمة الدخل ─────────────────────────────────────────────────────────────────
// قارئان داخليان: البوابات محسومةٌ عند المستدعي (`sectorIncomeStatement` لا يستدعيهما إلا بعد
// فتح بابَي التكلفة والهامش)، فلا يُعاد فحصُها هنا ولا يُفترض فتحُها — تماماً كما في
// `monthlyRevenueTargets`.

// أشهرٌ صالحة مرتَّبة بلا تكرار؛ الغياب = السنة كاملة (وهو ما تعنيه شاشةٌ بلا مرشِّح فترة).
function monthList(months) {
  const set = new Set();
  for (const m of Array.isArray(months) ? months : []) {
    const n = Number(m);
    if (Number.isInteger(n) && n >= 1 && n <= 12) set.add(n);
  }
  if (!set.size) return Array.from({ length: 12 }, (_, i) => i + 1);
  return [...set].sort((a, b) => a - b);
}

const isScoped = (scope) => !!(scope && (scope.project || scope.client || scope.dept));

// جمعٌ يُفرّق بين «صفرٌ مُدخَل» و«لا صفّ»: لا صفّ ⇒ فراغ، وصفٌّ واحد بصفرٍ ⇒ صفر.
function sumPresent(rows) {
  if (!rows.length) return null;
  return rows.reduce((a, r) => a + (Number(r.amount_halalas) || 0), 0);
}

/**
 * كلفة السطور الستة فعلياً: مجموع الفترة، ومجموع «حتى تاريخه» (يناير إلى آخر شهرٍ في الفترة).
 *
 * الشكل المتفق عليه مع `income-statement.js`: `{ [key]: { period, ytd } }` بالهللة أو فراغاً.
 * وفترةٌ أُدخل بعض شهورها يُجمع فيها ما أُدخل: «حتى آخر شهر مغلق» هي العدسة التي تمنع قراءة
 * فترةٍ ناقصة، لا هذا القارئ.
 *
 * @returns {Promise<Record<string, {period:number|null, ytd:number|null}>>}
 */
export async function loadCostActuals(sectorId, year, months, scope = {}) {
  const keys = costKeys();
  const empty = Object.fromEntries(keys.map((k) => [k, { period: null, ytd: null }]));
  if (isScoped(scope)) return empty;                 // الكلفة تُدخَل على القطاع، لا على مقصوصٍ منه
  const sec = String(sectorId || '').trim();
  if (!sec) return empty;
  const y = targetYear(year);
  const ms = monthList(months);
  const maxMonth = Math.max(...ms);
  const inPeriod = new Set(ms);
  const rows = await all(`SELECT month, line_key, amount_halalas FROM pl_line_amount
      WHERE sector_id = ? AND year = ? AND kind = 'actual' AND month <= ?
        AND line_key IN (${keys.map(() => '?').join(',')})`, [sec, y, maxMonth, ...keys]);
  const out = {};
  for (const k of keys) {
    const mine = rows.filter((r) => r.line_key === k);
    out[k] = {
      period: sumPresent(mine.filter((r) => inPeriod.has(Number(r.month)))),
      ytd: sumPresent(mine),
    };
  }
  return out;
}

/**
 * خطة السطور الستة: خطة السنة كاملةً، وخطة الفترة المختارة.
 * الشكل: `{ [key]: { fy, period } }` بالهللة أو فراغاً.
 */
export async function loadCostPlans(sectorId, year, months, scope = {}) {
  const keys = costKeys();
  const empty = Object.fromEntries(keys.map((k) => [k, { fy: null, period: null }]));
  if (isScoped(scope)) return empty;
  const sec = String(sectorId || '').trim();
  if (!sec) return empty;
  const y = targetYear(year);
  const inPeriod = new Set(monthList(months));
  const rows = await all(`SELECT month, line_key, amount_halalas FROM pl_line_amount
      WHERE sector_id = ? AND year = ? AND kind = 'plan'
        AND line_key IN (${keys.map(() => '?').join(',')})`, [sec, y, ...keys]);
  const out = {};
  for (const k of keys) {
    const mine = rows.filter((r) => r.line_key === k);
    out[k] = { fy: sumPresent(mine), period: sumPresent(mine.filter((r) => inPeriod.has(Number(r.month)))) };
  }
  return out;
}

/**
 * الصورة الشهرية الكاملة لبناء الشاشة: لكل سطرٍ اثنا عشر شقّاً خطةً واثنا عشر فعلاً، وشهرٌ بلا
 * صفٍّ يبقى فارغاً (لا صفراً). قارئٌ داخلي — البوابات عند المستدعي.
 *
 * @returns {Promise<Record<string, {plan:Array<number|null>, actual:Array<number|null>}>>}
 */
export async function monthlyPlLines(sectorId, year) {
  const keys = ['rev', ...costKeys()];
  const out = Object.fromEntries(keys.map((k) => [k, { plan: Array(12).fill(null), actual: Array(12).fill(null) }]));
  const sec = String(sectorId || '').trim();
  if (!sec) return out;
  const y = targetYear(year);
  const rows = await all(`SELECT month, line_key, kind, amount_halalas FROM pl_line_amount
      WHERE sector_id = ? AND year = ? AND line_key IN (${keys.map(() => '?').join(',')})`, [sec, y, ...keys]);
  for (const r of rows) {
    const slot = out[r.line_key];
    const i = Number(r.month) - 1;
    if (!slot || i < 0 || i > 11) continue;
    const arr = r.kind === 'plan' ? slot.plan : slot.actual;
    arr[i] = (arr[i] || 0) + (Number(r.amount_halalas) || 0);
  }
  return out;
}

/**
 * مصدرُ الإقفال بلسان القارئ — مصدرٌ واحد تقرأ منه الشاشة واللوحة والملفّ، فلا يظهر مفتاحٌ
 * داخليٌّ («derived») في وجه أحد. مفاتيحُ اليوم اثنان (`override` و`derived`)، ويبقى الاسمان
 * القديمان (`upload`/`budget`) لحمولةٍ محفوظةٍ في متصفّحٍ لم يُحدَّث بعد.
 */
export const CLOSED_SOURCE_AR = Object.freeze({
  upload: 'من ملفّ المالية المرفوع',
  override: 'حدّده مدير النظام',
  budget: 'حدّده مدير النظام',
  derived: 'من آخر شهر مرفوع',
});

/**
 * آخر شهرٍ مغلق: تجاوزُ مدير النظام إن كُتب، وإلا آخر شهرٍ أدخلت فيه المالية كلفةً فعلاً.
 * وفراغُ التجاوز يعني «اقرأ المشتقّ» لا «لا شهر مغلق» (ترحيلة ٠٥٠).
 *
 * @returns {Promise<{month:number|null, source:'override'|'derived'|null}>}
 */
export async function closedThrough(sectorId, year) {
  const sec = String(sectorId || '').trim();
  if (!sec) return { month: null, source: null };
  const y = targetYear(year);
  const overrides = await all(`SELECT closed_through_month FROM budget
      WHERE sector_id = ? AND fiscal_year = ? AND closed_through_month IS NOT NULL ORDER BY id`, [sec, y]);
  for (const o of overrides) {
    const n = Number(o.closed_through_month);
    if (Number.isInteger(n) && n >= 1 && n <= 12) return { month: n, source: 'override' };
  }
  const keys = costKeys();
  const r = await get(`SELECT MAX(month) m FROM pl_line_amount
      WHERE sector_id = ? AND year = ? AND kind = 'actual'
        AND line_key IN (${keys.map(() => '?').join(',')})`, [sec, y, ...keys]);
  const derived = Number(r?.m);
  if (Number.isInteger(derived) && derived >= 1 && derived <= 12) return { month: derived, source: 'derived' };
  return { month: null, source: null };
}

// ── المطابقة: رقم المالية مقابل ما سجّله أهل المشاريع في سند ────────────────────────────
//
// طرفان لرقمٍ واحد: ما تُقفله المالية بسطورها (`pl_line_amount`)، وما يُسجَّل في سند صرفاً
// على المشاريع (`expense` معتمداً أو مدفوعاً، صافياً كما في `sectorCosts` حرفاً) وبنودَ كلفة
// (`cost_line`). والمطابقة **لا تصحّح** أحد الطرفين: تقول «متقاربان» أو «بينهما فرق» ليذهب
// القارئ إلى مصدره.
//
// صفٌّ بلا شهر لا يُنسَب إلى شهر، فلا يدخل المقارنة الشهرية ولا البندية — ويُقال مجموعه
// صراحةً في `totals` كي لا يختفي صرفٌ حقيقي بين السطور.
async function sanadCostByMonthCategory(sectorId, year) {
  return all(`SELECT t.m m, t.category category, COALESCE(SUM(t.v), 0) v FROM (
        SELECT incurred_month m, category, COALESCE(net_amount_halalas, amount_halalas) v
          FROM expense
          WHERE sector_id = ? AND incurred_year = ? AND status IN ('APPROVED','PAID') AND deleted_at IS NULL
        UNION ALL
        SELECT month m, category, amount_halalas v
          FROM cost_line
          WHERE sector_id = ? AND year = ?
      ) t GROUP BY t.m, t.category`, [sectorId, year, sectorId, year]);
}

/**
 * مطابقة «تكلفة الإيراد» شهراً بشهر وبنداً ببند.
 *
 * @returns {Promise<{months:Array<{m:number, fin_cor:number|null, sanad_cor:number,
 *                                  diff:number|null, pct:number|null, match:boolean|null}>,
 *                    totals:object,
 *                    by_line:Array<{key:string, ar:string, fin:number|null, sanad:number|null,
 *                                   comparable:boolean, reason:string|null}>}>}
 */
export async function reconcile(sectorId, year) {
  const keys = costKeys();
  const sec = String(sectorId || '').trim();
  const y = targetYear(year);
  const blankMonths = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, fin_cor: null, sanad_cor: 0, diff: null, pct: null, match: null }));
  if (!sec) {
    return { months: blankMonths,
      totals: { fin_cor: null, sanad_cor: 0, diff: null, pct: null, match: null, sanad_unmonthed_halalas: 0 },
      by_line: keys.map((k) => lineVerdict(k, null, null)) };
  }

  const [finRows, sanadRows] = await Promise.all([
    all(`SELECT month, line_key, COALESCE(SUM(amount_halalas), 0) v FROM pl_line_amount
        WHERE sector_id = ? AND year = ? AND kind = 'actual'
          AND line_key IN (${keys.map(() => '?').join(',')})
        GROUP BY month, line_key`, [sec, y, ...keys]),
    sanadCostByMonthCategory(sec, y),
  ]);

  // ── الشهور: اثنا عشر دائماً، فشكل السنة لا يتغيّر بتغيّر ما أُدخل منها ──
  const finByMonth = new Map();
  for (const r of finRows) {
    const m = Number(r.month);
    if (!Number.isInteger(m) || m < 1 || m > 12) continue;
    finByMonth.set(m, (finByMonth.get(m) || 0) + (Number(r.v) || 0));
  }
  const sanadByMonth = new Map();
  let unmonthed = 0;
  for (const r of sanadRows) {
    const m = Number(r.m);
    const v = Number(r.v) || 0;
    if (!Number.isInteger(m) || m < 1 || m > 12) { unmonthed += v; continue; }
    sanadByMonth.set(m, (sanadByMonth.get(m) || 0) + v);
  }

  const months = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const fin = finByMonth.has(m) ? finByMonth.get(m) : null;
    const sanad = sanadByMonth.get(m) || 0;
    return { m, fin_cor: fin, sanad_cor: sanad, ...verdict(fin, sanad) };
  });

  const finTotal = finByMonth.size ? [...finByMonth.values()].reduce((a, v) => a + v, 0) : null;
  const sanadTotal = [...sanadByMonth.values()].reduce((a, v) => a + v, 0);
  const totals = { fin_cor: finTotal, sanad_cor: sanadTotal, ...verdict(finTotal, sanadTotal),
    sanad_unmonthed_halalas: unmonthed, months_entered: finByMonth.size };

  // ── البنود: المقابلة البندية لا تصحّ إلا حيث يُسجَّل البند في سند على مشروع ──
  const finByKey = new Map();
  for (const r of finRows) finByKey.set(r.line_key, (finByKey.get(r.line_key) || 0) + (Number(r.v) || 0));
  const sanadByKey = new Map();
  for (const r of sanadRows) {
    const m = Number(r.m);
    if (!Number.isInteger(m) || m < 1 || m > 12) continue;     // ما لا شهر له لا بند له في المقارنة
    const c = r.category == null ? null : String(r.category);
    if (!c || !keys.includes(c)) continue;                      // غير مصنَّف: لا يُنسب إلى سطر
    sanadByKey.set(c, (sanadByKey.get(c) || 0) + (Number(r.v) || 0));
  }
  const by_line = keys.map((k) => lineVerdict(k,
    finByKey.has(k) ? finByKey.get(k) : null,
    sanadByKey.has(k) ? sanadByKey.get(k) : null));

  return { months, totals, by_line };
}

// فرقٌ ونسبةٌ وحكم: الفراغ يبقى فراغاً، والقسمة على صفرٍ غيابٌ لا لانهاية، وعتبتا الحكم من
// مصدرهما الواحد (`core/i18n/thresholds.js`) فلا رقمَ منسوخ في شاشةٍ أو تقرير.
function verdict(fin, sanad) {
  if (fin == null) return { diff: null, pct: null, match: null };
  const diff = fin - sanad;
  const pct = fin ? Math.round((diff / fin) * 1000) / 10 : null;
  return { diff, pct, match: plReconMatch(fin, diff) };
}

function lineVerdict(key, fin, sanad) {
  const comparable = COMPARABLE_KEYS.includes(key);
  return {
    key,
    ar: LINE_BY_KEY[key]?.ar || key,
    fin,
    sanad,
    comparable,
    reason: comparable ? null : (NOT_COMPARABLE_AR[key] || 'لا يُقابَل بندياً'),
  };
}

// تُصدَّر للاختبار والشاشة: نصّ القاعدة رقماً واحداً لا يُعاد كتابته في مكانين.
export const RECON_THRESHOLDS = Object.freeze({ pct: PL_RECON_PCT, min_halalas: PL_RECON_MIN_HALALAS });
