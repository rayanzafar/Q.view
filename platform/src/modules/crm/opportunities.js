// CRM — Opportunities service. Scope-filtered lists, redacted reads, audited writes,
// stage-history tracking, and Go/No-Go via the workflow engine.
import { all, get, insert, update, run } from '../../core/db/index.js';
import { can, redact, redactList } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';
import { isSupportUnit } from '../../core/org/kind.js';
import { getTeam } from './oppteam.js';

// Stage-rot thresholds (benchmarks §1 — Pipedrive rotting): an OPEN opportunity sitting in a stage
// longer than its threshold (days) is flagged متوقفة. Stages absent from the map (won/lost/on-hold)
// never rot. Exported so views and tests share one source of truth.
export const ROT_THRESHOLDS = { LEAD: 14, QUALIFIED: 14, PROPOSAL: 21, NEGOTIATION: 30 };

// قيمة مُرشِّح «فرص بلا إدارة». كلمةٌ محجوزة لا معرّف إدارة — ولا إدارة تحمل هذا المعرّف لأن
// كل المعرّفات تُولَّد ببادئة. تُصدَّر كي تستعملها الشاشة والخدمة والاختبار من مصدرٍ واحد.
export const NO_DEPARTMENT = 'none';

// Whole days spent in the current stage, measured from stage_changed_at (fallback: created_at)
// to `today` (a bound YYYY-MM-DD string — never SQL date functions; portable + deterministic).
export function stageAgeDays(row, today) {
  const ref = String(row.stage_changed_at || row.created_at || '').slice(0, 10);
  const t = Date.parse(String(today).slice(0, 10) + 'T00:00:00Z');
  const r = Date.parse(ref + 'T00:00:00Z');
  if (!Number.isFinite(t) || !Number.isFinite(r)) return null;
  return Math.max(0, Math.floor((t - r) / 86400000));
}

// Attach the pipeline-discipline flags to a raw opportunity row (pure; today = 'YYYY-MM-DD').
function withDiscipline(row, today) {
  const age = stageAgeDays(row, today);
  const th = ROT_THRESHOLDS[row.stage_id];
  return {
    ...row,
    stage_age_days: age,
    rot: !!(th && age != null && age > th),
    no_next_action: !(row.next_action && String(row.next_action).trim()),
  };
}

// opts.today ('YYYY-MM-DD') pins the stage-age clock for deterministic tests; defaults to now.
export async function listOpportunities(user, filters = {}, opts = {}) {
  const f = scopeFilter(user, 'opportunity', 'read');
  const where = [f.clause];
  const params = [...f.params];
  where.push('deleted_at IS NULL');
  if (filters.stage) { where.push('stage_id = ?'); params.push(filters.stage); }
  if (filters.sector) { where.push('sector_id = ?'); params.push(filters.sector); }
  // ── الإدارة ──
  // «ممكن أفلتر بالإدارات اللي تحت قطاع الحلول أو أفلتر بقطاع الحلول… عشان نهاية السنة نعرف
  // كل إدارة كم دخّلت» — والعمود موجود على الفرصة منذ موجة الإسناد الإداري، ولم يكن يقرؤه أحد.
  //
  // و«بلا إدارة» قيمةٌ مقصودة لا غياب مُرشِّح: الفرص غير المُسنَدة هي بالضبط ما يجب أن يُرى
  // ليُسنَد. ولو كان الترشيح بالإدارة وحده لبقيت تلك الفرص خارج كل عدسة — فلا تُنسب لأحد ولا
  // يعرف أحد بوجودها، وتظهر آخر السنة فرقاً بين مجموع الإدارات ومجموع القطاع.
  if (filters.department === NO_DEPARTMENT) where.push('department_id IS NULL');
  else if (filters.department) { where.push('department_id = ?'); params.push(filters.department); }
  const rows = await all(
    `SELECT * FROM opportunity WHERE ${where.join(' AND ')} ORDER BY value_halalas DESC LIMIT 500`, params);
  const today = String(opts.today || nowIso().slice(0, 10)).slice(0, 10);
  return redactList(user, 'opportunity', rows).map((r) => withDiscipline(r, today));
}

