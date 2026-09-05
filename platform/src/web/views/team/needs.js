// ── الاحتياجات القادمة ونموذج الاحتياج ومقارنة المرشحين — S19/S20/S21 (وحدة الفريق والموارد) ──
//
// «تسجيل الاحتياج لا يعني تغطيته» و«لا ينتج حجزٌ بمجرد تحديد دائرة الاختيار» (الموجّه §5/§8).
// الصفحتان تعرضان ما تعيده خدمة `modules/team/needs.js` حرفاً: الحجم بوحدته («مورد واحد × 50%
// FTE طوال الفترة»)، واليقين منفصلاً عن حالة التغطية، والمتاح شهراً شهراً داخل فترة الارتباط،
// والطلبات المعلَّقة طبقةً تُعرض ولا تُخصم، والملاءمة جملاً لا رقماً. الكتابة كلها من عميل
// الصفحة (public/pages/team-needs.js) عبر /api/team/needs/… — لا كتابة هنا، ولا مال في أي سطر.
import { teamLayout, person, pctChip, emptyState, esc, pill, icon } from './_shell.js';
import { all } from '../../../core/db/index.js';
import { can, effectiveScope } from '../../../core/rbac/index.js';
import { departmentScope, departmentInSql } from '../../../core/rbac/departments.js';
import { MONTHS_AR } from '../../../core/i18n/time.js';
import { countAr, monthWord } from '../../../core/i18n/plural.js';
import { SUPPORT_KIND } from '../../../core/org/kind.js';
import { G, WORK_BUCKET_AR } from '../../i18n/glossary.js';
import { listNeeds, getNeed, candidates, demandAr, CERTAINTY_AR, NEED_STATUS_AR } from '../../../modules/team/needs.js';
import { listProjects } from '../../../modules/pmo/projects.js';
import { listOpportunities } from '../../../modules/crm/opportunities.js';

