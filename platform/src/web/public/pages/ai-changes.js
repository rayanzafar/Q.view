// «تغييرات تنتظر تأكيدك» — الضغطتان اللتان تُنفِّذان أو تردّان.
//
// التأكيدُ يسأل سؤالاً واحداً قبل الإرسال، ونصُّه من عنوان البطاقة نفسها لا عبارة عامة: من
// يضغط عن غير قصد يقرأ اسم ما سيقع لا كلمة «تأكيد». والزرّان يُعطَّلان أثناء الإرسال فلا يُرسَل
// الطلبُ مرتين، ورسالةُ الخادم تُعرض كما جاءت — هي التي تعرف لماذا رُدّ الطلب.
(() => {
  const csrfToken = () => { const m = document.cookie.match(/(?:^|; )sanad_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; };

  // البطاقةُ هي القسم لا الزرّ: الزرّ يحمل `data-token` كذلك، فـ`closest` عليه وحده يعود بالزرّ
  // فيضيع عنوانُ ما نسأل عنه ويصير السؤال «هل تؤكّد هذا التغيير» بلا تسميةٍ لما سيقع.
  const cardOf = (el) => el.closest('section[data-token]');
  const statusIn = (card, text) => { const el = card.querySelector('[data-role="row-status"]'); if (el) el.textContent = text; };
  const buttonsIn = (card) => Array.from(card.querySelectorAll('button[data-action]'));

  async function send(card, token, path, working) {
    const buttons = buttonsIn(card);
    buttons.forEach((b) => { b.disabled = true; });
    statusIn(card, working);
    try {
      const response = await fetch(`/api/ai/pending/${encodeURIComponent(token)}/${path}`, {
        method: 'POST', headers: { 'X-CSRF-Token': csrfToken(), 'Content-Type': 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || data.message || 'تعذّر إتمام الطلب؛ أعد المحاولة');
      return data;
    } catch (error) {
      buttons.forEach((b) => { b.disabled = false; });
      statusIn(card, error.message || 'تعذّر الاتصال؛ حاول مرة أخرى');
      return null;
    }
  }

  // البطاقةُ تُستبدل بسطرِ نتيجة بدل أن تختفي: من ضغط يرى ماذا وقع، ولا يبحث عن بطاقةٍ زالت.
  const settle = (card, text, tone) => {
    const note = document.createElement('div');
    note.className = `alert ${tone}`;
    note.setAttribute('role', 'status');
    note.textContent = text;
    card.replaceWith(note);
  };

  document.addEventListener('click', async (event) => {
    const confirmBtn = event.target.closest('[data-action="confirm-change"]');
    if (confirmBtn) {
      const card = cardOf(confirmBtn);
      const what = card.querySelector('h2')?.textContent || 'هذا التغيير';
      if (!window.confirm(`سيُنفَّذ الآن: ${what}. هل تؤكّد؟`)) return;
      const data = await send(card, confirmBtn.dataset.token, 'confirm', 'جارٍ التنفيذ…');
      if (data) settle(card, `نُفِّذ ✓ — ${data.summary || what}`, 'success');
      return;
    }
    const rejectBtn = event.target.closest('[data-action="reject-change"]');
    if (!rejectBtn) return;
    const card = cardOf(rejectBtn);
    const what = card.querySelector('h2')?.textContent || 'هذا التغيير';
    if (!window.confirm(`سيُرفض ولن يُكتب شيء: ${what}. هل تؤكّد الرفض؟`)) return;
    const data = await send(card, rejectBtn.dataset.token, 'reject', 'جارٍ الرفض…');
    if (data) settle(card, `رُفض — لم يُكتب شيء (${what})`, 'warning');
  });
})();
