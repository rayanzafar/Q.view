// ═══ «مركز القطاع» — شاشةٌ واحدة تُرسم في المتصفّح من حمولةٍ واحدة (v6.10) ═══════════════
//
// الشاشة: شريط مرشِّحاتٍ ذكي (أشهرٌ تُسحَب، أرباعٌ، فتراتٌ جاهزة، إداراتٌ وعملاءُ ومشاريع،
// بحث) ← بطاقة «الوقت مقابل الإيراد» ← شريط «قائمة الدخل» ← بطاقات المشاريع والفرص وأكبر
// العملاء ← بطاقتا المال والفريق ← ذيل «من أين تأتي الأرقام؟»، وكل تفصيلٍ يفتح في لوحةٍ
// جانبية. والألسنة السبعة والبنود والقراءة التنفيذية وقوالب التحقيق القديمة حُذفت كلُّها:
// صارت أقساماً في الشاشة نفسها أو لوحاتِ تفاصيل (ADR-0027).
//
// **الخادم لا يحسب هنا رقماً ولا يحرس بوابة.** الحمولة كلها من `buildCommandCenterDataset`
// مرشَّحةً بصلاحية قارئها (الحجب بالغياب: ما لا يُقرأ لا مفتاحَ له أصلاً)، وتُزرع في الوسم
// ثلاث حزمٍ جامدة (`cc-data` / `cc-view` / `cc-labels`) يقرؤها النصّ البرمجي عند الإقلاع.
// فالقرار الأمني في موضعٍ واحد، والصفحة تُبنى بلا أي جلبٍ ثانٍ.
//
// ولمن لم تعمل عنده الشيفرة: الخادم يُصيِّر **قائمة الدخل جدولاً** داخل شريط القائمة نفسه من
// الحمولة ذاتها — فالشاشة لا تُسلَّم فارغةً أبداً، ولا تُكتب عليها جملةُ «هذه الصفحة تحتاج…».
// والمتصفّح يستبدلها بالشريط الكامل لحظة الإقلاع.
//
// و«قطاعي» (`mySectorPage`) أسفل الملف كما هو: وجهُ من يعمل داخل القطاع لا من يقوده.
import { layout, card, pill, tr } from '../layout.js';
import { asset } from '../assets.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all } from '../../core/db/index.js';
import { HttpError } from '../../core/http/errors.js';
import { effectiveScope, can } from '../../core/rbac/index.js';
import { SCOPE_RANK } from '../../core/rbac/matrix.js';
import { config } from '../../core/config.js';
import { DELIVERY_SECTOR_SQL } from '../../core/org/kind.js';
import { G } from '../i18n/glossary.js';
import { MONTHS_AR } from '../../core/i18n/time.js';
import { countAr, dayWord } from '../../core/i18n/plural.js';
import { esc } from './_shared.js';
import { ccPayload, ccJson } from './sector-cc-data.js';
import { sectorIdentity } from '../../modules/org/org.js';
import { mySectorTasks } from '../../modules/pmo/tasks.js';
import { myProjectsInSector, nextMilestones } from '../../modules/pmo/projects.js';
import { effectiveProgress } from '../../modules/pmo/progress.js';
import { myOpportunitiesInSector } from '../../modules/crm/opportunities.js';

const CARD_HEAD_CSS = `.card-head{padding:var(--pad-card-h);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.card-head .t{font-weight:800;font-size:var(--fs-title)}
.card-head .aux{margin-inline-start:auto;display:flex;gap:.35rem;align-items:center}`;

