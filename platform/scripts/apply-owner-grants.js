// ── تنفيذ أمر المالك: صلاحية «فرص إدارة الابتكار» لسجى وهادي ──────────────────
//
// «ونفّذ هذا الشي على سجى وهادي» — بلسان المالك، بعد أن وصف الصلاحية بنصّها: «أحطّ على سجى إنها
// تشوف كل فرص إدارة الابتكار مو بس المسكَّنة عليها».
//
// ولماذا سكربت لا نقرتان في الشاشة: منفذ قاعدة البيانات غير مبلوغ من خارج شبكة النشر (نفس قيد
// `backfill-legacy-activity` و`reset-stage-clock` المكتوب في `boot.sh`)، فالإقلاع هو المسار
// الوحيد لتنفيذ أمرٍ على البيانات الحيّة من هنا. والشاشة تبقى المسار الطبيعي لكل منحٍ بعده.
//
// ── لا يخمّن ──
// المطابقة بالاسم، والاسمُ ليس مفتاحاً. فالقاعدة هنا صريحة: **صفر أو أكثر من واحد ⟵ لا يُكتب
// شيء ويُقال السبب**. منحُ صلاحيةٍ لشخصٍ خطأ عطلٌ صامت لا يكتشفه أحد — لأن الممنوح لا يشتكي،
// والمقصود يشتكي من «لم يصلني شيء» فيُقرأ عطلاً في مكانٍ آخر. والتخمين هنا أسوأ من الامتناع.
//
// ويُشغَّل مرةً واحدة (طابع في `schema_migration`، نفس سجلّ «ما جرى مرةً واحدة» القائم): وإلا
// أُعيد منحُ ما رفعه المالك بيده عند كل إقلاع — أي أن الشاشة تصير عاجزةً عن رفع ما منحه السكربت.
import { all, get, run, insert } from '../src/core/db/index.js';
import { id, nowIso } from '../src/core/util/ids.js';
import { nameWords } from './apply-utilization-may2026.js';

const FLAG = 'op:owner-grants-innovation-v2';
const DEPARTMENT_NAME = 'إدارة الابتكار';
const PEOPLE = ['سجى', 'هادي'];
const NOTE = 'بأمر المالك — متابعة خطّ فرص الابتكار';

// المطابقة على أول كلمة من الاسم — **بعد نزع اللقب**. أول تشغيلٍ حيّ سقط على هذا بالضبط:
// «هادي» مكتوبٌ في المنصة بلقبٍ قبله، فصار أول كلمةٍ لقباً لا اسماً ولم يُطابَق أحد.
// والتطبيع نفسه المستعمَل في سكربت الإشغال — مصدرٌ واحد للقاعدة لا نسختان تتباعدان.
const firstNameIs = (fullName, first) => nameWords(fullName)[0] === nameWords(first)[0];

export async function applyOwnerGrants({ force = false } = {}) {
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
    const existing = await get(
      `SELECT id FROM user_department_grant
        WHERE user_id = ? AND resource = 'opportunity' AND action = 'read'
          AND department_id = ? AND deleted_at IS NULL`, [person.user_id, dept.id]);
    if (existing) { notes.push(`«${person.name_ar}»: ممنوحة مسبقاً`); continue; }
    await insert('user_department_grant', {
      id: id('ugr'), user_id: person.user_id, resource: 'opportunity', action: 'read',
      department_id: dept.id, note: NOTE, granted_by: null, created_at: now,
    });
    granted.push(person.name_ar);
  }

  await run(
    `INSERT INTO schema_migration (version, applied_at) VALUES (?,?)
     ON CONFLICT (version) DO UPDATE SET applied_at = excluded.applied_at`, [FLAG, now]);
  return { skipped: false, at: now, granted, notes };
}

// تشغيلٌ مباشر من سطر الأوامر (الإقلاع) — والاستيراد لا يُشغّل شيئاً.
if (process.argv[1] && process.argv[1].endsWith('apply-owner-grants.js')) {
  const r = await applyOwnerGrants({ force: process.argv.includes('--force') });
  if (r.skipped) console.log(`صلاحيات المالك مطبَّقة مسبقاً في ${String(r.at).slice(0, 10)} — لا تغيير`);
  else console.log(`مُنحت «فرص ${DEPARTMENT_NAME}» لـ: ${r.granted.join('، ') || 'لا أحد'}`);
  for (const n of r.notes) console.log(`  · ${n}`);
}
