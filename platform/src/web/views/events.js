// «الفعاليات» — E1: قائمة الفعاليات، وصفحة الفعالية بتبويبَي الالتقاط والجهات الملتقطة.
// E2: صورة البطاقة تُلتقط بالكاميرا وتُقرأ **داخل المتصفح** (القارئ المورَّد في vendor/)، وتُرفع
//     مع البطاقة بعد حفظها؛ وتبويب «رمز QR للزوّار» يعرض رموز الفعالية ملء الشاشة في الجناح.
//
// الالتقاط نموذجٌ **على الصفحة** لا نافذة: من يقف في جناح المعرض يمسك الجوّال بيدٍ واحدة
// ويلتقط بطاقةً تلو بطاقة، والنافذة المنبثقة على الجوّال تُغلق بالخطأ وتضيع ما كُتب.
// الحقول كبيرة (١٦ بكسل كي لا يقرّب iOS الشاشة، و٤٤ بكسل ارتفاعاً للإبهام)، وزرّ الحفظ في
// أسفل البطاقة نفسها. وما يُكتب يُحفظ مسودةً في المتصفح (pages/events.js) فلا يضيع بانقطاع
// الشبكة أو انطفاء الشاشة. الصورة لا تُحفظ في المسودة (كبيرة، وتُلتقط من جديد في ثوانٍ).
//
// القراءة هنا للعرض فقط عبر خدمة الفعاليات؛ كل كتابة تمرّ من مسارات الخدمة.
import { layout, card, pill } from '../layout.js';
import { esc, statMini } from './_shared.js';
import { icon } from '../icons.js';
import { G } from '../i18n/glossary.js';
import { all } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { MONTHS_AR, RIYADH_OFFSET_HOURS } from '../../core/i18n/time.js';
import * as EVS from '../../modules/events/events.js';
import { meetingsPanel } from './events-meetings.js';

const {
  CARD_KINDS, OUTCOMES, listEvents, getEvent, eventSummary, listContacts, recentContacts, listQr,
} = EVS;

// ترتيب الملفّين مقصود: مُحمِّل القارئ أولاً (يعرّف window.Tesseract) ثم شيفرة الصفحة التي
// تسأل عنه. كلاهما من أصل سند ويمرّ ببصمة النسخة في layout (asset()).
const PAGE_SCRIPT = ['/static/pages/events.js'];
// منتقي المدعوين (picker.js) قبل شيفرة الصفحة — الترتيب ترتيب التحميل (asset() في layout).
const DETAIL_SCRIPTS = ['/static/vendor/tesseract-5.1.1/tesseract.min.js', '/static/pages/picker.js', '/static/pages/events.js'];
const CONTACTS_LIMIT = 200;
const RECENT_LIMIT = 8;
const TABS = ['capture', 'contacts', 'meetings', 'qr'];

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
// «٢٧ أغسطس · ١٠:٤٢» — وإن غاب الختم فلا فاصلةٌ يتيمة.
const whenLabel = (iso) => [dayLabel(iso), hhmm(iso)].filter(Boolean).map(esc).join(' · ');

// اسم البطاقة كما يُقرأ في القوائم: الشخص، وإلا الجهة، وإلا الجوّال — ولا يُترك فراغ.
const contactLabel = (c) => c.person_name || c.org_name || c.phone || 'بطاقة بلا اسم';

// ── صورة البطاقة: عنوانها يحمل بصمتها كي تتجدّد الصورة المخبَّأة حين تُستبدل ──
const photoUrl = (c) => {
  const sha = String(c.photo_sha || '').slice(0, 12);
  return `/api/events/contacts/${encodeURIComponent(c.id)}/photo${sha ? `?v=${encodeURIComponent(sha)}` : ''}`;
};
const hasPhoto = (c) => Number(c.has_photo) === 1;
const thumb = (c) => `<img class="ev-thumb" loading="lazy" alt="" src="${esc(photoUrl(c))}">`;

