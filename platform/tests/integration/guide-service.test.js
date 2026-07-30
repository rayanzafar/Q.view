// «دليلي» — اختبار الخاصية الأمنية قبل الخاصية الوظيفية.
//
// الميزة كلها قائمة على وعد واحد: لا يمكن لدليل شخص أن يصف شاشة أو رقماً لا يملكه، لأن
// المحتوى يمرّ من البوابة نفسها التي تفتح الصفحة أو ترفضها (PAGE_ACCESS) ومن محرّك الصلاحيات
// نفسه (can/effectiveScope/canSeeSensitive). ما يحرسه هذا الملف:
//   • كل مفتاح شاشة يعود في الدليل يجتاز دالة الصفحة نفسها — لكل دور في المصفوفة لا لدور واحد.
//   • الراتب: لا دور غير مدير النظام يرى كلمة «راتب» أو «رواتب» في أي سطر من دليله. قرار مالك
//     مختوم — والاختبار يثبت أيضاً أن البوابة ليست خاوية (دليل مدير النظام يذكرها فعلاً).
//   • من نطاقه قطاع لا يَعِده دليله برؤية على مستوى الشركة.
//   • الجولة تعيد «لا شيء» بهدوء لشاشة خارج صلاحيته — لا استثناء ولا تلميح إلى وجودها.
//   • الدليل قراءة صرفة: عدد سطور التدقيق قبل النداءات وبعدها واحد.
//   • كل دور يحصل على دليل غير فارغ فيه «مهامي» على الأقل — لا أحد يفتح دليلاً خاوياً.
//   • كل نص يقرؤه المستخدم خالٍ من المصطلحات التقنية والقيم الخام (فاحص المعجم نفسه).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-guide.db');
process.env.SANAD_DB = TEST_DB;

let db, guide, content, PAGE_ACCESS, NAV_ITEMS, ROLE_GRANTS, ROLE_LABELS, bannedTermIn;

const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };

before(async () => {
  wipe();
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate();
  await seedRbac();
  const { initRbac } = await import('../../src/core/rbac/index.js');
  await initRbac();
  ({ PAGE_ACCESS, NAV_ITEMS } = await import('../../src/web/nav.js'));
  ({ ROLE_GRANTS, ROLE_LABELS } = await import('../../src/core/rbac/matrix.js'));
  ({ bannedTermIn } = await import('../../scripts/check-glossary.mjs'));
  guide = await import('../../src/modules/guide/guide.js');
  content = await import('../../src/core/guide/content.js');
});

after(async () => { await db.close(); wipe(); });

// ── أدوات ─────────────────────────────────────────────────────────────────────
const RANK = { company: 5, sector: 4, department: 3, project: 2, team: 2, own: 1 };
// نطاق الحساب كما يضبطه مدير النظام عملياً: أوسع نطاق تمنحه أدوار الدور نفسه.
const scopeOf = (role) => {
  const widest = (ROLE_GRANTS[role] || []).reduce((b, g) => ((RANK[g.scope] || 0) > (RANK[b] || 0) ? g.scope : b), 'own');
  return widest === 'company' ? 'company' : widest === 'sector' ? 'sector' : 'own';
};
const U = (role, sector = 'SOLUTIONS') => ({
  id: 'u_' + role, username: role, role_id: role, sector_id: sector, department_id: null,
  scope: scopeOf(role), projectIds: new Set(['P1']), teamIds: new Set(),
});
const ROLES = () => Object.keys(ROLE_GRANTS);

// كل نص يقرؤه المستخدم = كل قيمة تحت مفتاح ينتهي بـ«_ar».
const readable = (node, key = '') => {
  if (typeof node === 'string') return key.endsWith('_ar') ? [node] : [];
  if (Array.isArray(node)) return node.flatMap((n) => readable(n, key));
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => readable(v, k));
  return [];
};
// كل نص أياً كان موضعه (لفحص التسريب: الكلمة الممنوعة ممنوعة في أي خانة).
const anyText = (node) => {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(anyText);
  if (node && typeof node === 'object') return Object.values(node).flatMap(anyText);
  return [];
};

