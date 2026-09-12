// ── استدراك: كل مشروع له فرصته، وكل فرصة مكسوبة لها مشروعها ──────────────────
//
// «المفروض أي شيء في المشاريع موجود في الفرص — مثلاً «خدمات مدارة» مكسوبة لقطاع الابتكار وهكذا
//  أي شيء» — بلسان المالك.
//
// المرآة الجديدة (`modules/crm/opp-project-sync.js`) تحكم ما يُكتب **من اليوم**: كل مشروع يُنشأ
// تُولَد معه فرصته المكسوبة، وكل فرصة تبلغ الفوز يُولَد معها مشروعها. أما ما في القاعدة قبلها
// فلا يعرفه أحد — والقاعدة التي تسري على الجديد وحده تترك الشاشتين مفترقتين على كل ما مضى.
//
// ── ولا يخمّن ────────────────────────────────────────────────────────────────
// قبل أن يُنشئ فرصةً لمشروع، يبحث عن فرصةٍ مكسوبة قائمة **في قطاعه** باسمٍ يطابقه: كثيرٌ من
// المشاريع المستوردة له فرصته فعلاً ولم يُكتب الرابط بينهما. وإنشاءُ فرصةٍ ثانية هناك ازدواجٌ
// في المبيعات لا استدراك. والمطابقة بنفس مقياس سكربت الإشغال حرفاً بحرف (`projectWords`):
// أعلى نتيجة **وحيدة** بكلمتين مشتركتين على الأقل، وتعادلٌ في القمة ⟵ لا ربط بل إنشاء.
//
// ── والسنة تحمي ما أُعلن ─────────────────────────────────────────────────────
// مشروعٌ بدأ في سنةٍ ماضية تُسجَّل مرآته **في سنته** وتُعلَّم «تاريخي» (`exclude_from_sales`،
// وهي علامةٌ قائمة في المنصة للفرص المستوردة). فلا يتحرّك بها رقمُ مبيعاتٍ قرأه المالك من قبل،
// وتبقى الفرصة ظاهرةً في قائمتها كما طلب. ومشاريع السنة الجارية تُحسب كما هي — لأنها فوزُ عامها.
//
// يُشغَّل مرةً واحدة (طابع في `schema_migration`) — وإلا أُعيد إنشاء ما حذفه المالك بيده.
import { all, get, run, tx } from '../src/core/db/index.js';
import { nowIso } from '../src/core/util/ids.js';
import { audit } from '../src/core/audit/index.js';
import { norm, projectWords } from './apply-utilization-may2026.js';
import {
  ensureOpportunityForProject, ensureProjectForWonOpportunity, mirrorYear, wonStage,
} from '../src/modules/crm/opp-project-sync.js';

const FLAG = 'op:project-opportunity-mirror-v1';

// فاعلُ الكتابة في سجلّ التدقيق: ليس مستخدماً — والاسم يُقرأ في «آخر التحديثات» على صفحة
// المشروع، فيقول ما جرى بلا أن يُنسَب إلى إنسانٍ لم يفعله.
const CTX = { user: { username: 'استدراك سند' } };

// درجة التشابه بين اسمَي مشروعٍ وفرصة — نفس مقياس سكربت الإشغال، ومصدرُ الكلمات واحد.
function score(aName, bName) {
  const w = projectWords(aName);
  if (!w.length) return 0;
  return projectWords(bName).filter((x) => w.includes(x)).length;
}

// المرشَّح الوحيد أو لا شيء: تعادلٌ في القمة يعني أن الاسم لا يحسم، فيُترك ويُقال في السجل.
export function matchOpportunity(candidates, project) {
  const exact = candidates.filter((o) => norm(o.title_ar) === norm(project.name_ar));
  if (exact.length === 1) return { opp: exact[0], basis: 'الاسم مطابق' };
  const scored = candidates.map((o) => ({ o, s: score(project.name_ar, o.title_ar) }))
    .filter((x) => x.s >= 2).sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  const top = scored[0].s;
  const tied = scored.filter((x) => x.s === top);
  if (tied.length !== 1) return null;
  return { opp: tied[0].o, basis: `تشابه ${top} كلمات` };
}

