// ── تحديث نسب الإشغال من كشف توزيع مايو ٢٠٢٦ ─────────────────────────────────
//
// «احتاج منك تحدّث اليوتلايزيشن الموجود على الناس بناءً على الملفات المرسلة لقطاع الحلول»
// — بلسان المالك، ومعه ملفّا التوزيع.
//
// **لا راتب هنا ولا رقم منه.** الملفان يحملان الرواتب، والمنقول عنهما **نسب الوقت وحدها**:
// الراتب مختوم في المنصة لمدير النظام حتى تكامل Odoo، ولا يُكتب في مستودع بأي صورة.
//
// ── ما يُكتب وما لا يُكتب ────────────────────────────────────────────────────
// يُكتب **تسكين المشروع** وحده. أما «قطاع الحلول ٤٠٪» و«قطاع تطوير الأعمال ٦٠٪» فليست
// مشاريع بل بقيّةُ الوقت المحجوزة للقطاع — والمنصة تقرؤها هكذا أصلاً (`G.sectorParking`:
// ما لم يُسكَّن على مشروع يبقى لقطاعه). فكتابتها تسكيناً تخترع مشروعاً لا وجود له.
//
// ── ولا يخمّن ──────────────────────────────────────────────────────────────
// المطابقة بالاسم — والاسم ليس مفتاحاً — فالقاعدة: **ما لا يُحسَم يُترك ويُقال سببه**.
// شخصٌ لا يُطابَق، أو مشروعٌ يطابقه اسمان، أو تعارضٌ بين المصدرين ⟵ لا يُكتب شيء ويُطبع السطر.
// وتسكينٌ على المشروع الخطأ عطلٌ صامت: يظهر في حِمل رجلٍ لا يعمل عليه، ويغيب عمّن يعمل.
//
// ── ويُشغَّل مرةً واحدة ────────────────────────────────────────────────────
// طابعٌ في `schema_migration` كنظائره. وإلا أُعيدت الكتابة فوق ما صحّحه المالك بيده من شاشة
// التسكين عند كل إقلاع — أي أن الشاشة تصير عاجزةً عن تصحيح ما كتبه السكربت.
import { all, get, run, insert } from '../src/core/db/index.js';
import { id, nowIso } from '../src/core/util/ids.js';

const FLAG = 'op:utilization-may-2026';
const YEAR = 2026;

// تطبيع عربي: الهمزات والتاء المربوطة والألف المقصورة والتشكيل والمسافات — فـ«الاركاب» و«الإركاب»
// اسمٌ واحد، و«المشاعر المقدسه» و«المشاعر المقدسة» كذلك.
export function norm(s) {
  return String(s || '')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

// الكشف المنقول من الملفّين: الاسم كما ورد، ثم تسكينات المشاريع وحدها بنسبها.
// (سطور «قطاع …» محذوفة عمداً — بقيّة الوقت تُقرأ حجزاً للقطاع كما تفعل المنصة.)
export const PLAN = [
  { person: 'ريان باسم ظفر', allocations: [['منصة البيانات السعودية', 60]] },
  { person: 'يعقوب سيد اكرم', allocations: [['كاميرات المشاعر المقدسة', 100]] },
  { person: 'حسين محمد الجفري', allocations: [['كاميرات المشاعر المقدسة', 100]] },
  { person: 'عبدالرحمن خالد حليم الدين', allocations: [['كاميرات المشاعر المقدسة', 50]] },
  { person: 'ايوب الزاكي', allocations: [['الاركاب الذكي', 50], ['كاميرات محبس الجن', 50]] },
  { person: 'ابراهيم صابر النوساني', allocations: [['كاميرات المشاعر المقدسة', 50], ['حساسات البحر الاحمر', 50]] },
  { person: 'اسحاق سيد اكرم', allocations: [['كاميرات المشاعر المقدسة', 100]] },
  { person: 'شوق محمد بامشموس', allocations: [['كاميرات المشاعر المقدسة', 50], ['منصة البيانات السعودية', 50]] },
  { person: 'هادي احمد الكرمي', allocations: [['العناية بالحرمين', 100]] },
  { person: 'زكي سفر', allocations: [['كاميرات المشاعر المقدسة', 100]] },
  { person: 'ياسر علي', allocations: [['كاميرات المشاعر المقدسة', 25]] },
  { person: 'محمود قشطة', allocations: [['التخطيط والاقتصاد', 30]] },
];

// تعارضٌ مكشوف بين المصدرين — يُترك ويُقال، ولا يُرجَّح مصدرٌ على آخر بلا قرار المالك.
export const CONFLICTS = [
  {
    person: 'عمر حمزة',
    reason: 'ثلاثة توزيعات مختلفة للشخص نفسه: الملف الأول (نسك ٣٥٪ + ١٥٪)، والثاني (نسك ٣٠٪ + '
      + 'كاميرات المشاعر ٣٠٪)، وكشف مايو المرسل (٧٠٪ كاميرات و٣٠٪ تطوير أعمال) — يُحسم من شاشة التسكين',
  },
  {
    person: 'انس الحساني · ياسر صالح · د. ايوب',
    reason: 'وردوا في كشف مايو ولم يردوا في الملفين المرسلين — والمالك أحال إلى الملفين',
  },
];

// مطابقة الشخص: اسمٌ مطبَّع مطابق تماماً، أو **كل كلماته** موجودة في اسم الكشف (اسم ثلاثي يطابق
// رباعياً). وأكثر من مطابقة ⟵ لا حسم.
function matchPeople(staff, wanted) {
  const w = norm(wanted);
  const exact = staff.filter((s) => norm(s.name_ar) === w);
  if (exact.length) return exact;
  const words = w.split(' ').filter(Boolean);
  return staff.filter((s) => { const n = norm(s.name_ar); return words.every((x) => n.includes(x)); });
}

// مطابقة المشروع: احتواءُ الاسم المطبَّع في أيٍّ من الاتجاهين، ومطابقةٌ واحدة فقط.
function matchProjects(projects, wanted) {
  const w = norm(wanted);
  const hits = projects.filter((p) => { const n = norm(p.name_ar); return n.includes(w) || w.includes(n); });
  if (hits.length <= 1) return hits;
  const exact = hits.filter((p) => norm(p.name_ar) === w);
  return exact.length === 1 ? exact : hits;
}

// النسبة الشهرية: الاثنا عشر شهراً بنفس القيمة — الكشف شهريٌّ بلا مدى، فالمدى سنةٌ كاملة
// حتى يُصحّحه المالك من الشاشة. والقيمة كسرٌ لا نسبة مئوية (نفس ما تقرؤه `parseMonths`).
const monthlyJson = (pct) =>
  JSON.stringify(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, pct / 100])));

