// «لما أدخل تفاصيل الفرصة يجيني الإنجاز ١٠٠، لما أضغط التفاصيل يجيني ٥٨ — هذا غير مقبول
// أبداً… وفي مسميات غير مقبولة في الموظفين، هذه بس لك أنت في الباك إند عشان تجرّب… لازم
// تتأكد أن الباك إند مربوط بالكامل مع الفرونت إند، والفرونت إند ما فيه معلومات ساكنة»
// — بلسان المالك.
//
// عطلان من أصلٍ واحد: **الحساب مُكرَّر بدل أن يكون مُوحَّداً**.
//   ١) النافذة الجانبية تقرأ العمود المخزَّن `progress_pct` — الرقم المستورد الذي لا يتحرّك —
//      بينما الشاشة تقرأ المحسوب. فرقمان لمشروعٍ واحد في الدقيقة نفسها. والعلاج في المسار
//      (`getProject`) لا في النافذة: كل من ينادي الخدمة يأخذ الرقم محسوباً.
//   ٢) قائمة الأشخاص كانت مكتوبةً **أربع مرات** بأربع صياغات، ولا واحدة منها تستبعد حسابات
//      العرض — فظهر «العمليات (تجريبي)» و«معتمِد (تجريبي)» حيث يُختار من يُسكَّن على مشروع.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-truth-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, projects, people, P;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };
// قارئٌ عادي: القاعدة تخصّ من يعمل على بياناتٍ حقيقية، ومدير النظام مستثنى لأنه يديرها.
const LEAD = { id: 'u_lead', username: 'lead', name_ar: 'قائد القطاع', role_id: 'sector_lead', scope: 'sector', sector_id: 'SOL' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  projects = await import('../../src/modules/pmo/projects.js');
  people = await import('../../src/modules/org/people.js');
  P = await import('../../src/web/pages.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة الاقتصاد والتخطيط', created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_lead', username: 'lead', name_ar: 'قائد القطاع', role_id: 'sector_lead', scope: 'sector', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_real', username: 'saja.lashkar', name_ar: 'سجى لشكر', role_id: 'consultant', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  // حسابا عرضٍ بنفس بادئة الدخول التي يستعملها المسح فعلاً.
  await db.insert('app_user', { id: 'u_d1', username: 'demo.ops', name_ar: 'العمليات (تجريبي)', role_id: 'operations', scope: 'company', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_d2', username: 'demo.approver', name_ar: 'معتمِد (تجريبي)', role_id: 'approver', scope: 'company', sector_id: 'SOL', active: 1, created_at: T });

  // مشروعٌ عمودُه المخزَّن يقول ٥٨٪ ومخرجاتُه كلها معتمَدة — نفس حالة «منصة البيانات السعودية».
  await db.insert('project', { id: 'P1', name_ar: 'منصة البيانات السعودية', sector_id: 'SOL', client_id: 'CL',
    owner_user_id: 'u_admin', status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 58, created_at: T });
  for (const n of [1, 2, 3]) {
    await db.insert('deliverable', { id: 'DV' + n, project_id: 'P1', name_ar: 'مخرَج ' + n, month: n, year: 2026,
      status: 'ACCEPTED', amount_halalas: 100000, created_at: T });
  }
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── ١ · رقمٌ واحد من المسار نفسه ─────────────────────────────────────────────
test('المسار الذي تقرأ منه النافذة يعيد الإنجاز محسوباً لا العمود المستورد', async () => {
  const p = await projects.getProject(ADMIN, 'P1');
  assert.equal(p.progress_pct, 58, 'العمود المخزَّن تغيّر — الفحص يقيس شيئاً آخر');
  assert.equal(p.progress_effective_pct, 100,
    'المسار يعيد الرقم الجامد، فتقرأ النافذة ٥٨٪ والشاشة ١٠٠٪ للمشروع نفسه');
});

test('وصفحة المشروع والنافذة على رقمٍ واحد — لا اختلاف بين شاشتين', async () => {
  const p = await projects.getProject(ADMIN, 'P1');
  const html = await P.projectDetailPage(ADMIN, 'P1', {});
  const shown = [...html.matchAll(/(\d{1,3})%/g)].map((m) => Number(m[1]));
  assert.ok(shown.includes(p.progress_effective_pct),
    `الشاشة لا تعرض الرقم الذي يعيده المسار (${p.progress_effective_pct}٪)`);
  assert.ok(!shown.includes(58) || p.progress_effective_pct === 58,
    'الشاشة ما زالت تطبع الرقم المستورد ٥٨٪');
});

// ── ٢ · حسابات العرض لا تظهر حيث يُختار إنسان ───────────────────────────────
test('قائمة الأشخاص تستبعد حسابات العرض وتُبقي الحقيقيين', async () => {
  const list = await people.pickablePeople({ viewer: LEAD });
  const names = list.map((x) => x.name);
  assert.ok(names.includes('سجى لشكر'), 'أُسقط موظفٌ حقيقي');
  assert.ok(names.includes('مدير النظام'), 'أُسقط حسابٌ حقيقي غير تجريبي');
  for (const demo of ['العمليات (تجريبي)', 'معتمِد (تجريبي)']) {
    assert.ok(!names.includes(demo), `حساب العرض «${demo}» ما زال يظهر حيث يُختار إنسان`);
  }
});

test('والقصر على قطاعٍ بعينه يستبعدها كذلك — لا بابٌ ثانٍ', async () => {
  const list = await people.pickablePeople({ sectorId: 'SOL', viewer: LEAD });
  assert.ok(!list.some((x) => /تجريبي/.test(x.name)), 'الفرع القطاعي يمرّر حسابات العرض');
  assert.ok(list.some((x) => x.name === 'سجى لشكر'));
});

test('ولا تظهر على صفحة المشروع لقارئٍ عادي — ويراها مدير النظام وحده', async () => {
  const forLead = await P.projectDetailPage(LEAD, 'P1', {});
  assert.ok(!forLead.includes('(تجريبي)'), 'حساب عرضٍ في قائمة صفحة المشروع لقارئٍ عادي');
  // والاستثناء مقصود ومُثبَت: من يملك حذفها يجب أن يراها، وإلا ظنّها اختفت وهي باقية.
  const forAdmin = await people.pickablePeople({ viewer: ADMIN });
  assert.ok(forAdmin.some((x) => /تجريبي/.test(x.name)), 'مدير النظام لا يرى ما يملك حذفه');
});

// حارسٌ بنيوي: لا استعلامَ ثانياً لقائمة الأشخاص خارج المصدر الواحد.
test('ولا نسخة ثانية من استعلام قائمة الأشخاص في أي شاشة', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const walk = (d, out = []) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (n.endsWith('.js')) out.push(p);
    }
    return out;
  };
  const offenders = [];
  for (const file of walk(join(ROOT, 'src/web/views'))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/COALESCE\(\s*name_ar\s*,\s*username\s*\)/.test(line) && /FROM app_user/.test(line)) {
        offenders.push(`${file.replace(ROOT, '')}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    'استعلامٌ ثانٍ لقائمة الأشخاص — أولُ ترشيحٍ يُضاف إلى المصدر ويُنسى هنا يُعيد حسابات العرض '
    + 'إلى الشاشة من بابٍ واحد:\n' + offenders.join('\n'));
});

// ── وموظفو العرض كذلك، حيث **يُختار** إنسان ─────────────────────────────────
// «ريم الدوسري (تجريبي)» موظفةٌ في الكشف لا حساب. والعلامة نفسها تبلغها: كل موظف عرضٍ
// **مربوطٌ بحساب عرض** تُنشئه البذرة — فلا نعود إلى مطابقة الاسم التي رفضتها الترحيلة ٠١٥.
//
// والحدّ مقصود: الاستبعاد في **قائمة الاختيار** لا في كشف الفريق. فكشف التسكين تقريرٌ عمّن
// يوجد وكم يحمل، وتُبنى منه نِسَب الإشغال — وإخفاء صفٍّ موجود منه يجعل التقرير يكذب على
// الطاقة. أما «من أُسكِّن على هذا المشروع» فاختيارٌ، وعرضُ شخصٍ وهمي فيه هو الضرر بعينه.
test('موظفو العرض خارج قائمة «من المتاح للتسكين» — والحقيقيون فيها', async () => {
  const capacity = await import('../../src/modules/pmo/capacity.js');
  await db.insert('employee', { id: 'e_real', name_ar: 'إبراهيم صابر', job_title: 'استشاري',
    sector_id: 'SOL', user_id: 'u_real', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_demo', name_ar: 'ريم الدوسري (تجريبي)', job_title: 'مديرة إدارة',
    sector_id: 'SOL', user_id: 'u_d1', active: 1, created_at: T });
  const r = await capacity.staffingCandidates(LEAD, 'P1', {});
  const names = (r.candidates || []).map((x) => x.name_ar);
  assert.ok(names.includes('إبراهيم صابر'), 'أُسقط موظفٌ حقيقي من قائمة التسكين');
  assert.ok(!names.includes('ريم الدوسري (تجريبي)'),
    'موظف عرضٍ معروضٌ للتسكين على مشروعٍ حقيقي');
});

test('والربط يُقرأ من الجهتين — فلا بابٌ ثانٍ يمرّ منه', async () => {
  const capacity = await import('../../src/modules/pmo/capacity.js');
  // موظفٌ مربوطٌ بالجهة المعاكسة (`app_user.employee_id`) لا بـ`employee.user_id`.
  await db.insert('employee', { id: 'e_demo2', name_ar: 'حساب عرضٍ آخر (تجريبي)',
    sector_id: 'SOL', active: 1, created_at: T });
  await db.update('app_user', 'u_d2', { employee_id: 'e_demo2' });
  const r = await capacity.staffingCandidates(LEAD, 'P1', {});
  assert.ok(!(r.candidates || []).some((x) => x.id === 'e_demo2'),
    'الربط المعاكس يمرّر موظف عرضٍ إلى قائمة التسكين');
});