// ── من يرى أي وجه من الصفحة؟ ─────────────────────────────────────────────────
// مركز القطاع مبني من سبعة موارد: المشاريع والفرص والعملاء والعقود والفواتير وبنود الإيراد
// والموظفين. من يقرأ أياً منها على مستوى **القطاع فأوسع** يقود القطاع أو يخدمه على مستواه،
// فالشاشة شاشته كما هي. ومن نطاقه أضيق — مشاريعه التي يعمل عليها، أو ما يخصّه وحده — لا شأن
// له بمستهدفات القطاع ولا بخط فرصه: يرى قطاعه من موقعه هو («قطاعي»).
//
// القرار **مشتق من الصلاحيات لا من قائمة أدوار**: دور جديد لا يحتاج تعديل هذا الملف، وتضييق
// نطاق دور قائم يغيّر شاشته في اللحظة نفسها. وملاحظة دقيقة تفسد الفحص إن غابت: can(user,
// 'read', X) بلا صف هدف يعيد «صحيح» لمجرد وجود المنح مهما ضاق نطاقه — فهو يجيب «هل يقرأ؟»
// لا «إلى أين يصل؟». السؤال هنا نطاقي، وeffectiveScope وحده يجيبه.
// و«التقارير والمؤشرات» بين الموارد: الشاشة في أصلها تقريرُ قطاعٍ ولوحةُ مؤشراته، فمن يُمنح
// قراءتهما على مستوى القطاع فقد مُنح هذه الشاشة بعينها.
const COMMAND_RESOURCES = ['project', 'opportunity', 'client', 'contract', 'invoice', 'revenue_line', 'employee',
  'report', 'kpi'];
const scopeRank = (s) => SCOPE_RANK[s] || 0;

export function sectorViewMode(user) {
  let widest = null;
  for (const r of COMMAND_RESOURCES) {
    const s = user ? effectiveScope(user, 'read', r) : null;
    if (scopeRank(s) > scopeRank(widest)) widest = s;
  }
  return { scope: widest, mode: scopeRank(widest) >= SCOPE_RANK.sector ? 'command' : 'personal' };
}

// ── الصيغة على الخادم: للجدول الاحتياطي وحده ───────────────────────────────────────────
// (كل رقمٍ آخر في الصفحة يُصاغ في المتصفّح بـ`CC.fmt`، فلا صيغتان لشيءٍ واحد.)
const ccMoney = (halalas, kind) => {
  if (halalas == null) return `<span class="muted-p" style="display:inline">${esc(G.notEnteredYet)}</span>`;
  const text = fmtSar(Math.abs(halalas));
  // الكلفة والمجموع بين قوسين — كما في نسخة الطباعة حرفاً، فلا يُقرأ الطرح جمعاً.
  const bracketed = kind === 'cost' || kind === 'subtotal' || halalas < 0;
  return `<bdi dir="ltr" class="tnum">${esc(bracketed ? `(${text})` : text)}</bdi>`;
};

/** مجموعُ مصفوفةٍ شهرية على أشهرٍ بعينها — والفراغ يبقى فراغاً: شهورٌ كلُّها بلا تسجيل ⇒ لا قيمة. */
function sumMonths(arr, months) {
  if (!Array.isArray(arr)) return null;
  let total = null;
  for (const m of months) {
    const v = arr[m - 1];
    if (v != null && Number.isFinite(Number(v))) total = (total || 0) + Number(v);
  }
  return total;
}

/** اسم الفترة من أشهرها — السنةُ كاملةً، أو شهرٌ، أو مدىً، أو أشهرٌ متفرّقة تُسمّى بأسمائها. */
function monthsLabel(months) {
  const ms = (months || []).slice().sort((a, b) => a - b);
  if (!ms.length) return G.fullYear;
  if (ms.length >= 12) return G.fullYear;
  const first = ms[0];
  const last = ms[ms.length - 1];
  if (first === last) return MONTHS_AR[first - 1];
  if (ms.length === last - first + 1) return `من ${MONTHS_AR[first - 1]} إلى ${MONTHS_AR[last - 1]}`;
  return ms.map((m) => MONTHS_AR[m - 1]).join(' و');
}