export async function getOpportunity(user, oppId) {
  const row = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!row) throw notFound('الفرصة غير موجودة');
  if (!can(user, 'read', 'opportunity', row)) throw forbidden();
  return redact(user, 'opportunity', row);
}

export async function createOpportunity(ctx, data) {
  const user = ctx.user;
  if (!can(user, 'create', 'opportunity')) throw forbidden();
  const sectorId = data.sector_id || user.sector_id;
  if (!can(user, 'create', 'opportunity', { sector_id: sectorId })) throw forbidden('خارج نطاق قطاعك');
  if (!data.title_ar) throw badRequest('عنوان الفرصة مطلوب');
  // نفس حارس النقل، على باب الإنشاء: الفرصة تُنسب إلى قطاع تسليم لا إلى وحدة مساندة. الباب هنا
  // أخطر من باب النقل لأنه يُفتح ضمناً — القطاع الافتراضي هو قطاع المنشئ، فعضو «الخدمات المشتركة»
  // أو رئيس تطوير الأعمال يُنشئ فرصةً فتُولَد خارج كل مقارنة بلا أن يطلب ذلك أحد ولا أن يظهر خطأ.
  // إغلاق باب النقل وحده يترك المال يتسرّب من الباب الآخر.
  const sec = sectorId ? await get('SELECT id, name_ar, kind FROM sector WHERE id = ? AND deleted_at IS NULL', [sectorId]) : null;
  if (!sec) throw badRequest('حدّد القطاع المسؤول عن الفرصة');
  if (isSupportUnit(sec))
    throw badRequest(`«${sec.name_ar}» وحدة مساندة على مستوى الشركة وليست قطاع تسليم — الفرصة تُنسب إلى قطاع تسليم. اختر قطاعاً من القائمة.`);
  // الإدارة على باب الإنشاء: بدونها تُولَد كل فرصةٍ جديدة «بلا إدارة» ثم تُصنَّف لاحقاً — ونيّة
  // التصنيف تُنسى، فيظهر آخر السنة فرقٌ بين مجموع الإدارات ومجموع القطاع لا سبب له إلا النسيان.
  const departmentId = await resolveDepartment(data.department_id || null, sectorId);
  const oid = id('opp');
  const now = nowIso();
  await insert('opportunity', {
    id: oid, code: data.code || null, title_ar: data.title_ar,
    client_id: data.client_id || null, sector_id: sectorId, department_id: departmentId,
    owner_user_id: data.owner_user_id || user.id, stage_id: data.stage_id || 'LEAD',
    win_pct: data.win_pct ?? null, value_halalas: toHalalas(data.value_sar),
    priority: data.priority || null, year: data.year || new Date().getUTCFullYear(),
    source: data.source || 'manual', next_action: data.next_action || null, notes: data.notes || null,
    exclude_from_sales: data.exclude_from_sales ? 1 : 0, stage_changed_at: now,
    created_at: now, created_by: user.id,
  });
  await audit(ctx, { action: 'create', resource: 'opportunity', resourceId: oid, sectorId });
  return await getOpportunity(user, oid);
}

// حارس القطاع الهدف — بابان يؤدّيان إليه (زرّ «نقل لقطاع آخر» على القائمة، وشريط التحكم على
// صفحة الفرصة)، ونسخةٌ واحدة من الحكم. ولو تُرك لكل بابٍ نسخته لانفتح أحدهما يوماً على وحدة
// مساندة بلا أن يسقط فحص — والفرصة هناك تخرج من مقارنة القطاعات ومن المستهدف بلا رسالة.
async function assertDeliverySector(sectorId) {
  const target = await get('SELECT id, name_ar, kind FROM sector WHERE id = ? AND active = 1 AND deleted_at IS NULL', [sectorId]);
  if (!target) throw badRequest('قطاع غير معروف');
  if (isSupportUnit(target)) {
    throw badRequest(`«${target.name_ar}» وحدة مساندة على مستوى الشركة وليست قطاع تسليم — الفرص تُنقل بين قطاعات التسليم فقط. اختر قطاعاً من القائمة.`);
  }
  return target;
}

