// إدارة الهوية (شاشة «المستخدمون والصلاحيات») — دعوة موظف، تعديل حساب، تعطيل/تفعيل،
// إرسال رمز دخول، وعرض سجل الدخول. وحدة صفحة قائمة بذاتها: أحداث مفوَّضة بلا معالجات ضمنية،
// والبيانات من window.__SANAD المحقونة من الخادم (محجوبة بالدور أصلاً). تنادي /api/identity.
(function () {
  'use strict';
  const S = () => window.__SANAD || {};
  const esc = (s) => (window.Sanad ? window.Sanad.esc(s) : String(s == null ? '' : s));

  const api = async (path, method, body) => {
    const r = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('تعذّر إتمام العملية — أعد المحاولة (' + r.status + ')'));
    return j;
  };
  const toast = (msg, bad) => {
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;max-width:60vw;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#dc2626' : '#059669');
    document.body.appendChild(d); setTimeout(() => d.remove(), 3600);
  };
  const openModal = (html) => { if (window.Sanad && window.Sanad.openModal) window.Sanad.openModal(html); };
  const closeModal = () => { if (window.Sanad && window.Sanad.closeModal) window.Sanad.closeModal(); };
  const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };

  const SCOPES = [
    { id: 'own', ar: 'بياناته وحده' },
    { id: 'team', ar: 'فريقه' },
    { id: 'department', ar: 'إدارته' },
    { id: 'sector', ar: 'قطاعه' },
    { id: 'company', ar: 'الشركة كاملة' },
  ];
  const opts = (arr, sel) => arr.map((o) => '<option value="' + esc(o.id) + '"' + (o.id === sel ? ' selected' : '') + '>' + esc(o.ar) + '</option>').join('');

  // ── نموذج الدعوة/التعديل ──
  function formHtml(id) {
    const st = S();
    const u = id ? (st.idnUsers || {})[id] : null;
    const title = id ? 'تعديل حساب' : 'دعوة موظف إلى المنصة';
    return '<div class="modal-head"><div style="font-weight:800;font-size:15px">' + title + '</div>'
      + '<button class="btn btn-ghost btn-sm" data-action="idn-close" aria-label="إغلاق">✕</button></div>'
      + '<div class="modal-body">'
      + '<div class="field"><label>الاسم بالعربية</label><input class="input" id="idnf-name" value="' + (u ? esc(u.name_ar || '') : '') + '" placeholder="الاسم كما يظهر في المنصة"></div>'
      + '<div class="field"><label>بريد العمل</label><input class="input" id="idnf-email" type="email" dir="ltr" value="' + (u ? esc(u.email || '') : '') + '" placeholder="name@evc.sa"></div>'
      + '<div class="grid2">'
      + '<div class="field"><label>الدور</label><select id="idnf-role">' + opts(st.idnRoles || [], u ? u.role_id : 'employee') + '</select></div>'
      + '<div class="field"><label>يرى من البيانات</label><select id="idnf-scope">' + opts(SCOPES, u ? u.scope : 'own') + '</select></div>'
      + '</div>'
      + '<div class="field"><label>القطاع</label><select id="idnf-sector"><option value="">— بلا قطاع —</option>'
      + opts(st.idnSectors || [], u ? u.sector_id : '') + '</select></div>'
      + (id ? '' : '<div style="font-size:11.5px;color:var(--muted);line-height:1.8;margin-top:.3rem">'
        + 'يصل الموظف رمزُ تفعيل على بريده، وأول دخول به يفعّل حسابه. لا كلمة مرور تُنشأ ولا تُرسَل.</div>')
      + '</div>'
      + '<div class="modal-foot"><button class="btn" data-action="idn-close">إلغاء</button>'
      + '<button class="btn btn-primary" data-action="idn-save" data-id="' + (id || '') + '">' + (id ? 'حفظ التعديلات' : 'إرسال الدعوة') + '</button></div>';
  }

  async function save(id) {
    const body = {
      name_ar: val('idnf-name'),
      email: val('idnf-email'),
      role_id: val('idnf-role'),
      scope: val('idnf-scope'),
      sector_id: val('idnf-sector') || null,
    };
    try {
      if (id) {
        await api('/identity/users/' + encodeURIComponent(id), 'PATCH', body);
        toast('حُفظت التعديلات');
      } else {
        const r = await api('/identity/users', 'POST', body);
        // الصدق في التنبيه: «أُرسلت الدعوة» بينما قناة البريد في وضع المعاينة كذبٌ صريح،
        // والمشرف سينتظر موظفاً لن يصله شيء. تُقال حالة التسليم كما هي.
        toast(r.delivered
          ? ('أُنشئ الحساب وأُرسلت الدعوة إلى ' + body.email)
          : ('أُنشئ الحساب — لكن رسالة الدعوة لم تغادر بعد. راجع «مركز البريد» قبل إبلاغ الموظف.'), !r.delivered);
      }
      closeModal();
      setTimeout(() => location.reload(), 700);
    } catch (e) { toast(e.message, true); }
  }

  async function toggleActive(id, to) {
    const u = (S().idnUsers || {})[id] || {};
    const on = to === '1';
    if (!on && !confirm('تعطيل حساب ' + (u.name_ar || '') + '؟ سيخرج فوراً من كل أجهزته، ولن يستطيع الدخول حتى تُعيد تفعيله.')) return;
    try {
      const r = await api('/identity/users/' + encodeURIComponent(id) + '/active', 'POST', { active: on });
      toast(on ? 'فُعِّل الحساب' : ('عُطِّل الحساب وأُنهيت ' + (r.sessionsRevoked || 0) + ' جلسة'));
      setTimeout(() => location.reload(), 700);
    } catch (e) { toast(e.message, true); }
  }

  async function resend(id) {
    try {
      const r = await api('/identity/users/' + encodeURIComponent(id) + '/resend', 'POST', {});
      toast(r.delivered ? 'أُرسل الرمز إلى بريده' : 'لم تغادر الرسالة — راجع «مركز البريد» لمعرفة السبب', !r.delivered);
    } catch (e) { toast(e.message, true); }
  }

  async function showLogins(id) {
    const u = (S().idnUsers || {})[id] || {};
    try {
      const rows = await api('/identity/users/' + encodeURIComponent(id) + '/logins');
      const body = (rows || []).length
        ? '<table class="w-full" style="font-size:12px"><thead><tr class="text-[11px] text-muted text-right">'
          + '<th class="py-2 px-2 font-medium">الوقت</th><th class="px-2 font-medium">النتيجة</th><th class="px-2 font-medium">العنوان</th></tr></thead><tbody>'
          + rows.map((r) => '<tr class="border-b border-line">'
            + '<td class="py-1 px-2 tnum">' + esc(String(r.at || '').slice(0, 16).replace('T', ' ')) + '</td>'
            + '<td class="px-2">' + (r.ok ? '<span style="color:#047857">دخول ناجح</span>' : '<span style="color:#b91c1c">محاولة فاشلة</span>') + '</td>'
            + '<td class="px-2 tnum" dir="ltr" style="text-align:right">' + esc(r.ip || '—') + '</td></tr>').join('')
          + '</tbody></table>'
        : '<div class="empty-state"><div class="t">لا سجل دخول</div><div class="s">لم يدخل هذا الحساب إلى المنصة بعد.</div></div>';
      openModal('<div class="modal-head"><div style="font-weight:800;font-size:15px">سجل دخول ' + esc(u.name_ar || '') + '</div>'
        + '<button class="btn btn-ghost btn-sm" data-action="idn-close" aria-label="إغلاق">✕</button></div>'
        + '<div class="modal-body" style="max-height:60vh;overflow:auto">' + body + '</div>'
        + '<div class="modal-foot">'
        + '<button class="btn" data-action="idn-revoke" data-id="' + esc(id) + '">إنهاء كل جلساته</button>'
        + '<button class="btn btn-primary" data-action="idn-close">إغلاق</button></div>');
    } catch (e) { toast(e.message, true); }
  }

  async function revoke(id) {
    if (!confirm('إنهاء كل جلسات هذا الحساب؟ سيُطلب منه الدخول من جديد على كل أجهزته.')) return;
    try {
      const r = await api('/identity/users/' + encodeURIComponent(id) + '/revoke-sessions', 'POST', {});
      toast('أُنهيت ' + (r.sessionsRevoked || 0) + ' جلسة');
      closeModal();
    } catch (e) { toast(e.message, true); }
  }

  // ── تصفية فورية في الصفحة (بلا نداء خادم لكل حرف) ──
  function filterRows() {
    const q = (document.getElementById('idn-q') || {}).value || '';
    const needle = q.trim().toLowerCase();
    document.querySelectorAll('#idn-rows tr').forEach((tr) => {
      tr.style.display = !needle || tr.textContent.toLowerCase().includes(needle) ? '' : 'none';
    });
  }

  document.addEventListener('input', (ev) => { if (ev.target && ev.target.id === 'idn-q') filterRows(); });
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-action]');
    if (!b) return;
    const a = b.getAttribute('data-action'), id = b.getAttribute('data-id');
    if (a === 'idn-invite') { ev.preventDefault(); openModal(formHtml(null)); }
    else if (a === 'idn-edit') { ev.preventDefault(); openModal(formHtml(id)); }
    else if (a === 'idn-save') { ev.preventDefault(); save(id || null); }
    else if (a === 'idn-close') { ev.preventDefault(); closeModal(); }
    else if (a === 'idn-toggle') { ev.preventDefault(); toggleActive(id, b.getAttribute('data-to')); }
    else if (a === 'idn-resend') { ev.preventDefault(); resend(id); }
    else if (a === 'idn-logins') { ev.preventDefault(); showLogins(id); }
    else if (a === 'idn-revoke') { ev.preventDefault(); revoke(id); }
  });
})();
