// صفحة الدخول — هوية EVC الرسمية: الشعار الحقيقي، التدرج الرسمي أزرق→بنفسجي،
// معيّن القيم كعنصر خلفية هادئ، وخط IBM Plex Sans Arabic.
//
// خطوتان: البريد، ثم الرمز الواصل إليه. والخطوة الثانية لا تعرف إن كان للبريد حسابٌ أصلاً —
// فهي تظهر كما هي للجميع، وإلا صارت الشاشة تجيب سؤال «من يعمل في EVC» لمن يسأل بلا حساب.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function loginPage(opts = {}) {
  // التوافق مع النداء القديم loginPage('رسالة خطأ') — كان يمرَّر نصاً لا كائناً.
  const o = typeof opts === 'string' ? { err: opts } : (opts || {});
  const { err = '', notice = '', info = '', step = 'email', email = '', passwordEnabled = false, csrf = '' } = o;
  return step === 'code' ? codeStep({ err, notice, info, email, csrf }) : emailStep({ err, notice, info, passwordEnabled, csrf });
}

// نماذج الدخول محروسة بالرمز المزدوج مثل بقية النماذج — والاستثناء الوحيد الباقي هو مسار
// كلمة المرور القديم. وحراسةُ طلب الرمز ليست شكلية: بدونها تستطيع صفحةٌ خارجية أن تُطلق
// رسائل رموز إلى عناوين تختارها من متصفّح موظف، فتُغرق بريده وتُبطل رموزه الحقيقية.
const csrfField = (t) => (t ? `<input type="hidden" name="_csrf" value="${esc(t)}">` : '');

// ملاحظة على الرمز: inputmode=numeric يفتح لوحة الأرقام على الجوال، و autocomplete=one-time-code
// يجعل النظام يقترح الرمز من الإشعار مباشرةً — فلا يتنقّل الموظف بين البريد والمنصة يدوياً.
function codeStep({ err, notice, info, email, csrf }) {
  // البريد لاتينيٌّ داخل جملة عربية. الترتيب صحيح بلا عزل (جُرّب: الصورتان متطابقتان)، و`<bdi>`
  // احتياطٌ لا إصلاح: عنوانٌ أو اسمٌ يحمل حرفاً عربياً أو علامةً في طرفه يختلط بالنص حوله بلا عزل.
  const noticeHtml = notice ? esc(notice)
    : `أرسلنا رمزاً إلى <bdi dir="ltr">${esc(email || 'بريدك')}</bdi>. يصل خلال ثوانٍ.`;
  return page({
    err,
    info,
    noticeHtml,
    inner: `
  <form method="post" action="/auth/otp/verify-web">
    ${csrfField(csrf)}
    <label for="f-code">رمز الدخول</label>
    <input id="f-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6"
      dir="ltr" class="code" placeholder="------" autofocus>
    <button type="submit">دخول</button>
  </form>
  <form method="post" action="/auth/otp/request-web" style="margin-top:.75rem">
    ${csrfField(csrf)}
    <button type="submit" class="ghost" id="resend">إرسال رمز جديد</button>
  </form>
  <div class="alt"><a href="/login?reset=1">استخدام بريد آخر</a></div>
  <script>
  // عدّاد إعادة الإرسال: بلا مهلة يضغط الموظف مراراً فيُبطل كلُّ رمزٍ سابقَه ولا يعمل أيٌّ منها.
  (function () {
    var b = document.getElementById('resend'), n = 30;
    if (!b) return;
    var t = setInterval(function () {
      n -= 1;
      if (n <= 0) { clearInterval(t); b.disabled = false; b.textContent = 'إرسال رمز جديد'; return; }
      b.textContent = 'إرسال رمز جديد بعد ' + n + ' ثانية';
    }, 1000);
    b.disabled = true; b.textContent = 'إرسال رمز جديد بعد ' + n + ' ثانية';
  })();
  </script>`,
  });
}

function emailStep({ err, notice, info, passwordEnabled, csrf }) {
  return page({
    err,
    notice,
    info,
    inner: `
  <form method="post" action="/auth/otp/request-web">
    ${csrfField(csrf)}
    <label for="f-email">بريد العمل</label>
    <input id="f-email" name="email" type="email" autocomplete="email" dir="ltr" placeholder="name@evc.sa" autofocus required>
    <button type="submit">أرسل رمز الدخول</button>
  </form>
  <div class="hint">يصلك رمزٌ من ستة أرقام على بريدك. لا كلمة مرور تُحفظ ولا تُنسى.</div>
  ${passwordEnabled ? `
  <details class="alt2">
    <summary>لم يصلك الرمز؟ ادخل باسم المستخدم وكلمة المرور</summary>
    <form method="post" action="/auth/login-web" style="margin-top:.8rem">
      <label for="f-username">اسم المستخدم</label>
      <input id="f-username" name="username" autocomplete="username">
      <label for="f-password">كلمة المرور</label>
      <input id="f-password" name="password" type="password" autocomplete="current-password">
      <button type="submit" class="ghost">دخول بكلمة المرور</button>
    </form>
  </details>` : ''}`,
  });
}

