// «مركز التطوير» — الباب العام: نموذج الاستقبال وصفحة المتابعة تحت `/p`.
//
// هذا الموجّه الوحيد في المنصة الذي يخدم **من لا حساب له**، فقواعده أشدّ من قواعد `/api`:
//
//  ① **لا فرقَ بين رابطٍ أُوقف ورابطٍ انتهى أجله ورابطٍ لا وجود له**: الثلاثة صفحةٌ واحدة
//     بحرفها ورمز حالتها. الفرقُ بينها يخبر من يجرّب الروابط آلياً أيُّها كان صحيحاً يوماً،
//     فيدلّه على عميلٍ لنا ومنتجٍ عنده — وهذه معلومةٌ لا تُعطى.
//  ② **الحقل الخفيّ يُنهي الطلب صامتاً**: `company_website` لا يراه إنسان، فمن يملؤه آلة.
//     والردّ ٢٠٠ بجسمٍ يشبه النجاح — كي لا تتعلّم الآلة أنها كُشفت — و**لا يُكتب حرفٌ واحد**.
//  ③ **الحدّ بالعنوان لا بالحساب**: لا كعكةَ جلسةٍ هنا ولا حسابَ يُقفل، فالدلو (`publicFormLimiter`)
//     هو الحدّ الوحيد على الإرسال.
//  ④ **رابط جهةٍ داخلية يلزمه دخول**: إن كانت الجهة «استخدامٌ داخلي (EVC)» فمن يفتح الرابط
//     موظفٌ عندنا — يُعاد إلى صفحة الدخول إن لم تكن له جلسة، فلا يبلّغ زميلٌ مجهولَ الاسم.
//  ⑤ **صفحة المتابعة تُصفّى في الخادم**: تعليقات الفريق الداخلية لا تُرسل أصلاً إلى المتصفّح
//     (`visibility = 'reporter'` في الاستعلام) — لا تُرسل وتُخفى بالتنسيق.
//
// ولا حماية «الإرسال المزدوج» (CSRF) على هذه المسارات: `csrf()` يفرضها على النماذج المُرمَّزة
// (`urlencoded`) وحدها، وهذه المسارات تُنادى بحمولةٍ نصّية من نصّ الصفحة نفسه — فتبقى خارجها
// كما هي حال بقية نداءات المنصة، وموقفُ KI-014 (نداءٌ نصّي + كعكةٌ `SameSite=Lax`) بلا تغيير.
// ولا سلطةَ هنا تُستمدّ من كعكةٍ أصلاً: الرمز في العنوان هو الإذن كلُّه.
import express, { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { all, get, insert } from '../../core/db/index.js';
import { publicFormLimiter, publicPageLimiter } from '../../core/http/security.js';
import { intakePage, trackingPage, closedPage, notFoundPage } from '../../web/views/dev-center-public.js';
import * as intake from './intake.js';
import { attachImageBytes, REPORT_IMAGE_MAX } from './items.js';
import { productLogo } from './products.js';
import { timeline } from './access.js';
import { nowIso, id } from '../../core/util/ids.js';
import { LINK_LANGS } from './labels.js';

export const publicRouter = Router();

// خطأٌ على مسارٍ نصّيٍّ خارج `/api`: المعالج العام يرسم **صفحة** خطأ لأي طلبٍ يقبل النصّ
// المُعلَّم — ونماذج هذه الصفحة تُرسَل من نصٍّ برمجي ينتظر حمولةً يقرأ منها رسالته. فتُردّ هنا
// حمولةً بالشكل نفسه الذي يردّه الدلو (`{ error: 'رسالة عربية' }`)، وما كان عطباً حقيقياً
// (٥٠٠ فأكثر) يُترك للمعالج العام كي يُسجَّل ويُلتقط كسواه.
const fail = (res, next, e) => {
  const status = Number(e?.status);
  if (status >= 400 && status < 500) return res.status(status).json({ error: e.message });
  return next(e);
};

const html = (res, status, body) => {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // لا تُخزَّن ولا تُفهرَس: صفحةٌ خلف رمزٍ سرّي في عنوانها، وتحمل نصّ بلاغِ عميل.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(body);
};

// اللغة: ما طلبه الزائر إن كان معروفاً، وإلا لغةُ الرابط التي اختارها مدير المنتج.
const langOf = (req, link) => {
  const q = String(req.query?.lang || '').toLowerCase();
  if (LINK_LANGS.includes(q)) return q;
  return LINK_LANGS.includes(link?.default_lang) ? link.default_lang : 'ar';
};
const askedLang = (req) => (String(req.query?.lang || '').toLowerCase() === 'en' ? 'en' : 'ar');

/**
 * الرابط حيٌّ أم مغلق. `intake.openLink` يرمي «مغلق» للحالات الثلاث بجملةٍ واحدة (لا وجود له،
 * موقوف، منتهٍ) — وهذا يبتلع الرمية ويعيد `null`، فتُرسم الصفحة الواحدة نفسها في الثلاث.
 * ولا يُعاد أبداً أيُّ الأسباب كان: الفرقُ بينها يدلّ من يجرّب الروابط على رابطٍ كان صحيحاً.
 */
async function openLink(token) {
  try { return await intake.openLink(token); } catch { return null; }
}

const productOf = (row, token) => ({
  name_ar: row.product.name_ar, name_en: row.product.name_en, brand_color: row.product.brand_color,
  logo_url: row.product.brand_blob_id ? `/p/${encodeURIComponent(token)}/logo` : null,
});
const linkOf = (row, token) => ({
  token, identity_mode: row.link.identity_mode, default_lang: row.link.default_lang,
  intro_ar: row.link.intro_ar, intro_en: row.link.intro_en,
});

// ── تذاكر الصور ──────────────────────────────────────────────────────────────
// بعد أن يُكتب البلاغ تُعطى الصفحة تذكرةً تُرفق بها صورُه. عمرُها عشر دقائق وسقفُها خمس صور،
// وتعيش في ذاكرة العملية: نافذةٌ قصيرةٌ جداً لا تستحق جدولاً، وإعادةُ تشغيلٍ في أثنائها تُفقد
// الصور وحدها — والبلاغ نفسه مكتوبٌ ومُرسَل بريدُه قبل أن تُطلب صورة. (نفس مبدأ الدلاء: أثرٌ
// في الذاكرة يقبل الضياع، وما لا يقبله يُكتب في القاعدة.)
const TICKET_TTL_MS = 10 * 60 * 1000;
const tickets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tickets) if (now > v.expires) tickets.delete(k);
}, 60 * 1000).unref();

