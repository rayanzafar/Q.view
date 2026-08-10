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
// نفسه (يقصّ «الإدارة» من القطاع إلى الإدارة — مُفعَّل اليوم على الفرص، مؤجَّل على المشاريع؛
// انظر حالة «الإدارة» أدناه). فلو تشارك المسارُ الخيارَ نفسه لجرّت إضافةُ صلاحيةٍ لشخصٍ واحد
// تغييراً في سلوك منح كل مديري الإدارات — أثرٌ لم يطلبه أحد.
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
function membershipClause(user, resource, action, memberCol) {
  // القراءة وحدها — كما الصفّ في index.js (personalGrantReaches يفتح تسكينَ الفرصة قراءةً لا كتابة).
  if (resource !== 'opportunity' || action !== 'read' || !memberCol) return null;
  const ids = [...(user.opportunityIds || [])];
  if (!ids.length) return null;
  return { clause: `${memberCol} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

// ── مدى الإدارة على الفرص: المسؤولة **والمشاركة** معاً ───────────────────────
// «ممكن الفرصة تتسكّن على أكثر من إدارة» — والفرصة التي تُشارك فيها إدارةُ القارئ يجب أن تظهر
// في قائمته كما يفتحها صفّياً (scopeReaches يقرأ `partner_department_ids`). وتوسعة القائمة هنا
// تلحق بها: عمود الإدارة المسؤولة **أو** صفٌّ في جدول المشاركة لإحدى إداراته.
//
// ومَن **يقود** إدارةً (`department.manager_user_id`) يقرأ فرصها ولو لم يكن دوره «مدير إدارة»:
// مدير تطوير أعمالٍ أُسندت إليه إدارةٌ يرى فرص أهلها — قراءةً تُبنى من `managedDepartmentIds`
// إضافةً على منح دوره، لا استبدالاً له. والكتابة لا تتبع هذه القراءة في أي حال.
//
// وثلاثة شروط صريحة تلزم معاً كما في بقية توسعات هذا الملف: الفرصة وحدها، والقراءة وحدها،
// وتصريح المستدعي بالعمودين (`deptCol` + `memberCol`) — فاستعلامٌ لا يعرف كيف يعبّر عن
// الإدارة أو عن معرّف الصف لا يُوسَّع. ومجموعةٌ فارغة تعيد null (لا توسعة) لا شرطاً فارغاً.
export function departmentReachClause(user, resource, action, opts = {}) {
  if (resource !== 'opportunity' || action !== 'read' || !opts.deptCol || !opts.memberCol) return null;
  const roleIsDept = effectiveScope(user, action, resource) === 'department';
  const ids = [...new Set([
    ...(roleIsDept ? departmentScope(user) : []),
    ...(user.managedDepartmentIds || []),
  ])].filter(Boolean);
  const parts = [];
  const params = [];
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    parts.push(`${opts.deptCol} IN (${marks})`);
    parts.push(`EXISTS (SELECT 1 FROM opportunity_department od
       WHERE od.opportunity_id = ${opts.memberCol} AND od.department_id IN (${marks}))`);
    params.push(...ids, ...ids);
  }
  // ── الأيتام: فرصةٌ بلا إدارة داخل قطاع مدير الإدارة تظهر في قائمته ────────────
  // «كل الفرص تبع البيانات… ومشاريع كانت WIN اختفت» — بلسان مستخدمٍ حقيقي بعد v5.2. صفّ الفرصة
  // (scopeReaches، حالة «الإدارة») **يفتح** الفرصةَ بلا إدارةٍ في قطاع القارئ منذ اليوم (سطر
  // «يبقى ما لا يُحسم… return true»)، لكن القائمة كانت تُغلقها — فتُفتح بالعنوان ولا تظهر: تناقضُ
  // قائمةٍ وصفٍّ بعينه معكوساً. والأيتام هنا بورتفوليو الفوز التاريخي المستورد (بلا مالكٍ ولا
  // إدارةٍ ولا حتى إدارةٍ على مشروعه المرآة) — لا فرصُ إدارةٍ أخرى تُسرَّب، بل صفوفٌ لا إدارة لها
  // أصلاً. فتُحاذى القائمةُ الصفَّ: تظهر لمن دورُه «إدارة» في قطاعه هو، لا أوسع.
  //
  // والشرط `roleIsDept` (لا `managedDepartmentIds`) مقصود: مدير تطوير أعمالٍ (دورُه «خاصتي»)
  // يقود إدارةً يُطابِق صفَّها بالمعرّف لا يفتح صفَّ اليتيم صفّياً (managedDepartmentReaches يلزمه
  // معرّف إدارةٍ مطابق) — فإدراجُه في قائمته يُعيد التناقضَ من الجهة الأخرى.
  if (roleIsDept && user.sector_id) {
    // عمود القطاع يُشتقّ من `deptCol` ليطابق جدوله/كنيتَه تماماً (deptCol ينتهي دوماً بـ
    // department_id) — فلا لبسَ في استعلامٍ يضمّ جداول أخرى، ولا حاجةَ لأن يمرّره كلُّ مستدعٍ.
    const sectorCol = opts.sectorCol || opts.deptCol.replace(/department_id$/, 'sector_id');
    parts.push(`(${opts.deptCol} IS NULL AND ${sectorCol} = ?)`);
    params.push(user.sector_id);
  }
  if (!parts.length) return null;
  return { clause: `(${parts.join(' OR ')})`, params };
}

// ── الأيتام للمشروع: القائمة تُحاذي الصفَّ، بلا جدول مشاركة ───────────────────
// نظيرُ فرع الأيتام في `departmentReachClause` أعلاه، لكن للمشروع وحده. والفرقُ عن الفرصة
// مقصود: المشروع لا يملك جدول مشاركةٍ (لا نظير لـ`opportunity_department`)، فلا تُضاف له
// «الإدارة المشاركة» — الأيتام وحدها. صفُّ المشروع بلا إدارةٍ داخل قطاع القارئ **يُفتح** صفّياً
// (scopeReaches، فرع «الإدارة» بلا إدارةٍ على الهدف → قطاعٌ مشترك للمشروع)، وكانت القائمة تُغلقه
// حين ضاقت إلى الإدارة (deptCol) — فيُفتح بالعنوان ولا يظهر: عين تناقض «يُعرَض ولا يُفتح» معكوساً.
// والأيتام هنا محفظةُ الفوز التاريخي المستورد بلا إدارة — لا مشاريعُ إدارةٍ أخرى تُسرَّب، بل
// صفوفٌ لم تُنسَب بعد. فتُحاذى القائمةُ الصفَّ: تظهر لمن دورُه «إدارة» في قطاعه هو، لا أوسع.
//
// وثلاثة شروط تلزم معاً كما في نظيرها: المشروع قراءةً، وتصريح المستدعي بعمود الإدارة
// (`opts.deptCol` — فمن لم يصرّح لا يُوسَّع له، فشلٌ مغلق)، وأن يكون **نطاقُه الفعليّ إدارة**
// (roleIsDept — فقارئ القطاع/الشركة/المشروع لا يُمَسّ)، وله قطاعٌ مسجَّل. وعمود القطاع يُشتقّ
// من `deptCol` ليطابق جدولَه/كنيتَه تماماً — كما في `departmentReachClause` (سطر ~:88).
export function projectReachClause(user, resource, action, opts = {}) {
  if (resource !== 'project' || action !== 'read' || !opts.deptCol) return null;
  if (effectiveScope(user, action, resource) !== 'department') return null;
  if (!user.sector_id) return null;
  const sectorCol = opts.sectorCol || opts.deptCol.replace(/department_id$/, 'sector_id');
  return { clause: `(${opts.deptCol} IS NULL AND ${sectorCol} = ?)`, params: [user.sector_id] };
}

export function scopeFilter(user, resource, action = 'read', opts = {}) {
  const base = roleScopeFilter(user, resource, action, opts);
  if (base.clause === '1=1') return base;
  const extras = [
    personalDeptClause(user, resource, action, opts.grantCol),
    membershipClause(user, resource, action, opts.memberCol),
    departmentReachClause(user, resource, action, opts),
    projectReachClause(user, resource, action, opts),
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
      // قرار D15 (docs/OPEN-DECISIONS.md) اكتمل نصفاه — الفرصة أولاً ثم المشروع:
      //  · **الفرصة — مُفعَّل (٢٠٢٦-٠٨)**: نُسبت الفرص إلى إداراتها (الموجة 010 وما بعدها)،
      //    وقرّر المالك قلب الرؤية — مدير الإدارة يرى فرص إدارته لا قطاعه. فمن مرّر `deptCol`
      //    يُقصّ على **مجموعة إدارات القارئ** (انتماؤه ∪ ما يقوده — لا مساواة بإدارة واحدة،
      //    فمن يقود إدارتين لا يُترك أهل الثانية خارج قائمته)، والمجموعة الفارغة تعيد `1=0`
      //    **فشلاً مغلقاً**: مديرُ إدارةٍ بلا إدارة يرى لا شيء، لا القطاع كله. والفرص التي
      //    تُشاركها إدارتُه تلحق عبر `departmentReachClause` أعلاه لا هنا.
      //  · **المشروع — مُفعَّل (v5.9)**: كان مؤجَّلاً حتى تُنسَب المحفظة إلى إداراتها (تضييقُها
      //    قبل ذلك يُخفي كل مشروعٍ بلا إدارة فيستبدل تسريباً بعُطل). وقد جرى التسكين الرجعي
      //    (backfill-project-departments.js)، فصار كلُّ موضع قراءةٍ للمشروع يمرّر `deptCol`
      //    ويُقصّ على مجموعة الإدارات نفسها. والأيتام (مشروعٌ بلا إدارة في القطاع) تلحق عبر
      //    `projectReachClause` أعلاه — بلا جدول مشاركةٍ للمشروع (لا نظير له).
      return opts.deptCol
        ? departmentInSql(opts.deptCol, departmentScope(user))
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
