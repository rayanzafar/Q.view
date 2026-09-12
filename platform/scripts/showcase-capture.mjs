#!/usr/bin/env node
// showcase-capture — يلتقط لقطات صفحة العرض («منصة سند») من نسخةٍ محلّية قابلة للرمي أقلعتها
// scripts/showcase-up.mjs، ثم يحوّلها إلى WebP ويكتب بيان اللقطات shots/manifest.json.
//
//   node scripts/showcase-up.mjs --port 4700          # أولاً: النسخة والبيانات
//   node scripts/showcase-capture.mjs                 # كل اللقطات (٤٨)
//   node scripts/showcase-capture.mjs --only ceo-dashboard,m-home
//   node scripts/showcase-capture.mjs --base http://127.0.0.1:4700 --out showcase/shots
//   node scripts/showcase-capture.mjs --no-webp       # PNG فقط (تجربة سريعة)
//
// العنوان ومعرّفات البنود تُقرأ من ملف حالة النسخة (مفتاح `showcase`) — تتغيّر مع كل إقلاع،
// فلا يُكتب أي معرّف في هذا الملف. اللقطة الواحدة: دورٌ واحد، مسارٌ واحد، تحضيرٌ اختياري
// (نقرات/تبويبات)، ثم تجميدُ الحركة وإخفاءُ ما ليس من المنتج (قائمة المستخدم، التنبيهات
// العابرة، فقاعات الجولة، مساعد سند) — بلا مساسٍ بالشريط العلوي ولا بالقائمة الجانبية.
//
// لا تلمس هذه الأداة أي بيئة حيّة: العنوان يجب أن يكون محلّياً (127.0.0.1/localhost).
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath } from './e2e.mjs';
import { DEMO_PW } from './lib/expectations.mjs';

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── الوسائط ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const has = (name) => argv.includes(name);
if (has('--help') || has('-h')) {
  console.log('usage: showcase-capture.mjs [--only id,id] [--base URL] [--state PATH] [--out DIR] [--no-webp] [--keep-png|--no-keep-png]');
  process.exit(0);
}
const WEBP = !has('--no-webp');
const KEEP_PNG = !has('--no-keep-png'); // الافتراض: نُبقي الـPNG الخام (مجلّد raw مستثنى من git)
const ONLY = (flag('--only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const OUT_DIR = resolve(PLATFORM, flag('--out') || 'showcase/shots');
const RAW_DIR = join(OUT_DIR, 'raw');

// ── ملف حالة النسخة ───────────────────────────────────────────────────────────
function stateCandidates() {
  const c = [];
  if (flag('--state')) c.push(resolve(flag('--state')));
  if (process.env.CLAUDE_SCRATCHPAD) c.push(join(process.env.CLAUDE_SCRATCHPAD, 'showcase-instance.json'));
  c.push(join(tmpdir(), 'sanad-qa', 'showcase-instance.json'));
  return c;
}
function readState() {
  for (const p of stateCandidates()) {
    try { return { path: p, ...JSON.parse(readFileSync(p, 'utf8')) }; } catch { /* التالي */ }
  }
  return null;
}
const state = readState();
const BASE = (flag('--base') || state?.base || '').replace(/\/+$/, '');
const IDS = state?.showcase || {};
if (!BASE) {
  console.error('لا عنوان: شغّل `node --experimental-sqlite scripts/showcase-up.mjs --port 4700` أولاً، أو مرّر --base.');
  process.exit(2);
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error(`ممنوع: الالتقاط لا يعمل إلا على نسخةٍ محلّية قابلة للرمي — «${BASE}» ليس كذلك.`);
  process.exit(2);
}

// ── ما يُخفى قبل كل لقطة ──────────────────────────────────────────────────────
// المحدِّدات مأخوذة من src/web/layout.js: زرّ المساعد ولوحه (#ai-fab/#ai-panel)، صندوق البحث
// الشامل (#cmdk-scrim)، بطاقة الجولة (.tourx-*) في pages/guide-tour.js، وبطاقة المستخدم
// (.hdr-user) وزرّ الخروج لأن أسماء الحسابات التجريبية تحمل «(تجريبي)». التنبيه العابر في
// public/app.js عنصرٌ بلا صنف يُنشأ في body بـ z-index:200 — يُطابَق بنمط النمط نفسه.
const FREEZE_CSS = `
  *,*::before,*::after{animation:none!important;animation-duration:0s!important;animation-delay:0s!important;
    transition:none!important;transition-duration:0s!important;transition-delay:0s!important;
    caret-color:transparent!important;scroll-behavior:auto!important}
  #ai-fab,#ai-panel,#cmdk-scrim,
  .tourx-block,.tourx-dim,.tourx-ring,.tourx-card,
  .hdr-user,.hdr-bar form[action="/auth/logout-web"],
  body>div[style*="z-index:200"]{display:none!important}
  ::selection{background:transparent!important}
  ::-webkit-scrollbar{width:0!important;height:0!important}
  html{scrollbar-width:none!important}
`;

// ── التحويل إلى WebP ──────────────────────────────────────────────────────────
// نفس أمر خطة العرض: -resize 75% -quality 78 -define webp:method=6. اللقطات التي نصُّها
// العربي كثيفٌ صغير (جداول، سجل، تقويم) تُرفَع جودتها إلى 84 كي لا يتلبّد الحرف.
const RESIZE = process.env.SHOWCASE_RESIZE || '75%';
const HIGH_Q = new Set(['audit', 'users-grants', 'imports', 'opps-table', 'staffing-grid',
  'tasks-calendar', 'mail', 'org-tree', 'timesheet', 'event-contacts', 'ops-health']);

// ── قائمة اللقطات (٤٨) ────────────────────────────────────────────────────────
// tier: hero → DPR 2 ولقطة إطار العرض؛ grid/element/mobile → DPR 1.5.
const D = { w: 1440, h: 900 };
const S = (o) => o;
// فصول تفصيل المشروع طيّاتٌ (<details class="psec">) مغلقةٌ إلا «نظرة عامة» — تُفتح المطلوبة وحدها
const openOnly = (sec, ...nested) => async (page) => {
  await page.evaluate(({ k, sub }) => {
    document.querySelectorAll('details.psec').forEach((d) => {
      d.open = d.dataset.sec === k || sub.includes(d.dataset.sec);
    });
  }, { k: sec, sub: nested });
  await page.waitForTimeout(400);
};
const SHOTS = [
  // ① الدخول
  S({ id: 'login-otp', role: null, tier: 'hero', viewport: 'desktop', size: D, route: '/login',
    prep: async (page) => {
      await page.goto(`${BASE}/login?reset=1`, { waitUntil: 'domcontentloaded' });
      await page.fill('[name=email]', 'sara.alharbi@evc.com.sa');
      await Promise.all([page.waitForURL('**/login', { timeout: 15000 }),
        page.click('form[action="/auth/otp/request-web"] button[type=submit]')]);
    } }),

  // ② صفحتي والقيادة
  S({ id: 'home', role: 'demo.sectorlead', tier: 'hero', viewport: 'desktop', size: D, route: '/app/home' }),
  S({ id: 'ceo-dashboard', role: 'demo.ceo', tier: 'hero', viewport: 'desktop', size: D, route: '/app/ceo' }),
  S({ id: 'ceo-forecast', role: 'demo.ceo', tier: 'grid', viewport: 'element', size: D, route: '/app/ceo',
    el: 'main div[style*="linear-gradient(135deg,#0f2350"]' }),
  S({ id: 'ceo-drill', role: 'demo.ceo', tier: 'hero', viewport: 'desktop', size: D, route: '/app/ceo',
    after: async (page) => {
      await page.evaluate(() => window.Sanad && window.Sanad.openDD('pipeline'));
      await page.waitForSelector('#modal.on .modal-card', { timeout: 8000 });
      await page.waitForTimeout(250);
    } }),
  S({ id: 'portfolio', role: 'demo.ceo', tier: 'hero', viewport: 'desktop', size: D, route: '/app/portfolio' }),

  // ③ مركز القطاع
  S({ id: 'sector-pulse', role: 'demo.ceo', tier: 'hero', viewport: 'tall', size: { w: 1440, h: 1800 },
    route: '/app/sector?sector=SOLUTIONS&tab=pulse' }),
  S({ id: 'sector-com', role: 'demo.ceo', tier: 'hero', viewport: 'tall', size: { w: 1440, h: 1800 },
    route: '/app/sector?sector=SOLUTIONS&tab=com' }),
  S({ id: 'sector-ops', role: 'demo.ceo', tier: 'hero', viewport: 'tall', size: { w: 1440, h: 1800 },
    route: '/app/sector?sector=SOLUTIONS&tab=ops' }),
  S({ id: 'sector-hr', role: 'demo.ceo', tier: 'hero', viewport: 'tall', size: { w: 1440, h: 1800 },
    route: '/app/sector?sector=SOLUTIONS&tab=hr' }),

  // ④ الفرص
  S({ id: 'opps-kanban', role: 'demo.bdhead', tier: 'hero', viewport: 'tall', size: { w: 1440, h: 1150 },
    route: '/app/opportunities' }),
  // مبدِّل «كانبان/جدول» في شاشة الفرص عميلٌ لا رابط (Sanad.pmoView في public/app.js:213) —
  // و`?view=table` لا يعني إلا جدولَ المرحلة المحسومة. فالجدول يُفتح بالمبدِّل نفسه.
  S({ id: 'opps-table', role: 'demo.bdhead', tier: 'hero', viewport: 'tall', size: { w: 1440, h: 1150 },
    route: '/app/opportunities',
    after: async (page) => {
      await page.evaluate(() => window.Sanad && window.Sanad.pmoView('opp', 'table'));
      await page.waitForTimeout(250);
    } }),
  S({ id: 'opps-preview', role: 'demo.bdhead', tier: 'hero', viewport: 'desktop', size: D, route: '/app/opportunities',
    after: async (page) => {
      // كل فرصةٍ في هذا الزرع مملوكةٌ لحسابٍ تجريبي، فاسم المالك لا مفرّ منه — لكن نتخيّر
      // بطاقةً حيّة: لها نشاطٌ مسجَّل وليست «متوقفة»، كي لا تكون المعاينة كلها حالاتٍ فارغة.
      const cards = page.locator('.kcard[data-action="opp-preview"]');
      const n = Math.min(await cards.count(), 24);
      for (let i = 0; i < n; i++) {
        await cards.nth(i).click();
        await page.waitForSelector('#drawer.on', { timeout: 10000 });
        await page.waitForFunction(() => (document.getElementById('drawer')?.innerText || '').length > 120,
          null, { timeout: 8000 }).catch(() => {});
        const txt = await page.locator('#drawer').innerText();
        if (!/متوقفة|لا نشاط مسجّل بعد/.test(txt)) return;
        await page.evaluate(() => window.Sanad && window.Sanad.closeDrawer());
        await page.waitForTimeout(120);
      }
      await cards.first().click();
      await page.waitForSelector('#drawer.on', { timeout: 10000 });
      await page.waitForTimeout(300);
    } }),
  S({ id: 'opp-detail', role: 'demo.bdhead', tier: 'hero', viewport: 'tall', size: { w: 1440, h: 1000 },
    fullPage: true, route: (i) => `/app/opportunity/${i.opportunityId}` }),
  S({ id: 'opp-activity', role: 'demo.bdhead', tier: 'hero', viewport: 'desktop', size: D,
    route: (i) => `/app/opportunity/${i.opportunityId}?tab=activity` }),

  // ⑤ المشاريع والمخرجات
  S({ id: 'projects-table', role: 'demo.ceo', tier: 'hero', viewport: 'tall', size: { w: 1440, h: 1800 },
    route: '/app/projects' }),
  S({ id: 'projects-kanban', role: 'demo.ceo', tier: 'hero', viewport: 'tall', size: { w: 1440, h: 1750 },
    route: '/app/projects?view=kanban' }),
  S({ id: 'project-detail', role: 'demo.admin', tier: 'hero', viewport: 'tall', size: { w: 1440, h: 1400 },
    route: (i) => `/app/project/${i.projectId}` }),
  S({ id: 'project-deliverables', role: 'demo.admin', tier: 'grid', viewport: 'element', size: { w: 1440, h: 1200 },
    route: (i) => `/app/project/${i.projectId}`, el: '#sec-deliverables', after: openOnly('deliverables') }),

  // ⑥ المهام والحِمل والاعتمادات
  S({ id: 'tasks-list', role: 'demo.consultant', tier: 'hero', viewport: 'desktop', size: D, route: '/app/tasks?win=all' }),
  S({ id: 'tasks-board', role: 'demo.consultant', tier: 'hero', viewport: 'desktop', size: D, route: '/app/tasks?view=board' }),
  S({ id: 'tasks-calendar', role: 'demo.linemgr', tier: 'hero', viewport: 'desktop', size: D, route: '/app/tasks?view=calendar&who=team' }),
  S({ id: 'task-drawer', role: 'demo.consultant', tier: 'hero', viewport: 'desktop', size: D, route: '/app/tasks?win=all',
    after: async (page) => {
      await page.locator('[data-action="task-open"]').first().click();
      await page.waitForSelector('#drawer.on', { timeout: 10000 });
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        const sel = window.getSelection(); if (sel) sel.removeAllRanges();
      });
    } }),
  S({ id: 'workload-gauge', role: 'demo.consultant', tier: 'grid', viewport: 'element', size: D,
    route: '/app/home', el: '.hm-panel' }),
  S({ id: 'approvals', role: 'demo.sectorlead', tier: 'hero', viewport: 'desktop', size: D, route: '/app/approvals' }),

  // ⑦ التسكين والفريق والوقت
  S({ id: 'staffing-grid', role: 'demo.hr', tier: 'hero', viewport: 'tall', size: { w: 1440, h: 1100 }, route: '/app/staffing' }),
  S({ id: 'team-roster', role: 'demo.hr', tier: 'hero', viewport: 'desktop', size: D, route: '/app/team' }),
  // «الوقت» شاشةٌ أُلغيت بقرار المالك (PAGE_ACCESS.timesheet ‎=> false في core/policy/pages.js)
  // فلا تُفتح لأي دور، وصفحةُ الشخص بديلٌ سيّئ هنا لأن اسمها اسمُ الحساب التجريبي. والسؤال
  // نفسه — كم من وقت هذا الشخص محجوز، شهراً بشهر — تجيبه نافذةُ الفرد في «البشري» بأسماء
  // الموظفين المُختلَقة: شريط حِمل اثني عشر شهراً ومشاريعه وفرصه.
  S({ id: 'timesheet', role: 'demo.ceo', tier: 'grid', viewport: 'desktop', size: D,
    route: '/app/sector?sector=SOLUTIONS&tab=hr',
    after: async (page) => {
      await page.locator('[data-action="cap-person"]').first().click();
      await page.waitForSelector('#modal.on .modal-card', { timeout: 10000 });
      await page.waitForTimeout(350);
    } }),

  // ⑧ الفعاليات
  S({ id: 'events-capture', role: 'demo.admin', tier: 'grid', viewport: 'desktop', size: D,
    route: (i) => `/app/event/${i.eventRunningId}?tab=capture` }),
  S({ id: 'event-contacts', role: 'demo.admin', tier: 'grid', viewport: 'desktop', size: D,
    route: (i) => `/app/event/${i.eventRunningId}?tab=contacts` }),
  S({ id: 'event-meetings', role: 'demo.admin', tier: 'grid', viewport: 'desktop', size: D,
    route: (i) => `/app/event/${i.eventRunningId}?tab=meetings` }),

  // ⑨ العملاء والمال
  S({ id: 'clients', role: 'demo.admin', tier: 'grid', viewport: 'desktop', size: D, route: '/app/clients' }),
  S({ id: 'client-360', role: 'demo.admin', tier: 'grid', viewport: 'desktop', size: D, route: (i) => `/app/client/${i.clientId}` }),
  // «المالية والعقود» وصفحةُ العقد أُلغيتا بقرار المالك كذلك (PAGE_ACCESS.finance ‎=> false،
  // و DETAIL_ACCESS.contract مشتقٌّ منها) — والبيانات باقية تُقرأ من لوحة مال المشروع:
  // قيمة العقد، والمستخلصات، والإيراد المسجَّل شهراً بشهر.
  S({ id: 'finance', role: 'demo.admin', tier: 'grid', viewport: 'tall', size: { w: 1440, h: 1150 }, route: (i) => `/app/project/${i.projectId}`, after: openOnly('money', 'money-board') }),
  S({ id: 'contract-detail', role: 'demo.admin', tier: 'grid', viewport: 'element', size: { w: 1440, h: 1200 },
    route: (i) => `/app/project/${i.projectId}`, el: '#sec-money', after: openOnly('money', 'money-board') }),

  // ⑩ ما وراء الشاشات الستّ
  S({ id: 'reports', role: 'demo.admin', tier: 'grid', viewport: 'desktop', size: D, route: '/app/reports' }),
  S({ id: 'mail', role: 'demo.admin', tier: 'grid', viewport: 'desktop', size: D, route: '/app/mail' }),
  S({ id: 'org-tree', role: 'demo.admin', tier: 'grid', viewport: 'desktop', size: D, route: '/app/org' }),
  S({ id: 'users-grants', role: 'demo.admin', tier: 'grid', viewport: 'desktop', size: D, route: '/app/users' }),
  // سجل الحركة: أحدث صفوفه هي دخول أداة الالتقاط نفسها (اسم الجلسة sess_…) — لا تخصّ
  // المنتج ولا يفهمها المشاهد، فتُزال من الصورة وحدها قبل اللقطة (تجميلٌ عند الالتقاط،
  // لا مساس بالبيانات ولا بالصفحة الحيّة).
  S({ id: 'audit', role: 'demo.admin', tier: 'grid', viewport: 'desktop', size: D, route: '/app/audit',
    after: async (page) => {
      await page.evaluate(() => {
        for (const tr of document.querySelectorAll('table tbody tr')) {
          if ((tr.textContent || '').includes('sess_')) tr.remove();
        }
      });
      await page.waitForTimeout(150);
    } }),
  S({ id: 'ops-health', role: 'demo.admin', tier: 'grid', viewport: 'desktop', size: D, route: '/app/ops' }),
  S({ id: 'imports', role: 'demo.admin', tier: 'grid', viewport: 'desktop', size: D, route: '/app/imports' }),
  S({ id: 'guide', role: 'demo.admin', tier: 'grid', viewport: 'desktop', size: D, route: '/app/guide' }),

  // ⑪ الجوال
  S({ id: 'm-home', role: 'demo.sectorlead', tier: 'mobile', viewport: 'mobile', size: { w: 390, h: 844 }, route: '/app/home' }),
  S({ id: 'm-tasks', role: 'demo.consultant', tier: 'mobile', viewport: 'mobile', size: { w: 390, h: 844 }, route: '/app/tasks' }),
  S({ id: 'm-opps', role: 'demo.bdhead', tier: 'mobile', viewport: 'mobile', size: { w: 390, h: 844 }, route: '/app/opportunities' }),
  S({ id: 'm-sector', role: 'demo.sectorlead', tier: 'mobile', viewport: 'mobile', size: { w: 390, h: 844 }, route: '/app/sector' }),
  S({ id: 'm-approvals', role: 'demo.sectorlead', tier: 'mobile', viewport: 'mobile', size: { w: 390, h: 844 }, route: '/app/approvals' }),
  S({ id: 'm-events', role: 'demo.admin', tier: 'mobile', viewport: 'mobile', size: { w: 390, h: 844 }, route: '/app/events' }),
];