// ── الجدول الاحتياطي: قائمة الدخل مُصيَّرةً على الخادم داخل شريط القائمة ──────────────────
// من لم تعمل عنده الشيفرة (متصفّح قديم، شبكة قطعت الملفّ، قارئُ شاشةٍ قبل الإقلاع) يجد الرقم
// نفسه الذي في الحمولة: الخطة والفعلي للفترة المختارة، بأسماء السطور كما اعتُمدت. ولا كلمة
// تقنية في وجه القارئ — جدولٌ يقرأ نفسه بنفسه.
function bandFallback(dataset, view) {
  const lines = Array.isArray(dataset.lines) ? dataset.lines : [];
  const months = view.months && view.months.length ? view.months : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  if (!lines.length) {
    return `<div class="sbar7 sb-empty"><span class="ic">${icon('info')}</span>
      <span>لا سطور في قائمة دخل هذا القطاع بعد — تُسجَّل من «البيانات» ثم تظهر هنا.</span></div>`;
  }
  // عدسةُ الإقفال نفسها التي في الشاشة: الإيراد على ما اختير (حتى الشهر الجاري في السنة
  // الجارية)، وسطورُ الكلفة على المغلق وحده — فلا يقرأ من عُطِّل عنده النصّ البرمجي مجملَ
  // ربحٍ من إيراد تسعة أشهرٍ وكلفةِ ثمانية.
  const meta = dataset.meta || {};
  const closed = Number(meta.closed_through) || 0;
  const today = meta.today || {};
  const curYear = !today.iso || Number(String(today.iso).slice(0, 4)) === Number(meta.year);
  const revCap = curYear ? (Number(today.m) || 12) : 12;
  const revMonths = months.filter((m) => m <= revCap);
  const costMonths = months.filter((m) => m <= closed);
  const monthsOf = (kind) => (kind === 'revenue' ? revMonths : costMonths);
  const hasPlan = lines.some((l) => Array.isArray(l.plan));
  const rows = lines.map((l) => {
    const cls = l.kind === 'cost' ? 'cost' : l.kind === 'subtotal' ? 'sub' : l.id === 'gp' ? 'gp' : '';
    const ms = monthsOf(l.kind);
    const plan = hasPlan ? `<td>${ccMoney(ms.length ? sumMonths(l.plan, ms) : null, l.kind)}</td>` : '';
    return `<tr class="${cls}"><td class="nm">${esc(l.name || '')}</td>
      ${plan}<td>${ccMoney(ms.length ? sumMonths(l.fin, ms) : null, l.kind)}</td></tr>`;
  }).join('');
  // وسببُ الفراغ يُقال، فلا يُقرأ «لا كلفة» بينما الحقيقة «لم يُقفل شهرٌ في هذه الفترة».
  const closedNote = costMonths.length ? ''
    : `<p class="muted-p">${esc(closed ? `لا شهر مغلق في الفترة المختارة — المالية مغلقة حتى ${MONTHS_AR[closed - 1]}` : 'لم يُسجَّل شهرٌ مغلق بعد')}</p>`;
  return `<section class="card" aria-label="${esc(G.incomeStatement)}">
    <div class="tbl-wrap tbl-x"><table class="pl">
      <caption class="sr">${esc(G.incomeStatement)} — ${esc(monthsLabel(months))}</caption>
      <thead><tr><th>${esc(G.lineItem)}</th>${hasPlan ? `<th>${esc(G.periodPlan)}</th>` : ''}<th>${esc(G.periodActual)}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>${closedNote}
  </section>`;
}

/** ذيلٌ مُصيَّر على الخادم: مصدر الأرقام وآخر إقفالٍ مالي — يستبدله المتصفّح بذيله الكامل. */
function footFallback(dataset) {
  const meta = dataset.meta || {};
  const closed = Number(meta.closed_through) || 0;
  const bits = [
    `أرقام ${esc(meta.sector?.name_ar || '')} لسنة <b class="tnum">${esc(String(meta.year || ''))}</b>`,
    closed ? `المالية مغلقة حتى <b>${esc(MONTHS_AR[closed - 1])}</b>` : 'لم يُسجَّل شهرٌ مغلق بعد',
    meta.completeness_pct != null ? `اكتمال البيانات <b class="tnum">${esc(String(Math.round(meta.completeness_pct)))}%</b>` : '',
  ].filter(Boolean);
  return bits.map((b) => `<span>${b}</span>`).join('');
}

/**
 * بطاقةُ «الوقت مقابل الإيراد» قبل الإقلاع: سطرٌ يقول ما تقيسه، لا صندوقٌ فارغ.
 * وزرُّ الفتح زرٌّ حقيقي (`<button>`) لا قسمٌ يتظاهر بأنه زر: قارئ الشاشة يجده في قائمة
 * الأزرار، ولوحةُ المفاتيح تفتحه بـEnter/مسافة بلا معالجٍ إضافي.
 */
