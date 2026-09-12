// أدوات معرفة المنصة — ما يجعل المساعد يعرف سنداً نفسه لا سجلات العمل وحدها.
//
// الفرق عن أدوات «الفريق والموارد»: تلك تقرأ **سجلات** الشركة، وهذه تقرأ **وصف المنتج**
// (الشاشات وأغراضها وخطواتها ومصطلحاتها وحدود ما يقيسه) من مصدر الدليل نفسه الذي يقرؤه
// الموظف على شاشته — فلا نصٌّ ثانٍ يوصف به المنتج ويشيخ وحده.
//
// وكلها قراءة صرفة ومحكومة بالحساب: `guideFor` تعيد الشاشات التي يفتحها هذا الموظف فعلاً،
// فلا يتعلّم المساعد من الدليل وجود شاشةٍ لا يملكها صاحبه، ولا يُسمّي له بياناً لا يصل إليه.
import { get } from '../../core/db/index.js';
import { guideFor, tourFor, capsOf } from '../guide/guide.js';
import * as C from '../../core/guide/content.js';
import { PAGE_ACCESS } from '../../core/policy/pages.js';
import { badRequest } from '../../core/http/errors.js';
import { nowIso } from '../../core/util/ids.js';

const S = {
  str: (description, extra = {}) => ({ type: 'string', description, ...extra }),
};
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

// وصف الاتساع بالعربية — نفس تصنيف الدليل، فلا يخترع المساعد وصفاً لنطاقٍ لا يملكه.
const SIGHT_AR = [
  ['companySight', 'الشركة كلها'],
  ['sectorSight', 'قطاعك'],
  ['departmentSight', 'إدارتك وأهلها'],
  ['officeSight', 'مهام مكتب الرئيس التنفيذي'],
  ['narrowSight', 'عملك ومشاريعك'],
];
// القدرات كما تُقال لإنسان: مفتاح الدليل ⇒ جملة عربية. ما لا يملكه لا يُذكر أصلاً.
const CAP_AR = {
  teamTasks: 'يفتح مهام فريقه', approve: 'يعتمد ما يُرفع إليه', exportReports: 'ينشر التقارير ويصدّرها',
  editOrg: 'يبني الهيكل التنظيمي', editPeople: 'يضيف الأشخاص ويعدّل بياناتهم', manageStaffing: 'يعدّل التسكين',
  mergeClients: 'يدمج الجهات المكرَّرة', financeSight: 'يقرأ العقود والفواتير', writeFinance: 'يكتب في دورة المال',
  seeCost: 'يقرأ التكلفة', seeMargin: 'يقرأ الهامش', createOpp: 'ينشئ الفرص', createProject: 'ينشئ المشاريع',
  importWrite: 'يستورد البيانات', isAdmin: 'مدير النظام',
};

const base = (tool) => ({ tool, as_of: nowIso() });

// جدولان لا غير، بأسمائهما الصريحة: لا اسم جدولٍ يأتي من وسيطٍ مهما بدا ثابتاً اليوم.
const NAME_QUERY = {
  sector: 'SELECT name_ar FROM sector WHERE id = ?',
  department: 'SELECT name_ar FROM department WHERE id = ?',
};
async function nameOf(table, rowId) {
  if (!rowId || !NAME_QUERY[table]) return null;
  const r = await get(NAME_QUERY[table], [rowId]);
  return r?.name_ar || null;
}

/** «من أنا في سند» — الهوية والدور والاتساع وما يستطيعه، كما يقرؤها الدليل لا كما يُخمَّن. */
async function runWhoAmI(ctx) {
  const user = ctx.user;
  const caps = capsOf(user);
  const guide = await guideFor(user);
  const sight = SIGHT_AR.find(([k]) => caps[k]);
  const departments = [];
  for (const d of user.departmentIds || []) {
    const n = await nameOf('department', d);
    if (n) departments.push(n);
  }
  return {
    ...base('sanad_whoami'),
    scope_ar: sight ? sight[1] : 'عملك',
    account: {
      name_ar: user.name_ar || user.username,
      role_ar: guide.role.name_ar,
      sector_ar: await nameOf('sector', user.sector_id),
      departments_ar: departments,
      manages_departments: (user.managedDepartmentIds?.size ?? (user.managedDepartmentIds || []).length) > 0,
      linked_to_employee: !!user.employee_id,
    },
    can_ar: Object.entries(CAP_AR).filter(([k]) => caps[k]).map(([, label]) => label),
    intro_ar: guide.intro_ar,
    pages_ar: guide.pages.map((p) => p.nav_ar),
    limits_ar: guide.limits_ar,
    data_quality: [],
    refs: [{ kind: 'page', id: 'guide', href: '/app/guide' }],
    partial: null,
  };
}

