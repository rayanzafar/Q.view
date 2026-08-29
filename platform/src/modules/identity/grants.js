// ═══ الصلاحيات الشخصية على إدارة ═══════════════════════════════════════════════════════════
//
// «ممكن أنا أحطّ على سجى إنها تشوف كل فرص إدارة الابتكار مو بس المسكَّنة عليها… ومدير القطاع
// يقدر يعطي صلاحيات كعينه، ومدير الإدارة يقدر يعطي صلاحيات» — بلسان المالك.
//
// وهذا الملف هو **حدّ** تلك القدرة لا مجرّد كتابتها. القاعدة التي يقوم عليها كل ما تحته:
//
//        لا يمنح أحدٌ ما لا يملكه.
//
// وهي ليست شعاراً: التفويض بلا هذا القيد يجعل أي مدير إدارةٍ قادراً على أن يمنح نفسه — أو من
// يشاء — رؤيةَ الشركة كلها بخطوتين، فينهار كل ما بُني في محرّك الصلاحيات من فوق. فالفحص هنا
// يسأل عن المانح ثلاثة أسئلة، وسقوط أيّها يوقف المنح:
//   ① هل يقرأ هذا المورد **في هذه الإدارة** فعلاً؟ (`can` على صفٍّ افتراضي يحمل قطاعها وإدارتها)
//   ② هل اتساعه يبلغ الإدارة فأوسع؟ فمن نطاقه «خاصتي» أو «مشروعي» يقرأ صفوفه هو، ولا معنى
//      لأن يمنح إدارةً كاملة لغيره — ولولا هذا السؤال لمرّ الأول على مالك الصفّ نفسه.
//   ③ هل هذا الشخص من أهله؟ (نفس سؤال «من يؤكّد تسكين فلان» — مصدرٌ واحد لا نسختان)
//
// ولا يمنح أحدٌ **نفسه**. والقاعدة مطلقة بلا استثناء لمدير النظام — لا لأنه غير موثوق، بل لأن
// «فلانٌ منح فلاناً» جملةٌ تُراجَع، و«فلانٌ منح نفسه» ليست مراجعةً بل حلقة مغلقة. ومدير النظام
// يرى كل شيء أصلاً بمنحه الشامل، فالمنع لا يمنعه من عمل.
//
// ── ولا يُمنَح إلا ما هو موصولٌ فعلاً ────────────────────────────────────────
// `GRANTABLE` قائمة مغلقة، وشرط الدخول فيها **ليس** أن الصلاحية معقولة بل أن تكون هناك شاشةٌ
// تقرؤها اليوم. ومنحُ ما لا يقرؤه شيء يُنتج أسوأ حالة في منتج: مالكٌ يمنح، ولا يتغيّر شيء، ولا
// خطأ يظهر — فيظنّ العطل في المنصة أو في فهمه. تُوسَّع القائمة مع كل استعلامٍ يُوصَل، لا قبله.
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { inDepartmentScope } from '../../core/rbac/departments.js';
import { SCOPE_RANK } from '../../core/rbac/matrix.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { id, nowIso } from '../../core/util/ids.js';
import { audit } from '../../core/audit/index.js';
import { ownsEmployee } from '../org/confirm.js';

