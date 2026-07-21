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

  // ── تفويض النقر ──
  document.addEventListener('click', function (e) {
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
      return;
    }
    var dd = e.target.closest('[data-dd]');
    if (dd && window.Sanad) window.Sanad.openDD(dd.dataset.dd);
  });

  // ── لوحة المفاتيح: البطاقات والبلاطات القابلة للنقر تعمل بـ Enter ──
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (t.matches && t.matches('[data-action="open-opp"],[data-dd],[data-action="na-edit"]')) { e.preventDefault(); t.click(); }
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
