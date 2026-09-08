// «مركز التطوير» — البند: البلاغ أو الاقتراح من لحظة وصوله إلى لحظة إغلاقه.
//
// ── الحالة تتحرّك من بابٍ واحد ───────────────────────────────────────────────────────────
// `setStatus` هو الموضع الوحيد الذي تتغيّر فيه حالةُ بندٍ في المنتج كله: منه يمرّ زرُّ الشاشة،
// وأداةُ المساعد، ومزامنةُ المهمة، والسكربت. وجدولُ الانتقالات مكتوبٌ فيه لا موزَّعاً على
// ستة نداءات — فحالةٌ تُكتب من مسارٍ نسي شرطها هي بالضبط ما لا يظهر إلا بعد شهرٍ في تقرير.
//
// وثلاثةُ حقولٍ تُطلب مع حالاتها لأن غيابها يُفرغ الحالة من معناها:
//   • «مرفوض» بلا سبب: السببُ يصل إلى من أبلغ بالبريد — ورفضٌ بلا سببٍ يقطع الطريق على
//     المُبلِّغ ولا يقول له لماذا، فلا يُبلِّغ ثانيةً.
//   • «تم الحل» بلا وسم إصدار: «متى وصلني الحل» سؤالٌ يُسأل في كل جهة، وجوابه الإصدار.
//   • «مكرر» بلا أصلٍ يُشار إليه: تصير الحالةُ سلّةَ مهملاتٍ بلا أثرٍ يعود إلى القرار.
//   • و«بحاجة لتوضيح» تحفظ ما كانت عليه (`status_before_info`) فتعود إليه لا إلى «جديد»:
//     السؤالُ لا يمحو الدراسةَ التي سبقته.

import { all, get, insert, update, run, tx } from '../../core/db/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { createHash } from 'node:crypto';
import { notify } from '../notifications/notify.js';
import { assertMember, assertManager, isTeamMember, teamMembers, productRole, actorLabel, pAudit, timeline } from './access.js';
import { approvedTaskSql } from '../pmo/task-approval.js';
import {
  ITEM_STATUSES, ITEM_TYPES, ITEM_SIZES, ITEM_PRIORITIES, ITEM_URGENCIES, ITEM_SOURCES,
  COMMENT_VISIBILITIES, itemStatusLabel, itemTypeLabel,
} from './labels.js';

// ── جدول الانتقالات ──────────────────────────────────────────────────────────
// المفتاح الحال الراهنة، والقيمة ما يجوز الانتقال إليه منها. وما ليس في القائمة ممنوع —
// القائمةُ بيضاءُ لا سوداء، فحالةٌ جديدة تُضاف لا تفتح أبواباً بصمت.
export const TRANSITIONS = Object.freeze({
  NEW: Object.freeze(['TRIAGED', 'NEEDS_INFO', 'DUPLICATE', 'DECLINED']),
  TRIAGED: Object.freeze(['AWAITING_APPROVAL', 'NEW', 'NEEDS_INFO', 'DUPLICATE', 'DECLINED']),
  AWAITING_APPROVAL: Object.freeze(['APPROVED', 'DECLINED', 'TRIAGED', 'NEEDS_INFO', 'DUPLICATE']),
  APPROVED: Object.freeze(['IN_PROGRESS', 'RESOLVED', 'DECLINED', 'NEEDS_INFO']),
  IN_PROGRESS: Object.freeze(['RESOLVED', 'APPROVED', 'DECLINED', 'NEEDS_INFO']),
  RESOLVED: Object.freeze(['IN_PROGRESS']),
  DECLINED: Object.freeze(['NEW']),
  DUPLICATE: Object.freeze(['NEW']),
  // «بحاجة لتوضيح» تعود إلى ما كانت عليه — ولذلك بابُها مفتوحٌ على مراحل الدراسة كلها.
  NEEDS_INFO: Object.freeze(['NEW', 'TRIAGED', 'AWAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'DECLINED', 'DUPLICATE']),
});
export const canTransition = (from, to) => !!TRANSITIONS[from]?.includes(to);

// قراراتٌ لمديري المنتج وحدهم: الاعتماد والرفض. وما عداها يملكه المطوِّر أيضاً.
const MANAGER_STATUSES = Object.freeze(['APPROVED', 'DECLINED']);

// البابُ الداخليُّ الوحيد الذي يتخطّى حرّاس الصلاحية — ومزامنةُ المهام وحدها تحمله.
// مفتاحُه رمزٌ (`Symbol`) لا نصّ: خيارات هذا الباب تأتي أحياناً من جسد طلبٍ مُرسَل، وجسدُ
// طلبٍ لا يُنتج مفتاحاً رمزياً أبداً — فلا يُنتحل من الخارج بحال. والصلاحيةُ في هذا الطريق
// وقعت مرةً بالفعل: من عدّل المهمة كان مخوَّلاً بتعديلها، وأثرُها على بلاغها تبعٌ لا قرارٌ
// جديد — وحجزُه على عضوية المنتج كان يُسقط المزامنة صامتةً حين يُلغي المطوِّر مهمةَ نفسه.
export const SYNC = Symbol('product_sync');

// ورفيقاه: نفسُ العلّة ونفسُ العلاج. `allowNoVersion` و`silent` كانا مفتاحين نصّيّين في
// `opts`، وموجّه الشبكة يمرّر جسم الطلب إلى `setStatus` كما وصل — فكان كلُّ متصفّح يرفع
// الرايتين بنفسه: يُغلق بلاغاً بلا وسم إصدارٍ («متى وصلني الحل» يبقى بلا جواب)، ويُغلقه بلا
// أن تُنجَز مهمتُه (فتبقى في قائمة مطوِّرٍ إلى الأبد). ورمزُ `Symbol` لا يُنتج من JSON بحال.
export const ALLOW_NO_VERSION = Symbol('product_allow_no_version');
export const SILENT = Symbol('product_silent_sync');

// ختمُ الوقت الذي تكتبه كل حالة حين تُبلَغ — عمودٌ لكل انتقال كي يُقاس زمن كل مرحلة لاحقاً.
const STAMP = Object.freeze({
  TRIAGED: 'triaged_at',
  AWAITING_APPROVAL: 'submitted_for_approval_at',
  APPROVED: 'approved_at',
  DECLINED: 'declined_at',
  IN_PROGRESS: 'started_at',
  RESOLVED: 'resolved_at',
});

const trim = (v, max = 200) => {
  const s = String(v == null ? '' : v).trim();
  return s ? s.slice(0, max) : null;
};
const requireText = (v, msgAr, max = 200) => {
  const s = trim(v, max);
  if (!s) throw badRequest(msgAr);
  return s;
};
const hoursOrNull = (v) => {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 2000) throw badRequest('الساعات المقدَّرة رقمٌ من صفر إلى ألفين');
  return Math.round(n * 100) / 100;
};

export const itemKeyOf = (prefix, no) => `${prefix}-${String(no).padStart(3, '0')}`;

/**
 * يحجز الرقم التالي داخل المنتج — ويُنادى داخل معاملة كتابة البند نفسها.
 *
 * والحجزُ **مشروطٌ بما قُرئ** لا زيادةٌ عمياء: نقرأ العدّاد، ثم نكتب التالي بشرط أن العدّاد
 * ما زال كما قرأناه. ولو سبقنا طلبٌ آخر لم يتغيّر شيء (صفرُ صفوفٍ تغيّرت) فنُعيد الكرّة على
 * القيمة الجديدة. والسبب أن «زِد ثم اقرأ» خطوتان تتخلّلهما لحظة: على سكويلايت الاتصالُ
 * واحدٌ مشترك بين الطلبات، فيقرأ الطلبان الرقمَ نفسه بعد زيادتين — ويصطدمان بالفهرس الفريد
 * (product_id, item_no). والشرطُ هنا يجعل الاصطدام محاولةً تُعاد لا بلاغاً يُردّ في وجه صاحبه.
 */
export async function allocateItemNo(productId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const p = await get('SELECT item_seq, item_prefix FROM product WHERE id = ?', [productId]);
    if (!p) throw notFound('المنتج غير موجود');
    const no = Number(p.item_seq || 0) + 1;
    const r = await run('UPDATE product SET item_seq = ? WHERE id = ? AND item_seq = ?', [no, productId, p.item_seq]);
    if (r.changes) return { item_no: no, item_key: itemKeyOf(p.item_prefix, no) };
  }
  throw badRequest('تعذّر تسجيل البلاغ الآن من كثرة الطلبات — أعد المحاولة بعد لحظات');
}

