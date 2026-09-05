// عميل S12 — العمل والالتزامات: تغيير أي فلتر يرسل النموذج فوراً (والزر يبقى لمن لا يشغّل السكربت)،
// وزرّ «توسيع الكل/طيّ الكل» فوق عناصر <details> المبنية على الخادم. تفويض data-action فقط.
(function () {
  'use strict';
  var form = document.getElementById('tm-work-filters');
  if (form) {
    var apply = document.getElementById('tm-work-apply');
    if (apply) apply.hidden = true;
    form.addEventListener('change', function (e) {
      if (!e.target || !e.target.matches('select[data-auto]')) return;
      if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.submit();
    });
  }

  var expander = document.querySelector('[data-action="tm-work-expand"]');
  var items = function () { return Array.prototype.slice.call(document.querySelectorAll('details.tm-work-item')); };
  function syncExpander() {
    if (!expander) return;
    var list = items();
    if (!list.length) { expander.hidden = true; return; }
    expander.hidden = false;
    var allOpen = list.every(function (d) { return d.open; });
    expander.dataset.open = allOpen ? '1' : '0';
    expander.textContent = allOpen ? 'طيّ الكل' : 'توسيع الكل';
    expander.setAttribute('aria-expanded', allOpen ? 'true' : 'false');
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action="tm-work-expand"]');
    if (!el) return;
    e.preventDefault();
    var open = el.dataset.open !== '1';
    items().forEach(function (d) { d.open = open; });
    syncExpander();
  });
  // حدث toggle لا يفقع — يُلتقط في مرحلة الالتقاط ليبقى زرّ التوسيع صادقاً مع الحالة.
  document.addEventListener('toggle', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('tm-work-item')) syncExpander();
  }, true);
  syncExpander();
})();
