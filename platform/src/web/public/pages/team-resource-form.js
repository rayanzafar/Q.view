// عميل نموذج المورد S09 — يستنسخ القالب الخامل <template id="tm-resource-form"> درجاً عند
// «إضافة مورد» (data-action="resource-add") أو «تعديل الملف» (data-action="resource-edit"
// data-emp="…") من أي صفحةٍ تضمّنه (سجل الموارد S02 وملف المورد S04). التعديل يحمّل المورد من
// /api/team/resources/:id/profile ويحفظ بـPATCH على معرّفه — لا يُنشئ نسخة ثانية أبداً.
// لا نجاح قبل ردّ الخادم؛ زر الحفظ يُعطَّل أثناء الإرسال؛ خطأ الخادم يُعرض بنصّه مع إعادة
// المحاولة؛ تحذير قبل إغلاق نموذجٍ به تعديلات؛ والتركيز يعود إلى الزر الذي فتح الدرج.
// تفويض data-action فقط — لا onclick مضمّن.
(function () {
  'use strict';

  const esc = (s) => (window.Sanad && window.Sanad.esc ? window.Sanad.esc(s)
    : String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const api = async (path, method, body) => {
    const r = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: Object.assign({ 'X-Requested-With': 'fetch' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { location.reload(); return new Promise(() => {}); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || 'تعذّر إتمام الطلب — أعد المحاولة');
    return j;
  };
  const toast = (msg, bad) => {
    if (window.Sanad && typeof window.Sanad.toast === 'function') return window.Sanad.toast(msg, bad);
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#dc2626' : '#059669');
    document.body.appendChild(d); setTimeout(() => d.remove(), 2800);
  };
  const TYPES = ['internal', 'external', 'partner'];
  const UNSAVED = 'لديك تعديلات غير محفوظة — هل تريد إغلاق النموذج وفقدها؟';

  // ── الحالة ──────────────────────────────────────────────────────────────────────────
  let host = null; let drawer = null; let form = null; let deptMaster = []; let opener = null;
  let loadSeq = 0;
  // `loaded`: لقطة الحقول كما وصلت في وضع التعديل — يُرسل الفرق عنها فقط، فلا تُكتب طاقةٌ جديدة
  // ولا يُعاد فحص الاسم مع كل حفظٍ لم يمسّهما.
  const st = { open: false, mode: 'create', id: null, dirty: false, saving: false, done: false, userId: null, loaded: null };
  const $ = (sel) => (host ? host.querySelector(sel) : null);
  const field = (name) => (form ? form.elements.namedItem(name) : null);
  const val = (name) => { const f = field(name); return f ? String(f.value == null ? '' : f.value).trim() : ''; };
  const setVal = (name, v) => { const f = field(name); if (f) f.value = v == null ? '' : String(v); };
  const dateOf = (v) => (v ? String(v).slice(0, 10) : '');
  const msg = (html) => { const m = $('#tm-rf-msg'); if (m) { m.innerHTML = html || ''; if (html) m.scrollIntoView({ block: 'nearest' }); } };

  function mount() {
    if (host) return true;
    const tpl = document.getElementById('tm-resource-form');
    if (!tpl) return false;
    host = document.createElement('div');
    host.id = 'tm-rf-host'; host.hidden = true;
    host.innerHTML = tpl.innerHTML;
    document.body.appendChild(host);
    drawer = host.querySelector('.tm-drawer');
    form = host.querySelector('#tm-rf-form');
    if (drawer) drawer.classList.remove('open');
    const dep = field('department_id');
    deptMaster = dep ? Array.from(dep.options).slice(1).map((o) => ({ value: o.value, label: o.textContent, sector: o.dataset.sector || '', manager: o.dataset.manager || '' })) : [];
    return true;
  }

  // ── مزامنة الحقول المتغيرة بحسب النوع/القطاع/الإدارة/الحساب ───────────────────────────
  function syncType() {
    const t = val('resource_type') || 'internal';
    host.querySelectorAll('.tm-rf-type').forEach((l) => { const i = l.querySelector('input'); l.classList.toggle('on', !!(i && i.checked)); });
    const row = $('.tm-rf-vendor'); const need = t !== 'internal';
    if (row) row.hidden = !need;
    const vn = field('vendor_name'); if (vn) vn.required = need;
  }
  function syncDept(keep) {
    const dep = field('department_id'); if (!dep) return;
    const sec = val('sector_id');
    const cur = keep != null ? String(keep) : dep.value;
    const list = sec ? deptMaster.filter((d) => !d.sector || d.sector === sec) : [];
    dep.innerHTML = '<option value="">' + (list.length ? 'اختر الإدارة' : (sec ? 'لا إدارات مسجّلة في هذا القطاع' : 'اختر القطاع أولاً')) + '</option>'
      + list.map((d) => '<option value="' + esc(d.value) + '" data-sector="' + esc(d.sector) + '" data-manager="' + esc(d.manager) + '">' + esc(d.label) + '</option>').join('');
    dep.value = cur && list.some((d) => d.value === cur) ? cur : '';
    dep.required = list.length > 0;
    syncManager();
  }
  function syncManager() {
    const ro = $('#rf-manager-ro'); if (!ro) return;
    const dep = field('department_id');
    const opt = dep && dep.selectedOptions ? dep.selectedOptions[0] : null;
    if (!opt || !opt.value) { ro.textContent = ro.dataset.empty || ''; return; }
    ro.textContent = opt.dataset.manager || 'لا مدير مسجّل لهذه الإدارة بعد — يُعيَّن من الهيكل الإداري';
  }
  function syncAccount() {
    const cb = field('create_account'); const fields = $('#rf-account-fields'); const email = field('email');
    const on = !!(cb && cb.checked && !cb.disabled);
    if (fields) fields.hidden = !on;
    if (email) email.required = on;
  }
  function setAccountLinked(linked) {
    const sw = $('#rf-account-switch'); const ok = $('#rf-account-linked');
    if (sw) sw.hidden = !!linked;
    if (ok) ok.hidden = !linked;
    const cb = field('create_account'); if (cb && linked) cb.checked = false;
  }
  function setBusy(on) {
    const save = $('#rf-save');
    if (save) { save.disabled = !!on || st.done; if (on) save.setAttribute('aria-busy', 'true'); else save.removeAttribute('aria-busy'); }
    if (form) form.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  // ── فتح/إغلاق ───────────────────────────────────────────────────────────────────────
  async function open(mode, id, trigger) {
    if (!mount()) { toast('نموذج المورد غير متاح في هذه الصفحة', true); return; }
    if (st.open && st.dirty && !window.confirm(UNSAVED)) return;
    opener = trigger || document.activeElement;
    st.open = true; st.mode = mode; st.id = id || null; st.dirty = false; st.saving = false; st.done = false; st.userId = null; st.loaded = null;
    loadSeq++;
    form.reset();
    const rt = field('resource_type'); if (rt) rt.value = 'internal';
    setVal('capacity_pct', 100);
    const title = $('#tm-rf-title'); if (title) title.textContent = mode === 'edit' ? (drawer.dataset.titleEdit || 'تعديل بيانات المورد') : (drawer.dataset.titleCreate || 'إضافة مورد');
    const save = $('#rf-save'); if (save) save.textContent = mode === 'edit' ? 'حفظ التعديلات' : 'حفظ المورد';
    msg('');
    setAccountLinked(false);
    syncType(); syncDept(''); syncAccount();
    setBusy(false);
    host.hidden = false;
    requestAnimationFrame(() => drawer.classList.add('open'));
    const first = field('name_ar'); if (first && first.focus) setTimeout(() => first.focus(), 60);
    if (mode === 'edit' && id) await load(id);
  }

  async function load(id) {
    const my = ++loadSeq;
    setBusy(true);
    try {
      const d = await api('/team/resources/' + encodeURIComponent(id) + '/profile');
      if (my !== loadSeq || !st.open) return;
      fill((d && d.resource) || {}, d || {});
      st.dirty = false;
    } catch (err) {
      if (my !== loadSeq) return;
      msg('<div class="tm-danger">' + esc(err.message) + ' <button type="button" class="btn btn-sm" data-action="rf-reload">إعادة المحاولة</button></div>');
    } finally {
      if (my === loadSeq) setBusy(false);
    }
  }

  function fill(r, d) {
    const type = String(r.resourceType || r.resource_type || 'internal').toLowerCase();
    const rt = field('resource_type'); if (rt) rt.value = TYPES.indexOf(type) >= 0 ? type : 'internal';
    setVal('name_ar', r.name_ar || r.name || '');
    setVal('job_title', r.job_title || '');
    setVal('sector_id', r.sector_id || '');
    syncDept(r.department_id || '');
    setVal('hire_date', dateOf(r.hire_date || (r.engagement && r.engagement.hire_date)));
    setVal('end_date', dateOf(r.end_date || (r.engagement && r.engagement.end_date)));
    const cap = r.capacityPct != null ? r.capacityPct : (r.capacity_pct != null ? r.capacity_pct : 100);
    setVal('capacity_pct', cap === '' || cap == null ? 100 : cap);
    setVal('vendor_name', r.vendor_name || r.vendor || '');
    setVal('engagement_ref', r.engagement_ref || r.ref || '');
    setVal('note', '');
    st.userId = r.user_id || r.userId || d.userId || null;
    setAccountLinked(!!st.userId);
    syncType(); syncAccount();
    st.loaded = payload();
  }

  function close(force) {
    if (!st.open) return;
    if (!force && st.dirty && !st.done && !window.confirm(UNSAVED)) return;
    st.open = false; st.dirty = false; loadSeq++;
    if (drawer) drawer.classList.remove('open');
    setTimeout(() => { if (!st.open && host) host.hidden = true; }, 200);
    const back = opener; opener = null;
    if (back && back.focus && document.contains(back)) back.focus();
  }

  // ── التحقق والحفظ ────────────────────────────────────────────────────────────────────
  function validate() {
    const t = val('resource_type') || 'internal';
    host.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
    const fail = (name, m) => { const f = field(name); if (f && f.setAttribute) { f.setAttribute('aria-invalid', 'true'); if (f.focus) f.focus(); } return m; };
    if (!val('name_ar')) return fail('name_ar', 'اكتب اسم المورد الكامل');
    if (!val('sector_id')) return fail('sector_id', 'اختر القطاع الأساسي');
    const dep = field('department_id'); if (dep && dep.required && !dep.value) return fail('department_id', 'اختر الإدارة الأساسية');
    if (t !== 'internal' && !val('vendor_name')) return fail('vendor_name', 'اكتب اسم الجهة المتعاقدة لهذا المورد');
    if (!val('hire_date')) return fail('hire_date', 'حدّد تاريخ بداية الارتباط');
    const h = val('hire_date'); const e = val('end_date');
    if (e && e < h) return fail('end_date', 'نهاية الارتباط أسبق من بدايتها — صحّح أحد التاريخين');
    const cap = Number(val('capacity_pct'));
    if (!Number.isFinite(cap) || cap < 1 || cap > 100) return fail('capacity_pct', 'الطاقة التعاقدية بين 1 و100 (100 = دوام كامل)');
    const cb = field('create_account');
    if (cb && cb.checked && !cb.disabled && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val('email'))) return fail('email', 'اكتب بريد عمل صحيحاً لإنشاء حساب الدخول');
    return null;
  }

  function payload() {
    const t = val('resource_type') || 'internal';
    const p = {
      resource_type: t,
      name_ar: val('name_ar'),
      job_title: val('job_title') || null,
      sector_id: val('sector_id'),
      department_id: val('department_id') || null,
      hire_date: val('hire_date'),
      end_date: val('end_date') || null,
      capacity_pct: Number(val('capacity_pct')) || 100,
      vendor_name: t === 'internal' ? null : val('vendor_name'),
      engagement_ref: t === 'internal' ? null : (val('engagement_ref') || null),
      note: val('note') || null,
    };
    const mgr = field('line_manager_id'); if (mgr && mgr.value) p.line_manager_id = mgr.value;
    const cb = field('create_account');
    if (cb && cb.checked && !cb.disabled) { p.create_account = true; p.email = val('email'); }
    return p;
  }
  // وضع التعديل: ما تغيّر عن اللقطة المحمّلة فقط. الطاقة تحمل ملاحظتها (سطر إصدار جديد بتاريخ اليوم).
  function editDiff(p) {
    const base = st.loaded || {};
    const diff = {};
    for (const k of Object.keys(p)) {
      if (k === 'note') continue;
      if (String(p[k] == null ? '' : p[k]) !== String(base[k] == null ? '' : base[k])) diff[k] = p[k];
    }
    if ('capacity_pct' in diff && p.note) diff.capacity_note = p.note;
    return diff;
  }

  const warnList = (res) => (res && Array.isArray(res.warnings) ? res.warnings : [])
    .map((w) => (typeof w === 'string' ? w : (w && (w.message_ar || w.message || w.text || w.label_ar || w.label)) || ''))
    .filter(Boolean);

  function showDone(id, warnings, title) {
    st.done = true; st.dirty = false;
    const profile = id ? '/app/team/resources/' + encodeURIComponent(id) : '';
    msg('<div class="tm-ok"><b>' + esc(title) + '</b></div>'
      + '<div class="tm-warn" style="margin-top:.5rem"><b>تنبيه — أسماء مشابهة في السجل، ولم يُدمج شيء:</b><ul class="tm-rf-warn-list">'
      + warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul><div style="margin-top:.5rem;font-size:var(--fs-micro)">راجع السجل إن كان الشخص نفسه، وإلا فلا إجراء مطلوب.</div></div>'
      + '<div style="display:flex;gap:.5rem;margin-top:.7rem;flex-wrap:wrap">'
      + (profile ? '<a class="btn btn-primary" href="' + esc(profile) + '">فتح الملف</a>' : '')
      + '<button type="button" class="btn" data-action="rf-done">' + (st.mode === 'edit' ? 'إغلاق' : 'العودة إلى السجل') + '</button></div>');
    const save = $('#rf-save'); if (save) { save.disabled = true; save.hidden = true; }
  }

  async function save() {
    if (st.saving || st.done) return;
    const v = validate();
    if (v) { msg('<div class="tm-danger">' + esc(v) + '</div>'); return; }
    const full = payload();
    const body = st.mode === 'edit' && st.id ? editDiff(full) : full;
    if (st.mode === 'edit' && !Object.keys(body).length) { toast('لا تغييرات للحفظ'); return; }
    st.saving = true; setBusy(true); msg('');
    try {
      const res = st.mode === 'edit' && st.id
        ? await api('/team/resources/' + encodeURIComponent(st.id), 'PATCH', body)
        : await api('/team/resources', 'POST', body);
      st.dirty = false;
      const id = (res && (res.id || (res.resource && res.resource.id))) || st.id || null;
      const warnings = warnList(res);
      if (warnings.length) { showDone(id, warnings, st.mode === 'edit' ? 'حُفظت التعديلات' : 'حُفظ المورد'); return; }
      st.done = true;
      if (st.mode === 'edit') { toast('حُفظت التعديلات ✓'); location.reload(); return; }
      toast('أُضيف المورد ✓');
      location.href = id ? '/app/team/resources/' + encodeURIComponent(id) : '/app/team/resources';
    } catch (err) {
      msg('<div class="tm-danger">' + esc(err.message) + ' <button type="button" class="btn btn-sm" data-action="rf-retry">إعادة المحاولة</button></div>');
    } finally {
      st.saving = false; setBusy(false);
    }
  }

  // ── التفويض ──────────────────────────────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]'); if (!t) return;
    const a = t.dataset.action;
    if (a === 'resource-add') { e.preventDefault(); open('create', null, t); return; }
    if (a === 'resource-edit') { e.preventDefault(); open('edit', t.dataset.emp || null, t); return; }
    if (!host || !st.open || !host.contains(t)) return;
    if (a === 'rf-close') { e.preventDefault(); close(false); return; }
    if (a === 'rf-retry') { e.preventDefault(); save(); return; }
    if (a === 'rf-reload') { e.preventDefault(); if (st.id) load(st.id); return; }
    if (a === 'rf-done') { e.preventDefault(); if (st.mode === 'edit') location.reload(); else location.href = '/app/team/resources'; }
  });
  document.addEventListener('submit', (e) => {
    if (!form || e.target !== form) return;
    e.preventDefault(); save();
  });
  const onChange = (e) => {
    if (!host || !st.open || !host.contains(e.target)) return;
    st.dirty = true;
    const n = e.target.name;
    if (n === 'resource_type') syncType();
    else if (n === 'sector_id') syncDept('');
    else if (n === 'department_id') syncManager();
    else if (n === 'create_account') { syncAccount(); const em = field('email'); if (e.target.checked && em && em.focus) em.focus(); }
  };
  document.addEventListener('change', onChange);
  document.addEventListener('input', (e) => { if (host && st.open && host.contains(e.target)) st.dirty = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && st.open) { e.preventDefault(); close(false); }
  });
  window.addEventListener('beforeunload', (e) => {
    if (st.open && st.dirty && !st.saving && !st.done) { e.preventDefault(); e.returnValue = ''; }
  });

  // وصولٌ من البوابة (S01): «إضافة مورد» يفتح السجل بـ?add=1 فيُفتح النموذج فوراً — ثم يُمحى
  // المعامل من الرابط كي لا يعود فتحه مع كل تحديث.
  const params = new URLSearchParams(location.search);
  if (params.get('add') === '1' && document.getElementById('tm-resource-form')) {
    params.delete('add');
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params.toString() : ''));
    open('create', null, document.querySelector('[data-action="resource-add"]'));
  }
})();
