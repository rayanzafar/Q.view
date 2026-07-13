-- المستخلصات (Progress Claims) — فواتير مرحلية على العقود بحسب المخرجات المنجزة.
-- نوسّع جدول invoice بحقول المستخلص، وننشئ جدول ربط المستخلص بالمخرجات.
ALTER TABLE invoice ADD COLUMN kind TEXT DEFAULT 'standard';       -- standard | progress_claim
ALTER TABLE invoice ADD COLUMN claim_no TEXT;                      -- رقم المستخلص التسلسلي على العقد
ALTER TABLE invoice ADD COLUMN period_label TEXT;                  -- الفترة (مثل يونيو 2026)
ALTER TABLE invoice ADD COLUMN progress_pct REAL;                  -- نسبة الإنجاز التراكمية عند إصدار المستخلص
ALTER TABLE invoice ADD COLUMN owner_user_id TEXT;                 -- مدير المشروع المسؤول (لتجميع per-PM)
ALTER TABLE invoice ADD COLUMN retention_halalas INTEGER DEFAULT 0; -- المحتجز (ضمان) إن وُجد

CREATE TABLE IF NOT EXISTS invoice_line (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
  deliverable_id TEXT REFERENCES deliverable(id),
  label          TEXT,
  amount_halalas INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_invline_invoice ON invoice_line(invoice_id);
CREATE INDEX IF NOT EXISTS ix_invoice_owner ON invoice(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_invoice_contract ON invoice(contract_id);
