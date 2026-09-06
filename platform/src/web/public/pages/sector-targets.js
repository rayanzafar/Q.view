(() => {
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