// المورد ⟵ ما يظهر للمستخدم، وأين يظهر أثره. النصّ هنا هو نصّ الشاشة: لا مصطلح يُترجَم مرتين.
//
// ── توسعة v5.33 (ADR-0009): الكتابة تُمنَح كما تُمنَح القراءة ────────────────
// «اعطي صلاحية لـم. يعقوب وم. إسحاق في إضافة فرص وتعديل الفرص، تعديل وإضافة على المشاريع
// التابعة لقطاع البيانات والذكاء الاصطناعي» — بلسان المالك (٢٠٢٦-٠٨-١٦). وكل صفٍّ أُضيف هنا
// موصولٌ فعلاً يوم إضافته: الإنشاء يفحص إدارة الصفّ المولود على بابَي createOpportunity
// وcreateProject، والتعديل يمرّ ببابَي opp-access/project-access (فرع المنح في المحرّك يقرأ
// المسؤولةَ والمشاركة معاً)، والقوائم تتوسّع بـpersonalDeptClause حيث صرّح الاستعلام بأعمدته.
export const GRANTABLE = [
  {
    resource: 'opportunity',
    action: 'read',
    label: 'يرى كل فرص الإدارة',
    effect: 'تظهر له فرص هذه الإدارة كاملةً في شاشة «الفرص» — لا المسكَّن عليها وحده. و«فرصي» تبقى شخصية.',
  },
  {
    resource: 'opportunity',
    action: 'create',
    label: 'يضيف فرصاً لهذه الإدارة',
    effect: 'يفتح له تسجيل فرصة جديدة تُنسب إلى هذه الإدارة — لا إلى غيرها.',
  },
  {
    resource: 'opportunity',
    action: 'update',
    label: 'يعدّل فرص الإدارة',
    effect: 'يفتح له تعديل فرص هذه الإدارة من صفحة الفرصة — وفي المشتركة مع غيرها تبقى حقول النسبة لإدارتها المسؤولة.',
  },
  {
    resource: 'project',
    action: 'read',
    label: 'يرى كل مشاريع الإدارة',
    effect: 'تظهر له مشاريع هذه الإدارة في شاشة «المشاريع» وتُفتح صفحاتها — بما فيها ما تشارك فيه الإدارة مع غيرها.',
  },
  {
    resource: 'project',
    action: 'create',
    label: 'يضيف مشاريع لهذه الإدارة',
    effect: 'يفتح له تسجيل مشروع جديد يُنسب إلى هذه الإدارة — لا إلى غيرها.',
  },
  {
    resource: 'project',
    action: 'update',
    label: 'يعدّل مشاريع الإدارة',
    effect: 'يفتح له تعديل مشاريع الإدارة ومخرجاتها وفريقها — وفي المشترك مع غيرها تبقى حقول النسبة للإدارة المسؤولة.',
  },
  // ── توسعة v5.60: إدارة الفعاليات تُمنَح بالأشخاص ────────────────────────────
  // المعرض معرضُ الشركة كلها (ADR-0013، matrix.js): مواردُ الفعاليات نطاقُها «شركة» في
  // المصفوفة، وأبوابُ خدمتها تُنادي can() بلا صفّ هدف. فالإدارةُ المختارة في صفّ المنح هنا
  // قيدُ جدولٍ لا قيدُ أثر — والأثرُ شركيٌّ، ونصُّ الشاشة يقولها صراحةً كي لا يُفهم غير ذلك.
  // ومَن يمنحها محكومٌ بالقاعدة القائمة «لا يمنح أحدٌ ما لا يملكه»: قادةُ القطاعات ومكتبُ
  // الرئيس التنفيذي ومديرُ النظام يملكونها؛ مديرُ الإدارة لا يملكها فلا يمنحها.
  {
    resource: 'event',
    action: 'create',
    label: 'ينشئ فعاليات (للشركة كلها)',
    effect: 'يفتح له إنشاء فعالية جديدة من شاشة «الفعاليات» باسمه — والفعاليات على مستوى الشركة لا الإدارة.',
  },
  {
    resource: 'event',
    action: 'update',
    label: 'يعدّل الفعاليات ويغلقها (للشركة كلها)',
    effect: 'يفتح له تعديل تفاصيل أي فعالية وإغلاقها بعد انتهائها — على مستوى الشركة لا الإدارة.',
  },
  {
    resource: 'event',
    action: 'delete',
    label: 'يحذف فعاليات (للشركة كلها)',
    effect: 'يفتح له حذف فعالية بكل بطاقاتها وصورها — على مستوى الشركة، فلا تُمنَح إلا لمن يُدير المعرض فعلاً.',
  },
  {
    resource: 'event_contact',
    action: 'delete',
    label: 'يحذف بطاقات الآخرين في الفعاليات (للشركة كلها)',
    effect: 'يفتح له حذف أي بطاقة التقطها زميل — لتنظيف المكرَّر والخاطئ أثناء المعرض وبعده.',
  },
  {
    resource: 'event_partner',
    action: 'delete',
    label: 'يحذف شراكات الآخرين في الفعاليات (للشركة كلها)',
    effect: 'يفتح له حذف أي شراكة سجّلها زميل في الفعالية — لتنظيف السجل قبل المراجعة.',
  },
];
export const isGrantable = (resource, action) =>
  GRANTABLE.some((g) => g.resource === resource && g.action === action);

