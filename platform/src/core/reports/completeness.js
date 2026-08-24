// «اكتمال البيانات» — عدّاد تغطيةٍ صادق: نِسَبٌ مسمّاة البسط والمقام من أعمدة حقيقية، لا نسبة
// واحدة غامضة. الدرجة المركّبة متوسط موزون (شدّة 8/4/1 على نسق org-quality) وتتحرك حين يُغلق
// صنفٌ كامل لا مع كل صف. بندٌ بلا مقام (لا عقود أصلاً مثلاً) يسقط من الوزن ولا يُحسب صفراً،
// وبنود الموارد الحساسة (عقود/فواتير/موظفون) تسقط لمن لا يقرأ مواردها ويعاد توزين الباقي —
// فلا تسريب ولا درجة مغشوشة. كل بند يحمل إرشاد إصلاحه ورابط قائمته.
import { get } from '../db/index.js';
import { can } from '../rbac/index.js';
import { projectYearClause } from '../../modules/pmo/projects.js';

const W = { high: 8, medium: 4, low: 1 };

export async function completenessScore(user, sectorId, { year } = {}) {
  const yc = projectYearClause(year, 'p.');
  const [opp, prj, dlv, emp, con, inv] = await Promise.all([
    get(`SELECT COUNT(*) total,
        SUM(CASE WHEN o.win_pct IS NOT NULL THEN 1 ELSE 0 END) wp,
        SUM(CASE WHEN o.next_action IS NOT NULL AND o.next_action != '' THEN 1 ELSE 0 END) na
      FROM opportunity o JOIN stage st ON st.id = o.stage_id
      WHERE o.sector_id = ? AND o.deleted_at IS NULL AND st.is_won = 0 AND st.is_lost = 0`, [sectorId]),
    yc ? get(`SELECT COUNT(*) total,
        SUM(CASE WHEN p.end_date IS NOT NULL THEN 1 ELSE 0 END) ed,
        SUM(CASE WHEN EXISTS(SELECT 1 FROM deliverable d WHERE d.project_id = p.id AND d.deleted_at IS NULL) THEN 1 ELSE 0 END) hd
      FROM project p
      WHERE p.sector_id = ? AND p.deleted_at IS NULL AND p.status != 'CANCELLED' AND ${yc.clause}`,
    [sectorId, ...yc.params]) : null,
    get(`SELECT COUNT(*) total,
        SUM(CASE WHEN accepted_at IS NOT NULL OR delivered_at IS NOT NULL OR status_at IS NOT NULL
                 OR (year IS NOT NULL AND month IS NOT NULL) THEN 1 ELSE 0 END) dated
      FROM deliverable WHERE sector_id = ? AND deleted_at IS NULL`, [sectorId]),
    can(user, 'read', 'employee') ? get(`SELECT COUNT(*) total,
        SUM(CASE WHEN e.job_title IS NOT NULL AND e.job_title != '' THEN 1 ELSE 0 END) jt,
        SUM(CASE WHEN EXISTS(SELECT 1 FROM allocation a WHERE a.employee_id = e.id AND a.year = ? AND a.deleted_at IS NULL) THEN 1 ELSE 0 END) al
      FROM employee e WHERE e.sector_id = ? AND e.active = 1 AND e.deleted_at IS NULL`, [year, sectorId]) : null,
    can(user, 'read', 'contract') ? get(`SELECT COUNT(*) total,
        SUM(CASE WHEN signed_at IS NOT NULL THEN 1 ELSE 0 END) sg
      FROM contract WHERE sector_id = ? AND deleted_at IS NULL`, [sectorId]) : null,
    can(user, 'read', 'invoice') ? get(`SELECT COUNT(*) total,
        SUM(CASE WHEN i.due_date IS NOT NULL THEN 1 ELSE 0 END) dd
      FROM invoice i LEFT JOIN project p ON p.id = i.project_id
      WHERE COALESCE(i.sector_id, p.sector_id) = ? AND i.deleted_at IS NULL AND i.status != 'CANCELLED'`, [sectorId]) : null,
  ]);

  const defs = [
    { id: 'opp_win_pct', sev: 'high', num: opp?.wp, den: opp?.total,
      label: 'فرص مفتوحة باحتمال فوز مسجّل', hint: 'سجّل احتمال الفوز من صفحة الفرصة', href: '/app/opportunities' },
    { id: 'opp_next_action', sev: 'high', num: opp?.na, den: opp?.total,
      label: 'فرص مفتوحة بخطوة تالية', hint: 'حدّد الخطوة التالية لكل فرصة مفتوحة', href: '/app/opportunities' },
    { id: 'prj_end_date', sev: 'high', num: prj?.ed, den: prj?.total,
      label: 'مشاريع بتاريخ انتهاء', hint: 'سجّل تاريخ انتهاء المشروع من صفحته', href: '/app/projects' },
    { id: 'prj_deliverables', sev: 'medium', num: prj?.hd, den: prj?.total,
      label: 'مشاريع لها مخرجات مسجّلة', hint: 'أضف مخرجات المشروع ليُقاس إنجازه وإيراده', href: '/app/projects' },
    { id: 'dlv_dates', sev: 'medium', num: dlv?.dated, den: dlv?.total,
      label: 'مخرجات مؤرّخة', hint: 'أرِّخ التسليم والقبول أو حدّد شهر الاستحقاق — عليها يُبنى منحنى الإيراد الشهري', href: '/app/projects' },
    { id: 'emp_job_title', sev: 'medium', num: emp?.jt, den: emp?.total,
      label: 'موظفون بمسمى وظيفي', hint: 'أكمل المسميات الوظيفية من صفحة الفريق', href: '/app/team' },
    { id: 'emp_alloc', sev: 'medium', num: emp?.al, den: emp?.total,
      label: 'موظفون على خطة التسكين', hint: 'سكِّن الموظفين على مشاريع أو أعمالٍ من لوحة التسكين', href: '/app/staffing' },
    { id: 'con_signed', sev: 'low', num: con?.sg, den: con?.total,
      label: 'عقود بتاريخ توقيع', hint: 'سجّل تاريخ توقيع كل عقد', href: '/app/finance' },
    { id: 'inv_due', sev: 'low', num: inv?.dd, den: inv?.total,
      label: 'فواتير بتاريخ استحقاق', hint: 'سجّل تاريخ استحقاق الفواتير ليصدق عدّاد التأخر', href: '/app/finance' },
  ];

  const items = [];
  let wSum = 0, wAcc = 0;
  for (const d of defs) {
    const den = Number(d.den || 0);
    if (!den) continue; // بند بلا مقام أو محجوب: لا يُحسب ولا يُوزن
    const num = Number(d.num || 0);
    const pct = Math.round((num / den) * 100);
    const weight = W[d.sev];
    items.push({ id: d.id, sev: d.sev, label: d.label, hint: d.hint, href: d.href, num, den, pct, weight });
    wSum += weight; wAcc += weight * pct;
  }
  return { score: wSum ? Math.round(wAcc / wSum) : null, items };
}
