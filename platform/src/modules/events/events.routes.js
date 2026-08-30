// موجّه الفعاليات — رقيق: قراءة الطلب ⟵ نداء الخدمة ⟵ ردّ.
// مركَّب تحت /api من api.routes.js، و`requireAuth` يعمل عند نقطة التركيب فـ`req.ctx.user`
// حاضرٌ دائماً هنا. الصلاحيات والملكية والتدقيق داخل الخدمة وحدها — لا فحص في هذا الملف
// إطلاقاً، كي لا يوجد بابان للحكم على البطاقة نفسها.
//
// ترتيب المسارات مقصود: الحرفية («contacts/…»، «partners/…»، «parse-card») قبل «:id» —
// فلا يُقرأ «contacts» يوماً على أنه معرّف فعالية.
//
// والصور (E2) الاستثناء الوحيد من «ردٌّ بحمولة»: تُرفع جسماً خاماً وتُنزَّل بايتاتٍ بترويساتها —
// والترويسات هنا شكلُ النقل لا حكمٌ: النوع من الصفّ الذي شمّته الخدمة، لا من تخمين المتصفّح.
import express, { Router } from 'express';
import * as ev from './events.js';
import * as mt from './meetings.js';
import { badRequest } from '../../core/http/errors.js';

export const eventsRouter = Router();
const h = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };

// الصورة تصل بايتاتٍ خاماً (كما في رفع مركز البيانات) واسمُها في ترويسة x-file-name مرمَّزاً.
// والحدّ هنا حدُّ الخدمة نفسه: ما يتجاوزه يُوقَف قبل أن يُقرأ كاملاً، ويُردّ بالرسالة نفسها (أدناه).
// وبلا فكّ ضغط (inflate: false): جسمٌ مضغوط يُفكّ في الذاكرة قبل أن يُحدّ حجمُه — ثمانية ميغابايت
// مضغوطة قد تنفكّ إلى ما لا يُحصى. المتصفّح لا يضغط الصور أصلاً؛ ما يصل مضغوطاً ليس التقاطاً.
const imageBody = express.raw({ type: ['image/*', 'application/octet-stream'], limit: '8mb', inflate: false });

// أسماء الملفات العربية تصل مرمّزة بـ encodeURIComponent من المتصفح (الترويسات ASCII فقط)
function decodeFileName(v) {
  if (!v) return '';
  try { return decodeURIComponent(v); } catch { return String(v); }
}
// أي ترويسة نصّية مرمَّزة بالطريقة نفسها (x-title مثلاً): تُفكّ بأمان، وما لم يُرمَّز يعود كما هو.
const hdr = (req, name) => decodeFileName(req.get(name));

// إرسال صورة للمتصفّح: نوعها من الصفّ، وبصمتها علامةً يعود بها المتصفّح فيُردّ بـ«لم تتغيّر» بلا
// بايتات. الاسم اللاتيني للمتصفّحات القديمة، والعربي (إن وُجد) بصيغة UTF-8 كما في التصدير.
const safeName = (s) => String(s || '').replace(/[^\w.-]/g, '_').slice(0, 80);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
// اسم التنزيل بصيغة UTF-8 (RFC 5987): encodeURIComponent يترك !'()* حرفيةً، والفاصلة العليا بالذات
// هي فاصلُ الصيغة نفسها (UTF-8''…) — فتُرمَّز هذه الخمسة أيضاً، والمتصفّح يفكّها كسواها.
const rfc5987 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function sendImage(req, res, p, baseName, utf8Name = null) {
  const tag = '"' + p.sha256 + '"';
  res.setHeader('ETag', tag);
  // التخزين «خاصٌّ، ويُراجَع كل مرة»: المراجعة مجانية بالبصمة (٣٠٤ بلا بايتات)، ورابط الصورة يحمل
  // بصمتها فلا يتجمّد قديماً. ولا max-age: وسيط الجلسة قد يجدّد الكعكة على هذا الردّ نفسه — ردٌّ
  // ٢٠٠ قابلٌ للتخزين يحمل Set-Cookie هو كعكةُ موظّفٍ في ذاكرة وسيطٍ مشترك. فإن كان الوسيط قد
  // وضع no-store هنا لا نُنزل درجته، وفي سواه «خاصّ، راجِع»؛ وVary: Cookie لأن الردّ بحسب صاحبه.
  if (res.getHeader('Cache-Control') !== 'no-store') res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Vary', 'Cookie');
  if (req.get('if-none-match') === tag) return res.status(304).end();
  const ext = ev.imageExt(p.mime);
  let disposition = `inline; filename="${baseName}.${ext}"`;
  if (utf8Name) disposition += `; filename*=UTF-8''${rfc5987(utf8Name)}.${ext}`;
  res.setHeader('Content-Type', p.mime);
  res.setHeader('Content-Length', String(p.content.length));
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(p.content);
}
const image = (load, name) => async (req, res, next) => {
  try {
    const p = await load(req);
    const [base, utf8] = name(req, p);
    sendImage(req, res, p, base, utf8);
  } catch (e) { next(e); }
};

// قراءة بطاقة من نصّ — محلياً، بلا حفظ.
eventsRouter.post('/events/parse-card', h((req) => ev.parseCard(req.ctx.user, req.body || {})));

// الفعاليات
eventsRouter.get('/events', h((req) => ev.listEvents(req.ctx.user, req.query || {})));
eventsRouter.post('/events', h((req) => ev.createEvent(req.ctx, req.body || {})));

