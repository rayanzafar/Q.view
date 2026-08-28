// «الفعاليات» — E1: قائمة الفعاليات، وصفحة الفعالية بتبويبَي الالتقاط والجهات الملتقطة.
//
// الالتقاط نموذجٌ **على الصفحة** لا نافذة: من يقف في جناح المعرض يمسك الجوّال بيدٍ واحدة
// ويلتقط بطاقةً تلو بطاقة، والنافذة المنبثقة على الجوّال تُغلق بالخطأ وتضيع ما كُتب.
// الحقول كبيرة (١٦ بكسل كي لا يقرّب iOS الشاشة، و٤٤ بكسل ارتفاعاً للإبهام)، وزرّ الحفظ في
// أسفل البطاقة نفسها. وما يُكتب يُحفظ مسودةً في المتصفح (pages/events.js) فلا يضيع بانقطاع
// الشبكة أو انطفاء الشاشة.
//
// القراءة هنا للعرض فقط عبر خدمة الفعاليات؛ كل كتابة تمرّ من مسارات الخدمة.
import { layout, card, pill } from '../layout.js';
import { esc, statMini } from './_shared.js';
import { icon } from '../icons.js';
import { G } from '../i18n/glossary.js';
import { all } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { MONTHS_AR, RIYADH_OFFSET_HOURS } from '../../core/i18n/time.js';
import {
  CARD_KINDS, OUTCOMES, listEvents, getEvent, eventSummary, listContacts, recentContacts,
} from '../../modules/events/events.js';

const PAGE_SCRIPT = ['/static/pages/events.js'];
const CONTACTS_LIMIT = 200;
const RECENT_LIMIT = 8;

// ── ألوان الحالة: اللون معنى لا زينة — أخضر يجري، أزرق قادم، رمادي انتهى أو أُغلق ──
const STATUS_TONE = { 'جارية': 'green', 'قادمة': 'blue', 'منتهية': 'slate', 'مُغلقة': 'slate' };
const OUTCOME_TONE = { 'لم تُراجع': 'slate', 'تواصلنا': 'amber', 'صارت فرصة': 'green', 'صارت شراكة': 'blue', 'لا متابعة': 'slate' };
const statusPill = (s) => pill(esc(s || '—'), STATUS_TONE[s] || 'slate');
const outcomePill = (o) => pill(esc(o || OUTCOMES[0]), OUTCOME_TONE[o] || 'slate');
const kindPill = (k) => `<span class="pill" style="background:#eef1f7;color:#475569">${esc(k || '—')}</span>`;

// ── التواريخ: «31 أغسطس – 3 سبتمبر 2026» — الشهر باسمه الكامل، والأرقام معزولة الاتجاه ──
const parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  return { y, mo, d };
};
function fmtRange(start, end, html = false) {
  const n = (v) => (html ? `<span class="tnum">${v}</span>` : String(v));
  const a = parseDay(start), b = parseDay(end) || a;
  if (!a) return 'بلا تاريخ';
  const one = (x) => `${n(x.d)} ${MONTHS_AR[x.mo - 1]} ${n(x.y)}`;
  if (!b || (a.y === b.y && a.mo === b.mo && a.d === b.d)) return one(a);
  if (a.y === b.y && a.mo === b.mo) return `${n(a.d)} – ${n(b.d)} ${MONTHS_AR[a.mo - 1]} ${n(a.y)}`;
  if (a.y === b.y) return `${n(a.d)} ${MONTHS_AR[a.mo - 1]} – ${n(b.d)} ${MONTHS_AR[b.mo - 1]} ${n(a.y)}`;
  return `${one(a)} – ${one(b)}`;
}
// ساعة الرياض من ختمٍ عالمي — «الساعة ١٠:٤٢» هي ساعة الجناح لا ساعة غرينتش.
const riyadh = (iso) => {
  const t = new Date(String(iso || ''));
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + RIYADH_OFFSET_HOURS * 3600000);
};
const hhmm = (iso) => { const t = riyadh(iso); return t ? t.toISOString().slice(11, 16) : ''; };
const dayLabel = (iso) => {
  const t = riyadh(iso);
  if (!t) return '';
  return `${t.getUTCDate()} ${MONTHS_AR[t.getUTCMonth()]}`;
};