// ── الإنشاء (يُنادى من intake.js وحده، وهو الباب الوحيد لكل مصدر) ───────────────

/**
 * يكتب صفَّ البند وسطرَه الأول في المهلة الزمنية داخل معاملةٍ واحدة، ثم يُخبر الفريق.
 * لا فحصَ صلاحيةٍ هنا: البابُ العام (`intake.js`) هو من يقرّر من يكتب وبأيّ مصدر.
 */
export async function insertItem(ctx, product, data = {}) {
  const type = ITEM_TYPES.includes(data.type) ? data.type : 'bug';
  const source = ITEM_SOURCES.includes(data.source) ? data.source : 'sanad';
  const urgency = ITEM_URGENCIES.includes(data.urgency) ? data.urgency : null;
  const title = requireText(data.title, 'اكتب عنواناً قصيراً يقول ماذا حدث');
  const now = nowIso();
  const itemId = id('pit');
  const label = actorLabel(ctx);
  const row = await tx(async () => {
    const { item_no, item_key } = await allocateItemNo(product.id);
    await insert('product_item', {
      id: itemId, product_id: product.id, item_no, item_key,
      tenant_id: data.tenant_id || null, link_id: data.link_id || null,
      source, lang: data.lang === 'en' ? 'en' : 'ar', type, title,
      description: trim(data.description, 8000),
      where_text: trim(data.where_text, 300),
      urgency, status: 'NEW',
      reporter_user_id: data.reporter_user_id || null,
      reporter_name: trim(data.reporter_name, 120),
      reporter_email: trim(data.reporter_email, 200),
      reporter_phone: trim(data.reporter_phone, 40),
      reporter_ip_hash: data.reporter_ip_hash || null,
      reporter_note: trim(data.reporter_note, 2000),
      sector_id: data.sector_id || null,
      department_id: data.department_id || null,
      tracking_token: data.tracking_token || null,
      created_at: now, created_by: ctx?.user?.id || null,
    });
    await timeline(ctx, itemId, { kind: 'created', to: 'NEW', actorLabel: data.reporterLabel || label, detail: { source } });
    await pAudit(ctx, {
      action: 'create', resource: 'product_item', resourceId: itemId,
      sectorId: data.sector_id || null, detail: { product_id: product.id, item_key, type, source },
    });
    return await get('SELECT * FROM product_item WHERE id = ?', [itemId]);
  });
  await notifyTeamNewItem(product, row);
  return row;
}

