// Span-board staffing (team page v2.1) — merged month spans, urgency sections, popover with a
// month stepper, partial row repaint after saves. Delegated events only; SSR provides all data
// via window.__SANAD (already role-redacted).
(function () {
  'use strict';
  const S = () => window.__SANAD || {};
  const M = () => S().monthNames || [];
  const api = async (path, method, body) => {
    const r = await fetch('/api' + path, { method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('خطأ ' + r.status));
    return j;
  };
  const toast = (msg, bad) => {
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#dc2626' : '#059669');
    document.body.appendChild(d); setTimeout(() => d.remove(), 2600);
  };
  const esc = (s) => (window.Sanad ? window.Sanad.esc(s) : String(s == null ? '' : s));

  // ── same tone model as the SSR board (people.js spanTone) ──
  const toneOf = (v, sectorMember) => v > 110 ? 'over' : v >= 70 ? 'ok' : v > 0 ? 'low' : sectorMember ? 'park' : 'off';
  const nowTone = (u) => u > 110 ? 'var(--red)' : u >= 70 ? 'var(--green)' : u > 0 ? 'var(--amber)' : 'var(--faint)';

  // ── popover state ──
  let pop = null, popCtx = null; // popCtx = { empId, month }
  function closePop() { if (pop) { pop.remove(); pop = null; popCtx = null; } }

  function cellTotal(empId, m) {
    const e = (S().emps || {})[empId]; if (!e) return 0;
    let v = 0;
    for (const p of e.projects || []) v += Number((p.months || {})[m]) || 0;
    if (m === S().currentMonth) for (const o of e.opps || []) v += Number(o.pct) || 0;
    return Math.round(v);
  }
  const monthsOf = (empId) => { const a = []; for (let m = 1; m <= 12; m++) a.push(cellTotal(empId, m)); return a; };

  function trackHtml(empId) {
    const e = (S().emps || {})[empId]; if (!e) return '';
    return (e.months || []).map((raw, i) => {
      const v = Math.round(Number(raw) || 0);
      const mn = M()[i] || '';
      const tone = toneOf(v, !!e.sector_id);
      const full = tone === 'park'
        ? 'تسكين قطاعي — ' + mn + ': وقت ' + e.name_ar + ' محجوز لقطاعه افتراضياً حتى يُسكَّن على مشروع'
        : e.name_ar + ' — ' + mn + ': ' + v + '%' + (v > 110 ? ' (تجاوز الطاقة)' : '');
      return '<button type="button" class="hg-cell ' + tone + '" data-emp="' + empId + '" data-m="' + (i + 1) + '" data-v="' + v + '" title="' + esc(full) + '" aria-label="' + esc(full) + '"><span class="tnum">' + v + '%</span></button>';
    }).join('');
  }

  // إعادة رسم صف موظف واحد من الحالة (بلا إعادة تحميل): الامتدادات + «الآن» + «الذروة» + إجمالي النافذة
  function repaint(empId) {
    const e = (S().emps || {})[empId]; if (!e) return;
    e.months = monthsOf(empId);
    e.currentUtil = S().currentMonth ? e.months[S().currentMonth - 1] : 0;
    const row = document.querySelector('.brd-row[data-emp="' + empId + '"]'); if (!row) return;
    const track = row.querySelector('.mtrack'); if (track) track.innerHTML = trackHtml(empId);
    const now = row.querySelector('[data-now]'); if (now) { now.textContent = e.currentUtil + '%'; now.style.color = nowTone(e.currentUtil); }
    const peakV = Math.max(0, ...e.months);
    const peak = row.querySelector('[data-peak]'); if (peak) { peak.textContent = peakV + '%'; peak.style.color = peakV > 110 ? 'var(--red)' : 'var(--ink2)'; }
    if (pop && popCtx && popCtx.empId === empId) {
      const t = cellTotal(empId, popCtx.month);
      const totalEl = pop.querySelector('[data-pop-total]');
      if (totalEl) { totalEl.textContent = t + '%'; totalEl.style.color = t > 110 ? 'var(--red)' : 'var(--ink2)'; }
    }
  }

  // ── popover: rows for the chosen month + ‹ › stepper in the header ──
  function renderPop() {
    if (!pop || !popCtx) return;
    const st = S(); const e = (st.emps || {})[popCtx.empId]; if (!e) return;
    const m = popCtx.month;
    const mName = M()[m - 1] || '';
    const canStaff = !!st.canStaff;
    const rows = (e.projects || []).map((p) => {
      const v = Number((p.months || {})[m]) || 0;
      // العمل الداخلي يُميَّز في السطر: بلا وسمٍ يُقرأ «تطوير أعمال» مشروعاً اسمه كذلك — وهو
      // بالضبط اللبس الذي منعنا وقوعه في القاعدة حين رفضنا كياناً اسمه «مشاريع داخلية».
      const tag = p.projectId ? ''
        : ' <span class="pill" style="background:#e0f2fe;color:#0369a1">داخلي</span>';
      return '<div style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px dashed var(--line)">' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px">' + esc(p.name) + tag + '</span>' +
        (canStaff
          ? '<input type="number" class="input tnum" data-pop-pct data-alloc="' + p.allocId + '" value="' + v + '" min="0" max="150" step="5" aria-label="نسبة ' + esc(p.name) + ' في ' + esc(mName) + '" style="width:74px;padding:.3rem .45rem;font-size:12.5px;direction:ltr;text-align:center">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-pop-remove data-alloc="' + p.allocId + '" data-pname="' + esc(p.name) + '" title="إزالة التسكين بالكامل">✕</button>'
          : '<b class="tnum" style="font-size:12.5px">' + v + '%</b>') +
        '</div>';
    }).join('');
    const opps = m === st.currentMonth ? (e.opps || []).map((o) =>
      '<div style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px dashed var(--line);color:var(--muted)">' +
      '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">' + esc(o.name) + ' <span class="pill" style="background:#ede9fe;color:var(--brand2)">فرصة</span></span>' +
      '<b class="tnum" style="font-size:12px">' + (Number(o.pct) || 0) + '%</b></div>').join('') : '';
    const empty = !(e.projects || []).length && !opps;
    const total = cellTotal(popCtx.empId, m);
    // الاتجاه كاتجاه اللوحة: يناير في أقصى اليمين — السهم لليمين يرجع شهراً، ولليسار يتقدم شهراً
    pop.setAttribute('aria-label', 'تعديل تسكين ' + e.name_ar + ' — ' + mName);
    pop.innerHTML =
      '<div style="padding:.6rem .8rem;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.4rem">' +
      '<b style="font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.name_ar) + ' — <span data-pop-month>' + esc(mName) + '</span></b>' +
      '<button type="button" class="btn btn-ghost btn-sm tnum" data-pop-step="-1" title="الشهر السابق" aria-label="الشهر السابق"' + (m <= 1 ? ' disabled' : '') + '>›</button>' +
      '<button type="button" class="btn btn-ghost btn-sm tnum" data-pop-step="1" title="الشهر التالي" aria-label="الشهر التالي"' + (m >= 12 ? ' disabled' : '') + '>‹</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-pop-close aria-label="إغلاق">✕</button></div>' +
      '<div style="padding:.5rem .8rem">' +
      (empty
        ? '<div style="color:var(--muted);font-size:12.5px;padding:.4rem 0">لا تسكين لهذا الموظف في ' + esc(mName) + (canStaff ? ' — أضِف تسكينًا من الزر أدناه' : '') + '.</div>'
        : rows + opps +
          '<div style="display:flex;justify-content:space-between;padding:.45rem 0 .15rem;font-size:12px;color:var(--muted)"><span>إجمالي الشهر</span><b class="tnum" data-pop-total style="color:' + (total > 110 ? 'var(--red)' : 'var(--ink2)') + '">' + total + '%</b></div>') +
      (canStaff ? addRowHtml(e, m) : '') +
      (canStaff && !empty ? '<div style="font-size:10px;color:var(--faint);padding-bottom:.45rem">اكتب النسبة ثم اخرج من الحقل — يُحفظ فورًا. Esc للإغلاق.</div>' : '') +
      '</div>';
  }

  // ── سطر الإضافة داخل النافذة نفسها ────────────────────────────────────────
  // «لما أضغط على نسبة الشخص في شهر سابع … طريقة التسكين لازم تكون مرة سهلة ليّ كمدير إدارة».
  // وكان الزرّ الوحيد هنا يفتح نافذةً أخرى فوق النافذة ثم يعيد تحميل الصفحة — ثلاث خطوات لقرارٍ
  // واحد. صار السطر هنا: اختر ما يشتغل عليه، اكتب النسبة، أضِف — والشهر المضغوط هو نقطة البداية.
  //
  // والقائمة تجمع البابين اللذين طلبهما المالك في مكانٍ واحد: **مشروع** أو **عمل داخلي**
  // (تطوير أعمال · تطوير منتجات · إدارة مشاريع) — «مو شرط يكون على مشروع».
  function addRowHtml(e, m) {
    const st = S();
    const projs = (st.teamProjects || []).filter((p) => !e.sector_id || !p.sector_id || p.sector_id === e.sector_id);
    const buckets = st.workBuckets || [];
    if (!projs.length && !buckets.length) return '';
    const mName = M()[m - 1] || '';
    return '<div style="border-top:1px dashed var(--line);padding:.5rem 0 .3rem">' +
      '<div style="font-size:10.5px;font-weight:800;color:var(--muted);margin-bottom:.3rem">أضِف تسكيناً من ' + esc(mName) + '</div>' +
      '<div style="display:flex;gap:.35rem;align-items:center">' +
      '<select class="input" data-add-target style="flex:1;min-width:0;font-size:12px;padding:.3rem .4rem" aria-label="ما الذي يعمل عليه">' +
      (buckets.length ? '<optgroup label="عمل داخلي">' + buckets.map((b) =>
        '<option value="b:' + esc(b.key) + '">' + esc(b.label) + '</option>').join('') + '</optgroup>' : '') +
      (projs.length ? '<optgroup label="مشروع">' + projs.map((p) =>
        '<option value="p:' + esc(p.id) + '">' + esc(p.name_ar) + '</option>').join('') + '</optgroup>' : '') +
      '</select>' +
      '<input type="number" class="input tnum" data-add-pct value="50" min="0" max="150" step="5" aria-label="النسبة" style="width:66px;padding:.3rem .45rem;font-size:12.5px;direction:ltr;text-align:center">' +
      '<button type="button" class="btn btn-sm btn-primary" data-add-go>أضِف</button>' +
      '</div>' +
      '<div style="font-size:10px;color:var(--faint);padding-top:.3rem">يسري من ' + esc(mName) + ' إلى آخر السنة — عدّل أي شهر من خليته.</div>' +
      '</div>';
  }

  async function addFromPop(btn) {
    if (!popCtx) return;
    const sel = pop && pop.querySelector('[data-add-target]');
    const pctEl = pop && pop.querySelector('[data-add-pct]');
    if (!sel || !sel.value) return;
    let pct = Math.round(Number(pctEl && pctEl.value));
    if (!isFinite(pct) || pct < 0) pct = 0;
    if (pct > 150) pct = 150;
    const empId = popCtx.empId, m = popCtx.month;
    const kind = sel.value.slice(0, 1), key = sel.value.slice(2);
    btn.disabled = true;
    try {
      if (kind === 'b') {
        await api('/staffing/internal', 'POST', { employeeId: empId, bucket: key, pct: pct, fromMonth: m, year: S().staffYear });
      } else {
        await api('/projects/' + encodeURIComponent(key) + '/staff', 'POST', { employeeId: empId, pct: pct, fromMonth: m, year: S().staffYear });
      }
      toast('أُضيف التسكين ✓');
      setTimeout(function () { location.reload(); }, 450);
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  }

  function openPop(cell) {
    closePop();
    const empId = cell.dataset.emp, m = Number(cell.dataset.m);
    const e = (S().emps || {})[empId]; if (!e || !m) return;
    popCtx = { empId, month: m };
    pop = document.createElement('div');
    pop.className = 'hg-pop';
    pop.setAttribute('role', 'dialog');
    renderPop();
    document.body.appendChild(pop);
    const r = cell.getBoundingClientRect();
    const W = pop.offsetWidth || 300, H = pop.offsetHeight || 150;
    let x = r.left + window.scrollX + r.width / 2 - W / 2;
    x = Math.max(8, Math.min(x, window.scrollX + document.documentElement.clientWidth - W - 8));
    let y = r.bottom + window.scrollY + 6;
    if (r.bottom + H + 12 > window.innerHeight) y = r.top + window.scrollY - H - 6;
    pop.style.left = x + 'px'; pop.style.top = Math.max(window.scrollY + 8, y) + 'px';
    const first = pop.querySelector('input[data-pop-pct]');
    if (first) { first.focus(); first.select(); }
  }

  function stepPop(d) {
    if (!pop || !popCtx) return;
    const m = Math.min(12, Math.max(1, popCtx.month + d));
    if (m === popCtx.month) return;
    popCtx.month = m;
    renderPop();
    const b = pop.querySelector('[data-pop-step="' + d + '"]');
    if (b && !b.disabled) b.focus();
  }

  async function saveCell(inp) {
    if (!popCtx) return;
    const allocId = inp.dataset.alloc, m = popCtx.month, empId = popCtx.empId;
    const e = (S().emps || {})[empId]; if (!e) return;
    const p = (e.projects || []).find((x) => x.allocId === allocId); if (!p) return;
    const prev = Number((p.months || {})[m]) || 0;
    let v = Math.round(Number(inp.value));
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (v > 150) v = 150;
    inp.value = v;
    if (v === prev) return;
    // optimistic: repaint the row spans from state first, revert on failure
    p.months = p.months || {}; if (v > 0) p.months[m] = v; else delete p.months[m];
    repaint(empId);
    inp.disabled = true;
    try {
      await api('/projects/staff/' + allocId, 'PATCH', { month: m, pct: v });
      toast('حُفظ تسكين ' + (M()[m - 1] || '') + ' ✓');
    } catch (err) {
      if (prev > 0) p.months[m] = prev; else delete p.months[m];
      repaint(empId);
      inp.value = prev;
      toast(err.message, true);
    } finally { inp.disabled = false; }
  }

  async function removeAlloc(btn) {
    const allocId = btn.dataset.alloc, name = btn.dataset.pname || 'المشروع';
    const empId = popCtx && popCtx.empId;
    const e = empId ? (S().emps || {})[empId] : null;
    if (!window.confirm('إزالة تسكين ' + ((e && e.name_ar) || 'الموظف') + ' من «' + name + '» عن كل الأشهر؟ لا يمكن التراجع.')) return;
    try {
      await api('/projects/staff/' + allocId, 'DELETE');
      toast('أُزيل التسكين ✓');
      setTimeout(() => location.reload(), 450);
    } catch (err) { toast(err.message, true); }
  }

  function filterRows(q) {
    q = (q || '').trim().toLowerCase();
    // أثناء البحث تُفتح كل المجموعات المطوية كي تظهر النتائج، وتعود لوضعها عند المسح
    document.querySelectorAll('details.bsec').forEach((d) => {
      if (q) { if (!d.dataset.wasOpen) d.dataset.wasOpen = d.open ? '1' : '0'; d.open = true; }
      else if (d.dataset.wasOpen) { d.open = d.dataset.wasOpen === '1'; delete d.dataset.wasOpen; }
    });
    document.querySelectorAll('.brd-row[data-emp]').forEach((row) => {
      const show = !q || (row.dataset.name || '').includes(q);
      row.style.display = show ? '' : 'none';
      const det = document.querySelector('.hg-detail[data-detail="' + row.dataset.emp + '"]');
      if (det && !show) det.hidden = true;
    });
  }

  document.addEventListener('click', (ev) => {
    const dd = ev.target.closest('[data-dd]');
    if (dd && window.Sanad) { window.Sanad.openDD(dd.dataset.dd); return; }
    const popClose = ev.target.closest('[data-pop-close]');
    if (popClose) { closePop(); return; }
    const popStep = ev.target.closest('[data-pop-step]');
    if (popStep) { stepPop(Number(popStep.dataset.popStep) || 0); return; }
    const popRemove = ev.target.closest('[data-pop-remove]');
    if (popRemove) { removeAlloc(popRemove); return; }
    const addGo = ev.target.closest('[data-add-go]');
    if (addGo) { addFromPop(addGo); return; }
    const el = ev.target.closest('[data-action]');
    if (el) {
      const a = el.dataset.action;
      if (a === 'assign' && window.Sanad) { closePop(); window.Sanad.empAssign(el.dataset.emp); return; }
      if (a === 'edit-emp' && window.Sanad) { window.Sanad.empEdit(el.dataset.emp); return; }
      if (a === 'expand') {
        const det = document.querySelector('.hg-detail[data-detail="' + el.dataset.emp + '"]');
        if (det) { det.hidden = !det.hidden; el.setAttribute('aria-expanded', String(!det.hidden)); el.textContent = det.hidden ? '⌄' : '⌃'; }
        return;
      }
    }
    const cell = ev.target.closest('.hg-cell');
    if (cell) { openPop(cell); return; }
    if (pop && !pop.contains(ev.target)) closePop(); // click-outside closes the edit layer
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePop(); });
  document.addEventListener('change', (ev) => { if (ev.target.matches('input[data-pop-pct]')) saveCell(ev.target); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.matches('input[data-pop-pct]')) { ev.preventDefault(); ev.target.blur(); }
  });
  document.addEventListener('input', (ev) => { if (ev.target.id === 'staff-q') filterRows(ev.target.value); });
})();