// اسم البطاقة كما يُقرأ في القوائم: الشخص، وإلا الجهة، وإلا الجوّال — ولا يُترك فراغ.
const contactLabel = (c) => c.person_name || c.org_name || c.phone || 'بطاقة بلا اسم';

const CSS = `<style>
.ev-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.9rem}
.ev-card{display:block;padding:1rem 1.1rem;color:inherit}
.ev-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:.6rem}
.ev-card-top h3{font-size:var(--fs-title);line-height:1.5;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.ev-meta{display:flex;flex-wrap:wrap;gap:.35rem 1rem;margin-top:.45rem;font-size:var(--fs-body);color:var(--muted)}
.ev-meta span{display:inline-flex;align-items:center;gap:.3rem;min-width:0}
.ev-meta svg{width:14px;height:14px;flex:none}
.ev-counts{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-top:.85rem;border-top:1px solid var(--line);padding-top:.7rem}
.ev-counts b{display:block;font-size:var(--fs-num-sm);font-weight:800;color:var(--ink2)}
.ev-counts span{font-size:var(--fs-micro);color:var(--muted);font-weight:700}
.ev-hd{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-top:.2rem}
.ev-hd h2{font-size:18px;line-height:1.4}
.ev-today{margin-top:.7rem;font-size:var(--fs-body);color:var(--muted)}
.ev-today b{color:var(--ink2);font-weight:800}
.ev-tabs{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;margin:.9rem 0}
.seg a[role=tab]{font-size:12px;font-weight:700;color:var(--muted);padding:.35rem .7rem;border-radius:8px;display:flex;align-items:center;gap:.35rem;flex:0 0 auto}
.seg a[role=tab].on{background:#fff;color:var(--ink2);box-shadow:var(--sh-sm)}
.seg a[role=tab]:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
.ev-cap{display:grid;gap:.9rem;max-width:640px}
.ev-form{display:grid;gap:.8rem}
.ev-form .input,.ev-form select,.ev-form textarea{font-size:16px;min-height:44px;padding:.55rem .75rem}
.ev-form textarea{min-height:64px;line-height:1.6}
.ev-form .chips{margin-bottom:0}
.ev-form .chip{min-height:40px}
.ev-form .ev-auto{background:#fffbeb;border-color:#fde68a}
.ev-paste{display:grid;gap:.4rem;border:1px dashed var(--line);border-radius:12px;padding:.7rem .8rem;background:var(--bg)}
.ev-paste>label{font-size:var(--fs-meta);font-weight:700;color:var(--muted)}
.ev-paste .ev-hint{font-size:var(--fs-meta);color:var(--muted);line-height:1.8}
.ev-paste .btn{justify-self:start;min-height:40px}
.ev-save{width:100%;justify-content:center;min-height:48px;font-size:var(--fs-ui);font-weight:800}
.ev-sec-t{font-size:var(--fs-title);font-weight:800;color:var(--ink2)}
.ev-sec-s{font-size:var(--fs-meta);color:var(--muted);margin-top:.1rem}
.ev-rc{display:flex;align-items:center;gap:.6rem;padding:.5rem 0;border-bottom:1px dashed var(--line);font-size:var(--fs-body)}
.ev-rc:last-child{border-bottom:0}
.ev-rc-main{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ev-rc-main b{color:var(--ink2)}
.ev-rc-org{color:var(--muted)}
.ev-rc-side{display:inline-flex;align-items:center;gap:.4rem;flex:0 0 auto}
.ev-rc-side .tnum{color:var(--faint);font-size:var(--fs-meta)}
.ev-tag{display:inline-block;padding:.12rem .45rem;border-radius:999px;font-size:var(--fs-micro);font-weight:800;background:#fef3c7;color:#92400e;white-space:nowrap}
.ev-team{margin-top:.6rem;padding-top:.6rem;border-top:1px solid var(--line);font-size:var(--fs-body);color:var(--muted)}
.ev-tb{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:.8rem}
.ev-tb .input{flex:1 1 240px;min-height:40px}
.ev-stats{display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:.8rem}
.ev-tbl th{padding:.5rem .7rem;font-weight:700;font-size:10.5px;color:var(--muted);text-align:right}
.ev-tbl td{padding:.55rem .7rem;border-top:1px solid var(--line);font-size:var(--fs-body);vertical-align:top}
.ev-sm{font-size:var(--fs-meta);color:var(--muted)}
.ev-ltr{direction:ltr;text-align:right;unicode-bidi:isolate}
@media(max-width:640px){
  .ev-counts b{font-size:var(--fs-ui)}
  .ev-stats>.card{flex:1 1 30%;min-width:0!important}
}
</style>`;

