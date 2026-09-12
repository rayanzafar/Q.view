-- سجلُّ الأعطال: صفٌّ لكل عطبٍ مميَّز، لا لكل وقوع.
--
-- لماذا جدولٌ مستقلٌّ لا `audit_log`، وهذا هو السبب الحاسم: `audit()` يكتب عبر `insert`
-- فينضمّ إلى معاملة مُستدعيه. وعطبٌ يقع داخل معاملةٍ يُرجِعها — ومعها صفُّ تدقيقه. أي أن
-- السجلَّ الذي نحتاجه أكثر من غيره هو الوحيد المضمون اختفاؤه. ويُضاف إلى ذلك أن التدقيق
-- «لأفعال الناس لا لكنس الآلة» (نصُّ المجدول)، وأن للأعطال عمراً محدوداً وسقفاً بينما
-- التدقيق يُحفظ — ولا يحتمل جدولٌ واحد سياستَي احتفاظ.
--
-- وكلُّ عبارةٍ هنا `IF NOT EXISTS` كي تُعاد بلا ضرر: الترحيلة تُطبَّق ثم يُكتب صفُّ تتبّعها
-- في نداءَين بلا معاملةٍ تجمعهما (علّةٌ موثَّقة في الترحيلة 035)، فانقطاعٌ بينهما يعني
-- إعادةَ تطبيقٍ في الإقلاع التالي. ولا `ALTER TABLE` هنا، فلا يتكرّر فخُّ 035.
--
-- والحذف هنا **قاطعٌ لا ناعم** خلافاً لعرف المنصة: `deleted_at` على صفوف الأعطال يُبطل
-- سياسة الاحتفاظ من أصلها — الغرضُ من الكنس أن يصغر الجدول لا أن يكبر بصفوفٍ موسومة.
CREATE TABLE IF NOT EXISTS error_event (
  fingerprint    TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,              -- http | job | rejection
  source         TEXT,                       -- المسار المقنَّع، أو اسم المهمّة
  method         TEXT,
  status         INTEGER,
  err_kind       TEXT,
  err_code       TEXT,
  message        TEXT,                       -- للسجل والتشخيص — لا يُعرض خاماً في صفحة
  stack          TEXT,                       -- كذلك
  hits           INTEGER NOT NULL DEFAULT 1,
  first_at       TEXT NOT NULL,
  last_at        TEXT NOT NULL,
  last_req_id    TEXT,
  last_user      TEXT,
  last_role      TEXT,
  top_role_rank  INTEGER NOT NULL DEFAULT 0,
  digestable     INTEGER NOT NULL DEFAULT 1, -- 0 = لا يُنبَّه عليه بالبريد (قطعُ الحلقة)
  notified_at    TEXT,
  notified_hits  INTEGER NOT NULL DEFAULT 0,
  muted_at       TEXT
);

CREATE INDEX IF NOT EXISTS ix_error_last_at ON error_event(last_at);
CREATE INDEX IF NOT EXISTS ix_error_notified ON error_event(notified_at);
