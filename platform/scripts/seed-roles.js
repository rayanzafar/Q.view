// إنشاء حسابات العرض السبعة الناقصة — ولا شيء غير ذلك.
//
// المشكلة: سبعة أدوار (مدير إدارة، مدير مباشر، رئيس تطوير الأعمال، العمليات، المشتريات،
// المعتمِد، المستخدم الخارجي) أُضيفت إلى `scripts/seed.js` **بعد** أن امتلأ قرص البيئة الحيّة
// ببيانات الأعمال، و`scripts/seed-staging.js:24` يتوقف عند `hasData()` — فلم تُنشأ صفوفها قط.
// نتيجتها الحيّة: دخولها يفشل (302 ⟵ /login?e=1)، والمسح الحيّ يغطي ١٠ أدوار من ١٧.
//
// ⚠ لماذا سكربت مستقل بدل `npm run seed`؟ لأن `seed.js` **بلا أي حارس بيئة**، وسطوره 203-237
// تُنفِّذ تعديلات غير مشروطة على **صفوف أعمال حقيقية**: تكتب `sector.lead_user_id` لقطاع
// الحلول فوق قائده الحقيقي، وتكتب `owner_user_id` على مشروع حقيقي يُختار اعتباطاً، وتُعيد
// إسناد `owner_user_id` على ما يصل إلى ٣٧ فرصة حقيقية إلى شخصيات العرض، وتكتب `next_action`
// على ما يصل إلى ١٦ منها. تشغيله على بيئة فيها بيانات عميل = إتلاف بيانات عميل.
// هذا السكربت لا يمرّ على تلك السطور إطلاقاً؛ وهناك اختبار يُثبت ذلك:
// tests/integration/seed-roles-safety.test.js — يُشغّله على قاعدة فيها قائد قطاع ومالك مشروع
// وفرص مملوكة، ويتحقق أن تلك الصفوف لم يتغيّر منها حرف.
//
// ما الذي يلمسه: `app_user` (الحسابات السبعة فقط) ثم `department` و`employee` عبر
// `seedDemoOrg()` المُصدَّرة من seed.js — وسطور تدقيق في `audit_log` لأن كل كتابة تُدقَّق.
// ولماذا خطوة الهيكل أصلاً: `app_user` لا يحمل عمود إدارة، و`src/core/http/context.js:39-48`
// يستنتج الإدارة من سجل الموظف المرتبط — فبلا ربط، حسابا «مدير إدارة» و«مدير مباشر» بلا إدارة،
// وكل فحص صلاحية يعتمد على الإدارة غير قابل للاختبار أصلاً.
//
// الاستعمال:
//   node --experimental-sqlite scripts/seed-roles.js            ← عرض الخطة فقط (بلا كتابة)
//   node --experimental-sqlite scripts/seed-roles.js --apply    ← التنفيذ
//   إضافة --accounts-only تقتصر على الحسابات وتترك الهيكل (الإدارات والموظفين) كما هو.
import { all, get, run, tx, close } from '../src/core/db/index.js';
import { hashPassword } from '../src/core/auth/password.js';
import { id, nowIso } from '../src/core/util/ids.js';
import { audit } from '../src/core/audit/index.js';
import { config } from '../src/core/config.js';
import { normName } from '../src/modules/org/org.js';
import { DEMO_USERS, DEMO_PW, DEMO_ORG_SECTOR, DEMO_DEPARTMENTS, seedDemoOrg } from './seed.js';

// الأدوار السبعة التي لا حساب لها على البيئة الحيّة — مكتوبة صراحةً لا مشتقّة، كي لا يتسلّل
// حساب ثامن إلى نطاق هذا السكربت بتعديلٍ في مكان آخر.
export const MISSING_ROLE_ACCOUNTS = [
  'demo.deptmgr', 'demo.linemgr', 'demo.bdhead', 'demo.ops',
  'demo.procurement', 'demo.approver', 'demo.external',
];

// نفس اشتقاق البريد الموجود في seed.js:200 — حرفياً، كي لا يفترق حسابٌ أنشأه هذا السكربت عن
// حسابٍ أنشأه ذاك في عمودٍ واحد.
const emailOf = (d) => d.email || d.u + '@evc.com.sa';
const label = (u) => `${u.username || '—'}${u.name_ar ? ` (${u.name_ar})` : ''}`;

