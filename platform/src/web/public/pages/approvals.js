// شاشة الاعتمادات — تفويض أحداث فقط، بلا أي مُعالِج داخل السمات (onclick).
// الاعتماد بنقرة، والرفض بسببٍ يُكتب في نافذةٍ من المنتج لا في مربّع المتصفح — السبب يصل
// إلى صاحب الطلب فيستحق حقلاً محترماً. لا يُعدَّل app.js: Sanad.approve باقٍ لمن يناديه.
(function () {
  'use strict';

  // ── أدوات صغيرة ──
  function toast(msg, bad) {
    var d = document.createElement('div');
    d.textContent = msg;
    d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;'
      + 'font-size:13px;max-width:min(92vw,420px);line-height:1.7;box-shadow:0 8px 24px rgba(0,0,0,.2);background:'
      + (bad ? '#b91c1c' : '#047857');
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, bad ? 5200 : 2600);
  }
  async function api(path, method, body) {
    var r = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error((j.error && j.error.message) || 'تعذّر إتمام العملية — أعد المحاولة');
    return j;
  }
  function reload() { setTimeout(function () { location.reload(); }, 320); }
  function escAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function closeModal() { if (window.Sanad && window.Sanad.closeModal) window.Sanad.closeModal(); }

  // ── نافذة سبب الرفض ──
  function openReject(id) {
    if (!window.Sanad || !window.Sanad.openModal) { toast('تعذّر فتح النافذة — حدّث الصفحة', true); return; }
    var html = '<div class="modal-head"><div style="font-weight:800;font-size:15px">رفض طلب الاعتماد</div>'
      + '<button class="btn btn-ghost btn-sm" data-action="apr-reject-close" aria-label="إغلاق">✕</button></div>'
      + '<div class="modal-body"><div class="field">'
      + '<label for="apr-reason">سبب الرفض — يصل إلى صاحب الطلب</label>'
      + '<textarea id="apr-reason" class="input" rows="3" placeholder="اكتب السبب باختصار — ماذا ينقص الطلب؟"></textarea>'
      + '</div></div>'
      + '<div class="modal-foot"><button class="btn" data-action="apr-reject-close">إلغاء</button>'
      + '<button class="btn btn-primary" data-action="apr-reject-go" data-id="' + escAttr(id) + '">رفض الطلب</button></div>';
    window.Sanad.openModal(html);
    var ta = document.getElementById('apr-reason');
    if (ta) ta.focus();
  }

  // ── نقرة واحدة تُوجَّه من data-action ──
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    var act = el.dataset.action;

    if (act === 'apr-approve') {
      e.preventDefault();
      el.disabled = true;
      api('/approvals/' + encodeURIComponent(el.dataset.id || '') + '/act', 'POST', { action: 'approve' })
        .then(function () { toast('اعتُمد ✓'); reload(); })
        .catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }
    if (act === 'apr-reject') { e.preventDefault(); openReject(el.dataset.id || ''); return; }
    if (act === 'apr-reject-close') { e.preventDefault(); closeModal(); return; }
    if (act === 'apr-reject-go') {
      e.preventDefault();
      var ta = document.getElementById('apr-reason');
      var comment = ta ? String(ta.value || '').trim() : '';
      // الرفض بلا سبب يصل صاحبَه خبراً أبكم: «رُفض» ولا يعرف لماذا ولا ما العمل.
      if (!comment) { toast('اكتب سبب الرفض — يصل إلى صاحب الطلب ليصحّح', true); if (ta) ta.focus(); return; }
      el.disabled = true;
      api('/approvals/' + encodeURIComponent(el.dataset.id || '') + '/act', 'POST', { action: 'reject', comment: comment })
        .then(function () { closeModal(); toast('رُفض الطلب — وصل السبب إلى صاحبه'); reload(); })
        .catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }
  });
})();
