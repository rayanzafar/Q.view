#!/usr/bin/env node
// بناء صفحة العرض «منصة سند» — ملف HTML واحد يعمل بلا إنترنت.
//
// showcase-build.mjs — inlines showcase/src/{index.html,styles.css,app.js} plus the woff2 fonts,
// the brand SVGs and every screenshot into ONE self-contained file:
//     showcase/dist/sanad-showcase.html
// No bundler, no dependencies beyond Node built-ins.
//
//   node scripts/showcase-build.mjs                 # needs showcase/shots/manifest.json
//   node scripts/showcase-build.mjs --placeholders  # labelled gradient SVGs instead of shots
//   node scripts/showcase-build.mjs --out /tmp/x.html --src showcase/src --manifest path.json
//
// Asset contract with showcase/src/index.html (the page author follows it exactly):
//   <link rel="stylesheet" href="styles.css" data-inline="css">      → <style>…</style>
//   <script src="app.js" data-inline="js" defer></script>            → <script>…</script>
//   url("fonts/IBMPlexSansArabic-Regular.woff2") inside styles.css   → url(data:font/woff2;base64,…)
//   <img src="brand/logo-white.svg" data-inline-svg alt="…">         → raw <svg> with prefixed ids
//   <img data-shot="ceo-dashboard" alt="…">                          → src=data:image/webp;base64,… + w/h
// Anything relative left over (src/href/url()) fails the build: the page must be offline-safe.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WARN_BYTES = 11 * 1024 * 1024;
const FAIL_BYTES = 15 * 1024 * 1024;

// ── flags ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { placeholders: false, src: 'showcase/src', out: 'showcase/dist/sanad-showcase.html', manifest: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--placeholders') o.placeholders = true;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--src') o.src = argv[++i];
    else if (a === '--manifest') o.manifest = argv[++i];
    else if (a === '--help' || a === '-h') o.help = true;
    else die(`خيار غير معروف: ${a}`);
  }
  return o;
}
function die(msg, details = []) {
  console.error(`\n✗ ${msg}`);
  for (const d of details) console.error(`   • ${d}`);
  console.error('');
  process.exit(1);
}
const warnings = [];
function warn(msg) { warnings.push(msg); }

// ── small helpers ────────────────────────────────────────────────────────────
const stripBom = (s) => s.replace(/^﻿/, '');
const readText = (p) => stripBom(readFileSync(p, 'utf8'));
function kb(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024).toFixed(1)} KB`;
}
function b64(buf) { return buf.toString('base64'); }

// Parse the attributes of a single start tag (`<img …>`); returns [{name,value}] preserving order.
function parseAttrs(tag) {
  const inner = tag.replace(/^<\s*[\w:-]+/, '').replace(/\/?>$/, '');
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`=]+)))?/g;
  const out = [];
  let m;
  while ((m = re.exec(inner))) {
    if (!m[0].trim()) continue;
    out.push({ name: m[1], value: m[2] ?? m[3] ?? m[4] ?? null });
  }
  return out;
}
const attrVal = (attrs, name) => {
  const a = attrs.find((x) => x.name.toLowerCase() === name);
  return a ? a.value : null;
};
const hasAttr = (attrs, name) => attrs.some((x) => x.name.toLowerCase() === name);
function setAttr(attrs, name, value) {
  const a = attrs.find((x) => x.name.toLowerCase() === name);
  if (a) a.value = value; else attrs.push({ name, value });
}
function dropAttr(attrs, name) {
  const i = attrs.findIndex((x) => x.name.toLowerCase() === name);
  if (i >= 0) attrs.splice(i, 1);
}
function renderTag(name, attrs, selfClose = false) {
  const parts = attrs.map((a) => (a.value === null ? a.name : `${a.name}="${String(a.value).replace(/"/g, '&quot;')}"`));
  return `<${name}${parts.length ? ' ' + parts.join(' ') : ''}${selfClose ? '' : ''}>`;
}
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── asset resolution ─────────────────────────────────────────────────────────
// Assets may be copied into showcase/src/{fonts,brand}/ (gitignored) or read from the product's
// public directory. The product copy is the source of truth; the local copy wins when present.
function resolveAsset(srcDir, kind, file) {
  const local = join(srcDir, kind, file);
  if (existsSync(local)) return local;
  const shipped = join(PLATFORM, 'src', 'web', 'public', kind, file);
  if (existsSync(shipped)) return shipped;
  return null;
}

