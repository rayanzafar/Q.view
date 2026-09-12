// عميل ملف المورد (S04–S08 + S10): درج تفاصيل المهمة (S06)، نماذج إضافة/تعديل/حذف القدرات (S07)،
// تعديل الطاقة التعاقدية بتاريخ سريانٍ ومعاينة أثره على الأشهر القادمة (S08)، ومقارنة قبل/بعد في
// سجل التغييرات (S10). تفويض data-action فقط — لا onclick — وكل البيانات من window.__SANAD.teamProfile
// (مقصوصة بصلاحية القارئ في الخادم). لا نجاح قبل ردّ الخادم، وزر الحفظ يُعطَّل أثناء الإرسال،
// وخطأ الخادم يُعرض بنصّه ويسمح بإعادة المحاولة. الدرج يُغلق بالزر وبـEsc وبالستارة، ويعيد التركيز
// إلى العنصر الذي فتحه، ويحذّر قبل إغلاق نموذجٍ به تعديلات.
(function () {
  'use strict';

  var S = function () { return (window.__SANAD && window.__SANAD.teamProfile) || {}; };
  var MONTHS = function () { return window.__SANAD_MONTHS || []; };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var toast = function (msg, bad) {
    var d = document.createElement('div');
    d.textContent = msg;
    d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:300;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;'
      + 'max-width:min(92vw,420px);line-height:1.7;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#b91c1c' : '#047857');
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, bad ? 5200 : 2600);
  };
  var api = async function (path, method, body) {
    var res = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    var txt = await res.text();
    var data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.error && data.error.message) || 'تعذّر إتمام العملية — حاول مرة أخرى');
    return data;
  };
  var dayAr = function (iso) {
    var s = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    return '<span class="tnum">' + Number(s.slice(8, 10)) + '</span> ' + (MONTHS()[Number(s.slice(5, 7)) - 1] || '') + ' <span class="tnum">' + s.slice(0, 4) + '</span>';
  };
  var absent = function (v) { return v === '' || v == null; };
  var pctTxt = function (v) { return absent(v) ? '<span style="color:var(--faint)">—</span>' : '<span class="tnum">' + Math.round(Number(v)) + '%</span>'; };
  var DASH = '<span style="color:var(--faint)">—</span>';
  var empId = function () { return encodeURIComponent(S().employeeId || ''); };

  // ── الدرج المشترك ───────────────────────────────────────────────────────────────────
  var drawer = null, scrim = null, opener = null, dirty = false, seq = 0;
  function ensureDrawer() {
    if (drawer) return;
    drawer = document.createElement('aside');
    drawer.className = 'tm-drawer'; drawer.id = 'tm-profile-drawer';
    drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-hidden', 'true');
    scrim = document.createElement('div');
    scrim.className = 'tm-scrim'; scrim.setAttribute('data-action', 'drawer-close');
    document.body.appendChild(scrim); document.body.appendChild(drawer);
    drawer.addEventListener('input', function () { dirty = true; });
    drawer.addEventListener('change', function () { dirty = true; });
  }
  function openDrawer(o) {
    ensureDrawer();
    opener = o.opener || document.activeElement;
    dirty = false;
    drawer.innerHTML = '<div class="dh"><div><div style="font-weight:800;font-size:var(--fs-title);color:var(--ink2)">' + esc(o.title) + '</div>'
      + (o.sub ? '<div style="font-size:var(--fs-micro);color:var(--muted)">' + esc(o.sub) + '</div>' : '') + '</div>'
      + '<button type="button" class="btn btn-ghost btn-sm" data-action="drawer-close" aria-label="إغلاق">✕</button></div>'
      + '<div class="db">' + o.body + '</div>' + (o.foot ? '<div class="df">' + o.foot + '</div>' : '');
    drawer.setAttribute('aria-label', o.title);
    drawer.classList.add('open'); scrim.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
    var f = drawer.querySelector('.db input,.db select,.db textarea,.df .btn-primary,.df a,.dh button');
    if (f) f.focus();
  }
  function closeDrawer(force) {
    if (!drawer || !drawer.classList.contains('open')) return false;
    if (dirty && !force && !window.confirm('لديك تعديلات غير محفوظة — هل تريد الإغلاق دون حفظ؟')) return false;
    drawer.classList.remove('open'); scrim.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
    dirty = false;
    var o = opener; opener = null;
    if (o && o.focus && document.body.contains(o)) o.focus();
    return true;
  }
  function showError(msg) {
    var box = drawer.querySelector('[data-err]');
    if (!box) {
      box = document.createElement('div');
      box.className = 'tm-danger'; box.setAttribute('data-err', ''); box.setAttribute('role', 'alert'); box.style.marginBottom = '.7rem';
      drawer.querySelector('.db').prepend(box);
    }
    box.textContent = msg;
  }
  function val(name) { var el = drawer.querySelector('[name="' + name + '"]'); return el ? String(el.value || '').trim() : ''; }
  function field(label, inner, req, extra) {
    return '<div class="field" style="margin-bottom:.7rem"' + (extra || '') + '><label class="' + (req ? 'req' : '') + '" style="display:block;font-size:var(--fs-meta);color:var(--muted);margin-bottom:.25rem">' + esc(label) + '</label>' + inner + '</div>';
  }
  function select(name, opts, value, blank) {
    return '<select class="input" name="' + name + '" style="width:100%">' + (blank != null ? '<option value="">' + esc(blank) + '</option>' : '')
      + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(value == null ? '' : value) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function input(name, value, attrs) {
    return '<input class="input" name="' + name + '" style="width:100%" value="' + esc(value == null ? '' : value) + '" ' + (attrs || '') + '>';
  }
  var kvRow = function (k, v) { return '<tr><td style="color:var(--muted);width:40%">' + esc(k) + '</td><td>' + v + '</td></tr>'; };

  // ── S06: درج تفاصيل المهمة — من الحمولة المعروضة خادمياً، بلا نداءٍ إضافي ───────────────
  function openTask(id, el) {
    var t = (S().tasks || []).filter(function (x) { return x.id === id; })[0];
    if (!t) { toast('تعذّر العثور على المهمة في هذا العرض — حدّث الصفحة', true); return; }
    var workHtml = t.work ? (t.work.href ? '<a href="' + esc(t.work.href) + '">' + esc(t.work.label) + '</a>' : esc(t.work.label)) : 'عمل داخلي';
    var rows = [
      kvRow('المسؤول', esc(S().resourceName || '')),
      kvRow('العمل', workHtml),
      kvRow('الحالة', esc(t.status_ar || '')),
      kvRow('الأولوية', absent(t.priority_ar) ? 'غير محددة' : esc(t.priority_ar)),
      kvRow('الاستحقاق', absent(t.due_date) ? 'بلا موعد' : dayAr(t.due_date)),
      kvRow('الجهد التقديري', absent(t.utilization_pct) ? 'غير محدد' : pctTxt(t.utilization_pct) + ' <span style="font-size:var(--fs-micro);color:var(--muted)">من الشهر</span>'),
    ];
    var sec = function (title, inner) { return '<div class="tm-sec"><div class="sh">' + esc(title) + '</div>' + inner + '</div>'; };
    var body = (t.pending ? '<div class="tm-warn" style="margin-bottom:.7rem">بانتظار اعتماد المدير — لا تُحتسب في عبء المهام قبل الاعتماد.</div>' : '')
      + '<table class="tm-tbl keep-all" style="margin-bottom:.8rem"><tbody>' + rows.join('') + '</tbody></table>'
      + sec('المخرج والخطوة التالية', absent(t.next_step) ? '<span style="color:var(--muted)">لم تُحدَّد خطوة تالية</span>' : esc(t.next_step))
      + (absent(t.blocked_reason) ? '' : sec('سبب التعطل', '<span style="color:var(--red)">' + esc(t.blocked_reason) + '</span>'))
      + sec('آخر نشاط', '<span style="color:var(--muted)">غير متاح في هذا العرض — يُقرأ من شاشة المهام الأصلية</span>')
      + '<div style="font-size:var(--fs-micro);color:var(--muted);line-height:1.7">'
      + (S().taskLimits || []).map(function (x) { return '<div>· ' + esc(x) + '</div>'; }).join('')
      + '<div>· للاطلاع فقط — التعديل يمر بشاشة المهام الأصلية وصلاحيتها.</div></div>';
    var foot = (S().openHref ? '<a class="btn btn-primary" href="' + esc(S().openHref) + '">فتح المهمة الأصلية</a>'
      : '<div style="font-size:var(--fs-micro);color:var(--muted)">المهمة الأصلية تُفتح من حساب صاحبها أو مديره.</div>')
      + (t.work && t.work.href ? '<a class="btn" href="' + esc(t.work.href) + '">عرض العمل</a>' : '');
    openDrawer({ title: t.title || 'مهمة', sub: t.department_name ? String(t.department_name) : '', body: body, foot: foot, opener: el });
  }

  // ── S07: نماذج القدرات ─────────────────────────────────────────────────────────────
  var KIND_AR = { skill: 'مهارة', experience: 'خبرة', goal: 'هدف تطوير' };
  function capForm(kind, cap, el) {
    var O = S().capOptions || {};
    var c = cap || {};
    var evKind = absent(c.evidence_kind) ? '' : c.evidence_kind;
    var html = field('الاسم', input('name_ar', c.name_ar, 'maxlength="120" required'), true);
    if (kind === 'skill') html += field('المستوى', select('level', O.levels || [], c.level, 'بلا مستوى محدد'));
    if (kind === 'experience') {
      html += '<div class="row">' + field('من', input('period_from', c.period_from, 'type="date"')) + field('إلى', input('period_to', c.period_to, 'type="date"')) + '</div>';
    }
    if (kind === 'goal') {
      html += '<div class="row">' + field('الموعد المستهدف', input('target_date', c.target_date, 'type="date"'))
        + field('الحالة', select('status', O.goalStatuses || [], absent(c.status) ? 'planned' : c.status)) + '</div>';
    }
    if (kind !== 'goal') {
      html += field('الشاهد', select('evidence_kind', O.evidenceKinds || [], evKind, 'بلا شاهد'))
        + field('المشروع الشاهد', select('evidence_project', (O.projects || []).map(function (p) { return [p.id, p.name_ar]; }), evKind === 'project' ? c.evidence_ref : '', 'اختر المشروع'), false, ' data-ev="project"' + (evKind === 'project' ? '' : ' hidden'))
        + field('البند الداخلي', select('evidence_bucket', O.buckets || [], evKind === 'bucket' ? c.evidence_ref : '', 'اختر البند'), false, ' data-ev="bucket"' + (evKind === 'bucket' ? '' : ' hidden'))
        + field('وصف الشاهد', input('evidence_label', c.evidence_label, 'maxlength="200"'), false, ' data-ev="label"' + (evKind === 'document' || evKind === 'note' ? '' : ' hidden'));
    }
    html += field('ملاحظة', '<textarea class="input" name="note" rows="3" maxlength="500" style="width:100%">' + esc(absent(c.note) ? '' : c.note) + '</textarea>');
    var foot = '<button type="button" class="btn btn-primary" data-action="cap-save" data-kind="' + esc(kind) + '"' + (c.id ? ' data-cap="' + esc(c.id) + '"' : '') + '>حفظ</button>'
      + '<button type="button" class="btn" data-action="drawer-close">إلغاء</button>';
    openDrawer({ title: (c.id ? 'تعديل ' : 'إضافة ') + (KIND_AR[kind] || ''), sub: S().resourceName || '', body: '<div class="tm-form">' + html + '</div>', foot: foot, opener: el });
  }
  function syncEvidence() {
    if (!drawer) return;
    var k = val('evidence_kind');
    drawer.querySelectorAll('[data-ev]').forEach(function (n) {
      var want = n.getAttribute('data-ev');
      n.hidden = !((want === 'project' && k === 'project') || (want === 'bucket' && k === 'bucket') || (want === 'label' && (k === 'document' || k === 'note')));
    });
  }
  async function capSave(btn) {
    var kind = btn.dataset.kind;
    var body = { id: btn.dataset.cap || undefined, kind: kind, name_ar: val('name_ar'), note: val('note') || null };
    if (!body.name_ar) { showError('اكتب اسم ' + (KIND_AR[kind] || 'السجل') + ' أولاً'); return; }
    if (kind === 'skill') body.level = val('level') || null;
    if (kind === 'experience') { body.period_from = val('period_from') || null; body.period_to = val('period_to') || null; }
    if (kind === 'goal') { body.target_date = val('target_date') || null; body.status = val('status') || 'planned'; }
    if (kind !== 'goal') {
      var ek = val('evidence_kind');
      body.evidence_kind = ek || null;
      body.evidence_ref = ek === 'project' ? val('evidence_project') : ek === 'bucket' ? val('evidence_bucket') : null;
      body.evidence_label = val('evidence_label') || null;
      if (ek === 'project' && !body.evidence_ref) { showError('اختر المشروع الشاهد'); return; }
      if (ek === 'bucket' && !body.evidence_ref) { showError('اختر بند العمل الداخلي'); return; }
      if ((ek === 'document' || ek === 'note') && !body.evidence_label) { showError('اكتب وصف الشاهد'); return; }
    }
    var my = ++seq;
    btn.disabled = true;
    try {
      await api('/team/resources/' + empId() + '/capabilities', 'POST', body);
      if (my !== seq) return;
      dirty = false;
      toast('تم الحفظ ✓');
      closeDrawer(true);
      setTimeout(function () { location.reload(); }, 400);
    } catch (e) { if (my === seq) { btn.disabled = false; showError(e.message); } }
  }
  async function capRemove(btn) {
    var name = btn.dataset.name || 'السجل';
    if (!window.confirm('حذف «' + name + '» من قدرات هذا المورد؟')) return;
    var my = ++seq;
    btn.disabled = true;
    try {
      await api('/team/resources/' + empId() + '/capabilities/' + encodeURIComponent(btn.dataset.cap), 'DELETE');
      if (my !== seq) return;
      toast('حُذف السجل ✓');
      setTimeout(function () { location.reload(); }, 400);
    } catch (e) { if (my === seq) { btn.disabled = false; toast(e.message, true); } }
  }

  // ── S08: تعديل الطاقة بتاريخ سريان ومعاينة الأثر بعد الحفظ ───────────────────────────
  function capacityForm(el) {
    var cap = S().capacity || {};
    var body = '<div class="tm-info" style="margin-bottom:.8rem">الطاقة تُحفظ بإصدارٍ مؤرخ: تسري من التاريخ المحدد، والأشهر السابقة تبقى كما كانت.</div>'
      + '<div class="tm-form">'
      + field('الطاقة التعاقدية (100 = دوام كامل)', input('capacity_pct', absent(cap.currentPct) ? 100 : Math.round(Number(cap.currentPct)), 'type="number" min="1" max="100" step="1" class="input tnum" required'), true)
      + field('تاريخ السريان', input('effective_from', S().today || '', 'type="date" required' + (cap.hireDate ? ' min="' + esc(cap.hireDate) + '"' : '')), true)
      + field('سبب التغيير', '<textarea class="input" name="note" rows="3" maxlength="300" style="width:100%" placeholder="مثال: تغيّر الدوام إلى نصف وقت"></textarea>')
      + '</div>';
    var foot = '<button type="button" class="btn btn-primary" data-action="capacity-save">حفظ</button><button type="button" class="btn" data-action="drawer-close">إلغاء</button>';
    openDrawer({ title: 'تعديل الطاقة', sub: S().resourceName || '', body: body, foot: foot, opener: el });
  }
  async function capacitySave(btn) {
    var pct = Number(val('capacity_pct'));
    var from = val('effective_from');
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) { showError('الطاقة نسبة صحيحة بين 1 و100'); return; }
    if (!from) { showError('حدّد تاريخ السريان — لا يُحفظ تغيير الطاقة بلا تاريخ'); return; }
    var my = ++seq;
    btn.disabled = true;
    try {
      var r = await api('/team/resources/' + empId() + '/capacity', 'POST', { capacity_pct: pct, effective_from: from, note: val('note') || null });
      if (my !== seq) return;
      dirty = false;
      var months = (r && r.effect && r.effect.months) || [];
      var cell = function (m) { return absent(m) ? '<span style="color:var(--faint)">خارج الارتباط</span>' : pctTxt(m); };
      var rows = months.map(function (m) {
        var b = m.before || {}; var a = m.after || {};
        return '<tr><td>' + esc(m.label_ar || m.key) + '</td><td>' + cell(b.nominalPct) + '</td><td>' + cell(a.nominalPct) + '</td><td>' + cell(b.availablePct) + '</td><td>' + cell(a.availablePct) + '</td></tr>';
      }).join('');
      var body = '<div class="tm-ok" style="margin-bottom:.8rem">تم الحفظ — ' + esc((r && r.applied_ar) || '') + '</div>'
        + '<div style="font-weight:800;color:var(--ink2);margin-bottom:.4rem">أثر التغيير على الأشهر القادمة</div>'
        + (rows ? '<div class="tblwrap"><table class="tm-tbl keep-all"><thead><tr><th>الشهر</th><th>الطاقة قبل</th><th>الطاقة بعد</th><th>المتاح قبل</th><th>المتاح بعد</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<div style="color:var(--muted)">لا أشهر قادمة ضمن الارتباط تتأثر بهذا التغيير.</div>')
        + '<div style="font-size:var(--fs-micro);color:var(--muted);margin-top:.6rem">المتاح محسوب بعد التسكين المؤكد وحده؛ المبدئي لا يُخصم.</div>';
      drawer.querySelector('.db').innerHTML = body;
      drawer.querySelector('.df').innerHTML = '<button type="button" class="btn btn-primary" data-action="capacity-done">إغلاق وتحديث</button>';
      drawer.querySelector('[data-action="capacity-done"]').focus();
      toast('حُفظت الطاقة ✓');
    } catch (e) { if (my === seq) { btn.disabled = false; showError(e.message); } }
  }

  // ── التفويض ───────────────────────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    var act = el.dataset.action;
    if (act === 'drawer-close') { e.preventDefault(); closeDrawer(false); return; }
    if (act === 'modal-close') { e.preventDefault(); if (window.Sanad && window.Sanad.closeModal) window.Sanad.closeModal(); return; }
    if (act === 'audit-diff') { e.preventDefault(); if (window.Sanad && window.Sanad.openDD) window.Sanad.openDD(el.dataset.dd); return; }
    if (act === 'task-open') { e.preventDefault(); openTask(el.dataset.task, el); return; }
    if (act === 'cap-add') { e.preventDefault(); capForm(el.dataset.kind, null, el); return; }
    if (act === 'cap-edit') {
      e.preventDefault();
      var cap = (S().caps || []).filter(function (x) { return x.id === el.dataset.cap; })[0];
      if (!cap) { toast('تعذّر تحميل السجل — حدّث الصفحة', true); return; }
      capForm(cap.kind, cap, el); return;
    }
    if (act === 'cap-remove') { e.preventDefault(); capRemove(el); return; }
    if (act === 'cap-save') { e.preventDefault(); capSave(el); return; }
    if (act === 'capacity-edit') { e.preventDefault(); capacityForm(el); return; }
    if (act === 'capacity-save') { e.preventDefault(); capacitySave(el); return; }
    if (act === 'capacity-done') { e.preventDefault(); closeDrawer(true); location.reload(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'evidence_kind' && drawer && drawer.contains(e.target)) syncEvidence();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer && drawer.classList.contains('open')) { closeDrawer(false); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('tr[data-action="task-open"]')) {
      e.preventDefault(); openTask(e.target.dataset.task, e.target);
    }
  });
  // رابطٌ إلى مهمةٍ بعينها (من «القادم خلال 30 يوماً») يفتح درجها مباشرةً.
  var m = /^#task-(.+)$/.exec(location.hash || '');
  if (m && S().tab === 'tasks') {
    var row = document.querySelector('tr[data-task="' + decodeURIComponent(m[1]).replace(/"/g, '') + '"]');
    openTask(decodeURIComponent(m[1]), row || null);
  }
})();
