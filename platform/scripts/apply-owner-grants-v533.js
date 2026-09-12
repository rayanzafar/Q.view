// ── تنفيذ أمر المالك (v5.33): صلاحيات م. يعقوب وم. إسحاق على إدارة الذكاء الاصطناعي والبيانات ──
//
// «ممتاز اعطي صلاحيه لـم. يعقوب وم. اسحاق في اضافه فرص وتعديل الفرص، تعديل واضافه على المشاريع
// التابعه لقطاع البيانات والذكاء الاصطناعي» — بلسان المالك (٢٠٢٦-٠٨-١٦). وسمّاها «قطاعاً» وهي
// **إدارةٌ** في قطاع الحلول («إدارة الذكاء الاصطناعي والبيانات») — والرجلان موظفاها.
//
// الترجمة إلى منح: القراءة والإضافة والتعديل معاً على الفرص والمشاريع (ستُّ صلاحياتٍ لكلٍّ منهما).
// **والقراءة جزءٌ من الأمر لا زيادةٌ عليه**: من يعدّل فرص إدارته يجب أن يراها أولاً — منحُ
// الكتابة بلا قراءةٍ يصنع عينَ تناقض «يُفتح ولا يظهر» المحروس في المنصة كلها. وبلوغُ المنحة
// المشاريعَ **المشتركة** (مشروعا الحافلات — إدارتُه فيهما مشارِكة لا مسؤولة) في المحرّك نفسه
// (ADR-0009)، لا في صفوفٍ إضافية هنا.
//
// ولماذا سكربت لا نقراتٌ في الشاشة: منفذ قاعدة البيانات غير مبلوغ من خارج شبكة النشر، فالإقلاع
// هو مسار تنفيذ أمرٍ على البيانات الحية من هنا — نفس قيد `apply-owner-grants` الأول حرفاً.
// والشاشة (صفحة الشخص) تبقى المسار الطبيعي لكل منحٍ ورفعٍ بعده.
//
// ── لا يخمّن ──
// المطابقة بالاسم الأول بعد التطبيع (nameWords — نفس قاعدة سكربت الإشغال)، والقاعدة صريحة:
// صفر أو أكثر من واحد ⟵ لا يُكتب شيء ويُقال السبب. ويُشغَّل مرةً واحدة (طابع في
// `schema_migration`) — وإلا أُعيد منحُ ما رفعه المالك بيده عند كل إقلاع.
import { all, get, run, insert } from '../src/core/db/index.js';
import { id, nowIso } from '../src/core/util/ids.js';
import { nameWords } from './apply-utilization-may2026.js';

const FLAG = 'op:owner-grants-dataai-v533';
const DEPARTMENT_NAME = 'إدارة الذكاء الاصطناعي والبيانات';
const PEOPLE = ['يعقوب', 'إسحاق'];
const PAIRS = [
  ['opportunity', 'read'], ['opportunity', 'create'], ['opportunity', 'update'],
  ['project', 'read'], ['project', 'create'], ['project', 'update'],
];
const NOTE = 'قرار المالك 2026-08-16: يضيف ويعدّل فرص إدارة الذكاء الاصطناعي والبيانات ومشاريعها';

const firstNameIs = (fullName, first) => nameWords(fullName)[0] === nameWords(first)[0];

export async function applyOwnerGrantsV533({ force = false } = {}) {
  const done = await get('SELECT applied_at FROM schema_migration WHERE version = ?', [FLAG]);
  if (done?.applied_at && !force) return { skipped: true, at: done.applied_at, granted: [], notes: [] };

  const notes = [];
  const granted = [];
  const depts = await all(
    'SELECT id, name_ar, sector_id FROM department WHERE name_ar = ? AND deleted_at IS NULL',
    [DEPARTMENT_NAME]);
  if (depts.length !== 1) {
    notes.push(`«${DEPARTMENT_NAME}»: ${depts.length === 0 ? 'غير موجودة' : `متكرّرة (${depts.length})`} — لم يُمنَح شيء`);
    return { skipped: false, at: null, granted, notes, unresolved: true };
  }
  const dept = depts[0];

  const staff = await all(`SELECT e.id employee_id, e.name_ar, u.id user_id
     FROM employee e JOIN app_user u ON u.id = e.user_id AND u.deleted_at IS NULL AND u.active = 1
    WHERE e.deleted_at IS NULL AND e.active = 1`);

  const now = nowIso();
  for (const first of PEOPLE) {
    const hits = staff.filter((s) => firstNameIs(s.name_ar, first));
    if (hits.length !== 1) {
      notes.push(`«${first}»: ${hits.length === 0
        ? 'لا حساب نشطاً بهذا الاسم'
        : `أكثر من شخص بهذا الاسم (${hits.map((h) => h.name_ar).join('، ')})`} — تُمنَح من شاشة الشخص`);
      continue;
    }
    const person = hits[0];
    let wrote = 0;
    for (const [resource, action] of PAIRS) {
      const existing = await get(
        `SELECT id FROM user_department_grant
          WHERE user_id = ? AND resource = ? AND action = ? AND department_id = ? AND deleted_at IS NULL`,
        [person.user_id, resource, action, dept.id]);
      if (existing) continue;
      await insert('user_department_grant', {
        id: id('ugr'), user_id: person.user_id, resource, action,
        department_id: dept.id, note: NOTE, granted_by: null, created_at: now,
      });
      wrote += 1;
    }
    if (wrote) granted.push(`${person.name_ar} (${wrote})`);
    else notes.push(`«${person.name_ar}»: ممنوحة مسبقاً`);
  }

  await run(
    `INSERT INTO schema_migration (version, applied_at) VALUES (?,?)
     ON CONFLICT (version) DO UPDATE SET applied_at = excluded.applied_at`, [FLAG, now]);
  return { skipped: false, at: now, granted, notes };
}

// تشغيلٌ مباشر من سطر الأوامر (الإقلاع) — والاستيراد لا يُشغّل شيئاً.
if (process.argv[1] && process.argv[1].endsWith('apply-owner-grants-v533.js')) {
  const r = await applyOwnerGrantsV533({ force: process.argv.includes('--force') });
  if (r.skipped) console.log(`صلاحيات v5.33 مطبَّقة مسبقاً في ${String(r.at).slice(0, 10)} — لا تغيير`);
  else console.log(`مُنحت صلاحيات «${DEPARTMENT_NAME}» لـ: ${r.granted.join('، ') || 'لا أحد'}`);
  for (const n of r.notes) console.log(`  · ${n}`);
}
