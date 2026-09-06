// عميل مساحة عمل التسكين (v5.26) — درج الخلية، درج الموظف (خط زمني قابل للتحرير + حفظ
// دفعة واحدة)، وضع تحديد متعدد بشريط إجراءات ومعاينة قبل التطبيق الذرّي، نافذة «تسكين جديد»
// بأقسام متتابعة، وفلاتر عميلة (حالة/جهة/بحث) تنعكس في الرابط وتُقرأ منه.
// تفويض data-action فقط — لا onclick مضمّن، ولا استدعاء لنافذة app.js القديمة (empAssign):
// هذه الصفحة هجرتها بالكامل. كل البيانات من window.__SANAD (مقصوصة بصلاحية القارئ في الخادم).
(function () {
  'use strict';

  // ── حالة الخادم والأدوات ─────────────────────────────────────────────────────
  const S = () => window.__SANAD || {};
  const M = () => S().monthNames || [];
  const EN = () => window.__SANAD_MONTHS_EN || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LIM = () => S().limits || { FREE_BELOW: 70, NEAR_FROM: 101, OVER_ABOVE: 110, MAX_PCT: 150 };
  const YR = () => S().staffYear;
  const CM = () => Number(S().currentMonth) || 0;
  const canEdit = () => !!(S().canManage || S().canStaff);
  const emp = (id) => (S().emps || {})[id];
  const mName = (m) => M()[m - 1] || '';
  const esc = (s) => (window.Sanad ? window.Sanad.esc(s) : String(s == null ? '' : s));

  const api = async (path, method, body) => {
    const r = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('خطأ ' + r.status));
    return j;
  };
  const toast = (msg, bad) => {
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:200;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);background:' + (bad ? '#dc2626' : '#059669');
    document.body.appendChild(d); setTimeout(() => d.remove(), 2800);
  };
  const clampPct = (v) => {
    v = Math.round(Number(v));
    if (!Number.isFinite(v) || v < 0) v = 0;
    return Math.min(v, LIM().MAX_PCT);
  };

  // اتفاق العدد والمعدود — مرآة countAr الخادمية للكلمات المستعملة هنا
  const bnWord = (n) => n === 1 ? 'بند واحد' : n === 2 ? 'بندان' : n >= 3 && n <= 10 ? n + ' بنود' : n + ' بنداً';
  const cellWord = (n) => n === 1 ? 'خلية واحدة محددة' : n === 2 ? 'خليتان محددتان' : n >= 3 && n <= 10 ? n + ' خلايا محددة' : n + ' خلية محددة';
  const empWord = (n) => n === 1 ? 'موظف واحد' : n === 2 ? 'موظفان' : n >= 3 && n <= 10 ? n + ' موظفين' : n + ' موظفاً';
  const mWord = (n) => n === 1 ? 'شهر واحد' : n === 2 ? 'شهران' : n >= 3 && n <= 10 ? n + ' أشهر' : n + ' شهراً';

  // ── نموذج البيانات المشترك ───────────────────────────────────────────────────
  const oppSum = (e) => (e.opps || []).reduce((a, o) => a + (Number(o.pct) || 0), 0);
  const cellItems = (e, m) => (e.targets || []).filter((t) => (Number((t.months || {})[m]) || 0) > 0);
  const cellTotal = (id, m) => {
    const e = emp(id); if (!e) return 0;
    let v = 0;
    for (const t of e.targets || []) v += Number((t.months || {})[m]) || 0;
    if (m === CM()) v += oppSum(e);
    return Math.round(v);
  };
  const toneCls = (v) => v <= 0 ? 't-zero' : v < LIM().NEAR_FROM ? 't-ok' : v <= LIM().OVER_ABOVE ? 't-near' : 't-over';
  const isBucketKey = (key) => String(key || '').charAt(0) === 'b';
  const targetIdOf = (key) => String(key || '').slice(2);
  const projOf = (pid) => (S().teamProjects || []).find((p) => p.id === pid) || null;
  const findAlloc = (empId, key) => {
    const e = emp(empId); if (!e || !key) return null;
    const id = targetIdOf(key);
    return (e.targets || []).find((t) => isBucketKey(key) ? t.bucket === id : t.projectId === id) || null;
  };
  const targetLabel = (key) => {
    if (!key) return '';
    const id = targetIdOf(key);
    if (isBucketKey(key)) {
      const b = (S().workBuckets || []).find((x) => x.key === id);
      return b ? b.label : 'عمل داخلي';
    }
    const p = projOf(id);
    return p ? p.name_ar : 'مشروع';
  };
  const monthOpts = (selM) => M().map((mn, i) =>
    '<option value="' + (i + 1) + '"' + (i + 1 === selM ? ' selected' : '') + '>' + esc(mn) + '</option>').join('');

  // ── إعادة رسم خلية من الحالة (بعد حفظ متفائل) — نفس بنية الخادم حرفياً ──────────
  const cellHtml = (v, n, gap) => gap ? '<span class="g">— غير مسكن</span>'
    : v === 0 ? '<span class="z">—</span>'
      : '<span class="tnum">' + v + '%</span>' + (n >= 2 ? '<span class="n">· ' + bnWord(n) + '</span>' : '');
  const cellAria = (e, m, v, n, gap) => {
    const base = e.name_ar + ' — ' + mName(m) + ' ' + YR() + ': ';
    if (gap) return base + 'شهر ماضٍ بلا أي تسكين';
    if (!v) return base + 'بلا تسكين';
    return base + v + '%' + (n ? ' · ' + bnWord(n) : '');
  };
  function repaintCell(empId, m) {
    const e = emp(empId); if (!e) return;
    const v = cellTotal(empId, m);
    const n = cellItems(e, m).length;
    if (Array.isArray(e.months)) e.months[m - 1] = v;
    if (Array.isArray(e.counts)) e.counts[m - 1] = n;
    const btn = document.querySelector('#mx .mx-cell[data-emp="' + empId + '"][data-m="' + m + '"]');
    if (!btn) return;
    const gap = v === 0 && (e.gaps || []).indexOf(m) !== -1;
    btn.className = 'mx-cell ' + (gap ? 't-gap' : toneCls(v)) + (sel.keys.has(empId + ':' + m) ? ' sel' : '');
    btn.dataset.v = String(v); btn.dataset.n = String(n);
    btn.innerHTML = cellHtml(v, n, gap);
    btn.setAttribute('aria-label', cellAria(e, m, v, n, gap));
  }

  // ── الفلاتر العميلة (حالة/جهة/بحث) بمرآة في الرابط ─────────────────────────────
  const flt = { status: 'all', target: '', q: '' };
  function reflectURL() {
    const p = new URLSearchParams(location.search);
    if (flt.q.trim()) p.set('q', flt.q.trim()); else p.delete('q');
    if (flt.status !== 'all') p.set('status', flt.status); else p.delete('status');
    if (flt.target) p.set('target', flt.target); else p.delete('target');
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }
  function applyFilters() {
    const body = document.getElementById('mx-body'); if (!body) { reflectURL(); return; }
    const rows = body.querySelectorAll('tr[data-emp]');
    const q = flt.q.trim().toLowerCase();
    let vis = 0;
    rows.forEach((r) => {
      const okS = flt.status === 'all' ? true
        : flt.status === 'gap' ? r.dataset.gap === '1'
          : r.dataset.status === flt.status;
      const okT = !flt.target || (' ' + (r.dataset.targets || '') + ' ').indexOf(' ' + flt.target + ' ') !== -1;
      const okQ = !q || (r.dataset.hay || '').indexOf(q) !== -1;
      const show = okS && okT && okQ;
      r.hidden = !show;
      if (show) vis++;
    });
    const none = document.getElementById('mx-none');
    if (none) none.hidden = vis !== 0;
    reflectURL();
  }
  function navParam(name, val) {
    const p = new URLSearchParams(location.search);
    if (val) p.set(name, val); else p.delete(name);
    const qs = p.toString();
    location.href = location.pathname + (qs ? '?' + qs : '');
  }
  function initFilters() {
    if (!document.getElementById('mx')) return;
    const p = new URLSearchParams(location.search);
    const st = p.get('status') || 'all';
    if (['all', 'unset', 'bench', 'avail', 'ok', 'over', 'gap'].indexOf(st) !== -1) flt.status = st;
    flt.target = p.get('target') || '';
    flt.q = p.get('q') || '';
    const q = document.getElementById('staff-q');
    if (q && flt.q) q.value = flt.q;
    const t = document.getElementById('mx-target');
    if (t) { t.value = flt.target; if (t.value !== flt.target) flt.target = ''; }
    const seg = document.getElementById('mx-status');
    if (seg) seg.querySelectorAll('button[data-status]').forEach((b) => b.classList.toggle('on', b.dataset.status === flt.status));
    applyFilters();
  }
  const setSeg = (btn) => {
    const box = btn.closest('.seg'); if (!box) return;
    box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
  };

  // ── منتقيا الجهة ─────────────────────────────────────────────────────────────
  // لموظف بعينه: البنود الثلاثة أولاً (المسجَّل منها لسنته معطَّل — عدّله من صفّه)، ثم مشاريع
  // بقطاع الموظف أو بلا قطاع (مرآة حاجز القطاعات في الخادم — وهو يبقى الحكم).
  function empTargetOptions(e) {
    const bs = (S().workBuckets || []).map((b) => {
      const has = (e.targets || []).some((t) => t.bucket === b.key);
      return '<option value="b:' + esc(b.key) + '"' + (has ? ' disabled' : '') + '>' + esc(b.label) + (has ? ' — مسجَّل بالفعل' : '') + '</option>';
    }).join('');
    const ps = (S().teamProjects || []).filter((p) => !e.sector_id || !p.sector_id || p.sector_id === e.sector_id)
      .map((p) => '<option value="p:' + esc(p.id) + '">' + esc(p.name_ar) + '</option>').join('');
    if (!bs && !ps) return '';
    return '<option value="">اختر الجهة…</option>' +
      (bs ? '<optgroup label="عمل داخلي">' + bs + '</optgroup>' : '') +
      (ps ? '<optgroup label="مشروع">' + ps + '</optgroup>' : '');
  }
  // لمجموعة موظفين (شريط التحديد و«تسكين جديد»): القائمة كاملة، والترشيح لكل موظف عند البناء.
  function allTargetOptions() {
    const bs = (S().workBuckets || []).map((b) => '<option value="b:' + esc(b.key) + '">' + esc(b.label) + '</option>').join('');
    const ps = (S().teamProjects || []).map((p) => '<option value="p:' + esc(p.id) + '">' + esc(p.name_ar) + '</option>').join('');
    return '<option value="">اختر الجهة…</option>' +
      '<optgroup label="عمل داخلي">' + bs + '</optgroup>' +
      (ps ? '<optgroup label="مشروع">' + ps + '</optgroup>' : '');
  }

  // ── درج الخلية: بنود الشهر + إضافة بند + تحذير تجاوز حي (لا منع) ────────────────
  let cd = null; // { empId, m, mode:'one'|'multi', picks:Set }
  const cdMonths = () => cd.mode === 'one' ? [cd.m] : [...cd.picks].sort((a, b) => a - b);
  const totColor = (t) => t > LIM().OVER_ABOVE ? 'var(--red)' : 'var(--ink2)';

  function cdAddHtml(e, m) {
    const opts = empTargetOptions(e);
    if (!opts) return '';
    const chips = M().map((mn, i) =>
      '<button type="button" class="mchip' + (i + 1 === m ? ' on' : '') + '" data-cd-m="' + (i + 1) + '">' + esc(mn) + '</button>').join('');
    return '<div style="border-top:1px dashed var(--line);margin-top:.7rem;padding-top:.6rem">' +
      '<div style="font-size:10.5px;font-weight:800;color:var(--muted);margin-bottom:.35rem">إضافة بند</div>' +
      '<div style="display:flex;gap:.35rem;align-items:center;flex-wrap:wrap">' +
      '<select class="input" id="cd-target" style="flex:1;min-width:150px;font-size:12px;padding:.35rem .4rem" aria-label="جهة التسكين">' + opts + '</select>' +
      '<input type="number" class="input tnum" id="cd-pct" value="50" min="0" max="' + LIM().MAX_PCT + '" step="5" aria-label="النسبة" style="width:66px;padding:.3rem .45rem;font-size:12.5px;direction:ltr;text-align:center">' +
      '</div>' +
      '<div class="seg" style="margin-top:.45rem"><button type="button" data-cd-mode="one" class="on">هذا الشهر فقط</button><button type="button" data-cd-mode="multi">عدة أشهر</button></div>' +
      '<div id="cd-months" class="mgrid" style="margin-top:.45rem" hidden>' + chips + '</div>' +
      '<div style="margin-top:.5rem"><button type="button" class="btn btn-primary btn-sm" data-action="cd-add">إضافة</button></div>' +
      '</div>';
  }
  function cdHtml() {
    const e = emp(cd.empId), m = cd.m;
    const total = cellTotal(cd.empId, m);
    const gap = total === 0 && (e.gaps || []).indexOf(m) !== -1;
    const rows = (e.targets || []).map((t) => {
      const v = Number((t.months || {})[m]) || 0;
      const tag = t.bucket ? ' <span class="pill" style="background:#e0f2fe;color:#0369a1">داخلي</span>' : '';
      const ctl = canEdit()
        ? '<input type="number" class="input tnum" data-cd-pct data-alloc="' + esc(t.allocId) + '" value="' + v + '" min="0" max="' + LIM().MAX_PCT + '" step="5" aria-label="نسبة ' + esc(t.name) + ' في ' + esc(mName(m)) + '" style="width:74px;padding:.3rem .45rem;font-size:12.5px;direction:ltr;text-align:center">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="cd-remove" data-alloc="' + esc(t.allocId) + '" data-name="' + esc(t.name) + '" title="إزالة البند بكامل أشهره" aria-label="إزالة ' + esc(t.name) + '">✕</button>'
        : '<b class="tnum" style="font-size:12.5px">' + v + '%</b>';
      return '<div class="cd-row"><span class="nm">' + esc(t.name) + tag + '</span>' + ctl + '</div>';
    }).join('');
    const opps = m === CM() ? (e.opps || []).map((o) =>
      '<div class="cd-row" style="color:var(--muted)"><span class="nm">' + esc(o.name) + ' <span class="pill" style="background:#ede9fe;color:#7c3aed">فرصة</span></span><b class="tnum" style="font-size:12px">' + (Number(o.pct) || 0) + '%</b></div>').join('') : '';
    const empty = !(e.targets || []).length && !opps;
    return '<div class="drawer-head">' +
      '<div style="flex:1;min-width:0">' +
      '<div style="font-weight:800;font-size:15px">' + esc(e.name_ar) + ' — ' + esc(mName(m)) + ' ' + YR() + '</div>' +
      '<div style="font-size:11.5px;color:var(--muted)">إجمالي الشهر <b class="tnum" id="cd-total" style="color:' + totColor(total) + '">' + total + '%</b></div>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="dw-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="drawer-body">' +
      (gap ? '<div style="font-size:11px;color:#a16207;background:#fffdf4;border:1px dashed #eab308;border-radius:8px;padding:.35rem .6rem;margin-bottom:.6rem">شهر ماضٍ بلا أي تسكين — يبقى فجوة تاريخية حتى يُسكَّن.</div>' : '') +
      (empty
        ? '<div style="color:var(--muted);font-size:12.5px;padding:.3rem 0">لا بنود لهذا الموظف في سنة ' + YR() + (canEdit() ? ' — أضِف بنداً من الأسفل.' : '.') + '</div>'
        : rows + opps) +
      (canEdit() && !empty ? '<div style="font-size:10px;color:var(--faint);padding-top:.35rem">اكتب النسبة ثم اخرج من الحقل — تُحفظ فوراً.</div>' : '') +
      '<div id="cd-warn" style="margin-top:.5rem"></div>' +
      (canEdit() ? cdAddHtml(e, m) : '') +
      '</div>' +
      '<div class="drawer-foot"><button type="button" class="btn" data-action="dw-close">إغلاق</button></div>';
  }
  function openCellDrawer(empId, m) {
    const e = emp(empId); if (!e || !m) return;
    cd = { empId: empId, m: m, mode: 'one', picks: new Set([m]) };
    ed = null;
    window.Sanad.openDrawer(cdHtml());
    const first = document.querySelector('#drawer [data-cd-pct]');
    if (first) { first.focus(); first.select(); }
  }
  function updateCdTotal() {
    if (!cd) return;
    const el = document.getElementById('cd-total'); if (!el) return;
    const t = cellTotal(cd.empId, cd.m);
    el.textContent = t + '%';
    el.style.color = totColor(t);
  }
  // تحذير حي: يجمع فرق حقول الصفوف على شهر الدرج + أثر قسم الإضافة على أشهره المعلَّمة
  function cdWarn() {
    if (!cd) return;
    const box = document.getElementById('cd-warn'); if (!box) return;
    const e = emp(cd.empId); if (!e) return;
    const L = LIM();
    const proj = {};
    let delta = 0;
    document.querySelectorAll('#drawer [data-cd-pct]').forEach((inp) => {
      const t = (e.targets || []).find((x) => x.allocId === inp.dataset.alloc); if (!t) return;
      delta += clampPct(inp.value) - (Number((t.months || {})[cd.m]) || 0);
    });
    if (delta) proj[cd.m] = cellTotal(cd.empId, cd.m) + delta;
    const selT = document.getElementById('cd-target');
    const pctEl = document.getElementById('cd-pct');
    if (selT && selT.value && pctEl) {
      const v = clampPct(pctEl.value);
      const ex = findAlloc(cd.empId, selT.value);
      cdMonths().forEach((m) => {
        const base = proj[m] != null ? proj[m] : cellTotal(cd.empId, m);
        const old = ex ? (Number((ex.months || {})[m]) || 0) : 0;
        proj[m] = base - old + v;
      });
    }
    const warns = [];
    let worst = 0;
    Object.keys(proj).map(Number).sort((a, b) => a - b).forEach((m) => {
      if (proj[m] > L.OVER_ABOVE) {
        warns.push('سيصبح إجمالي ' + mName(m) + ' ' + proj[m] + '% — فوق حد ' + L.OVER_ABOVE + '%');
        worst = Math.max(worst, proj[m]);
      }
    });
    box.innerHTML = warns.length
      ? '<div class="alert ' + (worst > L.MAX_PCT ? 'err' : 'warn') + '" style="font-size:11.5px">' + warns.map(esc).join('<br>') + '</div>'
      : '';
  }
  // حفظ خلية واحدة عند الخروج من الحقل: تحديث متفائل، وإرجاع عند رفض الخادم
  async function cdSaveRow(inp) {
    if (!cd) return;
    const e = emp(cd.empId); if (!e) return;
    const t = (e.targets || []).find((x) => x.allocId === inp.dataset.alloc); if (!t) return;
    const m = cd.m;
    const prev = Number((t.months || {})[m]) || 0;
    const v = clampPct(inp.value);
    inp.value = v;
    if (v === prev) { cdWarn(); return; }
    t.months = t.months || {};
    if (v > 0) t.months[m] = v; else delete t.months[m];
    repaintCell(cd.empId, m);
    updateCdTotal();
    inp.disabled = true;
    try {
      await api('/projects/staff/' + encodeURIComponent(t.allocId), 'PATCH', { month: m, pct: v });
      toast('حُفظ تسكين ' + mName(m) + ' ✓');
    } catch (err) {
      if (prev > 0) t.months[m] = prev; else delete t.months[m];
      repaintCell(cd.empId, m);
      updateCdTotal();
      inp.value = prev;
      toast(err.message, true);
    } finally { inp.disabled = false; cdWarn(); }
  }
  async function cdRemove(btn) {
    if (!cd) return;
    const e = emp(cd.empId);
    const name = btn.dataset.name || 'البند';
    if (!window.confirm('إزالة «' + name + '» من تسكين ' + ((e && e.name_ar) || 'الموظف') + ' عن كل أشهر ' + YR() + '؟ لا يمكن التراجع.')) return;
    btn.disabled = true;
    try {
      await api('/projects/staff/' + encodeURIComponent(btn.dataset.alloc), 'DELETE');
      toast('أُزيل البند ✓');
      setTimeout(() => location.reload(), 450);
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  }
  // إضافة بند من الدرج: جهة قائمة ⟵ تعديل خريطة أشهرها؛ جهة جديدة ⟵ إسناد بالأشهر المعلَّمة
  async function cdAdd(btn) {
    if (!cd) return;
    const selT = document.getElementById('cd-target');
    const pctEl = document.getElementById('cd-pct');
    if (!selT || !selT.value) { toast('اختر الجهة أولاً', true); return; }
    const v = clampPct(pctEl ? pctEl.value : 0);
    if (v <= 0) { toast('أدخل نسبة أكبر من صفر', true); return; }
    const list = cdMonths();
    if (!list.length) { toast('علّم شهراً واحداً على الأقل', true); return; }
    const months = {};
    list.forEach((m) => { months[m] = v; });
    const key = selT.value;
    const ex = findAlloc(cd.empId, key);
    btn.disabled = true;
    try {
      if (ex) {
        await api('/projects/staff/' + encodeURIComponent(ex.allocId), 'PATCH', { months: months });
        toast('حُدّثت أشهر «' + targetLabel(key) + '» ✓');
      } else if (isBucketKey(key)) {
        await api('/staffing/internal', 'POST', { employeeId: cd.empId, bucket: targetIdOf(key), months: months, year: YR() });
        toast('أُضيف البند ✓');
      } else {
        await api('/projects/' + encodeURIComponent(targetIdOf(key)) + '/staff', 'POST', { employeeId: cd.empId, months: months, year: YR() });
        toast('أُضيف البند ✓');
      }
      setTimeout(() => location.reload(), 450);
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  }

  // ── درج الموظف: خط زمني (بند × 12 شهراً) يُحرَّر كاملاً ويُحفظ دفعة واحدة ─────────
  let ed = null; // { empId, vals:{allocId:{m:v}}, orig:{...}, pending:[{key,kind,targetId,label,vals}] }
  function openEmpDrawer(empId) {
    const e = emp(empId); if (!e) return;
    ed = { empId: empId, vals: {}, orig: {}, pending: [] };
    cd = null;
    (e.targets || []).forEach((t) => {
      const a = {}, o = {};
      for (let m = 1; m <= 12; m++) { const v = Number((t.months || {})[m]) || 0; a[m] = v; o[m] = v; }
      ed.vals[t.allocId] = a; ed.orig[t.allocId] = o;
    });
    edRender();
  }
  function edRender() {
    if (!ed) return;
    const e = emp(ed.empId); if (!e) return;
    const editable = canEdit();
    const L = LIM();
    const metaBits = [e.job_title || '—', (S().sectorNames || {})[e.sector_id] || 'خارج القطاعات'];
    if (e.hire_date) metaBits.push('التعيين ' + e.hire_date);
    if (e.end_date) metaBits.push('المغادرة ' + e.end_date);
    if (e.capacity_pct != null && Number(e.capacity_pct) > 0) metaBits.push('الطاقة ' + Number(e.capacity_pct) + '%');
    const strip = '<div class="ustrip">' + (e.months || []).map((raw, i) => {
      const v = Math.round(Number(raw) || 0);
      const bg = v <= 0 ? '#eef1f7' : v < L.NEAR_FROM ? '#86efac' : v <= L.OVER_ABOVE ? '#fcd34d' : '#f87171';
      return '<span title="' + esc(mName(i + 1) + ': ' + v + '%') + '" style="background:' + bg + '"></span>';
    }).join('') + '</div>';
    const oppLine = (e.opps || []).length
      ? '<div style="font-size:11px;color:var(--muted);margin:.1rem 0 .6rem">' +
      (e.opps || []).map((o) => esc(o.name) + ' <span class="pill" style="background:#ede9fe;color:#7c3aed">فرصة</span> <b class="tnum">' + (Number(o.pct) || 0) + '%</b>').join(' · ') +
      ' — حمل مبدئي يُحتسب على الشهر الحالي فقط</div>' : '';
    const mh = '<div class="ed-mh" aria-hidden="true">' + EN().map((x) => '<span>' + x + '</span>').join('') + '</div>';
    const rowFor = (t) => {
      const vals = ed.vals[t.allocId] || {};
      const tag = t.bucket ? ' <span class="pill" style="background:#e0f2fe;color:#0369a1">داخلي</span>' : '';
      const cells = [];
      for (let m = 1; m <= 12; m++) {
        cells.push(editable
          ? '<input type="number" min="0" max="' + L.MAX_PCT + '" step="5" inputmode="numeric" data-ed-cell data-alloc="' + esc(t.allocId) + '" data-m="' + m + '" value="' + (Number(vals[m]) || 0) + '" aria-label="' + esc(t.name + ' — ' + mName(m)) + '">'
          : '<span class="ro">' + (Number(vals[m]) || 0) + '</span>');
      }
      return '<div style="margin-bottom:.6rem">' +
        '<div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.25rem">' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:700">' + esc(t.name) + tag + '</span>' +
        (editable ? '<button type="button" class="btn btn-ghost btn-sm" data-action="ed-copy" data-alloc="' + esc(t.allocId) + '" title="انسخ قيمة شهر إلى الأشهر التي تليه">نسخ ←</button>' : '') +
        '</div>' +
        (editable ? '<div data-cp="' + esc(t.allocId) + '" hidden><div style="display:flex;gap:.35rem;align-items:center;font-size:11px;color:var(--muted);margin:.1rem 0 .35rem;flex-wrap:wrap">' +
          'من <select class="input" data-cp-from style="padding:.2rem .3rem;font-size:11px">' + monthOpts(CM() || 1) + '</select>' +
          'إلى <select class="input" data-cp-to style="padding:.2rem .3rem;font-size:11px">' + monthOpts(12) + '</select>' +
          '<button type="button" class="btn btn-sm" data-action="ed-copy-apply" data-alloc="' + esc(t.allocId) + '">طبّق</button>' +
          '</div></div>' : '') +
        '<div class="ed-months">' + cells.join('') + '</div>' +
        '</div>';
    };
    const pendRow = (p, i) => {
      const cells = [];
      for (let m = 1; m <= 12; m++) {
        cells.push('<input type="number" min="0" max="' + L.MAX_PCT + '" step="5" inputmode="numeric" data-ed-cell data-pend="' + i + '" data-m="' + m + '" value="' + (Number(p.vals[m]) || 0) + '" aria-label="' + esc(p.label + ' — ' + mName(m)) + '">');
      }
      return '<div style="margin-bottom:.6rem;border:1px dashed #c9d3e8;border-radius:10px;padding:.4rem .5rem;background:#fbfcff">' +
        '<div style="font-size:11px;font-weight:700;color:var(--brand);margin-bottom:.25rem">جديد · ' + esc(p.label) + '</div>' +
        '<div class="ed-months">' + cells.join('') + '</div></div>';
    };
    const rows = (e.targets || []).map(rowFor).join('') ||
      '<div style="color:var(--muted);font-size:12.5px;padding:.3rem 0">لا بنود مسجَّلة في ' + YR() + (editable ? ' — أضِف جهة من الأسفل.' : '.') + '</div>';
    const pend = ed.pending.map(pendRow).join('');
    const addForm = editable ? (function () {
      const opts = empTargetOptions(e);
      if (!opts) return '';
      return '<div style="border-top:1px dashed var(--line);margin-top:.6rem;padding-top:.55rem">' +
        '<div style="font-size:10.5px;font-weight:800;color:var(--muted);margin-bottom:.3rem">إضافة جهة على مدى</div>' +
        '<div style="display:flex;gap:.35rem;flex-wrap:wrap;align-items:center;font-size:11.5px;color:var(--muted)">' +
        '<select id="ed-ntarget" class="input" style="flex:1;min-width:150px;font-size:12px;padding:.3rem .4rem" aria-label="الجهة">' + opts + '</select>' +
        'من <select id="ed-nfrom" class="input" style="padding:.25rem .3rem;font-size:11.5px">' + monthOpts(CM() || 1) + '</select>' +
        'إلى <select id="ed-nto" class="input" style="padding:.25rem .3rem;font-size:11.5px">' + monthOpts(12) + '</select>' +
        '<input id="ed-npct" class="input tnum" type="number" value="50" min="0" max="' + L.MAX_PCT + '" step="5" aria-label="النسبة" style="width:62px;padding:.25rem .35rem;font-size:11.5px;direction:ltr;text-align:center">' +
        '<button type="button" class="btn btn-sm" data-action="ed-addrow">أضِف</button>' +
        '</div></div>';
    })() : '';
    const html = '<div class="drawer-head">' +
      '<div style="flex:1;min-width:0">' +
      '<div style="font-weight:800;font-size:15px">' + esc(e.name_ar) + (e.active === 0 ? ' <span class="pill" style="background:#f1f5f9;color:#475569">غير نشط</span>' : '') + '</div>' +
      '<div style="font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(metaBits.join(' · ')) + '">' + esc(metaBits.join(' · ')) + '</div>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="dw-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="drawer-body">' + strip + oppLine + mh + rows + pend + addForm + '</div>' +
      '<div class="drawer-foot">' + (editable
        ? '<button type="button" class="btn btn-primary" data-action="ed-save">حفظ التغييرات</button><button type="button" class="btn" data-action="dw-close">إلغاء</button>'
        : '<button type="button" class="btn" data-action="dw-close">إغلاق</button>') +
      '</div>';
    window.Sanad.openDrawer(html);
  }
  function edTrack(t) {
    if (!ed) return;
    const m = Number(t.dataset.m);
    if (!m) return;
    let v = Math.round(Number(t.value));
    if (!Number.isFinite(v) || v < 0) v = 0;
    v = Math.min(v, LIM().MAX_PCT);
    if (t.dataset.pend != null) {
      const p = ed.pending[Number(t.dataset.pend)];
      if (p) p.vals[m] = v;
    } else {
      const vals = ed.vals[t.dataset.alloc];
      if (vals) vals[m] = v;
    }
  }
  function edCopyApply(btn) {
    if (!ed) return;
    const alloc = btn.dataset.alloc;
    const box = document.querySelector('#drawer [data-cp="' + alloc + '"]'); if (!box) return;
    const f = Number((box.querySelector('[data-cp-from]') || {}).value) || 1;
    const t0 = Number((box.querySelector('[data-cp-to]') || {}).value) || 12;
    const from = Math.min(f, t0), to = Math.max(f, t0);
    const vals = ed.vals[alloc]; if (!vals) return;
    const src = Number(vals[from]) || 0;
    for (let m = from + 1; m <= to; m++) vals[m] = src;
    edRender();
    toast('نُسخت قيمة ' + mName(from) + ' حتى ' + mName(to) + ' — احفظ التغييرات');
  }
  function edAddRow() {
    if (!ed) return;
    const selT = document.getElementById('ed-ntarget');
    if (!selT || !selT.value) { toast('اختر الجهة أولاً', true); return; }
    const f = Number((document.getElementById('ed-nfrom') || {}).value) || 1;
    const t0 = Number((document.getElementById('ed-nto') || {}).value) || 12;
    const from = Math.min(f, t0), to = Math.max(f, t0);
    const v = clampPct((document.getElementById('ed-npct') || {}).value);
    if (v <= 0) { toast('أدخل نسبة أكبر من صفر', true); return; }
    const key = selT.value;
    const ex = findAlloc(ed.empId, key);
    if (ex) {
      // الجهة مسجَّلة لسنتها: تعبئة المدى في صفّها القائم بدل بند مكرر (والخادم يبقى الحكم)
      const vals = ed.vals[ex.allocId] || {};
      for (let m = from; m <= to; m++) vals[m] = v;
      ed.vals[ex.allocId] = vals;
      toast('عُبّئ المدى في «' + targetLabel(key) + '» — احفظ التغييرات');
    } else {
      const vals = {};
      for (let m = 1; m <= 12; m++) vals[m] = 0;
      for (let m = from; m <= to; m++) vals[m] = v;
      ed.pending.push({ key: key, kind: isBucketKey(key) ? 'bucket' : 'project', targetId: targetIdOf(key), label: targetLabel(key), vals: vals });
    }
    edRender();
  }
  // «حفظ التغييرات»: الفرق وحده يتحول عمليات — set لخرائط المعدَّل، assign للبنود الجديدة
  async function edSave(btn) {
    if (!ed) return;
    const e = emp(ed.empId); if (!e) return;
    const ops = [];
    for (const t of e.targets || []) {
      const vals = ed.vals[t.allocId] || {}, orig = ed.orig[t.allocId] || {};
      const diff = {};
      for (let m = 1; m <= 12; m++) {
        const nv = clampPct(vals[m] || 0);
        if (nv !== (Number(orig[m]) || 0)) diff[m] = nv;
      }
      if (Object.keys(diff).length) ops.push({ op: 'set', allocId: t.allocId, months: diff });
    }
    for (const p of ed.pending) {
      const months = {};
      for (let m = 1; m <= 12; m++) {
        const v = clampPct(p.vals[m] || 0);
        if (v > 0) months[m] = v;
      }
      if (Object.keys(months).length) ops.push({ op: 'assign', kind: p.kind, targetId: p.targetId, employeeId: ed.empId, months: months });
    }
    if (!ops.length) { toast('لا تغييرات للحفظ'); return; }
    if (ops.length > 100) { toast('التغييرات كثيرة — احفظ على دفعتين (100 كحد أقصى)', true); return; }
    btn.disabled = true;
    try {
      await api('/staffing/bulk', 'POST', { year: YR(), ops: ops });
      toast('حُفظت التغييرات ✓');
      setTimeout(() => location.reload(), 450);
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  }

  // ── وضع التحديد المتعدد + شريط الإجراءات ───────────────────────────────────────
  const sel = { on: false, keys: new Set(), last: null };
  function ensureBar() {
    if (document.getElementById('mx-bar')) return;
    const d = document.createElement('div');
    d.id = 'mx-bar'; d.hidden = true;
    d.innerHTML = '<b id="mx-bar-count" class="tnum"></b>' +
      '<button type="button" class="btn btn-sm" data-action="bar-pct">تعديل النسبة</button>' +
      '<button type="button" class="btn btn-sm" data-action="bar-add">إضافة جهة</button>' +
      '<button type="button" class="btn btn-sm" data-action="bar-copyprev">نسخ الشهر السابق</button>' +
      '<button type="button" class="btn btn-sm" data-action="bar-remove" style="color:var(--red)">إزالة</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="bar-cancel">إلغاء</button>';
    document.body.appendChild(d);
  }
  function updateBar() {
    const bar = document.getElementById('mx-bar'); if (!bar) return;
    bar.hidden = !sel.on;
    const c = document.getElementById('mx-bar-count');
    if (c) c.textContent = sel.keys.size ? cellWord(sel.keys.size) : 'انقر الخلايا لتحديدها';
  }
  function selToggle() {
    sel.on = !sel.on;
    sel.keys.clear(); sel.last = null;
    document.querySelectorAll('#mx .mx-cell.sel').forEach((b) => b.classList.remove('sel'));
    const mx = document.getElementById('mx');
    if (mx) mx.classList.toggle('selecting', sel.on);
    const tg = document.querySelector('[data-action="mx-select-toggle"]');
    if (tg) tg.setAttribute('aria-pressed', String(sel.on));
    ensureBar();
    updateBar();
  }
  function selCell(btn, ev) {
    const id = btn.dataset.emp, m = Number(btn.dataset.m);
    const key = id + ':' + m;
    if (ev.shiftKey && sel.last && sel.last.emp === id) {
      // Shift+نقر يعلّم المدى داخل الصف نفسه
      const a = Math.min(sel.last.m, m), b = Math.max(sel.last.m, m);
      for (let i = a; i <= b; i++) {
        const c = document.querySelector('#mx .mx-cell[data-emp="' + id + '"][data-m="' + i + '"]');
        if (c) { sel.keys.add(id + ':' + i); c.classList.add('sel'); }
      }
    } else if (sel.keys.has(key)) {
      sel.keys.delete(key); btn.classList.remove('sel');
    } else {
      sel.keys.add(key); btn.classList.add('sel');
    }
    sel.last = { emp: id, m: m };
    updateBar();
  }

  // ── معاينة إجراء التحديد ثم التطبيق الذرّي (bulk — الكل أو لا شيء) ───────────────
  let pv = null; // { kind: 'pct'|'add'|'copyprev'|'remove' }
  function stage() {
    const L = LIM();
    const rows = [], warns = [];
    const opsMap = new Map();
    const mergeSet = (allocId, m, v) => {
      const k = 'set:' + allocId;
      const op = opsMap.get(k) || { op: 'set', allocId: allocId, months: {} };
      op.months[m] = v;
      opsMap.set(k, op);
    };
    const mergeAssign = (empId, key, m, v) => {
      const k = 'as:' + empId + ':' + key;
      const op = opsMap.get(k) || { op: 'assign', kind: isBucketKey(key) ? 'bucket' : 'project', targetId: targetIdOf(key), employeeId: empId, months: {} };
      op.months[m] = v;
      opsMap.set(k, op);
    };
    const keys = [...sel.keys].map((k) => {
      const i = k.lastIndexOf(':');
      return { id: k.slice(0, i), m: Number(k.slice(i + 1)) };
    }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.m - b.m));
    const push = (e, m, before, after, note) => {
      rows.push({ name: e.name_ar, m: m, before: before, after: after, note: note || '' });
      if (after != null && !note && after > L.OVER_ABOVE) warns.push(e.name_ar + ' سيصبح ' + after + '% في ' + mName(m));
    };
    for (const k of keys) {
      const e = emp(k.id); if (!e) continue;
      const m = k.m;
      const before = cellTotal(k.id, m);
      if (pv.kind === 'pct') {
        const v = clampPct((document.getElementById('pv-pct') || {}).value);
        const items = cellItems(e, m);
        if (!items.length) { push(e, m, before, null, 'لا بند هنا — استعمل «إضافة جهة»'); continue; }
        if (items.length > 1) { push(e, m, before, null, 'عدّلها من الخلية — فيها أكثر من بند'); continue; }
        const t = items[0];
        const after = before - (Number((t.months || {})[m]) || 0) + v;
        mergeSet(t.allocId, m, v);
        push(e, m, before, after);
      } else if (pv.kind === 'add') {
        const key = (document.getElementById('pv-target') || {}).value || '';
        const v = clampPct((document.getElementById('pv-tpct') || {}).value);
        if (!key) { push(e, m, before, null, 'اختر الجهة أولاً'); continue; }
        if (!isBucketKey(key)) {
          const p = projOf(targetIdOf(key));
          if (p && p.sector_id && e.sector_id && e.sector_id !== p.sector_id) { push(e, m, before, null, 'خارج قطاع الموظف'); continue; }
        }
        const ex = findAlloc(k.id, key);
        const old = ex ? (Number((ex.months || {})[m]) || 0) : 0;
        const after = before - old + v;
        if (ex) mergeSet(ex.allocId, m, v); else mergeAssign(k.id, key, m, v);
        push(e, m, before, after);
      } else if (pv.kind === 'copyprev') {
        if (m === 1) { push(e, m, before, null, 'لا شهر قبل يناير'); continue; }
        const ts = e.targets || [];
        if (!ts.length) { push(e, m, before, null, 'لا بنود لهذا الموظف'); continue; }
        let after = m === CM() ? oppSum(e) : 0;
        let changed = false;
        for (const t of ts) {
          const nv = Number((t.months || {})[m - 1]) || 0;
          const ov = Number((t.months || {})[m]) || 0;
          after += nv;
          if (nv !== ov) { mergeSet(t.allocId, m, nv); changed = true; }
        }
        after = Math.round(after);
        push(e, m, before, after, changed ? '' : 'مطابق للشهر السابق أصلاً');
      } else if (pv.kind === 'remove') {
        // «إزالة» = تصفير الأشهر المحددة لكل بنود الخلية — أوضح دلالة من حذف البند كاملاً
        const items = cellItems(e, m);
        if (!items.length) { push(e, m, before, null, 'لا شيء يُزال'); continue; }
        for (const t of items) mergeSet(t.allocId, m, 0);
        push(e, m, before, m === CM() ? oppSum(e) : 0);
      }
    }
    return { rows: rows, warns: warns, ops: [...opsMap.values()] };
  }
  function renderPv() {
    if (!pv) return;
    const list = document.getElementById('pv-list'); if (!list) return;
    const st = stage();
    const L = LIM();
    list.innerHTML = st.rows.length
      ? '<table class="pv-t"><thead><tr><th>الموظف</th><th>الشهر</th><th>قبل</th><th>بعد</th><th></th></tr></thead><tbody>' +
      st.rows.map((r) => '<tr' + (r.note && r.after == null ? ' style="opacity:.55"' : '') + '>' +
        '<td>' + esc(r.name) + '</td><td>' + esc(mName(r.m)) + '</td>' +
        '<td class="tnum">' + r.before + '%</td>' +
        '<td class="tnum" style="font-weight:800;color:' + (r.after == null ? 'var(--faint)' : r.after > L.OVER_ABOVE ? 'var(--red)' : 'var(--ink2)') + '">' + (r.after == null ? '—' : r.after + '%') + '</td>' +
        '<td style="font-size:10px;color:var(--muted)">' + esc(r.note || '') + '</td></tr>').join('') +
      '</tbody></table>'
      : '<div style="color:var(--muted);font-size:12px">لا خلايا محددة.</div>';
    const wbox = document.getElementById('pv-warns');
    if (wbox) {
      let w = st.warns.length
        ? '<div class="alert warn" style="font-size:11.5px;margin-top:.6rem">' + st.warns.slice(0, 10).map(esc).join('<br>') +
        (st.warns.length > 10 ? '<br>+' + (st.warns.length - 10) + ' تحذيرات أخرى' : '') + '</div>'
        : '';
      if (st.ops.length > 100) w += '<div class="alert err" style="font-size:11.5px;margin-top:.4rem">التغييرات تتجاوز 100 في الدفعة الواحدة — قلّل التحديد ثم أعد المحاولة.</div>';
      wbox.innerHTML = w;
    }
    const apply = document.getElementById('pv-apply');
    if (apply) apply.disabled = !st.ops.length || st.ops.length > 100;
  }
  function openPreview(kind) {
    if (!sel.keys.size) { toast('حدّد خلايا أولاً', true); return; }
    pv = { kind: kind };
    sn = null;
    const titles = { pct: 'تعديل النسبة', add: 'إضافة جهة', copyprev: 'نسخ الشهر السابق', remove: 'إزالة التسكين' };
    const controls = kind === 'pct'
      ? '<div class="field"><label>النسبة الجديدة للخلايا المحددة</label><input id="pv-pct" class="input tnum" type="number" min="0" max="' + LIM().MAX_PCT + '" step="5" value="50" style="direction:ltr;text-align:center"></div>'
      : kind === 'add'
        ? '<div class="grid2"><div class="field"><label>الجهة</label><select id="pv-target" class="input">' + allTargetOptions() + '</select></div>' +
        '<div class="field"><label>النسبة</label><input id="pv-tpct" class="input tnum" type="number" min="0" max="' + LIM().MAX_PCT + '" step="5" value="50" style="direction:ltr;text-align:center"></div></div>'
        : '';
    window.Sanad.openModal('<div class="modal-head"><div style="font-weight:800;font-size:15px">معاينة — ' + titles[kind] + '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body">' + controls + '<div id="pv-list"></div><div id="pv-warns"></div></div>' +
      '<div class="modal-foot"><button type="button" class="btn btn-primary" id="pv-apply" data-action="pv-apply">تطبيق</button>' +
      '<button type="button" class="btn" data-action="modal-close">إلغاء</button></div>');
    renderPv();
  }
  async function pvApply(btn) {
    if (!pv) return;
    const st = stage();
    if (!st.ops.length) { toast('لا تغييرات قابلة للتطبيق', true); return; }
    if (st.ops.length > 100) { toast('قلّل التحديد — الحد 100 تغيير في الدفعة', true); return; }
    btn.disabled = true;
    try {
      await api('/staffing/bulk', 'POST', { year: YR(), ops: st.ops });
      toast('طُبّقت التغييرات ✓');
      setTimeout(() => location.reload(), 450);
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  }

  // ── «تسكين جديد»: نافذة واحدة بأقسام متتابعة تنتهي بمراجعة حية ثم دفعة ذرّية ─────
  let sn = null;
  function snHtml() {
    const chips = M().map((mn, i) =>
      '<button type="button" class="mchip' + (sn.picks.has(i + 1) ? ' on' : '') + '" data-sn-m="' + (i + 1) + '">' + esc(mn) + '</button>').join('');
    return '<div class="modal-head"><div style="font-weight:800;font-size:15px">تسكين جديد — ' + YR() + '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body">' +
      '<div class="field"><label>1 · أين سيكون التسكين؟</label><select id="sn-target" class="input" aria-label="جهة التسكين">' + allTargetOptions() + '</select></div>' +
      '<div class="field"><label>2 · الموظفون</label>' +
      '<input id="sn-q" class="input" placeholder="ابحث بالاسم أو المسمى…" aria-label="بحث عن موظف" autocomplete="off">' +
      '<div id="sn-emps" style="max-height:170px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:.35rem .6rem"></div></div>' +
      '<div class="field"><label>3 · الأشهر</label>' +
      '<div class="seg"><button type="button" data-sn-mmode="range" class="on">مدى</button><button type="button" data-sn-mmode="pick">أشهر بعينها</button></div>' +
      '<div id="sn-range" class="snrow">من <select id="sn-from" class="input" style="padding:.3rem .4rem">' + monthOpts(sn.from) + '</select> إلى <select id="sn-to" class="input" style="padding:.3rem .4rem">' + monthOpts(sn.to) + '</select></div>' +
      '<div id="sn-picks" class="mgrid" hidden>' + chips + '</div></div>' +
      '<div class="field"><label>4 · النسبة</label>' +
      '<div class="seg"><button type="button" data-sn-pmode="uniform" class="on">موحّدة</button><button type="button" data-sn-pmode="per">لكل شهر</button></div>' +
      '<input id="sn-pct" class="input tnum" type="number" min="0" max="' + LIM().MAX_PCT + '" step="5" value="' + sn.pct + '" aria-label="النسبة الموحّدة" style="direction:ltr;text-align:center;width:110px">' +
      '<div id="sn-per" class="mgrid" hidden></div></div>' +
      '<div class="field"><label>5 · مراجعة</label><div id="sn-review" style="font-size:12.5px;font-weight:700"></div><div id="sn-warns"></div></div>' +
      '</div>' +
      '<div class="modal-foot"><button type="button" class="btn btn-primary" data-action="sn-save">حفظ التسكين</button>' +
      '<button type="button" class="btn" data-action="modal-close">إلغاء</button></div>';
  }
  function openStaffNew() {
    pv = null;
    sn = { target: '', q: '', picked: new Set(), mmode: 'range', from: CM() || 1, to: 12, picks: new Set([CM() || 1]), pmode: 'uniform', pct: 50, per: {} };
    window.Sanad.openModal(snHtml());
    snRenderEmps(); snRenderPer(); snReview();
  }
  function snMonths() {
    if (!sn) return [];
    if (sn.mmode === 'range') {
      const a = Math.min(sn.from, sn.to), b = Math.max(sn.from, sn.to);
      const out = [];
      for (let m = a; m <= b; m++) out.push(m);
      return out;
    }
    return [...sn.picks].sort((a, b) => a - b);
  }
  const snPct = (m) => clampPct(sn.pmode === 'per' ? (sn.per[m] != null ? sn.per[m] : sn.pct) : sn.pct);
  function snRenderEmps() {
    if (!sn) return;
    const box = document.getElementById('sn-emps'); if (!box) return;
    const proj = sn.target && !isBucketKey(sn.target) ? projOf(targetIdOf(sn.target)) : null;
    // مشروع بقطاع ⟵ موظفو قطاعه + من بلا قطاع (مرآة حاجز الخادم)؛ ومن خرج عن الترشيح يُلغى اختياره
    const inScope = (e) => e.active !== 0 && (!proj || !proj.sector_id || !e.sector_id || e.sector_id === proj.sector_id);
    [...sn.picked].forEach((id) => { const e = emp(id); if (!e || !inScope(e)) sn.picked.delete(id); });
    const q = sn.q.trim().toLowerCase();
    const list = Object.entries(S().emps || {})
      .filter((kv) => inScope(kv[1]))
      .filter((kv) => !q || ((kv[1].name_ar || '') + ' ' + (kv[1].job_title || '')).toLowerCase().indexOf(q) !== -1)
      .sort((a, b) => String(a[1].name_ar).localeCompare(String(b[1].name_ar), 'ar'));
    box.innerHTML = list.length ? list.map((kv) =>
      '<label style="display:flex;align-items:center;gap:.45rem;padding:.18rem 0;font-size:12.5px;cursor:pointer">' +
      '<input type="checkbox" data-sn-emp="' + esc(kv[0]) + '"' + (sn.picked.has(kv[0]) ? ' checked' : '') + '>' +
      '<span style="font-weight:700">' + esc(kv[1].name_ar) + '</span>' +
      '<span style="color:var(--muted);font-size:10.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(kv[1].job_title || '') + '</span></label>').join('')
      : '<div style="color:var(--muted);font-size:12px;padding:.4rem 0">لا موظفين يطابقون البحث ضمن قطاع الجهة المختارة.</div>';
  }
  function snRenderPer() {
    if (!sn) return;
    const per = document.getElementById('sn-per');
    const pctIn = document.getElementById('sn-pct');
    if (!per) return;
    const on = sn.pmode === 'per';
    per.hidden = !on;
    if (pctIn) pctIn.style.display = on ? 'none' : '';
    if (!on) return;
    per.innerHTML = snMonths().map((m) =>
      '<label style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--muted);align-items:center">' + esc(mName(m)) +
      '<input type="number" data-sn-mpct="' + m + '" min="0" max="' + LIM().MAX_PCT + '" step="5" value="' + clampPct(sn.per[m] != null ? sn.per[m] : sn.pct) + '" class="input tnum" style="width:58px;padding:.2rem .25rem;font-size:11px;direction:ltr;text-align:center"></label>').join('');
  }
  function snReview() {
    if (!sn) return;
    const box = document.getElementById('sn-review'); if (!box) return;
    const months = snMonths();
    box.textContent = (sn.picked.size ? empWord(sn.picked.size) : 'لا موظفين بعد') + ' × ' +
      (months.length ? mWord(months.length) : 'لا أشهر') + ' × ' +
      (sn.target ? targetLabel(sn.target) : 'بلا جهة بعد');
    const warns = [];
    if (sn.target) {
      for (const id of sn.picked) {
        const e = emp(id); if (!e) continue;
        const ex = findAlloc(id, sn.target);
        for (const m of months) {
          const v = snPct(m); if (v <= 0) continue;
          const old = ex ? (Number((ex.months || {})[m]) || 0) : 0;
          const after = cellTotal(id, m) - old + v;
          if (after > LIM().OVER_ABOVE) warns.push(e.name_ar + ' سيصبح ' + after + '% في ' + mName(m));
        }
      }
    }
    const wbox = document.getElementById('sn-warns');
    if (wbox) wbox.innerHTML = warns.length
      ? '<div class="alert warn" style="font-size:11.5px;margin-top:.4rem">' + warns.slice(0, 8).map(esc).join('<br>') +
      (warns.length > 8 ? '<br>+' + (warns.length - 8) + ' تحذيرات أخرى' : '') + '</div>'
      : '';
  }
  async function snSave(btn) {
    if (!sn) return;
    if (!sn.target) { toast('اختر الجهة أولاً', true); return; }
    if (!sn.picked.size) { toast('اختر موظفاً واحداً على الأقل', true); return; }
    const months = snMonths();
    if (!months.length) { toast('حدّد الأشهر', true); return; }
    const mm = {};
    let any = false;
    months.forEach((m) => { const v = snPct(m); if (v > 0) { mm[m] = v; any = true; } });
    if (!any) { toast('أدخل نسبة أكبر من صفر', true); return; }
    const ops = [];
    for (const id of sn.picked) {
      const ex = findAlloc(id, sn.target); // مكرر (موظف,جهة,سنة)؟ يتحول دمجاً بدل رسالة الخادم
      ops.push(ex
        ? { op: 'set', allocId: ex.allocId, months: mm }
        : { op: 'assign', kind: isBucketKey(sn.target) ? 'bucket' : 'project', targetId: targetIdOf(sn.target), employeeId: id, months: mm });
    }
    if (ops.length > 100) { toast('قسّم الحفظ — الحد 100 تغيير في الدفعة', true); return; }
    btn.disabled = true;
    try {
      await api('/staffing/bulk', 'POST', { year: YR(), ops: ops });
      toast('حُفظ التسكين ✓');
      setTimeout(() => location.reload(), 450);
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  }

  // ── التفويض: نقر ─────────────────────────────────────────────────────────────
  document.addEventListener('click', (ev) => {
    const dd = ev.target.closest('[data-dd]');
    if (dd && window.Sanad) { window.Sanad.openDD(dd.dataset.dd); return; }
    const chipCd = ev.target.closest('[data-cd-m]');
    if (chipCd) {
      chipCd.classList.toggle('on');
      if (cd) {
        const m = Number(chipCd.dataset.cdM);
        if (chipCd.classList.contains('on')) cd.picks.add(m); else cd.picks.delete(m);
        cdWarn();
      }
      return;
    }
    const chipSn = ev.target.closest('[data-sn-m]');
    if (chipSn) {
      chipSn.classList.toggle('on');
      if (sn) {
        const m = Number(chipSn.dataset.snM);
        if (chipSn.classList.contains('on')) sn.picks.add(m); else sn.picks.delete(m);
        snRenderPer(); snReview();
      }
      return;
    }
    const segCd = ev.target.closest('[data-cd-mode]');
    if (segCd) {
      setSeg(segCd);
      if (cd) {
        cd.mode = segCd.dataset.cdMode;
        const mm = document.getElementById('cd-months');
        if (mm) mm.hidden = cd.mode !== 'multi';
        cdWarn();
      }
      return;
    }
    const segM = ev.target.closest('[data-sn-mmode]');
    if (segM) {
      setSeg(segM);
      if (sn) {
        sn.mmode = segM.dataset.snMmode;
        const r = document.getElementById('sn-range'), p = document.getElementById('sn-picks');
        if (r) r.hidden = sn.mmode !== 'range';
        if (p) p.hidden = sn.mmode !== 'pick';
        snRenderPer(); snReview();
      }
      return;
    }
    const segP = ev.target.closest('[data-sn-pmode]');
    if (segP) {
      setSeg(segP);
      if (sn) { sn.pmode = segP.dataset.snPmode; snRenderPer(); snReview(); }
      return;
    }
    const segSt = ev.target.closest('#mx-status button[data-status]');
    if (segSt) { setSeg(segSt); flt.status = segSt.dataset.status; applyFilters(); return; }
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'cell') { if (sel.on) selCell(el, ev); else openCellDrawer(el.dataset.emp, Number(el.dataset.m)); return; }
    if (a === 'emp-drawer') { openEmpDrawer(el.dataset.emp); return; }
    if (a === 'mx-select-toggle') { selToggle(); return; }
    if (a === 'staff-new') { openStaffNew(); return; }
    if (a === 'dw-close') { window.Sanad.closeDrawer(); cd = null; ed = null; return; }
    if (a === 'modal-close') { window.Sanad.closeModal(); pv = null; sn = null; return; }
    if (a === 'cd-remove') { cdRemove(el); return; }
    if (a === 'cd-add') { cdAdd(el); return; }
    if (a === 'ed-copy') {
      const b = document.querySelector('#drawer [data-cp="' + el.dataset.alloc + '"]');
      if (b) b.hidden = !b.hidden;
      return;
    }
    if (a === 'ed-copy-apply') { edCopyApply(el); return; }
    if (a === 'ed-addrow') { edAddRow(); return; }
    if (a === 'ed-save') { edSave(el); return; }
    if (a === 'bar-pct') { openPreview('pct'); return; }
    if (a === 'bar-add') { openPreview('add'); return; }
    if (a === 'bar-copyprev') { openPreview('copyprev'); return; }
    if (a === 'bar-remove') { openPreview('remove'); return; }
    if (a === 'bar-cancel') { selToggle(); return; }
    if (a === 'pv-apply') { pvApply(el); return; }
    if (a === 'sn-save') { snSave(el); return; }
  });

  // ── التفويض: تغيير ───────────────────────────────────────────────────────────
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (!t || !t.matches) return;
    if (t.id === 'mx-year') { navParam('year', t.value); return; }
    if (t.id === 'mx-dept') { navParam('dept', t.value); return; }
    if (t.id === 'mx-target') { flt.target = t.value; applyFilters(); return; }
    if (t.matches('[data-cd-pct]')) { cdSaveRow(t); return; }
    if (t.id === 'cd-target') { cdWarn(); return; }
    if (t.matches('[data-ed-cell]')) { t.value = String(clampPct(t.value)); edTrack(t); return; }
    if (t.matches('[data-sn-emp]')) {
      if (sn) {
        if (t.checked) sn.picked.add(t.dataset.snEmp); else sn.picked.delete(t.dataset.snEmp);
        snReview();
      }
      return;
    }
    if (t.id === 'sn-target') { if (sn) { sn.target = t.value; snRenderEmps(); snReview(); } return; }
    if (t.id === 'sn-from') { if (sn) { sn.from = Number(t.value) || 1; snRenderPer(); snReview(); } return; }
    if (t.id === 'sn-to') { if (sn) { sn.to = Number(t.value) || 12; snRenderPer(); snReview(); } return; }
    if (t.id === 'pv-target') { renderPv(); return; }
  });

  // ── التفويض: إدخال حي ────────────────────────────────────────────────────────
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!t || !t.matches) return;
    if (t.id === 'staff-q') { flt.q = t.value; applyFilters(); return; }
    if (t.id === 'sn-q') { if (sn) { sn.q = t.value; snRenderEmps(); } return; }
    if (t.id === 'sn-pct') { if (sn) { sn.pct = Number(t.value) || 0; snReview(); } return; }
    if (t.matches('[data-sn-mpct]')) { if (sn) { sn.per[Number(t.dataset.snMpct)] = Number(t.value) || 0; snReview(); } return; }
    if (t.matches('[data-cd-pct]') || t.id === 'cd-pct') { cdWarn(); return; }
    if (t.id === 'pv-pct' || t.id === 'pv-tpct') { renderPv(); return; }
    if (t.matches('[data-ed-cell]')) { edTrack(t); return; }
  });

  // ── لوحة المفاتيح: Enter يحفظ حقل الدرج، Esc يخرج من التحديد بعد إغلاق الطبقات ──
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target && ev.target.matches && ev.target.matches('[data-cd-pct]')) {
      ev.preventDefault(); ev.target.blur(); return;
    }
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.getAttribute && ev.target.getAttribute('data-dd')) {
      ev.preventDefault();
      if (window.Sanad) window.Sanad.openDD(ev.target.getAttribute('data-dd'));
      return;
    }
    if (ev.key === 'Escape') {
      const dw = document.getElementById('drawer');
      const md = document.getElementById('modal');
      const layerOpen = (dw && dw.classList.contains('on')) || (md && md.classList.contains('on'));
      if (layerOpen) { cd = null; ed = null; pv = null; sn = null; return; } // app.js يغلق الطبقة نفسها
      if (sel.on) selToggle();
    }
  });

  initFilters();
  // وصولٌ عميق من مركز القيادة (v5.35): ?emp= يفتح درج الشخص نفسه إن كان في الكشف — وإلا لا شيء.
  if (S().deepEmp && emp(S().deepEmp)) {
    openEmpDrawer(S().deepEmp);
    var dc = document.querySelector('#drawer button');
    if (dc) dc.focus();
  }
})();
