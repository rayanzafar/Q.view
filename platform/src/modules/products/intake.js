// «مركز التطوير» — أبواب الدخول الثلاثة. لا يُكتب بندٌ في المنتج إلا من أحدها.
//
//   ① `submitSanadFeedback` — زرُّ «أبلغ» داخل المنصة: صاحبُه معروفٌ بحسابه، وقطاعُه وإدارتُه
//      تُقرآن من سجلّه لا من الطلب. من يُبلِّغ عن عطلٍ ليس من يُسأل عن قطاعه.
//   ② `submitPublic` — رابطُ الاستقبال الدائم لجهةٍ من جهات منتجٍ يُباع: يفتحه من لا حساب له.
//   ③ `createManual` — يكتبه عضوُ الفريق بالنيابة عمّن اشتكى شفهياً، والقطاع مطلوبٌ فيه
//      صراحةً: بلاغٌ بلا قطاعٍ لا يدخل تقرير أحد، وهو أكثرُ ما يضيع.
//
// ولا سطرَ مسارٍ (route) في هذا الملف: الحدود والترويسات والحدّ من التكرار في طبقة المسارات،
// وهذه الطبقة تقرّر ماذا يُكتب ومن يملك أن يكتبه.

import { get, run, tx } from '../../core/db/index.js';
import { nowIso } from '../../core/util/ids.js';
import { badRequest, notFound } from '../../core/http/errors.js';
import { randomBytes, createHash } from 'node:crypto';
import { config } from '../../core/config.js';
import { assertMember } from './access.js';
import { insertItem } from './items.js';
import { ITEM_TYPES, ITEM_URGENCIES } from './labels.js';

/** مفتاحُ المنتج الداخلي — سندٌ نفسه، وهو المنتج الوحيد الذي يقبل بلاغات المنصة. */
export const SANAD_PRODUCT_KEY = 'sanad';