// إدارةٌ تتبع قطاعاً غير قطاع الفرصة تكسر الجمع من طرفيه: تُحسب في إدارةٍ لا تعمل عليها،
// وتغيب عن إدارات قطاعها. فالنسبة تُدقَّق مقابل القطاع **بعد** التعديل لا قبله.
async function resolveDepartment(deptId, sectorId) {
  if (!deptId) return null;
  const d = await get('SELECT id, name_ar, sector_id FROM department WHERE id = ? AND deleted_at IS NULL', [deptId]);
  if (!d) throw badRequest('الإدارة المختارة غير موجودة');
  if (sectorId && d.sector_id && String(d.sector_id) !== String(sectorId)) {
    throw badRequest('الإدارة المختارة تتبع قطاعاً آخر — اختر إدارة من قطاع الفرصة نفسه');
  }
  return d.id;
}

export async function updateOpportunity(ctx, oppId, data) {
  const user = ctx.user;
  const row = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!row) throw notFound('الفرصة غير موجودة');
  if (!can(user, 'update', 'opportunity', row)) throw forbidden();
  const patch = {};
  for (const k of ['title_ar', 'client_id', 'priority', 'next_action', 'notes', 'win_pct']) {
    if (k in data) patch[k] = data[k];
  }
  if ('value_sar' in data) patch.value_halalas = toHalalas(data.value_sar);
  if ('year' in data) {
    const y = Number(data.year);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw badRequest('السنة غير صحيحة — اكتب سنةً بأربعة أرقام');
    patch.year = y;
  }
  // ── هوية الفرصة: قطاعها وإدارتها ومسؤولها — تُدار من صفحتها ──────────────────
  // «في فرص مسكّنة على إدارة الابتكار وأبغى أنقلها على الذكاء… لازم في الواجهة شي يساعدني لما
  // أضغط على الفرصة عشان أتحكّم بكل عملياتها». وكانت هذه الثلاثة تُكتب مرةً عند الإنشاء ثم لا
  // يمسّها شيء: الإدارة **لم يكن لها بابٌ واحد في المنتج كله** رغم أن العمود موجود والترشيح
  // بها صار قائماً — أي أن الفرصة تُصنَّف بإدارة ثم لا تُصحَّح إلا بفتح القاعدة يدوياً.
  if ('owner_user_id' in data) {
    const uid = data.owner_user_id || null;
    if (uid) {
      const u = await get('SELECT id, active, deleted_at FROM app_user WHERE id = ?', [uid]);
      if (!u || u.deleted_at || !Number(u.active)) throw badRequest('الحساب المختار لإدارة الفرصة غير موجود أو موقوف');
    }
    patch.owner_user_id = uid;
  }
  if ('sector_id' in data && data.sector_id && String(data.sector_id) !== String(row.sector_id)) {
    patch.sector_id = (await assertDeliverySector(data.sector_id)).id;
  }
  const effSector = patch.sector_id || row.sector_id;
  if ('department_id' in data) {
    patch.department_id = await resolveDepartment(data.department_id || null, effSector);
  } else if (patch.sector_id && row.department_id) {
    // نُقل القطاع وبقيت الإدارة القديمة تحته: لو تُركت لصارت الفرصة محسوبةً في إدارةٍ من قطاعٍ
    // لم تعد فيه — وذلك فرقٌ صامت آخر السنة بين مجموع الإدارات ومجموع القطاع. تُرفَع النسبة،
    // ويُكتب رفعها في الأثر كي يُعاد الإسناد بوعي لا بالمصادفة.
    patch.department_id = null;
  }
  patch.updated_at = nowIso(); patch.updated_by = user.id;
  await update('opportunity', oppId, patch);
  await audit(ctx, { action: 'update', resource: 'opportunity', resourceId: oppId, sectorId: patch.sector_id || row.sector_id, detail: patch });
  // ── الفرصة قد تخرج من نطاق ناقلها بالنقل نفسه ────────────────────────────────
  // «أنا كمدير إدارة مو عارف أنقل الفرصة من إدارة إلى إدارة» — وقد كان النقل **ينجح ويُكتب**
  // ثم تُقرأ الفرصة قراءةً أخيرة لإرجاعها، فتُردّ القراءة لأنها صارت في إدارةٍ ليست له، فتظهر
  // للمالك رسالة «صلاحيتك لا تسمح بهذا الإجراء» على عملٍ تمّ فعلاً. وهو أسوأ من المنع الصريح:
  // يُعيد المحاولة فيُخبَر بالمنع مرة أخرى، ويظنّ الباب مغلقاً وهو مفتوح.
  //
  // والخروج مقصود لا عرَضي: من يدير الفرصة يحقّ له إعادة إسنادها، وبعد الإسناد تصير لغيره —
  // وهو ما قرّرته المنصة أصلاً في نقل القطاع. كان الحارس هنا يغطّي القطاع وحده، والإدارة
  // والمسؤول يخرجان من النطاق بنفس الطريقة تماماً. فالفحص صار على الصفّ **بعد** التعديل أياً
  // كان الحقل الذي حرّكه، ويُعاد تأكيدٌ مختصر بدل قراءةٍ محظورة.
  const after = { ...row, ...patch };
  if (!can(user, 'read', 'opportunity', after)) {
    return {
      ok: true, id: oppId, movedOutOfReach: true,
      sector_id: after.sector_id || null, department_id: after.department_id || null,
    };
  }
  return await getOpportunity(user, oppId);
}

