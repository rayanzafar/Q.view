#!/usr/bin/env node
// فحص صفحة العرض «منصة سند» — يفتح الملف المبنيّ (ملف واحد يعمل بلا إنترنت) في متصفح بلا واجهة
// ويتحقق منه فحصاً فحصاً: لا أخطاء في وحدة التحكم، لا تمرير أفقي على ثلاثة مقاسات شاشة،
// كل الصور مقروءة ومطابقة لقائمة اللقطات، الخط العربي محمَّل، لا تسريب قيم خام ولا مصطلحات
// تقنية، تنقّل العارض بالمفاتيح يعمل، لقطة لكل مشهد للمالك، الحركة المخفَّضة تُظهر كل شيء
// نهائياً، الحجم داخل الحد، axe بلا مخالفات جسيمة، ولا رابط خارجي واحد.
//
//   node scripts/showcase-verify.mjs
//   node scripts/showcase-verify.mjs --dist /path/to/page.html --shots-dir /tmp/verify
//   node scripts/showcase-verify.mjs --quick        # بلا لقطات ولا axe
//   node scripts/showcase-verify.mjs --no-axe
//
// يخرج بالرمز 1 إذا سقط أي فحص (✗). التحذيرات (⚠) لا تُسقط التشغيل.
// المتصفح يُحلّ عبر chromiumPath() من scripts/e2e.mjs — لا تشغّل playwright install في الصندوق.
import { existsSync, readFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromiumPath } from './e2e.mjs';
import { BANNED, RAW_ENUM, bannedTermIn } from './check-glossary.mjs';

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── الوسائط ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const has = (name) => argv.includes(`--${name}`);
const QUICK = has('quick');
const NO_AXE = has('no-axe') || QUICK;
const DIST = resolve(PLATFORM, flag('dist') || 'showcase/dist/sanad-showcase.html');
const SHOTS_DIR = resolve(PLATFORM, flag('shots-dir') || 'showcase/verify');

// ── العتبات والثوابت ──────────────────────────────────────────────────────────
const MAX_BYTES = 15 * 1024 * 1024;
const WARN_BYTES = 11 * 1024 * 1024;
const SCENE_IDS = ['cover', 'why', 'ceo', 'sector', 'opps', 'projects', 'tasks',
  'staffing', 'grid', 'mobile', 'login', 'adopt', 'closing'];