export async function applyUtilization({ force = false } = {}) {
  const done = await get('SELECT applied_at FROM schema_migration WHERE version = ?', [FLAG]);
  if (done?.applied_at && !force) return { skipped: true, at: done.applied_at, written: [], notes: [] };

  const notes = CONFLICTS.map((c) => `«${c.person}»: ${c.reason}`);
  const written = [];
  const staff = await all(
    'SELECT id, name_ar, sector_id FROM employee WHERE deleted_at IS NULL AND active = 1');
  const projects = await all(
    "SELECT id, name_ar, sector_id FROM project WHERE deleted_at IS NULL");
  const now = nowIso();

  for (const row of PLAN) {
    const people = matchPeople(staff, row.person);
    if (people.length !== 1) {
      notes.push(`«${row.person}»: ${people.length === 0 ? 'لا موظف نشطاً بهذا الاسم'
        : `أكثر من موظف يطابقه (${people.map((p) => p.name_ar).join('، ')})`} — لم يُكتب تسكين`);
      continue;
    }
    const emp = people[0];
    for (const [projectName, pct] of row.allocations) {
      const hits = matchProjects(projects, projectName);
      if (hits.length !== 1) {
        notes.push(`«${emp.name_ar}» ⟵ «${projectName}»: ${hits.length === 0 ? 'لا مشروع بهذا الاسم'
          : `أكثر من مشروع يطابقه (${hits.map((p) => p.name_ar).join('، ')})`} — لم يُكتب تسكين`);
        continue;
      }
      const prj = hits[0];
      const existing = await get(
        `SELECT id FROM allocation
          WHERE employee_id = ? AND project_id = ? AND year = ? AND deleted_at IS NULL`,
        [emp.id, prj.id, YEAR]);
      if (existing) {
        notes.push(`«${emp.name_ar}» على «${prj.name_ar}»: تسكينٌ قائم — لم يُمَسّ`);
        continue;
      }
      await insert('allocation', {
        id: id('alc'), employee_id: emp.id, project_id: prj.id, project_name: prj.name_ar,
        person_name_ar: emp.name_ar, sector_id: prj.sector_id || emp.sector_id || null,
        type: 'member', year: YEAR, monthly_json: monthlyJson(pct), created_at: now,
      });
      written.push(`${emp.name_ar} · ${prj.name_ar} · ${pct}%`);
    }
  }

  await run(
    `INSERT INTO schema_migration (version, applied_at) VALUES (?,?)
     ON CONFLICT (version) DO UPDATE SET applied_at = excluded.applied_at`, [FLAG, now]);
  return { skipped: false, at: now, written, notes };
}

if (process.argv[1] && process.argv[1].endsWith('apply-utilization-may2026.js')) {
  const r = await applyUtilization({ force: process.argv.includes('--force') });
  if (r.skipped) console.log(`نسب الإشغال مطبَّقة مسبقاً في ${String(r.at).slice(0, 10)} — لا تغيير`);
  else console.log(`كُتب ${r.written.length} تسكيناً:`);
  for (const w of r.written) console.log(`  ✓ ${w}`);
  for (const n of r.notes) console.log(`  · ${n}`);
}
