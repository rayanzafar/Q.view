// ── لوحات الفرص: المراحل والوسوم تُدار من الشاشة ────────────────────────────────────────
//
// «أريد أن يستطيع الفريق تنظيم الفرص دون الرجوع للمطور» (المالك، ٢٠٢٦-٠٩-٠٩). وكانت المرحلة
// صفّاً مبذوراً: تسميةُ عمودٍ تتطلّب ترحيلةً ومطوِّراً ونشرة. هذا الملف هو البابُ الذي يجعلها
// عملَ دقيقة — بحارسٍ واحد (`crm_board`) وسجلِّ تدقيقٍ لكل تغيير.
//
// وثلاث قواعد تحكمه، وهي ما يمنع «الإدارة من الشاشة» أن تصير باباً لكسر المنتج:
//
// ١) **العَلَم لا الاسم.** `is_won`/`is_lost` هما ما تقرؤه التقاريرُ وتوليدُ المشروع من الفوز.
//    فتسميةُ «فائزة» بـ«مغلقة رابحة» لا تكسر شيئاً — وإسقاطُ العَلَم عن آخر مرحلةٍ فائزة يكسر
//    كل شيء، فيُرفض بجملةٍ تقول لماذا. القيدُ على المعنى لا على النص.
//
// ٢) **لا فرصة بلا مرحلة.** حذفُ مرحلةٍ فيها فرص لا يقع إلا بوجهةٍ تُسمّى صراحةً، والنقلُ
//    والحذف معاملةٌ واحدة. فلا صفٌّ يشير إلى مرحلةٍ ذهبت، ولا فرصةٌ تختفي من اللوحة بصمت.
//
// ٣) **المرحلة سير عمل، والوسم تصنيف.** الفرصة في مرحلةٍ واحدة (عمودٌ على `opportunity`)
//    فلا تتكرّر في لوحتين، وتحمل وسوماً كثيرة (جدول علاقة). ومن أراد تصنيفاً وسَمَ، ومن أراد
//    خطوةَ بيعٍ أنشأ مرحلة — وهو الفصلُ الذي طلبه المالك نصّاً.
import { all, get, run, tx, insert, update } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { id as newId, nowIso } from '../../core/util/ids.js';

const DEFAULT_BOARD = 'BOARD_SALES';
// لونٌ يُقرأ: ستّ خاناتٍ ست عشرية. نرفض ما عداه بدل حفظ نصٍّ يخرج على الشاشة لوناً معطوباً.
const HEX = /^#[0-9a-fA-F]{6}$/;

const readsBoards = (user) => can(user, 'read', 'crm_board') || can(user, 'read', 'opportunity');
function assertManages(user, what) {
  if (!can(user, 'update', 'crm_board')) {
    throw forbidden(`${what} يتطلّب صلاحية إدارة لوحات الفرص — يملكها فريق تطوير الأعمال ورئيسه ومدير النظام.`);
  }
}
const text = (v, label, { max = 120, required = false, min = 1 } = {}) => {
  const s = v == null ? '' : String(v).trim();
  if (!s) { if (required) throw badRequest(`${label} مطلوب`); return null; }
  if (s.length < min) throw badRequest(`${label} ${min} أحرف فأكثر`);
  return s.slice(0, max);
};
function colorOf(v, { required = false } = {}) {
  const s = text(v, 'اللون', { max: 7 });
  if (!s) { if (required) throw badRequest('اختر لوناً للمرحلة'); return null; }
  if (!HEX.test(s)) throw badRequest('اللون يُكتب بصيغة ست عشرية من ستّ خانات — مثل ‎#2563eb');
  return s.toLowerCase();
}
function pctOf(v) {
  if (v == null || v === '') return null;   // فراغٌ مقصود: «لا تفرض نسبة» — لا صفر
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw badRequest('احتمال الفوز من ٠ إلى ١٠٠، أو اتركه فارغاً كي لا تُفرض نسبة');
  return n;
}

