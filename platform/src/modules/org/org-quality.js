// جودة بيانات الهيكل التنظيمي — خدمة **تشخيص فقط**: تكشف وتقترح، ولا تصلح شيئاً تلقائياً.
// القرار للمالك: إعادة تسمية إدارة أو نقل موظف أو إسناد مشروع كلها قرارات بشرية تمر بخدمات
// org.js القائمة (بتدقيقها الكامل). هذا الملف لا يكتب صفاً واحداً ولا يكتب سطر تدقيق، لأنه لا
// يغيّر شيئاً — التخمين الصامت أسوأ من الفراغ الظاهر.
//
// الفحوصات الثمانية (كلها بنفس صلاحية قراءة الهيكل ونفس نطاقها):
//   ١ موظفون خارج أي إدارة — بالعدد وبالقطاع.
//   ٢ إدارات باسم غير عربي داخل واجهة عربية بالكامل + اقتراح اسم عربي لكل واحدة.
//   ٣ إدارة تحمل اسم قطاعها نفسه («الحلول» داخل «قطاع الحلول») — التباس تسمية.
//   ٤ إدارات بصفر موظفين — مهجورة أو ناقصة التعبئة.
//   ٥ قطاعات بلا أي إدارة — الطبقة الوسطى غير ممثَّلة.
//   ٦ أعمال بلا إدارة (مشاريع وفرص وتسكين) — يعمل تلقائياً متى وُجدت خانة الإدارة على الجدول،
//     ويُعلَن «فحص مؤجَّل» بأمان قبلها (نفحص وجود الخانة قبل الاستعلام عنها، فلا ينكسر شيء اليوم).
//   ٧ إدارات بلا مسؤول معيَّن — لا أحد يستلم ما يخصها.
//   ٨ فرص بلا قطاع إطلاقاً — خارج مبيعات القطاعات كلها (يُقاس على مستوى الشركة).
//
// للتقرير عرضان على **نفس القراءات ونفس الأرقام** (إسقاطان لا مصدران للحقيقة):
//   • findings/pending — نتيجة لكل فجوة ولكل قطاع، بتفاصيلها واقتراحها.
//   • score/checks/summary — «درجة اكتمال» واحدة يقرأها المالك، وبند واحد لكل فئة مهما تعدّدت
//     قطاعاتها. الرقم يتحرك حين تُغلق فئة كاملة، لا مع كل صف — انظر أسفل الملف.
import { all, get } from '../../core/db/index.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { badRequest, forbidden } from '../../core/http/errors.js';
import { nowIso } from '../../core/util/ids.js';
import { config } from '../../core/config.js';
import { normName } from './org.js';

// ── الشدّة ──
export const WARN = 'تحذير';   // فجوة تُفسد تجميعاً أو تخالف قاعدة معلنة
export const NOTE = 'ملاحظة';  // إشارة تستحق مراجعة، لا عطل

// ── صيغ العدد بالعربية (مفرد/مثنى/جمع قلة/جمع كثرة) ──
const FORMS = {
  employee: { one: 'موظف واحد', two: 'موظفان', few: 'موظفين', many: 'موظفاً' },
  department: { one: 'إدارة واحدة', two: 'إدارتان', few: 'إدارات', many: 'إدارة' },
  sector: { one: 'قطاع واحد', two: 'قطاعان', few: 'قطاعات', many: 'قطاعاً' },
  project: { one: 'مشروع واحد', two: 'مشروعان', few: 'مشاريع', many: 'مشروعاً' },
  opportunity: { one: 'فرصة واحدة', two: 'فرصتان', few: 'فرص', many: 'فرصة' },
  allocation: { one: 'تسكين واحد', two: 'تسكينان', few: 'تسكينات', many: 'تسكيناً' },
  note: { one: 'ملاحظة واحدة', two: 'ملاحظتان', few: 'ملاحظات', many: 'ملاحظة' },
};
export function countPhrase(n, form) {
  const f = FORMS[form] || FORMS.employee;
  if (n === 1) return f.one;
  if (n === 2) return f.two;
  const r = n % 100;
  return `${n} ${r >= 3 && r <= 10 ? f.few : f.many}`;
}
const nameList = (items, cap = 3) => {
  const shown = items.slice(0, cap).map((i) => `«${i.name_ar}»`).join('، ');
  return items.length > cap ? `${shown} وغيرها` : shown;
};

// ── تعريب الأسماء: هل الاسم عربي أصلاً؟ وما الاسم العربي المقترح؟ ──
const ARABIC_LETTER = /[؀-ۿݐ-ݿ]/;
export const isArabicName = (s) => ARABIC_LETTER.test(String(s == null ? '' : s));

