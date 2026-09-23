// محوّل استيراد/تصدير سطور قائمة الدخل (`pl_line_amount`) — ما تُقفله المالية شهراً بشهر
// وسطراً بسطر، فعلياً وخطةً، لقطاعٍ واحد في سنةٍ واحدة.
//
// الكتابة كلها عبر `modules/finance/pl-lines.js` (خدمة D2) ولا سطر إدراجٍ خام هنا: البوابتان
// (منح المورد `pl_line` على القطاع + بوابة الحقل الحساس `cost`) وقاعدةُ «صفٌّ مكرَّر في الدفعة
// يُردّ» والتدقيق والإصدار — كلها في الخدمة، فيرث المحوّل حراسها كما يرثها زرُّ الشاشة.
//
// ملاحظة بنيوية (نفس نظيره `revenues.js`): الجدول **بلا حذف ناعم**، فالتراجع عن صفٍّ أنشأه
// الاستيراد يحذفه فعلياً عبر `deletePlLine`، والتراجع عن تحديثٍ يعيد المبلغ والملاحظة بالخدمة
// نفسها (فيرتفع الإصدار مرةً أخرى — إعادةُ الرقم إلى ما كان حدثٌ في حياته يقرؤه المراجع).
//
// وسطرا «تكلفة الإيراد» و«مجمل الربح» لا يُستورَدان: يُحسبان من السطور التي فوقهما. فمن كتبهما
// في الملف يُردّ عليه بسببٍ يقوله بالعربية، لا بخطأ «قيمة غير معروفة» يتركه يخمّن.
import { all, get } from '../../../core/db/index.js';
import { can, canSeeSensitive } from '../../../core/rbac/index.js';
import { scopeFilter } from '../../../core/rbac/scope.js';
import { toSar } from '../../../core/util/ids.js';
import { badRequest, forbidden } from '../../../core/http/errors.js';
import { PL_LINES, COST_KEYS, LINE_BY_KEY } from '../../finance/income-statement.js';
import { savePlActuals, savePlPlan, deletePlLine } from '../../finance/pl-lines.js';

// ── القوائم المعتمدة ─────────────────────────────────────────────────────────────────────
/** ما يُكتب في عمود «البند»: الإيراد وسطور الكلفة الستة. */
export const WRITABLE_KEYS = Object.freeze(['rev', ...COST_KEYS]);
/** ما يُحسب ولا يُكتب — يُردّ بسببه لا برسالة عامة. */
const DERIVED_KEYS = Object.freeze(PL_LINES.filter((l) => !WRITABLE_KEYS.includes(l.key)).map((l) => l.key));

const LINE_OPTIONS = Object.freeze(PL_LINES.map((l) => Object.freeze({
  v: l.key, labels: Object.freeze([l.ar, l.key, l.en]),
})));
const KIND_OPTIONS = Object.freeze([
  { v: 'actual', labels: Object.freeze(['فعلي', 'الفعلي', 'محقق', 'actual']) },
  { v: 'plan', labels: Object.freeze(['خطة', 'الخطة', 'plan']) },
].map((o) => Object.freeze(o)));
const KIND_AR = Object.freeze({ actual: 'فعلي', plan: 'خطة' });

const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

// ── أدوات صغيرة ──────────────────────────────────────────────────────────────────────────
const sameText = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

/** بوابةُ الرؤية المالية الكاملة: الكلفة والهامش معاً — ومن لا يملكهما لا تخرج له سطور الكلفة. */
const seesCost = (user) => canSeeSensitive(user, 'cost') && canSeeSensitive(user, 'margin');

/** سطور يقرؤها هذا المستخدم في هذا القطاع: الإيراد بمنح الإيراد، والكلفة ببوابتها. */
function readableKeys(user, sectorId) {
  const keys = [];
  if (can(user, 'read', 'revenue_line', { sector_id: sectorId })) keys.push('rev');
  if (seesCost(user)) keys.push(...COST_KEYS);
  return keys;
}

function checkLine(mapped) {
  if (DERIVED_KEYS.includes(mapped.line)) {
    throw badRequest(`سطر «${LINE_BY_KEY[mapped.line].ar}» يُحسب من السطور التي فوقه — أدخل بنود الكلفة وسيظهر وحده`);
  }
  if (!WRITABLE_KEYS.includes(mapped.line)) {
    throw badRequest('هذا البند ليس من بنود قائمة الدخل — اختر بنداً من القائمة المعتمدة');
  }
}