function issueTicket(trackingToken, productId) {
  const t = randomBytes(16).toString('base64url');
  tickets.set(t, { trackingToken, productId, used: 0, expires: Date.now() + TICKET_TTL_MS });
  return t;
}

// ── فتح النموذج ──────────────────────────────────────────────────────────────
publicRouter.get('/:token', publicPageLimiter, async (req, res, next) => {
  try {
    const row = await openLink(req.params.token);
    if (!row) return html(res, 404, closedPage({ lang: askedLang(req) }));
    // ④ جهةٌ داخلية: من يفتحها زميلٌ لا ضيف — يُعرَّف بنفسه بالدخول قبل أن يبلّغ.
    if (Number(row.tenant?.internal) && !req.ctx?.user) {
      return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    }
    // الزيارة تُعدّ ولا يُنتظر عدُّها: رقمُ إحصاءٍ لا يؤخّر صفحةً أمام ضيف، ولا يُسقطها إن تعثّر.
    Promise.resolve(intake.countLinkVisit(row.link.id)).catch(() => {});
    return html(res, 200, intakePage({
      product: productOf(row, req.params.token), link: linkOf(row, req.params.token),
      lang: langOf(req, row.link), imageLimit: REPORT_IMAGE_MAX,
    }));
  } catch (e) { next(e); }
});

