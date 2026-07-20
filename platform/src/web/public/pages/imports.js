// مركز البيانات — منطق معالج الاستيراد (رفع → مطابقة الأعمدة → معاينة → تأكيد).
// تفويض data-action فقط، بلا onclick مضمّن. الرسائل العربية تصل من الخادم وتُعرض كما هي.
(function () {
  'use strict';
  window.Sanad = window.Sanad || {};
  if (!window.Sanad.toast) {
    window.Sanad.toast = function (msg, bad) {
      const d = document.createElement('div');
      d.textContent = msg;
      d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#dc2626' : '#059669');
      document.body.appendChild(d); setTimeout(function () { d.remove(); }, 3200);
    };
  }
  const esc = (s) => (window.Sanad.esc ? window.Sanad.esc(s) : String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const IO = (window.__SANAD && window.__SANAD.io) || { types: [], isAdmin: false };
  const S = { type: null, typeLabel: '', columns: [], run: null, mapping: {}, mode: 'upsert', preview: null };

  const jfetch = async (path, opts) => {
    const r = await fetch(path, Object.assign({ credentials: 'include' }, opts));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('تعذّر الطلب (' + r.status + ')'));
    return j;
  };
  const wz = () => document.getElementById('io-wizard');
  const body = () => document.getElementById('io-wz-body');
  const setStep = (n) => {
    document.querySelectorAll('#io-wizard .io-step').forEach((el) => {
      const k = Number(el.dataset.step);
      el.classList.toggle('on', k === n);
      el.classList.toggle('done', k < n);
    });
  };
  const ACTION_AR = { create: 'سيُضاف', update: 'سيُحدَّث', skip: 'سيُتجاهل', error: 'خطأ' };
  const ACTION_COLOR = { create: '#059669', update: '#244A99', skip: '#64748b', error: '#dc2626' };

  // ── الخطوة 1: رفع الملف ──
  function renderUpload() {
    setStep(1);
    body().innerHTML =
      '<div class="io-drop" data-action="io-pick">' +
        '<div style="font-size:26px;line-height:1">📄</div>' +
        '<div style="font-weight:800;font-size:13.5px;margin-top:.4rem">اسحب الملف هنا أو اضغط للاختيار</div>' +
        '<div style="font-size:11.5px;margin-top:.25rem">ملف Excel أو CSV — الصف الأول ترويسات الأعمدة (حتى 5000 صف)</div>' +
      '</div>' +
      '<input type="file" id="io-file" accept=".xlsx,.xls,.csv" style="display:none">' +
      '<div style="display:flex;align-items:center;gap:.6rem;margin-top:.8rem;font-size:11.5px;color:var(--muted)">' +
        'ليس لديك ملف جاهز؟ <a class="btn btn-sm" href="/api/io/export/' + esc(S.type) + '?format=xlsx&template=1">تنزيل القالب الفارغ</a>' +
      '</div>';
  }

  async function uploadFile(file) {
    if (!file) return;
    body().innerHTML = '<div style="text-align:center;color:var(--muted);padding:2rem 0;font-size:13px">جارٍ رفع الملف وقراءته…</div>';
    try {
      const buf = await file.arrayBuffer();
      const j = await jfetch('/api/io/import/' + S.type + '/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
        body: buf,
      });
      S.run = j; S.mapping = Object.assign({}, j.autoMapping); S.columns = j.columns;
      renderMapping();
    } catch (e) { window.Sanad.toast(e.message, true); renderUpload(); }
  }

  // ── الخطوة 2: مطابقة الأعمدة ──
  const sampleFor = (idx) => {
    if (idx == null || idx === '') return '';
    const vals = (S.run.sample || []).map((r) => r[idx]).filter((v) => v != null && String(v).trim() !== '').slice(0, 3);
    return vals.map((v) => esc(String(v))).join(' · ');
  };
  function renderMapping() {
    setStep(2);
    const headerOpts = (sel) => '<option value="">— غير مضمّن —</option>' + S.run.headers.map((h, i) =>
      '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + esc(h) + '</option>').join('');
    const rows = S.columns.map((c) =>
      '<tr><td style="white-space:nowrap;font-weight:700">' + esc(c.labelAr) + (c.required ? ' <span style="color:var(--red)">*</span>' : '') + '</td>' +
      '<td><select class="input" data-col="' + esc(c.key) + '" style="min-width:170px">' + headerOpts(S.mapping[c.key]) + '</select></td>' +
      '<td style="color:var(--muted);font-size:11.5px" data-sample-for="' + esc(c.key) + '">' + sampleFor(S.mapping[c.key]) + '</td></tr>').join('');
    const modeBtn = (m, label, hint) =>
      '<label style="display:flex;align-items:flex-start;gap:.45rem;border:1px solid var(--line);border-radius:10px;padding:.5rem .7rem;cursor:pointer;flex:1;min-width:150px">' +
      '<input type="radio" name="io-mode" value="' + m + '"' + (S.mode === m ? ' checked' : '') + ' style="margin-top:.2rem">' +
      '<span><b style="font-size:12.5px">' + label + '</b><br><span style="font-size:10.5px;color:var(--muted)">' + hint + '</span></span></label>';
    body().innerHTML =
      '<div style="font-size:12px;color:var(--muted);margin-bottom:.6rem">الملف: <b>' + esc(S.run.rowCount) + '</b> صف — طابق كل عمود لدينا مع عمود من ملفك. المطابقة التلقائية قابلة للتعديل.</div>' +
      '<div class="tblwrap"><table class="io-map-table" style="width:100%;border-collapse:collapse">' +
      '<thead><tr><th>العمود لدينا</th><th>العمود في ملفك</th><th>عيّنة من القيم</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem">' +
        modeBtn('add', 'إضافة الجديد فقط', 'الموجود مسبقاً يُتجاهل') +
        modeBtn('upsert', 'إضافة وتحديث', 'الجديد يُضاف والموجود يُحدَّث') +
        (IO.isAdmin ? modeBtn('replace', 'استبدال كامل', 'لمدير النظام — مع نسخة تلقائية قبل التنفيذ') : '') +
      '</div>' +
      '<div style="display:flex;gap:.6rem;margin-top:1rem">' +
        '<button class="btn btn-primary" data-action="io-to-preview">معاينة قبل التنفيذ</button>' +
        '<button class="btn" data-action="io-restart">ملف آخر</button>' +
      '</div>';
  }

  // ── الخطوة 3: المعاينة ──
  async function doPreview() {
    body().innerHTML = '<div style="text-align:center;color:var(--muted);padding:2rem 0;font-size:13px">جارٍ فحص الصفوف وإعداد المعاينة…</div>';
    try {
      const j = await jfetch('/api/io/import/' + S.type + '/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: S.run.runId, mapping: S.mapping, mode: S.mode }),
      });
      S.preview = j;
      renderPreview();
    } catch (e) { window.Sanad.toast(e.message, true); renderMapping(); }
  }
  function renderPreview() {
    setStep(3);
    const c = S.preview.counts;
    const stat = (v, l, color) => '<div class="io-stat"><div class="v tnum" style="color:' + color + '">' + v + '</div><div class="l">' + l + '</div></div>';
    const rows = S.preview.rows.map((r) =>
      '<tr data-io-row-action="' + r.action + '" style="border-bottom:1px dashed var(--line)">' +
      '<td style="padding:.35rem .6rem;font-size:11.5px;color:var(--muted)" class="tnum">' + r.row + '</td>' +
      '<td style="padding:.35rem .6rem"><span class="pill" style="background:' + ACTION_COLOR[r.action] + '1a;color:' + ACTION_COLOR[r.action] + '">' + ACTION_AR[r.action] + '</span></td>' +
      '<td style="padding:.35rem .6rem;font-size:12.5px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.label || '') + '</td>' +
      '<td style="padding:.35rem .6rem;font-size:11.5px;color:' + (r.action === 'error' ? 'var(--red)' : 'var(--muted)') + '">' + esc(r.detail || '') + '</td></tr>').join('');
    const nothing = (c.create + c.update) === 0;
    body().innerHTML =
      '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:.9rem">' +
        stat(c.create, 'سيُضاف', '#059669') + stat(c.update, 'سيُحدَّث', '#244A99') +
        stat(c.skip, 'سيُتجاهل', '#64748b') + stat(c.error, 'به أخطاء', '#dc2626') +
      '</div>' +
      (c.error ? '<div class="alert warn" style="margin-bottom:.7rem">الصفوف المتعثرة لن تُستورد — يمكنك المتابعة بدونها أو تصحيح الملف وإعادة الرفع.</div>' : '') +
      '<label style="display:flex;align-items:center;gap:.4rem;font-size:12px;color:var(--muted);margin-bottom:.4rem">' +
        '<input type="checkbox" id="io-errors-only"' + (c.error ? '' : ' disabled') + '> فقط الصفوف المتعثرة</label>' +
      '<div class="tblwrap" style="max-height:320px;overflow-y:auto;border:1px solid var(--line);border-radius:10px">' +
        '<table id="io-preview-table" style="width:100%;border-collapse:collapse"><thead><tr style="font-size:10.5px;color:var(--muted);text-align:right">' +
        '<th style="padding:.4rem .6rem">الصف</th><th style="padding:.4rem .6rem">الإجراء</th><th style="padding:.4rem .6rem">السجل</th><th style="padding:.4rem .6rem">التفاصيل</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div>' +
      (S.preview.rows.length < c.total ? '<div style="font-size:11px;color:var(--faint);margin-top:.35rem">المعاينة تعرض أول ' + S.preview.rows.length + ' صف — التنفيذ يشمل الملف كاملاً.</div>' : '') +
      '<div style="display:flex;gap:.6rem;margin-top:1rem;align-items:center">' +
        '<button class="btn btn-primary" data-action="io-apply"' + (nothing ? ' disabled' : '') + '>تأكيد الاستيراد</button>' +
        '<button class="btn" data-action="io-back-map">رجوع للمطابقة</button>' +
        (nothing ? '<span style="font-size:11.5px;color:var(--muted)">لا يوجد جديد أو تغيير — الملف مطابق للبيانات الحالية.</span>' : '') +
      '</div>';
  }

  // ── الخطوة 4: التنفيذ ──
  async function doApply() {
    body().innerHTML = '<div style="text-align:center;color:var(--muted);padding:2rem 0;font-size:13px">جارٍ تنفيذ الاستيراد…</div>';
    try {
      const j = await jfetch('/api/io/import/' + S.type + '/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: S.run.runId, confirmToken: S.preview.confirmToken }),
      });
      setStep(4);
      body().innerHTML =
        '<div style="text-align:center;padding:1.2rem 0">' +
          '<div style="width:52px;height:52px;border-radius:50%;background:#dcfce7;color:#059669;display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 auto .6rem">✓</div>' +
          '<div style="font-weight:800;font-size:15px">اكتمل الاستيراد</div>' +
          '<div style="font-size:12.5px;color:var(--muted);margin-top:.4rem">' +
            'أُضيف <b class="tnum">' + j.created + '</b> · حُدّث <b class="tnum">' + j.updated + '</b> · تُجوهل <b class="tnum">' + j.skipped + '</b>' +
            (j.errors ? ' · <span style="color:var(--red)">أخطاء <b class="tnum">' + j.errors + '</b></span>' : '') +
          '</div>' +
          '<div style="font-size:11.5px;color:var(--muted);margin-top:.5rem">يمكنك «تراجع عن العملية» من سجل العمليات خلال 7 أيام.</div>' +
          '<button class="btn btn-primary" style="margin-top:1rem" data-action="io-done">إغلاق وتحديث الصفحة</button>' +
        '</div>';
      window.Sanad.toast('اكتمل الاستيراد بنجاح');
    } catch (e) { window.Sanad.toast(e.message, true); renderPreview(); }
  }

  // ── التراجع من سجل العمليات ──
  async function doUndo(runId, btn) {
    if (!window.confirm('سيُعاد كل ما غيّرته هذه العملية إلى حالته السابقة. هل تريد المتابعة؟')) return;
    btn.disabled = true;
    try {
      const j = await jfetch('/api/io/runs/' + runId + '/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      window.Sanad.toast('تم التراجع — أُعيد ' + j.restored + ' سجلاً');
      setTimeout(function () { location.reload(); }, 900);
    } catch (e) { window.Sanad.toast(e.message, true); btn.disabled = false; }
  }

  function openWizard(type) {
    const t = IO.types.find((x) => x.type === type);
    if (!t) return;
    S.type = type; S.typeLabel = t.labelAr; S.columns = t.columns; S.run = null; S.preview = null; S.mode = 'upsert';
    document.getElementById('io-wz-type').textContent = t.labelAr;
    wz().style.display = '';
    renderUpload();
    wz().scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── تفويض الأحداث ──
  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'io-start': return openWizard(el.dataset.type);
      case 'io-close': wz().style.display = 'none'; return;
      case 'io-pick': return document.getElementById('io-file').click();
      case 'io-restart': return renderUpload();
      case 'io-to-preview': return void doPreview();
      case 'io-back-map': return renderMapping();
      case 'io-apply': return void doApply();
      case 'io-done': return location.reload();
      case 'io-undo': return void doUndo(el.dataset.run, el);
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'io-file') return void uploadFile(e.target.files[0]);
    if (e.target.matches('select[data-col]')) {
      const key = e.target.dataset.col;
      if (e.target.value === '') delete S.mapping[key]; else S.mapping[key] = Number(e.target.value);
      const cell = document.querySelector('[data-sample-for="' + key + '"]');
      if (cell) cell.innerHTML = sampleFor(S.mapping[key]);
      return;
    }
    if (e.target.name === 'io-mode') { S.mode = e.target.value; return; }
    if (e.target.id === 'io-errors-only') {
      const only = e.target.checked;
      document.querySelectorAll('#io-preview-table tbody tr').forEach(function (tr) {
        tr.style.display = (!only || tr.dataset.ioRowAction === 'error') ? '' : 'none';
      });
    }
  });
  // سحب وإفلات على منطقة الرفع
  document.addEventListener('dragover', function (e) {
    const drop = e.target.closest && e.target.closest('.io-drop');
    if (drop) { e.preventDefault(); drop.classList.add('drag'); }
  });
  document.addEventListener('dragleave', function (e) {
    const drop = e.target.closest && e.target.closest('.io-drop');
    if (drop) drop.classList.remove('drag');
  });
  document.addEventListener('drop', function (e) {
    const drop = e.target.closest && e.target.closest('.io-drop');
    if (!drop) return;
    e.preventDefault(); drop.classList.remove('drag');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) uploadFile(f);
  });
})();