// ── ما يُحمَّل مع كل طلب ──────────────────────────────────────────────────────
// يُقرأ عند بناء سياق الطلب (`resolveUser`) لا عند الإقلاع: الصلاحية الشخصية تُمنَح وتُرفَع
// أثناء يوم العمل، ومنحٌ يبدأ أثره بعد إعادة تشغيل الخادم لا يصلح لأن يُدار من شاشة.
export async function grantsForUser(userId) {
  if (!userId) return [];
  const rows = await all(
    `SELECT g.resource, g.action, g.department_id, d.sector_id
       FROM user_department_grant g
       JOIN department d ON d.id = g.department_id AND d.deleted_at IS NULL
      WHERE g.user_id = ? AND g.deleted_at IS NULL`, [userId]);
  // الإدارة المحذوفة ناعماً لا تُقرأ (الوصل الداخلي أعلاه يُسقطها)، وغير القابل للمنح يُسقَط
  // هنا أيضاً: لو أُخرج موردٌ من القائمة يوماً، بطلت صفوفه القديمة في نفس اللحظة بلا ترحيلة.
  return rows.filter((r) => isGrantable(r.resource, r.action));
}

// ── حدُّ المنح يُقاس بنطاق المانح لا بقراءته ────────────────────────────────
// «مدير الإدارة يمنح إدارته، وقائد القطاع أي إدارة في قطاعه» — قرار المالك.
//
// وكان يُقاس بـ`can(read)` وحده، وهو مقياسٌ صار أوسع من المقصود: قراءةُ الفرص تتبع القائمة
// (تُنهي تناقض «يظهر ولا يُفتح»)، فلو تبعها المنحُ لصار مديرُ الإدارة يمنح صلاحياتٍ على كل
// إدارة في قطاعه — سلطةٌ لم تُمنَح له. **فرؤية شيءٍ ليست ملكاً لتوزيعه.**
//
// والمقياس هنا نطاقُه الفعلي على المورد: شركيٌّ يبلغ الكل · قطاعيٌّ يبلغ قطاعه · وإداريٌّ
// يبلغ ما يقوده وحده. ويُستعمل في البابين معاً — الفحص عند الحفظ والقائمة المعروضة — كي لا
// تعِد الشاشة بما يرفضه الخادم (وهو ما يحرسه فحصٌ قائم بعينه).
function reachesForGrant(granter, dept, resource, action) {
  const scope = effectiveScope(granter, action, resource);
  if (scope === 'company') return true;
  if (scope === 'sector') return !!granter.sector_id && dept.sector_id === granter.sector_id;
  if (scope === 'department') return inDepartmentScope(granter, dept.id);
  return false;
}

async function assertMayGrant(granter, targetUser, dept, resource, action) {
  if (!isGrantable(resource, action)) {
    throw badRequest('هذه الصلاحية غير متاحة للمنح من هنا — اختر من القائمة المعروضة');
  }
  if (granter.id === targetUser.id) {
    throw forbidden('لا يمنح أحدٌ نفسه صلاحية — اطلبها ممن يملكها فوقك ليكون للمنح أثرٌ يُراجَع');
  }
  // ① و② معاً: القراءة في هذه الإدارة، وباتساعٍ يبلغ الإدارة فأوسع.
  const target = { sector_id: dept.sector_id, department_id: dept.id };
  const wide = SCOPE_RANK[effectiveScope(granter, action, resource)] >= SCOPE_RANK.department;
  if (!wide || !can(granter, action, resource, target) || !reachesForGrant(granter, dept, resource, action)) {
    throw forbidden(`لا تملك رؤية «${dept.name_ar}» بنفسك — ولا يمنح أحدٌ ما لا يملكه`);
  }
  // ③ الشخص من أهلك: نفس سؤال تأكيد التسكين حرفاً — مصدرٌ واحد لا نسختان تتباعدان.
  const emp = targetUser.employee_id
    ? targetUser.employee_id
    : (await get('SELECT id FROM employee WHERE user_id = ? AND deleted_at IS NULL', [targetUser.id]))?.id || null;
  if (!emp) {
    if (granter.role_id !== 'admin') {
      throw forbidden('هذا الحساب غير مربوط بسجل موظف، فلا تُعرف إدارته ولا مَن يديره — اربطه أولاً من شاشة الفريق');
    }
    return;
  }
  if (!await ownsEmployee(granter, emp)) {
    throw forbidden('هذا الشخص خارج من تديرهم — الصلاحية تُمنَح لمن تديره');
  }
}

