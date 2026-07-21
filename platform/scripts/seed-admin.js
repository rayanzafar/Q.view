// تهيئة حساب مدير أولي للإنتاج — يُنشئ مديراً واحداً من متغيّرات البيئة عند أول إقلاع إنتاجي
// (حيث لا تُبذَر حسابات العرض). آمن التكرار: لا يفعل شيئاً إن لم تُضبط المتغيّرات أو إن كان
// الحساب موجوداً أو إن وُجد أي مدير نشط أصلاً. لا يرمي أبداً كي لا يمنع الإقلاع.
//   SANAD_ADMIN_USER=... SANAD_ADMIN_PASS=... node --experimental-sqlite scripts/seed-admin.js
import { get, insert, close } from '../src/core/db/index.js';
import { hashPassword } from '../src/core/auth/password.js';
import { id, nowIso } from '../src/core/util/ids.js';
import { audit } from '../src/core/audit/index.js';

const SYS = { user: { id: 'system', username: 'system', role_id: 'admin' }, ip: null };

export async function seedAdmin() {
  const username = (process.env.SANAD_ADMIN_USER || '').trim();
  const pass = process.env.SANAD_ADMIN_PASS || '';
  if (!username || !pass) {
    console.log('seed-admin: لا مدير أولي (SANAD_ADMIN_USER/PASS غير مضبوطة) — تخطٍّ');
    return { created: false, reason: 'no-env' };
  }
  // موجود بالفعل؟ لا تُكرِّر
  const existing = await get('SELECT id FROM app_user WHERE username = ? AND deleted_at IS NULL', [username]);
  if (existing) { console.log(`seed-admin: «${username}» موجود — تخطٍّ`); return { created: false, reason: 'exists' }; }
  // يوجد أي مدير نشط أصلاً؟ لا تُنشئ ثانياً تلقائياً (الحماية من التكرار على قاعدة مأهولة)
  const anyAdmin = await get("SELECT id FROM app_user WHERE role_id = 'admin' AND active = 1 AND deleted_at IS NULL");
  if (anyAdmin) { console.log('seed-admin: يوجد مدير نشط أصلاً — تخطٍّ'); return { created: false, reason: 'admin-present' }; }

  const uid = id('usr');
  const now = nowIso();
  await insert('app_user', {
    id: uid, username, role_id: 'admin', scope: 'company',
    name_ar: 'مدير النظام', name_en: 'System Administrator',
    password_hash: hashPassword(pass),
    active: 1, must_change_pw: 1,           // يُجبَر على تغيير كلمة المرور عند أول دخول
    created_at: now, created_by: 'system',
  });
  await audit(SYS, { action: 'create', resource: 'app_user', resourceId: uid, detail: { bootstrapAdmin: true, username } });
  console.log(`✓ seed-admin: أُنشئ مدير أولي «${username}» (سيُطلب تغيير كلمة المرور عند الدخول)`);
  return { created: true, id: uid };
}

// تشغيل مباشر فقط
if (import.meta.url === `file://${process.argv[1]}`) {
  seedAdmin().then(async () => { await close(); process.exit(0); }).catch((e) => { console.error('seed-admin:', e?.message || e); process.exit(0); });
}
