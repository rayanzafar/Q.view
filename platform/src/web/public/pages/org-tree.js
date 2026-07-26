// صفحة الهيكل التنظيمي — إدارة ذاتية للإدارات والوحدات داخل الشجرة.
// كل إجراء يمر عبر الخدمة التي تفحص الصلاحية وتُدقّق؛ إخفاء الأزرار تجميل لا حماية.
(function () {
  'use strict';
  function toast(msg, bad) {
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;'
      + 'color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#dc2626' : '#059669');
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 3000);
  }
  async function api(path, method, body) {
    var r = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error((j.error && j.error.message) || ('تعذّر تنفيذ الطلب (' + r.status + ')'));
    return j;
  }
  var reload = function () { setTimeout(function () { location.reload(); }, 400); };
  var val = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };

  async function depAdd(sectorId) {
    var name = val('d-' + sectorId);
    if (!name) { toast('اكتب اسم الإدارة أولاً', true); return; }
    try { await api('/org/departments', 'POST', { sector_id: sectorId, name_ar: name }); toast('أُضيفت الإدارة ✓'); reload(); }
    catch (e) { toast(e.message, true); }
  }
  async function unitAdd(depId) {
    var name = val('u-' + depId);
    if (!name) { toast('اكتب اسم الوحدة أولاً', true); return; }
    try { await api('/org/units', 'POST', { department_id: depId, name_ar: name }); toast('أُضيفت الوحدة ✓'); reload(); }
    catch (e) { toast(e.message, true); }
  }
  async function depRename(id, current) {
    var name = window.prompt('الاسم الجديد للإدارة:', current || '');
    if (name === null) return;                       // ألغى
    name = name.trim();
    if (!name || name === current) return;
    try { await api('/org/departments/' + id, 'PATCH', { name_ar: name }); toast('حُدّث الاسم ✓'); reload(); }
    catch (e) { toast(e.message, true); }
  }
  async function depMove(id, sectorId, sel) {
    if (!sectorId) return;
    try { await api('/org/departments/' + id, 'PATCH', { sector_id: sectorId }); toast('نُقلت الإدارة ✓'); reload(); }
    catch (e) { if (sel) sel.value = ''; toast(e.message, true); }
  }
  async function depDel(id, name) {
    if (!window.confirm('حذف الإدارة «' + name + '»؟ لن يتم الحذف إن كان بها موظفون أو وحدات.')) return;
    try { await api('/org/departments/' + id, 'DELETE'); toast('حُذفت الإدارة ✓'); reload(); }
    catch (e) { toast(e.message, true); }
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var a = el.dataset.action;
    if (a === 'dep-add') { e.preventDefault(); return void depAdd(el.dataset.sector); }
    if (a === 'unit-add') { e.preventDefault(); return void unitAdd(el.dataset.dep); }
    if (a === 'dep-rename') { e.preventDefault(); return void depRename(el.dataset.id, el.dataset.name); }
    if (a === 'dep-del') { e.preventDefault(); return void depDel(el.dataset.id, el.dataset.name); }
  });
  document.addEventListener('change', function (e) {
    var sel = e.target.closest('[data-action-change="dep-move"]');
    if (sel) return void depMove(sel.dataset.id, sel.value, sel);
  });
  // Enter داخل حقل الإضافة ينفّذ الإضافة — الحقول داخل <summary> فنمنع الطيّ.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.id) return;
    if (e.target.id.indexOf('d-') === 0) { e.preventDefault(); depAdd(e.target.id.slice(2)); }
    else if (e.target.id.indexOf('u-') === 0) { e.preventDefault(); unitAdd(e.target.id.slice(2)); }
  });
})();