const N = (v) => Number(v) || 0;
const json = (x) => JSON.stringify(x, (k, v) => (v === null ? undefined : v)).replace(/</g, '\\u003c');
const num = (v) => `<span class="tnum">${esc(v)}</span>`;
const fmtDate = (iso) => {
  const s = String(iso || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s ? esc(s) : '—';
  return `<span class="tnum">${Number(m[3])} ${esc(MONTHS_AR[Number(m[2]) - 1] || '')} ${m[1]}</span>`;
};
const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && String(v) !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const fte = (v) => { const r = Math.round(N(v) * 100) / 100; return String(r); };
const today = () => new Date().toISOString().slice(0, 10);

export const LEVEL_AR = Object.freeze({ beginner: 'مبتدئ', practitioner: 'ممارس', advanced: 'متقدم', expert: 'خبير' });
const levelLabel = (v) => (v ? (LEVEL_AR[String(v)] || String(v)) : '');
const CERT_TONE = { confirmed: 'blue', tentative: 'slate' };
const COVER_TONE = { covered: 'green', partial: 'amber', pending: 'blue', uncovered: 'slate' };
const STATUS_TONE = { draft: 'slate', open: 'blue', shortlisting: 'violet', partial: 'amber', covered: 'green', cancelled: 'red' };

const CSS = `
  .tm-nd-filters{display:flex;gap:.6rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:1rem}
  .tm-nd-filters .field label{display:block;font-size:var(--fs-meta);color:var(--muted);margin-bottom:.25rem}
  .tm-nd-filters select,.tm-nd-filters input{min-width:130px}
  .tm-nd-tbl{min-width:1000px}
  .tm-nd-tbl td{vertical-align:top}
  .tm-nd-role{font-weight:800;color:var(--ink2)}
  .tm-nd-meta{font-size:var(--fs-micro);color:var(--muted);margin-top:.2rem}
  .tm-nd-acts{display:flex;gap:.35rem;flex-wrap:wrap}
  .tm-nd-peak{font-size:var(--fs-body);color:var(--ink2);background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:.7rem 1rem;margin:-.3rem 0 1rem;display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
  .tm-nd-chips{display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.35rem}
  .tm-nd-chip{display:inline-flex;align-items:center;gap:.25rem;background:#eef2fb;color:var(--brand);border-radius:999px;padding:.1rem .55rem;font-size:var(--fs-micro);font-weight:700}
  .tm-nd-chip.pref{background:var(--bg);color:var(--muted)}
  .tm-nd-drawer{width:min(640px,96vw)}
  .tm-nd-drawer .db .tm-sec{margin-bottom:.8rem}
  .tm-nd-drawer input,.tm-nd-drawer select,.tm-nd-drawer textarea{width:100%}
  .tm-nd-owner{font-size:var(--fs-body);font-weight:700;color:var(--ink2);padding:.5rem .7rem;border:1px dashed var(--line);border-radius:10px;background:var(--bg)}
  .tm-cd-need{display:flex;gap:1.2rem;flex-wrap:wrap;align-items:flex-start}
  .tm-cd-need .blk{min-width:180px;flex:1 1 180px}
  .tm-cd-need .blk .l{font-size:var(--fs-meta);color:var(--muted)}
  .tm-cd-need .blk .v{font-weight:800;color:var(--ink2);margin-top:.15rem}
  .tm-cd-tbl{min-width:980px}
  .tm-cd-tbl td{vertical-align:top}
  .tm-cd-tbl th.mo{text-align:center;min-width:110px}
  .tm-cd-tbl td.mo{text-align:center}
  .tm-cd-tbl .sub{display:block;font-size:var(--fs-micro);color:var(--muted);margin-top:.25rem}
  .tm-cd-off td{opacity:.55}
  .tm-cd-off td:first-child,.tm-cd-off td:nth-child(2){opacity:1}
  .tm-cd-sk{display:flex;gap:.3rem;align-items:center;font-size:var(--fs-body);white-space:nowrap}
  .tm-cd-sk i{font-style:normal;font-weight:800;width:1.1em;text-align:center}
  .tm-cd-sk.s-verified{color:var(--green)}.tm-cd-sk.s-needs_confirmation{color:var(--amber)}.tm-cd-sk.s-missing{color:var(--red)}
  .tm-cd-fit{margin:0;padding-inline-start:1rem;font-size:var(--fs-body);line-height:1.7}
  .tm-cd-pend{font-size:var(--fs-body)}
  .tm-cd-pend .m{font-size:var(--fs-micro);color:var(--muted)}
  .tm-cd-panel .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.7rem}
  .tm-cd-months{display:flex;flex-direction:column;gap:.3rem;font-size:var(--fs-body);margin-top:.6rem}
  .tm-cd-months .over{color:var(--red);font-weight:700}
  .tm-cd-sel{width:18px;height:18px;accent-color:var(--brand)}
  @media (max-width:640px){.tm-nd-filters{flex-direction:column;align-items:stretch}.tm-nd-filters select,.tm-nd-filters input{width:100%}}
`;

// ── إدارات المرشِّح بحدود قراءة الاحتياجات — فلا تُعرض إدارةٌ يردّها الخادم ─────────────
async function needDepartments(user) {
  const scope = user.role_id === 'admin' ? 'company' : effectiveScope(user, 'read', 'resource_need');
  const where = ['d.active = 1', 'd.deleted_at IS NULL'];
  const params = [];
  if (scope === 'company') { /* الشركة كلها */ } else if (scope === 'sector' && user.sector_id) { where.push('d.sector_id = ?'); params.push(user.sector_id); } else {
    const q = departmentInSql('d.id', departmentScope(user));
    if (q.clause === '1=0') return [];
    where.push(q.clause); params.push(...q.params);
  }
  return await all(`SELECT d.id, d.name_ar, d.sector_id FROM department d WHERE ${where.join(' AND ')} ORDER BY d.name_ar`, params);
}

const needTarget = (r) => ({ sector_id: r.sector_id || null, department_id: r.department_id || null,
  project_id: r.source?.kind === 'project' ? r.source.id : null, owner_user_id: r.owner?.userId || null, created_by: r.owner?.userId || null });
const canEditNeed = (user, r) => user.role_id === 'admin' || (r.owner?.userId && r.owner.userId === user.id) || can(user, 'update', 'resource_need', needTarget(r));

const sourceLink = (src) => {
  const label = esc(src?.label || '—');
  if (src?.kind === 'project') return `<a href="/app/project/${encodeURIComponent(src.id)}" style="color:var(--brand)">${label}</a>`;
  if (src?.kind === 'opportunity') return `<a href="/app/opportunity/${encodeURIComponent(src.id)}" style="color:var(--brand)">${label}</a>`;
  return `<span>${label}</span>`;
};
const skillChips = (skills) => {
  const req = (skills?.required || []).map((s) => `<span class="tm-nd-chip">${esc(s)}</span>`);
  const pref = (skills?.preferred || []).map((s) => `<span class="tm-nd-chip pref" title="مفضَّلة">${esc(s)} <span style="font-weight:400">مفضَّلة</span></span>`);
  return req.length || pref.length ? `<div class="tm-nd-chips">${req.join('')}${pref.join('')}</div>` : '<span class="tm-note">لا مهارات محددة</span>';
};
const periodText = (p) => `${fmtDate(p.from)} – ${fmtDate(p.to)} <span class="tm-nd-meta">(${esc(monthWord((p.months || []).length))})</span>`;
const needForClient = (r) => ({
  id: r.id, source: { kind: r.source.kind, id: r.source.id, label: r.source.label }, role_ar: r.role_ar,
  skills: { required: r.skills?.required || [], preferred: r.skills?.preferred || [] }, level: r.level || '',
  from: r.period.from, to: r.period.to, headcount: r.headcount, ftePct: r.ftePct, certainty: r.certainty,
  decide_by: r.decide_by || '', splittable: !!r.splittable, goal: r.goal || '', status: r.status, status_ar: r.status_ar,
  sector_id: r.sector_id || '', department_id: r.department_id || '', owner: r.owner?.name || '',
  requests: N(r.coverage?.requests), coverage_ar: r.coverage?.status_ar || '',
});

// ── الذروة الشهرية: توحيد الوحدة قبل الجمع — FTE لكل شهر لا مجموع أحجامٍ عبر فترات مختلفة ──
function peakDemand(rows) {
  const byMonth = new Map();
  for (const r of rows) {
    if (r.status === 'cancelled') continue;
    const units = (N(r.headcount) * N(r.ftePct)) / 100;
    for (const k of r.period?.months || []) {
      const m = byMonth.get(k) || { confirmed: 0, tentative: 0 };
      m[r.certainty === 'tentative' ? 'tentative' : 'confirmed'] += units;
      byMonth.set(k, m);
    }
  }
  let peak = null;
  for (const [key, v] of byMonth) {
    const total = v.confirmed + v.tentative;
    if (!peak || total > peak.total) peak = { key, total, ...v };
  }
  return peak;
}
const monthKeyLabel = (key) => { const [y, m] = String(key).split('-'); return `${MONTHS_AR[Number(m) - 1] || ''} ${y}`; };

function needRow(r, { user }) {
  const cov = r.coverage || {};
  const editable = canEditNeed(user, r) && r.status !== 'cancelled';
  const overdue = r.decide_by && r.decide_by < today() && cov.status !== 'covered' && r.status !== 'cancelled';
  return `<tr data-need="${esc(r.id)}">
    <td><div class="tm-nd-role">${esc(r.role_ar)}</div><div class="tm-nd-meta">${pill(esc(r.status_ar), STATUS_TONE[r.status] || 'slate')}${r.level ? ` · ${esc(levelLabel(r.level))}` : ''}</div></td>
    <td><div class="tm-nd-meta" style="margin:0 0 .15rem">${esc(r.source?.kind_ar || '')}</div>${sourceLink(r.source)}</td>
    <td>${periodText(r.period)}</td>
    <td class="tnum">${esc(r.demand_ar)}</td>
    <td>${pill(esc(r.certainty_ar), CERT_TONE[r.certainty] || 'slate')}</td>
    <td>${pill(esc(cov.status_ar || ''), COVER_TONE[cov.status] || 'slate')}
      ${cov.status === 'partial' && N(cov.gapPct) > 0 ? `<div class="tm-nd-meta tnum">فجوة متبقية ${N(cov.gapPct)}%</div>` : ''}
      ${cov.status === 'pending' && N(cov.pendingPct) > 0 ? `<div class="tm-nd-meta tnum">معلَّق ${N(cov.pendingPct)}%</div>` : ''}
      ${cov.requestId ? `<div class="tm-nd-meta"><a href="/app/team/requests/${encodeURIComponent(cov.requestId)}" style="color:var(--brand)">الطلب المرتبط</a></div>` : ''}</td>
    <td>${r.decide_by ? `${fmtDate(r.decide_by)}${overdue ? `<div class="tm-nd-meta" style="color:var(--amber);font-weight:700">تجاوز الموعد</div>` : ''}` : '<span style="color:var(--faint)">—</span>'}</td>
    <td>${esc(r.owner?.name || '—')}</td>
    <td><div class="tm-nd-acts">
      <a class="btn btn-sm" href="/app/team/needs/${encodeURIComponent(r.id)}">${G.viewCandidates}</a>
      ${editable ? `<button type="button" class="btn btn-sm" data-action="need-edit" data-id="${esc(r.id)}">تعديل</button><button type="button" class="btn btn-sm btn-ghost" data-action="need-cancel" data-id="${esc(r.id)}" data-role="${esc(r.role_ar)}">إلغاء</button>` : ''}
    </div></td>
  </tr>`;
}

function needFilters({ f, depts, action }) {
  const opt = (v, label, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  const monthVal = (v) => { const s = String(v || ''); return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : ''; };
  return `<form class="tm-nd-filters" method="get" action="${esc(action)}" data-autosubmit>
    <div class="field"><label for="nd-from">من شهر</label><input id="nd-from" type="month" name="from" class="input" value="${esc(monthVal(f.from))}"></div>
    <div class="field"><label for="nd-to">إلى شهر</label><input id="nd-to" type="month" name="to" class="input" value="${esc(monthVal(f.to))}"></div>
    <div class="field"><label for="nd-dept">الإدارة</label><select id="nd-dept" name="department" class="input">${opt('', 'كل الإدارات', !f.department)}${depts.map((d) => opt(d.id, d.name_ar, d.id === f.department)).join('')}</select></div>
    <div class="field"><label for="nd-status">الحالة</label><select id="nd-status" name="status" class="input">${opt('', 'القائمة (بلا الملغى)', !f.status)}${Object.entries(NEED_STATUS_AR).map(([k, v]) => opt(k, v, k === f.status)).join('')}${opt('all', 'الكل بما فيه الملغى', f.status === 'all')}</select></div>
    <div class="field"><label for="nd-cert">اليقين</label><select id="nd-cert" name="certainty" class="input">${opt('', 'الكل', !f.certainty)}${Object.entries(CERTAINTY_AR).map(([k, v]) => opt(k, v, k === f.certainty)).join('')}</select></div>
    <button class="btn" type="submit">تطبيق</button>
  </form>`;
}

// ── S20: نموذج الاحتياج (درج) — يُعرض لمن ينشئ أو يعدّل، والخادم هو المحقِّق ────────────────
function needDrawer({ user, projects, opps, sectors }) {
  const opt = (v, label, extra = '') => `<option value="${esc(v)}"${extra}>${esc(label)}</option>`;
  const me = user.name_ar || user.username || '';
  return `<div class="tm-scrim" id="tm-scrim" data-action="need-close"></div>
  <aside class="tm-drawer tm-nd-drawer" id="tm-need-drawer" role="dialog" aria-modal="true" aria-labelledby="tm-need-title" aria-hidden="true">
    <form class="tm-form" id="tm-need-form" data-form="need" novalidate style="display:flex;flex-direction:column;height:100%">
      <div class="dh"><div><div class="tm-card-t" id="tm-need-title">${G.addNeed}</div><div class="tm-card-s">حدد العمل والطاقة والمهارات قبل اختيار الأشخاص.</div></div>
        <button type="button" class="btn btn-ghost btn-sm" data-action="need-close" aria-label="إغلاق">✕</button></div>
      <div class="db">
        <input type="hidden" name="id" value="">
        <div class="tm-sec"><div class="sh">مصدر الاحتياج</div>
          <div class="tm-radio" style="margin-bottom:.6rem">
            <label><input type="radio" name="source_kind" value="project" checked> مشروع</label>
            <label><input type="radio" name="source_kind" value="opportunity"> فرصة</label>
            <label><input type="radio" name="source_kind" value="bucket"> عمل داخلي</label></div>
          <div class="row">
            <div class="field" data-src="project"><label class="req" for="nd-src-project">المشروع</label><select id="nd-src-project" name="source_project" class="input">${opt('', 'اختر المشروع')}${projects.map((p) => opt(p.id, p.name_ar, ` data-sector="${esc(p.sector_id || '')}"`)).join('')}</select>
              ${projects.length ? '' : '<div class="tm-note">لا مشاريع ضمن نطاقك.</div>'}</div>
            <div class="field" data-src="opportunity" hidden><label class="req" for="nd-src-opp">الفرصة</label><select id="nd-src-opp" name="source_opportunity" class="input">${opt('', 'اختر الفرصة')}${opps.map((o) => opt(o.id, o.title_ar)).join('')}</select>
              ${opps.length ? '' : '<div class="tm-note">لا فرص ضمن نطاقك.</div>'}</div>
            <div class="field" data-src="bucket" hidden><label class="req" for="nd-src-bucket">بند العمل الداخلي</label><select id="nd-src-bucket" name="source_bucket" class="input">${Object.entries(WORK_BUCKET_AR).map(([k, v]) => opt(k, v)).join('')}</select></div>
            ${sectors.length ? `<div class="field" data-src="bucket" hidden><label class="req" for="nd-src-sector">القطاع</label><select id="nd-src-sector" name="sector_id" class="input">${sectors.map((s) => opt(s.id, s.name_ar)).join('')}</select></div>` : ''}
            <div class="field"><label>المالك</label><div class="tm-nd-owner" data-owner data-me="${esc(me)}">${esc(me)}</div><div class="tm-note">يُسجَّل الاحتياج باسم من يحفظه.</div></div>
          </div></div>
        <div class="tm-sec"><div class="sh">الدور والقدرات</div>
          <div class="row">
            <div class="field"><label class="req" for="nd-role">الدور المطلوب</label><input id="nd-role" name="role_ar" class="input" maxlength="120" placeholder="مثل: محلل بيانات"></div>
            <div class="field"><label for="nd-level">مستوى الخبرة</label><select id="nd-level" name="level" class="input">${opt('', 'غير محدد')}${Object.entries(LEVEL_AR).map(([k, v]) => opt(k, v)).join('')}</select></div>
            <div class="field"><label for="nd-sk-req">المهارات الأساسية</label><input id="nd-sk-req" name="skills_required" class="input" placeholder="افصل بين المهارات بفاصلة"><div class="tm-nd-chips" data-chips="skills_required"></div></div>
            <div class="field"><label for="nd-sk-pref">المهارات المفضلة</label><input id="nd-sk-pref" name="skills_preferred" class="input" placeholder="افصل بين المهارات بفاصلة"><div class="tm-nd-chips" data-chips="skills_preferred"></div></div>
          </div></div>
        <div class="tm-sec"><div class="sh">الفترة وحجم الاحتياج</div>
          <div class="row">
            <div class="field"><label class="req" for="nd-from">من شهر</label><input id="nd-from" type="month" name="from_month" class="input"></div>
            <div class="field"><label class="req" for="nd-to">إلى شهر</label><input id="nd-to" type="month" name="to_month" class="input"></div>
            <div class="field"><label class="req" for="nd-head">عدد الموارد</label><input id="nd-head" type="number" name="headcount" class="input" min="1" max="50" step="1" value="1"></div>
            <div class="field"><label class="req" for="nd-fte">الطاقة لكل مورد (FTE %)</label><input id="nd-fte" type="number" name="fte_pct" class="input" min="1" max="100" step="1" value="100"></div>
          </div>
          <label style="display:flex;gap:.4rem;align-items:center;margin-top:.6rem;font-size:var(--fs-body)"><input type="checkbox" name="splittable"> يمكن تقسيم العمل بين أكثر من مورد</label>
          <div class="tm-info tnum" style="margin-top:.6rem" data-demand>إجمالي الطلب: ${esc(demandAr(1, 100))}</div></div>
        <div class="tm-sec"><div class="sh">الهدف والحسم</div>
          <div class="row">
            <div class="field" style="grid-column:1/-1"><label for="nd-goal">الهدف من الاحتياج</label><textarea id="nd-goal" name="goal" class="input" rows="2" maxlength="500"></textarea></div>
            <div class="field"><label for="nd-decide">مطلوب الحسم قبل</label><input id="nd-decide" type="date" name="decide_by" class="input"></div>
            <div class="field"><label class="req">اليقين</label><div class="tm-radio"><label><input type="radio" name="certainty" value="confirmed" checked> مؤكد</label><label><input type="radio" name="certainty" value="tentative"> مبدئي</label></div></div>
          </div></div>
        <div class="tm-warn" data-impact hidden></div>
        <div class="tm-danger" data-err hidden role="alert"></div>
      </div>
      <div class="df">
        <div class="tm-note">${icon('info')} ${esc(G.needNoBooking)} الحجز ينتج عن طلب تسكين معتمد.</div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <button type="submit" class="btn btn-primary" data-submit data-then="candidates">حفظ وعرض المرشحين</button>
          <button type="submit" class="btn" data-submit data-then="list">حفظ</button>
          <button type="button" class="btn btn-ghost" data-action="need-close">إلغاء</button></div>
      </div>
    </form>
  </aside>`;
}

/** S19 (+ S20 درجاً) — /app/team/needs?from=&to=&department=&status=&certainty=&new=1&edit=<id> */
export async function needsPage(user, opts = {}) {
  const f = { from: String(opts.from || '').trim(), to: String(opts.to || '').trim(), department: String(opts.department || '').trim(),
    status: String(opts.status || '').trim(), certainty: String(opts.certainty || '').trim() };
  const data = await listNeeds(user, { ...f, sector: opts.sector });
  const { rows, summary, followups, period, basis_ar } = data;
  const canCreate = user.role_id === 'admin' || can(user, 'create', 'resource_need');
  const editableAny = rows.some((r) => canEditNeed(user, r) && r.status !== 'cancelled');
  const withForm = canCreate || editableAny;
  const [depts, projects, opps, sectors] = await Promise.all([
    needDepartments(user),
    withForm ? listProjects(user).then((ps) => ps.filter((p) => !['COMPLETED', 'CANCELLED'].includes(String(p.status || ''))).slice(0, 200).map((p) => ({ id: p.id, name_ar: p.name_ar, sector_id: p.sector_id || '' }))).catch(() => []) : [],
    withForm ? listOpportunities(user, {}, {}).then((os) => os.slice(0, 200).map((o) => ({ id: o.id, title_ar: o.title_ar }))).catch(() => []) : [],
    withForm && user.scope === 'company' ? all('SELECT id, name_ar FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order') : [],
  ]);
  const base = '/app/team/needs';
  const filtered = !!(f.from || f.to || f.department || f.status || f.certainty);
  const live = rows.filter((r) => r.status !== 'cancelled');
  const peak = peakDemand(live);
  const periodLabel = period?.from || period?.to
    ? `من ${period.from ? monthKeyLabel(period.from.slice(0, 7)) : 'البداية'} إلى ${period.to ? monthKeyLabel(period.to.slice(0, 7)) : 'النهاية'}`
    : 'كل الفترات';

  const strip = `<div class="tm-kpis">
    <div class="tm-kpi"><div class="l">احتياج مؤكد</div><div class="v">${num(N(summary.confirmed))}</div><div class="s">${esc(periodLabel)}</div></div>
    <div class="tm-kpi"><div class="l">احتياج مبدئي</div><div class="v">${num(N(summary.tentative))}</div><div class="s">${esc(periodLabel)}</div></div>
    <div class="tm-kpi"><div class="l">غير مغطى</div><div class="v">${num(N(summary.uncovered))}</div><div class="s">بلا طلب تسكين مرتبط</div></div>
    <div class="tm-kpi"><div class="l">بانتظار اعتماد</div><div class="v">${num(N(summary.pending))}</div><div class="s">طلب تسكين معلَّق</div></div>
  </div>
  ${peak ? `<div class="tm-nd-peak">${icon('trend')}<span>أعلى طلب شهري: <b class="tnum">${esc(fte(peak.confirmed))} FTE</b> مؤكد + <b class="tnum">${esc(fte(peak.tentative))} FTE</b> مبدئي في ${esc(monthKeyLabel(peak.key))}</span>
    <span class="tm-note">الوحدة: وحدات دوام كامل لكل شهر — الاحتياجات ذات الفترات المختلفة لا تُجمع رقماً واحداً.</span></div>` : ''}`;

  let table;
  if (!rows.length && !filtered) {
    table = `${emptyState('لا احتياجات مسجلة بعد', 'خطّط للطلب قبل أن يتحول إلى ضغط على الفريق.')}
      ${canCreate ? `<div style="text-align:center;padding-bottom:1rem"><button type="button" class="btn btn-primary" data-action="need-new">${icon('plus')} ${G.addNeed}</button></div>` : ''}`;
  } else if (!rows.length) {
    table = `${emptyState('لا نتائج لهذه المرشّحات', 'غيّر الفترة أو الإدارة أو الحالة.')}
      <div style="text-align:center;padding-bottom:1rem"><a class="btn btn-sm" href="${esc(base)}">عرض الكل</a></div>`;
  } else {
    table = `<div class="tblwrap"><table class="tm-tbl keep-all tm-nd-tbl">
      <thead><tr><th>الدور</th><th>مصدر العمل</th><th>الفترة</th><th>الطلب</th><th>اليقين</th><th>حالة التغطية</th><th>تاريخ الحسم</th><th>المسؤول</th><th></th></tr></thead>
      <tbody>${rows.map((r) => needRow(r, { user })).join('')}</tbody></table></div>
      <div class="tm-pager"><span>${countAr(rows.length, { one: 'احتياج واحد', two: 'احتياجان', few: 'احتياجات', many: 'احتياجاً' })}</span><span class="tm-note">${icon('info')} الاحتياج لا يحجز الطاقة؛ الحجز ينتج عن تسكين معتمد.</span></div>`;
  }

  const fu = (followups || []).length ? `<div class="tm-card" style="margin-top:1rem"><div class="tm-card-h"><div class="tm-card-t">بحاجة إلى متابعة</div><div class="tm-card-s">${countAr(followups.length, { one: 'احتياج واحد', two: 'احتياجان', few: 'احتياجات', many: 'احتياجاً' })}</div></div>
      <div class="tm-card-b tm-list">${followups.map((x) => `<a class="tm-li" href="/app/team/needs/${encodeURIComponent(x.needId)}"><span><b>${esc(x.role_ar)}</b> <span class="m tnum">${esc(x.reason_ar)}</span></span><span class="tm-note">${G.viewCandidates} ‹</span></a>`).join('')}</div></div>` : '';

  const editRow = opts.edit ? rows.find((r) => r.id === String(opts.edit)) : null;
  const body = `<style>${CSS}</style>
    ${strip}
    ${needFilters({ f, depts, action: base })}
    <div class="tm-card">${table}</div>
    ${fu}
    <div class="tm-foot">${esc(basis_ar || '')}</div>
    ${withForm ? needDrawer({ user, projects, opps, sectors }) : ''}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{teamNeeds:${json({
    canCreate, withForm, monthNames: MONTHS_AR,
    needs: Object.fromEntries(rows.filter((r) => canEditNeed(user, r)).map((r) => [r.id, needForClient(r)])),
    open: opts.new ? 'new' : (editRow && canEditNeed(user, editRow) ? 'edit' : ''), editId: editRow ? editRow.id : '',
  })}});</script>`;

  return teamLayout({
    user, path: 'analysis', section: 'needs', title: G.pathAnalysis,
    subtitle: 'خطّط للطلب قبل أن يتحول إلى ضغط على الفريق.',
    crumbs: [{ label: G.needsTab, href: base }],
    actions: canCreate ? `<button type="button" class="btn btn-primary" data-action="need-new">${icon('plus')} ${G.addNeed}</button>` : '',
    body, scripts: ['/static/pages/team-needs.js'], year: opts.year,
  });
}

// ── S21: مقارنة المرشحين وطلب التسكين ─────────────────────────────────────────────────
const SKILL_MARK = { verified: '✓', needs_confirmation: '؟', missing: '✕' };
const skillLine = (s) => `<div class="tm-cd-sk s-${esc(s.state)}"><i aria-hidden="true">${SKILL_MARK[s.state] || '·'}</i><span>${esc(s.name)}: ${esc(s.state_ar)}${s.required ? '' : ' <span style="color:var(--muted);font-weight:400">(مفضَّلة)</span>'}</span></div>`;

function availCell(a, needPct) {
  if (a.state === 'out' || a.availablePct == null) return `<span class="tm-pct b-out" title="${esc(G.outOfEngagement)}">${esc(G.outOfEngagementShort || 'خارج الارتباط')}</span>`;
  const av = N(a.availablePct);
  const band = av >= needPct ? 'ok' : av > 0 ? 'near' : 'over';
  const title = av >= needPct ? 'يغطي المطلوب' : av > 0 ? 'أقل من المطلوب' : 'لا طاقة متاحة';
  return `<span title="${esc(title)}">${pctChip(av, band)}</span><span class="sub tnum">مؤكد ${N(a.confirmedPct)}%${N(a.pendingPct) ? ` · معلَّق ${N(a.pendingPct)}% (لا يُخصم)` : ''}</span>`;
}

function candRow(r, { months, needPct, canRequest }) {
  const off = !r.eligible;
  const reason = off ? (r.fit_ar?.[0] || G.outOfEngagement) : '';
  return `<tr class="${off ? 'tm-cd-off' : ''}" data-emp="${esc(r.employeeId)}">
    ${canRequest ? `<td><input type="radio" class="tm-cd-sel" name="cand" value="${esc(r.employeeId)}" data-action="cand-select" aria-label="اختيار ${esc(r.name)}"${off ? ' disabled' : ''}></td>` : ''}
    <td>${person(r.name, r.job_title, { href: `/app/team/resources/${encodeURIComponent(r.employeeId)}` })}
      <div class="tm-nd-meta" style="display:flex;gap:.3rem;flex-wrap:wrap;align-items:center">${r.department_name ? `<span>${esc(r.department_name)}</span>` : ''}${r.supportUnit ? pill('وحدة مساندة', 'violet') : ''}${r.alreadyOnSource ? pill('مسكَّن على المصدر', 'blue') : ''}${off ? pill(`غير مؤهل: ${esc(reason)}`, 'slate') : ''}</div></td>
    <td>${(r.skills || []).length ? r.skills.map(skillLine).join('') : '<span class="tm-note">لا مهارات محددة في الاحتياج</span>'}</td>
    ${months.map((m, i) => `<td class="mo">${availCell(r.availability?.[i] || { state: 'out' }, needPct)}</td>`).join('')}
    <td class="tm-cd-pend">${(r.pendingRequests || []).length
    ? r.pendingRequests.map((p) => `<div><a href="/app/team/requests/${encodeURIComponent(p.id)}" style="color:var(--brand)">${esc(p.label)}</a> <b class="tnum">${N(p.pct)}%</b></div>`).join('') + '<div class="m">تُعرض ولا تُخصم من المتاح المؤكد</div>'
    : '<span style="color:var(--faint)">لا يوجد</span>'}</td>
    <td><ul class="tm-cd-fit">${(r.fit_ar || []).map((s) => `<li class="tnum">${esc(s)}</li>`).join('')}</ul>
      ${N(r.potentialOverPct) > 100 ? `<div class="tm-warn tnum" style="margin-top:.4rem;padding:.4rem .6rem">تعارض محتمل: الإجمالي المحتمل ${N(r.potentialOverPct)}%</div>` : ''}</td>
  </tr>`;
}

/** S21 — /app/team/needs/:id?department=&q= */
export async function needCandidatesPage(user, needId, opts = {}) {
  const dept = String(opts.department || '').trim();
  const q = String(opts.q || '').trim();
  const [data, need] = await Promise.all([candidates(user, needId, { department: dept, q }), getNeed(user, needId)]);
  const { rows, months, basis_ar } = data;
  const needPct = N(need.ftePct);
  const canRequest = !!need.rights?.edit && need.status !== 'cancelled' && need.source?.kind !== 'opportunity';
  const depts = await all(`SELECT d.id, d.name_ar FROM department d JOIN sector s ON s.id = d.sector_id AND s.deleted_at IS NULL
      WHERE d.active = 1 AND d.deleted_at IS NULL AND (d.sector_id = ? OR s.kind = ?) ORDER BY d.name_ar`, [need.sector_id || '', SUPPORT_KIND]);
  const base = `/app/team/needs/${encodeURIComponent(need.id)}`;
  const filtered = !!(dept || q);
  const opt = (v, label, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;

  const needCard = `<div class="tm-card" style="margin-bottom:1rem"><div class="tm-card-h">
      <div><div class="tm-card-t">${esc(need.role_ar)}</div><div class="tm-card-s">${esc(need.source?.kind_ar || '')} · ${sourceLink(need.source)}</div></div>
      <div style="display:flex;gap:.3rem;flex-wrap:wrap">${pill(esc(need.certainty_ar), CERT_TONE[need.certainty] || 'slate')}${pill(esc(need.status_ar), STATUS_TONE[need.status] || 'slate')}${pill(esc(need.coverage?.status_ar || ''), COVER_TONE[need.coverage?.status] || 'slate')}</div></div>
    <div class="tm-card-b tm-cd-need">
      <div class="blk"><div class="l">الفترة</div><div class="v">${periodText(need.period)}</div></div>
      <div class="blk"><div class="l">الطلب</div><div class="v tnum">${esc(need.demand_ar)}</div>${need.splittable ? '<div class="tm-nd-meta">يمكن تقسيم العمل بين أكثر من مورد</div>' : ''}</div>
      <div class="blk"><div class="l">المهارات</div>${skillChips(need.skills)}${need.level ? `<div class="tm-nd-meta">المستوى: ${esc(levelLabel(need.level))}</div>` : ''}</div>
      <div class="blk"><div class="l">الحسم والمسؤول</div><div class="v">${need.decide_by ? fmtDate(need.decide_by) : '—'}</div><div class="tm-nd-meta">${esc(need.owner?.name || '—')}</div>
        ${(need.requests || []).length ? `<div class="tm-nd-meta">الطلبات المرتبطة: ${need.requests.map((r) => `<a href="/app/team/requests/${encodeURIComponent(r.id)}" style="color:var(--brand)" class="tnum">${esc(r.id)}</a>`).join('، ')}</div>` : ''}</div>
      ${need.goal ? `<div class="blk" style="flex-basis:100%"><div class="l">الهدف</div><div style="font-size:var(--fs-body)">${esc(need.goal)}</div></div>` : ''}
    </div></div>`;

  const filters = `<form class="tm-nd-filters" method="get" action="${esc(base)}" data-autosubmit style="margin:0">
      <div class="field"><label for="cd-q">البحث في المرشحين</label><input id="cd-q" name="q" class="input" value="${esc(q)}" placeholder="الاسم أو المسمى"></div>
      <div class="field"><label for="cd-dept">الإدارة</label><select id="cd-dept" name="department" class="input">${opt('', 'كل الإدارات', !dept)}${depts.map((d) => opt(d.id, d.name_ar, d.id === dept)).join('')}</select></div>
      <button class="btn" type="submit">${icon('search')} بحث</button>${filtered ? `<a class="btn btn-ghost" href="${esc(base)}">مسح</a>` : ''}
    </form>`;

  let table;
  if (!rows.length) {
    table = filtered
      ? `${emptyState('لا نتائج للبحث', 'غيّر الاسم أو الإدارة.')}<div style="text-align:center;padding-bottom:1rem"><a class="btn btn-sm" href="${esc(base)}">عرض الكل</a></div>`
      : emptyState('لا مرشحين ضمن نطاق مصدر العمل', 'الأهلية: موارد قطاع مصدر العمل ووحدات المساندة النشطة.');
  } else {
    table = `<div class="tblwrap"><table class="tm-tbl keep-all tm-cd-tbl">
      <thead><tr>${canRequest ? '<th rowspan="2"></th>' : ''}<th rowspan="2">المرشح</th><th rowspan="2">المهارات</th><th colspan="${months.length}" style="text-align:center">المتاح من طاقته بعد التسكين المؤكد</th><th rowspan="2">الطلبات غير المعتمدة</th><th rowspan="2">الملاءمة</th></tr>
        <tr>${months.map((m) => `<th class="mo">${esc(m.label_ar)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => candRow(r, { months, needPct, canRequest })).join('')}</tbody></table></div>
      <div class="tm-pager"><span>${countAr(rows.length, { one: 'مرشح واحد', two: 'مرشحان', few: 'مرشحين', many: 'مرشحاً' })}</span><span class="tm-note">${icon('info')} المتاح مبني على التسكين المؤكد؛ الطلبات غير المعتمدة تظهر منفصلة.</span></div>`;
  }

  const panel = canRequest ? `<div class="tm-card tm-cd-panel" id="tm-cd-panel" hidden style="margin-top:1rem">
      <div class="tm-card-h"><div><div class="tm-card-t">${G.prepareRequest}</div><div class="tm-card-s" data-cand-name></div></div></div>
      <div class="tm-card-b tm-form">
        <div class="row">
          <div class="field"><label class="req" for="cd-pct">نسبة التسكين من طاقته</label><input id="cd-pct" type="number" name="pct" class="input" min="1" max="100" step="1" value="${needPct || 100}"></div>
          <div class="field"><label class="req">نوع التسكين المطلوب</label><div class="tm-radio"><label><input type="radio" name="allocStatus" value="confirmed"${need.certainty !== 'tentative' ? ' checked' : ''}> مؤكد</label><label><input type="radio" name="allocStatus" value="tentative"${need.certainty === 'tentative' ? ' checked' : ''}> مبدئي</label></div></div>
        </div>
        <div class="tm-cd-months" data-cd-months></div>
        <div class="tm-warn tnum" data-cd-warn hidden style="margin-top:.6rem"></div>
        <div class="tm-danger" data-cd-err hidden role="alert" style="margin-top:.6rem"></div>
        <div class="tm-ok" data-cd-ok hidden style="margin-top:.6rem"></div>
        <div class="tm-note" style="margin-top:.6rem">${icon('info')} الاختيار لا يحجز شيئاً — الطلب يمرّ بمراجعة مدير المورد قبل أي تغيير في التسكين.</div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.8rem"><button type="button" class="btn btn-primary" data-action="cd-submit">إرسال طلب التسكين</button><a class="btn" href="/app/team/needs">العودة للاحتياجات</a></div>
      </div></div>`
    : `<div class="tm-info" style="margin-top:1rem">${need.source?.kind === 'opportunity'
      ? 'الاحتياج مسجَّل على فرصة — يُطلب التسكين بعد تحويلها إلى مشروع، وحتى ذلك الحين يُضاف المرشح إلى فريق الفرصة.'
      : need.status === 'cancelled' ? 'الاحتياج ملغى — لا يُطلب تسكين عليه.' : 'إعداد طلب التسكين لصاحب الاحتياج أو لمن يدير إدارته أو قطاعه.'}</div>`;

  const external = `<div class="tm-info" style="margin-top:1rem">${icon('info')} لا مرشح مناسب؟ <b>طلب توفير مورد خارجي</b> يتم وفق الإجراء القائم لدى الإدارة المختصة، ثم يُسجَّل المورد في <a href="/app/team/resources" style="color:var(--brand);text-decoration:underline">سجل الموارد</a> — لا تعاقد آلي ولا تكلفة مقدَّرة هنا.</div>`;

  const body = `<style>${CSS}</style>
    ${needCard}
    <div class="tm-card"><div class="tm-card-h"><div class="tm-card-t">الموارد المرشحة</div>${filters}</div>${table}</div>
    ${panel}
    ${external}
    <div class="tm-foot">${esc(basis_ar || '')}</div>
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{needCandidates:${json({
    needId: need.id, needPct, canRequest, months: months.map((m) => ({ key: m.key, label_ar: m.label_ar })),
    rows: Object.fromEntries(rows.map((r) => [r.employeeId, {
      name: r.name, eligible: !!r.eligible,
      availability: (r.availability || []).map((a) => ({ key: a.key, label_ar: a.label_ar, state: a.state, availablePct: a.availablePct == null ? undefined : N(a.availablePct), confirmedPct: N(a.confirmedPct), pendingPct: N(a.pendingPct) })),
    }])),
  })}});</script>`;

  return teamLayout({
    user, path: 'analysis', section: 'needs', title: G.pathAnalysis,
    subtitle: `ترشيح الموارد · ${need.role_ar} · ${need.source?.label || ''}`,
    crumbs: [{ label: G.needsTab, href: '/app/team/needs' }, { label: need.role_ar, href: '#' }],
    actions: need.rights?.edit && need.status !== 'cancelled' ? `<a class="btn" href="/app/team/needs?edit=${encodeURIComponent(need.id)}">${icon('edit')} تعديل الاحتياج</a>` : '',
    body, scripts: ['/static/pages/team-needs.js'], year: opts.year,
  });
}
