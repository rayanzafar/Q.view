import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { login, collectErrors, realConsoleErrors } from './_helpers.mjs';

export default async function ({ browser, base, t, platformRoot }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = collectErrors(page);
  const shots = join(platformRoot, 'docs/evidence/2026-09-05/v5.75');
  mkdirSync(shots, { recursive: true });
  try {
    await login(page, base, 'demo.admin');
    const users = await (await page.request.get(base + '/api/identity/users')).json();
    const target = users.find((u) => u.username === 'demo.consultant');
    assert.ok(target);
    const employeeId = target.employee_id || 'FX-EMP-2';
    const profilePath = '/app/team/resources/' + encodeURIComponent(employeeId);
    if (!target.employee_id) {
      const linked = await page.request.post(base + '/api/employees/FX-EMP-2/link', { data: { user_id: target.id } });
      assert.equal(linked.status(), 200, await linked.text());
    }

    await page.goto(base + '/app/tasks?who=team');
    const person = page.locator(`a[href="/app/person/${target.id}"]`);
    assert.ok(await person.count(), 'Team tasks contains the linked person');
    await person.first().click();
    await page.waitForURL(base + profilePath);
    assert.ok(await page.getByRole('tab', { name: 'العمل المرتبط', exact: false }).count());
    await page.screenshot({ path: join(shots, 'person-overview.png'), fullPage: true });
    t.pass('Team tasks opens the canonical employee profile');

    await page.getByRole('tab', { name: 'المهام', exact: false }).click();
    assert.ok(await page.getByText('حِمل المهام', { exact: false }).count());
    await page.screenshot({ path: join(shots, 'person-tasks.png'), fullPage: true });
    await page.getByRole('tab', { name: 'إدارة الملف', exact: true }).click();
    await page.getByRole('button', { name: 'أضف مهمة', exact: true }).click();
    await page.locator('#pp-task-title').fill('مراجعة الفترة من الملف الموحد');
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/tasks/quick') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'أضف المهمة', exact: true }).click();
    assert.equal((await saved).status(), 200);
    await page.goto(base + profilePath + '?tab=tasks');
    await page.getByText('مراجعة الفترة من الملف الموحد', { exact: true }).waitFor();
    t.pass('A manager adds a task from the unified profile and sees it in its tasks tab');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/app/person/' + target.id);
    await page.waitForURL(base + profilePath);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(shots, 'person-mobile.png'), fullPage: true });
    t.pass('The employee profile fits a 390px viewport');

    await page.goto(base + '/app/imports');
    await page.getByRole('link', { name: 'مراجعة جودة الإيراد', exact: true }).click();
    await page.waitForURL('**/app/revenue-review');
    await page.locator('#review-year').fill('2025');
    await page.getByRole('button', { name: 'عرض السنة', exact: true }).click();
    await page.waitForURL('**/app/revenue-review?year=2025**');
    assert.ok((await page.locator('main').innerText()).includes('سنة البيع مستقلة'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(shots, 'revenue-review-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(base + '/app/revenue-review?year=2026');
    await page.screenshot({ path: join(shots, 'revenue-review.png'), fullPage: true });
    t.pass('Revenue review is reachable from data, filters its year and fits mobile');

    const retired = await page.goto(base + '/app/finance');
    assert.equal(retired.status(), 410);
    assert.ok((await page.locator('main').innerText()).includes('أُلغي قسم المالية'));
    assert.ok(!(await page.locator('main').innerText()).includes('تفعيله'));
    t.pass('Retired finance has no reactivation or write workflow');
    assert.deepEqual(errors.pageErrors, []);
    assert.deepEqual(realConsoleErrors(errors.consoleErrors), []);
    t.pass('No page JavaScript errors in the changed journeys');
  } finally { await context.close(); }
}
