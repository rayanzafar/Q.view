// ── الحذف كقدرة مكتملة في المنتج ──
//
// كان في المنصة حذفُ موظف وحذفُ إدارة وحذفُ تسكين — ولا حذفَ مشروعٍ ولا فرصة. فبيانات مستوردة
// من نظامٍ قديم (أوعية داخلية، مشاريع باسم إدارة، صفوف بلا جهة) تبقى إلى الأبد في المحافظ
// والتقارير، ولا سبيل إلى تنظيفها إلا بفتح القاعدة يدوياً — وهو بابٌ خارج التدقيق وخارج
// الصلاحيات، أي خارج كل ما بُنيت عليه المنصة.
//
// وثلاثة مبادئ تحكم هذا الملف، وهي ما يجعل الحذف آمناً بذاته لا بحُسن نيّة مَن يستعمله:
//
// ١) **المال لا يُحذف.** صفٌّ عليه فاتورة أو تحصيل أو عقد أو مستخلص يُرفض حذفه دائماً — لا
//    خيار ولا تجاوز. المال أثرٌ محاسبي، وحذفه يكسر مطابقةً لا تُستعاد من نسخة احتياطية.
//
// ٢) **لا يُترك يتيم.** حذفُ الأصل يحذف تابعه في نفس المعاملة. رأينا هذا العطل بعينه في
//    الإدارات: صفٌّ يشير إلى إدارةٍ محذوفة لا يظهر في تجميع أي إدارة، ولا يعود إلى صندوق
//    «بلا إدارة» لأن حقله ليس فارغاً — فيختفي من الشاشتين معاً بصمت.
//
// ٣) **الرفض يُشرح.** «لا يمكن الحذف» رسالةٌ عاجزة. الرسالة تقول **ما يمنع بالعدد والاسم**،
//    فيعرف صاحبها ما يفعله بدل أن يعيد المحاولة.
//
// والحذف ناعم دائماً (deleted_at) — لا محو صفوف: الأثر يبقى للتدقيق، والرجوع نقرةٌ لا استعادةُ
// نسخة. والمحو النهائي إن لزم يوماً فقرارٌ آخر بأداةٍ أخرى.
import { get, all, run, tx } from '../db/index.js';
import { can } from '../rbac/index.js';
import { audit } from '../audit/index.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { nowIso } from '../util/ids.js';

// جمعٌ عربي صحيح للعدّ في رسائل المنع: «فاتورة واحدة» لا «١ فاتورة».
function countAr(n, one, two, many) {
  const x = Number(n) || 0;
  if (x === 1) return one;
  if (x === 2) return two;
  return `${x} ${many}`;
}

// وصفُ كل نوع: جدوله، اسمه، ما يمنع حذفه (مالٌ أو تحوُّل)، وما يُحذف معه (تابع).
export const REMOVABLE = {
  project: {
    table: 'project',
    label: 'المشروع',
    nameCol: 'name_ar',
    resource: 'project',
    // المال والالتزام التعاقدي: يمنعان الحذف دائماً
    blockers: [
      { table: 'invoice', col: 'project_id', ar: (n) => countAr(n, 'فاتورة واحدة', 'فاتورتين', 'فاتورة') },
      { table: 'collection', col: 'project_id', ar: (n) => countAr(n, 'تحصيل واحد', 'تحصيلين', 'تحصيلاً') },
      { table: 'contract', col: 'project_id', ar: (n) => countAr(n, 'عقد واحد', 'عقدين', 'عقداً') },
      { table: 'revenue_line', col: 'project_id', ar: (n) => countAr(n, 'سطر إيراد واحد', 'سطري إيراد', 'سطر إيراد') },
    ],
    // التابع يُحذف معه في نفس المعاملة — فلا صفَّ يشير إلى مشروعٍ لا وجود له
    cascade: [
      { table: 'allocation', col: 'project_id', ar: 'تسكين' },
      { table: 'task', col: 'project_id', ar: 'مهمة' },
      { table: 'deliverable', col: 'project_id', ar: 'مخرج' },
      { table: 'milestone', col: 'project_id', ar: 'معلم' },
      { table: 'risk', col: 'project_id', ar: 'خطر' },
      { table: 'issue', col: 'project_id', ar: 'عائق' },
    ],
  },
  opportunity: {
    table: 'opportunity',
    label: 'الفرصة',
    nameCol: 'title_ar',
    resource: 'opportunity',
    blockers: [
      // فرصةٌ تحوّلت إلى مشروع لم تعد فرصةً تُحذف: حذفها يقطع نسب المشروع إلى مصدره
      { table: 'project', col: 'source_opp_id', ar: (n) => countAr(n, 'مشروعٌ قائم', 'مشروعان قائمان', 'مشروعاً قائماً') },
      { table: 'contract', col: 'opportunity_id', ar: (n) => countAr(n, 'عقد واحد', 'عقدين', 'عقداً') },
    ],
    cascade: [
      { table: 'opportunity_sector', col: 'opportunity_id', ar: 'إسناد قطاع', hard: true },
      { table: 'crm_activity', col: 'opportunity_id', ar: 'نشاط' },
      { table: 'proposal', col: 'opportunity_id', ar: 'عرض' },
    ],
  },
};

