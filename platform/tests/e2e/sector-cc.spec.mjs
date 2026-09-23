// «مركز القطاع» في متصفّحٍ حقيقي — الشاشة الواحدة (v6.10).
//
// ما لا يقيسه فحصُ وسمٍ ولا فحصُ وحدة، ويُقاس هنا وحده:
//   ١) **الصفحة تُقلع فعلاً**: `#ccBand` يحمل الشريط المرسوم لا الجدولَ الاحتياطي المُصيَّر
//      على الخادم. حزمةٌ تصل ولا تُرسم = شاشةٌ ميّتة تمرّ على كل فحص نصّي وهي مطمئنة.
//   ٢) **سحبُ الأشهر بالمؤشّر** يغيّر الفترة والرابط والشريط معاً — سلوكٌ لا وجود له إلا في
//      محرّك أحداثٍ حيّ (pointerdown/move/up + elementFromPoint).
//   ٣) **لوحة المفاتيح ندٌّ للمؤشّر**: Shift+سهم يمدّ المدى من المرساة.
//   ٤) **Escape يُرجع التركيز** من القائمة المنبثقة ومن اللوحة الجانبية إلى ما فُتحت منه —
//      وإلا ضاع مستعملُ لوحة المفاتيح في صفحةٍ لا يعرف أين هو منها.
//   ٥) **لا فيض أفقي** على أربعة عروض، للمستند و`main` معاً (KI-137: الفيض داخل `main` لا
//      يُزحزح المستند، فيراه القارئ على هاتفه ولا يراه قياسُ المستند).
import { login, open, collectErrors, realConsoleErrors } from './_helpers.mjs';

const WIDTHS = [1440, 1100, 760, 390];
const USER = 'demo.sectorlead';

const monthsInUrl = (url) => {
  const q = new URL(url).searchParams;
  const ms = q.get('months');
  if (ms) return ms.split(',').map(Number).filter((n) => n >= 1 && n <= 12).sort((a, b) => a - b);
  const p = String(q.get('p') || '');
  const range = /^m(\d{1,2})-m(\d{1,2})$/.exec(p);
  if (range) {
    const out = [];
    for (let i = +range[1]; i <= +range[2]; i++) out.push(i);
    return out;
  }
  const one = /^m(\d{1,2})$/.exec(p);
  return one ? [+one[1]] : [];
};

