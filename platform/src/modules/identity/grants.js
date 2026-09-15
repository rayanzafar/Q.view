// ═══ الصلاحيات الشخصية: على إدارة، أو قطاع، أو الشركة — وفي حِزم، وبمدة ═══════════════════════
//
// «ممكن أنا أحطّ على سجى إنها تشوف كل فرص إدارة الابتكار مو بس المسكَّنة عليها… ومدير القطاع
// يقدر يعطي صلاحيات كعينه، ومدير الإدارة يقدر يعطي صلاحيات» — بلسان المالك (ترحيلة 025).
// ثم (١٥ سبتمبر ٢٠٢٦، ADR-0025): «كيف ممكن ندير الصلاحيات والفيتشرز لكل موظف بطريقة سهلة» —
// فصار المنحُ حِزماً بالعربية (تطوير الأعمال، إدارة المشاريع…) على إدارةٍ أو قطاعٍ كامل، وبمدةٍ إن
// أُريد، من صفحة الموظف ومن المحادثة.
//
// وهذا الملف هو **حدّ** تلك القدرة لا مجرّد كتابتها. القاعدة التي يقوم عليها كل ما تحته:
//
//        لا يمنح أحدٌ ما لا يملكه.
//
// وهي ليست شعاراً: التفويض بلا هذا القيد يجعل أي مدير إدارةٍ قادراً على أن يمنح نفسه — أو من
// يشاء — رؤيةَ الشركة كلها بخطوتين، فينهار كل ما بُني في محرّك الصلاحيات من فوق. فالفحص هنا
// يسأل عن المانح ثلاثة أسئلة، وسقوط أيّها يوقف المنح:
//   ① هل يقرأ هذا المورد **في هذا الهدف** فعلاً؟ (`can` على صفٍّ افتراضي يحمل قطاعه وإدارته)
//   ② هل اتساعه يبلغ الهدف فأوسع؟ الإدارةَ يبلغها مديرُها وقائدُ قطاعها ومديرُ النظام؛ والقطاعَ
//      يبلغه قائدُه ومديرُ النظام؛ والشركةَ مديرُ النظام ومن نطاقُه شركيٌّ على المورد.
//   ③ هل هذا الشخص من أهله؟ (نفس سؤال «من يؤكّد تسكين فلان» — مصدرٌ واحد لا نسختان)
//
// ولا يمنح أحدٌ **نفسه**. والقاعدة مطلقة بلا استثناء لمدير النظام — لا لأنه غير موثوق، بل لأن
// «فلانٌ منح فلاناً» جملةٌ تُراجَع، و«فلانٌ منح نفسه» ليست مراجعةً بل حلقة مغلقة.
//
// ── ولا يُمنَح إلا ما هو موصولٌ فعلاً ────────────────────────────────────────
// `GRANTABLE` قائمة مغلقة، وشرط الدخول فيها **ليس** أن الصلاحية معقولة بل أن تكون هناك شاشةٌ
// تقرؤها اليوم. ومنحُ ما لا يقرؤه شيء يُنتج أسوأ حالة في منتج: مالكٌ يمنح، ولا يتغيّر شيء، ولا
// خطأ يظهر — فيظنّ العطل في المنصة أو في فهمه. تُوسَّع القائمة مع كل استعلامٍ يُوصَل، لا قبله.
//
// ── والمدة تُقرأ لحظةَ بناء السياق لا بمهمةٍ ليلية ─────────────────────────
// المنح المنتهي لا يُحمَّل مع الطلب (grantsForUser)، فيسقط أثره في اللحظة التي ينتهي فيها يومه
// الأخير — بلا مؤقّتٍ يُنسى ولا صفٍّ يُحذف: يبقى الصفّ أثراً تقرؤه بطاقة الشخص «انتهت في…».
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { inDepartmentScope } from '../../core/rbac/departments.js';
import { SCOPE_RANK } from '../../core/rbac/matrix.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { id, nowIso } from '../../core/util/ids.js';
import { audit } from '../../core/audit/index.js';
import { riyadhDate } from '../../core/i18n/time.js';
import { ownsEmployee } from '../org/confirm.js';

export const GRANT_LEVELS = Object.freeze(['department', 'sector', 'company']);
export const LEVEL_AR = Object.freeze({ department: 'إدارة', sector: 'قطاع كامل', company: 'الشركة كلها' });

