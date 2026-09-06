// ── تأكيد التسكين: مَن يؤكّد أن هذا الموظف يعمل على هذا الشيء ─────────────────
//
// «مو إعارة، إنما تسكين — وعشان المدير يأكّد أن الموظف شغّال على هذا الشي، مو أي أحد يسكّن أي
// أحد في أي مكان. هذا بس، مدير القطاع ما يحتاج» — بلسان المالك.
//
// فالسؤال ليس «هل يُسمح لك» بل «هل يعلم مديرُه». والفرق عملي: الضمّ مفتوحٌ لمن يدير الفرصة —
// وهذا ما طلبه المالك صراحةً وبُني قبل هذه الموجة — لكن مَن ضمّ زميلاً من إدارةٍ أخرى لا يعرف
// ما الذي يشغله هناك. فيصل الطلبُ إلى مديره فيؤكّد أو يردّ. **خطوةٌ واحدة، ولا ثانيةَ فوقها.**
import { get } from '../../core/db/index.js';
import { departmentScope } from '../../core/rbac/departments.js';

/**
 * مدير الموظف: مديرُ إدارته المسجَّل في `department.manager_user_id`.
 *
 * ولا نصعد إلى قائد القطاع عند غيابه — قرار المالك: «مدير القطاع ما يحتاج». وموظفٌ بلا إدارة
 * أو بلا مديرٍ مسجَّل **لا معتمِد له**، فلا طلب يُنشأ ولا انتظار: الطلب المعلَّق بلا مُرسَلٍ
 * إليه لا يُقرأ أبداً، والتسكين يبقى معطَّلاً إلى الأبد بلا أن يعرف أحدٌ لماذا. الصمتُ في
 * الحالة هذه أسوأ من التمرير — والأثر مكتوبٌ في التدقيق على أي حال.
 */
export async function managerOfEmployee(employeeId) {
  if (!employeeId) return null;
  const e = await get('SELECT id, user_id, department_id FROM employee WHERE id = ? AND deleted_at IS NULL', [employeeId]);
  if (!e || !e.department_id) return null;
  const d = await get('SELECT manager_user_id FROM department WHERE id = ? AND deleted_at IS NULL', [e.department_id]);
  const mgr = d?.manager_user_id || null;
  // ولا يؤكّد المرءُ على نفسه: مديرٌ يضمّ نفسه لا ينتظر موافقةَ نفسه.
  return mgr && mgr !== e.user_id ? mgr : null;
}

/**
 * هل يملك هذا الشخص أمرَ ذلك الموظف — فيُسكّنه بلا تأكيد؟
 *
 * ثلاثة يملكونه: مدير النظام · قائد قطاعٍ أو أوسع (نطاقه يشمل الموظف) · ومَن يقود إدارة الموظف
 * فعلاً. وما عداهم يضمّ ويُنتظر التأكيد — بمن فيهم مدير إدارةٍ أخرى، وهو بالضبط ما قصده المالك:
 * «مو أي أحد يسكّن أي أحد في أي مكان».
 */
export async function ownsEmployee(user, employeeId) {
  if (!user || !employeeId) return false;
  if (user.role_id === 'admin') return true;
  const e = await get('SELECT id, user_id, sector_id, department_id FROM employee WHERE id = ? AND deleted_at IS NULL', [employeeId]);
  if (!e) return false;
  if (e.user_id && e.user_id === user.id) return true;              // يسكّن نفسه
  // نطاق القطاع فأوسع داخل قطاع الموظف: قائد القطاع يعرف أهله كلهم.
  if ((user.scope === 'company') || (user.scope === 'sector' && user.sector_id && user.sector_id === e.sector_id)) return true;
  // ومَن يقود إدارة الموظف — بمجموعة الإدارات التي يقودها لا بانتمائه وحده.
  return !!(e.department_id && departmentScope(user).includes(e.department_id));
}

/**
 * القرار كاملاً في نداءٍ واحد: هل يُكتب التسكين نشطاً، أم معلَّقاً بانتظار مَن.
 * @returns {Promise<{ needsConfirmation: boolean, approverUserId: string|null }>}
 */
export async function staffingConfirmation(user, employeeId) {
  if (await ownsEmployee(user, employeeId)) return { needsConfirmation: false, approverUserId: null };
  const approverUserId = await managerOfEmployee(employeeId);
  // بلا مديرٍ مسجَّل لا أحد يؤكّد — فلا يُعلَّق طلبٌ لا يقرؤه أحد.
  return approverUserId ? { needsConfirmation: true, approverUserId } : { needsConfirmation: false, approverUserId: null };
}
