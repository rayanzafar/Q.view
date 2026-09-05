// عميل مصفوفة التسكين (S13) ودرجَي «تسكين جديد» (S14) و«معالجة التجاوز» (S15).
// تفويض data-action فقط — لا onclick. كل البيانات من window.__SANAD.teamPlanning (مقصوصة
// بصلاحية القارئ في الخادم)، وكل رقمٍ في المعاينة من ردّ الخادم لا من حسابٍ هنا.
// لا نجاح قبل ردّ الخادم؛ الأزرار تُعطَّل أثناء الإرسال؛ مفتاح عدم التكرار يُولَّد مرةً عند
// المعاينة ويبقى هو نفسه عند إعادة المحاولة؛ وسباق الطلبات يُحسم بمعرّف آخر طلب.
(function () {
  'use strict';

  // ── أدوات ─────────────────────────────────────────────────────────────────────
  const S = () => (window.__SANAD || {}).teamPlanning || {};
  const esc = (s) => (window.Sanad && window.Sanad.esc ? window.Sanad.esc(s)
    : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const api = async (path, method, body) => {
    const r = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: Object.assign({ 'X-Requested-With': 'fetch' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { location.reload(); return new Promise(() => {}); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || 'تعذّر إتمام العملية — أعد المحاولة');
    return j;
  };
  const toast = (msg, bad) => {
    if (window.Sanad && typeof window.Sanad.toast === 'function') return window.Sanad.toast(msg, bad);
    const d = document.createElement('div');
    d.textContent = msg; d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;max-width:min(92vw,420px);line-height:1.7;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#b91c1c' : '#047857');
    document.body.appendChild(d); setTimeout(() => d.remove(), bad ? 5200 : 2600);
  };
  const MONTHS = () => S().monthNames || window.__SANAD_MONTHS || [];
  const monthLabel = (key) => { const p = String(key || '').split('-'); return (MONTHS()[Number(p[1]) - 1] || '') + ' ' + (p[0] || ''); };
  const isKey = (k) => /^\d{4}-\d{2}$/.test(String(k || ''));
  const monthsBetween = (a, b) => {
    if (!isKey(a) || !isKey(b)) return [];
    let y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7));
    const out = [];
    while (out.length <= 24) {
      const k = y + '-' + String(m).padStart(2, '0');
      if (k > b) break;
      out.push(k); m += 1; if (m > 12) { m = 1; y += 1; }
    }
    return out;
  };
  const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : 'k-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const resOf = (id) => (S().resources || []).find((r) => r.id === id) || null;
  const cellOf = (id, key) => ((S().cells || {})[id] || {})[key] || null;
  const projOf = (id) => (S().projects || []).find((p) => p.id === id) || null;
  const bucketLabel = (k) => (((S().buckets || []).find((b) => b.key === k) || {}).label) || 'عمل داخلي';
  const PCT_MAX = () => Number(S().pctMax) || 150;
  const clamp = (v) => { v = Math.round(Number(v)); if (!Number.isFinite(v) || v < 0) v = 0; return Math.min(v, PCT_MAX()); };
  const pctTxt = (v) => (v == null ? '<span style="color:var(--faint)">—</span>' : '<span class="tnum">' + Math.round(Number(v) || 0) + '%</span>');
  const statusLabel = (s) => (window.Sanad && window.Sanad.lbl ? window.Sanad.lbl(s) : (s || ''));
  const countRes = (n) => n === 1 ? 'مورد واحد' : n === 2 ? 'موردان' : n >= 3 && n <= 10 ? n + ' موارد' : n + ' مورداً';

  // ── مرشِّحات المصفوفة: الحالة في الرابط ───────────────────────────────────────
  const filters = document.getElementById('pl-filters');
  function submitFilters() {
    if (!filters) return;
    const p = new URLSearchParams();
    ['from', 'to', 'sector', 'department', 'q'].forEach((n) => { const el = filters.elements[n]; if (el && String(el.value || '').trim()) p.set(n, String(el.value).trim()); });
    const tent = document.getElementById('pl-f-tent');
    if (tent && !tent.checked) p.set('tentative', '0');
    const qs = p.toString();
    location.href = location.pathname + (qs ? '?' + qs : '');
  }
  if (filters) {
    filters.addEventListener('submit', (e) => { e.preventDefault(); submitFilters(); });
    filters.addEventListener('change', (e) => { if (e.target && e.target.id !== 'pl-f-q') submitFilters(); });
    let qt = null;
    const q = document.getElementById('pl-f-q');
    if (q) q.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(submitFilters, 650); });
  }

  // ── الدرج المشترك ─────────────────────────────────────────────────────────────
  const drawer = document.getElementById('pl-drawer');
  const scrim = document.getElementById('pl-scrim');
  const dw = { open: false, kind: null, opener: null, dirty: false, busy: false, seq: 0, done: false, reloadOnClose: false };
  const $ = (sel) => (drawer ? drawer.querySelector(sel) : null);
  const $$ = (sel) => (drawer ? Array.from(drawer.querySelectorAll(sel)) : []);
  const slot = (name) => $('[data-pl="' + name + '"]');
  const setHtml = (name, html) => { const el = slot(name); if (el) el.innerHTML = html; };

  function openDrawer(tplId, kind, opener) {
    const tpl = document.getElementById(tplId);
    if (!drawer || !tpl) { toast('تعذّر فتح النموذج — حدّث الصفحة', true); return false; }
    drawer.innerHTML = '';
    drawer.appendChild(tpl.content.cloneNode(true));
    drawer.style.display = '';
    drawer.setAttribute('aria-hidden', 'false');
    if (scrim) scrim.classList.add('open');
    requestAnimationFrame(() => drawer.classList.add('open'));
    document.body.style.overflow = 'hidden';
    Object.assign(dw, { open: true, kind, opener: opener || document.activeElement, dirty: false, busy: false, done: false, reloadOnClose: false });
    dw.seq += 1;
    return true;
  }
  function closeDrawer(force) {
    if (!dw.open) return;
    if (!force && dw.busy) { toast('انتظر انتهاء الإرسال', true); return; }
    if (!force && dw.dirty && !dw.done && !window.confirm('لديك تعديلات لم تُرسل — إغلاق النموذج؟')) return;
    const reload = dw.reloadOnClose;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.style.display = 'none';
    drawer.innerHTML = '';
    if (scrim) scrim.classList.remove('open');
    document.body.style.overflow = '';
    const op = dw.opener;
    Object.assign(dw, { open: false, kind: null, opener: null, dirty: false, busy: false, done: false, reloadOnClose: false });
    sn = null; fx = null;
    if (op && op.focus && document.contains(op)) op.focus();
    if (reload) location.reload();
  }
  function focusFirst() {
    const el = $('.db input:not([type=hidden]):not([type=radio]), .db select, .db textarea, .db button');
    if (el) el.focus();
  }
  function setStep(n) {
    $$('[data-pl-step]').forEach((s) => { s.hidden = Number(s.dataset.plStep) !== n; });
    const st = $$('[data-pl="stepper"] .st');
    st.forEach((s, i) => { s.classList.toggle('done', i < n - 1); s.classList.toggle('on', i === n - 1); });
    const body = $('.db'); if (body) body.scrollTop = 0;
  }
  const btn = (action, label, cls, disabled, extra) => '<button type="button" class="btn ' + (cls || '') + '" data-action="' + action + '"' + (disabled ? ' disabled' : '') + (extra || '') + '>' + label + '</button>';

  // ═══ S14 — تسكين جديد ═══════════════════════════════════════════════════════
  let sn = null;

  function openNew(prefill, opener) {
    const P = S();
    if (!openDrawer('tpl-pl-new', 'new', opener)) return;
    sn = {
      tk: 'project', project: null, bucket: ((P.buckets || [])[0] || {}).key || 'bd', billable: false, status: 'confirmed',
      resIds: [], from: (P.period || {}).from || '', to: (P.period || {}).to || '', pmode: 'uniform', pct: 50, per: {},
      need: null, parts: [], key: null, previewed: false, stale: false, step: 1,
    };
    Object.assign(sn, prefill || {});
    sn.resIds = sn.resIds.filter((id) => resOf(id));
    if (sn.project && !projOf(sn.project)) sn.project = null;
    if (sn.tk === 'project' && sn.project) sn.billable = !!projOf(sn.project).billable;
    if (sn.tk === 'bucket') sn.billable = false;
    const set = (name, val) => { const el = $('input[name="' + name + '"][value="' + val + '"]'); if (el) el.checked = true; };
    set('pl-tk', sn.tk); set('pl-bill', sn.billable ? '1' : '0'); set('pl-st', sn.status); set('pl-pm', sn.pmode);
    const b = $('#pl-bucket'); if (b) b.value = sn.bucket;
    const f = $('#pl-from'); if (f) f.value = sn.from;
    const t = $('#pl-to'); if (t) t.value = sn.to;
    const pc = $('#pl-pct'); if (pc) pc.value = sn.pct;
    renderTarget(); renderProjects(''); renderPicked(); renderChips(); renderPer(); renderFoot();
    if (sn.resIds.length && sn.tk === 'project' && !sn.project) { const q = $('#pl-pq'); if (q) q.focus(); } else focusFirst();
  }
  function renderTarget() {
    const pb = slot('project-box'), bb = slot('bucket-box');
    if (pb) pb.hidden = sn.tk !== 'project';
    if (bb) bb.hidden = sn.tk !== 'bucket';
  }
  function renderProjects(q) {
    const list = $('#pl-plist'); if (!list) return;
    const qq = String(q || '').trim().toLowerCase();
    const all = (S().projects || []);
    const rows = all.filter((p) => !qq || (p.name + ' ' + (p.code || '')).toLowerCase().includes(qq)).slice(0, 60);
    const input = $('#pl-pq');
    if (!all.length) {
      list.hidden = false;
      list.innerHTML = '<div class="none">لا مشاريع قيد التنفيذ أو مخطَّطة ضمن نطاقك — اختر «عمل داخلي» أو اطلب فتح المشروع أولاً.</div>';
      return;
    }
    list.hidden = !(qq || !sn.project);
    if (input) input.setAttribute('aria-expanded', String(!list.hidden));
    list.innerHTML = rows.length ? rows.map((p) => '<button type="button" role="option" data-action="pl-pick-project" data-id="' + esc(p.id) + '"' + (p.id === sn.project ? ' class="active" aria-selected="true"' : '') + '>'
      + '<span>' + esc(p.name) + (p.code ? ' <span class="m">' + esc(p.code) + '</span>' : '') + '</span>'
      + '<span class="m">' + esc(statusLabel(p.status)) + (p.billable ? ' · قابل للفوترة' : '') + '</span></button>').join('')
      : '<div class="none">لا مشروع يطابق «' + esc(qq) + '» — جرّب اسماً آخر أو رمز المشروع.</div>';
  }
  function renderPicked() {
    const p = sn.project ? projOf(sn.project) : null;
    setHtml('project-picked', p ? 'المشروع المختار: <b>' + esc(p.name) + '</b>' + (p.code ? ' <span class="tnum" dir="ltr">' + esc(p.code) + '</span>' : '')
      + ' <button type="button" class="btn btn-ghost btn-sm" data-action="pl-unpick-project" aria-label="تغيير المشروع">تغيير</button>' : '');
  }
  function renderChips() {
    const box = slot('res-chips'); if (!box) return;
    box.innerHTML = sn.resIds.length ? sn.resIds.map((id) => { const r = resOf(id); return '<span class="tm-pl-chip">' + esc(r.name) + ' <span style="font-weight:400">· الطاقة <span class="tnum">' + esc(r.capacityPct) + '%</span></span>'
      + '<button type="button" data-action="pl-unpick-res" data-id="' + esc(id) + '" aria-label="إزالة ' + esc(r.name) + '">✕</button></span>'; }).join('')
      : '<span class="none">لم يُختر مورد بعد — ابحث وأضِف.</span>';
    renderResList($('#pl-rq') ? $('#pl-rq').value : '');
  }
  function renderResList(q) {
    const list = $('#pl-rlist'); if (!list) return;
    const qq = String(q || '').trim().toLowerCase();
    const rows = (S().resources || []).filter((r) => !sn.resIds.includes(r.id))
      .filter((r) => !qq || (r.name + ' ' + (r.job_title || '')).toLowerCase().includes(qq)).slice(0, 40);
    list.hidden = !qq;
    const input = $('#pl-rq'); if (input) input.setAttribute('aria-expanded', String(!list.hidden));
    if (list.hidden) return;
    list.innerHTML = rows.length ? rows.map((r) => '<button type="button" role="option" data-action="pl-pick-res" data-id="' + esc(r.id) + '"><span>' + esc(r.name) + ' <span class="m">' + esc(r.job_title || '') + '</span></span><span class="m">الطاقة ' + esc(r.capacityPct) + '%</span></button>').join('')
      : '<div class="none">لا مورد يطابق البحث ضمن المعروض — وسّع فلتر المصفوفة أولاً.</div>';
  }
  function renderPer() {
    const grid = slot('per-months'), pctBox = slot('pct-box');
    if (!grid) return;
    const on = sn.pmode === 'per';
    grid.hidden = !on; if (pctBox) pctBox.hidden = on;
    if (!on) return;
    const keys = monthsBetween(sn.from, sn.to);
    grid.innerHTML = keys.length ? keys.map((k) => '<label>' + esc(monthLabel(k)) + '<input type="number" class="input tnum" min="0" max="' + PCT_MAX() + '" step="5" data-pl-m="' + esc(k) + '" value="' + clamp(sn.per[k] != null ? sn.per[k] : sn.pct) + '"></label>').join('')
      : '<div class="tm-note">حدّد الفترة أولاً.</div>';
  }
  function markStale() { if (sn && sn.previewed) { sn.stale = true; renderFoot(); } }
  function validate() {
    if (sn.tk === 'project' && !sn.project) return 'اختر المشروع أولاً';
    if (sn.tk === 'bucket' && !sn.bucket) return 'اختر بند العمل الداخلي';
    if (!sn.resIds.length) return 'اختر مورداً واحداً على الأقل';
    if (!isKey(sn.from) || !isKey(sn.to)) return 'حدّد شهر البداية وشهر النهاية';
    if (sn.to < sn.from) return 'شهر النهاية قبل شهر البداية — صحّح الفترة';
    const keys = monthsBetween(sn.from, sn.to);
    if (!keys.length || keys.length > 24) return 'الفترة حتى 24 شهراً — ضيّقها';
    if (sn.pmode === 'uniform' && clamp(sn.pct) <= 0) return 'أدخل نسبة أكبر من صفر';
    if (sn.pmode === 'per' && !keys.some((k) => clamp(sn.per[k] != null ? sn.per[k] : sn.pct) > 0)) return 'أدخل نسبة أكبر من صفر لشهر واحد على الأقل';
    return null;
  }
  // الطلب الواحد يغطي سنة واحدة (الخدمة) — فالفترة العابرة لسنتين جزءان يُعاينان ويُرسلان تباعاً.
  function buildParts() {
    const keys = monthsBetween(sn.from, sn.to);
    const byYear = {};
    keys.forEach((k) => { (byYear[k.slice(0, 4)] = byYear[k.slice(0, 4)] || []).push(k); });
    return Object.keys(byYear).sort().map((y) => {
      const ks = byYear[y];
      const change = { kind: 'new', employeeIds: sn.resIds.slice(), target: { kind: sn.tk, id: sn.tk === 'project' ? sn.project : sn.bucket }, allocStatus: sn.status, billable: !!sn.billable };
      if (sn.pmode === 'per') { change.months = {}; ks.forEach((k) => { change.months[k] = clamp(sn.per[k] != null ? sn.per[k] : sn.pct); }); }
      else { change.from = ks[0]; change.to = ks[ks.length - 1]; change.pct = clamp(sn.pct); }
      return { year: y, change, preview: null, result: null, error: null, planChanged: false };
    });
  }
  async function doPreview() {
    if (!sn) return;
    const err = validate();
    if (err) { setHtml('preview', '<div class="tm-danger">' + esc(err) + '</div>'); return; }
    sn.parts = buildParts(); sn.previewed = false; sn.stale = false; sn.key = null;
    const seq = ++dw.seq; dw.busy = true; renderFoot();
    setHtml('preview', '<div class="tm-info">يُحسب الأثر على طاقة كل مورد…</div>');
    try {
      for (const part of sn.parts) part.preview = await api('/team/allocations/preview', 'POST', part.change);
      if (seq !== dw.seq) return;
      sn.previewed = true; sn.key = uuid();
      renderPreview();
    } catch (e) {
      if (seq !== dw.seq) return;
      setHtml('preview', '<div class="tm-danger">' + esc(e.message) + '</div>');
    } finally { if (seq === dw.seq) { dw.busy = false; renderFoot(); } }
  }
  function merged() {
    const byRes = new Map(); const reviewers = new Map(); const warnings = []; const blockers = [];
    let directApply = true, canSubmit = true, basis = '';
    sn.parts.forEach((p) => {
      const pv = p.preview; if (!pv) return;
      directApply = directApply && !!pv.directApply; canSubmit = canSubmit && pv.canSubmit !== false; basis = pv.basis_ar || basis;
      (pv.perResource || []).forEach((r) => {
        const cur = byRes.get(r.employeeId) || { name: r.name, months: [], direct: r.direct, warnings: [], blockers: [] };
        cur.months = cur.months.concat((r.months || []).filter((m) => m.touched !== false));
        cur.warnings = cur.warnings.concat(r.warnings_ar || []); cur.blockers = cur.blockers.concat(r.blockers_ar || []);
        cur.direct = cur.direct && r.direct;
        byRes.set(r.employeeId, cur);
      });
      (pv.reviewers || []).forEach((rv) => { if (!reviewers.has(rv.userId)) reviewers.set(rv.userId, rv); });
    });
    byRes.forEach((r) => { warnings.push.apply(warnings, r.warnings.map((w) => r.name + ': ' + w)); blockers.push.apply(blockers, r.blockers); });
    return { byRes, reviewers: Array.from(reviewers.values()), warnings, blockers, directApply, canSubmit, basis };
  }
  function effectRows(months, tentative) {
    return months.map((m) => {
      const bad = !!m.conflict, out = !!m.outOfEngagement;
      const note = out ? (tentative ? 'خارج الارتباط — يبقى مبدئياً' : 'خارج الارتباط — لا يُؤكَّد') : bad ? 'سيتجاوز 100%' : m.potentialOver ? 'تعارض محتمل مع المبدئي والمعلَّق' : 'ضمن الطاقة';
      return '<tr class="' + (bad ? 'bad' : out ? 'out' : '') + '"><td>' + esc(m.label_ar || monthLabel(m.key)) + '</td><td>' + pctTxt(m.current) + '</td><td>' + (m.added == null ? pctTxt(null) : '<span class="tnum">+' + Math.round(Number(m.added) || 0) + '%</span>') + '</td><td>' + pctTxt(m.after) + '</td><td>' + pctTxt(m.availableAfter) + '</td><td style="font-size:var(--fs-micro)">' + esc(note) + '</td></tr>';
    }).join('');
  }
  const effectHead = (tentative) => '<thead><tr><th>الشهر</th><th>الحالي (مؤكد)</th><th>الإضافة' + (tentative ? ' (مبدئي)' : '') + '</th><th>بعد الاعتماد (مؤكد)</th><th>المتاح بعد</th><th></th></tr></thead>';
  function reviewersHtml(m) {
    if (m.directApply) return '<div class="tm-ok" style="margin-top:.6rem"><b>يُطبَّق مباشرة</b> — تملك أمر هذه الموارد، ويُحفظ الأثر في السجل.</div>';
    if (!m.reviewers.length) return '<div class="tm-warn" style="margin-top:.6rem">لا مدير مسجَّل لإدارة المورد — يبقى الطلب معلَّقاً حتى يقرّره من يملك أمره.</div>';
    return '<div class="tm-info" style="margin-top:.6rem"><b>يعتمده:</b> ' + m.reviewers.map((r) => esc(r.name) + ' — ' + esc(r.why_ar || '') + ((r.resources || []).length ? ' (' + esc(r.resources.join('، ')) + ')' : '')).join('؛ ') + '</div>';
  }
  function renderPreview() {
    const m = merged();
    const tent = sn.status === 'tentative';
    let html = '';
    m.byRes.forEach((r, id) => {
      html += '<div class="tm-pl-res-h"><span>' + esc(r.name) + '</span><span style="font-size:var(--fs-micro);color:var(--muted)">' + (r.direct ? 'يُطبَّق مباشرة' : 'يحتاج اعتماد مدير المورد') + '</span></div>'
        + '<div class="tm-pl-tblwrap"><table class="tm-pl-tbl">' + effectHead(tent) + '<tbody>' + effectRows(r.months, tent) + '</tbody></table></div>';
    });
    if (m.blockers.length) html += '<div class="tm-danger" style="margin-top:.6rem">' + m.blockers.map(esc).join('<br>') + '</div>';
    if (m.warnings.length) html += '<div class="tm-warn" style="margin-top:.6rem">' + m.warnings.map(esc).join('<br>') + '</div>';
    html += reviewersHtml(m);
    if (m.basis) html += '<div class="tm-note" style="margin-top:.4rem">' + esc(m.basis) + '</div>';
    setHtml('preview', html);
  }
  function summaryHtml() {
    const m = merged();
    const target = sn.tk === 'project' ? (projOf(sn.project) || {}).name || '—' : bucketLabel(sn.bucket);
    const keys = monthsBetween(sn.from, sn.to);
    const pct = sn.pmode === 'per' ? 'نسب مختلفة: ' + keys.map((k) => monthLabel(k) + ' ' + clamp(sn.per[k] != null ? sn.per[k] : sn.pct) + '%').join('، ') : clamp(sn.pct) + '% لكل شهر';
    const row = (k, v) => '<tr><td style="color:var(--muted);width:38%">' + k + '</td><td>' + v + '</td></tr>';
    const conflicts = []; m.byRes.forEach((r) => r.months.forEach((mm) => { if (mm.conflict) conflicts.push(r.name + ' — ' + (mm.label_ar || monthLabel(mm.key)) + ' (' + Math.round(Number(mm.after) || 0) + '%)'); }));
    return '<section class="tm-sec"><div class="sh">ملخص الطلب</div><table class="tm-tbl keep-all" style="font-size:var(--fs-body)"><tbody>'
      + row('الوجهة', esc(target) + ' <span style="color:var(--muted);font-size:var(--fs-micro)">· ' + (sn.tk === 'project' ? 'مشروع' : 'عمل داخلي') + '</span>')
      + row('التصنيف التجاري', sn.billable ? 'قابل للفوترة' : 'غير قابل للفوترة')
      + row('نوع التسكين المطلوب', sn.status === 'tentative' ? 'مبدئي' : 'مؤكد')
      + row('الموارد', esc(sn.resIds.map((id) => resOf(id).name).join('، ')) + ' <span class="tnum" style="color:var(--muted)">(' + countRes(sn.resIds.length) + ')</span>')
      + row('الفترة', esc(monthLabel(sn.from)) + (sn.from === sn.to ? '' : ' – ' + esc(monthLabel(sn.to))) + (sn.parts.length > 1 ? ' <span style="color:var(--muted);font-size:var(--fs-micro)">· طلب لكل سنة (' + sn.parts.length + ')</span>' : ''))
      + row('النسبة من طاقة المورد', '<span class="tnum">' + esc(pct) + '</span>')
      + '</tbody></table></section>'
      + '<section class="tm-sec"><div class="sh">الاعتمادات المطلوبة</div>' + reviewersHtml(m).replace(' style="margin-top:.6rem"', '') + '</section>'
      + '<section class="tm-sec"><div class="sh">الاستثناءات</div>' + (conflicts.length ? '<div class="tm-danger">تجاوز الطاقة — يُعرض للمعتمِد ولا يُعتمد تلقائياً:<br>' + conflicts.map(esc).join('<br>') + '</div>' : '<div class="tm-ok">ضمن الطاقة · لا يوجد تعارض</div>')
      + (m.warnings.length ? '<div class="tm-warn" style="margin-top:.5rem">' + m.warnings.map(esc).join('<br>') + '</div>' : '') + '</section>';
  }
  function goReview() {
    if (!sn || !sn.previewed) return;
    if (sn.stale) { toast('تغيّرت البيانات بعد المعاينة — أعد المعاينة', true); return; }
    sn.step = 2;
    const box = $('[data-pl-step="2"]'); if (box) box.innerHTML = summaryHtml();
    setStep(2); renderFoot();
  }
  async function doSubmit(draft) {
    if (!sn || !sn.previewed || !sn.key) return;
    if (sn.stale) { toast('تغيّرت البيانات بعد المعاينة — أعد المعاينة', true); return; }
    sn.step = 3; setStep(3);
    const box = $('[data-pl-step="3"]');
    if (box) box.innerHTML = '<div class="tm-info">' + (draft ? 'يُحفظ كمسودة…' : 'يُرسل الطلب…') + '</div>';
    dw.busy = true; renderFoot();
    for (const part of sn.parts) {
      if (part.result) continue;                     // نجح في محاولةٍ سابقة — لا يُكرَّر
      try {
        part.result = await api('/team/allocations/requests', 'POST', {
          change: part.change, idempotencyKey: sn.key + ':' + part.year, expectedFingerprints: (part.preview || {}).fingerprints || null,
          draft: !!draft, needId: sn.need || null,
        });
        part.error = null; part.planChanged = false;
      } catch (e) { part.error = e.message; part.planChanged = /تغيّرت الخطة/.test(e.message); }
    }
    dw.busy = false;
    renderResult(draft); renderFoot();
  }
  function outcomeRow(r) {
    const st = r.status;
    const cls = st === 'applied' ? 'ok' : st === 'pending' ? 'wait' : st === 'draft' ? '' : 'bad';
    const what = st === 'applied' ? 'طُبّق التسكين مباشرة' : st === 'pending' ? (r.reviewer && r.reviewer.name ? 'بانتظار اعتماد ' + r.reviewer.name : (r.note || 'بانتظار الاعتماد'))
      : st === 'draft' ? 'حُفظ كمسودة' : st === 'returned' ? 'أُعيد: ' + (r.reason || '') : (r.status_ar || st);
    return '<div class="row-o ' + cls + '"><span><b>' + esc((r.employee || {}).name || '—') + '</b> · ' + esc((r.target || {}).label || '') + '</span><span>' + esc(what) + '</span></div>';
  }
  function renderResult(draft) {
    const box = $('[data-pl-step="3"]'); if (!box) return;
    let html = '<div class="tm-pl-outcome">';
    let failed = 0, reused = 0;
    sn.parts.forEach((p) => {
      if (p.result) {
        (p.result.requests || []).forEach((r) => { html += outcomeRow(r); });
        reused += Number((p.result.summary || {}).reused) || 0;
      } else {
        failed += 1;
        html += '<div class="row-o bad"><span><b>' + (sn.parts.length > 1 ? 'سنة ' + esc(p.year) : countRes(sn.resIds.length)) + '</b></span><span>' + esc(p.error || 'تعذّر الإرسال') + '</span></div>';
      }
    });
    html += '</div>';
    if (reused) html += '<div class="tm-info" style="margin-top:.5rem">هذا الطلب أُرسل من قبل — لم يُكرَّر.</div>';
    if (!failed) {
      html = '<div class="tm-ok" style="margin-bottom:.6rem"><b>' + (draft ? 'حُفظت المسودة.' : 'اكتمل الإرسال.') + '</b> نتيجة كل مورد أدناه — والمصفوفة تُحدَّث عند الإغلاق.</div>' + html;
      dw.dirty = false; dw.done = true; dw.reloadOnClose = true;
    } else {
      const anyPlan = sn.parts.some((p) => p.planChanged);
      html = '<div class="tm-danger" style="margin-bottom:.6rem"><b>لم يكتمل الإرسال.</b> ' + (anyPlan ? 'تغيّرت الخطة منذ المعاينة — أعد المعاينة ثم أرسل من جديد.' : 'أعد المحاولة — ما نجح لا يُكرَّر.') + '</div>' + html;
      if (sn.parts.some((p) => p.result)) dw.reloadOnClose = true;
    }
    box.innerHTML = html;
  }
  function renderFoot() {
    if (!sn) return;
    const foot = slot('foot'); if (!foot) return;
    const busy = dw.busy;
    let html = '';
    if (sn.step === 1) {
      if (sn.previewed && !sn.stale) {
        const m = merged();
        html = btn('pl-review', 'مراجعة الطلب', 'btn-primary', busy || !m.canSubmit) + btn('pl-preview', 'معاينة من جديد', '', busy) + btn('pl-close', 'إلغاء', '', busy);
        if (!m.canSubmit) html += '<span class="tm-note">عالج الموانع أعلاه ثم أعد المعاينة.</span>';
      } else {
        html = btn('pl-preview', busy ? 'جارٍ الحساب…' : 'معاينة', 'btn-primary', busy) + btn('pl-close', 'إلغاء', '', busy);
        if (sn.stale) html += '<span class="tm-note">تغيّرت البيانات — أعد المعاينة قبل المتابعة.</span>';
      }
    } else if (sn.step === 2) {
      const m = merged();
      html = btn('pl-submit', busy ? 'جارٍ الإرسال…' : (m.directApply ? 'تطبيق التسكين' : 'إرسال الطلب'), 'btn-primary', busy) + btn('pl-draft', 'حفظ كمسودة', '', busy) + btn('pl-back', 'رجوع', '', busy);
    } else {
      const failed = sn.parts.some((p) => !p.result);
      const anyPlan = sn.parts.some((p) => p.planChanged);
      html = failed
        ? (anyPlan ? btn('pl-repreview', 'أعد المعاينة', 'btn-primary', busy) : btn('pl-retry', busy ? 'جارٍ الإرسال…' : 'إعادة المحاولة', 'btn-primary', busy)) + btn('pl-back', 'رجوع', '', busy) + btn('pl-close', 'إغلاق', '', busy)
        : btn('pl-reload', 'تحديث المصفوفة', 'btn-primary') + btn('pl-close', 'إغلاق', '');
    }
    foot.innerHTML = html;
  }

  // ═══ S15 — معالجة التجاوز ════════════════════════════════════════════════════
  let fx = null;

  function openFix(empId, key, opener) {
    const r = resOf(empId); const c = cellOf(empId, key);
    if (!r || !c) { toast('الخلية ليست ضمن العرض الحالي — وسّع الفترة أو التصفية', true); return; }
    const items = (c.items || []).filter((it) => it.status === 'confirmed' && it.allocationId);
    if (!items.length) { toast('لا بنود مؤكدة يمكن تعديلها في هذا الشهر', true); return; }
    if (!openDrawer('tpl-pl-fix', 'fix', opener)) return;
    fx = { empId, key, year: key.slice(0, 4), scope: 'month', reason: '', key2: null, previewed: false, stale: false,
      items: items.map((it) => ({ allocationId: it.allocationId, label: it.label, kind: it.kind, targetId: it.targetId, pct: Math.round(Number(it.pct) || 0), newPct: Math.round(Number(it.pct) || 0), billable: !!it.billable })),
      previews: {}, results: {}, errors: {}, changed: [] };
    renderFix(); renderFixFoot();
    const first = $('[data-fx-a]'); if (first) { first.focus(); first.select(); }
  }
  function renderFix() {
    const r = resOf(fx.empId); const c = cellOf(fx.empId, fx.key);
    setHtml('subtitle', esc(r.name) + ' · ' + esc(monthLabel(fx.key)) + '<br><span style="font-size:var(--fs-micro)">' + esc([r.resourceType_ar, r.department_name, 'الطاقة ' + r.capacityPct + '%'].filter(Boolean).join(' · ')) + '</span>');
    setHtml('fix-alert', '<div class="tm-danger"><b>التسكين المؤكد الحالي <span class="tnum">' + Math.round(Number(c.confirmedPct) || 0) + '%</span> — تجاوز <span class="tnum">' + Math.round(Number(c.overPct) || 0) + '%</span></b><div>توجد التزامات مؤكدة تتجاوز الطاقة المتاحة. خفّض نسبة بند أو أكثر ثم عاين الأثر.</div></div>');
    const others = (c.items || []).filter((it) => it.status !== 'confirmed');
    setHtml('fix-items', '<div class="tm-pl-tblwrap"><table class="tm-pl-tbl"><thead><tr><th>وجهة العمل</th><th>التصنيف</th><th>الحالي</th><th>المقترح</th></tr></thead><tbody>'
      + fx.items.map((it) => '<tr><td>' + esc(it.label) + '</td><td style="font-size:var(--fs-micro);color:var(--muted)">' + (it.kind === 'project' ? (it.billable ? 'مشروع قابل للفوترة' : 'مشروع') : 'عمل داخلي') + '</td><td>' + pctTxt(it.pct) + '</td>'
        + '<td><input type="number" class="input tnum" style="width:92px" min="0" max="' + PCT_MAX() + '" step="5" data-fx-a="' + esc(it.allocationId) + '" value="' + it.newPct + '" aria-label="النسبة المقترحة لـ' + esc(it.label) + '"></td></tr>').join('')
      + '<tr class="tot"><td colspan="2">الإجمالي</td><td>' + pctTxt(c.confirmedPct) + '</td><td><span class="tnum" data-pl="fix-total">' + fx.items.reduce((a, it) => a + it.newPct, 0) + '%</span></td></tr></tbody></table></div>'
      + (others.length ? '<div class="tm-note" style="margin-top:.4rem">طبقات لا تُخصم من المتاح: ' + esc(others.map((it) => it.label + ' ' + Math.round(Number(it.pct) || 0) + '% (' + (it.status_ar || (it.status === 'tentative' ? 'مبدئي' : 'بانتظار الاعتماد')) + ')').join('، ')) + '</div>' : ''));
    renderScopeNote();
  }
  function renderScopeNote() {
    setHtml('scope-note', fx.scope === 'onward' ? 'يُطبَّق من ' + esc(monthLabel(fx.key)) + ' حتى نهاية سنة <span class="tnum">' + esc(fx.year) + '</span> — الأشهر قبله تبقى كما هي.' : 'يُطبَّق على ' + esc(monthLabel(fx.key)) + ' وحده — بقية الأشهر تبقى كما هي.');
  }
  function fixChanged() { return fx.items.filter((it) => it.newPct !== it.pct); }
  function fixChange(it) {
    const ch = { kind: 'adjust', employeeId: fx.empId, allocationId: it.allocationId, target: { kind: it.kind, id: it.targetId }, from: fx.key, pct: it.newPct, scope: fx.scope };
    if (fx.scope === 'month') ch.to = fx.key;
    return ch;
  }
  async function fixPreview() {
    if (!fx) return;
    const changed = fixChanged();
    if (!changed.length) { setHtml('preview', '<div class="tm-danger">غيّر نسبة بند واحد على الأقل ثم عاين.</div>'); return; }
    fx.changed = changed; fx.previews = {}; fx.previewed = false; fx.stale = false; fx.key2 = null;
    const seq = ++dw.seq; dw.busy = true; renderFixFoot();
    setHtml('preview', '<div class="tm-info">يُحسب الأثر…</div>');
    try {
      for (const it of changed) fx.previews[it.allocationId] = await api('/team/allocations/preview', 'POST', fixChange(it));
      if (seq !== dw.seq) return;
      fx.previewed = true; fx.key2 = uuid();
      renderFixPreview();
    } catch (e) { if (seq !== dw.seq) return; setHtml('preview', '<div class="tm-danger">' + esc(e.message) + '</div>'); }
    finally { if (seq === dw.seq) { dw.busy = false; renderFixFoot(); } }
  }
  function renderFixPreview() {
    const c = cellOf(fx.empId, fx.key);
    const reviewers = new Map(); let direct = true;
    let rows = '';
    fx.changed.forEach((it) => {
      const pv = fx.previews[it.allocationId]; if (!pv) return;
      direct = direct && !!pv.directApply;
      (pv.reviewers || []).forEach((rv) => { if (!reviewers.has(rv.userId)) reviewers.set(rv.userId, rv); });
      const months = (((pv.perResource || [])[0] || {}).months || []).filter((m) => m.touched !== false);
      months.forEach((m) => {
        rows += '<tr class="' + (m.conflict ? 'bad' : '') + '"><td>' + esc(it.label) + '</td><td>' + esc(m.label_ar || monthLabel(m.key)) + '</td><td>' + pctTxt(m.current) + '</td><td>' + pctTxt(m.after) + '</td><td>' + pctTxt(m.availableAfter) + '</td><td style="font-size:var(--fs-micro)">' + (m.conflict ? 'ما زال يتجاوز 100%' : 'ضمن الطاقة') + '</td></tr>';
      });
    });
    let after = null;
    if (fx.changed.length === 1) {
      const pv = fx.previews[fx.changed[0].allocationId];
      const m = ((((pv || {}).perResource || [])[0] || {}).months || []).find((x) => x.key === fx.key);
      if (m) after = { pct: m.after, over: m.conflict, avail: m.availableAfter };
    }
    const proposed = fx.items.reduce((a, it) => a + it.newPct, 0);
    const cmp = '<div class="tm-pl-cmp"><div class="c before"><b>قبل التعديل: تجاوز <span class="tnum">' + Math.round(Number(c.overPct) || 0) + '%</span></b><span>المؤكد الآن <span class="tnum">' + Math.round(Number(c.confirmedPct) || 0) + '%</span></span></div>'
      + (after ? '<div class="c after' + (after.over ? ' bad' : '') + '"><b>بعد التعديل: ' + (after.over ? 'ما زال يتجاوز' : 'ضمن الطاقة') + '</b><span>المؤكد بعد الاعتماد <span class="tnum">' + Math.round(Number(after.pct) || 0) + '%</span> · المتاح <span class="tnum">' + Math.round(Number(after.avail) || 0) + '%</span></span></div>'
        : '<div class="c after' + (proposed > 100 ? ' bad' : '') + '"><b>المقترح (مجموع البنود) <span class="tnum">' + proposed + '%</span></b><span>أكثر من بند يتغيّر — الأثر الكلي يُعاد فحصه عند الاعتماد.</span></div>') + '</div>';
    const who = direct ? '<div class="tm-ok" style="margin-top:.6rem"><b>يُطبَّق مباشرة</b> — تملك أمر هذا المورد، ويُحفظ الأثر في السجل.</div>'
      : (reviewers.size ? '<div class="tm-info" style="margin-top:.6rem"><b>يراجع التعديل ويُبلَّغ:</b> ' + Array.from(reviewers.values()).map((r) => esc(r.name) + ' — ' + esc(r.why_ar || '')).join('؛ ') + '</div>'
        : '<div class="tm-warn" style="margin-top:.6rem">لا مدير مسجَّل لإدارة المورد — يبقى الطلب معلَّقاً حتى يقرّره من يملك أمره.</div>');
    setHtml('preview', '<div class="tm-pl-tblwrap"><table class="tm-pl-tbl"><thead><tr><th>البند</th><th>الشهر</th><th>قبل</th><th>بعد الاعتماد</th><th>المتاح بعد</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' + cmp + who);
  }
  async function fixSubmit() {
    if (!fx || !fx.previewed || !fx.key2) return;
    if (fx.stale) { toast('تغيّرت النسب بعد المعاينة — أعد المعاينة', true); return; }
    const ta = $('#pl-reason'); const reason = ta ? String(ta.value || '').trim() : '';
    if (!reason) { setHtml('result', '<div class="tm-danger">اكتب سبب التغيير — يصل إلى مالك العمل والمعتمِد.</div>'); if (ta) ta.focus(); return; }
    fx.reason = reason;
    dw.busy = true; renderFixFoot();
    setHtml('result', '<div class="tm-info">يُرسل التعديل…</div>');
    for (const it of fx.changed) {
      if (fx.results[it.allocationId]) continue;
      try {
        fx.results[it.allocationId] = await api('/team/allocations/requests', 'POST', {
          change: Object.assign(fixChange(it), { reason }), idempotencyKey: fx.key2 + ':' + it.allocationId,
          expectedFingerprints: (fx.previews[it.allocationId] || {}).fingerprints || null, draft: false,
        });
        delete fx.errors[it.allocationId];
      } catch (e) { fx.errors[it.allocationId] = e.message; }
    }
    dw.busy = false;
    let html = '<div class="tm-pl-outcome">';
    let failed = 0;
    fx.changed.forEach((it) => {
      const res = fx.results[it.allocationId];
      if (res) (res.requests || []).forEach((r) => { html += outcomeRow(r); });
      else { failed += 1; html += '<div class="row-o bad"><span><b>' + esc(it.label) + '</b></span><span>' + esc(fx.errors[it.allocationId] || 'تعذّر الإرسال') + '</span></div>'; }
    });
    html += '</div>';
    if (!failed) { dw.dirty = false; dw.done = true; dw.reloadOnClose = true; html = '<div class="tm-ok" style="margin-bottom:.5rem"><b>اكتمل الإرسال.</b> يبقى التسكين الحالي حتى الاعتماد؛ المصفوفة تُحدَّث عند الإغلاق.</div>' + html; }
    else { if (Object.keys(fx.results).length) dw.reloadOnClose = true; const plan = Object.values(fx.errors).some((m) => /تغيّرت الخطة/.test(m)); html = '<div class="tm-danger" style="margin-bottom:.5rem"><b>لم يكتمل الإرسال.</b> ' + (plan ? 'تغيّرت الخطة منذ المعاينة — أعد المعاينة.' : 'أعد المحاولة — ما نجح لا يُكرَّر.') + '</div>' + html; }
    setHtml('result', html);
    renderFixFoot();
  }
  function renderFixFoot() {
    if (!fx) return;
    const foot = slot('foot'); if (!foot) return;
    const busy = dw.busy;
    const done = fx.changed.length && fx.changed.every((it) => fx.results[it.allocationId]);
    let html;
    if (done) html = btn('pl-reload', 'تحديث المصفوفة', 'btn-primary') + btn('pl-close', 'إغلاق', '');
    else if (fx.previewed && !fx.stale) html = btn('fx-submit', busy ? 'جارٍ الإرسال…' : 'إرسال التعديل', 'btn-primary', busy) + btn('fx-preview', 'معاينة من جديد', '', busy) + btn('pl-close', 'إلغاء', '', busy);
    else html = btn('fx-preview', busy ? 'جارٍ الحساب…' : 'معاينة الأثر', 'btn-primary', busy) + btn('pl-close', 'إلغاء', '', busy) + (fx.stale ? '<span class="tm-note">تغيّرت النسب — أعد المعاينة قبل الإرسال.</span>' : '');
    foot.innerHTML = html;
  }

  // ═══ S13 — فتح الأدراج من المصفوفة والروابط العميقة ═════════════════════════
  function openFromCell(empId, key, opener) {
    const c = cellOf(empId, key);
    if (c && (Number(c.overPct) > 0 || c.state === 'over')) openFix(empId, key, opener);
    else openNew({ resIds: [empId], from: key, to: key }, opener);
  }
  function deepOpen() {
    const d = S().deep || {};
    if (!d.open || !drawer) return;
    if (d.open === 'fix') {
      if (d.employee && d.month && cellOf(d.employee, d.month)) openFromCell(d.employee, d.month, document.getElementById('pl-new-btn'));
      else toast('الخلية المطلوبة ليست ضمن العرض الحالي — عدّل الفترة أو التصفية', true);
      return;
    }
    const pre = { resIds: d.employee ? [d.employee] : [], need: d.need || null };
    if (d.from) pre.from = d.from; if (d.to) pre.to = d.to;
    if (d.target) { const i = d.target.indexOf(':'); pre.tk = d.target.slice(0, i); if (pre.tk === 'project') pre.project = d.target.slice(i + 1); else pre.bucket = d.target.slice(i + 1); }
    if (d.employee && !resOf(d.employee)) toast('المورد المطلوب ليس ضمن العرض الحالي — اختره من القائمة', true);
    openNew(pre, document.getElementById('pl-new-btn'));
  }

  // ── التفويض: نقر ─────────────────────────────────────────────────────────────
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'pl-new') { openNew({}, el); return; }
    if (a === 'pl-new-res') { openNew({ resIds: [el.dataset.emp] }, el); return; }
    if (a === 'pl-cell' || a === 'pl-fix') { openFromCell(el.dataset.emp, el.dataset.month, el); return; }
    if (a === 'pl-close') { closeDrawer(false); return; }
    if (a === 'pl-reload') { location.reload(); return; }
    if (!dw.open) return;
    // S14
    if (a === 'pl-pick-project') { if (sn) { sn.project = el.dataset.id; sn.billable = !!(projOf(sn.project) || {}).billable; const b = $('input[name="pl-bill"][value="' + (sn.billable ? '1' : '0') + '"]'); if (b) b.checked = true; const q = $('#pl-pq'); if (q) q.value = ''; renderProjects(''); renderPicked(); dw.dirty = true; markStale(); } return; }
    if (a === 'pl-unpick-project') { if (sn) { sn.project = null; renderProjects(''); renderPicked(); const q = $('#pl-pq'); if (q) q.focus(); markStale(); } return; }
    if (a === 'pl-pick-res') { if (sn) { if (!sn.resIds.includes(el.dataset.id)) sn.resIds.push(el.dataset.id); const q = $('#pl-rq'); if (q) { q.value = ''; q.focus(); } renderChips(); dw.dirty = true; markStale(); } return; }
    if (a === 'pl-unpick-res') { if (sn) { sn.resIds = sn.resIds.filter((x) => x !== el.dataset.id); renderChips(); dw.dirty = true; markStale(); } return; }
    if (a === 'pl-preview' || a === 'pl-repreview') { if (sn) { sn.step = 1; sn.parts.forEach((p) => { p.result = null; p.error = null; }); setStep(1); doPreview(); } return; }
    if (a === 'pl-review') { goReview(); return; }
    if (a === 'pl-back') { if (sn) { sn.step = sn.step === 3 ? 2 : 1; setStep(sn.step); renderFoot(); } return; }
    if (a === 'pl-submit') { doSubmit(false); return; }
    if (a === 'pl-draft') { doSubmit(true); return; }
    if (a === 'pl-retry') { doSubmit(false); return; }
    // S15
    if (a === 'fx-preview') { fixPreview(); return; }
    if (a === 'fx-submit') { fixSubmit(); return; }
  });

  // ── التفويض: تغيير/إدخال داخل الدرج ───────────────────────────────────────────
  function onEdit(ev) {
    if (!dw.open || !drawer.contains(ev.target)) return;
    const t = ev.target;
    // البحث في القوائم ليس تعديلاً غير محفوظ — لا يستدعي تحذيراً عند الإغلاق.
    if (sn && t.id === 'pl-pq') { renderProjects(t.value); return; }
    if (sn && t.id === 'pl-rq') { renderResList(t.value); return; }
    dw.dirty = true;
    if (sn) {
      if (t.name === 'pl-tk') { sn.tk = t.value; if (sn.tk === 'bucket') { sn.billable = false; const b = $('input[name="pl-bill"][value="0"]'); if (b) b.checked = true; } else if (sn.project) { sn.billable = !!(projOf(sn.project) || {}).billable; const b = $('input[name="pl-bill"][value="' + (sn.billable ? '1' : '0') + '"]'); if (b) b.checked = true; } renderTarget(); markStale(); return; }
      if (t.name === 'pl-bill') { sn.billable = t.value === '1'; markStale(); return; }
      if (t.name === 'pl-st') { sn.status = t.value; markStale(); return; }
      if (t.name === 'pl-pm') { sn.pmode = t.value; renderPer(); markStale(); return; }
      if (t.id === 'pl-bucket') { sn.bucket = t.value; markStale(); return; }
      if (t.id === 'pl-from') { sn.from = t.value; renderPer(); markStale(); return; }
      if (t.id === 'pl-to') { sn.to = t.value; renderPer(); markStale(); return; }
      if (t.id === 'pl-pct') { sn.pct = Number(t.value) || 0; markStale(); return; }
      if (t.matches('[data-pl-m]')) { sn.per[t.dataset.plM] = Number(t.value) || 0; markStale(); return; }
      if (t.id === 'pl-pq') { renderProjects(t.value); return; }
      if (t.id === 'pl-rq') { renderResList(t.value); return; }
    }
    if (fx) {
      if (t.name === 'pl-scope') { fx.scope = t.value; renderScopeNote(); if (fx.previewed) { fx.stale = true; renderFixFoot(); } return; }
      if (t.matches('[data-fx-a]')) {
        const it = fx.items.find((x) => x.allocationId === t.dataset.fxA);
        if (it) { it.newPct = clamp(t.value); if (ev.type === 'change') t.value = it.newPct; const tot = slot('fix-total'); if (tot) tot.textContent = fx.items.reduce((a, x) => a + x.newPct, 0) + '%'; if (fx.previewed) { fx.stale = true; renderFixFoot(); } }
        return;
      }
      if (t.id === 'pl-reason') { fx.reason = t.value; return; }
    }
  }
  document.addEventListener('change', onEdit);
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!t || !t.matches) return;
    if (t.id === 'pl-pq' || t.id === 'pl-rq' || t.matches('[data-fx-a]') || t.id === 'pl-pct' || t.matches('[data-pl-m]') || t.id === 'pl-reason') onEdit(ev);
  });

  // ── لوحة المفاتيح: Esc يغلق الدرج، وEnter/مسافة يفتح الخلية ────────────────────
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && dw.open) { ev.preventDefault(); closeDrawer(false); return; }
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.matches && ev.target.matches('.tm-mx .cell[role="button"]')) { ev.preventDefault(); ev.target.click(); }
  });

  deepOpen();
})();
