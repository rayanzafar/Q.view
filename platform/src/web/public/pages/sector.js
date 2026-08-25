// مركز القيادة — تفاعلات الصفحة وحدها، بلا جلب بيانات: كل رقم حُسب على الخادم بنطاق صاحبه،
// وهنا نبدّل طرق عرضه فقط (مقياس القمع، فئات «ما تغيّر»، نافذة طيف الحِمل) ونفتح التفصيل.
// التفويض بـdata-action لا onclick — قاعدة المنصة، وapp.js مجمَّد.
(function () {
  'use strict';

  function on(root, evt, fn) { root.addEventListener(evt, fn); }
  function pressGroup(btn, selector) {
    var scope = btn.closest('.seg') || btn.parentElement;
    scope.querySelectorAll(selector).forEach(function (b) {
      var onB = b === btn;
      b.classList.toggle('on', onB);
      b.setAttribute('aria-pressed', onB ? 'true' : 'false');
    });
  }

  // ── فتح التفصيل: قوالب dd المخدومة من الخادم — والتركيز يدخل النافذة لا يبقى خلفها ──
  // مَن فتح النافذة من الصفحة (لا من داخل نافذةٍ أخرى) يعود إليه التركيز عند الإغلاق — والفتح
  // المتداخل (الفريق ← الإدارة ← الشخص) يُبقي المُطلِق الأول لأن محتوى النافذة يُستبدل.
  var lastTrigger = null;
  function remember(el) { if (!el.closest('#modal')) lastTrigger = el; }
  function openDD(el) {
    var k = el.getAttribute('data-dd');
    if (!k || !window.Sanad || !Sanad.openDD) return;
    remember(el);
    Sanad.openDD(k);
    var close = document.querySelector('#modal .modal-head button');
    if (close) close.focus();
  }

  // ── فئات «ما تغيّر»: ترشيحُ عرضٍ محض على صفوف حاضرة — لا طلب جديد ──
  // حالة «عرض الكل» تُقرأ من مصدر واحد (data-shown التي يكتبها زر التوسيع)، لا من وضع الإخفاء
  // اللحظي — وإلا بقيت فئةٌ زارها القارئ مفتوحةً عند عودته إلى «الكل» وغيرها مطوية.
  function chgCat(btn) {
    var cat = btn.getAttribute('data-cat');
    pressGroup(btn, '.chg-cat');
    var list = document.getElementById('chg-list');
    if (!list) return;
    var shown = 0;
    list.querySelectorAll('.chg').forEach(function (row) {
      var okCat = cat === 'all' || row.getAttribute('data-cat') === cat;
      var okMore = cat !== 'all' || !row.hasAttribute('data-extra') || row.getAttribute('data-shown') === '1';
      row.hidden = !(okCat && okMore);
      if (!row.hidden) shown++;
    });
    var empty = document.getElementById('chg-cat-empty');
    if (!shown) {
      if (!empty) {
        empty = document.createElement('div');
        empty.id = 'chg-cat-empty';
        empty.style.cssText = 'padding:1rem;text-align:center;color:var(--muted);font-size:12px';
        empty.textContent = 'لا تغييرات من هذه الفئة خلال هذه الفترة';
        list.appendChild(empty);
      }
    } else if (empty) empty.remove();
  }

  // ── «عرض كل التغييرات»: يكشف البقية ويثبّت الحالة في data-shown ──
  function chgMore(btn) {
    document.querySelectorAll('#chg-list .chg[data-extra]').forEach(function (row) {
      row.hidden = false; row.setAttribute('data-shown', '1');
    });
    btn.closest('div').remove();
  }

  // ── نافذة طيف الحِمل: هذا الشهر / القادم / متوسط الثلاثة — المواضع محسوبة سلفاً ──
  function capWin(btn) {
    var w = btn.getAttribute('data-w');
    pressGroup(btn, 'button[data-action="cap-win"]');
    // العتبات ومقياس المحور من الخادم (سماتٌ على المحور) — لا نسخة ثانية هنا تتباعد عن المصدر.
    var axis = document.querySelector('.cap-axis');
    var over = Number(axis && axis.getAttribute('data-over')) || 110;
    var free = Number(axis && axis.getAttribute('data-free')) || 70;
    var axisMax = Number(axis && axis.getAttribute('data-axis-max')) || 125;
    document.querySelectorAll('.cap-av').forEach(function (av) {
      var v = Number(av.getAttribute('data-' + w) || 0);
      // مروحة المتساوين محفوظة على العنصر: من دونها يعود أربعة عشر شخصاً إلى نقطةٍ واحدة
      // عند تبديل النافذة، فيختفي أحد عشر منهم تحت غيرهم رغم أن التعليق يَعِد بنقرهم.
      var fan = Number(av.getAttribute('data-fan') || 0);
      var pos = Math.min(axisMax, Math.max(0, v)) / axisMax * 100;
      av.style.left = Math.min(100, pos + fan).toFixed(1) + '%';
      var name = av.getAttribute('data-name') || '';
      var job = av.getAttribute('data-job') || '';
      av.title = name + (job ? ' · ' + job : '') + ' — الحِمل ' + v + '%';
      av.setAttribute('aria-label', name + ' — الحِمل ' + v + '% — التفصيل');
      av.classList.toggle('over', v > over);
      av.classList.toggle('free', v === 0);
      av.classList.toggle('under', v > 0 && v < free);
    });
    var cap = document.getElementById('cap-caption');
    if (cap) cap.textContent = 'النافذة: ' + btn.textContent.trim() + ' · ' + (cap.getAttribute('data-tail') || '');
  }

  // الضغط على شخصٍ — في الطيف أو في القائمتين أو في نافذة «فوق الطاقة» — يفتح نافذته هنا
  // (قالبها مخدوم من الخادم بنطاق القارئ). ومن لا قالب له (طبقة بلا أسماء) يبقى على لوحة التسكين.
  function capPerson(el) {
    var id = el.getAttribute('data-emp');
    if (id && document.getElementById('dd-cap-emp-' + id)) {
      remember(el);
      Sanad.openDD('cap-emp-' + id);
      var close = document.querySelector('#modal .modal-head button');
      if (close) close.focus();
      return;
    }
    var axis = el.closest('.cap-axis') || document.querySelector('.cap-axis');
    var href = axis && axis.getAttribute('data-staffing');
    if (href) location.assign(href);
  }

  // «يحتاج تدخلك» في الشريط يقفز إلى قائمته في طبقة «ماذا أفعل اليوم؟» ويركّز أول بند
  function actJump() {
    var h = document.getElementById('act');
    if (!h) return;
    h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var first = h.parentElement && h.parentElement.querySelector('.act-r .go, .card-foot a');
    if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 350);
  }

  function reportPreview(el) { if (window.Sanad && Sanad.previewReport) Sanad.previewReport(el.getAttribute('data-report')); }
  function reportSend(el) { if (window.Sanad && Sanad.testSend) Sanad.testSend(el.getAttribute('data-report')); }

  // ── تلميح الرسوم الحيّ: شريحة الشهر تلتقط المؤشر، فيخرج التلميح فوراً ومعه خيط تتبّع ──
  // البديل كان <title> الأصلي: هدفه نقطةٌ بقطر 2.5 ويتأخر ثانية ولا يترك أثراً — يُقرأ ساكناً.
  // والقيم نفسها متاحة بلوحة المفاتيح: الرسم قابل للتركيز والأسهم تتنقّل بين شهوره.
  var tipEl = null;
  function tip() {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'fig-tip'; tipEl.hidden = true; document.body.appendChild(tipEl); }
    return tipEl;
  }
  function showTip(hit, evt) {
    var svg = hit.ownerSVGElement;
    if (!svg) return;
    var rows = (hit.getAttribute('data-rows') || '').split('|').filter(Boolean).map(function (r) {
      var p = r.split('=');
      return '<span class="r"><span>' + p[0] + '</span><b>' + (p[1] || '') + '</b></span>';
    }).join('');
    var t = tip();
    t.innerHTML = '<span class="t">' + (hit.getAttribute('data-l') || '') + '</span>' + rows;
    t.hidden = false;
    // خيط التتبّع على إحداثيات الرسم نفسه (viewBox) لا الشاشة
    var xh = svg.querySelector('.fig-xhair');
    if (xh) {
      var x = hit.getAttribute('data-x');
      xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('opacity', '.45');
    }
    var box = hit.getBoundingClientRect();
    var cx = evt && evt.clientX != null ? evt.clientX : box.left + box.width / 2;
    var cy = evt && evt.clientY != null ? evt.clientY : box.top + box.height / 2;
    var tw = t.offsetWidth, th = t.offsetHeight;
    var left = Math.min(Math.max(8, cx - tw / 2), window.innerWidth - tw - 8);
    var top = cy - th - 14;
    if (top < 8) top = cy + 18;
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  }
  function hideTip(svg) {
    if (tipEl) tipEl.hidden = true;
    var host = svg || document;
    host.querySelectorAll ? host.querySelectorAll('.fig-xhair').forEach(function (x) { x.setAttribute('opacity', '0'); })
      : null;
  }
  on(document, 'mousemove', function (e) {
    var hit = e.target.closest ? e.target.closest('.fig-hit') : null;
    if (hit) showTip(hit, e);
    else if (tipEl && !tipEl.hidden) hideTip(document);
  });
  on(document, 'mouseleave', function (e) {
    if (e.target.closest && e.target.closest('.fig-live')) hideTip(e.target.closest('.fig-live'));
  }, true);
  // لوحة المفاتيح: الأسهم تتنقّل بين شهور الرسم المركَّز، وEscape يخفي التلميح
  on(document, 'keydown', function (e) {
    var svg = document.activeElement && document.activeElement.classList
      && document.activeElement.classList.contains('fig-live') ? document.activeElement : null;
    if (!svg) return;
    var hits = [].slice.call(svg.querySelectorAll('.fig-hit'));
    if (!hits.length) return;
    if (e.key === 'Escape') { hideTip(svg); return; }
    var dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    var cur = Number(svg.getAttribute('data-cur') || -1);
    var next = Math.min(hits.length - 1, Math.max(0, cur < 0 ? 0 : cur + dir));
    svg.setAttribute('data-cur', String(next));
    showTip(hits[next], null);
  });

  // ── فصولٌ بألسنة: كلها مُصيَّرة، والتبديل إخفاءٌ وإظهار بلا جلب ──────────────────────────
  // اللسان يُكتب في الرابط (replaceState) فيبقى بعد التحديث ويُشارَك — ونمطُ tablist كامل:
  // aria-selected وroving tabindex وتنقّلٌ بالأسهم وHome/End كما يتوقع مستخدم لوحة المفاتيح.
  function showTab(key, focus) {
    var tabs = [].slice.call(document.querySelectorAll('[role="tab"][data-tab]'));
    if (!tabs.length) return;
    tabs.forEach(function (b) {
      var on = b.getAttribute('data-tab') === key;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('on', on);
      var panel = document.getElementById('sec-panel-' + b.getAttribute('data-tab'));
      if (panel) panel.hidden = !on;
      if (on && focus) b.focus();
    });
    try {
      var u = new URL(location.href);
      u.searchParams.set('tab', key);
      history.replaceState(null, '', u.pathname + u.search);
    } catch (e) { /* لا يمنع التبديل */ }
    if (tipEl) tipEl.hidden = true;          // تلميحُ رسمٍ في فصلٍ اختفى لا يبقى معلَّقاً
  }
  function secTab(el) { showTab(el.getAttribute('data-tab'), false); }
  on(document, 'keydown', function (e) {
    var cur = e.target.closest && e.target.closest('[role="tab"][data-tab]');
    if (!cur) return;
    var tabs = [].slice.call(document.querySelectorAll('[role="tab"][data-tab]'));
    var i = tabs.indexOf(cur), n = tabs.length, next = -1;
    // في RTL يقرأ السهم الأيمن «السابق» — والترتيب البصري هو المرجع
    if (e.key === 'ArrowLeft') next = (i + 1) % n;
    else if (e.key === 'ArrowRight') next = (i - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    showTab(tabs[next].getAttribute('data-tab'), true);
  });

  var ACTIONS = {
    'sec-tab': secTab,
    'open-dd': openDD,
    'act-jump': actJump,
    'chg-cat': chgCat,
    'chg-more': chgMore,
    'cap-win': capWin,
    'cap-person': capPerson,
    'report-preview': reportPreview,
    'report-send': reportSend,
  };

  on(document, 'click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var fn = ACTIONS[el.getAttribute('data-action')];
    if (fn) { e.preventDefault(); fn(el); }
  });
  // بطاقات لها دور زر تُفتح بلوحة المفاتيح أيضاً — Enter والمسافة. ومنها بطاقات «الإيقاع»
  // المبنية في مكوّن مشترك بنقرة داخلية بلا data-action: تُنقَر برمجياً فلا تبقى صمّاء.
  // إغلاق نافذة الشخص (Esc أو زر الإغلاق) يعيد التركيز إلى الصفّ أو الصورة التي فتحتها — كي لا
  // يفقد مستخدم لوحة المفاتيح موضعه في القائمة. التأجيل لأن الإغلاق نفسه يجري في app.js بعدنا.
  function restoreFocus() {
    var t = lastTrigger; lastTrigger = null;
    if (t && document.contains(t)) setTimeout(function () { t.focus(); }, 0);
  }
  on(document, 'keydown', function (e) { if (e.key === 'Escape' && lastTrigger) restoreFocus(); });
  // قائمة «التقارير» تُغلق بالهروب وبالنقر خارجها — كسائر نوافذ الصفحة
  function closeMenu(refocus) {
    var m = document.querySelector('.rmenu[open]');
    if (!m) return;
    m.removeAttribute('open');
    if (refocus) { var sm = m.querySelector('summary'); if (sm) sm.focus(); }
  }
  on(document, 'keydown', function (e) { if (e.key === 'Escape') closeMenu(true); });
  on(document, 'click', function (e) { if (!e.target.closest('.rmenu')) closeMenu(false); });
  on(document, 'click', function (e) {
    if (lastTrigger && e.target.closest('#modal .modal-head button')) restoreFocus();
  });
  on(document, 'keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target.closest('[role="button"]');
    if (!el) return;
    var fn = ACTIONS[el.getAttribute('data-action') || ''];
    e.preventDefault();
    if (fn) fn(el); else el.click();
  });
})();