// ── القراءة ─────────────────────────────────────────────────────────────────────────────
/** اللوحات الحيّة ومراحلُها وعددُ فرص كل مرحلة — مصدرُ الشاشة والإدارة معاً. */
export async function listBoards(user, { includeArchived = false } = {}) {
  if (!readsBoards(user)) throw forbidden('قراءة لوحات الفرص تتطلّب صلاحية على الفرص.');
  const boards = await all(
    `SELECT id, name_ar, description_ar, is_default, sort_order, archived_at
       FROM crm_board WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND archived_at IS NULL'}
      ORDER BY sort_order, name_ar`);
  const stages = await all(
    `SELECT s.id, s.name_ar, s.description_ar, s.color, s.default_win_pct, s.sort_order,
            s.is_won, s.is_lost, s.archived_at, COALESCE(s.board_id, ?) AS board_id,
            (SELECT COUNT(*) FROM opportunity o WHERE o.stage_id = s.id AND o.deleted_at IS NULL) AS opp_count
       FROM stage s WHERE s.deleted_at IS NULL ${includeArchived ? '' : 'AND s.archived_at IS NULL'}
      ORDER BY s.sort_order, s.id`, [DEFAULT_BOARD]);
  return {
    boards: boards.map((b) => ({ ...b, is_default: !!Number(b.is_default), stages: stages.filter((s) => s.board_id === b.id) })),
    // مرحلةٌ تشير إلى لوحةٍ مؤرشفة أو محذوفة لا تُبتلع: تُعرض صراحةً كي تُنقل أو تُؤرشف بوعي.
    orphan_stages: stages.filter((s) => !boards.some((b) => b.id === s.board_id)),
    can_manage: can(user, 'update', 'crm_board'),
  };
}

/** الوسوم الحيّة وعددُ الفرص على كلٍّ — للفلاتر والتقارير كما للإدارة. */
export async function listTags(user, { includeArchived = false } = {}) {
  if (!readsBoards(user)) throw forbidden('قراءة تصنيفات الفرص تتطلّب صلاحية على الفرص.');
  return await all(
    `SELECT t.id, t.name_ar, t.color, t.description_ar, t.sort_order, t.archived_at,
            (SELECT COUNT(*) FROM opportunity_tag ot JOIN opportunity o ON o.id = ot.opportunity_id
              WHERE ot.tag_id = t.id AND o.deleted_at IS NULL) AS opp_count
       FROM crm_tag t WHERE t.deleted_at IS NULL ${includeArchived ? '' : 'AND t.archived_at IS NULL'}
      ORDER BY t.sort_order, t.name_ar`);
}

// ── اللوحات ─────────────────────────────────────────────────────────────────────────────
export async function createBoard(ctx, data = {}) {
  assertManages(ctx.user, 'إنشاء لوحة');
  const name = text(data.name_ar, 'اسم اللوحة', { required: true, min: 2, max: 80 });
  const row = {
    id: newId('brd'), name_ar: name,
    description_ar: text(data.description_ar, 'وصف اللوحة', { max: 400 }),
    is_default: 0, sort_order: Number(data.sort_order) || 99,
    created_at: nowIso(), created_by: ctx.user.id,
  };
  await tx(async () => {
    await insert('crm_board', row);
    await audit(ctx, { action: 'create', resource: 'crm_board', resourceId: row.id, detail: `إنشاء لوحة «${name}»` });
  });
  return { ok: true, id: row.id, name_ar: name };
}

