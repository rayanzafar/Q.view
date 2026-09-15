// ── إعدادات لوحة الفرص: الأعمدة والتصنيفات تُدار من الشاشة ────────────────────────────────
//
// «أريد أن يستطيع الفريق تنظيم الفرص دون الرجوع للمطور» (المالك، ٢٠٢٦-٠٩-٠٩). الخدمة تحت هذه
// الشاشة (`modules/crm/boards.js`) تحرس ثلاث قواعد، وواجبُ الشاشة أن تجعلها **مرئية** لا أن
// تكتفي بأن يصطدم بها المستخدم بعد الضغط:
//
//   ١) العَلَم لا الاسم: تسمية العمود شيء، وصفتُه («تُحتسب فوزاً») شيء آخر — والتقاريرُ وتوليدُ
//      المشروع يقرآن الصفة. فالصفة تُعرض على كل مرحلة، وتُحرَّر حقلاً مستقلاً في النموذج.
//   ٢) الأرشفة إخفاء لا حذف: تُقال بهذا اللفظ في الزر وفي شرحه، كي لا يُظنّ أنها تمحو تاريخاً.
//   ٣) لا فرصة بلا مرحلة: حذفُ مرحلةٍ فيها فرص يطلب الوجهة **في النموذج نفسه**، ولو خالف أحدٌ
//      ذلك فرسالةُ الخادم تُعرض بنصّها كاملاً — لا تُبتلع ولا تُستبدل بجملة عامة.
//
// كل نموذج مبنيٌّ على الخادم داخل <template> خاملة ومهروبةِ النصوص، ويفتحه الزرّ بالتفويض
// (`data-action`) — فلا وسمٌ يُركَّب في المتصفح من نصٍّ كتبه مستخدم.
import { layout, pill } from '../layout.js';
import { esc } from './_shared.js';
import { icon } from '../icons.js';
import { config } from '../../core/config.js';
import { listBoards, listTags } from '../../modules/crm/boards.js';

const FALLBACK_COLOR = '#64748b';
const colorOf = (c) => (/^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? String(c) : FALLBACK_COLOR);
const swatch = (c) => `<span class="cbs-sw" style="background:${esc(colorOf(c))}" aria-hidden="true"></span>`;
const num = (v) => `<span class="tnum">${esc(String(v))}</span>`;
const tpl = (id, inner) => `<template id="tpl-${esc(id)}">${inner}</template>`;
const isOn = (v) => Number(v) === 1;

const modalHead = (title) => `<div class="modal-head">
  <div style="font-weight:800;font-size:15px">${title}</div>
  <button type="button" class="btn btn-ghost btn-sm" data-action="cbs-close" aria-label="إغلاق النافذة">✕</button></div>`;

const field = (label, control, hint = '') => `<div class="field">
  <label>${label}</label>${control}${hint ? `<div class="cbs-hint">${hint}</div>` : ''}</div>`;

const errBox = '<div class="alert err cbs-err" data-role="err" hidden></div>';

const foot = (saveLabel) => `<div class="modal-foot">
  <button type="submit" class="btn btn-primary" data-role="save">${saveLabel}</button>
  <button type="button" class="btn" data-action="cbs-close">تراجع</button></div>`;

