-- من أسندها ومن اعتمدها — أثر القرار يُكتب على المهمة لحظة اتخاذه لا يُستنتج لاحقاً
--
-- «يجب أن يظهر لمن يفتح مهمته من كتبها له، ومن اعتمدها إن كانت ممّا ينتظر اعتماد
--  مدير» — بلسان المالك. فمن وجد مهمةً في قائمته يقرأ من أين جاءت بلا سؤال.
--
-- ── لماذا عمودان على المهمة لا قراءةٌ من سجلّ الاعتمادات ──────────────────────
-- المسوّي (`settleTask`) يعيد `approval_state` فارغاً لحظة الاعتماد (٠٢٨)، فلا يبقى على
-- الصف أثرٌ أنه اعتُمد أصلاً ولا مَن اعتمده. والهوية محفوظة في سجلّ إجراءات الاعتماد —
-- لكن ذلك السجلّ شأن المحرّك لا شأن قارئ القوائم: قراءته من كل قائمة مهام استعلامٌ
-- مرتبطٌ في كل صفٍّ بلا فهرسٍ يخدمه. فالقرار يُكتب حيث يُتَّخذ — في نفس معاملة
-- الاعتماد — ويبقى السجلّ مرجعَ التدقيق الكامل كما كان.
--
-- ── والفراغ هو الأصل ─────────────────────────────────────────────────────────
-- مهمةٌ لم تحتج اعتماداً (عملٌ داخلي، أو كاتبُها يملك أمر عمله) عموداها فارغان،
-- وهذا معناهما الصحيح لا نقصٌ فيهما: لا معتمِد لِما لم يُعتمَد.
ALTER TABLE task ADD COLUMN approved_by TEXT;
ALTER TABLE task ADD COLUMN approved_at TEXT;

-- ── استدراكُ المكتوب: ما اعتُمد بين ٠٢٨ وهذه الترحيلة قرارُه مسجَّل في سجلّ الاعتمادات ──
-- (نمط ٠٢٩: تصحيحُ بياناتٍ قائمة داخل الترحيلة، بشرطٍ يستهدف الصفوف المعنيّة وحدها.)
-- يُؤخذ آخرُ اعتمادٍ إن تعدّدت الطلبات على المهمة الواحدة، من طلبٍ أُغلق اعتماداً لا ردّاً.
UPDATE task SET
  approved_by = (SELECT aa.actor_user_id FROM approval_action aa
                   JOIN approval_request ar ON ar.id = aa.request_id
                  WHERE ar.resource = 'task' AND ar.resource_id = task.id
                    AND aa.action = 'approve' AND ar.status = 'APPROVED'
                  ORDER BY aa.acted_at DESC LIMIT 1),
  approved_at = (SELECT aa.acted_at FROM approval_action aa
                   JOIN approval_request ar ON ar.id = aa.request_id
                  WHERE ar.resource = 'task' AND ar.resource_id = task.id
                    AND aa.action = 'approve' AND ar.status = 'APPROVED'
                  ORDER BY aa.acted_at DESC LIMIT 1)
WHERE deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM approval_action aa
                JOIN approval_request ar ON ar.id = aa.request_id
               WHERE ar.resource = 'task' AND ar.resource_id = task.id
                 AND aa.action = 'approve' AND ar.status = 'APPROVED');
