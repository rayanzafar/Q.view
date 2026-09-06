-- ٠٤٠ — «الاجتماعات» داخل الفعاليات: موعدٌ له رابطٌ يُفتح بضغطة، وحضورٌ يُدعَون بالاسم.
--
-- القرار (٢٠٢٦-٠٨-٣٠، بطلب حسين والفكرة فكرة ريّان): تقويمُ اجتماعاتٍ داخل صفحة الفعالية —
-- أي موظفٍ يُنشئ اجتماعاً ويدعو زملاءه، والكلُّ يرى اجتماعاته أولاً ويقلّب على اجتماعات
-- الفريق، ومن يُدعى وعنده اجتماعٌ آخر في الوقت نفسه يُنبَّه المُنشئ تنبيهاً لا منعاً.
-- وهذا القرار يتجاوز بروتوكول «التنسيق اليدوي» المتفق عليه في ٢٠٢٦-٠٨-٢٩ — تعديلُ
-- ADR-0013 يوثّق ذلك.
--
-- ── عقد الوقت: ساعةُ حائط الرياض لا غير ────────────────────────────────────────────────
-- meeting_date بصيغة سنة-شهر-يوم، وstart_time/end_time بصيغة ساعة:دقيقة (٢٤ ساعة)،
-- وكلها بساعة حائط الرياض (المملكة على +٣ ثابتة بلا توقيت صيفي). المقارنة نصيةٌ خالصة
-- ('09:30' قبل '10:00') ولا دوالَّ تاريخٍ في القاعدة إطلاقاً — فتصحّ على SQLite وPostgres
-- سواء. وهذا عمدٌ مخالفٌ لغموض send_time في جدول تقارير البريد (المكتوب هناك يُقرأ عالمياً
-- UTC بلا تصريح): هنا العقدُ مكتوبٌ والحائطُ حائط الرياض.
--
-- ── لا مفتاح أجنبي إلى المستخدمين (قاعدة الترحيلة ٠٣٨ نفسها) ──────────────────────────
-- user_id في جدول الحضور بلا مفتاح أجنبي، والاسم يُنسخ في user_name عند الدعوة: الحساب
-- قد يُعطَّل بعد المعرض بشهور ويبقى سؤال «من حضر ذلك الاجتماع» يحتاج جواباً يُقرأ بلا ربط.
-- والمفاتيح الأجنبية داخل حدود القسم وحده: الاجتماع إلى فعاليته، والحضور إلى اجتماعه.
--
-- ── حذف الحضور حذفٌ صُلب ──────────────────────────────────────────────────────────────
-- قائمةُ المدعوين ضبطٌ حاليٌّ لا تاريخٌ تجاري (كقرار صور event_blob): من أُزيل أُزيل صفّه،
-- وسجلُّ «من أُضيف ومن أُزيل» محفوظٌ في تفاصيل سجل التدقيق باسم كل واحد.
--
-- ملاحظات تنفيذية مُلزمة (قيد الترحيلات ٠٢٣ و٠٣٦ و٠٣٨):
--   • لا علامة استفهام لاتينية في أي سطر هنا ولا حتى داخل تعليق — وإن لزمت فالعربية «؟».
--   • لا ALTER TABLE إطلاقاً، وكل عبارة IF NOT EXISTS كي تُعاد بلا ضرر.

CREATE TABLE IF NOT EXISTS event_meeting (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL REFERENCES event(id),
  title            TEXT NOT NULL,
  meeting_date     TEXT NOT NULL,     -- سنة-شهر-يوم بساعة حائط الرياض
  start_time       TEXT NOT NULL,     -- ساعة:دقيقة (٢٤ ساعة) بساعة حائط الرياض
  end_time         TEXT NOT NULL,     -- بعد البداية في اليوم نفسه، والمقارنة نصية
  join_url         TEXT,              -- رابط الاجتماع، اختياري — الاجتماع الحضوري بلا رابط
  location         TEXT,
  note             TEXT,
  created_by       TEXT NOT NULL,     -- بلا مفتاح أجنبي عمداً — انظر أعلاه
  created_by_name  TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT,
  deleted_at       TEXT
);
CREATE INDEX IF NOT EXISTS ix_evm_event ON event_meeting(event_id, meeting_date, start_time);
CREATE INDEX IF NOT EXISTS ix_evm_date  ON event_meeting(meeting_date);

CREATE TABLE IF NOT EXISTS event_meeting_attendee (
  id          TEXT PRIMARY KEY,
  meeting_id  TEXT NOT NULL REFERENCES event_meeting(id),
  user_id     TEXT NOT NULL,          -- بلا مفتاح أجنبي عمداً — كقاعدة الترحيلة ٠٣٨
  user_name   TEXT,                   -- الاسم منسوخٌ ليُقرأ بعد تعطيل الحساب
  added_by    TEXT,
  added_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_evma_meeting_user ON event_meeting_attendee(meeting_id, user_id);
CREATE INDEX IF NOT EXISTS ix_evma_user ON event_meeting_attendee(user_id);
