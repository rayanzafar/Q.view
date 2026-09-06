// عميل «الاحتياجات القادمة» ونموذج الاحتياج و«مقارنة المرشحين» (S19/S20/S21 — وحدة الفريق والموارد).
// تفويض data-action فقط (لا onclick). الحفظ عبر /api/team/needs/… ولا نجاح قبل ردّ الخادم؛ خطأ
// الخادم يُعرض بنصّه ويسمح بإعادة المحاولة؛ تعطيل الأزرار أثناء الإرسال. الاختيار في المقارنة لا
// يحجز شيئاً — الطلب يمرّ بمراجعة مدير المورد. كل البيانات من window.__SANAD (مقصوصة خادمياً).
(function () {
  'use strict';
  const S = () => window.__SANAD || {};
  const ND = () => S().teamNeeds || {};
  const CD = () => S().needCandidates || {};
  const esc = (s) => (window.Sanad && window.Sanad.esc ? window.Sanad.esc(s)
    : String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

  const api = async (path, method, body) => {
    const r = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || 'تعذّر إتمام الطلب — حاول مرة أخرى');
    return j;
  };
  const toast = (msg, bad) => {
    const d = document.createElement('div');
    d.textContent = msg;
    d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#dc2626' : '#059669');
    document.body.appendChild(d); setTimeout(() => d.remove(), 2800);
  };

  // اتفاق العدد والمعدود — مرآة demandAr الخادمية حرفاً
  const countAr = (n) => (n === 1 ? 'مورد واحد' : n === 2 ? 'موردان' : n <= 10 ? n + ' موارد' : n + ' مورداً');
  const demandAr = (h, p) => countAr(h) + ' × ' + p + '% من الدوام الكامل طوال الفترة';
  const lastDay = (ym) => { const p = ym.split('-').map(Number); return ym + '-' + String(new Date(Date.UTC(p[0], p[1], 0)).getUTCDate()).padStart(2, '0'); };
  const splitSkills = (s) => Array.from(new Set(String(s || '').split(/[,،]/).map((x) => x.trim()).filter(Boolean)));

  // ── الفلاتر: قوائم الاختيار والأشهر تعيد التحميل بالرابط؛ البحث النصي بزرّه ─────────
  document.addEventListener('change', (e) => {
    const form = e.target.closest('form[data-autosubmit]');
    if (!form) return;
    const t = e.target;
    if (t.tagName !== 'SELECT' && !(t.tagName === 'INPUT' && t.type === 'month')) return;
    if (form.requestSubmit) form.requestSubmit(); else form.submit();
  });

  // ── S20: درج الاحتياج ─────────────────────────────────────────────────────────────
  let opener = null; let dirty = false; let editing = null; let lastThen = 'list';
  const drawer = () => document.getElementById('tm-need-drawer');
  const form = () => document.getElementById('tm-need-form');
  const scrim = () => document.getElementById('tm-scrim');
  const box = (sel) => (form() ? form().querySelector(sel) : null);
  const show = (sel, msg) => { const b = box(sel); if (!b) return; b.textContent = msg || ''; b.hidden = !msg; };

  function setSource(kind) {
    const f = form(); if (!f) return;
    f.querySelectorAll('[data-src]').forEach((el) => { el.hidden = el.dataset.src !== kind; });
  }
  function renderChips(name) {
    const f = form(); if (!f) return;
    const inp = f.elements[name]; const out = f.querySelector('[data-chips="' + name + '"]');
    if (!inp || !out) return;
    out.innerHTML = splitSkills(inp.value).map((s) => '<span class="tm-nd-chip' + (name === 'skills_preferred' ? ' pref' : '') + '">' + esc(s) + '</span>').join('');
  }
  function updateDemand() {
    const f = form(); if (!f) return;
    const h = Math.max(1, Math.round(Number(f.elements.headcount.value) || 0));
    const p = Math.max(0, Math.round(Number(f.elements.fte_pct.value) || 0));
    const el = f.querySelector('[data-demand]');
    if (el) el.textContent = 'إجمالي الطلب: ' + demandAr(h, p);
  }
  function setSelect(sel, value, label) {
    if (!sel) return;
    if (value && !Array.from(sel.options).some((o) => o.value === value)) {
      const o = document.createElement('option'); o.value = value; o.textContent = label || value; sel.appendChild(o);
    }
    sel.value = value || '';
  }
  function fill(n) {
    const f = form();
    const hid = f.elements.namedItem('id'); if (hid) hid.value = n.id || '';
    const kind = n.source && n.source.kind ? n.source.kind : 'project';
    const radio = f.querySelector('input[name="source_kind"][value="' + kind + '"]');
    if (radio) radio.checked = true;
    setSource(kind);
    if (kind === 'project') setSelect(f.elements.source_project, n.source.id, n.source.label);
    else if (kind === 'opportunity') setSelect(f.elements.source_opportunity, n.source.id, n.source.label);
    else setSelect(f.elements.source_bucket, n.source.id, n.source.label);
    if (f.elements.sector_id && n.sector_id) setSelect(f.elements.sector_id, n.sector_id, n.sector_id);
    const owner = f.querySelector('[data-owner]'); if (owner && n.owner) owner.textContent = n.owner;
    f.elements.role_ar.value = n.role_ar || '';
    setSelect(f.elements.level, n.level || '', n.level || '');
    f.elements.skills_required.value = (n.skills && n.skills.required || []).join('، ');
    f.elements.skills_preferred.value = (n.skills && n.skills.preferred || []).join('، ');
    f.elements.from_month.value = String(n.from || '').slice(0, 7);
    f.elements.to_month.value = String(n.to || '').slice(0, 7);
    f.elements.headcount.value = n.headcount || 1;
    f.elements.fte_pct.value = n.ftePct || 100;
    f.elements.splittable.checked = !!n.splittable;
    f.elements.goal.value = n.goal || '';
    f.elements.decide_by.value = n.decide_by || '';
    const cert = f.querySelector('input[name="certainty"][value="' + (n.certainty === 'tentative' ? 'tentative' : 'confirmed') + '"]');
    if (cert) cert.checked = true;
    if (n.requests > 0) {
      show('[data-impact]', 'لهذا الاحتياج ' + n.requests + ' طلب تسكين مرتبط (' + (n.coverage_ar || '') + ') — تغيير الفترة أو الحجم أو المهارات يعيد تقييم المرشحين والطلبات القائمة ولا يتركهم ملائمين على نسخة قديمة.');
    }
  }
  function openDrawer(mode, id, btn) {
    const d = drawer(); const f = form();
    if (!d || !f) return;
    f.reset(); editing = null; dirty = false;
    show('[data-err]', ''); show('[data-impact]', '');
    const title = d.querySelector('#tm-need-title');
    if (mode === 'edit') {
      const n = (ND().needs || {})[id];
      if (!n) { toast('لا يمكن تعديل هذا الاحتياج من هنا — افتحه من صاحبه أو مدير إدارته', true); return; }
      editing = n; fill(n);
      if (title) title.textContent = 'تعديل الاحتياج';
    } else {
      setSource('project');
      const owner = f.querySelector('[data-owner]'); if (owner && owner.dataset.me) owner.textContent = owner.dataset.me;
      if (title) title.textContent = 'إضافة احتياج';
    }
    renderChips('skills_required'); renderChips('skills_preferred'); updateDemand();
    opener = btn || document.activeElement;
    d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
    if (scrim()) scrim().classList.add('open');
    setTimeout(() => { if (f.elements.role_ar) f.elements.role_ar.focus(); }, 30);
  }
  function closeDrawer(force) {
    const d = drawer();
    if (!d || !d.classList.contains('open')) return;
    if (dirty && !force && !window.confirm('لديك تعديلات غير محفوظة — إغلاق النموذج وفقدانها؟')) return;
    d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
    if (scrim()) scrim().classList.remove('open');
    dirty = false; editing = null;
    if (opener && opener.focus) opener.focus();
    opener = null;
  }
  document.addEventListener('input', (e) => {
    const f = form(); if (!f || !f.contains(e.target)) return;
    dirty = true;
    if (e.target.name === 'skills_required' || e.target.name === 'skills_preferred') renderChips(e.target.name);
    if (e.target.name === 'headcount' || e.target.name === 'fte_pct') updateDemand();
  });
  document.addEventListener('change', (e) => {
    const f = form(); if (!f || !f.contains(e.target)) return;
    dirty = true;
    if (e.target.name === 'source_kind') setSource(e.target.value);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(false); });

  function needPayload(f) {
    const kind = (f.querySelector('input[name="source_kind"]:checked') || {}).value || 'project';
    const srcSel = kind === 'project' ? f.elements.source_project : kind === 'opportunity' ? f.elements.source_opportunity : f.elements.source_bucket;
    const source_id = srcSel ? srcSel.value : '';
    const role_ar = f.elements.role_ar.value.trim();
    const from = f.elements.from_month.value; const to = f.elements.to_month.value;
    if (!role_ar) return { error: 'اكتب الدور المطلوب — مثل «محلل بيانات»' };
    if (!source_id) return { error: kind === 'project' ? 'اختر المشروع' : kind === 'opportunity' ? 'اختر الفرصة' : 'اختر بند العمل الداخلي' };
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) return { error: 'حدّد شهر البداية وشهر النهاية' };
    if (from > to) return { error: 'شهر البداية بعد شهر النهاية — صحّح الفترة' };
    const headcount = Math.round(Number(f.elements.headcount.value));
    const fte_pct = Math.round(Number(f.elements.fte_pct.value));
    if (!(headcount >= 1)) return { error: 'عدد الموارد رقم صحيح لا يقل عن 1' };
    if (!(fte_pct >= 1 && fte_pct <= 100)) return { error: 'نسبة الطاقة لكل مورد من 1 إلى 100' };
    const payload = {
      source_kind: kind, source_id, role_ar,
      level: f.elements.level.value || null,
      skills: { required: splitSkills(f.elements.skills_required.value), preferred: splitSkills(f.elements.skills_preferred.value) },
      from_date: from + '-01', to_date: lastDay(to), headcount, fte_pct,
      certainty: (f.querySelector('input[name="certainty"]:checked') || {}).value || 'confirmed',
      decide_by: f.elements.decide_by.value || null,
      splittable: !!f.elements.splittable.checked,
      goal: f.elements.goal.value.trim() || null,
    };
    if (kind === 'bucket' && f.elements.sector_id) payload.sector_id = f.elements.sector_id.value;
    return { payload };
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action],[data-submit]');
    if (!el) return;
    if (el.hasAttribute('data-submit') && el.dataset.then) { lastThen = el.dataset.then; return; }
    const a = el.dataset.action;
    if (a === 'need-new') { e.preventDefault(); openDrawer('new', null, el); }
    else if (a === 'need-edit') { e.preventDefault(); openDrawer('edit', el.dataset.id, el); }
    else if (a === 'need-close') { e.preventDefault(); closeDrawer(false); }
    else if (a === 'need-cancel') { e.preventDefault(); cancelNeed(el); }
    else if (a === 'cd-submit') { e.preventDefault(); submitRequest(el); }
  });

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form="need"]');
    if (!f) return;
    e.preventDefault();
    show('[data-err]', '');
    const then = (e.submitter && e.submitter.dataset.then) || lastThen || 'list';
    const built = needPayload(f);
    if (built.error) { show('[data-err]', built.error); return; }
    const buttons = f.querySelectorAll('[data-submit]');
    buttons.forEach((b) => { b.disabled = true; });
    f.setAttribute('aria-busy', 'true');
    try {
      const r = editing
        ? await api('/team/needs/' + encodeURIComponent(editing.id), 'PATCH', built.payload)
        : await api('/team/needs', 'POST', built.payload);
      dirty = false;
      const id = r && r.id ? r.id : (editing ? editing.id : '');
      if (editing && r && Array.isArray(r.requests) && r.requests.length) toast('حُفظ التعديل — يُعاد تقييم ' + r.requests.length + ' طلب مرتبط');
      else toast(editing ? 'حُفظ التعديل ✓' : 'سُجّل الاحتياج — لم يُحجز أي مورد ✓');
      if (then === 'candidates' && id) { location.href = '/app/team/needs/' + encodeURIComponent(id); return; }
      const p = new URLSearchParams(location.search); p.delete('new'); p.delete('edit');
      const qs = p.toString();
      location.href = location.pathname + (qs ? '?' + qs : '');
    } catch (err) {
      show('[data-err]', err.message || 'تعذّر الحفظ — حاول مرة أخرى');
      buttons.forEach((b) => { b.disabled = false; });
      f.setAttribute('aria-busy', 'false');
    }
  });

  async function cancelNeed(btn) {
    const id = btn.dataset.id; const role = btn.dataset.role || 'الاحتياج';
    if (!id) return;
    if (!window.confirm('إلغاء الاحتياج «' + role + '»؟ يبقى في السجل بحالة «ملغى» ولا يُحذف.')) return;
    const reason = window.prompt('سبب الإلغاء (اختياري)', '');
    if (reason === null) return;
    btn.disabled = true;
    try {
      await api('/team/needs/' + encodeURIComponent(id) + '/cancel', 'POST', { reason: reason.trim() || undefined });
      toast('أُلغي الاحتياج ✓');
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      toast(err.message || 'تعذّر الإلغاء', true);
      btn.disabled = false;
    }
  }

  // فتح الدرج بسياق الرابط (?new=1 أو ?edit=<id>) — بعد رسم الصفحة كاملة
  if (ND().open === 'new') openDrawer('new');
  else if (ND().open === 'edit' && ND().editId) openDrawer('edit', ND().editId);

  // ── S21: اختيار مرشح وإعداد طلب التسكين — الاختيار عرضٌ فقط، والحجز بالطلب المعتمد ──
  let selected = null;
  const panel = () => document.getElementById('tm-cd-panel');
  const clampPct = (v) => { v = Math.round(Number(v)); if (!Number.isFinite(v) || v < 1) v = 1; return Math.min(v, 100); };

  function renderMonths() {
    const p = panel(); const row = (CD().rows || {})[selected];
    if (!p || !row) return;
    const pct = clampPct(p.querySelector('[name="pct"]').value);
    let worst = 0; let worstMonth = '';
    const lines = (row.availability || []).map((a) => {
      if (a.state === 'out' || a.availablePct == null) return '<div>' + esc(a.label_ar) + ': خارج الارتباط</div>';
      const c = Number(a.confirmedPct) || 0; const q = Number(a.pendingPct) || 0; const total = c + q + pct;
      if (total > worst) { worst = total; worstMonth = a.label_ar; }
      return '<div class="tnum' + (total > 100 ? ' over' : '') + '">' + esc(a.label_ar) + ': مؤكد ' + c + '% + معلَّق ' + q + '% + المطلوب ' + pct + '% = ' + total + '%' + (total > 100 ? ' — تعارض محتمل' : '') + '</div>';
    });
    const months = p.querySelector('[data-cd-months]');
    if (months) months.innerHTML = lines.join('');
    const warn = p.querySelector('[data-cd-warn]');
    if (warn) {
      warn.hidden = !(worst > 100);
      warn.textContent = worst > 100 ? 'تعارض محتمل: الإجمالي المحتمل ' + worst + '% في ' + worstMonth + ' إن اعتُمد الطلب المعلَّق — المعلَّق لا يُخصم من المتاح المؤكد.' : '';
    }
  }
  function onSelect(radio) {
    const id = radio.value; const row = (CD().rows || {})[id];
    if (!row) return;
    selected = id;
    document.querySelectorAll('tr[data-emp]').forEach((tr) => tr.classList.toggle('is-sel', tr.dataset.emp === id));
    const p = panel(); if (!p) return;
    p.hidden = false;
    const name = p.querySelector('[data-cand-name]'); if (name) name.textContent = row.name + ' · قبل إنشاء الطلب';
    const ok = p.querySelector('[data-cd-ok]'); if (ok) { ok.hidden = true; ok.innerHTML = ''; }
    const err = p.querySelector('[data-cd-err]'); if (err) { err.hidden = true; err.textContent = ''; }
    const btn = p.querySelector('[data-action="cd-submit"]'); if (btn) btn.disabled = false;
    renderMonths();
    p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  document.addEventListener('change', (e) => {
    if (e.target.matches('input[data-action="cand-select"]')) onSelect(e.target);
    else if (e.target.matches('#tm-cd-panel [name="pct"]')) renderMonths();
  });
  document.addEventListener('input', (e) => { if (e.target.matches('#tm-cd-panel [name="pct"]')) renderMonths(); });

  async function submitRequest(btn) {
    const p = panel(); if (!p) return;
    const err = p.querySelector('[data-cd-err]'); const ok = p.querySelector('[data-cd-ok]');
    if (err) { err.hidden = true; err.textContent = ''; }
    if (!selected) { toast('اختر مرشحاً أولاً', true); return; }
    const raw = Number(p.querySelector('[name="pct"]').value);
    if (!(raw >= 1 && raw <= 100)) { if (err) { err.textContent = 'نسبة التسكين المطلوبة رقم صحيح من 1 إلى 100'; err.hidden = false; } return; }
    const allocStatus = (p.querySelector('input[name="allocStatus"]:checked') || {}).value || 'confirmed';
    btn.disabled = true; p.setAttribute('aria-busy', 'true');
    try {
      const r = await api('/team/needs/' + encodeURIComponent(CD().needId) + '/request', 'POST', { employeeId: selected, pct: Math.round(raw), allocStatus });
      const rid = r.requestId || (r.request && r.request.id) || '';
      if (ok) {
        ok.innerHTML = 'أُرسل طلب التسكين — '
          + (rid ? '<a href="/app/team/requests/' + encodeURIComponent(rid) + '" style="text-decoration:underline">فتح الطلب</a>' : '<a href="/app/team/requests" style="text-decoration:underline">طلبات التسكين</a>')
          + '. لم يتغيّر التسكين بعد: ينتظر قرار مدير المورد.';
        ok.hidden = false;
      }
      toast('أُرسل طلب التسكين ✓');
      // الزر يبقى معطلاً بعد النجاح: الطلب الثاني لنفس المرشح يردّه الخادم، ولا داعي لإغرائه.
    } catch (e2) {
      if (err) { err.textContent = e2.message || 'تعذّر إرسال الطلب — حاول مرة أخرى'; err.hidden = false; }
      btn.disabled = false;
    } finally { p.setAttribute('aria-busy', 'false'); }
  }
})();
