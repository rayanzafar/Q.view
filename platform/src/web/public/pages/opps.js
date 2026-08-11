// صفحات الفرص v2 — سلوك تفاعلي بتفويض أحداث فقط (data-action / data-dd / data-stage-move).
// يعتمد على بنية app.js المجمّدة: Sanad.openModal/closeModal/openDD/esc — ولا يعدّلها.
(function () {
  'use strict';
  var S = function () { return window.__SANAD || {}; };
  var esc = function (s) { return window.Sanad ? window.Sanad.esc(s) : String(s == null ? '' : s); };

  function toast(msg, bad) {
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#dc2626' : '#059669');
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600);
  }
  async function api(path, method, body) {
    var r = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error((j.error && j.error.message) || ('خطأ ' + r.status));
    return j;
  }

  // ── بحث حي (كانبان + جدول) — يُهيَّأ من ?q= عند فتح عرض محفوظ ──
  function filterCards() {
    var qEl = document.getElementById('opp-q'); if (!qEl) return;
    var q = (qEl.value || '').toLowerCase().trim();
    document.querySelectorAll('#opp-kanban .kcard, #opp-table tbody tr[data-hay]').forEach(function (c) {
      var hay = c.dataset.hay || c.textContent.toLowerCase();
      c.style.display = (!q || hay.indexOf(q) !== -1) ? '' : 'none';
    });
    if (window.Sanad && window.Sanad._recount) window.Sanad._recount('opp');
  }
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'opp-q') filterCards();
  });
  // معاينةٌ فورية للوجه الآخر من المبلغ — كي يرى المُدخِل ما سيُحفَظ قبل أن يحفظ، لا بعده.
  // الحساب هنا للعرض وحده؛ الرقم المُلزِم يحسبه الخادم بالقاعدة نفسها.
  function vatPreview() {
    var hint = document.getElementById('oc-value-hint');
    var val = document.getElementById('oc-value');
    var sel = document.getElementById('oc-vat');
    if (!hint || !val || !sel) return;
    var n = Number(val.value);
    if (!isFinite(n) || n <= 0) { hint.textContent = ''; return; }
    var fmt = function (x) { return Math.round(x).toLocaleString('en-US') + ' ر.س'; };
    hint.textContent = sel.value === '0'
      ? 'يُحفَظ شاملاً الضريبة: ' + fmt(n * 1.15)
      : 'بدون ضريبة: ' + fmt(n * 100 / 115);
  }
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'oc-sector') syncDeptOptions();
    if (e.target && (e.target.id === 'oc-vat' || e.target.id === 'oc-value')) vatPreview();
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'oc-value') vatPreview();
    if (e.target && e.target.id === 'team-emp-q') syncRosterPick();
  });

  // ── قائمة من يُضمّ لفريق الفرصة: الشركة كلها، بحثاً بالاسم ──
  // تُقرأ من مسار الفرصة لا من كشف التسكين: الكشف محدودٌ بإدارة القارئ عن حقّ، والعمل على
  // الفرصة عابرٌ للإدارات. وتُحمَّل مرةً واحدة ويُرشِّح المتصفّح داخلها — فلا نداءَ لكل حرف.
  var ROSTER = [];
  async function loadRoster() {
    var box = document.getElementById('team-roster');
    var q = document.getElementById('team-emp-q');
    if (!box || !S().oppId) return;
    try {
      var r = await api('/opportunities/' + encodeURIComponent(S().oppId) + '/team/roster');
      ROSTER = r.roster || [];
      box.innerHTML = ROSTER.map(function (e) {
        var where = [e.department_name, e.sector_name].filter(Boolean).join(' · ');
        return '<option value="' + esc(e.name_ar) + (where ? ' — ' + esc(where) : '') + '"></option>';
      }).join('');
      if (q) q.placeholder = 'ابحث بالاسم… (' + ROSTER.length + ' شخصاً)';
    } catch (err) {
      if (q) q.placeholder = 'تعذّر جلب الأسماء — أعد تحميل الصفحة';
    }
  }
  // الحقل المخفي يحمل المعرّف: يكتب المستخدم اسماً، ونطابقه على القائمة المحمَّلة.
  // ولا نطابق بالاسم عند الحفظ — الاسم قد يتكرّر، والمعرّف لا.
  function syncRosterPick() {
    var q = document.getElementById('team-emp-q');
    var hidden = document.getElementById('team-emp');
    if (!q || !hidden) return;
    var typed = (q.value || '').trim();
    var hit = null;
    for (var i = 0; i < ROSTER.length; i++) {
      var e = ROSTER[i];
      var where = [e.department_name, e.sector_name].filter(Boolean).join(' · ');
      var label = e.name_ar + (where ? ' — ' + where : '');
      if (label === typed || e.name_ar === typed) { hit = e; break; }
    }
    hidden.value = hit ? hit.id : '';
  }

  function init() {
    var params = new URLSearchParams(location.search);
    var q = params.get('q');
    var el = document.getElementById('opp-q');
    if (q && el) { el.value = q; filterCards(); }
    loadRoster();
    syncDeptOptions();
    vatPreview();
    // صفحة التفاصيل: التبويب من الرابط (?tab=)، وفتح نافذة التعديل عند الوصول بـ ?edit=1
    // — رابط «تعديل» في المعاينة السريعة يصل إلى النافذة مفتوحة لا إلى صفحة يبحث فيها عن زرّ.
    var tab = params.get('tab');
    if (tab) {
      var btn = document.querySelector('[data-action="opp-tab"][data-tab="' + tab.replace(/[^a-z-]/g, '') + '"]');
      if (btn && typeof oppTab === 'function') oppTab(btn);
    }
    if (params.get('edit') === '1' && document.getElementById('opp-edit-tpl')) {
      oppEditOpen();
      // يُمسح المعامل فوراً — وإلا أعادت كلُّ إعادة تحميل (بعد الحفظ مثلاً) فتحَ النافذة فوق الصفحة.
      try {
        var u = new URL(location.href); u.searchParams.delete('edit');
        history.replaceState(null, '', u.pathname + u.search);
      } catch (e2) { /* المتصفحات القديمة: النافذة تفتح والرابط يبقى */ }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // ── تعديل «الخطوة التالية» في مكانها ──
  function naEdit(el) {
    if (el._naBusy) return; el._naBusy = true;
    var id = el.dataset.id; var cur = el.dataset.value || '';
    var inp = document.createElement('input');
    inp.type = 'text'; inp.value = cur; inp.className = 'input';
    inp.placeholder = 'مثال: اتصال متابعة يوم الأحد';
    inp.style.cssText = 'width:100%;min-width:200px;font-size:12.5px;padding:.3rem .55rem';
    inp.setAttribute('aria-label', 'الخطوة التالية');
    el.replaceWith(inp); inp.focus(); inp.select();
    var done = false;
    var commit = async function (save) {
      if (done) return; done = true;
      var v = inp.value.trim();
      var finalVal = cur;
      if (save && v !== cur) {
        try { await api('/opportunities/' + id, 'PATCH', { next_action: v }); finalVal = v; toast('حُفظت الخطوة التالية ✓'); }
        catch (err) { toast(err.message, true); }
      }
      var span = document.createElement('span');
      span.className = 'editable'; span.dataset.action = 'na-edit'; span.dataset.id = id; span.dataset.value = finalVal;
      span.setAttribute('role', 'button'); span.tabIndex = 0; span.title = 'انقر لتعديل الخطوة التالية';
      if (finalVal) { span.style.cssText = 'font-size:12.5px;font-weight:700;color:var(--ink2)'; span.textContent = finalVal; }
      else { span.style.cssText = 'font-size:12.5px;color:var(--red);font-weight:700'; span.textContent = '● بلا خطوة تالية — انقر لإضافتها'; }
      inp.replaceWith(span);
    };
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    inp.addEventListener('blur', function () { commit(true); });
  }

  // ── حفظ العرض الحالي (اسم + معاملات الرابط الحالية) ──
  function viewSaveModal() {
    window.Sanad.openModal(
      '<div class="modal-head"><h3 style="font-size:16px">حفظ العرض الحالي</h3>' +
      '<button class="btn btn-ghost" data-action="modal-close">✕</button></div>' +
      '<div class="modal-body"><div class="field"><label>اسم العرض</label>' +
      '<input class="input" id="sv-name" maxlength="60" placeholder="مثال: فرص قطاع الحلول"></div>' +
      '<div style="font-size:11.5px;color:var(--muted);line-height:1.8">يُحفظ العرض بمرشحاته الحالية (القطاع والبحث) ويظهر شريحةً أعلى الصفحة لك وحدك.</div></div>' +
      '<div class="modal-foot"><button class="btn btn-primary" data-action="view-save-confirm">حفظ العرض</button>' +
      '<button class="btn" data-action="modal-close">إلغاء</button></div>');
    setTimeout(function () { var n = document.getElementById('sv-name'); if (n) n.focus(); }, 60);
  }
  async function viewSaveConfirm() {
    var name = (document.getElementById('sv-name') || { value: '' }).value.trim();
    if (!name) return toast('اسم العرض مطلوب', true);
    var params = {};
    new URLSearchParams(location.search).forEach(function (v, k) { params[k] = v; });
    var qEl = document.getElementById('opp-q');
    if (qEl && qEl.value.trim()) params.q = qEl.value.trim(); else delete params.q;
    try {
      await api('/views', 'POST', { page: S().viewsPage || 'opportunities', name_ar: name, params_json: params });
      window.Sanad.closeModal(); toast('حُفظ العرض ✓'); setTimeout(function () { location.reload(); }, 450);
    } catch (err) { toast(err.message, true); }
  }

  // ── نقل المرحلة مع سبب (صفحة التفاصيل) ──
  function stageMoveModal() {
    var s = S();
    var opts = (s.stages || []).map(function (st) {
      return '<option value="' + esc(st.id) + '"' + (st.id === s.currentStage ? ' selected' : '') + '>' + esc(st.name_ar) + '</option>';
    }).join('');
    window.Sanad.openModal(
      '<div class="modal-head"><h3 style="font-size:16px">نقل المرحلة</h3>' +
      '<button class="btn btn-ghost" data-action="modal-close">✕</button></div>' +
      '<div class="modal-body"><div class="field"><label>المرحلة الجديدة</label><select id="mv-stage">' + opts + '</select></div>' +
      '<div class="field"><label>سبب النقل (اختياري — يُحفظ في سجل المراحل)</label>' +
      '<textarea id="mv-note" class="input" rows="2" placeholder="مثال: العميل أكّد الميزانية وطلب العرض المالي"></textarea></div></div>' +
      '<div class="modal-foot"><button class="btn btn-primary" data-action="stage-confirm">نقل</button>' +
      '<button class="btn" data-action="modal-close">إلغاء</button></div>');
  }
  async function stageConfirm() {
    var s = S();
    var stage = (document.getElementById('mv-stage') || { value: '' }).value;
    var note = (document.getElementById('mv-note') || { value: '' }).value.trim();
    if (!stage) return;
    if (stage === s.currentStage) { window.Sanad.closeModal(); return; }
    try {
      await api('/opportunities/' + s.oppId + '/stage', 'POST', { stage: stage, note: note || null });
      window.Sanad.closeModal(); toast('نُقلت المرحلة ✓'); setTimeout(function () { location.reload(); }, 450);
    } catch (err) { toast(err.message, true); }
  }

  // ── فريق الفرصة ──
  async function teamAdd() {
    var emp = (document.getElementById('team-emp') || { value: '' }).value;
    var role = (document.getElementById('team-role') || { value: 'member' }).value;
    var pct = (document.getElementById('team-pct') || { value: '' }).value;
    // اسمٌ مكتوبٌ لا يطابق أحداً ليس اختياراً: نقول ذلك بدل إرسال طلبٍ يُرَدّ.
    if (!emp) {
      var typed = ((document.getElementById('team-emp-q') || { value: '' }).value || '').trim();
      return toast(typed ? 'لم أجد «' + typed + '» — اختر اسماً من القائمة' : 'ابحث عن الموظف بالاسم أولًا', true);
    }
    var body = { employee_id: emp, role_in_group: role };
    if (pct !== '') body.allocation_pct = Number(pct);
    try {
      await api('/opportunities/' + S().oppId + '/team', 'POST', body);
      toast('أُضيف العضو ✓'); setTimeout(function () { location.reload(); }, 450);
    } catch (err) { toast(err.message, true); }
  }
  async function teamRemove(mid) {
    try {
      await api('/opportunities/team/' + mid, 'DELETE');
      toast('أُزيل العضو ✓'); setTimeout(function () { location.reload(); }, 450);
    } catch (err) { toast(err.message, true); }
  }

  // ── التحكم بالفرصة: القطاع والإدارة والمسؤول والجهة والقيمة والسنة في حفظةٍ واحدة ──
  // حفظةٌ واحدة لا حفظةٌ لكل حقل: نقل القطاع واختيار إدارته الجديدة قرارٌ واحد، وتقسيمه على
  // نداءين يترك الفرصة بين النداءين في قطاعٍ جديد بإدارةٍ من القطاع القديم — وهو بالضبط
  // التناقض الذي يحرسه الخادم. والحقل الذي لم يتغيّر لا يُرسَل أصلاً.
  function ctlVal(id) { var n = document.getElementById(id); return n ? n.value : null; }
  async function oppControlSave(id) {
    var body = {
      title_ar: (ctlVal('oc-title') || '').trim(),
      client_id: ctlVal('oc-client') || null,
      sector_id: ctlVal('oc-sector') || null,
      department_id: ctlVal('oc-dept') || null,
      owner_user_id: ctlVal('oc-owner') || null,
      priority: ctlVal('oc-priority') || null,
      engagement_type: ctlVal('oc-engagement') || null,
      solicitation_type: ctlVal('oc-solicitation') || null,
      // الفراغ يُرسَل نصّاً فارغاً لا يُحذف من الحمولة: حذفُه يجعل «مسحتُ الموقع» و«لم أمسّه»
      // طلباً واحداً، فلا يُمحى ما كُتب خطأً أبداً. والخادم يترجم الفراغ إلى «لم يُحدَّد».
      delivery_location: ctlVal('oc-location') || '',
      // الإدارات المشاركة تُرسَل **كمجموعة كاملة** لا كإضافةٍ واحدة: ما في الشاشة هو الحقيقة
      // الجديدة، فرفعُ إدارةٍ يكون بإلغاء تحديدها لا بزرّ حذفٍ ثانٍ. ومصفوفةٌ فارغة تعني
      // «لا مشارك» — ولذلك تُرسَل دائماً ولا تُحذف من الحمولة عند الفراغ.
      partner_department_ids: (function () {
        var el = document.getElementById('oc-partners');
        if (!el) return undefined;
        return Array.prototype.slice.call(el.selectedOptions || []).map(function (o) { return o.value; });
      })(),
    };
    if (body.partner_department_ids === undefined) delete body.partner_department_ids;
    if (!body.title_ar) { toast('اسم الفرصة لا يكون فارغاً', true); return; }
    // المبلغ يُكتب كما اقتبسته الجهة — شاملاً الضريبة أو بدونها — والخادم يحوّله قبل الحفظ.
    // الحساب هناك لا هنا: المخزَّن يبقى إجمالياً بقاعدةٍ واحدة، فلا يصير للمبلغ تفسيران.
    var v = ctlVal('oc-value');
    if (v !== null && v !== '') {
      body.value_sar = Number(v);
      body.value_vat_included = ctlVal('oc-vat') !== '0';
    }
    var w = ctlVal('oc-win'); if (w !== null && w !== '') body.win_pct = Number(w);
    var y = ctlVal('oc-year'); if (y !== null && y !== '') body.year = Number(y);
    try {
      var r = await api('/opportunities/' + encodeURIComponent(id), 'PATCH', body);
      // نقلُها إلى إدارةٍ أو قطاعٍ خارج نطاق الناقل يُخرجها من متناوله — وهو مقصود. لكن إعادة
      // تحميل صفحتها حينئذٍ تفتح شاشة «ممنوع» على عملٍ نجح، فيظنّ أن النقل فشل. نعيده إلى
      // القائمة برسالةٍ تقول ما جرى بالضبط.
      if (r && r.movedOutOfReach) {
        toast('نُقلت الفرصة ✓ — وصارت خارج نطاقك فلم تعد تظهر لك');
        setTimeout(function () { location.href = '/app/opportunities'; }, 900);
        return;
      }
      toast('حُفظت التعديلات ✓'); setTimeout(function () { location.reload(); }, 500);
    } catch (err) { toast(err.message, true); }
  }
  // قائمة الإدارات تتبع القطاع المختار في نفس اللحظة — فلا تُعرض على المالك إدارةٌ يرفضها
  // الخادم بعد الحفظ. وإدارةُ القطاع القديم تُرفَع من الاختيار حين يتغيّر القطاع تحتها.
  function syncDeptOptions() {
    var sec = document.getElementById('oc-sector');
    var dep = document.getElementById('oc-dept');
    if (!sec || !dep) return;
    var chosen = sec.value;
    var keep = true;
    Array.prototype.forEach.call(dep.options, function (o) {
      if (!o.value) return;
      var fits = !o.dataset.sector || o.dataset.sector === chosen;
      o.hidden = !fits; o.disabled = !fits;
      if (o.selected && !fits) keep = false;
    });
    if (!keep) dep.value = '';
  }

  // ── تسجيل تحديث على الفرصة ──
  // الملاحظات تُرسَل في `detail` — العمود موجود في الجدول منذ أول يوم ولم يكن للنموذج متّسعٌ
  // يكتبه، فمن أراد تدوين خلاصة اجتماع حشرها في العنوان أو تركها خارج المنصة.
  async function actAdd() {
    var kind = (document.getElementById('act-kind') || { value: 'note' }).value;
    var title = (document.getElementById('act-title') || { value: '' }).value.trim();
    var detail = (document.getElementById('act-detail') || { value: '' }).value.trim();
    if (!title) return toast('اكتب ما حدث أولًا', true);
    try {
      await api('/activities', 'POST', { kind: kind, title: title, detail: detail || null, opportunity_id: S().oppId });
      toast('سُجّل التحديث ✓'); setTimeout(function () { location.reload(); }, 450);
    } catch (err) { toast(err.message, true); }
  }

  // ── مستندات الفرصة وروابطها ──
  async function oppDocAdd(oppId) {
    var name = (document.getElementById('doc-name') || { value: '' }).value.trim();
    var url = (document.getElementById('doc-url') || { value: '' }).value.trim();
    var kind = (document.getElementById('doc-kind') || { value: 'other' }).value;
    if (!name) return toast('اكتب اسم المستند أولًا', true);
    if (!url) return toast('ضع رابط المستند — المنصة تحفظ رابطه لا نسخةً منه', true);
    try {
      await api('/opportunities/' + encodeURIComponent(oppId) + '/documents', 'POST',
        { name: name, url: url, kind: kind });
      toast('أُضيف المستند ✓'); setTimeout(function () { location.reload(); }, 450);
    } catch (err) { toast(err.message, true); }
  }
  async function oppDocDel(docId) {
    if (!window.confirm('إزالة هذا المستند من الفرصة؟')) return;
    try {
      await api('/opportunities/documents/' + encodeURIComponent(docId), 'DELETE');
      toast('أُزيل المستند ✓'); setTimeout(function () { location.reload(); }, 450);
    } catch (err) { toast(err.message, true); }
  }

  // ── قائمة إجراءات البطاقة (زرّ «⋯»): نقل إلى فائزة / مفقودة / قطاع آخر ──
  // نافذة خفيفة تتفادى قصّ العمود ذي التمرير؛ كل الأزرار بتفويض data-action.
  function actionBtn(action, data, tone, dot, label) {
    return '<button class="btn" data-action="' + action + '" ' + data +
      ' style="justify-content:flex-start;width:100%;' + (tone || '') + '">' +
      (dot ? '<span style="width:9px;height:9px;border-radius:50%;background:' + dot + ';display:inline-block;flex:none"></span>' : '') +
      label + '</button>';
  }
  function oppMenuModal(el) {
    var s = S();
    var id = el.dataset.id, title = el.dataset.title || '', sector = el.dataset.sector || '';
    // النقل للمحرّرين وحدهم — الزرّ قد يظهر الآن لمن يملك السحب فقط (منشئ الفرصة)، فلا تُعرض
    // له أزرارُ نقلٍ يردّها الخادم. والسحب بإشارة الخادم على البطاقة نفسها (data-candel).
    var canEdit = !!s.canEditOpp;
    var candel = el.dataset.candel === '1';
    var others = (s.moveSectors || []).filter(function (x) { return x.id !== sector; });
    var won = canEdit && s.wonStage ? actionBtn('opp-won', 'data-id="' + esc(id) + '"', 'border-color:#bbf7d0;color:#166534;background:#f0fdf4', '#059669', 'نقل إلى فائزة') : '';
    var lost = canEdit && s.lostStage ? actionBtn('opp-lost', 'data-id="' + esc(id) + '"', 'border-color:#fecaca;color:#991b1b;background:#fef2f2', '#dc2626', 'نقل إلى مفقودة') : '';
    var sec = canEdit && others.length ? actionBtn('opp-move-sector', 'data-id="' + esc(id) + '" data-sector="' + esc(sector) + '"', '', '', '↔ نقل لقطاع آخر') : '';
    var rm = candel ? actionBtn('opp-remove', 'data-id="' + esc(id) + '"', 'border-color:#fecaca;color:#b91c1c;background:#fff', '#dc2626', 'سحب الفرصة…') : '';
    window.Sanad.openModal(
      '<div class="modal-head"><div style="min-width:0"><div style="font-size:11px;color:var(--muted);font-weight:700">إجراء سريع على الفرصة</div>' +
      '<h3 style="font-size:15px;margin-top:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:330px">' + esc(title) + '</h3></div>' +
      '<button class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body" style="gap:.5rem">' + won + lost + sec + rm + '</div>');
  }
  async function oppWon(id) {
    var s = S(); if (!s.wonStage) return;
    try {
      await api('/opportunities/' + id + '/stage', 'POST', { stage: s.wonStage, note: 'نُقلت إلى فائزة من اللوحة' });
      window.Sanad.closeModal(); toast('نُقلت إلى فائزة ✓'); setTimeout(function () { location.reload(); }, 450);
    } catch (err) { toast(err.message, true); }
  }
  function oppLostModal(id) {
    window.Sanad.openModal(
      '<div class="modal-head"><h3 style="font-size:16px">نقل إلى مفقودة</h3>' +
      '<button class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body"><div class="field"><label>سبب الفقدان (اختياري — يُحفظ في سجل المراحل)</label>' +
      '<textarea id="lost-note" class="input" rows="3" placeholder="مثال: تُرسيت المنافسة لجهة أخرى بسعر أقل"></textarea></div>' +
      '<div style="font-size:11.5px;color:var(--muted);line-height:1.7">توثيق السبب يساعد على تحسين العروض القادمة.</div></div>' +
      '<div class="modal-foot"><button class="btn btn-primary" data-action="opp-lost-confirm" data-id="' + esc(id) + '">تأكيد الفقدان</button>' +
      '<button class="btn" data-action="modal-close">إلغاء</button></div>');
    setTimeout(function () { var n = document.getElementById('lost-note'); if (n) n.focus(); }, 60);
  }
  async function oppLostConfirm(id) {
    var s = S(); if (!s.lostStage) return;
    var note = (document.getElementById('lost-note') || { value: '' }).value.trim();
    try {
      await api('/opportunities/' + id + '/stage', 'POST', { stage: s.lostStage, note: note || null });
      window.Sanad.closeModal(); toast('نُقلت إلى مفقودة ✓'); setTimeout(function () { location.reload(); }, 450);
    } catch (err) { toast(err.message, true); }
  }
  function oppSectorModal(id, current) {
    var others = (S().moveSectors || []).filter(function (x) { return x.id !== current; });
    if (!others.length) { toast('لا يوجد قطاع آخر ضمن صلاحيتك', true); return; }
    var opts = others.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name_ar) + '</option>'; }).join('');
    window.Sanad.openModal(
      '<div class="modal-head"><h3 style="font-size:16px">نقل إلى قطاع آخر</h3>' +
      '<button class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body"><div class="field"><label>القطاع الجديد</label><select id="mv-sector">' + opts + '</select></div>' +
      '<div class="field"><label>سبب النقل (اختياري)</label><textarea id="mv-sec-note" class="input" rows="2" placeholder="مثال: الفرصة أنسب لخبرة القطاع الآخر"></textarea></div>' +
      '<div style="font-size:11.5px;color:var(--muted);line-height:1.7">تنتقل الفرصة بكامل بياناتها إلى القطاع الجديد ويُوثَّق النقل.</div></div>' +
      '<div class="modal-foot"><button class="btn btn-primary" data-action="opp-sector-confirm" data-id="' + esc(id) + '">نقل الفرصة</button>' +
      '<button class="btn" data-action="modal-close">إلغاء</button></div>');
  }
  async function oppSectorConfirm(id) {
    var sector = (document.getElementById('mv-sector') || { value: '' }).value;
    var note = (document.getElementById('mv-sec-note') || { value: '' }).value.trim();
    if (!sector) return;
    try {
      // النجاح = رمز 200 (الخادم قد يعيد تأكيداً مختصراً لا كائن الفرصة) → تنبيه + إعادة تحميل اللوحة
      await api('/opportunities/' + id + '/sector', 'POST', { sector: sector, note: note || null });
      window.Sanad.closeModal(); toast('نُقلت إلى القطاع الجديد ✓'); setTimeout(function () { location.reload(); }, 450);
    } catch (err) { toast(err.message, true); }
  }

  // ── سحب الفرصة: العاقبة تُعرض قبل الضغط، والسبب مطلوب ويُسجَّل في الأثر ──
  // على نمط فحص حذف الحساب (pages/identity.js): تُقرأ الموانع وما سيُسحب تبعاً من الخادم
  // أولاً — فمن يضغط «سحب» يعرف أن معه مستندَين ومهمة، لا أن «شيئاً ما» سيختفي.
  async function oppRemoveModal(id) {
    var chk;
    try { chk = await api('/opportunities/' + encodeURIComponent(id) + '/removal-check'); }
    catch (err) { toast(err.message, true); return; }
    var blockers = chk.blockers || [];
    var body, foot;
    if (blockers.length) {
      body = '<div style="font-size:12.5px;line-height:1.9;color:#b91c1c"><b>لا يمكن سحب هذه الفرصة الآن:</b>' +
        '<ul style="margin:.35rem 0 0;padding-inline-start:1.1rem">' +
        blockers.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>' +
        '<div style="font-size:12px;color:var(--muted);line-height:1.8;margin-top:.5rem">' +
        'انقل إلى مفقودة بدل السحب — السجل يبقى.</div>';
      foot = '<button class="btn" data-action="modal-close">إغلاق</button>';
    } else {
      var parts = (chk.cascades || []).filter(function (c) { return Number(c.count) > 0; })
        .map(function (c) { return '<b class="tnum">' + Number(c.count) + '</b> ' + esc(c.label); });
      body = (parts.length
        ? '<div style="font-size:12.5px;color:var(--ink2);line-height:1.9">سيُسحب معها: ' + parts.join('، ') + '.</div>'
        : '<div style="font-size:12.5px;color:var(--muted);line-height:1.9">لا يتبعها شيء — تُسحب وحدها.</div>') +
        '<div style="font-size:11.5px;color:var(--faint);line-height:1.7;margin-top:.3rem">سجل مراحلها يبقى في الأثر.</div>' +
        '<div class="field" style="margin-top:.6rem"><label>سبب السحب — يُسجَّل في الأثر</label>' +
        '<textarea id="opp-rm-reason" class="input" rows="2" placeholder="مثال: فرصة مكررة أُدخلت مرتين"></textarea>' +
        '<div id="opp-rm-err" style="display:none;font-size:11.5px;color:#b91c1c;margin-top:.25rem"></div></div>';
      foot = '<button class="btn btn-primary" data-action="opp-remove-go" data-id="' + esc(id) + '" style="background:#b91c1c">سحب الفرصة</button>' +
        '<button class="btn" data-action="modal-close">إلغاء</button>';
    }
    window.Sanad.openModal(
      '<div class="modal-head"><h3 style="font-size:16px">سحب الفرصة</h3>' +
      '<button class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body">' + body + '</div>' +
      '<div class="modal-foot">' + foot + '</div>');
    setTimeout(function () { var n = document.getElementById('opp-rm-reason'); if (n) n.focus(); }, 60);
  }
  async function oppRemoveGo(btn) {
    var box = document.getElementById('opp-rm-reason');
    var err = document.getElementById('opp-rm-err');
    var reason = ((box && box.value) || '').trim();
    // السبب شرطٌ لا زينة — والخطأ يُقال في مكانه لا بتنبيه المتصفح
    if (!reason) {
      if (err) { err.textContent = 'اكتب سبب السحب أولاً — يُسجَّل في الأثر'; err.style.display = 'block'; }
      if (box) box.focus();
      return;
    }
    btn.disabled = true;
    try {
      await api('/opportunities/' + encodeURIComponent(btn.dataset.id), 'DELETE', { reason: reason });
      window.Sanad.closeModal();
      toast('سُحبت الفرصة — والسبب مسجَّل');
      setTimeout(function () {
        // من صفحة الفرصة نعود إلى القائمة (صفحتها لم تعد موجودة)؛ ومن القائمة يكفي التحديث
        if (location.pathname.indexOf('/app/opportunity/') === 0) location.href = '/app/opportunities';
        else location.reload();
      }, 600);
    } catch (e2) { btn.disabled = false; toast(e2.message, true); }
  }

  // ── إنشاء المشروع من فرصة فائزة ──
  // الربط مرجع لا نسخة: نرسل معرّف الفرصة فيرث المشروع عميلها ويُكتب الرابط، وقيمة العقد تُدخَل
  // هنا لأنها رقم آخر (ما وُقِّع) غير قيمة الفرصة (ما عُرِض) — نسخها يخلق رقماً يُحتسب مرتين.
  function oppProjectModal(oppId, name, sector) {
    window.Sanad.openModal(
      '<div class="modal-head"><div style="min-width:0"><div style="font-size:11px;color:var(--muted);font-weight:700">إنشاء مشروع من فرصة فائزة</div>' +
      '<h3 style="font-size:15px;margin-top:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:330px">' + esc(name) + '</h3></div>' +
      '<button class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body">' +
      '<div class="field"><label>اسم المشروع *</label><input class="input" id="op-name" value="' + esc(name) + '"></div>' +
      '<div class="field"><label>قيمة العقد الموقَّع (ر.س.)</label><input class="input" id="op-val" type="number" min="0" value="0">' +
      '<div style="font-size:11px;color:var(--muted);margin-top:.3rem;line-height:1.7">قيمة العقد غير قيمة الفرصة: الأولى ما وُقِّع والثانية ما عُرِض. تُدخَل هنا حتى لا يتكرر الرقم في المبيعات وفي المحفظة معاً.</div></div>' +
      '<div class="grid2">' +
      '<div class="field"><label>تاريخ البدء</label><input class="input" id="op-start" type="date"></div>' +
      '<div class="field"><label>تاريخ الانتهاء</label><input class="input" id="op-end" type="date"></div>' +
      '</div>' +
      '<div style="font-size:11.5px;color:var(--muted);line-height:1.7">يرث المشروع عميل الفرصة وقطاعها، ويُربط بها فتظهر في «المشروع الناتج».</div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn btn-primary" data-action="opp-project-confirm" data-id="' + esc(oppId) + '" data-sector="' + esc(sector || '') + '">أنشئ المشروع</button>' +
      '<button class="btn" data-action="modal-close">إلغاء</button></div>');
    setTimeout(function () { var n = document.getElementById('op-name'); if (n) n.focus(); }, 60);
  }
  async function oppProjectConfirm(btn) {
    var name = (document.getElementById('op-name') || { value: '' }).value.trim();
    if (!name) return toast('اسم المشروع مطلوب', true);
    var body = {
      name_ar: name, source_opp_id: btn.dataset.id,
      value_sar: Number((document.getElementById('op-val') || { value: 0 }).value) || 0,
      start_date: (document.getElementById('op-start') || { value: '' }).value || null,
      end_date: (document.getElementById('op-end') || { value: '' }).value || null,
      status: 'IN_PROGRESS',
    };
    if (btn.dataset.sector) body.sector_id = btn.dataset.sector;
    btn.disabled = true;
    try {
      var r = await api('/intake/create', 'POST', body);
      window.Sanad.closeModal(); toast('أُنشئ المشروع ورُبط بالفرصة ✓');
      setTimeout(function () { location.href = '/app/project/' + r.project_id; }, 500);
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  }

  // ── المعاينة السريعة (v5.24): drawer يقرأ حمولة التفاصيل القائمة نفسها ──
  // النقرة على بطاقة أو صف لا تنقل فوراً إلى صفحة كاملة: تعرض الخلاصة في مكانها، ومنها
  // يقرر القارئ الفتح أو النقل أو التواصل. الحمولة من `GET /opportunities/:id/detail`
  // القائم — لا مسار جديد ولا رقم يُحسب في الواجهة إلا ما يعرضه الخادم أصلاً.
  var PREVIEW = null; // آخر حمولة معاينة — يستعملها زرا نقل المرحلة والفتح
  function daysStamp(n) {
    n = Math.max(0, Math.round(Number(n) || 0));
    if (n === 0) return 'اليوم';
    if (n === 1) return 'مضى يوم';
    if (n === 2) return 'مضى يومان';
    if (n <= 10) return 'مضى ' + n + ' أيام';
    return 'مضى ' + n + ' يوماً';
  }
  function stagePill(st, fallbackId) {
    if (!st) return esc(fallbackId || '—');
    var c = /^#[0-9a-fA-F]{6}$/.test(st.color || '') ? st.color : '#475569';
    return '<span style="display:inline-block;padding:.14rem .6rem;border-radius:999px;font-size:11.5px;font-weight:800;background:' + c + '1a;color:' + c + '">' + esc(st.name_ar) + '</span>';
  }
  async function oppPreview(id) {
    if (!window.Sanad || !window.Sanad.openDrawer) return;
    var d;
    try { d = await api('/opportunities/' + encodeURIComponent(id) + '/detail'); }
    catch (err) { toast(err.message, true); return; }
    PREVIEW = d;
    var o = d.opp || {};
    var fmtSar = function (h) { return window.Sanad.fmtSar ? window.Sanad.fmtSar(h) : String(Math.round((h || 0) / 100)); };
    var row = function (label, valueHtml) {
      return '<div class="kv-row"><span class="k">' + label + '</span><span class="v">' + valueHtml + '</span></div>';
    };
    var st = (d.stages || []).filter(function (s) { return s.id === o.stage_id; })[0];
    // «صحة الفرصة» = إشارتا الانضباط القائمتان لا معادلة جديدة (خريطة التنفيذ §7).
    var health = d.rot ? ['متوقفة — حرّكها', 'var(--red)']
      : (d.no_next_action ? ['بلا خطوة تالية', 'var(--amber)'] : ['على المسار', 'var(--green)']);
    var la = (d.activities || [])[0];
    var laDays = la && la.at ? Math.floor((Date.now() - Date.parse(la.at)) / 86400000) : null;
    var laHtml = la
      ? '<span class="tnum">' + esc((la.at || '').slice(0, 10)) + '</span>' +
        (laDays != null && isFinite(laDays) ? ' <span style="color:var(--muted);font-size:11px">· ' + esc(daysStamp(laDays)) + '</span>' : '')
      : '<span style="color:var(--faint)">لا نشاط مسجّل بعد</span>';
    var ownerHtml = d.owner
      ? '<span style="display:inline-flex;align-items:center;gap:.4rem">' + esc(d.owner) +
        '<span aria-hidden="true" style="width:22px;height:22px;border-radius:50%;background:var(--brand);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex:none">' + esc(String(d.owner).trim().slice(0, 1)) + '</span></span>'
      : '<span style="color:var(--faint)">غير مُسندة</span>';
    // حالة القائمة تُحمَل مع كل الروابط — يعود القارئ إلى قائمته كما تركها (نفس عقد open-opp).
    var q = location.search.replace(/^\?/, '');
    var from = q ? 'from=' + encodeURIComponent(q) : '';
    var href = function (extra) {
      var parts = [from, extra].filter(Boolean).join('&');
      return '/app/opportunity/' + encodeURIComponent(o.id) + (parts ? '?' + parts : '');
    };
    window.Sanad.openDrawer(
      '<div class="drawer-head"><div style="flex:1;min-width:0">' +
      '<div style="font-size:11px;color:var(--muted);font-weight:700">معاينة سريعة' + (o.code ? ' · <span class="tnum">' + esc(o.code) + '</span>' : '') + '</div>' +
      '<h3 style="font-size:17px;margin-top:.25rem;line-height:1.5">' + esc(o.title_ar || '') + '</h3></div>' +
      '<button class="btn btn-ghost" data-action="drawer-close" aria-label="إغلاق المعاينة">✕</button></div>' +
      '<div class="drawer-body">' +
      row('العميل', d.client ? esc(d.client) : '<span style="color:var(--faint)">بلا عميل</span>') +
      row('المرحلة الحالية', stagePill(st, o.stage_id)) +
      row('إجمالي القيمة', '<span class="tnum">' + fmtSar(o.value_halalas) + '</span>') +
            row('احتمال الفوز', '<span class="tnum" style="font-weight:800;color:' + ((o.win_pct || 0) >= 60 ? 'var(--green)' : (o.win_pct || 0) >= 30 ? 'var(--amber)' : 'var(--ink2)') + '">' + Math.round(o.win_pct || 0) + '%</span>') +
      row('المالك', ownerHtml) +
      row('آخر نشاط', laHtml) +
      row('عمر المرحلة', '<span class="tnum">' + esc(daysStamp(d.stage_age_days)) + '</span>') +
      row('الخطوة التالية', o.next_action ? esc(o.next_action) : '<span style="color:var(--red);font-weight:700">لم تُحدَّد</span>') +
      row('صحة الفرصة', '<span style="display:inline-block;padding:.14rem .6rem;border-radius:999px;font-size:11.5px;font-weight:800;color:#fff;background:' + health[1] + '">' + health[0] + '</span>') +
      '</div>' +
      '<div class="drawer-foot" style="flex-wrap:wrap;gap:.4rem">' +
      '<a class="btn btn-primary" href="' + href(d.canEdit ? '' : '') + '">فتح الفرصة ↗</a>' +
      (d.canEdit ? '<a class="btn" href="' + href('edit=1') + '">تعديل</a>' : '') +
      (d.canEdit ? '<button class="btn" data-action="drawer-stage-open">نقل المرحلة</button>' : '') +
      '<a class="btn" href="' + href('tab=activity') + '">إضافة تواصل</a>' +
      '</div>');
  }
  // نقل المرحلة من المعاينة: نفس نافذة صفحة التفاصيل ونفس مسار الحفظ — تُغذَّى حالتها
  // من حمولة المعاينة لأن صفحة القائمة لا تحمل بيانات فرصة بعينها.
  function drawerStageOpen() {
    if (!PREVIEW || !PREVIEW.opp) return;
    var s = S();
    s.oppId = PREVIEW.opp.id; s.currentStage = PREVIEW.opp.stage_id; s.stages = PREVIEW.stages || [];
    window.__SANAD = s;
    window.Sanad.closeDrawer();
    stageMoveModal();
  }

  // ── تبويبات صفحة التفاصيل (v5.24): الألواح كلها مُصيَّرة من الخادم، والتبديل عرضٌ فقط ──
  function oppTab(btn) {
    var tab = btn.dataset.tab; if (!tab) return;
    document.querySelectorAll('[data-action="opp-tab"]').forEach(function (b) {
      var on = b === btn;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.classList.toggle('on', on);
      b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('[id^="opp-panel-"]').forEach(function (p) {
      p.hidden = p.id !== 'opp-panel-' + tab;
    });
    // التبويب يبقى في الرابط — إعادة التحميل بعد حفظٍ تعيد القارئ إلى حيث كان.
    try {
      var u = new URL(location.href); u.searchParams.set('tab', tab);
      history.replaceState(null, '', u.pathname + u.search);
    } catch (e) { /* المتصفحات القديمة: التبديل يعمل والرابط لا يتحدّث */ }
  }

  // ── نافذتا التعديل والفريق: من القالبين الخاملين المُصيَّرين خادمياً ──
  function oppEditOpen() {
    var tpl = document.getElementById('opp-edit-tpl'); if (!tpl || !window.Sanad) return;
    // إطارٌ قياسي: ترويسة + جسم يتمرّر + تذييلٌ ثابت فيه الحفظ — كان زرّ الحفظ في آخر
    // النموذج الطويل فلا يُرى (ملاحظة المالك «ما في حفظ للتعديلات»).
    window.Sanad.openModal(
      '<div class="modal-head"><h3 style="font-size:16px">تعديل الفرصة</h3>' +
      '<button class="btn btn-ghost" data-action="modal-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body" style="display:block">' + tpl.innerHTML + '</div>' +
      '<div class="modal-foot"><button class="btn btn-primary" data-action="opp-control-save" data-id="' + esc(S().oppId || '') + '">حفظ التعديلات</button>' +
      '<button class="btn" data-action="modal-close">إلغاء</button></div>');
    setTimeout(function () {
      // زرّ الحفظ الداخلي (بقي في القالب لعقود الاختبارات) يُخفى — الحفظ من التذييل الثابت.
      var inner = document.querySelector('#modal .modal-body [data-action="opp-control-save"]');
      if (inner && inner.parentElement) inner.parentElement.style.display = 'none';
      syncDeptOptions(); vatPreview(); partnersSync();
    }, 30);
  }

  // ── الإدارات المشاركة: منسدلة بصناديق اختيار تُزامن select الخفي (oc-partners) ──
  function partnersSync() {
    var sel = document.getElementById('oc-partners');
    var label = document.getElementById('oc-partners-label');
    if (!sel) return;
    var names = [];
    document.querySelectorAll('[data-partner-opt]').forEach(function (cb) {
      var o = sel.querySelector('option[value="' + cb.value.replace(/"/g, '\\"') + '"]');
      if (o) o.selected = cb.checked;
      if (cb.checked) names.push((cb.parentElement.textContent || '').trim());
    });
    if (label) label.textContent = names.length ? names.join('، ') : 'بلا إدارات مشاركة';
  }
  document.addEventListener('change', function (e) {
    if (e.target && e.target.matches && e.target.matches('[data-partner-opt]')) partnersSync();
  });
  function teamModalOpen() {
    var tpl = document.getElementById('opp-team-tpl'); if (!tpl || !window.Sanad) return;
    // القالب هو النموذج حرفياً (بمعرّفاته المثبَّتة) — والإطار هنا: عنوانٌ وإغلاق وجسم.
    window.Sanad.openModal(
      '<div class="modal-head"><h3 style="font-size:16px">إضافة عضو لفريق الفرصة</h3>' +
      '<button class="btn btn-ghost" data-action="modal-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body">' + tpl.innerHTML +
      '<div style="font-size:11.5px;color:var(--muted);line-height:1.8;margin-top:.5rem">موظف من إدارة أخرى يُضاف بحالة «بانتظار تأكيد مديره» حتى يوافق مديره من صندوق الاعتمادات.</div></div>');
    setTimeout(loadRoster, 30);
  }

  // ── ترتيب أعمدة الجدول التقريري: نقرة على رأس عمود يحمل data-sort — رقمي/تاريخي إن أمكن
  // (data-v على كل خلية) وإلا نصي محلي، مع عكس الاتجاه عند النقر المتكرر (نفس نمط جدول المشاريع). ──
  function sortOppTable(thEl) {
    var table = thEl.closest('table'); var tbody = table && table.querySelector('tbody'); if (!tbody) return;
    var idx = thEl.cellIndex;
    var dir = thEl.dataset.dir === 'asc' ? 'desc' : 'asc';
    table.querySelectorAll('th[data-sort]').forEach(function (h) { delete h.dataset.dir; });
    thEl.dataset.dir = dir;
    var rows = [...tbody.querySelectorAll('tr')];
    var val = function (tr) { var td = tr.children[idx]; return td ? (td.dataset.v != null ? td.dataset.v : td.textContent.trim()) : ''; };
    var numeric = rows.every(function (r) { var v = val(r); return v === '' || !isNaN(Number(v)); });
    rows.sort(function (a, b) {
      var x = val(a), y = val(b);
      var c = numeric ? (Number(x) || 0) - (Number(y) || 0) : String(x).localeCompare(String(y), 'ar');
      return dir === 'asc' ? c : -c;
    });
    rows.forEach(function (r) { tbody.appendChild(r); });
  }

  // ── تفويض النقر ──
  document.addEventListener('click', function (e) {
    var pmenu = document.getElementById('oc-partners-menu');
    if (pmenu && !pmenu.hidden && !e.target.closest('#oc-partners-pick')) {
      pmenu.hidden = true;
      var pbtn = document.querySelector('[data-action="partners-toggle"]');
      if (pbtn) pbtn.setAttribute('aria-expanded', 'false');
    }
    var sortTh = e.target.closest('#opp-table th[data-sort]');
    if (sortTh) { sortOppTable(sortTh); return; }
    var actEl = e.target.closest('[data-action]');
    if (actEl) {
      var act = actEl.dataset.action;
      if (act === 'open-opp') {
        if (e.target.closest('a,button,select,input')) return; // لا تخطف روابط/أزرار داخلية
        // حالةُ القائمة تُحمَل معه كي يعود إليها كما تركها — لا إلى قائمةٍ بلا مُرشِّحات.
        var st = location.search.replace(/^\?/, '');
        location.href = '/app/opportunity/' + actEl.dataset.id + (st ? '?from=' + encodeURIComponent(st) : '');
        return;
      }
      if (act === 'opp-preview') {
        if (e.target.closest('a,button,select,input')) return; // لا تخطف روابط/أزرار داخل البطاقة
        oppPreview(actEl.dataset.id);
        return;
      }
      if (act === 'drawer-close') { if (window.Sanad) window.Sanad.closeDrawer(); return; }
      if (act === 'drawer-stage-open') { drawerStageOpen(); return; }
      if (act === 'opp-tab') { oppTab(actEl); return; }
      if (act === 'opp-edit-open') { oppEditOpen(); return; }
      if (act === 'partners-toggle') {
        var menu = document.getElementById('oc-partners-menu');
        if (menu) { menu.hidden = !menu.hidden; actEl.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true'); }
        return;
      }
      if (act === 'team-modal-open') { teamModalOpen(); return; }
      if (act === 'opp-add') { if (window.Sanad) window.Sanad.oppAdd(); return; }
      if (act === 'modal-close') { window.Sanad.closeModal(); return; }
      if (act === 'view-save') { viewSaveModal(); return; }
      if (act === 'view-save-confirm') { viewSaveConfirm(); return; }
      if (act === 'view-del') {
        api('/views/' + actEl.dataset.id, 'DELETE')
          .then(function () { toast('حُذف العرض'); setTimeout(function () { location.reload(); }, 400); })
          .catch(function (err) { toast(err.message, true); });
        return;
      }
      if (act === 'view-default') {
        api('/views/' + actEl.dataset.id + '/default', 'POST')
          .then(function () { toast('أصبح العرض الافتراضي ✓'); setTimeout(function () { location.reload(); }, 400); })
          .catch(function (err) { toast(err.message, true); });
        return;
      }
      if (act === 'opp-make-project') { oppProjectModal(actEl.dataset.opp, actEl.dataset.name, actEl.dataset.sector); return; }
      if (act === 'opp-project-confirm') { oppProjectConfirm(actEl); return; }
      if (act === 'na-edit') { naEdit(actEl); return; }
      if (act === 'stage-info') { // نافذة «شرح المرحلة» — قالب خامل مُصيّر من الخادم
        var tpl = document.getElementById('stage-info-' + actEl.dataset.stage);
        if (tpl && window.Sanad) window.Sanad.openModal(tpl.innerHTML);
        return;
      }
      if (act === 'stage-open') { stageMoveModal(); return; }
      if (act === 'stage-confirm') { stageConfirm(); return; }
      if (act === 'team-add') { teamAdd(); return; }
      if (act === 'team-remove') { teamRemove(actEl.dataset.id); return; }
      if (act === 'act-add') { actAdd(); return; }
      if (act === 'opp-menu') { oppMenuModal(actEl); return; }
      if (act === 'opp-remove') { oppRemoveModal(actEl.dataset.id); return; }
      if (act === 'opp-remove-go') { oppRemoveGo(actEl); return; }
      if (act === 'opp-won') { oppWon(actEl.dataset.id); return; }
      if (act === 'opp-lost') { oppLostModal(actEl.dataset.id); return; }
      if (act === 'opp-lost-confirm') { oppLostConfirm(actEl.dataset.id); return; }
      if (act === 'opp-move-sector') { oppSectorModal(actEl.dataset.id, actEl.dataset.sector || ''); return; }
      if (act === 'opp-sector-confirm') { oppSectorConfirm(actEl.dataset.id); return; }
      if (act === 'opp-control-save') { oppControlSave(actEl.dataset.id); return; }
      if (act === 'opp-doc-add') { oppDocAdd(actEl.dataset.id); return; }
      if (act === 'opp-doc-del') { oppDocDel(actEl.dataset.id); return; }
      return;
    }
    var dd = e.target.closest('[data-dd]');
    if (dd && window.Sanad) window.Sanad.openDD(dd.dataset.dd);
  });

  // ── لوحة المفاتيح: البطاقات والبلاطات ورؤوس الترتيب تعمل بـ Enter ──
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (t.matches && t.matches('[data-action="open-opp"],[data-action="opp-preview"],[data-dd],[data-action="na-edit"],#opp-table th[data-sort]')) { e.preventDefault(); t.click(); }
  });

  // (الإفلات على عمودَي الحسم الملخّصين يتولاه Sanad.kDrop نفسه: يحفظ ثم يعيد التحميل فوراً)

  // ── نقل مرحلة سريع من قائمة «فرصي» ──
  document.addEventListener('change', function (e) {
    var sel = e.target.closest('[data-stage-move]'); if (!sel) return;
    var id = sel.dataset.id; var stage = sel.value;
    api('/opportunities/' + id + '/stage', 'POST', { stage: stage })
      .then(function () { toast('نُقلت المرحلة ✓'); setTimeout(function () { location.reload(); }, 450); })
      .catch(function (err) { toast(err.message, true); setTimeout(function () { location.reload(); }, 700); });
  });
})();