// أي محرّك نكتب عليه — بلا أي جزء من نص الاتصال (يحمل كلمة مرور).
const dbLabel = () => (config.databaseUrl ? 'PostgreSQL (من متغيّر البيئة)' : `SQLite — ${config.dbFile}`);

class Blocked extends Error {}
const blocked = (msg) => new Blocked(msg);

// ── الفحص القَبْلي: يمنع الانهيار في منتصف التشغيل ─────────────────────────────
// `app_user.email` فريد (migrations/001_init.sql:26) والترقية أدناه لا تحمل ذراع
// `ON CONFLICT (email)` — فلو حمل مستخدم حقيقي أحد هذه العناوين لانفجرت الجملة بعد أن يكون
// جزء من الحسابات قد كُتب. نمسك ذلك قبل أول كتابة ونسمّي التعارض بالاسم.
async function preflight(targets) {
  const problems = [];
  const warnings = [];

  // ١) الأدوار موجودة في جدول الأدوار (`app_user.role_id` مفتاح خارجي على `role`).
  const roles = new Set((await all('SELECT id FROM role')).map((r) => r.id));
  const missingRoles = [...new Set(targets.map((d) => d.role))].filter((r) => !roles.has(r));
  if (missingRoles.length)
    problems.push(`الأدوار التالية غير معرَّفة في النظام: ${missingRoles.join('، ')} — شغّل scripts/seed-rbac.js أولاً.`);

  // ٢) حساب محذوف حذفاً ناعماً بنفس اسم الدخول: الترقية ستكتب فوقه ولن تُحييه، فيبقى الدخول
  //    فاشلاً وتبدو النتيجة نجاحاً. قرار إحياء حساب مُعطَّل قرار بشري لا قرار سكربت.
  const usernames = targets.map((d) => d.u);
  const existing = await all(
    `SELECT id, username, email, name_ar, role_id, sector_id, scope, active, deleted_at
       FROM app_user WHERE username IN (${usernames.map(() => '?').join(',')})`, usernames);
  const deleted = existing.filter((r) => r.deleted_at);
  if (deleted.length)
    problems.push(`حسابات بنفس أسماء الدخول موجودة لكنها محذوفة: ${deleted.map((r) => r.username).join('، ')}`
      + ' — إحياؤها قرار يخصّ مسؤول النظام، فلن يتخذه هذا السكربت.');

  // ٣) تعارض البريد: صفٌّ آخر (باسم دخول مختلف) يحمل أحد العناوين السبعة.
  //    لا نستثني المحذوف حذفاً ناعماً: قيد التفرّد يسري عليه أيضاً.
  const emails = targets.map(emailOf);
  const holders = await all(
    `SELECT id, username, email, name_ar, deleted_at FROM app_user
       WHERE LOWER(email) IN (${emails.map(() => '?').join(',')})`, emails.map((e) => e.toLowerCase()));
  for (const t of targets) {
    const want = emailOf(t);
    for (const h of holders) {
      if ((h.username || null) === t.u) continue;           // الحساب نفسه — لا تعارض
      if (h.email === want)
        problems.push(`البريد «${want}» الخاص بحساب ${t.u} يحمله حساب آخر: ${label(h)}`
          + `${h.deleted_at ? ' (محذوف — والقيد يسري عليه)' : ''} — غيّر بريد أحدهما ثم أعد التشغيل.`);
      else if (String(h.email || '').toLowerCase() === want.toLowerCase())
        warnings.push(`تنبيه: «${h.email}» (حساب ${label(h)}) يطابق بريد ${t.u} باختلاف حالة الأحرف فقط`
          + ' — لن يمنع الكتابة، لكنه غالباً شخص واحد بحسابين.');
    }
  }

  // ٤) شروط خطوة الهيكل — غيابها لا يمنع الحسابات، لكنه يترك «مدير الإدارة» بلا إدارة.
  const sector = await get('SELECT id, name_ar FROM sector WHERE id = ? AND deleted_at IS NULL', [DEMO_ORG_SECTOR]);
  const admin = await get('SELECT id FROM app_user WHERE username = ? AND deleted_at IS NULL', ['demo.admin']);
  if (!sector) warnings.push(`القطاع «${DEMO_ORG_SECTOR}» غير موجود — خطوة الإدارات والموظفين ستُتخطّى بصمت،`
    + ' وسيبقى «مدير إدارة» و«مدير مباشر» بلا إدارة.');
  if (!admin) warnings.push('حساب demo.admin غير موجود — خطوة الإدارات والموظفين ستُتخطّى بصمت'
    + ' (خدمات الهيكل تحتاج منفِّذاً بصلاحية إدارة).');

  if (problems.length) throw blocked('توقّف قبل أي كتابة:\n   • ' + problems.join('\n   • '));
  return { existing, warnings, orgReady: !!(sector && admin) };
}

