// ── استدراك: كل فرصةٍ بلا إدارة تُنسب إلى إدارة صاحبها ───────────────────────
//
// «عشان نهاية السنة نعرف كل إدارة كم دخّلت» — والعمود موجود على الفرصة منذ موجة الإسناد
// الإداري، لكن ما أُدخل قبل باب الإنشاء الجديد وُلد كله «بلا إدارة». ومُرشِّح «بلا إدارة»
// يعرضها، غير أن مئةً وثلاثين صفاً لا تُسنَد يدوياً واحداً واحداً وأصحابها معروفون.
//
// ── ولا يخمّن ────────────────────────────────────────────────────────────────
// الإدارة تُشتقّ من صاحب الفرصة: المسؤول عنها ⟵ حسابه ⟵ موظفه ⟵ إدارته. فإن لم تُحسم من
// المسؤول جُرِّب المنشئ بنفس السلسلة. وتُقبل الإدارة بشرطين لا يُتنازل عنهما: قائمةٌ غير
// محذوفة، ومن قطاع الفرصة نفسه — إدارةٌ من قطاعٍ آخر تكسر الجمع من طرفيه (تُحسب في إدارةٍ
// لا تعمل عليها وتغيب عن إدارات قطاعها). وما لا يُحسم يُترك «بلا إدارة» ويُقال في الملخّص.
//
// ── والمرآة تُكتب من طرفيها ──────────────────────────────────────────────────
// فرصةٌ لها مشروع (مرآةٌ بمصدر «مشروع»، أو مشروعٌ وُلد من فوزها) تُكتب إدارتُها على الطرفين
// معاً في معاملةٍ واحدة: لو كُتبت الفرصة وحدها لأعادت مزامنةُ المرآة (opp-project-sync)
// مسحَها عند أول تعديلٍ على المشروع — استدراكٌ يمحو نفسه بصمت.
//
// يُشغَّل مرةً واحدة (طابع في `schema_migration`) — وإلا أُعيدت كتابة ما صحّحه المالك بيده.
import { all, get, run, tx } from '../src/core/db/index.js';
import { nowIso } from '../src/core/util/ids.js';
import { audit } from '../src/core/audit/index.js';

const FLAG = 'op:opportunity-department-attribution-v1';

// فاعلُ الكتابة في سجلّ التدقيق: ليس مستخدماً — والاسم يُقرأ في «آخر التحديثات» على صفحة
// الفرصة، فيقول ما جرى بلا أن يُنسَب إلى إنسانٍ لم يفعله.
const CTX = { user: { username: 'استدراك سند' } };

// إدارة صاحب الحساب: الحساب ⟵ موظفه ⟵ إدارته. تُقبل فقط إن كانت قائمةً غير محذوفة ومن قطاع
// الفرصة نفسه — وإلا فلا جواب من هذا الطريق.
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

export async function backfillOpportunityDepartments({ force = false } = {}) {
  const done = await get('SELECT applied_at FROM schema_migration WHERE version = ?', [FLAG]);
  if (done?.applied_at && !force) {
    return { skipped: true, at: done.applied_at, viaOwner: [], viaCreator: [], left: [], mirrored: [] };
  }

  const viaOwner = [];   // نُسبت إلى إدارة مالكها
  const viaCreator = []; // نُسبت إلى إدارة منشئها
  const left = [];       // «بلا إدارة» — لا يُحسم لها صاحبٌ من قطاعها
  const mirrored = [];   // كُتب الطرفان معاً: الفرصة ومشروعها

  const rows = await all(`SELECT id, title_ar, sector_id, source, owner_user_id, created_by
     FROM opportunity WHERE deleted_at IS NULL AND department_id IS NULL ORDER BY created_at`);
  for (const o of rows) {
    let via = 'المالك';
    let dept = await departmentOfUser(o.owner_user_id, o.sector_id);
    if (!dept) { via = 'المنشئ'; dept = await departmentOfUser(o.created_by, o.sector_id); }
    if (!dept) { left.push({ opportunity: o.title_ar }); continue; }
    // المشروع المقابل — سواء كانت الفرصة مرآةً بمصدر «مشروع» أو فرصةً وُلد من فوزها مشروع:
    // في الحالين يُكتب الطرفان معاً وإلا أعادت المزامنة مسحَ ما كُتب.
    const prj = await get('SELECT id FROM project WHERE source_opp_id = ? AND deleted_at IS NULL', [o.id]);
    const now = nowIso();
    await tx(async () => {
      await run('UPDATE opportunity SET department_id = ?, updated_at = ? WHERE id = ?', [dept.id, now, o.id]);
      await audit(CTX, { action: 'update', resource: 'opportunity', resourceId: o.id, sectorId: o.sector_id || null,
        detail: { department_id: dept.id, note: `التسكين الرجعي للإدارة — عبر ${via}` } });
      if (prj) {
        await run('UPDATE project SET department_id = ?, updated_at = ? WHERE id = ?', [dept.id, now, prj.id]);
        await audit(CTX, { action: 'update', resource: 'project', resourceId: prj.id, sectorId: o.sector_id || null,
          detail: { department_id: dept.id, note: `التسكين الرجعي للإدارة — مرآة الفرصة، عبر ${via}` } });
        mirrored.push({ opportunity: o.title_ar, project: prj.id });
      }
    });
    (via === 'المالك' ? viaOwner : viaCreator).push({ opportunity: o.title_ar, department: dept.name_ar });
  }

  const at = nowIso();
  await run(
    `INSERT INTO schema_migration (version, applied_at) VALUES (?,?)
     ON CONFLICT (version) DO UPDATE SET applied_at = excluded.applied_at`, [FLAG, at]);
  return { skipped: false, at, viaOwner, viaCreator, left, mirrored };
}

// تشغيل مباشر من الإقلاع
if (process.argv[1] && process.argv[1].endsWith('backfill-opportunity-departments.js')) {
  const r = await backfillOpportunityDepartments({ force: process.argv.includes('--force') });
  if (r.skipped) {
    console.log(`التسكين الرجعي لإدارات الفرص: طُبِّق من قبل (${r.at}) — لا تغيير`);
  } else {
    console.log('التسكين الرجعي لإدارات الفرص:');
    console.log(`  · نُسبت إلى إدارة مالكها: ${r.viaOwner.length}`);
    for (const x of r.viaOwner) console.log(`      «${x.opportunity}» ⟵ ${x.department}`);
    console.log(`  · نُسبت إلى إدارة منشئها: ${r.viaCreator.length}`);
    for (const x of r.viaCreator) console.log(`      «${x.opportunity}» ⟵ ${x.department}`);
    console.log(`  · تُركت بلا إدارة (لا يُحسم صاحبها): ${r.left.length}`);
    for (const x of r.left) console.log(`      «${x.opportunity}»`);
    console.log(`  · كُتبت على مشروعها أيضاً: ${r.mirrored.length}`);
    if (!r.viaOwner.length && !r.viaCreator.length && !r.left.length) {
      console.log('  لا تغيير — كل فرصة قائمة لها إدارتها');
    }
  }
  process.exit(0);
}