function heroFallback(dataset, view) {
  const meta = dataset.meta || {};
  return `<div class="hero-pre"><b>الوقت مقابل الإيراد</b>
    <span class="muted-p" style="display:inline"> · ${esc(meta.sector?.name_ar || '')} · ${esc(monthsLabel(view.months))}
    <span class="tnum">${esc(String(meta.year || ''))}</span></span>
    ${HERO_HIT}</div>`;
}

// زرُّ «تفاصيل الإيقاع» داخل البطاقة — الشاشةُ ترسمه في كل رسمٍ للبطاقة، والخادم يرسمه قبل
// الإقلاع. القسمُ نفسه يبقى قسماً بلا دورٍ مُدّعى (`role="button"` على <section> غير مقبول)،
// ويبقى النقرُ على كامل البطاقة عاملاً من `data-go` عليها.
const HERO_HIT = '<button type="button" class="hero-hit" data-go=\'{"k":"pace"}\''
  + ' aria-label="الوقت مقابل الإيراد — افتح التفاصيل">التفاصيل</button>';

// من عُطِّل عنده النصّ البرمجي يرى الجدول والذيل وحدهما — وحاوياتُ الرسم الفارغة تُطوى فلا
// تبقى صناديقُ بيضاءُ تَعِد بمحتوىً لن يصل. والقاعدة داخل <noscript> فلا تسري إلا عنده هو.
const CC_NOJS = `<noscript><style>
.cc-page .fbar,.cc-page .c-pillars,.cc-page .c-bottom{display:none}
.cc-page .hero{cursor:default}
</style></noscript>`;

/** حالةٌ مصمَّمة: حسابٌ بلا قطاع — خطوةٌ تالية حقيقية لا لوحة فارغة ولا قطاعٌ بديل. */
function noSectorPage(user, message, year) {
  return layout({ user, active: 'sector', title: 'مركز القطاع',
    body: `<div class="card"><div class="empty-state">${icon('sector')}
      <div class="t">لا يوجد قطاع مرتبط بحسابك</div>
      <div class="s">${esc(message || 'اطلب من مدير النظام ربطك بقطاع لعرض مركزه.')}</div>
      <a class="btn btn-primary" href="/app/tasks">العودة إلى مهامي</a></div></div>`, year });
}

/**
 * مركز القطاع — الشاشة الواحدة.
 *
 * @param {object} user
 * @param {object} opts معاملات الرابط كما وصلت (`?year=&sector=&p=&months=&project=&dept=&client=&tab=&unit=`)
 */