// ── العقد ─────────────────────────────────────────────────────────────────────
test('العقد: شكل الدليل كما اتفقت عليه الحارتان بالضبط', async () => {
  const g = await guide.guideFor(U('sector_lead'));
  // «scenarios» أُضيف بطلب المالك (دليلٌ يُمشى في قصةٍ لا يُقرأ ككتالوج شاشات). ويُذكر هنا
  // صراحةً لا يُتساهَل معه: العقد يُوسَّع بقرار مكتوب، وأي مفتاح يظهر بلا قصد يبقى يُسقط الفحص.
  assert.deepEqual(Object.keys(g).sort(), ['glossary', 'intro_ar', 'limits_ar', 'pages', 'role', 'scenarios'].sort());
  // وشكل السيناريو نفسه جزءٌ من العقد: بلا «متى» و«الأثر» يصير تعليمةً لا قصة.
  assert.ok(Array.isArray(g.scenarios), 'السيناريوهات قائمة دائماً — وقد تكون فارغة لدورٍ بلا سيناريو');
  for (const sc of g.scenarios) {
    assert.deepEqual(Object.keys(sc).sort(), ['outcome_ar', 'steps_ar', 'title_ar', 'when_ar'].sort());
    assert.ok(Array.isArray(sc.steps_ar) && sc.steps_ar.length >= 3, `السيناريو «${sc.title_ar}» خطواته أقل من ثلاث`);
  }
  assert.deepEqual(Object.keys(g.role).sort(), ['id', 'name_ar']);
  assert.equal(g.role.id, 'sector_lead');
  assert.equal(g.role.name_ar, ROLE_LABELS.sector_lead.ar);
  assert.ok(g.intro_ar.length > 40, 'التعريف بالدور سطر أو سطران لا كلمة');
  for (const p of g.pages) {
    assert.deepEqual(Object.keys(p).sort(), ['first_steps_ar', 'key', 'nav_ar', 'purpose_ar', 'watch_out_ar', 'weekly_ar'].sort());
    assert.ok(p.nav_ar && p.purpose_ar, `الشاشة ${p.key} بلا اسم أو بلا غاية`);
    assert.ok(Array.isArray(p.first_steps_ar) && p.first_steps_ar.length >= 1 && p.first_steps_ar.length <= 4,
      `${p.key}: خطوات اليوم الأول يجب أن تكون بين واحدة وأربع`);
    assert.ok(Array.isArray(p.weekly_ar) && p.weekly_ar.length >= 1 && p.weekly_ar.length <= 4,
      `${p.key}: العادة الأسبوعية يجب أن تكون بين بند وأربعة`);
    assert.ok(p.watch_out_ar === null || (typeof p.watch_out_ar === 'string' && p.watch_out_ar.length > 10),
      `${p.key}: التحذير إما نص واضح وإما لا شيء`);
  }
  for (const t of g.glossary) {
    assert.deepEqual(Object.keys(t).sort(), ['meaning_ar', 'term_ar']);
    assert.ok(t.term_ar && t.meaning_ar);
  }
  assert.ok(g.limits_ar.length >= 1 && g.limits_ar.every((s) => typeof s === 'string' && s.length > 20));

  const tour = guide.tourFor(U('sector_lead'), 'sector');
  assert.deepEqual(Object.keys(tour).sort(), ['page', 'steps', 'title_ar']);
  assert.equal(tour.page, 'sector');
  for (const s of tour.steps) {
    assert.deepEqual(Object.keys(s).sort(), ['anchor', 'body_ar', 'title_ar']);
    assert.ok(s.anchor.length > 0 && s.title_ar.length > 0 && s.body_ar.length > 0);
  }
});

