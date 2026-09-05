// ── الإقفال الشهري لتوزيع التكلفة — S22 · S23 · S24 · S25 (وحدة الفريق والموارد، ADR-0016) ──
//
// شاشةٌ واحدة لأربع حالات: المسودة/مراجعة المدير (S22)، المراجعة المالية (S24)، الشهر المقفل
// وطلب التصحيح (S25)، وتوزيعُ موردٍ واحد (S23). كل الأرقام هنا **نسب توزيع تكلفة الشهر بنقاط
// أساس** تأتي من خدمة `cost-close.js` كما هي — لا راتب ولا كلفة ولا مبلغ في أي سطر، ولا حسابٌ
// ثانٍ في العرض (الموجّه §9، §12.1). الصلاحية عند الخدمة (ترمي رفضاً عربياً)؛ العرض يُظهر
// الأزرار بما تعيده من أعلام (`canGenerate`, `canSendToFinance`, `canReturn`, `canLock`,
// `canExport`, `canCorrect`, `canConfirm`) فقط. «المراجعة المالية» = مكتب الرئيس التنفيذي أو
// مدير النظام — لا دور مالية في الشركة (EXECUTION-LOG C1). الترحيل للنظام المالي «لم يتم»
// دائماً في هذه النسخة: لا تكامل خارجي، والمخرج ملف توزيع معتمد بالإصدار (§5 القيد 5).
import { teamLayout, esc, pill, icon, person, typePill, stepper, emptyState, monthLabel, kv } from './_shell.js';
import { G } from '../../i18n/glossary.js';
import { all, get } from '../../../core/db/index.js';
import { forbidden } from '../../../core/http/errors.js';
import { MONTHS_AR } from '../../../core/i18n/time.js';
import { canReadClose, isFinanceReviewer } from '../../../modules/team/access.js';
import { periodOverview, periodDetail, resourceShares, projectActiveInMonth, bpToPct, FULL_BP, TARGET_KIND_AR } from '../../../modules/team/cost-close.js';

