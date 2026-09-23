// تقرير الفترة — تسريع الاختيار وحده. الصفحة تعمل كاملةً بلا هذا الملف (زر «اعرض التقرير»
// يرسل النموذج)، وهذا يوفّر النقرة: أي تغيير في الجهة أو الفترة يعرض التقرير مباشرةً.
(function () {
  var form = document.getElementById('rp-form');
  if (!form) return;
  var kind = document.getElementById('rp-kind');
  var anchor = document.getElementById('rp-anchor');

  form.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || (t.id !== 'rp-scope' && t.id !== 'rp-kind' && t.id !== 'rp-anchor')) return;
    // تغيير نوع الفترة يُبطل الفترة المختارة: قائمة الفترات تُبنى من النوع، فتُترك للخادم يختار الحالية.
    if (t === kind && anchor) anchor.disabled = true;
    form.submit();
  });
})();
