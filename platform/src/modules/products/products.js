// «مركز التطوير» — المنتج نفسه: إنشاؤه، وفريقُه، وجهاتُه، وروابطُ استقباله، وإصداراتُه.
//
// مديرُ النظام وحده يُنشئ منتجاً ويؤرشفه ويعيّن أول مدير له — إنشاء منتجٍ قرارُ شركة لا قرار
// فريق. وما بعد ذلك يديره مديرو المنتج: الأعضاء، والجهات، والروابط، والهوية البصرية،
// والإصدارات. والبنودُ نفسها في `items.js`.

import { all, get, insert, update, run, tx } from '../../core/db/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { randomBytes, createHash } from 'node:crypto';
import { assertMember, assertManager, productRole, myProducts, teamMembers, pAudit } from './access.js';
import {
  MEMBER_ROLES, PRODUCT_KINDS, IDENTITY_MODES, LINK_LANGS, ITEM_STATUSES,
} from './labels.js';

const ADMIN_ONLY_AR = 'إنشاء المنتجات وأرشفتها من صلاحية مدير النظام';
const trim = (v, max = 200) => {
  const s = String(v == null ? '' : v).trim();
  return s ? s.slice(0, max) : null;
};
const requireText = (v, msgAr, max = 200) => {
  const s = trim(v, max);
  if (!s) throw badRequest(msgAr);
  return s;
};
const assertAdmin = (user) => { if (user?.role_id !== 'admin') throw forbidden(ADMIN_ONLY_AR); };
// اليومُ يُكتب سنةً فشهراً فيوماً، والفراغُ فراغ — ولا حساب تواريخ في القاعدة (قاعدة المنصة).
const dateOrNull = (v, fieldAr) => {
  const s = trim(v, 10);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest(`${fieldAr} يُكتب سنةً فشهراً فيوماً`);
  return s;
};
// لونٌ ست عشري فقط: القيمة تُحقن في نمط الصفحة العامة، فأيُّ نصٍّ حرٍّ هنا بابُ حقنٍ مفتوح.
const colorOrNull = (v) => {
  const s = trim(v, 7);
  if (!s) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw badRequest('اللون يُكتب بستّ خانات بعد علامة المربّع');
  return s.toLowerCase();
};

// ── المنتج ───────────────────────────────────────────────────────────────────

/** مفتاح المنتج: حروفٌ لاتينية صغيرة وأرقامٌ وشرطة — يُكتب في السكربتات ولا يُعرض للمستخدم. */
const normalizeKey = (v) => {
  const s = String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!s) throw badRequest('اسم المنتج المختصر مطلوب');
  return s.slice(0, 40);
};
/** بادئة المفاتيح: حروفٌ لاتينية كبيرة قصيرة تُقرأ في «SND-042». */
const normalizePrefix = (v) => {
  const s = String(v == null ? '' : v).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) throw badRequest('بادئة أرقام البنود مطلوبة — مثل SND');
  return s.slice(0, 8);
};

export async function createProduct(ctx, data = {}) {
  assertAdmin(ctx.user);
  const kind = PRODUCT_KINDS.includes(data.kind) ? data.kind : 'external';
  const key = normalizeKey(data.key);
  const exists = await get('SELECT id FROM product WHERE key = ?', [key]);
  if (exists) throw badRequest('يوجد منتجٌ بهذا الاسم المختصر — اختر غيره');
  const pid = id('prd');
  const now = nowIso();
  await tx(async () => {
    await insert('product', {
      id: pid,
      key,
      name_ar: requireText(data.name_ar, 'اسم المنتج مطلوب'),
      name_en: trim(data.name_en),
      description: trim(data.description, 2000),
      kind,
      project_id: trim(data.project_id, 60),
      item_prefix: normalizePrefix(data.item_prefix || key),
      item_seq: 0,
      brand_color: colorOrNull(data.brand_color),
      created_at: now,
      created_by: ctx.user.id,
    });
    // أولُ مديرٍ يُعيَّن مع المنتج نفسه: منتجٌ بلا مديرٍ لا يعتمد فيه أحدٌ شيئاً، وهو الحال
    // الذي لا يُكتشف إلا حين يقف أول بلاغٍ عند «بانتظار الاعتماد» بلا أحدٍ يفتحه.
    const firstManager = data.manager_user_id || ctx.user.id;
    await insert('product_member', {
      id: id('pmb'), product_id: pid, user_id: firstManager, role: 'manager', active: 1,
      created_at: now, created_by: ctx.user.id,
    });
    await pAudit(ctx, { action: 'create', resource: 'product', resourceId: pid, detail: { key, kind } });
  });
  return await get('SELECT * FROM product WHERE id = ?', [pid]);
}

