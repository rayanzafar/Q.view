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

const FLAG = 'op:utilization-may-2026-v4';
const YEAR = 2026;

// تطبيع عربي: الهمزات والتاء المربوطة والألف المقصورة والتشكيل والمسافات — فـ«الاركاب» و«الإركاب»
// اسمٌ واحد، و«المشاعر المقدسه» و«المشاعر المقدسة» كذلك.
export function norm(s) {
  return String(s || '')
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

// الألقاب تُنزَع قبل المقارنة: الكشف يكتب «م/ زكي سفر» والمنصة تكتب «د. أيوب الزاكي»، فلقبٌ
// واحد يجعل أول الاسم لقباً لا اسماً — وهو ما أسقط أكثر من نصف الكشف في أول تشغيل حيّ.
const HONORIFICS = new Set(['د', 'م', 'ا', 'أ', 'الدكتور', 'المهندس', 'الاستاذ', 'دكتور', 'مهندس']);
export function nameWords(s) {
  return norm(s).replace(/[./\\|,]/g, ' ').split(' ')
    .filter((w) => w && !HONORIFICS.has(w));
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

// مطابقة الشخص — والاتجاه هنا هو ما أخطأتُه أول مرة: الكشف يكتب الاسم **رباعياً** («ريان باسم
// ظفر») والمنصة تحفظه **ثنائياً** («ريان ظفر»). فاشتراطُ احتواء كل كلمات الكشف في اسم المنصة
// يُسقط كل اسمٍ مختصَر — وقد أسقط ثلاثة عشر من أربعة عشر في أول تشغيل حيّ.
// فالمطابقة صارت في **الاتجاهين**: يكفي أن يكون أحد الاسمين مجموعةً جزئية من الآخر.
// وشرطُ كلمتين مشتركتين على الأقل يمنع أن يجمع الاسمَ الأول وحده رجلين مختلفين.
// والمطابقة التامّة تغلب الجزئية، وأكثر من مطابقة ⟵ لا حسم.
function matchPeople(staff, wanted) {
  const w = nameWords(wanted);
  const key = w.join(' ');
  const exact = staff.filter((s) => nameWords(s.name_ar).join(' ') === key);
  if (exact.length) return exact;
  return staff.filter((s) => {
    const n = nameWords(s.name_ar);
    if (n.length < 2 || w.length < 2) return false;
    const shared = n.filter((x) => w.includes(x)).length;
    if (shared < 2) return false;
    return w.every((x) => n.includes(x)) || n.every((x) => w.includes(x));
  });
}

// ── مطابقة المشروع: تقريبٌ محسوب لا احتواءُ نصّ ───────────────────────────────
// «قرّب الأسماء وشوف المناسب، لأن هالأسماء عندنا غير متطابقة في الشركة» — بلسان المالك.
// والاحتواء النصّي كان يسقط على أول اختلاف في الصياغة: «كاميرات المشاعر المقدسة» في كشف
// الرواتب ليست جزءاً من «منظومة رصد دخول الحافلات للمشاعر المقدسة» ولا العكس، وهما مشروع واحد.
//
// فالمقارنة صارت **بالكلمات المشتركة** بعد ثلاث خطوات: تطبيع، ونزع أداة التعريف ولواصقها
// (فـ«للمشاعر» و«المشاعر» و«مشاعر» كلمةٌ واحدة)، وإسقاط الكلمات العامّة التي تشترك فيها كل
// المشاريع («مشروع»، «خدمات»، «عقد»…) — وإبقاؤها يجعل كل اسمين يتشابهان بلا معنى.
//
// والحسم يبقى مشروطاً: **أعلى نتيجة وحيدة** بكلمتين مشتركتين على الأقل. وتعادلٌ في القمة ⟵
// لا حسم ويُقال المرشَّحون. فالتقريب يوسّع ما يُطابَق ولا يُلغي قاعدة «ما لا يُحسَم يُترك».
const PROJECT_STOP = new Set(['مشروع', 'مشاريع', 'عقد', 'عقود', 'خدمات', 'خدمه', 'دعم', 'تنفيذ',
  'اعمال', 'ادارة', 'اداره', 'تطوير', 'برنامج', 'منصه', 'منظومه', 'نظام', 'مركز', 'هيئه', 'وزاره']);
const stripAl = (w) => w.replace(/^(وال|فال|بال|كال|لل|ال)/, '');
export function projectWords(s) {
  return [...new Set(norm(s).replace(/[—–\-_,()،/]/g, ' ').split(' ')
    .map(stripAl).filter((w) => w.length > 2 && !PROJECT_STOP.has(w)))];
}

// أسماءٌ حسمها المالك بنفسه حين اختلفت التسمية اختلافاً لا يقرّبه تشابهُ كلمات.
export const PROJECT_ALIASES = { 'التخطيط والاقتصاد': 'منصة البيانات السعودية' };

function scoreProjects(projects, wantedRaw) {
  const wanted = PROJECT_ALIASES[wantedRaw] || wantedRaw;
  const w = projectWords(wanted);
  return projects
    .map((p) => ({ p, score: w.length ? projectWords(p.name_ar).filter((x) => w.includes(x)).length : 0 }))
    .sort((a, b) => b.score - a.score);
}

function matchProjects(projects, wantedRaw) {
  const wanted = PROJECT_ALIASES[wantedRaw] || wantedRaw;
  const exact = projects.filter((p) => norm(p.name_ar) === norm(wanted));
  if (exact.length === 1) return exact;
  const scored = scoreProjects(projects, wantedRaw).filter((x) => x.score >= 2);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((x) => x.score === top).map((x) => x.p);
}

// ── ولا يُترك «لا مشروع بهذا الاسم» بلا دليل ────────────────────────────────
// «قرّب الأسماء وشوف المناسب» — والتقريب لا يبلغ كل اختلاف تسمية، وأنا لا أرى سجلّ المشاريع
// من خارج شبكة النشر. فحين لا يُحسَم اسمٌ تُطبَع **أقرب ثلاثة بأسمائها ودرجاتها**: يصير السجل
// نفسه هو الجواب، ويقرأ المالك سطراً واحداً بدل أن يبحث. رسالةٌ تقول «لم أجد» ولا تقول «وهذا
// أقرب ما عندي» تُحوِّل العطل إلى بحثٍ يدوي.
const nearest = (projects, wanted) => scoreProjects(projects, wanted).slice(0, 3)
  .filter((x) => x.score > 0)
  .map((x) => `${x.p.name_ar} (${x.score})`).join(' · ') || 'لا شيء قريب';

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
        notes.push(`«${emp.name_ar}» ⟵ «${projectName}»: ${hits.length === 0
          ? `لا مشروع بهذا الاسم — أقرب ما في السجل: ${nearest(projects, projectName)}`
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