export default async function sectorCcSpec({ browser, base, t }) {
  const check = (name, ok, detail) => (ok ? t.pass(name) : t.fail(name, detail));

  // ── الإقلاع والسحب ولوحة المفاتيح واللوحات — على العرض الكامل ──────────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    const { consoleErrors, pageErrors } = collectErrors(page);
    await login(page, base, USER);
    const res = await open(page, base, '/app/sector');
    if (!res || res.status() !== 200) {
      t.fail('مركز القطاع يُفتح', `HTTP ${res?.status()}`);
      await ctx.close();
      return;
    }
    await page.waitForSelector('#ccMonths button[data-m]', { timeout: 10000 }).catch(() => {});

    // (١) الشريط مرسومٌ من الحزمة لا مُصيَّراً احتياطياً
    const painted = await page.evaluate(() => {
      const band = document.getElementById('ccBand');
      return {
        has: !!band,
        fallback: !!band?.querySelector('table.pl'),
        cells: band ? band.querySelectorAll('.sc, .sbar7 > *, [data-go]').length : 0,
        text: band ? (band.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) : '',
        fbar: !!document.querySelector('#fbar #ccMonths button[data-m]'),
      };
    });
    check('الشريط مرسومٌ في المتصفّح لا الجدول الاحتياطي', painted.has && !painted.fallback && painted.cells > 0,
      `fallback=${painted.fallback} cells=${painted.cells}`);
    check('شريط المرشِّحات مبنيٌّ بأشهره', painted.fbar, 'لا أزرار أشهر في #fbar');

    // (٢) سحبُ المؤشّر من مارس إلى يونيو
    const before = await page.evaluate(() => (document.getElementById('ccMeta')?.textContent || '')
      .replace(/\s+/g, ' ').trim());
    const box = async (m) => page.locator(`#ccMonths button[data-m="${m}"]`).boundingBox();
    const [a, b] = [await box(3), await box(6)];
    if (!a || !b) {
      t.fail('سحبُ الأشهر بالمؤشّر', 'زرّا مارس ويونيو غير موجودين');
    } else {
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      // خطواتٌ متتابعة: المحرّك يقرأ العنصر تحت المؤشّر في كل حركة، فقفزةٌ واحدة لا تكفي
      for (const m of [4, 5, 6]) {
        const bb = await box(m);
        await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 3 });
      }
      await page.mouse.up();
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => ({
        url: location.href,
        pressed: [...document.querySelectorAll('#ccMonths button[data-m]')]
          .filter((el) => el.getAttribute('aria-pressed') === 'true').map((el) => +el.dataset.m),
        meta: (document.getElementById('ccMeta')?.textContent || '').replace(/\s+/g, ' ').trim(),
        bandPainted: !!document.getElementById('ccBand')?.querySelector('[data-go]'),
      }));
      check('السحب من مارس إلى يونيو يختار الأشهر الأربعة',
        after.pressed.join(',') === '3,4,5,6', `المختار: ${after.pressed.join(',') || 'لا شيء'}`);
      check('والرابط يحمل الفترة نفسها',
        monthsInUrl(after.url).join(',') === '3,4,5,6', `الرابط: ${new URL(after.url).search}`);
      // الشاشة أُعيد رسمها فعلاً: سطرُ المرشِّحات يقول الفترة الجديدة بلفظها، والشريط ما زال
      // مرسوماً بعد إعادة الرسم. (أرقامُ الشريط نفسها لا تتحرّك على بذرة العرض: لا شهرَ مالياً
      // مغلقاً فيها، فكلُّ سطرٍ «لم يُسجَّل» أيّاً كانت الفترة — والادّعاء بغير ذلك فحصٌ كاذب.)
      check('والشاشة أُعيد رسمها على الفترة الجديدة',
        after.meta !== before && /مارس/.test(after.meta) && /يونيو/.test(after.meta) && after.bandPainted,
        `سطر المرشِّحات — قبل: «${before}» / بعد: «${after.meta}» · الشريط مرسوم=${after.bandPainted}`);
    }

    // (٣) لوحة المفاتيح: Shift+سهم يمدّ من المرساة
    const kb = await page.evaluate(() => {
      const el = document.querySelector('#ccMonths button[data-m="8"]');
      el.tabIndex = 0; el.focus();
      return document.activeElement === el;
    });
    if (!kb) {
      t.fail('لوحة المفاتيح على شريط الأشهر', 'لم يُضبط التركيز على زرّ شهر');
    } else {
      await page.keyboard.press('Space');            // يُرسي المرساة على أغسطس
      await page.waitForTimeout(150);
      await page.keyboard.press('Shift+ArrowLeft');  // اليسار يتقدّم في الأشهر العربية
      await page.waitForTimeout(200);
      const ext = await page.evaluate(() => [...document.querySelectorAll('#ccMonths button[data-m]')]
        .filter((el) => el.getAttribute('aria-pressed') === 'true').map((el) => +el.dataset.m));
      check('Shift+سهم يمدّ المدى من المرساة',
        ext.includes(8) && ext.includes(9) && ext.length >= 2, `المختار بعد المدّ: ${ext.join(',')}`);
    }

    // (٤أ) القائمة المنبثقة: تُفتح، وEscape يُرجع التركيز إلى زرّها
    const popBtn = page.locator('[data-dim="depts"]');
    if (await popBtn.count()) {
      await popBtn.focus();
      await popBtn.click();
      await page.waitForTimeout(200);
      const opened = await page.evaluate(() => ({
        expanded: document.querySelector('[data-dim="depts"]')?.getAttribute('aria-expanded'),
        dialog: !!document.querySelector('.pop[role="dialog"], .pop'),
      }));
      check('قائمة الإدارات تُفتح ومعلَنٌ فتحُها', opened.expanded === 'true' && opened.dialog,
        `aria-expanded=${opened.expanded} dialog=${opened.dialog}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const back = await page.evaluate(() => ({
        expanded: document.querySelector('[data-dim="depts"]')?.getAttribute('aria-expanded'),
        focused: document.activeElement === document.querySelector('[data-dim="depts"]'),
      }));
      check('وEscape يغلقها ويُرجع التركيز إلى زرّها', back.expanded !== 'true' && back.focused,
        `aria-expanded=${back.expanded} focus=${back.focused}`);
    } else {
      t.fail('قائمة الإدارات', 'زرّ الإدارات غير موجود في الشريط');
    }

    // (٤ب) لوحةُ المشروع تُفتح من صفّه، وEscape تُغلقها وتُرجع التركيز
    const row = page.locator('#cPrj [data-go*="\\"prj\\""]').first();
    if (await row.count()) {
      await row.focus().catch(() => {});
      await row.click();
      await page.waitForSelector('#drawer[aria-hidden="false"], #drawer.open', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
      const open2 = await page.evaluate(() => {
        const d = document.getElementById('drawer');
        return { present: !!d, shown: !!d && d.getAttribute('aria-hidden') !== 'true' && d.offsetWidth > 0,
          modal: d?.getAttribute('aria-modal'), inside: !!d && d.contains(document.activeElement) };
      });
      check('لوحة المشروع تُفتح من صفّه ويُحبس التركيز داخلها',
        open2.shown && open2.inside, `shown=${open2.shown} focusInside=${open2.inside} modal=${open2.modal}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(350);
      const closed = await page.evaluate(() => {
        const d = document.getElementById('drawer');
        return { shown: !!d && d.getAttribute('aria-hidden') !== 'true' && d.offsetWidth > 0,
          onRow: !!document.activeElement?.closest?.('#cPrj') };
      });
      check('وEscape تُغلقها ويعود التركيز إلى الصفّ', !closed.shown && closed.onRow,
        `shown=${closed.shown} focusBackOnRow=${closed.onRow}`);
    } else {
      t.fail('لوحة المشروع', 'لا صفَّ مشروعٍ في بطاقة المشاريع');
    }

    const errs = realConsoleErrors(consoleErrors);
    check('بلا خطأ في سجلّ المتصفّح', errs.length === 0 && pageErrors.length === 0,
      [...errs, ...pageErrors].slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── (٥) لا فيض أفقي على أربعة عروض ─────────────────────────────────────────────────────
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    await login(page, base, USER);
    const res = await open(page, base, '/app/sector?months=3,4,5,6');
    if (!res || res.status() !== 200) { t.fail(`مركز القطاع @${width}`, `HTTP ${res?.status()}`); await ctx.close(); continue; }
    await page.waitForSelector('#ccMonths button[data-m]', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(200);
    const of = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main: (() => { const m = document.querySelector('main'); return m ? m.scrollWidth - m.clientWidth : 0; })(),
    }));
    check(`بلا فيض أفقي @${width}`, of.doc <= 1 && of.main <= 1,
      `المستند ${of.doc}px · main ${of.main}px`);
    await ctx.close();
  }
}
