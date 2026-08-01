// «صفحتي» — أول ما يراه الموظف حين يدخل: عمله هو، لا لوحةُ شركةٍ لا تخصّه.
//
// لماذا صفحةٌ مستقلة: كان الدخول يهبط على لوحة القيادة أو مركز القطاع — شاشتان تُجيبان
// «كيف حال الشركة؟» لا «ماذا عليّ اليوم؟». والموظف الذي يفتح المنصة صباحاً لا يريد إيراد
// القطاع؛ يريد ما يستحق وقته في الساعات القادمة، وما فاته، وما ينتظره هذا الشهر.
//
// وقاعدة البناء: **لا استعلام يتجاوز نطاق صاحب الصفحة**. كل ما هنا مقيَّد بمعرّفه هو —
// مهامه المسندة إليه، فرصه التي يملكها، مشاريعه التي سُكِّن عليها، ومخرجات تلك المشاريع.
// فلا تحتاج الصفحة بوابة صلاحيات إضافية: من يفتحها يرى نفسه ولا يرى أحداً غيره.
import { all, get } from '../../core/db/index.js';
// أسماء الأشهر والأيام من النموذج الزمني الواحد للمنصة — لا نسخة ثانية هنا: أول انحراف بين
// نسختين يجعل التقويم يسمّي الشهر اسماً لا يطابق ما يسمّيه به شريط التسكين في الصفحة نفسها.
import { MONTHS_AR, WEEKDAYS_AR } from '../../core/i18n/time.js';

const iso = (d) => d.toISOString().slice(0, 10);

// ── عبارة اليوم ──
// لكل يومٍ نبرته: بداية الأسبوع تُفتح بعزم، ووسطه يُذكّر بالإيقاع، وآخره يدعو إلى الإغلاق
// لا إلى الفتح. والجمعة والسبت عطلة — فمن يفتح المنصة فيهما لا يُدفع إلى العمل بل يُشكر.
// عبارةٌ واحدة ثابتة لكل يوم: التنويع العشوائي يجعلها زينةً تُقرأ مرة ثم تُهمَل، والثبات
// يجعلها إيقاعاً يُعرف — «اليوم الأربعاء» تُقرأ من نبرتها قبل تاريخها.
const GREETING = [
  { hi: 'أهلاً بك في بداية الأسبوع', sub: 'ابدأ بأثقل ما عندك — البقية تصير أسهل بعده.' },
  { hi: 'يومٌ للبناء', sub: 'ما بدأته أمس يكتمل اليوم. أغلق قبل أن تفتح جديداً.' },
  { hi: 'منتصف الطريق', sub: 'راجع ما تأخّر الآن، فبقية الأسبوع لا تتّسع لمفاجأة.' },
  { hi: 'يوم الحسم', sub: 'ما لم يُقرَّر اليوم يُرحَّل أسبوعاً كاملاً.' },
  { hi: 'خِتام الأسبوع', sub: 'سلّم ما نضج، ودوّن ما بقي — كي لا يبدأ الأحد بالبحث.' },
  { hi: 'جمعة مباركة', sub: 'راحتك جزءٌ من عملك. ما هنا ينتظرك حتى الأحد.' },
  { hi: 'نهاية أسبوع طيبة', sub: 'إن مررتَ لمتابعة، فهذه خلاصةُ ما ينتظرك.' },
];

export function greetingFor(date = new Date()) {
  const d = date.getDay();
  return { ...GREETING[d], weekday: WEEKDAYS_AR[d], weekend: d === 5 || d === 6 };
}

// حالةُ الموعد بالنسبة لليوم — تُحسب في الخدمة لا في الشاشة، فتتّحد في كل مكان يعرضها.
export function dueState(dateStr, today) {
  if (!dateStr) return 'none';
  const d = String(dateStr).slice(0, 10);
  if (d < today) return 'late';
  if (d === today) return 'today';
  const soon = new Date(today + 'T00:00:00Z');
  soon.setUTCDate(soon.getUTCDate() + 7);
  return d <= iso(soon) ? 'soon' : 'later';
}