// ── التغطية: حارس بنيوي لا قائمة مكتوبة بيد ──────────────────────────────────
// كان الحارس هنا قائمة ثمانية عشر مفتاحاً مكتوبة داخل الاختبار: تثبّت ما هو قائم، ولا ترى
// شاشةً جديدة أبداً — فأي سطح يُضاف إلى المنتج يبقى بلا دليل ولا شيء يقول ذلك. الحارس الآن
// يشتقّ التوقّع من **سياسة فتح الصفحات نفسها**: كل شاشة إما موصوفة، وإما مستثناة بسبب مكتوب.
test('التغطية: كل شاشة في المنتج موصوفة في الدليل أو مستثناة بسبب معلن — والعكس', () => {
  for (const k of content.PAGE_KEYS) {
    assert.ok(typeof PAGE_ACCESS[k] === 'function', `الشاشة ${k} في الدليل بلا بوابة في المنتج`);
  }
  const productKeys = Object.keys(PAGE_ACCESS);
  const exempt = content.CATALOGUE_EXEMPT;
  for (const k of productKeys) {
    if (content.PAGE_KEYS.includes(k)) continue;
    assert.ok(Object.hasOwn(exempt, k),
      `شاشة «${k}» في المنتج ولا وصف لها في الدليل ولا استثناء معلن — أضِف محتواها أو أعلن سبب استثنائها`);
    assert.ok(typeof exempt[k] === 'string' && exempt[k].length > 40,
      `استثناء «${k}» بلا سبب مكتوب مفهوم`);
  }
  // لا استثناء متروك بعد زوال سببه: كل مفتاح مستثنى ما زال شاشةً في المنتج وليس موصوفاً أيضاً.
  for (const k of Object.keys(exempt)) {
    assert.ok(productKeys.includes(k), `استثناء «${k}» لشاشة لم تعد موجودة في المنتج — احذفه`);
    assert.ok(!content.PAGE_KEYS.includes(k), `الشاشة «${k}» موصوفة ومستثناة معاً — قرار واحد لا اثنان`);
  }
});

test('التغطية: كل شاشة موصوفة لها جولة، أو استثناء معلن — ولا جولة لشاشة لا وجود لها', () => {
  const tourKeys = Object.keys(content.TOURS);
  const exempt = content.TOUR_EXEMPT;
  for (const k of content.PAGE_KEYS) {
    if (tourKeys.includes(k)) continue;
    assert.ok(Object.hasOwn(exempt, k),
      `الشاشة «${k}» موصوفة في الدليل وبلا جولة — أضِف جولتها أو أعلن سبب استثنائها`);
    assert.ok(typeof exempt[k] === 'string' && exempt[k].length > 40, `استثناء جولة «${k}» بلا سبب مكتوب مفهوم`);
  }
  for (const k of Object.keys(exempt)) {
    assert.ok(content.PAGE_KEYS.includes(k), `استثناء جولة «${k}» لشاشة غير موصوفة أصلاً — احذفه`);
    assert.ok(!tourKeys.includes(k), `الشاشة «${k}» لها جولة واستثناء معاً — قرار واحد لا اثنان`);
  }
  // جولة لمفتاح ليس شاشةً في المنتج = جولة لا تُفتح أبداً (tourFor يمرّ من البوابة نفسها).
  for (const k of tourKeys) {
    assert.ok(typeof PAGE_ACCESS[k] === 'function', `جولة «${k}» لشاشة لا بوابة لها في المنتج`);
    assert.ok((content.TOURS[k].steps || []).length >= 2, `جولة «${k}» أقصر من أن تفيد`);
  }
});

