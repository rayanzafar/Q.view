// ── أدوات المساعد على المشاريع — قراءةٌ فقط في هذه النسخة ────────────────────────────────────
//
// لا كتابة هنا قصداً: تعديل مشروعٍ يغيّر محفظةً كاملة (قيمة تعاقد، حالة، فريق، معالم) ولكلٍّ
// بابُه في الشاشة بحرّاسه. فالمساعد يقرأ ويشرح، والتغيير يبقى حيث يُراجَع.
//
// وقاعدة المال هنا هي الفارق الجوهري عن أدوات الموارد: **المال يظهر في هذا المحور وحده، ولمن
// يقرؤه وحده**. ورقمان لا يُجمعان أبداً — قيمة العقد التزامٌ وُقِّع، والإيراد المُثبت ما تحقق
// منه فعلاً. جمعُهما رقمٌ لا معنى له، فيخرجان منفصلين بأساسِ كلٍّ منهما مكتوباً.
import { get, all } from '../../core/db/index.js';
import { badRequest } from '../../core/http/errors.js';
import { can, canSeeSensitive, effectiveScope } from '../../core/rbac/index.js';
import { riyadhDate } from '../../core/i18n/time.js';
import { listProjects, getProject, nextMilestones, projectRevenue, projectStaffing } from '../pmo/projects.js';
import {
  envelope, inputOf, text, intOf, enumOf, boolOf, pageOf, partialOf, uniqRefs,
  textOrNot, numOrNot, notMeasured, measured,
  S, obj, PAGE_PROPS, REF, TEXT_IS_DATA_AR, UNIT_NOTES,
} from './tool-kit.js';

const SAR = (h) => (h == null ? null : Math.round(Number(h)) / 100);
const STATUS_AR = Object.freeze({
  NOT_STARTED: 'لم يبدأ', PLANNED: 'مخطَّط', IN_PROGRESS: 'قيد التنفيذ',
  ON_HOLD: 'متوقف', COMPLETED: 'مكتمل', CANCELLED: 'ملغى',
});
const RAG_AR = Object.freeze({ GREEN: 'على المسار', AMBER: 'في خطر', RED: 'حرج' });
const STATUSES = Object.keys(STATUS_AR);

const unitsFor = (seesMoney) => (seesMoney
  ? { money_sar_ar: UNIT_NOTES.money_sar_ar, pct_ar: 'النِّسب مئوية من 0 إلى 100', days_ar: UNIT_NOTES.days_ar }
  : { money_ar: 'لا قيم مالية في هذه النتيجة — بوابة قراءة المال غير مفتوحة لهذا الحساب', pct_ar: 'النِّسب مئوية من 0 إلى 100', days_ar: UNIT_NOTES.days_ar });

const scopeArOf = (user) => {
  const s = effectiveScope(user, 'read', 'project');
  return s === 'company' ? 'نطاق القراءة: مشاريع الشركة كلها'
    : s === 'sector' ? 'نطاق القراءة: مشاريع قطاعك'
      : s === 'department' ? 'نطاق القراءة: مشاريع إداراتك وما تشارك فيه'
        : 'نطاق القراءة: مشاريعك أنت وما أُسند إليك';
};

// نسبة الصرف والفجوة بينها وبين الإنجاز — سؤال المدير الحقيقي: هل ما أُنفق يوازي ما أُنجز؟
// وكلاهما يحتاج طرفيه: بلا ميزانية لا نسبة صرف، وبلا نسبتين لا فجوة. الغياب يُقال ولا يُصفَّر.
function spendView(row, seesMoney) {
  if (!seesMoney) return { spend_pct: notMeasured('بوابة قراءة المال غير مفتوحة لهذا الحساب'), gap_vs_progress: notMeasured('تحتاج نسبة الصرف') };
  const budget = Number(row.budget_halalas) || 0;
  const spent = Number(row.actual_spend_halalas) || 0;
  if (!budget) return { spend_pct: notMeasured('لا ميزانية مسجَّلة — لا نسبة صرف بلا مقام'), gap_vs_progress: notMeasured('تحتاج نسبة الصرف') };
  const pct = Math.round((spent / budget) * 100);
  const prog = row.progress_effective_pct == null ? null : Math.round(Number(row.progress_effective_pct));
  return {
    spend_pct: measured(pct, 'نسبة مئوية من الميزانية المعتمدة'),
    gap_vs_progress: prog == null
      ? notMeasured('نسبة الإنجاز غير مُسجَّلة — لا فجوة تُقاس')
      : { recorded: true, value: pct - prog, unit_ar: 'نقاط مئوية (الصرف ناقص الإنجاز)', ar: pct - prog > 10 ? 'الصرف يسبق الإنجاز' : (prog - pct > 10 ? 'الإنجاز يسبق الصرف' : 'متقاربان') },
  };
}

