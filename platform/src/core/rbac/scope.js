// Build a SQL WHERE fragment that limits rows to the user's data scope for (resource, action).
// Returns { clause, params }. Applied to list queries so scoping is enforced in the DB, not the app.
import { effectiveScope } from './index.js';
import { departmentScope, departmentInSql } from './departments.js';

// ── المنح الشخصية على إدارة ──────────────────────────────────────────────────
// «سجى تشوف كل فرص إدارة الابتكار مو بس المسكَّنة عليها» — والمنح **يوسّع القائمة ولا يبدّلها**:
// شرط الدور يبقى كما هو حرفاً، ويُضاف إليه «أو إدارةٌ مُنحتُها».
//
// وشرطُ الإضافة أن يكون المستدعي قد صرّح بعمود الإدارة (`opts.grantCol`). فمن لم يصرّح لا يُوسَّع
// له شيء — فشلٌ مغلق مقصود: استعلامٌ لا يعرف كيف يعبّر عن الإدارة لا يستطيع أن يحدّ نفسه بها،
// فتوسيعه يعني فتح ما هو أوسع من المنح. والتوسعة تُضاف حيث تُقرأ، واحداً واحداً.
//
// و`grantCol` **غير** `deptCol` عمداً وإن كانا اسمَ عمودٍ واحد: `deptCol` يبدّل سلوك منح الدور
// نفسه (يقصّ «الإدارة» من القطاع إلى الإدارة)، وذلك تضييقٌ مؤجَّل حتى تُنسَب البيانات كلها —
// وتفعيله اليوم يُخفي عن مدير الإدارة الفرصَ التي لا إدارة لها. فلو تشارك المسار الخيارَ نفسه
// لجرّ إضافةُ صلاحيةٍ لشخصٍ واحد تضييقاً في وصول كل مديري الإدارات — أثرٌ لم يطلبه أحد.
//
// ولا تُطبَّق إذا كان الأساس شركياً أصلاً (`1=1`): إضافة «أو» إلى ما يشمل كل شيء عبثٌ يُثقل
// الاستعلام ولا يغيّر صفاً.
function personalDeptClause(user, resource, action, grantCol) {
  if (!grantCol) return null;
  const ids = [...new Set((user.departmentGrants || [])
    .filter((g) => g.resource === resource && g.action === action)
    .map((g) => g.department_id).filter(Boolean))];
  if (!ids.length) return null;
  return { clause: `${grantCol} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

// ── والتسكين نفسه يفتح صفَّه ─────────────────────────────────────────────────
// «في فرصي يطلع لها الفرص اللي هي شغالة عليها». وكان المسكَّن على فرصةٍ لا يقرؤها إطلاقاً ما لم
// يملكها: منح المستشار والموظف على الفرصة بنطاق «خاصتي»، وهو يقارن بمالك الصفّ وحده. فيُضمّ
// إلى فريق فرصةٍ ثم لا تظهر له في شاشة، ولا تُفتح له بالعنوان المباشر — تسكينٌ بلا وصول.
//
// والعلاج من حيث عولج نظيره: عضوية المشروع تفتح صفوفه منذ اليوم الأول (`projectIds` في سياق
// الطلب)، وعضوية الفرصة كانت وحدها بلا مقابل. فتُبنى `opportunityIds` بنفس الطريقة، وتُقرأ
// إضافةً لا استبدالاً — كما هي كل توسعةٍ في هذا الملف.
function membershipClause(user, resource, memberCol) {
  if (resource !== 'opportunity' || !memberCol) return null;
  const ids = [...(user.opportunityIds || [])];
  if (!ids.length) return null;
  return { clause: `${memberCol} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

export function scopeFilter(user, resource, action = 'read', opts = {}) {
  const base = roleScopeFilter(user, resource, action, opts);
  if (base.clause === '1=1') return base;
  const extras = [
    personalDeptClause(user, resource, action, opts.grantCol),
    membershipClause(user, resource, opts.memberCol),
  ].filter(Boolean);
  if (!extras.length) return base;
  return {
    clause: `((${base.clause})${extras.map((e) => ` OR (${e.clause})`).join('')})`,
    params: [...base.params, ...extras.flatMap((e) => e.params)],
  };
}

function roleScopeFilter(user, resource, action = 'read', opts = {}) {
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
