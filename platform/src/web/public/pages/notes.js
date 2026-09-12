// دفتر الملاحظات — تفويض أحداث فقط، بلا أي مُعالِج داخل السمات (onclick).
// ما تديره هذه الطبقة: كتابة ملاحظة جديدة، وتعديلها في اللوح الجانبي، وتثبيتها، وحذفها.
// لا تعدّل app.js ولا تعتمد على دوالّه إلا على اللوح الجانبي المشترك (فتحاً وإغلاقاً).
(function () {
  'use strict';

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
  var val = function (id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };

  // ── ملاحظة جديدة ──
  async function addNote(btn) {
    var subject = val('nn-subject');
    // الرسالة تقول ما يُكتب لا أن الحقل فارغ — والمؤشّر يذهب إلى الحقل نفسه بدل أن يبحث عنه.
    if (!subject) {
      toast('اكتب موضوع الملاحظة أولاً — كلمتان تكفيان لتجدها لاحقاً', true);
      var s = document.getElementById('nn-subject');
      if (s) s.focus();
      return;
    }
    var body = { subject: subject, body: val('nn-body') || null, note_date: val('nn-day') || null };
    if (btn) btn.disabled = true;
    try {
      await api('/notes', 'POST', body);
      toast('حُفظت الملاحظة ✓');
      reload();
    } catch (e) { if (btn) btn.disabled = false; toast(e.message, true); }
  }

  // ── تعديل ملاحظة (لوح جانبي) ──
  var editing = null;
  function openEditor(card) {
    var tpl = document.getElementById('nt-editor');
    if (!tpl || !window.Sanad || !window.Sanad.openDrawer) { toast('تعذّر فتح الملاحظة — حدّث الصفحة', true); return; }
    window.Sanad.openDrawer(tpl.innerHTML);
    var d = document.getElementById('drawer');
    editing = card.dataset.note;
    var set = function (f, v) { var el = $('[data-f="' + f + '"]', d); if (el) el.value = v == null ? '' : v; return el; };
    set('subject', card.dataset.subject);
    set('body', card.dataset.body);
    set('day', card.dataset.day);
    var first = $('[data-f="subject"]', d);
    if (first) { first.focus(); if (first.select) first.select(); }
  }
  function closeEditor() { editing = null; if (window.Sanad && window.Sanad.closeDrawer) window.Sanad.closeDrawer(); }

  async function saveEditor(btn) {
    var d = document.getElementById('drawer');
    if (!d || !editing) return;
    var g = function (f) { var el = $('[data-f="' + f + '"]', d); return el ? String(el.value || '').trim() : ''; };
    var subject = g('subject');
    var err = $('[data-f="error"]', d);
    if (err) err.hidden = true;
    if (!subject) {
      if (err) { err.textContent = 'اكتب موضوع الملاحظة — كلمتان تكفيان لتجدها لاحقاً'; err.hidden = false; }
      return;
    }
    btn.disabled = true; var old = btn.textContent; btn.textContent = 'جارٍ الحفظ…';
    try {
      await api('/notes/' + encodeURIComponent(editing), 'PATCH',
        { subject: subject, body: g('body') || null, note_date: g('day') || null });
      toast('حُفظت التغييرات ✓');
      closeEditor(); reload();
    } catch (e) {
      btn.disabled = false; btn.textContent = old;
      if (err) { err.textContent = e.message; err.hidden = false; }
      toast(e.message, true);
    }
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    var act = el.dataset.action;
    var card = el.closest ? el.closest('[data-note]') : null;

    if (act === 'note-add') { e.preventDefault(); addNote(el); return; }
    if (act === 'note-close') { e.preventDefault(); closeEditor(); return; }
    if (act === 'note-save') { e.preventDefault(); saveEditor(el); return; }
    if (act === 'note-edit') { if (!card) return; e.preventDefault(); openEditor(card); return; }
    if (act === 'note-pin') {
      if (!card) return;
      e.preventDefault();
      el.disabled = true;
      var on = card.dataset.pinned !== '1';
      api('/notes/' + encodeURIComponent(card.dataset.note), 'PATCH', { pinned: on })
        .then(function () { toast(on ? 'ثُبِّتت في الأعلى ✓' : 'أُلغي التثبيت ✓'); reload(); })
        .catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }
    if (act === 'note-del') {
      if (!card) return;
      e.preventDefault();
      // الحذف يُسأل عنه مرة واحدة باسم الملاحظة: نقرةٌ بالخطأ على أيقونة صغيرة تمحو ما كُتب
      // في عشر دقائق، والسؤال يكلّف ثانية.
      var name = card.dataset.subject || '';
      if (!window.confirm('حذف الملاحظة «' + name + '»؟ لن تظهر في دفترك بعدها.')) return;
      el.disabled = true;
      api('/notes/' + encodeURIComponent(card.dataset.note), 'DELETE')
        .then(function () { toast('حُذفت الملاحظة ✓'); reload(); })
        .catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }
  });

  // Esc يغلق المحرِّر — نفس ما تفعله بقية الألواح الجانبية في المنصة.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && editing) closeEditor();
  });
})();