export async function getProduct(user, productId) {
  const { product, role } = await assertMember(user, productId);
  return { ...product, my_role: role };
}

export async function listMyProducts(user) {
  const rows = await myProducts(user);
  const out = [];
  for (const p of rows) {
    // عدّادٌ واحدٌ لكل منتج بدل استعلامٍ لكل حالة: الشاشة تعرض «مفتوح» و«بانتظار اعتمادك».
    const c = await get(
      `SELECT COUNT(*) AS "all",
              SUM(CASE WHEN status IN ('RESOLVED','DECLINED','DUPLICATE') THEN 0 ELSE 1 END) AS "open",
              SUM(CASE WHEN status = 'AWAITING_APPROVAL' THEN 1 ELSE 0 END) AS "awaiting"
         FROM product_item WHERE product_id = ? AND deleted_at IS NULL`, [p.id]);
    out.push({
      ...p,
      my_role: p.my_role || (user?.role_id === 'admin' ? 'admin' : null),
      counts: { all: Number(c?.all || 0), open: Number(c?.open || 0), awaiting: Number(c?.awaiting || 0) },
    });
  }
  return out;
}

export async function updateProduct(ctx, productId, data = {}) {
  await assertManager(ctx.user, productId);
  const patch = {};
  if ('name_ar' in data) patch.name_ar = requireText(data.name_ar, 'اسم المنتج مطلوب');
  if ('name_en' in data) patch.name_en = trim(data.name_en);
  if ('description' in data) patch.description = trim(data.description, 2000);
  if ('project_id' in data) patch.project_id = trim(data.project_id, 60);
  if ('brand_color' in data) patch.brand_color = colorOrNull(data.brand_color);
  // البادئة والمفتاح ونوعُ المنتج لا تُعدَّل بعد أول بند: المفاتيح المطبوعة في البريد وفي
  // رؤوس المهام تصير عندها أسماءً لا تدلّ على شيء.
  if ('item_prefix' in data) {
    const used = await get('SELECT id FROM product_item WHERE product_id = ? LIMIT 1', [productId]);
    if (used) throw badRequest('لا تُغيَّر بادئة الأرقام بعد أول بلاغ — الأرقام القديمة مطبوعة في الرسائل');
    patch.item_prefix = normalizePrefix(data.item_prefix);
  }
  if (!Object.keys(patch).length) return await get('SELECT * FROM product WHERE id = ?', [productId]);
  patch.updated_at = nowIso(); patch.updated_by = ctx.user.id;
  await tx(async () => {
    await update('product', productId, patch);
    await pAudit(ctx, { action: 'update', resource: 'product', resourceId: productId, detail: { fields: Object.keys(patch) } });
  });
  return await get('SELECT * FROM product WHERE id = ?', [productId]);
}

export async function archiveProduct(ctx, productId, archived = true) {
  assertAdmin(ctx.user);
  const p = await get('SELECT * FROM product WHERE id = ?', [productId]);
  if (!p) throw notFound('المنتج غير موجود');
  await tx(async () => {
    await update('product', productId, {
      archived_at: archived ? nowIso() : null, updated_at: nowIso(), updated_by: ctx.user.id,
    });
    await pAudit(ctx, { action: 'update', resource: 'product', resourceId: productId, detail: { archived: !!archived } });
  });
  return await get('SELECT * FROM product WHERE id = ?', [productId]);
}