async function notifyTeamNewItem(product, item) {
  const team = await teamMembers(product.id);
  if (!team.length) return;
  const { newItemTeamMail, enqueueProductMail } = await import('../../core/mail/product-mail.js');
  const mail = newItemTeamMail({ product, item });
  for (const m of team) {
    await notify(m.user_id, {
      kind: 'product',
      title: `${itemTypeLabel(item.type)} جديد — ${item.item_key}`,
      body: item.title,
      ref_resource: 'product_item', ref_id: item.id,
    });
    if (m.email) await enqueueProductMail(m.email, mail, 'product_item_new');
  }
}

// ── القراءة ──────────────────────────────────────────────────────────────────

/**
 * قائمةُ البنود بكل مرشّحاتها. حدودُ التاريخ تُحسب في الكود وتُربط قيماً — لا دالةَ تاريخٍ
 * في العبارة (قاعدة المنصة: ما يعمل على محرّكٍ ولا يعمل على الآخر لا يُكتب). وأيُّ طرفٍ من
 * المدى قد يكون فارغاً وحده.
 */
export async function listItems(user, productId, f = {}) {
  await assertMember(user, productId);
  const where = ['i.product_id = ?', 'i.deleted_at IS NULL'];
  const params = [productId];
  const inList = (col, vals, allowed) => {
    const list = (Array.isArray(vals) ? vals : String(vals || '').split(',')) .map((v) => String(v).trim()).filter((v) => allowed.includes(v));
    if (!list.length) return;
    where.push(`${col} IN (${list.map(() => '?').join(',')})`);
    params.push(...list);
  };
  if (f.status) inList('i.status', f.status, ITEM_STATUSES);
  if (f.type) inList('i.type', f.type, ITEM_TYPES);
  if (f.priority) inList('i.priority', f.priority, ITEM_PRIORITIES);
  if (f.urgency) inList('i.urgency', f.urgency, ITEM_URGENCIES);
  if (f.size) inList('i.size', f.size, ITEM_SIZES);
  if (f.source) inList('i.source', f.source, ITEM_SOURCES);
  if (f.tenant_id) { where.push('i.tenant_id = ?'); params.push(f.tenant_id); }
  if (f.link_id) { where.push('i.link_id = ?'); params.push(f.link_id); }
  if (f.sector_id) { where.push('i.sector_id = ?'); params.push(f.sector_id); }
  if (f.version_id) { where.push('i.resolved_version_id = ?'); params.push(f.version_id); }
  if (f.assignee_user_id) { where.push('i.assignee_user_id = ?'); params.push(f.assignee_user_id); }
  // المدى الزمني: عشرةُ محارف من الختم تُقارَن نصّاً — والطرف الفارغ يسقط شرطُه وحده.
  const from = trim(f.from, 10), to = trim(f.to, 10);
  if (from) { where.push('substr(i.created_at, 1, 10) >= ?'); params.push(from); }
  if (to) { where.push('substr(i.created_at, 1, 10) <= ?'); params.push(to); }
  const q = trim(f.q, 120);
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    where.push('(LOWER(i.title) LIKE ? OR LOWER(i.description) LIKE ? OR LOWER(i.item_key) LIKE ? OR LOWER(i.where_text) LIKE ?)');
    params.push(like, like, like, like);
  }
  const limit = Math.min(500, Math.max(1, Number(f.limit) || 200));
  return await all(
    `SELECT i.*, t.name AS tenant_name, u.name_ar AS assignee_name, v.label AS version_label
       FROM product_item i
       LEFT JOIN product_tenant t ON t.id = i.tenant_id
       LEFT JOIN app_user u ON u.id = i.assignee_user_id
       LEFT JOIN product_version v ON v.id = i.resolved_version_id
      WHERE ${where.join(' AND ')}
      ORDER BY i.created_at DESC
      LIMIT ${limit}`, params);
}

/** صفُّ البند مع منتجه ودورِ صاحب الطلب عليه — بابُ كل عمليةٍ على بندٍ بعينه. */
export async function loadItem(user, itemId, { internal = false } = {}) {
  const item = await get('SELECT * FROM product_item WHERE id = ? AND deleted_at IS NULL', [itemId]);
  // «غير موجود» لا «ممنوع»: المعرّفات تُعدّ، وتأكيدُ وجود بندٍ لمن ليس في فريقه تسريب.
  if (!item) throw notFound('البلاغ غير موجود');
  // `internal` لمزامنة المهام وحدها (تُطلب برمز `SYNC` لا بنصّ): تقرأ الصفَّ بلا حارس العضوية.
  if (internal) {
    const product = await get('SELECT * FROM product WHERE id = ?', [item.product_id]);
    if (!product) throw notFound('البلاغ غير موجود');
    return { item, product, role: await productRole(user, product.id) };
  }
  const { product, role } = await assertMember(user, item.product_id);
  return { item, product, role };
}

/** بيانات الصورة بلا بايتاتها — الجدول لا يُقرأ بنجمةٍ أبداً. */
export const itemImages = (itemId) => all(
  `SELECT id, kind, caption, mime, size_bytes, sha256, created_at, created_by
     FROM product_item_image WHERE item_id = ? ORDER BY created_at`, [itemId]);

/** بايتات صورةٍ بعينها — الاستدعاء الوحيد الذي يطلب العمود الثقيل. */
export const itemImageBytes = (imageId) => get(
  'SELECT id, item_id, kind, content, mime, size_bytes, sha256 FROM product_item_image WHERE id = ?', [imageId]);

