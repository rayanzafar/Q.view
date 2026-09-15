// الجولة الإرشادية — طبقة شرح فوق الشاشة نفسها: تُعتّم الصفحة، وتُبرز العنصر المقصود، وتضع
// بجانبه بطاقة صغيرة فيها عنوان الخطوة وشرحها وعدّادها. تُفتح من زر «جولة إرشادية» في أعلى كل
// شاشة، أو تلقائياً حين يصل المستخدم من دليله برابط الجولة.
//
// قواعد ثابتة في هذا الملف:
//   • خطوة لا نجد عنصرها على الشاشة تُتجاوز بصمت. الشاشات تتغيّر، والجولة لا يجوز أن تنكسر معها؛
//     وإن لم يبقَ عنصر واحد تظهر رسالة عربية هادئة لا شاشة معطّلة.
//   • «إنهاء» و«Esc» يعملان دائماً — لا حبس للمستخدم داخل الطبقة أبداً.
//   • الاتجاه عربي: السهم الأيسر يتقدّم (اتجاه القراءة)، والأيمن يرجع.
//   • كل نص يأتي من الخادم يُوضع كنص لا كوسوم (textContent) — لا تركيب وسوم من محتوى.
(function () {
  'use strict';

  var CSS_ID = 'tourx-style';
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var ui = null;          // { block, ring, card, head, body, foot, … }
  var steps = [];         // خطوات وجدنا عناصرها فعلاً
  var idx = 0;
  var lastFocus = null;
  var busy = false;

  // ── المفتاح الحالي للشاشة (يمرّره الهيكل العام) ──
  function pageKey() {
    var btn = document.querySelector('[data-action="tour-start"]');
    var k = (btn && btn.getAttribute('data-page')) || (document.body && document.body.getAttribute('data-page')) || '';
    return String(k).trim();
  }

  // ── التنسيق (يُحقن مرة واحدة عند أول فتح) ──
  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = [
      '.tourx-block{position:fixed;inset:0;z-index:1000}',
      '.tourx-dim{position:fixed;inset:0;z-index:1001;background:rgba(15,23,42,.55);pointer-events:none}',
      '.tourx-ring{position:fixed;z-index:1001;border-radius:12px;pointer-events:none;',
      '  box-shadow:0 0 0 3px rgba(36,74,153,.9),0 0 0 9999px rgba(15,23,42,.55);',
      '  transition:top .2s ease,left .2s ease,width .2s ease,height .2s ease}',
      '.tourx-card{position:fixed;z-index:1002;width:340px;max-width:calc(100vw - 24px);',
      '  background:var(--surface,#fff);border:1px solid var(--line,#e6e9f0);border-radius:14px;',
      '  box-shadow:0 18px 44px rgba(15,23,42,.28);overflow:hidden;font-size:13px;color:var(--ink2,#1e293b)}',
      '.tourx-card:focus{outline:none}',
      '.tourx-center{top:50%;left:50%;transform:translate(-50%,-50%)}',
      '.tourx-head{display:flex;align-items:center;gap:.5rem;padding:.55rem .8rem;border-bottom:1px solid var(--line,#e6e9f0);background:var(--bg,#f6f7fb)}',
      '.tourx-kicker{flex:1;min-width:0;font-size:10.5px;font-weight:800;letter-spacing:.04em;color:var(--muted,#5b6472);',
      '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tourx-x{flex:0 0 auto;border:none;background:none;cursor:pointer;color:var(--muted,#5b6472);',
      '  font-family:inherit;font-size:14px;line-height:1;padding:.2rem .35rem;border-radius:7px}',
      '.tourx-x:hover{background:#eef1f7;color:var(--ink2,#1e293b)}',
      '.tourx-body{padding:.75rem .85rem}',
      '.tourx-t{font-size:13.5px;font-weight:800;color:var(--ink2,#1e293b);line-height:1.6}',
      '.tourx-b{margin-top:.25rem;font-size:12.5px;color:var(--muted,#5b6472);line-height:1.85}',
      '.tourx-foot{display:flex;align-items:center;gap:.4rem;padding:.6rem .85rem;border-top:1px solid var(--line,#e6e9f0);background:var(--bg,#f6f7fb)}',
      '.tourx-count{font-size:11.5px;font-weight:700;color:var(--muted,#5b6472);flex:0 0 auto}',
      '.tourx-sp{flex:1 1 auto}',
      '.tourx-foot .btn,.tourx-msg-acts .btn{font-family:inherit}',
      '.tourx-msg-acts{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.75rem}',
      '@media(max-width:420px){.tourx-card{width:calc(100vw - 24px)}}',
      '@media (prefers-reduced-motion: reduce){.tourx-ring{transition:none}}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── بناء الطبقة ──
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(cls, label, action) {
    var b = el('button', cls, label);
    b.type = 'button';
    b.setAttribute('data-action', action);
    return b;
  }

  function shell() {
    ensureCss();
    if (ui) return ui;
    lastFocus = document.activeElement;

    var block = el('div', 'tourx-block');
    var dim = el('div', 'tourx-dim');
    var ring = el('div', 'tourx-ring');
    ring.style.display = 'none';

    var card = el('div', 'tourx-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'جولة إرشادية');
    card.tabIndex = -1;

    var head = el('div', 'tourx-head');
    var kicker = el('span', 'tourx-kicker', 'جولة إرشادية');
    var x = btn('tourx-x', '✕', 'tour-end');
    x.setAttribute('aria-label', 'إنهاء الجولة');
    head.appendChild(kicker); head.appendChild(x);

    var body = el('div', 'tourx-body');
    body.setAttribute('aria-live', 'polite');
    var foot = el('div', 'tourx-foot');

    card.appendChild(head); card.appendChild(body); card.appendChild(foot);
    document.body.appendChild(block);
    document.body.appendChild(dim);
    document.body.appendChild(ring);
    document.body.appendChild(card);

    ui = { block: block, dim: dim, ring: ring, card: card, kicker: kicker, body: body, foot: foot };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return ui;
  }

  function end() {
    if (!ui) return;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onMove);
    window.removeEventListener('scroll', onMove, true);
    [ui.block, ui.dim, ui.ring, ui.card].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    ui = null; steps = []; idx = 0; busy = false;
    if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch (e) { /* لا شيء */ } }
    lastFocus = null;
  }

  // ── الرسائل الهادئة (لا جولة / تغيّرت الشاشة / تعذّر الفتح) ──
  function message(title, text, retry) {
    var u = shell();
    steps = [];
    u.ring.style.display = 'none';
    u.dim.style.display = '';
    u.kicker.textContent = 'جولة إرشادية';
    u.body.textContent = '';
    u.foot.textContent = '';
    u.body.appendChild(el('div', 'tourx-t', title));
    u.body.appendChild(el('div', 'tourx-b', text));
    var acts = el('div', 'tourx-msg-acts');
    var a = el('a', 'btn btn-sm', 'افتح دليلي');
    a.href = '/app/guide';
    acts.appendChild(a);
    if (retry) acts.appendChild(btn('btn btn-sm', 'أعد المحاولة', 'tour-retry'));
    acts.appendChild(btn('btn btn-primary btn-sm', 'إغلاق', 'tour-end'));
    u.body.appendChild(acts);
    u.card.className = 'tourx-card tourx-center';
    u.card.style.top = ''; u.card.style.left = ''; u.card.style.transform = '';
    focusFirst();
  }

  // ── عناصر الخطوات ──
  function resolve(step) {
    if (!step || typeof step.anchor !== 'string' || !step.anchor.trim()) return null;
    var node;
    try { node = document.querySelector(step.anchor); } catch (e) { return null; }  // محدِّد قديم لا يكسر الجولة
    if (!node) return null;
    var r = node.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    var cs = window.getComputedStyle(node);
    if (cs.visibility === 'hidden' || cs.display === 'none') return null;
    return node;
  }

  function place(rect) {
    var u = ui;
    var vw = window.innerWidth, vh = window.innerHeight;
    var pad = 12;
    u.card.className = 'tourx-card';   // خارج وضع التوسيط: الموضع بالإحداثيات لا بالتحويل
    u.card.style.transform = '';
    var w = u.card.offsetWidth, h = u.card.offsetHeight;
    var top;
    if (rect.bottom + pad + h <= vh - pad) top = rect.bottom + pad;
    else if (rect.top - pad - h >= pad) top = rect.top - pad - h;
    else top = Math.max(pad, Math.min(vh - h - pad, rect.top));
    // اتجاه عربي: حافة البطاقة اليمنى تُحاذي حافة العنصر اليمنى، ثم تُحبس داخل الشاشة.
    var left = rect.right - w;
    left = Math.max(pad, Math.min(vw - w - pad, left));
    u.card.style.top = Math.round(top) + 'px';
    u.card.style.left = Math.round(left) + 'px';
  }

  function frame(node) {
    var r = node.getBoundingClientRect();
    var pad = 6;
    var u = ui;
    u.ring.style.display = '';
    u.dim.style.display = 'none';
    u.ring.style.top = Math.max(0, r.top - pad) + 'px';
    u.ring.style.left = Math.max(0, r.left - pad) + 'px';
    u.ring.style.width = Math.min(window.innerWidth, r.width + pad * 2) + 'px';
    u.ring.style.height = Math.min(window.innerHeight, r.height + pad * 2) + 'px';
    place({ top: r.top - pad, bottom: r.bottom + pad, left: r.left - pad, right: r.right + pad });
  }

  var moving = false;
  function onMove() {
    if (!ui || !steps.length || moving) return;
    moving = true;
    window.requestAnimationFrame(function () {
      moving = false;
      if (!ui || !steps.length) return;
      var node = resolve(steps[idx]);
      if (node) frame(node);
    });
  }

  function num(v) {
    var s = document.createElement('span');
    s.className = 'tnum';
    s.textContent = String(v);
    return s;
  }

  function render() {
    if (!ui || !steps.length) return;
    var u = ui;
    if (idx < 0) idx = 0;
    if (idx > steps.length - 1) idx = steps.length - 1;
    var node = resolve(steps[idx]);
    if (!node) {                       // اختفى العنصر أثناء الجولة — نتجاوزه بصمت
      steps.splice(idx, 1);
      if (!steps.length) return message('تغيّرت هذه الشاشة', 'لم نعد نجد العناصر التي أُعدّت لها هذه الجولة. دليلك يشرح الشاشة خطوة بخطوة إلى أن تُحدَّث الجولة.', false);
      if (idx > steps.length - 1) idx = steps.length - 1;
      return render();
    }
    var st = steps[idx];
    u.body.textContent = '';
    u.body.appendChild(el('div', 'tourx-t', st.title_ar || 'خطوة من الجولة'));
    u.body.appendChild(el('div', 'tourx-b', st.body_ar || ''));

    u.foot.textContent = '';
    var count = el('span', 'tourx-count');
    count.appendChild(num(idx + 1));
    count.appendChild(document.createTextNode(' من '));
    count.appendChild(num(steps.length));
    u.foot.appendChild(count);
    u.foot.appendChild(el('span', 'tourx-sp'));
    if (idx > 0) u.foot.appendChild(btn('btn btn-sm', 'السابق', 'tour-prev'));
    u.foot.appendChild(idx === steps.length - 1
      ? btn('btn btn-primary btn-sm', 'إنهاء', 'tour-end')
      : btn('btn btn-primary btn-sm', 'التالي', 'tour-next'));

    try { node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); }
    catch (e) { node.scrollIntoView(); }
    frame(node);
    window.requestAnimationFrame(function () { if (ui && steps.length) { var n2 = resolve(steps[idx]); if (n2) frame(n2); } });
    focusFirst();
  }

  function focusFirst() {
    if (!ui) return;
    var f = ui.card.querySelector('.btn-primary') || ui.card.querySelector('button,a[href]') || ui.card;
    try { f.focus(); } catch (e) { /* لا شيء */ }
  }

  function step(dir) {
    if (!steps.length) return;
    var i = idx + dir;
    while (i >= 0 && i < steps.length && !resolve(steps[i])) i += dir;
    if (i < 0) return;                 // نحن في أول خطوة
    if (i > steps.length - 1) return end();
    idx = i; render();
  }

  // ── لوحة المفاتيح: حبس التركيز داخل البطاقة + التنقل باتجاه القراءة العربية ──
  function focusables() {
    if (!ui) return [];
    return Array.prototype.filter.call(
      ui.card.querySelectorAll('button,a[href],[tabindex]:not([tabindex="-1"])'),
      function (n) { return !n.disabled && n.offsetParent !== null; });
  }
  function onKey(e) {
    if (!ui) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return end(); }
    if (e.key === 'Tab') {
      var f = focusables();
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      var cur = document.activeElement;
      if (!ui.card.contains(cur)) { e.preventDefault(); return void first.focus(); }
      if (e.shiftKey && cur === first) { e.preventDefault(); return void last.focus(); }
      if (!e.shiftKey && cur === last) { e.preventDefault(); return void first.focus(); }
      return;
    }
    if (!steps.length) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); return step(1); }   // العربية تُقرأ يميناً ⟵ يساراً
    if (e.key === 'ArrowRight') { e.preventDefault(); return step(-1); }
  }

  // سبب الخادم يُعرض حرفياً متى كان عربياً موجَّهاً للمستخدم؛ وغيره لا يُعرض أبداً.
  async function arabicReason(r) {
    try {
      var j = await r.json();
      var m = j && j.error && j.error.message;
      return (typeof m === 'string' && /[؀-ۿ]/.test(m)) ? m : '';
    } catch (e) { return ''; }
  }

  // ── الفتح ──
  async function start() {
    if (busy) return;
    var key = pageKey();
    if (!key) return message('لا توجد جولة لهذه الشاشة بعد', 'هذه الشاشة لم تُضف إلى الجولات حتى الآن. دليلك يشرح شاشاتك واحدة واحدة.', false);
    busy = true;
    var u = shell();
    u.ring.style.display = 'none';
    u.dim.style.display = '';
    u.body.textContent = '';
    u.foot.textContent = '';
    u.body.appendChild(el('div', 'tourx-t', 'جارٍ فتح الجولة…'));
    u.card.className = 'tourx-card tourx-center';
    u.card.style.top = ''; u.card.style.left = '';

    var data = null, failed = false, said = '';
    try {
      var r = await fetch('/api/guide/tour/' + encodeURIComponent(key), { credentials: 'include' });
      if (r.ok) data = await r.json();
      else if (r.status === 404) said = await arabicReason(r);   // «لا جولة لهذه الشاشة» بلسان الخادم
      else failed = true;
    } catch (e) { failed = true; }
    busy = false;
    if (!ui) return;                                   // أُنهيت الجولة أثناء الانتظار

    if (failed) {
      return message('تعذّر فتح الجولة الآن', 'لم يصل شرح هذه الشاشة. تحقّق من الاتصال ثم أعد المحاولة، وإن تكرّر الأمر أبلغ مدير النظام.', true);
    }
    var raw = (data && Array.isArray(data.steps)) ? data.steps : [];
    if (!raw.length) {
      return message('لا توجد جولة لهذه الشاشة بعد',
        said || 'هذه الشاشة لم تُضف إلى الجولات حتى الآن. دليلك يشرح شاشاتك واحدة واحدة، وابدأ منه متى شئت.', false);
    }
    steps = raw.filter(function (s) { return !!resolve(s); });    // خطوة بلا عنصر: تُتجاوز بصمت
    if (!steps.length) {
      return message('تغيّرت هذه الشاشة', 'العناصر التي أُعدّت لها هذه الجولة لم تعد ظاهرة هنا. دليلك يشرح الشاشة خطوة بخطوة إلى أن تُحدَّث الجولة.', false);
    }
    idx = 0;
    var t = data && data.title_ar;
    u.kicker.textContent = (typeof t === 'string' && t.trim()) ? t.trim() : 'جولة إرشادية';
    render();
  }

  // ── التفويض ──
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!t) return;
    var a = t.getAttribute('data-action');
    if (a === 'tour-start') { e.preventDefault(); return void start(); }
    if (a === 'tour-next') { e.preventDefault(); return void step(1); }
    if (a === 'tour-prev') { e.preventDefault(); return void step(-1); }
    if (a === 'tour-end') { e.preventDefault(); return void end(); }
    if (a === 'tour-retry') { e.preventDefault(); end(); return void start(); }
  });

  // ── البدء التلقائي: وصل المستخدم من دليله برابط الجولة ──
  function autoStart() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    if (q.get('tour') !== '1') return;
    q.delete('tour');
    var s = q.toString();
    try { history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash); } catch (e) { /* لا شيء */ }
    start();
  }
  if (document.readyState === 'complete') setTimeout(autoStart, 120);
  else window.addEventListener('load', function () { setTimeout(autoStart, 120); });
})();
