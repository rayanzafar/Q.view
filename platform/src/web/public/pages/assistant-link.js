(() => {
  const csrfToken = () => { const m = document.cookie.match(/(?:^|; )sanad_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; };
  const say = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

  document.addEventListener('click', async (event) => {
    const copy = event.target.closest('[data-action="copy-link"]');
    if (copy) {
      const field = document.getElementById('link-url');
      field.select();
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(field.value);
        else document.execCommand('copy');
        say('copy-status', 'نُسخ الرابط ✓');
      } catch { say('copy-status', 'تعذّر النسخ — حدّد الرابط وانسخه يدوياً'); }
      return;
    }
    const cut = event.target.closest('[data-action="cut-link"]');
    if (!cut) return;
    const name = cut.dataset.name || 'هذا المساعد';
    if (!window.confirm(`سيتوقف «${name}» عن الوصول إلى سند فوراً، ويحتاج إذناً جديداً منك. هل تريد قطع الربط؟`)) return;
    cut.disabled = true;
    say('cut-status', 'جارٍ قطع الربط…');
    try {
      const response = await fetch('/api/mcp/connections/' + encodeURIComponent(cut.dataset.client), {
        method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken() },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || data.message || 'تعذّر قطع الربط؛ أعد المحاولة');
      const row = cut.closest('tr');
      if (row) row.remove();
      say('cut-status', `قُطع ربط «${name}» ✓`);
    } catch (error) {
      cut.disabled = false;
      say('cut-status', error.message || 'تعذّر الاتصال؛ حاول مرة أخرى');
    }
  });
})();
