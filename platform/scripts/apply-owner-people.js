// ── تنفيذ قرارات المالك على الأشخاص: عمر حمزة وهادي كرمي ──────────────────────
//
// «عمر حمزة حطّه على قطاع تطوير الأعمال وسوّي له حساب omar.hamza@evc.sa»
// «هادي كرمي هو اللي معايا في إدارة الابتكار Hadi.Karmi@evc.sa، ومافي أحد في الشركة كلها اسمه
//  هادي غيره» — بلسان المالك.
//
// وهاتان جملتان تحسمان ما امتنع السكربتان السابقان عنه: عمر كان توزيعه متعارضاً بين ثلاثة
// مصادر، وهادي لم يكن له سجلُّ موظفٍ ولا حساب فلم تصله الصلاحية.
//
// ── ولا يُرسَل بريد ─────────────────────────────────────────────────────────
// الحساب يُنشأ ويُربط، **ولا تُرسَل دعوة**: قرار المالك القائم أن لا رسالة تخرج إلى أحد سواه.
// فالدعوة تُرسَل من شاشة «المستخدمون والصلاحيات» حين يقرّر هو، ورمز الدخول يصل حينها.
// وبلا كلمة مرور: الدخول في المنصة برمز البريد، فالحساب جاهزٌ للاستعمال بمجرد إرسال الدعوة.
//
// ── ولا يخمّن ──────────────────────────────────────────────────────────────
// الوحدة التنظيمية تُطابَق بالاسم بين الإدارات ثم القطاعات، وما لا يُحسَم يُترك ويُقال سببه.
// وإنشاءُ سجلِّ موظفٍ لا يقع إلا إذا **لم يوجد** من يطابق الاسم: التكرار في كشف الموظفين أسوأ
// من غيابه — رجلٌ واحد بسجلَّين يظهر مرتين في كل لوحة ويُقسَّم عمله بينهما.
import { all, get, run, insert, update } from '../src/core/db/index.js';
import { id, nowIso } from '../src/core/util/ids.js';
import { nameWords, norm } from './apply-utilization-may2026.js';

const FLAG = 'op:owner-people-2026-08';

export const PEOPLE = [
  {
    // «حطّه على قطاع تطوير الأعمال» — ووقتُه كله هناك، فلا تسكينَ مشروعٍ له. وهذا يحسم
    // التعارض الذي امتنع عنه سكربت الإشغال: المصادر الثلاثة اختلفت، وقرار المالك فوقها.
    full: 'عمر حمزة', email: 'omar.hamza@evc.sa', unit: 'تطوير الأعمال',
    role: 'employee', jobTitle: 'تطوير أعمال', create: false,
  },
  {
    // «هو اللي معايا في إدارة الابتكار… ومافي أحد في الشركة كلها اسمه هادي غيره».
    full: 'هادي كرمي', email: 'Hadi.Karmi@evc.sa', unit: 'إدارة الابتكار',
    role: 'consultant', jobTitle: 'استشاري ابتكار', create: true,
  },
];

// وحدةٌ تنظيمية: إدارةً أولاً ثم قطاعاً. والمطابقة بكلمةٍ مشتركة على الأقل مع اسمٍ مطبَّع،
// ومطابقةٌ واحدة فقط — فـ«تطوير الأعمال» لا يجوز أن يلتقط «تطوير الأعمال» و«إدارة تطوير
// الأعمال» معاً بلا حسم.
function matchUnit(rows, wanted) {
  const w = nameWords(wanted);
  const exact = rows.filter((r) => norm(r.name_ar) === norm(wanted));
  if (exact.length === 1) return exact;
  const hits = rows.filter((r) => {
    const n = nameWords(r.name_ar);
    return w.every((x) => n.includes(x)) || n.every((x) => w.includes(x));
  });
  return hits;
}

const usernameOf = (email) => String(email).split('@')[0].toLowerCase();

