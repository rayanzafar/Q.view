// Staffing Workspace (v5.26): the matrix is the hero — sticky header/column, cell click opens
// the month drawer, select-mode shows the action bar, and «تسكين جديد» reaches a live review
// with an over-limit warning. Runs as demo.admin against the seeded fixture DB.
import { login, open } from './_helpers.mjs';

export default async function staffingSpec({ browser, base, t }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, base, 'demo.admin');
  await open(page, base, '/app/staffing');

  // 1) البنية: مصفوفة مسطّحة + مرساة الجولة + أربع بلاطات
  const shape = await page.evaluate(() => ({
    mx: !!document.getElementById('mx'),
    q: !!document.getElementById('staff-q'),
    tiles: document.querySelectorAll('.kpi4-tile').length,
    bsec: document.querySelectorAll('details.bsec').length,
    cells: document.querySelectorAll('.mx-cell').length,
  }));
  if (shape.mx && shape.q && shape.tiles === 4 && shape.bsec === 0 && shape.cells > 0) {
    t.pass(`matrix renders flat with ${shape.cells} cells, 4 KPI tiles, #staff-q kept`);
  } else t.fail('matrix shape', JSON.stringify(shape));

  // 2) لصوق الرأس والعمود: بعد تمرير الحاوية يبقى رأس الأشهر وعمود الموظف في مكانهما
  const sticky = await page.evaluate(() => {
    const mx = document.getElementById('mx');
    const th = mx.querySelector('thead th');
    const before = th.getBoundingClientRect().top;
    mx.scrollTop = 200;
    const after = th.getBoundingClientRect().top;
    const emp = mx.querySelector('tbody th');
    const cs = getComputedStyle(emp);
    return { headSticky: Math.abs(before - after) < 2, colPos: cs.position };
  });
  if (sticky.headSticky && sticky.colPos === 'sticky') t.pass('sticky month header + sticky employee column');
  else t.fail('sticky', JSON.stringify(sticky));

  // 3) نقرة خلية تفتح drawer الشهر
  await page.click('.mx-cell');
  await page.waitForTimeout(600);
  const drawerOpen = await page.evaluate(() => {
    const d = document.getElementById('drawer');
    return !!d && d.classList.contains('on') && d.textContent.length > 20;
  });
  if (drawerOpen) t.pass('cell click opens the month drawer');
  else t.fail('cell drawer', 'drawer did not open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // 4) وضع التحديد: تعليم خليتين يُظهر الشريط بعدّاده
  await page.click('[data-action="mx-select-toggle"]');
  const cells = await page.$$('.mx-cell');
  await cells[0].click();
  if (cells[1]) await cells[1].click();
  await page.waitForTimeout(300);
  const bar = await page.evaluate(() => {
    const b = document.getElementById('mx-bar');
    return b && b.offsetParent !== null ? b.textContent : '';
  });
  if (bar && /محدد|خلية/.test(bar)) t.pass('select mode shows the action bar with a count');
  else t.fail('select bar', bar || 'bar missing');
  await page.click('[data-action="mx-select-toggle"]').catch(() => {});
  await page.waitForTimeout(200);

  // 5) «تسكين جديد» يصل إلى المراجعة الحية
  const hasNew = await page.$('[data-action="staff-new"]');
  if (hasNew) {
    await page.click('[data-action="staff-new"]');
    await page.waitForTimeout(500);
    const modal = await page.evaluate(() => {
      const m = document.getElementById('modal');
      return m && m.classList.contains('on') ? m.textContent : '';
    });
    if (/أين سيكون التسكين|الجهة/.test(modal)) t.pass('«تسكين جديد» opens starting from the target question');
    else t.fail('new staffing modal', modal.slice(0, 120) || 'modal missing');
    await page.keyboard.press('Escape');
  } else t.fail('staff-new button', 'missing for admin');

  // 6) صفر فيض أفقي على 390
  const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await m.newPage();
  await login(mp, base, 'demo.admin');
  await open(mp, base, '/app/staffing');
  const ov = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (ov <= 0) t.pass('no horizontal overflow at 390px');
  else t.fail('mobile overflow', `overflow=${ov}px`);
  await m.close();
  await ctx.close();
}