function moneyView(row, revenueHalalas, seesMoney) {
  if (!seesMoney) {
    return {
      contract_value_sar: notMeasured('قيمة العقد خلف بوابة قراءة المال — غير مفتوحة لهذا الحساب'),
      recognized_revenue_sar: notMeasured('الإيراد المُثبت خلف بوابة قراءة المال — غير مفتوحة لهذا الحساب'),
      note_ar: 'الرقمان يُقرآن لمن يفتح بوابة المال، ولا يُجمعان: قيمة العقد التزامٌ وُقِّع، والإيراد المُثبت ما تحقق منه.',
    };
  }
  return {
    contract_value_sar: numOrNot(SAR(row.contract_value_halalas), 'ريال سعودي — قيمة العقد كما وُقِّع', 'قيمة العقد غير مُسجَّلة'),
    recognized_revenue_sar: numOrNot(SAR(revenueHalalas), 'ريال سعودي — الإيراد المُثبت من بنود الإيراد', 'لا إيراد مُثبت مسجَّل لهذا المشروع'),
    note_ar: 'رقمان منفصلان لا يُجمعان: قيمة العقد التزامٌ وُقِّع، والإيراد المُثبت ما تحقق منه فعلاً وسُجِّل في بنود الإيراد.',
  };
}

const projectOut = (row) => ({
  id: row.id, code: row.code || null, name: row.name_ar,
  status: row.status, status_ar: STATUS_AR[row.status] || row.status,
  health: row.rag || null, health_ar: RAG_AR[row.rag] || 'غير مُقيَّم',
  progress_pct: numOrNot(row.progress_effective_pct ?? row.progress_pct, 'نسبة إنجاز محسوبة من المخرجات المعتمدة', 'نسبة الإنجاز غير مُسجَّلة'),
  pm: textOrNot(row.pm_name, 'مدير المشروع غير مُسجَّل'),
  start_date: row.start_date ? String(row.start_date).slice(0, 10) : null,
  end_date: row.end_date ? String(row.end_date).slice(0, 10) : null,
});

// ── sanad_list_projects ─────────────────────────────────────────────────────────────────
async function runListProjects(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const today = riyadhDate();
  const seesMoney = canSeeSensitive(user, 'margin') || canSeeSensitive(user, 'cost');
  const { page, pageSize } = pageOf(input, { defSize: 25, maxSize: 100 });
  let rows = await listProjects(user, {
    sector: text(input.sector, 'القطاع', { max: 60 }) || undefined,
    status: enumOf(input.status, 'حالة المشروع', STATUSES) || undefined,
    year: intOf(input.year, 'السنة', { min: 2000, max: 2100 }) || undefined,
  });
  const health = enumOf(input.health, 'حالة الصحة', ['GREEN', 'AMBER', 'RED']);
  if (health) rows = rows.filter((r) => r.rag === health);
  if (boolOf(input.activeOnly, true)) rows = rows.filter((r) => r.status !== 'CANCELLED' && r.status !== 'COMPLETED');

  const total = rows.length;
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  const ids = slice.map((r) => r.id);
  const [ms, prog] = await Promise.all([
    nextMilestones(ids),
    (await import('../pmo/progress.js')).effectiveProgress(slice),
  ]);
  const byProject = Object.fromEntries(ms.map((m) => [m.project_id, m]));
  const weekEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);

  return envelope('sanad_list_projects', {
    scope_ar: scopeArOf(user), units: unitsFor(seesMoney),
    projects: slice.map((r) => {
      const eff = prog.get(r.id) || null;
      const row = { ...r, progress_effective_pct: eff ? eff.pct : r.progress_pct };
      const next = byProject[r.id] || null;
      return {
        ...projectOut(row),
        ...spendView(row, seesMoney),
        next_milestone: next
          ? { title: next.title, due_date: next.due_date, due_this_week: !!(next.due_date && String(next.due_date).slice(0, 10) <= weekEnd) }
          : notMeasured('لا معلَم قادم مسجَّل — الخطوة القادمة غير معروفة من المنصة'),
      };
    }),
    partial: partialOf({ page, pageSize, total, returned: slice.length }),
    basis_ar: 'نسبة الإنجاز محسوبة من المخرجات المعتمدة لا من عمود مخزَّن. «فجوة الصرف عن الإنجاز» نقاط مئوية موجبةً تعني أن الصرف يسبق العمل.',
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([REF.projects(), ...slice.map((r) => REF.project(r.id))]),
  });
}

