// Presentation regressions use only migrated disposable data, never historical platform rows.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'sanad-unknown-health-'));
process.env.DATABASE_URL = '';
process.env.SANAD_DB = join(dir, 'fixture.db');
const root = new URL('../..', import.meta.url).pathname;
for (const script of ['scripts/migrate.js', 'scripts/seed-rbac.js'])
  execFileSync(process.execPath, ['--experimental-sqlite', join(root, script)], { env: process.env, stdio: 'ignore' });
const { insert, get, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { sectorPage } = await import('../../src/web/views/sector.js');
const { portfolioPage, ceoPage } = await import('../../src/web/views/exec.js');
const admin = { id: 'health-admin', username: 'health-admin', role_id: 'admin', scope: 'company' };
const lead = { id: 'health-lead', username: 'health-lead', role_id: 'sector_lead', scope: 'sector', sector_id: 'HEALTH' };
await insert('sector', { id: 'HEALTH', name_ar: 'قطاع اختبار التقييم', active: 1, kind: 'delivery', created_at: '2026-01-01',
  target_sales_halalas: 900000, target_revenue_halalas: 800000 });
await insert('project', { id: 'HEALTH-UNKNOWN', name_ar: 'مشروع يحتاج تقييمًا موثقًا', sector_id: 'HEALTH', status: 'IN_PROGRESS', rag: null,
  start_date: '2026-01-01', end_date: '2026-12-31', created_at: '2026-01-01' });
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });
const visible = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('sector unknown-health count includes the project in its drilldown for authorized roles', async () => {
  for (const user of [admin, lead]) {
    const html = await sectorPage(user, { sector: 'HEALTH', year: 2026 });
    // الشاشة الواحدة (v6.10): لا نوافذ `dd-*` مُصيَّرة على الخادم — المشاريع تصل في حزمة
    // `cc-data` ويرسمها المتصفّح في بطاقة المشاريع ولوحتها. والتقييم الغائب يصل **غياباً**،
    // فتسمّيه الشاشة «غير مُقيَّم» من خريطة `HEALTH_LABELS` التي لا تحمل له مفتاحاً.
    const open = '<script type="application/json" id="cc-data">';
    const from = html.indexOf(open);
    assert.ok(from > 0, 'cc-data pack missing from the sector page');
    const data = JSON.parse(html.slice(from + open.length, html.indexOf('</script>', from)));
    const p = data.projects.find((x) => x.id === 'HEALTH-UNKNOWN');
    assert.ok(p, 'the unassessed project must reach the projects card');
    assert.equal(p.rag, null, 'an absent assessment must stay absent, not become a colour');
    assert.equal(p.name, 'مشروع يحتاج تقييمًا موثقًا');
    const lopen = '<script type="application/json" id="cc-labels">';
    const lfrom = html.indexOf(lopen);
    const labels = JSON.parse(html.slice(lfrom + lopen.length, html.indexOf('</script>', lfrom)));
    assert.deepEqual(Object.keys(labels.HEALTH_LABELS).sort(), ['AMBER', 'GREEN', 'RED'],
      'HEALTH_LABELS must carry no key for an absent assessment — the page falls back to the shared unknown label');
    assert.equal(labels.healthUnknown, 'غير محدَّدة',
      'the absent-assessment label must reach the page from HEALTH_UNKNOWN, not be worded again inside it');
    assert.doesNotMatch(visible(html), /\b(?:undefined|NaN)\b/);
  }
  assert.equal((await get('SELECT rag FROM project WHERE id = ?', ['HEALTH-UNKNOWN'])).rag, null);
});

test('portfolio counts unassessed active projects and preserves their source assessment', async () => {
  for (const user of [admin, lead]) {
    const html = await portfolioPage(user);
    const text = visible(html);
    assert.match(text, /غير مقيّم 1 يحتاج تقييمًا موثقًا/);
    assert.match(text, /مشروع يحتاج تقييمًا موثقًا/);
    assert.doesNotMatch(text, /\b(?:undefined|NaN)\b/);
  }
  assert.equal((await get('SELECT rag FROM project WHERE id = ?', ['HEALTH-UNKNOWN'])).rag, null);
});

test('CEO target attainment is unavailable when the selected year has no approved annual target', async () => {
  const html = await ceoPage(admin, { year: 2026 });
  const text = visible(html).replace(/⊕/g, '').replace(/\s+/g, ' ');
  assert.match(text, /تحقيق الإيراد غير متاح المستهدف غير مكتمل/);
  assert.match(text, /تحقيق المبيعات غير متاح المستهدف غير مكتمل/);
  assert.doesNotMatch(text, /تحقيق (?:الإيراد|المبيعات) 0[%٪]/);
  assert.doesNotMatch(text, /\b(?:undefined|NaN)\b/);
  assert.equal((await get('SELECT COUNT(*) n FROM budget WHERE sector_id = ?', ['HEALTH'])).n, 0);
  assert.equal((await get('SELECT target_sales_halalas FROM sector WHERE id = ?', ['HEALTH'])).target_sales_halalas, 900000);
});
