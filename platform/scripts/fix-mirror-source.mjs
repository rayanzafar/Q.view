#!/usr/bin/env node
// ── تصحيحُ علامة المرآة على فرص قطاعٍ بعينه ───────────────────────────────────
//
//   node --experimental-sqlite scripts/fix-mirror-source.mjs --sector=CONSULTING            ← معاينة (لا يُكتب شيء)
//   node --experimental-sqlite scripts/fix-mirror-source.mjs --sector=CONSULTING --apply    ← التنفيذ
//   [--actor=sysadmin@evc.sa] [--year=2026] [--trust-bulk-load]
//
// ── العلّة ───────────────────────────────────────────────────────────────────
// `syncMirrorFromProject` لا تتبع إلا الفرص المعلَّمة `source = 'project'` — وهي العلامة التي
// بها وحدها يُعرف **اتجاه الحقيقة** بين الفرصة ومشروعها. ومرايا مشاريع قطاعٍ كامل حُمِّلت من
// خارج المنصة بعلامةٍ أخرى (مثل `CONS_IMPORT`)، فصارت كل قيمةٍ تُصحَّح في المشروع لا تصل إلى
// «الصفقة المكسوبة»، وتُقرأ في المبيعات قيمةٌ قديمة إلى الأبد.
//
// ── العلاج بالبيانات لا بالحارس ──────────────────────────────────────────────
// توسعةُ الحارس ليتبع `project.source_opp_id` مرفوضة: العمود يُكتب في الاتجاهين معاً
// (`opp-project-sync.js:100` و`:148`)، فلو صُدِّق لصار تعديلُ المشروع يكتب فوق فرصةٍ أدخلها
// إنسان — وهو الانقلاب الذي وُجدت `opp-project-sync.js:45-48` لمنعه. فالعلامة وحدها تُصحَّح،
// ولا تُصحَّح إلا حيث تُثبت القرائنُ أن الفرصة **وُلدت من مشروعها** لا العكس.
//
// ── مسار الكتابة ────────────────────────────────────────────────────────────
// `updateOpportunity` (src/modules/crm/opportunities.js:368) لا تقبل `source` أصلاً: قائمةُ
// حقولها مغلقة، وفتحُها للعلامة يعني أن أي محرِّر فرصةٍ من الشاشة يقلب اتجاه المرآة بيده —
// وهو نفس الخطر الذي رفضنا توسعة الحارس لأجله. فالكتابة تمرّ بأضيق بابٍ مُدقَّق متاح:
// `update()` من طبقة البيانات (لا SQL خام) داخل `tx` واحدة، ومعها `audit()` لكل صفّ. ثم
// تُستدعى `syncMirrorFromProject` نفسها لتنقل القيم — فلا تُكتب `value_halalas` بيدٍ هنا.
import { all, get, update, tx, close } from '../src/core/db/index.js';
import { audit } from '../src/core/audit/index.js';
import { initRbac } from '../src/core/rbac/index.js';
import { nowIso, toSar } from '../src/core/util/ids.js';
import { MIRROR_SOURCE, syncMirrorFromProject, projectHeadlineValue } from '../src/modules/crm/opp-project-sync.js';

const DEFAULT_ACTOR = 'sysadmin@evc.sa';
const DEFAULT_YEAR = 2026;

export function parseArgs(argv) {
  const o = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) o[m[1]] = m[2] ?? true;
  }
  return o;
}