const CSS = `<style>
.ev-page [hidden],.ev-form [hidden]{display:none!important}
.ev-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.9rem}
.ev-card{display:block;padding:1rem 1.1rem;color:inherit}
.ev-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:.6rem}
.ev-card-top h2{font-size:var(--fs-title);line-height:1.5;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
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
.ev-nav{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;margin:.9rem 0}
.seg a{font-size:12px;font-weight:700;color:var(--muted);padding:.35rem .7rem;border-radius:8px;display:flex;align-items:center;gap:.35rem;flex:0 0 auto}
.seg a.on{background:#fff;color:var(--ink2);box-shadow:var(--sh-sm)}
.seg a:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
/* minmax(0,1fr) لا عموداً ضمنياً: العمود الضمني يتّسع لأعرض محتوًى أدنى في بنوده — وصفّ «آخر ما
   التقطت» اسمُه سطرٌ واحد لا يُكسر، فكان يمدّد العمود ٤٣٠ بكسل على جوّالٍ عرضه ٣٩٠. */
.ev-cap{display:grid;grid-template-columns:minmax(0,1fr);gap:.9rem;max-width:640px}
.ev-cap>*{min-width:0}
.ev-form{display:grid;gap:.8rem}
.ev-form .input,.ev-form select,.ev-form textarea{font-size:16px;min-height:44px;padding:.55rem .75rem}
.ev-form textarea{min-height:64px;line-height:1.6}
.ev-form .chips{margin-bottom:0}
.ev-form .chip{min-height:40px}
.ev-form .ev-auto{background:#fffbeb;border-color:#fde68a}
.ev-form .lbl{font-size:var(--fs-meta);font-weight:700;color:var(--muted)}
.ev-x{min-width:40px;min-height:40px;justify-content:center}
.ev-photo{display:grid;gap:.55rem;border:1px dashed var(--line);border-radius:12px;padding:.8rem;background:var(--bg)}
.ev-photo-btn{justify-content:center;min-height:52px;font-size:var(--fs-ui);font-weight:800}
#ev-photo-prev{display:block;max-height:120px;max-width:100%;width:auto;border-radius:10px;border:1px solid var(--line);background:#fff;justify-self:start}
.ev-photo-row{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;font-size:var(--fs-meta);color:var(--muted)}
.ev-photo-row .btn{min-height:40px}
.ev-ocr{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.ev-ocr .btn{min-height:40px}
[data-ocr-state]{background:#f1f5f9;color:#475569;white-space:normal;line-height:1.5;text-align:start}
[data-ocr-state="loading"],[data-ocr-state="reading"]{background:#dbeafe;color:#244A99}
[data-ocr-state="ready"],[data-ocr-state="done"]{background:#dcfce7;color:#047857}
[data-ocr-state="timeout"],[data-ocr-state="failed"]{background:#fef3c7;color:#92400e}
.ev-paste{display:grid;gap:.4rem;border:1px dashed var(--line);border-radius:12px;padding:.7rem .8rem;background:var(--bg)}
.ev-paste>label{font-size:var(--fs-meta);font-weight:700;color:var(--muted)}
.ev-paste .ev-hint{font-size:var(--fs-meta);color:var(--muted);line-height:1.8}
.ev-paste .btn{justify-self:start;min-height:40px}
#ev-paste:placeholder-shown{direction:rtl}
.ev-save{width:100%;justify-content:center;min-height:48px;font-size:var(--fs-ui);font-weight:800}
.ev-sec-t{font-size:var(--fs-title);font-weight:800;color:var(--ink2)}
.ev-sec-s{font-size:var(--fs-meta);color:var(--muted);margin-top:.1rem}
.ev-rc{padding:.5rem 0;border-bottom:1px dashed var(--line);font-size:var(--fs-body);min-width:0}
.ev-rc:last-child{border-bottom:0}
.ev-rc-row{display:flex;align-items:center;gap:.6rem;min-width:0}
.ev-rc-main{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ev-rc-main b{color:var(--ink2)}
.ev-rc-org{color:var(--muted)}
.ev-rc-side{display:inline-flex;align-items:center;gap:.4rem;flex:0 0 auto}
.ev-rc-side .tnum{color:var(--muted);font-size:var(--fs-meta)}
.ev-rc-ph{flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-width:44px}
.ev-thumb{width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid var(--line);background:#fff;display:block}
.ev-nophoto{font-size:var(--fs-micro);color:var(--faint);white-space:nowrap}
.ev-rc-ph .btn{min-height:40px;font-size:var(--fs-micro);padding:.3rem .5rem;white-space:nowrap}
.ev-rc-warn{margin-top:.35rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;font-size:var(--fs-meta);color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:.35rem .6rem}
.ev-rc-warn .btn{min-height:36px;font-size:var(--fs-micro)}
.ev-tag{display:inline-block;padding:.12rem .45rem;border-radius:999px;font-size:var(--fs-micro);font-weight:800;background:#fef3c7;color:#92400e;white-space:nowrap}
.ev-team{margin-top:.6rem;padding-top:.6rem;border-top:1px solid var(--line);font-size:var(--fs-body);color:var(--muted)}
.ev-tb{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:.8rem}
.ev-tb .input{flex:1 1 240px;min-height:40px}
.ev-stats{display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:.8rem}
.ev-tbl th{padding:.5rem .7rem;font-weight:700;font-size:10.5px;color:var(--muted);text-align:start}
.ev-tbl td{padding:.55rem .7rem;border-top:1px solid var(--line);font-size:var(--fs-body);vertical-align:top}
.ev-sm{font-size:var(--fs-meta);color:var(--muted)}
.ev-ltr{direction:ltr;text-align:right;unicode-bidi:isolate;overflow-wrap:anywhere}
.ev-qr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.9rem;margin-bottom:.9rem}
.ev-qr-card{padding:.9rem 1rem;display:grid;gap:.6rem;justify-items:center;text-align:center}
.ev-qr-card h3{font-size:var(--fs-ui);line-height:1.5}
.ev-qr-card img{width:160px;height:160px;object-fit:contain;border:1px solid var(--line);border-radius:10px;background:#fff}
.ev-qr-act{display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center}
.ev-qr-act .btn{min-height:40px}
.ev-kiosk{position:fixed;inset:0;z-index:300;background:#fff;display:flex;flex-direction:column;align-items:center;overflow:auto}
.ev-kiosk-bar{width:100%;height:10px;background:var(--brand-grad);flex:none}
.ev-kiosk-x{position:absolute;top:1rem;inset-inline-start:1rem;min-width:44px;min-height:44px;justify-content:center;font-size:18px}
.ev-kiosk-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;padding:2rem 1rem;text-align:center;width:100%}
.ev-kiosk-ev{font-size:var(--fs-page);font-weight:800;color:var(--ink2)}
.ev-kiosk-body h2{font-size:22px;color:var(--brand)}
.ev-kiosk-body img{width:min(72vmin,540px);max-width:92vw;height:auto;display:block}
.ev-kiosk-hint{font-size:18px;color:var(--muted);font-weight:700}
@media(max-width:640px){
  .ev-counts b{font-size:var(--fs-ui)}
  .ev-stats>.card{flex:1 1 30%;min-width:0!important}
  .seg a{min-height:40px}
  .chip,.toolbar .btn,.ev-tb .btn{min-height:40px}
  .ev-tb .input{font-size:16px;min-height:44px}
}
</style>`;

