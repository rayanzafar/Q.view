(() => {
  const csrfToken = () => { const m = document.cookie.match(/(?:^|; )sanad_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; };
  // ── التوزيع الدوري (KI-110): مجاميع حيّة والمتبقي حتى يساوي السنوي — الخادم هو الحكم ──
  const plan = document.getElementById('sector-plan-form');
  if (plan) {
    const halalas = (v) => { const s = String(v || '').trim(); if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null; const [w, f = ''] = s.split('.'); return Number(w) * 100 + Number(f.padEnd(2, '0')); };
    const fmt = (h) => (h / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const annual = { sales: Number(plan.dataset.annualSales) || 0, revenue: Number(plan.dataset.annualRevenue) || 0 };
    const recalc = () => {
      for (const kind of ['sales', 'revenue']) {
        let sum = 0; let bad = false;
        plan.querySelectorAll(`[data-plan="${kind}"]`).forEach((inp) => { const h = halalas(inp.value); if (h == null) bad = true; else sum += h; });
        const rem = annual[kind] - sum;
        document.getElementById(`plan-sum-${kind}`).textContent = bad ? '—' : fmt(sum);
        const remEl = document.getElementById(`plan-rem-${kind}`);
        remEl.textContent = bad ? '—' : (rem === 0 ? 'مطابق ✓' : (rem > 0 ? `+${fmt(rem)}` : `−${fmt(-rem)}`));
        remEl.style.color = bad || rem !== 0 ? 'var(--amber, #b45309)' : 'var(--green, #15803d)';
      }
    };
    plan.addEventListener('input', recalc); recalc();
    plan.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!plan.reportValidity()) return;
      const status = document.getElementById('plan-save-status');
      const button = plan.querySelector('button[type="submit"]');
      const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, sales_sar: plan.querySelector(`[name="sales_${i + 1}"]`).value, revenue_sar: plan.querySelector(`[name="revenue_${i + 1}"]`).value }));
      button.disabled = true; status.textContent = 'جارٍ اعتماد التوزيع…';
      try {
        const response = await fetch('/api/org/sectors/' + encodeURIComponent(plan.dataset.sector) + '/targets/plan', {
          method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
          body: JSON.stringify({ year: plan.dataset.year, revision: plan.dataset.revision, reason: plan.querySelector('[name="reason"]').value, months }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || data.message || 'تعذر اعتماد التوزيع؛ راجع المجاميع وأعد المحاولة');
        location.reload();
      } catch (error) { status.textContent = error.message || 'تعذر الاتصال؛ حاول مرة أخرى'; button.disabled = false; }
    });
  }
  const form = document.getElementById('sector-targets-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const status = document.getElementById('target-save-status');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    status.textContent = 'جارٍ حفظ المستهدفات…';
    try {
      const fields = Object.fromEntries(new FormData(form));
      const csrf = document.cookie.match(/(?:^|; )sanad_csrf=([^;]+)/);
      const response = await fetch('/api/org/sectors/' + encodeURIComponent(form.dataset.sector) + '/targets', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ? decodeURIComponent(csrf[1]) : '' },
        body: JSON.stringify({ ...fields, year: form.dataset.year, revision: form.dataset.revision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || data.message || 'تعذر حفظ المستهدفات؛ راجع البيانات وأعد المحاولة');
      location.reload();
    } catch (error) { status.textContent = error.message || 'تعذر الاتصال؛ حاول مرة أخرى'; button.disabled = false; }
  });
})();