// ── التنفيذ ───────────────────────────────────────────────────────────────────
const wanted = ONLY.length ? SHOTS.filter((s) => ONLY.includes(s.id)) : SHOTS;
if (ONLY.length) {
  const missing = ONLY.filter((id) => !SHOTS.some((s) => s.id === id));
  if (missing.length) { console.error(`لقطات غير معروفة: ${missing.join('، ')}`); process.exit(2); }
}
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(RAW_DIR, { recursive: true });

const dprOf = (s) => (s.tier === 'hero' ? 2 : 1.5);
const sizeOf = (s) => (typeof s.size === 'function' ? s.size(IDS) : s.size);
const routeOf = (s) => (typeof s.route === 'function' ? s.route(IDS) : s.route);

const { chromium } = await import('playwright');
const exe = chromiumPath();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
console.log(`showcase-capture → ${BASE}\nالحالة: ${state?.path || '(—)'}\nالمخرج: ${OUT_DIR}\nchromium: ${exe || '(playwright)'}`);

// سياقٌ واحد لكل (دور × مقاس × كثافة) يُعاد استخدامه، ولكلٍّ عنوانُه كي لا يُستنزف حدّ الدخول
// (loginLimiter: سعة ١٠ لكل عنوان — src/core/http/security.js).
const contexts = new Map();
let ipSeq = 0;
async function getContext(role, size, dpr) {
  const key = `${role || '-'}|${size.w}x${size.h}|${dpr}`;
  if (contexts.has(key)) return contexts.get(key);
  ipSeq += 1;
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: dpr,
    isMobile: size.w <= 480,
    hasTouch: size.w <= 480,
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
    reducedMotion: 'reduce',
    extraHTTPHeaders: { 'x-forwarded-for': `10.90.${Math.floor(ipSeq / 250) + 1}.${(ipSeq % 250) + 1}` },
  });
  const page = await ctx.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (role && !(await login(page, role))) throw new Error(`تعذّر الدخول بـ ${role}`);
  const entry = { ctx, page };
  contexts.set(key, entry);
  return entry;
}

