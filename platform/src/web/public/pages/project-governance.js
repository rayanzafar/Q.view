// Project governance tabs (WP17) — tab switching + add/status/delete via the governance API.
// Server renders every panel; this script only switches visibility and posts mutations.
(function () {
  'use strict';
  const S = () => (window.__SANAD && window.__SANAD.gov) || {};
  const PLURAL = { milestone: 'milestones', risk: 'risks', issue: 'issues', decision: 'decisions', change: 'changes', deliverable: 'deliverables', phase: 'phases' };
  const api = async (path, method, body) => {
    const r = await fetch('/api' + path, { method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('خطأ ' + r.status));
    return j;
  };
  const toast = (msg, bad) => {
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#dc2626' : '#059669');
    document.body.appendChild(d); setTimeout(() => d.remove(), 2600);
  };
  const val = (id) => { const el = document.getElementById(id); const v = el ? el.value.trim() : ''; return v || null; };

  function showTab(key) {
    document.querySelectorAll('.gov-panel').forEach((p) => { p.hidden = p.dataset.panel !== key; });
    document.querySelectorAll('[data-action="gov-tab"]').forEach((b) => {
      const on = b.dataset.tab === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    try { history.replaceState(null, '', '#gov-' + key); } catch (e) { /* non-fatal */ }
  }

  // payload builders per kind — empty optional fields are dropped
  const BUILD = {
    milestone: () => ({ name_ar: val('g-mls-name'), due_date: val('g-mls-due'), phase_id: val('g-mls-phase') }),
    phase: () => ({ name_ar: val('g-phs-name'), start_date: val('g-phs-start'), end_date: val('g-phs-end') }),
    risk: () => ({ title: val('g-rsk-title'), probability: val('g-rsk-prob'), impact: val('g-rsk-impact'), mitigation: val('g-rsk-mit'), owner_user_id: val('g-rsk-owner') }),
    issue: () => ({ title: val('g-iss-title'), severity: val('g-iss-sev'), owner_user_id: val('g-iss-owner') }),
    decision: () => ({ title: val('g-dec-title'), detail: val('g-dec-detail'), decided_by: val('g-dec-by'), decided_at: val('g-dec-at') }),
    change: () => ({ title: val('g-chg-title'), impact: val('g-chg-impact') }),
    // المخرَج: الاسم وحده مطلوب. الشهر والقيمة اختياريان ويُحذفان إن تُركا فارغين — فلا يُخزَّن
    // صفرٌ مكان قيمة لم تُتفق بعد.
    deliverable: () => ({ name_ar: val('g-dlv-name'), period: val('g-dlv-period'), amount_sar: val('g-dlv-amount'),
      phase_id: val('g-dlv-phase'), owner_user_id: val('g-dlv-owner') }),
  };
  const ADD_MSG = { milestone: 'اسم المعلم مطلوب', deliverable: 'اسم المخرج مطلوب', phase: 'اسم المرحلة مطلوب' };

  async function govAdd(kind) {
    const body = (BUILD[kind] || (() => ({})))();
    Object.keys(body).forEach((k) => { if (body[k] == null) delete body[k]; });
    if (!body.title && !body.name_ar) return toast(ADD_MSG[kind] || 'العنوان مطلوب', true);
    try {
      await api('/projects/' + S().projectId + '/' + PLURAL[kind], 'POST', body);
      toast('أُضيف السجل ✓');
      setTimeout(() => location.reload(), 450); // hash keeps the active tab
    } catch (e) { toast(e.message, true); }
  }
  async function govStatus(kind, id, status) {
    try { await api('/pmo/' + kind + '/' + id, 'PATCH', { status }); toast('حُدّثت الحالة ✓'); setTimeout(() => location.reload(), 450); }
    catch (e) { toast(e.message, true); }
  }
  async function govDel(kind, id) {
    if (!window.confirm('حذف هذا السجل نهائيًا من العرض؟')) return;
    try { await api('/pmo/' + kind + '/' + id, 'DELETE'); toast('حُذف السجل ✓'); setTimeout(() => location.reload(), 450); }
    catch (e) { toast(e.message, true); }
  }
  // تعديل حالة صحة المشروع يدوياً (على المسار/في خطر/حرج) — حقل project.rag موجود أصلاً بالخدمة،
  // هذا فقط يعرضه ويجعله قابلاً للتغيير من صفحة التفاصيل.
  // هوية المشروع: مديره وإدارته وجهته — ثلاثة حقول لم يكن لها مسار تحرير في المنتج إطلاقاً.
  // تُرسَل الثلاثة معاً كي يكون التصحيح قراراً واحداً، والقيمة الفارغة تعني «انزع» لا «تجاهل».
  async function prjIdentity(id) {
    const pick = (el) => { const n = document.getElementById(el); return n ? (n.value || null) : undefined; };
    const body = { owner_user_id: pick('prj-owner'), department_id: pick('prj-dept'), client_id: pick('prj-client') };
    Object.keys(body).forEach((k) => { if (body[k] === undefined) delete body[k]; });
    try {
      await api('/projects/' + encodeURIComponent(id), 'PATCH', body);
      toast('حُفظت هوية المشروع');
      setTimeout(() => location.reload(), 500);
    } catch (e) { toast(e.message, true); }
  }

  async function prjRag(id, rag) {
    try { await api('/projects/' + id, 'PATCH', { rag }); toast('حُدّثت حالة المشروع ✓'); setTimeout(() => location.reload(), 450); }
    catch (e) { toast(e.message, true); }
  }
  // حالة المشروع (قائم · معلّق · مكتمل · ملغى) — تُغيَّر من ترويسة المشروع. إغلاقٌ وإلغاء
  // قراران يُقرآن في المحفظة ولوحة القيادة، فيُستأذن فيهما قبل الحفظ لا بعده.
  const STATUS_AR = { NOT_STARTED: 'لم يبدأ', IN_PROGRESS: 'قيد التنفيذ', ON_HOLD: 'متوقّف مؤقتًا', COMPLETED: 'مكتمل', CANCELLED: 'ملغى' };
  async function prjStatus(id, status, el) {
    const prev = el ? el.dataset.prev : '';
    if ((status === 'COMPLETED' || status === 'CANCELLED')
      && !window.confirm(`سيصير المشروع «${STATUS_AR[status]}» ويظهر كذلك في المحفظة ولوحة القيادة. تأكيد؟`)) {
      if (el && prev) el.value = prev;
      return;
    }
    try {
      await api('/projects/' + id, 'PATCH', { status });
      toast(`صار المشروع «${STATUS_AR[status] || status}» ✓`);
      setTimeout(() => location.reload(), 450);
    } catch (e) { toast(e.message, true); if (el && prev) el.value = prev; }
  }
  // إضافة مهمة مربوطة بهذا المشروع مباشرة — كانت غير متاحة أصلاً من صفحة التفاصيل (لازم
  // الذهاب لصفحة «مهامي» العامة ولا رابط بالمشروع)؛ نفس نقطة نهاية الإضافة السريعة العامة.
  async function prjTaskAdd(projectId) {
    const titleEl = document.getElementById('prj-task-title');
    const title = (titleEl && titleEl.value || '').trim();
    if (!title) { toast('اكتب عنوان المهمة أولاً', true); if (titleEl) titleEl.focus(); return; }
    const prEl = document.getElementById('prj-task-priority');
    const body = { title, project_id: projectId, priority: prEl ? prEl.value : 'P2' };
    const due = val('prj-task-due'); if (due) body.due_date = due;
    const who = val('prj-task-assignee'); if (who) body.assignee_user_id = who;
    const dl = val('prj-task-dlv'); if (dl) body.deliverable_id = dl;
    try {
      await api('/tasks/quick', 'POST', body);
      toast('أُضيفت المهمة ✓');
      setTimeout(() => location.reload(), 450);
    } catch (e) { toast(e.message, true); }
  }

  // ── وثائق المشروع: بيانات وصفية ورابط، لا رفع ملفات ──
  async function docAdd() {
    const name = val('g-doc-name');
    if (!name) return toast('اسم الوثيقة مطلوب', true);
    const body = { name, kind: val('g-doc-kind') || 'other' };
    const url = val('g-doc-url'); if (url) body.url = url;
    try {
      await api('/projects/' + S().projectId + '/documents', 'POST', body);
      toast('أُضيفت الوثيقة ✓');
      setTimeout(() => location.reload(), 450);
    } catch (e) { toast(e.message, true); }
  }
  async function docDel(id) {
    if (!window.confirm('حذف هذه الوثيقة من قائمة المشروع؟')) return;
    try { await api('/projects/documents/' + id, 'DELETE'); toast('حُذفت الوثيقة ✓'); setTimeout(() => location.reload(), 450); }
    catch (e) { toast(e.message, true); }
  }

  // رابط «افتح المخرجات» يفتح القسم فعلاً لا يقف عند حافته: قفزةٌ إلى قسمٍ مطويّ تترك
  // المستخدم أمام عنوانٍ مغلق ولا يفهم أنه وصل — فيُفتح القسم ثم يُمرَّر إليه.
  function openSection(hash) {
    const host = document.querySelector(hash);
    const d = host && host.querySelector('details.psec');
    if (!d) return false;
    d.open = true;
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }
  document.addEventListener('click', (ev) => {
    const link = ev.target.closest('a[href^="#sec-"]');
    if (link) { if (openSection(link.getAttribute('href'))) ev.preventDefault(); return; }
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'gov-tab') return showTab(el.dataset.tab);
    if (a === 'gov-add') return void govAdd(el.dataset.kind);
    if (a === 'gov-status') return void govStatus(el.dataset.kind, el.dataset.id, el.dataset.status);
    if (a === 'gov-del') return void govDel(el.dataset.kind, el.dataset.id);
    if (a === 'prj-task-add') return void prjTaskAdd(el.dataset.project);
    if (a === 'prj-identity-save') return void prjIdentity(el.dataset.id);
    if (a === 'doc-add') return void docAdd();
    if (a === 'doc-del') return void docDel(el.dataset.id);
  });
  document.addEventListener('change', (ev) => {
    const gs = ev.target.closest('[data-action-change="gov-status-sel"]');
    if (gs) return void govStatus(gs.dataset.kind, gs.dataset.id, gs.value);
    const rg = ev.target.closest('[data-action-change="prj-rag-sel"]');
    if (rg) return void prjRag(rg.dataset.id, rg.value);
    const ss = ev.target.closest('[data-action-change="prj-status-sel"]');
    if (ss) return void prjStatus(ss.dataset.id, ss.value, ss);
  });
  // Enter inside an add-bar field submits that bar
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.id === 'prj-task-title') {
      ev.preventDefault();
      const btn = document.querySelector('[data-action="prj-task-add"]');
      if (btn) prjTaskAdd(btn.dataset.project);
      return;
    }
    if (ev.key !== 'Enter' || !ev.target.id || ev.target.id.indexOf('g-') !== 0) return;
    const bar = ev.target.closest('div');
    const btn = bar && bar.querySelector('[data-action="gov-add"]');
    if (btn) { ev.preventDefault(); govAdd(btn.dataset.kind); }
  });
  // restore the active tab from the hash (survives the post-mutation reload)
  const m = (location.hash || '').match(/^#gov-(\w+)/);
  if (m && document.querySelector('.gov-panel[data-panel="' + m[1] + '"]')) showTab(m[1]);

  // ── الأقسام المفتوحة تبقى مفتوحة ──
  // كل كتابة تعيد تحميل الصفحة، فبلا هذا ينطبق القسم الذي كان المستخدم يعمل فيه بعد كل إضافة
  // ويلزمه فتحه من جديد في كل مرة — وهو ما يجعل إضافة خمسة مخرجات خمس نقرات زائدة.
  // التخزين المحلي قد يكون ممنوعاً (تصفح خاص/سياسة)، فكل مساس به داخل حارس: فقدان التذكّر
  // إزعاجٌ صغير، وسقوط النص البرمجي كله يوقف كل أزرار الصفحة.
  const KEY = 'sanad.psec.open';
  const readOpen = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { return new Set(); } };
  const secs = document.querySelectorAll('details.psec[data-sec]');
  if (secs.length) {
    const saved = readOpen();
    // أول زيارة (لا تفضيل محفوظ): تبقى «نظرة عامة» وحدها مفتوحة كما صيّرها الخادم.
    if (localStorage.getItem(KEY) != null) {
      secs.forEach((d) => { d.open = saved.has(d.dataset.sec); });
    }
    secs.forEach((d) => d.addEventListener('toggle', () => {
      try {
        const now = [];
        secs.forEach((x) => { if (x.open) now.push(x.dataset.sec); });
        localStorage.setItem(KEY, JSON.stringify(now));
      } catch (e) { /* التذكّر رفاهية — لا يُسقط الصفحة */ }
    }));
  }
})();