// المورد ⟵ ما يظهر للمستخدم، وأين يظهر أثره. النصّ هنا هو نصّ الشاشة: لا مصطلح يُترجَم مرتين.
// و`levels`: المستويات التي يُوصَل بها الزوج فعلاً — الفرص والمشاريع بالإدارة أو القطاع (القوائم
// والصفوف تقرأ العمودين)، والفعاليات على مستوى الشركة وحدها (مواردها شركيةٌ في المصفوفة).
export const GRANTABLE = [
  {
    resource: 'opportunity', action: 'read', levels: ['department', 'sector'],
    label: 'يرى كل فرص الإدارة',
    effect: 'تظهر له فرص هذه الإدارة كاملةً في شاشة «الفرص» — لا المسكَّن عليها وحده. و«فرصي» تبقى شخصية.',
  },
  {
    resource: 'opportunity', action: 'create', levels: ['department', 'sector'],
    label: 'يضيف فرصاً لهذه الإدارة',
    effect: 'يفتح له تسجيل فرصة جديدة تُنسب إلى هذه الإدارة — لا إلى غيرها.',
  },
  {
    resource: 'opportunity', action: 'update', levels: ['department', 'sector'],
    label: 'يعدّل فرص الإدارة',
    effect: 'يفتح له تعديل فرص هذه الإدارة من صفحة الفرصة — وفي المشتركة مع غيرها تبقى حقول النسبة لإدارتها المسؤولة.',
  },
  {
    resource: 'project', action: 'read', levels: ['department', 'sector'],
    label: 'يرى كل مشاريع الإدارة',
    effect: 'تظهر له مشاريع هذه الإدارة في شاشة «المشاريع» وتُفتح صفحاتها — بما فيها ما تشارك فيه الإدارة مع غيرها.',
  },
  {
    resource: 'project', action: 'create', levels: ['department', 'sector'],
    label: 'يضيف مشاريع لهذه الإدارة',
    effect: 'يفتح له تسجيل مشروع جديد يُنسب إلى هذه الإدارة — لا إلى غيرها.',
  },
  {
    resource: 'project', action: 'update', levels: ['department', 'sector'],
    label: 'يعدّل مشاريع الإدارة',
    effect: 'يفتح له تعديل مشاريع الإدارة ومخرجاتها وفريقها — وفي المشترك مع غيرها تبقى حقول النسبة للإدارة المسؤولة.',
  },
  // ── توسعة v5.60: إدارة الفعاليات تُمنَح بالأشخاص ────────────────────────────
  // المعرض معرضُ الشركة كلها (ADR-0013، matrix.js): مواردُ الفعاليات نطاقُها «شركة» في
  // المصفوفة، وأبوابُ خدمتها تُنادي can() بلا صفّ هدف. فمستواها «الشركة» صراحةً منذ 049 — وكانت
  // قبلها تُكتب على إدارةٍ قيداً للجدول لا للأثر. ومَن يمنحها محكومٌ بالقاعدة القائمة: قادةُ
  // القطاعات ومكتبُ الرئيس التنفيذي ومديرُ النظام يملكونها؛ مديرُ الإدارة لا يملكها فلا يمنحها.
  {
    resource: 'event', action: 'create', levels: ['company'],
    label: 'ينشئ فعاليات (للشركة كلها)',
    effect: 'يفتح له إنشاء فعالية جديدة من شاشة «الفعاليات» باسمه — والفعاليات على مستوى الشركة لا الإدارة.',
  },
  {
    resource: 'event', action: 'update', levels: ['company'],
    label: 'يعدّل الفعاليات ويغلقها (للشركة كلها)',
    effect: 'يفتح له تعديل تفاصيل أي فعالية وإغلاقها بعد انتهائها — على مستوى الشركة لا الإدارة.',
  },
  // ── سحب v5.70: «يحذف فعاليات» خرج من القائمة ────────────────────────────────
  // حذفُ الفعالية يمحو صور بطاقاتها ورموز كشكها محواً فعلياً لا رجعة فيه، فبابه مدير النظام
  // وحده (قرار حسين ٢٠٢٦-٠٩-٠١ — matrix.js وADR-0013). والصفوف القديمة بـevent:delete تبطل
  // بنفسها: `grantsForUser()` أدناه يمرّر كل صفٍّ على `isGrantable()` ويُسقط ما ليس في القائمة.
  {
    resource: 'event_contact', action: 'delete', levels: ['company'],
    label: 'يحذف بطاقات الآخرين في الفعاليات (للشركة كلها)',
    effect: 'يفتح له حذف أي بطاقة التقطها زميل — لتنظيف المكرَّر والخاطئ أثناء المعرض وبعده.',
  },
  {
    resource: 'event_partner', action: 'delete', levels: ['company'],
    label: 'يحذف شراكات الآخرين في الفعاليات (للشركة كلها)',
    effect: 'يفتح له حذف أي شراكة سجّلها زميل في الفعالية — لتنظيف السجل قبل المراجعة.',
  },
];
export const isGrantable = (resource, action) =>
  GRANTABLE.some((g) => g.resource === resource && g.action === action);
const pairOf = (resource, action) => GRANTABLE.find((g) => g.resource === resource && g.action === action) || null;

