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
  async quickOpp() {
    const title = prompt('عنوان الفرصة الجديدة؟'); if (!title) return;
    const val = prompt('القيمة المتوقعة (ريال)؟', '0');
    try { await api('/opportunities', 'POST', { title_ar: title, value_sar: Number(val) || 0 }); toast('أُضيفت الفرصة ✓'); location.reload(); }
    catch (e) { toast(e.message, true); }
  },
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

// ── AI assistant ──
Object.assign(window.Sanad, {
  _aiPending: null,
  aiToggle() {
    const p = document.getElementById('ai-panel');
    const open = p.style.display === 'none' || !p.style.display;
    p.style.display = open ? 'flex' : 'none';
    if (open) {
      fetch('/api/ai/status', { credentials: 'include' }).then((r) => r.json()).then((s) => {
        document.getElementById('ai-mode').textContent = s.mode === 'local' ? 'محلي (بلا مفتاح)' : 'مزوّد: ' + s.mode;
      }).catch(() => {});
      document.getElementById('ai-input').focus();
    }
  },
  _aiPush(role, html) {
    const box = document.getElementById('ai-box');
    const d = document.createElement('div');
    d.className = role === 'user' ? 'text-left' : '';
    d.innerHTML = `<div class="inline-block max-w-[85%] rounded-xl px-3 py-2 ${role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-line'}" style="white-space:pre-wrap">${html}</div>`;
    box.appendChild(d); box.scrollTop = box.scrollHeight;
  },
  async aiSend() {
    const inp = document.getElementById('ai-input'); const msg = inp.value.trim(); if (!msg) return;
    inp.value = ''; this._aiPush('user', msg);
    try {
      const r = await api('/ai/chat', 'POST', { message: msg });
      this._aiPush('ai', r.reply || '…');
      if (r.applyToken) {
        this._aiPending = r.applyToken;
        const box = document.getElementById('ai-box');
        const d = document.createElement('div');
        d.innerHTML = `<button onclick="Sanad.aiApply()" class="text-[12px] text-white px-3 py-1.5 rounded-lg" style="background:#059669">تأكيد التطبيق</button>`;
        box.appendChild(d); box.scrollTop = box.scrollHeight;
      }
    } catch (e) { this._aiPush('ai', '⚠ ' + e.message); }
  },
  async aiApply() {
    if (!this._aiPending) return;
    try { const r = await api('/ai/apply', 'POST', { applyToken: this._aiPending }); this._aiPush('ai', r.reply); this._aiPending = null; }
    catch (e) { this._aiPush('ai', '⚠ ' + e.message); }
  },
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
  fmtSar(h) { try { return new Intl.NumberFormat('ar-SA-u-nu-latn', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format((h || 0) / 100); } catch (e) { return Math.round((h || 0) / 100).toLocaleString() + ' ر.س.'; } },
  openDrawer(html) { const d = document.getElementById('drawer'); d.innerHTML = html; d.classList.add('on'); d.setAttribute('aria-hidden', 'false'); document.getElementById('scrim').classList.add('on'); },
  closeDrawer() { const d = document.getElementById('drawer'); d.classList.remove('on'); d.setAttribute('aria-hidden', 'true'); document.getElementById('scrim').classList.remove('on'); },
  openModal(html) { const m = document.getElementById('modal'); m.innerHTML = '<div class="modal-card">' + html + '</div>'; m.classList.add('on'); },
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
    const body = col.querySelector('.kcol-body');
    body.querySelectorAll(':scope > div:not(.kcard)').forEach((ph) => ph.remove()); // drop the "—" placeholder
    body.appendChild(card);
    this._recount('opp');
    try { await api('/opportunities/' + id + '/stage', 'POST', { stage }); toast('نُقلت الفرصة إلى ' + (col.querySelector('.t')?.textContent || '') + ' ✓'); }
    catch (err) { toast(err.message, true); location.reload(); }
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
          <div class="kv-row"><span class="k">القيمة المتوقعة</span><span class="v tnum ${ce ? 'editable' : ''}" ${ce ? `onclick="Sanad.oppEditVal('${o.id}',${(o.value_halalas || 0) / 100})"` : ''}>${this.fmtSar(o.value_halalas)}</span></div>
          <div class="kv-row"><span class="k">الاحتمالية</span><span class="v tnum">${Math.round(o.win_pct || 0)}%</span></div>
          <div class="kv-row"><span class="k">الأولوية</span><span class="v">${this.esc(o.priority || '—')}</span></div>
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
  oppEditVal(id, cur) { const v = prompt('القيمة المتوقعة (ر.س.)؟', cur); if (v === null) return; api('/opportunities/' + id, 'PATCH', { value_sar: Number(v) || 0 }).then(() => { toast('حُفظ ✓'); this.oppOpen(id); }).catch((e) => toast(e.message, true)); },
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
});
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
