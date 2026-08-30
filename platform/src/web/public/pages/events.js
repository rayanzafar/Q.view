// «الفعاليات» — تفويض أحداث فقط، بلا أي مُعالِج داخل السمات (onclick).
// ما تديره هذه الطبقة: نافذة «فعالية جديدة»، ونموذج الالتقاط على الصفحة (نوع البطاقة،
// صورة البطاقة وقراءتها داخل المتصفح، التعبئة من نصٍّ ملصوق، الحفظ ثم التالي)، ومسودةٌ في
// المتصفح تحفظ ما كُتب بين الشبكة المتقطّعة وانطفاء شاشة الجوّال، ورموز QR وعرضها ملء الشاشة.
// لا تعدّل app.js ولا تعتمد عليه إلا في النافذة المشتركة.
//
// القارئ (Tesseract.js) مورَّدٌ داخل سند ويُخدَم من أصل المنصّة نفسها: لا صورة ولا نصّ يغادر
// المتصفح للقراءة — القراءة كلها على جهاز المستخدم.
(function () {
  'use strict';

  var EV = (window.__SANAD || {}).ev || null;
  var DRAFT_TTL = 24 * 60 * 60 * 1000;
  var RIYADH_OFFSET_MS = 3 * 3600000;     // السعودية على +٣ ثابتة بلا توقيتٍ صيفي — كما يحسب الخادم
  var MAX_ORIGINAL = 8 * 1024 * 1024;     // أصل الصورة يُرفع كما هو إن تعذّر فكّه، حتى ٨ ميغابايت
  var LONG_EDGE = 1600;
  var UPLOAD_TIMEOUT = 45000;
  var OCR_TIMEOUT = 30000;
  var VENDOR = '/static/vendor/tesseract-5.1.1/';
  var draftKey = EV ? 'sanad.ev.draft.' + EV.eventId : null;
  var capKey = null;      // مفتاح الالتقاط الحالي — يمنع تكرار الحفظ عند إعادة الإرسال
  var draftTimer = null;
  var saving = false;
  var lastFocus = null;   // العنصر الذي كان عليه التركيز قبل فتح نافذةٍ أو شاشة عرض — يُعاد إليه

  // حالة الصورة والرفع: الصورة الحالية برقمها المتسلسل (كل صورة جديدة أو تفريغٍ للنموذج يزيده،
  // فتُهمل نتيجةُ قراءةٍ تأخّرت عن صورةٍ ذهبت)، والصور التي تعذّر رفعها بانتظار إعادة المحاولة.
  var S = { photo: null, seq: 0, preview: null, pending: {}, attachTarget: null };

  var $ = function (id) { return document.getElementById(id); };
  var val = function (id) { var el = $(id); return el ? String(el.value || '').trim() : ''; };
  var setVal = function (id, v) { var el = $(id); if (el) el.value = v == null ? '' : String(v); };
  var SN = function () { return window.Sanad || {}; };
  var noop = function () {};
  var escHtml = function (s) {
    var f = SN().esc;
    if (f) return f(s);
    return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };

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

  // جلسةٌ انتهت والصفحة مفتوحة: تُحفظ المسودة فوراً ثم تُعاد الصفحة إلى نفسها — حارس الخادم
  // يعرف الوجهة ويقول السبب. والوعد المُعلَّق يمنع المُنادي من عرض خطأٍ بينما الصفحة تغادر.
  function api(path, method, body) {
    return fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' } : { 'X-Requested-With': 'fetch' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 401) { flushDraft(); location.reload(); return new Promise(function () {}); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j.error && j.error.message) || 'تعذّر إتمام العملية — أعد المحاولة');
        return j;
      });
    });
  }
  var isOffline = function (e) { return e && (e.name === 'TypeError' || e instanceof TypeError); };

  // رفع بايتات صورةٍ كما هي (لا نموذج متعدّد الأجزاء): الترويسات تحمل الاسم والعنوان مُرمَّزين.
  function postBytes(path, blob, headers) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, UPLOAD_TIMEOUT) : null;
    var h = { 'Content-Type': blob.type || 'image/jpeg', 'X-Requested-With': 'fetch' };
    for (var k in headers) if (Object.prototype.hasOwnProperty.call(headers, k)) h[k] = headers[k];
    return toArrayBuffer(blob).then(function (buf) {
      return fetch('/api' + path, { method: 'POST', credentials: 'include', headers: h, body: buf, signal: ctrl ? ctrl.signal : undefined });
    }).then(function (r) {
      if (r.status === 401) { flushDraft(); location.reload(); return new Promise(function () {}); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j.error && j.error.message) || 'الصورة لم تُرفع — أعد المحاولة');
        return j;
      });
    }).then(function (j) { if (timer) clearTimeout(timer); return j; }, function (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new Error('الشبكة بطيئة — الصورة لم تُرفع، أعد المحاولة');
      throw e;
    });
  }
  function toArrayBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('تعذّرت قراءة الصورة')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  // ── مفتاح الالتقاط: k_ + ١٢ رمزاً من أساس ٣٦ ──
  function newKey() {
    var out = '';
    var alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
    var buf = null;
    try { if (window.crypto && window.crypto.getRandomValues) { buf = new Uint8Array(12); window.crypto.getRandomValues(buf); } } catch (e) { buf = null; }
    for (var i = 0; i < 12; i++) {
      var n = buf ? buf[i] % 36 : Math.floor(Math.random() * 36);
      out += alphabet.charAt(n);
    }
    return 'k_' + out;
  }

  // ── نوع البطاقة ──
  function setKind(kind) {
    setVal('ev-kind', kind);
    var chips = document.querySelectorAll('[data-action="ev-kind"]');
    for (var i = 0; i < chips.length; i++) {
      var on = chips[i].getAttribute('data-kind') === kind;
      chips[i].classList.toggle('on', on);
      chips[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  // ── المسودة: تُكتب في المتصفح لا في الخادم، وتُستعاد لصاحبها وحده خلال يوم (بلا صورة) ──
  var FIELDS = { name: 'ev-name', org: 'ev-org', title: 'ev-title', phone: 'ev-phone', email: 'ev-email', web: 'ev-web', note: 'ev-note', paste: 'ev-paste', kind: 'ev-kind', sector: 'ev-sector' };
  function draftHasText(f) {
    return !!(f.name || f.org || f.title || f.phone || f.email || f.web || f.note || f.paste);
  }
  function readForm() {
    var f = {};
    for (var k in FIELDS) if (Object.prototype.hasOwnProperty.call(FIELDS, k)) f[k] = val(FIELDS[k]);
    return f;
  }
  function saveDraft() {
    if (!draftKey || !EV || !$('ev-form')) return;
    draftTimer = null;
    var f = readForm();
    try {
      if (!draftHasText(f)) { sessionStorage.removeItem(draftKey); return; }
      sessionStorage.setItem(draftKey, JSON.stringify({ who: EV.me.id, at: Date.now(), key: capKey, f: f }));
    } catch (e) { /* تخزين المتصفح غير متاح — نكمل بلا مسودة */ }
  }
  function scheduleDraft() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 300);
  }
  function flushDraft() {
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    saveDraft();
  }
  function clearDraft() {
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    try { if (draftKey) sessionStorage.removeItem(draftKey); } catch (e) { /* لا شيء يُفعل */ }
  }
  function restoreDraft() {
    if (!draftKey || !EV || !$('ev-form')) return;
    var d = null;
    try { d = JSON.parse(sessionStorage.getItem(draftKey) || 'null'); } catch (e) { d = null; }
    if (!d || !d.f || d.who !== EV.me.id || !(Date.now() - Number(d.at || 0) < DRAFT_TTL)) return;
    var f = d.f;
    if (!draftHasText(f)) return;
    for (var k in FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(FIELDS, k) || k === 'kind') continue;
      if (f[k]) setVal(FIELDS[k], f[k]);
    }
    if (f.kind && (EV.kinds || []).indexOf(f.kind) >= 0) setKind(f.kind);
    if (typeof d.key === 'string' && /^k_[0-9a-z]{12}$/.test(d.key)) capKey = d.key;
    var note = $('ev-draft-note');
    if (note) { note.textContent = 'استعدنا ما كتبته سابقاً'; note.hidden = false; }
  }

  // ── التعبئة من نصّ: الفارغ وحده يُملأ، والمملوء آلياً يُميَّز حتى يلمسه المستخدم ──
  // المسار واحد لزرّ «املأ من النصّ» ولنتيجة القارئ — يعيد عدد الحقول التي مُلئت.
  var PARSE_MAP = [
    ['ev-name', ['person_name', 'name']],
    ['ev-org', ['org_name', 'org']],
    ['ev-title', ['job_title', 'title']],
    ['ev-phone', ['phone', 'mobile']],
    ['ev-email', ['email']],
    ['ev-web', ['website', 'web']],
  ];
  function pick(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return '';
  }
  function fillFromText(text) {
    return api('/events/parse-card', 'POST', { text: text }).then(function (r) {
      var fields = (r && (r.fields || r.parsed || r.card)) || r || {};
      var filled = 0;
      for (var i = 0; i < PARSE_MAP.length; i++) {
        var el = $(PARSE_MAP[i][0]);
        if (!el || String(el.value || '').trim()) continue;
        var v = pick(fields, PARSE_MAP[i][1]);
        if (!v) continue;
        el.value = v;
        el.classList.add('ev-auto');
        filled++;
      }
      if (filled) scheduleDraft();
      return filled;
    });
  }
  function parseCard(btn) {
    var text = val('ev-paste');
    if (text.length < 5) { toast('الصق نصّ البطاقة أولاً — سطر واحد يكفي', true); var p = $('ev-paste'); if (p) p.focus(); return; }
    btn.disabled = true;
    fillFromText(text)
      .then(function (filled) {
        toast(filled ? 'مُلئت الحقول الفارغة من النصّ — راجعها قبل الحفظ' : 'لم نجد في النصّ ما يُملأ — اكتب الحقول يدوياً', !filled);
      })
      .catch(function () { toast('تعذّرت قراءة النصّ الآن — أكمل الحقول يدوياً، وسيُحفظ النصّ مع البطاقة', true); })
      .then(function () { btn.disabled = false; });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // الصورة: من الكاميرا إلى صورة مضغوطة (الضلع الأطول ١٦٠٠) ومعاينة صغيرة — كله على الجهاز
  // ═══════════════════════════════════════════════════════════════════════════
  var kb = function (bytes) { return Math.max(1, Math.round((Number(bytes) || 0) / 1024)); };

  function decodeViaImage(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('read')); };
      fr.onload = function () {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('decode')); };
        img.src = String(fr.result || '');
        if (img.decode) img.decode().then(function () { resolve(img); }, noop);
      };
      fr.readAsDataURL(file);
    });
  }
  function decodeFile(file) {
    if (!window.createImageBitmap) return decodeViaImage(file);
    return createImageBitmap(file, { imageOrientation: 'from-image' })
      .catch(function () { return createImageBitmap(file); })
      .catch(function () { return decodeViaImage(file); });
  }
  function toCanvas(src) {
    var w = src.width || src.naturalWidth || 0, h = src.height || src.naturalHeight || 0;
    if (!w || !h) throw new Error('empty');
    var scale = Math.min(1, LONG_EDGE / Math.max(w, h));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    var ctx = canvas.getContext('2d');
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    if (src.close) { try { src.close(); } catch (e) { /* لا شيء */ } }
    return canvas;
  }
  function canvasBlob(canvas) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('blob')); }, 'image/jpeg', 0.82);
      } catch (e) { reject(e); }
    });
  }
  // يعيد { blob, preview } — والمعاينة رابط data: لا رابط كائنٍ مؤقّت، فلا شيء يُنسى تحريره.
  function processImage(file) {
    return decodeFile(file).then(function (src) {
      var canvas = toCanvas(src);
      var preview = '';
      try { preview = canvas.toDataURL('image/jpeg', 0.6); } catch (e) { preview = ''; }
      return canvasBlob(canvas).then(function (blob) { return { blob: blob, preview: preview }; });
    });
  }
  var keepable = function (file) { return file.size <= MAX_ORIGINAL && /^image\/(jpeg|png|webp)$/.test(String(file.type || '')); };

  function showPreview(preview, bytes) {
    var img = $('ev-photo-prev'), meta = $('ev-photo-meta');
    if (img) { if (preview) { img.src = preview; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; } }
    if (meta) meta.innerHTML = 'الصورة جاهزة · <span class="tnum">' + kb(bytes) + '</span> كيلوبايت';
    toggleAction('ev-photo-retake', true);
    toggleAction('ev-photo-clear', true);
  }
  function toggleAction(action, show) {
    var els = document.querySelectorAll('[data-action="' + action + '"]');
    for (var i = 0; i < els.length; i++) els[i].hidden = !show;
  }
  function clearPhoto() {
    S.photo = null; S.preview = null; S.seq++;
    var img = $('ev-photo-prev'), meta = $('ev-photo-meta');
    if (img) { img.removeAttribute('src'); img.hidden = true; }
    if (meta) meta.textContent = 'بلا صورة';
    toggleAction('ev-photo-retake', false);
    toggleAction('ev-photo-clear', false);
    if (OCR.worker && !OCR.busy && (OCR.state === 'done' || OCR.state === 'reading')) setOcr('ready');
  }
  function openPicker(target) {
    var input = $('ev-photo');
    if (!input) return;
    S.attachTarget = target || null;
    input.click();
  }
  function onPhotoChange(input) {
    var file = input.files && input.files[0];
    input.value = '';                     // كي يُقبل اختيار الملف نفسه مرة أخرى
    if (!file) { S.attachTarget = null; return; }
    var target = S.attachTarget; S.attachTarget = null;
    processImage(file).then(function (res) {
      if (target) { attachTo(target, res.blob, res.preview); return; }
      S.seq++;
      S.photo = { blob: res.blob, seq: S.seq };
      S.preview = res.preview;
      showPreview(res.preview, res.blob.size);
      recognize(res.blob, S.seq);
    }).catch(function () {
      toast('تعذّرت قراءة الصورة على هذا الجهاز — التقطها بالكاميرا من الزرّ مباشرة', true);
      if (!keepable(file)) return;
      // المتصفح لم يفكّ الصورة لكن بايتاتها سليمة الصيغة: تُرفع كما هي، بلا معاينة ولا قراءة.
      if (target) { attachTo(target, file, ''); return; }
      S.seq++;
      S.photo = { blob: file, seq: S.seq };
      S.preview = null;
      showPreview('', file.size);
    });
  }

  // ── رفع صورة بطاقةٍ محفوظة (النداء الثاني بعد الحفظ، أو إرفاقٌ لاحق، أو إعادة محاولة) ──
  var fileNameFor = function (blob) {
    var t = String(blob.type || '');
    return 'card.' + (t === 'image/png' ? 'png' : t === 'image/webp' ? 'webp' : 'jpg');
  };
  function uploadPhoto(cid, blob) {
    return postBytes('/events/contacts/' + encodeURIComponent(cid) + '/photo', blob, { 'x-file-name': encodeURIComponent(fileNameFor(blob)) });
  }
  var rowOf = function (cid) { return document.querySelector('#ev-recent .ev-rc[data-contact="' + String(cid).replace(/"/g, '') + '"]'); };
  function setRowPhoto(cid, src) {
    var row = rowOf(cid);
    if (!row) return;
    var ph = row.querySelector('.ev-rc-ph');
    if (ph) ph.innerHTML = '<img class="ev-thumb" alt="" src="' + escHtml(src) + '">';
    setRowWarn(cid, false);
  }
  function setRowUploading(cid) {
    var row = rowOf(cid);
    var ph = row && row.querySelector('.ev-rc-ph');
    if (ph) ph.innerHTML = '<span class="ev-nophoto">يرفع الصورة…</span>';
  }
  function setRowWarn(cid, on) {
    var row = rowOf(cid);
    if (!row) return;
    var warn = row.querySelector('.ev-rc-warn');
    if (!on) { if (warn) warn.remove(); return; }
    if (!warn) {
      warn = document.createElement('div');
      warn.className = 'ev-rc-warn';
      warn.setAttribute('role', 'status');
      warn.innerHTML = '<span>الصورة لم تُرفع —</span><button type="button" class="btn btn-sm" data-action="ev-photo-retry" data-cid="' + escHtml(cid) + '">أعد رفع الصورة</button>';
      row.appendChild(warn);
    }
    var ph = row.querySelector('.ev-rc-ph');
    if (ph && !ph.querySelector('img')) ph.innerHTML = '<span class="ev-nophoto">بلا صورة</span>';
  }
  function sendPhoto(cid, blob, preview, opts) {
    setRowUploading(cid);
    return uploadPhoto(cid, blob).then(function (j) {
      delete S.pending[cid];
      var sha = String((j && j.sha256) || '').slice(0, 12);
      setRowPhoto(cid, preview || ('/api/events/contacts/' + encodeURIComponent(cid) + '/photo' + (sha ? '?v=' + sha : '')));
      toast(opts && opts.afterSave ? 'حُفظت البطاقة ✓' : 'أُرفقت الصورة ✓');
    }).catch(function (e) {
      S.pending[cid] = { blob: blob, preview: preview || '' };
      setRowWarn(cid, true);
      toast(opts && opts.afterSave
        ? 'حُفظت البطاقة ✓ لكن الصورة لم تُرفع — اضغط «أعد رفع الصورة» تحت اسمها'
        : (isOffline(e) ? 'لا اتصال بالشبكة — الصورة لم تُرفع، أعد المحاولة عند عودة الاتصال' : e.message), true);
    });
  }
  function attachTo(cid, blob, preview) {
    if (!rowOf(cid)) { toast('لم نجد البطاقة في القائمة — حدّث الصفحة', true); return; }
    sendPhoto(cid, blob, preview, {});
  }
  function retryPhoto(cid) {
    var p = S.pending[cid];
    if (!p) { openPicker(cid); return; }
    sendPhoto(cid, p.blob, p.preview, {});
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // القارئ: Tesseract.js المورَّد — يعمل في المتصفح، ولا يخرج منه شيء
  // ═══════════════════════════════════════════════════════════════════════════
  var OCR = { worker: null, creating: null, busy: false, queued: null, failedOnce: false, state: 'off', cardSeq: 0 };
  var OCR_TEXT = {
    off: 'القارئ غير مجهَّز',
    ready: 'القارئ جاهز',
    done: 'قُرئت البطاقة — راجع الحقول',
    timeout: 'تأخّر القارئ — الصق النصّ أو اكتبه',
    failed: 'القراءة التلقائية غير متاحة على هذا الجهاز — الصق النصّ من الكاميرا',
  };
  var fieldsAr = function (n) {
    if (n === 1) return 'حقل واحد';
    if (n === 2) return 'حقلان';
    return '<span class="tnum">' + n + '</span> ' + (n <= 10 ? 'حقول' : 'حقلاً');
  };
  function setOcr(state, html) {
    OCR.state = state;
    var el = document.querySelector('[data-ocr-status]');
    if (el) {
      el.setAttribute('data-ocr-state', state);
      if (html != null) el.innerHTML = html; else el.textContent = OCR_TEXT[state] || '';
    }
    toggleAction('ev-ocr-warm', state === 'off' || state === 'failed');
  }
  var pct = function (p) { return '<span class="tnum">' + Math.min(100, Math.max(0, Math.round((Number(p) || 0) * 100))) + '</span>%'; };
  function onProgress(m) {
    if (!m || !m.status) return;
    var st = String(m.status);
    if (st === 'recognizing text') { if (OCR.state === 'reading') setOcr('reading', 'يقرأ البطاقة… ' + pct(m.progress)); return; }
    if (OCR.state !== 'loading') return;
    if (st === 'loading language traineddata') setOcr('loading', 'يحمّل اللغة… ' + pct(m.progress));
    else if (st === 'loading tesseract core' || st === 'initializing tesseract' || st === 'initializing api') setOcr('loading', 'يجهّز القارئ… ' + pct(m.progress));
  }
  function onWorkerError() {
    OCR.failedOnce = true;
    OCR.busy = false;
    OCR.queued = null;
    var w = OCR.worker; OCR.worker = null; OCR.creating = null;
    if (w) { try { w.terminate().catch(noop); } catch (e) { /* لا شيء */ } }
    setOcr('failed');
  }
  var slowNet = function () {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return !!(c && (c.saveData || /2g/.test(String(c.effectiveType || ''))));
  };
  function warmWorker() {
    if (OCR.worker) return Promise.resolve(OCR.worker);
    if (OCR.creating) return OCR.creating;
    var T = window.Tesseract;
    if (!T || typeof T.createWorker !== 'function') { OCR.failedOnce = true; setOcr('failed'); return Promise.reject(new Error('no engine')); }
    setOcr('loading', 'يجهّز القارئ… ' + pct(0));
    var p;
    try {
      p = T.createWorker('eng+ara', 1, {
        workerPath: VENDOR + 'worker.min.js',
        corePath: VENDOR + 'tesseract-core-simd-lstm.wasm.js',
        langPath: VENDOR + 'lang',
        workerBlobURL: false,
        cacheMethod: 'write',
        cachePath: 'sanad-ocr-tessdata-4.0.0_fast',
        logger: onProgress,
        errorHandler: onWorkerError,
      });
    } catch (e) { p = Promise.reject(e); }
    OCR.creating = Promise.resolve(p).then(function (w) {
      OCR.worker = w; OCR.creating = null;
      setOcr('ready');
      drain();
      return w;
    }, function (e) {
      OCR.creating = null; OCR.worker = null; OCR.failedOnce = true; OCR.queued = null;
      setOcr('failed');
      throw e;
    });
    return OCR.creating;
  }
  function drain() {
    if (!OCR.queued || OCR.busy || !OCR.worker) return;
    var q = OCR.queued; OCR.queued = null;
    if (q.seq !== S.seq) return;              // الصورة تغيّرت أو النموذج فُرِّغ — لا تُقرأ صورةٌ ذهبت
    recognize(q.blob, q.seq);
  }
  function recognize(blob, seq) {
    if (!OCR.worker) {
      OCR.queued = { blob: blob, seq: seq };
      if (!OCR.creating && !OCR.failedOnce && !slowNet()) warmWorker().catch(noop);
      return;
    }
    if (OCR.busy) { OCR.queued = { blob: blob, seq: seq }; return; }
    OCR.busy = true; OCR.cardSeq = seq;
    setOcr('reading', 'يقرأ البطاقة… ' + pct(0));
    var w = OCR.worker;
    var timer = null, timedOut = false;
    var job;
    try { job = w.recognize(blob, {}, { text: true, blocks: false, hocr: false, tsv: false }); } catch (e) { job = Promise.reject(e); }
    job = Promise.resolve(job);
    job.catch(noop);                          // رفضٌ متأخّر بعد الإنهاء لا يُترك بلا مستقبِل
    var timeout = new Promise(function (_, rej) { timer = setTimeout(function () { timedOut = true; rej(new Error('timeout')); }, OCR_TIMEOUT); });
    Promise.race([job, timeout]).then(function (res) {
      clearTimeout(timer);
      OCR.busy = false;
      if (seq !== S.seq || seq !== OCR.cardSeq) { setOcr('ready'); drain(); return; }
      var text = String((res && res.data && res.data.text) || '').trim();
      applyOcrText(text);
    }, function () {
      clearTimeout(timer);
      OCR.busy = false;
      if (timedOut) {
        var ww = OCR.worker; OCR.worker = null; OCR.queued = null;
        setOcr('timeout');
        if (ww) { try { ww.terminate().catch(noop); } catch (e) { /* لا شيء */ } }
        return;
      }
      OCR.failedOnce = true;
      setOcr('failed');
    });
  }
  function applyOcrText(text) {
    if (!text) { setOcr('done'); return; }
    var paste = $('ev-paste');
    if (paste && !String(paste.value || '').trim()) { paste.value = text; scheduleDraft(); }
    fillFromText(text).then(function (filled) {
      setOcr('done', OCR_TEXT.done + (filled > 0 ? ' — عُبّئ ' + fieldsAr(filled) : ''));
    }, function () { setOcr('done'); });
  }
  function terminateOcr() {
    var w = OCR.worker; OCR.worker = null; OCR.creating = null; OCR.queued = null; OCR.busy = false;
    if (w) { try { w.terminate().catch(noop); } catch (e) { /* لا شيء */ } }
  }
  var idle = window.requestIdleCallback
    ? function (fn) { window.requestIdleCallback(fn, { timeout: 4000 }); }
    : function (fn) { setTimeout(fn, 300); };

  // ── الحفظ ثم التالي: لا إعادة تحميل — الصفّ يُضاف فوراً والنموذج يُفرَّغ للبطاقة التالية ──
  var latinDigits = function (s) {
    return String(s || '').replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
      .replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); });
  };
  // ساعة الرياض من الختم العالمي — كما يعرضها الخادم، لا ساعة جهازٍ قد يكون على توقيتٍ آخر.
  var hhmm = function (iso) {
    var t = iso ? new Date(iso) : new Date();
    if (isNaN(t.getTime())) t = new Date();
    var r = new Date(t.getTime() + RIYADH_OFFSET_MS);
    var h = r.getUTCHours(), m = r.getUTCMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  };
  function contactLabel(c) { return c.person_name || c.org_name || c.phone || 'بطاقة بلا اسم'; }
  function recentRow(c, dup, photoState) {
    var org = c.org_name && c.person_name ? ' <span class="ev-rc-org">· ' + escHtml(c.org_name) + '</span>' : '';
    var ph = photoState === 'uploading' ? '<span class="ev-nophoto">يرفع الصورة…</span>'
      : '<button type="button" class="btn btn-ghost" data-action="ev-photo-attach" data-cid="' + escHtml(c.id || '') + '">أرفق صورة</button>';
    return '<div class="ev-rc" data-contact="' + escHtml(c.id || '') + '" data-own="1"><div class="ev-rc-row">'
      + '<div class="ev-rc-ph">' + ph + '</div>'
      + '<div class="ev-rc-main"><b>' + escHtml(contactLabel(c)) + '</b>' + org + '</div>'
      + '<div class="ev-rc-side"><span class="pill" style="background:#eef1f7;color:#475569">' + escHtml(c.kind || '') + '</span>'
      + (dup ? '<span class="ev-tag">قد تكون مكرّرة</span>' : '')
      + '<span class="tnum">' + escHtml(hhmm(c.captured_at)) + '</span></div></div></div>';
  }
  function prependRecent(c, dup, photoState) {
    var box = $('ev-recent');
    if (!box) return;
    var empty = box.querySelector('.empty-state');
    if (empty) empty.remove();
    var wrap = document.createElement('div');
    wrap.innerHTML = recentRow(c, dup, photoState);
    var row = wrap.firstChild;
    box.insertBefore(row, box.firstChild);
    var rows = box.querySelectorAll('.ev-rc');
    for (var i = 8; i < rows.length; i++) rows[i].remove();
  }
  function showDup(dup) {
    var box = $('ev-dup');
    if (!box) return;
    if (!dup) { box.hidden = true; box.textContent = ''; return; }
    var name = dup.person_name || dup.name || dup.org_name || dup.org || 'بطاقة بلا اسم';
    var org = dup.org_name || dup.org || '';
    var who = dup.captured_by_name || dup.who || 'زميل';
    var at = hhmm(dup.captured_at || dup.at);
    box.textContent = 'قد تكون مكرّرة: ' + name + (org && org !== name ? ' — ' + org : '') + ' · سُجّلت قبلك باسم ' + who + ' الساعة ' + at + ' — وحُفظت بطاقتك أيضاً';
    box.hidden = false;
  }
  // يبقى النوع والقطاع (الزائر التالي غالباً من الصنف نفسه)؛ ويُفرَّغ النصّ والصورة ومعاينتها.
  function resetForm() {
    var ids = ['ev-name', 'ev-org', 'ev-title', 'ev-phone', 'ev-email', 'ev-web', 'ev-note', 'ev-paste'];
    for (var i = 0; i < ids.length; i++) { var el = $(ids[i]); if (el) { el.value = ''; el.classList.remove('ev-auto'); } }
    clearPhoto();
    var note = $('ev-draft-note');
    if (note) note.hidden = true;
  }
  function saveContact(btn) {
    if (!EV || saving) return;
    if (!EV.canCapture) { toast(EV.closed ? 'هذه الفعالية مُغلقة — لا يُلتقط فيها جديد' : 'صلاحيتك للمشاهدة فقط', true); return; }
    var name = val('ev-name'), org = val('ev-org'), phone = latinDigits(val('ev-phone'));
    if (!name && !org && !phone) {
      toast('اكتب اسم الشخص أو جهته أو رقم جوّاله — حقل واحد يكفي للحفظ', true);
      var n = $('ev-name'); if (n) n.focus();
      return;
    }
    var body = {
      kind: val('ev-kind') || (EV.kinds && EV.kinds[0]) || '',
      person_name: name || null,
      org_name: org || null,
      job_title: val('ev-title') || null,
      phone: phone || null,
      email: val('ev-email') || null,
      website: val('ev-web') || null,
      sector_id: val('ev-sector') || null,
      note: val('ev-note') || null,
      raw_text: val('ev-paste') || null,
      capture_key: capKey,
    };
    var photo = S.photo ? { blob: S.photo.blob, preview: S.preview || '' } : null;
    saving = true;
    var old = btn.innerHTML;                // يُعاد بأيقونته لا بنصّه وحده
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ…';
    var done = function () { saving = false; btn.disabled = false; btn.innerHTML = old; };
    api('/events/' + encodeURIComponent(EV.eventId) + '/contacts', 'POST', body)
      .then(function (r) {
        var c = (r && (r.contact || r.row)) || r || {};
        var merged = {
          id: c.id, kind: c.kind || body.kind, person_name: c.person_name || body.person_name, org_name: c.org_name || body.org_name,
          phone: c.phone || body.phone, captured_at: c.captured_at || null,
        };
        var dup = r && r.possibleDuplicate ? r.possibleDuplicate : null;
        var withPhoto = !!(photo && merged.id);
        if (!r.resumed) {
          prependRecent(merged, !!dup, withPhoto ? 'uploading' : '');
          var t = $('ev-team-today');
          if (t) t.textContent = String((parseInt(t.textContent, 10) || 0) + 1);
        }
        showDup(dup);
        clearDraft();
        // النداء الثاني — الصورة — بعد أن حُفظت البطاقة: النموذج يُفرَّغ فوراً للبطاقة التالية،
        // والرفع يمضي في الخلفية ويُقال في صفّها ما آل إليه.
        if (withPhoto) sendPhoto(merged.id, photo.blob, photo.preview, { afterSave: true });
        else toast(r && r.resumed ? 'هذه البطاقة محفوظة أصلاً ✓' : 'حُفظت البطاقة ✓');
        resetForm();
        capKey = newKey();
        done();
        var first = $('ev-name');
        if (first) first.focus();
        var form = $('ev-form');
        if (form && form.scrollIntoView) form.scrollIntoView({ block: 'start', behavior: 'smooth' });
      })
      .catch(function (e) {
        done();
        if (isOffline(e)) { flushDraft(); toast('لا اتصال بالشبكة — ما كتبته محفوظ في هذا المتصفح، أعد المحاولة عند عودة الاتصال', true); return; }
        toast(e.message, true);
      });
  }

  // ── فعالية جديدة ──
  function restoreFocus() {
    var el = lastFocus; lastFocus = null;
    if (el && el.focus && document.body.contains(el)) { try { el.focus(); } catch (e) { /* لا شيء */ } }
  }
  function openNew() {
    var tpl = $('ev-new-tpl');
    var s = SN();
    if (!tpl || !s.openModal) { toast('تعذّر فتح النافذة — حدّث الصفحة', true); return; }
    lastFocus = document.activeElement;
    s.openModal(tpl.innerHTML);
    var card = document.querySelector('#modal .modal-card');
    if (card) {
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      if ($('evn-title')) card.setAttribute('aria-labelledby', 'evn-title');
    }
    setTimeout(function () { var el = $('evn-name'); if (el) el.focus(); }, 60);
  }
  function saveNew(btn) {
    var name = val('evn-name'), start = val('evn-start'), end = val('evn-end');
    if (!name) { toast('اكتب اسم الفعالية أولاً', true); var n = $('evn-name'); if (n) n.focus(); return; }
    if (!start || !end) { toast('حدّد تاريخ البداية والنهاية', true); var d = $(start ? 'evn-end' : 'evn-start'); if (d) d.focus(); return; }
    if (end < start) { toast('تاريخ النهاية قبل البداية — صحّحه', true); var e2 = $('evn-end'); if (e2) e2.focus(); return; }
    if (btn.disabled) return;
    btn.disabled = true;
    api('/events', 'POST', { name_ar: name, venue: val('evn-venue') || null, starts_on: start, ends_on: end, booth_no: val('evn-booth') || null })
      .then(function (r) {
        var id = r && (r.id || (r.event && r.event.id));
        if (!id) { btn.disabled = false; toast('أُنشئت الفعالية لكن تعذّر فتحها — حدّث الصفحة', true); return; }
        toast('أُنشئت الفعالية ✓');
        location.href = '/app/event/' + encodeURIComponent(id) + '?tab=capture';
      })
      .catch(function (e) {
        btn.disabled = false;
        toast(isOffline(e) ? 'لا اتصال بالشبكة — أعد المحاولة عند عودة الاتصال' : e.message, true);
      });
  }
  var modalOpen = function () { var m = $('modal'); return !!(m && m.classList.contains('on')); };
  // مُستمع app.js على Escape يسبق هذا الملف فيغلق النافذة قبل أن نراها مفتوحة — لذلك يُعاد
  // التركيز متى كان محفوظاً لا متى بدت النافذة مفتوحة (ولا يُحفظ إلا عند فتحها من هنا).
  function closeModal() {
    var s = SN(); if (s.closeModal) s.closeModal();
    if (lastFocus && !kioskEl()) restoreFocus();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // رموز QR: رفعٌ وحذفٌ يعيدان الصفحة، وعرضٌ ملء الشاشة للزوّار في الجناح
  // ═══════════════════════════════════════════════════════════════════════════
  function qrPick() {
    var title = val('ev-qr-title');
    if (!title) { toast('اكتب عنوان الرمز أولاً', true); var t = $('ev-qr-title'); if (t) t.focus(); return; }
    var input = $('ev-qr-file');
    if (input) input.click();
  }
  function onQrChange(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file || !EV) return;
    if (!/^image\//.test(String(file.type || ''))) { toast('اختر صورةً للرمز — لا ملفّاً آخر', true); return; }
    if (file.size > MAX_ORIGINAL) { toast('الصورة أكبر من ٨ ميغابايت — اختر صورةً أصغر', true); return; }
    var title = val('ev-qr-title');
    var btn = document.querySelector('[data-action="ev-qr-pick"]');
    if (btn) btn.disabled = true;
    postBytes('/events/' + encodeURIComponent(EV.eventId) + '/qr', file, {
      'x-file-name': encodeURIComponent(String(file.name || 'qr.png')),
      'x-title': encodeURIComponent(title),
    }).then(function () {
      toast('أُضيف الرمز ✓');
      setTimeout(function () { location.reload(); }, 400);
    }).catch(function (e) {
      if (btn) btn.disabled = false;
      toast(isOffline(e) ? 'لا اتصال بالشبكة — أعد المحاولة عند عودة الاتصال' : e.message, true);
    });
  }
  function qrDelete(btn) {
    var bid = btn.getAttribute('data-cid') || btn.getAttribute('data-bid');
    if (!bid || !EV) return;
    if (!window.confirm('يُحذف هذا الرمز من الفعالية — متابعة؟')) return;
    btn.disabled = true;
    api('/events/' + encodeURIComponent(EV.eventId) + '/qr/' + encodeURIComponent(bid), 'DELETE')
      .then(function () { toast('حُذف الرمز ✓'); setTimeout(function () { location.reload(); }, 400); })
      .catch(function (e) { btn.disabled = false; toast(e.message, true); });
  }
  var kioskEl = function () { return $('ev-qr-kiosk'); };
  function qrShow(btn) {
    var card = btn.closest ? btn.closest('.ev-qr-card') : null;
    var img = card && card.querySelector('img');
    if (!img) return;
    if (kioskEl()) closeKiosk();
    var title = card.getAttribute('data-title') || '';
    var evName = (EV && EV.name) || (document.querySelector('.ev-hd h2') || {}).textContent || '';
    lastFocus = document.activeElement;
    var ov = document.createElement('div');
    ov.id = 'ev-qr-kiosk';
    ov.className = 'ev-kiosk';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'ev-kiosk-t');
    ov.tabIndex = -1;
    ov.innerHTML = '<div class="ev-kiosk-bar"></div>'
      + '<button type="button" class="btn ev-kiosk-x" data-action="ev-qr-close" aria-label="إغلاق العرض">✕</button>'
      + '<div class="ev-kiosk-body">'
      + '<div class="ev-kiosk-ev">' + escHtml(evName) + '</div>'
      + '<h2 id="ev-kiosk-t">' + escHtml(title) + '</h2>'
      + '<img src="' + escHtml(img.getAttribute('src') || '') + '" alt="">'
      + '<div class="ev-kiosk-hint">وجّه كاميرا جوّالك على الرمز</div>'
      + '</div>';
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    var x = ov.querySelector('[data-action="ev-qr-close"]');
    if (x) x.focus(); else ov.focus();
  }
  function closeKiosk() {
    var ov = kioskEl();
    if (!ov) return;
    ov.remove();
    document.body.style.overflow = '';
    restoreFocus();
  }

  // ── إدارة الفعالية (v5.65): تعديلٌ وإغلاق/فتح وحذف — أزرارٌ لواجهةٍ كانت للخدمة وحدها ──
  function evOpenEdit() {
    var t = $('ev-edit-tpl');
    if (t && SN().openModal) SN().openModal(t.innerHTML);
  }
  function evSaveEdit(btn) {
    if (!EV) return;
    var name = val('evn-name');
    if (!name) { toast('اكتب اسم الفعالية أولاً', true); return; }
    var s = val('evn-start'), en = val('evn-end');
    if (!s || !en) { toast('حدّد تاريخ البداية والنهاية', true); return; }
    if (en < s) { toast('تاريخ النهاية قبل البداية — صحّحه', true); return; }
    btn.disabled = true;
    api('/events/' + encodeURIComponent(EV.eventId), 'PATCH',
      { name_ar: name, venue: val('evn-venue'), starts_on: s, ends_on: en, booth_no: val('evn-booth') })
      .then(function () { toast('حُفظ التعديل ✓'); setTimeout(function () { location.reload(); }, 400); })
      .catch(function (e) { btn.disabled = false; toast(e.message, true); });
  }
  function evToggleClose(reopen) {
    if (!EV) return;
    var msg = reopen ? 'تُفتح الفعالية من جديد فيعود الالتقاط فيها — متابعة؟'
      : 'تُغلق الفعالية فيتوقف الالتقاط فيها وتخرج من قائمة الفعاليات الجارية — متابعة؟';
    if (!window.confirm(msg)) return;
    api('/events/' + encodeURIComponent(EV.eventId) + '/close', 'POST', reopen ? { reopen: 1 } : {})
      .then(function () { toast(reopen ? 'فُتحت الفعالية ✓' : 'أُغلقت الفعالية ✓'); setTimeout(function () { location.reload(); }, 400); })
      .catch(function (e) { toast(e.message, true); });
  }
  function evDeleteEvent(btn) {
    if (!EV) return;
    var n = Number(EV.cards) || 0;
    var msg = n
      ? 'تُحذف الفعالية وبطاقاتها (' + n + ') وصورها نهائياً من الشاشات — متابعة؟'
      : 'تُحذف الفعالية من الشاشات — متابعة؟';
    if (!window.confirm(msg)) return;
    btn.disabled = true;
    api('/events/' + encodeURIComponent(EV.eventId), 'DELETE')
      .then(function () { toast('حُذفت الفعالية ✓'); setTimeout(function () { location.href = '/app/events'; }, 400); })
      .catch(function (e) { btn.disabled = false; toast(e.message, true); });
  }

  // ── الاجتماعات: نموذجٌ على الصفحة، ومدعوّون رقاقات، وتعارضٌ يُفحص حياً ولا يمنع ──
  var MT = EV && EV.mt ? EV.mt : null;
  var mtEditing = null;   // معرّف الاجتماع قيد التعديل — فارغٌ عند الإنشاء
  var mtChips = [];       // [{id, name, fixed}] — والمثبَّت («أنت») بلا زرّ إزالة
  var mtSeq = 0;          // يُسقط ردَّ فحصٍ تأخّر عن حالةٍ تغيّرت بعده
  var mtTimer = null;

  function mtNameOf(uid) {
    if (EV && EV.me && uid === EV.me.id) return 'أنت';
    var list = (MT && MT.people) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === uid) return list[i].name;
    return uid;
  }
  function mtRenderChips() {
    var box = $('mt-chips');
    if (!box) return;
    box.innerHTML = mtChips.map(function (c) {
      return '<span class="mt-chip" data-uid="' + escHtml(c.id) + '">' + escHtml(c.name)
        + (c.fixed ? '' : '<button type="button" data-action="mt-chip-x" aria-label="إزالة ' + escHtml(c.name) + '">✕</button>')
        + '</span>';
    }).join('');
    setVal('mt-attendees', JSON.stringify(mtChips.map(function (c) { return c.id; })));
  }
  function mtResetChips(ids) {
    var me = EV && EV.me ? EV.me.id : null;
    var seen = {};
    mtChips = [];
    var base = [me].concat(ids || []);
    for (var i = 0; i < base.length; i++) {
      var uid = base[i];
      if (!uid || seen[uid]) continue;
      seen[uid] = 1;
      mtChips.push({ id: uid, name: mtNameOf(uid), fixed: uid === me });
    }
    mtRenderChips();
  }
  function mtConflictBox() { return $('mt-conflict'); }
  function mtHideConflict() { var b = mtConflictBox(); if (b) { b.hidden = true; b.innerHTML = ''; } }
  function mtOpenForm(mid) {
    var f = $('mt-form');
    if (!f) return;
    mtEditing = mid || null;
    var row = mid && MT && MT.rows ? MT.rows[mid] : null;
    var t = $('mt-form-t');
    if (t) t.textContent = row ? 'تعديل الاجتماع' : 'اجتماع جديد';
    setVal('mt-title', row ? row.title : '');
    mtSyncDay(row ? row.meeting_date : '');
    setVal('mt-start', row ? row.start_time : '');
    setVal('mt-end', row ? row.end_time : '');
    mtAutoEnd = null;
    setVal('mt-url', row ? row.join_url : '');
    setVal('mt-location', row ? row.location : '');
    setVal('mt-note', row ? row.note : '');
    var more = f.querySelector('.mt-more');
    if (more) more.open = !!(row && (row.location || row.note));
    mtResetChips(row ? row.attendee_ids : []);
    mtHideConflict();
    f.hidden = false;
    if (f.scrollIntoView) f.scrollIntoView({ block: 'start' });
    var ti = $('mt-title');
    if (ti) ti.focus();
    mtCheckSoon();
  }
  function mtHideForm() { var f = $('mt-form'); if (f) f.hidden = true; mtEditing = null; }
  // اختيار الشخص من المنتقي يضيفه فوراً — لا زرّ «أضِف» بينهما: ضغطةٌ واحدة لكل مدعوّ.
  function mtPickAttendee() {
    var sel = $('mt-people');
    var uid = sel ? String(sel.value || '') : '';
    if (!uid) return;
    if (!mtChips.some(function (c) { return c.id === uid; })) {
      mtChips.push({ id: uid, name: mtNameOf(uid) });
      mtRenderChips();
      mtCheckSoon();
    }
    sel.value = '';
    var q = $('mt-people-q');
    if (q) { q.value = ''; q.focus(); }
  }
  // «إلى الساعة» تُملأ وحدها نصفَ ساعةٍ بعد البداية — وما كتبه المستخدم بيده لا يُمسّ أبداً.
  var mtAutoEnd = null;
  function mtMaybeAutoEnd() {
    var s = val('mt-start');
    if (!s) return;
    var en = val('mt-end');
    if (en && en !== mtAutoEnd) return;
    var p = s.split(':');
    var mins = Math.min((+p[0]) * 60 + (+p[1]) + 30, 23 * 60 + 59);
    var v = ('0' + Math.floor(mins / 60)).slice(-2) + ':' + ('0' + (mins % 60)).slice(-2);
    setVal('mt-end', v);
    mtAutoEnd = v;
  }
  // رقاقات أيام الفعالية تكتب في حقل التاريخ المخفيّ — وهو مصدرُ الحقيقة للحفظ والفحص معاً.
  function mtSyncDay(d) {
    var input = $('mt-date');
    if (!input) return;
    if (d) input.value = d;
    var chips = document.querySelectorAll('.mt-day');
    if (!chips.length) return;
    var matched = false;
    Array.prototype.forEach.call(chips, function (c) {
      var on = c.getAttribute('data-day') === input.value;
      c.classList.toggle('on', on);
      if (on) { c.setAttribute('aria-current', 'date'); matched = true; } else c.removeAttribute('aria-current');
    });
    input.hidden = matched;
  }
  function mtRemoveChip(btn) {
    var chip = btn.closest ? btn.closest('.mt-chip') : null;
    var uid = chip ? chip.getAttribute('data-uid') : '';
    mtChips = mtChips.filter(function (c) { return c.id !== uid || c.fixed; });
    mtRenderChips();
    mtCheckSoon();
  }
  // الفحص الحيّ: تنبيهٌ أثناء الكتابة لا بعد الحفظ — ومدخلٌ ناقص يُسكِت التنبيه بلا خطأ.
  function mtCheckSoon() { clearTimeout(mtTimer); mtTimer = setTimeout(mtCheckNow, 400); }
  function mtCheckNow() {
    var box = mtConflictBox();
    if (!box) return;
    var d = val('mt-date'), s = val('mt-start'), en = val('mt-end');
    if (!d || !s || !en || en <= s) { mtHideConflict(); return; }
    var seq = ++mtSeq;
    api('/events/meetings/check', 'POST', {
      meeting_date: d, start_time: s, end_time: en,
      attendee_ids: mtChips.map(function (c) { return c.id; }),
      except_id: mtEditing || undefined,
    }).then(function (j) {
      if (seq !== mtSeq) return;
      var list = (j && j.conflicts) || [];
      if (!list.length) { mtHideConflict(); return; }
      box.innerHTML = '<div style="font-weight:800">تعارض في المواعيد — يمكنك الحفظ رغم ذلك</div>'
        + list.map(function (c) {
          return '<div style="margin-top:.2rem">' + escHtml(c.user_name || '') + ' — «' + escHtml(c.title || '') + '» '
            + '<span class="tnum" dir="ltr">' + escHtml(c.start_time) + '–' + escHtml(c.end_time) + '</span>'
            + (c.event_name ? ' في «' + escHtml(c.event_name) + '»' : '') + '</div>';
        }).join('');
      box.hidden = false;
    }).catch(noop);
  }
  function mtSave(btn) {
    if (!EV) return;
    var title = val('mt-title');
    if (!title) { toast('اكتب عنوان الاجتماع', true); var t1 = $('mt-title'); if (t1) t1.focus(); return; }
    if (!val('mt-date')) { toast('حدّد تاريخ الاجتماع', true); return; }
    var s = val('mt-start'), en = val('mt-end');
    if (!s || !en) { toast('حدّد وقتي البداية والنهاية', true); return; }
    if (en <= s) { toast('وقت النهاية قبل البداية — صحّحه', true); return; }
    var body = {
      title: title, meeting_date: val('mt-date'), start_time: s, end_time: en,
      join_url: val('mt-url'), location: val('mt-location'), note: val('mt-note'),
      attendee_ids: mtChips.map(function (c) { return c.id; }),
    };
    btn.disabled = true;
    var req = mtEditing
      ? api('/events/meetings/' + encodeURIComponent(mtEditing), 'PATCH', body)
      : api('/events/' + encodeURIComponent(EV.eventId) + '/meetings', 'POST', body);
    req.then(function (j) {
      var n = (j && j.conflicts && j.conflicts.length) || 0;
      toast(n ? 'حُفظ الاجتماع — مع تنبيه تعارض في المواعيد' : 'حُفظ الاجتماع ✓', !!n);
      setTimeout(function () { location.reload(); }, n ? 1200 : 500);
    }).catch(function (e) {
      btn.disabled = false;
      toast(isOffline(e) ? 'لا اتصال بالشبكة — أعد المحاولة عند عودة الاتصال' : e.message, true);
    });
  }
  function mtDelete(btn) {
    var mid = btn.getAttribute('data-mid');
    if (!mid) return;
    if (!window.confirm('يُحذف الاجتماع ويصل المدعوين إشعار — متابعة؟')) return;
    btn.disabled = true;
    api('/events/meetings/' + encodeURIComponent(mid), 'DELETE')
      .then(function () { toast('حُذف الاجتماع ✓'); setTimeout(function () { location.reload(); }, 400); })
      .catch(function (e) { btn.disabled = false; toast(e.message, true); });
  }

  // ── مُعالِج نقرٍ واحد للصفحة كلها ──
  document.addEventListener('click', function (e) {
    // النقر على خلفية النافذة يغلقها (app.js) — فيُعاد التركيز إلى ما كان عليه.
    if (e.target && e.target.id === 'modal') { setTimeout(function () { if (!modalOpen()) restoreFocus(); }, 0); return; }
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    var act = el.dataset.action;
    if (act === 'ev-new') { e.preventDefault(); openNew(); return; }
    if (act === 'ev-new-save') { e.preventDefault(); saveNew(el); return; }
    if (act === 'modal-close') { e.preventDefault(); closeModal(); return; }
    if (act === 'ev-kind') { e.preventDefault(); setKind(el.getAttribute('data-kind') || ''); scheduleDraft(); return; }
    if (act === 'ev-parse') { e.preventDefault(); parseCard(el); return; }
    if (act === 'ev-save') { e.preventDefault(); saveContact(el); return; }
    if (act === 'ev-photo-pick' || act === 'ev-photo-retake') { e.preventDefault(); openPicker(null); return; }
    if (act === 'ev-photo-clear') { e.preventDefault(); clearPhoto(); return; }
    if (act === 'ev-photo-attach') { e.preventDefault(); openPicker(el.getAttribute('data-cid') || null); return; }
    if (act === 'ev-photo-retry') { e.preventDefault(); retryPhoto(el.getAttribute('data-cid') || ''); return; }
    if (act === 'ev-ocr-warm') { e.preventDefault(); OCR.failedOnce = false; warmWorker().catch(noop); return; }
    if (act === 'ev-qr-pick') { e.preventDefault(); qrPick(); return; }
    if (act === 'ev-qr-show') { e.preventDefault(); qrShow(el); return; }
    if (act === 'ev-qr-del') { e.preventDefault(); qrDelete(el); return; }
    if (act === 'ev-qr-close') { e.preventDefault(); closeKiosk(); return; }
    if (act === 'ev-edit') { e.preventDefault(); evOpenEdit(); return; }
    if (act === 'ev-edit-save') { e.preventDefault(); evSaveEdit(el); return; }
    if (act === 'ev-close') { e.preventDefault(); evToggleClose(false); return; }
    if (act === 'ev-reopen') { e.preventDefault(); evToggleClose(true); return; }
    if (act === 'ev-del-event') { e.preventDefault(); evDeleteEvent(el); return; }
    if (act === 'mt-new') { e.preventDefault(); mtOpenForm(null); return; }
    if (act === 'mt-cancel') { e.preventDefault(); mtHideForm(); return; }
    if (act === 'mt-chip-x') { e.preventDefault(); mtRemoveChip(el); return; }
    if (act === 'mt-day') { e.preventDefault(); mtSyncDay(el.getAttribute('data-day') || ''); mtCheckSoon(); return; }
    if (act === 'mt-day-other') {
      e.preventDefault();
      var di = $('mt-date');
      if (di) { di.hidden = false; Array.prototype.forEach.call(document.querySelectorAll('.mt-day'), function (c) { c.classList.remove('on'); }); di.focus(); }
      return;
    }
    // التعديل والحذف يُفتحان من نافذة التفاصيل — فتُغلق أولاً ثم يُنفَّذ الفعل.
    if (act === 'mt-edit') { e.preventDefault(); if (SN().closeModal) SN().closeModal(); mtOpenForm(el.getAttribute('data-mid')); return; }
    if (act === 'mt-del') { e.preventDefault(); if (SN().closeModal) SN().closeModal(); mtDelete(el); return; }
  });

  // صفّ الاجتماع يفتح تفاصيله — والنقر على زرٍّ أو رابطٍ داخله شأنُ الزرّ وحده.
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-action], a')) return;
    var row = e.target.closest ? e.target.closest('.mt-row[data-dd]') : null;
    if (!row) return;
    var k = row.getAttribute('data-dd');
    if (k && SN().openDD) SN().openDD(k);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var row = e.target && e.target.classList && e.target.classList.contains('mt-row') ? e.target : null;
    if (!row) return;
    e.preventDefault();
    var k = row.getAttribute('data-dd');
    if (k && SN().openDD) SN().openDD(k);
  });

  // نموذج الاجتماع: الإرسال يحفظ، وتغيّر التاريخ أو الوقتين يعيد فحص التعارض.
  var mtFormEl = $('mt-form');
  if (mtFormEl) {
    mtFormEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = mtFormEl.querySelector('[data-action="mt-save"]');
      if (btn) mtSave(btn);
    });
    mtFormEl.addEventListener('change', function (e) {
      var idv = e.target && e.target.id;
      if (idv === 'mt-people') { mtPickAttendee(); return; }
      if (idv === 'mt-start') mtMaybeAutoEnd();
      if (idv === 'mt-date' || idv === 'mt-start' || idv === 'mt-end') mtCheckSoon();
      if (idv === 'mt-date') mtSyncDay('');
    });
  }

  // Esc يغلق شاشة العرض أو النافذة — كما تفعل بقية النوافذ في المنصة. و«إدخال» داخل حقول
  // نافذة الفعالية الجديدة يحفظها (النافذة بلا نموذج، فلا إرسالَ تلقائياً يُعتمد عليه).
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (kioskEl()) { e.preventDefault(); closeKiosk(); return; }
      closeModal();
      return;
    }
    if (e.key === 'Enter' && modalOpen() && e.target && e.target.tagName === 'INPUT' && e.target.closest && e.target.closest('#modal')) {
      var btn = document.querySelector('#modal [data-action="ev-new-save"]');
      if (btn) { e.preventDefault(); saveNew(btn); return; }
      var ebtn = document.querySelector('#modal [data-action="ev-edit-save"]');
      if (ebtn) { e.preventDefault(); evSaveEdit(ebtn); }
    }
  });

  // ── اختيار الملفّات: تفويضٌ على تغيّر الحقل — صورة البطاقة، وصورة الرمز ──
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.id) return;
    if (t.id === 'ev-photo') onPhotoChange(t);
    else if (t.id === 'ev-qr-file') onQrChange(t);
  });

  // ── النموذج: مسودة على كل كتابة، وزرّ «إدخال» في الجوّال يحفظ بدل أن يعيد الصفحة ──
  var form = $('ev-form');
  if (form && EV) {
    capKey = newKey();
    restoreDraft();
    if (!capKey) capKey = newKey();
    form.addEventListener('input', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('ev-auto')) e.target.classList.remove('ev-auto');
      if (e.target && e.target.type === 'file') return;
      scheduleDraft();
    });
    form.addEventListener('change', function (e) { if (!(e.target && e.target.type === 'file')) scheduleDraft(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('[data-action="ev-save"]');
      if (btn) saveContact(btn);
    });
    window.addEventListener('pagehide', function () { flushDraft(); terminateOcr(); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushDraft(); });

    // تجهيز القارئ مبكراً (في وقت فراغ المتصفح) كي تكون أوّل بطاقة سريعة — إلا على شبكةٍ
    // بطيئة أو موفِّرة للبيانات: هناك يُترك القرار للمستخدم بزرّ «جهّز القارئ».
    if ($('ev-photo')) {
      if (!window.Tesseract) setOcr('off');
      else if (slowNet()) setOcr('off');
      else idle(function () { warmWorker().catch(noop); });
    }
  }
})();
