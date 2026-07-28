// صفحة الهيكل التنظيمي — عرض شجري قابل للطيّ: الشركة ← القطاع ← الإدارة ← الوحدة ← الموظفون،
// فوقه بطاقة «صحة الهيكل» (درجة اكتمال + بنود قرار) ولوحة «العمل غير المُسنَد» لكل قطاع.
// الطيّ عبر <details> الأصلية: يعمل بلا جافاسكربت، ومتاح بلوحة المفاتيح، ويبقى سليماً لو فشل السكربت.
//
// لماذا أُضيفت الطبقتان فوق الشجرة: الشجرة كانت تعرض أشخاصاً بلا عمل — إدارات صفرية بينما مئات
// الفرص مكدّسة على القطاع ككتلة واحدة. الرقم وحده لا يُصلح شيئاً، لذا كل بند فيه طريق إلى الشاشة
// التي تُغلقه، و«شاشة الإسناد» تُسند دفعة كاملة إلى إدارة واحدة في إجراء واحد.
import { all, get } from '../../core/db/index.js';
import { orgTree } from '../../modules/org/org.js';
import { orgHealth, countPhrase } from '../../modules/org/org-quality.js';
import { departmentRollup, unassignedWork } from '../../modules/org/attribution.js';
import { layout, card, pill, tr } from '../layout.js';
import { icon } from '../icons.js';
import { can } from '../../core/rbac/index.js';
import { fmtSar } from '../../core/util/ids.js';
import { esc } from './_shared.js';

// نفس شرط الخدمة حرفياً (canManageSectorOrg): من يملك هيكل هذا القطاع يرى أدواته، وغيره يرى
// الشجرة للقراءة فقط. الإخفاء تجميل — الخدمة هي التي تمنع فعلاً.
// الصلاحية شيء، و**وضع التحرير** شيء آخر. كانت الصفحة تفتح كل أدوات التعديل لمن يملكها دائماً:
// قائمة مسؤول وزر تسمية وقائمة نقل وزر حذف على كل صف، وحقلا «إضافة إدارة/وحدة» مفتوحان تحت
// كل عقدة — فصار نصف الشاشة مربعات إدخال فارغة، وضاعت الشجرة التي جاء المستخدم ليقرأها.
// القراءة هي الوضع الافتراضي الآن، والتحرير يُطلَب بزرٍّ واحد (?edit=1).
const mayEdit = (user, sectorId) => user.role_id === 'admin' || can(user, 'admin', 'department', { sector_id: sectorId });
const editModeOn = (opts) => String(opts?.edit || '') === '1';

// أسماء المسؤولين تُجلب باستعلام مجمّع واحد (لا استعلام لكل عقدة) — نفس نمط بقية الصفحات.
async function managerNames(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await all(
    `SELECT id, name_ar, username FROM app_user WHERE deleted_at IS NULL AND id IN (${uniq.map(() => '?').join(',')})`,
    uniq
  );
  return new Map(rows.map((r) => [r.id, r.name_ar || r.username]));
}

const leadLine = (name) => name
  ? `<span class="ot-lead">${esc(name)}</span>`
  : '<span class="ot-lead ot-none">بلا مسؤول معيَّن</span>';

const countChip = (n, word) => `<span class="ot-count tnum">${Number(n) || 0}</span> <span class="ot-word">${word}</span>`;
// تمييز العدد في العربية ليس مفرداً وجمعاً فقط: من ٣ إلى ١٠ جمعُ قِلّة مجرور («٣ موظفين»)،
// ومن ١١ فأكثر مفردٌ منصوب («١١ موظفاً»). الشرط الثنائي البسيط كان يكتب «٣ موظفاً» — خطأ
// نحوي ظاهر لكل مستخدم في أول سطر من الشجرة. القاعدة على آخر خانتين لا على العدد كاملاً،
// فـ«١٠٣ موظفاً» صحيحة و«١٠٥ موظفين» صحيحة كذلك.
// نفس قاعدة `countPhrase` المستورَدة أعلاه وبنفس الصيغ — الفرق أن تلك تبني العبارة كاملة،
// وهذه تعيد الاسم مجرّداً لأن رقاقة الشجرة تُنسّق الرقم في خانة مستقلة (.ot-count). أي تعديل
// على القاعدة يجب أن يطال الاثنتين معاً.
const noun = (n, { one, two, few, many }) => {
  const v = Number(n) || 0;
  if (v === 1) return one;
  if (v === 2) return two;
  const r = v % 100;
  return r >= 3 && r <= 10 ? few : many;
};
const EMP = { one: 'موظف', two: 'موظفان', few: 'موظفين', many: 'موظفاً' };
const DEP = { one: 'إدارة', two: 'إدارتان', few: 'إدارات', many: 'إدارة' };
const SEC = { one: 'قطاع', two: 'قطاعان', few: 'قطاعات', many: 'قطاعاً' };
const n0 = (v) => `<span class="tnum">${Number(v) || 0}</span>`;
const money = (halalas) => `<span class="tnum ua-money">${fmtSar(halalas)}</span>`;

// ── أنواع العمل القابلة للإسناد (نفس القائمة البيضاء في الخدمة، بأسمائها العربية) ──
const KIND_AR = {
  opportunity: { head: 'الفرص', bare: 'فرص' },
  project: { head: 'المشاريع', bare: 'مشاريع' },
  allocation: { head: 'التسكينات', bare: 'تسكينات' },
};
// «7 فرص» بصيغتها العربية الصحيحة مع بقاء الرقم في خانة الأرقام الموحّدة (.tnum).
const countTnum = (n, form) => {
  const s = countPhrase(Number(n) || 0, form);
  const m = s.match(/^(\d+)\s+([\s\S]*)$/);
  return m ? `<span class="tnum">${m[1]}</span> ${esc(m[2])}` : esc(s);
};
const KINDS = ['opportunity', 'project', 'allocation'];
const kindOf = (k) => (Object.hasOwn(KIND_AR, String(k || '')) ? String(k) : 'opportunity');
const allocTypeAr = (t) => (t === 'lead' ? 'قائد' : t === 'advisor' ? 'مستشار' : 'عضو');

const qs = (o) => Object.entries(o)
  .filter(([, v]) => v != null && v !== '')
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const fixHref = (sectorId, kind, extra = {}) => `/app/org?${qs({ fix: sectorId, kind, ...extra })}`;

// ═══════════════════════ بطاقة «صحة الهيكل» ═══════════════════════
// الدرجة رقم واحد يتحرك حين تُغلق فئة كاملة، وتحتها بنود القرار مرتبة: ما يشتعل أولاً، ثم
// المؤجَّل، ثم السليم. «مؤجَّل» ليس «سليم»: بند لم يُقَس لا يُخصم عليه ولا يُعلن نظيفاً.
const SEV_ORDER = { high: 0, medium: 1, low: 2 };
const CHECK_LINK = {
  employees_without_department: { href: '/app/team', label: 'افتح الفريق' },
  work_without_department: { href: '#unassigned', label: 'لوحة الإسناد' },
  sector_without_departments: { href: '#tree', label: 'أضف إدارة' },
  opportunity_without_sector: { href: '/app/opportunities', label: 'افتح الفرص' },
  department_name_echoes_sector: { href: '#tree', label: 'أعد التسمية' },
  non_arabic_department_name: { href: '#tree', label: 'أعد التسمية' },
  department_without_employees: { href: '#tree', label: 'راجع الإدارات' },
  department_without_manager: { href: '#tree', label: 'عيّن مسؤولاً' },
};

