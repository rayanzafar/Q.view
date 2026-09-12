// وحدة: لغة قوالب البريد الستة — لا مصطلح إنجليزي ولا قيمة مخزَّنة خام في أي رسالة تُرسل لمستلم.
// السبب: البريد التنفيذي كان يطبع «حالة RAG: RED» و«GREEN/AMBER» داخل شارات المشاريع، ويستعمل
// عتبة إشغال (65/50) تخالف عتبة صفحة الفريق (70/110) فتظهر نفس النسبة بلونين مختلفين.
// الفحص يستعمل نفس أداة المعجم (visibleText + bannedTermIn) حتى لا تفترق قواعد الاختبار عن قواعد الفاحص.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../../src/core/mail/templates.js';
import { HEALTH, CAPACITY, capacityColor } from '../../src/core/i18n/thresholds.js';
import { visibleText, bannedTermIn } from '../../scripts/check-glossary.mjs';

// حمولة واحدة تكفي القوالب الستة (كل قالب يقرأ ما يخصه فقط)
const DATA = {
  period: 'الأسبوع 30 · 2026',
  sectorName: 'قطاع الحلول الرقمية',
  totals: { revenue: 120000000, target_revenue: 200000000, sales: 90000000, target_sales: 150000000 },
  pipeline_halalas: 450000000, oppCount: 12,
  achievements: ['اعتماد المرحلة الأولى'], challenges: ['تأخر بيانات العميل'],
  decisions: ['اعتماد فريق التنفيذ'], risks: ['نقص كوادر تحليل البيانات'],
  topDeals: [{ client: 'وزارة النقل', title: 'حوكمة المشاريع', value_halalas: 75000000, win_pct: 100 }],
  topPipeline: [{ client: 'هيئة المدن', title: 'خارطة التحول', value_halalas: 50000000, win_pct: 40 }],
  projects: [
    { name_ar: 'مشروع الحوكمة', rag: 'GREEN', progress_pct: 62 },
    { name_ar: 'مشروع التشغيل', rag: 'AMBER', progress_pct: 41 },
    { name_ar: 'مشروع الترحيل', rag: 'RED', progress_pct: 12 },
    { name_ar: 'مشروع بلا حالة', rag: null, progress_pct: 0 },
  ],
  revenue_halalas: 120000000, target_revenue_halalas: 200000000,
  sales_halalas: 90000000, target_sales_halalas: 150000000,
  margin_pct: 24, target_margin_pct: 25, revenue_yoy: 12, book_to_bill: 1.2,
  rag: { GREEN: 4, AMBER: 2, RED: 1 },
  project: { name_ar: 'مشروع الحوكمة', rag: 'RED', progress_pct: 40, contract_value_halalas: 75000000 },
  kpis: { deliverableAcceptanceRate: 88, lateTasks: 3 },
  deliverables: ['تقرير المرحلة الثانية'],
  people: [
    { name_ar: 'أحمد', total: 40, billable: 29, utilization_pct: 72 },
    { name_ar: 'سارة', total: 40, billable: 27, utilization_pct: 68 },
    { name_ar: 'خالد', total: 40, billable: 48, utilization_pct: 120 },
  ],
  avgUtil: 74,
  pipeline: [{ stage: 'LEAD', name_ar: 'مهتم', count: 3, value_halalas: 30000000, color: '#244A99' }],
  topOpen: [{ client: 'هيئة المدن', title: 'خارطة التحول', value_halalas: 50000000, win_pct: 40 }],
  winRate: 45, coverage: 2.4, weighted_halalas: 180000000,
};

const KEYS = ['weekly_exec_brief', 'sector_weekly_status', 'monthly_sector_performance',
  'project_status_report', 'workforce_utilization', 'opportunity_pipeline'];

