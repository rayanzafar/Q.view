// عميل طلبات التسكين (S16) — القائمة ولوحة المراجعة. تفويض data-action فقط، بلا onclick.
// القرار (اعتماد/إعادة/رفض) والسحب عبر واجهة B2؛ لا نجاح قبل ردّ الخادم، والأزرار تُعطَّل
// أثناء الإرسال، وخطأ الخادم يُعرض بنصّه ويسمح بإعادة المحاولة بلا تكرار (القرار لا يُبَتّ مرتين
// في الخدمة نفسها). الإعادة والرفض بسببٍ مكتوب يصل صاحب الطلب.
(function () {
  'use strict';

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
  const msg = (html, cls) => { const box = document.getElementById('rq-msg'); if (box) box.innerHTML = html ? '<div class="' + (cls || 'tm-info') + '">' + html + '</div>' : ''; };
  const noteEl = () => document.getElementById('rq-note');
  const panelButtons = () => Array.from(document.querySelectorAll('#rq-panel button[data-action]'));
  const setBusy = (on) => panelButtons().forEach((b) => { b.disabled = on; });
  const reload = () => setTimeout(() => location.reload(), 350);

  // ── مرشِّحات القائمة: الحالة في الرابط ───────────────────────────────────────
  const filters = document.getElementById('rq-filters');
  function submitFilters() {
    if (!filters) return;
    const p = new URLSearchParams();
    ['filter', 'q', 'from', 'to'].forEach((n) => { const el = filters.elements[n]; if (el && String(el.value || '').trim()) p.set(n, String(el.value).trim()); });
    const qs = p.toString();
    location.href = '/app/team/requests' + (qs ? '?' + qs : '');
  }
  if (filters) {
    filters.addEventListener('submit', (e) => { e.preventDefault(); submitFilters(); });
    filters.addEventListener('change', (e) => { if (e.target && e.target.id !== 'rq-q') submitFilters(); });
    let qt = null;
    const q = document.getElementById('rq-q');
    if (q) q.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(submitFilters, 650); });
  }

  // ── القرار والسحب ────────────────────────────────────────────────────────────
  let inflight = false;
  async function decide(id, action, label) {
    if (inflight) return;
    const ta = noteEl();
    const note = ta ? String(ta.value || '').trim() : '';
    if (action !== 'approve' && !note) {
      msg(action === 'return' ? 'اكتب سبب الإعادة — يصل إلى صاحب الطلب ليصحّح.' : 'اكتب سبب الرفض — يصل إلى صاحب الطلب ليعرف لماذا رُفض.', 'tm-danger');
      if (ta) ta.focus();
      return;
    }
    inflight = true; setBusy(true); msg('جارٍ ' + esc(label) + '…');
    try {
      const r = await api('/team/allocations/requests/' + encodeURIComponent(id) + '/decide', 'POST', { action, note });
      const st = r && r.status_ar ? r.status_ar : '';
      toast(st ? 'تم — الطلب الآن: ' + st : 'تم ✓');
      msg('تم — الطلب الآن: <b>' + esc(st || label) + '</b>. تُحدَّث الصفحة…', 'tm-ok');
      reload();
    } catch (e) {
      inflight = false; setBusy(false);
      msg(esc(e.message) + ' — يمكنك إعادة المحاولة.', 'tm-danger');
      toast(e.message, true);
    }
  }
  async function withdraw(id) {
    if (inflight) return;
    if (!window.confirm('سحب الطلب؟ يخرج من صندوق المراجع ولا يمكن التراجع.')) return;
    inflight = true; setBusy(true); msg('جارٍ السحب…');
    try {
      await api('/team/allocations/requests/' + encodeURIComponent(id) + '/withdraw', 'POST', {});
      toast('سُحب الطلب');
      msg('سُحب الطلب. تُحدَّث الصفحة…', 'tm-ok');
      reload();
    } catch (e) {
      inflight = false; setBusy(false);
      msg(esc(e.message), 'tm-danger');
      toast(e.message, true);
    }
  }

  // ── التفويض ─────────────────────────────────────────────────────────────────
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'rq-open') {
      if (ev.target.closest('a, button, input, select, textarea')) return;   // الرابط داخل الصف يعمل بنفسه
      if (el.dataset.href) location.href = el.dataset.href;
      return;
    }
    if (a === 'rq-approve') { ev.preventDefault(); decide(el.dataset.id, 'approve', 'الاعتماد'); return; }
    if (a === 'rq-return') { ev.preventDefault(); decide(el.dataset.id, 'return', 'الإعادة'); return; }
    if (a === 'rq-reject') { ev.preventDefault(); decide(el.dataset.id, 'reject', 'الرفض'); return; }
    if (a === 'rq-withdraw') { ev.preventDefault(); withdraw(el.dataset.id); return; }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || !ev.target || !ev.target.matches) return;
    if (ev.target.matches('tr[data-action="rq-open"]')) { ev.preventDefault(); if (ev.target.dataset.href) location.href = ev.target.dataset.href; }
  });
})();
