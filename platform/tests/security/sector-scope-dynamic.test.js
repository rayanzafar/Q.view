// المنصة يجب أن تعمل ديناميكياً حسب قطاع كل مستخدم — لا قطاع افتراضي مكتوب في الكود.
// كان مركز القيادة يسقط إلى «SOLUTIONS» نصاً لمن لا قطاع له، وكانت دالة اللوحة تستقبل المستخدم
// ولا تفحصه، فيرى صاحبُ نطاقٍ قطاعي مركزَ قيادة قطاع آخر كاملاً. هذان الاختباران يحرسان الأمرين.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sanad-secscope-'));
process.env.SANAD_DB = join(dir, 't.db');
const { migrate } = await import('../../scripts/migrate.js');
await migrate();
const { insert, close } = await import('../../src/core/db/index.js');
const { sectorDashboard } = await import('../../src/core/reports/metrics.js');
const { sectorPage } = await import('../../src/web/views/sector.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
const { seedRbac } = await import('../../scripts/seed-rbac.js');

const T = '2026-01-01T00:00:00.000Z';
before(async () => {
  await seedRbac(); await initRbac();
  for (const [id, n, o] of [['ALPHA', 'قطاع ألفا', 1], ['BETA', 'قطاع بيتا', 2]])
    await insert('sector', { id, name_ar: n, kind: 'delivery', active: 1, sort_order: o,
      target_revenue_halalas: 100000, target_sales_halalas: 100000, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const U = (sector, scope = 'sector') => ({ id: 'u1', role_id: 'sector_lead', sector_id: sector, scope });

test('صاحب نطاق قطاعي لا يصل إلى لوحة قطاع آخر — الحارس في الخدمة لا في المسار وحده', async () => {
  await assert.rejects(() => sectorDashboard(U('ALPHA'), 'BETA'),
    (e) => e.status === 403 && /خارج نطاقك/.test(e.message));
  const own = await sectorDashboard(U('ALPHA'), 'ALPHA');
  assert.equal(own.sector.id, 'ALPHA', 'وقطاعه هو يعمل كما كان');
});

test('نطاق الشركة يرى أي قطاع — لم يُغلق الباب على الاستعمال الصحيح', async () => {
  const r = await sectorDashboard(U(null, 'company'), 'BETA');
  assert.equal(r.sector.id, 'BETA');
});

test('مستخدم بلا قطاع لا يُسقَط إلى قطاع مكتوب في الكود — بل يرى الحالة المصمَّمة', async () => {
  const html = await sectorPage(U(null), {});
  assert.match(html, /لا يوجد قطاع مرتبط بحسابك/, 'الحالة المصمَّمة هي الجواب لا قطاع بديل');
  for (const leak of ['قطاع ألفا', 'قطاع بيتا'])
    assert.ok(!html.includes(leak), `لا تسريب لبيانات ${leak} لمن لا قطاع له`);
});

test('كل قطاع يعرض بياناته هو — الصفحة ديناميكية لا ثابتة', async () => {
  const a = await sectorPage(U(null, 'company'), { sector: 'ALPHA' });
  const b = await sectorPage(U(null, 'company'), { sector: 'BETA' });
  assert.match(a, /قطاع ألفا/); assert.match(b, /قطاع بيتا/);
  assert.notEqual(a, b, 'صفحتا قطاعين مختلفين لا تتطابقان');
});