/**
 * كل ما يخصّ شخصاً واحداً في نداءٍ واحد: مهامه، فرصه، مشاريعه، مخرجات مشاريعه، ومعالمها.
 * لا شيء هنا يتجاوز معرّفه — فالصفحة تعرض صاحبها ولا تعرض سواه.
 */
export async function myDay(user, opts = {}) {
  const today = opts.today || iso(new Date());
  const uid = user.id;

  // سجل الموظف المرتبط: التسكين والمخرجات تُنسب إليه لا إلى الحساب.
  const emp = await get(
    'SELECT id, name_ar, job_title, sector_id, department_id FROM employee WHERE user_id = ? AND deleted_at IS NULL',
    [uid]);
  const empId = emp?.id || null;

  // المهمة تُنسب إلى مشروعها **أو إلى فرصتها**: مواعيد المنافسات تصل الموظف مهامَّ مسنَدة
  // إليه («تسليم العرض الفني»)، وقصرُ الربط على المشروع كان يعرضها بلا سياق — «مهمة» وحدها،
  // فلا يعرف صاحبها أي منافسةٍ تخصّ ولا إلى أين يذهب.
  const tasks = await all(
    `SELECT t.id, t.title, t.status, t.due_date, t.priority,
            p.name_ar project_name, p.id project_id,
            o.title_ar opp_name, o.id opp_id
       FROM task t
       LEFT JOIN project p ON p.id = t.project_id
       LEFT JOIN opportunity o ON o.id = t.opportunity_id
      WHERE t.assignee_user_id = ? AND t.deleted_at IS NULL AND t.status NOT IN ('DONE','CANCELLED')
      ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date`, [uid]);

  // الفرص المفتوحة وحدها: المكسوبة والمخسورة تاريخٌ لا عمل، ووضعُها في «ما ينتظرك» يُثقل
  // الصفحة بما لا يُفعل. والمرحلة تُقرأ من جدولها لا من معرّفها — فلا رمزٌ داخلي يظهر لأحد.
  const opps = await all(
    `SELECT o.id, o.title_ar, o.win_pct, o.value_halalas, o.next_action,
            c.name_ar client_name, s.name_ar stage_name, s.is_won, s.is_lost
       FROM opportunity o
       LEFT JOIN client c ON c.id = o.client_id
       LEFT JOIN stage s ON s.id = o.stage_id
      WHERE o.owner_user_id = ? AND o.deleted_at IS NULL
      ORDER BY o.value_halalas DESC`, [uid]);
  const openOpps = opps.filter((o) => !Number(o.is_won) && !Number(o.is_lost));

  // مشاريعه = ما سُكِّن عليه فعلاً (أو يملكه). التسكين هو الحقيقة التشغيلية لا الملكية الاسمية.
  const projects = empId ? await all(
    `SELECT DISTINCT p.id, p.name_ar, p.status, p.rag, c.name_ar client_name
       FROM allocation a JOIN project p ON p.id = a.project_id
       LEFT JOIN client c ON c.id = p.client_id
      WHERE a.employee_id = ? AND a.deleted_at IS NULL AND p.deleted_at IS NULL
      ORDER BY p.name_ar`, [empId]) : [];

  const pids = projects.map((p) => p.id);
  const ph = pids.map(() => '?').join(',');

  // معالم مشاريعه — لها موعدٌ صريح، وهي أقرب ما في القاعدة إلى «تسليم».
  const milestones = pids.length ? await all(
    `SELECT m.id, m.name_ar, m.due_date, m.status, p.name_ar project_name, p.id project_id
       FROM milestone m JOIN project p ON p.id = m.project_id
      WHERE m.project_id IN (${ph}) AND m.deleted_at IS NULL AND m.status <> 'MET'
      ORDER BY CASE WHEN m.due_date IS NULL THEN 1 ELSE 0 END, m.due_date`, pids) : [];

  // المخرجات: موعدها شهر/سنة لا تاريخ يوم — فيُشتقّ آخر يوم في شهرها موعداً تقريبياً،
  // ويُقال ذلك للمستخدم صراحةً («خلال الشهر») بدل ادّعاء يومٍ بعينه.
  const deliverables = pids.length ? await all(
    `SELECT d.id, d.name_ar, d.month, d.year, d.status, d.phase_name_ar, p.name_ar project_name, p.id project_id
       FROM deliverable d JOIN project p ON p.id = d.project_id
      WHERE d.project_id IN (${ph}) AND d.deleted_at IS NULL
        AND d.status IN ('PENDING','DELIVERED','REJECTED')
      ORDER BY d.year, d.month`, pids) : [];

  const withDue = deliverables.map((d) => {
    const y = Number(d.year) || null, m = Number(d.month) || null;
    const due = y && m ? iso(new Date(Date.UTC(y, m, 0))) : null;   // آخر يوم في الشهر
    return { ...d, due_date: due, approx: true };
  });

  // إشغاله هو — لا إشغال قطاعه. يُجمع من خطط تسكينه الشهرية كما تُقرأ في «التسكين» تماماً،
  // فالرقم الذي يراه هنا هو نفسه الذي يراه مديره هناك، لا حسابٌ ثانٍ يخالفه.
  const year = Number(today.slice(0, 4));
  const monthNo = Number(today.slice(5, 7));
  const months = new Array(12).fill(0);
  if (empId) {
    const plans = await all(
      'SELECT monthly_json FROM allocation WHERE employee_id = ? AND year = ? AND deleted_at IS NULL',
      [empId, year]);
    for (const p of plans) {
      let mj = {};
      try { mj = JSON.parse(p.monthly_json || '{}'); } catch { mj = {}; }
      for (const [k, v] of Object.entries(mj)) {
        const i = Number(k) - 1;
        if (i >= 0 && i < 12) months[i] += Number(v) || 0;
      }
    }
  }

  const stamp = (r) => ({ ...r, due_state: dueState(r.due_date, today) });
  return {
    today,
    greeting: greetingFor(opts.now || new Date()),
    employee: emp || null,
    tasks: tasks.map(stamp),
    opportunities: openOpps,
    projects,
    milestones: milestones.map(stamp),
    deliverables: withDue.map(stamp),
    utilization: {
      year,
      month: monthNo,
      now: Math.round((months[monthNo - 1] || 0) * 100),
      months: months.map((m) => Math.round(m * 100)),
    },
  };
}

