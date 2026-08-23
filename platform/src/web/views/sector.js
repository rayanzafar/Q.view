// مركز القيادة (v5) — شاشة قائد القطاع على قاعدة «إشارة ← سياق ← تفصيل»:
// المركز يجيب في ثوانٍ: هل نحن على المسار؟ أين الفجوة الآن؟ هل خط الفرص يكفي وأين يقف؟
// هل لدى الفريق سعة؟ ما صحة المشاريع؟ من أهم العملاء قراراً؟ وما الذي تغيّر في نافذتي؟
// وكل ما بعد ذلك — تحقيق، تعديل، اعتماد — يفتح صفحته الأصلية ولا يُنسخ هنا.
// استثناءٌ مقصود (v5.35، بطلب قائد القطاع عبر المالك): **قسم الأفراد يُفصَّل في مكانه** — الضغط
// على شخصٍ في «طاقة الفريق» يفتح نافذته هنا (حِمله، مشاريعه، مهامه) ولا ينقل القارئ إلى لوحة
// التسكين؛ والروابط إلى صفحته الكاملة ولوحة التسكين أفعالٌ ثانوية داخل النافذة.
// لا رقم بلا مصدر مسجَّل، ولا نصّ مولَّد بالتخمين: جملة الملخص تُركَّب بقواعد معلنة من الأرقام نفسها.
import { layout, card, pill, tr, figBullet, figStacked100, figBars, figColumns } from '../layout.js';
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
import { monthLabel, quarterLabel, nowDot, currentMonthIndex, MONTHS_AR } from '../../core/i18n/time.js';
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

const CARD_HEAD_CSS = `.card-head{padding:var(--pad-card-h);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.card-head .t{font-weight:800;font-size:var(--fs-title)}
.card-head .aux{margin-inline-start:auto;display:flex;gap:.35rem;align-items:center}`;