export async function getItem(user, itemId, { visibility } = {}) {
  const { item, product, role } = await loadItem(user, itemId);
  const [images, comments, events, link, tenant, task, reporter, sector] = await Promise.all([
    itemImages(itemId),
    all(`SELECT * FROM product_item_comment WHERE item_id = ?${visibility === 'reporter' ? " AND visibility = 'reporter'" : ''} ORDER BY created_at`, [itemId]),
    all('SELECT * FROM product_item_event WHERE item_id = ? ORDER BY created_at', [itemId]),
    item.link_id ? get('SELECT id, identity_mode, default_lang FROM product_link WHERE id = ?', [item.link_id]) : null,
    item.tenant_id ? get('SELECT * FROM product_tenant WHERE id = ?', [item.tenant_id]) : null,
    // ومهمةُ البند تُقرأ بحاجز الاعتماد نفسِه الذي يقرأ به كلُّ سطحٍ آخر: مهمةٌ تنتظر اعتماد
    // مدير كاتبها لم تُضَف بعد، وعرضُها في الدرج يجعل الفريق يقرأ عملاً لم يوافق عليه أحد.
    get(`SELECT t.id, t.title, t.status, t.assignee_user_id, t.estimate_hours
           FROM product_item_task pt JOIN task t ON t.id = pt.task_id
          WHERE pt.item_id = ? AND pt.unlinked_at IS NULL AND ${approvedTaskSql('t.')}
          ORDER BY pt.created_at DESC`, [itemId]),
    item.reporter_user_id
      ? get('SELECT name_ar, username FROM app_user WHERE id = ?', [item.reporter_user_id]) : null,
    item.sector_id ? get('SELECT name_ar FROM sector WHERE id = ?', [item.sector_id]) : null,
  ]);
  // سلسلة التكرار: أصلُ هذا البند، ومن اعتُبروا مكرَّرين عنه — القرار يُقرأ من طرفيه.
  const duplicateOf = item.duplicate_of_id
    ? await get('SELECT id, item_key, title, status FROM product_item WHERE id = ?', [item.duplicate_of_id]) : null;
  const duplicates = await all(
    'SELECT id, item_key, title, status, reporter_email FROM product_item WHERE duplicate_of_id = ? AND deleted_at IS NULL', [itemId]);
  const assignee = item.assignee_user_id
    ? await get('SELECT id, name_ar, username FROM app_user WHERE id = ?', [item.assignee_user_id]) : null;
  const version = item.resolved_version_id
    ? await get('SELECT id, label, released_on FROM product_version WHERE id = ?', [item.resolved_version_id]) : null;
  return {
    ...item,
    status_label: itemStatusLabel(item.status),
    product: { id: product.id, name_ar: product.name_ar, key: product.key, kind: product.kind, item_prefix: product.item_prefix, brand_color: product.brand_color },
    my_role: role, images, comments, events, link, tenant, task, duplicateOf, duplicates, assignee, version,
    // ثلاثةُ أسماءٍ يقرؤها الدرج ولا يُركّبها بنفسه: من أبلغ، وقطاعُه، وجهتُه. والمجهولُ يُقال
    // «مجهول» صراحةً لا فراغاً — البلاغُ المجهول بابٌ معلن في روابط الاستقبال لا نقصُ بيانات.
    reporter_display: reporter?.name_ar || reporter?.username || item.reporter_name || 'مجهول',
    sector_name: sector?.name_ar || null,
    tenant_name: tenant?.name || null,
    allowed_next: TRANSITIONS[item.status] || [],
  };
}

// ── الدراسة ──────────────────────────────────────────────────────────────────

/**
 * تقديرُ المطوِّر: الحجم والأولوية والساعات ووصفُ ما سيُعمل. ويُحرّك البند إلى «قيد الدراسة»
 * من «جديد» — وإن كان قد تجاوزها فالتقدير يُحدَّث بلا أن يعود البند خطوةً إلى الوراء.
 */
export async function triageItem(ctx, itemId, data = {}) {
  const { item, product } = await loadItem(ctx.user, itemId);
  const patch = {};
  if ('size' in data) {
    if (data.size != null && data.size !== '' && !ITEM_SIZES.includes(data.size)) throw badRequest('اختر حجم العمل: صغير أو متوسط أو كبير');
    patch.size = data.size || null;
  }
  if ('priority' in data) {
    if (data.priority != null && data.priority !== '' && !ITEM_PRIORITIES.includes(data.priority)) throw badRequest('اختر الأولوية من القائمة');
    patch.priority = data.priority || null;
  }
  if ('est_hours' in data) patch.est_hours = hoursOrNull(data.est_hours);
  if ('dev_description' in data) patch.dev_description = trim(data.dev_description, 4000);
  if ('assignee_user_id' in data && data.assignee_user_id) {
    if (!(await isTeamMember(product.id, data.assignee_user_id))) throw badRequest('المُسنَد إليه ليس من فريق هذا المنتج');
    patch.assignee_user_id = data.assignee_user_id;
  }
  if (!Object.keys(patch).length) return await getItem(ctx.user, itemId);
  patch.updated_at = nowIso(); patch.updated_by = ctx.user.id;
  await tx(async () => {
    await update('product_item', itemId, patch);
    await timeline(ctx, itemId, { kind: 'triage', detail: { fields: Object.keys(patch).filter((k) => k !== 'updated_at' && k !== 'updated_by') } });
    await pAudit(ctx, { action: 'update', resource: 'product_item', resourceId: itemId, sectorId: item.sector_id, detail: { triage: true } });
  });
  if (item.status === 'NEW') await setStatus(ctx, itemId, 'TRIAGED');
  return await getItem(ctx.user, itemId);
}

// ── تغيير الحال: البابُ الوحيد ───────────────────────────────────────────────

