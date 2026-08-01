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

  // ── قائمة الموظفين لنموذج إضافة عضو الفريق (صفحة تفاصيل الفرصة) ──
  async function loadRoster() {
    var sel = document.querySelector('select[data-roster]'); if (!sel) return;
    try {
      var r = await api('/org/roster');
      var opts = (r.roster || []).filter(function (e) { return e.active !== 0; }).map(function (e) {
        return '<option value="' + esc(e.id) + '">' + esc(e.name_ar) + (e.job_title ? ' · ' + esc(e.job_title) : '') + '</option>';
      });
      sel.innerHTML = opts.length ? '<option value="">اختر موظفًا…</option>' + opts.join('')
        : '<option value="">لا موظفون متاحون</option>';
    } catch (err) {
      sel.innerHTML = '<option value="">تعذّر جلب الأسماء — أعد المحاولة</option>';
    }
  }
  function init() {
    var q = new URLSearchParams(location.search).get('q');
    var el = document.getElementById('opp-q');
    if (q && el) { el.value = q; filterCards(); }
    loadRoster();
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
    if (!emp) return toast('اختر الموظف أولًا', true);
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

  // ── تسجيل تواصل ──
  async function actAdd() {
    var kind = (document.getElementById('act-kind') || { value: 'note' }).value;
    var title = (document.getElementById('act-title') || { value: '' }).value.trim();
    if (!title) return toast('اكتب ما حدث أولًا', true);
    try {
      await api('/activities', 'POST', { kind: kind, title: title, opportunity_id: S().oppId });
      toast('سُجّل التواصل ✓'); setTimeout(function () { location.reload(); }, 450);
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
    var others = (s.moveSectors || []).filter(function (x) { return x.id !== sector; });
    var won = s.wonStage ? actionBtn('opp-won', 'data-id="' + esc(id) + '"', 'border-color:#bbf7d0;color:#166534;background:#f0fdf4', '#059669', 'نقل إلى فائزة') : '';
    var lost = s.lostStage ? actionBtn('opp-lost', 'data-id="' + esc(id) + '"', 'border-color:#fecaca;color:#991b1b;background:#fef2f2', '#dc2626', 'نقل إلى مفقودة') : '';
    var sec = others.length ? actionBtn('opp-move-sector', 'data-id="' + esc(id) + '" data-sector="' + esc(sector) + '"', '', '', '↔ نقل لقطاع آخر') : '';
    window.Sanad.openModal(
      '<div class="modal-head"><div style="min-width:0"><div style="font-size:11px;color:var(--muted);font-weight:700">إجراء سريع على الفرصة</div>' +
      '<h3 style="font-size:15px;margin-top:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:330px">' + esc(title) + '</h3></div>' +
      '<button class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body" style="gap:.5rem">' + won + lost + sec + '</div>');
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
    var sortTh = e.target.closest('#opp-table th[data-sort]');
    if (sortTh) { sortOppTable(sortTh); return; }
    var actEl = e.target.closest('[data-action]');
    if (actEl) {
      var act = actEl.dataset.action;
      if (act === 'open-opp') {
        if (e.target.closest('a,button,select,input')) return; // لا تخطف روابط/أزرار داخلية
        location.href = '/app/opportunity/' + actEl.dataset.id; return;
      }
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
      if (act === 'opp-won') { oppWon(actEl.dataset.id); return; }
      if (act === 'opp-lost') { oppLostModal(actEl.dataset.id); return; }
      if (act === 'opp-lost-confirm') { oppLostConfirm(actEl.dataset.id); return; }
      if (act === 'opp-move-sector') { oppSectorModal(actEl.dataset.id, actEl.dataset.sector || ''); return; }
      if (act === 'opp-sector-confirm') { oppSectorConfirm(actEl.dataset.id); return; }
      return;
    }
    var dd = e.target.closest('[data-dd]');
    if (dd && window.Sanad) window.Sanad.openDD(dd.dataset.dd);
  });

  // ── لوحة المفاتيح: البطاقات والبلاطات ورؤوس الترتيب تعمل بـ Enter ──
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (t.matches && t.matches('[data-action="open-opp"],[data-dd],[data-action="na-edit"],#opp-table th[data-sort]')) { e.preventDefault(); t.click(); }
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
