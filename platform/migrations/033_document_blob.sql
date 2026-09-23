-- 033: بايتات ملفات المستندات داخل قاعدة البيانات (v5.24 — وحدة الفرص).
-- لماذا القاعدة لا نظام الملفات: نظام ملفات حاوية التطبيق يزول مع كل نشرة، فالملف المرفوع
-- على القرص يضيع بصمت. البايتات هنا تعيش مع بقية بيانات المنصة وتدخل في النسخ الاحتياطي.
-- إضافية بحتة: جدول `document` القائم يبقى الميتاداتا القانونية (الاسم/النوع/size_bytes)،
-- وصفّ الرابط الخارجي يبقى بلا صفّ بايتات — التمييز بوجود صفٍّ هنا لا بعمود جديد.
-- التفصيل والتعليل في docs/adr/ADR-0007.

CREATE TABLE IF NOT EXISTS document_blob (
  document_id  TEXT PRIMARY KEY REFERENCES document(id) ON DELETE CASCADE,
  content      BLOB NOT NULL,
  mime         TEXT NOT NULL,
  sha256       TEXT,
  created_at   TEXT NOT NULL
);