/**
 * @param {object} ctx  صاحب الطلب — ومعه `mcpClient` إن كان يعمل عبر مساعد.
 * @param {string} itemId
 * @param {string} to    الحال المقصودة.
 * @param {object} opts  reason (للرفض) · version_id (للحل) · duplicate_of_id (للتكرار)
 *                       · question (لطلب التوضيح) · [SILENT] (لا مزامنة مهمة، يكسر الحلقة)
 *                       · [ALLOW_NO_VERSION] (حلٌّ بلا وسم إصدار — للمزامنة وحدها). والأخيران
 *                       رمزان لا نصّان: لا يبلغهما جسم طلبٍ من الشبكة.
 */
export async function setStatus(ctx, itemId, to, opts = {}) {
  if (!ITEM_STATUSES.includes(to)) throw badRequest('هذه ليست حالةً معروفة للبلاغ');
  const synced = opts[SYNC] === true;
  // ما يُعاد في طريق المزامنة صفُّ البند وحده: `getItem` يمرّ بحارس العضوية، ومن عدّل مهمةً
  // قد لا يكون من فريق المنتج أصلاً — فلا يُقلب نجاحُ نقلةٍ وقعت إلى خطأٍ في آخر سطر.
  const result = async () => (synced
    ? await get('SELECT * FROM product_item WHERE id = ?', [itemId])
    : await getItem(ctx.user, itemId));
  const { item, product } = await loadItem(ctx.user, itemId, { internal: synced });
  const from = item.status;
  if (from === to) return await result();
  if (!canTransition(from, to)) {
    throw badRequest(`لا يُنقل البلاغ من «${itemStatusLabel(from)}» إلى «${itemStatusLabel(to)}» مباشرةً`);
  }
  if (!synced && MANAGER_STATUSES.includes(to)) await assertManager(ctx.user, product.id);

  const now = nowIso();
  const patch = { status: to, updated_at: now, updated_by: ctx.user?.id || null };
  if (STAMP[to]) patch[STAMP[to]] = now;
  let reason = null, question = null, version = null, original = null;

  if (to === 'DECLINED') {
    reason = requireText(opts.reason, 'اكتب سبب الرفض — يصل نصُّه إلى من أبلغ', 2000);
    patch.decline_reason = reason;
  }
  if (to === 'RESOLVED') {
    const vid = trim(opts.version_id, 60);
    // `ALLOW_NO_VERSION` بابٌ داخليٌّ واحد لا يفتحه مستخدم: مزامنةُ المهام تُغلق البند حين
    // تُنجَز مهمتُه، وقد لا يكون للمنتج إصدارٌ مسجَّلٌ بعد. وحجزُ الإغلاق على وسمٍ يكتبه
    // الفريق لاحقاً يترك من أبلغ ينتظر حلاً وصله فعلاً. ومن الشاشة الوسمُ مطلوبٌ دائماً.
    if (!vid && opts[ALLOW_NO_VERSION] !== true) throw badRequest('اختر الإصدار الذي وصل فيه الحل');
    if (vid) {
      version = await get('SELECT * FROM product_version WHERE id = ? AND product_id = ?', [vid, product.id]);
      if (!version) throw badRequest('هذا الإصدار ليس من إصدارات هذا المنتج');
      patch.resolved_version_id = version.id;
    }
  }
  if (to === 'DUPLICATE') {
    const dup = trim(opts.duplicate_of_id, 60);
    if (!dup) throw badRequest('حدِّد البلاغ الأصلي الذي يتكرّر عنه هذا');
    if (dup === itemId) throw badRequest('البلاغ لا يكون مكرراً عن نفسه');
    original = await get('SELECT * FROM product_item WHERE id = ? AND product_id = ? AND deleted_at IS NULL', [dup, product.id]);
    if (!original) throw badRequest('البلاغ الأصلي ليس من هذا المنتج');
    if (original.duplicate_of_id === itemId) throw badRequest('البلاغان يشيران إلى بعضهما — اختر أصلاً ثالثاً');
    patch.duplicate_of_id = original.id;
  }
  if (to === 'NEEDS_INFO') {
    question = requireText(opts.question, 'اكتب سؤالك لصاحب البلاغ — يصل نصُّه إليه', 2000);
    // ما كانت عليه يُحفظ كي تعود إليه لا إلى «جديد»: السؤال لا يمحو الدراسة التي سبقته.
    patch.status_before_info = from === 'NEEDS_INFO' ? item.status_before_info : from;
  }
  if (from === 'NEEDS_INFO') patch.status_before_info = null;

  await tx(async () => {
    await update('product_item', itemId, patch);
    if (question) {
      await insert('product_item_comment', {
        id: id('pic'), item_id: itemId, visibility: 'reporter', body: question,
        author_user_id: ctx.user?.id || null, author_label: actorLabel(ctx), mentions_json: null, created_at: now,
      });
    }
    await timeline(ctx, itemId, {
      kind: 'status', from, to,
      detail: { reason, version: version?.label || null, duplicate_of: original?.item_key || null },
    });
    await pAudit(ctx, {
      action: 'update', resource: 'product_item', resourceId: itemId, sectorId: item.sector_id,
      detail: { status: { from, to } },
    });
  });

  const next = await get('SELECT * FROM product_item WHERE id = ?', [itemId]);
  await announceStatus(ctx, { product, item: next, from, to, reason, question, version, original });
  if (opts[SILENT] !== true) {
    // ودفعُ الأثر إلى المهمة يمرّ من وحدةٍ واحدة تحمل قاعدةَ الاتجاهين — ولا يرمي إلى النداء.
    const sync = await import('./task-sync.js');
    await sync.pushItemStatusToTask(ctx, next, to);
  }
  return await result();
}

