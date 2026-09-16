// ── إعدادات لوحة الفرص: طبقة المتصفح ──────────────────────────────────────────────────────
// قاعدتان تحكمان هذا الملف:
//   ١) لا وسمَ يُركَّب هنا من نصٍّ كتبه مستخدم. النماذج كلها مبنيّة على الخادم داخل <template>
//      خاملة ومهروبةِ النصوص، وما نفعله هنا فتحُها لا تأليفُها.
//   ٢) لا نجاحَ يُعلَن قبل ردّ الخادم، ولا رسالةَ خطأ تُستبدل بجملة عامة: رسالة الخدمة تُعرض
//      بنصّها في النموذج نفسه وعلى شريط الحالة — هي التي تقول ما ينقص وكيف يُستدرك.
(function () {
  'use strict';

  var api = function (path, method, body) {
    return fetch('/api' + path, {
      method: method || 'GET',
      credentials: 'include',
      headers: Object.assign({ 'X-Requested-With': 'fetch' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 401) { location.reload(); return new Promise(function () {}); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j && j.error && j.error.message) || 'تعذّر إتمام العملية — أعد المحاولة بعد قليل.');
        return j;
      });
    });
  };

  var toast = function (msg, bad) {
    if (window.Sanad && typeof window.Sanad.toast === 'function') return window.Sanad.toast(msg, bad);
    var d = document.createElement('div');
    d.textContent = msg; d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;'
      + 'font-size:13px;max-width:min(92vw,420px);line-height:1.7;box-shadow:0 8px 24px rgba(0,0,0,.2);background:'
      + (bad ? '#b91c1c' : '#047857');
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, bad ? 6000 : 2600);
    return undefined;
  };

  // شريط الحالة الملتصق أعلى الشاشة: جارٍ / تمّ / تعذّر — نصٌّ لا وسم.
  var statusEl = function () { return document.getElementById('cbs-status'); };
  var say = function (text, kind) {
    var el = statusEl();
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.className = 'alert ' + (kind === 'bad' ? 'err' : kind === 'ok' ? 'ok' : 'info') + ' cbs-status';
    el.textContent = text;
    el.hidden = false;
  };

  // ── النوافذ ───────────────────────────────────────────────────────────────────────────
  var openTemplate = function (id) {
    var t = document.getElementById(id);
    if (!t || !window.Sanad || typeof window.Sanad.openModal !== 'function') return;
    window.Sanad.openModal(t.innerHTML);
    var first = document.querySelector('#modal .modal-body input:not([type=hidden]), #modal .modal-body select, #modal .modal-body textarea');
    if (first) { try { first.focus(); } catch (e) { /* تركيزٌ لا يقع لا يمنع فتح النافذة */ } }
  };
  var closeModal = function () { if (window.Sanad && window.Sanad.closeModal) window.Sanad.closeModal(); };

  var showFormError = function (form, message) {
    var box = form.querySelector('[data-role="err"]');
    if (box) { box.textContent = message; box.hidden = false; }
    var body = form.querySelector('.modal-body');
    if (body) body.scrollTop = 0;
  };
  var setBusy = function (form, on, label) {
    var btn = form.querySelector('[data-role="save"]');
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.dataset.label || btn.textContent;
      btn.textContent = label || 'جارٍ الحفظ…';
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    } else {
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  };

  var val = function (form, name) {
    var el = form.elements[name];
    return el ? String(el.value == null ? '' : el.value).trim() : '';
  };

  // احتمال الفوز يُرسل نصّاً كما كُتب: الفراغ فراغٌ مقصود («لا تُفرض نسبة») ولا يُحوَّل صفراً.
  var stagePayload = function (form) {
    var outcome = val(form, 'outcome');
    return {
      name_ar: val(form, 'name_ar'),
      description_ar: val(form, 'description_ar'),
      color: val(form, 'color'),
      default_win_pct: val(form, 'default_win_pct'),
      board_id: val(form, 'board_id'),
      is_won: outcome === 'won',
      is_lost: outcome === 'lost',
    };
  };

  var SUBMITS = {
    stage: function (form) {
      var id = form.dataset.id;
      return {
        busy: 'جارٍ حفظ المرحلة…',
        done: id ? 'حُفظت المرحلة' : 'أُضيفت المرحلة',
        run: function () {
          return id ? api('/crm/stages/' + encodeURIComponent(id), 'PATCH', stagePayload(form))
            : api('/crm/stages', 'POST', stagePayload(form));
        },
      };
    },
    board: function (form) {
      var id = form.dataset.id;
      var body = { name_ar: val(form, 'name_ar'), description_ar: val(form, 'description_ar') };
      return {
        busy: 'جارٍ حفظ اللوحة…',
        done: id ? 'حُفظت اللوحة' : 'أُضيفت اللوحة',
        run: function () {
          return id ? api('/crm/boards/' + encodeURIComponent(id), 'PATCH', body) : api('/crm/boards', 'POST', body);
        },
      };
    },
    tag: function (form) {
      var id = form.dataset.id;
      var body = { name_ar: val(form, 'name_ar'), color: val(form, 'color'), description_ar: val(form, 'description_ar') };
      return {
        busy: 'جارٍ حفظ التصنيف…',
        done: id ? 'حُفظ التصنيف' : 'أُضيف التصنيف',
        run: function () {
          return id ? api('/crm/tags/' + encodeURIComponent(id), 'PATCH', body) : api('/crm/tags', 'POST', body);
        },
      };
    },
    'stage-delete': function (form) {
      var dest = val(form, 'moveToStageId');
      return {
        busy: 'جارٍ نقل الفرص وحذف المرحلة…',
        done: dest ? 'نُقلت الفرص وحُذفت المرحلة' : 'حُذفت المرحلة',
        run: function () {
          return api('/crm/stages/' + encodeURIComponent(form.dataset.id), 'DELETE', { moveToStageId: dest || null });
        },
      };
    },
    'board-delete': function (form) {
      var dest = val(form, 'moveStagesTo');
      return {
        busy: 'جارٍ حذف اللوحة…',
        done: dest ? 'نُقلت المراحل وحُذفت اللوحة' : 'حُذفت اللوحة',
        run: function () {
          return api('/crm/boards/' + encodeURIComponent(form.dataset.id), 'DELETE', { moveStagesTo: dest || null });
        },
      };
    },
    'tag-delete': function (form) {
      return {
        busy: 'جارٍ حذف التصنيف…',
        done: 'حُذف التصنيف',
        run: function () { return api('/crm/tags/' + encodeURIComponent(form.dataset.id), 'DELETE'); },
      };
    },
  };

  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (!form || !form.dataset || !form.dataset.form) return;
    var make = SUBMITS[form.dataset.form];
    if (!make) return;
    ev.preventDefault();
    if (form.dataset.busy === '1') return;
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
    var job = make(form);
    var box = form.querySelector('[data-role="err"]');
    if (box) { box.hidden = true; box.textContent = ''; }
    form.dataset.busy = '1';
    setBusy(form, true, job.busy);
    say(job.busy);
    job.run().then(function () {
      say(job.done + ' — تُحدَّث الشاشة الآن.', 'ok');
      toast(job.done);
      closeModal();
      setTimeout(function () { location.reload(); }, 350);
    }).catch(function (e) {
      form.dataset.busy = '';
      setBusy(form, false);
      showFormError(form, e.message);
      say(e.message, 'bad');
      toast(e.message, true);
    });
  });

  // ── الأرشفة والإعادة: فعلٌ مباشر من الصفّ، ورسالة الرفض تُقال كما جاءت ────────────────────
  var archive = function (btn) {
    if (btn.disabled) return;
    var on = btn.dataset.on === '1';
    btn.disabled = true;
    say(on ? 'جارٍ أرشفة المرحلة…' : 'جارٍ إعادة المرحلة…');
    api('/crm/stages/' + encodeURIComponent(btn.dataset.id), 'PATCH', { archived: on }).then(function () {
      var done = on ? 'أُرشفت المرحلة — سجلّها وفرصها كما هي' : 'عادت المرحلة إلى اللوحة';
      say(done, 'ok');
      toast(done);
      setTimeout(function () { location.reload(); }, 350);
    }).catch(function (e) {
      btn.disabled = false;
      say(e.message, 'bad');
      toast(e.message, true);
    });
  };

  // ── الترتيب: نداءٌ واحد بكل القائمة، ورجوعٌ إلى ما كان إن رُدَّ ────────────────────────────
  var idsOf = function (list) {
    return Array.prototype.map.call(list.querySelectorAll('[data-stage]'), function (li) { return li.dataset.stage; });
  };
  var saveOrder = function (list, before) {
    var order = idsOf(list);
    if (order.join('|') === before.join('|')) return;
    say('جارٍ حفظ الترتيب…');
    api('/crm/stages/reorder', 'POST', { order: order }).then(function () {
      say('حُفظ ترتيب المراحل', 'ok');
      refreshMoveButtons(list);
    }).catch(function (e) {
      // الرجوع إلى الترتيب الذي كان: الشاشة لا تُظهر ترتيباً لم يُحفظ.
      before.forEach(function (id) {
        var li = list.querySelector('[data-stage="' + id.replace(/"/g, '\\"') + '"]');
        if (li) list.appendChild(li);
      });
      refreshMoveButtons(list);
      say(e.message + ' — أُعيد الترتيب كما كان.', 'bad');
      toast(e.message, true);
    });
  };
  var refreshMoveButtons = function (list) {
    var rows = list.querySelectorAll('[data-stage]');
    Array.prototype.forEach.call(rows, function (li, i) {
      var up = li.querySelector('[data-action="cbs-move"][data-dir="up"]');
      var down = li.querySelector('[data-action="cbs-move"][data-dir="down"]');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === rows.length - 1;
    });
  };
  var move = function (btn) {
    var li = btn.closest('[data-stage]');
    var list = li && li.closest('[data-stages]');
    if (!li || !list) return;
    var before = idsOf(list);
    if (btn.dataset.dir === 'up' && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
    else if (btn.dataset.dir === 'down' && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
    else return;
    saveOrder(list, before);
    var again = li.querySelector('[data-action="cbs-move"][data-dir="' + btn.dataset.dir + '"]');
    if (again && !again.disabled) { try { again.focus(); } catch (e) { /* لا شيء يتوقف على التركيز */ } }
  };

  var dragged = null;
  var dragOrigin = null;
  document.addEventListener('dragstart', function (ev) {
    var li = ev.target && ev.target.closest ? ev.target.closest('.cbs-stage[draggable="true"]') : null;
    if (!li) return;
    dragged = li;
    dragOrigin = idsOf(li.closest('[data-stages]') || li.parentElement);
    li.classList.add('cbs-drag');
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', li.dataset.stage); } catch (e) { /* متصفّح لا يقبل النوع */ }
    }
  });
  document.addEventListener('dragover', function (ev) {
    if (!dragged) return;
    var over = ev.target && ev.target.closest ? ev.target.closest('.cbs-stage') : null;
    var list = dragged.closest('[data-stages]');
    if (!over || !list || over === dragged || over.parentElement !== list) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    var box = over.getBoundingClientRect();
    var after = (ev.clientY - box.top) > box.height / 2;
    list.insertBefore(dragged, after ? over.nextElementSibling : over);
    Array.prototype.forEach.call(list.querySelectorAll('.cbs-over'), function (x) { x.classList.remove('cbs-over'); });
    over.classList.add('cbs-over');
  });
  document.addEventListener('drop', function (ev) { if (dragged) ev.preventDefault(); });
  document.addEventListener('dragend', function () {
    if (!dragged) return;
    var list = dragged.closest('[data-stages]');
    dragged.classList.remove('cbs-drag');
    Array.prototype.forEach.call(document.querySelectorAll('.cbs-over'), function (x) { x.classList.remove('cbs-over'); });
    if (list && dragOrigin) saveOrder(list, dragOrigin);
    dragged = null; dragOrigin = null;
  });

  // ── التفويض ───────────────────────────────────────────────────────────────────────────
  document.addEventListener('click', function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
    if (!el) return;
    var a = el.dataset.action;
    if (a === 'cbs-open') { ev.preventDefault(); openTemplate('tpl-' + el.dataset.tpl); return; }
    if (a === 'cbs-dd') { ev.preventDefault(); openTemplate('dd-' + el.dataset.dd); return; }
    if (a === 'cbs-close') { ev.preventDefault(); closeModal(); return; }
    if (a === 'cbs-archive') { ev.preventDefault(); archive(el); return; }
    if (a === 'cbs-move') { ev.preventDefault(); move(el); }
  });
})();