function healthChecks(checks) {
  const rank = (c) => (c.skipped ? 1 : c.count > 0 ? 0 : 2);
  const sorted = [...checks].sort((a, b) =>
    rank(a) - rank(b)
    || (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3)
    || (Number(b.count) || 0) - (Number(a.count) || 0));

  return sorted.map((c) => {
    const cnt = Number(c.count) || 0;
    const link = CHECK_LINK[c.id];
    const head = (mark) => `
      <span class="oh-sev oh-${esc(c.severity || 'low')}">${esc(c.severity_ar || '')}</span>
      <span class="oh-ct">${esc(c.title_ar || '')}</span>
      ${mark}
      <span class="oh-cd">${esc(c.detail_ar || '')}</span>`;

    if (c.skipped) {
      return `<div class="oh-chk oh-later">
        <div class="oh-chk-h">${head(`${pill('مؤجَّل', 'slate')}`)}</div>
      </div>`;
    }
    if (cnt === 0) {
      return `<div class="oh-chk oh-clean">
        <div class="oh-chk-h">${head('<span class="oh-ok">مكتمل ✓</span>')}</div>
      </div>`;
    }
    const items = (c.items || []).map((it) => `<li>
      <span class="oh-it-n">${esc(it.name || 'سجل بلا اسم')}</span>
      <span class="oh-it-h">${esc(it.hint_ar || '')}</span></li>`).join('');
    const shown = (c.items || []).length;
    // الصندوق يمرّر داخلياً، فنقول صراحةً كم يُعرض من كم — بلا هذا السطر تبدو القائمة مبتورة.
    const note = !shown
      ? '<div class="oh-more">الأسماء لا تظهر ضمن صلاحيتك — العدد أعلاه كامل</div>'
      : c.items_capped
        ? `<div class="oh-more">تُعرض أوائل القائمة — العدد الكامل ${n0(cnt)}</div>`
        : shown > 6 ? `<div class="oh-more">القائمة كاملة: ${n0(shown)} — مرّر داخل الصندوق</div>` : '';
    return `<details class="oh-chk oh-fire">
      <summary class="oh-chk-h">${head(`<span class="oh-cn tnum">${cnt}</span>`)}</summary>
      <div class="oh-chk-b">
        ${note}
        ${items ? `<ul class="oh-items">${items}</ul>` : ''}
        <div class="oh-fix"><b>ما يُغلق هذا البند:</b> ${esc(c.fix_hint_ar || '')}
          ${link ? `<a class="btn btn-sm oh-go" href="${link.href}">${link.label}</a>` : ''}</div>
      </div>
    </details>`;
  }).join('');
}

function healthCard(health, err) {
  if (!health) {
    return card(`<div style="padding:1rem">
      <div class="alert warn">${icon('risk')}<div><b>فحص الهيكل غير متاح الآن</b><div style="margin-top:.15rem">${esc(err || 'أعد تحميل الصفحة، وإن تكرّر الأمر راجع مدير النظام.')}</div></div></div>
    </div>`);
  }
  const s = health.summary || {};
  const score = Number(health.score) || 0;
  const high = Number(s.high) || 0, med = Number(s.medium) || 0, low = Number(s.low) || 0;
  const skipped = Number(s.skipped) || 0;
  const tone = high > 0 || score < 60 ? 'bad' : (Number(s.issues) || 0) > 0 || score < 90 ? 'watch' : 'good';
  const toneLabel = { bad: 'الهيكل يحتاج معالجة', watch: 'الهيكل شبه مكتمل', good: 'الهيكل مكتمل' }[tone];
  const tonePill = { bad: 'red', watch: 'amber', good: 'green' }[tone];
  const scopeLine = health.company_wide && !health.sectorId ? 'كل القطاعات' : 'قطاعك';

  return `<section class="card oh-card" id="health">
    <div class="oh-head">
      <div class="oh-score oh-${tone}">
        <div class="oh-num tnum">${score}</div>
        <div class="oh-of">من 100</div>
      </div>
      <div class="oh-tx">
        <div class="oh-cap">درجة اكتمال الهيكل · ${scopeLine}</div>
        <div class="oh-lbl">${toneLabel} ${pill(esc(toneLabel === 'الهيكل مكتمل' ? 'لا ملاحظات' : 'يحتاج قرارك'), tonePill)}</div>
        <div class="oh-headline">${esc(s.headline_ar || '')}</div>
        <div class="oh-sums">
          <span class="oh-sum"><b class="tnum">${high}</b> عاجل</span>
          <span class="oh-sum"><b class="tnum">${med}</b> مهم</span>
          <span class="oh-sum"><b class="tnum">${low}</b> يمكن تأجيله</span>
          ${skipped ? `<span class="oh-sum oh-sum-later"><b class="tnum">${skipped}</b> مؤجَّل</span>` : ''}
        </div>
      </div>
      <div class="oh-tot">
        <div><span>قطاعات</span> ${n0(s.sectors)}</div>
        <div><span>إدارات</span> ${n0(s.departments)}</div>
        <div><span>موظفون</span> ${n0(s.employees)}</div>
      </div>
    </div>
    <div class="oh-list">${healthChecks(health.checks || [])}</div>
    <div class="oh-foot">افتح أي بند لترى سجلاته وما يُغلقه. البنود «المؤجَّلة» لم تُقَس بعد — ليست سليمة.</div>
  </section>`;
}

// ═══════════════════════ لوحة «العمل غير المُسنَد» ═══════════════════════
// القصة كلها في التباين: إدارات بأصفار مقابل كتلة عمل معلّقة على القطاع. لذا كل سطر شريط واحد
// يملؤه غير المُسنَد بلون التنبيه، والمُسنَد وحده هو الأخضر — والصفر يُقرأ من بعيد.
function uaRow(kind, assigned, un, opts = {}) {
  const total = assigned + un;
  const label = KIND_AR[kind].head;
  // لا سجلات أصلاً ≠ الكل مُسنَد: صندوق فارغ لا يُعلن نجاحاً، يقول إنه فارغ.
  if (!total) {
    return `<div class="ua-row ua-none">
      <div class="ua-r1"><span class="ua-lbl">${label}</span>
        <span class="ua-nums">لا سجلات لهذه السنة</span></div>
    </div>`;
  }
  const donePct = Math.round((assigned / total) * 100);
  const bar = `<div class="ua-bar" role="img" aria-label="${esc(`${donePct}% من ${label} مُسنَد إلى إدارة`)}">
         <span class="ua-fill" style="width:${donePct}%"></span></div>`;
  const moneyLine = opts.value != null && un > 0
    ? `<span class="ua-mline">قيمتها ${money(opts.value)}${opts.weighted != null ? ` · مرجّحة ${money(opts.weighted)}` : ''}</span>`
    : '';
  return `<div class="ua-row ${un > 0 ? 'ua-hot' : 'ua-cool'}">
    <div class="ua-r1">
      <span class="ua-lbl">${label}</span>
      <span class="ua-nums">${un > 0
    ? `<b class="tnum ua-open">${un}</b> بلا إدارة · <span class="tnum">${assigned}</span> مُسنَد`
    : `<span class="ua-ok">الكل مُسنَد ✓</span> <span class="tnum">${assigned}</span>`}</span>
    </div>
    ${bar}
    <div class="ua-r2">
      <span class="ua-pct">${un === 0 ? 'داخل الإدارات بالكامل'
    : donePct === 0 ? 'لا شيء منها داخل الإدارات'
      : donePct < 50 ? `${donePct}% فقط داخل الإدارات` : `${donePct}% داخل الإدارات`}</span>
      ${moneyLine}
      ${un > 0 && opts.canFix ? `<a class="btn btn-sm ua-go" href="${opts.href}">شاشة الإسناد</a>` : ''}
    </div>
  </div>`;
}

