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
    var axisMax = Number(axis && axis.getAttribute('data-axis-max')) || 125;
    document.querySelectorAll('.cap-av').forEach(function (av) {
      var v = Number(av.getAttribute('data-' + w) || 0);
      av.style.left = (Math.min(axisMax, Math.max(0, v)) / axisMax * 100).toFixed(1) + '%';
      var name = av.getAttribute('data-name') || '';
      var job = av.getAttribute('data-job') || '';
      av.title = name + (job ? ' · ' + job : '') + ' — الحِمل ' + v + '%';
      av.setAttribute('aria-label', name + ' — الحِمل ' + v + '% — التفصيل');
      av.classList.toggle('over', v > over);
      av.classList.toggle('free', v === 0);
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

  var ACTIONS = {
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
