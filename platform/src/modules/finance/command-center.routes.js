// مسار حمولة «مركز القطاع».
// Router مستقل يُركَّب بسطر واحد داخل api.routes.js (جلسة التكامل): apiRouter.use(commandCenterRouter);
// — بجوار `moneyRouter` وتحت `/api` المُصادَق عليه، فـ`requireAuth` يعمل هناك. ولا فحص صلاحية
// في هذا الملف: القطاع يُحلّ والبوابات تُفحص داخل الخدمة (`command-center.js`) على صفّ القطاع
// نفسه، والمعالج هنا نقلٌ لا أكثر — كما في `money.routes.js` حرفاً.
import { Router } from 'express';
import { buildCommandCenterDataset, resolveCommandCenterSector } from './command-center.js';

export const commandCenterRouter = Router();

// ── حمولة الشاشة كاملةً ──────────────────────────────────────────────────────────
// القطاع من المسار لا من الاستعلام: `:id` يعلو على `?sector=` فلا يحمل الرابط قطاعين —
// وقطاعٌ لا وجود له يُردّ «غير موجود» ولا يسقط صامتاً إلى قطاع القارئ.
// و«لا يُخزَّن» لأن الحمولة مالُ قطاعٍ بحاله مُرشَّحٌ بصلاحية قارئه بعينه: لا تُترك في ذاكرة
// وسيطٍ ولا في قرص المتصفّح حيث يقرؤها حسابٌ آخر على الجهاز نفسه.
commandCenterRouter.get('/sectors/:id/command-center', async (req, res, next) => {
  try {
    const sector = await resolveCommandCenterSector(req.ctx.user, { sector: req.params.id });
    const data = await buildCommandCenterDataset(req.ctx.user, sector.id, { year: req.query.year });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.json(data);
  } catch (e) { next(e); }
});
