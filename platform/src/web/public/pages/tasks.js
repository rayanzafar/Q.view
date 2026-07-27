// مركز العمل اليومي — تفويض أحداث فقط، بلا أي مُعالِج داخل السمات (onclick).
// ما تديره هذه الطبقة: الإضافة السريعة بكل حقولها، الإنجاز بنقرة، تغيير الحالة، محرِّر المهمة
// في اللوح الجانبي (تقدّم/عائق/خطوة تالية/جهة/مسؤول/إدارة)، التحديد المتعدد والتغيير الجماعي،
// وسحب البطاقات بين أعمدة اللوح. لا تعدّل app.js ولا تعتمد على دوالّه في المسارات الجديدة.
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
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var val = function (id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };

  // «p:معرّف» مشروع · «o:معرّف» فرصة · فارغ = عمل داخلي
  function parentPatch(raw) {
    var v = String(raw || '');
    if (v.indexOf('p:') === 0) return { project_id: v.slice(2), opportunity_id: null };
    if (v.indexOf('o:') === 0) return { opportunity_id: v.slice(2), project_id: null };
    return { project_id: null, opportunity_id: null };
  }
  function parentValue(row) {
    if (row.dataset.project) return 'p:' + row.dataset.project;
    if (row.dataset.opp) return 'o:' + row.dataset.opp;
    return '';
  }

  // ── الإضافة السريعة (كل الحقول، لا ثلاثة منها) ──
  async function quickAdd(btn) {
    var title = val('qa-title');
    if (!title) { toast('اكتب عنوان المهمة أولاً — ما الذي ستنجزه؟', true); var t = document.getElementById('qa-title'); if (t) t.focus(); return; }
    var body = {
      title: title,
      priority: val('qa-priority') || 'P2',
      due_date: val('qa-due') || null,
      next_step: val('qa-next') || null,
    };
    var p = parentPatch(val('qa-parent'));
    if (p.project_id) body.project_id = p.project_id;
    if (p.opportunity_id) body.opportunity_id = p.opportunity_id;
    var who = val('qa-assignee');
    if (who) body.assignee_user_id = who;
    if (btn) btn.disabled = true;
    try {
      await api('/tasks/quick', 'POST', body);
      toast('أُضيفت المهمة ✓');
      reload();
    } catch (e) { if (btn) btn.disabled = false; toast(e.message, true); }
  }

  // ── محرِّر المهمة (لوح جانبي) ──
  var editing = null;   // معرّف المهمة المفتوحة
  function fillEditor(row, focus, presetStatus) {
    var tpl = document.getElementById('tk-editor');
    if (!tpl || !window.Sanad || !window.Sanad.openDrawer) { toast('تعذّر فتح تفاصيل المهمة — حدّث الصفحة', true); return; }
    window.Sanad.openDrawer(tpl.innerHTML);
    var d = document.getElementById('drawer');
    editing = row.dataset.task;
    var head = $('[data-f="heading"]', d);
    if (head) head.textContent = row.dataset.title || '';
    var set = function (f, v) { var el = $('[data-f="' + f + '"]', d); if (el) el.value = v == null ? '' : v; return el; };
    set('title', row.dataset.title);
    set('status', presetStatus || row.dataset.status || 'TODO');
    set('priority', row.dataset.priority || 'P2');
    set('due', row.dataset.due || '');
    set('next', row.dataset.next || '');
    set('blocked', row.dataset.blocked || '');
    set('parent', parentValue(row));
    set('assignee', row.dataset.assignee || '');
    set('dept', row.dataset.dept || '');
    var pr = set('progress', row.dataset.progress || '0');
    var out = $('[data-f="progress-out"]', d);
    var paint = function () { if (out && pr) out.textContent = pr.value + '%'; };
    paint();
    if (pr) pr.addEventListener('input', paint);
    var target = focus === 'blocked' ? '[data-f="blocked"]' : focus === 'next' ? '[data-f="next"]'
      : focus === 'progress' ? '[data-f="progress"]' : '[data-f="title"]';
    var el = $(target, d);
    if (el) { el.focus(); if (el.select) try { el.select(); } catch (x) { /* range inputs لا تُحدَّد */ } }
  }
  function closeEditor() { editing = null; if (window.Sanad && window.Sanad.closeDrawer) window.Sanad.closeDrawer(); }

  async function saveEditor(btn) {
    var d = document.getElementById('drawer');
    if (!d || !editing) return;
    var g = function (f) { var el = $('[data-f="' + f + '"]', d); return el ? String(el.value || '').trim() : null; };
    var patch = {
      title: g('title'),
      status: g('status'),
      priority: g('priority'),
      due_date: g('due') || null,
      progress_pct: Number(g('progress') || 0),
      next_step: g('next') || null,
      blocked_reason: g('blocked') || null,
    };
    var pv = $('[data-f="parent"]', d);
    if (pv) { var p = parentPatch(pv.value); patch.project_id = p.project_id; patch.opportunity_id = p.opportunity_id; }
    var av = $('[data-f="assignee"]', d);
    if (av) patch.assignee_user_id = av.value || null;
    var dv = $('[data-f="dept"]', d);
    if (dv) patch.department_id = dv.value || null;
    if (!patch.title) { toast('عنوان المهمة مطلوب', true); return; }
    var err = $('[data-f="error"]', d);
    if (err) { err.hidden = true; err.classList.remove('err'); }
    btn.disabled = true; var old = btn.textContent; btn.textContent = 'جارٍ الحفظ…';
    try {
      await api('/tasks/' + encodeURIComponent(editing), 'PATCH', patch);
      toast('حُفظت التغييرات ✓');
      closeEditor(); reload();
    } catch (e) {
      btn.disabled = false; btn.textContent = old;
      if (err) { err.textContent = e.message; err.hidden = false; err.classList.add('err'); }
      toast(e.message, true);
    }
  }

  // ── التحديد المتعدد + الشريط الجماعي ──
  function selected() { return $$('.tk-sel:checked').map(function (c) { return c.value; }); }
  function refreshBulk() {
    var ids = selected();
    var bar = document.getElementById('tk-bulk');
    var n = document.getElementById('tk-bulk-n');
    if (n) n.textContent = String(ids.length);
    if (bar) bar.hidden = ids.length === 0;
    $$('.tk-sel').forEach(function (c) {
      var row = c.closest('.tk-row');
      if (row) row.classList.toggle('sel', c.checked);
    });
  }
  function clearSel() { $$('.tk-sel:checked').forEach(function (c) { c.checked = false; }); refreshBulk(); }
  async function applyBulk(btn) {
    var ids = selected();
    if (!ids.length) return;
    var patch = {};
    if (val('bk-status')) patch.status = val('bk-status');
    if (val('bk-priority')) patch.priority = val('bk-priority');
    if (val('bk-due')) patch.due_date = val('bk-due');
    if (val('bk-assignee')) patch.assignee_user_id = val('bk-assignee');
    if (!Object.keys(patch).length) { toast('حدّد ما تريد تغييره: الحالة أو الأولوية أو الموعد أو المسؤول', true); return; }
    btn.disabled = true;
    try {
      var r = await api('/tasks/bulk', 'PATCH', { ids: ids, patch: patch });
      var failed = (r.failed || []).length;
      toast(failed
        ? 'حُدِّثت ' + r.updated + ' مهمة، وتعذّر تحديث ' + failed + ': ' + ((r.failed[0] || {}).reason || '')
        : 'حُدِّثت ' + r.updated + ' مهمة ✓', !!failed);
      reload();
    } catch (e) { btn.disabled = false; toast(e.message, true); }
  }

  // ── سحب البطاقات بين أعمدة اللوح ──
  var dragCard = null;
  document.addEventListener('dragstart', function (e) {
    var c = e.target.closest ? e.target.closest('.tk-card') : null;
    if (!c) return;
    dragCard = c; c.classList.add('drag');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', c.dataset.task); } catch (x) { /* بعض المتصفحات تمنع الكتابة */ } }
  });
  document.addEventListener('dragend', function () {
    if (dragCard) dragCard.classList.remove('drag');
    $$('#tk-board .kcol.drop').forEach(function (c) { c.classList.remove('drop'); });
    dragCard = null;
  });
  document.addEventListener('dragover', function (e) {
    if (!dragCard) return;
    var col = e.target.closest ? e.target.closest('#tk-board .kcol') : null;
    if (!col) return;
    e.preventDefault(); col.classList.add('drop');
  });
  document.addEventListener('dragleave', function (e) {
    var col = e.target.closest ? e.target.closest('#tk-board .kcol') : null;
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop');
  });
  document.addEventListener('drop', async function (e) {
    var col = e.target.closest ? e.target.closest('#tk-board .kcol') : null;
    if (!col || !dragCard) return;
    e.preventDefault(); col.classList.remove('drop');
    var card = dragCard; dragCard = null;
    card.classList.remove('drag');
    var status = col.dataset.status;
    if (status === card.dataset.status) return;
    // التعطيل يحتاج سبباً مكتوباً — نفتح التفاصيل بدل إرسال طلب سيُرفض
    if (status === 'BLOCKED') { fillEditor(card, 'blocked', 'BLOCKED'); toast('اكتب سبب التعطيل ومن يستطيع رفعه'); return; }
    var body = col.querySelector('.kcol-body');
    if (body) { $$(':scope > .tk-kempty', body).forEach(function (p) { p.remove(); }); body.appendChild(card); }
    try {
      await api('/tasks/' + encodeURIComponent(card.dataset.task), 'PATCH', { status: status });
      toast('نُقلت إلى ' + ((col.querySelector('.t') || {}).textContent || '') + ' ✓');
      reload();
    } catch (err) { toast(err.message, true); reload(); }
  });

  // ── نقرة واحدة تُوجَّه من data-action ──
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    var act = el.dataset.action;
    var row = el.closest ? el.closest('[data-task]') : null;

    if (act === 'task-add') { e.preventDefault(); quickAdd(el); return; }
    if (act === 'task-open') {
      if (!row) return;
      e.preventDefault();
      fillEditor(row, el.dataset.focus || '');
      return;
    }
    if (act === 'task-close') { e.preventDefault(); closeEditor(); return; }
    if (act === 'task-save') { e.preventDefault(); saveEditor(el); return; }
    if (act === 'task-bulk') { e.preventDefault(); applyBulk(el); return; }
    if (act === 'task-bulk-clear') { e.preventDefault(); clearSel(); return; }
    if (act === 'task-done') {
      if (!row) return;
      e.preventDefault();
      el.disabled = true;
      api('/tasks/' + encodeURIComponent(row.dataset.task), 'PATCH', { status: 'DONE' })
        .then(function () { toast('أُنجزت المهمة ✓'); reload(); })
        .catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }
  });

  // ── تغيير الحالة من قائمة الصف ──
  var lastIdx = null;
  document.addEventListener('change', function (e) {
    var sel = e.target.closest ? e.target.closest('select[data-action="task-status"]') : null;
    if (sel) {
      var row = sel.closest('[data-task]');
      if (!row) return;
      if (sel.value === 'BLOCKED') {           // العائق يُكتب قبل أن تُقفل المهمة عليه
        sel.value = row.dataset.status || 'TODO';
        fillEditor(row, 'blocked', 'BLOCKED');
        return;
      }
      var v = sel.value;
      sel.disabled = true;
      api('/tasks/' + encodeURIComponent(row.dataset.task), 'PATCH', { status: v })
        .then(function () { toast('حُدّثت الحالة ✓'); reload(); })
        .catch(function (err) { sel.disabled = false; sel.value = row.dataset.status || 'TODO'; toast(err.message, true); });
      return;
    }
    var box = e.target.closest ? e.target.closest('.tk-sel') : null;
    if (box) {
      // تحديد مدى بالضغط على Shift — نمط الجداول المعتاد، يوفّر عشرين نقرة
      var all = $$('.tk-sel');
      var idx = all.indexOf(box);
      if (e.shiftKey && lastIdx != null && idx > -1) {
        var a = Math.min(lastIdx, idx), b = Math.max(lastIdx, idx);
        for (var i = a; i <= b; i++) all[i].checked = box.checked;
      }
      lastIdx = idx;
      refreshBulk();
    }
  });

  // ── Enter في حقل العنوان يضيف المهمة، وEsc يغلق المحرِّر ──
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && (e.target.id === 'qa-title' || e.target.id === 'qa-next')) {
      e.preventDefault();
      quickAdd(document.querySelector('[data-action="task-add"]'));
      return;
    }
    if (e.key === 'Escape' && editing) { closeEditor(); }
  });
})();