const N = (v) => Number(v) || 0;
const pct = (bp) => `<span class="tnum">${bpToPct(bp)}%</span>`;
const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
const dash = '<span style="color:var(--faint)">—</span>';
const STATUS_TONE = { draft: 'blue', manager_review: 'amber', finance_review: 'amber', locked: 'green', superseded: 'slate' };
const REVIEW_TONE = { draft: 'blue', confirmed: 'green', excluded: 'slate', missing: 'red' };
const CORR_TONE = { pending: 'amber', approved: 'green', rejected: 'red', draft: 'slate' };
const ITEM_STATUS_AR = { confirmed: 'مؤكد', tentative: 'مبدئي', pending: 'بانتظار الاعتماد' };
const words = (n, [one, two, few, many]) => (n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`);
const BLK_W = ['مانع واحد', 'مانعان', 'موانع', 'مانعاً'];

const nowUtc = () => { const d = new Date(); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }; };
const prevMonth = () => { const { year, month } = nowUtc(); return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }; };
const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const closeUrl = (period, extra = {}) => `/app/team/close${qs({ sector: period.sector_id, year: period.year, month: period.month, ...extra })}`;
const resourceUrl = (period, employeeId) => `/app/team/close/${encodeURIComponent(employeeId)}${qs({ period: period.id })}`;

// البيانات المحقونة للعميل: بلا قيمٍ فارغة (لا «null» في الصفحة) وبلا «<» حرفياً داخل السكربت.
const clean = (v) => {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) { if (x == null) continue; o[k] = clean(x); } return o; }
  return v;
};
const inject = (data) => `<script>window.__SANAD=Object.assign(window.__SANAD||{},{close:${JSON.stringify(clean(data)).replace(/</g, '\\u003c')}});</script>`;
const chip = (text, bad = false) => `<span class="tm-close-chip${bad ? ' bad' : ''}">${esc(text)}</span>`;
const exceptionChips = (list) => ((list || []).length ? list.map((x) => chip(x.label_ar, x.code === 'sum_mismatch' || x.code === 'no_lines')).join(' ') : dash);
const reviewPill = (r) => pill(esc(r.reviewStatus_ar || '—'), REVIEW_TONE[r.reviewStatus] || 'slate');
const kindPill = (kind) => pill(esc(TARGET_KIND_AR[kind] || kind), kind === 'project' ? 'blue' : 'violet');
const cell = (bp, tone) => `<div class="tm-close-cell">${pct(bp)}<div class="tm-bar" aria-hidden="true"><i class="c-${tone}" style="width:${Math.min(100, N(bp) / 100)}%"></i></div></div>`;

const CSS = `<style>
  .tm-close-bar{display:flex;justify-content:space-between;align-items:center;gap:.8rem;flex-wrap:wrap;margin-bottom:.9rem}
  .tm-close-filters{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
  .tm-close-filters select{border:1px solid var(--line);border-radius:10px;padding:.45rem .7rem;font-size:var(--fs-ui);background:#fff;font-family:inherit;color:var(--ink2)}
  .tm-close-filters .lbl{font-size:var(--fs-meta);color:var(--muted)}
  .tm-close-stage{display:grid;grid-template-columns:1fr auto;gap:.8rem;align-items:center;margin-bottom:1rem}
  @media (max-width:760px){.tm-close-stage{grid-template-columns:1fr}}
  .tm-close-status{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;font-size:var(--fs-body);color:var(--muted)}
  .tm-close-cell{min-width:110px}.tm-close-cell .tm-bar{margin-top:.3rem;max-width:130px}
  .tm-close-chip{display:inline-block;background:#fff7e6;border:1px solid #f5d38a;color:#7a4b00;border-radius:999px;padding:.12rem .55rem;font-size:var(--fs-micro);font-weight:700;margin:.1rem 0;white-space:normal;line-height:1.6}
  .tm-close-chip.bad{background:#fdeaea;border-color:#f3b4b4;color:#8a1c1c}
  .tm-close-actions{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-top:1rem}
  .tm-close-actions .btn[disabled]{opacity:.5;cursor:not-allowed}
  .tm-close-transfer{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:.7rem 1rem;margin-top:1rem;font-size:var(--fs-body);color:var(--ink2)}
  .tm-close-lines input[type=number]{width:96px;text-align:left;direction:ltr;border:1px solid var(--line);border-radius:8px;padding:.35rem .5rem;font-size:var(--fs-ui);font-family:inherit}
  .tm-close-lines input[type=number]:focus,.tm-close-lines select:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(36,74,153,.14)}
  .tm-close-lines select{max-width:260px;border:1px solid var(--line);border-radius:8px;padding:.35rem .5rem;font-size:var(--fs-body);font-family:inherit;background:#fff}
  .tm-close-lines .code{font-family:inherit;direction:ltr;unicode-bidi:isolate;display:inline-block}
  .tm-close-foot{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem;background:var(--bg);border-radius:12px;padding:.8rem 1rem;margin-top:.8rem}
  .tm-close-foot .l{font-size:var(--fs-meta);color:var(--muted)}.tm-close-foot .v{font-size:var(--fs-val-sm);font-weight:800;color:var(--ink2)}
  .tm-close-foot .v.ok{color:var(--green)}.tm-close-foot .v.bad{color:var(--red)}
  .tm-close-check{display:flex;flex-direction:column;gap:.45rem}
  .tm-close-check .it{display:flex;gap:.5rem;align-items:center;font-size:var(--fs-body)}
  .tm-close-check .it i{width:18px;height:18px;border-radius:50%;display:inline-grid;place-items:center;font-style:normal;font-size:11px;font-weight:800;flex:none}
  .tm-close-check .it.ok i{background:#dcfce7;color:var(--green)}.tm-close-check .it.no i{background:#fee2e2;color:var(--red)}
  .tm-close-log{font-size:var(--fs-body);display:flex;flex-direction:column;gap:.4rem}
  .tm-close-log .m{color:var(--muted);font-size:var(--fs-micro)}
  .tm-close-ref .it{display:flex;justify-content:space-between;gap:.6rem;align-items:center;padding:.5rem .7rem;border:1px solid var(--line);border-radius:10px;margin-bottom:.4rem;font-size:var(--fs-body)}
  .tm-close-ref .it .s{font-size:var(--fs-micro);color:var(--muted)}
  .tm-close-sub{font-size:var(--fs-micro);color:var(--muted);margin-top:.15rem}
  .tm-close-corr{border:1px solid var(--line);border-radius:12px;padding:.8rem 1rem;margin-bottom:.6rem;background:var(--surface)}
  .tm-close-corr .h{display:flex;justify-content:space-between;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:.4rem}
  .tm-close-diff td,.tm-close-diff th{padding:.45rem .5rem}
  .tm-close-diff input[type=number]{width:84px;text-align:left;direction:ltr;border:1px solid var(--line);border-radius:8px;padding:.3rem .45rem;font-size:var(--fs-ui);font-family:inherit}
  .tm-wrap [hidden],.tm-drawer [hidden]{display:none!important}
  .tm-form textarea,.tm-form input.input,.tm-form select{width:100%;border:1px solid var(--line);border-radius:10px;padding:.55rem .7rem;font-size:var(--fs-ui);font-family:inherit;background:#fff}
  .tm-form textarea:focus,.tm-form input.input:focus,.tm-form select:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(36,74,153,.14)}
</style>`;

// ── الأجزاء المشتركة ────────────────────────────────────────────────────────────────

/** محدِّدات القطاع (لأصحاب نطاق الشركة) والسنة والشهر — نموذج GET يحفظ الحالة في الرابط. */
function filterBar({ sectors, company, sectorId, sectorName, year, month, exceptions, version }) {
  const now = nowUtc();
  const years = [];
  for (let y = now.year - 2; y <= now.year; y += 1) years.push(y);
  if (!years.includes(year)) years.unshift(year);
  const yearOpts = years.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('');
  const monthOpts = MONTHS_AR.map((name, i) => {
    const m = i + 1;
    const future = year === now.year && m > now.month;
    return `<option value="${m}"${m === month ? ' selected' : ''}${future ? ' disabled' : ''}>${esc(name)}</option>`;
  }).join('');
  const sectorCtl = company
    ? `<label class="lbl" for="tm-close-sector">القطاع</label><select id="tm-close-sector" name="sector" data-action="close-filter">${sectors.map((s) => `<option value="${esc(s.id)}"${s.id === sectorId ? ' selected' : ''}>${esc(s.name_ar)}</option>`).join('')}</select>`
    : `<input type="hidden" name="sector" value="${esc(sectorId)}"><span class="lbl">القطاع</span><b>${esc(sectorName || '')}</b>`;
  return `<form method="get" action="/app/team/close" class="tm-close-filters" aria-label="اختيار الشهر والقطاع">
    ${sectorCtl}
    <label class="lbl" for="tm-close-year">السنة</label><select id="tm-close-year" name="year" data-action="close-filter" class="tnum">${yearOpts}</select>
    <label class="lbl" for="tm-close-month">الشهر</label><select id="tm-close-month" name="month" data-action="close-filter">${monthOpts}</select>
    ${exceptions ? '<input type="hidden" name="exceptions" value="1">' : ''}${version ? `<input type="hidden" name="version" value="${esc(version)}">` : ''}
    <button type="submit" class="btn btn-sm">عرض</button>
  </form>`;
}

/** مراحل الدورة من `period.stage_steps` مع الحالة الحالية والإصدار. */
function stageBlock(period) {
  const steps = period.stage_steps || [];
  const cur = steps.findIndex((s) => s.state === 'current');
  const idx = cur >= 0 ? cur : steps.length;
  return `<div class="tm-close-stage">${stepper(steps.map((s) => s.label_ar), idx)}
    <div class="tm-close-status">${pill(esc(period.status_ar), STATUS_TONE[period.status] || 'slate')}<span>الإصدار <span class="tnum">${N(period.version)}</span></span><span>·</span><span>${esc(monthLabel(period.key))}</span></div></div>`;
}

/** شريط العدادات — تتصالح مع صفوف الجدول (المؤهلون فقط؛ المستبعدون يُذكرون بجانبها). */
function countersStrip(c, { labels = ['الموارد', 'مكتملة', 'الاستثناءات'] } = {}) {
  const items = [['resources', labels[0], N(c.resources), 'team'], ['complete', labels[1], N(c.complete), 'check'], ['exceptions', labels[2], N(c.exceptions), 'risk']];
  return `<div class="tm-kpis">${items.map(([k, l, v, ic]) => `<div class="tm-kpi"><div class="l">${icon(ic)} ${esc(l)}</div><div class="v tnum" data-counter="${k}">${v}</div>${k === 'resources' && N(c.excluded) ? `<div class="s">و<span class="tnum">${N(c.excluded)}</span> خارج التوزيع هذا الشهر</div>` : ''}</div>`).join('')}</div>`;
}

const transferLine = (transfer, style = '') => `<div class="tm-close-transfer"${style ? ` style="${style}"` : ''}>${icon('inbox')}<span>${G.closeTransferLine}:</span><b>${esc(transfer?.status_ar || 'لم يتم')}</b>
  <span class="tm-note">— لا تكامل مالي خارجي في هذا الإصدار؛ الإقفال هنا لا يُثبت قيداً في نظام آخر، والمخرج ملف توزيع معتمد بالإصدار.</span></div>`;

const excludedList = (rows) => {
  const ex = rows.filter((r) => r.excluded);
  if (!ex.length) return '';
  return `<div class="tm-sec" style="margin-top:.8rem"><div class="sh">خارج التوزيع هذا الشهر (<span class="tnum">${ex.length}</span>) — لا تكلفة تُوزَّع لهم</div>
    <div class="tm-list">${ex.map((r) => `<div class="tm-li"><span>${esc(r.name)} <span class="m">· ${esc(r.resourceType_ar || '')}</span></span><span class="m">${esc(r.excluded.label_ar)}</span></div>`).join('')}</div></div>`;
};

// ── S22: المسودة والاستثناءات ─────────────────────────────────────────────────────
function draftBody(view, { exceptionsOnly }) {
  const { period, rows, counters, blockers_ar = [] } = view;
  const eligible = rows.filter((r) => !r.excluded);
  const withEx = eligible.filter((r) => r.exceptions?.length);
  const shown = exceptionsOnly ? withEx : eligible;
  const table = shown.length ? `<div class="tblwrap"><table class="tm-tbl keep-all" id="tm-close-rows"><thead><tr>
      <th>المورد</th><th>المشاريع</th><th>القطاع</th><th>غير موزع</th><th>الاستثناءات</th><th>حالة المراجعة</th><th></th></tr></thead><tbody>
      ${shown.map((r) => {
        const href = resourceUrl(period, r.employeeId);
        return `<tr class="tm-row-click" data-emp="${esc(r.employeeId)}" data-href="${esc(href)}">
          <td>${person(r.name, [r.resourceType_ar, r.job_title || r.department_name].filter(Boolean).join(' · '), { href })}</td>
          <td>${cell(r.projectsBp, 'proj')}</td><td>${cell(r.sectorBp, 'int')}</td><td>${cell(r.unallocatedBp, 'over')}</td>
          <td style="max-width:260px">${exceptionChips(r.exceptions)}</td>
          <td>${reviewPill(r)}</td>
          <td><a class="btn btn-sm" href="${esc(href)}">مراجعة</a></td></tr>`;
      }).join('')}</tbody></table></div>`
    : (exceptionsOnly
      ? `<div class="tm-ok" style="margin:1rem">لا استثناءات في هذا الشهر — كل التوزيعات مكتملة الأكواد ومجموعها 100%. <a href="${esc(closeUrl(period))}">${G.closeShowAll}</a></div>`
      : emptyState('لا موارد في هذا القطاع لهذا الشهر', 'أضف الموارد إلى القطاع من سجل الموارد، أو اختر قطاعاً آخر'));
  const sendNote = view.canSendToFinance ? ''
    : `<div class="tm-warn" id="tm-close-blockers" style="margin-top:.6rem"><b>${G.closeCannotSend}:</b> ${blockers_ar.length
      ? `${words(blockers_ar.length, BLK_W)}<ul style="margin:.4rem 1.2rem 0 0;padding:0">${blockers_ar.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
      : 'الإرسال إلى المراجعة المالية لقائد القطاع أو المراجعة المالية — أكمل مراجعة أهل إدارتك وأبلغ قائد القطاع.'}</div>`;
  const returned = period.status === 'manager_review' && period.finance_note
    ? `<div class="tm-warn" style="margin-bottom:.8rem"><b>أُعيد من المراجعة المالية:</b> ${esc(period.finance_note)}</div>` : '';
  return `${returned}${countersStrip(counters)}
    <div class="tm-card"><div class="tm-card-h"><div><div class="tm-card-t">${exceptionsOnly ? `الاستثناءات (<span class="tnum">${withEx.length}</span> من <span class="tnum">${eligible.length}</span>)` : `توزيع الموارد (<span class="tnum">${eligible.length}</span>)`}</div>
      <div class="tm-card-s">مصدر البداية: التسكين المؤكد للشهر — والتوزيع النهائي يؤكده المدير. مورد مجموعه 100% مع كود مفقود يبقى استثناءً.</div></div>
      ${exceptionsOnly ? `<a class="btn btn-sm" href="${esc(closeUrl(period))}">${G.closeShowAll}</a>` : ''}</div>
      ${table}</div>
    ${excludedList(rows)}
    <div class="tm-close-actions">
      ${view.canGenerate ? `<button type="button" class="btn" data-action="close-regen">${icon('history')} ${G.closeRefreshDraft}</button>` : ''}
      <button type="button" class="btn btn-primary" data-action="close-send"${view.canSendToFinance ? '' : ' disabled aria-disabled="true"'}>${icon('approvals')} ${G.closeSendFinance}</button>
      <span class="tm-note">${esc(G.closeManagerNoLock)}</span>
    </div>
    ${sendNote}
    ${transferLine(view.transfer)}
    <div class="tm-foot">${esc(view.basis_ar || '')}</div>`;
}

// ── S24: المراجعة المالية واعتماد الإقفال ───────────────────────────────────────────
async function financeBody(view, { finance }) {
  const { period, rows, counters, blockers_ar = [] } = view;
  const eligible = rows.filter((r) => !r.excluded);
  const canReturn = view.canReturn ?? view.canLock;
  const usernames = [...new Set(eligible.flatMap((r) => r.lines.map((l) => l.confirmed_by)).filter(Boolean))];
  const names = new Map();
  if (usernames.length) {
    for (const u of await all(`SELECT username, name_ar FROM app_user WHERE username IN (${usernames.map(() => '?').join(',')})`, usernames)) names.set(u.username, u.name_ar);
  }
  const who = (u) => names.get(u) || u || '—';
  const table = eligible.length ? `<div class="tblwrap"><table class="tm-tbl keep-all" id="tm-close-rows"><thead><tr>
      <th>المورد</th><th>مشاريع</th><th>قطاع</th><th>الإجمالي</th><th>الاستثناءات</th><th>مراجعة المدير</th><th></th></tr></thead><tbody>
      ${eligible.map((r) => {
        const href = resourceUrl(period, r.employeeId);
        return `<tr class="tm-row-click" data-emp="${esc(r.employeeId)}" data-href="${esc(href)}">
          <td>${person(r.name, [r.resourceType_ar, r.job_title || r.department_name].filter(Boolean).join(' · '), { href })}</td>
          <td>${pct(r.projectsBp)}</td><td>${pct(r.sectorBp)}</td><td><b>${pct(r.totalBp)}</b></td>
          <td style="max-width:240px">${exceptionChips(r.exceptions)}</td><td>${reviewPill(r)}</td>
          <td><a class="btn btn-sm" href="${esc(href)}">عرض</a></td></tr>`;
      }).join('')}</tbody></table></div>` : emptyState('لا موارد في هذا الشهر', 'لا شيء يُراجع — أعد الشهر إلى المدير إن كان ذلك خطأ');
  const missingCode = eligible.some((r) => r.exceptions.some((x) => x.code === 'missing_fin_code'));
  const check = (ok, text) => `<div class="it ${ok ? 'ok' : 'no'}"><i>${ok ? '✓' : '✕'}</i><span>${text}</span></div>`;
  const readiness = `<div class="tm-close-check">
    ${check(counters.complete === counters.resources && counters.resources > 0, `التوزيع مكتمل لـ<span class="tnum">${N(counters.complete)}/${N(counters.resources)}</span> من الموارد`)}
    ${check(!missingCode, 'الأكواد المالية مكتملة')}
    ${check(N(counters.pending) === 0, 'تأكيد المدير محفوظ لكل مورد')}
    ${check(N(counters.exceptions) === 0, N(counters.exceptions) ? `${words(N(counters.exceptions), ['استثناء واحد مفتوح', 'استثناءان مفتوحان', 'استثناءات مفتوحة', 'استثناءً مفتوحاً'])}` : 'لا توجد استثناءات مفتوحة')}
  </div>`;
  const log = [];
  for (const r of eligible) {
    const l = r.lines.find((x) => x.confirmed_by) || r.lines[0];
    if (!l) continue;
    log.push(`<div><b>${esc(r.name)}</b> — ${esc(l.basis_ar || '')}${l.confirmed_by ? `<div class="m">أكّده ${esc(who(l.confirmed_by))} · <span class="tnum">${esc(day(l.confirmed_at))}</span></div>` : '<div class="m">لم يُؤكَّد بعد</div>'}</div>`);
  }
  const sources = `<div class="tm-close-log">
    ${period.draft_generated_at ? `<div>توليد المسودة من التسكين المؤكد <div class="m"><span class="tnum">${esc(day(period.draft_generated_at))}</span></div></div>` : ''}
    ${period.manager_confirmed_at ? `<div>آخر تأكيد مدير <div class="m"><span class="tnum">${esc(day(period.manager_confirmed_at))}</span></div></div>` : ''}
    ${period.finance_note ? `<div>آخر إعادة من المراجعة المالية <div class="m">${esc(period.finance_note)}</div></div>` : ''}
    ${log.join('')}
  </div>`;
  const exList = eligible.filter((r) => r.exceptions.length);
  const exceptions = exList.length
    ? `<div class="tm-list">${exList.map((r) => `<div class="tm-li"><a href="${esc(resourceUrl(period, r.employeeId))}" style="text-decoration:none;color:var(--ink2)"><b>${esc(r.name)}</b></a><span>${exceptionChips(r.exceptions)}</span></div>`).join('')}</div>`
    : `<div class="tm-ok">لا توجد استثناءات مفتوحة</div>`;
  const actions = finance ? `<div class="tm-close-actions" style="margin-top:.6rem">
      <button type="button" class="btn btn-primary" data-action="close-lock" data-version="${N(period.version)}"${view.canLock ? '' : ' disabled aria-disabled="true"'}>${icon('audit')} ${G.closeLockMonth}</button>
      ${canReturn ? `<button type="button" class="btn" data-action="close-return">${G.closeReturnManager}</button>` : ''}
    </div>
    ${canReturn ? '<div class="tm-note" style="margin-top:.3rem">سبب الإعادة مطلوب — يظهر للمدير ويُحفظ في الأثر.</div>' : ''}
    ${view.canLock ? '' : `<div class="tm-warn" id="tm-close-blockers" style="margin-top:.6rem"><b>لا يمكن الإقفال:</b> ${blockers_ar.length ? `<ul style="margin:.4rem 1.2rem 0 0;padding:0">${blockers_ar.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : 'الإقفال للمراجعة المالية (مكتب الرئيس التنفيذي) أو مدير النظام.'}</div>`}
    <div class="tm-danger" id="tm-close-conflict" hidden role="alert"><div data-slot="msg">${G.closeVersionStale}</div><button type="button" class="btn btn-sm" data-action="close-reload" style="margin-top:.5rem">تحديث الصفحة</button></div>
    <div class="tm-note" style="margin-top:.6rem">بعد الإقفال، تُسجَّل التعديلات كطلبات تصحيح بإصدار جديد — ولا يُعدَّل المقفل مباشرة.</div>`
    : `<div class="tm-info" style="margin-top:.6rem">الشهر عند المراجعة المالية — لا تعديل على التوزيع حتى يُعاد إلى المدير. الإقفال والإعادة للمراجعة المالية (مكتب الرئيس التنفيذي).</div>`;
  return `${countersStrip(counters, { labels: ['الموارد', 'مؤكدة ومكتملة', 'الاستثناءات'] })}
    <div class="tm-grid2">
      <div class="tm-card"><div class="tm-card-h"><div><div class="tm-card-t">التوزيع الذي أكده المدير</div><div class="tm-card-s">${esc(G.closeNotFte)}</div></div></div>${table}
        <div class="tm-card-b" style="border-top:1px solid var(--line)">${transferLine(view.transfer, 'margin-top:0')}</div></div>
      <div>
        <div class="tm-card" style="margin-bottom:1rem"><div class="tm-card-h"><div class="tm-card-t">${G.closeReadiness}</div></div><div class="tm-card-b">${readiness}${actions}</div></div>
        <div class="tm-card" style="margin-bottom:1rem"><div class="tm-card-h"><div class="tm-card-t">${G.closeSourcesApprovals}</div></div><div class="tm-card-b">${sources}</div></div>
        <div class="tm-card"><div class="tm-card-h"><div class="tm-card-t">الاستثناءات</div></div><div class="tm-card-b">${exceptions}</div></div>
      </div>
    </div>
    ${excludedList(rows)}
    <div class="tm-foot">${esc(view.basis_ar || '')}</div>`;
}

// ── S25: الشهر المقفل وطلب التصحيح ────────────────────────────────────────────────
function parseSnapshot(raw) {
  try { const s = JSON.parse(raw || 'null'); return s && Array.isArray(s.lines) ? s : null; } catch { return null; }
}
async function lockedBody(view, { finance, opts }) {
  const { period, rows, counters, corrections = [] } = view;
  const row = await get('SELECT locked_snapshot_json FROM cost_period WHERE id = ?', [period.id]);
  const snap = parseSnapshot(row?.locked_snapshot_json);
  const versions = await all(`SELECT p.id, p.version, p.status, p.finance_locked_at, p.supersedes_id, u.name_ar AS locked_by_name, u.username AS locked_by_username
      FROM cost_period p LEFT JOIN app_user u ON u.id = p.finance_locked_by
      WHERE p.sector_id = ? AND p.year = ? AND p.month = ? ORDER BY p.version`, [period.sector_id, period.year, period.month]);
  const byVersion = new Map(versions.map((v) => [v.id, v]));
  const eligible = rows.filter((r) => !r.excluded);
  // الأسطر من اللقطة المقفلة حصراً (T35)؛ وإن تعذّرت قراءتها فمن أسطر الإصدار كما قيّمتها الخدمة.
  const snapRows = new Map();
  for (const l of (snap?.lines || [])) {
    if (!snapRows.has(l.employee_id)) snapRows.set(l.employee_id, []);
    snapRows.get(l.employee_id).push({ target_kind: l.target_kind, target_id: l.target_id, label: l.target_label || '', fin_code: l.fin_code || '', shareBp: N(l.share_bp), correction_ref: l.correction_ref || '' });
  }
  const linesOf = (r) => snapRows.get(r.employeeId) || r.lines.map((l) => ({ target_kind: l.target_kind, target_id: l.target_id, label: l.label, fin_code: l.fin_code || '', shareBp: N(l.shareBp) }));
  const lineText = (ls) => ls.map((l) => `${esc(l.label || TARGET_KIND_AR[l.target_kind] || '')}${l.fin_code ? ` <span class="code tnum">(${esc(l.fin_code)})</span>` : ''} ${pct(l.shareBp)}${l.correction_ref ? ' · تصحيح' : ''}`).join(' <span style="color:var(--faint)">·</span> ');
  const table = eligible.length ? `<div class="tblwrap"><table class="tm-tbl keep-all" id="tm-close-rows"><thead><tr>
      <th>المورد</th><th>المشاريع</th><th>القطاع</th><th>غير موزع</th><th>جهات التحميل</th><th></th></tr></thead><tbody>
      ${eligible.map((r) => {
        const ls = linesOf(r);
        const proj = ls.filter((l) => l.target_kind === 'project').reduce((a, l) => a + l.shareBp, 0);
        const sec = ls.filter((l) => l.target_kind === 'sector').reduce((a, l) => a + l.shareBp, 0);
        const un = Math.max(0, FULL_BP - proj - sec);
        const href = resourceUrl(period, r.employeeId);
        return `<tr data-emp="${esc(r.employeeId)}">
          <td>${person(r.name, [r.resourceType_ar, r.job_title || r.department_name].filter(Boolean).join(' · '), { href })}</td>
          <td>${cell(proj, 'proj')}</td><td>${cell(sec, 'int')}</td><td>${cell(un, 'over')}</td>
          <td style="max-width:300px;font-size:var(--fs-meta)">${lineText(ls)}</td>
          <td>${view.canCorrect && period.status === 'locked' ? `<button type="button" class="btn btn-sm" data-action="close-correct" data-emp="${esc(r.employeeId)}">${G.closeRequestCorrection}</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : emptyState('لا موارد في النسخة المعتمدة', 'أُقفل الشهر بلا موارد مؤهلة');
  const lockedBy = snap?.locked_by?.name || snap?.locked_by?.username || byVersion.get(period.id)?.locked_by_name || '';
  const lockedAt = day(snap?.locked_at || period.finance_locked_at);
  const superseded = period.status === 'superseded';
  const latest = versions[versions.length - 1];
  const versionRows = versions.map((v) => `<tr${v.id === period.id ? ' class="is-sel"' : ''}>
      <td><span class="tnum">${N(v.version)}</span>${v.id === period.id ? ' <span class="tm-note">(المعروض)</span>' : ''}</td>
      <td>${pill(esc(v.status === 'locked' ? 'مقفل' : v.status === 'superseded' ? 'إصدار سابق' : v.status), STATUS_TONE[v.status] || 'slate')}</td>
      <td>${esc(v.locked_by_name || v.locked_by_username || '—')}</td><td><span class="tnum">${esc(day(v.finance_locked_at) || '—')}</span></td>
      <td>${v.supersedes_id && byVersion.get(v.supersedes_id) ? `يحل محل الإصدار <span class="tnum">${N(byVersion.get(v.supersedes_id).version)}</span>` : dash}</td>
      <td>${v.id === period.id ? '' : `<a class="btn btn-sm" href="${esc(closeUrl(period, { version: v.id }))}">عرض</a>`}</td></tr>`).join('');
  const corrCard = (c) => {
    const rowsHtml = (list) => (list || []).map((l) => `${esc(l.label || TARGET_KIND_AR[l.target_kind] || '')} ${pct(l.share_bp)}`).join(' · ') || '—';
    return `<div class="tm-close-corr" data-corr="${esc(c.id)}"><div class="h"><div><b>${esc(c.employee_name || '')}</b> <span class="tm-note">· طلبه ${esc(c.requested_by || '—')} · <span class="tnum">${esc(day(c.created_at))}</span></span></div>${pill(esc(c.status_ar), CORR_TONE[c.status] || 'slate')}</div>
      <div style="font-size:var(--fs-body)"><div><span class="tm-note">المعتمد (الإصدار <span class="tnum">${N(c.previous_version) || N(period.version)}</span>):</span> ${rowsHtml(c.previous)}</div><div><span class="tm-note">المقترح:</span> ${rowsHtml(c.proposed)}</div>
      <div style="margin-top:.3rem"><span class="tm-note">السبب:</span> ${esc(c.reason)}${c.evidence_label ? ` <span class="tm-note">· الشاهد:</span> ${esc(c.evidence_label)}` : ''}</div>
      ${c.decided_at ? `<div class="tm-note" style="margin-top:.3rem">القرار: ${esc(c.decided_by || '')} · <span class="tnum">${esc(day(c.decided_at))}</span>${c.decision_note ? ` · ${esc(c.decision_note)}` : ''}</div>` : ''}</div>
      ${c.status === 'pending' && finance ? `<div class="tm-close-actions" style="margin-top:.5rem"><button type="button" class="btn btn-primary btn-sm" data-action="close-decide" data-id="${esc(c.id)}" data-act="approve">اعتماد</button><button type="button" class="btn btn-sm" data-action="close-decide" data-id="${esc(c.id)}" data-act="reject">رفض</button></div>` : ''}
    </div>`;
  };
  const pending = corrections.filter((c) => c.status === 'pending');
  const decided = corrections.filter((c) => c.status !== 'pending');
  // التصحيحات المعتمدة التي أنتجت هذا الإصدار تعيش في لقطته (الطلب نفسه مسجَّل على الإصدار السابق).
  const nameOf = new Map(rows.map((r) => [r.employeeId, r.name]));
  // أسماءُ وأسبابُ التصحيحات المطبَّقة من اللقطة تُقصّ على صفوف القارئ (مدير الإدارة لا يرى تصحيح غير أهله).
  const visibleIds = new Set((rows || []).map((r) => r.employeeId));
  const applied = (snap?.corrections || []).filter((c) => visibleIds.has(c.employee_id)).map((c) => `<div class="tm-close-corr"><div class="h"><div><b>${esc(nameOf.get(c.employee_id) || '')}</b> <span class="tm-note">· من الإصدار <span class="tnum">${N(c.from_version)}</span> إلى <span class="tnum">${N(c.to_version)}</span> · <span class="tnum">${esc(day(c.decided_at))}</span></span></div>${pill('معتمد', 'green')}</div>
      <div style="font-size:var(--fs-body)"><span class="tm-note">السبب:</span> ${esc(c.reason || '')}</div></div>`);
  const corrSection = `<div class="tm-card" style="margin-top:1rem" id="tm-close-corrections"><div class="tm-card-h"><div><div class="tm-card-t">${G.closeCorrections}</div><div class="tm-card-s">${esc(G.closeCurrentStays)} — اعتماد التصحيح ينشئ إصداراً جديداً ويبقي السابق محفوظاً.</div></div></div>
    <div class="tm-card-b">${pending.length ? pending.map(corrCard).join('') : '<div class="tm-note">لا طلبات تصحيح معلقة على هذا الإصدار.</div>'}
    ${decided.length ? `<div class="tm-sec" style="margin-top:.8rem"><div class="sh">طلبات سابقة على هذا الإصدار</div>${decided.map(corrCard).join('')}</div>` : ''}
    ${applied.length ? `<div class="tm-sec" style="margin-top:.8rem"><div class="sh">تصحيحات معتمدة أنتجت هذا الإصدار</div>${applied.join('')}</div>` : ''}</div></div>`;
  // بيانات الدرج: أسطر اللقطة لكل مورد + جهات التحميل الممكنة (مشاريع القطاع القائمة في الشهر، والقطاع نفسه).
  const projects = (await all('SELECT id, name_ar, financial_code, start_date, end_date FROM project WHERE sector_id = ? AND deleted_at IS NULL ORDER BY name_ar', [period.sector_id]))
    .filter((p) => projectActiveInMonth(p, period.year, period.month)).map((p) => ({ id: p.id, name: p.name_ar, fin_code: p.financial_code || '' }));
  const otherSectors = (await all('SELECT id, name_ar FROM sector WHERE id <> ? AND deleted_at IS NULL AND active = 1 ORDER BY sort_order, name_ar', [period.sector_id])).map((s) => ({ id: s.id, name: s.name_ar }));
  const snapshotData = Object.fromEntries(eligible.map((r) => [r.employeeId, { name: r.name, lines: linesOf(r) }]));
  const drawerTpl = `<template id="tm-close-correction-tpl">
    <div class="dh"><div><div id="tm-close-drawer-title" style="font-weight:800;font-size:var(--fs-title)">طلب تصحيح بعد الإقفال</div><div class="tm-note" data-slot="who"></div></div><button type="button" class="btn btn-ghost btn-sm" data-action="close-drawer-close" aria-label="إغلاق">✕</button></div>
    <div class="db">
      <div class="tm-sec">${kv([['المورد', '<b data-slot="name"></b>'], ['الفترة', `<span>${esc(monthLabel(period.key))}</span>`], ['الإصدار المرجعي', `<span class="tnum">${N(period.version)}</span>`]])}</div>
      <div class="tm-sec"><div class="sh">مقارنة التوزيع</div>
        <div class="tblwrap"><table class="tm-tbl keep-all tm-close-diff"><thead><tr><th>جهة التحميل</th><th>المعتمد</th><th>المقترح</th><th>الفرق</th><th></th></tr></thead>
        <tbody data-slot="rows"></tbody>
        <tfoot><tr><th>الإجمالي</th><th class="tnum" data-slot="oldTotal"></th><th class="tnum" data-slot="newTotal"></th><th class="tnum" data-slot="diffTotal"></th><th></th></tr></tfoot></table></div>
        <div style="margin-top:.5rem"><button type="button" class="btn btn-sm" data-action="close-corr-add">${icon('plus')} ${G.closeAddTarget}</button></div>
        <div class="tm-info" data-slot="otherNote" hidden style="margin-top:.5rem">${esc(G.closeOtherSector)} — لا يُحفظ من هذه الشاشة في هذا الإصدار؛ حمّله على قطاع الفترة أو مشروع فيه.</div>
        <div class="tm-note" style="margin-top:.4rem">الإجمالي في النسختين يجب أن يساوي 100.00% بالضبط. ${esc(G.closeNotFte)}</div></div>
      <div class="tm-form"><div class="field"><label class="req" for="tm-close-corr-reason">سبب التصحيح</label><textarea id="tm-close-corr-reason" rows="3" maxlength="500" placeholder="ماذا تغيّر ولماذا؟ يقرؤه المراجع المالي"></textarea></div>
        <div class="field" style="margin-top:.6rem"><label for="tm-close-corr-evidence">الشاهد</label><input class="input" id="tm-close-corr-evidence" maxlength="200" placeholder="مثال: مذكرة مدير المشروع بتاريخ …"></div></div>
      <div class="tm-info" style="margin-top:.8rem">${esc(G.closeCurrentStays)}</div>
      <div class="tm-danger" data-slot="err" hidden role="alert" style="margin-top:.6rem"></div>
    </div>
    <div class="df"><button type="button" class="btn btn-primary" data-action="close-corr-submit">إرسال طلب التصحيح</button><button type="button" class="btn" data-action="close-drawer-close">إلغاء</button></div>
  </template>
  <div class="tm-scrim" id="tm-close-scrim"></div>
  <aside class="tm-drawer" id="tm-close-drawer" role="dialog" aria-modal="true" aria-labelledby="tm-close-drawer-title" aria-hidden="true"></aside>`;
  const head = `<div class="tm-close-status" style="margin:-.4rem 0 .8rem">${icon('audit')}<span>${superseded ? 'إصدار سابق' : 'النسخة المعتمدة'} · الإصدار <span class="tnum">${N(period.version)}</span></span>${lockedAt ? `<span>· أقفلته المراجعة المالية${lockedBy ? ` (${esc(lockedBy)})` : ''} في <span class="tnum">${esc(lockedAt)}</span></span>` : ''}
    ${superseded && latest ? `<span>·</span><a href="${esc(closeUrl(period))}">الإصدار الأحدث (<span class="tnum">${N(latest.version)}</span>)</a>` : ''}</div>`;
  return `${head}${countersStrip(counters, { labels: ['الموارد', 'معتمدة', 'الاستثناءات'] })}
    ${superseded ? `<div class="tm-warn" style="margin-bottom:.8rem">هذا إصدار سابق للقراءة — حلّ محله إصدار أحدث؛ طلبات التصحيح تُنشأ على الإصدار الأحدث.</div>` : ''}
    <div class="tm-card"><div class="tm-card-h"><div><div class="tm-card-t">التوزيع المعتمد</div><div class="tm-card-s">${esc(G.closeNotFte)} — لا تعديل مباشر على المقفل؛ التعديل بطلب تصحيح.</div></div></div>${table}</div>
    ${excludedList(rows)}
    ${transferLine(view.transfer)}
    <div class="tm-card" style="margin-top:1rem"><div class="tm-card-h"><div class="tm-card-t">${G.closeVersionHistory}</div></div>
      <div class="tblwrap"><table class="tm-tbl keep-all"><thead><tr><th>الإصدار</th><th>الحالة</th><th>أقفله</th><th>التاريخ</th><th>يحل محل</th><th></th></tr></thead><tbody>${versionRows}</tbody></table></div></div>
    ${corrSection}
    ${drawerTpl}
    ${inject({ view: 'overview', status: period.status, periodId: period.id, version: N(period.version), key: period.key, month: monthLabel(period.key), sectorId: period.sector_id, baseUrl: closeUrl(period),
      canCorrect: !!view.canCorrect && period.status === 'locked', isFinance: !!finance, snapshot: snapshotData,
      targets: { projects, sector: { id: period.sector_id, name: period.sector_name || 'القطاع', fin_code: period.sector_fin_code || '' }, otherSectors },
      drawer: opts.drawer === 'correction' ? 'correction' : '', employee: opts.employee || '' })}
    <div class="tm-foot">${esc(view.basis_ar || '')}</div>`;
}

// ══ S22 / S24 / S25 — بحسب حالة الفترة ═══════════════════════════════════════════════
export async function closePage(user, opts = {}) {
  if (!canReadClose(user)) throw forbidden('شاشة الإقفال لمن يراجع توزيع التكلفة — قائد القطاع أو مدير الإدارة أو المراجعة المالية');
  const company = user.role_id === 'admin' || user.scope === 'company';
  const sectors = company ? await all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL AND active = 1 ORDER BY sort_order, name_ar') : [];
  const sectorId = opts.sector || (company ? (sectors[0]?.id || null) : user.sector_id);
  const crumbs = [{ label: G.closeTab, href: '/app/team/close' }];
  if (!sectorId) {
    return teamLayout({ user, path: 'planning', section: 'close', title: G.closeTab, subtitle: G.closeSubtitle, crumbs, year: opts.year,
      body: `${CSS}<div class="tm-card">${emptyState('لا قطاع لعرض إقفاله', company ? 'أضف قطاعاً من إعدادات الإدارة ثم عُد إلى هنا' : 'حسابك بلا قطاع — اطلب من مدير النظام ربطه بقطاعك')}</div>` });
  }
  const dflt = prevMonth();
  const year = N(opts.year) || dflt.year;
  const month = N(opts.month) || dflt.month;
  const view = opts.version ? await periodDetail(user, String(opts.version)) : await periodOverview(user, { sector: sectorId, year, month, mutate: !opts._crossSite, ip: opts._ip || null });
  const { period } = view;
  if (!period) {
    // لا مسودة بعد ولا صلاحية إنشائها لهذا القارئ (أو طلبٌ وصل من موقعٍ آخر): قراءةٌ صرفة بحالة فراغ.
    return teamLayout({ user, path: 'planning', section: 'close', title: G.closeTab, subtitle: G.closeSubtitle, year: opts.year,
      crumbs: [{ label: G.closeTab, href: '/app/team/close' }],
      body: `${CSS}<div class="tm-card">${emptyState('لا مسودة لهذا الشهر بعد', view.note_ar || 'تُنشأ المسودة حين يفتح الشهرَ من يراجعه')}</div>` });
  }
  const finance = isFinanceReviewer(user);
  const exceptionsOnly = String(opts.exceptions || '') === '1';
  const locked = period.status === 'locked' || period.status === 'superseded';
  const editable = period.status === 'draft' || period.status === 'manager_review';
  const withEx = view.rows.filter((r) => !r.excluded && r.exceptions?.length).length;

  let body; let subtitle; let actions = '';
  if (period.status === 'finance_review') { subtitle = 'المراجعة المالية واعتماد الإقفال'; body = await financeBody(view, { finance }); }
  else if (locked) {
    subtitle = 'النسخة المعتمدة وطلبات التصحيح';
    body = await lockedBody(view, { finance, opts });
    if (view.canExport) actions = `<a class="btn" href="/api/team/close/${encodeURIComponent(period.id)}/export" download>${icon('download')} ${G.closeExport}</a>`;
  } else {
    subtitle = G.closeSubtitle;
    body = draftBody(view, { exceptionsOnly });
    actions = exceptionsOnly
      ? `<a class="btn" href="${esc(closeUrl(period))}">${G.closeShowAll}</a>`
      : `<a class="btn btn-primary" href="${esc(closeUrl(period, { exceptions: 1 }))}">${icon('risk')} ${G.closeReviewExceptions} (<span class="tnum">${withEx}</span>)</a>`;
  }
  const bar = `<div class="tm-close-bar">${filterBar({ sectors, company, sectorId: period.sector_id, sectorName: period.sector_name, year: period.year, month: period.month, exceptions: exceptionsOnly, version: opts.version || '' })}</div>`;
  const clientData = locked ? '' : inject({
    view: 'overview', status: period.status, periodId: period.id, version: N(period.version), key: period.key, month: monthLabel(period.key),
    sectorId: period.sector_id, baseUrl: closeUrl(period), canGenerate: !!view.canGenerate, canSendToFinance: !!view.canSendToFinance,
    canReturn: !!(view.canReturn ?? view.canLock), canLock: !!view.canLock, isFinance: !!finance, editable,
  });
  return teamLayout({
    user, path: 'planning', section: 'close', title: G.closeTab, subtitle, crumbs, actions, year: opts.year,
    scripts: ['/static/pages/team-close.js'],
    body: `${CSS}${bar}${stageBlock(period)}${body}${clientData}`,
  });
}

// ══ S23 — مراجعة توزيع التكلفة لمورد ═════════════════════════════════════════════════
export async function closeResourcePage(user, employeeId, opts = {}) {
  const crumbs = [{ label: G.closeTab, href: '/app/team/close' }];
  if (!opts.period) {
    return teamLayout({ user, path: 'planning', section: 'close', title: 'مراجعة توزيع التكلفة', subtitle: G.closeSubtitle, crumbs: [...crumbs, { label: 'مراجعة توزيع التكلفة' }], year: opts.year,
      body: `${CSS}<div class="tm-card">${emptyState('افتح المورد من شاشة الإقفال الشهري', 'اختر الشهر والقطاع ثم افتح المورد من قائمته ليُعرض توزيعه')}<div style="text-align:center;padding-bottom:1.2rem"><a class="btn btn-primary" href="/app/team/close">${G.closeTab}</a></div></div>` });
  }
  const d = await resourceShares(user, String(opts.period), employeeId);
  const { period, resource, reference } = d;
  const locked = period.status === 'locked' || period.status === 'superseded';
  const editable = !!d.canConfirm && !locked && !d.excluded;
  const backUrl = closeUrl(period);
  const drawerUrl = closeUrl(period, { drawer: 'correction', employee: resource.id });

  // جهات التحميل الممكنة: مشاريع القطاع القائمة في الشهر (بأكوادها المالية إن وُجدت)، والقطاع نفسه، وقطاع آخر (يمر بموافقته).
  const projects = editable ? (await all('SELECT id, name_ar, financial_code, start_date, end_date FROM project WHERE sector_id = ? AND deleted_at IS NULL ORDER BY name_ar', [period.sector_id]))
    .filter((p) => projectActiveInMonth(p, period.year, period.month)).map((p) => ({ id: p.id, name: p.name_ar, fin_code: p.financial_code || '' })) : [];
  const otherSectors = editable ? (await all('SELECT id, name_ar FROM sector WHERE id <> ? AND deleted_at IS NULL AND active = 1 ORDER BY sort_order, name_ar', [period.sector_id])).map((s) => ({ id: s.id, name: s.name_ar })) : [];

  // مرجع التسكين (للقراءة): بنود الشهر بنسبتها من الطاقة وحالتها، وغير المسكَّن، وأيام الارتباط.
  const cap = reference.capacity;
  const refItems = (reference.items || []).map((it) => `<div class="it"><div><div>${esc(it.label)}</div><div class="s">${esc(it.kind === 'project' ? 'مشروع' : it.kind === 'bucket' ? 'عمل داخلي' : 'عمل')} · ${esc(ITEM_STATUS_AR[it.status] || it.status)}${it.status === 'confirmed' ? '' : ' — لا يدخل في المسودة'}</div></div><b class="tnum">${N(it.pct)}%</b></div>`);
  const unassigned = reference.confirmedPct == null ? null : Math.max(0, 100 - N(reference.confirmedPct));
  if (unassigned != null && unassigned > 0) refItems.push(`<div class="it"><div><div>غير مسكَّن</div><div class="s">يُحمَّل على القطاع وفق القاعدة المعتمدة</div></div><b class="tnum">${unassigned}%</b></div>`);
  const refBody = reference.state === 'out' || !cap
    ? `<div class="tm-warn">${esc(d.excluded?.label_ar || G.outOfEngagement)}</div>`
    : `<div class="tm-close-ref">${refItems.join('') || `<div class="tm-note">لا تسكين مسجَّل في هذا الشهر — يُحمَّل كامل الشهر على القطاع.</div>`}</div>
       <div class="tm-note" style="margin-top:.5rem">أيام الارتباط: <span class="tnum">${N(cap.engagedDays)}</span> من <span class="tnum">${N(cap.days)}</span> · الطاقة التعاقدية <span class="tnum">${N(cap.nominalPct)}%</span> · النسب أعلاه من طاقة المورد</div>
       <div class="tm-info" style="margin-top:.6rem">مرجع للمراجعة، ويؤكد المدير التوزيع الفعلي. ${esc(G.closeNotFte)} — نصف دوام مسكَّن بكامله على مشروع = 100% له.</div>`;

  const projectHref = (l) => (l.target_kind === 'project' ? `/app/project/${encodeURIComponent(l.target_id)}` : '');
  const codeCell = (l) => (l.fin_code ? `<span class="code tnum">${esc(l.fin_code)}</span>`
    : `${chip(G.closeMissingCode)}${l.target_kind === 'project' ? ` <a class="tm-note" href="${esc(projectHref(l))}">سجّل الكود في صفحة المشروع</a>` : ''}`);
  const lineRow = (l) => `<tr data-kind="${esc(l.target_kind)}" data-target="${esc(l.target_id)}" data-label="${esc(l.label || '')}" data-fin="${esc(l.fin_code || '')}" data-bp="${N(l.shareBp)}">
      <td><div>${esc(l.label || TARGET_KIND_AR[l.target_kind] || '')} ${kindPill(l.target_kind)}</div>${l.note ? `<div class="tm-close-sub">${esc(l.note)}</div>` : ''}${l.exceptions?.length ? `<div class="tm-close-sub">${exceptionChips(l.exceptions)}</div>` : ''}</td>
      <td>${codeCell(l)}</td>
      <td>${editable ? `<label class="tm-note" style="display:inline-flex;gap:.3rem;align-items:center"><input type="number" class="tm-close-pct" step="0.01" min="0" max="100" value="${bpToPct(l.shareBp)}" aria-label="نسبة ${esc(l.label || '')}"> %</label>` : pct(l.shareBp)}</td>
      ${editable ? `<td><button type="button" class="btn btn-ghost btn-sm" data-action="close-line-remove" aria-label="حذف السطر">${icon('x')}</button></td>` : ''}</tr>`;
  const totalOk = N(d.totalBp) === FULL_BP;
  const linesTable = `<div class="tblwrap tm-close-lines"><table class="tm-tbl keep-all" id="tm-close-lines"><thead><tr><th>جهة التحميل</th><th>الكود المالي</th><th>النسبة</th>${editable ? '<th></th>' : ''}</tr></thead>
      <tbody>${d.lines.map(lineRow).join('') || `<tr><td colspan="4"><div class="tm-note" style="padding:.4rem 0">${esc(d.draftDiff_ar)}</div></td></tr>`}</tbody></table></div>
    ${editable ? `<div style="margin-top:.5rem"><button type="button" class="btn btn-sm" data-action="close-line-add">${icon('plus')} ${G.closeAddTarget}</button></div><div class="tm-info" id="tm-close-other-note" hidden style="margin-top:.5rem">${esc(G.closeOtherSector)} — لا يُحفظ من هذه الشاشة في هذا الإصدار؛ حمّله على قطاع الفترة أو مشروع فيه.</div>` : ''}
    <div class="tm-close-foot">
      <div><div class="l">الإجمالي</div><div class="v ${totalOk ? 'ok' : 'bad'}" id="tm-close-total"><span class="tnum">${bpToPct(d.totalBp)}%</span></div><div class="tm-close-sub" id="tm-close-total-note">${totalOk ? 'يساوي 100% بدقة التخزين' : 'يجب أن يساوي 100.00% بالضبط'}</div></div>
      <div><div class="l">غير موزع</div><div class="v" id="tm-close-unalloc"><span class="tnum">${bpToPct(d.unallocatedBp)}%</span></div></div>
      <div><div class="l">الفرق عن المسودة</div><div class="v" style="font-size:var(--fs-body);font-weight:600" id="tm-close-diff">${esc(d.draftDiff_ar)}</div></div>
    </div>`;

  let stateNote = '';
  if (d.excluded) stateNote = `<div class="tm-warn">${esc(d.excluded.label_ar)} — لا توزيع لهذا المورد في ${esc(monthLabel(period.key))}.</div>`;
  else if (locked) stateNote = `<div class="tm-warn"><b>${G.closeLockedEditVia}</b> — الإصدار <span class="tnum">${N(period.version)}</span> معتمد للقراءة. ${d.canCorrect ? `<a class="btn btn-sm" style="margin-inline-start:.5rem" href="${esc(drawerUrl)}">${G.closeRequestCorrection}</a>` : 'طلب التصحيح لمدير إدارته أو قائد قطاعه أو المراجعة المالية.'}</div>`;
  else if (period.status === 'finance_review') stateNote = `<div class="tm-info">الشهر عند المراجعة المالية — لا تعديل على التوزيع حتى يُعاد إلى المدير.</div>`;
  else if (!d.canConfirm) stateNote = `<div class="tm-info">للقراءة — تأكيد توزيع هذا المورد لمدير إدارته أو قائد قطاعه أو المراجعة المالية.</div>`;

  const form = editable ? `<div class="tm-form" style="margin-top:1rem">
      <div class="row">
        <div class="field" style="grid-column:1/-1"><label for="tm-close-reason" id="tm-close-reason-label">سبب التعديل <span class="tm-note">(مطلوب عندما يختلف التوزيع عن المسودة)</span></label><textarea id="tm-close-reason" rows="3" maxlength="500" placeholder="مثال: تحميل العمل الداخلي والفترة غير المسكَّنة على القطاع"></textarea></div>
        <div class="field"><label for="tm-close-source">مرجع المصدر</label><select id="tm-close-source"><option value="manager_confirmation">تأكيد مدير المورد</option><option value="project_manager">تأكيد مدير المشروع</option><option value="timesheet">سجل الوقت</option><option value="other">مرجع آخر</option></select></div>
      </div>
      <div class="tm-danger" id="tm-close-err" hidden role="alert" style="margin-top:.6rem"></div>
      <div class="tm-close-actions"><button type="button" class="btn btn-primary" data-action="close-confirm">${icon('approvals')} ${G.closeConfirmShares}</button><a class="btn" href="${esc(backUrl)}">إلغاء</a><span class="tm-note">${esc(G.closeManagerNoLock)}</span></div>
    </div>` : `<div class="tm-close-actions"><a class="btn" href="${esc(backUrl)}">العودة إلى الشهر</a><span class="tm-note">${esc(G.closeManagerNoLock)}</span></div>`;

  const body = `${CSS}
    <div class="tm-close-status" style="margin-bottom:.9rem;flex-wrap:wrap">${person(resource.name, [resource.resourceType_ar, resource.job_title || resource.department_name].filter(Boolean).join(' · '))}
      ${typePill(resource.resourceType, resource.resourceType_ar)}<span>·</span><span>${esc(monthLabel(period.key))}</span><span>·</span><span>الشهر:</span>${pill(esc(period.status_ar), STATUS_TONE[period.status] || 'slate')}<span>·</span><span>حالة المراجعة:</span>${reviewPill(d)}<span>·</span><span>الإصدار <span class="tnum">${N(period.version)}</span></span></div>
    ${stateNote}
    <div class="tm-grid2" style="margin-top:.8rem">
      <div class="tm-card"><div class="tm-card-h"><div><div class="tm-card-t">${editable ? 'التوزيع المالي المقترح' : 'التوزيع المالي'}</div><div class="tm-card-s">النسب من إجمالي تكلفة المورد للشهر — بلا رواتب أو تكاليف فعلية</div></div></div>
        <div class="tm-card-b">${(() => {
          // استثناءات المورد كله (المجموع/لا أسطر/أسطر قديمة) تُعرض أعلى الجدول؛ أما استثناء السطر (كود/مشروع) فعلى سطره مع إجرائه.
          const top = (d.exceptions || []).filter((x) => !['missing_fin_code', 'project_inactive', 'project_missing'].includes(x.code));
          return top.length ? `<div style="margin-bottom:.6rem">${exceptionChips(top)}</div>` : '';
        })()}${linesTable}${form}</div></div>
      <div class="tm-card"><div class="tm-card-h"><div><div class="tm-card-t">${G.closeReference}</div><div class="tm-card-s">للقراءة — نسب من طاقة المورد</div></div></div><div class="tm-card-b">${refBody}</div></div>
    </div>
    ${inject({ view: 'resource', status: period.status, periodId: period.id, employeeId: resource.id, version: N(period.version), key: period.key, baseUrl: backUrl,
      canConfirm: editable, draft: (d.draft || []).map((l) => ({ k: `${l.target_kind}:${l.target_id}`, bp: N(l.share_bp) })),
      targets: { projects, sector: { id: period.sector_id, name: period.sector_name || 'القطاع', fin_code: period.sector_fin_code || '' }, otherSectors } })}
    <div class="tm-foot">${esc(reference.basis_ar || '')}</div>`;
  return teamLayout({
    user, path: 'planning', section: 'close', title: 'مراجعة توزيع التكلفة', subtitle: `${resource.name} · ${monthLabel(period.key)}`,
    crumbs: [{ label: G.closeTab, href: backUrl }, { label: resource.name }], year: opts.year,
    scripts: ['/static/pages/team-close.js'], body,
  });
}