function unassignedCard(sector, rollup, err, editable) {
  const head = `<div class="ua-head">
    <span class="ua-dot" style="background:${esc(sector.color || '#244A99')}"></span>
    <span class="ua-name">${esc(sector.name_ar)}</span>
    <span class="ua-deps">${countChip((rollup && rollup.departments.length) || 0, 'إدارة')}</span>
  </div>`;
  if (!rollup) {
    return `<div class="card ua-card">${head}
      <div class="ua-body"><div class="alert warn" style="margin:.2rem 0">${esc(err || 'توزيع العمل على إدارات هذا القطاع غير متاح لصلاحيتك.')}</div></div></div>`;
  }
  const dep = rollup.departments;
  const sum = (k) => dep.reduce((a, d) => a + (Number(d[k]) || 0), 0);
  const u = rollup.unassigned;
  const orph = rollup.orphaned || {};
  const pending = (Number(u.opportunities) || 0) + (Number(u.projects) || 0) + (Number(u.allocations) || 0);

  if (!dep.length) {
    return `<div class="card ua-card">${head}
      <div class="ua-body">
        <div class="empty-state" style="padding:1.2rem .6rem">${icon('building')}
          <div class="t">لا إدارات في هذا القطاع بعد</div>
          <div class="s">الإسناد يحتاج إدارة واحدة على الأقل. أنشئ إدارة من الشجرة ثم وزّع عليها ${n0(pending)} من الأعمال المعلّقة.</div>
          ${editable ? '<a class="btn btn-primary btn-sm" href="#tree">أضف إدارة</a>' : ''}
        </div>
      </div></div>`;
  }
  if (!pending) {
    return `<div class="card ua-card">${head}
      <div class="ua-body">
        <div class="empty-state" style="padding:1.2rem .6rem">${icon('check')}
          <div class="t">كل عمل هذا القطاع مربوط بإدارة</div>
          <div class="s">الفرص والمشاريع والتسكينات كلها تحت إداراتها — أرقام الإدارات في الشجرة موثوقة.</div>
        </div>
      </div></div>`;
  }
  // طريق الإصلاح يُعرض لمن يملك هيكل هذا القطاع؛ الأرقام تُعرض للجميع لأنها تشخيص لا تعديل.
  const canFix = !!editable;
  const rows = [
    // العدد والقيمة يبقيان إجمالَي كل ما لم يُسنَد (كومة العمل المعلّقة تضمّ المحسوم فعلاً، وهذا
    // صحيح هنا). أمّا **المرجّحة** فلا معنى لها إلا على المفتوح: ضرب فرصة فائزة أو خاسرة في
    // احتمال فوزها يُنتج رقماً لا يقابله شيء في الواقع. الحقل المفتوح صار متاحاً بعد فصل الدلاء.
    uaRow('opportunity', sum('opportunities'), Number(u.opportunities) || 0, {
      value: u.opportunity_value_halalas, weighted: u.opportunity_open_weighted_halalas,
      href: fixHref(sector.id, 'opportunity'), canFix }),
    uaRow('project', sum('projects'), Number(u.projects) || 0, {
      value: u.project_value_halalas, href: fixHref(sector.id, 'project'), canFix }),
    uaRow('allocation', sum('allocations'), Number(u.allocations) || 0, {
      href: fixHref(sector.id, 'allocation'), canFix }),
  ].join('');
  const emps = Number(u.employees) || 0;
  const empLine = emps > 0
    ? `<div class="ua-note">${n0(emps)} من موظفي القطاع بلا إدارة — يُسندون من صفحة الفريق
        <a class="btn btn-sm ua-go" href="/app/team">افتح الفريق</a></div>` : '';
  const orphLine = (Number(orph.opportunities) || 0) + (Number(orph.projects) || 0) + (Number(orph.allocations) || 0) > 0
    ? '<div class="ua-note">جزء من العمل مربوط بإدارة لم تعد تتبع هذا القطاع — يظهر خارج أرقام إداراته.</div>' : '';

  return `<div class="card ua-card">${head}<div class="ua-body">${rows}${empLine}${orphLine}</div></div>`;
}

