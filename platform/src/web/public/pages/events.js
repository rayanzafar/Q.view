// «الفعاليات» — تفويض أحداث فقط، بلا أي مُعالِج داخل السمات (onclick).
// ما تديره هذه الطبقة: نافذة «فعالية جديدة»، ونموذج الالتقاط على الصفحة (نوع البطاقة،
// التعبئة من نصٍّ ملصوق، الحفظ ثم التالي)، ومسودةٌ في المتصفح تحفظ ما كُتب بين الشبكة
// المتقطّعة وانطفاء شاشة الجوّال. لا تعدّل app.js ولا تعتمد عليه إلا في النافذة المشتركة.
(function () {
  'use strict';

  var EV = (window.__SANAD || {}).ev || null;
  var DRAFT_TTL = 24 * 60 * 60 * 1000;
  var draftKey = EV ? 'sanad.ev.draft.' + EV.eventId : null;
  var capKey = null;      // مفتاح الالتقاط الحالي — يمنع تكرار الحفظ عند إعادة الإرسال
  var draftTimer = null;
  var saving = false;

  var $ = function (id) { return document.getElementById(id); };
  var val = function (id) { var el = $(id); return el ? String(el.value || '').trim() : ''; };
  var setVal = function (id, v) { var el = $(id); if (el) el.value = v == null ? '' : String(v); };
  var S = function () { return window.Sanad || {}; };
  var escHtml = function (s) {
    var f = S().esc;
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

  // ── المسودة: تُكتب في المتصفح لا في الخادم، وتُستعاد لصاحبها وحده خلال يوم ──
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

  // ── التعبئة من نصٍّ ملصوق: الفارغ وحده يُملأ، والمملوء آلياً يُميَّز حتى يلمسه المستخدم ──
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
  function parseCard(btn) {
    var text = val('ev-paste');
    if (text.length < 5) { toast('الصق نصّ البطاقة أولاً — سطر واحد يكفي', true); var p = $('ev-paste'); if (p) p.focus(); return; }
    btn.disabled = true;
    api('/events/parse-card', 'POST', { text: text })
      .then(function (r) {
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
        toast(filled ? 'مُلئت الحقول الفارغة من النصّ — راجعها قبل الحفظ' : 'لم نجد في النصّ ما يُملأ — اكتب الحقول يدوياً', !filled);
        if (filled) scheduleDraft();
      })
      .catch(function () { toast('تعذّرت قراءة النصّ الآن — أكمل الحقول يدوياً، وسيُحفظ النصّ مع البطاقة', true); })
      .then(function () { btn.disabled = false; });
  }

  // ── الحفظ ثم التالي: لا إعادة تحميل — الصفّ يُضاف فوراً والنموذج يُفرَّغ للبطاقة التالية ──
  var latinDigits = function (s) {
    return String(s || '').replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
      .replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); });
  };
  var hhmm = function (iso) {
    var t = iso ? new Date(iso) : new Date();
    if (isNaN(t.getTime())) t = new Date();
    var h = t.getHours(), m = t.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  };
  function contactLabel(c) { return c.person_name || c.org_name || c.phone || 'بطاقة بلا اسم'; }
  function recentRow(c, dup) {
    var org = c.org_name && c.person_name ? ' <span class="ev-rc-org">· ' + escHtml(c.org_name) + '</span>' : '';
    return '<div class="ev-rc" data-contact="' + escHtml(c.id || '') + '">'
      + '<div class="ev-rc-main"><b>' + escHtml(contactLabel(c)) + '</b>' + org + '</div>'
      + '<div class="ev-rc-side"><span class="pill" style="background:#eef1f7;color:#475569">' + escHtml(c.kind || '') + '</span>'
      + (dup ? '<span class="ev-tag">قد تكون مكرّرة</span>' : '')
      + '<span class="tnum">' + escHtml(hhmm(c.captured_at)) + '</span></div></div>';
  }
  function prependRecent(c, dup) {
    var box = $('ev-recent');
    if (!box) return;
    var empty = box.querySelector('.empty-state');
    if (empty) empty.remove();
    var wrap = document.createElement('div');
    wrap.innerHTML = recentRow(c, dup);
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
  function resetForm() {
    var ids = ['ev-name', 'ev-org', 'ev-title', 'ev-phone', 'ev-email', 'ev-web', 'ev-note', 'ev-paste'];
    for (var i = 0; i < ids.length; i++) { var el = $(ids[i]); if (el) { el.value = ''; el.classList.remove('ev-auto'); } }
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
    saving = true;
    var old = btn.textContent;
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ…';
    var done = function () { saving = false; btn.disabled = false; btn.textContent = old; };
    api('/events/' + encodeURIComponent(EV.eventId) + '/contacts', 'POST', body)
      .then(function (r) {
        var c = (r && (r.contact || r.row)) || r || {};
        var merged = {
          id: c.id, kind: c.kind || body.kind, person_name: c.person_name || body.person_name, org_name: c.org_name || body.org_name,
          phone: c.phone || body.phone, captured_at: c.captured_at || null,
        };
        var dup = r && r.possibleDuplicate ? r.possibleDuplicate : null;
        if (!r.resumed) {
          prependRecent(merged, !!dup);
          var t = $('ev-team-today');
          if (t) t.textContent = String((parseInt(t.textContent, 10) || 0) + 1);
        }
        showDup(dup);
        toast(r && r.resumed ? 'هذه البطاقة محفوظة أصلاً ✓' : 'حُفظت البطاقة ✓');
        clearDraft();
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
  function openNew() {
    var tpl = $('ev-new-tpl');
    var s = S();
    if (!tpl || !s.openModal) { toast('تعذّر فتح النافذة — حدّث الصفحة', true); return; }
    s.openModal(tpl.innerHTML);
    setTimeout(function () { var el = $('evn-name'); if (el) el.focus(); }, 60);
  }
  function saveNew(btn) {
    var name = val('evn-name'), start = val('evn-start'), end = val('evn-end');
    if (!name) { toast('اكتب اسم الفعالية أولاً', true); var n = $('evn-name'); if (n) n.focus(); return; }
    if (!start || !end) { toast('حدّد تاريخ البداية والنهاية', true); var d = $(start ? 'evn-end' : 'evn-start'); if (d) d.focus(); return; }
    if (end < start) { toast('تاريخ النهاية قبل البداية — صحّحه', true); var e2 = $('evn-end'); if (e2) e2.focus(); return; }
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
  function closeModal() { var s = S(); if (s.closeModal) s.closeModal(); }

  // ── مُعالِج نقرٍ واحد للصفحة كلها ──
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    var act = el.dataset.action;
    if (act === 'ev-new') { e.preventDefault(); openNew(); return; }
    if (act === 'ev-new-save') { e.preventDefault(); saveNew(el); return; }
    if (act === 'modal-close') { e.preventDefault(); closeModal(); return; }
    if (act === 'ev-kind') { e.preventDefault(); setKind(el.getAttribute('data-kind') || ''); scheduleDraft(); return; }
    if (act === 'ev-parse') { e.preventDefault(); parseCard(el); return; }
    if (act === 'ev-save') { e.preventDefault(); saveContact(el); return; }
  });

  // Esc يغلق النافذة — كما تفعل بقية النوافذ في المنصة.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  // ── النموذج: مسودة على كل كتابة، وزرّ «إدخال» في الجوّال يحفظ بدل أن يعيد الصفحة ──
  var form = $('ev-form');
  if (form && EV) {
    capKey = newKey();
    restoreDraft();
    if (!capKey) capKey = newKey();
    form.addEventListener('input', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('ev-auto')) e.target.classList.remove('ev-auto');
      scheduleDraft();
    });
    form.addEventListener('change', scheduleDraft);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('[data-action="ev-save"]');
      if (btn) saveContact(btn);
    });
    window.addEventListener('pagehide', flushDraft);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushDraft(); });
  }
})();
