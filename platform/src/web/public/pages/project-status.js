// حالة المشروع — ضابطٌ واحد يخدم شاشتين: ترويسة المشروع وقائمة المشاريع (v5.73).
//
// لماذا ملفٌ ثالث بدل تحميل project-governance.js على القائمة: ذاك الملفّ ٣٩٠ سطراً يفتح
// ألسنة الحوكمة ويقرأ التخزين المحلي ويستعيد اللسان من عنوان الصفحة ويسجّل ثمانية مستمعين —
// كلُّها أثرٌ جانبي لا معنى له في شاشة القائمة. وهذا الملفّ ~٩٠ سطراً بمستمعَين اثنين، ولا
// يفعل شيئاً إن لم تكن في الصفحة قائمةُ حالةٍ واحدة. فالمشترك يُخرَج إلى أصغر وحدة تُحمَّل
// حيث تُستعمل، لا تُحمَّل صفحةٌ كاملة لأجل عشرين سطراً فيها.
//
// ولا نسخةَ ثانية من المنطق: هذا هو **الموضع الوحيد** الذي يكتب حالة المشروع في المتصفح؛
// مسار الحفظ والتحقّق في الخادم كما هو (PATCH /api/projects/:id).
(function () {
  'use strict';
  var SEL = '[data-action-change="prj-status-sel"]';
  // أسماء الحالات لا تُنسخ هنا: الخادم رسمها في نصّ الخيار نفسه، فتُقرأ منه. نسخةٌ ثانية تشيخ
  // عند أول إعادة تسمية، فيقول التأكيد اسماً وتقول القائمة اسماً آخر.
  function labelOf(el) {
    var o = el.options[el.selectedIndex];
    return (o && o.text) || el.value;
  }
  // ألوانُ الحالات يرسلها الخادم (نفس مصدر الكانبان والشرائح) — وبديلٌ محايد إن لم تُرسَل.
  var FALLBACK_UI = { color: '#64748b', tint: '#e9edf2', ink: '#475569' };
  function uiOf(status) {
    var map = (window.__SANAD && window.__SANAD.prjStatusUi) || {};
    return map[status] || FALLBACK_UI;
  }
  function toast(msg, bad) {
    var d = document.createElement('div');
    d.setAttribute('role', bad ? 'alert' : 'status');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#dc2626' : '#059669');
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600);
  }
  async function patch(id, status) {
    var r = await fetch('/api/projects/' + encodeURIComponent(id), {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: status }),
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error((j.error && j.error.message) || ('تعذّر حفظ الحالة — أعد المحاولة'));
    return j;
  }

  // عدّادُ الشريحة يتحرّك مع الصفّ: نقصٌ من الحالة السابقة وزيادةٌ في الجديدة. «الكل» لا يتغيّر.
  function moveChipCount(prev, next) {
    var bump = function (key, by) {
      var el = document.querySelector('[data-status-count="' + key + '"]');
      if (!el) return;
      var n = parseInt(el.textContent, 10);
      if (!isNaN(n)) el.textContent = String(Math.max(0, n + by));
    };
    if (prev) bump(prev, -1);
    if (next) bump(next, 1);
  }

  // بطاقةُ اللوح تنتقل إلى عمود حالتها الجديدة — وإلا بقيت تحت عنوانٍ يكذب عليها.
  function moveKanbanCard(card, status) {
    var col = document.querySelector('#prj-kanban .kcol[data-stage="' + status + '"] .kcol-body');
    if (!col) return false;
    col.querySelectorAll(':scope > div:not(.kcard)').forEach(function (ph) { ph.remove(); });
    col.appendChild(card);
    if (window.Sanad && window.Sanad._recount) window.Sanad._recount('prj');
    return true;
  }

  function paint(el, status) {
    var ui = uiOf(status);
    var wrap = el.closest('.prj-st');
    if (wrap) {
      wrap.style.setProperty('--_stl', ui.color);
      wrap.style.setProperty('--_sti', ui.ink);
      wrap.style.setProperty('--_stb', ui.tint);
    }
    var card = el.closest('.kcard');
    if (card) card.style.setProperty('--_c', ui.color);
  }

  async function save(el) {
    var id = el.dataset.id;
    var status = el.value;
    var prev = el.dataset.prev || '';
    var inList = el.dataset.list === '1';
    // القائمة **لا تُعطَّل** أثناء الحفظ: تعطيلُ عنصرٍ عليه التركيز يرمي التركيز إلى الصفحة،
    // فيفقد من يعمل بلوحة المفاتيح موضعه بعد كل صفّ. المنعُ من التكرار علامةٌ لا تعطيل.
    if (el.dataset.busy === '1') { if (prev) el.value = prev; return; }
    if (status === prev) return;
    // الإغلاق والإلغاء يُقرآن في المحفظة ولوحة القيادة — فيُستأذن فيهما قبل الحفظ لا بعده.
    if ((status === 'COMPLETED' || status === 'CANCELLED')
      && !window.confirm('سيصير المشروع «' + labelOf(el) + '» ويظهر كذلك في المحفظة ولوحة القيادة. تأكيد؟')) {
      if (prev) el.value = prev;
      return;
    }
    el.dataset.busy = '1';
    el.setAttribute('aria-busy', 'true');
    try {
      await patch(id, status);
      el.dataset.prev = status;
      paint(el, status);
      if (!inList) { toast('حُفظت الحالة'); setTimeout(function () { location.reload(); }, 450); return; }
      var card = el.closest('.kcard');
      var moved = card ? moveKanbanCard(card, status) : false;
      if (card && !moved) { toast('حُفظت الحالة'); setTimeout(function () { location.reload(); }, 450); return; }
      // نقلُ البطاقة يقتلع عنصرها من الشجرة فيسقط التركيز — يُعاد إلى موضعه بعد النقل.
      if (moved) { try { el.focus({ preventScroll: true }); } catch (x) {} }
      moveChipCount(prev, status);
      toast('حُفظت الحالة');
      // مرشِّحُ حالةٍ مفعّل والصفُّ خرج منه: تبقى الشاشة صادقة بإعادة بنائها على المرشّح نفسه.
      var filter = window.__SANAD && window.__SANAD.prjStatusFilter;
      if (filter && filter !== status) setTimeout(function () { location.reload(); }, 900);
    } catch (e) {
      if (prev) el.value = prev;
      toast(e.message, true);
    } finally {
      delete el.dataset.busy;
      el.removeAttribute('aria-busy');
    }
  }

  document.addEventListener('change', function (ev) {
    var el = ev.target.closest ? ev.target.closest(SEL) : null;
    if (el) save(el);
  });
  // بطاقةُ اللوح كلها زرُّ فتحٍ (onclick مضمّن في app.js المجمّد) وصفُّ الجدول كذلك — فنقرةُ
  // فتح القائمة كانت تفتح المشروع بدل أن تفتح الخيارات. الالتقاط على المستند يمنع وصول
  // النقرة إليهما ولا يمنع القائمة من الانفتاح (لا preventDefault).
  document.addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest(SEL)) ev.stopPropagation();
  }, true);
  // السحبُ في اللوح طريقٌ ثانٍ إلى الحالة نفسها (Sanad.kDrop في app.js المجمّد): ينقل البطاقة
  // ويحفظ، ولا يعلم بالقائمة داخلها. فبطاقةٌ سُحبت إلى «مكتمل» تبقى قائمتُها تقول «قيد التنفيذ»
  // — تناقضٌ يُرى، ثم يُنقص التغييرُ التالي عدّاد الشريحة الخطأ. `dragend` يقع بعد `drop`،
  // والبطاقةُ تكون قد نُقلت (kDrop يلحقها بالعمود قبل انتظار الحفظ، ويعيد التحميل إن فشل).
  document.addEventListener('dragend', function (ev) {
    var card = ev.target && ev.target.closest ? ev.target.closest('.kcard') : null;
    var sel = card && card.querySelector(SEL);
    var col = card && card.closest('.kcol');
    var stage = col && col.dataset.stage;
    if (!sel || !stage || sel.dataset.prev === stage) return;
    var old = sel.dataset.prev || '';
    sel.value = stage;
    sel.dataset.prev = stage;
    paint(sel, stage);
    moveChipCount(old, stage);
  });
})();