// روابط التصفية تحفظ بقية المعاملات: من ضيّق النوع ثم بحث لا يفقد ما ضيّقه.
const KEYS = ['tab', 'q', 'kind', 'outcome', 'mine', 'dup', 'status'];
const linkOf = (cur, over) => {
  const p = new URLSearchParams();
  for (const k of KEYS) {
    const v = Object.hasOwn(over, k) ? over[k] : cur[k];
    if (v) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '?';
};

const noAccess = (user) => layout({
  user, active: 'events', title: G.events, subtitle: '',
  body: `<div class="card" style="max-width:520px;margin:2rem auto;padding:1.3rem 1.2rem;text-align:center">
    ${icon('megaphone')}
    <div style="font-weight:800;color:var(--ink2);margin-top:.5rem">صلاحيتك لا تشمل الفعاليات</div>
    <div style="font-size:var(--fs-body);color:var(--muted);margin-top:.35rem;line-height:1.8">اطلب من مدير النظام منحك الوصول إن كنت تشارك في فعاليات الشركة.</div>
    <a class="btn" href="/app/home" style="margin-top:1rem">${G.back}</a></div>`,
});

// ═══════════════════════════════════════════════════════════════════════════
// قائمة الفعاليات
// ═══════════════════════════════════════════════════════════════════════════
export async function eventsPage(user, opts = {}) {
  if (!can(user, 'read', 'event')) return noAccess(user);
  const canCreate = can(user, 'create', 'event');
  const status = ['live', 'done'].includes(opts.status) ? opts.status : '';
  const allRows = await listEvents(user, { includeClosed: true });
  const rows = allRows.filter((e) => (
    status === 'live' ? e.status === 'جارية'
      : status === 'done' ? (e.status === 'منتهية' || e.status === 'مُغلقة')
        : true));
  const sums = await Promise.all(rows.map((e) => eventSummary(user, e.id).catch(() => null)));

  const newBtn = canCreate ? `<button type="button" class="btn btn-primary" data-action="ev-new">${icon('plus')} ${G.newEvent}</button>` : '';
  const chip = (key, label) => `<a class="chip${status === key ? ' on' : ''}" href="${esc(linkOf({}, { status: key }))}"${status === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const toolbar = `<div class="toolbar">
    <div class="chips" style="margin-bottom:0" role="group" aria-label="حالة الفعالية">
      ${chip('', G.all)}${chip('live', 'جارية')}${chip('done', 'منتهية')}
    </div>
    <span class="spacer"></span>${newBtn}</div>`;

  const count = (label, v, tone) => `<div><b class="tnum" style="${tone ? `color:${tone}` : ''}">${Number(v) || 0}</b><span>${label}</span></div>`;
  const cardOf = (e, s) => `<a class="card card-h ev-card" href="/app/event/${encodeURIComponent(e.id)}">
    <div class="ev-card-top"><h3>${esc(e.name_ar)}</h3>${statusPill(e.status)}</div>
    <div class="ev-meta">
      <span>${icon('clock')}${fmtRange(e.starts_on, e.ends_on, true)}</span>
      ${e.venue ? `<span>${icon('building')}${esc(e.venue)}</span>` : ''}
    </div>
    <div class="ev-counts">
      ${count('الجهات الملتقطة', s ? s.contacts : 0)}
      ${count('الشراكات', s ? s.partners : 0)}
      ${count('لم تُراجع', s ? s.unreviewed : 0, s && s.unreviewed > 0 ? 'var(--amber)' : '')}
    </div></a>`;

  let list;
  if (rows.length) {
    list = `<div class="ev-grid">${rows.map((e, i) => cardOf(e, sums[i])).join('')}</div>`;
  } else if (!allRows.length) {
    // أول مرة: من يملك الإنشاء يُدعى إليه، ومن لا يملكه يُقال له من يملكه — لا زرٌّ غائب بلا تفسير.
    list = card(`<div class="empty-state">${icon('megaphone')}
      <div class="t">لا فعاليات بعد</div>
      <div class="s">${canCreate ? 'أضِف أوّل فعالية، ثم التقط بطاقات الزوّار من جوّالك في الجناح مباشرة.' : 'لم تُضف فعاليات بعد — يضيفها قائد القطاع أو مدير النظام.'}</div>
      ${newBtn}</div>`);
  } else {
    list = card(`<div class="empty-state">${icon('filter')}
      <div class="t">${status === 'live' ? 'لا فعاليات جارية الآن' : 'لا فعاليات منتهية'}</div>
      <div class="s">${status === 'live' ? `اعرض «${G.all}» لترى القادمة والمنتهية أيضاً.` : `اعرض «${G.all}» لترى الجارية والقادمة أيضاً.`}</div>
      <a class="btn" href="${esc(linkOf({}, { status: '' }))}">${G.all}</a></div>`);
  }

  const newTpl = canCreate ? `<template id="ev-new-tpl">
    <div class="modal-head"><div style="font-weight:800;font-size:15px">${G.newEvent}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>
    <div class="modal-body" style="display:grid;gap:.8rem">
      <div class="field"><label for="evn-name">اسم الفعالية</label><input class="input" id="evn-name" required maxlength="160" placeholder="مثال: معرض التقنية 2026"></div>
      <div class="field"><label for="evn-venue">المكان</label><input class="input" id="evn-venue" maxlength="160" placeholder="مثال: مركز الرياض للمعارض"></div>
      <div class="grid2">
        <div class="field"><label for="evn-start">من تاريخ</label><input class="input" id="evn-start" type="date"></div>
        <div class="field"><label for="evn-end">إلى تاريخ</label><input class="input" id="evn-end" type="date"></div>
      </div>
      <div class="field"><label for="evn-booth">رقم الجناح</label><input class="input" id="evn-booth" maxlength="40" placeholder="اختياري"></div>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn btn-primary" data-action="ev-new-save">إنشاء الفعالية</button>
      <button type="button" class="btn" data-action="modal-close">${G.cancel}</button></div>
  </template>` : '';

  const live = allRows.filter((e) => e.status === 'جارية');
  const subtitle = live.length ? `جارية الآن: ${live.map((e) => e.name_ar).join('، ')}` : 'التقاط البطاقات في الجناح ومتابعتها بعد الفعالية';
  const body = `${CSS}${toolbar}${list}${newTpl}`;
  return layout({ user, active: 'events', title: G.events, subtitle, body, scripts: PAGE_SCRIPT });
}

// ═══════════════════════════════════════════════════════════════════════════
// صفحة الفعالية: التقاط | الجهات الملتقطة
// ═══════════════════════════════════════════════════════════════════════════
export async function eventDetailPage(user, id, opts = {}) {
  if (!can(user, 'read', 'event')) return noAccess(user);
  const ev = await getEvent(user, id); // notFound → صفحة خطأ عربية من الموجّه
  const closed = ev.status === 'مُغلقة';
  const canCapture = can(user, 'create', 'event_contact');
  const captureOpen = canCapture && !closed;
  const summary = await eventSummary(user, ev.id);

  const defaultTab = (captureOpen && (ev.status === 'جارية' || ev.status === 'قادمة')) ? 'capture' : 'contacts';
  const tab = ['capture', 'contacts'].includes(opts.tab) ? opts.tab : defaultTab;
  const cur = { q: String(opts.q || '').trim(), kind: opts.kind, outcome: opts.outcome, mine: opts.mine === '1' ? '1' : '', dup: opts.dup === '1' ? '1' : '' };
  const dates = fmtRange(ev.starts_on, ev.ends_on, true);

  // ── الترويسة ──
  // عدّاد «التقط الفريق اليوم» يظهر مرةً واحدة في الصفحة: تحت نموذج الالتقاط حين يُعرض النموذج
  // (وهو الذي يزيده المتصفّح بعد كل حفظ)، وفي الترويسة فيما عدا ذلك.
  const todayInHeader = !(tab === 'capture' && captureOpen);
  const header = card(`<div style="padding:1rem 1.15rem">
    <div style="font-size:11px;color:var(--muted);font-weight:700"><a href="/app/events" style="color:var(--brand)">${G.events}</a></div>
    <div class="ev-hd"><h2>${esc(ev.name_ar)}</h2>${statusPill(ev.status)}</div>
    <div class="ev-meta">
      <span>${icon('clock')}${dates}</span>
      ${ev.venue ? `<span>${icon('building')}${esc(ev.venue)}</span>` : ''}
      ${ev.booth_no ? `<span>${icon('flag')}جناح <span class="tnum">${esc(ev.booth_no)}</span></span>` : ''}
    </div>
    ${todayInHeader ? `<div class="ev-today">التقط الفريق اليوم: <b class="tnum">${Number(summary.today) || 0}</b></div>` : ''}
  </div>`);

  // ── التبويبات: روابط حقيقية تحفظ بقية المعاملات، لا أزرار تُخفي وتُظهر ──
  const tabLink = (k, label, ic) => `<a role="tab" href="${esc(linkOf({ ...cur, tab }, { tab: k, status: '' }))}" aria-selected="${tab === k ? 'true' : 'false'}" class="${tab === k ? 'on' : ''}"${tab === k ? ' aria-current="page"' : ''}>${icon(ic)} ${label}</a>`;
  const tabs = `<div class="ev-tabs"><div class="seg" role="tablist" aria-label="أقسام الفعالية">
    ${tabLink('capture', G.eventCapture, 'plus')}${tabLink('contacts', G.eventContacts, 'list')}
  </div></div>`;

  const panel = tab === 'capture'
    ? await capturePanel(user, ev, { closed, canCapture, cur })
    : await contactsPanel(user, ev, { summary, cur, captureOpen });

  const embed = JSON.stringify({
    eventId: ev.id,
    me: { id: user.id, name: user.name_ar || user.username || '' },
    kinds: CARD_KINDS,
    closed,
    canCapture: captureOpen,
  }).replace(/</g, '\\u003c');
  const body = `${CSS}${header}${tabs}${panel}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{ev:${embed}});</script>`;
  const subtitle = `${fmtRange(ev.starts_on, ev.ends_on)} · ${ev.status || ''}`;
  return layout({ user, active: 'events', title: ev.name_ar, subtitle, body, scripts: PAGE_SCRIPT });
}

// ── تبويب الالتقاط ─────────────────────────────────────────────────────────
async function capturePanel(user, ev, { closed, canCapture, cur }) {
  const contactsHref = esc(linkOf({ ...cur }, { tab: 'contacts', status: '' }));
  const notice = (msg) => card(`<div style="padding:1.1rem 1.15rem;display:grid;gap:.8rem">
    <div class="alert info">${icon('info')}<div>${msg}</div></div>
    <a class="btn" href="${contactsHref}" style="justify-self:start">${icon('list')} ${G.eventContacts}</a></div>`);
  const panelOpen = (inner) => `<section id="ev-panel-capture" role="tabpanel" aria-label="${G.eventCapture}"><div class="ev-cap">${inner}</div></section>`;

  if (closed) return panelOpen(notice('هذه الفعالية مُغلقة — لا يُلتقط فيها جديد'));
  if (!canCapture) return panelOpen(notice('صلاحيتك للمشاهدة فقط — يمكنك تصفّح ما التُقط دون إضافة'));

  const sectors = await all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL ORDER BY sort_order, name_ar');
  const recent = await recentContacts(user, ev.id, { limit: RECENT_LIMIT });
  const rows = (recent && recent.rows) || [];
  const teamToday = Number(recent && recent.teamToday) || 0;

  const field = (idAttr, label, input) => `<div class="field"><label for="${idAttr}">${label}</label>${input}</div>`;
  const text = (idAttr, ph, extra = '') => `<input class="input" id="${idAttr}" type="text" maxlength="200" autocomplete="off" placeholder="${esc(ph)}"${extra}>`;
  const ltr = ' dir="ltr" style="text-align:left"';

  const form = card(`<div style="padding:1rem 1.15rem">
    <div class="ev-sec-t">التقط بطاقة</div>
    <div class="ev-sec-s">حقل واحد يكفي للحفظ — الباقي يُكمَل لاحقاً عند المراجعة.</div>
    <form id="ev-form" class="ev-form" autocomplete="off" novalidate style="margin-top:.9rem">
      <div class="field"><label>${G.cardKind}</label>
        <div class="chips" role="group" aria-label="${G.cardKind}">
          ${CARD_KINDS.map((k, i) => `<button type="button" class="chip${i === 0 ? ' on' : ''}" data-action="ev-kind" data-kind="${esc(k)}" aria-pressed="${i === 0 ? 'true' : 'false'}">${esc(k)}</button>`).join('')}
        </div>
        <input type="hidden" id="ev-kind" name="kind" value="${esc(CARD_KINDS[0])}"></div>
      ${field('ev-name', 'الاسم', text('ev-name', 'اسم الشخص كما على البطاقة'))}
      ${field('ev-org', 'الجهة', text('ev-org', 'الشركة أو الجهة'))}
      ${field('ev-title', 'المنصب', text('ev-title', 'مثال: مدير المشتريات'))}
      ${field('ev-phone', 'الجوّال', `<input class="input" id="ev-phone" type="tel" inputmode="tel" maxlength="40" autocomplete="off" placeholder="05xxxxxxxx"${ltr}>`)}
      ${field('ev-email', 'البريد', `<input class="input" id="ev-email" type="email" inputmode="email" maxlength="200" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="name@company.com"${ltr}>`)}
      ${field('ev-web', 'الموقع الإلكتروني', `<input class="input" id="ev-web" type="text" inputmode="url" maxlength="200" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="company.com"${ltr}>`)}
      ${field('ev-sector', 'القطاع المعني', `<select id="ev-sector"><option value="">غير محدَّد</option>${sectors.map((s) => `<option value="${esc(s.id)}">${esc(s.name_ar)}</option>`).join('')}</select>`)}
      ${field('ev-note', 'ملاحظة', '<textarea id="ev-note" rows="2" maxlength="2000" placeholder="ما دار في الحديث — سطر يكفي"></textarea>')}
      <div class="ev-paste">
        <label for="ev-paste">${G.pasteCardText}</label>
        <textarea id="ev-paste" rows="4" dir="auto" maxlength="4000" placeholder="الصق نصّ البطاقة هنا"></textarea>
        <div class="ev-hint">صوّر البطاقة بكاميرا الجوّال، ثم حدّد النصّ في الصورة وانسخه والصقه هنا — تُملأ الحقول الفارغة فقط.</div>
        <button type="button" class="btn" data-action="ev-parse">${icon('edit')} ${G.fillFromText}</button>
      </div>
      <div id="ev-dup" class="alert warn" hidden role="status"></div>
      <div id="ev-draft-note" class="alert info" hidden>استعدنا ما كتبته سابقاً</div>
      <button type="button" class="btn btn-primary ev-save" data-action="ev-save">${icon('check')} ${G.saveAndNext}</button>
    </form>
  </div>`);

  const recentRow = (c) => `<div class="ev-rc" data-contact="${esc(c.id)}">
    <div class="ev-rc-main"><b>${esc(contactLabel(c))}</b>${c.org_name && c.person_name ? ` <span class="ev-rc-org">· ${esc(c.org_name)}</span>` : ''}</div>
    <div class="ev-rc-side">${kindPill(c.kind)}${c.possible_duplicate_of ? `<span class="ev-tag">${G.possibleDuplicate}</span>` : ''}<span class="tnum">${esc(hhmm(c.captured_at))}</span></div>
  </div>`;
  const recentCard = card(`<div style="padding:1rem 1.15rem">
    <div class="ev-sec-t">${G.recentCaptures}</div>
    <div id="ev-recent" style="margin-top:.4rem">${rows.length ? rows.map(recentRow).join('')
    : `<div class="empty-state" style="padding:1.4rem 1rem">${icon('inbox')}<div class="t">لم تلتقط شيئاً بعد</div><div class="s">أوّل بطاقة تأخذ نصف دقيقة</div></div>`}</div>
    <div class="ev-team">التقط الفريق اليوم: <span class="tnum" id="ev-team-today">${teamToday}</span></div>
  </div>`);

  return panelOpen(`${form}${recentCard}`);
}

// ── تبويب الجهات الملتقطة ────────────────────────────────────────────────────
async function contactsPanel(user, ev, { summary, cur, captureOpen }) {
  const kind = CARD_KINDS.includes(cur.kind) ? cur.kind : '';
  const outcome = OUTCOMES.includes(cur.outcome) ? cur.outcome : '';
  const q = cur.q;
  const filters = { tab: 'contacts', q, kind, outcome, mine: cur.mine, dup: cur.dup };
  const filtered = !!(q || kind || outcome || cur.mine || cur.dup);
  const rows = await listContacts(user, ev.id, { q, kind, outcome, mine: cur.mine === '1', dup: cur.dup === '1', limit: CONTACTS_LIMIT });

  const stats = `<div class="ev-stats">
    ${statMini('الملتقطة', `<span class="tnum">${Number(summary.contacts) || 0}</span>`, 'كل البطاقات')}
    ${statMini('لم تُراجع', `<span class="tnum">${Number(summary.unreviewed) || 0}</span>`, 'بانتظار قرار', summary.unreviewed > 0 ? 'warn' : '')}
    ${statMini('محتمَلة التكرار', `<span class="tnum">${Number(summary.possibleDup) || 0}</span>`, 'التُقطت مرتين؟', summary.possibleDup > 0 ? 'warn' : '')}
  </div>`;

  const hidden = (k, v) => (v ? `<input type="hidden" name="${k}" value="${esc(v)}">` : '');
  const search = `<form method="get" class="ev-tb" role="search" aria-label="${G.search}">
    <input type="hidden" name="tab" value="contacts">${hidden('kind', kind)}${hidden('outcome', outcome)}${hidden('mine', cur.mine)}${hidden('dup', cur.dup)}
    <input class="input" id="ev-q" name="q" type="search" value="${esc(q)}" placeholder="ابحث بالاسم أو الجهة أو الجوّال" aria-label="${G.search}">
    <button type="submit" class="btn">${icon('search')} ${G.search}</button>
    ${q ? `<a class="btn btn-ghost" href="${esc(linkOf(filters, { q: '' }))}">مسح البحث</a>` : ''}
  </form>`;

  const chipRow = (label, key, values, current) => `<div class="chips" style="margin-bottom:.5rem" role="group" aria-label="${label}"><span class="lbl">${label}</span>
    <a class="chip${!current ? ' on' : ''}" href="${esc(linkOf(filters, { [key]: '' }))}">${G.all}</a>
    ${values.map((v) => `<a class="chip${current === v ? ' on' : ''}" href="${esc(linkOf(filters, { [key]: v }))}"${current === v ? ' aria-current="page"' : ''}>${esc(v)}</a>`).join('')}</div>`;
  const chips = `${chipRow('النوع', 'kind', CARD_KINDS, kind)}${chipRow('المتابعة', 'outcome', OUTCOMES, outcome)}
    <div class="chips" role="group" aria-label="تصفية إضافية">
      <a class="chip${cur.mine ? ' on' : ''}" href="${esc(linkOf(filters, { mine: cur.mine ? '' : '1' }))}"${cur.mine ? ' aria-current="page"' : ''}>${icon('users')} بطاقاتي</a>
      <a class="chip${cur.dup ? ' on' : ''}" href="${esc(linkOf(filters, { dup: cur.dup ? '' : '1' }))}"${cur.dup ? ' aria-current="page"' : ''}>${icon('risk')} محتمَلة التكرار</a>
    </div>`;

  const th = (l) => `<th scope="col">${l}</th>`;
  const row = (c) => `<tr data-contact="${esc(c.id)}">
    <td data-label="الشخص"><div><b>${esc(contactLabel(c))}</b>${c.possible_duplicate_of ? ` <span class="ev-tag">${G.possibleDuplicate}</span>` : ''}</div>${c.job_title ? `<div class="ev-sm">${esc(c.job_title)}</div>` : ''}</td>
    <td data-label="الجهة">${esc(c.org_name || '—')}</td>
    <td data-label="النوع">${kindPill(c.kind)}</td>
    <td data-label="التواصل">${c.phone ? `<div class="ev-ltr tnum">${esc(c.phone)}</div>` : ''}${c.email ? `<div class="ev-ltr ev-sm">${esc(c.email)}</div>` : ''}${!c.phone && !c.email ? '<span class="ev-sm">بلا وسيلة تواصل</span>' : ''}</td>
    <td data-label="التقطها"><div>${esc(c.captured_by_name || '—')}</div><div class="ev-sm tnum">${esc(dayLabel(c.captured_at))} · ${esc(hhmm(c.captured_at))}</div></td>
    <td data-label="المتابعة">${outcomePill(c.outcome)}</td>
  </tr>`;

  const empty = filtered
    ? `<div class="empty-state">${icon('filter')}<div class="t">لا بطاقات تطابق هذه التصفية</div><div class="s">وسّع البحث أو أزل التصفية لترى كل ما التُقط.</div>
        <a class="btn" href="${esc(linkOf({ tab: 'contacts' }, {}))}">${G.all}</a></div>`
    : `<div class="empty-state">${icon('inbox')}<div class="t">لم تُلتقط بطاقات بعد</div><div class="s">${captureOpen ? 'أوّل بطاقة تأخذ نصف دقيقة من جوّالك في الجناح.' : 'ستظهر هنا بطاقات الزوّار حين يلتقطها الفريق.'}</div>
        ${captureOpen ? `<a class="btn btn-primary" href="${esc(linkOf({}, { tab: 'capture' }))}">${G.captureContact}</a>` : ''}</div>`;
  const capNote = rows.length >= CONTACTS_LIMIT ? `<div class="ev-sm" style="padding:.5rem .7rem">تُعرض أوّل <span class="tnum">${CONTACTS_LIMIT}</span> بطاقة — ضيّق البحث لترى البقية.</div>` : '';
  const table = card(`<div class="tblwrap"><table class="rtbl ev-tbl" style="width:100%;border-collapse:collapse;min-width:760px">
    <thead><tr>${th('الشخص')}${th('الجهة')}${th('النوع')}${th('التواصل')}${th('التقطها')}${th('المتابعة')}</tr></thead>
    <tbody>${rows.map(row).join('')}</tbody></table>${rows.length ? capNote : empty}</div>`);

  return `<section id="ev-panel-contacts" role="tabpanel" aria-label="${G.eventContacts}">${stats}${search}${chips}${table}</section>`;
}
