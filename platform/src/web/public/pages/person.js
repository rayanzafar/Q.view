// لوحة المدير على صفحة الشخص: أضف مهمة · سكّنه على مشروع · صلاحية إضافية على إدارة.
//
// «أقدر أضيف أو أسوّي أي أكشن أنا كمدير للموظف لما أضغط عليه — حتى في إضافة المهام».
//
// وكل نداءٍ هنا يذهب إلى **مسار الخدمة الأصلي** لا إلى مسارٍ مختصر لهذه الشاشة: المهمة إلى
// مسار المهام، والتسكين إلى مسار تسكين المشروع، والصلاحية إلى مسار الهوية. فالحارس والتدقيق
// واحدٌ أينما نُفِّذ الفعل — ولا يصير لهذه الصفحة قواعدُ تخصّها تتباعد عن قواعد أصلها.
(function () {
  var toast = function (m, bad) { if (window.Sanad && window.Sanad.toast) window.Sanad.toast(m, bad); };
  var val = function (id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };

  async function api(path, method, body) {
    var res = await fetch('/api' + path, {
      method: method || 'GET',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    var txt = await res.text();
    var data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && (data.error || data.message)) || 'تعذّر إتمام العملية');
    return data;
  }

  // لوحة واحدة مفتوحة في كل مرة: الثلاث مفتوحةً معاً تُطيل البطاقة حتى تختفي قائمة المهام تحتها.
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
      api('/tasks/quick', 'POST', {
        title: title, assignee_user_id: el.dataset.user, due_date: val('pp-task-due') || null,
      }).then(function () {
        toast('أُضيفت المهمة ✓');
        setTimeout(function () { location.reload(); }, 500);
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
        setTimeout(function () { location.reload(); }, 500);
      }).catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }

    if (act === 'pp-grant-add') {
      var dept = val('pp-grant-dept');
      if (!dept) { toast('اختر الإدارة', true); return; }
      el.disabled = true;
      api('/identity/grants', 'POST', {
        user_id: el.dataset.user, department_id: dept,
        resource: 'opportunity', action: 'read', note: val('pp-grant-note') || null,
      }).then(function (r) {
        toast(r && r.already ? 'الصلاحية ممنوحة له مسبقاً' : 'مُنحت الصلاحية ✓');
        setTimeout(function () { location.reload(); }, 500);
      }).catch(function (err) { el.disabled = false; toast(err.message, true); });
      return;
    }

    if (act === 'grant-revoke') {
      el.disabled = true;
      api('/identity/grants/' + encodeURIComponent(el.dataset.id), 'DELETE')
        .then(function () {
          toast('رُفعت الصلاحية ✓');
          setTimeout(function () { location.reload(); }, 500);
        }).catch(function (err) { el.disabled = false; toast(err.message, true); });
    }
  });
})();