// نفس دالة scripts/evidence.mjs: كلمة المرور بديلٌ مطويّ داخل <details> منذ صار الدخول بالرمز.
async function login(page, username) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const disclosure = page.locator('.alt2 summary');
      if (await disclosure.count()) await disclosure.click();
      await page.fill('[name=username]', username);
      await page.fill('[name=password]', DEMO_PW);
      await Promise.all([page.waitForURL('**/app/**', { timeout: 20000 }),
        page.click('form[action="/auth/login-web"] button[type=submit]')]);
      return true;
    } catch (e) {
      if (attempt === 0) { await page.waitForTimeout(7000); continue; }
      console.error(`  ✗ دخول ${username}: ${e.message.split('\n')[0]}`);
      return false;
    }
  }
  return false;
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(400);
}

function imageSize(file) {
  try {
    const out = execFileSync('identify', ['-format', '%w %h', file], { encoding: 'utf8' }).trim();
    const [w, h] = out.split(/\s+/).map(Number);
    if (w && h) return { w, h };
  } catch { /* المسار الاحتياطي أدناه */ }
  return null;
}

const results = [];
const problems = [];
for (const shot of wanted) {
  const size = sizeOf(shot);
  const dpr = dprOf(shot);
  const route = routeOf(shot);
  const pngPath = join(RAW_DIR, `${shot.id}.png`);
  try {
    const { page } = await getContext(shot.role, size, dpr);
    await page.setViewportSize({ width: size.w, height: size.h });
    if (shot.prep) await shot.prep(page, IDS);
    else await page.goto(BASE + route, { waitUntil: 'load', timeout: 40000 });
    await settle(page);
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.evaluate(() => { window.scrollTo(0, 0); if (document.querySelector('main')) document.querySelector('main').scrollTop = 0; });
    if (shot.after) await shot.after(page, IDS);
    // النقر على عنصرٍ أسفل الطيّة يُمرّر الصفحة إليه، فيخرج الشريط العلوي من الصورة — تُعاد
    // الصفحة إلى رأسها بعد التحضير (النوافذ والأدراج ثابتة الموضع فلا يزيحها التمرير).
    await page.evaluate(({ sel, off }) => {
      if (!sel) { window.scrollTo(0, 0); return; }
      const el = document.querySelector(sel); if (!el) { window.scrollTo(0, 0); return; }
      window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - (off || 0)));
    }, { sel: shot.scrollTo || null, off: shot.scrollOffset });
    await page.waitForTimeout(250);

    if (shot.el) {
      const loc = page.locator(shot.el).first();
      await loc.waitFor({ state: 'visible', timeout: 15000 });
      await loc.screenshot({ path: pngPath, animations: 'disabled', scale: 'device' });
    } else {
      await page.screenshot({ path: pngPath, fullPage: !!shot.fullPage, animations: 'disabled', scale: 'device' });
    }
  } catch (e) {
    problems.push(`${shot.id}: ${e.message.split('\n')[0]}`);
    console.error(`  ✗ ${shot.id} — ${e.message.split('\n')[0]}`);
    continue;
  }

  // PNG → WebP (نفس أمر خطة العرض؛ الجودة تُرفع لِما فيه نصٌّ عربي كثيف)
  let file = `raw/${shot.id}.png`;
  let outPath = pngPath;
  if (WEBP) {
    const q = HIGH_Q.has(shot.id) ? 84 : 78;
    const webpPath = join(OUT_DIR, `${shot.id}.webp`);
    execFileSync('convert', [pngPath, '-strip', '-resize', RESIZE, '-quality', String(q),
      '-define', 'webp:method=6', webpPath]);
    file = `${shot.id}.webp`;
    outPath = webpPath;
  }
  if (!KEEP_PNG && WEBP) rmSync(pngPath, { force: true });

  const dim = imageSize(outPath) || { w: 0, h: 0 };
  const bytes = statSync(outPath).size;
  results.push({ id: shot.id, file, w: dim.w, h: dim.h, bytes, route, role: shot.role, viewport: shot.viewport });
  console.log(`  ✓ ${shot.id.padEnd(20)} ${String(dim.w).padStart(5)}×${String(dim.h).padEnd(5)} ${(bytes / 1024).toFixed(0).padStart(5)} KB  ${shot.role || '—'}  ${route}`);
}

