// Uniform error envelope + typed HTTP errors.
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (msg, d) => new HttpError(400, 'bad_request', msg || 'طلب غير صالح', d);
export const unauthorized = (msg) => new HttpError(401, 'unauthorized', msg || 'يلزم تسجيل الدخول');
export const forbidden = (msg) => new HttpError(403, 'forbidden', msg || 'صلاحيتك لا تسمح بهذا الإجراء');
export const notFound = (msg) => new HttpError(404, 'not_found', msg || 'غير موجود');
export const conflict = (msg) => new HttpError(409, 'conflict', msg || 'تعارض');

// تهريب نص الخطأ قبل حقنه في الصفحة. لا مسار اليوم يضع مدخلات المستخدم في رسالة صفحة، لكن
// الرسائل تُكتب بقوالب نصية، فأول `badRequest(\`… ${'${'}userInput}\`)` على مسار صفحة يتحول إلى
// ثغرة انعكاسية. سطر واحد يغلق الباب قبل أن يُفتح بدل انتظار من يفتحه.
const escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function errorPage(status, message) {
  const title = status === 404 ? 'الصفحة غير موجودة' : status === 403 ? 'صلاحيتك لا تسمح' : 'حدث خطأ';
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — سند</title>
<style>body{margin:0;font-family:system-ui,'Segoe UI',Tahoma,sans-serif;background:#0f172a;color:#e2e8f0;
display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
.card{background:#1e293b;border:1px solid #334155;border-radius:20px;padding:48px 40px;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
.code{font-size:56px;font-weight:800;background:linear-gradient(120deg,#2563eb,#9333ea);-webkit-background-clip:text;background-clip:text;color:transparent}
h1{font-size:20px;margin:8px 0 12px}p{color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 24px}
a{display:inline-block;background:linear-gradient(120deg,#2563eb,#9333ea);color:#fff;text-decoration:none;
padding:11px 28px;border-radius:12px;font-weight:600;font-size:14px}</style></head>
<body><div class="card"><div class="code">${status}</div><h1>${title}</h1>
<p>${escHtml(message)}</p><a href="/">العودة إلى الرئيسية</a></div></body></html>`;
}

export function errorHandler() {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    // Never leak internal 500 details to the client; typed <500 errors carry safe Arabic messages.
    const safeMessage = status >= 500 ? 'حدث خطأ غير متوقع، تم تسجيله. حاول مجددًا.' : (err.message || 'طلب غير صالح');
    const wantsHtml = !req.originalUrl.startsWith('/api') && (req.accepts?.(['html', 'json']) === 'html' || (req.get?.('accept') || '').includes('text/html'));
    if (wantsHtml) {
      return res.status(status).type('html').send(errorPage(status, safeMessage));
    }
    res.status(status).json({
      error: { code: err.code || 'internal', message: safeMessage, details: status >= 500 ? null : (err.details || null) },
    });
  };
}
