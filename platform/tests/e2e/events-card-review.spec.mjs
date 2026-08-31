// مراجعة البطاقة من جوّال (٣٩٠×٨٤٤): بطاقةٌ بصورةٍ في «الجهات الملتقطة» — الضغط على صفّها يفتح
// نافذةً فيها الصورة كبيرةً وزرّ تنزيلها (يعود ملفاً لا عرضاً) والحقول للتصحيح، وتعديلُ الاسم
// وحفظه يظهر في الجدول. والمشاهد يفتح النافذة ويقرأ بلا حقول كتابة.
import { resolve } from 'node:path';
import { login, open, collectErrors, realConsoleErrors } from './_helpers.mjs';
import { createEvent, overflowOf } from './events-capture.spec.mjs';

const VIEWPORT = { width: 390, height: 844 };

export default async function eventsCardReviewSpec({ browser, base, t, platformRoot }) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const { consoleErrors, pageErrors } = collectErrors(page);
  let bad = 0;
  const fail = (n, d) => { bad++; t.fail(`events-card-review ${n}`, d); };
  try {
    await login(page, base, 'demo.sectorlead');
    const id = await createEvent(page, 'فعالية فحص المراجعة');
    // بطاقةٌ بحقول القارئ الخاطئة عمداً، ثم صورتها.
    const cid = await page.evaluate(async ({ id }) => {
      const r = await fetch('/api/events/' + encodeURIComponent(id) + '/contacts', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
        body: JSON.stringify({ kind: 'شراكة', person_name: 'سارا القحطاني', org_name: 'النور', phone: '0501234567', raw_text: 'Sara Alqahtani\nAlnoor Trading', capture_key: 'e2e-review-1' }),
      });
      const j = await r.json();
      return (j.contact && j.contact.id) || j.id;
    }, { id });
    const img = await import('node:fs').then((fs) => fs.readFileSync(resolve(platformRoot, 'tests/e2e/fixtures/business-card.png')));
    const up = await page.request.post(`${base}/api/events/contacts/${encodeURIComponent(cid)}/photo`, {
      headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'image/png', 'x-file-name': 'card.png' }, data: img,
    });
    if (!up.ok()) throw new Error(`رفع الصورة ${up.status()}`);

    await open(page, base, `/app/event/${encodeURIComponent(id)}?tab=contacts`);
    await page.waitForSelector('tr[data-contact]');
    if (!(await page.locator('.ev-thumb-btn').count())) fail('thumb button', 'المصغّرة ليست زراً');

    // الصفّ يفتح النافذة: صورةٌ كبيرة وتنزيلٌ وحقولٌ بقيم البطاقة.
    await page.locator('tr[data-contact] td').nth(2).click();
    await page.waitForSelector('#modal.on .cv-img', { timeout: 8000 });
    const dl = page.locator('#modal.on a.btn-primary');
    const href = await dl.getAttribute('href');
    if (!/download=1/.test(href || '')) fail('download link', `رابط التنزيل: ${href}`);
    const res = await page.request.get(base + href);
    const disp = res.headers()['content-disposition'] || '';
    if (!/^attachment/.test(disp)) fail('download header', `Content-Disposition: ${disp}`);
    const inl = await page.request.get(base + href.replace(/[?&]download=1/, ''));
    if (!/^inline/.test(inl.headers()['content-disposition'] || '')) fail('inline header', 'العرض العادي ليس inline');
    const preset = await page.locator('#modal.on #cv-person_name').inputValue();
    if (preset !== 'سارا القحطاني') fail('prefill', `الاسم في النافذة «${preset}»`);
    if (!(await page.locator('#modal.on details').count())) fail('raw text', 'النصّ الخام غائب');

    // التصحيح: الاسم يُصلَح ويظهر في الجدول بعد الحفظ.
    await page.fill('#modal.on #cv-person_name', 'سارة القحطاني');
    await page.click('[data-action="ev-card-save"]');
    await page.waitForFunction(() => /سارة القحطاني/.test(document.body.textContent || ''), null, { timeout: 10000 });

    const of = await overflowOf(page);
    if (of.doc > 1 || of.main > 1) fail('overflow', `فيض أفقي: doc ${of.doc}px / main ${of.main}px`);

    // المشاهد: النافذة تُفتح للقراءة بلا حقول ولا زرّ حفظ.
    const ctx2 = await browser.newContext({ viewport: VIEWPORT });
    const p2 = await ctx2.newPage();
    await login(p2, base, 'demo.viewer');
    await open(p2, base, `/app/event/${encodeURIComponent(id)}?tab=contacts`);
    await p2.locator('.ev-thumb-btn').first().click();
    await p2.waitForSelector('#modal.on .cv-img', { timeout: 8000 });
    if (await p2.locator('#modal.on #cv-form').count()) fail('viewer edit', 'المشاهد يرى حقول التعديل');
    if (await p2.locator('#modal.on [data-action="ev-card-save"]').count()) fail('viewer save', 'المشاهد يرى زرّ الحفظ');
    await ctx2.close();

    if (!bad) t.pass('events-card-review @390px — الصورة كبيرةً، تنزيلٌ ملفاً، تصحيحُ الحقول، والمشاهد يقرأ فقط');
  } catch (e) {
    fail('flow', e.message);
  }
  const realErrs = realConsoleErrors(consoleErrors);
  if (realErrs.length) fail('console', realErrs.slice(0, 3).join(' | '));
  if (pageErrors.length) fail('pageerror', pageErrors.slice(0, 3).join(' | '));
  await ctx.close();
}
