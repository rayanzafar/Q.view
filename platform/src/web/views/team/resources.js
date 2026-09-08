// ── S02 سجل الموارد + S03 المعاينة الجانبية (وحدة الفريق والموارد، ADR-0016) ───────────────
//
// «الاسم والدور، نوع المورد، الإدارة الأساسية، حالة الارتباط، المتاح للفترة المحددة… ضع
//  تاريخ/فترة قياس واضحة حتى لا يبدو رقماً دائماً. حالات صفر نتائج وعدم وجود موارد مختلفة»
// — الموجّه §11/S02. الصفحة تعرض الحالة الأولى كاملةً خادمياً من `listResources` (نفس النطاق
// والعدّاد والتصفية — لا فلترة بعد القراءة)، والتصفية والفترة تُقرأ من الرابط وتُكتب إليه
// (نموذج GET) فتبقى الحالة عند العودة من الملف. المعاينة (S03) درجٌ يجلبه العميل من
// `/api/team/resources/:id/preview` ولا يُنسخ إليه شيء من ملف المورد.
import { all } from '../../../core/db/index.js';
import { can } from '../../../core/rbac/index.js';
import { departmentInSql } from '../../../core/rbac/departments.js';
import { countAr } from '../../../core/i18n/plural.js';
import { G } from '../../i18n/glossary.js';
import { listResources, ENGAGEMENT_STATUS_AR } from '../../../modules/team/resources.js';
import { canCreateResource, resourceScopeSql, RESOURCE_TYPE_AR } from '../../../modules/team/access.js';
import { teamLayout, person, pctChip, typePill, engagementPill, emptyState, monthLabel, esc, icon } from './_shell.js';
import { resourceFormTemplate } from './resource-form.js';

// تسميات حالة الارتباط للفلتر من الخدمة نفسها — فتطابق شارة الصف (`engagement.status_ar`).
const ENGAGEMENT_AR = ENGAGEMENT_STATUS_AR;
// إنشاء حساب الدخول من نموذج المورد: الخدمة (createResource) لا تقرأ `create_account`/`email` بعد،
// فمفتاحٌ يُرسل علماً لا يقرؤه أحد كذبةٌ على المستخدم. يُقلب إلى «صحيح» في السطر نفسه حين تدعمه
// الخدمة، ويبقى فوقه شرط الصلاحية (مدير النظام — بوابة identity.inviteUser).
const SERVICE_CREATES_ACCOUNTS = false;

