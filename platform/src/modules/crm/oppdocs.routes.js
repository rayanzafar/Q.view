// Opportunity-documents router (contracts §2). Thin: parse → service → JSON.
// Mounted under /api by api.routes.js; requireAuth runs at the /api mount so req.ctx.user
// is always present here. Authorization and audit live in the service, never here.
import express, { Router } from 'express';
import * as oppdocs from './oppdocs.js';

export const oppdocsRouter = Router();
const h = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };

oppdocsRouter.get('/opportunities/:id/documents', h((req) => oppdocs.opportunityDocuments(req.ctx.user, req.params.id)));
oppdocsRouter.post('/opportunities/:id/documents', h((req) => oppdocs.addOpportunityDocument(req.ctx, req.params.id, req.body || {})));
oppdocsRouter.delete('/opportunities/documents/:docId', h((req) => oppdocs.deleteOpportunityDocument(req.ctx, req.params.docId)));

// رفع ملف: جسم خام حتى 15MB + الاسم في ترويسة x-file-name (مرمّزاً — الترويسات ASCII فقط)،
// والنوع من نوع المستند في الاستعلام. نفس نمط محرك الاستيراد حرفياً (io.routes.js).
oppdocsRouter.post('/opportunities/:id/documents/upload', express.raw({ type: '*/*', limit: '15mb' }),
  h((req) => oppdocs.uploadOpportunityFile(req.ctx, req.params.id, {
    fileName: decodeFileName(req.get('x-file-name')),
    bytes: req.body,
    kind: (req.query.kind || '').toString(),
    note: (req.query.note || '').toString(),
  })));

// التنزيل: بايتات بترويسة تنزيل آمنة — لا JSON هنا، والتفويض داخل الخدمة كسائر المسارات.
oppdocsRouter.get('/opportunities/documents/:docId/download', async (req, res, next) => {
  try {
    const f = await oppdocs.readOpportunityFileForDownload(req.ctx.user, req.params.docId);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.send(f.content);
  } catch (e) { next(e); }
});

function decodeFileName(v) {
  if (!v) return '';
  try { return decodeURIComponent(v); } catch { return String(v); }
}
