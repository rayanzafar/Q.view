// Team management (team page «الفريق») — add / edit / delete an employee, including hire date.
// Self-contained page module: delegated events only (no inline handlers), all data comes from the
// SSR-provided window.__SANAD (already role-redacted). Talks to /api/employees. Reuses the shared
// modal shell (Sanad.openModal/closeModal) so it matches the design system.
(function () {
  'use strict';
  const S = () => window.__SANAD || {};
  const esc = (s) => (window.Sanad ? window.Sanad.esc(s) : String(s == null ? '' : s));
  const EMP_TYPES = ['أساسي', 'متعاون', 'مؤقت', 'استشاري', 'متدرب'];

  const api = async (path, method, body) => {
    const r = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('تعذّر إتمام العملية — أعد المحاولة (' + r.status + ')'));
    return j;
  };
  const toast = (msg, bad) => {
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#dc2626' : '#059669');
    document.body.appendChild(d); setTimeout(() => d.remove(), 2800);
  };
  const openModal = (html) => { if (window.Sanad && window.Sanad.openModal) window.Sanad.openModal(html); };
  const closeModal = () => { if (window.Sanad && window.Sanad.closeModal) window.Sanad.closeModal(); };

  // ── add / edit form ──
  function formHtml(id) {
    const st = S();
    const e = id ? (st.emps || {})[id] : null;
    const locked = st.teamSectorLocked; // sector-scoped user: sector is fixed, no picker
    const typeOpts = EMP_TYPES.map((t) => '<option ' + (e && e.employment_type === t ? 'selected' : '') + '>' + t + '</option>').join('');
    const secOpts = (st.teamSectors || []).map((s) => '<option value="' + s.id + '"' + (e && e.sector_id === s.id ? ' selected' : '') + '>' + esc(s.name_ar) + '</option>').join('');
    return '<div class="modal-head"><div style="font-weight:800;font-size:15px">' + (id ? 'تعديل موظف' : 'إضافة موظف') + '</div>'
      + '<button class="btn btn-ghost btn-sm" data-action="emp-close" aria-label="إغلاق">✕</button></div>'
      + '<div class="modal-body">'
      + '<div class="field"><label>الاسم</label><input class="input" id="empf-name" value="' + (e ? esc(e.name_ar || '') : '') + '" placeholder="الاسم الكامل"></div>'
      + '<div class="grid2">'
      + '<div class="field"><label>المسمى الوظيفي</label><input class="input" id="empf-job" value="' + (e ? esc(e.job_title || '') : '') + '" placeholder="مثال: مستشار أول"></div>'
      + '<div class="field"><label>نوع التوظيف</label><select id="empf-type">' + typeOpts + '</select></div>'
      + '</div>'
      + '<div class="grid2">'
      + (locked ? '' : '<div class="field"><label>القطاع</label><select id="empf-sector"><option value="">— بدون قطاع —</option>' + secOpts + '</select></div>')
      + '<div class="field"><label>تاريخ التعيين</label><input class="input" id="empf-hire" type="date" value="' + (e && e.hire_date ? esc(e.hire_date) : '') + '"></div>'
      + '</div>'
      + '<div class="grid2">'
      + '<div class="field"><label>الحالة</label><select id="empf-active"><option value="1"' + (!e || e.active !== 0 ? ' selected' : '') + '>نشط</option><option value="0"' + (e && e.active === 0 ? ' selected' : '') + '>غير نشط</option></select></div>'
      + (st.canSalary ? '<div class="field"><label>الراتب الشهري (ريال)</label><input class="input" id="empf-salary" type="number" min="0" step="100" value="' + (e ? (e.salary_sar || 0) : 0) + '"></div>' : '')
      + '</div>'
      + '</div>'
      + '<div class="modal-foot"><button class="btn" data-action="emp-close">إلغاء</button>'
      + '<button class="btn btn-primary" data-action="emp-save" data-id="' + (id || '') + '">' + (id ? 'حفظ التعديلات' : 'إضافة الموظف') + '</button></div>';
  }

  function openForm(id) {
    openModal(formHtml(id));
    const first = document.getElementById('empf-name');
    if (first) { first.focus(); first.select(); }
  }

  async function save(id) {
    const val = (n) => { const el = document.getElementById('empf-' + n); return el ? el.value : undefined; };
    const name = (val('name') || '').trim();
    if (!name) { toast('اسم الموظف مطلوب', true); const el = document.getElementById('empf-name'); if (el) el.focus(); return; }
    const body = { name_ar: name, job_title: (val('job') || '').trim(), employment_type: val('type'), hire_date: val('hire') || '' };
    const act = val('active'); if (act !== undefined) body.active = Number(act);
    const sec = val('sector');
    if (sec !== undefined) body.sector_id = sec || null;
    else if (!id && S().teamSectorLocked) body.sector_id = S().teamSectorLocked; // create under the locked sector
    const sal = val('salary'); if (sal !== undefined) body.salary_sar = Number(sal) || 0;
    const btn = document.querySelector('[data-action="emp-save"]'); if (btn) btn.disabled = true;
    try {
      if (id) await api('/employees/' + encodeURIComponent(id), 'PATCH', body);
      else await api('/employees', 'POST', body);
      toast(id ? 'حُدّثت بيانات الموظف ✓' : 'أُضيف الموظف ✓');
      closeModal();
      setTimeout(() => location.reload(), 550);
    } catch (err) {
      if (btn) btn.disabled = false;
      toast(err.message, true);
    }
  }

  async function del(id) {
    const e = (S().emps || {})[id];
    const name = (e && e.name_ar) || 'هذا الموظف';
    if (!window.confirm('حذف ' + name + ' من الفريق؟\nسيختفي من قوائم التسكين وتبقى سجلاته محفوظة. يمكن للموارد البشرية استرجاعه لاحقاً.')) return;
    try {
      await api('/employees/' + encodeURIComponent(id), 'DELETE');
      toast('حُذف الموظف ✓');
      setTimeout(() => location.reload(), 550);
    } catch (err) { toast(err.message, true); }
  }

  // ── delegated actions (this module owns emp-* only; staffing.js keeps assign/expand) ──
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'emp-add') { ev.preventDefault(); openForm(null); }
    else if (a === 'emp-edit') { ev.preventDefault(); openForm(el.dataset.emp); }
    else if (a === 'emp-delete') { ev.preventDefault(); del(el.dataset.emp); }
    else if (a === 'emp-save') { ev.preventDefault(); save(el.dataset.id || ''); }
    else if (a === 'emp-close') { ev.preventDefault(); closeModal(); }
  });
  // Enter inside a form field saves; Escape closes the open modal.
  document.addEventListener('keydown', (ev) => {
    const m = document.getElementById('modal');
    if (!m || !m.classList.contains('on')) return;
    if (ev.key === 'Escape') { closeModal(); return; }
    if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('#modal input')) {
      const btn = document.querySelector('[data-action="emp-save"]');
      if (btn) { ev.preventDefault(); save(btn.dataset.id || ''); }
    }
  });

  // بحث حي في جدول الفريق — يُطابق الاسم أو المسمى الوظيفي (data-hay على كل صف)
  function filterTeamRows() {
    const q = document.getElementById('team-q'); if (!q) return;
    const v = q.value.trim().toLowerCase();
    document.querySelectorAll('#team-rows tbody tr[data-hay]').forEach((tr) => {
      tr.style.display = (!v || tr.dataset.hay.indexOf(v) !== -1) ? '' : 'none';
    });
  }
  document.addEventListener('input', (ev) => { if (ev.target && ev.target.id === 'team-q') filterTeamRows(); });

  // القفز إلى موظف واحد (وارد من لوحة الأوامر Ctrl/Cmd+K أو من صفحة التسكين): يمرّر إلى صفه ويومض إشارةً.
  (function jumpToHighlight() {
    const empId = new URLSearchParams(location.search).get('highlight');
    if (!empId) return;
    const row = document.querySelector('#team-rows tr[data-emp="' + CSS.escape(empId) + '"]');
    if (!row) return;
    setTimeout(() => {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('hl-flash');
      setTimeout(() => row.classList.remove('hl-flash'), 1700);
    }, 60);
  })();
})();