// مفتاح لاتيني مبسَّط: حروف وأرقام فقط، بمسافة واحدة، بحروف صغيرة («Ai&Data» ⟵ «ai data»).
const latinKey = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// عبارات كاملة أولاً (ترتيب الكلمات في العربية يختلف عن الإنجليزية، فالترجمة كلمةً كلمة تقلبه).
const PHRASES = {
  'ai data': 'الذكاء الاصطناعي والبيانات',
  'ai and data': 'الذكاء الاصطناعي والبيانات',
  'data ai': 'البيانات والذكاء الاصطناعي',
  'smart cities': 'المدن الذكية',
  'business development': 'تطوير الأعمال',
  'project management office': 'مكتب إدارة المشاريع',
  pmo: 'مكتب إدارة المشاريع',
  'human resources': 'الموارد البشرية',
  'information technology': 'تقنية المعلومات',
  'research and development': 'البحث والتطوير',
  'r d': 'البحث والتطوير',
  'data science': 'علم البيانات',
  'digital solutions': 'الحلول الرقمية',
  'digital transformation': 'التحول الرقمي',
  'quality assurance': 'ضمان الجودة',
  'customer experience': 'تجربة العميل',
  'shared services': 'الخدمات المشتركة',
  'supply chain': 'سلسلة الإمداد',
};
// ثم كلمة كلمة (تُوصل بـ«و» على ترتيبها) — لا نقترح إلا إذا عُرفت كل الكلمات، كي لا نضع
// اسماً نصفه مترجم فيثبّت خطأً في بيانات دائمة.
const TERMS = {
  ai: 'الذكاء الاصطناعي', data: 'البيانات', analytics: 'التحليلات', innovation: 'الابتكار',
  solutions: 'الحلول', consulting: 'الاستشارات', strategy: 'الاستراتيجية', strategic: 'الاستراتيجية',
  projects: 'المشاريع', project: 'المشاريع', delivery: 'التسليم', operations: 'العمليات',
  quality: 'الجودة', finance: 'المالية', hr: 'الموارد البشرية', it: 'تقنية المعلومات',
  sales: 'المبيعات', marketing: 'التسويق', procurement: 'المشتريات', legal: 'الشؤون القانونية',
  training: 'التدريب', support: 'الدعم', governance: 'الحوكمة', engineering: 'الهندسة',
  design: 'التصميم', research: 'البحث', development: 'التطوير', product: 'المنتجات',
  cloud: 'الحوسبة السحابية', cities: 'المدن', smart: 'الذكية', digital: 'الرقمنة',
};

// نضيف لقب «إدارة» إلا إذا كان الاسم المقترح يبدأ بلقب أصلاً («مكتب إدارة المشاريع»).
const withHead = (ar) => (/^(إدارة|مكتب|وحدة|قسم) /.test(ar) ? ar : `إدارة ${ar}`);

// يقترح اسماً عربياً للإدارة، أو نصاً فارغاً إن لم نكن واثقين (فيبقى الاقتراح عاماً).
export function suggestArabicName(name) {
  const key = latinKey(name);
  if (!key) return '';
  const phrase = PHRASES[key];
  if (phrase) return withHead(phrase);
  const parts = key.split(' ').map((w) => TERMS[w]);
  if (!parts.length || parts.some((p) => !p)) return '';
  return withHead(parts.join(' و'));
}

// ── التباس التسمية: مقارنة اسم الإدارة باسم قطاعها بعد نزع الألقاب العامة وأداة التعريف ──
const GENERIC_HEADS = ['قطاع', 'اداره', 'وحده', 'قسم', 'مجموعه'];
export function bareName(s) {
  let t = normName(s);
  for (let again = true; again;) {
    again = false;
    for (const head of GENERIC_HEADS) {
      if (t.startsWith(`${head} `)) { t = t.slice(head.length + 1); again = true; }
    }
  }
  return t.startsWith('ال') ? t.slice(2) : t;
}

// ── وجود خانة في جدول (لتحمّل غياب «الإدارة» على المشروع والفرصة قبل تطبيق الترحيلة) ──
// نسأل فهرس المحرّك قبل كل استعلام، بلا أي تخزين مؤقت: قاعدة لم تُطبَّق عليها الترحيلة بعد تعطي
// «فحص مؤجَّل» بدل انكسار، وبمجرد تطبيقها يبدأ الفحص تلقائياً بلا إعادة تشغيل ولا تعديل كود.
// استعلامان صغيران لكل تقرير — ثمن زهيد مقابل تقرير لا يكذب ولا ينكسر.
async function hasColumn(table, column) {
  try {
    const row = config.databaseUrl
      ? await get('SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = CURRENT_SCHEMA() AND table_name = ? AND column_name = ? LIMIT 1', [table, column])
      : await get('SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = ? LIMIT 1', [table, column]);
    return !!row;
  } catch {
    return false; // جدول غير موجود أو فهرس لا يقرؤه المحرّك ⟵ الفحص يبقى مؤجَّلاً بأمان
  }
}

// ── الصلاحية والنطاق ──
// نفس بوابة orgTree حرفياً: من يرى الشجرة يرى تقرير جودتها، ولا أحد سواه.
const mayReadOrg = (user) => !!user
  && (user.role_id === 'admin' || can(user, 'read', 'employee') || can(user, 'create', 'sector'));

// النطاق مبني على المنح لا على وصف الحساب: منح «قراءة الموظفين» على مستوى الشركة ⟵ كل القطاعات
// (مع إمكانية الترشيح)، وما دونه ⟵ قطاع صاحب الحساب وحده. حساب بلا قطاع وبلا نطاق شركة يُرفض
// صراحةً بدل أن يرى كل شيء بالخطأ.
function reportScope(user, opts = {}) {
  const wide = user.role_id === 'admin' || effectiveScope(user, 'read', 'employee') === 'company';
  // اسمان لمعنى واحد: sector (الاسم القائم في الرابط) و sectorId (اسم الحقل في عرض الدرجة).
  // الترشيح قادم من الرابط ⟵ نُلزمه أن يكون نصاً واحداً، وإلا صار خطأ ربط قيمة (٥٠٠) بدل رسالة مفهومة
  const asked = opts.sectorId == null || opts.sectorId === '' ? opts.sector : opts.sectorId;
  const wanted = asked == null || asked === '' ? null : String(asked);
  if (wide) return { sector: wanted, wide: true };
  if (!user.sector_id)
    throw forbidden('حسابك غير مرتبط بأي قطاع — اطلب من الموارد البشرية ربط حسابك بقطاعك ثم أعد المحاولة');
  return { sector: user.sector_id, wide: false };
}

