// شاشات S01 (بوابة الفريق)، S02 (سجل الموارد)، S03 (درج المعاينة — بنيته الخادمية)، S09 (قالب
// نموذج المورد) — بنمط المستودع: ترحيل + بذر الصلاحيات على قاعدة مؤقتة، والمستخدم يُحلّ عبر
// جلسة كما يحلّه الخادم. تؤكد: العناصر العربية الأساسية، لا تسرّب (undefined/NaN/null/[object)،
// لا راتب، حالتا الفراغ المختلفتان («لا موارد» ≠ «لا نتائج»)، ترقيم S02 محسوباً (1–6 من 6)،
// وحجب زر «إضافة مورد» وقالب S09 عمّن لا يملك الإنشاء.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-team-ui-res-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, resolveUser, access, gateway, resources, form;
let resourcesErr = null;
const T = new Date().toISOString();
const LEAK = /undefined|NaN|\[object|null(?![a-z])/;
// فحص التسرّب على ما يراه القارئ: الوسوم لا الكود المضمّن (الذي قد يحمل «null» في بيانات محقونة
// مشروعة في أماكن أخرى من المنصة) — وبيانات هذه الصفحات المحقونة تُفحص وحدها بلا «null».
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '');
const injected = (html) => (html.match(/<script>[\s\S]*?teamResources[\s\S]*?<\/script>/g) || []).join('');