test('التغطية: كل قدرة يشترطها نص موجودة فعلاً في القدرات التي تحسبها الخدمة', () => {
  const declared = new Set(content.CAPABILITY_KEYS);
  const computed = Object.keys(guide.capsOf(U('admin')));
  assert.deepEqual([...declared].sort(), computed.slice().sort(),
    'قائمة القدرات المعلنة في الكتالوج تخالف ما تحسبه الخدمة — إحداهما تعِد بشرط لا يُقيَّم');

  // كل `cap`/`not` مذكور في أي عبارة أو خطوة جولة يجب أن يكون قدرة معلنة: شرطٌ باسم غير معروف
  // يجعل العبارة تختفي عند الجميع بصمت (caps[undefined] ⟵ لا شيء) وهو أسوأ من ظهورها للجميع.
  const conds = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      if (typeof node.cap === 'string') conds.push(node.cap);
      if (typeof node.not === 'string') conds.push(node.not);
      Object.values(node).forEach(walk);
    }
  };
  walk(content.PAGES); walk(content.TOURS); walk(content.TERMS);
  assert.ok(conds.length > 5, 'الشروط لا تُقرأ أصلاً — الفحص نفسه معطَّل');
  for (const c of conds) assert.ok(declared.has(c), `شرط «${c}» ليس قدرة معلنة، فالعبارة المشروطة به لن تظهر لأحد`);
});

test('التغطية: كل مصطلح تشير إليه شاشة له تعريف مكتوب', () => {
  for (const k of content.PAGE_KEYS) {
    for (const t of content.PAGES[k].terms || []) {
      assert.ok(content.TERMS[t], `الشاشة ${k} تشير إلى مصطلح «${t}» بلا تعريف`);
    }
  }
});

// ── الخاصية الأمنية الأولى: لا شاشة خارج الصلاحية ─────────────────────────────
test('أمان: كل شاشة في دليل أي دور يستطيع صاحبها فتحها فعلاً', async () => {
  for (const role of ROLES()) {
    const u = U(role);
    const g = await guide.guideFor(u);
    for (const p of g.pages) {
      assert.equal(PAGE_ACCESS[p.key](u), true,
        `${role}: دليله يصف «${p.nav_ar}» وهي شاشة يُرفض دخوله إليها`);
    }
    // والعكس: لا تُحذف شاشة يملكها فعلاً وللكتالوج محتوى عنها
    for (const k of content.PAGE_KEYS) {
      if (PAGE_ACCESS[k](u)) assert.ok(g.pages.some((p) => p.key === k), `${role}: شاشة ${k} مفتوحة له وغائبة عن دليله`);
    }
  }
});

test('أمان: دليل الاستشاري لا يذكر شاشة إدارية واحدة', async () => {
  const u = U('consultant');
  const g = await guide.guideFor(u);
  const keys = g.pages.map((p) => p.key);
  for (const k of keys) assert.equal(PAGE_ACCESS[k](u), true, `الاستشاري لا يفتح ${k}`);
  for (const k of ['org', 'users', 'audit', 'ceo', 'portfolio', 'finance', 'team', 'staffing', 'approvals', 'mail', 'clients']) {
    assert.ok(!keys.includes(k), `دليل الاستشاري يجب ألا يذكر ${k}`);
  }
  assert.ok(keys.includes('tasks'), 'دليل الاستشاري يبدأ من مهامه');
  assert.ok(!keys.includes('timesheet'), 'سجل الوقت أُزيل من المنصة فلا يُذكر في أي دليل');
});

// ── الخاصية الأمنية الثانية: الراتب مختوم لمدير النظام وحده ───────────────────
test('أمان: لا دور غير مدير النظام يجد كلمة راتب أو رواتب في أي سطر من دليله', async () => {
  const SALARY = /رات(ب|ِب)|رواتب/;
  for (const role of ROLES()) {
    if (role === 'admin') continue;
    const u = U(role);
    const g = await guide.guideFor(u);
    const texts = anyText(g);
    for (const k of content.PAGE_KEYS) {
      const t = guide.tourFor(u, k);
      if (t) texts.push(...anyText(t));
    }
    const leak = texts.find((s) => SALARY.test(s));
    assert.equal(leak, undefined, `${role}: تسرّب ذكر الراتب إلى دليله — «${leak}»`);
  }
  // البوابة ليست خاوية: من يملك الحقل فعلاً يجد الإرشاد الخاص به
  const adminTexts = anyText(await guide.guideFor(U('admin')));
  assert.ok(adminTexts.some((s) => SALARY.test(s)), 'مدير النظام يجب أن يجد إرشاد التعامل مع الرواتب في دليله');
});

