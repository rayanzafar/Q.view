// صفحة سجل التدقيق تقرأ وصف الحدث **بعمق**: وحدة الفريق والموارد تكتب في الوصف كائنات
// متداخلة (الوجهة {النوع، المعرّف}، الأشهر {"10": 50}، قبل/بعد) ونصوصاً مرمَّزة (المهارات)
// ومنطقيات — فكان المسح الحيّ يلتقط «[object Object]» و«true» وعلامات الاقتباس على الشاشة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-audit-render-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
let db, P, resolveUser;
const T = new Date().toISOString();

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  P = await import('../../src/web/pages.js');
  await db.insert('app_user', { id: 'u_admin', username: 'admin1', name_ar: 'مدير النظام', role_id: 'admin', sector_id: null, scope: 'company', active: 1, created_at: T });
  await db.insert('session', { id: 's_admin', user_id: 'u_admin', created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  const detail = {
    employee: 'emp_1', target: { kind: 'project', id: 'P1' }, months: { 10: 50, 11: 50 }, alloc_status: 'confirmed', billable: true,
    skills_json: '{"required":["تحليل البيانات"],"preferred":["إدارة المشاريع"]}', before: { capacity_pct: 100 }, after: { capacity_pct: 80 },
  };
  await db.insert('audit_log', { id: 'aud_1', user_id: 'u_admin', action: 'create', resource: 'allocation_request', resource_id: 'areq_1',
    sector_id: null, detail_json: JSON.stringify(detail), at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('وصف الحدث المتداخل يُقرأ عربياً — لا [object Object] ولا true ولا اقتباسات', async () => {
  const admin = await resolveUser('s_admin');
  const html = await P.auditPage(admin, {});
  // خانة الوصف وحدها (الصفّ الذي يحمل معرّف الحدث) — لا نصّ الصفحة كله (فيه شيفرة الواجهة).
  const row = (html.split('<tr').find((r) => r.includes('areq_1')) || '').split('</tr>')[0];
  const cell = row.slice(row.lastIndexOf('<td'));
  assert.ok(cell.includes('الوجهة: النوع: project P1'), 'الوجهة المتداخلة تُقرأ بقيمها: ' + cell.slice(0, 300));
  assert.ok(cell.includes('الأشهر: 10: 50، 11: 50') || cell.includes('الأشهر: 10: 50 11: 50'), 'الأشهر بمفاتيحها: ' + cell.slice(0, 300));
  assert.ok(cell.includes('نعم'), 'المنطقي يُقال بالعربية');
  assert.ok(cell.includes('تحليل البيانات') && cell.includes('إدارة المشاريع'), 'المهارات المرمَّزة تُفكّ إلى أسمائها');
  assert.ok(cell.includes('قبل: الطاقة: 100') && cell.includes('بعد: الطاقة: 80'), 'قبل/بعد بمفاتيحهما العربية');
  assert.doesNotMatch(cell, /\[object|&quot;|\btrue\b|\bnull\b/, 'لا آثار تقنية في الخانة: ' + cell.slice(0, 300));
});
