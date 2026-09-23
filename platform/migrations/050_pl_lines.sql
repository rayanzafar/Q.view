-- ٠٥٠ — سطور قائمة الدخل: كلفةٌ شهريةٌ مُدخَلة، وتصنيفٌ ثابت لما يُسجَّل في سند، وشهرُ الإقفال
--
-- المرحلة الأولى من قائمة الدخل (ترحيلةٌ لا سابقة لها في هذا الملف) سلّمت الإيراد حقيقياً
-- وتركت سطور الكلفة الستة **فارغة**: لا مصدرَ معتمداً يُنسِب صرفاً إلى سطرٍ بعينه. وهذه
-- الترحيلة تفتح البابين اللذين يملآنها، وتُسجّل شهر الإقفال الذي تُقرأ به.
--
-- ═══ البابُ الأول: ما تُدخله المالية شهرياً بسطورها ═══════════════════════════════════════
-- `pl_line_amount` صفٌّ واحد لكل (قطاع، سنة، شهر، سطر، نوع): «فعلي» ما أقفلته المالية،
-- و«خطة» ما وُضع للشهر نفسه. والمبلغ بالهللة عدداً صحيحاً كبقية المنصة.
--   • الرواتب من هنا وحدها لا من `employee.salary_halalas`: راتبُ الموظف بابٌ آخر لا يُجمع
--     ليصير كلفةَ قطاعٍ من ظهر الغيب، والمالية تعتمد رقمها بنفسها.
--   • صفٌّ موجود بقيمة صفر خبرٌ («أُقفل الشهر ولا صرف على هذا السطر»)، وغيابُ الصف خبرٌ آخر
--     («لم يُدخَل بعد»). ولذلك لا عمود `deleted_at` هنا — كما في `revenue_line` حرفاً: الصفّ
--     إما موجودٌ بقيمته أو غيرُ موجود، ولا حالةَ ثالثة «موجودٌ ومحذوف» تُقرأ صفراً أو فراغاً
--     بحسب من كتب الاستعلام. والتراجع عن استيرادٍ حذفٌ فعليٌّ للصف أو إعادةٌ لقيمته السابقة.
--   • التفرّد على (قطاع، سنة، شهر، سطر، نوع): الرفعةُ الثانية لشهرٍ تُحدِّث صفَّه ولا تضيف
--     ثانياً بجانبه، فلا يُجمع شهرٌ مرتين في سطرٍ واحد.
--   • `revision` يرتفع مع كل تحديث فيُعرف أن الرقم صُحِّح، و`import_run_id` يربط الصفّ
--     بالرفعة التي كتبته فيمكن التراجع عنها كاملةً، و`source` يقول من أين جاء (رفعة، إدخالٌ
--     يدوي)، و`note` يحمل تعليل المالية إن كتبته.
CREATE TABLE IF NOT EXISTS pl_line_amount (
  id             TEXT PRIMARY KEY,
  sector_id      TEXT NOT NULL REFERENCES sector(id),
  year           INTEGER NOT NULL,
  month          INTEGER NOT NULL,
  line_key       TEXT NOT NULL,          -- sal|con|ctr|lic|rent|oth|rev
  kind           TEXT NOT NULL,          -- actual|plan
  amount_halalas INTEGER NOT NULL DEFAULT 0,  -- SENSITIVE
  source         TEXT,
  note           TEXT,
  revision       INTEGER NOT NULL DEFAULT 0,
  import_run_id  TEXT REFERENCES import_run(id),
  created_by     TEXT REFERENCES app_user(id),
  created_at     TEXT NOT NULL,
  updated_by     TEXT REFERENCES app_user(id),
  updated_at     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pl_line_amount ON pl_line_amount(sector_id, year, month, line_key, kind);
CREATE INDEX IF NOT EXISTS ix_pl_line_amount_run ON pl_line_amount(import_run_id);

-- ═══ البابُ الثاني: تصنيفُ ما يُسجَّل في سند نفسه ════════════════════════════════════════
-- `expense.type` و`cost_line.type` نصٌّ حرٌّ منذ أول يوم: «تذاكر»، «تذكرة سفر»، «سفر»
-- تُكتب ثلاثاً ولا تُجمع في سطرٍ واحد. فيُضاف بجانبه `category` من القائمة الستة المغلقة
-- نفسها (sal, con, ctr, lic, rent, oth) — والنصُّ الحرّ يبقى وصفاً يقرؤه الإنسان.
-- يبدأ فارغاً لا بقيمةٍ افتراضية: «أخرى» على صفٍّ قديم ادّعاءُ تصنيفٍ لم يقرّره أحد، وكان
-- يُدخل إلى سطر «مصاريف أخرى» مبالغَ هي في حقيقتها رواتبُ أو تعاقد. والصفوف القائمة تُصنَّف
-- بتعبئةٍ رجعيةٍ مستقلة بخريطةٍ يعتمدها المالك (سكربت لا ترحيلة، فالخريطة قرارٌ بشريّ).
ALTER TABLE expense   ADD COLUMN category TEXT;
ALTER TABLE cost_line ADD COLUMN category TEXT;

CREATE INDEX IF NOT EXISTS ix_expense_category ON expense(sector_id, incurred_year, category);
CREATE INDEX IF NOT EXISTS ix_cost_line_category ON cost_line(sector_id, year, category);

-- ═══ شهرُ الإقفال: مشتقٌّ من الرفعة، ويُتجاوَز بقرارٍ صريح ═══════════════════════════════
-- «حتى آخر شهرٍ مغلق» تقرأ آخر شهرٍ أدخلته المالية فعلاً. لكن المالية قد تُقفل متأخرةً أو
-- تُقفل شهراً بلا صرفٍ على أي سطر، فيصير المشتقّ كاذباً في الطرفين. `closed_through_month`
-- تجاوزٌ صريح يكتبه مدير النظام حين يلزم، وفراغُه يعني «اقرأ المشتقّ» لا «لا شهر مغلق»:
-- الصفر هنا كان سيُقفل السنة كلها بسكوتٍ لا بقرار.
ALTER TABLE budget ADD COLUMN closed_through_month INTEGER;