const RESOURCES_CSS = `
  .tm-res [hidden],.tm-drawer[hidden]{display:none!important}
  .tm-res-bar{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;padding:.7rem .9rem;margin-bottom:.9rem}
  .tm-res-q{flex:1 1 240px;position:relative}
  .tm-res-q .input{width:100%;padding-inline-start:2rem}
  .tm-res-q svg{position:absolute;inset-inline-start:.6rem;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--faint);pointer-events:none}
  .tm-res-bar select.input{min-width:132px}
  .tm-res-period{display:flex;align-items:center;gap:.35rem;font-size:var(--fs-meta);color:var(--muted)}
  .tm-res-period .input{width:138px}
  .tm-res-count{font-size:var(--fs-meta);color:var(--muted);margin-inline-start:auto;white-space:nowrap}
  .tm-res-tbl .tm-tbl tr.tm-row-click:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
  .tm-res-tbl .tm-tbl tr.tm-row-click:focus-visible td{background:#eef2fb}
  .tm-res-chev{color:var(--faint);font-size:18px;width:28px;text-align:center}
  .tm-res-end{font-size:var(--fs-micro);color:var(--muted);margin-top:.15rem}
  .tm-res-foot{display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;padding:.6rem .75rem;border-top:1px solid var(--line)}
  .tm-res-foot .pg{display:flex;align-items:center;gap:.4rem}
  .tm-res-foot .btn[aria-disabled="true"]{opacity:.4;pointer-events:none}
  .tm-res-hint{text-align:center;color:var(--muted);font-size:var(--fs-body);padding:1.4rem 0 .4rem}
  .tm-res-hint svg{display:block;margin:0 auto .3rem;width:26px;height:26px;color:var(--faint)}
  .tm-res-empty-act{display:flex;justify-content:center;gap:.5rem;padding-bottom:1.4rem}
  .tm-pv-id{display:flex;gap:.7rem;align-items:center;min-width:0}
  .tm-pv-n{font-size:var(--fs-title);font-weight:800;color:var(--ink2)}
  .tm-pv-j{font-size:var(--fs-body);color:var(--muted)}
  .tm-pv-pills{margin-top:.3rem;display:flex;gap:.3rem;flex-wrap:wrap}
  .tm-pv-figs{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;background:var(--bg);border-radius:12px;padding:.8rem .9rem;margin:.9rem 0 .5rem}
  .tm-pv-figs .l{font-size:var(--fs-meta);color:var(--muted)}
  .tm-pv-figs .v{font-size:var(--fs-val-md);font-weight:800;color:var(--ink2);margin:.1rem 0 .3rem}
  .tm-pv-load{display:flex;flex-direction:column;gap:.2rem;font-size:var(--fs-body);color:var(--ink2);margin-bottom:.9rem}
  .tm-pv-h{font-weight:800;color:var(--ink2);margin:.9rem 0 .4rem;font-size:var(--fs-body)}
  .tm-pv-more{display:inline-block;margin-top:.5rem;color:var(--brand);font-size:var(--fs-body);text-decoration:none}
  .tm-pv-sk{display:flex;flex-direction:column;gap:.6rem}
  .tm-pv-avail{display:flex;gap:.4rem;align-items:center;justify-content:center}
  .tm-drawer .df .btn{justify-content:center}
  .tm-li a{color:var(--ink2);text-decoration:none}.tm-li a:hover{color:var(--brand)}
  @media (max-width:640px){.tm-res-count{margin-inline-start:0}.tm-pv-figs{grid-template-columns:1fr}}
`;

/**
 * خيارات نموذج S09 مقصوصةً بنطاق القارئ (القطاعات، الإدارات بمديريها، صلاحية إنشاء الحساب).
 * تستهلكها هذه الصفحة وصفحة ملف المورد (profile.js) — مصدرٌ واحد كي لا تفترق القائمتان.
 */
export async function resourceFormOptions(user) {
  // إنشاء حساب الدخول من صلاحية مدير النظام وحده — نفس بوابة identity.inviteUser حرفياً.
  const canCreateAccount = SERVICE_CREATES_ACCOUNTS && !!user && (user.role_id === 'admin' || can(user, 'admin', '*'));
  const sc = resourceScopeSql(user, 'e');
  if (sc.clause === '1=0') return { sectors: [], departments: [], managers: [], canCreateAccount };
  const dWhere = ['d.deleted_at IS NULL', 'd.active = 1'];
  const dParams = [];
  if (sc.sector) { dWhere.push('d.sector_id = ?'); dParams.push(sc.sector); }
  if (sc.departments?.length) {
    const inD = departmentInSql('d.id', sc.departments);
    dWhere.push(inD.clause); dParams.push(...inD.params);
  }
  const departments = await all(`SELECT d.id, d.name_ar, d.sector_id, COALESCE(u.name_ar, u.username) AS manager_name
       FROM department d
       LEFT JOIN app_user u ON u.id = d.manager_user_id AND u.deleted_at IS NULL
      WHERE ${dWhere.join(' AND ')} ORDER BY d.name_ar`, dParams);
  const sWhere = ['s.deleted_at IS NULL', 's.active = 1'];
  const sParams = [];
  if (sc.sector) { sWhere.push('s.id = ?'); sParams.push(sc.sector); }
  else if (sc.departments?.length) {
    const ids = [...new Set(departments.map((d) => d.sector_id).filter(Boolean))];
    if (!ids.length) return { sectors: [], departments, managers: [], canCreateAccount };
    sWhere.push(`s.id IN (${ids.map(() => '?').join(',')})`); sParams.push(...ids);
  }
  const sectors = await all(`SELECT s.id, s.name_ar FROM sector s WHERE ${sWhere.join(' AND ')} ORDER BY s.sort_order, s.name_ar`, sParams);
  // المدير يُشتق من الإدارة المختارة (departments[].manager_name) — لا قائمة مستقلة في المنصة.
  return { sectors, departments, managers: [], canCreateAccount };
}

