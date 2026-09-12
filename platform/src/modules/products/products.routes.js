// «مركز التطوير» — الموجّه المصادَق عليه. رقيقٌ كسواه: قراءة الطلب ⟵ نداء الخدمة ⟵ ردّ.
//
// مركَّب تحت `/api` من `api.routes.js`، و`requireAuth()` يعمل عند نقطة التركيب فـ`req.ctx.user`
// حاضرٌ دائماً هنا، و`apiLimiter` فوقه في `server.js`.
//
// ثلاث قواعد تحكم هذا الملف، وكلُّها أمنية:
//
//  ① **الباب في الخدمة، والباب هنا مرةً واحدة على الصفّ نفسه.** عضويةُ فريق المنتج ليست دوراً
//     في الشركة، فلا تُحسم عند نقطة التركيب. وكلُّ مسارٍ يبدأ من بندٍ أو تعليقٍ أو صورة **يُحمِّل
//     الصفَّ أولاً، ويقرأ `product_id` منه**، ثم يسأل `assertMember`/`assertManager` عن ذلك
//     المنتج بعينه. ولا يُقرأ معرّفُ منتجٍ من جسم الطلب ولا من مسافته الاستعلامية أبداً: من
//     يرسل معرّف منتجٍ هو عضوٌ فيه مع معرّفِ بندٍ من منتجٍ آخر يكتب في منتجٍ ليس له لولا ذلك.
//
//  ② **غيرُ العضو يرى «غير موجود» لا «ممنوع».** `assertMember` يرمي ٤٠٤ (`access.js`) — لأن
//     ٤٠٣ على معرّفٍ صحيح و٤٠٤ على معرّفٍ مختلق يجعلان تجربةَ المعرّفات عدّاً لمنتجات الشركة
//     وبلاغاتها من الخارج. والعضو غير المدير يرى ٤٠٣ على مسارات القرار وحدها: هو يعرف أن
//     البند موجود أصلاً، فلا شيء يُكشف، والرسالة تقول له لماذا لا يستطيع.
//
//  ③ **الحرفيّة قبل `:id`.** «feedback» و«items» و«images» تُسجَّل قبل `/products/:id` — وإلا
//     قُرئت يوماً على أنها معرّف منتج.
//
// والصور والملفّ استثناءان معلنان من «ردٌّ بحمولة»: تُرفع الصورة بايتاتٍ خاماً وتُنزَّل بايتاتٍ
// بترويساتها، والملفّ ينزل مرفقاً — كما في «الفعاليات» حرفاً بحرف.
import express, { Router } from 'express';
import * as products from './products.js';
import * as items from './items.js';
import * as intake from './intake.js';
import { assertMember, assertManager } from './access.js';
import { badRequest, notFound } from '../../core/http/errors.js';
import { exportItems } from './export.js';
import {
  ITEM_TYPE, ITEM_URGENCY, itemTypeLabel, itemUrgencyLabel, IMAGE_KINDS,
} from './labels.js';

export const productsRouter = Router();
const h = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };

// الجسم الخام: نفس حدود «الفعاليات» ونفس السبب. `inflate:false` لأن جسماً مضغوطاً يُفكّ في
// الذاكرة **قبل** أن يُحدّ حجمُه، فثمانية ميغابايت مضغوطة قد تنفكّ إلى ما لا يُحصى؛ والمتصفّح
// لا يضغط الصور أصلاً، فما يصل مضغوطاً ليس لقطةَ شاشة.
const imageBody = express.raw({ type: ['image/*', 'application/octet-stream'], limit: '8mb', inflate: false });