/** البريدُ والخبرُ بعد كل انتقال — خارج المعاملة عمداً: بريدٌ يتعثّر لا يُلغي قراراً وقع. */
async function announceStatus(ctx, { product, item, from, to, reason, question, version }) {
  const mailer = await import('../../core/mail/product-mail.js');
  const reporterMail = item.reporter_email;
  if (to === 'AWAITING_APPROVAL') {
    const team = await teamMembers(product.id);
    const mail = mailer.awaitingApprovalMail({ product, item });
    for (const m of team.filter((x) => x.role === 'manager')) {
      await notify(m.user_id, { kind: 'approval', title: `بانتظار اعتمادك — ${item.item_key}`, body: item.title, ref_resource: 'product_item', ref_id: item.id });
      if (m.email) await mailer.enqueueProductMail(m.email, mail, 'product_item_awaiting');
    }
    return;
  }
  if (to === 'APPROVED' && item.assignee_user_id) {
    await notify(item.assignee_user_id, { kind: 'product', title: `اعتُمد وأُسنِد إليك — ${item.item_key}`, body: item.title, ref_resource: 'product_item', ref_id: item.id });
    const u = await get('SELECT email FROM app_user WHERE id = ?', [item.assignee_user_id]);
    if (u?.email) await mailer.enqueueProductMail(u.email, mailer.itemApprovedMail({ product, item }), 'product_item_approved');
    return;
  }
  if (to === 'NEEDS_INFO' && reporterMail) {
    await mailer.enqueueProductMail(reporterMail, mailer.needsInfoMail({ product, item, question }), 'product_item_needs_info');
    return;
  }
  if (to === 'DECLINED' && reporterMail) {
    await mailer.enqueueProductMail(reporterMail, mailer.itemDeclinedMail({ product, item, reason }), 'product_item_declined');
    return;
  }
  if (to === 'RESOLVED') {
    const mail = mailer.itemResolvedMail({ product, item, version });
    if (reporterMail) await mailer.enqueueProductMail(reporterMail, mail, 'product_item_resolved');
    // ومن كُتب بلاغُه مكرَّراً عن هذا يعلم أنّ حلَّه وصل: قرارُ «مكرر» أخرجه من الطابور،
    // فلو صمت الحلُّ عنه لبدا أن بلاغه ابتُلع.
    for (const d of await all('SELECT id, reporter_email FROM product_item WHERE duplicate_of_id = ? AND deleted_at IS NULL', [item.id])) {
      if (d.reporter_email) await mailer.enqueueProductMail(d.reporter_email, mail, 'product_item_resolved_duplicate');
    }
  }
}

// ── الاعتماد والرفض ──────────────────────────────────────────────────────────

/**
 * الاعتماد يفعل شيئين في معاملةٍ واحدة: يُسنِد البند إلى عضوٍ من الفريق، ويُولِّد المهمة.
 * وهما لا ينفصلان: بندٌ معتمَدٌ بلا مهمة لا يظهر في قائمة أحد، ومهمةٌ بلا اعتمادٍ مكتوب
 * تُنجَز على قرارٍ لم يُتَّخذ. فإن تعثّر أحدهما لم يقع الآخر.
 */
export async function approveItem(ctx, itemId, opts = {}) {
  const { item, product } = await loadItem(ctx.user, itemId);
  await assertManager(ctx.user, product.id);
  const assignee = trim(opts.assignee_user_id, 60);
  if (!assignee) throw badRequest('اختر من يتولّى التنفيذ من فريق المنتج');
  if (!(await isTeamMember(product.id, assignee))) throw badRequest('المُسنَد إليه ليس من فريق هذا المنتج');
  if (!canTransition(item.status, 'APPROVED')) {
    throw badRequest(`لا يُعتمد بلاغٌ حالُه «${itemStatusLabel(item.status)}»`);
  }
  const estHours = 'est_hours' in opts ? hoursOrNull(opts.est_hours) : item.est_hours;
  const now = nowIso();
  let taskId = null;
  await tx(async () => {
    await update('product_item', itemId, {
      status: 'APPROVED', approved_at: now, assignee_user_id: assignee,
      est_hours: estHours, decline_reason: null, status_before_info: null,
      updated_at: now, updated_by: ctx.user.id,
    });
    const sync = await import('./task-sync.js');
    taskId = await sync.createTaskForItem(ctx, {
      product, item: { ...item, status: 'APPROVED', assignee_user_id: assignee, est_hours: estHours },
    });
    await timeline(ctx, itemId, { kind: 'status', from: item.status, to: 'APPROVED', detail: { assignee_user_id: assignee, task_id: taskId } });
    await pAudit(ctx, {
      action: 'approve', resource: 'product_item', resourceId: itemId, sectorId: item.sector_id,
      detail: { status: { from: item.status, to: 'APPROVED' }, assignee_user_id: assignee, task_id: taskId },
    });
  });
  const next = await get('SELECT * FROM product_item WHERE id = ?', [itemId]);
  await announceStatus(ctx, { product, item: next, from: item.status, to: 'APPROVED' });
  return await getItem(ctx.user, itemId);
}

/** الرفض — سببُه مطلوبٌ ويصل نصُّه إلى من أبلغ، ومهمتُه إن وُجدت تُلغى. */
export const declineItem = (ctx, itemId, reason, opts = {}) =>
  setStatus(ctx, itemId, 'DECLINED', { ...opts, reason });

/** «تم الحل» بوسم إصدارٍ من إصدارات المنتج. */
export const resolveItem = (ctx, itemId, versionId, opts = {}) =>
  setStatus(ctx, itemId, 'RESOLVED', { ...opts, version_id: versionId });

// ── التعليقات ────────────────────────────────────────────────────────────────