// شعار المنتج لعين الضيف — بايتاتٌ خلف رمز الرابط نفسه، ولا يُفتح `/api` لمن لا حساب له لأجل صورة.
publicRouter.get('/:token/logo', publicPageLimiter, async (req, res, next) => {
  try {
    const row = await openLink(req.params.token);
    if (!row) return res.status(404).end();
    const p = await productLogo(row.product.id);
    if (!p) return res.status(404).end();
    const tag = '"' + p.sha256 + '"';
    res.setHeader('ETag', tag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (req.get('if-none-match') === tag) return res.status(304).end();
    res.setHeader('Content-Type', p.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(p.content);
  } catch (e) { next(e); }
});

// ── الإرسال ──────────────────────────────────────────────────────────────────
publicRouter.post('/:token/submit', publicFormLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    // ② الفخّ أولاً — قبل أي قراءةٍ للقاعدة: لا استعلام، ولا كتابة، ولا بريد. والردّ يشبه النجاح.
    // (والخدمة تحرسه ثانيةً — حارسان على بابٍ يفتحه المجهول لا يُعدّان تكراراً.)
    if (String(body.company_website || '').trim()) {
      return res.json({ ok: true, item_key: '', tracking_url: null, ticket: null });
    }
    const row = await openLink(req.params.token);
    if (!row) return res.status(404).json({ error: 'رابط الاستقبال لم يعد يعمل' });
    if (Number(row.tenant?.internal) && !req.ctx?.user) {
      return res.status(401).json({ error: 'هذا الرابط لموظفي الشركة — سجّل دخولك أولاً' });
    }
    const lang = langOf(req, row.link);
    const out = await intake.submitPublic({ token: req.params.token, body, ip: req.ip, lang });
    if (out?.spam || !out?.tracking_token) return res.json({ ok: true, item_key: '', tracking_url: null, ticket: null });
    return res.json({
      ok: true,
      item_key: out.item_key || '',
      tracking_url: `/p/t/${encodeURIComponent(out.tracking_token)}?lang=${lang}`,
      ticket: issueTicket(out.tracking_token, row.product.id),
    });
  } catch (e) { fail(res, next, e); }
});

// صورةٌ واحدةٌ لكل نداء، بايتاتٍ خاماً — و`inflate:false` لأن جسماً مضغوطاً يُفكّ في الذاكرة
// قبل أن يُحدّ حجمُه، فثمانية ميغابايت مضغوطة قد تنفكّ إلى ما لا يُحصى.
const imageBody = express.raw({ type: ['image/*', 'application/octet-stream'], limit: '8mb', inflate: false });

// الدلو هنا دلوُ الصفحات لا دلوُ الإرسال، عمداً: بلاغٌ واحدٌ بخمس صورٍ ستةُ نداءات، ودلوُ
// الإرسال سعتُه خمسة — فوضعُه هنا كان يمنع من أرفق خمس لقطاتٍ من إتمام بلاغه الأول. والحدُّ
// الحقيقي على الصور ليس زمنياً أصلاً بل تذكرةٌ: بندٌ بعينه، وخمسُ صورٍ سقفاً، وعشرُ دقائق —
// وهو أضيق من أي دلو.
publicRouter.post('/:token/image/:ticket', publicPageLimiter, imageBody, async (req, res, next) => {
  try {
    const t = tickets.get(String(req.params.ticket || ''));
    if (!t || Date.now() > t.expires) {
      tickets.delete(String(req.params.ticket || ''));
      return res.status(404).json({ error: 'انتهت مهلة إرفاق الصور — أرسل بلاغاً جديداً إن لزم' });
    }
    if (t.used >= REPORT_IMAGE_MAX) return res.status(400).json({ error: 'لا تزيد صور البلاغ على خمس' });
    // تذكرةُ رابطٍ لا تُستعمل على رابطٍ آخر: الرمز في العنوان يجب أن يعود إلى المنتج نفسه.
    const row = await openLink(req.params.token);
    if (!row || row.product.id !== t.productId) return res.status(404).json({ error: 'رابط الاستقبال لم يعد يعمل' });
    const { item } = await intake.itemByTracking(t.trackingToken);
    // والحدُّ يُقرأ من القاعدة أيضاً لا من العدّاد وحده: العدّاد في الذاكرة، والصفوف هي الحقيقة.
    const c = await get("SELECT COUNT(*) AS n FROM product_item_image WHERE item_id = ? AND kind = 'report'", [item.id]);
    if (Number(c?.n || 0) >= REPORT_IMAGE_MAX) return res.status(400).json({ error: 'لا تزيد صور البلاغ على خمس' });
    // `attachImageBytes` يشمّ توقيع البايتات: ملفٌّ سُمّي صورةً وليس صورةً يُردّ قبل أن يُكتب حرف.
    const im = await attachImageBytes({ itemId: item.id, productId: item.product_id, bytes: req.body, kind: 'report' });
    t.used += 1;
    return res.json({ ok: true, id: im.id });
  } catch (e) { fail(res, next, e); }
});

