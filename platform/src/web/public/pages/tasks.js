// صفحة «مهامي» — تفويض أحداث فقط: إضافة سريعة، إنجاز بنقرة، تغيير الحالة (يعيد التحميل ليُعاد
// الترتيب حسب الإلحاح). يعتمد على Sanad.quickTask المجمّد في app.js ولا يعدّله.
(function () {
  'use strict';
  function toast(msg, bad) {
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#dc2626' : '#059669');
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600);
  }
  async function api(path, method, body) {
    var r = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error((j.error && j.error.message) || ('خطأ ' + r.status));
    return j;
  }
  function reload() { setTimeout(function () { location.reload(); }, 350); }

  // ── نقرة: إضافة سريعة + إنجاز فوري ──
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var act = el.dataset.action;
    if (act === 'task-add') {
      if (window.Sanad && window.Sanad.quickTask) window.Sanad.quickTask();
      return;
    }
    if (act === 'task-done') {
      var id = el.dataset.id;
      el.disabled = true;
      api('/tasks/' + id, 'PATCH', { status: 'DONE' })
        .then(function () { toast('أُنجزت المهمة ✓'); reload(); })
        .catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }
  });

  // ── تغيير الحالة من القائمة المنسدلة — يعيد التحميل ليُنقل الصف لقسمه الصحيح ──
  document.addEventListener('change', function (e) {
    var el = e.target.closest('select[data-action="task-status"]');
    if (!el) return;
    api('/tasks/' + el.dataset.id, 'PATCH', { status: el.value })
      .then(function () { toast('حُدّثت الحالة ✓'); reload(); })
      .catch(function (err) { toast(err.message, true); });
  });

  // ── Enter في حقل العنوان يضيف المهمة مباشرة ──
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.target && e.target.id === 'qa-title') {
      e.preventDefault();
      if (window.Sanad && window.Sanad.quickTask) window.Sanad.quickTask();
    }
  });
})();
