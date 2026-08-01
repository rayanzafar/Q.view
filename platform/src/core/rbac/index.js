// RBAC decision engine — the ONLY place authorization is decided. Server-side, always.
import { all } from '../db/index.js';
import { SENSITIVE_FIELDS, SCOPE_RANK } from './matrix.js';
import { inDepartmentScope } from './departments.js';

// Grants are loaded from role_permission (DB) so admin edits take effect without redeploy.
// The cache is loaded ONCE at startup via initRbac() so the hot-path decision functions
// (can/redact/scopeReaches/…) stay SYNCHRONOUS even though the DB layer is async.
let _cache = null;
export async function initRbac() {
  const rows = await all('SELECT role_id, resource, action, scope FROM role_permission');
  const map = {};
  for (const g of rows) {
    (map[g.role_id] ||= []).push(g);
  }
  _cache = map;
  return map;
}
export const loadGrants = initRbac;              // backward-compatible alias (now async)
// تحميل المنح من الكود مباشرةً بلا قاعدة بيانات — لأدوات الفحص وحدها.
// أدوات الفحص تشتقّ توقعاتها من شروط فتح الصفحات، وهذه الشروط صارت تسأل هذا المحرّك. وربطُ
// الاشتقاق بقاعدة بيانات يجعله رهينةَ ما يصادف وجوده على القرص: نجح على جهاز فيه قاعدة قديمة،
// وفشل على معالج الفحص النظيف — فعاد اشتقاقٌ فارغ يُقرأ سماحاً. المنح للأدوار النظامية مصدرها
// الكود أصلاً (سكربت البذر يكتبها والخادم يبذرها عند كل إقلاع)، فالقراءة منها هنا ليست التفافاً
// بل رجوعٌ إلى المصدر نفسه. لا تُستخدَم في مسار التشغيل: `initRbac` عند الإقلاع يستبدلها.
export function primeGrantsFromCode(roleGrants) {
  const map = {};
  for (const [roleId, grants] of Object.entries(roleGrants || {}))
    map[roleId] = (grants || []).map((g) => ({ role_id: roleId, ...g }));
  _cache = map;
  return map;
}
export function invalidateGrants() { _cache = null; }
export async function reloadGrants() { return initRbac(); } // call after role edits
function grantsFor(roleId) {
  if (!_cache) throw new Error('RBAC grants not loaded — call initRbac() at startup before any authorization check');
  return _cache[roleId] || [];
}

/**
 * Core decision. Does `user` have `action` on `resource`, and (if `target` given)
 * does the user's scope reach the target's sector/department/project/owner?
 * @param {object} user  { id, role_id, sector_id, scope, employeeId, projectIds:Set }
 * @param {string} action
 * @param {string} resource
 * @param {object} [target] row with sector_id/department_id/project_id/owner_user_id/user_id
 */
// قرار صريح من المالك: الراتب لا يراه إلا **مدير النظام** حتى يتم التكامل مع Odoo
// ويصبح Odoo مصدر الحقيقة للتعويضات. التنفيذ بالحذف من المصفوفة: لا دور يملك منح
// 'salary' بعد اليوم، ومنح مدير النظام الشامل (`*`/admin) وحده هو ما يفتحه له.
export function can(user, action, resource, target = null) {
  if (!user || !user.role_id) return false;
  const grants = grantsFor(user.role_id);

  // wildcard admin
  if (grants.some((g) => g.resource === '*' && g.action === 'admin')) return true;

  // find matching grants (resource + action, or admin action which implies all)
  const matches = grants.filter(
    (g) => (g.resource === resource) && (g.action === action || g.action === 'admin')
  );
  if (!matches.length) return false;
  if (!target) return true; // permission exists; row-level check happens when a target is supplied

  // scope check: does ANY matching grant's scope reach this target?
  return matches.some((g) => scopeReaches(user, g.scope, target));
}