// ── sanad_get_project ───────────────────────────────────────────────────────────────────
async function runGetProject(ctx, raw) {
  const user = ctx.user;
  const pid = text(inputOf(raw).projectId, 'معرّف المشروع', { required: true, max: 80 });
  const seesMoney = canSeeSensitive(user, 'margin') || canSeeSensitive(user, 'cost');
  const row = await getProject(user, pid); // الحارس والقصّ في الخدمة
  const [revRows, staffing, milestones] = await Promise.all([
    seesMoney ? projectRevenue([pid]) : Promise.resolve([]),
    projectStaffing(user, pid).catch(() => null),
    all(`SELECT id, name_ar, due_date, status FROM milestone WHERE project_id = ? AND deleted_at IS NULL ORDER BY (due_date IS NULL), due_date`, [pid]),
  ]);
  // `projectRevenue` تعيد صفوفاً لا خريطة — والمشروع بلا بنود إيراد لا يظهر فيها أصلاً.
  const revenue = (revRows || []).find((r) => r.project_id === pid)?.revenue_halalas ?? null;

  // التغطية الشهرية: أي شهر بلا أحدٍ مُسكَّن سؤالٌ يُطرح على المدير — والصفر هنا حقيقي لا غائب.
  const alloc = await all(
    `SELECT year, monthly_json FROM allocation WHERE project_id = ? AND deleted_at IS NULL`, [pid]);
  const coverage = {};
  for (const a of alloc) {
    let mj = {};
    try { mj = typeof a.monthly_json === 'string' ? JSON.parse(a.monthly_json || '{}') : (a.monthly_json || {}); } catch { mj = {}; }
    for (const [k, v] of Object.entries(mj)) {
      const key = /^\d{4}-\d{2}$/.test(k) ? k : `${a.year}-${String(k).padStart(2, '0')}`;
      coverage[key] = (coverage[key] || 0) + (Number(v) || 0);
    }
  }
  const months = Object.keys(coverage).sort();
  const uncovered = months.filter((m) => !coverage[m]);

  return envelope('sanad_get_project', {
    scope_ar: scopeArOf(user), units: unitsFor(seesMoney),
    project: { ...projectOut(row), ...spendView(row, seesMoney) },
    money: moneyView(row, revenue, seesMoney),
    plan_vs_actual: {
      progress_pct: numOrNot(row.progress_effective_pct, 'نسبة إنجاز محسوبة من المخرجات', 'غير مُسجَّلة'),
      spend: spendView(row, seesMoney),
      schedule_ar: (row.start_date && row.end_date) ? `من ${String(row.start_date).slice(0, 10)} إلى ${String(row.end_date).slice(0, 10)}` : 'مدة المشروع غير مُسجَّلة كاملةً',
    },
    milestones: milestones.map((m) => ({
      id: m.id, title: m.name_ar, due_date: m.due_date ? String(m.due_date).slice(0, 10) : null,
      status: m.status, delivered: m.status !== 'PENDING',
    })),
    team: (staffing?.assigned || []).map((a) => ({
      employeeId: a.employee_id, name: a.person_name_ar || null, job_title: a.job_title || null, type: a.type || null,
    })),
    monthly_coverage: {
      months: months.map((m) => ({ month: m, total_pct: coverage[m] })),
      uncovered_months: uncovered,
      note_ar: uncovered.length ? `أشهرٌ بلا أحدٍ مُسكَّن: ${uncovered.join('، ')} — عملٌ مخطَّطٌ بلا من ينفّذه.` : 'كل شهرٍ مسجَّل عليه تسكين.',
      units_ar: 'النسبة مجموع نسب المسكَّنين من طاقاتهم — لا وحدات دوام كامل',
    },
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([REF.project(pid), row.client_id ? REF.client(row.client_id) : null]),
  });
}

