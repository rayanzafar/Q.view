import { Router } from 'express';
import { requireAuth } from '../core/http/context.js';
import { ask, applyChange, aiStatus } from '../core/ai/assistant.js';

export const aiRouter = Router();
aiRouter.use(requireAuth());

aiRouter.get('/status', (req, res) => res.json(aiStatus()));

aiRouter.post('/chat', async (req, res, next) => {
  try { res.json(await ask(req.ctx, req.body?.message, req.body?.opts || {})); }
  catch (e) { next(e); }
});

// Apply a previously previewed change — permission re-checked inside applyChange.
aiRouter.post('/apply', (req, res, next) => {
  try { res.json(applyChange(req.ctx, req.body?.applyToken)); }
  catch (e) { next(e); }
});