// نقل الفرصة من قطاع إلى قطاع — يتطلب صلاحية تعديل الفرصة في قطاعها الحالي وصلاحية الإنشاء
// في القطاع الهدف (إعادة إسناد فعلية). يُدقَّق ويُسجَّل في سجل المراحل بملاحظة النقل.
export async function moveSector(ctx, oppId, toSectorId, note) {
  const user = ctx.user;
  const row = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!row) throw notFound('الفرصة غير موجودة');
  if (!can(user, 'update', 'opportunity', row)) throw forbidden();
  // الوجهة قطاع تسليم لا وحدة مساندة. الواجهة لا تعرض وحدات المساندة في قائمة النقل، والقرار
  // يُحسم هنا أيضاً لا في الشاشة وحدها: الفرصة المنقولة إلى وحدة مساندة تخرج فوراً من مقارنة
  // القطاعات ومن مستهدف المبيعات ومن تغطية خط الفرص — تختفي من شاشات المالك بلا رسالة تقول لماذا.
  const target = await assertDeliverySector(toSectorId);
  if (String(row.sector_id) === String(toSectorId)) return await getOpportunity(user, oppId);
  // صلاحية النقل = صلاحية تعديل الفرصة في قطاعها الحالي (فُحصت أعلاه): من يديرها يحق له إعادة
  // إسنادها (تسليمها لقطاع آخر) — والفرصة تخرج من نطاقه بعد النقل. النطاق الشركي ينقل أي فرصة.
  const now = nowIso();
  // والإدارة تُرفَع مع النقل: إدارةُ القطاع القديم لا تتبع القطاع الجديد، وبقاؤها يجعل الفرصة
  // محسوبةً في إدارةٍ ليست من قطاعها — فرقٌ صامت آخر السنة بين مجموع الإدارات ومجموع القطاع.
  const deptCleared = row.department_id ? { department_id: null } : {};
  await update('opportunity', oppId, { sector_id: toSectorId, ...deptCleared, updated_at: now, updated_by: user.id });
  await audit(ctx, { action: 'update', resource: 'opportunity', resourceId: oppId, sectorId: toSectorId,
    detail: { moveSector: `${row.sector_id || '—'}→${toSectorId}`, note: note || null,
      ...(row.department_id ? { department_cleared: row.department_id } : {}) } });
  // لا نعيد القراءة عبر getOpportunity: قد تخرج الفرصة من نطاق الناقل بعد النقل فيُرفض قراءته إياها.
  return { ok: true, id: oppId, sector_id: toSectorId, sector_name: target.name_ar, movedFrom: row.sector_id };
}