const ITEM_CAP = 50; // سقف عناصر التفاصيل في كل نتيجة — العدد الحقيقي يبقى في count
const finding = (f) => ({
  level: f.severity === WARN ? 'warn' : 'note',
  items: [],
  items_capped: false,
  items_hidden: false,
  suggested_name_ar: '',
  ...f,
});

// أسماء الأعمال (مشروع/فرصة/تسكين) تُدرَج فقط لمن يملك قراءة ذلك المورد أصلاً: تقرير الجودة
// لا يفتح باباً جانبياً على سجلات لا يراها صاحبه في صفحتها. أما العدد فيبقى ظاهراً للجميع لأنه
// معلومة حوكمة عن اكتمال الهيكل لا عن العمل نفسه (ولا مال فيه ولا حقل حساس).
const mayListWork = (user, resource) => can(user, 'read', resource);

// ترتيب ثابت: التحذيرات أولاً، ثم حسب أهمية النوع، ثم الأكبر عدداً — كي يقرأ المالك الأهم أولاً
// وتكون النتيجة قابلة للاختبار.
const TYPE_ORDER = ['employees_without_department', 'projects_without_department',
  'opportunities_without_department', 'opportunity_without_sector', 'department_name_not_arabic',
  'sector_without_departments', 'department_name_same_as_sector', 'department_without_employees',
  'department_without_manager'];
const orderOf = (t) => { const i = TYPE_ORDER.indexOf(t); return i < 0 ? TYPE_ORDER.length : i; };

/**
 * تقرير جودة الهيكل التنظيمي — قراءة خالصة.
 * @param {object} user المستخدم الحالي (نفس صلاحية عرض الهيكل).
 * @param {object} [opts] { sector } ترشيح بقطاع لمن نطاقه الشركة كلها.
 */
