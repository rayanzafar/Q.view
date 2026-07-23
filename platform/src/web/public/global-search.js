// لوحة الأوامر العالمية (Ctrl/Cmd+K) — محمّلة في كل صفحة (layout.js)، لا صفحة بعينها.
// بحث شامل عبر الفرص/المشاريع/العملاء/الفريق ضمن نطاق صلاحيات المستخدم نفسه (الخادم يطبّق
// نفس بوابات PAGE_ACCESS لكل فئة). العناوين تُدرَج بـ textContent حصراً — لا HTML من بيانات المستخدم.
(function () {
  'use strict';
  var scrim = document.getElementById('cmdk-scrim');
  var input = document.getElementById('cmdk-input');
  var list = document.getElementById('cmdk-list');
  if (!scrim || !input || !list) return;

  var CAT_LABEL = { opportunity: 'فرصة', project: 'مشروع', client: 'عميل', employee: 'موظف' };
  var results = [];
  var activeIdx = -1;
  var debounceTimer = null;
  var lastQuery = '';

  function isOpen() { return scrim.classList.contains('on'); }

  function open() {
    scrim.classList.add('on');
    input.value = '';
    input.focus();
    renderEmpty('اكتب اسم فرصة أو مشروع أو عميل أو موظف…');
  }
  function close() {
    scrim.classList.remove('on');
    results = []; activeIdx = -1; lastQuery = '';
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  }

  function renderEmpty(msg) {
    list.textContent = '';
    var d = document.createElement('div');
    d.className = 'cmdk-empty';
    d.textContent = msg;
    list.appendChild(d);
  }

  function renderResults() {
    list.textContent = '';
    if (!results.length) { renderEmpty('لا نتائج مطابقة'); return; }
    results.forEach(function (r, i) {
      var row = document.createElement('div');
      row.className = 'cmdk-row' + (i === activeIdx ? ' active' : '');
      row.setAttribute('role', 'button'); row.tabIndex = -1;

      var cat = document.createElement('span');
      cat.className = 'cat ' + r.category;
      cat.textContent = CAT_LABEL[r.category] || r.category;

      var tx = document.createElement('div');
      tx.className = 'tx';
      var t = document.createElement('div'); t.className = 't'; t.textContent = r.title;
      tx.appendChild(t);
      if (r.subtitle) { var s = document.createElement('div'); s.className = 's'; s.textContent = r.subtitle; tx.appendChild(s); }

      row.appendChild(cat); row.appendChild(tx);
      row.addEventListener('mouseenter', function () { setActive(i); });
      row.addEventListener('click', function () { go(i); });
      list.appendChild(row);
    });
  }

  function setActive(i) {
    activeIdx = i;
    var rows = list.querySelectorAll('.cmdk-row');
    rows.forEach(function (el, idx) { el.classList.toggle('active', idx === i); });
  }

  function go(i) {
    var r = results[i];
    if (r && r.href) location.href = r.href;
  }

  function search(q) {
    fetch('/api/search?q=' + encodeURIComponent(q), { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : { results: [] }; })
      .then(function (data) {
        if (input.value.trim() !== q) return; // استجابة متأخرة لطلب سابق — تُهمَل
        results = data.results || [];
        activeIdx = results.length ? 0 : -1;
        renderResults();
      })
      .catch(function () { /* صمت — لا يعطّل التنقل العادي بالصفحة */ });
  }

  input.addEventListener('input', function () {
    var q = input.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (q.length < 2) { renderEmpty(q.length ? 'أكمل حرفاً واحداً على الأقل' : 'اكتب اسم فرصة أو مشروع أو عميل أو موظف…'); return; }
    if (q === lastQuery) return;
    debounceTimer = setTimeout(function () { lastQuery = q; search(q); }, 180);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) setActive((activeIdx + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) setActive((activeIdx - 1 + results.length) % results.length); }
    else if (e.key === 'Enter') { e.preventDefault(); if (activeIdx >= 0) go(activeIdx); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });

  scrim.addEventListener('click', function (e) { if (e.target === scrim) close(); });

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-action="cmdk-open"]')) open();
  });

  document.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); isOpen() ? close() : open(); return; }
    if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close(); }
  });
})();
