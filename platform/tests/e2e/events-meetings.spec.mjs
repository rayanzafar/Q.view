// اجتماعات الفعالية من جوّال (٣٩٠×٨٤٤): قائد قطاع ينشئ فعاليةً جارية، يفتح تبويب «الاجتماعات»،
// ينشئ اجتماعاً برابطٍ ومدعوّ عبر المنتقي، فيظهر صفّه بزرّ «انضم» يفتح في تبويبٍ جديد،
// و«اجتماعاتي»/«الكل» يقلبان القائمة، ولا فيض أفقي ولا أخطاء متصفح.
import { login, open, collectErrors, realConsoleErrors } from './_helpers.mjs';
import { createEvent, overflowOf } from './events-capture.spec.mjs';

const VIEWPORT = { width: 390, height: 844 };

export default async function eventsMeetingsSpec({ browser, base, t }) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const { consoleErrors, pageErrors } = collectErrors(page);
  let bad = 0;
  const fail = (n, d) => { bad++; t.fail(`events-meetings ${n}`, d); };
  try {
    await login(page, base, 'demo.sectorlead');
    const id = await createEvent(page, 'فعالية فحص الاجتماعات');

    const res = await open(page, base, `/app/event/${encodeURIComponent(id)}?tab=meetings`);
    if (!res || res.status() !== 200) throw new Error(`صفحة الفعالية HTTP ${res?.status()}`);
    await page.waitForSelector('#ev-panel-meetings');

    // الفارغ الأول: دعوة الإنشاء ظاهرة والنموذج مخفيّ حتى يُطلب.
    if (!(await page.locator('[data-action="mt-new"]').first().isVisible())) fail('new button', 'زر «اجتماع جديد» غائب');
    await page.locator('[data-action="mt-new"]').first().click();
    await page.waitForSelector('#mt-form:not([hidden])');

    // التعبئة: عنوانٌ ووقتان ورابطٌ ومدعوّ من المنتقي.
    await page.fill('#mt-title', 'اجتماع فحص آلي');
    await page.fill('#mt-start', '10:00');
    await page.fill('#mt-end', '10:30');
    await page.fill('#mt-url', 'https://teams.microsoft.com/l/meetup/qa-check');
    await page.fill('#mt-people-q', 'demo');
    const row = page.locator('.sp-list .sp-row').first();
    if (await row.count()) {
      await row.click();
      await page.click('[data-action="mt-add-attendee"]');
      const chips = await page.locator('#mt-chips .mt-chip').count();
      if (chips < 2) fail('attendee chip', `رقاقات المدعوين ${chips} — المتوقّع اثنتان فأكثر (أنت + المضاف)`);
    }
    await page.click('[data-action="mt-save"]');
    await page.waitForSelector('.mt-row', { timeout: 15000 });

    // الصفّ: زرّ «انضم» رابطٌ يفتح في تبويب جديد بلا فتح نافذةٍ للصفحة الأم.
    const join = page.locator('.mt-row a.btn-primary').first();
    if (!(await join.count())) fail('join button', 'زر «انضم» غائب عن الصفّ');
    else {
      const href = await join.getAttribute('href');
      const target = await join.getAttribute('target');
      const rel = await join.getAttribute('rel') || '';
      if (href !== 'https://teams.microsoft.com/l/meetup/qa-check') fail('join href', `الرابط: ${href}`);
      if (target !== '_blank') fail('join target', `target=${target}`);
      if (!/noopener/.test(rel)) fail('join rel', `rel=${rel}`);
    }

    // «اجتماعاتي» تعرضه (المنشئ مدعوٌّ تلقائياً) و«الكل» كذلك — والرابطان يتبادلان الحالة.
    const mineCount = await page.locator('.mt-row').count();
    if (mineCount < 1) fail('mine list', 'الاجتماع غائب عن «اجتماعاتي»');
    await page.click('.mt-tb a.chip:not(.on)');
    await page.waitForSelector('#ev-panel-meetings');
    const allCount = await page.locator('.mt-row').count();
    if (allCount < 1) fail('all list', 'الاجتماع غائب عن «الكل»');

    const of = await overflowOf(page);
    if (of.doc > 1 || of.main > 1) fail('overflow', `فيض أفقي: doc ${of.doc}px / main ${of.main}px`);
    if (!bad) t.pass(`events-meetings @390px — اجتماعٌ أُنشئ بمدعوّ ورابط، والقوائم والأزرار سليمة`);
  } catch (e) {
    fail('flow', e.message);
  }
  const realErrs = realConsoleErrors(consoleErrors);
  if (realErrs.length) fail('console', realErrs.slice(0, 3).join(' | '));
  if (pageErrors.length) fail('pageerror', pageErrors.slice(0, 3).join(' | '));
  await ctx.close();
}
