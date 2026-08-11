// SSR page routes + web-form auth handlers + report preview.
import { Router } from 'express';
import { login, logout } from '../core/auth/service.js';
import { requestCode, verifyCode, normalizeEmail, REASON as OTP_REASON } from '../core/auth/otp.js';
import { config } from '../core/config.js';
import * as P from './pages.js';
import { pageAllowed, DETAIL_ACCESS } from './nav.js';
import { buildReport, renderReport, enqueueReport, createSchedule, setScheduleActive, deleteSchedule } from '../core/reports/engine.js';
import { canSeeSensitive } from '../core/rbac/index.js';
import { resolveUser } from '../core/http/context.js';

export const webRouter = Router();

function requireWeb(req, res, next) {
  if (!req.ctx?.user) return res.redirect('/login');
  next();
}

// e=1 بيانات خاطئة · e=2 تجاوز عدد المحاولات — رسالتان مختلفتان لأن العلاج مختلف: الأولى
// تُراجَع فيها الكلمة، والثانية تُنتظَر. وخلطهما يجعل الموظف يعيد المحاولة فيطيل حظره.
// و٣ إلى ٥ للرمز: منتهٍ (يُطلب جديد) · غير صحيح (يُعاد الإدخال) · استُنفدت المحاولات (يُطلب جديد).
const LOGIN_ERRORS = {
  1: 'بيانات الدخول غير صحيحة',
  2: 'محاولات كثيرة خلال وقت قصير — انتظر دقيقة ثم أعد المحاولة',
  3: 'انتهت صلاحية الرمز — اطلب رمزاً جديداً',
  4: 'الرمز غير صحيح — تحقّق من الأرقام الستة وأعد الإدخال',
  5: 'استُنفدت محاولات هذا الرمز — اطلب رمزاً جديداً',
  6: 'هذا الحساب موقوف — راجع مدير النظام',
};

// البريد المعلَّق بين الخطوتين يعيش في كعكة قصيرة العمر لا في المسار: وضعُه في العنوان يُبقيه
// في سجل المتصفح وفي ترويسة المُحيل — وبريد الموظف ليس شيئاً يُنثر في السجلات.
const PENDING_EMAIL_COOKIE = 'sanad_otp_to';
const pendingCookieOpts = { httpOnly: true, sameSite: 'lax', secure: config.env === 'production', maxAge: 15 * 60000, path: '/' };
// النموذج المطلوب: لا كلمة مرور إطلاقاً — رمزٌ مؤقّت على البريد في كل مرة. لكن تنفيذه بمفتاح
// يُضبط يدوياً يفتح باب خطأ واحد قاتل: أن يُطفأ الدخول بكلمة المرور قبل أن تعمل قناة البريد،
// فتُقفل المنصة على أهلها بباب لا يُفتح.
//
// فالقرار يتبع الواقع لا الإعداد: كلمة المرور تُغلق **تلقائياً** متى كانت قناة البريد حقيقية،
// وتبقى مفتوحة ما دامت القناة في وضع المعاينة (أي لا رمز يصل أحداً). ويبقى المفتاح الصريح
// `SANAD_AUTH_PASSWORD=1|0` لمن أراد تجاوز ذلك في الاتجاهين.
const passwordLoginEnabled = () => {
  const forced = process.env.SANAD_AUTH_PASSWORD;
  if (forced === '1') return true;
  if (forced === '0') return false;
  return config.mailTransport !== 'smtp';     // قناةٌ حقيقية ⇒ الرمز وحده
};

webRouter.get('/login', (req, res) => {
  if (req.query.reset) { res.clearCookie(PENDING_EMAIL_COOKIE, { path: '/' }); return res.redirect('/login'); }
  const pending = req.cookies?.[PENDING_EMAIL_COOKIE] || '';
  res.send(P.loginPage({
    err: LOGIN_ERRORS[req.query.e] || '',
    step: pending ? 'code' : 'email',
    email: pending,
    passwordEnabled: passwordLoginEnabled(),
    csrf: req.csrfToken,
  }));
});

