// مراجعة البطاقة من جوّال (٣٩٠×٨٤٤): بطاقةٌ بصورةٍ في «الجهات الملتقطة» — الضغط على صفّها يفتح
// نافذةً فيها الصورة كبيرةً وزرّ تنزيلها (يعود ملفاً لا عرضاً) والحقول للتصحيح، وتعديلُ الاسم
// وحفظه يظهر في الجدول. والمشاهد يفتح النافذة ويقرأ بلا حقول كتابة.
//
// ومنذ v5.67: البطاقة تحمل أكثر من صورة — «أضف صورة» من النافذة نفسها تُلحق صورةً ثانية،
// وشريطُ الصور يظهر تحت الكبيرة فتُبدَّل بالضغط، والمصغّرة في الجدول تحمل شارة «+١»، وحذفُ
// صورةٍ يُبقي الأخرى، و«القطاع المعني» يُختار من النافذة فيظهر في عمود «القطاع». وكل موظفٍ
// يملك التعديل — لا الملتقِط وحده — يرى الحقول وأزرار الإضافة والحذف؛ والمشاهد لا يرى شيئاً منها.
import { resolve } from 'node:path';
import { login, open, collectErrors, realConsoleErrors } from './_helpers.mjs';
import { createEvent, overflowOf } from './events-capture.spec.mjs';

const VIEWPORT = { width: 390, height: 844 };
const blobIdOf = (url) => String(url || '').split('?')[0].split('/').pop();

