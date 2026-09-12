-- ٠٤٥ — «مركز التطوير»: دورة حياة المنتج، واستقبال الأعطال والاقتراحات، والاعتماد، والمهمة.
--
-- بلسان المالك (٢٠٢٦-٠٩-٠٨): البلاغ والاقتراح يدخلان سنداً نفسه لا نموذجاً خارجياً وجدولَ
-- أرقام: يُكتب في القاعدة، ويمرّ بدراسة المطوِّر ثم اعتماد مدير المنتج، فتُولد له مهمةٌ
-- حقيقية في المهام، وصورةٌ قبل وبعد، وبريدٌ في كل خطوة، وتقريرٌ يُطبع بمدىً زمني.
--
-- ── منتجٌ واحدٌ داخلي، ومنتجاتٌ تُباع ────────────────────────────────────────────────────
-- «سند» منتجٌ داخلي (kind = internal): بلا جهاتٍ ولا روابط استقبال، وبنودُه تأتي من نموذج
-- المنصة وحده. والمنتج المُباع خارجي: له جهاتٌ (عميلٌ لكل جهة) ورابطُ استقبالٍ دائم لكل جهة
-- يفتحه صاحب البلاغ بلا حساب.
--
-- ── العضوية جدولٌ لا دور شركة ──────────────────────────────────────────────────────────
-- `product_member` هو مصدرُ «من يرى هذا المنتج»: مطوِّرٌ يدرس ويصلح، ومديرُ منتجٍ يملك ما
-- يملكه المطوِّر ويزيد الاعتماد. ولا دور جديد في مصفوفة الشركة: الترقيةُ على منتجٍ بعينه لا
-- على المنصة كلها، ومديرُ النظام يرى الجميع بحكم منحه العام.
--
-- ── مفاتيح البنود تُقرأ وتُنطق ─────────────────────────────────────────────────────────
-- لكل بندٍ رقمٌ متسلسل داخل منتجه (`item_no`) ومفتاحٌ يُقرأ منه (`item_key` مثل SND-042).
-- والتسلسل يُحجز من `product.item_seq` داخل المعاملة، والفهرس الفريد على (المنتج، الرقم)
-- يحرس ذلك بنيةً لا بعادة.
--
-- ملاحظات تنفيذية مُلزمة (قيد الترحيلتين ٠٢٣ و٠٣٦ و٠٣٨):
--   • لا علامة استفهام لاتينية في أي سطر هنا ولا حتى داخل تعليق: الملف كله يمرّ على مُحوِّل
--     العلامات إلى ترقيم دولارات عند التشغيل على Postgres. وإن لزمت فالعلامة العربية «؟».
--   • لا ALTER TABLE إطلاقاً، وكل عبارة IF NOT EXISTS كي تُعاد بلا ضرر.
--   • الأنواع INTEGER وBLOB كما تُكتب لـSQLite، وscripts/migrate.js يحوّلها لـPostgres.
--   • الأوقات نصوصٌ بصيغة عالمية، والمنطقيات أعدادٌ صفر أو واحد.

CREATE TABLE IF NOT EXISTS product (
  id             TEXT PRIMARY KEY,           -- prd_…
  key            TEXT NOT NULL UNIQUE,       -- مفتاحٌ قصير يُكتب في السكربتات: sanad
  name_ar        TEXT NOT NULL,
  name_en        TEXT,
  description    TEXT,
  kind           TEXT NOT NULL,              -- internal داخلي | external يُباع لجهات
  project_id     TEXT,                       -- مشروعُ التطوير الافتراضي لمهام هذا المنتج
  item_prefix    TEXT NOT NULL,              -- بادئة مفاتيح البنود: SND
  item_seq       INTEGER NOT NULL DEFAULT 0, -- آخر رقمٍ حُجز — يُبَمَّب داخل المعاملة
  brand_color    TEXT,                       -- لونٌ ست عشري يُلوَّن به إطار الرابط العام
  brand_blob_id  TEXT,                       -- شعارُ المنتج: صفٌّ في product_item_image نوعه logo
  archived_at    TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  updated_at     TEXT,
  updated_by     TEXT
);

