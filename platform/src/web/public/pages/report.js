// «أبلغ» — النافذة التي تُفتح من زر الترويسة، وهو **بابها الوحيد** في المنصة كلها.
// تُبنى من الخادم (`GET /api/products/feedback/form`) فلا تُكتب خياراتها هنا مرتين: نوع البلاغ،
// ودرجة الإلحاح بصياغة الأثر («يعطّل عملي» لا «عالٍ»)، وحدّ الصور.
//
// ومعناه واحدٌ لا يتغيّر بالشاشة التي يقف عليها: بلاغٌ عن **سند** نفسها. فلا يُكرَّر هذا الزر
// داخل شاشة منتجٍ آخر — لأنه يُفهم هناك أنه يسجّل في ذلك المنتج وهو لا يفعل؛ والتسجيل في منتجٍ
// بعينه بابُه «سجّل عن غيرك» في شاشته.
//
// «أين حدث» إلزامي، ويُملأ مسبقاً باسم الشاشة التي فُتحت منها النافذة — لأن زر الترويسة يعرف
// أين يقف المُبلِّغ.
//
// هذا الملف عام: يُحمَّل مع كل صفحة من الهيكل، ويتولّى كذلك زرّ الطباعة في صفحة التقرير.
(function () {
  'use strict';

  var MAX_IMAGES = 5;
  var MAX_BYTES = 8 * 1024 * 1024;
  var shots = [];          // {file, name}
  var form = null;         // ما أرسله الخادم من خيارات
  var busy = false;

  var $ = function (id) { return document.getElementById(id); };
  var SN = function () { return window.Sanad || {}; };
  var esc = function (s) {
    var f = SN().esc;
    if (f) return f(s);
    return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };

  function toast(msg, bad) {
    var d = document.createElement('div');
    d.textContent = msg;
    d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:300;padding:10px 16px;border-radius:10px;color:#fff;'
      + 'font-size:13px;max-width:min(92vw,420px);line-height:1.7;box-shadow:0 8px 24px rgba(0,0,0,.2);background:'
      + (bad ? '#b91c1c' : '#047857');
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, bad ? 5200 : 3200);
  }

  function api(path, method, body) {
    return fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' } : { 'X-Requested-With': 'fetch' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 401) { location.reload(); return new Promise(function () {}); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j.error && j.error.message) || 'تعذّر إتمام العملية — أعد المحاولة');
        return j;
      });
    });
  }

  function postBytes(path, blob, headers) {
    var h = { 'Content-Type': blob.type || 'application/octet-stream', 'X-Requested-With': 'fetch' };
    for (var k in headers) if (Object.prototype.hasOwnProperty.call(headers, k)) h[k] = headers[k];
    return fetch('/api' + path, { method: 'POST', credentials: 'include', headers: h, body: blob })
      .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : Promise.reject(new Error('تعذّر رفع الصورة')); });
  }

  // ── بناء النافذة ────────────────────────────────────────────────────────
  function optionCards(list, name, chosen) {
    return (list || []).map(function (o, i) {
      var on = chosen ? o.value === chosen : i === 0;
      return '<label class="rp-opt' + (on ? ' on' : '') + '">'
        + '<input type="radio" name="' + esc(name) + '" value="' + esc(o.value) + '"' + (on ? ' checked' : '') + '>'
        + '<b>' + esc(o.label) + '</b>'
        + (o.hint ? '<span>' + esc(o.hint) + '</span>' : '')
        + '</label>';
    }).join('');
  }
  var F = function (k, prop, dflt) {
    var f = (form.fields || {})[k] || {};
    return f[prop] == null ? dflt : f[prop];
  };

  function modalHtml(pageTitle) {
    return '<style>'
      + '.rp-b{padding:1rem 1.15rem;display:grid;gap:.75rem;max-height:70vh;overflow:auto}'
      + '.rp-b label.f{display:block;font-size:12px;font-weight:800;color:#334155;margin-bottom:.3rem}'
      + '.rp-opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.5rem}'
      + '.rp-opt{border:1px solid #e2e8f0;border-radius:11px;padding:.6rem .75rem;cursor:pointer;background:#fff}'
      + '.rp-opt.on{border-color:#244A99;box-shadow:0 0 0 2px rgba(36,74,153,.12)}'
      + '.rp-opt input{position:absolute;opacity:0;width:0;height:0}'
      + '.rp-opt b{display:block;font-size:12.5px;font-weight:800;color:#1e293b}'
      + '.rp-opt span{display:block;font-size:11.5px;color:#64748b;margin-top:.15rem}'
      + '.rp-drop{border:1.5px dashed #cbd5e1;border-radius:11px;padding:.8rem;text-align:center;font-size:12px;color:#64748b}'
      + '.rp-drop.on{border-color:#244A99;background:#f5f8ff}'
      + '.rp-shots{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}'
      + '.rp-shots figure{margin:0;position:relative}'
      + '.rp-shots img{width:74px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0}'
      + '.rp-shots button{position:absolute;top:-6px;left:-6px;background:#b91c1c;color:#fff;border:none;border-radius:99px;width:20px;height:20px;cursor:pointer;font-size:12px;line-height:1}'
      + '.rp-ok{padding:2rem 1.4rem;text-align:center}'
      + '.rp-ok .k{font-size:20px;font-weight:800;color:#244A99;unicode-bidi:isolate}'
      + '</style>'
      + '<div class="modal-head"><div style="font-weight:800;font-size:15px">' + esc(form.title || 'أبلغ') + '</div>'
      + '<button type="button" class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>'
      + '<div class="rp-b" id="rp-body">'
      + (form.lead ? '<div style="font-size:12px;color:#64748b;line-height:1.9">' + esc(form.lead) + '</div>' : '')
      + '<div><label class="f">ما نوع البلاغ؟</label><div class="rp-opts" id="rp-types">' + optionCards(form.types, 'rp-type') + '</div></div>'
      + '<div><label class="f" for="rp-title">' + esc(F('title', 'label', 'عنوان مختصر')) + '</label>'
      + '<input class="input" id="rp-title" maxlength="' + Number(F('title', 'max', 200)) + '" required placeholder="' + esc(F('title', 'placeholder', '')) + '"></div>'
      + '<div><label class="f" for="rp-where">' + esc(F('where_text', 'label', 'أين حدث هذا؟')) + '</label>'
      + '<input class="input" id="rp-where" maxlength="' + Number(F('where_text', 'max', 200)) + '" required value="' + esc(pageTitle || '') + '" placeholder="' + esc(F('where_text', 'placeholder', '')) + '"></div>'
      + '<div><label class="f" for="rp-desc">' + esc(F('description', 'label', 'اشرح ما حدث')) + '</label>'
      + '<textarea class="input" id="rp-desc" rows="4" maxlength="' + Number(F('description', 'max', 6000)) + '" placeholder="' + esc(F('description', 'placeholder', '')) + '"></textarea></div>'
      + '<div><label class="f">' + esc((form.urgency || {}).label || 'كم يؤثّر هذا على عملك؟') + '</label>'
      + '<div class="rp-opts" id="rp-urg">' + optionCards((form.urgency || {}).options, 'rp-urg', (form.urgency || {}).default) + '</div></div>'
      + '<div><label class="f">' + esc((form.images || {}).label || 'صور توضّح ما حدث') + '</label>'
      + '<div class="rp-drop" id="rp-drop" tabindex="0" role="button" aria-label="أضف صورة — الصقها أو أفلتها هنا">'
      + 'الصق الصورة هنا أو أفلتها — أو اختر ملفاً</div>'
      + '<input type="file" id="rp-file" accept="image/*" multiple hidden>'
      + '<div class="rp-shots" id="rp-shots"></div></div>'
      + '</div>'
      + '<div class="modal-foot"><button type="button" class="btn btn-primary" data-action="rp-send">' + esc(form.submit || 'أرسِل') + '</button>'
      + '<button type="button" class="btn" data-action="modal-close">إلغاء</button></div>';
  }

  function open(pageTitle) {
    if (busy) return;
    busy = true;
    api('/products/feedback/form').then(function (j) {
      form = j.form || j;
      MAX_IMAGES = Number((form.images || {}).limit) || 5;
      shots = [];
      var sn = SN();
      if (!sn.openModal) { toast('تعذّر فتح نافذة البلاغ — أعد تحميل الصفحة', true); return; }
      sn.openModal(modalHtml(pageTitle));
      wire();
    }).catch(function (e) {
      toast(e.message || 'تعذّر فتح نافذة البلاغ', true);
    }).then(function () { busy = false; });
  }

  function wire() {
    var drop = $('rp-drop'), file = $('rp-file');
    if (!drop) return;
    drop.addEventListener('click', function () { if (file) file.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (file) file.click(); } });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('on'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('on'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('on');
      addFiles(e.dataTransfer && e.dataTransfer.files);
    });
    if (file) file.addEventListener('change', function () { addFiles(file.files); file.value = ''; });
    document.addEventListener('paste', onPaste);
    // اختيار البطاقات يُظهر الإطار المحدَّد (الزرّ نفسه مخفيّ لقارئ العين لا لقارئ الشاشة).
    ['rp-types', 'rp-urg'].forEach(function (id) {
      var box = $(id);
      if (!box) return;
      box.addEventListener('change', function () {
        Array.prototype.forEach.call(box.querySelectorAll('.rp-opt'), function (l) {
          var r = l.querySelector('input');
          l.classList.toggle('on', !!(r && r.checked));
        });
      });
    });
  }

  function onPaste(e) {
    if (!$('rp-drop')) { document.removeEventListener('paste', onPaste); return; }
    var items = (e.clipboardData && e.clipboardData.items) || [];
    var files = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && /^image\//.test(items[i].type)) files.push(items[i].getAsFile());
    }
    if (files.length) { e.preventDefault(); addFiles(files); }
  }

  function addFiles(list) {
    var arr = Array.prototype.slice.call(list || []);
    for (var i = 0; i < arr.length; i++) {
      var f = arr[i];
      if (!f || !/^image\//.test(f.type)) continue;
      if (f.size > MAX_BYTES) { toast('الصورة أكبر من الحدّ المسموح', true); continue; }
      if (shots.length >= MAX_IMAGES) { toast('بلغتَ أقصى عدد للصور', true); break; }
      shots.push(f);
    }
    paintShots();
  }

  function paintShots() {
    var box = $('rp-shots');
    if (!box) return;
    box.innerHTML = '';
    shots.forEach(function (f, i) {
      var fig = document.createElement('figure');
      var img = document.createElement('img');
      img.alt = 'صورة مرفقة';
      img.src = URL.createObjectURL(f);
      var x = document.createElement('button');
      x.type = 'button';
      x.textContent = '✕';
      x.setAttribute('aria-label', 'أزل الصورة');
      x.addEventListener('click', function () { shots.splice(i, 1); paintShots(); });
      fig.appendChild(img); fig.appendChild(x); box.appendChild(fig);
    });
  }

  function chosen(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  function send(btn) {
    if (busy) return;
    var title = ($('rp-title') || {}).value || '';
    var where = ($('rp-where') || {}).value || '';
    if (!String(title).trim()) { toast('اكتب عنواناً مختصراً للبلاغ', true); return; }
    if (!String(where).trim()) { toast('اكتب أين حدث — الحقل إلزامي', true); return; }
    busy = true;
    if (btn) { btn.setAttribute('data-busy', '1'); btn.setAttribute('aria-busy', 'true'); }
    api('/products/feedback', 'POST', {
      type: chosen('rp-type'),
      title: String(title).trim(),
      where_text: String(where).trim(),
      description: String(($('rp-desc') || {}).value || '').trim(),
      urgency: chosen('rp-urg'),
    }).then(function (j) {
      var item = j.item || j;
      // الصورةُ التي تسقط لا تُبتلع: كانت كلُّ صورةٍ تُرفض تُلقى صامتةً ويُعلَن النجاح كاملاً،
      // فيظنّ المُبلِّغ لقطتَه وصلت ويقرأ الفريقُ بلاغاً بلا الصورة التي كُتب لأجلها.
      var lost = 0;
      var ups = shots.map(function (f) {
        return postBytes('/products/items/' + encodeURIComponent(item.id) + '/images', f, { 'x-image-kind': 'report' })
          .catch(function () { lost++; return null; });
      });
      var track = j.tracking_url || item.tracking_url || '';
      return Promise.all(ups).then(function () { return { item: item, lost: lost, track: track }; });
    }).then(function (r) {
      var item = r.item;
      var box = $('rp-body');
      var foot = document.querySelector('#modal .modal-foot');
      if (box) {
        box.className = 'rp-ok';
        // ما يُقال هنا هو ما يقع فعلاً: البريد يصل عند الدراسة والحل والرفض، لا «عند كل خطوة».
        var lines = '<div style="font-size:14px;font-weight:800;color:#1e293b">'
          + esc(form.success || 'وصلنا بلاغك — رقمه') + ' <span class="k">' + esc(item.item_key || '') + '</span></div>'
          + '<div style="font-size:12.5px;color:#64748b;margin-top:.4rem;line-height:1.9">'
          + 'يصلك بريد حين يُدرَس بلاغك أو يُحلّ أو يُرفض.</div>';
        if (r.lost) {
          lines += '<div style="font-size:12.5px;color:#92400e;background:#fef3c7;border-radius:9px;'
            + 'padding:.5rem .7rem;margin-top:.6rem;line-height:1.9">'
            + 'وصل بلاغك لكن الصورة لم تُرفع — اذكر ما فيها في ردٍّ لاحق أو أرسلها للفريق.</div>';
        }
        // رمزُ المتابعة يأتي من الخادم متى كان للبلاغ صفحةُ متابعة — ولا يُركَّب هنا عنوانٌ بالظنّ.
        if (r.track) {
          lines += '<div style="margin-top:.7rem"><a class="btn btn-sm" href="' + esc(r.track) + '">'
            + 'تابع بلاغك من هنا</a></div>';
        }
        box.innerHTML = lines;
      }
      if (foot) foot.innerHTML = '<button type="button" class="btn btn-primary" data-action="modal-close">تمام</button>';
      shots = [];
    }).catch(function (e) {
      toast(e.message || 'تعذّر إرسال البلاغ — أعد المحاولة', true);
    }).then(function () {
      busy = false;
      if (btn) { btn.removeAttribute('data-busy'); btn.removeAttribute('aria-busy'); }
    });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!t) return;
    var a = t.getAttribute('data-action');
    if (a === 'report-open') { e.preventDefault(); open(t.getAttribute('data-page-title') || ''); }
    else if (a === 'rp-send') { e.preventDefault(); send(t); }
    else if (a === 'dc-print') { e.preventDefault(); window.print(); }
    // إغلاق النافذة معالجٌ عام هنا: هذا الملف يُحمَّل مع كل شاشة، ونافذة «أبلغ» تُفتح فيها
    // كلها — فلا يُترك زرّ الإغلاق معطّلاً خارج شاشة الفرص التي كانت وحدها تعالجه.
    else if (a === 'modal-close') { e.preventDefault(); if (SN().closeModal) SN().closeModal(); }
  });
}());