async function loadDept(departmentId) {
  const d = await get(
    'SELECT id, name_ar, sector_id FROM department WHERE id = ? AND deleted_at IS NULL', [departmentId]);
  if (!d) throw badRequest('الإدارة المختارة غير موجودة — حدّث القائمة وحاول مجدداً');
  return d;
}

async function loadTargetUser(userId) {
  const u = await get(
    'SELECT id, name_ar, username, role_id, employee_id, active FROM app_user WHERE id = ? AND deleted_at IS NULL',
    [userId]);
  if (!u) throw notFound('الحساب غير موجود');
  return u;
}

/** قائمة صلاحيات شخصٍ واحد — للعرض في بطاقته على شاشة الفريق. */
export async function listUserGrants(reader, userId) {
  const u = await loadTargetUser(userId);
  // من يرى الكشف يرى صلاحيات أهله: نفس بوابة الشاشة التي تُعرض فيها، لا بوابةٌ ثالثة.
  if (reader.role_id !== 'admin' && reader.id !== u.id && !can(reader, 'read', 'employee')) {
    throw forbidden('عرض صلاحيات شخصٍ آخر يتطلب صلاحية عرض الفريق');
  }
  const rows = await all(
    `SELECT g.id, g.resource, g.action, g.department_id, g.note, g.created_at,
            d.name_ar department_name, s.name_ar sector_name, u2.name_ar granted_by_name
       FROM user_department_grant g
       JOIN department d ON d.id = g.department_id AND d.deleted_at IS NULL
       LEFT JOIN sector s ON s.id = d.sector_id AND s.deleted_at IS NULL
       LEFT JOIN app_user u2 ON u2.id = g.granted_by
      WHERE g.user_id = ? AND g.deleted_at IS NULL
      ORDER BY g.created_at`, [userId]);
  return rows.filter((r) => isGrantable(r.resource, r.action)).map((r) => ({
    ...r,
    label: GRANTABLE.find((g) => g.resource === r.resource && g.action === r.action)?.label || '',
  }));
}

/**
 * الإدارات التي يستطيع هذا المانح أن يمنحها لهذا المورد — تُبنى بنفس الحدّ الذي يفحصه المنح،
 * فلا تُعرض في القائمة إدارةٌ سيُردّ عنها عند الحفظ. (قائمةٌ تعرض ما يُرفَض هي وعدٌ يُخلَف.)
 */
export async function grantableDepartments(granter, resource = 'opportunity', action = 'read') {
  if (!isGrantable(resource, action)) return [];
  if (SCOPE_RANK[effectiveScope(granter, action, resource)] < SCOPE_RANK.department) return [];
  const rows = await all(`SELECT d.id, d.name_ar, d.sector_id, s.name_ar sector_name
     FROM department d LEFT JOIN sector s ON s.id = d.sector_id AND s.deleted_at IS NULL
    WHERE d.deleted_at IS NULL AND d.active = 1
    ORDER BY s.sort_order, d.name_ar`);
  // نفس حكم الحفظ حرفاً — القائمة المعروضة هي ما يُقبل فعلاً، لا وعدٌ يُخلَف عند الحفظ.
  return rows.filter((d) => can(granter, action, resource, { sector_id: d.sector_id, department_id: d.id })
    && reachesForGrant(granter, d, resource, action));
}

/**
 * لوحة المنح على صفحة الشخص: كل صلاحيةٍ قابلة للمنح ومعها إداراتُ هذا المانح لها — بنفس حكم
 * الحفظ حرفاً (can + reachesForGrant لكل إدارة)، فلا يُعرض خيارٌ سيُرَدّ. استعلامُ إداراتٍ
 * واحد للقائمة كلها، والصلاحية التي لا إدارةَ لمانحها فيها لا تظهر أصلاً.
 */