// ── الحِزم: ما يقوله المدير بلسانه، لا أزواج مورد/فعل ─────────────────────────
// «أبغى أعطيها صلاحية تضيف فرص لأنها شغالة في تطوير الأعمال» — جملةٌ واحدة تعني ثلاثة أزواج.
// الحزمة تُمنَح صفوفها معاً بمعرّفٍ واحد (bundle_id) وتُرفع معاً، و`{target}` في الأثر يُستبدل
// باسم الإدارة أو القطاع. وكل حزمةٍ مستوياتُها تقاطعُ مستويات أزواجها — فلا تعِد بمستوى لا يصله زوج.
const bundle = (key, label, effect, pairs) => ({
  key, label, effect, pairs,
  levels: GRANT_LEVELS.filter((l) => pairs.every(([r, a]) => (pairOf(r, a)?.levels || []).includes(l))),
});
export const GRANT_BUNDLES = Object.freeze([
  bundle('bd', 'تطوير الأعمال', 'يرى فرص {target} كلها، ويسجّل فرصاً جديدة تُنسب إليها، ويعدّلها من صفحة الفرصة.',
    [['opportunity', 'read'], ['opportunity', 'create'], ['opportunity', 'update']]),
  bundle('opp_read', 'الاطّلاع على الفرص', 'يرى فرص {target} كاملةً في شاشة «الفرص» — قراءةً بلا إضافة ولا تعديل.',
    [['opportunity', 'read']]),
  bundle('pm', 'إدارة المشاريع', 'يرى مشاريع {target} كلها، ويسجّل مشاريع جديدة تُنسب إليها، ويعدّلها بمخرجاتها وفريقها.',
    [['project', 'read'], ['project', 'create'], ['project', 'update']]),
  bundle('project_read', 'الاطّلاع على المشاريع', 'يرى مشاريع {target} وتُفتح صفحاتها — قراءةً بلا إضافة ولا تعديل.',
    [['project', 'read']]),
  bundle('events', 'إدارة الفعاليات', 'ينشئ فعاليات الشركة ويعدّل تفاصيلها ويغلقها بعد انتهائها.',
    [['event', 'create'], ['event', 'update']]),
  bundle('events_cleanup', 'تنظيف سجلات الفعاليات', 'يحذف بطاقات الزملاء وشراكاتهم المكرَّرة أو الخاطئة في أي فعالية.',
    [['event_contact', 'delete'], ['event_partner', 'delete']]),
]);
export const bundleOf = (key) => GRANT_BUNDLES.find((b) => b.key === key) || null;
// اسمُ القطاع يُعرض «… كله» في القوائم، والأثر يقول «فرص {target} كلها» — فيُسقَط «كله» من الاسم
// قبل التركيب كي لا يُقرأ «قطاع الحلول كله كلها».
export const effectOf = (b, targetName) => String(b?.effect || '')
  .replace('{target}', String(targetName || 'الإدارة').replace(/\s+كله$/, ''));

const levelOfRow = (r) => (r.level && GRANT_LEVELS.includes(r.level) ? r.level : 'department');
const todayKey = () => riyadhDate();
const isExpired = (r, today = todayKey()) => !!r.expires_at && String(r.expires_at).slice(0, 10) < today;

// ── ما يُحمَّل مع كل طلب ──────────────────────────────────────────────────────
// يُقرأ عند بناء سياق الطلب (`resolveUser`) لا عند الإقلاع: الصلاحية الشخصية تُمنَح وتُرفَع
// أثناء يوم العمل، ومنحٌ يبدأ أثره بعد إعادة تشغيل الخادم لا يصلح لأن يُدار من شاشة.
export async function grantsForUser(userId) {
  if (!userId) return [];
  const rows = await all(
    `SELECT g.resource, g.action, g.level, g.department_id, g.expires_at,
            COALESCE(g.sector_id, d.sector_id) sector_id
       FROM user_department_grant g
       LEFT JOIN department d ON d.id = g.department_id AND d.deleted_at IS NULL
      WHERE g.user_id = ? AND g.deleted_at IS NULL`, [userId]);
  const today = todayKey();
  // الإدارة المحذوفة ناعماً لا تُقرأ لصفّ الإدارة، وغير القابل للمنح يُسقَط، والمنتهي يُسقَط:
  // لو أُخرج موردٌ من القائمة يوماً، بطلت صفوفه القديمة في نفس اللحظة بلا ترحيلة.
  return rows
    .map((r) => ({ resource: r.resource, action: r.action, level: levelOfRow(r), department_id: r.department_id || null, sector_id: r.sector_id || null, expires_at: r.expires_at || null }))
    .filter((r) => isGrantable(r.resource, r.action) && !isExpired(r, today))
    .filter((r) => (r.level === 'department' ? !!r.department_id : r.level === 'sector' ? !!r.sector_id : true));
}

// ── حدُّ المنح يُقاس بنطاق المانح لا بقراءته ────────────────────────────────
// «مدير الإدارة يمنح إدارته، وقائد القطاع أي إدارة في قطاعه» — قرار المالك. **فرؤية شيءٍ ليست
// ملكاً لتوزيعه.** والمقياس نطاقُه الفعلي على المورد: شركيٌّ يبلغ الكل · قطاعيٌّ يبلغ قطاعه ·
// وإداريٌّ يبلغ ما يقوده وحده. ويُستعمل في البابين معاً — الفحص عند الحفظ والقائمة المعروضة —
// كي لا تعِد الشاشة بما يرفضه الخادم (وهو ما يحرسه فحصٌ قائم بعينه).
//
// `target`: { level, department_id, sector_id } — للإدارة كلاهما، وللقطاع القطاعُ وحده، وللشركة لا شيء.
function reachesForGrant(granter, target, resource, action) {
  const scope = effectiveScope(granter, action, resource);
  if (scope === 'company') return true;
  if (target.level === 'company') return false;
  if (scope === 'sector') return !!granter.sector_id && target.sector_id === granter.sector_id;
  if (scope === 'department') return target.level === 'department' && inDepartmentScope(granter, target.department_id);
  return false;
}
const minRankFor = (level) => SCOPE_RANK[level === 'company' ? 'company' : level === 'sector' ? 'sector' : 'department'];