// `noticeHtml` تُركَّب من أجزاءٍ مهرَّبة سلفاً (عزل البريد) — و`notice` نصٌّ عادي يُهرَّب هنا.
// و`info` خبرٌ محايد لا خطأ ولا نجاح: «انتهت جلستك» واقعةٌ يومية عادية، وصبغُها بالأحمر
// يستهلك لون الخطر على ما ليس خطراً — ويقول للموظف إنه أخطأ وهو لم يفعل شيئاً.
function page({ err, notice, noticeHtml, info, inner }) {
  const noteOut = noticeHtml || (notice ? esc(notice) : '');
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>دخول · منصة سند EVC</title>
<link rel="icon" type="image/svg+xml" href="/static/brand/favicon.svg">
<style>
@font-face{font-family:'IBM Plex Sans Arabic';src:url('/static/fonts/IBMPlexSansArabic-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'IBM Plex Sans Arabic';src:url('/static/fonts/IBMPlexSansArabic-Medium.woff2') format('woff2');font-weight:500 700;font-display:swap}
@font-face{font-family:'IBM Plex Sans Arabic';src:url('/static/fonts/IBMPlexSansArabic-Bold.woff2') format('woff2');font-weight:800;font-display:swap}
/* شاشة الدخول لا تمرّ عبر layout()، فمقاييس الخطّ (--fs-*) تُعرَّف هنا كما في layout.js — وإلا
   سقط كل نصٍّ صغير إلى مقاسٍ موروث خاطئ على أكثر الشاشات زيارة. */
:root{--fs-micro:10.5px;--fs-meta:11.5px;--fs-body:12.5px;--fs-ui:13px;--fs-title:14px;--fs-page:16px}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem;
  background:linear-gradient(160deg,#182c56 0%,#244A99 48%,#56316b 100%);
  font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;line-height:1.7;position:relative;overflow:hidden}
.motif{position:absolute;inset-inline-start:-90px;bottom:-90px;width:420px;opacity:.10;pointer-events:none;filter:brightness(4)}
.card{position:relative;background:#fff;border-radius:20px;box-shadow:0 30px 80px rgba(10,18,40,.45);padding:2.2rem 2rem 2rem;width:100%;max-width:380px}
.logo{width:210px;max-width:80%;display:block;margin:0 auto}
.sub{text-align:center;font-size:var(--fs-ui);font-weight:700;color:#1e293b;margin-top:1.1rem}
.sub2{text-align:center;font-size:var(--fs-meta);color:#94a3b8;margin-top:.15rem;margin-bottom:1.4rem}
label{display:block;font-size:var(--fs-meta);font-weight:700;color:#64748b;margin-bottom:.3rem}
input{width:100%;padding:.65rem .8rem;border:1px solid #e6e9f0;border-radius:11px;font-size:13.5px;font-family:inherit;margin-bottom:.9rem;color:#1e293b}
input:focus{outline:none;border-color:#244A99;box-shadow:0 0 0 3px rgba(36,74,153,.14)}
button{width:100%;padding:.7rem;border:none;border-radius:11px;color:#fff;font-size:13.5px;font-weight:700;font-family:inherit;cursor:pointer;
  background:#244A99;box-shadow:0 10px 24px -8px rgba(16,32,70,.55)}
button:hover{background:#1d3d80}
.err{font-size:12px;color:#991b1b;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:.55rem .8rem;text-align:center;margin-bottom:1rem}
.ok{font-size:12px;color:#155e33;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:.55rem .8rem;text-align:center;margin-bottom:1rem;line-height:1.75}
.note{font-size:12px;color:#334155;background:#f6f8fc;border:1px solid #dbe2ef;border-radius:10px;padding:.55rem .8rem;text-align:center;margin-bottom:1rem;line-height:1.75}
.foot{margin-top:1.2rem;text-align:center;font-size:var(--fs-micro);color:#94a3b8}
.hint{margin-top:.85rem;text-align:center;font-size:var(--fs-micro);color:#94a3b8;line-height:1.75}
.code{text-align:center;font-family:'Courier New',Courier,monospace;font-size:26px;font-weight:700;letter-spacing:9px;padding:.6rem .5rem}
button.ghost{background:#fff;color:#244A99;border:1px solid #dbe2ef;box-shadow:none}
button.ghost:hover{background:#f5f8ff}
button:disabled{background:#eef1f6;color:#94a3b8;cursor:default;box-shadow:none}
.alt{margin-top:.9rem;text-align:center;font-size:var(--fs-micro)}
.alt a{color:#64748b}
/* البديل زرٌّ لا حاشية. كان رمادياً صغيراً بلا إطار فبدا تعليقاً — والمالك نفسه لم يتبيّن أنه
   يُضغط، وهو المسار الوحيد للدخول ما دامت قناة البريد معطّلة. يُنسَّق كزرٍّ ثانوي صريح. */
.alt2{margin-top:1.1rem;border-top:1px solid #eef1f6;padding-top:.9rem}
.alt2 summary{cursor:pointer;list-style:none;display:block;width:100%;padding:.6rem;
  border:1px solid #dbe2ef;border-radius:11px;background:#fff;color:#244A99;
  font-size:13px;font-weight:700;text-align:center;user-select:none}
.alt2 summary::-webkit-details-marker{display:none}
.alt2 summary:hover{background:#f5f8ff;border-color:#c3d0ea}
.alt2[open] summary{margin-bottom:.2rem;background:#f5f8ff}
</style></head>
<body>
<img class="motif" src="/static/brand/values.svg" alt="">
<div class="card">
  <img class="logo" src="/static/brand/logo-color.svg" alt="رؤية الخبراء الاستشارية">
  <div class="sub">منصة سند · نظام تشغيل الأعمال</div>
  <div class="sub2">لوحة القيادة، الفرص، المشاريع، والفريق في مكان واحد</div>
  ${info ? `<div class="note" role="status">${esc(info)}</div>` : ''}
  ${err ? `<div class="err" role="alert">${esc(err)}</div>` : ''}
  ${noteOut ? `<div class="ok" role="alert">${noteOut}</div>` : ''}
  ${inner}
  <div class="foot">رؤية الخبراء الاستشارية · EVC Consulting</div>
</div></body></html>`;
}
