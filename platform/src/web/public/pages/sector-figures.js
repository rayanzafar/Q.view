// مركز القطاع — لبنات الرسم والصياغة (لا تلمس الصفحة)
//
// هذا الملف خالصٌ بالكامل: يأخذ أرقاماً ونصوصاً ويعيد وسماً. لا يقرأ عنصراً ولا يكتب فيه،
// ولا يجلب بيانات، ولا يعلن إلا `CC` واحداً على النافذة. الصفحة (sector.js) واللوحة الجانبية
// (sector-drawer.js) هما من يركّبان ما هنا في مواضعه.
//
// قواعد الرقم — واحدة لا تُخرق:
//   • كل رقمٍ يظهر في وسمٍ عربي يمرّ بـ`CC.fmt.*` فيخرج داخل <bdi dir="ltr" class="tnum">،
//     فلا ينقلب ترتيبه بين حروف العربية ولا تهتزّ أعمدته.
//   • كل رقمٍ داخل <text> في رسمٍ متّجهي يخرج أرقاماً مجردة، ويحمل عنصرُه الصنف «svgnum»
//     الذي يثبّت اتجاهه في sector.css (direction:ltr;unicode-bidi:isolate) — فالسمة لا تُكتب
//     هنا سطراً سطراً بل تُعرَّف مرة واحدة في ورقة الأنماط.
//   • المال يصل من الخادم بالهللات دائماً، والتحويل إلى الريال يقع هنا وحده.
//
// التلميحات: نصٌّ صريح بلا وسم — محرّك [data-tip] في app.js يضعه بـtextContent، فأي <b> أو <br>
// كان يظهر حرفياً للمستخدم. لذلك تُفصل أجزاء التلميح بفاصلٍ أوسط لا بسطرٍ جديد.
(function () {
  'use strict';

  var root = (typeof window === 'object' && window) ? window : globalThis;
  var CC = root.CC = root.CC || {};

  // ── الهروب: نعيد استعمال Sanad.esc إن كان app.js محمّلاً، وإلا نكتفي ببديلٍ مطابق ──
  // يُحسم عند كل نداء لا عند التحميل، فالملف يعمل في الاختبار بلا app.js وفي الصفحة معه.
  function ownEsc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }
  CC.esc = function (s) {
    var S = root.Sanad;
    return (S && typeof S.esc === 'function') ? S.esc(s) : ownEsc(s);
  };
  var E = function (s) { return CC.esc(s); };

  // ── الصياغة ────────────────────────────────────────────────────────────────
  var NF = new Intl.NumberFormat('en-US');
  var MINUS = '−';        // إشارة الطرح الحقيقية لا شرطة لوحة المفاتيح
  var DASH = '—';              // ما لا قيمة له يُقال إنه بلا قيمة، ولا يُحوَّل صفراً

  // «بلا قيمة»: غياب، أو ناتج حسابٍ ليس عدداً (الفحص بـv !== v يتجنّب طباعة أي مصطلح تقني)
  function blank(v) { return v == null || v !== v; }

  function intTxt(v) {
    if (blank(v)) return DASH;
    return (v < 0 ? MINUS : '') + NF.format(Math.abs(Math.round(v)));
  }

  function sarTxt(halalas) {
    if (blank(halalas)) return DASH;
    var S = root.Sanad;
    if (S && typeof S.fmtSar === 'function') return S.fmtSar(halalas);
    try {
      return new Intl.NumberFormat('ar-SA-u-nu-latn', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 })
        .format(halalas / 100);
    } catch (e) {
      return NF.format(Math.round(halalas / 100)) + ' ر.س.';
    }
  }

  // الاختصار بعُرف سند نفسه (sarShort في src/web/views/_shared.js): ملايين بخانةٍ عشرية
  // واحدة، وآلافٌ صحيحة — حتى تقرأ الصفحة الجديدة بنفس لسان بقية الشاشات.
  // «unit» يثبّت المقياس حين يختاره المستخدم من مبدّل الوحدة: sar | k | m.
  function shortTxt(halalas, unit) {
    if (blank(halalas)) return DASH;
    var v = halalas / 100, a = Math.abs(v), sign = v < 0 ? MINUS : '';
    if (unit === 'm') return sign + (a / 1e6).toFixed(1) + 'M';
    if (unit === 'k') return sign + NF.format(Math.round(a / 1e3)) + 'K';
    if (unit === 'sar') return sign + NF.format(Math.round(a));
    if (a >= 1e6) return sign + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return sign + NF.format(Math.round(a / 1e3)) + 'K';
    return sign + NF.format(Math.round(a));
  }

  // السنة رقمُ تقويمٍ لا مقدار: تُكتب ٢٠٢٦ لا ٢٬٠٢٦ — فاصلةُ الآلاف تحوّلها إلى عدّ.
  function yearTxt(v) {
    if (blank(v)) return DASH;
    return String(Math.trunc(v));
  }

  function pctTxt(x, d) {
    if (blank(x)) return DASH;
    var v = x * 100;
    return (v < 0 ? MINUS : '') + Math.abs(v).toFixed(d || 0) + '%';
  }

  function signedPctTxt(x, d) {
    if (blank(x)) return DASH;
    var v = x * 100, s = Math.abs(v).toFixed(d || 0);
    if (+s === 0) return '0%';
    return (v < 0 ? MINUS : '+') + s + '%';
  }

  // فرق النسبة بالنقاط — هامشٌ مقابل هامش، لا نسبةٌ من نسبة
  function signedPtsTxt(x, d) {
    if (blank(x)) return DASH;
    var v = x * 100, s = Math.abs(v).toFixed(d == null ? 1 : d);
    if (+s === 0) return '0';
    return (v < 0 ? MINUS : '+') + s;
  }

  // العدّ بالعربية: واحد، اثنان، ثلاثة إلى عشرة بالجمع، وما فوقها بالمفرد المنصوب.
  function countAr(n, one, two, plural, accusative) {
    var k = Math.abs(Math.round(n || 0));
    if (k === 1) return one;
    if (k === 2) return two;
    if (k >= 3 && k <= 10) return NF.format(k) + ' ' + plural;
    return NF.format(k) + ' ' + (accusative || plural);
  }

  var UNIT_LABEL = { sar: 'بالريال السعودي', k: 'بآلاف الريالات', m: 'بملايين الريالات' };

  // الغلاف الواحد لكل رقمٍ يُعرض داخل وسم
  function wrap(txt, cls) {
    return '<bdi dir="ltr" class="tnum' + (cls ? ' ' + E(cls) : '') + '">' + E(txt) + '</bdi>';
  }

  CC.fmt = {
    MINUS: MINUS,
    DASH: DASH,
    blank: blank,
    toSar: function (halalas) { return blank(halalas) ? null : halalas / 100; },
    toSarArr: function (arr) {
      return (arr || []).map(function (v) { return blank(v) ? null : v / 100; });
    },
    num: wrap,
    unitLabel: function (u) { return UNIT_LABEL[u] || UNIT_LABEL.sar; },
    countAr: countAr,

    // أرقامٌ مجردة: لنصوص الرسوم المتّجهية والتلميحات وسمات القراءة الصوتية
    plain: {
      int: intTxt,
      year: yearTxt,
      sar: sarTxt,
      short: shortTxt,
      pct: pctTxt,
      signedPct: signedPctTxt,
      signedPts: signedPtsTxt,
    },

    // أرقامٌ في وسم: معزولة الاتجاه ومتساوية الخانات
    int: function (v) { return wrap(intTxt(v)); },
    year: function (v) { return wrap(yearTxt(v)); },
    sar: function (halalas) { return wrap(sarTxt(halalas)); },
    short: function (halalas, unit) { return wrap(shortTxt(halalas, unit)); },
    pct: function (x, d) { return wrap(pctTxt(x, d)); },
    signedPct: function (x, d) { return wrap(signedPctTxt(x, d)); },
    signedPts: function (x, d) { return wrap(signedPtsTxt(x, d)); },
  };

  // ── سياق الرسوم: أسماء الأشهر وحدّ الإقفال ─────────────────────────────────
  // الأشهر ثابتةٌ لغوياً فتأتي جاهزة، وآخر شهرٍ مغلق والشهر الجاري تضبطهما الصفحة من بيانات
  // الخادم قبل أول رسم — حتى يعرف التلميح أيُّ شهرٍ «لم يغلق بعد» وأيُّه «لم يبدأ بعد».
  var CFG = {
    months: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
    closedThrough: 12,
    currentMonth: 0,
  };
  CC.config = function (o) {
    o = o || {};
    if (o.months && o.months.length === 12) CFG.months = o.months.slice();
    if (o.closedThrough != null) CFG.closedThrough = Number(o.closedThrough) || 0;
    if (o.currentMonth != null) CFG.currentMonth = Number(o.currentMonth) || 0;
    return CFG;
  };
  CC.months = function () { return CFG.months.slice(); };

  // ── الرسوم المتّجهية ───────────────────────────────────────────────────────
  var gid = 0;                                   // معرّف تدرّجٍ لا يتكرر في الصفحة الواحدة
  var f1 = function (n) { return n.toFixed(1); };

  // خطٌّ صغير بمحورٍ من اليسار إلى اليمين — للتراكمي داخل بطاقة، مع مساحةٍ وإسقاطٍ وإبراز أشهر
  function spark(vals, o) {
    o = o || {};
    var w = o.w || 210, h = o.h || 62, c = o.color || '#2d55a8', n = vals.length, sw = o.sw || 2.2;
    var nums = vals.filter(function (v) { return v != null; });
    var mx = o.max || Math.max.apply(null, [1].concat(nums, o.proj ? [o.proj.v] : []));
    var X = function (i) { return 5 + i * (w - 14) / Math.max(1, n - 1); };
    var Y = function (v) { return h - 5 - (v / mx) * (h - 14); };
    var pts = vals.map(function (v, i) { return v == null ? null : [X(i), Y(v)]; });
    var d = '', on = false, first = null, last = null;
    pts.forEach(function (p, i) {
      if (!p) { on = false; return; }
      d += (on ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1]);
      on = true;
      if (first == null) first = i;
      last = i;
    });
    var id = 'ccsg' + (++gid);
    var g = '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="' + E(c) + '" stop-opacity=".22"/>'
      + '<stop offset="1" stop-color="' + E(c) + '" stop-opacity="0"/></linearGradient></defs>';
    if (o.area && first != null) {
      g += '<path d="' + d + 'L' + f1(X(last)) + ' ' + (h - 2) + 'L' + f1(X(first)) + ' ' + (h - 2)
        + 'Z" fill="url(#' + id + ')"/>';
    }
    g += '<path d="' + d + '" fill="none" stroke="' + E(c) + '" stroke-width="' + sw
      + '" stroke-linejoin="round" stroke-linecap="round"' + (o.on ? ' opacity=".25"' : '') + '/>';
    if (o.on) {
      for (var i = 0; i < n; i++) {
        if (!o.on.has(i + 1) || !pts[i]) continue;
        var a = i > 0 && pts[i - 1] ? pts[i - 1] : null;
        g += a
          ? '<path d="M' + f1(a[0]) + ' ' + f1(a[1]) + 'L' + f1(pts[i][0]) + ' ' + f1(pts[i][1])
            + '" stroke="' + E(c) + '" stroke-width="' + (sw + 0.4) + '" stroke-linecap="round" fill="none"/>'
          : '<circle cx="' + f1(pts[i][0]) + '" cy="' + f1(pts[i][1]) + '" r="2.6" fill="' + E(c) + '"/>';
      }
    }
    if (o.proj && last != null) {
      var px = X(o.proj.i), py = Y(o.proj.v);
      g += '<path d="M' + f1(X(last)) + ' ' + f1(Y(vals[last])) + 'L' + f1(px) + ' ' + f1(py)
        + '" stroke="' + E(c) + '" stroke-width="' + sw + '" stroke-dasharray="4 4" fill="none"/>'
        + '<circle cx="' + f1(px) + '" cy="' + f1(py) + '" r="4" fill="' + E(c) + '" stroke="#fff" stroke-width="2"/>';
    } else if (o.dot !== false && last != null) {
      g += '<circle cx="' + f1(X(last)) + '" cy="' + f1(Y(vals[last])) + '" r="4" fill="' + E(c)
        + '" stroke="#fff" stroke-width="2"/>';
    }
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="display:block;max-height:' + h
      + 'px" aria-hidden="true">' + g + '</svg>';
  }

  // خطٌّ مصغَّر بمحورٍ من اليمين إلى اليسار — يناير يمين الشريط كما يقرأ العربي
  function sparkR(vals, o) {
    o = o || {};
    var w = o.w || 120, h = o.h || 30, n = 12;
    var X = function (i) { return w - 3 - i * (w - 6) / (n - 1); };
    var nums = (vals || []).concat(o.plan || []).filter(function (v) { return v != null; });
    var mx = Math.max.apply(null, [1].concat(nums));
    var mn = Math.min.apply(null, [0].concat(nums));
    var Y = function (v) { return h - 3 - (v - mn) / (mx - mn || 1) * (h - 6); };
    var path = function (arr) {
      var d = '', on = false;
      (arr || []).forEach(function (v, i) {
        if (v == null) { on = false; return; }
        d += (on ? 'L' : 'M') + f1(X(i)) + ' ' + f1(Y(v));
        on = true;
      });
      return d;
    };
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h
      + '" aria-hidden="true" style="display:block">'
      + (o.plan ? '<path d="' + path(o.plan) + '" fill="none" stroke="#b3bdd3" stroke-width="1.4" stroke-dasharray="3 3"/>' : '')
      + '<path d="' + path(vals) + '" fill="none" stroke="' + E(o.color || 'var(--primary)')
      + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  // أعمدة الأشهر الاثني عشر: الخطة إطارٌ متقطّع والفعلي عمودٌ ممتلئ، والمحور من اليمين
  function barsR(o) {
    o = o || {};
    var w = o.w || 720, h = o.h || 160, pad = { t: 14, r: 4, b: 24, l: 4 };
    var ih = h - pad.t - pad.b, bw = (w - pad.l - pad.r) / 12;
    var fmt = o.fmt || intTxt;
    var vals = [].concat(o.plan || [], o.act || []).filter(function (v) { return v != null; });
    var mx = Math.max.apply(null, [1].concat(vals)) * 1.1;
    var mn = Math.min.apply(null, [0].concat(vals)) * 1.1;
    var Y = function (v) { return pad.t + ih * (mx - v) / (mx - mn); };
    var y0 = Y(0);
    var X = function (i) { return w - pad.r - (i + 1) * bw; };
    var rect = function (x, bwid, v, extra) {
      return '<rect x="' + f1(x) + '" y="' + f1(Math.min(Y(v), y0)) + '" width="' + f1(bwid)
        + '" height="' + f1(Math.max(1.5, Math.abs(Y(v) - y0))) + '" rx="3" ' + extra + '/>';
    };
    var g = '<line x1="' + pad.l + '" x2="' + (w - pad.r) + '" y1="' + f1(y0) + '" y2="' + f1(y0)
      + '" stroke="var(--line)"/>';
    for (var i = 0; i < 12; i++) {
      var m = i + 1, x = X(i), on = !o.sel || o.sel.has(m), op = on ? 1 : 0.28;
      var pv = o.plan ? o.plan[i] : null, av = o.act ? o.act[i] : null;
      var late = m > CFG.closedThrough;
      var tip = CFG.months[i]
        + (pv != null ? ' · الخطة ' + fmt(pv) : '')
        + (av != null
          ? ' · ' + (late ? 'حتى اليوم ' : 'الفعلي ') + fmt(av)
          : (late ? ' · ' + (m === CFG.currentMonth ? 'لم يغلق بعد' : 'لم يبدأ بعد') : ''));
      g += '<g class="bm' + (o.click ? ' clk' : '') + '" data-m="' + m + '" data-tip="' + E(tip) + '"'
        + (o.click
          ? ' tabindex="0" role="button" aria-pressed="' + (on && o.sel && o.sel.size < 12)
            + '" aria-label="' + E(CFG.months[i]) + '"'
          : '')
        + '><rect x="' + f1(x) + '" y="0" width="' + f1(bw) + '" height="' + h + '" fill="transparent"/>';
      if (pv != null) g += rect(x + bw * 0.12, bw * 0.76, pv, 'fill="none" stroke="#aeb8cf" stroke-dasharray="3 2" opacity="' + op + '"');
      if (av != null) {
        var fill = av < 0 ? 'var(--red)' : (late ? '#a9bde8' : (o.color || 'var(--primary)'));
        g += rect(x + bw * 0.26, bw * 0.48, av, 'fill="' + E(fill) + '" opacity="' + op + '"');
      }
      g += '<text x="' + f1(x + bw / 2) + '" y="' + (h - 7) + '" text-anchor="middle" font-size="'
        + (o.fs || 10.5) + '" fill="' + (on ? 'var(--ink)' : 'var(--faint-2)') + '">'
        + E(CFG.months[i]) + '</text></g>';
    }
    return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="'
      + E(o.label || 'الفعلي مقابل الخطة شهراً بشهر') + '">' + g + '</svg>';
  }

  // خطوطٌ شهرية بمحورٍ من اليمين: سلاسل متعددة، وشريط إبرازٍ للأشهر المختارة، وخطُّ هدفٍ أفقي
  function lineR(o) {
    o = o || {};
    var w = o.w || 720, h = o.h || 180;
    var pad = { t: 12, r: 44, b: 24, l: 8 };
    if (o.pad) { for (var key in o.pad) if (Object.prototype.hasOwnProperty.call(o.pad, key)) pad[key] = o.pad[key]; }
    var ih = h - pad.t - pad.b, bw = (w - pad.l - pad.r) / 12;
    var X = function (i) { return w - pad.r - (i + 0.5) * bw; };
    var series = o.series || [];
    var all = [];
    series.forEach(function (s) {
      (s.values || []).forEach(function (v) { if (v != null) all.push(v); });
    });
    if (o.hline) all.push(o.hline.v);
    var mn = o.min != null ? o.min : Math.min.apply(null, [0].concat(all));
    var mx = o.max || Math.max.apply(null, [1].concat(all)) * 1.08;
    var Y = function (v) { return pad.t + ih * (mx - v) / (mx - mn); };
    var g = '';
    if (o.band) {
      o.band.forEach(function (m) {
        g += '<rect x="' + f1(X(m - 1) - bw / 2) + '" y="' + pad.t + '" width="' + f1(bw)
          + '" height="' + ih + '" fill="var(--primary-50)"/>';
      });
    }
    for (var k = 0; k <= 3; k++) {
      var y = pad.t + ih * k / 3;
      g += '<line x1="' + pad.l + '" x2="' + (w - pad.r) + '" y1="' + f1(y) + '" y2="' + f1(y)
        + '" stroke="var(--line-2)"/>';
      if (o.yFmt) {
        g += '<text class="svgnum" x="' + (w - 4) + '" y="' + f1(y + 3.5)
          + '" text-anchor="end" font-size="10" fill="var(--faint)">'
          + E(o.yFmt(mx - (mx - mn) * k / 3)) + '</text>';
      }
    }
    if (mn < 0) {
      g += '<line x1="' + pad.l + '" x2="' + (w - pad.r) + '" y1="' + f1(Y(0)) + '" y2="' + f1(Y(0))
        + '" stroke="var(--faint-2)" stroke-dasharray="2 3"/>';
    }
    if (o.hline) {
      g += '<line x1="' + pad.l + '" x2="' + (w - pad.r) + '" y1="' + f1(Y(o.hline.v)) + '" y2="'
        + f1(Y(o.hline.v)) + '" stroke="' + E(o.hline.color) + '" stroke-dasharray="6 4" stroke-width="1.4"/>'
        + '<text x="' + (w - pad.r - 6) + '" y="' + f1(Y(o.hline.v) - 5)
        + '" text-anchor="start" font-size="10.5" fill="' + E(o.hline.color) + '" font-weight="700">'
        + E(o.hline.label || '') + '</text>';
    }
    series.forEach(function (s) {
      var d = '', on = false, first = null, last = null;
      (s.values || []).forEach(function (v, i) {
        if (v == null) { on = false; return; }
        d += (on ? 'L' : 'M') + f1(X(i)) + ' ' + f1(Y(v));
        on = true;
        if (first == null) first = i;
        last = i;
      });
      if (!d) return;
      if (s.area) {
        g += '<path d="' + d + 'L' + f1(X(last)) + ' ' + f1(Y(Math.max(mn, 0))) + 'L' + f1(X(first))
          + ' ' + f1(Y(Math.max(mn, 0))) + 'Z" fill="' + E(s.color) + '" opacity=".08"/>';
      }
      g += '<path d="' + d + '" fill="none" stroke="' + E(s.color) + '" stroke-width="' + (s.sw || 2.2)
        + '"' + (s.dash ? ' stroke-dasharray="5 4"' : '') + ' stroke-linejoin="round" stroke-linecap="round"/>';
      (s.values || []).forEach(function (v, i) {
        if (v == null) return;
        if (s.dots) g += '<circle cx="' + f1(X(i)) + '" cy="' + f1(Y(v)) + '" r="2.8" fill="' + E(s.color) + '"/>';
        if (s.tips) {
          g += '<circle cx="' + f1(X(i)) + '" cy="' + f1(Y(v)) + '" r="10" fill="transparent" data-tip="'
            + E(s.tips(i, v)) + '"/>';
        }
      });
    });
    CFG.months.forEach(function (m, i) {
      g += '<text x="' + f1(X(i)) + '" y="' + (h - 7) + '" text-anchor="middle" font-size="10.5" fill="var(--muted)">'
        + E(m) + '</text>';
    });
    return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="'
      + E(o.label || '') + '">' + g + '</svg>';
  }

  // حلقةُ تحقّقٍ برقمها في وسطها
  function ring(p, o) {
    o = o || {};
    var s = o.size || 64, sw = o.sw || 7, r = (s - sw) / 2, C = 2 * Math.PI * r;
    var pc = Math.max(0, Math.min(1, blank(p) ? 0 : p));
    var txt = o.text || pctTxt(p);
    return '<svg viewBox="0 0 ' + s + ' ' + s + '" width="' + s + '" height="' + s + '" role="img" aria-label="'
      + E(o.label || txt) + '" style="flex:none">'
      + '<circle cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + r + '" fill="none" stroke="var(--track)" stroke-width="' + sw + '"/>'
      + '<circle cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + r + '" fill="none" stroke="'
      + E(o.color || 'var(--primary-2)') + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-dasharray="'
      + C.toFixed(2) + '" stroke-dashoffset="' + (C * (1 - pc)).toFixed(2) + '" transform="rotate(-90 '
      + s / 2 + ' ' + s / 2 + ')"/>'
      + '<text class="svgnum" x="50%" y="50%" dy=".36em" text-anchor="middle" font-size="' + (o.fs || 15)
      + '" font-weight="700" fill="var(--ink)">' + E(txt) + '</text></svg>';
  }

  // نصفُ قوسٍ للإشغال والهامش، مع علامةٍ رفيعة لموضع الخطة على القوس
  function gauge(p, o) {
    o = o || {};
    var w = o.w || 190, sw = o.sw || 16, r = (w - sw) / 2, cx = w / 2, cy = r + sw / 2;
    var h = Math.round(cy + (o.sub ? 20 : sw / 2 + 2));
    var len = Math.PI * r, pc = Math.max(0, Math.min(1, blank(p) ? 0 : p));
    var d = 'M ' + sw / 2 + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + (w - sw / 2) + ' ' + cy;
    var mark = '';
    if (o.mark != null && !blank(o.mark)) {
      var t = Math.PI * (1 - Math.max(0, Math.min(1, o.mark))), r1 = r - sw / 2 - 3, r2 = r + sw / 2 + 3;
      mark = '<line x1="' + f1(cx + r1 * Math.cos(t)) + '" y1="' + f1(cy - r1 * Math.sin(t))
        + '" x2="' + f1(cx + r2 * Math.cos(t)) + '" y2="' + f1(cy - r2 * Math.sin(t))
        + '" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round"'
        + (o.markTip ? ' data-tip="' + E(o.markTip) + '"' : '') + '/>';
    }
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="'
      + E(o.label || o.center || '') + '" style="display:block;max-width:100%;overflow:visible">'
      + '<path d="' + d + '" fill="none" stroke="var(--track)" stroke-width="' + sw + '" stroke-linecap="round"/>'
      + '<path d="' + d + '" fill="none" stroke="' + E(o.color || 'var(--primary-2)') + '" stroke-width="' + sw
      + '" stroke-linecap="round" stroke-dasharray="' + len.toFixed(2) + '" stroke-dashoffset="'
      + (len * (1 - pc)).toFixed(2) + '"/>' + mark
      + (o.center
        ? '<text class="svgnum" x="' + cx + '" y="' + (cy - (o.sub ? 6 : 2)) + '" text-anchor="middle" font-size="'
          + (o.fs || 20) + '" font-weight="700" fill="var(--ink)">' + E(o.center) + '</text>'
        : '')
      + (o.sub
        ? '<text x="' + cx + '" y="' + (cy + 13) + '" text-anchor="middle" font-size="11.5" fill="var(--muted)">'
          + E(o.sub) + '</text>'
        : '')
      + '</svg>';
  }

  // شريطُ إنجازٍ رفيع: الفعلي امتلاءً، والخطة علامةً على مساره
  function bullet(act, plan, o) {
    o = o || {};
    var mx = Math.max(act || 0, plan || 0, 1) * 1.06;
    var a = Math.max(0, Math.min(100, (act || 0) / mx * 100));
    var p = plan ? Math.min(100, plan / mx * 100) : null;
    return '<span class="bul"><i style="width:' + f1(a) + '%;background:' + E(o.color || 'var(--primary)') + '"></i>'
      + (p != null ? '<s style="inset-inline-start:' + f1(p) + '%"></s>' : '') + '</span>';
  }

  // شريطُ العلاقة: إيرادٌ محقَّق، فمتبقٍّ من العقود، ففرصٌ مرجّحة — كلٌّ بنسبته من الأكبر
  // القيم بالريال، والتلميح يذكر البند بقيمته كاملةً لا مختصرة.
  function relBar(parts, mx, o) {
    o = o || {};
    var fmt = o.fmt || intTxt;
    var seg = function (v, color, label) {
      var width = mx ? (v || 0) / mx * 100 : 0;
      return '<i style="width:' + f1(width) + '%;background:' + E(color) + '" data-tip="'
        + E(label + ': ' + fmt(v || 0)) + '"></i>';
    };
    return '<span class="relbar">'
      + seg(parts.rev, 'var(--primary)', 'الإيراد')
      + seg(parts.backlog, 'var(--teal)', 'المتبقي من العقود')
      + seg(parts.pipe, '#834798', 'الفرص المرجّحة')
      + '</span>';
  }

  // شريطٌ مركَّب من قطعٍ نسبتها من مجموعٍ معلوم — القطعة الصفرية لا تُرسم
  function stk(segs, total, o) {
    o = o || {};
    var fmt = o.fmt || intTxt;
    var sum = total;
    if (!sum) {
      sum = (segs || []).reduce(function (t, s) { return t + Math.abs(s.v || 0); }, 0);
    }
    var body = (segs || []).filter(function (s) { return (s.v || 0) > 0; }).map(function (s) {
      var width = sum ? (s.v || 0) / sum * 100 : 0;
      return '<i style="width:' + f1(width) + '%;background:' + E(s.color || 'var(--primary)') + '"'
        + (s.label ? ' data-tip="' + E(s.label + ': ' + fmt(s.v || 0)) + '"' : '') + '></i>';
    }).join('');
    return '<div class="stk">' + body + '</div>';
  }

  // مفتاحُ ألوانِ الشريط المركَّب
  function stkLegend(items) {
    return '<div class="stk-leg">' + (items || []).map(function (it) {
      return '<span style="--c:' + E(it.color || 'var(--primary)') + '">' + E(it.label)
        + (it.value != null ? ' ' + it.value : '') + '</span>';
    }).join('') + '</div>';
  }

  // شارةُ انحراف: في بنود التكلفة الزيادةُ سيئة والنقص جيد، وفي الإيراد العكس
  function varChip(pct, kind, d) {
    if (blank(pct)) return '';
    var cls = Math.abs(pct) < 0.005 ? 'neu' : ((pct > 0) === (kind !== 'cost') ? 'good' : 'bad');
    return '<span class="var ' + cls + '">' + wrap(signedPctTxt(pct, d)) + '</span>';
  }

  // شارةُ فرقٍ بالنقاط — لهامشٍ مقابل هامش
  function ptsChip(x, d) {
    if (blank(x)) return '';
    return '<span class="var ' + (x < 0 ? 'bad' : 'good') + '">' + wrap(signedPtsTxt(x, d)) + ' نقطة</span>';
  }

  CC.fig = {
    spark: spark,
    sparkR: sparkR,
    barsR: barsR,
    lineR: lineR,
    ring: ring,
    gauge: gauge,
    bullet: bullet,
    relBar: relBar,
    stk: stk,
    stkLegend: stkLegend,
    varChip: varChip,
    ptsChip: ptsChip,
  };

  // ── الأيقونات ──────────────────────────────────────────────────────────────
  // مجموعةٌ مقتضبة: ما تستعمله الصفحة واللوحة الجانبية فقط. وما كان له اسمٌ مطابق في
  // أيقونات الخادم (src/web/icons.js) نُسخ مساره منها حرفياً، حتى لا يختلف الشكل الواحد
  // بين ما يرسمه الخادم وما يرسمه المتصفح. الباقي من مجموعة النموذج كما هو.
  var ICONS = {
    // — مشتركةٌ مع أيقونات الخادم: المسار منها —
    building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01M10 21v-4h4v4"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    download: '<path d="M12 3v12m0 0l4-4m-4 4l-4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
    filter: '<path d="M3 5h18l-7 8v5l-4 2v-7z"/>',
    flag: '<path d="M4 21V4h13l-2 4 2 4H4"/>',
    history: '<path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v4h4"/><path d="M12 8v4l3 2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v4h1.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v5h-5"/>',
    users: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0114 0"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    // — من النموذج وحده —
    alert: '<path d="M10.3 4.3 2.8 17.4a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0zM12 9.5v4M12 17h.01"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    chev: '<path d="m7 10 5 5 5-5"/>',
    chevL: '<path d="m14.5 6-6 6 6 6"/>',
    chevR: '<path d="m9.5 6 6 6-6 6"/>',
    database: '<ellipse cx="12" cy="5.8" rx="7.5" ry="2.6"/><path d="M4.5 5.8v12.4c0 1.4 3.4 2.6 7.5 2.6s7.5-1.2 7.5-2.6V5.8M4.5 12c0 1.4 3.4 2.6 7.5 2.6s7.5-1.2 7.5-2.6"/>',
    layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8zM3.5 12.5l8.5 4.5 8.5-4.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    printer: '<path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z"/>',
    reset: '<path d="M4 4.5v5h5M4.8 14a7.5 7.5 0 1 0 1.7-7.6L4 9.5"/>',
    table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 10h17M9.5 10v9.5"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  };

  // اسمٌ لا أيقونة له يعيد فراغاً — فلا يظهر مربّعٌ غريب مكان رمزٍ سقط اسمه.
  CC.icon = function (name, cls) {
    var body = ICONS[name];
    if (!body) return '';
    return '<svg class="ic' + (cls ? ' ' + E(cls) : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  };
  CC.iconNames = function () { return Object.keys(ICONS); };
}());