// ── صفحة المتابعة ────────────────────────────────────────────────────────────
// «t» مقطعان (`/t/:tracking`) و«:token» مقطعٌ واحد — فلا يبتلع أحدهما الآخر مهما كان الترتيب.

const tracked = async (tracking) => {
  try { return await intake.itemByTracking(tracking); } catch { return null; }
};

// ⑤ التصفية في الاستعلام لا في العرض: ما لا يقرؤه من أبلغ لا يغادر القاعدة أصلاً.
const reporterComments = (itemId) => all(
  `SELECT id, body, author_user_id, author_label, created_at
     FROM product_item_comment
    WHERE item_id = ? AND visibility = 'reporter' ORDER BY created_at`, [itemId]);

publicRouter.get('/t/:tracking', publicPageLimiter, async (req, res, next) => {
  try {
    const lang = askedLang(req);
    const found = await tracked(req.params.tracking);
    if (!found) return html(res, 404, notFoundPage({ lang }));
    const { item, product } = found;
    const comments = (await reporterComments(item.id)).map((c) => ({
      body: c.body, created_at: c.created_at, from_reporter: !c.author_user_id,
    }));
    return html(res, 200, trackingPage({ product, item, comments, lang }));
  } catch (e) { next(e); }
});

// ردُّ من أبلغ على سؤال الفريق. لا معنى له إلا والبلاغ «بحاجة لتوضيح» — وفي غير ذلك يُقبل
// الطلب ولا يُكتب شيء (كالفخّ: لا رسالةَ خطأٍ تُعلّم من يجرّب أي البلاغات مفتوحٌ للردّ).
// والردُّ **لا يحرّك الحال**: من يقرأ الجواب هو من يقرّر أن التوضيح كافٍ، وذاك قرارُ فريقٍ
// يُتَّخذ من داخل المنصة لا من صفحةٍ يفتحها المجهول.
publicRouter.post('/t/:tracking/reply', publicFormLimiter, async (req, res, next) => {
  try {
    if (String((req.body || {}).company_website || '').trim()) return res.json({ ok: true });
    const found = await tracked(req.params.tracking);
    if (!found) return res.status(404).json({ error: 'لم نجد بلاغاً بهذا الرابط' });
    const { item } = found;
    if (item.status !== 'NEEDS_INFO') return res.json({ ok: true });
    const body = String((req.body || {}).body || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ error: 'اكتب ردّك أولاً' });
    const label = String(item.reporter_name || '').trim() || 'من أبلغ';
    // الردُّ تعليقٌ يقرؤه صاحبه ويقرؤه الفريق، وسطرٌ في المهلة الزمنية باسم من أبلغ لا بحسابٍ
    // (لا حساب له) — و`timeline` يقبل ذلك: `actor_user_id` فارغ والاسم منسوخٌ في صفّه.
    await insert('product_item_comment', {
      id: id('pic'), item_id: item.id, visibility: 'reporter', body,
      author_user_id: null, author_label: label, mentions_json: null, created_at: nowIso(),
    });
    await timeline({ user: null, ip: req.ip }, item.id, { kind: 'comment', actorLabel: label, detail: { from_reporter: true } });
    return res.json({ ok: true });
  } catch (e) { fail(res, next, e); }
});
