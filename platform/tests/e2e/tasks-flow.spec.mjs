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
      // منذ v5.75 (ADR-0017): الحساب المرتبط بموظفٍ يفتحه القارئ يُحال إلى ملف المورد الموحد بتبويباته؛
      // وغير المرتبط — أو من لا يُفتح ملفه للقارئ — يبقى على صفحة الحساب المحدودة بعدّاداتها.
      const unified = /\/app\/team\/resources\//.test(page.url());
      const seen = await page.evaluate(() => {
        const txt = document.body.innerText || '';
        return {
          tasks: txt.includes('المهام المفتوحة') || txt.includes('حِمل المهام'),
          projects: txt.includes('المشاريع') || txt.includes('العمل المرتبط'),
          stats: document.querySelectorAll('.pp-stat').length,
          tabs: document.querySelectorAll('[role="tab"]').length,
        };
      });
      check(unified ? 'الرابط يحيل إلى ملف المورد الموحد بتبويباته' : 'صفحة الشخص تعرض مهامه', unified ? seen.tabs >= 3 : seen.tasks, JSON.stringify(seen));
      check('وتعرض مشاريعه/عمله المرتبط', seen.projects, JSON.stringify(seen));
      check(unified ? 'ملف المورد يعرض حِمل المهام' : 'ومعها عدّادات حالته', unified ? seen.tasks : seen.stats >= 4, unified ? JSON.stringify(seen) : `عدّادات=${seen.stats}`);
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

  // ── ٥) حفظُ التفاصيل لا يمحو جهة المهمة (KI-042 سابقاً) ──
  // مديرٌ يربط مهمةً بمشروعٍ ويسندها لموظفٍ ليس مُسكَّناً عليه: منتقي الموظف لا يحمل الجهة،
  // فكان الحفظ يرسل فراغه ويمحو الربط بصمت. الحارس: فتحُ التفاصيل والحفظ بلا تغيير يُبقيان
  // الجهة كما هي — والمنتقي يسمّيها «الجهة الحالية» بدل أن يقف فارغاً.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, base, 'demo.admin');
    await open(page, base, '/app/home');
    const made = await page.evaluate(async () => {
      const j = async (p, init) => { const r = await fetch('/api' + p, init); return r.ok ? r.json() : null; };
      const users = await j('/identity/users');
      const emp = (users || []).find((u) => u.username === 'demo.employee');
      const projects = await j('/projects');
      const prj = (projects || [])[0];
      if (!emp || !prj) return { error: 'لا موظف تجريبي أو لا مشروع في البذرة' };
      const t = await j('/tasks/quick', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'مهمة حارس الجهة', project_id: prj.id, assignee_user_id: emp.id }) });
      return t && t.id ? { taskId: t.id, projectId: prj.id } : { error: 'لم تُنشأ مهمة الحارس' };
    });
    check('تهيئة حارس الجهة: مهمة مرتبطة بمشروع باسم الموظف', !!made.taskId, JSON.stringify(made));
    await ctx.close();

    if (made.taskId) {
      const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page2 = await ctx2.newPage();
      await login(page2, base, 'demo.employee');
      await open(page2, base, '/app/tasks?win=all');
      const row = page2.locator(`[data-task="${made.taskId}"]`);
      check('المهمة المرتبطة ظاهرة في قائمة صاحبها', await row.count() > 0);
      await row.locator('[data-action="task-open"]').last().click();
      // منذ منتقي البحث: القائمة الخفيّة تحمل القيمة، والمرئيُّ حقلُ بحثٍ فوقها — فالانتظار
      // على **ما يراه المستخدم** (حقل المنتقي)، والقيمة تُقرأ من حاملها كما يقرؤها الحفظ.
      await page2.waitForSelector('#drawer [data-picker="tf-parent"] .sp-q');
      const sel = await page2.evaluate(() => {
        const s = document.querySelector('#drawer [data-f="parent"]');
        const q = document.querySelector('#drawer [data-picker="tf-parent"] .sp-q');
        const chosen = s.options[s.selectedIndex];
        return { value: s.value, initial: s.dataset.initial || '',
          current: [...s.options].some((o) => o.textContent.includes('الجهة الحالية')),
          mirrored: !!q && !!chosen && q.value.trim() === chosen.textContent.trim() && q.value.trim() !== '' };
      });
      check('منتقي الجهة يقف على جهة المهمة لا على الفراغ', sel.value === 'p:' + made.projectId, JSON.stringify(sel));
      check('والحقل المرئي يسمّي المختار — لا يقف فارغاً فوق قيمةٍ خفيّة', sel.mirrored, JSON.stringify(sel));
      await page2.locator('#drawer [data-action="task-save"]').click();
      await page2.waitForLoadState('domcontentloaded');
      await page2.waitForSelector(`[data-task="${made.taskId}"]`);
      const kept = await page2.evaluate((id) => {
        const r = document.querySelector(`[data-task="${id}"]`);
        return r ? r.dataset.project : null;
      }, made.taskId);
      check('حفظُ التفاصيل بلا تغيير يُبقي جهة المهمة كما هي', kept === made.projectId,
        `project=${kept} المتوقع=${made.projectId}`);
      await ctx2.close();
    }
  }

  // ── ٥) حالة الصفّ بعد إعادة التحميل، والبحث في منتقي الجهة ──
  // شكوى من الشاشة: مهمةٌ تُوضَع «منجز» فتظهر التالية لها منجزةً كذلك، وهي في نطاق «بانتظار
  // البدء» لم يمسّها أحد — ومن حاول إنجازها لم يستطع، فقائمتها تعرض «منجز» فلا يقع تغيير.
  // السبب أن عناصر النماذج كانت بلا اسم، فيستعيدها المتصفّح بموضعها لا بهويّتها، والمهمة
  // المنجَزة تنتقل إلى درج «أنجزتها» في آخر القائمة فتنزلق القيم صفّاً.
  //
  // ملاحظة على الحارس: متصفّح الاختبار المُشغَّل بلا واجهة لا يُفعِّل استعادة النماذج أصلاً
  // (تُحقّق من ذلك بتجربة معزولة)، فالتحقّق السلوكي وحده قد يمرّ فارغاً. لذلك الحارس الحقيقي
  // هو فحص الهويّة — يسقط لحظة يُحذف `name` من الوسم — ومعه محاكاةٌ صريحة للانزلاق تُثبت أن
  // جولة المصالحة تردّ القيمة إلى ما كتبه الخادم مهما كان الذي أزاحها.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, base, 'demo.consultant');
    await open(page, base, '/app/home');
    const seeded = await page.evaluate(async () => {
      const today = new Date().toISOString().slice(0, 10);
      const out = [];
      for (const n of ['ألف', 'باء', 'جيم']) {
        const r = await fetch('/api/tasks/quick', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'حارس الاستعادة ' + n + ' ' + Date.now(), due_date: today, priority: 'P2' }),
        });
        if (r.ok) out.push((await r.json()).id);
      }
      return out;
    });
    check('تهيئة الحارس: ثلاث مهام مستحقّة اليوم', seeded.length === 3, JSON.stringify(seeded));

    await open(page, base, '/app/tasks');
    const ident = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.tk-status, .tk-sel')];
      const ids = new Set(); let bad = 0, dupe = 0;
      for (const el of els) {
        const row = el.closest('[data-task]');
        if (!row) { bad++; continue; }
        if (!el.id || !el.name || el.id !== el.name || el.id.indexOf(row.dataset.task) < 0
            || el.getAttribute('autocomplete') !== 'off') bad++;
        if (ids.has(el.id)) dupe++;
        ids.add(el.id);
      }
      return { total: els.length, bad, dupe };
    });
    check('لكل قائمة حالة ومربّع تحديد هويّةٌ ثابتة مشتقّة من معرّف مهمّته',
      ident.total > 0 && ident.bad === 0 && ident.dupe === 0, JSON.stringify(ident));

    // محاكاة الانزلاق: تُكتب «منجز» على قائمة الصفّ الثاني بلا حدث تغيير — كما تفعل الاستعادة
    // تماماً — ويُحدَّد مربّعه. جولة المصالحة تردّ الاثنين إلى ما يقوله الخادم.
    const settled = await page.evaluate(() => {
      const sels = [...document.querySelectorAll('.tk-status')];
      if (sels.length < 2) return { skip: true };
      sels[1].value = 'DONE';
      document.querySelectorAll('.tk-sel')[1].checked = true;
      const drifted = sels[1].value !== sels[1].closest('[data-task]').dataset.status;
      window.dispatchEvent(new Event('pageshow'));
      const s = document.querySelectorAll('.tk-status')[1];
      return { drifted, shown: s.value, server: s.closest('[data-task]').dataset.status,
        ghosts: document.querySelectorAll('.tk-sel:checked').length };
    });
    check('قيمةٌ منزلقة على صفٍّ لم يتغيّر تُردّ إلى حالته المكتوبة',
      settled.skip || (settled.drifted && settled.shown === settled.server), JSON.stringify(settled));
    check('ولا يبقى تحديدٌ جماعي شبحيّ يعبر إعادة التحميل',
      settled.skip || settled.ghosts === 0, JSON.stringify(settled));

    // والتدفّق الحقيقي: إنجاز أول مهمة لا يترك أي قائمةٍ تخالف صفّها
    const first = page.locator('.tk-status').first();
    if (await first.count()) {
      await first.selectOption('DONE');
      await page.waitForLoadState('load');
      await page.waitForTimeout(1200);
      await page.waitForSelector('.tk-status');
      const drift = await page.evaluate(() => [...document.querySelectorAll('.tk-status')]
        .filter((s) => s.value !== s.closest('[data-task]').dataset.status)
        .map((s) => s.closest('[data-task]').dataset.task));
      check('بعد الإنجاز وإعادة التحميل: كل قائمة تعرض حالة صفّها هي',
        drift.length === 0, JSON.stringify(drift));
    }
    await ctx.close();
  }

  // ── ٦) منتقي الجهة يُبحَث فيه بالاسم وبالرمز ──
  // القائمة الطويلة بلا بحث ليست قائمة: من عنده عشرات المشاريع كان يتصفّحها كلها ليبلغ واحداً
  // يعرف اسمه ورمزه («يجب ان يكون فيه بحث» — بلسان المالك).
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, base, 'demo.sectorlead');
    await open(page, base, '/app/tasks?win=all');
    const fold = page.locator('details:has(#qa-title) summary').first();
    if (await fold.count()) await fold.click();

    const target = await page.evaluate(() => {
      const sel = document.getElementById('qa-parent');
      if (!sel) return null;
      const o = [...sel.options].find((x) => x.getAttribute('data-code'));
      return o ? { value: o.value, code: o.getAttribute('data-code'), text: o.textContent.trim() } : null;
    });
    check('منتقي الجهة يحمل رموز المشاريع صالحةً للبحث', !!target, JSON.stringify(target));

    if (target) {
      await page.fill('#qa-parent-q', target.code);
      await page.waitForSelector('.sp-row');
      await page.locator('.sp-row').first().click();
      const byCode = await page.evaluate(() => document.getElementById('qa-parent').value);
      check('الكتابة بالرمز وحده تبلغ الجهة الصحيحة', byCode === target.value, `${byCode} ≠ ${target.value}`);

      const namePart = target.text.split('—').pop().trim().slice(0, 5);
      await page.fill('#qa-parent-q', namePart);
      await page.waitForTimeout(150);
      check('والبحث بالاسم يعرض نتائج كذلك', await page.locator('.sp-row').count() > 0, `الاسم=${namePart}`);
    }
    await ctx.close();
  }

}