export async function orgHealth(user, opts = {}) {
  if (!mayReadOrg(user)) throw forbidden('عرض فحص جودة الهيكل التنظيمي يتطلب صلاحية إدارية — راجع مدير النظام');
  const { sector, wide } = reportScope(user, opts);
  const secWhere = sector ? 'AND sector_id = ?' : '';
  const secParams = sector ? [sector] : [];

  const sectors = await all(
    `SELECT id, name_ar FROM sector WHERE deleted_at IS NULL ${sector ? 'AND id = ?' : ''} ORDER BY sort_order, name_ar`,
    secParams);
  if (sector && !sectors.length) {
    throw wide
      ? badRequest('القطاع المطلوب غير موجود — اختر قطاعاً من القائمة ثم أعد المحاولة')
      : badRequest('قطاع حسابك لم يعد موجوداً — راجع الموارد البشرية لتحديث قطاعك ثم أعد المحاولة');
  }
  const sectorName = new Map(sectors.map((s) => [s.id, s.name_ar]));
  const nameOfSector = (sid) => sectorName.get(sid) || 'بلا قطاع';

  const departments = await all(
    `SELECT id, sector_id, name_ar, name_en, active, manager_user_id FROM department
      WHERE deleted_at IS NULL ${sector ? 'AND sector_id = ?' : ''} ORDER BY sector_id, name_ar`,
    secParams);

  // عدد الموظفين لكل إدارة — التجميع على إدارة الموظف، والنطاق على قطاع الإدارة نفسها
  // (لا على قطاع الموظف)، وإلا اختفى من العدّ موظفٌ قطاعه مخالف لقطاع إدارته.
  const depCountRows = await all(
    `SELECT e.department_id AS department_id, COUNT(*) AS n
       FROM employee e JOIN department d ON d.id = e.department_id AND d.deleted_at IS NULL
      WHERE e.deleted_at IS NULL ${sector ? 'AND d.sector_id = ?' : ''}
      GROUP BY e.department_id`,
    secParams);
  const depEmployees = new Map(depCountRows.map((r) => [r.department_id, Number(r.n) || 0]));

  const sectorCountRows = await all(
    `SELECT sector_id, COUNT(*) AS n FROM employee
      WHERE deleted_at IS NULL ${secWhere} GROUP BY sector_id`,
    secParams);
  const sectorEmployees = new Map(sectorCountRows.map((r) => [r.sector_id, Number(r.n) || 0]));

  const findings = [];
  const pending = [];

  // ── ١ موظفون خارج أي إدارة (نتيجة لكل قطاع: العدد والقطاع معاً) ──
  const orphans = await all(
    `SELECT id, name_ar, sector_id FROM employee
      WHERE deleted_at IS NULL AND (department_id IS NULL OR department_id = '') ${secWhere}
      ORDER BY name_ar`,
    secParams);
  const orphansBySector = new Map();
  for (const e of orphans) {
    const k = e.sector_id || '';
    if (!orphansBySector.has(k)) orphansBySector.set(k, []);
    orphansBySector.get(k).push(e);
  }
  for (const [sid, list] of orphansBySector) {
    const sName = sid ? nameOfSector(sid) : 'بلا قطاع';
    const total = sectorEmployees.get(sid || null) || 0; // إجمالي القطاع — لتُقرأ النسبة لا الرقم وحده
    findings.push(finding({
      type: 'employees_without_department',
      severity: WARN,
      title: 'موظفون خارج أي إدارة',
      sector_id: sid || null,
      sector_name_ar: sName,
      count: list.length,
      message: `${countPhrase(list.length, 'employee')} في «${sName}» بلا إدارة${total > list.length ? ` من أصل ${countPhrase(total, 'employee')}` : ''}`
        + ' — لا يظهرون تحت أي فرع في الشجرة ولا يدخلون في أي تجميع على مستوى الإدارة',
      suggestion: 'افتح شجرة الهيكل وانقل كل واحد منهم إلى إدارته الصحيحة — بعدها يصير مجموع الإدارات مساوياً لإجمالي القطاع',
      items: list.slice(0, ITEM_CAP).map((e) => ({ id: e.id, name_ar: e.name_ar, sector_id: e.sector_id || null, sector_name_ar: sName })),
      items_capped: list.length > ITEM_CAP,
    }));
  }

  // ── ٢ أسماء إدارات بغير العربية + اقتراح اسم عربي لكل واحدة ──
  const foreign = departments.filter((d) => !isArabicName(d.name_ar));
  if (foreign.length) {
    const items = foreign.slice(0, ITEM_CAP).map((d) => ({
      id: d.id, name_ar: d.name_ar, name_en: d.name_en || d.name_ar,
      sector_id: d.sector_id, sector_name_ar: nameOfSector(d.sector_id),
      suggested_name_ar: suggestArabicName(d.name_ar),
    }));
    const first = items.find((i) => i.suggested_name_ar);
    findings.push(finding({
      type: 'department_name_not_arabic',
      severity: WARN,
      title: 'أسماء إدارات بغير العربية',
      count: foreign.length,
      message: `${countPhrase(foreign.length, 'department')} اسمها مكتوب بغير العربية داخل واجهة عربية بالكامل: ${nameList(foreign)}`,
      suggested_name_ar: first ? first.suggested_name_ar : '',
      suggestion: first
        ? `أعد التسمية بالعربية من شجرة الهيكل (مقترح لـ«${first.name_ar}»: ${first.suggested_name_ar})، واحفظ الاسم الأجنبي في خانة الاسم بالإنجليزية فلا تفقد شيئاً`
        : 'أعد التسمية بالعربية من شجرة الهيكل باسم يصف عمل الإدارة، واحفظ الاسم الأجنبي في خانة الاسم بالإنجليزية فلا تفقد شيئاً',
      items,
      items_capped: foreign.length > ITEM_CAP,
    }));
  }

  // ── ٣ إدارة تحمل اسم قطاعها نفسه ──
  const twins = departments.filter((d) => {
    const dep = bareName(d.name_ar);
    const sec = bareName(sectorName.get(d.sector_id) || '');
    return !!dep && !!sec && dep === sec;
  });
  if (twins.length) {
    const items = twins.slice(0, ITEM_CAP).map((d) => ({
      id: d.id, name_ar: d.name_ar, sector_id: d.sector_id, sector_name_ar: nameOfSector(d.sector_id),
      employees: depEmployees.get(d.id) || 0,
    }));
    const s = items[0];
    findings.push(finding({
      type: 'department_name_same_as_sector',
      severity: NOTE,
      title: 'إدارة تحمل اسم قطاعها',
      count: twins.length,
      message: `${countPhrase(twins.length, 'department')} تحمل اسم قطاعها نفسه (${s ? `«${s.name_ar}» داخل «${s.sector_name_ar}»` : ''})`
        + ' — الاسمان يظهران متطابقين في كل تقرير فلا يميّز القارئ بينهما',
      suggestion: 'راجع من فيها فعلاً ثم أعد تسميتها بما تُسلّمه (مثل «إدارة تسليم الحلول») — القرار قرارك، ولا تُعاد التسمية تلقائياً',
      items,
      items_capped: twins.length > ITEM_CAP,
    }));
  }

  // ── ٤ إدارات بصفر موظفين ──
  const empty = departments.filter((d) => !(depEmployees.get(d.id) || 0));
  if (empty.length) {
    findings.push(finding({
      type: 'department_without_employees',
      severity: NOTE,
      title: 'إدارات بلا موظفين',
      count: empty.length,
      message: `${countPhrase(empty.length, 'department')} بلا أي موظف (${nameList(empty)})`
        + ' — إما مهجورة وإما أن موظفيها لم يُربطوا بها بعد',
      suggestion: 'راجع كل واحدة: انقل إليها موظفيها من شجرة الهيكل إن كانت قائمة فعلاً، أو احذفها إن لم تعد كذلك',
      items: empty.slice(0, ITEM_CAP).map((d) => ({
        id: d.id, name_ar: d.name_ar, sector_id: d.sector_id,
        sector_name_ar: nameOfSector(d.sector_id), employees: 0,
      })),
      items_capped: empty.length > ITEM_CAP,
    }));
  }

  // ── ٥ قطاعات بلا أي إدارة ──
  const depsBySector = new Set(departments.map((d) => d.sector_id));
  const flat = sectors.filter((s) => !depsBySector.has(s.id));
  if (flat.length) {
    const items = flat.slice(0, ITEM_CAP).map((s) => ({
      id: s.id, name_ar: s.name_ar, sector_id: s.id, sector_name_ar: s.name_ar,
      employees: sectorEmployees.get(s.id) || 0,
    }));
    const peopled = items.filter((s) => s.employees > 0).length;
    findings.push(finding({
      type: 'sector_without_departments',
      severity: peopled ? WARN : NOTE,
      title: 'قطاعات بلا أي إدارة',
      count: flat.length,
      message: `${countPhrase(flat.length, 'sector')} بلا أي إدارة (${nameList(flat)})`
        + ' — الطبقة الوسطى غير ممثَّلة فيه، فلا يمكن تجميع أعماله ولا موظفيه على إداراته',
      suggestion: 'أضِف إدارة واحدة على الأقل لكل قطاع من شجرة الهيكل، ثم انقل إليها موظفيه — التقسيم الأدق يأتي لاحقاً',
      items,
      items_capped: flat.length > ITEM_CAP,
    }));
  }

  // ── ٦ أعمال بلا إدارة (مشاريع وفرص) — يعمل متى وُجدت خانة الإدارة، ويبقى مؤجَّلاً بأمان قبلها ──
  const WORK = [
    { table: 'project', type: 'projects_without_department', form: 'project', nameCol: 'name_ar',
      title: 'مشاريع بلا إدارة', kind_ar: 'المشاريع', resource: 'project',
      tail: ' — لا يظهر أي منها في تجميع الإدارات ولا في صفحة مدير الإدارة',
      suggestion: 'أسنِد كل مشروع إلى إدارته المسؤولة من صفحة الإدارات — الإسناد قرار بشري، والمنصة لا تخمّنه من اسم المشروع' },
    { table: 'opportunity', type: 'opportunities_without_department', form: 'opportunity', nameCol: 'title_ar',
      title: 'فرص بلا إدارة', kind_ar: 'الفرص', resource: 'opportunity',
      tail: ' — لا تُنسب إلى أي إدارة، فسؤال «ما فرص إدارتي» يبقى بلا إجابة',
      suggestion: 'أسنِد كل فرصة إلى إدارتها المسؤولة من صفحة الإدارات — الإسناد قرار بشري، والمنصة لا تخمّنه من عنوان الفرصة' },
  ];
  for (const w of WORK) {
    if (!(await hasColumn(w.table, 'department_id'))) {
      pending.push({
        type: w.type, title: w.title,
        note: `يبدأ هذا الفحص تلقائياً بعد إضافة خانة «الإدارة» إلى ${w.kind_ar}`,
      });
      continue;
    }
    const where = `deleted_at IS NULL AND (department_id IS NULL OR department_id = '') ${secWhere}`;
    const n = Number((await get(`SELECT COUNT(*) AS n FROM ${w.table} WHERE ${where}`, secParams)).n) || 0;
    if (!n) continue;
    const showNames = mayListWork(user, w.resource);
    const rows = showNames ? await all(
      `SELECT id, ${w.nameCol} AS name_ar, sector_id FROM ${w.table} WHERE ${where} ORDER BY ${w.nameCol}, id LIMIT ?`,
      [...secParams, ITEM_CAP]) : [];
    findings.push(finding({
      type: w.type,
      severity: WARN,
      title: w.title,
      count: n,
      message: `${countPhrase(n, w.form)} بلا إدارة مسؤولة${w.tail}`,
      suggestion: w.suggestion,
      items: rows.map((r) => ({
        id: r.id, name_ar: r.name_ar, sector_id: r.sector_id || null,
        sector_name_ar: nameOfSector(r.sector_id),
      })),
      items_capped: showNames && n > rows.length,
      items_hidden: !showNames,
    }));
  }

  // ── ٧ إدارات بلا مسؤول معيَّن ──
  const unmanaged = departments.filter((d) => !d.manager_user_id);
  if (unmanaged.length) {
    findings.push(finding({
      type: 'department_without_manager',
      severity: NOTE,
      title: 'إدارات بلا مسؤول',
      count: unmanaged.length,
      message: `${countPhrase(unmanaged.length, 'department')} بلا مسؤول معيَّن (${nameList(unmanaged)})`
        + ' — لا أحد يستلم تنبيهاتها ولا يُسأل عن أرقامها',
      suggestion: 'عيّن مسؤولاً لكل إدارة من شجرة الهيكل — عندها يصل ما يخصها إلى شخص بعينه لا إلى الفراغ',
      items: unmanaged.slice(0, ITEM_CAP).map((d) => ({
        id: d.id, name_ar: d.name_ar, sector_id: d.sector_id,
        sector_name_ar: nameOfSector(d.sector_id), employees: depEmployees.get(d.id) || 0,
      })),
      items_capped: unmanaged.length > ITEM_CAP,
    }));
  }

  // ── ٨ فرص بلا قطاع إطلاقاً ──
  // سؤال على مستوى الشركة بطبيعته: فرصة بلا قطاع لا تقع داخل نطاق أي قطاع، فقياسها تحت ترشيح
  // قطاع بعينه بلا معنى. تُقاس عند عرض الشركة كلها فقط، ويُعلَن ذلك صراحةً في عرض الدرجة.
  let strayOpportunities = null; // null ⟵ لم يُقَس (عرض قطاع واحد)
  if (!sector) {
    const rows = await all(
      'SELECT id, title_ar FROM opportunity WHERE deleted_at IS NULL AND sector_id IS NULL ORDER BY title_ar');
    strayOpportunities = rows.length;
    if (rows.length) {
      findings.push(finding({
        type: 'opportunity_without_sector',
        severity: WARN,
        title: 'فرص بلا قطاع',
        count: rows.length,
        message: `${countPhrase(rows.length, 'opportunity')} بلا قطاع إطلاقاً`
          + ' — لا تدخل في مبيعات أي قطاع ولا تصل إلى أي قائد قطاع',
        suggestion: 'حدّد القطاع المسؤول عن كل فرصة من صفحة الفرص — عندها تدخل في مبيعاته وتصل إلى قائده',
        items: mayListWork(user, 'opportunity') ? rows.slice(0, ITEM_CAP).map((o) => ({
          id: o.id, name_ar: o.title_ar, sector_id: null, sector_name_ar: 'بلا قطاع',
        })) : [],
        items_capped: mayListWork(user, 'opportunity') && rows.length > ITEM_CAP,
        items_hidden: !mayListWork(user, 'opportunity'),
      }));
    }
  }

  // ── التسكين بلا إدارة ──
  // يدخل بند «أعمال بلا إدارة» في عرض الدرجة وحده، ولا يُضاف إلى findings/pending كي يبقى عقدهما
  // كما هو حرفياً. عمود الإدارة على التسكين يصل مع نفس ترحيلة المشاريع والفرص، فيبدأ تلقائياً.
  let strayAllocations = null; // null ⟵ الخانة غير موجودة بعد ⟵ البند مؤجَّل
  if (await hasColumn('allocation', 'department_id')) {
    const where = `deleted_at IS NULL AND (department_id IS NULL OR department_id = '') ${secWhere}`;
    const showNames = mayListWork(user, 'allocation');
    strayAllocations = {
      count: Number((await get(`SELECT COUNT(*) AS n FROM allocation WHERE ${where}`, secParams)).n) || 0,
      items_hidden: !showNames,
      items: (showNames ? await all(
        `SELECT id, person_name_ar, project_name, sector_id FROM allocation WHERE ${where} ORDER BY id LIMIT ?`,
        [...secParams, ITEM_CAP]) : []).map((r) => ({
        id: r.id, name_ar: r.person_name_ar || r.project_name || 'تسكين',
        sector_id: r.sector_id || null, sector_name_ar: nameOfSector(r.sector_id),
      })),
    };
  }

  findings.sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === WARN ? -1 : 1)
    || (orderOf(a.type) - orderOf(b.type))
    || (b.count - a.count)
    || String(a.sector_name_ar || '').localeCompare(String(b.sector_name_ar || ''), 'ar'));

  const employeesTotal = [...sectorEmployees.values()].reduce((a, b) => a + b, 0);
  const totals = {
    sectors: sectors.length,
    departments: departments.length,
    employees: employeesTotal,
    employees_without_department: orphans.length,
    departments_without_employees: empty.length,
    departments_not_arabic: foreign.length,
    departments_named_like_sector: twins.length,
    sectors_without_departments: flat.length,
    departments_without_manager: unmanaged.length,
  };
  for (const f of findings) {
    if (f.type === 'projects_without_department') totals.projects_without_department = f.count;
    if (f.type === 'opportunities_without_department') totals.opportunities_without_department = f.count;
  }
  // لا رقم مخترع لما لم يُقَس: يظهر المفتاح فقط حين يُفحص فعلاً
  if (strayOpportunities != null) totals.opportunities_without_sector = strayOpportunities;
  if (strayAllocations) totals.allocations_without_department = strayAllocations.count;

  const report = {
    generated_at: nowIso(),
    sector,
    company_wide: wide,
    ok: findings.length === 0,
    counts: {
      total: findings.length,
      warnings: findings.filter((f) => f.severity === WARN).length,
      notes: findings.filter((f) => f.severity === NOTE).length,
    },
    totals,
    findings,
    pending,
  };
  // العرض التنفيذي: نفس النتائج مُسقَطة على درجة اكتمال واحدة وثمانية بنود قرار.
  return { ...report, ...scoreView({ report, sector, strayOpportunities, strayAllocations }) };
}

