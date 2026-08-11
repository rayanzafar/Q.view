// صندوق «ما ينتظرني» الواحد — مصدرٌ مشترك لشاشة الاعتمادات وبطاقة «صفحتي» وبريد التنبيه
// ومركز القطاع. كان كلُّ سطحٍ يجمع طابوره بنفسه، فيرى أحدُها ما لا يراه الآخر (مركز القطاع
// كان يقرأ طابور الأدوار وحده — وكلُّ الحجم الحيّ في الطلبات الموجَّهة بالشخص).
//
// `pendingApprovalsFor`: ما ينتظر قرار هذا الشخص — بدوره وبعينه معاً.
// `decorateApprovals`: نفس الصفوف بأسمائها المقروءة (اسم البند، جهته، من طلبه، نوعه) —
// استعلامٌ واحد لكل نوعٍ لا استعلامٌ في حلقة، من مصادر الأسماء الواحدة نفسها.
import { myApprovalQueue, myDirectApprovals } from './engine.js';
import { approvalTargets } from './targets.js';
import { namesByIds } from '../org/people.js';

// اسم النوع للموجَّه بالشخص — النوعان المُفعَّلان اليوم، ومصدرهما الواحد لكل من يسمّيهما
// (البطاقة والبريد ومركز القطاع). وما وراءهما يقع على اسم مساره (`workflow_name`) فلا
// يظهر اسمُ موردٍ تقني إن فُعِّل مسارٌ جديد قبل أن يُسمّى هنا.
export const DIRECT_KIND_AR = { task: 'اعتماد مهمة', membership: 'تأكيد تسكين' };

export async function pendingApprovalsFor(user) {
  return [...await myApprovalQueue(user), ...await myDirectApprovals(user)];
}

export async function decorateApprovals(rows) {
  const targets = await approvalTargets(rows);
  const names = await namesByIds(rows.map((a) => String(a.requested_by || '')));
  return rows.map((a) => {
    const t = targets.get(String(a.resource_id || '')) || null;
    return {
      ...a,
      label: t ? t.label : null,
      parent: (t && t.parent) || '',
      requesterName: names.get(String(a.requested_by || '')) || '',
      kindLabel: DIRECT_KIND_AR[a.resource] || a.workflow_name || 'طلب اعتماد',
      isDirect: !!a.assignee_user_id,
    };
  });
}
