// مركز القيادة (v5) — شاشة قائد القطاع على قاعدة «إشارة ← سياق ← تفصيل»:
// المركز يجيب في ثوانٍ: هل نحن على المسار؟ أين الفجوة الآن؟ هل خط الفرص يكفي وأين يقف؟
// هل لدى الفريق سعة؟ ما صحة المشاريع؟ من أهم العملاء قراراً؟ وما الذي تغيّر في نافذتي؟
// وكل ما بعد ذلك — تحقيق، تعديل، اعتماد — يفتح صفحته الأصلية ولا يُنسخ هنا.
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
import { myProjectsInSector, nextMilestones } from '../../modules/pmo/projects.js';
import { effectiveProgress } from '../../modules/pmo/progress.js';
import { myOpportunitiesInSector, ROT_THRESHOLDS } from '../../modules/crm/opportunities.js';
import { sectorIdentity } from '../../modules/org/org.js';
import { can, effectiveScope, canSeeSensitive } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { SCOPE_RANK } from '../../core/rbac/matrix.js';
import { config } from '../../core/config.js';
import { DELIVERY_SECTOR_SQL } from '../../core/org/kind.js';
import { G } from '../i18n/glossary.js';
import { monthLabel, monthLabelDual, quarterLabel, nowDot, currentMonthIndex, MONTHS_AR } from '../../core/i18n/time.js';
import { countAr, dayWord } from '../../core/i18n/plural.js';
import { esc, ddWrap, attain, ddRows, paceCard, sarShort } from './_shared.js';

const TONE = { brand: 'var(--brand)', green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)' };

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
// فئات «ما تغيّر» كما تعرضها الشارات — تُشتقّ من نوع السجل نفسه لا من نصّه. لا فئة «مشاريع»
// و«فريق» هنا عمداً: لا سجلات مؤرّخة لهما اليوم غير سجل الإنشاء، وشارةٌ تَعِد بفئةٍ فارغة
// دائماً أسوأ من غيابها.
const CHG_CAT = { stage: 'opp', invoice: 'fin', collection: 'fin', activity: 'client', created: 'new' };
// حدّة كل نوع — قاعدة معلنة لا تقدير: الحسم (فوز/خسارة) عالٍ، حركة المرحلة والفاتورة وسط،
// والتحصيل والتواصل والسجل الجديد أخبار هادئة.
const CHG_SEV = (it) => (it.won || it.lost) ? ['عالية', '#fee2e2', '#991b1b']
  : (it.kind === 'stage' || it.kind === 'invoice') ? ['متوسطة', '#fef3c7', '#92400e']
  : ['منخفضة', '#f1f5f9', '#64748b'];

