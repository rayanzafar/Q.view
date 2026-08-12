// ── قراءة صفّ المشروع: بابٌ واحد يعرف الإدارات المشاركة ──────────────────────
//
// النظير الحرفي لباب الفرصة (crm/opp-access.js، عقد ADR-0006 — ومدُّه إلى المشاريع
// ADR-0008): «هذان المشروعان مشتركان بين إدارتين… لازم في المشاريع تطلع والتسكين يطلع
// فيها بشكل صحيح». المشاركة تسكن جدول `project_department` لا عمودَ الصفّ، وفحص
// الصلاحية (`can`) يقرأ الهدف الذي يُناوَل له فقط — فصفٌّ يُناوَل بعموده وحده يُحكَم عليه
// بإدارته المسؤولة وحدها، وتُرَدّ مديرةُ إدارةٍ **تشارك** في المشروع عن صفٍّ تعرضه قائمتُها.
//
// الحكم على درجتين، والثانية لا تُدفع كلفتها إلا عند الحاجة: يُفحص الصفّ كما هو (وهو ما
// يمرّ لأغلب القرّاء)، فإن رُدّ حُمِّلت المشاركات وأُعيد الفحص بها. وحين تنجح الدرجةُ
// الثانية يعود الصفُّ **محمَّلاً** بمصفوفة `partner_department_ids`: وجودُها على الصفّ
// العائد ⇔ الوصولُ جاء بالشراكة لا بعمود الصفّ — وعليها يبني `updateProject` حجزَ حقول
// النسبة (الإدارة المسؤولة والمشارِكة) عن محرِّر الشراكة.
import { all, get } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { forbidden, notFound } from '../../core/http/errors.js';

export async function loadReadableProject(user, projectId, action = 'read', deniedMsg) {
  const row = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!row) throw notFound('المشروع غير موجود');
  if (can(user, action, 'project', row)) return row;
  // الدرجة الثانية: المشاركات تُحمَّل على الهدف باسمٍ يعرفه المحرّك (`partner_department_ids`)
  // ويُعاد السؤال نفسه — لا حكمٌ محلّي هنا، فالقرار يبقى في مكانه الواحد (rbac/index.js).
  const partners = (await all(
    'SELECT department_id FROM project_department WHERE project_id = ?', [projectId]
  )).map((r) => r.department_id).filter(Boolean);
  const enriched = { ...row, partner_department_ids: partners };
  if (partners.length && can(user, action, 'project', enriched)) {
    return enriched;
  }
  throw forbidden(deniedMsg);
}

// الإدارات المشاركة بأسمائها — للعرض (صفحة المشروع وبطاقاته). المحذوفة لا تُعرض.
export async function projectDepartments(projectId) {
  return await all(
    `SELECT pd.department_id, d.name_ar
       FROM project_department pd
       JOIN department d ON d.id = pd.department_id AND d.deleted_at IS NULL
      WHERE pd.project_id = ?
      ORDER BY d.name_ar`, [projectId]);
}