// طلب الرمز — الردّ واحدٌ دائماً: ننتقل إلى خطوة الرمز سواء كان للبريد حسابٌ أم لا. أي فرقٍ
// هنا (رسالة، أو تحويلة، أو حتى تأخّر ملحوظ) يحوّل الشاشة إلى أداةٍ تكشف من يعمل في EVC.
webRouter.post('/auth/otp/request-web', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email || req.cookies?.[PENDING_EMAIL_COOKIE] || '');
    if (!email || !email.includes('@')) return res.redirect('/login');
    await requestCode({ email, ip: req.ip });
    res.cookie(PENDING_EMAIL_COOKIE, email, pendingCookieOpts);
    res.redirect('/login');
  } catch (e) { next(e); }
});

webRouter.post('/auth/otp/verify-web', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.cookies?.[PENDING_EMAIL_COOKIE] || '');
    if (!email) return res.redirect('/login');
    const r = await verifyCode({ email, code: req.body.code, ip: req.ip, userAgent: req.get('user-agent') });
    if (!r.ok) {
      const code = { [OTP_REASON.EXPIRED]: 3, [OTP_REASON.INVALID]: 4, [OTP_REASON.ATTEMPTS]: 5, [OTP_REASON.INACTIVE]: 6 }[r.reason] || 4;
      return res.redirect('/login?e=' + code);
    }
    res.clearCookie(PENDING_EMAIL_COOKIE, { path: '/' });
    res.cookie(config.sessionCookie, r.sessionId, { httpOnly: true, sameSite: 'lax', secure: config.env === 'production', maxAge: config.sessionTtlHours * 3600000, path: '/' });
    res.redirect('/app/' + landingFor(await resolveUser(r.sessionId)));
  } catch (e) { next(e); }
});

// الدخول بكلمة المرور — يبقى خلف مفتاح حتى يثبت الرمز حياً في الاستعمال. إطفاءُ المسار
// الوحيد للدخول قبل إثبات بديله هو كيف تُقفَل منصةٌ على أهلها.
webRouter.post('/auth/login-web', async (req, res, next) => {
  try {
    if (!passwordLoginEnabled()) return res.redirect('/login');
    const r = await login({ username: req.body.username, password: req.body.password, ip: req.ip, userAgent: req.get('user-agent') });
    if (!r.ok) return res.redirect('/login?e=1');
    res.cookie(config.sessionCookie, r.sessionId, { httpOnly: true, sameSite: 'lax', secure: config.env === 'production', maxAge: config.sessionTtlHours * 3600000, path: '/' });
    res.redirect('/app/' + landingFor(await resolveUser(r.sessionId)));
  } catch (e) { next(e); }
});

webRouter.post('/auth/logout-web', async (req, res, next) => {
  try {
    await logout(req.cookies?.[config.sessionCookie]);
    res.clearCookie(config.sessionCookie, { path: '/' });
    res.redirect('/login');
  } catch (e) { next(e); }
});

// وجهة الدخول: **صفحتي** للجميع.
//
// كانت تُحسب من الصلاحيات — لوحة القيادة لمن نطاقه شركي، فمركز القطاع، فـ«مهامي» قاعاً آمناً.
// وكان ذلك صحيحاً حين لم تكن هناك شاشة تخصّ الشخص: أفضل ما يُهبَط عليه شاشةٌ يملك بياناتها.
// أما الآن فـ«صفحتي» تُجيب سؤال الصباح لكل من يدخل («ماذا عليّ اليوم؟»)، وهي مفتوحة للجميع
// لأن كل ما فيها مقيَّد بصاحبها. والقيادة تبلغ لوحتها من القائمة الجانبية بنقرة — بينما
// المساهم الفردي كان يبلغ شاشته الشخصية بلا طريق أصلاً.
//
// والتحوّط باقٍ: إن أُغلقت «صفحتي» يوماً بقرار سياسة، تعود الوجهة إلى ما كانت عليه بالضبط.
export function landingFor(user) {
  if (!user) return 'tasks';
  if (pageAllowed(user, 'home')) return 'home';
  if (pageAllowed(user, 'ceo')) return 'ceo';                       // نطاق شركي → لوحة القيادة
  // «مركز القطاع» صفحة إدارة: تُناسب من نطاقه قطاع فأوسع، لا المساهم الفردي الذي بيته «مهامي».
  const managesScope = user.scope === 'sector' || user.scope === 'company';
  if (managesScope && pageAllowed(user, 'sector')) return 'sector';
  return 'tasks';                                                    // القاع الآمن — مفتوح للجميع
}
webRouter.get('/', (req, res) => res.redirect(req.ctx?.user ? '/app/' + landingFor(req.ctx.user) : '/login'));

