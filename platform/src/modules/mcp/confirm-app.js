// بطاقةُ تأكيد التغيير — واجهةٌ تُرسم داخل محادثة المساعد (MCP Apps، ADR-0023).
//
// ملفٌ واحد مكتفٍ بنفسه: لا شبكة، لا مكتبات، لا خطوط خارجية. المضيفُ يعرضه في إطارٍ معزول ويدفع
// إليه نتيجةَ أداة التنفيذ (الحالة المبنيّة «بانتظار التأكيد») فيرسم منها قبل/بعد وزرّين. الزرّان
// يناديان أداتي التأكيد والرفض **عبر المضيف** لا عبر النموذج، ثم تُرسل رسالةٌ إلى المحادثة تقول
// ما وقع كي يعرف النموذج أن التغيير نُفِّذ أو رُفض ولا يخمّن.
//
// البروتوكول: JSON-RPC 2.0 فوق postMessage.
//   البطاقة ⟶ المضيف: ui/initialize (طلب) ثم ui/notifications/initialized (إشعار)، tools/call (طلب)،
//                    ui/message (طلب)، ui/notifications/size-changed (إشعار)
//   المضيف ⟶ البطاقة: ui/notifications/tool-input، ui/notifications/tool-result،
//                    ui/notifications/host-context-changed
//
// كلُّ نصٍّ يُعرض يمرّ بالتهريب: صفوفُ قبل/بعد بياناتٌ كتبها الناس، وليست وسوماً.
export const CONFIRM_APP_URI = 'ui://sanad/confirm-change';
export const CONFIRM_APP_MIME = 'text/html;profile=mcp-app';