// ── نموذج المرحلة (إنشاء وتعديل بالشكل نفسه) ──────────────────────────────────────────────
function stageForm({ boards, boardId, stage = null }) {
  const s = stage || {};
  const outcome = isOn(s.is_won) ? 'won' : isOn(s.is_lost) ? 'lost' : '';
  const pctValue = s.default_win_pct == null ? '' : String(Number(s.default_win_pct));
  const boardOptions = boards.map((b) => `<option value="${esc(b.id)}"${String(b.id) === String(boardId) ? ' selected' : ''}>${esc(b.name_ar)}</option>`).join('');
  return `<form class="cbs-modal-form" data-form="stage"${stage ? ` data-id="${esc(s.id)}"` : ''}>
    ${modalHead(stage ? `تعديل مرحلة «${esc(s.name_ar)}»` : 'مرحلة جديدة')}
    <div class="modal-body">
      ${errBox}
      ${field('اسم المرحلة', `<input class="input" name="name_ar" type="text" required minlength="2" maxlength="60" value="${esc(s.name_ar || '')}" placeholder="مثال: عرض مقدَّم">`,
    'الاسم للقراءة على الشاشة — تغييره لا يغيّر شيئاً في الحساب.')}
      ${field('وصف المرحلة', `<textarea class="input" name="description_ar" rows="2" maxlength="400" placeholder="متى تُنقل الفرصة إلى هنا؟">${esc(s.description_ar || '')}</textarea>`,
    'سطرٌ يقرؤه من يحرّك الفرصة، فيعرف متى تستحق هذا العمود.')}
      <div class="grid2">
        ${field('لون العمود', `<input class="cbs-color" name="color" type="color" value="${esc(colorOf(s.color))}" aria-label="لون العمود">`,
    'اللون تمييزٌ بصري لا معنى في الحساب.')}
        ${field('احتمال الفوز الافتراضي', `<input class="input tnum" name="default_win_pct" type="number" min="0" max="100" step="1" inputmode="numeric" value="${esc(pctValue)}" placeholder="اتركه فارغاً">`,
    'الفراغ يعني «لا تُفرض نسبة» — وليس صفراً. الصفر يعني أن الفوز مستبعد.')}
      </div>
      ${field('اللوحة', `<select class="input" name="board_id" required>${boardOptions}</select>`,
    'المرحلة عمودٌ في لوحةٍ واحدة، والفرصة تقف في مرحلةٍ واحدة.')}
      ${field('صفة الحسم', `<select class="input" name="outcome">
        <option value=""${outcome === '' ? ' selected' : ''}>بلا حسم — مرحلة في الطريق</option>
        <option value="won"${outcome === 'won' ? ' selected' : ''}>تُحتسب فوزاً</option>
        <option value="lost"${outcome === 'lost' ? ' selected' : ''}>تُحتسب خسارة</option>
      </select>`,
    'هذه الصفة — لا الاسم — هي ما تقرؤه التقارير وما يولّد المشروع من الفرصة الفائزة. ولكل لوحة مرحلة فوز واحدة ومرحلة خسارة واحدة على الأكثر.')}
    </div>
    ${foot(stage ? 'حفظ المرحلة' : 'إضافة المرحلة')}
  </form>`;
}

// ── نموذج اللوحة ──────────────────────────────────────────────────────────────────────────
function boardForm(board = null) {
  const b = board || {};
  return `<form class="cbs-modal-form" data-form="board"${board ? ` data-id="${esc(b.id)}"` : ''}>
    ${modalHead(board ? `تعديل لوحة «${esc(b.name_ar)}»` : 'لوحة جديدة')}
    <div class="modal-body">
      ${errBox}
      ${field('اسم اللوحة', `<input class="input" name="name_ar" type="text" required minlength="2" maxlength="80" value="${esc(b.name_ar || '')}" placeholder="مثال: مسار الشراكات">`,
    'اللوحة مسارُ بيعٍ كامل، ومراحلها أعمدته.')}
      ${field('وصف اللوحة', `<textarea class="input" name="description_ar" rows="2" maxlength="400" placeholder="أي فرصٍ تسلك هذا المسار؟">${esc(b.description_ar || '')}</textarea>`)}
    </div>
    ${foot(board ? 'حفظ اللوحة' : 'إضافة اللوحة')}
  </form>`;
}

// ── نموذج التصنيف ─────────────────────────────────────────────────────────────────────────
function tagForm(tag = null) {
  const t = tag || {};
  return `<form class="cbs-modal-form" data-form="tag"${tag ? ` data-id="${esc(t.id)}"` : ''}>
    ${modalHead(tag ? `تعديل تصنيف «${esc(t.name_ar)}»` : 'تصنيف جديد')}
    <div class="modal-body">
      ${errBox}
      ${field('اسم التصنيف', `<input class="input" name="name_ar" type="text" required minlength="2" maxlength="60" value="${esc(t.name_ar || '')}" placeholder="مثال: قطاع حكومي">`,
    'التصنيف صفةٌ للفرصة، والفرصة تحمل تصنيفاتٍ كثيرة في وقتٍ واحد.')}
      ${field('اللون', `<input class="cbs-color" name="color" type="color" value="${esc(colorOf(t.color))}" aria-label="لون التصنيف">`)}
      ${field('الوصف', `<textarea class="input" name="description_ar" rows="2" maxlength="400" placeholder="متى يوضع هذا التصنيف؟">${esc(t.description_ar || '')}</textarea>`)}
    </div>
    ${foot(tag ? 'حفظ التصنيف' : 'إضافة التصنيف')}
  </form>`;
}