// روابط التصفية تحفظ بقية المعاملات: من ضيّق النوع ثم بحث لا يفقد ما ضيّقه.
const KEYS = ['tab', 'q', 'kind', 'outcome', 'mine', 'dup', 'status', 'scope'];
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
    <div class="ev-card-top"><h2>${esc(e.name_ar)}</h2>${statusPill(e.status)}</div>
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
    <div class="modal-head"><div id="evn-title" style="font-weight:800;font-size:15px">${G.newEvent}</div>
      <button type="button" class="btn btn-ghost btn-sm ev-x" data-action="modal-close" aria-label="إغلاق">✕</button></div>
    <div class="modal-body ev-form">
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
  const body = `${CSS}<div class="ev-page">${toolbar}${list}${newTpl}</div>`;
  return layout({ user, active: 'events', title: G.events, subtitle, body, scripts: PAGE_SCRIPT });
}

// ═══════════════════════════════════════════════════════════════════════════
// صفحة الفعالية: التقاط | الجهات الملتقطة | رمز QR للزوّار
// ═══════════════════════════════════════════════════════════════════════════
export async function eventDetailPage(user, id, opts = {}) {
  if (!can(user, 'read', 'event')) return noAccess(user);
  const ev = await getEvent(user, id); // notFound → صفحة خطأ عربية من الموجّه
  const closed = ev.status === 'مُغلقة';
  const canCapture = can(user, 'create', 'event_contact');
  const canManage = can(user, 'update', 'event');
  const captureOpen = canCapture && !closed;
  const summary = await eventSummary(user, ev.id);
  const qr = await listQr(user, ev.id);

  const defaultTab = (captureOpen && (ev.status === 'جارية' || ev.status === 'قادمة')) ? 'capture' : 'contacts';
  const tab = TABS.includes(opts.tab) ? opts.tab : defaultTab;
  const cur = { q: String(opts.q || '').trim(), kind: opts.kind, outcome: opts.outcome, mine: opts.mine === '1' ? '1' : '', dup: opts.dup === '1' ? '1' : '', scope: opts.scope === 'all' ? 'all' : '' };
  const dates = fmtRange(ev.starts_on, ev.ends_on, true);

  // ── الترويسة (عنوان الصفحة h1 في شريط layout؛ اسم الفعالية هنا h2 — عنوانٌ رئيسي واحد) ──
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
  const tabLink = (k, label, ic) => `<a href="${esc(linkOf({ ...cur, tab }, { tab: k, status: '' }))}" class="${tab === k ? 'on' : ''}"${tab === k ? ' aria-current="page"' : ''}>${icon(ic)} ${label}</a>`;
  const tabs = `<nav class="ev-nav" aria-label="أقسام الفعالية"><div class="seg">
    ${tabLink('capture', G.eventCapture, 'plus')}${tabLink('contacts', G.eventContacts, 'list')}${tabLink('meetings', G.eventMeetings, 'clock')}${tabLink('qr', G.eventQr, 'portfolio')}
  </div></nav>`;

  // بيانات الاجتماعات تُضمَّن مع تبويبها وحده — قائمة الأشخاص ثقلٌ لا يلزم تبويب الالتقاط.
  let meetings = null;
  const panel = tab === 'capture'
    ? await capturePanel(user, ev, { closed, canCapture, cur })
    : tab === 'qr'
      ? qrPanel(ev, { qr, canManage })
      : tab === 'meetings'
        ? (meetings = await meetingsPanel(user, ev, { cur, closed, link: (over) => linkOf({ ...cur, tab }, over) })).html
        : await contactsPanel(user, ev, { summary, cur, captureOpen });

  const embed = JSON.stringify({
    eventId: ev.id,
    name: ev.name_ar || '',
    me: { id: user.id, name: user.name_ar || user.username || '' },
    kinds: CARD_KINDS,
    closed,
    canCapture: captureOpen,
    canManage,
    qr: qr.map((b) => ({ id: b.id, title: b.title || '' })),
    ...(meetings ? { mt: meetings.mt } : {}),
  }).replace(/</g, '\\u003c');
  const body = `${CSS}<div class="ev-page">${header}${tabs}${panel}</div>
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{ev:${embed}});</script>`;
  const subtitle = `${fmtRange(ev.starts_on, ev.ends_on)} · ${ev.status || ''}`;
  return layout({ user, active: 'events', title: ev.name_ar, subtitle, body, scripts: DETAIL_SCRIPTS });
}

