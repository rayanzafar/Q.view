// «صفحتي» — أول شاشة يراها الموظف بعد الدخول.
//
// كان الدخول يهبط على لوحة القيادة أو مركز القطاع أو «مهامي»: ثلاث شاشات تُجيب «كيف حال
// الشركة؟» أو تعرض طابور عملٍ عارياً. ولا واحدة منها تُجيب السؤال الذي يفتح به الموظف المنصة
// صباحاً: **ماذا عليّ اليوم؟**
//
// وثلاثة قرارات تصميم تحكم هذه الصفحة:
//
// ١) **العمق يخدم القراءة لا العكس.** البطاقة العلوية مبنية بعمقٍ حقيقي (منظور + طبقات على
//    محاور Z مختلفة) لأن أول ثانيتين في الشاشة تُبنى فيهما الثقة بالمنتج. لكن كل ما فيها
//    مقروءٌ ساكناً: الميلان زينةٌ تُطفأ عند `prefers-reduced-motion` وعلى اللمس، والمحتوى
//    كاملٌ بلا جافاسكربت أصلاً.
//
// ٢) **التقويم يُقرأ لا يُشغَّل.** شهرٌ واحد، والتنقّل بروابط (`?m=`) واليوم المفتوح بـ`?d=` —
//    فحالة الشاشة في العنوان: تُشارَك، ويرجع إليها زرّ الرجوع، وتعمل بلا سطر جافاسكربت واحد.
//
// ٣) **لا رقم هنا خارج صاحب الصفحة.** كل ما يُعرض يأتي من `myDay()` وهي مقيَّدة بمعرّفه —
//    فلا تحتاج الصفحة بوابة صلاحيات، ولا يمكن أن تتسرّب منها بيانات غيره. وما يقود إلى شاشة
//    أخرى يُعرض رابطاً فقط إن كانت تلك الشاشة مفتوحةً له، فلا وعدَ بشاشة يردّها النظام.
import { layout, gauge, utilStrip, tr } from '../layout.js';
import { icon } from '../icons.js';
import { esc, sarShort } from './_shared.js';
import { pageAllowed } from '../nav.js';
import { MONTHS_AR, WEEKDAYS_AR, WEEKDAYS_AR_1 } from '../../core/i18n/time.js';
import { myDay, monthGrid } from '../../modules/home/home.js';

// ── تسمية صاحب الصفحة ────────────────────────────────────────────────────────
// الاسم الأول وحده في التحية: «أهلاً ياسر» تُقرأ ترحيباً، و«أهلاً د. ياسر صالح الشمري»
// تُقرأ خطاباً رسمياً. واللقب يُنزع لأنه ليس اسماً — لا لأنه لا يُحترم.
const HONORIFIC = /^(?:م|د|أ|المهندس|المهندسة|الدكتور|الدكتورة|الأستاذ|الأستاذة)\.?$/;
function firstName(nameAr) {
  const parts = String(nameAr || '').trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && HONORIFIC.test(parts[0])) parts.shift();
  const first = parts[0] || '';
  // اسمُ حسابٍ لاتيني (حسابات النظام مثلاً) ليس اسماً يُنادى به في تحيةٍ عربية — تُقال التحية
  // بلا اسم بدل أن تُخلط بحرفٍ لاتيني في منتصف الجملة.
  return /[؀-ۿ]/.test(first) ? first : '';
}

