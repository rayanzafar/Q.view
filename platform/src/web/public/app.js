// Minimal client layer — progressive enhancement over SSR pages. Calls the JSON API.
const api = async (path, method = 'GET', body) => {
  const r = await fetch('/api' + path, {
    method, credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || ('خطأ ' + r.status));
  return j;
};
const toast = (msg, bad) => {
  const d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = `position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);background:${bad ? '#dc2626' : '#059669'}`;
  document.body.appendChild(d); setTimeout(() => d.remove(), 2600);
};

window.Sanad = {
  async quickTask() {
    const title = document.getElementById('qa-title').value.trim();
    if (!title) return toast('أدخل عنوان المهمة', true);
    try {
      await api('/tasks/quick', 'POST', {
        title, priority: document.getElementById('qa-priority').value,
        due_date: document.getElementById('qa-due').value || null,
      });
      toast('أُضيفت المهمة ✓'); location.reload();
    } catch (e) { toast(e.message, true); }
  },
  async setTaskStatus(id, status) {
    try { await api('/tasks/' + id, 'PATCH', { status }); toast('حُدّثت الحالة ✓'); }
    catch (e) { toast(e.message, true); }
  },
  async addTime() {
    const hours = parseFloat(document.getElementById('ts-hours').value);
    if (!(hours > 0)) return toast('أدخل ساعات صحيحة', true);
    try {
      await api('/timesheets', 'POST', {
        entry_date: document.getElementById('ts-date').value, hours,
        work_kind: document.getElementById('ts-kind').value, note: document.getElementById('ts-note').value,
      });
      toast('سُجّل الوقت ✓'); location.reload();
    } catch (e) { toast(e.message, true); }
  },
  quickOpp() { this.oppAdd(); }, // route the legacy quick-add to the proper modal (no browser prompts)
  async approve(id, action) {
    let comment = ''; if (action === 'reject') comment = prompt('سبب الرفض؟') || '';
    try { await api('/approvals/' + id + '/act', 'POST', { action, comment }); toast(action === 'approve' ? 'اعتُمد ✓' : 'رُفض'); location.reload(); }
    catch (e) { toast(e.message, true); }
  },
  previewReport(key) {
    const el = document.getElementById('report-preview');
    el.innerHTML = `<div class="bg-white border border-line rounded-xl overflow-hidden"><iframe src="/app/reports/preview/${key}" style="width:100%;height:620px;border:0"></iframe></div>`;
  },
  async testSend(key) {
    try { const r = await fetch('/app/reports/test-send/' + key, { method: 'POST', credentials: 'include' }).then((x) => x.json()); toast('أُدرج في طابور المعاينة ✓ (' + r.queued + ')'); }
    catch (e) { toast(e.message, true); }
  },
};

// مساعد سند انتقل بكامله إلى public/pages/ai.js — كان يركّب ردّ الخادم كوسوم (innerHTML)
// فيصير اسمُ مشروعٍ خبيثٌ تنفيذاً في متصفح كل من يسأل عنه. الواجهة الجديدة تبني نصاً لا وسوماً.
Object.assign(window.Sanad, {
  async addSector() {
    const id = document.getElementById('sec-id').value.trim();
    const name_ar = document.getElementById('sec-ar').value.trim();
    if (!id || !name_ar) return toast('المعرّف والاسم مطلوبان', true);
    try { await api('/org/sectors', 'POST', { id: id.toUpperCase(), name_ar, target_sales_sar: Number(document.getElementById('sec-tgt').value) || 0 }); toast('أُضيف القطاع ✓'); location.reload(); }
    catch (e) { toast(e.message, true); }
  },
  async addDept(sectorId) {
    const el = document.getElementById('dep-' + sectorId); const name_ar = el.value.trim();
    if (!name_ar) return toast('اسم الإدارة مطلوب', true);
    try { await api('/org/departments', 'POST', { sector_id: sectorId, name_ar }); toast('أُضيفت الإدارة ✓'); location.reload(); }
    catch (e) { toast(e.message, true); }
  },
  async progressClaim(contractId) {
    const period = prompt('فترة المستخلص (مثال: يونيو 2026)؟', '');
    if (period === null) return;
    try { const r = await api('/finance/progress-claim', 'POST', { contractId, periodLabel: period }); toast('صدر المستخلص ✓ بقيمة ' + Math.round((r.amount_halalas || 0) / 100).toLocaleString() + ' ر.س.'); location.reload(); }
    catch (e) { toast(e.message, true); }
  },
  async recordCollection(invoiceId, maxSar) {
    const amt = prompt('مبلغ التحصيل (ر.س.)؟', String(maxSar || ''));
    if (amt === null) return;
    try { await api('/finance/collections', 'POST', { invoiceId, amountSar: Number(amt) }); toast('سُجّل التحصيل ✓'); location.reload(); }
    catch (e) { toast(e.message, true); }
  },
  async addSchedule() {
    const body = {
      reportId: document.getElementById('sch-report').value,
      frequency: document.getElementById('sch-freq').value,
      recipientGroupId: document.getElementById('sch-group').value || null,
      sendTime: document.getElementById('sch-time').value,
    };
    try {
      const r = await fetch('/app/reports/schedule', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
      if (r.error) throw new Error(r.error.message);
      toast('تمت الجدولة ✓'); location.reload();
    } catch (e) { toast(e.message, true); }
  },
});

// ── Drawer + Modal infrastructure + PMO Kanban (v2 redesign) ──
Object.assign(window.Sanad, {
  esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },
  LBL: { IN_PROGRESS: 'قيد التنفيذ', COMPLETED: 'مكتمل', PLANNED: 'مُخطَّط', ON_HOLD: 'متوقّف مؤقتًا', CANCELLED: 'ملغى', NOT_STARTED: 'لم يبدأ', GREEN: 'أخضر', AMBER: 'أصفر', RED: 'أحمر', P0: 'حرجة', P1: 'عالية', P2: 'متوسطة', P3: 'منخفضة' },
  lbl(v) { return this.LBL[v] || v || ''; },
  fmtSar(h) { try { return new Intl.NumberFormat('ar-SA-u-nu-latn', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format((h || 0) / 100); } catch (e) { return Math.round((h || 0) / 100).toLocaleString() + ' ر.س.'; } },
  openDrawer(html) { const d = document.getElementById('drawer'); d.innerHTML = html; d.classList.add('on'); d.setAttribute('aria-hidden', 'false'); document.getElementById('scrim').classList.add('on'); },
  closeDrawer() { const d = document.getElementById('drawer'); d.classList.remove('on'); d.setAttribute('aria-hidden', 'true'); document.getElementById('scrim').classList.remove('on'); },
  openModal(html) { const m = document.getElementById('modal'); m.innerHTML = '<div class="modal-card">' + html + '</div>'; m.classList.add('on'); },
  // Drill-down popup: shows the pre-rendered <template id="dd-KEY"> embedded by the page (SSR data,
  // same scope/redaction as the page itself — nothing is fetched client-side).
  openDD(k) { const t = document.getElementById('dd-' + k); if (t) this.openModal(t.innerHTML); },

  // ── Team & staffing management (admin / sector manager) ──
  empForm(id) {
    const S = window.__SANAD || {}; const e = id ? (S.emps || {})[id] : null; const locked = S.teamSectorLocked;
    const types = ['أساسي', 'متعاون', 'مؤقت', 'استشاري', 'متدرب'];
    const secOpts = (S.teamSectors || []).map((s) => `<option value="${s.id}" ${e && e.sector_id === s.id ? 'selected' : ''}>${this.esc(s.name_ar)}</option>`).join('');
    return `<div class="modal-head"><div style="font-weight:800;font-size:15px">${id ? 'تعديل موظف' : 'إضافة موظف'}</div><button class="btn btn-ghost btn-sm" onclick="Sanad.closeModal()">✕</button></div>
      <div class="modal-body">
        <div class="field"><label>الاسم</label><input class="input" id="emp-name" value="${e ? this.esc(e.name_ar || '') : ''}" placeholder="الاسم الكامل"></div>
        <div class="grid2">
          <div class="field"><label>المسمى الوظيفي</label><input class="input" id="emp-job" value="${e ? this.esc(e.job_title || '') : ''}"></div>
          <div class="field"><label>نوع التوظيف</label><select id="emp-type">${types.map((t) => `<option ${e && e.employment_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>
        <div class="grid2">
          ${!locked ? `<div class="field"><label>القطاع</label><select id="emp-sector">${secOpts}</select></div>` : ''}
          <div class="field"><label>الحالة</label><select id="emp-active"><option value="1" ${!e || e.active !== 0 ? 'selected' : ''}>نشط</option><option value="0" ${e && e.active === 0 ? 'selected' : ''}>غير نشط</option></select></div>
        </div>
        ${S.canSalary ? `<div class="field"><label>الراتب الشهري (ر.س.)</label><input class="input" id="emp-salary" type="number" min="0" value="${e ? (e.salary_sar || 0) : 0}"></div>` : ''}
      </div>
      <div class="modal-foot"><button class="btn" onclick="Sanad.closeModal()">إلغاء</button>
        <button class="btn btn-primary" onclick="Sanad.empSave('${id || ''}')">${id ? 'حفظ التعديلات' : 'إضافة الموظف'}</button></div>`;
  },
  empAdd() { this.openModal(this.empForm(null)); },
  empEdit(id) { this.openModal(this.empForm(id)); },
  async empSave(id) {
    const g = (n) => { const el = document.getElementById('emp-' + n); return el ? el.value : undefined; };
    const body = { name_ar: g('name'), job_title: g('job'), employment_type: g('type') };
    const act = g('active'); if (act !== undefined) body.active = Number(act);
    const sec = g('sector'); if (sec !== undefined) body.sector_id = sec;
    const sal = g('salary'); if (sal !== undefined) body.salary_sar = Number(sal) || 0;
    if (!body.name_ar) return toast('اسم الموظف مطلوب', true);
    try {
      if (id) await api('/org/employees/' + id, 'PATCH', body);
      else { if (!body.sector_id && (window.__SANAD || {}).teamSectorLocked) body.sector_id = window.__SANAD.teamSectorLocked; await api('/org/employees', 'POST', body); }
      toast(id ? 'حُدّث الموظف ✓' : 'أُضيف الموظف ✓'); this.closeModal(); setTimeout(() => location.reload(), 500);
    } catch (err) { toast(err.message, true); }
  },
  empAssign(id) {
    const S = window.__SANAD || {}; const e = (S.emps || {})[id]; if (!e) return;
    const projs = (S.teamProjects || []).filter((p) => !e.sector_id || p.sector_id === e.sector_id);
    const M = window.__SANAD_MONTHS || ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const cur = (new Date().getMonth() + 1);
    const mopt = (sel) => M.map((m, i) => `<option value="${i + 1}" ${i + 1 === sel ? 'selected' : ''}>${m}</option>`).join('');
    const already = (e.projects || []).map((p) => `<span class="pill" style="background:#eef1f7;color:#475569">${this.esc(p.name)}</span>`).join(' ');
    this.openModal(`<div class="modal-head"><div style="font-weight:800;font-size:15px">تسكين ${this.esc(e.name_ar)} على مشروع</div><button class="btn btn-ghost btn-sm" onclick="Sanad.closeModal()">✕</button></div>
      <div class="modal-body">
        ${already ? `<div style="font-size:11px;color:var(--muted)">مُسكَّن حاليًا: ${already}</div>` : ''}
        ${projs.length ? `<div class="field"><label>المشروع</label><select id="al-proj">${projs.map((p) => `<option value="${p.id}">${this.esc(p.name_ar)}</option>`).join('')}</select></div>
          <div class="grid2"><div class="field"><label>نسبة التسكين %</label><input class="input" id="al-pct" type="number" value="100" min="0" max="150"></div>
            <div class="field"><label>الدور</label><select id="al-type"><option value="member">عضو فريق</option><option value="lead">قائد</option><option value="advisor">مستشار</option></select></div></div>
          <div class="grid2"><div class="field"><label>من شهر</label><select id="al-from">${mopt(cur)}</select></div>
            <div class="field"><label>إلى شهر</label><select id="al-to">${mopt(12)}</select></div></div>`
        : '<div style="color:var(--muted);font-size:13px">لا مشاريع قائمة في قطاع هذا الموظف للتسكين عليها الآن.</div>'}
      </div>
      <div class="modal-foot"><button class="btn" onclick="Sanad.closeModal()">إلغاء</button>
        ${projs.length ? `<button class="btn btn-primary" onclick="Sanad.empAssignSave('${id}')">تسكين</button>` : ''}</div>`);
  },
  async empAssignSave(id) {
    const pid = document.getElementById('al-proj') && document.getElementById('al-proj').value; if (!pid) return;
    const body = { employeeId: id, pct: Number(document.getElementById('al-pct').value) || 100,
      type: document.getElementById('al-type').value, fromMonth: Number(document.getElementById('al-from').value) || 1, toMonth: Number(document.getElementById('al-to').value) || 12 };
    try { await api('/projects/' + pid + '/staff', 'POST', body); toast('تم التسكين ✓'); this.closeModal(); setTimeout(() => location.reload(), 500); }
    catch (err) { toast(err.message, true); }
  },
  closeModal() { const m = document.getElementById('modal'); m.classList.remove('on'); m.innerHTML = ''; },

  pmoView(ns, mode) {
    const k = document.getElementById(ns + '-kanban'); const t = document.getElementById(ns + '-table');
    if (k) k.style.display = mode === 'kanban' ? '' : 'none';
    if (t) t.style.display = mode === 'table' ? '' : 'none';
    document.querySelectorAll('.seg [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === mode));
  },
  _recount(ns) {
    document.querySelectorAll('#' + ns + '-kanban .kcol').forEach((col) => {
      const cards = [...col.querySelectorAll('.kcard')].filter((c) => c.style.display !== 'none');
      const cnt = col.querySelector('[data-count]'); if (cnt) cnt.textContent = cards.length;
    });
  },
  oppFilter() {
    const q = (document.getElementById('opp-q').value || '').toLowerCase().trim();
    const sec = document.getElementById('opp-sector').value;
    document.querySelectorAll('#opp-kanban .kcard, #opp-table tbody tr').forEach((c) => {
      const hay = c.dataset.hay || c.textContent.toLowerCase();
      const ok = (!q || hay.includes(q)) && (!sec || (c.dataset.sector || '') === sec || !c.dataset.sector);
      c.style.display = ok ? '' : 'none';
    });
    this._recount('opp');
  },
  // drag-drop
  kStart(e) { this._drag = e.currentTarget; this._dragFrom = e.currentTarget.closest('.kcol')?.dataset.stage; e.currentTarget.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', e.currentTarget.dataset.id); } catch (x) {} },
  kEnd(e) { e.currentTarget.classList.remove('drag'); document.querySelectorAll('.kcol.drop').forEach((c) => c.classList.remove('drop')); },
  kOver(e) { e.preventDefault(); e.currentTarget.classList.add('drop'); },
  kLeave(e) { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drop'); },
  async kDrop(e) {
    e.preventDefault(); const col = e.currentTarget; col.classList.remove('drop');
    const card = this._drag; if (!card) return;
    const stage = col.dataset.stage; const id = card.dataset.id;
    if (stage === this._dragFrom) return;
    const board = col.closest('.kanban'); const kind = (board && board.dataset.kind) || 'opp';
    const ns = board ? board.id.replace('-kanban', '') : 'opp';
    // أعمدة الملخص (فائزة/خاسرة المضغوطة) لا تعرض بطاقات — لا نُسقط البطاقة داخلها بصرياً،
    // بل نحفظ النقل ثم نعيد التحميل ليظهر ضمن أرقام الملخص مباشرة
    const summary = col.dataset.summary != null;
    if (!summary) {
      const body = col.querySelector('.kcol-body');
      body.querySelectorAll(':scope > div:not(.kcard)').forEach((ph) => ph.remove()); // drop the "—" placeholder
      body.appendChild(card);
      this._recount(ns);
    } else { card.style.opacity = '.35'; }
    try {
      if (kind === 'prj') await api('/projects/' + id, 'PATCH', { status: stage });
      else await api('/opportunities/' + id + '/stage', 'POST', { stage });
      toast('نُقل إلى ' + (col.querySelector('.t')?.textContent || '') + ' ✓');
      if (summary) location.reload();
    } catch (err) { toast(err.message, true); location.reload(); }
  },
  // detail drawer
  async oppOpen(id) {
    try {
      const d = await api('/opportunities/' + id + '/detail');
      const o = d.opp; const stages = d.stages || []; const ce = d.canEdit;
      const stageOpts = stages.map((s) => `<option value="${s.id}" ${s.id === o.stage_id ? 'selected' : ''}>${this.esc(s.name_ar)}</option>`).join('');
      const nm = (sid) => (stages.find((s) => s.id === sid) || {}).name_ar || sid || '—';
      const hist = (d.history || []).map((h) => `<div style="display:flex;gap:.5rem;font-size:12px;padding:.35rem 0;border-bottom:1px dashed var(--line)">
        <span style="color:var(--muted)" class="tnum">${(h.changed_at || '').slice(0, 10)}</span>
        <span>${this.esc(nm(h.from_stage_id))} ← ${this.esc(nm(h.to_stage_id))}</span>
        <span style="margin-inline-start:auto;color:var(--faint)">${this.esc(h.owner_name || h.username || '')}</span></div>`).join('') || '<div style="color:var(--faint);font-size:12px">لا يوجد سجل مراحل بعد</div>';
      this.openDrawer(`
        <div class="drawer-head">
          <div style="flex:1"><div style="font-size:11px;color:var(--muted);font-weight:700">فرصة · ${this.esc(o.code || o.id)}</div>
            <h3 style="font-size:17px;margin-top:.25rem">${this.esc(o.title_ar)}</h3></div>
          <button class="btn btn-ghost" onclick="Sanad.closeDrawer()">✕</button></div>
        <div class="drawer-body">
          <label style="font-size:11px;font-weight:800;color:var(--muted)">المرحلة</label>
          <select id="dw-stage" class="input" style="width:100%;margin:.3rem 0 1rem" ${ce ? '' : 'disabled'} onchange="Sanad.oppStage('${o.id}',this.value)">${stageOpts}</select>
          <div class="kv-row"><span class="k">العميل</span><span class="v">${this.esc(d.client || '—')}</span></div>
          <div class="kv-row"><span class="k">المسؤول</span><span class="v">${this.esc(d.owner || '—')}</span></div>
          <div class="kv-row"><span class="k">القيمة المتوقعة</span><span class="v tnum ${ce ? 'editable' : ''}" ${ce ? `title="انقر للتعديل" onclick="Sanad.oppEditVal('${o.id}',${(o.value_halalas || 0) / 100},this)"` : ''}>${this.fmtSar(o.value_halalas)}</span></div>
          <div class="kv-row"><span class="k">الاحتمالية</span><span class="v tnum">${Math.round(o.win_pct || 0)}%</span></div>
          <div class="kv-row"><span class="k">الأولوية</span><span class="v">${this.esc(this.lbl(o.priority) || '—')}</span></div>
          <div class="kv-row"><span class="k">السنة</span><span class="v tnum">${o.year || '—'}</span></div>
          <div style="margin-top:1.1rem"><div style="font-size:12px;font-weight:800;color:var(--muted);margin-bottom:.35rem">الإجراء التالي</div>
            <div ${ce ? `class="editable" contenteditable="true" data-ph="1" onblur="Sanad.oppSave('${o.id}','next_action',this)"` : ''} style="font-size:13px;min-height:1.4em">${this.esc(o.next_action || (ce ? '' : '—'))}</div></div>
          <div style="margin-top:1rem"><div style="font-size:12px;font-weight:800;color:var(--muted);margin-bottom:.35rem">ملاحظات</div>
            <div ${ce ? `class="editable" contenteditable="true" onblur="Sanad.oppSave('${o.id}','notes',this)"` : ''} style="font-size:13px;white-space:pre-wrap;min-height:1.4em">${this.esc(o.notes || (ce ? '' : '—'))}</div></div>
          <div style="margin-top:1.2rem"><div style="font-size:12px;font-weight:800;color:var(--muted);margin-bottom:.45rem">سجل المراحل</div>${hist}</div>
        </div>
        <div class="drawer-foot"><button class="btn" onclick="Sanad.closeDrawer()">إغلاق</button></div>`);
    } catch (e) { toast(e.message, true); }
  },
  oppStage(id, stage) { api('/opportunities/' + id + '/stage', 'POST', { stage }).then(() => { toast('نُقلت المرحلة ✓'); setTimeout(() => location.reload(), 500); }).catch((e) => toast(e.message, true)); },
  oppSave(id, field, el) { const v = el.textContent.trim(); api('/opportunities/' + id, 'PATCH', { [field]: v }).then(() => toast('حُفظ ✓')).catch((e) => toast(e.message, true)); },
  // Inline edit: turn the value cell into a number input right where it sits (no browser prompt).
  oppEditVal(id, cur, el) {
    if (!el || el._editing) return;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.value = cur; inp.min = '0'; inp.setAttribute('aria-label', 'القيمة المتوقعة');
    inp.style.cssText = 'width:160px;padding:.25rem .5rem;font-size:13px;border:1px solid var(--brand);border-radius:8px;font-family:inherit;direction:ltr;text-align:right;box-shadow:0 0 0 3px rgba(37,99,235,.12)';
    el.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const commit = async (save) => {
      if (done) return; done = true;
      if (save) { try { await api('/opportunities/' + id, 'PATCH', { value_sar: Number(inp.value) || 0 }); toast('حُفظ ✓'); } catch (e) { toast(e.message, true); } }
      this.oppOpen(id); // refresh the drawer either way
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(true); } else if (e.key === 'Escape') { e.preventDefault(); commit(false); } });
    inp.addEventListener('blur', () => commit(true));
  },
  // add modal
  oppAdd() {
    const S = window.__SANAD || {}; const stages = S.stages || []; const secs = S.sectors || [];
    this.openModal(`
      <div class="modal-head"><h3 style="font-size:16px">فرصة جديدة</h3><button class="btn btn-ghost" onclick="Sanad.closeModal()">✕</button></div>
      <div class="modal-body">
        <div class="field"><label>عنوان الفرصة *</label><input class="input" id="no-title" placeholder="مثال: تطوير استراتيجية التحول الرقمي"></div>
        <div class="grid2">
          <div class="field"><label>القيمة المتوقعة (ر.س.)</label><input class="input" id="no-val" type="number" value="0"></div>
          <div class="field"><label>القطاع</label><select id="no-sector">${secs.map((s) => `<option value="${s.id}">${this.esc(s.name_ar)}</option>`).join('')}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label>المرحلة</label><select id="no-stage">${stages.map((s) => `<option value="${s.id}">${this.esc(s.name_ar)}</option>`).join('')}</select></div>
          <div class="field"><label>الأولوية</label><select id="no-pri"><option value="">—</option><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></div>
        </div>
        <div class="field"><label>الإجراء التالي</label><input class="input" id="no-next" placeholder="اختياري"></div>
      </div>
      <div class="modal-foot"><button class="btn btn-primary" onclick="Sanad.oppCreate()">${'إضافة الفرصة'}</button><button class="btn" onclick="Sanad.closeModal()">إلغاء</button></div>`);
    setTimeout(() => document.getElementById('no-title')?.focus(), 50);
  },
  async oppCreate() {
    const title = document.getElementById('no-title').value.trim(); if (!title) return toast('العنوان مطلوب', true);
    try {
      await api('/opportunities', 'POST', { title_ar: title, value_sar: Number(document.getElementById('no-val').value) || 0,
        sector_id: document.getElementById('no-sector').value, stage_id: document.getElementById('no-stage').value,
        priority: document.getElementById('no-pri').value || null, next_action: document.getElementById('no-next').value || null });
      toast('أُضيفت الفرصة ✓'); this.closeModal(); setTimeout(() => location.reload(), 500);
    } catch (e) { toast(e.message, true); }
  },
  // ── Projects: filter + detail drawer with staffing + add ──
  prjFilter() {
    const q = (document.getElementById('prj-q').value || '').toLowerCase().trim();
    document.querySelectorAll('#prj-kanban .kcard, #prj-table tbody tr').forEach((c) => {
      const hay = c.dataset.hay || c.textContent.toLowerCase();
      c.style.display = (!q || hay.includes(q)) ? '' : 'none';
    });
    this._recount('prj');
  },
  async projOpen(id) {
    try {
      const [p, staff] = await Promise.all([api('/projects/' + id), api('/projects/' + id + '/staffing')]);
      const ragHex = { GREEN: '#059669', AMBER: '#d97706', RED: '#dc2626' };
      const money = (h) => (h == null ? '—' : this.fmtSar(h));
      const assigned = (staff.assigned || []).map((a) => `<div style="display:flex;align-items:center;gap:.5rem;padding:.45rem 0;border-bottom:1px dashed var(--line)">
        <span class="kav" style="width:28px;height:28px;font-size:11px">${this.esc((a.person_name_ar || '?').trim().charAt(0))}</span>
        <div style="flex:1"><div style="font-size:13px;font-weight:600">${this.esc(a.person_name_ar || '—')}</div>
          <div style="font-size:11px;color:var(--muted)">${this.esc(a.job_title || a.type || 'عضو فريق')}</div></div>
        ${staff.canStaff ? `<button class="btn btn-ghost btn-sm" onclick="Sanad.staffRemove('${id}','${a.id}')" title="إزالة التسكين">✕</button>` : ''}</div>`).join('')
        || '<div style="color:var(--faint);font-size:12px;padding:.5rem 0">لا يوجد فريق مُسكَّن بعد</div>';
      const addBox = staff.canStaff && (staff.available || []).length ? `
        <div style="display:flex;gap:.5rem;margin-top:.7rem">
          <select id="staff-emp" class="input" style="flex:1">${staff.available.map((e) => `<option value="${e.id}">${this.esc(e.name_ar)}${e.job_title ? ' · ' + this.esc(e.job_title) : ''}</option>`).join('')}</select>
          <button class="btn btn-primary" onclick="Sanad.staffAssign('${id}')">تسكين</button></div>`
        : (staff.canStaff ? '<div style="font-size:11px;color:var(--faint);margin-top:.5rem">لا يوجد موظفون متاحون في هذا القطاع</div>' : '');
      this.openDrawer(`
        <div class="drawer-head"><div style="flex:1">
          <div style="font-size:11px;color:var(--muted);font-weight:700">مشروع · ${this.esc(p.code || p.id)}</div>
          <h3 style="font-size:17px;margin-top:.25rem">${this.esc(p.name_ar)}</h3>
          <div style="margin-top:.55rem;display:flex;gap:.4rem;flex-wrap:wrap">
            <span class="pill" style="background:#dbeafe;color:var(--brand)">${this.esc(this.lbl(p.status))}</span>
            ${p.rag ? `<span class="pill" style="background:${ragHex[p.rag]}22;color:${ragHex[p.rag]}">${this.esc(this.lbl(p.rag))}</span>` : ''}</div>
        </div><button class="btn btn-ghost" onclick="Sanad.closeDrawer()">✕</button></div>
        <div class="drawer-body">
          <div class="kv-row"><span class="k">الإنجاز</span><span class="v tnum">${Math.round(p.progress_effective_pct ?? p.progress_pct ?? 0)}%</span></div>
          <div class="bar" style="margin:.15rem 0 .85rem"><span style="width:${Math.min(100, p.progress_effective_pct ?? p.progress_pct ?? 0)}%;background:${ragHex[p.rag] || 'var(--brand)'}"></span></div>
          <div class="kv-row"><span class="k">قيمة العقد</span><span class="v tnum">${money(p.contract_value_halalas)}</span></div>
          <div class="kv-row"><span class="k">الصرف الفعلي</span><span class="v tnum">${p._redacted_actual_spend_halalas ? '<span style="color:var(--faint)">محجوب</span>' : money(p.actual_spend_halalas)}</span></div>
          <div style="margin-top:1.15rem"><div style="font-size:12px;font-weight:800;color:var(--muted);margin-bottom:.35rem;display:flex;align-items:center;gap:.4rem">${icon2('userplus')} الفريق المُسكَّن <span style="color:var(--faint);font-weight:600">(${(staff.assigned || []).length})</span></div>
            ${assigned}${addBox}</div>
        </div>
        <div class="drawer-foot"><a class="btn btn-primary" href="/app/project/${id}">فتح التفاصيل الكاملة</a><button class="btn" onclick="Sanad.closeDrawer()">إغلاق</button></div>`);
    } catch (e) { toast(e.message, true); }
  },
  async staffAssign(pid) { const sel = document.getElementById('staff-emp'); if (!sel || !sel.value) return; try { await api('/projects/' + pid + '/staff', 'POST', { employeeId: sel.value }); toast('تم التسكين ✓'); this.projOpen(pid); } catch (e) { toast(e.message, true); } },
  async staffRemove(pid, aid) { try { await api('/projects/staff/' + aid, 'DELETE'); toast('أُزيل التسكين ✓'); this.projOpen(pid); } catch (e) { toast(e.message, true); } },
  projAdd() {
    const S = window.__SANAD || {}; const secs = S.sectors || []; const locked = S.prjSectorLocked;
    this._deliv = [];
    this.openModal(`
      <div class="modal-head"><h3 style="font-size:16px">مشروع جديد</h3><button class="btn btn-ghost" onclick="Sanad.closeModal()">✕</button></div>
      <div style="padding:.35rem 1.35rem 0"><div class="seg" style="width:100%">
        <button class="on" id="im-tab-manual" style="flex:1;justify-content:center" onclick="Sanad.intakeTab('manual')">${icon2('edit')} إدخال يدوي</button>
        <button id="im-tab-contract" style="flex:1;justify-content:center" onclick="Sanad.intakeTab('contract')">${icon2('upload')} من عقد (تعبئة تلقائية)</button>
      </div></div>
      <div class="modal-body">
        <div id="im-contract" style="display:none;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:.85rem">
          <div class="field"><label>الصق نص العقد، أو ارفع ملفًا نصيًا</label>
            <textarea id="im-text" class="input" rows="5" placeholder="الصق نص العقد هنا ثم اضغط «استخرج البيانات» — يملأ الحقول تلقائيًا للمراجعة…"></textarea></div>
          <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-top:.5rem">
            <input type="file" id="im-file" accept=".txt,.md,.csv,text/plain" onchange="Sanad.intakeFile(event)" style="font-size:11.5px;max-width:190px">
            <button class="btn btn-primary" id="im-extract" onclick="Sanad.intakeExtract()">${icon2('ai')} استخرج البيانات</button>
            <span id="im-mode" style="font-size:11px;color:var(--muted)"></span>
          </div>
        </div>
        <div class="field"><label>اسم المشروع *</label><input class="input" id="np-name" placeholder="مثال: تطوير مكتب إدارة المشاريع"></div>
        <div class="grid2">
          <div class="field"><label>العميل / الجهة</label><input class="input" id="np-client" placeholder="اسم العميل"></div>
          <div class="field"><label>القطاع</label><select id="np-sector"${locked ? ' disabled' : ''}>${
            (locked ? secs.filter((s) => s.id === locked) : secs).map((s) => `<option value="${s.id}">${this.esc(s.name_ar)}</option>`).join('')
          }</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label>قيمة العقد (ر.س.)</label><input class="input" id="np-val" type="number" value="0"></div>
          <div class="field"><label>الحالة</label><select id="np-status"><option value="NOT_STARTED">لم يبدأ</option><option value="IN_PROGRESS" selected>قيد التنفيذ</option><option value="ON_HOLD">متوقّف مؤقتًا</option></select></div>
        </div>
        <div class="grid2">
          <div class="field"><label>تاريخ البدء</label><input class="input" id="np-start" type="date"></div>
          <div class="field"><label>تاريخ الانتهاء</label><input class="input" id="np-end" type="date"></div>
        </div>
        <div id="im-deliv-wrap" style="display:none"><label style="font-size:11.5px;font-weight:700;color:var(--muted)">المخرجات المستخرجة (<span id="im-deliv-n">0</span>)</label>
          <div id="im-deliv" style="max-height:150px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;padding:.5rem;margin-top:.3rem;font-size:12px"></div></div>
      </div>
      <div class="modal-foot"><button class="btn btn-primary" onclick="Sanad.projCreate()">إنشاء المشروع</button><button class="btn" onclick="Sanad.closeModal()">إلغاء</button></div>`);
    setTimeout(() => document.getElementById('np-name')?.focus(), 50);
  },
  intakeTab(t) {
    document.getElementById('im-contract').style.display = t === 'contract' ? '' : 'none';
    document.getElementById('im-tab-manual').classList.toggle('on', t === 'manual');
    document.getElementById('im-tab-contract').classList.toggle('on', t === 'contract');
  },
  intakeFile(e) { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { document.getElementById('im-text').value = String(r.result || '').slice(0, 20000); }; r.readAsText(f); },
  async intakeExtract() {
    const text = (document.getElementById('im-text').value || '').trim(); if (text.length < 20) return toast('ألصق نص العقد أولًا (٢٠ حرفًا على الأقل)', true);
    const btn = document.getElementById('im-extract'); btn.disabled = true; const orig = btn.innerHTML; btn.textContent = '… جارٍ الاستخراج';
    try {
      const d = await api('/intake/parse', 'POST', { text });
      const set = (elid, v) => { if (v != null && v !== '') document.getElementById(elid).value = v; };
      set('np-name', d.title_ar); set('np-client', d.client_name); set('np-val', d.value_sar); set('np-start', d.start_date); set('np-end', d.end_date);
      this._deliv = d.deliverables || [];
      const box = document.getElementById('im-deliv'); document.getElementById('im-deliv-n').textContent = this._deliv.length;
      box.innerHTML = this._deliv.map((x) => `<div style="display:flex;justify-content:space-between;gap:.5rem;padding:.25rem 0;border-bottom:1px dashed var(--line)"><span>${this.esc(x.name_ar)}</span><span class="tnum" style="color:var(--muted)">${x.amount_sar ? this.fmtSar(x.amount_sar * 100) : '—'}</span></div>`).join('') || '<span style="color:var(--faint)">لا مخرجات مستخرجة</span>';
      document.getElementById('im-deliv-wrap').style.display = this._deliv.length ? '' : 'none';
      document.getElementById('im-mode').textContent = (d._mode === 'local' ? '⚙ استخراج محلي' : '✨ استخراج ذكي (' + d._mode + ')') + (d._note ? ' — راجِع الحقول' : '');
      toast('تمت التعبئة — راجع الحقول قبل الإنشاء ✓');
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
  },
  async projCreate() {
    const name = (document.getElementById('np-name').value || '').trim(); if (!name) return toast('اسم المشروع مطلوب', true);
    const body = { name_ar: name, client_name: (document.getElementById('np-client').value || '').trim() || null,
      sector_id: document.getElementById('np-sector').value, status: document.getElementById('np-status').value,
      value_sar: Number(document.getElementById('np-val').value) || 0,
      start_date: document.getElementById('np-start').value || null, end_date: document.getElementById('np-end').value || null,
      deliverables: this._deliv || [] };
    try {
      const r = await api('/intake/create', 'POST', body);
      toast('أُنشئ المشروع ✓' + (r.deliverables ? ' (' + r.deliverables + ' مخرج)' : ''));
      this.closeModal(); setTimeout(() => location.reload(), 600);
    } catch (e) { toast(e.message, true); }
  },
});
// tiny inline icon for client-rendered drawers (subset)
function icon2(n) { const P = {
  userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0112 0"/><path d="M18 8v6M15 11h6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  upload: '<path d="M12 15V3m0 0L8 7m4-4l4 4"/><path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4"/>',
  ai: '<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/>',
}; return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px">${P[n] || ''}</svg>`; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { window.Sanad.closeDrawer(); window.Sanad.closeModal(); } });

// notification badge
fetch('/api/notifications?unread=1', { credentials: 'include' }).then((r) => r.ok ? r.json() : []).then((n) => {
  const b = document.getElementById('notif-badge');
  if (b && n.length) { b.textContent = n.length + ' إشعار'; b.classList.remove('hidden'); }
}).catch(() => {});

// Inject CSRF token (from readable cookie) into state-changing web forms.
// Defensive + deferred so it can never break the app's core methods above.
function injectCsrf() {
  try {
    var m = document.cookie.match(/(?:^|; )sanad_csrf=([^;]+)/);
    if (!m) return;
    var forms = document.querySelectorAll('form[method="post"], form[method="POST"]');
    for (var k = 0; k < forms.length; k++) {
      if (forms[k].querySelector('input[name="_csrf"]')) continue;
      var i = document.createElement('input');
      i.type = 'hidden'; i.name = '_csrf'; i.value = decodeURIComponent(m[1]);
      forms[k].appendChild(i);
    }
  } catch (e) { /* never fatal */ }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectCsrf);
else injectCsrf();
