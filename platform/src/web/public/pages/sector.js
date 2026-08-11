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
  function openDD(el) {
    var k = el.getAttribute('data-dd');
    if (!k || !window.Sanad || !Sanad.openDD) return;
    Sanad.openDD(k);
    var close = document.querySelector('#modal .modal-head button');
    if (close) close.focus();
  }

  // ── مقياس القمع: بالقيمة (الافتراضي) أو بالعدد — العرضان محسوبان سلفاً على الخادم ──
  function funnelMode(btn) {
    var mode = btn.getAttribute('data-mode');
    pressGroup(btn, 'button[data-action="fnl-mode"]');
    document.querySelectorAll('.fnl-bar').forEach(function (bar) {
      var w = bar.getAttribute(mode === 'count' ? 'data-wc' : 'data-wv');
      if (w != null) bar.style.width = w + '%';
    });
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
    document.querySelectorAll('.cap-av').forEach(function (av) {
      var v = Number(av.getAttribute('data-' + w) || 0);
      av.style.left = (Math.min(125, Math.max(0, v)) / 125 * 100).toFixed(1) + '%';
      var name = av.getAttribute('data-name') || '';
      var job = av.getAttribute('data-job') || '';
      av.title = name + (job ? ' · ' + job : '') + ' — الحِمل ' + v + '%';
      av.setAttribute('aria-label', name + ' — الحِمل ' + v + '%');
      av.classList.toggle('over', v > 110);
      av.classList.toggle('free', v === 0);
    });
    var cap = document.getElementById('cap-caption');
    if (cap) cap.textContent = 'النافذة: ' + btn.textContent.trim() + ' · الحدود من قواعد التسكين نفسها: 70% و110%';
  }

  // الضغط على شخصٍ في الطيف يفتح لوحة التسكين — رابطها محمول على المحور نفسه
  function capPerson(el) {
    var axis = el.closest('.cap-axis');
    var href = axis && axis.getAttribute('data-staffing');
    if (href) location.assign(href);
  }

  function reportPreview(el) { if (window.Sanad && Sanad.previewReport) Sanad.previewReport(el.getAttribute('data-report')); }
  function reportSend(el) { if (window.Sanad && Sanad.testSend) Sanad.testSend(el.getAttribute('data-report')); }

  var ACTIONS = {
    'open-dd': openDD,
    'fnl-mode': funnelMode,
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
  on(document, 'keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target.closest('[role="button"]');
    if (!el) return;
    var fn = ACTIONS[el.getAttribute('data-action') || ''];
    e.preventDefault();
    if (fn) fn(el); else el.click();
  });
})();