const num = (n) => `<span class="tnum">${Number(n) || 0}</span>`;
// تمييز العدد في العربية: مفرد، مثنى، جمع قِلّة (٣–١٠)، ثم مفرد منصوب (١١ فأكثر).
// «موعدان» لا «٢ مواعيد» — العدد يُقال كما يُنطق، وإلا قرأه الموظف ترجمةً آلية.
function countAr(n, { one, two, few, many }) {
  const v = Number(n) || 0;
  if (v === 1) return one;
  if (v === 2) return two;
  const r = v % 100;
  return `${v} ${r >= 3 && r <= 10 ? few : many}`;
}
const DATES = { one: 'موعد واحد', two: 'موعدان', few: 'مواعيد', many: 'موعداً' };
const PROJECTS = { one: 'مشروع واحد', two: 'مشروعان', few: 'مشاريع', many: 'مشروعاً' };
const isoDay = (d) => d.toISOString().slice(0, 10);
const shiftMonth = (y, m, n) => { const d = new Date(Date.UTC(y, m + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

// تاريخ اليوم كما يُقال بالعربية: «الأحد · ١ أغسطس ٢٠٢٦» — الأرقام في خانة الأرقام الموحّدة.
function longDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  return `${WEEKDAYS_AR[d.getUTCDay()]} · ${num(d.getUTCDate())} ${MONTHS_AR[d.getUTCMonth()]} ${num(d.getUTCFullYear())}`;
}
// موعدٌ قصير داخل صف: «١٢ أغسطس»، والسنة تُذكر فقط إن خرجت عن سنة اليوم.
function shortDate(dateStr, today) {
  if (!dateStr) return '';
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = String(dateStr).slice(0, 4) === String(today).slice(0, 4);
  return `${num(d.getUTCDate())} ${MONTHS_AR[d.getUTCMonth()]}${sameYear ? '' : ' ' + num(d.getUTCFullYear())}`;
}

// ── أنواع ما ينتظره ──────────────────────────────────────────────────────────
// لونٌ واحد لكل نوع يسري على النقطة في التقويم وعلى أيقونة الصف — فيُتعلَّم مرة ويُقرأ بعدها
// بلا مفتاح. والأسماء بالعربية دائماً: «مهمة» لا اسم جدولها.
const KIND = {
  task: { ar: 'مهمة', color: '#244A99', ic: 'tasks' },
  milestone: { ar: 'معلم', color: '#C9A227', ic: 'flag' },
  deliverable: { ar: 'مخرج', color: '#834798', ic: 'reports' },
};
// حالة الموعد: نصّها ولونها. «متأخر» تُقال صراحةً — لا لونٌ أحمر بلا كلمة.
const DUE = {
  late: { ar: 'متأخر', bg: '#fee2e2', fg: '#b91c1c' },
  today: { ar: 'اليوم', bg: '#fef3c7', fg: '#92400e' },
  soon: { ar: 'هذا الأسبوع', bg: '#dbeafe', fg: '#1d4ed8' },
  later: { ar: 'لاحقاً', bg: '#f1f5f9', fg: '#475569' },
  none: { ar: 'بلا موعد', bg: '#f1f5f9', fg: '#64748b' },
};
const dueChip = (state, dateStr, today, approx) => {
  const d = DUE[state] || DUE.none;
  const when = dateStr ? shortDate(dateStr, today) : '';
  const label = state === 'later' && when ? when : d.ar;
  return `<span class="pill" style="background:${d.bg};color:${d.fg}">${label}${approx && state !== 'none' ? ' — خلال الشهر' : ''}</span>`;
};

const STYLE = `
/* ── «صفحتي»: العمق ─────────────────────────────────────────────────────────
   الميلان يعمل على المؤشر فقط؛ اللمس ولوحة المفاتيح يريان البطاقة ساكنة وكاملة. */
.hm-hero{perspective:1500px;perspective-origin:50% 38%;margin-bottom:1.05rem}
.hm-tilt{position:relative;transform-style:preserve-3d;transform:rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));
  transition:transform .5s cubic-bezier(.22,.8,.3,1)}
/* القشرة تحمل التدرّج والقصّ — منفصلةً عن الطبقة ثلاثية الأبعاد عمداً: overflow يُسطّح
   preserve-3d فيفقد المحتوى عمقه، فتُعزل كل مسؤولية في عنصرها. */
.hm-skin{position:absolute;inset:0;border-radius:22px;overflow:hidden;
  background:linear-gradient(135deg,#152449 0%,#22407f 44%,#4b2b64 78%,#7a3f8e 100%);
  box-shadow:0 26px 55px -26px rgba(21,36,73,.8),0 10px 22px -16px rgba(122,63,142,.55),0 1px 0 rgba(255,255,255,.12) inset}
.hm-skin::before{content:"";position:absolute;inset:-30%;
  background:radial-gradient(38% 52% at 22% 24%,rgba(96,165,250,.40),transparent 62%),
    radial-gradient(32% 44% at 84% 10%,rgba(201,162,39,.28),transparent 60%),
    radial-gradient(46% 62% at 66% 98%,rgba(168,85,247,.36),transparent 64%)}
.hm-skin::after{content:"";position:absolute;inset:0;
  background:linear-gradient(115deg,transparent 36%,rgba(255,255,255,.14) 48%,transparent 60%),
    radial-gradient(120% 130% at 50% 45%,transparent 42%,rgba(6,12,32,.42) 100%)}
/* أرضية الشبكة: هي ما يجعل العمق مقروءاً — سطحٌ ممتدٌّ تحت المحتوى لا زخرفةً خلفه.
   وخط الأفق فوقها يفصل السطح عن السماء، فيُدرَك البعد بلا أي حركة. */
.hm-floor{position:absolute;inset-inline:-14%;bottom:-12%;height:66%;opacity:.7;
  background-image:linear-gradient(rgba(255,255,255,.16) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.16) 1px,transparent 1px);
  background-size:48px 48px;transform:perspective(540px) rotateX(66deg);transform-origin:50% 100%;
  -webkit-mask-image:linear-gradient(transparent,#000 58%);mask-image:linear-gradient(transparent,#000 58%)}
.hm-floor::before{content:"";position:absolute;inset-inline:22%;top:-1px;height:1px;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);filter:blur(.4px)}
.hm-body{position:relative;padding:1.7rem 1.8rem;display:flex;gap:1.5rem;align-items:center;justify-content:space-between;flex-wrap:wrap;
  transform:translateZ(45px)}
.hm-say{flex:1 1 320px;min-width:0}
.hm-date{display:inline-flex;align-items:center;gap:.4rem;font-size:var(--fs-meta);font-weight:700;color:rgba(255,255,255,.78);
  background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:.24rem .75rem}
.hm-hi{margin:.75rem 0 .35rem;font-size:clamp(1.3rem,2.5vw,2rem);font-weight:800;letter-spacing:-.02em;line-height:1.4;color:#fff}
.hm-sub{margin:0;font-size:var(--fs-ui);color:rgba(255,255,255,.8);max-width:48ch;line-height:1.9}
.hm-quick{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1.05rem}
.hm-q{display:inline-flex;align-items:center;gap:.4rem;font-size:var(--fs-body);font-weight:700;color:#fff;
  background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22);border-radius:11px;padding:.42rem .8rem;
  transition:background .15s,transform .15s}
.hm-q:hover{background:rgba(255,255,255,.24);transform:translateY(-1px)}
.hm-q svg{width:15px;height:15px;opacity:.9}
.hm-panel{position:relative;flex:0 0 auto;transform:translateZ(80px);border-radius:18px;padding:.95rem 1.15rem;min-width:190px;text-align:center;
  background:rgba(255,255,255,.11);border:1px solid rgba(255,255,255,.22);-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);
  box-shadow:0 20px 36px -22px rgba(6,12,30,.9)}
.hm-pt{font-size:var(--fs-micro);font-weight:800;letter-spacing:.04em;color:rgba(255,255,255,.65)}
.hm-ps{font-size:var(--fs-meta);color:rgba(255,255,255,.72);margin-top:.35rem;line-height:1.7}
.hm-big{font-size:2.5rem;font-weight:800;line-height:1.1;color:#fff;letter-spacing:-.03em;margin:.35rem 0 .1rem}

/* ── بطاقات الخلاصة ── */
.hm-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(152px,1fr));gap:.7rem;margin-bottom:1.05rem;perspective:900px}
.hm-tile{position:relative;display:block;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:.9rem 1rem;
  box-shadow:var(--sh-sm);transition:transform .2s cubic-bezier(.22,.8,.3,1),box-shadow .2s,border-color .2s}
.hm-tile:hover{transform:translateY(-4px) rotateX(7deg);border-color:#d6def0;
  box-shadow:0 18px 30px -18px rgba(15,23,42,.34),0 4px 10px -6px rgba(15,23,42,.16)}
.hm-tile::before{content:"";position:absolute;top:0;inset-inline:0;height:3px;border-start-start-radius:16px;border-start-end-radius:16px;
  background:var(--tone,var(--brand))}
.hm-n{font-size:1.7rem;font-weight:800;letter-spacing:-.02em;line-height:1.2;color:var(--tone,var(--ink))}
.hm-l{font-size:var(--fs-meta);color:var(--ink2);font-weight:700;margin-top:.05rem}
.hm-x{font-size:var(--fs-micro);color:var(--faint);margin-top:.1rem}

/* ── الشبكة والبطاقات ── */
.hm-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:1rem;align-items:start}
@media(max-width:1080px){.hm-grid{grid-template-columns:1fr}}
.hm-h{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:var(--pad-card-h);border-bottom:1px solid var(--line)}
.hm-h .t{font-size:var(--fs-title);font-weight:800;color:var(--ink2)}
.hm-h .s{font-size:var(--fs-micro);color:var(--faint);font-weight:600}
.hm-body-p{padding:.35rem 1rem .8rem}
.hm-row{display:flex;align-items:center;gap:.65rem;padding:.5rem 0;border-bottom:1px solid #f2f5fa}
.hm-row:last-child{border-bottom:none}
.hm-kind{flex:0 0 auto;width:27px;height:27px;border-radius:9px;display:grid;place-items:center;color:#fff}
.hm-kind svg{width:15px;height:15px}
.hm-tt{flex:1 1 auto;min-width:0}
.hm-tt .a{display:block;font-size:var(--fs-body);font-weight:700;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hm-tt .b{font-size:var(--fs-micro);color:var(--faint)}
a.hm-tt:hover .a{color:var(--brand)}

/* ── التقويم ── */
.cal-h{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:var(--pad-card-h)}
.cal-nav{display:flex;gap:.3rem}
.cal-nav a{width:29px;height:29px;display:grid;place-items:center;border:1px solid var(--line);border-radius:9px;color:var(--muted);font-weight:800;font-size:13px}
.cal-nav a:hover{background:#f3f6fc;color:var(--ink2);border-color:#d6def0}
.cal-w,.cal-g{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;padding:0 .85rem}
.cal-w>div{text-align:center;font-size:var(--fs-micro);font-weight:800;color:var(--faint);padding-bottom:.3rem}
.cal-d{position:relative;aspect-ratio:1;border-radius:11px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
  font-size:var(--fs-body);font-weight:700;color:var(--ink2);background:#f7f9fd;border:1px solid transparent;
  transition:transform .16s cubic-bezier(.22,.8,.3,1),box-shadow .16s,background .16s}
.cal-d.we{color:var(--faint);background:#fbfcfe}
.cal-d.off{background:transparent}
.cal-d.has{background:#fff;border-color:var(--line);box-shadow:var(--sh-sm)}
.cal-d.has:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 12px 20px -12px rgba(15,23,42,.35);border-color:#c9d3e8}
.cal-d.now{background:var(--brand-grad);color:#fff;border-color:transparent;box-shadow:0 10px 18px -10px rgba(36,74,153,.75)}
.cal-d.sel{outline:2px solid var(--brand);outline-offset:2px}
.cal-dots{display:flex;gap:2px;height:5px;align-items:center}
.cal-dots i{width:5px;height:5px;border-radius:99px;display:block}
.cal-d.now .cal-dots i{box-shadow:0 0 0 1px rgba(255,255,255,.85)}
.cal-lg{display:flex;gap:.8rem;flex-wrap:wrap;padding:.75rem .95rem 0;font-size:var(--fs-micro);color:var(--muted)}
.cal-lg span{display:inline-flex;align-items:center;gap:.3rem}
.cal-lg i{width:7px;height:7px;border-radius:99px}
.cal-day{margin:.8rem .85rem 0;background:#f8fafd;border:1px solid var(--line);border-radius:12px;padding:.6rem .8rem}
.cal-day .h{font-size:var(--fs-meta);font-weight:800;color:var(--ink2);margin-bottom:.3rem}
.cal-e{display:flex;align-items:center;gap:.45rem;padding:.22rem 0;font-size:var(--fs-body);color:var(--ink2)}
.cal-e i{width:7px;height:7px;border-radius:99px;flex:0 0 auto}
.cal-e span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

@media(max-width:640px){
  .hm-body{padding:1.25rem 1.15rem}
  .hm-panel{flex:1 1 100%;min-width:0}
}
@media(prefers-reduced-motion:reduce){
  .hm-tilt,.hm-tile,.cal-d{transition:none}
  .hm-tile:hover,.cal-d.has:hover{transform:none}
}`;

// ── لبنات العرض ──────────────────────────────────────────────────────────────
const cardTop = (title, sub) => `<div class="hm-h"><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;

function tile({ n, label, extra, tone, href }) {
  const inner = `<div class="hm-n" style="--tone:${tone}">${num(n)}</div>
    <div class="hm-l">${label}</div>${extra ? `<div class="hm-x">${extra}</div>` : ''}`;
  return href
    ? `<a class="hm-tile" style="--tone:${tone}" href="${href}">${inner}</a>`
    : `<div class="hm-tile" style="--tone:${tone}">${inner}</div>`;
}

// صفٌّ واحد في «أمامك الآن»: نوعه بلونه، عنوانه، مشروعه، ثم حالة موعده.
function feedRow(e, today, linkable) {
  const k = KIND[e.kind] || KIND.task;
  const body = `<span class="a">${esc(e.title || '')}</span>
    <span class="b">${k.ar}${e.project ? ' · ' + esc(e.project) : ''}</span>`;
  const inner = `<div class="hm-kind" style="background:${k.color}">${icon(k.ic)}</div>
    ${e.href && linkable ? `<a class="hm-tt" href="${e.href}">${body}</a>` : `<div class="hm-tt">${body}</div>`}
    ${dueChip(e.due_state, e.due_date, today, e.approx)}`;
  return `<div class="hm-row">${inner}</div>`;
}

function emptyCard(title, msg, action) {
  return `<div class="empty-state">${icon('check')}
    <div class="t">${title}</div><div class="s">${msg}</div>${action || ''}</div>`;
}

// ── التقويم ──────────────────────────────────────────────────────────────────
// سهما التنقّل رسمٌ لا حرف: علامات الاقتباس الزاوية تنعكس تلقائياً داخل نصٍّ عربي، فيصير
// «السابق» مشيراً إلى الأمام. والرسم لا ينعكس، فيبقى المعنى ثابتاً. والزمن يُقرأ كما يُقرأ
// النص: الماضي إلى اليمين والقادم إلى اليسار — نفس اتجاه كل شريط زمني في المنصة.
const CHEV_BACK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const CHEV_FWD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>';

function calendarCard(grid, selected, monthKey) {
  const prev = shiftMonth(grid.year, grid.month, -1);
  const next = shiftMonth(grid.year, grid.month, 1);
  const link = (m, d) => `/app/home?m=${m}${d ? '&d=' + d : ''}`;

  const cells = grid.cells.map((c) => {
    if (c.blank) return '<div class="cal-d off"></div>';
    const cls = ['cal-d', c.weekend ? 'we' : '', c.events.length ? 'has' : '', c.today ? 'now' : '', c.date === selected ? 'sel' : ''].filter(Boolean).join(' ');
    const dots = c.kinds.length
      ? `<div class="cal-dots">${c.kinds.map((k) => `<i style="background:${(KIND[k] || KIND.task).color}"></i>`).join('')}</div>`
      : '<div class="cal-dots"></div>';
    const inner = `${num(c.day)}${dots}`;
    // اسمٌ مقروء لقارئ الشاشة: رقمُ اليوم وحده يُنطق «١٢» بلا معنى. والاسم يقول اليوم وشهره
    // وكم فيه — وهو نفسه ما يظهر تلميحاً للمؤشر، فلا وصفان مختلفان لشيء واحد.
    const label = `${c.day} ${MONTHS_AR[grid.month]} — ${c.events.length === 1 ? c.events[0].title : countAr(c.events.length, DATES)}`;
    const mark = c.today ? ' aria-current="date"' : '';
    return c.events.length
      ? `<a class="${cls}"${mark} href="${link(monthKey, c.date)}" title="${esc(label)}" aria-label="${esc(label)}">${inner}</a>`
      : `<div class="${cls}"${mark}>${inner}</div>`;
  }).join('');

  const sel = grid.cells.find((c) => !c.blank && c.date === selected);
  const dayPanel = sel && sel.events.length ? `<div class="cal-day">
      <div class="h">${longDate(sel.date)}</div>
      ${sel.events.map((e) => `<div class="cal-e"><i style="background:${(KIND[e.kind] || KIND.task).color}"></i>
        <span>${esc(e.title || '')}${e.project ? ' — ' + esc(e.project) : ''}</span></div>`).join('')}
    </div>` : '';

  return `<div class="card">
    <div class="cal-h">
      <div><div class="t" style="font-size:var(--fs-title);font-weight:800">${esc(MONTHS_AR[grid.month])} ${num(grid.year)}</div>
        <div class="s" style="font-size:var(--fs-micro);color:var(--faint)">${grid.total ? `${esc(countAr(grid.total, DATES))} يخصّك` : 'لا مواعيد لك هذا الشهر'}</div></div>
      <div class="cal-nav">
        <a href="${link(prev)}" title="الشهر السابق" aria-label="الشهر السابق">${CHEV_BACK}</a>
        <a href="${link(next)}" title="الشهر التالي" aria-label="الشهر التالي">${CHEV_FWD}</a>
      </div>
    </div>
    <div class="cal-w">${WEEKDAYS_AR_1.map((d, i) => `<div title="${WEEKDAYS_AR[i]}">${d}</div>`).join('')}</div>
    <div class="cal-g">${cells}</div>
    <div class="cal-lg">${Object.values(KIND).map((k) => `<span><i style="background:${k.color}"></i>${k.ar}</span>`).join('')}</div>
    ${dayPanel}
    <div style="height:.85rem"></div>
  </div>`;
}

// ── الصفحة ───────────────────────────────────────────────────────────────────
export async function homePage(user, opts = {}) {
  const day = await myDay(user);
  const today = day.today;

  // الشهر المعروض واليوم المفتوح — كلاهما من العنوان، فحالة الشاشة قابلة للمشاركة والرجوع.
  const mParam = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(opts.m || '')) ? String(opts.m) : today.slice(0, 7);
  const gy = Number(mParam.slice(0, 4));
  const gm = Number(mParam.slice(5, 7)) - 1;
  const grid = monthGrid(day, { year: gy, month: gm });
  const dParam = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.d || '')) ? String(opts.d) : null;
  // اليوم المفتوح افتراضاً: يومُ اليوم إن كان في الشهر المعروض وفيه موعد، وإلا أول يوم فيه موعد.
  const withEvents = grid.cells.filter((c) => !c.blank && c.events.length);
  const selected = dParam
    || (withEvents.find((c) => c.date === today) ? today : (withEvents[0]?.date || null));

  // ── ما ينتظره: المهام والمعالم والمخرجات في طابور واحد مرتَّب بالموعد ──
  // الفصل بين ثلاث قوائم يجعل الموظف يقارن بنفسه أيّها أقرب. الدمج يقول له الترتيب مباشرةً.
  const canProject = pageAllowed(user, 'projects');
  const canOpp = pageAllowed(user, 'opportunities');
  const feed = [
    // المهمة تُنسب إلى مشروعها أو إلى فرصتها — أيّهما ربطها صاحبها به. ومهمةُ منافسةٍ بلا اسم
    // منافستها صفٌّ لا يُفعَل: «تسليم العرض الفني» لأي منافسة؟
    ...day.tasks.map((t) => ({
      kind: 'task',
      title: t.title,
      project: t.project_name || t.opp_name || null,
      due_date: t.due_date,
      due_state: t.due_state,
      href: t.project_id && canProject ? `/app/project/${t.project_id}`
        : (t.opp_id && canOpp ? `/app/opportunity/${t.opp_id}` : '/app/tasks'),
    })),
    ...day.milestones.map((m) => ({ kind: 'milestone', title: m.name_ar, project: m.project_name, due_date: m.due_date, due_state: m.due_state, href: `/app/project/${m.project_id}` })),
    ...day.deliverables.map((d) => ({ kind: 'deliverable', title: d.name_ar, project: d.project_name, due_date: d.due_date, due_state: d.due_state, approx: true, href: `/app/project/${d.project_id}` })),
  ];
  const rank = { late: 0, today: 1, soon: 2, later: 4, none: 5 };
  const due = feed.filter((e) => ['late', 'today', 'soon'].includes(e.due_state))
    .sort((a, b) => (rank[a.due_state] - rank[b.due_state]) || String(a.due_date).localeCompare(String(b.due_date)));
  const count = (s) => feed.filter((e) => e.due_state === s).length;
  const late = count('late'); const now = count('today'); const week = count('soon');

  const oppValue = day.opportunities.reduce((s, o) => s + (Number(o.value_halalas) || 0), 0);
  const linkable = (kind) => (kind === 'task' ? true : canProject);

  // ── البطاقة العلوية ──
  const g = day.greeting;
  const who = firstName(user.name_ar);
  const util = day.utilization;
  const hasPlan = util.months.some((m) => m > 0);
  // لوحة البطاقة تتبع ما عند الشخص فعلاً: من له خطة تسكين يرى إشغاله، ومن لا خطة له يرى
  // عدّ ما ينتظره اليوم — لا قرصٌ فارغ عند صفر يوحي بأن الرقم انهار.
  const panel = hasPlan
    ? `<div class="hm-panel">
        <div class="hm-pt">إشغالك في ${esc(MONTHS_AR[util.month - 1])}</div>
        <div style="margin:.5rem 0 .25rem">${gauge(util.now, { size: 108, sw: 11, color: util.now > 105 ? '#f87171' : util.now >= 80 ? '#34d399' : '#fbbf24', centerSize: 23, sub: countAr(day.projects.length, PROJECTS) })}</div>
        <div style="padding:0 .1rem">${utilStrip(util.months, util.month)}</div>
        <div class="hm-ps">توزيع وقتك على مدار ${num(util.year)}</div>
      </div>`
    : `<div class="hm-panel">
        <div class="hm-pt">أمامك اليوم</div>
        <div class="hm-big">${num(late + now)}</div>
        <div class="hm-ps">${late + now ? 'بندٌ يستحق وقتك الآن' : 'لا شيء متأخر ولا مستحق اليوم'}</div>
      </div>`;

  const quick = [
    { key: 'tasks', ar: 'مهامي', ic: 'tasks' },
    { key: 'my-opportunities', ar: 'فرصي', ic: 'flag' },
    { key: 'projects', ar: 'المشاريع', ic: 'projects' },
    { key: 'guide', ar: 'دليلي', ic: 'list' },
  ].filter((q) => pageAllowed(user, q.key))
    .map((q) => `<a class="hm-q" href="/app/${q.key}">${icon(q.ic)}<span>${q.ar}</span></a>`).join('');

  const hero = `<section class="hm-hero"><div class="hm-tilt" id="hm-tilt">
    <div class="hm-skin"><div class="hm-floor"></div></div>
    <div class="hm-body">
      <div class="hm-say">
        <div class="hm-date">${longDate(today)}</div>
        <h2 class="hm-hi">${esc(g.hi)}${who ? '، ' + esc(who) : ''}</h2>
        <p class="hm-sub">${esc(g.sub)}</p>
        <div class="hm-quick">${quick}</div>
      </div>
      ${panel}
    </div>
  </div></section>`;

  // ── بطاقات الخلاصة ──
  const tiles = `<div class="hm-tiles">
    ${tile({ n: late, label: 'متأخر عن موعده', extra: late ? 'يبدأ يومك من هنا' : 'لا شيء فاتك', tone: late ? 'var(--red)' : 'var(--faint)', href: '#hm-due' })}
    ${tile({ n: now, label: 'مستحق اليوم', extra: now ? 'يُغلق قبل نهاية الدوام' : 'يومك خالٍ من المواعيد', tone: now ? 'var(--amber)' : 'var(--faint)', href: '#hm-due' })}
    ${tile({ n: week, label: 'خلال أسبوع', extra: 'استعدّ له من الآن', tone: 'var(--blue)' })}
    ${tile({ n: day.projects.length, label: 'مشاريع تعمل فيها', extra: day.employee ? 'حسب تسكينك' : 'لا تسكين مسجَّل', tone: 'var(--brand2)', href: canProject ? '/app/projects' : null })}
    ${tile({ n: day.opportunities.length, label: 'فرص تملكها', extra: oppValue ? `بقيمة ${sarShort(oppValue)}` : 'لا قيمة مسجَّلة', tone: 'var(--green)', href: canOpp ? '/app/my-opportunities' : null })}
  </div>`;

  // ── أمامك الآن ──
  const dueCard = `<div class="card" id="hm-due">
    ${cardTop('أمامك الآن', due.length > 12 ? `أقرب ${num(12)} من ${num(due.length)}` : '')}
    <div class="hm-body-p">${due.length
    ? due.slice(0, 12).map((e) => feedRow(e, today, linkable(e.kind))).join('')
    : emptyCard('لا شيء متأخر ولا مستحق هذا الأسبوع',
      'كل ما هو مسنَد إليك ضمن موعده. تابع مشاريعك أو راجع فرصك.',
      pageAllowed(user, 'tasks') ? '<a class="btn btn-sm" href="/app/tasks">فتح مهامي</a>' : '')}</div>
  </div>`;

  // ── فرصي ──
  const oppCard = day.opportunities.length ? `<div class="card" style="margin-top:1rem">
    ${cardTop('فرصك المفتوحة', `بقيمة ${sarShort(oppValue)}`)}
    <div class="hm-body-p">${day.opportunities.slice(0, 6).map((o) => {
    const body = `<span class="a">${esc(o.title_ar)}</span>
        <span class="b">${esc(o.client_name || 'بلا جهة')}${o.stage_name ? ' · ' + esc(o.stage_name) : ''}</span>`;
    return `<div class="hm-row">
        <div class="hm-kind" style="background:var(--green)">${icon('flag')}</div>
        ${canOpp ? `<a class="hm-tt" href="/app/opportunity/${o.id}">${body}</a>` : `<div class="hm-tt">${body}</div>`}
        <b class="tnum" style="flex:0 0 auto;font-size:var(--fs-body);color:var(--ink2)">${sarShort(o.value_halalas || 0)}</b>
      </div>`;
  }).join('')}</div>
  </div>` : '';

  // ── مشاريعي ──
  const projCard = day.projects.length ? `<div class="card" style="margin-top:1rem">
    ${cardTop('مشاريع تعمل فيها', esc(countAr(day.projects.length, PROJECTS)))}
    <div class="hm-body-p">${day.projects.slice(0, 8).map((p) => {
    const body = `<span class="a">${esc(p.name_ar)}</span>
        <span class="b">${esc(p.client_name || 'بلا جهة')} · ${esc(tr(p.status) || '')}</span>`;
    const tone = { RED: 'var(--red)', AMBER: 'var(--amber)', GREEN: 'var(--green)' }[p.rag] || 'var(--faint)';
    return `<div class="hm-row">
        <div class="hm-kind" style="background:${tone}">${icon('projects')}</div>
        ${canProject ? `<a class="hm-tt" href="/app/project/${p.id}">${body}</a>` : `<div class="hm-tt">${body}</div>`}
        ${p.rag ? `<span class="pill" style="background:#f1f5f9;color:var(--muted)">${esc(tr(p.rag))}</span>` : ''}
      </div>`;
  }).join('')}</div>
  </div>` : '';

  // العمودان يوزَّعان بالارتفاع لا بالنوع: «مشاريعك» تحت التقويم لأن العمود الرئيسي يحمل
  // الطابور والفرص، فلو جُمعت الثلاثة فيه لبقي تحت التقويم فراغٌ بطول الصفحة.
  const body = `${hero}${tiles}
  <div class="hm-grid">
    <div>${dueCard}${oppCard}</div>
    <div>${calendarCard(grid, selected, mParam)}${projCard}</div>
  </div>`;

  return layout({
    user,
    active: 'home',
    title: 'صفحتي',
    subtitle: `${esc(g.weekday)} · ما يخصّك أنت`,
    body,
    extraHead: `<style>${STYLE}</style>`,
    scripts: ['/static/pages/home.js'],
  });
}
