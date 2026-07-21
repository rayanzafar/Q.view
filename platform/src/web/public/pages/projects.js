// صفحة المشاريع (جدول المحفظة) — تفويض أحداث فقط: تنقّل، بحث حي، عروض محفوظة، ترتيب أعمدة.
// يعتمد على بنية app.js المجمّدة (Sanad.openModal/closeModal/projAdd/_recount) ولا يعدّلها.
(function () {
  'use strict';
  var S = function () { return window.__SANAD || {}; };

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

  // ── بحث حي (جدول المحفظة + كانبان) — يُهيَّأ من ?q= عند فتح عرض محفوظ ──
  function filterRows() {
    var qEl = document.getElementById('prj-q'); if (!qEl) return;
    var q = (qEl.value || '').toLowerCase().trim();
    document.querySelectorAll('#prj-rows tr[data-hay], #prj-kanban .kcard').forEach(function (c) {
      var hay = c.dataset.hay || c.textContent.toLowerCase();
      c.style.display = (!q || hay.indexOf(q) !== -1) ? '' : 'none';
    });
    if (document.getElementById('prj-kanban') && window.Sanad && window.Sanad._recount) window.Sanad._recount('prj');
  }
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'prj-q') filterRows();
  });

  // ── ترتيب الأعمدة: نقرة على رأس عمود يحمل data-sort — رقمي إن أمكن وإلا نصي، مع عكس الاتجاه ──
  function sortBy(thEl) {
    var table = thEl.closest('table'); var tbody = table && table.querySelector('tbody'); if (!tbody) return;
    var idx = thEl.cellIndex;
    var dir = thEl.dataset.dir === 'asc' ? 'desc' : 'asc';
    table.querySelectorAll('th[data-sort]').forEach(function (h) { delete h.dataset.dir; });
    thEl.dataset.dir = dir;
    var rows = [...tbody.querySelectorAll('tr')];
    var val = function (tr) { var td = tr.children[idx]; return td ? (td.dataset.v != null ? td.dataset.v : td.textContent.trim()) : ''; };
    var numeric = rows.every(function (r) { var v = val(r); return v === '' || !isNaN(Number(v)); });
    rows.sort(function (a, b) {
      var x = val(a), y = val(b);
      var c = numeric ? (Number(x) || 0) - (Number(y) || 0) : String(x).localeCompare(String(y), 'ar');
      return dir === 'asc' ? c : -c;
    });
    rows.forEach(function (r) { tbody.appendChild(r); });
  }

  // ── حفظ العرض الحالي (اسم + معاملات الرابط الحالية) ──
  function viewSaveModal() {
    window.Sanad.openModal(
      '<div class="modal-head"><h3 style="font-size:16px">حفظ العرض الحالي</h3>' +
      '<button class="btn btn-ghost" data-action="modal-close">✕</button></div>' +
      '<div class="modal-body"><div class="field"><label>اسم العرض</label>' +
      '<input class="input" id="sv-name" maxlength="60" placeholder="مثال: مشاريع 2025 الحرجة"></div>' +
      '<div style="font-size:11.5px;color:var(--muted);line-height:1.8">يُحفظ العرض بمرشحاته الحالية (القطاع والسنة وطريقة العرض والبحث) ويظهر شريحةً أعلى الصفحة لك وحدك.</div></div>' +
      '<div class="modal-foot"><button class="btn btn-primary" data-action="view-save-confirm">حفظ العرض</button>' +
      '<button class="btn" data-action="modal-close">إلغاء</button></div>');
    setTimeout(function () { var n = document.getElementById('sv-name'); if (n) n.focus(); }, 60);
  }
  async function viewSaveConfirm() {
    var name = (document.getElementById('sv-name') || { value: '' }).value.trim();
    if (!name) return toast('اسم العرض مطلوب', true);
    var params = {};
    new URLSearchParams(location.search).forEach(function (v, k) { params[k] = v; });
    var qEl = document.getElementById('prj-q');
    if (qEl && qEl.value.trim()) params.q = qEl.value.trim(); else delete params.q;
    try {
      await api('/views', 'POST', { page: S().viewsPage || 'projects', name_ar: name, params_json: params });
      window.Sanad.closeModal(); toast('حُفظ العرض ✓'); setTimeout(function () { location.reload(); }, 450);
    } catch (err) { toast(err.message, true); }
  }

  // ── تفويض النقر ──
  document.addEventListener('click', function (e) {
    var sortTh = e.target.closest('th[data-sort]');
    if (sortTh) { sortBy(sortTh); return; }
    var actEl = e.target.closest('[data-action]');
    if (!actEl) return;
    var act = actEl.dataset.action;
    if (act === 'go') { location.href = actEl.dataset.href; return; }
    if (act === 'open-prj') {
      if (e.target.closest('a,button,select,input')) return; // لا تخطف الروابط الداخلية
      location.href = '/app/project/' + actEl.dataset.id; return;
    }
    if (act === 'prj-add') { if (window.Sanad) window.Sanad.projAdd(); return; }
    if (act === 'modal-close') { window.Sanad.closeModal(); return; }
    if (act === 'view-save') { viewSaveModal(); return; }
    if (act === 'view-save-confirm') { viewSaveConfirm(); return; }
    if (act === 'view-del') {
      api('/views/' + actEl.dataset.id, 'DELETE')
        .then(function () { toast('حُذف العرض'); setTimeout(function () { location.reload(); }, 400); })
        .catch(function (err) { toast(err.message, true); });
      return;
    }
    if (act === 'view-default') {
      api('/views/' + actEl.dataset.id + '/default', 'POST')
        .then(function () { toast('أصبح العرض الافتراضي ✓'); setTimeout(function () { location.reload(); }, 400); })
        .catch(function (err) { toast(err.message, true); });
      return;
    }
  });

  // ── لوحة المفاتيح: صفوف الجدول ورؤوس الترتيب تعمل بـ Enter ──
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (t.matches && t.matches('[data-action="open-prj"],[data-action="go"],th[data-sort]')) { e.preventDefault(); t.click(); }
  });

  function init() {
    var q = new URLSearchParams(location.search).get('q');
    var el = document.getElementById('prj-q');
    if (q && el) { el.value = q; filterRows(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