// ── خطة الحسابات: ماذا سيتغيّر بالضبط، عموداً عموداً ─────────────────────────
function planAccounts(targets, existing) {
  const byName = new Map(existing.map((r) => [r.username, r]));
  return targets.map((d) => {
    const cur = byName.get(d.u) || null;
    if (!cur) return { u: d.u, role: d.role, state: 'جديد', changes: [] };
    const changes = [];
    const cmp = (col, was, will) => { if ((was ?? null) !== (will ?? null)) changes.push(`${col}: «${was ?? '—'}» ⟵ «${will}»`); };
    cmp('الدور', cur.role_id, d.role);
    cmp('القطاع', cur.sector_id, d.sector);
    cmp('النطاق', cur.scope, d.scope);
    cmp('الاسم', cur.name_ar, d.name);
    cmp('البريد', cur.email, emailOf(d));
    if (Number(cur.active) !== 1) changes.push('الحالة: مُعطَّل ⟵ مُفعَّل');
    return { u: d.u, role: d.role, state: 'قائم', id: cur.id, changes };
  });
}

// ── خطة الهيكل: قراءة فقط، تُحاكي ما ستفعله seedDemoOrg() دون أن تكتب حرفاً ────
// السبب الحقيقي لوجودها: `seedDemoOrg` تبحث عن الموظف **بالاسم المطبَّع على مستوى الشركة كلها**،
// فلو صادف اسمُ موظف عرضٍ اسمَ موظف حقيقي لنُقل الحقيقي إلى إدارة العرض. الاحتمال ضئيل (كل
// أسماء العرض تنتهي بـ«(تجريبي)») لكن العواقب على بيانات عميل حقيقية لا تُترك للاحتمال:
// الخطة تعرض معرّف كل صف سيُلمس **قبل** أن يُلمس، ليراه من يضغط --apply.
async function planOrg(willExist = new Set()) {
  const deps = await all('SELECT id, name_ar FROM department WHERE sector_id = ? AND deleted_at IS NULL', [DEMO_ORG_SECTOR]);
  const people = await all('SELECT id, name_ar, department_id, user_id FROM employee WHERE deleted_at IS NULL');
  const out = [];
  for (const d of DEMO_DEPARTMENTS) {
    const dep = deps.find((r) => normName(r.name_ar) === normName(d.name_ar)) || null;
    const staff = [];
    for (const s of d.staff) {
      const emp = people.find((p) => normName(p.name_ar) === normName(s.name_ar)) || null;
      const acc = s.account
        ? await get('SELECT id, username, employee_id FROM app_user WHERE username = ? AND deleted_at IS NULL', [s.account])
        : null;
      let link = null;
      // الحساب الذي سيُنشأ في هذا التشغيل نفسه ليس «غير موجود»: خطوة الحسابات تسبق خطوة الهيكل.
      if (s.account && !acc && willExist.has(s.account)) link = `${s.account} سيُنشأ في هذه الجولة ثم يُربط بـ«${s.name_ar}»`;
      else if (s.account && !acc) link = `الحساب ${s.account} غير موجود — لا ربط`;
      else if (acc && emp && acc.employee_id === emp.id) link = `${s.account} مربوط مسبقاً — بلا تغيير`;
      else if (acc && acc.employee_id) {
        const other = await get('SELECT name_ar FROM employee WHERE id = ?', [acc.employee_id]);
        link = `${s.account} سيُفكّ ربطه عن «${other?.name_ar || acc.employee_id}» ثم يُربط بـ«${s.name_ar}»`;
      } else if (acc) link = `${s.account} سيُربط بـ«${s.name_ar}»`;
      const holder = emp && emp.user_id ? await get('SELECT username FROM app_user WHERE id = ?', [emp.user_id]) : null;
      staff.push({
        name: s.name_ar,
        state: !emp ? 'سيُنشأ سجل موظف'
          : emp.department_id === (dep ? dep.id : null) ? `قائم (${emp.id}) — بلا تغيير`
            : `قائم (${emp.id}) — سيُنقل إلى «${d.name_ar}»`,
        link,
        note: holder && acc && holder.username !== acc.username
          ? `سجل الموظف مربوط حالياً بحساب ${holder.username} — سيُفكّ` : null,
      });
    }
    out.push({ name: d.name_ar, state: dep ? `قائمة (${dep.id})` : 'ستُنشأ', staff });
  }
  return out;
}

