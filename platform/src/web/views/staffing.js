// ── مساحة عمل التسكين (v5.26) ────────────────────────────────────────────────
// المصفوفة قلب المنتج: موظف × ١٢ شهراً في جدول واحد لاصق الرأس والعمود، أربع بلاطات
// قرار فقط، وفلاتر سنة/إدارة خادمية وجهة/حالة/بحث عميلة تنعكس في الرابط.
// القراءة كلها من staffingRoster + gapsFor — لا كتابة هنا؛ الكتابة كلها من عميل الصفحة
// (public/pages/staffing.js) عبر واجهات الخدمة القائمة: خلية/مدى/خريطة أشهر/دفعة ذرّية.
// العقود المثبَّتة باختبارات قائمة (لا تُكسر):
//   • شرائح `/app/staffing?sector=…` لقطاعات التسليم وحدها (support-unit-surfaces).
//   • اسم الموظف يليه سطر وحدته خلال ≤300 حرف (المصدر نفسه).
//   • «لا أعضاء ضمن نطاقك» حرفياً للحالة الفارغة (department-scope-people).
//   • مفاتيح __SANAD: workBuckets/staffYear بأسمائها (internal-work-staffing).
//   • مرساة الجولة `#staff-q` لكل الأدوار (guide-page)، وأربع بلاطات `kpi4-tile` بالضبط
//     (staffing-matrix-page) — لذلك لا يظهر النص «kpi4-tile» في أي موضع آخر (ولا في CSS).
import { layout, card, pill } from '../layout.js';
import { icon } from '../icons.js';
import { all } from '../../core/db/index.js';
import { staffingRoster } from '../../modules/org/org.js';
import { gapsFor, activeInMonth } from '../../modules/org/staffing-gaps.js';
import { UTIL_BANDS } from '../../modules/pmo/capacity.js';
import { ALLOC_YEAR_BACK, ALLOC_YEAR_AHEAD } from '../../modules/pmo/projects.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { departmentScope } from '../../core/rbac/departments.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { isDelivery } from '../../core/org/kind.js';
import { G, WORK_BUCKET_AR } from '../i18n/glossary.js';
import { esc, ddWrap, ddRows } from './_shared.js';
import { MONTHS_AR, monthLabelDual, nowDot } from '../../core/i18n/time.js';
import { countAr, monthWord } from '../../core/i18n/plural.js';

const N = (v) => Number(v) || 0;

