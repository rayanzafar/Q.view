// سياسة فتح الصفحات — **من يفتح ماذا**. مكانها `core` لا `web` لأنها قرار صلاحيات لا عرض:
// يستهلكها العرض (القائمة الجانبية وحارس 403) ويستهلكها غير العرض (الدليل والبحث). وضعها في
// `web` أجبر مستهلكيها على أحد سيّئين: إما استيراد `web` من داخل `modules` (عكس اتجاه الطبقات
// المعلن)، أو نسخ الشروط يدوياً — وهو ما فعله البحث بأربعة شروط، وأول انحراف في نسخة منها
// يُنتج وعداً بشاشة يردّها النظام. المصدر هنا واحد، فلا انعكاس ولا نسخة ثانية.
// لا تستورد هذه الوحدة إلا من `core` كي تبقى صالحة لكل الطبقات.
import { can } from '../rbac/index.js';

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
  // «دليلي» صفحة شرح لكل من يدخل المنصة — لا شيء فيها يُحرس: محتواها نفسه مُرشَّح مسبقاً
  // بنفس بوابة الصلاحيات التي تسمح أو تمنع كل شاشة، فلا يصل المستخدم إلا لشرح ما يراه فعلاً.
  guide: () => true,
  approvals: (u) => ['admin', 'sector_lead', 'finance', 'department_manager', 'line_manager', 'approver', 'ceo_office'].includes(u.role_id),
  finance: (u) => can(u, 'read', 'invoice') || can(u, 'read', 'contract'),
  team: (u) => can(u, 'read', 'employee'),
  staffing: (u) => can(u, 'read', 'employee'),
  imports: (u) => u.role_id === 'admin' || ['client', 'employee', 'opportunity', 'project', 'allocation', 'revenue_line'].some((r) => can(u, 'read', r) || can(u, 'create', r) || can(u, 'update', r)),
  reports: (u) => can(u, 'read', 'report'),
  mail: (u) => ['admin', 'ceo_office'].includes(u.role_id),
  org: (u) => u.role_id === 'admin' || can(u, 'create', 'sector') || can(u, 'create', 'employee'),
  users: (u) => u.role_id === 'admin',
  audit: (u) => u.role_id === 'admin',
};