// ═══════════════════════ الصفحة الرئيسية (الشجرة) ═══════════════════════
export async function orgTreePage(user, opts = {}) {
  const year = Number(opts.year) || new Date().getUTCFullYear();
  if (opts.fix) return assignPage(user, { sectorId: String(opts.fix), kind: opts.kind, year, limit: opts.limit });

  const tree = await orgTree(user);
  const mgrIds = [];
  for (const s of tree) {
    mgrIds.push(s.lead_user_id);
    for (const d of s.departments || []) {
      mgrIds.push(d.manager_user_id);
      for (const u of d.units || []) mgrIds.push(u.manager_user_id);
    }
  }
  const names = await managerNames(mgrIds);
  const totalEmployees = (await get('SELECT COUNT(*) n FROM employee WHERE deleted_at IS NULL')).n;

  // أهل كل إدارة بأسمائهم — الهيكل التنظيمي أشخاصٌ قبل أن يكون صناديق. كانت العقدة تقول
  // «١٢ فريق» ولا تقول من هم، فيُقرأ الهيكل كجدول أعداد لا كخريطة ناس. استعلام واحد لكل
  // الشجرة (لا استعلام لكل عقدة)، ويُجمَّع في الذاكرة.
  const staff = await all(`SELECT id, name_ar, job_title, department_id
      FROM employee WHERE deleted_at IS NULL AND active = 1 AND department_id IS NOT NULL
      ORDER BY name_ar LIMIT 1200`);
  const byDep = new Map();
  for (const e of staff) {
    if (!byDep.has(e.department_id)) byDep.set(e.department_id, []);
    byDep.get(e.department_id).push(e);
  }
  // سقفٌ للحماية من إدارةٍ مرضية بمئتَي اسم، لا سقفُ عرض: أكبر إدارة في EVC نحو اثني عشر،
  // فالسقف عند أربعة وعشرين يعني أن الحالة الواقعية تُعرض كاملةً — والقصّ استثناءٌ لا قاعدة.
  const PEOPLE_SHOWN = 24;
  // كتلة الأشخاص هي مضمون الإدارة لا حاشيتها: تُعرَض داخل لوح خفيف بعنوانٍ صغير، فتُقرأ
  // كـ«أهل هذه الإدارة» بدل سطرٍ سائبٍ من الرقاقات معلَّقٍ تحت الصف. و«+N» رقاقةٌ كالبقية
  // لا نصٌّ باهت في آخر السطر — هي مدخلٌ إلى البقية، وقد كانت تُقرأ كأثرِ قصٍّ.
  const peopleRow = (depId) => {
    const list = byDep.get(depId) || [];
    if (!list.length) return '';
    const shown = list.slice(0, PEOPLE_SHOWN);
    const rest = list.length - shown.length;
    return `<div class="ot-people">
      <span class="ot-plabel">${countChip(list.length, noun(list.length, EMP))}</span>
      <span class="ot-plist">${shown.map((e) => {
        const t = e.job_title ? `${e.name_ar} — ${e.job_title}` : e.name_ar;
        return `<span class="ot-p" title="${esc(t)}"><span class="ot-pav" aria-hidden="true">${esc(String(e.name_ar || '؟').trim().charAt(0))}</span><span class="ot-pn">${esc(e.name_ar)}</span></span>`;
      }).join('')}${rest > 0 ? `<span class="ot-pmore">و<span class="tnum">${rest}</span> غيرهم</span>` : ''}</span>
    </div>`;
  };

  // مرشّحو مسؤول الإدارة: حسابات نشطة فقط، ويُقرأون مرة واحدة لكل الشجرة (لا استعلام لكل عقدة).
  // القائمة تُعرض لمن يملك تعديل هيكل القطاع وحده — والخدمة هي التي تمنع فعلاً.
  const canEditAny = tree.some((s) => mayEdit(user, s.id));
  const edit = canEditAny && editModeOn(opts);
  const anyEditable = edit;
  const candidates = anyEditable
    ? await all(`SELECT id, name_ar, username, sector_id FROM app_user
        WHERE deleted_at IS NULL AND active = 1 ORDER BY name_ar, username`)
    : [];
  const personName = (u) => u.name_ar || u.username || 'حساب بلا اسم';

  // فحص الجودة وتوزيع العمل: قراءات خالصة من الخدمات. أي رفض صلاحية على قطاع لا يُسقط الصفحة —
  // يظهر مكانه سطر عربي واضح، وبقية القطاعات تُعرض كما هي.
  let health = null, healthErr = null;
  try { health = await orgHealth(user, {}); } catch (e) { healthErr = e && e.message; }

  const rollups = new Map();
  const rollupErrs = new Map();
  await Promise.all(tree.map(async (s) => {
    try { rollups.set(s.id, await departmentRollup(user, { sectorId: s.id, year })); }
    catch (e) { rollupErrs.set(s.id, e && e.message); }
  }));
  const depStats = new Map();
  for (const r of rollups.values()) for (const d of r.departments) depStats.set(d.id, d);

  const unitNode = (u) => `<li class="ot-li">
    <div class="ot-node ot-unit">
      <div class="ot-main"><span class="ot-kind">وحدة</span><span class="ot-name">${esc(u.name_ar)}</span></div>
      <div class="ot-meta">${leadLine(names.get(u.manager_user_id))}</div>
    </div>
  </li>`;

  // أرقام الإدارة داخل العقدة: فرص · مشاريع · فريق — الشجرة تتوقف عن كونها زينة وتصبح لوحة عمل.
  // والأصفار لا تُطبع: صفٌّ يقول «فرص ٠ · مشاريع ٠» على خمس إدارات يملأ الشاشة بلا شيء يُقال،
  // ويدفن العدد الوحيد الذي يهمّ (الفريق). وكذلك نداء «أسنِد إليها» — نداءُ عملٍ لا خبر، فمكانه
  // وضع التعديل وحده؛ في القراءة كان أعلى صوتٍ على الشاشة وأصفره، فوق اسم الإدارة نفسه.
  const depWork = (d, editable) => {
    const st = depStats.get(d.id);
    if (!st) return '';
    const o = Number(st.opportunities) || 0, p = Number(st.projects) || 0, e = Number(st.employees) || 0;
    const w = (word, n) => `<span class="ot-w"><span class="ot-word">${word}</span> <span class="ot-count tnum">${n}</span></span>`;
    const chips = `${o ? w('فرص', o) : ''}${p ? w('مشاريع', p) : ''}${w('فريق', e)}`;
    const idle = editable && (o + p) === 0
      ? `<a class="ot-idle" href="${fixHref(d.sector_id, 'opportunity')}">أسنِد عملاً</a>` : '';
    return `${chips}${idle}`;
  };

  // مسؤول الإدارة: نفس السطر الذي كان يقول «بلا مسؤول معيَّن» يصبح هو أداة التعيين — الفحص
  // يقول «إدارات بلا مسؤول» ومن الشجرة نفسها يُغلق البند، بلا شاشة وسيطة.
  const managerPicker = (d) => {
    const cur = d.manager_user_id || '';
    const inSector = candidates.filter((u) => u.sector_id === d.sector_id);
    const company = candidates.filter((u) => !u.sector_id);
    const shown = new Set([...inSector, ...company].map((u) => u.id));
    const outsider = cur && !shown.has(cur) ? candidates.find((u) => u.id === cur) : null;
    const opt = (u) => `<option value="${esc(u.id)}"${u.id === cur ? ' selected' : ''}>${esc(personName(u))}</option>`;
    const group = (label, list) => (list.length ? `<optgroup label="${esc(label)}">${list.map(opt).join('')}</optgroup>` : '');
    return `<select class="ot-act ot-sel ot-mgr ${cur ? '' : 'ot-mgr-none'}" data-action-change="dep-manager"
        data-id="${esc(d.id)}" data-prev="${esc(cur)}" aria-label="مسؤول الإدارة" title="مسؤول الإدارة">
      <option value=""${cur ? '' : ' selected'}>بلا مسؤول معيَّن</option>
      ${group('من القطاع', inSector)}
      ${group('حسابات على مستوى الشركة', company)}
      ${outsider ? group('المسؤول الحالي', [outsider]) : ''}
    </select>`;
  };

  const deptNode = (d, editable, sectors) => {
    const units = d.units || [];
    const unitAdd = editable ? `<li class="ot-li"><div class="ot-add">
      <input class="ot-in" id="u-${d.id}" placeholder="اسم وحدة جديدة…" aria-label="اسم وحدة جديدة">
      <button class="ot-btn" data-action="unit-add" data-dep="${d.id}">إضافة وحدة</button>
    </div></li>` : '';
    // الناس أولاً ثم الوحدات: الإدارة تُعرَف بأهلها. و«لا وحدات» لم تعد تُقال حين يكون فيها
    // أشخاص — قولُها عن إدارةٍ فيها اثنا عشر موظفاً يجعلها تبدو خاويةً وهي عامرة.
    const people = peopleRow(d.id);
    const unitsInner = (units.length || editable)
      ? `<ul class="ot-ul">${units.map(unitNode).join('')}${unitAdd}</ul>`
      : (people ? '' : '<div class="ot-empty">لا وحدات ولا أشخاص في هذه الإدارة</div>');
    const inner = `${people}${unitsInner}`;
    const actions = editable ? `<div class="ot-acts">
      <button class="ot-act" data-action="dep-rename" data-id="${d.id}" data-name="${esc(d.name_ar)}">إعادة تسمية</button>
      <select class="ot-act ot-sel" data-action-change="dep-move" data-id="${d.id}" aria-label="نقل الإدارة إلى قطاع آخر">
        <option value="">نقل إلى…</option>
        ${sectors.filter((x) => x.id !== d.sector_id).map((x) => `<option value="${esc(x.id)}">${esc(x.name_ar)}</option>`).join('')}
      </select>
      <button class="ot-act ot-danger" data-action="dep-del" data-id="${d.id}" data-name="${esc(d.name_ar)}">حذف</button>
    </div>` : '';
    return `<li class="ot-li">
      <details class="ot-det" open>
        <summary class="ot-node ot-dept">
          <div class="ot-main"><span class="ot-kind">إدارة</span><span class="ot-name">${esc(d.name_ar)}</span></div>
          <div class="ot-meta">${editable ? managerPicker(d) : leadLine(names.get(d.manager_user_id))} · ${depWork(d, editable) || countChip(d.employees, noun(d.employees, EMP))}${actions}</div>
        </summary>
        ${inner}
      </details>
    </li>`;
  };

  // ترتيب العرض: ما فيه هيكل أولاً، ثم القطاع الفارغ، ثم القالب غير المفعَّل. ترتيب القاعدة
  // (sort_order) يخدم التقارير لا القراءة، فقد يصدّر قطاعاً فارغاً أو قالباً فوق القطاع العامر —
  // فيفتح المستخدم «الهيكل التنظيمي» ليجد صفّين يقولان «لا إدارات» قبل أن يرى شجرةً واحدة.
  const rank = (s) => (s.is_placeholder ? 2 : (s.departments || []).length ? 0 : 1);
  const shown = tree.slice().sort((a, b) => rank(a) - rank(b));
  const sectorList = tree.map((s) => ({ id: s.id, name_ar: s.name_ar }));
  const sectorNode = (s) => {
    const deps = s.departments || [];
    const editable = mayEdit(user, s.id) && edit;
    const depAdd = editable ? `<li class="ot-li"><div class="ot-add">
      <input class="ot-in" id="d-${s.id}" placeholder="اسم إدارة جديدة…" aria-label="اسم إدارة جديدة">
      <button class="ot-btn" data-action="dep-add" data-sector="${esc(s.id)}">إضافة إدارة</button>
    </div></li>` : '';
    const inner = (deps.length || editable)
      ? `<ul class="ot-ul">${deps.map((d) => deptNode(d, editable, sectorList)).join('')}${depAdd}</ul>`
      : `<div class="ot-empty">لا إدارات تحت هذا القطاع</div>`;
    return `<li class="ot-li">
      <details class="ot-det" open>
        <summary class="ot-node ot-sector">
          <div class="ot-main">
            <span class="ot-dot" style="background:${esc(s.color || '#244A99')}"></span>
            <span class="ot-kind">قطاع</span><span class="ot-name">${esc(s.name_ar)}</span>
            ${s.is_placeholder ? pill('قالب', 'amber') : ''}
          </div>
          <div class="ot-meta">${leadLine(names.get(s.lead_user_id))} · ${countChip(s.employees, noun(s.employees, EMP))} · ${countChip(deps.length, noun(deps.length, DEP))}</div>
        </summary>
        ${inner}
      </details>
    </li>`;
  };

  const uaCards = shown.map((s) => unassignedCard(s, rollups.get(s.id), rollupErrs.get(s.id), mayEdit(user, s.id))).join('');
  // عدد ما ينتظر إسناداً — يُذكر في عنوان القسم المطويّ كي لا يختفي بطيّه.
  const uaPending = [...rollups.values()].reduce((a, r) => a + (Number(r.unassigned.opportunities) || 0)
    + (Number(r.unassigned.projects) || 0) + (Number(r.unassigned.allocations) || 0), 0);

  // ترتيب الصفحة يتبع سبب فتحها: الهيكل أولاً، ثم ما ينقصه. كان التشخيص يحتل أول شاشتين
  // كاملتين (درجة + ثماني ملاحظات + ثلاث بطاقات) والشجرة — اسم الصفحة — في القاع.
  const qp = (o) => {
    const p = new URLSearchParams();
    if (o.edit) p.set('edit', '1');
    if (year !== new Date().getUTCFullYear()) p.set('year', String(year));
    const q = p.toString();
    return `/app/org${q ? `?${q}` : ''}`;
  };
  const editBar = canEditAny ? `<a class="ot-editbtn${edit ? ' on' : ''}" href="${qp({ edit: !edit })}">
      ${edit ? 'إنهاء التعديل' : 'تعديل الهيكل'}</a>` : '';

  const body = `
    <style>${PAGE_CSS}</style>
    <div class="ot-wrap">
      <section id="tree">
        <div class="sec-h">
          <h2 class="sec-t">الشجرة</h2>
          <span class="sec-s">${edit ? 'وضع التعديل — أضِف وأعِد التسمية وانقل' : 'انقر أي فرع لطيّه'}</span>
          <span style="flex:1"></span>${editBar}
        </div>
        ${card(`<div style="padding:1rem">
          <div class="ot-root">
            <span>رؤية الخبراء الاستشارية</span>
            <span style="font-weight:400;font-size:11.5px;opacity:.85">${countChip(totalEmployees, noun(totalEmployees, EMP))} · ${countChip(tree.length, noun(tree.length, SEC))}</span>
          </div>
          <ul class="ot-ul">${shown.map(sectorNode).join('') || '<div class="ot-empty">لا قطاعات بعد</div>'}</ul>
        </div>`)}
      </section>

      <details class="ot-diag" id="unassigned">
        <summary>العمل غير المُسنَد إلى إدارة
          <span class="ot-diagn">${uaPending ? `<span class="tnum">${uaPending}</span> بانتظار الإسناد` : 'لا شيء معلَّق'}</span></summary>
        <div class="ua-grid" style="padding:.9rem 1rem 1rem">${uaCards || '<div class="ot-empty">لا قطاعات بعد</div>'}</div>
      </details>

      <details class="ot-diag">
        <summary>فحص جودة الهيكل — الملاحظات ودرجة الاكتمال</summary>
        ${healthCard(health, healthErr)}
      </details>
    </div>`;

  return layout({
    user, active: 'org', title: 'الهيكل التنظيمي',
    subtitle: 'الشركة ← القطاع ← الإدارة ← الوحدة ← الموظف — والعمل المسؤول عنه',
    body, scripts: ['/static/pages/org-tree.js'],
  });
}