// ── نموذج حذف المرحلة: الوجهة تُطلب قبل الحذف لا بعده ─────────────────────────────────────
function stageDeleteForm(stage, liveStages) {
  const held = Number(stage.opp_count || 0);
  const options = liveStages.filter((x) => x.id !== stage.id)
    .map((x) => `<option value="${esc(x.id)}">${esc(x.name_ar)}${x.board_name ? ` — ${esc(x.board_name)}` : ''}</option>`).join('');
  const body = held
    ? `<div class="alert warn">على هذه المرحلة ${num(held)} فرصة. اختر المرحلة التي تنتقل إليها — النقل والحذف يقعان معاً، فلا تبقى فرصةٌ بلا موضع.</div>
       ${options
    ? field('المرحلة التي تنتقل إليها الفرص', `<select class="input" name="moveToStageId" required><option value="">اختر المرحلة</option>${options}</select>`)
    : '<div class="alert err">لا توجد مرحلة حيّة أخرى تستقبل هذه الفرص — أنشئ مرحلةً أولاً ثم أعد المحاولة.</div>'}`
    : `<div class="alert info">لا توجد فرص على هذه المرحلة، فحذفها لا ينقل شيئاً. وتبقى الفرص التي مرّت بها محفوظةً في سجلّها.</div>`;
  return `<form class="cbs-modal-form" data-form="stage-delete" data-id="${esc(stage.id)}">
    ${modalHead(`حذف مرحلة «${esc(stage.name_ar)}»`)}
    <div class="modal-body">${errBox}${body}</div>
    <div class="modal-foot">
      <button type="submit" class="btn btn-danger" data-role="save"${held && !options ? ' disabled' : ''}>حذف المرحلة</button>
      <button type="button" class="btn" data-action="cbs-close">تراجع</button></div>
  </form>`;
}

// ── نموذج حذف اللوحة: مراحلها تنتقل إلى لوحةٍ حيّة ────────────────────────────────────────
function boardDeleteForm(board, otherBoards) {
  const stages = board.stages.length;
  const options = otherBoards.map((b) => `<option value="${esc(b.id)}">${esc(b.name_ar)}</option>`).join('');
  const body = stages
    ? `<div class="alert warn">في هذه اللوحة ${num(stages)} مرحلة. اختر اللوحة التي تنتقل إليها قبل الحذف، فلا تُترك مرحلةٌ بلا لوحة.</div>
       ${options
    ? field('اللوحة التي تنتقل إليها المراحل', `<select class="input" name="moveStagesTo" required><option value="">اختر اللوحة</option>${options}</select>`)
    : '<div class="alert err">لا توجد لوحة حيّة أخرى تستقبل هذه المراحل — أنشئ لوحةً أولاً ثم أعد المحاولة.</div>'}`
    : '<div class="alert info">هذه اللوحة بلا مراحل، فحذفها لا ينقل شيئاً.</div>';
  return `<form class="cbs-modal-form" data-form="board-delete" data-id="${esc(board.id)}">
    ${modalHead(`حذف لوحة «${esc(board.name_ar)}»`)}
    <div class="modal-body">${errBox}${body}</div>
    <div class="modal-foot">
      <button type="submit" class="btn btn-danger" data-role="save"${stages && !options ? ' disabled' : ''}>حذف اللوحة</button>
      <button type="button" class="btn" data-action="cbs-close">تراجع</button></div>
  </form>`;
}

function tagDeleteForm(tag) {
  const held = Number(tag.opp_count || 0);
  return `<form class="cbs-modal-form" data-form="tag-delete" data-id="${esc(tag.id)}">
    ${modalHead(`حذف تصنيف «${esc(tag.name_ar)}»`)}
    <div class="modal-body">${errBox}
      <div class="alert ${held ? 'warn' : 'info'}">${held
    ? `يُنزع هذا التصنيف عن ${num(held)} فرصة، وتبقى الفرص كما هي بمراحلها وقيمها. التصنيف صفةٌ لا موضع.`
    : 'لا فرصة تحمل هذا التصنيف الآن.'}</div>
    </div>
    <div class="modal-foot">
      <button type="submit" class="btn btn-danger" data-role="save">حذف التصنيف</button>
      <button type="button" class="btn" data-action="cbs-close">تراجع</button></div>
  </form>`;
}

