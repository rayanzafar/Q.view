// صفحة مركز القطاع في المتصفح: الحساب، والرابط، ولوحة التفاصيل — تُحمَّل هنا في سياقٍ مصطنع.
//
// لا مكتبة صفحةٍ في الاعتماديات (لا jsdom)، فنُركّب أصغر قشرةٍ تكفي الملفين للتحميل: وثيقةٌ لا
// تجد عنصراً، فتتوقّف دالة الإقلاع عند أول سطر وتترك الحساب والصياغة مكشوفين للاختبار. وكلُّ ما
// يُختبر هنا خالص: مجاميع الفترة، وحال الحجب، وترميز الرابط، ووسمُ كل فصلٍ في اللوحة الجانبية.
//
// ما يُحرس قبل كل شيء: ألّا يتسرّب إلى الشاشة أثرُ قيمةٍ غائبة أو حسابٍ غير عددي — لا في وسم
// فصلٍ من فصول اللوحة، ولا في نصٍّ ثابت داخل الملفين.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const PAGES = new URL('../../src/web/public/pages/', import.meta.url).pathname;
const readSrc = (f) => readFileSync(PAGES + f, 'utf8');
const SRC_FIG = readSrc('sector-figures.js');
const SRC_PAGE = readSrc('sector.js');
const SRC_DRAWER = readSrc('sector-drawer.js');

// ── قشرة الوثيقة: لا عنصر ولا حدث — يكفي أن يُحمَّل الملفان ────────────────
function shell() {
  const doc = {
    readyState: 'complete',
    documentElement: { clientWidth: 1440, classList: { add() {} } },
    body: { appendChild() {} },
    activeElement: null,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => ({ style: {}, dataset: {}, classList: { add() {} }, setAttribute() {}, addEventListener() {}, querySelector: () => null }),
    contains: () => false,
  };
  const win = { document: doc, history: { replaceState() {} }, location: { pathname: '/app/sector', search: '' }, addEventListener() {}, setTimeout, console: { info() {} } };
  win.window = win;
  const ctx = { window: win, setTimeout, console: win.console };
  runInNewContext(SRC_FIG, ctx);
  runInNewContext(SRC_PAGE, ctx);
  runInNewContext(SRC_DRAWER, ctx);
  return win.CC;
}

const H = (sar) => Math.round(sar * 100);              // ريالٌ إلى هللة
const arr = (vals) => vals.map((v) => (v == null ? null : H(v)));

