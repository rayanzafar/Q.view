// التقارير المنبثقة — تخطيطها يُقاس لا يُنظر إليه.
//
// بلاغ المالك: «صفحه البوب اب … ما تطلع كاملة وتطلع فوق بعضها في إجمالي المبيعات». والقياس على
// المحتوى الحيّ أكّده: الرسم البياني كان يُعرَض بعرض ٦٤١ بكسل داخل نافذة عرضها ٥٢٠، ويركب على
// العنوان التالي بمقدار ١٣٨ بكسل.
//
// السبب: جسم النافذة شبكة (display:grid)، وعنصر الشبكة لا ينكمش دون مقاسه الطبيعي
// (min-width:auto ضمنيّ) — فرسمٌ متجهٌ له نسبة أبعاد يوسّع العمود خارج حدود البطاقة، وحين
// يتّسع العمود يكبر ارتفاع الرسم بنسبته فيطفح على ما بعده.
//
// ولماذا فحصٌ بالمتصفّح لا فحص وسوم: العطل **لا أثر له في الوسم إطلاقاً** — الترتيب صحيح
// والعناصر كلها موجودة. لا يظهر إلا حين يُحسب التخطيط فعلاً. وهذا بالضبط ما جعله يعيش طويلاً:
// كل فحوصنا النصّية كانت تمرّ عليه وهي مطمئنة.
//
// ويُقاس على ثلاثة عروض لأن العطل ظهر عند المالك على نافذةٍ ضيّقة — والضيّق هو الحالة التي
// تكسر، لا الواسع الذي نطوّر عليه.
import { login, open } from './_helpers.mjs';

const KEYS = ['revenue', 'sales', 'pipeline', 'winrate', 'backlog'];
const SIZES = [[706, 900, 'ضيّقة'], [1440, 1000, 'واسعة'], [390, 844, 'جوال']];

export default async function modalLayoutSpec({ browser, base, t }) {
  const check = (name, ok, detail) => (ok ? t.pass(name) : t.fail(name, detail));

  for (const [w, h, label] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await login(page, base, 'demo.admin');
    const res = await open(page, base, '/app/ceo');
    if (!res || res.status() !== 200) { t.fail(`لوحة القيادة (${label})`, `HTTP ${res?.status()}`); await ctx.close(); continue; }

    const bad = [];
    for (const key of KEYS) {
      const m = await page.evaluate(async (k) => {
        window.Sanad.openDD(k);
        await new Promise((r) => setTimeout(r, 250));
        const body = document.querySelector('.modal-body');
        const card = document.querySelector('.modal-card');
        if (!body || !card) return { missing: true };
        const kids = [...body.children].map((e) => {
          const r = e.getBoundingClientRect();
          return { h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom),
            cls: (e.getAttribute('class') || e.tagName.toLowerCase()).slice(0, 20) };
        });
        // تراكب: عنصرٌ يبدأ قبل أن ينتهي سابقه. (تسامحُ بكسل واحد لتقريب الكسور.)
        const overlaps = [];
        for (let i = 0; i < kids.length - 1; i++) {
          if (kids[i].h > 0 && kids[i + 1].h > 0 && kids[i + 1].top < kids[i].bottom - 1) {
            overlaps.push(`${kids[i].cls}←${kids[i + 1].cls} بمقدار ${kids[i].bottom - kids[i + 1].top}`);
          }
        }
        const cr = card.getBoundingClientRect();
        const out = {
          overlaps,
          // محتوىً بارتفاع صفر يعني عنصراً انطوى على نفسه — يبدو غائباً وهو موجود
          collapsed: kids.filter((x) => x.h === 0).map((x) => x.cls),
          xOverflow: body.scrollWidth > body.clientWidth + 1,
          fitsViewport: cr.top >= -1 && cr.bottom <= window.innerHeight + 1,
          // الرسوم البيانية: لكلٍّ ارتفاعٌ حقيقي ولا يتجاوز أيٌّ منها عرض جسم النافذة
          charts: [...body.querySelectorAll('svg')].map((s) => {
            const r = s.getBoundingClientRect();
            return { h: Math.round(r.height), w: Math.round(r.width) };
          }),
          bodyW: Math.round(body.clientWidth),
        };
        window.Sanad.closeModal();
        return out;
      }, key);

      if (m.missing) { bad.push(`${key}: لم تُفتح`); continue; }
      if (m.overlaps.length) bad.push(`${key}: تراكب — ${m.overlaps.join(' · ')}`);
      if (m.collapsed.length) bad.push(`${key}: عناصر بارتفاع صفر — ${m.collapsed.join(', ')}`);
      if (m.xOverflow) bad.push(`${key}: فيض أفقي`);
      if (!m.fitsViewport) bad.push(`${key}: البطاقة تتجاوز الشاشة`);
      for (const c of m.charts) {
        if (c.h <= 0) bad.push(`${key}: رسمٌ بلا ارتفاع`);
        if (c.w > m.bodyW + 1) bad.push(`${key}: رسمٌ أعرض من النافذة (${c.w} > ${m.bodyW})`);
      }
    }
    check(`التقارير المنبثقة الخمسة تنضبط على نافذة ${label} (${w} بكسل)`, bad.length === 0, bad.join(' | '));
    await ctx.close();
  }
}