// ── الفريق ───────────────────────────────────────────────────────────────────

export const listMembers = async (user, productId) => {
  await assertMember(user, productId);
  return await teamMembers(productId);
};

/** آخرُ مديرٍ لا يُنزَع ولا يُخفَّض: منتجٌ بلا مديرٍ يقف اعتمادُه إلى الأبد. */
async function assertNotLastManager(productId, userId) {
  const others = await get(
    `SELECT COUNT(*) AS n FROM product_member
      WHERE product_id = ? AND role = 'manager' AND active = 1 AND user_id != ?`, [productId, userId]);
  if (!Number(others?.n || 0)) {
    throw badRequest('لا بدّ من مدير منتجٍ واحدٍ على الأقل — عيِّن غيره أولاً');
  }
}

export async function addMember(ctx, productId, { user_id, role } = {}) {
  await assertManager(ctx.user, productId);
  if (!MEMBER_ROLES.includes(role)) throw badRequest('اختر دور العضو: مطوِّر أو مدير المنتج');
  const u = await get('SELECT id, name_ar FROM app_user WHERE id = ? AND active = 1 AND deleted_at IS NULL', [user_id]);
  if (!u) throw badRequest('الشخص المُضاف غير موجود');
  const existing = await get('SELECT * FROM product_member WHERE product_id = ? AND user_id = ?', [productId, user_id]);
  const now = nowIso();
  await tx(async () => {
    // الصفُّ المعطَّل يُحيا ولا يُستنسخ: الفهرس الفريد على (المنتج، الشخص) يمنع الثاني أصلاً،
    // وإحياؤه يحفظ تاريخ العضوية الأول بدل أن يمحوه.
    if (existing) {
      await update('product_member', existing.id, { role, active: 1, updated_at: now, updated_by: ctx.user.id });
    } else {
      await insert('product_member', {
        id: id('pmb'), product_id: productId, user_id, role, active: 1,
        created_at: now, created_by: ctx.user.id,
      });
    }
    await pAudit(ctx, { action: 'create', resource: 'product_member', resourceId: productId, detail: { user_id, role } });
  });
  return await teamMembers(productId);
}

export async function changeMemberRole(ctx, productId, userId, role) {
  await assertManager(ctx.user, productId);
  if (!MEMBER_ROLES.includes(role)) throw badRequest('اختر دور العضو: مطوِّر أو مدير المنتج');
  const m = await get('SELECT * FROM product_member WHERE product_id = ? AND user_id = ? AND active = 1', [productId, userId]);
  if (!m) throw notFound('هذا الشخص ليس في فريق المنتج');
  if (m.role === 'manager' && role !== 'manager') await assertNotLastManager(productId, userId);
  await tx(async () => {
    await update('product_member', m.id, { role, updated_at: nowIso(), updated_by: ctx.user.id });
    await pAudit(ctx, { action: 'update', resource: 'product_member', resourceId: productId, detail: { user_id: userId, role } });
  });
  return await teamMembers(productId);
}

export async function removeMember(ctx, productId, userId) {
  await assertManager(ctx.user, productId);
  const m = await get('SELECT * FROM product_member WHERE product_id = ? AND user_id = ? AND active = 1', [productId, userId]);
  if (!m) throw notFound('هذا الشخص ليس في فريق المنتج');
  if (m.role === 'manager') await assertNotLastManager(productId, userId);
  await tx(async () => {
    // تعطيلٌ لا حذف: البنود المسنَدة إليه تبقى تحمل اسمه، وسؤال «من كان في الفريق» يبقى مُجاباً.
    await update('product_member', m.id, { active: 0, updated_at: nowIso(), updated_by: ctx.user.id });
    await pAudit(ctx, { action: 'delete', resource: 'product_member', resourceId: productId, detail: { user_id: userId } });
  });
  return await teamMembers(productId);
}

// ── الجهات ───────────────────────────────────────────────────────────────────

export async function listTenants(user, productId) {
  await assertMember(user, productId);
  return await all('SELECT * FROM product_tenant WHERE product_id = ? ORDER BY name', [productId]);
}

