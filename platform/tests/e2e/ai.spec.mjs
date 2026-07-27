// مساعد سند — لوحة المساعد: إثبات إغلاق الثغرة، والحالات المصمَّمة، وعقد الكتابة.
//
// الفحص الأول هو سبب وجود هذا الملف: كانت اللوحة تُركّب ردّ الخادم كوسوم (innerHTML)، والردّ
// يحمل أسماء سجلات من قاعدة البيانات حرفياً — فمشروعٌ اسمه وسمُ صورةٍ خبيث يصير تنفيذاً في
// متصفح كل من يسأل عنه (والسياسة الأمنية في وضع الإبلاغ فقط، فلا تمنعه). هنا نُنشئ مشروعاً
// بهذا الاسم فعلاً، ونسأل عنه، ونتأكد أن الحمولة ظهرت نصاً يُقرأ ولم تُنفَّذ.
//
// بقية الفحوص تُثبت العقد الذي تبنيه الواجهة: زرّ المهمة يرسل نيّة صريحة لا نصاً يُخمَّن،
// والكتابة تمرّ بنموذج ثم معاينة ثم تأكيد — ولا تُنفَّذ بنقرة واحدة أبداً.
import { login, open, collectErrors, realConsoleErrors } from './_helpers.mjs';

const PAYLOAD = '<img src=x onerror="window.__pwned=1">';
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };

const openPanel = async (page) => {
  await page.click('#ai-fab');
  await page.waitForSelector('#ai-panel:not([hidden])', { timeout: 5000 });
};
const settled = (page) => page.waitForFunction(
  () => { const l = document.getElementById('ai-log'); return l && !l.hasAttribute('aria-busy') && l.querySelector('.ai-msg.ai'); },
  null, { timeout: 15000 });
const sendText = async (page, text) => {
  await page.fill('#ai-input', text);
  await page.click('#ai-send');
};
const logText = (page) => page.evaluate(() => document.getElementById('ai-log').innerText || '');
const pwned = (page) => page.evaluate(() => ({ a: window.__pwned, b: window.__pwned2 }));
const injected = (page) => page.evaluate(() => document.querySelectorAll('#ai-log img, #ai-log script, #ai-log iframe').length);