export async function moveStage(ctx, oppId, toStage, note) {
  const user = ctx.user;
  const row = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!row) throw notFound('الفرصة غير موجودة');
  if (!can(user, 'update', 'opportunity', row)) throw forbidden();
  const stage = await get('SELECT * FROM stage WHERE id = ?', [toStage]);
  if (!stage) throw badRequest('مرحلة غير معروفة');

  // التراجع عن الفوز: كانت الفرصة المكسوبة تُعاد إلى الترشيح بضغطة واحدة بلا قيد ولا أثر —
  // **والمبيعات المعلنة تتغيّر بها**. رقمٌ قرأه المالك أمس يصير غيره اليوم ولا شيء يقول لماذا.
  // فهو ليس تصحيح بيانات بل قرار عمل، ويُعامَل كذلك: سببٌ مكتوب، وأثرٌ معلَن في التدقيق.
  const fromStage = row.stage_id ? await get('SELECT id, is_won FROM stage WHERE id = ?', [row.stage_id]) : null;
  const reversal = !!(fromStage?.is_won) && !stage.is_won;
  if (reversal) {
    // وإن كان الفوز قد أنتج مشروعاً فالتراجع يناقض عملاً قائماً — يُرَدّ ويُدَلّ على المشروع.
    const prj = await get('SELECT id, name_ar FROM project WHERE source_opp_id = ? AND deleted_at IS NULL', [oppId]);
    if (prj) {
      throw badRequest(`لا يمكن التراجع عن فوز هذه الفرصة: نشأ عنها مشروع «${prj.name_ar}». عالِج المشروع أولاً ثم أعد المحاولة.`);
    }
    if (!note || !String(note).trim()) {
      throw badRequest('التراجع عن الفوز يغيّر المبيعات المعلنة — اكتب سبب التراجع قبل الحفظ.');
    }
  }

  const now = nowIso();
  await update('opportunity', oppId, {
    stage_id: toStage, win_pct: stage.default_win_pct, stage_changed_at: now, updated_at: now, updated_by: user.id,
  });
  await insert('opportunity_stage_history', {
    id: id('osh'), opportunity_id: oppId, from_stage_id: row.stage_id, to_stage_id: toStage,
    changed_by: user.id, changed_at: now, note: note || null,
  });
  await audit(ctx, { action: 'update', resource: 'opportunity', resourceId: oppId, sectorId: row.sector_id,
    detail: { stage: `${row.stage_id}→${toStage}`,
      ...(reversal ? { won_reversal: true, value_halalas: row.value_halalas || 0, reason_ar: String(note).trim() } : {}) } });
  return await getOpportunity(user, oppId);
}

