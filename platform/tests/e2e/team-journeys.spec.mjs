// رحلات «الفريق والموارد» السبع (الموجّه §17.4) كما يعيشها المستخدم على متصفّح حقيقي.
//
// كل رحلة تبدأ من الشاشة التي يفتحها الشخص فعلاً (S01…S25) وتنتهي عند أثرٍ يؤكّده الخادم:
// ردُّ واجهةٍ يُنتظر بـ waitForResponse، أو حالةٌ في الصفحة بعد إعادة التحميل — لا نقرة بلا خبر.
// البيانات تُبنى داخل الحارة عبر واجهة البرمجة الحقيقية بجلسات الأدوار نفسها (لا كتابة مباشرة
// في القاعدة): إدارةٌ يقودها مدير الإدارة التجريبي، وثلاثة موارد (داخلي/خارجي/شريك)، وتسكينات
// بأسماء من الشهر الجاري — فالبذرة الأصلية بلا إدارات ولا تسكينات في الأشهر القادمة، وتسكينُها
// الوحيد (FX-ALL-1) مربوط بسنة 2026 فلا يُبنى عليه شيء يعتمد على ساعة الحائط.
//
// على كل صفحة تُزار: لا فيض أفقي على 1440، لا تسرّب (undefined|NaN|[object|null) في النص،
// ولا أخطاء طرفية. والصور في docs/evidence/2026-09-05/e2e-team/<journey>-<step>.png.
//
// ما لا تستطيع الرحلة إتمامه بسبب المنتج لا يُلوى الفحص ليمرّ: يبقى سطر ✗ بسببه الدقيق.
// (الجولة الأولى كشفت ثلاثة عيوب أُصلحت في المنتج — سجل التنفيذ §4.2: زرّ عنوان البوابة الصامت،
// مدير المشروع المحجوب عن التخطيط رغم أن الخدمة تقبل طلبه، والكود المالي للمشروع بلا مسار كتابة.)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { login, open, collectErrors, realConsoleErrors } from './_helpers.mjs';

