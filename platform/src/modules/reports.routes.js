// موجّه تقارير الفترة — يُركَّب داخل apiRouter بعد requireAuth().
// كل الصلاحيات تُفحص داخل `core/reports/periods.js` (حارس لكل عدسة)، والمسار هنا نقل لا قرار.
import { Router } from 'express';
import {
  buildPeriodReport, renderPeriodReport, savePeriodSnapshot, listPeriodSnapshots,
  readPeriodSnapshot, comparePreviousSnapshot, lensOptions, periodChoices,
  PERIOD_KINDS, PERIOD_LABELS_AR, LENSES, LENS_LABELS_AR,
} from '../core/reports/periods.js';

export const reportsRouter = Router();

// معاملات الطلب من الشاشة أو من الرابط المباشر — أسماء واحدة في الصفحة والمسار.
const readOpts = (src = {}) => ({
  period: src.period || src.kind || 'week',
  anchor: src.anchor || src.date || undefined,
  lens: src.lens || 'company',
  targetId: src.targetId || src.target || null,
});

// صفحة خطأ عربية للمسارات التي يفتحها المتصفح مباشرةً (الإصدار والنسخ المحفوظة):
// ردّ بصيغة بيانات هنا يعني نصاً تقنياً في وجه المستخدم، وهو ممنوع.
function htmlNotice(res, status, message) {
  return res.status(status).type('html').send(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>تعذّر إصدار التقرير</title></head>
<body style="margin:0;background:#f6f7fb;font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;display:grid;place-items:center;min-height:100vh">
<div style="background:#fff;border:1px solid #e6e9f0;border-radius:16px;padding:2rem 2.4rem;max-width:420px;text-align:center">
<div style="font-size:15px;font-weight:800;color:#1e293b;margin-bottom:.5rem">تعذّر إصدار التقرير</div>
<div style="font-size:12.5px;color:#5b6472;line-height:1.9">${String(message || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</div>
<a href="/app/reports" style="display:inline-block;margin-top:1.2rem;background:#244A99;color:#fff;border-radius:10px;padding:.5rem 1.1rem;font-size:12.5px;font-weight:700;text-decoration:none">العودة إلى التقارير</a>
</div></body></html>`);
}

// قوائم الاختيار: أنواع الفترات وفتراتها الجاهزة + العدسات المتاحة لهذا القارئ.
reportsRouter.get('/reports/period/options', async (req, res, next) => {
  try {
    res.json({
      periods: PERIOD_KINDS.map((k) => ({ key: k, label_ar: PERIOD_LABELS_AR[k], choices: periodChoices(k) })),
      lenses: LENSES.map((k) => ({ key: k, label_ar: LENS_LABELS_AR[k] })),
      options: await lensOptions(req.ctx.user),
    });
  } catch (e) { next(e); }
});

// التقرير كبيانات (تستهلكه الشاشة والاختبارات وأي تكامل لاحق).
reportsRouter.get('/reports/period', async (req, res, next) => {
  try { res.json(await buildPeriodReport(req.ctx.user, readOpts(req.query))); }
  catch (e) { next(e); }
});

// مقارنة بالفترة السابقة إن كانت لها نسخة محفوظة (وإلا رسالة صريحة بلا أرقام مخترعة).
reportsRouter.get('/reports/period/compare', async (req, res, next) => {
  try {
    const report = await buildPeriodReport(req.ctx.user, readOpts(req.query));
    res.json(await comparePreviousSnapshot(req.ctx.user, report));
  } catch (e) { next(e); }
});

// النسخ المحفوظة لهذه العدسة وهذا الهدف.
reportsRouter.get('/reports/period/snapshots', async (req, res, next) => {
  try { res.json({ snapshots: await listPeriodSnapshots(req.ctx.user, readOpts(req.query)) }); }
  catch (e) { next(e); }
});

// فتح نسخة محفوظة كما صدرت (الصلاحية تُفحص من جديد على عدسة النسخة).
reportsRouter.get('/reports/period/snapshot/:id', async (req, res) => {
  try {
    const snap = await readPeriodSnapshot(req.ctx.user, req.params.id);
    res.type('html').send(snap.html);
  } catch (e) { htmlNotice(res, e.status || 500, e.status ? e.message : 'تعذّر فتح النسخة المحفوظة. حدّث الصفحة وحاول مجدداً.'); }
});

// إصدار التقرير: يبني ويحفظ نسخة في سجل النسخ ثم يعيد المستند للطباعة أو الحفظ.
// الحفظ عند الإصدار لا عند العرض: عرض الشاشة قراءة، والإصدار فعلٌ مقصود يستحق أثراً في السجل.
reportsRouter.post('/reports/period/issue', async (req, res) => {
  try {
    const opts = readOpts({ ...req.body, ...req.query });
    const saved = await savePeriodSnapshot(req.ctx, opts);
    if ((req.body || {}).format === 'json' || (req.query || {}).format === 'json') {
      return res.json({ ok: true, id: saved.id, period_label: saved.period_label, created_at: saved.created_at });
    }
    res.type('html').send(saved.html);
  } catch (e) { htmlNotice(res, e.status || 500, e.status ? e.message : 'تعذّر إصدار التقرير الآن. حاول مجدداً.'); }
});

// معاينة المستند للطباعة بلا حفظ نسخة (رابط مباشر من الشاشة).
reportsRouter.get('/reports/period/print', async (req, res) => {
  try {
    const report = await buildPeriodReport(req.ctx.user, readOpts(req.query));
    res.type('html').send(renderPeriodReport(report).html);
  } catch (e) { htmlNotice(res, e.status || 500, e.status ? e.message : 'تعذّر عرض التقرير الآن. حاول مجدداً.'); }
});
