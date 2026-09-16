// «مركز التطوير» — بوابة الوصول: من يرى منتجاً، ومن يقرِّر فيه، وكيف يُكتب الأثر.
//
// ثلاث قواعد يقوم عليها هذا الملف كله:
//
//   ① **العضوية جدولٌ لا دور شركة.** من ليس في `product_member` لا وجود للمنتج بالنسبة له.
//      ومديرُ النظام يمرّ فوق الجميع بحكم منحه الشامل — سطرٌ واحد في أول كل فحص.
//
//   ② **الردّ على غير العضو «غير موجود» لا «ممنوع».** «ممنوع» إقرارٌ بأن هذا المعرّف يخصّ
//      منتجاً قائماً — وعدُّ المعرّفات صفحةً صفحة يرسم خريطة منتجات الشركة لمن لا يملك واحداً
//      منها. و«لمديري المنتج» تُقال صراحةً للعضو المطوِّر: هو يعرف المنتج أصلاً، والرسالة
//      تقول له أين يذهب بدل أن تُنكر عليه ما يراه.
//
//   ③ **الفاعل قد يكون مساعداً يعمل بحساب صاحبه.** الأداة تُنفَّذ بهوية الموظف نفسه (ADR-0019
//      لا مفاتيح خدمة)، فسجلُّ الأثر يجب أن يقول «كتبها المساعد الفلاني عبر فلان» لا «فلان»
//      وحده. `actorLabel` هو الموضع الوحيد الذي تُصاغ فيه هذه الجملة.

import { all, get, insert } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { forbidden, notFound } from '../../core/http/errors.js';

export const NOT_FOUND_AR = 'المنتج غير موجود';
export const MANAGER_ONLY_AR = 'هذا القرار لمديري المنتج';

const isAdmin = (user) => user?.role_id === 'admin';

/**
 * دورُ صاحب الحساب على منتجٍ بعينه: admin | manager | developer | null.
 * مديرُ النظام يقصُر الطريق قبل أي قراءة — لا استعلام على كل صفحةٍ يفتحها.
 */
export async function productRole(user, productId) {
  if (!user || !productId) return null;
  if (isAdmin(user)) return 'admin';
  const row = await get(
    'SELECT role FROM product_member WHERE product_id = ? AND user_id = ? AND active = 1',
    [productId, user.id]);
  return row?.role === 'manager' ? 'manager' : row?.role === 'developer' ? 'developer' : null;
}

/** منتجاتُه: كلُّها لمدير النظام، وما هو عضوٌ فيه لغيره — مرتَّبةً بالاسم. */
export async function myProducts(user) {
  if (!user) return [];
  if (isAdmin(user)) {
    return await all('SELECT * FROM product WHERE archived_at IS NULL ORDER BY name_ar');
  }
  return await all(
    `SELECT p.*, m.role AS my_role FROM product p
       JOIN product_member m ON m.product_id = p.id AND m.user_id = ? AND m.active = 1
      WHERE p.archived_at IS NULL
      ORDER BY p.name_ar`, [user.id]);
}

/**
 * يعيد صفَّ المنتج ودورَ صاحب الحساب عليه، أو يرمي «غير موجود» — بابٌ واحد لكل قراءة.
 * ولا يفصل بين «المنتج غير قائم» و«لستَ عضواً»: الفصل هو التسريب نفسه.
 */
export async function assertMember(user, productId) {
  const role = await productRole(user, productId);
  if (!role) throw notFound(NOT_FOUND_AR);
  const product = await get('SELECT * FROM product WHERE id = ?', [productId]);
  if (!product) throw notFound(NOT_FOUND_AR);
  return { product, role };
}

/** الاعتماد والرفض وإدارة الفريق والجهات والروابط — لمديري المنتج ومدير النظام. */
export async function assertManager(user, productId) {
  const { product, role } = await assertMember(user, productId);
  if (role !== 'manager' && role !== 'admin') throw forbidden(MANAGER_ONLY_AR);
  return { product, role };
}

/** أعضاءُ فريقٍ فعّالون — تُستعمل في منتقي المُسنَد إليه وفي حارس الإسناد عند الاعتماد. */
export async function teamMembers(productId) {
  return await all(
    `SELECT m.id, m.user_id, m.role, u.name_ar, u.username, u.email
       FROM product_member m
       JOIN app_user u ON u.id = m.user_id
      WHERE m.product_id = ? AND m.active = 1
      ORDER BY CASE m.role WHEN 'manager' THEN 0 ELSE 1 END, u.name_ar`, [productId]);
}

export async function isTeamMember(productId, userId) {
  if (!userId) return false;
  const r = await get(
    'SELECT id FROM product_member WHERE product_id = ? AND user_id = ? AND active = 1',
    [productId, userId]);
  return !!r;
}

/**
 * اسمُ الفاعل كما يُقرأ في المهلة الزمنية وفي التعليق.
 * حين يعمل مساعدٌ خارجي بحساب صاحبه يُنسب العمل إلى الاثنين معاً: «<المساعد> · عبر <صاحبه>».
 * والقراءة دفاعية — وحدةُ الأدوات هي التي تضع `ctx.mcpClient`، وغيابُه هو الحال العادي.
 */
export function actorLabel(ctx) {
  const person = ctx?.user?.name_ar || ctx?.user?.username || 'غير معروف';
  const client = ctx?.mcpClient?.name_ar || ctx?.mcpClient?.name || null;
  return client ? `${client} · عبر ${person}` : person;
}

/** هل يعمل صاحب الطلب عبر مساعد — يُكتب في تفصيل الأثر كما تكتبه أدوات المساعد القائمة. */
export const viaDetail = (ctx) => (ctx?.mcpClient
  ? { via: 'ai', client_id: ctx.mcpClient.id || null }
  : null);

/**
 * أثرُ التدقيق لهذه الميزة: نداءٌ واحدٌ يضيف نسبة المساعد إلى كل كتابة بلا أن يتذكّرها كاتب.
 * ويبقى `audit()` العام هو الكاتب الوحيد — لا جدول أثرٍ ثانٍ لهذه الميزة.
 */
export async function pAudit(ctx, { action, resource, resourceId, sectorId, detail } = {}) {
  const via = viaDetail(ctx);
  await audit(ctx, {
    action,
    resource: resource || 'product_item',
    resourceId,
    sectorId,
    detail: via ? { ...(detail || {}), ...via } : (detail || undefined),
  });
}

/**
 * سطرٌ في مهلة البند الزمنية. المهلة سردٌ يُقرأ («نقلها فلان من كذا إلى كذا») لا سجلُّ تدقيق:
 * سجلُّ التدقيق للمراجعة، وهذه للفريق ولمن أبلغ. ولذلك يُنسخ **اسمُ** الفاعل في صفّه: الحساب
 * قد يُعطَّل بعد شهور ويبقى السؤال «من أغلق هذا البلاغ» يحتاج جواباً يُقرأ بلا ربط.
 */
export async function timeline(ctx, itemId, ev = {}) {
  await insert('product_item_event', {
    id: id('pie'),
    item_id: itemId,
    kind: ev.kind || 'note',
    from_status: ev.from || null,
    to_status: ev.to || null,
    actor_user_id: ctx?.user?.id || null,
    actor_label: ev.actorLabel || actorLabel(ctx),
    detail_json: ev.detail ? JSON.stringify(ev.detail) : null,
    created_at: nowIso(),
  });
}
