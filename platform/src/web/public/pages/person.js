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
    // الحزمة على هدفٍ (إدارة/قطاع/الشركة) بمدةٍ اختيارية: القيمة `مستوى:معرّف` كما بناها الخادم.
    if (act === 'pp-bundle-add') {
      var bundle = val('pp-bundle');
      var target = val('pp-bundle-target');
      if (!bundle) { toast('اختر الصلاحية', true); return; }
      var sep = target.indexOf(':');
      var level = sep < 0 ? target : target.slice(0, sep);
      var tid = sep < 0 ? '' : target.slice(sep + 1);
      if (!level) { toast('اختر على ماذا تُمنَح', true); return; }
      var payload = { user_id: el.dataset.user, bundle: bundle, level: level,
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

  // تبديلُ الحزمة يبدّل أهدافها وشرحَها، وتبديلُ الهدف يضع اسمه في الشرح: الأهداف محسوبة في الخادم
  // بنفس حكم الحفظ (grantableBundleOptions) ومضمّنة في الصفحة — فلا نداءَ شبكةٍ لمجرد تغيير اختيار.
  function bundleData() {
    var dataEl = document.getElementById('pp-bundle-data');
    if (!dataEl) return [];
    try { return JSON.parse(dataEl.textContent || '[]'); } catch (err) { return []; }
  }
  function currentBundle() {
    var key = val('pp-bundle');
    var list = bundleData();
    for (var i = 0; i < list.length; i++) { if (list[i].key === key) return list[i]; }
    return null;
  }
  function refreshHint() {
    var b = currentBundle();
    var hint = document.getElementById('pp-bundle-hint');
    if (!b || !hint) return;
    var v = val('pp-bundle-target');
    var name = '';
    for (var i = 0; i < b.targets.length; i++) { if (b.targets[i].v === v) { name = b.targets[i].short; break; } }
    hint.textContent = String(b.effect).replace('{target}', name || 'الإدارة') + ' · التاريخ آخر يوم تسري فيه، وفراغه صلاحيةٌ بلا مدة.';
  }
  document.addEventListener('change', function (e) {
    if (!e.target) return;
    if (e.target.id === 'pp-bundle') {
      var b = currentBundle();
      var sel = document.getElementById('pp-bundle-target');
      if (!b || !sel) return;
      sel.innerHTML = '';
      for (var j = 0; j < b.targets.length; j++) {
        var o = document.createElement('option');
        o.value = b.targets[j].v;
        o.textContent = b.targets[j].name;
        sel.appendChild(o);
      }
      refreshHint();
    } else if (e.target.id === 'pp-bundle-target') {
      refreshHint();
    }
  });
})();