export async function sectorPage(user, opts = {}) {
  if (sectorViewMode(user).mode === 'personal') return await mySectorPage(user, opts);
  let payload;
  try {
    payload = await ccPayload(user, opts);
  } catch (e) {
    // «لا قطاع مرتبط بحسابك» ليست عطباً: حالةٌ مصمَّمة لها صفحتها. وما عداها (قطاعٌ خارج
    // النطاق، اسمٌ لا وجود له) يمرّ كما هو إلى معالج الأخطاء — الرفض يُقال ولا يُلتفّ عليه.
    if (e instanceof HttpError && e.code === 'bad_request') return noSectorPage(user, e.message, Number(opts.year) || config.fiscalYear);
    throw e;
  }
  const { sector, year, dataset, view, labels } = payload;

  // محوّل القطاع لمن نطاقه الشركة: قطاعات التسليم وحدها — وحدة المساندة لا مركز قيادةٍ
  // تجاريّاً لها. والقائمة نفسها هي ما يقبله `resolveCommandCenterSector` من `?sector=`.
  const switcher = user.scope === 'company'
    ? await (async () => {
      const sectors = await all(`SELECT id, name_ar, color FROM sector
         WHERE active = 1 AND deleted_at IS NULL AND ${DELIVERY_SECTOR_SQL} ORDER BY sort_order`);
      if (sectors.length < 2) return '';
      return `<div class="toolbar" style="row-gap:.4rem">
        <span style="font-size:var(--fs-body);color:var(--muted);font-weight:700">القطاع:</span>
        ${sectors.map((s) => `<a href="/app/sector?year=${esc(String(year))}&sector=${esc(s.id)}" class="chip ${s.id === sector.id ? 'on' : ''}"><span class="dot" style="background:${esc(s.color || '#244A99')}"></span>${esc(s.name_ar)}</a>`).join('')}
        ${can(user, 'read', 'kpi') ? `<a class="btn btn-sm" href="/app/ceo?year=${esc(String(year))}&sector=${esc(sector.id)}">لوحة القيادة</a>` : ''}
      </div>`;
    })()
    : '';

  // ── جسم الشاشة: حاوياتُ الرسم كما يتوقّعها النصّ البرمجي، وثلاثُ حزمٍ جامدة ──────────────
  const body = `${switcher}<div class="cc-page">
  <section class="fbar" id="fbar" role="search" aria-label="مرشِّحات الشاشة"></section>
  <section class="hero" id="ccHero" data-go='{"k":"pace"}'>${heroFallback(dataset, view)}</section>
  <div id="ccBand">${bandFallback(dataset, view)}</div>
  <section class="c-pillars" aria-label="المشاريع والفرص وأكبر العملاء">
    <article class="card3 prj" id="cPrj"></article>
    <article class="card3 opp" id="cOpp"></article>
    <article class="card3 cli" id="cCli"></article>
  </section>
  <section class="c-bottom">
    <article class="card3 c-money" id="cMoney"></article>
    <article class="card3 c-team" id="cTeam"></article>
  </section>
  <footer class="x-foot" id="cFoot">${footFallback(dataset)}</footer>
  <script type="application/json" id="cc-data">${ccJson(dataset)}</script>
  <script type="application/json" id="cc-view">${ccJson(view)}</script>
  <script type="application/json" id="cc-labels">${ccJson(labels)}</script>
</div>`;

  return layout({ user, active: 'sector', title: `مركز القطاع — ${sector.name_ar}`,
    subtitle: `المال والعملاء والمشاريع والفريق في شاشة واحدة · ${year}`, body, year,
    extraHead: `<link rel="stylesheet" href="${asset('/static/pages/sector.css')}">${CC_NOJS}`,
    // الترتيب ترتيبُ التحميل: الرسوم والصيغ أولاً، ثم الصفحة، ثم لوحة التفاصيل.
    scripts: ['/static/pages/sector-figures.js', '/static/pages/sector.js', '/static/pages/sector-drawer.js'] });
}

// ═══════════════════════════════════════════════════════════════════════════════
// «قطاعي» — وجه الصفحة لمن يعمل **داخل** القطاع لا لمن يقوده
// ═══════════════════════════════════════════════════════════════════════════════
// ثلاثة أسئلة لا رابع لها: ما المطلوب مني؟ على أي مشاريع أنا؟ وأين أقف ومن يقودني؟
// وما لا يظهر هنا مقصود بحذفه: لا مستهدفات ولا نسب تحقق ولا خط فرص القطاع ولا تحصيل ولا
// أعمار مستحقات ولا تركّز عملاء ولا طاقة القطاع ولا كلفة ولا هامش — أرقام قرارٍ لا يملكه
// من يقرأ هذه الشاشة، وعرضها عليه إشغال بما لا يستطيع تغييره.
const MY_CSS = `<style>
${CARD_HEAD_CSS}
.my-grid{display:grid;gap:var(--gap);grid-template-columns:1.1fr .9fr}
@media(max-width:980px){.my-grid{grid-template-columns:1fr}}
.my-col{display:flex;flex-direction:column;gap:var(--gap);min-width:0}
.my-id{display:flex;align-items:center;gap:.7rem;padding:.75rem 1rem;flex-wrap:wrap}
.my-id .sdot{width:11px;height:11px;border-radius:50%;flex:none}
.my-id .nm{font-weight:800;font-size:var(--fs-title);color:var(--ink2)}
.my-id .ld{font-size:var(--fs-micro);color:var(--muted)}
.mw-list{padding:.35rem 1rem .6rem;display:flex;flex-direction:column}
.mw-row{display:flex;gap:.6rem;align-items:flex-start;padding:.5rem 0;border-bottom:1px dashed var(--line)}
.mw-row:last-child{border-bottom:none}
.mw-row .pin{width:7px;height:7px;border-radius:50%;flex:none;margin-top:.42rem}
.mw-main{flex:1;min-width:0}
.mw-t{font-size:var(--fs-body);font-weight:700;color:var(--ink2);line-height:1.5;overflow-wrap:anywhere}
.mw-m{display:flex;gap:.1rem .7rem;flex-wrap:wrap;align-items:center;font-size:var(--fs-micro);color:var(--muted);margin-top:.1rem}
.mw-m a{color:var(--brand)}
.mw-side{flex:none;display:flex;align-items:center;gap:.35rem;text-align:end}
.mw-more{font-size:var(--fs-micro);color:var(--faint);padding-top:.45rem}
</style>`;