// الترويسات ASCII، والنصّ العربي يصل مرمَّزاً بـ`encodeURIComponent` — يُفكّ بأمان.
function decodeHeader(v) {
  if (!v) return '';
  try { return decodeURIComponent(v); } catch { return String(v); }
}
const hdr = (req, name) => decodeHeader(req.get(name));
const safeName = (s) => String(s || '').replace(/[^\w.-]/g, '_').slice(0, 80);
// اسم التنزيل بصيغة UTF-8 (RFC 5987): الفاصلة العليا فاصلُ الصيغة نفسها، فتُرمَّز مع أخواتها.
const rfc5987 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** إرسال بايتات صورة — نوعها من الصفّ الذي شمّته الخدمة لا من تخمين المتصفّح. */
function sendImage(req, res, p, baseName) {
  const tag = '"' + p.sha256 + '"';
  res.setHeader('ETag', tag);
  // «خاصٌّ، ويُراجَع كل مرة»: المراجعة مجانية بالبصمة، ولا `max-age` لأن وسيط الجلسة قد يجدّد
  // الكعكة على هذا الردّ نفسه — وردٌّ قابل للتخزين يحمل `Set-Cookie` كعكةُ موظّفٍ في وسيطٍ مشترك.
  if (res.getHeader('Cache-Control') !== 'no-store') res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Vary', 'Cookie');
  if (req.get('if-none-match') === tag) return res.status(304).end();
  const ext = String(p.mime || '').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  res.setHeader('Content-Type', p.mime);
  res.setHeader('Content-Length', String(p.content.length));
  res.setHeader('Content-Disposition', `inline; filename="${baseName}.${ext}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(p.content);
}

// ── نموذج «أبلغ» داخل المنصة ─────────────────────────────────────────────────
// تعريفُ النموذج يُقرأ من هنا لا يُكتب في الشاشة: حين يُضاف نوعٌ أو درجةُ إلحاحٍ في `labels.js`
// تظهر في النافذة بلا تعديلِ صفحة. والشكل مقصودٌ بساطتُه — بطاقات، وحقول، وسقف صور.

productsRouter.get('/products/feedback/form', h(() => ({
  title: 'أبلغ عن عُطل أو اقترح تحسيناً',
  lead: 'اكتب ما واجهته بلغتك — يصل فريق سند مباشرةً، ويصلك ردّه على بريدك.',
  types: Object.keys(ITEM_TYPE).map((k) => ({ value: k, label: itemTypeLabel(k) })),
  fields: {
    title: { label: 'عنوان مختصر', placeholder: 'جملة واحدة تلخّص ما حدث', required: true, max: 200 },
    description: { label: 'اشرح ما حدث', placeholder: 'ما الذي كنت تفعله؟ وما الذي حدث بدل ما توقّعته؟', required: true, max: 6000 },
    where_text: { label: 'أين حدث هذا؟', placeholder: 'اسم الشاشة أو الخطوة', required: false, max: 200 },
  },
  urgency: { label: 'كم يؤثّر هذا على عملك؟', options: Object.keys(ITEM_URGENCY).map((k) => ({ value: k, label: itemUrgencyLabel(k) })), default: 'delays' },
  images: { label: 'صور توضّح ما حدث', hint: 'حتى خمس صور — الصقها أو اسحبها.', limit: 5 },
  submit: 'أرسِل',
  success: 'وصلنا بلاغك — رقمه',
})));

productsRouter.post('/products/feedback', h((req) => intake.submitSanadFeedback(req.ctx, req.body || {})));

// ── البند الواحد ─────────────────────────────────────────────────────────────
// `items.loadItem(user, itemId)` هو الباب: يقرأ الصفَّ، ويأخذ `product_id` **منه**، ويسأل
// `assertMember` عن ذلك المنتج — فيرمي «غير موجود» لغير العضو. فلا يُقرأ معرّفُ منتجٍ من جسم
// الطلب هنا أبداً. والقراءة الخفيفة (`loadItem`) لمسارات الكتابة، والكاملة (`getItem`) لمن
// يعيد البند نفسه — كي لا يدفع كل نداءٍ ثمن الصور والتعليقات والمهلة الزمنية بلا حاجة.
const gate = (req) => items.loadItem(req.ctx.user, req.params.itemId);
// مسار قرار: العضويةُ أولاً (٤٠٤ لغير العضو)، ثم كونُه مديرَ المنتج (٤٠٣) — والعضو يعرف أن
// البند موجود أصلاً فلا يُكشف بالتفريق شيء.
const gateManager = async (req) => {
  const g = await gate(req);
  await assertManager(req.ctx.user, g.product.id);
  return g;
};

// ── ما يُقرأ من جسم الطلب يُسمّى حقلاً حقلاً ─────────────────────────────────────────────
// خدماتُ البند تأخذ `opts` فيها أبوابٌ داخلية (تخطّي وسم الإصدار، وكتم مزامنة المهمة). ونشرُ
// `req.body` في `opts` يجعل كلَّ متصفّحٍ قادراً على رفع الراية بنفسه. البابان صارا رمزين
// (`Symbol`) لا يُنتجهما JSON — وهذا الحاجز الثاني فوقهما: **قائمةٌ بيضاء** لا تمرّ منها إلا
// الحقول التي تعني شيئاً للخدمة، فلا يصل مفتاحٌ لم يُقصَد أصلاً مهما تغيّرت الخدمة غداً.
const pick = (body, keys) => {
  const out = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(body || {}, k)) out[k] = body[k];
  return out;
};
// حقولُ نقلِ الحال: سببُ الرفض، ووسمُ الإصدار، وأصلُ التكرار، والسؤال، وملاحظةٌ حرّة.
const STATUS_FIELDS = ['reason', 'note', 'version_id', 'duplicate_of_id', 'question'];
// وحقولُ التقدير: ما يحرّره المطوِّر من الدرج لا أكثر.
const TRIAGE_FIELDS = ['size', 'priority', 'est_hours', 'dev_description', 'assignee_user_id'];

productsRouter.get('/products/items/:itemId', h((req) => items.getItem(req.ctx.user, req.params.itemId)));
// التعديل = تقديرُ المطوِّر (الحجم والأولوية والساعات ووصفُ ما سيُعمل): هو الحقول الوحيدة التي
// تُحرَّر من الدرج، والخدمة تتكفّل بأن يتقدّم البند إلى «قيد الدراسة» إن كان لا يزال جديداً.
productsRouter.patch('/products/items/:itemId', h((req) => items.triageItem(req.ctx, req.params.itemId, pick(req.body, TRIAGE_FIELDS))));
productsRouter.post('/products/items/:itemId/triage', h((req) => items.triageItem(req.ctx, req.params.itemId, pick(req.body, TRIAGE_FIELDS))));
productsRouter.post('/products/items/:itemId/status', h((req) => {
  const body = req.body || {};
  return items.setStatus(req.ctx, req.params.itemId, body.to || body.status, pick(body, STATUS_FIELDS));
}));
productsRouter.post('/products/items/:itemId/approve', h(async (req) => {
  await gateManager(req);
  return await items.approveItem(req.ctx, req.params.itemId, pick(req.body, ['assignee_user_id', 'est_hours']));
}));
productsRouter.post('/products/items/:itemId/decline', h(async (req) => {
  await gateManager(req);
  return await items.declineItem(req.ctx, req.params.itemId, (req.body || {}).reason);
}));

// تعليقات البند — الظهور (بين الفريق / يقرؤها من أبلغ) قرارُ الخدمة، وهذا ينقله كما وصل.
productsRouter.get('/products/items/:itemId/comments', h((req) => items.listComments(req.ctx.user, req.params.itemId)));
productsRouter.post('/products/items/:itemId/comments', h((req) => items.addComment(req.ctx, req.params.itemId, req.body || {})));

// صور البند: رفعٌ خام يضيف ولا يستبدل، وقائمةٌ بلا بايتات، وواحدةٌ ببايتاتها، وحذفُ واحدة.
// ونوعُ الصورة يصل ترويسةً لا في المسار: هي وصفٌ للحمولة نفسها لا موضعٌ في شجرة العناوين.
productsRouter.post('/products/items/:itemId/images', imageBody, h((req) => {
  const kind = hdr(req, 'x-image-kind') || 'report';
  if (!IMAGE_KINDS.includes(kind)) throw badRequest('نوع الصورة غير معروف');
  return items.addImage(req.ctx, req.params.itemId, req.body, { kind, caption: hdr(req, 'x-caption') || null });
}));
productsRouter.get('/products/items/:itemId/images', h(async (req) => {
  await gate(req);
  return await items.itemImages(req.params.itemId);
}));
// البايتات: البند يُحمَّل أولاً (فبابُه بابُها)، ثم **تُقرن** الصورة ببنده — صورةُ بندٍ في منتجٍ
// آخر لا تُقرأ بمعرّفها ولو خُمِّن، لأن القِران يفشل قبل أن تُرسل بايتة.
const imageOfItem = async (req) => {
  await gate(req);
  const p = await items.itemImageBytes(req.params.imageId);
  if (!p || p.item_id !== req.params.itemId) throw notFound('الصورة غير موجودة');
  return p;
};
productsRouter.get('/products/items/:itemId/images/:imageId', async (req, res, next) => {
  try { sendImage(req, res, await imageOfItem(req), 'item-' + safeName(req.params.imageId)); }
  catch (e) { next(e); }
});
productsRouter.delete('/products/items/:itemId/images/:imageId', h(async (req) => {
  await imageOfItem(req);
  return await items.deleteImage(req.ctx, req.params.imageId);
}));

// ── المنتجات ─────────────────────────────────────────────────────────────────
productsRouter.get('/products', h((req) => products.listMyProducts(req.ctx.user)));
productsRouter.post('/products', h((req) => products.createProduct(req.ctx, req.body || {})));

// ── الجهات والروابط والإصدارات: المعرّف في المسار معرّفُ الصفّ نفسه، والخدمة تقرأ منه منتجَه ──
productsRouter.patch('/products/tenants/:tenantId', h((req) => products.updateTenant(req.ctx, req.params.tenantId, req.body || {})));
productsRouter.delete('/products/tenants/:tenantId', h((req) => products.deleteTenant(req.ctx, req.params.tenantId)));
productsRouter.patch('/products/links/:linkId', h((req) => products.updateLink(req.ctx, req.params.linkId, req.body || {})));
productsRouter.post('/products/links/:linkId/rotate', h((req) => products.rotateLinkToken(req.ctx, req.params.linkId)));
productsRouter.delete('/products/links/:linkId', h((req) => products.deleteLink(req.ctx, req.params.linkId)));
productsRouter.delete('/products/versions/:versionId', h((req) => products.deleteVersion(req.ctx, req.params.versionId)));

// ── المنتج الواحد (بعد كل ما هو حرفيّ) ───────────────────────────────────────
productsRouter.get('/products/:id', h((req) => products.getProduct(req.ctx.user, req.params.id)));
productsRouter.patch('/products/:id', h((req) => products.updateProduct(req.ctx, req.params.id, req.body || {})));
productsRouter.post('/products/:id/archive', h((req) => products.archiveProduct(req.ctx, req.params.id, (req.body || {}).archived !== false)));

// شعار المنتج: رفعٌ لمديره، وبايتاتٌ لعضوه. ومن يفتح رابط الاستقبال يراه من `/p` لا من هنا —
// فهو لا يملك حساباً أصلاً، ولا يُفتح `/api` لمن لا حساب له لأجل صورة.
productsRouter.post('/products/:id/logo', imageBody,
  h((req) => products.setProductLogo(req.ctx, req.params.id, req.body, { mime: req.get('content-type') })));
productsRouter.get('/products/:id/logo', async (req, res, next) => {
  try {
    await assertMember(req.ctx.user, req.params.id);
    const p = await products.productLogo(req.params.id);
    if (!p) return res.status(404).end();
    sendImage(req, res, p, 'logo-' + safeName(req.params.id));
  } catch (e) { next(e); }
});

// أعضاء الفريق
productsRouter.get('/products/:id/members', h((req) => products.listMembers(req.ctx.user, req.params.id)));
productsRouter.post('/products/:id/members', h((req) => products.addMember(req.ctx, req.params.id, req.body || {})));
productsRouter.patch('/products/:id/members/:userId', h((req) => products.changeMemberRole(req.ctx, req.params.id, req.params.userId, (req.body || {}).role)));
productsRouter.delete('/products/:id/members/:userId', h((req) => products.removeMember(req.ctx, req.params.id, req.params.userId)));

// الجهات (العملاء) وروابط استقبالها والإصدارات
productsRouter.get('/products/:id/tenants', h((req) => products.listTenants(req.ctx.user, req.params.id)));
productsRouter.post('/products/:id/tenants', h((req) => products.createTenant(req.ctx, req.params.id, req.body || {})));
productsRouter.get('/products/:id/links', h((req) => products.listLinks(req.ctx.user, req.params.id)));
productsRouter.post('/products/:id/links', h((req) => products.createLink(req.ctx, req.params.id, req.body || {})));
productsRouter.get('/products/:id/versions', h((req) => products.listVersions(req.ctx.user, req.params.id)));
productsRouter.post('/products/:id/versions', h((req) => products.createVersion(req.ctx, req.params.id, req.body || {})));

// ── بلاغات المنتج ────────────────────────────────────────────────────────────
// كل التصفية مسافةً استعلامية: الحال والنوع والأولوية والإلحاح والجهة والرابط والقطاع والإصدار
// والمصدر وكلمةُ بحثٍ ومن/إلى — وأيٌّ من الطرفين قد يكون فارغاً. الخدمة تفهمها، وهذا ينقلها.
productsRouter.get('/products/:id/items', h((req) => items.listItems(req.ctx.user, req.params.id, req.query || {})));
productsRouter.post('/products/:id/items', h((req) => intake.createManual(req.ctx, req.params.id, req.body || {})));
productsRouter.get('/products/:id/stats', h((req) => items.itemStats(req.ctx.user, req.params.id, req.query || {})));

// تصدير القائمة المصفّاة نفسها ملفَّ Excel — «export.xlsx» حرفيةٌ لا تلتبس بمعرّف بند.
// و«لا يُخزَّن» لأن الملف بلاغاتُ عميلٍ بحالها: لا تُترك في ذاكرة وسيطٍ ولا في قرص المتصفّح.
productsRouter.get('/products/:id/items/export.xlsx', async (req, res, next) => {
  try {
    const { buffer, fileName, mime } = await exportItems(req.ctx, req.params.id, req.query || {});
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition',
      `attachment; filename="product-${safeName(req.params.id)}-items.xlsx"; filename*=UTF-8''${rfc5987(fileName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  } catch (e) { next(e); }
});
