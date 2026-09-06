-- ٠١٧ — أربع حقائق عن المخرَج، لا خانة واحدة تدوسها الفاتورة.
--
-- العيب الذي تعالجه هذه الترحيلة عيبُ نمذجة لا عيبُ شاشة: للمخرَج **خانة حالة واحدة** تحمل
-- ست قيم مختلطة المصدر — أربعٌ يكتبها الإنسان (قيد الإعداد · مُسلَّم · مقبول · مرفوض) واثنتان
-- يكتبهما النظام عند الفوترة والتحصيل (مُفوتر · مدفوع). ولأنها خانة واحدة فإن إصدار المستخلص
-- **يمحو** أثر القبول: سطرٌ واحد في وحدة المالية يكتب `status = 'INVOICED'` فوق `'ACCEPTED'`،
-- فيصير المخرَج المقبول من العميل مخرَجاً لا يُعرف أقُبل أم لا. والتحصيل يمحوها مرة ثانية.
--
-- وأثرُ ذلك ليس تجميلياً: نسبة الإنجاز التنفيذي تُحسب من المقبول، ونسبة الفوترة من المفوتر،
-- ونسبة التحصيل من المحصَّل. وثلاثتها تُقرأ اليوم من خانة واحدة لا تحمل إلا آخرَ ما حدث —
-- فالفوترة تُقرأ إنجازاً، والتحصيل يُقرأ قبولاً، ولا سبيل للتفريق. والقاعدة التي تصحّح هذا:
-- **صرفُ المستخلص أو تحصيله لا يعني أن المخرَج أُنجز أو اعتُمد.** أربع حقائق مستقلة:
--   • أُنجز (سُلِّم) ⇐ يرفع الإنجاز التنفيذي بوزنه.
--   • اعتُمد ⇐ يؤكّد القبول.
--   • فُوتر ⇐ يرفع نسبة الفوترة.
--   • حُصِّل ⇐ يرفع نسبة التحصيل.
-- فتُفصل الأخيرتان إلى ختمين زمنيين مستقلين، وتبقى الخانة لدورة العمل البشرية وحدها.
--
-- والمراحل: المخرَج يحمل منذ اليوم الأول رقمَ مرحلة واسمَها نصاً حراً مكرَّراً على كل صف —
-- فلا تاريخَ للمرحلة ولا حالةَ ولا نسبةَ إنجاز، ولا سبيل لعرض «المراحل والمعالم» أصلاً. تُرقَّى
-- المرحلة إلى كيان له تواريخه، وتُبنى المراحل القائمة من الأرقام المخزَّنة بلا فقد سطر.
--
-- ووزنُ المخرَج: الإنجاز التنفيذي كان عدّاً مجرّداً — مخرَجٌ صغير يساوي مخرَجاً يمثّل نصف
-- العقد. والوزن يُترك فارغاً افتراضاً، وحينها يُشتقّ من القيمة المالية، وإلا فالتساوي.
--
-- وطاقةُ الموظف: نسب التسكين تُجمع اليوم وتُقارن بمئة ثابتة في الكود. والطاقة الحقيقية تختلف
-- (متفرّغ جزئياً، موسمي، مشترك) — فتُسجَّل على الموظف، والفارغ يعني مئة كما كان تماماً.
--
-- ملاحظتان تنفيذيتان مُلزمتان (نفس قيد ٠١٠ و٠١٣ و٠١٤ و٠١٥ و٠١٦):
--   • لا علامة استفهام لاتينية في أي سطر هنا ولا حتى داخل تعليق: الملف كله يمرّ على مُحوِّل
--     العلامات إلى ترقيم دولارات عند التشغيل على Postgres، فأي علامة تُفسد النص.
--   • لا وجود لـADD COLUMN IF NOT EXISTS في SQLite، فالإضافة صريحة بلا شرط، وحمايةُ التكرار
--     تأتي من سجل الترحيلات نفسه (ملف واحد يُطبَّق مرة واحدة).