// ── صفّ المرحلة داخل اللوحة ───────────────────────────────────────────────────────────────
function stageRow(s, { canManage, index, total }) {
  const archived = !!s.archived_at;
  const badges = [
    isOn(s.is_won) ? pill('تُحتسب فوزاً', 'green') : '',
    isOn(s.is_lost) ? pill('تُحتسب خسارة', 'red') : '',
    archived ? pill('مؤرشفة', 'slate') : '',
  ].join('');
  // النسبة ورمزها داخل عزلٍ واحد: «%» محايدٌ اتجاهياً، فوضعه خارج العزل يقلبه إلى يسار الرقم.
  const pctText = s.default_win_pct == null
    ? '<span class="cbs-none">لا تُفرض نسبة</span>'
    : num(`${Number(s.default_win_pct)}%`);
  const acts = canManage ? `<div class="cbs-acts">
    <button type="button" class="btn btn-sm" data-action="cbs-open" data-tpl="stage-edit-${esc(s.id)}">تعديل</button>
    <button type="button" class="btn btn-sm" data-action="cbs-archive" data-id="${esc(s.id)}" data-on="${archived ? '0' : '1'}"
      title="${archived ? 'إعادة العمود إلى اللوحة كما كان' : 'تُخفي العمود من اللوحة وتُبقي سجلّ فرصه كما هو'}">${archived ? 'إعادة العمود' : 'أرشفة'}</button>
    <button type="button" class="btn btn-sm btn-danger-ghost" data-action="cbs-open" data-tpl="stage-del-${esc(s.id)}">حذف</button>
  </div>` : '';
  const move = canManage ? `<div class="cbs-move">
    <button type="button" class="btn btn-sm btn-ghost" data-action="cbs-move" data-dir="up" aria-label="نقل المرحلة خطوة للأعلى" title="نقل للأعلى"${index === 0 ? ' disabled' : ''}>↑</button>
    <button type="button" class="btn btn-sm btn-ghost" data-action="cbs-move" data-dir="down" aria-label="نقل المرحلة خطوة للأسفل" title="نقل للأسفل"${index === total - 1 ? ' disabled' : ''}>↓</button>
  </div>` : '';
  return `<li class="cbs-stage${archived ? ' cbs-arch' : ''}" data-stage="${esc(s.id)}"${canManage ? ' draggable="true"' : ''}>
    ${canManage ? `<span class="cbs-grip" aria-hidden="true">${icon('list')}</span>` : ''}
    ${swatch(s.color)}
    <div class="cbs-tx">
      <div class="cbs-nm">${esc(s.name_ar)}${badges}</div>
      ${s.description_ar ? `<div class="cbs-ds" title="${esc(s.description_ar)}">${esc(s.description_ar)}</div>` : '<div class="cbs-ds cbs-none">بلا وصف</div>'}
    </div>
    <div class="cbs-num">
      <span>الفرص عليها <b>${num(Number(s.opp_count || 0))}</b></span>
      <span>احتمال الفوز ${pctText}</span>
    </div>
    ${move}${acts}
  </li>`;
}

function boardCard(b, { canManage }) {
  const stages = b.stages;
  const wins = stages.filter((s) => isOn(s.is_won)).length;
  const losses = stages.filter((s) => isOn(s.is_lost)).length;
  const opps = stages.reduce((a, s) => a + Number(s.opp_count || 0), 0);
  const head = `<div class="cbs-board-h">
    <div class="cbs-board-t">${esc(b.name_ar)}</div>
    ${b.is_default ? pill('اللوحة الافتراضية', 'blue') : ''}
    ${b.archived_at ? pill('مؤرشفة', 'slate') : ''}
    <div class="cbs-board-s">${b.description_ar ? esc(b.description_ar) : 'بلا وصف'}</div>
    <div class="cbs-board-n">
      <span>المراحل <b>${num(stages.length)}</b></span>
      <span>الفرص <b>${num(opps)}</b></span>
      <span>الفوز <b>${num(wins)}</b></span>
      <span>الخسارة <b>${num(losses)}</b></span>
    </div>
    ${canManage ? `<div class="cbs-acts">
      <button type="button" class="btn btn-sm btn-primary" data-action="cbs-open" data-tpl="stage-new-${esc(b.id)}">مرحلة جديدة</button>
      <button type="button" class="btn btn-sm" data-action="cbs-open" data-tpl="board-edit-${esc(b.id)}">تعديل اللوحة</button>
      ${b.is_default ? '' : `<button type="button" class="btn btn-sm btn-danger-ghost" data-action="cbs-open" data-tpl="board-del-${esc(b.id)}">حذف اللوحة</button>`}
    </div>` : ''}
  </div>`;
  const body = stages.length
    ? `<ol class="cbs-list" data-stages="${esc(b.id)}">${stages.map((s, i) => stageRow(s, { canManage, index: i, total: stages.length })).join('')}</ol>
       ${canManage ? '<div class="cbs-foot">اسحب المرحلة إلى موضعها أو استعمل السهمين — يُحفظ الترتيب فور إفلاتها.</div>' : ''}`
    : `<div class="empty-state">${icon('kanban')}
        <div class="t">لوحةٌ بلا مراحل</div>
        <div class="s">اللوحة لا تعرض شيئاً حتى يكون فيها عمودٌ واحد على الأقل. ابدأ بعمود «فرصة جديدة» ثم أضف بقية خطوات البيع.</div>
        ${canManage ? `<button type="button" class="btn btn-primary btn-sm" data-action="cbs-open" data-tpl="stage-new-${esc(b.id)}">أضف أول مرحلة</button>` : ''}</div>`;
  return `<section class="card cbs-board">${head}${body}</section>`;
}

