// بديلُ حمولة مركز القطاع في الاختبار.
//
// وحدةُ الحمولة الحقيقية (`src/modules/finance/command-center.js`) تُبنى في وحدة عملٍ أخرى
// من الخطة نفسها، وملفُّ Excel يجب أن يُختبر قبلها لا بعدها: فهذه حمولةٌ مبنيّةٌ باليد بالشكل
// المتّفق عليه في الخطة (D6)، تُحقَن عبر `_loaders` في وحدة التصدير.
//
// وقاعدةُ الحجب هنا كقاعدتها هناك: **الحجب غيابٌ لا قيمةٌ فارغة** — `redacted()` تحذف
// الأقسام حذفاً ولا تضع فيها أصفاراً.

const m12 = (fn) => Array.from({ length: 12 }, (_, i) => fn(i));

/** حمولةٌ كاملة: صاحبُها يقرأ الإيراد والكلفة والهامش. */
export function fullDataset({ year = 2026, sectorId = 'S1', sectorName = 'قطاع الحلول' } = {}) {
  return {
    meta: {
      sector: { id: sectorId, name_ar: sectorName },
      year,
      today: `${year}-03-10`,
      closed_through: 2,
      closed_source: 'upload',
      generated_at: `${year}-03-10T08:00:00.000Z`,
      finance_upload: { at: `${year}-03-01T06:00:00.000Z`, by: 'مها العتيبي' },
      completeness_pct: 72,
    },
    lines: [
      { id: 'rev', name: 'الإيراد', kind: 'revenue', flag: null,
        plan: m12((i) => (i < 2 ? 500_000_00 : null)), fin: m12((i) => (i === 0 ? 111_100 : i === 1 ? 222_200 : null)),
        sanad: m12((i) => (i === 0 ? 111_100 : i === 1 ? 222_200 : null)) },
      { id: 'sal', name: 'رواتب التشغيل', kind: 'cost', flag: null,
        plan: m12(() => null), fin: m12((i) => (i === 0 ? 50_000 : null)), sanad: m12(() => null) },
      { id: 'con', name: 'أتعاب المستشارين', kind: 'cost', flag: null,
        plan: m12(() => null), fin: m12((i) => (i === 0 ? 0 : null)), sanad: m12(() => null) },
      { id: 'cor', name: 'تكلفة الإيراد', kind: 'subtotal', flag: null,
        plan: m12(() => null), fin: m12((i) => (i === 0 ? 50_000 : null)), sanad: m12(() => null) },
      { id: 'gp', name: 'مجمل الربح (الخسارة)', kind: 'result', flag: null,
        plan: m12(() => null), fin: m12((i) => (i === 0 ? 61_100 : null)), sanad: m12(() => null) },
    ],
    revenue: { by_project_month: { P1: m12((i) => (i === 0 ? 111_100 : 0)) } },
    projects: [
      { id: 'P1', name: 'مشروع ألف', client_id: 'C1', dept_id: 'D1', rag: 'GREEN',
        contract: 900_000, remaining: 500_000, unbilled: 120_000,
        act: { rev: m12((i) => (i === 0 ? 111_100 : null)), con: 10_000, ctr: 0, lic: null },
        margin_pct: 34, plan: null },
      { id: 'P2', name: 'مشروع باء', client_id: 'C2', dept_id: null, rag: 'AMBER',
        contract: 400_000, remaining: 100_000, unbilled: 0,
        act: { rev: m12((i) => (i === 1 ? 222_200 : null)), con: null, ctr: null, lic: null },
        margin_pct: null, plan: null },
    ],
    clients: [
      { id: 'C1', name: 'جهة ألف', revenue: 111_100, share_pct: 33, projects: 1 },
      { id: 'C2', name: 'جهة باء', revenue: 222_200, share_pct: 67, projects: 1 },
    ],
    depts: [{ id: 'D1', name: 'إدارة الدال' }],
    opps: [
      { id: 'O1', name: 'فرصة ألف', client_id: 'C1', stage_key: 'QUALIFIED', value: 1_000_000,
        prob: 40, close_m: 6, idle_days: 12, stalled: false },
      { id: 'O2', name: 'فرصة باء', client_id: 'C2', stage_key: 'NEGOTIATION', value: 2_500_000,
        prob: 70, close_m: 9, idle_days: 75, stalled: true },
    ],
    stages: [
      { key: 'QUALIFIED', name: 'مؤهلة' },
      { key: 'NEGOTIATION', name: 'تفاوض' },
    ],
    staffing: { head: 17, cap: m12(() => 17), alloc: m12((i) => 10 + i) },
    plan: { sector_target: 24_000_000_00, finance_plan_fy: 24_000_000_00, monthly_target: m12(() => 2_000_000_00) },
    outlook: { pace_halalas: 3_000_000, year_end_halalas: 12_000_000 },
    recon: [
      { month: 1, fin_cor: 50_000, sanad_cor: 49_000, diff: 1_000, pct: 2, match: false },
      { month: 2, fin_cor: 60_000, sanad_cor: 60_000, diff: 0, pct: 0, match: true },
    ],
    notes: [],
  };
}

/** الحمولةُ نفسها وقد أُغلق بابا الكلفة والهامش: الأقسام **محذوفة** لا مُصفَّرة. */
export function redactedDataset(opts) {
  const d = fullDataset(opts);
  d.lines = d.lines.filter((l) => l.kind === 'revenue');
  delete d.recon;
  for (const p of d.projects) {
    delete p.margin_pct;
    p.act = { rev: p.act.rev };
  }
  d.notes = ['costs_hidden'];
  return d;
}

/** مُحمِّلٌ بشكل `buildCommandCenterDataset(user, sectorId, { year })`. */
export const loaderOf = (dataset) => async (user, sectorId, { year } = {}) =>
  (typeof dataset === 'function' ? dataset({ year, sectorId }) : dataset);