// ── sanad_get_project_milestones ────────────────────────────────────────────────────────
async function runGetMilestones(ctx, raw) {
  const user = ctx.user;
  const pid = text(inputOf(raw).projectId, 'معرّف المشروع', { required: true, max: 80 });
  const today = riyadhDate();
  await getProject(user, pid); // الحارس أولاً — لا معالم لمشروعٍ خارج النطاق
  const rows = await all(
    `SELECT id, name_ar, due_date, status, created_at FROM milestone
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY (due_date IS NULL), due_date, created_at`, [pid]);
  // «بُني عليه مستخلص»: المستخلص في سند فاتورةٌ نوعُها `progress_claim`، وبنودُها تشير إلى
  // **المخرجات** لا إلى المعالم. فالمعلَم يُعدّ مبنيّاً عليه مستخلصٌ متى دخل أحدُ مخرجاته في
  // بند مستخلصٍ قائم — وهذا ربطٌ حقيقي في البيانات لا استنتاجٌ من التسمية.
  const claims = await all(
    `SELECT d.milestone_id AS mid, COUNT(DISTINCT i.id) n
       FROM invoice i
       JOIN invoice_line il ON il.invoice_id = i.id
       JOIN deliverable d ON d.id = il.deliverable_id AND d.deleted_at IS NULL
      WHERE i.kind = 'progress_claim' AND i.deleted_at IS NULL AND i.status <> 'CANCELLED'
        AND d.project_id = ? AND d.milestone_id IS NOT NULL
      GROUP BY d.milestone_id`, [pid]);
  const claimed = Object.fromEntries((claims || []).map((c) => [c.mid, Number(c.n) || 0]));
  return envelope('sanad_get_project_milestones', {
    scope_ar: scopeArOf(user), units: { days_ar: UNIT_NOTES.days_ar, money_ar: 'لا قيم مالية في هذه النتيجة' },
    milestones: rows.map((m) => {
      const due = m.due_date ? String(m.due_date).slice(0, 10) : null;
      return {
        id: m.id, title: m.name_ar,
        due_date: due,
        status: m.status, delivered: m.status !== 'PENDING',
        overdue: !!(due && m.status === 'PENDING' && due < today),
        has_progress_claim: (claimed[m.id] || 0) > 0,
        claims_count: claimed[m.id] || 0,
      };
    }),
    partial: null,
    basis_ar: '«بُني عليه مستخلص» تعني وجود مطالبة مالية مرتبطة بهذا المعلَم — لا أن المستخلص اعتُمد.',
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([REF.project(pid)]),
  });
}

// ── السجل ───────────────────────────────────────────────────────────────────────────────
const readsProjects = (u) => !!u && (u.role_id === 'admin' || can(u, 'read', 'project'));

export const PMO_TOOLS = Object.freeze([
  {
    name: 'sanad_list_projects', label_ar: 'قائمة المشاريع', kind: 'read',
    description_ar: 'مشاريع نطاق الحساب بحالتها الصحية (على المسار · في خطر · حرج)، مع نسبة الإنجاز محسوبةً من المخرجات المعتمدة، ونسبة الصرف، والفجوة بينهما بنقاطٍ مئوية، والمعلَم القادم وهل هو مستحق هذا الأسبوع، ومدير المشروع. ترقيم كامل. نسبة الصرف والفجوة تُقرآن لمن يفتح بوابة المال وحده، ومن لا يفتحها يقرأ «غير مُسجَّل» مع سبب الحجب.',
    input: obj({
      sector: S.str('القطاع — يضيّق داخل نطاقك فقط', { maxLength: 60 }),
      status: S.en('حالة المشروع', STATUSES),
      health: S.en('حالة الصحة', ['GREEN', 'AMBER', 'RED']),
      year: S.int('السنة', 2000, 2100),
      activeOnly: S.bool('القائم وحده (الافتراضي: نعم) — اجعلها false لإدراج المكتمل والملغى'),
      ...PAGE_PROPS,
    }),
    output_ar: 'قائمة مرقَّمة بالكامل؛ نسبة الإنجاز من المخرجات لا من عمود مخزَّن؛ الفجوة موجبةً تعني أن الصرف يسبق العمل',
    allow: readsProjects, run: runListProjects,
  },
  {
    name: 'sanad_get_project', label_ar: 'تفاصيل مشروع', kind: 'read',
    description_ar: 'مشروع واحد: خطة مقابل فعلي (الإنجاز والصرف والمدة)، والمعالم بحالة تسليمها، والفريق المُسكَّن بمسمّياته، والتغطية الشهرية مع تسمية كل شهر بلا أحدٍ مُسكَّن، والمالية **رقمين منفصلين لا مجموعاً**: قيمة العقد كما وُقِّع، والإيراد المُثبت من بنود الإيراد. الرقمان يُعرضان لمن يفتح بوابة المال وحده.',
    input: obj({ projectId: S.str('معرّف المشروع', { maxLength: 80 }) }, ['projectId']),
    output_ar: 'مشروع واحد بخطته وفعليه ومعالمه وفريقه وتغطيته الشهرية؛ قيمة العقد والإيراد المُثبت رقمان لا يُجمعان',
    allow: readsProjects, run: runGetProject,
  },
  {
    name: 'sanad_get_project_milestones', label_ar: 'معالم مشروع', kind: 'read',
    description_ar: 'معالم مشروع بمواعيدها وحالة تسليمها، ومتأخّرها معلَّماً، وأيُّها بُني عليه مستخلصٌ مالي (وجود مطالبة مرتبطة به — لا أنها اعتُمدت). بلا قيم مالية.',
    input: obj({ projectId: S.str('معرّف المشروع', { maxLength: 80 }) }, ['projectId']),
    output_ar: 'قائمة المعالم كاملةً (بلا ترقيم) بحالة كلٍّ وتأخّره وارتباطه بمستخلص',
    allow: readsProjects, run: runGetMilestones,
  },
]);
