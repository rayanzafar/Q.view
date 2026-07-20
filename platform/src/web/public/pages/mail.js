// مركز البريد — معاينة الرسائل داخل نافذة (تفويض الأحداث بلا onclick داخلي)
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
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('mail-preview')?.classList.remove('on'); });
