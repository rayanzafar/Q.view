// صفحة الهيكل التنظيمي — إدارة ذاتية للإدارات والوحدات داخل الشجرة + الإسناد الجماعي للعمل.
// كل إجراء يمر عبر الخدمة التي تفحص الصلاحية وتُدقّق؛ إخفاء الأزرار تجميل لا حماية.
// القوائم كلها مبنية على الخادم — هذا الملف يضيف التحديد والإسناد فوقها، ولا يبني صفاً واحداً.
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
    if (!r.ok) throw new Error((j.error && j.error.message) || 'تعذّر تنفيذ الطلب — أعد المحاولة');
    return j;
  }
  var reload = function () { setTimeout(function () { location.reload(); }, 400); };
  var val = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ── الشجرة: إدارات ووحدات ──
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
  // تعيين مسؤول الإدارة (أو رفعه) — القائمة نفسها هي السطر الذي كان يقول «بلا مسؤول معيَّن».
  async function depManager(sel) {
    var prev = sel.dataset.prev || '';
    var next = sel.value;
    if (next === prev) return;
    var name = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
    try {
      await api('/org/departments/' + sel.dataset.id, 'PATCH', { manager_user_id: next });
      sel.dataset.prev = next;
      toast(next ? 'مسؤول الإدارة: ' + name + ' ✓' : 'رُفع مسؤول الإدارة ✓');
      reload();
    } catch (e) { sel.value = prev; toast(e.message, true); }
  }

  async function depDel(id, name) {
    if (!window.confirm('حذف الإدارة «' + name + '»؟ لن يتم الحذف إن كان بها موظفون أو وحدات.')) return;
    try { await api('/org/departments/' + id, 'DELETE'); toast('حُذفت الإدارة ✓'); reload(); }
    catch (e) { toast(e.message, true); }
  }

  // ── شاشة الإسناد: تحديد متعدد ثم إسناد دفعة واحدة إلى إدارة واحدة ──
  var boxes = function () { return $$('.asg-cb:not([disabled])'); };
  var picked = function () { return boxes().filter(function (b) { return b.checked; }); };

  function syncBar() {
    var n = picked().length;
    var out = $('#asg-n');
    if (out) out.textContent = String(n);
    var btn = $('[data-action="asg-apply"]');
    if (btn) btn.disabled = n === 0;
    // شريط الإجراء يطفو ما دام هناك تحديد، كي لا يختفي فوق قائمة طويلة
    var bar = $('.asg-bar'), wrap = $('.asg-barwrap');
    if (bar && wrap) {
      if (n > 0 && !bar.classList.contains('float')) {
        wrap.style.minHeight = bar.offsetHeight + 'px';
        bar.classList.add('float');
      } else if (n === 0 && bar.classList.contains('float')) {
        bar.classList.remove('float');
        wrap.style.minHeight = '';
      }
    }
    var all = $('#asg-all');
    var live = boxes();
    if (all) {
      all.checked = live.length > 0 && n === live.length;
      all.indeterminate = n > 0 && n < live.length;
    }
  }

  function rowState(id, text, kind) {
    var tr = $('tr[data-row="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!tr) return false;   // صف اختفى من الصفحة ⟵ السبب يُرفع إلى الملخص بدل أن يضيع
    var cell = $('.asg-state', tr);
    if (cell) { cell.textContent = text; cell.className = 'asg-state ' + kind; }
    tr.classList.remove('done', 'bad');
    tr.classList.add(kind === 'ok' ? 'done' : 'bad');
    if (kind === 'ok') {
      var cb = $('.asg-cb', tr);
      if (cb) { cb.checked = false; cb.disabled = true; }
    }
    return true;
  }

  // ملخص النتيجة أعلى الجدول: ما نجح لا يضيع حين يفشل غيره — والسبب العربي يبقى بجانب صفه.
  function showResult(html, tone) {
    var box = $('#asg-result');
    if (!box) return;
    box.innerHTML = '<div class="alert ' + tone + '" style="margin-bottom:.8rem">'
      + '<div>' + html + '</div></div>';
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  var textNode = function (s) { var d = document.createElement('span'); d.textContent = s == null ? '' : String(s); return d.outerHTML; };

  async function assignApply(btn) {
    var sel = $('#asg-dep');
    var depId = sel ? sel.value : '';
    if (!depId) { toast('اختر الإدارة المسؤولة أولاً', true); if (sel) sel.focus(); return; }
    var chosen = picked();
    if (!chosen.length) { toast('حدّد سجلاً واحداً على الأقل', true); return; }
    var ids = chosen.map(function (b) { return b.dataset.id; });
    var depName = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'جارٍ الإسناد…';
    try {
      var r = await api('/org/attribution/bulk', 'PATCH', { kind: btn.dataset.kind, ids: ids, department_id: depId });
      var failed = r.failed || [];
      var failedIds = {};
      failed.forEach(function (f) { failedIds[f.id] = f.reason || 'تعذّر الإسناد'; });
      var lost = [];
      ids.forEach(function (id) {
        if (failedIds[id]) { if (!rowState(id, failedIds[id], 'err')) lost.push(failedIds[id]); }
        else rowState(id, 'أُسند إلى ' + depName + ' ✓', 'ok');
      });
      var done = ids.length - failed.length;
      if (!failed.length) {
        showResult('أُسند <b class="tnum">' + done + '</b> إلى ' + textNode(depName) + ' — تُحدَّث القائمة الآن.', 'ok');
        toast('تم الإسناد ✓');
        reload();
        return;
      }
      showResult('أُسند <b class="tnum">' + done + '</b> إلى ' + textNode(depName)
        + ' · تعذّر إسناد <b class="tnum">' + failed.length + '</b> — السبب مكتوب بجانب كل صف.'
        + (lost.length ? '<div style="margin-top:.3rem">' + lost.map(textNode).join('<br>') + '</div>' : '')
        + ' <button class="btn btn-sm" data-action="asg-refresh">تحديث القائمة</button>', done ? 'warn' : 'err');
      toast('تعذّر إسناد بعض السجلات', true);
    } catch (e) {
      showResult(textNode(e.message), 'err');
      toast(e.message, true);
    } finally {
      btn.textContent = label; syncBar();
    }
  }


  // ── نقل الموظفين ──
  // «لازم سهل نقل الموظفين من الادارات او الى قطاعات اخرى». الشريط والتحديد والنتائج بنفس
  // بنية الإسناد أعلاه — سطحُ إجراءٍ واحد يتعلّمه المستخدم مرة، لا سطحان متشابهان يفترقان.
  var mvBoxes = function () { return $$('.mv-cb:not(:disabled)'); };
  var mvPicked = function () { return mvBoxes().filter(function (b) { return b.checked; }); };
  function mvSync() {
    var n = mvPicked().length;
    var out = $('#mv-n'); if (out) out.textContent = n;
    var btn = $('[data-action="mv-apply"]'); if (btn) btn.disabled = n === 0;
    var all = $('#mv-all'), live = mvBoxes();
    if (all) { all.checked = live.length > 0 && n === live.length; all.indeterminate = n > 0 && n < live.length; }
  }
  function mvRowState(id, text, kind) {
    var tr = $('tr[data-row="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!tr) return false;
    var cell = $('.mv-state', tr);
    if (cell) { cell.textContent = text; cell.className = 'mv-state ' + kind; }
    if (kind === 'ok') { var cb = $('.mv-cb', tr); if (cb) { cb.checked = false; cb.disabled = true; } }
    return true;
  }
  async function moveApply(btn) {
    var sel = $('#mv-to');
    var raw = sel ? sel.value : '';
    if (!raw) { toast('اختر الوجهة أولاً', true); if (sel) sel.focus(); return; }
    var chosen = mvPicked();
    if (!chosen.length) { toast('حدّد موظفاً واحداً على الأقل', true); return; }
    var ids = chosen.map(function (b) { return b.dataset.id; });
    // القيمة «معرّف-القطاع|معرّف-الإدارة»، والإدارة قد تكون فارغة عمداً (نقل إلى القطاع مباشرةً)
    var cut = raw.indexOf('|');
    var sectorId = cut < 0 ? raw : raw.slice(0, cut);
    var depId = cut < 0 ? '' : raw.slice(cut + 1);
    var toName = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'جارٍ النقل…';
    try {
      await api('/org/employees/move', 'POST', { employeeIds: ids, sector_id: sectorId, department_id: depId || null });
      ids.forEach(function (id) { mvRowState(id, 'نُقل ✓', 'ok'); });
      var box = $('#mv-result');
      if (box) {
        box.innerHTML = '<div class="alert ok" style="margin-bottom:.8rem"><div>نُقل <b class="tnum">'
          + ids.length + '</b> إلى ' + textNode(toName) + ' — تُحدَّث القائمة الآن.</div></div>';
      }
      toast('تم النقل ✓');
      reload();
    } catch (e) {
      var box2 = $('#mv-result');
      if (box2) box2.innerHTML = '<div class="alert err" style="margin-bottom:.8rem"><div>' + textNode(e.message) + '</div></div>';
      toast(e.message, true);
      btn.textContent = label; mvSync();
    }
  }

  // ── التفويض ──
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var a = el.dataset.action;
    if (a === 'dep-add') { e.preventDefault(); return void depAdd(el.dataset.sector); }
    if (a === 'unit-add') { e.preventDefault(); return void unitAdd(el.dataset.dep); }
    if (a === 'dep-rename') { e.preventDefault(); return void depRename(el.dataset.id, el.dataset.name); }
    if (a === 'dep-del') { e.preventDefault(); return void depDel(el.dataset.id, el.dataset.name); }
    if (a === 'asg-apply') { e.preventDefault(); return void assignApply(el); }
    if (a === 'asg-refresh') { e.preventDefault(); location.reload(); return; }
    if (a === 'mv-apply') { e.preventDefault(); return void moveApply(el); }
  });
  document.addEventListener('change', function (e) {
    var sel = e.target.closest('[data-action-change="dep-move"]');
    if (sel) return void depMove(sel.dataset.id, sel.value, sel);
    var mgr = e.target.closest('[data-action-change="dep-manager"]');
    if (mgr) return void depManager(mgr);
    if (e.target.id === 'asg-all') {
      var on = e.target.checked;
      boxes().forEach(function (b) { b.checked = on; });
      return void syncBar();
    }
    if (e.target.classList && e.target.classList.contains('asg-cb')) return void syncBar();
  });
  // Enter داخل حقل الإضافة ينفّذ الإضافة — الحقول داخل <summary> فنمنع الطيّ.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.id) return;
    if (e.target.id.indexOf('d-') === 0) { e.preventDefault(); depAdd(e.target.id.slice(2)); }
    else if (e.target.id.indexOf('u-') === 0) { e.preventDefault(); unitAdd(e.target.id.slice(2)); }
  });
  if (document.querySelector('.asg-tbl')) syncBar();
  if (document.querySelector('.mv-cb')) {
    mvSync();
    document.addEventListener('change', function (e) {
      if (e.target.id === 'mv-all') { mvBoxes().forEach(function (b) { b.checked = e.target.checked; }); return void mvSync(); }
      if (e.target.classList && e.target.classList.contains('mv-cb')) mvSync();
    });
  }
})();