const PAGES = {
  home: P.homePage,
  ceo: P.ceoPage, portfolio: P.portfolioPage, sector: P.sectorPage, opportunities: P.opportunitiesPage,
  'my-opportunities': P.myOpportunitiesPage,
  projects: P.projectsPage, tasks: P.tasksPage, timesheet: P.timesheetPage, approvals: P.approvalsPage,
  team: P.teamPage, staffing: P.staffingPage, users: P.usersPage, audit: P.auditPage, reports: P.reportsPage, org: P.orgTreePage,
  finance: P.financePage, mail: P.mailPage, clients: P.clientsPage, imports: P.importsPage,
  guide: P.guidePage,
};

// معاينة رسالة من صندوق المعاينة — بنفس صلاحية صفحة مركز البريد
webRouter.get('/app/mail/preview/:file', requireWeb, (req, res) => {
  if (!pageAllowed(req.ctx.user, 'mail')) return deny(res);
  const html = P.outboxFileHtml(req.params.file);
  if (html == null) return res.status(404).send('الرسالة غير موجودة');
  // محتوى مخزَّن (صادرات البريد) يُعرَض من أصل التطبيق — نمنع تنفيذ أي نص برمجي بداخله حتى لو
  // فُتح الرابط مباشرةً لا داخل الإطار المعزول: توجيه sandbox في الرأس يجعل المتصفّح يعزله.
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data: https:");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type('html').send(html);
});

// رفض موحّد: صفحة 403 عربية واضحة (نفس مسار أخطاء HTML في errors.js)
function deny(res) {
  return res.status(403).send(`<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><body style="font-family:'IBM Plex Sans Arabic','Segoe UI',sans-serif;background:#f6f7fb;display:grid;place-items:center;min-height:100vh;margin:0"><div style="background:#fff;border:1px solid #e6e9f0;border-radius:16px;padding:2rem 2.4rem;text-align:center;max-width:380px"><div style="font-size:15px;font-weight:800;color:#1e293b;margin-bottom:.4rem">هذه الصفحة خارج صلاحياتك</div><div style="font-size:12.5px;color:#64748b;line-height:1.9">دورك الحالي لا يشمل هذا القسم. إن كنت تحتاجه فاطلب تفعيله من مدير النظام.</div><a href="/app/tasks" style="display:inline-block;margin-top:1rem;background:#244A99;color:#fff;border-radius:10px;padding:.5rem 1.1rem;font-size:12.5px;font-weight:700;text-decoration:none">العودة إلى مهامي</a></div></body></html>`);
}
const guardDetail = (kind) => (req, res, next) => (DETAIL_ACCESS[kind]?.(req.ctx.user) ? next() : deny(res));

