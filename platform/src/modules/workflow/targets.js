// ── ما الذي يعتمده المدير، مكتوباً باسمه ─────────────────────────────────────
//
// شاشة الاعتمادات كانت تطبع **معرّف الصف** في عمود «المورد»: «مهمة · tsk_9fA2…». والمعتمِد
// لا يعرف ما يعتمده، فيضغط على أحد الزرّين تخميناً أو يترك الطلب معلَّقاً — والأول أسوأ.
// وهي أيضاً مخالفةٌ صريحة لقاعدة الواجهة: لا معرّفات تقنية أمام المستخدم.
//
// وموضعُ الملف خارج المحرّك مقصود — كموضع المُسوّيات تماماً: المحرّك يخدم كل الأنواع ولا يعرف
// جداولها. وهنا **قراءةُ عرضٍ فقط**: لا يقرّر شيئاً ولا يكتب حرفاً، فلا يحمل فحص صلاحية.
// الحارس قبله: من لا يصله الطلب في طابوره لا يصل إلى هذه الأسماء أصلاً.
import { all } from '../../core/db/index.js';

// استعلامٌ ثابت لكل نوع، يختاره مفتاحٌ من هذه الخريطة لا من الطلب — نفس قاعدة `APPROVABLE`
// في المحرّك. والمعرّفات وحدها مربوطة، ولا نصّ مستخدم يدخل الاستعلام.
//
// `%IN%` موضع علامات الاستفهام: عددها يُبنى من طول القائمة لا من مدخلٍ خارجي.
const LABEL_SQL = {
  task: `SELECT t.id, t.title label, p.name_ar parent, o.title_ar parent2, t.utilization_pct
           FROM task t
           LEFT JOIN project p ON p.id = t.project_id AND p.deleted_at IS NULL
           LEFT JOIN opportunity o ON o.id = t.opportunity_id AND o.deleted_at IS NULL
          WHERE t.id IN (%IN%)`,
  membership: `SELECT m.id, e.name_ar label, p.name_ar parent, o.title_ar parent2
                 FROM membership m
                 LEFT JOIN employee e ON e.id = m.employee_id
                 LEFT JOIN project p ON p.id = m.group_id AND m.group_kind = 'project' AND p.deleted_at IS NULL
                 LEFT JOIN opportunity o ON o.id = m.group_id AND m.group_kind = 'opportunity' AND o.deleted_at IS NULL
                WHERE m.id IN (%IN%)`,
  opportunity: `SELECT o.id, o.title_ar label, c.name_ar parent, CAST(NULL AS TEXT) parent2
                  FROM opportunity o LEFT JOIN client c ON c.id = o.client_id
                 WHERE o.id IN (%IN%)`,
  proposal: `SELECT pr.id, o.title_ar label, CAST(NULL AS TEXT) parent, CAST(NULL AS TEXT) parent2
               FROM proposal pr LEFT JOIN opportunity o ON o.id = pr.opportunity_id
              WHERE pr.id IN (%IN%)`,
  expense: `SELECT e.id, e.type label, p.name_ar parent, CAST(NULL AS TEXT) parent2
              FROM expense e LEFT JOIN project p ON p.id = e.project_id AND p.deleted_at IS NULL
             WHERE e.id IN (%IN%)`,
  deliverable: `SELECT d.id, d.name_ar label, p.name_ar parent, CAST(NULL AS TEXT) parent2
                  FROM deliverable d LEFT JOIN project p ON p.id = d.project_id AND p.deleted_at IS NULL
                 WHERE d.id IN (%IN%)`,
  timesheet: `SELECT tp.id, COALESCE(u.name_ar, u.username) label, tp.period_start parent,
                     CAST(NULL AS TEXT) parent2
                FROM timesheet_period tp LEFT JOIN app_user u ON u.id = tp.user_id
               WHERE tp.id IN (%IN%)`,
  // طلب التسكين (ADR-0016): اسم المورد، وجهةُ العمل مشروعاً باسمه أو بنداً داخلياً بمفتاحه
  // (يُعرَّب أدناه — المفتاح لا يصل الشاشة).
  allocation_request: `SELECT r.id, e.name_ar label, COALESCE(p.name_ar, r.target_id) parent,
                              CAST(NULL AS TEXT) parent2
                         FROM allocation_request r
                         LEFT JOIN employee e ON e.id = r.employee_id
                         LEFT JOIN project p ON p.id = r.target_id AND r.target_kind = 'project' AND p.deleted_at IS NULL
                        WHERE r.id IN (%IN%)`,
};
// مفاتيح بنود العمل الداخلي (bd/product/pmo) تُعرَّب هنا — نفس المعجم الذي يسمّيها في الشاشات.
const BUCKET_AR = { bd: 'تطوير أعمال', product: 'تطوير منتجات', pmo: 'إدارة مشاريع' };

/**
 * أسماءُ ما تنتظره من طلبات، بمفتاح `resource_id`.
 *
 * استعلامٌ واحد لكل **نوع** لا لكل صف: الطابور قد يحمل عشرين طلباً، وعشرون استعلاماً في
 * حلقة على صفحةٍ تُفتح كل صباح تُقاس بالثواني لا بالميلي ثانية.
 *
 * @param {Array<{resource: string, resource_id: string}>} rows صفوف الطلبات
 * @returns {Promise<Map<string, {label: string, parent: string|null}>>}
 */
export async function approvalTargets(rows) {
  const out = new Map();
  const byKind = new Map();
  for (const r of rows || []) {
    if (!r?.resource_id || !Object.hasOwn(LABEL_SQL, r.resource)) continue;
    if (!byKind.has(r.resource)) byKind.set(r.resource, new Set());
    byKind.get(r.resource).add(String(r.resource_id));
  }
  for (const [kind, idSet] of byKind) {
    const ids = [...idSet];
    const sql = LABEL_SQL[kind].replace('%IN%', ids.map(() => '?').join(','));
    for (const row of await all(sql, ids)) {
      const label = String(row.label || '').trim();
      if (!label) continue;                   // بلا اسمٍ حقيقي لا نخترع اسماً — الصف يبقى بلا وسم
      // حجم المهمة يركب الصفَّ نفسه — الاعتماد قرارٌ واحد على المهمة وحجمها معاً، لا سكّتان.
      const parentRaw = row.parent || row.parent2 || null;
      out.set(String(row.id), { label, parent: parentRaw && BUCKET_AR[parentRaw] ? BUCKET_AR[parentRaw] : parentRaw,
        utilPct: row.utilization_pct == null ? null : Number(row.utilization_pct) });
    }
  }
  return out;
}