// حارسٌ يسبق قراءة الصفّ: وجود الرقم نفسه خبرٌ لا يخرج لمن لا يراه.
//
// وحارسُ القطاع يسبق الجميع (كما في `revenues.js`): من لا يكتب في هذا القطاع لا يُقرأ له صفّه
// أصلاً، فلا يعرف من كلمة «تحديث» أنّ الصفّ موجود، ولا من «مطابق تماماً» أنّ المبلغ هو ما خمّنه.
// والردّ واحدٌ في الحالات الثلاث — موجودٌ بالمبلغ نفسه، أو بمبلغٍ آخر، أو غير موجود — كي لا
// يصير اختلافُ النصّ نفسه هو الخبر.
function checkReadable(user, mapped) {
  checkLine(mapped);
  if (!can(user, 'update', 'pl_line', { sector_id: mapped.sector })
    && !can(user, 'create', 'pl_line', { sector_id: mapped.sector })) {
    throw forbidden('سطور قائمة الدخل لهذا القطاع خارج صلاحيتك');
  }
  if (mapped.line === 'rev') {
    if (!can(user, 'read', 'revenue_line', { sector_id: mapped.sector })) {
      throw badRequest('سطر الإيراد لهذا القطاع خارج صلاحيتك — احذف صفّه من الملف');
    }
    return;
  }
  // بوابةُ الكلفة على قطاع الصفّ لا على قطاع القارئ: الرؤية المالية الكاملة **ومنحُ القراءة هنا**.
  if (!can(user, 'read', 'pl_line', { sector_id: mapped.sector }) || !seesCost(user)) {
    throw badRequest('أرقام التكلفة خارج صلاحيتك — راجع مدير النظام');
  }
}

const findExisting = (m) => get(
  'SELECT * FROM pl_line_amount WHERE sector_id = ? AND year = ? AND month = ? AND line_key = ? AND kind = ?',
  [m.sector, m.year, m.month, m.line, m.kind]);

/** ما يميّز صفّاً مستورَداً عمّا في الجدول: المبلغ والملاحظة وحدهما (المفاتيح الخمسة هوية لا تغيير). */
function changesOf(existing, mapped) {
  const out = [];
  if (Number(existing.amount_halalas) !== Number(mapped.amount)) out.push('amount');
  if (!sameText(existing.note, mapped.note)) out.push('note');
  return out;
}

/** كتابةُ صفٍّ واحد بالخدمة — دفعةٌ من سطرٍ واحد (الخدمة تقبل مصفوفة). */
async function saveOne(ctx, { sector, year, month, line, kind, amount, note }) {
  const save = kind === 'plan' ? savePlPlan : savePlActuals;
  const res = await save(ctx, {
    sectorId: sector, year,
    rows: [{ month, line_key: line, amount_halalas: amount, note: note ?? null }],
    source: 'import',
  });
  return res.saved[0];
}

/** لقطةُ «بعد» ما زالت هي الحاضر؟ — وإلا فالتراجع يمحو تعديلاً لاحقاً لا يعرفه. */
function assertUntouched(cur, after) {
  const changed = !after
    || Number(cur.revision) !== Number(after.revision)
    || Number(cur.amount_halalas) !== Number(after.amount_halalas)
    || !sameText(cur.note, after.note);
  if (changed) throw badRequest('تغيّر السطر بعد الاستيراد — راجع التعديل الأحدث قبل التراجع');
}

