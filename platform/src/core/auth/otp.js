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

// يردّ { ok: true } دائماً — نجح أم لم ينجح. والسبب (`reason`) يُرافقه للمُنادي **لا للشاشة**:
// شاشةُ الدخول تتجاهله عمداً كي لا تُفشي وجود الحساب، وشاشةُ إدارة الهوية تعرضه لأن ضاغطَ
// الزرّ هناك مديرُ النظام لا صاحبُ الحساب — وإخفاء السبب عنه ليس حمايةً بل عطلاً.
//
// وهذا ما كلّف يوماً: أربع محاولات دخولٍ لموظف حُجبت كلها لأن عنوانه خارج قائمة العناوين
// المسموح بها، والشاشة تقول «أرسلنا رمزاً». فبحث الجميع في البريد المزعج ولا رسالة هناك أصلاً.
export async function requestCode({ email, ip, purpose = PURPOSE.SIGNIN, inviterName = null }) {
  const u = await findUserByEmail(email);

  // ── مَن يستحق رمزاً ──────────────────────────────────────────────────────
  // الحسابُ النشط يستحقه، والغرضُ «دعوة» يستحقه (وإلا لَما أمكن تفعيل أحد).
  //
  // **وحسابٌ ينتظر التفعيل يستحقه أيضاً — وهذا ما كان مفقوداً.** كانت الشاشة تطلب «دخولاً»
  // دائماً، وطلبُ دخولٍ لحسابٍ غير نشط يسقط في الفرع الصامت أدناه: لا رسالة، ولا سطر في السجل،
  // ولا سبب — والشاشة تقول «أرسلنا رمزاً». أي أن **المدعوّ لا يستطيع تفعيل حسابه من شاشة
  // الدخول إطلاقاً**، ولا يعرف هو ولا مديرُه لماذا. وقع ذلك حرفياً على موظفٍ حسابُه «دعوة
  // معلّقة» وبريدُه صحيحٌ ومسموح: طلب مرّةً بعد مرّة ولا شيء يصله ولا شيء يُسجَّل.
  //
  // و«ينتظر التفعيل» تعريفٌ قائم في المنصة تستعمله شاشة الهوية حرفاً: غير نشط · **ولم يدخل قط**
  // · ولا ختمَ تعطيلٍ عليه (`deactivated_at`، ترحيلة ٠١٦). والشروط الثلاثة تلزم معاً — فمن دخل
  // من قبل ثم أُوقف حسابُه موقوفٌ فعلاً لا منتظِر، ودعوتُه تعيد فتح بابٍ أُغلق عليه عمداً.
  // والتعريف يُقرأ من حيث تقرؤه الشاشة كي لا يفترق الحكمان: ما تسمّيه الشاشة «دعوة معلّقة»
  // هو بعينه ما يُدعى هنا، لا أوسع منه ولا أضيق.
  const pendingActivation = !!u && !u.active && !u.deactivated_at && !u.last_login_at;
  const eligible = !!u && (u.active === 1 || u.active === true || purpose === PURPOSE.INVITE || pendingActivation);
  // ورسالةُ المنتظِر رسالةُ **تفعيل** لا دخول: النصّ يقول له ما يفعل بالرمز، والاثنان مختلفان.
  const kind = (!u?.active && eligible) ? PURPOSE.INVITE : purpose;

  // بريدٌ لا حساب له (أو حسابٌ أُغلق عليه عمداً): نؤدّي عملاً حسابياً مكافئاً — تجزئةٌ واحدة،
  // وهي الجزء الغالي — ثم نردّ نفس الردّ. بلا هذا يصير فرقُ زمن الاستجابة نفسه إفشاءً:
  // يعرف السائلُ من له حساب في EVC ومن لا حساب له، بلا أن يملك شيئاً.
  if (!eligible) {
    hashPassword(generateCode());
    // ── ويُكتب أثرٌ **لحسابٍ قائم** رغم ذلك ─────────────────────────────
    // كان هذا الفرع صامتاً تماماً، فحين يشتكي موظف «طلبت وما وصلني» يفتح المدير مركز البريد
    // فلا يجد شيئاً — لا سطراً ولا سبباً — فيظنّ أن الموظف لم يطلب أصلاً. والصمتُ أسوأ من
    // الحجب: مع الحجب يُعرَف السبب، ومع الصمت لا يُعرَف حتى أن أحداً حاول.
    //
    // **وبريدٌ لا حساب له يبقى صامتاً كما كان** — وهذا حدٌّ قائم لا أنقضه: سطرٌ يُكتب لكل عنوان
    // يُطلَب له رمز يجعل السجلّ نفسه قابلاً للاستكشاف، ويسمح بإغراقه بعناوين مختلقة حتى تُدفن
    // فيه الأحداث الحقيقية. فالأثر لمن له حسابٌ فعلاً — ومديرُ النظام يعرف حساباته أصلاً.
    if (u) {
      try {
        await insert('email_log', {
          id: id('el'), queue_id: null, event: 'failed',
          detail: `طُلب رمز دخول لبريد ${normalizeEmail(email)} — لم يُرسَل: الحساب مُغلق عليه`,
          at: nowIso(),
        });
      } catch { /* الأثر لا يُسقط الطلب */ }
    }
    // ولا سبب في القيمة المُعادة: الردّ يجب أن يطابق الردّ الناجح حرفاً بحرف، وأي خانةٍ زائدة
    // تجعل الفرق قابلاً للقياس ولو لم تُعرَض على شاشة.
    return { ok: true, delivered: false };
  }

  // طلبُ رمزٍ جديد يُبطل ما قبله فوراً: وإلا بقيت عدة رموز حيّة معاً، وكل واحد منها بابٌ مفتوح.
  await run('UPDATE login_code SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL',
    [nowIso(), u.id]);

  const code = generateCode();
  await insert('login_code', {
    id: id('lc'), user_id: u.id, code_hash: hashPassword(code), purpose: kind,
    expires_at: plusMinutes(OTP_TTL_MINUTES), attempts: 0, ip, created_at: nowIso(),
  });

  // الإرسال **فوري** لا عبر طابور البريد: الطابور يُستنزف كل ٦٠ ثانية، ورمزُ دخولٍ يصل بعد
  // دقيقة رمزٌ ميّت — ينتهي نصف عمره قبل أن يراه صاحبه.
  const mail = kind === PURPOSE.INVITE
    ? inviteCodeMail({ code, minutes: OTP_TTL_MINUTES, inviterName })
    : signInCodeMail({ code, minutes: OTP_TTL_MINUTES });
  // السبب يُكتب عربياً منذ لحظة نشأته لا عند عرضه: كان يُخزَّن `previewed`/`blocked` كما هي،
  // وكانت لا تُقرأ من أي شاشة فلم يظهر العيب. ولحظةَ عُرض الأثر ظهر المصطلح الإنجليزي في وجه
  // المستخدم. والمكان الصحيح للترجمة هنا — حيث يُعرف المعنى — لا في كل شاشةٍ تعرضه لاحقاً.
  let delivered = false, failure = null, event = 'failed';
  try {
    const res = await sendMail({ to: [u.email], subject: mail.subject, html: mail.html });
    delivered = res.delivery === DELIVERY.SENT;
    event = res.delivery;
    if (res.delivery === DELIVERY.BLOCKED) failure = res.reason || 'العنوان خارج قائمة العناوين المسموح بها في هذه البيئة';
    else if (res.delivery === DELIVERY.PREVIEWED) failure = 'قناة المعاينة مشغّلة — حُفظت الرسالة ولم تغادر الخادم';
  } catch (e) {
    failure = String(e.message).slice(0, 200);
  }

  // ── أثرُ الرسالة يُكتب حيث يبحث عنه المُشغّل ──
  // رمز الدخول يُرسَل فوراً لا عبر الطابور (الطابور يُستنزف كل ٦٠ ثانية ورمزٌ يصل بعد دقيقة
  // رمزٌ ميّت). وثمنُ ذلك أنه كان **لا يترك أثراً في مركز البريد إطلاقاً**: الشاشة تعرض رسائل
  // التقارير وحدها، فيسأل المُشغّل «لماذا لم يصل الرمز؟» ولا شيء أمامه يجيب — لا صفّ ولا سبب.
  // فيُكتب هنا صفٌّ بلا معرّف طابور: الحالة (أُرسلت/حُجبت/فشلت) والعنوان والسبب كما جاء من
  // المزوّد حرفياً. **ولا يُكتب الرمز ولا جزءٌ منه** — الأثر يقول ماذا جرى للرسالة لا ما فيها.
  try {
    await insert('email_log', {
      id: id('el'),
      queue_id: null,
      event,   // sent | previewed | blocked | failed — نفس مفردات الطابور فتُترجَم بنفس المعجم
      detail: `${kind === PURPOSE.INVITE ? 'رمز تفعيل' : 'رمز دخول'} إلى ${u.email}${delivered ? '' : ` — ${failure || 'سبب غير معروف'}`}`,
      at: nowIso(),
    });
  } catch { /* الأثر لا يُسقط الدخول: فشلُ تسجيلِ سطرٍ أهونُ من منع موظفٍ من حسابه */ }

  // الأثر يسجّل أن رمزاً طُلب — لا الرمز نفسه، ولا حتى جزءاً منه. ونوعُه بالعربية لا برمزه
  // المخزَّن: هذا النصّ يُعرض في سجلّ التدقيق كما هو، فرمزٌ إنجليزي فيه مصطلحٌ في وجه القارئ.
  await audit({ user: u, ip }, {
    action: 'login', resource: 'login_code', resourceId: u.id,
    detail: `طُلب ${kind === PURPOSE.INVITE ? 'رمز تفعيل حساب' : 'رمز دخول'}${delivered ? ' وأُرسل إلى بريده' : ` — لم يُسلَّم: ${failure || 'سبب غير معروف'}`}`,
  });
  return { ok: true, delivered, reason: delivered ? null : (failure || 'سبب غير معروف') };
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
