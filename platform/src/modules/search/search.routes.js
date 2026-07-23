// موجّه البحث الشامل — يُركَّب داخل apiRouter بعد requireAuth().
import { Router } from 'express';
import { globalSearch } from './search.js';

export const searchRouter = Router();
searchRouter.get('/search', async (req, res, next) => {
  try { res.json({ results: await globalSearch(req.ctx.user, req.query.q) }); }
  catch (e) { next(e); }
});