// ═════════════════════════════════════════════════════════════════════════════
// العرض التنفيذي: درجة اكتمال واحدة + ثمانية بنود قرار (score / checks / summary)
// إسقاط خالص على نتائج التقرير أعلاه — لا استعلام إضافي ولا رقم من مصدر ثانٍ. سبب وجوده:
// المالك يريد رقماً واحداً يتحرك وهو يُصلح، وبنداً واحداً لكل فئة مهما تعدّدت قطاعاتها؛ بينما
// findings تُفصّل الفجوة لكل قطاع على حدة لمن ينفّذ الإصلاح.
// ═════════════════════════════════════════════════════════════════════════════

// وزن الخصم لكل بند **يتحقق** — لا لكل صف متأثر. البند إما مفتوح أو مغلق، فيتحرك الرقم حين
// يُغلق المالك فئة كاملة. الخصم بعدد الصفوف كان سيجعل الدرجة صفراً دائماً (عشرات المشاريع
// بلا إدارة في أول يوم) فيفقد الرقم معناه ولا يعود يقيس تقدّماً.
export const SEVERITY_WEIGHT = { high: 8, medium: 4, low: 1 };
const SEVERITY_AR = { high: 'عاجل', medium: 'مهم', low: 'يمكن تأجيله' };

// الترتيب هو ترتيب العرض: الأشد أثراً على القرار أولاً.
const CHECK_SPEC = [
  { id: 'employees_without_department', severity: 'high', form: 'employee',
    title_ar: 'موظفون بلا إدارة',
    tail_ar: 'داخل القطاعات بلا إدارة — عملهم يُنسب إلى القطاع فقط ولا يصل إلى تقارير الإدارات',
    clean_ar: 'كل موظف في القطاع يتبع إدارة معروفة',
    fix_hint_ar: 'أسنِد هؤلاء الموظفين إلى إدارة داخل قطاعهم' },
  { id: 'work_without_department', severity: 'high', form: 'project',
    title_ar: 'أعمال بلا إدارة مسؤولة',
    tail_ar: 'بلا إدارة مسؤولة — لا يمكن قياس أداء أي إدارة',
    clean_ar: 'كل عمل مرتبط بالإدارة المسؤولة عنه',
    skip_ar: 'ربط الأعمال بالإدارات لم يُفعَّل بعد — يبدأ هذا البند تلقائياً بعد تفعيله',
    fix_hint_ar: 'حدّد الإدارة المسؤولة عن كل مشروع وفرصة وتسكين' },
  { id: 'sector_without_departments', severity: 'high', form: 'sector',
    title_ar: 'قطاعات بلا إدارات',
    tail_ar: 'بلا أي إدارة — والعمل بلا جهة مسؤولة تُنسب إليها',
    clean_ar: 'كل قطاع تحته إدارة واحدة على الأقل',
    fix_hint_ar: 'أنشئ إدارة واحدة على الأقل في كل قطاع ثم وزّع موظفيه عليها' },
  { id: 'opportunity_without_sector', severity: 'high', form: 'opportunity',
    title_ar: 'فرص بلا قطاع',
    tail_ar: 'بلا قطاع — خارج مبيعات القطاعات كلها',
    clean_ar: 'كل فرصة منسوبة إلى قطاع',
    skip_ar: 'يُقاس هذا البند على مستوى الشركة كاملة — اعرض كل القطاعات لرؤيته',
    fix_hint_ar: 'حدّد القطاع المسؤول عن كل فرصة لتدخل في مبيعاته' },
  { id: 'department_name_echoes_sector', severity: 'medium', form: 'department',
    title_ar: 'أسماء إدارات تكرّر اسم القطاع',
    tail_ar: 'باسم قطاعها نفسه — الاسم لا يدل على عمل الإدارة',
    clean_ar: 'لا إدارة تكرّر اسم قطاعها',
    fix_hint_ar: 'أعطِ الإدارة اسماً يصف عملها بدل تكرار اسم القطاع' },
  { id: 'non_arabic_department_name', severity: 'medium', form: 'department',
    title_ar: 'أسماء إدارات بغير العربية',
    tail_ar: 'باسم غير عربي — والمنصة كلها بالعربية',
    clean_ar: 'كل أسماء الإدارات بالعربية',
    fix_hint_ar: 'أعد تسمية الإدارة بالعربية واحفظ الاسم الأجنبي في خانة الاسم بالإنجليزية' },
  { id: 'department_without_employees', severity: 'medium', form: 'department',
    title_ar: 'إدارات بلا موظفين',
    tail_ar: 'بلا أي موظف — الإدارة بلا فريق لا تظهر في أي تقرير',
    clean_ar: 'كل إدارة يتبعها موظف واحد على الأقل',
    fix_hint_ar: 'أسنِد موظفين إلى الإدارة أو ادمجها مع غيرها إن لم تعد قائمة' },
  { id: 'department_without_manager', severity: 'low', form: 'department',
    title_ar: 'إدارات بلا مسؤول',
    tail_ar: 'بلا مسؤول معيَّن — لا مستلم لتنبيهاتها ولا مسؤول عن أرقامها',
    clean_ar: 'كل إدارة لها مسؤول معيَّن',
    fix_hint_ar: 'عيّن مسؤولاً لكل إدارة ليصله ما يخصها' },
];
export const CHECK_IDS = CHECK_SPEC.map((c) => c.id);

