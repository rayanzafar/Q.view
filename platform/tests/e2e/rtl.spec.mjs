// RTL/layout integrity: for two representative lenses (company-wide admin + sector-scoped lead),
// every page must render at desktop AND mobile widths with NO horizontal document overflow,
// zero console errors and zero uncaught page errors.
import { login, open, collectErrors, pagesFor, realConsoleErrors } from './_helpers.mjs';

const ROLES = ['demo.admin', 'demo.sectorlead'];
const WIDTHS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];

export default async function rtlSpec({ browser, base, t }) {
  for (const username of ROLES) {
    for (const viewport of WIDTHS) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      const { consoleErrors, pageErrors } = collectErrors(page);
      await login(page, base, username);
      let bad = 0;
      const pages = await pagesFor(username);
      for (const p of pages) {
        const res = await open(page, base, `/app/${p}`);
        if (!res || res.status() !== 200) { bad++; t.fail(`${username}@${viewport.width} /app/${p}`, `HTTP ${res?.status()}`); continue; }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) { bad++; t.fail(`${username}@${viewport.width} /app/${p}`, `horizontal overflow ${overflow}px`); }
      }
      // صفحات التفاصيل — وكانت خارج هذا المسح كلياً. المسح يمرّ على `/app/:page` وحدها،
      // فصفحاتٌ يفتحها المستخدم كل يوم (المشروع، الفرصة، العميل، العقد) لم تُقَس عرضاً قط.
      // وثمن ذلك ظهر: فيضٌ أفقي على صفحة المشروع عند ٣٩٠ عاش بلا أن يسقط فحص واحد.
      // والمعرّفات تُلتقط من القوائم نفسها لا تُكتب هنا، فلا يتعفّن الفحص بتغيّر البذور.
      const visited = [];
      for (const [kind, listPage] of [['project', 'projects'], ['opportunity', 'opportunities'],
        ['client', 'clients'], ['contract', 'finance']]) {
        if (!pages.includes(listPage)) continue;            // القائمة خارج صلاحيته ⟵ لا تفاصيل تُفتح منها
        await open(page, base, `/app/${listPage}`);
        // يُبحَث في الصفحة **وداخل قوالب التفصيل الخاملة** معاً: كثير من روابط التفاصيل
        // معروضة من الخادم داخل `<template>` يفتحها المستخدم بنقرة، ومحتوى القالب في جزء
        // مستقل لا يبلغه `querySelector` على المستند — فبدونه يظنّ الفحص أن لا رابط أصلاً
        // ويتخطّى بصمت.
        const href = await page.evaluate((k) => {
          const sel = `a[href^="/app/${k}/"]`;
          const live = document.querySelector(sel);
          if (live) return live.getAttribute('href');
          for (const tpl of document.querySelectorAll('template')) {
            const hit = tpl.content.querySelector(sel);
            if (hit) return hit.getAttribute('href');
          }
          return null;
        }, kind);
        if (!href) continue;                                 // لا سجل في نطاقه — ولا شيء يُقاس
        const res = await open(page, base, href);
        if (!res || res.status() !== 200) { bad++; t.fail(`${username}@${viewport.width} ${href}`, `HTTP ${res?.status()}`); continue; }
        visited.push(kind);
        // يُقاس المستندُ **والمحتوى** معاً: عنصرٌ يفيض داخل `main` قد لا يُزحزح المستند
        // (يبتلعه `overflow` محيط)، فيبقى الفيض حقيقياً على الجوال ولا يراه قياس المستند وحده.
        const of = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          main: (() => { const m = document.querySelector('main'); return m ? m.scrollWidth - m.clientWidth : 0; })(),
        }));
        if (of.doc > 1) { bad++; t.fail(`${username}@${viewport.width} ${href}`, `horizontal overflow ${of.doc}px`); }
        if (of.main > 1) { bad++; t.fail(`${username}@${viewport.width} ${href}`, `content overflows main by ${of.main}px`); }
      }
      // لا تخطٍّ صامت: مدير النظام يرى كل شيء، فإن لم يُفتح له سجلّ تفاصيل واحد فالفحص
      // لم يفحص شيئاً — وخضرةٌ من لا شيء أسوأ من حمرة.
      if (username === 'demo.admin' && visited.length < 3) {
        bad++; t.fail(`${username}@${viewport.width} detail-coverage`,
          `فُتحت ${visited.length} صفحة تفاصيل فقط (${visited.join('،') || 'ولا واحدة'}) — الروابط لم تُلتقط من القوائم`);
      }

      const realErrs = realConsoleErrors(consoleErrors);
      if (realErrs.length) { bad++; t.fail(`${username}@${viewport.width} console`, realErrs.slice(0, 3).join(' | ')); }
      if (pageErrors.length) { bad++; t.fail(`${username}@${viewport.width} pageerror`, pageErrors.slice(0, 3).join(' | ')); }
      if (!bad) t.pass(`${username} @ ${viewport.width}px — ${pages.length} pages + detail pages, no overflow, no console/page errors`);
      await ctx.close();
    }
  }
}