// ── CSS: fonts → data URIs ───────────────────────────────────────────────────
const FONT_MIME = 'font/woff2';
function inlineFonts(css, srcDir, tally) {
  const seen = new Map();
  const out = css.replace(/url\(\s*(['"]?)([^'")]+?\.woff2)\1\s*\)/gi, (whole, _q, ref) => {
    const file = basename(ref.split('?')[0].split('#')[0]);
    if (/Light/i.test(file)) warn(`الخط Light مُشار إليه في styles.css (${file}) — أُدرج، والخطة تكتفي بـ Regular/Medium/Bold.`);
    if (!/^IBMPlexSansArabic-(Regular|Medium|Bold|Light)\.woff2$/i.test(file)) {
      warn(`ملف خط غير متوقع: ${file} — أُدرج كما هو.`);
    }
    if (seen.has(file)) return seen.get(file);
    const p = resolveAsset(srcDir, 'fonts', file);
    if (!p) die(`لم يُعثر على ملف الخط: ${file}`, [
      `المُتوقّع في ${join(srcDir, 'fonts', file)}`,
      `أو في ${join(PLATFORM, 'src/web/public/fonts', file)}`,
    ]);
    const data = readFileSync(p);
    const uri = `url(data:${FONT_MIME};base64,${b64(data)})`;
    tally.fonts += Buffer.byteLength(uri, 'utf8');
    tally.fontFiles.push({ file, raw: data.length });
    seen.set(file, uri);
    return uri;
  });
  return out;
}

// ── brand SVGs ───────────────────────────────────────────────────────────────
const SVG_PREFIX = {
  'logo-white.svg': 'lw',
  'logo-color.svg': 'lc',
  'evc-letters-white.svg': 'elw',
};
const SVG_FORBIDDEN = new Set(['dots.svg', 'values.svg']);

function idPrefixFor(file) {
  if (SVG_PREFIX[file]) return SVG_PREFIX[file];
  return basename(file, '.svg').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

// Namespace every id inside one SVG so three inlined logos cannot collide.
function prefixSvgIds(svg, prefix) {
  const ids = new Set();
  for (const m of svg.matchAll(/\sid\s*=\s*(['"])([^'"]+)\1/g)) ids.add(m[2]);
  if (!ids.size) return svg;
  let out = svg.replace(/(\sid\s*=\s*)(['"])([^'"]+)\2/g, (w, head, q, id) => (ids.has(id) ? `${head}${q}${prefix}-${id}${q}` : w));
  out = out.replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, (w, q, id) => (ids.has(id) ? `url(${q}#${prefix}-${id}${q})` : w));
  out = out.replace(/((?:xlink:)?href\s*=\s*)(['"])#([^'"]+)\2/g, (w, head, q, id) => (ids.has(id) ? `${head}${q}#${prefix}-${id}${q}` : w));
  return out;
}

function buildInlineSvg(file, source, imgAttrs, prefix) {
  let svg = stripBom(source)
    .replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/^\s*<!DOCTYPE[^>]*>\s*/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  const open = svg.match(/^<svg\b[^>]*>/i);
  if (!open) die(`الملف ${file} لا يبدأ بوسم <svg>.`);
  svg = prefixSvgIds(svg, prefix);
  const openTag = svg.match(/^<svg\b[^>]*>/i)[0];
  const attrs = parseAttrs(openTag);

  const alt = attrVal(imgAttrs, 'alt');
  const cls = attrVal(imgAttrs, 'class');
  if (cls) {
    const existing = attrVal(attrs, 'class');
    setAttr(attrs, 'class', existing ? `${existing} ${cls}` : cls);
  }
  const passthrough = ['style', 'width', 'height', 'id', 'data-parallax', 'data-reveal', 'aria-hidden'];
  for (const name of passthrough) {
    const v = attrVal(imgAttrs, name);
    if (v !== null && v !== undefined && !hasAttr(attrs, name)) setAttr(attrs, name, v);
  }
  if (!hasAttr(attrs, 'focusable')) setAttr(attrs, 'focusable', 'false');

  let titleEl = '';
  if (alt && alt.trim()) {
    const tid = `${prefix}-title`;
    setAttr(attrs, 'role', 'img');
    setAttr(attrs, 'aria-labelledby', tid);
    dropAttr(attrs, 'aria-hidden');
    titleEl = `<title id="${tid}">${escHtml(alt.trim())}</title>`;
  } else {
    // alt="" (or missing) → decorative, per the same rule the product pages use.
    setAttr(attrs, 'aria-hidden', 'true');
    dropAttr(attrs, 'role');
  }
  const newOpen = renderTag('svg', attrs);
  return newOpen + titleEl + svg.slice(openTag.length);
}

// ── screenshots ──────────────────────────────────────────────────────────────
const IMG_MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.avif': 'image/avif' };

function loadManifest(opts) {
  const p = resolve(PLATFORM, opts.manifest || 'showcase/shots/manifest.json');
  if (!existsSync(p)) {
    die('لم يُعثر على بيان اللقطات showcase/shots/manifest.json', [
      `المسار المُجرَّب: ${p}`,
      'شغّل scripts/showcase-capture.mjs أولاً، أو ابنِ بالوضع البديل: node scripts/showcase-build.mjs --placeholders',
    ]);
  }
  const raw = readFileSync(p);
  let json;
  try { json = JSON.parse(stripBom(raw.toString('utf8'))); } catch (e) { die(`بيان اللقطات غير سليم (${p}): ${e.message}`); }
  if (!json || !Array.isArray(json.shots)) die(`بيان اللقطات لا يحوي مصفوفة shots (${p}).`);
  const byId = new Map();
  for (const s of json.shots) {
    if (!s || !s.id) continue;
    byId.set(String(s.id), s);
  }
  return { path: p, json, byId, sha256: createHash('sha256').update(raw).digest('hex') };
}

function shotDataUri(shot, manifestPath, tally) {
  const base = dirname(manifestPath);
  const file = shot.file || `${shot.id}.webp`;
  const p = /^([a-z]:)?[\\/]/i.test(file) ? file : join(base, file);
  if (!existsSync(p)) die(`ملف اللقطة مفقود: ${p} (المعرّف: ${shot.id})`);
  const buf = readFileSync(p);
  const mime = IMG_MIME[extname(p).toLowerCase()] || 'image/webp';
  const uri = `data:${mime};base64,${b64(buf)}`;
  tally.images += Buffer.byteLength(uri, 'utf8');
  tally.imageFiles.push({ id: shot.id, raw: buf.length });
  return uri;
}

// Placeholder: labelled gradient SVG at the real device size, so the page composes before capture.
function placeholderUri(id, tally) {
  const mobile = /^m-/.test(id);
  const w = mobile ? 390 : 1440;
  const h = mobile ? 844 : 900;
  const fs = mobile ? 34 : 72;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="#244A99"/><stop offset="1" stop-color="#834798"/></linearGradient></defs>`
    + `<rect width="${w}" height="${h}" fill="#0b1224"/>`
    + `<rect x="${Math.round(w * 0.03)}" y="${Math.round(h * 0.03)}" width="${Math.round(w * 0.94)}" height="${Math.round(h * 0.94)}" rx="${mobile ? 26 : 18}" fill="url(#g)" opacity="0.92"/>`
    + `<text x="50%" y="50%" fill="#ffffff" font-family="IBM Plex Sans Arabic, Segoe UI, sans-serif" font-size="${fs}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${escHtml(id)}</text>`
    + `<text x="50%" y="${Math.round(h * 0.5 + fs * 1.15)}" fill="#ffffff" opacity="0.72" font-family="IBM Plex Sans Arabic, Segoe UI, sans-serif" font-size="${Math.round(fs * 0.34)}" text-anchor="middle" dominant-baseline="middle">${w} × ${h}</text>`
    + `</svg>`;
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  tally.images += Buffer.byteLength(uri, 'utf8');
  tally.imageFiles.push({ id, raw: Buffer.byteLength(svg, 'utf8') });
  return { uri, w, h };
}

// ── offline safety scan ──────────────────────────────────────────────────────
const SAFE_SCHEME = /^(data:|mailto:|tel:|#|about:blank$|blob:|javascript:void)/i;
function offlineScan(rawHtml) {
  // Script BODIES are stripped before scanning: an inlined app.js legitimately contains strings
  // like "<img src='x.png'>" that load nothing. Opening tags survive, so a leftover
  // <script src="…"> is still caught.
  const html = rawHtml.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, '$1$2');
  const bad = [];
  const soft = [];
  const push = (list, what, val) => { if (!list.some((x) => x.what === what && x.val === val)) list.push({ what, val }); };

  // resource-loading attributes anywhere in the document
  for (const m of html.matchAll(/\s(src|srcset|poster|data-src)\s*=\s*(["'])([^"']*)\2/gi)) {
    const val = m[3].trim();
    if (!val || SAFE_SCHEME.test(val)) continue;
    push(bad, m[1].toLowerCase(), val.slice(0, 120));
  }
  // <link href> loads a resource; <a href> does not
  for (const m of html.matchAll(/<link\b[^>]*?\shref\s*=\s*(["'])([^"']*)\1[^>]*>/gi)) {
    const val = m[2].trim();
    if (!val || SAFE_SCHEME.test(val)) continue;
    push(bad, 'link href', val.slice(0, 120));
  }
  for (const m of html.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    const val = m[2].trim();
    if (!val || SAFE_SCHEME.test(val)) continue;
    push(bad, 'css url()', val.slice(0, 120));
  }
  // <a href> — external links are fine (nothing loads); relative ones are dead offline.
  for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*(["'])([^"']*)\1/gi)) {
    const val = m[2].trim();
    if (!val || SAFE_SCHEME.test(val)) continue;
    if (/^https?:\/\//i.test(val)) continue;
    push(soft, 'a href', val.slice(0, 120));
  }
  return { bad, soft };
}

// ── build ────────────────────────────────────────────────────────────────────
function build(opts) {
  const srcDir = resolve(PLATFORM, opts.src);
  const outPath = resolve(PLATFORM, opts.out);
  const indexPath = join(srcDir, 'index.html');
  if (!existsSync(indexPath)) die(`لم يُعثر على ${indexPath}`);

  const tally = { css: 0, js: 0, fonts: 0, svg: 0, images: 0, fontFiles: [], imageFiles: [], svgFiles: [], shots: 0 };
  let html = readText(indexPath);

  const manifest = opts.placeholders ? null : loadManifest(opts);

  // 1) brand SVGs + 2) screenshots — one pass over every <img>, before any JS is inlined
  //    (so an "<img" appearing inside app.js can never be rewritten)
  const missingShots = [];
  html = html.replace(/<img\b[^>]*?\/?>/gi, (tag) => {
    const attrs = parseAttrs(tag);

    if (hasAttr(attrs, 'data-inline-svg')) {
      const src = attrVal(attrs, 'src');
      if (!src) die('وسم <img data-inline-svg> بلا src.');
      const file = basename(src.split('?')[0]);
      if (SVG_FORBIDDEN.has(file)) {
        die(`ممنوع إدراج ${file} داخل الصفحة (حجمه كبير جداً).`, ['استخدم logo-white.svg أو logo-color.svg أو evc-letters-white.svg.']);
      }
      const p = resolveAsset(srcDir, 'brand', file);
      if (!p) die(`لم يُعثر على شعار العلامة: ${file}`, [
        `المُتوقّع في ${join(srcDir, 'brand', file)}`,
        `أو في ${join(PLATFORM, 'src/web/public/brand', file)}`,
      ]);
      const svg = buildInlineSvg(file, readText(p), attrs, idPrefixFor(file));
      tally.svg += Buffer.byteLength(svg, 'utf8');
      tally.svgFiles.push({ file, raw: statSync(p).size });
      return svg;
    }

    const shotId = attrVal(attrs, 'data-shot');
    if (shotId) {
      if (opts.placeholders) {
        const { uri, w, h } = placeholderUri(shotId, tally);
        setAttr(attrs, 'src', uri);
        setAttr(attrs, 'width', String(w));
        setAttr(attrs, 'height', String(h));
      } else {
        const shot = manifest.byId.get(shotId);
        if (!shot) { missingShots.push(shotId); return tag; }
        setAttr(attrs, 'src', shotDataUri(shot, manifest.path, tally));
        if (shot.w) setAttr(attrs, 'width', String(shot.w));
        if (shot.h) setAttr(attrs, 'height', String(shot.h));
        if (!shot.w || !shot.h) warn(`اللقطة ${shotId} بلا أبعاد في البيان — لم تُضبط width/height.`);
      }
      if (!hasAttr(attrs, 'decoding')) setAttr(attrs, 'decoding', 'async');
      if (!hasAttr(attrs, 'alt')) warn(`اللقطة ${shotId} بلا نص بديل (alt).`);
      tally.shots++;
      return renderTag('img', attrs);
    }

    return tag;
  });

  if (missingShots.length) {
    die(`لقطات مفقودة من البيان (${missingShots.length}):`, [
      ...missingShots.map((id) => id),
      `البيان: ${manifest.path}`,
      'أعد الالتقاط، أو ابنِ بالوضع البديل: node scripts/showcase-build.mjs --placeholders',
    ]);
  }

  // 3) CSS (fonts inlined inside it)
  let cssCount = 0;
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const attrs = parseAttrs(tag);
    if ((attrVal(attrs, 'data-inline') || '').toLowerCase() !== 'css') return tag;
    const href = attrVal(attrs, 'href');
    if (!href) die('وسم <link data-inline="css"> بلا href.');
    const p = join(srcDir, href);
    if (!existsSync(p)) die(`لم يُعثر على ملف الأنماط: ${p}`);
    let css = readText(p);
    const before = Buffer.byteLength(css, 'utf8');
    css = inlineFonts(css, srcDir, tally);
    tally.css += before;
    cssCount++;
    return `<style>\n${css}\n</style>`;
  });
  // plan-era fallback placeholder: <!--#css-->
  if (!cssCount && /<!--#css-->/.test(html)) {
    const p = join(srcDir, 'styles.css');
    if (!existsSync(p)) die(`لم يُعثر على ملف الأنماط: ${p}`);
    let css = readText(p);
    tally.css += Buffer.byteLength(css, 'utf8');
    css = inlineFonts(css, srcDir, tally);
    html = html.replace('<!--#css-->', `<style>\n${css}\n</style>`);
    cssCount++;
  }
  if (!cssCount) warn('لا وسم <link … data-inline="css"> في index.html — لم تُدرج أي أنماط.');

  // 4) JS
  let jsCount = 0;
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attrsRaw, body) => {
    const attrs = parseAttrs(`<script${attrsRaw}>`);
    if ((attrVal(attrs, 'data-inline') || '').toLowerCase() !== 'js') return whole;
    const src = attrVal(attrs, 'src');
    if (!src) die('وسم <script data-inline="js"> بلا src.');
    if (body.trim()) warn(`وسم <script data-inline="js" src="${src}"> يحوي متناً — أُهمل واستُبدل بمحتوى الملف.`);
    const p = join(srcDir, src);
    if (!existsSync(p)) die(`لم يُعثر على ملف السكربت: ${p}`);
    let js = readText(p);
    tally.js += Buffer.byteLength(js, 'utf8');
    js = js.replace(/<\/script/gi, '<\\/script');
    jsCount++;
    const keep = attrs.filter((a) => !['src', 'data-inline', 'defer', 'async', 'type'].includes(a.name.toLowerCase()));
    const type = attrVal(attrs, 'type');
    if (type && type.toLowerCase() === 'module') keep.unshift({ name: 'type', value: 'module' });
    return `${renderTag('script', keep)}\n${js}\n</script>`;
  });
  if (!jsCount && /<!--#js-->/.test(html)) {
    const p = join(srcDir, 'app.js');
    if (!existsSync(p)) die(`لم يُعثر على ملف السكربت: ${p}`);
    let js = readText(p);
    tally.js += Buffer.byteLength(js, 'utf8');
    js = js.replace(/<\/script/gi, '<\\/script');
    html = html.replace('<!--#js-->', `<script>\n${js}\n</script>`);
    jsCount++;
  }
  if (!jsCount) warn('لا وسم <script … data-inline="js"> في index.html — لم يُدرج أي سكربت.');

  // 5) offline safety
  const { bad, soft } = offlineScan(html);
  for (const s of soft) warn(`رابط نسبي في <a href>: ${s.val} — لن يعمل خارج الشبكة.`);
  if (bad.length) {
    die(`مراجع خارجية/نسبية باقية بعد الإدراج (${bad.length}) — الصفحة لن تعمل بلا إنترنت:`, bad.map((b) => `${b.what}: ${b.val}`));
  }

  // 6) write
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  const total = Buffer.byteLength(html, 'utf8');
  const shell = total - (tally.css + tally.js + tally.fonts + tally.svg + tally.images);

  // BUILD.txt beside the output
  let sha = 'unknown';
  try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: PLATFORM, encoding: 'utf8' }).trim(); } catch { sha = 'unknown'; }
  const buildTxt = [
    `built:        ${new Date().toISOString()}`,
    `git:          ${sha}`,
    `manifest:     ${opts.placeholders ? 'placeholders' : manifest.sha256}`,
    `output:       ${outPath}`,
    `total_bytes:  ${total}`,
    `total:        ${kb(total)}`,
    `shots:        ${tally.shots}`,
    `fonts:        ${tally.fontFiles.map((f) => f.file).join(', ') || '—'}`,
    `svgs:         ${tally.svgFiles.map((f) => f.file).join(', ') || '—'}`,
    '',
  ].join('\n');
  writeFileSync(join(dirname(outPath), 'BUILD.txt'), buildTxt, 'utf8');

  // 7) report
  const rows = [
    ['css', tally.css],
    ['js', tally.js],
    [`fonts (${tally.fontFiles.length})`, tally.fonts],
    [`svg (${tally.svgFiles.length})`, tally.svg],
    [`images (${tally.shots})`, tally.images],
    ['html', shell],
  ];
  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
  console.log('');
  console.log(`  ${pad('part', 16)}${pad('size', 12)}share`);
  console.log(`  ${'─'.repeat(36)}`);
  for (const [name, bytes] of rows) {
    const pct = total ? ((bytes / total) * 100).toFixed(1) : '0.0';
    console.log(`  ${pad(name, 16)}${pad(kb(bytes), 12)}${pct}%`);
  }
  console.log(`  ${'─'.repeat(36)}`);
  console.log(`  ${pad('total', 16)}${pad(kb(total), 12)}${total} bytes`);
  console.log('');
  console.log(`  → ${outPath}`);
  console.log(`  → ${join(dirname(outPath), 'BUILD.txt')}`);
  if (opts.placeholders) console.log('  (وضع اللقطات البديلة — الصور مربّعات متدرّجة معنونة)');
  for (const w of warnings) console.log(`  ⚠ ${w}`);

  if (total > FAIL_BYTES) {
    console.error(`\n✗ الحجم ${kb(total)} تجاوز الحدّ الأقصى ${kb(FAIL_BYTES)}.\n`);
    process.exit(1);
  }
  if (total > WARN_BYTES) {
    console.log(`  ⚠ الحجم ${kb(total)} تجاوز الحدّ المريح ${kb(WARN_BYTES)} — خفّض دقّة اللقطات الثانوية.`);
  }
  console.log('');
  return { total, outPath };
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(`
  node scripts/showcase-build.mjs [--placeholders] [--src showcase/src] [--out showcase/dist/sanad-showcase.html] [--manifest showcase/shots/manifest.json]

    --placeholders   لا تقرأ بيان اللقطات؛ ولّد مربّعات متدرّجة معنونة بمعرّف كل لقطة
    --src <dir>      مجلد المصدر (index.html + styles.css + app.js)
    --out <path>     مسار الملف الناتج
    --manifest <p>   مسار بيان اللقطات
`);
  process.exit(0);
}
build(opts);
