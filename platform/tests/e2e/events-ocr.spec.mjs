// القارئ داخل المتصفح (٣٩٠×٨٤٤): كل طلبٍ يخرج عن أصل سند يُرفض ويُسجَّل — فإن قرأ القارئ
// البطاقة فقد قرأها من ملفّات التوريد وحدها. تُرفع صورة بطاقةٍ ثابتة (fixtures/business-card.png)
// فيُملأ الجوّال والبريد من نصّ القراءة، ويظهر النصّ في حقل اللصق، ولا خطأ في المتصفح.
import { resolve } from 'node:path';
import { login, open, collectErrors, realConsoleErrors } from './_helpers.mjs';
import { createEvent, overflowOf } from './events-capture.spec.mjs';

const VIEWPORT = { width: 390, height: 844 };
const VENDOR = '/static/vendor/tesseract-5.1.1/';

export default async function eventsOcrSpec({ browser, base, t, platformRoot }) {
  const t0 = Date.now();
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const offOrigin = [];
  const vendorHits = [];
  // يُثبَّت على السياق كله (لا الصفحة وحدها) كي يلتقط ما يطلبه عامل القارئ أيضاً.
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (/^https?:/i.test(url) && !url.startsWith(base)) { offOrigin.push(url); return route.abort(); }
    if (url.includes(VENDOR)) vendorHits.push(url);
    return route.continue();
  });
  const page = await ctx.newPage();
  const { consoleErrors, pageErrors } = collectErrors(page);
  let bad = 0;
  const fail = (n, d) => { bad++; t.fail(`events-ocr ${n}`, d); };
  const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  try {
    await login(page, base, 'demo.sectorlead');
    const id = await createEvent(page, 'فعالية فحص القارئ');
    const res = await open(page, base, `/app/event/${encodeURIComponent(id)}?tab=capture`);
    if (!res || res.status() !== 200) throw new Error(`صفحة الفعالية HTTP ${res?.status()}`);
    await page.waitForSelector('#ev-photo', { state: 'attached' });

    // التجهيز المبكر: القارئ يصير «جاهزاً» من ملفّات التوريد وحدها
    const ready = await page.waitForSelector('[data-ocr-state="ready"]', { timeout: 90000 }).then(() => true, () => false);
    const stateNow = await page.evaluate(() => { const el = document.querySelector('[data-ocr-status]'); return el ? `${el.getAttribute('data-ocr-state')}: ${el.textContent}` : 'لا شارة'; });
    if (!ready) throw new Error(`القارئ لم يصبح جاهزاً خلال ٩٠ ثانية — الحالة: ${stateNow}`);
    const tReady = stamp();

    // صورة بطاقة ثابتة ⟵ قراءة ⟵ تعبئة الجوّال والبريد
    await page.setInputFiles('#ev-photo', resolve(platformRoot, 'tests/e2e/fixtures/business-card.png'));
    const recognized = await page.waitForFunction(() => {
      const v = (id) => ((document.getElementById(id) || {}).value || '').trim();
      const digits = v('ev-phone').replace(/\D/g, '');
      return (digits.includes('966501234567') || digits.includes('0501234567')) && v('ev-email') === 'sara.alqahtani@example.com';
    }, null, { timeout: 90000 }).then(() => true, () => false);
    const after = await page.evaluate(() => ({
      phone: document.getElementById('ev-phone').value, email: document.getElementById('ev-email').value,
      paste: document.getElementById('ev-paste').value,
      state: (document.querySelector('[data-ocr-status]') || {}).textContent || '',
      meta: (document.getElementById('ev-photo-meta') || {}).textContent || '',
      preview: !(document.getElementById('ev-photo-prev') || {}).hidden,
    }));
    if (!recognized) fail('recognize', `الحقول بعد القراءة: جوّال "${after.phone}" بريد "${after.email}" — الحالة: ${after.state} — النصّ: ${after.paste.slice(0, 120).replace(/\n/g, ' ⏎ ')}`);
    if (!after.paste.includes('sara.alqahtani@example.com')) fail('paste text', `حقل اللصق لا يحوي البريد: ${after.paste.slice(0, 160).replace(/\n/g, ' ⏎ ')}`);
    if (!/كيلوبايت/.test(after.meta)) fail('photo meta', `سطر الصورة: "${after.meta}"`);
    if (!after.preview) fail('preview', 'المعاينة لم تظهر بعد اختيار الصورة');
    const tRead = stamp();

    if (vendorHits.length < 5) fail('vendor requests', `${vendorHits.length} طلبات فقط على ${VENDOR} (المتوقّع ٥ فأكثر): ${vendorHits.map((u) => u.split('?')[0].slice(base.length)).join(', ')}`);
    if (offOrigin.length) fail('off-origin', `طلبات خرجت عن أصل سند: ${offOrigin.slice(0, 5).join(' | ')}`);
    const of = await overflowOf(page);
    if (of.doc > 1 || of.main > 1) fail('overflow', `فيض أفقي: doc ${of.doc}px / main ${of.main}px`);
    if (!bad) t.pass(`events-ocr @390px — reader ready at ${tReady}, card read at ${tRead}, ${vendorHits.length} vendor requests, 0 off-origin`);
  } catch (e) {
    fail('flow', e.message);
  }
  const realErrs = realConsoleErrors(consoleErrors);
  if (realErrs.length) fail('console', realErrs.slice(0, 3).join(' | '));
  if (pageErrors.length) fail('pageerror', pageErrors.slice(0, 3).join(' | '));
  await ctx.close();
}