export async function grantableOptions(granter) {
  const rows = await all(`SELECT d.id, d.name_ar, d.sector_id, s.name_ar sector_name
     FROM department d LEFT JOIN sector s ON s.id = d.sector_id AND s.deleted_at IS NULL
    WHERE d.deleted_at IS NULL AND d.active = 1
    ORDER BY s.sort_order, d.name_ar`);
  const out = [];
  for (const g of GRANTABLE) {
    if ((SCOPE_RANK[effectiveScope(granter, g.action, g.resource)] || 0) < SCOPE_RANK.department) continue;
    const departments = rows
      .filter((d) => can(granter, g.action, g.resource, { sector_id: d.sector_id, department_id: d.id })
        && reachesForGrant(granter, d, g.resource, g.action))
      .map((d) => ({ id: d.id, name_ar: d.name_ar, sector_name: d.sector_name || null }));
    if (departments.length) out.push({ ...g, departments });
  }
  return out;
}

export async function grantDepartment(ctx, data = {}) {
  const granter = ctx.user;
  const targetUser = await loadTargetUser(data.user_id);
  const dept = await loadDept(data.department_id);
  const resource = String(data.resource || 'opportunity');
  const action = String(data.action || 'read');
  await assertMayGrant(granter, targetUser, dept, resource, action);

  const note = String(data.note || '').trim().slice(0, 200) || null;
  const now = nowIso();
  const existing = await get(
    `SELECT id FROM user_department_grant
      WHERE user_id = ? AND resource = ? AND action = ? AND department_id = ? AND deleted_at IS NULL`,
    [targetUser.id, resource, action, dept.id]);
  // المنح مرتين لا يُنشئ صفّين: الصفّ الثاني يجعل الرفع يحتاج نقرتين ويُظهر السطر مكرّراً في
  // بطاقةٍ يقرؤها المدير. والقائم يُحدَّث سببه فقط — فمن أعاد المنح أراد تصحيح السبب غالباً.
  if (existing) {
    if (note) await update('user_department_grant', existing.id, { note });
    await audit(ctx, { action: 'update', resource: 'user_grant', resourceId: existing.id,
      sectorId: dept.sector_id, detail: { user_id: targetUser.id, department_id: dept.id, resource, action } });
    return { ok: true, id: existing.id, already: true };
  }
  const gid = id('ugr');
  await tx(async () => {
    await insert('user_department_grant', {
      id: gid, user_id: targetUser.id, resource, action, department_id: dept.id,
      note, granted_by: granter.id, created_at: now,
    });
  });
  await audit(ctx, { action: 'create', resource: 'user_grant', resourceId: gid,
    sectorId: dept.sector_id,
    detail: { user_id: targetUser.id, department_id: dept.id, resource, action, note } });
  return { ok: true, id: gid, already: false };
}

export async function revokeDepartmentGrant(ctx, grantId) {
  const granter = ctx.user;
  const row = await get(
    'SELECT * FROM user_department_grant WHERE id = ? AND deleted_at IS NULL', [grantId]);
  if (!row) throw notFound('الصلاحية غير موجودة أو رُفعت مسبقاً');
  const targetUser = await loadTargetUser(row.user_id);
  const dept = await loadDept(row.department_id);
  // الرفع بنفس حدّ المنح: من يستطيع أن يمنح هذه الصلاحية يستطيع أن يرفعها. وأيُّ حدٍّ أضيق
  // يُنتج صلاحيةً مُنحت ولا يقدر رافعها على رفعها — وهي أسوأ من ألّا تُمنَح.
  await assertMayGrant(granter, targetUser, dept, row.resource, row.action);
  await update('user_department_grant', grantId, { deleted_at: nowIso(), revoked_by: granter.id });
  await audit(ctx, { action: 'delete', resource: 'user_grant', resourceId: grantId,
    sectorId: dept.sector_id, detail: { user_id: row.user_id, department_id: row.department_id } });
  return { ok: true };
}