test('أمان: التكلفة والهامش لا يظهران في معجم من لا يقرؤهما', async () => {
  for (const role of ROLES()) {
    const u = U(role);
    const caps = guide.capsOf(u);
    const g = await guide.guideFor(u);
    const terms = g.glossary.map((t) => t.term_ar);
    if (!caps.seeCost) assert.ok(!terms.includes('التكلفة'), `${role}: «التكلفة» في معجمه بلا صلاحية قراءتها`);
    if (!caps.seeMargin) assert.ok(!terms.includes('الهامش'), `${role}: «الهامش» في معجمه بلا صلاحية قراءته`);
  }
  const fin = await guide.guideFor(U('ceo_office'));
  assert.ok(fin.glossary.some((t) => t.term_ar === 'الهامش'), 'مكتب الرئيس التنفيذي يقرأ الهامش فيجب أن يُشرح له');
});

// ── الخاصية الأمنية الثالثة: نطاق القطاع لا يُوعَد برؤية الشركة ───────────────
test('أمان: من نطاقه قطاع لا يَعِده دليله برؤية على مستوى الشركة', async () => {
  const CLAIMS = ['كل القطاعات', 'جميع القطاعات', 'القطاعات كلها', 'على مستوى الشركة',
    'الشركة كلها', 'الشركة كاملة', 'كامل الشركة', 'كل الشركة'];
  let checked = 0;
  for (const role of ROLES()) {
    const u = U(role);
    if (!guide.capsOf(u).sectorSight) continue;
    checked++;
    const g = await guide.guideFor(u);
    const texts = anyText(g);
    for (const claim of CLAIMS) {
      const hit = texts.find((s) => s.includes(claim));
      assert.equal(hit, undefined, `${role}: نطاقه قطاعه ودليله يقول «${claim}» — «${hit}»`);
    }
    assert.ok(!g.pages.some((p) => p.key === 'ceo' || p.key === 'portfolio'),
      `${role}: شاشات مستوى الشركة يجب ألا تظهر لمن نطاقه قطاع`);
    assert.ok(g.limits_ar.some((s) => s.includes('قطاعك')), `${role}: حدوده يجب أن تشرح أن نطاقه قطاعه`);
  }
  assert.ok(checked >= 2, 'يجب أن يشمل الفحص أكثر من دور واحد بنطاق قطاع');
});

// ── نطاق «الإدارة»: وصفٌ يطابق ما يفعله المنتج، لا ما نتمنّاه ولا ما دونه ─────
// كان مدير الإدارة والمدير المباشر يسقطان في «نطاقه الضيق» فيقرأ كلٌّ منهما أن ما يراه «محصور
// في عملك ومشاريعك» — وهو وصفٌ لدور آخر: نطاقهما أشخاص إدارتهما. والوصف الصحيح مقيَّد من
// الجهتين: يذكر ما ضاق فعلاً (الأشخاص والمهام)، ولا يَعِد بتضييق القوائم إلى الإدارة لأنه
// **غير مفعَّل** حتى تُنسَب الأعمال إلى إدارات (src/core/rbac/scope.js).
test('نطاق الإدارة: لا يُقال لصاحبه إن ما يراه عمله وحده، ولا يُوعَد بتضييق لم يُفعَّل', async () => {
  let checked = 0;
  for (const role of ROLES()) {
    const caps = guide.capsOf(U(role));
    if (!caps.departmentSight) continue;
    checked++;
    assert.equal(caps.narrowSight, false, `${role}: نطاقه إدارته لا عمله وحده`);
    assert.equal(caps.sectorSight, false, `${role}: ونطاقه ليس القطاع`);
    const g = await guide.guideFor(U(role));
    const limits = g.limits_ar.join(' ');
    assert.ok(limits.includes('إدارتك'), `${role}: حدوده يجب أن تسمّي إدارته`);
    assert.ok(!limits.includes('محصور في عملك ومشاريعك'), `${role}: وُصف نطاقه بأضيق مما هو`);
    assert.ok(/قطاعك/.test(limits),
      `${role}: يجب أن يُقال صراحةً إن قوائم المشاريع والفرص تصله بنطاق قطاعه اليوم`);
    assert.ok(!/(المشاريع|الفرص)[^.]{0,60}إدارتك وحدها/.test(limits),
      `${role}: الدليل يَعِد بتضييق القوائم إلى الإدارة وهو غير مفعَّل`);
  }
  assert.equal(checked, 2, 'الدوران المعنيان اثنان: مدير إدارة ومدير مباشر');
});