webRouter.get('/app/contract/:id', requireWeb, guardDetail('contract'), async (req, res, next) => {
  try { res.send(await P.contractDetailPage(req.ctx.user, req.params.id)); } catch (e) { next(e); }
});
// الاستعلام يُمرَّر كما تفعل صفحات القوائم (`/app/:page` أدناه) — فسنة «حركة المال» تصير
// قابلة للمشاركة برابط. وبدونه كانت الصفحة تُبنى بلا استعلام أصلاً، فالمبدِّل يعمل داخل
// الصفحة والرابط لا يحمل شيئاً — وهو نمطُ «مبنيٌّ وغير موصول» نفسه الذي أوقع موجّه المال
// من قبل: الشيء موجود ومختبَر ولا يبلغه المستخدم.
webRouter.get('/app/project/:id', requireWeb, guardDetail('project'), async (req, res, next) => {
  try { res.send(await P.projectDetailPage(req.ctx.user, req.params.id, { ...req.query })); } catch (e) { next(e); }
});
webRouter.get('/app/opportunity/:id', requireWeb, guardDetail('opportunity'), async (req, res, next) => {
  // ‎{...req.query}‎ كمسار المشروع أعلاه — كان يُسقَط هنا فتموت روابط «عودة إلى مرشِّحاتك»
  // (?from=) في التشغيل الحي رغم خضرة اختبارها الذي يستدعي الدالة مباشرة، ولا يصل ?tab=.
  try { res.send(await P.opportunityDetailPage(req.ctx.user, req.params.id, { ...req.query })); } catch (e) { next(e); }
});
webRouter.get('/app/client/:id', requireWeb, guardDetail('client'), async (req, res, next) => {
  try { res.send(await P.clientDetailPage(req.ctx.user, req.params.id)); } catch (e) { next(e); }
});
// صفحة الشخص: بلا guardDetail عمداً — بوابتها ليست «هل يرى هذا النوع من التفاصيل» بل «هل هذا
// الشخص داخل نطاقك»، وهو سؤالٌ لا يُجاب إلا بعد قراءة صفّه. فالخدمة (personDossier) هي البوابة
// وحدها، وترمي رفضاً عربياً واضحاً — ويُفتح ملفُ صاحب الحساب نفسه دائماً بلا أي منح إداري.
webRouter.get('/app/person/:id', requireWeb, async (req, res, next) => {
  try { res.send(await P.personPage(req.ctx.user, req.params.id)); } catch (e) { next(e); }
});

webRouter.get('/app/:page', requireWeb, async (req, res, next) => {
  const fn = PAGES[req.params.page];
  if (!fn) return res.redirect('/app/tasks');
  if (!pageAllowed(req.ctx.user, req.params.page)) return deny(res);
  try { res.send(await fn(req.ctx.user, { ...req.query })); } catch (e) { next(e); }
});

// Report preview (renders template HTML with the caller's redacted data)
webRouter.get('/app/reports/preview/:key', requireWeb, async (req, res, next) => {
  try {
    const data = await buildReport(req.params.key, req.ctx.user, { sectorId: req.ctx.user.sector_id });
    const { html } = await renderReport(req.params.key, data);
    res.send(html);
  } catch (e) { next(e); }
});

// Test-send (enqueues to the preview outbox for the current user)
webRouter.post('/app/reports/test-send/:key', requireWeb, async (req, res, next) => {
  try {
    const ids = await enqueueReport(req.params.key, { recipientUserIds: [req.ctx.user.id], sectorId: req.ctx.user.sector_id });
    res.json({ ok: true, queued: ids.length });
  } catch (e) { next(e); }
});

// Create a report schedule
webRouter.post('/app/reports/schedule', requireWeb, async (req, res, next) => {
  try { res.json(await createSchedule(req.ctx, req.body || {})); }
  catch (e) { next(e); }
});

// إيقاف/تفعيل جدولة قائمة، وحذفها. كانت الجدولة بلا أي مخرج بعد إنشائها إلا التعديل
// المباشر على قاعدة البيانات؛ الصلاحية والنطاق مفحوصان داخل الخدمة لا هنا.
webRouter.post('/app/reports/schedule/:id/active', requireWeb, async (req, res, next) => {
  try { res.json(await setScheduleActive(req.ctx, req.params.id, (req.body || {}).active)); }
  catch (e) { next(e); }
});
webRouter.delete('/app/reports/schedule/:id', requireWeb, async (req, res, next) => {
  try { res.json(await deleteSchedule(req.ctx, req.params.id)); }
  catch (e) { next(e); }
});
