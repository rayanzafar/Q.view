// مسارات «صورة المال على المشروع» ومصروفاته.
// Router مستقل يُركَّب بسطر واحد داخل api.routes.js (جلسة التكامل): apiRouter.use(moneyRouter);
// — موضعه تحت /api المُصادَق عليه، فـrequireAuth يعمل هناك. لا فحص صلاحية هنا: كل قرار وصول
// يُتخذ داخل الخدمة على صف المشروع نفسه (finance.js / expenses.js)، والمعالج هنا نقلٌ لا أكثر.
import { Router } from 'express';
import { projectMoney } from './finance.js';
import { listProjectExpenses, createExpense, updateExpense, deleteExpense } from './expenses.js';

export const moneyRouter = Router();
const h = (fn) => async (req, res, next) => {
  try { const r = await fn(req); if (r !== undefined) res.json(r); } catch (e) { next(e); }
};

// الحمولة المركّبة لصفحة المشروع: الداخل والخارج النقدي والمصروفات والتسكين بالنسب الشهرية.
moneyRouter.get('/projects/:id/money', h((req) => projectMoney(req.ctx.user, req.params.id, { year: req.query.year })));

// سجل المصروفات: عرض وتسجيل وتعديل وحذف ناعم — كلها مُدقَّقة داخل الخدمة.
moneyRouter.get('/projects/:id/expenses', h((req) => listProjectExpenses(req.ctx.user, req.params.id)));
moneyRouter.post('/projects/:id/expenses', h((req) => createExpense(req.ctx, req.params.id, req.body || {})));
moneyRouter.patch('/finance/expenses/:id', h((req) => updateExpense(req.ctx, req.params.id, req.body || {})));
moneyRouter.delete('/finance/expenses/:id', h((req) => deleteExpense(req.ctx, req.params.id)));
