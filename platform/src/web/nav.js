// المصدر الوحيد لهوية الصفحات: من يرى ماذا في القائمة = من يُسمح له بفتح الصفحة.
// يستهلكه layout.js (إظهار القائمة) وroutes.js (تفويض 403) — فلا يمكن أن يختلفا أبداً.

// سياسة فتح الصفحات انتقلت إلى `core/policy/pages.js`: تستهلكها القائمة وحارس 403 هنا،
// ويستهلكها الدليل والبحث خارج طبقة العرض. تُعاد التصدير من هنا كي تبقى نقطة الاستيراد
// المعتادة لملفات العرض كما هي — المصدر واحد والمكان الطبيعي لكل مستهلك محفوظ.
export { PAGE_ACCESS } from '../core/policy/pages.js';
import { PAGE_ACCESS } from '../core/policy/pages.js';

// صفحات التفاصيل ذات المعاملات (خارج خريطة PAGES): نفس منطق صفحتها الأم؛
// تدقيق مستوى السجل نفسه يتم داخل الخدمة (نطاق/ملكية).
export const DETAIL_ACCESS = {
  project: PAGE_ACCESS.projects,
  client: PAGE_ACCESS.clients,
  opportunity: PAGE_ACCESS.opportunities,
  event: PAGE_ACCESS.events,
};

// عناصر القائمة الجانبية (المفاتيح تطابق PAGE_ACCESS — الإظهار من نفس الدالة)
export const NAV_ITEMS = [
  // «صفحتي» أول عنصر ومجموعتُها وحدها: هي وجهة الدخول لكل من يفتح المنصة، والعودة إليها
  // يجب أن تكون النقرة الأوضح في القائمة لا سطراً مدفوناً بين شاشات الشركة.
  { key: 'home', ar: 'صفحتي', ic: 'home', group: 'me' },
  { key: 'ceo', ar: 'لوحة القيادة', ic: 'ceo', group: 'company' },
  { key: 'portfolio', ar: 'محفظة المشاريع', ic: 'portfolio', group: 'company' },
  { key: 'sector', ar: 'مركز القطاع', ic: 'sector', group: 'work' },
  { key: 'opportunities', ar: 'الفرص', ic: 'opportunity', group: 'work' },
  { key: 'my-opportunities', ar: 'فرصي', ic: 'flag', group: 'work' },
  { key: 'projects', ar: 'المشاريع', ic: 'projects', group: 'work' },
  { key: 'clients', ar: 'العملاء', ic: 'client', group: 'work' },
  { key: 'events', ar: 'الفعاليات', ic: 'megaphone', group: 'work' },
  { key: 'tasks', ar: 'مهامي', ic: 'tasks', group: 'work' },
  // «سجل الوقت» أُزيل من المنصة بطلب المالك. الصفحة والخدمة باقيتان في الكود لأن بيانات
  // الوقت تُقرأ في حسابات أخرى (الطاقة والإشغال)، لكنها لم تعد سطحاً يراه أحد — والإخفاء
  // من القائمة وحده لا يكفي، فالبوابة في policy/pages.js مغلقة كذلك.
  { key: 'approvals', ar: 'الاعتمادات', ic: 'approvals', group: 'work' },
  { key: 'guide', ar: 'دليلي', ic: 'list', group: 'work' },
  { key: 'team', ar: 'الفريق', ic: 'team', group: 'manage' },
  { key: 'staffing', ar: 'التسكين', ic: 'clock', group: 'manage' },
  { key: 'imports', ar: 'البيانات', ic: 'upload', group: 'manage' },
  { key: 'reports', ar: 'التقارير والبريد', ic: 'reports', group: 'manage' },
  { key: 'mail', ar: 'مركز البريد', ic: 'mail', group: 'admin' },
  { key: 'org', ar: 'الهيكل التنظيمي', ic: 'sector', group: 'admin' },
  { key: 'users', ar: 'المستخدمون والصلاحيات', ic: 'users', group: 'admin' },
  { key: 'audit', ar: 'سجل التدقيق', ic: 'audit', group: 'admin' },
  { key: 'ops', ar: 'صحة المنصة', ic: 'audit', group: 'admin' },
];

export function pageAllowed(user, key) {
  const fn = PAGE_ACCESS[key];
  try { return fn ? !!fn(user) : false; } catch { return false; }
}
