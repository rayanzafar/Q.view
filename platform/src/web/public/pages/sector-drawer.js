// مركز القطاع — لوحة التفاصيل الجانبية.
//
// اللوحة قشرةٌ واحدة في المنصة كلها (`#drawer` و`#scrim` من layout.js) — لا تُبنى هنا ثانية.
// ما يُبنى هنا هو محتواها: عنوانٌ وسطورٌ ورسوم، مغلَّفةٌ بعنصرٍ يحمل الصنف `cc-drawer` كي تسري
// عليه رموز sector.css (فهي مقصورة على `.cc-page` و`.cc-pop` و`.cc-drawer`).
//
// قواعد:
//   • لا رقمَ يُحسب هنا. كل رقمٍ يأتي من `CC.calc.*` — فالشاشة واللوحة تقولان الرقم نفسه.
//   • الغياب يبقى غياباً: كل فصلٍ هنا يحتمل أن تكون بياناته محجوبة (لا تكاليف، لا مطابقة، لا
//     خطة، لا توقّع) فيعرض «لم يُسجَّل» ولا يطبع أثراً لقيمةٍ غائبة.
//   • كل نصٍّ يمرّ بـ`CC.esc`، والتلميح نصٌّ صريح بفاصلٍ أوسط.
//   • Escape: app.js يغلق اللوحة أصلاً على مستوى النافذة — فلا نربطه ثانية. نراقب تغيّر حالة
//     القشرة ونُعيد التركيز إلى الزر الذي فتحها، أياً كان سبب الإغلاق.
(function () {
  'use strict';

  var root = (typeof window === 'object' && window) ? window : globalThis;
  var CC = root.CC = root.CC || {};
  var E = function (s) { return CC.esc(s); };
  var doc = root.document || null;

  var D = function () { return CC.D || {}; };
  var G = function () { return CC.G || {}; };
  var calc = function () { return CC.calc; };
  var none = function () { return CC.none(); };
  var m = function (v) { return CC.m(v); };
  var mp = function (v) { return CC.mp(v); };
  var pct = function (v, d) { return CC.pct(v, d); };
  var pctp = function (v, d) { return CC.pctp(v, d); };

  // ── لبنات صغيرة ──────────────────────────────────────────────────────────
  function kv(rows) {
    return '<div class="dr-kpis">' + rows.map(function (r) {
      return '<div><span>' + E(r[0]) + '</span><b>' + (r[1] == null ? none() : r[1]) + '</b>'
        + (r[2] ? '<small>' + r[2] + '</small>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function sec(title, html, sub) {
    return '<section class="dr-sec"><h4>' + E(title) + (sub ? '<small>' + E(sub) + '</small>' : '')
      + '</h4>' + html + '</section>';
  }
  function note(txt, warn) {
    return '<div class="dr-note' + (warn ? ' warn' : '') + '">' + CC.icon(warn ? 'alert' : 'info')
      + '<span>' + txt + '</span></div>';
  }
  function actBtn(label, spec, ic) {
    return '<button type="button" class="btn"' + CC.goAttr(spec) + '>' + CC.icon(ic || 'filter')
      + E(label) + '</button>';
  }
  function linkBtn(label, href, ic) {
    return '<a class="btn" href="' + E(href) + '">' + CC.icon(ic || 'link') + E(label) + '</a>';
  }
  function brkRow(spec, name, w, val, em, color) {
    var body = '<span>' + E(name) + '</span><span class="bar"><i style="width:' + w.toFixed(1) + '%'
      + (color ? ';background:' + E(color) : '') + '"></i></span><b>' + val + '</b><em>' + E(em || '') + '</em>';
    return spec
      ? '<button type="button" class="brk-row go"' + CC.goAttr(spec) + '>' + body + '</button>'
      : '<div class="brk-row">' + body + '</div>';
  }
  function emptyP(txt) { return '<p class="muted-p">' + E(txt) + '</p>'; }

  function cliName(id) { return ((D().cliById || {})[id] || {}).name || ''; }
  function stageOf(key) { return (D().stageByKey || {})[key] || { name: '', color: 'var(--brand)' }; }
  function ragBadge(rag) {
    return '<span class="st ' + CC.rag.cls(rag) + '"><i></i>' + E(CC.rag.name(rag)) + '</span>';
  }

  function prjRows(list, subOf) {
    if (!list.length) return emptyP('لا مشاريع.');
    return '<div class="tbl-x"><table class="rt"><thead><tr><th>المشروع</th><th>الإيراد</th>'
      + '<th>التكلفة المباشرة</th><th>الهامش المباشر</th><th>الحالة</th></tr></thead><tbody>'
      + list.map(function (p) {
        var s = calc().prjStats(p);
        return '<tr class="go"' + CC.goAttr({ k: 'prj', id: p.id }) + ' tabindex="0"><td><b>' + E(p.name)
          + '</b><small>' + E(subOf ? subOf(p) : cliName(p.client_id)) + '</small></td>'
          + '<td>' + (s.rev == null ? none() : m(s.rev)) + '</td>'
          + '<td>' + (s.dc == null ? none() : m(s.dc)) + '</td>'
          + '<td>' + (s.margin == null ? none() : pct(s.margin, 1)) + '</td>'
          + '<td>' + ragBadge(s.rag) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function oppRows(list) {
    if (!list.length) return emptyP('لا فرص.');
    return '<div class="tbl-x"><table class="rt"><thead><tr><th>الفرصة</th><th>المرحلة</th><th>القيمة</th>'
      + '<th>المرجّحة</th><th>الإغلاق</th></tr></thead><tbody>'
      + list.map(function (o) {
        var sg = stageOf(o.stage_key), c = (D().cliById || {})[o.client_id] || {};
        return '<tr class="go"' + CC.goAttr({ k: 'opp', id: o.id }) + ' tabindex="0"><td><b>' + E(o.name)
          + '</b><small>' + E(c.name || '') + (c.prospect ? '، عميل جديد' : '') + '</small></td>'
          + '<td><span class="stg" style="--c:' + E(sg.color) + '">' + E(sg.name) + '</span>'
          + (o.stalled && o.idle_days != null
            ? '<small class="stl">متوقفة منذ ' + E(CC.txt.cnt(o.idle_days, CC.txt.F.day)) + '</small>' : '')
          + '</td><td>' + m(o.value) + '</td><td><b>' + m((o.value || 0) * (o.prob || 0)) + '</b></td>'
          + '<td>' + E(CC.txt.closeTxt(o.close_m)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function plTable(P) {
    var L = P.L;
    var ids = ['rev'].concat(P.hasCost ? ['cor'] : []).concat(P.costIds).concat(P.hasCost ? ['gp'] : []);
    var cls = { rev: 'main', cor: 'sub', gp: 'gp' };
    return '<div class="tbl-x"><table class="rt plb"><thead><tr><th>البند</th><th>خطة السنة</th>'
      + '<th>خطة الفترة</th><th>الفعلي</th><th>الانحراف</th></tr></thead><tbody>'
      + ids.map(function (id) {
        var r = L[id];
        if (!r) return '';
        return '<tr class="go ' + (cls[id] || 'cost') + '"' + CC.goAttr({ k: 'line', id: id })
          + ' tabindex="0"><td class="nm">' + E(r.name)
          + (r.flag ? '<span class="flag-dot" data-tip="بند مظلَّل في ملف المالية"></span>' : '') + '</td>'
          + '<td>' + (r.fy == null ? none() : m(r.fy)) + '</td>'
          + '<td>' + (r.plan == null ? none() : m(r.plan)) + '</td>'
          + '<td><b>' + (r.act == null ? none() : m(r.act)) + '</b></td>'
          + '<td>' + CC.fig.varChip(calc().vpct(r), r.kind === 'cost' || r.kind === 'subtotal' ? 'cost' : 'revenue')
          + '</td></tr>';
      }).join('')
      + (P.hasCost ? '<tr class="mg"><td class="nm">هامش مجمل الربح</td>'
        + '<td>' + (P.margin.fy == null ? none() : pct(P.margin.fy, 1)) + '</td>'
        + '<td>' + (P.margin.plan == null ? none() : pct(P.margin.plan, 1)) + '</td>'
        + '<td><b>' + (P.margin.act == null ? none() : pct(P.margin.act, 1)) + '</b></td>'
        + '<td>' + CC.fig.ptsChip((P.margin.act != null && P.margin.plan != null)
          ? P.margin.act - P.margin.plan : null) + '</td></tr>' : '')
      + '</tbody></table></div>';
  }

  // ── الفصول ───────────────────────────────────────────────────────────────
  var DETAIL = {
    prj: function (id) {
      var p = (D().projectById || {})[id];
      if (!p) return { kind: 'مشروع', title: 'المشروع غير متاح', sub: '', html: emptyP('لم يعد هذا المشروع ضمن ما تقرأه.') };
      var s = calc().prjStats(p), comp = calc().comp();
      var h = kv([
        ['الإيراد في الفترة', s.rev == null ? null : m(s.rev), E(CC.txt.periodPhrase(calc().revM()))],
        ['الهامش المباشر', s.margin == null ? null : pct(s.margin, 1),
          s.dc == null ? E(G().notEnteredYet || 'لم يُسجَّل') : 'التكلفة المباشرة ' + mp(s.dc)],
        ['المنجز من العقد', s.done == null ? null : pct(s.done),
          p.contract == null ? '' : 'من عقدٍ قيمته ' + mp(p.contract)],
        ['منجز لم يُفوتر', p.unbilled == null ? null : m(p.unbilled),
          p.remaining == null ? '' : 'المتبقي من العقد ' + mp(p.remaining)],
      ]);
      var rev = calc().projectRev(p.id);
      if (rev) {
        h += sec('الإيراد شهراً بشهر', CC.fig.barsR({
          act: rev, sel: CC.S.months, w: 560, h: 150, fmt: CC.mp, label: 'إيراد المشروع شهراً بشهر',
        }), 'لا خطة إيرادٍ على مستوى المشروع');
      }
      var costs = ['con', 'ctr', 'lic'].map(function (k) {
        var v = p.act && p.act[k];
        var sum = Array.isArray(v) ? sumOf(v, comp) : (typeof v === 'number' ? v : null);
        return [((D().lineById || {})[k] || {}).name || k, sum];
      }).filter(function (x) { return x[1] != null && x[1] > 0; });
      if (costs.length && s.dc) {
        h += sec('التكلفة المباشرة', '<div class="brk">' + costs.map(function (x) {
          return brkRow(null, x[0], x[1] / s.dc * 100, m(x[1]), pctp(x[1] / s.dc));
        }).join('') + '</div>', CC.txt.periodPhrase(comp));
      }
      h += note('الحالة ' + E(CC.rag.name(p.rag)) + ' — ' + E(G().ragOwnerNote) + '.', p.rag === 'RED');
      if (s.margin != null && s.margin < 0) {
        h += note('المشروع خاسر في الفترة: تكلفته المباشرة ' + m(s.dc) + ' مقابل إيراد ' + m(s.rev) + '.', true);
      }
      h += '<div class="dr-acts">' + linkBtn('افتح صفحة المشروع', '/app/project/' + encodeURIComponent(p.id), 'arrowOut')
        + actBtn('اقصر العرض على هذا المشروع', { k: 'filter', f: 'projects', id: p.id })
        + (p.client_id ? actBtn('العميل: ' + cliName(p.client_id), { k: 'cli', id: p.client_id }, 'building') : '')
        + '</div>';
      return {
        kind: ragBadge(p.rag), title: p.name,
        sub: cliName(p.client_id) + (p.end_m ? '، ينتهي في ' + CC.txt.closeTxt(p.end_m) : ''),
        html: h,
      };
    },

    cli: function (id) {
      var c = (D().cliById || {})[id];
      if (!c) return { kind: 'عميل', title: 'العميل غير متاح', sub: '', html: emptyP('لم يعد هذا العميل ضمن ما تقرأه.') };
      var r = calc().clientRel(id);
      var all = calc().clientsInScope().map(function (x) { return calc().clientRel(x.id); });
      var tot = all.reduce(function (t, x) { return t + x.rev; }, 0);
      var h = c.prospect
        ? kv([['الفرص', CC.num(r.pp.count), 'بقيمة ' + mp(r.pp.value)],
          ['المرجّحة', m(r.pp.weighted), ''],
          ['تغلق هذه السنة', r.pp.yearVal ? m(r.pp.yearVal) : null, r.pp.yearVal ? '' : 'لا فرص تغلق هذه السنة'],
          ['متوقفة', CC.num(r.pp.stalled), '']])
        : kv([['الإيراد في الفترة', r.g.rev == null ? null : m(r.g.rev),
          'حصته ' + pctp(tot ? r.rev / tot : 0) + ' من إيراد المعروض'],
          ['المتبقي من العقود', r.g.remaining == null ? null : m(r.g.remaining),
            r.g.contract == null ? '' : 'من ' + mp(r.g.contract)],
          ['منجز لم يُفوتر', r.g.unbilled == null ? null : m(r.g.unbilled), ''],
          ['الفرص المرجّحة', m(r.pipe), E(CC.txt.cnt(r.pp.count, CC.txt.F.opp))]]);
      if (!c.prospect) {
        h += sec('قيمة العلاقة',
          CC.fig.relBar({ rev: r.rev, backlog: r.backlog, pipe: r.pipe }, r.total || 1, { fmt: CC.mp })
          + CC.fig.stkLegend([
            { color: 'var(--brand)', label: 'الإيراد', value: m(r.rev) },
            { color: 'var(--teal)', label: 'المتبقي من العقود', value: m(r.backlog) },
            { color: '#834798', label: 'الفرص المرجّحة', value: m(r.pipe) },
          ]));
      }
      if (r.g.ps.length) h += sec('المشاريع', prjRows(r.g.ps));
      if (r.pp.count) {
        h += sec('الفرص', oppRows(r.pp.list.slice().sort(function (a, b) {
          return (b.value || 0) * (b.prob || 0) - (a.value || 0) * (a.prob || 0);
        })));
      }
      h += '<div class="dr-acts">' + actBtn('اقصر العرض على هذا العميل', { k: 'filter', f: 'clients', id: id }) + '</div>';
      return {
        kind: c.prospect ? 'عميل جديد' : 'عميل', title: c.name,
        sub: c.prospect ? CC.txt.cnt(r.pp.count, CC.txt.F.opp) + ' في خط الفرص'
          : CC.txt.cnt(r.g.ps.length, CC.txt.F.prj) + (r.pp.count ? ' و' + CC.txt.cnt(r.pp.count, CC.txt.F.opp) : ''),
        html: h,
      };
    },

    line: function (id) {
      var P = calc().pl(), r = P.L[id];
      if (!r) {
        return {
          kind: 'بند في قائمة الدخل', title: 'البند غير متاح', sub: CC.txt.scopeName(),
          html: note('هذا البند لا يظهر لك، أو لم يُسجَّل في الفترة المختارة.', true),
        };
      }
      var comp = P.comp, isRev = id === 'rev';
      var h = kv([
        ['الفعلي', r.act == null ? null : m(r.act), E(CC.txt.periodPhrase(comp))],
        ['خطة الفترة', r.plan == null ? null : m(r.plan),
          r.plan == null ? 'لا خطة لهذا النطاق' : CC.fig.varChip(calc().vpct(r), r.kind === 'revenue' ? 'revenue' : 'cost')],
        ['خطة السنة', r.fy == null ? null : m(r.fy), ''],
        id === 'gp'
          ? ['الهامش', P.margin.act == null ? null : pct(P.margin.act, 1),
            P.margin.plan == null ? '' : 'الخطة ' + pctp(P.margin.plan, 1)]
          : isRev
            ? ['المتوسط الشهري', (r.act != null && comp.length) ? m(r.act / comp.length) : null, 'في الأشهر المغلقة']
            : ['من الإيراد', (P.L.rev && P.L.rev.act) ? pct(r.act / P.L.rev.act) : null, 'في الفترة'],
      ]);
      if (r.actM || r.planM) {
        h += sec('شهراً بشهر', CC.fig.barsR({
          act: r.actM, plan: r.planM, sel: CC.S.months, w: 560, h: 150, fmt: CC.mp,
          color: id === 'gp' ? 'var(--green)' : (isRev ? 'var(--brand)' : '#5d6785'),
          label: r.name + ' شهراً بشهر',
        }), r.planM ? 'العمود المتقطّع هو الخطة' : 'لا خطة شهرية لهذا البند');
      }
      if (isRev || ['con', 'ctr', 'lic'].indexOf(id) >= 0) {
        var list = calc().projects();
        var vals = list.map(function (p) {
          var v = isRev ? sumOf(calc().projectRev(p.id), comp)
            : (Array.isArray(p.act && p.act[id]) ? sumOf(p.act[id], comp) : null);
          return [p, v];
        }).filter(function (x) { return x[1] != null && x[1] > 0; })
          .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 6);
        if (vals.length > 1) {
          var mx = Math.max.apply(null, [1].concat(vals.map(function (x) { return x[1]; })));
          h += sec('أكبر المشاريع', '<div class="brk">' + vals.map(function (x) {
            return brkRow({ k: 'prj', id: x[0].id }, x[0].name, x[1] / mx * 100, m(x[1]),
              r.act ? pctp(x[1] / r.act) : '');
          }).join('') + '</div>');
        }
      }
      if ((id === 'rent' || id === 'oth') && P.scope === 'sector') {
        h += note('هذا البند مصروفٌ عام على مستوى القطاع، ولا يوزَّع على المشاريع.');
      }
      if (r.flag) h += note('هذا البند مظلَّل في ملف المالية.', true);
      if (P.scope === 'projects' && !isRev) {
        h += note('على مستوى المشروع والعميل: التكلفة المباشرة وحدها، بلا خطةٍ للتكاليف.');
      }
      return {
        kind: 'بند في قائمة الدخل', title: r.name,
        sub: CC.txt.scopeName() + '، ' + (comp.length ? CC.txt.periodPhrase(comp) : 'لا أشهر مغلقة في الفترة'),
        html: h,
      };
    },

    team: function () {
      var t = calc().staffing();
      if (!t) {
        return { kind: 'الفريق', title: 'الفريق والطاقة', sub: CC.sector.name_ar || '',
          html: note('أرقام الفريق لا تظهر لك.', true) };
      }
      var h = kv([
        ['الفريق', CC.num(t.head), E(CC.txt.cnt(t.head, CC.txt.F.emp))],
        ['الإشغال', t.occ == null ? null : pct(t.occ), 'المسكَّن ' + CC.fmt.plain.int(t.alloc) + ' من ' + CC.fmt.plain.int(t.head)],
        ['بلا تسكين', t.idle == null ? null : CC.num(t.idle), ''],
        ['سعة غير مستغلّة', t.free == null ? null : CC.num(t.free), 'مكافئ تفرّغ'],
      ]);
      if (t.cap && t.allocM) {
        h += sec('الطاقة خلال السنة', CC.fig.lineR({
          w: 560, h: 170, series: [
            { values: t.cap, color: '#8b93ad', dash: true, sw: 1.5 },
            { values: t.allocM, color: 'var(--brand)', dots: true, tips: function (i, v) {
              return (G().MONTHS_AR || [])[i] + ' · ' + CC.fmt.plain.int(v) + ' مكافئ تفرّغ مسكَّن';
            } },
          ], label: 'الطاقة مقابل التسكين',
        }), 'المتقطّع طاقة الفريق، والممتلئ ما سُكِّن فعلاً');
      }
      var rows = D().team || [];
      if (rows.length) {
        h += sec('الأفراد', '<div class="tbl-x"><table class="rt"><thead><tr><th>الاسم</th><th>الدور</th>'
          + '<th>الإشغال هذا الشهر</th><th>مهام مفتوحة</th></tr></thead><tbody>'
          + rows.map(function (p) {
            var openT = p.tasks && p.tasks.open != null ? CC.num(p.tasks.open) : none();
            return '<tr><td><b>' + E(p.name_ar || p.name || '') + '</b></td><td>' + E(p.job_title || '') + '</td>'
              + '<td>' + (p.planNow == null ? none() : pct(p.planNow / 100)) + '</td>'
              + '<td>' + openT + '</td></tr>';
          }).join('') + '</tbody></table></div>', 'الإشغال من خطة التسكين، لا من ساعات العمل');
      } else {
        h += note('تفصيل الأفراد لا يظهر لك، والأرقام أعلاه مجاميع.');
      }
      h += '<div class="dr-acts">' + linkBtn('لوحة التسكين', '/app/allocations', 'calendar') + '</div>';
      return { kind: 'الفريق', title: 'الفريق والطاقة', sub: CC.sector.name_ar || '', html: h };
    },

    pipe: function () {
      var o = calc().outlook(), pp = calc().pipeOf(calc().opps());
      var mxW = Math.max.apply(null, [1].concat(pp.stages.map(function (x) { return x.weighted; })));
      var h = kv([
        ['الفرص', CC.num(pp.count), 'بقيمة ' + mp(pp.value)],
        ['القيمة المرجّحة', m(pp.weighted), ''],
        ['التغطية', o.coverage == null ? null : pct(o.coverage), 'من المتبقي من هدف المبيعات'],
        ['متوقفة', CC.num(pp.stalled), 'بقيمة ' + mp(pp.stalledVal)],
      ]);
      h += sec('حسب المرحلة', '<div class="brk">' + pp.stages.map(function (x) {
        return brkRow({ k: 'opps', id: x.key }, x.name, x.weighted / mxW * 100, m(x.weighted),
          CC.txt.cnt(x.n, CC.txt.F.opp), x.color);
      }).join('') + '</div>', 'القيمة المرجّحة');
      h += sec('أكبر الفرص', oppRows(pp.list.slice().sort(function (a, b) {
        return (b.value || 0) * (b.prob || 0) - (a.value || 0) * (a.prob || 0);
      }).slice(0, 6)));
      if (pp.stalled) {
        h += note('أكبر رافعة: تحريك ' + E(CC.txt.cnt(pp.stalled, CC.txt.F.opp)) + ' متوقفة بقيمة '
          + m(pp.stalledVal) + '.', true);
      }
      h += '<div class="dr-acts">' + actBtn('كل الفرص', { k: 'opps', id: 'all' }, 'flag')
        + actBtn('الفرص المتوقفة', { k: 'opps', id: 'stalled' }, 'clock')
        + linkBtn('صفحة الفرص', '/app/opportunities', 'arrowOut') + '</div>';
      return { kind: 'المستقبل', title: 'المبيعات وخط الفرص', sub: CC.txt.scopeName(), html: h };
    },

    opp: function (id) {
      var o = (D().oppById || {})[id];
      if (!o) return { kind: 'فرصة', title: 'الفرصة غير متاحة', sub: '', html: emptyP('لم تعد هذه الفرصة ضمن ما تقرأه.') };
      var c = (D().cliById || {})[o.client_id] || {}, sg = stageOf(o.stage_key);
      var stages = D().stages || [];
      var idx = stages.map(function (x) { return x.key; }).indexOf(o.stage_key);
      var h = kv([
        ['القيمة', m(o.value), ''],
        ['الاحتمال', o.prob == null ? null : pct(o.prob), 'حسب المرحلة'],
        ['القيمة المرجّحة', m((o.value || 0) * (o.prob || 0)), ''],
        ['الإغلاق المتوقع', E(CC.txt.closeTxt(o.close_m)),
          o.close_m != null && o.close_m <= 12 ? 'هذه السنة' : 'السنة القادمة'],
      ]);
      if (stages.length) {
        h += sec('المرحلة', '<ol class="steps">' + stages.map(function (x, i) {
          return '<li class="' + (i < idx ? 'done' : i === idx ? 'cur' : '') + '"><i></i><span>'
            + E(x.name) + '</span></li>';
        }).join('') + '</ol>');
      }
      if (o.idle_days != null) {
        h += note(o.stalled
          ? 'الفرصة متوقفة: لم تتقدّم منذ ' + E(CC.txt.cnt(o.idle_days, CC.txt.F.day))
            + '. القاعدة: أكثر من ستين يوماً بلا تقدّم.'
          : 'آخر تقدّم قبل ' + E(CC.txt.cnt(o.idle_days, CC.txt.F.day)) + '.', !!o.stalled);
      }
      var ps = (D().projects || []).filter(function (p) { return p.client_id === o.client_id; });
      if (ps.length) h += sec('مشاريع قائمة لدى العميل', prjRows(ps));
      else h += note(E(c.name || 'العميل') + ' بلا مشاريع قائمة في هذا القطاع.');
      h += '<div class="dr-acts">' + linkBtn('افتح الفرصة', '/app/opportunities?opp=' + encodeURIComponent(o.id), 'arrowOut')
        + (o.client_id ? actBtn('العميل: ' + (c.name || ''), { k: 'cli', id: o.client_id }, 'building') : '') + '</div>';
      return {
        kind: '<span class="stg" style="--c:' + E(sg.color) + '">' + E(sg.name) + '</span>'
          + (o.stalled ? ' <span class="st bad"><i></i>متوقفة</span>' : ''),
        title: o.name, sub: (c.name || '') + (c.prospect ? '، عميل جديد' : ''), html: h,
      };
    },

    opps: function (f) {
      f = f || 'all';
      var all = calc().opps();
      var list = all.filter(function (o) {
        return f === 'all' || (f === 'stalled' ? o.stalled
          : f === 'year' ? (o.close_m != null && o.close_m <= 12) : o.stage_key === f);
      }).sort(function (a, b) { return (b.value || 0) * (b.prob || 0) - (a.value || 0) * (a.prob || 0); });
      var pp = calc().pipeOf(list);
      var chips = [['all', 'الكل', all.length],
        ['year', 'تغلق هذه السنة', all.filter(function (o) { return o.close_m != null && o.close_m <= 12; }).length],
        ['stalled', 'متوقفة', all.filter(function (o) { return o.stalled; }).length]]
        .concat((D().stages || []).map(function (s) {
          return [s.key, s.name, all.filter(function (o) { return o.stage_key === s.key; }).length];
        }));
      var h = '<div class="dr-chips">' + chips.map(function (c) {
        return '<button type="button" class="' + (c[0] === f ? 'on' : '') + '"'
          + CC.goAttr({ k: 'opps', id: c[0] }) + '>' + E(c[1]) + ' <em>' + CC.num(c[2]) + '</em></button>';
      }).join('') + '</div>';
      h += kv([['الفرص', CC.num(pp.count), ''], ['القيمة', m(pp.value), ''],
        ['المرجّحة', m(pp.weighted), ''], ['متوقفة', CC.num(pp.stalled), 'بقيمة ' + mp(pp.stalledVal)]]);
      h += oppRows(list);
      var titles = { all: 'كل الفرص', year: 'فرص تغلق هذه السنة', stalled: 'الفرص المتوقفة' };
      return {
        kind: 'الفرص', title: titles[f] || ('فرص في مرحلة ' + stageOf(f).name),
        sub: CC.txt.scopeName() + '، مرتّبة بالقيمة المرجّحة', html: h,
      };
    },

    projects: function (f) {
      f = f || 'all';
      var all = calc().projects();
      var list = all.filter(function (p) { return f === 'all' || p.rag === f; });
      var g = calc().groupOf(list);
      var chips = [['all', 'الكل', all.length]].concat(['RED', 'AMBER', 'GREEN'].map(function (r) {
        return [r, CC.rag.name(r), all.filter(function (p) { return p.rag === r; }).length];
      }));
      var h = '<div class="dr-chips">' + chips.map(function (c) {
        return '<button type="button" class="' + (c[0] === f ? 'on' : '') + '"'
          + CC.goAttr({ k: 'projects', id: c[0] }) + '>' + E(c[1]) + ' <em>' + CC.num(c[2]) + '</em></button>';
      }).join('') + '</div>';
      h += kv([
        ['الإيراد', g.rev == null ? null : m(g.rev), E(CC.txt.periodPhrase(calc().revM()))],
        ['الهامش المباشر', g.margin == null ? null : pct(g.margin, 1), ''],
        ['قيمة العقود', g.contract == null ? null : m(g.contract),
          g.remaining == null ? '' : 'المتبقي ' + mp(g.remaining)],
        ['منجز لم يُفوتر', g.unbilled == null ? null : m(g.unbilled), ''],
      ]);
      h += prjRows(list);
      h += note('الحالة ' + E(G().ragOwnerNote) + '.');
      h += '<div class="dr-acts">' + linkBtn(G().downloadExcel || 'تنزيل Excel', CC.url.xlsxAll(), 'download')
        + linkBtn('محفظة المشاريع', '/app/projects', 'arrowOut') + '</div>';
      return {
        kind: 'المشاريع', title: f === 'all' ? 'كل المشاريع' : ('المشاريع: ' + CC.rag.name(f)),
        sub: CC.txt.scopeName(), html: h,
      };
    },

    alerts: function () {
      var feed = D().attention || [];
      var hints = calc().insights();
      var tone = { red: 's3', amber: 's2', brand: 's1' };
      var h = '';
      if (feed.length) {
        h += sec('ما يحتاج انتباهك', '<ul class="dr-alerts">' + feed.map(function (a) {
          var body = CC.icon(a.tone === 'red' ? 'alert' : 'info') + '<span><b>' + E(a.title || '') + '</b>'
            + (a.sub ? '<small>' + E(a.sub) + '</small>' : '') + '</span>';
          return '<li>' + (a.href
            ? '<a class="dra ' + (tone[a.tone] || 's1') + '" href="' + E(a.href) + '">' + body + '</a>'
            : '<div class="dra ' + (tone[a.tone] || 's1') + '">' + body + '</div>') + '</li>';
        }).join('') + '</ul>', 'من سند مباشرة');
      } else {
        h += note('لا شيء يحتاج انتباهك في هذا القطاع الآن.');
      }
      if (hints.length) {
        h += sec('قراءاتٌ من أرقام الشاشة', '<ul class="dr-alerts">' + hints.map(function (x) {
          return '<li><button type="button" class="dra s' + x.sev + '"' + CC.goAttr(x.act) + '>'
            + CC.icon(x.ic) + '<span><b>' + E(x.t) + '</b>'
            + (x.s ? '<small>' + E(x.s) + '</small>' : '') + '</span></button></li>';
        }).join('') + '</ul>', 'قواعد ثابتة على الأرقام المعروضة');
      }
      return { kind: 'يحتاج قرارك', title: 'كل الملاحظات', sub: CC.txt.scopeName(), html: h };
    },

    changes: function () {
      var rows = D().changes || [];
      var h = rows.length
        ? '<ul class="dr-alerts">' + rows.slice(0, 30).map(function (c) {
          var body = CC.icon('history') + '<span><b>' + E(c.title || '') + '</b><small>'
            + E([c.sub, c.at ? String(c.at).slice(0, 10) : ''].filter(Boolean).join(' · ')) + '</small></span>';
          return '<li>' + (c.href ? '<a class="dra s1" href="' + E(c.href) + '">' + body + '</a>'
            : '<div class="dra s1">' + body + '</div>') + '</li>';
        }).join('') + '</ul>'
        : emptyP('لم يُسجَّل تغيّرٌ في هذه الفترة.');
      return { kind: 'الحركة', title: 'ما الذي تغيّر؟', sub: CC.sector.name_ar || '', html: h };
    },

    pl: function () {
      var P = calc().pl();
      var h = P.comp.length ? plTable(P) : note('لا أشهر مغلقة في الفترة المختارة.', true);
      if (!P.hasCost) h += note('بنود التكلفة والهامش لا تظهر لك، فالجدول يقتصر على الإيراد.', true);
      if (P.scope === 'projects') {
        h += note('على مستوى العميل والمشروع: الإيراد والتكلفة المباشرة فقط، بلا خطةٍ للتكاليف.');
      }
      if (P.open.length && P.L.rev && P.L.rev.planOpen != null) {
        h += note(E(CC.txt.monthsLabel(new Set(P.open))) + ' لم تُغلق ماليا بعد، فلا تدخل في المقارنة. '
          + 'خطة الإيراد فيها ' + m(P.L.rev.planOpen) + '.');
      }
      h += '<div class="dr-acts">' + linkBtn(G().downloadExcel || 'تنزيل Excel', CC.url.xlsxPl(), 'download')
        + linkBtn('نسخة الطباعة', CC.url.printPl(), 'printer') + '</div>';
      return {
        kind: 'المال', title: 'قائمة الدخل',
        sub: CC.txt.scopeName() + '، ' + (P.comp.length ? CC.txt.periodPhrase(P.comp) : 'لا أشهر مغلقة'),
        html: h,
      };
    },

    billing: function () {
      var g = calc().contracts();
      var ps = calc().projects().slice().sort(function (a, b) { return (b.unbilled || 0) - (a.unbilled || 0); });
      var mx = ps.length && ps[0].unbilled ? ps[0].unbilled : 1;
      var h = kv([
        ['قيمة العقود', g.contract == null ? null : m(g.contract), ''],
        ['المتبقي منها', g.remaining == null ? null : m(g.remaining), ''],
        ['منجز لم يُفوتر', g.unbilled == null ? null : m(g.unbilled), ''],
        ['المنجز من العقود', (g.contract && g.remaining != null)
          ? pct((g.contract - g.remaining) / g.contract) : null, ''],
      ]);
      var rows = ps.filter(function (p) { return p.unbilled != null && p.unbilled > 0; });
      if (rows.length) {
        h += sec('منجز لم يُفوتر حسب المشروع', '<div class="brk">' + rows.map(function (p) {
          return brkRow({ k: 'prj', id: p.id }, p.name, p.unbilled / mx * 100, m(p.unbilled),
            cliName(p.client_id), 'var(--teal)');
        }).join('') + '</div>');
      } else {
        h += note('لا أعمال منجزة بلا فاتورة في هذا النطاق.');
      }
      return { kind: 'العقود', title: 'العقود والفوترة', sub: CC.txt.scopeName() + '، رصيدٌ تراكمي حتى اليوم', html: h };
    },

    clients: function () {
      var rs = calc().clientsInScope().map(function (c) { return calc().clientRel(c.id); })
        .sort(function (a, b) { return b.rev - a.rev; });
      var tot = rs.reduce(function (t, x) { return t + x.rev; }, 0);
      var mx = Math.max.apply(null, [1].concat(rs.map(function (x) { return x.total; })));
      var pros = (D().clients || []).filter(function (c) { return c.prospect; })
        .map(function (c) { return calc().clientRel(c.id); })
        .sort(function (a, b) { return b.pipe - a.pipe; });
      var row = function (r, subTxt) {
        return '<button type="button" class="rel-row"' + CC.goAttr({ k: 'cli', id: r.id })
          + '><span class="rel-n"><b>' + E(r.c.name) + '</b><small>' + E(subTxt) + '</small></span>'
          + CC.fig.relBar({ rev: r.rev, backlog: r.backlog, pipe: r.pipe }, mx, { fmt: CC.mp })
          + '<b class="rel-t">' + m(r.total) + '</b></button>';
      };
      var h = CC.fig.stkLegend([
        { color: 'var(--brand)', label: 'الإيراد في الفترة' },
        { color: 'var(--teal)', label: 'المتبقي من العقود' },
        { color: '#834798', label: 'الفرص المرجّحة' },
      ]);
      h += rs.length
        ? '<div class="rel">' + rs.map(function (r) {
          return row(r, pctp(tot ? r.rev / tot : 0) + ' من الإيراد');
        }).join('') + '</div>'
        : emptyP('لا عملاء في هذا النطاق.');
      if (pros.length) {
        h += sec('عملاء جدد في خط الفرص', '<div class="rel">' + pros.map(function (r) {
          return row(r, CC.txt.cnt(r.pp.count, CC.txt.F.opp));
        }).join('') + '</div>');
      }
      return {
        kind: 'العملاء', title: 'أكبر العملاء',
        sub: 'الإيراد ' + CC.txt.periodPhrase(calc().revM()) + '، والعقود والفرص حتى اليوم', html: h,
      };
    },

    pace: function () {
      var o = calc().outlook();
      var series = calc().revSeries();
      var cum = function (arr) {
        var t = null;
        return (arr || []).map(function (v) {
          if (v == null) return null;
          t = (t || 0) + v;
          return t;
        });
      };
      var act = cum(series);
      var lastI = -1;
      act.forEach(function (v, i) { if (v != null) lastI = i; });
      var lines = [{ values: act, color: 'var(--brand)', sw: 2.6, dots: true, area: true,
        tips: function (i, v) { return (G().MONTHS_AR || [])[i] + ' · تراكمي ' + CC.mp(v); } }];
      var planM = CC.D.plan && CC.D.plan.monthly_target;
      if (planM) {
        lines.push({ values: cum(planM), color: '#8b93ad', dash: true, sw: 1.6,
          tips: function (i, v) { return 'الخطة حتى ' + (G().MONTHS_AR || [])[i] + ' · ' + CC.mp(v); } });
      }
      if (o.forecast != null && lastI >= 0 && lastI < 11) {
        lines.push({ values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (mm, i) {
          return i < lastI ? null : act[lastI] + (o.forecast - act[lastI]) * (i - lastI) / (11 - lastI);
        }), color: 'var(--gold)', dash: true, sw: 2 });
      }
      var h = kv([
        ['الإيراد حتى اليوم', o.revTD == null ? null : m(o.revTD), 'من سند'],
        ['مستهدف السنة', o.target == null ? null : m(o.target),
          o.pctTD == null ? 'لم يُسجَّل مستهدف' : 'تحقّق منه ' + pctp(o.pctTD)],
        ['المتوقع بنهاية السنة', o.forecast == null ? null : m(o.forecast),
          (o.forecast != null && o.target) ? pctp(o.forecast / o.target) + ' من المستهدف' : 'لم يُحتسب'],
        ['المطلوب شهرياً', o.need == null ? null : m(o.need), 'حتى نهاية ديسمبر'],
      ]);
      h += sec('الإيراد التراكمي', CC.fig.lineR({
        w: 560, h: 210, series: lines,
        hline: o.target != null ? { v: o.target, color: 'var(--red)', label: 'المستهدف ' + CC.mp(o.target) } : null,
        yFmt: function (v) { return CC.mp(v); }, label: 'الإيراد التراكمي مقابل المستهدف',
      }), planM ? 'المتقطّع الرمادي خطة الأشهر' : 'لا توزيع شهري للمستهدف');
      if (o.low != null && o.high != null) {
        h += note('التوقّع بالوتيرة الحالية، ومداه المحتمل بين ' + m(o.low) + ' و' + m(o.high) + '.');
      }
      if (CC.D.plan && CC.D.plan.finance_plan_fy != null && o.target != null
        && CC.D.plan.finance_plan_fy !== o.target) {
        h += note('مستهدف القطاع ' + m(o.target) + ' يختلف عن خطة المالية للسنة '
          + m(CC.D.plan.finance_plan_fy) + '. المقارنة هنا بمستهدف القطاع، وقائمة الدخل تقارن بخطة المالية.', true);
      }
      if (CC.notes && CC.notes.no_monthly_plan) {
        h += note('المستهدف غير موزَّع على الأشهر، فالخطة تظهر سطراً واحداً في نهاية السنة.');
      }
      return {
        kind: 'هل نبلغ المستهدف؟', title: 'الوقت مقابل الإيراد',
        sub: CC.txt.scopeName() + (CC.today().m ? '، حتى ' + CC.today().d + ' ' + (G().MONTHS_AR || [])[CC.today().m - 1] : ''),
        html: h,
      };
    },

    data: function () {
      var meta = CC.meta || {}, up = meta.finance_upload || {}, rec = D().recon;
      var closed = CC.closedThrough();
      var srcAr = function (key) {
        var map = G().closedSource || {};
        var name = map[String(key == null ? '' : key)];
        return name ? E(name) : null;
      };
      var h = kv([
        ['المالية', closed ? E((G().MONTHS_AR || [])[closed - 1]) : null, 'آخر شهر مغلق'],
        // المصدر مفتاحٌ داخليّ («derived») — يُترجَم من خريطة الأسماء، وما لا اسم له يبقى غياباً
        // ولا يُطبع خاماً في وجه القارئ.
        ['مصدر الإقفال', srcAr(meta.closed_source), ''],
        ['آخر رفعٍ للمالية', up.at ? E(String(up.at).slice(0, 16).replace('T', ' ')) : null,
          up.by ? E(String(up.by)) : ''],
        ['اكتمال بيانات سند', meta.completeness_pct == null ? null : pct(meta.completeness_pct / 100), ''],
      ]);
      h += sec('من أين يأتي كل رقم', '<div class="brk">'
        + brkRow(null, 'قائمة الدخل والتكاليف', 100, '<span class="src fin">المالية</span>', 'رفعٌ شهري')
        + brkRow(null, 'الإيراد والعقود والفوترة', 100, '<span class="src sanad">سند</span>', 'حتى اليوم')
        + brkRow(null, 'الفرص والمبيعات', 100, '<span class="src sanad">سند</span>', 'حتى اليوم')
        + brkRow(null, 'الفريق والتسكين', 100, '<span class="src sanad">سند</span>', 'خطة التسكين')
        + '</div>');
      if (rec && rec.months && rec.months.length) {
        h += sec('مطابقة سند مع المالية', '<div class="tbl-x"><table class="recon"><thead><tr><th>الشهر</th>'
          + '<th>في المالية</th><th>في سند</th><th>الفرق</th></tr></thead><tbody>'
          + rec.months.map(function (r) {
            return '<tr><td>' + E((G().MONTHS_AR || [])[r.m - 1] || '') + '</td>'
              + '<td>' + (r.fin_cor == null ? none() : m(r.fin_cor)) + '</td>'
              + '<td>' + (r.sanad_cor == null ? none() : m(r.sanad_cor)) + '</td>'
              + '<td>' + (r.diff == null ? none() : m(r.diff)) + ' '
              + (r.match ? '<span class="st good"><i></i>مطابق سند</span>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>');
        // قاعدةُ المطابقة من مصدر العتبات نفسه الذي تحكم به الخدمة — لا نسبةٌ ولا مبلغٌ مكتوبان
        // باليد هنا، فلا تفترق الشاشة عن الحكم حين تتغيّر العتبة.
        if (G().plReconLegend) h += note('«مطابق سند»: ' + E(G().plReconLegend) + '، أيهما أكبر.');
      } else {
        h += note('لم تُسجَّل مطابقةٌ بين ملف المالية ومصاريف سند بعد.', true);
      }
      if (rec && rec.by_line && rec.by_line.length) {
        h += sec('حسب البند', '<div class="tbl-x"><table class="rt"><thead><tr><th>البند</th>'
          + '<th>في المالية</th><th>في سند</th><th>ملاحظة</th></tr></thead><tbody>'
          + rec.by_line.map(function (r) {
            return '<tr><td>' + E(r.name || r.line || '') + '</td>'
              + '<td>' + (r.fin == null ? none() : m(r.fin)) + '</td>'
              + '<td>' + (r.sanad == null ? none() : m(r.sanad)) + '</td>'
              + '<td>' + E(r.comparable ? 'قابل للمقارنة' : (r.reason || 'غير قابل للمقارنة')) + '</td></tr>';
          }).join('') + '</tbody></table></div>');
      }
      var notes = D().notes || [];
      var NT = {
        no_monthly_plan: 'مستهدف السنة غير موزَّع على الأشهر بعد.',
        no_project_plan: 'لا خطة إيرادٍ على مستوى المشروع.',
        costs_hidden: 'بنود التكلفة والهامش لا تظهر لك.',
        revenue_hidden: 'أرقام الإيراد لا تظهر لك.',
        plan_hidden: 'أرقام الخطة لا تظهر لك.',
      };
      notes.forEach(function (n) { if (NT[n]) h += note(NT[n], n.indexOf('hidden') >= 0); });
      return { kind: 'جودة البيانات', title: 'من أين تأتي الأرقام؟', sub: 'المصادر والتحديث والمطابقة', html: h };
    },
  };

  function sumOf(arr, months) {
    if (!arr) return null;
    var t = null;
    for (var i = 0; i < months.length; i++) {
      var v = arr[months[i] - 1];
      if (v != null && v === v) t = (t || 0) + v;
    }
    return t;
  }

  CC.DETAIL = DETAIL;

  // ── القشرة ───────────────────────────────────────────────────────────────
  var cur = null, lastTrigger = null, host = null, observer = null;

  function hostEl() {
    if (!doc) return null;
    if (!host) host = doc.getElementById('drawer');
    return host;
  }
  function isOpen() { return !!cur; }

  function shellHTML(r) {
    return '<div class="cc-drawer">'
      + '<div class="dr-head"><div><div class="dr-k">' + (r.kind || '') + '</div>'
      + '<h3 id="ccDrT">' + E(r.title || '') + '</h3>'
      + (r.sub ? '<p>' + E(r.sub) + '</p>' : '') + '</div>'
      + '<button type="button" class="icon-btn" data-dr-close aria-label="إغلاق">' + CC.icon('x') + '</button></div>'
      + '<div class="dr-body">' + r.html + '</div></div>';
  }

  function paint() {
    var el = hostEl();
    if (!el || !cur) return;
    var fn = DETAIL[cur.k];
    if (!fn) return;
    var r;
    try {
      r = fn(cur.id);
    } catch (e) {
      r = { kind: '', title: 'تعذّر عرض التفاصيل', sub: '', html: emptyP('حدث خللٌ في عرض هذه التفاصيل. أغلق اللوحة وأعد المحاولة.') };
    }
    var Sd = root.Sanad;
    if (Sd && typeof Sd.openDrawer === 'function') Sd.openDrawer(shellHTML(r));
    else { el.innerHTML = shellHTML(r); el.classList.add('on'); }
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'ccDrT');
    var body = el.querySelector('.dr-body');
    if (body) body.scrollTop = 0;
  }

  function focusables(el) {
    return [].slice.call(el.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(function (x) { return x.offsetParent !== null || x === doc.activeElement; });
  }

  function watchClose(el) {
    if (observer || !root.MutationObserver) return;
    // الإغلاق قد يأتي من Escape في app.js أو من نقر الحاجب — فالمراقبة أصدق من ربط المفتاح مرتين
    observer = new root.MutationObserver(function () {
      if (cur && !el.classList.contains('on')) finishClose();
    });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  }

  function finishClose() {
    cur = null;
    var el = hostEl();
    if (el) {
      el.removeAttribute('role');
      el.removeAttribute('aria-modal');
      el.removeAttribute('aria-labelledby');
    }
    var t = lastTrigger;
    lastTrigger = null;
    if (t && doc && doc.contains(t) && t.focus) t.focus();
  }

  CC.drawer = {
    isOpen: isOpen,
    open: function (spec, trigger) {
      if (!spec || !DETAIL[spec.k]) return;
      var el = hostEl();
      if (!el) return;
      if (!cur) lastTrigger = trigger || (doc && doc.activeElement) || null;
      cur = { k: spec.k, id: spec.id == null ? null : spec.id };
      paint();
      watchClose(el);
      var close = el.querySelector('[data-dr-close]');
      if (close) setTimeout(function () { close.focus(); }, 40);
    },
    close: function () {
      if (!cur) return;
      var Sd = root.Sanad;
      if (Sd && typeof Sd.closeDrawer === 'function') Sd.closeDrawer();
      else {
        var el = hostEl();
        if (el) el.classList.remove('on');
      }
      finishClose();
    },
    repaint: function () { if (cur) paint(); },
    current: function () { return cur; },
  };

  if (doc) {
    doc.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-dr-close]')) { CC.drawer.close(); return; }
    });
    // حبس التركيز داخل اللوحة ما دامت مفتوحة — بلا لمس Escape، فهو مربوطٌ في app.js
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || !cur) return;
      var el = hostEl();
      if (!el || !el.contains(doc.activeElement)) return;
      var f = focusables(el);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
}());
