// روابط المساعد كما يراها صاحبها: قائمةٌ وقطع. لا إنشاء هنا — الربط يبدأ من المساعد نفسه
// ويمرّ بشاشة الإذن، فلا طريق ثانٍ يصنع رمزاً بلا إذنٍ مقروء.
import { Router } from 'express';
import { requireAuth } from '../../core/http/context.js';
import { listConnections, revokeConnection } from './oauth.js';

export const mcpApiRouter = Router();
mcpApiRouter.use(requireAuth());

mcpApiRouter.get('/connections', async (req, res, next) => {
  try { res.json({ connections: await listConnections(req.ctx.user) }); } catch (e) { next(e); }
});

// القطع فعلٌ على صفّ المستخدم نفسه: الخدمة تتحقق أن الربط له هو قبل أن تُبطل شيئاً.
mcpApiRouter.delete('/connections/:clientId', async (req, res, next) => {
  try { res.json(await revokeConnection(req.ctx, req.params.clientId)); } catch (e) { next(e); }
});
