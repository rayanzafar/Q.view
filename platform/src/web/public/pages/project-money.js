// حركة المال على المشروع — تبديل سنة العرض، ونافذة تفصيل الأشهر، وتسجيل المصروف وتعديله وحذفه.
//
// الخادم يبني كل لوح سنة وكل نافذة تفصيل مسبقاً وبنفس صلاحية الصفحة، وهذا الملف لا يبني وسماً
// من بيانات قادمة من الخادم: يبدّل ظهور ما هو مبنيّ أصلاً، ويرسل الكتابات إلى خدمة المصروفات.
// كل تفاعل عبر data-action ومستمع واحد مفوَّض — لا onclick داخل الوسوم.
(function () {
  'use strict';
  var S = function () { return (window.__SANAD && window.__SANAD.money) || {}; };

  var call = async function (path, method, body) {
    var r = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error((j.error && j.error.message) || 'تعذّر إتمام الطلب — أعد المحاولة');
    return j;
  };
  var toast = function (msg, bad) {
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;'
      + 'font-size:13px;max-width:min(420px,90vw);line-height:1.7;box-shadow:0 8px 24px rgba(0,0,0,.2);background:'
      + (bad ? '#dc2626' : '#059669');
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, bad ? 5200 : 2600);
  };
  var reload = function () { setTimeout(function () { location.reload(); }, 450); };

  // ── سنة العرض: كل لوح مبنيّ على الخادم، والتبديل إظهار وإخفاء بلا طلب جديد ──
  function showYear(year) {
    var found = false;
    document.querySelectorAll('.money-panel').forEach(function (p) {
      var on = p.dataset.moneyYear === year;
      p.hidden = !on;
      if (on) found = true;
    });
    if (!found) return;
    document.querySelectorAll('[data-action="money-year"]').forEach(function (b) {
      var on = b.dataset.year === year;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  // ── نافذة تفصيل الأشهر: قالب خامل مبنيّ على الخادم يفتحه غلاف النوافذ الموحّد ──
  function openDetails(key) {
    var t = document.getElementById('dd-' + key);
    if (!t || !window.Sanad) return;
    window.Sanad.openModal(t.innerHTML);
  }

  // ── سجل المصروفات ──
  var el = function (id) { return document.getElementById(id); };
  var v = function (id) { var e = el(id); return e ? String(e.value).trim() : ''; };
  var splitPeriod = function (s) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(s || ''));
    return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
  };

  async function expAdd(projectId) {
    var type = v('m-exp-type');
    if (!type) { toast('اكتب وصف المصروف أولاً (مثل: سفر، طباعة، اشتراك شهري)', true); if (el('m-exp-type')) el('m-exp-type').focus(); return; }
    var amount = Number(v('m-exp-amount'));
    if (!(amount > 0)) { toast('أدخل مبلغ المصروف بالريال — رقماً أكبر من صفر', true); if (el('m-exp-amount')) el('m-exp-amount').focus(); return; }
    var per = splitPeriod(v('m-exp-period'));
    if (!per) { toast('حدّد شهر الصرف من القائمة', true); return; }
    try {
      await call('/projects/' + projectId + '/expenses', 'POST',
        { type: type, amount_sar: amount, month: per.month, year: per.year, status: v('m-exp-status') || 'DRAFT' });
      toast('سُجِّل المصروف ✓');
      reload();
    } catch (e) { toast(e.message, true); }
  }

  function toggleEdit(id, on) {
    var view = document.querySelector('[data-exp-row="' + id + '"]');
    var edit = document.querySelector('[data-exp-edit="' + id + '"]');
    if (!view || !edit) return;
    view.hidden = on;
    edit.hidden = !on;
    if (on) { var f = edit.querySelector('[data-f="type"]'); if (f) f.focus(); }
  }

  async function expSave(id) {
    var row = document.querySelector('[data-exp-edit="' + id + '"]');
    if (!row) return;
    var get = function (f) { var e = row.querySelector('[data-f="' + f + '"]'); return e ? String(e.value).trim() : ''; };
    var type = get('type');
    if (!type) { toast('وصف المصروف لا يُترك فارغاً', true); return; }
    var amount = Number(get('amount'));
    if (!(amount > 0)) { toast('أدخل مبلغ المصروف بالريال — رقماً أكبر من صفر', true); return; }
    var per = splitPeriod(get('period'));
    if (!per) { toast('حدّد شهر الصرف من القائمة', true); return; }
    try {
      await call('/finance/expenses/' + id, 'PATCH', { type: type, amount_sar: amount, month: per.month, year: per.year });
      toast('حُفظ التعديل ✓');
      reload();
    } catch (e) { toast(e.message, true); }
  }

  async function expStatus(id, status) {
    try { await call('/finance/expenses/' + id, 'PATCH', { status: status }); toast('حُدّثت حالة المصروف ✓'); reload(); }
    catch (e) { toast(e.message, true); reload(); }
  }

  async function expDelete(id) {
    if (!window.confirm('حذف هذا المصروف من سجل المشروع؟')) return;
    try { await call('/finance/expenses/' + id, 'DELETE'); toast('حُذف المصروف ✓'); reload(); }
    catch (e) { toast(e.message, true); }
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-action]');
    if (!t) return;
    var a = t.dataset.action;
    if (a === 'money-year') return showYear(t.dataset.year);
    if (a === 'money-dd') return openDetails(t.dataset.dd);
    if (a === 'money-close') return void (window.Sanad && window.Sanad.closeModal());
    if (a === 'exp-add') return void expAdd(t.dataset.project || S().projectId);
    if (a === 'exp-edit') return toggleEdit(t.dataset.id, true);
    if (a === 'exp-cancel') return toggleEdit(t.dataset.id, false);
    if (a === 'exp-save') return void expSave(t.dataset.id);
    if (a === 'exp-del') return void expDelete(t.dataset.id);
  });
  document.addEventListener('change', function (ev) {
    var s = ev.target.closest('[data-action-change="exp-status"]');
    if (s) return void expStatus(s.dataset.id, s.value);
  });
  // Enter داخل شريط التسجيل يسجّل المصروف — بلا مغادرة لوحة المفاتيح
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter') return;
    var id = ev.target.id || '';
    if (id === 'm-exp-type' || id === 'm-exp-amount') {
      ev.preventDefault();
      var btn = document.querySelector('[data-action="exp-add"]');
      if (btn) expAdd(btn.dataset.project || S().projectId);
    }
  });
})();