export async function updateBoard(ctx, boardId, data = {}) {
  assertManages(ctx.user, 'تعديل لوحة');
  const row = await get('SELECT * FROM crm_board WHERE id = ? AND deleted_at IS NULL', [boardId]);
  if (!row) throw notFound('اللوحة غير موجودة');
  const patch = {};
  if (data.name_ar !== undefined) patch.name_ar = text(data.name_ar, 'اسم اللوحة', { required: true, min: 2, max: 80 });
  if (data.description_ar !== undefined) patch.description_ar = text(data.description_ar, 'وصف اللوحة', { max: 400 });
  if (data.sort_order !== undefined) patch.sort_order = Number(data.sort_order) || 0;
  if (data.archived !== undefined) {
    const arch = !!data.archived;
    // اللوحة الافتراضية مستقرُّ كل فرصةٍ بلا لوحة — أرشفتُها تُخفي مسار الشركة كلَّه.
    if (arch && Number(row.is_default)) throw badRequest('اللوحة الافتراضية لا تُؤرشف — اجعل لوحةً أخرى افتراضيةً أولاً.');
    patch.archived_at = arch ? nowIso() : null;
  }
  if (!Object.keys(patch).length) return { ok: true, unchanged: true };
  patch.updated_at = nowIso(); patch.updated_by = ctx.user.id;
  await tx(async () => {
    await update('crm_board', boardId, patch);
    await audit(ctx, { action: 'update', resource: 'crm_board', resourceId: boardId, detail: { board: row.name_ar, ...patch } });
  });
  return { ok: true, id: boardId };
}

export async function deleteBoard(ctx, boardId, { moveStagesTo = null } = {}) {
  assertManages(ctx.user, 'حذف لوحة');
  const row = await get('SELECT * FROM crm_board WHERE id = ? AND deleted_at IS NULL', [boardId]);
  if (!row) throw notFound('اللوحة غير موجودة');
  if (Number(row.is_default)) throw badRequest('اللوحة الافتراضية لا تُحذف — إليها ترجع كل فرصةٍ بلا لوحة.');
  const stages = await all('SELECT id, name_ar FROM stage WHERE board_id = ? AND deleted_at IS NULL', [boardId]);
  if (stages.length && !moveStagesTo) {
    throw badRequest(`اللوحة «${row.name_ar}» فيها ${stages.length} مرحلة — اختر اللوحة التي تنتقل إليها قبل الحذف، `
      + 'فلا تُترك مرحلةٌ بلا لوحة.');
  }
  if (moveStagesTo) {
    const dest = await get('SELECT id FROM crm_board WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL', [moveStagesTo]);
    if (!dest) throw badRequest('اللوحة الوجهة غير موجودة أو مؤرشفة — اختر لوحةً حيّة.');
    if (String(moveStagesTo) === String(boardId)) throw badRequest('اختر لوحةً غير التي تحذفها.');
  }
  const stamp = nowIso();
  await tx(async () => {
    if (stages.length) await run('UPDATE stage SET board_id = ?, updated_at = ?, updated_by = ? WHERE board_id = ?',
      [moveStagesTo, stamp, ctx.user.id, boardId]);
    await run('UPDATE crm_board SET deleted_at = ? WHERE id = ?', [stamp, boardId]);
    await audit(ctx, { action: 'delete', resource: 'crm_board', resourceId: boardId,
      detail: `حذف لوحة «${row.name_ar}»${stages.length ? ` ونقل ${stages.length} مرحلة إلى لوحة أخرى` : ''}` });
  });
  return { ok: true, id: boardId, movedStages: stages.length };
}

// ── المراحل ─────────────────────────────────────────────────────────────────────────────
async function assertFlagRoom(boardId, { is_won, is_lost }, exceptStageId = null) {
  // مرحلةٌ فائزة واحدة على الأكثر لكل لوحة، وأخرى خاسرة: تعدّدُها يجعل «أيّ فوزٍ يولّد المشروع»
  // سؤالاً بلا جواب، ويضاعف الحسم في التقارير.
  for (const [flag, on, ar] of [['is_won', is_won, 'فائزة'], ['is_lost', is_lost, 'خاسرة']]) {
    if (!on) continue;
    const clash = await get(
      `SELECT id, name_ar FROM stage WHERE COALESCE(board_id, ?) = ? AND ${flag} = 1
         AND deleted_at IS NULL ${exceptStageId ? 'AND id <> ?' : ''}`,
      exceptStageId ? [DEFAULT_BOARD, boardId, exceptStageId] : [DEFAULT_BOARD, boardId]);
    if (clash) throw badRequest(`اللوحة فيها مرحلة ${ar} بالفعل هي «${clash.name_ar}» — `
      + `أزل الصفة عنها أولاً، فمرحلةٌ ${ar} واحدة لكل لوحة كي يبقى الحسم رقماً واحداً.`);
  }
}

