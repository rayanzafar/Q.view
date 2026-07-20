// Auth pages.

export function loginPage(err) {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>دخول — سند</title>
<script src="/static/tailwind.js"></script></head>
<body class="min-h-screen flex items-center justify-center p-4" style="background:linear-gradient(168deg,#11295c,#1c2a63 42%,#3a1660);font-family:'Segoe UI',Tahoma,sans-serif">
<form method="post" action="/auth/login-web" class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
  <div class="text-center mb-6">
    <div class="text-2xl font-extrabold" style="background:linear-gradient(120deg,#2563eb,#9333ea);-webkit-background-clip:text;background-clip:text;color:transparent">EVC · سند</div>
    <div class="text-sm font-bold text-slate-700 mt-2">منصة إدارة الأعمال المؤسسية</div>
    <div class="text-xs text-slate-400 mt-0.5">رؤية الخبراء الاستشارية</div>
  </div>
  ${err ? `<div class="text-xs text-red-600 mb-3 text-center bg-red-50 rounded-lg py-2">${err}</div>` : ''}
  <label class="block text-xs text-slate-500 mb-1">اسم المستخدم</label>
  <input name="username" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 mb-3 text-sm" placeholder="firstname.lastname" autofocus>
  <label class="block text-xs text-slate-500 mb-1">كلمة المرور</label>
  <input name="password" type="password" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 mb-4 text-sm">
  <button class="w-full py-2.5 rounded-lg text-white font-semibold text-sm" style="background:linear-gradient(120deg,#2563eb,#9333ea)">دخول</button>
</form></body></html>`;
}