export async function createTenant(ctx, productId, data = {}) {
  const { product } = await assertManager(ctx.user, productId);
  if (product.kind === 'internal') throw badRequest('المنتج الداخلي بلا جهات — بلاغاته تأتي من داخل المنصة');
  const tid = id('ptn');
  const now = nowIso();
  await tx(async () => {
    await insert('product_tenant', {
      id: tid, product_id: productId,
      name: requireText(data.name, 'اسم الجهة مطلوب'),
      client_id: trim(data.client_id, 60),
      project_id: trim(data.project_id, 60),
      internal: data.internal ? 1 : 0,
      created_at: now, created_by: ctx.user.id,
    });
    await pAudit(ctx, { action: 'create', resource: 'product_tenant', resourceId: tid, detail: { product_id: productId } });
  });
  return await get('SELECT * FROM product_tenant WHERE id = ?', [tid]);
}

export async function updateTenant(ctx, tenantId, data = {}) {
  const t = await get('SELECT * FROM product_tenant WHERE id = ?', [tenantId]);
  if (!t) throw notFound('الجهة غير موجودة');
  await assertManager(ctx.user, t.product_id);
  const patch = {};
  if ('name' in data) patch.name = requireText(data.name, 'اسم الجهة مطلوب');
  if ('client_id' in data) patch.client_id = trim(data.client_id, 60);
  if ('project_id' in data) patch.project_id = trim(data.project_id, 60);
  if ('internal' in data) patch.internal = data.internal ? 1 : 0;
  if (!Object.keys(patch).length) return t;
  patch.updated_at = nowIso(); patch.updated_by = ctx.user.id;
  await tx(async () => {
    await update('product_tenant', tenantId, patch);
    await pAudit(ctx, { action: 'update', resource: 'product_tenant', resourceId: tenantId, detail: { fields: Object.keys(patch) } });
  });
  return await get('SELECT * FROM product_tenant WHERE id = ?', [tenantId]);
}

export async function deleteTenant(ctx, tenantId) {
  const t = await get('SELECT * FROM product_tenant WHERE id = ?', [tenantId]);
  if (!t) throw notFound('الجهة غير موجودة');
  await assertManager(ctx.user, t.product_id);
  const used = await get('SELECT id FROM product_item WHERE tenant_id = ? LIMIT 1', [tenantId]);
  if (used) throw badRequest('لهذه الجهة بلاغاتٌ مسجَّلة — أوقف روابطها بدل حذفها');
  await tx(async () => {
    await run('DELETE FROM product_link WHERE tenant_id = ?', [tenantId]);
    await run('DELETE FROM product_tenant WHERE id = ?', [tenantId]);
    await pAudit(ctx, { action: 'delete', resource: 'product_tenant', resourceId: tenantId, detail: { product_id: t.product_id } });
  });
  return { ok: true };
}

// ── روابط الاستقبال ──────────────────────────────────────────────────────────

/** مئةٌ وثمانية وعشرون بتاً عشوائية: الرابط دائمٌ ويُشارَك، فلا يُخمَّن بالعدّ. */
export const newLinkToken = () => randomBytes(16).toString('base64url');

export async function listLinks(user, productId) {
  await assertMember(user, productId);
  return await all(
    `SELECT l.*, t.name AS tenant_name FROM product_link l
       LEFT JOIN product_tenant t ON t.id = l.tenant_id
      WHERE l.product_id = ? ORDER BY l.created_at DESC`, [productId]);
}

