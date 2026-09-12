// الالتقاط في الجناح من جوّال (٣٩٠×٨٤٤): قائد قطاع ينشئ فعاليةً جاريةً اليوم، يفتح تبويب
// الالتقاط، يلصق نصّ بطاقة ويملأ الحقول منه، ثم يحفظ — والصفحة لا تُعاد (الحارس على body
// يبقى)، والصفّ الجديد يتصدّر «آخر ما التقطت»، والتنبيه يظهر، ولا فيض أفقي ولا أخطاء.
import { login, open, collectErrors, realConsoleErrors } from './_helpers.mjs';

const VIEWPORT = { width: 390, height: 844 };
const CARD_TEXT = [
  'Sara Alqahtani', 'Head of Procurement', 'Alnoor Trading Co.',
  'Mobile: +966 50 123 4567', 'sara.alqahtani@example.com', 'www.alnoor.example.com',
].join('\n');

// فعاليةٌ تمتدّ من الأمس إلى الغد فتكون «جارية» أياً كان يومُ الخادم (يوم الرياض قد يسبق يوم غرينتش).
const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// الإنشاء عبر واجهة الخدمة بجلسة المتصفح نفسها — حتمي، ولا يعتمد على نافذةٍ قد تتغيّر.
export async function createEvent(page, name) {
  return page.evaluate(async ({ name, from, to }) => {
    const r = await fetch('/api/events', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ name_ar: name, venue: 'قاعة الفحص', starts_on: from, ends_on: to, booth_no: 'A1' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`إنشاء الفعالية ${r.status}: ${(j.error && j.error.message) || ''}`);
    return j.id || (j.event && j.event.id);
  }, { name, from: dayOffset(-1), to: dayOffset(1) });
}

export const overflowOf = (page) => page.evaluate(() => ({
  doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  main: (() => { const m = document.querySelector('main'); return m ? m.scrollWidth - m.clientWidth : 0; })(),
}));

export default async function eventsCaptureSpec({ browser, base, t }) {
  const t0 = Date.now();
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const { consoleErrors, pageErrors } = collectErrors(page);
  let bad = 0;
  const fail = (n, d) => { bad++; t.fail(`events-capture ${n}`, d); };
  try {
    await login(page, base, 'demo.sectorlead');
    const id = await createEvent(page, 'فعالية فحص الالتقاط');
    if (!id) throw new Error('لم يُعد الخادم معرّف الفعالية');

    const res = await open(page, base, `/app/event/${encodeURIComponent(id)}?tab=capture`);
    if (!res || res.status() !== 200) throw new Error(`صفحة الفعالية HTTP ${res?.status()}`);
    await page.waitForSelector('#ev-form');

    // التعبئة من النصّ الملصوق — الجوّال والبريد يُملآن من الخادم (parse-card)
    await page.fill('#ev-paste', CARD_TEXT);
    await page.click('[data-action="ev-parse"]');
    await page.waitForFunction(() => {
      const v = (id) => (document.getElementById(id) || {}).value || '';
      return v('ev-phone').trim() && v('ev-email').trim();
    }, null, { timeout: 15000 }).catch(() => {});
    const filled = await page.evaluate(() => ({
      phone: document.getElementById('ev-phone').value, email: document.getElementById('ev-email').value,
      name: document.getElementById('ev-name').value,
    }));
    if (!/966501234567|0501234567/.test(filled.phone.replace(/\D/g, ''))) fail('parse phone', `#ev-phone = "${filled.phone}"`);
    if (filled.email !== 'sara.alqahtani@example.com') fail('parse email', `#ev-email = "${filled.email}"`);

    // الحفظ: لا إعادة تحميل — حارسٌ على body يبقى، والصفّ يتصدّر القائمة، والتنبيه يظهر
    await page.evaluate(() => document.body.setAttribute('data-e2e-sentinel', 'alive'));
    await page.click('[data-action="ev-save"]');
    const saved = await page.waitForFunction(() => {
      const first = document.querySelector('#ev-recent .ev-rc');
      return !!(first && /Sara Alqahtani/.test(first.textContent || ''));
    }, null, { timeout: 15000 }).then(() => true, () => false);
    if (!saved) fail('recent row', 'الصفّ الجديد لم يتصدّر #ev-recent خلال ١٥ ثانية');
    const sentinel = await page.evaluate(() => document.body.getAttribute('data-e2e-sentinel'));
    if (sentinel !== 'alive') fail('no navigation', 'الصفحة أُعيد تحميلها بعد الحفظ — الحارس على body ضاع');
    const toastVisible = await page.locator('[role="status"]', { hasText: 'حُفظت' }).first().isVisible().catch(() => false);
    if (!toastVisible) fail('toast', 'تنبيه «حُفظت البطاقة» لم يظهر');
    const cleared = await page.evaluate(() => !document.getElementById('ev-name').value && !document.getElementById('ev-paste').value);
    if (!cleared) fail('form reset', 'النموذج لم يُفرَّغ للبطاقة التالية');
    const teamToday = await page.evaluate(() => Number((document.getElementById('ev-team-today') || {}).textContent || 0));
    if (teamToday < 1) fail('team today', `عدّاد «التقط الفريق اليوم» = ${teamToday}`);

    const of = await overflowOf(page);
    if (of.doc > 1) fail('overflow', `المستند يفيض أفقياً ${of.doc}px عند ٣٩٠`);
    if (of.main > 1) fail('overflow main', `المحتوى يفيض عن main بـ${of.main}px عند ٣٩٠`);

    // تبويب الجهات الملتقطة يعرض البطاقة المحفوظة — ولا فيض هناك أيضاً
    await open(page, base, `/app/event/${encodeURIComponent(id)}?tab=contacts`);
    const inList = await page.evaluate(() => /Sara Alqahtani/.test((document.getElementById('ev-panel-contacts') || {}).textContent || ''));
    if (!inList) fail('contacts tab', 'البطاقة المحفوظة لا تظهر في تبويب الجهات الملتقطة');
    const of2 = await overflowOf(page);
    if (of2.doc > 1 || of2.main > 1) fail('overflow contacts', `فيض أفقي في تبويب الجهات: doc ${of2.doc}px / main ${of2.main}px`);
  } catch (e) {
    fail('flow', e.message);
  }
  const realErrs = realConsoleErrors(consoleErrors);
  if (realErrs.length) fail('console', realErrs.slice(0, 3).join(' | '));
  if (pageErrors.length) fail('pageerror', pageErrors.slice(0, 3).join(' | '));
  if (!bad) t.pass(`events-capture @390px — paste→fill→save without reload, row on top, toast, no overflow (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  await ctx.close();
}