test('قوالب البريد الستة: لا مصطلح محظور ولا قيمة مخزَّنة خام في النص المعروض', () => {
  assert.equal(Object.keys(TEMPLATES).length, 6, 'عدد القوالب المتعاقد عليها ستة');
  for (const key of KEYS) {
    const { subject, html } = TEMPLATES[key](DATA);
    const shown = visibleText(html);
    assert.equal(bannedTermIn(shown), null, `${key}: مصطلح محظور في نص الرسالة`);
    assert.equal(bannedTermIn(subject), null, `${key}: مصطلح محظور في عنوان الرسالة`);
    for (const raw of ['RAG', 'RED', 'AMBER', 'GREEN']) {
      assert.ok(!shown.includes(raw), `${key}: قيمة الحالة «${raw}» ظهرت كما هي بدل معناها`);
    }
    assert.ok(/[؀-ۿ]/.test(subject), `${key}: عنوان الرسالة يجب أن يكون عربياً`);
  }
});

test('حالة المشروع تُكتب بالمعنى (على المسار/في خطر/حرج) واللون يبقى كما هو', () => {
  const { html } = TEMPLATES.sector_weekly_status(DATA);
  assert.ok(html.includes(HEALTH.GREEN.label) && html.includes('على المسار'));
  assert.ok(html.includes(HEALTH.AMBER.label) && html.includes('في خطر'));
  assert.ok(html.includes(HEALTH.RED.label) && html.includes('حرج'));
  assert.ok(html.includes(HEALTH.RED.bg), 'اللون الأحمر يبقى دلالة بصرية للحالة الحرجة');
  assert.ok(html.includes('غير محدَّدة'), 'مشروع بلا حالة مسجَّلة يُكتب «غير محدَّدة» لا فراغاً');
});

test('تقرير حالة المشروع: عنوان الشارة عربي بلون الحالة، بلا حروف لاتينية', () => {
  const { html } = TEMPLATES.project_status_report(DATA);
  assert.ok(html.includes(`حالة المشروع: ${HEALTH.RED.label}`));
  assert.ok(html.includes(HEALTH.RED.color));
  assert.ok(!/حالة RAG/.test(html));
});

test('الأداء الشهري: توزيع المحفظة بالمعنى لا بأرقام متجاورة بلا تسمية', () => {
  const { html } = TEMPLATES.monthly_sector_performance(DATA);
  for (const label of ['على المسار', 'في خطر', 'حرج']) assert.ok(html.includes(label));
  // لا ينهار إن وصلت الحالة كنص مفرد بدل خريطة أعداد (مسار احتياطي في محرك التقارير)
  const fallback = TEMPLATES.monthly_sector_performance({ ...DATA, rag: 'GREEN', projects: [] });
  assert.equal(bannedTermIn(visibleText(fallback.html)), null);
});

test('عتبات الإشغال في البريد = عتبات صفحة الفريق (110/70) من المصدر الواحد', () => {
  const { html } = TEMPLATES.workforce_utilization(DATA);
  // 72% ضمن الطاقة (أخضر) · 68% سعة متاحة (أصفر) · 120% تجاوز (أحمر)
  assert.equal(capacityColor(72), '#047857');
  assert.equal(capacityColor(68), '#a16207');
  assert.equal(capacityColor(120), '#dc2626');
  for (const pct of [72, 68, 120]) assert.ok(html.includes(`color:${capacityColor(pct)}`), `لون الإشغال ${pct}% من المصدر الواحد`);
  assert.ok(html.includes(`${CAPACITY.healthy}%`) && html.includes(`${CAPACITY.over}%`), 'العتبات مشروحة للقارئ');
  assert.ok(!/\d+h\b/.test(html), 'وحدة الساعات لا تُكتب بحرف لاتيني');
});

test('التهريب باقٍ: حالة ملوّثة أو اسم مشروع فيه وسم لا يمرّان إلى الرسالة', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const { html } = TEMPLATES.sector_weekly_status({
    sectorName: 'قطاع', period: 'يوليو 2026', risks: [],
    projects: [{ name_ar: payload, rag: payload, progress_pct: 10 }],
  });
  assert.ok(!html.includes(payload), 'لا وسم خام في الرسالة');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'الاسم يظهر مُهرَّباً');
  assert.ok(html.includes('غير محدَّدة'), 'حالة غير معروفة تسقط إلى التسمية الآمنة');
});
