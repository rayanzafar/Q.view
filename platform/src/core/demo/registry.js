// سجلّ البيانات التجريبية — ما بُذر للعرض يُعرَف بعينه ويُمحى بأمرٍ واحد.
//
// المبدأ الحاكم: **المحو لا يبحث، بل يقرأ.** لا يُمشَّط جدولٌ عن أسماء تشبه التجريبي، ولا
// يُخمَّن من اصطلاح تسمية. يُمحى ما سُجِّل هنا لا غير — فصفٌّ حقيقي لم يُسجَّل لا يستطيع المحو
// أن يبلغه مهما تشابهت الأسماء. الأمان خاصيّة بنيوية لا حذرٌ من الكاتب.
//
// والدفعة (batch) وحدة المحو: «سيناريوهات الدليل» تُمحى وحدها ولا تُسقط بذرة الأدوار معها.
import { all, get, run, insert, tx } from '../db/index.js';
import { id, nowIso } from '../util/ids.js';

// أسماء عربية لكل جدول يُبذر — الكشف قبل المحو يُقرأ بعينٍ بشرية، و«task» لا تعني شيئاً لمالك.
const TABLE_AR = {
  task: { one: 'مهمة', many: 'مهام' },
  opportunity: { one: 'فرصة', many: 'فرص' },
  project: { one: 'مشروع', many: 'مشاريع' },
  client: { one: 'جهة', many: 'جهات' },
  employee: { one: 'موظف', many: 'موظفين' },
  app_user: { one: 'حساب', many: 'حسابات' },
  department: { one: 'إدارة', many: 'إدارات' },
  sector: { one: 'قطاع', many: 'قطاعات' },
  allocation: { one: 'تسكين', many: 'تسكينات' },
  org_unit: { one: 'وحدة', many: 'وحدات' },
  deliverable: { one: 'مخرج', many: 'مخرجات' },
  contract: { one: 'عقد', many: 'عقود' },
  invoice: { one: 'فاتورة', many: 'فواتير' },
  expense: { one: 'مصروف', many: 'مصروفات' },
  crm_activity: { one: 'نشاط', many: 'أنشطة' },
};
export const tableLabel = (t, n) => {
  const e = TABLE_AR[t];
  if (!e) return t;                       // جدولٌ لم يُترجَم بعد يُعرض باسمه لا بفراغ
  return Number(n) === 1 ? e.one : e.many;
};

// تسجيل صفٍّ بُذر. لا-عملية عند إعادة التشغيل (الفهرس الفريد على الدفعة+الجدول+الصف).
export async function recordDemo(batch, tableName, rowId, label = null) {
  if (!batch || !tableName || !rowId) return false;
  const existing = await get('SELECT id FROM demo_record WHERE batch = ? AND table_name = ? AND row_id = ?',
    [batch, tableName, rowId]);
  if (existing) return false;
  await insert('demo_record', {
    id: id('dmo'), batch, table_name: tableName, row_id: String(rowId),
    label: label ? String(label).slice(0, 200) : null, created_at: nowIso(),
  });
  return true;
}

// الدفعات القائمة ومقاديرها — الجواب على «ماذا يوجد من بيانات تجريبية الآن».
export async function listBatches() {
  const rows = await all(`SELECT batch, table_name, COUNT(*) n,
       SUM(CASE WHEN purged_at IS NULL THEN 1 ELSE 0 END) alive
     FROM demo_record
     GROUP BY batch, table_name
     ORDER BY batch, table_name`);
  const byBatch = new Map();
  for (const r of rows) {
    if (!byBatch.has(r.batch)) byBatch.set(r.batch, { batch: r.batch, total: 0, alive: 0, tables: [] });
    const b = byBatch.get(r.batch);
    b.total += Number(r.n) || 0;
    b.alive += Number(r.alive) || 0;
    if (Number(r.alive) > 0) b.tables.push({ table: r.table_name, n: Number(r.alive), label: tableLabel(r.table_name, r.alive) });
  }
  return [...byBatch.values()];
}

// كشفٌ بما سيُمحى — **قبل** المحو لا بعده. يُقرأ بعينٍ بشرية ثم يُقرَّر.
export async function previewPurge(batch) {
  const rows = await all(`SELECT table_name, COUNT(*) n FROM demo_record
     WHERE batch = ? AND purged_at IS NULL GROUP BY table_name ORDER BY table_name`, [batch]);
  const items = rows.map((r) => ({ table: r.table_name, n: Number(r.n) || 0, label: tableLabel(r.table_name, r.n) }));
  return { batch, total: items.reduce((a, x) => a + x.n, 0), items };
}

// المحو. الترتيب: الأحدث إدراجاً أولاً — ما أُنشئ أخيراً يعتمد غالباً على ما قبله، فمحوُه أولاً
// يتجنّب كسر المفاتيح الأجنبية بلا خريطة اعتماد يدوية تتقادم مع أول جدول جديد.
//
// والحذف **صلب** لا ناعم: بيانات العرض لا تاريخ لها يُصان، وتركُها بعلامة حذف يُبقيها في كل
// استعلامٍ نسي شرط deleted_at — وهو ما يُنتج «مسحتُها ومازالت تظهر».
//
// ما تعذّر حذفه (صفٌّ حقيقي صار يشير إليه) لا يُبتلَع: يعود في `failed` بسببه، ويبقى مسجَّلاً
// كي تُعاد المحاولة بعد معالجة سببه. الادّعاء بمحوٍ لم يقع أسوأ من الإخفاق المعلن.
export async function purgeBatch(batch, opts = {}) {
  if (!batch) throw new Error('حدّد اسم الدفعة');
  const rows = await all(`SELECT id, table_name, row_id, label FROM demo_record
     WHERE batch = ? AND purged_at IS NULL ORDER BY created_at DESC, id DESC`, [batch]);
  if (!rows.length) return { batch, purged: 0, failed: [], note: 'لا صفوف حيّة في هذه الدفعة' };
  if (opts.dryRun) return { batch, purged: 0, wouldPurge: rows.length, failed: [] };

  const now = nowIso();
  const failed = [];
  let purged = 0;
  // كل صف في محاولته: سقوط واحد لا يُسقط الدفعة كلها — البيانات التجريبية تُمحى بأفضل جهد،
  // والباقي يُقال صراحةً. (وهذا عكس النقل: هناك الذرّية تحمي اتساق الهيكل، وهنا لا شيء يُكسَر.)
  for (const r of rows) {
    try {
      await tx(async () => {
        await run(`DELETE FROM ${r.table_name} WHERE id = ?`, [r.row_id]);
        await run('UPDATE demo_record SET purged_at = ? WHERE id = ?', [now, r.id]);
      });
      purged++;
    } catch (e) {
      failed.push({ table: r.table_name, rowId: r.row_id, label: r.label, reason: e && e.message });
    }
  }
  return { batch, purged, failed };
}

// أسماء الجداول المسموح بذرها — حارسٌ ضد خطأ مطبعي في اسم جدول يجعل المحو صامتاً بلا أثر.
export const SEEDABLE_TABLES = Object.keys(TABLE_AR);
export function assertSeedable(tableName) {
  if (!SEEDABLE_TABLES.includes(tableName)) {
    throw new Error(`جدول «${tableName}» غير مُدرَج في سجل البيانات التجريبية — أضِفه إلى TABLE_AR أولاً`);
  }
}
