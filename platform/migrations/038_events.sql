-- ٠٣٨ — «الفعاليات»: التقاط بطاقات الزوّار في المعارض والمؤتمرات، قسمٌ معزول.
--
-- بلسان المالك (٢٠٢٦-٠٨-٢٧): قسمٌ مستقل داخل سند لالتقاط من نلتقيهم في المعارض — بطاقةٌ
-- تُلتقط في ثوانٍ على الجوال وسط الزحام، ثم تُراجَع بعد المعرض فتصير فرصةً أو شراكةً أو
-- تُترك. وهذا الملف يبني الجداول الأربعة التي يقوم عليها القسم كله.
--
-- ── العزل بنيةً لا عادةً ─────────────────────────────────────────────────────────────
-- لا مفتاح أجنبي من هنا إلى الفرص ولا العملاء ولا جهات الاتصال ولا المستندات، ولا عمودٌ
-- هناك يشير إلى هنا. جهةٌ تُلتقط في معرض ليست «جهة اتصال» في سجل العملاء: أكثرها لن يصير
-- شيئاً، وحشرُها في السجل الحيّ يلوّثه بمئات الصفوف الميتة. تحويلُها إلى فرصة أو عميل قرارٌ
-- بشريّ لاحق يُتّخذ من شاشة المراجعة — لا رابطٌ تلقائي يُكتب هنا.
-- ولا مفتاح أجنبي إلى المستخدمين ولا القطاعات عمداً: أسماء الملتقِط والمراجِع تُنسخ في
-- أعمدتها (captured_by_name وأخواتها) لأن الحساب قد يُحذف بعد المعرض بشهور، ويبقى السؤال
-- «من التقط هذه البطاقة» يحتاج جواباً يُقرأ بلا ربط.
--
-- ── الجداول ─────────────────────────────────────────────────────────────────────────
--   • event          الفعالية نفسها: اسمٌ ومكانٌ وتاريخا بداية ونهاية ورقم جناح، وختمُ إغلاق.
--   • event_contact  البطاقة الملتقطة: ما كُتب كما كُتب (raw_text لا يُعدَّل أبداً)، والحقول
--                    المستخرجة، وصورٌ مطبَّعة منها (phone_norm وname_norm وorg_norm وemail_norm)
--                    تُبنى في الخدمة وتخدم كشف التكرار داخل الفعالية الواحدة لا عبر الفعاليات.
--                    capture_key مفتاحٌ يولّده المتصفّح لكل التقاط، فإعادةُ الإرسال بعد انقطاع
--                    الشبكة تعود بالصفّ نفسه لا بصفٍّ ثانٍ — والفهرس الفريد يحرس ذلك بنيةً.
--   • event_partner  جهةُ تعاونٍ محتملة: من هي، ونوع الشراكة، وحالها، والخطوة التالية وموعدها.
--   • event_blob     بايتات صورة البطاقة داخل القاعدة (نفس قرار الترحيلة ٠٣٣: قرص الحاوية
--                    يزول مع كل نشرة)، ومرجعُها (kind, ref_id) فريد — صورةٌ واحدة لكل بطاقة.
--
-- ملاحظات تنفيذية مُلزمة لهذا الملف (قيد الترحيلتين ٠٢٣ و٠٣٦):
--   • لا علامة استفهام لاتينية في أي سطر هنا ولا حتى داخل تعليق: الملف كله يمرّ على مُحوِّل
--     العلامات إلى ترقيم دولارات عند التشغيل على Postgres. وإن لزمت فالعلامة العربية «؟».
--   • لا ALTER TABLE إطلاقاً، وكل عبارة IF NOT EXISTS كي تُعاد بلا ضرر (فخّ الترحيلة ٠٣٥).
--   • الأنواع INTEGER وBLOB كما تُكتب لـSQLite، وscripts/migrate.js يحوّلها لـPostgres.