export const CONFIRM_APP_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>تأكيد التغيير — سند</title>
<style>
  :root { --bg:#ffffff; --fg:#1a1d24; --muted:#5b6472; --line:#e3e6ea; --brand:#2f3f8f; --brand-fg:#ffffff;
          --ok-bg:#e8f6ee; --ok-fg:#156a3a; --warn-bg:#fff4e0; --warn-fg:#7a4a00; --bad-bg:#fdeaea; --bad-fg:#8a1c1c; --th:#f4f6f8; }
  .dark { --bg:#171a21; --fg:#e8eaee; --muted:#a6adb8; --line:#2c313b; --brand:#8fa0ff; --brand-fg:#0f1220;
          --ok-bg:#12331f; --ok-fg:#9be0b4; --warn-bg:#3a2a08; --warn-fg:#ffd28a; --bad-bg:#3a1414; --bad-fg:#ffb3b3; --th:#20242d; }
  * { box-sizing:border-box; }
  html, body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.7 system-ui, "Segoe UI", Tahoma, sans-serif; }
  .card { padding:16px 18px; }
  h1 { font-size:17px; margin:0 0 2px; }
  .sub { color:var(--muted); margin:0 0 10px; font-size:13.5px; }
  .meta { color:var(--muted); font-size:13px; margin:0 0 10px; }
  .box { border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin:10px 0; }
  .summary { background:var(--th); }
  table { width:100%; border-collapse:collapse; margin:6px 0 4px; }
  th, td { text-align:right; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { background:var(--th); font-weight:600; font-size:13px; }
  td.after { font-weight:700; }
  .note { display:block; color:var(--muted); font-size:12.5px; margin-top:3px; }
  .tnum { font-variant-numeric:tabular-nums; unicode-bidi:isolate; direction:ltr; display:inline-block; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:12px; }
  button { font:inherit; border-radius:9px; padding:9px 16px; border:1px solid var(--line); background:var(--bg); color:var(--fg); cursor:pointer; }
  button.primary { background:var(--brand); color:var(--brand-fg); border-color:var(--brand); font-weight:700; }
  button:disabled { opacity:.55; cursor:default; }
  .status { font-size:13.5px; color:var(--muted); }
  .alert { border-radius:10px; padding:10px 12px; margin:8px 0; }
  .ok { background:var(--ok-bg); color:var(--ok-fg); }
  .warn { background:var(--warn-bg); color:var(--warn-fg); }
  .bad { background:var(--bad-bg); color:var(--bad-fg); }
  .hidden { display:none !important; }
</style>
</head>
<body>
<div class="card" id="root">
  <div id="loading" class="status">جارٍ تحميل التغيير…</div>
</div>
<script>
(() => {
  'use strict';
  const PROTOCOL = '2026-01-26';
  const root = document.getElementById('root');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  let nextId = 1;
  const pending = new Map();
  let state = { change: null, done: null };

  // ── النقل: JSON-RPC فوق postMessage ──
  const post = (msg) => window.parent.postMessage(msg, '*');
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    post({ jsonrpc: '2.0', id, method, params: params || {} });
  });
  const notifyHost = (method, params) => post({ jsonrpc: '2.0', method, params: params || {} });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.id != null && (('result' in m) || ('error' in m)) && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if ('error' in m) p.reject(new Error(m.error && m.error.message ? m.error.message : 'تعذّر الاتصال بالمضيف'));
      else p.resolve(m.result);
      return;
    }
    if (typeof m.method !== 'string') return;
    if (m.method === 'ui/notifications/tool-input') { /* المدخلات لا تُعرض — الحالةُ المبنيّة أصدق */ return; }
    if (m.method === 'ui/notifications/tool-result') { onToolResult(m.params || {}); return; }
    if (m.method === 'ui/notifications/host-context-changed') { applyContext(m.params || {}); return; }
    if (m.method === 'ui/notifications/tool-cancelled') { render(); return; }
    // طلبٌ من المضيف لا نعرفه: نجيب بخطأ قياسي كي لا يعلّق
    if (m.id != null) post({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'غير مدعوم في هذه البطاقة' } });
  });

  const applyContext = (ctx) => {
    const theme = ctx && ctx.theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
  };

  const reportSize = () => {
    const h = Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 200);
    notifyHost('ui/notifications/size-changed', { width: Math.ceil(document.documentElement.clientWidth || 600), height: h });
  };

  // ── الحالةُ المبنيّة القادمة من أداة التنفيذ ──
  function onToolResult(params) {
    const sc = params.structuredContent || null;
    if (sc && sc.awaiting_confirmation) { state.change = sc; state.done = null; render(); return; }
    if (sc && sc.executed === true) { state.done = { ok: true, text: sc.summary_ar || sc.message_ar || 'نُفِّذ' }; render(); return; }
    // نصٌّ فقط (خطأ من الأداة): يُعرض كما جاء
    const txt = Array.isArray(params.content) ? params.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\\n') : '';
    state.done = { ok: false, text: txt || 'لم يصل تغييرٌ لعرضه.' };
    render();
  }

  function rowsHtml(display) {
    const rows = (display || []).filter((r) => r && r.field_ar);
    if (!rows.length) return '<div class="alert warn">تفصيلُ هذا الطلب غير متاح للعرض. لا تؤكّده حتى تراجعه، أو ارفضه واطلب عرضه من جديد.</div>';
    const hasBefore = rows.some((r) => r.before_ar != null);
    return '<table><thead><tr><th>ما يتغيّر</th>' + (hasBefore ? '<th>قبل</th>' : '') + '<th>' + (hasBefore ? 'بعد' : 'القيمة') + '</th></tr></thead><tbody>'
      + rows.map((r) => '<tr><td>' + esc(r.field_ar) + (r.note_ar ? '<span class="note">' + esc(r.note_ar) + '</span>' : '') + '</td>'
        + (hasBefore ? '<td>' + esc(r.before_ar == null ? '—' : r.before_ar) + '</td>' : '')
        + '<td class="after">' + esc(r.after_ar == null ? '—' : r.after_ar) + '</td></tr>').join('')
      + '</tbody></table>';
  }

  const fmtStamp = (iso) => {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    const r = new Date(d.getTime() + 3 * 3600000);   // توقيت الرياض
    const two = (n) => String(n).padStart(2, '0');
    return two(r.getUTCHours()) + ':' + two(r.getUTCMinutes()) + ' · ' + r.getUTCDate() + '/' + (r.getUTCMonth() + 1);
  };

  function render() {
    const c = state.change;
    if (state.done) {
      root.innerHTML = '<div class="alert ' + (state.done.ok ? 'ok' : 'bad') + '">' + esc(state.done.text) + '</div>';
      reportSize(); return;
    }
    if (!c) { root.innerHTML = '<div class="status">لا تغيير بانتظار التأكيد.</div>'; reportSize(); return; }
    root.innerHTML =
      '<h1>' + esc(c.subject_ar || 'تغيير ينتظر تأكيدك') + '</h1>'
      + '<p class="sub">لم يُنفَّذ شيء بعد — اقرأ ما سيتغيّر ثم قرّر.</p>'
      + (c.summary_ar ? '<div class="box summary">' + esc(c.summary_ar) + '</div>' : '')
      + rowsHtml(c.display)
      + (c.expires_at ? '<p class="meta">صالح للتأكيد حتى <span class="tnum">' + esc(fmtStamp(c.expires_at)) + '</span> بتوقيت الرياض — بعدها يسقط الطلب ولا يُنفَّذ.</p>' : '')
      + '<div class="row"><button class="primary" id="btn-ok">نفّذ</button><button id="btn-no">ارفض</button><span class="status" id="st" role="status" aria-live="polite"></span></div>';
    document.getElementById('btn-ok').addEventListener('click', () => decide('confirm'));
    document.getElementById('btn-no').addEventListener('click', () => decide('reject'));
    reportSize();
  }

  async function decide(kind) {
    const c = state.change; if (!c) return;
    const ok = document.getElementById('btn-ok'), no = document.getElementById('btn-no'), st = document.getElementById('st');
    ok.disabled = true; no.disabled = true; st.textContent = kind === 'confirm' ? 'جارٍ التنفيذ…' : 'جارٍ الرفض…';
    try {
      const res = await request('tools/call', { name: kind === 'confirm' ? 'sanad_confirm_change' : 'sanad_reject_change', arguments: { changeId: c.change_id } });
      const sc = res && res.structuredContent ? res.structuredContent : null;
      const errText = res && res.isError ? (res.content || []).map((x) => x.text || '').join(' ') : '';
      if (errText) throw new Error(errText);
      const msg = sc && sc.message_ar ? sc.message_ar : (kind === 'confirm' ? 'نُفِّذ ✓' : 'رُفض — لم يُكتب شيء.');
      state.done = { ok: kind === 'confirm', text: msg }; render();
      // رسالةٌ إلى المحادثة كي يعرف النموذج ما وقع فلا يخمّن ولا يكرّر
      try { await request('ui/message', { role: 'user', content: { type: 'text', text: (kind === 'confirm' ? 'أكّدتُ التنفيذ من بطاقة التأكيد: ' : 'رفضتُ التغيير من بطاقة التأكيد: ') + (c.summary_ar || c.change_id) } }); } catch (e) { /* المضيف قد لا يدعمها */ }
    } catch (e) {
      ok.disabled = false; no.disabled = false;
      st.textContent = (e && e.message) ? e.message : 'تعذّر إتمام الطلب؛ أعد المحاولة';
      reportSize();
    }
  }

  // ── البدء: مصافحة ثم انتظار نتيجة الأداة ──
  request('ui/initialize', {
    protocolVersion: PROTOCOL,
    appInfo: { name: 'سند — تأكيد التغيير', version: '1.0.0' },
    clientInfo: { name: 'سند — تأكيد التغيير', version: '1.0.0' },
    capabilities: {}, appCapabilities: { availableDisplayModes: ['inline'] },
  }).then((res) => {
    if (res && res.hostContext) applyContext(res.hostContext);
    notifyHost('ui/notifications/initialized', {});
    // إن لم تصل نتيجةٌ خلال ثوانٍ فالمضيف لم يدفعها: نقولها بدل صفحةٍ بيضاء
    setTimeout(() => { if (!state.change && !state.done) { root.innerHTML = '<div class="status">بانتظار التغيير من المساعد…</div>'; reportSize(); } }, 4000);
  }).catch(() => {
    root.innerHTML = '<div class="alert bad">تعذّر الاتصال بمضيف المحادثة — لم يُنفَّذ شيء.</div>'; reportSize();
  });
})();
</script>
</body>
</html>`;
