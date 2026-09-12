-- ربط المساعد الخارجي (MCP): عميل مسجَّل، رمز تفويض قصير العمر، ورمز وصول/تجديد مربوط بمستخدم
-- سند واحد. إضافية بالكامل: لا تمسّ جدولاً قائماً ولا تعدّل بياناً.
--
-- ثلاث قواعد مكتوبة في المخطط نفسه لا في الشرح:
--   ① لا رمز خدمة عام: `user_id` إلزامي على كل رمز، فلا وجود لرمزٍ بلا صاحب يُنفَّذ بصلاحيات الجميع.
--   ② السرّ لا يُحفظ: نحفظ بصمة الرمز (`token_hash`) لا الرمز، فتسريب نسخة القاعدة لا يمنح وصولاً.
--   ③ الإبطال حالة لا حذف: `revoked_at` يبقى مع صفّه فيبقى الأثر مقروءاً بعد قطع الربط.
CREATE TABLE IF NOT EXISTS mcp_client (
  id             TEXT PRIMARY KEY,          -- معرّف العميل المعروض للعميل الخارجي
  name_ar        TEXT NOT NULL,             -- الاسم كما أعلنه العميل عند التسجيل (يُعرض في شاشة الإذن)
  redirect_uris  TEXT NOT NULL,             -- عناوين العودة المسجَّلة (قائمة مرمَّزة)
  created_at     TEXT NOT NULL,
  created_ip     TEXT,
  disabled_at    TEXT
);

CREATE TABLE IF NOT EXISTS mcp_auth_code (
  id                    TEXT PRIMARY KEY,   -- بصمة رمز التفويض لا الرمز نفسه
  client_id             TEXT NOT NULL REFERENCES mcp_client(id),
  user_id               TEXT NOT NULL REFERENCES app_user(id),
  redirect_uri          TEXT NOT NULL,
  code_challenge        TEXT NOT NULL,      -- PKCE — التحقق يُقارن بالبصمة لا بسرٍّ محفوظ
  code_challenge_method TEXT NOT NULL,
  resource              TEXT,               -- الجمهور المطلوب (RFC 8707) — يُقارن بعنوان هذا الخادم
  created_at            TEXT NOT NULL,
  expires_at            TEXT NOT NULL,
  used_at               TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_auth_code_user ON mcp_auth_code(user_id, created_at);

CREATE TABLE IF NOT EXISTS mcp_token (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL,               -- access | refresh
  client_id    TEXT NOT NULL REFERENCES mcp_client(id),
  user_id      TEXT NOT NULL REFERENCES app_user(id),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT,
  revoked_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_token_user ON mcp_token(user_id, client_id);
CREATE INDEX IF NOT EXISTS idx_mcp_token_live ON mcp_token(kind, expires_at);
