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
});

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
