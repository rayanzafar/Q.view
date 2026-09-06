// عميل S11 — الهيكل الإداري: بحثٌ عميل في الشجرة، تنقّلٌ بالأسهم بين العقد، ترشيحٌ فوري لقائمة
// الإدارة فوق ترشيح الخادم (والقيمة تُعكس في الرابط)، ونقر الصف يفتح ملف المورد.
// كل شيء مبنيّ على الخادم؛ هذا الملف يضيف الراحة فوقه ولا يبني عقدة واحدة. تفويض data-action فقط.
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  // توحيد الحروف للبحث: الهمزات والتاء المربوطة والألف المقصورة والتشكيل — «إدارة» تطابق «اداره».
  var norm = function (s) {
    return String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْ]/g, '').trim();
  };

  // ── الشجرة: بحث عميل في أسماء القطاعات والإدارات ─────────────────────────────
  var tree = $('#tm-org-tree'), tq = $('#tm-org-tq'), tnone = $('#tm-org-tnone');
  function filterTree() {
    if (!tree) return;
    var q = norm(tq ? tq.value : '');
    var any = false;
    $$('.tm-org-sec', tree).forEach(function (sec) {
      var secHit = !q || norm(sec.dataset.name).indexOf(q) !== -1;
      var depHit = false;
      $$('.tm-org-depli', sec).forEach(function (li) {
        var hit = secHit || (li.dataset.name ? norm(li.dataset.name).indexOf(q) !== -1 : false);
        li.hidden = !hit;
        if (hit) depHit = true;
      });
      var show = secHit || depHit;
      sec.hidden = !show;
      if (show) any = true;
      var det = $('details', sec);
      if (det && q && show) det.open = true;
    });
    if (tnone) tnone.hidden = any || !q;
  }
  if (tq) {
    tq.addEventListener('input', filterTree);
    tq.addEventListener('keydown', function (e) { if (e.key === 'Escape') { tq.value = ''; filterTree(); } });
    if (tq.value) filterTree();
  }

  // ── لوحة المفاتيح: الأسهم تنقل التركيز بين العقد الظاهرة؛ في اتجاه RTL: يسار يفتح القطاع ويمين يطويه ──
  if (tree) {
    tree.addEventListener('keydown', function (e) {
      var node = e.target.closest('.tm-org-node');
      if (!node) return;
      var nodes = $$('.tm-org-node', tree).filter(function (n) { return n.tagName !== 'SPAN' && n.offsetParent !== null; });
      var i = nodes.indexOf(node);
      if (e.key === 'ArrowDown' && i < nodes.length - 1) { e.preventDefault(); nodes[i + 1].focus(); }
      else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); nodes[i - 1].focus(); }
      else if (e.key === 'Home' && nodes.length) { e.preventDefault(); nodes[0].focus(); }
      else if (e.key === 'End' && nodes.length) { e.preventDefault(); nodes[nodes.length - 1].focus(); }
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && node.tagName === 'SUMMARY') {
        e.preventDefault();
        node.parentElement.open = e.key === 'ArrowLeft';
      }
    });
  }

  // ── قائمة الإدارة: ترشيح فوري فوق ترشيح الخادم، والقيمة تُعكس في الرابط ───────
  var q = $('#tm-org-q'), rows = $('#tm-org-rows'), none = $('#tm-org-none');
  function filterRows() {
    if (!rows) return;
    var v = norm(q ? q.value : '');
    var vis = 0;
    $$('tbody tr[data-hay]', rows).forEach(function (tr) {
      var hit = !v || norm(tr.dataset.hay).indexOf(v) !== -1;
      tr.hidden = !hit;
      if (hit) vis++;
    });
    if (none) none.hidden = vis !== 0;
    var p = new URLSearchParams(location.search);
    var raw = q ? q.value.trim() : '';
    if (raw) p.set('q', raw); else p.delete('q');
    var qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }
  if (q) q.addEventListener('input', filterRows);

  // ── نقر الصف يفتح ملف المورد (الروابط داخله تعمل كما هي) ───────────────────────
  document.addEventListener('click', function (e) {
    if (e.target.closest('a,button,input,select,label')) return;
    var tr = e.target.closest('[data-action="open-resource"]');
    if (tr && tr.dataset.href) location.href = tr.dataset.href;
  });
})();