// نوع النتيجة ⟵ البند الذي تنتمي إليه (المشاريع والفرص والتسكين بند واحد: «أعمال بلا إدارة»).
const CHECK_OF_TYPE = {
  employees_without_department: 'employees_without_department',
  projects_without_department: 'work_without_department',
  opportunities_without_department: 'work_without_department',
  sector_without_departments: 'sector_without_departments',
  opportunity_without_sector: 'opportunity_without_sector',
  department_name_same_as_sector: 'department_name_echoes_sector',
  department_name_not_arabic: 'non_arabic_department_name',
  department_without_employees: 'department_without_employees',
  department_without_manager: 'department_without_manager',
};

// سطر تعريفي واحد لكل عنصر: يقول أين هو وماذا ينقصه — بلا مصطلحات ولا رموز مخزَّنة.
const HINT = {
  employees_without_department: (i) => `${i.sector_name_ar} — بلا إدارة تجمعه مع فريقه`,
  work_without_department: (i) => `${i.sector_name_ar} — بلا إدارة مسؤولة`,
  sector_without_departments: (i) => (i.employees
    ? `${countPhrase(i.employees, 'employee')} في القطاع بلا إدارة`
    : 'لا موظفين مسجّلين في القطاع بعد'),
  opportunity_without_sector: () => 'غير منسوبة إلى أي قطاع',
  department_name_echoes_sector: (i) => (i.employees
    ? `داخل ${i.sector_name_ar} — ${countPhrase(i.employees, 'employee')} في إدارة باسم القطاع نفسه`
    : `داخل ${i.sector_name_ar} — الاسم تكرار لاسم القطاع`),
  non_arabic_department_name: (i) => (i.suggested_name_ar
    ? `داخل ${i.sector_name_ar} — الاسم المقترح: ${i.suggested_name_ar}`
    : `داخل ${i.sector_name_ar} — أعد كتابة الاسم بالعربية`),
  department_without_employees: (i) => `داخل ${i.sector_name_ar} — لا يتبعها أي موظف`,
  department_without_manager: (i) => `داخل ${i.sector_name_ar} — بلا مسؤول معيَّن`,
};