for (const { ctx } of contexts.values()) await ctx.close();
await browser.close();

// ── البيان ────────────────────────────────────────────────────────────────────
const manifestPath = join(OUT_DIR, 'manifest.json');
let shotsOut = results;
if (ONLY.length && existsSync(manifestPath)) {
  // التقاطٌ جزئي: نُحدّث الصفوف المُلتقطة ونُبقي البقية كما هي (ترتيب SHOTS هو المرجع)
  let prev = [];
  try { prev = JSON.parse(readFileSync(manifestPath, 'utf8')).shots || []; } catch { /* بيانٌ جديد */ }
  const byId = new Map(prev.map((r) => [r.id, r]));
  for (const r of results) byId.set(r.id, r);
  shotsOut = SHOTS.map((s) => byId.get(s.id)).filter(Boolean);
}
writeFileSync(manifestPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(), base: BASE, shots: shotsOut,
}, null, 2)}\n`);

const total = shotsOut.reduce((s, r) => s + r.bytes, 0);
console.log(`\nالبيان: ${manifestPath} — ${shotsOut.length} لقطة`);
console.log(`المجموع: ${(total / 1048576).toFixed(2)} م.ب${total > 6.5 * 1048576 ? '  ⚠ فوق ٦٫٥ م.ب — أعد التحويل بـ -resize 66% لطبقة الشبكة' : ''}`);
if (problems.length) {
  console.log(`\n✗ ${problems.length} لقطة لم تُلتقط:`);
  for (const p of problems) console.log(`   ${p}`);
  process.exitCode = 1;
}
