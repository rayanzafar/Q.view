// Project governance tabs (WP17) — tab switching + add/status/delete via the governance API.
// Server renders every panel; this script only switches visibility and posts mutations.
(function () {
  'use strict';
  const S = () => (window.__SANAD && window.__SANAD.gov) || {};
  const PLURAL = { milestone: 'milestones', risk: 'risks', issue: 'issues', decision: 'decisions', change: 'changes', deliverable: 'deliverables' };
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
    milestone: () => ({ name_ar: val('g-mls-name'), due_date: val('g-mls-due') }),
    risk: () => ({ title: val('g-rsk-title'), probability: val('g-rsk-prob'), impact: val('g-rsk-impact'), mitigation: val('g-rsk-mit'), owner_user_id: val('g-rsk-owner') }),
    issue: () => ({ title: val('g-iss-title'), severity: val('g-iss-sev'), owner_user_id: val('g-iss-owner') }),
    decision: () => ({ title: val('g-dec-title'), detail: val('g-dec-detail'), decided_by: val('g-dec-by'), decided_at: val('g-dec-at') }),
    change: () => ({ title: val('g-chg-title'), impact: val('g-chg-impact') }),
    // المخرَج: الاسم وحده مطلوب. الشهر والقيمة اختياريان ويُحذفان إن تُركا فارغين — فلا يُخزَّن
    // صفرٌ مكان قيمة لم تُتفق بعد.
    deliverable: () => ({ name_ar: val('g-dlv-name'), period: val('g-dlv-period'), amount_sar: val('g-dlv-amount') }),
  };
  const ADD_MSG = { milestone: 'اسم المعلم مطلوب', deliverable: 'اسم المخرج مطلوب' };

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
  async function prjRag(id, rag) {
    try { await api('/projects/' + id, 'PATCH', { rag }); toast('حُدّثت حالة المشروع ✓'); setTimeout(() => location.reload(), 450); }
    catch (e) { toast(e.message, true); }
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
    try {
      await api('/tasks/quick', 'POST', body);
      toast('أُضيفت المهمة ✓');
      setTimeout(() => location.reload(), 450);
    } catch (e) { toast(e.message, true); }
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'gov-tab') return showTab(el.dataset.tab);
    if (a === 'gov-add') return void govAdd(el.dataset.kind);
    if (a === 'gov-status') return void govStatus(el.dataset.kind, el.dataset.id, el.dataset.status);
    if (a === 'gov-del') return void govDel(el.dataset.kind, el.dataset.id);
    if (a === 'prj-task-add') return void prjTaskAdd(el.dataset.project);
  });
  document.addEventListener('change', (ev) => {
    const gs = ev.target.closest('[data-action-change="gov-status-sel"]');
    if (gs) return void govStatus(gs.dataset.kind, gs.dataset.id, gs.value);
    const rg = ev.target.closest('[data-action-change="prj-rag-sel"]');
    if (rg) return void prjRag(rg.dataset.id, rg.value);
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
})();