export async function applyOwnerPeople({ force = false } = {}) {
  const done = await get('SELECT applied_at FROM schema_migration WHERE version = ?', [FLAG]);
  if (done?.applied_at && !force) return { skipped: true, at: done.applied_at, done: [], notes: [] };

  const notes = [];
  const doneList = [];
  const now = nowIso();
  const departments = await all(
    'SELECT id, name_ar, sector_id FROM department WHERE deleted_at IS NULL AND active = 1');
  const sectors = await all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL AND active = 1');
  const staff = await all(
    'SELECT id, name_ar, user_id, sector_id, department_id FROM employee WHERE deleted_at IS NULL');

  for (const p of PEOPLE) {
    // ① الوحدة
    let deptId = null; let sectorId = null;
    const dHits = matchUnit(departments, p.unit);
    if (dHits.length === 1) { deptId = dHits[0].id; sectorId = dHits[0].sector_id || null; }
    else {
      const sHits = matchUnit(sectors, p.unit);
      if (sHits.length === 1) sectorId = sHits[0].id;
      else {
        notes.push(`«${p.full}»: الوحدة «${p.unit}» ${dHits.length + sHits.length ? 'تطابق أكثر من وحدة' : 'غير موجودة'} — لم يُغيَّر شيء`);
        continue;
      }
    }

    // ② سجلّ الموظف
    const w = nameWords(p.full);
    let hits = staff.filter((s) => {
      const n = nameWords(s.name_ar);
      if (n.length < 2 || w.length < 2) return false;
      const shared = n.filter((x) => w.includes(x)).length;
      return shared >= 2 && (w.every((x) => n.includes(x)) || n.every((x) => w.includes(x)));
    });
    // ومن ذُكر أنه وحيدٌ باسمه في الشركة يُطابَق باسمه الأول — قرار المالك يرفع اللبس لا يزيده.
    if (!hits.length && p.create) hits = staff.filter((s) => nameWords(s.name_ar)[0] === w[0]);
    if (hits.length > 1) {
      notes.push(`«${p.full}»: أكثر من موظف يطابقه (${hits.map((h) => h.name_ar).join('، ')}) — لم يُغيَّر شيء`);
      continue;
    }
    let emp = hits[0] || null;
    if (!emp) {
      if (!p.create) {
        notes.push(`«${p.full}»: لا سجل موظف بهذا الاسم — يُضاف من شاشة الفريق`);
        continue;
      }
      const eid = id('emp');
      await insert('employee', {
        id: eid, name_ar: p.full, sector_id: sectorId, department_id: deptId,
        job_title: p.jobTitle, active: 1, created_at: now,
      });
      emp = { id: eid, name_ar: p.full, user_id: null };
      doneList.push(`أُنشئ سجل موظف: ${p.full}`);
    } else if (emp.department_id !== deptId || emp.sector_id !== sectorId) {
      await update('employee', emp.id, { department_id: deptId, sector_id: sectorId, updated_at: now });
      doneList.push(`نُقل ${emp.name_ar} إلى «${p.unit}»`);
    }

    // ③ الحساب — بلا دعوةٍ ولا كلمة مرور (الدخول برمز البريد، والدعوة قرار المالك)
    const email = p.email.trim();
    let acc = await get(
      'SELECT id, name_ar, employee_id FROM app_user WHERE lower(trim(email)) = ? AND deleted_at IS NULL',
      [email.toLowerCase()]);
    if (!acc) {
      const clashUser = await get('SELECT id FROM app_user WHERE username = ?', [usernameOf(email)]);
      if (clashUser) {
        notes.push(`«${p.full}»: اسم الدخول «${usernameOf(email)}» مستعمَل — يُنشأ الحساب من شاشة المستخدمين`);
        continue;
      }
      const uid = id('usr');
      await insert('app_user', {
        id: uid, username: usernameOf(email), email, name_ar: p.full, role_id: p.role,
        sector_id: sectorId, scope: 'own', employee_id: emp.id, active: 1,
        must_change_pw: 0, created_at: now,
      });
      acc = { id: uid, name_ar: p.full, employee_id: emp.id };
      doneList.push(`أُنشئ حساب ${p.full} (${email}) — بلا دعوة`);
    }
    // الربط عمودان لا عمود، ويُكتبان معاً — وإلا قرأت شاشةٌ الربطَ وقرأت أخرى غيابه.
    if (acc.employee_id !== emp.id) await update('app_user', acc.id, { employee_id: emp.id, updated_at: now });
    if (emp.user_id !== acc.id) await update('employee', emp.id, { user_id: acc.id, updated_at: now });
  }

  await run(
    `INSERT INTO schema_migration (version, applied_at) VALUES (?,?)
     ON CONFLICT (version) DO UPDATE SET applied_at = excluded.applied_at`, [FLAG, now]);
  return { skipped: false, at: now, done: doneList, notes };
}

if (process.argv[1] && process.argv[1].endsWith('apply-owner-people.js')) {
  const r = await applyOwnerPeople({ force: process.argv.includes('--force') });
  if (r.skipped) console.log(`قرارات الأشخاص مطبَّقة مسبقاً في ${String(r.at).slice(0, 10)} — لا تغيير`);
  else console.log(`قرارات الأشخاص: ${r.done.length} تغييراً`);
  for (const d of r.done) console.log(`  ✓ ${d}`);
  for (const n of r.notes) console.log(`  · ${n}`);
}