// ═══════════════════════ شاشة الإسناد ═══════════════════════
// الصفوف تُبنى على الخادم من نفس خدمة الكشف: القائمة تُقرأ كاملة بلا جافاسكربت، والتحديد والإسناد
// الجماعي طبقة فوقها. قائمة الإدارات = إدارات هذا القطاع وحدها، فلا نعرض خياراً سيرفضه الخادم.
async function assignPage(user, { sectorId, kind, year, limit }) {
  const k = kindOf(kind);
  const askedLimit = Number(limit);
  // سقف الدفعة الواحدة في الخدمة 200 — لا نعرض أكثر مما يمكن إسناده في إجراء واحد.
  const lim = Math.min(200, Number.isFinite(askedLimit) && askedLimit > 0 ? Math.trunc(askedLimit) : 100);

  const [listRes, rollRes] = await Promise.all([
    unassignedWork(user, { sectorId, kind: k, limit: lim }).then((r) => ({ r }), (e) => ({ err: e && e.message })),
    departmentRollup(user, { sectorId, year }).then((r) => ({ r }), (e) => ({ err: e && e.message })),
  ]);
  const sectorRow = await get('SELECT id, name_ar FROM sector WHERE id = ? AND deleted_at IS NULL', [sectorId]);
  const sectorName = (listRes.r && listRes.r.sector.name_ar) || (rollRes.r && rollRes.r.sector.name_ar)
    || (sectorRow && sectorRow.name_ar) || 'قطاع غير معروف';
  const back = '<a class="btn btn-sm" href="/app/org">رجوع للهيكل</a>';

  if (listRes.err) {
    const body = `<style>${PAGE_CSS}</style><div class="ot-wrap">
      ${card(`<div style="padding:1.1rem">
        <div class="alert err">${icon('risk')}<div><b>تعذّر فتح شاشة الإسناد</b>
          <div style="margin-top:.15rem">${esc(listRes.err)}</div></div></div>
        <div style="margin-top:.8rem">${back}</div>
      </div>`)}</div>`;
    return layout({ user, active: 'org', title: 'إسناد العمل إلى الإدارات', subtitle: esc(sectorName), body,
      scripts: ['/static/pages/org-tree.js'] });
  }

  const list = listRes.r;
  const deps = rollRes.r ? rollRes.r.departments : [];
  const kindChips = KINDS.map((x) => `<a class="chip ${x === k ? 'on' : ''}" href="${fixHref(sectorId, x)}">${KIND_AR[x].head}</a>`).join('');

  const th = (t, align = 'right') => `<th style="padding:.5rem .6rem;text-align:${align};font-size:11px;color:var(--muted);font-weight:800;border-bottom:1px solid var(--line);white-space:nowrap">${t}</th>`;
  const td = (label, inner, extra = '') => `<td data-label="${esc(label)}" style="padding:.5rem .6rem;font-size:12.5px;border-bottom:1px solid var(--line);${extra}">${inner}</td>`;

  const headCells = k === 'opportunity'
    ? `${th(KIND_AR[k].head)}${th('المرحلة')}${th('احتمال الفوز', 'center')}${th('القيمة', 'left')}${th('المسؤول')}${th('نتيجة الإسناد')}`
    : k === 'project'
      ? `${th(KIND_AR[k].head)}${th('حالة المشروع')}${th('قيمة العقد', 'left')}${th('المسؤول')}${th('نتيجة الإسناد')}`
      : `${th('التسكين')}${th('الشخص')}${th('الصفة')}${th('السنة', 'center')}${th('نتيجة الإسناد')}`;

  const rowTpl = (r) => {
    const title = `<div style="display:flex;align-items:center;gap:.5rem;min-width:0">
      <input type="checkbox" class="asg-cb" data-id="${esc(r.id)}" aria-label="${esc(r.title || 'سجل')}">
      <span style="font-weight:700;color:var(--ink2);overflow:hidden;text-overflow:ellipsis">${esc(r.title || 'بلا اسم')}</span>
      ${r.code ? `<span class="asg-code tnum">${esc(r.code)}</span>` : ''}</div>`;
    const state = td('نتيجة الإسناد', '<span class="asg-state">—</span>');
    if (k === 'opportunity') {
      return `<tr data-row="${esc(r.id)}">
        ${td(KIND_AR[k].head, title)}
        ${td('المرحلة', r.stage_name_ar ? esc(r.stage_name_ar) : '<span style="color:var(--faint)">بلا مرحلة</span>')}
        ${td('احتمال الفوز', r.win_pct == null ? '<span style="color:var(--faint)">—</span>' : `<span class="tnum">${Number(r.win_pct) || 0}%</span>`, 'text-align:center')}
        ${td('القيمة', money(r.value_halalas), 'text-align:left;white-space:nowrap')}
        ${td('المسؤول', r.owner_name_ar ? esc(r.owner_name_ar) : '<span style="color:var(--faint)">بلا مسؤول</span>')}
        ${state}</tr>`;
    }
    if (k === 'project') {
      return `<tr data-row="${esc(r.id)}">
        ${td(KIND_AR[k].head, title)}
        ${td('حالة المشروع', r.status ? esc(tr(r.status)) : '<span style="color:var(--faint)">غير محدَّدة</span>')}
        ${td('قيمة العقد', money(r.value_halalas), 'text-align:left;white-space:nowrap')}
        ${td('المسؤول', r.owner_name_ar ? esc(r.owner_name_ar) : '<span style="color:var(--faint)">بلا مسؤول</span>')}
        ${state}</tr>`;
    }
    return `<tr data-row="${esc(r.id)}">
      ${td('التسكين', title)}
      ${td('الشخص', r.owner_name_ar ? esc(r.owner_name_ar) : '<span style="color:var(--faint)">بلا اسم</span>')}
      ${td('الصفة', esc(allocTypeAr(r.type)))}
      ${td('السنة', r.year == null ? '<span style="color:var(--faint)">—</span>' : `<span class="tnum">${Number(r.year) || 0}</span>`, 'text-align:center')}
      ${state}</tr>`;
  };

  const capped = list.count >= lim;
  // العدد الحقيقي المعلّق (من التوزيع) يُذكر مع المعروض كي لا يبدو ١٠٠ هو كل المشكلة.
  const unKey = { opportunity: 'opportunities', project: 'projects', allocation: 'allocations' }[k];
  const trueTotal = rollRes.r ? Number(rollRes.r.unassigned[unKey]) || 0 : 0;
  const headCount = capped && trueTotal > list.count
    ? `${countTnum(trueTotal, k)} بلا إدارة · تُعرض ${n0(list.count)}`
    : list.count ? `${countTnum(list.count, k)} بلا إدارة` : `لا ${KIND_AR[k].bare} بلا إدارة`;
  const emptyState = `<div class="empty-state">${icon('check')}
    <div class="t">لا ${KIND_AR[k].bare} بلا إدارة في ${esc(sectorName)}</div>
    <div class="s">كل ما يخص هذا النوع مربوط بإدارته — تظهر أرقامه في الشجرة وفي تقارير الإدارات.</div>
    <a class="btn btn-sm" href="/app/org">رجوع للهيكل</a></div>`;

  const picker = deps.length
    ? `<select id="asg-dep" class="input asg-dep" aria-label="الإدارة المسؤولة">
        <option value="">اختر الإدارة…</option>
        ${deps.map((d) => `<option value="${esc(d.id)}">${esc(d.name_ar)}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm" data-action="asg-apply" data-kind="${esc(k)}" disabled>إسناد المحدد</button>`
    : `<span class="asg-nodep">لا إدارات في ${esc(sectorName)} — أنشئ إدارة أولاً</span>
       <a class="btn btn-sm" href="/app/org#tree">أضف إدارة</a>`;

  // من لا يملك هيكل هذا القطاع يقرأ الكشف ولا يُعرض له إجراء سيُرفض — بجملة تقول لمن يعود القرار.
  const mayFix = mayEdit(user, sectorId);
  const bar = !list.count ? ''
    : !mayFix ? `<div class="asg-barwrap"><div class="asg-bar">
      <span class="asg-nodep">الإسناد يتطلب صلاحية إدارة هيكل ${esc(sectorName)} — اطلبه من مسؤول القطاع</span>
    </div></div>`
      : `<div class="asg-barwrap"><div class="asg-bar">
    <label class="asg-all"><input type="checkbox" id="asg-all" aria-label="تحديد الكل"> تحديد الكل</label>
    <span class="asg-cnt">المحدد <b class="tnum" id="asg-n">0</b> من <span class="tnum">${list.count}</span></span>
    <span class="asg-sp"></span>
    ${picker}
  </div></div>`;

  const body = `
    <style>${PAGE_CSS}</style>
    <div class="ot-wrap">
      <div class="toolbar">
        ${back}
        <div class="chips" style="margin:0">${kindChips}</div>
        <span class="spacer"></span>
        <span class="asg-sum">${esc(sectorName)} · ${headCount}</span>
      </div>
      <noscript><div class="alert info" style="margin-bottom:.8rem">هذه القائمة تُعرض كاملة هنا. تنفيذ الإسناد يحتاج متصفحاً يشغّل صفحات المنصة التفاعلية.</div></noscript>
      ${capped ? `<div class="alert info" style="margin-bottom:.8rem">${icon('list')}<div>تُعرض أول ${n0(lim)} فقط لتبقى الدفعة قابلة للتنفيذ. أسنِد هذه الدفعة ثم أعد فتح الشاشة لبقية القائمة.</div></div>` : ''}
      <div id="asg-result"></div>
      ${card(`${bar}<div class="tblwrap">
        <table class="rtbl asg-tbl" style="width:100%;border-collapse:collapse;min-width:${k === 'allocation' ? '720px' : '860px'}">
          <thead><tr>${headCells}</tr></thead>
          <tbody>${list.rows.map(rowTpl).join('')}</tbody>
        </table>
        ${list.count ? '' : emptyState}</div>`)}
      <div class="asg-hint">الإسناد داخل ${esc(sectorName)} فقط — الإدارة تتبع قطاعها، وأي محاولة خارجه تُرفض مع بيان السبب.</div>
    </div>`;

  return layout({
    user, active: 'org', title: 'إسناد العمل إلى الإدارات',
    subtitle: `${sectorName} · اختر ما يخص إدارة واحدة ثم أسنِده دفعة واحدة`,
    body, scripts: ['/static/pages/org-tree.js'],
  });
}

