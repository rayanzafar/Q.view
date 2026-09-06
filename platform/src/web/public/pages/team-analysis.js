// عميل «تحليل الاستخدام» و«فحص الحالة» (S17/S18 — وحدة الفريق والموارد).
// تفويض data-action فقط (لا onclick): الفلاتر تعيد التحميل بالرابط، درج «تعريف المؤشرات»
// يُبنى من قالبٍ خامل رسمه الخادم، ونموذجا المتابعة والإغلاق يكتبان عبر /api/team/analysis/…
// ولا يعلنان نجاحاً قبل ردّ الخادم. كل البيانات من window.__SANAD (مقصوصة بصلاحية القارئ).
(function () {
  'use strict';
  const S = () => window.__SANAD || {};
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

  // ── الفلاتر: حالة الصفحة في الرابط — تغيير قائمةٍ يعيد التحميل بها ─────────────────
  document.addEventListener('change', (e) => {
    const form = e.target.closest('form[data-autosubmit]');
    if (!form || e.target.tagName !== 'SELECT') return;
    if (form.requestSubmit) form.requestSubmit(); else form.submit();
  });

  // ── درج «تعريف المؤشرات»: من القالب الخامل، إغلاق بالزر وEsc والخلفية، وعودة التركيز ──
  let opener = null;
  const drawer = () => document.getElementById('tm-drawer');
  const scrim = () => document.getElementById('tm-scrim');
  function openDefinitions(btn) {
    const d = drawer();
    const t = document.getElementById('dd-analysis-definitions');
    if (!d || !t) { if (window.Sanad && window.Sanad.openDD) window.Sanad.openDD('analysis-definitions'); return; }
    const body = document.getElementById('tm-drawer-body');
    body.innerHTML = '';
    body.appendChild(t.content.cloneNode(true));
    opener = btn || document.activeElement;
    d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
    if (scrim()) scrim().classList.add('open');
    const close = d.querySelector('[data-action="drawer-close"]');
    if (close) close.focus();
  }
  function closeDrawer() {
    const d = drawer();
    if (!d || !d.classList.contains('open')) return;
    d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
    if (scrim()) scrim().classList.remove('open');
    if (opener && opener.focus) opener.focus();
    opener = null;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'definitions') { e.preventDefault(); openDefinitions(el); }
    else if (a === 'drawer-close') { e.preventDefault(); closeDrawer(); }
  });

  // ── S18: نموذج المتابعة ونموذج الإغلاق ─────────────────────────────────────────────
  document.addEventListener('change', (e) => {
    if (e.target.name !== 'action_ar') return;
    const form = e.target.closest('form[data-form="followup"]');
    if (!form) return;
    const other = form.querySelector('[data-other]');
    if (other) { other.hidden = e.target.value !== '__other'; if (!other.hidden) { const i = other.querySelector('input'); if (i) i.focus(); } }
  });
  const errBox = (form) => form.querySelector('[data-err]');
  const showErr = (form, msg) => { const b = errBox(form); if (b) { b.textContent = msg; b.hidden = false; b.focus && b.focus(); } else toast(msg, true); };
  const clearErr = (form) => { const b = errBox(form); if (b) { b.textContent = ''; b.hidden = true; } };
  const busy = (form, on) => {
    form.querySelectorAll('[data-submit]').forEach((b) => { b.disabled = on; });
    form.setAttribute('aria-busy', on ? 'true' : 'false');
  };
  const ownerName = (id) => {
    const o = ((S().teamCase || {}).owners || []).find((x) => x.id === id);
    return o ? o.name : (id || '—');
  };
  const caseCard = (c) => {
    if (!c) return '';
    const t = c.task || null;
    return '<div class="tm-sec" style="margin-top:.6rem"><div class="sh" style="margin-bottom:.3rem">' + esc(t ? t.title : 'متابعة') + '</div>'
      + '<div class="tm-note" style="flex-wrap:wrap"><span>المسؤول: <b>' + esc(ownerName(c.ownerUserId)) + '</b></span>'
      + (c.due_date ? '<span>· الموعد <span class="tnum">' + esc(c.due_date) + '</span></span>' : '')
      + (t && t.status_ar ? '<span>· حالة المهمة: ' + esc(t.status_ar) + '</span>' : '') + '</div>'
      + (c.ownerUserId ? '<div style="margin-top:.5rem"><a class="btn btn-sm" href="/app/person/' + encodeURIComponent(c.ownerUserId) + '">مهام المسؤول</a></div>' : '')
      + '</div>';
  };
  function renderResult(form, tone, msg, c) {
    const box = document.createElement('div');
    box.className = tone === 'ok' ? 'tm-ok' : 'tm-warn';
    box.setAttribute('role', 'status');
    box.innerHTML = esc(msg) + caseCard(c);
    form.parentNode.insertBefore(box, form);
    form.hidden = true;
  }

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    clearErr(form);
    if (kind === 'followup') {
      const sel = form.elements.action_ar;
      const other = form.elements.action_other;
      const action_ar = sel && sel.value === '__other' ? String((other && other.value) || '').trim() : String((sel && sel.value) || '').trim();
      if (!action_ar) return showErr(form, 'اكتب الإجراء المطلوب أو اختره من القائمة');
      const ownerUserId = form.elements.owner ? form.elements.owner.value : '';
      if (!ownerUserId) return showErr(form, 'اختر المسؤول عن المتابعة');
      const payload = {
        year: Number(form.dataset.year), month: Number(form.dataset.month), signal: form.dataset.signal || undefined,
        action_ar, ownerUserId,
        dueDate: form.elements.due && form.elements.due.value ? form.elements.due.value : undefined,
        note: form.elements.note && form.elements.note.value.trim() ? form.elements.note.value.trim() : undefined,
      };
      busy(form, true);
      try {
        const r = await api('/team/analysis/' + encodeURIComponent(form.dataset.employee) + '/followup', 'POST', payload);
        if (r.existing) {
          renderResult(form, 'warn', 'توجد متابعة قائمة لهذه الحالة — تُعرض هنا ولم تُنشأ ثانية.', r);
          toast('توجد متابعة قائمة لهذه الحالة', true);
        } else {
          renderResult(form, 'ok', r.reopened ? 'أُعيد فتح الحالة بمهمة جديدة للمسؤول.' : 'سُجّلت المتابعة كمهمة للمسؤول.', r);
          toast('حُفظت المتابعة ✓');
        }
        setTimeout(() => location.reload(), 1200);
      } catch (err) {
        showErr(form, err.message || 'تعذّر حفظ المتابعة — حاول مرة أخرى');
        busy(form, false);
      }
    } else if (kind === 'close-case') {
      const explanation = String((form.elements.explanation && form.elements.explanation.value) || '').trim();
      if (!explanation) return showErr(form, 'اكتب تفسير الإغلاق — ما الذي تبيّن وما القرار');
      busy(form, true);
      try {
        await api('/team/analysis/cases/' + encodeURIComponent(form.dataset.case) + '/close', 'POST', { explanation });
        toast('أُغلقت الحالة ✓');
        setTimeout(() => location.reload(), 700);
      } catch (err) {
        showErr(form, err.message || 'تعذّر إغلاق الحالة — حاول مرة أخرى');
        busy(form, false);
      }
    }
  });
})();