// ── لبنات رسم صغيرة (SVG محلي — لا مكتبة رسم) ────────────────────────────────
// حلقة إنجاز واحدة: تُستعمل حصراً حيث الرقم «جزء من هدف/كل» — لا زينة على كل رقم.
function ring(p, { size = 66, sw = 8, color = 'var(--brand)' } = {}) {
  const pc = Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
  const r = (size - sw) / 2, c = 2 * Math.PI * r;
  return `<span class="ringw" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" style="transform:rotate(-90deg)">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#eef1f7" stroke-width="${sw}"/>
      ${pc > 0 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${((pc / 100) * c).toFixed(1)} ${c.toFixed(1)}"/>` : ''}
    </svg><span class="ringv tnum">${pc}%</span></span>`;
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
.sec-grid{display:grid;gap:var(--gap);margin-bottom:var(--gap);grid-template-columns:1.35fr 1fr}
.sec-grid.even{grid-template-columns:1fr 1fr}
@media(max-width:980px){.sec-grid,.sec-grid.even{grid-template-columns:1fr}}
.sec-col{display:flex;flex-direction:column;gap:var(--gap);min-width:0}
/* عدسة الفترة روابط لا أزرار (حالتها في الرابط) — تلبس زيّ .seg نفسه */
.seg a{font-size:12px;font-weight:700;color:var(--muted);padding:.35rem .7rem;border-radius:8px;display:flex;align-items:center;gap:.35rem}
.seg a.on{background:#fff;color:var(--ink2);box-shadow:var(--sh-sm)}
${CARD_HEAD_CSS}
/* جملة الملخص التنفيذي — سطر واحد لا لوحة تنبيهات */
.xin{display:flex;align-items:flex-start;gap:.7rem;padding:.75rem 1rem;margin-bottom:var(--gap)}
.xin .ic{flex:none;width:34px;height:34px;border-radius:10px;background:linear-gradient(120deg,rgba(36,74,153,.12),rgba(131,71,152,.12));color:var(--brand);display:flex;align-items:center;justify-content:center}
.xin .tx{font-size:var(--fs-ui);line-height:1.9;color:var(--ink2)}
.xin .tx b{font-weight:800}
.xin .sub{display:block;font-size:var(--fs-meta);color:var(--muted)}
/* شريط المؤشرات: بطاقتا الإيراد والمبيعات أكبر بصرياً، والبقية أخف */
.kpi-strip{display:grid;grid-template-columns:1.25fr 1.25fr repeat(2,1fr);gap:var(--gap);margin-bottom:var(--gap)}
@media(max-width:1180px){.kpi-strip{grid-template-columns:1fr 1fr}}
@media(max-width:640px){.kpi-strip{grid-template-columns:1fr}}
.kpi-hero{display:flex;gap:.8rem;align-items:center;padding:.75rem .95rem}
.kpi-hero .lbl{font-size:var(--fs-meta);color:var(--muted);font-weight:700}
.kpi-hero .num{font-size:var(--fs-num-md);font-weight:800;letter-spacing:-.02em;line-height:1.25}
.kpi-hero .tgt{font-size:var(--fs-micro);color:var(--faint)}
.ringw{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none}
.ringv{position:absolute;font-size:12px;font-weight:800;color:var(--ink2)}
.kpi-minis{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap)}
.kpi-mini{padding:.55rem .8rem;display:flex;flex-direction:column;gap:.05rem;justify-content:center}
.kpi-mini .l{font-size:var(--fs-micro);color:var(--muted);font-weight:700}
.kpi-mini .v{font-size:var(--fs-num-sm);font-weight:800}
.kpi-mini .s{font-size:9.5px;color:var(--faint)}
/* القمع v2: أشرطة متدرجة بنفسجياً، تُختار مرحلةً بالنقر */
.fnl-lbl{font-size:var(--fs-meta);display:flex;justify-content:center;gap:.45rem;align-items:baseline;margin-bottom:.18rem}
.fnl-stage{display:block;border-radius:10px;padding:.15rem .2rem .25rem;border:1px solid transparent}
.fnl-stage:hover{background:#fbfcfe;border-color:var(--line)}
.fnl-stage.on{background:#f6f3fa;border-color:#d9c9e4;box-shadow:var(--sh-sm)}
.fnl-stage.dim .fnl-bar{opacity:.32}
.fnl-bar{height:18px;border-radius:9px;margin:0 auto;opacity:.95;transition:width .25s ease}
.fnl-conv{text-align:center;font-size:10px;color:var(--faint);line-height:1.6;padding:.1rem 0}
.fnl-side{border-inline-start:1px dashed var(--line);padding-inline-start:.9rem;display:flex;flex-direction:column;gap:.55rem;min-width:0}
.fnl-side .h{font-size:var(--fs-micro);font-weight:800;color:var(--muted)}
.fnl-kv{display:flex;justify-content:space-between;gap:.6rem;font-size:var(--fs-meta);align-items:baseline}
.fnl-kv b{flex:none}
.fnl-wrap{display:grid;grid-template-columns:1.5fr 1fr;gap:.9rem;padding:.6rem 1rem .5rem}
@media(max-width:640px){.fnl-wrap{grid-template-columns:1fr}.fnl-side{border-inline-start:none;padding-inline-start:0;border-top:1px dashed var(--line);padding-top:.6rem}}
/* «ما تغيّر» */
.chg{display:flex;align-items:center;gap:.6rem;padding:.4rem .55rem;border-radius:10px;border:1px solid transparent;border-inline-start:3px solid transparent}
.chg:hover{background:#fbfcfe;border-color:var(--line)}
.chg .ic{width:26px;height:26px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center}
.chg .ic svg{width:14px;height:14px}
.chg .tx{flex:1;min-width:0}
.chg .h{display:block;font-size:var(--fs-body);font-weight:700;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chg .s{display:block;font-size:var(--fs-micro);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chg .meta{flex:none;text-align:left}
.chg .amt{display:block;font-size:var(--fs-body);font-weight:800;color:var(--ink2)}
.chg .d{display:block;font-size:10px;color:var(--faint)}
.chg.won{border-inline-start-color:var(--green);background:#f0fdf4}
.chg.lost{border-inline-start-color:var(--red);background:#fef2f2}
.chg[hidden]{display:none}
.chg-cats{padding:.5rem .8rem;display:flex;gap:.3rem;flex-wrap:wrap;border-bottom:1px dashed var(--line)}
.chg-cat{border:1px solid var(--line);background:#fff;color:var(--muted);font-family:inherit;font-weight:700;font-size:var(--fs-micro);padding:.22rem .6rem;border-radius:999px;cursor:pointer}
.chg-cat.on{background:var(--brand);border-color:transparent;color:#fff}
@media(max-width:640px){.attn .tx .h{white-space:normal;overflow:visible;line-height:1.5}}
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
.cap-nums{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;padding:.2rem 0 .4rem}
.cap-nums .l{font-size:10px;color:var(--muted)}
.cap-nums .v{font-size:var(--fs-num-sm);font-weight:800}
.cap-lists{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;border-top:1px dashed var(--line);padding-top:.5rem}
@media(max-width:640px){.cap-lists{grid-template-columns:1fr}}
.cap-lists .h{font-size:var(--fs-micro);font-weight:800;color:var(--muted);margin-bottom:.15rem}
.cap-li{display:flex;justify-content:space-between;gap:.5rem;font-size:var(--fs-meta);padding:.14rem 0}
/* صحة المشاريع */
.hl-wrap{display:flex;gap:1rem;align-items:center;padding:.7rem 1rem .4rem;flex-wrap:wrap}
.hl-legend{display:flex;flex-direction:column;gap:.3rem;min-width:0;flex:1}
.hl-row{display:flex;align-items:center;gap:.5rem;font-size:var(--fs-body);border:none;background:none;font-family:inherit;cursor:pointer;padding:.18rem .35rem;border-radius:8px;text-align:start}
.hl-row:hover{background:#fbfcfe}
.hl-row .dot{width:9px;height:9px;border-radius:50%;flex:none}
.hl-row b{margin-inline-start:auto}
/* أهم العملاء */
.cl-row{display:block;padding:.5rem 0;border-bottom:1px dashed var(--line)}
.cl-row:last-child{border-bottom:none}
.cl-top{display:flex;justify-content:space-between;gap:.7rem;align-items:baseline}
.cl-top .nm{font-size:var(--fs-body);font-weight:700;color:var(--ink2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cl-meta{display:flex;gap:.2rem .8rem;flex-wrap:wrap;font-size:var(--fs-micro);color:var(--muted);margin-top:.1rem;align-items:center}
.cl-sig{display:inline-flex;align-items:center;gap:.3rem;font-size:10px;font-weight:800;padding:.1rem .45rem;border-radius:999px}
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
  const winEcho = WINS.find((w) => w[0] === win)[2];
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
  const [chg, attn, fc, monthly, qRev, qBook, cover, staff, wins] = await Promise.all([
    changesSince(user, sectorId, sinceForWindow(win, now)),
    attentionFeed(user, sectorId, { year, today }),
    revenueForecast(sectorId, year),
    monthlyRevenue(sectorId, year),
    quarterlyRevenue(sectorId, year),
    quarterlyBookings(sectorId, year),
    pipelineCoverage(sectorId, year),
    sectorStaffing(sectorId, year),
    sectorWins(sectorId, year),
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
  // المشاريع التي تحتاج نظر القائد — الحمراء أولاً، ومع كلٍّ أبرزُ خطرٍ مفتوح إن سُجِّل.
  const needProjects = await all(`SELECT p.id, p.name_ar, p.rag,
      (SELECT COUNT(*) FROM risk r WHERE r.project_id = p.id AND r.status != 'CLOSED' AND r.deleted_at IS NULL) risks,
      (SELECT r2.title FROM risk r2 WHERE r2.project_id = p.id AND r2.status != 'CLOSED' AND r2.deleted_at IS NULL
        ORDER BY CASE r2.probability WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END LIMIT 1) top_risk
     FROM project p WHERE p.sector_id = ? AND p.deleted_at IS NULL AND p.status = 'IN_PROGRESS' AND p.rag IN ('RED','AMBER')
     ORDER BY CASE p.rag WHEN 'RED' THEN 0 ELSE 1 END, p.name_ar LIMIT 6`, [sectorId]);
  const healthLists = {};
  for (const rag of ['GREEN', 'AMBER', 'RED']) {
    healthLists[rag] = (sd.rag[rag]) ? await all(`SELECT id, name_ar, progress_pct FROM project
       WHERE sector_id = ? AND deleted_at IS NULL AND status = 'IN_PROGRESS' AND rag = ? ORDER BY name_ar LIMIT 30`, [sectorId, rag]) : [];
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

  const elapsed = yearElapsedPct(now, year);
  const nowM = currentMonthIndex(year);

  // ── (١) جملة الملخص التنفيذي — تُركَّب بقواعد معلنة من الأرقام، لا نص مولَّد ──
  const attainRev = sd.target_revenue_halalas ? Math.round((sd.revenue_halalas / sd.target_revenue_halalas) * 100) : null;
  const dRev = paceDelta(sd.revenue_halalas, sd.target_revenue_halalas, now, year);
  const biggestStage = [...pipe].filter((s) => s.id !== 'ON_HOLD').sort((a, b) => b.value_halalas - a.value_halalas)[0];
  let insightMain, insightSub;
  if (attainRev != null) {
    const paceTxt = dRev == null ? '' : dRev >= 3 ? `، ونحن متقدمون على المسار الزمني بـ<b class="tnum">${dRev}</b> ${dRev <= 10 ? 'نقاط' : 'نقطة'}`
      : dRev <= -3 ? `، ونحن متأخرون عن المسار الزمني بـ<b class="tnum">${Math.abs(dRev)}</b> ${Math.abs(dRev) <= 10 ? 'نقاط' : 'نقطة'}`
      : '، ونحن على المسار الزمني';
    insightMain = `حقّقنا <b class="tnum">${attainRev}%</b> من هدف إيراد ${year}${paceTxt}.`;
    insightSub = cover?.coverage != null && cover.coverage < 1
      ? `القيمة المفتوحة تغطي <b class="tnum">×${cover.coverage}</b> فقط من المتبقي من هدف المبيعات — القطاع يحتاج فرصاً جديدة، لا الاكتفاء بتحريك القائمة.`
      : biggestStage && biggestStage.value_halalas
        ? `أكبر قيمة مفتوحة تنتظر في مرحلة «${esc(biggestStage.name_ar)}» (<b class="tnum">${sarShort(biggestStage.value_halalas)}</b>) — هناك أثر التحريك الأكبر.`
        : `لا فرص مفتوحة مسجَّلة الآن — «${G.funnel}» فارغ.`;
  } else {
    insightMain = `إيراد ${year} المحقق <b class="tnum">${fmtSar(sd.revenue_halalas)}</b> — لا هدف مسجَّل لهذه السنة فلا يُقاس مسار.`;
    insightSub = `القيمة المفتوحة في خط الفرص <b class="tnum">${fmtSar(pipe.reduce((a, b) => a + b.value_halalas, 0))}</b>. الهدف يُسجَّل من صفحة «الهيكل التنظيمي».`;
  }
  const insightStrip = card(`<div class="xin">
    <span class="ic">${icon('trend')}</span>
    <div style="min-width:0"><span class="tx">${insightMain}</span><span class="sub">${insightSub}</span></div>
    <span class="aux" style="margin-inline-start:auto;flex:none"><span class="pill" style="background:#fdf6e3;color:#8a6d1a;gap:.4rem">${nowDot('')} ${G.yearElapsed(elapsed)}</span></span>
  </div>`);

  // ── (٢) شريط المؤشرات: بطلان (الإيراد والمبيعات) + مؤشرات خفيفة ──
  const attainSales = sd.target_sales_halalas ? Math.round((sd.sales_halalas / sd.target_sales_halalas) * 100) : null;
  const dSales = paceDelta(sd.sales_halalas, sd.target_sales_halalas, now, year);
  const ptWord = (n) => (Math.abs(n) <= 10 ? 'نقاط' : 'نقطة');
  const paceChip = (d) => d == null ? '' : d >= 3 ? `<span class="pace-chip up">متقدم بـ<b class="tnum">${d}</b> ${ptWord(d)}</span>`
    : d <= -3 ? `<span class="pace-chip down">متأخر بـ<b class="tnum">${Math.abs(d)}</b> ${ptWord(d)}</span>`
    : '<span class="pace-chip flat">على المسار</span>';
  const hero = (label, actualH, targetH, atn, dlt, color, dd, extra) => `
    <div class="card kpi-hero cardclick" role="button" tabindex="0" data-action="open-dd" data-dd="${dd}" aria-label="${label} — التفصيل">
      ${atn != null ? ring(atn, { color }) : `<span class="ringw" style="width:66px;height:66px"><span style="font-size:10px;color:var(--faint);text-align:center;line-height:1.5">بلا هدف<br>مسجَّل</span></span>`}
      <div style="min-width:0">
        <div class="lbl">${label} <span style="color:var(--faint)" aria-hidden="true">⊕</span></div>
        <div class="num tnum" style="color:${color}">${fmtSar(actualH)}</div>
        <div class="tgt">${targetH ? `من هدف <span class="tnum">${fmtSar(targetH)}</span>` : 'لا هدف مسجَّل لهذه السنة'} ${paceChip(dlt)}</div>
        ${extra || ''}
      </div>
    </div>`;
  const ragActive = (sd.rag.GREEN || 0) + (sd.rag.AMBER || 0) + (sd.rag.RED || 0);
  const needsN = (sd.rag.AMBER || 0) + (sd.rag.RED || 0);
  const mini = (label, val, sub, color, act) => `
    <${act ? 'a' : 'div'} class="card kpi-mini${act ? ' cardclick' : ''}" ${act || ''}>
      <span class="l">${label}</span><span class="v tnum" style="color:${color || 'var(--ink2)'}">${val}</span>${sub ? `<span class="s">${sub}</span>` : ''}
    </${act ? 'a' : 'div'}>`;
  const kpiStrip = `<div class="kpi-strip">
    ${hero(`${G.revenue} المحقق ${year}`, sd.revenue_halalas, sd.target_revenue_halalas, attainRev, dRev, 'var(--green)', 'secrev')}
    ${hero(`${G.sales} ${year}`, sd.sales_halalas, sd.target_sales_halalas, attainSales, dSales, 'var(--brand2)', 'secwins',
    `<div class="tgt">${countAr(wins.won, { one: 'صفقة مكسوبة واحدة', two: 'صفقتان مكسوبتان', few: 'صفقات مكسوبة', many: 'صفقة مكسوبة' })}</div>`)}
    <div class="kpi-minis">
      ${mini('تغطية خط الفرص', cover?.coverage != null ? `×${cover.coverage}` : '—',
    'المفتوح ÷ المتبقي من هدف المبيعات', (cover?.coverage ?? 1) < 1 ? 'var(--amber)' : 'var(--ink2)',
    `href="/app/opportunities?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}"`)}
      ${mini(`${G.winRate} ${year}`, `${wins.winRate}%`, `الفوز ${wins.won} · الخسارة ${wins.lost}`, 'var(--green)', `role="button" tabindex="0" data-action="open-dd" data-dd="secwins"`)}
      ${mini('مشاريع نشطة', String(sd.projects.IN_PROGRESS || 0), 'قيد التنفيذ الآن', 'var(--ink2)',
    `href="/app/projects?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}"`)}
      ${canMargin && margin && margin.margin_pct != null
    ? mini('هامش الربح الإجمالي', `${margin.margin_pct}%`, 'الإيراد − الكلفة والمصروف المعتمد', margin.margin_pct < 0 ? 'var(--red)' : 'var(--ink2)')
    : mini('على المسار', String(sd.rag.GREEN || 0), ragActive ? `من ${countAr(ragActive, { one: 'مشروع مقيَّم', two: 'مشروعين مقيَّمين', few: 'مشاريع مقيَّمة', many: 'مشروعاً مقيَّماً' })}` : 'لا مشاريع مقيَّمة', 'var(--green)', `role="button" tabindex="0" data-action="open-dd" data-dd="sec-health-GREEN"`)}
    </div>
    <div class="kpi-minis">
      ${mini('تحتاج تدخلاً', String(needsN), needsN ? `${G.hCritical} ${sd.rag.RED || 0} · ${G.hAtRisk} ${sd.rag.AMBER || 0}` : 'لا مشروع متعثر', needsN ? 'var(--red)' : 'var(--ink2)', needsN ? `role="button" tabindex="0" data-action="open-dd" data-dd="sec-health-RED"` : '')}
      ${mini(G.forecast, sarShort(fc.forecast), 'المحقق + المرجّح من المفتوح', 'var(--brand)', `role="button" tabindex="0" data-action="open-dd" data-dd="secrev"`)}
      ${canMargin && margin && margin.margin_pct != null
    ? mini('على المسار', String(sd.rag.GREEN || 0), ragActive ? `من ${countAr(ragActive, { one: 'مشروع مقيَّم', two: 'مشروعين مقيَّمين', few: 'مشاريع مقيَّمة', many: 'مشروعاً مقيَّماً' })}` : 'لا مشاريع مقيَّمة', 'var(--green)', `role="button" tabindex="0" data-action="open-dd" data-dd="sec-health-GREEN"`)
    : mini(G.capacity, `${staff.teamCurrent ?? staff.teamUtil}%`, `${countAr(staff.headcount, { one: 'موظف واحد', two: 'موظفان', few: 'موظفين', many: 'موظفاً' })} هذا الشهر`, (staff.teamCurrent ?? 0) > 110 ? 'var(--red)' : 'var(--ink2)', `href="/app/staffing?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}"`)}
      ${mini(G.raw + ' المفتوحة', sarShort(pipe.reduce((a, b) => a + b.value_halalas, 0)), countAr(openRows.length, { one: 'فرصة واحدة مفتوحة', two: 'فرصتان مفتوحتان', few: 'فرص مفتوحة', many: 'فرصة مفتوحة' }), 'var(--brand2)',
    `href="/app/opportunities?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}"`)}
    </div>
  </div>`;
  // ── (٣) عدسة الفترة + شارة المرحلة المختارة ──
  const lens = `<div class="seg" role="group" aria-label="عدسة الفترة">${WINS.map(([k, l]) =>
    `<a class="${k === win ? 'on' : ''}" style="text-decoration:none" href="${qs({ win: k })}" ${k === win ? 'aria-current="true"' : ''}>${l}</a>`).join('')}</div>`;
  const stageChip = selStage ? `<a class="chip on" href="${qs({ stage: null })}" title="إلغاء تصفية المرحلة">
      المرحلة: ${esc(selStage.name_ar)} <span aria-hidden="true">✕</span></a>
    <span style="font-size:var(--fs-micro);color:var(--muted)">أرقام القمع وأعلى الفرص وأعمارها مصفّاة بهذه المرحلة</span>` : '';
  const toolbar = `<div class="toolbar" style="margin-bottom:var(--gap)">
    ${lens}
    <span style="font-size:var(--fs-micro);color:var(--muted)">تضبط نافذة «${G.whatChanged}»</span>
    <span class="spacer"></span>${stageChip}
  </div>`;

  // ── (٤) قمع الفرص — عرض المرحلة ∝ قيمتها (أو عددها بالمبدّل)، والنقر يرشّح ──
  const funnelStages = pipe.filter((st) => st.id !== 'ON_HOLD');
  const onHoldStage = pipe.find((st) => st.id === 'ON_HOLD');
  const maxV = Math.max(1, ...funnelStages.map((s) => s.value_halalas));
  const maxC = Math.max(1, ...funnelStages.map((s) => s.count));
  const funnelRows = funnelStages.map((s, i) => {
    const wv = Math.max(12, Math.round((s.value_halalas / maxV) * 100));
    const wc = Math.max(12, Math.round((s.count / maxC) * 100));
    const next = funnelStages[i + 1];
    // النسبة لقطة أعداد حالية لا تدفّق تاريخي — وحين تكون المرحلة التالية أكثر من الحالية
    // لا معنى لـ«N% تنتقل» فتُطوى بدل أن تُطبع 250%.
    const conv = next && s.count > 0 && next.count <= s.count ? Math.round((next.count / s.count) * 100) : null;
    const on = selStage && selStage.id === s.id;
    return `<a class="fnl-stage${on ? ' on' : selStage ? ' dim' : ''}" href="${qs({ stage: on ? null : s.id })}"
        title="${esc(s.name_ar)}: ${countAr(s.count, { one: 'فرصة واحدة', two: 'فرصتان', few: 'فرص', many: 'فرصة', zero: 'لا فرص' })} بقيمة ${fmtSar(s.value_halalas)} — انقر ${on ? 'لإلغاء التصفية' : 'لتصفية الشاشة بهذه المرحلة'}">
      <div class="fnl-lbl">
        <span style="font-weight:700">${esc(s.name_ar)}</span>
        <b class="tnum">${s.count}</b>
        <span class="tnum" style="color:var(--muted);font-size:var(--fs-micro)">${sarShort(s.value_halalas)}</span>
      </div>
      <div class="fnl-bar" data-wv="${s.value_halalas ? wv : 0}" data-wc="${s.count ? wc : 0}" style="width:${s.value_halalas ? wv : 0}%;background:${funnelColor(i, funnelStages.length)}"></div>
    </a>
    ${conv != null ? `<div class="fnl-conv">↓ <b class="tnum">${conv}%</b> تنتقل</div>` : ''}`;
  }).join('');
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
  const scopedTotal = scoped.reduce((a, o) => a + (o.value_halalas || 0), 0);
  const scopedWeighted = selStage ? Math.round(selStage.weighted) : Math.round(pipe.reduce((a, b) => a + b.weighted, 0));
  const topOppRows = topOpps.map((o) => `<div class="fnl-kv">
      <a href="/app/opportunity/${esc(o.id)}" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink2)">${esc(o.title_ar)}${o.client ? ` <span style="color:var(--faint);font-size:var(--fs-micro)">· ${esc(o.client)}</span>` : ''}</a>
      <b class="tnum">${o.value_halalas ? sarShort(o.value_halalas) : '—'}</b>
    </div>`).join('') || '<div style="font-size:var(--fs-meta);color:var(--faint)">لا فرص ضمن هذه التصفية</div>';
  const funnelCard = card(`
    <div class="card-head">
      <span class="t">${G.funnel}${selStage ? ` — مرحلة ${esc(selStage.name_ar)}` : ''}</span>
      <span class="aux">
        <div class="seg" role="group" aria-label="مقياس عرض القمع">
          <button type="button" class="on" aria-pressed="true" data-action="fnl-mode" data-mode="value">بالقيمة</button>
          <button type="button" aria-pressed="false" data-action="fnl-mode" data-mode="count">بالعدد</button>
        </div>
        <a class="btn btn-sm" href="/app/opportunities?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}">عرض جميع الفرص</a></span></div>
    <div style="padding:.6rem 1rem;display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;border-bottom:1px dashed var(--line)">
      <div><div style="font-size:10px;color:var(--muted)">${G.raw}${selStage ? ' — المرحلة' : ''}</div><div class="tnum" style="font-weight:800;font-size:var(--fs-num-sm)">${fmtSar(scopedTotal)}</div></div>
      <div data-tip="مجموع (قيمة الفرصة × احتمال فوزها) ${selStage ? 'لفرص هذه المرحلة' : 'لكل الفرص المفتوحة'}" tabindex="0"><div style="font-size:10px;color:var(--muted)">${G.weighted} ⓘ</div><div class="tnum" style="font-weight:800;font-size:var(--fs-num-sm);color:var(--brand)">${fmtSar(scopedWeighted)}</div></div>
      <div data-tip="المكسوبة ÷ المحسومة (فوز + خسارة) لسنة ${year} — التاريخي مستثنى" tabindex="0"><div style="font-size:10px;color:var(--muted)">${G.winRate} ${year} <span aria-hidden="true">ⓘ</span></div><div class="tnum" style="font-weight:800;font-size:var(--fs-num-sm);color:var(--green)">${wins.winRate}%</div></div>
      <div data-tip="${G.raw} من الفرص المفتوحة ÷ المتبقي من هدف المبيعات — أقل من ×1 يعني الحاجة لفرص جديدة" tabindex="0"><div style="font-size:10px;color:var(--muted)">التغطية <span aria-hidden="true">ⓘ</span></div><div class="tnum" style="font-weight:800;font-size:var(--fs-num-sm);color:${(cover?.coverage ?? 1) < 1 ? 'var(--amber)' : 'var(--ink2)'}">${cover?.coverage != null ? '×' + cover.coverage : '—'}</div></div>
    </div>
    <div class="fnl-wrap">
      <div>${funnelRows || `<div class="empty-state" style="padding:1rem"><div class="s">${G.emptyList}</div></div>`}
        ${onHoldStage && onHoldStage.count ? `<div style="font-size:var(--fs-micro);color:var(--muted);border-top:1px dashed var(--line);padding-top:.4rem;margin-top:.2rem">خارج القمع: <b class="tnum">${countAr(onHoldStage.count, { one: 'فرصة واحدة معلّقة', two: 'فرصتان معلّقتان', few: 'فرص معلّقة', many: 'فرصة معلّقة' })}</b> بقيمة <b class="tnum">${sarShort(onHoldStage.value_halalas)}</b> — بقرار تأجيل يُراجع دورياً</div>` : ''}</div>
      <div class="fnl-side">
        <div>
          <div class="h">نبض الفرص${selStage ? ' — ضمن المرحلة' : ''}</div>
          <div class="fnl-kv"><span style="color:var(--muted)">متوسط عمر الفرصة في مرحلتها</span><b class="tnum">${dayWord(avgAge)}</b></div>
          <div class="fnl-kv"><span style="color:var(--muted)">متوقفة — تجاوزت المدة المعتادة لمرحلتها</span><b class="tnum" style="color:${stalledRows.length ? 'var(--amber)' : 'var(--ink2)'}">${stalledRows.length}</b></div>
        </div>
        <div>
          <div class="h">أعلى ${countAr(Math.min(3, topOpps.length) || 3, { one: 'فرصة', two: 'فرصتين', few: 'فرص', many: 'فرص' })} قيمةً</div>
          ${topOppRows}
        </div>
      </div>
    </div>
    <div style="padding:.5rem 1rem .6rem;border-top:1px dashed var(--line)">
      <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted);margin-bottom:.2rem">عمر الفرص في مرحلتها الحالية${selStage ? ` — مرحلة ${esc(selStage.name_ar)}` : ''}</div>${agingRows}
    </div>`);

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
  const catDefs = [['all', 'الكل'], ['opp', 'الفرص'], ...(canInvoices ? [['fin', 'المالية']] : []), ['client', 'العملاء'], ['new', 'سجلات جديدة']];
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
  const changesCard = card(`
    <div class="card-head"><span class="t">${G.whatChanged} ${winEcho}</span>
      <span class="aux" style="font-size:var(--fs-micro);color:var(--faint)">سجلات مؤرّخة فقط — لا تقدير</span></div>
    <div class="chg-cats">${chgCats}</div>
    <div id="chg-list" style="padding:.45rem .5rem;display:flex;flex-direction:column;gap:2px;max-height:430px;overflow-y:auto">
      ${chgRows || `<div class="empty-state" style="padding:1.2rem 1rem">${icon('history')}<div class="t">لا تغييرات مسجلة خلال هذه الفترة</div><div class="s">وسّع العدسة أعلاه إلى الشهر أو الربع لرؤية حركة أقدم</div></div>`}
    </div>
    ${chg.items.length > SHOW_CHG ? `<div style="padding:.35rem .8rem .6rem"><button type="button" class="btn btn-ghost btn-sm" data-action="chg-more">عرض كل التغييرات (<span class="tnum">${chg.items.length}</span>)</button></div>` : ''}`);

  // ── (٦) يحتاج تدخلك الآن — ستة كحد أقصى، مرتبة بأثر القرار (ترتيب المصدر نفسه) ──
  const toneBg = { brand: 'rgba(36,74,153,.1)', green: '#dcfce7', amber: '#fef3c7', red: '#fee2e2' };
  const attnItems = attn.slice(0, 6).map((a) => `
    <div class="attn">
      <span class="ic" style="background:${toneBg[a.tone] || '#f1f5f9'};color:${TONE[a.tone] || 'var(--ink2)'}">${icon(a.icon)}</span>
      <span class="tx"><span class="h">${esc(a.title)}</span>${a.sub ? `<div class="s">${esc(a.sub)}</div>` : ''}</span>
      ${a.dd ? `<button class="btn btn-sm go" data-action="open-dd" data-dd="${esc(a.dd)}">${esc(a.action)}</button>`
      : `<a class="btn btn-sm go" href="${a.href}${a.href.includes('?') ? '&' : '?'}year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}">${esc(a.action)}</a>`}
    </div>`).join('');
  const attnCard = card(`
    <div class="card-head">
      <span class="t">${G.attention}</span>
      ${attn.length ? `<span class="pill" style="background:#fee2e2;color:#991b1b">${Math.min(attn.length, 6)}</span>` : ''}
      <span class="aux" style="font-size:var(--fs-micro);color:var(--faint)">مرتبة حسب أثر القرار</span>
    </div>
    <div style="padding:.6rem .7rem;display:flex;flex-direction:column;gap:.45rem">
      ${attnItems || `<div class="alert ok" style="justify-content:center">${icon('approvals')} ${G.nothingNeedsYou} — ${G.allGood}</div>`}
    </div>`);

  // ── (٧) قدرة الفريق — طيف حِمل حقيقي من تسكين الشهر، بعتبات المنصة نفسها (70/110) ──
  // العتبات ليست من المرجع البصري بل من الكود القائم: <70 سعة متاحة، 70–110 ضمن النطاق،
  // >110 فوق الطاقة — وهي نفسها في لوحة التسكين وتنبيه «فوق الطاقة». عتبة جديدة هنا كانت
  // ستجعل الشاشتين تحكمان على الشخص نفسه حكمين مختلفين.
  const emps = staff.employees || [];
  const nowMonth = staff.currentMonth;                       // 0 حين تكون السنة غير الجارية
  // سنةٌ غير جارية لا «شهر حالي» لها: current يعود صفراً للجميع، فبِناء العدّادات عليه كان
  // سيقول «الكل بلا تسكين» عن سنةٍ اشتغلوا فيها. الوضع السنوي يقرأ متوسط السنة بدلاً منه.
  const loadOf = (e) => (nowMonth ? e.current : e.utilization);
  const teamLoad = nowMonth ? (staff.teamCurrent ?? staff.teamUtil) : staff.teamUtil;
  const capWindows = [['now', 'هذا الشهر'], ['next', 'الشهر القادم'], ['q', 'الأشهر الثلاثة القادمة']];
  const winVal = (e, w) => {
    if (!nowMonth) return e.utilization;
    if (w === 'now') return e.current;
    if (w === 'next') return nowMonth < 12 ? e.months[nowMonth] : 0;
    const span = e.months.slice(nowMonth, nowMonth + 3);
    return span.length ? Math.round(span.reduce((a, b) => a + b, 0) / span.length) : 0;
  };
  const capPos = (v) => Math.min(125, Math.max(0, v)) / 125 * 100;
  const overNow = emps.filter((e) => loadOf(e) > 110);
  const freeNow = emps.filter((e) => loadOf(e) === 0);
  const midNow = emps.filter((e) => loadOf(e) > 0 && loadOf(e) <= 110);
  // أسماء الأفراد وأحمالهم لمن يقرأ الموظفين — البقية يرون مجاميع الفريق بلا أسماء، كما
  // تُحجب بطاقة التحصيل عمّن لا يقرأ الفواتير.
  const canPeople = can(user, 'read', 'employee');
  const capAv = (canPeople ? emps.slice(0, 24) : []).map((e, i) => {
    const vNow = winVal(e, nowMonth ? 'now' : 'q'), vNext = winVal(e, 'next'), vQ = winVal(e, 'q');
    const cls = loadOf(e) > 110 ? ' over' : loadOf(e) === 0 ? ' free' : '';
    return `<button type="button" class="cap-av${i % 2 ? ' r2' : ''}${cls}" style="left:${capPos(vNow).toFixed(1)}%"
      data-action="cap-person" data-name="${esc(e.name)}" data-job="${esc(e.job || '')}" data-projects="${e.projects}"
      data-now="${vNow}" data-next="${vNext}" data-q="${vQ}"
      title="${esc(e.name)}${e.job ? ' · ' + esc(e.job) : ''} — الحِمل ${nowMonth ? vNow : e.utilization}% · ${countAr(e.projects, { one: 'مشروع واحد', two: 'مشروعان', few: 'مشاريع', many: 'مشروعاً' })}"
      aria-label="${esc(e.name)} — الحِمل ${nowMonth ? vNow : e.utilization}%">${esc(String(e.name || '؟').trim().charAt(0))}</button>`;
  }).join('');
  const capList = (rows, valFn) => rows.slice(0, 5).map((e) => `<div class="cap-li">
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name)}${e.job ? ` <span style="color:var(--faint);font-size:var(--fs-micro)">· ${esc(e.job)}</span>` : ''}</span>
      <b class="tnum" style="flex:none">${valFn(e)}%</b></div>`).join('')
    || '<div style="font-size:var(--fs-meta);color:var(--faint)">لا أحد ضمن هذه الفئة الآن</div>';
  const staffingHref = `/app/staffing?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}`;
  const capCard = card(`
    <div class="card-head">
      <span class="t">طاقة الفريق</span>
      <span class="aux">
        ${nowMonth && canPeople ? `<div class="seg" role="group" aria-label="نافذة الحِمل">${capWindows.map(([k, l], i) =>
    `<button type="button" class="${i === 0 ? 'on' : ''}" aria-pressed="${i === 0}" data-action="cap-win" data-w="${k}">${l}</button>`).join('')}</div>` : ''}
        <a class="btn btn-sm" href="${staffingHref}">لوحة التسكين</a></span></div>
    <div style="padding:.6rem 1rem 0;display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
      <div style="display:flex;flex-direction:column;align-items:center;gap:.15rem">
        ${ring(teamLoad, { size: 62, sw: 8, color: teamLoad > 110 ? 'var(--red)' : 'var(--brand)' })}
        <span style="font-size:9.5px;color:var(--muted);font-weight:700">متوسط ${G.utilization}</span>
      </div>
      <div class="cap-nums" style="flex:1;min-width:220px">
        <div><div class="l">إجمالي الفريق</div><div class="v tnum">${staff.headcount}</div></div>
        <div><div class="l">${nowMonth ? 'بلا تسكين الآن' : 'بلا تسكين في السنة'}</div><div class="v tnum" style="color:${freeNow.length ? 'var(--green)' : 'var(--ink2)'}">${freeNow.length}</div></div>
        <div><div class="l">ضمن الطاقة</div><div class="v tnum">${midNow.length}</div></div>
        <div><div class="l">${G.overloaded}</div><div class="v tnum" style="color:${overNow.length ? 'var(--red)' : 'var(--ink2)'}">${overNow.length}</div></div>
      </div>
    </div>
    <div style="padding:0 1rem">
      <div class="cap-axis" dir="ltr" data-staffing="${staffingHref}">
        <div class="cap-band" role="img" aria-label="طيف الحِمل: حتى 70% سعة متاحة، من 70 إلى 110 ضمن الطاقة، وفوق 110 تجاوز للطاقة"></div>
        ${capAv || `<div dir="rtl" style="position:absolute;inset-inline:0;top:18px;text-align:center;font-size:var(--fs-micro);color:var(--muted)">أسماء الأفراد وأحمالهم تظهر لمن يملك قراءة الموظفين</div>`}
      </div>
      <div class="cap-ticks" dir="ltr">
        <span style="left:0%">0%</span><span style="left:${capPos(70)}%">70%</span><span style="left:${capPos(110)}%">110%</span><span style="left:98%">+120%</span>
      </div>
      <div id="cap-caption" style="font-size:var(--fs-micro);color:var(--muted);padding:.15rem 0 .4rem">${nowMonth ? `النافذة: هذا الشهر (${monthLabel(nowMonth - 1)}) — والقادمة ضمن تسكين ${year} وحدها` : 'النافذة: متوسط السنة'} · الحدود من قواعد التسكين نفسها: 70% و110%</div>
    </div>
    ${canPeople ? `<div class="cap-lists" style="padding:.4rem 1rem .7rem">
      <div><div class="h">متاحون للعمل — الأقل حِملاً</div>${capList([...emps].filter((e) => loadOf(e) <= 70).sort((a, b) => loadOf(a) - loadOf(b)), loadOf)}</div>
      <div><div class="h">يحتاجون إعادة توزيع — تجاوزوا الطاقة</div>${capList([...overNow].sort((a, b) => loadOf(b) - loadOf(a)), loadOf)}</div>
    </div>` : ''}`);

  // ── (٨) صحة المشاريع — دونات واحد للحالة، وأبرز ما يحتاج نظر القائد بسببه ──
  const HEALTH = [['GREEN', G.hOnTrack, 'var(--green)'], ['AMBER', G.hAtRisk, 'var(--amber)'], ['RED', G.hCritical, 'var(--red)']];
  const healthSegs = HEALTH.map(([k, l, c]) => ({ k, l, color: c, v: sd.rag[k] || 0 }));
  const healthRows = HEALTH.map(([k, l, c]) => `<button type="button" class="hl-row" data-action="open-dd" data-dd="sec-health-${k}" ${!(sd.rag[k]) ? 'disabled style="opacity:.45;cursor:default"' : ''}>
      <span class="dot" style="background:${c}"></span><span>${l}</span>
      <b class="tnum">${sd.rag[k] || 0}</b>
      <span class="tnum" style="color:var(--faint);font-size:var(--fs-micro)">${ragActive ? Math.round(((sd.rag[k] || 0) / ragActive) * 100) : 0}%</span>
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
      ${sd.openRisks ? `<span class="pill" style="background:#fee2e2;color:#991b1b">${G.risks} ${sd.openRisks}</span>` : ''}
      <span class="aux"><a class="btn btn-sm" href="/app/projects?year=${year}${user.scope === 'company' ? '&sector=' + esc(sectorId) : ''}">عرض جميع المشاريع</a></span></div>
    ${ragActive ? `<div class="hl-wrap">
      <span class="ringw" style="width:104px;height:104px">${donutSVG(healthSegs)}<span style="position:absolute;text-align:center;line-height:1.3"><b class="tnum" style="font-size:1.15rem">${ragActive}</b><br><span style="font-size:9px;color:var(--muted)">مقيَّمة الصحة</span></span></span>
      <div class="hl-legend">${healthRows}</div>
    </div>
    ${needRows ? `<div style="padding:.2rem 1rem .6rem"><div style="font-size:var(--fs-micro);font-weight:800;color:var(--muted)">أبرز ما يحتاج تدخلاً</div>${needRows}</div>` : ''}`
    : `<div class="empty-state" style="padding:1.4rem 1rem">${icon('projects')}<div class="t">لا مشاريع قيد التنفيذ مقيَّمة الصحة</div><div class="s">تُقيَّم صحة المشروع (${G.hOnTrack} · ${G.hAtRisk} · ${G.hCritical}) من صفحته</div></div>`}`);

  // ── (٩) الأداء مقابل الخطة — شريطا إيقاع + سطرا تغطية وهامش، لا لوحة داخل لوحة ──
  const paceSection = card(`
    <div class="card-head"><span class="t">الأداء مقابل الخطة</span>
      <span class="aux" style="font-size:var(--fs-micro);color:var(--faint)" data-tip="مقياس الشريط هو المستهدف السنوي: 100% = الهدف. النقطة الذهبية = أين يجب أن نكون اليوم">كيف يُقرأ؟ ⓘ</span></div>
    <div style="padding:var(--pad-card-b);display:grid;gap:.55rem">
      ${paceCard({ label: `${G.revenue} ${year}`, actual: sd.revenue_halalas, target: sd.target_revenue_halalas, forecast: fc.forecast, weightedOpen: fc.weightedOpen, today: now, year, color: 'var(--green)', dd: 'secrev' })}
      ${paceCard({ label: `${G.sales} ${year}`, actual: sd.sales_halalas, target: sd.target_sales_halalas, today: now, year, color: 'var(--brand2)', dd: 'secwins' })}
      <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:var(--fs-meta);color:var(--muted);padding:.15rem .2rem;flex-wrap:wrap">
        <span>تغطية خط الفرص <b class="tnum" style="color:${(cover?.coverage ?? 1) < 1 ? 'var(--amber)' : 'var(--ink2)'}">${cover?.coverage != null ? '×' + cover.coverage : '—'}</b></span>
        ${canMargin && margin && margin.margin_pct != null ? `<span>هامش الربح الإجمالي <b class="tnum" style="color:${margin.margin_pct < 0 ? 'var(--red)' : 'var(--ink2)'}">${margin.margin_pct}%</b></span>` : ''}
      </div>
    </div>`);

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
  const trendCard = card(`
    <div class="card-head"><span class="t">${G.revenue} عبر السنة</span>
      <span class="aux" style="font-size:var(--fs-micro);color:var(--faint)">توزيع المحقق شهرياً — لا خطة شهرية مسجَّلة فلا تُرسم</span></div>
    <div style="padding:var(--pad-card-b);display:grid;gap:.55rem">
      ${monthlyBars}
      <div style="display:flex;gap:1rem;flex-wrap:wrap;font-size:var(--fs-meta);color:var(--muted);border-top:1px dashed var(--line);padding-top:.5rem">
        ${ytdGap != null ? `<span data-tip="المحقق حتى اليوم مقابل (الهدف × نسبة السنة المنقضية)">الفجوة حتى اليوم <b class="tnum" style="color:${ytdGap >= 0 ? 'var(--green)' : 'var(--red)'}">${ytdGap >= 0 ? '+' : '−'}${fmtSar(Math.abs(ytdGap))}</b> ⓘ</span>` : ''}
        <span data-tip="المعادلة: المحقق + المرجّح من الفرص المفتوحة">${G.forecast} <b class="tnum">${fmtSar(fc.forecast)}</b> ⓘ</span>
      </div>
      <div style="border-top:1px dashed var(--line);padding-top:.5rem">
        ${qBars}
        <div style="display:flex;gap:.8rem;font-size:10px;color:var(--muted);justify-content:center;margin-top:.3rem">
          <span><span style="display:inline-block;width:8px;height:8px;background:var(--green);border-radius:2px"></span> ${G.revenue}</span>
          <span><span style="display:inline-block;width:8px;height:8px;background:var(--brand2);border-radius:2px"></span> ${G.bookings}</span></div>
        ${qDelta != null ? `<div style="font-size:var(--fs-meta);color:var(--muted);margin-top:.4rem">إيراد الربع الحالي ${qDelta >= 0 ? 'أعلى' : 'أدنى'} من الربع السابق بنسبة <b class="tnum" style="color:${qDelta >= 0 ? 'var(--green)' : 'var(--red)'}">${Math.abs(qDelta)}%</b></div>` : ''}
      </div>
    </div>`);
  // ── (١١) أهم العملاء — خمسة، وبإشارة قرار واحدة لكل عميل لا سجلّ علاقات كامل ──
  // الترتيب يُبنى على **كل** عملاء القطاع: عدّ الفرص والمشاريع والقيمة المفتوحة لكل عميل بلا
  // سقف صفوف، ثم يُدمج مع إيراده — وإلا سقط صاحبُ أعلى إيرادٍ لأن قائمةً محدودةً بخط الفرص
  // قصّته قبل أن يراه الترتيب.
  const oppAgg = await all(`SELECT o.client_id cid, COUNT(*) n,
       COALESCE(SUM(CASE WHEN st.is_won = 0 AND st.is_lost = 0 THEN o.value_halalas ELSE 0 END),0) open_v
     FROM opportunity o JOIN stage st ON st.id = o.stage_id
     WHERE o.sector_id = ? AND o.deleted_at IS NULL AND o.client_id IS NOT NULL GROUP BY o.client_id`, [sectorId]);
  const prjAgg = await all(`SELECT client_id cid, COUNT(*) n FROM project
     WHERE sector_id = ? AND deleted_at IS NULL AND client_id IS NOT NULL GROUP BY client_id`, [sectorId]);
  const revByCid = Object.fromEntries(revByClient.map((r) => [r.cid, r.rev]));
  const stalledCids = new Set(stalledRows.map((o) => o.client_id).filter(Boolean));
  const redProjClients = new Set((await all(`SELECT DISTINCT client_id FROM project
     WHERE sector_id = ? AND deleted_at IS NULL AND status = 'IN_PROGRESS' AND rag = 'RED' AND client_id IS NOT NULL`, [sectorId])).map((r) => r.client_id));
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
  const clientRows = topClients.map((c) => `<a class="cl-row" href="/app/client/${esc(c.id)}">
      <div class="cl-top"><span class="nm">${esc(c.name_ar)}</span><b class="tnum" style="flex:none">${c.rev ? sarShort(c.rev) : '—'}</b></div>
      <div class="cl-meta">
        <span>إيراد ${year}${c.rev ? '' : ': لا إيراد منسوب'}</span>
        <span>الفرص <b class="tnum">${c.opps}</b> · المفتوح منها <b class="tnum">${sarShort(c.pipeline_halalas)}</b></span>
        <span>مشاريع <b class="tnum">${c.projects}</b></span>
        ${clientSignal(c)}
      </div>
    </a>`).join('') || `<div class="empty-state" style="padding:1rem"><div class="s">${G.emptyList}</div></div>`;
  const secRevTotal = sd.revenue_halalas || 0;
  // جملة التركّز لا تُقال إلا حين يوجد ثلاثة فعلاً — «أكبر ثلاثة» عن عميلين كذبة صغيرة.
  const top3 = topClients.filter((c) => c.rev > 0).slice(0, 3);
  const concPct = secRevTotal && top3.length === 3 ? Math.round((top3.reduce((a, c) => a + c.rev, 0) / secRevTotal) * 100) : null;
  const clientsCard = card(`
    <div class="card-head"><span class="t">أهم ${G.clients}</span>
      <span class="aux"><a class="btn btn-sm" href="/app/clients">عرض جميع العملاء</a></span></div>
    <div style="padding:.35rem 1rem .5rem">${clientRows}</div>
    ${concPct != null && concPct > 0 ? `<div style="padding:.45rem 1rem .6rem;border-top:1px dashed var(--line);font-size:var(--fs-meta);color:${concPct >= 60 ? '#92400e' : 'var(--muted)'}">
      أكبر ثلاثة عملاء يمثلون <b class="tnum">${concPct}%</b> من إيراد القطاع هذه السنة${concPct >= 60 ? ' — تركّز مرتفع، وتنويع القاعدة يقلل الأثر لو تعثّر أحدهم' : ''}</div>` : ''}`);

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
  const decisionsCard = card(`
    <div class="card-head">
      <span class="t">${G.decisions} والاعتمادات</span>
      <span class="aux"><a class="btn btn-sm" href="/app/approvals">${G.needsDecision}</a></span></div>
    <div style="padding:.5rem 1rem .6rem">
      <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted)">طلبات معلقة في القطاع</div>${apRows}
      <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted);margin-top:.5rem">آخر القرارات</div>${decRows}
    </div>`);

  // ── (١٤) شريط التقارير — أدوات ثانوية في القاع لا عناصر بطلة ──
  const reportsStrip = card(`<div style="padding:.55rem 1rem;display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
      <span style="font-size:var(--fs-micro);font-weight:800;color:var(--muted)">التقارير الدورية:</span>
      <button class="btn btn-sm" data-action="report-preview" data-report="sector_weekly_status">التقرير الأسبوعي</button>
      <button class="btn btn-sm" data-action="report-preview" data-report="monthly_sector_performance">التقرير الشهري</button>
      <button class="btn btn-sm" data-action="report-send" data-report="sector_weekly_status">أرسله لي الآن</button>
      <a class="btn btn-sm" href="/app/reports">جدولة دورية</a>
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
  const DD = `
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
  ${collectDD}`;

  const switcher = user.scope === 'company' ? `<div class="chips" style="margin-bottom:.6rem"><span class="lbl">القطاع:</span>
    ${allSectors.map((s) => `<a href="/app/sector?year=${year}&sector=${esc(s.id)}&win=${win}" class="chip ${s.id === sectorId ? 'on' : ''}"><span class="dot" style="background:${esc(s.color || '#244A99')}"></span>${esc(s.name_ar)}</a>`).join('')}
    <a class="btn btn-sm" style="margin-inline-start:.3rem" href="/app/ceo?year=${year}&sector=${esc(sectorId)}">لوحة القيادة</a>
  </div>` : '';

  const finCol = [collectCard, contractsCard].filter(Boolean).join('');
  const body = `${CSS}
    ${switcher}
    ${toolbar}
    ${insightStrip}
    ${kpiStrip}
    <div class="sec-grid">
      <div class="sec-col">${funnelCard}${paceSection}</div>
      <div class="sec-col">${attnCard}${changesCard}</div>
    </div>
    <div class="sec-grid even">
      <div class="sec-col">${capCard}</div>
      <div class="sec-col">${healthCard}${trendCard}</div>
    </div>
    <div class="sec-grid even">
      <div class="sec-col">${clientsCard}</div>
      <div class="sec-col">${finCol || decisionsCard}</div>
    </div>
    ${finCol ? `<div class="sec-grid even"><div class="sec-col">${decisionsCard}</div><div class="sec-col">${reportsStrip}</div></div>` : reportsStrip}
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