// ═══════════════════════ التنسيق ═══════════════════════
const PAGE_CSS = `
.ot-wrap{font-size:13px}
.sec-h{display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap;margin:1.3rem .1rem .55rem}
.sec-t{font-size:var(--fs-title);font-weight:800;color:var(--ink2)}
.sec-s{font-size:var(--fs-meta);color:var(--muted)}

/* ── بطاقة صحة الهيكل ── */
.oh-card{overflow:hidden}
.oh-head{display:flex;gap:1.1rem;align-items:center;flex-wrap:wrap;padding:1rem 1.1rem;border-bottom:1px solid var(--line)}
.oh-score{flex:0 0 auto;width:104px;text-align:center;border-radius:14px;padding:.55rem .4rem;border:1px solid var(--line);background:var(--bg)}
.oh-num{font-size:2.5rem;font-weight:800;line-height:1;letter-spacing:-.03em}
.oh-of{font-size:10.5px;color:var(--muted);margin-top:.15rem}
.oh-bad .oh-num{color:var(--red)}.oh-bad{background:#fef2f2;border-color:#fecaca}
.oh-watch .oh-num{color:var(--amber)}.oh-watch{background:#fffbeb;border-color:#fde68a}
.oh-good .oh-num{color:var(--green)}.oh-good{background:#f0fdf4;border-color:#bbf7d0}
.oh-tx{flex:1 1 240px;min-width:0}
.oh-cap{font-size:var(--fs-micro);font-weight:800;letter-spacing:.04em;color:var(--muted)}
.oh-lbl{font-size:var(--fs-page);font-weight:800;color:var(--ink2);display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin:.1rem 0 .15rem}
.oh-headline{font-size:var(--fs-body);color:var(--muted);line-height:1.7}
.oh-sums{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem}
.oh-sum{font-size:var(--fs-meta);color:var(--muted);background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:.15rem .6rem}
.oh-sum b{color:var(--ink2)}
.oh-sum-later{border-style:dashed}
.oh-tot{flex:0 0 auto;display:flex;flex-direction:column;gap:.15rem;font-size:var(--fs-meta);color:var(--muted);
  border-inline-start:1px solid var(--line);padding-inline-start:1rem}
.oh-tot span{display:inline-block;min-width:52px}
.oh-tot b,.oh-tot .tnum{font-weight:800;color:var(--ink2)}
.oh-list{display:flex;flex-direction:column}
.oh-chk{border-bottom:1px solid var(--line)}
.oh-chk:last-child{border-bottom:none}
.oh-chk-h{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;padding:.6rem 1.1rem;font-size:var(--fs-body)}
details.oh-chk>summary{cursor:pointer;list-style:none}
details.oh-chk>summary::-webkit-details-marker{display:none}
details.oh-chk>summary::after{content:"▾";color:var(--faint);font-size:10px;margin-inline-start:auto;flex:none}
details.oh-chk[open]>summary::after{transform:rotate(180deg);display:inline-block}
details.oh-chk>summary:hover{background:#fbfcfe}
details.oh-chk>summary:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
.oh-fire .oh-ct{font-weight:800;color:var(--ink2)}
.oh-clean,.oh-later{background:#fcfdfe}
.oh-clean .oh-ct,.oh-later .oh-ct{color:var(--muted);font-weight:700}
.oh-cd{font-size:var(--fs-meta);color:var(--muted);flex:1 1 220px;min-width:0}
.oh-cn{font-weight:800;color:var(--ink2);background:#eef1f7;border-radius:999px;padding:.05rem .55rem;font-size:var(--fs-body)}
.oh-ok{font-size:var(--fs-meta);color:var(--green);font-weight:700}
.oh-sev{font-size:10px;font-weight:800;border-radius:6px;padding:.12rem .45rem;flex:none;letter-spacing:.02em}
.oh-high{background:#fee2e2;color:#b91c1c}
.oh-medium{background:#fef3c7;color:#92400e}
.oh-low{background:#f1f5f9;color:#475569}
.oh-chk-b{padding:.2rem 1.1rem 1rem;background:#fbfcfe}
.oh-items{list-style:none;margin:0 0 .6rem;padding:0;display:flex;flex-direction:column;gap:.1rem;
  max-height:280px;overflow-y:auto;overscroll-behavior:contain}
.oh-items li{display:flex;gap:.6rem;align-items:baseline;padding:.3rem .5rem;border-radius:8px;background:#fff;border:1px solid var(--line)}
.oh-it-n{font-weight:700;color:var(--ink2);font-size:var(--fs-body);flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oh-it-h{font-size:var(--fs-meta);color:var(--muted);flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oh-more{font-size:var(--fs-meta);color:var(--faint);margin:0 0 .35rem}
.oh-fix{font-size:var(--fs-body);color:var(--ink2);display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.oh-fix b{color:var(--muted);font-weight:800}
.oh-go{flex:none}
.oh-foot{padding:.55rem 1.1rem;font-size:var(--fs-micro);color:var(--faint);background:var(--bg);border-top:1px solid var(--line)}

/* ── لوحة غير المُسنَد ── */
.ua-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:var(--gap)}
.ua-card{overflow:hidden}
.ua-head{display:flex;align-items:center;gap:.5rem;padding:.7rem .9rem;border-bottom:1px solid var(--line);background:var(--bg)}
.ua-dot{width:10px;height:10px;border-radius:3px;flex:none}
.ua-name{font-weight:800;color:var(--ink2);font-size:var(--fs-ui);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ua-deps{font-size:var(--fs-meta);color:var(--muted);flex:none}
.ua-body{padding:.65rem .9rem;display:flex;flex-direction:column;gap:.7rem}
.ua-row{display:flex;flex-direction:column;gap:.28rem}
.ua-r1{display:flex;align-items:baseline;gap:.5rem;justify-content:space-between}
.ua-lbl{font-size:var(--fs-body);font-weight:700;color:var(--ink2);flex:0 0 auto}
.ua-nums{font-size:var(--fs-meta);color:var(--muted);flex:1 1 auto;text-align:end;min-width:0}
.ua-open{color:var(--red);font-size:var(--fs-ui)}
.ua-ok{color:var(--green);font-weight:700}
.ua-bar{height:9px;border-radius:999px;background:#fde68a;overflow:hidden}
.ua-cool .ua-bar{background:#eef1f7}
.ua-fill{display:block;height:100%;background:var(--green);border-radius:999px}
.ua-none .ua-nums{color:var(--faint)}
.ua-r2{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;font-size:var(--fs-meta);color:var(--muted)}
.ua-pct{flex:0 0 auto;font-weight:700}
.ua-hot .ua-pct{color:#92400e}
.ua-mline{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ua-money{font-weight:800;color:var(--ink2);white-space:nowrap}
.ua-go{flex:none}
.ua-note{font-size:var(--fs-meta);color:var(--muted);border-top:1px dashed var(--line);padding-top:.55rem;
  display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}

/* ── شاشة الإسناد ── */
.asg-bar{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;
  padding:.6rem .9rem;border-bottom:1px solid var(--line);background:var(--surface)}
/* عند وجود تحديد يطفو شريط الإجراء فوق الصفحة: قائمة ١٠٠ صف لا تُقاد من شريط اختفى للأعلى.
   (position:sticky لا يعمل هنا: الصفحة تُمرَّر من النافذة بينما وعاء المحتوى overflow:auto لا يمرّر.)
   يترك مكان زر المساعد العائم في أقصى اليسار، ومكان القائمة الجانبية في أقصى اليمين. */
.asg-bar.float{position:fixed;z-index:30;bottom:16px;
  inset-inline-start:calc(250px + 1.4rem);inset-inline-end:calc(1.4rem + 58px);
  border:1px solid var(--line);border-bottom:1px solid var(--line);border-radius:14px;box-shadow:var(--sh)}
.asg-barwrap{transition:min-height .12s}
.asg-all{display:flex;align-items:center;gap:.35rem;font-size:var(--fs-body);font-weight:700;color:var(--ink2);cursor:pointer}
.asg-cnt{font-size:var(--fs-meta);color:var(--muted)}
.asg-cnt b{color:var(--ink2)}
.asg-sp{flex:1 1 auto}
.asg-dep{min-width:200px;max-width:100%;font-size:var(--fs-body);padding:.35rem .6rem}
.asg-nodep{font-size:var(--fs-meta);color:#92400e}
.asg-sum{font-size:var(--fs-body);font-weight:700;color:var(--ink2)}
.asg-bar .btn:disabled{opacity:.45;box-shadow:none;cursor:not-allowed}
.asg-state{color:var(--faint)}
.asg-code{font-size:10.5px;color:var(--faint);background:var(--bg);border-radius:5px;padding:.05rem .35rem;flex:none}
.asg-tbl tbody tr.done{opacity:.55}
.asg-tbl tbody tr.bad{background:#fef2f2}
.asg-state{font-size:var(--fs-meta);font-weight:700}
.asg-state.ok{color:var(--green)}
.asg-state.err{color:var(--red);font-weight:400;line-height:1.6;display:inline-block}
.asg-hint{font-size:var(--fs-micro);color:var(--faint);margin-top:.6rem;padding:0 .2rem}
.asg-cb{width:15px;height:15px;flex:none;accent-color:var(--brand);cursor:pointer}

/* ── الشجرة ── */
/* الصف كان يمتد على ١٤٤٠ بكسل: الاسم يميناً والبيانات أقصى اليسار، فيبقى نحو ٤٠٪ فراغاً
   في المنتصف والعين تقفز فوقه. حدٌّ للعرض يجعل الصف يُقرأ كسطر واحد لا كشريط ممدود —
   **متوسَّطاً** في بطاقته: الحدّ الملتصق بحافة يترك فراغاً أعورَ على الحافة الأخرى يُقرأ عطلاً. */
#tree .card>div{max-width:1080px;margin-inline:auto}
/* زر وضع التعديل — القراءة هي الأصل، والتعديل يُطلَب */
.ot-editbtn{font-size:12px;font-weight:700;text-decoration:none;padding:.34rem .8rem;border-radius:9px;
  border:1px solid var(--line);background:var(--surface);color:var(--brand);white-space:nowrap}
.ot-editbtn:hover{background:#f5f8ff;border-color:#c3d0ea}
.ot-editbtn.on{background:var(--brand);border-color:var(--brand);color:#fff}
/* فحص الجودة يُطوى: كان يحتل أول شاشة كاملة قبل أن يرى المستخدم فرعاً واحداً */
.ot-diag{margin-top:1.1rem;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.ot-diag>summary{cursor:pointer;list-style:none;padding:.7rem 1rem;font-size:12.5px;font-weight:700;color:var(--ink2)}
.ot-diag>summary::-webkit-details-marker{display:none}
.ot-diag>summary::after{content:"▾";float:left;color:var(--muted);font-size:11px}
.ot-diag[open]>summary{border-bottom:1px solid var(--line)}
.ot-diagn{font-weight:400;color:var(--muted);margin-inline-start:.5rem}
.ot-diagn .tnum{font-weight:800;color:var(--ink2)}
.ot-ul{list-style:none;margin:0;padding:0 1.4rem 0 0;position:relative}
/* العمود الفقري للشجرة على يمين الفرع — اتجاه القراءة العربي */
.ot-ul::before{content:"";position:absolute;top:0;bottom:.9rem;right:.55rem;width:1px;background:var(--line)}
.ot-li{position:relative;padding:.3rem 0}
.ot-li::before{content:"";position:absolute;top:1.15rem;right:.55rem;width:.75rem;height:1px;background:var(--line)}
.ot-det>summary{list-style:none;cursor:pointer}
.ot-det>summary::-webkit-details-marker{display:none}
.ot-det>summary::before{content:"▾";position:absolute;right:-1.05rem;top:.75rem;font-size:10px;color:var(--muted);transition:transform .15s}
.ot-det:not([open])>summary::before{transform:rotate(90deg)}
/* البيانات تتبع الاسم ولا تُنفى إلى الحافة المقابلة: التوزيع «بين الطرفين» كان يترك فجوةً
   بعرض نصف الصف بين «إدارة الابتكار» وعدد فريقها، فتقفز العين فوق فراغٍ لتصل إلى رقم. الشجرة
   تُقرأ سطراً سطراً لا عموداً عمودياً، فالمكان الصحيح للرقم هو جوار اسمه. وأدوات التعديل وحدها
   تُنفى إلى الطرف الآخر (ot-acts) لأنها إجراء لا خبر. */
.ot-node{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .8rem;
  background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:.5rem .75rem;position:relative}
/* الإدارة والوحدة تُحيطان مضمونهما بدل أن تمتدّا ألف بكسل فارغ: صندوقٌ عرضه ألفٌ ومحتواه ثلاثمئة
   يُقرأ جدولاً ناقص الأعمدة. والقطاع يبقى ممتداً لأنه شريطُ حاوية لا صفَّ بيانات — فيبقى التدرّج
   مرئياً: شريطٌ عريض تحته صناديق تتبع مقاسها. */
.ot-dept,.ot-unit{width:fit-content;max-width:100%}
.ot-node:hover{border-color:#c9d3e8}
.ot-det>summary:focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:10px}
.ot-main{display:flex;align-items:center;gap:.5rem;min-width:0}
.ot-name{font-weight:800;color:var(--ink2)}
.ot-kind{font-size:10px;font-weight:800;letter-spacing:.04em;color:var(--muted);
  background:var(--bg);border-radius:5px;padding:.1rem .35rem;flex:none}
.ot-dot{width:10px;height:10px;border-radius:3px;flex:none}
.ot-meta{font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
.ot-lead{color:var(--ink2);font-weight:700}
.ot-lead.ot-none{color:var(--faint);font-weight:400}
.ot-count{font-weight:800;color:var(--ink2)}
.ot-word{color:var(--muted)}
/* أهل الإدارة: رقاقات هادئة بالحرف الأول والاسم. الغاية أن يُقرأ الهيكل كخريطة ناس لا
   كجدول أعداد — والمسمّى الوظيفي في التلميح كي لا يزدحم السطر. */
.ot-people{display:flex;align-items:flex-start;gap:.55rem;margin:.35rem 1.4rem .15rem 0;
  width:fit-content;max-width:100%;
  padding:.5rem .6rem;background:linear-gradient(180deg,#fbfcfe,var(--surface));
  border:1px solid var(--line);border-radius:10px}
.ot-plabel{flex:0 0 auto;font-size:var(--fs-micro);color:var(--muted);padding-top:.22rem;
  border-inline-end:1px solid var(--line);padding-inline-end:.55rem;white-space:nowrap}
.ot-plist{flex:1 1 auto;min-width:0;display:flex;flex-wrap:wrap;gap:.3rem}
.ot-p{display:inline-flex;align-items:center;gap:.32rem;background:var(--surface);
  border:1px solid var(--line);border-radius:999px;padding:.12rem .5rem .12rem .18rem;max-width:100%}
.ot-p:hover{border-color:#c9d3e8}
.ot-pav{width:19px;height:19px;flex:none;border-radius:50%;display:grid;place-items:center;
  font-size:10px;font-weight:800;color:#fff;background:var(--brand-grad)}
.ot-pn{font-size:var(--fs-micro);color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ot-pmore{display:inline-flex;align-items:center;font-size:var(--fs-micro);color:var(--muted);
  background:var(--bg);border:1px dashed var(--line);border-radius:999px;padding:.12rem .55rem}
/* رقاقات العدد مصمَّمة لخلفية فاتحة، وشريط الجذر تدرّجٌ داكن — فكان الرقم واسمه يذوبان فيه
   ولا يُقرآن. اللون يُورَّث داخل الشريط بدل أن يُفرَض من صنف عام. */
.ot-root .ot-count{color:#fff}
.ot-root .ot-word{color:rgba(255,255,255,.85)}
.ot-w{background:var(--bg);border-radius:6px;padding:.1rem .45rem;white-space:nowrap}
.ot-idle{color:#92400e;background:#fef3c7;border-radius:6px;padding:.1rem .45rem;font-weight:700;white-space:nowrap}
.ot-idle:hover{background:#fde68a}
/* القطاع والإدارة كانا صفّين متطابقين في الوزن والخلفية، والفرق خيطٌ على الحافة وحده —
   فتبدو الإدارة شقيقةً لقطاعها لا ابنةً له. الآن القطاع حاوية لها وزنها، والإدارة أخفّ
   وأصغر بداخلها: التدرّج يُقرأ قبل أن تُقرأ الكلمات.
   ملاحظة: هذه الأنماط تُضمَّن في صفحة الإسناد أيضاً، فلا يُذكر فيها اسم إدارة أو قطاع بعينه —
   الاسم في تعليقٍ هنا يظهر في صفحةٍ يجب ألّا تحمل أسماء من خارج قطاعها (يمسكه اختبار الإسناد). */
.ot-sector{border-inline-start:3px solid var(--brand);background:linear-gradient(90deg,#f7f9fd,var(--surface) 55%);
  padding:.62rem .8rem}
.ot-sector .ot-name{font-size:14.5px}
.ot-dept{border-inline-start:3px solid var(--brand2);background:var(--surface);padding:.42rem .7rem}
.ot-dept .ot-name{font-size:12.5px;font-weight:700}
.ot-dept .ot-kind{opacity:.75}
.ot-unit{background:var(--bg)}
.ot-empty{font-size:11.5px;color:var(--faint);padding:.35rem 1.4rem .2rem 0}
.ot-acts{display:flex;gap:.3rem;align-items:center;flex-wrap:wrap;margin-inline-start:auto}
.ot-act{font-size:10.5px;font-family:inherit;color:var(--muted);background:var(--bg);
  border:1px solid var(--line);border-radius:6px;padding:.15rem .45rem;cursor:pointer}
.ot-act:hover{border-color:#c9d3e8;color:var(--ink2)}
.ot-act.ot-danger:hover{border-color:var(--red);color:var(--red)}
.ot-sel{padding:.15rem .3rem}
/* المسؤول: قائمة تُقرأ كنص — الاسم بارز حين يوجد، و«بلا مسؤول معيَّن» باهت لكنه قابل للنقر */
.ot-mgr{font-size:11.5px;font-weight:700;color:var(--ink2);background:transparent;border-color:transparent;max-width:200px}
.ot-mgr:hover{background:var(--bg);border-color:var(--line)}
.ot-mgr:focus{outline:none;border-color:var(--brand)}
.ot-mgr-none{font-weight:400;color:var(--faint);border-style:dashed;border-color:var(--line)}
.ot-add{display:flex;gap:.35rem;align-items:center;padding:.15rem 0}
.ot-in{flex:1;min-width:0;max-width:320px;font-family:inherit;font-size:12px;
  border:1px dashed var(--line-strong,#c4cddb);border-radius:8px;padding:.35rem .6rem;background:transparent;color:var(--ink2)}
.ot-in:focus{outline:none;border-color:var(--brand);border-style:solid}
.ot-btn{font-size:11.5px;font-family:inherit;color:#fff;border:none;border-radius:8px;
  padding:.35rem .7rem;cursor:pointer;background:var(--brand-grad)}
.ot-root{display:flex;align-items:center;gap:.55rem;font-weight:800;font-size:14.5px;
  background:var(--brand-grad);color:#fff;border-radius:10px;padding:.6rem .9rem;margin-bottom:.2rem}
@media(max-width:640px){
  .ot-node{gap:.3rem}.ot-meta{width:100%}
  .oh-head{gap:.7rem;padding:.8rem}
  .oh-score{width:84px}.oh-num{font-size:1.9rem}
  .oh-tot{border-inline-start:none;padding-inline-start:0;flex-direction:row;gap:.8rem;flex-wrap:wrap;width:100%}
  .oh-tot span{min-width:0}
  .oh-chk-h{padding:.55rem .8rem;gap:.4rem}
  .oh-chk-b{padding:.2rem .8rem .8rem}
  .oh-cd{flex-basis:100%}
  .asg-bar.float{inset-inline-start:10px;inset-inline-end:calc(10px + 58px);bottom:10px;padding:.5rem .6rem}
  .asg-dep{min-width:0;flex:1 1 100%}
}`;