/** إشاراتُ الزملاء: «@اسم الحساب» تُطابَق بأسماء حسابات فريق المنتج وحدهم. */
async function resolveMentions(productId, body) {
  const tokens = [...String(body || '').matchAll(/@([A-Za-z0-9._-]{2,40})/g)].map((m) => m[1].toLowerCase());
  if (!tokens.length) return [];
  const team = await teamMembers(productId);
  return team.filter((m) => tokens.includes(String(m.username || '').toLowerCase())).map((m) => m.user_id);
}

export async function addComment(ctx, itemId, data = {}) {
  const { item, product } = await loadItem(ctx.user, itemId);
  const visibility = COMMENT_VISIBILITIES.includes(data.visibility) ? data.visibility : 'internal';
  const body = requireText(data.body, 'اكتب نص التعليق', 4000);
  const mentions = await resolveMentions(product.id, body);
  const cid = id('pic');
  const now = nowIso();
  await tx(async () => {
    await insert('product_item_comment', {
      id: cid, item_id: itemId, visibility, body,
      author_user_id: ctx.user.id, author_label: actorLabel(ctx),
      mentions_json: mentions.length ? JSON.stringify(mentions) : null, created_at: now,
    });
    await timeline(ctx, itemId, { kind: 'comment', detail: { visibility, mentions: mentions.length } });
    await pAudit(ctx, { action: 'create', resource: 'product_item_comment', resourceId: cid, sectorId: item.sector_id, detail: { item_id: itemId, visibility } });
  });
  for (const uid of mentions) {
    if (uid === ctx.user.id) continue;
    await notify(uid, {
      kind: 'product', title: `ذُكرتَ في ${item.item_key}`,
      body: `${actorLabel(ctx)}: ${body.slice(0, 120)}`,
      ref_resource: 'product_item', ref_id: itemId,
    });
  }
  if (visibility === 'reporter' && item.reporter_email) {
    const mailer = await import('../../core/mail/product-mail.js');
    await mailer.enqueueProductMail(item.reporter_email, mailer.needsInfoMail({ product, item, question: body }), 'product_item_comment');
  }
  return await get('SELECT * FROM product_item_comment WHERE id = ?', [cid]);
}

export const listComments = async (user, itemId, { visibility } = {}) => {
  await loadItem(user, itemId);
  return await all(
    `SELECT * FROM product_item_comment WHERE item_id = ?${visibility === 'reporter' ? " AND visibility = 'reporter'" : ''} ORDER BY created_at`,
    [itemId]);
};

// ── الصور ────────────────────────────────────────────────────────────────────

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const REPORT_IMAGE_MAX = 5;
// نافذةُ صاحب البلاغ: يومٌ من كتابته. اللقطةُ تُرفع بعد الإرسال بثوانٍ (النافذة تكتب البند ثم
// ترفع صورَه)، واليومُ سعةٌ لمن انقطع اتصاله أو أعاد المحاولة من هاتفه — لا بابٌ يبقى مفتوحاً.
export const REPORTER_IMAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * بابُ إضافة الصورة. عضوُ الفريق يمرّ كما يمرّ في كل مسارٍ آخر — و**صاحبُ البلاغ نفسه** يمرّ
 * إلى صور بلاغه وحدها.
 *
 * والسبب أن جمهور زرّ «أبلغ» كلَّه من خارج فريق سند: النافذة تَعِد «حتى خمس صور»، ثم تُلقى كلُّ
 * صورةٍ لأن `assertMember` يردّ غيرَ العضو بـ«غير موجود» — فيقرأ الفريقُ بلاغاً بلا اللقطة التي
 * كُتب لأجلها (KI-117). وهذا البابُ أضيقُ ما يكفي: صورةُ **بلاغٍ** لا «قبل» ولا «بعد» (تلك
 * وثيقةُ عملٍ يكتبها من نفّذ)، وعلى بندٍ **ما زال «جديداً»** لم يبدأ الفريق فيه، وخلال يومٍ من
 * كتابته، وتحت السقف نفسه: خمسُ صورٍ لا أكثر. وما عدا ذلك يبقى للفريق كما كان.
 *
 * والردُّ على من ليس صاحبَه ولا عضواً «غير موجود» لا «ممنوع» — القاعدة ② في `access.js`: الفرق
 * بين الردَّين يجعل تجربةَ المعرّفات عدّاً لبلاغات الشركة.
 */
async function loadItemForImageAdd(user, itemId, kind) {
  const item = await get('SELECT * FROM product_item WHERE id = ? AND deleted_at IS NULL', [itemId]);
  if (!item) throw notFound('البلاغ غير موجود');
  const product = await get('SELECT * FROM product WHERE id = ?', [item.product_id]);
  if (!product) throw notFound('البلاغ غير موجود');
  const role = await productRole(user, item.product_id);
  if (role) return { item, product, role };
  if (!user?.id || item.reporter_user_id !== user.id) throw notFound('البلاغ غير موجود');
  if (kind !== 'report') throw forbidden('صور «قبل» و«بعد» يضيفها فريق المنتج — أرفق صورةَ بلاغك');
  if (item.status !== 'NEW') throw forbidden('بدأ الفريق في بلاغك — أرسل ما ينقص في ردٍّ على بريد بلاغك');
  if (Date.parse(item.created_at) + REPORTER_IMAGE_WINDOW_MS < Date.now()) {
    throw forbidden('مضى على بلاغك أكثر من يوم — أرسل الصورة في ردٍّ على بريد بلاغك');
  }
  return { item, product, role: null };
}

/**
 * تُقبل الصورة ببايتاتها لا بامتداد اسمها: `sniffImageMime` يقرأ توقيعها في أوائل بايتاتها
 * (نفس حارس «الفعاليات»)، فملفٌّ سُمّي صورةً وليس صورةً يُردّ قبل أن يُكتب حرفٌ منه.
 */