const clean = (v) => String(v == null ? '' : v).trim();

export async function resourcesPage(user, opts = {}) {
  const q = clean(opts.q);
  const department = clean(opts.department);
  const type = clean(opts.type);
  const status = clean(opts.status);
  const sector = clean(opts.sector);
  const from = clean(opts.from);
  const to = clean(opts.to);
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.max(0, Number(opts.pageSize) || 0) || null;
  const canCreate = canCreateResource(user);

  const [data, form] = await Promise.all([
    listResources(user, {
      q: q || undefined, sector: sector || undefined, department: department || undefined, type: type || undefined,
      status: status || undefined, from: from || undefined, to: to || undefined, page, ...(pageSize ? { pageSize } : {}),
    }),
    resourceFormOptions(user),
  ]);

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const total = Number(data?.total) || 0;
  const pageN = Math.max(1, Number(data?.page) || page);
  const size = Math.max(1, Number(data?.pageSize) || rows.length || 25);
  const period = { from: clean(data?.period?.from) || from, to: clean(data?.period?.to) || to };
  const hasFilters = !!(q || department || type || status);
  const start = rows.length ? (pageN - 1) * size + 1 : 0;
  const end = rows.length ? start + rows.length - 1 : 0;
  const pages = Math.max(1, Math.ceil(total / size));

  // روابط تحفظ كل حالة الرابط (بحث/فلاتر/فترة) وتغيّر ما يُطلب فقط.
  const href = (patch = {}) => {
    const base = { q, department, type, status, sector, from, to, page: String(pageN), pageSize: pageSize ? String(pageSize) : '', ...patch };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(base)) {
      if (v == null || String(v) === '') continue;
      if (k === 'page' && String(v) === '1') continue;
      p.set(k, String(v));
    }
    const s = p.toString();
    return '/app/team/resources' + (s ? '?' + s : '');
  };

  // ── شريط البحث والتصفية (نموذج GET — الحالة في الرابط) ─────────────────────────────
  const sectorName = Object.fromEntries((form.sectors || []).map((s) => [s.id, s.name_ar]));
  const deptOption = (d) => `<option value="${esc(d.id)}"${d.id === department ? ' selected' : ''}>${esc(d.name_ar)}</option>`;
  let deptOptions = '';
  if ((form.sectors || []).length > 1) {
    const bySector = new Map();
    for (const d of form.departments || []) { if (!bySector.has(d.sector_id)) bySector.set(d.sector_id, []); bySector.get(d.sector_id).push(d); }
    deptOptions = [...bySector.entries()].map(([sid, ds]) => `<optgroup label="${esc(sectorName[sid] || 'قطاع')}">${ds.map(deptOption).join('')}</optgroup>`).join('');
  } else deptOptions = (form.departments || []).map(deptOption).join('');
  const typeOptions = Object.entries(RESOURCE_TYPE_AR).map(([k, ar]) => `<option value="${k}"${k === type ? ' selected' : ''}>${esc(ar)}</option>`).join('');
  const statusOptions = Object.entries(ENGAGEMENT_AR).map(([k, ar]) => `<option value="${k}"${k === status ? ' selected' : ''}>${esc(ar)}</option>`).join('');
  const countLabel = countAr(total, { zero: 'لا موارد', one: 'مورد واحد', two: 'موردان', few: 'موارد', many: 'مورداً' });

  const toolbar = `<form method="get" action="/app/team/resources" class="tm-card tm-res-bar" id="tm-res-filters" role="search" aria-label="بحث الموارد وفلاترها">
    ${sector ? `<input type="hidden" name="sector" value="${esc(sector)}">` : ''}${pageSize ? `<input type="hidden" name="pageSize" value="${esc(pageSize)}">` : ''}
    <div class="tm-res-q">${icon('search')}<input class="input" type="search" name="q" value="${esc(q)}" placeholder="ابحث بالاسم أو المسمى أو المهارة" aria-label="ابحث بالاسم أو المسمى أو المهارة"></div>
    <select class="input" name="department" aria-label="الإدارة"><option value="">كل الإدارات</option>${deptOptions}</select>
    <select class="input" name="type" aria-label="نوع المورد"><option value="">كل الأنواع</option>${typeOptions}</select>
    <select class="input" name="status" aria-label="حالة الارتباط"><option value="">كل الحالات</option>${statusOptions}</select>
    <label class="tm-res-period"><span>من</span><input class="input tnum" type="month" name="from" value="${esc(period.from)}" aria-label="بداية فترة القياس"></label>
    <label class="tm-res-period"><span>إلى</span><input class="input tnum" type="month" name="to" value="${esc(period.to)}" aria-label="نهاية فترة القياس"></label>
    <button class="btn" type="submit">تطبيق</button>
    ${hasFilters ? '<a class="btn btn-ghost" href="/app/team/resources">مسح التصفية</a>' : ''}
    <span class="tm-res-count"><span class="tnum">${esc(countLabel)}</span></span>
  </form>`;

  // ── الصفوف: كل قيمة من الخدمة كما هي — لا معادلة ثانية في العرض ─────────────────────
  const endHint = (r) => {
    const st = r.engagement?.status;
    const d = clean(r.engagement?.end_date).slice(0, 10);
    if (!d || (st !== 'ending' && st !== 'ended')) return '';
    return `<div class="tm-res-end">${st === 'ended' ? 'انتهى' : 'ينتهي'} <span class="tnum">${esc(d)}</span></div>`;
  };
  const rowHtml = (r) => `<tr class="tm-row-click" tabindex="0" role="button" data-action="resource-preview" data-emp="${esc(r.id)}" data-name="${esc(r.name_ar)}" aria-label="معاينة ${esc(r.name_ar)}">
      <td>${person(r.name_ar, r.job_title)}</td>
      <td>${typePill(r.resourceType, r.resourceType_ar)}</td>
      <td>${r.department_name ? esc(r.department_name) : '<span style="color:var(--faint)">بلا إدارة</span>'}${(form.sectors || []).length > 1 && r.sector_name ? `<div class="tm-res-end">${esc(r.sector_name)}</div>` : ''}</td>
      <td>${engagementPill(r.engagement?.status, r.engagement?.status_ar)}${endHint(r)}</td>
      <td>${pctChip(r.availablePct, r.band)}</td>
      <td class="tm-res-chev" aria-hidden="true">‹</td>
    </tr>`;

  const basis = clean(data?.basis_ar);
  const periodLabel = period.from && period.to
    ? (period.from === period.to ? monthLabel(period.from) : `${monthLabel(period.from)} – ${monthLabel(period.to)}`)
    : '';
  const measureNote = `<div class="tm-note" style="padding:.6rem .75rem;border-top:1px solid var(--line)">${icon('info')}<span>${periodLabel ? `فترة القياس: <span class="tnum">${esc(periodLabel)}</span>` : ''}${periodLabel && basis ? ' · ' : ''}${esc(basis)}</span></div>`;

  let listHtml;
  if (!total) {
    // حالتان مختلفتان: نطاقٌ بلا موارد أصلاً، أو بحثٌ لم يُطابق شيئاً.
    listHtml = hasFilters
      ? `${emptyState('لا نتائج لهذا البحث', 'جرّب اسماً أو مسمى أو مهارة أخرى، أو وسّع التصفية.')}
         <div class="tm-res-empty-act"><a class="btn" href="/app/team/resources">مسح التصفية</a></div>`
      : `${emptyState('لا موارد في نطاقك بعد', canCreate ? 'أضِف أول مورد — يظهر هنا فور حفظه.' : 'حين يُضاف موظفون إلى إدارتك أو قطاعك سيظهرون هنا.')}
         ${canCreate ? `<div class="tm-res-empty-act"><button type="button" class="btn btn-primary" data-action="resource-add">${icon('plus')} ${esc(G.addResource)}</button></div>` : ''}`;
  } else if (!rows.length) {
    listHtml = `${emptyState('هذه الصفحة فارغة', 'عدد الصفحات أقل مما طُلب.')}<div class="tm-res-empty-act"><a class="btn" href="${esc(href({ page: '1' }))}">الصفحة الأولى</a></div>`;
  } else {
    const prev = pageN > 1 ? `<a class="btn btn-sm" href="${esc(href({ page: String(pageN - 1) }))}" rel="prev">السابق</a>` : '<span class="btn btn-sm" aria-disabled="true">السابق</span>';
    const next = pageN < pages ? `<a class="btn btn-sm" href="${esc(href({ page: String(pageN + 1) }))}" rel="next">التالي</a>` : '<span class="btn btn-sm" aria-disabled="true">التالي</span>';
    listHtml = `<div class="tblwrap" style="overflow-x:auto"><table class="tm-tbl">
      <thead><tr><th>المورد</th><th>النوع</th><th>الإدارة</th><th>${esc(G.engagementStatus)}</th><th>المتاح للفترة</th><th></th></tr></thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody></table></div>
      ${measureNote}
      <div class="tm-res-foot"><span class="tnum">${start}–${end} من ${total}</span><div class="pg">${prev}${next}</div></div>`;
  }

  const hint = rows.length ? `<div class="tm-res-hint">${icon('search')}اختر اسماً لعرض معاينة سريعة</div>` : '';

  // ── درج المعاينة S03 — يملؤه العميل من /api/team/resources/:id/preview ─────────────
  const drawer = `<div class="tm-scrim" id="tm-pv-scrim" data-action="preview-close" aria-hidden="true"></div>
  <aside class="tm-drawer" id="tm-pv" role="dialog" aria-modal="true" aria-labelledby="tm-pv-name" hidden>
    <div class="dh"><div style="flex:1;min-width:0"><div class="tm-pv-n" id="tm-pv-name">معاينة المورد</div><div class="tm-pv-j" id="tm-pv-sub">${periodLabel ? `الفترة: <span class="tnum">${esc(periodLabel)}</span>` : ''}</div></div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="preview-close" aria-label="إغلاق المعاينة">✕</button></div>
    <div class="db" id="tm-pv-body"></div>
    <div class="df" id="tm-pv-foot" hidden></div>
  </aside>`;

  const state = {
    period: { from: period.from || '', to: period.to || '' },
    canCreate, total,
    addOnLoad: canCreate && clean(opts.add) === '1',
  };

  const body = `<style>${RESOURCES_CSS}</style><div class="tm-res">
    ${toolbar}
    <div class="tm-card tm-res-tbl">${listHtml}</div>
    ${hint}
    ${drawer}
    ${canCreate ? resourceFormTemplate({ mode: 'create', ...form }) : ''}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{teamResources:${JSON.stringify(state).replace(/</g, '\\u003c')}});</script>
  </div>`;

  return teamLayout({
    user, path: 'people', section: 'resources', title: G.team,
    subtitle: 'اعثر على الشخص المناسب، ثم افتح تفاصيله عند الحاجة.',
    crumbs: [{ label: G.resourcesRegistry, href: '/app/team/resources' }],
    actions: canCreate ? `<button type="button" class="btn btn-primary" data-action="resource-add">${icon('plus')} ${esc(G.addResource)}</button>` : '',
    body, year: opts.year,
    scripts: ['/static/pages/team-resources.js', ...(canCreate ? ['/static/pages/team-resource-form.js'] : [])],
  });
}
