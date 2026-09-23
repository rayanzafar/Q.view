// حراسة على تسريب النص إلى صفحاتٍ تُبنى بقوالب نصية: العنوان والوصف لم يكونا يُهرَّبان في
// القالب العام، ولون القطاع ومعرّفه كانا يدخلان خاصية التنسيق والروابط بلا تحقّق — فأيّ اسمٍ
// أو لونٍ يحمل رمزاً خطراً كان ينفَّذ في متصفّح كل من يفتح الصفحة. هذا الملف يثبّت العلاج:
//   • القالب `layout` يُهرِّب العنوان والوصف عند المصدر.
//   • خدمة القطاع ترفض اللون غير الست‑عشري والمعرّف غير الآمن عند الكتابة.
//   • حتى لو تسرّب لونٌ خطر إلى القاعدة، الصفحة تُهرِّبه عند العرض.
//   • مُعامل «القطاع» المنعكس في كتلة البيانات لا يكسر وسم <script>.
//   • سنةٌ غير رقمية لا تُنتج «NaN» على شاشة الفرص.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-xss-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, P, org, layout;
const NOW = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', sector_id: 'S1', active: 1 };
const CTX = { user: ADMIN, ip: '127.0.0.1' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  P = await import('../../src/web/pages.js');
  org = await import('../../src/modules/org/org.js');
  ({ layout } = await import('../../src/web/layout.js'));

  await db.insert('sector', { id: 'S1', name_ar: 'قطاع الحلول', kind: 'delivery', color: '#244A99', active: 1, created_at: NOW });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', sector_id: 'S1', active: 1, created_at: NOW });
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── القالب العام يُهرِّب العنوان والوصف (C1/C4/C5) ──
test('layout يُهرِّب العنوان والوصف عند المصدر', async () => {
  const html = await layout({
    user: ADMIN, active: 'home',
    title: '<script>alert(9)</script>',
    subtitle: '<img src=x onerror=alert(8)>',
    body: '', year: 2026,
  });
  assert.ok(!html.includes('<script>alert(9)'), 'العنوان الخام نُفِّذ في القالب');
  assert.ok(html.includes('&lt;script&gt;alert(9)'), 'العنوان لم يُهرَّب');
  assert.ok(!html.includes('<img src=x onerror=alert(8)>'), 'الوصف الخام نُفِّذ في القالب');
  assert.ok(html.includes('&lt;img src=x onerror=alert(8)&gt;'), 'الوصف لم يُهرَّب');
});

// ── صفحة الشخص تُهرِّب الاسم (C1، المسار الحيّ) ──
test('صفحة الشخص تُهرِّب اسم المستخدم', async () => {
  await db.insert('app_user', { id: 'u_x', username: 'x', name_ar: '<script>alert(1)</script>', role_id: 'employee', scope: 'own', sector_id: 'S1', active: 1, created_at: NOW });
  const html = await P.personPage(ADMIN, 'u_x');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'اسم الشخص الخام نُفِّذ');
  assert.ok(html.includes('&lt;script&gt;alert(1)'), 'اسم الشخص لم يُهرَّب');
});

// ── خدمة القطاع ترفض اللون والمعرّف غير الآمنين عند الكتابة (C2) ──
test('إنشاء القطاع يرفض اللون غير الست‑عشري', async () => {
  await assert.rejects(
    () => org.createSector(CTX, { id: 'BAD', name_ar: 'قطاع', color: 'red" onmouseover="alert(1)' }),
    /لوني/, 'قُبِل لونٌ غير ست‑عشري');
});
test('إنشاء القطاع يرفض المعرّف غير الآمن', async () => {
  await assert.rejects(
    () => org.createSector(CTX, { id: 'a"><b', name_ar: 'قطاع', color: '#123456' }),
    /المعرّف/, 'قُبِل معرّفٌ غير آمن');
});
test('تعديل القطاع يرفض اللون غير الست‑عشري', async () => {
  await assert.rejects(
    () => org.updateSector(CTX, 'S1', { color: 'javascript:alert(1)' }),
    /لوني/, 'قُبِل لونٌ غير ست‑عشري في التعديل');
});
test('إنشاء القطاع يقبل لوناً ست‑عشرياً صحيحاً', async () => {
  const s = await org.createSector(CTX, { id: 'GOOD', name_ar: 'قطاع جيّد', color: '#0af' });
  assert.equal(s.color, '#0af');
});

// ── حتى لو تسرّب لونٌ خطر إلى القاعدة، العرض يُهرِّبه (C2، دفاع العرض) ──
test('لونٌ خطر مخزَّن يُهرَّب على شاشة المشاريع', async () => {
  await db.insert('sector', { id: 'S_EVIL', name_ar: 'قطاع', color: 'red" onmouseover="alert(1)', kind: 'delivery', active: 1, created_at: NOW });
  const html = await P.projectsPage(ADMIN, {});
  assert.ok(!html.includes('onmouseover="alert(1)"'), 'اللون الخطر كسر الخاصية عند العرض');
});

// ── مُعامل «القطاع» المنعكس لا يكسر وسم <script> (C3) ──
test('صفحة الفريق تُهرِّب «القطاع» المنعكس في كتلة البيانات', async () => {
  const html = await P.teamPage(ADMIN, { sector: '</script><img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('</script><img src=x onerror=alert(1)>'), 'انعكس مُعامل القطاع خاماً وكسر السكربت');
});

// ── سنةٌ غير رقمية لا تُنتج «NaN» (J1) ──
test('سنةٌ غير رقمية لا تُظهر NaN على شاشة الفرص', async () => {
  const html = await P.opportunitiesPage(ADMIN, { year: 'abc' });
  assert.ok(!html.includes('NaN'), 'ظهرت NaN على الشاشة');
});
