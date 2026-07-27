// مساعد سند — واجهة اللوحة الجانبية (تُحمَّل في كل الشاشات من الهيكل العام).
//
// القاعدة الحاكمة لهذا الملف، ولا استثناء لها: **لا innerHTML ولا تركيب وسوم من نص**.
// كل ما يصل من الخادم — ردّ، اسم مشروع، عنوان مهمة، رسالة خطأ — يُوضع نصاً في عقدة
// (textContent) ثم يُبنى التنسيق (العريض، القوائم) عُقداً حقيقية فوقه. السبب مُعاش لا نظري:
// كانت اللوحة تُركّب ردّ الخادم كوسوم، فمشروعٌ اسمه وسمُ صورةٍ خبيث كان يتحوّل إلى تنفيذ في
// متصفح كل من يسأل عنه.
//
// وقواعد أخرى مقصودة:
//   • لا كتابة تنشأ من مطابقة نص. زرّ المهمة يفتح نموذجاً، والنموذج يُعاين، والمعاينة تُؤكَّد.
//   • خيارات كل قائمة تأتي من الخادم مُصفّاة بنطاق المستخدم — فلا يُعرض عليه سجلّ لا يخصّه.
//   • سجل المحادثة يعيش في تخزين الجلسة فقط: الردود تحمل بيانات نطاقه، ولا يجوز أن تبقى بعدها.
//   • Esc يُغلق ويعيد التركيز إلى الزر العائم، وTab يدور داخل اللوحة ما دامت مفتوحة.
(function () {
  'use strict';

  var panel = document.getElementById('ai-panel');
  if (!panel) return;
  var fab = document.getElementById('ai-fab');
  var log = document.getElementById('ai-log');
  var chipsRow = document.getElementById('ai-chips');
  var input = document.getElementById('ai-input');
  var sendBtn = document.getElementById('ai-send');
  var engineTag = document.getElementById('ai-engine');

  var STORE = 'sanad.assistant.session';
  var MAX_ITEMS = 40;      // سقف ما نحتفظ به من المحادثة
  var MAX_LEN = 4000;      // سقف طول الرسالة المحفوظة

  var isOpen = false;
  var booted = false;      // حُضِّرت المهام الجاهزة مرة واحدة لكل تحميل صفحة
  var busy = false;
  var inflight = [];       // الطلبات الجارية — تُلغى كلها عند الإغلاق
  var caps = [];           // المهام الجاهزة كما أرسلها الخادم (مُصفّاة بصلاحيات الطالب)
  var lastIntent = null;   // نيّة آخر طلب — تُعاد مع اختيار المستخدم عند الالتباس
  var lastMessage = '';    // نصّ آخر طلب — يُعاد كما هو مع الاختيار فلا يتغيّر تصنيف الطلب
  var optionsCache = {};   // نوع الخيارات ← مصفوفة جاهزة
  var thinking = null;
  var hist = [];

  // ── عُقد ────────────────────────────────────────────────────────────────────
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function button(cls, label, action) {
    var b = el('button', cls, label);
    b.type = 'button';
    if (action) b.setAttribute('data-action', action);
    return b;
  }
  function scrollEnd() { log.scrollTop = log.scrollHeight; }

  // ── العارض الآمن ────────────────────────────────────────────────────────────
  // النص أولاً ثم التنسيق: «**نص**» يصير عريضاً كعقدة، والسطر الذي يبدأ بنقطة أو برقم يصير
  // عنصر قائمة. أي محتوى آخر — مهما بدا وسماً — يبقى نصاً يُقرأ ولا يُنفَّذ.
  // كل رقم في الردّ يُلَفّ بخانة الأرقام المعزولة — وإلا تبعثرت أرقام العقود والمبالغ داخل
  // الجملة العربية (نفس معاملة الأرقام في كل شاشات المنصة).
  function appendText(parent, s) {
    var num = /[0-9][0-9.,:/\-]*[0-9]|[0-9]/g, last = 0, m;
    while ((m = num.exec(s)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(s.slice(last, m.index)));
      parent.appendChild(el('span', 'tnum', m[0]));
      last = num.lastIndex;
    }
    if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
  }
  function inlineInto(parent, s) {
    var re = /\*\*([\s\S]+?)\*\*/g, last = 0, m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) appendText(parent, s.slice(last, m.index));
      var strong = el('strong');
      appendText(strong, m[1]);
      parent.appendChild(strong);
      last = re.lastIndex;
    }
    if (last < s.length) appendText(parent, s.slice(last));
  }
  var BULLET = /^\s*[•*\-–]\s+/;
  var NUMBERED = /^\s*\d+[.)]\s+/;
  function renderText(parent, raw) {
    var lines = String(raw == null ? '' : raw).replace(/\r/g, '').split('\n');
    var list = null, listTag = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var bullet = BULLET.test(line), numbered = !bullet && NUMBERED.test(line);
      if (bullet || numbered) {
        var tag = bullet ? 'ul' : 'ol';
        if (!list || listTag !== tag) { list = el(tag); listTag = tag; parent.appendChild(list); }
        var li = el('li');
        inlineInto(li, line.replace(bullet ? BULLET : NUMBERED, ''));
        list.appendChild(li);
        continue;
      }
      list = null; listTag = '';
      if (!line.trim()) continue;
      var p = el('p');
      inlineInto(p, line);
      parent.appendChild(p);
    }
    if (!parent.childNodes.length) parent.appendChild(el('p', null, '…'));
  }

  // ── فقاعات المحادثة ─────────────────────────────────────────────────────────
  function dropEmptyState() {
    var es = log.querySelector('.empty-state');
    if (es && es.parentNode) es.parentNode.removeChild(es);
  }
  function bubble(role, text) {
    dropEmptyState();
    var row = el('div', 'ai-msg ' + (role === 'me' ? 'me' : 'ai'));
    var box = el('div', 'ai-b');
    renderText(box, text);
    row.appendChild(box);
    log.appendChild(row);
    scrollEnd();
    return row;
  }
  function say(role, text) { bubble(role, text); remember(role, text); }

  function clearLog() { while (log.firstChild) log.removeChild(log.firstChild); }
  // تُزيل بطاقة (نموذجاً أو معاينة) بصفّها الحاوي، وتُبطل مؤقّتها إن كان لها مؤقّت.
  function dropNode(card) {
    if (!card) return;
    if (card._timer) { window.clearTimeout(card._timer); card._timer = null; }
    var row = card.parentNode;
    if (row && row.parentNode) row.parentNode.removeChild(row);
    else if (row) row.removeChild(card);
  }

  // ── الحالات المصمَّمة ───────────────────────────────────────────────────────
  function emptyState() {
    var wrap = el('div', 'empty-state');
    var hasCaps = caps.length > 0;
    wrap.appendChild(el('div', 't', hasCaps ? 'كيف أساعدك؟' : 'لا مهام جاهزة لدورك'));
    wrap.appendChild(el('div', 's', hasCaps
      ? 'اختر مهمة جاهزة من الأسفل، أو اكتب سؤالك بلغتك. لا أعرض إلا ما تسمح به صلاحياتك، ولا أُنفّذ تغييراً قبل معاينة تؤكّدها.'
      : 'اكتب سؤالك وسأجيب بما تسمح به صلاحياتك. المهام الجاهزة تظهر هنا حين تُتاح لدورك.'));
    log.appendChild(wrap);
  }
  function showThinking() {
    hideThinking();
    var row = el('div', 'ai-msg ai');
    var box = el('div', 'ai-b');
    box.appendChild(el('div', 'ai-note', 'جارٍ التحضير…'));
    var sk = el('div', 'ai-sk');
    sk.appendChild(el('span', 'skeleton'));
    sk.appendChild(el('span', 'skeleton'));
    box.appendChild(sk);
    row.appendChild(box);
    log.appendChild(row);
    thinking = row;
    log.setAttribute('aria-busy', 'true');
    scrollEnd();
  }
  function hideThinking() {
    if (thinking && thinking.parentNode) thinking.parentNode.removeChild(thinking);
    thinking = null;
    log.removeAttribute('aria-busy');
  }
  function showError(message, again) {
    var row = el('div', 'ai-msg ai');
    var card = el('div', 'alert err');
    var tx = el('div');
    tx.style.flex = '1';
    renderText(tx, message);
    if (again) {
      var acts = el('div', 'ai-acts');
      acts.style.marginTop = '.4rem';
      var retry = button('btn btn-sm', 'أعد المحاولة', 'ai-retry');
      retry._again = again;                       // كل رسالة خطأ تحمل محاولتها هي، لا آخر محاولة
      acts.appendChild(retry);
      tx.appendChild(acts);
    }
    card.appendChild(tx);
    row.appendChild(card);
    log.appendChild(row);
    scrollEnd();
  }

  // ── الاتصال بالخادم ─────────────────────────────────────────────────────────
  function reasonFor(status) {
    if (status === 401) return 'انتهت جلستك. سجّل الدخول من جديد ثم أعد سؤالك.';
    if (status === 403) return 'صلاحيتك لا تسمح بهذا الطلب. راجع مدير النظام إن كنت تحتاجه في عملك.';
    if (status === 404) return 'لم أجد ما طلبته ضمن نطاقك.';
    if (status === 429) return 'طلبات كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة.';
    if (status >= 500) return 'تعذّر الوصول إلى المساعد الآن. أعد المحاولة بعد قليل، وإن تكرّر الأمر أبلغ مدير النظام.';
    return 'تعذّر إتمام الطلب. أعد المحاولة.';
  }
  function serverSaid(body) {
    var m = body && body.error && body.error.message;
    if (typeof m === 'string' && /[؀-ۿ]/.test(m)) return m;      // رسالة الخادم العربية تُعرض حرفياً
    return '';
  }
  function ask(path, method, body) {
    var ctrl = new AbortController();
    inflight.push(ctrl);
    var done = function () { var i = inflight.indexOf(ctrl); if (i >= 0) inflight.splice(i, 1); };
    var init = { method: method || 'GET', credentials: 'include', signal: ctrl.signal };
    if (body) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
    return fetch('/api/ai' + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        done();
        if (!r.ok) throw new Error(serverSaid(j) || reasonFor(r.status));
        return j;
      });
    }, function (e) {
      done();
      if (e && e.name === 'AbortError') throw e;
      throw new Error('تعذّر الاتصال. تحقّق من الشبكة ثم أعد المحاولة.');
    });
  }
  function abortAll() {
    var list = inflight.slice();
    inflight = [];
    list.forEach(function (c) { try { c.abort(); } catch (e) { /* لا شيء */ } });
  }
  function isAbort(e) { return e && e.name === 'AbortError'; }
  function setBusy(on) {
    busy = on;
    input.disabled = on;
    sendBtn.disabled = on;
    var list = chipsRow.querySelectorAll('button');
    for (var i = 0; i < list.length; i++) list[i].disabled = on;
    if (!on && isOpen && (!document.activeElement || document.activeElement === document.body)) {
      try { input.focus(); } catch (e) { /* لا شيء */ }
    }
  }

  // ── تخزين الجلسة ────────────────────────────────────────────────────────────
  // تخزين الجلسة لا التخزين الدائم: الردود تحمل بيانات نطاق المستخدم، فتنتهي بانتهاء جلسته.
  // ولو دخل مستخدم آخر على المتصفح نفسه بُدِئت المحادثة من جديد.
  function who() { return panel.getAttribute('data-who') || ''; }
  function load() {
    hist = [];
    try {
      var raw = window.sessionStorage.getItem(STORE);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || data.who !== who() || !Array.isArray(data.items)) { window.sessionStorage.removeItem(STORE); return; }
      hist = data.items.filter(function (x) { return x && typeof x.t === 'string'; }).slice(-MAX_ITEMS);
    } catch (e) { hist = []; }
  }
  function save() {
    try { window.sessionStorage.setItem(STORE, JSON.stringify({ who: who(), items: hist })); }
    catch (e) { /* امتلأ التخزين أو مُنع — المحادثة تبقى على الشاشة */ }
  }
  function remember(role, text) {
    hist.push({ r: role === 'me' ? 'me' : 'ai', t: String(text == null ? '' : text).slice(0, MAX_LEN) });
    if (hist.length > MAX_ITEMS) hist = hist.slice(-MAX_ITEMS);
    save();
  }
  function forget() {
    hist = [];
    try { window.sessionStorage.removeItem(STORE); } catch (e) { /* لا شيء */ }
  }

  // ── المهام الجاهزة ──────────────────────────────────────────────────────────
  function chipSkeletons() {
    chipsRow.hidden = false;
    while (chipsRow.firstChild) chipsRow.removeChild(chipsRow.firstChild);
    for (var i = 0; i < 3; i++) {
      var s = el('span', 'skeleton');
      s.style.width = (i === 1 ? 92 : 68) + 'px';
      s.style.height = '22px';
      s.style.borderRadius = '999px';
      chipsRow.appendChild(s);
    }
  }
  function renderChips() {
    while (chipsRow.firstChild) chipsRow.removeChild(chipsRow.firstChild);
    if (!caps.length) { chipsRow.hidden = true; return; }
    chipsRow.hidden = false;
    caps.forEach(function (c) {
      var write = c.kind === 'write';
      var b = button('ai-chip', null, 'ai-cap');
      if (c.intent) b.setAttribute('data-intent', String(c.intent));
      if (write) b.appendChild(el('span', 'wd'));
      b.appendChild(document.createTextNode(c.label_ar));
      var hint = write ? c.label_ar + ' — تغيير يبدأ بنموذج ولا يُنفَّذ إلا بتأكيدك' : c.label_ar;
      b.title = hint;
      b.setAttribute('aria-label', hint);
      b._cap = c;
      chipsRow.appendChild(b);
    });
  }
  function boot() {
    if (booted) return Promise.resolve();
    booted = true;
    chipSkeletons();
    return ask('/status').then(function (s) {
      // الكلمة العربية وحدها تُعرض — لا اسم مزوّد ولا اسم متغيّر تشغيل.
      var given = s && (s.engineLabel || s.modeLabel);
      var raw = s && (s.engine || s.mode);
      var label = (typeof given === 'string' && given.trim()) ? given.trim()
        : (raw && raw !== 'local') ? 'مزوّد' : 'محلي';
      engineTag.textContent = label;
      engineTag.title = 'طريقة العمل: ' + label;
      engineTag.hidden = false;
      var list = (s && (s.capabilities || s.suggestions)) || [];
      caps = Array.isArray(list) ? list.filter(function (c) { return c && typeof c.label_ar === 'string' && c.label_ar.trim(); }) : [];
      renderChips();
      if (!hist.length && !log.querySelector('.ai-msg')) { clearLog(); emptyState(); }   // نصّ الحالة الفارغة يعرف الآن هل ثمّة مهام جاهزة
    }, function (e) {
      if (isAbort(e)) { booted = false; return; }
      booted = false;
      chipsRow.hidden = true;
      while (chipsRow.firstChild) chipsRow.removeChild(chipsRow.firstChild);
      showError('تعذّر تحضير المهام الجاهزة. ' + e.message, function () { boot(); });
    });
  }

  // ── الخيارات المصفّاة بالنطاق ───────────────────────────────────────────────
  function normOption(o) {
    if (o == null) return null;
    if (typeof o === 'string' || typeof o === 'number') return { id: String(o), label: String(o), raw: {} };
    var id = o.id != null ? o.id : (o.value != null ? o.value : o.key);
    var label = o.label_ar || o.label || o.name_ar || o.title_ar || o.name || o.title;
    if (id == null) return null;
    var sub = o.sub_ar || o.sub || '';                 // وصف مميِّز (حالة المهمة، مرحلة الفرصة)
    var text = String(label == null ? id : label);
    return { id: String(id), label: sub ? text + ' · ' + sub : text, raw: o };
  }
  function optionsOf(payload) {
    var arr = Array.isArray(payload) ? payload
      : (payload && (payload.options || payload.items || payload.rows || payload.data)) || [];
    if (!Array.isArray(arr)) arr = [];
    var out = [];
    for (var i = 0; i < arr.length; i++) { var o = normOption(arr[i]); if (o) out.push(o); }
    return out;
  }
  function loadOptions(kind) {
    if (optionsCache[kind]) return Promise.resolve(optionsCache[kind]);
    return ask('/options/' + encodeURIComponent(kind)).then(function (j) {
      optionsCache[kind] = optionsOf(j);
      return optionsCache[kind];
    });
  }

  // ── الشروط: حقل يظهر ويُطلب في حالته فقط ────────────────────────────────────
  // لغة الشرط المدعومة: { field, equals|not_equals|in|not_in|filled|flag } وتركيبها
  // { all:[…] } / { any:[…] } / { not:… }. شرط لا نفهمه ⇒ الحقل يظهر ولا يُفرض، فلا نحبس
  // المستخدم خلف قاعدة لا نستطيع تقييمها.
  //
  // والشرط يأتي من الخادم وحده: القاعدة قاعدةُ الخدمة التي ستنفّذ التغيير — «مُعطَّل» بلا سبب
  // مكتوب، والتراجع عن فوزٍ بلا سبب. نسخةٌ ثانية منها هنا تتعفّن يوم تتغيّر هناك، فتُخفي حقلاً
  // صار مطلوباً أو تطلب حقلاً لم يعد كذلك. `flag` وحده يقرأ الصفّ المختار من القائمة (مثل
  // «هذه الفرصة مكسوبة») لأن حاله لا يُستنتج من قيمة الحقل.
  function condValue(state, name) {
    var f = state.byName[name];
    return f ? String(f.get() == null ? '' : f.get()) : '';
  }
  function condOption(state, name) {
    var f = state.byName[name];
    if (!f || !f.optionFor) return null;
    return f.optionFor(condValue(state, name));
  }
  function evalCond(cond, state) {
    if (!cond || typeof cond !== 'object') return null;
    var i, r;
    if (Array.isArray(cond.all)) {
      for (i = 0; i < cond.all.length; i++) { r = evalCond(cond.all[i], state); if (r !== true) return r; }
      return true;
    }
    if (Array.isArray(cond.any)) {
      var unknown = false;
      for (i = 0; i < cond.any.length; i++) { r = evalCond(cond.any[i], state); if (r === true) return true; if (r === null) unknown = true; }
      return unknown ? null : false;
    }
    if (cond.not) { r = evalCond(cond.not, state); return r === null ? null : !r; }
    if (typeof cond.field !== 'string') return null;
    var v = condValue(state, cond.field);
    if (cond.equals !== undefined) return v === String(cond.equals);
    if (cond.not_equals !== undefined) return v !== String(cond.not_equals);
    if (Array.isArray(cond.in)) return cond.in.map(String).indexOf(v) >= 0;
    if (Array.isArray(cond.not_in)) return cond.not_in.map(String).indexOf(v) < 0;
    if (cond.filled !== undefined) return cond.filled ? v !== '' : v === '';
    if (typeof cond.flag === 'string') {
      var o = condOption(state, cond.field);
      if (!o) return false;
      var raw = o.raw || {};
      var meta = raw.meta || {};
      return !!(raw[cond.flag] || meta[cond.flag]);
    }
    return null;
  }
  function serverWhen(field) { return field.show_when || field.visible_when || field.when || null; }
  function isVisible(field, state) {
    var c = serverWhen(field);
    if (!c) return true;
    var r = evalCond(c, state);
    return r === null ? true : r;                      // شرط لا نفهمه ⇒ نُظهر الحقل ولا نخفيه
  }
  function isRequired(field, state) {
    var c = field.required_when;
    if (c) { var r = evalCond(c, state); if (r !== null) return r === true; }
    return field.required === true;
  }

  // ── نموذج التغيير داخل اللوحة ───────────────────────────────────────────────
  function fieldsOf(form) {
    var f = form && (form.fields || form.inputs);
    if (Array.isArray(form)) f = form;
    return Array.isArray(f) ? f.filter(function (x) { return x && typeof x.name === 'string'; }) : [];
  }
  function kindsNeeded(fields) {
    var kinds = [];
    fields.forEach(function (f) {
      var k = f.options_kind || f.optionsKind || f.source;
      if (typeof k === 'string' && k && kinds.indexOf(k) < 0 && !Array.isArray(f.options)) kinds.push(k);
    });
    return kinds;
  }

  function openForm(form, prefill, pending) {
    var fields = fieldsOf(form);
    if (!fields.length) {
      showError('تعذّر عرض نموذج هذا التغيير. أعد المحاولة، وإن تكرّر الأمر أبلغ مدير النظام.', null);
      return;
    }
    var kinds = kindsNeeded(fields);
    showThinking();
    setBusy(true);
    Promise.all(kinds.map(loadOptions)).then(function () {
      hideThinking(); setBusy(false);
      renderForm(form, fields, prefill || {});
      // الالتباس يُعرض **تحت** النموذج: الاختيار يملأ حقله في مكانه بلا رحلة ثانية إلى الخادم.
      if (pending && pending.choices && pending.choices.length) renderChoices(pending.choices, pending.intent, pending.field);
    }, function (e) {
      hideThinking(); setBusy(false);
      if (isAbort(e)) return;
      showError('تعذّر تحضير خيارات النموذج. ' + e.message, function () { openForm(form, prefill, pending); });
    });
  }

  function renderForm(form, fields, values) {
    var card = el('div', 'ai-card');
    card.appendChild(el('div', 'hd', form.title_ar || form.label_ar || 'تغيير يحتاج تأكيدك'));
    if (form.note_ar) card.appendChild(el('div', 'ai-note', form.note_ar));

    var state = { form: form, fields: fields, byName: {}, rows: [] };
    var blockers = [];

    fields.forEach(function (f) {
      var row = el('div', 'ai-f');
      var uid = 'aif-' + Math.random().toString(36).slice(2, 9);
      var label = el('label', null, f.label_ar || f.label || f.name);
      label.setAttribute('for', uid);
      var star = el('span', 'why', ' *');
      star.hidden = true;
      label.appendChild(star);
      row.appendChild(label);

      var kind = String(f.kind || f.type || 'text').toLowerCase();
      var ctl, optionList = null;
      if (kind === 'select' || Array.isArray(f.options) || f.options_kind || f.optionsKind || f.source) {
        optionList = Array.isArray(f.options) ? optionsOf(f.options) : (optionsCache[f.options_kind || f.optionsKind || f.source] || []);
        ctl = el('select');
        if (!optionList.length) {
          var none = el('option', null, 'لا خيارات متاحة');
          none.value = '';
          ctl.appendChild(none);
          ctl.disabled = true;
          // حقل اختياري بلا خيارات لا يمنع التغيير — الممنوع هو حقل مطلوب لا خيار فيه.
          if (f.required === true) blockers.push(f.label_ar || f.label || f.name);
        } else {
          if (optionList.length > 1) {
            var pick = el('option', null, f.required === true ? 'اختر…' : 'بلا تحديد');
            pick.value = '';
            ctl.appendChild(pick);
          }
          optionList.forEach(function (o) {
            var opt = el('option', null, o.label);
            opt.value = o.id;
            ctl.appendChild(opt);
          });
          if (optionList.length === 1) row.appendChild(el('div', 'ai-note', 'اخترتُ الخيار الوحيد المتاح ضمن نطاقك.'));
        }
      } else if (kind === 'textarea' || kind === 'longtext') {
        ctl = el('textarea');
        ctl.rows = 2;
      } else {
        ctl = el('input');
        ctl.type = (kind === 'number' || kind === 'date') ? kind : 'text';
      }
      ctl.id = uid;
      if (f.placeholder_ar && ctl.tagName !== 'SELECT') ctl.placeholder = f.placeholder_ar;
      var initial = values[f.name] != null ? values[f.name] : (f.value != null ? f.value : (f.default != null ? f.default : ''));
      if (initial !== '' && initial != null) { try { ctl.value = String(initial); } catch (e) { /* لا شيء */ } }
      row.appendChild(ctl);
      if (f.help_ar) row.appendChild(el('div', 'ai-note', f.help_ar));
      var why = el('div', 'why');
      why.hidden = true;
      row.appendChild(why);

      var entry = {
        def: f, row: row, ctl: ctl, star: star, why: why,
        get: function () { return ctl.value; },
        optionFor: optionList ? function (v) {
          for (var i = 0; i < optionList.length; i++) if (optionList[i].id === String(v)) return optionList[i];
          return null;
        } : null,
      };
      state.byName[f.name] = entry;
      state.rows.push(entry);
      card.appendChild(row);
    });

    var acts = el('div', 'ai-acts');
    var submit = button('btn btn-primary btn-sm', form.submit_ar || 'معاينة التغيير', 'ai-form-submit');
    var cancel = button('btn btn-sm', 'إلغاء', 'ai-form-cancel');
    acts.appendChild(submit);
    acts.appendChild(cancel);
    card.appendChild(acts);
    card.appendChild(el('div', 'ai-note', 'لن يُنفَّذ شيء قبل أن تقرأ المعاينة وتؤكّدها.'));

    if (blockers.length) {
      submit.disabled = true;
      card.appendChild(el('div', 'ai-note', 'لا يمكن إتمام هذا التغيير الآن: لا خيارات ضمن نطاقك في «' + blockers[0] + '».'));
    }

    card._form = state;
    submit._card = card;
    cancel._card = card;
    card.addEventListener('change', function () { sync(state); });
    card.addEventListener('input', function () { sync(state); });

    var row2 = el('div', 'ai-msg ai');
    row2.appendChild(card);
    log.appendChild(row2);
    sync(state);
    scrollEnd();
    var first = card.querySelector('input,select,textarea');
    if (first && !first.disabled) { try { first.focus(); } catch (e) { /* لا شيء */ } }
  }

  function sync(state) {
    state.rows.forEach(function (r) {
      var show = isVisible(r.def, state);
      r.row.hidden = !show;
      var req = show && isRequired(r.def, state);
      r.star.hidden = !req;
      r.ctl.required = !!req;
      if (!show) { r.why.hidden = true; r.why.textContent = ''; }
    });
  }

  function collect(state) {
    var out = {}, missing = null;
    for (var i = 0; i < state.rows.length; i++) {
      var r = state.rows[i];
      r.why.hidden = true; r.why.textContent = '';
      if (r.row.hidden) continue;
      var v = String(r.get() == null ? '' : r.get()).trim();
      if (!v && isRequired(r.def, state)) {
        r.why.textContent = 'هذا الحقل مطلوب لإتمام التغيير.';
        r.why.hidden = false;
        if (!missing) missing = r;
        continue;
      }
      if (v) out[r.def.name] = v;
    }
    if (missing) { try { missing.ctl.focus(); } catch (e) { /* لا شيء */ } return null; }
    return out;
  }

  // ── المعاينة ثم التأكيد ─────────────────────────────────────────────────────
  function submitForm(card) {
    if (busy) return;
    var state = card._form;
    if (!state) return;
    var fields = collect(state);
    if (!fields) return;
    var type = state.form.type || state.form.intent || state.form.kind;
    setBusy(true);
    showThinking();
    ask('/preview', 'POST', { type: type, fields: fields }).then(function (p) {
      hideThinking(); setBusy(false);
      dropNode(card);
      renderPreview(p, state.form, fields);
    }, function (e) {
      hideThinking(); setBusy(false);
      if (isAbort(e)) return;
      showError(e.message, function () { submitForm(card); });
    });
  }

  function expiryOf(p) {
    var v = p && (p.expires_at || p.expiresAt || (p.preview && (p.preview.expires_at || p.preview.expiresAt)));
    if (v == null || v === '') return 0;
    var t = typeof v === 'number' ? v : Date.parse(String(v));
    return isNaN(t) ? 0 : t;
  }
  // الساعة والدقيقة فقط — ولو تعذّر التنسيق المحلي كتبناهما بأنفسنا: وقتٌ حقيقي دائماً، فلا
  // تنزلق اللوحة إلى وعدٍ مبهم بـ«دقائق قليلة» بينما الخادم قال لها اللحظة بالضبط.
  function atTime(ms) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    try {
      var s = d.toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
      if (s) return s;
    } catch (e) { /* لا تنسيق محلي — نكمل بالحساب اليدوي */ }
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderPreview(p, form, values) {
    var inner = (p && p.preview) || {};
    var summary = (p && (p.summary_ar || p.summary)) || inner.summary_ar || inner.summary || (p && p.reply)
      || 'راجع التغيير قبل تنفيذه.';
    var previewId = p && (p.previewId || p.preview_id);
    var card = el('div', 'ai-prev');
    card.setAttribute('aria-live', 'assertive');
    card.appendChild(el('div', 'hd', 'معاينة قبل التنفيذ'));
    var body = el('div');
    renderText(body, summary);
    card.appendChild(body);

    var note = el('div', 'ai-note');
    var acts = el('div', 'ai-acts');
    var confirm = button('btn btn-primary btn-sm', 'تأكيد التنفيذ', 'ai-confirm');
    var cancel = button('btn btn-sm', 'إلغاء', 'ai-form-cancel');
    acts.appendChild(confirm);
    acts.appendChild(cancel);

    var expires = expiryOf(p);
    if (!previewId) {
      confirm.disabled = true;
      note.textContent = 'تعذّر تجهيز هذا التغيير للتأكيد. أعد المحاولة من جديد.';
    } else {
      // المهلة تُقال بلحظتها كما أرسلها الخادم: «حتى ٠٣:٢٠» يعرف صاحبها كم بقي له، و«لدقائق
      // قليلة» لا تعني شيئاً — ومنها كان يُضغط زرّ التأكيد بعد فوات الأوان فيُردّ بلا سبب مفهوم.
      var until = expires ? atTime(expires) : '';
      if (until) {
        note.appendChild(document.createTextNode('صالحة للتأكيد حتى '));
        note.appendChild(el('span', 'tnum', until));
        note.appendChild(document.createTextNode('.'));
      } else {
        note.textContent = 'راجع التغيير ثم أكّده الآن.';   // بلا لحظة انتهاء لا نَعِد بمهلة لا نعرفها
      }
    }
    card.appendChild(acts);
    card.appendChild(note);

    confirm._previewId = previewId;
    confirm._note = note;
    cancel._card = card;

    if (previewId && expires) {
      var expire = function () {
        confirm.disabled = true;
        while (note.firstChild) note.removeChild(note.firstChild);
        note.textContent = 'انتهت مهلة التأكيد — أعد المحاولة.';
        if (!card.querySelector('[data-action="ai-form-again"]')) {
          var again = button('btn btn-sm', 'أعد المحاولة', 'ai-form-again');
          again._form = form;
          again._values = values;
          acts.appendChild(again);
        }
      };
      if (expires - Date.now() <= 0) expire();
      else card._timer = window.setTimeout(expire, expires - Date.now());
      confirm._expires = expires;
      confirm._expire = expire;
    }

    var row = el('div', 'ai-msg ai');
    row.appendChild(card);
    log.appendChild(row);
    scrollEnd();
    try { confirm.focus(); } catch (e) { /* لا شيء */ }
  }

  function applyPreview(btnEl) {
    if (busy || !btnEl._previewId) return;
    if (btnEl._expires && Date.now() > btnEl._expires) { if (btnEl._expire) btnEl._expire(); return; }
    var card = btnEl.closest('.ai-prev');
    setBusy(true);
    showThinking();
    ask('/apply', 'POST', { previewId: btnEl._previewId, confirm: true }).then(function (r) {
      hideThinking(); setBusy(false);
      dropNode(card);
      say('ai', (r && (r.reply || r.summary_ar)) || 'نُفِّذ التغيير.');
      var row = el('div', 'ai-msg ai');
      var acts = el('div', 'ai-acts');
      acts.appendChild(button('btn btn-sm', 'حدّث الشاشة', 'ai-reload'));
      row.appendChild(acts);
      log.appendChild(row);
      scrollEnd();
    }, function (e) {
      hideThinking(); setBusy(false);
      if (isAbort(e)) return;
      showError(e.message, function () { applyPreview(btnEl); });
    });
  }

  // ── الالتباس: أربع حالات مختلفة، لكل واحدة شكلها ────────────────────────────
  // لا مطابقة ⟵ الردّ وحده يقولها ولا نعرض قائمة فارغة. مطابقة واحدة ⟵ تُعرض مختارة ومعها
  // كيف يصحّحها. من اثنتين إلى خمس ⟵ أزرار بلا اختيار مسبق. أكثر ⟵ قائمة كاملة تُختار منها.
  function renderChoices(choices, intent, field, msg) {
    var list = choices.map(normOption).filter(Boolean);
    if (!list.length) return;
    var card = el('div', 'ai-card');
    var only = list.length === 1;
    card.appendChild(el('div', 'hd', only ? 'اخترتُ هذا' : 'أيّها تقصد؟'));

    if (list.length > 5) {
      var sel = el('select');
      var pick = el('option', null, 'اختر…');
      pick.value = '';
      sel.appendChild(pick);
      list.forEach(function (o) { var opt = el('option', null, o.label); opt.value = o.id; sel.appendChild(opt); });
      sel.setAttribute('aria-label', 'اختر السجل المقصود');
      card.appendChild(sel);
      var go = button('btn btn-primary btn-sm', 'متابعة', 'ai-choice-go');
      go._select = sel;
      go._list = list;
      go._intent = intent;
      go._field = field;
      go._msg = msg;
      var acts = el('div', 'ai-acts');
      acts.appendChild(go);
      card.appendChild(acts);
      card.appendChild(el('div', 'ai-note', 'المطابقات كثيرة — اختر المقصود من القائمة.'));
    } else {
      var chips = el('div', 'ai-picks');
      list.forEach(function (o) {
        var b = button('ai-chip' + (only ? ' sel' : ''), o.label, 'ai-choice');
        b._choice = o;
        b._intent = intent;
        b._field = field;
        b._msg = msg;
        chips.appendChild(b);
      });
      card.appendChild(chips);
      card.appendChild(el('div', 'ai-note', only
        ? 'إن لم يكن هذا هو المقصود فاكتب اسماً أدقّ وسأبحث من جديد.'
        : 'لن أمضي في أيٍّ منها قبل أن تختار.'));
    }
    var row = el('div', 'ai-msg ai');
    row.appendChild(card);
    log.appendChild(row);
    scrollEnd();
  }

  // ── إرسال سؤال / تشغيل مهمة جاهزة ───────────────────────────────────────────
  // بأي مفتاح يُرسل الاختيار؟ بالمفتاح الذي سمّاه الردّ: كل ردّ يذكر نيّته، وردُّ الالتباس
  // يذكر مع خياراته اسم حقلها. فيعود الاختيار بمفتاح واحد معلوم — مع النصّ الأصلي كي يبقى
  // تصنيف الطلب كما كان. (كان يُرسل بمفتاحين «عسى أن يُقرأ أحدهما»، وبخريطة نوايا محفوظة هنا
  // تتعفّن كلما تغيّر الخادم؛ والنتيجة أن اختيار المستخدم كان يضيع فيُجاب بجواب عام.)
  function optsForChoice(choice, intent, field) {
    var o = {};
    if (intent) o.intent = intent;
    if (field) o[field] = choice.id;
    return o;
  }
  // اختيارٌ ونموذجٌ معروض معاً: الاختيار يملأ حقل النموذج في مكانه — لا رحلة ثانية ولا تخمين.
  function fillOpenForm(choice) {
    var cards = log.querySelectorAll('.ai-card');
    for (var i = cards.length - 1; i >= 0; i--) {
      var st = cards[i]._form;
      if (!st) continue;
      for (var j = 0; j < st.rows.length; j++) {
        var r = st.rows[j];
        if (r.optionFor && r.optionFor(choice.id)) { r.ctl.value = choice.id; sync(st); try { r.ctl.focus(); } catch (e) { /* لا شيء */ } return true; }
      }
    }
    return false;
  }
  function pickChoice(choice, intent, field, msg) {
    if (fillOpenForm(choice)) { say('ai', 'اخترتُ «' + choice.label + '» في النموذج أعلاه — غيّره متى شئت قبل المعاينة.'); return; }
    chat(msg || choice.label, optsForChoice(choice, intent, field), choice.label);
  }

  function handle(res) {
    var text = res && res.reply;
    var choices = (res && Array.isArray(res.choices) && res.choices.length) ? res.choices : null;
    var field = res && (res.choice_field || res.choiceField);
    if (res && typeof res.intent === 'string' && res.intent) lastIntent = res.intent;   // الردّ يعرّف نيّته
    if (text) say('ai', text);
    if (res && res.form) openForm(res.form, null, choices ? { choices: choices, intent: lastIntent, field: field, msg: lastMessage } : null);
    else if (choices) renderChoices(choices, lastIntent, field, lastMessage);
    if (!text && !choices && !(res && res.form)) {
      say('ai', 'لم يصلني ردّ واضح على هذا الطلب. أعد صياغته أو اختر مهمة جاهزة من الأسفل.');
    }
  }

  // display: نصّ يُعرض في فقاعة المستخدم بدل الرسالة المرسلة (زرّ المهمة الجاهزة يرسل نيّته
  // برسالة فارغة — فلا يُستخرَج من عنوان الزرّ اسمُ سجلٍّ ولا عنوانُ مهمة).
  function chat(message, opts, display) {
    if (busy) return;
    lastIntent = (opts && opts.intent) || null;
    lastMessage = message;
    if (typeof display === 'string' && display) say('me', display);
    else if (display !== false) say('me', message);
    setBusy(true);
    showThinking();
    var body = { message: message };
    if (opts) body.opts = opts;
    ask('/chat', 'POST', body).then(function (res) {
      hideThinking(); setBusy(false);
      handle(res);
    }, function (e) {
      hideThinking(); setBusy(false);
      if (isAbort(e)) return;
      showError(e.message, function () { chat(message, opts, false); });
    });
  }

  function send() {
    var msg = (input.value || '').trim();
    if (!msg || busy) return;
    input.value = '';
    chat(msg, null, true);
  }

  // ── فتح/إغلاق ───────────────────────────────────────────────────────────────
  function rehydrate() {
    clearLog();
    if (!hist.length) { emptyState(); return; }
    hist.forEach(function (m) { bubble(m.r === 'me' ? 'me' : 'ai', m.t); });
  }
  var hydrated = false;
  function openPanel() {
    if (isOpen) return;
    if (!hydrated) { hydrated = true; load(); rehydrate(); }   // قبل الإظهار: لا يُقرأ السجل القديم بصوتٍ عالٍ
    isOpen = true;
    panel.hidden = false;
    if (fab) fab.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKey, true);
    boot();
    scrollEnd();
    try { input.focus(); } catch (e) { /* لا شيء */ }
  }
  function closePanel() {
    if (!isOpen) return;
    isOpen = false;
    abortAll();
    hideThinking();
    setBusy(false);
    panel.hidden = true;
    if (fab) { fab.setAttribute('aria-expanded', 'false'); try { fab.focus(); } catch (e) { /* لا شيء */ } }
    document.removeEventListener('keydown', onKey, true);
  }

  function focusables() {
    var nodes = panel.querySelectorAll('button,select,textarea,input,a[href],[tabindex]:not([tabindex="-1"])');
    return Array.prototype.filter.call(nodes, function (n) { return !n.disabled && n.offsetParent !== null; });
  }
  function onKey(e) {
    if (!isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); return; }
    if (e.key === 'Enter' && e.target === input) { e.preventDefault(); send(); return; }
    if (e.key === 'Tab') {
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1], cur = document.activeElement;
      if (!panel.contains(cur)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); return; }
      if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    }
  }

  // ── التفويض ─────────────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!t) return;
    var a = t.getAttribute('data-action');
    if (a === 'ai-toggle') { e.preventDefault(); return void (isOpen ? closePanel() : openPanel()); }
    if (a === 'ai-close') { e.preventDefault(); return void closePanel(); }
    if (!isOpen) return;
    if (a === 'ai-send') { e.preventDefault(); return void send(); }
    if (a === 'ai-clear') {
      e.preventDefault();
      forget(); clearLog(); emptyState();
      try { input.focus(); } catch (err) { /* لا شيء */ }
      return;
    }
    if (a === 'ai-retry') {
      e.preventDefault();
      var again = t._again;
      var host = t.closest('.ai-msg');
      if (host && host.parentNode) host.parentNode.removeChild(host);
      if (again) again();
      return;
    }
    if (a === 'ai-cap') {
      e.preventDefault();
      var c = t._cap;
      if (c) chat('', { intent: c.intent }, c.label_ar);
      return;
    }
    if (a === 'ai-choice') {
      e.preventDefault();
      if (t._choice) pickChoice(t._choice, t._intent, t._field, t._msg);
      return;
    }
    if (a === 'ai-choice-go') {
      e.preventDefault();
      var sel = t._select;
      if (!sel || !sel.value) return;
      var picked = null;
      for (var i = 0; i < t._list.length; i++) if (t._list[i].id === sel.value) picked = t._list[i];
      if (picked) pickChoice(picked, t._intent, t._field, t._msg);
      return;
    }
    if (a === 'ai-form-submit') { e.preventDefault(); return void submitForm(t._card); }
    if (a === 'ai-form-cancel') {
      e.preventDefault();
      dropNode(t._card || t.closest('.ai-card') || t.closest('.ai-prev'));
      say('ai', 'أُلغي التغيير ولم يُنفَّذ شيء.');
      return;
    }
    if (a === 'ai-form-again') { e.preventDefault(); return void openForm(t._form, t._values); }
    if (a === 'ai-confirm') { e.preventDefault(); return void applyPreview(t); }
    if (a === 'ai-reload') { e.preventDefault(); return void window.location.reload(); }
  });
})();