test('نطاق الإدارة: «التقارير» شاشة يفتحها صاحبها فعلاً، وهي في رحلته لا في ذيلها', async () => {
  for (const role of ['department_manager', 'line_manager']) {
    const u = U(role);
    assert.equal(PAGE_ACCESS.reports(u), true, `${role}: يفتح التقارير فعلاً`);
    assert.ok(content.ROLE_JOURNEY[role].includes('reports'), `${role}: التقارير جزء من رحلته المعلنة`);
    const keys = (await guide.guideFor(u)).pages.map((p) => p.key);
    assert.ok(keys.includes('reports'), `${role}: التقارير غائبة عن دليله`);
    assert.ok(keys.indexOf('reports') < keys.indexOf('tasks'), `${role}: تقارير إدارته قبل مهامه الشخصية`);
    // ولا يُشرح له ما لا يملكه: التصدير والجدولة خارج منحه.
    assert.equal(guide.capsOf(u).exportReports, false, `${role}: لا تصدير ولا جدولة`);
    const reports = (await guide.guideFor(u)).pages.find((p) => p.key === 'reports');
    const text = [...reports.first_steps_ar, ...reports.weekly_ar].join(' ');
    assert.ok(!text.includes('جدولة'), `${role}: شُرحت له جدولة لا يملكها`);
  }
});

test('أمان: نطاق القطاع يُقرأ من اتساع المنح لا من وجودها — مدير تطوير الأعمال مثالاً', () => {
  // can(user,'read','project') تعود true لمجرد وجود منح؛ الفرق يظهر هنا: مدير تطوير الأعمال
  // نطاقه قطاع، ورئيس تطوير الأعمال نطاقه شركة، والاستشاري نطاقه عمله.
  assert.equal(guide.capsOf(U('bd_manager')).sectorSight, true);
  assert.equal(guide.capsOf(U('bd_manager')).companySight, false);
  assert.equal(guide.capsOf(U('bd_head')).companySight, true);
  assert.equal(guide.capsOf(U('consultant')).narrowSight, true);
  assert.equal(guide.capsOf(U('consultant')).companySight, false);
});

// ── الجولة ────────────────────────────────────────────────────────────────────
test('الجولة: لا شيء بهدوء لشاشة خارج الصلاحية أو لا وجود لها', () => {
  const u = U('consultant');
  for (const k of ['org', 'users', 'audit', 'ceo', 'portfolio', 'finance', 'team', 'staffing']) {
    assert.equal(guide.tourFor(u, k), null, `الاستشاري يجب ألا يحصل على جولة ${k}`);
  }
  assert.equal(guide.tourFor(u, 'شاشة-غير-موجودة'), null);
  assert.equal(guide.tourFor(u, ''), null);
  assert.equal(guide.tourFor(u, null), null);
  assert.equal(guide.tourFor(u, undefined), null);
  const t = guide.tourFor(u, 'tasks');
  assert.ok(t && t.steps.length >= 3, 'جولة «مهامي» متاحة للجميع');
});