export async function addImage(ctx, itemId, bytes, { kind = 'report', caption } = {}) {
  // النوعُ يُفحص قبل الباب: هو الذي يقرّر أيَّ بابٍ يُفتح لصاحب البلاغ.
  if (!['report', 'before', 'after'].includes(kind)) throw badRequest('نوع الصورة غير معروف — صورة بلاغ أو قبل أو بعد');
  const { item } = await loadItemForImageAdd(ctx.user, itemId, kind);
  const { sniffImageMime } = await import('../events/events.js');
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw badRequest('الصورة فارغة — أعد الاختيار');
  if (bytes.length > IMAGE_MAX_BYTES) throw badRequest('الصورة أكبر من اللازم — اجعلها دون ثمانية ميغابايت');
  const mime = sniffImageMime(bytes);
  if (!mime) throw badRequest('صيغة الصورة غير مدعومة — أرفق صورةً عادية');
  if (kind === 'report') {
    const c = await get("SELECT COUNT(*) AS n FROM product_item_image WHERE item_id = ? AND kind = 'report'", [itemId]);
    if (Number(c?.n || 0) >= REPORT_IMAGE_MAX) throw badRequest('لا تزيد صور البلاغ على خمس — احذف واحدة أولاً');
  }
  const iid = id('pim');
  const now = nowIso();
  await tx(async () => {
    await insert('product_item_image', {
      id: iid, item_id: itemId, product_id: item.product_id, kind, caption: trim(caption, 200),
      content: bytes, mime, size_bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), created_at: now, created_by: ctx.user?.id || null,
    });
    await timeline(ctx, itemId, { kind: 'image', detail: { image_kind: kind } });
    await pAudit(ctx, { action: 'create', resource: 'product_item_image', resourceId: iid, sectorId: item.sector_id, detail: { item_id: itemId, kind } });
  });
  return { id: iid, kind, mime, size_bytes: bytes.length };
}

/** صورةٌ بلا بندٍ تُرفع مع نموذج الاستقبال العام قبل أن يُكتب البند — تُنسَب إليه بعد كتابته. */
export async function attachImageBytes({ itemId, productId, bytes, kind = 'report', caption, createdBy }) {
  const { sniffImageMime } = await import('../events/events.js');
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw badRequest('الصورة فارغة — أعد الاختيار');
  if (bytes.length > IMAGE_MAX_BYTES) throw badRequest('الصورة أكبر من اللازم — اجعلها دون ثمانية ميغابايت');
  const mime = sniffImageMime(bytes);
  if (!mime) throw badRequest('صيغة الصورة غير مدعومة — أرفق صورةً عادية');
  const iid = id('pim');
  await insert('product_item_image', {
    id: iid, item_id: itemId || null, product_id: productId || null, kind, caption: trim(caption, 200),
    content: bytes, mime, size_bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), created_at: nowIso(), created_by: createdBy || null,
  });
  return { id: iid, kind, mime, size_bytes: bytes.length };
}

export async function deleteImage(ctx, imageId) {
  const img = await get('SELECT id, item_id FROM product_item_image WHERE id = ?', [imageId]);
  if (!img?.item_id) throw notFound('الصورة غير موجودة');
  const { item } = await loadItem(ctx.user, img.item_id);
  await tx(async () => {
    await run('DELETE FROM product_item_image WHERE id = ?', [imageId]);
    await timeline(ctx, item.id, { kind: 'image', detail: { deleted: true } });
    await pAudit(ctx, { action: 'delete', resource: 'product_item_image', resourceId: imageId, sectorId: item.sector_id, detail: { item_id: item.id } });
  });
  return { ok: true };
}

// ── حذفُ بندٍ: ناعمٌ كقاعدة المنصة ───────────────────────────────────────────

export async function deleteItem(ctx, itemId) {
  const { item, product } = await loadItem(ctx.user, itemId);
  await assertManager(ctx.user, product.id);
  await tx(async () => {
    await update('product_item', itemId, { deleted_at: nowIso(), updated_by: ctx.user.id });
    await pAudit(ctx, { action: 'delete', resource: 'product_item', resourceId: itemId, sectorId: item.sector_id, detail: { item_key: item.item_key } });
  });
  return { ok: true };
}

// ── الأرقام ──────────────────────────────────────────────────────────────────

/** ملخّصُ الحال للتقرير المطبوع ولرأس الشاشة: عددٌ لكل حالة ونوعٍ وإلحاح ومعدَّل الحل. */
export async function itemStats(user, productId, f = {}) {
  const rows = await listItems(user, productId, { ...f, limit: 500 });
  const byStatus = {}, byType = {}, byUrgency = {}, byPriority = {};
  let resolved = 0, ageSum = 0, aged = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byType[r.type] = (byType[r.type] || 0) + 1;
    if (r.urgency) byUrgency[r.urgency] = (byUrgency[r.urgency] || 0) + 1;
    if (r.priority) byPriority[r.priority] = (byPriority[r.priority] || 0) + 1;
    if (r.status === 'RESOLVED' && r.resolved_at) {
      resolved++;
      const days = (Date.parse(r.resolved_at) - Date.parse(r.created_at)) / 86400000;
      if (Number.isFinite(days)) { ageSum += Math.max(0, days); aged++; }
    }
  }
  return {
    total: rows.length,
    open: rows.filter((r) => !['RESOLVED', 'DECLINED', 'DUPLICATE'].includes(r.status)).length,
    resolved,
    avg_days_to_resolve: aged ? Math.round((ageSum / aged) * 10) / 10 : null,
    byStatus, byType, byUrgency, byPriority,
  };
}