const RAG_TONE = { GREEN: 'var(--green)', AMBER: 'var(--amber)', RED: 'var(--red)' };

async function mySectorPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const sectorId = user?.sector_id || null;
  const sec = sectorId ? await sectorIdentity(sectorId) : null;
  // الحساب غير مربوط بقطاع: حالة مصمَّمة بخطوة تالية حقيقية، لا لوحة فارغة ولا قطاع بديل.
  if (!sec) {
    return layout({ user, active: 'sector', title: 'قطاعي', subtitle: 'أين تقف وما المطلوب منك',
      body: `<div class="card"><div class="empty-state">${icon('sector')}
        <div class="t">لا يوجد قطاع مرتبط بحسابك</div>
        <div class="s">اطلب من مدير النظام ربط حسابك بقطاعك، وستظهر هنا مهامك ومشاريعك فيه.</div>
        <a class="btn btn-primary" href="/app/tasks">العودة إلى مهامي</a></div></div>`, year });
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(today + 'T00:00:00Z');
  const canProjects = can(user, 'read', 'project');
  const canOpps = can(user, 'read', 'opportunity');

  const [tasks, mine, opps] = await Promise.all([
    mySectorTasks(user, sectorId, { limit: 50 }),
    myProjectsInSector(user, sectorId),
    myOpportunitiesInSector(user, sectorId),
  ]);
  const shownP = mine.slice(0, 8);
  // نسبة الإنجاز من مصدرها الواحد — لا من العمود المخزَّن (انظر modules/pmo/progress.js).
  const progMapS = await effectiveProgress(shownP);
  const ms = Object.fromEntries((await nextMilestones(shownP.map((p) => p.id))).map((m) => [m.project_id, m]));

  // ── (1) هوية القطاع: أين أقف ومن يقودني ──
  const leadLine = sec.lead_name
    ? `يقود القطاع ${esc(sec.lead_name)}`
    : 'لم يُسجَّل قائد لهذا القطاع بعد';
  const idCard = card(`<div class="my-id">
    <span class="sdot" style="background:${esc(sec.color) || 'var(--brand)'}"></span>
    <div style="flex:1;min-width:0"><div class="nm">${esc(sec.name_ar)}</div><div class="ld">${leadLine}</div></div>
    <span class="pill" style="background:#eef2fb;color:var(--brand)">قطاعك</span>
  </div>`);

  // ── (2) مهامي في هذا القطاع — الأقرب موعداً أولاً ──
  const dnum = (d) => Math.round((Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') - todayMs) / 86400000);
  const dayMonth = (d) => {
    const t = new Date(String(d).slice(0, 10) + 'T00:00:00Z');
    return Number.isNaN(t.getTime()) ? '' : `<span class="tnum">${t.getUTCDate()}</span> ${MONTHS_AR[t.getUTCMonth()]}`;
  };
  const dueOf = (due) => {
    if (!due) return { text: 'بلا موعد', color: 'var(--faint)', pin: 'var(--line)' };
    const n = dnum(due);
    if (!Number.isFinite(n)) return { text: 'بلا موعد', color: 'var(--faint)', pin: 'var(--line)' };
    if (n < 0) return { text: `متأخرة ${dayWord(-n)}`, color: 'var(--red)', pin: 'var(--red)', bold: true };
    if (n === 0) return { text: 'تستحق اليوم', color: 'var(--amber)', pin: 'var(--amber)', bold: true };
    if (n === 1) return { text: 'غداً', color: 'var(--amber)', pin: 'var(--amber)' };
    if (n <= 7) return { text: `خلال ${dayWord(n)}`, color: 'var(--muted)', pin: 'var(--brand)' };
    return { text: dayMonth(due), color: 'var(--muted)', pin: '#cbd5e1' };
  };
  const SHOW_T = 8;
  const taskRows = tasks.slice(0, SHOW_T).map((t) => {
    const d = dueOf(t.due_date);
    const ctx = t.project_name
      ? (canProjects ? `<a href="/app/project/${t.project_id}">${esc(t.project_name)}</a>` : esc(t.project_name))
      : '';
    return `<div class="mw-row">
      <span class="pin" style="background:${d.pin}"></span>
      <div class="mw-main">
        <div class="mw-t">${esc(t.title)}</div>
        <div class="mw-m">
          <span style="color:${d.color}${d.bold ? ';font-weight:700' : ''}">${d.text}</span>
          ${ctx}
          ${t.status === 'BLOCKED' && t.blocked_reason ? `<span style="color:var(--red)">معلّقة: ${esc(t.blocked_reason)}</span>` : ''}
        </div>
      </div>
      <div class="mw-side">${t.priority === 'P0' ? pill('حرجة', 'red') : t.priority === 'P1' ? pill('عالية', 'amber') : ''}</div>
    </div>`;
  }).join('');
  const overdueN = tasks.filter((t) => t.due_date && dnum(t.due_date) < 0).length;
  const tasksCard = tasks.length ? card(`
    <div class="card-head">
      <span class="t">مهامي في هذا القطاع</span>
      <span class="pill" style="background:#eef2fb;color:var(--brand)"><b class="tnum">${tasks.length}</b></span>
      ${overdueN ? pill(`متأخرة <b class="tnum">${overdueN}</b>`, 'red') : ''}
      <span class="aux"><a class="btn btn-sm" href="/app/tasks">كل مهامي</a></span>
    </div>
    <div class="mw-list">${taskRows}
      ${tasks.length > SHOW_T ? `<div class="mw-more">و${countAr(tasks.length - SHOW_T, { one: 'مهمة أخرى', two: 'مهمتان أخريان', few: 'مهام أخرى', many: 'مهمة أخرى' })} — تظهر كلها في «مهامي»</div>` : ''}
    </div>`) : '';

  // ── (3) مشاريعي: ما أنا مُسكَّن عليه فعلاً، لا كل مشاريع القطاع ──
  const projRows = shownP.map((p) => {
    const prog = progMapS.get(p.id)?.pct ?? Math.max(0, Math.min(100, Math.round(p.progress_pct || 0)));
    const nx = ms[p.id];
    return `<div class="mw-row">
      <span class="pin" style="background:${RAG_TONE[p.rag] || '#cbd5e1'}"></span>
      <div class="mw-main">
        <div class="mw-t"><a href="/app/project/${p.id}">${esc(p.name_ar)}</a></div>
        <div class="mw-m"><span>${esc(tr(p.status) || '')}</span>${nx ? `<span>${G.nextAction}: ${esc(nx.title)}${nx.due_date ? ` · ${dayMonth(nx.due_date)}` : ''}</span>` : ''}</div>
        <div class="bar" style="margin-top:.3rem;height:5px"><span style="width:${prog}%;background:var(--brand)"></span></div>
      </div>
      <div class="mw-side"><span class="tnum" style="font-weight:800;font-size:var(--fs-body)">${prog}%</span></div>
    </div>`;
  }).join('');
  const projectsCard = mine.length ? card(`
    <div class="card-head">
      <span class="t">مشاريعي في هذا القطاع</span>
      <span class="pill" style="background:#eef2fb;color:var(--brand)"><b class="tnum">${mine.length}</b></span>
      <span class="aux"><a class="btn btn-sm" href="/app/projects">كل مشاريعي</a></span>
    </div>
    <div class="mw-list">${projRows}
      ${mine.length > shownP.length ? `<div class="mw-more">و${countAr(mine.length - shownP.length, { one: 'مشروع آخر', two: 'مشروعان آخران', few: 'مشاريع أخرى', many: 'مشروعاً آخر' })}</div>` : ''}
    </div>`) : '';

  // ── (4) فرصي — لمن يقرأ الفرص وحده (الاستشاري نعم، الموظف لا) ──
  const SHOW_O = 6;
  const oppRows = opps.slice(0, SHOW_O).map((o) => `<div class="mw-row">
      <span class="pin" style="background:${esc(o.stage_color) || 'var(--brand2)'}"></span>
      <div class="mw-main">
        <div class="mw-t"><a href="/app/opportunity/${o.id}">${esc(o.title_ar)}</a></div>
        <div class="mw-m">
          ${o.stage_name ? `<span>${esc(o.stage_name)}</span>` : ''}
          ${o.client_name ? `<span>${esc(o.client_name)}</span>` : ''}
          <span style="${o.no_next_action ? 'color:var(--amber);font-weight:700' : ''}">${o.no_next_action ? G.noNextAction : esc(o.next_action)}</span>
        </div>
      </div>
      <div class="mw-side">${o.value_halalas
      ? `<span class="tnum" style="font-weight:800;font-size:var(--fs-body)">${fmtSar(o.value_halalas)}</span>`
      : '<span style="font-size:var(--fs-micro);color:var(--faint)">لم تُسعَّر بعد</span>'}</div>
    </div>`).join('');
  const oppsCard = opps.length ? card(`
    <div class="card-head">
      <span class="t">${G.myOpportunities} في هذا القطاع</span>
      <span class="pill" style="background:#f3e8ff;color:var(--brand2)"><b class="tnum">${opps.length}</b></span>
      <span class="aux"><a class="btn btn-sm" href="/app/my-opportunities">${G.myOpportunities}</a></span>
    </div>
    <div class="mw-list">${oppRows}
      ${opps.length > SHOW_O ? `<div class="mw-more">و${countAr(opps.length - SHOW_O, { one: 'فرصة أخرى', two: 'فرصتان أخريان', few: 'فرص أخرى', many: 'فرصة أخرى' })}</div>` : ''}
    </div>`) : '';

  // ── الحالة المصمَّمة: لا عمل بعد ⟵ ماذا أفعل الآن، ومن أسأل ──
  const nothing = !tasksCard && !projectsCard && !oppsCard;
  const emptyCard = card(`<div class="empty-state">${icon('tasks')}
    <div class="t">لا عمل مسجَّل لك في ${esc(sec.name_ar)} بعد</div>
    <div class="s">حين تُسنَد إليك مهمة أو تُسكَّن على مشروع${canOpps ? ' أو تُسنَد إليك فرصة' : ''} ستظهر هنا.
      ${sec.lead_name ? `وللسؤال عن عملك في القطاع تواصل مع ${esc(sec.lead_name)}.` : ''}</div>
    <a class="btn btn-primary" href="/app/tasks">أضِف مهمة</a></div>`);

  // التوزيع يتبع ما لدى الشخص فعلاً: بطاقة واحدة تأخذ العرض كاملاً بدل عمود مليء وآخر فارغ
  // (استشاري له فرص بلا مهام كان يرى نصف الشاشة بياضاً). الأولوية ثابتة: مهامي ثم مشاريعي ثم فرصي.
  const cards = [tasksCard, projectsCard, oppsCard].filter(Boolean);
  const grid = cards.length === 1
    ? `<div class="my-grid" style="grid-template-columns:1fr;margin-top:var(--gap)"><div class="my-col">${cards[0]}</div></div>`
    : `<div class="my-grid" style="margin-top:var(--gap)">
      <div class="my-col">${cards[0]}</div>
      <div class="my-col">${cards.slice(1).join('')}</div>
    </div>`;
  const body = `${MY_CSS}
    ${idCard}
    ${nothing ? `<div style="margin-top:var(--gap)">${emptyCard}</div>` : grid}`;

  const bits = [
    tasks.length ? countAr(tasks.length, { one: 'مهمة مفتوحة', two: 'مهمتان مفتوحتان', few: 'مهام مفتوحة', many: 'مهمة مفتوحة' }) : '',
    mine.length ? countAr(mine.length, { one: 'مشروع واحد', two: 'مشروعان', few: 'مشاريع', many: 'مشروعاً' }) : '',
    opps.length ? countAr(opps.length, { one: 'فرصة واحدة', two: 'فرصتان', few: 'فرص', many: 'فرصة' }) : '',
  ].filter(Boolean);
  return layout({ user, active: 'sector', title: 'قطاعي',
    subtitle: `${sec.name_ar} · ${bits.length ? bits.join(' · ') : 'ما يخصّك أنت في هذا القطاع'}`,
    body, year });
}