/** آخرُ مرحلةٍ تحمل عَلَماً تشغيلياً لا تفقده: التقاريرُ وتوليدُ المشروع مبنيّان عليه. */
async function assertNotLastFlag(stage, { clearingWon = false, clearingLost = false } = {}) {
  for (const [flag, clearing, ar, why] of [
    ['is_won', clearingWon, 'فائزة', 'وعليها يقوم توليدُ المشروع من الفرصة الفائزة وحسابُ المبيعات'],
    ['is_lost', clearingLost, 'خاسرة', 'وعليها يقوم حسابُ الفرص المحسومة في التقارير'],
  ]) {
    if (!clearing || !Number(stage[flag])) continue;
    const others = await get(`SELECT COUNT(*) n FROM stage WHERE ${flag} = 1 AND deleted_at IS NULL AND id <> ?`, [stage.id]);
    if (!Number(others?.n)) {
      throw badRequest(`«${stage.name_ar}» هي المرحلة ال${ar} الوحيدة في المنصة ${why}. `
        + `عيّن مرحلةً ${ar} أخرى أولاً، ثم أزل الصفة عن هذه.`);
    }
  }
}

export async function createStage(ctx, data = {}) {
  assertManages(ctx.user, 'إنشاء مرحلة');
  const name = text(data.name_ar, 'اسم المرحلة', { required: true, min: 2, max: 60 });
  const boardId = text(data.board_id, 'اللوحة', { max: 80 }) || DEFAULT_BOARD;
  const board = await get('SELECT id FROM crm_board WHERE id = ? AND deleted_at IS NULL', [boardId]);
  if (!board) throw badRequest('اللوحة المختارة غير موجودة');
  const isWon = !!data.is_won, isLost = !!data.is_lost;
  if (isWon && isLost) throw badRequest('المرحلة إما فائزة وإما خاسرة — لا الاثنتان معاً.');
  await assertFlagRoom(boardId, { is_won: isWon, is_lost: isLost });
  const last = await get('SELECT MAX(sort_order) m FROM stage WHERE COALESCE(board_id, ?) = ?', [DEFAULT_BOARD, boardId]);
  const row = {
    id: text(data.id, 'معرّف المرحلة', { max: 40 })?.toUpperCase().replace(/[^A-Z0-9_]/g, '_') || newId('stg').toUpperCase(),
    name_ar: name, description_ar: text(data.description_ar, 'وصف المرحلة', { max: 400 }),
    color: colorOf(data.color) || '#64748b',
    default_win_pct: pctOf(data.default_win_pct),
    sort_order: data.sort_order != null ? Number(data.sort_order) : Number(last?.m || 0) + 1,
    is_won: isWon ? 1 : 0, is_lost: isLost ? 1 : 0, board_id: boardId,
    created_at: nowIso(), created_by: ctx.user.id,
  };
  if (await get('SELECT id FROM stage WHERE id = ?', [row.id])) throw badRequest('يوجد مرحلة بهذا المعرّف — اختر اسماً آخر.');
  await tx(async () => {
    await insert('stage', row);
    await audit(ctx, { action: 'create', resource: 'crm_board', resourceId: row.id,
      detail: `إنشاء مرحلة «${name}» في اللوحة ${boardId}${isWon ? ' (فائزة)' : isLost ? ' (خاسرة)' : ''}` });
  });
  return { ok: true, id: row.id, name_ar: name };
}