CREATE TABLE IF NOT EXISTS product_member (
  id          TEXT PRIMARY KEY,              -- pmb_…
  product_id  TEXT NOT NULL REFERENCES product(id),
  user_id     TEXT NOT NULL REFERENCES app_user(id),
  role        TEXT NOT NULL,                 -- developer مطوِّر | manager مدير المنتج
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_at  TEXT,
  updated_by  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_member_pair ON product_member(product_id, user_id);
CREATE INDEX IF NOT EXISTS ix_product_member_user ON product_member(user_id);

CREATE TABLE IF NOT EXISTS product_tenant (
  id          TEXT PRIMARY KEY,              -- ptn_…
  product_id  TEXT NOT NULL REFERENCES product(id),
  name        TEXT NOT NULL,                 -- اسم الجهة كما تُعرض
  client_id   TEXT,                          -- عميلٌ من السجل إن كانت جهةً مسجَّلة
  project_id  TEXT,                          -- مشروعُ هذه الجهة إن اختلف عن مشروع المنتج
  internal    INTEGER NOT NULL DEFAULT 0,    -- استخدامٌ داخلي داخل الشركة
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_at  TEXT,
  updated_by  TEXT
);
CREATE INDEX IF NOT EXISTS ix_product_tenant_product ON product_tenant(product_id);

CREATE TABLE IF NOT EXISTS product_link (
  id             TEXT PRIMARY KEY,           -- plk_…
  product_id     TEXT NOT NULL REFERENCES product(id),
  tenant_id      TEXT REFERENCES product_tenant(id),
  token          TEXT NOT NULL UNIQUE,       -- مئةٌ وثمانية وعشرون بتاً عشوائية في العنوان
  identity_mode  TEXT NOT NULL,              -- anonymous_only | optional | required
  default_lang   TEXT NOT NULL DEFAULT 'ar', -- ar | en
  intro_ar       TEXT,
  intro_en       TEXT,
  expires_on     TEXT,                       -- سنة-شهر-يوم، فارغٌ يعني بلا انتهاء
  enabled        INTEGER NOT NULL DEFAULT 1,
  visits         INTEGER NOT NULL DEFAULT 0,
  submissions    INTEGER NOT NULL DEFAULT 0,
  last_submit_at TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  updated_at     TEXT,
  updated_by     TEXT
);
CREATE INDEX IF NOT EXISTS ix_product_link_token ON product_link(token);
CREATE INDEX IF NOT EXISTS ix_product_link_product ON product_link(product_id);

CREATE TABLE IF NOT EXISTS product_version (
  id          TEXT PRIMARY KEY,              -- pvr_…
  product_id  TEXT NOT NULL REFERENCES product(id),
  label       TEXT NOT NULL,                 -- وسم الإصدار كما يكتبه الفريق
  released_on TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT
);
CREATE INDEX IF NOT EXISTS ix_product_version_product ON product_version(product_id, released_on);

CREATE TABLE IF NOT EXISTS product_item (
  id                         TEXT PRIMARY KEY,   -- pit_…
  product_id                 TEXT NOT NULL REFERENCES product(id),
  item_no                    INTEGER NOT NULL,   -- تسلسلٌ داخل المنتج
  item_key                   TEXT NOT NULL,      -- SND-042
  tenant_id                  TEXT REFERENCES product_tenant(id),
  link_id                    TEXT REFERENCES product_link(id),
  source                     TEXT NOT NULL,      -- sanad | link | manual | agent
  lang                       TEXT NOT NULL DEFAULT 'ar',
  type                       TEXT NOT NULL,      -- bug عُطل | suggestion اقتراح
  title                      TEXT NOT NULL,
  description                TEXT,
  where_text                 TEXT,               -- أين حدث: عنوان الشاشة أو وصفُ الموضع
  urgency                    TEXT,               -- blocks | delays | improve
  status                     TEXT NOT NULL,      -- انظر labels.js — تسع حالات
  status_before_info         TEXT,               -- ما كانت عليه قبل «بحاجة لتوضيح»
  priority                   TEXT,               -- تقدير المطوِّر: low | medium | high | critical
  size                       TEXT,               -- S | M | L
  est_hours                  REAL,               -- ساعاتٌ مقدَّرة تُنسخ إلى المهمة عند الاعتماد
  dev_description            TEXT,
  reporter_user_id           TEXT,
  reporter_name              TEXT,
  reporter_email             TEXT,
  reporter_phone             TEXT,
  reporter_ip_hash           TEXT,               -- بصمةٌ لا عنوان: المجهول يبقى مجهولاً
  reporter_note              TEXT,
  sector_id                  TEXT,
  department_id              TEXT,
  tracking_token             TEXT,               -- صفحة المتابعة لصاحب البلاغ الخارجي
  assignee_user_id           TEXT,
  decline_reason             TEXT,
  duplicate_of_id            TEXT,               -- بندٌ أسبق من المنتج نفسه
  resolved_version_id        TEXT,
  triaged_at                 TEXT,
  submitted_for_approval_at  TEXT,
  approved_at                TEXT,
  declined_at                TEXT,
  started_at                 TEXT,
  resolved_at                TEXT,
  created_at                 TEXT NOT NULL,
  created_by                 TEXT,
  updated_at                 TEXT,
  updated_by                 TEXT,
  deleted_at                 TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_item_no ON product_item(product_id, item_no);
CREATE INDEX IF NOT EXISTS ix_product_item_board ON product_item(product_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_product_item_tenant ON product_item(tenant_id);
CREATE INDEX IF NOT EXISTS ix_product_item_sector ON product_item(sector_id);
CREATE INDEX IF NOT EXISTS ix_product_item_duplicate ON product_item(duplicate_of_id);
CREATE INDEX IF NOT EXISTS ix_product_item_tracking ON product_item(tracking_token);

-- بايتات الصور داخل القاعدة كقرار الترحيلتين ٠٣٣ و٠٣٨: قرص الحاوية يزول مع كل نشرة.
-- ولا يُقرأ هذا الجدول بنجمةٍ أبداً — عمود المحتوى يُطلب وحده في مسار الإرسال.
CREATE TABLE IF NOT EXISTS product_item_image (
  id          TEXT PRIMARY KEY,              -- pim_…
  item_id     TEXT REFERENCES product_item(id),
  product_id  TEXT REFERENCES product(id),   -- شعارُ المنتج يسكن هنا بلا بند
  kind        TEXT NOT NULL,                 -- report بلاغ | before قبل | after بعد | logo شعار
  caption     TEXT,
  content     BLOB NOT NULL,
  mime        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  created_by  TEXT
);
CREATE INDEX IF NOT EXISTS ix_product_item_image_item ON product_item_image(item_id, kind);

CREATE TABLE IF NOT EXISTS product_item_comment (
  id              TEXT PRIMARY KEY,          -- pic_…
  item_id         TEXT NOT NULL REFERENCES product_item(id),
  visibility      TEXT NOT NULL,             -- internal بين الفريق | reporter يقرؤها المُبلِّغ
  body            TEXT NOT NULL,
  author_user_id  TEXT,
  author_label    TEXT,                      -- الاسم كما يُعرض، ومعه اسم المساعد إن كتب عبره
  mentions_json   TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_product_item_comment_item ON product_item_comment(item_id, created_at);

CREATE TABLE IF NOT EXISTS product_item_event (
  id              TEXT PRIMARY KEY,          -- pie_…
  item_id         TEXT NOT NULL REFERENCES product_item(id),
  kind            TEXT NOT NULL,             -- created | status | triage | comment | image | task
  from_status     TEXT,
  to_status       TEXT,
  actor_user_id   TEXT,
  actor_label     TEXT,
  detail_json     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_product_item_event_item ON product_item_event(item_id, created_at);

-- الجسرُ بين البند ومهمته: صفٌّ واحدٌ لكل مهمة (فهرسٌ فريد)، وفكُّ الربط حالةٌ لا حذف.
CREATE TABLE IF NOT EXISTS product_item_task (
  id          TEXT PRIMARY KEY,              -- pitk_…
  item_id     TEXT NOT NULL REFERENCES product_item(id),
  task_id     TEXT NOT NULL UNIQUE REFERENCES task(id),
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  unlinked_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_product_item_task_item ON product_item_task(item_id);