// الهللات تُعرض كاملةً هنا عمداً: فارقُ ثماني هللات بين مشروعٍ ومرآته يختفي لو قُرِّب الرقم،
// والمالك يقرأ هذه المعاينة ليقرّر — فيراها كما هي.
const NF = new Intl.NumberFormat('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (h) => `${NF.format(toSar(h))} ر.س`;

async function loadActor(email) {
  const row = await get(
    'SELECT * FROM app_user WHERE lower(email) = lower(?) AND deleted_at IS NULL AND active = 1', [email]);
  if (!row) throw new Error(`لا حساب نشط بالبريد «${email}» — مرِّر --actor=<بريد مدير النظام>`);
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// الكشف: المرايا تُعرف بالرابط الخلفي لا بالعلامة
// ─────────────────────────────────────────────────────────────────────────────
export async function collectCandidates(sectorId) {
  return await all(
    `SELECT o.id o_id, o.title_ar o_title, o.source o_source, o.value_halalas o_value,
            o.created_at o_created, o.created_by o_created_by, o.client_id o_client, o.sector_id o_sector,
            o.department_id o_dept, o.owner_user_id o_owner, o.year o_year,
            o.exclude_from_sales o_excluded, st.is_won o_is_won,
            p.id p_id, p.name_ar p_name, p.created_at p_created, p.created_by p_created_by,
            p.contract_value_halalas p_contract, p.po_value_halalas p_po, p.budget_halalas p_budget,
            p.client_id p_client, p.sector_id p_sector, p.department_id p_dept, p.owner_user_id p_owner
       FROM project p
       JOIN opportunity o ON o.id = p.source_opp_id AND o.deleted_at IS NULL
       LEFT JOIN stage st ON st.id = o.stage_id
      WHERE p.sector_id = ? AND p.deleted_at IS NULL
        AND (o.source IS NULL OR o.source <> ?)
      ORDER BY o.title_ar`, [sectorId, MIRROR_SOURCE]);
}

// ── القرائن: أَمِنَ الفرصةِ وُلد المشروع، أم من المشروع وُلدت الفرصة؟ ──────────
// القاعدة عدائية عمداً: العلامة لا تُقلب إلا على ما تجتمع قرائنه، وكل شكٍّ يُخرِج الصفَّ إلى
// «تحتاج قرار إنسان». قلبُ علامةِ فرصةٍ باعها إنسان يجعل تعديلَ المشروع يمحو رقم البيع.
export async function evidenceFor(c) {
  const hist = await all(
    'SELECT from_stage_id, to_stage_id, changed_at, note FROM opportunity_stage_history WHERE opportunity_id = ? ORDER BY changed_at',
    [c.o_id]);
  const progressions = hist.filter((h) => h.from_stage_id != null).length;
  const proposals = (await get(
    'SELECT COUNT(*) n FROM proposal WHERE opportunity_id = ? AND deleted_at IS NULL', [c.o_id])).n;
  const activities = (await get(
    'SELECT COUNT(*) n FROM crm_activity WHERE opportunity_id = ? AND deleted_at IS NULL', [c.o_id])).n;
  // أثرُ الإنشاء يقول الاتجاه صراحةً حين يوجد: مرآةُ المشروع تُسجَّل `mirror: 'project'`،
  // ومشروعُ الفرصة يُسجَّل `mirror: 'opportunity'` على المشروع نفسه.
  const oppCreate = await get(
    `SELECT detail_json FROM audit_log WHERE resource = 'opportunity' AND resource_id = ? AND action = 'create'
      ORDER BY at LIMIT 1`, [c.o_id]);
  const prjCreate = await get(
    `SELECT detail_json FROM audit_log WHERE resource = 'project' AND resource_id = ? AND action = 'create'
      ORDER BY at LIMIT 1`, [c.p_id]);
  const mirrorOf = (row) => {
    if (!row?.detail_json) return null;
    try { return JSON.parse(row.detail_json).mirror || null; } catch { return null; }
  };
  const oc = String(c.o_created || ''); const pc = String(c.p_created || '');
  const order = oc && pc ? (oc > pc ? 'project_first' : oc < pc ? 'opportunity_first' : 'same_moment') : 'unknown';

  // ── هل هذا الصفّ **حُمِّل آلياً** أم أنشأه إنسان؟ ────────────────────────────
  // أسبقيةُ الإنشاء دليلٌ على اتجاه الولادة حين يكون كل صفٍّ قد أُنشئ وحده. أما دفعةٌ كاملة
  // كُتبت في الجزء الواحد من الثانية، بلا `created_by`، وبلا سطرِ مراحل، وبلا أثرِ إنشاء —
  // فترتيبُها ترتيبُ تحميلٍ لا ترتيبُ قرار، ولا يُقرأ منه أن إنساناً باع ثم نفّذ.
  const cohort = (await get(
    `SELECT COUNT(*) n FROM opportunity WHERE sector_id = ? AND created_at = ? AND deleted_at IS NULL`,
    [c.o_sector, c.o_created])).n;
  const bulk = cohort >= 3 && !c.o_created_by && !hist.length && !oppCreate;

  const ev = { order, o_created: oc, p_created: pc, stageHistory: hist.length, progressions,
    proposals, activities, auditOpp: mirrorOf(oppCreate), auditPrj: mirrorOf(prjCreate),
    cohort, bulkLoad: bulk };

  // ① أدلّةٌ قاطعة على أن الفرصة أصلٌ باعه إنسان — تُستبعَد بلا نقاش.
  const blockers = [];
  if (ev.auditPrj === 'opportunity') blockers.push('أثرُ إنشاء المشروع يقول إنه وُلد من الفرصة');
  if (progressions > 0) blockers.push(`سجلُّ المراحل فيه ${progressions} انتقالاً من مرحلةٍ إلى أخرى (رحلة بيع بشرية)`);
  if (order === 'opportunity_first' && !bulk) blockers.push('الفرصة أُنشئت قبل مشروعها');
  if (proposals > 0) blockers.push(`مرتبطٌ بها ${proposals} عرضاً`);
  if (order === 'unknown') blockers.push('تواريخ الإنشاء ناقصة فلا يُعرف الأسبق');
  if (!Number(c.o_is_won)) blockers.push('الفرصة ليست في مرحلةٍ مكسوبة — ليست مرآةَ فوز');

  // ② أدلّةٌ مؤيِّدة للولادة من المشروع.
  const supports = [];
  if (ev.auditOpp === 'project') supports.push('أثرُ إنشاء الفرصة يقول إنها مرآةُ مشروع');
  if (order === 'project_first') supports.push('المشروع أُنشئ قبل فرصته');
  if (order === 'same_moment') supports.push('أُنشئا في اللحظة نفسها (تحميلٌ واحد)');
  if (bulk) supports.push(`حُمِّلت ضمن دفعةٍ واحدة (${cohort} فرصة في اللحظة ${oc}) بلا منشئٍ ولا سجلِّ مراحل ولا أثرِ إنشاء`);
  if (progressions === 0) supports.push('لا انتقال بين المراحل — دخلت مكسوبةً مباشرة');
  if (!proposals) supports.push('لا عروض مرتبطة');

  ev.blockers = blockers;
  ev.supports = supports;
  // التصنيف: لا مانع، ومعه دليلٌ مؤيِّد صريح (أثرٌ يقول «مرآة» أو أسبقيةُ المشروع) مع خلوّ
  // سجلِّ المراحل من أي انتقال بشري.
  const strong = ev.auditOpp === 'project' || order === 'project_first' || order === 'same_moment';
  ev.verdict = !blockers.length && strong && progressions === 0 ? 'project_born'
    // دفعةٌ محمَّلة سبقت مشاريعها: كل قرائن «ليست بيعاً بشرياً» حاضرة، والباقي أسبقيةٌ لا
    // تحسم. لا تُقلب علامتُها بالافتراض — تُعرض وحدها ولا تُنفَّذ إلا بعَلَمٍ صريح من المالك.
    : !blockers.length && bulk && progressions === 0 ? 'bulk_load_pending'
      : 'excluded';
  if (ev.verdict === 'project_born' && activities > 0) {
    ev.warn = `عليها ${activities} نشاطاً مسجَّلاً — أنشطة القطاع مشتقّة من الترحيل غالباً، فلا تُعدّ دليلَ بيعٍ بشري`;
  }
  return ev;
}

// ─────────────────────────────────────────────────────────────────────────────
// الخطة
// ─────────────────────────────────────────────────────────────────────────────
export async function planFix({ sectorId, year = DEFAULT_YEAR, trustBulkLoad = false }) {
  const cands = await collectCandidates(sectorId);
  const fix = []; const excluded = []; const pending = [];
  for (const c of cands) {
    const ev = await evidenceFor(c);
    const target = projectHeadlineValue({
      contract_value_halalas: c.p_contract, po_value_halalas: c.p_po, budget_halalas: c.p_budget });
    // نفس ما ستكتبه `syncMirrorFromProject` حرفاً بحرف — تُعرض القيمةُ فقط، ولا تُكتب هنا.
    const fields = [];
    if ((c.p_name ?? null) !== (c.o_title ?? null)) fields.push('الاسم');
    if ((c.p_client ?? null) !== (c.o_client ?? null)) fields.push('الجهة');
    if ((c.p_sector ?? null) !== (c.o_sector ?? null)) fields.push('القطاع');
    if ((c.p_dept ?? null) !== (c.o_dept ?? null)) fields.push('الإدارة');
    if ((c.p_owner ?? null) !== (c.o_owner ?? null)) fields.push('المسؤول');
    const row = { ...c, ev, target, delta: target - (Number(c.o_value) || 0), fields };
    if (ev.verdict === 'project_born') fix.push(row);
    else if (ev.verdict === 'bulk_load_pending') (trustBulkLoad ? fix : pending).push(row);
    else excluded.push(row);
  }
  const salesBefore = await sectorWonTotal(sectorId, year);
  const yearDelta = (rows) => rows.filter((r) => Number(r.o_year) === Number(year))
    .reduce((s, r) => s + r.delta, 0);
  const expectedAfter = salesBefore + yearDelta(fix);
  return { sectorId, year, trustBulkLoad, fix, excluded, pending, salesBefore, expectedAfter,
    pendingDelta: yearDelta(pending) };
}

export async function sectorWonTotal(sectorId, year) {
  // نفس استعلام لوحة المبيعات (`metrics.js` — «قيمة الفرص المكسوبة لسنة البيع»).
  return (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o
      JOIN stage st ON st.id = o.stage_id
     WHERE o.sector_id = ? AND o.year = ? AND st.is_won = 1 AND o.deleted_at IS NULL`, [sectorId, year])).v;
}

// عدّادات إثبات أن المعاينة لم تكتب شيئاً.
export async function counters(sectorId) {
  const marked = (await get(
    `SELECT COUNT(*) n FROM opportunity WHERE sector_id = ? AND source = ? AND deleted_at IS NULL`,
    [sectorId, MIRROR_SOURCE])).n;
  const audits = (await get(
    `SELECT COUNT(*) n FROM audit_log WHERE sector_id = ?`, [sectorId])).n;
  return { marked, audits };
}

// ─────────────────────────────────────────────────────────────────────────────
// التنفيذ
// ─────────────────────────────────────────────────────────────────────────────
export async function applyFix(plan, { apply = false, actor }) {
  const done = { flipped: 0, resynced: 0, failures: [] };
  if (!apply || !plan.fix.length) return done;
  await initRbac();
  const ctx = { user: actor, ip: '127.0.0.1' };
  await tx(async () => {
    for (const r of plan.fix) {
      // ① العلامة — بابٌ ضيّق مُدقَّق (لا SQL خام، ولا فتحُ `source` في خدمة التعديل العامة).
      await update('opportunity', r.o_id,
        { source: MIRROR_SOURCE, updated_at: nowIso(), updated_by: actor.id });
      await audit(ctx, { action: 'update', resource: 'opportunity', resourceId: r.o_id,
        sectorId: r.o_sector || plan.sectorId,
        detail: { fix: 'mirror_source', from: r.o_source ?? null, to: MIRROR_SOURCE,
          project_id: r.p_id, evidence: r.ev.supports } });
      done.flipped++;
      // ② ثم تتبع المرآةُ مشروعَها بالخدمة القائمة — القيم تُنقل ولا تُكتب بيدٍ هنا.
      const project = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [r.p_id]);
      const res = await syncMirrorFromProject(ctx, project);
      if (res.updated) done.resynced++;
    }
  });
  return done;
}

// ─────────────────────────────────────────────────────────────────────────────
// العرض
// ─────────────────────────────────────────────────────────────────────────────
export function renderPlan(plan, { apply = false, done = null, after = null, before = null } = {}) {
  const L = []; const p = (s = '') => L.push(s);
  const bar = (ch = '─') => ch.repeat(96);
  p(apply ? `تصحيح علامة المرآة — تنفيذ · القطاع ${plan.sectorId}`
    : `تصحيح علامة المرآة — معاينة (لا يُكتب شيء) · القطاع ${plan.sectorId}`);
  p(bar('═'));
  p(`مرايا وُجدت بالرابط الخلفي وعلامتُها ليست «${MIRROR_SOURCE}»: ${plan.fix.length + plan.pending.length + plan.excluded.length}`);
  p(`تُصحَّح علامتها: ${plan.fix.length} · تنتظر إذن المالك: ${plan.pending.length} · تُستبعَد: ${plan.excluded.length}`);
  p();

  if (plan.fix.length) {
    p('① مرايا مشاريع — العلامة تُصحَّح ثم تتبع المرآةُ مشروعها'); p(bar());
    for (const r of plan.fix) {
      const moves = r.delta !== 0;
      p(`▸ ${r.o_title}`);
      p(`   الفرصة ${r.o_id} · العلامة «${r.o_source ?? 'بلا علامة'}» ← «${MIRROR_SOURCE}» · سنة البيع ${r.o_year ?? 'غير مؤكدة'}`);
      p(`   المشروع ${r.p_id} — ${r.p_name} · قيمة العقد ${money(r.p_contract)}`);
      p(`   القيمة: ${money(r.o_value)} ${moves ? `← ${money(r.target)}  (فرق ${money(r.delta)})` : '= مطابقة، لا تتحرك'}`);
      if (r.fields.length) p(`   حقولٌ أخرى ستتبع المشروع: ${r.fields.join(' · ')}`);
      p(`   القرائن: ${r.ev.supports.join(' · ')}`);
      p(`   (أُنشئ المشروع ${r.ev.p_created} · أُنشئت الفرصة ${r.ev.o_created} · انتقالات المراحل ${r.ev.progressions} · عروض ${r.ev.proposals} · أنشطة ${r.ev.activities})`);
      if (r.ev.warn) p(`   تنبيه: ${r.ev.warn}`);
      p();
    }
  }
  if (plan.pending.length) {
    p('② دفعةٌ محمَّلة سبقت مشاريعها — لا تُقلب علامتها إلا بإذنٍ صريح (--trust-bulk-load)'); p(bar('═'));
    p('   كل قرائن «ليست بيعاً بشرياً في المنصة» حاضرة: لا سجلَّ مراحل، لا منشئ، لا أثرَ إنشاء،');
    p('   لا عروض — والصفوف كلها كُتبت في اللحظة نفسها. والباقي أسبقيةُ تحميلٍ لا أسبقيةُ قرار.');
    p();
    for (const r of plan.pending) {
      const moves = r.delta !== 0;
      p(`▸ ${r.o_title}`);
      p(`   الفرصة ${r.o_id} · العلامة «${r.o_source ?? 'بلا علامة'}» · سنة البيع ${r.o_year ?? 'غير مؤكدة'} · المشروع ${r.p_id}`);
      p(`   القيمة: ${money(r.o_value)} ${moves ? `← ${money(r.target)}  (فرق ${money(r.delta)})` : '= مطابقة، لا تتحرك'}`);
      if (r.fields.length) p(`   حقولٌ أخرى ستتبع المشروع: ${r.fields.join(' · ')}`);
      p(`   (دفعة ${r.ev.cohort} فرصة في ${r.ev.o_created} · المشروع ${r.ev.p_created} · مراحل ${r.ev.progressions} · عروض ${r.ev.proposals} · أنشطة ${r.ev.activities})`);
      p();
    }
    p(`   لو أُذن بها: مجموع ${plan.year} يتحرك بمقدار ${money(plan.pendingDelta)} ليصير ${money(plan.salesBefore + plan.pendingDelta)}.`);
    p();
  }
  if (plan.excluded.length) {
    p('③ مُستبعَدة — لا تُقلب علامتها (تحتاج قرار إنسان)'); p(bar('═'));
    for (const r of plan.excluded) {
      p(`▸ ${r.o_title} — الفرصة ${r.o_id} · المشروع ${r.p_id}`);
      p(`   القيمة الآن ${money(r.o_value)} · قيمة المشروع ${money(r.target)}`);
      p(`   المانع: ${r.ev.blockers.join(' · ')}`);
      p();
    }
  }
  p('④ مجموع الفرص المكسوبة للقطاع'); p(bar());
  p(`   سنة ${plan.year}: ${money(plan.salesBefore)}  ←  المتوقَّع ${money(plan.expectedAfter)}  (فرق ${money(plan.expectedAfter - plan.salesBefore)})`);
  if (after != null) p(`   الفعلي بعد التنفيذ: ${money(after)}`);
  p();
  if (before) {
    p(apply ? '⑤ العدّادات قبل التنفيذ وبعده' : '⑤ إثبات أن المعاينة لا تكتب'); p(bar());
    p(`   فرصٌ معلَّمة «${MIRROR_SOURCE}» في القطاع: ${before.marked} → ${done?.countersAfter?.marked ?? before.marked}`);
    p(`   أسطر التدقيق للقطاع: ${before.audits} → ${done?.countersAfter?.audits ?? before.audits}`);
    p();
  }
  if (done && apply) {
    p('ما نُفِّذ فعلاً'); p(bar());
    p(`   علاماتٌ صُحِّحت: ${done.flipped} · مرايا تتبعت مشاريعها: ${done.resynced}`);
    if (done.failures.length) for (const f of done.failures) p(`   • تعذّر: ${f}`);
  }
  return L.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.sector) {
    console.error('استعمال: --sector=<رمز القطاع> [--apply] [--actor=<بريد>] [--year=2026] [--trust-bulk-load]');
    process.exit(2);
  }
  const apply = opts.apply === true || opts.apply === 'true';
  const year = Number(opts.year) || DEFAULT_YEAR;
  const trustBulkLoad = opts['trust-bulk-load'] === true || opts['trust-bulk-load'] === 'true';
  const sectorId = String(opts.sector);
  const sector = await get('SELECT id, name_ar FROM sector WHERE id = ? AND deleted_at IS NULL', [sectorId]);
  if (!sector) throw new Error(`لا قطاع برمز «${sectorId}»`);

  const before = await counters(sectorId);
  const plan = await planFix({ sectorId, year, trustBulkLoad });
  let actor = null;
  if (apply) actor = await loadActor(String(opts.actor || DEFAULT_ACTOR));
  const done = await applyFix(plan, { apply, actor });
  done.countersAfter = await counters(sectorId);
  const after = apply ? await sectorWonTotal(sectorId, year) : null;
  console.log(renderPlan(plan, { apply, done, after, before }));
  if (apply) console.log(`\nنُفِّذ بحساب: ${actor.username} (${actor.email})`);
  await close?.();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (e) => { console.error('تعذّر إتمام التصحيح:', e.message); try { await close?.(); } catch { /* ignore */ } process.exit(1); });
}
