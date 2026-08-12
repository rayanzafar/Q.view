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
    // الحقل الغائب لا يُرسَل أصلاً (`undefined`) — وحقل القيمة يغيب عمّن لا يقرأ مال المشروع،
    // فإرسال فراغٍ مكانه كان سيصفّر قيمة عقدٍ لم يرها المستخدم ولم يقصد المساس بها.
    const pick = (el) => { const n = document.getElementById(el); return n ? (n.value || null) : undefined; };
    const body = { owner_user_id: pick('prj-owner'), department_id: pick('prj-dept'), client_id: pick('prj-client') };
    const name = pick('prj-name');
    if (name !== undefined) {
      if (!String(name || '').trim()) return toast('اسم المشروع مطلوب', true);
      body.name_ar = String(name).trim();
    }
    const code = pick('prj-code'); if (code !== undefined) body.code = code || '';
    const start = pick('prj-start'); if (start !== undefined) body.start_date = start || null;
    const end = pick('prj-end'); if (end !== undefined) body.end_date = end || null;
    if (body.start_date && body.end_date && body.end_date < body.start_date) {
      return toast('تاريخ الانتهاء قبل تاريخ البدء — راجع التاريخين', true);
    }
    const value = pick('prj-value');
    if (value !== undefined) {
      const n = Number(value || 0);
      if (!isFinite(n) || n < 0) return toast('قيمة العقد تُكتب رقماً بالريال', true);
      body.contract_value_sar = n;
    }
    // الإدارات المشاركة تُرسَل **كمجموعة كاملة** لا كإضافةٍ واحدة (عقد الفرص نفسه): ما في
    // الشاشة هو الحقيقة الجديدة، ومصفوفةٌ فارغة تعني «لا مشارك». ولا تُقرأ من حقلٍ معطَّل:
    // المعطَّل عرضٌ لا قرار — والخادم يحرسه أصلاً، لكن لا نرسل ما لا يُقصد.
    const partners = document.getElementById('prj-partners');
    if (partners && !partners.disabled) {
      body.partner_department_ids = [...partners.querySelectorAll('option:checked')].map((o) => o.value);
    }
    Object.keys(body).forEach((k) => { if (body[k] === undefined) delete body[k]; });
    try {
      await api('/projects/' + encodeURIComponent(id), 'PATCH', body);
      toast('حُفظت بيانات المشروع ✓');
      setTimeout(() => location.reload(), 500);
    } catch (e) { toast(e.message, true); }
  }

  // ── الإدارات المشاركة: منسدلة بصناديق اختيار تُزامن select الخفي (prj-partners) ──
  // نظير partnersSync في pages/opps.js حرفاً — بمعرّفات المشروع بدل الفرصة: الحقيقة في
  // select الخفي (الحفظ أعلاه يقرؤه)، والصناديق تُزامنه وتُحدّث الملصق مع كل نقرة.
  function partnersSync() {
    const sel = document.getElementById('prj-partners');
    const label = document.getElementById('prj-partners-label');
    if (!sel) return;
    const names = [];
    document.querySelectorAll('[data-partner-opt]').forEach((cb) => {
      const o = sel.querySelector('option[value="' + cb.value.replace(/"/g, '\\"') + '"]');
      if (o) o.selected = cb.checked;
      if (cb.checked) names.push((cb.parentElement.textContent || '').trim());
    });
    if (label) label.textContent = names.length ? names.join('، ') : 'بلا إدارات مشاركة';
  }
  document.addEventListener('change', (ev) => {
    if (ev.target && ev.target.matches && ev.target.matches('[data-partner-opt]')) partnersSync();
  });

  // ── المخرجات دفعةً واحدة: اقرأ ← راجِع ← احفظ ─────────────────────────────
  // الحالة تُحفظ في متغيّر واحد (`dlvxItems`) لا في وسوم الصفحة: الحذف من المراجعة يجب أن
  // يحذف من **ما سيُرسَل**، وقراءةُ القائمة من الصفحة عند الحفظ تجعل الاسم المعروض هو المصدر —
  // فيكفي تعديل نصٍّ في الشاشة كي يُحفظ غير ما استُخرج. والاسم يُصيَّر نصّاً لا وسماً.
  var dlvxItems = [];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sar = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US') + ' ر.س.');
  function dlvxRender() {
    const box = document.getElementById('dlvx-list');
    const wrap = document.getElementById('dlvx-review');
    if (!box || !wrap) return;
    document.getElementById('dlvx-n').textContent = String(dlvxItems.length);
    wrap.style.display = dlvxItems.length ? '' : 'none';
    box.innerHTML = dlvxItems.map((d, i) => '<div style="display:flex;align-items:center;gap:.5rem;padding:.3rem .2rem;border-bottom:1px dashed var(--line)">'
      + '<span style="flex:1;font-size:12px">' + esc(d.name_ar) + '</span>'
      + '<span class="tnum" style="font-size:11px;color:var(--muted)">' + esc(sar(d.amount_sar)) + '</span>'
      + (d.period ? '<span class="tnum" style="font-size:10.5px;color:var(--faint)">' + esc(d.period) + '</span>' : '')
      + '<button class="btn btn-ghost btn-sm" data-action="dlvx-drop" data-i="' + i + '" title="أزِل هذا السطر" aria-label="أزِل هذا السطر">✕</button></div>').join('');
  }
  async function dlvxParse(id) {
    const ta = document.getElementById('dlvx-text');
    const text = ta ? ta.value.trim() : '';
    if (text.length < 10) return toast('الصق نصّ المخرجات أولاً (١٠ أحرف على الأقل)', true);
    const mode = document.getElementById('dlvx-mode');
    if (mode) mode.textContent = '… جارٍ القراءة';
    try {
      const r = await api('/projects/' + encodeURIComponent(id) + '/deliverables/parse', 'POST', { text });
      dlvxItems = r.deliverables || [];
      if (mode) mode.textContent = (r._mode === 'local' ? '⚙ قراءة محلية' : '✨ قراءة ذكية') + (r._note ? ' — راجِع الأسماء والمبالغ' : '');
      dlvxRender();
      toast(dlvxItems.length ? 'قُرئ ' + dlvxItems.length + ' مخرَجاً — راجِعها قبل الحفظ' : 'لم يُقرأ أي مخرَج — راجِع النصّ', !dlvxItems.length);
    } catch (e) { if (mode) mode.textContent = ''; toast(e.message, true); }
  }
  async function dlvxSave(id) {
    if (!dlvxItems.length) return toast('لا مخرجات لإضافتها', true);
    try {
      const r = await api('/projects/' + encodeURIComponent(id) + '/deliverables/bulk', 'POST', { deliverables: dlvxItems });
      toast('أُضيف ' + r.added + ' مخرَجاً ✓');
      setTimeout(() => location.reload(), 600);
    } catch (e) { toast(e.message, true); }
  }
  function dlvxFile(ev) {
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { const ta = document.getElementById('dlvx-text'); if (ta) ta.value = String(r.result || '').slice(0, 20000); };
    r.readAsText(f);
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
      const added = await api('/tasks/quick', 'POST', body);
      toast(added && added.approval_state === 'PENDING'
        ? 'أُرسلت إلى مديرك للاعتماد — تظهر في عملك بعد اعتمادها' : 'أُضيفت المهمة ✓');
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
    // إغلاق منسدلة المشارِكات بالنقر خارجها — قبل حسم [data-action]: النقرة الخارجية لا تحمله.
    const pmenu = document.getElementById('prj-partners-menu');
    if (pmenu && !pmenu.hidden && !ev.target.closest('#prj-partners-pick')) {
      pmenu.hidden = true;
      const pbtn = document.querySelector('[data-action="partners-toggle"]');
      if (pbtn) pbtn.setAttribute('aria-expanded', 'false');
    }
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'partners-toggle') {
      const menu = document.getElementById('prj-partners-menu');
      if (menu) { menu.hidden = !menu.hidden; el.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true'); }
      return;
    }
    if (a === 'gov-tab') return showTab(el.dataset.tab);
    if (a === 'gov-add') return void govAdd(el.dataset.kind);
    if (a === 'gov-status') return void govStatus(el.dataset.kind, el.dataset.id, el.dataset.status);
    if (a === 'gov-del') return void govDel(el.dataset.kind, el.dataset.id);
    if (a === 'prj-task-add') return void prjTaskAdd(el.dataset.project);
    if (a === 'prj-identity-save') return void prjIdentity(el.dataset.id);
    if (a === 'doc-add') return void docAdd();
    if (a === 'doc-del') return void docDel(el.dataset.id);
    if (a === 'dlvx-parse') return void dlvxParse(el.dataset.id);
    if (a === 'dlvx-save') return void dlvxSave(el.dataset.id);
    if (a === 'dlvx-drop') { dlvxItems.splice(Number(el.dataset.i), 1); return dlvxRender(); }
    if (a === 'dlvx-cancel') { dlvxItems = []; return dlvxRender(); }
  });
  document.addEventListener('change', (ev) => {
    if (ev.target && ev.target.id === 'dlvx-file') dlvxFile(ev);
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
    // Esc يغلق منسدلة المشارِكات ويعيد التركيز إلى زرّها — فلوحة المفاتيح تخرج كما دخلت.
    if (ev.key === 'Escape') {
      const pm = document.getElementById('prj-partners-menu');
      if (pm && !pm.hidden) {
        pm.hidden = true;
        const pb = document.querySelector('[data-action="partners-toggle"]');
        if (pb) { pb.setAttribute('aria-expanded', 'false'); pb.focus(); }
      }
      return;
    }
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
