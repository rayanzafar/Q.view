// Clients pages behavior — delegated data-action events only (app.js is frozen).
// Covers: add-client modal, add-activity, contacts add/delete, add document,
// drill-down open (data-dd), search debounce + sort reload.
(function () {
  'use strict';
  var S = window.Sanad || {};
  var api = function (path, method, body) {
    return fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j.error && j.error.message) || ('تعذّر تنفيذ الطلب (' + r.status + ')'));
        return j;
      });
    });
  };
  var toast = function (msg, bad) {
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#dc2626' : '#059669');
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600);
  };
  var val = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var clientId = function () { return (window.__SANAD || {}).clientId || null; };

  // ── نافذة «عميل جديد» ──
  function openAddClient() {
    var types = ['حكومي', 'خاص', 'شبه حكومي', 'داخلي'];
    S.openModal(
      '<div class="modal-head"><div style="font-weight:800;font-size:15px">عميل جديد</div>' +
      '<button class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body">' +
      '<div class="field"><label>اسم العميل *</label><input class="input" id="nc-name" placeholder="مثال: وزارة الاقتصاد والتخطيط"></div>' +
      '<div class="grid2">' +
      '<div class="field"><label>النوع</label><select id="nc-type">' + types.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>الكود</label><input class="input" id="nc-code" placeholder="اختياري"></div></div>' +
      '<div class="field"><label>الاسم الإنجليزي</label><input class="input" id="nc-en" placeholder="اختياري" style="direction:ltr;text-align:left"></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn btn-primary" data-action="client-save">إضافة العميل</button>' +
      '<button class="btn" data-action="modal-close">إلغاء</button></div>');
    setTimeout(function () { var el = document.getElementById('nc-name'); if (el) el.focus(); }, 60);
  }
  function saveClient(btn) {
    var name = val('nc-name');
    if (!name) return toast('اسم العميل مطلوب', true);
    btn.disabled = true;
    api('/clients', 'POST', { name_ar: name, name_en: val('nc-en') || null, type: val('nc-type') || null, code: val('nc-code') || null })
      .then(function (c) { toast('أُضيف العميل ✓'); S.closeModal(); setTimeout(function () { location.href = '/app/client/' + c.id; }, 450); })
      .catch(function (e) { btn.disabled = false; toast(e.message, true); });
  }

  // ── دمج جهتين في واحدة ──
  // القرار الوحيد الذي يُطلب من المستخدم هو **أي الاسمين يبقى**، لأنه القرار الوحيد الذي
  // لا يُشتَقّ: أطول الاسمين ليس أصحّهما بالضرورة. وما عداه (نقل العمل، إخفاء المدموجة،
  // التدقيق) تفعله الخدمة. والتحذير صريح لأن الفعل يمسّ مالاً منسوباً.
  function openMerge(el) {
    var a = el.getAttribute('data-a'); var an = el.getAttribute('data-a-name');
    var b = el.getAttribute('data-b'); var bn = el.getAttribute('data-b-name');
    var opt = function (id, name) {
      return '<label style="display:flex;gap:.5rem;align-items:flex-start;padding:.55rem .7rem;border:1px solid var(--line);border-radius:10px;cursor:pointer;margin-bottom:.4rem">' +
        '<input type="radio" name="mg-keep" value="' + id + '" style="margin-top:.2rem">' +
        '<span><b style="font-size:13px">' + name + '</b>' +
        '<span style="display:block;font-size:11px;color:var(--muted)">يبقى هذا الاسم وينتقل إليه عمل الجهة الأخرى</span></span></label>';
    };
    S.openModal(
      '<div class="modal-head"><div style="font-weight:800;font-size:15px">دمج جهتين</div>' +
      '<button class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body">' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:.7rem">اختر الاسم الذي يبقى. سينتقل إليه كل المشاريع والفرص والعقود والفواتير وجهات الاتصال وسجل التواصل.</div>' +
      opt(a, an) + opt(b, bn) +
      '<div style="font-size:11.5px;color:var(--muted);background:#fffbeb;border:1px solid var(--amber);border-radius:10px;padding:.55rem .7rem;margin-top:.5rem">' +
      'إن لم تكونا جهة واحدة فأغلق هذه النافذة — الفروع الإقليمية تتشابه أسماؤها ولا تُدمج. الجهة المدموجة تبقى محفوظة ويمكن استرجاعها.' +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn btn-primary" data-action="client-merge-save" data-a="' + a + '" data-b="' + b + '">دمج الجهتين</button>' +
      '<button class="btn" data-action="modal-close">إلغاء</button></div>');
  }
  function saveMerge(btn) {
    var picked = document.querySelector('input[name="mg-keep"]:checked');
    if (!picked) return toast('اختر الاسم الذي يبقى أولاً', true);
    var keepId = picked.value;
    var a = btn.getAttribute('data-a'); var b = btn.getAttribute('data-b');
    var mergeId = keepId === a ? b : a;
    btn.disabled = true;
    api('/clients/merge', 'POST', { keepId: keepId, mergeIds: [mergeId] })
      .then(function () { toast('دُمجت الجهتان ✓'); S.closeModal(); setTimeout(function () { location.reload(); }, 500); })
      .catch(function (e) { btn.disabled = false; toast(e.message, true); });
  }

  // ── اعتماد الاسم الرسمي ──
  // فعلٌ واحد بلا نافذة: الاسم المقترح معروض في السطر نفسه، والتأكيد يسبق التنفيذ لأن
  // تغيير اسم جهة يظهر في كل تقرير وعقد وفاتورة تُقرأ لاحقاً.
  function renameOfficial(el) {
    var id = el.getAttribute('data-id'); var to = el.getAttribute('data-to');
    if (!window.confirm('اعتماد الاسم الرسمي «' + to + '»؟ سيظهر في كل الشاشات والتقارير.')) return;
    el.disabled = true;
    api('/clients/' + id, 'PATCH', { name_ar: to })
      .then(function () { toast('اعتُمد الاسم الرسمي ✓'); setTimeout(function () { location.reload(); }, 450); })
      .catch(function (e) { el.disabled = false; toast(e.message, true); });
  }

  // ── «الاسم صحيح»: يُسكِت الاقتراح ولا يمسّ البيانات ──
  // بلا هذا الزرّ يعود نفس الاقتراح المرفوض كلما فُتحت الشاشة، ومن يراه مراراً يضغطه سهواً.
  function keepName(el) {
    var id = el.getAttribute('data-id');
    el.disabled = true;
    api('/clients/' + id + '/confirm-name', 'POST', { confirmed: true })
      .then(function () { toast('اعتُمد الاسم الحالي ✓'); setTimeout(function () { location.reload(); }, 400); })
      .catch(function (e) { el.disabled = false; toast(e.message, true); });
  }

  // ── تسجيل نشاط على العميل ──
  function saveActivity(btn) {
    var title = val('act-title');
    if (!title) return toast('اكتب ماذا حدث أولاً', true);
    if (!clientId()) return toast('تعذّر تحديد العميل — حدّث الصفحة', true);
    btn.disabled = true;
    api('/activities', 'POST', { kind: val('act-kind') || 'note', title: title, detail: val('act-detail') || null, client_id: clientId() })
      .then(function () { toast('سُجّل النشاط ✓'); setTimeout(function () { location.reload(); }, 450); })
      .catch(function (e) { btn.disabled = false; toast(e.message, true); });
  }

  // ── جهات الاتصال ──
  function addContact(btn) {
    var name = val('cf-name');
    if (!name) return toast('اسم جهة الاتصال مطلوب', true);
    btn.disabled = true;
    api('/clients/' + clientId() + '/contacts', 'POST', { name: name, title: val('cf-title') || null, email: val('cf-email') || null, phone: val('cf-phone') || null })
      .then(function () { toast('أُضيفت جهة الاتصال ✓'); setTimeout(function () { location.reload(); }, 450); })
      .catch(function (e) { btn.disabled = false; toast(e.message, true); });
  }
  function delContact(btn) {
    if (!confirm('حذف جهة الاتصال هذه؟')) return;
    api('/contacts/' + btn.dataset.id, 'DELETE')
      .then(function () { toast('حُذفت ✓'); setTimeout(function () { location.reload(); }, 400); })
      .catch(function (e) { toast(e.message, true); });
  }

  // ── مستند بالرابط ──
  function addDocument(btn) {
    var name = val('dc-name');
    if (!name) return toast('اسم المستند مطلوب', true);
    btn.disabled = true;
    api('/clients/' + clientId() + '/documents', 'POST', { name: name, url: val('dc-url') || null, kind: val('dc-kind') || 'other' })
      .then(function () { toast('أُضيف المستند ✓'); setTimeout(function () { location.reload(); }, 450); })
      .catch(function (e) { btn.disabled = false; toast(e.message, true); });
  }

  // ── تفويض الأحداث ──
  document.addEventListener('click', function (e) {
    var dd = e.target.closest('[data-dd]');
    if (dd) { S.openDD(dd.dataset.dd); return; }
    var el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'client-add': openAddClient(); break;
      case 'client-save': saveClient(el); break;
      case 'client-merge': openMerge(el); break;
      case 'client-rename': renameOfficial(el); break;
      case 'client-name-keep': keepName(el); break;
      case 'client-merge-save': saveMerge(el); break;
      case 'act-save': saveActivity(el); break;
      case 'contact-add': addContact(el); break;
      case 'contact-del': delContact(el); break;
      case 'doc-add': addDocument(el); break;
      case 'modal-close': S.closeModal(); break;
    }
  });
  // لوحة المفاتيح: فتح التفصيل بـ Enter/مسافة على البلاطات القابلة للنقر
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var dd = e.target.closest && e.target.closest('[data-dd]');
    if (dd) { e.preventDefault(); S.openDD(dd.dataset.dd); }
  });
  // إرسال نموذج النشاط بـ Enter من حقل العنوان
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && (e.target.id === 'act-title' || e.target.id === 'act-detail')) {
      e.preventDefault();
      var btn = document.querySelector('[data-action="act-save"]');
      if (btn) saveActivity(btn);
    }
  });

  // ── بحث القائمة (تأخير 400م) + تغيير الترتيب ──
  var q = document.getElementById('cl-q');
  var form = document.getElementById('cl-form');
  if (q && form) {
    var t = null;
    q.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { form.submit(); }, 400);
    });
  }
  var sortSel = document.getElementById('cl-sort');
  if (sortSel && form) sortSel.addEventListener('change', function () { form.submit(); });
})();