export default async function aiSpec({ browser, base, t }) {
  // ── 1) الثغرة نفسها: مشروع اسمه حمولة خبيثة، ثم سؤال المساعد عنه ────────────
  {
    const ctx = await browser.newContext({ viewport: WIDE });
    const page = await ctx.newPage();
    const { pageErrors } = collectErrors(page);
    await login(page, base, 'demo.admin');

    // مشروع حقيقي بالاسم الخبيث (قاعدة بيانات مؤقتة يُنشئها المُشغّل لكل جولة)
    const list = await page.request.get(`${base}/api/projects`).then((r) => r.json()).catch(() => []);
    const sectorId = (Array.isArray(list) && list.find((p) => p.sector_id)?.sector_id) || 'SOLUTIONS';
    const made = await page.request.post(`${base}/api/projects`, { data: { name_ar: PAYLOAD, sector_id: sectorId } });
    const project = made.ok() ? await made.json() : null;

    if (!project?.id) {
      t.fail('fixture project with the XSS payload', `HTTP ${made.status()}`);
    } else {
      try {
        await open(page, base, '/app/ceo');
        await openPanel(page);
        await sendText(page, `لخّص مشروع ${PAYLOAD}`);
        await settled(page).catch(() => {});
        await page.waitForTimeout(300); // مهلة كافية لتنفيذ onerror لو كان الوسم قد رُكّب

        const flags = await pwned(page);
        const nodes = await injected(page);
        const text = await logText(page);
        const echoed = text.includes(PAYLOAD);

        if (flags.a === undefined && nodes === 0) {
          t.pass('XSS: a project named with an image-tag payload never executes in the assistant panel');
        } else {
          t.fail('XSS regression', `window.__pwned=${flags.a} injected nodes=${nodes}`);
        }
        if (echoed) t.pass('XSS: the payload is readable as plain text in the conversation log');
        else t.fail('payload not visible as text', `log=${text.slice(0, 160)}`);
        if (pageErrors.length) t.fail('assistant page errors', pageErrors.slice(0, 2).join(' | '));
      } finally {
        // اسم قصير آمن بعد الإثبات — بقية الفحوص تفتح شاشات المشاريع على عرض الجوال.
        await page.request.patch(`${base}/api/projects/${project.id}`, { data: { name_ar: 'مشروع فحص المساعد' } }).catch(() => {});
      }
    }
    await ctx.close();
  }

  // ── 2) العارض نفسه: ردّ فيه حمولة + تنسيق عريض وقائمة ──────────────────────
  {
    const ctx = await browser.newContext({ viewport: WIDE });
    const page = await ctx.newPage();
    await login(page, base, 'demo.admin');
    await page.route('**/api/ai/chat', (route) => route.fulfill({
      json: { reply: `**${PAYLOAD.replace('__pwned', '__pwned2')}** — ملخص\n• بند أول\n• بند ثانٍ` },
    }));
    await open(page, base, '/app/ceo');
    await openPanel(page);
    await sendText(page, 'اختبار العرض');
    await settled(page);
    await page.waitForTimeout(200);

    const shape = await page.evaluate(() => ({
      strong: document.querySelector('#ai-log strong')?.textContent || '',
      items: document.querySelectorAll('#ai-log li').length,
      nodes: document.querySelectorAll('#ai-log img, #ai-log script').length,
      pwned: window.__pwned2,
    }));
    if (shape.pwned === undefined && shape.nodes === 0 && shape.strong.includes('onerror')) {
      t.pass('safe renderer: bold/bullets become real nodes while a tag-shaped reply stays inert text');
    } else {
      t.fail('safe renderer', `pwned=${shape.pwned} nodes=${shape.nodes} strong="${shape.strong.slice(0, 60)}"`);
    }
    if (shape.items === 2) t.pass('reply bullets render as a list (not literal bullet characters)');
    else t.fail('reply list rendering', `li count=${shape.items}`);
    await ctx.close();
  }

  // ── 3) لوحة المفاتيح وسمات الوصول ──────────────────────────────────────────
  {
    const ctx = await browser.newContext({ viewport: WIDE });
    const page = await ctx.newPage();
    await login(page, base, 'demo.admin');
    await open(page, base, '/app/ceo');

    const before = await page.evaluate(() => document.getElementById('ai-fab').getAttribute('aria-expanded'));
    await openPanel(page);
    const a11y = await page.evaluate(() => {
      const p = document.getElementById('ai-panel');
      const l = document.getElementById('ai-log');
      const labelId = p.getAttribute('aria-labelledby');
      return {
        role: p.getAttribute('role'),
        named: !!(labelId && document.getElementById(labelId) && document.getElementById(labelId).textContent.trim()),
        logRole: l.getAttribute('role'),
        live: l.getAttribute('aria-live'),
        expanded: document.getElementById('ai-fab').getAttribute('aria-expanded'),
        focusInside: p.contains(document.activeElement),
      };
    });
    if (a11y.role === 'dialog' && a11y.named && a11y.logRole === 'log' && a11y.live === 'polite') {
      t.pass('a11y: role="dialog" + accessible name, message log role="log" aria-live="polite"');
    } else {
      t.fail('a11y attributes', JSON.stringify(a11y));
    }
    if (before === 'false' && a11y.expanded === 'true' && a11y.focusInside) t.pass('opening moves focus into the panel and flags the trigger expanded');
    else t.fail('open state', `before=${before} expanded=${a11y.expanded} focusInside=${a11y.focusInside}`);

    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => ({
      hidden: document.getElementById('ai-panel').hidden,
      expanded: document.getElementById('ai-fab').getAttribute('aria-expanded'),
      focus: document.activeElement && document.activeElement.id,
    }));
    if (closed.hidden && closed.expanded === 'false' && closed.focus === 'ai-fab') {
      t.pass('Escape closes the panel and returns focus to the floating button');
    } else {
      t.fail('Escape behaviour', JSON.stringify(closed));
    }
    await ctx.close();
  }

  // ── 4) أزرار المهام الجاهزة تُرسل نيّة صريحة + حالة التحضير ────────────────
  {
    const ctx = await browser.newContext({ viewport: WIDE });
    const page = await ctx.newPage();
    await login(page, base, 'demo.admin');
    await page.route('**/api/ai/status', (route) => route.fulfill({
      json: {
        engine: 'local', engineLabel: 'محلي', configured: false,
        capabilities: [
          { intent: 'weekly_report', label_ar: 'الموجز الأسبوعي', kind: 'read' },
          { intent: 'task_status', label_ar: 'تحديث حالة مهمة', kind: 'write' },
        ],
      },
    }));
    let sent = null;
    await page.route('**/api/ai/chat', async (route) => {
      sent = route.request().postDataJSON();
      await new Promise((r) => setTimeout(r, 400));          // مهلة مقصودة كي تُرى حالة التحضير
      await route.fulfill({ json: { reply: 'الإيراد المحقق هذا الأسبوع مستقر.' } });
    });
    await open(page, base, '/app/ceo');
    await openPanel(page);
    await page.waitForSelector('#ai-chips .ai-chip', { timeout: 5000 });

    const chips = await page.evaluate(() => ({
      count: document.querySelectorAll('#ai-chips .ai-chip').length,
      write: document.querySelectorAll('#ai-chips .ai-chip .wd').length,
      engine: (document.getElementById('ai-engine').textContent || '').trim(),
      empty: !!document.querySelector('#ai-log .empty-state'),
    }));
    if (chips.count === 2 && chips.write === 1) t.pass('capability chips render from the server list, write chips visibly marked');
    else t.fail('capability chips', JSON.stringify(chips));
    if (chips.engine === 'محلي') t.pass('engine shown as an Arabic word, never a provider or variable name');
    else t.fail('engine label', `«${chips.engine}»`);
    if (chips.empty) t.pass('first open shows a designed empty state with a next action');
    else t.fail('empty state', 'no .empty-state in the log on first open');

    await page.click('#ai-chips .ai-chip');
    await page.waitForSelector('#ai-log .ai-sk', { timeout: 3000 });
    const busy = await page.evaluate(() => document.getElementById('ai-log').getAttribute('aria-busy'));
    await settled(page);
    const gone = await page.evaluate(() => document.querySelectorAll('#ai-log .ai-sk').length);
    if (busy === 'true' && gone === 0) t.pass('designed thinking state appears while waiting and clears on answer');
    else t.fail('thinking state', `aria-busy=${busy} skeletons after=${gone}`);
    if (sent && sent.opts && sent.opts.intent === 'weekly_report') t.pass('a chip fires its intent directly (no free-text guessing)');
    else t.fail('chip intent', JSON.stringify(sent));
    await ctx.close();
  }

  // ── 5) مسار الكتابة: نموذج ⟵ معاينة ⟵ تأكيد (ولا تنفيذ قبله) ───────────────
  {
    const ctx = await browser.newContext({ viewport: WIDE });
    const page = await ctx.newPage();
    await login(page, base, 'demo.admin');
    const calls = { preview: null, apply: null };
    await page.route('**/api/ai/status', (route) => route.fulfill({
      json: { engine: 'local', engineLabel: 'محلي', capabilities: [{ intent: 'task_status', label_ar: 'تحديث حالة مهمة', kind: 'write' }] },
    }));
    await page.route('**/api/ai/chat', (route) => route.fulfill({
      json: {
        reply: 'اختر المهمة وحالتها الجديدة.',
        form: {
          type: 'task_status', title_ar: 'تحديث حالة مهمة', submit_ar: 'معاينة التغيير',
          fields: [
            { name: 'taskId', label_ar: 'المهمة', kind: 'select', options_kind: 'tasks', required: true },
            { name: 'status', label_ar: 'الحالة الجديدة', kind: 'select', required: true,
              options: [{ id: 'IN_PROGRESS', label_ar: 'قيد التنفيذ' }, { id: 'BLOCKED', label_ar: 'مُعطَّل' }] },
            { name: 'blockReason', label_ar: 'سبب التعطيل', kind: 'text', required: true, when: { field: 'status', equals: 'BLOCKED' } },
          ],
        },
      },
    }));
    await page.route('**/api/ai/options/**', (route) => route.fulfill({
      json: { options: [{ id: 'tk1', label_ar: 'إعداد العرض الفني' }, { id: 'tk2', label_ar: 'مراجعة المخرجات' }] },
    }));
    await page.route('**/api/ai/preview', (route) => {
      calls.preview = route.request().postDataJSON();
      return route.fulfill({ json: {
        previewId: 'pv-1', preview: { type: 'task_status' },
        summary_ar: 'ستُصبح حالة المهمة «إعداد العرض الفني» مُعطَّلة، وسبب التعطيل «بانتظار العميل».',
        expires_at: new Date(Date.now() + 120000).toISOString(),
      } });
    });
    await page.route('**/api/ai/apply', (route) => {
      calls.apply = route.request().postDataJSON();
      return route.fulfill({ json: { reply: 'حُدِّثت حالة المهمة «إعداد العرض الفني».' } });
    });

    await open(page, base, '/app/ceo');
    await openPanel(page);
    await page.waitForSelector('#ai-chips .ai-chip', { timeout: 5000 });
    await page.click('#ai-chips .ai-chip');
    await page.waitForSelector('#ai-log .ai-card select', { timeout: 5000 });

    const initial = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#ai-log .ai-card .ai-f')];
      return { rows: rows.length, hiddenLast: rows[rows.length - 1].hidden };
    });
    if (initial.rows === 3 && initial.hiddenLast) t.pass('write chip opens an in-panel form; the conditional field stays hidden until its case');
    else t.fail('conditional field', JSON.stringify(initial));

    // إرسال بلا اختيار: لا معاينة تُطلب، ورسالة الحقل المطلوب تظهر
    await page.click('#ai-log [data-action="ai-form-submit"]');
    await page.waitForTimeout(150);
    const blocked = await page.evaluate(() => document.querySelectorAll('#ai-log .ai-f .why:not([hidden])').length);
    if (blocked >= 1 && calls.preview === null) t.pass('an unfilled required field blocks the request instead of resolving silently');
    else t.fail('required validation', `messages=${blocked} previewCalled=${!!calls.preview}`);

    const selects = await page.$$('#ai-log .ai-card select');
    await selects[0].selectOption('tk1');
    await selects[1].selectOption('BLOCKED');
    await page.waitForTimeout(120);
    const revealed = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#ai-log .ai-card .ai-f')];
      const last = rows[rows.length - 1];
      return { shown: !last.hidden, required: last.querySelector('input')?.required === true };
    });
    if (revealed.shown && revealed.required) t.pass('the conditional field appears and becomes required exactly in its case');
    else t.fail('conditional reveal', JSON.stringify(revealed));

    await page.fill('#ai-log .ai-card input[type=text]', 'بانتظار العميل');
    await page.click('#ai-log [data-action="ai-form-submit"]');
    await page.waitForSelector('#ai-log .ai-prev', { timeout: 5000 });

    const prev = await page.evaluate(() => {
      const c = document.querySelector('#ai-log .ai-prev');
      return { live: c.getAttribute('aria-live'), text: c.innerText, confirm: !!c.querySelector('[data-action="ai-confirm"]') };
    });
    const okPreview = calls.preview && calls.preview.type === 'task_status'
      && calls.preview.fields && calls.preview.fields.taskId === 'tk1'
      && calls.preview.fields.status === 'BLOCKED' && calls.preview.fields.blockReason === 'بانتظار العميل';
    if (okPreview) t.pass('the form posts a structured change whose target came from the server list');
    else t.fail('preview payload', JSON.stringify(calls.preview));
    if (prev.live === 'assertive' && prev.confirm && prev.text.includes('مُعطَّلة') && calls.apply === null) {
      t.pass('the preview restates the effect in words, is announced, and nothing is applied yet');
    } else {
      t.fail('preview bubble', JSON.stringify({ live: prev.live, confirm: prev.confirm, applied: !!calls.apply }));
    }

    await page.click('#ai-log [data-action="ai-confirm"]');
    await settled(page);
    const applied = calls.apply && calls.apply.previewId === 'pv-1' && calls.apply.confirm === true;
    const done = await logText(page);
    if (applied && done.includes('حُدِّثت حالة المهمة')) t.pass('confirming applies exactly the previewed change and reports it back');
    else t.fail('apply step', JSON.stringify({ applied: calls.apply, tail: done.slice(-80) }));
    await ctx.close();
  }

  // ── 6) حالة الخطأ المصمَّمة + إعادة المحاولة ───────────────────────────────
  {
    const ctx = await browser.newContext({ viewport: WIDE });
    const page = await ctx.newPage();
    await login(page, base, 'demo.admin');
    let attempts = 0;
    await page.route('**/api/ai/chat', (route) => {
      attempts += 1;
      if (attempts === 1) return route.fulfill({ status: 500, json: { error: { message: 'تعذّر تجهيز الإجابة الآن.' } } });
      return route.fulfill({ json: { reply: 'الإجابة بعد إعادة المحاولة.' } });
    });
    await open(page, base, '/app/ceo');
    await openPanel(page);
    await sendText(page, 'سؤال');
    await page.waitForSelector('#ai-log .alert.err', { timeout: 5000 });
    const errText = await page.evaluate(() => document.querySelector('#ai-log .alert.err').innerText);
    await page.click('#ai-log [data-action="ai-retry"]');
    await settled(page);
    const after = await logText(page);
    if (errText.includes('تعذّر') && after.includes('الإجابة بعد إعادة المحاولة') && attempts === 2) {
      t.pass('a failed request shows the server’s Arabic reason with a working retry');
    } else {
      t.fail('error state', `attempts=${attempts} err="${errText.slice(0, 60)}"`);
    }
    await ctx.close();
  }

  // ── 7) العرضان: لا تمرير أفقي واللوحة داخل الشاشة ──────────────────────────
  for (const viewport of [WIDE, NARROW]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const { consoleErrors, pageErrors } = collectErrors(page);
    await login(page, base, 'demo.admin');
    await page.route('**/api/ai/chat', (route) => route.fulfill({
      json: { reply: `مشروع ${'ط'.repeat(90)} — ${PAYLOAD} — نهاية السطر الطويل` },
    }));
    await open(page, base, '/app/portfolio');
    await openPanel(page);
    await sendText(page, 'سطر طويل جداً بلا فواصل');
    await settled(page);

    const box = await page.evaluate(() => {
      const p = document.getElementById('ai-panel');
      const r = p.getBoundingClientRect();
      const l = document.getElementById('ai-log');
      return {
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        inLog: l.scrollWidth - l.clientWidth,
        outside: r.left < -1 || r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1,
      };
    });
    const errs = realConsoleErrors(consoleErrors);
    if (box.doc <= 1 && box.inLog <= 1 && !box.outside && !errs.length && !pageErrors.length) {
      t.pass(`assistant panel at ${viewport.width}px — inside the viewport, no horizontal overflow, no console errors`);
    } else {
      t.fail(`assistant panel at ${viewport.width}px`, JSON.stringify({ ...box, errs: errs.slice(0, 2), pageErrors: pageErrors.slice(0, 2) }));
    }
    await ctx.close();
  }

  // ── 8) العقد الحيّ بلا اعتراض: المهام الجاهزة كما يرسلها الخادم فعلاً ───────
  {
    const ctx = await browser.newContext({ viewport: WIDE });
    const page = await ctx.newPage();
    await login(page, base, 'demo.admin');
    await open(page, base, '/app/ceo');
    await openPanel(page);
    await page.waitForTimeout(700);
    const live = await page.evaluate(async () => {
      const r = await fetch('/api/ai/status', { credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      const list = j.capabilities || j.suggestions;
      return {
        keys: Object.keys(j || {}),
        label: j.engineLabel || j.modeLabel || null,
        caps: Array.isArray(list) ? list.length : null,
        chips: document.querySelectorAll('#ai-chips .ai-chip').length,
        shown: (document.getElementById('ai-engine').textContent || '').trim(),
        designed: !!document.querySelector('#ai-log .empty-state, #ai-log .alert'),
        canType: !document.getElementById('ai-input').disabled,
      };
    });
    if (live.caps > 0 && live.chips === live.caps && ['محلي', 'مزوّد'].includes(live.shown)) {
      t.pass(`live contract: ${live.caps} permitted capabilities rendered as chips, engine «${live.shown}»`);
    } else if (live.designed && live.canType) {
      t.pass(`live status carries no capability list (keys: ${live.keys.join(',') || 'none'}) — panel degrades to its designed state and still answers`);
    } else {
      t.fail('live status handling', JSON.stringify(live));
    }
    await ctx.close();
  }

  // ── 9) السلسلة كاملة على الخادم الحقيقي: بطاقة ⟵ نموذج ⟵ معاينة ⟵ تأكيد ────
  {
    const ctx = await browser.newContext({ viewport: WIDE });
    const page = await ctx.newPage();
    const { pageErrors } = collectErrors(page);
    await login(page, base, 'demo.admin');
    await open(page, base, '/app/tasks');
    await openPanel(page);
    await page.waitForSelector('#ai-chips .ai-chip', { timeout: 8000 }).catch(() => {});
    const intents = await page.evaluate(() =>
      [...document.querySelectorAll('#ai-chips .ai-chip')].map((b) => b.getAttribute('data-intent')));

    if (!intents.includes('create_task')) {
      t.fail('live write chip', `capabilities offered: ${intents.join(', ') || 'none'}`);
    } else {
      await page.click('#ai-chips .ai-chip[data-intent="create_task"]');
      await page.waitForSelector('#ai-log .ai-card input', { timeout: 8000 });
      const title = 'مهمة من فحص المساعد';
      await page.fill('#ai-log .ai-card input[type=text]', title);
      await page.click('#ai-log [data-action="ai-form-submit"]');
      await page.waitForSelector('#ai-log .ai-prev', { timeout: 8000 });
      const summary = await page.evaluate(() => document.querySelector('#ai-log .ai-prev').innerText);
      await page.click('#ai-log [data-action="ai-confirm"]');
      await settled(page);
      const tail = await logText(page);
      const created = await page.request.get(`${base}/api/tasks/mine`)
        .then((r) => (r.ok() ? r.json() : [])).catch(() => []);
      const stored = Array.isArray(created) ? created.some((x) => (x.title || '') === title) : false;

      if (summary.includes(title) && summary.includes('معاينة')) t.pass('live: the preview names the exact change in business words before anything happens');
      else t.fail('live preview text', summary.slice(0, 120));
      if (tail.includes(title) && stored) t.pass('live: confirming writes through the product service and the record exists afterwards');
      else t.fail('live apply', `reply mentions title=${tail.includes(title)} stored=${stored}`);
      if (pageErrors.length) t.fail('live write chain page errors', pageErrors.slice(0, 2).join(' | '));
    }
    await ctx.close();
  }
}
