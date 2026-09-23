// انحدار (B1): «يحتاج انتباهك الآن» كان يفقد الفواتير التي لا تحمل القطاع مباشرة.
//
// القصة المقيسة: كثير من الفواتير القديمة تحمل مشروعاً ولا تحمل قطاعاً. شاشة تحصيل القطاع
// (web/views/sector.js) و«ما تغيّر منذ…» (core/reports/changes.js) تقرآن قطاع الفاتورة بالرجوع
// إلى مشروعها COALESCE(i.sector_id, p.sector_id)، بينما كان تنبيه «مستحقات متأخرة» يقارن العمود
// وحده i.sector_id = ?. النتيجة: الفاتورة المتأخرة تظهر في قائمة التحصيل ولا تظهر في التنبيه
// الذي وُجد أصلاً كي لا يفوت شيء. هذه الاختبارات تُثبّت اتفاق الشاشات الثلاث على نفس الفواتير.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-attn-inv-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, all, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();   // بند الفواتير محكوم بـ can(user,'read','invoice')
const { attentionFeed } = await import('../../src/core/reports/attention.js');
const { changesSince } = await import('../../src/core/reports/changes.js');

const T = '2026-07-20';                    // «اليوم» في كل هذا الملف
const admin = { id: 'u_admin', role_id: 'admin', scope: 'company' };
const viewer = { id: 'u_view', role_id: 'viewer', sector_id: 'S1', scope: 'sector' };

// نفس تعبير شاشة التحصيل في sector.js حرفياً — مرجع «الحقيقة» الذي يجب أن يتفق معه التنبيه.
const sectorCollectionIds = (sectorId, today) => all(
  `SELECT i.id FROM invoice i LEFT JOIN project p ON p.id = i.project_id
    WHERE COALESCE(i.sector_id, p.sector_id) = ? AND i.deleted_at IS NULL
      AND i.status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')
      AND (i.status = 'OVERDUE' OR (i.due_date IS NOT NULL AND substr(i.due_date,1,10) < ?))
    ORDER BY i.due_date`, [sectorId, today]).then((rows) => rows.map((r) => r.id).sort());

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع الاختبار', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'S2', name_ar: 'قطاع آخر', active: 1, sort_order: 2, created_at: T });
  await insert('client', { id: 'C1', name_ar: 'عميل قديم', created_at: T });
  await insert('client', { id: 'C2', name_ar: 'عميل موسوم', created_at: T });
  await insert('project', { id: 'P1', name_ar: 'مشروع الحلول', sector_id: 'S1', status: 'IN_PROGRESS', created_at: T });
  await insert('project', { id: 'P2', name_ar: 'مشروع قطاع آخر', sector_id: 'S2', status: 'IN_PROGRESS', created_at: T });

  const inv = (id, extra) => insert('invoice', { id, code: id, amount_halalas: 0, status: 'ISSUED',
    issue_date: '2026-05-01', created_at: T, ...extra });
  // الفاتورة الموروثة: بلا قطاع، ومشروعها في S1 — هذه هي التي كانت تسقط من التنبيه
  await inv('I_LEGACY', { sector_id: null, project_id: 'P1', client_id: 'C1', amount_halalas: 25000000, due_date: '2026-06-01' });
  // فاتورة تحمل القطاع صراحةً — كانت تظهر وحدها
  await inv('I_TAGGED', { sector_id: 'S1', client_id: 'C2', amount_halalas: 10000000, due_date: '2026-06-15' });
  // تسريب عبر القطاعات: بلا قطاع ومشروعها في S2 — يجب ألا تدخل قائمة S1 مهما كبر مبلغها
  await inv('I_OTHER', { sector_id: null, project_id: 'P2', client_id: 'C1', amount_halalas: 90000000, due_date: '2026-05-01' });
  // محذوفة، وغير مستحقة بعد: خارج القائمة في الحالتين
  await inv('I_DEL', { sector_id: null, project_id: 'P1', amount_halalas: 44000000, due_date: '2026-06-01', deleted_at: T });
  await inv('I_FUTURE', { sector_id: null, project_id: 'P1', amount_halalas: 33000000, due_date: '2026-12-01' });
  // فاتورة بلا قطاع وبلا مشروع: لا تنتمي لأي قطاع، فلا تُنسب لواحد اعتباطاً
  await inv('I_ORPHAN', { sector_id: null, project_id: null, amount_halalas: 55000000, due_date: '2026-06-01' });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('التنبيه يرصد الفاتورة المتأخرة التي قطاعها من مشروعها لا من عمودها', async () => {
  const items = await attentionFeed(admin, 'S1', { year: 2026, today: T });
  const inv = items.find((i) => i.title.includes('مستحقات متأخرة'));
  assert.ok(inv, 'بند المستحقات المتأخرة موجود');
  // 250,000 (الموروثة) + 100,000 (الموسومة) = 350,000 ر.س. — قبل الإصلاح كان 100,000 وحدها
  assert.ok(inv.title.includes('350,000'),
    'الفاتورة الموروثة (بلا قطاع، مشروعها في القطاع) غير محسوبة في التنبيه: ' + inv.title);
  assert.ok(inv.title.includes('فاتورتين'), 'العدّ يشمل الفاتورتين معاً: ' + inv.title);
  assert.ok(inv.sub.includes('عميل قديم'), 'عميل الفاتورة الموروثة يظهر في السطر الفرعي: ' + inv.sub);
  assert.equal(inv.action, 'تابع التحصيل');
});

