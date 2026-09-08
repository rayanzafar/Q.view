// «مركز التطوير» — سلوك المتصفح: فتح العنصر في لوحةٍ جانبية، وتحرير الدراسة في مكانها،
// وقرار الاعتماد أو الرفض، والتعليقات الداخلية، ونسخ رابط الاستقبال، وإضافة الأعضاء والجهات
// والإصدارات. لا تعديل على app.js ولا اعتماد عليه إلا في اللوحة والنافذة المشتركتين.
//
// المرشِّحات على الشاشة روابطُ خادم (تُبنى في العرض) — فما يُطبع من التقرير هو ما يُرى تماماً.
// هذا الملف لا يبني مرشِّحاً ولا يُخفي صفاً: يفتح، ويكتب، ثم يُعيد الصفحة إلى نفسها.
(function () {
  'use strict';

  var root = document.querySelector('.dc');
  var PRODUCT = root ? root.getAttribute('data-product') : '';
  var ROLE = root ? root.getAttribute('data-role') : '';
  var MAY_DECIDE = ROLE === 'manager' || ROLE === 'admin';
  var team = null;      // فريق المنتج — يُقرأ مرةً واحدة عند أول قرار اعتماد
  var busy = false;
  // الكلمات العربية للقيم المخزَّنة تصل من الخادم (المعجم) لا تُكتب هنا — مصدرٌ واحد.
  var LB = (function () {
    var el = document.getElementById('dc-labels');
    try { return el ? JSON.parse(el.textContent) : {}; } catch (e) { return {}; }
  }());
  var lab = function (map, v) { return (LB[map] && LB[map][v]) || v || '—'; };

  var $ = function (id) { return document.getElementById(id); };
  var SN = function () { return window.Sanad || {}; };
  var esc = function (s) {
    var f = SN().esc;
    if (f) return f(s);
    return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };

  function toast(msg, bad) {
    var d = document.createElement('div');
    d.textContent = msg;
    d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:300;padding:10px 16px;border-radius:10px;color:#fff;'
      + 'font-size:13px;max-width:min(92vw,420px);line-height:1.7;box-shadow:0 8px 24px rgba(0,0,0,.2);background:'
      + (bad ? '#b91c1c' : '#047857');
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, bad ? 5200 : 2800);
  }

  function api(path, method, body) {
    return fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' } : { 'X-Requested-With': 'fetch' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 401) { location.reload(); return new Promise(function () {}); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j.error && j.error.message) || 'تعذّر إتمام العملية — أعد المحاولة');
        return j;
      });
    });
  }

  var reload = function () { setTimeout(function () { location.reload(); }, 450); };

  // ── جُمل السجل: كل خطوة سطرٌ يُقرأ، لا رمزٌ يُفكّ ──────────────────────────
  var STEP = {
    created: 'سجّل البلاغ',
    triage: 'درس البلاغ وقدّر حجمه',
    comment: 'كتب تعليقاً',
    image: 'أضاف صورة',
    task: 'ربطه بمهمة',
  };
  function stepSentence(ev) {
    var who = ev.actor_label || 'غير معروف';
    var kind = String(ev.kind || '');
    var what = kind === 'status'
      ? 'نقله إلى «' + lab('status', ev.to_status) + '»'
      : (STEP[kind] || 'حدَّث البلاغ');
    var when = String(ev.created_at || '').slice(0, 16).replace('T', ' ');
    return esc(who) + ' ' + esc(what) + ' · <span class="tnum">' + esc(when) + '</span>';
  }

  // ── اللوحة الجانبية ────────────────────────────────────────────────────
  function openItem(itemId) {
    if (busy) return;
    busy = true;
    api('/products/items/' + encodeURIComponent(itemId)).then(function (j) {
      var sn = SN();
      if (!sn.openDrawer) { toast('تعذّر فتح البلاغ — أعد تحميل الصفحة', true); return; }
      sn.openDrawer(drawerHtml(j));
      var box = document.getElementById('drawer');
      var first = box && box.querySelector('button,input,textarea,select,a');
      if (first) first.focus();
    }).catch(function (e) { toast(e.message || 'تعذّر فتح البلاغ', true); })
      .then(function () { busy = false; });
  }

  function block(title, inner) {
    return '<section class="dcd-b"><h3>' + esc(title) + '</h3>' + inner + '</section>';
  }

  var CURRENT = '';
  function drawerHtml(j) {
    CURRENT = j.id || '';
    var it = j;
    var imgs = j.images || [];
    var comments = j.comments || [];
    var events = j.events || [];

    var before = imgs.filter(function (i) { return i.kind === 'before'; });
    var after = imgs.filter(function (i) { return i.kind === 'after'; });
    var reportShots = imgs.filter(function (i) { return i.kind === 'report'; });

    var reporter = block('من أبلغ', '<div class="dcd-kv">'
      + kv('الاسم', who(it))
      + kv('القطاع', it.sector_name)
      + kv('الجهة', it.tenant_name || (it.tenant && it.tenant.name))
      + kv('أين حدث', it.where_text)
      + kv('نوع البلاغ', lab('type', it.type))
      + kv('الإلحاح', lab('urgency', it.urgency))
      + '</div>'
      + (it.description ? '<div class="dcd-txt">' + esc(it.description) + '</div>' : '')
      + gallery('صور البلاغ', reportShots));

    var dev = block('دراسة الفريق',
      '<div class="dcd-grid">'
      + '<label class="f" for="dcd-size">الحجم</label>'
      + sel('dcd-size', mapOpts('size'), it.size)
      + '<label class="f" for="dcd-hours">الساعات المقدَّرة</label>'
      + '<input class="input" id="dcd-hours" type="number" min="0" max="999" step="0.5" value="' + esc(it.est_hours == null ? '' : it.est_hours) + '">'
      + '<label class="f" for="dcd-prio">الأولوية</label>'
      + sel('dcd-prio', mapOpts('priority'), it.priority)
      + '</div>'
      + '<label class="f" for="dcd-note">ملاحظة المطوِّر</label>'
      + '<textarea class="input" id="dcd-note" rows="3" maxlength="4000">' + esc(it.dev_description || '') + '</textarea>'
      + '<div class="dcd-acts"><button type="button" class="btn btn-sm btn-primary" data-action="dc-triage-save" data-item="' + esc(it.id) + '">احفظ الدراسة</button>'
      + '<button type="button" class="btn btn-sm" data-action="dc-status" data-item="' + esc(it.id) + '" data-to="AWAITING_APPROVAL">ارفعه للاعتماد</button>'
      + '<button type="button" class="btn btn-sm" data-action="dc-status" data-item="' + esc(it.id) + '" data-to="NEEDS_INFO">اطلب توضيحاً</button>'
      + '</div>');

    var decide = MAY_DECIDE ? block('القرار',
      '<label class="f" for="dcd-assignee">أسنِد إلى</label>'
      + '<select class="input" id="dcd-assignee"><option value="">— اختر من فريق المنتج —</option></select>'
      + '<div class="dcd-acts"><button type="button" class="btn btn-sm btn-primary" data-action="dc-approve" data-item="' + esc(it.id) + '">اعتمِد</button></div>'
      + '<label class="f" for="dcd-reason">سبب الرفض</label>'
      + '<textarea class="input" id="dcd-reason" rows="2" maxlength="1000"></textarea>'
      + '<div class="dcd-warn">سبب الرفض يصل إلى من أبلغ</div>'
      + '<div class="dcd-acts"><button type="button" class="btn btn-sm" style="color:#b91c1c" data-action="dc-decline" data-item="' + esc(it.id) + '">ارفض</button></div>') : '';

    var evidence = (before.length || after.length)
      ? block('قبل وبعد', '<div class="dcd-pair">'
        + '<figure><figcaption>قبل</figcaption>' + before.map(imgTag).join('') + '</figure>'
        + '<figure><figcaption>بعد</figcaption>' + after.map(imgTag).join('') + '</figure></div>')
      : '';

    var cList = comments.length
      ? comments.map(function (c) {
        return '<div class="dcd-c"><b>' + esc(c.author_label || 'غير معروف') + '</b>'
          + '<span class="m tnum">' + esc(String(c.created_at || '').slice(0, 16).replace('T', ' ')) + '</span>'
          + '<div>' + esc(c.body || '') + '</div></div>';
      }).join('')
      : '<div class="m">لا تعليقات بعد</div>';
    var talk = block('تعليقات الفريق',
      '<div class="dcd-cs">' + cList + '</div>'
      + '<label class="f" for="dcd-comment">أضف تعليقاً — اكتب @ ثم اسم الزميل لتنبيهه</label>'
      + '<textarea class="input" id="dcd-comment" rows="2" maxlength="2000"></textarea>'
      + '<div class="dcd-acts"><button type="button" class="btn btn-sm" data-action="dc-comment" data-item="' + esc(it.id) + '">أرسل</button></div>');

    var tl = block('ماذا جرى', events.length
      ? '<ol class="dcd-tl">' + events.map(function (ev) { return '<li>' + stepSentence(ev) + '</li>'; }).join('') + '</ol>'
      : '<div class="m">لا خطوات مسجَّلة بعد</div>');

    return '<style>'
      + '.dcd{padding:1rem 1.1rem;display:grid;gap:.9rem}'
      + '.dcd-h{display:flex;align-items:flex-start;justify-content:space-between;gap:.6rem}'
      + '.dcd-h h2{font-size:15px;margin:0;font-weight:800;line-height:1.6}'
      + '.dcd-k{font-weight:800;color:#244A99;unicode-bidi:isolate}'
      + '.dcd-b{border-top:1px solid #e6e9f0;padding-top:.75rem}'
      + '.dcd-b h3{font-size:12.5px;font-weight:800;color:#334155;margin:0 0 .5rem}'
      + '.dcd-kv{display:grid;grid-template-columns:auto 1fr;gap:.25rem .7rem;font-size:12.5px}'
      + '.dcd-kv dt{color:#64748b;font-weight:700}'
      + '.dcd-kv dd{margin:0}'
      + '.dcd-txt{margin-top:.55rem;font-size:12.5px;white-space:pre-wrap;line-height:1.9}'
      + '.dcd-grid{display:grid;grid-template-columns:auto 1fr;gap:.4rem .6rem;align-items:center}'
      + '.dcd .f{font-size:11.5px;font-weight:800;color:#334155;display:block;margin:.5rem 0 .25rem}'
      + '.dcd-acts{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.55rem}'
      + '.dcd-warn{font-size:11.5px;color:#92400e;background:#fef3c7;border-radius:8px;padding:.35rem .6rem;margin-top:.35rem}'
      + '.dcd-pair{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}'
      + '.dcd-pair figcaption{font-size:11.5px;color:#64748b;font-weight:800;margin-bottom:.25rem}'
      + '.dcd-pair img,.dcd-gal img{width:100%;border:1px solid #e6e9f0;border-radius:9px;margin-bottom:.35rem}'
      + '.dcd-c{border-bottom:1px solid #f1f5f9;padding:.4rem 0;font-size:12.5px}'
      + '.dcd-c b{font-weight:800}.dcd-c .m{color:#64748b;font-size:11px;margin-right:.4rem}'
      + '.dcd-tl{margin:0;padding:0 1rem 0 0;font-size:12.5px;display:grid;gap:.3rem}'
      + '.dcd .m{color:#64748b;font-size:11.5px}'
      + '</style>'
      + '<div class="dcd"><div class="dcd-h"><h2><span class="dcd-k">' + esc(it.item_key || '') + '</span> — ' + esc(it.title || 'بلا عنوان') + '</h2>'
      + '<button type="button" class="btn btn-ghost btn-sm" onclick="Sanad.closeDrawer()" aria-label="إغلاق">✕</button></div>'
      + '<div class="m">' + esc(lab('status', it.status)) + '</div>'
      + reporter + dev + decide + evidence + talk + tl + '</div>';
  }

  // صفُّ «الاسم: القيمة» في رأس الدرج: **يُرسم دائماً**. الحقلُ الغائب يقول «—» ولا يختفي —
  // لأن اختفاءه يجعل القارئ يظنّ أن الحقل غير موجودٍ أصلاً بدل أن يعرف أنه لم يُملأ.
  function kv(k, v) {
    var s = (v == null ? '' : String(v)).trim();
    return '<dt>' + esc(k) + '</dt><dd>' + esc(s || '—') + '</dd>';
  }
  // اسمُ من أبلغ: ما جهّزه الخادم، وإلا فالاسم المسجَّل على البلاغ، وإلا فهو «مجهول» صراحةً
  // (بلاغُ الرابط العام قد يصل بلا تعريفٍ بالنفس) — ولا يُترك الحقل فارغاً فيُظنّ عطلاً.
  function who(it) {
    var s = String(it.reporter_display || it.reporter_name || '').trim();
    return s || 'مجهول';
  }
  // خيارات القائمة من الخريطة المُرسلة: ترتيبها ترتيبُ المعجم، فلا ترتيبَ ثانٍ يُخترع هنا.
  function mapOpts(name) {
    var m = LB[name] || {};
    return Object.keys(m).map(function (k) { return [k, m[k]]; });
  }
  function imgTag(i) {
    return '<img alt="' + esc(i.caption || 'صورة') + '" src="/api/products/items/'
      + encodeURIComponent(i.item_id || CURRENT) + '/images/' + encodeURIComponent(i.id) + '">';
  }
  function gallery(title, list) {
    if (!list.length) return '';
    return '<div class="dcd-gal"><div class="f">' + esc(title) + '</div>' + list.map(imgTag).join('') + '</div>';
  }
  function sel(id, opts, cur) {
    return '<select class="input" id="' + esc(id) + '">'
      + '<option value="">—</option>'
      + opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
  }

  function fillTeam() {
    var box = $('dcd-assignee');
    if (!box || !PRODUCT) return;
    var put = function (list) {
      list.forEach(function (m) {
        var o = document.createElement('option');
        o.value = m.user_id || m.id;
        o.textContent = m.name_ar || m.username || '';
        box.appendChild(o);
      });
    };
    if (team) { put(team); return; }
    api('/products/' + encodeURIComponent(PRODUCT) + '/members').then(function (j) {
      team = Array.isArray(j) ? j : (j.members || []);
      put(team);
    }).catch(function () {});
  }

  // ── الكتابة ────────────────────────────────────────────────────────────
  function write(promise, okMsg) {
    if (busy) return;
    busy = true;
    promise.then(function () { toast(okMsg); reload(); })
      .catch(function (e) { toast(e.message || 'تعذّر إتمام العملية', true); })
      .then(function () { busy = false; });
  }

  function ask(msg, cur) {
    var v = window.prompt(msg, cur == null ? '' : cur);
    return v == null ? null : String(v).trim();
  }

  // ── نوافذ الإضافة: نموذجٌ صغير بحقولٍ مسمّاة، لا سلسلةُ أسئلةٍ يكتب فيها الناس نصاً حرّاً
  // تردّه الخدمة. القوائم (القطاعات، الأشخاص) تصل من الخادم في الصفحة نفسها.
  function listFrom(id) {
    var el = document.getElementById(id);
    try { return el ? JSON.parse(el.textContent) : []; } catch (e) { return []; }
  }
  function opts(list, placeholder) {
    var out = placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '';
    list.forEach(function (o) { out += '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>'; });
    return out;
  }
  function field(id, label, control, hint) {
    return '<div><label class="f" for="' + id + '">' + esc(label) + '</label>' + control
      + (hint ? '<div style="font-size:11.5px;color:#64748b;margin-top:.25rem;line-height:1.8">' + esc(hint) + '</div>' : '') + '</div>';
  }
  function text(id, ph, max) {
    return '<input class="input" id="' + id + '" maxlength="' + (max || 120) + '" placeholder="' + esc(ph || '') + '">';
  }
  function select(id, inner) { return '<select class="input" id="' + id + '">' + inner + '</select>'; }

  function openForm(title, fields, action, submitLabel) {
    var sn = SN();
    if (!sn.openModal) { toast('تعذّر فتح النافذة — أعد تحميل الصفحة', true); return; }
    sn.openModal('<div class="modal-head"><div style="font-weight:800;font-size:15px">' + esc(title) + '</div>'
      + '<button type="button" class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>'
      + '<div style="padding:1rem 1.15rem;display:grid;gap:.75rem">' + fields + '</div>'
      + '<div class="modal-foot"><button type="button" class="btn btn-primary" data-action="' + action + '">' + esc(submitLabel) + '</button>'
      + '<button type="button" class="btn" data-action="modal-close">إلغاء</button></div>');
  }
  var val = function (id) { var el = $(id); return el ? String(el.value || '').trim() : ''; };

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!t) return;
    var a = t.getAttribute('data-action');
    var item = t.getAttribute('data-item');

    if (a === 'dc-open-item') { e.preventDefault(); openItem(t.getAttribute('data-item')); return; }
    if (a === 'dc-copy-link') {
      e.preventDefault();
      var url = t.getAttribute('data-link') || '';
      var done = function () { toast('نُسخ الرابط ✓'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { toast('تعذّر النسخ — انسخه يدوياً', true); });
      else { window.prompt('انسخ الرابط', url); }
      return;
    }
    if (a === 'dc-triage-save') {
      e.preventDefault();
      write(api('/products/items/' + encodeURIComponent(item) + '/triage', 'POST', {
        size: ($('dcd-size') || {}).value || '',
        est_hours: ($('dcd-hours') || {}).value || '',
        priority: ($('dcd-prio') || {}).value || '',
        dev_description: ($('dcd-note') || {}).value || '',
      }), 'حُفظت الدراسة ✓');
      return;
    }
    if (a === 'dc-status') {
      e.preventDefault();
      write(api('/products/items/' + encodeURIComponent(item) + '/status', 'POST', { to: t.getAttribute('data-to') }), 'حُدّثت الحال ✓');
      return;
    }
    if (a === 'dc-approve') {
      e.preventDefault();
      var who = ($('dcd-assignee') || {}).value || '';
      if (!who) { toast('اختر من يتولّاه من فريق المنتج', true); return; }
      write(api('/products/items/' + encodeURIComponent(item) + '/approve', 'POST', { assignee_user_id: who }), 'اعتُمد وأُنشئت مهمته ✓');
      return;
    }
    if (a === 'dc-decline') {
      e.preventDefault();
      var reason = String(($('dcd-reason') || {}).value || '').trim();
      if (!reason) { toast('اكتب سبب الرفض — يصل إلى من أبلغ', true); return; }
      write(api('/products/items/' + encodeURIComponent(item) + '/decline', 'POST', { reason: reason }), 'سُجّل الرفض ✓');
      return;
    }
    if (a === 'dc-comment') {
      e.preventDefault();
      var body = String(($('dcd-comment') || {}).value || '').trim();
      if (!body) { toast('اكتب التعليق أولاً', true); return; }
      write(api('/products/items/' + encodeURIComponent(item) + '/comments', 'POST', { body: body }), 'أُضيف التعليق ✓');
      return;
    }
    if (a === 'dc-new-product') {
      e.preventDefault();
      openForm('منتج جديد',
        field('dc-np-name', 'اسم المنتج', text('dc-np-name', 'مثال: منصة سند', 120))
        + field('dc-np-prefix', 'بادئة أرقام البلاغات', text('dc-np-prefix', 'SND', 8),
          'حروفٌ لاتينية قصيرة تُقرأ في رقم كل بلاغ — مثل SND-042.')
        + field('dc-np-kind', 'نوع المنتج', select('dc-np-kind',
          '<option value="external">' + esc(lab('kind', 'external')) + '</option>'
          + '<option value="internal">' + esc(lab('kind', 'internal')) + '</option>')),
        'dc-new-product-save', 'أنشِئ المنتج');
      return;
    }
    if (a === 'dc-new-product-save') {
      e.preventDefault();
      var pName = val('dc-np-name');
      var pPrefix = val('dc-np-prefix').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (!pName) { toast('اكتب اسم المنتج', true); return; }
      if (!pPrefix) { toast('اكتب بادئة أرقام البلاغات — حروفٌ لاتينية مثل SND', true); return; }
      write(api('/products', 'POST', {
        name_ar: pName, key: pPrefix.toLowerCase(), item_prefix: pPrefix, kind: val('dc-np-kind') || 'external',
      }), 'أُنشئ المنتج ✓');
      return;
    }
    if (a === 'dc-member-add') {
      e.preventDefault();
      var people = listFrom('dc-people');
      if (!people.length) { toast('لا أحد يُضاف — الجميع في الفريق أصلاً', true); return; }
      openForm('أضف عضواً إلى فريق المنتج',
        field('dc-mb-user', 'من تضيفه', select('dc-mb-user', opts(people, 'اختر الشخص')))
        + field('dc-mb-role', 'دوره في المنتج', select('dc-mb-role',
          '<option value="developer">' + esc(lab('role', 'developer')) + '</option>'
          + '<option value="manager">' + esc(lab('role', 'manager')) + '</option>')),
        'dc-member-add-save', 'أضِف');
      return;
    }
    if (a === 'dc-member-add-save') {
      e.preventDefault();
      var mbUser = val('dc-mb-user');
      if (!mbUser) { toast('اختر الشخص أولاً', true); return; }
      write(api('/products/' + encodeURIComponent(PRODUCT) + '/members', 'POST', {
        user_id: mbUser, role: val('dc-mb-role') || 'developer',
      }), 'أُضيف العضو ✓');
      return;
    }
    if (a === 'dc-member-remove') {
      e.preventDefault();
      if (!window.confirm('إزالة هذا العضو من فريق المنتج؟')) return;
      write(api('/products/' + encodeURIComponent(PRODUCT) + '/members/' + encodeURIComponent(t.getAttribute('data-member')), 'DELETE'), 'أُزيل العضو ✓');
      return;
    }
    if (a === 'dc-tenant-new') {
      e.preventDefault();
      var tn = ask('اسم الجهة');
      if (!tn) return;
      write(api('/products/' + encodeURIComponent(PRODUCT) + '/tenants', 'POST', { name: tn }), 'أُضيفت الجهة ✓');
      return;
    }
    if (a === 'dc-link-new') {
      e.preventDefault();
      write(api('/products/' + encodeURIComponent(PRODUCT) + '/links', 'POST', { tenant_id: t.getAttribute('data-tenant') }), 'أُنشئ رابط الاستقبال ✓');
      return;
    }
    if (a === 'dc-version-new') {
      e.preventDefault();
      var v = ask('اسم الإصدار — مثال: ٥٫٨٣');
      if (!v) return;
      write(api('/products/' + encodeURIComponent(PRODUCT) + '/versions', 'POST', { label: v }), 'أُضيف الإصدار ✓');
      return;
    }
    if (a === 'dc-brand-save') {
      e.preventDefault();
      write(api('/products/' + encodeURIComponent(PRODUCT), 'PATCH', { brand_color: ($('dc-brand-color') || {}).value || '' }), 'حُفظت الهوية ✓');
      return;
    }
    if (a === 'dc-manual-add') {
      e.preventDefault();
      openForm('سجّل عن غيرك',
        field('dc-mn-title', 'عنوان البلاغ', text('dc-mn-title', 'مثال: زرّ الحفظ لا يستجيب', 200))
        // من أبلغ: يُختار من حسابات المنصة أولاً — فيصله بريدُ كل خطوة ويتابع بلاغه بنفسه —
        // ويُكتب اسمه حرّاً متى لم يكن له حساب. الاثنان لا يُطلبان معاً.
        + field('dc-mn-user', 'من أبلغ — من حسابات المنصة', select('dc-mn-user', opts(listFrom('dc-users'), 'ليس له حساب في المنصة')),
          'حين تختاره من القائمة يصله بريدٌ عند كل خطوة، ويتابع بلاغه بنفسه.')
        + field('dc-mn-person', 'أو اكتب اسمه', text('dc-mn-person', 'لمن لا حساب له', 120))
        + field('dc-mn-sector', 'القطاع الذي يقع عليه الأثر', select('dc-mn-sector', opts(listFrom('dc-sectors'), 'اختر القطاع')),
          'مطلوب — التقارير تُجمع بالقطاع، وبلاغٌ بلا قطاعٍ لا يدخل تقرير أحد.')
        + field('dc-mn-type', 'نوع البلاغ', select('dc-mn-type',
          '<option value="bug">' + esc(lab('type', 'bug')) + '</option>'
          + '<option value="suggestion">' + esc(lab('type', 'suggestion')) + '</option>'))
        + field('dc-mn-urg', 'كم يؤثّر على العمل', select('dc-mn-urg',
          '<option value="blocks">' + esc(lab('urgency', 'blocks')) + '</option>'
          + '<option value="delays" selected>' + esc(lab('urgency', 'delays')) + '</option>'
          + '<option value="improve">' + esc(lab('urgency', 'improve')) + '</option>')),
        'dc-manual-save', 'سجّل البلاغ');
      return;
    }
    if (a === 'dc-manual-save') {
      e.preventDefault();
      var mnTitle = val('dc-mn-title');
      var mnSector = val('dc-mn-sector');
      var mnUser = val('dc-mn-user');
      if (!mnTitle) { toast('اكتب عنوان البلاغ', true); return; }
      if (!mnSector) { toast('اختر القطاع — إلزاميٌّ في التسجيل عن الغير', true); return; }
      write(api('/products/' + encodeURIComponent(PRODUCT) + '/items', 'POST', {
        // الحسابُ المختار يسبق الاسم المكتوب: الخدمة تأخذ اسمه من سجلّه فلا يُكتب مرتين.
        title: mnTitle, reporter_user_id: mnUser, reporter_name: mnUser ? '' : val('dc-mn-person'), sector_id: mnSector,
        type: val('dc-mn-type') || 'bug', urgency: val('dc-mn-urg') || 'delays',
      }), 'سُجّل البلاغ ✓');
    }
  });

  // فتح اللوحة بلوحة المفاتيح من صفّ الجدول (الصف زرٌّ في المعنى، فليكن زراً في الاستعمال).
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var row = e.target.closest ? e.target.closest('tr.row[data-action="dc-open-item"]') : null;
    if (!row) return;
    e.preventDefault();
    openItem(row.getAttribute('data-item'));
  });

  // قائمة «أسنِد إلى» تُملأ متى ظهرت اللوحة — لا قبل ذلك، فلا قراءةَ فريقٍ بلا حاجة.
  var drawer = document.getElementById('drawer');
  if (drawer && window.MutationObserver) {
    new MutationObserver(function () { if (document.getElementById('dcd-assignee')) fillTeam(); })
      .observe(drawer, { childList: true });
  }
}());