export async function staffingPage(user, opts = {}) {
  // نفس بوابتي الصفحة القديمة حرفياً: «تسكين جديد» لمن يدير الموظفين، وتحرير الخلايا لمن
  // يدير المشاريع — والخادم يبقى الحكم لكل بند على حدة (mayEditAllocation).
  const canManage = !!(can(user, 'create', 'employee') || can(user, 'update', 'employee'));
  const canStaff = !!can(user, 'update', 'project');
  const canEdit = canManage || canStaff;

  // سنة الخطة من الرابط ضمن نافذة التسكين المسموحة (سنة خلت + ثلاث قادمة) — ما خرج عنها
  // يعود للسنة الحية بلا انفجار (رابط معطوب لا يستحق شاشة خطأ).
  const nowY = new Date().getUTCFullYear();
  const yMin = nowY - ALLOC_YEAR_BACK, yMax = nowY + ALLOC_YEAR_AHEAD;
  const reqY = Number(String(opts.year ?? '').trim());
  const wantYear = Number.isInteger(reqY) && reqY >= yMin && reqY <= yMax ? reqY : nowY;

  // نفس فصل صفحة «الفريق»: الأسماء تُنسب لوحداتها كلها (موظف الخدمات المشتركة باسم وحدته)،
  // وشرائح التصفية من قطاعات التسليم وحدها.
  const allSec = await all('SELECT id, name_ar, color, kind FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order');
  const deliverySec = allSec.filter(isDelivery);
  const sectorNames = Object.fromEntries(allSec.map((s) => [s.id, s.name_ar]));

  const { year, sector, department, currentMonth, roster, summary } = await staffingRoster(user, {
    sector: opts.sector, year: wantYear, department: opts.dept, month: opts.month,
  });
  const live = currentMonth >= 1;
  const nowIdx = live ? currentMonth - 1 : -1;
  const curName = live ? MONTHS_AR[currentMonth - 1] : 'الشهر الحالي';

  // الفجوات التاريخية: «الآن» هو شهر الكشف نفسه (يُثبَّت في الاختبارات عبر opts.month)،
  // وسنة بلا «آن» تُقاس على ساعة اليوم (ماضية = كلها ماضٍ، قادمة = لا ماضي لها).
  const gapNow = live ? new Date(Date.UTC(year, currentMonth - 1, 15)) : new Date();
  const gaps = gapsFor(roster, year, gapNow);
  const gapsByEmp = gaps.byEmp;

  // منتقي المشاريع للعميل (درج الخلية/الموظف و«تسكين جديد») — نطاق قراءة القارئ نفسه، كما كان.
  const pf = scopeFilter(user, 'project', 'read',
    { deptCol: 'department_id', sectorCol: 'sector_id', ownerCol: 'owner_user_id', memberCol: 'id' });
  const projWhere = ["deleted_at IS NULL", "status IN ('IN_PROGRESS','PLANNED')"];
  const projParams = [];
  if (pf.clause !== '1=1') { projWhere.push(pf.clause); projParams.push(...pf.params); }
  if (sector) { projWhere.push('sector_id = ?'); projParams.push(sector); }
  const projects = await all(`SELECT id, name_ar, sector_id FROM project
     WHERE ${projWhere.join(' AND ')} ORDER BY name_ar`, projParams);

  // إدارات مرشِّح `?dept=` — مرآة peopleScope: قارئ الإدارات يرى إداراته وحدها، وقارئ
  // القطاع/الشركة إدارات القطاع المعروض (أو الكل حين لا قطاع). الخادم فاشل-مغلقاً على كل حال.
  const byDepartment = effectiveScope(user, 'read', 'employee') === 'department';
  const myDeps = byDepartment ? departmentScope(user) : [];
  let depts = await all('SELECT id, name_ar, sector_id FROM department WHERE active = 1 AND deleted_at IS NULL ORDER BY name_ar');
  if (byDepartment) depts = depts.filter((d) => myDeps.includes(d.id));
  else if (sector) depts = depts.filter((d) => d.sector_id === sector);

  const activeR = roster.filter((e) => e.active !== 0);
  const fte = (v) => String(Math.round((v || 0) * 100) / 100);
  const uTone = (u) => u > UTIL_BANDS.OVER_ABOVE ? 'var(--red)' : u >= UTIL_BANDS.FREE_BELOW ? 'var(--green)' : u > 0 ? 'var(--amber)' : 'var(--faint)';

  // ── (١) أربع بلاطات قرار — لا خامسة ──────────────────────────────────────────
  // سنة غير حية: «الآن» بلا معنى (decision-log ق٩) فتتكيف البلاطات: متوسط السنة، بلا تسكين
  // طوال السنة، وذروة فوق الحد — بدل مقاييس شهرٍ لا وجود له.
  const avg = live
    ? (summary.capacityFte ? Math.round((summary.assignedNowFte / summary.capacityFte) * 100) : 0)
    : (activeR.length ? Math.round(activeR.reduce((a, e) => a + N(e.annualUtil), 0) / activeR.length) : 0);
  const benchList = live ? activeR.filter((e) => N(e.currentUtil) === 0) : activeR.filter((e) => N(e.staffedMonths) === 0);
  const overList = live ? activeR.filter((e) => N(e.currentUtil) > UTIL_BANDS.OVER_ABOVE) : activeR.filter((e) => N(e.peak) > UTIL_BANDS.OVER_ABOVE);
  const benchVal = live ? summary.benchNow : benchList.length;
  const overVal = live ? summary.overloadedNow : overList.length;
  const gapsSub = gaps.activeMonths
    ? `من ${countAr(gaps.activeMonths, { one: 'شهر نشط واحد', two: 'شهرين نشطين', few: 'أشهر نشطة', many: 'شهراً نشطاً' })} · أشهر ${year} الماضية`
    : `لا أشهر ماضية في ${year} بعد`;

  const tile = (label, val, sub, o = {}) => `<div class="card kpi4-tile${o.dd ? ' cardclick' : ''}"${o.dd ? ` role="button" tabindex="0" data-dd="${o.dd}"` : ''}${o.title ? ` title="${esc(o.title)}"` : ''}>
      <div class="l">${label}${o.dd ? ' <span style="color:var(--faint)">⊕</span>' : ''}</div>
      <div class="v tnum"${o.tone ? ` style="color:${o.tone}"` : ''}>${val}</div>
      ${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const band = `<div class="kpi4">
    ${tile(live ? 'متوسط الإشغال' : `متوسط إشغال ${year}`, avg + '%',
    live ? `${fte(summary.assignedNowFte)} من ${summary.capacityFte} طاقة كاملة · ${esc(curName)}` : 'متوسط السنة للموظفين النشطين',
    { tone: uTone(avg) })}
    ${tile(live ? G.onBench : 'بلا تسكين طوال السنة', benchVal,
    live ? `بلا أي بند في ${esc(curName)}` : `لا شهر مُسكَّن واحد في ${year}`,
    { dd: 'bench', tone: benchVal ? 'var(--amber)' : 'var(--green)' })}
    ${tile(G.overloaded, overVal,
    live ? `تجاوز ${UTIL_BANDS.OVER_ABOVE}% في ${esc(curName)}` : `ذروة فوق ${UTIL_BANDS.OVER_ABOVE}% خلال ${year}`,
    { dd: 'over', tone: overVal ? 'var(--red)' : 'var(--green)' })}
    ${tile('الفجوات التاريخية', gaps.gapMonths, gapsSub,
    { dd: 'gaps', tone: gaps.gapMonths ? 'var(--amber)' : 'var(--green)', title: 'تُنسب الفجوات إلى القطاع/الإدارة الحالية للموظف' })}
  </div>`;

  const nameRow = (e, right) => `<div class="dd-row"><span>${esc(e.name_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${esc(e.job_title || '—')}</span></span><b class="tnum">${right}</b></div>`;
  const gapRows = roster.filter((e) => (gapsByEmp[e.id] || []).length)
    .sort((a, b) => gapsByEmp[b.id].length - gapsByEmp[a.id].length || String(a.name_ar).localeCompare(String(b.name_ar), 'ar'))
    .map((e) => {
      const ms = gapsByEmp[e.id];
      return `<div style="padding:.45rem 0;border-bottom:1px dashed var(--line)">
        <div style="display:flex;justify-content:space-between;gap:.8rem;align-items:baseline">
          <span style="font-size:var(--fs-body);font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name_ar)} <span style="color:var(--faint);font-size:10.5px;font-weight:400">· ${esc(e.job_title || '—')}</span></span>
          <b class="tnum" style="color:var(--amber);font-size:12px;flex:0 0 auto">${monthWord(ms.length)}</b></div>
        <div style="font-size:11px;color:var(--muted)">${ms.map((m) => MONTHS_AR[m - 1]).join('، ')}</div></div>`;
    }).join('');
  const dds = [
    ddWrap('bench', live ? G.onBench : 'بلا تسكين طوال السنة',
      live ? `${esc(curName)} — بلا أي بند تسكين أو فرصة` : `سنة ${year} — لا شهر مُسكَّن واحد`,
      ddRows(benchList.map((e) => nameRow(e, '0%')))),
    ddWrap('over', G.overloaded,
      live ? `${esc(curName)} — تجاوز ${UTIL_BANDS.OVER_ABOVE}% من الطاقة` : `ذروة السنة فوق ${UTIL_BANDS.OVER_ABOVE}%`,
      ddRows(overList.map((e) => nameRow(e, (live ? N(e.currentUtil) : N(e.peak)) + '%')))),
    ddWrap('gaps', 'الفجوات التاريخية',
      `أشهر ${year} الماضية التي كان الموظف نشطاً فيها بلا أي تسكين — تُنسب إلى قطاعه وإدارته الحاليين`,
      gapRows || `<div class="alert ok">✓ لا فجوات — كل أشهر الماضي المعروضة مُسكَّنة</div>`),
  ].join('');

  // ── (٢) شرائح القطاع (نطاق شركة، قطاعات تسليم فقط) — شكل الرابط مثبَّت ─────────
  const yq = year !== nowY ? `&year=${year}` : '';
  const secChips = user.scope === 'company' ? `<div class="chips"><span class="lbl">القطاع:</span>
    <a href="/app/staffing${year !== nowY ? `?year=${year}` : ''}" class="chip ${sector ? '' : 'on'}">${G.all}</a>
    ${deliverySec.map((s) => `<a href="/app/staffing?sector=${s.id}${yq}" class="chip ${sector === s.id ? 'on' : ''}"><span class="dot" style="background:${s.color || 'var(--brand)'}"></span>${esc(s.name_ar)}</a>`).join('')}
  </div>` : '';

  // ── (٣) شريط الفلاتر — سنة/إدارة خادمية، جهة/حالة/بحث عميلة ────────────────────
  const yearSel = `<select id="mx-year" class="input" aria-label="سنة خطة التسكين" title="سنة خطة التسكين">
    ${Array.from({ length: yMax - yMin + 1 }, (_, k) => yMin + k).map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>سنة ${y}</option>`).join('')}
  </select>`;
  const deptGroups = {};
  for (const d of depts) (deptGroups[d.sector_id || ''] ||= []).push(d);
  const deptOpt = (d) => `<option value="${esc(d.id)}"${department === d.id ? ' selected' : ''}>${esc(d.name_ar)}</option>`;
  const deptOptions = Object.keys(deptGroups).length > 1
    ? allSec.filter((s) => deptGroups[s.id]).map((s) => `<optgroup label="${esc(s.name_ar)}">${deptGroups[s.id].map(deptOpt).join('')}</optgroup>`).join('') + (deptGroups[''] || []).map(deptOpt).join('')
    : depts.map(deptOpt).join('');
  const deptSel = depts.length ? `<select id="mx-dept" class="input" aria-label="ترشيح بالإدارة" title="ترشيح بالإدارة">
    <option value="">كل الإدارات</option>${deptOptions}</select>` : '';
  // «جهة» من حمولة الكشف نفسها: ما يظهر في الصفوف هو ما يُرشَّح به — لا قائمة موازية.
  const loadProjects = [...new Map(roster.flatMap((e) => e.projects.filter((p) => p.projectId).map((p) => [p.projectId, p.name]))).entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'ar'));
  const targetSel = `<select id="mx-target" class="input" aria-label="ترشيح بجهة التسكين" title="ترشيح بجهة التسكين">
    <option value="">كل الجهات</option>
    <optgroup label="عمل داخلي">${Object.entries(WORK_BUCKET_AR).map(([k, v]) => `<option value="b:${k}">${esc(v)}</option>`).join('')}</optgroup>
    ${loadProjects.length ? `<optgroup label="مشروع">${loadProjects.map(([pid, nm]) => `<option value="p:${esc(pid)}">${esc(nm)}</option>`).join('')}</optgroup>` : ''}
  </select>`;
  const statusSeg = `<div class="seg" id="mx-status" role="group" aria-label="ترشيح بالحالة">
    ${[['all', 'الكل'], ['bench', 'غير مسكن'], ['avail', 'لديه سعة'], ['ok', 'ضمن الحد'], ['over', 'فوق الطاقة'], ['gap', 'فجوة تاريخية']]
    .map(([k, l], i) => `<button type="button" data-status="${k}"${i === 0 ? ' class="on"' : ''}>${l}</button>`).join('')}
  </div>`;
  const toolbar = `<div class="toolbar" style="margin-bottom:.8rem">
    ${yearSel}${deptSel}${targetSel}${statusSeg}
    <div class="search">${icon('search')}<input class="input" id="staff-q" aria-label="بحث بالاسم أو الدور" placeholder="ابحث بالاسم أو الدور…"></div>
    <div class="spacer"></div>
    ${canEdit ? `<button type="button" class="btn mx-selbtn" data-action="mx-select-toggle" aria-pressed="false" title="حدّد خلايا ثم طبّق إجراءً واحداً عليها">${icon('check')} تحديد متعدد</button>
    <button type="button" class="btn btn-primary" data-action="staff-new">${icon('userplus')} تسكين جديد</button>` : ''}
  </div>`;

  // ── (٤) المصفوفة ────────────────────────────────────────────────────────────
  const itemWord = (n) => countAr(n, { one: 'بند واحد', two: 'بندان', few: 'بنود', many: 'بنداً' });
  const bandOf = (v) => v <= 0 ? 'zero' : v < UTIL_BANDS.NEAR_FROM ? 'ok' : v <= UTIL_BANDS.OVER_ABOVE ? 'near' : 'over';
  const countsOf = (e) => {
    const c = Array(12).fill(0);
    for (const p of e.projects) for (const [m, f] of Object.entries(p.months)) {
      const i = Number(m) - 1;
      if (i >= 0 && i < 12 && Math.round(N(f) * 100) > 0) c[i]++;
    }
    return c;
  };
  const countsByEmp = Object.fromEntries(roster.map((e) => [e.id, countsOf(e)]));
  const statusOf = (e) => {
    if (e.active === 0) return 'off';
    if (live) {
      const u = N(e.currentUtil);
      if (u === 0) return 'bench';
      if (u > UTIL_BANDS.OVER_ABOVE) return 'over';
      if (u < UTIL_BANDS.FREE_BELOW) return 'avail';
      return 'ok';
    }
    if (N(e.staffedMonths) === 0) return 'bench';
    if (N(e.peak) > UTIL_BANDS.OVER_ABOVE) return 'over';
    if (N(e.annualUtil) < UTIL_BANDS.FREE_BELOW) return 'avail';
    return 'ok';
  };

  const rowOf = (e) => {
    const gapSet = new Set(gapsByEmp[e.id] || []);
    const counts = countsByEmp[e.id];
    const targets = [
      ...e.projects.filter((p) => p.bucket).map((p) => `b:${p.bucket}`),
      ...e.projects.filter((p) => p.projectId).map((p) => `p:${p.projectId}`),
    ].join(' ');
    const cells = MONTHS_AR.map((mn, i) => {
      const m = i + 1;
      const nowCls = i === nowIdx ? ' is-now' : '';
      if (!activeInMonth(e, year, m)) {
        return `<td class="mx-td${nowCls}"><span class="mx-na" title="${esc(`${mn} خارج فترة عمل ${e.name_ar}`)}"></span></td>`;
      }
      const v = N(e.months[i]);
      const n = counts[i];
      const gap = v === 0 && gapSet.has(m);
      const label = gap ? `${e.name_ar} — ${mn} ${year}: شهر ماضٍ بلا أي تسكين`
        : v === 0 ? `${e.name_ar} — ${mn} ${year}: بلا تسكين`
          : `${e.name_ar} — ${mn} ${year}: ${v}%${n ? ` · ${itemWord(n)}` : ''}`;
      const inner = gap ? '<span class="g">— غير مسكن</span>'
        : v === 0 ? '<span class="z">—</span>'
          : `<span class="tnum">${v}%</span>${n >= 2 ? `<span class="n">· ${itemWord(n)}</span>` : ''}`;
      return `<td class="mx-td${nowCls}"><button type="button" class="mx-cell ${gap ? 't-gap' : `t-${bandOf(v)}`}" data-action="cell" data-emp="${e.id}" data-m="${m}" data-v="${v}" data-n="${n}" aria-label="${esc(label)}">${inner}</button></td>`;
    }).join('');
    return `<tr data-emp="${e.id}" data-status="${statusOf(e)}" data-gap="${gapSet.size ? 1 : 0}" data-targets="${esc(targets)}" data-hay="${esc(`${e.name_ar} ${e.job_title || ''}`.toLowerCase())}">
      <th class="mx-emp" scope="row"><button type="button" class="mx-name" data-action="emp-drawer" data-emp="${e.id}" title="افتح خط ${esc(e.name_ar)} الزمني وبنوده">${esc(e.name_ar)}</button>${e.active === 0 ? ' ' + pill('غير نشط', 'slate') : ''}<span class="sub">${esc(e.job_title || '—')}${sector ? '' : ' · ' + esc(sectorNames[e.sector_id] || 'خارج القطاعات')}</span></th>
      ${cells}</tr>`;
  };

  const head = `<tr>
    <th class="mx-emp" scope="col">الموظف</th>
    ${MONTHS_AR.map((mn, i) => `<th class="mx-mh${i === nowIdx ? ' is-now' : ''}" scope="col"><span class="dotslot">${i === nowIdx ? nowDot(`${mn} — نحن هنا`) : ''}</span>${monthLabelDual(i)}</th>`).join('')}
  </tr>`;
  const matrixInner = roster.length
    ? `<table class="mx-tbl" aria-label="${G.monthlyStaffing} — ${year}">
        <thead>${head}</thead>
        <tbody id="mx-body">${roster.map(rowOf).join('')}
          <tr id="mx-none" hidden><td colspan="13"><div class="empty-state" style="padding:1.4rem 1rem">${icon('search')}<div class="t">لا نتائج بهذه المرشِّحات</div><div class="s">وسّع الحالة أو الجهة، أو امسح البحث.</div></div></td></tr>
        </tbody>
      </table>`
    : `<div class="empty-state">${icon('team')}<div class="t">لا أعضاء ضمن نطاقك</div><div class="s">أضِف موظفين من صفحة «الفريق» أو راجع صلاحيات حسابك.</div></div>`;

  // ── (٥) سطر الشرح — التدرجات الخمسة + «نحن هنا» ─────────────────────────────
  const legend = `<div class="mxleg">
    <span><i style="background:#fff;border:1px solid var(--line)"></i>بلا تسكين</span>
    <span><i style="background:#dcfce7"></i>ضمن الحد 1–100%</span>
    <span><i style="background:#fef3c7"></i>قرب الحد 101–110%</span>
    <span><i style="background:#fee2e2"></i>${G.overloaded} — فوق 110%</span>
    <span><i style="background:#fffdf4;border:1px dashed #eab308"></i>فجوة تاريخية — شهر ماضٍ بلا تسكين</span>
    ${live ? `<span>${nowDot()} ${esc(curName)} — نحن هنا</span>` : ''}
  </div>`;

  const matrixCard = card(`<div class="tblwrap" id="mx" style="max-height:calc(100dvh - 260px);overflow:auto;position:relative">${matrixInner}</div>${roster.length ? legend : ''}`);

  const style = `<style>
    .kpi4{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.7rem;margin-bottom:1rem}
    .kpi4>.card{padding:.75rem .95rem}
    .kpi4 .l{font-size:11px;color:var(--muted);font-weight:700}
    .kpi4 .v{font-size:var(--fs-num-md);font-weight:800;letter-spacing:-.02em;line-height:1.3}
    .kpi4 .s{font-size:10.5px;color:var(--faint);line-height:1.7}
    #mx{border-radius:var(--r) var(--r) 0 0;max-height:calc(100vh - 260px)}
    .mx-tbl{border-collapse:separate;border-spacing:0;width:100%;min-width:960px}
    .mx-tbl th,.mx-tbl td{border-bottom:1px solid var(--line)}
    .mx-tbl thead th{position:sticky;top:0;z-index:3;background:var(--surface);font-size:10px;font-weight:700;color:var(--muted);padding:.4rem .2rem;text-align:center;box-shadow:0 1px 0 var(--line)}
    .mx-mh{min-width:66px}
    .mx-mh .dotslot{display:flex;height:9px;align-items:center;justify-content:center}
    .mx-tbl th.mx-emp{position:sticky;inset-inline-start:0;background:var(--surface);z-index:2;text-align:start;padding:.4rem .8rem;min-width:190px;max-width:220px;border-inline-end:1px solid var(--line)}
    .mx-tbl thead th.mx-emp{z-index:4}
    .mx-name{border:none;background:none;cursor:pointer;font-family:inherit;font-weight:800;font-size:12.5px;color:var(--ink2);padding:0;text-align:start;transition:color .12s}
    .mx-name:hover{color:var(--brand)}
    .mx-name:focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:4px}
    .mx-emp .sub{display:block;font-size:10.5px;color:var(--muted);font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px}
    .mx-td{padding:2px 3px;text-align:center}
    .mx-tbl td.is-now,.mx-tbl th.is-now{background:#f5f8ff}
    .mx-cell{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;min-height:32px;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:700;line-height:1.35;padding:.15rem .2rem;background:transparent;transition:filter .12s,transform .1s,box-shadow .12s}
    .mx-cell:hover{filter:brightness(1.05);transform:translateY(-1px);box-shadow:var(--sh-sm)}
    .mx-cell:focus-visible{outline:2px solid var(--brand);outline-offset:1px;position:relative;z-index:1}
    .mx-cell .n{font-size:9px;font-weight:600;opacity:.85;white-space:nowrap}
    .mx-cell.t-zero .z{color:var(--faint);font-weight:400}
    .mx-cell.t-zero:hover{background:#eef1f7}
    .mx-cell.t-ok{background:#dcfce7;color:#166534}
    .mx-cell.t-near{background:#fef3c7;color:#92400e}
    .mx-cell.t-over{background:#fee2e2;color:#b91c1c}
    .mx-cell.t-gap{background:#fffdf4;border:1px dashed #eab308;color:#a16207}
    .mx-cell.t-gap .g{font-size:9px;font-weight:700;white-space:nowrap}
    .mx-na{display:block;height:32px;border-radius:8px;background:repeating-linear-gradient(45deg,#f6f7fb 0 6px,#eef1f7 6px 12px);opacity:.6}
    .mx-tbl tbody tr:hover th.mx-emp{background:#fafbfe}
    #mx.selecting .mx-cell{cursor:cell}
    .mx-cell.sel{box-shadow:inset 0 0 0 2px var(--brand),0 0 0 2px rgba(36,74,153,.18);filter:none}
    .mxleg{display:flex;gap:.85rem;flex-wrap:wrap;align-items:center;font-size:10.5px;color:var(--muted);padding:.55rem 1rem;border-top:1px solid var(--line)}
    .mxleg span{display:inline-flex;align-items:center;gap:.3rem}
    .mxleg i{display:inline-block;width:14px;height:9px;border-radius:3px;flex:none}
    .mx-selbtn[aria-pressed="true"]{background:var(--brand);color:#fff;border-color:transparent}
    /* عناصر يبنيها العميل (أدراج/شريط التحديد/رقاقات الأشهر) — أنماطها هنا كي تبقى صفحةً واحدة */
    .mchip{border:1px solid var(--line);background:#fff;color:var(--ink2);border-radius:999px;padding:.22rem .55rem;font-size:10.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .12s}
    .mchip:hover{border-color:#c9d3e8}
    .mchip.on{background:var(--brand);border-color:transparent;color:#fff;transform:scale(1.05)}
    .mgrid{display:flex;flex-wrap:wrap;gap:.3rem}
    .snrow{display:flex;gap:.4rem;align-items:center;font-size:12px;color:var(--muted);flex-wrap:wrap}
    .snrow select.input{width:auto}
    /* قاعدة display الصنفية تغلب سمة hidden — تُعاد هنا صراحةً لكل ما يُخفى ويُظهر من العميل */
    .mgrid[hidden],.snrow[hidden]{display:none}
    #mx-bar{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:55;display:flex;align-items:center;gap:.45rem;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--sh);padding:.5rem .8rem;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 2rem)}
    #mx-bar b{font-size:12px}
    .cd-row{display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px dashed var(--line)}
    .cd-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}
    .ed-mh,.ed-months{display:grid;grid-template-columns:repeat(12,1fr);direction:rtl;gap:2px}
    .ed-mh{font-size:8.5px;color:var(--faint);font-weight:700;text-align:center}
    .ed-mh span{direction:ltr;unicode-bidi:isolate}
    .ed-months input{width:100%;border:1px solid var(--line);border-radius:6px;padding:.18rem .05rem;font-size:10px;text-align:center;font-family:inherit;font-variant-numeric:tabular-nums;-moz-appearance:textfield}
    .ed-months input::-webkit-outer-spin-button,.ed-months input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
    .ed-months input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 2px rgba(36,74,153,.15)}
    .ed-months .ro{font-size:10px;color:var(--ink2);text-align:center;padding:.18rem 0;font-variant-numeric:tabular-nums}
    .ustrip{display:grid;grid-template-columns:repeat(12,1fr);direction:rtl;gap:2px;margin:.4rem 0 .2rem}
    .ustrip span{height:14px;border-radius:3px}
    .pv-t{width:100%;border-collapse:collapse;font-size:11.5px}
    .pv-t th{font-size:10px;color:var(--muted);text-align:start;padding:.3rem .4rem;border-bottom:1px solid var(--line);font-weight:700}
    .pv-t td{padding:.3rem .4rem;border-bottom:1px dashed var(--line)}
    @media(max-width:1024px){.mx-tbl th.mx-emp{min-width:140px;max-width:150px}.mx-emp .sub{max-width:130px}}
    @media(max-width:640px){#mx{max-height:calc(100vh - 210px)}}
  </style>`;

  const body = `
    ${style}${secChips}
    ${band}
    ${toolbar}
    ${matrixCard}
    <div style="font-size:10.5px;color:var(--faint);margin-top:.55rem">الأرقام من خطة التسكين الشهرية — وليست ساعات عمل فعلية. «${G.utilization}» = نسبة الوقت المحجوز من طاقة الشهر. «${G.opportunity}» = حمل مبدئي من فريق فرصة مفتوحة يُحتسب على ${esc(curName)} فقط. الفجوات التاريخية تُنسب إلى القطاع والإدارة الحاليين للموظف.</div>
    ${dds}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      emps:${JSON.stringify(Object.fromEntries(roster.map((e) => [e.id, {
    name_ar: e.name_ar, job_title: e.job_title || '', sector_id: e.sector_id || null,
    active: e.active, hire_date: e.hire_date || '', end_date: e.end_date || '',
    capacity_pct: e.capacity_pct ?? null,
    months: e.months, counts: countsByEmp[e.id], gaps: gapsByEmp[e.id] || [],
    targets: e.projects.map((p) => ({
      allocId: p.allocId, name: p.name, projectId: p.projectId, bucket: p.bucket || null, type: p.type || 'member',
      months: Object.fromEntries(Object.entries(p.months).map(([m, f]) => [m, Math.round(N(f) * 100)])),
    })),
    opps: e.opportunities.map((o) => ({ name: o.name, pct: o.pct })),
  }]))).replace(/</g, '\\u003c')},
      teamProjects:${JSON.stringify(projects.map((p) => ({ id: p.id, name_ar: p.name_ar, sector_id: p.sector_id }))).replace(/</g, '\\u003c')},
      ${/* بنود العمل الداخلي من المعجم نفسه — لا نسخة ثانية تتباعد عند إضافة بند رابع */''}
      workBuckets:${JSON.stringify(Object.entries(WORK_BUCKET_AR).map(([k, v]) => ({ key: k, label: v }))).replace(/</g, '\\u003c')},
      monthNames:${JSON.stringify(MONTHS_AR)},
      currentMonth:${currentMonth}, staffYear:${year},
      limits:${JSON.stringify(UTIL_BANDS)},
      canManage:${canManage}, canStaff:${canStaff},
      filters:${JSON.stringify({ sector: sector || null, dept: department || null }).replace(/</g, '\\u003c')},
      deepEmp:${JSON.stringify(roster.some((e) => e.id === String(opts.emp || '')) ? String(opts.emp) : null).replace(/</g, '\\u003c')},
      sectorNames:${JSON.stringify(sectorNames).replace(/</g, '\\u003c')}});</script>`;

  return layout({
    user, active: 'staffing', title: 'التسكين',
    subtitle: `${sector ? `${sectorNames[sector] || ''} · ` : ''}${countAr(activeR.length, { one: 'عضو نشط واحد', two: 'عضوان نشطان', few: 'أعضاء نشطين', many: 'عضواً نشطاً' })}${roster.length > activeR.length ? ` (+${roster.length - activeR.length} غير نشط)` : ''} · ${live ? `${curName} ${year}` : `خطة ${year}`}`,
    body, scripts: ['/static/pages/staffing.js'],
  });
}