export async function createLink(ctx, productId, data = {}) {
  const { product } = await assertManager(ctx.user, productId);
  if (product.kind === 'internal') throw badRequest('المنتج الداخلي بلا روابط استقبال — بلاغاته تأتي من داخل المنصة');
  if (data.tenant_id) {
    const t = await get('SELECT id FROM product_tenant WHERE id = ? AND product_id = ?', [data.tenant_id, productId]);
    if (!t) throw badRequest('الجهة المختارة ليست من هذا المنتج');
  }
  const mode = IDENTITY_MODES.includes(data.identity_mode) ? data.identity_mode : 'optional';
  const lang = LINK_LANGS.includes(data.default_lang) ? data.default_lang : 'ar';
  const lid = id('plk');
  await tx(async () => {
    await insert('product_link', {
      id: lid, product_id: productId, tenant_id: data.tenant_id || null,
      token: newLinkToken(), identity_mode: mode, default_lang: lang,
      intro_ar: trim(data.intro_ar, 1000), intro_en: trim(data.intro_en, 1000),
      expires_on: dateOrNull(data.expires_on, 'تاريخ انتهاء الرابط'),
      enabled: data.enabled === false ? 0 : 1, visits: 0, submissions: 0,
      created_at: nowIso(), created_by: ctx.user.id,
    });
    await pAudit(ctx, { action: 'create', resource: 'product_link', resourceId: lid, detail: { product_id: productId, identity_mode: mode } });
  });
  return await get('SELECT * FROM product_link WHERE id = ?', [lid]);
}

export async function updateLink(ctx, linkId, data = {}) {
  const l = await get('SELECT * FROM product_link WHERE id = ?', [linkId]);
  if (!l) throw notFound('رابط الاستقبال غير موجود');
  await assertManager(ctx.user, l.product_id);
  const patch = {};
  if ('identity_mode' in data) {
    if (!IDENTITY_MODES.includes(data.identity_mode)) throw badRequest('اختر كيف يعرّف صاحب البلاغ بنفسه');
    patch.identity_mode = data.identity_mode;
  }
  if ('default_lang' in data) {
    if (!LINK_LANGS.includes(data.default_lang)) throw badRequest('اختر لغة الصفحة: العربية أو الإنجليزية');
    patch.default_lang = data.default_lang;
  }
  if ('intro_ar' in data) patch.intro_ar = trim(data.intro_ar, 1000);
  if ('intro_en' in data) patch.intro_en = trim(data.intro_en, 1000);
  if ('expires_on' in data) patch.expires_on = dateOrNull(data.expires_on, 'تاريخ انتهاء الرابط');
  if ('enabled' in data) patch.enabled = data.enabled ? 1 : 0;
  if ('tenant_id' in data) {
    if (data.tenant_id) {
      const t = await get('SELECT id FROM product_tenant WHERE id = ? AND product_id = ?', [data.tenant_id, l.product_id]);
      if (!t) throw badRequest('الجهة المختارة ليست من هذا المنتج');
    }
    patch.tenant_id = data.tenant_id || null;
  }
  if (!Object.keys(patch).length) return l;
  patch.updated_at = nowIso(); patch.updated_by = ctx.user.id;
  await tx(async () => {
    await update('product_link', linkId, patch);
    await pAudit(ctx, { action: 'update', resource: 'product_link', resourceId: linkId, detail: { fields: Object.keys(patch) } });
  });
  return await get('SELECT * FROM product_link WHERE id = ?', [linkId]);
}

/** رمزٌ جديدٌ للرابط نفسه: ما شاعَ منه يُبطَل، والجهة تبقى وإحصاؤها معها. */
export async function rotateLinkToken(ctx, linkId) {
  const l = await get('SELECT * FROM product_link WHERE id = ?', [linkId]);
  if (!l) throw notFound('رابط الاستقبال غير موجود');
  await assertManager(ctx.user, l.product_id);
  const token = newLinkToken();
  await tx(async () => {
    await update('product_link', linkId, { token, updated_at: nowIso(), updated_by: ctx.user.id });
    await pAudit(ctx, { action: 'update', resource: 'product_link', resourceId: linkId, detail: { rotated: true } });
  });
  return await get('SELECT * FROM product_link WHERE id = ?', [linkId]);
}

