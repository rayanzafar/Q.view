// صفحة الدخول — هوية EVC الرسمية: الشعار الحقيقي، التدرج الرسمي أزرق→بنفسجي،
// معيّن القيم كعنصر خلفية هادئ، وخط IBM Plex Sans Arabic.
export function loginPage(err) {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>دخول · منصة سند EVC</title>
<link rel="icon" type="image/svg+xml" href="/static/brand/favicon.svg">
<style>
@font-face{font-family:'IBM Plex Sans Arabic';src:url('/static/fonts/IBMPlexSansArabic-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'IBM Plex Sans Arabic';src:url('/static/fonts/IBMPlexSansArabic-Medium.woff2') format('woff2');font-weight:500 700;font-display:swap}
@font-face{font-family:'IBM Plex Sans Arabic';src:url('/static/fonts/IBMPlexSansArabic-Bold.woff2') format('woff2');font-weight:800;font-display:swap}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem;
  background:linear-gradient(160deg,#182c56 0%,#244A99 48%,#56316b 100%);
  font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;line-height:1.7;position:relative;overflow:hidden}
.motif{position:absolute;inset-inline-start:-90px;bottom:-90px;width:420px;opacity:.10;pointer-events:none;filter:brightness(4)}
.card{position:relative;background:#fff;border-radius:20px;box-shadow:0 30px 80px rgba(10,18,40,.45);padding:2.2rem 2rem 2rem;width:100%;max-width:380px}
.logo{width:210px;max-width:80%;display:block;margin:0 auto}
.sub{text-align:center;font-size:13px;font-weight:700;color:#1e293b;margin-top:1.1rem}
.sub2{text-align:center;font-size:11.5px;color:#94a3b8;margin-top:.15rem;margin-bottom:1.4rem}
label{display:block;font-size:11.5px;font-weight:700;color:#64748b;margin-bottom:.3rem}
input{width:100%;padding:.65rem .8rem;border:1px solid #e6e9f0;border-radius:11px;font-size:13.5px;font-family:inherit;margin-bottom:.9rem;color:#1e293b}
input:focus{outline:none;border-color:#244A99;box-shadow:0 0 0 3px rgba(36,74,153,.14)}
button{width:100%;padding:.7rem;border:none;border-radius:11px;color:#fff;font-size:13.5px;font-weight:700;font-family:inherit;cursor:pointer;
  background:#244A99;box-shadow:0 10px 24px -8px rgba(16,32,70,.55)}
button:hover{background:#1d3d80}
.err{font-size:12px;color:#991b1b;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:.55rem .8rem;text-align:center;margin-bottom:1rem}
.foot{margin-top:1.2rem;text-align:center;font-size:10.5px;color:#94a3b8}
</style></head>
<body>
<img class="motif" src="/static/brand/values.svg" alt="">
<form method="post" action="/auth/login-web" class="card">
  <img class="logo" src="/static/brand/logo-color.svg" alt="رؤية الخبراء الاستشارية">
  <div class="sub">منصة سند · نظام تشغيل الأعمال</div>
  <div class="sub2">لوحة القيادة، الفرص، المشاريع، الفريق، والمالية في مكان واحد</div>
  ${err ? `<div class="err">${err}</div>` : ''}
  <label>اسم المستخدم</label>
  <input name="username" autocomplete="username" autofocus>
  <label>كلمة المرور</label>
  <input name="password" type="password" autocomplete="current-password">
  <button type="submit">دخول</button>
  <div class="foot">رؤية الخبراء الاستشارية · EVC Consulting</div>
</form></body></html>`;
}
