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

  // «p:معرّف» مشروع · «o:معرّف» فرصة · «me» مهمة شخصية · فارغ = عمل داخلي.
  // نوعُ العمل يُرسَل صراحةً في الحالتين الأخيرتين: بدونه يقرأ الخادم «بلا جهة» فيكتب «داخلي»
  // على الحالتين معاً — فتنقلب المهمة الشخصية عملاً للشركة بمجرد فتح تفاصيلها وحفظها،
  // وتصير مقروءةً لمديرها بلا أن يطلب ذلك أحد ولا يظهر التحوّل في أي مكان.
  function parentPatch(raw) {
    var v = String(raw || '');
    if (v.indexOf('p:') === 0) return { project_id: v.slice(2), opportunity_id: null };
    if (v.indexOf('o:') === 0) return { opportunity_id: v.slice(2), project_id: null };
    if (v === 'me') return { work_kind: 'personal', project_id: null, opportunity_id: null };
    return { work_kind: 'internal', project_id: null, opportunity_id: null };
  }
  function parentValue(row) {
    if (row.dataset.project) return 'p:' + row.dataset.project;
    if (row.dataset.opp) return 'o:' + row.dataset.opp;
    if (row.dataset.kind === 'personal') return 'me';
    return '';
  }

  // ── تصنيف المهمة: قائمة جاهزة أو «أخرى…» بحقل حر ──
  // القيمة المرسَلة: مفتاح القائمة كما هو، أو النص الحر حين يُختار «أخرى…»، أو فراغ (بلا تصنيف).
  function categoryValue(sel, other) {
    if (!sel) return null;
    var v = String(sel.value || '');
    if (v === '__other') return (other && String(other.value || '').trim()) || null;
    return v || null;
  }
  // يملأ القائمة من قيمة مخزَّنة: مفتاحٌ معروف يُختار مباشرة، ونصٌّ حر يفتح «أخرى…» ويكتبه.
  function setCategory(sel, other, v) {
    if (!sel) return;
    var val = String(v || '');
    var known = !val || Array.prototype.some.call(sel.options, function (o) { return o.value === val; });
    if (known) {
      sel.value = val;
      if (other) { other.hidden = true; other.value = ''; }
    } else {
      sel.value = '__other';
      if (other) { other.hidden = false; other.value = val; }
    }
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
    // الجهة تُرسَل كاملةً دائماً — الرابطان صراحةً (ولو فراغاً) ونوعُ العمل حين تُقرّره القائمة.
    // كان الفراغ لا يُرسل شيئاً، فيقرأ الخادم «بلا نوع» ويكتب قيمته الافتراضية «مشروع» على
    // مهمةٍ داخلية بلا مشروع — كذبة صامتة في الصف يقرؤها كل تقرير يثق بالنوع.
    var p = parentPatch(val('qa-parent'));
    body.project_id = p.project_id || null;
    body.opportunity_id = p.opportunity_id || null;
    if (p.work_kind) body.work_kind = p.work_kind;
    body.category = categoryValue(document.getElementById('qa-category'), document.getElementById('qa-category-other'));
    var who = val('qa-assignee');
    // المهمة الشخصية لصاحبها وحده — يردّها الخادم لو أُسندت لغيره، فلا تُرسَل أصلاً.
    if (who && p.work_kind !== 'personal') body.assignee_user_id = who;
    if (btn) btn.disabled = true;
    try {
      // «أُضيفت» تعني أُضيفت: المهمة المرتبطة بمشروع أو فرصة قد تعود معلَّقة بانتظار المدير،
      // وقولُ «أُضيفت ✓» عنها كذبةٌ صغيرة تُنتج سؤالاً كبيراً حين لا يجدها صاحبها في المشروع.
      var added = await api('/tasks/quick', 'POST', body);
      toast(added && added.approval_state === 'PENDING'
        ? 'أُرسلت إلى مديرك للاعتماد — تظهر في عملك بعد اعتمادها' : 'أُضيفت المهمة ✓');
      // المهمة تُضاف ثم **تختفي**: النافذة الافتراضية «اليوم»، ومهمةٌ بلا موعد ليست فيها —
      // فيرى المستخدم رسالة نجاح وقائمةً لم تتغيّر، وهو أسوأ ما تفعله شاشة إضافة. تُنقَل
      // النافذة إلى ما يسع المهمة الجديدة: موعدُها إن كان اليوم أو قبله فـ«اليوم» تكفي،
      // وإلا «الكل» — فيراها حيث وضعها.
      var due = body.due_date;
      var today = new Date().toISOString().slice(0, 10);
      if (!due || due > today) {
        var u = new URL(location.href);
        u.searchParams.set('win', 'all');
        setTimeout(function () { location.assign(u.toString()); }, 320);
        return;
      }
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
    setCategory($('[data-f="category"]', d), $('[data-f="category-other"]', d), row.dataset.category || '');
    set('assignee', row.dataset.assignee || '');
    set('dept', row.dataset.dept || '');
    // من أين جاءت المهمة: من أسندها (إن كان غير صاحبها) ومن اعتمدها — نصٌّ للقراءة لا للتحرير.
    var showC = !!row.dataset.creatorName && !!row.dataset.creator && row.dataset.creator !== row.dataset.assignee;
    var showA = !!row.dataset.approverName;
    var pc = $('[data-f="prov-creator"]', d), pa = $('[data-f="prov-approver"]', d), pw = $('[data-f="provenance"]', d);
    if (pc) {
      pc.hidden = !showC;
      var pcn = $('[data-f="prov-creator-name"]', d);
      if (pcn) pcn.textContent = row.dataset.creatorName || '';
    }
    if (pa) {
      pa.hidden = !showA;
      var pan = $('[data-f="prov-approver-name"]', d);
      if (pan) pan.textContent = row.dataset.approverName || '';
      var pad = $('[data-f="prov-approved-at"]', d);
      if (pad) pad.textContent = row.dataset.approvedAt || '';
    }
    if (pw) pw.hidden = !showC && !showA;
    // زر الحذف يظهر لمن يملكه فعلاً: كاتب المهمة، أو صاحب الشخصية، أو من له صلاحية حذف إدارية.
    var st = window.__SANAD || {};
    var del = $('[data-f="delete"]', d);
    if (del) {
      var mine = !!st.uid && (row.dataset.creator === st.uid
        || (row.dataset.kind === 'personal' && row.dataset.assignee === st.uid));
      del.hidden = !(mine || st.canDelAnyTask);
    }
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
    var personal = false;
    var pv = $('[data-f="parent"]', d);
    if (pv) {
      var p = parentPatch(pv.value);
      patch.project_id = p.project_id; patch.opportunity_id = p.opportunity_id;
      if (p.work_kind) patch.work_kind = p.work_kind;
      personal = p.work_kind === 'personal';
    }
    var av = $('[data-f="assignee"]', d);
    // مهمةٌ تبقى شخصية لا تُسنَد إلى غير صاحبها — والخادم يردّها. لا يُرسَل الحقل أصلاً.
    if (av && !personal) patch.assignee_user_id = av.value || null;
    var dv = $('[data-f="dept"]', d);
    if (dv) patch.department_id = dv.value || null;
    var cv = $('[data-f="category"]', d);
    if (cv) patch.category = categoryValue(cv, $('[data-f="category-other"]', d));
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
    // إعادة فتح مهمة منجزة: النقر على دائرتها يعيدها إلى «بانتظار البدء» ويمحو ختم إنجازها.
    if (act === 'task-reopen') {
      if (!row) return;
      e.preventDefault();
      el.disabled = true;
      api('/tasks/' + encodeURIComponent(row.dataset.task), 'PATCH', { status: 'TODO' })
        .then(function () { toast('أُعيد فتح المهمة'); reload(); })
        .catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }
    // حذف المهمة المفتوحة في المحرِّر — بعد سؤال صريح، فالحذف لا يُستدرَك من الشاشة.
    if (act === 'task-delete') {
      e.preventDefault();
      if (!editing) return;
      if (!window.confirm('حذف هذه المهمة نهائياً من قوائمك؟')) return;
      el.disabled = true;
      api('/tasks/' + encodeURIComponent(editing), 'DELETE')
        .then(function () { toast('حُذفت المهمة'); closeEditor(); reload(); })
        .catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }
  });

  // ── تغيير الحالة من قائمة الصف ──
  var lastIdx = null;
  document.addEventListener('change', function (e) {
    // «أخرى…» في قائمة التصنيف تفتح الحقل الحر الملاصق لها، وأي اختيار آخر يطويه ويمسحه.
    var cat = e.target.closest ? e.target.closest('select.tk-cat') : null;
    if (cat) {
      var other = cat.nextElementSibling && cat.nextElementSibling.classList.contains('tk-cat-other')
        ? cat.nextElementSibling : null;
      if (other) {
        other.hidden = cat.value !== '__other';
        if (cat.value !== '__other') other.value = '';
        else other.focus();
      }
      return;
    }
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