const CLOSED_AR = 'هذه الصفحة لم تعد تستقبل بلاغات — تواصل مع من أعطاك الرابط';
const trim = (v, max = 200) => {
  const s = String(v == null ? '' : v).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * بصمةُ صاحب البلاغ المجهول: `sha256(العنوان + سرّ الجلسة)`. لا يُحفظ العنوان نفسه أبداً —
 * وعدُ «بلا تعريف بالنفس» يُخلَف حرفياً إن حُفظ ما يدلّ على صاحبه. والبصمة تكفي لكشف
 * التكرار من مصدرٍ واحد بلا أن تُعيد أحداً إلى شخصه.
 */
export const hashIp = (ip) => (ip
  ? createHash('sha256').update(String(ip) + String(config.sessionSecret)).digest('hex')
  : null);

/** رمزُ صفحة المتابعة: مئةٌ وثمانية وعشرون بتاً — الصفحةُ تُفتح بلا حساب فلا تُخمَّن بالعدّ. */
export const newTrackingToken = () => randomBytes(16).toString('base64url');

/** عنوانُ صفحة المتابعة كاملاً — يُوضع في ردّ الإرسال كي تعرضه النافذة لصاحب البلاغ. */
export const trackingUrl = (token) => `${String(config.platformUrl || '').replace(/\/$/, '')}/p/t/${token}`;

const normalizeType = (v) => (ITEM_TYPES.includes(v) ? v : 'bug');
const normalizeUrgency = (v) => (ITEM_URGENCIES.includes(v) ? v : null);

/** قطاعُ صاحب الحساب وإدارتُه — من سجلّه لا من الطلب. */
async function blameOf(user) {
  if (!user?.id) return { sector_id: null, department_id: null };
  const u = await get('SELECT sector_id, employee_id FROM app_user WHERE id = ?', [user.id]);
  const emp = u?.employee_id
    ? await get('SELECT department_id, sector_id FROM employee WHERE id = ? AND deleted_at IS NULL', [u.employee_id])
    : null;
  return {
    sector_id: u?.sector_id || emp?.sector_id || null,
    department_id: emp?.department_id || null,
  };
}

// ── ① من داخل المنصة ─────────────────────────────────────────────────────────

export async function sanadProduct() {
  return await get('SELECT * FROM product WHERE key = ? AND archived_at IS NULL', [SANAD_PRODUCT_KEY]);
}

/**
 * «أبلغ» من رأس الصفحة. القطاعُ والإدارة من سجلّ صاحب الحساب، و«أين حدث» يُملأ مسبقاً من
 * عنوان الشاشة التي فُتح منها الزرّ — وهو نصٌّ يُرسله المتصفّح فيُقصّ ويُهرَّب كغيره.
 */
export async function submitSanadFeedback(ctx, body = {}) {
  const product = await sanadProduct();
  if (!product) throw notFound('استقبال البلاغات غير مهيَّأ بعد — أبلغ مدير النظام');
  if (!ctx?.user?.id) throw badRequest('يلزم تسجيل الدخول لإرسال البلاغ');
  const blame = await blameOf(ctx.user);
  // ورمزُ المتابعة يُكتب لبلاغ المنصة كما يُكتب لبلاغ الرابط العام (KI-126). قبله كان صاحبُ
  // البلاغ من داخل سند أعمى الطريق كلَّه: `/app/dev-center` تردّه لأنه ليس في فريق المنتج،
  // و`GET /api/products/items/:id` تقول «غير موجود» عن بلاغه هو، وبريدُه لا يصله إلا في ثلاث
  // حالات — ولا رابطَ فيه يفتح شيئاً. والرمزُ يفتح `/p/t/<الرمز>` بلا حساب: الصفحة نفسها التي
  // يفتحها المُبلِّغ الخارجي، وهي تقرأ الرمز وحده فلا تحتاج تغييراً ليعمل عليها بلاغ المنصة.
  const trackingToken = newTrackingToken();
  const item = await insertItem(ctx, product, {
    source: 'sanad',
    type: normalizeType(body.type),
    title: body.title,
    description: body.description,
    where_text: trim(body.where_text, 300),
    urgency: normalizeUrgency(body.urgency),
    lang: 'ar',
    reporter_user_id: ctx.user.id,
    reporter_name: ctx.user.name_ar || ctx.user.username || null,
    reporter_email: (await get('SELECT email FROM app_user WHERE id = ?', [ctx.user.id]))?.email || null,
    sector_id: blame.sector_id,
    department_id: blame.department_id,
    tracking_token: trackingToken,
  });
  return { ...item, tracking_url: trackingUrl(trackingToken) };
}

// ── ② من رابط الاستقبال العام ────────────────────────────────────────────────

/** الرابطُ حيٌّ أم مغلق — والأجوبةُ الثلاثة (غير موجود، موقوف، منتهٍ) تُقال بجملةٍ واحدة. */
export async function openLink(token) {
  const link = await get('SELECT * FROM product_link WHERE token = ?', [String(token || '')]);
  if (!link || !link.enabled) throw notFound(CLOSED_AR);
  if (link.expires_on && link.expires_on < nowIso().slice(0, 10)) throw notFound(CLOSED_AR);
  const product = await get('SELECT * FROM product WHERE id = ? AND archived_at IS NULL', [link.product_id]);
  if (!product) throw notFound(CLOSED_AR);
  const tenant = link.tenant_id ? await get('SELECT * FROM product_tenant WHERE id = ?', [link.tenant_id]) : null;
  return { link, product, tenant };
}

/** زيارةٌ تُعدّ — رقمٌ يقول للمدير هل الرابط يُفتح أصلاً قبل أن يسأل لماذا لا تصل بلاغات. */
export const countLinkVisit = (linkId) => run('UPDATE product_link SET visits = visits + 1 WHERE id = ?', [linkId]);

export async function submitPublic({ token, body = {}, ip, lang } = {}) {
  // الفخُّ أولاً: حقلٌ مخفيٌّ لا يملؤه إنسان. والردُّ نجاحٌ صامت — الآلةُ التي ملأته يجب ألّا
  // تعرف أنها كُشفت، وإلا جرّبت الشكل التالي. ولا يُكتب حرفٌ في القاعدة.
  if (trim(body.company_website, 200)) return { ok: true, item_key: null, spam: true };
  const { link, product, tenant } = await openLink(token);
  const wanted = lang === 'en' || lang === 'ar' ? lang : link.default_lang;

  let name = trim(body.reporter_name, 120);
  let email = trim(body.reporter_email, 200);
  if (link.identity_mode === 'anonymous_only') { name = null; email = null; }
  if (link.identity_mode === 'required') {
    if (!name) throw badRequest('اكتب اسمك كي نعرف بمن نتواصل');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('اكتب بريداً صحيحاً كي يصلك خبر بلاغك');
  }

  const trackingToken = newTrackingToken();
  const item = await insertItem({ ip }, product, {
    source: 'link',
    link_id: link.id,
    tenant_id: link.tenant_id || null,
    type: normalizeType(body.type),
    title: body.title,
    description: body.description,
    where_text: trim(body.where_text, 300),
    urgency: normalizeUrgency(body.urgency),
    lang: wanted,
    reporter_name: name,
    reporter_email: email,
    reporter_phone: trim(body.reporter_phone, 40),
    reporter_ip_hash: hashIp(ip),
    tracking_token: trackingToken,
    reporterLabel: name || 'مُبلِّغ من رابط الاستقبال',
  });

  await tx(async () => {
    await run('UPDATE product_link SET submissions = submissions + 1, last_submit_at = ? WHERE id = ?', [nowIso(), link.id]);
  });

  // إشعارُ الاستلام: رقمُ البلاغ ورابطُ متابعته. ولا يُرسل لمن لم يترك بريداً — ولا يُطلب منه.
  if (email) {
    const mailer = await import('../../core/mail/product-mail.js');
    await mailer.enqueueProductMail(email, mailer.itemReceiptMail({ product, item }), 'product_item_receipt');
  }
  return { ok: true, item_key: item.item_key, tracking_token: trackingToken, tenant_id: tenant?.id || null };
}

/** صفحةُ المتابعة تُفتح برمزها وحده — وتقرأ ما يخصّ صاحبها فقط. */
export async function itemByTracking(trackingToken) {
  const item = await get('SELECT * FROM product_item WHERE tracking_token = ? AND deleted_at IS NULL', [String(trackingToken || '')]);
  if (!item) throw notFound('لم نجد بلاغاً بهذا الرابط');
  const product = await get('SELECT * FROM product WHERE id = ?', [item.product_id]);
  return { item, product };
}

// ── ③ بالنيابة، من داخل الفريق ───────────────────────────────────────────────

/**
 * عضوُ الفريق يكتب ما وصله شفهياً. والقطاعُ **مطلوب**: بلاغٌ بلا قطاعٍ لا يظهر في تقرير أحد
 * ولا يُعرف على من يقع أثرُه — وهو أكثرُ ما يضيع في هذا الباب تحديداً، لأن الكاتب ليس صاحبَه.
 */
export async function createManual(ctx, productId, body = {}) {
  const { product } = await assertMember(ctx.user, productId);
  const sectorId = trim(body.sector_id, 60);
  if (!sectorId) throw badRequest('اختر القطاع الذي يقع عليه أثر هذا البلاغ');
  const sector = await get('SELECT id FROM sector WHERE id = ?', [sectorId]);
  if (!sector) throw badRequest('القطاع المختار غير موجود');
  // و«أين حدث» **مطلوب** كالقطاع: النافذتان الأخريان تملآنه من الشاشة التي فُتحتا منها، وهذا
  // الباب وحده يكتبه إنسانٌ لم يرَ الشاشة — فبلا موضعٍ مكتوبٍ يبقى البلاغُ سؤالاً لا عملاً.
  const whereText = trim(body.where_text, 300);
  if (!whereText) throw badRequest('اكتب أين حدث');
  if (body.tenant_id) {
    const t = await get('SELECT id FROM product_tenant WHERE id = ? AND product_id = ?', [body.tenant_id, productId]);
    if (!t) throw badRequest('الجهة المختارة ليست من هذا المنتج');
  }
  // الشخص: حسابٌ من المنصة أو اسمٌ حرّ لمن لا حساب له — والاثنان لا يُطلبان معاً.
  let reporterUserId = trim(body.reporter_user_id, 60);
  let reporterName = trim(body.reporter_name, 120);
  let reporterEmail = trim(body.reporter_email, 200);
  if (reporterUserId) {
    const u = await get('SELECT id, name_ar, username, email FROM app_user WHERE id = ? AND deleted_at IS NULL', [reporterUserId]);
    if (!u) throw badRequest('الشخص المختار غير موجود');
    reporterName = u.name_ar || u.username;
    reporterEmail = reporterEmail || u.email || null;
  } else if (!reporterName) {
    throw badRequest('اكتب اسم من أبلغ، أو اختره من قائمة الحسابات');
  }
  return await insertItem(ctx, product, {
    source: 'manual',
    tenant_id: body.tenant_id || null,
    type: normalizeType(body.type),
    title: body.title,
    description: body.description,
    where_text: whereText,
    urgency: normalizeUrgency(body.urgency),
    lang: 'ar',
    reporter_user_id: reporterUserId || null,
    reporter_name: reporterName,
    reporter_email: reporterEmail,
    reporter_phone: trim(body.reporter_phone, 40),
    reporter_note: trim(body.reporter_note, 2000),
    sector_id: sectorId,
    department_id: trim(body.department_id, 60),
  });
}
