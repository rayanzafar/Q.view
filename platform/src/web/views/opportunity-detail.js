// صفحة الفرصة — قصة القرار الكاملة: من هي، أين تقف، ما الخطوة التالية، من يعمل عليها،
// كيف تحركت بين المراحل، وما آخر تواصل معها. (contracts §1: /app/opportunity/:id)
// أخطاء الصلاحية/عدم الوجود تصعد من الخدمة وتُعرض صفحة عربية عبر errors.js تلقائياً.
import { layout, card, pill, tr } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar, toSar } from '../../core/util/ids.js';
import { get, all } from '../../core/db/index.js';
import { DELIVERY_SECTOR_SQL } from '../../core/org/kind.js';
import { opportunityDetail, ROT_THRESHOLDS } from '../../modules/crm/opportunities.js';
import { TEAM_ROLE_LABELS } from '../../modules/crm/oppteam.js';
import { esc, pct } from './_shared.js';
import {
  G, ENGAGEMENT_TYPE_AR, ENGAGEMENT_TYPE_TIP, engagementTypeLabel,
  SOLICITATION_TYPE_AR, SOLICITATION_TYPE_TIP, solicitationTypeLabel,
  OPP_DOC_KIND_AR, oppDocKindLabel,
} from '../i18n/glossary.js';
import { splitGross, VAT_RATE_PCT } from '../../modules/finance/vat.js';
import { pickablePeople } from '../../modules/org/people.js';
import { stageTip } from './crm.js';

const ACT_KIND_LABELS = {
  call: 'اتصال', meeting: 'اجتماع', email: 'بريد', note: 'ملاحظة',
  visit: 'زيارة', proposal: 'عرض', update: 'تحديث', other: 'أخرى',
};
const SOURCE_LABELS = { manual: 'إدخال يدوي', legacy: 'منقولة من النظام السابق', import: 'استيراد Excel', app: 'المنصة' };

const secHead = (t, extra = '') => `<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:.6rem">
  <div style="font-weight:800;font-size:13.5px">${t}</div>${extra}</div>`;
const emptySec = (ic, t, s) => `<div class="empty-state" style="padding:1.4rem .8rem">${icon(ic)}<div class="t">${t}</div><div class="s">${s}</div></div>`;