function scoreView({ report, sector, strayOpportunities, strayAllocations }) {
  const bucket = new Map(CHECK_SPEC.map((c) => [c.id, { count: 0, items: [] }]));
  const push = (cid, item) => {
    const b = bucket.get(cid);
    b.count += 1;
    b.items.push({ id: item.id, name: item.name_ar, hint_ar: HINT[cid](item) });
  };
  for (const f of report.findings) {
    const cid = CHECK_OF_TYPE[f.type];
    if (!cid) continue;
    const b = bucket.get(cid);
    b.count += f.count - f.items.length; // ما لم تسعه التفاصيل يبقى محسوباً في العدد
    for (const it of f.items) push(cid, it);
  }
  // التسكين بلا إدارة يدخل بند الأعمال هنا وحده (خارج findings عمداً — انظر أعلاه)
  if (strayAllocations) {
    const b = bucket.get('work_without_department');
    b.count += strayAllocations.count - strayAllocations.items.length;
    for (const it of strayAllocations.items) push('work_without_department', it);
  }

  // تفصيل بند الأعمال بأنواعه — «43 مشروعاً و6 فرص» أوضح من «49 عملاً»
  const kindOf = (t) => report.findings.find((f) => f.type === t);
  const workParts = [];
  const proj = kindOf('projects_without_department');
  const opp = kindOf('opportunities_without_department');
  if (proj) workParts.push(countPhrase(proj.count, 'project'));
  if (opp) workParts.push(countPhrase(opp.count, 'opportunity'));
  if (strayAllocations && strayAllocations.count) workParts.push(countPhrase(strayAllocations.count, 'allocation'));

  // «مؤجَّل» لا «سليم»: بند لم يُقَس لا يُخصم عليه ولا يُعلن نظيفاً
  const pendingTypes = new Set(report.pending.map((p) => p.type));
  const workMeasured = !pendingTypes.has('projects_without_department')
    || !pendingTypes.has('opportunities_without_department')
    || strayAllocations != null;

  const checks = CHECK_SPEC.map((c) => {
    const head = { id: c.id, severity: c.severity, severity_ar: SEVERITY_AR[c.severity], title_ar: c.title_ar };
    const skipped = (c.id === 'work_without_department' && !workMeasured)
      || (c.id === 'opportunity_without_sector' && strayOpportunities == null);
    if (skipped) {
      return { ...head, detail_ar: c.skip_ar, count: 0, items: [], items_capped: false,
        fix_hint_ar: c.fix_hint_ar, skipped: true, deduction: 0 };
    }
    const { count, items } = bucket.get(c.id);
    const detail_ar = count === 0 ? c.clean_ar
      : c.id === 'work_without_department' ? `${workParts.join(' و')} ${c.tail_ar}`
        : `${countPhrase(count, c.form)} ${c.tail_ar}`;
    return { ...head, detail_ar, count, items: items.slice(0, ITEM_CAP),
      items_capped: count > Math.min(items.length, ITEM_CAP),
      fix_hint_ar: c.fix_hint_ar, skipped: false,
      deduction: count > 0 ? SEVERITY_WEIGHT[c.severity] : 0 };
  });

  const score = Math.max(0, 100 - checks.reduce((a, c) => a + c.deduction, 0));
  const firing = checks.filter((c) => !c.skipped && c.count > 0);
  const bySeverity = (s) => firing.filter((c) => c.severity === s).length;
  return {
    score,
    sectorId: sector,
    checks,
    summary: {
      score,
      headline_ar: firing.length
        ? `${countPhrase(firing.length, 'note')} على الهيكل التنظيمي — درجة الاكتمال ${score} من 100`
        : `الهيكل التنظيمي مكتمل — درجة الاكتمال ${score} من 100`,
      issues: firing.length,
      high: bySeverity('high'),
      medium: bySeverity('medium'),
      low: bySeverity('low'),
      affected: firing.reduce((a, c) => a + c.count, 0),
      skipped: checks.filter((c) => c.skipped).length,
      sectors: report.totals.sectors,
      departments: report.totals.departments,
      employees: report.totals.employees,
    },
  };
}