function tagCard(t, { canManage }) {
  return `<div class="cbs-tag">
    <div class="cbs-nm">${swatch(t.color)}${esc(t.name_ar)}${t.archived_at ? pill('مؤرشف', 'slate') : ''}</div>
    <div class="cbs-ds">${t.description_ar ? esc(t.description_ar) : '<span class="cbs-none">بلا وصف</span>'}</div>
    <div class="cbs-tag-f">
      <span class="cbs-num"><span>الفرص <b>${num(Number(t.opp_count || 0))}</b></span></span>
      ${canManage ? `<span class="cbs-acts">
        <button type="button" class="btn btn-sm" data-action="cbs-open" data-tpl="tag-edit-${esc(t.id)}">تعديل</button>
        <button type="button" class="btn btn-sm btn-danger-ghost" data-action="cbs-open" data-tpl="tag-del-${esc(t.id)}">حذف</button>
      </span>` : ''}
    </div>
  </div>`;
}

const CSS = `
body[data-page="crm-board-settings"] .cbs{max-width:1120px;margin-inline:auto;display:grid;gap:1rem}
body[data-page="crm-board-settings"] .cbs-status{position:sticky;top:0;z-index:6;margin:0}
body[data-page="crm-board-settings"] .cbs-status[hidden]{display:none}
body[data-page="crm-board-settings"] .cbs-rules{display:grid;gap:.5rem}
body[data-page="crm-board-settings"] .cbs-rules p{margin:0;line-height:1.9}
body[data-page="crm-board-settings"] .cbs-bar{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
body[data-page="crm-board-settings"] .cbs-bar .sp{flex:1 1 auto}
body[data-page="crm-board-settings"] .cbs-board-h{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;padding:.8rem 1rem;border-bottom:1px solid var(--line)}
body[data-page="crm-board-settings"] .cbs-board-t{font-weight:800;font-size:var(--fs-title);color:var(--ink2);
  min-width:0;overflow-wrap:anywhere}
body[data-page="crm-board-settings"] .cbs-board-s{flex:1 1 200px;min-width:0;font-size:var(--fs-meta);color:var(--muted);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
body[data-page="crm-board-settings"] .cbs-board-n{display:flex;gap:.75rem;flex-wrap:wrap;font-size:var(--fs-meta);color:var(--muted)}
body[data-page="crm-board-settings"] .cbs-board-n b,body[data-page="crm-board-settings"] .cbs-num b{color:var(--ink2);font-weight:800}
body[data-page="crm-board-settings"] .cbs-acts{display:flex;gap:.35rem;flex-wrap:wrap}
body[data-page="crm-board-settings"] .cbs-list{list-style:none;margin:0;padding:.6rem;display:grid;gap:.45rem}
body[data-page="crm-board-settings"] .cbs-stage{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;
  padding:.55rem .7rem;border:1px solid var(--line);border-radius:var(--r-sm);background:#fff}
body[data-page="crm-board-settings"] .cbs-stage.cbs-arch{background:#fafbfe;border-style:dashed}
body[data-page="crm-board-settings"] .cbs-stage.cbs-drag{opacity:.45}
body[data-page="crm-board-settings"] .cbs-stage.cbs-over{border-color:var(--brand);box-shadow:0 0 0 3px rgba(36,74,153,.14)}
body[data-page="crm-board-settings"] .cbs-grip{display:flex;color:var(--faint);cursor:grab;flex:0 0 auto}
body[data-page="crm-board-settings"] .cbs-sw{width:12px;height:12px;border-radius:4px;flex:0 0 auto;box-shadow:inset 0 0 0 1px rgba(15,23,42,.14)}
body[data-page="crm-board-settings"] .cbs-tx{flex:1 1 190px;min-width:0}
body[data-page="crm-board-settings"] .cbs-nm{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;
  font-weight:700;font-size:var(--fs-ui);color:var(--ink2);min-width:0;overflow-wrap:anywhere}
body[data-page="crm-board-settings"] .cbs-ds{font-size:var(--fs-meta);color:var(--muted);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
body[data-page="crm-board-settings"] .cbs-none{color:var(--faint)}
body[data-page="crm-board-settings"] .cbs-num{display:flex;gap:.8rem;flex-wrap:wrap;flex:0 0 auto;font-size:var(--fs-meta);color:var(--muted)}
body[data-page="crm-board-settings"] .cbs-move{display:flex;gap:.15rem;flex:0 0 auto}
body[data-page="crm-board-settings"] .cbs-move .btn{padding:.2rem .45rem;line-height:1}
body[data-page="crm-board-settings"] .btn-danger-ghost{color:var(--red);border-color:#f3d3d3}
body[data-page="crm-board-settings"] .btn-danger-ghost:hover{background:#fef2f2;border-color:#f0b9b9}
body[data-page="crm-board-settings"] .btn-danger{background:var(--red);color:#fff;border-color:transparent}
body[data-page="crm-board-settings"] .btn-danger:hover{background:#b91c1c}
body[data-page="crm-board-settings"] .btn-danger[disabled]{opacity:.5;cursor:default}
body[data-page="crm-board-settings"] .cbs-foot{padding:0 1rem .8rem;font-size:var(--fs-meta);color:var(--faint);line-height:1.8}
body[data-page="crm-board-settings"] .cbs-tags{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));
  gap:.6rem;padding:.8rem 1rem 1rem}
body[data-page="crm-board-settings"] .cbs-tag{border:1px solid var(--line);border-radius:var(--r-sm);padding:.6rem .7rem;display:grid;gap:.35rem}
body[data-page="crm-board-settings"] .cbs-tag-f{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;justify-content:space-between}
body[data-page="crm-board-settings"] .cbs-hint{font-size:var(--fs-micro);color:var(--muted);line-height:1.8}
body[data-page="crm-board-settings"] .cbs-color{width:100%;height:38px;padding:2px;border:1px solid var(--line);
  border-radius:10px;background:#fff;cursor:pointer}
body[data-page="crm-board-settings"] .cbs-modal-form{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;overflow:hidden}
body[data-page="crm-board-settings"] .cbs-err[hidden]{display:none}
body[data-page="crm-board-settings"] .dd-line{display:flex;gap:.55rem;padding:.5rem 0;border-bottom:1px dashed var(--line);font-size:var(--fs-body);line-height:1.9}
body[data-page="crm-board-settings"] .dd-line:last-child{border-bottom:none}
body[data-page="crm-board-settings"] .dd-line b{flex:0 0 auto;color:var(--ink2)}
@media(max-width:640px){
  body[data-page="crm-board-settings"] .cbs-board-s{white-space:normal;flex-basis:100%}
  body[data-page="crm-board-settings"] .cbs-num,body[data-page="crm-board-settings"] .cbs-acts{flex-basis:100%}
  body[data-page="crm-board-settings"] .cbs-move{margin-inline-start:auto}
}`;