export async function updateStage(ctx, stageId, data = {}) {
  assertManages(ctx.user, 'تعديل مرحلة');
  const row = await get('SELECT * FROM stage WHERE id = ? AND deleted_at IS NULL', [stageId]);
  if (!row) throw notFound('المرحلة غير موجودة');
  const patch = {};
  if (data.name_ar !== undefined) patch.name_ar = text(data.name_ar, 'اسم المرحلة', { required: true, min: 2, max: 60 });
  if (data.description_ar !== undefined) patch.description_ar = text(data.description_ar, 'وصف المرحلة', { max: 400 });
  if (data.color !== undefined) patch.color = colorOf(data.color);
  if (data.default_win_pct !== undefined) patch.default_win_pct = pctOf(data.default_win_pct);
  if (data.sort_order !== undefined) patch.sort_order = Number(data.sort_order) || 0;
  if (data.board_id !== undefined && String(data.board_id) !== String(row.board_id || DEFAULT_BOARD)) {
    const b = await get('SELECT id FROM crm_board WHERE id = ? AND deleted_at IS NULL', [data.board_id]);
    if (!b) throw badRequest('اللوحة المختارة غير موجودة');
    patch.board_id = data.board_id;
  }
  const nextBoard = patch.board_id || row.board_id || DEFAULT_BOARD;
  if (data.is_won !== undefined || data.is_lost !== undefined) {
    const isWon = data.is_won !== undefined ? !!data.is_won : !!Number(row.is_won);
    const isLost = data.is_lost !== undefined ? !!data.is_lost : !!Number(row.is_lost);
    if (isWon && isLost) throw badRequest('المرحلة إما فائزة وإما خاسرة — لا الاثنتان معاً.');
    await assertNotLastFlag(row, { clearingWon: !isWon, clearingLost: !isLost });
    await assertFlagRoom(nextBoard, { is_won: isWon, is_lost: isLost }, stageId);
    patch.is_won = isWon ? 1 : 0; patch.is_lost = isLost ? 1 : 0;
  }
  if (data.archived !== undefined) {
    const arch = !!data.archived;
    if (arch) {
      await assertNotLastFlag(row, { clearingWon: !!Number(row.is_won), clearingLost: !!Number(row.is_lost) });
      const live = await get('SELECT COUNT(*) n FROM stage WHERE COALESCE(board_id, ?) = ? AND deleted_at IS NULL AND archived_at IS NULL AND id <> ?',
        [DEFAULT_BOARD, nextBoard, stageId]);
      if (!Number(live?.n)) throw badRequest('هذه آخر مرحلة حيّة في اللوحة — أنشئ غيرها قبل أرشفتها، فلوحةٌ بلا مراحل لا تعرض شيئاً.');
      const held = await get('SELECT COUNT(*) n FROM opportunity WHERE stage_id = ? AND deleted_at IS NULL', [stageId]);
      if (Number(held?.n)) throw badRequest(`«${row.name_ar}» فيها ${Number(held.n)} فرصة — انقلها أولاً، `
        + 'فالأرشفة تُخفي العمود وتترك فرصه بلا مكانٍ يُرى فيه.');
    }
    patch.archived_at = arch ? nowIso() : null;
  }
  if (!Object.keys(patch).length) return { ok: true, unchanged: true };
  patch.updated_at = nowIso(); patch.updated_by = ctx.user.id;
  await tx(async () => {
    await update('stage', stageId, patch);
    await audit(ctx, { action: 'update', resource: 'crm_board', resourceId: stageId,
      detail: { stage: row.name_ar, ...patch } });
  });
  return { ok: true, id: stageId };
}

