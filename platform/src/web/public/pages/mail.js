// مركز البريد — معاينة الرسائل داخل نافذة، وحفظ سياسة بريد الاعتمادات (تفويض أحداث بلا onclick)
function mailToast(msg, bad) {
  const d = document.createElement('div');
  d.textContent = msg;
  d.setAttribute('role', 'status');
  d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;'
    + 'font-size:13px;max-width:min(92vw,420px);line-height:1.7;box-shadow:0 8px 24px rgba(0,0,0,.2);background:'
    + (bad ? '#b91c1c' : '#047857');
  document.body.appendChild(d);
  setTimeout(() => d.remove(), bad ? 5200 : 2600);
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const modal = document.getElementById('mail-preview');
  if (el.dataset.action === 'preview-mail') {
    document.getElementById('mail-frame').src = '/app/mail/preview/' + encodeURIComponent(el.dataset.file);
    modal.classList.add('on');
  }
  if (el.dataset.action === 'close-mail' || (el.dataset.action === 'close-mail-modal' && e.target === modal)) {
    modal.classList.remove('on');
    document.getElementById('mail-frame').src = 'about:blank';
  }
  if (el.dataset.action === 'save-mail-policy') {
    el.disabled = true;
    fetch('/api/mail/approval-policy', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reminder_enabled: document.getElementById('pol-reminder')?.checked ? '1' : '0',
        reminder_hours: Number(document.getElementById('pol-hours')?.value || 0),
        cooldown_minutes: Number(document.getElementById('pol-cooldown')?.value || -1),
      }),
    }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || 'تعذّر الحفظ — أعد المحاولة');
      mailToast('حُفظت سياسة بريد الاعتمادات ✓');
      el.disabled = false;
    }).catch((err) => { el.disabled = false; mailToast(err.message, true); });
  }
});
// حقل الفاصل يعمل فقط حين يكون التذكير مفعّلاً — تعطيلُه يقول «لا أثر لهذا الرقم الآن».
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'pol-reminder') {
    const h = document.getElementById('pol-hours');
    if (h) h.disabled = !e.target.checked;
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('mail-preview')?.classList.remove('on'); });