const SECTOR = 'SOLUTIONS';
const PRJ1 = 'FX-PRJ-1';                    // مشروع منصة الخدمات الموحدة
const PRJ2 = 'FX-PRJ-2';                    // مشروع تطوير القدرات الرقمية
const PRJ2_NAME = 'مشروع تطوير القدرات الرقمية';
const PRJ1_NAME = 'مشروع منصة الخدمات الموحدة';
const DEPT_NAME = 'إدارة الحلول الرقمية';
const LEAK = /\bundefined\b|\bNaN\b|\[object\b|\bnull\b/g;
const TAB_LABELS = { work: 'العمل المرتبط', tasks: 'المهام', skills: 'القدرات والتطور', engagement: 'الارتباط والطاقة', audit: 'سجل التغييرات' };

// ── الأشهر: تُحسب مرةً واحدة عند بدء الحارة وتُمرَّر نصاً — لا ساعة حائط داخل الفحوص ──
const pad2 = (n) => String(n).padStart(2, '0');
const mk = (y, m) => `${y}-${pad2(m)}`;
const addM = (y, m, n) => { const i = y * 12 + (m - 1) + n; return { y: Math.floor(i / 12), m: (i % 12) + 1 }; };

export default async function teamJourneysSpec({ browser, base, t, platformRoot }) {
  const check = (name, ok, detail) => (ok ? t.pass(name) : t.fail(name, detail));
  const shotsDir = join(platformRoot, 'docs/evidence/2026-09-05/e2e-team');
  mkdirSync(shotsDir, { recursive: true });

  const now = new Date();
  const Y = now.getUTCFullYear(); const M = now.getUTCMonth() + 1;
  const cur = mk(Y, M);
  const n1 = addM(Y, M, 1); const n2 = addM(Y, M, 2); const pv = addM(Y, M, -1);
  const next1 = mk(n1.y, n1.m); const next2 = mk(n2.y, n2.m);
  // طلب التسكين الواحد يغطي سنةً واحدة (خدمة التسكين) — فمدى يعبر السنة يُقصّ إلى ديسمبر.
  const to2 = n2.y === Y ? next2 : mk(Y, 12);
  const to2Clamped = to2 !== next2;
  const pendTo = n2.y === n1.y ? next2 : mk(n1.y, 12);

  // ── جلسة لكل شخصية: تسجيل دخول واحد يُعاد استعماله عبر الرحلات (حدّ محاولات الدخول حقيقي) ──
  const sessions = new Map();
  async function as(username) {
    if (sessions.has(username)) return sessions.get(username);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    const errors = collectErrors(page);
    await login(page, base, username);
    const s = { username, ctx, page, errors, seen: { c: 0, p: 0 } };
    sessions.set(username, s);
    return s;
  }
  const api = async (s, method, path, body) => {
    const r = await s.page.request.fetch(base + '/api' + path, { method, data: body === undefined ? undefined : body,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' } });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status(), json, text, headers: r.headers() };
  };
  const errMsg = (r) => (r.json && r.json.error && r.json.error.message) || r.text.slice(0, 160);
  const shot = (s, name) => s.page.screenshot({ path: join(shotsDir, `${name}.png`) });
  const waitApi = (page, method, part) => page.waitForResponse((r) => r.request().method() === method && r.url().includes(part), { timeout: 20000 });
  // جسم الردّ قد لا يُقرأ حين يعيد العميل تحميل الصفحة فور وصوله — فالحكم الأول لما تعرضه الصفحة
  // بعد التحديث (وهو ما كتبه الخادم)، والجسم شاهدٌ إضافي حين يتوفر.
  const jsonOf = async (res) => { try { return await res.json(); } catch { return null; } };
  const txt = (page, sel) => page.locator(sel).first().textContent().then((x) => (x || '').trim(), () => '');

  // فحص الصفحة الواحد: فيض أفقي، تسرّب نصّي خارج السكربت، وأخطاء طرفية جديدة منذ آخر فحص.
  async function pageCheck(s, label) {
    const r = await s.page.evaluate((re) => {
      const de = document.documentElement;
      const body = document.body ? (document.body.innerText || '') : '';
      const m = body.match(new RegExp(re, 'g'));
      return { overflow: de.scrollWidth - de.clientWidth, leaks: m ? [...new Set(m)] : [], where: location.pathname + location.search };
    }, LEAK.source);
    const fresh = realConsoleErrors(s.errors.consoleErrors.slice(s.seen.c)).concat(s.errors.pageErrors.slice(s.seen.p));
    s.seen = { c: s.errors.consoleErrors.length, p: s.errors.pageErrors.length };
    const bad = [];
    if (r.overflow > 0) bad.push(`فيض أفقي ${r.overflow}px`);
    if (r.leaks.length) bad.push(`تسرّب: ${r.leaks.join('، ')}`);
    if (fresh.length) bad.push(`أخطاء طرفية: ${fresh.slice(0, 3).join(' | ').slice(0, 300)}`);
    check(`${label} — الصفحة سليمة (${r.where})`, !bad.length, bad.join(' · '));
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // التهيئة عبر واجهة البرمجة الحقيقية: الهوية، الإدارة ومديرها، الموارد الثلاثة، ونقل FX-EMP-1/2
  // ═══════════════════════════════════════════════════════════════════════════════════════
  const admin = await as('demo.admin');
  const users = await api(admin, 'GET', '/identity/users');
  const userOf = (u) => (users.json || []).find((x) => x.username === u) || null;
  const deptmgr = userOf('demo.deptmgr'); const pmUser = userOf('demo.pm'); const bdUser = userOf('demo.bd');
  check('تهيئة · حسابات العرض معروفة (مدير الإدارة، مدير المشروع، تطوير الأعمال)', !!(deptmgr && pmUser && bdUser),
    `users=${users.status} deptmgr=${!!deptmgr} pm=${!!pmUser} bd=${!!bdUser}`);

  const dep = await api(admin, 'POST', '/org/departments', { sector_id: SECTOR, name_ar: DEPT_NAME, manager_user_id: deptmgr?.id });
  const depId = dep.json?.id || null;
  check('تهيئة · إدارة جديدة في قطاع الحلول يقودها مدير الإدارة التجريبي', dep.status === 200 && !!depId && dep.json.manager_user_id === deptmgr?.id,
    `HTTP ${dep.status} ${errMsg(dep)}`);

  const lead = await as('demo.sectorlead');
  const mkRes = async (label, body) => {
    const r = await api(lead, 'POST', '/team/resources', { sector_id: SECTOR, department_id: depId, ...body });
    const id = r.json?.resource?.id || null;
    check(`تهيئة · مورد ${label} «${body.name_ar}» أُنشئ في الإدارة`, r.status === 200 && !!id && r.json.resource.department_id === depId, `HTTP ${r.status} ${errMsg(r)}`);
    return id;
  };
  const R4 = await mkRes('داخلي', { name_ar: 'عبدالله المطيري', job_title: 'مهندس بيانات', resource_type: 'internal', capacity_pct: 100, hire_date: '2026-01-01' });
  const R5 = await mkRes('خارجي', { name_ar: 'ليلى الزهراني', job_title: 'مستشارة خارجية', resource_type: 'external', capacity_pct: 50, hire_date: '2026-02-01', vendor_name: 'شركة الاستشارات المتحدة' });
  const R6 = await mkRes('شريك', { name_ar: 'تركي الشهري', job_title: 'شريك تنفيذ', resource_type: 'partner', capacity_pct: 100, hire_date: '2026-03-01', vendor_name: 'شركاء التقنية', end_date: `${Y + 1}-12-31` });
  const R4_NAME = 'عبدالله المطيري'; const R5_NAME = 'ليلى الزهراني'; const R6_NAME = 'تركي الشهري';
  for (const eid of ['FX-EMP-1', 'FX-EMP-2']) {
    const r = await api(lead, 'PATCH', `/team/resources/${eid}`, { department_id: depId });
    check(`تهيئة · ${eid} نُقل إلى الإدارة`, r.status === 200 && (r.json?.resource?.department_id || r.json?.department_id) === depId, `HTTP ${r.status} ${errMsg(r)}`);
  }

  // التجاوز الذي ترصده الرحلتان ٤ و٥ (يُطبَّق مباشرةً بصلاحية قائد القطاع — لا طلبٌ معلَّق):
  // مشروع 80% من الشهر الجاري ثلاثة أشهر + عمل داخلي 40% في الشهر الجاري ⇐ 120%.
  const submitAs = async (s, change, key) => api(s, 'POST', '/team/allocations/requests', { change, idempotencyKey: key });
  const a1 = await submitAs(lead, { kind: 'new', employeeId: R4, target: { kind: 'project', id: PRJ1 }, from: cur, to: to2, pct: 80, allocStatus: 'confirmed' }, `e2e-j4-prj-${Date.now()}`);
  check(`تهيئة الرحلة ٤ · ${R4_NAME} على «${PRJ1_NAME}» 80% (${cur} – ${to2}) طُبّق مباشرة`, a1.status === 200 && a1.json?.requests?.[0]?.status === 'applied',
    `HTTP ${a1.status} ${errMsg(a1)} status=${a1.json?.requests?.[0]?.status}`);
  const a2 = await submitAs(lead, { kind: 'new', employeeId: R4, target: { kind: 'bucket', id: 'bd' }, from: cur, to: cur, pct: 40, allocStatus: 'confirmed' }, `e2e-j4-bkt-${Date.now()}`);
  check(`تهيئة الرحلة ٤ · ${R4_NAME} على «تطوير أعمال» 40% في ${cur} طُبّق مباشرة`, a2.status === 200 && a2.json?.requests?.[0]?.status === 'applied',
    `HTTP ${a2.status} ${errMsg(a2)} status=${a2.json?.requests?.[0]?.status}`);
  // الإقفال (الرحلة ٧) يقرأ الشهر المنقضي: تسكينٌ مؤكد للشريك على مشروعٍ بلا كود مالي فيه
  // ⇐ مسودة «مشروع 60 / قطاع 40» باستثناء «كود مالي مفقود» — لا يعتمد على تسكين البذرة المربوط بـ2026.
  const prevKey = mk(pv.y, pv.m);
  const a3 = await submitAs(lead, { kind: 'new', employeeId: R6, target: { kind: 'project', id: PRJ1 }, from: prevKey, to: prevKey, pct: 60, allocStatus: 'confirmed' }, `e2e-j7-prev-${Date.now()}`);
  check(`تهيئة الرحلة ٧ · ${R6_NAME} على «${PRJ1_NAME}» 60% في الشهر المنقضي ${prevKey} طُبّق مباشرة`, a3.status === 200 && a3.json?.requests?.[0]?.status === 'applied',
    `HTTP ${a3.status} ${errMsg(a3)} status=${a3.json?.requests?.[0]?.status}`);
  await shot(lead, 'setup-00-api-done');

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // الرحلة ١ — S01 ⇐ S02 ⇐ S03 ⇐ S04 ثم التبويبات S05–S10 ثم الرجوع بالمرشّح نفسه
  // ═══════════════════════════════════════════════════════════════════════════════════════
  {
    const s = lead; const { page } = s;
    const res = await open(page, base, '/app/team');
    check('J1 · بوابة الفريق تُفتح لقائد القطاع', res && res.status() === 200, `HTTP ${res?.status()}`);
    const cards = await page.locator('.tm-path[data-action="path-select"]').count();
    check('J1 · S01 تعرض أربع بطاقات مسار', cards === 4, `بطاقات=${cards}`);
    await pageCheck(s, 'J1 · S01');
    await shot(s, 'j1-01-gateway');

    // عنوان البطاقة هو عنصرها التفاعلي المعلن (زرٌّ بـaria-expanded) — فالنقر عليه هو ما يفعله المستخدم.
    const readPv = () => page.evaluate(() => {
      const p = document.getElementById('tm-gw-pv-people');
      const ttl = document.querySelector('.tm-path[data-path="people"] .tm-path-ttl, .tm-path[data-path="people"] .ttl');
      return { visible: !!p && !p.hidden && p.getBoundingClientRect().height > 0, url: location.search, title: p?.querySelector('.ph .t')?.textContent.trim() || '',
        ttlTag: ttl?.tagName || '', expanded: ttl?.getAttribute('aria-expanded') || '' };
    });
    await page.click('.tm-path[data-path="people"] .ttl');
    await page.waitForTimeout(300);
    const pv1 = await readPv();
    check('J1 · النقر على عنوان «الفريق والقدرات» (زر البطاقة المعلن) يُظهر معاينة المسار ويحفظه في الرابط', pv1.visible && /path=people/.test(pv1.url) && /الفريق والقدرات/.test(pv1.title),
      `${JSON.stringify(pv1)} — العنوان زرّ <${pv1.ttlTag}> بـdata-action="path-select" (gateway.js:134) لكن تفويض النقر يتجاهل أي نقرة على a,button (team-resources.js:226) فلا تُفتح المعاينة، ومسار لوحة المفاتيح يعيد النقر نفسه`);
    if (!pv1.visible) {
      // بديل للمتابعة: النقر على جسم البطاقة (خارج الزر) — المسار الوحيد الذي يعمل حالياً.
      await page.click('.tm-path[data-path="people"] .blurb');
      await page.waitForTimeout(300);
      const pv2 = await readPv();
      check('J1 · (بديل) النقر على جسم البطاقة يُظهر المعاينة ويحفظ ?path=people', pv2.visible && /path=people/.test(pv2.url) && pv2.expanded === 'true', JSON.stringify(pv2));
    }
    await shot(s, 'j1-02-preview');

    await Promise.all([page.waitForURL('**/app/team/resources**', { timeout: 15000 }), page.click('#tm-gw-pv-people a.btn-primary')]);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    check('J1 · «فتح المسار» يصل إلى سجل الموارد S02', /\/app\/team\/resources/.test(page.url()), page.url());
    await pageCheck(s, 'J1 · S02 بلا مرشّح');

    const res2 = await open(page, base, `/app/team/resources?q=${encodeURIComponent(R5_NAME)}`);
    const dir = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('tr[data-action="resource-preview"]')].map((r) => r.dataset.name),
      foot: document.querySelector('.tm-res-foot .tnum')?.textContent.trim() || '',
      q: document.querySelector('#tm-res-filters [name="q"]')?.value || '',
    }));
    check(`J1 · S02 بالمرشّح q=«${R5_NAME}» يعرض صفاً واحداً هو المطلوب`, res2?.status() === 200 && dir.rows.length === 1 && dir.rows[0] === R5_NAME, JSON.stringify(dir));
    check('J1 · S02 الترقيم يقول «1–1 من 1»', dir.foot === '1–1 من 1', `foot=${dir.foot}`);
    await pageCheck(s, 'J1 · S02 بالمرشّح');
    await shot(s, 'j1-03-directory-filtered');

    const [pvRes] = await Promise.all([waitApi(page, 'GET', `/api/team/resources/${R5}/preview`), page.click(`tr[data-action="resource-preview"][data-emp="${R5}"] td:first-child`)]);
    await page.waitForFunction(() => !!document.querySelector('#tm-pv-foot a.btn-primary'), null, { timeout: 8000 }).catch(() => {});
    const drawer = await page.evaluate(() => {
      const d = document.getElementById('tm-pv');
      return { open: !!d && !d.hidden && d.classList.contains('open'), name: document.getElementById('tm-pv-name')?.textContent.trim() || '',
        full: document.querySelector('#tm-pv-foot a.btn-primary')?.textContent.trim() || '', body: (document.getElementById('tm-pv-body')?.innerText || '').slice(0, 80) };
    });
    check('J1 · S03 نقرة الصف تفتح درج المعاينة باسم المورد', pvRes.status() === 200 && drawer.open && drawer.name === R5_NAME, JSON.stringify(drawer));
    check('J1 · S03 الدرج يحمل زر «فتح الملف الكامل»', drawer.full === 'فتح الملف الكامل', `زر=${drawer.full}`);
    await pageCheck(s, 'J1 · S03');
    await shot(s, 'j1-04-preview-drawer');

    await Promise.all([page.waitForURL(`**/app/team/resources/${R5}**`, { timeout: 15000 }), page.click('#tm-pv-foot a.btn-primary')]);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    const prof = await page.evaluate(() => ({
      name: document.querySelector('.tm-profile-name span')?.textContent.trim() || '',
      tab: document.querySelector('.tm-profile-tabs a.on')?.textContent.trim() || '',
    }));
    check('J1 · S04 ملف المورد يُفتح على «نظرة عامة» باسمه', prof.name === R5_NAME && /نظرة عامة/.test(prof.tab), JSON.stringify(prof));
    await pageCheck(s, 'J1 · S04');
    await shot(s, 'j1-05-profile-overview');

    for (const [tab, label] of Object.entries(TAB_LABELS)) {
      const r = await open(page, base, `/app/team/resources/${R5}?tab=${tab}`);
      const on = await page.evaluate(() => (document.querySelector('.tm-profile-tabs a.on')?.textContent || '').replace(/\d+/g, '').trim());
      check(`J1 · تبويب ?tab=${tab} يُعرض 200 والتبويب النشط «${label}»`, r?.status() === 200 && on === label, `HTTP ${r?.status()} active=${on}`);
      await pageCheck(s, `J1 · تبويب ${tab}`);
      await shot(s, `j1-06-tab-${tab}`);
    }

    let backUrl = '';
    for (let i = 0; i < 9; i++) {
      const r = await page.goBack({ waitUntil: 'load', timeout: 15000 }).catch(() => null);
      if (!r) break;
      const u = new URL(page.url());
      if (u.pathname === '/app/team/resources') { backUrl = u.search; break; }
    }
    check('J1 · الرجوع بالمتصفح إلى السجل يحفظ ?q=', decodeURIComponent(backUrl).includes(`q=${R5_NAME}`), `search=${decodeURIComponent(backUrl)} url=${page.url()}`);
    await pageCheck(s, 'J1 · S02 بعد الرجوع');
    await shot(s, 'j1-07-back-keeps-q');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // الرحلة ٢ — S11 ⇐ مورد ⇐ ملفه؛ S12 حسب العمل ⇐ روابط التوزيع والسجل الأصلي
  // ═══════════════════════════════════════════════════════════════════════════════════════
  {
    const s = lead; const { page } = s;
    const res = await open(page, base, `/app/team/org?department=${encodeURIComponent(depId)}`);
    const org = await page.evaluate(() => ({
      on: document.querySelector('.tm-org-dep.on .tm-org-nm')?.textContent.trim() || '',
      title: document.getElementById('tm-org-list-t')?.textContent.trim() || '',
      rows: [...document.querySelectorAll('#tm-org-rows tbody tr[data-action="open-resource"]')].map((r) => r.dataset.emp),
      manager: document.querySelector('.tm-org-lh .tm-card-s')?.textContent || '',
    }));
    check('J2 · S11 الإدارة المختارة من الرابط معلَّمة في الشجرة وقائمتها تحمل مواردها', res?.status() === 200 && org.on === DEPT_NAME && org.title === DEPT_NAME
      && org.rows.includes('FX-EMP-1') && org.rows.includes('FX-EMP-2') && org.rows.includes(R4), JSON.stringify(org));
    check('J2 · S11 القائمة تسمّي مدير الإدارة', /المسؤول: /.test(org.manager) && org.manager.includes(deptmgr?.name_ar || 'مدير إدارة'), org.manager.slice(0, 120));
    await pageCheck(s, 'J2 · S11');
    await shot(s, 'j2-01-org');

    await Promise.all([page.waitForURL(`**/app/team/resources/${R4}**`, { timeout: 15000 }), page.click(`#tm-org-rows tr[data-emp="${R4}"] a.tm-person`)]);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    const nm = await txt(page, '.tm-profile-name span');
    check('J2 · رابط المورد في S11 يفتح ملفه S04', nm === R4_NAME, `name=${nm} url=${page.url()}`);
    await pageCheck(s, 'J2 · S04 من S11');
    await shot(s, 'j2-02-profile-from-org');

    const wres = await open(page, base, `/app/team/work?by=work&year=${Y}&month=${M}`);
    const work = await page.evaluate((pid) => {
      const items = [...document.querySelectorAll(`details.tm-work-item[data-work="project:${pid}"]`)];
      const it = items[0];
      return {
        count: items.length, seg: document.querySelector('.tm-work-seg a.on')?.textContent.trim() || '',
        team: it?.querySelector('.c-team')?.textContent.trim() || '', avatars: it ? it.querySelectorAll('.c-team .tm-work-av').length : 0,
        dist: it?.querySelector('a[href*="/app/team/planning?target="]')?.getAttribute('href') || '',
        src: it?.querySelector('a[href^="/app/project/"]')?.getAttribute('href') || '',
      };
    }, PRJ1);
    check('J2 · S12 «حسب العمل» يعرض المشروع مرةً واحدة مع فريقه', wres?.status() === 200 && work.seg === 'حسب العمل' && work.count === 1 && work.avatars >= 1 && /مورد/.test(work.team), JSON.stringify(work));
    check('J2 · S12 رابط «عرض التوزيع» يشير إلى التخطيط بسياق المشروع', work.dist.startsWith(`/app/team/planning?target=project:${PRJ1}`) && /from=\d{4}-\d{2}&to=\d{4}-\d{2}/.test(work.dist), `href=${work.dist}`);
    check('J2 · S12 رابط «فتح السجل الأصلي» يشير إلى صفحة المشروع', work.src === `/app/project/${PRJ1}`, `href=${work.src}`);
    await pageCheck(s, 'J2 · S12');
    await shot(s, 'j2-03-work-by-work');
    const dres = await open(page, base, work.dist || `/app/team/planning?target=project:${PRJ1}`);
    check('J2 · رابط التوزيع يفتح مصفوفة التخطيط', dres?.status() === 200 && (await page.locator('#pl-mx').count()) === 1, `HTTP ${dres?.status()}`);
    await pageCheck(s, 'J2 · S13 من S12');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // الرحلة ٣ — S13 ⇐ S14 ⇐ مراجعة ⇐ S16: التسكين لا يتغيّر إلا بعد الاعتماد
  // ═══════════════════════════════════════════════════════════════════════════════════════
  let pmReqId = null;
  {
    const pm = await as('demo.pm'); const { page } = pm;
    const deep = `/app/team/planning?new=1&employee=FX-EMP-2&target=project:${PRJ2}&from=${next1}&to=${next1}`;
    const res = await open(page, base, deep);
    const st = res?.status();
    if (st === 200) await page.waitForSelector('#pl-drawer.open', { timeout: 5000 }).catch(() => {});
    const opened = st === 200 ? await page.locator('#pl-drawer.open').count().catch(() => 0) : 0;
    check('J3 · مدير المشروع يفتح صفحة التخطيط بسياق الطلب (S14 مفتوح)', st === 200 && opened === 1,
      `HTTP ${st} — بوابة الصفحة team/planning تشترط قراءة الموظفين (core/policy/pages.js:87) ومدير المشروع لا يملكها، بينما خدمة التسكين تقبل طلبه (allocations.js requestGate)`);
    await shot(pm, 'j3-01-pm-planning-deeplink');
    if (st === 200) await pageCheck(pm, 'J3 · S14 لمدير المشروع');

    // الخدمة نفسها التي يناديها الدرج — بجلسة مدير المشروع: الطلب يصير معلَّقاً عند مدير الإدارة.
    const r = await submitAs(pm, { kind: 'new', employeeId: 'FX-EMP-2', target: { kind: 'project', id: PRJ2 }, from: next1, to: next1, pct: 20, allocStatus: 'confirmed' }, `e2e-j3-pm-${Date.now()}`);
    const rq = r.json?.requests?.[0] || null;
    pmReqId = rq?.id || null;
    check('J3 · طلب مدير المشروع (عبر الخدمة) يصير «بانتظار القرار» موجَّهاً إلى مدير الإدارة', r.status === 200 && rq?.status === 'pending' && rq?.reviewer?.id === deptmgr?.id,
      `HTTP ${r.status} ${errMsg(r)} status=${rq?.status} reviewer=${rq?.reviewer?.name}`);
  }
  {
    // S14 على المتصفح بشخصية «تطوير الأعمال»: تملك «طلب تسكين» في قطاعها ولا تملك أمر المورد،
    // فطلبها يمرّ بالدرج كاملاً (سياق مسبق، معاينة تسمّي المعتمِد، إرسال) ويصير معلَّقاً.
    const bd = await as('demo.bd'); const { page } = bd;
    const res = await open(page, base, `/app/team/planning?new=1&employee=FX-EMP-1&target=project:${PRJ2}&from=${next1}&to=${next1}`);
    await page.waitForSelector('#pl-drawer.open', { timeout: 8000 }).catch(() => {});
    const pre = await page.evaluate(() => ({
      open: !!document.querySelector('#pl-drawer.open'), title: document.getElementById('pl-drawer-title')?.textContent.trim() || '',
      picked: document.querySelector('[data-pl="project-picked"]')?.textContent.trim() || '',
      chips: [...document.querySelectorAll('[data-pl="res-chips"] .tm-pl-chip')].map((c) => c.textContent.trim()),
      from: document.getElementById('pl-from')?.value || '', to: document.getElementById('pl-to')?.value || '',
    }));
    check('J3 · S14 (بديل: demo.bd) الدرج يُفتح من الرابط بسياقه المعبّأ: المشروع والمورد والشهر', res?.status() === 200 && pre.open && pre.title === 'تسكين جديد'
      && pre.picked.includes(PRJ2_NAME) && pre.chips.some((c) => c.includes('سارة الحربي')) && pre.from === next1 && pre.to === next1, JSON.stringify(pre));
    await pageCheck(bd, 'J3 · S14 (demo.bd)');
    await shot(bd, 'j3-02-s14-prefilled');

    await page.fill('#pl-pct', '20');
    const [pvRes] = await Promise.all([waitApi(page, 'POST', '/api/team/allocations/preview'), page.click('[data-pl="foot"] [data-action="pl-preview"]')]);
    const pvJson = await jsonOf(pvRes);
    await page.waitForFunction(() => !!document.querySelector('[data-pl="foot"] [data-action="pl-review"]'), null, { timeout: 8000 }).catch(() => {});
    const prev = await page.evaluate(() => ({
      rows: document.querySelectorAll('[data-pl="preview"] table tbody tr').length,
      text: document.querySelector('[data-pl="preview"]')?.innerText || '',
      review: !!document.querySelector('[data-pl="foot"] [data-action="pl-review"]'),
    }));
    check('J3 · S14 «معاينة» تعرض أثر الشهر وتسمّي المعتمِد (مدير الإدارة)', pvRes.status() === 200 && prev.rows >= 1 && /يعتمده/.test(prev.text) && prev.text.includes(deptmgr?.name_ar || '')
      && pvJson?.directApply === false, `HTTP ${pvRes.status()} rows=${prev.rows} direct=${pvJson?.directApply} text=${prev.text.slice(0, 160)}`);
    await shot(bd, 'j3-03-s14-preview');
    await page.click('[data-pl="foot"] [data-action="pl-review"]');
    await page.waitForFunction(() => !!document.querySelector('[data-pl="foot"] [data-action="pl-submit"]'), null, { timeout: 8000 }).catch(() => {});
    const sub = await page.evaluate(() => document.querySelector('[data-pl="foot"] [data-action="pl-submit"]')?.textContent.trim() || '');
    check('J3 · S14 المراجعة تعرض ملخص الطلب وزر «إرسال الطلب» (لا تطبيق مباشر)', sub === 'إرسال الطلب' && (await page.locator('[data-pl-step="2"]').innerText()).includes('ملخص الطلب'), `زر=${sub}`);
    const [subRes] = await Promise.all([waitApi(page, 'POST', '/api/team/allocations/requests'), page.click('[data-pl="foot"] [data-action="pl-submit"]')]);
    const subJson = await jsonOf(subRes);
    await page.waitForFunction(() => !!document.querySelector('[data-pl-step="3"] .row-o'), null, { timeout: 8000 }).catch(() => {});
    const out = await page.evaluate(() => ({ ok: document.querySelector('[data-pl-step="3"] .tm-ok')?.textContent.trim() || '', row: document.querySelector('[data-pl-step="3"] .row-o')?.textContent.trim() || '' }));
    check('J3 · S14 «إرسال الطلب» يعيد نتيجة «بانتظار اعتماد مدير الإدارة»', subRes.status() === 200 && subJson?.requests?.[0]?.status === 'pending' && /اكتمل الإرسال/.test(out.ok) && /بانتظار اعتماد/.test(out.row),
      `HTTP ${subRes.status()} status=${subJson?.requests?.[0]?.status} ${out.row}`);
    await shot(bd, 'j3-04-s14-result-pending');
  }
  const matrixCells = async (s, from, to) => {
    await open(s.page, base, `/app/team/planning?from=${from}&to=${to}`);
    return s.page.evaluate(() => (window.__SANAD && window.__SANAD.teamPlanning && window.__SANAD.teamPlanning.cells) || {});
  };
  {
    const s = lead; const { page } = s;
    const cells = await matrixCells(s, next1, next1);
    const c = cells['FX-EMP-2']?.[next1] || null;
    const dom = await page.evaluate((k) => {
      const cell = document.querySelector(`.tm-mx .cell[data-emp="FX-EMP-2"][data-month="${k}"]`);
      return { pend: cell ? cell.querySelectorAll('.li.pend').length : -1, chip: cell?.querySelector('.tm-pct')?.textContent.trim() || '', text: cell?.innerText || '' };
    }, next1);
    check('J3 · S13 خلية المورد تعرض طبقة «بانتظار الاعتماد» بلا مسّ المؤكد', !!c && c.confirmedPct === 0 && c.items.some((it) => it.status === 'pending' && it.targetId === PRJ2 && it.pct === 20)
      && dom.pend >= 1 && dom.chip === '0%' && /بانتظار الاعتماد/.test(dom.text), JSON.stringify({ c, dom: { ...dom, text: dom.text.slice(0, 80) } }));
    await pageCheck(s, 'J3 · S13 قبل الاعتماد');
    await shot(s, 'j3-05-matrix-pending-layer');
  }
  {
    const dm = await as('demo.deptmgr'); const { page } = dm;
    const res = await open(page, base, '/app/team/requests?filter=pending_my_decision');
    const list = await page.evaluate((id) => ({
      chip: document.querySelector('.tm-rq-chips a.on')?.textContent.trim() || '',
      counter: Number((document.querySelector('.tm-rq-chips a.on .n')?.textContent || '').replace(/\D/g, '')),
      rows: document.querySelectorAll('tr[data-action="rq-open"]').length,
      mine: !!document.querySelector(`tr[data-href*="${id}"]`),
    }), pmReqId);
    check('J3 · S16 «بانتظار قراري» لمدير الإدارة يعرض طلب مدير المشروع مع العدّاد', res?.status() === 200 && /بانتظار قراري/.test(list.chip) && list.counter >= 1 && list.counter === list.rows && list.mine, JSON.stringify(list));
    await pageCheck(dm, 'J3 · S16 القائمة');
    await shot(dm, 'j3-06-requests-pending-my-decision');
    await Promise.all([page.waitForURL(`**/app/team/requests/${pmReqId}**`, { timeout: 15000 }), page.click(`tr[data-href*="${pmReqId}"] a.row-link`)]);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    const panel = await page.evaluate(() => ({
      title: document.querySelector('#rq-panel .tm-card-t')?.textContent.trim() || '', status: document.querySelector('#rq-panel .tm-card-s .pill')?.textContent.trim() || '',
      approve: document.querySelector('#rq-panel [data-action="rq-approve"]')?.textContent.trim() || '', body: document.getElementById('rq-panel')?.innerText || '',
    }));
    check('J3 · S16 لوحة الطلب تعرض المورد والوجهة والأثر وزر «اعتماد»', /خالد العتيبي/.test(panel.title) && panel.status === 'بانتظار الاعتماد' && panel.approve === 'اعتماد'
      && panel.body.includes(PRJ2_NAME) && /الأثر بعد الاعتماد/.test(panel.body), JSON.stringify({ ...panel, body: panel.body.slice(0, 120) }));
    await pageCheck(dm, 'J3 · S16 الطلب');
    await shot(dm, 'j3-07-request-panel');
    const [decRes] = await Promise.all([waitApi(page, 'POST', `/api/team/allocations/requests/${pmReqId}/decide`), page.click('#rq-panel [data-action="rq-approve"]')]);
    const dec = await jsonOf(decRes);
    await page.waitForFunction(() => (document.querySelector('#rq-panel .tm-card-s .pill')?.textContent || '').includes('مطبَّق'), null, { timeout: 12000 }).catch(() => {});
    const after = await txt(page, '#rq-panel .tm-card-s .pill');
    check('J3 · «اعتماد» يطبّق الطلب: الخادم يردّ «مطبَّق» والصفحة تعرضه بعد التحديث', decRes.status() === 200 && (dec == null || dec.status === 'applied') && after === 'مطبَّق',
      `HTTP ${decRes.status()} status=${dec ? dec.status : '(الجسم غير مقروء بعد التحديث)'} reason=${dec?.reason || ''} shown=${after}`);
    await pageCheck(dm, 'J3 · S16 بعد الاعتماد');
    await shot(dm, 'j3-08-request-applied');
  }
  {
    const s = lead;
    const cells = await matrixCells(s, next1, next1);
    const c = cells['FX-EMP-2']?.[next1] || null;
    check('J3 · S13 بعد الاعتماد: المؤكد للمورد في الشهر صار 20% والطبقة المعلَّقة زالت', !!c && c.confirmedPct === 20 && c.pendingPct === 0
      && c.items.some((it) => it.status === 'confirmed' && it.targetId === PRJ2 && it.pct === 20), JSON.stringify(c));
    await pageCheck(s, 'J3 · S13 بعد الاعتماد');
    await shot(s, 'j3-09-matrix-confirmed-20');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // الرحلة ٤ — S13 ⇐ S15 ⇐ مراجعة التعديل ⇐ الأثر يُحفظ بلا مسّ بقية الأشهر
  // ═══════════════════════════════════════════════════════════════════════════════════════
  {
    const s = lead; const { page } = s;
    const cells = await matrixCells(s, cur, to2);
    const c0 = cells[R4]?.[cur] || null;
    const dom = await page.evaluate(([emp, k]) => {
      const cell = document.querySelector(`.tm-mx .cell[data-emp="${emp}"][data-month="${k}"]`);
      return { over: !!cell && cell.classList.contains('over'), fix: cell?.dataset.action || '', text: cell?.innerText || '' };
    }, [R4, cur]);
    check(`J4 · S13 خلية ${R4_NAME} في ${cur} متجاوزة (120%): صنف .over ونص «تجاوز»`, !!c0 && c0.confirmedPct === 120 && c0.overPct === 20 && dom.over && dom.fix === 'pl-fix' && /تجاوز/.test(dom.text),
      JSON.stringify({ c0, dom: { ...dom, text: dom.text.slice(0, 100) } }));
    await pageCheck(s, 'J4 · S13 متجاوزة');
    await shot(s, 'j4-01-matrix-over');

    const res = await open(page, base, `/app/team/planning?fix=1&employee=${R4}&month=${cur}&from=${cur}&to=${to2}`);
    await page.waitForSelector('#pl-drawer.open', { timeout: 8000 }).catch(() => {});
    const fx = await page.evaluate(() => ({
      open: !!document.querySelector('#pl-drawer.open'), title: document.getElementById('pl-drawer-title')?.textContent.trim() || '',
      inputs: document.querySelectorAll('[data-pl="fix-items"] input[data-fx-a]').length,
      labels: [...document.querySelectorAll('[data-pl="fix-items"] tbody tr')].slice(0, 2).map((tr) => tr.querySelector('td')?.textContent.trim()),
      alert: document.querySelector('[data-pl="fix-alert"]')?.innerText || '',
      scope: document.querySelector('input[name="pl-scope"]:checked')?.value || '',
    }));
    check('J4 · S15 يُفتح من الرابط ويعرض مصدري التجاوز (المشروع والعمل الداخلي) بنسبيهما', res?.status() === 200 && fx.open && fx.title === 'مراجعة تعارض التسكين' && fx.inputs === 2
      && fx.labels.includes(PRJ1_NAME) && fx.labels.includes('تطوير أعمال') && /120%/.test(fx.alert) && /20%/.test(fx.alert), JSON.stringify(fx));
    check('J4 · S15 نطاق التعديل الافتراضي «هذا الشهر فقط»', fx.scope === 'month', `scope=${fx.scope}`);
    await pageCheck(s, 'J4 · S15');
    await shot(s, 'j4-02-s15-drawer');

    const bucketInput = page.locator('[data-pl="fix-items"] tbody tr', { hasText: 'تطوير أعمال' }).locator('input[data-fx-a]');
    await bucketInput.fill('20');
    await page.check('input[name="pl-scope"][value="month"]');
    await page.fill('#pl-reason', 'تجاوز الطاقة — يُخفَّض العمل الداخلي هذا الشهر إلى 20%');
    const total = await txt(page, '[data-pl="fix-total"]');
    check('J4 · S15 خفض العمل الداخلي إلى 20 يحدّث الإجمالي المقترح إلى 100%', total === '100%', `total=${total}`);
    const [pvRes] = await Promise.all([waitApi(page, 'POST', '/api/team/allocations/preview'), page.click('[data-pl="foot"] [data-action="fx-preview"]')]);
    await page.waitForFunction(() => !!document.querySelector('[data-pl="foot"] [data-action="fx-submit"]'), null, { timeout: 8000 }).catch(() => {});
    const pvw = await page.evaluate(() => ({
      after: document.querySelector('.tm-pl-cmp .after')?.innerText || '', rows: document.querySelectorAll('[data-pl="preview"] table tbody tr').length,
      who: document.querySelector('[data-pl="preview"] .tm-ok, [data-pl="preview"] .tm-info, [data-pl="preview"] .tm-warn')?.textContent.trim() || '',
    }));
    check('J4 · S15 «معاينة الأثر» تقول «بعد التعديل: ضمن الطاقة» بمؤكد 100%', pvRes.status() === 200 && pvw.rows >= 1 && /ضمن الطاقة/.test(pvw.after) && /100%/.test(pvw.after), JSON.stringify(pvw));
    check('J4 · S15 قائد القطاع يملك أمر المورد: «يُطبَّق مباشرة»', /يُطبَّق مباشرة/.test(pvw.who), pvw.who);
    await shot(s, 'j4-03-s15-preview');
    const [subRes] = await Promise.all([waitApi(page, 'POST', '/api/team/allocations/requests'), page.click('[data-pl="foot"] [data-action="fx-submit"]')]);
    const sub = await jsonOf(subRes);
    await page.waitForFunction(() => !!document.querySelector('[data-pl="result"] .row-o'), null, { timeout: 8000 }).catch(() => {});
    const out = await page.evaluate(() => ({ ok: document.querySelector('[data-pl="result"] .tm-ok')?.textContent.trim() || '', row: document.querySelector('[data-pl="result"] .row-o')?.textContent.trim() || '' }));
    check('J4 · S15 «إرسال التعديل» يطبّقه مباشرةً ويؤكّد ذلك في الدرج', subRes.status() === 200 && sub?.requests?.[0]?.status === 'applied' && /طُبّق التسكين مباشرة/.test(out.row) && /اكتمل الإرسال/.test(out.ok),
      `HTTP ${subRes.status()} status=${sub?.requests?.[0]?.status} ${out.row}`);
    await shot(s, 'j4-04-s15-applied');

    // الشهر التالي قد يقع خارج مدى التسكين المقصوص عند نهاية السنة — فالمتوقَّع فيه يُحسب لا يُفترض.
    const expNext = next1 <= to2 ? 80 : 0;
    const pl = await api(s, 'GET', `/team/planning?from=${cur}&to=${next1 > to2 ? next1 : to2}`);
    const row = (pl.json?.rows || []).find((r) => r.resource.id === R4) || null;
    const byKey = Object.fromEntries((row?.cells || []).map((c) => [c.key, c]));
    const m0 = byKey[cur]; const m1 = byKey[next1];
    const bucket0 = m0?.items?.find((it) => it.kind === 'bucket');
    check(`J4 · الشهر ${cur} بعد التعديل: مؤكد 100% (مشروع 80 + عمل داخلي 20) بلا تجاوز`, pl.status === 200 && m0?.confirmedPct === 100 && m0?.overPct === 0 && bucket0?.pct === 20,
      JSON.stringify({ m0: m0 && { confirmedPct: m0.confirmedPct, overPct: m0.overPct, items: m0.items } }));
    const m1Items = (m1?.items || []).filter((it) => it.status === 'confirmed');
    check(`J4 · الشهر التالي ${next1} لم يُمسّ: المشروع ${expNext}% ولا عمل داخلي فيه`, !!m1 && m1.confirmedPct === expNext && m1Items.length === (expNext ? 1 : 0)
      && (!expNext || (m1Items[0].targetId === PRJ1 && m1Items[0].pct === 80)), JSON.stringify({ m1: m1 && { confirmedPct: m1.confirmedPct, items: m1.items } }));
    const cells2 = await matrixCells(s, cur, to2);
    const overNow = await page.evaluate(([emp, k]) => !!document.querySelector(`.tm-mx .cell[data-emp="${emp}"][data-month="${k}"].over`), [R4, cur]);
    check('J4 · S13 بعد التحديث: الخلية لم تعد متجاوزة', !overNow && cells2[R4]?.[cur]?.overPct === 0, `over=${overNow}`);
    await pageCheck(s, 'J4 · S13 بعد التعديل');
    await shot(s, 'j4-05-matrix-fixed');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // الرحلة ٥ — S17 ⇐ S18 ⇐ متابعة تُنشأ وتُعاد فتحاً بأدلتها (بلا تكرار)
  // ═══════════════════════════════════════════════════════════════════════════════════════
  let caseId = null;
  {
    // طلبٌ معلَّق للشهر القادم من «تطوير الأعمال» ⇐ إشارة «تحقق من الطلب القادم» على المورد،
    // ويظهر في الرحلة ٦ تحت «الطلبات غير المعتمدة» مع تعارضٍ محتمل (80 مؤكد + 50 معلَّق + 50 احتياج).
    const bd = await as('demo.bd');
    const r = await submitAs(bd, { kind: 'new', employeeId: R4, target: { kind: 'project', id: PRJ2 }, from: next1, to: pendTo, pct: 50, allocStatus: 'confirmed' }, `e2e-j5-bd-${Date.now()}`);
    check(`تهيئة الرحلة ٥ · طلب معلَّق لـ${R4_NAME} على «${PRJ2_NAME}» 50% (${next1} – ${pendTo})`, r.status === 200 && r.json?.requests?.[0]?.status === 'pending', `HTTP ${r.status} ${errMsg(r)}`);

    const s = lead; const { page } = s;
    const expectSignal = to2Clamped ? 'فرصة تخطيط' : 'تحقق من الطلب القادم';
    const res = await open(page, base, `/app/team/analysis?year=${Y}&month=${M}`);
    const row = await page.evaluate((emp) => {
      const tr = document.querySelector(`tr[data-emp="${emp}"]`);
      return { found: !!tr, signal: tr?.querySelector('.tm-an-sig .pill')?.textContent.trim() || '', confirmed: tr?.querySelector('.tm-pct')?.textContent.trim() || '',
        href: tr?.querySelector('a.btn')?.getAttribute('href') || '', btn: tr?.querySelector('a.btn')?.textContent.trim() || '' };
    }, R4);
    check(`J5 · S17 يعرض ${R4_NAME} بإشارة «${expectSignal}» وتسكينه المؤكد 100%`, res?.status() === 200 && row.found && row.signal === expectSignal && row.confirmed === '100%', JSON.stringify(row));
    check('J5 · S17 زر «فحص الحالة» يشير إلى صفحة الحالة بالشهر', row.btn === 'فحص الحالة' && row.href.startsWith(`/app/team/analysis/${R4}?`) && row.href.includes(`month=${M}`), `href=${row.href}`);
    await pageCheck(s, 'J5 · S17');
    await shot(s, 'j5-01-analysis-table');

    await Promise.all([page.waitForURL(`**/app/team/analysis/${R4}**`, { timeout: 15000 }), page.click(`tr[data-emp="${R4}"] a.btn`)]);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    const ev = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.tm-an-evid tbody tr')].map((tr) => ({
        title: tr.children[0]?.textContent.trim(), value: tr.children[1]?.textContent.trim(), source: tr.children[2]?.textContent.trim(), link: tr.children[2]?.querySelector('a')?.getAttribute('href') || '' }));
      return { rows, signal: document.querySelector('.tm-an-head .tm-an-sig .pill')?.textContent.trim() || '', questions: document.querySelectorAll('.tm-an-q li').length,
        form: !!document.querySelector('form[data-form="followup"]') };
    });
    check('J5 · S18 جدول الأدلة يحمل صفوفاً بمصادرها (تسكين، حِمل، الأشهر القادمة، الارتباط)', ev.rows.length >= 5 && ev.rows.every((r) => r.title && r.value && r.source)
      && ev.rows.some((r) => r.link.startsWith('/app/team/planning')) && ev.rows.some((r) => r.link.startsWith(`/app/team/resources/${R4}`)), JSON.stringify(ev.rows.map((r) => [r.title, r.source])));
    check('J5 · S18 تعرض الإشارة نفسها وأسئلة التحقق ونموذج المتابعة', ev.signal === expectSignal && ev.questions >= 2 && ev.form, JSON.stringify({ signal: ev.signal, q: ev.questions, form: ev.form }));
    await pageCheck(s, 'J5 · S18');
    await shot(s, 'j5-02-case-page');

    await page.fill('#fu-due', `${next1}-15`);
    await page.fill('#fu-note', 'التحقق من الطلب المعلَّق قبل تغيير التسكين');
    const [fuRes] = await Promise.all([waitApi(page, 'POST', `/api/team/analysis/${R4}/followup`), page.click('form[data-form="followup"] button[data-submit]')]);
    const fu = await jsonOf(fuRes);
    const okBox = await page.waitForSelector('.tm-ok[role="status"]', { timeout: 8000 }).then((el) => el.textContent()).catch(() => '');
    check('J5 · S18 «حفظ المتابعة» ينشئ الحالة ومهمةً حقيقية ويؤكّد ذلك على الشاشة', fuRes.status() === 200 && (fu == null || (!!fu.id && !!fu.task?.id && !fu.existing)) && /سُجّلت المتابعة/.test(okBox || ''),
      `HTTP ${fuRes.status()} case=${fu?.id} task=${fu?.task?.id} existing=${fu?.existing} box=${(okBox || '').slice(0, 80)}`);
    await shot(s, 'j5-03-followup-saved');
    await page.waitForFunction(() => !!document.querySelector('form[data-form="close-case"]'), null, { timeout: 12000 }).catch(() => {});
    const card = await page.evaluate(() => ({
      title: document.querySelector('.tm-an-case .tm-sec .sh')?.textContent.trim() || '', status: document.querySelector('.tm-an-case .tm-sec .pill')?.textContent.trim() || '',
      owner: document.querySelector('.tm-an-case .tm-sec a[href^="/app/person/"]')?.textContent.trim() || '', caseId: (window.__SANAD && window.__SANAD.teamCase && window.__SANAD.teamCase.caseId) || '',
      form: !!document.querySelector('form[data-form="followup"]'),
    }));
    caseId = card.caseId || fu?.id || null;
    check('J5 · S18 بعد التحديث تعرض الحالة بمهمتها ورابط «مهام المسؤول» بدل النموذج', !!card.caseId && (fu == null || card.caseId === fu.id) && card.title.includes(R4_NAME) && card.status === 'مفتوحة' && card.owner === 'مهام المسؤول' && !card.form, JSON.stringify(card));
    await pageCheck(s, 'J5 · S18 بعد الحفظ');
    await shot(s, 'j5-04-case-with-task');

    await open(page, base, `/app/team/analysis/${R4}?year=${Y}&month=${M}`);
    const again = await page.evaluate(() => ({ caseId: (window.__SANAD && window.__SANAD.teamCase && window.__SANAD.teamCase.caseId) || '', cards: document.querySelectorAll('.tm-an-case .tm-sec').length, form: !!document.querySelector('form[data-form="followup"]') }));
    const dup = await api(s, 'POST', `/team/analysis/${R4}/followup`, { year: Y, month: M, action_ar: 'مراجعة عبء العمل مع مدير المشروع', ownerUserId: userOf('demo.sectorlead')?.id, dueDate: `${next1}-15` });
    check('J5 · إعادة فتح رابط الحالة يعرض المتابعة نفسها، وإرسالٌ ثانٍ لا يكرّرها', again.caseId === caseId && again.cards === 1 && !again.form && dup.status === 200 && dup.json?.existing === true && dup.json?.id === caseId,
      JSON.stringify({ again, dup: { status: dup.status, existing: dup.json?.existing, id: dup.json?.id } }));
    await pageCheck(s, 'J5 · S18 معاد فتحها');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // الرحلة ٦ — S19 ⇐ S20 ⇐ S21 ⇐ طلب تسكين بملاحظة الطلبات المتنافسة
  // ═══════════════════════════════════════════════════════════════════════════════════════
  {
    const s = lead; const { page } = s;
    const res = await open(page, base, '/app/team/needs');
    check('J6 · S19 صفحة الاحتياجات تُفتح بزر «إضافة احتياج»', res?.status() === 200 && (await page.locator('[data-action="need-new"]').count()) >= 1, `HTTP ${res?.status()}`);
    await pageCheck(s, 'J6 · S19');
    await page.locator('[data-action="need-new"]').first().click();
    await page.waitForSelector('#tm-need-drawer.open', { timeout: 8000 }).catch(() => {});
    const opened = await page.evaluate(() => ({ open: !!document.querySelector('#tm-need-drawer.open'), title: document.getElementById('tm-need-title')?.textContent.trim() || '' }));
    check('J6 · S20 درج الاحتياج يُفتح بعنوان «إضافة احتياج»', opened.open && opened.title === 'إضافة احتياج', JSON.stringify(opened));
    await shot(s, 'j6-01-need-form');
    const f = '#tm-need-form ';
    await page.selectOption(f + '[name="source_project"]', PRJ1);
    await page.fill(f + '[name="role_ar"]', 'محلل بيانات');
    await page.fill(f + '[name="skills_required"]', 'تحليل البيانات');
    await page.fill(f + '[name="from_month"]', next1);
    await page.fill(f + '[name="to_month"]', next2);
    await page.fill(f + '[name="fte_pct"]', '50');
    await page.fill(f + '[name="decide_by"]', `${next1}-10`);
    // الوحدة بلسانٍ عربي (لا «FTE»): «مورد واحد × 50% من الدوام الكامل طوال الفترة» — needs.js demandAr.
    const DEMAND_AR = 'مورد واحد × 50% من الدوام الكامل طوال الفترة';
    const demand = await txt(page, f + '[data-demand]');
    check(`J6 · S20 يقول الحجم بوحدته «${DEMAND_AR}» قبل الحفظ`, demand.includes(DEMAND_AR), demand);
    const [needRes] = await Promise.all([waitApi(page, 'POST', '/api/team/needs'), page.click(f + 'button[data-submit][data-then="list"]')]);
    const need = await jsonOf(needRes);
    // العميل يعود إلى القائمة فور الردّ — الصف الجديد يُقرأ من الصفحة المعادة (القائمة كانت فارغة قبل الحفظ).
    await page.waitForSelector('tr[data-need] .tm-nd-role', { timeout: 15000 }).catch(() => {});
    const row = await page.evaluate(() => {
      const tr = [...document.querySelectorAll('tr[data-need]')].find((x) => (x.querySelector('.tm-nd-role')?.textContent || '').trim() === 'محلل بيانات') || null;
      return { found: !!tr, id: tr?.dataset.need || '', role: tr?.querySelector('.tm-nd-role')?.textContent.trim() || '', demand: tr?.querySelector('td.tnum')?.textContent.trim() || '',
        cover: tr?.querySelectorAll('td')[5]?.querySelector('.pill')?.textContent.trim() || '', cand: tr?.querySelector('a[href^="/app/team/needs/"]')?.textContent.trim() || '' };
    });
    const needId = row.id || need?.id || null;
    check('J6 · S20 الحفظ يعيد إلى القائمة والصف الجديد يقول «مورد واحد × 50%» و«غير مغطى»', needRes.status() === 200 && !!needId && row.found && (need == null || need.id === needId)
      && row.demand === DEMAND_AR && row.cover === 'غير مغطى' && row.cand === 'عرض المرشحين', `HTTP ${needRes.status()} ${JSON.stringify(row)}`);
    await pageCheck(s, 'J6 · S19 بعد الحفظ');
    await shot(s, 'j6-02-need-row');

    await Promise.all([page.waitForURL(`**/app/team/needs/${needId}**`, { timeout: 15000 }), page.click(`tr[data-need="${needId}"] a[href="/app/team/needs/${needId}"]`)]);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    const cand = await page.evaluate(([r4, prj2]) => {
      const tr = document.querySelector(`tr[data-emp="${r4}"]`);
      const pend = tr?.querySelector('.tm-cd-pend');
      return { rows: document.querySelectorAll('tr[data-emp]').length, found: !!tr, pendText: pend?.innerText || '', pendLink: pend?.querySelector('a')?.getAttribute('href') || '',
        warn: tr?.querySelector('.tm-warn')?.textContent.trim() || '', head: [...document.querySelectorAll('thead th')].map((x) => x.textContent.trim()), prj2 };
    }, [R4, PRJ2]);
    check('J6 · S21 المرشح ذو الطلب المعلَّق يعرضه تحت «الطلبات غير المعتمدة» برابطه', cand.rows >= 3 && cand.found && cand.head.includes('الطلبات غير المعتمدة') && cand.pendText.includes(PRJ2_NAME) && /50%/.test(cand.pendText)
      && cand.pendLink.startsWith('/app/team/requests/') && /لا تُخصم/.test(cand.pendText), JSON.stringify({ ...cand, head: undefined }));
    // المحتمل = المؤكد + المعلَّق + الاحتياج في أعلى شهر: 80 + 50 + 50 = 180 حين يغطي التسكين الشهر التالي.
    const expPot = (next1 <= to2 ? 80 : 0) + 50 + 50;
    check(`J6 · S21 ملاحظة «تعارض محتمل» ${expPot > 100 ? `حين يتجاوز المجموع المحتمل 100% (${expPot}%)` : 'تغيب حين لا يتجاوز المجموع 100%'}`,
      expPot > 100 ? (/تعارض محتمل/.test(cand.warn) && cand.warn.includes(`${expPot}%`)) : !cand.warn, cand.warn || '(لا ملاحظة)');
    await pageCheck(s, 'J6 · S21');
    await shot(s, 'j6-03-candidates');

    await page.check('input[data-action="cand-select"][value="FX-EMP-3"]');
    await page.waitForTimeout(300);
    const panel = await page.evaluate(() => {
      const p = document.getElementById('tm-cd-panel');
      return { visible: !!p && !p.hidden, title: p?.querySelector('.tm-card-t')?.textContent.trim() || '', who: p?.querySelector('[data-cand-name]')?.textContent.trim() || '', months: p?.querySelector('[data-cd-months]')?.innerText || '' };
    });
    check('J6 · S21 اختيار مرشح يُظهر لوحة «إعداد طلب التسكين» باسمه وأثره شهراً شهراً', panel.visible && panel.title === 'إعداد طلب التسكين' && panel.who.includes('نورة القحطاني') && /المطلوب 50%/.test(panel.months), JSON.stringify(panel));
    await shot(s, 'j6-04-prepare-request');
    const [rqRes] = await Promise.all([waitApi(page, 'POST', `/api/team/needs/${needId}/request`), page.click('#tm-cd-panel [data-action="cd-submit"]')]);
    const rq = await jsonOf(rqRes);
    await page.waitForFunction(() => !!document.querySelector('[data-cd-ok] a'), null, { timeout: 8000 }).catch(() => {});
    const okLink = await page.evaluate(() => ({ text: document.querySelector('[data-cd-ok]')?.textContent.trim() || '', href: document.querySelector('[data-cd-ok] a')?.getAttribute('href') || '', disabled: !!document.querySelector('#tm-cd-panel [data-action="cd-submit"]')?.disabled }));
    check('J6 · S21 «إرسال طلب التسكين» يعيد رابط الطلب /app/team/requests/<id> ويعطّل الزر ضد التكرار', rqRes.status() === 200 && !!rq?.requestId && okLink.href === `/app/team/requests/${rq.requestId}` && okLink.disabled,
      `HTTP ${rqRes.status()} id=${rq?.requestId} ${JSON.stringify(okLink)}`);
    await shot(s, 'j6-05-request-sent');
    if (rq?.requestId) {
      const rres = await open(page, base, `/app/team/requests/${rq.requestId}`);
      const seen = await page.evaluate(() => ({ title: document.querySelector('#rq-panel .tm-card-t')?.textContent.trim() || '', status: document.querySelector('#rq-panel .tm-card-s .pill')?.textContent.trim() || '' }));
      check('J6 · رابط النتيجة يفتح الطلب في S16 باسم المرشح', rres?.status() === 200 && seen.title.includes('نورة القحطاني') && !!seen.status, JSON.stringify(seen));
      await pageCheck(s, 'J6 · S16 من S21');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // الرحلة ٧ — S22 ⇐ S23 ⇐ الإرسال للمالية ⇐ S24 الإقفال ⇐ S25 التصدير والتصحيح والإصدارات
  // ═══════════════════════════════════════════════════════════════════════════════════════
  {
    const s = lead; const { page } = s;
    const closeUrl = `/app/team/close?sector=${SECTOR}&year=${pv.y}&month=${pv.m}`;
    const res = await open(page, base, closeUrl);
    const readS22 = () => page.evaluate(() => {
      const rows = [...document.querySelectorAll('#tm-close-rows tbody tr[data-emp]')].map((tr) => ({
        emp: tr.dataset.emp, review: tr.querySelector('td:nth-child(6) .pill')?.textContent.trim() || '', chips: [...tr.querySelectorAll('.tm-close-chip')].map((c) => c.textContent.trim()) }));
      const counter = (k) => Number(document.querySelector(`[data-counter="${k}"]`)?.textContent.trim());
      return { status: document.querySelector('.tm-close-status .pill')?.textContent.trim() || '', version: document.querySelector('.tm-close-status')?.textContent || '',
        counters: { resources: counter('resources'), complete: counter('complete'), exceptions: counter('exceptions') }, rows,
        send: (() => { const b = document.querySelector('[data-action="close-send"]'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null; })(),
        blockers: document.getElementById('tm-close-blockers')?.innerText || '' };
    });
    const s22 = await readS22();
    const withEx = s22.rows.filter((r) => r.chips.length).length; const complete = s22.rows.filter((r) => r.review === 'مؤكد' && !r.chips.length).length;
    check(`J7 · S22 مسودة ${mk(pv.y, pv.m)} والعدادات تتصالح مع الصفوف`, res?.status() === 200 && s22.status === 'مسودة' && /الإصدار\s*1/.test(s22.version)
      && s22.counters.resources === s22.rows.length && s22.counters.exceptions === withEx && s22.counters.complete === complete && s22.rows.length >= 4,
      JSON.stringify({ status: s22.status, counters: s22.counters, rows: s22.rows.length, withEx, complete }));
    const r6row = s22.rows.find((r) => r.emp === R6);
    check('J7 · S22 موردٌ موزَّع على مشروع بلا كود مالي يبقى استثناءً «كود مالي مفقود»', !!r6row && r6row.chips.some((c) => c.includes('كود مالي مفقود')) && r6row.review === 'مسودة', JSON.stringify(r6row));
    check('J7 · S22 «إرسال للمالية» معطَّل ما دام مورد بلا تأكيد', !!s22.send && s22.send.text.includes('إرسال للمالية') && s22.send.disabled && /لا يمكن الإرسال/.test(s22.blockers), JSON.stringify(s22.send));
    await pageCheck(s, 'J7 · S22 مسودة');
    await shot(s, 'j7-01-close-draft');

    await Promise.all([page.waitForURL(`**/app/team/close/${R6}**`, { timeout: 15000 }), page.click(`#tm-close-rows tr[data-emp="${R6}"] a.btn`)]);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    const periodId = new URL(page.url()).searchParams.get('period');
    const s23 = await page.evaluate(() => ({
      lines: [...document.querySelectorAll('#tm-close-lines tbody tr[data-kind]')].map((tr) => ({ kind: tr.dataset.kind, label: tr.dataset.label, code: tr.children[1]?.textContent.trim(), bp: Number(tr.dataset.bp) })),
      total: document.getElementById('tm-close-total')?.textContent.trim() || '', confirm: document.querySelector('[data-action="close-confirm"]')?.textContent.trim() || '',
      ref: document.querySelector('.tm-close-ref')?.innerText || '' }));
    const prjLine = s23.lines.find((l) => l.kind === 'project'); const secLine = s23.lines.find((l) => l.kind === 'sector');
    check('J7 · S23 مسودة المورد من تسكينه المؤكد: مشروع 60% بـ«كود مفقود» + قطاع 40% = 100%', !!periodId && s23.lines.length === 2 && prjLine?.label === PRJ1_NAME && prjLine?.bp === 6000
      && /كود مفقود/.test(prjLine?.code || '') && secLine?.bp === 4000 && s23.total === '100.00%' && s23.confirm === 'تأكيد التوزيع' && s23.ref.includes(PRJ1_NAME), JSON.stringify(s23));
    await pageCheck(s, 'J7 · S23');
    await shot(s, 'j7-02-resource-shares');

    // المشروع بلا كود مالي فلا يُقفل الشهر عليه — يُحمَّل الشهر كله على القطاع من الشاشة نفسها.
    await page.click('#tm-close-lines tbody tr[data-kind="project"] [data-action="close-line-remove"]');
    await page.locator('#tm-close-lines tbody tr[data-kind="sector"] input.tm-close-pct').fill('100');
    await page.fill('#tm-close-reason', 'المشروع بلا كود مالي — يُحمَّل الشهر على القطاع');
    const live = await page.evaluate(() => ({ total: document.getElementById('tm-close-total')?.textContent.trim() || '', diff: document.getElementById('tm-close-diff')?.textContent.trim() || '',
      lines: document.querySelectorAll('#tm-close-lines tbody tr[data-kind]').length }));
    check('J7 · S23 حذف سطر المشروع ورفع القطاع إلى 100% يعيد المجموع إلى 100% ويعلن الاختلاف عن المسودة', live.lines === 1 && live.total === '100.00%' && /يختلف عن المسودة/.test(live.diff), JSON.stringify(live));
    const [cfRes] = await Promise.all([waitApi(page, 'POST', `/api/team/close/${periodId}/resources/${R6}/confirm`), page.click('[data-action="close-confirm"]')]);
    const cf = await jsonOf(cfRes);
    await page.waitForURL('**/app/team/close?**', { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    const after1 = (await readS22()).rows.find((r) => r.emp === R6);
    check('J7 · S23 «تأكيد التوزيع» يحفظه مؤكداً بلا استثناء ويعود إلى الشهر', cfRes.status() === 200 && (cf == null || (cf.reviewStatus === 'confirmed' && cf.exceptions?.length === 0))
      && !!after1 && after1.review === 'مؤكد' && after1.chips.length === 0, `HTTP ${cfRes.status()} ${errMsg({ json: cf, text: '' })} row=${JSON.stringify(after1)}`);
    await pageCheck(s, 'J7 · S22 بعد تأكيد مورد');
    await shot(s, 'j7-03-after-confirm-one');

    // بقية الموارد تُؤكَّد عبر واجهة البرمجة نفسها التي تناديها S23 (القطاع 100% لكلٍّ منها).
    const ov = await api(s, 'GET', `/team/close?sector=${SECTOR}&year=${pv.y}&month=${pv.m}`);
    const rest = (ov.json?.rows || []).filter((r) => !r.excluded && r.reviewStatus !== 'confirmed');
    let confirmed = 0; const failures = [];
    for (const r of rest) {
      const c = await api(s, 'POST', `/team/close/${periodId}/resources/${r.employeeId}/confirm`, { lines: [{ target_kind: 'sector', target_id: SECTOR, shareBp: 10000 }], reason: 'إقفال الشهر — التحميل على القطاع', sourceRef: 'manager_confirmation' });
      if (c.status === 200 && c.json?.reviewStatus === 'confirmed') confirmed++; else failures.push(`${r.name}: ${c.status} ${errMsg(c)}`);
    }
    const ov2 = await api(s, 'GET', `/team/close?sector=${SECTOR}&year=${pv.y}&month=${pv.m}`);
    check(`J7 · تأكيد بقية الموارد (${rest.length}) على القطاع يجعل المكتمل = الموارد ويفتح الإرسال`, failures.length === 0 && ov2.json?.counters?.complete === ov2.json?.counters?.resources && ov2.json?.canSendToFinance === true,
      `${failures.join(' | ')} counters=${JSON.stringify(ov2.json?.counters)} canSend=${ov2.json?.canSendToFinance} blockers=${(ov2.json?.blockers_ar || []).join(' · ')}`);

    await open(page, base, closeUrl);
    const s22b = await readS22();
    check('J7 · S22 بعد اكتمال التأكيد: «إرسال للمالية» مفعَّل والعدادات مكتملة', !!s22b.send && !s22b.send.disabled && s22b.counters.complete === s22b.counters.resources && s22b.counters.exceptions === 0, JSON.stringify({ send: s22b.send, counters: s22b.counters }));
    await shot(s, 'j7-04-ready-to-send');
    const [sendRes] = await Promise.all([waitApi(page, 'POST', `/api/team/close/${periodId}/send`), page.click('[data-action="close-send"]')]);
    const sent = await jsonOf(sendRes);
    await page.waitForFunction(() => (document.querySelector('.tm-close-status .pill')?.textContent || '').includes('المراجعة المالية'), null, { timeout: 12000 }).catch(() => {});
    const st2 = await txt(page, '.tm-close-status .pill');
    check('J7 · «إرسال للمالية» ينقل الشهر إلى «المراجعة المالية» (ردّ الخادم ثم الشاشة)', sendRes.status() === 200 && (sent == null || sent.period?.status === 'finance_review') && st2 === 'المراجعة المالية', `HTTP ${sendRes.status()} ${errMsg({ json: sent, text: '' })} shown=${st2}`);
    await pageCheck(s, 'J7 · S22 بعد الإرسال');
    await shot(s, 'j7-05-sent-to-finance');

    // ── S24 بمكتب الرئيس التنفيذي (المراجعة المالية) ──
    const ceo = await as('demo.ceo'); const cp = ceo.page;
    const r24 = await open(cp, base, closeUrl);
    const s24 = await cp.evaluate(() => ({
      lock: (() => { const b = document.querySelector('[data-action="close-lock"]'); return b ? { text: b.textContent.trim(), disabled: b.disabled, version: b.dataset.version } : null; })(),
      checks: document.querySelectorAll('.tm-close-check .it.ok').length, bad: document.querySelectorAll('.tm-close-check .it.no').length, status: document.querySelector('.tm-close-status .pill')?.textContent.trim() || '' }));
    check('J7 · S24 للمراجعة المالية: جاهزية الإقفال كلها ✓ وزر «اعتماد وإقفال الشهر» مفعَّل', r24?.status() === 200 && s24.status === 'المراجعة المالية' && !!s24.lock && s24.lock.text.includes('اعتماد وإقفال الشهر') && !s24.lock.disabled && s24.checks === 4 && s24.bad === 0, JSON.stringify(s24));
    await pageCheck(ceo, 'J7 · S24');
    await shot(ceo, 'j7-06-finance-review');
    await cp.click('[data-action="close-lock"]');
    await cp.waitForSelector('[data-action="close-lock-go"]', { timeout: 8000 }).catch(() => {});
    const [lockRes] = await Promise.all([waitApi(cp, 'POST', `/api/team/close/${periodId}/lock`), cp.click('[data-action="close-lock-go"]')]);
    const locked = await jsonOf(lockRes);
    await cp.waitForFunction(() => (document.querySelector('.tm-close-status .pill')?.textContent || '').includes('مقفل'), null, { timeout: 12000 }).catch(() => {});
    const s25 = await cp.evaluate(() => ({
      status: document.querySelector('.tm-close-status .pill')?.textContent.trim() || '', head: document.querySelector('.tm-close-status')?.innerText || '',
      exportHref: document.querySelector('.tm-actions a[href*="/export"]')?.getAttribute('href') || '', exportText: document.querySelector('.tm-actions a[href*="/export"]')?.textContent.trim() || '',
      versions: [...document.querySelectorAll('.tm-card table tbody tr')].filter((tr) => /الإصدار|مقفل|إصدار سابق/.test(tr.textContent)).length,
      transfer: document.querySelector('.tm-close-transfer')?.innerText || '' }));
    // حالة الترحيل للنظام المالي «لم يُرحَّل» دائماً في هذه النسخة (cost-close.js TRANSFER_STATUS_AR) — لا تكامل خارجي.
    check('J7 · الإقفال يثبّت الإصدار 1 وS25 تعرض رابط التصدير و«لم يُرحَّل» للترحيل', lockRes.status() === 200 && (locked == null || (locked.status === 'locked' && locked.version === 1)) && s25.status === 'مقفل' && /الإصدار\s*1/.test(s25.head)
      && s25.exportHref === `/api/team/close/${periodId}/export` && s25.exportText.includes('تصدير') && /لم يُرحَّل/.test(s25.transfer), `HTTP ${lockRes.status()} ${errMsg({ json: locked, text: '' })} ${JSON.stringify({ ...s25, head: s25.head.slice(0, 80) })}`);
    const exp = await api(ceo, 'GET', `/team/close/${periodId}/export`);
    check('J7 · رابط التصدير يعيد ملف CSV من اللقطة المقفلة', exp.status === 200 && /text\/csv/.test(exp.headers['content-type'] || '') && /resource_id,month,sector/.test(exp.text) && exp.text.includes(R6), `HTTP ${exp.status} ${(exp.headers['content-type'] || '')}`);
    await pageCheck(ceo, 'J7 · S25 (المراجعة المالية)');
    await shot(ceo, 'j7-07-locked-v1');

    // ── الكود المالي يُسجَّل من صفحة المشروع: حقل «الكود المالي» في هوية المشروع يستدعي مسار
    // التعديل نفسه (PATCH /api/projects/:id) — قائد القطاع يكتبه كما تطلب رسالة الإقفال، وإلا رُفض
    // تحميلُ التصحيح على مشروعٍ بلا كود. ──
    const fin = await api(s, 'PATCH', `/projects/${PRJ1}`, { financial_code: 'FX-FIN-001' });
    check('J7 · الكود المالي للمشروع يُكتب من مسار هوية المشروع (قائد القطاع) ويُعاد في الردّ', fin.status === 200 && fin.json?.financial_code === 'FX-FIN-001', `HTTP ${fin.status} ${errMsg(fin)} code=${fin.json?.financial_code}`);

    // ── S25 بقائد القطاع: طلب تصحيح لمورد (مشروع 60 / قطاع 40 ⇐ 50 / 50) ──
    const r25 = await open(page, base, closeUrl);
    const corrBtn = await page.locator(`[data-action="close-correct"][data-emp="${R6}"]`).count();
    check('J7 · S25 لقائد القطاع: الشهر مقفل وزر «طلب تصحيح» على المورد', r25?.status() === 200 && (await txt(page, '.tm-close-status .pill')) === 'مقفل' && corrBtn === 1, `btn=${corrBtn}`);
    await pageCheck(s, 'J7 · S25 (قائد القطاع)');
    await page.click(`[data-action="close-correct"][data-emp="${R6}"]`);
    await page.waitForSelector('#tm-close-drawer.open', { timeout: 8000 }).catch(() => {});
    const dr = await page.evaluate(() => ({ open: !!document.querySelector('#tm-close-drawer.open'), title: document.getElementById('tm-close-drawer-title')?.textContent.trim() || '',
      name: document.querySelector('#tm-close-drawer [data-slot="name"]')?.textContent.trim() || '', rows: document.querySelectorAll('#tm-close-drawer [data-slot="rows"] tr').length,
      old: document.querySelector('#tm-close-drawer [data-slot="oldTotal"]')?.textContent.trim() || '' }));
    check('J7 · S25 درج «طلب تصحيح» يُفتح بأسطر اللقطة المعتمدة للمورد (100%)', dr.open && dr.title === 'طلب تصحيح بعد الإقفال' && dr.name === R6_NAME && dr.rows === 1 && dr.old === '100.00%', JSON.stringify(dr));
    await shot(s, 'j7-08-correction-drawer');
    await page.locator('#tm-close-drawer [data-slot="rows"] tr').first().locator('input.tm-close-corr-pct').fill('50');
    await page.click('[data-action="close-corr-add"]');
    const added = page.locator('#tm-close-drawer [data-slot="rows"] tr').last();
    await added.locator('select.tm-close-corr-target').selectOption(`project:${PRJ1}`);
    await added.locator('input.tm-close-corr-pct').fill('50');
    await page.fill('#tm-close-corr-reason', 'نصف الشهر كان على مشروع منصة الخدمات الموحدة');
    await page.fill('#tm-close-corr-evidence', 'مذكرة مدير المشروع');
    const totals = await page.evaluate(() => ({ nw: document.querySelector('#tm-close-drawer [data-slot="newTotal"]')?.textContent.trim() || '', diff: document.querySelector('#tm-close-drawer [data-slot="diffTotal"]')?.textContent.trim() || '' }));
    check('J7 · S25 المقترح 50/50 يكتمل إلى 100% في المقارنة', totals.nw === '100.00%', JSON.stringify(totals));
    const [corrRes] = await Promise.all([waitApi(page, 'POST', `/api/team/close/${periodId}/resources/${R6}/correction`), page.click('[data-action="close-corr-submit"]')]);
    const corr = await jsonOf(corrRes);
    const errShown = await page.evaluate(() => document.querySelector('#tm-close-drawer [data-slot="err"]')?.textContent.trim() || '');
    check('J7 · S25 «إرسال طلب التصحيح» يُنشئ طلباً معلَّقاً للمراجعة المالية', corrRes.status() === 200 && corr?.status === 'pending',
      `HTTP ${corrRes.status()} — ${errMsg({ json: corr, text: errShown })}`);
    await shot(s, 'j7-09-correction-submitted');

    // ── قرار المراجعة المالية على التصحيح ⇐ الإصدار 2 والإصدار 1 يبقى مقروءاً ──
    if (corrRes.status() === 200 && corr?.id) {
      await open(cp, base, closeUrl);
      const [decRes] = await Promise.all([waitApi(cp, 'POST', `/api/team/close/corrections/${corr.id}/decide`), cp.click(`[data-corr="${corr.id}"] [data-action="close-decide"][data-act="approve"]`)]);
      const dec = await jsonOf(decRes);
      await cp.waitForFunction(() => /الإصدار\s*2/.test(document.querySelector('.tm-close-status')?.textContent || ''), null, { timeout: 12000 }).catch(() => {});
      const v2 = await cp.evaluate(() => ({ head: document.querySelector('.tm-close-status')?.innerText || '', versions: document.querySelectorAll('.tm-card table tbody tr.is-sel').length,
        older: document.querySelector('a[href*="version="]')?.getAttribute('href') || '' }));
      check('J7 · اعتماد التصحيح ينشئ الإصدار 2 مقفلاً', decRes.status() === 200 && dec?.period?.version === 2 && /الإصدار\s*2/.test(v2.head), `HTTP ${decRes.status()} ${JSON.stringify(v2)}`);
      const v1 = await open(cp, base, `${closeUrl}&version=${periodId}`);
      const v1s = await cp.evaluate(() => ({ head: document.querySelector('.tm-close-status')?.innerText || '', warn: document.querySelector('.tm-warn')?.textContent || '' }));
      check('J7 · الإصدار 1 يبقى مقروءاً بلا كتابة فوقه', v1?.status() === 200 && /الإصدار\s*1/.test(v1s.head) && /إصدار سابق/.test(v1s.head + v1s.warn), JSON.stringify(v1s));
      await pageCheck(ceo, 'J7 · S25 الإصدار 1');
      await shot(ceo, 'j7-10-version-1-readable');
    } else {
      t.fail('J7 · اعتماد التصحيح ينشئ الإصدار 2 مقفلاً', 'متعذّر — لم يُنشأ طلب تصحيح (انظر السطر السابق)');
      t.fail('J7 · الإصدار 1 يبقى مقروءاً بلا كتابة فوقه', 'متعذّر — لا إصدار ثانٍ لمقارنته');
    }
  }

  for (const s of sessions.values()) await s.ctx.close();
}