export async function opportunityDetailPage(user, oppId, opts = {}) {
  const d = await opportunityDetail(user, oppId); // notFound/forbidden → صفحة خطأ عربية
  const o = d.opp;
  const st = d.stages.find((s) => s.id === o.stage_id) || {};
  const sectorName = o.sector_id ? (await get('SELECT name_ar FROM sector WHERE id = ?', [o.sector_id]))?.name_ar : null;
  const stById = Object.fromEntries(d.stages.map((s) => [s.id, s]));
  const stName = (sid) => (stById[sid] || {}).name_ar || sid || '—';
  const isOpen = !st.is_won && !st.is_lost;
  const th = ROT_THRESHOLDS[o.stage_id];
  const age = d.stage_age_days;

  // ── الترويسة: هوية الفرصة + موقعها + قيمتها ──
  const ageTone = d.rot ? 'background:#fee2e2;color:#dc2626' : th && age != null && age > th / 2 ? 'background:#fef3c7;color:#b45309' : 'background:#f1f5f9;color:#64748b';
  const agePill = (isOpen && age != null)
    ? `<span class="pill tnum" style="${ageTone}" title="${esc(d.rot ? 'فرصة متوقفة — حرّكها أو حدّث خطوتها التالية' : G.stageAge(age))}">${icon('clock')} منذ ${age} يوماً</span>` : '';
  const header = card(`<div style="padding:1rem 1.15rem;display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-start">
    <div style="flex:1;min-width:260px">
      <div style="font-size:11px;color:var(--muted);font-weight:700">${G.opportunity} · <span class="tnum">${esc(o.code || '—')}</span></div>
      <h2 style="font-size:18px;margin:.25rem 0 .55rem">${esc(o.title_ar)}</h2>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center">
        <span class="pill" data-tip="${esc(stageTip(st.id ? st : { name_ar: o.stage_id }))}" tabindex="0" style="background:${st.color || '#cbd5e1'}22;color:var(--ink2);cursor:help"><span style="width:8px;height:8px;border-radius:50%;background:${st.color || '#cbd5e1'}"></span>${esc(st.name_ar || o.stage_id)}</span>
        ${agePill}
        ${o.priority ? pill(tr(o.priority), o.priority === 'P0' ? 'red' : o.priority === 'P1' ? 'amber' : 'slate') : ''}
        ${o.engagement_type === 'FRAMEWORK'
    ? `<span class="pill" style="background:#f3e8ff;color:#6b21a8" title="${esc(ENGAGEMENT_TYPE_TIP.FRAMEWORK)}">${esc(ENGAGEMENT_TYPE_AR.FRAMEWORK)}</span>` : ''}
        ${o.solicitation_type
    ? `<span class="pill" style="background:#eef1f7;color:#475569" title="${esc(SOLICITATION_TYPE_TIP[o.solicitation_type] || '')}">${esc(SOLICITATION_TYPE_AR[o.solicitation_type])}</span>` : ''}
      </div>
      <div style="margin-top:.7rem;display:flex;gap:1.1rem;flex-wrap:wrap;font-size:var(--fs-body);color:var(--muted)">
        <span style="display:inline-flex;align-items:center;gap:.3rem">${icon('building')}${o.client_id ? `<a href="/app/client/${o.client_id}" style="color:var(--brand);font-weight:700">${esc(d.client || 'العميل')}</a>` : 'بدون عميل'}</span>
        ${sectorName ? `<span style="display:inline-flex;align-items:center;gap:.3rem">${icon('sector')}${esc(sectorName)}${d.department ? ` <span style="color:var(--faint)">›</span> ${esc(d.department)}` : ''}</span>` : ''}
        <span style="display:inline-flex;align-items:center;gap:.3rem">${icon('flag')}المسؤول: <b style="color:var(--ink2)">${esc(d.owner || '—')}</b></span>
      </div>
    </div>
    <div style="flex:0 0 auto;text-align:left">
      <div style="font-size:11px;color:var(--muted);font-weight:700">${G.raw}</div>
      <div class="metric tnum" style="font-size:1.5rem">${fmtSar(o.value_halalas)}</div>
      <div style="font-size:var(--fs-meta);color:var(--brand2);font-weight:800" class="tnum">${G.weighted} ${fmtSar(d.weighted_halalas)} <span style="color:var(--faint);font-weight:600">(${pct(o.win_pct)})</span></div>
    </div>
  </div>`);

  // ── شريط الإجراء: الخطوة التالية + نقل المرحلة ──
  const naValue = (o.next_action && String(o.next_action).trim())
    ? `<span ${d.canEdit ? `class="editable" data-action="na-edit" data-id="${o.id}" data-value="${esc(o.next_action)}" role="button" tabindex="0" title="انقر لتعديل الخطوة التالية"` : ''} style="font-size:13.5px;font-weight:700;color:var(--ink2)">${esc(o.next_action)}</span>`
    : (d.canEdit
      ? `<span class="editable" data-action="na-edit" data-id="${o.id}" data-value="" role="button" tabindex="0" style="font-size:var(--fs-ui);color:var(--red);font-weight:700">● ${G.noNextAction} — انقر لإضافتها</span>`
      : `<span style="font-size:var(--fs-ui);color:var(--muted)">${G.noNextAction}</span>`);
  const actionBar = card(`<div style="padding:.85rem 1.15rem;display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
    <div style="flex:1;min-width:240px">
      <div style="font-size:11px;font-weight:800;color:var(--muted);margin-bottom:.2rem">${G.nextAction}</div>
      ${naValue}
    </div>
    ${d.canEdit ? `<button class="btn btn-primary" data-action="stage-open">${icon('trend')} نقل المرحلة</button>` : ''}
  </div>`);

  // ── التحكم بالفرصة ─────────────────────────────────────────────────────────
  // «في فرص مسكّنة على إدارة الابتكار وأبغى أنقلها على الذكاء… لازم في الواجهة شي يساعدني لما
  // أضغط على الفرصة عشان أتحكّم بكل عملياتها: نقل قطاع، نقل إدارة، أو تغيير المبلغ».
  //
  // وما كان في هذه الصفحة قبلَها إلا حقلان: الخطوة التالية، والمرحلة. أما القيمة والقطاع
  // والإدارة والمسؤول والجهة والسنة فتُكتب مرةً عند الإنشاء ثم لا يمسّها شيء في المنتج كله —
  // فتصحيح رقمٍ واحد يعني فتح القاعدة من خلف الشاشة. **والإدارة أثقلها**: صار الترشيح بها
  // قائماً على شاشة الفرص، فيصل المالك إلى فرصةٍ عبر إدارتها ثم لا يجد فيها باباً يغيّرها.
  //
  // والإدارات كلها تُقرأ لا إدارات القطاع الحالي وحدها: نقل القطاع يُبدّل قائمة الإدارات في
  // نفس اللحظة، ولو قُرئت إدارات القطاع القديم وحدها لصار على المالك أن يحفظ القطاع ويعيد
  // فتح الصفحة ثم يحفظ الإدارة — خطوتان لقرار واحد. والخادم يدقّق النسبة على أي حال.
  const sectorOptions = d.canEdit
    ? await all(`SELECT id, name_ar FROM sector WHERE active = 1 AND deleted_at IS NULL AND ${DELIVERY_SECTOR_SQL} ORDER BY name_ar`) : [];
  const deptOptions = d.canEdit
    ? await all('SELECT id, name_ar, sector_id FROM department WHERE active = 1 AND deleted_at IS NULL ORDER BY name_ar') : [];
  const clientOptions = d.canEdit
    ? await all('SELECT id, name_ar FROM client WHERE deleted_at IS NULL ORDER BY name_ar LIMIT 300') : [];
  const userOptions = d.canEdit ? await pickablePeople({ limit: 200, viewer: user }) : [];
  // ── المبلغ بضريبة وبدون ──────────────────────────────────────────────────────
  // «وكم المبلغ بضريبة وبدون ضريبة» — والقاعدة موجودة في المنصة ومكتوبة في موضعٍ واحد
  // (`modules/finance/vat.js`): المبلغ المسجَّل على أي مستندٍ تجاري **إجمالي** — أي ما تدفعه
  // الجهة فعلاً — والصافي يُشتقّ منه، وهو وحده ما يُقارَن بالمستهدفات لأنها صافيةٌ أصلاً.
  //
  // فلا عمودَ ضريبةٍ جديد على الفرصة ولا خيارَ «شامل/غير شامل»: الفرصةُ نفسُها تصير عقداً ثم
  // فاتورةً ثم تحصيلاً، ولو اختلف تفسير رقمها هنا عن تفسيره هناك لاختلف الرقم على نفسه في
  // رحلته. المعروض اشتقاقٌ من القاعدة الواحدة، والشاشة تقول صراحةً أيُّ رقمٍ أيّ.
  const money = splitGross(o.value_halalas || 0);
  const vatNote = `<div style="display:flex;gap:1.1rem;flex-wrap:wrap;align-items:baseline;margin-top:.8rem;padding:.6rem .75rem;background:var(--bg2,#f8fafc);border-radius:8px">
    <div><div style="font-size:10px;color:var(--muted);font-weight:800">المبلغ شاملاً الضريبة</div>
      <b class="tnum" style="font-size:13.5px">${fmtSar(money.gross_halalas)}</b></div>
    <div><div style="font-size:10px;color:var(--muted);font-weight:800">بدون ضريبة</div>
      <b class="tnum" style="font-size:13.5px;color:var(--brand)">${fmtSar(money.net_halalas)}</b></div>
    <div><div style="font-size:10px;color:var(--muted);font-weight:800">الضريبة (${VAT_RATE_PCT}٪)</div>
      <span class="tnum" style="font-size:12.5px;color:var(--muted)">${fmtSar(money.vat_halalas)}</span></div>
    <div style="font-size:10.5px;color:var(--faint);flex:1;min-width:160px;line-height:1.6">
      المبلغ المُدخَل شاملٌ الضريبة — وهو ما تدفعه الجهة. و«بدون ضريبة» هو ما يُحتسب إيراداً للشركة ويُقارن بالمستهدف.</div>
  </div>`;
  // خانة المبلغ تأخذ عمودين: رقمُ ثمانيةِ خانات مع قائمةِ الضريبة بجانبه لا يسعان عموداً
  // واحداً، فيُقَصّ الرقم بصرياً — رأى المالك «437590» ومبلغُه ثمانون مليوناً. ورقمٌ لا يُقرأ
  // رقمٌ لا يُوثَق به، ويُغري بإعادة كتابته فوق الصحيح.
  const fld = (label, control, hint = '', span = 1) => `<div style="min-width:0${span > 1 ? `;grid-column:span ${span}` : ''}">
    <label style="display:block;font-size:10.5px;font-weight:800;color:var(--muted);margin-bottom:.2rem">${label}</label>
    ${control}${hint ? `<div style="font-size:10px;color:var(--faint);margin-top:.15rem">${hint}</div>` : ''}</div>`;
  const opt = (v, label, sel, extra = '') => `<option value="${esc(v)}"${sel ? ' selected' : ''}${extra}>${esc(label)}</option>`;
  const controlCard = !d.canEdit ? '' : card(`${secHead('التحكم بالفرصة', '<span style="font-size:11px;color:var(--muted)">كل شيء يُعدَّل من هنا</span>')}
    <div style="padding:.85rem 1rem 1rem">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.7rem .6rem">
        ${fld('اسم الفرصة', `<input id="oc-title" class="input" style="width:100%;font-size:12.5px" value="${esc(o.title_ar || '')}" maxlength="200">`)}
        ${fld('الجهة', `<select id="oc-client" class="input" style="width:100%;font-size:12.5px">
          ${opt('', 'بلا جهة', !o.client_id)}${clientOptions.map((c) => opt(c.id, c.name_ar, o.client_id === c.id)).join('')}</select>`)}
        ${fld('القطاع', `<select id="oc-sector" class="input" style="width:100%;font-size:12.5px">
          ${sectorOptions.map((s) => opt(s.id, s.name_ar, o.sector_id === s.id)).join('')}</select>`)}
        ${fld('الإدارة', `<select id="oc-dept" class="input" style="width:100%;font-size:12.5px">
          ${opt('', 'بلا إدارة', !o.department_id)}${deptOptions.map((x) => opt(x.id, x.name_ar, o.department_id === x.id, ` data-sector="${esc(x.sector_id || '')}"`)).join('')}</select>`,
    'تتغيّر مع القطاع')}
        ${fld('المسؤول', `<select id="oc-owner" class="input" style="width:100%;font-size:12.5px">
          ${opt('', 'بلا مسؤول', !o.owner_user_id)}${userOptions.map((u) => opt(u.id, u.name, o.owner_user_id === u.id)).join('')}</select>`)}
        ${fld('المبلغ بالريال', `<div style="display:flex;gap:.3rem;flex-wrap:wrap">
          <input id="oc-value" class="input tnum" type="number" min="0" step="1000" style="flex:1 1 130px;min-width:130px;font-size:12.5px" value="${toSar(o.value_halalas)}">
          <select id="oc-vat" class="input" style="flex:0 0 auto;width:auto;font-size:11.5px" aria-label="هل المبلغ المكتوب شامل الضريبة"
            title="اكتب الرقم كما اقتبسته الجهة — والمنصة تحسب الوجه الآخر. المحفوظ دائماً هو الشامل.">
            <option value="1" selected>شامل الضريبة</option>
            <option value="0">بدون ضريبة</option>
          </select></div>`, '<span id="oc-value-hint"></span>', 2)}
        ${fld('احتمال الفوز ٪', `<input id="oc-win" class="input tnum" type="number" min="0" max="100" style="width:100%;font-size:12.5px" value="${o.win_pct == null ? '' : Number(o.win_pct)}">`)}
        ${fld('السنة', `<input id="oc-year" class="input tnum" type="number" min="2000" max="2100" style="width:100%;font-size:12.5px" value="${o.year || ''}">`)}
        ${fld('الأولوية', `<select id="oc-priority" class="input" style="width:100%;font-size:12.5px">
          ${opt('', 'بلا أولوية', !o.priority)}${['P0', 'P1', 'P2', 'P3'].map((p) => opt(p, tr(p), o.priority === p)).join('')}</select>`)}
        ${fld('نوع الارتباط', `<select id="oc-engagement" class="input" style="width:100%;font-size:12.5px"
          title="${esc(Object.values(ENGAGEMENT_TYPE_TIP).join(' · '))}">
          ${opt('', 'لم يُحدَّد', !o.engagement_type)}${Object.entries(ENGAGEMENT_TYPE_AR).map(([v, l]) => opt(v, l, o.engagement_type === v)).join('')}</select>`,
    o.engagement_type === 'FRAMEWORK' ? 'قيمتها سقف لا التزام' : '')}
        ${fld('نوع الطرح', `<select id="oc-solicitation" class="input" style="width:100%;font-size:12.5px"
          title="${esc(Object.values(SOLICITATION_TYPE_TIP).join(' · '))}">
          ${opt('', 'لم يُحدَّد', !o.solicitation_type)}${Object.entries(SOLICITATION_TYPE_AR).map(([v, l]) => opt(v, l, o.solicitation_type === v)).join('')}</select>`,
    o.solicitation_type ? esc(SOLICITATION_TYPE_TIP[o.solicitation_type] || '') : '')}
        ${/* «إذا كانت مؤهلة أو ليدز، برضو حطّ مكان نكتب فيه موقع تسليمها» — والخانة مفتوحة في كل
              مرحلة لا في المرحلتين وحدهما: حقلٌ يظهر ثم يختفي بتغيّر المرحلة يُفقِد ما كُتب فيه من
              عين قارئه بعد أن اتُّخذ القرار عليه. وهي **نصّ حرّ**: الجواب جهةُ استلامٍ أو مدينةُ
              تنفيذٍ أو «عن بُعد»، وقائمةٌ مغلقة تُجبر المُدخِل على أقرب خطأ. */ ''}
        ${fld('موقع التسليم', `<input id="oc-location" class="input" style="width:100%;font-size:12.5px"
          value="${esc(o.delivery_location || '')}" maxlength="160"
          placeholder="مثال: منصة اعتماد · الرياض — مقرّ الجهة · عن بُعد">`,
    'أين تُسلَّم أو تُنفَّذ — يُكتب مبكراً لأنه يحكم السفر والتسعير والتسكين', 2)}
      </div>
      ${vatNote}
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-top:.85rem;padding-top:.7rem;border-top:1px dashed var(--line)">
        <button class="btn btn-primary btn-sm" data-action="opp-control-save" data-id="${esc(o.id)}">حفظ التعديلات</button>
        <span style="font-size:11px;color:var(--muted)">نقل القطاع يرفع الإدارة القديمة — اختر إدارة القطاع الجديد ثم احفظ.</span>
      </div>
    </div>`);

  // ── فريق الفرصة ──
  const memberRow = (m) => `<div style="display:flex;align-items:center;gap:.6rem;padding:.5rem 0;border-bottom:1px dashed var(--line)">
    <span class="kav" style="width:30px;height:30px;font-size:11px;flex:0 0 auto">${esc((m.name_ar || '؟').trim().charAt(0))}</span>
    <div style="flex:1;min-width:0"><div style="font-size:var(--fs-ui);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name_ar)}</div>
      <div style="font-size:11px;color:var(--muted)">${esc(m.job_title || '—')}</div></div>
    ${pill(TEAM_ROLE_LABELS[m.role_in_group] || esc(m.role_in_group || 'عضو'), m.role_in_group === 'lead' ? 'blue' : m.role_in_group === 'sponsor' ? 'violet' : 'slate')}
    ${m.status === 'PENDING' ? `<span class="pill" style="background:#fef3c7;color:#b45309;flex:0 0 auto"
      title="طُلب تأكيد مديره أنه يعمل على هذه الفرصة — لا يُحتسب في تحميله قبل التأكيد">بانتظار تأكيد مديره</span>` : ''}
    ${m.allocation_pct != null ? `<span class="tnum" style="font-size:11px;color:var(--muted);flex:0 0 auto">${Math.round(m.allocation_pct)}%</span>` : ''}
    ${d.canEdit ? `<button class="btn btn-ghost btn-sm" data-action="team-remove" data-id="${m.membership_id}" title="إزالة من الفريق" aria-label="إزالة ${esc(m.name_ar)}">✕</button>` : ''}
  </div>`;
  // ── ضمّ عضو: بحثٌ بالاسم عبر الشركة كلها ────────────────────────────────────
  // «مدير أي إدارة يقدر يسكّن ناس موجودين في إدارة مختلفة — ولازم البحث بالاسم». وقائمةٌ
  // منسدلة بمئات الاسم لا يُبحث فيها؛ فالحقل مكتوبٌ فيه ويُرشِّح المتصفّح مع كل حرف
  // (`datalist` أصلية — بلا مكتبة ولا نداءٍ لكل ضغطة). والاسم يظهر معه إدارتُه وقطاعه، فمن
  // يضمّ شخصاً من إدارة أخرى يعرف من أين يأخذه.
  const addMemberForm = d.canEdit ? `<div style="display:flex;gap:.45rem;margin-top:.75rem;flex-wrap:wrap">
      <input id="team-emp-q" list="team-roster" class="input" style="flex:2;min-width:170px"
        placeholder="ابحث بالاسم… من أي إدارة" aria-label="ابحث عن موظف بالاسم" autocomplete="off">
      <datalist id="team-roster"></datalist>
      <input type="hidden" id="team-emp">
      <select id="team-role" class="input" style="flex:1;min-width:90px" aria-label="الدور في الفريق">
        ${['member', 'lead', 'reviewer', 'sponsor'].map((r) => `<option value="${r}">${TEAM_ROLE_LABELS[r]}</option>`).join('')}</select>
      <input id="team-pct" class="input" type="number" min="1" max="100" placeholder="٪" title="نسبة التخصيص (اختياري)" aria-label="نسبة التخصيص" style="width:64px">
      <button class="btn" data-action="team-add">${icon('userplus')} ${G.add}</button>
    </div>` : '';
  const teamCard = card(`${secHead(G.oppTeam, `<span style="font-size:11px;color:var(--muted)">${d.team.length} عضو</span>`)}
    <div style="padding:.5rem 1rem .9rem">
      ${d.team.map(memberRow).join('') || emptySec('team', 'لا فريق مُكلَّف بعد', d.canEdit ? 'أضف قائد الفرصة وأعضاءها لتوضيح من يعمل عليها.' : 'لم يُكلَّف أحد بهذه الفرصة حتى الآن.')}
      ${addMemberForm}
    </div>`);

  // ── سجل المراحل ──
  const histRow = (h) => `<div style="display:flex;gap:.6rem;padding:.5rem 0;border-bottom:1px dashed var(--line);font-size:var(--fs-body);align-items:flex-start">
    <span style="width:8px;height:8px;border-radius:50%;margin-top:.4rem;flex:0 0 auto;background:${(stById[h.to_stage_id] || {}).color || '#cbd5e1'}"></span>
    <div style="flex:1;min-width:0">
      <div>${esc(stName(h.from_stage_id))} ← <b>${esc(stName(h.to_stage_id))}</b></div>
      ${h.note ? `<div style="font-size:var(--fs-meta);color:var(--muted);margin-top:.1rem">السبب: ${esc(h.note)}</div>` : ''}
      <div style="font-size:var(--fs-micro);color:var(--faint);margin-top:.1rem">بواسطة ${esc(h.owner_name || h.username || '—')} · <span class="tnum">${esc((h.changed_at || '').slice(0, 10))}</span></div>
    </div></div>`;
  const historyCard = card(`${secHead('سجل المراحل')}
    <div style="padding:.4rem 1rem .8rem">${d.history.map(histRow).join('')
      || emptySec('history', 'لا تحركات بعد', 'ستظهر هنا كل نقلة مرحلة: من أين إلى أين، بواسطة من، ولماذا.')}</div>`);

  // ── سجل التواصل ──
  const actRow = (a) => `<div style="display:flex;gap:.6rem;padding:.5rem 0;border-bottom:1px dashed var(--line);font-size:var(--fs-body);align-items:flex-start">
    <span class="pill" style="background:#eef1f7;color:#475569;flex:0 0 auto">${ACT_KIND_LABELS[a.kind] || esc(a.kind || 'أخرى')}</span>
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;color:var(--ink2)">${esc(a.title)}</div>
      ${a.detail ? `<div style="font-size:var(--fs-meta);color:var(--muted);white-space:pre-wrap">${esc(a.detail)}</div>` : ''}
      <div style="font-size:var(--fs-micro);color:var(--faint);margin-top:.1rem">${esc(a.actor || '—')} · <span class="tnum">${esc((a.at || '').slice(0, 10))}</span></div>
    </div></div>`;
  // «لازم يكون في مكان أحدّث فيه الفرص وأكتب ملاحظات… عشان تُدوَّن مع الفرصة» — والنموذج كان
  // سطراً واحداً بلا متّسع، بينما الجدول يحمل عمود `detail` منذ أول يوم ولا شيء يكتب فيه.
  // فمن أراد تدوين خلاصة اجتماعٍ أو ملاحظةٍ على العرض حشرها في العنوان أو تركها خارج المنصة.
  const addActForm = d.canEdit ? `<div style="margin-top:.75rem">
      <div style="display:flex;gap:.45rem;flex-wrap:wrap">
        <select id="act-kind" class="input" style="width:110px" aria-label="نوع التحديث">
          ${['call', 'meeting', 'email', 'note', 'update'].map((k) => `<option value="${k}">${ACT_KIND_LABELS[k]}</option>`).join('')}</select>
        <input id="act-title" class="input" style="flex:1;min-width:170px" placeholder="ماذا حدث؟ مثال: اتصال متابعة بعد تسليم العرض" aria-label="عنوان التحديث">
      </div>
      <textarea id="act-detail" class="input" rows="2" style="width:100%;margin-top:.4rem;font-size:12.5px"
        placeholder="ملاحظات (اختياري) — خلاصة الاجتماع، ملاحظات الجهة على العرض، ما اتُّفق عليه…" aria-label="ملاحظات التحديث"></textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:.4rem">
        <button class="btn" data-action="act-add">${icon('plus')} تسجيل التحديث</button>
      </div>
    </div>` : '';
  const activityCard = card(`${secHead(G.activities, `<span style="font-size:11px;color:var(--muted)">آخر ${d.activities.length}</span>`)}
    <div style="padding:.4rem 1rem .9rem">
      ${d.activities.map(actRow).join('') || emptySec('inbox', 'لا تواصل مسجَّل بعد', 'سجِّل الاتصالات والاجتماعات هنا ليبقى تاريخ العلاقة كاملاً أمام الفريق.')}
      ${addActForm}
    </div>`);

  // ── مستندات الفرصة وروابطها ─────────────────────────────────────────────────
  // «حط مكان أرفع فيه لنك الفرصة أو الملفات المتعلقة، وأيضاً مكان التكنكل بروبوزل، وأيضاً حط
  // لنك الفايننشال بروبوزل». وجدول المستندات يحمل عمود الفرصة منذ الترحيلة ٠٠٥ ولم يُوصَل قط.
  //
  // **روابط لا نسخ**: المنصة تحفظ عنوان المستند لا محتواه (لا مخزن ملفات فيها). والشاشة تقول
  // ذلك صراحةً — فمن ظنّ أنه رفع نسخةً هنا سيبحث عنها يوم يحتاجها ولا يجدها.
  const docs = await all(`SELECT id, name, kind, url, note, uploaded_by, created_at
     FROM document WHERE opportunity_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [o.id]);
  const docRow = (x) => `<div style="display:flex;align-items:center;gap:.5rem;padding:.45rem 0;border-bottom:1px dashed var(--line)">
    <span class="pill" style="background:#eef1f7;color:#475569;flex:0 0 auto">${esc(oppDocKindLabel(x.kind))}</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:var(--fs-ui);font-weight:700;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.name)}</div>
      ${x.note ? `<div style="font-size:11px;color:var(--muted)">${esc(x.note)}</div>` : ''}
      <div style="font-size:var(--fs-micro);color:var(--faint)">${esc(x.uploaded_by || '—')} · <span class="tnum">${esc((x.created_at || '').slice(0, 10))}</span></div>
    </div>
    <a class="btn btn-sm" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer"
      style="flex:0 0 auto;text-decoration:none">فتح ↗</a>
    ${d.canEdit ? `<button class="btn btn-ghost btn-sm" data-action="opp-doc-del" data-id="${esc(x.id)}" title="إزالة" aria-label="إزالة ${esc(x.name)}">✕</button>` : ''}
  </div>`;
  const addDocForm = d.canEdit ? `<div style="margin-top:.7rem">
      <div style="display:flex;gap:.45rem;flex-wrap:wrap">
        <select id="doc-kind" class="input" style="width:130px" aria-label="نوع المستند">
          ${Object.entries(OPP_DOC_KIND_AR).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
        <input id="doc-name" class="input" style="flex:1;min-width:150px" placeholder="اسم المستند — مثال: العرض الفني v2" aria-label="اسم المستند">
      </div>
      <input id="doc-url" class="input" style="width:100%;margin-top:.4rem;font-size:12.5px" dir="ltr"
        placeholder="https://…  رابط الملف على درايف أو شيربوينت أو بوابة اعتماد" aria-label="رابط المستند">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-top:.4rem;flex-wrap:wrap">
        <span style="font-size:10.5px;color:var(--faint)">المنصة تحفظ الرابط لا نسخةً من الملف — أبقِ الملف في مكانه واربطه هنا.</span>
        <button class="btn" data-action="opp-doc-add" data-id="${esc(o.id)}">${icon('plus')} إضافة</button>
      </div>
    </div>` : '';
  const docsCard = card(`${secHead('المستندات والروابط', `<span style="font-size:11px;color:var(--muted)">${docs.length}</span>`)}
    <div style="padding:.4rem 1rem .9rem">
      ${docs.map(docRow).join('') || emptySec('upload', 'لا مستندات بعد',
    d.canEdit ? 'اربط هنا إعلان المنافسة وكراسة الشروط والعرض الفني والعرض المالي — فيجدها الفريق في مكان واحد.'
      : 'لم تُربط مستندات بهذه الفرصة بعد.')}
      ${addDocForm}
    </div>`);

  // ── تفاصيل ──
  const kv = (k, v) => `<div class="kv-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const detailsCard = card(`${secHead(G.details)}
    <div style="padding:.3rem 1rem .8rem">
      ${kv('الرمز', `<span class="tnum">${esc(o.code || '—')}</span>`)}
      ${kv('نوع الارتباط', `<span title="${esc(ENGAGEMENT_TYPE_TIP[o.engagement_type] || '')}">${esc(engagementTypeLabel(o.engagement_type))}</span>`)}
      ${kv('نوع الطرح', `<span title="${esc(SOLICITATION_TYPE_TIP[o.solicitation_type] || '')}">${esc(solicitationTypeLabel(o.solicitation_type))}</span>`)}
      ${kv('موقع التسليم', o.delivery_location ? esc(o.delivery_location) : '<span style="color:var(--faint)">لم يُحدَّد</span>')}
      ${kv('بدون ضريبة', `<span class="tnum">${fmtSar(money.net_halalas)}</span>`)}
      ${kv('المصدر', esc(SOURCE_LABELS[o.source] || o.source || '—'))}
      ${kv('الأولوية', o.priority ? esc(tr(o.priority)) : '—')}
      ${kv('السنة', `<span class="tnum">${o.year || '—'}</span>`)}
      ${kv('أُنشئت', `<span class="tnum">${esc((o.created_at || '').slice(0, 10) || '—')}</span>`)}
      ${o.notes ? kv('ملاحظات', `<span style="white-space:pre-wrap;font-weight:500">${esc(o.notes)}</span>`) : ''}
    </div>`);

  // ── المشروع الناتج ──
  // صفحة الفرصة لم تكن تذكر مشروعها إطلاقاً، رغم أن الرابط (`project.source_opp_id`) موجود في
  // المخطط ومعروض في جدول الفرص. فمن يفتح فرصة فائزة لا يعرف أوصلت إلى مشروع أم لا — وهو أول
  // سؤال يُسأل عن فرصة رُبحت. البطاقة تظهر للمحسومة فوزاً فقط: مفتوحةٌ لا مشروع لها بعدُ بطبيعتها.
  const wonPrj = st.is_won
    ? await get('SELECT id, name_ar, status FROM project WHERE source_opp_id = ? AND deleted_at IS NULL', [o.id])
    : null;
  const PRJ_STATUS = { IN_PROGRESS: ['قيد التنفيذ', 'blue'], ON_HOLD: ['متوقّف مؤقتاً', 'amber'], COMPLETED: ['مكتمل', 'green'], NOT_STARTED: ['لم يبدأ', 'slate'], CANCELLED: ['ملغى', 'slate'] };
  const projectCard = !st.is_won ? '' : card(`${secHead('المشروع الناتج')}
    <div style="padding:.8rem 1rem">${wonPrj
    ? (() => { const L = PRJ_STATUS[wonPrj.status] || [wonPrj.status, 'slate'];
      return `<a href="/app/project/${esc(wonPrj.id)}" style="font-weight:800;color:var(--brand);font-size:13.5px">${esc(wonPrj.name_ar)}</a>
        <div style="margin-top:.4rem">${pill(L[0], L[1])}</div>`; })()
    : (d.canEdit
      ? `<div style="font-size:12.5px;color:var(--muted);line-height:1.8;margin-bottom:.6rem">فرصة فائزة بلا مشروع بعد. أنشئه من هنا فيرث عميلها ويُربط بها.</div>
         <button class="btn btn-primary" data-action="opp-make-project" data-opp="${esc(o.id)}" data-name="${esc(o.title_ar || '')}" data-sector="${esc(o.sector_id || '')}">أنشئ المشروع</button>`
      : emptySec('projects', 'لم يُنشأ مشروع بعد', 'إنشاء المشاريع يتطلب صلاحية إدارة أو تشغيل'))}</div>`);

  // «لازم مكان يخلّيني أرجع للصفحة بعد ما أدخل على الفرصة وتفاصيلها» — وصفحةُ المشروع فيها
  // رابط رجوعٍ منذ بنائها، وصفحةُ الفرصة بلا واحد: يدخل المستخدم من قائمة الفرص ثم لا يجد
  // طريقاً إليها إلا زرّ المتصفّح — وهو يُفقد الترشيح والسنة والقطاع الذي وصل بها.
  // حالةُ القائمة كما وصلت (`?from=`) تُعاد كما هي — ولا يُبنى منها إلا استعلامٌ نظيف: قيمةٌ
  // تصل من الرابط لا تُدرَج في عنوانٍ بلا تدقيق، فالعنوان يُعاد بناؤه من مُرشِّحاتٍ معروفة وحدها.
  const backTo = (() => {
    const raw = String(opts.from || '');
    if (!raw) return '';
    const src = new URLSearchParams(raw);
    const out = new URLSearchParams();
    for (const k of ['sector', 'dept', 'year', 'sol', 'q', 'view']) {
      const v = src.get(k);
      if (v && v.length <= 64) out.set(k, v);
    }
    const q = out.toString();
    return q ? '?' + q : '';
  })();

  const body = `
    <a href="/app/opportunities${backTo}" style="font-size:12px;color:var(--muted)">← ${G.opportunities || 'الفرص'}</a>
    <div style="display:flex;flex-direction:column;gap:.9rem;margin-top:.6rem">
      ${header}
      ${actionBar}
      ${controlCard}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:.9rem;align-items:start">
        <div style="display:flex;flex-direction:column;gap:.9rem;min-width:0">${activityCard}${historyCard}</div>
        <div style="display:flex;flex-direction:column;gap:.9rem;min-width:0">${projectCard}${docsCard}${teamCard}${detailsCard}</div>
      </div>
    </div>
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      oppId:${JSON.stringify(o.id)},
      currentStage:${JSON.stringify(o.stage_id)},
      oppSector:${JSON.stringify(o.sector_id || '')},
      stages:${JSON.stringify(d.stages.map((s) => ({ id: s.id, name_ar: s.name_ar, color: s.color }))).replace(/</g, '\\u003c')},
      canEditOpp:${d.canEdit ? 'true' : 'false'}
    });</script>`;
  return layout({
    user, active: 'opportunities', title: esc(o.title_ar), subtitle: 'قصة القرار · الفرص والمبيعات', body,
    scripts: ['/static/pages/opps.js'],
  });
}