const VIEWPORTS = [{ w: 1920, h: 1080 }, { w: 1440, h: 900 }, { w: 1280, h: 800 }];
const LEAK = /undefined|NaN|\[object|\bnull\b|\{\{|<!--#/;
const WILL_CHANGE_MAX = 8;

// ── المُبلِّغ ─────────────────────────────────────────────────────────────────
let failed = 0, passed = 0, warned = 0;
const pass = (name, detail) => { passed++; console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail) => { failed++; console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`); };
const warn = (name, detail) => { warned++; console.log(`⚠ ${name}${detail ? ` — ${detail}` : ''}`); };
const info = (name, detail) => console.log(`· ${name}${detail ? ` — ${detail}` : ''}`);
const nf = (n) => new Intl.NumberFormat('en-US').format(n);
const mb = (b) => `${(b / (1024 * 1024)).toFixed(2)} MB`;

// ── المدخلات ──────────────────────────────────────────────────────────────────
if (!existsSync(DIST)) {
  console.error(`✗ الصفحة المبنيّة غير موجودة: ${DIST}`);
  console.error('  ابنِ الصفحة أولاً (scripts/showcase-build.mjs) أو مرّر --dist <path>.');
  process.exit(1);
}
const html = readFileSync(DIST, 'utf8');
const bytes = statSync(DIST).size;
const distDir = dirname(DIST);
const buildTxt = existsSync(join(distDir, 'BUILD.txt')) ? readFileSync(join(distDir, 'BUILD.txt'), 'utf8') : '';
const isPlaceholderBuild = /placeholders?/i.test(buildTxt);
// قائمة اللقطات: بجوار dist أولاً (showcase/dist → showcase/shots) ثم المسار المعياري.
const manifestPath = [join(distDir, '..', 'shots', 'manifest.json'), join(PLATFORM, 'showcase/shots/manifest.json')]
  .map((p) => resolve(p)).find((p) => existsSync(p)) || null;
let manifest = null;
if (manifestPath) {
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch (e) { manifest = null; warn('قائمة اللقطات غير صالحة', `${manifestPath}: ${e.message}`); }
}

console.log(`فحص صفحة العرض: ${DIST}`);
console.log(`قائمة اللقطات: ${manifestPath || '(غير موجودة)'}${isPlaceholderBuild ? ' — بناء بلقطات بديلة' : ''}`);
console.log(`الأوضاع: ${QUICK ? 'quick (بلا لقطات ولا axe)' : NO_AXE ? 'بلا axe' : 'كامل'}\n`);

// ── 10) حدّ الحجم ─────────────────────────────────────────────────────────────
if (bytes > MAX_BYTES) fail('الحجم', `${mb(bytes)} > الحد ${mb(MAX_BYTES)}`);
else { pass('الحجم', `${mb(bytes)} (الحد ${mb(MAX_BYTES)})`); if (bytes > WARN_BYTES) warn('الحجم يقترب من الحد', `${mb(bytes)} > ${mb(WARN_BYTES)}`); }

// ── 12) برهان العمل بلا إنترنت (على مصدر الملف) ───────────────────────────────
{
  const offenders = [];
  const lineAt = (idx) => html.slice(0, idx).split('\n').length;
  const snippet = (idx) => html.slice(Math.max(0, idx - 30), idx + 90).replace(/\s+/g, ' ').trim().slice(0, 110);
  // src= / href= / srcset= بروابط خارجية (xlink:href لا يُطابَق لأنه مسبوق بنقطتين)
  for (const m of html.matchAll(/(?:^|[\s"'])(src|href|srcset)\s*=\s*["']?\s*(https?:)/gi)) {
    offenders.push({ line: lineAt(m.index), what: `${m[1]}=${m[2]}`, sample: snippet(m.index) });
  }
  for (const m of html.matchAll(/url\(\s*["']?\s*(https?:)/gi)) {
    offenders.push({ line: lineAt(m.index), what: `url(${m[1]}`, sample: snippet(m.index) });
  }
  const externalCss = [...html.matchAll(/<link\b[^>]*\brel\s*=\s*["']?stylesheet/gi)]
    .map((m) => ({ line: lineAt(m.index), what: '<link rel=stylesheet>', sample: snippet(m.index) }));
  const externalJs = [...html.matchAll(/<script\b[^>]*\bsrc\s*=/gi)]
    .map((m) => ({ line: lineAt(m.index), what: '<script src>', sample: snippet(m.index) }));
  const all = [...offenders, ...externalCss, ...externalJs];
  if (all.length) {
    fail('العمل بلا إنترنت', `${all.length} مرجعاً خارجياً`);
    for (const o of all.slice(0, 8)) console.error(`    سطر ${o.line}: ${o.what} … ${o.sample}`);
    if (all.length > 8) console.error(`    (+${all.length - 8} أخرى)`);
  } else {
    pass('العمل بلا إنترنت', 'لا src/href/srcset/url( خارجي، ولا ملف نمط أو سكربت منفصل');
  }
  const links = [...html.matchAll(/href\s*=\s*["']\s*(mailto:|tel:)/gi)].length;
  if (links) info('روابط مسموحة', `${links} رابط mailto:/tel:`);
}

// ── المتصفح ───────────────────────────────────────────────────────────────────
const { chromium } = await import('playwright');
const exe = chromiumPath();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const fileUrl = pathToFileURL(DIST).href;
console.log(`\nالمتصفح: ${exe || '(playwright-managed)'}\n`);

// 1) أخطاء وحدة التحكم — تُجمَع من كل صفحة تُفتح طوال التشغيل
const consoleErrors = [];
const watch = (page, where) => {
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${where}] console: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => consoleErrors.push(`[${where}] pageerror: ${String(e.message).split('\n')[0].slice(0, 200)}`));
};

const settle = async (page) => {
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  await page.evaluate(async () => { await document.fonts.ready; }).catch(() => {});
  await page.waitForTimeout(500);
};

const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
watch(page, 'main');
await page.goto(fileUrl, { waitUntil: 'load', timeout: 60000 });
await settle(page);

// ── بنية الصفحة (شرط بقية الفحوص) ─────────────────────────────────────────────
const structure = await page.evaluate(() => {
  const scenes = [...document.querySelectorAll('section.scene')];
  return {
    dir: document.documentElement.getAttribute('dir'),
    lang: document.documentElement.getAttribute('lang'),
    ids: scenes.map((s) => s.id),
    dataScene: scenes.map((s) => s.getAttribute('data-scene')),
    hasApi: typeof window.Showcase === 'object' && window.Showcase !== null
      && typeof window.Showcase.goTo === 'function' && !!window.Showcase.scenes,

  };
});
{
  const d = [];
  if (structure.dir !== 'rtl') d.push(`dir=${structure.dir}`);
  if (structure.lang !== 'ar') d.push(`lang=${structure.lang}`);
  if (d.length) fail('اتجاه الصفحة ولغتها', d.join('، ')); else pass('اتجاه الصفحة ولغتها', 'dir=rtl lang=ar');

  const missing = SCENE_IDS.filter((id) => !structure.ids.includes(id));
  const extra = structure.ids.filter((id) => !SCENE_IDS.includes(id));
  if (structure.ids.length !== 13 || missing.length || extra.length) {
    fail('المشاهد', `${structure.ids.length}/13${missing.length ? ` — ناقص: ${missing.join(', ')}` : ''}${extra.length ? ` — زائد: ${extra.join(', ')}` : ''}`);
  } else if (structure.dataScene.some((v, i) => String(v) !== String(i))) {
    fail('ترقيم المشاهد', `data-scene = ${structure.dataScene.join(',')}`);
  } else {
    pass('المشاهد', '13 مشهداً بالمعرّفات والترقيم المتفق عليها');
  }
  if (structure.hasApi) pass('واجهة العارض', 'window.Showcase.goTo/scenes موجودة');
  else fail('واجهة العارض', 'window.Showcase.goTo/scenes غير معرّفة');
}

// ── 2) لا تمرير أفقي على المقاسات الثلاثة ─────────────────────────────────────
for (const v of VIEWPORTS) {
  await page.setViewportSize({ width: v.w, height: v.h });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  // ينزل إلى القاع خطوةً خطوة حتى تُشغَّل كل الكشوف والحركات المرتبطة بالتمرير
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const y = await page.evaluate(() => { window.scrollBy(0, Math.round(window.innerHeight * 0.85)); return window.scrollY; });
    await page.waitForTimeout(120);
    if (y === last) break;
    last = y;
  }
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const over = doc.scrollWidth - doc.clientWidth;
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const b = el.getBoundingClientRect();
      if (b.width <= 1 && b.height <= 1) continue; // نصوص قارئ الشاشة المخفيّة خارج الشاشة
      // في صفحة RTL يخرج الفائض من الجهة اليسرى (left سالب) لا من اليمنى — تُفحص الجهتان
      const side = b.right > window.innerWidth + 1 ? `right=${Math.round(b.right)}>${window.innerWidth}`
        : b.left < -1 ? `left=${Math.round(b.left)}` : null;
      if (side) {
        offenders.push(`<${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}> ${side} (w=${Math.round(b.width)})`);
      }
    }
    return { over, count: offenders.length, offenders: offenders.slice(0, 6), width: window.innerWidth };
  });
  const label = `التمرير الأفقي ${v.w}×${v.h}`;
  if (r.over > 0 || r.count > 0) {
    fail(label, `scrollWidth-clientWidth=${r.over}, عناصر أعرض من الشاشة=${r.count}`);
    for (const o of r.offenders) console.error(`    ${o}`);
  } else pass(label, 'لا فيض أفقي ولا عنصر يتجاوز عرض الشاشة');
}
await page.setViewportSize({ width: 1920, height: 1080 });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);

// ── 3) الصور ──────────────────────────────────────────────────────────────────
{
  const imgs = await page.evaluate(() => {
    const list = [...document.images];
    const sig = (i) => `${i.getAttribute('data-shot') || i.getAttribute('alt') || ''}|${(i.getAttribute('src') || '').slice(0, 40)}`;
    return {
      total: list.length,
      broken: list.filter((i) => !(i.complete && i.naturalWidth > 0)).map(sig).slice(0, 8),
      brokenCount: list.filter((i) => !(i.complete && i.naturalWidth > 0)).length,
      nonData: list.filter((i) => !/^data:/i.test(i.getAttribute('src') || '')).map(sig).slice(0, 8),
      nonDataCount: list.filter((i) => !/^data:/i.test(i.getAttribute('src') || '')).length,
      shots: list.filter((i) => i.hasAttribute('data-shot')).map((i) => i.getAttribute('data-shot')),
      noDims: list.filter((i) => i.hasAttribute('data-shot') && !(i.getAttribute('width') && i.getAttribute('height')))
        .map((i) => i.getAttribute('data-shot')).slice(0, 8),
      emptySvg: [...document.querySelectorAll('svg')].filter((s) => !s.firstElementChild).length,
      svgTotal: document.querySelectorAll('svg').length,
    };
  });
  if (imgs.brokenCount) fail('الصور مقروءة', `${imgs.brokenCount}/${imgs.total} لم تُفكّ: ${imgs.broken.join(' | ')}`);
  else pass('الصور مقروءة', `${imgs.total} صورة، كلها complete وnaturalWidth > 0`);

  if (imgs.nonDataCount) fail('الصور مضمَّنة', `${imgs.nonDataCount} صورة بلا مصدر data: — ${imgs.nonData.join(' | ')}`);
  else pass('الصور مضمَّنة', 'كل مصادر الصور data:');

  if (imgs.noDims.length) fail('أبعاد اللقطات', `بلا width/height: ${imgs.noDims.join(', ')}`);
  else if (imgs.shots.length) pass('أبعاد اللقطات', `${imgs.shots.length} لقطة بأبعاد معلنة`);

  if (imgs.emptySvg) fail('الرسوم المتجهة', `${imgs.emptySvg}/${imgs.svgTotal} <svg> بلا محتوى (شعار لم يُضمَّن؟)`);
  else pass('الرسوم المتجهة', `${imgs.svgTotal} <svg> كلها بمحتوى`);

  const shotIds = imgs.shots;
  if (!manifest || !Array.isArray(manifest.shots)) {
    warn('مطابقة قائمة اللقطات', 'لا قائمة manifest.json — تخطّي المطابقة');
  } else if (isPlaceholderBuild) {
    warn('مطابقة قائمة اللقطات', `بناء بلقطات بديلة (BUILD.txt) — تخطّي المطابقة (${shotIds.length} في الصفحة، ${manifest.shots.length} في القائمة)`);
  } else {
    const manifestIds = manifest.shots.map((s) => s.id);
    const missing = manifestIds.filter((id) => !shotIds.includes(id));
    const unknown = shotIds.filter((id) => !manifestIds.includes(id));
    if (missing.length || unknown.length || shotIds.length !== manifestIds.length) {
      fail('مطابقة قائمة اللقطات', `الصفحة ${shotIds.length} / القائمة ${manifestIds.length}`
        + (missing.length ? ` — في القائمة وليست في الصفحة: ${missing.join(', ')}` : '')
        + (unknown.length ? ` — في الصفحة وليست في القائمة: ${unknown.join(', ')}` : ''));
    } else pass('مطابقة قائمة اللقطات', `${shotIds.length} لقطة مطابقة تماماً`);
  }
}

// ── 4) الخطوط ─────────────────────────────────────────────────────────────────
{
  const f = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      r400: document.fonts.check('400 16px "IBM Plex Sans Arabic"'),
      r700: document.fonts.check('700 16px "IBM Plex Sans Arabic"'),
      body: getComputedStyle(document.body).fontFamily,
      loaded: [...document.fonts].map((x) => `${x.family} ${x.weight} ${x.status}`).slice(0, 6),
    };
  });
  const familyOk = /^\s*["']?IBM Plex Sans Arabic/i.test(f.body);
  if (f.r400 && f.r700 && familyOk) pass('الخط العربي', `IBM Plex Sans Arabic 400+700 محمَّل، body: ${f.body.slice(0, 60)}`);
  else fail('الخط العربي', `400=${f.r400} 700=${f.r700} body=${f.body.slice(0, 70)}${f.loaded.length ? ` | ${f.loaded.join('، ')}` : ''}`);
}

// ── 5+6) تسريب القيم الخام والمصطلحات التقنية (لكل مشهد) ──────────────────────
// كل النص المعروض يُنسب إلى مشهده؛ وما هو خارج المشاهد (شريط التنقّل مثلاً) يُجمع في مدخل واحد.
const sceneText = await page.evaluate(() => {
  const ATTRS = ['alt', 'aria-label', 'title', 'aria-description'];
  const attrsOf = (root, outside) => {
    const out = [];
    for (const el of root.querySelectorAll(`[${ATTRS.join('],[')}]`)) {
      if (outside && el.closest('section.scene')) continue;
      for (const a of ATTRS) { const v = el.getAttribute(a); if (v) out.push(`${a}="${v}"`); }
    }
    return out;
  };
  const out = [];
  for (const s of document.querySelectorAll('section.scene')) out.push({ id: s.id, text: s.innerText || '', attrs: attrsOf(s, false) });
  out.push({ id: '(خارج المشاهد)', text: document.body.innerText || '', attrs: attrsOf(document.body, true), isBody: true });
  return out;
});
// أسطر المشاهد تُحذف من مدخل «خارج المشاهد» حتى لا تُحسب المخالفة مرتين
{
  const sceneLines = new Set(sceneText.filter((s) => !s.isBody)
    .flatMap((s) => s.text.split('\n').map((l) => l.trim())));
  for (const s of sceneText) {
    if (!s.isBody) continue;
    s.text = s.text.split('\n').filter((l) => !sceneLines.has(l.trim())).join('\n');
  }
}
{
  const hits = [];
  for (const s of sceneText) {
    for (const line of s.text.split('\n')) {
      const m = line.match(LEAK);
      if (m) hits.push(`${s.id}: «${m[0]}» في: ${line.replace(/\s+/g, ' ').trim().slice(0, 90)}`);
    }
  }
  if (hits.length) { fail('تسريب قيم خام', `${hits.length} موضعاً`); for (const h of hits.slice(0, 10)) console.error(`    ${h}`); }
  else pass('تسريب قيم خام', `لا ${LEAK.source} في النص المعروض`);
}
{
  const hits = [];
  const scan = (id, where, text) => {
    for (const line of text.split('\n')) {
      let rest = line;
      for (let k = 0; k < 5; k++) {
        const term = bannedTermIn(rest);
        if (!term) break;
        hits.push({ id, where, term, line: line.replace(/\s+/g, ' ').trim().slice(0, 90) });
        rest = rest.split(term).join(' ');
      }
    }
  };
  for (const s of sceneText) {
    scan(s.id, 'نص', s.text);
    scan(s.id, 'سمة', s.attrs.join('\n'));
  }
  if (hits.length) {
    fail('المصطلحات التقنية', `${hits.length} مخالفة (${BANNED.length} نمطاً محظوراً + القيم الخام)`);
    for (const h of hits.slice(0, 10)) console.error(`    ${h.id} [${h.where}] «${h.term}» في: ${h.line}`);
  } else pass('المصطلحات التقنية', `نظيف مقابل ${BANNED.length} نمطاً محظوراً + ${RAW_ENUM.source.split('|').length} قيمة خام`);
}

// ── 13) عافية الأداء (معلومات) ────────────────────────────────────────────────
{
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  const p = await page.evaluate(() => {
    const wc = [...document.querySelectorAll('body *')].filter((el) => {
      const v = getComputedStyle(el).willChange;
      return v && v !== 'auto';
    });
    return {
      nodes: document.querySelectorAll('*').length,
      willChange: wc.length,
      sample: wc.slice(0, 5).map((el) => `<${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''}>`),
    };
  });
  info('حجم الشجرة', `${nf(p.nodes)} عنصراً، الملف ${mb(bytes)} (كل شيء مضمَّن — لا نقل شبكي)`);
  if (p.willChange > WILL_CHANGE_MAX) warn('will-change في السكون', `${p.willChange} عنصراً > ${WILL_CHANGE_MAX}: ${p.sample.join(' ')}`);
  else pass('will-change في السكون', `${p.willChange} عنصراً (الحد ${WILL_CHANGE_MAX})`);
}

// ── 7) تنقّل العارض بالمفاتيح ─────────────────────────────────────────────────
const activeIndex = async () => page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const groups = new Map();
  for (const b of btns) {
    const k = b.parentElement;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  let rail = [...groups.values()].find((g) => g.length >= 13 && g.some((b) => b.hasAttribute('aria-current')));
  if (!rail) rail = btns.filter((b) => b.hasAttribute('aria-current'));
  const idx = rail.findIndex((b) => b.getAttribute('aria-current') === 'true');
  const scenes = [...document.querySelectorAll('section.scene')];
  return { idx, dots: rail.length, sceneId: idx >= 0 ? (scenes[idx]?.id ?? null) : null };
});
{
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('Home');
  await page.waitForTimeout(700);
  const start = await activeIndex();
  const seq = [start.idx];
  let ended = start;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(600);
    ended = await activeIndex();
    seq.push(ended.idx);
  }
  const monotonic = seq.every((v, i) => i === 0 || v >= seq[i - 1]) && seq.every((v, i) => i === 0 || v > seq[i - 1]);
  const problems = [];
  if (start.dots !== 13) problems.push(`عدد النقاط ${start.dots} ≠ 13`);
  if (start.idx !== 0) problems.push(`Home لم يعد إلى الأول (idx=${start.idx})`);
  if (!monotonic) problems.push(`الترتيب غير متصاعد: ${seq.join('→')}`);
  if (ended.sceneId !== 'closing') problems.push(`انتهى عند «${ended.sceneId}» لا «closing»`);
  await page.evaluate(() => window.Showcase && window.Showcase.goTo(0));
  await page.waitForTimeout(700);
  const back = await activeIndex();
  if (back.sceneId !== 'cover') problems.push(`goTo(0) لم يعد إلى «cover» (${back.sceneId})`);
  if (problems.length) fail('تنقّل العارض', problems.join('؛ '));
  else pass('تنقّل العارض', `Home ثم PageDown ×12: ${seq.join('→')} وانتهى عند closing، وgoTo(0) عاد إلى cover`);
}

// ── 8) لقطة لكل مشهد ─────────────────────────────────────────────────────────
if (QUICK) {
  info('لقطات المشاهد', 'متخطّاة (--quick)');
} else {
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const ids = structure.ids.length === 13 ? structure.ids : SCENE_IDS;
  let taken = 0;
  for (let n = 0; n < ids.length; n++) {
    try {
      await page.evaluate((i) => { if (window.Showcase) window.Showcase.goTo(i); else document.querySelectorAll('section.scene')[i]?.scrollIntoView(); }, n);
      await page.waitForTimeout(900);
      const file = join(SHOTS_DIR, `scene-${String(n).padStart(2, '0')}-${ids[n]}.png`);
      await page.screenshot({ path: file });
      taken++;
    } catch (e) { fail('لقطة مشهد', `${ids[n]}: ${e.message.split('\n')[0]}`); }
  }
  if (taken === ids.length) pass('لقطات المشاهد', `${taken} لقطة → ${SHOTS_DIR}`);
  else warn('لقطات المشاهد', `${taken}/${ids.length} فقط → ${SHOTS_DIR}`);
}

// ── 11) axe-core ─────────────────────────────────────────────────────────────
if (NO_AXE) {
  info('axe-core', QUICK ? 'متخطّى (--quick)' : 'متخطّى (--no-axe)');
} else {
  const axePath = resolve(PLATFORM, 'node_modules/axe-core/axe.min.js');
  if (!existsSync(axePath)) {
    warn('axe-core', `الحزمة غير مثبّتة (${axePath}) — تخطّي`);
  } else {
    await page.evaluate(() => window.Showcase && window.Showcase.goTo(0));
    await page.waitForTimeout(400);
    await page.addScriptTag({ content: readFileSync(axePath, 'utf8') });
    const violations = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document, { resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') || '' }));
    });
    const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const rest = violations.filter((v) => !bad.includes(v));
    if (bad.length) { fail('axe-core', `${bad.length} مخالفة جسيمة`); for (const v of bad) console.error(`    ${v.impact} ${v.id} ×${v.nodes} (مثال: ${v.sample})`); }
    else pass('axe-core', `لا مخالفات serious/critical (${violations.length} مخالفة بدرجات أخف)`);
    for (const v of rest.slice(0, 8)) warn('axe-core', `${v.impact} ${v.id} ×${v.nodes} (مثال: ${v.sample})`);
  }
}

// ── 9) الحركة المخفَّضة ───────────────────────────────────────────────────────
{
  const rmCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
  const rmPage = await rmCtx.newPage();
  watch(rmPage, 'reduced-motion');
  await rmPage.goto(fileUrl, { waitUntil: 'load', timeout: 60000 });
  await rmPage.evaluate(async () => { await document.fonts.ready; }).catch(() => {});
  await rmPage.waitForTimeout(400);
  const r = await rmPage.evaluate(() => {
    const digits = (s) => (s || '').replace(/[^\d]/g, '');
    const reveal = [...document.querySelectorAll('[data-reveal]')];
    const notIn = reveal.filter((el) => !el.classList.contains('in'));
    const counters = [...document.querySelectorAll('[data-count]')];
    const wrong = counters.filter((el) => digits(el.textContent) !== digits(el.getAttribute('data-count')))
      .map((el) => `data-count=${el.getAttribute('data-count')} معروض=${(el.textContent || '').trim().slice(0, 20)}`);
    return {
      reveal: reveal.length, notIn: notIn.length,
      notInSample: notIn.slice(0, 5).map((el) => `<${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''}>`),
      counters: counters.length, wrong: wrong.length, wrongSample: wrong.slice(0, 5),
    };
  });
  const probs = [];
  if (r.notIn) probs.push(`${r.notIn}/${r.reveal} عنصر [data-reveal] بلا الصنف in: ${r.notInSample.join(' ')}`);
  if (r.wrong) probs.push(`${r.wrong}/${r.counters} عدّاد لم يبلغ قيمته: ${r.wrongSample.join(' | ')}`);
  if (probs.length) fail('الحركة المخفَّضة', probs.join('؛ '));
  else pass('الحركة المخفَّضة', `${r.reveal} عنصر كشف ظاهر و${r.counters} عدّاد بقيمته النهائية فوراً`);
  await rmCtx.close();
}

// ── 1) أخطاء وحدة التحكم (الحصيلة النهائية) ───────────────────────────────────
if (consoleErrors.length) {
  fail('أخطاء وحدة التحكم', `${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 10)) console.error(`    ${e}`);
  if (consoleErrors.length > 10) console.error(`    (+${consoleErrors.length - 10} أخرى)`);
} else pass('أخطاء وحدة التحكم', 'صفر خطأ console/pageerror طوال التشغيل');

await ctx.close();
await browser.close();

console.log(`\n${failed ? '✗' : '✓'} ${basename(DIST)}: ${passed} ناجح، ${failed} ساقط، ${warned} تحذيراً.`);
process.exit(failed ? 1 : 0);
