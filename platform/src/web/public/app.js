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

// notification badge
fetch('/api/notifications?unread=1', { credentials: 'include' }).then((r) => r.ok ? r.json() : []).then((n) => {
  const b = document.getElementById('notif-badge');
  if (b && n.length) { b.textContent = n.length + ' إشعار'; b.classList.remove('hidden'); }
}).catch(() => {});
