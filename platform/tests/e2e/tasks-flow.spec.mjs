// تدفّق المهام كما يعيشه المستخدم — لا كما يبدو في الوسوم.
//
// ثلاث شكاوى صريحة من المالك تُغلقها هذه الحارة، وكلٌّ منها كانت تمرّ على كل فحوصنا السابقة
// لأنها لا تُرى إلا بالتشغيل الفعلي على متصفّح:
//
//   ١) «ما اقدر اشوف او اضغط على الموظف يطلعلي تفاصيله وصفحته» — الاسم في لوحة الفريق كان
//      يربط إلى مُرشِّح يعيد اللوحة نفسها، فيبدو قابلاً للنقر ولا يفتح شيئاً.
//   ٢) «طريقه اضافه المهام … احسه سيءه» — الإضافة تنجح، ثم **تختفي المهمة**: النافذة الافتراضية
//      «اليوم»، ومهمةٌ بلا موعد ليست فيها. رسالة نجاح وقائمة لم تتغيّر.
//   ٣) «احسه مره زحمه» — ستة أشرطة تسبق أول مهمة على الشاشة. الأشرطة الثقيلة صارت خلف زرَّين.
//
// وحارسٌ رابع للنسخة العربية: حالة المهمة المعطَّلة كانت تُعرَض «حُجبت — عنوان غير مسموح»،
// وهي جملةٌ عن **رسالة بريد** منعها حارس العناوين — تسرّبت إلى المهام من مفتاح مكرَّر في جدول
// التسميات المسطَّح (يفوز فيه الأخير صامتاً).
import { login, open } from './_helpers.mjs';

