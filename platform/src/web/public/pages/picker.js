// منتقٍ بالبحث فوق قائمة اختيار مخفيّة — يُستعمل حيث تطول القائمة حتى يصير التصفّح عبئاً.
// القيمة كلها في `<select>` خلفه: من يقرأها لا يعلم بوجود هذا الملف، ومن يكتبها برمجياً
// يستدعي `Sanad.pickerSync` فيتبعه الحقل المرئي. والبحث على الاسم **والرمز** معاً.
(function () {
  'use strict';
  var S = window.Sanad || (window.Sanad = {});
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // توحيد عربي بحرفٍ مقابل حرف: الطول يبقى كما هو فتصلح مواضع التظليل على النص الأصلي.
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىي]/g, 'ي').replace(/[ً-ْ]/g, '');
  }
  var MAX = 8;

  function parts(box) {
    return { sel: box.querySelector('select'), q: box.querySelector('.sp-q'), list: box.querySelector('.sp-list') };
  }
  // نصّ الخيار المختار كما يُعرض في الحقل — أو فراغ حين لا اختيار.
  function labelOf(sel) {
    var o = sel.options[sel.selectedIndex];
    return o && !o.disabled ? o.textContent.trim() : '';
  }
  function items(sel) {
    var out = [];
    Array.prototype.forEach.call(sel.options, function (o) {
      if (o.disabled) return;
      var grp = o.parentNode && o.parentNode.tagName === 'OPTGROUP' ? o.parentNode.label : '';
      out.push({ value: o.value, text: o.textContent.trim(), code: o.getAttribute('data-code') || '', group: grp });
    });
    return out;
  }
  function close(box) {
    var p = parts(box);
    p.list.hidden = true;
    p.q.setAttribute('aria-expanded', 'false');
    p.q.removeAttribute('aria-activedescendant');
  }
  function render(box, q) {
    var p = parts(box);
    var nq = norm(q);
    var all = items(p.sel);
    var hits = [];
    for (var i = 0; i < all.length; i++) {
      var it = all[i];
      var at = nq ? norm(it.text).indexOf(nq) : 0;
      // الرمز يُطابَق ولو لم يظهر في النص — ومن كتب رقمه وحده يجد مشروعه.
      if (at === -1 && nq && norm(it.code).indexOf(nq) !== -1) at = 0;
      if (at !== -1) hits.push({ it: it, at: at });
    }
    var shown = hits.slice(0, MAX);
    var html = '';
    var grp = null;
    shown.forEach(function (h, idx) {
      if (h.it.group !== grp) { grp = h.it.group; if (grp) html += '<div class="sp-grp">' + esc(grp) + '</div>'; }
      var t = h.it.text;
      var marked = nq && norm(t).indexOf(nq) !== -1
        ? esc(t.slice(0, h.at)) + '<b>' + esc(t.slice(h.at, h.at + q.length)) + '</b>' + esc(t.slice(h.at + q.length))
        : esc(t);
      html += '<button type="button" class="sp-row" role="option" aria-selected="false" id="' + esc(box.dataset.picker)
        + '-o' + idx + '" data-pick="' + esc(h.it.value) + '">' + marked + '</button>';
    });
    if (!shown.length) {
      html = '<div class="sp-empty">' + (all.length
        ? 'لا نتيجة تطابق ما كتبت — جرّب جزءاً من الاسم أو الرمز'
        : 'لا خيارات متاحة ضمن نطاقك بعد') + '</div>';
    } else if (hits.length > shown.length) {
      html += '<div class="sp-empty">و<span class="tnum">' + (hits.length - shown.length)
        + '</span> نتيجة أخرى — تابع الكتابة للتضييق</div>';
    }
    p.list.innerHTML = html;
    p.list.hidden = false;
    p.q.setAttribute('aria-expanded', 'true');
  }
  function active(box) { return box.querySelector('.sp-row.active'); }
  function setActive(box, row) {
    var p = parts(box);
    $$('.sp-row', p.list).forEach(function (r) { r.classList.remove('active'); r.setAttribute('aria-selected', 'false'); });
    if (!row) { p.q.removeAttribute('aria-activedescendant'); return; }
    row.classList.add('active');
    row.setAttribute('aria-selected', 'true');
    p.q.setAttribute('aria-activedescendant', row.id);
    if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }
  function pick(box, value) {
    var p = parts(box);
    p.sel.value = value;
    p.q.value = labelOf(p.sel);
    close(box);
    p.sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // يُعيد الحقل المرئي إلى ما تقوله القائمة المخفيّة — بعد أن تُكتب قيمتها برمجياً.
  S.pickerSync = function (idAttr, root) {
    var box = (root || document).querySelector('[data-picker="' + idAttr + '"]');
    if (!box) return;
    var p = parts(box);
    p.q.value = labelOf(p.sel);
  };
  S.pickerInit = function (root) {
    $$('[data-picker]', root || document).forEach(function (box) {
      if (box.dataset.spOn) return;
      box.dataset.spOn = '1';
      var p = parts(box);
      p.q.value = labelOf(p.sel);
    });
  };

  document.addEventListener('input', function (e) {
    var box = e.target.closest ? e.target.closest('.sp') : null;
    if (!box || !e.target.classList.contains('sp-q')) return;
    render(box, e.target.value.trim());
    setActive(box, box.querySelector('.sp-row'));
  });
  document.addEventListener('focusin', function (e) {
    var box = e.target.closest ? e.target.closest('.sp') : null;
    if (box && e.target.classList.contains('sp-q')) { render(box, ''); setActive(box, null); return; }
    // مغادرة المنتقي تُغلقه وتُعيد الحقل إلى المختار فعلاً — لا يبقى نصٌّ لم يُختر.
    $$('.sp').forEach(function (b) {
      if (b === box || b.querySelector('.sp-list').hidden) return;
      close(b);
      parts(b).q.value = labelOf(parts(b).sel);
    });
  });
  document.addEventListener('click', function (e) {
    var row = e.target.closest ? e.target.closest('.sp-row') : null;
    if (row) { e.preventDefault(); pick(row.closest('.sp'), row.dataset.pick); return; }
    if (!(e.target.closest && e.target.closest('.sp'))) {
      $$('.sp').forEach(function (b) {
        if (b.querySelector('.sp-list').hidden) return;
        close(b);
        parts(b).q.value = labelOf(parts(b).sel);
      });
    }
  });
  document.addEventListener('keydown', function (e) {
    var box = e.target.closest ? e.target.closest('.sp') : null;
    if (!box || !e.target.classList.contains('sp-q')) return;
    var p = parts(box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (p.list.hidden) render(box, p.q.value.trim());
      var rows = $$('.sp-row', p.list);
      if (!rows.length) return;
      var i = rows.indexOf(active(box));
      setActive(box, rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length + (i < 0 ? 1 : 0)) % rows.length]);
    } else if (e.key === 'Enter') {
      var a = active(box);
      if (a) { e.preventDefault(); pick(box, a.dataset.pick); }
    }
  });
  // Escape في مرحلة الالتقاط: يُغلق القائمة وحدها قبل أن يُغلق اللوحُ الجانبي كلَّه فوقها،
  // ولا يبتلع الحدث إلا إن أغلق شيئاً فعلاً.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var closed = false;
    $$('.sp').forEach(function (b) {
      if (b.querySelector('.sp-list').hidden) return;
      close(b);
      parts(b).q.value = labelOf(parts(b).sel);
      closed = true;
    });
    if (closed) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  S.pickerInit();
})();
