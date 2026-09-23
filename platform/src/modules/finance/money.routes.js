// مسارات «صورة المال على المشروع» ومصروفاته.
// Router مستقل يُركَّب بسطر واحد داخل api.routes.js (جلسة التكامل): apiRouter.use(moneyRouter);
// — موضعه تحت /api المُصادَق عليه، فـrequireAuth يعمل هناك. لا فحص صلاحية هنا: كل قرار وصول
// يُتخذ داخل الخدمة على صف المشروع نفسه (finance.js / expenses.js)، والمعالج هنا نقلٌ لا أكثر.
import { Router } from 'express';
import { projectMoney } from './finance.js';
import { listProjectExpenses, createExpense, updateExpense, deleteExpense } from './expenses.js';
import { exportIncomeStatement } from './income-statement.js';
import { exportCommandCenter } from './command-center-export.js';

export const moneyRouter = Router();
const h = (fn) => async (req, res, next) => {
  try { const r = await fn(req); if (r !== undefined) res.json(r); } catch (e) { next(e); }
};
// اسمُ الملفّ يصل باسمين: لاتينيٌّ آمن لمن لا يفهم متصفّحه العربية، وعربيٌّ مرمَّز لمن يفهمها.
const safeName = (s) => String(s || '').replace(/[^\w.-]/g, '_').slice(0, 80);
const rfc5987 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// الحمولة المركّبة لصفحة المشروع: الداخل والخارج النقدي والمصروفات والتسكين بالنسب الشهرية.
moneyRouter.get('/projects/:id/money', h((req) => projectMoney(req.ctx.user, req.params.id, { year: req.query.year })));

// سجل المصروفات: عرض وتسجيل وتعديل وحذف ناعم — كلها مُدقَّقة داخل الخدمة.
moneyRouter.get('/projects/:id/expenses', h((req) => listProjectExpenses(req.ctx.user, req.params.id)));
moneyRouter.post('/projects/:id/expenses', h((req) => createExpense(req.ctx, req.params.id, req.body || {})));
moneyRouter.patch('/finance/expenses/:id', h((req) => updateExpense(req.ctx, req.params.id, req.body || {})));
moneyRouter.delete('/finance/expenses/:id', h((req) => deleteExpense(req.ctx, req.params.id)));

// ── قائمة دخل القطاع ملفَّ Excel ────────────────────────────────────────────────
// القطاع من المسار لا من الاستعلام: `:id` يعلو على `?sector=` فلا يحمل الرابط قطاعين.
// و«لا يُخزَّن» لأن الورقة مالُ قطاعٍ بحاله: لا تُترك في ذاكرة وسيطٍ ولا في قرص المتصفّح.
moneyRouter.get('/sectors/:id/income-statement.xlsx', async (req, res, next) => {
  try {
    const { buffer, mime, fileName } = await exportIncomeStatement(req.ctx, { ...req.query, sector: req.params.id });
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition',
      `attachment; filename="sector-${safeName(req.params.id)}-income-statement.xlsx"; filename*=UTF-8''${rfc5987(fileName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  } catch (e) { next(e); }
});

// ── مركز القطاع كلُّه ملفَّ Excel ────────────────────────────────────────────────
// ستّ أوراقٍ هي فصول الشاشة نفسها، من الحمولة المُرشَّحة بالصلاحية ذاتها — فما لا يُرى
// على الشاشة لا يخرج في الملفّ. والترويسات ترويسات أختها: القطاع من المسار، و«لا يُخزَّن».
moneyRouter.get('/sectors/:id/command-center.xlsx', async (req, res, next) => {
  try {
    const { buffer, mime, filename } = await exportCommandCenter(req.ctx, { ...req.query, sector: req.params.id });
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition',
      `attachment; filename="sector-${safeName(req.params.id)}-command-center.xlsx"; filename*=UTF-8''${rfc5987(filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  } catch (e) { next(e); }
});