// مقياس المحور (عرضٌ لا عتبة): الطيف يمتدّ إلى 125% كي يظهر من تجاوز الطاقة داخل الإطار.
const AXIS_MAX = 125;
const axisPct = (v) => (Math.min(AXIS_MAX, Math.max(0, v)) / AXIS_MAX * 100).toFixed(1);
const CSS = `<style>
/* عدسة الفترة روابط لا أزرار (حالتها في الرابط) — تلبس زيّ .seg نفسه */
.seg a{font-size:12px;font-weight:700;color:var(--muted);padding:.35rem .7rem;border-radius:8px;display:flex;align-items:center;gap:.35rem;transition:background .18s,color .18s}
.seg a.on{background:#fff;color:var(--ink2);box-shadow:var(--sh-sm)}
/* الطبقات وشريط الستّ: رؤوس بطاقات بخلاصةٍ محسوبة، صفوف «افعل اليوم»، ودرج التحليل */
.band6{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:1rem}
@media(max-width:1280px){.band6{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:640px){.band6{grid-template-columns:repeat(2,minmax(0,1fr))}.band6>.tile:first-child{grid-column:span 2}}
.g12>div>.card{display:flex;flex-direction:column;min-width:0;height:100%}
.card.h-c,.card.h-d{max-height:460px}
.card .cbody{overflow-y:auto;flex:1;min-height:0}
.hgrp{display:grid;gap:2px;min-width:0}
.card-head .eyebrow,.eyebrow{font-size:var(--fs-body);color:var(--muted);font-weight:700}
.card-head .hgrp .t{font-size:var(--fs-title);font-weight:800;color:var(--ink2);line-height:1.45}
.chead-x{display:grid;gap:2px;margin-bottom:.45rem}
.chead-x .tt{font-size:var(--fs-title);font-weight:800;color:var(--ink2)}
.act-r{display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:.6rem;padding:.55rem .2rem;border-bottom:1px dashed var(--line)}
.act-r:last-child{border-bottom:none}
.act-r .rank{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex:none;justify-self:center}
.act-r .tx{min-width:0}
.act-r .tx .h{font-size:var(--fs-body);font-weight:800;color:var(--ink2);display:block;line-height:1.5}
.act-r .tx .s{font-size:var(--fs-body);color:var(--muted);display:block}
.act-r .go{justify-self:start}
.act-r .go svg{width:13px;height:13px}
@media(max-width:640px){.act-r{grid-template-columns:28px 1fr}.act-r .go{grid-column:2;justify-self:start;min-height:40px}
.chg-cat,.seg a,.seg button,.rmenu summary,.cap-li-btn{min-height:40px;display:inline-flex;align-items:center}
.card-foot a,.card-foot button{min-height:40px;display:inline-flex;align-items:center}}
.rmenu{position:relative}
.rmenu summary{list-style:none;cursor:pointer}
.rmenu summary::-webkit-details-marker{display:none}
.rmenu .rmenu-b{position:absolute;inset-inline-end:0;top:calc(100% + 6px);background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--sh);padding:.5rem;display:grid;gap:.35rem;z-index:30;min-width:200px}
.x-drawer{background:var(--surface);border:1px solid var(--line);border-radius:var(--r)}
.x-drawer>summary{cursor:pointer;padding:.7rem 1rem;font-weight:800;color:var(--ink2);font-size:var(--fs-title);list-style:none;display:flex;gap:.5rem;align-items:center}
.x-drawer>summary::-webkit-details-marker{display:none}
.x-drawer>summary::before{content:'▾';color:var(--muted);font-size:11px;transition:transform .15s}
.x-drawer:not([open])>summary::before{transform:rotate(90deg)}
@keyframes growW{from{width:0}}
.fig-b .fl,.fig-r .tr i,.bar>span{animation:growW .7s ease-out both}
@media (prefers-reduced-motion:reduce){.fig-b .fl,.fig-r .tr i,.bar>span{animation:none;transition:none}}
${CARD_HEAD_CSS}
.empty-mini{padding:.6rem 1rem;font-size:var(--fs-meta);color:var(--muted);display:flex;gap:.45rem;align-items:center}
.empty-mini svg{width:14px;height:14px;color:var(--faint);flex:none}
.card-foot{margin-top:auto;padding:.45rem 1rem .55rem;border-top:1px solid var(--line)}
.card-foot a,.card-foot button{font-size:var(--fs-meta);font-weight:700;color:var(--brand);background:none;border:none;font-family:inherit;cursor:pointer;padding:0;display:inline-flex;gap:.3rem;align-items:center}
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
.chg .d{font-size:10px;color:var(--muted)}
.chg.won{border-inline-start-color:var(--green);background:#f0fdf4}
.chg.lost{border-inline-start-color:var(--red);background:#fef2f2}
.chg[hidden]{display:none}
.chg-cats{padding:.45rem .8rem;display:flex;gap:.3rem;flex-wrap:wrap;border-bottom:1px dashed var(--line)}
.chg-cat{border:1px solid var(--line);background:#fff;color:var(--muted);font-family:inherit;font-weight:700;font-size:var(--fs-micro);padding:.22rem .6rem;border-radius:999px;cursor:pointer}
.chg-cat.on{background:var(--brand);border-color:transparent;color:#fff}
/* طيف قدرة الفريق — محور أرقام يقرأ يساراً كالأرقام نفسها */
.cap-axis{position:relative;height:74px;margin:.4rem 0 .1rem}
.cap-band{position:absolute;inset-inline:0;top:30px;height:12px;border-radius:999px;overflow:hidden;
  background:linear-gradient(to right,#bbf1d4 0%,#bbf1d4 ${axisPct(UTIL_BANDS.FREE_BELOW)}%,#e4e9f2 ${axisPct(UTIL_BANDS.FREE_BELOW)}%,#e4e9f2 ${axisPct(UTIL_BANDS.OVER_ABOVE)}%,#fecaca ${axisPct(UTIL_BANDS.OVER_ABOVE)}%,#fecaca 100%)}
/* ازدحام: فوق ستة عشر شخصاً ثلاثة صفوف بدل اثنين، والمحور أطول — ومن تحت المؤشر يعلو عند المرور */
.cap-axis.dense{height:104px}
.cap-axis.dense .cap-band{top:46px}
.cap-axis.dense .cap-av{top:6px}
.cap-axis.dense .cap-av.r2{top:36px}
.cap-axis.dense .cap-av.r3{top:66px}
.cap-av:hover,.cap-av:focus-visible{z-index:3;transform:translateX(-50%) scale(1.15)}
.cap-dept{display:grid;grid-template-columns:1fr auto auto auto;gap:.6rem;align-items:center;padding:.5rem .35rem;border-bottom:1px dashed var(--line);border-radius:7px;cursor:pointer;font-size:var(--fs-body)}
.cap-dept:hover{background:var(--bg,#f1f5f9)}
.cap-dept:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
.cap-dept .n{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
.cap-dept small{color:var(--muted);font-size:var(--fs-micro);white-space:nowrap}
@media(max-width:640px){.cap-dept{grid-template-columns:1fr auto auto;min-height:40px}.cap-dept small:nth-of-type(2){display:none}.dd-row.cap-li-btn{min-height:40px}.cap-plus{min-height:40px}}
.cap-av{position:absolute;top:14px;width:26px;height:26px;border-radius:50%;border:2px solid #fff;box-shadow:var(--sh-sm);
  background:var(--brand-grad);color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;
  transform:translateX(-50%);cursor:pointer;padding:0;font-family:inherit;transition:left .25s ease}
.cap-av::after{content:'';position:absolute;inset:-8px}
.cap-av.r2{top:44px}
.cap-av.over{background:linear-gradient(120deg,#b91c1c,#dc2626)}
.cap-av.free{background:linear-gradient(120deg,#047857,#059669)}
.cap-ticks{position:relative;height:14px;font-size:9.5px;color:var(--muted)}
.cap-ticks span{position:absolute;transform:translateX(-50%)}
.cap-lists{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:.7rem;border-top:1px dashed var(--line);padding-top:.5rem}
.cap-lists>div{min-width:0}
@media(max-width:640px){.cap-lists{grid-template-columns:1fr}}
.cap-lists .h{font-size:var(--fs-micro);font-weight:800;color:var(--muted);margin-bottom:.15rem}
.cap-li{display:flex;justify-content:space-between;gap:.5rem;font-size:var(--fs-meta);padding:.14rem 0}
/* صفوف تُفتح: مؤشّر وخلفية عند المرور والتركيز — والعلامة ⊕ تقول «هذا يُفتح» كبقية الصفحة */
.cap-li-btn{cursor:pointer;border-radius:7px;padding:.14rem .35rem;margin:0 -.35rem}
.cap-li-btn:hover{background:var(--bg,#f1f5f9)}
.dd-row.cap-li-btn{padding:.5rem .35rem}
@media(max-width:640px){.cap-li-btn{padding:.45rem .35rem}}
.cap-li-btn:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
.tipdot{color:var(--muted);display:inline-flex;vertical-align:middle}
.tipdot svg{width:13px;height:13px}
/* نافذة الشخص: ثلاث إحصاءات وشريط اثني عشر شهراً — خطةٌ صرفة بألوان عتبات التسكين */
.cap-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem;margin:.3rem 0 .2rem}
.cap-stat{background:#f8fafc;border:1px solid var(--line);border-radius:10px;padding:.45rem .6rem;min-width:0}
.cap-stat .l{display:block;font-size:var(--fs-micro);color:var(--muted);font-weight:700}
.cap-stat b{font-size:var(--fs-num-sm);font-weight:800}
.cap-stat small{display:block;font-size:10px;color:var(--muted)}
.cap-strip{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:3px;margin:.2rem 0 .4rem}
.cap-strip .cs{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;height:46px;border-radius:6px;padding:2px 1px 0;background:#f8fafc}
.cap-strip .cs i{display:block;width:100%;max-width:18px;border-radius:3px 3px 0 0;min-height:2px}
.cap-strip .cs b{font-size:9.5px;color:var(--muted);font-weight:700;line-height:1}
.cap-strip .cs.cur{outline:2px solid var(--brand);outline-offset:-2px}
@media(max-width:640px){.cap-stats{grid-template-columns:1fr 1fr}.cap-stat:last-child:nth-child(odd){grid-column:1/-1}}
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
  const canOpps = can(user, 'read', 'opportunity');
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
  const ragActive = (sd.rag.GREEN || 0) + (sd.rag.AMBER || 0) + (sd.rag.RED || 0);
  const needsN = (sd.rag.AMBER || 0) + (sd.rag.RED || 0);
  const ptWord = (n) => { const a = Math.abs(n); return a === 1 ? 'بنقطة واحدة' : a === 2 ? 'بنقطتين' : a <= 10 ? `بـ${a} نقاط` : `بـ${a} نقطة`; };
  // شارة الحكم: رمزٌ وكلمة معاً — واللون لغير السليم وحده (قاعدة «الرمادي أولاً»، ADR-0011).
  // نصّها HTML جاهز الهروب لدى المستدعي (كاتفاق labelHtml) — النصوص الحيّة تمرّ بـesc() هناك.
  const sig = (tone, glyph, text) => `<span class="sig ${tone}"><span class="g" aria-hidden="true">${glyph}</span><span>${text}</span></span>`;
  const paceSig = (d) => d == null ? ''
    : d >= 3 ? sig('ok', '▲', `متقدم ${ptWord(d)} عن المسار الزمني`)
      : d <= -3 ? sig('warn', '▼', `متأخر ${ptWord(d)} عن المسار الزمني`)
        : sig('ok', '✓', 'على المسار الزمني');
  // بطاقة المؤشر: تسمية ← قيمة ← وحدة/فترة ← رسم خطي ← حكم — والبطاقة كلها تفتح تفصيلها.
  const tile = ({ eye, val, valColor = '', unit = '', fig = '', verdict = '', dd = '', act = '', title = '' }) => `
    <div class="tile"${dd || act ? ` role="button" tabindex="0" data-action="${esc(act || 'open-dd')}"${dd ? ` data-dd="${esc(dd)}"` : ''} aria-label="${esc(eye)}: ${esc(String(val).replace(/<[^>]*>/g, ''))} — التفصيل"` : ''}${title ? ` title="${esc(title)}"` : ''}>
      <span class="chev" aria-hidden="true">‹</span>
      <span class="eye">${eye}</span>
      <span class="val tnum"${valColor ? ` style="color:${valColor}"` : ''}>${val}</span>
      <span class="unit">${unit}</span>
      ${fig}${verdict}
    </div>`;

  // ── (٣) عدسة الفترة — تسكن رأس بطاقة «ما تغيّر» نفسها (المرجع)، وهي روابط تعيد التحميل ──
  const lens = `<div class="seg" role="group" aria-label="عدسة الفترة">${WINS.map(([k, l]) =>
    `<a class="${k === win ? 'on' : ''}" style="text-decoration:none" href="${qs({ win: k })}" ${k === win ? 'aria-current="true"' : ''}>${l}</a>`).join('')}</div>`;
  const stageChip = selStage ? `<a class="chip on" href="${qs({ stage: null })}" title="إلغاء تصفية المرحلة">
      المرحلة: ${esc(selStage.name_ar)} <span aria-hidden="true">✕</span></a>
    <span style="font-size:var(--fs-micro);color:var(--muted)">أرقام القمع وأعلى الفرص وأعمارها مصفّاة بهذه المرحلة</span>` : '';
  // شريط الأدوات الواحد (ADR-0011): القطاع (للشركة) · نافذة التغيّر · تصفية المرحلة ·
  // انقضاء السنة · قائمة التقارير — لا أداة تحكم عامة داخل بطاقة بعد اليوم.
  const toolbar = `<div class="toolbar" style="row-gap:.45rem">
    <span style="font-size:var(--fs-body);color:var(--muted);font-weight:700">التغيّر منذ:</span>
    ${lens}
    ${stageChip}
    <span class="spacer"></span>
    <span class="pill" style="background:#fdf6e3;color:#8a6d1a;gap:.4rem">${nowDot('')} ${G.yearElapsed(elapsed)}</span>
    <details class="rmenu"><summary class="btn btn-sm">التقارير ▾</summary>
      <div class="rmenu-b">
        <button class="btn btn-sm" data-action="report-preview" data-report="sector_weekly_status">حالة القطاع الأسبوعية</button>
        <button class="btn btn-sm" data-action="report-preview" data-report="monthly_sector_performance">أداء القطاع الشهري</button>
        <button class="btn btn-sm" data-action="report-send" data-report="sector_weekly_status">أرسله لي الآن</button>
        <a class="btn btn-primary btn-sm" href="/app/reports">جدولة التقارير</a>
      </div></details>
  </div>`;

  // ── (٤) قمع الفرص — عرض المرحلة ∝ قيمتها (أو عددها بالمبدّل)، والنقر يرشّح ──
  // صفّ القمة «إجمالي الفرص» مجموعُ ما تحته لا رقمٌ جديد — ثم كل مرحلة شريطاً أفقياً يضيق.
  // العرض نسبيٌّ **إلى الإجمالي نفسه** (القمة 100%): مقياسٌ واحد لكل الأشرطة فالنسب بينها
  // صادقة — لا أرضية تجميلية تجعل 5% تبدو ثلث 100%. والرقم مطبوع على كل شريط، وضِيقُ
  // الشريط الصغير يحرسه min-width في CSS لا تحريفُ المقياس.
  // النقر يفتح نافذة تفصيل المرحلة (فرصها وقيمها وأزرار التصفية) — لا ترشيحاً صامتاً لا يُرى
  // أثره. ونسبة «الانتقال» حُذفت: سجل المراحل شبه فارغ (أغلب الفرص استوردت بمرحلتها) فأي
  // معدل عبور منه كذبة إحصائية — تعود النسبة حين يتراكم سجل انتقالات حقيقي.
  // القمع بلغة الرسم الواحدة (figBars): لونٌ واحد، العدُّ والقيمة معاً، وكل صفٍّ يفتح تفصيله —
  // لا مبدّل عرضٍ بعد اليوم (كلا الرقمين مطبوع). صفّ القمة مجموع ما تحته على مقياسٍ واحد.
  const stageRow = (st) => ({
    labelHtml: `${esc(st.name_ar)}${selStage && selStage.id === st.id ? ' <span aria-hidden="true">✕</span>' : ''}`,
    value: st.value_halalas, count: st.count, dd: `fnl-${st.id}`,
    ariaLabel: `مرحلة ${st.name_ar}: ${countAr(st.count, { one: 'فرصة واحدة', two: 'فرصتان', few: 'فرص', many: 'فرصة', zero: 'لا فرص' })}${st.count ? ` بقيمة ${fmtSar(st.value_halalas)}` : ''} — التفصيل`,
    fill: selStage && selStage.id === st.id ? 'var(--brand2)' : null,
  });
  const funnelRows = openTotalC === 0 ? '' : figBars([
    { labelHtml: 'الإجمالي المفتوح', value: openTotalV, count: openTotalC, dd: 'fnl-ALL', total: true,
      ariaLabel: `كل الفرص المفتوحة: ${countAr(openTotalC, { one: 'فرصة واحدة', two: 'فرصتان', few: 'فرص', many: 'فرصة', zero: 'لا فرص' })} بقيمة ${fmtSar(openTotalV)} — التفصيل` },
    ...funnelStages.map(stageRow),
  ], { fmt: sarShort, max: Math.max(1, openTotalV) });
  const stalledV = stalledRows.reduce((a, o) => a + (o.value_halalas || 0), 0);
  const oppsHref = `/app/opportunities?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}`;
  const funnelCard = card(`
    <div class="card-head">
      <span class="hgrp"><span class="eyebrow">${G.funnel}${selStage ? ` — مرحلة ${esc(selStage.name_ar)}` : ''} <span class="tipdot" data-tip="عرض كل شريط من قيمته نسبةً إلى الإجمالي المفتوح — والعدد والقيمة مطبوعان معاً. «معلّقة» خارج القمع بقرار تأجيل." tabindex="0" role="img" aria-label="عرض كل شريط من قيمته نسبةً إلى الإجمالي المفتوح — والعدد والقيمة مطبوعان معاً. «معلّقة» خارج القمع بقرار تأجيل.">${icon('info')}</span></span>
      <span class="t">${!openTotalC ? 'لا فرص مفتوحة الآن'
    : stalledRows.length ? `${countAr(stalledRows.length, { one: 'فرصة واحدة متوقفة', two: 'فرصتان متوقفتان', few: 'فرص متوقفة', many: 'فرصة متوقفة' })} من ${countAr(openTotalC, { one: 'فرصة مفتوحة', two: 'فرصتين مفتوحتين', few: 'مفتوحة', many: 'مفتوحة' })}`
      : `${countAr(openTotalC, { one: 'فرصة مفتوحة واحدة', two: 'فرصتان مفتوحتان', few: 'فرص مفتوحة', many: 'فرصة مفتوحة' })} بقيمة ${sarShort(openTotalV)}`}</span></span></div>
    <div class="cbody" style="padding:.3rem 1rem .4rem">
      ${funnelRows || `<div class="empty-mini">${icon('filter')} لا فرص مفتوحة الآن — تُنشأ من صفحة «${G.opportunities || 'الفرص'}»</div>`}
      ${openTotalC ? `<div style="font-size:var(--fs-body);color:var(--muted);margin-top:.6rem;display:flex;gap:.8rem;flex-wrap:wrap;align-items:center">
        <span>متوسط عمر المرحلة <b class="tnum" style="color:var(--ink2)">${avgAge ? dayWord(avgAge) : 'أقل من يوم'}</b></span>
        ${stalledRows.length ? `<button type="button" class="sig warn" data-action="open-dd" data-dd="fnl-stalled" style="border:none;cursor:pointer;font-family:inherit"><span class="g" aria-hidden="true">▲</span><span>${countAr(stalledRows.length, { one: 'فرصة تجاوزت مدتها', two: 'فرصتان تجاوزتا مدتهما', few: 'فرص تجاوزت مدتها المعتادة', many: 'فرصة تجاوزت مدتها المعتادة' })} · ${sarShort(stalledV)}</span></button>` : sig('ok', '✓', 'لا فرص متوقفة')}
      </div>` : ''}
      ${onHoldStage && onHoldStage.count ? `<div style="font-size:var(--fs-body);color:var(--muted);border-top:1px dashed var(--line);padding-top:.4rem;margin-top:.45rem">خارج القمع: <b class="tnum">${countAr(onHoldStage.count, { one: 'فرصة واحدة معلّقة', two: 'فرصتان معلّقتان', few: 'فرص معلّقة', many: 'فرصة معلّقة' })}</b> بقيمة <b class="tnum">${sarShort(onHoldStage.value_halalas)}</b></div>` : ''}
    </div>
    <div class="card-foot"><a href="${oppsHref}">عرض جميع الفرص (<span class="tnum">${openTotalC}</span>) <span aria-hidden="true">←</span></a></div>`, 'h-d');

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
  // فئاتٌ فيها بيانات فقط (v5.38 — عدل قرار v5.22 بإذن إعادة البناء): شريحة فئةٍ فارغة زرٌّ
  // يقود إلى لا شيء. تعود الفئة يوم يسجَّل لها حدثٌ مؤرَّخ.
  const catDefs = [['all', 'الكل'], ['opp', 'الفرص'], ['prj', G.projects], ['client', G.clients], ['team', 'الفريق'], ['fin', 'المالية']];
  const catsPresent = new Set(chg.items.map((it) => CHG_CAT[it.kind] || 'new'));
  const chgCats = catDefs.filter(([k]) => k === 'all' || catsPresent.has(k))
    .map(([k, l]) => `<button type="button" class="chg-cat${k === 'all' ? ' on' : ''}" aria-pressed="${k === 'all'}" data-action="chg-cat" data-cat="${k}">${l}</button>`).join('');
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
    <div class="card-head"><span class="hgrp"><span class="eyebrow">${G.whatChanged}</span>
      <span class="t">${chg.items.length ? `${countAr(chg.items.length, { one: 'تغيير واحد', two: 'تغييران', few: 'تغييرات', many: 'تغييراً' })} ${winEcho}` : `لا تغييرات ${winEcho}`}</span></span></div>
    ${chg.items.length ? `<div class="chg-cats">${chgCats}</div>` : ''}
    <div id="chg-list" class="cbody" style="padding:.45rem .5rem;display:flex;flex-direction:column;gap:2px">
      ${chgRows || `<div class="empty-mini">${icon('history')} لا تغييرات مسجَّلة خلال هذه الفترة — وسّع النافذة إلى الشهر أو الربع من شريط الأدوات</div>`}
    </div>
    ${chg.items.length > SHOW_CHG ? `<div class="card-foot"><button type="button" data-action="chg-more">عرض كل التغييرات (<span class="tnum">${chg.items.length}</span>) <span aria-hidden="true">←</span></button></div>` : ''}`, 'h-c');

  // ── يحتاج تدخلك الآن — ستة كحد أقصى بأثر القرار؛ فئات .act-* (لا .attn — تتصادم مع layout.js) ──
  const rankTone = (t) => t === 'red' ? ['var(--st-bad-soft)', 'var(--st-bad)'] : t === 'amber' ? ['var(--st-warn-soft)', 'var(--st-warn)'] : ['var(--st-neut-soft)', 'var(--st-neut)'];
  const attnItems = attn.slice(0, 6).map((a, i) => {
    const [rb, rf] = rankTone(a.tone);
    return `
    <div class="act-r">
      <span class="rank tnum" style="background:${rb};color:${rf}">${i + 1}</span>
      <span class="tx"><span class="h">${esc(a.title)}</span>${a.sub ? `<span class="s">${esc(a.sub)}</span>` : ''}</span>
      ${a.dd ? `<button class="btn btn-sm go" data-action="open-dd" data-dd="${esc(a.dd)}">${icon(a.icon)} ${esc(a.action)}</button>`
      : `<a class="btn btn-sm go" href="${a.href}${a.href.includes('?') ? '&' : '?'}year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}">${icon(a.icon)} ${esc(a.action)}</a>`}
    </div>`;
  }).join('');
  const attnCard = card(`
    <div class="card-head" id="act">
      <span class="hgrp"><span class="eyebrow">${G.attention} <span class="tipdot" data-tip="بنود من سجلات القطاع الحية مرتبة حسب أثر القرار: اعتمادات معلقة، مستحقات متأخرة، فرص متوقفة أو بلا خطوة، مخرجات لم تُفوتر، تجاوز طاقة" tabindex="0" role="img" aria-label="بنود من سجلات القطاع الحية مرتبة حسب أثر القرار: اعتمادات معلقة، مستحقات متأخرة، فرص متوقفة أو بلا خطوة، مخرجات لم تُفوتر، تجاوز طاقة">${icon('info')}</span></span>
      <span class="t">${attn.length ? `${countAr(Math.min(attn.length, 6), { one: 'أمر واحد يحتاج تدخلك الآن', two: 'أمران يحتاجان تدخلك الآن', few: 'أمور تحتاج تدخلك الآن', many: 'أمراً يحتاج تدخلك الآن' })}` : `${G.nothingNeedsYou} — ${G.allGood}`}</span></span></div>
    <div class="cbody" style="padding:.15rem .8rem .5rem;display:flex;flex-direction:column">
      ${attnItems || `<div class="alert ok" style="justify-content:center;margin:.5rem 0">${icon('approvals')} ${G.nothingNeedsYou} — ${G.allGood}</div>`}
    </div>
    <div class="card-foot"><a href="/app/approvals">عرض ${G.decisions} والاعتمادات <span aria-hidden="true">←</span></a></div>`, 'h-c');

  // ── (٧) قدرة الفريق — طيف حِمل حقيقي من تسكين الشهر، بعتبات المنصة نفسها (70/110) ──
  // العتبات ليست من المرجع البصري بل من الكود القائم: <70 سعة متاحة، 70–110 ضمن النطاق،
  // >110 فوق الطاقة — وهي نفسها في لوحة التسكين وتنبيه «فوق الطاقة». عتبة جديدة هنا كانت
  // ستجعل الشاشتين تحكمان على الشخص نفسه حكمين مختلفين.
  // الطبقة المسمّاة (الصور الرمزية والقائمتان والنوافذ) من كشف التسكين حين يقرأ القارئ
  // الموظفين — خطةً صرفة (`planNow`)؛ ومن لا يقرؤهم يرى مجاميع `sectorStaffing` بلا أسماء.
  const nowMonth = staff.currentMonth;                       // 0 حين تكون السنة غير الجارية
  // أساسٌ واحد للفريق على الصفحة كلها: من يقرأ الموظفين يقرأ كشف التسكين (خطةً صرفة بنطاقه)،
  // ومن لا يقرؤهم يقرأ مجاميع القطاع — فلا يحمل الشريطُ رقماً وبطاقةُ الطاقة رقماً آخر.
  const bandLoad = team ? team.avgNow : (nowMonth ? (staff.teamCurrent ?? staff.teamUtil) : staff.teamUtil);
  const teamSize = team ? team.people.length : staff.headcount;
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
  const capPos = (v) => Number(axisPct(v));
  const overNow = emps.filter((e) => loadOf(e) > OVER_ABOVE);
  const freeNow = emps.filter((e) => loadOf(e) === 0);
  const midNow = emps.filter((e) => loadOf(e) > 0 && loadOf(e) <= OVER_ABOVE);
  // يُرسَم الجميع حتى ستين (الأكثر حِملاً أولاً)، وبعدها «+N آخرون» يفتح نافذة الفريق — لا قصٌّ صامت.
  const CAP_AVATARS = 60;
  const dense = emps.length > 16;
  const capAv = (canPeople ? emps.slice(0, CAP_AVATARS) : []).map((e, i) => {
    const vNow = winVal(e, nowMonth ? 'now' : 'q'), vNext = winVal(e, 'next'), vQ = winVal(e, 'q');
    const cls = loadOf(e) > OVER_ABOVE ? ' over' : loadOf(e) === 0 ? ' free' : '';
    const row = dense ? ['', ' r2', ' r3'][i % 3] : (i % 2 ? ' r2' : '');
    return `<button type="button" class="cap-av${row}${cls}" style="left:${capPos(vNow).toFixed(1)}%"
      data-action="cap-person" data-emp="${esc(e.id || '')}" data-name="${esc(e.name)}" data-job="${esc(e.job || '')}" data-projects="${e.projects}"
      data-now="${vNow}" data-next="${vNext}" data-q="${vQ}"
      title="${esc(e.name)}${e.job ? ' · ' + esc(e.job) : ''} — الحِمل ${nowMonth ? vNow : e.utilization}% · ${countAr(e.projects, { one: 'مشروع واحد', two: 'مشروعان', few: 'مشاريع', many: 'مشروعاً' })}"
      aria-label="${esc(e.name)} — الحِمل ${nowMonth ? vNow : e.utilization}% — التفصيل">${esc(String(e.name || '؟').trim().charAt(0))}</button>`;
  }).join('');
  // صفوف القائمتين أزرار تفتح نافذة الشخص نفسها — لا نصّ جامد بجوار صورةٍ تُفتح.
  const capList = (rows, valFn) => rows.slice(0, 5).map((e) => `<div class="cap-li${e.id ? ' cap-li-btn' : ''}"${e.id ? ` role="button" tabindex="0" data-action="cap-person" data-emp="${esc(e.id)}" aria-label="${esc(e.name)} — الحِمل ${valFn(e)}% — التفصيل"` : ''}>
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name)}${e.job ? ` <span style="color:var(--faint);font-size:var(--fs-micro)">· ${esc(e.job)}</span>` : ''}</span>
      <b class="tnum" style="flex:none">${valFn(e)}%${e.id ? ' <span style="color:var(--faint)" aria-hidden="true">⊕</span>' : ''}</b></div>`).join('')
    || '<div style="font-size:var(--fs-meta);color:var(--muted)">لا أحد ضمن هذه الفئة في هذه النافذة</div>';
  const staffingHref = `/app/staffing?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}`;
  // مُسكَّنون على أعمال القطاع من خارج كشف القارئ (قطاعٌ آخر، أو إدارةٌ خارج نطاقه): العدّ
  // يُقال ولا يُخفى — وإلا قرأ القائد «١٧ في الفريق» هنا و«٢٤» في تقريره ولم يعرف لماذا.
  const outsideRoster = team ? team.outsideRoster : 0;
  const outsideLine = (n) => n === 1 ? 'وشخصٌ آخر مُسكَّن على أعمال القطاع من خارج نطاقك — يظهر في صفحة مشروعه'
    : n === 2 ? 'وشخصان آخران مُسكَّنان على أعمال القطاع من خارج نطاقك — يظهران في صفحات مشاريعهما'
      : `و<b class="tnum">${n}</b> ${n <= 10 ? 'آخرين مُسكَّنين' : 'شخصاً آخر مُسكَّنين'} على أعمال القطاع من خارج نطاقك — يظهرون في صفحات مشاريعهم`;
  // الشهر القادم من الأرقام الحاضرة: من يتفرّغ ومن يتجاوز — قرار توزيعٍ قبل أن يقع.
  const nextHint = (() => {
    if (!nowMonth || nowMonth >= 12 || !emps.length) return '';
    const freeing = emps.filter((e) => loadOf(e) > 0 && winVal(e, 'next') === 0).length;
    const overNext = emps.filter((e) => winVal(e, 'next') > OVER_ABOVE).length;
    if (!freeing && !overNext) return '';
    const parts = [];
    if (freeing) parts.push(`بلا تسكين <b class="tnum">${freeing}</b>`);
    if (overNext) parts.push(`يتجاوز الطاقة <b class="tnum" style="color:var(--red)">${overNext}</b>`);
    return `<div style="font-size:var(--fs-micro);color:var(--muted);padding:0 0 .3rem">الشهر القادم (${monthLabel(nowMonth)}): ${parts.join(' · ')}</div>`;
  })();
  const capEmptyState = !emps.length;
  const capInsight = capEmptyState ? (team ? 'لا موظفين ضمن نطاقك في هذا القطاع' : `لا تسكين مسجَّلاً لسنة ${year}`)
    : overNow.length ? `${countAr(overNow.length, { one: 'موظف واحد فوق الطاقة', two: 'موظفان فوق الطاقة', few: 'موظفين فوق الطاقة', many: 'موظفاً فوق الطاقة' })} من أصل ${teamSize}`
      : freeNow.length ? `${countAr(freeNow.length, { one: 'موظف واحد بلا تسكين', two: 'موظفان بلا تسكين', few: 'موظفين بلا تسكين', many: 'موظفاً بلا تسكين' })} من أصل ${teamSize}`
        : `الفريق ضمن الطاقة — ${countAr(teamSize, { one: 'موظف واحد', two: 'موظفان', few: 'موظفين', many: 'موظفاً' })}`;
  const capCard = card(`
    <div class="card-head">
      <span class="hgrp"><span class="eyebrow">طاقة الفريق · <b class="tnum">${teamSize}</b> ${team ? 'ضمن نطاقك' : 'في الفريق'} <span class="tipdot" data-tip="${nowMonth ? `النافذة: هذا الشهر (${monthLabel(nowMonth - 1)}) — والنوافذ القادمة ضمن تسكين ${year} وحدها` : 'النافذة: متوسط السنة'} · الأرقام من خطة التسكين الشهرية لا ساعات العمل" tabindex="0" role="img" aria-label="${nowMonth ? `النافذة: هذا الشهر (${monthLabel(nowMonth - 1)}) — والنوافذ القادمة ضمن تسكين ${year} وحدها` : 'النافذة: متوسط السنة'} · الأرقام من خطة التسكين الشهرية لا ساعات العمل">${icon('info')}</span></span>
      <span class="t">${capInsight}</span></span>
      <span class="aux">
        ${nowMonth && canPeople && !capEmptyState ? `<div class="seg" role="group" aria-label="نافذة الحِمل">${capWindows.map(([k, l], i) =>
    `<button type="button" class="${i === 0 ? 'on' : ''}" aria-pressed="${i === 0}" data-action="cap-win" data-w="${k}">${l}</button>`).join('')}</div>` : ''}</span></div>
    ${capEmptyState ? `<div class="empty-state" style="flex:1">
      <div class="t">${team ? 'لا موظفين ضمن نطاقك في هذا القطاع' : `لا تسكين مسجَّلاً لسنة ${year}`}</div>
      <div class="s">${team ? 'يُضاف الموظفون من صفحة الفريق، ويُسكَّنون من لوحة التسكين.' : 'يُسجَّل التسكين من لوحة التسكين فتظهر الطاقة هنا.'}</div>
    </div>` : `
    <div class="cbody-top" style="padding:.35rem 1rem 0">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:.6rem;margin-bottom:.3rem">
        <span style="font-size:var(--fs-body);color:var(--muted);font-weight:700">متوسط ${G.utilization}</span>
        <b class="tnum" style="font-size:var(--fs-val-sm);color:${teamLoad > OVER_ABOVE ? 'var(--st-bad)' : 'var(--ink2)'}">${teamLoad}%</b></div>
      ${figStacked100([
    { v: midNow.length, color: 'var(--st-good)' },
    { v: freeNow.length, color: '#c6cdd9' },
    { v: overNow.length, color: 'var(--st-bad)' },
  ], { ariaLabel: `ضمن الطاقة ${midNow.length} · ${nowMonth ? G.onBench : 'بلا تسكين طوال السنة'} ${freeNow.length} · ${G.overloaded} ${overNow.length}` })}
      <div class="fig-leg" style="margin-top:.35rem">
        ${[['mid', 'var(--st-good)', 'ضمن الطاقة', midNow.length], ['free', '#c6cdd9', nowMonth ? G.onBench : 'بلا تسكين طوال السنة', freeNow.length],
    ['over', 'var(--st-bad)', G.overloaded, overNow.length]].map(([k, c, l, n]) => canPeople
    ? `<button type="button" class="r" role="button" data-action="open-dd" data-dd="cap-band-${k}" aria-label="${l}: ${countAr(n, { one: 'شخص واحد', two: 'شخصان', few: 'أشخاص', many: 'شخصاً', zero: 'لا أحد' })} — اعرض التفصيل"><span class="d" style="background:${c}"></span><span class="n">${l}</span><b class="tnum"${k === 'over' && n ? ' style="color:var(--st-bad)"' : ''}>${n}</b></button>`
    : `<span class="r"><span class="d" style="background:${c}"></span><span class="n">${l}</span><b class="tnum">${n}</b></span>`).join('')}
      </div>
    </div>
    <div style="padding:0 1rem">
      <div class="cap-axis${dense ? ' dense' : ''}" dir="ltr" data-staffing="${staffingHref}" data-free="${FREE_BELOW}" data-over="${OVER_ABOVE}" data-axis-max="${AXIS_MAX}">
        <div class="cap-band" role="img" aria-label="طيف الحِمل: حتى ${FREE_BELOW}% سعة متاحة، من ${FREE_BELOW} إلى ${OVER_ABOVE} ضمن الطاقة، وفوق ${OVER_ABOVE} تجاوز للطاقة"></div>
        ${capAv || `<div dir="rtl" style="position:absolute;inset-inline:0;top:18px;text-align:center;font-size:var(--fs-micro);color:var(--muted)">أسماء الأفراد وأحمالهم تظهر لمن يملك صلاحية عرض الفريق</div>`}
      </div>
      <div class="cap-ticks" dir="ltr">
        <span style="left:0%">0%</span><span style="left:${capPos(FREE_BELOW)}%">${FREE_BELOW}%</span><span style="left:${capPos(OVER_ABOVE)}%">${OVER_ABOVE}%</span>
      </div>
      ${canPeople && emps.length > CAP_AVATARS ? `<div style="text-align:center;padding:.1rem 0 .2rem"><button type="button" class="btn btn-ghost btn-sm cap-plus" data-action="open-dd" data-dd="seccap">${emps.length - CAP_AVATARS === 1 ? 'وشخصٌ آخر' : emps.length - CAP_AVATARS === 2 ? 'وشخصان آخران' : `و<span class="tnum">${emps.length - CAP_AVATARS}</span> آخرون`} <span aria-hidden="true">⊕</span></button></div>` : ''}
      <div id="cap-caption" data-tail="الحدود من قواعد التسكين نفسها: ${FREE_BELOW}% و${OVER_ABOVE}%${canPeople ? ' · اضغط على أي شخص لعرض التفصيل' : ''}" style="font-size:var(--fs-micro);color:var(--muted);padding:.15rem 0 .25rem">${nowMonth ? `النافذة: هذا الشهر (${monthLabel(nowMonth - 1)}) — والنوافذ القادمة ضمن تسكين ${year} وحدها` : 'النافذة: متوسط السنة'} · الحدود من قواعد التسكين نفسها: ${FREE_BELOW}% و${OVER_ABOVE}%${canPeople ? ' · اضغط على أي شخص لعرض التفصيل' : ''}</div>
      ${nextHint}
      ${outsideRoster ? `<div style="font-size:var(--fs-micro);color:var(--muted);padding:0 0 .3rem">${outsideLine(outsideRoster)}</div>` : ''}
    </div>
    ${canPeople ? `<div class="cap-lists" style="padding:.4rem 1rem .55rem;flex:1">
      <div><div class="h">متاحون للعمل — الأقل حِملاً</div>${capList([...emps].filter((e) => loadOf(e) < FREE_BELOW).sort((a, b) => loadOf(a) - loadOf(b)), loadOf)}</div>
      <div><div class="h">يحتاجون إعادة توزيع — تجاوزوا الطاقة</div>${capList([...overNow].sort((a, b) => loadOf(b) - loadOf(a)), loadOf)}</div>
    </div>` : '<div style="flex:1"></div>'}`}
    <div class="card-foot"><a href="${staffingHref}">لوحة التسكين الكاملة <span aria-hidden="true">←</span></a></div>`, 'h-d');

  // ── صحة المشاريع — شريط تركيبةٍ واحد بدل الدونات (الطول لا الزاوية)، وأبرز ما يحتاج نظراً ──
  const HEALTH = [['GREEN', G.hOnTrack, 'var(--st-good)'], ['AMBER', G.hAtRisk, 'var(--st-warn)'], ['RED', G.hCritical, 'var(--st-bad)']];
  const healthRows = HEALTH.map(([k, l, c]) => `<button type="button" class="r" role="button" data-action="open-dd" data-dd="sec-health-${k}" ${!(sd.rag[k]) ? 'disabled style="opacity:.45;cursor:default"' : ''} aria-label="${l}: ${sd.rag[k] || 0} — التفصيل">
      <span class="d" style="background:${c}"></span><span class="n">${l}</span>
      <b class="tnum">${sd.rag[k] || 0}</b>
      <span class="m tnum">${ragActive ? Math.round(((sd.rag[k] || 0) / ragActive) * 100) : 0}%</span>
    </button>`).join('');
  const needRows = needProjects.slice(0, 3).map((p) => `<a href="/app/project/${esc(p.id)}" style="display:block;padding:.4rem 0;border-bottom:1px dashed var(--line)">
      <div style="display:flex;align-items:center;gap:.45rem;font-size:var(--fs-body)">
        <span style="width:8px;height:8px;border-radius:50%;background:${p.rag === 'RED' ? 'var(--st-bad)' : 'var(--st-warn)'};flex:none"></span>
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700">${esc(p.name_ar)}</span>
      </div>
      <div style="font-size:var(--fs-body);color:var(--muted);margin-top:.1rem">${p.top_risk ? `أبرز خطر: ${esc(p.top_risk)}` : p.risks ? countAr(p.risks, { one: 'خطر مفتوح واحد', two: 'خطران مفتوحان', few: 'مخاطر مفتوحة', many: 'خطراً مفتوحاً' }) : 'لا سبب مسجَّل — يُسجَّل من صفحة المشروع'}</div>
    </a>`).join('');
  const healthCard = card(`
    <div class="card-head">
      <span class="hgrp"><span class="eyebrow">صحة ${G.projects}${sd.openRisks ? ` · ${G.risks} <b class="tnum">${sd.openRisks}</b>` : ''}</span>
      <span class="t">${!ragActive ? 'لا مشاريع مقيَّمة الصحة'
    : needsN ? `${countAr(needsN, { one: 'مشروع واحد يحتاج تدخلاً', two: 'مشروعان يحتاجان تدخلاً', few: 'مشاريع تحتاج تدخلاً', many: 'مشروعاً يحتاج تدخلاً' })} من أصل ${ragActive}`
      : `المشاريع المقيَّمة كلها على المسار (<span class="tnum">${ragActive}</span>)`}</span></span></div>
    ${ragActive ? `<div class="cbody" style="padding:.35rem 1rem .45rem">
      ${figStacked100(HEALTH.map(([k, , c]) => ({ v: sd.rag[k] || 0, color: c })), { ariaLabel: HEALTH.map(([k, l]) => `${l} ${sd.rag[k] || 0}`).join(' · ') })}
      <div class="fig-leg">${healthRows}</div>
      ${needRows ? `<div style="margin-top:.55rem"><div style="font-size:var(--fs-body);font-weight:800;color:var(--muted)">أبرز ما يحتاج تدخلاً</div>${needRows}</div>` : ''}
    </div>`
    : `<div class="empty-mini cbody">${icon('projects')} لا مشاريع قيد التنفيذ مقيَّمة الصحة — تُقيَّم من صفحة المشروع</div>`}
    <div class="card-foot"><a href="/app/projects?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}">عرض جميع المشاريع <span aria-hidden="true">←</span></a></div>`, 'h-d');

  // ── التحليل الموسّع (الدرج): الإيراد عبر السنة بلغة الأعمدة الواحدة + الفجوة والمتوقع
  // والهامش — «الأداء مقابل الخطة» صار عنوان شريط المؤشرات، وأشرطته في البطاقات نفسها. ──
  const tToDate = targetToDate(sd.target_revenue_halalas, now, year);
  const ytdGap = sd.target_revenue_halalas ? sd.revenue_halalas - tToDate : null;
  const qRevN = (qRev || []).map((r) => (typeof r === 'number' ? r : r.revenue_halalas || 0));
  const qBookN = (qBook || []).map((r) => (typeof r === 'number' ? r : r.sales_halalas || 0));
  const nowQ = year === now.getUTCFullYear() ? Math.floor(now.getUTCMonth() / 3) : -1;
  const qDelta = nowQ > 0 && qRevN[nowQ - 1] ? Math.round(((qRevN[nowQ] - qRevN[nowQ - 1]) / qRevN[nowQ - 1]) * 100) : null;
  const gapPct = ytdGap != null && tToDate ? Math.round((ytdGap / tToDate) * 100) : null;
  const fcPct = sd.target_revenue_halalas ? Math.round(((fc.forecast - sd.target_revenue_halalas) / sd.target_revenue_halalas) * 100) : null;
  const signed = (v) => `<span class="tnum" dir="ltr">${v >= 0 ? '+' : '−'}${sarShort(Math.abs(v))}</span>`;
  const trendSection = `
    <div class="c8" style="min-width:0">
      <div class="chead-x"><span class="eyebrow">${G.revenue} عبر السنة <span class="tipdot" data-tip="توزيع المحقق شهرياً — لا خطة شهرية مسجَّلة فلا تُرسم" tabindex="0" role="img" aria-label="توزيع المحقق شهرياً — لا خطة شهرية مسجَّلة فلا تُرسم">${icon('info')}</span></span>
        <span class="tt">${ytdGap != null ? `${ytdGap >= 0 ? 'متقدم على الخطة' : 'الفجوة حتى اليوم'} ${signed(ytdGap)}${gapPct != null ? ` (<span class="tnum" dir="ltr">${gapPct >= 0 ? '+' : '−'}${Math.abs(gapPct)}%</span>)` : ''} · ` : ''}${G.forecast} <b class="tnum">${sarShort(fc.forecast)}</b>${fcPct != null ? ` (<span class="tnum" dir="ltr">${fcPct >= 0 ? '+' : '−'}${Math.abs(fcPct)}%</span> عن الهدف)` : ''}</span></div>
      ${figColumns(monthly.map((v, i) => ({ v, label: i + 1 })), { now: nowM + 1, ariaLabel: `الإيراد الشهري ${year}: ${monthly.map((v, i) => `${monthLabel(i)} ${sarShort(v)}`).join('، ')}` })}
      ${qDelta != null ? `<div style="font-size:var(--fs-body);color:var(--muted);margin-top:.35rem">إيراد الربع الحالي ${qDelta >= 0 ? 'أعلى' : 'أدنى'} من الربع السابق بنسبة <b class="tnum" style="color:${qDelta >= 0 ? 'var(--st-good)' : 'var(--st-bad)'}">${Math.abs(qDelta)}%</b></div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:.6rem">
        <div><div class="eyebrow" style="margin-bottom:.2rem">${G.revenue} بالأرباع</div>${figColumns(qRevN.map((v, i) => ({ v, label: quarterLabel(i) })), { now: nowQ + 1 })}</div>
        <div><div class="eyebrow" style="margin-bottom:.2rem">${G.bookings} بالأرباع</div>${figColumns(qBookN.map((v, i) => ({ v, label: quarterLabel(i) })), { now: nowQ + 1 })}</div>
      </div>
      ${canMargin && margin && margin.margin_pct != null ? `<div style="font-size:var(--fs-body);color:var(--muted);margin-top:.5rem">هامش الربح الإجمالي <b class="tnum" style="color:${margin.margin_pct < 0 ? 'var(--st-bad)' : 'var(--ink2)'}">${margin.margin_pct}%</b> من الإيراد</div>` : ''}
    </div>`;

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
    if (overdueCids.has(c.id)) return sig('bad', '▲', 'تحصيل متأخر');
    if (stalledCids.has(c.id)) return sig('warn', '▲', 'فرصة متوقفة');
    if (redProjClients.has(c.id)) return sig('bad', '▲', 'مشروع في خطر');
    return '';
  };
  const secRevTotal = sd.revenue_halalas || 0;
  const clientRows = topClients.map((c) => {
    const share = secRevTotal && c.rev ? Math.round((c.rev / secRevTotal) * 100) : null;
    const rel = relationshipOf(lastTouch.get(c.id), oppBy[c.id]?.open_n || 0);
    return `<tr>
      <td><span class="cl-nm"><span class="cl-av" aria-hidden="true">${esc(String(c.name_ar || '؟').trim().charAt(0))}</span><a href="/app/client/${esc(c.id)}" title="${esc(c.name_ar)}">${esc(c.name_ar)}</a></span></td>
      <td class="tnum" style="font-weight:800">${c.rev ? sarShort(c.rev) : '—'}</td>
      <td class="tnum">${share != null ? `${share}%` : '<span style="color:var(--faint)" aria-hidden="true">—</span>'}</td>
      <td class="tnum" title="الفرص ${c.opps} · المشاريع ${c.projects}">${c.pipeline_halalas ? sarShort(c.pipeline_halalas) : '—'}</td>
      <td>${clientSignal(c) || `<span style="color:var(--muted);font-size:var(--fs-body)">${rel}</span>`}</td>
    </tr>`;
  }).join('');
  // جملة التركّز لا تُقال إلا حين يوجد ثلاثة فعلاً — وهي الآن عنوان البطاقة نفسه، ومعها
  // شريط تركيبةٍ واحد بدل بطاقة الدونات المستقلة (اندماج «مخاطر التركّز»).
  const top3 = topClients.filter((c) => c.rev > 0).slice(0, 3);
  const concPct = secRevTotal && top3.length === 3 ? Math.round((top3.reduce((a, c) => a + c.rev, 0) / secRevTotal) * 100) : null;
  const concColors = ['var(--brand)', 'var(--brand2)', '#5b8def'];
  const clientsCard = card(`
    <div class="card-head"><span class="hgrp"><span class="eyebrow">أهم ${G.clients} · مرتَّبون حسب إيراد ${year}${concPct != null ? ` <span class="tipdot" data-tip="مجموع إيراد أكبر ثلاثة عملاء ÷ إيراد القطاع المحقق لهذه السنة" tabindex="0" role="img" aria-label="مجموع إيراد أكبر ثلاثة عملاء ÷ إيراد القطاع المحقق لهذه السنة">${icon('info')}</span>` : ''}</span>
      <span class="t">${concPct != null ? `أكبر ثلاثة عملاء يمثلون <span class="tnum">${concPct}%</span> من الإيراد${concPct >= 60 ? ' — تركّز مرتفع' : ''}` : topClients.length ? `${countAr(topClients.length, { one: 'عميل واحد يقود النشاط', two: 'عميلان يقودان النشاط', few: 'عملاء يقودون النشاط', many: 'عميلاً يقودون النشاط' })}` : G.emptyList}</span></span></div>
    ${concPct != null ? `<div style="padding:.15rem 1rem 0">${figStacked100([
    ...top3.map((c, i) => ({ v: c.rev, color: concColors[i] })),
    { v: Math.max(0, secRevTotal - top3.reduce((a, c) => a + c.rev, 0)), color: '#e8ecf5' },
  ], { mini: true, ariaLabel: `${top3.map((c) => `${c.name_ar} ${Math.round((c.rev / secRevTotal) * 100)}%`).join(' · ')}` })}</div>` : ''}
    <div class="cbody" style="padding:.15rem .5rem .3rem;overflow-x:auto" tabindex="0" role="region" aria-label="جدول أهم العملاء">
      ${clientRows ? `<table class="cl-tbl">
        <thead><tr><th>العميل</th><th>الإيراد ${year}</th><th>الحصة</th><th>المفتوح من فرصه</th><th>الإشارة</th></tr></thead>
        <tbody>${clientRows}</tbody></table>` : `<div class="empty-state" style="padding:1rem"><div class="s">${G.emptyList}</div></div>`}
    </div>
    <div class="card-foot"><a href="/app/clients">عرض جميع العملاء <span aria-hidden="true">←</span></a></div>`);

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
    const bucketRows = figBars(BUCKETS.map(([k, l], i) => ({
      label: l, value: buckets[k] || 0, count: '',
      fill: i === 3 ? 'var(--st-bad)' : null,
    })), { fmt: sarShort, max: bMax });
    const lateRows = odRows.slice(0, 3).map((r) => `<div class="cardclick" role="button" tabindex="0" data-action="open-dd" data-dd="seccollect" style="display:flex;justify-content:space-between;gap:.6rem;align-items:baseline;padding:.32rem 0;border-bottom:1px dashed var(--line);font-size:var(--fs-body)">
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.client || r.project || 'فاتورة')}${r.code ? ` <span style="color:var(--faint);font-size:var(--fs-micro)"><bdi>${esc(r.code)}</bdi></span>` : ''}</span>
        <span style="flex:none;display:flex;gap:.5rem;align-items:baseline">
          <b class="tnum">${fmtSar(r.out)}</b>
          ${r.days ? `<span class="pill" style="background:#fee2e2;color:#991b1b">متأخر ${dayWord(r.days)}</span>` : r.days === 0 ? '<span class="pill" style="background:#fef3c7;color:#92400e">استحق اليوم</span>' : ''}
        </span>
      </div>`).join('');
    const odTotal = odRows.reduce((a, b) => a + b.out, 0);
    collectCard = card(`
      <div class="card-head">
        <span class="hgrp"><span class="eyebrow">التحصيل والمطالبات</span>
        <span class="t">${odRows.length ? `مستحقات متأخرة <span class="tnum">${fmtSar(odTotal)}</span> على ${countAr(odRows.length, { one: 'فاتورة واحدة', two: 'فاتورتين', few: 'فواتير', many: 'فاتورة' })}` : arTotal ? `مستحقات قائمة ${fmtSar(arTotal)} — لا متأخر منها` : 'لا مستحقات قائمة'}</span></span></div>
      ${arTotal || odRows.length ? `
      <div class="cardclick" role="button" tabindex="0" data-action="open-dd" data-dd="seccollect" style="padding:.55rem 1rem;display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px dashed var(--line)">
        <span style="font-size:var(--fs-micro);color:var(--muted)">${G.outstanding} للقطاع · ${year} <span style="color:var(--faint)" aria-hidden="true">⊕</span></span>
        <b class="tnum" style="font-size:var(--fs-num-sm);color:${arTotal ? 'var(--amber)' : 'var(--ink2)'}">${fmtSar(arTotal)}</b></div>
      <div style="padding:.45rem 1rem .3rem">
        <div style="font-size:var(--fs-body);font-weight:700;color:var(--muted);margin-bottom:.15rem">أعمار المستحقات منذ إصدار الفاتورة</div>${bucketRows}
      </div>
      <div style="padding:.35rem 1rem .6rem">
        <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted)">${G.lateClaim}${odRows.length > 3 ? ` — الأكثر تأخراً (3 من ${odRows.length})` : ''}</div>
        ${lateRows || `<div style="font-size:var(--fs-meta);color:var(--faint);padding:.3rem 0">لا فواتير متأخرة السداد — التحصيل منضبط</div>`}
        ${odRows.length > 3 ? `<button class="btn btn-ghost btn-sm" data-action="open-dd" data-dd="seccollect" style="margin-top:.2rem"><span class="tnum" dir="ltr">+${odRows.length - 3}</span> أخرى — الكل <span aria-hidden="true">⊕</span></button>` : ''}
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
          <span>يستحق ${r.due_date ? String(r.due_date).slice(0, 10) : '—'}</span>${r.days ? `<span class="tnum" style="color:var(--red);font-weight:800">متأخر ${dayWord(r.days)}</span>` : r.days === 0 ? '<span style="color:var(--amber);font-weight:800">استحق اليوم</span>' : ''}</div>
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
      <span>متوسط العمر في المرحلة <b class="tnum">${avg ? dayWord(avg) : 'أقل من يوم'}</b></span>
      <span>متوقفة — تجاوزت المدة المعتادة <b class="tnum" style="color:${stalled ? 'var(--amber)' : 'var(--ink2)'}">${stalled}</b></span>
    </div>
    <div class="dd-sec">${rows.length ? `أعلى الفرص قيمةً${rows.length < count ? ` (${rows.length} من ${count})` : ''}` : 'لا فرص ضمن نطاق قراءتك في هذه المرحلة'}</div>
    <div>${ddRows(rows.map((o) => `<div class="dd-row">
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="/app/opportunity/${esc(o.id)}" style="color:var(--ink2);font-weight:700">${esc(o.title_ar)}</a>${o.client ? ` <span style="color:var(--faint);font-size:10.5px">· ${esc(o.client)}</span>` : ''}</span>
      <b class="tnum" style="flex:none">${o.value_halalas ? fmtSar(o.value_halalas) : '—'}</b></div>`))}</div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      ${stageId ? `<a class="btn btn-primary btn-sm" href="${qs({ stage: isOn ? null : stageId })}">${isOn ? 'إلغاء تصفية الشاشة' : 'تصفية بهذه المرحلة'}</a>` : ''}
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
  const capStrip = (months) => `<div class="cap-strip" dir="ltr" role="img" aria-label="حِمل الأشهر: ${months.map((v, i) => `${MONTHS_AR[i]} ${v}%`).join('، ')}">${months.map((v, i) => `
    <span class="cs${nowMonth === i + 1 ? ' cur' : ''}" title="${MONTHS_AR[i]}: ${v}%"><i style="height:${Math.min(100, Math.round(v / 150 * 100))}%;background:${bandColor(v)}"></i><b class="tnum">${i + 1}</b></span>`).join('')}</div>`;
  const capEmpDD = (p) => {
    const live = !!nowMonth;
    const headline = live ? p.planNow : p.annual;
    const sub = [p.job_title, p.department_id ? deptNameOf.get(p.department_id) : null, p.capacity_pct && p.capacity_pct !== 100 ? `${G.capacity} ${p.capacity_pct}%` : null]
      .filter(Boolean).map(esc).join(' · ');
    const stat = (l, v, extra = '') => `<div class="cap-stat"><span class="l">${l}</span><b class="tnum" style="color:${bandColor(v)}">${v}%</b>${extra}</div>`;
    // ديسمبر: «الشهر القادم» خارج خطة السنة — لا صفرٌ يقرأه القائد «بلا تسكين».
    const nextStat = nowMonth >= 12
      ? `<div class="cap-stat"><span class="l">الشهر القادم</span><b>—</b><small>خارج خطة السنة</small></div>`
      : stat('الشهر القادم', p.next);
    const stats = live ? [nextStat, stat('متوسط الأشهر الثلاثة القادمة', p.q3), stat('متوسط السنة', p.annual)]
      : [stat('الذروة', p.peak), `<div class="cap-stat"><span class="l">${G.monthsStaffed}</span><b class="tnum">${p.staffedMonths}</b></div>`];
    const deltaLine = live && p.monthDelta
      ? `<div style="font-size:var(--fs-meta);color:var(--muted)"><b class="tnum" dir="ltr" style="color:${p.monthDelta > 0 ? 'var(--ink2)' : 'var(--green)'}">${p.monthDelta > 0 ? '+' : '−'}${Math.abs(p.monthDelta)}</b> ${countAr(Math.abs(p.monthDelta), { one: 'نقطة واحدة', two: 'نقطتان', few: 'نقاط', many: 'نقطة' })} عن الشهر الماضي</div>` : '';
    const projRows = p.projects.slice(0, 8).map((pr) => {
      const period = allocationPeriod(JSON.stringify(pr.months), year);
      const v = live ? Math.round((Number(pr.months[nowMonth]) || 0) * 100) : period.avgPct;
      const name = pr.projectId ? `<a href="/app/project/${esc(pr.projectId)}" style="color:var(--ink2);font-weight:700">${esc(pr.name)}</a>` : `<span style="font-weight:700">${esc(pr.name)}</span>`;
      const tags = [pr.type === 'lead' ? '<span class="pill" style="background:#dbeafe;color:#1e3a8a">قائد</span>' : '', pr.bucket ? '<span class="pill" style="background:#f1f5f9;color:#475569">عمل داخلي</span>' : ''].join(' ');
      return `<div class="dd-row"><span>${name} ${tags} <span style="color:var(--muted);font-size:10.5px">· ${esc(period.label)}</span></span><b class="tnum">${v}%</b></div>`;
    });
    const moreProj = p.projects.length > 8 ? `<div style="font-size:var(--fs-micro);color:var(--muted)">و${countAr(p.projects.length - 8, { one: 'بند واحد آخر', two: 'بندان آخران', few: 'بنود أخرى', many: 'بنداً آخر' })} في لوحة التسكين</div>` : '';
    const oppRows = p.opportunities.map((o) => `<div class="dd-row"><span>${o.opportunityId ? `<a href="/app/opportunity/${esc(o.opportunityId)}" style="color:var(--ink2);font-weight:700">${esc(o.name)}</a>` : esc(o.name)} <span class="pill" style="background:#fef3c7;color:#92400e">${G.opportunity}</span></span><b class="tnum">${o.pct}%</b></div>`);
    const t = p.tasks;
    const tasksBlock = !t
      ? `<div style="font-size:var(--fs-meta);color:var(--muted)">${p.tasksState === 'no_account' ? 'لا حساب دخول مرتبط — فلا مهام تُعرض' : 'المهام تظهر لمن يملك صلاحية عرض مهام الفريق'}</div>`
      : `<div style="display:flex;gap:1rem;font-size:var(--fs-meta);color:var(--muted);flex-wrap:wrap">
          <span>مفتوحة <b class="tnum" style="color:var(--ink2)">${t.open}</b></span>
          <span>متأخرة <b class="tnum" style="color:${t.late ? 'var(--red)' : 'var(--ink2)'}">${t.late}</b></span>
          <span>مُعطَّلة <b class="tnum" style="color:${t.blocked ? 'var(--amber)' : 'var(--ink2)'}">${t.blocked}</b></span></div>
         ${t.top.length ? `<div>${t.top.map((k) => `<div class="dd-row"><span>${esc(k.title)} ${k.late ? '<span class="pill" style="background:#fee2e2;color:#991b1b">متأخرة</span>' : ''}${k.blocked ? ' <span class="pill" style="background:#fef3c7;color:#92400e">مُعطَّلة</span>' : ''}</span><b class="tnum" style="font-weight:600;color:var(--muted)">${k.due ? esc(k.due) : '—'}</b></div>`).join('')}</div>`
    : (t.open ? '<div style="font-size:var(--fs-micro);color:var(--muted)">العدّ فقط — عناوين المهام تظهر لمن يحقّ له فتح الصفحة الكاملة</div>' : '')}`;
    const footer = [
      p.userId && p.dossierOk ? `<a class="btn btn-primary btn-sm" href="/app/person/${esc(p.userId)}">الصفحة الكاملة</a>` : '',
      `<a class="btn btn-sm" href="${staffingHref}&emp=${esc(p.id)}">لوحة التسكين</a>`,
    ].join('');
    return ddWrap(`cap-emp-${esc(p.id)}`, esc(p.name_ar), sub || esc(sd.sector.name_ar), `
    <div class="dd-kpi"><span class="v tnum" style="color:${bandColor(headline)}">${headline}%</span><span style="font-size:12px;color:var(--muted)">${live ? `${G.utilization} هذا الشهر (${monthLabel(nowMonth - 1)})` : `${G.utilization} — متوسط ${year}`}</span>${loadPill(headline)}</div>
    ${deltaLine}
    ${live && p.oppLoadPct ? `<div style="font-size:var(--fs-meta);color:var(--muted)"><b class="tnum" dir="ltr">+${p.oppLoadPct}%</b> حِمل مبدئي من فرص مفتوحة — يُحتسب على هذا الشهر فقط (المجموع <b class="tnum">${p.currentUtil}%</b>)</div>` : ''}
    <div class="cap-stats">${stats.join('')}</div>
    ${capStrip(p.months)}
    <div class="dd-sec">المشاريع والبنود · ${year}</div>
    <div>${projRows.length ? projRows.join('') : `<div style="color:var(--faint);font-size:12px">لا بنود تسكين في ${year} — يُسكَّن من لوحة التسكين</div>`}${moreProj}</div>
    ${oppRows.length ? `<div class="dd-sec">الفرص المفتوحة</div><div>${oppRows.join('')}</div>` : ''}
    <div class="dd-sec">المهام المفتوحة</div>
    ${tasksBlock}
    <div style="font-size:10.5px;color:var(--muted);margin-top:.4rem">الأرقام من خطة التسكين الشهرية — وليست ساعات عمل فعلية.</div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.2rem">${footer}</div>`);
  };
  const capEmpDDs = team ? team.people.map(capEmpDD).join('') : '';
  // ── نافذة الفريق (v5.36): القطاع ← إداراته القائمة ← أفراد كل إدارة ← نافذة الشخص ──
  // الإدارات كما هي في الهيكل — لا تُنشأ هنا ولا تُفترض؛ و«بلا إدارة» سلّةٌ مسمّاة. أعمدة الإدارة
  // أعدادٌ وإشغال فحسب — لا إيراد ولا حكم «إدارة متعثّرة» (القرار D14 مفتوح).
  const personRow = (e) => `<div class="dd-row cap-li-btn" role="button" tabindex="0" data-action="cap-person" data-emp="${esc(e.id)}" aria-label="${esc(e.name)} — الحِمل ${loadOf(e)}% — التفصيل">
      <span>${esc(e.name)}${e.job ? ` <span style="color:var(--muted);font-size:10.5px">· ${esc(e.job)}</span>` : ''} <span style="color:var(--faint)" aria-hidden="true">⊕</span></span>
      <b class="tnum" style="color:${loadOf(e) > OVER_ABOVE ? 'var(--red)' : loadOf(e) === 0 ? 'var(--brand2)' : 'var(--ink2)'}">${loadOf(e)}%</b></div>`;
  const empById = new Map(emps.map((e) => [e.id, e]));
  const deptRows = (team?.departments || []).map((d) => `<div class="cap-dept" role="button" tabindex="0" data-action="open-dd" data-dd="cap-dept-${esc(d.id || 'none')}" aria-label="${esc(d.name_ar)} — ${countAr(d.headcount, { one: 'موظف واحد', two: 'موظفان', few: 'موظفين', many: 'موظفاً' })} — متوسط ${G.utilization} ${d.avgNow}% — اعرض التفصيل">
      <span class="n">${esc(d.name_ar)} <span style="color:var(--faint)" aria-hidden="true">⊕</span></span>
      <small>${countAr(d.headcount, { one: 'موظف واحد', two: 'موظفان', few: 'موظفين', many: 'موظفاً' })}</small>
      <small>${nowMonth ? 'بلا تسكين' : 'بلا تسكين في السنة'} <b class="tnum">${d.free}</b> · ${G.overloaded} <b class="tnum" style="color:${d.over ? 'var(--red)' : 'inherit'}">${d.over}</b></small>
      <b class="tnum" style="color:${d.avgNow > OVER_ABOVE ? 'var(--red)' : 'var(--ink2)'}">${d.avgNow}%</b></div>`).join('');
  const basisLine = '<div style="font-size:10.5px;color:var(--muted);margin-top:.4rem">الأرقام من خطة التسكين الشهرية — وليست ساعات عمل فعلية.</div>';
  const teamDD = ddWrap('seccap', `طاقة الفريق — ${esc(sd.sector.name_ar)}`, `${nowMonth ? `${G.utilization} هذا الشهر (${monthLabel(nowMonth - 1)})` : `متوسط إشغال ${year}`} · ${canPeople ? 'بالإدارات ثم بالأفراد' : 'مجاميع القطاع'}`, `
    <div class="dd-kpi"><span class="v tnum" style="color:${teamLoad > OVER_ABOVE ? 'var(--red)' : 'var(--ink2)'}">${teamLoad}%</span><span style="font-size:12px;color:var(--muted)">متوسط ${G.utilization} · ${countAr(teamSize, { one: 'موظف واحد', two: 'موظفان', few: 'موظفين', many: 'موظفاً' })}${team ? ' ضمن نطاقك' : ''}</span></div>
    <div style="display:flex;gap:1rem;font-size:12px;color:var(--muted);flex-wrap:wrap">
      <span>ضمن الطاقة <b class="tnum" style="color:var(--ink2)">${midNow.length}</b></span>
      <span>${nowMonth ? 'بلا تسكين الآن' : 'بلا تسكين في السنة'} <b class="tnum" style="color:var(--ink2)">${freeNow.length}</b></span>
      <span>${G.overloaded} <b class="tnum" style="color:${overNow.length ? 'var(--red)' : 'var(--ink2)'}">${overNow.length}</b></span></div>
    ${canPeople ? `
    <div class="dd-sec">حسب الإدارة</div>
    <div>${deptRows || '<div style="color:var(--muted);font-size:12px">لا إدارات ضمن نطاقك في هذا القطاع</div>'}</div>
    <div class="dd-sec">كل الأفراد — الأكثر حِملاً أولاً</div>
    <div>${ddRows([...emps].sort((a, b) => loadOf(b) - loadOf(a)).map(personRow))}</div>
    ${outsideRoster ? `<div style="font-size:var(--fs-micro);color:var(--muted);margin-top:.3rem">${outsideLine(outsideRoster)}</div>` : ''}
    ${basisLine}
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.2rem"><a class="btn btn-sm" href="${staffingHref}">لوحة التسكين الكاملة</a></div>`
    : `<div style="font-size:var(--fs-meta);color:var(--muted);margin-top:.4rem">أسماء الأفراد وأحمالهم تظهر لمن يملك صلاحية عرض الفريق.</div>${basisLine}`}`);
  const deptDDs = (team?.departments || []).map((d) => {
    const members = d.ids.map((id) => empById.get(id)).filter(Boolean).sort((a, b) => loadOf(b) - loadOf(a));
    return ddWrap(`cap-dept-${esc(d.id || 'none')}`, esc(d.name_ar), `${esc(sd.sector.name_ar)} · ${nowMonth ? `${G.utilization} هذا الشهر` : `متوسط إشغال ${year}`}`, `
    <div class="dd-kpi"><span class="v tnum" style="color:${d.avgNow > OVER_ABOVE ? 'var(--red)' : 'var(--ink2)'}">${d.avgNow}%</span><span style="font-size:12px;color:var(--muted)">متوسط ${G.utilization} · ${countAr(d.headcount, { one: 'موظف واحد', two: 'موظفان', few: 'موظفين', many: 'موظفاً' })}${nowMonth ? ` · متوسط السنة <b class="tnum">${d.avgAnnual}%</b>` : ''}</span></div>
    <div style="display:flex;gap:1rem;font-size:12px;color:var(--muted);flex-wrap:wrap">
      <span>${nowMonth ? 'بلا تسكين الآن' : 'بلا تسكين في السنة'} <b class="tnum" style="color:var(--ink2)">${d.free}</b></span>
      <span>${G.overloaded} <b class="tnum" style="color:${d.over ? 'var(--red)' : 'var(--ink2)'}">${d.over}</b></span></div>
    <div class="dd-sec">الأفراد</div>
    <div>${members.length ? members.map(personRow).join('') : '<div style="color:var(--muted);font-size:12px">لا موظفين في هذه الإدارة ضمن نطاقك</div>'}</div>
    ${basisLine}
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.2rem"><button type="button" class="btn btn-sm" data-action="open-dd" data-dd="seccap">كل الفريق</button></div>`);
  }).join('');
  const bandDDs = !canPeople ? '' : [
    ['mid', 'ضمن الطاقة', midNow, `مُسكَّنون حتى ${OVER_ABOVE}% من الطاقة — ومنهم من لديه ${G.underused} (أقل من ${FREE_BELOW}%)`],
    ['free', nowMonth ? G.onBench : 'بلا تسكين طوال السنة', freeNow, nowMonth ? `لا بند تسكين في ${monthLabel(nowMonth - 1)}` : `لا شهر مُسكَّن واحد في ${year}`],
    ['over', G.overloaded, overNow, `فوق ${OVER_ABOVE}% من الطاقة`],
  ].map(([k, l, rows, sub]) => ddWrap(`cap-band-${k}`, l, `${esc(sd.sector.name_ar)} · ${sub}`, `
    <div class="dd-kpi"><span class="v tnum" style="color:${k === 'over' ? 'var(--red)' : k === 'free' ? 'var(--brand2)' : 'var(--green)'}">${rows.length}</span><span style="font-size:12px;color:var(--muted)">${countAr(rows.length, { one: 'شخص واحد', two: 'شخصان', few: 'أشخاص', many: 'شخصاً', zero: 'لا أحد' })} ضمن نطاقك</span></div>
    <div>${rows.length ? [...rows].sort((a, b) => loadOf(b) - loadOf(a)).map(personRow).join('') : '<div style="color:var(--muted);font-size:12px">لا أحد ضمن هذه الفئة في هذه النافذة</div>'}</div>
    ${basisLine}
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.2rem"><button type="button" class="btn btn-sm" data-action="open-dd" data-dd="seccap">كل الفريق</button></div>`)).join('');
  // ── تغطية خط الفرص: المعادلة مكشوفة بأطرافها، ثم القمع وصفحة الفرص ──
  const coverDD = ddWrap('seccover', 'تغطية خط الفرص', `${esc(sd.sector.name_ar)} · ${year}`, `
    <div class="dd-kpi"><span class="v tnum" style="color:${(cover?.coverage ?? 1) < 1 ? 'var(--amber)' : 'var(--ink2)'}">${cover?.coverage != null ? `×${cover.coverage}` : '—'}</span><span style="font-size:12px;color:var(--muted)">${cover?.coverage != null ? 'المفتوح ÷ المتبقي من هدف المبيعات' : 'لا متبقٍّ من هدف المبيعات — الهدف محقَّق أو غير مسجَّل'}</span></div>
    <div>
      <div class="dd-row"><span>القيمة المفتوحة في خط الفرص</span><b class="tnum">${fmtSar(cover?.open_halalas || 0)}</b></div>
      <div class="dd-row"><span>المتبقي من هدف المبيعات ${year}</span><b class="tnum">${fmtSar(cover?.remaining_target_halalas || 0)}</b></div>
      <div class="dd-row"><span>المفتوح مرجّحاً باحتمال الفوز <span style="color:var(--muted);font-size:10.5px">· للاستئناس لا للحكم</span></span><b class="tnum">${fmtSar(cover?.weighted_halalas || 0)}</b></div>
    </div>
    <div style="font-size:var(--fs-micro);color:var(--muted);margin-top:.3rem">×1 فأكثر يعني أن ما في الخط يغطي المتبقي من الهدف لو كُسب كله — وما تحت ×1 فجوةٌ تحتاج فرصاً جديدة.</div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.4rem">
      <button type="button" class="btn btn-primary btn-sm" data-action="open-dd" data-dd="fnl-ALL">تفصيل القمع</button>
      ${canOpps ? `<a class="btn btn-sm" href="${oppsPageHref}">فتح صفحة الفرص</a>` : ''}
    </div>`);
  // ── المتوقفة: الفرص التي تجاوزت المدة المعتادة لمرحلتها — أسماؤها بنطاق القارئ ──
  const stalledIds = new Set(stalledRows.map((o) => o.id));
  const stalledNamed = ddOppRows.filter((o) => stalledIds.has(o.id));
  const stalledAge = new Map(stalledRows.map((o) => [o.id, ageDays(o.since)]));
  const stalledShown = stalledNamed.slice(0, 12);
  const stalledDD = ddWrap('fnl-stalled', 'فرص متوقفة تحتاج متابعة', `${esc(sd.sector.name_ar)} · تجاوزت المدة المعتادة لمرحلتها`, `
    <div class="dd-kpi"><span class="v tnum" style="color:${stalledRows.length ? 'var(--amber)' : 'var(--ink2)'}">${stalledRows.length}</span><span style="font-size:12px;color:var(--muted)">بقيمة ${fmtSar(stalledRows.reduce((a, o) => a + (o.value_halalas || 0), 0))}</span></div>
    <div class="dd-sec">${!stalledShown.length ? 'لا فرص متوقفة ضمن نطاق قراءتك'
    : stalledShown.length === stalledRows.length ? 'الفرص'
      : stalledNamed.length === stalledRows.length ? `الفرص (الأعلى ${stalledShown.length} قيمةً من ${stalledRows.length})`
        : stalledShown.length === stalledNamed.length ? `الفرص (${stalledShown.length} من ${stalledRows.length} ضمن نطاق قراءتك)`
          : `الفرص (الأعلى ${stalledShown.length} قيمةً من ${stalledNamed.length} ضمن نطاق قراءتك — الإجمالي ${stalledRows.length})`}</div>
    <div>${ddRows(stalledShown.map((o) => `<div class="dd-row">
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="/app/opportunity/${esc(o.id)}" style="color:var(--ink2);font-weight:700">${esc(o.title_ar)}</a>${o.client ? ` <span style="color:var(--muted);font-size:10.5px">· ${esc(o.client)}</span>` : ''} <span style="color:var(--amber);font-size:10.5px">· ${dayWord(stalledAge.get(o.id) || 0)} في المرحلة</span></span>
      <b class="tnum" style="flex:none">${o.value_halalas ? fmtSar(o.value_halalas) : '—'}</b></div>`))}</div>
    ${canOpps ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.4rem"><a class="btn btn-sm" href="${oppsPageHref}">فتح صفحة الفرص</a></div>` : ''}`);
  const rosterIds = new Set((team?.people || []).map((p) => p.id));
  // نافذة بند «فوق الطاقة» في «يحتاج تدخلك»: الأسماء من الخدمة (محجوبة لمن لا يقرأ الموظفين)،
  // والصفّ يفتح نافذة صاحبه إن كان في الكشف.
  const overRows = (attn.find((a) => a.dd === 'att-overload')?.ddRowsData) || [];
  const overloadDD = ddWrap('att-overload', `${G.overloaded} هذا الشهر`, `${esc(sd.sector.name_ar)} · من خطة تسكين ${MONTHS_AR[Number(today.slice(5, 7)) - 1] || ''}`, `
    <div>${overRows.length ? overRows.map((x) => rosterIds.has(x.employee_id)
    ? `<div class="dd-row cap-li-btn" role="button" tabindex="0" data-action="cap-person" data-emp="${esc(x.employee_id)}"><span style="font-weight:700">${esc(x.name)} <span style="color:var(--faint)" aria-hidden="true">⊕</span></span><b class="tnum" style="color:var(--red)">${x.pct}%</b></div>`
    : `<div class="dd-row"><span style="font-weight:700">${esc(x.name)}</span><b class="tnum" style="color:var(--red)">${x.pct}%</b></div>`).join('')
    : `<div style="color:var(--muted);font-size:12px">${canPeople ? 'لا أحد تجاوز الطاقة ضمن نطاقك' : 'أسماء الأفراد تظهر لمن يملك صلاحية عرض الفريق'}</div>`}</div>
    <div style="font-size:10.5px;color:var(--muted);margin-top:.4rem">الأرقام من خطة التسكين الشهرية — وليست ساعات عمل فعلية.</div>
    ${canPeople ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap"><a class="btn btn-sm" href="${staffingHref}">لوحة التسكين</a></div>` : ''}`);
  const DD = `
  ${capEmpDDs}
  ${overloadDD}
  ${teamDD}
  ${deptDDs}
  ${bandDDs}
  ${coverDD}
  ${stalledDD}
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

  const switcher = user.scope === 'company' ? `<span class="lbl" style="font-size:var(--fs-body);color:var(--muted);font-weight:700">القطاع:</span>
    ${allSectors.map((s) => `<a href="/app/sector?year=${year}&sector=${esc(s.id)}&win=${win}" class="chip ${s.id === sectorId ? 'on' : ''}"><span class="dot" style="background:${esc(s.color || '#244A99')}"></span>${esc(s.name_ar)}</a>`).join('')}
    <a class="btn btn-sm" href="/app/ceo?year=${year}&sector=${esc(sectorId)}">لوحة القيادة</a>
    <span style="flex:0 0 100%;height:0" aria-hidden="true"></span>` : '';

  // ── شريط المؤشرات الستة (ADR-0011): أولها يميناً «يحتاج تدخلك» — محفّز الفعل في أول ما
  // تقع عليه العين، والأرقام كلها محسوبة أعلاه. لا حلقة ولا عداد: مساراتٌ وأشرطة تركيب. ──
  const covGapH = cover?.coverage != null && cover.coverage < 1 ? Math.max(0, (cover.remaining_target_halalas || 0) - (cover.open_halalas || 0)) : 0;
  const bandTiles = [
    tile({
      eye: G.attention, act: 'act-jump',
      val: attn.length ? String(Math.min(attn.length, 6)) : `0`,
      valColor: attn.length ? 'var(--st-bad)' : '',
      unit: attn.length === 1 ? 'بند مرتّب بأثر القرار' : attn.length ? 'بنود مرتّبة بأثر القرار' : G.nothingNeedsYou,
      verdict: attn.length ? sig('bad', '▲', `أعلاها: ${esc(attn[0].title)}`) : sig('ok', '✓', G.allGood),
    }),
    tile({
      eye: `${G.revenue} المحقق`, dd: 'secrev', title: fmtSar(sd.revenue_halalas),
      val: sarShort(sd.revenue_halalas),
      unit: sd.target_revenue_halalas ? `من ${G.target} <b class="tnum">${sarShort(sd.target_revenue_halalas)}</b> · ${year}` : 'لا هدف مسجّل لهذه السنة',
      fig: attainRev != null ? figBullet({ pct: attainRev, tick: elapsed, ariaLabel: `تحقق ${attainRev}% من المستهدف وانقضى ${elapsed}% من السنة` }) : '',
      verdict: paceSig(dRev),
    }),
    tile({
      eye: G.sales, dd: 'secwins', title: fmtSar(sd.sales_halalas),
      val: sarShort(sd.sales_halalas),
      unit: sd.target_sales_halalas ? `من ${G.target} <b class="tnum">${sarShort(sd.target_sales_halalas)}</b> · ${countAr(wins.won, { one: 'صفقة واحدة مكسوبة', two: 'صفقتان مكسوبتان', few: 'صفقات مكسوبة', many: 'صفقة مكسوبة', zero: 'لا صفقات مكسوبة' })}` : 'لا هدف مسجّل لهذه السنة',
      fig: attainSales != null ? figBullet({ pct: attainSales, tick: elapsed, ariaLabel: `تحقق ${attainSales}% من المستهدف وانقضى ${elapsed}% من السنة` }) : '',
      verdict: paceSig(dSales),
    }),
    tile({
      eye: 'تغطية خط الفرص', dd: 'seccover',
      val: cover?.coverage != null ? `×${cover.coverage}` : '—',
      unit: 'المفتوح ÷ المتبقي من هدف المبيعات',
      fig: cover?.coverage != null ? figBullet({ pct: Math.min(100, cover.coverage * 50), tick: 50, ariaLabel: `التغطية ×${cover.coverage} والعلامة عند ×1` }) : '',
      verdict: cover?.coverage == null ? '' : cover.coverage >= 1 ? sig('ok', '✓', 'الخط يغطي المتبقي من الهدف') : sig('warn', '▼', `فجوة ${sarShort(covGapH)} دون ×1`),
    }),
    tile({
      eye: 'صحة التنفيذ', dd: ragActive ? (needsN ? 'sec-health-RED' : 'sec-health-GREEN') : '',
      val: ragActive ? `<span dir="ltr">${sd.rag.GREEN || 0}/${ragActive}</span>` : '—',
      unit: ragActive ? 'على المسار من المشاريع المقيَّمة' : 'لا مشاريع مقيَّمة الصحة',
      fig: ragActive ? figStacked100([
        { v: sd.rag.GREEN || 0, color: 'var(--st-good)' }, { v: sd.rag.AMBER || 0, color: 'var(--st-warn)' }, { v: sd.rag.RED || 0, color: 'var(--st-bad)' },
      ], { mini: true, ariaLabel: `${G.hOnTrack} ${sd.rag.GREEN || 0} · ${G.hAtRisk} ${sd.rag.AMBER || 0} · ${G.hCritical} ${sd.rag.RED || 0}` }) : '',
      verdict: !ragActive ? '' : needsN ? sig('warn', '▲', `${G.hCritical} ${sd.rag.RED || 0} · ${G.hAtRisk} ${sd.rag.AMBER || 0}`) : sig('ok', '✓', 'الكل على المسار'),
    }),
    tile({
      eye: 'طاقة الفريق', dd: 'seccap',
      val: `${bandLoad}%`, valColor: bandLoad > OVER_ABOVE ? 'var(--st-bad)' : '',
      unit: `متوسط ${G.utilization} · ${countAr(teamSize, { one: 'موظف واحد', two: 'موظفان', few: 'موظفين', many: 'موظفاً' })}${nowMonth ? ` · ${monthLabel(nowMonth - 1)}` : ''}`,
      fig: emps.length ? figStacked100([
        { v: midNow.length, color: 'var(--st-good)' }, { v: freeNow.length, color: '#c6cdd9' }, { v: overNow.length, color: 'var(--st-bad)' },
      ], { mini: true, ariaLabel: `ضمن الطاقة ${midNow.length} · بلا تسكين ${freeNow.length} · ${G.overloaded} ${overNow.length}` }) : '',
      verdict: overNow.length ? sig('bad', '▲', `${countAr(overNow.length, { one: 'موظف واحد فوق الطاقة', two: 'موظفان فوق الطاقة', few: 'موظفين فوق الطاقة', many: 'موظفاً فوق الطاقة' })}`)
        : freeNow.length ? sig('neut', '•', `${countAr(freeNow.length, { one: 'موظف واحد بلا تسكين', two: 'موظفان بلا تسكين', few: 'موظفين بلا تسكين', many: 'موظفاً بلا تسكين' })}`)
          : emps.length ? sig('ok', '✓', 'الفريق ضمن الطاقة') : '',
    }),
  ].join('');

  // ── الدرج: التحليل الموسّع — تفصيلٌ للفحص لا للمراقبة اليومية ──
  const drawer = `<details class="psec x-drawer"><summary>التحليل الموسّع — ${G.revenue} عبر السنة · ${G.decisions} والاعتمادات · العقود</summary>
    <div class="g12" style="padding:.4rem 1rem 1rem">
      ${trendSection}
      <div class="c4" style="min-width:0;display:grid;gap:.8rem;align-content:start">
        ${decisionsCard}
        ${contractsCard}
      </div>
    </div>
  </details>`;

  // ── تكوين الصفحة: ثلاث طبقاتٍ مُعنونة بسؤالها ثم الدرج (ADR-0011) ──
  const body = `${CSS}
    <div class="dash">
    ${switcher ? `<div class="toolbar" style="row-gap:.45rem">${switcher}</div>` : ''}
    ${toolbar}
    <div class="tier"><h2 class="q">هل نحن على المسار؟</h2><span class="s">الأداء مقابل الخطة · ${year}</span></div>
    <div class="band6">${bandTiles}</div>
    <div class="tier"><h2 class="q">ماذا أفعل اليوم؟</h2></div>
    <div class="g12">
      <div class="c7" style="min-width:0">${attnCard}</div>
      <div class="c5" style="min-width:0">${changesCard}</div>
    </div>
    <div class="tier"><h2 class="q">أين الفجوة ولماذا؟</h2></div>
    <div class="g12">
      <div class="c4" style="min-width:0">${funnelCard}</div>
      <div class="c4" style="min-width:0">${healthCard}</div>
      <div class="c4" style="min-width:0">${capCard}</div>
    </div>
    <div class="g12">
      <div class="${canInvoices && collectCard ? 'c7' : 'c12'}" style="min-width:0">${clientsCard}</div>
      ${canInvoices && collectCard ? `<div class="c5" style="min-width:0">${collectCard}</div>` : ''}
    </div>
    ${drawer}
    </div>
    ${DD}`;
  return layout({ user, active: 'sector', title: `مركز قيادة ${sd.sector.name_ar}`,
    subtitle: `الوضع، ثم السبب، ثم ${G.nextAction} · ${year}`, body, year,
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