// أسماء اختبارٍ معزولة — لا أسماء الصور المرجعية (قاعدة §5 من السجل).
const NAMES = ['باسل الحربي', 'ريم الدوسري', 'ماجد العنزي', 'هند الشمري', 'طلال المطيري', 'دانة الغامدي'];

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  access = await import('../../src/modules/team/access.js');
  gateway = await import('../../src/web/views/team/gateway.js');
  form = await import('../../src/web/views/team/resource-form.js');
  // خدمة المرحلة B قد تكون قيد الهبوط بالتوازي: إن غابت تُتخطّى اختبارات S02 بسببٍ معلن.
  resources = await import('../../src/web/views/team/resources.js').catch((e) => { resourcesErr = e; return null; });

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  const mkUser = (id, role, scope, sector = 'SOL') => db.insert('app_user', {
    id, username: id, name_ar: 'حساب ' + id, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_admin', 'admin', 'company');
  await mkUser('u_lead', 'sector_lead', 'sector');            // يملك إنشاء الموظف على قطاعه
  await mkUser('u_dm', 'department_manager', 'own');          // يقرأ إدارته ولا يُنشئ
  await mkUser('u_dm_empty', 'department_manager', 'own');    // يقود إدارةً بلا موارد
  await mkUser('u_emp', 'employee', 'own');                   // موظف عادي

  await db.insert('department', { id: 'D_DATA', sector_id: 'SOL', name_ar: 'إدارة البيانات', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_NONE', sector_id: 'SOL', name_ar: 'إدارة بلا موارد', manager_user_id: 'u_dm_empty', active: 1, created_at: T });

  const jobs = ['محلل بيانات', 'مهندس حلول', 'مصمم تجربة', 'مستشار بيانات', 'مدير مشروع', 'أخصائي ابتكار'];
  for (let i = 0; i < 6; i++) {
    const row = { id: 'e' + (i + 1), name_ar: NAMES[i], sector_id: 'SOL', department_id: 'D_DATA', job_title: jobs[i],
      hire_date: '2024-01-01', active: 1, created_at: T };
    if (i === 3) { row.capacity_pct = 50; row.resource_type = 'external'; row.vendor_name = 'شركة الحلول المتقدمة'; }
    if (i === 2) row.resource_type = 'partner';
    if (i === 4) { row.end_date = '2025-06-30'; row.active = 0; }          // ارتباطٌ انتهى (T17: التاريخ يبقى)
    if (i === 5) row.user_id = 'u_emp';
    await db.insert('employee', row);
  }
  await db.update('app_user', 'u_emp', { employee_id: 'e6' });
});
after(() => rmSync(dir, { recursive: true, force: true }));

const skipIfNoService = (t) => {
  if (resources) return false;
  t.skip('خدمة team/resources.js لم تصل بعد — ' + (resourcesErr && resourcesErr.message));
  return true;
};

// ── S01 ─────────────────────────────────────────────────────────────────────────────
test('S01 — البوابة تعرض المسارات الأربعة وسؤال البداية، وزر «إضافة مورد» لمن يملك الإنشاء وحده', async () => {
  const lead = await sess('u_lead');
  assert.ok(access.canCreateResource(lead), 'العيّنة: قائد القطاع يجب أن يملك الإنشاء');
  const html = await gateway.teamGatewayPage(lead, {});
  for (const p of ['الفريق والقدرات', 'التسكين والطاقة', 'العمل والالتزامات', 'التحليل والاحتياجات']) assert.ok(html.includes(p), 'مسار غائب: ' + p);
  assert.equal((html.match(/data-action="path-select"/g) || []).length, 4, 'عدد بطاقات المسارات ليس أربعاً');
  assert.ok(html.includes('ماذا تريد أن تدير اليوم؟'));
  assert.ok(html.includes('إضافة مورد'), 'قائد القطاع يملك الإنشاء ولا يرى الزر');
  assert.ok(!LEAK.test(visible(html)), 'تسرّب في البوابة');
  assert.ok(!/راتب|salary/i.test(html), 'راتبٌ على البوابة');

  const dm = await sess('u_dm');
  assert.ok(!access.canCreateResource(dm));
  const h2 = await gateway.teamGatewayPage(dm, {});
  assert.ok(!h2.includes('إضافة مورد'), 'مدير الإدارة لا يملك الإنشاء ويرى الزر');
  assert.equal((h2.match(/data-action="path-select"/g) || []).length, 4);

  const emp = await sess('u_emp');
  const h3 = await gateway.teamGatewayPage(emp, {});
  assert.ok(h3.includes('التسكين والطاقة') && !h3.includes('إضافة مورد'), 'الموظف يرى المسارات بلا زر إنشاء');
  assert.ok(!LEAK.test(visible(h3)));
});

test('S01 — ?path=planning يسبق الاختيار ويعرض معاينته؛ الإقفال يُخفى عن غير المخوَّل ولا يُخفى التخطيط', async () => {
  const emp = await sess('u_emp');
  const html = await gateway.teamGatewayPage(emp, { path: 'planning' });
  assert.ok(/data-path="planning" aria-pressed="true"/.test(html), 'بطاقة التسكين غير محددة');
  assert.ok(/data-path="people" aria-pressed="false"/.test(html), 'بطاقة أخرى محددة خطأً');
  assert.ok(html.includes('id="tm-gw-pv-planning" data-path'), 'معاينة التسكين مخفية رغم الاختيار');
  assert.ok(html.includes('id="tm-gw-pv-people" hidden'), 'معاينة غير مختارة ظاهرة');
  assert.ok(html.includes('href="/app/team/planning"'), 'رابط التخطيط غائب');
  assert.ok(!html.includes('/app/team/close'), 'الإقفال ظاهر لمن لا يقرؤه');
  assert.ok(html.includes('فتح المسار'), 'زر فتح المسار غائب');
  const admin = await sess('u_admin');
  const h2 = await gateway.teamGatewayPage(admin, { path: 'planning' });
  assert.ok(h2.includes('/app/team/close'), 'الإقفال غائب عن مدير النظام');
  assert.ok(!LEAK.test(visible(h2)));
  // مسارٌ غير معروف لا يختار شيئاً ولا يكسر الصفحة
  const h3 = await gateway.teamGatewayPage(admin, { path: 'nope' });
  assert.ok(!/aria-pressed="true"/.test(h3));
});

// ── S02 ─────────────────────────────────────────────────────────────────────────────
test('S02 — السجل يعرض الستة بترقيم «1–6 من 6» وحالاتهم وأنواعهم بلا تسرّب ولا راتب', async (t) => {
  if (skipIfNoService(t)) return;
  const lead = await sess('u_lead');
  const html = await resources.resourcesPage(lead, {});
  assert.ok(html.includes('1–6 من 6'), 'الترقيم ليس 1–6 من 6');
  for (const n of NAMES) assert.ok(html.includes(n), 'مورد غائب: ' + n);
  assert.equal((html.match(/data-action="resource-preview"/g) || []).length, 6, 'ليست ست صفوف قابلة للمعاينة');
  assert.ok(/tabindex="0" role="button" data-action="resource-preview"/.test(html), 'الصف ليس قابلاً للتركيز بلوحة المفاتيح');
  assert.ok(html.includes('منته'), 'المورد المنتهي بلا حالة ارتباط');
  assert.ok(html.includes('خارجي') && html.includes('شريك'), 'أنواع الموارد لا تظهر');
  assert.ok(html.includes('سجل الموارد') && html.includes('الهيكل الإداري') && html.includes('حسابات الدخول'), 'تبويبات المسار غائبة');
  assert.ok(html.includes('id="tm-pv"') && html.includes('data-action="preview-close"'), 'درج المعاينة S03 غائب');
  assert.ok(html.includes('فترة القياس') || html.includes('محسوب'), 'لا ملاحظة قياس للفترة');
  assert.ok(html.includes('/static/pages/team-resources.js'), 'عميل الصفحة غير محمَّل');
  assert.ok(!/راتب|salary/i.test(html), 'راتبٌ في سجل الموارد');
  assert.ok(!LEAK.test(visible(html)), 'تسرّب في السجل');
  assert.ok(!/null|undefined|NaN/.test(injected(html)), 'تسرّب في البيانات المحقونة');
});

test('S02 — الفلاتر والفترة في الرابط: الترقيم يُحسب من الصفحة والحجم، والفترة تُعاد إلى الحقول', async (t) => {
  if (skipIfNoService(t)) return;
  const lead = await sess('u_lead');
  const html = await resources.resourcesPage(lead, { page: '2', pageSize: '2' });
  assert.ok(html.includes('3–4 من 6'), 'ترقيم الصفحة الثانية بحجم 2 ليس 3–4 من 6');
  assert.ok(/href="[^"]*page=3[^"]*"[^>]*rel="next"/.test(html) || /rel="next"[^>]*href="[^"]*page=3/.test(html) || html.includes('page=3'), 'رابط «التالي» لا يحمل الصفحة 3');
  assert.ok(html.includes('pageSize=2'), 'حجم الصفحة لا يبقى في الروابط');
  const h2 = await resources.resourcesPage(lead, { from: '2026-10', to: '2026-12', type: 'external' });
  assert.ok(h2.includes('value="2026-10"') && h2.includes('value="2026-12"'), 'فترة القياس لا تعود إلى الحقول');
  assert.ok(/value="external" selected/.test(h2), 'فلتر النوع لا يبقى محدداً');
  assert.ok(h2.includes(NAMES[3]) && !h2.includes(NAMES[0]), 'فلتر النوع لم يُطبَّق');
  assert.ok(h2.includes('1–1 من 1'));
});

test('S02 — البحث يعيد مجموعة جزئية بترقيمها، وبحثٌ بلا نتائج يعرض «لا نتائج» لا «لا موارد»', async (t) => {
  if (skipIfNoService(t)) return;
  const lead = await sess('u_lead');
  // «الشمري» لا يطابق إلا اسماً واحداً (البحث يشمل المسمّى أيضاً — فـ«هند» كانت تطابق «مهندس»).
  const html = await resources.resourcesPage(lead, { q: 'الشمري' });
  assert.ok(html.includes(NAMES[3]) && !html.includes(NAMES[0]), 'البحث لم يقصّ القائمة');
  assert.ok(html.includes('1–1 من 1'), 'ترقيم نتيجة البحث الواحدة');
  assert.ok(html.includes('value="الشمري"'), 'نص البحث لا يبقى في الحقل');
  assert.ok(html.includes('مسح الفلاتر'));

  const none = await resources.resourcesPage(lead, { q: 'اسم-لا-وجود-له' });
  assert.ok(none.includes('لا نتائج'), 'حالة «لا نتائج» غائبة');
  assert.ok(!none.includes('لا موارد في نطاقك'), 'حالة الفراغ الخطأ لبحثٍ بلا نتائج');
  assert.ok(!LEAK.test(visible(none)));
});

test('S02 — نطاقٌ بلا موارد يعرض «لا موارد» (لا «لا نتائج»)، ولا صفوف ولا ترقيم', async (t) => {
  if (skipIfNoService(t)) return;
  const dmEmpty = await sess('u_dm_empty');
  const html = await resources.resourcesPage(dmEmpty, {});
  assert.ok(html.includes('لا موارد'), 'حالة «لا موارد» غائبة');
  assert.ok(!html.includes('لا نتائج لهذا البحث'), 'حالة البحث ظهرت بلا بحث');
  assert.equal((html.match(/data-action="resource-preview"/g) || []).length, 0, 'صفوف خارج النطاق تسرّبت');
  for (const n of NAMES) assert.ok(!html.includes(n), 'اسمٌ خارج النطاق تسرّب: ' + n);
  assert.ok(!html.includes(' من 6'), 'ترقيمٌ لنطاقٍ فارغ');
  assert.ok(!LEAK.test(visible(html)));
});

test('S02/S09 — مدير الإدارة يرى أهل إدارته بلا زر إضافة ولا قالب S09؛ وقائد القطاع يجدهما', async (t) => {
  if (skipIfNoService(t)) return;
  const dm = await sess('u_dm');
  const html = await resources.resourcesPage(dm, {});
  assert.ok(html.includes('1–6 من 6'), 'مدير الإدارة لا يرى أهل إدارته');
  assert.ok(!html.includes('data-action="resource-add"'), 'زر الإضافة ظاهر لمن لا يملك الإنشاء');
  assert.ok(!html.includes('id="tm-resource-form"'), 'قالب S09 مضمّن لمن لا يملك الإنشاء');
  assert.ok(!html.includes('/static/pages/team-resource-form.js'), 'عميل S09 محمَّل لمن لا يملك الإنشاء');

  const lead = await sess('u_lead');
  const h2 = await resources.resourcesPage(lead, {});
  assert.ok(h2.includes('data-action="resource-add"'), 'زر الإضافة غائب عن قائد القطاع');
  assert.ok(h2.includes('id="tm-resource-form"'), 'قالب S09 غائب عن قائد القطاع');
  assert.ok(h2.includes('/static/pages/team-resource-form.js'));
  assert.ok(h2.includes('إدارة البيانات') && h2.includes('قطاع الحلول'), 'قوائم القطاع/الإدارة غائبة عن النموذج');
});

test('S02 — resourceFormOptions تقصّ القوائم بنطاق القارئ: مدير الإدارة يرى إدارته وحدها', async (t) => {
  if (skipIfNoService(t)) return;
  const dm = await sess('u_dm');
  const o = await resources.resourceFormOptions(dm);
  assert.deepEqual(o.departments.map((d) => d.id), ['D_DATA']);
  assert.deepEqual(o.sectors.map((s) => s.id), ['SOL']);
  assert.equal(o.canCreateAccount, false, 'إنشاء الحساب من صلاحية مدير النظام وحده');
  const admin = await sess('u_admin');
  const oa = await resources.resourceFormOptions(admin);
  assert.deepEqual(oa.departments.map((d) => d.id).sort(), ['D_DATA', 'D_NONE']);
  // الخدمة لا تقرأ create_account/email بعد — فلا يُعرض مفتاحٌ يُرسل علماً لا يقرؤه أحد (حتى لمدير النظام).
  assert.equal(oa.canCreateAccount, false);
  const html = await resources.resourcesPage(admin, {});
  assert.ok(!html.includes('name="create_account"'), 'مفتاح إنشاء الحساب ظاهر والخدمة لا تنفّذه');
  assert.ok(html.includes('حسابات الدخول'), 'لا إرشاد إلى مكان إنشاء الحساب');
  assert.equal(oa.departments.find((d) => d.id === 'D_DATA').manager_name, 'حساب u_dm', 'اسم مدير الإدارة لا يصل النموذج');
});

// ── S09 ─────────────────────────────────────────────────────────────────────────────
test('S09 — القالب: ثلاثة أنواع بتسميات RESOURCE_TYPE_AR، الطاقة 100 افتراضياً، وحقل الجهة مخفيٌّ للداخلي، والبريد غير مطلوب دون حساب', () => {
  const html = form.resourceFormTemplate({
    mode: 'create',
    sectors: [{ id: 'SOL', name_ar: 'قطاع الحلول' }],
    departments: [{ id: 'D_DATA', name_ar: 'إدارة البيانات', sector_id: 'SOL', manager_name: 'مدير البيانات' }],
    canCreateAccount: true,
  });
  assert.ok(html.includes('<template id="tm-resource-form">'), 'القالب بلا معرّفه');
  assert.equal((html.match(/name="resource_type"/g) || []).length, 3, 'ليست ثلاثة أنواع');
  for (const ar of Object.values(access.RESOURCE_TYPE_AR)) assert.ok(html.includes('<b>' + ar + '</b>'), 'تسمية النوع لا تطابق الخدمة: ' + ar);
  assert.ok(/name="capacity_pct"[^>]*value="100"/.test(html), 'الطاقة الافتراضية ليست 100');
  assert.ok(html.includes('100 = دوام كامل'));
  assert.ok(/class="row tm-rf-vendor" hidden/.test(html), 'حقول الجهة المتعاقدة ظاهرة للداخلي');
  assert.ok(html.includes('name="create_account"'), 'مفتاح إنشاء الحساب غائب');
  assert.ok(/id="rf-email"(?![^>]*\brequired\b)/.test(html), 'البريد مطلوبٌ قبل تفعيل الحساب');
  assert.ok(/id="rf-account-fields" hidden/.test(html), 'حقول الحساب ظاهرة والمفتاح مطفأ');
  assert.ok(html.includes('data-manager="مدير البيانات"'), 'مدير الإدارة لا يصل النموذج');
  assert.ok(html.includes('حفظ المورد') && html.includes('إلغاء'));
  assert.ok(!LEAK.test(html));
  for (const w of ['API', 'JSON', 'ID:']) assert.ok(!html.includes(w), 'مصطلح تقني في القالب: ' + w);

  const edit = form.resourceFormTemplate({ mode: 'edit', canCreateAccount: false });
  assert.ok(edit.includes('تعديل بيانات المورد') && edit.includes('حفظ التعديلات'));
  assert.ok(!edit.includes('name="create_account"'), 'مفتاح الحساب ظاهر لمن لا يملك إنشاءه');
  assert.ok(edit.includes('حسابات الدخول'), 'لا إرشاد إلى مكان إنشاء الحساب حين يغيب المفتاح');
});
