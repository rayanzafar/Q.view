// مركز القيادة (v5) — شاشة قائد القطاع على قاعدة «إشارة ← سياق ← تفصيل»:
// المركز يجيب في ثوانٍ: هل نحن على المسار؟ أين الفجوة الآن؟ هل خط الفرص يكفي وأين يقف؟
// هل لدى الفريق سعة؟ ما صحة المشاريع؟ من أهم العملاء قراراً؟ وما الذي تغيّر في نافذتي؟
// وكل ما بعد ذلك — تحقيق، تعديل، اعتماد — يفتح صفحته الأصلية ولا يُنسخ هنا.
// استثناءٌ مقصود (v5.35، بطلب قائد القطاع عبر المالك): **قسم الأفراد يُفصَّل في مكانه** — الضغط
// على شخصٍ في «طاقة الفريق» يفتح نافذته هنا (حِمله، مشاريعه، مهامه) ولا ينقل القارئ إلى لوحة
// التسكين؛ والروابط إلى صفحته الكاملة ولوحة التسكين أفعالٌ ثانوية داخل النافذة.
// لا رقم بلا مصدر مسجَّل، ولا نصّ مولَّد بالتخمين: جملة الملخص تُركَّب بقواعد معلنة من الأرقام نفسها.
import { layout, card, pill, tr } from '../layout.js';
import { netSql } from '../../modules/finance/vat.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all, get } from '../../core/db/index.js';
import { sectorDashboard, sectorStaffing, sectorWins, quarterlyRevenue, quarterlyBookings, pipelineCoverage, monthlyRevenue, revenueForecast, yearElapsedPct, targetToDate, paceDelta, grossMargin } from '../../core/reports/metrics.js';
import { attentionFeed, RESOURCE_AR } from '../../core/reports/attention.js';
import { changesSince, sinceForWindow } from '../../core/reports/changes.js';
import { arAging } from '../../modules/finance/finance.js';
import { mySectorTasks } from '../../modules/pmo/tasks.js';
import { myProjectsInSector, nextMilestones, projectYearClause } from '../../modules/pmo/projects.js';
import { effectiveProgress } from '../../modules/pmo/progress.js';
import { myOpportunitiesInSector, ROT_THRESHOLDS } from '../../modules/crm/opportunities.js';
import { sectorIdentity } from '../../modules/org/org.js';
import { sectorTeamDetail, UTIL_BANDS, allocationPeriod } from '../../modules/pmo/capacity.js';
import { relationshipOf, lastTouchByClient } from '../../modules/clients/clients.js';
import { can, effectiveScope, canSeeSensitive } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { SCOPE_RANK } from '../../core/rbac/matrix.js';
import { config } from '../../core/config.js';
import { DELIVERY_SECTOR_SQL } from '../../core/org/kind.js';
import { G } from '../i18n/glossary.js';
import { monthLabel, monthLabelDual, quarterLabel, nowDot, currentMonthIndex, MONTHS_AR } from '../../core/i18n/time.js';
import { countAr, dayWord } from '../../core/i18n/plural.js';
import { esc, ddWrap, attain, ddRows, sarShort } from './_shared.js';

// عدسة الفترة: قيمة ?win + نص الصدى في عناوين الأقسام
const WINS = [
  ['day', 'اليوم', 'منذ أمس'], ['week', 'الأسبوع', 'منذ أسبوع'],
  ['month', 'الشهر', 'منذ شهر'], ['quarter', 'الربع', 'منذ ربع سنة'],
];

// أيقونة ولون كل نوع في «ما تغيّر»
const CHG_IC = { stage: 'trend', invoice: 'money', collection: 'check', activity: 'mail', created: 'plus' };
const CHG_TONE = {
  stage: ['rgba(36,74,153,.1)', 'var(--brand)'], invoice: ['#dbeafe', 'var(--brand)'],
  collection: ['#dcfce7', 'var(--green)'], activity: ['#f1f5f9', 'var(--muted)'],
  created: ['#ede9fe', 'var(--brand2)'],
};
// فئات «ما تغيّر» — تُشتقّ من نوع السجل نفسه لا من نصّه. الفئات الست ثابتة بقرار المالك
// (v5.22)، وفئتا «المشاريع» و«الفريق» تعرضان حالة فراغ مدمجة إلى أن يسجّل النظام أحداثاً
// مؤرّخة لهما — الشارة وعدٌ بالمكان، والسجلات لا تُختلق. والفرصة الجديدة فرصٌ لا «سجل جديد».
const CHG_CAT = { stage: 'opp', invoice: 'fin', collection: 'fin', activity: 'client', created: 'opp' };
// حدّة كل نوع — قاعدة معلنة لا تقدير: الحسم (فوز/خسارة) عالٍ، حركة المرحلة والفاتورة وسط،
// والتحصيل والتواصل والسجل الجديد أخبار هادئة.
const CHG_SEV = (it) => (it.won || it.lost) ? ['عالية', '#fee2e2', '#991b1b']
  : (it.kind === 'stage' || it.kind === 'invoice') ? ['متوسطة', '#fef3c7', '#92400e']
  : ['منخفضة', '#f1f5f9', '#64748b'];

