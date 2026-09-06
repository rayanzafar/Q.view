// صفحة «صحة المنصة» — إسكاتُ عطلٍ وإلغاؤه، بتفويض الأحداث بلا onclick.
function opsToast(msg, bad) {
  const d = document.createElement('div');
  d.textContent = msg;
  d.setAttribute('role', 'status');
  d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;'
    + 'font-size:13px;max-width:min(92vw,420px);line-height:1.7;box-shadow:0 8px 24px rgba(0,0,0,.2);background:'
    + (bad ? '#b91c1c' : '#047857');
  document.body.appendChild(d);
  setTimeout(() => d.remove(), bad ? 5000 : 2400);
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action="fault-mute"]');
  if (!el) return;
  const muted = el.dataset.muted === '1';
  el.disabled = true;
  fetch('/api/ops/fault/' + encodeURIComponent(el.dataset.fp) + '/mute', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ muted: !muted }),
  }).then((r) => (r.ok ? r.json() : Promise.reject(r)))
    .then(() => { opsToast(muted ? 'أُلغي الإسكات' : 'أُسكت العطل — يبقى ظاهراً في آخر القائمة'); setTimeout(() => location.reload(), 900); })
    .catch(() => { opsToast('تعذّر تنفيذ الطلب — أعِد المحاولة.', true); el.disabled = false; });
});
