// صفحة الفرصة — قصة القرار الكاملة: من هي، أين تقف، ما الخطوة التالية، من يعمل عليها،
// كيف تحركت بين المراحل، وما آخر تواصل معها. (contracts §1: /app/opportunity/:id)
// أخطاء الصلاحية/عدم الوجود تصعد من الخدمة وتُعرض صفحة عربية عبر errors.js تلقائياً.
import { layout, card, pill, tr } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { get } from '../../core/db/index.js';
import { opportunityDetail, ROT_THRESHOLDS } from '../../modules/crm/opportunities.js';
import { TEAM_ROLE_LABELS } from '../../modules/crm/oppteam.js';
import { esc, pct } from './_shared.js';
import { G } from '../i18n/glossary.js';
import { stageTip } from './crm.js';

const ACT_KIND_LABELS = {
  call: 'اتصال', meeting: 'اجتماع', email: 'بريد', note: 'ملاحظة',
  visit: 'زيارة', proposal: 'عرض', update: 'تحديث', other: 'أخرى',
};
const SOURCE_LABELS = { manual: 'إدخال يدوي', legacy: 'منقولة من النظام السابق', import: 'استيراد Excel', app: 'المنصة' };

const secHead = (t, extra = '') => `<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:.6rem">
  <div style="font-weight:800;font-size:13.5px">${t}</div>${extra}</div>`;
const emptySec = (ic, t, s) => `<div class="empty-state" style="padding:1.4rem .8rem">${icon(ic)}<div class="t">${t}</div><div class="s">${s}</div></div>`;

export async function opportunityDetailPage(user, oppId) {
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
      </div>
      <div style="margin-top:.7rem;display:flex;gap:1.1rem;flex-wrap:wrap;font-size:var(--fs-body);color:var(--muted)">
        <span style="display:inline-flex;align-items:center;gap:.3rem">${icon('building')}${o.client_id ? `<a href="/app/client/${o.client_id}" style="color:var(--brand);font-weight:700">${esc(d.client || 'العميل')}</a>` : 'بدون عميل'}</span>
        ${sectorName ? `<span style="display:inline-flex;align-items:center;gap:.3rem">${icon('sector')}${esc(sectorName)}</span>` : ''}
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

  // ── فريق الفرصة ──
  const memberRow = (m) => `<div style="display:flex;align-items:center;gap:.6rem;padding:.5rem 0;border-bottom:1px dashed var(--line)">
    <span class="kav" style="width:30px;height:30px;font-size:11px;flex:0 0 auto">${esc((m.name_ar || '؟').trim().charAt(0))}</span>
    <div style="flex:1;min-width:0"><div style="font-size:var(--fs-ui);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name_ar)}</div>
      <div style="font-size:11px;color:var(--muted)">${esc(m.job_title || '—')}</div></div>
    ${pill(TEAM_ROLE_LABELS[m.role_in_group] || esc(m.role_in_group || 'عضو'), m.role_in_group === 'lead' ? 'blue' : m.role_in_group === 'sponsor' ? 'violet' : 'slate')}
    ${m.allocation_pct != null ? `<span class="tnum" style="font-size:11px;color:var(--muted);flex:0 0 auto">${Math.round(m.allocation_pct)}%</span>` : ''}
    ${d.canEdit ? `<button class="btn btn-ghost btn-sm" data-action="team-remove" data-id="${m.membership_id}" title="إزالة من الفريق" aria-label="إزالة ${esc(m.name_ar)}">✕</button>` : ''}
  </div>`;
  const addMemberForm = d.canEdit ? `<div style="display:flex;gap:.45rem;margin-top:.75rem;flex-wrap:wrap">
      <select id="team-emp" data-roster class="input" style="flex:2;min-width:150px" aria-label="اختيار موظف"><option value="">جارٍ تحميل الأسماء…</option></select>
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
  const addActForm = d.canEdit ? `<div style="display:flex;gap:.45rem;margin-top:.75rem;flex-wrap:wrap">
      <select id="act-kind" class="input" style="width:110px" aria-label="نوع التواصل">
        ${['call', 'meeting', 'email', 'note'].map((k) => `<option value="${k}">${ACT_KIND_LABELS[k]}</option>`).join('')}</select>
      <input id="act-title" class="input" style="flex:1;min-width:170px" placeholder="ماذا حدث؟ مثال: اتصال متابعة بعد تسليم العرض" aria-label="عنوان النشاط">
      <button class="btn" data-action="act-add">${icon('plus')} تسجيل</button>
    </div>` : '';
  const activityCard = card(`${secHead(G.activities, `<span style="font-size:11px;color:var(--muted)">آخر ${d.activities.length}</span>`)}
    <div style="padding:.4rem 1rem .9rem">
      ${d.activities.map(actRow).join('') || emptySec('inbox', 'لا تواصل مسجَّل بعد', 'سجِّل الاتصالات والاجتماعات هنا ليبقى تاريخ العلاقة كاملاً أمام الفريق.')}
      ${addActForm}
    </div>`);

  // ── تفاصيل ──
  const kv = (k, v) => `<div class="kv-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const detailsCard = card(`${secHead(G.details)}
    <div style="padding:.3rem 1rem .8rem">
      ${kv('الرمز', `<span class="tnum">${esc(o.code || '—')}</span>`)}
      ${kv('المصدر', esc(SOURCE_LABELS[o.source] || o.source || '—'))}
      ${kv('الأولوية', o.priority ? esc(tr(o.priority)) : '—')}
      ${kv('السنة', `<span class="tnum">${o.year || '—'}</span>`)}
      ${kv('أُنشئت', `<span class="tnum">${esc((o.created_at || '').slice(0, 10) || '—')}</span>`)}
      ${o.notes ? kv('ملاحظات', `<span style="white-space:pre-wrap;font-weight:500">${esc(o.notes)}</span>`) : ''}
    </div>`);

  const body = `
    <div style="display:flex;flex-direction:column;gap:.9rem">
      ${header}
      ${actionBar}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:.9rem;align-items:start">
        <div style="display:flex;flex-direction:column;gap:.9rem;min-width:0">${activityCard}${historyCard}</div>
        <div style="display:flex;flex-direction:column;gap:.9rem;min-width:0">${teamCard}${detailsCard}</div>
      </div>
    </div>
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      oppId:${JSON.stringify(o.id)},
      currentStage:${JSON.stringify(o.stage_id)},
      stages:${JSON.stringify(d.stages.map((s) => ({ id: s.id, name_ar: s.name_ar, color: s.color }))).replace(/</g, '\\u003c')},
      canEditOpp:${d.canEdit ? 'true' : 'false'}
    });</script>`;
  return layout({
    user, active: 'opportunities', title: esc(o.title_ar), subtitle: 'قصة القرار · الفرص والمبيعات', body,
    scripts: ['/static/pages/opps.js'],
  });
}
