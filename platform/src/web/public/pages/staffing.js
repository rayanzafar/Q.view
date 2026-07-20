// Capacity workspace (team page v3) — heat-grid cell editing, quarter zoom, search, expand rows.
// Delegated events only; SSR provides all data via window.__SANAD (already role-redacted).
(function () {
  'use strict';
  const S = () => window.__SANAD || {};
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

  const cellBg = (v) => v === 0 ? '#eef1f7' : v > 105 ? '#dc2626' : v >= 80 ? '#059669' : v >= 40 ? '#f59e0b' : '#bfdbfe';
  const cellFg = (v) => v === 0 ? '#94a3b8' : v > 105 || v >= 80 ? '#fff' : v >= 40 ? '#7c2d12' : '#1e40af';
  const nowTone = (u) => u > 105 ? 'var(--red)' : u >= 80 ? 'var(--green)' : u >= 40 ? 'var(--amber)' : u > 0 ? 'var(--blue)' : 'var(--faint)';

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
  function paintCell(empId, m) {
    const v = cellTotal(empId, m);
    const cell = document.querySelector('.hg-cell[data-emp="' + empId + '"][data-m="' + m + '"]');
    if (!cell) return;
    cell.dataset.v = v;
    cell.style.background = cellBg(v);
    cell.style.color = cellFg(v);
    cell.innerHTML = (v > 0 ? v : '') + (v > 105 ? '<span class="w" aria-hidden="true">⚠</span>' : '');
    if (m === S().currentMonth) {
      const e = (S().emps || {})[empId]; if (e) e.currentUtil = v;
      const row = document.querySelector('.hg-row[data-emp="' + empId + '"] .hg-now');
      if (row) { row.textContent = v + '%'; row.style.color = nowTone(v); }
    }
    const totalEl = pop && pop.querySelector('[data-pop-total]');
    if (totalEl) { totalEl.textContent = v + '%'; totalEl.style.color = v > 105 ? 'var(--red)' : 'var(--ink2)'; }
  }

  function openPop(cell) {
    closePop();
    const empId = cell.dataset.emp, m = Number(cell.dataset.m);
    const st = S(); const e = (st.emps || {})[empId]; if (!e) return;
    const mName = (st.monthNames || [])[m - 1] || ('شهر ' + m);
    const canStaff = !!st.canStaff;
    popCtx = { empId, month: m };
    const rows = (e.projects || []).map((p) => {
      const v = Number((p.months || {})[m]) || 0;
      return '<div style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px dashed var(--line)">' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px">' + esc(p.name) + '</span>' +
        (canStaff
          ? '<input type="number" class="input tnum" data-pop-pct data-alloc="' + p.allocId + '" value="' + v + '" min="0" max="150" step="5" aria-label="نسبة ' + esc(p.name) + ' في ' + esc(mName) + '" style="width:74px;padding:.3rem .45rem;font-size:12.5px;direction:ltr;text-align:center">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-pop-remove data-alloc="' + p.allocId + '" data-pname="' + esc(p.name) + '" title="إزالة التسكين بالكامل">✕</button>'
          : '<b class="tnum" style="font-size:12.5px">' + v + '%</b>') +
        '</div>';
    }).join('');
    const opps = m === st.currentMonth ? (e.opps || []).map((o) =>
      '<div style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px dashed var(--line);color:var(--muted)">' +
      '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">' + esc(o.name) + ' <span class="pill" style="background:#ede9fe;color:#7c3aed">فرصة</span></span>' +
      '<b class="tnum" style="font-size:12px">' + (Number(o.pct) || 0) + '%</b></div>').join('') : '';
    const empty = !(e.projects || []).length && !opps;
    pop = document.createElement('div');
    pop.className = 'hg-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'تعديل تسكين ' + e.name_ar + ' — ' + mName);
    pop.innerHTML =
      '<div style="padding:.6rem .8rem;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.5rem">' +
      '<b style="font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.name_ar) + ' — ' + esc(mName) + '</b>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-pop-close aria-label="إغلاق">✕</button></div>' +
      '<div style="padding:.5rem .8rem">' +
      (empty
        ? '<div style="color:var(--muted);font-size:12.5px;padding:.4rem 0">لا تسكين لهذا الموظف في ' + esc(mName) + (canStaff ? ' — أضِف تسكينًا من الزر أدناه' : '') + '.</div>'
        : rows + opps +
          '<div style="display:flex;justify-content:space-between;padding:.45rem 0 .15rem;font-size:12px;color:var(--muted)"><span>إجمالي الشهر</span><b class="tnum" data-pop-total style="color:' + (cellTotal(empId, m) > 105 ? 'var(--red)' : 'var(--ink2)') + '">' + cellTotal(empId, m) + '%</b></div>') +
      (canStaff && st.canManage ? '<div style="padding:.35rem 0 .5rem"><button type="button" class="btn btn-sm" data-action="assign" data-emp="' + empId + '">＋ تسكين على مشروع</button></div>' : '') +
      (canStaff && !empty ? '<div style="font-size:10px;color:var(--faint);padding-bottom:.45rem">اكتب النسبة ثم اخرج من الحقل — يُحفظ فورًا. Esc للإغلاق.</div>' : '') +
      '</div>';
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
    // optimistic: paint first, revert on failure
    p.months = p.months || {}; if (v > 0) p.months[m] = v; else delete p.months[m];
    e.months && (e.months[m - 1] = cellTotal(empId, m));
    paintCell(empId, m);
    inp.disabled = true;
    try {
      await api('/projects/staff/' + allocId, 'PATCH', { month: m, pct: v });
      toast('حُفظ تسكين ' + ((S().monthNames || [])[m - 1] || '') + ' ✓');
    } catch (err) {
      if (prev > 0) p.months[m] = prev; else delete p.months[m];
      e.months && (e.months[m - 1] = cellTotal(empId, m));
      paintCell(empId, m);
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

  function setZoom(q) {
    const hg = document.getElementById('hg'); if (!hg) return;
    hg.dataset.zoom = q;
    const inQ = (m) => q === 0 || (m > (q - 1) * 3 && m <= q * 3);
    hg.querySelectorAll('.hg-cell, .hg-mh').forEach((el) => { el.style.display = inQ(Number(el.dataset.m)) ? '' : 'none'; });
    document.querySelectorAll('[data-action="zoom"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.q) === q));
  }

  function filterRows(q) {
    q = (q || '').trim().toLowerCase();
    document.querySelectorAll('.hg-row[data-emp]').forEach((row) => {
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
    const popRemove = ev.target.closest('[data-pop-remove]');
    if (popRemove) { removeAlloc(popRemove); return; }
    const el = ev.target.closest('[data-action]');
    if (el) {
      const a = el.dataset.action;
      if (a === 'assign' && window.Sanad) { closePop(); window.Sanad.empAssign(el.dataset.emp); return; }
      if (a === 'edit-emp' && window.Sanad) { window.Sanad.empEdit(el.dataset.emp); return; }
      if (a === 'zoom') { setZoom(Number(el.dataset.q) || 0); return; }
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