export function scopeReaches(user, scope, target) {
  switch (scope) {
    case 'company':
      return true;
    case 'sector':
      return !target.sector_id || target.sector_id === user.sector_id || (user.scope === 'company');
    case 'department': {
      // إدارة واحدة تعيش داخل قطاع واحد بالضبط. الشرط القديم كان `!target.department_id || …`
      // فيمرّ **فارغاً** على كل هدف لا يحمل عمود الإدارة — وأكثر الصفوف كذلك (المهمة والفرصة
      // وصف القطاع لا تحمل إدارة). النتيجة أن مدير إدارة في الاستشارات كان يجتاز فحصاً على
      // هدف يخصّ الحلول لمجرد أن الهدف لا يذكر إدارة.
      //
      // والمقارنة صارت **عضويةً في مجموعة إداراته** لا مساواةً بإدارة انتمائه: من يقود إدارتين
      // كان يُرَدّ عن صفوف الإدارة الثانية وهو مديرها المكتوب اسمه عليها — يوقّع اعتماد كشف
      // دوامٍ لموظفٍ يقوده، فيُرَدّ. المجموعة تُبنى عند الجلسة (rbac/departments.js).
      if (target.department_id) return inDepartmentScope(user, target.department_id);
      // بلا إدارة على الهدف لا نستطيع إثبات الانتماء، لكن نستطيع إثبات **النفي**: هدف يذكر
      // قطاعاً غير قطاع المستخدم هو قطعاً خارج إدارته. هذا يغلق التسريب العابر للقطاعات.
      if (target.sector_id && user.sector_id && target.sector_id !== user.sector_id) return false;
      // يبقى ما لا يُحسم: هدف بلا إدارة داخل القطاع نفسه. لا يُغلق هنا لأن الإغلاق الكامل يحرم
      // مدير الإدارة من صفوف مشروعة لا تحمل عمود إدارة أصلاً (المهام). الحسم الصحيح أن يحمل
      // كل صف إدارته — وهو ما بدأته الموجة 007 على المشروع والفرصة والتسكين.
      return true;
    }
    case 'project': {
      // A bare `project` row has no `project_id` column (only `id`) — fall back to it so the
      // project resource itself is actually membership-checked instead of vacuously passing.
      const pid = target.project_id ?? target.id;
      return !pid || (user.projectIds && user.projectIds.has(pid));
    }
    case 'team':
      // No caller anywhere sets target.team_id (team membership was never wired into
      // resolveUser()'s teamIds), so the old `!target.team_id ||` short-circuit made this scope
      // vacuously true for every target — fail closed instead until team membership is real.
      return !!(target.team_id && user.teamIds && user.teamIds.has(target.team_id));
    case 'own':
      return target.owner_user_id === user.id || target.user_id === user.id
        || target.assignee_user_id === user.id || target.requested_by === user.id
        || target.created_by === user.id;
    default:
      return false;
  }
}

// Highest scope the user holds for a resource+action (for building query filters).
export function effectiveScope(user, action, resource) {
  if (!user) return null;
  const grants = grantsFor(user.role_id);
  if (grants.some((g) => g.resource === '*' && g.action === 'admin')) return 'company';
  const matches = grants.filter((g) => g.resource === resource && (g.action === action || g.action === 'admin'));
  if (!matches.length) return null;
  // البذرة رتبةُ صفر لا رتبةُ «خاصتي». كانت المقارنة تبدأ من `SCOPE_RANK[best || 'own']`، فمن
  // منحُه الوحيد بنطاق «خاصتي» لا يتجاوز رتبتَه أبداً فتعود الدالة null — أي «بلا صلاحية» —
  // بينما هو يملك المنح فعلاً. الأثر الحيّ: scopeFilter يترجم null إلى «1=0» (لا صفوف إطلاقاً)،
  // فالاستشاري يملك فرصه ولا يرى منها واحدة في «فرصي»، والمستخدم الخارجي لا يرى مشاريعه.
  // حالة 'own' داخل scopeFilter (تصفية بالمالك) كانت كوداً ميتاً يشهد على النية الصحيحة.
  return matches.reduce((best, g) => ((SCOPE_RANK[g.scope] || 0) > (SCOPE_RANK[best] || 0) ? g.scope : best), null);
}

// Field-level redaction: remove sensitive fields the user isn't allowed to read.
export function redact(user, resource, row) {
  if (!row || typeof row !== 'object') return row;
  const sens = SENSITIVE_FIELDS[resource];
  if (!sens) return row;
  const out = { ...row };
  for (const [field, gate] of Object.entries(sens)) {
    if (field in out && !can(user, 'read', gate)) {
      out[field] = null;
      out[`_redacted_${field}`] = true;
    }
  }
  return out;
}
export function redactList(user, resource, rows) {
  return (rows || []).map((r) => redact(user, resource, r));
}

// Can this user see a given sensitive gate (salary/margin/cost/ip)?
export const canSeeSensitive = (user, gate) => can(user, 'read', gate);