test('الجولة: خطواتها مشروطة بالقدرة لا بالشاشة وحدها', () => {
  const consultant = guide.tourFor(U('consultant'), 'imports');
  assert.ok(consultant, 'الاستشاري يفتح شاشة البيانات فعلاً (قراءة مشاريعه) فله جولتها');
  const consultantText = anyText(consultant).join(' ');
  assert.ok(!consultantText.includes('عايِن قبل التنفيذ'), 'من لا يستورد لا يُشرح له الاستيراد');
  assert.ok(consultantText.includes('التصدير'), 'يُشرح له ما يستطيعه فعلاً: التصدير');

  const adminText = anyText(guide.tourFor(U('admin'), 'imports')).join(' ');
  assert.ok(adminText.includes('عايِن قبل التنفيذ'), 'من يستورد يُشرح له الاستيراد كاملاً');
});

test('الجولة: كل جولة تعود لأي دور تخصّ شاشة يفتحها ذلك الدور', async () => {
  for (const role of ROLES()) {
    const u = U(role);
    for (const k of content.PAGE_KEYS) {
      const t = guide.tourFor(u, k);
      if (!t) continue;
      assert.equal(PAGE_ACCESS[k](u), true, `${role}: جولة ${k} بلا صلاحية فتحها`);
      assert.equal(t.page, k);
      assert.ok(t.steps.length >= 2, `${role}: جولة ${k} أقصر من أن تفيد`);
    }
  }
});

// ── لا كتابة ─────────────────────────────────────────────────────────────────
test('الدليل قراءة صرفة: لا سطر تدقيق ولا صف جديد', async () => {
  const count = async () => (await db.get('SELECT COUNT(*) AS n FROM audit_log')).n;
  const before_ = await count();
  for (const role of ROLES()) {
    await guide.guideFor(U(role));
    for (const k of content.PAGE_KEYS) guide.tourFor(U(role), k);
  }
  assert.equal(await count(), before_, 'الدليل لا يكتب سطر تدقيق — القراءة ليست فعلاً يُسجَّل');
});

// ── لا دليل خاوٍ ─────────────────────────────────────────────────────────────
test('كل دور في المصفوفة يحصل على دليل غير فارغ فيه «مهامي» على الأقل', async () => {
  for (const role of ROLES()) {
    const g = await guide.guideFor(U(role));
    assert.ok(g.role.name_ar && /[؀-ۿ]/.test(g.role.name_ar), `${role}: اسم الدور يجب أن يكون عربياً`);
    assert.ok(g.intro_ar && g.intro_ar.length > 30, `${role}: بلا تعريف بدوره`);
    assert.ok(g.pages.length >= 1, `${role}: دليل خاوٍ`);
    assert.ok(g.pages.some((p) => p.key === 'tasks'), `${role}: «مهامي» مفتوحة للجميع فيجب أن تكون في دليله`);
    assert.ok(g.limits_ar.length >= 1, `${role}: بلا حدود مشروحة`);
  }
});

test('دور أنشأه مدير النظام لاحقاً يجد اسمه العربي في دليله', async () => {
  await db.insert('role', { id: 'r_qa', name_ar: 'مسؤول الجودة', name_en: 'Quality Officer', is_system: 0, created_at: '2026-07-01T00:00:00Z' });
  await db.run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['r_qa', 'project', 'read', 'sector']);
  const { initRbac } = await import('../../src/core/rbac/index.js');
  await initRbac();
  const g = await guide.guideFor({ id: 'u_qa', role_id: 'r_qa', sector_id: 'SOLUTIONS', scope: 'sector', projectIds: new Set(), teamIds: new Set() });
  assert.equal(g.role.name_ar, 'مسؤول الجودة');
  assert.equal(g.intro_ar, content.DEFAULT_INTRO, 'الدور المخصَّص يأخذ التعريف العام لا فراغاً');
  assert.ok(g.pages.some((p) => p.key === 'projects'));
});