test('الشاشات الثلاث تتفق: التنبيه = قائمة تحصيل القطاع = «ما تغيّر منذ…»', async () => {
  const expected = await sectorCollectionIds('S1', T);
  assert.deepEqual(expected, ['I_LEGACY', 'I_TAGGED'], 'مرجع الحقيقة: فاتورتان متأخرتان في S1');

  const items = await attentionFeed(admin, 'S1', { year: 2026, today: T });
  const inv = items.find((i) => i.title.includes('مستحقات متأخرة'));
  assert.ok(inv, 'بند المستحقات موجود');
  const sum = 25000000 + 10000000;
  assert.ok(inv.title.includes('350,000'), 'مجموع التنبيه يطابق مجموع قائمة التحصيل: ' + sum);

  // «ما تغيّر» تعدّ الفواتير الصادرة بنفس رجوع القطاع إلى المشروع
  const ch = await changesSince(admin, 'S1', '2026-01-01');
  // الرمز حقلٌ مستقل منذ إصلاح ظهور وسم <bdi> حرفياً على الشاشة.
  const codes = ch.items.filter((i) => i.kind === 'invoice').map((i) => i.code || '');
  assert.ok(codes.some((c) => c.includes('I_LEGACY')), 'الفاتورة الموروثة معروفة لـ«ما تغيّر» أيضاً');
  assert.ok(!codes.some((c) => c.includes('I_OTHER')), 'ولا تسرّب من قطاع آخر');
});

test('لا تسرّب عبر القطاعات: مشروع قطاع آخر أو فاتورة بلا انتماء لا يدخلان قائمة القطاع', async () => {
  const s1 = await attentionFeed(admin, 'S1', { year: 2026, today: T });
  const inv1 = s1.find((i) => i.title.includes('مستحقات متأخرة'));
  assert.ok(!inv1.title.includes('1,250,000') && !inv1.title.includes('900,000'),
    'فاتورة مشروع S2 (900,000) خارج مجموع S1: ' + inv1.title);
  assert.ok(!inv1.title.includes('ثلاث') && !inv1.title.includes('فواتير'),
    'الفاتورة اليتيمة (بلا قطاع وبلا مشروع) لا تُنسب لهذا القطاع: ' + inv1.title);

  const s2 = await attentionFeed(admin, 'S2', { year: 2026, today: T });
  const inv2 = s2.find((i) => i.title.includes('مستحقات متأخرة'));
  assert.ok(inv2, 'قطاع S2 يرى فاتورة مشروعه');
  assert.ok(inv2.title.includes('900,000'), 'وقيمتها كاملة: ' + inv2.title);
  assert.ok(inv2.title.includes('فاتورة واحدة'), 'فاتورة واحدة لا أكثر: ' + inv2.title);
});

test('بوابة الصلاحية باقية: من لا يقرأ الفواتير لا يرى المبلغ ولو صار الرصد أوسع', async () => {
  const items = await attentionFeed(viewer, 'S1', { year: 2026, today: T });
  assert.ok(!items.some((i) => i.title.includes('مستحقات متأخرة')), 'رقم مالي تسرّب لمن لا يقرأ الفواتير');
});