CREATE TABLE IF NOT EXISTS event (
  id               TEXT PRIMARY KEY,
  name_ar          TEXT NOT NULL,
  venue            TEXT,                        -- المكان: مدينة أو قاعة
  starts_on        TEXT NOT NULL,               -- سنة-شهر-يوم
  ends_on          TEXT NOT NULL,               -- سنة-شهر-يوم، لا يسبق البداية
  booth_no         TEXT,                        -- رقم جناح الشركة إن وُجد
  created_by       TEXT NOT NULL,
  created_by_name  TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT,
  closed_at        TEXT,                        -- إغلاقٌ يدوي بعد المراجعة: لا التقاط بعده
  deleted_at       TEXT
);
CREATE INDEX IF NOT EXISTS ix_event_dates ON event(starts_on, ends_on);

CREATE TABLE IF NOT EXISTS event_contact (
  id                    TEXT PRIMARY KEY,
  event_id              TEXT NOT NULL REFERENCES event(id),
  kind                  TEXT NOT NULL,          -- تعريف بالشركة | شراكة | تعاون | توظيف
  person_name           TEXT,
  org_name              TEXT,
  job_title             TEXT,
  phone                 TEXT,
  phone_norm            TEXT,                   -- أرقامٌ لاتينية فقط بصيغة محلية موحَّدة
  email                 TEXT,
  email_norm            TEXT,
  website               TEXT,
  note                  TEXT,
  raw_text              TEXT,                   -- نصّ البطاقة كما أُلصق — لا يُعدَّل أبداً
  name_norm             TEXT,                   -- الاسم بلا ألقاب وبحروفٍ موحَّدة
  org_norm              TEXT,
  sector_id             TEXT,                   -- القطاع المعنيّ إن حُدِّد (بلا مفتاح أجنبي عمداً)
  capture_key           TEXT,                   -- مفتاح الالتقاط من المتصفّح لمنع الصفّ المكرَّر
  possible_duplicate_of TEXT,                   -- معرّف أقدم بطاقةٍ مشابهة في الفعالية نفسها
  outcome               TEXT NOT NULL DEFAULT 'لم تُراجع',
  outcome_note          TEXT,
  outcome_by            TEXT,
  outcome_by_name       TEXT,
  outcome_at            TEXT,
  captured_by           TEXT NOT NULL,
  captured_by_name      TEXT,
  captured_at           TEXT NOT NULL,
  updated_at            TEXT,
  deleted_at            TEXT
);
CREATE INDEX IF NOT EXISTS ix_evc_event_time  ON event_contact(event_id, captured_at);
CREATE INDEX IF NOT EXISTS ix_evc_event_phone ON event_contact(event_id, phone_norm);
CREATE INDEX IF NOT EXISTS ix_evc_event_name  ON event_contact(event_id, name_norm, org_norm);
CREATE INDEX IF NOT EXISTS ix_evc_event_email ON event_contact(event_id, email_norm);
CREATE INDEX IF NOT EXISTS ix_evc_captured_by ON event_contact(captured_by, captured_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_evc_capture_key ON event_contact(event_id, capture_key);

CREATE TABLE IF NOT EXISTS event_partner (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES event(id),
  org_name          TEXT NOT NULL,
  org_norm          TEXT NOT NULL,
  partner_kind      TEXT,                       -- شراكة تقنية | تجارية / تسويقية | تنفيذ من الباطن | ...
  contact_name      TEXT,
  phone             TEXT,
  email             TEXT,
  website           TEXT,
  scope_note        TEXT,                       -- فيمَ التعاون
  status            TEXT NOT NULL DEFAULT 'مبدئية',
  next_step         TEXT,
  next_date         TEXT,                       -- سنة-شهر-يوم
  contact_id        TEXT,                       -- بطاقةٌ في الفعالية نفسها إن انبثقت الشراكة منها
  captured_by       TEXT NOT NULL,
  captured_by_name  TEXT,
  captured_at       TEXT NOT NULL,
  updated_at        TEXT,
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS ix_evp_event ON event_partner(event_id, captured_at);

CREATE TABLE IF NOT EXISTS event_blob (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL,
  kind         TEXT NOT NULL,                   -- card: صورة بطاقة
  ref_id       TEXT NOT NULL,                   -- معرّف الصفّ صاحب الصورة
  content      BLOB NOT NULL,
  mime         TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  uploaded_by  TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_evb_ref ON event_blob(kind, ref_id);
CREATE INDEX IF NOT EXISTS ix_evb_event ON event_blob(event_id);