export function mayGrantTarget(granter, target, resource, action) {
  const pair = pairOf(resource, action);
  if (!pair || !pair.levels.includes(target.level)) return false;
  if ((SCOPE_RANK[effectiveScope(granter, action, resource)] || 0) < minRankFor(target.level)) return false;
  const probe = target.level === 'company' ? null : { sector_id: target.sector_id, department_id: target.department_id || null };
  if (probe ? !can(granter, action, resource, probe) : !can(granter, action, resource)) return false;
  return reachesForGrant(granter, target, resource, action);
}

// ③ من أهله؟ — نفس سؤال تأكيد التسكين: مدير النظام يدير الكل، وغيرُه يدير من يبلغه سجلُّ موظفه.
async function managesGrantsOf(reader, targetUser) {
  if (reader.role_id === 'admin') return true;
  const emp = targetUser.employee_id
    ? targetUser.employee_id
    : (await get('SELECT id FROM employee WHERE user_id = ? AND deleted_at IS NULL', [targetUser.id]))?.id || null;
  if (!emp) return false;
  return !!await ownsEmployee(reader, emp);
}

async function assertMayGrant(granter, targetUser, target, resource, action) {
  const pair = pairOf(resource, action);
  if (!pair) throw badRequest('هذه الصلاحية غير متاحة للمنح من هنا — اختر من القائمة المعروضة');
  if (!pair.levels.includes(target.level)) {
    throw badRequest(`«${pair.label}» تُمنَح على ${pair.levels.map((l) => LEVEL_AR[l]).join(' أو ')} لا على ${LEVEL_AR[target.level]}`);
  }
  if (granter.id === targetUser.id) {
    throw forbidden('لا يمنح أحدٌ نفسه صلاحية — اطلبها ممن يملكها فوقك ليكون للمنح أثرٌ يُراجَع');
  }
  // ① و② معاً: القراءة في هذا الهدف، وباتساعٍ يبلغه فأوسع.
  if (!mayGrantTarget(granter, target, resource, action)) {
    throw forbidden(`لا تملك رؤية «${target.name_ar || LEVEL_AR[target.level]}» بنفسك على هذا المستوى — ولا يمنح أحدٌ ما لا يملكه`);
  }
  // ③ الشخص من أهلك: نفس سؤال تأكيد التسكين حرفاً — مصدرٌ واحد لا نسختان تتباعدان.
  const emp = targetUser.employee_id
    ? targetUser.employee_id
    : (await get('SELECT id FROM employee WHERE user_id = ? AND deleted_at IS NULL', [targetUser.id]))?.id || null;
  if (!emp) {
    if (granter.role_id !== 'admin') {
      throw forbidden('هذا الحساب غير مربوط بسجل موظف، فلا تُعرف إدارته ولا مَن يديره — اربطه أولاً من شاشة الفريق');
    }
    return;
  }
  if (!await ownsEmployee(granter, emp)) {
    throw forbidden('هذا الشخص خارج من تديرهم — الصلاحية تُمنَح لمن تديره');
  }
}

async function loadDept(departmentId) {
  const d = await get(
    'SELECT id, name_ar, sector_id FROM department WHERE id = ? AND deleted_at IS NULL', [departmentId]);
  if (!d) throw badRequest('الإدارة المختارة غير موجودة — حدّث القائمة وحاول مجدداً');
  return d;
}
async function loadSector(sectorId) {
  const s = await get('SELECT id, name_ar FROM sector WHERE id = ? AND deleted_at IS NULL', [sectorId]);
  if (!s) throw badRequest('القطاع المختار غير موجود — حدّث القائمة وحاول مجدداً');
  return s;
}

// الهدف من مدخلٍ: { level, department_id?, sector_id? } ⟵ هدفٌ محمَّل باسمه وقطاعه.
export async function resolveGrantTarget(data = {}) {
  const level = String(data.level || (data.department_id ? 'department' : data.sector_id ? 'sector' : '')).trim();
  if (!GRANT_LEVELS.includes(level)) throw badRequest('حدّد مستوى الصلاحية: إدارة، أو قطاع كامل، أو الشركة كلها');
  if (level === 'department') {
    if (!data.department_id) throw badRequest('اختر الإدارة التي تُمنَح عليها الصلاحية');
    const d = await loadDept(data.department_id);
    return { level, department_id: d.id, sector_id: d.sector_id, name_ar: d.name_ar };
  }
  if (level === 'sector') {
    if (!data.sector_id) throw badRequest('اختر القطاع الذي تُمنَح عليه الصلاحية');
    const s = await loadSector(data.sector_id);
    return { level, department_id: null, sector_id: s.id, name_ar: `${s.name_ar} كله` };
  }
  return { level, department_id: null, sector_id: null, name_ar: LEVEL_AR.company };
}