export async function backfillProjectOpportunities({ force = false, now = new Date() } = {}) {
  const done = await get('SELECT applied_at FROM schema_migration WHERE version = ?', [FLAG]);
  if (done?.applied_at && !force) return { skipped: true, at: done.applied_at, linked: [], created: [], projects: [], notes: [] };

  const notes = [];
  const linked = [];   // مشروعٌ وُصل بفرصةٍ قائمة
  const created = [];  // مشروعٌ وُلدت له فرصة
  const projects = []; // فرصةٌ مكسوبة وُلد لها مشروع
  const won = await wonStage();
  if (!won) {
    notes.push('لا مرحلة مكسوبة في سجلّ المراحل — لم يُكتب شيء');
    return { skipped: false, at: null, linked, created, projects, notes, unresolved: true };
  }
  const thisYear = now.getUTCFullYear();

  // ① كل مشروعٍ بلا فرصة ──────────────────────────────────────────────────────
  const orphanProjects = await all(`SELECT * FROM project
     WHERE deleted_at IS NULL
       AND (source_opp_id IS NULL
            OR source_opp_id NOT IN (SELECT id FROM opportunity WHERE deleted_at IS NULL))
     ORDER BY created_at`);
  // الفرص المكسوبة غير المرتبطة بمشروع — مرشَّحات الربط. تُقرأ مرةً واحدة ويُنقَص منها ما رُبط،
  // فلا تُربط فرصةٌ واحدة بمشروعين في نفس التشغيل.
  const freeWon = await all(`SELECT o.* FROM opportunity o
     WHERE o.deleted_at IS NULL AND o.stage_id = ?
       AND NOT EXISTS (SELECT 1 FROM project p WHERE p.source_opp_id = o.id AND p.deleted_at IS NULL)`, [won.id]);
  const takenOpp = new Set();

  for (const p of orphanProjects) {
    const pool = freeWon.filter((o) => !takenOpp.has(o.id)
      && String(o.sector_id || '') === String(p.sector_id || ''));
    const hit = matchOpportunity(pool, p);
    if (hit) {
      takenOpp.add(hit.opp.id);
      await run('UPDATE project SET source_opp_id = ?, updated_at = ? WHERE id = ?', [hit.opp.id, nowIso(), p.id]);
      await audit(CTX, { action: 'update', resource: 'project', resourceId: p.id, sectorId: p.sector_id || null,
        detail: { mirror: 'link', source_opp_id: hit.opp.id, basis: hit.basis } });
      linked.push({ project: p.name_ar, opportunity: hit.opp.title_ar, basis: hit.basis });
      continue;
    }
    const year = mirrorYear(p, now);
    const r = await tx(() => ensureOpportunityForProject(CTX, p, { year, historic: year < thisYear }));
    if (!r.opportunity_id) { notes.push(`«${p.name_ar}»: تعذّر إنشاء الفرصة`); continue; }
    created.push({ project: p.name_ar, year, historic: year < thisYear });
  }

  // ② كل فرصةٍ مكسوبة بلا مشروع ───────────────────────────────────────────────
  // بعد ①، لأن ① قد يربط بعضها بمشاريع قائمة — فتخرج من هذه القائمة بلا إنشاء.
  const orphanWon = await all(`SELECT o.* FROM opportunity o
     WHERE o.deleted_at IS NULL AND o.stage_id = ?
       AND NOT EXISTS (SELECT 1 FROM project p WHERE p.source_opp_id = o.id AND p.deleted_at IS NULL)`, [won.id]);
  for (const o of orphanWon) {
    const r = await tx(() => ensureProjectForWonOpportunity(CTX, o));
    if (r.created) projects.push({ opportunity: o.title_ar, value_halalas: Number(o.value_halalas) || 0 });
  }

  const at = nowIso();
  await run(
    `INSERT INTO schema_migration (version, applied_at) VALUES (?,?)
     ON CONFLICT (version) DO UPDATE SET applied_at = excluded.applied_at`, [FLAG, at]);
  return { skipped: false, at, linked, created, projects, notes };
}

// تشغيل مباشر من الإقلاع
if (process.argv[1] && process.argv[1].endsWith('backfill-project-opportunities.js')) {
  const r = await backfillProjectOpportunities({ force: process.argv.includes('--force') });
  if (r.skipped) {
    console.log(`المرآة بين المشاريع والفرص: طُبِّقت من قبل (${r.at}) — لا تغيير`);
  } else {
    console.log(`المرآة بين المشاريع والفرص:`);
    console.log(`  · رُبط بفرصة قائمة: ${r.linked.length}`);
    for (const x of r.linked) console.log(`      «${x.project}» ⟵ «${x.opportunity}» (${x.basis})`);
    console.log(`  · فرصة مكسوبة أُنشئت لمشروع: ${r.created.length}`);
    for (const x of r.created) console.log(`      «${x.project}» — سنة ${x.year}${x.historic ? ' (تاريخي، لا يدخل مبيعات السنة)' : ''}`);
    console.log(`  · مشروع أُنشئ لفرصة مكسوبة: ${r.projects.length}`);
    for (const x of r.projects) console.log(`      «${x.opportunity}»`);
    for (const n of r.notes) console.log(`  ⚠ ${n}`);
    if (!r.linked.length && !r.created.length && !r.projects.length && !r.notes.length) console.log('  لا تغيير — كل مشروع له فرصته وكل فرصة مكسوبة لها مشروعها');
  }
  process.exit(0);
}
