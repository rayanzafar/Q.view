// مسارات إدارة لوحات الفرص ومراحلها وتصنيفاتها — سطحٌ واحد بحارسٍ واحد (`crm_board`).
import { Router } from 'express';
import * as boards from './boards.js';

export const boardsRouter = Router();
const h = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };

boardsRouter.get('/crm/boards', h((req) => boards.listBoards(req.ctx.user, { includeArchived: req.query.archived === '1' })));
boardsRouter.post('/crm/boards', h((req) => boards.createBoard(req.ctx, req.body || {})));
boardsRouter.patch('/crm/boards/:id', h((req) => boards.updateBoard(req.ctx, req.params.id, req.body || {})));
boardsRouter.delete('/crm/boards/:id', h((req) => boards.deleteBoard(req.ctx, req.params.id, { moveStagesTo: (req.body || {}).moveStagesTo })));

boardsRouter.post('/crm/stages', h((req) => boards.createStage(req.ctx, req.body || {})));
boardsRouter.patch('/crm/stages/:id', h((req) => boards.updateStage(req.ctx, req.params.id, req.body || {})));
// الترتيب قبل «:id» في الملف لا يهمّ (المسار مختلف)، لكنه يبقى نداءً واحداً لكل السحب والإفلات.
boardsRouter.post('/crm/stages/reorder', h((req) => boards.reorderStages(req.ctx, (req.body || {}).order)));
boardsRouter.delete('/crm/stages/:id', h((req) => boards.deleteStage(req.ctx, req.params.id, { moveToStageId: (req.body || {}).moveToStageId })));

boardsRouter.get('/crm/tags', h((req) => boards.listTags(req.ctx.user, { includeArchived: req.query.archived === '1' })));
boardsRouter.post('/crm/tags', h((req) => boards.createTag(req.ctx, req.body || {})));
boardsRouter.patch('/crm/tags/:id', h((req) => boards.updateTag(req.ctx, req.params.id, req.body || {})));
boardsRouter.delete('/crm/tags/:id', h((req) => boards.deleteTag(req.ctx, req.params.id)));
boardsRouter.put('/opportunities/:id/tags', h((req) => boards.setOpportunityTags(req.ctx, req.params.id, (req.body || {}).tags)));
