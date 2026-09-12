-- ═══ وحدة الفريق والموارد (حزمة سند S01–S25 — 2026-09-05) ═════════════════════════════════════
--
-- «من لدينا؟ ما قدراتهم؟ على ماذا يعملون؟ ما الالتزام المخطط؟ أين توجد طاقة متاحة أو ضغط؟
--  ما الاحتياج القادم؟ كيف توزع التكلفة شهرياً؟ وما الإجراء الإداري المناسب؟» — الموجّه.
--
-- المبدأ في هذه الترحيلة: **ربط مفاهيم الموجّه بالموجود لا استنساخه**. المورد هو `employee`،
-- والتسكين هو `allocation` (شهري — `monthly_json`)، والاعتماد هو `approval_request` الموجَّه
-- بالشخص (022)، والمهمة هي `task` بحِملها (037). ما يُضاف هنا هو ما لا وجود له فعلاً:
-- نوع المورد وطاقته المؤرخة، حالة التسكين (مؤكد/مبدئي) وتصنيفه التجاري، طلبات التسكين
-- بإصدارٍ ومفتاح عدم تكرار، القدرات، الاحتياجات، دورة توزيع التكلفة والإقفال والتصحيح،
-- وحالات المتابعة التحليلية. (السجل التفصيلي: docs/team-resources/EXECUTION-LOG.md §2.)

-- ── المورد: نوعه وجهته وارتباطه ─────────────────────────────────────────────────────────
-- «الموارد الخارجية والشركاء أنواع موارد وليست إدارات افتراضية» (§5.1). النوع نصٌّ قصير:
-- internal · external · partner. والفراغ يُقرأ من `employment_type` القائم (أساسي/موسمي ⇒
-- داخلي، متعاقد ⇒ خارجي) فلا ترحيل صفٍّ واحد. الجهة المتعاقدة للخارجي والشريك، والمرجع
-- الرقمي للارتباط إن وُجد — لا تُخترع أرقام موارد بشرية (S09).
ALTER TABLE employee ADD COLUMN resource_type TEXT;
ALTER TABLE employee ADD COLUMN vendor_name TEXT;
ALTER TABLE employee ADD COLUMN engagement_ref TEXT;

