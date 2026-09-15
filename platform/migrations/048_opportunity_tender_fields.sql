-- ٠٤٨ — حقول المنافسة الثابتة على الفرصة، والحقول الحرّة لكل فرصة
--
-- بلسان التدقيق المستقل (12 سبتمبر 2026): فرصةٌ حكومية بثمانية ملايين بلا رقم منافسة ولا موعد
-- تقديم «ليست سجلاً — بل موضعَ سجل». وكانت الفرصة الحقيقية المسجَّلة ذلك اليوم: منافسة برقم،
-- أربعة وعشرون شهراً، تحالف شركتين، وعرضٌ قُدِّم في يومٍ معلوم — ولا عمودَ لأيٍّ من ذلك،
-- فسقط كله عند التسجيل وبقيت الفرصة عنواناً وقيمة.
--
-- وقرار المالك: «ثابتة مشتركة + حرّة لكل منافسة». فالثابتُ ما تسأله كلُّ منافسةٍ تقريباً ويُرشَّح
-- به ويُقارَن عليه (رقمُها وموعدُها ومدّتُها وشركاؤها)، والحرُّ ما تسأله منافسةٌ بعينها (اسم
-- مشروع الجهة، رقم الضمان، شرطٌ خاص) ولا يستحقّ عموداً يحمله مئةُ صفٍّ آخر فارغاً.
--
-- ── الثابت: خمسة أعمدة بلا قيمة افتراضية ────────────────────────────────────────────────
-- الفراغ يقول «لم يُحدَّد بعد» بصدق — كما في الترحيلتين 021 و024 — ولا يُكتب شيء نيابةً عن أحد.
-- والتواريخ أيامٌ بصيغة سنة-شهر-يوم كسائر أيام المنصة، والمدة عددُ أشهرٍ صحيح.
ALTER TABLE opportunity ADD COLUMN tender_no TEXT;
ALTER TABLE opportunity ADD COLUMN submission_due TEXT;
ALTER TABLE opportunity ADD COLUMN submitted_on TEXT;
ALTER TABLE opportunity ADD COLUMN duration_months INTEGER;
ALTER TABLE opportunity ADD COLUMN consortium_partners TEXT;
-- رقم المنافسة يُبحث به ويُطابَق عليه — فهرسٌ له وحده.
CREATE INDEX IF NOT EXISTS ix_opp_tender_no ON opportunity(tender_no);

-- ── الحرّ: اسمٌ وقيمة لكل فرصة ──────────────────────────────────────────────────────────
-- صفٌّ لكل سؤالٍ خاص. الاسم عربيٌّ حرّ يفرد الفرصةَ الواحدة (تفرُّده يُحرَس في الخدمة داخل
-- المعاملة لا بقيدٍ جزئي، فيبقى الحذف ناعماً ويُستعاد). ولا نوع للقيمة: نصٌّ يُقرأ كما كُتب.
CREATE TABLE IF NOT EXISTS opportunity_field (
  id             TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  name_ar        TEXT NOT NULL,
  value_text     TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  created_by     TEXT REFERENCES app_user(id),
  updated_at     TEXT,
  updated_by     TEXT REFERENCES app_user(id),
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_opp_field_opp ON opportunity_field(opportunity_id);
