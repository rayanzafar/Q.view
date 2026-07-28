// الدخول برمزٍ يصل إلى البريد — بلا كلمة مرور دائمة.
//
// ثلاثة قرارات تحكم هذا الملف كله:
//
// ١) الرمز يُخزَّن مُجزَّأً بنفس دالة كلمة المرور. جدولٌ فيه رموز دخول حيّة نصاً هو مفتاحٌ لكل
//    حسابات الشركة لمن قرأ نسخةً احتياطية واحدة — ولا يُقرأ الرمز بعد إنشائه، لا لمشرف ولا لغيره.
//
// ٢) الاستهلاك ذرّي: تحديثٌ مشروط واحد يقرّر من ظفر بالرمز (نفس مزلاج معاينة المساعد في
//    core/ai/store.js). بلا ذلك يقبل طلبان متزامنان الرمزَ نفسه فيُنشآن جلستين من رمزٍ لمرة واحدة.
//
// ٣) لا يُفشى وجود الحساب. طلبُ رمزٍ لبريدٍ غير مسجَّل يردّ نفس الردّ تماماً، ويؤدّي نفس العمل
//    الحسابي تقريباً — وإلا صارت شاشة الدخول أداةَ استكشافٍ لمن يعمل في EVC ومن لا يعمل.
import { get, run, insert } from '../db/index.js';
import { config } from '../config.js';
import { id, nowIso } from '../util/ids.js';
import { hashPassword, verifyPassword } from './password.js';
import { audit } from '../audit/index.js';
import { sendMail, DELIVERY } from '../mail/transport.js';
import { signInCodeMail, inviteCodeMail } from '../mail/auth-mail.js';
import { randomInt } from 'node:crypto';

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LENGTH = 6;
export const PURPOSE = { SIGNIN: 'signin', INVITE: 'invite' };

export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();

