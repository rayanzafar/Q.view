// Authentication service: login with lockout, session lifecycle, password change.
import { get, run, insert } from '../db/index.js';
import { config } from '../config.js';
import { id, nowIso } from '../util/ids.js';
import { verifyPassword, hashPassword } from './password.js';
import { audit } from '../audit/index.js';
import { badRequest, unauthorized } from '../http/errors.js';

// القفل **مؤقت** — وكان دائماً.
//
// العيب: `fail()` كانت تزيد العدّاد وتُجدّد القفل **مهما كان السبب**، والقفل نفسه سببٌ من
// أسبابها. فأي طلبٍ يصل والحساب مقفول يُعيد ختمه خمس عشرة دقيقة أخرى — **ولو كانت كلمة المرور
// صحيحة**، لأن فحص القفل يسبق فحص كلمة المرور. والعدّاد لا يُصفَّر إلا بدخولٍ ناجح، وهو متعذّر
// أثناء القفل. فمن تجاوز ست محاولات لا يخرج من القفل أبداً ما دام أحدٌ يطرق حسابه.
//
// وأثرُه ليس إزعاج مُختبِر: **طلبٌ واحد كل ربع ساعة يحجز أي موظف خارج المنصة إلى الأبد**، وأسماء
// المستخدمين ظاهرة في شاشة المستخدمين وسجل التدقيق. حجبُ خدمةٍ على شخصٍ بعينه بلا اختراق —
// وصاحبُ الحساب نفسه يُطيل قفله بكل محاولة يائسة يعيدها.
//
// والتصحيح شرطان لا واحد:
//   ١) القفل المنقضي يُمحى ويُصفَّر عدّاده **قبل** أي حكم — فالنافذة تنتهي فعلاً كما تقول.
//   ٢) الفشل بسبب القفل لا يُجدّده: صاحبه لم يخمّن كلمة مرور، فلا يُعاقب على أنه حاول.
// والحماية من التخمين باقية كما هي: ست محاولات **خاطئة** تقفل ربع ساعة، ثم تُستأنف من جديد.
export async function login({ username, password, ip, userAgent }) {
  let u = await get('SELECT * FROM app_user WHERE lower(username) = lower(?) AND deleted_at IS NULL', [username]);

  // (١) نافذةٌ انقضت = صفحةٌ جديدة. تُمحى قبل أي فحص كي لا يُقاس الحساب بماضٍ سقطت مدّته.
  if (u && u.locked_until && new Date(u.locked_until).getTime() <= Date.now()) {
    await run('UPDATE app_user SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [u.id]);
    u = { ...u, failed_attempts: 0, locked_until: null };
  }

  // (٢) العدّ صريحٌ لا مشتقٌّ من نص السبب: القفل لا يُحرّك عدّاداً (وإلا جدّد نفسه)، والفشل بعد
  // كلمة مرورٍ صحيحة (حسابٌ معطَّل) ليس تخميناً يُعاقَب عليه.
  const fail = async (reason, { count = true } = {}) => {
    if (u) {
      if (count) {
        const attempts = (u.failed_attempts || 0) + 1;
        const locked = attempts >= config.maxFailedAttempts
          ? new Date(Date.now() + config.lockMinutes * 60000).toISOString() : null;
        await run('UPDATE app_user SET failed_attempts = ?, locked_until = ? WHERE id = ?', [attempts, locked, u.id]);
      }
      // والأثر يُكتب في الحالتين: «حاول أحدٌ الدخول» واقعةٌ تُسجَّل ولو رُدّ الطلب بالقفل.
      await insert('login_history', { id: id('lh'), user_id: u.id, at: nowIso(), ip, user_agent: userAgent, ok: 0 });
    }
    return { ok: false, reason };
  };

  // منعُ عدّ الحسابات: من لا يعرف كلمة المرور لا يفرّق بين «غير موجود» و«معطَّل» و«مقفول» — الثلاثة
  // «بيانات الدخول غير صحيحة». والسبب الحقيقي (معطَّل/مقفول) لا يُقال إلا لمن أثبت أنه صاحب الحساب
  // بكلمة مروره. وكان الحساب يُكشف بثلاث رسائل قبل التحقق من كلمة المرور.
  if (!u || !u.password_hash) return fail('invalid');
  // القفل يُفحص **قبل** التحقق من كلمة المرور: التحقّق البطيء (scrypt) قبله كان يُنهي النافذة
  // القصيرة فتمرّ محاولةٌ خاطئة أثناء القفل إلى مسار العدّ فتُعيد الختم — أي القفل الدائم نفسه.
  // ولا يُفشى القفل لغير صاحبه: كلمة المرور الصحيحة تُقال لها «مقفول»، والخاطئة «بيانات غير صحيحة».
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now())
    return fail(verifyPassword(password, u.password_hash) ? 'locked' : 'invalid', { count: false });
  if (!verifyPassword(password, u.password_hash)) return fail('invalid');
  if (!u.active) return fail('inactive', { count: false });

  // success
  const now = nowIso();
  await run('UPDATE app_user SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [now, u.id]);
  await insert('login_history', { id: id('lh'), user_id: u.id, at: now, ip, user_agent: userAgent, ok: 1 });
  const sid = id('sess');
  await insert('session', {
    id: sid, user_id: u.id, created_at: now,
    expires_at: new Date(Date.now() + config.sessionTtlHours * 3600000).toISOString(),
    ip, user_agent: userAgent,
  });
  await audit({ user: u, ip }, { action: 'login', resource: 'session', resourceId: sid });
  return { ok: true, sessionId: sid, user: u, mustChangePassword: !!u.must_change_pw };
}

export async function logout(sessionId) {
  if (sessionId) await run('UPDATE session SET revoked_at = ? WHERE id = ?', [nowIso(), sessionId]);
}

// ── تدحرجُ الجلسة ─────────────────────────────────────────────────────────────
// نافذةُ الخمول تُجدَّد مع النشاط: كل طلبٍ يدفع `expires_at` إلى «الآن + النافذة»، فلا
// ينتهي عملٌ في منتصفه. وثلاثة قيود تحكم الدفع:
//
//   ١) **السقف المطلق** يُحسب من لحظة الدخول ولا يتجاوزه التمديد أبداً. جلسةٌ تتدحرج بلا
//      سقفٍ ليست جلسةً بل حسابٌ مفتوح: كعكةٌ تُسرق اليوم تبقى صالحةً ما دام سارقها ينقر.
//      وحين تبلغ الجلسةُ سقفها يعود السلوك القديم بالضبط — انتهاءٌ في موعدٍ ثابت.
//   ٢) **خانقُ الكتابة**: لا يُكتب شيء ما لم تمضِ `sessionTouchMinutes` على آخر لمسة. صفحةٌ
//      واحدة عشرات الطلبات، وكتابةٌ لكل طلب تجعل من كل نقرةٍ حِملاً على القاعدة. والثمن
//      المقبول أن يكون الانتهاء الفعلي متأخّراً بدقائق معدودة عن آخر نشاط — لا أكثر.
//   ٣) **الملغى لا يُبعث**: `revoked_at IS NULL` شرطٌ في جملة التحديث نفسها لا فحصٌ قبلها.
//      بينهما فجوة، وفيها قد يضغط مديرُ النظام «إنهاء الجلسات» على جهازٍ ضائع — فتُعيده
//      لمسةٌ متأخّرة إلى الحياة. الشرطُ داخل الكتابة يجعل السباق مستحيلاً لا نادراً.
//
// تُعيد `expires_at` السارية دائماً (المُمدَّدة أو القائمة كما هي) كي يجدّد المُنادي الكعكة
// بها — فالمتصفّح شريكٌ في المهلة: كعكةٌ تموت في موعدها الأول تُنهي الجلسة ولو امتدّ صفّها.
export async function touchSession(session) {
  const idleMs = config.sessionTtlHours * 3600000;
  const now = Date.now();
  const born = new Date(session.created_at).getTime();
  const current = new Date(session.expires_at).getTime();
  // ختمٌ لا يُقرأ (صفٌّ مكتوبٌ بيدٍ أخرى، أو عمودٌ تالف) = لا سقف يُحتسب. والفشل مغلق:
  // لا تمديد. وبلا هذا يصير `new Date(NaN).toISOString()` رميةً تُسقط **كل طلبٍ** لصاحب
  // ذلك الصفّ — أي طردٌ دائم بخطأ خادم، وهو أسوأ من العيب الذي جاء التدحرج ليصلحه.
  if (!Number.isFinite(born) || !Number.isFinite(current)) return session.expires_at;
  const cap = born + config.sessionMaxDays * 86400000;
  const next = Math.min(now + idleMs, cap);

  if (next <= current) return session.expires_at;            // بلغت سقفها — لا تمديد بعده
  const lastSeen = new Date(session.last_seen_at || session.created_at).getTime();
  if (now - lastSeen < config.sessionTouchMinutes * 60000) return session.expires_at;

  const nextIso = new Date(next).toISOString();
  const r = await run(
    'UPDATE session SET expires_at = ?, last_seen_at = ? WHERE id = ? AND revoked_at IS NULL',
    [nextIso, new Date(now).toISOString(), session.id]);
  return Number(r.changes) === 1 ? nextIso : session.expires_at;
}

// كنسُ الجلسات المنتهية — يُستدعى من المجدول. الجدول لم يُكنَس منذ أول إصدار، ويُغذّيه أكثر
// من الدخول: محرّك التقارير يكتب صفّاً لكل تقرير لكل مستقبِل. والمهلة تُقاس بالسقف المطلق لا
// بالنافذة: صفٌّ انتهت نافذتُه اليوم قد يكون آخرَ أثرٍ لجهازٍ يُسأل عنه غداً، فيبقى حتى يسقط
// سقفُه ثم يُمحى. (`login_history` هو السجل الدائم — هذا الجدول حالةٌ لا أرشيف.)
export async function purgeExpiredSessions() {
  const cutoff = new Date(Date.now() - config.sessionMaxDays * 86400000).toISOString();
  const r = await run('DELETE FROM session WHERE expires_at < ?', [cutoff]);
  return { removed: Number(r.changes || 0) };
}

// تغيير كلمة المرور أخطرُ كتابةٍ في المنتج، فيُحاط بثلاثة شروط لم تكن قائمة:
//   ١) إعادة توثيق: كلمة المرور الحالية تُطلب وتُتحقَّق — جلسةٌ وحدها (حاسوبٌ معار، كوكيز
//      مسروقة) لا تكفي للاستيلاء على الحساب. حسابات الرمز فقط (بلا كلمة مرور) تُستثنى.
//   ٢) أثرٌ في التدقيق: كل تغيير كلمة مرور يُسجَّل.
//   ٣) إنهاء بقية الجلسات: أي جلسةٍ أخرى قد تكون مسروقة تُطرد فوراً، وتبقى الجلسة الحالية.
export async function changePassword(ctx, { currentPassword, newPassword, currentSessionId } = {}) {
  const userId = ctx?.user?.id;
  if (!userId) throw unauthorized();
  const u = await get('SELECT * FROM app_user WHERE id = ? AND deleted_at IS NULL', [userId]);
  if (!u) throw unauthorized();
  if (u.password_hash && !verifyPassword(String(currentPassword || ''), u.password_hash))
    throw badRequest('كلمة المرور الحالية غير صحيحة');
  const now = nowIso();
  await run('UPDATE app_user SET password_hash = ?, must_change_pw = 0, updated_at = ? WHERE id = ?',
    [hashPassword(newPassword), now, userId]);
  await run('UPDATE session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id <> ?',
    [now, userId, currentSessionId || '']);
  await audit(ctx, { action: 'change_password', resource: 'app_user', resourceId: userId });
}
