// Build a SQL WHERE fragment that limits rows to the user's data scope for (resource, action).
// Returns { clause, params }. Applied to list queries so scoping is enforced in the DB, not the app.
import { effectiveScope } from './index.js';
import { departmentScope, departmentInSql } from './departments.js';

export function scopeFilter(user, resource, action = 'read', opts = {}) {
  const scope = effectiveScope(user, action, resource);
  const sectorCol = opts.sectorCol || 'sector_id';
  const ownerCol = opts.ownerCol || 'owner_user_id';
  if (!scope) return { clause: '1=0', params: [] }; // no permission → no rows
  switch (scope) {
    case 'company':
      return { clause: '1=1', params: [] };
    case 'sector':
      return { clause: `${sectorCol} = ?`, params: [user.sector_id] };
    case 'department': {
      // القيد معروف ويفشل **مفتوحاً** (قراءة أوسع، لا انهيار): منح «الإدارة» يتحوّل عملياً إلى
      // القطاع كله لأن الاستعلام لا يعرف عمود الإدارة ما لم يُمرَّر له.
      // تحديث بعد الموجة 007: العمود **صار موجوداً** على المشروع والفرصة والتسكين، فالتضييق
      // متاح تقنياً بتمرير opts.deptCol. لكنه **لا يُفعَّل قبل نسبة البيانات**: اليوم لا سجل
      // واحد منسوب إلى إدارة، فتضييق النطاق الآن يعني أن مدير الإدارة لا يرى شيئاً إطلاقاً —
      // أي استبدال تسريبٍ بعُطل. الترتيب الصحيح: تُنسَب الأعمال أولاً (شاشة «غير المُسنَد»)،
      // ثم يُمرَّر deptCol في استعلامات القوائم. متتبَّع في docs/OPEN-DECISIONS.md.
      // وحين يُفعَّل: الشرط عضويةٌ في **مجموعة إدارات القارئ** (انتماؤه ∪ ما يقوده) لا مساواة
      // بإدارة واحدة — فمن يقود إدارتين لا يُقصّ استعلامه على إحداهما ويُترك أهل الثانية خارج
      // كل قائمة يفتحها.
      const deptIds = departmentScope(user);
      return opts.deptCol && deptIds.length
        ? departmentInSql(opts.deptCol, deptIds)
        : { clause: `${sectorCol} = ?`, params: [user.sector_id] };
    }
    case 'project': {
      const ids = [...(user.projectIds || [])];
      if (!ids.length) return { clause: '1=0', params: [] };
      // The project table itself keys on `id`; child tables (task/deliverable/…) key on `project_id`.
      const col = opts.projectCol || (resource === 'project' ? 'id' : 'project_id');
      return { clause: `${col} IN (${ids.map(() => '?').join(',')})`, params: ids };
    }
    case 'team':
    case 'own':
      return { clause: `${ownerCol} = ?`, params: [user.id] };
    default:
      return { clause: '1=0', params: [] };
  }
}
