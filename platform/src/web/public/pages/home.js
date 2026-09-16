// ميلان بطاقة «صفحتي» مع المؤشر — زينةٌ محضة فوق صفحةٍ كاملةٍ بدونها.
//
// ثلاثة حدود مقصودة:
//   • لا يعمل إن طلب النظام تقليل الحركة — الميلان أول ما يُطفأ لمن يتأذّى منه.
//   • لا يعمل على اللمس: لا مؤشر يتبعه، ولمسةٌ تُميل البطاقة تُقرأ عطلاً لا تصميماً.
//   • كل تحديث داخل إطار عرضٍ واحد؛ لا حساب على كل حركة مؤشر.
(function () {
  var tilt = document.getElementById('hm-tilt');
  if (!tilt || !tilt.parentElement) return;
  var mq = window.matchMedia;
  if (mq && (mq('(prefers-reduced-motion: reduce)').matches || mq('(hover: none)').matches)) return;

  var host = tilt.parentElement;
  var rx = 0, ry = 0, pending = 0;

  function paint() {
    pending = 0;
    tilt.style.setProperty('--rx', rx.toFixed(2) + 'deg');
    tilt.style.setProperty('--ry', ry.toFixed(2) + 'deg');
  }
  function schedule() { if (!pending) pending = requestAnimationFrame(paint); }

  host.addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    var r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // الميلان يتبع موضع المؤشر الفيزيائي لا اتجاه الصفحة — فيبدو صحيحاً في الاتجاهين.
    var dx = (e.clientX - r.left) / r.width - 0.5;
    var dy = (e.clientY - r.top) / r.height - 0.5;
    rx = -dy * 5;
    ry = dx * 7;
    tilt.style.transitionDuration = '.12s';
    schedule();
  });

  host.addEventListener('pointerleave', function () {
    rx = 0; ry = 0;
    tilt.style.transitionDuration = '';   // رجوعٌ هادئ إلى الاستواء
    schedule();
  });
})();