// رمزٌ رقمي موحَّد الطول. randomInt من node:crypto لا Math.random — الأخير قابل للتنبؤ،
// ورمزُ دخولٍ قابل للتنبؤ ليس رمزاً. والحشو بالأصفار يبقي الطول ستة دائماً.
function generateCode() {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

const plusMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();

async function findUserByEmail(email) {
  const norm = normalizeEmail(email);
  if (!norm || !norm.includes('@')) return null;
  return await get(
    'SELECT * FROM app_user WHERE lower(trim(email)) = ? AND deleted_at IS NULL', [norm]);
}

// ───────────────────────────── طلب الرمز ─────────────────────────────

// يردّ { ok: true } دائماً — نجح أم لم ينجح. التشخيص الحقيقي يذهب إلى سجل التدقيق لا إلى الردّ.
export async function requestCode({ email, ip, purpose = PURPOSE.SIGNIN, inviterName = null }) {
  const u = await findUserByEmail(email);

  // الحسابُ يستحق رمزاً إن كان قائماً ونشطاً — أو كان معطّلاً والغرضُ دعوةٌ تفعّله، وهي
  // الحالة الوحيدة التي يُرسَل فيها رمزٌ إلى حساب غير نشط (وإلا لَما أمكن تفعيل أحد أصلاً).
  const eligible = !!u && (u.active === 1 || u.active === true || purpose === PURPOSE.INVITE);

  // بريدٌ لا حساب له (أو حسابٌ معطّل يُطلب له دخول): نؤدّي عملاً حسابياً مكافئاً — تجزئةٌ
  // واحدة، وهي الجزء الغالي — ثم نردّ نفس الردّ. بلا هذا يصير فرقُ زمن الاستجابة نفسه إفشاءً:
  // يعرف السائلُ من له حساب في EVC ومن لا حساب له، بلا أن يملك شيئاً.
  if (!eligible) {
    hashPassword(generateCode());
    return { ok: true, delivered: false };
  }

  // طلبُ رمزٍ جديد يُبطل ما قبله فوراً: وإلا بقيت عدة رموز حيّة معاً، وكل واحد منها بابٌ مفتوح.
  await run('UPDATE login_code SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL',
    [nowIso(), u.id]);

  const code = generateCode();
  await insert('login_code', {
    id: id('lc'), user_id: u.id, code_hash: hashPassword(code), purpose,
    expires_at: plusMinutes(OTP_TTL_MINUTES), attempts: 0, ip, created_at: nowIso(),
  });

  // الإرسال **فوري** لا عبر طابور البريد: الطابور يُستنزف كل ٦٠ ثانية، ورمزُ دخولٍ يصل بعد
  // دقيقة رمزٌ ميّت — ينتهي نصف عمره قبل أن يراه صاحبه.
  const mail = purpose === PURPOSE.INVITE
    ? inviteCodeMail({ code, minutes: OTP_TTL_MINUTES, inviterName })
    : signInCodeMail({ code, minutes: OTP_TTL_MINUTES });
  let delivered = false, failure = null;
  try {
    const res = await sendMail({ to: [u.email], subject: mail.subject, html: mail.html });
    delivered = res.delivery === DELIVERY.SENT;
    if (res.delivery === DELIVERY.BLOCKED) failure = 'blocked';
    else if (res.delivery === DELIVERY.PREVIEWED) failure = 'previewed';
  } catch (e) {
    failure = String(e.message).slice(0, 200);
  }

  // الأثر يسجّل أن رمزاً طُلب — لا الرمز نفسه، ولا حتى جزءاً منه.
  await audit({ user: u, ip }, {
    action: 'login', resource: 'login_code', resourceId: u.id,
    detail: `طُلب رمز دخول (${purpose})${delivered ? '' : ` — لم يُسلَّم: ${failure || 'سبب غير معروف'}`}`,
  });
  return { ok: true, delivered };
}

// ───────────────────────────── التحقق ─────────────────────────────

// أسباب الرفض مفصولة عمداً: «انتهت صلاحيته» علاجها طلبُ رمز جديد، و«غير صحيح» علاجها إعادة
// الكتابة. وخلطُهما يجعل الموظف يعيد كتابة رمزٍ ميّت حتى يُقفل حسابه.
export const REASON = { INVALID: 'invalid', EXPIRED: 'expired', ATTEMPTS: 'attempts', INACTIVE: 'inactive' };

export async function verifyCode({ email, code, ip, userAgent }) {
  const u = await findUserByEmail(email);
  const clean = String(code || '').trim();
  if (!u || !/^\d+$/.test(clean)) { hashPassword(clean || 'x'); return { ok: false, reason: REASON.INVALID }; }

  const row = await get(
    `SELECT * FROM login_code WHERE user_id = ? AND consumed_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1`, [u.id, nowIso()]);
  if (!row) { hashPassword(clean); return { ok: false, reason: REASON.EXPIRED }; }

  // سقف المحاولات على الرمز نفسه: خمس محاولات خاطئة تحرقه. مليونُ احتمالٍ بلا سقفٍ يُخمَّن.
  if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) {
    await run('UPDATE login_code SET consumed_at = ? WHERE id = ?', [nowIso(), row.id]);
    return { ok: false, reason: REASON.ATTEMPTS };
  }

  if (!verifyPassword(clean, row.code_hash)) {
    await run('UPDATE login_code SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    await insert('login_history', { id: id('lh'), user_id: u.id, at: nowIso(), ip, user_agent: userAgent, ok: 0 });
    const left = OTP_MAX_ATTEMPTS - (Number(row.attempts) + 1);
    return { ok: false, reason: REASON.INVALID, attemptsLeft: Math.max(0, left) };
  }

  // المزلاج: تحديثٌ مشروط واحد. `changes === 1` تعني «هذا الطلب هو من ظفر بالرمز» — وأي طلبٍ
  // متزامن آخر يجد consumed_at مملوءاً فيُردّ. الفحص السابق لا يكفي وحده: بينه وبين الكتابة فجوة.
  const now = nowIso();
  const claim = await run(
    'UPDATE login_code SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?',
    [now, row.id, now]);
  if (Number(claim.changes) !== 1) return { ok: false, reason: REASON.EXPIRED };

  // رمز الدعوة يفعّل الحساب — وهو الفرق الوحيد بين الغرضين.
  if (row.purpose === PURPOSE.INVITE && !u.active) {
    await run('UPDATE app_user SET active = 1, updated_at = ? WHERE id = ?', [now, u.id]);
    u.active = 1;
  }
  if (!u.active) return { ok: false, reason: REASON.INACTIVE };

  await run(
    'UPDATE app_user SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, last_login_method = ? WHERE id = ?',
    [now, 'otp', u.id]);
  await insert('login_history', { id: id('lh'), user_id: u.id, at: now, ip, user_agent: userAgent, ok: 1 });
  const sid = id('sess');
  await insert('session', {
    id: sid, user_id: u.id, created_at: now,
    expires_at: new Date(Date.now() + config.sessionTtlHours * 3600000).toISOString(),
    ip, user_agent: userAgent,
  });
  await audit({ user: u, ip }, { action: 'login', resource: 'session', resourceId: sid, detail: 'دخول برمز البريد' });
  return { ok: true, sessionId: sid, user: u };
}

// تنظيف الرموز المنتهية. يُستدعى من المجدول — الجدول ينمو بلا حدّ بلا هذا، وكل صفٍّ فيه أثرٌ
// لطلب دخول لا حاجة إلى الاحتفاظ به بعد انتهائه.
export async function purgeExpiredCodes(olderThanHours = 24) {
  const cutoff = new Date(Date.now() - olderThanHours * 3600000).toISOString();
  const r = await run('DELETE FROM login_code WHERE expires_at < ?', [cutoff]);
  return { removed: Number(r.changes || 0) };
}