/** ترتيبُ الأعمدة بالسحب والإفلات: قائمةٌ واحدة تُكتب دفعةً — لا نداءٌ لكل عمود. */
export async function reorderStages(ctx, order = []) {
  assertManages(ctx.user, 'ترتيب المراحل');
  const ids = (Array.isArray(order) ? order : []).map((x) => String(x)).filter(Boolean);
  if (!ids.length) throw badRequest('أرسل ترتيب المراحل');
  const rows = await all(`SELECT id FROM stage WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, ids);
  if (rows.length !== ids.length) throw badRequest('في الترتيب مرحلةٌ غير موجودة — أعد تحميل اللوحة ثم رتّبها.');
  const stamp = nowIso();
  await tx(async () => {
    for (let i = 0; i < ids.length; i++) {
      await run('UPDATE stage SET sort_order = ?, updated_at = ?, updated_by = ? WHERE id = ?', [i + 1, stamp, ctx.user.id, ids[i]]);
    }
    await audit(ctx, { action: 'update', resource: 'crm_board', resourceId: 'order', detail: `ترتيب ${ids.length} مرحلة` });
  });
  return { ok: true, count: ids.length };
}

/** حذفُ مرحلة: لا يقع إلا بوجهةٍ لفرصها. النقلُ والحذف معاملةٌ واحدة. */
export async function deleteStage(ctx, stageId, { moveToStageId = null } = {}) {
  assertManages(ctx.user, 'حذف مرحلة');
  const row = await get('SELECT * FROM stage WHERE id = ? AND deleted_at IS NULL', [stageId]);
  if (!row) throw notFound('المرحلة غير موجودة');
  await assertNotLastFlag(row, { clearingWon: !!Number(row.is_won), clearingLost: !!Number(row.is_lost) });
  const boardId = row.board_id || DEFAULT_BOARD;
  const live = await get('SELECT COUNT(*) n FROM stage WHERE COALESCE(board_id, ?) = ? AND deleted_at IS NULL AND id <> ?',
    [DEFAULT_BOARD, boardId, stageId]);
  if (!Number(live?.n)) throw badRequest('هذه آخر مرحلة في اللوحة — لا تُحذف، فاللوحة بلا مراحل لا تستقبل فرصة.');
  const held = await get('SELECT COUNT(*) n FROM opportunity WHERE stage_id = ? AND deleted_at IS NULL', [stageId]);
  const count = Number(held?.n || 0);
  let dest = null;
  if (count) {
    if (!moveToStageId) {
      throw badRequest(`«${row.name_ar}» فيها ${count} فرصة — حدّد المرحلة التي تنتقل إليها قبل الحذف. `
        + 'لا تُحذف مرحلةٌ وتُترك فرصُها بلا موضع.');
    }
    dest = await get('SELECT id, name_ar FROM stage WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL', [moveToStageId]);
    if (!dest) throw badRequest('المرحلة الوجهة غير موجودة أو مؤرشفة — اختر مرحلةً حيّة.');
    if (String(moveToStageId) === String(stageId)) throw badRequest('اختر مرحلةً غير التي تحذفها.');
  }
  const stamp = nowIso();
  await tx(async () => {
    if (count) {
      // الفرصُ تنتقل بختمِ مرحلةٍ جديد كي يبقى «عمرُ الفرصة في مرحلتها» صادقاً بعد النقل.
      await run('UPDATE opportunity SET stage_id = ?, stage_changed_at = ?, updated_at = ?, updated_by = ? WHERE stage_id = ? AND deleted_at IS NULL',
        [moveToStageId, stamp, stamp, ctx.user.id, stageId]);
    }
    await run('UPDATE stage SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?', [stamp, stamp, ctx.user.id, stageId]);
    await audit(ctx, { action: 'delete', resource: 'crm_board', resourceId: stageId,
      detail: `حذف مرحلة «${row.name_ar}»${count ? ` ونقل ${count} فرصة إلى «${dest.name_ar}»` : ' (كانت فارغة)'}` });
  });
  return { ok: true, id: stageId, moved: count, movedTo: moveToStageId || null };
}

// ── الوسوم ──────────────────────────────────────────────────────────────────────────────
export async function createTag(ctx, data = {}) {
  assertManages(ctx.user, 'إنشاء تصنيف');
  const name = text(data.name_ar, 'اسم التصنيف', { required: true, min: 2, max: 60 });
  const clash = await get('SELECT id FROM crm_tag WHERE lower(trim(name_ar)) = lower(?) AND deleted_at IS NULL', [name]);
  if (clash) throw badRequest('يوجد تصنيف بهذا الاسم — استعمله بدل تكراره.');
  const row = {
    id: newId('tag'), name_ar: name, color: colorOf(data.color) || '#64748b',
    description_ar: text(data.description_ar, 'وصف التصنيف', { max: 400 }),
    sort_order: Number(data.sort_order) || 99, created_at: nowIso(), created_by: ctx.user.id,
  };
  await tx(async () => {
    await insert('crm_tag', row);
    await audit(ctx, { action: 'create', resource: 'crm_board', resourceId: row.id, detail: `إنشاء تصنيف «${name}»` });
  });
  return { ok: true, id: row.id, name_ar: name };
}

export async function updateTag(ctx, tagId, data = {}) {
  assertManages(ctx.user, 'تعديل تصنيف');
  const row = await get('SELECT * FROM crm_tag WHERE id = ? AND deleted_at IS NULL', [tagId]);
  if (!row) throw notFound('التصنيف غير موجود');
  const patch = {};
  if (data.name_ar !== undefined) patch.name_ar = text(data.name_ar, 'اسم التصنيف', { required: true, min: 2, max: 60 });
  if (data.color !== undefined) patch.color = colorOf(data.color);
  if (data.description_ar !== undefined) patch.description_ar = text(data.description_ar, 'وصف التصنيف', { max: 400 });
  if (data.sort_order !== undefined) patch.sort_order = Number(data.sort_order) || 0;
  if (data.archived !== undefined) patch.archived_at = data.archived ? nowIso() : null;
  if (!Object.keys(patch).length) return { ok: true, unchanged: true };
  patch.updated_at = nowIso(); patch.updated_by = ctx.user.id;
  await tx(async () => {
    await update('crm_tag', tagId, patch);
    await audit(ctx, { action: 'update', resource: 'crm_board', resourceId: tagId, detail: { tag: row.name_ar, ...patch } });
  });
  return { ok: true, id: tagId };
}

export async function deleteTag(ctx, tagId) {
  assertManages(ctx.user, 'حذف تصنيف');
  const row = await get('SELECT * FROM crm_tag WHERE id = ? AND deleted_at IS NULL', [tagId]);
  if (!row) throw notFound('التصنيف غير موجود');
  const stamp = nowIso();
  await tx(async () => {
    // الوسمُ تصنيفٌ لا موضع: نزعُه عن الفرص لا يفقدها شيئاً، بخلاف المرحلة.
    const r = await run('DELETE FROM opportunity_tag WHERE tag_id = ?', [tagId]);
    await run('UPDATE crm_tag SET deleted_at = ? WHERE id = ?', [stamp, tagId]);
    await audit(ctx, { action: 'delete', resource: 'crm_board', resourceId: tagId,
      detail: `حذف تصنيف «${row.name_ar}» ونزعُه عن ${Number(r.changes || 0)} فرصة` });
  });
  return { ok: true, id: tagId };
}

/** وسومُ فرصةٍ بعينها — تُكتب دفعةً واحدة (المجموعةُ النهائية لا فرقٌ تدريجي). */
export async function setOpportunityTags(ctx, oppId, tagIds = []) {
  const opp = await get('SELECT id, title_ar, sector_id FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!opp) throw notFound('الفرصة غير موجودة');
  if (!can(ctx.user, 'update', 'opportunity', opp)) throw forbidden('تصنيفُ الفرصة يتطلّب صلاحية تعديلها.');
  const ids = [...new Set((Array.isArray(tagIds) ? tagIds : []).map((x) => String(x)).filter(Boolean))];
  if (ids.length) {
    const live = await all(`SELECT id FROM crm_tag WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, ids);
    if (live.length !== ids.length) throw badRequest('في القائمة تصنيفٌ غير موجود — أعد تحميل الصفحة ثم اختر.');
  }
  const stamp = nowIso();
  await tx(async () => {
    await run('DELETE FROM opportunity_tag WHERE opportunity_id = ?', [oppId]);
    for (const t of ids) {
      await run('INSERT INTO opportunity_tag (opportunity_id, tag_id, created_at, created_by) VALUES (?,?,?,?) ON CONFLICT DO NOTHING',
        [oppId, t, stamp, ctx.user.id]);
    }
    await audit(ctx, { action: 'update', resource: 'opportunity', resourceId: oppId, sectorId: opp.sector_id || null,
      detail: `تصنيفات الفرصة «${opp.title_ar}»: ${ids.length ? ids.length + ' تصنيفاً' : 'بلا تصنيف'}` });
  });
  return { ok: true, id: oppId, tags: ids.length };
}