async function loadTargetUser(userId) {
  const u = await get(
    'SELECT id, name_ar, username, role_id, employee_id, active FROM app_user WHERE id = ? AND deleted_at IS NULL',
    [userId]);
  if (!u) throw notFound('الحساب غير موجود');
  return u;
}

const SELECT_ROWS = `SELECT g.id, g.resource, g.action, g.level, g.department_id, g.note, g.created_at, g.expires_at,
            g.bundle_key, g.bundle_id, COALESCE(g.sector_id, d.sector_id) sector_id,
            d.name_ar department_name, s.name_ar sector_name, u2.name_ar granted_by_name
       FROM user_department_grant g
       LEFT JOIN department d ON d.id = g.department_id AND d.deleted_at IS NULL
       LEFT JOIN sector s ON s.id = COALESCE(g.sector_id, d.sector_id) AND s.deleted_at IS NULL
       LEFT JOIN app_user u2 ON u2.id = g.granted_by`;

const targetNameOf = (r) => (levelOfRow(r) === 'department' ? (r.department_name || 'إدارة محذوفة')
  : levelOfRow(r) === 'sector' ? `${r.sector_name || 'قطاع محذوف'} كله` : LEVEL_AR.company);

/** قائمة صلاحيات شخصٍ واحد صفاً صفاً — للعرض في بطاقته ولمن يقرأ الكشف. */
export async function listUserGrants(reader, userId) {
  const u = await loadTargetUser(userId);
  // من يرى الكشف يرى صلاحيات أهله: نفس بوابة الشاشة التي تُعرض فيها، لا بوابةٌ ثالثة.
  if (reader.role_id !== 'admin' && reader.id !== u.id && !can(reader, 'read', 'employee')) {
    throw forbidden('عرض صلاحيات شخصٍ آخر يتطلب صلاحية عرض الفريق');
  }
  const rows = await all(`${SELECT_ROWS} WHERE g.user_id = ? AND g.deleted_at IS NULL ORDER BY g.created_at`, [userId]);
  const today = todayKey();
  return rows.filter((r) => isGrantable(r.resource, r.action)).map((r) => ({
    ...r,
    level: levelOfRow(r),
    target_name: targetNameOf(r),
    expired: isExpired(r, today),
    label: pairOf(r.resource, r.action)?.label || '',
  }));
}

/**
 * الصلاحيات مجموعةً بحِزمها: ما مُنح معاً يُعرض سطراً واحداً ويُرفع بنقرة واحدة. و`revocable` هي
 * حكمُ الرفع نفسه لهذا القارئ (الحدّ ① و② على كل زوج، و③ على الشخص) — فلا يُعرض زرٌّ يُرَدّ.
 */
export async function listUserGrantGroups(reader, userId) {
  const rows = await listUserGrants(reader, userId);
  const u = await loadTargetUser(userId);
  const manages = reader.id !== u.id && await managesGrantsOf(reader, u);
  const groups = new Map();
  for (const r of rows) {
    const key = r.bundle_id || r.id;
    if (!groups.has(key)) {
      const b = r.bundle_key ? bundleOf(r.bundle_key) : null;
      groups.set(key, {
        bundle_id: key, bundle_key: r.bundle_key || null,
        label: b ? b.label : r.label, effect: b ? effectOf(b, r.target_name) : (pairOf(r.resource, r.action)?.effect || ''),
        level: r.level, level_ar: LEVEL_AR[r.level], target_name: r.target_name,
        department_id: r.department_id || null, sector_id: r.sector_id || null, sector_name: r.sector_name || null,
        note: r.note || null, granted_by_name: r.granted_by_name || null, created_at: r.created_at,
        expires_at: r.expires_at || null, expired: r.expired, pairs: [], revocable: manages,
      });
    }
    const g = groups.get(key);
    g.pairs.push({ id: r.id, resource: r.resource, action: r.action, label: r.label });
    if (r.expired) g.expired = true;
    if (g.revocable && !mayGrantTarget(reader, { level: r.level, department_id: r.department_id || null, sector_id: r.sector_id || null }, r.resource, r.action)) g.revocable = false;
  }
  return [...groups.values()];
}

/**
 * الإدارات التي يستطيع هذا المانح أن يمنحها لهذا المورد — تُبنى بنفس الحدّ الذي يفحصه المنح،
 * فلا تُعرض في القائمة إدارةٌ سيُردّ عنها عند الحفظ. (قائمةٌ تعرض ما يُرفَض هي وعدٌ يُخلَف.)
 */
