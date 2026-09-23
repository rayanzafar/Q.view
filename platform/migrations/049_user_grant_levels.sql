-- ٠٤٩ — المنح الشخصي على مستوى القطاع والشركة، وبمدةٍ، وفي حِزم
--
-- بلسان المالك (١٥ سبتمبر ٢٠٢٦): «داخل صفحة الموظف يحتاج يكون في خانة عند المدير إذا يبغى يغيّر
-- الصلاحيات… مثلاً سجى أبغى أعطيها صلاحية تضيف فرص لأنها شغالة في تطوير الأعمال لقطاع الابتكار…
-- كيف ممكن ندير الصلاحيات والفيتشرز لكل موظف بطريقة سهلة». والقرار: «مدير الإدارة يمديه يمنح ومدير
-- القطاع والأدمن حسب الصلاحية عند كل واحد» — على الإدارة أو على القطاع كله، وبمدةٍ إن أُريد.
--
-- ── الجدول نفسه لا جدولٌ جديد ────────────────────────────────────────────────────────────
-- جدول ٠٢٥ كان يشترط إدارةً في كل صف (department_id NOT NULL)، والمنحُ على قطاعٍ كامل صفٌّ بلا
-- إدارة. والقيدُ لا يُرفع بتعديل عمود على SQLite، فيُعاد بناء الجدول بالاسم نفسه: نسخةٌ بالأعمدة
-- الجديدة، وتُنقل الصفوف كلها (الحيّة والمرفوعة — الأثر يبقى)، ثم يحلّ الجديد محلّ القديم.
-- الاسم يبقى لأن الشيفرة والاختبارات وسجل التدقيق تعرفه، والمعرّفات تبقى كما هي.
--
-- الأعمدة الجديدة:
--   level         department | sector | company — والصفوف القديمة «department» كلها
--   sector_id     قطاعُ الصف: للمستوى «قطاع» هو الهدف، وللمستوى «إدارة» يُنسخ من الإدارة للقراءة
--   expires_at    آخر يومٍ يسري فيه المنح (سنة-شهر-يوم) أو فارغ = بلا مدة
--   bundle_key    الحزمة التي أنشأت الصف (تطوير الأعمال، إدارة المشاريع، …) أو فارغ لصفٍّ مفرد
--   bundle_id     الصفوف التي مُنحت معاً تحمل معرّفاً واحداً فتُرفع معاً بنقرة
CREATE TABLE IF NOT EXISTS user_department_grant_v2 (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES app_user(id),
  resource       TEXT NOT NULL,
  action         TEXT NOT NULL,
  level          TEXT NOT NULL DEFAULT 'department',
  department_id  TEXT REFERENCES department(id),
  sector_id      TEXT REFERENCES sector(id),
  bundle_key     TEXT,
  bundle_id      TEXT,
  note           TEXT,
  granted_by     TEXT REFERENCES app_user(id),
  created_at     TEXT NOT NULL,
  expires_at     TEXT,
  revoked_by     TEXT REFERENCES app_user(id),
  deleted_at     TEXT
);

INSERT INTO user_department_grant_v2
  (id, user_id, resource, action, level, department_id, sector_id, bundle_key, bundle_id, note, granted_by, created_at, expires_at, revoked_by, deleted_at)
SELECT g.id, g.user_id, g.resource, g.action, 'department', g.department_id, d.sector_id, NULL, g.id, g.note, g.granted_by, g.created_at, NULL, g.revoked_by, g.deleted_at
  FROM user_department_grant g
  LEFT JOIN department d ON d.id = g.department_id;

DROP TABLE user_department_grant;
ALTER TABLE user_department_grant_v2 RENAME TO user_department_grant;

CREATE INDEX IF NOT EXISTS ix_udg_user ON user_department_grant(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS ix_udg_dept ON user_department_grant(department_id, deleted_at);
CREATE INDEX IF NOT EXISTS ix_udg_sector ON user_department_grant(sector_id, deleted_at);
CREATE INDEX IF NOT EXISTS ix_udg_bundle ON user_department_grant(bundle_id, deleted_at);
