-- ٠٢٠ — الإيراد يتبع التسليم لا الفاتورة
--
-- قرار المالك حرفاً: «دائماً لما الواحد يحطّ تمّ إنجاز المخرج أو البروسيس في المشاريع، هو خلاص
-- يتحوّل كأنه حقّق إيراداً — مو لازم إثبات الفواتير ولا أي شيء من المالية، لأنه حالياً ما رح
-- أخلّي المالية يستعملوا المنصة».
--
-- الخدمة (finance/recognition.js) تكتب سطر الإيراد لحظة تغيّر حالة المخرَج من اليوم فصاعداً.
-- وهذه الترحيلة تُلحق **ما مضى**: ٢٥٩ مخرَجاً مسلَّماً كانت قائمةً قبل القاعدة، لا سطر إيراد
-- لواحدٍ منها. وبلا هذه اللحقة تكون القاعدة صحيحةً للمستقبل وحده، ويبقى إيراد سنتين كاملتين
-- خارج المنصة إلى أن يفتح أحدٌ كل مخرَجٍ ويحفظه بلا تغيير — وهو عملٌ لن يقع.
--
-- ── المعرّف مشتقٌّ لا مولَّد ─────────────────────────────────────────────────────────────────
-- 'rl_dlv_' || d.id هو نفس اشتقاق الخدمة حرفاً. فلو أُعيد تشغيل هذه الترحيلة، أو كتبت الخدمة
-- السطر قبلها، لم يتضاعف شيء: الشرط NOT EXISTS يقرأ المفتاح نفسه الذي ستكتبه الخدمة.
--
-- ── الضريبة ─────────────────────────────────────────────────────────────────────────────────
-- مبلغ المخرَج شاملٌ الضريبة كقيمة العقد (مجموع مخرجات أي مشروع يساوي قيمة عقده). فالصافي
-- ⌊إجمالي × ١٠٠ ÷ ١١٥⌋ والضريبة الفارق — نفس ترتيب ٠١٩ حرفاً بحرف، فلا يختلف رقمٌ باختلاف
-- الطريق الذي وصل منه. وCAST إلى BIGINT لا INTEGER: على Postgres تفيض الأربع بايتات بالضرب في مئة.
--
-- ── الشهر ───────────────────────────────────────────────────────────────────────────────────
-- شهر استحقاق المخرَج إن حُدِّد، وإلا شهر الحدث: القبول ثم التسليم ثم آخر تغيير حالة ثم الإنشاء.
-- ولا strftime ولا date('now') — القراءة بـ substr وحدها كي تعمل على المحرّكَين معاً.

INSERT INTO revenue_line (
  id, project_id, sector_id, deliverable_id,
  amount_halalas, net_amount_halalas, vat_halalas,
  month, year, label, auto, rule_id, created_at
)
SELECT
  'rl_dlv_' || d.id,
  d.project_id,
  COALESCE(d.sector_id, p.sector_id),
  d.id,
  d.amount_halalas,
  CAST(d.amount_halalas AS BIGINT) * 100 / 115,
  d.amount_halalas - (CAST(d.amount_halalas AS BIGINT) * 100 / 115),
  COALESCE(d.month, CAST(substr(COALESCE(d.accepted_at, d.delivered_at, d.status_at, d.created_at), 6, 2) AS INTEGER)),
  COALESCE(d.year,  CAST(substr(COALESCE(d.accepted_at, d.delivered_at, d.status_at, d.created_at), 1, 4) AS INTEGER)),
  d.name_ar,
  1,
  'deliverable_delivered',
  COALESCE(d.accepted_at, d.delivered_at, d.status_at, d.created_at)
FROM deliverable d
JOIN project p ON p.id = d.project_id
WHERE d.deleted_at IS NULL
  AND d.status IN ('DELIVERED', 'ACCEPTED')
  AND COALESCE(d.amount_halalas, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM revenue_line r WHERE r.id = 'rl_dlv_' || d.id)
  AND NOT EXISTS (SELECT 1 FROM revenue_line r WHERE r.deliverable_id = d.id);

-- ── الأسطر التي كانت تنوب عن التسليم ────────────────────────────────────────────────────────
-- قبل هذه القاعدة كان الإيراد يُسجَّل من الفواتير: سطرٌ لكل فاتورة، بلا مخرَجٍ خلفه. وبقاؤها مع
-- الأسطر الجديدة يحتسب العمل **مرتين** — مرةً بتسليمه ومرةً بفاتورته — فينتفخ إيراد الشركة بلا
-- عمل. والصحيح أن تُرفع، لا أن تُجمع: الفاتورة نفسها باقيةٌ في جدولها لم تُمسّ، وهي المستند؛ وسطرُ
-- الإيراد المشتقّ منها كان نسخةً عنها لا أصلاً.
--
-- والرفع مشروطٌ بمشروعه: لا يُرفع سطرٌ إلا من مشروعٍ صار له إيرادٌ من مخرجاته فعلاً. فمشروعٌ بلا
-- مخرجات مسلَّمة يبقى إيراده المسجَّل كما هو — وإلا لأسقطنا إيراده إلى صفرٍ بلا بديل.
--
-- ونسخةٌ منها تُحفظ في سجل التدقيق قبل الرفع: الرقم يخرج من الحساب ولا يخرج من الذاكرة.
-- والتفصيل يُكتب JSON صالحاً لأن قارئه يفكّه: نصٌّ حرّ هنا يُسقط السطر عند العرض.
INSERT INTO audit_log (id, at, user_id, username, action, resource, resource_id, sector_id, detail_json)
SELECT
  'aud_sup_' || r.id,
  COALESCE(r.created_at, '2026-08-01T00:00:00.000Z'),
  NULL, 'migration_020', 'delete', 'revenue_line', r.id, r.sector_id,
  '{"سبب":"سطر إيراد مشتقّ من فاتورة رُفع لأن إيراد مشروعه صار يُحتسب من تسليم مخرجاته",'
    || '"المبلغ_هللة":' || CAST(COALESCE(r.amount_halalas, 0) AS TEXT)
    || ',"المشروع":"' || COALESCE(r.project_id, '') || '"}'
FROM revenue_line r
WHERE r.deliverable_id IS NULL
  AND r.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM revenue_line x WHERE x.project_id = r.project_id AND x.rule_id = 'deliverable_delivered');

DELETE FROM revenue_line
WHERE deliverable_id IS NULL
  AND project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM revenue_line x WHERE x.project_id = revenue_line.project_id AND x.rule_id = 'deliverable_delivered');
