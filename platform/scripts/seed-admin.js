// تهيئة حساب مدير أولي للإنتاج — يُنشئ مديراً واحداً من متغيّرات البيئة عند أول إقلاع إنتاجي
// (حيث لا تُبذَر حسابات العرض). آمن التكرار: لا يفعل شيئاً إن لم تُضبط المتغيّرات أو إن كان
// الحساب موجوداً أو إن وُجد أي مدير نشط أصلاً. لا يرمي أبداً كي لا يمنع الإقلاع.
//
// **البريد هو المُلزِم لا كلمة المرور** — لأن البريد صار هوية الدخول. مديرٌ أوّلُ بلا بريد
// يولد النظام مقفلاً على نفسه: لا يستطيع طلب رمز، ولا أحد غيره يستطيع إضافة بريده من الداخل.
//   SANAD_ADMIN_EMAIL=you@evc.sa [SANAD_ADMIN_PASS=...] node --experimental-sqlite scripts/seed-admin.js
// وكلمة المرور اختيارية تماماً: بدونها يدخل المدير برمز البريد وحده — وهو الوضع المقصود.
import { get, insert, close } from '../src/core/db/index.js';
import { hashPassword } from '../src/core/auth/password.js';
import { id, nowIso } from '../src/core/util/ids.js';
import { audit } from '../src/core/audit/index.js';

const SYS = { user: { id: 'system', username: 'system', role_id: 'admin' }, ip: null };

export async function seedAdmin() {
  const email = (process.env.SANAD_ADMIN_EMAIL || '').trim().toLowerCase();
  const username = (process.env.SANAD_ADMIN_USER || email.split('@')[0] || '').trim();
  const pass = process.env.SANAD_ADMIN_PASS || '';

  // البريد هو الهوية، فهو **الإلزامي** هنا لا كلمة المرور. مديرٌ أوّلُ بلا بريد لا يستطيع طلب
  // رمز دخول أصلاً، فيولد النظام مقفلاً على نفسه: لا أحد يدخل، ولا أحد يضيف البريد من الداخل.
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.log('seed-admin: لا مدير أولي — SANAD_ADMIN_EMAIL غير مضبوط أو غير صالح. تخطٍّ.');
    return { created: false, reason: 'no-email' };
  }
  // كلمة المرور اختيارية: بلا واحدة يدخل المدير برمز البريد وحده، وهو الوضع المقصود.
  if (!pass) console.log('seed-admin: بلا كلمة مرور — الدخول برمز البريد وحده.');

  // موجود بالفعل؟ لا تُكرِّر — والبحث بالبريد لأنه المعرّف، لا بالاسم.
  const existing = await get(
    'SELECT id FROM app_user WHERE lower(trim(email)) = ? AND deleted_at IS NULL', [email]);
  if (existing) { console.log(`seed-admin: «${email}» موجود — تخطٍّ`); return { created: false, reason: 'exists' }; }
  // يوجد أي مدير نشط أصلاً؟ لا تُنشئ ثانياً **تلقائياً** (الحماية من التكرار على قاعدة مأهولة).
  //
  // ولهذا الحارس ثغرةٌ عملية: حين تُطلب إدارةُ النظام في **حسابٍ مخصَّص** لا في حساب موظف —
  // وهو الصواب، فإدارة النظام وظيفةٌ لا شخص — يتعذّر إنشاؤه على قاعدةٍ عاملة. فالحارس يمنعه
  // لوجود مديرٍ قائم، وحارسُ «آخر مدير نشط» يمنع تنحية القائم قبل وجود بديل. قفلٌ مطبق.
  //
  // فيُفتح بابٌ **مُعلَن لا ضمني**: SANAD_ADMIN_FORCE=1 يتجاوز هذا الشرط وحده. ولا يمسّ
  // الحارس الأهم فوقه — البريد الموجود لا يُكرَّر أبداً مهما كان المفتاح — فيبقى التكرار
  // مستحيلاً وتبقى العملية آمنة على إعادة التشغيل.
  const forced = process.env.SANAD_ADMIN_FORCE === '1' || process.env.SANAD_ADMIN_FORCE === 'true';
  const anyAdmin = await get("SELECT id FROM app_user WHERE role_id = 'admin' AND active = 1 AND deleted_at IS NULL");
  if (anyAdmin && !forced) { console.log('seed-admin: يوجد مدير نشط أصلاً — تخطٍّ'); return { created: false, reason: 'admin-present' }; }
  if (anyAdmin && forced) console.log('seed-admin: يوجد مدير نشط، وأُعلن التجاوز صراحةً — يُنشأ حساب إدارة النظام المخصَّص.');

  const uid = id('usr');
  const now = nowIso();
  await insert('app_user', {
    id: uid, username, email, role_id: 'admin', scope: 'company',
    name_ar: 'مدير النظام', name_en: 'System Administrator',
    password_hash: pass ? hashPassword(pass) : null,
    active: 1, must_change_pw: 0,
    created_at: now, created_by: 'system',
  });
  await audit(SYS, { action: 'create', resource: 'app_user', resourceId: uid, detail: { bootstrapAdmin: true, email } });
  console.log(`✓ seed-admin: أُنشئ مدير أولي «${email}»${pass ? ' (بكلمة مرور مؤقتة — غيّرها فوراً)' : ' — يدخل برمز البريد'}`);
  return { created: true, id: uid };
}

// تشغيل مباشر فقط
if (import.meta.url === `file://${process.argv[1]}`) {
  seedAdmin().then(async () => { await close(); process.exit(0); }).catch((e) => { console.error('seed-admin:', e?.message || e); process.exit(0); });
}