export async function grantableDepartments(granter, resource = 'opportunity', action = 'read') {
  if (!isGrantable(resource, action)) return [];
  if (SCOPE_RANK[effectiveScope(granter, action, resource)] < SCOPE_RANK.department) return [];
  const rows = await all(`SELECT d.id, d.name_ar, d.sector_id, s.name_ar sector_name
     FROM department d LEFT JOIN sector s ON s.id = d.sector_id AND s.deleted_at IS NULL
    WHERE d.deleted_at IS NULL AND d.active = 1
    ORDER BY s.sort_order, d.name_ar`);
  return rows.filter((d) => mayGrantTarget(granter, { level: 'department', department_id: d.id, sector_id: d.sector_id }, resource, action));
}

/**
 * لوحة المنح على صفحة الشخص (أزواجاً): كل صلاحيةٍ قابلة للمنح ومعها إداراتُ هذا المانح لها.
 * تبقى للتوافق مع من يقرؤها؛ والشاشة تعرض الحِزم (grantableBundleOptions) منذ 049.
 */
export async function grantableOptions(granter) {
  const rows = await all(`SELECT d.id, d.name_ar, d.sector_id, s.name_ar sector_name
     FROM department d LEFT JOIN sector s ON s.id = d.sector_id AND s.deleted_at IS NULL
    WHERE d.deleted_at IS NULL AND d.active = 1
    ORDER BY s.sort_order, d.name_ar`);
  const out = [];
  for (const g of GRANTABLE) {
    if (!g.levels.includes('department')) continue;
    if ((SCOPE_RANK[effectiveScope(granter, g.action, g.resource)] || 0) < SCOPE_RANK.department) continue;
    const departments = rows
      .filter((d) => mayGrantTarget(granter, { level: 'department', department_id: d.id, sector_id: d.sector_id }, g.resource, g.action))
      .map((d) => ({ id: d.id, name_ar: d.name_ar, sector_name: d.sector_name || null }));
    if (departments.length) out.push({ ...g, departments });
  }
  return out;
}

/**
 * الحِزم التي يستطيع هذا المانح منحها، ومعها أهدافها: إداراتٌ (بقطاعها) وقطاعاتٌ كاملة والشركة —
 * كلُّ هدفٍ يمرّ على كل أزواج الحزمة بحكم الحفظ نفسه، فلا يُعرض خيارٌ سيُرَدّ.
 */
export async function grantableBundleOptions(granter) {
  const depts = await all(`SELECT d.id, d.name_ar, d.sector_id, s.name_ar sector_name
     FROM department d LEFT JOIN sector s ON s.id = d.sector_id AND s.deleted_at IS NULL
    WHERE d.deleted_at IS NULL AND d.active = 1
    ORDER BY s.sort_order, d.name_ar`);
  const sectors = await all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL AND active = 1 ORDER BY sort_order, name_ar');
  const out = [];
  for (const b of GRANT_BUNDLES) {
    const targets = [];
    const okFor = (target) => b.pairs.every(([r, a]) => mayGrantTarget(granter, target, r, a));
    // `short_ar` الاسمُ الخام للمطابقة بالاسم من المحادثة؛ و`name_ar` ما يُعرض («… كله» للقطاع).
    if (b.levels.includes('sector')) {
      for (const s of sectors) {
        if (okFor({ level: 'sector', department_id: null, sector_id: s.id })) targets.push({ level: 'sector', id: s.id, name_ar: `${s.name_ar} كله`, short_ar: s.name_ar, sector_name: null });
      }
    }
    if (b.levels.includes('department')) {
      for (const d of depts) {
        if (okFor({ level: 'department', department_id: d.id, sector_id: d.sector_id })) targets.push({ level: 'department', id: d.id, name_ar: d.name_ar, short_ar: d.name_ar, sector_name: d.sector_name || null });
      }
    }
    if (b.levels.includes('company') && okFor({ level: 'company', department_id: null, sector_id: null })) {
      targets.push({ level: 'company', id: '', name_ar: LEVEL_AR.company, short_ar: LEVEL_AR.company, sector_name: null });
    }
    if (targets.length) out.push({ key: b.key, label: b.label, effect: b.effect, levels: b.levels, pairs: b.pairs, targets });
  }
  return out;
}