export default {
  type: 'finance-pl',
  labelAr: 'سطور قائمة الدخل',
  resource: 'pl_line',
  keySets: [['sector', 'year', 'month', 'line', 'kind']],
  columns: [
    { key: 'sector', labelAr: 'القطاع', required: true, parse: 'lookup', lookup: 'sector', aliases: ['اسم القطاع'] },
    { key: 'year', labelAr: 'السنة', required: true, parse: 'int', min: YEAR_MIN, max: YEAR_MAX },
    { key: 'month', labelAr: 'الشهر', required: true, parse: 'int', min: 1, max: 12, aliases: ['رقم الشهر'] },
    { key: 'line', labelAr: 'البند', required: true, parse: 'enum', enum: LINE_OPTIONS, aliases: ['السطر', 'بند قائمة الدخل'] },
    { key: 'kind', labelAr: 'النوع', required: true, parse: 'enum', enum: KIND_OPTIONS, aliases: ['فعلي أو خطة'] },
    { key: 'amount', labelAr: 'المبلغ (ريال)', required: true, parse: 'money', min: 0, aliases: ['المبلغ', 'القيمة'] },
    { key: 'note', labelAr: 'ملاحظة', aliases: ['ملاحظات', 'البيان'] },
  ],
  exampleRow: {
    sector: 'اسم القطاع', year: new Date().getUTCFullYear(), month: 1,
    line: LINE_BY_KEY.sal.ar, kind: KIND_AR.actual, amount: 250000, note: 'من إقفال المالية',
  },

  // ── التصدير ────────────────────────────────────────────────────────────────────────────
  // نطاقُ القارئ من قاعدة البيانات، وسطورُ الكلفة **تُحذف كلياً** لمن لا يرى الكلفة والهامش
  // (لا تُفرَّغ قيمتها): صفٌّ فارغ في ملفٍ مالي يُقرأ «لا يوجد» والحقيقة «لا تملك رؤيته».
  async fetchRows(user, filters = {}) {
    const keys = readableKeys(user, user?.sector_id || null);
    if (!keys.length) return [];
    const f = scopeFilter(user, 'pl_line', 'read', { sectorCol: 'p.sector_id' });
    const where = [f.clause, `p.line_key IN (${keys.map(() => '?').join(',')})`];
    const params = [...f.params, ...keys];
    if (filters.year) { where.push('p.year = ?'); params.push(Number(filters.year)); }
    if (filters.sector) { where.push('p.sector_id = ?'); params.push(String(filters.sector)); }
    if (filters.kind === 'actual' || filters.kind === 'plan') { where.push('p.kind = ?'); params.push(filters.kind); }
    const rows = await all(`
      SELECT p.*, s.name_ar sector_name
      FROM pl_line_amount p
      LEFT JOIN sector s ON s.id = p.sector_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.year, p.month, p.kind, p.line_key`, params);
    const order = new Map(WRITABLE_KEYS.map((k, i) => [k, i]));
    return rows
      // سطر الإيراد يُقرأ بمنح الإيراد على قطاع الصفّ نفسه لا على قطاع القارئ
      .filter((r) => (r.line_key !== 'rev' || can(user, 'read', 'revenue_line', { sector_id: r.sector_id })))
      .sort((a, b) => (a.year - b.year) || (a.month - b.month)
        || String(a.kind).localeCompare(String(b.kind))
        || ((order.get(a.line_key) ?? 99) - (order.get(b.line_key) ?? 99)))
      .map((r) => ({
        sector: r.sector_name || r.sector_id,
        year: r.year, month: r.month,
        line: LINE_BY_KEY[r.line_key]?.ar || r.line_key,
        kind: KIND_AR[r.kind] || r.kind,
        amount: toSar(r.amount_halalas),
        note: r.note || '',
      }));
  },

  // ── القرار ─────────────────────────────────────────────────────────────────────────────
  async resolveRow(ctx, mapped) {
    checkReadable(ctx?.user, mapped);
    const existing = await findExisting(mapped);
    if (!existing) return { action: 'create', existing: null, changes: [] };
    const changes = changesOf(existing, mapped);
    return { action: changes.length ? 'update' : 'skip', existing, changes };
  },

  rowTarget(mapped, resolved, user) {
    return { sector_id: mapped.sector || resolved?.existing?.sector_id || user?.sector_id || null };
  },
  rowLabel(mapped, lookups) {
    const sec = lookups?.sector?.rows?.find((s) => s.id === mapped.sector);
    const line = LINE_BY_KEY[mapped.line]?.ar || mapped.line || '';
    return `${sec?.name_ar || mapped.sector || ''} ${mapped.month}/${mapped.year} — ${line} (${KIND_AR[mapped.kind] || ''})`.trim();
  },

  // ── التنفيذ ────────────────────────────────────────────────────────────────────────────
  async applyRow(ctx, mapped) {
    checkReadable(ctx?.user, mapped);
    const saved = await saveOne(ctx, mapped);
    return { resource: 'pl_line', resourceId: saved.resourceId, before: saved.before, after: saved.after };
  },

  // ── التراجع ────────────────────────────────────────────────────────────────────────────
  async undoRow(ctx, row) {
    const cur = await get('SELECT * FROM pl_line_amount WHERE id = ?', [row.resource_id]);
    if (!cur) throw badRequest('السطر لم يعد موجوداً — راجع التغييرات قبل التراجع');
    assertUntouched(cur, row.after);
    if (row.action === 'create') {
      await deletePlLine(ctx, row.resource_id);
      return;
    }
    const b = row.before;
    if (!b) return;
    await saveOne(ctx, {
      sector: b.sector_id, year: b.year, month: b.month, line: b.line_key,
      kind: b.kind, amount: Number(b.amount_halalas) || 0, note: b.note ?? null,
    });
  },
};
