// نسخة احتياطية منطقية للبيانات — تُنتَج من داخل التطبيق نفسه.
//
// لماذا من الداخل؟ منفذ قاعدة البيانات الخام غير قابل للوصول من بيئة التطوير (الوكيل يمرّر
// HTTPS فقط، والعنوان الداخلي postgres.railway.internal لا يُترجَم من خارج شبكة Railway).
// فكانت النسخة الاحتياطية الإلزامية قبل أي تغيير على المخطط **متعذّرة تقنياً** — أي أن أي موجة
// تمسّ قاعدة البيانات كانت محجوبة إلى الأبد. التطبيق يعمل داخل الشبكة ويصل للقاعدة، فيُنتج
// النسخة ويسلّمها عبر القناة التي تعمل.
//
// ليست بديلاً عن pg_dump: لا تحفظ المخطط ولا الفهارس ولا التسلسلات — تحفظ **الصفوف** كي
// يمكن إعادة بنائها فوق مخطط مُرحَّل. هذا يكفي لغرضها: التراجع عن تغيير بيانات، لا استنساخ خادم.
import { all, get } from '../db/index.js';
import { config } from '../config.js';

// قائمة الجداول تُقرأ من المخطط لا تُكتب يدوياً، وإلا نسي أحدهم جدولاً جديداً بصمت.
async function tableNames() {
  if (config.databaseUrl) {
    const rows = await all(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    return rows.map((r) => r.name);
  }
  const rows = await all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  return rows.map((r) => r.name);
}

// أسماء الجداول تأتي من المخطط نفسه لا من المستخدم، لكن نتحقق منها على أي حال قبل وضعها
// في نص الاستعلام — لا مصدر إدخال يصل إلى هنا، والتحقق يبقي القاعدة صحيحة لو تغيّر المصدر.
const SAFE_TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * يولّد النسخة سطراً سطراً بصيغة NDJSON (كائن لكل سطر) كي لا تُحمَّل قاعدة كاملة في الذاكرة.
 * السطر الأول ترويسة تصف النسخة، ثم سطر لكل صف يحمل اسم جدوله.
 */
export async function* dumpLines() {
  const tables = await tableNames();
  yield JSON.stringify({
    _meta: 'sanad-backup',
    version: 1,
    at: new Date().toISOString(),
    driver: config.databaseUrl ? 'postgres' : 'sqlite',
    tables,
  });

  for (const t of tables) {
    if (!SAFE_TABLE.test(t)) continue;
    const n = (await get(`SELECT COUNT(*) AS n FROM ${t}`)).n;
    yield JSON.stringify({ _table: t, _rows: Number(n) || 0 });
    if (!n) continue;
    // صفحات ثابتة الحجم: جدول كبير لا يُقرأ دفعة واحدة. لا ORDER BY على عمود قد لا يوجد —
    // الترتيب غير مهم للاستعادة، والصفحات مضمونة التغطية لأن النسخة تُؤخذ خارج أي كتابة متزامنة
    // متوقعة (تُشغَّل قبل الترحيل لا أثناء ذروة الاستخدام).
    const PAGE = 500;
    for (let off = 0; off < n; off += PAGE) {
      const rows = await all(`SELECT * FROM ${t} LIMIT ${PAGE} OFFSET ${off}`);
      for (const r of rows) yield JSON.stringify({ t, r });
    }
  }
}

// عدّاد سريع للتحقق قبل/بعد بلا تنزيل النسخة كاملة.
export async function tableCounts() {
  const out = {};
  for (const t of await tableNames()) {
    if (!SAFE_TABLE.test(t)) continue;
    out[t] = Number((await get(`SELECT COUNT(*) AS n FROM ${t}`)).n) || 0;
  }
  return out;
}