// ما يحمله الجدول فعلاً في هذه القاعدة — لا ما نفترضه.
//
// **ليس كل جدول عنده حذفٌ ناعم**: الفاتورة وسطر الإيراد والتحصيل بلا عمود `deleted_at`
// (حالتها تُدار بحقل الحالة). وافتراضُ وجوده يرمي «لا يوجد هذا العمود» فيُردّ **كلُّ** حذفٍ
// بخطأٍ غامض — بما فيه الحذف المشروع. وأسوأُ منه لو التُقط الخطأ بصمت: يصير المانع المالي
// غير محسوب، فيُحذف مشروعٌ عليه فاتورة. فيُقرأ المخطط ويُبنى الاستعلام على ما وُجد.
const shapeCache = new Map();
async function shapeOf(table, col) {
  const key = `${table}.${col}`;
  if (shapeCache.has(key)) return shapeCache.get(key);
  let hasCol = false, soft = false;
  try { await get(`SELECT ${col} FROM ${table} WHERE 1 = 0`); hasCol = true; } catch { hasCol = false; }
  if (hasCol) { try { await get(`SELECT deleted_at FROM ${table} WHERE 1 = 0`); soft = true; } catch { soft = false; } }
  const v = { hasCol, soft };
  shapeCache.set(key, v);
  return v;
}

async function countLive(table, col, id) {
  const { hasCol, soft } = await shapeOf(table, col);
  if (!hasCol) return 0;
  const sql = soft
    ? `SELECT COUNT(*) n FROM ${table} WHERE ${col} = ? AND deleted_at IS NULL`
    : `SELECT COUNT(*) n FROM ${table} WHERE ${col} = ?`;
  const r = await get(sql, [id]);
  return Number(r?.n || 0);
}

// ما يمنع الحذف — يُحسب كاملاً قبل أي رفض، كي تُقال الأسباب مجتمعةً لا سبباً واحداً في كل محاولة.
export async function removalBlockers(kind, id) {
  const cfg = REMOVABLE[kind];
  if (!cfg) throw badRequest('نوعٌ غير معروف للحذف');
  const out = [];
  for (const b of cfg.blockers) {
    const n = await countLive(b.table, b.col, id);
    if (n) out.push(b.ar(n));
  }
  return out;
}

/**
 * حذفٌ ناعم محروس. يرمي رسالةً عربية تسمّي المانع بعدده، أو يحذف الأصل وتابعه معاً.
 * @returns {{ok:true, id:string, cascaded:Record<string,number>}}
 */
export async function removeRecord(ctx, kind, id, opts = {}) {
  const cfg = REMOVABLE[kind];
  if (!cfg) throw badRequest('نوعٌ غير معروف للحذف');
  const row = await get(`SELECT * FROM ${cfg.table} WHERE id = ? AND deleted_at IS NULL`, [id]);
  if (!row) throw notFound(`${cfg.label} غير موجود أو محذوف سابقاً`);
  if (!can(ctx.user, 'delete', cfg.resource, row)) {
    throw forbidden(`حذف ${cfg.label} يتطلب صلاحية إدارية على قطاعه`);
  }

  const blockers = await removalBlockers(kind, id);
  if (blockers.length) {
    throw badRequest(
      `لا يمكن حذف ${cfg.label} «${row[cfg.nameCol] || id}» — عليه ${blockers.join(' و')}. `
      + 'السجلات المالية والتعاقدية لا تُحذف: انقلها أو أغلقها أولاً، أو غيّر حالة السجل إلى «مُلغى» بدل حذفه.',
    );
  }

  const name = row[cfg.nameCol] || id;
  const cascaded = {};
  const stamp = nowIso();
  await tx(async () => {
    for (const c of cfg.cascade) {
      const shape = await shapeOf(c.table, c.col);
      if (!shape.hasCol) continue;
      // جدولٌ بلا حذفٍ ناعم لا يُختم — يُترك كما هو ويُذكر أنه لم يُمسّ، فلا ادّعاءَ تنظيفٍ لم يحدث
      if (!shape.soft && !c.hard) continue;
      if (c.hard) {
        // جداول الربط بلا حذفٍ ناعم: صفُّ ربطٍ إلى أصلٍ محذوف لا معنى له ولا أثر فيه
        const r = await run(`DELETE FROM ${c.table} WHERE ${c.col} = ?`, [id]);
        if (Number(r.changes || 0)) cascaded[c.ar] = Number(r.changes);
        continue;
      }
      const r = await run(`UPDATE ${c.table} SET deleted_at = ? WHERE ${c.col} = ? AND deleted_at IS NULL`, [stamp, id]);
      if (Number(r.changes || 0)) cascaded[c.ar] = Number(r.changes);
    }
    await run(`UPDATE ${cfg.table} SET deleted_at = ? WHERE id = ?`, [stamp, id]);
    const tail = Object.entries(cascaded).map(([k, n]) => `${n} ${k}`).join('، ');
    await audit(ctx, {
      action: 'delete', resource: cfg.resource, resourceId: id, sectorId: row.sector_id || null,
      detail: `حذف ${cfg.label} «${name}»${tail ? ` ومعه ${tail}` : ''}`
        + (opts.reason ? ` — السبب: ${String(opts.reason).slice(0, 160)}` : ''),
    });
  });
  return { ok: true, id, name, cascaded };
}
