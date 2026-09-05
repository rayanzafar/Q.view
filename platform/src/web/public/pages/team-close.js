// عميل الإقفال الشهري (S22–S25) — وحدة الفريق والموارد.
// تفويض data-action فقط (لا onclick)، البيانات من window.__SANAD.close (مقصوصة بصلاحية القارئ
// في الخادم)، والخادم هو الحجة: لا نجاح قبل ردّه، وخطؤه يُعرض بنصّه ويُسمح بإعادة المحاولة بلا
// تكرار (تعطيل الزر أثناء الإرسال). النسب تُكتب بالمئة بخانتين وتُرسل نقاط أساس (10000 = 100%).
(function () {
  'use strict';

  var FULL = 10000;
  var S = function () { return (window.__SANAD && window.__SANAD.close) || {}; };
  var esc = function (s) {
    if (window.Sanad && window.Sanad.esc) return window.Sanad.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var enc = encodeURIComponent;
  var api = async function (path, method, body) {
    var r = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' } : { 'X-Requested-With': 'fetch' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { location.reload(); return new Promise(function () {}); }
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error((j.error && j.error.message) || 'تعذّر إتمام العملية — أعد المحاولة'); e.status = r.status; throw e; }
    return j;
  };
  var toast = function (msg, bad) {
    if (window.Sanad && typeof window.Sanad.toast === 'function') return window.Sanad.toast(msg, bad);
    var d = document.createElement('div');
    d.textContent = msg; d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;max-width:min(92vw,460px);line-height:1.7;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#b91c1c' : '#047857');
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, bad ? 5600 : 2600);
  };
  var modal = function (html) { if (window.Sanad && window.Sanad.openModal) { window.Sanad.openModal(html); return true; } return false; };
  var closeModal = function () { if (window.Sanad && window.Sanad.closeModal) window.Sanad.closeModal(); };
  var reload = function () { setTimeout(function () { location.reload(); }, 420); };
  var fmtPct = function (bp) { return (Number(bp || 0) / 100).toFixed(2); };
  var toBp = function (v) { var n = Number(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
  var resWord = function (n) { return n === 1 ? 'مورد واحد' : n === 2 ? 'موردان' : n >= 3 && n <= 10 ? n + ' موارد' : n + ' مورداً'; };
  var signed = function (bp) { return (bp > 0 ? '+' : bp < 0 ? '−' : '') + fmtPct(Math.abs(bp)) + '%'; };

  // ── منع النقر المتكرر: مفتاحٌ لكل عملية وتعطيل الزر أثناءها ──
  var busy = {};
  function guard(key, btn, fn, onError) {
    if (busy[key]) return;
    busy[key] = true; if (btn) btn.disabled = true;
    Promise.resolve().then(fn).then(function (keep) { if (!keep && btn) btn.disabled = false; }, function (err) {
      if (btn) btn.disabled = false;
      if (onError) onError(err); else toast(err.message, true);
    }).then(function () { delete busy[key]; });
  }
  var showErr = function (box, msg) { if (!box) { toast(msg, true); return; } box.textContent = msg; box.hidden = false; box.scrollIntoView({ block: 'nearest' }); };
  var hideErr = function (box) { if (box) { box.hidden = true; box.textContent = ''; } };

  // ── جهات التحميل (S23 والدرج): مشاريع القطاع القائمة في الشهر، القطاع نفسه، وقطاع آخر ──
  function targetOptions() {
    var t = S().targets || {}; var projects = t.projects || []; var sec = t.sector || {}; var others = t.otherSectors || [];
    var h = '<option value="">— اختر جهة التحميل —</option>';
    if (projects.length) {
      h += '<optgroup label="مشاريع القطاع القائمة في الشهر">' + projects.map(function (p) {
        return '<option value="project:' + esc(p.id) + '" data-label="' + esc(p.name) + '" data-fin="' + esc(p.fin_code || '') + '">' + esc(p.name) + (p.fin_code ? ' · ' + esc(p.fin_code) : ' · بلا كود مالي') + '</option>';
      }).join('') + '</optgroup>';
    }
    if (sec.id) h += '<optgroup label="القطاع"><option value="sector:' + esc(sec.id) + '" data-label="' + esc(sec.name || 'القطاع') + '" data-fin="' + esc(sec.fin_code || '') + '">القطاع · ' + esc(sec.name || '') + (sec.fin_code ? ' · ' + esc(sec.fin_code) : '') + '</option></optgroup>';
    if (others.length) {
      h += '<optgroup label="قطاع آخر (يمر بموافقته)">' + others.map(function (s) {
        return '<option value="other:' + esc(s.id) + '" data-label="' + esc(s.name) + '" data-fin="">' + esc(s.name) + '</option>';
      }).join('') + '</optgroup>';
    }
    return h;
  }
  var codeHtml = function (fin) { return fin ? '<span class="code tnum">' + esc(fin) + '</span>' : '<span class="tm-close-chip">كود مفقود</span>'; };
  function applyTarget(row, select) {
    var opt = select.options[select.selectedIndex];
    var v = String(select.value || ''); var i = v.indexOf(':');
    var kind = i > 0 ? v.slice(0, i) : ''; var id = i > 0 ? v.slice(i + 1) : '';
    row.dataset.other = kind === 'other' ? '1' : '';
    row.dataset.kind = kind === 'other' ? 'sector' : kind;
    row.dataset.target = id;
    row.dataset.label = (opt && opt.dataset.label) || '';
    row.dataset.fin = (opt && opt.dataset.fin) || '';
    var codeCell = row.querySelector('[data-role="code"]');
    if (codeCell) codeCell.innerHTML = kind ? (kind === 'other' ? '<span class="tm-note">بموافقة قطاعه</span>' : codeHtml(row.dataset.fin)) : '—';
  }
  function anyOther(tbody) { return !!tbody.querySelector('tr[data-other="1"]'); }

  // ── S23: تحرير أسطر التوزيع ─────────────────────────────────────────────────
  var linesBody = function () { var t = document.getElementById('tm-close-lines'); return t ? t.querySelector('tbody') : null; };
  function collectLines(tbody, pctClass) {
    var out = [];
    tbody.querySelectorAll('tr[data-kind]').forEach(function (tr) {
      var inp = tr.querySelector('.' + pctClass);
      var bp = inp ? toBp(inp.value) : Number(tr.dataset.bp || 0);
      out.push({ target_kind: tr.dataset.kind || '', target_id: tr.dataset.target || '', fin_code: tr.dataset.fin || '', label: tr.dataset.label || '', shareBp: bp, other: tr.dataset.other === '1', old: Number(tr.dataset.old || 0) });
    });
    return out;
  }
  function draftDiffers(lines) {
    var draft = S().draft || [];
    var cur = {}; lines.forEach(function (l) { if (l.shareBp > 0 && l.target_kind && l.target_id) cur[l.target_kind + ':' + l.target_id] = (cur[l.target_kind + ':' + l.target_id] || 0) + l.shareBp; });
    var keys = Object.keys(cur);
    if (keys.length !== draft.length) return true;
    for (var i = 0; i < draft.length; i += 1) { if (cur[draft[i].k] !== Number(draft[i].bp)) return true; }
    return false;
  }
  function recalcLines() {
    var tbody = linesBody(); if (!tbody) return;
    var lines = collectLines(tbody, 'tm-close-pct');
    var total = lines.reduce(function (a, l) { return a + (l.target_kind ? l.shareBp : 0); }, 0);
    var tot = document.getElementById('tm-close-total'); var note = document.getElementById('tm-close-total-note');
    var un = document.getElementById('tm-close-unalloc'); var diff = document.getElementById('tm-close-diff');
    if (tot) { tot.innerHTML = '<span class="tnum">' + fmtPct(total) + '%</span>'; tot.className = 'v ' + (total === FULL ? 'ok' : 'bad'); }
    if (note) note.textContent = total === FULL ? 'يساوي 100% بدقة التخزين' : (total < FULL ? 'ينقص ' + fmtPct(FULL - total) + '% للوصول إلى 100%' : 'يزيد ' + fmtPct(total - FULL) + '% عن 100%');
    if (un) un.innerHTML = '<span class="tnum">' + fmtPct(Math.max(0, FULL - total)) + '%</span>';
    var differs = draftDiffers(lines);
    if (diff && (S().draft || []).length) diff.textContent = differs ? 'يختلف عن المسودة المحسوبة من التسكين — اكتب سبب التعديل' : 'مطابق للمسودة المحسوبة من التسكين المؤكد';
    var other = document.getElementById('tm-close-other-note'); if (other) other.hidden = !anyOther(tbody);
    var lbl = document.getElementById('tm-close-reason-label'); if (lbl) lbl.classList.toggle('req', differs);
  }
  function addLineRow() {
    var tbody = linesBody(); if (!tbody) return;
    var tr = document.createElement('tr');
    tr.dataset.kind = ''; tr.dataset.target = ''; tr.dataset.label = ''; tr.dataset.fin = ''; tr.dataset.new = '1';
    tr.innerHTML = '<td><select class="tm-close-target" aria-label="جهة التحميل">' + targetOptions() + '</select></td>'
      + '<td data-role="code">—</td>'
      + '<td><label class="tm-note" style="display:inline-flex;gap:.3rem;align-items:center"><input type="number" class="tm-close-pct" step="0.01" min="0" max="100" value="0.00" aria-label="النسبة"> %</label></td>'
      + '<td><button type="button" class="btn btn-ghost btn-sm" data-action="close-line-remove" aria-label="حذف السطر">✕</button></td>';
    tbody.appendChild(tr);
    var sel = tr.querySelector('select'); if (sel) sel.focus();
    recalcLines();
  }
  function validateLines(lines, errBox) {
    var live = lines.filter(function (l) { return l.shareBp > 0; });
    if (!live.length) { showErr(errBox, 'أضف سطر توزيع واحداً على الأقل — مشروع أو القطاع — بنسبة أكبر من صفر.'); return null; }
    var missing = live.filter(function (l) { return !l.target_kind || !l.target_id; });
    if (missing.length) { showErr(errBox, 'اختر جهة التحميل لكل سطر قبل التأكيد.'); return null; }
    var other = live.filter(function (l) { return l.other; });
    if (other.length) { showErr(errBox, 'تحميل قطاع آخر يمر بموافقة قطاعه — لا يُحفظ من هذه الشاشة في هذا الإصدار؛ حمّله على قطاع الفترة أو مشروع فيه.'); return null; }
    var seen = {};
    for (var i = 0; i < live.length; i += 1) { var k = live[i].target_kind + ':' + live[i].target_id; if (seen[k]) { showErr(errBox, 'جهة التحميل «' + live[i].label + '» مكررة في أكثر من سطر — اجمعها في سطر واحد.'); return null; } seen[k] = true; }
    var total = live.reduce(function (a, l) { return a + l.shareBp; }, 0);
    if (total !== FULL) { showErr(errBox, 'مجموع التوزيع ' + fmtPct(total) + '% — يجب أن يساوي 100.00% بالضبط (' + (total < FULL ? 'ينقص ' + fmtPct(FULL - total) : 'يزيد ' + fmtPct(total - FULL)) + '%).'); return null; }
    return live;
  }
  function confirmShares(btn) {
    var s = S(); var tbody = linesBody(); if (!tbody) return;
    var errBox = document.getElementById('tm-close-err'); hideErr(errBox);
    var lines = validateLines(collectLines(tbody, 'tm-close-pct'), errBox); if (!lines) return;
    var reasonEl = document.getElementById('tm-close-reason'); var reason = reasonEl ? String(reasonEl.value || '').trim() : '';
    if (draftDiffers(lines) && reason.length < 3) { showErr(errBox, 'التوزيع يختلف عن المسودة المحسوبة من التسكين — اكتب سبب التعديل ليُحفظ في الأثر.'); if (reasonEl) reasonEl.focus(); return; }
    var src = document.getElementById('tm-close-source');
    guard('confirm', btn, async function () {
      await api('/team/close/' + enc(s.periodId) + '/resources/' + enc(s.employeeId) + '/confirm', 'POST', {
        lines: lines.map(function (l) { return { target_kind: l.target_kind, target_id: l.target_id, shareBp: l.shareBp }; }),
        reason: reason, sourceRef: src ? src.value : '',
      });
      toast('أُكِّد التوزيع ✓ — تأكيد المدير لا يقفل الشهر مالياً');
      setTimeout(function () { location.href = s.baseUrl || '/app/team/close'; }, 500);
      return true;
    }, function (err) { showErr(errBox, err.message); });
  }

  // ── S22: تحديث المسودة والإرسال ───────────────────────────────────────────────
  function regenerate(btn) {
    var s = S();
    if (!window.confirm('تحديث المسودة من التسكين المؤكد لشهر ' + (s.month || '') + '؟\nالأسطر التي أكّدها المدير تبقى كما هي، ويُعاد توليد غير المؤكد فقط.')) return;
    guard('regen', btn, async function () {
      var r = await api('/team/close/' + enc(s.periodId) + '/draft', 'POST', { preserveConfirmed: true });
      var parts = [];
      if (r.generated) parts.push('أُعيد توليد ' + resWord(r.generated));
      if (r.kept) parts.push('حُفظ المؤكد لـ' + resWord(r.kept));
      if (r.removed) parts.push('أُزيل توزيع ' + resWord(r.removed));
      if (r.excludedNow && r.excludedNow.length) parts.push('خارج التوزيع ' + resWord(r.excludedNow.length));
      toast(parts.length ? 'حُدّثت المسودة — ' + parts.join('، ') : 'لا فروق عن التسكين المؤكد — المسودة كما هي');
      reload(); return true;
    });
  }
  function sendToFinance(btn) {
    var s = S();
    if (btn.disabled) return;
    if (!window.confirm('إرسال شهر ' + (s.month || '') + ' إلى المراجعة المالية؟\nبعد الإرسال لا يُعدَّل التوزيع حتى تعيده المراجعة المالية.')) return;
    guard('send', btn, async function () {
      await api('/team/close/' + enc(s.periodId) + '/send', 'POST', {});
      toast('أُرسل الشهر إلى المراجعة المالية ✓');
      reload(); return true;
    });
  }

  // ── S24: الإعادة والإقفال ───────────────────────────────────────────────────
  function openReturn() {
    var html = '<div class="modal-head"><div style="font-weight:800;font-size:15px">إعادة الشهر إلى المدير</div><button class="btn btn-ghost btn-sm" data-action="close-modal-close" aria-label="إغلاق">✕</button></div>'
      + '<div class="modal-body"><div class="field"><label for="tm-close-return-reason">سبب الإعادة — يظهر للمدير ويُحفظ في الأثر</label>'
      + '<textarea id="tm-close-return-reason" rows="3" maxlength="500" placeholder="ماذا ينقص التوزيع ليُعتمد؟"></textarea></div></div>'
      + '<div class="modal-foot"><button class="btn" data-action="close-modal-close">إلغاء</button><button class="btn btn-primary" data-action="close-return-go">إعادة للمدير</button></div>';
    if (!modal(html)) { var why = window.prompt('سبب الإعادة إلى المدير:'); if (why) doReturn(why, null); return; }
    var ta = document.getElementById('tm-close-return-reason'); if (ta) ta.focus();
  }
  function doReturn(reason, btn) {
    var s = S();
    if (String(reason || '').trim().length < 3) { toast('اكتب سبب الإعادة — يظهر للمدير ليصحّح', true); var ta = document.getElementById('tm-close-return-reason'); if (ta) ta.focus(); return; }
    guard('return', btn, async function () {
      await api('/team/close/' + enc(s.periodId) + '/return', 'POST', { reason: String(reason).trim() });
      closeModal(); toast('أُعيد الشهر إلى المدير — وصل السبب ✓'); reload(); return true;
    });
  }
  function openLock(version) {
    var s = S();
    var html = '<div class="modal-head"><div style="font-weight:800;font-size:15px">اعتماد وإقفال الشهر</div><button class="btn btn-ghost btn-sm" data-action="close-modal-close" aria-label="إغلاق">✕</button></div>'
      + '<div class="modal-body"><p style="margin:0 0 .6rem">إقفال شهر <b>' + esc(s.month || '') + '</b> — الإصدار <b class="tnum">' + esc(version) + '</b>.</p>'
      + '<p style="margin:0 0 .6rem;color:var(--muted);font-size:12.5px;line-height:1.8">يُعاد التحقق من الأكواد والمجاميع والاعتمادات داخل المعاملة قبل تثبيت النسخة. بعد الإقفال لا تعديل مباشر — التعديل بطلب تصحيح يُنشئ إصداراً جديداً. حالة الترحيل للنظام المالي تبقى «لم يتم»: لا تكامل خارجي في هذا الإصدار.</p></div>'
      + '<div class="modal-foot"><button class="btn" data-action="close-modal-close">إلغاء</button><button class="btn btn-primary" data-action="close-lock-go" data-version="' + esc(version) + '">اعتماد وإقفال الشهر</button></div>';
    if (!modal(html)) { if (window.confirm('اعتماد وإقفال شهر ' + (s.month || '') + ' — الإصدار ' + version + '؟')) doLock(version, null); }
  }
  function showConflict(err) {
    var box = document.getElementById('tm-close-conflict');
    if (!box) { toast(err.message, true); return; }
    var slot = box.querySelector('[data-slot="msg"]');
    if (slot) slot.innerHTML = '<b>تغيّرت النسخة منذ فتح الشاشة — حدّث الصفحة وراجع من جديد</b><div style="margin-top:.3rem">' + esc(err.message) + '</div>';
    box.hidden = false; box.scrollIntoView({ block: 'nearest' });
    document.querySelectorAll('[data-action="close-lock"]').forEach(function (b) { b.disabled = true; });
  }
  function doLock(version, btn) {
    var s = S();
    guard('lock', btn, async function () {
      var r = await api('/team/close/' + enc(s.periodId) + '/lock', 'POST', { expectedVersion: Number(version) });
      closeModal(); toast('أُقفل الشهر — الإصدار ' + (r.version || version) + ' ✓'); reload(); return true;
    }, function (err) {
      closeModal();
      if (err.status === 409 || err.status === 400) showConflict(err); else toast(err.message, true);
    });
  }

  // ── S25: درج طلب التصحيح ─────────────────────────────────────────────────────
  var drawer = { el: null, scrim: null, opener: null, dirty: false, emp: '' };
  var drawerEls = function () { drawer.el = document.getElementById('tm-close-drawer'); drawer.scrim = document.getElementById('tm-close-scrim'); return !!(drawer.el && drawer.scrim); };
  var corrBody = function () { return drawer.el ? drawer.el.querySelector('[data-slot="rows"]') : null; };
  function corrRow(l) {
    return '<tr data-kind="' + esc(l.target_kind) + '" data-target="' + esc(l.target_id) + '" data-label="' + esc(l.label || '') + '" data-fin="' + esc(l.fin_code || '') + '" data-old="' + Number(l.shareBp || 0) + '">'
      + '<td><div>' + esc(l.label || (l.target_kind === 'sector' ? 'القطاع' : 'مشروع')) + '</div><div class="tm-note" data-role="code">' + codeHtml(l.fin_code) + '</div></td>'
      + '<td class="tnum">' + fmtPct(l.shareBp) + '%</td>'
      + '<td><label class="tm-note" style="display:inline-flex;gap:.3rem;align-items:center"><input type="number" class="tm-close-corr-pct" step="0.01" min="0" max="100" value="' + fmtPct(l.shareBp) + '" aria-label="المقترح لـ' + esc(l.label || '') + '"> %</label></td>'
      + '<td class="tnum" data-role="diff">0.00%</td>'
      + '<td><button type="button" class="btn btn-ghost btn-sm" data-action="close-corr-remove" aria-label="إزالة السطر من المقترح">✕</button></td></tr>';
  }
  function recalcCorr() {
    var tbody = corrBody(); if (!tbody) return;
    var lines = collectLines(tbody, 'tm-close-corr-pct');
    var oldTotal = 0; var newTotal = 0;
    tbody.querySelectorAll('tr').forEach(function (tr) {
      var old = Number(tr.dataset.old || 0); var inp = tr.querySelector('.tm-close-corr-pct'); var nw = inp ? toBp(inp.value) : 0;
      oldTotal += old; if (tr.dataset.kind) newTotal += nw;
      var d = tr.querySelector('[data-role="diff"]'); if (d) { d.textContent = signed(nw - old); d.style.color = nw > old ? 'var(--green)' : nw < old ? 'var(--red)' : 'var(--muted)'; }
    });
    var set = function (slot, html, cls) { var el = drawer.el.querySelector('[data-slot="' + slot + '"]'); if (el) { el.innerHTML = html; if (cls != null) el.style.color = cls; } };
    set('oldTotal', fmtPct(oldTotal) + '%');
    set('newTotal', fmtPct(newTotal) + '%', newTotal === FULL ? 'var(--green)' : 'var(--red)');
    set('diffTotal', signed(newTotal - oldTotal), newTotal === oldTotal ? 'var(--muted)' : 'var(--red)');
    var note = drawer.el.querySelector('[data-slot="otherNote"]'); if (note) note.hidden = !anyOther(tbody);
    return lines;
  }
  function openCorrection(empId, opener) {
    var s = S(); var snap = (s.snapshot || {})[empId];
    if (!s.canCorrect) { toast('طلب التصحيح لمدير إدارة المورد أو قائد قطاعه أو المراجعة المالية', true); return; }
    if (!snap) { toast('لا أسطر معتمدة لهذا المورد في هذه النسخة', true); return; }
    var tpl = document.getElementById('tm-close-correction-tpl');
    if (!tpl || !drawerEls()) { toast('تعذّر فتح طلب التصحيح — حدّث الصفحة', true); return; }
    drawer.el.innerHTML = tpl.innerHTML;
    drawer.emp = empId; drawer.opener = opener || null; drawer.dirty = false;
    var name = drawer.el.querySelector('[data-slot="name"]'); if (name) name.textContent = snap.name || '';
    var who = drawer.el.querySelector('[data-slot="who"]'); if (who) who.textContent = (snap.name || '') + ' · ' + (s.month || '') + ' · الإصدار ' + (s.version || '');
    var tbody = corrBody(); if (tbody) tbody.innerHTML = (snap.lines || []).map(corrRow).join('');
    recalcCorr();
    drawer.el.classList.add('open'); drawer.scrim.classList.add('open'); drawer.el.setAttribute('aria-hidden', 'false');
    var first = drawer.el.querySelector('.tm-close-corr-pct'); if (first) first.focus();
  }
  function closeDrawer(force) {
    if (!drawer.el || !drawer.el.classList.contains('open')) return;
    if (drawer.dirty && !force && !window.confirm('إغلاق طلب التصحيح دون إرسال؟ ستفقد ما كتبته.')) return;
    drawer.el.classList.remove('open'); drawer.scrim.classList.remove('open'); drawer.el.setAttribute('aria-hidden', 'true');
    drawer.el.innerHTML = ''; drawer.dirty = false;
    if (drawer.opener && drawer.opener.focus) drawer.opener.focus();
    drawer.opener = null;
  }
  function addCorrRow() {
    var tbody = corrBody(); if (!tbody) return;
    var tr = document.createElement('tr');
    tr.dataset.kind = ''; tr.dataset.target = ''; tr.dataset.label = ''; tr.dataset.fin = ''; tr.dataset.old = '0'; tr.dataset.new = '1';
    tr.innerHTML = '<td><select class="tm-close-corr-target" aria-label="جهة التحميل">' + targetOptions() + '</select><div class="tm-note" data-role="code">—</div></td>'
      + '<td class="tnum">0.00%</td>'
      + '<td><label class="tm-note" style="display:inline-flex;gap:.3rem;align-items:center"><input type="number" class="tm-close-corr-pct" step="0.01" min="0" max="100" value="0.00" aria-label="المقترح"> %</label></td>'
      + '<td class="tnum" data-role="diff">0.00%</td>'
      + '<td><button type="button" class="btn btn-ghost btn-sm" data-action="close-corr-remove" aria-label="حذف السطر">✕</button></td>';
    tbody.appendChild(tr); drawer.dirty = true;
    var sel = tr.querySelector('select'); if (sel) sel.focus();
    recalcCorr();
  }
  function submitCorrection(btn) {
    var s = S(); var tbody = corrBody(); if (!tbody) return;
    var errBox = drawer.el.querySelector('[data-slot="err"]'); hideErr(errBox);
    var lines = validateLines(collectLines(tbody, 'tm-close-corr-pct'), errBox); if (!lines) return;
    var reasonEl = document.getElementById('tm-close-corr-reason'); var reason = reasonEl ? String(reasonEl.value || '').trim() : '';
    if (reason.length < 3) { showErr(errBox, 'اكتب سبب التصحيح — يُحفظ مع الطلب ويقرؤه المراجع المالي.'); if (reasonEl) reasonEl.focus(); return; }
    var evEl = document.getElementById('tm-close-corr-evidence'); var evidence = evEl ? String(evEl.value || '').trim() : '';
    var emp = drawer.emp;
    guard('correction', btn, async function () {
      await api('/team/close/' + enc(s.periodId) + '/resources/' + enc(emp) + '/correction', 'POST', {
        proposed: lines.map(function (l) { return { target_kind: l.target_kind, target_id: l.target_id, fin_code: l.fin_code || '', shareBp: l.shareBp }; }),
        reason: reason, evidenceLabel: evidence,
      });
      toast('أُرسل طلب التصحيح — بانتظار قرار المراجعة المالية ✓');
      closeDrawer(true); reload(); return true;
    }, function (err) { showErr(errBox, err.message); });
  }

  // ── S25: قرار المراجع المالي ────────────────────────────────────────────────
  var corrErrBox = function (id) {
    var card = document.querySelector('[data-corr="' + id + '"]'); if (!card) return null;
    var box = card.querySelector('.tm-danger');
    if (!box) { box = document.createElement('div'); box.className = 'tm-danger'; box.setAttribute('role', 'alert'); box.style.marginTop = '.5rem'; card.appendChild(box); }
    return box;
  };
  function decide(id, action, note, btn) {
    guard('decide:' + id, btn, async function () {
      var r = await api('/team/close/corrections/' + enc(id) + '/decide', 'POST', { action: action, note: note || '' });
      closeModal();
      toast(action === 'approve' ? 'اعتُمد التصحيح — الإصدار ' + ((r.period && r.period.version) || '') + ' ✓' : 'رُفض الطلب — وصل السبب إلى صاحبه');
      reload(); return true;
    }, function (err) { closeModal(); showErr(corrErrBox(id), err.message); toast(err.message, true); });
  }
  function openReject(id) {
    var html = '<div class="modal-head"><div style="font-weight:800;font-size:15px">رفض طلب التصحيح</div><button class="btn btn-ghost btn-sm" data-action="close-modal-close" aria-label="إغلاق">✕</button></div>'
      + '<div class="modal-body"><div class="field"><label for="tm-close-reject-note">سبب الرفض — يصل إلى صاحب الطلب</label>'
      + '<textarea id="tm-close-reject-note" rows="3" maxlength="500" placeholder="ماذا ينقص الطلب؟"></textarea></div></div>'
      + '<div class="modal-foot"><button class="btn" data-action="close-modal-close">إلغاء</button><button class="btn btn-primary" data-action="close-reject-go" data-id="' + esc(id) + '">رفض الطلب</button></div>';
    if (!modal(html)) { var why = window.prompt('سبب الرفض:'); if (why && why.trim().length >= 3) decide(id, 'reject', why.trim(), null); return; }
    var ta = document.getElementById('tm-close-reject-note'); if (ta) ta.focus();
  }

  // ── التفويض ─────────────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) {
      var row = e.target.closest ? e.target.closest('tr[data-href]') : null;
      if (row && !e.target.closest('a,button,input,select,label')) location.href = row.dataset.href;
      return;
    }
    var act = el.dataset.action;
    if (act === 'close-filter') return;
    if (act === 'close-regen') { e.preventDefault(); regenerate(el); return; }
    if (act === 'close-send') { e.preventDefault(); sendToFinance(el); return; }
    if (act === 'close-return') { e.preventDefault(); openReturn(); return; }
    if (act === 'close-return-go') { e.preventDefault(); var ta = document.getElementById('tm-close-return-reason'); doReturn(ta ? ta.value : '', el); return; }
    if (act === 'close-lock') { e.preventDefault(); if (!el.disabled) openLock(el.dataset.version || S().version); return; }
    if (act === 'close-lock-go') { e.preventDefault(); doLock(el.dataset.version, el); return; }
    if (act === 'close-reload') { e.preventDefault(); location.reload(); return; }
    if (act === 'close-modal-close') { e.preventDefault(); closeModal(); return; }
    if (act === 'close-line-add') { e.preventDefault(); addLineRow(); return; }
    if (act === 'close-line-remove') { e.preventDefault(); var tr = el.closest('tr'); if (tr) tr.remove(); recalcLines(); return; }
    if (act === 'close-confirm') { e.preventDefault(); confirmShares(el); return; }
    if (act === 'close-correct') { e.preventDefault(); openCorrection(el.dataset.emp, el); return; }
    if (act === 'close-drawer-close') { e.preventDefault(); closeDrawer(false); return; }
    if (act === 'close-corr-add') { e.preventDefault(); addCorrRow(); return; }
    if (act === 'close-corr-remove') {
      e.preventDefault();
      var r = el.closest('tr'); if (!r) return;
      // سطرٌ معتمد يُصفَّر لا يُحذف — كي يبقى الفرق ظاهراً (−x%) في المقارنة.
      if (Number(r.dataset.old || 0) > 0) { var inp = r.querySelector('.tm-close-corr-pct'); if (inp) inp.value = '0.00'; } else r.remove();
      drawer.dirty = true; recalcCorr(); return;
    }
    if (act === 'close-corr-submit') { e.preventDefault(); submitCorrection(el); return; }
    if (act === 'close-decide') {
      e.preventDefault();
      if (el.dataset.act === 'approve') {
        if (!window.confirm('اعتماد طلب التصحيح؟\nيُنشئ إصداراً جديداً مقفلاً ويبقى الإصدار السابق محفوظاً بلقطته.')) return;
        decide(el.dataset.id, 'approve', '', el);
      } else openReject(el.dataset.id);
      return;
    }
    if (act === 'close-reject-go') {
      e.preventDefault();
      var nt = document.getElementById('tm-close-reject-note'); var note = nt ? String(nt.value || '').trim() : '';
      if (note.length < 3) { toast('اكتب سبب الرفض — يصل إلى صاحب الطلب ليصحّح', true); if (nt) nt.focus(); return; }
      decide(el.dataset.id, 'reject', note, el);
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.classList) return;
    if (t.matches && t.matches('[data-action="close-filter"]') && t.form) { if (t.form.requestSubmit) t.form.requestSubmit(); else t.form.submit(); return; }
    if (t.classList.contains('tm-close-target')) { var tr = t.closest('tr'); if (tr) applyTarget(tr, t); recalcLines(); return; }
    if (t.classList.contains('tm-close-corr-target')) { var tr2 = t.closest('tr'); if (tr2) applyTarget(tr2, t); drawer.dirty = true; recalcCorr(); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.classList) return;
    if (t.classList.contains('tm-close-pct')) recalcLines();
    else if (t.classList.contains('tm-close-corr-pct')) { drawer.dirty = true; recalcCorr(); }
    else if (t.id === 'tm-close-corr-reason' || t.id === 'tm-close-corr-evidence') drawer.dirty = true;
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawer.el && drawer.el.classList.contains('open')) closeDrawer(false); });
  document.addEventListener('DOMContentLoaded', function () {
    if (drawerEls()) drawer.scrim.addEventListener('click', function () { closeDrawer(false); });
    var s = S();
    if (s.view === 'resource') recalcLines();
    // فتح الدرج بسياق الرابط: ?drawer=correction&employee=<id> (من S23 عندما يكون الشهر مقفلاً)
    if (s.view === 'overview' && s.drawer === 'correction' && s.employee) openCorrection(s.employee, null);
  });
})();