-- ── الطاقة بإصدارات مؤرخة ────────────────────────────────────────────────────────────────
-- «تحفظ بإصدارات مؤرخة، لا تستبدل التاريخ بصمت» (§5). `employee.capacity_pct` يبقى **القيمة
-- السارية** (يقرؤها كل حساب طاقةٍ قائم)، وكل تغييرٍ يكتب صفاً هنا بتاريخ سريانه. الشهر الذي
-- يتغيّر في وسطه يُوزَن بالأيام في نموذج الحساب (capacity-model.js) لا في الجدول.
CREATE TABLE IF NOT EXISTS capacity_version (
  id             TEXT PRIMARY KEY,
  employee_id    TEXT NOT NULL REFERENCES employee(id),
  effective_from TEXT NOT NULL,            -- yyyy-mm-dd
  capacity_pct   REAL NOT NULL,            -- 100 = دوام كامل
  note           TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_capver_emp ON capacity_version(employee_id, effective_from);

-- ── التسكين: مؤكد أم مبدئي، وقابل للفوترة أم لا ─────────────────────────────────────────
-- «التسكين المبدئي لا يخصم من المتاح المؤكد» (§6.1/T02). الفراغ في `status` يعني **مؤكد** —
-- وهو ما عليه كل صفٍّ قائم، فلا يتغيّر رقمٌ واحد في أي شاشة بهذه الترحيلة. و`billable`
-- الفارغ يُشتق: مشروعٌ لعميل قابلٌ للفوترة، وبندٌ داخلي غير قابل — وتُكتب القيمة صراحةً
-- حين يقرّرها المستخدم في طلب التسكين.
ALTER TABLE allocation ADD COLUMN status TEXT;
ALTER TABLE allocation ADD COLUMN billable INTEGER;

-- ── طلب التسكين ────────────────────────────────────────────────────────────────────────────
-- «الطلب المعلق لا يغيّر التسكين المؤكد» (§5). الطلب صفٌّ مستقل يحمل التغيير المقترح كاملاً
-- (المورد، الوجهة، الأشهر ونسبها، النوع، التصنيف)، وبصمةَ التسكين القائم وقت المعاينة
-- (`expected_fingerprint`) فيُرفض الاعتماد إن تغيّرت الخطة منذ فتحها (S16)، ومفتاحَ عدم
-- تكرار يمنع النقر المزدوج من إنشاء حجزين (T19). والاعتماد نفسه يمرّ بمحرّك الاعتماد
-- الموجَّه (022) — الطلب يشير إلى `approval_request` ولا يستنسخ صندوق وارد ثانياً.
CREATE TABLE IF NOT EXISTS allocation_request (
  id                   TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL,           -- new | adjust | remove
  employee_id          TEXT NOT NULL REFERENCES employee(id),
  target_kind          TEXT NOT NULL,           -- project | bucket
  target_id            TEXT NOT NULL,           -- project.id أو مفتاح البند (bd/product/pmo)
  allocation_id        TEXT REFERENCES allocation(id),   -- للتعديل/الإزالة: السجل المعدَّل
  year                 INTEGER NOT NULL,
  months_json          TEXT NOT NULL,           -- {"10":20,"11":20} نسبٌ من طاقة المورد
  alloc_status         TEXT NOT NULL DEFAULT 'confirmed', -- نوع التسكين المطلوب: confirmed | tentative
  billable             INTEGER,
  status               TEXT NOT NULL DEFAULT 'draft',    -- draft|pending|approved|returned|rejected|withdrawn|applied
  reason               TEXT,
  note                 TEXT,
  expected_fingerprint TEXT,
  idempotency_key      TEXT,
  need_id              TEXT,
  sector_id            TEXT,
  department_id        TEXT,
  requested_by         TEXT NOT NULL,
  reviewer_user_id     TEXT,
  approval_request_id  TEXT,
  decided_by           TEXT,
  decided_at           TEXT,
  decision_note        TEXT,
  applied_allocation_id TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT,
  deleted_at           TEXT
);
CREATE INDEX IF NOT EXISTS ix_allocreq_emp ON allocation_request(employee_id, status);
CREATE INDEX IF NOT EXISTS ix_allocreq_status ON allocation_request(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_allocreq_idem ON allocation_request(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ── القدرات والخبرات وأهداف التطوير ──────────────────────────────────────────────────────
-- جدولٌ واحد بثلاثة أنواع لا ثلاثة جداول: المهارة (بمستوى وشاهد ومراجعة)، والخبرة السابقة
-- (بفترة)، وهدف التطوير (بموعد وحالة). «التقييم الذاتي يميّز عن المهارة التي تمت مراجعتها»
-- (§5): المراجَعة ما حملت `reviewed_by`. الشاهد مرجعٌ إلى سجلٍّ أصلي (مشروع/بند/مستند) أو
-- وصفٌ حرّ — ولا تُنسخ الملفات هنا: المرفقات في `document` (ADR-0007) بصلاحياتها.
CREATE TABLE IF NOT EXISTS resource_capability (
  id             TEXT PRIMARY KEY,
  employee_id    TEXT NOT NULL REFERENCES employee(id),
  kind           TEXT NOT NULL,           -- skill | experience | goal
  name_ar        TEXT NOT NULL,
  level          TEXT,                    -- للمهارة: beginner|practitioner|advanced|expert · للهدف: حالته
  evidence_kind  TEXT,                    -- project | bucket | document | note
  evidence_ref   TEXT,
  evidence_label TEXT,
  period_from    TEXT,                    -- للخبرة
  period_to      TEXT,
  target_date    TEXT,                    -- للهدف
  status         TEXT,                    -- للهدف: planned | in_progress | done
  source         TEXT,                    -- self | manager
  reviewed_by    TEXT,
  reviewed_at    TEXT,
  note           TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_rescap_emp ON resource_capability(employee_id, kind);

-- ── الاحتياج ─────────────────────────────────────────────────────────────────────────────
-- «تسجيل الاحتياج لا يعني تغطيته» (§5). المصدر سجلٌّ أصلي (مشروع/بند/فرصة)، والحجم بوحدة
-- واضحة: عددٌ × نسبة طاقة (FTE) طوال الفترة. اليقين (مبدئي/مؤكد) منفصل عن حالة التغطية.
CREATE TABLE IF NOT EXISTS resource_need (
  id             TEXT PRIMARY KEY,
  source_kind    TEXT NOT NULL,           -- project | bucket | opportunity
  source_id      TEXT NOT NULL,
  sector_id      TEXT,
  department_id  TEXT,
  owner_user_id  TEXT NOT NULL,
  role_ar        TEXT NOT NULL,
  skills_json    TEXT,                    -- {"required":["SQL"],"preferred":["نمذجة البيانات"]}
  level          TEXT,
  headcount      INTEGER NOT NULL DEFAULT 1,
  fte_pct        INTEGER NOT NULL DEFAULT 100, -- طاقة كل مورد مطلوبة (100 = دوام كامل)
  from_date      TEXT NOT NULL,
  to_date        TEXT NOT NULL,
  decide_by      TEXT,
  certainty      TEXT NOT NULL DEFAULT 'confirmed', -- tentative | confirmed
  status         TEXT NOT NULL DEFAULT 'open',      -- draft|open|shortlisting|partial|covered|cancelled
  splittable     INTEGER NOT NULL DEFAULT 0,
  goal           TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_need_source ON resource_need(source_kind, source_id);
CREATE INDEX IF NOT EXISTS ix_need_status ON resource_need(status, from_date);

-- ── دورة توزيع التكلفة والإقفال ──────────────────────────────────────────────────────────
-- «الإصدار المقفل ثابت وقابل للتتبع» (§5). الفترة = قطاع × شهر، ولها إصدارٌ يبدأ من 1؛
-- الإقفال يجمّد لقطة الأسطر في `locked_snapshot_json` ولا يُعدَّل صفٌّ مقفل بعدها — التصحيح
-- ينشئ إصداراً جديداً بنفس القطاع والشهر ويشير إلى سابقه. حالة الترحيل للنظام المالي عمودٌ
-- مستقل («لم يتم» دائماً في هذه النسخة — لا تكامل خارجي، T36).
CREATE TABLE IF NOT EXISTS cost_period (
  id                   TEXT PRIMARY KEY,
  sector_id            TEXT NOT NULL REFERENCES sector(id),
  year                 INTEGER NOT NULL,
  month                INTEGER NOT NULL,
  version              INTEGER NOT NULL DEFAULT 1,
  status               TEXT NOT NULL DEFAULT 'draft',   -- draft|manager_review|finance_review|locked|superseded
  supersedes_id        TEXT,
  draft_generated_at   TEXT,
  manager_confirmed_by TEXT,
  manager_confirmed_at TEXT,
  finance_note         TEXT,
  finance_locked_by    TEXT,
  finance_locked_at    TEXT,
  locked_snapshot_json TEXT,
  transfer_status      TEXT NOT NULL DEFAULT 'not_transferred',
  created_by           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_costperiod_ver ON cost_period(sector_id, year, month, version);

-- سطر التوزيع: نسبةٌ **بنقاط أساس** (10000 = 100%) — «استخدم decimal أو basis points، لا تحقق
-- مساواة عائم هش» (§9.3). جهة التحميل مشروعٌ بكوده المالي أو قطاعٌ بمركز تكلفته.
CREATE TABLE IF NOT EXISTS cost_share (
  id            TEXT PRIMARY KEY,
  period_id     TEXT NOT NULL REFERENCES cost_period(id),
  employee_id   TEXT NOT NULL REFERENCES employee(id),
  target_kind   TEXT NOT NULL,            -- project | sector
  target_id     TEXT NOT NULL,
  fin_code      TEXT,                     -- الكود المالي وقت التوزيع (لقطة)
  share_bp      INTEGER NOT NULL,         -- نقاط أساس
  basis         TEXT NOT NULL DEFAULT 'allocation', -- allocation | manager | correction
  review_status TEXT NOT NULL DEFAULT 'draft',       -- draft | confirmed
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS ix_costshare_period ON cost_share(period_id, employee_id);

-- طلب التصحيح بعد الإقفال: يشير إلى الإصدار المرجعي، ويحمل القديم (من اللقطة) والمقترح
-- والسبب والشاهد. اعتماده ينشئ إصداراً جديداً ويبقي السابق محفوظاً (S25/T33).
CREATE TABLE IF NOT EXISTS cost_correction (
  id               TEXT PRIMARY KEY,
  period_id        TEXT NOT NULL REFERENCES cost_period(id),
  employee_id      TEXT NOT NULL REFERENCES employee(id),
  proposed_json    TEXT NOT NULL,         -- [{target_kind,target_id,fin_code,share_bp}]
  reason           TEXT NOT NULL,
  evidence_label   TEXT,
  status           TEXT NOT NULL DEFAULT 'draft',  -- draft|pending|approved|rejected
  requested_by     TEXT NOT NULL,
  decided_by       TEXT,
  decided_at       TEXT,
  decision_note    TEXT,
  result_period_id TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS ix_costcorr_period ON cost_correction(period_id, status);

-- مركز تكلفة القطاع للتحميل (§9.1). فارغه يُقرأ معرّف القطاع نفسه رمزاً — وهو رمزٌ حقيقي في
-- المنصة لا مخترَع — حتى تسمّي المالية غيره.
ALTER TABLE sector ADD COLUMN cost_center TEXT;

-- ── حالة المتابعة التحليلية ─────────────────────────────────────────────────────────────
-- «امنع تكاثر التنبيه نفسه عند كل تحديث؛ اربطه بسبب وفترة ومورد وحالة معالجة» (§7.2).
-- الحالة = مورد × شهر × نوع إشارة، وفريدة بهذا المفتاح. والمتابعة نفسها مهمة حقيقية في
-- نظام المهام القائم (`task_id`) — لا نظام إجراءات ثانٍ.
CREATE TABLE IF NOT EXISTS analysis_case (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employee(id),
  year          INTEGER NOT NULL,
  month         INTEGER NOT NULL,
  signal        TEXT NOT NULL,            -- مفتاح الإشارة (analysis.js SIGNALS)
  status        TEXT NOT NULL DEFAULT 'open', -- open | explained | closed
  evidence_json TEXT,
  task_id       TEXT,
  owner_user_id TEXT,
  due_date      TEXT,
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_analysis_case ON analysis_case(employee_id, year, month, signal);