/**
 * تقويم شهرٍ واحد: أيامه مصفوفةً واحدة، وكل يومٍ يحمل ما يستحقّه من مواعيد صاحب الصفحة.
 * يُبنى في الخدمة لا في الشاشة كي يُختبَر: شبكةُ تقويمٍ تُبنى في قالبٍ نصّي لا تُفحص.
 */
export function monthGrid(day, { year, month } = {}) {
  const base = new Date(day.today + 'T00:00:00Z');
  const y = year ?? base.getUTCFullYear();
  const m = month ?? base.getUTCMonth();          // ٠ = يناير
  const first = new Date(Date.UTC(y, m, 1));
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lead = first.getUTCDay();                  // الأحد = ٠، وهو أول أعمدة الشبكة

  const events = [];
  const push = (r, kind) => { if (r.due_date) events.push({ kind, date: r.due_date.slice(0, 10), title: r.title || r.name_ar, project: r.project_name || null, approx: !!r.approx }); };
  for (const t of day.tasks) push(t, 'task');
  for (const s of day.milestones) push(s, 'milestone');
  for (const d of day.deliverables) push(d, 'deliverable');

  const byDate = new Map();
  for (const e of events) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }

  const cells = [];
  let inMonth = 0;
  for (let i = 0; i < lead; i++) cells.push({ blank: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = iso(new Date(Date.UTC(y, m, d)));
    const list = byDate.get(date) || [];
    inMonth += list.length;
    cells.push({
      day: d, date, today: date === day.today,
      weekend: new Date(date + 'T00:00:00Z').getUTCDay() >= 5,
      events: list,
      kinds: [...new Set(list.map((e) => e.kind))],
    });
  }
  // العدد المُعاد هو عدد مواعيد **الشهر المعروض** لا كل مواعيد الشخص: الرقم يُعرض تحت اسم
  // الشهر مباشرةً، فعدُّ ما خارجه يجعل الشاشة تَعِد بمواعيد لا توجد في الشبكة تحته.
  return { year: y, month: m, label: `${MONTHS_AR[m]} ${y}`, cells, total: inMonth };
}
