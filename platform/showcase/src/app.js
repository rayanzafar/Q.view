/* منصة سند — محرّك العرض التعريفي.
   بلا أي اعتماد خارجي. أربع وظائف فقط:
     1) كشف العناصر عند دخولها الشاشة (IntersectionObserver واحد).
     2) حلقة عمق واحدة (rAF) تعمل فقط ما دام إطارٌ ذو عمق ظاهراً.
     3) عدّادات تصاعدية بأرقام لاتينية.
     4) تتبّع المشهد + مسار المُقدِّم + مفاتيح لوحة المفاتيح.
   احترام «تقليل الحركة»: كل شيء يصل إلى حالته النهائية فوراً، ولا تُشغَّل أي حلقة. */
(function () {
  'use strict';

  var doc = document;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fmt = new Intl.NumberFormat('en-US');

  var scenes = [].slice.call(doc.querySelectorAll('.scene[data-scene]'));
  var dots = [].slice.call(doc.querySelectorAll('.rail button[data-go]'));
  var railNow = doc.getElementById('railNow');
  var prog = doc.getElementById('prog');
  var keys = doc.getElementById('keys');
  var keysBtn = doc.getElementById('keysBtn');
  var keysReturn = null;   // ما كان مركَّزاً قبل فتح اللوحة

  // ── 1) الكشف عند الظهور ────────────────────────────────────────────────────
  var reveals = [].slice.call(doc.querySelectorAll('[data-reveal]'));
  if (reduce) {
    reveals.forEach(function (el) { el.classList.add('in'); });
  } else if ('IntersectionObserver' in window) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        revealObs.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    reveals.forEach(function (el) { revealObs.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  // ── 2) حلقة العمق ─────────────────────────────────────────────────────────
  var depthEls = [].slice.call(doc.querySelectorAll('[data-parallax]'));
  var live = [];        // ما هو ظاهر الآن فقط
  var ticking = false;

  function measureAndPaint() {
    ticking = false;
    if (!live.length) return;
    var mid = window.innerHeight / 2;
    var reads = live.map(function (el) {          // كل القراءات أولاً
      var r = el.getBoundingClientRect();
      return (r.top + r.height / 2 - mid) / (mid || 1);
    });
    for (var i = 0; i < live.length; i++) {       // ثم كل الكتابات
      var p = reads[i];
      if (!Number.isFinite(p)) p = 0;
      if (p > 1) p = 1; else if (p < -1) p = -1;
      live[i].style.setProperty('--p', p.toFixed(4));
    }
  }
  function schedule() {
    if (ticking || !live.length) return;
    ticking = true;
    requestAnimationFrame(measureAndPaint);
  }

  if (!reduce && depthEls.length && 'IntersectionObserver' in window) {
    var depthObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var at = live.indexOf(e.target);
        if (e.isIntersecting) {
          if (at < 0) { live.push(e.target); e.target.style.willChange = 'transform'; }
        } else if (at >= 0) {
          live.splice(at, 1);
          e.target.style.willChange = 'auto';
          e.target.style.setProperty('--p', '0');
        }
      });
      schedule();
    }, { rootMargin: '20% 0px 20% 0px' });
    depthEls.forEach(function (el) { depthObs.observe(el); });
  }

  // ── 3) العدّادات ──────────────────────────────────────────────────────────
  var counters = [].slice.call(doc.querySelectorAll('[data-count]'));
  function runCount(el) {
    var target = Number(el.getAttribute('data-count'));
    if (!Number.isFinite(target)) target = 0;
    if (reduce) { el.textContent = fmt.format(target); return; }
    var t0 = 0;
    var dur = 1100;
    function step(now) {
      if (!t0) t0 = now;
      var k = Math.min(1, (now - t0) / dur);
      var eased = 1 - Math.pow(1 - k, 3);            // ease-out cubic
      el.textContent = fmt.format(Math.round(target * eased));
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if (reduce || !('IntersectionObserver' in window)) {
    counters.forEach(function (el) { el.textContent = fmt.format(Number(el.getAttribute('data-count')) || 0); });
  } else {
    var countObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        countObs.unobserve(e.target);
        runCount(e.target);
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { countObs.observe(el); });
  }

  // ── 4) تتبّع المشهد + شريط التقدّم ────────────────────────────────────────
  var current = 0;
  var frameQueued = false;

  function paintRail(index) {
    if (index === current && dots.length && dots[index] && dots[index].getAttribute('aria-current') === 'true') return;
    current = index;
    dots.forEach(function (b, i) {
      if (i === index) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
    if (railNow) railNow.textContent = fmt.format(index + 1);
  }

  function measureScene() {
    frameQueued = false;
    var mid = window.scrollY + window.innerHeight * 0.42;
    var found = 0;
    for (var i = 0; i < scenes.length; i++) {
      if (scenes[i].offsetTop <= mid) found = i;
    }
    if (!moving) paintRail(found);
    if (prog) {
      var span = doc.documentElement.scrollHeight - window.innerHeight;
      var ratio = span > 0 ? window.scrollY / span : 0;
      if (ratio < 0) ratio = 0; else if (ratio > 1) ratio = 1;
      prog.style.setProperty('--progress', ratio.toFixed(4));
    }
  }
  function onScroll() {
    schedule();
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(measureScene);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  // ── 5) تنقّل المُقدِّم ─────────────────────────────────────────────────────
  var moving = false;
  var releaseTimer = 0;
  var hasScrollEnd = 'onscrollend' in window;

  function release() {
    clearTimeout(releaseTimer);
    window.removeEventListener('scrollend', release);
    moving = false;
  }

  function goTo(index) {
    if (index < 0) index = 0;
    if (index > scenes.length - 1) index = scenes.length - 1;
    var target = scenes[index];
    if (!target) return index;
    // القفز يتجاوز مُراقب الظهور، فيُفرض الكشف على عناصر المشهد المقصود قبل الوصول إليه
    revealScene(target);
    // ضغطة ثانية سريعة تتقدّم مشهداً آخر بدل أن تُهمَل — العلامة تمنع إعادة الحساب لا الحركة.
    moving = true;
    paintRail(index);
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    clearTimeout(releaseTimer);
    if (hasScrollEnd && !reduce) window.addEventListener('scrollend', release, { once: true });
    releaseTimer = setTimeout(release, reduce ? 60 : 1400);
    return index;
  }

  dots.forEach(function (b) {
    b.addEventListener('click', function () { goTo(Number(b.getAttribute('data-go')) || 0); });
  });

  function revealScene(scene) {
    if (!scene) return;
    [].slice.call(scene.querySelectorAll('[data-reveal]')).forEach(function (el) { el.classList.add('in'); });
  }

  function toggleKeys(force) {
    if (!keys) return;
    var show = (force === true || force === false) ? force : keys.hidden;
    if (show === !keys.hidden) return;
    if (show) keysReturn = doc.activeElement;
    keys.hidden = !show;
    if (keysBtn) keysBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) {
      var h = doc.getElementById('keys-h');
      if (h && h.focus) h.focus();
    } else if (keysReturn && keysReturn.focus && doc.contains(keysReturn)) {
      keysReturn.focus();
      keysReturn = null;
    }
  }
  if (keysBtn) keysBtn.addEventListener('click', function () { toggleKeys(); });

  var NEXT = { PageDown: 1, ArrowDown: 1, ArrowLeft: 1, Space: 1, ' ': 1 };
  var PREV = { PageUp: 1, ArrowUp: 1, ArrowRight: 1 };

  doc.addEventListener('keydown', function (ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var tag = ev.target && ev.target.tagName ? ev.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (ev.target && ev.target.isContentEditable)) return;
    var k = ev.key;

    if (k === '?' || (k === '/' && ev.shiftKey)) { ev.preventDefault(); toggleKeys(); return; }
    if (k === 'Escape') { toggleKeys(false); return; }
    if (NEXT[k]) { ev.preventDefault(); goTo(current + 1); return; }
    if (PREV[k]) { ev.preventDefault(); goTo(current - 1); return; }
    if (k === 'Home') { ev.preventDefault(); goTo(0); return; }
    if (k === 'End') { ev.preventDefault(); goTo(scenes.length - 1); return; }
    if (k >= '1' && k <= '9') { ev.preventDefault(); goTo(Number(k) - 1); }
  });

  // ── 6) الإقلاع ────────────────────────────────────────────────────────────
  function boot() {
    measureScene();
    schedule();
    // المشهد الأول يظهر فوراً بلا انتظار المُراقب
    revealScene(scenes[0]);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── 7) قطع الواجهة المُعاد بناؤها (وحدة C2) ────────────────────────────────
  // مُراقب واحد صغير يضع الصنف on على القطعة حين تدخل الشاشة ويرفعه حين تخرج.
  // كل حركات القطع (الرسم، النموّ، الحلقات) مشروطة بهذا الصنف في CSS، فلا حلقة
  // تعمل خارج المشهد المعروض، ولا حلقة rAF ثانية هنا.
  var frags = [].slice.call(doc.querySelectorAll('.fragment'));
  if (frags.length) {
    if (reduce || !('IntersectionObserver' in window)) {
      frags.forEach(function (el) { el.classList.add('on'); });
    } else {
      var fragObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          e.target.classList.toggle('on', e.isIntersecting);
        });
      }, { rootMargin: '45% 0px 45% 0px', threshold: 0 });
      frags.forEach(function (el) { fragObs.observe(el); });
    }
  }

  // واجهة صغيرة لسكربت التحقق
  window.Showcase = {
    goTo: goTo,
    scenes: scenes.map(function (s) { return s.id; }),
    get current() { return current; },
    reduced: reduce
  };
})();