// ── لبنات رسم صغيرة (SVG محلي — لا مكتبة رسم) ────────────────────────────────
// حلقة إنجاز واحدة: تُستعمل حصراً حيث الرقم «جزء من هدف/كل» — لا زينة على كل رقم.
function ring(p, { size = 70, sw = 10, color = 'var(--brand2)', lbl = '' } = {}) {
  const shown = Math.max(0, Math.round(Number(p) || 0));
  const pc = Math.min(100, shown);
  const r = (size - sw) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - pc / 100);
  // dasharray كامل المحيط + dashoffset للهدف: الحلقة «تمتلئ» عند التحميل بحركة CSS واحدة (ringIn).
  return `<span class="ringw" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" style="transform:rotate(-90deg)">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#eef1f7" stroke-width="${sw}"/>
      ${pc > 0 ? `<circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" style="--c0:${c.toFixed(1)}"/>` : ''}
    </svg><span class="ringv tnum">${shown}%${lbl ? `<small>${esc(lbl)}</small>` : ''}</span></span>`;
}
// دونات مقسومة (صحة المشاريع): كل قطعة قوس بطول نسبتها — والمجموع في الوسط.
function donutSVG(segs, { size = 104, sw = 13 } = {}) {
  const total = segs.reduce((a, s) => a + s.v, 0) || 1;
  const r = (size - sw) / 2, c = 2 * Math.PI * r;
  let off = 0;
  const arcs = segs.filter((s) => s.v > 0).map((s) => {
    const len = (s.v / total) * c;
    const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}"/>`;
    off += len;
    return el;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" style="transform:rotate(-90deg)">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#eef1f7" stroke-width="${sw}"/>${arcs}</svg>`;
}
// عدّاد نصف دائري (طاقة الفريق): كل منطقة قوس بطول حصتها من الأفراد — يُقرأ من اليمين إلى
// اليسار كالنص (انعكاس رأسي للدائرة يجعل البداية عند اليمين فوق الوسط)، والمجموع في وسطه.
function semiGauge(segs, { size = 176, sw = 18 } = {}) {
  const total = segs.reduce((a, s) => a + s.v, 0) || 1;
  const r = (size - sw) / 2, c = 2 * Math.PI * r, half = c / 2;
  const cx = size / 2, cy = size / 2, h = size / 2 + sw / 2 + 1;
  let off = 0;
  const arcs = segs.filter((s) => s.v > 0).map((s) => {
    const len = (s.v / total) * half;
    const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}"/>`;
    off += len;
    return el;
  }).join('');
  return `<svg width="${size}" height="${h.toFixed(0)}" viewBox="0 0 ${size} ${h.toFixed(0)}" aria-hidden="true">
    <g transform="translate(0 ${(2 * cy).toFixed(0)}) scale(1 -1)">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#eef1f7" stroke-width="${sw}" stroke-dasharray="${half.toFixed(1)} ${c.toFixed(1)}"/>
      ${arcs}</g></svg>`;
}
// تدرّج القمع: من الأزرق الملكي إلى البنفسجي — عائلة الهوية وحدها، لا أخضر/أحمر داخل القمع
// كي لا تختلط ألوان المراحل بألوان الحالة (قاعدة المواصفة). لون المرحلة المخزَّن يبقى
// للوحة كانبان الفرص؛ هنا الترميز موضعي: موقع المرحلة في المسار.
function funnelColor(i, n) {
  const a = [0x24, 0x4A, 0x99], b = [0x83, 0x47, 0x98];
  const t = n <= 1 ? 0 : i / (n - 1);
  const mix = a.map((av, k) => Math.round(av + (b[k] - av) * t));
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const CARD_HEAD_CSS = `.card-head{padding:var(--pad-card-h);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.card-head .t{font-weight:800;font-size:var(--fs-title)}
.card-head .aux{margin-inline-start:auto;display:flex;gap:.35rem;align-items:center}`;

const CSS = `<style>
/* شبكة المرجع v5.23: شريط المؤشرات ← [يحتاج تدخلك | ما تغيّر] (٥:٤) ← [القمع | الصحة | الطاقة] ← العملاء */
.row-main{display:grid;gap:var(--gap);margin-bottom:var(--gap);grid-template-columns:1.25fr 1fr}
.row-ana{display:grid;gap:var(--gap);margin-bottom:var(--gap);grid-template-columns:1.1fr 1fr 1fr}
.row-two{display:grid;gap:var(--gap);margin-bottom:var(--gap);grid-template-columns:1.5fr 1fr}
@media(max-width:1280px){.row-ana{grid-template-columns:1fr 1fr}.row-ana>:first-child{grid-column:1/-1}}
@media(max-width:1100px){.row-main{grid-template-columns:1fr}}
@media(max-width:980px){.row-main,.row-ana,.row-two{grid-template-columns:1fr}}
.row-main>.card,.row-ana>.card{display:flex;flex-direction:column;min-width:0}
/* حزام علوي رفيع يميّز كل بطاقة بلون معناها — تمييز هادئ لا زخرفة */
.band{position:relative}
.band::before{content:'';position:absolute;top:-1px;inset-inline:-1px;height:3px;border-radius:var(--r) var(--r) 0 0;background:var(--bandc,var(--brand-grad))}
.b-red{--bandc:linear-gradient(90deg,#dc2626,#f87171)}
.b-blue{--bandc:linear-gradient(90deg,#2563eb,#7ab3f9)}
.b-violet{--bandc:linear-gradient(90deg,#834798,#b083c0)}
.b-green{--bandc:linear-gradient(90deg,#047857,#34d399)}
.b-amber{--bandc:linear-gradient(90deg,#b45309,#f0b04f)}
/* المرور يرفع بطاقات الصفوف الرئيسية بظل خفيف موحّد */
.row-main>.card:hover,.row-ana>.card:hover,.row-two>.card:hover{box-shadow:var(--sh);transform:translateY(-2px);border-color:#d6def0}
/* حركات التحميل: الحلقات تمتلئ والأشرطة تنمو — CSS وحدها، وتُطفأ لمن طلب سكون الحركة */
@keyframes ringIn{from{stroke-dashoffset:var(--c0)}}
.ring-fill{animation:ringIn .8s ease-out}
@keyframes growW{from{width:0}}
.fnl-bar,.blt .trk .fill,.bar>span{animation:growW .7s ease-out both}
@media (prefers-reduced-motion:reduce){.ring-fill,.fnl-bar,.blt .trk .fill,.bar>span,.row-main>.card,.row-ana>.card,.row-two>.card{animation:none;transition:none}}
/* عدسة الفترة روابط لا أزرار (حالتها في الرابط) — تلبس زيّ .seg نفسه */
.seg a{font-size:12px;font-weight:700;color:var(--muted);padding:.35rem .7rem;border-radius:8px;display:flex;align-items:center;gap:.35rem;transition:background .18s,color .18s}
.seg a.on{background:#fff;color:var(--ink2);box-shadow:var(--sh-sm)}
${CARD_HEAD_CSS}
.empty-mini{padding:.6rem 1rem;font-size:var(--fs-meta);color:var(--muted);display:flex;gap:.45rem;align-items:center}
.empty-mini svg{width:14px;height:14px;color:var(--faint);flex:none}
.card-foot{margin-top:auto;padding:.45rem 1rem .55rem;border-top:1px solid var(--line)}
.card-foot a,.card-foot button{font-size:var(--fs-meta);font-weight:700;color:var(--brand);background:none;border:none;font-family:inherit;cursor:pointer;padding:0;display:inline-flex;gap:.3rem;align-items:center}
/* شريط المؤشرات: بطاقة بيضاء واحدة بحدّ علوي متدرج — خلايا مفصولة بحدود رأسية رفيعة */
.kpi-band{position:relative;display:flex;align-items:stretch;margin-bottom:var(--gap);padding:.5rem 0;flex-wrap:wrap}
.kpi-band::before{content:'';position:absolute;top:-1px;inset-inline:-1px;height:3px;border-radius:var(--r) var(--r) 0 0;background:var(--brand-grad)}
.kpi-cell{flex:1 1 0;min-width:128px;padding:.6rem 1rem;display:flex;flex-direction:column;gap:.15rem;justify-content:center;border-inline-start:1px solid var(--line)}
.kpi-cell:first-child{border-inline-start:none}
.kpi-hero{flex:1.7 1 0;min-width:230px;flex-direction:row;align-items:center;gap:.85rem}
.kpi-hero .lbl{font-size:var(--fs-meta);color:var(--muted);font-weight:700}
.kpi-hero .num{font-size:var(--fs-num-lg);font-weight:800;letter-spacing:-.02em;line-height:1.25}
.kpi-hero .tgt{font-size:var(--fs-micro);color:var(--faint);display:flex;gap:.35rem;align-items:center;flex-wrap:wrap}
.ringw{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none}
.ringv{position:absolute;font-size:13px;font-weight:800;color:var(--ink2);text-align:center;line-height:1.15}
.ringv small{display:block;font-size:8px;color:var(--muted);font-weight:700}
.kpi-cell .l{font-size:var(--fs-micro);color:var(--muted);font-weight:700;display:flex;align-items:center;gap:.3rem}
.kpi-cell .l svg{width:12px;height:12px;opacity:.75}
.kpi-cell .v{font-size:var(--fs-num-md);font-weight:800;letter-spacing:-.01em;line-height:1.3;display:flex;align-items:center;gap:.4rem}
.kpi-cell .s{font-size:var(--fs-micro);color:var(--faint)}
.kpi-ok{width:20px;height:20px;border-radius:50%;background:#dcfce7;color:var(--green);display:inline-flex;align-items:center;justify-content:center;flex:none}
.kpi-ok svg{width:12px;height:12px}
/* شريط صغير أسفل التغطية: قيمة كل مرحلة مفتوحة — بيانات القمع نفسها لا سلسلة مُختلَقة */
.kpi-spark{display:flex;align-items:flex-end;gap:2px;height:16px;margin-top:.2rem}
.kpi-spark span{width:9px;border-radius:2px 2px 0 0;background:var(--green);opacity:.8;min-height:2px}
@media(max-width:1180px){.kpi-hero{flex-basis:46%}.kpi-cell{min-width:30%}}
@media(max-width:640px){.kpi-hero,.kpi-cell{flex-basis:100%;border-inline-start:none;border-top:1px solid var(--line)}.kpi-band>:first-child{border-top:none}}
/* القمع v4: أشرطة أفقية مستقيمة متدرجة العرض — الاسم يميناً، شارة العدد الداكنة على رأس الشريط،
   والقيمة على طرفه. النقر يفتح تفصيل المرحلة كما كان. */
.fnl-cols{display:grid;grid-template-columns:minmax(76px,104px) 1fr 64px;gap:.55rem;padding:.1rem .35rem;font-size:var(--fs-micro);color:var(--faint);font-weight:800}
.fnl-cols span:nth-child(2){text-align:center}
.fnl-row{display:grid;grid-template-columns:minmax(76px,104px) 1fr 64px;gap:.55rem;cursor:pointer;align-items:center;border-radius:10px;padding:.22rem .35rem;border:1px solid transparent;text-decoration:none}
.fnl-row:hover{background:#fbfcfe;border-color:var(--line)}
.fnl-row.on{background:#f6f3fa;border-color:#d9c9e4;box-shadow:var(--sh-sm)}
.fnl-row .n{font-size:var(--fs-body);font-weight:700;color:var(--ink2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fnl-track{position:relative;height:24px;border-radius:8px;background:#f4f6fb;min-width:0}
.fnl-bar{position:absolute;inset-inline-start:0;top:0;bottom:0;border-radius:8px;min-width:34px;transition:width .3s ease}
.fnl-bar .cnt{position:absolute;inset-inline-end:4px;top:50%;transform:translateY(-50%);background:var(--ink);color:#fff;font-size:10px;font-weight:800;line-height:1;border-radius:6px;padding:.2rem .42rem;box-shadow:0 1px 2px rgba(15,23,42,.3);z-index:1}
/* التعتيم عند اختيار مرحلة يغسل الشريط بطبقة بيضاء — الرقم يبقى فوقها مقروءاً */
.fnl-row.dim .fnl-bar::before{content:'';position:absolute;inset:0;background:rgba(255,255,255,.74);border-radius:8px}
.fnl-row.dim .fnl-bar .cnt{background:#94a3b8}
.fnl-val{font-size:var(--fs-meta);color:var(--muted);font-weight:800;white-space:nowrap}
/* إحصاءات أعلى بطاقة القمع + صندوق أعلى الفرص */
.fnl-stats{display:flex;gap:.5rem;padding:.6rem .9rem 0;flex-wrap:wrap}
.fnl-stat{flex:1 1 120px;background:#fafbfe;border:1px solid var(--line);border-radius:10px;padding:.45rem .6rem;min-width:0}
.fnl-stat .h{font-size:var(--fs-micro);font-weight:800;color:var(--muted);display:flex;gap:.3rem;align-items:center}
.fnl-stat .h svg{width:12px;height:12px}
.fnl-stat .v{font-size:var(--fs-num-sm);font-weight:800}
.fnl-stat .s{font-size:var(--fs-micro);color:var(--faint)}
.fnl-box{background:#fafbfe;border:1px solid var(--line);border-radius:10px;padding:.45rem .6rem;margin:.4rem .9rem 0}
.fnl-box .h{font-size:var(--fs-micro);font-weight:800;color:var(--muted);display:flex;gap:.3rem;align-items:center}
.fnl-box .h svg{width:12px;height:12px}
.fnl-kv{display:flex;justify-content:space-between;gap:.6rem;font-size:var(--fs-meta);align-items:baseline}
.fnl-kv b{flex:none}
/* «ما تغيّر» — كالمرجع: أيقونة ثم نص وسطر فرعي، شارة حدّة، والزمن النسبي على الطرف */
.chg{display:flex;align-items:flex-start;gap:.55rem;padding:.45rem .55rem;border-radius:10px;border:1px solid transparent;border-inline-start:3px solid transparent}
.chg:hover{background:#fbfcfe;border-color:var(--line)}
.chg .ic{width:28px;height:28px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;margin-top:.1rem}
.chg .ic svg{width:14px;height:14px}
.chg .tx{flex:1;min-width:0}
.chg .h{display:block;font-size:var(--fs-body);font-weight:700;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chg .s{display:block;font-size:var(--fs-micro);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chg .meta{flex:none;text-align:left;display:flex;flex-direction:column;align-items:flex-end;gap:.15rem}
.chg .amt{font-size:var(--fs-meta);font-weight:800;color:var(--ink2)}
.chg .d{font-size:10px;color:var(--faint)}
.chg.won{border-inline-start-color:var(--green);background:#f0fdf4}
.chg.lost{border-inline-start-color:var(--red);background:#fef2f2}
.chg[hidden]{display:none}
.chg-cats{padding:.45rem .8rem;display:flex;gap:.3rem;flex-wrap:wrap;border-bottom:1px dashed var(--line)}
.chg-cat{border:1px solid var(--line);background:#fff;color:var(--muted);font-family:inherit;font-weight:700;font-size:var(--fs-micro);padding:.22rem .6rem;border-radius:999px;cursor:pointer}
.chg-cat.on{background:var(--brand);border-color:transparent;color:#fff}
/* «يحتاج تدخلك الآن» — جدول أولويات مرقّم: دائرة رتبة ملوّنة بحدّة البند، عنوان جريء وسطر
   «لماذا يهم؟»، وزر الإجراء المقترح بإطار وأيقونة على الطرف */
.attn-count{width:22px;height:22px;border-radius:50%;background:var(--red);color:#fff;font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex:none}
.attn-cols{display:grid;grid-template-columns:34px 1fr auto;gap:.6rem;padding:.4rem 1rem .35rem;font-size:var(--fs-micro);color:var(--faint);font-weight:800;border-bottom:1px solid var(--line)}
.attn-cols span:last-child{text-align:start}
.attn{display:grid;grid-template-columns:34px 1fr auto;align-items:center;gap:.6rem;padding:.55rem .2rem;border:none;border-radius:0;background:transparent;border-bottom:1px dashed var(--line)}
.attn:hover{border-color:var(--line);box-shadow:none;background:#fbfcfe}
.attn:last-child{border-bottom:none}
.attn .rank{width:27px;height:27px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:800;flex:none;justify-self:center}
.attn .tx{min-width:0}
.attn .tx .h{font-size:var(--fs-body);font-weight:800;color:var(--ink2);display:block;line-height:1.45}
.attn .tx .s{font-size:var(--fs-micro);color:var(--muted);display:block}
.attn .go{justify-self:start}
.attn .go svg{width:13px;height:13px}
@media(max-width:640px){.attn{grid-template-columns:34px 1fr}.attn .go{grid-column:2;justify-self:start}.attn-cols span:last-child{display:none}.attn-cols{grid-template-columns:34px 1fr}}
/* طيف قدرة الفريق — محور أرقام يقرأ يساراً كالأرقام نفسها */
.cap-axis{position:relative;height:74px;margin:.4rem 0 .1rem}
.cap-band{position:absolute;inset-inline:0;top:30px;height:12px;border-radius:999px;overflow:hidden;
  background:linear-gradient(to right,#bbf1d4 0%,#bbf1d4 56%,#e4e9f2 56%,#e4e9f2 88%,#fecaca 88%,#fecaca 100%)}
.cap-av{position:absolute;top:14px;width:26px;height:26px;border-radius:50%;border:2px solid #fff;box-shadow:var(--sh-sm);
  background:var(--brand-grad);color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;
  transform:translateX(-50%);cursor:pointer;padding:0;font-family:inherit;transition:left .25s ease}
.cap-av::after{content:'';position:absolute;inset:-8px}
.cap-av.r2{top:44px}
.cap-av.over{background:linear-gradient(120deg,#b91c1c,#dc2626)}
.cap-av.free{background:linear-gradient(120deg,#047857,#059669)}
.cap-ticks{position:relative;height:14px;font-size:9.5px;color:var(--faint)}
.cap-ticks span{position:absolute;transform:translateX(-50%)}
/* عدّاد نصف دائري لثلاث فئات الحِمل — والمجموع في وسطه، ومتوسط الإشغال تحته */
.cap-gauge{display:flex;flex-direction:column;align-items:center;padding:.65rem 1rem 0}
.cap-gauge .cw{position:relative;display:inline-flex;justify-content:center}
.cap-gauge .cc{position:absolute;inset-inline:0;bottom:1px;text-align:center;line-height:1.15}
.cap-gauge .cc b{font-size:var(--fs-num-md);font-weight:800;letter-spacing:-.01em}
.cap-gauge .cc small{display:block;font-size:9.5px;color:var(--muted);font-weight:700}
.cap-avg{font-size:var(--fs-meta);color:var(--muted);font-weight:700;margin-top:.35rem}
.cap-leg{display:flex;gap:.8rem;flex-wrap:wrap;justify-content:center;font-size:var(--fs-micro);color:var(--muted);font-weight:700;padding:.3rem 0 .4rem}
.cap-leg span{display:inline-flex;align-items:center;gap:.3rem}
.cap-leg i{width:8px;height:8px;border-radius:50%;flex:none}
.cap-lists{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:.7rem;border-top:1px dashed var(--line);padding-top:.5rem}
.cap-lists>div{min-width:0}
@media(max-width:640px){.cap-lists{grid-template-columns:1fr}}
.cap-lists .h{font-size:var(--fs-micro);font-weight:800;color:var(--muted);margin-bottom:.15rem}
.cap-li{display:flex;justify-content:space-between;gap:.5rem;font-size:var(--fs-meta);padding:.14rem 0}
/* صفوف تُفتح: مؤشّر وخلفية عند المرور والتركيز — والعلامة ⊕ تقول «هذا يُفتح» كبقية الصفحة */
.cap-li-btn{cursor:pointer;border-radius:7px;padding:.14rem .35rem;margin:0 -.35rem}
.cap-li-btn:hover{background:#fbfcfe}
.cap-li-btn:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
/* نافذة الشخص: ثلاث إحصاءات وشريط اثني عشر شهراً — خطةٌ صرفة بألوان عتبات التسكين */
.cap-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem;margin:.3rem 0 .2rem}
.cap-stat{background:#f8fafc;border:1px solid var(--line);border-radius:10px;padding:.45rem .6rem;min-width:0}
.cap-stat .l{display:block;font-size:var(--fs-micro);color:var(--muted);font-weight:700}
.cap-stat b{font-size:var(--fs-num-sm);font-weight:800}
.cap-stat small{font-size:10px;color:var(--faint)}
.cap-strip{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:3px;margin:.2rem 0 .4rem}
.cap-strip .cs{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;height:46px;border-radius:6px;padding:2px 1px 0;background:#f8fafc}
.cap-strip .cs i{display:block;width:100%;max-width:18px;border-radius:3px 3px 0 0;min-height:2px}
.cap-strip .cs b{font-size:9.5px;color:var(--faint);font-weight:700;line-height:1}
.cap-strip .cs.cur{outline:2px solid var(--brand);outline-offset:-2px}
@media(max-width:640px){.cap-stats{grid-template-columns:1fr 1fr}}
/* صحة المشاريع */
.hl-wrap{display:flex;gap:1rem;align-items:center;padding:.7rem 1rem .4rem;flex-wrap:wrap}
.hl-legend{display:flex;flex-direction:column;gap:.3rem;min-width:0;flex:1}
.hl-row{display:flex;align-items:center;gap:.5rem;font-size:var(--fs-body);border:none;background:none;font-family:inherit;cursor:pointer;padding:.18rem .35rem;border-radius:8px;text-align:start}
.hl-row:hover{background:#fbfcfe}
.hl-row .dot{width:9px;height:9px;border-radius:50%;flex:none}
.hl-row b{margin-inline-start:auto}
/* الأداء مقابل الخطة — أشرطة رصاصة مدمجة كالمرجع: اسم، نسبة، شريط رفيع، وعلامة «أين يجب أن نكون» */
.blt{padding:.42rem 0}
.blt .top{display:flex;justify-content:space-between;gap:.6rem;font-size:var(--fs-body);align-items:baseline}
.blt .top .n{color:var(--ink2);font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blt .top b{flex:none}
.blt .trk{position:relative;height:7px;border-radius:999px;background:#eef1f7;margin-top:.3rem;overflow:visible}
.blt .trk .fill{position:absolute;inset-inline-start:0;top:0;bottom:0;border-radius:999px}
.blt .trk .tick{position:absolute;top:-3px;bottom:-3px;width:2px;background:#c9a227;border-radius:2px}
/* الإيراد عبر السنة: الرسم وبجانبه صندوقا الفجوة والمتوقع — عمود واحد على الضيّق */
.trend-grid{padding:var(--pad-card-b);display:grid;grid-template-columns:1fr 168px;gap:.8rem;align-items:start}
@media(max-width:640px){.trend-grid{grid-template-columns:1fr}}
/* أهم العملاء — جدول مدمج كالمرجع: عميل، إيراد، مفتوح، حصة، حالة، إشارة */
.cl-note{padding:.45rem 1rem;border-bottom:1px dashed var(--line);font-size:var(--fs-micro)}
.cl-tbl{width:100%;border-collapse:collapse;font-size:var(--fs-body)}
.cl-tbl th{font-size:var(--fs-micro);color:var(--muted);font-weight:700;text-align:start;padding:.3rem .5rem;border-bottom:1px solid var(--line);white-space:nowrap}
.cl-tbl td{padding:.42rem .5rem;border-bottom:1px dashed var(--line);vertical-align:middle}
.cl-tbl tr:last-child td{border-bottom:none}
.cl-tbl tr:hover td{background:#fbfcfe}
.cl-av{display:inline-flex;width:26px;height:26px;border-radius:50%;background:linear-gradient(120deg,#eef2fb,#f3eefb);color:var(--brand);font-weight:800;font-size:11px;align-items:center;justify-content:center;flex:none}
.cl-nm{display:flex;gap:.5rem;align-items:center;min-width:0}
.cl-nm a{color:var(--ink2);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cl-sig{display:inline-flex;align-items:center;gap:.3rem;font-size:10px;font-weight:800;padding:.12rem .5rem;border-radius:999px;white-space:nowrap}
/* مخاطر التركّز */
.conc-wrap{display:flex;gap:1rem;align-items:center;padding:.7rem 1rem .5rem;flex-wrap:wrap}
.conc-legend{flex:1;min-width:0;display:flex;flex-direction:column;gap:.3rem}
.conc-li{display:flex;align-items:center;gap:.5rem;font-size:var(--fs-body)}
.conc-li .sw{width:9px;height:9px;border-radius:3px;flex:none}
.conc-li b{margin-inline-start:auto}
</style>`;

// ── من يرى أي وجه من الصفحة؟ ─────────────────────────────────────────────────
// مركز القيادة مبني من سبعة موارد: المشاريع والفرص والعملاء والعقود والفواتير وبنود الإيراد
// والموظفين. من يقرأ أياً منها على مستوى **القطاع فأوسع** يقود القطاع أو يخدمه على مستواه،
// فالشاشة شاشته كما هي. ومن نطاقه أضيق — مشاريعه التي يعمل عليها، أو ما يخصّه وحده — لا شأن
// له بمستهدفات القطاع ولا بخط فرصه: يرى قطاعه من موقعه هو («قطاعي»).
//
// القرار **مشتق من الصلاحيات لا من قائمة أدوار**: دور جديد لا يحتاج تعديل هذا الملف، وتضييق
// نطاق دور قائم يغيّر شاشته في اللحظة نفسها. وملاحظة دقيقة تفسد الفحص إن غابت: can(user,
// 'read', X) بلا صف هدف يعيد «صحيح» لمجرد وجود المنح مهما ضاق نطاقه — فهو يجيب «هل يقرأ؟»
// لا «إلى أين يصل؟». السؤال هنا نطاقي، وeffectiveScope وحده يجيبه.
// و«التقارير والمؤشرات» بين الموارد: الشاشة في أصلها تقريرُ قطاعٍ ولوحةُ مؤشراته، فمن يُمنح
// قراءتهما على مستوى القطاع فقد مُنح هذه الشاشة بعينها. غيابهما عن القائمة كان يُسقط مدير
// الإدارة — وقد صار منحُه للتقارير والمؤشرات قطاعياً بقرار المالك — إلى الوجه الشخصي «قطاعي»:
// يدخل من باب دُعي إليه فيجد شاشةً لا ربح فيها ولا إيراد ولا مستهدف. لا دور آخر يتغيّر بهذا:
// من كان منحه للتقارير أضيق من القطاع كان ساقطاً أصلاً ويبقى، ومن كان أوسع كان داخلاً بمورد آخر.
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

export async function sectorPage(user, opts = {}) {
  if (sectorViewMode(user).mode === 'personal') return await mySectorPage(user, opts);
  const year = Number(opts.year) || config.fiscalYear;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const win = WINS.some((w) => w[0] === opts.win) ? opts.win : 'week';
  // محوّل القطاع: قطاعات التسليم وحدها — الأربعة لا خامس لها. وحدة المساندة لا مركز قيادة
  // تجاري لها (بلا هدف ولا خط فرص)، ووضعها في المحوّل يجعلها قطاعاً في عين كل من يستعمله.
  // ملاحظة: القائمة تحكم أيضاً ما يُقبل من ?sector= — فطلب وحدة مساندة يعود إلى قطاع المستخدم.
  const allSectors = await all(`SELECT id, name_ar, color FROM sector
     WHERE active = 1 AND deleted_at IS NULL AND ${DELIVERY_SECTOR_SQL} ORDER BY sort_order`);
  const requested = opts.sector && allSectors.some((s) => s.id === opts.sector) ? opts.sector : null;
  // لا قطاع افتراضي مكتوب في الكود. كان السطران يسقطان إلى «SOLUTIONS» نصاً، فمستخدمٌ بلا قطاع
  // — عضو وحدة مساندة، أو حساب لم يُربط بقطاع بعد — يفتح الصفحة فيرى **مركز قيادة قطاع الحلول
  // كاملاً**: إيراده وخطّ فرصه ومستهدفاته ومشاريعه. والحارس على مسار الواجهة البرمجية لا يمرّ به
  // هذا المسار أصلاً. والفراغ هنا ليس خطأً يحتاج قيمة بديلة — هو حالة مصمَّمة أسفل مباشرة.
  const sectorId = user.scope === 'company'
    ? (requested || user.sector_id || allSectors[0]?.id || null)
    : (user.sector_id || null);

  const sd = sectorId ? await sectorDashboard(user, sectorId, { year }) : null;
  if (!sd) return layout({ user, active: 'sector', title: G.commandCenter, body: `<div class="empty-state"><div class="t">لا يوجد قطاع مرتبط بحسابك</div><div class="s">اطلب من مدير النظام ربطك بقطاع لعرض مركز قيادته.</div></div>` });

  const canInvoices = can(user, 'read', 'invoice');
  const canContracts = can(user, 'read', 'contract');
  const canMargin = canSeeSensitive(user, 'margin');
  // أسماء الأفراد وأحمالهم لمن يقرأ الموظفين — البقية يرون مجاميع الفريق بلا أسماء، كما
  // تُحجب بطاقة التحصيل عمّن لا يقرأ الفواتير. والأسماء من كشف التسكين (نطاق الأشخاص) لا من
  // مجاميع القطاع — KI-068.
  const canPeople = can(user, 'read', 'employee');
  const [chg, attn, fc, monthly, qRev, qBook, cover, staff, wins, team] = await Promise.all([
    changesSince(user, sectorId, sinceForWindow(win, now)),
    attentionFeed(user, sectorId, { year, today }),
    revenueForecast(sectorId, year),
    monthlyRevenue(sectorId, year),
    quarterlyRevenue(sectorId, year),
    quarterlyBookings(sectorId, year),
    pipelineCoverage(sectorId, year),
    sectorStaffing(sectorId, year),
    sectorWins(sectorId, year),
    canPeople ? sectorTeamDetail(user, { sector: sectorId, year, todayDate: today }) : null,
  ]);
  const margin = canMargin ? await grossMargin(sectorId, year) : null;

  // مراحل القمع من جدول المراحل الحقيقي — لا أسماء مكتوبة في الكود.
  // ── حدّ «الأرقام لا الأشخاص» (قرار قائم، v5.2) ──────────────────────────────
  // قمع المراحل أرقامٌ مجمَّعة — عدٌّ ومجاميع بلا عنوان فرصة ولا عميل — فيبقى **قطاعياً عمداً**
  // لكل من فُتح له مركز القيادة: قراءة صحة الخط الجماعية لا تكشف سرّ صفقة أحد. أما البنود
  // المسمّاة (حركات «ما تغيّر» وفرص «يحتاج انتباهك») فتتبع نطاق قائمة الفرص نفسه — القصّ هناك
  // في core/reports/{changes,attention}.js لا هنا.
  // ومن جدول المراحل يساراً: المرحلة الفارغة تظهر بصفرها ولا تختفي — وإلا قفز سهم الانتقال
  // فوقها فقارن مرحلتين غير متجاورتين.
  const pipe = await all(`SELECT st.id, st.name_ar, st.color, COUNT(o.id) AS "count", COALESCE(SUM(o.value_halalas),0) value_halalas,
      COALESCE(SUM(o.value_halalas * o.win_pct / 100.0),0) weighted
     FROM stage st LEFT JOIN opportunity o ON o.stage_id = st.id AND o.deleted_at IS NULL AND o.sector_id = ?
     WHERE st.is_won = 0 AND st.is_lost = 0
     GROUP BY st.id, st.name_ar, st.color, st.sort_order ORDER BY st.sort_order`, [sectorId]);
  // صفوف الفرص المفتوحة نفسها — تخدم متوسط العمر والمتوقفة وأعلى القيم وترشيح المرحلة،
  // فلا تُحسب الأرقام مرتين من استعلامين قد يفترقان.
  const openRows = await all(`SELECT o.id, o.title_ar, o.value_halalas, o.stage_id, o.client_id,
      COALESCE(substr(o.stage_changed_at,1,10), substr(o.created_at,1,10)) since, c.name_ar client
     FROM opportunity o JOIN stage st ON st.id = o.stage_id LEFT JOIN client c ON c.id = o.client_id
     WHERE st.is_won = 0 AND st.is_lost = 0 AND o.deleted_at IS NULL AND o.sector_id = ?`, [sectorId]);
  const activeC = canContracts ? await get(`SELECT COUNT(*) n, COALESCE(SUM(value_halalas),0) v FROM contract
     WHERE sector_id = ? AND deleted_at IS NULL AND status = 'ACTIVE'`, [sectorId]) : null;
  const secContracts = canContracts ? await all(`SELECT c.id, c.code, c.value_halalas, c.status, c.start_date, cl.name_ar client,
     (SELECT COALESCE(SUM(i.amount_halalas),0) FROM invoice i WHERE i.contract_id = c.id AND i.status != 'DRAFT' AND i.deleted_at IS NULL) invoiced
     FROM contract c LEFT JOIN client cl ON cl.id = c.client_id
     WHERE c.sector_id = ? AND c.deleted_at IS NULL ORDER BY c.value_halalas DESC LIMIT 10`, [sectorId]) : [];
  const revByProject = await all(`SELECT p.id, p.name_ar, p.status, p.rag, p.progress_pct,
       COALESCE(NULLIF(p.contract_value_halalas,0), NULLIF(p.budget_halalas,0), NULLIF(p.po_value_halalas,0)) cv,
       CASE WHEN COALESCE(p.contract_value_halalas,0)>0 THEN 'عقد' WHEN COALESCE(p.budget_halalas,0)>0 THEN 'ميزانية'
            WHEN COALESCE(p.po_value_halalas,0)>0 THEN 'أمر شراء' ELSE NULL END cvbasis,
       COALESCE(SUM(${netSql('rl.amount_halalas', 'rl.net_amount_halalas')}),0) rev
     FROM revenue_line rl LEFT JOIN project p ON p.id = rl.project_id
     WHERE rl.sector_id = ? AND rl.year = ? GROUP BY p.id, p.name_ar, p.status, p.rag, p.progress_pct, p.contract_value_halalas, p.budget_halalas, p.po_value_halalas
     ORDER BY rev DESC LIMIT 12`, [sectorId, year]);
  // إيراد كل عميل في هذا القطاع وهذه السنة — عبر مشروع البند (بند بلا مشروع لا يُنسب لعميل).
  const revByClient = await all(`SELECT p.client_id cid, COALESCE(SUM(${netSql('rl.amount_halalas', 'rl.net_amount_halalas')}),0) rev
     FROM revenue_line rl JOIN project p ON p.id = rl.project_id
     WHERE rl.sector_id = ? AND rl.year = ? AND p.client_id IS NOT NULL GROUP BY p.client_id`, [sectorId, year]);
  // وما بعد الترسية علنيٌّ داخل القطاع بالقرار نفسه («الأرقام لا الأشخاص»): السرّية تخصّ
  // الفرصة **قبل** ترسيتها، وصفقات السنة المكسوبة إنجاز قطاعٍ يُعرض لأهله كلهم — فتبقى قطاعية.
  const secWon = await all(`SELECT o.title_ar, o.value_halalas, c.name_ar client FROM opportunity o
     JOIN stage st ON st.id = o.stage_id LEFT JOIN client c ON c.id = o.client_id
     WHERE o.sector_id = ? AND o.year = ? AND st.is_won = 1 AND o.exclude_from_sales = 0 AND o.deleted_at IS NULL
     ORDER BY o.value_halalas DESC LIMIT 8`, [sectorId, year]);
  // القرار بلا مشروعٍ صفٌّ شركيّ لا قطاع له — وعرضه في كل مركز قطاع يُسرّب عناوين قرارات
  // القطاعات الأخرى لقارئٍ نطاقه قطاعه وحده. قرارات القطاع = قرارات مشاريعه.
  const recentDecisions = await all(`SELECT d.title, d.decided_by, substr(d.decided_at,1,10) dat, p.name_ar project
     FROM decision d JOIN project p ON p.id = d.project_id
     WHERE p.sector_id = ? AND d.deleted_at IS NULL ORDER BY d.decided_at DESC LIMIT 5`, [sectorId]);
  const pendingApprovals = await all(`SELECT ar.resource, ar.amount_halalas, ar.created_at FROM approval_request ar
     WHERE ar.sector_id = ? AND ar.status = 'PENDING' ORDER BY ar.created_at DESC LIMIT 6`, [sectorId]);
  // كل عدٍّ للمشاريع في هذا المركز بعدسة السنة المعروضة — قاعدة «مشروع السنة» الواحدة
  // (projectYearClause، نفس مرشّح صفحة المشاريع حرفاً): كانت هذه الاستعلامات عمياء عن السنة
  // فعرضت نافذة «على المسار 2026» مشاريعَ قديمة بلا تواريخ ولا إيراد (الجيوبارك، تجربة عسير…)
  // لا تعرضها صفحة المشاريع لنفس السنة — وقرّر المالك: «الموجود في صفحة المشاريع هو الصحيح».
  const pyc = projectYearClause(year, 'p.');
  const pycBare = projectYearClause(year);
  // المشاريع التي تحتاج نظر القائد — الحمراء أولاً، ومع كلٍّ أبرزُ خطرٍ مفتوح إن سُجِّل.
  const needProjects = await all(`SELECT p.id, p.name_ar, p.rag,
      (SELECT COUNT(*) FROM risk r WHERE r.project_id = p.id AND r.status != 'CLOSED' AND r.deleted_at IS NULL) risks,
      (SELECT r2.title FROM risk r2 WHERE r2.project_id = p.id AND r2.status != 'CLOSED' AND r2.deleted_at IS NULL
        ORDER BY CASE r2.probability WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END LIMIT 1) top_risk
     FROM project p WHERE p.sector_id = ? AND p.deleted_at IS NULL AND p.status = 'IN_PROGRESS' AND p.rag IN ('RED','AMBER')
       AND ${pyc.clause}
     ORDER BY CASE p.rag WHEN 'RED' THEN 0 ELSE 1 END, p.name_ar LIMIT 6`, [sectorId, ...pyc.params]);
  const healthLists = {};
  for (const rag of ['GREEN', 'AMBER', 'RED']) {
    healthLists[rag] = (sd.rag[rag]) ? await all(`SELECT id, name_ar, progress_pct FROM project
       WHERE sector_id = ? AND deleted_at IS NULL AND status = 'IN_PROGRESS' AND rag = ? AND ${pycBare.clause}
       ORDER BY name_ar LIMIT 30`, [sectorId, rag, ...pycBare.params]) : [];
  }
  // نسبة الإنجاز من مصدرها الواحد (المخرجات الموزونة) لا من العمود المخزَّن — قاعدة «رقم واحد
  // حقيقة واحدة»، والحارس البنيوي يسقط أي شاشة تخالفها.
  const progMapH = await effectiveProgress([...healthLists.GREEN, ...healthLists.AMBER, ...healthLists.RED]);

  // ── اختيار مرحلة من القمع (?stage=) — تصفية خادمية، حالة في الرابط لا في الذاكرة ──
  // «معلّقة» (قرار تأجيل) خارج مسار القمع كله: أشرطته ورأسه وأعماره وأعلى فرصه — وإلا قال
  // الرأس 150 والأشرطة 100 وحسب القارئ الفرق فرصة ضائعة. وتُرفض تصفيةً أيضاً.
  const openFlow = openRows.filter((o) => o.stage_id !== 'ON_HOLD');
  const selStage = pipe.find((s) => s.id === String(opts.stage || '') && s.id !== 'ON_HOLD') || null;
  const scoped = selStage ? openFlow.filter((o) => o.stage_id === selStage.id) : openFlow;
  const qs = (over = {}) => {
    const p = new URLSearchParams();
    p.set('year', String(year)); p.set('win', win);
    if (user.scope === 'company' && sectorId) p.set('sector', sectorId);
    if (selStage) p.set('stage', selStage.id);
    for (const [k, v] of Object.entries(over)) { if (v == null) p.delete(k); else p.set(k, String(v)); }
    return '/app/sector?' + p.toString();
  };

  const ageDays = (d) => (d ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(d)) / 86400000)) : 0);
  const avgAge = scoped.length ? Math.round(scoped.reduce((a, o) => a + ageDays(o.since), 0) / scoped.length) : 0;
  const stalledRows = scoped.filter((o) => ageDays(o.since) > (ROT_THRESHOLDS[o.stage_id] || ROT_THRESHOLDS.default));
  // «أعلى ٣ فرص» بندٌ مسمّى (عنوان + عميل) لا رقمٌ مجمَّع — فيتبع نطاق قائمة الفرص نفسه
  // (سياسة «الأرقام لا الأشخاص» v5.2، بنفس خيارات القصّ في core/reports/changes.js حرفياً):
  // مدير الإدارة يقرأ أسماء فرص إداراته، وقائد القطاع قطاعه. المتوسطات والأعمار تبقى مجاميع.
  const fOpp = scopeFilter(user, 'opportunity', 'read',
    { sectorCol: 'o.sector_id', ownerCol: 'o.owner_user_id', projectCol: 'o.id',
      grantCol: 'o.department_id', memberCol: 'o.id', deptCol: 'o.department_id' });
  const topOpps = await all(`SELECT o.id, o.title_ar, o.value_halalas, c.name_ar client
     FROM opportunity o JOIN stage st ON st.id = o.stage_id LEFT JOIN client c ON c.id = o.client_id
     WHERE st.is_won = 0 AND st.is_lost = 0 AND o.stage_id != 'ON_HOLD' AND o.deleted_at IS NULL
       AND o.sector_id = ? ${selStage ? 'AND o.stage_id = ?' : ''} AND ${fOpp.clause}
     ORDER BY o.value_halalas DESC LIMIT 3`,
  [sectorId, ...(selStage ? [selStage.id] : []), ...fOpp.params]);
  // فرص كل مرحلة المسماة لنوافذ تفصيل القمع — بنفس قصّ قائمة الفرص (سياسة «الأرقام لا
  // الأشخاص» v5.2): المجاميع على رأس النافذة قطاعية، والأسماء بنطاق القارئ وحده.
  const ddOppRows = await all(`SELECT o.id, o.title_ar, o.value_halalas, o.stage_id, c.name_ar client
     FROM opportunity o JOIN stage st ON st.id = o.stage_id LEFT JOIN client c ON c.id = o.client_id
     WHERE st.is_won = 0 AND st.is_lost = 0 AND o.stage_id != 'ON_HOLD' AND o.deleted_at IS NULL
       AND o.sector_id = ? AND ${fOpp.clause}
     ORDER BY o.value_halalas DESC`, [sectorId, ...fOpp.params]);

  const elapsed = yearElapsedPct(now, year);
  const nowM = currentMonthIndex(year);

  // لا شريط ملخصٍ سرديّ — بقرار المالك (v5.22): الأرقام تتحدث من الشريط مباشرة،
  // وشرائح الإيقاع على البطلين تحمل «متقدم/متأخر بكذا نقطة» بلا جملة إنشائية فوقها.
  const attainRev = sd.target_revenue_halalas ? Math.round((sd.revenue_halalas / sd.target_revenue_halalas) * 100) : null;
  const dRev = paceDelta(sd.revenue_halalas, sd.target_revenue_halalas, now, year);

  // مجاميع القمع تُحسب هنا (قبل الشريط) لأن شريط التغطية الصغير في الخلية يرسمها:
  // قيمة كل مرحلة مفتوحة — بيانات القمع نفسها، لا سلسلة زمنية مُختلَقة للتغطية.
  const funnelStages = pipe.filter((st) => st.id !== 'ON_HOLD');
  const onHoldStage = pipe.find((st) => st.id === 'ON_HOLD');
  const maxV = Math.max(1, ...funnelStages.map((s) => s.value_halalas));
  const openTotalV = funnelStages.reduce((a, s) => a + s.value_halalas, 0);
  const openTotalC = funnelStages.reduce((a, s) => a + s.count, 0);

  // ── (١) شريط المؤشرات — ستة لا غير بترتيب المالك: الإيراد، المبيعات، التغطية،
  // صحة التنفيذ، قدرة الفريق، يحتاج تدخلاً. البقية في بطاقاتها التفصيلية لا هنا. ──
  const attainSales = sd.target_sales_halalas ? Math.round((sd.sales_halalas / sd.target_sales_halalas) * 100) : null;
  const dSales = paceDelta(sd.sales_halalas, sd.target_sales_halalas, now, year);
  const ptWord = (n) => (Math.abs(n) <= 10 ? 'نقاط' : 'نقطة');
  const paceChip = (d) => d == null ? '' : d >= 3 ? `<span class="pace-chip up">متقدم بـ<b class="tnum">${d}</b> ${ptWord(d)}</span>`
    : d <= -3 ? `<span class="pace-chip down">متأخر بـ<b class="tnum">${Math.abs(d)}</b> ${ptWord(d)}</span>`
    : '<span class="pace-chip flat">على المسار</span>';
  // بطلا الشريط بحلقتي هدف بنفسجيتين سميكتين كالمرجع — والرقم الكامل في التفصيل، هنا المختصر
  const hero = (label, actualH, targetH, atn, dlt, dd, extra) => `
    <div class="kpi-cell kpi-hero cardclick" role="button" tabindex="0" data-action="open-dd" data-dd="${dd}" aria-label="${label} — التفصيل">
      ${atn != null ? ring(atn, { size: 74, sw: 10, color: 'var(--brand2)', lbl: 'من الهدف' }) : `<span class="ringw" style="width:74px;height:74px"><span style="font-size:10px;color:var(--faint);text-align:center;line-height:1.5">بلا هدف<br>مسجَّل</span></span>`}
      <div style="min-width:0">
        <div class="lbl">${label} <span style="color:var(--faint)" aria-hidden="true">⊕</span></div>
        <div class="num tnum" title="${fmtSar(actualH)}">${sarShort(actualH)}</div>
        <div class="tgt">${targetH ? `من هدف <span class="tnum">${sarShort(targetH)}</span>` : 'لا هدف مسجّل لهذه السنة'} ${paceChip(dlt)}</div>
        ${extra || ''}
      </div>
    </div>`;
  const ragActive = (sd.rag.GREEN || 0) + (sd.rag.AMBER || 0) + (sd.rag.RED || 0);
  const needsN = (sd.rag.AMBER || 0) + (sd.rag.RED || 0);
  const okBadge = `<span class="kpi-ok" aria-hidden="true">${icon('check')}</span>`;
  const mini = (label, ic, val, sub, color, act, extra = '') => `
    <${act ? 'a' : 'div'} class="kpi-cell${act ? ' cardclick' : ''}" ${act || ''} style="text-decoration:none">
      <span class="l">${ic ? icon(ic) : ''}${label}</span><span class="v tnum" style="color:${color || 'var(--ink2)'}">${val}</span>${sub ? `<span class="s">${sub}</span>` : ''}${extra}
    </${act ? 'a' : 'div'}>`;
  // أساسٌ واحد للفريق على الصفحة كلها: من يقرأ الموظفين يقرأ كشف التسكين (خطةً صرفة، بنطاقه)،
  // ومن لا يقرؤهم يقرأ مجاميع القطاع — فلا يحمل الصفُّ العلوي رقماً وبطاقةُ الطاقة رقماً آخر.
  const bandLoad = team ? team.avgNow : (staff.currentMonth ? (staff.teamCurrent ?? staff.teamUtil) : staff.teamUtil);
  const teamSize = team ? team.people.length : staff.headcount;
  // شريط صغير تحت التغطية: قيمة كل مرحلة مفتوحة من صفوف القمع نفسها — لا سلسلة مُختلَقة
  const covSpark = funnelStages.some((s) => s.value_halalas > 0)
    ? `<span class="kpi-spark" aria-hidden="true">${funnelStages.map((s) =>
      `<span style="height:${Math.max(2, Math.round((s.value_halalas / maxV) * 16))}px" title="${esc(s.name_ar)}: ${fmtSar(s.value_halalas)}"></span>`).join('')}</span>` : '';
  const kpiStrip = `<div class="card kpi-band">
    ${hero(`${G.revenue} المحقق ${year}`, sd.revenue_halalas, sd.target_revenue_halalas, attainRev, dRev, 'secrev')}
    ${hero(`${G.sales} ${year}`, sd.sales_halalas, sd.target_sales_halalas, attainSales, dSales, 'secwins',
    `<div class="tgt">${countAr(wins.won, { one: 'صفقة مكسوبة واحدة', two: 'صفقتان مكسوبتان', few: 'صفقات مكسوبة', many: 'صفقة مكسوبة' })}</div>`)}
    ${mini('تغطية خط الفرص', 'filter', cover?.coverage != null ? `×${cover.coverage}` : '—',
    'المفتوح ÷ المتبقي من هدف المبيعات', (cover?.coverage ?? 1) < 1 ? 'var(--amber)' : 'var(--ink2)',
    `href="/app/opportunities?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}"`, covSpark)}
    ${mini('صحة التنفيذ', 'check', ragActive ? `${sd.rag.GREEN || 0}/${ragActive}${ragActive && !needsN ? okBadge : ''}` : '—',
    ragActive ? 'على المسار من المقيَّمة الصحة' : 'لا مشاريع مقيَّمة الصحة', 'var(--green)',
    ragActive ? `role="button" tabindex="0" data-action="open-dd" data-dd="sec-health-GREEN"` : '')}
    ${mini('قدرة الفريق', 'team', `${bandLoad}%`, `متوسط ${G.utilization} · ${countAr(teamSize, { one: 'موظف واحد', two: 'موظفان', few: 'موظفين', many: 'موظفاً' })}`,
    bandLoad > UTIL_BANDS.OVER_ABOVE ? 'var(--red)' : 'var(--ink2)', `href="/app/staffing?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}"`)}
    ${mini('تحتاج تدخلاً', 'risk', needsN ? String(needsN) : `0${okBadge}`, needsN ? `${G.hCritical} ${sd.rag.RED || 0} · ${G.hAtRisk} ${sd.rag.AMBER || 0}` : 'لا مشروع متعثر', needsN ? 'var(--red)' : 'var(--ink2)', needsN ? `role="button" tabindex="0" data-action="open-dd" data-dd="sec-health-RED"` : '')}
  </div>`;
  // ── (٣) عدسة الفترة — تسكن رأس بطاقة «ما تغيّر» نفسها (المرجع)، وهي روابط تعيد التحميل ──
  const lens = `<div class="seg" role="group" aria-label="عدسة الفترة">${WINS.map(([k, l]) =>
    `<a class="${k === win ? 'on' : ''}" style="text-decoration:none" href="${qs({ win: k })}" ${k === win ? 'aria-current="true"' : ''}>${l}</a>`).join('')}</div>`;
  const stageChip = selStage ? `<a class="chip on" href="${qs({ stage: null })}" title="إلغاء تصفية المرحلة">
      المرحلة: ${esc(selStage.name_ar)} <span aria-hidden="true">✕</span></a>
    <span style="font-size:var(--fs-micro);color:var(--muted)">أرقام القمع وأعلى الفرص وأعمارها مصفّاة بهذه المرحلة</span>` : '';
  const toolbar = `<div class="toolbar" style="margin-bottom:var(--gap)">
    ${stageChip}
    <span class="spacer"></span>
    <span class="pill" style="background:#fdf6e3;color:#8a6d1a;gap:.4rem">${nowDot('')} ${G.yearElapsed(elapsed)}</span>
  </div>`;

  // ── (٤) قمع الفرص — عرض المرحلة ∝ قيمتها (أو عددها بالمبدّل)، والنقر يرشّح ──
  // صفّ القمة «إجمالي الفرص» مجموعُ ما تحته لا رقمٌ جديد — ثم كل مرحلة شريطاً أفقياً يضيق.
  // العرض نسبيٌّ **إلى الإجمالي نفسه** (القمة 100%): مقياسٌ واحد لكل الأشرطة فالنسب بينها
  // صادقة — لا أرضية تجميلية تجعل 5% تبدو ثلث 100%. والرقم مطبوع على كل شريط، وضِيقُ
  // الشريط الصغير يحرسه min-width في CSS لا تحريفُ المقياس.
  // النقر يفتح نافذة تفصيل المرحلة (فرصها وقيمها وأزرار التصفية) — لا ترشيحاً صامتاً لا يُرى
  // أثره. ونسبة «الانتقال» حُذفت: سجل المراحل شبه فارغ (أغلب الفرص استوردت بمرحلتها) فأي
  // معدل عبور منه كذبة إحصائية — تعود النسبة حين يتراكم سجل انتقالات حقيقي.
  const fnlRow = ({ dd, on, dim, title, name, count, value, wv, wc, color }) => `
    <div class="fnl-row${on ? ' on' : dim ? ' dim' : ''}" role="button" tabindex="0" data-action="open-dd" data-dd="${dd}" title="${title}" aria-label="${title}">
      <span class="n">${name}</span>
      <span class="fnl-track"><span class="fnl-bar" data-wv="${wv}" data-wc="${wc}" style="width:${wv}%;background:${color}"><b class="cnt tnum">${count}</b></span></span>
      <span class="fnl-val tnum">${sarShort(value)}</span>
    </div>`;
  const funnelRows = openTotalC === 0 ? '' : [
    fnlRow({ dd: 'fnl-ALL', on: false, dim: !!selStage,
      title: `كل الفرص المفتوحة: ${countAr(openTotalC, { one: 'فرصة واحدة', two: 'فرصتان', few: 'فرص', many: 'فرصة', zero: 'لا فرص' })} بقيمة ${fmtSar(openTotalV)} — انقر للتفصيل`,
      name: 'الإجمالي المفتوح', count: openTotalC, value: openTotalV,
      wv: 100, wc: 100, color: funnelColor(0, funnelStages.length + 1) }),
    ...funnelStages.map((s, i) => {
      const wv = Math.round((s.value_halalas / Math.max(1, openTotalV)) * 100);
      const wc = Math.round((s.count / Math.max(1, openTotalC)) * 100);
      const on = selStage && selStage.id === s.id;
      return fnlRow({ dd: `fnl-${s.id}`, on, dim: selStage && !on,
        title: `${esc(s.name_ar)}: ${countAr(s.count, { one: 'فرصة واحدة', two: 'فرصتان', few: 'فرص', many: 'فرصة', zero: 'لا فرص' })} بقيمة ${fmtSar(s.value_halalas)} — انقر لعرض فرص المرحلة`,
        name: esc(s.name_ar), count: s.count, value: s.value_halalas,
        wv, wc, color: funnelColor(i + 1, funnelStages.length + 1) });
    }),
  ].join('');
  // أعمار الفرص — من الصفوف المفتوحة نفسها (وتُرشَّح بالمرحلة المختارة)
  const AGE_BUCKETS = [
    { label: 'أقل من أسبوعين', max: 14 }, { label: 'أسبوعان إلى شهر', max: 30 },
    { label: 'شهر إلى شهرين', max: 60 }, { label: 'أكثر من شهرين', max: Infinity }];
  const aging = AGE_BUCKETS.map((b) => ({ ...b, n: 0, v: 0 }));
  for (const o of scoped) {
    const b = aging.find((x) => ageDays(o.since) <= x.max);
    if (b) { b.n++; b.v += o.value_halalas || 0; }
  }
  const agingMax = Math.max(1, ...aging.map((b) => b.v));
  const agingRows = aging.map((b, i) => `<div style="display:flex;align-items:center;gap:.5rem;font-size:var(--fs-meta);padding:.16rem 0">
      <span style="flex:0 0 96px;color:var(--muted)">${b.label}</span>
      <div class="bar" style="flex:1"><span style="width:${Math.round((b.v / agingMax) * 100)}%;background:${i >= 2 ? 'var(--amber)' : 'var(--brand)'}"></span></div>
      <span class="tnum" style="flex:none;font-weight:700">${b.n}</span>
      <span class="tnum" style="flex:none;color:var(--muted);font-size:var(--fs-micro)">${sarShort(b.v)}</span>
    </div>`).join('');
  const topOppRows = topOpps.map((o, i) => `<div class="fnl-kv">
      <a href="/app/opportunity/${esc(o.id)}" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink2)"><span class="tnum" style="color:var(--faint)">${i + 1}</span> ${esc(o.title_ar)}${o.client ? ` <span style="color:var(--faint);font-size:var(--fs-micro)">· ${esc(o.client)}</span>` : ''}</a>
      <b class="tnum">${o.value_halalas ? sarShort(o.value_halalas) : '—'}</b>
    </div>`).join('') || '<div style="font-size:var(--fs-meta);color:var(--faint)">لا فرص ضمن هذه التصفية</div>';
  const oppsHref = `/app/opportunities?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}`;
  // لا شارة «قيمة مرجّحة» على الرأس — المالك ألغى مفهوم الترجيح: القيمة الإجمالية وحدها تُعرض.
  const funnelCard = card(`
    <div class="card-head">
      <span class="t">${G.funnel}${selStage ? ` — مرحلة ${esc(selStage.name_ar)}` : ''}</span>
      <span class="aux">
        <div class="seg" role="group" aria-label="مقياس عرض القمع">
          <button type="button" class="on" aria-pressed="true" data-action="fnl-mode" data-mode="value">بالقيمة</button>
          <button type="button" aria-pressed="false" data-action="fnl-mode" data-mode="count">بالعدد</button>
        </div></span></div>
    <div class="fnl-stats">
      <div class="fnl-stat">
        <div class="h">${icon('risk')} متوقفة تحتاج متابعة</div>
        <div class="v tnum" style="color:${stalledRows.length ? 'var(--amber)' : 'var(--ink2)'}">${stalledRows.length}</div>
        <div class="s tnum">بقيمة ${sarShort(stalledRows.reduce((a, o) => a + (o.value_halalas || 0), 0))}</div>
      </div>
      <div class="fnl-stat">
        <div class="h">${icon('clock')} متوسط عمر المرحلة</div>
        <div class="v tnum">${dayWord(avgAge)}</div>
        <div class="s">${selStage ? 'ضمن المرحلة المختارة' : 'لكل الفرص المفتوحة'}</div>
      </div>
    </div>
    <div style="padding:.5rem .55rem .2rem;min-width:0">
      ${funnelRows ? `<div class="fnl-cols" aria-hidden="true"><span></span><span>العدد</span><span>القيمة</span></div>` : ''}
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0">${funnelRows || `<div class="empty-mini">${icon('filter')} لا فرص مفتوحة الآن — تُنشأ من صفحة «${G.opportunities || 'الفرص'}»</div>`}
        ${onHoldStage && onHoldStage.count ? `<div style="font-size:var(--fs-micro);color:var(--muted);border-top:1px dashed var(--line);padding-top:.4rem;margin-top:.2rem">خارج القمع: <b class="tnum">${countAr(onHoldStage.count, { one: 'فرصة واحدة معلّقة', two: 'فرصتان معلّقتان', few: 'فرص معلّقة', many: 'فرصة معلّقة' })}</b> بقيمة <b class="tnum">${sarShort(onHoldStage.value_halalas)}</b> — بقرار تأجيل يُراجع دورياً</div>` : ''}</div>
    </div>
    <div class="fnl-box">
      <div class="h">${icon('trend')} أعلى ${countAr(Math.min(3, topOpps.length) || 3, { one: 'فرصة', two: 'فرصتين', few: 'فرص', many: 'فرص' })} قيمةً</div>
      ${topOppRows}
    </div>
    <div style="padding:.45rem .9rem .5rem;border-top:1px dashed var(--line);margin-top:.45rem">
      <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted);margin-bottom:.2rem">عمر الفرص في مرحلتها الحالية${selStage ? ` — مرحلة ${esc(selStage.name_ar)}` : ''}</div>${agingRows}
    </div>
    <div class="card-foot"><a href="${oppsHref}">عرض جميع الفرص <span aria-hidden="true">←</span></a></div>`, 'band b-violet');

  // ── (٥) «ما تغيّر» — سجلات مؤرّخة منسَّقة، بفئات وحدّة، خمسة أولاً والبقية بنقرة ──
  const relDay = (at) => {
    const d = Math.floor((Date.parse(today) - Date.parse(String(at).slice(0, 10))) / 86400000);
    if (!Number.isFinite(d) || d < 0) return String(at).slice(0, 10);
    if (d === 0) return 'اليوم';
    if (d === 1) return 'أمس';
    if (d === 2) return 'قبل يومين';
    if (d <= 10) return `قبل ${d} أيام`;
    return String(at).slice(0, 10);
  };
  // الفئات الست ثابتة الحضور (v5.22) — المحتوى نفسه مقصوص خادمياً بنطاق القارئ، فشارة
  // «المالية» لمن لا يقرأ الفواتير تعرض فراغاً مدمجاً لا سراً.
  const catDefs = [['all', 'الكل'], ['opp', 'الفرص'], ['prj', G.projects], ['client', G.clients], ['team', 'الفريق'], ['fin', 'المالية']];
  const chgCats = catDefs.map(([k, l]) => `<button type="button" class="chg-cat${k === 'all' ? ' on' : ''}" aria-pressed="${k === 'all'}" data-action="chg-cat" data-cat="${k}">${l}</button>`).join('');
  const SHOW_CHG = 5;
  const chgRows = chg.items.map((it, i) => {
    const [bg, fg] = it.won ? ['#dcfce7', 'var(--green)'] : it.lost ? ['#fee2e2', 'var(--red)'] : (CHG_TONE[it.kind] || CHG_TONE.activity);
    const [sevL, sevBg, sevFg] = CHG_SEV(it);
    return `<a class="chg${it.won ? ' won' : ''}${it.lost ? ' lost' : ''}" href="${esc(it.href)}" data-cat="${CHG_CAT[it.kind] || 'new'}"${i >= SHOW_CHG ? ' data-extra hidden' : ''}>
      <span class="ic" style="background:${bg};color:${fg}">${icon(CHG_IC[it.kind] || 'history')}</span>
      <span class="tx"><span class="h">${esc(it.title)}${it.code ? ` <bdi style="color:var(--faint);font-size:var(--fs-micro)">${esc(it.code)}</bdi>` : ''}</span>${it.sub ? `<span class="s">${esc(it.sub)}</span>` : ''}</span>
      <span class="pill" style="background:${sevBg};color:${sevFg};flex:none">${sevL}</span>
      <span class="meta">${it.amount_halalas ? `<span class="amt tnum">${fmtSar(it.amount_halalas)}</span>` : ''}<span class="d tnum">${relDay(it.at)}</span></span>
    </a>`;
  }).join('');
  // صدى النافذة «منذ أسبوع/منذ شهر…» لا «هذا الأسبوع/هذا الشهر»: النافذة متدحرجة بعدد أيام
  // (changes.js) لا فترة تقويمية — وعنوانٌ تقويمي فوق صفوفٍ مؤرَّخة خارج فترته يناقض نفسه.
  const winEcho = WINS.find((w) => w[0] === win)[2];
  const changesCard = card(`
    <div class="card-head"><span class="t">${G.whatChanged} ${winEcho}</span>
      <span class="aux">${lens}</span></div>
    <div class="chg-cats">${chgCats}</div>
    <div id="chg-list" style="padding:.45rem .5rem;display:flex;flex-direction:column;gap:2px;max-height:430px;overflow-y:auto;flex:1">
      ${chgRows || `<div class="empty-mini">${icon('history')} لا تغييرات مسجَّلة خلال هذه الفترة — وسّع العدسة إلى الشهر أو الربع</div>`}
    </div>
    ${chg.items.length > SHOW_CHG ? `<div class="card-foot"><button type="button" data-action="chg-more">عرض كل التغييرات (<span class="tnum">${chg.items.length}</span>) <span aria-hidden="true">←</span></button></div>` : ''}`, 'band b-blue');

  // ── (٦) يحتاج تدخلك الآن — ستة كحد أقصى، مرتبة بأثر القرار (ترتيب المصدر نفسه) ──
  // دائرة الرتبة تلبس لون حدّة البند نفسه (أحمر تصرّف، كهرماني راقب، رمادي أخبار) لا موقعه
  // في القائمة — فالترقيم يقول الترتيب واللون يقول الحدّة، ولا يكذب أحدهما على الآخر.
  const rankTone = (t) => t === 'red' ? ['#fee2e2', '#991b1b'] : t === 'amber' ? ['#fef3c7', '#92400e'] : ['#f1f5f9', '#64748b'];
  const attnItems = attn.slice(0, 6).map((a, i) => {
    const [rb, rf] = rankTone(a.tone);
    return `
    <div class="attn">
      <span class="rank tnum" style="background:${rb};color:${rf}">${i + 1}</span>
      <span class="tx"><span class="h">${esc(a.title)}</span>${a.sub ? `<span class="s">${esc(a.sub)}</span>` : ''}</span>
      ${a.dd ? `<button class="btn btn-sm go" data-action="open-dd" data-dd="${esc(a.dd)}">${icon(a.icon)} ${esc(a.action)}</button>`
      : `<a class="btn btn-sm go" href="${a.href}${a.href.includes('?') ? '&' : '?'}year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}">${icon(a.icon)} ${esc(a.action)}</a>`}
    </div>`;
  }).join('');
  const attnCard = card(`
    <div class="card-head">
      <span class="t">${G.attention}</span>
      ${attn.length ? `<span class="attn-count tnum">${Math.min(attn.length, 6)}</span>` : ''}
      <span class="aux" style="font-size:var(--fs-micro);color:var(--faint)">مرتبة حسب أثر القرار</span>
    </div>
    ${attnItems ? `<div class="attn-cols" aria-hidden="true"><span>الأولوية</span><span>لماذا يهم؟</span><span>الإجراء المقترح</span></div>` : ''}
    <div style="padding:.15rem .8rem .5rem;display:flex;flex-direction:column;flex:1">
      ${attnItems || `<div class="alert ok" style="justify-content:center;margin:.5rem 0">${icon('approvals')} ${G.nothingNeedsYou} — ${G.allGood}</div>`}
    </div>
    <div class="card-foot"><a href="/app/approvals">عرض ${G.decisions} والاعتمادات <span aria-hidden="true">←</span></a></div>`, 'band b-red');

  // ── (٧) قدرة الفريق — طيف حِمل حقيقي من تسكين الشهر، بعتبات المنصة نفسها (70/110) ──
  // العتبات ليست من المرجع البصري بل من الكود القائم: <70 سعة متاحة، 70–110 ضمن النطاق،
  // >110 فوق الطاقة — وهي نفسها في لوحة التسكين وتنبيه «فوق الطاقة». عتبة جديدة هنا كانت
  // ستجعل الشاشتين تحكمان على الشخص نفسه حكمين مختلفين.
  // الطبقة المسمّاة (الصور الرمزية والقائمتان والنوافذ) من كشف التسكين حين يقرأ القارئ
  // الموظفين — خطةً صرفة (`planNow`)؛ ومن لا يقرؤهم يرى مجاميع `sectorStaffing` بلا أسماء.
  const nowMonth = staff.currentMonth;                       // 0 حين تكون السنة غير الجارية
  const emps = team
    ? team.people.map((p) => ({ id: p.id, name: p.name_ar, job: p.job_title, projects: p.projects.length,
      months: p.months, utilization: p.annual, current: p.planNow }))
    : (staff.employees || []);
  // سنةٌ غير جارية لا «شهر حالي» لها: current يعود صفراً للجميع، فبِناء العدّادات عليه كان
  // سيقول «الكل بلا تسكين» عن سنةٍ اشتغلوا فيها. الوضع السنوي يقرأ متوسط السنة بدلاً منه.
  const loadOf = (e) => (nowMonth ? e.current : e.utilization);
  const teamLoad = bandLoad;
  const capWindows = [['now', 'هذا الشهر'], ['next', 'الشهر القادم'], ['q', 'الأشهر الثلاثة القادمة']];
  const winVal = (e, w) => {
    if (!nowMonth) return e.utilization;
    if (w === 'now') return e.current;
    if (w === 'next') return nowMonth < 12 ? e.months[nowMonth] : 0;
    const span = e.months.slice(nowMonth, nowMonth + 3);
    return span.length ? Math.round(span.reduce((a, b) => a + b, 0) / span.length) : 0;
  };
  const { FREE_BELOW, OVER_ABOVE } = UTIL_BANDS;
  const capPos = (v) => Math.min(125, Math.max(0, v)) / 125 * 100;
  const overNow = emps.filter((e) => loadOf(e) > OVER_ABOVE);
  const freeNow = emps.filter((e) => loadOf(e) === 0);
  const midNow = emps.filter((e) => loadOf(e) > 0 && loadOf(e) <= OVER_ABOVE);
  const capAv = (canPeople ? emps.slice(0, 24) : []).map((e, i) => {
    const vNow = winVal(e, nowMonth ? 'now' : 'q'), vNext = winVal(e, 'next'), vQ = winVal(e, 'q');
    const cls = loadOf(e) > OVER_ABOVE ? ' over' : loadOf(e) === 0 ? ' free' : '';
    return `<button type="button" class="cap-av${i % 2 ? ' r2' : ''}${cls}" style="left:${capPos(vNow).toFixed(1)}%"
      data-action="cap-person" data-emp="${esc(e.id || '')}" data-name="${esc(e.name)}" data-job="${esc(e.job || '')}" data-projects="${e.projects}"
      data-now="${vNow}" data-next="${vNext}" data-q="${vQ}"
      title="${esc(e.name)}${e.job ? ' · ' + esc(e.job) : ''} — الحِمل ${nowMonth ? vNow : e.utilization}% · ${countAr(e.projects, { one: 'مشروع واحد', two: 'مشروعان', few: 'مشاريع', many: 'مشروعاً' })}"
      aria-label="${esc(e.name)} — الحِمل ${nowMonth ? vNow : e.utilization}% — التفصيل">${esc(String(e.name || '؟').trim().charAt(0))}</button>`;
  }).join('');
  // صفوف القائمتين أزرار تفتح نافذة الشخص نفسها — لا نصّ جامد بجوار صورةٍ تُفتح.
  const capList = (rows, valFn) => rows.slice(0, 5).map((e) => `<div class="cap-li${e.id ? ' cap-li-btn' : ''}"${e.id ? ` role="button" tabindex="0" data-action="cap-person" data-emp="${esc(e.id)}" aria-label="${esc(e.name)} — التفصيل"` : ''}>
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name)}${e.job ? ` <span style="color:var(--faint);font-size:var(--fs-micro)">· ${esc(e.job)}</span>` : ''}</span>
      <b class="tnum" style="flex:none">${valFn(e)}%${e.id ? ' <span style="color:var(--faint)" aria-hidden="true">⊕</span>' : ''}</b></div>`).join('')
    || '<div style="font-size:var(--fs-meta);color:var(--faint)">لا أحد ضمن هذه الفئة الآن</div>';
  const staffingHref = `/app/staffing?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}`;
  // مُسكَّنون على أعمال القطاع من خارج كشف القارئ (قطاعٌ آخر، أو إدارةٌ خارج نطاقه): العدّ
  // يُقال ولا يُخفى — وإلا قرأ القائد «١٧ في الفريق» هنا و«٢٤» في تقريره ولم يعرف لماذا.
  const outsideRoster = team ? Math.max(0, (staff.employees || []).length - emps.length) : 0;
  // الشهر القادم من الأرقام الحاضرة: من يتفرّغ ومن يتجاوز — قرار توزيعٍ قبل أن يقع.
  const nextHint = (() => {
    if (!nowMonth || nowMonth >= 12 || !emps.length) return '';
    const freeing = emps.filter((e) => loadOf(e) > 0 && winVal(e, 'next') === 0).length;
    const overNext = emps.filter((e) => winVal(e, 'next') > OVER_ABOVE).length;
    if (!freeing && !overNext) return '';
    const parts = [];
    if (freeing) parts.push(`يتفرّغ <b class="tnum">${freeing}</b>`);
    if (overNext) parts.push(`يتجاوز الطاقة <b class="tnum" style="color:var(--red)">${overNext}</b>`);
    return `<div style="font-size:var(--fs-micro);color:var(--muted);padding:0 0 .3rem">الشهر القادم (${monthLabel(nowMonth)}): ${parts.join(' · ')}</div>`;
  })();
  const capEmptyState = !emps.length;
  const capCard = card(`
    <div class="card-head">
      <span class="t">طاقة الفريق</span>
      <span class="aux">
        ${nowMonth && canPeople && !capEmptyState ? `<div class="seg" role="group" aria-label="نافذة الحِمل">${capWindows.map(([k, l], i) =>
    `<button type="button" class="${i === 0 ? 'on' : ''}" aria-pressed="${i === 0}" data-action="cap-win" data-w="${k}">${l}</button>`).join('')}</div>` : ''}</span></div>
    ${capEmptyState ? `<div class="empty-state" style="flex:1">
      <div class="t">${team ? 'لا موظفين ضمن نطاقك في هذا القطاع' : `لا تسكين مسجَّلاً لسنة ${year}`}</div>
      <div class="s">${team ? 'يُضاف الموظفون من صفحة الفريق، ويُسكَّنون من لوحة التسكين.' : 'يُسجَّل التسكين من لوحة التسكين فتظهر الطاقة هنا.'}</div>
    </div>` : `
    <div class="cap-gauge">
      <span class="cw">
        ${semiGauge([
    { v: midNow.length, color: 'var(--green)' },
    { v: freeNow.length, color: 'var(--brand2)' },
    { v: overNow.length, color: 'var(--red)' },
  ], { size: 176, sw: 18 })}
        <span class="cc"><b class="tnum">${teamSize}</b><small>${team ? 'في كشفك' : 'في الفريق'}</small></span>
      </span>
      <div class="cap-avg">متوسط ${G.utilization} <b class="tnum" style="color:${teamLoad > OVER_ABOVE ? 'var(--red)' : 'var(--ink2)'}">${teamLoad}%</b></div>
      <div class="cap-leg">
        <span><i style="background:var(--green)"></i>ضمن الطاقة <b class="tnum">${midNow.length}</b></span>
        <span><i style="background:var(--brand2)"></i>${nowMonth ? 'بلا تسكين الآن' : 'بلا تسكين في السنة'} <b class="tnum">${freeNow.length}</b></span>
        <span><i style="background:var(--red)"></i>${G.overloaded} <b class="tnum" style="color:${overNow.length ? 'var(--red)' : 'inherit'}">${overNow.length}</b></span>
      </div>
    </div>
    <div style="padding:0 1rem">
      <div class="cap-axis" dir="ltr" data-staffing="${staffingHref}">
        <div class="cap-band" role="img" aria-label="طيف الحِمل: حتى ${FREE_BELOW}% سعة متاحة، من ${FREE_BELOW} إلى ${OVER_ABOVE} ضمن الطاقة، وفوق ${OVER_ABOVE} تجاوز للطاقة"></div>
        ${capAv || `<div dir="rtl" style="position:absolute;inset-inline:0;top:18px;text-align:center;font-size:var(--fs-micro);color:var(--muted)">أسماء الأفراد وأحمالهم تظهر لمن يملك قراءة الموظفين</div>`}
      </div>
      <div class="cap-ticks" dir="ltr">
        <span style="left:0%">0%</span><span style="left:${capPos(FREE_BELOW)}%">${FREE_BELOW}%</span><span style="left:${capPos(OVER_ABOVE)}%">${OVER_ABOVE}%</span><span style="left:98%">+120%</span>
      </div>
      <div id="cap-caption" style="font-size:var(--fs-micro);color:var(--muted);padding:.15rem 0 .25rem">${nowMonth ? `النافذة: هذا الشهر (${monthLabel(nowMonth - 1)}) — والقادمة ضمن تسكين ${year} وحدها` : 'النافذة: متوسط السنة'} · الحدود من قواعد التسكين نفسها: ${FREE_BELOW}% و${OVER_ABOVE}%${canPeople ? ' · اضغط على شخصٍ لتفصيله' : ''}</div>
      ${nextHint}
      ${outsideRoster ? `<div style="font-size:var(--fs-micro);color:var(--faint);padding:0 0 .3rem">و<b class="tnum">${outsideRoster}</b> ${outsideRoster === 1 ? 'آخر مُسكَّن' : outsideRoster === 2 ? 'آخران مُسكَّنان' : 'آخرون مُسكَّنون'} على أعمال القطاع من خارج كشفك — يظهرون في صفحات مشاريعهم</div>` : ''}
    </div>
    ${canPeople ? `<div class="cap-lists" style="padding:.4rem 1rem .55rem;flex:1">
      <div><div class="h">متاحون للعمل — الأقل حِملاً</div>${capList([...emps].filter((e) => loadOf(e) < FREE_BELOW).sort((a, b) => loadOf(a) - loadOf(b)), loadOf)}</div>
      <div><div class="h">يحتاجون إعادة توزيع — تجاوزوا الطاقة</div>${capList([...overNow].sort((a, b) => loadOf(b) - loadOf(a)), loadOf)}</div>
    </div>` : '<div style="flex:1"></div>'}`}
    <div class="card-foot"><a href="${staffingHref}">لوحة التسكين الكاملة <span aria-hidden="true">←</span></a></div>`, 'band b-amber');

  // ── (٨) صحة المشاريع — دونات واحد للحالة، وأبرز ما يحتاج نظر القائد بسببه ──
  const HEALTH = [['GREEN', G.hOnTrack, 'var(--green)'], ['AMBER', G.hAtRisk, 'var(--amber)'], ['RED', G.hCritical, 'var(--red)']];
  const healthSegs = HEALTH.map(([k, l, c]) => ({ k, l, color: c, v: sd.rag[k] || 0 }));
  const healthRows = HEALTH.map(([k, l, c]) => `<button type="button" class="hl-row" data-action="open-dd" data-dd="sec-health-${k}" ${!(sd.rag[k]) ? 'disabled style="opacity:.45;cursor:default"' : ''}>
      <span class="dot" style="background:${c}"></span><span>${l}</span>
      <b class="tnum" style="color:${c};font-size:var(--fs-num-sm)">${ragActive ? Math.round(((sd.rag[k] || 0) / ragActive) * 100) : 0}%</b>
      <span class="tnum" style="color:var(--faint);font-size:var(--fs-micro)">${sd.rag[k] || 0}</span>
    </button>`).join('');
  const needRows = needProjects.slice(0, 3).map((p) => `<a href="/app/project/${esc(p.id)}" style="display:block;padding:.4rem 0;border-bottom:1px dashed var(--line)">
      <div style="display:flex;align-items:center;gap:.45rem;font-size:var(--fs-body)">
        <span style="width:8px;height:8px;border-radius:50%;background:${p.rag === 'RED' ? 'var(--red)' : 'var(--amber)'};flex:none"></span>
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700">${esc(p.name_ar)}</span>
      </div>
      <div style="font-size:var(--fs-micro);color:var(--muted);margin-top:.1rem">${p.top_risk ? `أبرز خطر: ${esc(p.top_risk)}` : p.risks ? countAr(p.risks, { one: 'خطر مفتوح واحد', two: 'خطران مفتوحان', few: 'مخاطر مفتوحة', many: 'خطراً مفتوحاً' }) : 'لا سبب مسجَّل — يُسجَّل من صفحة المشروع'}</div>
    </a>`).join('');
  const healthCard = card(`
    <div class="card-head">
      <span class="t">صحة ${G.projects}</span>
      ${sd.openRisks ? `<span class="pill" style="background:#fee2e2;color:#991b1b">${G.risks} ${sd.openRisks}</span>` : ''}</div>
    ${ragActive ? `<div class="hl-wrap" style="flex-wrap:nowrap">
      <span class="ringw" style="width:112px;height:112px">${donutSVG(healthSegs, { size: 112, sw: 15 })}<span style="position:absolute;text-align:center;line-height:1.3"><b class="tnum" style="font-size:1.2rem">${sd.rag.GREEN || 0}/${ragActive}</b><br><span style="font-size:9px;color:var(--muted)">على المسار</span></span></span>
      <div class="hl-legend">${healthRows}</div>
    </div>
    ${needRows ? `<div style="padding:.2rem 1rem .45rem;flex:1"><div style="font-size:var(--fs-micro);font-weight:800;color:var(--muted)">أبرز ما يحتاج تدخلاً</div>${needRows}</div>` : '<div style="flex:1"></div>'}`
    : `<div class="empty-mini" style="flex:1">${icon('projects')} لا مشاريع قيد التنفيذ مقيَّمة الصحة — تُقيَّم من صفحة المشروع</div>`}
    <div class="card-foot"><a href="/app/projects?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}">عرض جميع المشاريع <span aria-hidden="true">←</span></a></div>`, 'band b-green');

  // ── (٩) الأداء مقابل الخطة — أشرطة رصاصة مدمجة كالمرجع: النسبة، والعلامة الذهبية «أين
  // يجب أن نكون اليوم» (المستهدف حتى تاريخه). لا خطة شهرية مسجَّلة فلا يُرسم منحنى خطة.
  // لكل شريط مقياسه المعلَن بجانب اسمه — مقياسٌ واحد مدَّعى لأربعة أشرطة مختلفة كذبة بصرية:
  // شريطا الهدف يكتملان عند المستهدف السنوي، وشريط التغطية عند ×1، وشريط الهامش نسبة من الإيراد.
  const bullet = (name, pct, color, { tick = null, val = null, dd = null, tip = null, sc = null } = {}) => pct == null ? '' : `
    <div class="blt${dd ? ' cardclick' : ''}" ${dd ? `role="button" tabindex="0" data-action="open-dd" data-dd="${dd}"` : ''} ${tip ? `data-tip="${tip}"${dd ? '' : ' tabindex="0"'}` : ''}>
      <div class="top"><span class="n">${name}${sc ? ` <span style="font-weight:400;color:var(--faint);font-size:var(--fs-micro)">· ${sc}</span>` : ''}</span><b class="tnum" style="color:${color}">${val ?? pct + '%'}</b></div>
      <div class="trk"><span class="fill" style="width:${Math.min(100, Math.max(0, pct))}%;background:${color}"></span>
        ${tick != null ? `<span class="tick" style="inset-inline-start:${Math.min(100, Math.max(0, tick))}%"></span>` : ''}</div>
    </div>`;
  const paceSection = card(`
    <div class="card-head"><span class="t">الأداء مقابل الخطة</span>
      <span class="aux" style="font-size:var(--fs-micro);color:var(--faint)" data-tip="شريطا الإيراد والمبيعات يكتملان عند المستهدف السنوي، والعلامة الذهبية أين يجب أن نكون اليوم بنسبة السنة المنقضية. ولكل شريط آخر مقياسه المكتوب بجانب اسمه." tabindex="0">كيف يُقرأ؟ ⓘ</span></div>
    <div style="padding:.35rem 1rem .5rem;flex:1">
      ${bullet(`${G.revenue} المحقق`, attainRev, 'var(--brand2)', { tick: elapsed, dd: 'secrev', sc: 'من المستهدف السنوي' })}
      ${bullet(G.sales, attainSales, 'var(--brand)', { tick: elapsed, dd: 'secwins', sc: 'من المستهدف السنوي' })}
      ${bullet('تغطية خط الفرص', cover?.coverage != null ? Math.min(100, Math.round(cover.coverage * 100)) : null,
    (cover?.coverage ?? 1) < 1 ? 'var(--amber)' : 'var(--green)',
    { val: cover?.coverage != null ? `×${cover.coverage}` : null, sc: 'الشريط يكتمل عند ×1',
      tip: 'القيمة المفتوحة ÷ المتبقي من هدف المبيعات — ×1 فأكثر يعني الخط يغطي المتبقي، وما فوقها لا يزيد الشريط' })}
      ${canMargin && margin && margin.margin_pct != null
    ? bullet('هامش الربح الإجمالي', Math.max(0, margin.margin_pct), margin.margin_pct < 0 ? 'var(--red)' : 'var(--green)', { val: `${margin.margin_pct}%`, sc: 'نسبة من الإيراد', tip: 'الإيراد − الكلفة والمصروف المعتمد، نسبةً إلى الإيراد — الهامش السالب يُطبع رقماً ولا شريط له' })
    : bullet(G.forecast, attainRev != null && sd.target_revenue_halalas ? Math.min(100, Math.round((fc.forecast / sd.target_revenue_halalas) * 100)) : null, 'var(--blue)', { val: sarShort(fc.forecast), sc: 'من هدف السنة', tip: 'المحقق + ما يُتوقّع كسبه من الفرص المفتوحة — نسبةً إلى هدف السنة، وما فوق الهدف لا يزيد الشريط' })}
      ${attainRev == null && attainSales == null ? `<div style="font-size:var(--fs-meta);color:var(--faint);padding:.4rem 0">لا مستهدفات مسجَّلة لسنة ${year} — تُسجَّل من صفحة «الهيكل التنظيمي»</div>` : ''}
    </div>
    <div class="card-foot"><button type="button" data-action="open-dd" data-dd="secrev">عرض التحليل التفصيلي <span aria-hidden="true">←</span></button></div>`);

  // ── (١٠) الاتجاه الشهري والمقارنات — الطبقة الثانية بعد التمرير ──
  const mMax = Math.max(1, ...monthly);
  const monthlyBars = `<div class="mtrack" style="gap:4px">${monthly.map((v, i) => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0" title="${monthLabel(i)}: ${fmtSar(v)}">
      <div style="height:9px;display:flex;align-items:center">${i === nowM ? nowDot() : ''}</div>
      <div style="width:100%;border-radius:4px 4px 0 0;background:${i === nowM ? 'var(--brand2)' : 'var(--brand)'};opacity:${v ? 1 : .18};height:${Math.max(3, Math.round((v / mMax) * 46))}px"></div>
      <span style="font-size:9.5px;color:var(--muted);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${monthLabelDual(i)}</span>
    </div>`).join('')}</div>`;
  const tToDate = targetToDate(sd.target_revenue_halalas, now, year);
  const ytdGap = sd.target_revenue_halalas ? sd.revenue_halalas - tToDate : null;
  const qRevN = (qRev || []).map((r) => (typeof r === 'number' ? r : r.revenue_halalas || 0));
  const qBookN = (qBook || []).map((r) => (typeof r === 'number' ? r : r.sales_halalas || 0));
  const qMax = Math.max(1, ...qRevN, ...qBookN);
  const nowQ = year === now.getUTCFullYear() ? Math.floor(now.getUTCMonth() / 3) : -1;
  const qBars = `<div style="display:grid;grid-template-columns:repeat(4,1fr);direction:rtl;gap:.5rem">${[0, 1, 2, 3].map((i) => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
      <div style="height:9px;display:flex;align-items:center">${i === nowQ ? nowDot('الربع الحالي') : ''}</div>
      <div style="display:flex;gap:3px;align-items:flex-end;height:52px">
        <div title="${G.revenue}: ${fmtSar(qRevN[i])}" style="width:14px;border-radius:3px 3px 0 0;background:var(--green);height:${Math.max(3, Math.round((qRevN[i] / qMax) * 48))}px"></div>
        <div title="${G.bookings}: ${fmtSar(qBookN[i])}" style="width:14px;border-radius:3px 3px 0 0;background:var(--brand2);height:${Math.max(3, Math.round((qBookN[i] / qMax) * 48))}px"></div>
      </div><span style="font-size:9.5px;color:var(--faint);white-space:nowrap">${quarterLabel(i)}</span></div>`).join('')}</div>`;
  const qDelta = nowQ > 0 && qRevN[nowQ - 1] ? Math.round(((qRevN[nowQ] - qRevN[nowQ - 1]) / qRevN[nowQ - 1]) * 100) : null;
  // كالمرجع: الرسم الشهري يتصدّر وبجانبه صندوقا «الفجوة حتى اليوم» و«المتوقع نهاية السنة».
  // لا منحنى خطة شهرية — لا خطة شهرية مسجَّلة في النظام، والمقارنة على المستهدف السنوي وإيقاعه.
  const gapPct = ytdGap != null && tToDate ? Math.round((ytdGap / tToDate) * 100) : null;
  const fcPct = sd.target_revenue_halalas ? Math.round(((fc.forecast - sd.target_revenue_halalas) / sd.target_revenue_halalas) * 100) : null;
  const statBox = (label, main, sub, color, tip) => `<div style="background:#fafbfe;border:1px solid var(--line);border-radius:10px;padding:.5rem .7rem" ${tip ? `data-tip="${tip}" tabindex="0"` : ''}>
      <div style="font-size:var(--fs-micro);color:var(--muted);font-weight:700">${label}${tip ? ' ⓘ' : ''}</div>
      <div class="tnum" style="font-size:var(--fs-num-sm);font-weight:800;color:${color}">${main}</div>
      ${sub ? `<div class="tnum" style="font-size:9.5px;color:var(--faint)">${sub}</div>` : ''}
    </div>`;
  const trendCard = card(`
    <div class="card-head"><span class="t">${G.revenue} عبر السنة</span>
      <span class="aux" style="font-size:var(--fs-micro);color:var(--faint)">توزيع المحقق شهرياً — لا خطة شهرية مسجَّلة فلا تُرسم</span></div>
    <div class="trend-grid">
      <div style="min-width:0;display:grid;gap:.55rem">
        ${monthlyBars}
        <div style="border-top:1px dashed var(--line);padding-top:.5rem">
          ${qBars}
          <div style="display:flex;gap:.8rem;font-size:10px;color:var(--muted);justify-content:center;margin-top:.3rem">
            <span><span style="display:inline-block;width:8px;height:8px;background:var(--green);border-radius:2px"></span> ${G.revenue}</span>
            <span><span style="display:inline-block;width:8px;height:8px;background:var(--brand2);border-radius:2px"></span> ${G.bookings}</span></div>
          ${qDelta != null ? `<div style="font-size:var(--fs-meta);color:var(--muted);margin-top:.35rem">إيراد الربع الحالي ${qDelta >= 0 ? 'أعلى' : 'أدنى'} من الربع السابق بنسبة <b class="tnum" style="color:${qDelta >= 0 ? 'var(--green)' : 'var(--red)'}">${Math.abs(qDelta)}%</b></div>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:.5rem">
        ${ytdGap != null ? statBox('الفجوة حتى اليوم', `<span dir="ltr">${ytdGap >= 0 ? '+' : '−'}${sarShort(Math.abs(ytdGap))}</span>`, gapPct != null ? `<span dir="ltr">${ytdGap >= 0 ? '+' : '−'}${Math.abs(gapPct)}%</span> عن مسار الهدف` : '', ytdGap >= 0 ? 'var(--green)' : 'var(--red)', 'المحقق حتى اليوم مقابل (الهدف × نسبة السنة المنقضية)') : ''}
        ${statBox(G.forecast, sarShort(fc.forecast), fcPct != null ? `<span dir="ltr">${fcPct >= 0 ? '+' : '−'}${Math.abs(fcPct)}%</span> عن الهدف` : 'لا هدف للمقارنة', fcPct == null ? 'var(--ink2)' : fcPct >= 0 ? 'var(--green)' : 'var(--amber)', 'المعادلة: المحقق + ما يُتوقّع كسبه من الفرص المفتوحة')}
      </div>
    </div>`);
  // ── (١١) أهم العملاء — خمسة، وبإشارة قرار واحدة لكل عميل لا سجلّ علاقات كامل ──
  // الترتيب يُبنى على **كل** عملاء القطاع: عدّ الفرص والمشاريع والقيمة المفتوحة لكل عميل بلا
  // سقف صفوف، ثم يُدمج مع إيراده — وإلا سقط صاحبُ أعلى إيرادٍ لأن قائمةً محدودةً بخط الفرص
  // قصّته قبل أن يراه الترتيب.
  const oppAgg = await all(`SELECT o.client_id cid, COUNT(*) n,
       COALESCE(SUM(CASE WHEN st.is_won = 0 AND st.is_lost = 0 THEN o.value_halalas ELSE 0 END),0) open_v,
       COALESCE(SUM(CASE WHEN st.is_won = 0 AND st.is_lost = 0 THEN 1 ELSE 0 END),0) open_n
     FROM opportunity o JOIN stage st ON st.id = o.stage_id
     WHERE o.sector_id = ? AND o.deleted_at IS NULL AND o.client_id IS NOT NULL GROUP BY o.client_id`, [sectorId]);
  // عدّ مشاريع كل عميل بعدسة السنة أيضاً — عمود «المشاريع» في جدول العملاء يجاور إيراد
  // السنة، فخلطُ كل التاريخ فيه يناقض جارَه في نفس الصف.
  const prjAgg = await all(`SELECT client_id cid, COUNT(*) n FROM project
     WHERE sector_id = ? AND deleted_at IS NULL AND client_id IS NOT NULL AND ${pycBare.clause}
     GROUP BY client_id`, [sectorId, ...pycBare.params]);
  const revByCid = Object.fromEntries(revByClient.map((r) => [r.cid, r.rev]));
  const stalledCids = new Set(stalledRows.map((o) => o.client_id).filter(Boolean));
  const redProjClients = new Set((await all(`SELECT DISTINCT client_id FROM project
     WHERE sector_id = ? AND deleted_at IS NULL AND status = 'IN_PROGRESS' AND rag = 'RED' AND client_id IS NOT NULL
       AND ${pycBare.clause}`, [sectorId, ...pycBare.params])).map((r) => r.client_id));
  // إشارة كل عميل بأولوية معلنة: تحصيل متأخر (لمن يقرأ الفواتير) ← فرصة متوقفة ← مشروع في خطر.
  let overdueCids = new Set();
  if (canInvoices) {
    overdueCids = new Set((await all(`SELECT DISTINCT i.client_id cid FROM invoice i LEFT JOIN project p ON p.id = i.project_id
       WHERE COALESCE(i.sector_id, p.sector_id) = ? AND i.deleted_at IS NULL AND i.client_id IS NOT NULL
         AND (i.status = 'OVERDUE' OR (i.status IN ('ISSUED','PARTIALLY_PAID') AND i.due_date IS NOT NULL AND substr(i.due_date,1,10) < ?))`,
    [sectorId, today])).map((r) => r.cid));
  }
  const oppBy = Object.fromEntries(oppAgg.map((r) => [r.cid, r]));
  const prjBy = Object.fromEntries(prjAgg.map((r) => [r.cid, r.n]));
  const allCids = [...new Set([...revByClient.map((r) => r.cid), ...oppAgg.map((r) => r.cid), ...prjAgg.map((r) => r.cid)])];
  const cNames = allCids.length ? Object.fromEntries((await all(
    `SELECT id, name_ar FROM client WHERE deleted_at IS NULL AND id IN (${allCids.map(() => '?').join(',')})`, allCids))
    .map((r) => [r.id, r.name_ar])) : {};
  // حالة العلاقة بنفس قاعدة صفحة العملاء حرفياً (relationshipOf + آخر لمسة من كل السجلات
  // المؤرّخة) — لا عمود مخزَّن ولا قاعدة موازية، فلا يرى القائد حالةً تخالف شاشة العملاء.
  const lastTouch = allCids.length ? await lastTouchByClient() : new Map();
  const topClients = allCids
    .filter((id) => cNames[id])
    .map((id) => ({ id, name_ar: cNames[id], rev: revByCid[id] || 0,
      opps: oppBy[id]?.n || 0, pipeline_halalas: oppBy[id]?.open_v || 0, projects: prjBy[id] || 0 }))
    .sort((a, b) => (b.rev - a.rev) || (b.pipeline_halalas - a.pipeline_halalas))
    .slice(0, 5);
  const clientSignal = (c) => {
    if (overdueCids.has(c.id)) return `<span class="cl-sig" style="background:#fee2e2;color:#991b1b">تحصيل متأخر</span>`;
    if (stalledCids.has(c.id)) return `<span class="cl-sig" style="background:#fef3c7;color:#92400e">فرصة متوقفة</span>`;
    if (redProjClients.has(c.id)) return `<span class="cl-sig" style="background:#fee2e2;color:#991b1b">مشروع في خطر</span>`;
    return '';
  };
  // جدول مدمج كالمرجع: عميل (بحرفه الأول)، الإيراد، المفتوح من خط فرصه، وإشارة قراره —
  // بلا عمود «اتجاه»: لا سلسلة زمنية لكل عميل في النظام، والسهم بلا بيانات كذبة صغيرة.
  const secRevTotal = sd.revenue_halalas || 0;
  const clientRows = topClients.map((c) => {
    const share = secRevTotal && c.rev ? Math.round((c.rev / secRevTotal) * 100) : null;
    return `<tr>
      <td><span class="cl-nm"><span class="cl-av" aria-hidden="true">${esc(String(c.name_ar || '؟').trim().charAt(0))}</span><a href="/app/client/${esc(c.id)}" title="${esc(c.name_ar)}">${esc(c.name_ar)}</a></span></td>
      <td class="tnum" style="font-weight:800">${c.rev ? sarShort(c.rev) : '—'}</td>
      <td class="tnum" title="الفرص ${c.opps} · المشاريع ${c.projects}">${c.pipeline_halalas ? sarShort(c.pipeline_halalas) : '—'}</td>
      <td>${share != null ? `<span style="display:inline-flex;align-items:center;gap:.4rem"><b class="tnum">${share}%</b><span class="bar" style="width:56px;display:inline-block;flex:none"><span style="width:${Math.min(100, share)}%;background:var(--brand)"></span></span></span>` : '<span style="color:var(--faint)" aria-hidden="true">—</span>'}</td>
      <td>${(() => { const rel = relationshipOf(lastTouch.get(c.id), oppBy[c.id]?.open_n || 0);
        const relC = rel === 'نشطة' ? ['#dcfce7', '#166534'] : rel === 'فاترة' ? ['#fef3c7', '#92400e'] : ['#f1f5f9', '#64748b'];
        return `<span class="pill" style="background:${relC[0]};color:${relC[1]}">${rel}</span>`; })()}</td>
      <td>${clientSignal(c) || '<span style="color:var(--faint)" aria-hidden="true">—</span>'}</td>
    </tr>`;
  }).join('');
  // جملة التركّز لا تُقال إلا حين يوجد ثلاثة فعلاً — «أكبر ثلاثة» عن عميلين كذبة صغيرة.
  const top3 = topClients.filter((c) => c.rev > 0).slice(0, 3);
  const concPct = secRevTotal && top3.length === 3 ? Math.round((top3.reduce((a, c) => a + c.rev, 0) / secRevTotal) * 100) : null;
  const clientsCard = card(`
    <div class="card-head"><span class="t">أهم ${G.clients}</span>
      <span class="aux" style="font-size:var(--fs-micro);color:var(--faint)">مرتَّبون حسب إيراد ${year}</span></div>
    ${concPct != null && concPct > 0 ? `<div class="cl-note" style="color:${concPct >= 60 ? '#92400e' : 'var(--muted)'}">
      أكبر ثلاثة عملاء يمثلون <b class="tnum">${concPct}%</b> من إيراد القطاع هذه السنة${concPct >= 60 ? ' — تركّز مرتفع' : ''} <span data-tip="مجموع إيراد أكبر ثلاثة عملاء ÷ إيراد القطاع المحقق لهذه السنة" tabindex="0" style="color:var(--faint)">ⓘ</span></div>` : ''}
    <div style="padding:.15rem .5rem .3rem;flex:1;overflow-x:auto" tabindex="0" role="region" aria-label="جدول أهم العملاء">
      ${clientRows ? `<table class="cl-tbl">
        <thead><tr><th>العميل</th><th>الإيراد ${year}</th><th>المفتوح من فرصه</th><th>حصة من الإيراد</th><th>الحالة</th><th>الإشارة</th></tr></thead>
        <tbody>${clientRows}</tbody></table>` : `<div class="empty-state" style="padding:1rem"><div class="s">${G.emptyList}</div></div>`}
    </div>
    <div class="card-foot"><a href="/app/clients">عرض جميع العملاء <span aria-hidden="true">←</span></a></div>`);
  // ── مخاطر التركّز — دونات حصص أكبر ثلاثة عملاء من إيراد القطاع (طبقة التمرير) ──
  const concColors = ['var(--brand)', 'var(--brand2)', '#5b8def'];
  const concCard = concPct != null && concPct <= 100 ? card(`
    <div class="card-head"><span class="t">مخاطر التركّز</span></div>
    <div class="conc-wrap">
      <span class="ringw" style="width:96px;height:96px">${donutSVG([
    ...top3.map((c, i) => ({ v: c.rev, color: concColors[i] })),
    { v: Math.max(0, secRevTotal - top3.reduce((a, c) => a + c.rev, 0)), color: '#e8ecf5' },
  ], { size: 96, sw: 12 })}<span style="position:absolute;text-align:center;line-height:1.25"><b class="tnum" style="font-size:1.05rem">${concPct}%</b><br><span style="font-size:8.5px;color:var(--muted)">من الإيراد<br>من أكبر 3 عملاء</span></span></span>
      <div class="conc-legend">
        ${top3.map((c, i) => `<div class="conc-li"><span class="sw" style="background:${concColors[i]}"></span>
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name_ar)}</span>
          <b class="tnum">${Math.round((c.rev / secRevTotal) * 100)}%</b>
          <span class="tnum" style="color:var(--muted);font-size:var(--fs-micro)">${sarShort(c.rev)}</span></div>`).join('')}
        <div style="font-size:var(--fs-micro);color:${concPct >= 60 ? '#92400e' : 'var(--muted)'};margin-top:.15rem">${concPct >= 60 ? 'تركّز مرتفع على عدد قليل من العملاء — تنويع القاعدة يقلل الأثر لو تعثّر أحدهم' : 'التركّز ضمن الحدود المريحة'}</div>
      </div>
    </div>`) : '';

  // ── (١٢) التحصيل — يظهر فقط لمن يقرأ الفواتير (لا تسريب مالي لبقية الأدوار) ──
  let collectCard = '', collectDD = '';
  if (canInvoices) {
    const buckets = await arAging(user, year, { sector: sectorId });
    const odRaw = await all(`SELECT i.id, i.code, i.amount_halalas, i.retention_halalas, i.due_date, cl.name_ar client, p.name_ar project,
        (SELECT COALESCE(SUM(col.amount_halalas),0) FROM collection col WHERE col.invoice_id = i.id) collected
      FROM invoice i LEFT JOIN project p ON p.id = i.project_id LEFT JOIN client cl ON cl.id = i.client_id
      WHERE COALESCE(i.sector_id, p.sector_id) = ? AND i.deleted_at IS NULL
        AND i.status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')
        AND (i.status = 'OVERDUE' OR (i.due_date IS NOT NULL AND substr(i.due_date,1,10) < ?))
      ORDER BY i.due_date LIMIT 12`, [sectorId, today]);
    const odRows = odRaw.map((r) => ({
      ...r,
      out: Math.max(0, (r.amount_halalas || 0) - (r.retention_halalas || 0) - (r.collected || 0)),
      days: r.due_date ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(String(r.due_date).slice(0, 10))) / 86400000)) : null,
    })).filter((r) => r.out > 0);
    const BUCKETS = [['0-30', 'حتى شهر من الإصدار'], ['31-60', 'شهر إلى شهرين'], ['61-90', 'شهران إلى ثلاثة'], ['90+', 'أكثر من ثلاثة أشهر']];
    const arTotal = BUCKETS.reduce((a, [k]) => a + (buckets[k] || 0), 0);
    const bMax = Math.max(1, ...BUCKETS.map(([k]) => buckets[k] || 0));
    const bucketRows = BUCKETS.map(([k, l], i) => `<div style="display:flex;align-items:center;gap:.5rem;font-size:var(--fs-meta);padding:.2rem 0">
        <span style="flex:0 0 128px;color:var(--muted)">${l}</span>
        <div class="bar" style="flex:1"><span style="width:${Math.round(((buckets[k] || 0) / bMax) * 100)}%;background:${i >= 2 ? 'var(--red)' : i === 1 ? 'var(--amber)' : 'var(--brand)'}"></span></div>
        <span class="tnum" style="flex:none;font-weight:700;font-size:var(--fs-micro)">${fmtSar(buckets[k] || 0)}</span>
      </div>`).join('');
    const lateRows = odRows.slice(0, 3).map((r) => `<div class="cardclick" role="button" tabindex="0" data-action="open-dd" data-dd="seccollect" style="display:flex;justify-content:space-between;gap:.6rem;align-items:baseline;padding:.32rem 0;border-bottom:1px dashed var(--line);font-size:var(--fs-body)">
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.client || r.project || 'فاتورة')}${r.code ? ` <span style="color:var(--faint);font-size:var(--fs-micro)"><bdi>${esc(r.code)}</bdi></span>` : ''}</span>
        <span style="flex:none;display:flex;gap:.5rem;align-items:baseline">
          <b class="tnum">${fmtSar(r.out)}</b>
          ${r.days != null ? `<span class="pill" style="background:#fee2e2;color:#991b1b">متأخر ${dayWord(r.days)}</span>` : ''}
        </span>
      </div>`).join('');
    collectCard = card(`
      <div class="card-head">
        <span class="t">التحصيل والمطالبات</span></div>
      ${arTotal || odRows.length ? `
      <div class="cardclick" role="button" tabindex="0" data-action="open-dd" data-dd="seccollect" style="padding:.55rem 1rem;display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px dashed var(--line)">
        <span style="font-size:var(--fs-micro);color:var(--muted)">${G.outstanding} للقطاع · ${year} <span style="color:var(--faint)" aria-hidden="true">⊕</span></span>
        <b class="tnum" style="font-size:var(--fs-num-sm);color:${arTotal ? 'var(--amber)' : 'var(--ink2)'}">${fmtSar(arTotal)}</b></div>
      <div style="padding:.45rem 1rem .3rem">
        <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted);margin-bottom:.15rem">أعمار المستحقات منذ إصدار الفاتورة</div>${bucketRows}
      </div>
      <div style="padding:.35rem 1rem .6rem">
        <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted)">${G.lateClaim}${odRows.length > 3 ? ` — الأكثر تأخراً (3 من ${odRows.length})` : ''}</div>
        ${lateRows || `<div style="font-size:var(--fs-meta);color:var(--faint);padding:.3rem 0">لا فواتير متأخرة السداد — التحصيل منضبط</div>`}
        ${odRows.length > 3 ? `<button class="btn btn-ghost btn-sm" data-action="open-dd" data-dd="seccollect" style="margin-top:.2rem"><span class="tnum">+${odRows.length - 3}</span> أخرى — الكل <span aria-hidden="true">⊕</span></button>` : ''}
      </div>`
    : `<div class="empty-state" style="padding:1.2rem 1rem">${icon('money')}<div class="t">لا مستحقات قائمة لهذا القطاع · ${year}</div><div class="s">كل الفواتير الصادرة لهذه السنة حُصّلت، أو لم تصدر فواتير بعد</div></div>`}`);
    collectDD = ddWrap('seccollect', `${G.lateClaim} — ${esc(sd.sector.name_ar)}`, `فواتير قائمة تجاوزت تاريخ استحقاقها · حتى ${today}`, `
      <div class="dd-kpi"><span class="v tnum" style="color:var(--amber)">${fmtSar(odRows.reduce((a, b) => a + b.out, 0))}</span><span style="font-size:12px;color:var(--muted)">${odRows.length ? `على ${countAr(odRows.length, { one: 'فاتورة واحدة', two: 'فاتورتين', few: 'فواتير', many: 'فاتورة' })}` : 'لا فواتير متأخرة'}</span></div>
      <div class="dd-sec">حسب تاريخ الاستحقاق</div>
      <div>${ddRows(odRows.map((r) => `<div style="padding:.4rem 0;border-bottom:1px dashed var(--line)">
        <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:12.5px;align-items:baseline">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.client || r.project || 'فاتورة')}${r.code ? ` <span style="color:var(--faint);font-size:10.5px"><bdi>${esc(r.code)}</bdi></span>` : ''}</span>
          <b class="tnum" style="flex:none">${fmtSar(r.out)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted)">
          <span>يستحق ${r.due_date ? String(r.due_date).slice(0, 10) : '—'}</span>${r.days != null ? `<span class="tnum" style="color:var(--red);font-weight:800">متأخر ${dayWord(r.days)}</span>` : ''}</div>
      </div>`))}</div>`);
  }

  // ── (١٣) العقود + القرارات والاعتمادات — حضور ثانوي في أسفل الصفحة، لا يُحذف ──
  const contractsCard = canContracts ? card(`<div class="cardclick" role="button" tabindex="0" data-action="open-dd" data-dd="seccontracts" style="padding:.7rem 1rem">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <span style="font-size:var(--fs-body);font-weight:700">العقود النشطة <span style="color:var(--faint)" aria-hidden="true">⊕</span></span>
      <b class="tnum" style="font-size:var(--fs-num-sm)">${fmtSar(activeC.v)}</b></div>
    <div style="font-size:var(--fs-micro);color:var(--muted);margin-top:.15rem">${countAr(activeC.n, { one: 'عقد نشط واحد', two: 'عقدان نشطان', few: 'عقود نشطة', many: 'عقداً نشطاً' })} · موقّع ${year}: ${sd.contracts_count} (${fmtSar(sd.contracts_halalas)})</div>
  </div>`, 'card-h') : '';
  const decRows = recentDecisions.map((d) => `<div style="padding:.35rem 0;border-bottom:1px dashed var(--line);font-size:12px">
      <div style="font-weight:700">${esc(d.title)}</div>
      <div style="font-size:var(--fs-micro);color:var(--muted)">${esc(d.project || '')}${d.decided_by ? ' · ' + esc(d.decided_by) : ''}${d.dat ? ' · ' + d.dat : ''}</div>
    </div>`).join('') || `<div style="font-size:var(--fs-meta);color:var(--faint);padding:.35rem 0">لا قرارات مسجلة بعد — تُسجَّل القرارات من صفحة المشروع</div>`;
  // مبلغ المصروف حقلٌ مختوم ببوابة الكلفة (redact على مسارات الواجهة البرمجية) — فلا يُطبع
  // هنا لمن لا يملكها؛ يبقى اسم الطلب ويُحجب رقمه وحده.
  const canCost = canSeeSensitive(user, 'cost');
  const apRows = pendingApprovals.map((a) => `<div style="display:flex;justify-content:space-between;gap:.6rem;padding:.3rem 0;border-bottom:1px dashed var(--line);font-size:12px">
      <span>${esc(RESOURCE_AR[a.resource] || tr(a.resource) || 'طلب')}</span>
      <b class="tnum" style="flex:none">${a.amount_halalas && (a.resource !== 'expense' || canCost) ? fmtSar(a.amount_halalas) : ''}</b>
    </div>`).join('') || `<div style="font-size:var(--fs-meta);color:var(--faint);padding:.3rem 0">لا طلبات معلقة</div>`;
  const decisionsCard = (!pendingApprovals.length && !recentDecisions.length)
    ? card(`<div class="empty-mini" style="justify-content:space-between">
        <span style="display:flex;gap:.45rem;align-items:center">${icon('approvals')} ${G.decisions} والاعتمادات: لا طلبات معلقة ولا قرارات حديثة في القطاع</span>
        <a href="/app/approvals" style="color:var(--brand);font-weight:700;flex:none">${G.needsDecision} <span aria-hidden="true">←</span></a>
      </div>`)
    : card(`
    <div class="card-head">
      <span class="t">${G.decisions} والاعتمادات</span>
      <span class="aux"><a class="btn btn-sm" href="/app/approvals">${G.needsDecision}</a></span></div>
    <div style="padding:.5rem 1rem .6rem">
      <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted)">طلبات معلقة في القطاع</div>${apRows}
      <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted);margin-top:.5rem">آخر القرارات</div>${decRows}
    </div>`);

  // ── (١٤) شريط التقارير — قاع الصفحة كالمرجع: معاينة، إرسال، وجدولة ──
  const reportsStrip = card(`<div style="padding:.6rem 1rem;display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
      <span style="font-size:var(--fs-meta);font-weight:800;color:var(--ink2)">التقارير الدورية</span>
      <span style="font-size:var(--fs-micro);color:var(--faint)">معاينة فورية أو إرسال تجريبي إلى بريدك</span>
      <span class="spacer"></span>
      <button class="btn btn-sm" data-action="report-preview" data-report="sector_weekly_status">التقرير الأسبوعي</button>
      <button class="btn btn-sm" data-action="report-preview" data-report="monthly_sector_performance">التقرير الشهري</button>
      <button class="btn btn-sm" data-action="report-send" data-report="sector_weekly_status">أرسله لي الآن</button>
      <a class="btn btn-primary btn-sm" href="/app/reports">جدولة التقارير</a>
    </div>`);

  // ── قوالب التفصيل (drill-down) — تُحسب على الخادم بنفس نطاق الصفحة فلا يتسرب محجوب ──
  const lateDlv = (attn.find((a) => a.dd === 'att-late-dlv')?.ddRowsData) || [];
  const HEALTH_DD_SUB = { GREEN: 'مشاريع قيد التنفيذ على المسار', AMBER: 'مشاريع في خطر تحتاج متابعة قبل أن تتعثر', RED: 'مشاريع حرجة — الأولى بوقت القائد' };
  const healthDD = HEALTH.map(([k, l, c]) => ddWrap(`sec-health-${k}`, `${l} — ${esc(sd.sector.name_ar)}`, HEALTH_DD_SUB[k], `
    <div class="dd-kpi"><span class="v tnum" style="color:${c}">${sd.rag[k] || 0}</span><span style="font-size:12px;color:var(--muted)">من ${countAr(ragActive, { one: 'مشروع قيد التنفيذ', two: 'مشروعين قيد التنفيذ', few: 'مشاريع قيد التنفيذ', many: 'مشروعاً قيد التنفيذ' })}</span></div>
    <div>${ddRows(healthLists[k].map((p) => `<div class="dd-row">
      <span><a href="/app/project/${esc(p.id)}" style="color:var(--ink2);font-weight:700">${esc(p.name_ar)}</a></span>
      <b class="tnum">${progMapH.get(p.id)?.pct ?? Math.max(0, Math.min(100, Math.round(p.progress_pct || 0)))}%</b></div>`))}</div>
    <div style="display:flex;justify-content:flex-start"><a class="btn btn-sm" href="/app/projects?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}">عرض جميع المشاريع</a></div>`)).join('');
  // نوافذ تفصيل القمع: للإجمالي ولكل مرحلة — أرقام الرأس قطاعية، والأسماء بنطاق القارئ،
  // وزرّا «تصفية الشاشة» و«صفحة الفرص» داخل النافذة فلا نقرة بلا أثر مرئي.
  const oppsPageHref = `/app/opportunities?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}`;
  const fnlDDOne = (key, name, count, value, rows, stageId) => {
    const ages = openFlow.filter((o) => !stageId || o.stage_id === stageId);
    const avg = ages.length ? Math.round(ages.reduce((t, o) => t + ageDays(o.since), 0) / ages.length) : 0;
    const stalled = ages.filter((o) => ageDays(o.since) > (ROT_THRESHOLDS[o.stage_id] || ROT_THRESHOLDS.default)).length;
    const isOn = selStage && stageId && selStage.id === stageId;
    return ddWrap(key, stageId ? `مرحلة ${esc(name)}` : 'كل الفرص المفتوحة', `${esc(sd.sector.name_ar)} · أسماء الفرص أدناه بنطاقك في قائمة الفرص`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--brand2)">${fmtSar(value)}</span><span style="font-size:12px;color:var(--muted)">${countAr(count, { one: 'فرصة واحدة', two: 'فرصتان', few: 'فرص', many: 'فرصة', zero: 'لا فرص' })}</span></div>
    <div style="display:flex;gap:1rem;font-size:12px;color:var(--muted);flex-wrap:wrap">
      <span>متوسط العمر في المرحلة <b class="tnum">${dayWord(avg)}</b></span>
      <span>متوقفة — تجاوزت المدة المعتادة <b class="tnum" style="color:${stalled ? 'var(--amber)' : 'var(--ink2)'}">${stalled}</b></span>
    </div>
    <div class="dd-sec">${rows.length ? `أعلى الفرص قيمةً${rows.length < count ? ` (${rows.length} من ${count})` : ''}` : 'لا فرص ضمن نطاق قراءتك في هذه المرحلة'}</div>
    <div>${ddRows(rows.map((o) => `<div class="dd-row">
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="/app/opportunity/${esc(o.id)}" style="color:var(--ink2);font-weight:700">${esc(o.title_ar)}</a>${o.client ? ` <span style="color:var(--faint);font-size:10.5px">· ${esc(o.client)}</span>` : ''}</span>
      <b class="tnum" style="flex:none">${o.value_halalas ? fmtSar(o.value_halalas) : '—'}</b></div>`))}</div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      ${stageId ? `<a class="btn btn-primary btn-sm" href="${qs({ stage: isOn ? null : stageId })}">${isOn ? 'إلغاء تصفية الشاشة' : 'تصفية الشاشة بهذه المرحلة'}</a>` : ''}
      <a class="btn btn-sm" href="${oppsPageHref}">فتح صفحة الفرص</a>
    </div>`);
  };
  const funnelDD = [
    fnlDDOne('fnl-ALL', '', openTotalC, openTotalV, ddOppRows.slice(0, 8), null),
    ...funnelStages.map((st) => fnlDDOne(`fnl-${st.id}`, st.name_ar, st.count, st.value_halalas,
      ddOppRows.filter((o) => o.stage_id === st.id).slice(0, 8), st.id)),
  ].join('');
  // ── نافذة الشخص (v5.35): حِمله المخطَّط، ومشاريعه، وفرصه، ومهامه — بنطاق القارئ من الخدمة ──
  // الأرقام خطةُ تسكينٍ لا ساعات، والجملة تقولها في كل نافذة؛ وحِمل الفرص المبدئي سطرٌ مستقل.
  const deptNameOf = new Map((team?.departments || []).map((d) => [d.id, d.name_ar]));
  const loadPill = (v) => v > OVER_ABOVE ? `<span class="pill" style="background:#fee2e2;color:#991b1b">${G.overloaded}</span>`
    : v === 0 ? `<span class="pill" style="background:#ede9fe;color:#5b21b6">${G.onBench}</span>`
      : v < FREE_BELOW ? `<span class="pill" style="background:#dcfce7;color:#166534">${G.underused}</span>`
        : `<span class="pill" style="background:#dcfce7;color:#166534">ضمن الطاقة</span>`;
  const bandColor = (v) => v > OVER_ABOVE ? 'var(--red)' : v === 0 ? 'var(--brand2)' : 'var(--green)';
  const capStrip = (months) => `<div class="cap-strip" dir="ltr" role="img" aria-label="حِمل الأشهر الاثني عشر">${months.map((v, i) => `
    <span class="cs${nowMonth === i + 1 ? ' cur' : ''}" title="${MONTHS_AR[i]}: ${v}%"><i style="height:${Math.min(100, Math.round(v / 150 * 100))}%;background:${bandColor(v)}"></i><b class="tnum">${i + 1}</b></span>`).join('')}</div>`;
  const capEmpDD = (p) => {
    const live = !!nowMonth;
    const headline = live ? p.planNow : p.annual;
    const sub = [p.job_title, p.department_id ? deptNameOf.get(p.department_id) : null, p.capacity_pct && p.capacity_pct !== 100 ? `${G.capacity} ${p.capacity_pct}%` : null]
      .filter(Boolean).map(esc).join(' · ');
    const stat = (l, v, extra = '') => `<div class="cap-stat"><span class="l">${l}</span><b class="tnum" style="color:${bandColor(v)}">${v}%</b>${extra}</div>`;
    const stats = live ? [
      stat('الشهر القادم', p.next),
      stat('متوسط الأشهر الثلاثة القادمة', p.q3),
      stat('إشغال السنة', p.annual, p.monthDelta ? `<small class="tnum" dir="ltr">${p.monthDelta > 0 ? '+' : '−'}${Math.abs(p.monthDelta)}</small><small> نقطة عن الشهر الماضي</small>` : ''),
    ] : [stat('الذروة', p.peak), `<div class="cap-stat"><span class="l">أشهر مُسكَّنة</span><b class="tnum">${p.staffedMonths}</b></div>`];
    const projRows = p.projects.slice(0, 8).map((pr) => {
      const period = allocationPeriod(JSON.stringify(pr.months), year);
      const v = live ? Math.round((Number(pr.months[nowMonth]) || 0) * 100) : period.avgPct;
      const name = pr.projectId ? `<a href="/app/project/${esc(pr.projectId)}" style="color:var(--ink2);font-weight:700">${esc(pr.name)}</a>` : `<span style="font-weight:700">${esc(pr.name)}</span>`;
      const tags = [pr.type === 'lead' ? '<span class="pill" style="background:#dbeafe;color:#1e3a8a">قائد</span>' : '', pr.bucket ? '<span class="pill" style="background:#f1f5f9;color:#475569">عمل داخلي</span>' : ''].join(' ');
      return `<div class="dd-row"><span>${name} ${tags} <span style="color:var(--faint);font-size:10.5px">· ${esc(period.label)}</span></span><b class="tnum">${v}%</b></div>`;
    });
    const moreProj = p.projects.length > 8 ? `<div style="font-size:var(--fs-micro);color:var(--faint)">و<b class="tnum">${p.projects.length - 8}</b> بند آخر في لوحة التسكين</div>` : '';
    const oppRows = p.opportunities.map((o) => `<div class="dd-row"><span>${o.opportunityId ? `<a href="/app/opportunity/${esc(o.opportunityId)}" style="color:var(--ink2);font-weight:700">${esc(o.name)}</a>` : esc(o.name)} <span class="pill" style="background:#fef3c7;color:#92400e">${G.opportunity}</span></span><b class="tnum">${o.pct}%</b></div>`);
    const t = p.tasks;
    const tasksBlock = !t
      ? '<div style="font-size:var(--fs-meta);color:var(--muted)">لا حساب دخول مرتبط — لا مهام تُقرأ له</div>'
      : `<div style="display:flex;gap:1rem;font-size:var(--fs-meta);color:var(--muted);flex-wrap:wrap">
          <span>مفتوحة <b class="tnum" style="color:var(--ink2)">${t.open}</b></span>
          <span>متأخرة <b class="tnum" style="color:${t.late ? 'var(--red)' : 'var(--ink2)'}">${t.late}</b></span>
          <span>مُعطَّلة <b class="tnum" style="color:${t.blocked ? 'var(--amber)' : 'var(--ink2)'}">${t.blocked}</b></span></div>
         ${t.top.length ? `<div>${t.top.map((k) => `<div class="dd-row"><span>${esc(k.title)} ${k.late ? '<span class="pill" style="background:#fee2e2;color:#991b1b">متأخرة</span>' : ''}${k.blocked ? ' <span class="pill" style="background:#fef3c7;color:#92400e">مُعطَّلة</span>' : ''}</span><b class="tnum" style="font-weight:600;color:var(--muted)">${k.due ? esc(k.due) : '—'}</b></div>`).join('')}</div>`
    : (t.open ? '<div style="font-size:var(--fs-micro);color:var(--faint)">عناوين المهام في صفحته الكاملة</div>' : '')}`;
    const footer = [
      p.userId && p.dossierOk ? `<a class="btn btn-primary btn-sm" href="/app/person/${esc(p.userId)}">صفحته الكاملة</a>` : '',
      `<a class="btn btn-sm" href="${staffingHref}&emp=${esc(p.id)}">فتح في لوحة التسكين</a>`,
    ].join('');
    return ddWrap(`cap-emp-${esc(p.id)}`, esc(p.name_ar), sub || esc(sd.sector.name_ar), `
    <div class="dd-kpi"><span class="v tnum" style="color:${bandColor(headline)}">${headline}%</span><span style="font-size:12px;color:var(--muted)">${live ? `${G.utilization} هذا الشهر (${monthLabel(nowMonth - 1)})` : `${G.utilization} — متوسط ${year}`}</span>${loadPill(headline)}</div>
    ${live && p.oppLoadPct ? `<div style="font-size:var(--fs-meta);color:var(--muted)">+<b class="tnum">${p.oppLoadPct}%</b> حِمل مبدئي من فرص مفتوحة — يُحتسب على هذا الشهر فقط (المجموع <b class="tnum">${p.currentUtil}%</b>)</div>` : ''}
    <div class="cap-stats">${stats.join('')}</div>
    ${capStrip(p.months)}
    <div class="dd-sec">المشاريع والبنود · ${year}</div>
    <div>${projRows.length ? projRows.join('') : `<div style="color:var(--faint);font-size:12px">لا بنود تسكين في ${year} — يُسكَّن من لوحة التسكين</div>`}${moreProj}</div>
    ${oppRows.length ? `<div class="dd-sec">فرص مفتوحة يشارك فيها</div><div>${oppRows.join('')}</div>` : ''}
    <div class="dd-sec">مهامه</div>
    ${tasksBlock}
    <div style="font-size:10.5px;color:var(--faint);margin-top:.4rem">الأرقام من خطة التسكين الشهرية — وليست ساعات عمل فعلية.</div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.2rem">${footer}</div>`);
  };
  const capEmpDDs = team ? team.people.map(capEmpDD).join('') : '';
  const rosterIds = new Set((team?.people || []).map((p) => p.id));
  // نافذة بند «فوق الطاقة» في «يحتاج تدخلك»: الأسماء من الخدمة (محجوبة لمن لا يقرأ الموظفين)،
  // والصفّ يفتح نافذة صاحبه إن كان في الكشف.
  const overRows = (attn.find((a) => a.dd === 'att-overload')?.ddRowsData) || [];
  const overloadDD = ddWrap('att-overload', 'فوق الطاقة هذا الشهر', `${esc(sd.sector.name_ar)} · من خطة تسكين ${MONTHS_AR[Number(today.slice(5, 7)) - 1] || ''}`, `
    <div>${overRows.length ? overRows.map((x) => rosterIds.has(x.employee_id)
    ? `<div class="dd-row cap-li-btn" role="button" tabindex="0" data-action="cap-person" data-emp="${esc(x.employee_id)}"><span style="font-weight:700">${esc(x.name)} <span style="color:var(--faint)" aria-hidden="true">⊕</span></span><b class="tnum" style="color:var(--red)">${x.pct}%</b></div>`
    : `<div class="dd-row"><span style="font-weight:700">${esc(x.name)}</span><b class="tnum" style="color:var(--red)">${x.pct}%</b></div>`).join('')
    : `<div style="color:var(--faint);font-size:12px">${canPeople ? 'لا أحد فوق الطاقة ضمن نطاقك' : 'أسماء الأفراد تظهر لمن يملك قراءة الموظفين'}</div>`}</div>
    <div style="font-size:10.5px;color:var(--faint);margin-top:.4rem">الأرقام من خطة التسكين الشهرية — وليست ساعات عمل فعلية.</div>
    ${canPeople ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap"><a class="btn btn-sm" href="${staffingHref}">لوحة التسكين</a></div>` : ''}`);
  const DD = `
  ${capEmpDDs}
  ${overloadDD}
  ${ddWrap('secrev', `${G.revenue} حسب المشروع · ${year}`, `${esc(sd.sector.name_ar)} · المحقق مقابل قيمة كل مشروع`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--green)">${fmtSar(sd.revenue_halalas)}</span><span style="font-size:12px;color:var(--muted)">إجمالي المحقق ${year} · ${G.forecast}: ${fmtSar(fc.forecast)}</span></div>
    ${attain(sd.revenue_halalas, sd.target_revenue_halalas, 'var(--green)')}
    <div class="dd-sec">المشاريع المولِّدة للإيراد</div>
    <div>${ddRows(revByProject.map((r) => { const pcv = r.cv ? Math.round((r.rev / r.cv) * 100) : null; return `
      <div style="padding:.4rem 0;border-bottom:1px dashed var(--line)">
        <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:12.5px;align-items:baseline">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.id ? `<a href="/app/project/${esc(r.id)}" style="color:var(--ink2)">${esc(r.name_ar)}</a>` : 'إيراد غير مرتبط بمشروع'}</span>
          <b class="tnum" style="flex:none">${fmtSar(r.rev)}</b></div>
        <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:10.5px;color:var(--muted)">
          <span>${r.cv ? 'قيمة المشروع (' + (r.cvbasis || '') + ') ' + fmtSar(r.cv) : 'بلا قيمة مسجلة'}</span>${pcv != null ? `<span class="tnum" style="font-weight:800">حقّق ${pcv}%</span>` : ''}</div>
        ${pcv != null ? `<div class="bar" style="margin-top:.25rem;height:5px"><span style="width:${Math.min(100, pcv)}%;background:var(--green)"></span></div>` : ''}
      </div>`; }))}</div>`)}
  ${canContracts ? ddWrap('seccontracts', 'سجل عقود القطاع', `${esc(sd.sector.name_ar)} · النشطة + الموقّعة حسب السنة`, `
    <div class="dd-kpi"><span class="v tnum">${fmtSar(activeC.v)}</span><span style="font-size:12px;color:var(--muted)">${countAr(activeC.n, { one: 'عقد نشط واحد', two: 'عقدان نشطان', few: 'عقود نشطة', many: 'عقداً نشطاً' })} · موقّع ${year}: ${sd.contracts_count} (${fmtSar(sd.contracts_halalas)})</span></div>
    <div class="dd-sec">أكبر العقود</div>
    <div>${ddRows(secContracts.map((c) => { const ip = c.value_halalas ? Math.min(100, Math.round(((c.invoiced || 0) / c.value_halalas) * 100)) : 0; return `
      <div style="padding:.4rem 0;border-bottom:1px dashed var(--line)">
        <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:12.5px;align-items:baseline">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span style="color:var(--ink2)">${esc(c.client || c.code || 'عقد')}</span>${c.code ? ` <span style="color:var(--faint);font-size:10.5px"><bdi>${esc(c.code)}</bdi></span>` : ''}</span>
          <b class="tnum" style="flex:none">${fmtSar(c.value_halalas)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted)"><span>${tr(c.status)}${c.start_date ? ' · ' + String(c.start_date).slice(0, 10) : ''}</span><span class="tnum">فُوتر ${ip}%</span></div>
        <div class="bar" style="margin-top:.25rem;height:5px"><span style="width:${ip}%;background:var(--blue)"></span></div>
      </div>`; }))}</div>`) : ''}
  ${ddWrap('secwins', `${G.sales} والفوز · ${year}`, `${esc(sd.sector.name_ar)} · مقابل هدف المبيعات`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--brand2)">${fmtSar(sd.sales_halalas)}</span><span style="font-size:12px;color:var(--muted)">${countAr(wins.won, { one: 'صفقة واحدة مكسوبة', two: 'صفقتان مكسوبتان', few: 'صفقات مكسوبة', many: 'صفقة مكسوبة' })} · ${G.winRate} ${wins.winRate}%</span></div>
    ${attain(sd.sales_halalas, sd.target_sales_halalas, 'var(--brand2)')}
    <div class="dd-sec">الصفقات المكسوبة</div>
    <div>${ddRows(secWon.map((d) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${esc(d.client || '—')}</span></span><b class="tnum" style="flex:none">${fmtSar(d.value_halalas)}</b></div>`))}</div>`)}
  ${ddWrap('att-late-dlv', 'مخرجات تحتاج متابعة', `${esc(sd.sector.name_ar)} · مخرجات من أشهر سابقة لم تصل إلى الفوترة`, `
    <div>${ddRows(lateDlv.map((d) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.project || '')} · ${esc(d.name_ar)} <span style="color:var(--faint);font-size:10.5px">${MONTHS_AR[(d.month - 1) % 12] || ''}</span></span><b class="tnum" style="flex:none">${fmtSar(d.amount_halalas || 0)}</b></div>`))}</div>`)}
  ${healthDD}
  ${collectDD}
  ${funnelDD}`;

  const switcher = user.scope === 'company' ? `<div class="chips" style="margin-bottom:.6rem"><span class="lbl">القطاع:</span>
    ${allSectors.map((s) => `<a href="/app/sector?year=${year}&sector=${esc(s.id)}&win=${win}" class="chip ${s.id === sectorId ? 'on' : ''}"><span class="dot" style="background:${esc(s.color || '#244A99')}"></span>${esc(s.name_ar)}</a>`).join('')}
    <a class="btn btn-sm" style="margin-inline-start:.3rem" href="/app/ceo?year=${year}&sector=${esc(sectorId)}">لوحة القيادة</a>
  </div>` : '';

  // هرمية المرجع (v5.23): شريط المؤشرات ← [يحتاج تدخلك | ما تغيّر] (٥:٤) ←
  // [القمع | صحة المشاريع | طاقة الفريق] ← أهم العملاء صفاً كاملاً ←
  // [الإيراد عبر السنة + الأداء مقابل الخطة] ← [التحصيل + (التركّز والقرارات)] ← التقارير.
  const scrollB = [collectCard, [concCard, decisionsCard, contractsCard].filter(Boolean).join('')].filter(Boolean);
  const body = `${CSS}
    ${switcher}
    ${toolbar}
    ${kpiStrip}
    <div class="row-main">
      ${attnCard}
      ${changesCard}
    </div>
    <div class="row-ana">
      ${funnelCard}
      ${healthCard}
      ${capCard}
    </div>
    <div style="margin-bottom:var(--gap)">${clientsCard}</div>
    <div class="row-two">${trendCard}${paceSection}</div>
    ${scrollB.length === 2 ? `<div class="row-two">${scrollB[0]}<div style="display:flex;flex-direction:column;gap:var(--gap);min-width:0">${scrollB[1]}</div></div>` : `<div style="display:grid;gap:var(--gap);margin-bottom:var(--gap)">${scrollB.join('')}</div>`}
    ${reportsStrip}
    ${DD}`;
  return layout({ user, active: 'sector', title: `مركز قيادة ${sd.sector.name_ar}`,
    subtitle: `الوضع، ثم السبب، ثم الإجراء التالي · ${year}`, body, year,
    scripts: ['/static/pages/sector.js'] });
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
