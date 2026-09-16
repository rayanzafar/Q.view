-- ٠٤٦ — لوحات الفرص: المرحلة تُدار من الشاشة، والتصنيف ينفصل عن سير العمل.
--
-- بلسان المالك (٢٠٢٦-٠٩-٠٩): «أريد أن يستطيع الفريق تنظيم الفرص دون الرجوع للمطور» —
-- إنشاءَ مرحلةٍ واسماً ولوناً ووصفاً وترتيباً، وأرشفةً وحذفاً آمناً، ولوحاتٍ إضافية، ووسوماً
-- تُستعمل في الفلاتر والتقارير.
--
-- وكان جدول `stage` قائمةً مبذورة: ستة صفوف بلا وصفٍ ولا أرشفةٍ ولا حذفٍ ناعم، ولا مسارَ
-- كتابةٍ واحد في المنتج كلّه (`POST /opportunities/:id/stage` ينقل فرصةً بين مراحل قائمة،
-- ولا ينشئ مرحلة). أي أن تسميةَ عمودٍ كانت تتطلّب ترحيلةً ومطوِّراً.
--
-- ── الفصل الذي يحكم هذه الترحيلة ───────────────────────────────────────────────────────
-- **المرحلة سير عمل، والوسم تصنيف.** طلبُ المالك حرفياً: «الخدمة أو القطاع أو الأولوية لا
-- تصبح مرحلة بيع لمجرد الحاجة إلى تصنيفها». فالمرحلة تبقى موضعَ الفرصة الواحد في مسارها
-- (عمودٌ واحد على `opportunity.stage_id`، فلا تتكرّر الفرصة في لوحتين)، والوسمُ علاقةُ كثيرٍ
-- إلى كثير لا موضع. ومن أراد تصنيفاً جديداً وسَمَ، ومن أراد خطوةَ بيعٍ جديدة أنشأ مرحلة.
--
-- ── المعنى التشغيلي مربوطٌ بالعَلَم لا بالاسم ───────────────────────────────────────────
-- `is_won` و`is_lost` هما ما تقرؤه التقاريرُ وتوليدُ المشروع من الفوز — لا النصُّ ولا اللون.
-- وهذا كان صحيحاً قبل هذه الترحيلة (فحصناه في كل مستدعٍ)، وتحرسه الآن قاعدةٌ صريحة: مرحلةٌ
-- واحدة فائزة على الأكثر لكل لوحة، وأخرى خاسرة — وتغييرُ الاسم لا يمسّ العَلَم. فمن سمّى
-- «فائزة» باسم «مغلقة رابحة» لم يكسر شيئاً.
--
-- ── الأرشفة والحذف ─────────────────────────────────────────────────────────────────────
-- `archived_at` يُخفي المرحلة من اللوحة ويُبقي فرصها التاريخية مقروءةً في التقارير.
-- و`deleted_at` حذفٌ ناعم لا يقع إلا على مرحلةٍ خلَت من الفرص — والخدمة تنقل فرصها إلى مرحلةٍ
-- تُسمّى صراحةً ثم تحذف، في معاملةٍ واحدة، فلا تبقى فرصةٌ بلا مرحلة ولا تضيع واحدة.

-- ── اللوحة: مسارُ بيعٍ بمراحله ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_board (
  id             TEXT PRIMARY KEY,
  name_ar        TEXT NOT NULL,
  description_ar TEXT,
  -- لوحةٌ افتراضية واحدة تستقبل كل فرصةٍ لم تُنسب إلى لوحة — فلا فرصة بلا لوحة.
  is_default     INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  archived_at    TEXT,
  deleted_at     TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT REFERENCES app_user(id),
  updated_at     TEXT,
  updated_by     TEXT REFERENCES app_user(id)
);

-- ── المرحلة تكتسب ما ينقصها لتُدار ────────────────────────────────────────────────────
ALTER TABLE stage ADD COLUMN board_id TEXT REFERENCES crm_board(id);
ALTER TABLE stage ADD COLUMN description_ar TEXT;
ALTER TABLE stage ADD COLUMN archived_at TEXT;
ALTER TABLE stage ADD COLUMN deleted_at TEXT;
ALTER TABLE stage ADD COLUMN created_at TEXT;
ALTER TABLE stage ADD COLUMN created_by TEXT REFERENCES app_user(id);
ALTER TABLE stage ADD COLUMN updated_at TEXT;
ALTER TABLE stage ADD COLUMN updated_by TEXT REFERENCES app_user(id);

-- ── الوسم: تصنيفٌ لا يزاحم المرحلة ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_tag (
  id          TEXT PRIMARY KEY,
  name_ar     TEXT NOT NULL,
  color       TEXT,
  description_ar TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  deleted_at  TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES app_user(id),
  updated_at  TEXT,
  updated_by  TEXT REFERENCES app_user(id)
);

CREATE TABLE IF NOT EXISTS opportunity_tag (
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  tag_id         TEXT NOT NULL REFERENCES crm_tag(id),
  created_at     TEXT NOT NULL,
  created_by     TEXT REFERENCES app_user(id),
  PRIMARY KEY (opportunity_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_stage_board ON stage(board_id);
CREATE INDEX IF NOT EXISTS idx_opp_tag_tag ON opportunity_tag(tag_id);
CREATE INDEX IF NOT EXISTS idx_crm_tag_live ON crm_tag(deleted_at);

-- ── اللوحة الافتراضية تستوعب المراحل القائمة كما هي ────────────────────────────────────
-- لا تُعاد تسميةُ مرحلةٍ ولا يتغيّر معرّفها ولا عَلَمُها: الست الموجودة تنضمّ إلى لوحةٍ اسمها
-- «مسار البيع» وتبقى هي هي. وأيُّ فرصةٍ قائمة تبقى على مرحلتها بلا مساس.
INSERT INTO crm_board (id, name_ar, description_ar, is_default, sort_order, created_at)
SELECT 'BOARD_SALES', 'مسار البيع', 'المسار الافتراضي لفرص الشركة — من الليد إلى الحسم.', 1, 1, '2026-09-09T00:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM crm_board WHERE id = 'BOARD_SALES');

UPDATE stage SET board_id = 'BOARD_SALES' WHERE board_id IS NULL;
UPDATE stage SET created_at = '2026-09-09T00:00:00.000Z' WHERE created_at IS NULL;
