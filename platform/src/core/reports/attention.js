// تغذية "يحتاج انتباهك الآن" — قلب مركز القطاع: ≤7 بنود مرتبة حسب أثر القرار،
// كل بند جملة عربية واحدة + إجراء سياقي واحد. مصادرها سجلات حقيقية فقط.
import { all } from '../db/index.js';
import { can } from '../rbac/index.js';
import { myApprovalQueue } from '../../modules/workflow/engine.js';
import { fmtSar } from '../util/ids.js';
import { ROT_THRESHOLDS } from '../../modules/crm/opportunities.js';
import { countAr } from '../i18n/plural.js';

// عتبات ركود المرحلة (أيام) — نفس مصدر لوحة الفرص حرفياً: المرحلة بلا عتبة لا تركد
// (كي يتطابق عدد «المتوقفة» هنا مع عدّاد اللوحة تماماً — لا رقمين مختلفين لنفس المؤشر)
const STAGE_ROT_DAYS = ROT_THRESHOLDS;

// أسماء موارد الاعتمادات بالعربية — لا يظهر اسم مورد تقني للمستخدم أبداً
export const RESOURCE_AR = { opportunity: 'فرصة', proposal: 'عرض', expense: 'مصروف',
  deliverable: 'مخرَج', timesheet: 'سجل وقت', invoice: 'فاتورة', project: 'مشروع', contract: 'عقد' };