function dataset(o = {}) {
  const base = {
    meta: {
      sector: { id: 's1', name_ar: 'قطاع الاستشارات' },
      year: 2026,
      today: { m: 9, d: 21, iso: '2026-09-21' },
      closed_through: 8,
      closed_source: 'derived',
      generated_at: '2026-09-21T07:49:00Z',
      finance_upload: { at: '2026-09-21T07:49:00Z', by: 'إدارة المالية' },
      completeness_pct: 64,
    },
    lines: [
      { id: 'rev', name: 'الإيراد', kind: 'revenue', flag: false,
        plan: arr([100, 100, 100, 100, 100, 100, 100, 100, 200, 200, 200, 200]),
        fin: arr([80, 90, 100, 70, 60, 90, 80, 90, null, null, null, null]),
        sanad: arr([80, 90, 100, 70, 60, 90, 80, 90, 30, null, null, null]) },
      { id: 'sal', name: 'رواتب التشغيل', kind: 'cost', flag: false,
        plan: arr([50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50]),
        fin: arr([40, 40, 40, 40, 40, 40, 40, 40, null, null, null, null]), sanad: null },
      { id: 'con', name: 'أتعاب المستشارين', kind: 'cost', flag: true,
        plan: arr([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
        fin: arr([0, 5, 0, 5, 0, 5, 0, 5, null, null, null, null]), sanad: null },
    ],
    revenue: {
      by_project_month: [
        { project_id: 'p1', m: arr([50, 60, 70, 40, 30, 60, 50, 60, 20, null, null, null]) },
        { project_id: 'p2', m: arr([30, 30, 30, 30, 30, 30, 30, 30, 10, null, null, null]) },
      ],
    },
    projects: [
      { id: 'p1', name: 'استراتيجية التحول', client_id: 'c1', dept_id: 'd1', rag: 'GREEN',
        contract: H(4000), remaining: H(1200), unbilled: H(600), start: '2025-06', end_m: 12,
        act: { rev: arr([50, 60, 70, 40, 30, 60, 50, 60, 20, null, null, null]),
          con: arr([0, 5, 0, 5, 0, 5, 0, 5, null, null, null, null]) }, margin_pct: 42 },
      { id: 'p2', name: 'حوكمة البيانات', client_id: 'c2', dept_id: 'd1', rag: 'RED',
        contract: H(2000), remaining: H(500), unbilled: null, start: '2025-10', end_m: 11,
        act: { rev: arr([30, 30, 30, 30, 30, 30, 30, 30, 10, null, null, null]) }, margin_pct: null },
    ],
    clients: [{ id: 'c1', name: 'الهيئة', prospect: false }, { id: 'c2', name: 'الوزارة', prospect: false },
      { id: 'c3', name: 'المؤسسة', prospect: true }],
    depts: [{ id: 'd1', name: 'الاستشارات الإدارية' }],
    opps: [
      { id: 'o1', name: 'فرصة أولى', client_id: 'c1', stage_key: 'q', value: H(1200), prob: 0.05, close_m: 11, idle_days: 90, stalled: true },
      { id: 'o2', name: 'فرصة ثانية', client_id: 'c3', stage_key: 'n', value: H(800), prob: 0.5, close_m: 13, idle_days: 4, stalled: false },
    ],
    stages: [{ key: 'q', name: 'تأهيل', color: '#9fb0d6', prob: 0.05, sort: 1 },
      { key: 'n', name: 'تفاوض', color: '#2f9e8f', prob: 0.5, sort: 2 }],
    staffing: { head: 37, idle: 6, cap: Array(12).fill(37), alloc: Array(12).fill(29.5), alloc_now: 29.5 },
    plan: { sector_target: H(24000), finance_plan_fy: H(37954), sales_target: H(35000),
      monthly_target: arr([2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000]) },
    outlook: { forecast: H(16300), low: H(11700), high: H(35700), pace: H(1500), coverage: 0.4 },
    recon: {
      months: [{ m: 1, fin_cor: H(50), sanad_cor: H(48), diff: H(2), pct: 0.04, match: false }],
      totals: { fin_cor: H(50), sanad_cor: H(48), diff: H(2), pct: 0.04, match: false },
      // بشكل الخدمة نفسه (`pl-lines.js`): مفتاحُ البند `key` واسمُه `ar`.
      by_line: [{ key: 'con', ar: 'أتعاب المستشارين', comparable: true, fin: H(20), sanad: H(18), diff: H(2) }],
    },
    attention: [{ rank: 1, tone: 'red', title: 'مستحقات متأخرة', sub: 'الهيئة', href: '/app/sector', action: 'تابع التحصيل' }],
    changes: { items: [{ kind: 'stage', at: '2026-09-18T10:00:00Z', title: 'فوز بفرصة', sub: 'الهيئة', href: '/app/opportunities' }], counts: { stage: 1 } },
    team: [{ id: 'e1', name_ar: 'سارة', job_title: 'مستشار', planNow: 80, tasks: { open: 3, late: 0, blocked: 0 } }],
    notes: [],
  };
  return Object.assign(base, o);
}

// نسخةٌ محجوبة: لا بنود تكلفة، ولا مطابقة، ولا هامش، ولا خطة، ولا توقّع
function redacted() {
  const d = dataset();
  d.lines = d.lines.filter((l) => l.kind !== 'cost');
  d.projects = d.projects.map((p) => ({ ...p, margin_pct: undefined, act: { rev: p.act.rev } }));
  delete d.recon;
  delete d.plan;
  delete d.outlook;
  d.notes = ['costs_hidden', 'no_project_plan', 'no_monthly_plan'];
  return d;
}

const LEAK = /\bundefined\b|\bNaN\b|\[object |\bnull\b/;
// حسابٌ غير عددي لا يظهر في وسمٍ ولا في بنيةٍ تُقرأ منها الشاشة
function noNaN(v, seen = new Set()) {
  if (typeof v === 'number') return v === v;
  if (!v || typeof v !== 'object' || seen.has(v)) return true;
  seen.add(v);
  if (v instanceof Set) return [...v].every((x) => noNaN(x, seen));
  return Object.keys(v).every((k) => noNaN(v[k], seen));
}
const boot = (d, view) => { const CC = shell(); CC.init(d, view || {}, {}); return CC; };
// وإقلاعٌ بالأسماء كما يزرعها الخادم في `cc-labels` — لما يُختبر منها بعينه.
const bootL = (d, view, labels) => { const CC = shell(); CC.init(d, view || {}, labels || {}); return CC; };
const LABELS = {
  healthUnknown: 'غير محدَّدة',
  closedSource: { derived: 'من آخر شهر مرفوع', override: 'حدّده مدير النظام' },
  plReconLegend: 'يُعدّ الشهر مطابقاً إذا كان الفرق أقل من 0.5% من رقم المالية أو أقل من 5000 ريال',
  ragOwnerNote: 'كما يحدّدها مدير المشروع في صفحة المشروع، ولا تُحتسب من الأرقام هنا',
};

test('قائمة الدخل: المجاميع على الأشهر المغلقة وحدها، والخطة على كل المختار', () => {
  const CC = boot(dataset(), { months: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
  const P = CC.calc.pl();
  assert.equal(P.comp.join(','), '1,2,3,4,5,6,7,8');
  assert.equal(P.open.join(','), '9');
  assert.equal(P.L.rev.act, 660);                    // مجموع الفعلي حتى أغسطس بالريال
  // الإيراد يُقاس على ما اختير (سبتمبر داخلٌ فيه ولم تُسجَّل فيه المالية بعد)، فخطتُه على
  // الأشهر التسعة نفسها — لا تُقارَن خطةُ ثمانيةٍ بفعليِّ تسعة.
  assert.equal(P.L.rev.plan, 1000);
  assert.equal(P.L.rev.planSel, 1000);               // وخطة كل ما اختير (ومنه سبتمبر)
  assert.equal(P.L.rev.planOpen, 200);
  assert.equal(P.L.sal.plan, 400);                   // وخطةُ الكلفة تبقى على الأشهر المغلقة وحدها
  assert.equal(P.L.cor.act, 320 + 20);               // الرواتب والأتعاب
  assert.equal(P.L.gp.act, 660 - 340);
  assert.ok(P.hasCost);
  assert.equal(Math.round(P.margin.act * 1000) / 1000, Math.round((320 / 660) * 1000) / 1000);
});

test('من بداية السنة والسنة كاملة: الفعلي واحد، والخطة تختلف', () => {
  const CC = boot(dataset());
  CC.S.months = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const ytd = CC.calc.pl();
  CC.S.months = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const year = CC.calc.pl();
  assert.equal(ytd.L.rev.act, year.L.rev.act, 'لا فعلي بعد آخر شهر مغلق');
  assert.ok(year.L.rev.planSel > ytd.L.rev.planSel);
});

test('الغياب يبقى غياباً: أشهرٌ لم تُغلق تعطي بلا قيمة لا صفراً', () => {
  const CC = boot(dataset(), { months: [10, 11, 12] });
  const P = CC.calc.pl();
  assert.equal(P.comp.join(','), '');
  assert.equal(P.L.rev.act, null);
  assert.equal(P.L.gp.act, null);
  assert.equal(P.margin.act, null);
  assert.notEqual(P.L.rev.act, 0);
});

test('الحجب بالغياب: بلا بنود تكلفة لا تُخترع تكلفةٌ ولا هامش', () => {
  const CC = boot(redacted(), { months: [1, 2, 3, 4, 5, 6, 7, 8] });
  const P = CC.calc.pl();
  assert.equal(P.hasCost, false);
  assert.equal(P.L.cor, undefined);
  assert.equal(P.L.gp, undefined);
  assert.equal(P.margin.act, null);
  assert.equal(P.margin.plan, null);
  const o = CC.calc.outlook();
  assert.equal(o.target, null);
  assert.equal(o.forecast, null);
  assert.equal(o.coverage, null);
  assert.equal(noNaN(P), true, 'لا حساب غير عددي في المخرجات');
});

test('الهامش نسبةٌ مئوية في الحمولة وكسرٌ في الحساب — يُضرب في مئةٍ مرةً واحدة', () => {
  // الشاشة الحية طبعت «الهامش 1800%»: الحمولة تُخرج ١٨ نسبةً مئوية والصفحة ضربتها في مئةٍ ثانيةً.
  const CC = boot(dataset(), { months: [1, 2, 3, 4, 5, 6, 7, 8] });
  const s1 = CC.calc.prjStats(CC.calc.projects()[0], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(Math.round(s1.margin * 1000) / 1000, 0.42, 'الهامش يدخل الحساب كسراً');
  assert.equal(CC.fmt.plain.pct(s1.margin), '42%');
  const card = CC.sections.projects(9);
  assert.ok(card.includes('42%'), 'الهامش لا يُطبع كما هو في بطاقة المشاريع');
  assert.ok(!/\b\d{3,}%/.test(card), 'نسبةٌ من ثلاث خاناتٍ فأكثر — ضُربت في مئةٍ مرتين');
  // ومشروعٌ بلا هامشٍ مسجَّل يُحتسب هامشه من أرقام الفترة، لا يُخترع
  const s2 = CC.calc.prjStats(CC.calc.projects()[1], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(s2.margin, null, 'بلا هامشٍ مسجَّلٍ ولا تكلفةٍ مباشرة يبقى الهامش بلا قيمة — لا صفراً ولا مئة بالمئة');
});

test('مشروعٌ بلا تقييمٍ مسجَّل يُسمّى «غير محدَّدة» — بالاسم الواحد في المنصة لا بصياغةٍ ثانية', () => {
  const d = dataset();
  d.projects[1].rag = null;
  const CC = bootL(d, { months: [1, 2, 3, 4, 5, 6, 7, 8] }, LABELS);
  assert.equal(CC.rag.name(null), 'غير محدَّدة', 'اسم الحالة الغائبة يصل في الأسماء من عتبات الحالة');
  const card = CC.sections.projects(9);
  assert.ok(card.includes('غير محدَّدة'), 'التقييم الغائب خرج فراغاً في بطاقة المشاريع');
  assert.ok(CC.DETAIL.prj('p2').html.includes('غير محدَّدة'), 'ولا في لوحة المشروع');
  assert.ok(!card.includes('غير مُقيَّم'), 'الصياغة القديمة ما زالت مكتوبةً في الصفحة');
});

test('الوقت مقابل الإيراد بلا مستهدف: الجملة تنتهي بالرقم بلا نقطةٍ شاردة', () => {
  // الشاشة الحية طبعت «الإيراد حتى اليوم 1.4M.» — النقطة تقع يسار الرقم المعزول فتُقرأ ذرّةً.
  const d = dataset();
  delete d.plan;
  delete d.outlook;
  const CC = boot(d, { months: [1, 2, 3, 4, 5, 6, 7, 8] });
  const hero = CC.sections.hero();
  const lead = (hero.match(/<p class="h-lead">([\s\S]*?)<\/p>/) || [])[1] || '';
  assert.ok(lead.includes('الإيراد حتى اليوم'), 'الجملة البديلة لم تُرسم');
  assert.ok(!/<\/b>\s*\./.test(lead), 'نقطةٌ بعد رقمٍ معزول الاتجاه تُقرأ ذرّةً شاردة');
  assert.ok(lead.trim().endsWith('</b>'), 'الجملة تنتهي بالرقم نفسه');
});

test('الحركة تصل من الخدمة {items, counts} — والشاشة تقرأ السطور لا الغلاف', () => {
  const CC = boot(dataset(), { months: [1, 2, 3, 4, 5, 6, 7, 8] });
  assert.equal(CC.D.changes.length, 1, 'سطور الحركة ضاعت بين شكل الخدمة وقراءة الشاشة');
  const r = CC.DETAIL.changes();
  assert.ok(r.html.includes('فوز بفرصة'), 'فصل «ما الذي تغيّر؟» لا يعرض ما سجّلته الخدمة');
  assert.ok(!r.html.includes('لم يُسجَّل تغيّرٌ'), 'الحركة الحاضرة قُرئت غياباً');
  // وقائمةٌ مجرّدة (حمولةٌ قديمة في متصفّح) تبقى مقروءة
  const CC2 = boot(Object.assign(dataset(), { changes: [{ title: 'تغيّر قديم', at: '2026-01-01T00:00:00Z' }] }), {});
  assert.ok(CC2.DETAIL.changes().html.includes('تغيّر قديم'));
});

test('السنة في الصفحة لا تمرّ بمُنسِّق الأعداد — لا «2,026»', () => {
  const CC = boot(dataset(), {});
  assert.equal(CC.yr(2026), '<bdi dir="ltr" class="tnum">2026</bdi>');
  assert.ok(!/CC\.num\(\s*YEAR\s*\)/.test(SRC_PAGE), 'السنة مُمرَّرة إلى مُنسِّق الأعداد في sector.js');
});

test('النطاق: المشروع يقصر الأرقام عليه، والتتالي يُسقط ما لم يعد ظاهراً', () => {
  const CC = boot(dataset(), { months: [1, 2, 3, 4, 5, 6, 7, 8] });
  CC.S.projects = new Set(['p1']);
  assert.equal(CC.calc.projects().length, 1);
  const P = CC.calc.pl();
  assert.equal(P.scope, 'projects');
  assert.equal(P.L.rev.act, 420);
  CC.S.clients = new Set(['c2']);                      // العميل يغيّر ما يظهر
  CC.calc.prune();
  assert.equal(CC.S.projects.size, 0, 'المشروع خارج العميل المختار يُسقط');
  assert.equal(CC.calc.projects()[0].id, 'p2');
});

test('الفترات الجاهزة: السنة، ومن بداية السنة، وحتى آخر شهر مغلق', () => {
  const CC = boot(dataset());
  assert.equal(CC.presetMonths('year').join(','), '1,2,3,4,5,6,7,8,9,10,11,12');
  assert.equal(CC.presetMonths('ytd').join(','), '1,2,3,4,5,6,7,8,9');
  assert.equal(CC.presetMonths('closed').join(','), '1,2,3,4,5,6,7,8');
  assert.equal(CC.presetMonths('q3').join(','), '7,8,9');
});

test('الرابط: مفاتيح النسخة الحية نفسها، والاختيار المتعدد قائمةٌ بفواصل', () => {
  const CC = boot(dataset());
  const q = () => Object.fromEntries(CC.url.query().split('&').map((x) => x.split('=').map(decodeURIComponent)));
  CC.S.months = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(q().p, 'y');
  assert.equal(q().year, '2026');
  assert.equal(q().sector, 's1');
  CC.S.months = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(q().p, 'ytd');
  CC.S.months = new Set([1, 2, 3]);
  assert.equal(q().p, 'q1');
  CC.S.months = new Set([4, 5, 6, 7, 8, 9]);
  assert.equal(q().p, 'q2-q3');
  CC.S.months = new Set([3]);
  assert.equal(q().p, 'm3');
  CC.S.months = new Set([3, 4, 5, 6, 7, 8]);
  assert.equal(q().p, 'm3-m8');
  CC.S.months = new Set([1, 3, 5]);
  assert.equal(q().p, undefined);
  assert.equal(q().months, '1,3,5', 'الاختيار المتقطّع لا يُكذب عليه باختصارٍ لا يمثّله');
  CC.S.months = new Set([1, 2, 3]);
  CC.S.projects = new Set(['p1', 'p2']);
  CC.S.clients = new Set(['c1']);
  CC.S.depts = new Set(['d1']);
  assert.equal(q().project, 'p1,p2');
  assert.equal(q().client, 'c1');
  assert.equal(q().dept, 'd1');
  assert.ok(CC.url.xlsxPl().startsWith('/api/sectors/s1/income-statement.xlsx?'));
  assert.ok(CC.url.xlsxAll().indexOf('command-center.xlsx?') > 0);
  assert.ok(CC.url.printPl().startsWith('/app/sector/income-statement?'));
  assert.ok(CC.url.xlsxPl().indexOf('project=p1%2Cp2') > 0, 'أزرار التنزيل تحمل الفلتر الحالي');
});

test('لوحة المفاتيح على شريط الأشهر: تنقّلٌ بحسّ العربية، ومدٌّ من المرساة', () => {
  const CC = boot(dataset());
  assert.equal(CC.keys.move(0, 'ArrowLeft', 12), 1, 'اليسار يتقدّم في الأشهر');
  assert.equal(CC.keys.move(5, 'ArrowRight', 12), 4);
  assert.equal(CC.keys.move(0, 'ArrowRight', 12), 0, 'لا يخرج عن الطرف');
  assert.equal(CC.keys.move(11, 'ArrowLeft', 12), 11);
  assert.equal(CC.keys.move(4, 'Home', 12), 0);
  assert.equal(CC.keys.move(4, 'End', 12), 11);
  const sorted = (set) => [...set].sort((a, b) => a - b).join(',');
  assert.equal(sorted(CC.keys.extend(new Set([3]), 3, 6)), '3,4,5,6');
  assert.equal(sorted(CC.keys.extend(new Set([6]), 6, 3)), '3,4,5,6', 'المدّ يعمل في الاتجاهين');
  assert.equal(sorted(CC.keys.extend(new Set([1, 9]), 3, 4)), '1,3,4,9', 'المدّ لا يمسح ما قبله');
  assert.equal(sorted(CC.keys.toggle(new Set([1, 2]), 2)), '1');
});

test('كل فصلٍ في اللوحة الجانبية يُرسم بلا أثرٍ لقيمةٍ غائبة', () => {
  const CC = boot(dataset(), { months: [1, 2, 3, 4, 5, 6, 7, 8] });
  const keys = [['prj', 'p1'], ['prj', 'p2'], ['cli', 'c1'], ['cli', 'c3'], ['line', 'rev'], ['line', 'gp'],
    ['line', 'con'], ['team'], ['pipe'], ['opp', 'o1'], ['opps', 'all'], ['opps', 'stalled'], ['opps', 'q'],
    ['projects', 'all'], ['projects', 'RED'], ['alerts'], ['pl'], ['billing'], ['clients'], ['data'], ['pace'],
    ['changes']];
  for (const [k, id] of keys) {
    const r = CC.DETAIL[k](id);
    const blob = [r.kind, r.title, r.sub, r.html].join(' ');
    assert.ok(r.title, `عنوان مفقود في ${k}`);
    assert.ok(!LEAK.test(blob), `تسرّبت قيمةٌ غائبة في فصل ${k}: ${(blob.match(LEAK) || [])[0]}`);
    assert.ok(blob.indexOf('[object') < 0, `وسمٌ غير مقروء في فصل ${k}`);
  }
});

test('اللوحة الجانبية تحتمل الحجب: بلا تكلفة ولا مطابقة ولا خطة تقول «لم يُسجَّل»', () => {
  const CC = boot(redacted(), { months: [1, 2, 3, 4, 5, 6, 7, 8] });
  for (const [k, id] of [['pl'], ['data'], ['pace'], ['line', 'rev'], ['prj', 'p1'], ['projects', 'all'],
    ['billing'], ['clients'], ['team'], ['alerts']]) {
    const r = CC.DETAIL[k](id);
    const blob = [r.kind, r.title, r.sub, r.html].join(' ');
    assert.ok(!LEAK.test(blob), `تسرّبت قيمةٌ غائبة في فصل ${k} المحجوب`);
  }
  assert.ok(CC.DETAIL.pl().html.includes('لا تظهر لك'), 'الحجب يُقال صراحة');
  assert.ok(CC.DETAIL.data().html.includes('لم تُسجَّل مطابقة') || CC.DETAIL.data().html.includes('لم تُسجَّل'),
    'غياب المطابقة يُقال لا يُطوى');
});

test('اللوحة الجانبية تحتمل بياناتٍ شبه خالية بلا أن تسقط', () => {
  const CC = boot({ meta: { sector: { id: 's9', name_ar: 'قطاع' }, year: 2026, today: { m: 3, d: 1 }, closed_through: 0 } }, {});
  for (const k of ['pl', 'data', 'pace', 'projects', 'clients', 'billing', 'pipe', 'team', 'alerts', 'changes']) {
    const r = CC.DETAIL[k]();
    assert.ok(r && r.title, `فصل ${k} بلا عنوان`);
    assert.ok(!LEAK.test([r.kind, r.title, r.sub, r.html].join(' ')), `تسرّب في فصل ${k} الفارغ`);
  }
});

test('لا نصَّ ثابتاً في الملفين يحمل أثر قيمةٍ غائبة', () => {
  for (const [name, src] of [['sector.js', SRC_PAGE], ['sector-drawer.js', SRC_DRAWER]]) {
    const strings = src.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || [];
    for (const s of strings) {
      assert.ok(!/undefined|NaN|\[object/.test(s), `${name}: نصٌّ ثابت يحمل أثر قيمةٍ غائبة: ${s}`);
    }
  }
});

test('فصول الصفحة تُركَّب كلها — بالبيانات الكاملة وبالمحجوبة وبالخالية', () => {
  const cases = [['الكاملة', dataset()], ['المحجوبة', redacted()],
    ['الخالية', { meta: { sector: { id: 's9', name_ar: 'قطاع' }, year: 2026, today: { m: 3, d: 1 }, closed_through: 0 } }]];
  for (const [label, d] of cases) {
    const CC = boot(d, { months: [1, 2, 3, 4, 5, 6, 7, 8] });
    for (const k of Object.keys(CC.sections)) {
      const html = CC.sections[k](5);
      assert.equal(typeof html, 'string', `فصل ${k} لا يعيد وسماً`);
      assert.ok(!LEAK.test(html), `تسرّبت قيمةٌ غائبة في فصل ${k} (${label}): ${(html.match(LEAK) || [])[0]}`);
    }
  }
});

// ── عدسةُ الإقفال: على الكلفة وحدها ─────────────────────────────────────────
test('بلا شهرٍ مغلق: الإيراد ومشاريعه وعملاؤه أرقامٌ حاضرة، والكلفة وحدها «لم يُسجَّل»', () => {
  // الشاشة الحية كانت تُفرِّغ البطاقة كلَّها حتى تُقفل المالية شهراً: إيرادٌ مسجَّلٌ في سند
  // يُقرأ «بلا قيمة». والإيراد لا ينتظر الإقفال — الكلفة وحدها هي التي تنتظره.
  const d = dataset();
  d.meta.closed_through = null;
  const CC = boot(d, { months: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
  const P = CC.calc.pl();
  assert.equal(P.comp.length, 0, 'لا شهر مغلق في الفترة');
  assert.equal(P.revM.join(','), '1,2,3,4,5,6,7,8,9', 'أشهر الإيراد هي المختار حتى الشهر الجاري');
  assert.equal(P.L.rev.act, 660, 'الإيراد المسجَّل في سند حُجب لأن المالية لم تُقفل شهراً');
  for (const k of ['sal', 'con', 'cor', 'gp']) {
    assert.equal(P.L[k].act, null, `${k}: كلفةُ شهرٍ لم يُقفل يجب أن تبقى غياباً`);
  }
  assert.equal(P.margin.act, null, 'هامشٌ بلا كلفةٍ مغلقة لا يُحتسب');
  // ومشاريع الفترة وعملاؤها: إيرادُهم حاضرٌ كما سجّله سند
  const s = CC.calc.prjStats(CC.calc.projects()[0]);
  assert.equal(s.rev, 440, 'إيراد المشروع في الأشهر التسعة');
  assert.equal(s.dc, null, 'وتكلفتُه المباشرة تنتظر الإقفال');
  assert.equal(CC.calc.clientRel('c1').rev, 440, 'إيراد العميل حُجب مع الكلفة');
  // وبطاقة المال تقول الإيراد ولا تطلب اختيار شهرٍ مغلق
  const money = CC.sections.money();
  assert.ok(money.includes(CC.m(660)), 'بطاقة المال لا تعرض إيراد الفترة');
  assert.ok(!money.includes('اختر شهراً حتى'), 'البطاقة ما زالت تُفرَّغ بانتظار الإقفال');
  assert.ok(money.includes('لم يُسجَّل شهرٌ مغلق'), 'سبب غياب الكلفة لا يُقال');
  assert.ok(!LEAK.test(money) && !LEAK.test(CC.sections.band()), 'تسرّبت قيمةٌ غائبة');
});

test('مطابقةُ البنود تصل بشكل الخدمة: البند باسمه لا بخانةٍ فارغة', () => {
  const CC = boot(dataset(), { months: [1, 2, 3, 4, 5, 6, 7, 8] });
  assert.equal(CC.D.recon.by_line[0].line, 'con', 'مفتاح البند لم يُقرأ من `key`');
  assert.equal(CC.D.recon.by_line[0].name, 'أتعاب المستشارين', 'اسم البند لم يُقرأ من `ar`');
  assert.ok(CC.DETAIL.data().html.includes('أتعاب المستشارين'), 'جدول «حسب البند» خرج بلا أسماء');
});

test('«من بداية السنة» في سنةٍ منقضية هي السنة كاملة، والرابط يقولها «السنة»', () => {
  const d = dataset();
  d.meta.year = 2025;                       // واليوم في 2026 حسب `today.iso`
  const CC = boot(d, {});
  assert.equal(CC.presetMonths('ytd').join(','), '1,2,3,4,5,6,7,8,9,10,11,12',
    'شهرُ اليوم قصَّ سنةً منقضية على تسعة أشهر');
  CC.S.months = new Set(CC.presetMonths('ytd'));
  const q = Object.fromEntries(CC.url.query().split('&').map((x) => x.split('=').map(decodeURIComponent)));
  assert.equal(q.p, 'y', 'السنة كاملةً كُتبت في الرابط «من بداية السنة»');
  // والسنة الجارية تبقى على شهرها
  assert.equal(boot(dataset(), {}).presetMonths('ytd').join(','), '1,2,3,4,5,6,7,8,9');
});

test('مصدرُ الإقفال وقاعدةُ المطابقة وقاعدةُ الحالة: نصٌّ واحدٌ يصل في الأسماء', () => {
  const CC = bootL(dataset(), { months: [1, 2, 3, 4, 5, 6, 7, 8] }, LABELS);
  const data = CC.DETAIL.data().html;
  assert.ok(data.includes('من آخر شهر مرفوع'), 'مصدر الإقفال لم يُترجم إلى العربية');
  assert.ok(!data.includes('derived'), 'مفتاحٌ داخليّ ظهر في وجه القارئ');
  assert.ok(data.includes(LABELS.plReconLegend), 'قاعدة «مطابق سند» لا تُقرأ من مصدر العتبات');
  assert.ok(!/نصفاً بالمئة|خمسة آلاف ريال/.test(SRC_DRAWER), 'قاعدة المطابقة ما زالت مكتوبةً باليد');
  // وقاعدةُ الحالة جملةٌ واحدة في اللوحتين
  for (const r of [CC.DETAIL.prj('p1'), CC.DETAIL.projects('all')]) {
    assert.ok(r.html.includes(LABELS.ragOwnerNote), 'قاعدة الحالة ليست الجملة الواحدة');
  }
  assert.ok(!/لا تُحتسب هنا/.test(SRC_DRAWER), 'الصياغة الثانية لقاعدة الحالة ما زالت في الملف');
});

test('بطاقاتُ الشاشة عناوينُها <h2> تحت عنوان الصفحة — لا قفزةَ في سلَّم العناوين', () => {
  const CC = boot(dataset(), { months: [1, 2, 3, 4, 5, 6, 7, 8] });
  for (const k of ['projects', 'opps', 'clients', 'money', 'team']) {
    const html = CC.sections[k](5);
    assert.ok(/<h2>/.test(html), `بطاقة ${k} بلا عنوان من الدرجة الثانية`);
    assert.ok(!/<h3>/.test(html), `بطاقة ${k} ما زالت تبدأ بالدرجة الثالثة`);
  }
});

test('زرُّ لوحة الإيقاع زرٌّ حقيقي داخل البطاقة — لا قسمٌ يتظاهر بأنه زر', () => {
  const CC = boot(dataset(), { months: [1, 2, 3, 4, 5, 6, 7, 8] });
  const hero = CC.sections.hero();
  assert.ok(hero.includes('class="hero-hit"'), 'زرّ فتح اللوحة غائب عن البطاقة');
  assert.ok(/<button type="button" class="hero-hit"[^>]*data-go=/.test(hero), 'الزرّ لا يحمل وجهته');
  const d = dataset();
  delete d.plan;
  delete d.outlook;
  assert.ok(boot(d, {}).sections.hero().includes('class="hero-hit"'), 'الزرّ غائب في حالة «بلا مستهدف»');
});