export default async function eventsCardReviewSpec({ browser, base, t, platformRoot }) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const { consoleErrors, pageErrors } = collectErrors(page);
  page.on('dialog', (d) => d.accept());          // تأكيد الحذف يُقبل — الحوار الأصلي لا يُختبر هنا
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
    const fs = await import('node:fs');
    const img = fs.readFileSync(resolve(platformRoot, 'tests/e2e/fixtures/business-card.png'));
    const img2 = resolve(platformRoot, 'tests/e2e/fixtures/business-card-2.png');
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
    if (await page.locator('#modal.on .cv-strip').count()) fail('single strip', 'شريط الصور يظهر لبطاقةٍ بصورةٍ واحدة');

    // ── صورةٌ ثانية من النافذة نفسها: تُصغَّر على الجهاز وتُلحق، والشريط يظهر بصورتين ──
    const firstMain = await page.locator('#modal.on #cv-main').getAttribute('src');
    if (!(await page.locator('#modal.on [data-action="cv-photo-add"]').count())) fail('add button', 'زرّ «أضف صورة» غائب عن النافذة');
    await page.setInputFiles('#cv-photo', img2);
    const two = await page.waitForFunction(
      () => document.querySelectorAll('#modal.on .cv-strip button').length === 2, null, { timeout: 25000},
    ).then(() => true, () => false);
    if (!two) {
      const n = await page.locator('#modal.on .cv-strip button').count();
      fail('add photo', `شريط الصور فيه ${n} صورة بعد الإضافة لا صورتان`);
    } else {
      // الضغط على الصورة الثانية يبدّل الكبيرة وروابطها — بلا نداءٍ جديد للخادم.
      const src2 = await page.locator('#modal.on .cv-strip button img').nth(1).getAttribute('src');
      const bid2 = blobIdOf(src2);
      await page.locator('#modal.on .cv-strip button').nth(1).click();
      const swapped = await page.waitForFunction(
        (b) => {
          const m = document.getElementById('cv-main');
          return !!m && String(m.getAttribute('src') || '').indexOf(b) >= 0;
        }, bid2, { timeout: 6000 },
      ).then(() => true, () => false);
      const nowMain = await page.locator('#modal.on #cv-main').getAttribute('src');
      if (!swapped || nowMain === firstMain) fail('pick photo', `الصورة الكبيرة لم تتبدّل: ${nowMain}`);
      const dl2 = await page.locator('#modal.on #cv-dl').getAttribute('href');
      if (!dl2 || dl2.indexOf(bid2) < 0 || !/download=1/.test(dl2)) fail('pick download', `رابط تنزيل الصورة المختارة: ${dl2}`);
      const open2 = await page.locator('#modal.on #cv-open').getAttribute('href');
      if (!open2 || open2.indexOf(bid2) < 0) fail('pick open', `رابط فتح الصورة المختارة: ${open2}`);
      const ofGallery = await overflowOf(page);
      if (ofGallery.doc > 1 || ofGallery.main > 1) fail('overflow gallery', `فيض أفقي والمعرض مفتوح: doc ${ofGallery.doc}px / main ${ofGallery.main}px`);
    }

    // الشارة على المصغّرة في الجدول: «+١» لبطاقةٍ بصورتين.
    await open(page, base, `/app/event/${encodeURIComponent(id)}?tab=contacts`);
    await page.waitForSelector('tr[data-contact]');
    const badge = await page.locator('.ev-thumb-n').first().textContent().catch(() => null);
    if ((badge || '').trim() !== '+1') fail('thumb badge', `شارة العدد على المصغّرة: «${badge}»`);

    // حذف صورةٍ يُبقي الأخرى: الشريط يختفي والصورة الكبيرة تبقى.
    await page.locator('.ev-thumb-btn').first().click();
    await page.waitForSelector('#modal.on .cv-strip button', { timeout: 8000 });
    await page.locator('#modal.on [data-action="cv-photo-del"]').click();
    const deleted = await page.waitForFunction(
      () => !!document.querySelector('#modal.on #cv-main') && !document.querySelector('#modal.on .cv-strip'),
      null, { timeout: 15000 },
    ).then(() => true, () => false);
    if (!deleted) fail('delete photo', 'بعد حذف صورةٍ لم تبقَ الأخرى وحدها بلا شريط');

    // ── التصحيح: الاسم يُصلَح، والقطاع يُختار — وكلاهما يظهر في الجدول بعد الحفظ ──
    await page.fill('#modal.on #cv-person_name', 'سارة القحطاني');
    if (!(await page.locator('#modal.on #cv-sector').count())) throw new Error('حقل «القطاع المعني» غائب عن نافذة المراجعة');
    await page.selectOption('#modal.on #cv-sector', { index: 1 });
    const secName = ((await page.locator('#modal.on #cv-sector option').nth(1).textContent()) || '').trim();
    await page.click('[data-action="ev-card-save"]');
    await page.waitForFunction(() => /سارة القحطاني/.test(document.body.textContent || ''), null, { timeout: 10000 });
    const sectorShown = await page.waitForFunction(
      (n) => {
        const td = document.querySelector('tr[data-contact] td[data-label="القطاع"]');
        return !!td && td.textContent.trim() === n;
      }, secName, { timeout: 10000 },
    ).then(() => true, () => false);
    if (!sectorShown) {
      const cell = await page.locator('tr[data-contact] td[data-label="القطاع"]').first().textContent().catch(() => null);
      fail('sector cell', `عمود «القطاع» يعرض «${(cell || '').trim()}» بدل «${secName}»`);
    }

    const of = await overflowOf(page);
    if (of.doc > 1 || of.main > 1) fail('overflow', `فيض أفقي: doc ${of.doc}px / main ${of.main}px`);

    // زميلٌ لم يلتقط البطاقة يملك التعديل: يرى الحقول وزرّ إضافة صورة (v5.67).
    const ctx3 = await browser.newContext({ viewport: VIEWPORT });
    const p3 = await ctx3.newPage();
    await login(p3, base, 'demo.consultant');
    await open(p3, base, `/app/event/${encodeURIComponent(id)}?tab=contacts`);
    await p3.locator('.ev-thumb-btn').first().click();
    await p3.waitForSelector('#modal.on .cv-img', { timeout: 8000 });
    if (!(await p3.locator('#modal.on #cv-form').count())) fail('staff edit', 'زميلٌ يملك التعديل لا يرى حقول التصحيح');
    if (!(await p3.locator('#modal.on [data-action="cv-photo-add"]').count())) fail('staff add', 'زميلٌ يملك التعديل لا يرى «أضف صورة»');
    await ctx3.close();

    // المشاهد: النافذة تُفتح للقراءة بلا حقول ولا زرّ حفظ ولا أزرار صور.
    const ctx2 = await browser.newContext({ viewport: VIEWPORT });
    const p2 = await ctx2.newPage();
    await login(p2, base, 'demo.viewer');
    await open(p2, base, `/app/event/${encodeURIComponent(id)}?tab=contacts`);
    await p2.locator('.ev-thumb-btn').first().click();
    await p2.waitForSelector('#modal.on .cv-img', { timeout: 8000 });
    if (await p2.locator('#modal.on #cv-form').count()) fail('viewer edit', 'المشاهد يرى حقول التعديل');
    if (await p2.locator('#modal.on [data-action="ev-card-save"]').count()) fail('viewer save', 'المشاهد يرى زرّ الحفظ');
    if (await p2.locator('#modal.on [data-action="cv-photo-add"]').count()) fail('viewer add', 'المشاهد يرى زرّ إضافة صورة');
    if (await p2.locator('#modal.on [data-action="cv-photo-del"]').count()) fail('viewer delete', 'المشاهد يرى زرّ حذف الصورة');
    await ctx2.close();

    if (!bad) t.pass('events-card-review @390px — معرض صور البطاقة (إضافةً وتبديلاً وحذفاً)، شارة العدد، القطاع في النافذة والجدول، والمشاهد يقرأ فقط');
  } catch (e) {
    fail('flow', e.message);
  }
  const realErrs = realConsoleErrors(consoleErrors);
  if (realErrs.length) fail('console', realErrs.slice(0, 3).join(' | '));
  if (pageErrors.length) fail('pageerror', pageErrors.slice(0, 3).join(' | '));
  await ctx.close();
}
