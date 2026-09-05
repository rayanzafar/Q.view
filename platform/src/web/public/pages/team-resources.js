// عميل «الفريق والموارد» — البوابة S01 (تبديل معاينات المسارات المعروضة خادمياً) وسجل الموارد
// S02 (إرسال الفلاتر تلقائياً، الصف يفتح درج المعاينة) والمعاينة الجانبية S03 (جلب
// /api/team/resources/:id/preview بحارس سباق، هيكل تحميل، خطأ بإعادة محاولة، Esc يعيد التركيز
// إلى الصف). تفويض data-action فقط — لا onclick مضمّن. البيانات من window.__SANAD (مقصوصة
// بصلاحية القارئ في الخادم) ومن ردّ الخدمة نفسها — لا معادلة هنا.
(function () {
  'use strict';

  const S = () => ((window.__SANAD || {}).teamResources) || {};
  const esc = (s) => (window.Sanad && window.Sanad.esc ? window.Sanad.esc(s)
    : String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const api = async (path, method, body) => {
    const r = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: Object.assign({ 'X-Requested-With': 'fetch' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { location.reload(); return new Promise(() => {}); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('تعذّر إتمام الطلب (' + r.status + ')'));
    return j;
  };
  const N = (v) => Number(v) || 0;
  const W = (v) => Math.max(0, Math.min(100, N(v)));

  // ── قطع عرض صغيرة — مرآة مساعدات _shell.js (pill/typePill/engagementPill/pctChip) ─────────
  const PILL = { green: '#dcfce7|#047857', red: '#fee2e2|#b91c1c', amber: '#fef3c7|#92400e', blue: '#dbeafe|#244A99', violet: '#ede9fe|#7c3aed', slate: '#f1f5f9|#475569' };
  const pill = (text, tone) => { const c = (PILL[tone] || PILL.slate).split('|'); return '<span class="pill" style="background:' + c[0] + ';color:' + c[1] + '">' + esc(text) + '</span>'; };
  const TYPE_AR = { internal: 'داخلي', external: 'خارجي', partner: 'شريك' };
  const TYPE_TONE = { internal: 'blue', external: 'violet', partner: 'green' };
  const ENG_AR = { active: 'على رأس العمل', ending: 'ينتهي قريباً', ended: 'منتهي الارتباط', upcoming: 'يبدأ لاحقاً' };
  const ENG_TONE = { active: 'green', ending: 'amber', ended: 'slate', upcoming: 'blue' };
  const ALLOC_AR = { confirmed: ['مؤكد', 'green'], tentative: ['مبدئي', 'amber'], pending: ['بانتظار الاعتماد', 'slate'] };
  const pct = (v, band) => (v == null
    ? '<span class="tm-pct b-out" title="خارج فترة الارتباط">—</span>'
    : '<span class="tm-pct b-' + esc(band || 'ok') + ' tnum">' + Math.round(N(v)) + '%</span>');
  const AV = ['#4f6bd6', '#2aa89a', '#8b5cf6', '#e0679a', '#3b82f6', '#059669', '#d97706'];
  const avatar = (name) => {
    const n = String(name || '').trim(); let h = 0;
    for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return '<span class="tm-av" style="background:' + AV[h % AV.length] + '" aria-hidden="true">' + esc(n ? n[0] : '؟') + '</span>';
  };
  const dateAr = (iso) => {
    if (!iso) return '';
    const s = String(iso).slice(0, 10); const p = s.split('-'); const M = window.__SANAD_MONTHS || [];
    return p.length === 3 && M[Number(p[1]) - 1] ? (Number(p[2]) + ' ' + M[Number(p[1]) - 1]) : s;
  };

  // ═══ S01 — البوابة: تبديل المعاينات الخاملة، والرابط يحفظ المسار المحدد ═══════════════
  const gw = document.getElementById('tm-gw');
  function gwSelect(path, moveFocus) {
    if (!gw) return;
    const cards = gw.querySelectorAll('[data-action="path-select"]');
    let card = null; let wasOn = null;
    cards.forEach((c) => {
      if (c.classList.contains('on')) wasOn = c;
      const on = !!path && c.dataset.path === path;
      c.classList.toggle('on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
      const tag = c.querySelector('.tag'); if (tag) tag.hidden = !on;
      if (on) card = c;
    });
    let panel = null;
    gw.querySelectorAll('.tm-gw-pv').forEach((p) => { const on = !!path && p.dataset.path === path; p.hidden = !on; if (on) panel = p; });
    const u = new URLSearchParams(location.search);
    if (path) u.set('path', path); else u.delete('path');
    history.replaceState(null, '', location.pathname + (u.toString() ? '?' + u.toString() : ''));
    if (!moveFocus) return;
    if (panel) {
      panel.focus({ preventScroll: true });
      if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (wasOn) wasOn.focus();
    else if (card) card.focus();
  }

  // ═══ S02/S03 — سجل الموارد ودرج المعاينة ═════════════════════════════════════════════
  const dw = document.getElementById('tm-pv');
  const scrim = document.getElementById('tm-pv-scrim');
  const el = (id) => document.getElementById(id);
  let seq = 0;          // حارس السباق: آخر طلبٍ وحده يُرسم
  let curId = null;
  let curRow = null;
  let opener = null;

  const skeleton = () => '<div class="tm-pv-sk" aria-label="جارٍ التحميل" aria-busy="true">'
    + '<div class="skeleton" style="height:22px;width:55%"></div><div class="skeleton" style="height:14px;width:35%"></div>'
    + '<div class="skeleton" style="height:96px"></div><div class="skeleton" style="height:64px"></div><div class="skeleton" style="height:64px"></div></div>';

  async function openPreview(id, row) {
    if (!dw || !id) return;
    if (curRow && curRow !== row) curRow.classList.remove('is-sel');
    curRow = row || null; curId = id;
    if (row) { row.classList.add('is-sel'); opener = row; } else opener = document.activeElement;
    el('tm-pv-name').textContent = (row && row.dataset.name) || 'معاينة المورد';
    el('tm-pv-body').innerHTML = skeleton();
    const foot = el('tm-pv-foot'); foot.hidden = true; foot.innerHTML = '';
    dw.hidden = false;
    if (scrim) scrim.classList.add('open');
    requestAnimationFrame(() => dw.classList.add('open'));
    const closeBtn = dw.querySelector('[data-action="preview-close"]');
    if (closeBtn) closeBtn.focus();
    await fetchPreview(id);
  }

  async function fetchPreview(id) {
    const my = ++seq;
    const per = S().period || {};
    const qs = new URLSearchParams();
    if (per.from) qs.set('from', per.from);
    if (per.to) qs.set('to', per.to);
    try {
      const d = await api('/team/resources/' + encodeURIComponent(id) + '/preview' + (qs.toString() ? '?' + qs.toString() : ''));
      if (my !== seq) return;           // ردٌّ أقدم من آخر طلب — يُهمل
      render(d || {}, id);
    } catch (err) {
      if (my !== seq) return;
      el('tm-pv-body').innerHTML = '<div class="tm-danger">' + esc(err.message) + '</div>'
        + '<div style="margin-top:.6rem"><button type="button" class="btn" data-action="preview-retry" data-emp="' + esc(id) + '">إعادة المحاولة</button></div>';
    }
  }

  function closePreview() {
    if (!dw || dw.hidden) return;
    seq++;
    dw.classList.remove('open');
    if (scrim) scrim.classList.remove('open');
    setTimeout(() => { if (!dw.classList.contains('open')) dw.hidden = true; }, 200);
    const back = opener; opener = null; curId = null;
    if (back && document.contains(back) && back.focus) back.focus();
  }

  function render(d, id) {
    const r = d.resource || {};
    const f = d.figures || {};
    const tl = d.taskLoad || {};
    const name = r.name_ar || r.name || (curRow && curRow.dataset.name) || '';
    el('tm-pv-name').textContent = name || 'معاينة المورد';
    const type = r.resourceType || r.resource_type || 'internal';
    const eng = r.engagement || {};
    const engStatus = eng.status || 'active';
    const out = f.availablePct == null && f.confirmedPct == null;

    const head = '<div class="tm-pv-id">' + avatar(name) + '<div style="min-width:0;flex:1">'
      + '<div class="tm-pv-n">' + esc(name) + '</div>' + (r.job_title ? '<div class="tm-pv-j">' + esc(r.job_title) + '</div>' : '')
      + '<div class="tm-pv-pills">' + pill(r.resourceType_ar || TYPE_AR[type] || 'داخلي', TYPE_TONE[type] || 'blue') + ' '
      + pill(eng.status_ar || ENG_AR[engStatus] || '—', ENG_TONE[engStatus] || 'slate') + '</div></div></div>';

    const kvRows = [
      ['الإدارة', r.department_name ? esc(r.department_name) : ''],
      ['القطاع', r.sector_name ? esc(r.sector_name) : ''],
      ['المدير المباشر', r.manager_name ? esc(r.manager_name) : (r.manager && r.manager.name ? esc(r.manager.name) : '')],
      ['الطاقة الأساسية', r.capacityPct != null ? '<span class="tnum">' + Math.round(N(r.capacityPct)) + '%</span>' : ''],
      ['الارتباط', (eng.hire_date || eng.end_date) ? '<span class="tnum">' + (eng.hire_date ? 'من ' + esc(String(eng.hire_date).slice(0, 10)) : '') + (eng.end_date ? ' إلى ' + esc(String(eng.end_date).slice(0, 10)) : '') + '</span>' : ''],
    ].filter((x) => x[1]);
    const kv = kvRows.length ? '<table class="tm-tbl keep-all" style="margin:.7rem 0"><tbody>'
      + kvRows.map((x) => '<tr><td style="color:var(--muted);width:40%">' + esc(x[0]) + '</td><td>' + x[1] + '</td></tr>').join('') + '</tbody></table>' : '';

    const figs = out
      ? '<div class="tm-info" style="margin:.8rem 0">خارج فترة الارتباط في الفترة المختارة — لا طاقة تُقاس.</div>'
      : '<div class="tm-pv-figs">'
        + '<div><div class="l">التسكين المؤكد</div><div class="v tnum">' + Math.round(N(f.confirmedPct)) + '%</div><div class="tm-bar" aria-hidden="true"><i class="c-proj" style="width:' + W(f.confirmedPct) + '%"></i></div></div>'
        + '<div><div class="l">المتاح</div><div class="v tnum">' + Math.round(N(f.availablePct)) + '%</div><div class="tm-bar" aria-hidden="true"><i class="c-int" style="width:' + W(f.availablePct) + '%"></i></div></div>'
        + (N(f.tentativePct) > 0 ? '<div><div class="l">مبدئي (لا يُخصم)</div><div class="v tnum">' + Math.round(N(f.tentativePct)) + '%</div><div class="tm-bar" aria-hidden="true"><i class="c-tent" style="width:' + W(f.tentativePct) + '%"></i></div></div>' : '')
        + '</div>';
    const load = '<div class="tm-pv-load"><span>عبء المهام: <b>' + esc(tl.level_ar || 'غير مقاس') + '</b>'
      + (tl.open ? ' <span class="tnum" style="color:var(--muted)">(' + Math.round(N(tl.pct)) + '% من ' + N(tl.open) + (N(tl.open) === 1 ? ' مهمة' : ' مهام') + (N(tl.unsized) ? '، ' + N(tl.unsized) + ' بلا نسبة' : '') + ')</span>' : '') + '</span>'
      + (tl.basis_ar ? '<span class="tm-note">' + esc(tl.basis_ar) + '</span>' : '') + '</div>';

    const working = Array.isArray(d.working) ? d.working : [];
    const workHtml = working.length
      ? '<div class="tm-list">' + working.map((w) => {
        const a = ALLOC_AR[w.status] || ALLOC_AR.confirmed;
        const tid = w.targetId || w.id || null;
        const href = w.kind === 'project' && tid ? '/app/project/' + encodeURIComponent(tid)
          : (w.kind === 'opportunity' && tid ? '/app/opportunity/' + encodeURIComponent(tid) : null);
        const label = href ? '<a href="' + esc(href) + '">' + esc(w.label) + '</a>' : esc(w.label);
        // عضوية فرصةٍ بلا نسبة لا تحجز طاقة — تُعرض «مساهم» لا صفراً (T05).
        const noPct = w.pct == null || (w.kind === 'opportunity' && !N(w.pct));
        const amount = noPct ? '<span class="m">مساهم</span>' : '<span class="tnum" style="flex:0 0 auto">' + Math.round(N(w.pct)) + '%</span>';
        return '<div class="tm-li"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + label + '</span>' + amount + pill(w.status_ar || a[0], a[1]) + '</div>';
      }).join('') + '</div>'
      : '<div class="tm-note">لا ارتباطات حالية — لم يُسكَّن على عمل في هذه الفترة.</div>';

    const up = (Array.isArray(d.upcoming) ? d.upcoming : []).slice(0, 5);
    const upHtml = up.length
      ? '<div class="tm-list">' + up.map((u) => {
        // المعلم يفتح مشروعه الأصلي؛ المهمة تفتح سجلها من تبويب مهام المورد (S06) بدرجها.
        const pid = u.projectId || u.project_id || (u.work && u.work.kind === 'project' ? u.work.id : null);
        const href = u.kind === 'milestone' && pid ? '/app/project/' + encodeURIComponent(pid)
          : '/app/team/resources/' + encodeURIComponent(id) + '?tab=' + (u.kind === 'milestone' ? 'work' : 'tasks');
        return '<div class="tm-li"><a href="' + esc(href) + '" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(u.title) + '</a>'
          + (u.due ? '<span class="tnum m" style="flex:0 0 auto">' + esc(dateAr(u.due)) + '</span>' : '<span class="m">بلا موعد</span>')
          + pill(u.status_ar || (u.kind === 'milestone' ? 'معلم' : 'مهمة'), u.kind === 'milestone' ? 'violet' : 'blue') + '</div>';
      }).join('') + '</div>'
      + '<a class="tm-pv-more" href="/app/team/resources/' + encodeURIComponent(id) + '?tab=tasks">عرض جميع المهام ›</a>'
      : '<div class="tm-note">لا مواعيد قادمة مسجّلة.</div>';

    el('tm-pv-body').innerHTML = head + kv + figs + load
      + '<div class="tm-pv-h">يعمل حالياً على</div>' + workHtml
      + '<div class="tm-pv-h">الأقرب استحقاقاً</div>' + upHtml;

    let fh = '';
    if (!out && f.availablePct != null) fh += '<div class="tm-info tm-pv-avail">متاح للتسكين في الفترة: <b class="tnum">' + Math.round(N(f.availablePct)) + '%</b> من طاقته</div>';
    fh += '<a class="btn btn-primary" href="/app/team/resources/' + encodeURIComponent(id) + '">فتح الملف الكامل</a>';
    const pl = d.planning || {};
    if (pl.request) fh += '<a class="btn" href="/app/team/planning?new=1&employee=' + encodeURIComponent(id) + '">طلب تسكين</a>';
    if (d.canOpenDossier && d.userId) fh += '<a class="btn btn-ghost" href="/app/person/' + encodeURIComponent(d.userId) + '">مهامه وملفه</a>';
    const foot = el('tm-pv-foot'); foot.innerHTML = fh; foot.hidden = false;
  }

  // ── التفويض ─────────────────────────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]'); if (!t) return;
    const a = t.dataset.action;
    if (a === 'resource-preview') {
      if (e.target.closest('a,button')) return;           // رابطٌ داخل الصف يعمل كما هو
      e.preventDefault(); openPreview(t.dataset.emp, t); return;
    }
    if (a === 'preview-close') { e.preventDefault(); closePreview(); return; }
    if (a === 'preview-retry') {
      e.preventDefault();
      const id = t.dataset.emp || curId; if (!id) return;
      el('tm-pv-body').innerHTML = skeleton(); fetchPreview(id); return;
    }
    if (a === 'path-select') {
      if (e.target.closest('a,button')) return;           // الحقائق والسهم روابط حقيقية
      e.preventDefault(); gwSelect(t.dataset.path, true); return;
    }
    if (a === 'path-close') { e.preventDefault(); gwSelect(null, true); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const rf = document.getElementById('tm-rf-host');
      if (rf && !rf.hidden) return;                          // نموذج S09 مفتوح — عميله يتولّى Esc
      if (dw && !dw.hidden) { e.preventDefault(); closePreview(); }
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches
      && e.target.matches('[data-action="resource-preview"],[data-action="path-select"]')) {
      e.preventDefault(); e.target.click();
    }
  });

  // فلاتر السجل: تغيير قائمة أو شهر يرسل النموذج (GET) فتبقى الحالة في الرابط.
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.form || t.form.id !== 'tm-res-filters') return;
    if (t.matches('select,input[type="month"]')) { if (t.form.requestSubmit) t.form.requestSubmit(); else t.form.submit(); }
  });
})();
