// ── استدراك: كل مشروعٍ بلا إدارة يُنسب إلى إدارته المشتقّة من صاحبه أو من فرصته ──────────────
//
// «عشان نهاية السنة نعرف كل إدارة كم دخّلت» — والعمود موجود على المشروع منذ موجة الإسناد الإداري
// (الترحيلة 007)، لكن المحفظة المستوردة وُلدت كلها «بلا إدارة». وما دامت المشاريع بلا إدارة تبقى
// قائمةُ مدير الإدارة راجعةً إلى القطاع كله (النصف المؤجَّل من D15): تضييقها اليوم يُخفي كل مشروعٍ
// بلا إدارة فيستبدل تسريباً بعُطل. فالترتيب الصحيح: تُنسَب الأعمال أولاً هنا، ثم يُقصّ الوصول.
//
// ── ولا يخمّن ────────────────────────────────────────────────────────────────
// الإدارة تُشتقّ على درجتين، ولكلٍّ شرطُ قطاعٍ لا يُتنازل عنه:
//   (أ) الفرصة المصدر (`source_opp_id`): إدارةُ الفرصة — إن حملتها الفرصةُ **ومن قطاع المشروع
//       نفسه**. المشروع مرآةُ فرصته المكسوبة، فإدارتُها إدارتُه.
//   (ب) وإلا المالك (`owner_user_id`): المسؤول ⟵ حسابه ⟵ موظفه ⟵ إدارته — **إن كانت من قطاع
//       المشروع نفسه**. إدارةٌ من قطاعٍ آخر تكسر الجمع من طرفيه (تُحسب في إدارةٍ لا تعمل عليه
//       وتغيب عن إدارات قطاعه)، فتُرفض ويبقى المشروع «بلا إدارة» ويُقال في الملخّص.
//
// وأكثرُ المرايا كُتبت إدارتُها على الطرفين معاً في استدراك الفرص (op:opportunity-department-
// attribution-v1 كتب المشروعَ مع فرصته) — فشرطُ `department_id IS NULL` أدناه يمرّ عنها ولا
// يعيد كتابتها. يبقى لهذا الاستدراك ما لا فرصة له، أو ما فرصتُه بلا إدارة، أو ما نُسب بمالكه.
//
// يُشغَّل مرةً واحدة (طابع في `schema_migration`) — وإلا أُعيدت كتابة ما صحّحه المالك بيده.
import { all, get, run, tx } from '../src/core/db/index.js';
import { nowIso } from '../src/core/util/ids.js';
import { audit } from '../src/core/audit/index.js';

const FLAG = 'op:project-department-attribution-v1';

// فاعلُ الكتابة في سجلّ التدقيق: ليس مستخدماً — والاسم يُقرأ في «آخر التحديثات» على صفحة
// المشروع، فيقول ما جرى بلا أن يُنسَب إلى إنسانٍ لم يفعله.
const CTX = { user: { username: 'استدراك سند' } };

// إدارة صاحب الحساب: الحساب ⟵ موظفه ⟵ إدارته. تُقبل فقط إن كانت قائمةً غير محذوفة ومن قطاع
// المشروع نفسه — وإلا فلا جواب من هذا الطريق.
async function departmentOfUser(userId, sectorId) {
  if (!userId || !sectorId) return null;
  const u = await get('SELECT employee_id FROM app_user WHERE id = ?', [userId]);
  if (!u || !u.employee_id) return null;
  const emp = await get('SELECT department_id FROM employee WHERE id = ? AND deleted_at IS NULL', [u.employee_id]);
  if (!emp || !emp.department_id) return null;
  const d = await get('SELECT id, name_ar, sector_id FROM department WHERE id = ? AND deleted_at IS NULL', [emp.department_id]);
  if (!d || !d.sector_id || String(d.sector_id) !== String(sectorId)) return null;
  return d;
}

