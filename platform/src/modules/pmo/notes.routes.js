// موجّه دفتر الملاحظات الشخصي — رقيق: قراءة الطلب ⟵ نداء الخدمة ⟵ ردّ.
// مركَّب تحت /api من api.routes.js، و`requireAuth` يعمل عند نقطة التركيب فـ`req.ctx.user`
// حاضرٌ دائماً هنا. الملكية والتدقيق داخل الخدمة وحدها — لا فحص في هذا الملف إطلاقاً،
// كي لا يوجد بابان للحكم على الملاحظة نفسها.
import { Router } from 'express';
import * as notes from './notes.js';

export const notesRouter = Router();
const h = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };

notesRouter.get('/notes', h((req) => notes.myNotes(req.ctx.user, req.query || {})));
notesRouter.post('/notes', h((req) => notes.createNote(req.ctx, req.body || {})));
notesRouter.patch('/notes/:id', h((req) => notes.updateNote(req.ctx, req.params.id, req.body || {})));
notesRouter.delete('/notes/:id', h((req) => notes.deleteNote(req.ctx, req.params.id)));