export async function deleteLink(ctx, linkId) {
  const l = await get('SELECT * FROM product_link WHERE id = ?', [linkId]);
  if (!l) throw notFound('رابط الاستقبال غير موجود');
  await assertManager(ctx.user, l.product_id);
  await tx(async () => {
    // البنودُ الواصلة منه تبقى، ويُفكّ ارتباطها كي لا يمنع الحذفَ مفتاحٌ أجنبي.
    await run('UPDATE product_item SET link_id = NULL WHERE link_id = ?', [linkId]);
    await run('DELETE FROM product_link WHERE id = ?', [linkId]);
    await pAudit(ctx, { action: 'delete', resource: 'product_link', resourceId: linkId, detail: { product_id: l.product_id } });
  });
  return { ok: true };
}

// ── الإصدارات ────────────────────────────────────────────────────────────────

export async function listVersions(user, productId) {
  await assertMember(user, productId);
  return await all('SELECT * FROM product_version WHERE product_id = ? ORDER BY COALESCE(released_on, created_at) DESC', [productId]);
}

export async function createVersion(ctx, productId, data = {}) {
  await assertManager(ctx.user, productId);
  const vid = id('pvr');
  await tx(async () => {
    await insert('product_version', {
      id: vid, product_id: productId,
      label: requireText(data.label, 'وسم الإصدار مطلوب', 60),
      released_on: dateOrNull(data.released_on, 'تاريخ الإصدار'),
      note: trim(data.note, 1000),
      created_at: nowIso(), created_by: ctx.user.id,
    });
    await pAudit(ctx, { action: 'create', resource: 'product_version', resourceId: vid, detail: { product_id: productId } });
  });
  return await get('SELECT * FROM product_version WHERE id = ?', [vid]);
}

export async function deleteVersion(ctx, versionId) {
  const v = await get('SELECT * FROM product_version WHERE id = ?', [versionId]);
  if (!v) throw notFound('الإصدار غير موجود');
  await assertManager(ctx.user, v.product_id);
  const used = await get('SELECT id FROM product_item WHERE resolved_version_id = ? LIMIT 1', [versionId]);
  if (used) throw badRequest('هذا الإصدار مذكورٌ في بلاغاتٍ محلولة — لا يُحذف');
  await tx(async () => {
    await run('DELETE FROM product_version WHERE id = ?', [versionId]);
    await pAudit(ctx, { action: 'delete', resource: 'product_version', resourceId: versionId, detail: { product_id: v.product_id } });
  });
  return { ok: true };
}

// ── الهوية البصرية: شعارٌ واحدٌ للمنتج ───────────────────────────────────────

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export async function setProductLogo(ctx, productId, bytes, { mime } = {}) {
  await assertManager(ctx.user, productId);
  const { sniffImageMime } = await import('../events/events.js');
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw badRequest('الصورة فارغة — اختر ملفاً آخر');
  if (bytes.length > LOGO_MAX_BYTES) throw badRequest('الشعار أكبر من اللازم — اجعله دون ميغابايتين');
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) throw badRequest('صيغة الصورة غير مدعومة — اختر صورةً عادية');
  const bid = id('pim');
  const now = nowIso();
  await tx(async () => {
    await insert('product_item_image', {
      id: bid, item_id: null, product_id: productId, kind: 'logo', caption: null,
      content: bytes, mime: mime && sniffed === mime ? mime : sniffed,
      size_bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      created_at: now, created_by: ctx.user.id,
    });
    await update('product', productId, { brand_blob_id: bid, updated_at: now, updated_by: ctx.user.id });
    await pAudit(ctx, { action: 'update', resource: 'product', resourceId: productId, detail: { logo: true } });
  });
  return { id: bid };
}

/** بايتات الشعار — العمود الثقيل يُطلب هنا وحده ولا يُقرأ الجدول بنجمة أبداً. */
export async function productLogo(productId) {
  const p = await get('SELECT brand_blob_id FROM product WHERE id = ?', [productId]);
  if (!p?.brand_blob_id) return null;
  return await get('SELECT id, content, mime, size_bytes, sha256 FROM product_item_image WHERE id = ?', [p.brand_blob_id]);
}

// حالاتُ البند تُعاد تصديراً من هنا كي لا تستورد طبقةُ المسارات ملفَّين لتبني منتقيَ حالة.
export { ITEM_STATUSES, productRole };
