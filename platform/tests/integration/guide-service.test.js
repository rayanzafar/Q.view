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
  assert.deepEqual(Object.keys(g).sort(), ['glossary', 'intro_ar', 'limits_ar', 'pages', 'role'].sort());
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

test('التغطية: كل شاشة في الكتالوج لها بوابة حقيقية، والشاشات المطلوبة كلها مغطاة', () => {
  for (const k of content.PAGE_KEYS) {
    assert.ok(typeof PAGE_ACCESS[k] === 'function', `الشاشة ${k} في الدليل بلا بوابة في المنتج`);
  }
  const required = ['tasks', 'timesheet', 'sector', 'opportunities', 'my-opportunities', 'projects', 'clients',
    'finance', 'team', 'staffing', 'approvals', 'reports', 'org', 'imports', 'ceo', 'portfolio', 'users', 'audit'];
  for (const k of required) assert.ok(content.PAGE_KEYS.includes(k), `الشاشة المطلوبة ${k} غير مغطاة في الدليل`);
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
  assert.ok(keys.includes('tasks') && keys.includes('timesheet'));
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
  const fin = await guide.guideFor(U('finance'));
  assert.ok(fin.glossary.some((t) => t.term_ar === 'الهامش'), 'المالية تقرأ الهامش فيجب أن يُشرح لها');
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
  assert.deepEqual(cons.slice(0, 3), ['tasks', 'timesheet', 'projects'], 'المنفّذ يبدأ من مهامه ووقته');
  assert.ok(navRank[cons[0]] > navRank[cons[cons.length - 1]] || cons[0] !== 'sector',
    'ترتيب الدليل يجب ألا يكون نسخة من ترتيب القائمة');

  const fin = (await guide.guideFor(U('finance'))).pages.map((p) => p.key);
  assert.equal(fin[0], 'finance', 'المالية تبدأ من شاشتها لا من أول عنصر في القائمة');
  assert.ok(fin.includes('ceo') && fin.indexOf('ceo') > 0, 'لوحة القيادة متاحة لها لكنها ليست بداية رحلتها');

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