export default async function tasksFlowSpec({ browser, base, t }) {
  // مُبلِّغ الحزمة يعرف pass/fail وحدهما — هذه غلافٌ يجعل كل تحقّق سطراً واحداً.
  const check = (name, ok, detail) => (ok ? t.pass(name) : t.fail(name, detail));

  // ── ١) الاسم في لوحة الفريق يفتح صفحة الشخص ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, base, 'demo.sectorlead');
    await open(page, base, '/app/tasks?who=team');

    // بطاقة الشخص تقول **على ماذا** يعمل لا كم يبلغ: أسماء الفرص قابلةً للفتح، والقيمة أثرٌ
    // تابع لا عنوان. («مو المبالغ اللي شغال عليها من فرص انما اسماء الفرص» — بلسان المالك.)
    const cardOpps = await page.evaluate(() => {
      const links = [...document.querySelectorAll('.wp a.wp-tag[href^="/app/opportunity/"]')];
      return { named: links.length, sample: (links[0]?.textContent || '').trim().slice(0, 40) };
    });
    check('بطاقة الشخص على اللوحة تعرض أسماء فرصه لا عددها وحده', cardOpps.named > 0,
      JSON.stringify(cardOpps));

    // تُجمَع الروابط **قبل** مغادرة اللوحة: بعد فتح صفحة شخصٍ لا يبقى على الصفحة رابطُ شخصٍ آخر.
    const links = (await page.locator('a.wp-n').evaluateAll((els) => els.map((e) => e.getAttribute('href')))).slice(0, 8);
    const mine = await page.locator('.wc-tab-me').getAttribute('href').catch(() => null);
    check('لكل مستخدم مدخلٌ إلى صفحته من شاشة المهام', !!mine && /^\/app\/person\//.test(mine), `href=${mine}`);
    const href = links[0] || null;
    check('اسم الشخص على لوحة الفريق يربط إلى صفحته لا إلى مُرشِّح',
      !!href && /^\/app\/person\//.test(href), `href=${href}`);

    if (href) {
      const res = await open(page, base, href);
      check('صفحة الشخص تُفتح', res && res.status() === 200, `HTTP ${res?.status()}`);
      const seen = await page.evaluate(() => {
        const txt = document.body.innerText || '';
        return {
          tasks: txt.includes('المهام المفتوحة'),
          projects: txt.includes('المشاريع'),
          stats: document.querySelectorAll('.pp-stat').length,
        };
      });
      check('صفحة الشخص تعرض مهامه', seen.tasks, JSON.stringify(seen));
      check('وتعرض مشاريعه', seen.projects, JSON.stringify(seen));
      check('ومعها عدّادات حالته', seen.stats >= 4, `عدّادات=${seen.stats}`);
    }

    // الفرصة **باسمها** لا بعددها. والفحص لا يفترض أن أول شخص على اللوحة يملك فرصة — يبحث
    // عمّن يملكها: الخاصيّة المطلوبة أن **من يملك فرصةً تُعرَض فرصته باسمٍ يُفتح**، لا أن
    // صاحب البطاقة الأولى بعينه يملك واحدة. (ربط الفحص بترتيب اللوحة يجعله يسقط على بيانات.)
    let named = null;
    for (const l of links) {
      await open(page, base, l);
      const hit = await page.evaluate(() => {
        const a = document.querySelector('.pp-list a[href^="/app/opportunity/"]');
        return a ? (a.textContent || '').trim().slice(0, 40) : null;
      });
      if (hit) { named = hit; break; }
    }
    check('من يملك فرصةً تظهر فرصته على صفحته باسمها قابلةً للفتح', !!named,
      `فُتحت ${links.length} صفحة شخص ولم تُعرض فرصة باسمها في أيٍّ منها`);
    await ctx.close();
  }

  // ── ٢) الإضافة: خلف زرّ، وتُظهر ما أُضيف ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, base, 'demo.consultant');
    await open(page, base, '/app/tasks');

    const closedAtRest = !(await page.locator('#qa-title').isVisible().catch(() => false));
    check('نموذج الإضافة مطويّ ولا يشغل الشاشة قبل طلبه', closedAtRest);

    await page.click('.wc-add-sum');
    const openedOnClick = await page.locator('#qa-title').isVisible();
    check('ويُفتح بالضغط على «مهمة جديدة»', openedOnClick);

    if (openedOnClick) {
      // بلا موعد عمداً — وهي بالضبط الحالة التي كانت تختفي بعد الإضافة.
      const title = 'مهمة فحص التدفّق ' + (await page.evaluate(() => document.title.length + '' + window.performance.now().toFixed(0)));
      await page.fill('#qa-title', title);
      await page.click('[data-action="task-add"]');
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1200);
      const shown = await page.evaluate((n) => (document.body.innerText || '').includes(n), title);
      check('المهمة المُضافة بلا موعد تظهر على الشاشة بعد الإضافة', shown,
        'أُنشئت ثم لم تُعرض — النافذة الافتراضية لا تسعها');
    }
    await ctx.close();
  }

  // ── ٣) الازدحام: المرشّحات الأحد عشر خلف زرّ ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, base, 'demo.consultant');
    await open(page, base, '/app/tasks');
    const chipsHidden = await page.evaluate(() => {
      const d = document.querySelector('details.wc-filters');
      if (!d) return null;
      return { closed: !d.open, chips: d.querySelectorAll('.chip').length };
    });
    check('شريط المرشّحات مطويّ افتراضياً', chipsHidden && chipsHidden.closed, JSON.stringify(chipsHidden));
    check('ومرشّحاته موجودة داخله لا محذوفة', (chipsHidden?.chips || 0) >= 8, JSON.stringify(chipsHidden));

    // ويُفتح تلقائياً متى كان مرشّحٌ سارياً — فلا تختفي حالةٌ مفعَّلة عن عين صاحبها.
    await open(page, base, '/app/tasks?status=BLOCKED');
    const openWhenActive = await page.evaluate(() => !!document.querySelector('details.wc-filters')?.open);
    check('ويُفتح من نفسه حين يكون مرشّحٌ مفعَّلاً', openWhenActive);
    await ctx.close();
  }

  // ── ٤) نسخة الحالة: «مُعطَّل» لا «حُجبت — عنوان غير مسموح» ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, base, 'demo.admin');
    await open(page, base, '/app/tasks?who=team&win=all');
    const txt = await page.evaluate(() => document.body.innerText || '');
    check('لا تسرّب لنصّ حالة البريد إلى شاشة المهام',
      !txt.includes('عنوان غير مسموح'), 'ظهرت جملة حجب البريد على شاشة المهام');
    await ctx.close();
  }
}