-- ── المرحلة كياناً: لها تواريخها وحالتها، وتُجمع تحتها المخرجات والمعالم ──
CREATE TABLE IF NOT EXISTS project_phase (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name_ar     TEXT NOT NULL,
  order_no    INTEGER DEFAULT 0,
  start_date  TEXT,
  end_date    TEXT,
  status      TEXT DEFAULT 'NOT_STARTED',   -- NOT_STARTED|IN_PROGRESS|DONE
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_at  TEXT,
  updated_by  TEXT,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS ix_phase_project ON project_phase(project_id);

-- ── المخرَج: الحقائق الأربع مفصولة، والوزن والمسؤول والموعد وختمُ من غيّر الحالة ──
ALTER TABLE deliverable ADD COLUMN phase_id      TEXT REFERENCES project_phase(id);
ALTER TABLE deliverable ADD COLUMN weight        REAL;
ALTER TABLE deliverable ADD COLUMN owner_user_id TEXT REFERENCES app_user(id);
ALTER TABLE deliverable ADD COLUMN due_date      TEXT;
ALTER TABLE deliverable ADD COLUMN invoiced_at   TEXT;
ALTER TABLE deliverable ADD COLUMN collected_at  TEXT;
ALTER TABLE deliverable ADD COLUMN status_by     TEXT REFERENCES app_user(id);
ALTER TABLE deliverable ADD COLUMN status_at     TEXT;

-- ── المعلم: يتبع مرحلته وله مسؤول ──
ALTER TABLE milestone ADD COLUMN phase_id      TEXT REFERENCES project_phase(id);
ALTER TABLE milestone ADD COLUMN owner_user_id TEXT REFERENCES app_user(id);

-- ── الموظف: طاقته الاستيعابية بالنسبة المئوية. الفارغ يعني مئة. ──
ALTER TABLE employee ADD COLUMN capacity_pct REAL;

-- ─────────────────────────── تعبئة ما كان مطموساً ───────────────────────────
-- الترتيب مقصود: تُقرأ الخانة القديمة قبل الكتابة فوقها.
--
-- ١) ختمُ الفوترة والتحصيل. لا تاريخ فوترة محفوظ في الصفوف القائمة (الخانة وحدها كانت تحمل
--    الخبر)، فيُؤخذ آخر تعديل على الصف — وهو لحظة كتابة «مُفوتر» عليه في وحدة المالية.
UPDATE deliverable SET invoiced_at  = COALESCE(updated_at, created_at) WHERE status IN ('INVOICED', 'PAID');
UPDATE deliverable SET collected_at = COALESCE(updated_at, created_at) WHERE status = 'PAID';

-- ٢) استرجاع حالة العمل التي مُحيت. المخرَج لا يُفوتر إلا بعد تسليمه (شرط المستخلص:
--    مُسلَّم أو مقبول)، فالمفوتر مُسلَّمٌ يقيناً؛ ومن له ختمُ قبول محفوظ فهو مقبول.
UPDATE deliverable SET status = CASE WHEN accepted_at IS NOT NULL THEN 'ACCEPTED' ELSE 'DELIVERED' END
 WHERE status IN ('INVOICED', 'PAID');
UPDATE deliverable SET delivered_at = invoiced_at WHERE invoiced_at IS NOT NULL AND delivered_at IS NULL;

-- ٣) تسمية دورة العمل بلغة من يستعملها: «قيد الإعداد» صارت «مسودة»، وبينها وبين التسليم
--    خطوة «جارٍ العمل» لم تكن موجودة — والفرق بينهما هو الفرق بين ما لم يُبدأ وما يُعمل عليه.
UPDATE deliverable SET status = 'DRAFT' WHERE status = 'PENDING' OR status IS NULL;

-- ٤) المراحل من الأرقام المخزَّنة على المخرجات. المعرّف مشتقّ لا عشوائي كي تصحّ إعادة الربط
--    في نفس الترحيلة بلا جدول وسيط.
INSERT INTO project_phase (id, project_id, name_ar, order_no, created_at)
SELECT d.project_id || ':ph' || d.phase,
       d.project_id,
       COALESCE(MIN(d.phase_name_ar), 'المرحلة ' || d.phase),
       MIN(d.phase),
       MIN(d.created_at)
  FROM deliverable d
 WHERE d.phase IS NOT NULL AND d.project_id IS NOT NULL AND d.deleted_at IS NULL
 GROUP BY d.project_id, d.phase;

UPDATE deliverable SET phase_id = project_id || ':ph' || phase
 WHERE phase IS NOT NULL AND project_id IS NOT NULL;

-- ٥) الوزن يبقى فارغاً عمداً: تعبئته بالقيمة المالية هنا تجمّد اشتقاقاً متغيّراً في خانة
--    جامدة — نفس عيب خانة الإيراد على المشروع. الاشتقاق يجري عند القراءة.

CREATE INDEX IF NOT EXISTS ix_deliverable_status ON deliverable(project_id, status);
CREATE INDEX IF NOT EXISTS ix_document_project   ON document(project_id);
CREATE INDEX IF NOT EXISTS ix_milestone_project  ON milestone(project_id);
