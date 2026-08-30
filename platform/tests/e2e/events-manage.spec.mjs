// إدارة الفعالية من جوّال (٣٩٠×٨٤٤): قائد قطاع يرى شريط الإدارة على صفحة فعاليته —
// يعدّل اسمها من النافذة، يغلقها فيتوقف الالتقاط، يفتحها، ثم يحذفها فيعود إلى القائمة
// وقد اختفت. والاستشاري لا يرى الشريط أصلاً — الزرّ الغائب حكمُ الخادم لا نسيانُ الشاشة.
import { login, open, collectErrors, realConsoleErrors } from './_helpers.mjs';
import { createEvent, overflowOf } from './events-capture.spec.mjs';

const VIEWPORT = { width: 390, height: 844 };

export default async function eventsManageSpec({ browser, base, t }) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const { consoleErrors, pageErrors } = collectErrors(page);
  let bad = 0;
  const fail = (n, d) => { bad++; t.fail(`events-manage ${n}`, d); };
  try {
    await login(page, base, 'demo.sectorlead');
    const id = await createEvent(page, 'فعالية فحص الإدارة');
    await open(page, base, `/app/event/${encodeURIComponent(id)}`);
    await page.waitForSelector('.ev-admin');
    for (const act of ['ev-edit', 'ev-close', 'ev-del-event']) {
      if (!(await page.locator(`[data-action="${act}"]`).count())) fail('admin bar', `زرّ ${act} غائب`);
    }

    // التعديل: النافذة تفتح بالقيم الحالية، وتغيير الاسم يظهر في الترويسة بعد الحفظ.
    await page.click('[data-action="ev-edit"]');
    await page.waitForSelector('#modal.on #evn-name');
    const preset = await page.locator('#modal.on #evn-name').inputValue();
    if (preset !== 'فعالية فحص الإدارة') fail('edit prefill', `القيمة المسبقة «${preset}»`);
    await page.fill('#modal.on #evn-name', 'فعالية فحص الإدارة — معدَّلة');
    await page.click('[data-action="ev-edit-save"]');
    await page.waitForFunction(() => /معدَّلة/.test((document.querySelector('.ev-hd h2') || {}).textContent || ''), null, { timeout: 10000 });

    // الإغلاق: الحالة «مُغلقة» وتبويب الالتقاط يرفض بلطف، ثم الفتح يعيدها.
    await page.click('[data-action="ev-close"]');
    await page.waitForFunction(() => /مُغلقة/.test(document.body.textContent || ''), null, { timeout: 10000 });
    await open(page, base, `/app/event/${encodeURIComponent(id)}?tab=capture`);
    if (!(await page.locator('text=هذه الفعالية مُغلقة').count())) fail('closed capture', 'تبويب الالتقاط لا يُعلن الإغلاق');
    await page.click('[data-action="ev-reopen"]');
    await page.waitForSelector('[data-action="ev-close"]', { timeout: 10000 });

    const of = await overflowOf(page);
    if (of.doc > 1 || of.main > 1) fail('overflow', `فيض أفقي: doc ${of.doc}px / main ${of.main}px`);

    // الحذف: عودةٌ إلى القائمة وقد اختفت الفعالية منها.
    await page.click('[data-action="ev-del-event"]');
    await page.waitForURL('**/app/events**', { timeout: 10000 });
    if (await page.locator('text=فعالية فحص الإدارة').count()) fail('deleted', 'الفعالية المحذوفة ما زالت في القائمة');

    // الاستشاري لا يرى شريط الإدارة على فعاليةٍ أخرى.
    const ctx2 = await browser.newContext({ viewport: VIEWPORT });
    const p2 = await ctx2.newPage();
    await login(p2, base, 'demo.sectorlead');
    const id2 = await createEvent(p2, 'فعالية بلا إدارة للغير');
    await ctx2.close();
    const ctx3 = await browser.newContext({ viewport: VIEWPORT });
    const p3 = await ctx3.newPage();
    await login(p3, base, 'demo.consultant');
    await open(p3, base, `/app/event/${encodeURIComponent(id2)}`);
    if (await p3.locator('.ev-admin').count()) fail('consultant bar', 'الاستشاري يرى شريط الإدارة');
    await ctx3.close();

    if (!bad) t.pass('events-manage @390px — تعديلٌ وإغلاقٌ وفتحٌ وحذفٌ من الشاشة، والشريط لأهله وحدهم');
  } catch (e) {
    fail('flow', e.message);
  }
  const realErrs = realConsoleErrors(consoleErrors);
  if (realErrs.length) fail('console', realErrs.slice(0, 3).join(' | '));
  if (pageErrors.length) fail('pageerror', pageErrors.slice(0, 3).join(' | '));
  await ctx.close();
}