// البطاقة الواحدة
eventsRouter.get('/events/contacts/:cid', h((req) => ev.getContact(req.ctx.user, req.params.cid)));
eventsRouter.patch('/events/contacts/:cid', h((req) => ev.updateContact(req.ctx, req.params.cid, req.body || {})));
eventsRouter.post('/events/contacts/:cid/outcome', h((req) => ev.setOutcome(req.ctx, req.params.cid, req.body || {})));
eventsRouter.delete('/events/contacts/:cid', h((req) => ev.deleteContact(req.ctx, req.params.cid)));

// صورة البطاقة: رفعٌ خام، وتنزيلٌ ببصمة
eventsRouter.post('/events/contacts/:cid/photo', imageBody,
  h((req) => ev.attachContactPhoto(req.ctx, req.params.cid, req.body, { fileName: hdr(req, 'x-file-name') })));
eventsRouter.get('/events/contacts/:cid/photo', image(
  (req) => ev.readContactPhoto(req.ctx.user, req.params.cid),
  (req) => ['card-' + safeName(req.params.cid), null]));

// الشراكة الواحدة
eventsRouter.patch('/events/partners/:pid', h((req) => ev.updatePartner(req.ctx, req.params.pid, req.body || {})));
eventsRouter.delete('/events/partners/:pid', h((req) => ev.deletePartner(req.ctx, req.params.pid)));

// الاجتماعات — «check» الحرفية قبل «:mid» عمداً (قاعدة الترتيب المعلنة أعلى الملف)
eventsRouter.post('/events/meetings/check', h((req) => mt.checkConflicts(req.ctx.user, req.body || {})));
eventsRouter.get('/events/meetings/:mid', h((req) => mt.getMeeting(req.ctx.user, req.params.mid)));
eventsRouter.patch('/events/meetings/:mid', h((req) => mt.updateMeeting(req.ctx, req.params.mid, req.body || {})));
eventsRouter.delete('/events/meetings/:mid', h((req) => mt.deleteMeeting(req.ctx, req.params.mid)));

// الفعالية الواحدة
eventsRouter.get('/events/:id', h(async (req) => ({
  event: await ev.getEvent(req.ctx.user, req.params.id),
  summary: await ev.eventSummary(req.ctx.user, req.params.id),
})));
eventsRouter.patch('/events/:id', h((req) => ev.updateEvent(req.ctx, req.params.id, req.body || {})));
eventsRouter.post('/events/:id/close', h((req) => ev.closeEvent(req.ctx, req.params.id, req.body || {})));
eventsRouter.delete('/events/:id', h((req) => ev.deleteEvent(req.ctx, req.params.id)));

// بطاقات الفعالية
eventsRouter.get('/events/:id/contacts', h((req) => ev.listContacts(req.ctx.user, req.params.id, req.query || {})));
eventsRouter.get('/events/:id/contacts/recent', h((req) => ev.recentContacts(req.ctx.user, req.params.id, req.query || {})));
eventsRouter.post('/events/:id/contacts', h((req) => ev.createContact(req.ctx, req.params.id, req.body || {})));

// شراكات الفعالية
eventsRouter.get('/events/:id/partners', h((req) => ev.listPartners(req.ctx.user, req.params.id)));
eventsRouter.post('/events/:id/partners', h((req) => ev.createPartner(req.ctx, req.params.id, req.body || {})));

// اجتماعات الفعالية
eventsRouter.get('/events/:id/meetings', h((req) => mt.listMeetings(req.ctx.user, req.params.id, req.query || {})));
eventsRouter.post('/events/:id/meetings', h((req) => mt.createMeeting(req.ctx, req.params.id, req.body || {})));

// رموز الكشك: صورٌ يمسحها الزائر على شاشة الجناح — عنوانها في ترويسة x-title مرمَّزاً كالاسم.
eventsRouter.get('/events/:id/qr', h((req) => ev.listQr(req.ctx.user, req.params.id)));
eventsRouter.post('/events/:id/qr', imageBody,
  h((req) => ev.addQr(req.ctx, req.params.id, req.body, { title: hdr(req, 'x-title'), fileName: hdr(req, 'x-file-name') })));
eventsRouter.get('/events/:id/qr/:bid', image(
  (req) => ev.readQr(req.ctx.user, req.params.id, req.params.bid),
  (req, p) => [slug(p.title) || 'qr-' + safeName(req.params.bid), p.title]));
eventsRouter.delete('/events/:id/qr/:bid', h((req) => ev.deleteQr(req.ctx, req.params.id, req.params.bid)));

// أخطاء القارئ الخام: إكسبريس يقولها بالإنجليزية وبأرقامها (٤١٣ للضخم، ٤١٥ لترميزٍ لا يفكّه،
// ٤٠٠ لجسمٍ انقطع…) — ونقولها نحن ٤٠٠ بالعربية: الضخم برسالة الخدمة نفسها فلا يفرّق المستخدم
// بين حدٍّ أوقفه المسار وحدٍّ أوقفته الخدمة، وما سواه من تعثّر الاستلام «أعد الالتقاط». وما ليس
// من القارئ (بلا نوعٍ وسيط، أو خطأُ خادم) يمضي كما هو إلى الملتقِط العام.
// (ليس حكماً على الطلب — الأحكام كلها في الخدمة — بل ترجمةُ رسائلِ وسيطٍ من إكسبريس.)
const RECEIVE_FAILED = ['encoding.unsupported', 'request.aborted', 'stream.encoding.set', 'stream.not.readable',
  'entity.verify.failed', 'charset.unsupported'];
eventsRouter.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return next(badRequest(ev.PHOTO_TOO_LARGE_MESSAGE));
  if (err && (RECEIVE_FAILED.includes(err.type) || err.code === 'Z_DATA_ERROR' || (err.status && err.status < 500 && err.type))) {
    return next(badRequest('تعذّر استلام الصورة — أعد الالتقاط'));
  }
  next(err);
});