// ── تبويب الالتقاط ─────────────────────────────────────────────────────────
async function capturePanel(user, ev, { closed, canCapture, cur }) {
  const contactsHref = esc(linkOf({ ...cur }, { tab: 'contacts', status: '' }));
  const notice = (msg) => card(`<div style="padding:1.1rem 1.15rem;display:grid;gap:.8rem">
    <div class="alert info">${icon('info')}<div>${msg}</div></div>
    <a class="btn" href="${contactsHref}" style="justify-self:start">${icon('list')} ${G.eventContacts}</a></div>`);
  const panelOpen = (inner) => `<section id="ev-panel-capture" aria-label="${G.eventCapture}"><div class="ev-cap">${inner}</div></section>`;

  if (closed) return panelOpen(notice('هذه الفعالية مُغلقة — لا يُلتقط فيها جديد'));
  if (!canCapture) return panelOpen(notice('صلاحيتك للمشاهدة فقط — يمكنك تصفّح ما التُقط دون إضافة'));

  const sectors = await all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL ORDER BY sort_order, name_ar');
  const recent = await recentContacts(user, ev.id, { limit: RECENT_LIMIT });
  const rows = (recent && recent.rows) || [];
  const teamToday = Number(recent && recent.teamToday) || 0;

  const field = (idAttr, label, input) => `<div class="field"><label for="${idAttr}">${label}</label>${input}</div>`;
  const text = (idAttr, ph, extra = '') => `<input class="input" id="${idAttr}" type="text" maxlength="200" autocomplete="off" placeholder="${esc(ph)}"${extra}>`;
  const ltr = ' dir="ltr" style="text-align:left"';

  // ── الصورة: زرٌّ كبير يفتح الكاميرا مباشرة، ومعاينة صغيرة، وحالة القارئ بكلماتٍ لا برموز ──
  const photoBlock = `<div class="ev-photo" id="ev-photo-block">
    <button type="button" class="btn btn-primary ev-photo-btn" data-action="ev-photo-pick">صوّر البطاقة</button>
    <input type="file" id="ev-photo" accept="image/*" capture="environment" hidden aria-label="صورة البطاقة">
    <img id="ev-photo-prev" alt="" hidden>
    <div class="ev-photo-row">
      <span id="ev-photo-meta">بلا صورة</span>
      <button type="button" class="btn btn-sm" data-action="ev-photo-retake" hidden>إعادة الالتقاط</button>
      <button type="button" class="btn btn-sm btn-ghost" data-action="ev-photo-clear" hidden>بلا صورة</button>
    </div>
    <div class="ev-ocr">
      <span class="pill" data-ocr-status data-ocr-state="off" role="status">القارئ غير مجهَّز</span>
      <button type="button" class="btn btn-sm" data-action="ev-ocr-warm">جهّز القارئ</button>
    </div>
  </div>`;

  const form = card(`<div style="padding:1rem 1.15rem">
    <h3 class="ev-sec-t">التقط بطاقة</h3>
    <div class="ev-sec-s">حقل واحد يكفي للحفظ — الباقي يُكمَل لاحقاً عند المراجعة.</div>
    <form id="ev-form" class="ev-form" autocomplete="off" novalidate style="margin-top:.9rem">
      <div class="field"><span class="lbl">${G.cardKind}</span>
        <div class="chips" role="group" aria-label="${G.cardKind}">
          ${CARD_KINDS.map((k, i) => `<button type="button" class="chip${i === 0 ? ' on' : ''}" data-action="ev-kind" data-kind="${esc(k)}" aria-pressed="${i === 0 ? 'true' : 'false'}">${esc(k)}</button>`).join('')}
        </div>
        <input type="hidden" id="ev-kind" name="kind" value="${esc(CARD_KINDS[0])}"></div>
      ${photoBlock}
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
        <div class="ev-hint">صوّر البطاقة فيقرأها القارئ ويملأ الحقول الفارغة، أو حدّد النصّ في صورة الكاميرا وانسخه والصقه هنا.</div>
        <button type="button" class="btn" data-action="ev-parse">${icon('edit')} ${G.fillFromText}</button>
      </div>
      <div id="ev-dup" class="alert warn" hidden role="status"></div>
      <div id="ev-draft-note" class="alert info" hidden role="status">استعدنا ما كتبته سابقاً</div>
      <button type="submit" class="btn btn-primary ev-save" data-action="ev-save">${icon('check')} ${G.saveAndNext}</button>
    </form>
  </div>`);

  // صفّ «آخر ما التقطت»: صورة مصغّرة أو «بلا صورة»، وصاحب البطاقة وحده يرى زرّ الإرفاق.
  const own = (c) => c.captured_by === user.id;
  const photoCell = (c) => (hasPhoto(c) ? thumb(c)
    : own(c) ? `<button type="button" class="btn btn-ghost" data-action="ev-photo-attach" data-cid="${esc(c.id)}">أرفق صورة</button>`
      : '<span class="ev-nophoto">بلا صورة</span>');
  const recentRow = (c) => `<div class="ev-rc" data-contact="${esc(c.id)}"${own(c) ? ' data-own="1"' : ''}>
    <div class="ev-rc-row">
      <div class="ev-rc-ph">${photoCell(c)}</div>
      <div class="ev-rc-main"><b>${esc(contactLabel(c))}</b>${c.org_name && c.person_name ? ` <span class="ev-rc-org">· ${esc(c.org_name)}</span>` : ''}</div>
      <div class="ev-rc-side">${kindPill(c.kind)}${c.possible_duplicate_of ? `<span class="ev-tag">${G.possibleDuplicate}</span>` : ''}${hhmm(c.captured_at) ? `<span class="tnum">${esc(hhmm(c.captured_at))}</span>` : ''}</div>
    </div>
  </div>`;
  const recentCard = card(`<div style="padding:1rem 1.15rem">
    <h3 class="ev-sec-t">${G.recentCaptures}</h3>
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

  // كل خلية تحمل عنصراً واحداً: على الجوال تصير الخلية سطراً (عنوان العمود ⟷ القيمة)،
  // والعنصر الواحد يحفظ المحاذاة مهما تعدّدت الأسطر داخله.
  const th = (l) => `<th scope="col">${l}</th>`;
  const row = (c) => `<tr data-contact="${esc(c.id)}">
    <td data-label="الشخص"><div><b>${esc(contactLabel(c))}</b>${c.possible_duplicate_of ? ` <span class="ev-tag">${G.possibleDuplicate}</span>` : ''}${c.job_title ? `<div class="ev-sm">${esc(c.job_title)}</div>` : ''}</div></td>
    <td data-label="الصورة"><div>${hasPhoto(c) ? thumb(c) : '<span class="ev-sm">—</span>'}</div></td>
    <td data-label="الجهة"><div>${esc(c.org_name || '—')}</div></td>
    <td data-label="النوع"><div>${kindPill(c.kind)}</div></td>
    <td data-label="التواصل"><div>${c.phone ? `<div class="ev-ltr tnum">${esc(c.phone)}</div>` : ''}${c.email ? `<div class="ev-ltr ev-sm">${esc(c.email)}</div>` : ''}${!c.phone && !c.email ? '<span class="ev-sm">بلا وسيلة تواصل</span>' : ''}</div></td>
    <td data-label="التقطها"><div>${esc(c.captured_by_name || '—')}${whenLabel(c.captured_at) ? `<div class="ev-sm tnum">${whenLabel(c.captured_at)}</div>` : ''}</div></td>
    <td data-label="المتابعة"><div>${outcomePill(c.outcome)}</div></td>
  </tr>`;

  const empty = filtered
    ? `<div class="empty-state">${icon('filter')}<div class="t">لا بطاقات تطابق هذه التصفية</div><div class="s">وسّع البحث أو أزل التصفية لترى كل ما التُقط.</div>
        <a class="btn" href="${esc(linkOf({ tab: 'contacts' }, {}))}">${G.all}</a></div>`
    : `<div class="empty-state">${icon('inbox')}<div class="t">لم تُلتقط بطاقات بعد</div><div class="s">${captureOpen ? 'أوّل بطاقة تأخذ نصف دقيقة من جوّالك في الجناح.' : 'ستظهر هنا بطاقات الزوّار حين يلتقطها الفريق.'}</div>
        ${captureOpen ? `<a class="btn btn-primary" href="${esc(linkOf({}, { tab: 'capture' }))}">${G.captureContact}</a>` : ''}</div>`;
  const capNote = rows.length >= CONTACTS_LIMIT ? `<div class="ev-sm" style="padding:.5rem .7rem">تُعرض أوّل <span class="tnum">${CONTACTS_LIMIT}</span> بطاقة — ضيّق البحث لترى البقية.</div>` : '';
  const table = card(`<div class="tblwrap"><table class="rtbl ev-tbl" style="width:100%;border-collapse:collapse;min-width:820px">
    <thead><tr>${th('الشخص')}${th('الصورة')}${th('الجهة')}${th('النوع')}${th('التواصل')}${th('التقطها')}${th('المتابعة')}</tr></thead>
    <tbody>${rows.map(row).join('')}</tbody></table>${rows.length ? capNote : empty}</div>`);

  return `<section id="ev-panel-contacts" aria-label="${G.eventContacts}">${stats}${search}${chips}${table}</section>`;
}

// ── تبويب رمز QR للزوّار ───────────────────────────────────────────────────────
// الرمز صورةٌ يرفعها من يدير الفعالية (استبيان، صفحة تسجيل، ملفّ الشركة…) ويعرضها الجناح
// ملء الشاشة على جهازٍ لوحي. الرفع والحذف يعيدان تحميل الصفحة — لا حالة معلّقة هنا.
function qrPanel(ev, { qr, canManage }) {
  const eid = encodeURIComponent(ev.id);
  const cardOf = (b) => `<div class="card ev-qr-card" data-bid="${esc(b.id)}" data-title="${esc(b.title || '')}">
    <h3>${esc(b.title || 'رمز بلا عنوان')}</h3>
    <img src="/api/events/${eid}/qr/${encodeURIComponent(b.id)}" alt="${esc(b.title || 'رمز')}">
    <div class="ev-qr-act">
      <button type="button" class="btn btn-primary" data-action="ev-qr-show" data-bid="${esc(b.id)}">اعرضه للزوّار</button>
      ${canManage ? `<button type="button" class="btn btn-ghost" data-action="ev-qr-del" data-bid="${esc(b.id)}">حذف</button>` : ''}
    </div>
  </div>`;

  const grid = qr.length ? `<div class="ev-qr-grid">${qr.map(cardOf).join('')}</div>`
    : card(`<div class="empty-state">${icon('portfolio')}
      <div class="t">لا رموز بعد</div>
      <div class="s">${canManage ? 'ارفع صورة رمز QR (استبيان الزوّار أو صفحة التسجيل) ليعرضه الفريق في الجناح ملء الشاشة.' : 'يرفع الرموز من يدير الفعالية — وستظهر هنا لعرضها في الجناح.'}</div>
    </div>`);

  const upload = canManage ? card(`<div style="padding:1rem 1.15rem">
    <h3 class="ev-sec-t">أضف رمزاً</h3>
    <div class="ev-sec-s">صورة واضحة للرمز بأي مقاس — تُعرض كما هي.</div>
    <div class="ev-form" style="margin-top:.9rem;max-width:520px">
      <div class="field"><label for="ev-qr-title">عنوان الرمز</label><input class="input" id="ev-qr-title" maxlength="80" placeholder="مثال: استبيان الزوّار"></div>
      <input type="file" id="ev-qr-file" accept="image/*" hidden aria-label="صورة الرمز">
      <button type="button" class="btn btn-primary" data-action="ev-qr-pick" style="justify-self:start;min-height:44px">${icon('upload')} ارفع صورة الرمز</button>
    </div>
  </div>`) : '';

  return `<section id="ev-panel-qr" aria-label="${G.eventQr}"><div class="ev-cap" style="max-width:none">${grid}${upload}</div></section>`;
}