export async function attentionFeed(user, sectorId, { year, today } = {}) {
  const t = today || new Date().toISOString().slice(0, 10);
  const y = year || new Date().getUTCFullYear();
  const m = Number(t.slice(5, 7));
  const items = [];

  // 1) قرارات بانتظارك (موافقات على دورك)
  try {
    const q = await myApprovalQueue(user);
    if (q.length) items.push({ rank: 1, tone: 'brand', icon: 'approvals', dd: null, href: '/app/approvals',
      title: `${countAr(q.length, { one: 'طلب اعتماد واحد', two: 'طلبا اعتماد', few: 'طلبات اعتماد', many: 'طلب اعتماد' })} بانتظار قرارك`,
      sub: q.slice(0, 2).map((r) => RESOURCE_AR[r.resource] || 'طلب').join(' · '),
      action: 'راجِع واعتمد' });
  } catch { /* قائمة الاعتمادات ليست لكل الأدوار */ }

  // 2) فواتير متأخرة السداد (نقد القطاع) — أرقام مالية: تظهر فقط لمن يقرأ الفواتير
  // قطاع الفاتورة = قطاعها إن حُدِّد، وإلا قطاع مشروعها. فواتير قديمة كثيرة لا تحمل القطاع مباشرة،
  // فالمقارنة على العمود وحده كانت تُسقطها من هنا بينما تظهر في تحصيل القطاع وفي «ما تغيّر» —
  // وهذا هو أسوأ ما يمكن أن يحدث للتنبيه الذي وُجد ليمنع الفوات. نفس تعبير الشاشتين حرفياً.
  const od = can(user, 'read', 'invoice') ? await all(`SELECT i.id, i.code, i.amount_halalas, i.due_date, c.name_ar client
      FROM invoice i LEFT JOIN project p ON p.id = i.project_id LEFT JOIN client c ON c.id = i.client_id
      WHERE COALESCE(i.sector_id, p.sector_id) = ? AND i.deleted_at IS NULL
        AND (i.status = 'OVERDUE' OR (i.status IN ('ISSUED','PARTIALLY_PAID') AND i.due_date IS NOT NULL AND substr(i.due_date,1,10) < ?))
      ORDER BY i.due_date LIMIT 12`, [sectorId, t]) : [];
  if (od.length) {
    const sum = od.reduce((a, b) => a + (b.amount_halalas || 0), 0);
    items.push({ rank: 2, tone: 'red', icon: 'money', href: '/app/finance',
      title: `مستحقات متأخرة بقيمة ${fmtSar(sum)} على ${countAr(od.length, { one: 'فاتورة واحدة', two: 'فاتورتين', few: 'فواتير', many: 'فاتورة' })}`,
      sub: od.slice(0, 2).map((i) => i.client || i.code || '').filter(Boolean).join(' · '),
      action: 'تابع التحصيل' });
  }

  // 3) فرص متوقفة (تجاوزت عمر مرحلتها) أو بلا خطوة تالية
  const open = await all(`SELECT o.id, o.title_ar, o.value_halalas, o.next_action, o.stage_changed_at, o.created_at, st.id stage_id, st.name_ar stage
      FROM opportunity o JOIN stage st ON st.id = o.stage_id
      WHERE o.sector_id = ? AND o.deleted_at IS NULL AND st.is_won = 0 AND st.is_lost = 0`, [sectorId]);
  const ageDays = (iso) => iso ? Math.floor((Date.parse(t) - Date.parse(String(iso).slice(0, 10))) / 86400000) : 0;
  const stalled = open.filter((o) => ageDays(o.stage_changed_at || o.created_at) > (STAGE_ROT_DAYS[o.stage_id] || STAGE_ROT_DAYS.default));
  if (stalled.length) {
    const sv = stalled.reduce((a, b) => a + (b.value_halalas || 0), 0);
    items.push({ rank: 3, tone: 'amber', icon: 'opportunity', href: '/app/opportunities',
      title: `${countAr(stalled.length, { one: 'فرصة واحدة متوقفة', two: 'فرصتان متوقفتان', few: 'فرص متوقفة', many: 'فرصة متوقفة' })} بقيمة ${fmtSar(sv)}`,
      sub: stalled.slice(0, 2).map((o) => o.title_ar).join(' · '),
      action: 'حرّك المراحل' });
  }
  const noNext = open.filter((o) => !o.next_action || String(o.next_action).trim() === '-' || String(o.next_action).trim() === '—');
  if (noNext.length >= 3) items.push({ rank: 4, tone: 'amber', icon: 'flag', href: '/app/opportunities',
    title: `${countAr(noNext.length, { one: 'فرصة مفتوحة', two: 'فرصتان مفتوحتان', few: 'فرص مفتوحة', many: 'فرصة مفتوحة' })} بلا خطوة تالية محددة`, sub: 'كل فرصة مفتوحة تحتاج خطوة تالية مؤرّخة', action: 'حدّد الخطوات' });

  // 4) مخرجات شهور سابقة لم تصل مرحلة الفوترة
  const late = await all(`SELECT d.name_ar, d.amount_halalas, d.month, p.name_ar project
      FROM deliverable d LEFT JOIN project p ON p.id = d.project_id
      WHERE d.sector_id = ? AND d.deleted_at IS NULL AND d.year = ?
        AND d.month < ? AND d.status IN ('PENDING','DELIVERED')
      ORDER BY d.month LIMIT 12`, [sectorId, y, m]);
  if (late.length) {
    const lv = late.reduce((a, b) => a + (b.amount_halalas || 0), 0);
    items.push({ rank: 5, tone: 'amber', icon: 'projects', dd: 'att-late-dlv',
      title: `${countAr(late.length, { one: 'مخرَج واحد', two: 'مخرَجان', few: 'مخرجات', many: 'مخرَجاً' })} من أشهر سابقة لم تُقبل أو تُفوتر (${fmtSar(lv)})`,
      sub: late.slice(0, 2).map((d) => d.project || d.name_ar).join(' · '),
      action: 'راجِع المخرجات', ddRowsData: late });
  }

  // 5) أشخاص فوق الطاقة الآن
  const allocs = await all(`SELECT a.employee_id, e.name_ar, a.monthly_json FROM allocation a
      JOIN employee e ON e.id = a.employee_id
      WHERE a.sector_id = ? AND a.deleted_at IS NULL AND a.year = ? AND a.employee_id IS NOT NULL`, [sectorId, y]);
  const loadNow = {};
  for (const a of allocs) {
    let mj = {}; try { mj = JSON.parse(a.monthly_json || '{}'); } catch { mj = {}; }
    loadNow[a.employee_id] = { name: a.name_ar, v: (loadNow[a.employee_id]?.v || 0) + (Number(mj[m]) || 0) };
  }
  const over = Object.values(loadNow).filter((x) => x.v > 1.1);
  if (over.length) items.push({ rank: 6, tone: 'red', icon: 'team', href: '/app/staffing',
    title: `${countAr(over.length, { one: 'موظف واحد محمّل فوق طاقته', two: 'موظفان فوق الطاقة', few: 'موظفين فوق الطاقة', many: 'موظفاً فوق الطاقة' })} هذا الشهر`,
    sub: over.slice(0, 3).map((x) => `${x.name} ${Math.round(x.v * 100)}%`).join(' · '),
    action: 'أعد توزيع التسكين' });

  // 6) مخاطر عالية مفتوحة
  const risks = await all(`SELECT r.title, p.name_ar project FROM risk r LEFT JOIN project p ON p.id = r.project_id
      WHERE (r.sector_id = ? OR p.sector_id = ?) AND r.deleted_at IS NULL AND r.status != 'CLOSED' AND r.probability = 'high'
      LIMIT 6`, [sectorId, sectorId]);
  if (risks.length) items.push({ rank: 7, tone: 'red', icon: 'audit', href: '/app/projects',
    title: countAr(risks.length, { one: 'خطر مرتفع الاحتمال مفتوح', two: 'خطران مرتفعا الاحتمال مفتوحان', few: 'مخاطر مرتفعة الاحتمال مفتوحة', many: 'خطراً مرتفع الاحتمال مفتوحاً' }),
    sub: risks.slice(0, 2).map((r) => r.project || r.title).join(' · '), action: 'راجِع المخاطر' });

  return items.sort((a, b) => a.rank - b.rank).slice(0, 7);
}