/** إعدادات لوحة الفرص — اللوحات ومراحلها وتصنيفاتها في شاشةٍ واحدة. */
export async function crmBoardSettingsPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const includeArchived = String(opts.archived || '') === '1';
  const [data, tags] = await Promise.all([
    listBoards(user, { includeArchived }),
    listTags(user, { includeArchived }),
  ]);
  const canManage = !!data.can_manage;
  const boards = data.boards;
  const orphans = data.orphan_stages || [];
  const liveBoards = boards.filter((b) => !b.archived_at);
  const boardChoices = liveBoards.length ? liveBoards : boards;
  // وجهاتُ نقل الفرص: كل مرحلةٍ حيّة في المنصة، باسم لوحتها كي لا يلتبس عمودان متشابهان.
  const liveStages = boards.flatMap((b) => b.stages.filter((s) => !s.archived_at).map((s) => ({ ...s, board_name: b.name_ar })));
  const totalStages = boards.reduce((a, b) => a + b.stages.length, 0);

  const archChip = (on, label) => `<a class="chip ${includeArchived === on ? 'on' : ''}" href="/app/crm-board-settings${on ? '?archived=1' : ''}">${label}</a>`;

  const toolbar = `<div class="cbs-bar">
    <span class="chips" style="margin:0">${archChip(false, 'الأعمدة العاملة')}${archChip(true, 'مع المؤرشف')}</span>
    <span class="sp"></span>
    <button type="button" class="btn btn-sm" data-action="cbs-dd" data-dd="cbs-meaning">كيف تُقرأ الأعمدة</button>
    ${canManage ? '<button type="button" class="btn btn-sm btn-primary" data-action="cbs-open" data-tpl="board-new">لوحة جديدة</button>' : ''}
  </div>`;

  const rules = `<div class="alert info cbs-rules">
    <div>
      <p><b>الفوز والخسارة يُقرآن من صفة العمود لا من اسمه.</b> غيّر اسم «فائزة» إلى ما شئت — التقارير وتوليد المشروع يتبعان الصفة المكتوبة على المرحلة، فلا ينكسر شيء. وإسقاط الصفة عن آخر عمود فوزٍ هو الذي يكسر، ولذلك يُردّ بجملة تقول لماذا.</p>
      <p><b>الأرشفة تُخفي العمود ولا تمحو تاريخه.</b> العمود المؤرشف يغادر اللوحة، وتبقى فرصه ومرورها وسجلّها كما هي — وتُعيده متى شئت. أما الحذف فيطلب منك وجهةً لفرصه أولاً، فلا فرصة تبقى بلا مرحلة.</p>
    </div></div>`;

  const boardsSection = boards.length
    ? boards.map((b) => boardCard(b, { canManage })).join('')
    : `<section class="card"><div class="empty-state">${icon('kanban')}
        <div class="t">لا توجد لوحة فرص بعد</div>
        <div class="s">اللوحة هي المسار الذي تمشي فيه الفرصة من أولها إلى حسمها. أنشئ لوحةً واحدة ثم أضف أعمدتها بالترتيب.</div>
        ${canManage ? '<button type="button" class="btn btn-primary btn-sm" data-action="cbs-open" data-tpl="board-new">أنشئ أول لوحة</button>' : ''}</div></section>`;

  const orphanSection = orphans.length ? `<section class="card cbs-board">
    <div class="cbs-board-h">
      <div class="cbs-board-t">مراحل بلا لوحة</div>
      <div class="cbs-board-s">لوحتها مؤرشفة أو محذوفة، فهي لا تظهر على أي مسار. انقلها إلى لوحة حيّة من زرّ التعديل.</div>
    </div>
    <ol class="cbs-list">${orphans.map((s, i) => stageRow(s, { canManage, index: i, total: orphans.length })).join('')}</ol>
  </section>` : '';

  const tagsSection = `<section class="card cbs-board">
    <div class="cbs-board-h">
      <div class="cbs-board-t">تصنيفات الفرص</div>
      <div class="cbs-board-s">صفةٌ توضع على الفرصة إلى جانب مرحلتها: الفرصة في مرحلةٍ واحدة، وتحمل تصنيفاتٍ كثيرة.</div>
      <div class="cbs-board-n"><span>التصنيفات <b>${num(tags.length)}</b></span></div>
      ${canManage ? '<div class="cbs-acts"><button type="button" class="btn btn-sm btn-primary" data-action="cbs-open" data-tpl="tag-new">تصنيف جديد</button></div>' : ''}
    </div>
    ${tags.length
    ? `<div class="cbs-tags">${tags.map((t) => tagCard(t, { canManage })).join('')}</div>`
    : `<div class="empty-state">${icon('flag')}
        <div class="t">لا تصنيفات بعد</div>
        <div class="s">التصنيف يجمع فرصاً تتشابه في صفة لا في خطوة — «قطاع حكومي» أو «أولوية عليا». أضف أول تصنيف لتبدأ تصفية الفرص به.</div>
        ${canManage ? '<button type="button" class="btn btn-primary btn-sm" data-action="cbs-open" data-tpl="tag-new">أضف أول تصنيف</button>' : ''}</div>`}
  </section>`;

  // ── القوالب الخاملة: تُبنى على الخادم مهروبةً، ويفتحها الزرّ بالتفويض ────────────────────
  const templates = !canManage ? '' : [
    tpl('board-new', boardForm(null)),
    ...boards.map((b) => tpl(`board-edit-${b.id}`, boardForm(b))),
    ...boards.filter((b) => !b.is_default).map((b) => tpl(`board-del-${b.id}`, boardDeleteForm(b, liveBoards.filter((x) => x.id !== b.id)))),
    ...boards.map((b) => tpl(`stage-new-${b.id}`, stageForm({ boards: boardChoices, boardId: b.id }))),
    ...boards.flatMap((b) => b.stages).concat(orphans).flatMap((s) => [
      tpl(`stage-edit-${s.id}`, stageForm({ boards: boardChoices, boardId: s.board_id, stage: s })),
      tpl(`stage-del-${s.id}`, stageDeleteForm(s, liveStages)),
    ]),
    tpl('tag-new', tagForm(null)),
    ...tags.flatMap((t) => [tpl(`tag-edit-${t.id}`, tagForm(t)), tpl(`tag-del-${t.id}`, tagDeleteForm(t))]),
  ].join('');

  const meaningDD = `<template id="dd-cbs-meaning">
    ${modalHead('كيف يقرأ سند هذه الأعمدة')}
    <div class="modal-body">
      <div class="dd-line"><b>الاسم:</b><span>نصٌّ للقراءة على الشاشة. تغييره لا يغيّر رقماً واحداً في أي تقرير.</span></div>
      <div class="dd-line"><b>صفة الحسم:</b><span>«تُحتسب فوزاً» أو «تُحتسب خسارة» هي ما تقرؤه التقارير، وعليها يقوم توليد المشروع من الفرصة الفائزة. ولكل لوحة عمود فوز واحد وعمود خسارة واحد على الأكثر، كي يبقى الحسم رقماً واحداً.</span></div>
      <div class="dd-line"><b>احتمال الفوز:</b><span>نسبةٌ تُقترح على الفرصة حين تصل هذا العمود. تركُه فارغاً يعني «لا تُفرض نسبة» — وهو غير الصفر الذي يعني أن الفوز مستبعد.</span></div>
      <div class="dd-line"><b>الترتيب:</b><span>ترتيب الأعمدة على اللوحة كما يراها الفريق. يُحفظ فور إفلات المرحلة في موضعها.</span></div>
      <div class="dd-line"><b>الأرشفة:</b><span>إخفاء العمود من اللوحة مع بقاء فرصه وسجلّه. ولا يُؤرشف عمودٌ عليه فرص حتى تُنقل، ولا آخر عمود في لوحة.</span></div>
      <div class="dd-line"><b>الحذف:</b><span>إزالة العمود نهائياً من اللوحة. وإن كانت عليه فرص فلا يقع إلا بوجهةٍ تُسمّى، والنقل والحذف يقعان معاً.</span></div>
      <div class="dd-line"><b>التصنيف:</b><span>صفةٌ على الفرصة لا خطوة في مسارها. الفرصة في مرحلةٍ واحدة وتحمل تصنيفاتٍ كثيرة، وحذف التصنيف ينزعه عن الفرص ولا يمسّها.</span></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn" data-action="cbs-close">إغلاق</button></div>
  </template>`;

  const body = `<div class="cbs">
    <div id="cbs-status" class="alert info cbs-status" role="status" aria-live="polite" hidden></div>
    ${rules}
    ${toolbar}
    ${canManage ? '' : '<div class="alert warn">لديك اطّلاع على الإعدادات دون تعديلها. إدارة اللوحات والمراحل والتصنيفات يملكها فريق تطوير الأعمال ورئيسه ومدير النظام.</div>'}
    ${boardsSection}
    ${orphanSection}
    ${tagsSection}
    <div class="cbs-foot">${num(boards.length)} لوحة · ${num(totalStages)} مرحلة · ${num(tags.length)} تصنيف${includeArchived ? ' (المؤرشف معروض)' : ''}. كل تغيير هنا يُسجَّل باسمك في سجل التدقيق.</div>
    ${meaningDD}${templates}
  </div>`;

  return layout({
    user,
    active: 'crm-board-settings',
    title: 'إعدادات لوحة الفرص',
    subtitle: 'الأعمدة والتصنيفات يديرها الفريق بنفسه',
    body,
    year,
    extraHead: `<style>${CSS}</style>`,
    scripts: ['/static/pages/crm-board-settings.js'],
  });
}
