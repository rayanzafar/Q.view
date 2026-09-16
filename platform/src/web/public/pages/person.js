// لوحة المدير على صفحة الشخص: أضف مهمة · سكّنه على مشروع · بطاقة «صلاحياته» (الدور، والحِزم، والمنح والرفع).
//
// «أقدر أضيف أو أسوّي أي أكشن أنا كمدير للموظف لما أضغط عليه — حتى في إضافة المهام».
// «داخل صفحة الموظف يحتاج يكون في خانة عند المدير إذا يبغى يغيّر الصلاحيات… عشان يكون سهل وبشكل سريع».
//
// وكل نداءٍ هنا يذهب إلى **مسار الخدمة الأصلي** لا إلى مسارٍ مختصر لهذه الشاشة: المهمة إلى
// مسار المهام، والتسكين إلى مسار تسكين المشروع، والصلاحية والدور إلى مسار الهوية. فالحارس والتدقيق
// واحدٌ أينما نُفِّذ الفعل — ولا يصير لهذه الصفحة قواعدُ تخصّها تتباعد عن قواعد أصلها.
(function () {
  // إشعارٌ حقيقي لا وسيطٌ إلى دالة غير موجودة: كانت اللوحة تنادي دالةً لم تُعرَّف قط، فتُبتلع
  // كل رسائلها — نجاحاً وخطأً وتنبيهاً — ويعمل المدير أعمى (KI-043 سابقاً). النمط نفسه
  // المستعمل في شاشة الاعتمادات حرفياً.
  var toast = function (m, bad) {
    var d = document.createElement('div');
    d.textContent = m;
    d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;'
      + 'font-size:13px;max-width:min(92vw,420px);line-height:1.7;box-shadow:0 8px 24px rgba(0,0,0,.2);background:'
      + (bad ? '#b91c1c' : '#047857');
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, bad ? 5200 : 2600);
  };
  var val = function (id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  var reload = function () { setTimeout(function () { location.reload(); }, 500); };

  async function api(path, method, body) {
    var res = await fetch('/api' + path, {
      method: method || 'GET',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    var txt = await res.text();
    var data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
    // غلاف الخطأ من الخادم كائنٌ داخله الرسالة — قراءةُ الغلاف نفسه كانت تعرض نصاً تقنياً بلا معنى.
    if (!res.ok) throw new Error((data && data.error && data.error.message) || 'تعذّر إتمام العملية');
    return data;
  }

  // لوحة واحدة مفتوحة في كل مرة: اللوحات مفتوحةً معاً تُطيل البطاقة حتى تختفي قائمة المهام تحتها.
  function openTab(key) {
    var el = document.querySelector('[data-panel="' + key + '"]');
    var reopen = !!el && el.hidden;                       // مغلقة الآن ⟵ تُفتح؛ ومفتوحة ⟵ تُطوى
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = true; });
    if (!reopen || !el) return;
    el.hidden = false;
    var f = el.querySelector('input,select');
    if (f) f.focus();
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var act = el.dataset.action;

    if (act === 'pp-tab') { openTab(el.dataset.tab); return; }

    if (act === 'pp-task-add') {
      var title = val('pp-task-title');
      if (!title) { toast('اكتب ما تريد منه — مهمة بلا عنوان لا يقرؤها أحد', true); return; }
      el.disabled = true;
      // الجهة من المنتقي بترميز `p:`/`o:` نفسه المعتمد في شاشة «مهامي» (`parentPatch` في
      // pages/tasks.js هو مصدر الاصطلاح). والفراغ عملٌ داخلي يُقال صراحةً: بدون `work_kind`
      // كان الخادم يكتب قيمته الافتراضية «مشروع» على مهمةٍ لا مشروع لها — نوعٌ كاذب في الصف.
      var pv = val('pp-task-parent');
      var body = { title: title, assignee_user_id: el.dataset.user, due_date: val('pp-task-due') || null,
        project_id: null, opportunity_id: null };
      if (pv.indexOf('p:') === 0) { body.project_id = pv.slice(2); }
      else if (pv.indexOf('o:') === 0) { body.opportunity_id = pv.slice(2); }
      else { body.work_kind = 'internal'; }
      api('/tasks/quick', 'POST', body).then(function (added) {
        // المهمة هنا باسم شخصٍ آخر: إن عُلِّقت فهي تنتظر اعتماد مدير **كاتبها**، وتُضاف إلى
        // قائمة المُسنَد إليه بعد الاعتماد — لا «تظهر في عملك» كما في صيغة الإسناد الذاتي.
        toast(added && added.approval_state === 'PENDING'
          ? 'أُرسلت إلى مديرك للاعتماد — وتُضاف إلى قائمة صاحبها بعد الاعتماد' : 'أُضيفت المهمة ✓');
        reload();
      }).catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }

    if (act === 'pp-staff-add') {
      var prj = val('pp-staff-prj');
      var pct = Number(val('pp-staff-pct'));
      if (!prj) { toast('اختر المشروع', true); return; }
      if (!(pct > 0 && pct <= 100)) { toast('النسبة بين ١ و١٠٠', true); return; }
      el.disabled = true;
      api('/projects/' + encodeURIComponent(prj) + '/staff', 'POST', {
        employeeId: el.dataset.emp, type: 'member', pct: pct,
      }).then(function () {
        toast('سُكِّن على المشروع ✓');
        reload();
      }).catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }

    // ── بطاقة «صلاحياته» ──────────────────────────────────────────────────────
    // الدور: نموذجٌ مطويّ يُفتح بزرّ، ويُحفظ عبر مسار تعديل الحساب نفسه (مدير النظام وحده).
    if (act === 'pp-role-edit') {
      var form = document.getElementById('pp-role-form');
      if (!form) return;
      form.hidden = !form.hidden;
      if (!form.hidden) { var s0 = form.querySelector('select'); if (s0) s0.focus(); }
      return;
    }
    if (act === 'pp-role-save') {
      el.disabled = true;
      api('/identity/users/' + encodeURIComponent(el.dataset.user), 'PATCH', {
        role_id: val('pp-role'), scope: val('pp-scope'), sector_id: val('pp-sector') || null,
      }).then(function (r) {
        toast(r && r.unchanged ? 'لا تغيير — الدور كما هو' : 'حُفظ الدور ✓');
        reload();
      }).catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }
    // حزمةٌ جاهزة تعلِّم خاناتها (ولا تكتب شيئاً بنفسها) — الحفظ بزرّ «امنحها» وحده.
    if (act === 'pp-preset') {
      var wanted = String(el.dataset.pairs || '').split(',');
      document.querySelectorAll('.pp-cap-box').forEach(function (box) { box.checked = wanted.indexOf(box.value) >= 0; });
      recompute();
      return;
    }
    // القدرات المختارة على هدفٍ (إدارة/قطاع/الشركة) بمدةٍ اختيارية: القيمة `مستوى:معرّف` كما بناها الخادم.
    if (act === 'pp-bundle-add') {
      var pairs = ticked();
      var target = val('pp-bundle-target');
      if (!pairs.length) { toast('اختر قدرةً واحدة على الأقل', true); return; }
      var sep = target.indexOf(':');
      var level = sep < 0 ? target : target.slice(0, sep);
      var tid = sep < 0 ? '' : target.slice(sep + 1);
      if (!level) { toast('اختر على ماذا تُمنَح', true); return; }
      var payload = { user_id: el.dataset.user, pairs: pairs, level: level,
        note: val('pp-bundle-note') || null, expires_on: val('pp-bundle-until') || null };
      if (level === 'department') payload.department_id = tid;
      else if (level === 'sector') payload.sector_id = tid;
      el.disabled = true;
      api('/identity/grants/bundles', 'POST', payload).then(function (r) {
        toast(r && !r.created ? 'كانت ممنوحةً له على الهدف نفسه — حُدِّثت مدتها' : 'مُنحت الصلاحية ✓ وتسري من طلبه التالي');
        reload();
      }).catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }
    if (act === 'grant-revoke-bundle') {
      el.disabled = true;
      api('/identity/grants/bundles/' + encodeURIComponent(el.dataset.id), 'DELETE')
        .then(function () {
          toast('رُفعت الصلاحية ✓');
          reload();
        }).catch(function (err) { el.disabled = false; toast(err.message, true); });
    }
  });

  // ── الاختيار المتعدد للقدرات ──────────────────────────────────────────────────
  // القدرات وأهدافها محسوبة في الخادم بنفس حكم الحفظ (grantablePairOptions) ومضمّنة في الصفحة —
  // فلا نداءَ شبكةٍ لمجرد تغيير اختيار. الهدفُ المعروض تقاطعُ أهداف المختار: ما لا يصله زوجٌ من
  // المجموعة لا يُعرض، وإن لم يبقَ هدفٌ مشترك قيل السبب وعُطِّل الزرّ قبل الضغطة.
  function capData() {
    var dataEl = document.getElementById('pp-cap-data');
    if (!dataEl) return { pairs: [], presets: [] };
    try { return JSON.parse(dataEl.textContent || '{}') || { pairs: [], presets: [] }; } catch (err) { return { pairs: [], presets: [] }; }
  }
  function ticked() {
    var out = [];
    document.querySelectorAll('.pp-cap-box').forEach(function (box) { if (box.checked) out.push(box.value); });
    return out;
  }
  function recompute() {
    var data = capData();
    var sel = document.getElementById('pp-bundle-target');
    var hint = document.getElementById('pp-bundle-hint');
    var btn = document.querySelector('[data-action="pp-bundle-add"]');
    if (!sel || !btn) return;
    var keys = ticked();
    var chosen = data.pairs.filter(function (p) { return keys.indexOf(p.key) >= 0; });
    // التقاطع: هدفٌ يبقى إن كان في أهداف كل قدرةٍ مختارة (وبلا اختيارٍ تبقى القائمة كلها)
    var common = [];
    var seen = {};
    var source = chosen.length ? chosen : data.pairs;
    for (var i = 0; i < source.length; i++) {
      for (var j = 0; j < source[i].targets.length; j++) {
        var t = source[i].targets[j];
        if (seen[t.v]) continue;
        seen[t.v] = true;
        var inAll = true;
        for (var k = 0; k < chosen.length; k++) {
          var has = false;
          for (var m = 0; m < chosen[k].targets.length; m++) { if (chosen[k].targets[m].v === t.v) { has = true; break; } }
          if (!has) { inAll = false; break; }
        }
        if (inAll) common.push(t);
      }
    }
    var current = sel.value;
    sel.innerHTML = '';
    for (var n = 0; n < common.length; n++) {
      var o = document.createElement('option');
      o.value = common[n].v; o.textContent = common[n].name;
      if (common[n].v === current) o.selected = true;
      sel.appendChild(o);
    }
    var groups = [];
    var byGroup = {};
    for (var c = 0; c < chosen.length; c++) {
      var g = chosen[c].group;
      if (!byGroup[g]) { byGroup[g] = []; groups.push(g); }
      byGroup[g].push(chosen[c].short);
    }
    var summary = groups.map(function (g) { return g + ': ' + byGroup[g].join(' · '); }).join(' — ');
    if (!chosen.length) {
      btn.disabled = true;
      if (hint) hint.textContent = 'اختر قدرةً فأكثر (أو حزمةً جاهزة)، ثم على ماذا. التاريخ آخر يوم تسري فيه، وفراغه صلاحيةٌ بلا مدة.';
    } else if (!common.length) {
      btn.disabled = true;
      if (hint) hint.textContent = 'لا هدف مشترك لهذه المجموعة: الفعاليات تُمنَح على الشركة وحدها، والفرص والمشاريع على إدارةٍ أو قطاع — امنحها في طلبين.';
    } else {
      btn.disabled = false;
      var name = '';
      for (var q = 0; q < common.length; q++) { if (common[q].v === sel.value) { name = common[q].short; break; } }
      if (hint) hint.textContent = summary + ' — على ' + (name || 'الهدف المختار') + '. التاريخ آخر يوم تسري فيه، وفراغه صلاحيةٌ بلا مدة.';
    }
  }
  document.addEventListener('change', function (e) {
    if (!e.target) return;
    if ((e.target.classList && e.target.classList.contains('pp-cap-box')) || e.target.id === 'pp-bundle-target') recompute();
  });
  recompute();
})();