// إدارة الفرصة المصدر: تُقبل فقط إن حملت الفرصةُ إدارةً، قائمةً غير محذوفة، ومن قطاع المشروع
// نفسه — المشروع مرآةُ فرصته، فإدارتُها إدارتُه ما داما في قطاعٍ واحد.
async function departmentOfOpp(oppId, sectorId) {
  if (!oppId || !sectorId) return null;
  const o = await get('SELECT department_id FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!o || !o.department_id) return null;
  const d = await get('SELECT id, name_ar, sector_id FROM department WHERE id = ? AND deleted_at IS NULL', [o.department_id]);
  if (!d || !d.sector_id || String(d.sector_id) !== String(sectorId)) return null;
  return d;
}

export async function backfillProjectDepartments({ force = false } = {}) {
  const done = await get('SELECT applied_at FROM schema_migration WHERE version = ?', [FLAG]);
  if (done?.applied_at && !force) {
    return { skipped: true, at: done.applied_at, viaOpp: [], viaOwner: [], left: [] };
  }

  const viaOpp = [];   // نُسبت إلى إدارة فرصتها المصدر
  const viaOwner = []; // نُسبت إلى إدارة مالكها
  const left = [];     // «بلا إدارة» — لا يُحسم لها صاحبٌ من قطاعها

  const rows = await all(`SELECT id, name_ar, sector_id, source_opp_id, owner_user_id
     FROM project WHERE deleted_at IS NULL AND department_id IS NULL ORDER BY created_at`);
  for (const p of rows) {
    let via = 'الفرصة المصدر';
    let dept = await departmentOfOpp(p.source_opp_id, p.sector_id);
    if (!dept) { via = 'المالك'; dept = await departmentOfUser(p.owner_user_id, p.sector_id); }
    if (!dept) { left.push({ project: p.name_ar }); continue; }
    const now = nowIso();
    await tx(async () => {
      await run('UPDATE project SET department_id = ?, updated_at = ? WHERE id = ?', [dept.id, now, p.id]);
      await audit(CTX, { action: 'update', resource: 'project', resourceId: p.id, sectorId: p.sector_id || null,
        detail: { department_id: dept.id, note: `التسكين الرجعي لإدارة المشروع — عبر ${via}` } });
    });
    (via === 'الفرصة المصدر' ? viaOpp : viaOwner).push({ project: p.name_ar, department: dept.name_ar });
  }

  const at = nowIso();
  await run(
    `INSERT INTO schema_migration (version, applied_at) VALUES (?,?)
     ON CONFLICT (version) DO UPDATE SET applied_at = excluded.applied_at`, [FLAG, at]);
  return { skipped: false, at, viaOpp, viaOwner, left };
}

// تشغيل مباشر من الإقلاع
if (process.argv[1] && process.argv[1].endsWith('backfill-project-departments.js')) {
  const r = await backfillProjectDepartments({ force: process.argv.includes('--force') });
  if (r.skipped) {
    console.log(`التسكين الرجعي لإدارات المشاريع: طُبِّق من قبل (${r.at}) — لا تغيير`);
  } else {
    console.log('التسكين الرجعي لإدارات المشاريع:');
    console.log(`  · نُسبت إلى إدارة فرصتها المصدر: ${r.viaOpp.length}`);
    for (const x of r.viaOpp) console.log(`      «${x.project}» ⟵ ${x.department}`);
    console.log(`  · نُسبت إلى إدارة مالكها: ${r.viaOwner.length}`);
    for (const x of r.viaOwner) console.log(`      «${x.project}» ⟵ ${x.department}`);
    console.log(`  · تُركت بلا إدارة (لا يُحسم صاحبها): ${r.left.length}`);
    for (const x of r.left) console.log(`      «${x.project}»`);
    if (!r.viaOpp.length && !r.viaOwner.length && !r.left.length) {
      console.log('  لا تغيير — كل مشروع قائم له إدارته');
    }
  }
  process.exit(0);
}
