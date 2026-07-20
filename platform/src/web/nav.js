// المصدر الوحيد لهوية الصفحات: من يرى ماذا في القائمة = من يُسمح له بفتح الصفحة.
// يستهلكه layout.js (إظهار القائمة) وroutes.js (تفويض 403) — فلا يمكن أن يختلفا أبداً.
import { can } from '../core/rbac/index.js';

const IO_TYPES_READ = ['opportunity', 'project', 'client', 'employee', 'allocation', 'revenue'];

// من يفتح الصفحة؟ (مفاتيح PAGES في routes.js)
export const PAGE_ACCESS = {
  ceo: (u) => u.scope === 'company',
  portfolio: (u) => u.scope === 'company',
  sector: (u) => can(u, 'read', 'project') || can(u, 'read', 'opportunity'),
  opportunities: (u) => can(u, 'read', 'opportunity'),
  'my-opportunities': (u) => can(u, 'read', 'opportunity'),
  projects: (u) => can(u, 'read', 'project'),
  clients: (u) => can(u, 'read', 'client') || u.scope === 'company',
  tasks: () => true,
  timesheet: () => true,
  approvals: (u) => ['admin', 'sector_lead', 'finance', 'department_manager', 'line_manager', 'approver', 'ceo_office'].includes(u.role_id),
  finance: (u) => can(u, 'read', 'invoice') || can(u, 'read', 'contract'),
  team: (u) => can(u, 'read', 'employee'),
  imports: (u) => u.role_id === 'admin' || ['client', 'employee', 'opportunity', 'project', 'allocation', 'revenue_line'].some((r) => can(u, 'read', r) || can(u, 'create', r) || can(u, 'update', r)),
  reports: (u) => can(u, 'read', 'report'),
  mail: (u) => ['admin', 'ceo_office'].includes(u.role_id),
  org: (u) => u.role_id === 'admin' || can(u, 'create', 'sector') || can(u, 'create', 'employee'),
  users: (u) => u.role_id === 'admin',
  audit: (u) => u.role_id === 'admin',
};

// صفحات التفاصيل ذات المعاملات (خارج خريطة PAGES): نفس منطق صفحتها الأم؛
// تدقيق مستوى السجل نفسه يتم داخل الخدمة (نطاق/ملكية).
export const DETAIL_ACCESS = {
  project: PAGE_ACCESS.projects,
  contract: PAGE_ACCESS.finance,
  client: PAGE_ACCESS.clients,
  opportunity: PAGE_ACCESS.opportunities,
};

// عناصر القائمة الجانبية (المفاتيح تطابق PAGE_ACCESS — الإظهار من نفس الدالة)
export const NAV_ITEMS = [
  { key: 'ceo', ar: 'لوحة القيادة', ic: 'ceo', group: 'company' },
  { key: 'portfolio', ar: 'محفظة المشاريع', ic: 'portfolio', group: 'company' },
  { key: 'sector', ar: 'مركز القطاع', ic: 'sector', group: 'work' },
  { key: 'opportunities', ar: 'الفرص', ic: 'opportunity', group: 'work' },
  { key: 'my-opportunities', ar: 'فرصي', ic: 'flag', group: 'work' },
  { key: 'projects', ar: 'المشاريع', ic: 'projects', group: 'work' },
  { key: 'clients', ar: 'العملاء', ic: 'client', group: 'work' },
  { key: 'tasks', ar: 'مهامي', ic: 'tasks', group: 'work' },
  { key: 'timesheet', ar: 'سجل الوقت', ic: 'timesheet', group: 'work' },
  { key: 'approvals', ar: 'الاعتمادات', ic: 'approvals', group: 'work' },
  { key: 'finance', ar: 'المالية والعقود', ic: 'money', group: 'manage' },
  { key: 'team', ar: 'الفريق والطاقة', ic: 'team', group: 'manage' },
  { key: 'imports', ar: 'البيانات', ic: 'upload', group: 'manage' },
  { key: 'reports', ar: 'التقارير والبريد', ic: 'reports', group: 'manage' },
  { key: 'mail', ar: 'مركز البريد', ic: 'mail', group: 'admin' },
  { key: 'org', ar: 'الهيكل التنظيمي', ic: 'sector', group: 'admin' },
  { key: 'users', ar: 'المستخدمون والصلاحيات', ic: 'users', group: 'admin' },
  { key: 'audit', ar: 'سجل التدقيق', ic: 'audit', group: 'admin' },
];

export function pageAllowed(user, key) {
  const fn = PAGE_ACCESS[key];
  try { return fn ? !!fn(user) : false; } catch { return false; }
}