// ── المدة ─────────────────────────────────────────────────────────────────────
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function expiresOnOf(v) {
  const s = String(v ?? '').trim().slice(0, 10);
  if (!s) return null;
  if (!DAY_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw badRequest('آخر يوم للصلاحية يُكتب بصيغة سنة-شهر-يوم — مثل 2026-12-31');
  if (s < todayKey()) throw badRequest('آخر يوم للصلاحية يكون اليوم أو بعده — التاريخ المكتوب مضى');
  return s;
}

// الصفّ الحيّ نفسه على الهدف نفسه — إن وُجد. (الإدارة والقطاع قد يكونان فارغين، فالمقارنة بـCOALESCE
// لا بـ`= ?` الذي لا يطابق الفراغ أبداً فيُنشئ صفّاً ثانياً في كل منح.)
const liveRowOf = (userId, resource, action, target) => get(
  `SELECT id, bundle_id FROM user_department_grant
    WHERE user_id = ? AND resource = ? AND action = ? AND level = ? AND deleted_at IS NULL
      AND COALESCE(department_id, '') = ? AND COALESCE(sector_id, '') = ?`,
  [userId, resource, action, target.level, target.department_id || '', target.sector_id || '']);

// ── المنح: زوجٌ مفرد (الباب القديم، يبقى للتوافق) ──────────────────────────────
// الزوجُ الذي يُمنَح على إدارةٍ يُكتب على الإدارة المختارة؛ والزوجُ الشركيّ (الفعاليات) يُكتب على
// الشركة وإن جاء مع إدارة — فالإدارة كانت قيدَ جدولٍ لا أثراً (انظر GRANTABLE)، وكتابتُها اليوم
// تعرض للمدير «على إدارة كذا» لصلاحيةٍ تعمل على الشركة كلها.
export async function grantDepartment(ctx, data = {}) {
  const granter = ctx.user;
  const targetUser = await loadTargetUser(data.user_id);
  const resource = String(data.resource || 'opportunity');
  const action = String(data.action || 'read');
  const pair = pairOf(resource, action);
  if (!pair) throw badRequest('هذه الصلاحية غير متاحة للمنح من هنا — اختر من القائمة المعروضة');
  const target = pair.levels.includes('department')
    ? await resolveGrantTarget({ level: 'department', department_id: data.department_id })
    : await resolveGrantTarget({ level: 'company' });
  await assertMayGrant(granter, targetUser, target, resource, action);
  const note = String(data.note || '').trim().slice(0, 200) || null;
  const expiresAt = expiresOnOf(data.expires_on);
  const now = nowIso();
  const existing = await liveRowOf(targetUser.id, resource, action, target);
  // المنح مرتين لا يُنشئ صفّين: الصفّ الثاني يجعل الرفع يحتاج نقرتين ويُظهر السطر مكرّراً في
  // بطاقةٍ يقرؤها المدير. والقائم يُحدَّث سببه ومدته فقط.
  if (existing) {
    const patch = {}; if (note) patch.note = note; if (data.expires_on !== undefined) patch.expires_at = expiresAt;
    if (Object.keys(patch).length) await update('user_department_grant', existing.id, patch);
    await audit(ctx, { action: 'update', resource: 'user_grant', resourceId: existing.id,
      sectorId: target.sector_id, detail: { user_id: targetUser.id, level: target.level, department_id: target.department_id, sector_id: target.sector_id, resource, action, expires_at: expiresAt } });
    return { ok: true, id: existing.id, already: true };
  }
  const gid = id('ugr');
  await tx(async () => {
    await insert('user_department_grant', {
      id: gid, user_id: targetUser.id, resource, action, level: target.level,
      department_id: target.department_id, sector_id: target.sector_id, bundle_key: null, bundle_id: gid,
      note, granted_by: granter.id, created_at: now, expires_at: expiresAt,
    });
  });
  await audit(ctx, { action: 'create', resource: 'user_grant', resourceId: gid,
    sectorId: target.sector_id,
    detail: { user_id: targetUser.id, level: target.level, department_id: target.department_id, sector_id: target.sector_id, resource, action, note, expires_at: expiresAt } });
  return { ok: true, id: gid, already: false };
}

/**
 * منحُ حزمةٍ على هدف: كل أزواجها تُفحص أولاً (فلا يُكتب نصفُ حزمة)، ثم تُكتب الصفوف الناقصة
 * بمعرّف حزمةٍ واحد. القائمُ منها على الهدف نفسه لا يُكرَّر — يُلحق بالحزمة ويُحدَّث سببُه ومدته.
 * data: { user_id, bundle, level, department_id?, sector_id?, note?, expires_on? }
 */
export async function grantBundle(ctx, data = {}) {
  const granter = ctx.user;
  const b = bundleOf(String(data.bundle || ''));
  if (!b) throw badRequest(`اختر حزمةً من القائمة: ${GRANT_BUNDLES.map((x) => x.label).join('، ')}`);
  const targetUser = await loadTargetUser(data.user_id);
  const target = await resolveGrantTarget({ level: data.level, department_id: data.department_id, sector_id: data.sector_id });
  if (!b.levels.includes(target.level)) throw badRequest(`«${b.label}» تُمنَح على ${b.levels.map((l) => LEVEL_AR[l]).join(' أو ')} لا على ${LEVEL_AR[target.level]}`);
  for (const [r, a] of b.pairs) await assertMayGrant(granter, targetUser, target, r, a);
  const note = String(data.note || '').trim().slice(0, 200) || null;
  const expiresAt = expiresOnOf(data.expires_on);
  const now = nowIso();
  const bundleId = id('ugb');
  let created = 0; let already = 0;
  await tx(async () => {
    for (const [r, a] of b.pairs) {
      const existing = await liveRowOf(targetUser.id, r, a, target);
      if (existing) {
        already += 1;
        await update('user_department_grant', existing.id, { bundle_key: b.key, bundle_id: bundleId, ...(note ? { note } : {}), expires_at: expiresAt });
        continue;
      }
      await insert('user_department_grant', {
        id: id('ugr'), user_id: targetUser.id, resource: r, action: a, level: target.level,
        department_id: target.department_id, sector_id: target.sector_id, bundle_key: b.key, bundle_id: bundleId,
        note, granted_by: granter.id, created_at: now, expires_at: expiresAt,
      });
      created += 1;
    }
    await audit(ctx, { action: 'create', resource: 'user_grant', resourceId: bundleId, sectorId: target.sector_id || null,
      detail: { user_id: targetUser.id, bundle: b.key, level: target.level, department_id: target.department_id, sector_id: target.sector_id, note, expires_at: expiresAt, created, already } });
  });
  return { ok: true, bundle_id: bundleId, bundle: b.key, label: b.label, target_name: target.name_ar, level: target.level, created, already, expires_at: expiresAt };
}

/** فحصُ المنح بلا كتابة — لمعاينة المحادثة: يعيد الهدف المحمَّل أو يرمي الرفض نفسه. */
export async function checkBundleGrant(granter, data = {}) {
  const b = bundleOf(String(data.bundle || ''));
  if (!b) throw badRequest(`اختر حزمةً من القائمة: ${GRANT_BUNDLES.map((x) => x.label).join('، ')}`);
  const targetUser = await loadTargetUser(data.user_id);
  const target = await resolveGrantTarget({ level: data.level, department_id: data.department_id, sector_id: data.sector_id });
  if (!b.levels.includes(target.level)) throw badRequest(`«${b.label}» تُمنَح على ${b.levels.map((l) => LEVEL_AR[l]).join(' أو ')} لا على ${LEVEL_AR[target.level]}`);
  for (const [r, a] of b.pairs) await assertMayGrant(granter, targetUser, target, r, a);
  return { bundle: b, targetUser, target, expires_at: expiresOnOf(data.expires_on) };
}

export async function revokeDepartmentGrant(ctx, grantId) {
  const granter = ctx.user;
  const row = await get(
    'SELECT * FROM user_department_grant WHERE id = ? AND deleted_at IS NULL', [grantId]);
  if (!row) throw notFound('الصلاحية غير موجودة أو رُفعت مسبقاً');
  const targetUser = await loadTargetUser(row.user_id);
  const target = await resolveGrantTarget({ level: levelOfRow(row), department_id: row.department_id, sector_id: row.sector_id });
  // الرفع بنفس حدّ المنح: من يستطيع أن يمنح هذه الصلاحية يستطيع أن يرفعها. وأيُّ حدٍّ أضيق
  // يُنتج صلاحيةً مُنحت ولا يقدر رافعها على رفعها — وهي أسوأ من ألّا تُمنَح.
  await assertMayGrant(granter, targetUser, target, row.resource, row.action);
  await update('user_department_grant', grantId, { deleted_at: nowIso(), revoked_by: granter.id });
  await audit(ctx, { action: 'delete', resource: 'user_grant', resourceId: grantId,
    sectorId: target.sector_id || null, detail: { user_id: row.user_id, department_id: row.department_id, sector_id: row.sector_id, level: target.level } });
  return { ok: true };
}

/** فحصُ الرفع بلا كتابة — لمعاينة المحادثة ولباب الرفع نفسه: الصفوف والهدف أو الرفض نفسه. */
export async function checkRevokeBundle(granter, bundleId) {
  const rows = await all('SELECT * FROM user_department_grant WHERE bundle_id = ? AND deleted_at IS NULL', [String(bundleId || '')]);
  if (!rows.length) throw notFound('الصلاحية غير موجودة أو رُفعت مسبقاً');
  const targetUser = await loadTargetUser(rows[0].user_id);
  const target = await resolveGrantTarget({ level: levelOfRow(rows[0]), department_id: rows[0].department_id, sector_id: rows[0].sector_id });
  for (const row of rows) await assertMayGrant(granter, targetUser, target, row.resource, row.action);
  const b = rows[0].bundle_key ? bundleOf(rows[0].bundle_key) : null;
  const label = b ? b.label : (pairOf(rows[0].resource, rows[0].action)?.label || '');
  return { rows, targetUser, target, label, bundle: b };
}

/** رفعُ حزمةٍ كاملة بمعرّفها: كل صفوفها الحيّة، بحدّ المنح نفسه على كلٍّ منها. */
export async function revokeBundle(ctx, bundleId) {
  const granter = ctx.user;
  const { rows, targetUser, target } = await checkRevokeBundle(granter, bundleId);
  const now = nowIso();
  await tx(async () => {
    for (const row of rows) await update('user_department_grant', row.id, { deleted_at: now, revoked_by: granter.id });
    await audit(ctx, { action: 'delete', resource: 'user_grant', resourceId: String(bundleId), sectorId: target.sector_id || null,
      detail: { user_id: targetUser.id, bundle: rows[0].bundle_key || null, level: target.level, department_id: target.department_id, sector_id: target.sector_id, rows: rows.length } });
  });
  return { ok: true, revoked: rows.length, target_name: target.name_ar, label: rows[0].bundle_key ? (bundleOf(rows[0].bundle_key)?.label || '') : (pairOf(rows[0].resource, rows[0].action)?.label || '') };
}
