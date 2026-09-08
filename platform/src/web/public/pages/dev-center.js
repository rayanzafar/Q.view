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
  var DUPS = [];        // بلاغاتُ المنتج كما تُعرض في منتقي «مكرر عن»
  var PROJECTS = null;  // مشاريعُ صاحب الحساب — تُقرأ مرةً واحدة لنموذج الجهة
  var LINK_ID = '';     // الرابط الذي يُحرَّر الآن (فارغٌ = رابطٌ جديد)
  var LINK_TENANT = ''; // جهةُ الرابط الجديد
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

  // بايتاتٌ خام: الصورة تُرفع كما هي، ونوعُها ترويسةٌ لا حقلُ نموذج — كما يقرؤها الموجّه.
  function postBytes(path, blob, headers) {
    var h = { 'Content-Type': blob.type || 'application/octet-stream', 'X-Requested-With': 'fetch' };
    for (var k in headers) if (Object.prototype.hasOwnProperty.call(headers, k)) h[k] = headers[k];
    return fetch('/api' + path, { method: 'POST', credentials: 'include', headers: h, body: blob })
      .then(function (r) {
        if (r.ok) return r.json().catch(function () { return {}; });
        return r.json().catch(function () { return {}; }).then(function (j) {
          throw new Error((j.error && j.error.message) || 'تعذّر رفع الصورة');
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
  };
  // تفصيلُ الحدث يصل نصّاً مخزَّناً — يُفكّ هنا دفاعياً، والحدثُ بلا تفصيلٍ حالٌ عادية.
  function evDetail(ev) {
    if (ev && ev.detail && typeof ev.detail === 'object') return ev.detail;
    try { return ev && ev.detail_json ? JSON.parse(ev.detail_json) : {}; } catch (e) { return {}; }
  }
  // أحداثُ المهمة أربعةٌ لا واحد: فتحُها، وإنجازُها، وإلغاؤها، وفكُّ ارتباطها. وكانت الأربعة
  // تُقرأ «ربطه بمهمة» — فيقرأ الفريقُ عند إغلاق البلاغ ربطاً لم يقع.
  function taskSentence(d) {
    if (d.unlinked) return 'فكّ ارتباط البلاغ بمهمته';
    if (d.task_status === 'DONE') return 'أنجز مهمة البلاغ';
    if (d.task_status === 'CANCELLED') return 'ألغى مهمة البلاغ';
    if (d.task_status) return 'حدَّث حال مهمة البلاغ';
    return 'فتح له مهمةً وأسندها';
  }
  function stepSentence(ev) {
    var who = ev.actor_label || 'غير معروف';
    var kind = String(ev.kind || '');
    var what = kind === 'status'
      ? 'نقله إلى «' + lab('status', ev.to_status) + '»'
      : kind === 'task' ? taskSentence(evDetail(ev))
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
      + '<div class="dcd-acts">' + actBtn('dc-triage-save', '', 'احفظ الدراسة', 'btn-primary') + lifecycleActions(it) + '</div>');

    // قرارُ المدير يُعرض حين يكون قابلاً للاتخاذ فعلاً: `allowed_next` تأتي من جدول الانتقالات
    // في الخدمة نفسها، فلا زرَّ اعتمادٍ فوق بلاغٍ معتمَدٍ أصلاً ولا رفضٍ فوق بلاغٍ مرفوض.
    var canApprove = MAY_DECIDE && allows(it, 'APPROVED');
    var canDecline = MAY_DECIDE && allows(it, 'DECLINED');
    var decide = (canApprove || canDecline) ? block('القرار',
      (canApprove
        ? '<label class="f" for="dcd-assignee">أسنِد إلى</label>'
          + '<select class="input" id="dcd-assignee"><option value="">— اختر من فريق المنتج —</option></select>'
          + '<div class="dcd-acts">' + actBtn('dc-approve', '', 'اعتمِد', 'btn-primary') + '</div>'
        : '')
      + (canDecline
        ? '<label class="f" for="dcd-reason">سبب الرفض</label>'
          + '<textarea class="input" id="dcd-reason" rows="2" maxlength="1000"></textarea>'
          + '<div class="dcd-warn">سبب الرفض يصل إلى من أبلغ</div>'
          + '<div class="dcd-acts"><button type="button" class="btn btn-sm" style="color:#b91c1c" data-action="dc-decline" data-item="' + esc(it.id) + '">ارفض</button></div>'
        : '')) : '';

    // ما استقرّ عليه القرار يُقرأ في الدرج لا في سطرٍ عابرٍ داخل «ماذا جرى».
    var outcome = decisionBlock(it);

    // «قبل وبعد» تُرفع من هنا منذ الاعتماد: كان الدرج يرسمها إن وُجدت والتقريرُ المطبوع يبني
    // عليها، ولا بابَ في الشاشة كلها يُدخلها.
    var mayShoot = EVIDENCE_STATUSES.indexOf(String(it.status || '')) >= 0;
    var evidence = (mayShoot || before.length || after.length)
      ? block('قبل وبعد', '<div class="dcd-pair">'
        + shotCol('before', 'قبل', before, mayShoot)
        + shotCol('after', 'بعد', after, mayShoot) + '</div>')
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
      + '.dcd{display:grid;gap:.9rem;align-content:start}'
      + '.dcd>.dcd-b:first-child{border-top:0;padding-top:0}'
      + '.dcd-hd h2{font-size:15px;margin:0;font-weight:800;line-height:1.6}'
      + '.dcd-hd .m{color:#64748b;font-size:11.5px;margin-top:.2rem}'
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
      + '.dcd-drop{border:1.5px dashed #cbd5e1;border-radius:10px;padding:.6rem;text-align:center;font-size:11.5px;color:#64748b;cursor:pointer;margin-top:.35rem;line-height:1.8}'
      + '.dcd-drop.on,.dcd-drop:focus-visible{border-color:#244A99;background:#f5f8ff;outline:none}'
      + '.dcd-c{border-bottom:1px solid #f1f5f9;padding:.4rem 0;font-size:12.5px}'
      + '.dcd-c b{font-weight:800}.dcd-c .m{color:#64748b;font-size:11px;margin-right:.4rem}'
      + '.dcd-tl{margin:0;padding:0 1rem 0 0;font-size:12.5px;display:grid;gap:.3rem}'
      + '.dcd .m{color:#64748b;font-size:11.5px}'
      + '</style>'
      // ترويسةٌ ثابتة وجسمٌ يُمرَّر وذيلٌ ثابت — كبقية أدراج المنصة (`.drawer-body` في layout.js).
      // بلا هذا الغلاف يكون الدرجُ كتلةً واحدةً لا تُمرَّر، فيسقط «احفظ الدراسة» وصندوقُ
      // التعليق تحت حافة الشاشة ولا يبلغهما لا الفأرة ولا المفتاح.
      + '<div class="drawer-head dcd-hd"><div style="flex:1;min-width:0">'
      + '<h2><span class="dcd-k">' + esc(it.item_key || '') + '</span> — ' + esc(it.title || 'بلا عنوان') + '</h2>'
      + '<div class="m">' + esc(lab('status', it.status)) + '</div></div>'
      + '<button type="button" class="btn btn-ghost btn-sm" onclick="Sanad.closeDrawer()" aria-label="إغلاق">✕</button></div>'
      + '<div class="drawer-body dcd">'
      + reporter + outcome + dev + decide + evidence + talk + tl + '</div>'
      + '<div class="drawer-foot"><button type="button" class="btn" onclick="Sanad.closeDrawer()">إغلاق</button></div>';
  }

  // ── أفعالُ دورة الحياة ──────────────────────────────────────────────────
  // القيمةُ المخزَّنة تُمرَّر مُعامِلاً لا تُكتب داخل نصٍّ عربي: فلا تظهر في وجه المستخدم يوماً.
  function actBtn(action, to, label, cls) {
    return '<button type="button" class="btn btn-sm ' + (cls || '') + '" data-action="' + action + '"'
      + ' data-item="' + esc(CURRENT) + '"' + (to ? ' data-to="' + to + '"' : '') + '>' + esc(label) + '</button>';
  }
  var allows = function (it, s) { return (it.allowed_next || []).indexOf(s) >= 0; };
  var EVIDENCE_STATUSES = ['APPROVED', 'IN_PROGRESS', 'RESOLVED'];

  // ما يُعرض = ما تسمح به الخدمة من هذه الحال (`allowed_next` تصل من الخادم) × دورُ من يقرأ.
  // فلا زرَّ يُنقر فيُردّ، ولا نقلةً لازمة تُطلب من خارج الشاشة بنداءٍ مباشر.
  function lifecycleActions(it) {
    var st = String(it.status || '');
    var out = '';
    if (allows(it, 'AWAITING_APPROVAL')) out += actBtn('dc-status', 'AWAITING_APPROVAL', 'ارفعه للاعتماد');
    if (allows(it, 'NEEDS_INFO')) out += actBtn('dc-needs-info', '', 'اطلب توضيحاً');
    if (allows(it, 'IN_PROGRESS') && st !== 'RESOLVED') out += actBtn('dc-status', 'IN_PROGRESS', 'ابدأ التنفيذ');
    if (allows(it, 'RESOLVED')) out += actBtn('dc-resolve', '', 'تم الحل', 'btn-primary');
    if (allows(it, 'DUPLICATE')) out += actBtn('dc-duplicate', '', 'مكرر');
    // إعادةُ الفتح تنقض حلاً أُعلن لمن أبلغ ووصله بريدُه — فهي لمديري المنتج وحدهم.
    if (st === 'RESOLVED' && allows(it, 'IN_PROGRESS') && MAY_DECIDE) out += actBtn('dc-status', 'IN_PROGRESS', 'أعد الفتح');
    return out;
  }

  // كتلةُ «ما استقرّ عليه القرار»: المُسنَد إليه ومهمتُه، ووسمُ الإصدار، وسببُ الرفض، والأصلُ
  // الذي تكرّر عنه. تُرسَم بما وقع فقط — فإن لم يقع شيءٌ بعد لم تُرسم أصلاً.
  function decisionBlock(it) {
    var rows = '';
    if (it.assignee) rows += kv('أُسند إلى', it.assignee.name_ar || it.assignee.username || '');
    if (it.version) rows += kv('وصل الحل في إصدار', it.version.label || '');
    if (it.decline_reason) rows += kv('سبب الرفض', it.decline_reason);
    if (it.duplicateOf) rows += kv('مكرر عن', (it.duplicateOf.item_key || '') + ' — ' + (it.duplicateOf.title || ''));
    if (!rows) return '';
    // رابطُ المهمة يفتح لوحة المهام على عنوانها — نفسُ نمط الروابط في لوحة المشاريع.
    var task = it.task;
    var link = task && task.title
      ? '<div class="dcd-acts"><a class="btn btn-sm" href="/app/tasks?who=team&amp;q='
        + encodeURIComponent(task.title) + '">' + esc('افتح مهمته') + '</a></div>'
      : '';
    return block('ما استقرّ عليه القرار', '<div class="dcd-kv">' + rows + '</div>' + link);
  }

  // عمودُ صورٍ فيه منطقةُ إفلاتٍ ولصق — «قبل» و«بعد» كلٌّ في عموده، ونوعُ الصورة يصل ترويسةً.
  function shotCol(kind, title, list, may) {
    return '<figure><figcaption>' + esc(title) + '</figcaption>'
      + list.map(imgTag).join('')
      + (may
        ? '<div class="dcd-drop" data-drop="' + kind + '" tabindex="0" role="button" aria-label="'
          + esc('أضف صورة ' + title + ' — الصقها أو أفلتها هنا') + '">'
          + esc('الصق الصورة هنا أو أفلتها — أو اختر ملفاً') + '</div>'
          + '<input type="file" accept="image/*" multiple hidden data-file="' + kind + '">'
        : '')
      + '</figure>';
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

  // ── رفعُ صور «قبل/بعد» من الدرج ─────────────────────────────────────────
  function sendShots(kind, list) {
    var arr = Array.prototype.slice.call(list || []).filter(function (f) { return f && /^image\//.test(f.type); });
    if (!arr.length || busy) return;
    busy = true;
    var itemId = CURRENT;
    // واحدةً بعد واحدة: الخدمة تحدّ عدد الصور، والتتابع يجعل أول رفضٍ يوقف البقية بلا لبس.
    arr.reduce(function (chain, f) {
      return chain.then(function () {
        return postBytes('/products/items/' + encodeURIComponent(itemId) + '/images', f, { 'x-image-kind': kind });
      });
    }, Promise.resolve())
      .then(function () { toast('أُضيفت الصورة ✓'); reload(); })
      .catch(function (e) { toast(e.message || 'تعذّر رفع الصورة', true); })
      .then(function () { busy = false; });
  }

  function wireDrops() {
    var box = document.getElementById('drawer');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('[data-drop]'), function (z) {
      if (z.getAttribute('data-wired')) return;
      z.setAttribute('data-wired', '1');
      var kind = z.getAttribute('data-drop');
      var file = box.querySelector('[data-file="' + kind + '"]');
      z.addEventListener('click', function () { if (file) file.click(); });
      z.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (file) file.click(); }
      });
      z.addEventListener('dragover', function (ev) { ev.preventDefault(); z.classList.add('on'); });
      z.addEventListener('dragleave', function () { z.classList.remove('on'); });
      z.addEventListener('drop', function (ev) {
        ev.preventDefault(); z.classList.remove('on');
        sendShots(kind, ev.dataTransfer && ev.dataTransfer.files);
      });
      if (file) file.addEventListener('change', function () { sendShots(kind, file.files); file.value = ''; });
    });
  }
  // اللصقُ يذهب إلى المنطقة التي عليها التركيز — فلا يُخلط «قبل» بـ«بعد» بلا قصد.
  document.addEventListener('paste', function (e) {
    var z = document.activeElement && document.activeElement.closest
      ? document.activeElement.closest('[data-drop]') : null;
    if (!z) return;
    var its = (e.clipboardData && e.clipboardData.items) || [];
    var files = [];
    for (var i = 0; i < its.length; i++) {
      if (its[i].kind === 'file' && /^image\//.test(its[i].type)) files.push(its[i].getAsFile());
    }
    if (files.length) { e.preventDefault(); sendShots(z.getAttribute('data-drop'), files); }
  });

  // ── الكتابة ────────────────────────────────────────────────────────────
  function write(promise, okMsg) {
    if (busy) return;
    busy = true;
    promise.then(function () { toast(okMsg); reload(); })
      .catch(function (e) { toast(e.message || 'تعذّر إتمام العملية', true); })
      .then(function () { busy = false; });
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

  // نموذجُ الإعدادات يُرسَم في الخادم ويُستنسخ هنا: نصوصُه تُقرأ من المعجم ويحرسها فاحصُ
  // المصطلحات، ولا تُكتب نسخةٌ ثانية منها في ملفّ المتصفّح.
  function tplHtml(id) {
    var el = document.getElementById(id);
    return el ? el.innerHTML : '';
  }
  function addOpt(box, value, label) {
    if (!box) return;
    var o = document.createElement('option');
    o.value = value; o.textContent = label || '';
    box.appendChild(o);
  }
  // نافذةُ خبرٍ بلا حفظ: تقول ما ينقص وتدلّ على مكانه بدل زرٍّ يُنقر فيُردّ.
  function openNote(title, head, body, href, linkLabel) {
    var sn = SN();
    if (!sn.openModal) { toast(head, true); return; }
    sn.openModal('<div class="modal-head"><div style="font-weight:800;font-size:15px">' + esc(title) + '</div>'
      + '<button type="button" class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>'
      + '<div style="padding:1rem 1.15rem;display:grid;gap:.5rem">'
      + '<div style="font-size:13px;font-weight:800;color:#1e293b">' + esc(head) + '</div>'
      + '<div style="font-size:12px;color:#64748b;line-height:1.9">' + esc(body) + '</div></div>'
      + '<div class="modal-foot"><a class="btn btn-primary" href="' + href + '">' + esc(linkLabel) + '</a>'
      + '<button type="button" class="btn" data-action="modal-close">إغلاق</button></div>');
  }

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
  var setVal = function (id, v) { var el = $(id); if (el) el.value = v == null ? '' : String(v); };

  // العملاءُ والمشاريع تُقرآن من مساري المنصة نفسيهما — لا نسخةَ ثانية منهما في هذه الشاشة.
  // واختيارُ العميل يضيّق قائمة المشاريع عليه، فلا يُربط مشروعُ عميلٍ بجهةِ عميلٍ آخر.
  function paintProjects(clientId) {
    var pbox = $('dc-tn-project');
    if (!pbox || !PROJECTS) return;
    var keep = pbox.value;
    pbox.innerHTML = '';
    addOpt(pbox, '', 'بلا مشروع');
    PROJECTS.filter(function (pr) { return !clientId || pr.client_id === clientId; })
      .forEach(function (pr) { addOpt(pbox, pr.id, pr.name_ar || pr.name_en || ''); });
    pbox.value = keep;
  }
  function fillClientsProjects() {
    var cbox = $('dc-tn-client');
    if (cbox) {
      cbox.addEventListener('change', function () { paintProjects(cbox.value); });
      api('/clients').then(function (j) {
        (Array.isArray(j) ? j : (j.clients || [])).forEach(function (c) {
          addOpt(cbox, c.id, c.name_ar || c.name_en || '');
        });
      }).catch(function () {});
    }
    api('/projects').then(function (j) {
      PROJECTS = Array.isArray(j) ? j : (j.projects || []);
      paintProjects(($('dc-tn-client') || {}).value || '');
    }).catch(function () {});
  }

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
    // ── «اطلب توضيحاً»: السؤال شرطُ الخدمة، وكان الزرّ يرسل بلا سؤالٍ فيُردّ في كل مرة ──
    if (a === 'dc-needs-info') {
      e.preventDefault();
      openForm('اطلب توضيحاً من صاحب البلاغ',
        field('dc-qs-text', 'ما الذي تريد معرفته؟',
          '<textarea class="input" id="dc-qs-text" rows="3" maxlength="2000"></textarea>',
          'يصل نصُّ السؤال إلى من أبلغ، ويعود البلاغ إلى ما كان عليه حين يجيب.'),
        'dc-needs-info-save', 'أرسِل السؤال');
      return;
    }
    if (a === 'dc-needs-info-save') {
      e.preventDefault();
      var qText = val('dc-qs-text');
      if (!qText) { toast('اكتب سؤالك لصاحب البلاغ — يصل نصُّه إليه', true); return; }
      write(api('/products/items/' + encodeURIComponent(CURRENT) + '/status', 'POST',
        { to: 'NEEDS_INFO', question: qText }), 'أُرسل السؤال ✓');
      return;
    }

    // ── «تم الحل»: وسمُ الإصدار مطلوبٌ دائماً من الشاشة — ولا إصدارَ يُخترع هنا ──
    if (a === 'dc-resolve') {
      e.preventDefault();
      if (busy) return;
      busy = true;
      api('/products/' + encodeURIComponent(PRODUCT) + '/versions').then(function (j) {
        var vs = (Array.isArray(j) ? j : (j.versions || [])).map(function (v) { return { id: v.id, name: v.label || '' }; });
        if (!vs.length) {
          openNote('تم الحل', 'أضِف إصداراً أولاً من الإعدادات',
            'وسمُ الإصدار هو ما يقول لمن أبلغ متى وصله الحل — ولا يُغلق بلاغٌ بدونه.',
            '/app/dev-center/' + encodeURIComponent(PRODUCT) + '?tab=settings', 'افتح الإعدادات');
          return;
        }
        openForm('تم الحل',
          field('dc-rs-version', 'الإصدار الذي وصل فيه الحل', select('dc-rs-version', opts(vs, 'اختر الإصدار')),
            'يُكتب في بريد من أبلغ وفي التقرير المطبوع.')
          + field('dc-rs-note', 'ملاحظة (اختيارية)',
            '<textarea class="input" id="dc-rs-note" rows="2" maxlength="2000"></textarea>'),
          'dc-resolve-save', 'أغلِق البلاغ');
      }).catch(function (err) { toast(err.message || 'تعذّر قراءة الإصدارات', true); })
        .then(function () { busy = false; });
      return;
    }
    if (a === 'dc-resolve-save') {
      e.preventDefault();
      var vId = val('dc-rs-version');
      if (!vId) { toast('اختر الإصدار الذي وصل فيه الحل', true); return; }
      write(api('/products/items/' + encodeURIComponent(CURRENT) + '/status', 'POST',
        { to: 'RESOLVED', version_id: vId, note: val('dc-rs-note') }), 'أُغلق البلاغ ✓');
      return;
    }

    // ── «مكرر»: الأصل يُختار من بلاغات هذا المنتج وحدها، وليس البلاغ نفسه ──
    if (a === 'dc-duplicate') {
      e.preventDefault();
      if (busy) return;
      busy = true;
      var selfId = CURRENT;
      api('/products/' + encodeURIComponent(PRODUCT) + '/items?limit=500').then(function (j) {
        DUPS = (Array.isArray(j) ? j : (j.items || []))
          .filter(function (r) { return r.id !== selfId; })
          .map(function (r) { return { id: r.id, name: (r.item_key || '') + ' — ' + (r.title || 'بلا عنوان') }; });
        if (!DUPS.length) { toast('لا بلاغَ آخر في هذا المنتج يصلح أصلاً', true); return; }
        openForm('مكرر عن بلاغٍ سابق',
          field('dc-dp-q', 'ابحث في بلاغات المنتج',
            '<input class="input" id="dc-dp-q" maxlength="80" placeholder="' + esc('رقم البلاغ أو كلمة من عنوانه') + '">')
          + field('dc-dp-id', 'البلاغ الأصلي',
            '<select class="input" id="dc-dp-id" size="8" style="height:auto">' + opts(DUPS) + '</select>',
            'يُغلق هذا البلاغ ويُقرأ الأصل مكانه.'),
          'dc-duplicate-save', 'اعتبِره مكرراً');
      }).catch(function (err) { toast(err.message || 'تعذّر قراءة بلاغات المنتج', true); })
        .then(function () { busy = false; });
      return;
    }
    if (a === 'dc-duplicate-save') {
      e.preventDefault();
      var dupId = val('dc-dp-id');
      if (!dupId) { toast('اختر البلاغ الأصلي من القائمة', true); return; }
      write(api('/products/items/' + encodeURIComponent(CURRENT) + '/status', 'POST',
        { to: 'DUPLICATE', duplicate_of_id: dupId }), 'سُجّل التكرار ✓');
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
        + field('dc-np-name-en', 'اسمه بالإنجليزية', text('dc-np-name-en', 'Sanad', 120),
          'يظهر في صفحة الاستقبال حين يفتحها الزائر بالإنجليزية.')
        + field('dc-np-desc', 'وصفٌ مختصر',
          '<textarea class="input" id="dc-np-desc" rows="2" maxlength="2000"></textarea>')
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
        name_ar: pName, name_en: val('dc-np-name-en'), description: val('dc-np-desc'),
        key: pPrefix.toLowerCase(), item_prefix: pPrefix, kind: val('dc-np-kind') || 'external',
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
    // ── الجهة: عميلٌ ومشروعٌ يُختاران، لا اسمٌ حرٌّ وحده. و`project_id` هو ما تُفتح عليه
    // مهامُ بلاغاتها، فبدونه تبقى الميزة ميتةً وإن بدت الجهة مسجَّلة.
    if (a === 'dc-tenant-new') {
      e.preventDefault();
      var tnTpl = tplHtml('dc-tpl-tenant');
      if (!tnTpl) { toast('تعذّر فتح النموذج — أعد تحميل الصفحة', true); return; }
      openForm('جهة جديدة', tnTpl, 'dc-tenant-save', 'أضِف الجهة');
      fillClientsProjects();
      return;
    }
    if (a === 'dc-tenant-save') {
      e.preventDefault();
      var tnName = val('dc-tn-name');
      if (!tnName) { toast('اكتب اسم الجهة', true); return; }
      write(api('/products/' + encodeURIComponent(PRODUCT) + '/tenants', 'POST', {
        name: tnName, client_id: val('dc-tn-client'), project_id: val('dc-tn-project'),
        internal: !!($('dc-tn-internal') || {}).checked,
      }), 'أُضيفت الجهة ✓');
      return;
    }

    // ── رابط الاستقبال: وضعُ التعريف واللغة والتمهيد والانتهاء — إنشاءً وتحريراً بنموذجٍ واحد.
    if (a === 'dc-link-new' || a === 'dc-link-edit') {
      e.preventDefault();
      var lkTpl = tplHtml('dc-tpl-link');
      if (!lkTpl) { toast('تعذّر فتح النموذج — أعد تحميل الصفحة', true); return; }
      LINK_ID = a === 'dc-link-edit' ? (t.getAttribute('data-link-id') || '') : '';
      LINK_TENANT = a === 'dc-link-new' ? (t.getAttribute('data-tenant') || '') : '';
      openForm(LINK_ID ? 'إعدادات الرابط' : 'رابط استقبال جديد', lkTpl, 'dc-link-save',
        LINK_ID ? 'احفظ' : 'أنشِئ الرابط');
      if (LINK_ID) {
        setVal('dc-lk-mode', t.getAttribute('data-mode'));
        setVal('dc-lk-lang', t.getAttribute('data-lang'));
        setVal('dc-lk-intro-ar', t.getAttribute('data-intro-ar'));
        setVal('dc-lk-intro-en', t.getAttribute('data-intro-en'));
        setVal('dc-lk-expires', t.getAttribute('data-expires'));
      }
      return;
    }
    if (a === 'dc-link-save') {
      e.preventDefault();
      var lkBody = {
        identity_mode: val('dc-lk-mode'), default_lang: val('dc-lk-lang'),
        intro_ar: val('dc-lk-intro-ar'), intro_en: val('dc-lk-intro-en'),
        expires_on: val('dc-lk-expires'),
      };
      if (LINK_ID) {
        write(api('/products/links/' + encodeURIComponent(LINK_ID), 'PATCH', lkBody), 'حُفظت إعدادات الرابط ✓');
      } else {
        lkBody.tenant_id = LINK_TENANT;
        write(api('/products/' + encodeURIComponent(PRODUCT) + '/links', 'POST', lkBody), 'أُنشئ رابط الاستقبال ✓');
      }
      return;
    }
    if (a === 'dc-link-toggle') {
      e.preventDefault();
      var wasOn = t.getAttribute('data-on') === '1';
      write(api('/products/links/' + encodeURIComponent(t.getAttribute('data-link-id')), 'PATCH',
        { enabled: !wasOn }), wasOn ? 'أُوقف الرابط ✓' : 'فُعِّل الرابط ✓');
      return;
    }
    if (a === 'dc-link-rotate') {
      e.preventDefault();
      if (!window.confirm('يُبطَل العنوان القديم فوراً ولا يعود يعمل. أتريد عنواناً جديداً لهذا الرابط؟')) return;
      write(api('/products/links/' + encodeURIComponent(t.getAttribute('data-link-id')) + '/rotate', 'POST'),
        'صار للرابط عنوانٌ جديد ✓');
      return;
    }

    if (a === 'dc-version-new') {
      e.preventDefault();
      openForm('إصدار جديد',
        field('dc-vr-label', 'وسم الإصدار', text('dc-vr-label', '٥٫٨٣', 60),
          'يُقرأ في بريد من أبلغ وفي التقرير المطبوع: «وصل الحل في هذا الإصدار».')
        + field('dc-vr-date', 'تاريخ الإطلاق', '<input class="input" id="dc-vr-date" type="date">')
        + field('dc-vr-note', 'ملاحظة (اختيارية)',
          '<textarea class="input" id="dc-vr-note" rows="2" maxlength="1000"></textarea>'),
        'dc-version-save', 'أضِف الإصدار');
      return;
    }
    if (a === 'dc-version-save') {
      e.preventDefault();
      var vLabel = val('dc-vr-label');
      if (!vLabel) { toast('اكتب وسم الإصدار', true); return; }
      write(api('/products/' + encodeURIComponent(PRODUCT) + '/versions', 'POST', {
        label: vLabel, released_on: val('dc-vr-date'), note: val('dc-vr-note'),
      }), 'أُضيف الإصدار ✓');
      return;
    }

    if (a === 'dc-product-save') {
      e.preventDefault();
      var prName = val('dc-pr-name');
      if (!prName) { toast('اكتب اسم المنتج', true); return; }
      write(api('/products/' + encodeURIComponent(PRODUCT), 'PATCH', {
        name_ar: prName, name_en: val('dc-pr-name-en'), description: val('dc-pr-desc'),
        brand_color: ($('dc-brand-color') || {}).value || '',
      }), 'حُفظت بيانات المنتج ✓');
      return;
    }
    if (a === 'dc-logo-save') {
      e.preventDefault();
      var lf = $('dc-logo-file');
      var lfFile = lf && lf.files && lf.files[0];
      if (!lfFile) { toast('اختر ملفَ الشعار أولاً', true); return; }
      if (busy) return;
      busy = true;
      postBytes('/products/' + encodeURIComponent(PRODUCT) + '/logo', lfFile)
        .then(function () { toast('رُفع الشعار ✓'); reload(); })
        .catch(function (err) { toast(err.message || 'تعذّر رفع الشعار', true); })
        .then(function () { busy = false; });
      return;
    }
    if (a === 'dc-manual-add') {
      e.preventDefault();
      openForm('سجّل عن غيرك',
        field('dc-mn-title', 'عنوان البلاغ', text('dc-mn-title', 'مثال: زرّ الحفظ لا يستجيب', 200))
        // «أين حدث» إلزاميٌّ هنا كما هو في نافذة «أبلغ»: بلاغٌ بلا موضعٍ يُعاد إلى صاحبه سؤالاً.
        + field('dc-mn-where', 'أين حدث هذا؟', text('dc-mn-where', 'اسم الشاشة أو الخطوة', 200),
          'مطلوب — الفريق يبدأ من الموضع، وبلاغٌ بلا موضعٍ يبدأ بسؤالٍ ثانٍ لمن أبلغ.')
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
      var mnWhere = val('dc-mn-where');
      if (!mnTitle) { toast('اكتب عنوان البلاغ', true); return; }
      if (!mnWhere) { toast('اكتب أين حدث — الحقل إلزامي', true); return; }
      if (!mnSector) { toast('اختر القطاع — إلزاميٌّ في التسجيل عن الغير', true); return; }
      write(api('/products/' + encodeURIComponent(PRODUCT) + '/items', 'POST', {
        // الحسابُ المختار يسبق الاسم المكتوب: الخدمة تأخذ اسمه من سجلّه فلا يُكتب مرتين.
        title: mnTitle, where_text: mnWhere,
        reporter_user_id: mnUser, reporter_name: mnUser ? '' : val('dc-mn-person'), sector_id: mnSector,
        type: val('dc-mn-type') || 'bug', urgency: val('dc-mn-urg') || 'delays',
      }), 'سُجّل البلاغ ✓');
    }
  });

  // بحثُ منتقي «مكرر عن»: تصفيةٌ في المتصفّح على قائمةٍ قُرئت مرةً واحدة — لا نداءَ لكل حرف.
  document.addEventListener('input', function (e) {
    if (!e.target || e.target.id !== 'dc-dp-q') return;
    var box = $('dc-dp-id');
    if (!box) return;
    var needle = String(e.target.value || '').trim().toLowerCase();
    var hits = DUPS.filter(function (r) { return !needle || r.name.toLowerCase().indexOf(needle) >= 0; });
    box.innerHTML = opts(hits);
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
    new MutationObserver(function () {
      if (document.getElementById('dcd-assignee')) fillTeam();
      wireDrops();
    }).observe(drawer, { childList: true });
  }
}());