/**
 * @param {{apply?: boolean, accountsOnly?: boolean, log?: (s: string) => void}} opts
 * apply=false (الافتراضي) ⟵ عرض الخطة فقط، بلا كتابة واحدة.
 */
export async function seedRoles(opts = {}) {
  const { apply = false, accountsOnly = false, log = console.log } = opts;
  const targets = MISSING_ROLE_ACCOUNTS.map((u) => {
    const d = DEMO_USERS.find((x) => x.u === u);
    if (!d) throw blocked(`«${u}» غير معرَّف في قائمة حسابات العرض بـ scripts/seed.js — لا تُخترع تعريفاته هنا.`);
    return d;
  });

  log(`▶ حسابات الأدوار الناقصة — ${apply ? 'تنفيذ' : 'عرض الخطة فقط (بلا كتابة)'}`);
  log(`   قاعدة البيانات: ${dbLabel()}`);

  const { existing, warnings, orgReady } = await preflight(targets);
  for (const w of warnings) log(`   ⚠ ${w}`);

  const accounts = planAccounts(targets, existing);
  log('\n── الحالة قبل ──');
  for (const a of accounts) {
    log(`   ${a.u.padEnd(18)} ${a.state === 'جديد' ? 'غير موجود' : 'موجود'}  ·  الدور: ${a.role}`);
    for (const c of a.changes) log(`      ↳ سيتغيّر ${c}`);
  }
  const toCreate = accounts.filter((a) => a.state === 'جديد');
  const toUpdate = accounts.filter((a) => a.state === 'قائم');
  log(`   الخلاصة: ${toCreate.length} سيُنشأ · ${toUpdate.length} قائم (تُعاد كتابة حقوله وكلمة مروره القياسية).`);

  const org = accountsOnly ? null : await planOrg(new Set(targets.map((d) => d.u)));
  if (org) {
    log('\n── الإدارات والموظفون ──');
    for (const d of org) {
      log(`   ${d.name} — ${d.state}`);
      for (const s of d.staff) {
        log(`      · ${s.name}: ${s.state}`);
        if (s.link) log(`        ↳ ${s.link}`);
        if (s.note) log(`        ↳ ${s.note}`);
      }
    }
    if (!orgReady) log('   (لن تُنفَّذ — انظر التنبيهات أعلاه)');
  } else {
    log('\n── الإدارات والموظفون: متخطّاة (--accounts-only) ──');
  }

  if (!apply) {
    log('\n✋ لم تُكتب أي بيانات. أضف --apply للتنفيذ.');
    return { applied: false, created: [], updated: [], accounts, org, warnings };
  }

  // ── التنفيذ ────────────────────────────────────────────────────────────────
  // نفس نمط الترقية في seed.js:193-201 حرفياً: يُبحث عن المعرّف باسم الدخول أولاً، ثم
  // `ON CONFLICT (id) DO UPDATE` — فلا يُمحى صفّ قائم ولا يُنشأ صفّ ثانٍ لنفس الشخص.
  // مغلَّفة بمعاملة واحدة: إمّا السبعة أو لا شيء. (بلا معاملة متداخلة — seedDemoOrg تفتح
  // معاملاتها بنفسها عبر خدمات الهيكل، وSQLite لا يقبل معاملة داخل معاملة.)
  const hash = hashPassword(DEMO_PW);
  const at = nowIso();
  const actor = await get('SELECT id, username FROM app_user WHERE username = ? AND deleted_at IS NULL', ['demo.admin']);
  const ctx = { user: { id: actor?.id || null, username: 'seed-roles', role_id: 'admin' }, ip: '127.0.0.1' };
  const created = [], updated = [];
  await tx(async () => {
    for (const d of targets) {
      const cur = existing.find((r) => r.username === d.u) || null;
      const uid = cur?.id || id('u');
      await run(
        `INSERT INTO app_user (id, username, email, name_ar, role_id, sector_id, scope, password_hash, active, must_change_pw, created_at)
         VALUES (?,?,?,?,?,?,?,?,1,0,?)
         ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, email=EXCLUDED.email, name_ar=EXCLUDED.name_ar, role_id=EXCLUDED.role_id, sector_id=EXCLUDED.sector_id, scope=EXCLUDED.scope, password_hash=EXCLUDED.password_hash, active=EXCLUDED.active, must_change_pw=EXCLUDED.must_change_pw`,
        [uid, d.u, emailOf(d), d.name, d.role, d.sector, d.scope, hash, at]);
      (cur ? updated : created).push(d.u);
      await audit(ctx, { action: cur ? 'update' : 'create', resource: 'app_user', resourceId: uid,
        sectorId: d.sector, detail: { username: d.u, role_id: d.role, scope: d.scope, via: 'seed-roles' } });
    }
  });
  log(`\n✓ الحسابات: ${created.length} أُنشئ${created.length ? ' (' + created.join('، ') + ')' : ''}`
    + ` · ${updated.length} حُدِّث${updated.length ? ' (' + updated.join('، ') + ')' : ''}`);

  let orgResult = null;
  if (!accountsOnly) {
    orgResult = await seedDemoOrg();
    log(orgResult.seeded
      ? `✓ الإدارات: ${orgResult.departments.map((d) => d.name_ar).join('، ')} — حسابات رُبطت الآن: ${orgResult.linked}`
      : '⚠ الإدارات: لم تُنفَّذ (القطاع أو حساب مدير النظام غير موجود) — «مدير إدارة» بلا إدارة.');
  }

  // ── الحالة بعد ──
  const after = await all(
    `SELECT u.username, u.role_id, u.sector_id, u.scope, u.active, u.employee_id, e.department_id, d.name_ar AS dep_name
       FROM app_user u
       LEFT JOIN employee e ON e.id = u.employee_id
       LEFT JOIN department d ON d.id = e.department_id
      WHERE u.username IN (${MISSING_ROLE_ACCOUNTS.map(() => '?').join(',')}) AND u.deleted_at IS NULL
      ORDER BY u.username`, MISSING_ROLE_ACCOUNTS);
  log('\n── الحالة بعد ──');
  for (const r of after)
    log(`   ${r.username.padEnd(18)} ${r.role_id.padEnd(20)} نطاق: ${String(r.scope).padEnd(10)}`
      + ` قطاع: ${r.sector_id || '—'}  إدارة: ${r.dep_name || '—'}`);
  const missing = MISSING_ROLE_ACCOUNTS.filter((u) => !after.some((r) => r.username === u));
  if (missing.length) log(`   ⚠ لم تظهر بعد التنفيذ: ${missing.join('، ')}`);
  log(`   كلمة المرور: القياسية لحسابات العرض (DEMO_PW في scripts/seed.js).`);

  return { applied: true, created, updated, accounts, org, orgResult, after, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const known = new Set(['--apply', '--accounts-only', '--help', '-h']);
  const bad = argv.filter((a) => !known.has(a));
  if (bad.length || argv.includes('--help') || argv.includes('-h')) {
    if (bad.length) console.error(`✗ خيار غير معروف: ${bad.join('، ')}`);
    console.log('الاستعمال: node --experimental-sqlite scripts/seed-roles.js [--apply] [--accounts-only]');
    console.log('  بلا خيارات ⟵ عرض الخطة فقط بلا أي كتابة. --apply ⟵ التنفيذ.');
    process.exit(bad.length ? 1 : 0);
  }
  seedRoles({ apply: argv.includes('--apply'), accountsOnly: argv.includes('--accounts-only') })
    .catch((e) => { console.error('✗ ' + (e instanceof Blocked ? e.message : e.stack || e.message)); process.exitCode = 1; })
    .finally(() => close());
}
