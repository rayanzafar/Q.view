// Saved views — per-user, per-page snapshots of filter params (contracts §2, saved_view DDL 005).
// Strictly OWN-scoped: every read/write keys on user_id = caller; another user's view id behaves
// as "not found" (no existence leak). params_json stores a JSON object of query params.
import { all, get, insert, update, run } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { badRequest, notFound } from '../../core/http/errors.js';

export const MAX_VIEWS_PER_PAGE = 20;

function cleanPage(page) {
  const p = String(page || '').trim();
  if (!p || p.length > 60 || !/^[a-z0-9_-]+$/i.test(p)) throw badRequest('حدّد صفحة العرض المحفوظ');
  return p;
}

async function ownView(user, viewId) {
  const v = await get(
    'SELECT * FROM saved_view WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [viewId, user.id]);
  if (!v) throw notFound('العرض المحفوظ غير موجود');
  return v;
}

const shape = (v) => ({
  id: v.id, page: v.page, name_ar: v.name_ar, params_json: v.params_json,
  is_default: v.is_default, created_at: v.created_at,
});

export async function listViews(user, page) {
  const p = cleanPage(page);
  const rows = await all(
    `SELECT id, page, name_ar, params_json, is_default, created_at
       FROM saved_view WHERE user_id = ? AND page = ? AND deleted_at IS NULL
      ORDER BY is_default DESC, created_at`, [user.id, p]);
  return rows;
}

export async function saveView(ctx, data = {}) {
  const user = ctx.user;
  const page = cleanPage(data.page);
  const name = String(data.name_ar || '').trim();
  if (!name) throw badRequest('اسم العرض مطلوب');
  if (name.length > 60) throw badRequest('اسم العرض طويل — اجعله 60 حرفًا أو أقل');
  let params = data.params_json;
  if (params !== null && typeof params === 'object') params = JSON.stringify(params);
  params = String(params ?? '').slice(0, 2000);
  const cnt = await get(
    'SELECT COUNT(*) AS "n" FROM saved_view WHERE user_id = ? AND page = ? AND deleted_at IS NULL',
    [user.id, page]);
  if ((cnt?.n || 0) >= MAX_VIEWS_PER_PAGE) {
    throw badRequest(`بلغت الحد الأقصى (${MAX_VIEWS_PER_PAGE} عرضًا محفوظًا لهذه الصفحة) — احذف عرضًا قديمًا أولًا`);
  }
  const vid = id('sv');
  await insert('saved_view', {
    id: vid, user_id: user.id, page, name_ar: name, params_json: params,
    is_default: 0, created_at: nowIso(),
  });
  await audit(ctx, { action: 'create', resource: 'saved_view', resourceId: vid, detail: { page, name_ar: name } });
  return shape(await get('SELECT * FROM saved_view WHERE id = ?', [vid]));
}

export async function deleteView(ctx, viewId) {
  const v = await ownView(ctx.user, viewId);
  await update('saved_view', v.id, { deleted_at: nowIso() });
  await audit(ctx, { action: 'delete', resource: 'saved_view', resourceId: v.id, detail: { page: v.page, name_ar: v.name_ar } });
  return { ok: true };
}

// Make one view the default for its page; any other default on the same page is cleared.
export async function setDefault(ctx, viewId) {
  const v = await ownView(ctx.user, viewId);
  await run(
    'UPDATE saved_view SET is_default = 0 WHERE user_id = ? AND page = ? AND deleted_at IS NULL AND id != ?',
    [ctx.user.id, v.page, v.id]);
  await update('saved_view', v.id, { is_default: 1 });
  await audit(ctx, { action: 'update', resource: 'saved_view', resourceId: v.id, detail: { page: v.page, is_default: 1 } });
  return shape(await get('SELECT * FROM saved_view WHERE id = ?', [v.id]));
}