// Rich detail for the opportunity page/drawer: names + stage history + the stage ladder
// (with default win %), the opportunity team, the latest activities, and the discipline flags.
export async function opportunityDetail(user, oppId, opts = {}) {
  const opp = await getOpportunity(user, oppId); // scope + redact + notFound/forbidden
  const client = opp.client_id ? ((await get('SELECT name_ar FROM client WHERE id=?', [opp.client_id]))?.name_ar || null) : null;
  const ownerRow = opp.owner_user_id ? await get('SELECT name_ar, username FROM app_user WHERE id=?', [opp.owner_user_id]) : null;
  // الإدارة المسؤولة — كانت تُخزَّن ويُرشَّح بها ولا تُعرَض على صفحة الفرصة إطلاقاً: يفلتر
  // المالك بإدارة فيرى الفرصة، ثم يفتحها فلا يجد فيها ذكراً للإدارة التي أوصلته إليها.
  const department = opp.department_id
    ? ((await get('SELECT name_ar FROM department WHERE id=?', [opp.department_id]))?.name_ar || null) : null;
  const history = await all(`SELECT h.to_stage_id, h.from_stage_id, h.changed_at, h.note, u.name_ar owner_name, u.username
     FROM opportunity_stage_history h LEFT JOIN app_user u ON u.id=h.changed_by
     WHERE h.opportunity_id=? ORDER BY h.changed_at DESC LIMIT 25`, [oppId]);
  const stages = await all('SELECT id, name_ar, color, default_win_pct, sort_order, is_won, is_lost FROM stage ORDER BY sort_order');
  const team = await getTeam(user, oppId);
  const activities = await all(
    `SELECT a.id, a.kind, a.at, a.title, a.detail, a.source,
            COALESCE(a.actor_name, u.name_ar, u.username) AS actor
       FROM crm_activity a LEFT JOIN app_user u ON u.id = a.actor_user_id
      WHERE a.opportunity_id = ? AND a.deleted_at IS NULL
      ORDER BY a.at DESC LIMIT 20`, [oppId]);
  const canEdit = can(user, 'update', 'opportunity', opp);
  const today = String(opts.today || nowIso().slice(0, 10)).slice(0, 10);
  const flags = withDiscipline(opp, today);
  return {
    opp, client, department, owner: ownerRow ? (ownerRow.name_ar || ownerRow.username) : null,
    history, stages, team, activities, canEdit,
    stage_age_days: flags.stage_age_days, rot: flags.rot, no_next_action: flags.no_next_action,
    weighted_halalas: Math.round((opp.value_halalas || 0) * ((opp.win_pct || 0) / 100)),
  };
}

// «فرصي في هذا القطاع» — الفرص المفتوحة التي يصل إليها الشخص داخل قطاع بعينه، جاهزة للعرض
// بأسماء مرحلتها وعميلها. تُبنى على listOpportunities كي يبقى النطاق مصدراً واحداً لا نسخة
// ثانية منه: صاحب نطاق «خاصتي» لا تعود له إلا فرصه هو. ومن لا يملك قراءة الفرص أصلاً لا يعود
// له شيء — الاستشاري يملكها والموظف لا، فالسؤال يُسأل ولا يُفترض.
export async function myOpportunitiesInSector(user, sectorId, opts = {}) {
  if (!sectorId || !can(user, 'read', 'opportunity')) return [];
  const rows = await listOpportunities(user, { sector: sectorId }, opts);
  if (!rows.length) return [];
  const stages = Object.fromEntries((await all('SELECT id, name_ar, color, is_won, is_lost FROM stage'))
    .map((s) => [s.id, s]));
  const clients = Object.fromEntries((await all('SELECT id, name_ar FROM client WHERE deleted_at IS NULL'))
    .map((c) => [c.id, c.name_ar]));
  const open = rows.filter((o) => { const st = stages[o.stage_id]; return !st || (!st.is_won && !st.is_lost); });
  return open.map((o) => ({
    id: o.id, title_ar: o.title_ar, value_halalas: o.value_halalas || 0,
    next_action: o.next_action || null, no_next_action: !!o.no_next_action,
    stage_name: stages[o.stage_id]?.name_ar || null, stage_color: stages[o.stage_id]?.color || null,
    client_name: clients[o.client_id] || null,
  }));
}

// Pipeline aggregation for dashboards (respects scope).
export async function pipelineSummary(user) {
  const f = scopeFilter(user, 'opportunity', 'read');
  const rows = await all(
    `SELECT stage_id, COUNT(*) n, COALESCE(SUM(value_halalas),0) val
     FROM opportunity WHERE ${f.clause} AND deleted_at IS NULL GROUP BY stage_id`, f.params);
  const stages = await all('SELECT * FROM stage ORDER BY sort_order');
  const byStage = Object.fromEntries(rows.map((r) => [r.stage_id, r]));
  return stages.map((s) => ({
    stage: s.id, name_ar: s.name_ar, color: s.color,
    count: byStage[s.id]?.n || 0, value_halalas: byStage[s.id]?.val || 0,
  }));
}
