// مركز القطاع — الصفحة في المتصفح: الحالة، والحساب، والرسم، والتنقّل.
//
// الصفحة تُرسم من ثلاث حزمٍ يزرعها الخادم في الوسم (بلا أي جلبٍ عند الفتح):
//   #cc-data   — البيانات المسموح بها لهذا القارئ (بالهللات، وكل مصفوفة شهرية اثنا عشر عنصراً)
//   #cc-view   — حالة العرض الأولى كما حلّها الخادم من الرابط (الأشهر والمرشّحات واللوحة المفتوحة)
//   #cc-labels — الأسماء العربية الثابتة (الأشهر، الأرباع، حالات المشروع، كلمات الوحدة…)
//
// قواعد لا تُخرق هنا:
//   • كل رقمٍ يمرّ بـ`CC.fmt.*` (sector-figures.js)، والمال يُحوَّل من الهللات إلى الريال مرة
//     واحدة عند الإقلاع ثم لا يُحوَّل ثانية.
//   • غياب القيمة يبقى غياباً: المجموع على أشهرٍ كلُّها بلا تسجيل يعيد «بلا قيمة» لا صفراً،
//     والشاشة تقول «لم يُسجَّل».
//   • كل نصٍّ يدخل الوسم يمرّ بـ`CC.esc`. والتلميحات نصٌّ صريح بفاصلٍ أوسط — محرّك [data-tip]
//     في app.js يضعها بـtextContent، فأي وسمٍ فيها يظهر حرفياً.
//   • الحساب كله دوالُّ خالصة من (الحالة + البيانات)، ومُعلَنٌ على `CC.calc` — فاللوحة الجانبية
//     (sector-drawer.js) تقرأ الأرقام نفسها ولا تعيد حسابها بطريقةٍ أخرى.
(function () {
  'use strict';

  var root = (typeof window === 'object' && window) ? window : globalThis;
  var CC = root.CC = root.CC || {};
  var E = function (s) { return CC.esc(s); };

  var ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  var COST_KEYS = ['sal', 'con', 'ctr', 'lic', 'rent', 'oth'];
  var DIRECT_KEYS = ['con', 'ctr', 'lic'];          // ما يُنسب إلى مشروعٍ بعينه

  // ── الأسماء: بديلٌ مكتفٍ بنفسه حتى يصل #cc-labels ─────────────────────────
  var G = {
    MONTHS_AR: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
    QUARTERS_AR: ['الربع الأول', 'الربع الثاني', 'الربع الثالث', 'الربع الرابع'],
    HEALTH_LABELS: {},
    healthUnknown: 'غير محدَّدة',
    closedSource: {},
    plReconLegend: '',
    ragOwnerNote: 'كما يحدّدها مدير المشروع في صفحة المشروع، ولا تُحتسب من الأرقام هنا',
    notEnteredYet: 'لم يُسجَّل',
    downloadExcel: 'تنزيل Excel',
    units: {},
  };

  var D = null;         // البيانات بعد التحويل إلى الريال
  var META = {};
  var CLOSED = 0;       // آخر شهر مغلق ماليا
  var TODAY = { m: 0, d: 0 };
  var CUR_YEAR = true;  // هل السنة المعروضة هي سنة اليوم؟ (سنةٌ منقضية أشهرُها كلها مضت)
  var YEAR = 0;
  var SECTOR = { id: '', name_ar: '' };
  var NOTES = {};

  var S = CC.S = {
    months: new Set(ALL),
    depts: new Set(), clients: new Set(), projects: new Set(),
    unit: 'auto',
  };
  var ANCHOR = null;    // مرساة مدى الأشهر (السحب وShift)

  // ── أدوات عامة ───────────────────────────────────────────────────────────
  var byId = function (list) {
    var m = {};
    (list || []).forEach(function (x) { m[x.id] = x; });
    return m;
  };
  var sortedArr = function (set) {
    return Array.from(set).sort(function (a, b) { return a - b; });
  };
  var sameSet = function (set, arr) {
    return set.size === arr.length && arr.every(function (x) { return set.has(x); });
  };
  // مجموعٌ يحترم الغياب: لا مصفوفة ⇒ بلا قيمة، وأشهرٌ كلُّها بلا تسجيل ⇒ بلا قيمة (لا صفر)
  function sumM(arr, months) {
    if (!arr) return null;
    var t = null;
    for (var i = 0; i < months.length; i++) {
      var v = arr[months[i] - 1];
      if (v != null && v === v) t = (t || 0) + v;
    }
    return t;
  }
  function addArr(a, b) {
    var out = [];
    for (var i = 0; i < 12; i++) {
      var x = a ? a[i] : null, y = b ? b[i] : null;
      out[i] = (x == null && y == null) ? null : (x || 0) + (y || 0);
    }
    return out;
  }
  var nulls = function () { return [null, null, null, null, null, null, null, null, null, null, null, null]; };
  var sub = function (a, b) { return (a == null || b == null) ? null : a - b; };
  var div = function (a, b) { return (a == null || !b) ? null : a / b; };

  // ── الصياغة القصيرة ──────────────────────────────────────────────────────
  var unitOf = function () { return S.unit === 'auto' ? undefined : S.unit; };
  CC.m = function (sar) { return CC.fmt.short(sar == null ? null : Math.round(sar * 100), unitOf()); };
  CC.mp = function (sar) { return CC.fmt.plain.short(sar == null ? null : Math.round(sar * 100), unitOf()); };
  CC.pct = function (x, d) { return CC.fmt.pct(x, d); };
  CC.pctp = function (x, d) { return CC.fmt.plain.pct(x, d); };
  CC.num = function (v) { return CC.fmt.int(v); };
  // السنة ليست مقداراً يُعدّ: تُكتب ٢٠٢٦ بلا فاصلة آلاف.
  CC.yr = function (v) { return CC.fmt.year(v); };
  CC.blank = function (v) { return CC.fmt.blank(v); };
  var NONE = function () { return '<span class="muted-p">' + E(G.notEnteredYet) + '</span>'; };
  CC.none = NONE;

  var F = {
    prj: ['مشروع واحد', 'مشروعان', 'مشاريع', 'مشروعاً'],
    cli: ['عميل واحد', 'عميلان', 'عملاء', 'عميلاً'],
    opp: ['فرصة واحدة', 'فرصتان', 'فرص', 'فرصة'],
    emp: ['موظف واحد', 'موظفان', 'موظفين', 'موظفاً'],
    month: ['شهر واحد', 'شهران', 'أشهر', 'شهراً'],
    day: ['يوم واحد', 'يومان', 'أيام', 'يوماً'],
    dept: ['إدارة واحدة', 'إدارتان', 'إدارات', 'إدارة'],
  };
  function cnt(n, f) { return CC.fmt.countAr(n, f[0], f[1], f[2], f[3]); }

  // ── نصوص الفترة والنطاق ──────────────────────────────────────────────────
  function runsOf(set) {
    var a = sortedArr(set), r = [];
    a.forEach(function (m) {
      var last = r[r.length - 1];
      if (last && m === last[1] + 1) last[1] = m; else r.push([m, m]);
    });
    return r;
  }
  function monthsLabel(set) {
    if (!set.size) return 'لا أشهر';
    if (set.size === 12) return 'السنة كاملة';
    return runsOf(set).map(function (r) {
      return r[0] === r[1] ? G.MONTHS_AR[r[0] - 1] : G.MONTHS_AR[r[0] - 1] + '–' + G.MONTHS_AR[r[1] - 1];
    }).join('، ');
  }
  function periodPhrase(months) {
    var r = runsOf(new Set(months));
    if (!r.length) return '';
    if (r.length === 1) {
      return r[0][0] === r[0][1] ? 'في ' + G.MONTHS_AR[r[0][0] - 1]
        : 'من ' + G.MONTHS_AR[r[0][0] - 1] + ' إلى ' + G.MONTHS_AR[r[0][1] - 1];
    }
    return 'في ' + monthsLabel(new Set(months));
  }
  function closedAr(n) {
    return n === 1 ? 'شهر واحد مغلق' : n === 2 ? 'شهران مغلقان'
      : cnt(n, F.month) + (n <= 10 ? ' مغلقة' : ' مغلقاً');
  }
  function scopeName() {
    var one = function (set, map) {
      if (set.size !== 1) return null;
      var it = map[sortedArr(set)[0]] || map[Array.from(set)[0]];
      return it ? it.name : null;
    };
    var parts = [];
    if (S.projects.size) parts.push(one(S.projects, D.prjById) || cnt(S.projects.size, F.prj));
    if (S.clients.size) parts.push('لدى ' + (one(S.clients, D.cliById) || cnt(S.clients.size, F.cli)));
    if (S.depts.size) parts.push('في ' + (one(S.depts, D.deptById) || cnt(S.depts.size, F.dept)));
    return parts.length ? parts.join(' ') : (SECTOR.name_ar || 'القطاع');
  }
  function monthTitle(m) {
    return m <= CLOSED ? 'مغلق ماليا' : m === TODAY.m ? 'الشهر الجاري' : 'لم يبدأ بعد';
  }
  function closeTxt(m) {
    if (m == null) return G.notEnteredYet;
    return m > 12 ? G.MONTHS_AR[m - 13] + ' ' + (YEAR + 1) : G.MONTHS_AR[m - 1] + ' ' + YEAR;
  }
  CC.txt = {
    monthsLabel: monthsLabel, periodPhrase: periodPhrase, closedAr: closedAr,
    scopeName: scopeName, closeTxt: closeTxt, cnt: cnt, F: F, monthTitle: monthTitle,
    runsOf: runsOf,
  };

  // ── الفترات الجاهزة ──────────────────────────────────────────────────────
  function presetMonths(k) {
    if (k === 'year') return ALL.slice();
    // «من بداية السنة» في سنةٍ منقضية هي السنةُ كاملة: شهرُ اليوم لا معنى له في سنةٍ مضت،
    // وقصُّها عليه كان يُخفي أرقام أشهرٍ مسجَّلة ويكتب في الرابط «ytd» بدل «السنة».
    if (k === 'ytd') return ALL.filter(function (m) { return m <= (CUR_YEAR ? (TODAY.m || 12) : 12); });
    if (k === 'closed') return ALL.filter(function (m) { return m <= (CLOSED || 12); });
    if (/^q[1-4]$/.test(k)) { var q = +k[1]; return [q * 3 - 2, q * 3 - 1, q * 3]; }
    return ALL.slice();
  }
  CC.presetMonths = presetMonths;
  function presets() {
    return [
      { k: 'year', t: 'السنة', m: presetMonths('year') },
      { k: 'ytd', t: 'من بداية السنة', m: presetMonths('ytd') },
      { k: 'closed', t: 'حتى آخر شهر مغلق', m: presetMonths('closed') },
    ];
  }

  // ── لوحة المفاتيح على شريط الأشهر: منطقٌ خالص يُختبر وحده ─────────────────
  CC.keys = {
    // الاتجاه بحسّ العربية: اليسار يتقدّم في الأشهر واليمين يرجع
    move: function (idx, key, len) {
      var n = len || 12;
      if (key === 'ArrowLeft' || key === 'ArrowDown') return Math.min(n - 1, idx + 1);
      if (key === 'ArrowRight' || key === 'ArrowUp') return Math.max(0, idx - 1);
      if (key === 'Home') return 0;
      if (key === 'End') return n - 1;
      return idx;
    },
    // Shift مع السهم: يمدّ المدى من المرساة إلى الشهر الجديد، ولا يمسح ما قبله
    extend: function (months, anchor, to) {
      var out = new Set(months);
      var a = Math.min(anchor, to), b = Math.max(anchor, to);
      for (var m = a; m <= b; m++) out.add(m);
      return out;
    },
    toggle: function (months, m) {
      var out = new Set(months);
      if (out.has(m)) out.delete(m); else out.add(m);
      return out;
    },
  };

  // ══════════════════════════ الحساب ══════════════════════════
  var calc = CC.calc = {};

  // المشاريع الظاهرة: الإدارة ثم العميل ثم المشروع — تتالٍ لا تقاطعٌ أعمى
  calc.projectsInScope = function () {
    return (D.projects || []).filter(function (p) {
      return (!S.depts.size || S.depts.has(p.dept_id))
        && (!S.clients.size || S.clients.has(p.client_id));
    });
  };
  calc.projects = function () {
    return calc.projectsInScope().filter(function (p) {
      return !S.projects.size || S.projects.has(p.id);
    });
  };
  calc.scoped = function () { return S.depts.size || S.clients.size || S.projects.size; };
  // إسقاط ما لم يعد ظاهراً بعد تغيير الإدارة أو العميل
  calc.prune = function () {
    var ok = {};
    calc.projectsInScope().forEach(function (p) { ok[p.id] = 1; });
    Array.from(S.projects).forEach(function (id) { if (!ok[id]) S.projects.delete(id); });
  };

  calc.months = function () { return sortedArr(S.months); };
  // ── عدستان لا واحدة ──────────────────────────────────────────────────────
  // `comp` أشهرُ **الكلفة**: المختار ∩ المغلق ماليا. سطرُ كلفةٍ في شهرٍ لم تُقفله المالية
  // غائبٌ لا معدوم، وجمعُه على أشهرٍ مفتوحة يُضخّم مجمل الربح.
  // `revM` أشهرُ **الإيراد**: المختار كما اختاره القارئ، مقصوصاً عند الشهر الجاري في السنة
  // الجارية وحدها (شهرٌ لم يأتِ بعد لا إيراد له). فالإيراد يُسجَّل في سند يوماً بيوم ولا
  // ينتظر إقفال المالية — وحجبُه حتى يُقفل الشهر كان يُظهر «بلا قيمة» فوق إيرادٍ مسجَّل.
  calc.comp = function (months) {
    return (months || calc.months()).filter(function (m) { return m <= CLOSED; });
  };
  calc.revM = function (months) {
    var cap = CUR_YEAR ? (TODAY.m || 12) : 12;
    return (months || calc.months()).filter(function (m) { return m <= cap; });
  };

  // إيراد المشروع شهراً بشهر (من تفصيل الإيراد في البيانات)
  calc.projectRev = function (id) { return D.revByProject[id] || null; };
  calc.revSeries = function () {
    if (!calc.scoped()) {
      var rev = D.lineById.rev;
      return rev ? (rev.sanad || rev.fin || null) : null;
    }
    var t = nulls(), any = false;
    calc.projects().forEach(function (p) {
      var m = calc.projectRev(p.id);
      if (m) { t = addArr(t, m); any = true; }
    });
    return any ? t : null;
  };

  // قائمة الدخل للفترة — على مستوى القطاع من بنود المالية، وعلى مستوى النطاق من المشاريع
  calc.pl = function (months) {
    var sel = months ? sortedArr(new Set(months)) : calc.months();
    var comp = calc.comp(sel);        // أشهر الكلفة: المختار ∩ المغلق
    var revM = calc.revM(sel);        // أشهر الإيراد: المختار حتى الشهر الجاري
    var open = sel.filter(function (m) { return m > CLOSED; });
    var scoped = calc.scoped();
    var L = {}, order = [], hasCost = false;

    // كلُّ سطرٍ يُجمع على عدسته: الإيراد على أشهره، والكلفة على الأشهر المغلقة. والخطةُ تتبع
    // فعليَّها في العمود نفسه، فلا تُقارَن خطةُ ثمانية أشهر بفعليِّ تسعة.
    var mk = function (id, name, kind, flag, planM, actM) {
      var per = kind === 'revenue' ? revM : comp;
      return {
        id: id, name: name, kind: kind, flag: !!flag, planM: planM || null, actM: actM || null,
        fy: planM ? sumM(planM, ALL) : null,
        plan: planM ? sumM(planM, per) : null,
        act: actM ? sumM(actM, per) : null,
        // الإيراد على الأشهر المغلقة وحدها: طرفُ الطرح الذي يخرج منه مجمل الربح، فلا يُطرح
        // منه كلفةُ ثمانية أشهر عن إيراد تسعة.
        actComp: actM ? sumM(actM, comp) : null,
        planSel: planM ? sumM(planM, sel) : null,
        planOpen: planM ? sumM(planM, open) : null,
      };
    };

    if (!scoped) {
      (D.lines || []).forEach(function (l) {
        if (l.id === 'cor' || l.id === 'gp') return;
        L[l.id] = mk(l.id, l.name, l.kind, l.flag, l.plan, l.fin);
        order.push(l.id);
        if (l.kind === 'cost') hasCost = true;
      });
    } else {
      var ps = calc.projects();
      var rev = nulls(), anyRev = false;
      ps.forEach(function (p) {
        var m = calc.projectRev(p.id);
        if (m) { rev = addArr(rev, m); anyRev = true; }
      });
      L.rev = mk('rev', (D.lineById.rev && D.lineById.rev.name) || 'الإيراد', 'revenue', false, null, anyRev ? rev : null);
      order.push('rev');
      DIRECT_KEYS.forEach(function (k) {
        var arr = null, any = false;
        ps.forEach(function (p) {
          var v = p.act && p.act[k];
          if (v && v.length === 12) { arr = addArr(arr || nulls(), v); any = true; }
        });
        if (!any) return;
        var src = D.lineById[k];
        L[k] = mk(k, (src && src.name) || k, 'cost', src && src.flag, null, arr);
        order.push(k);
        hasCost = true;
      });
    }

    // تكلفة الإيراد ومجمل الربح: من الخادم إن أرسلهما، وإلا تُبنيان من البنود الحاضرة
    var costIds = order.filter(function (id) { return L[id].kind === 'cost'; });
    if (hasCost) {
      var srvCor = D.lineById.cor, srvGp = D.lineById.gp;
      if (!scoped && srvCor) {
        L.cor = mk('cor', srvCor.name, 'subtotal', srvCor.flag, srvCor.plan, srvCor.fin);
      } else {
        var planAny = costIds.every(function (id) { return !!L[id].planM; });
        var agg = function (key) {
          var t = null;
          costIds.forEach(function (id) { if (L[id][key] != null) t = (t || 0) + L[id][key]; });
          return t;
        };
        var aggM = function (key) {
          var arr = null;
          costIds.forEach(function (id) { if (L[id][key]) arr = addArr(arr || nulls(), L[id][key]); });
          return arr;
        };
        L.cor = {
          id: 'cor', name: scoped ? 'التكلفة المباشرة' : ((srvCor && srvCor.name) || 'تكلفة الإيراد'),
          kind: 'subtotal', flag: false,
          planM: planAny ? aggM('planM') : null, actM: aggM('actM'),
          fy: planAny ? agg('fy') : null, plan: planAny ? agg('plan') : null,
          act: agg('act'), planSel: planAny ? agg('planSel') : null, planOpen: planAny ? agg('planOpen') : null,
        };
      }
      if (!scoped && srvGp) {
        L.gp = mk('gp', srvGp.name, 'result', srvGp.flag, srvGp.plan, srvGp.fin);
      } else {
        var r = L.rev, c = L.cor;
        L.gp = {
          id: 'gp', name: scoped ? 'مجمل الربح المباشر' : ((srvGp && srvGp.name) || 'مجمل الربح'),
          kind: 'result', flag: false,
          planM: (r.planM && c.planM) ? r.planM.map(function (v, i) { return sub(v, c.planM[i]); }) : null,
          actM: (r.actM && c.actM) ? r.actM.map(function (v, i) { return sub(v, c.actM[i]); }) : null,
          fy: sub(r.fy, c.fy),
          // الخطة والفعلي كلاهما على الأشهر المغلقة: النتيجة تتبع الكلفة لا الإيراد.
          plan: sub(r.planM ? sumM(r.planM, comp) : null, c.plan), act: sub(r.actComp, c.act),
          actComp: sub(r.actComp, c.act),
          planSel: sub(r.planSel, c.planSel), planOpen: sub(r.planOpen, c.planOpen),
        };
      }
    }

    return {
      scope: scoped ? 'projects' : 'sector',
      sel: sel, comp: comp, revM: revM, open: open, L: L, order: order, costIds: costIds, hasCost: hasCost,
      // الهامش نسبةُ نتيجةٍ إلى إيرادها **في الأشهر نفسها** — فمقامُه إيرادُ الأشهر المغلقة.
      margin: {
        fy: L.gp ? div(L.gp.fy, L.rev && L.rev.fy) : null,
        plan: L.gp ? div(L.gp.plan, L.rev ? sumM(L.rev.planM, comp) : null) : null,
        act: L.gp ? div(L.gp.act, L.rev && L.rev.actComp) : null,
      },
    };
  };
  calc.vpct = function (r) {
    if (!r || r.plan == null || !r.plan || r.act == null) return null;
    return r.act / r.plan - 1;
  };

  // إحصاء المشروع: الحالة كما سجّلها مدير المشروع، والإيراد والتكلفة من الفترة
  calc.prjStats = function (p, months) {
    var sel = months && sortedArr(new Set(months));
    var comp = calc.comp(sel);
    // إيراد المشروع مسجَّلٌ في سند، فيُقرأ على الأشهر المختارة لا على المغلقة وحدها؛ أما
    // تكلفته المباشرة فمن سطور المالية، فتبقى على المغلق — والهامش نتيجتُهما في أشهرٍ واحدة.
    var rev = sumM(calc.projectRev(p.id), calc.revM(sel));
    var revComp = sumM(calc.projectRev(p.id), comp);
    var dc = null;
    DIRECT_KEYS.forEach(function (k) {
      var v = p.act && p.act[k];
      if (v && v.length === 12) {
        var s = sumM(v, comp);
        if (s != null) dc = (dc || 0) + s;
      } else if (typeof v === 'number') {
        dc = (dc || 0) + v;
      }
    });
    var gp = sub(revComp, dc);
    // `margin_pct` يأتي نسبةً مئوية (١٢٫٥ = ١٢٫٥٪) وحسابُ الصفحة كلُّه بالكسور، فيُقسم على
    // مئةٍ هنا مرةً واحدة — وإلا طُبع مضروباً في مئةٍ مرتين («الهامش ١٨٠٠٪»).
    var margin = p.margin_pct != null ? p.margin_pct / 100 : div(gp, revComp);
    var ty = sumM(calc.projectRev(p.id), ALL);
    return {
      rev: rev, revComp: revComp, dc: dc, gp: gp, margin: margin, ty: ty,
      rag: p.rag || null, unbilled: p.unbilled, remaining: p.remaining, contract: p.contract,
      done: div(sub(p.contract, p.remaining), p.contract),
    };
  };
  calc.groupOf = function (list, months) {
    var rev = null, revComp = null, dc = null, contract = null, remaining = null, unbilled = null;
    (list || []).forEach(function (p) {
      var s = calc.prjStats(p, months);
      if (s.rev != null) rev = (rev || 0) + s.rev;
      if (s.revComp != null) revComp = (revComp || 0) + s.revComp;
      if (s.dc != null) dc = (dc || 0) + s.dc;
      if (p.contract != null) contract = (contract || 0) + p.contract;
      if (p.remaining != null) remaining = (remaining || 0) + p.remaining;
      if (p.unbilled != null) unbilled = (unbilled || 0) + p.unbilled;
    });
    // النتيجة والهامش على الأشهر المغلقة وحدها (طرفا الطرح من شهرٍ واحد)، والإيراد المعروض
    // على ما اختير — فالقارئ يرى إيراده كما سجّله سند لا كما أقفلته المالية.
    var gp = sub(revComp, dc);
    return {
      ps: list || [], rev: rev, revComp: revComp, dc: dc, gp: gp, margin: div(gp, revComp),
      contract: contract, remaining: remaining, unbilled: unbilled,
    };
  };
  calc.contracts = function () { return calc.groupOf(calc.projects()); };

  // الفرص: العميل يحدّها، ثم إدارة المشاريع إن كانت هي المرشِّح الوحيد
  calc.opps = function () {
    var list = D.opps || [];
    if (S.clients.size) return list.filter(function (o) { return S.clients.has(o.client_id); });
    if (S.projects.size || S.depts.size) {
      var cs = {};
      calc.projects().forEach(function (p) { cs[p.client_id] = 1; });
      return list.filter(function (o) { return cs[o.client_id]; });
    }
    return list;
  };
  calc.pipeOf = function (list) {
    list = list || [];
    var w = function (o) { return (o.value || 0) * (o.prob || 0); };
    var sum = function (a, f) { return a.reduce(function (t, o) { return t + f(o); }, 0); };
    var st = list.filter(function (o) { return o.stalled; });
    var yr = list.filter(function (o) { return o.close_m != null && o.close_m <= 12; });
    return {
      list: list, count: list.length, value: sum(list, function (o) { return o.value || 0; }),
      weighted: sum(list, w), stalled: st.length, stalledVal: sum(st, function (o) { return o.value || 0; }),
      yearVal: sum(yr, function (o) { return o.value || 0; }), yearW: sum(yr, w), yearN: yr.length,
      stages: (D.stages || []).map(function (sg) {
        var l = list.filter(function (o) { return o.stage_key === sg.key; });
        return {
          key: sg.key, name: sg.name, color: sg.color || 'var(--brand)', n: l.length,
          value: sum(l, function (o) { return o.value || 0; }), weighted: sum(l, w),
          stalled: l.filter(function (o) { return o.stalled; }).length,
        };
      }),
    };
  };

  // العميل: إيرادٌ في الفترة، ومتبقٍّ من عقوده، وفرصٌ مرجّحة
  calc.clientRel = function (cid, months) {
    var ps = (D.projects || []).filter(function (p) { return p.client_id === cid; });
    var g = calc.groupOf(ps, months);
    var pp = calc.pipeOf((D.opps || []).filter(function (o) { return o.client_id === cid; }));
    return {
      id: cid, c: D.cliById[cid] || { id: cid, name: '' }, g: g, pp: pp,
      rev: g.rev || 0, backlog: g.remaining || 0, pipe: pp.weighted,
      total: (g.rev || 0) + (g.remaining || 0) + pp.weighted,
    };
  };
  calc.clientsInScope = function () {
    if (!calc.scoped()) return (D.clients || []).filter(function (c) { return !c.prospect; });
    var ids = {};
    calc.projects().forEach(function (p) { ids[p.client_id] = 1; });
    return (D.clients || []).filter(function (c) { return ids[c.id]; });
  };

  calc.staffing = function () {
    var st = D.staffing;
    if (!st) return null;
    var head = st.head, alloc = st.alloc_now;
    return {
      head: head, idle: st.idle, alloc: alloc, cap: st.cap || null, allocM: st.alloc || null,
      occ: div(alloc, head), free: sub(head, alloc),
    };
  };

  // الوقت مقابل الإيراد
  calc.outlook = function () {
    var revTD = sumM(calc.revSeries(), ALL);
    var scoped = calc.scoped();
    var plan = D.plan || {};
    var target = scoped ? null : (plan.sector_target != null ? plan.sector_target : null);
    var out = D.outlook || {};
    var pp = calc.pipeOf(calc.opps());
    var elapsed = TODAY.m ? (((TODAY.m - 1) + Math.min(1, (TODAY.d || 0) / 30)) / 12) : null;
    var left = TODAY.m ? (12 - TODAY.m + (1 - Math.min(1, (TODAY.d || 0) / 30))) : 12;
    return {
      scope: scoped ? 'projects' : 'sector',
      revTD: revTD, target: target,
      forecast: scoped ? null : (out.forecast != null ? out.forecast : null),
      low: out.low != null ? out.low : null, high: out.high != null ? out.high : null,
      pace: out.pace != null ? out.pace : null,
      coverage: scoped ? null : (out.coverage != null ? out.coverage : null),
      pipe: pp.weighted, pp: pp,
      salesTarget: scoped ? null : (plan.sales_target != null ? plan.sales_target : null),
      elapsed: elapsed,
      need: (target != null && revTD != null) ? Math.max(0, target - revTD) / Math.max(0.5, left) : null,
      pctTD: div(revTD, target),
      monthlyTarget: plan.monthly_target || null,
    };
  };

  // ملاحظاتٌ بقواعد معلنة على الأرقام — وحدها ما لا يرسله الخادم في تغذية «ما يحتاج انتباهك»
  calc.insights = function () {
    var out = [];
    var P = calc.pl(), L = P.L;
    var comp = P.comp;
    var push = function (sev, ic, t, s, act) { out.push({ sev: sev, ic: ic, t: t, s: s, act: act }); };

    if (comp.length && L.gp && L.rev && L.rev.act != null) {
      var lossM = comp.filter(function (m) { return L.gp.actM && L.gp.actM[m - 1] != null && L.gp.actM[m - 1] < 0; });
      if (lossM.length) {
        push(2, 'alert', 'مجمل الربح سالب في ' + monthsLabel(new Set(lossM)),
          'الإيراد لم يغطِّ التكلفة في هذه الأشهر', { k: 'line', id: 'gp' });
      }
    }
    if (comp.length) {
      calc.projects().map(function (p) { return { p: p, s: calc.prjStats(p) }; })
        .filter(function (x) { return x.s.rev != null && x.s.rev > 0 && x.s.margin != null && x.s.margin < 0; })
        .sort(function (a, b) { return (a.s.gp || 0) - (b.s.gp || 0); })
        .slice(0, 3)
        .forEach(function (x) {
          push(2, 'layers', 'مشروع ' + x.p.name + ' خاسر في الفترة',
            'هامشه المباشر ' + CC.pctp(x.s.margin, 1), { k: 'prj', id: x.p.id });
        });
    }
    var c = calc.contracts();
    if (c.unbilled != null && c.unbilled >= 500000) {
      var top = calc.projects().slice().sort(function (a, b) { return (b.unbilled || 0) - (a.unbilled || 0); })[0];
      push(2, 'task', 'أعمال منجزة لم تُفوتر بقيمة ' + CC.mp(c.unbilled),
        top ? 'أكبرها ' + top.name + ' ' + CC.mp(top.unbilled) : '', { k: 'billing' });
    }
    var o = calc.outlook();
    if (o.coverage != null && o.coverage < 1) {
      push(2, 'flag', 'خط الفرص يغطّي ' + CC.pctp(o.coverage) + ' مما بقي من هدف المبيعات',
        'الخط المرجّح ' + CC.mp(o.pipe), { k: 'pipe' });
    }
    if (o.pp.stalled) {
      push(2, 'clock', cnt(o.pp.stalled, F.opp) + ' متوقفة بقيمة ' + CC.mp(o.pp.stalledVal),
        'لم تتقدّم منذ أكثر من ستين يوماً', { k: 'opps', id: 'stalled' });
    }
    var tm = calc.staffing();
    if (tm && tm.idle) {
      push(1, 'users', cnt(tm.idle, F.emp) + ' بلا تسكين', 'سعةٌ غير مستغلّة في الفريق', { k: 'team' });
    }
    if (!calc.scoped()) {
      var rs = calc.clientsInScope().map(function (cl) { return calc.clientRel(cl.id); })
        .sort(function (a, b) { return b.rev - a.rev; });
      var tot = rs.reduce(function (t, x) { return t + x.rev; }, 0);
      if (rs.length >= 3 && tot) {
        var top3 = (rs[0].rev + rs[1].rev + rs[2].rev) / tot;
        if (top3 >= 0.4) {
          push(1, 'building', CC.pctp(top3) + ' من الإيراد لدى أكبر ثلاثة عملاء',
            'أكبرهم ' + rs[0].c.name + ' بنسبة ' + CC.pctp(rs[0].rev / tot), { k: 'clients' });
        }
      }
    }
    return out.sort(function (a, b) { return b.sev - a.sev; });
  };

  // ══════════════════════════ الرابط ══════════════════════════
  // مفاتيح v6.01 نفسها: السنة والقطاع والفترة والمشروع والإدارة والعميل — فما يُنسخ من شريط
  // العنوان يفتح عند غيرك كما هو، وأزرار الطباعة والتنزيل تحمل الفلاتر الحالية لا غيرها.
  function periodParam() {
    var ms = calc.months();
    if (!ms.length) return {};
    if (S.months.size === 12) return { p: 'y' };
    if (TODAY.m && sameSet(S.months, presetMonths('ytd'))) return { p: 'ytd' };
    var r = runsOf(S.months);
    if (r.length !== 1) return { months: ms.join(',') };   // اختيارٌ متقطّع لا يختصره حرفان
    var a = r[0][0], b = r[0][1];
    var isQ = function (x, y) { return x % 3 === 1 && y === x + 2; };
    if (isQ(a, b)) return { p: 'q' + ((a + 2) / 3) };
    if (a % 3 === 1 && b % 3 === 0) return { p: 'q' + ((a + 2) / 3) + '-q' + (b / 3) };
    if (a === b) return { p: 'm' + a };
    return { p: 'm' + a + '-m' + b };
  }
  CC.url = {
    params: function () {
      var q = {};
      if (YEAR) q.year = String(YEAR);
      if (SECTOR.id) q.sector = SECTOR.id;
      var per = periodParam();
      Object.keys(per).forEach(function (k) { q[k] = per[k]; });
      if (S.projects.size) q.project = Array.from(S.projects).join(',');
      if (S.depts.size) q.dept = Array.from(S.depts).join(',');
      if (S.clients.size) q.client = Array.from(S.clients).join(',');
      return q;
    },
    query: function (extra) {
      var q = CC.url.params();
      if (extra) Object.keys(extra).forEach(function (k) { q[k] = extra[k]; });
      return Object.keys(q).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]);
      }).join('&');
    },
    write: function () {
      try {
        var qs = CC.url.query();
        root.history.replaceState(null, '', root.location.pathname + (qs ? '?' + qs : ''));
      } catch (e) { /* الرابط عونُ مشاركة — لا يُسقط الصفحة */ }
    },
    printPl: function () { return '/app/sector/income-statement?' + CC.url.query(); },
    xlsxPl: function () {
      return '/api/sectors/' + encodeURIComponent(SECTOR.id) + '/income-statement.xlsx?' + CC.url.query();
    },
    xlsxAll: function () {
      return '/api/sectors/' + encodeURIComponent(SECTOR.id) + '/command-center.xlsx?' + CC.url.query();
    },
  };

  // ══════════════════════════ التنقّل ══════════════════════════
  CC.goAttr = function (spec) { return ' data-go="' + E(JSON.stringify(spec)) + '"'; };
  CC.go = function (spec, trigger) {
    if (!spec) return;
    if (spec.k === 'filter') {                      // فعلُ فلترةٍ لا لوحةَ تفاصيل
      if (spec.f === 'reset') resetFilters();
      else if (spec.f && S[spec.f] && spec.id) { S[spec.f].clear(); S[spec.f].add(spec.id); calc.prune(); }
      changed();
      CC.toast('المعروض الآن: ' + scopeName());
      return;
    }
    if (spec.k === 'unit') { S.unit = spec.id; changed(); return; }
    if (CC.drawer && CC.drawer.open) CC.drawer.open(spec, trigger);
  };

  // ══════════════════════════ الإشعار ══════════════════════════
  // إشعارٌ صغير: من المنصة إن كان مركَّباً، وإلا عنصرٌ محلّي بنمطٍ داخلي — لا صنف `.toast`
  // في ورقة الصفحة (sector.css لا تعرّفه)، فلا نتكئ على تنسيقٍ غير موجود.
  CC.toast = function (msg, bad) {
    var Sd = root.Sanad;
    if (Sd && typeof Sd.toast === 'function') { Sd.toast(msg, bad); return; }
    if (!root.document || !root.document.body) return;
    var d = root.document.createElement('div');
    d.textContent = msg;
    d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;'
      + 'color:#fff;font-size:13px;max-width:min(92vw,420px);line-height:1.7;'
      + 'box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#b91c1c' : '#047857');
    root.document.body.appendChild(d);
    setTimeout(function () { if (d.remove) d.remove(); }, bad ? 6000 : 2600);
  };

  // ══════════════════════════ الرسم ══════════════════════════
  var $ = function (sel) { return root.document ? root.document.querySelector(sel) : null; };
  var pick = function () {
    for (var i = 0; i < arguments.length; i++) { var el = $(arguments[i]); if (el) return el; }
    return null;
  };
  var setHTML = function (el, html) { if (el) el.innerHTML = html; };

  // عنوانُ البطاقة <h2>: عنوان الصفحة <h1> فوقها، فلا تُقفَز درجةٌ في سلَّم العناوين — قارئُ
  // الشاشة يتنقّل بالسلَّم، والقفزة تُفقده موضعه.
  var cardHead = function (ic, title, badge, sub, all) {
    return '<div class="ch"><span class="ch-i">' + CC.icon(ic) + '</span><div class="ch-t"><h2>' + E(title)
      + (badge != null ? '<em>' + badge + '</em>' : '') + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>'
      + (all ? '<button type="button" class="ch-all"' + CC.goAttr(all) + '>الكل' + CC.icon('chevL') + '</button>' : '')
      + '</div>';
  };
  var ragCls = function (rag) { return rag === 'RED' ? 'bad' : rag === 'AMBER' ? 'warn' : 'good'; };
  var ragDot = function (rag) { return rag === 'RED' ? '#dc5a4d' : rag === 'AMBER' ? '#e0a33a' : '#35a17c'; };
  // التقييم الغائب اسمٌ واحد في المنصة كلها («غير محدَّدة» من عتبات الحالة) — يصل في الأسماء
  // ولا يُكتب هنا بصياغةٍ ثانية تخالف البريد والتقارير.
  var ragName = function (rag) {
    return (G.HEALTH_LABELS && G.HEALTH_LABELS[rag]) || G.healthUnknown;
  };
  CC.rag = { cls: ragCls, dot: ragDot, name: ragName };

  // ── الوقت مقابل الإيراد ──────────────────────────────────────────────────
  // زرٌّ حقيقي داخل البطاقة هو بابُها للوحة المفاتيح وقارئ الشاشة — والقسمُ الحاوي يبقى قسماً
  // بلا دورٍ مُدّعى، ونقرُه على اتساعه يفتح اللوحة نفسها من `data-go` عليه.
  function heroHit() {
    return '<button type="button" class="hero-hit"' + CC.goAttr({ k: 'pace' })
      + ' aria-label="الوقت مقابل الإيراد — افتح التفاصيل">التفاصيل</button>';
  }

  function heroHTML() {
    var o = calc.outlook();
    var W = function (x) { return Math.max(0, Math.min(100, (x || 0) * 100)).toFixed(1) + '%'; };
    var t = o.elapsed, a = o.pctTD;
    if (o.target == null || a == null) {
      var lead = o.revTD == null ? NONE() : CC.m(o.revTD);
      return '<div class="h-head"><span class="h-q">الوقت مقابل الإيراد</span>'
        // بلا نقطةٍ في آخر الجملة: الجملة تنتهي برقمٍ معزولٍ بالاتجاه (<bdi dir="ltr">)، فتقع
        // النقطة العربية على يساره فتُقرأ ذرّةً شاردةً بعد «1.4M». وبقية جُمل الشاشة المنتهية
        // برقمٍ بلا نقطةٍ كذلك.
        + '<p class="h-lead">الإيراد حتى اليوم <b>' + lead + '</b></p>'
        + '<p class="h-sub">' + (calc.scoped()
          ? 'لا خطة إيرادٍ على مستوى المشروع أو العميل، فالمقارنة بالزمن تُقاس على القطاع كاملاً.'
          : 'لم يُسجَّل مستهدفٌ للسنة، فلا تُقاس النسبة.') + '</p>' + heroHit() + '</div>';
    }
    var gap = Math.round((t - a) * 100);
    var f = (o.forecast != null && o.target) ? o.forecast / o.target : null;
    var inside = function (cls, w, txt) {
      return parseFloat(w) >= 11
        ? '<i class="' + cls + '" style="width:' + w + '"><span>' + txt + '</span></i>'
        : '<i class="' + cls + '" style="width:' + w + '"></i><i class="out" style="inset-inline-start:' + w + '"><span>' + txt + '</span></i>';
    };
    var head = '<div class="h-head"><span class="h-q">الوقت مقابل الإيراد، حتى '
      + CC.num(TODAY.d) + ' ' + E(G.MONTHS_AR[(TODAY.m || 1) - 1]) + '</span>'
      + '<p class="h-lead">تحقّق <b>' + CC.pct(a) + '</b> من المستهدف، ومضى <b>' + CC.pct(t) + '</b> من السنة.</p>'
      + '<p class="h-sub">' + (gap > 0
        ? '<span class="h-gap bad">الإيراد متأخر ' + CC.num(gap) + ' نقطة عن الوقت</span>'
        : '<span class="h-gap good">الإيراد متقدّم ' + CC.num(-gap) + ' نقطة على الوقت</span>') + '</p>'
      + heroHit() + '</div>';
    var tracks = '<div class="h-tracks">'
      + '<div class="h-trk"><span class="h-l">الوقت</span><div class="h-bar">' + inside('t', W(t), CC.pct(t))
      + '</div><span class="h-e">نهاية السنة</span></div>'
      + '<div class="h-trk"><span class="h-l">الإيراد</span><div class="h-bar">'
      + (f != null ? '<i class="f" style="width:' + W(f) + '" data-tip="'
        + E('المتوقع بنهاية السنة · ' + CC.mp(o.forecast)) + '"></i>' : '')
      + (gap > 0 ? '<i class="g" style="inset-inline-start:' + W(a) + ';width:' + W(t - a) + '" data-tip="'
        + E('فجوة ' + gap + ' نقطة بين الوقت والإيراد') + '">'
        + (gap >= 8 ? '<span>' + CC.num(gap) + ' نقطة</span>' : '') + '</i>' : '')
      + inside('r', W(a), CC.m(o.revTD)) + '</div><span class="h-e">المستهدف <b>' + CC.m(o.target) + '</b></span></div>'
      + '<div class="h-scale"><span></span><div>' + G.MONTHS_AR.map(function (m, i) {
        return '<span class="' + (i + 1 <= CLOSED ? 'cl' : (i + 1 === TODAY.m ? 'op' : '')) + '">' + E(m) + '</span>';
      }).join('') + '</div><span class="h-keys">'
      + (f != null ? '<span class="h-key"><i class="kf"></i>المتوقع</span>' : '')
      + (gap > 0 ? '<span class="h-key"><i class="kg"></i>الفجوة</span>' : '') + '</span></div></div>';
    var facts = [
      ['الفعلي حتى اليوم', CC.m(o.revTD), 'من سند'],
      ['مستهدف السنة', CC.m(o.target), (D.plan && D.plan.finance_plan_fy != null)
        ? 'وخطة المالية ' + CC.mp(D.plan.finance_plan_fy) : 'مستهدف القطاع'],
    ];
    if (o.forecast != null) facts.push(['المتوقع بنهاية السنة', CC.m(o.forecast), CC.pctp(f) + ' من المستهدف']);
    else facts.push(['المتوقع بنهاية السنة', NONE(), 'لم يُحتسب بعد']);
    facts.push(['المطلوب شهرياً', o.need == null ? NONE() : CC.m(o.need), 'حتى نهاية ديسمبر']);
    return head + tracks + '<div class="h-facts">' + facts.map(function (x) {
      return '<div><span>' + E(x[0]) + '</span><b>' + x[1] + '</b><small>' + x[2] + '</small></div>';
    }).join('') + '</div>';
  }

  // ── شريط قائمة الدخل والخلاصة ────────────────────────────────────────────
  function bandHTML() {
    var P = calc.pl(), L = P.L, o = calc.outlook(), c = calc.contracts(), tm = calc.staffing();
    var pp = o.pp;
    var rows = calc.projects().map(function (p) { return calc.prjStats(p); });
    var late = rows.filter(function (s) { return s.rag === 'RED'; }).length;
    var watch = rows.filter(function (s) { return s.rag === 'AMBER'; }).length;
    var per = P.comp.length ? monthsLabel(new Set(P.comp)) : 'الفترة';
    var cell = function (spec, label, tag, val, vis, sub) {
      return '<button type="button" class="sbc"' + CC.goAttr(spec) + '><span class="sbc-l">' + E(label)
        + '<em>' + E(tag) + '</em></span><span class="sbc-m"><b>' + val + '</b>' + (vis || '')
        + '</span><span class="sbc-s">' + sub + '</span></button>';
    };
    var ring = function (p, color) {
      return CC.fig.ring(p, { size: 40, sw: 5, color: color, text: ' ', label: CC.pctp(p) });
    };
    var cells = [];
    cells.push(cell({ k: 'projects', id: 'all' }, 'المشاريع', 'الآن', CC.num(rows.length),
      '<span class="sbc-dots">' + rows.map(function (s) {
        return '<i style="background:' + ragDot(s.rag) + '"></i>';
      }).join('') + '</span>',
      late ? '<span class="bad">' + E(cnt(late, F.prj) + ' ' + ragName('RED')) + '</span>'
        + (watch ? '، و' + CC.num(watch) + ' ' + E(ragName('AMBER')) : '')
        : 'لا مشروع متعثّر'));
    cells.push(cell({ k: 'billing' }, 'منجز لم يُفوتر', 'الآن',
      c.unbilled == null ? NONE() : CC.m(c.unbilled), '', 'أعمالٌ أُنجزت ولم تصدر فواتيرها'));
    cells.push(cell({ k: 'pipe' }, 'خط الفرص المرجّح', 'الآن', CC.m(pp.weighted), '',
      (o.coverage != null ? 'يغطّي <span class="warn">' + CC.pct(o.coverage) + '</span> مما بقي من هدف المبيعات'
        : cnt(pp.count, F.opp))
      + (pp.stalled ? '، و' + E(cnt(pp.stalled, F.opp)) + ' متوقفة' : '')));
    cells.push(cell({ k: 'line', id: 'gp' }, L.gp ? L.gp.name : 'مجمل الربح', per,
      (L.gp && P.comp.length && L.gp.act != null) ? CC.m(L.gp.act) : NONE(), '',
      (L.gp && P.margin.act != null)
        ? 'الهامش ' + CC.pct(P.margin.act, 1) + (P.margin.plan != null ? ' مقابل ' + CC.pctp(P.margin.plan, 1) + ' في الخطة' : '')
        : (P.hasCost ? 'لا أشهر مغلقة في الفترة' : 'التكاليف لا تظهر لك')));
    cells.push(cell({ k: 'billing' }, 'المتبقي من العقود', 'الآن',
      c.remaining == null ? NONE() : CC.m(c.remaining),
      '', c.contract != null ? 'من عقودٍ قيمتها ' + CC.mp(c.contract) : ''));
    cells.push(cell({ k: 'team' }, 'إشغال الفريق', 'الآن',
      tm && tm.occ != null ? CC.pct(tm.occ) : NONE(),
      tm && tm.occ != null ? ring(tm.occ, '#2f9e8f') : '',
      tm ? E(cnt(tm.head, F.emp)) + (tm.idle ? '، و' + CC.num(tm.idle) + ' بلا تسكين' : '، والكلّ مسكَّن') : ''));
    return '<div class="sbar7" role="region" aria-label="خلاصة القطاع" style="--cols:' + cells.length + '">'
      + cells.join('') + '</div>';
  }

  // ── بطاقة المشاريع ───────────────────────────────────────────────────────
  function projectsCard(n) {
    var list = calc.projects();
    var rows = list.map(function (p) { return { p: p, s: calc.prjStats(p) }; });
    var g = calc.groupOf(list);
    var byRag = function (r) { return rows.filter(function (x) { return x.s.rag === r; }).length; };
    var rank = { RED: 0, AMBER: 1, GREEN: 2 };
    var top = rows.slice().sort(function (a, b) {
      return (rank[a.s.rag] == null ? 3 : rank[a.s.rag]) - (rank[b.s.rag] == null ? 3 : rank[b.s.rag]);
    }).slice(0, n || 5);
    var h = cardHead('table', 'المشاريع', list.length,
      byRag('RED') ? E(cnt(byRag('RED'), F.prj) + ' ' + ragName('RED')) : 'لا مشروع متعثّر',
      { k: 'projects', id: 'all' });
    h += '<div class="sbar" role="group" aria-label="المشاريع حسب الحالة">'
      + ['RED', 'AMBER', 'GREEN'].filter(byRag).map(function (r) {
        return '<button type="button" style="flex:' + byRag(r) + ';--c:' + ragDot(r) + '"'
          + CC.goAttr({ k: 'projects', id: r }) + '><b>' + CC.num(byRag(r)) + '</b>' + E(ragName(r)) + '</button>';
      }).join('') + '</div>';
    h += '<div class="mstats">'
      + '<button type="button"' + CC.goAttr({ k: 'billing' }) + '><span>قيمة العقود</span><b>'
      + (g.contract == null ? NONE() : CC.m(g.contract)) + '</b></button>'
      + '<button type="button"' + CC.goAttr({ k: 'billing' }) + '><span>المتبقي منها</span><b>'
      + (g.remaining == null ? NONE() : CC.m(g.remaining)) + '</b></button>'
      + '<button type="button"' + CC.goAttr({ k: 'billing' }) + '><span>منجز لم يُفوتر</span><b>'
      + (g.unbilled == null ? NONE() : CC.m(g.unbilled)) + '</b></button></div>';
    h += '<div class="clist">' + top.map(function (x) {
      var cl = D.cliById[x.p.client_id];
      return '<button type="button" class="cl"' + CC.goAttr({ k: 'prj', id: x.p.id })
        + '><i class="dot" style="background:' + ragDot(x.s.rag) + '"></i><span class="cl-n"><b>' + E(x.p.name)
        + '</b><small>' + E((cl && cl.name) || '') + '، ' + E(ragName(x.s.rag)) + '</small></span>'
        + '<span class="cl-v"><b>' + (x.s.rev == null ? NONE() : CC.m(x.s.rev)) + '</b><small class="'
        + (x.s.margin != null && x.s.margin < 0 ? 'bad' : '') + '">'
        + (x.s.margin == null ? E(G.notEnteredYet) : 'الهامش ' + CC.pctp(x.s.margin)) + '</small></span></button>';
    }).join('') + '</div>';
    return h;
  }

  // ── بطاقة الفرص ──────────────────────────────────────────────────────────
  function oppsCard(n) {
    var pp = calc.pipeOf(calc.opps());
    var mxN = Math.max.apply(null, [1].concat(pp.stages.map(function (x) { return x.n; })));
    var top = pp.list.slice().sort(function (a, b) {
      return (b.value || 0) * (b.prob || 0) - (a.value || 0) * (a.prob || 0);
    }).slice(0, n || 4);
    var h = cardHead('flag', 'الفرص', pp.count,
      'قيمتها المرجّحة ' + CC.mp(pp.weighted) + ' من ' + CC.mp(pp.value), { k: 'opps', id: 'all' });
    h += '<div class="fun">' + pp.stages.map(function (x) {
      return '<button type="button" class="fu"' + CC.goAttr({ k: 'opps', id: x.key })
        + '><span class="fu-n">' + E(x.name) + '</span><span class="fu-b">'
        + (x.n ? '<i style="width:' + (x.n / mxN * 100).toFixed(1) + '%;background:' + E(x.color) + '">'
          + (x.stalled ? '<s style="width:' + (x.stalled / x.n * 100).toFixed(1) + '%"></s>' : '')
          + '<em>' + CC.num(x.n) + '</em></i>' : '<small class="fu-z">لا فرص</small>')
        + '</span><b>' + (x.n ? CC.m(x.weighted) : NONE()) + '</b></button>';
    }).join('') + '</div>';
    if (pp.stalled) {
      h += '<button type="button" class="pill-w"' + CC.goAttr({ k: 'opps', id: 'stalled' }) + '>'
        + CC.icon('clock') + '<span>' + E(cnt(pp.stalled, F.opp)) + ' متوقفة بقيمة <b>'
        + CC.m(pp.stalledVal) + '</b></span></button>';
    }
    h += '<div class="clist">' + top.map(function (o) {
      var cl = D.cliById[o.client_id] || {}, sg = D.stageByKey[o.stage_key] || {};
      return '<button type="button" class="cl"' + CC.goAttr({ k: 'opp', id: o.id })
        + '><i class="dot sq" style="background:' + E(sg.color || 'var(--brand)') + '"></i>'
        + '<span class="cl-n"><b>' + E(o.name) + (cl.prospect ? ' <em class="newc">عميل جديد</em>' : '')
        + '</b><small>' + E(cl.name || '') + '، ' + E(sg.name || '') + '، الإغلاق ' + E(closeTxt(o.close_m))
        + '</small></span><span class="cl-v"><b>' + CC.m((o.value || 0) * (o.prob || 0))
        + '</b><small>من ' + CC.mp(o.value) + '</small></span></button>';
    }).join('') + '</div>';
    return h;
  }

  // ── بطاقة أكبر العملاء ───────────────────────────────────────────────────
  function clientsCard(n) {
    var rs = calc.clientsInScope().map(function (c) { return calc.clientRel(c.id); })
      .sort(function (a, b) { return b.rev - a.rev; });
    var tot = rs.reduce(function (t, r) { return t + r.rev; }, 0);
    var top = rs.slice(0, n || 6);
    var mx = Math.max.apply(null, [1].concat(top.map(function (r) { return r.total; })));
    var pros = (D.clients || []).filter(function (c) { return c.prospect; });
    var newW = pros.reduce(function (t, c) { return t + calc.clientRel(c.id).pipe; }, 0);
    var h = cardHead('building', 'أكبر العملاء', null,
      (rs.length >= 3 && tot) ? 'أكبر ثلاثة عملاء يحقّقون '
        + CC.pctp((rs[0].rev + rs[1].rev + rs[2].rev) / tot) + ' من الإيراد' : '', { k: 'clients' });
    h += '<div class="rleg"><span style="--c:var(--brand)">الإيراد</span>'
      + '<span style="--c:var(--teal)">المتبقي من العقود</span>'
      + '<span style="--c:#834798">الفرص المرجّحة</span><em>والرقم مجموعها</em></div>';
    h += '<div class="clist rl">' + top.map(function (r) {
      return '<button type="button" class="cl"' + CC.goAttr({ k: 'cli', id: r.id })
        + '><span class="cl-n"><b>' + E(r.c.name) + '</b><small>' + CC.pctp(tot ? r.rev / tot : 0)
        + ' من الإيراد، ' + E(cnt(r.g.ps.length, F.prj)) + '</small></span>'
        + CC.fig.relBar({ rev: r.rev, backlog: r.backlog, pipe: r.pipe }, mx, { fmt: CC.mp })
        + '<span class="cl-v"><b>' + CC.m(r.total) + '</b></span></button>';
    }).join('') + '</div>';
    if (!calc.scoped() && pros.length) {
      h += '<button type="button" class="pill-n"' + CC.goAttr({ k: 'clients' }) + '>' + CC.icon('plus')
        + '<span>' + E(cnt(pros.length, F.cli)) + ' جدد في خط الفرص، بقيمة مرجّحة <b>'
        + CC.m(newW) + '</b></span></button>';
    }
    return h;
  }

  // ── بطاقة المال ──────────────────────────────────────────────────────────
  function riyalBar(P) {
    var L = P.L;
    // القسمة على إيراد الأشهر المغلقة وحدها: شريطُ «من كل مئة ريال» طرفاه من شهرٍ واحد.
    if (!L.rev || L.rev.actComp == null || !L.rev.actComp || !L.cor || L.cor.act == null) return '';
    var rev = L.rev.actComp, cor = L.cor.act, base = Math.max(rev, cor);
    var COLORS = { sal: '#19376d', ctr: '#2f9e8f', con: '#834798', lic: '#b7791f', rent: '#6b93ea', oth: '#a4aac0' };
    var items = P.costIds.map(function (id) {
      return { id: id, v: L[id].act, c: COLORS[id] || '#8b93ad', n: L[id].name };
    }).filter(function (x) { return x.v != null && x.v > 0; });
    if (rev - cor > 0) items.push({ id: 'gp', v: rev - cor, c: '#047857', n: L.gp.name });
    if (!items.length) return '';
    var per = function (v) { return Math.round(v / rev * 100); };
    return '<div class="ry">' + items.map(function (x) {
      return '<button type="button" style="width:' + (x.v / base * 100).toFixed(2) + '%;background:' + E(x.c) + '"'
        + CC.goAttr({ k: 'line', id: x.id }) + ' data-tip="'
        + E(x.n + ' · ' + CC.mp(x.v) + ' · ' + per(x.v) + ' من كل مئة ريال إيراد') + '">'
        + (x.v / base > 0.07 ? CC.num(per(x.v)) : '') + '</button>';
    }).join('') + '</div><div class="ry-l">' + items.map(function (x) {
      return '<span style="--c:' + E(x.c) + '">' + E(x.n) + ' <b>' + CC.m(x.v) + '</b></span>';
    }).join('') + '</div>';
  }
  function moneyCard() {
    var P = calc.pl(), L = P.L;
    // عدستان في بطاقةٍ واحدة: الإيراد على ما اختير، والتكلفة والهامش على المغلق وحده — فسطرُ
    // الوصف يقول أيَّ فترةٍ يقرأ القارئ في كل رقم، ولا يُصمت عن الفرق.
    var sub = P.comp.length
      ? periodPhrase(P.comp) + (P.scope === 'sector' ? '، وفق قائمة الدخل في المالية' : '، الإيراد والتكلفة المباشرة فقط')
      : (P.revM.length ? 'الإيراد ' + periodPhrase(P.revM) + '، ولم يُسجَّل شهرٌ مغلق' : 'لم يُسجَّل شهرٌ مغلق');
    var h = cardHead('layers', 'المال', null, sub, { k: 'pl' });
    if (!P.hasCost) {
      h += '<p class="lead-s">الإيراد ' + (L.rev && L.rev.act != null ? '<b>' + CC.m(L.rev.act) + '</b>' : NONE())
        + '. بنود التكلفة والهامش لا تظهر لك.</p>';
    } else if (!P.comp.length) {
      h += '<p class="lead-s">الإيراد ' + (L.rev && L.rev.act != null ? '<b>' + CC.m(L.rev.act) + '</b>' : NONE())
        + '. والتكلفة تنتظر إقفال المالية' + (CLOSED ? '' : ' — لم يُسجَّل شهرٌ مغلق بعد') + '.</p>';
    } else if (L.rev && L.rev.actComp && L.cor && L.cor.act != null) {
      var c = Math.round(L.cor.act / L.rev.actComp * 100);
      h += '<p class="lead-s">' + (c <= 100
        ? 'من كل مئة ريال إيراد ذهب <b>' + CC.num(c) + '</b> إلى التكاليف، وبقي <b>' + CC.num(100 - c) + '</b> ربحاً.'
        : 'صُرف <b>' + CC.num(c) + '</b> ريالاً مقابل كل مئة ريال إيراد.') + '</p>' + riyalBar(P);
    }
    var tile = function (id, label, val, subTxt) {
      return '<button type="button"' + CC.goAttr({ k: 'line', id: id }) + '><span>' + E(label) + '</span><b>'
        + val + '</b><small>' + subTxt + '</small></button>';
    };
    h += '<div class="p4">'
      + tile('rev', L.rev ? L.rev.name : 'الإيراد', L.rev && L.rev.act != null ? CC.m(L.rev.act) : NONE(),
        (L.rev && L.rev.plan != null) ? 'الخطة ' + CC.mp(L.rev.plan) + ' ' + CC.fig.varChip(calc.vpct(L.rev), 'revenue') : '')
      + tile('cor', L.cor ? L.cor.name : 'تكلفة الإيراد', (L.cor && L.cor.act != null) ? CC.m(L.cor.act) : NONE(),
        (L.cor && L.cor.plan != null) ? 'الخطة ' + CC.mp(L.cor.plan) + ' ' + CC.fig.varChip(calc.vpct(L.cor), 'cost') : 'بلا خطة تكاليف هنا')
      + tile('gp', L.gp ? L.gp.name : 'مجمل الربح', (L.gp && L.gp.act != null) ? CC.m(L.gp.act) : NONE(),
        (L.gp && L.gp.plan != null) ? 'الخطة ' + CC.mp(L.gp.plan) : '')
      + tile('gp', 'الهامش', P.margin.act != null ? CC.pct(P.margin.act, 1) : NONE(),
        P.margin.plan != null ? 'الخطة ' + CC.pctp(P.margin.plan, 1) + ' '
          + CC.fig.ptsChip(P.margin.act != null ? P.margin.act - P.margin.plan : null) : '')
      + '</div>';
    h += '<div class="c-acts"><button type="button" class="btn"' + CC.goAttr({ k: 'pl' }) + '>'
      + CC.icon('table') + 'قائمة الدخل كاملة</button>'
      + '<a class="btn" href="' + E(CC.url.xlsxPl()) + '">' + CC.icon('download') + E(G.downloadExcel) + '</a>'
      + '<a class="btn" href="' + E(CC.url.printPl()) + '">' + CC.icon('printer') + 'نسخة الطباعة</a></div>';
    return h;
  }

  // ── بطاقة الفريق ─────────────────────────────────────────────────────────
  function teamCard() {
    var t = calc.staffing();
    var h = cardHead('users', 'الفريق', t ? t.head : null,
      t ? 'الإشغال ' + CC.pctp(t.occ) + '، و' + (t.idle ? cnt(t.idle, F.emp) + ' بلا تسكين' : 'الكلّ مسكَّن')
        : 'لا تظهر لك أرقام الفريق', t ? { k: 'team' } : null);
    if (!t) return h;
    h += '<div class="tm">' + CC.fig.ring(t.occ, { size: 64, sw: 7, label: 'الإشغال ' + CC.pctp(t.occ) })
      + '<div><b>المسكَّن ' + CC.num(t.alloc) + ' من ' + CC.num(t.head) + ' مكافئ تفرّغ</b>'
      + '<p>' + (t.free != null && t.free > 0 ? 'سعةٌ غير مستغلّة تبلغ ' + CC.num(t.free) + ' مكافئ تفرّغ.'
        : 'لا سعة غير مستغلّة الآن.') + '</p></div></div>';
    if (t.cap && t.allocM) {
      h += CC.fig.lineR({
        w: 520, h: 130, series: [
          { values: t.cap, color: '#8b93ad', dash: true, sw: 1.5 },
          { values: t.allocM, color: 'var(--brand)', dots: true, tips: function (i, v) {
            return G.MONTHS_AR[i] + ' · ' + CC.fmt.plain.int(v) + ' مكافئ تفرّغ مسكَّن';
          } },
        ], label: 'الطاقة مقابل التسكين خلال السنة',
      });
    }
    return h;
  }

  // ── التذييل: من أين تأتي الأرقام؟ ────────────────────────────────────────
  function footHTML() {
    var up = META.finance_upload || {};
    var src = 'قائمة الدخل من <b>المالية</b>'
      + (CLOSED ? '، مغلقة حتى <b>' + E(G.MONTHS_AR[CLOSED - 1]) + '</b>' : '، ولم يُسجَّل شهرٌ مغلق بعد')
      + '. الإيراد حتى اليوم والفرص والفريق والعقود من <b>سند</b>'
      + (up.at ? '، وآخر رفعٍ للمالية ' + E(String(up.at).slice(0, 16).replace('T', ' ')) : '') + '.';
    var notes = [];
    if (NOTES.no_monthly_plan) notes.push('مستهدف السنة غير موزَّع على الأشهر بعد.');
    if (NOTES.no_project_plan) notes.push('لا خطة إيرادٍ على مستوى المشروع.');
    if (NOTES.costs_hidden) notes.push('بنود التكلفة والهامش لا تظهر لك.');
    if (NOTES.revenue_hidden) notes.push('أرقام الإيراد لا تظهر لك.');
    if (NOTES.plan_hidden) notes.push('أرقام الخطة لا تظهر لك.');
    return CC.icon('database') + '<span>' + src + '</span>'
      + '<button type="button" class="linkbtn"' + CC.goAttr({ k: 'data' }) + '>من أين تأتي الأرقام؟</button>'
      + '<button type="button" class="linkbtn"' + CC.goAttr({ k: 'changes' }) + '>ما الذي تغيّر؟</button>'
      + '<a class="btn" href="' + E(CC.url.xlsxAll()) + '">' + CC.icon('download') + E(G.downloadExcel) + '</a>'
      + (notes.length ? '<span class="note">' + E(notes.join(' ')) + '</span>' : '');
  }

  // ══════════════════════════ شريط الفلترة ══════════════════════════
  var FX = { q: '', idx: 0, list: [] };
  var nAr = function (s) {
    return String(s == null ? '' : s)
      .replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/(^|\s)(و?)ال/g, '$1$2').replace(/\s+/g, ' ').trim().toLowerCase();
  };

  function quickViews() {
    return [
      { t: 'الصورة الكاملة', hint: 'كل العملاء والمشاريع، من بداية السنة',
        act: function () { S.months = new Set(presetMonths('ytd')); clearScope(); } },
      { t: 'حتى آخر شهر مغلق', hint: CLOSED ? G.MONTHS_AR[CLOSED - 1] : G.notEnteredYet,
        act: function () { S.months = new Set(presetMonths('closed')); } },
      { t: 'السنة كاملة', hint: monthsLabel(new Set(ALL)), act: function () { S.months = new Set(ALL); } },
    ];
  }
  function catalogue() {
    var L = [];
    var add = function (g, ic, t, hint, kw, act, on, open) {
      L.push({ g: g, ic: ic, t: t, hint: hint, key: nAr(t + ' ' + (kw || '')), act: act, on: on, open: open });
    };
    presets().forEach(function (p) {
      add('الفترة', 'calendar', p.t, monthsLabel(new Set(p.m)), 'فتره',
        function () { S.months = new Set(p.m); }, sameSet(S.months, p.m));
    });
    [1, 2, 3, 4].forEach(function (q) {
      var m = presetMonths('q' + q);
      add('الفترة', 'calendar', G.QUARTERS_AR[q - 1], monthsLabel(new Set(m)), 'ر' + q + ' ربع ' + q,
        function () { S.months = new Set(m); }, sameSet(S.months, m));
    });
    G.MONTHS_AR.forEach(function (m, i) {
      add('الفترة', 'calendar', m + ' ' + YEAR, monthTitle(i + 1), 'شهر ' + (i + 1),
        function () { S.months = new Set([i + 1]); }, sameSet(S.months, [i + 1]));
    });
    (D.depts || []).forEach(function (d) {
      add('الإدارات', 'layers', d.name, cnt((D.projects || []).filter(function (p) {
        return p.dept_id === d.id;
      }).length, F.prj), 'اداره', function () { S.depts.add(d.id); }, S.depts.has(d.id));
    });
    (D.clients || []).forEach(function (c) {
      add('العملاء', 'building', c.name, c.prospect ? 'عميل جديد في خط الفرص' : cnt((D.projects || []).filter(function (p) {
        return p.client_id === c.id;
      }).length, F.prj), 'عميل', function () { S.clients.add(c.id); }, S.clients.has(c.id));
    });
    (D.projects || []).forEach(function (p) {
      var cl = D.cliById[p.client_id];
      add('المشاريع', 'table', p.name, ((cl && cl.name) || '') + '، ' + ragName(p.rag), 'مشروع ' + ((cl && cl.name) || ''),
        function () { S.projects.add(p.id); }, S.projects.has(p.id));
    });
    (D.opps || []).forEach(function (o) {
      var cl = D.cliById[o.client_id], sg = D.stageByKey[o.stage_key];
      add('افتح فرصة', 'flag', o.name, ((cl && cl.name) || '') + '، ' + ((sg && sg.name) || ''),
        'فرصه ' + ((cl && cl.name) || ''), function () { CC.go({ k: 'opp', id: o.id }); }, false, true);
    });
    return L;
  }
  function suggest(q) {
    var n = nAr(q);
    if (!n) {
      return quickViews().map(function (v) {
        return { g: 'عروض سريعة', ic: 'trend', t: v.t, hint: v.hint, act: v.act };
      });
    }
    var words = n.split(' ');
    var hits = catalogue().filter(function (x) {
      return words.every(function (w) { return x.key.indexOf(w) >= 0; });
    });
    var per = {};
    return hits.filter(function (x) {
      per[x.g] = (per[x.g] || 0) + 1;
      return per[x.g] <= (x.g === 'الفترة' ? 4 : 5);
    }).slice(0, 14);
  }
  function renderSug() {
    var box = $('#ccSug'), inp = $('#ccQ');
    if (!box || !inp) return;
    FX.list = suggest(FX.q);
    FX.idx = Math.min(FX.idx, Math.max(0, FX.list.length - 1));
    if (!FX.list.length) {
      box.innerHTML = '<div class="fs-empty">لا نتائج لـ«' + E(FX.q)
        + '». جرّب اسم عميلٍ أو مشروع، أو اسم شهرٍ أو ربع.</div>';
    } else {
      var g = null, h = '';
      FX.list.forEach(function (x, i) {
        if (x.g !== g) { g = x.g; h += '<div class="fs-g">' + E(g) + '</div>'; }
        h += '<button type="button" class="fs-i' + (i === FX.idx ? ' act' : '') + (x.on ? ' on' : '')
          + '" role="option" id="ccs' + i + '" aria-selected="' + (i === FX.idx) + '" data-si="' + i + '">'
          + CC.icon(x.ic) + '<span><b>' + E(x.t) + '</b><small>' + E(x.hint) + '</small></span>'
          + (x.on ? CC.icon('check') : '') + '</button>';
      });
      box.innerHTML = h;
    }
    box.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
    inp.setAttribute('aria-activedescendant', FX.list.length ? 'ccs' + FX.idx : '');
    var a = box.querySelector('.act');
    if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' });
  }
  function closeSug() {
    var box = $('#ccSug'), inp = $('#ccQ');
    if (box) box.hidden = true;
    if (inp) { inp.setAttribute('aria-expanded', 'false'); inp.setAttribute('aria-activedescendant', ''); }
  }
  function pickSug(i) {
    var x = FX.list[i];
    if (!x) return;
    FX.q = '';
    var inp = $('#ccQ');
    if (inp) inp.value = '';
    closeSug();
    x.act();
    if (!x.open) { calc.prune(); changed(); CC.toast('المعروض الآن: ' + scopeName()); }
  }

  function clearScope() { S.depts.clear(); S.clients.clear(); S.projects.clear(); }
  function resetFilters() {
    S.months = new Set(presetMonths('ytd'));
    clearScope();
    ANCHOR = null;
  }

  // المرشّحات متعددة الاختيار: زرٌّ يفتح حواراً صغيراً فيه بحثٌ وقائمة
  var DIMS = {
    depts: { t: 'الإدارات', all: 'كل الإدارات', search: 'ابحث في الإدارات', forms: F.dept,
      set: function () { return S.depts; },
      items: function () {
        return (D.depts || []).map(function (d) {
          return { id: d.id, name: d.name, hint: cnt((D.projects || []).filter(function (p) {
            return p.dept_id === d.id;
          }).length, F.prj) };
        });
      } },
    clients: { t: 'العملاء', all: 'كل العملاء', search: 'ابحث في العملاء', forms: F.cli,
      set: function () { return S.clients; },
      items: function () {
        return (D.clients || []).filter(function (c) { return !c.prospect; }).map(function (c) {
          return { id: c.id, name: c.name, hint: cnt((D.projects || []).filter(function (p) {
            return p.client_id === c.id;
          }).length, F.prj) };
        });
      } },
    projects: { t: 'المشاريع', all: 'كل المشاريع', search: 'ابحث في المشاريع', forms: F.prj,
      set: function () { return S.projects; },
      items: function () {
        return calc.projectsInScope().map(function (p) {
          var cl = D.cliById[p.client_id];
          return { id: p.id, name: p.name, hint: (cl && cl.name) || '', dot: ragDot(p.rag) };
        });
      } },
  };
  var POPS = {};
  function mkPop(k) {
    var el = root.document.createElement('div');
    el.className = 'pop sw-pop cc-pop';          // cc-pop يحمل رموز التنسيق خارج جسم الصفحة
    el.hidden = true;
    el.dataset.k = k;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', DIMS[k].t);
    root.document.body.appendChild(el);
    POPS[k] = el;
    return el;
  }
  function placePop(pop, btn) {
    var r = btn.getBoundingClientRect();
    pop.style.top = (r.bottom + root.scrollY + 8) + 'px';
    pop.style.right = Math.max(8, root.document.documentElement.clientWidth - r.right - 8) + 'px';
    pop.style.left = 'auto';
  }
  function dimList(k) {
    var d = DIMS[k], set = d.set();
    var qEl = POPS[k].querySelector('.pq');
    var q = nAr(qEl ? qEl.value : '');
    var items = d.items().filter(function (x) { return !q || nAr(x.name + ' ' + (x.hint || '')).indexOf(q) >= 0; });
    return '<label class="sp-opt"><input type="checkbox" data-all' + (set.size ? '' : ' checked')
      + '><span>' + E(d.all) + '</span></label>'
      + items.map(function (x) {
        return '<label class="sp-opt"><input type="checkbox" value="' + E(x.id) + '"'
          + (set.has(x.id) ? ' checked' : '') + '>'
          + (x.dot ? '<i class="od" style="background:' + E(x.dot) + '"></i>' : '')
          + '<span>' + E(x.name) + '</span><em>' + E(x.hint || '') + '</em></label>';
      }).join('')
      + (items.length ? '' : '<div class="fs-empty">لا نتائج</div>');
  }
  function dimPop(k) {
    var d = DIMS[k];
    POPS[k].innerHTML = '<h5>' + E(d.t) + '</h5>'
      + '<label class="pop-q">' + CC.icon('search') + '<input class="pq" type="text" placeholder="'
      + E(d.search) + '" aria-label="' + E(d.search) + '" autocomplete="off"></label>'
      + '<div class="pl">' + dimList(k) + '</div>'
      + '<div class="sp-foot"><span>يمكن اختيار أكثر من واحد</span>'
      + '<button type="button" class="btn primary" data-close>تم</button></div>';
  }
  var POP = { cur: null };
  function openPop(k, btn) {
    closePop();
    dimPop(k);
    placePop(POPS[k], btn);
    POPS[k].hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    POP.cur = { k: k, pop: POPS[k], btn: btn };
    var f = POPS[k].querySelector('.pq');
    if (f) setTimeout(function () { f.focus(); }, 0);
  }
  function closePop(restore) {
    if (!POP.cur) return;
    var c = POP.cur;
    POP.cur = null;
    c.pop.hidden = true;
    if (c.btn) {
      c.btn.setAttribute('aria-expanded', 'false');
      if (restore) c.btn.focus();
    }
  }
  CC.popOpen = function () { return !!POP.cur; };

  function dimLabel(k) {
    var d = DIMS[k], set = d.set();
    if (!set.size) return d.t;
    if (set.size === 1) {
      var it = d.items().filter(function (x) { return set.has(x.id); })[0];
      return d.t + ': ' + (it ? it.name : '');
    }
    return d.t + ': ' + set.size;
  }
  function chipsList() {
    var out = [];
    if (!sameSet(S.months, presetMonths('ytd'))) {
      out.push({ k: 'period', g: 'الفترة', t: monthsLabel(S.months) + ' ' + YEAR });
    }
    S.depts.forEach(function (id) {
      out.push({ k: 'depts', id: id, g: 'الإدارة', t: (D.deptById[id] || {}).name || '' });
    });
    S.clients.forEach(function (id) {
      out.push({ k: 'clients', id: id, g: 'العميل', t: (D.cliById[id] || {}).name || '' });
    });
    S.projects.forEach(function (id) {
      out.push({ k: 'projects', id: id, g: 'المشروع', t: (D.prjById[id] || {}).name || '' });
    });
    return out;
  }
  function rmChip(k, id) {
    if (k === 'period') S.months = new Set(presetMonths('ytd'));
    else if (S[k]) { S[k].delete(id); calc.prune(); }
  }

  function fbarSkeleton() {
    var el = $('#fbar');
    if (!el) return;
    el.innerHTML = '<div class="fb-r1"><div class="fs-wrap"><label class="fsearch">' + CC.icon('search')
      + '<input id="ccQ" type="text" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="ccSug"'
      + ' aria-autocomplete="list" aria-label="بحث في العملاء والمشاريع والفترات"'
      + ' placeholder="ابحث: اسم عميل، مشروع، شهر، ربع"><kbd>/</kbd></label>'
      + '<div class="fsug" id="ccSug" role="listbox" aria-label="نتائج البحث" hidden></div></div>'
      + '<span class="fb-yr">سنة ' + CC.yr(YEAR) + '</span>'
      + '<div class="seg fb-pre" id="ccPre" role="group" aria-label="فترات جاهزة"></div>'
      + '<div class="fb-q" id="ccQtr" role="group" aria-label="الأرباع"></div>'
      + '<div class="fb-m" id="ccMonths" role="group" aria-label="الأشهر">'
      + ALL.map(function (m) {
        return '<button type="button" data-m="' + m + '" tabindex="-1" aria-pressed="false" class="st-'
          + (m <= CLOSED ? 'closed' : m === TODAY.m ? 'open' : 'future') + '" title="' + E(monthTitle(m))
          + '">' + E(G.MONTHS_AR[m - 1]) + '</button>';
      }).join('') + '</div></div>'
      + '<div class="fb-r2"><div class="fb-dims" id="ccDims"></div><div class="fb-chips" id="ccChips"></div>'
      + '<span class="fb-meta" id="ccMeta"></span></div>'
      + '<p class="sr" id="ccLive" aria-live="polite"></p>';
  }
  function paintMonths() {
    var box = $('#ccMonths');
    if (!box) return;
    var btns = box.querySelectorAll('button[data-m]');
    var first = null;
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i], m = +b.dataset.m, on = S.months.has(m);
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', String(on));
      if (on && first == null) first = i;
      b.tabIndex = -1;
    }
    var focusIdx = first == null ? 0 : first;
    if (btns[focusIdx]) btns[focusIdx].tabIndex = 0;
    var pk = presets().filter(function (p) { return sameSet(S.months, p.m); })[0];
    setHTML($('#ccPre'), presets().map(function (p) {
      return '<button type="button" data-pre="' + p.k + '" class="' + (pk && pk.k === p.k ? 'on' : '')
        + '" aria-pressed="' + !!(pk && pk.k === p.k) + '">' + E(p.t) + '</button>';
    }).join(''));
    setHTML($('#ccQtr'), [1, 2, 3, 4].map(function (q) {
      var ms = presetMonths('q' + q);
      var n = ms.filter(function (m) { return S.months.has(m); }).length;
      return '<button type="button" data-q="' + q + '" class="' + (n === 3 ? 'full' : n ? 'part' : '')
        + '" title="' + E(G.QUARTERS_AR[q - 1]) + '" aria-label="' + E(G.QUARTERS_AR[q - 1])
        + '" aria-pressed="' + (n === 3) + '">ر' + q + '</button>';
    }).join(''));
    var live = $('#ccLive');
    if (live) live.textContent = 'الفترة المختارة: ' + monthsLabel(S.months);
  }
  function renderFilter() {
    paintMonths();
    setHTML($('#ccDims'), Object.keys(DIMS).map(function (k) {
      var on = DIMS[k].set().size;
      return '<button type="button" class="dimb' + (on ? ' on' : '') + '" data-dim="' + k
        + '" aria-haspopup="dialog" aria-expanded="false">' + E(dimLabel(k)) + CC.icon('chev') + '</button>';
    }).join(''));
    var ch = chipsList();
    setHTML($('#ccChips'), ch.map(function (c) {
      return '<span class="chipx"><em>' + E(c.g) + '</em>' + E(c.t) + '<button type="button" data-rm="'
        + E(c.k) + '"' + (c.id ? ' data-id="' + E(c.id) + '"' : '') + ' aria-label="إزالة ' + E(c.t) + '">'
        + CC.icon('x') + '</button></span>';
    }).join('') + (ch.length ? '<button type="button" class="fb-clear" id="ccClear">' + CC.icon('reset')
      + 'مسح الكل</button>' : ''));
    var n = calc.projects().length;
    var o = calc.outlook();
    setHTML($('#ccMeta'), '<span class="fb-sum">'
      + (n ? 'المعروض: ' + E(cnt(n, F.prj)) + '، ' + E(periodPhrase(calc.months())) + ' ' + CC.yr(YEAR)
        : 'لا مشاريع تطابق هذه الاختيارات، ' + E(periodPhrase(calc.months())))
      + '</span>'
      + (o.elapsed != null ? '<span class="fb-el"><i></i>انقضى ' + CC.pct(o.elapsed) + ' من السنة</span>' : '')
      + '<button type="button" class="trust"' + CC.goAttr({ k: 'data' }) + '><i></i><span>'
      + (CLOSED ? 'المالية مغلقة حتى <b>' + E(G.MONTHS_AR[CLOSED - 1]) + '</b>' : 'لم يُسجَّل شهرٌ مغلق')
      + (META.completeness_pct != null ? '، واكتمال البيانات <b>' + CC.pct(META.completeness_pct / 100) + '</b>' : '')
      + '</span></button>');
  }

  // فصول الصفحة معلَنةٌ باسمها: الرسم يركّبها، والاختبار يستدعيها بلا صفحة
  CC.sections = {
    hero: heroHTML, band: bandHTML, projects: projectsCard, opps: oppsCard,
    clients: clientsCard, money: moneyCard, team: teamCard, foot: footHTML,
  };

  // ── الرسم الكامل ─────────────────────────────────────────────────────────
  CC.paint = function () {
    setHTML(pick('#ccHero', '#eHero'), heroHTML());
    setHTML(pick('#ccBand', '#eBand'), bandHTML());
    var empty = calc.scoped() && !calc.projects().length;
    setHTML($('#cPrj'), empty ? '<p class="lead-s">لا مشاريع لهذه الاختيارات.</p>' : projectsCard(5));
    setHTML($('#cOpp'), oppsCard(4));
    setHTML($('#cCli'), empty ? '<p class="lead-s">لا عملاء لهذه الاختيارات.</p>' : clientsCard(6));
    setHTML($('#cMoney'), moneyCard());
    setHTML($('#cTeam'), teamCard());
    setHTML($('#cFoot'), footHTML());
  };
  function changed() {
    renderFilter();
    CC.paint();
    if (CC.drawer && CC.drawer.isOpen && CC.drawer.isOpen()) CC.drawer.repaint();
    CC.url.write();
  }
  CC.changed = changed;

  // ══════════════════════════ الربط ══════════════════════════
  function bindMonthPointer() {
    var box = $('#ccMonths');
    if (!box) return;
    var drag = null;
    box.addEventListener('pointerdown', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-m]') : null;
      if (!b || e.button > 0) return;
      e.preventDefault();
      var m = +b.dataset.m;
      if (e.shiftKey && ANCHOR) {
        S.months = CC.keys.extend(S.months, ANCHOR, m);
        changed();
        return;
      }
      var op = S.months.has(m) ? 'remove' : 'add';
      if (S.months.size === 12) { S.months = new Set([m]); op = 'add'; }
      else S.months = CC.keys.toggle(S.months, m);
      ANCHOR = m;
      drag = { start: m, op: op, base: new Set(S.months), last: m };
      paintMonths();
    });
    root.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var t = root.document.elementFromPoint(e.clientX, e.clientY);
      var b = t && t.closest ? t.closest('button[data-m]') : null;
      if (!b || !box.contains(b)) return;
      var m = +b.dataset.m;
      if (m === drag.last) return;
      drag.last = m;
      var s = new Set(drag.base);
      for (var i = Math.min(drag.start, m); i <= Math.max(drag.start, m); i++) {
        if (drag.op === 'add') s.add(i); else s.delete(i);
      }
      S.months = s;
      ANCHOR = m;
      paintMonths();
    });
    var end = function () {
      if (!drag) return;
      drag = null;
      if (!S.months.size) S.months = new Set(presetMonths('ytd'));
      changed();
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);

    // لوحة المفاتيح: تنقّلٌ بالأسهم، ومسافةٌ تبدّل، وShift يمدّ المدى، وبداية/نهاية للطرفين
    box.addEventListener('keydown', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-m]') : null;
      if (!b) return;
      var btns = [].slice.call(box.querySelectorAll('button[data-m]'));
      var idx = btns.indexOf(b);
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        var m = +b.dataset.m;
        if (S.months.size === 12) S.months = new Set([m]);
        else S.months = CC.keys.toggle(S.months, m);
        if (!S.months.size) S.months = new Set([m]);
        ANCHOR = m;
        changed();
        b.tabIndex = 0;
        b.focus();
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(e.key) < 0) return;
      e.preventDefault();
      var next = CC.keys.move(idx, e.key, btns.length);
      if (e.shiftKey) {
        if (ANCHOR == null) ANCHOR = idx + 1;
        S.months = CC.keys.extend(S.months, ANCHOR, next + 1);
        changed();
      } else {
        ANCHOR = next + 1;
      }
      var target = box.querySelectorAll('button[data-m]')[next];
      if (target) { target.tabIndex = 0; target.focus(); }
    });
  }

  function bindSearch() {
    var inp = $('#ccQ'), box = $('#ccSug');
    if (!inp || !box) return;
    inp.addEventListener('pointerdown', function () { FX.idx = 0; setTimeout(renderSug, 0); });
    inp.addEventListener('input', function () { FX.q = inp.value; FX.idx = 0; renderSug(); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (box.hidden) { FX.idx = 0; renderSug(); return; }
        if (!FX.list.length) return;
        FX.idx = (FX.idx + (e.key === 'ArrowDown' ? 1 : -1) + FX.list.length) % FX.list.length;
        renderSug();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pickSug(FX.idx);
      } else if (e.key === 'Escape') {
        if (FX.q) { FX.q = ''; inp.value = ''; renderSug(); } else { closeSug(); inp.blur(); }
      }
    });
    box.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-si]') : null;
      if (b) pickSug(+b.dataset.si);
    });
    inp.addEventListener('blur', function () {
      setTimeout(function () { if (root.document.activeElement !== inp) closeSug(); }, 120);
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((root.document.activeElement || {}).tagName || '')) {
        e.preventDefault();
        inp.focus();
        FX.idx = 0;
        renderSug();
      }
    });
  }

  function bindPops() {
    Object.keys(DIMS).forEach(mkPop);
    Object.keys(POPS).forEach(function (k) {
      var pop = POPS[k];
      pop.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('[data-close]')) closePop(true);
      });
      pop.addEventListener('input', function (e) {
        if (e.target.classList && e.target.classList.contains('pq')) {
          pop.querySelector('.pl').innerHTML = dimList(k);
        }
      });
      pop.addEventListener('change', function (e) {
        var set = DIMS[k].set(), inp = e.target;
        if (inp.hasAttribute('data-all')) set.clear();
        else if (inp.checked) set.add(inp.value);
        else set.delete(inp.value);
        calc.prune();
        pop.querySelector('.pl').innerHTML = dimList(k);
        var again = pop.querySelector(inp.hasAttribute('data-all') ? 'input[data-all]'
          : 'input[value="' + inp.value + '"]');
        if (again) again.focus();
        changed();
        var btn = root.document.querySelector('[data-dim="' + k + '"]');
        if (btn && POP.cur) { POP.cur.btn = btn; btn.setAttribute('aria-expanded', 'true'); placePop(pop, btn); }
      });
    });
    root.document.addEventListener('pointerdown', function (e) {
      var c = POP.cur;
      if (!c) return;
      if (c.pop.contains(e.target) || (c.btn && c.btn.contains(e.target))) return;
      closePop();
    });
    root.document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && POP.cur) { e.stopPropagation(); closePop(true); }
    }, true);
    root.addEventListener('scroll', function () {
      if (POP.cur) placePop(POP.cur.pop, POP.cur.btn);
    }, { passive: true });
  }

  function bindPage() {
    root.document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var d = t.closest('[data-dim]');
      if (d) {
        if (POP.cur && POP.cur.btn === d) closePop(true); else openPop(d.dataset.dim, d);
        return;
      }
      var pre = t.closest('[data-pre]');
      if (pre) { S.months = new Set(presetMonths(pre.dataset.pre)); ANCHOR = null; changed(); return; }
      var q = t.closest('[data-q]');
      if (q) {
        var ms = presetMonths('q' + q.dataset.q);
        var full = ms.every(function (m) { return S.months.has(m); });
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          var s = new Set(S.months);
          ms.forEach(function (m) { if (full) s.delete(m); else s.add(m); });
          S.months = s.size ? s : new Set(ALL);
        } else {
          S.months = new Set(ms);
        }
        ANCHOR = null;
        changed();
        return;
      }
      var rm = t.closest('[data-rm]');
      if (rm) { rmChip(rm.dataset.rm, rm.dataset.id); changed(); return; }
      if (t.closest('#ccClear')) { resetFilters(); changed(); CC.toast('عادت الصفحة إلى الصورة الكاملة'); return; }
      var go = t.closest('[data-go]');
      if (go) {
        e.preventDefault();
        var spec = null;
        try { spec = JSON.parse(go.dataset.go); } catch (err) { spec = null; }
        if (spec) CC.go(spec, go);
      }
    });
    root.document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var t = e.target;
      if (!t || !t.matches || !t.matches('[data-go]') || t.tagName === 'BUTTON' || t.tagName === 'A') return;
      e.preventDefault();
      var spec = null;
      try { spec = JSON.parse(t.dataset.go); } catch (err) { spec = null; }
      if (spec) CC.go(spec, t);
    });
  }

  // ══════════════════════════ الإقلاع ══════════════════════════
  function readJson(id) {
    var el = root.document ? root.document.getElementById(id) : null;
    if (!el) return null;
    try { return JSON.parse(el.textContent || 'null'); } catch (e) { return null; }
  }

  // تحويل المال من الهللات إلى الريال مرة واحدة — وما بعده لا يعرف الهللة أصلاً
  function toSar(v) { return CC.fmt.blank(v) ? null : v / 100; }
  function arr12(v) { return v ? CC.fmt.toSarArr(v) : null; }

  CC.init = function (dataset, view, labels) {
    if (labels) {
      Object.keys(labels).forEach(function (k) { if (labels[k] != null) G[k] = labels[k]; });
    }
    var d = dataset || {};
    META = d.meta || {};
    SECTOR = META.sector || { id: '', name_ar: '' };
    YEAR = Number(META.year) || new Date().getUTCFullYear();
    CLOSED = Number(META.closed_through) || 0;
    TODAY = META.today || { m: 0, d: 0 };
    // سنةُ اليوم من طابع الخادم نفسه — فسنةٌ منقضية لا يُقصّ فيها شيءٌ على شهرٍ جارٍ لا وجود له.
    CUR_YEAR = !TODAY.iso || Number(String(TODAY.iso).slice(0, 4)) === YEAR;
    NOTES = {};
    (d.notes || []).forEach(function (n) { NOTES[n] = true; });

    D = {
      meta: META,
      lines: (d.lines || []).map(function (l) {
        return {
          id: l.id, name: l.name, kind: l.kind, flag: !!l.flag,
          plan: arr12(l.plan), fin: arr12(l.fin), sanad: arr12(l.sanad),
        };
      }),
      projects: (d.projects || []).map(function (p) {
        var act = {};
        Object.keys(p.act || {}).forEach(function (k) {
          var v = p.act[k];
          act[k] = Array.isArray(v) ? arr12(v) : toSar(v);
        });
        return {
          id: p.id, name: p.name, client_id: p.client_id, dept_id: p.dept_id, rag: p.rag,
          contract: toSar(p.contract), remaining: toSar(p.remaining), unbilled: toSar(p.unbilled),
          start: p.start, end_m: p.end_m, act: act,
          margin_pct: p.margin_pct == null ? null : p.margin_pct,
        };
      }),
      clients: (d.clients || []).slice(),
      depts: (d.depts || []).slice(),
      opps: (d.opps || []).map(function (o) {
        return {
          id: o.id, name: o.name, client_id: o.client_id, stage_key: o.stage_key,
          value: toSar(o.value), prob: o.prob, close_m: o.close_m,
          idle_days: o.idle_days, stalled: !!o.stalled,
        };
      }),
      stages: (d.stages || []).slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }),
      staffing: d.staffing || null,
      plan: d.plan ? {
        sector_target: toSar(d.plan.sector_target),
        finance_plan_fy: toSar(d.plan.finance_plan_fy),
        sales_target: toSar(d.plan.sales_target),
        monthly_target: arr12(d.plan.monthly_target),
      } : null,
      outlook: d.outlook ? {
        forecast: toSar(d.outlook.forecast), low: toSar(d.outlook.low), high: toSar(d.outlook.high),
        pace: toSar(d.outlook.pace), coverage: d.outlook.coverage,
      } : null,
      recon: d.recon ? {
        months: (d.recon.months || []).map(function (r) {
          return { m: r.m, fin_cor: toSar(r.fin_cor), sanad_cor: toSar(r.sanad_cor),
            diff: toSar(r.diff), pct: r.pct, match: !!r.match };
        }),
        totals: d.recon.totals ? {
          fin_cor: toSar(d.recon.totals.fin_cor), sanad_cor: toSar(d.recon.totals.sanad_cor),
          diff: toSar(d.recon.totals.diff), pct: d.recon.totals.pct, match: !!d.recon.totals.match,
        } : null,
        // الخدمة تُخرج البند بمفتاحه واسمه (`key`/`ar`) — والشاشة كانت تقرأ اسمين آخرين،
        // فكان جدول «حسب البند» يخرج بأسماءٍ فارغة فوق أرقامٍ صحيحة.
        by_line: (d.recon.by_line || []).map(function (r) {
          return { line: r.key, name: r.ar, comparable: r.comparable, reason: r.reason,
            fin: toSar(r.fin), sanad: toSar(r.sanad), diff: toSar(r.diff) };
        }),
      } : null,
      attention: d.attention || [],
      // الخدمة تُخرج الحركة `{items, counts}`؛ الشاشة لا تقرأ إلا السطور، فتُسوّى هنا إلى
      // قائمةٍ واحدة — وقبولُ القائمة المجرّدة يبقى لحمولةٍ قديمةٍ محفوظة في متصفّح.
      changes: Array.isArray(d.changes) ? d.changes
        : ((d.changes && d.changes.items) || []),
      team: d.team || [],
      notes: d.notes || [],
      revenue: d.revenue || null,
    };
    D.revByProject = {};
    ((d.revenue || {}).by_project_month || []).forEach(function (r) {
      D.revByProject[r.project_id] = arr12(r.m);
    });
    D.lineById = byId(D.lines);
    D.prjById = byId(D.projects.map(function (p) { return { id: p.id, name: p.name }; }));
    D.cliById = {};
    D.clients.forEach(function (c) { D.cliById[c.id] = c; });
    D.deptById = {};
    D.depts.forEach(function (x) { D.deptById[x.id] = x; });
    D.stageByKey = {};
    D.stages.forEach(function (s) { D.stageByKey[s.key] = s; });
    D.oppById = byId(D.opps);
    D.projectById = {};
    D.projects.forEach(function (p) { D.projectById[p.id] = p; });
    CC.D = D;
    CC.G = G;
    CC.meta = META;
    CC.sector = SECTOR;
    CC.year = function () { return YEAR; };
    CC.closedThrough = function () { return CLOSED; };
    CC.today = function () { return TODAY; };
    CC.notes = NOTES;

    // حالة العرض الأولى كما حلّها الخادم
    var v = view || {};
    S.months = new Set((v.months && v.months.length ? v.months : presetMonths('ytd'))
      .filter(function (m) { return m >= 1 && m <= 12; }));
    if (!S.months.size) S.months = new Set(presetMonths('ytd'));
    S.depts = new Set((v.depts || []).filter(function (x) { return D.deptById[x]; }));
    S.clients = new Set((v.clients || []).filter(function (x) { return D.cliById[x]; }));
    S.projects = new Set((v.projects || []).filter(function (x) { return D.projectById[x]; }));
    if (v.unit) S.unit = v.unit;
    calc.prune();

    CC.config({ months: G.MONTHS_AR, closedThrough: CLOSED, currentMonth: TODAY.m || 0 });
    return CC;
  };

  CC.boot = function () {
    var data = readJson('cc-data');
    if (!data) return false;
    CC.init(data, readJson('cc-view') || {}, readJson('cc-labels') || {});
    fbarSkeleton();
    bindSearch();
    bindMonthPointer();
    bindPops();
    bindPage();
    renderFilter();
    CC.paint();
    var v = readJson('cc-view') || {};
    if (v.open && v.open.k && CC.drawer && CC.drawer.open) CC.drawer.open(v.open, null);
    CC.url.write();
    return true;
  };

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', function () { CC.boot(); });
    } else {
      CC.boot();
    }
  }
}());
