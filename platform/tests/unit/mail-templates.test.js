// XSS مخزَّن كان حقيقياً: core/mail/templates.js كان الملف الوحيد بالمنصة الذي يحقن بيانات العمل
// (اسم عميل/فرصة/مشروع/قطاع/عضو) في HTML بلا أي تهريب. بما أن أي مستخدم يقدر ينشئ فرصة بعنوان/قيمة
// يختارها، وأن التقارير تصل لأي مستخدم مسجَّل دخول (انظر إصلاح companyOverview)، كان أي دور منخفض
// الصلاحية (bd_manager مثلاً) يقدر يزرع payload ينفّذ في متصفح من يفتح التقرير — وقد يكون تنفيذياً.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyExecBrief, sectorWeeklyStatus, projectStatusReport, opportunityPipeline } from '../../src/core/mail/templates.js';

const PAYLOAD = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;';

test('weeklyExecBrief: اسم عميل/عنوان فرصة مُهرَّبان في جدول أبرز الفرص المفتوحة', () => {
  const { html } = weeklyExecBrief({
    period: 'يوليو 2026',
    totals: { revenue: 0, target_revenue: 0, sales: 0, target_sales: 0 },
    pipeline_halalas: 0, oppCount: 0,
    achievements: [PAYLOAD], challenges: [], decisions: [], risks: [],
    topDeals: [], topPipeline: [{ client: PAYLOAD, title: PAYLOAD, value_halalas: 100, win_pct: 50 }],
  });
  assert.ok(!html.includes(PAYLOAD), 'يجب ألا يظهر وسم HTML خام في الناتج');
  assert.ok(html.includes(ESCAPED), 'يجب أن يظهر مُهرَّباً بدلاً منه');
});

test('sectorWeeklyStatus: اسم القطاع واسم المشروع مُهرَّبان', () => {
  const { html } = sectorWeeklyStatus({
    sectorName: PAYLOAD, period: 'يوليو 2026',
    projects: [{ name_ar: PAYLOAD, rag: 'GREEN', progress_pct: 50 }], risks: [],
  });
  assert.ok(!html.includes(PAYLOAD));
  assert.ok(html.includes(ESCAPED));
});

test('projectStatusReport: اسم المشروع مُهرَّب في العنوان والمخرجات/المخاطر', () => {
  const { html } = projectStatusReport({
    period: 'يوليو 2026',
    project: { name_ar: PAYLOAD, rag: 'GREEN', progress_pct: 50, contract_value_halalas: 100 },
    kpis: { deliverableAcceptanceRate: 90, lateTasks: 0 },
    deliverables: [PAYLOAD], risks: [PAYLOAD],
  });
  assert.ok(!html.includes(PAYLOAD));
  assert.ok(html.includes(ESCAPED));
});

test('opportunityPipeline: اسم القطاع/العميل/عنوان الفرصة مُهرَّبة جميعاً', () => {
  const { html } = opportunityPipeline({
    sectorName: PAYLOAD, period: 'يوليو 2026', winRate: 50, coverage: 2, weighted_halalas: 0,
    pipeline: [], topOpen: [{ client: PAYLOAD, title: PAYLOAD, value_halalas: 100, win_pct: 50 }],
  });
  assert.ok(!html.includes(PAYLOAD), 'أخطر مسار: يصل لأي مستخدم مسجَّل دخول عبر معاينة/إرسال التقرير');
  assert.ok(html.includes(ESCAPED));
});