// ── ترتيب الرحلة لا ترتيب القائمة ────────────────────────────────────────────
test('الترتيب: الشاشات تأتي بترتيب رحلة صاحبها لا بترتيب القائمة الجانبية', async () => {
  const navRank = Object.fromEntries(NAV_ITEMS.map((n, i) => [n.key, i]));
  const cons = (await guide.guideFor(U('consultant'))).pages.map((p) => p.key);
  assert.deepEqual(cons.slice(0, 2), ['tasks', 'projects'], 'المنفّذ يبدأ من مهامه ثم مشاريعه');
  assert.ok(navRank[cons[0]] > navRank[cons[cons.length - 1]] || cons[0] !== 'sector',
    'ترتيب الدليل يجب ألا يكون نسخة من ترتيب القائمة');

  // مكتب الرئيس التنفيذي: رحلته تبدأ من لوحة القيادة، و«المالية والعقود» في آخرها — وقد ورث
  // مالية الشركة بعد إلغاء دور «المالية»، فشاشتها في دليله لا في صدره.
  const fin = (await guide.guideFor(U('ceo_office'))).pages.map((p) => p.key);
  assert.equal(fin[0], 'ceo', 'يبدأ من شاشة قراره لا من أول عنصر في القائمة');
  assert.ok(fin.includes('finance') && fin.indexOf('finance') > 0, 'ومالية الشركة في دليله بعد أن ورثها');

  const lead = (await guide.guideFor(U('sector_lead'))).pages.map((p) => p.key);
  assert.equal(lead[0], 'sector', 'قائد القطاع يبدأ من مركز قيادته');
  assert.ok(lead.indexOf('approvals') < lead.indexOf('tasks'), 'قراره قبل مهامه الشخصية');
});

// ── لغة المستخدم ─────────────────────────────────────────────────────────────
test('اللغة: كل نص يقرؤه المستخدم عربي وخالٍ من المصطلحات التقنية والقيم الخام', async () => {
  for (const role of ROLES()) {
    const u = U(role);
    const texts = readable(await guide.guideFor(u));
    for (const k of content.PAGE_KEYS) {
      const t = guide.tourFor(u, k);
      if (t) texts.push(...readable(t));
    }
    for (const s of texts) {
      const term = bannedTermIn(s);
      assert.equal(term, null, `${role}: مصطلح محظور «${term}» داخل نص الدليل: ${s.slice(0, 80)}`);
      assert.ok(/[؀-ۿ]/.test(s), `${role}: نص بلا حرف عربي واحد: ${s.slice(0, 80)}`);
    }
  }
});

test('اللغة: مفردات المنتج تُستعمل كما هي لا مرادفات مخترعة', async () => {
  const lead = await guide.guideFor(U('sector_lead'));
  const all = anyText(lead).join(' ');
  for (const term of ['القيمة المرجّحة', 'الخطوة التالية', 'على المسار', 'المستحق', 'التسكين']) {
    assert.ok(all.includes(term), `مفردة المنتج «${term}» غائبة عن دليل قائد القطاع`);
  }
});

// ── الحدود ───────────────────────────────────────────────────────────────────
test('الحدود: تشرح السبب ولا تعتذر، ولا تذكر ما هو مختوم', async () => {
  const cons = await guide.guideFor(U('consultant'));
  assert.ok(cons.limits_ar.length >= 2);
  for (const s of cons.limits_ar) {
    assert.ok(!/عذر|نأسف|للأسف|ممنوع عليك|لا تستطيع/.test(s), `صياغة اعتذارية أو نافية: ${s}`);
  }
  const admin = await guide.guideFor(U('admin'));
  assert.ok(admin.limits_ar.some((s) => s.includes('سجل التدقيق')), 'حدّ مدير النظام هو الأثر المسجَّل');
});
