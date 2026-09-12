// «صفحتي» على متصفّح حقيقي: هي أول ما يراه كل موظف، فأي عطل فيها عطلٌ في أول انطباع.
//
// أربعة أشياء لا تُثبت إلا هنا:
//   ١) الدخول يهبط عليها فعلاً — لا على شاشةٍ أخرى ولا على «خارج صلاحياتك».
//   ٢) التقويم يتصفّح الشهور بروابط، أي **بلا جافاسكربت** — فيعمل ولو تعطّل النص البرمجي.
//   ٣) الميلان ثلاثي الأبعاد يعمل بالمؤشر، ويسكن حين يُطلب تقليل الحركة.
//   ٤) لا خطأ في وحدة تحكّم المتصفح ولا تجاوز أفقي على الجوال.
import { login, open, realConsoleErrors } from './_helpers.mjs';

export default async function homeSpec({ browser, base, t }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('page: ' + e.message));

  // ١) وجهة الدخول
  await login(page, base, 'demo.employee');
  const landed = new URL(page.url()).pathname;
  if (landed === '/app/home') t.pass('الدخول يهبط على «صفحتي»');
  else t.fail('وجهة الدخول', `هبط على ${landed}`);

  const res = await open(page, base, '/app/home');
  if (res?.status() === 200) t.pass('الصفحة تُفتح بحالة سليمة');
  else t.fail('فتح الصفحة', `HTTP ${res?.status()}`);

  // ٢) الأركان الأربعة موجودة فعلاً على الشاشة (لا في الوسوم وحدها)
  for (const [sel, name] of [['#hm-tilt', 'البطاقة الترحيبية'], ['.hm-tiles', 'بطاقات الخلاصة'],
    ['#hm-due', 'طابور «أمامك الآن»'], ['.cal-g', 'شبكة التقويم']]) {
    const seen = await page.locator(sel).first().isVisible().catch(() => false);
    if (seen) t.pass(`${name} ظاهرة`);
    else t.fail(name, `العنصر ${sel} غير ظاهر`);
  }

  // التحية تحمل اسم صاحبها ويوم أسبوعه
  const said = await page.locator('.hm-hi').first().innerText().catch(() => '');
  if (said.trim().length > 5) t.pass(`عبارة اليوم تُعرض: «${said.trim().slice(0, 40)}»`);
  else t.fail('عبارة اليوم', 'فارغة');

  // ٣) التقويم يتصفّح بلا جافاسكربت — رابطٌ حقيقي يغيّر العنوان والشهر المعروض
  const before = await page.locator('.cal-h .t').first().innerText().catch(() => '');
  await page.locator('.cal-nav a').last().click();
  await page.waitForLoadState('domcontentloaded');
  const after = await page.locator('.cal-h .t').first().innerText().catch(() => '');
  if (page.url().includes('/app/home?m=') && after && after !== before) {
    t.pass(`التقويم يتصفّح بالروابط: ${before.trim()} ← ${after.trim()}`);
  } else t.fail('تصفّح التقويم', `${before} → ${after} · ${page.url()}`);

  // شهرٌ ملفَّق في العنوان لا يكسر الشاشة
  const bad = await open(page, base, '/app/home?m=2026-99&d=%2E%2E%2F');
  if (bad?.status() === 200) t.pass('عنوانٌ ملفَّق يسقط إلى شهر اليوم بهدوء');
  else t.fail('عنوان ملفَّق', `HTTP ${bad?.status()}`);

  // ٤) الميلان: يستجيب للمؤشر
  await open(page, base, '/app/home');
  const box = await page.locator('#hm-tilt').first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.7);
  await page.waitForTimeout(250);
  const tilted = await page.locator('#hm-tilt').first().evaluate((el) => el.style.getPropertyValue('--ry'));
  if (tilted && tilted !== '0deg') t.pass(`البطاقة تميل مع المؤشر (${tilted})`);
  else t.fail('الميلان ثلاثي الأبعاد', `--ry = «${tilted}»`);
  await ctx.close();

  // ومع طلب تقليل الحركة: تبقى ساكنة تماماً
  const calm = await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
  const p2 = await calm.newPage();
  await login(p2, base, 'demo.employee');
  await open(p2, base, '/app/home');
  const b2 = await p2.locator('#hm-tilt').first().boundingBox();
  await p2.mouse.move(b2.x + b2.width * 0.8, b2.y + b2.height * 0.8);
  await p2.waitForTimeout(250);
  const still = await p2.locator('#hm-tilt').first().evaluate((el) => el.style.getPropertyValue('--ry'));
  if (!still) t.pass('ومع طلب تقليل الحركة تبقى البطاقة ساكنة');
  else t.fail('تقليل الحركة', `مالت رغم الطلب (--ry = ${still})`);
  await calm.close();

  // الجوال: بلا تمرير أفقي
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p3 = await mob.newPage();
  await login(p3, base, 'demo.employee');
  await open(p3, base, '/app/home');
  const overflow = await p3.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (!overflow) t.pass('لا تمرير أفقي على الجوال');
  else t.fail('عرض الجوال', 'الصفحة أعرض من الشاشة');
  await mob.close();

  // الشاشة العريضة: محتوى البطاقة لا يلامس حوافّها (كان الإسقاط المنظوري يدفعه خارجها فوق
  // ~1920px لأن الحاشية كانت ثابتة والإزاحة تنمو مع العرض)، وشريط لون البطاقات محبوس داخلها.
  const wide = await browser.newContext({ viewport: { width: 2560, height: 1000 } });
  const p4 = await wide.newPage();
  await login(p4, base, 'demo.employee');
  await open(p4, base, '/app/home');
  const gutters = await p4.evaluate(() => {
    const skin = document.querySelector('.hm-skin')?.getBoundingClientRect();
    const date = document.querySelector('.hm-date')?.getBoundingClientRect();
    const quick = document.querySelector('.hm-quick')?.getBoundingClientRect();
    if (!skin || !date || !quick) return null;
    // RTL: بداية السطر يمين — نفحص الجانبين معاً لكل عنصر.
    return {
      dateIn: date.left >= skin.left + 4 && date.right <= skin.right - 4,
      quickIn: quick.left >= skin.left + 4 && quick.right <= skin.right - 4,
      heroW: Math.round(skin.width),
    };
  });
  if (gutters && gutters.dateIn && gutters.quickIn) t.pass(`محتوى البطاقة داخل حوافّها على الشاشة العريضة (عرضها ${gutters.heroW}px)`);
  else t.fail('حواف البطاقة العريضة', JSON.stringify(gutters));
  const tileClip = await p4.evaluate(() => {
    const tl = document.querySelector('.hm-tile');
    return tl ? getComputedStyle(tl).overflow : null;
  });
  if (tileClip === 'hidden') t.pass('شريط اللون محبوس داخل زوايا البطاقات');
  else t.fail('قصّ شريط البطاقة', `overflow=${tileClip}`);
  await wide.close();

  const real = realConsoleErrors(errs);
  if (!real.length) t.pass('بلا أخطاء في المتصفح');
  else t.fail('أخطاء المتصفح', real.slice(0, 3).join(' | '));
}