/** دليل المنصة لهذا الحساب: الشاشات بأغراضها وخطواتها ومحاذيرها، أو شاشة واحدة بتفصيلها. */
async function runPlatformGuide(ctx, input = {}) {
  const user = ctx.user;
  const key = String(input.page || '').trim();
  const guide = await guideFor(user);
  if (!key) {
    return {
      ...base('sanad_platform_guide'),
      scope_ar: 'الشاشات التي يفتحها حسابك',
      role_ar: guide.role.name_ar,
      intro_ar: guide.intro_ar,
      pages: guide.pages.map((p) => ({
        key: p.key, nav_ar: p.nav_ar, purpose_ar: p.purpose_ar,
        first_steps_ar: p.first_steps_ar, weekly_ar: p.weekly_ar, watch_out_ar: p.watch_out_ar,
        href: `/app/${p.key === 'home' ? '' : p.key}`,
      })),
      glossary: guide.glossary,
      limits_ar: guide.limits_ar,
      scenarios: guide.scenarios,
      data_quality: ['الدليل يصف المنتج لا بيانات الشركة؛ الأرقام تُقرأ من أدوات السجلات.'],
      refs: [{ kind: 'page', id: 'guide', href: '/app/guide' }],
      partial: null,
    };
  }
  if (!Object.prototype.hasOwnProperty.call(C.PAGES, key)) {
    throw badRequest('لا توجد شاشة بهذا المفتاح — اطلب الدليل بلا مفتاح لترى شاشاتك المتاحة');
  }
  // شاشةٌ خارج صلاحيته: نقول «خارج صلاحيتك» بلا وصفها — وجودُ الوصف نفسه معلومة.
  const opens = typeof PAGE_ACCESS[key] === 'function' ? !!PAGE_ACCESS[key](user) : false;
  if (!opens) {
    return { ...base('sanad_platform_guide'), scope_ar: 'شاشاتك', page: null,
      note_ar: 'هذه الشاشة خارج صلاحية حسابك؛ اطلب الدليل بلا مفتاح لترى شاشاتك.',
      data_quality: [], refs: [], partial: null };
  }
  const page = C.guidePage(key, capsOf(user));
  return {
    ...base('sanad_platform_guide'),
    scope_ar: 'شاشة واحدة',
    page: { ...page, href: `/app/${key === 'home' ? '' : key}` },
    tour: tourFor(user, key),
    glossary: C.termsForPages([key], capsOf(user)),
    data_quality: [],
    refs: [{ kind: 'page', id: key, href: `/app/${key === 'home' ? '' : key}` }],
    partial: null,
  };
}

/** معنى مصطلح في سند بلغة العمل — يبحث في كل المصطلحات لا في مصطلحات شاشاته وحدها. */
async function runExplainTerm(ctx, input = {}) {
  const q = String(input.term || '').trim();
  if (q.length < 2) throw badRequest('اكتب المصطلح المطلوب شرحه (حرفان فأكثر)');
  const norm = (s) => String(s || '').replace(/[ً-ْ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').toLowerCase();
  const needle = norm(q);
  // بحدود قدرات القارئ: مصطلحا التكلفة والهامش محجوبان في شاشة «دليلي» عمّن لا يقرؤهما،
  // فلا يفتحهما له المساعد من الباب الخلفي. نفس مرشِّح `termsForPages`.
  const caps = capsOf(ctx.user);
  const visible = ([, t]) => !t.cap || caps[t.cap];
  const hits = Object.entries(C.TERMS)
    .filter(visible)
    .filter(([k, t]) => norm(t.term_ar).includes(needle) || needle.includes(norm(t.term_ar)) || k.toLowerCase() === needle)
    .slice(0, 8)
    .map(([, t]) => ({ term_ar: t.term_ar, meaning_ar: t.meaning_ar }));
  return {
    ...base('sanad_explain_term'),
    scope_ar: 'مصطلحات المنصة',
    query_ar: q,
    matches: hits,
    note_ar: hits.length ? null : 'لا مصطلح بهذا الاسم في معجم المنصة — قد يكون تسمية داخلية في فريقك لا في سند.',
    data_quality: [],
    refs: [{ kind: 'page', id: 'guide', href: '/app/guide' }],
    partial: null,
  };
}

export const GUIDE_TOOLS = [
  {
    name: 'sanad_whoami', label_ar: 'من أنا في سند', kind: 'read',
    description_ar: 'هوية صاحب الحساب في سند: اسمه ودوره وقطاعه وإداراته، واتساع ما يقرؤه (الشركة/القطاع/الإدارة/عمله)، وما يستطيع فعله، والشاشات التي يفتحها، وحدود ما تقيسه المنصة. ابدأ بها قبل أي سؤال عن البيانات كي تعرف نطاق من تتحدث باسمه.',
    input: obj({}),
    output_ar: 'الدور والاتساع والقدرات والشاشات وحدود القياس — بلا بيانات عمل',
    allow: (u) => !!u, run: runWhoAmI,
  },
  {
    name: 'sanad_platform_guide', label_ar: 'دليل المنصة', kind: 'read',
    description_ar: 'دليل سند لهذا الحساب: شاشاته بأغراضها وخطواتها الأولى وأعمالها الأسبوعية ومحاذيرها، ومعجم مصطلحاته، وحدود ما لا تقيسه المنصة. وبمفتاح شاشة يعيد تلك الشاشة وحدها بجولتها. يصف المنتج لا بيانات الشركة.',
    input: obj({ page: S.str('مفتاح الشاشة (اختياري) — مثل projects أو sector-targets', { maxLength: 40 }) }),
    output_ar: 'وصف الشاشات وخطواتها ومصطلحاتها وحدودها؛ الشاشة خارج الصلاحية تُقال بلا وصفها',
    allow: (u) => !!u, run: runPlatformGuide,
  },
  {
    name: 'sanad_explain_term', label_ar: 'معنى مصطلح', kind: 'read',
    description_ar: 'معنى مصطلح من معجم سند بلغة العمل (القيمة المرجّحة، الخطوة التالية، المخرَج، التسكين، الإيراد المعترف به…). للسؤال عن معنى كلمة في المنصة قبل تفسير رقم يحملها.',
    input: obj({ term: S.str('المصطلح المطلوب شرحه', { minLength: 2, maxLength: 60 }) }, ['term']),
    output_ar: 'المصطلح ومعناه؛ وإن لم يوجد قيل ذلك صراحةً',
    allow: (u) => !!u, run: runExplainTerm,
  },
];
