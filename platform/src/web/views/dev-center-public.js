// «مركز التطوير» — الصفحة العامة: نموذج الاستقبال وصفحة المتابعة.
//
// هذه الصفحة الوحيدة في المنصة التي يفتحها **من لا حساب له**: موظّف عميلٍ وصله رابط الاستقبال
// من مدير حسابه. فهي لا تمرّ بـ`layout()` إطلاقاً — لا قائمة جانبية، ولا شريط بحث، ولا سنة
// مالية، ولا أي شيء يوحي بأن خلف هذا الرابط منصةً داخلية يُتَجوَّل فيها. إطار EVC يبقى (فالجهة
// التي تستقبل البلاغ معروفة)، ويُضاف إليه شعار المنتج ولونه فيعرف المُبلِّغ أنه يبلّغ عن المنتج
// الذي بين يديه.
//
// ولغتان: العميل قد يكون عربياً أو غيره. وكل نصوص هذه الصفحة — العربية والإنجليزية معاً —
// **محلّية في هذا الملف** في جدولَي `AR` و`EN` أدناه، ولا تدخل معجم المنصة: معجم المنصة لسان
// الموظفين، وهذا لسان ضيفٍ يزور بابنا مرةً واحدة. خلطُهما يجرّ الإنجليزية إلى شاشات الموظفين.
//
// وقاعدة التسمية هنا أشدّ منها في الداخل: الرابط اسمه «رابط الاستقبال» لا سواه، ولا تظهر قيمةٌ
// مخزَّنة (حالةٌ أو نوعٌ أو إلحاح) إلا مترجمةً من `labels.js` — وهي المصدر الوحيد لتلك الأسماء.
//
// وكلُّ ما يأتي من الطلب أو القاعدة يمرّ بـ`esc()` بلا استثناء: النصّ الذي يكتبه مُبلِّغٌ مجهول
// يُعاد عرضه له في صفحة المتابعة، فهو أخطر نصٍّ في المنصة كلها.
import { esc } from './_shared.js';
import { itemStatusLabel, itemTypeLabel, itemUrgencyLabel, ITEM_TYPE, ITEM_URGENCY } from '../../modules/products/labels.js';

// ── جدولا النصّ ───────────────────────────────────────────────────────────────
// عربيٌّ أولاً لأنه الأصل، وإنجليزيٌّ مرآته. أي مفتاحٍ يُضاف هنا يُضاف هناك — والصفحة تسقط
// إلى العربية عند أي مفتاحٍ ناقص، فلا تظهر كلمةٌ فارغة لضيف.
const AR = {
  dir: 'rtl', lang: 'ar', other: 'English', otherCode: 'en',
  brandLine: 'رؤية الخبراء الاستشارية',
  formTitle: 'أخبرنا بما واجهته',
  formLead: 'اكتب ما حدث بلغتك، وسيصل فريق المنتج فوراً. لا يلزمك حساب.',
  kindLabel: 'ما نوع ما تريد إخبارنا به؟',
  titleLabel: 'عنوان مختصر',
  titlePlaceholder: 'جملة واحدة تلخّص ما حدث',
  descLabel: 'اشرح ما حدث',
  descPlaceholder: 'ما الذي كنت تفعله؟ وما الذي حدث بدل ما توقّعته؟',
  whereLabel: 'أين حدث هذا؟',
  wherePlaceholder: 'اسم الشاشة أو الخطوة التي كنت فيها',
  urgencyLabel: 'كم يؤثّر هذا على عملك؟',
  nameLabel: 'اسمك',
  emailLabel: 'بريدك',
  identityOptional: 'اختياري — واتركه فارغاً إن أحببت أن تبلّغ بلا تعريف بنفسك',
  identityRequired: 'مطلوب كي نصلك بما استجدّ',
  identityNone: 'هذا الرابط يستقبل البلاغات بلا تعريف بالنفس.',
  imagesLabel: 'صور توضّح ما حدث',
  imagesHint: 'حتى خمس صور — تساعد الفريق على فهم ما رأيته.',
  submit: 'أرسِل',
  sending: 'جارٍ الإرسال…',
  doneTitle: 'وصلنا بلاغك',
  doneLead: 'شكراً لك. رقم بلاغك هو',
  doneTrack: 'تابع ما يجري عليه من هنا',
  closedTitle: 'هذا الرابط لم يعد يستقبل',
  closedLead: 'إن كنت تريد إبلاغنا بشيء، تواصل مع من أرسل إليك الرابط ليزوّدك برابطٍ يعمل.',
  trackTitle: 'متابعة بلاغك',
  trackStatus: 'أين وصل',
  trackThread: 'ما دار حول بلاغك',
  trackEmpty: 'لا جديد بعد — سنكتب لك هنا حين يستجدّ شيء.',
  replyLabel: 'ردّك على سؤال الفريق',
  replyPlaceholder: 'اكتب ما يوضّح الأمر…',
  replySend: 'أرسِل ردّك',
  replyDone: 'وصلنا ردّك — شكراً لك.',
  reportedOn: 'أبلغت به في',
  you: 'أنت',
  team: 'فريق المنتج',
  errRequired: 'أكمل الحقول المطلوبة من فضلك.',
  errGeneric: 'تعذّر إرسال بلاغك الآن — أعد المحاولة بعد قليل.',
  notFoundTitle: 'لم نجد هذا البلاغ',
  notFoundLead: 'تأكّد من الرابط الذي وصلك، أو تواصل مع من أرسله إليك.',
};

const EN = {
  dir: 'ltr', lang: 'en', other: 'العربية', otherCode: 'ar',
  brandLine: 'Expert Vision Consulting',
  formTitle: 'Tell us what you ran into',
  formLead: 'Describe what happened in your own words. It reaches the product team right away. No account needed.',
  kindLabel: 'What would you like to tell us about?',
  titleLabel: 'Short title',
  titlePlaceholder: 'One sentence that sums it up',
  descLabel: 'What happened?',
  descPlaceholder: 'What were you doing, and what happened instead of what you expected?',
  whereLabel: 'Where did this happen?',
  wherePlaceholder: 'The screen or step you were on',
  urgencyLabel: 'How much does this affect your work?',
  nameLabel: 'Your name',
  emailLabel: 'Your email',
  identityOptional: 'Optional — leave blank to report without identifying yourself',
  identityRequired: 'Required so we can reach you with updates',
  identityNone: 'This link accepts reports without identifying yourself.',
  imagesLabel: 'Pictures of what happened',
  imagesHint: 'Up to five — they help the team see what you saw.',
  submit: 'Send',
  sending: 'Sending...',
  doneTitle: 'We got your report',
  doneLead: 'Thank you. Your reference is',
  doneTrack: 'Follow what happens to it here',
  closedTitle: 'This link is no longer accepting reports',
  closedLead: 'If you still want to tell us something, contact whoever sent you the link and ask for one that works.',
  trackTitle: 'Your report',
  trackStatus: 'Where it stands',
  trackThread: 'What happened so far',
  trackEmpty: 'Nothing new yet — we will write here when there is.',
  replyLabel: 'Your answer to the team',
  replyPlaceholder: 'Write what clears it up...',
  replySend: 'Send answer',
  replyDone: 'We got your answer — thank you.',
  reportedOn: 'Reported on',
  you: 'You',
  team: 'Product team',
  errRequired: 'Please fill in the required fields.',
  errGeneric: 'We could not send your report just now — please try again shortly.',
  notFoundTitle: 'We could not find that report',
  notFoundLead: 'Check the link you were sent, or contact whoever sent it to you.',
};

const pick = (lang) => (lang === 'en' ? EN : AR);

// اسم المنتج بلغة الصفحة، وبالعربية إن لم يكن له اسمٌ إنجليزي.
const productName = (p, lang) => (lang === 'en' ? (p?.name_en || p?.name_ar) : p?.name_ar) || '';

// لونٌ من القاعدة لا يدخل ورقة الأنماط إلا بعد أن يُثبَت أنه لون: ستُّ خاناتٍ ست عشرية وحسب.
// وما سواه يسقط إلى أزرق EVC. هذه القيمة تُكتب داخل `<style>` فلا يحميها `esc()` — تُصفّى هنا.
const HEX = /^#[0-9a-fA-F]{6}$/;
const brand = (p) => (HEX.test(String(p?.brand_color || '')) ? p.brand_color : '#244A99');

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#f5f7fb;color:#0f172a;font:15px/1.65 "IBM Plex Sans Arabic",system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:680px;margin:0 auto;padding:1.5rem 1rem 4rem}
.top{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1.25rem}
.marks{display:flex;align-items:center;gap:.85rem;min-width:0}
.marks img{display:block;height:34px;width:auto;max-width:150px}
.sep{width:1px;height:26px;background:#d8dee9;flex:none}
.co{font-size:11px;color:#64748b;line-height:1.3}
.lang{flex:none;border:1px solid #d8dee9;background:#fff;border-radius:8px;padding:.35rem .7rem;font:inherit;font-size:13px;color:#334155;text-decoration:none}
.card{background:#fff;border:1px solid #e6e9f0;border-radius:14px;padding:1.5rem;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.card::before{content:"";display:block;height:4px;border-radius:4px;background:var(--brand);margin:-1.5rem -1.5rem 1.25rem}
h1{margin:0 0 .3rem;font-size:22px;font-weight:800}
.lead{margin:0 0 1.5rem;color:#64748b;font-size:14px}
.intro{margin:0 0 1.25rem;padding:.8rem 1rem;background:#f8fafc;border-radius:10px;font-size:14px;white-space:pre-wrap}
label{display:block;font-weight:700;font-size:14px;margin:1.15rem 0 .4rem}
.hint{font-weight:400;color:#94a3b8;font-size:12px;margin-inline-start:.4rem}
input[type=text],input[type=email],textarea{width:100%;border:1px solid #d8dee9;border-radius:10px;padding:.65rem .8rem;font:inherit;background:#fff;color:inherit}
textarea{min-height:120px;resize:vertical}
input:focus,textarea:focus{outline:2px solid var(--brand);outline-offset:1px;border-color:var(--brand)}
.opts{display:flex;flex-wrap:wrap;gap:.6rem}
.opt{flex:1 1 160px;border:1px solid #d8dee9;border-radius:10px;padding:.7rem .85rem;cursor:pointer;background:#fff;font-size:14px}
.opt input{margin-inline-end:.5rem}
.opt:has(input:checked){border-color:var(--brand);box-shadow:inset 0 0 0 1px var(--brand);background:#f8fafc}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.btn{margin-top:1.75rem;width:100%;border:0;border-radius:10px;background:var(--brand);color:#fff;font:inherit;font-weight:800;font-size:15px;padding:.85rem;cursor:pointer}
.btn[disabled]{opacity:.6;cursor:default}
.msg{margin-top:1rem;padding:.7rem .9rem;border-radius:10px;font-size:14px;display:none}
.msg.bad{display:block;background:#fef2f2;color:#991b1b}
.msg.good{display:block;background:#f0fdf4;color:#166534}
.steps{display:flex;flex-wrap:wrap;gap:.4rem;margin:0 0 1.5rem;padding:0;list-style:none}
.steps li{flex:1 1 auto;font-size:12px;font-weight:700;color:#94a3b8;border-top:3px solid #e6e9f0;padding-top:.45rem}
.steps li.on{color:var(--brand);border-top-color:var(--brand)}
.steps li.now{color:#0f172a;border-top-color:var(--brand)}
.ref{font-weight:800;font-family:ui-monospace,monospace;letter-spacing:.04em}
.meta{color:#64748b;font-size:13px;margin:0 0 1.25rem}
.thread{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.75rem}
.thread li{border:1px solid #e6e9f0;border-radius:10px;padding:.75rem .9rem;background:#fff}
.thread li.mine{background:#f8fafc}
.who{font-weight:700;font-size:12px;color:#64748b;margin-bottom:.25rem}
.body{white-space:pre-wrap;font-size:14px}
.empty{color:#94a3b8;font-size:14px}
h2{font-size:15px;font-weight:800;margin:1.75rem 0 .75rem}
`;

// إطارٌ واحد لكل صفحات هذا الملف: لا نصّ عربي ثابت فيه — كل ما يُعرض يأتي من الجدولين.
function frame({ t, title, brandColor, logoUrl, coName, body, script = '' }) {
  return `<!doctype html><html dir="${t.dir}" lang="${t.lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<link rel="icon" type="image/svg+xml" href="/static/brand/favicon.svg">
<style>:root{--brand:${brandColor}}${CSS}</style></head>
<body><div class="wrap">
<div class="top">
  <div class="marks">
    <img src="/static/brand/logo.svg" alt="${esc(t.brandLine)}">
    ${logoUrl ? `<span class="sep"></span><img src="${esc(logoUrl)}" alt="${esc(coName)}">` : ''}
    <div class="co">${esc(t.brandLine)}</div>
  </div>
  <a class="lang" href="?lang=${t.otherCode}" hreflang="${t.otherCode}">${esc(t.other)}</a>
</div>
${body}
</div>${script}</body></html>`;
}

/**
 * صفحة «لم يعد يستقبل» — واحدةٌ لثلاث حالات: رابطٌ أُوقف، ورابطٌ انتهى أجله، ورابطٌ لا وجود له.
 * ولا يُفرَّق بينها بحرفٍ واحد عمداً: الفرقُ يخبر من يجرّب الروابط أيُّها كان موجوداً يوماً.
 */
export function closedPage({ lang = 'ar' } = {}) {
  const t = pick(lang);
  return frame({
    t, title: t.closedTitle, brandColor: '#244A99', logoUrl: null, coName: '',
    body: `<div class="card"><h1>${esc(t.closedTitle)}</h1><p class="lead">${esc(t.closedLead)}</p></div>`,
  });
}

/** بلاغٌ لا يقابله رقم متابعة — نفس المبدأ: لا تفصيل يميّز الموجود من غيره. */
export function notFoundPage({ lang = 'ar' } = {}) {
  const t = pick(lang);
  return frame({
    t, title: t.notFoundTitle, brandColor: '#244A99', logoUrl: null, coName: '',
    body: `<div class="card"><h1>${esc(t.notFoundTitle)}</h1><p class="lead">${esc(t.notFoundLead)}</p></div>`,
  });
}

// حقول التعريف بالنفس بحسب ما اختاره مدير المنتج للرابط: لا شيء، أو اختياري، أو مطلوب.
function identityFields(t, mode) {
  if (mode === 'anonymous_only') return `<p class="lead" style="margin:1.15rem 0 0">${esc(t.identityNone)}</p>`;
  const req = mode === 'required';
  const note = req ? t.identityRequired : t.identityOptional;
  return `<label for="f-name">${esc(t.nameLabel)}<span class="hint">${esc(note)}</span></label>
<input type="text" id="f-name" name="reporter_name" maxlength="120" ${req ? 'required' : ''}>
<label for="f-email">${esc(t.emailLabel)}</label>
<input type="email" id="f-email" name="reporter_email" maxlength="160" ${req ? 'required' : ''}>`;
}

const radios = (name, map, labeler, checked) => Object.keys(map).map((k) => `<label class="opt">
  <input type="radio" name="${name}" value="${esc(k)}"${k === checked ? ' checked' : ''}>${esc(labeler(k))}</label>`).join('');

/**
 * نموذج الاستقبال. `link.identity_mode` يقود حقول التعريف، و`product` يقود الشعار واللون.
 * والحقل الخفيّ `company_website` فخُّ الآلات: إنسانٌ لا يراه فلا يملؤه.
 */
export function intakePage({ product, link, lang = 'ar', imageLimit = 5 } = {}) {
  const t = pick(lang);
  const name = productName(product, lang);
  const intro = lang === 'en' ? (link?.intro_en || link?.intro_ar) : (link?.intro_ar || link?.intro_en);
  const body = `<div class="card">
<h1>${esc(t.formTitle)}</h1>
<p class="lead">${esc(name)} · ${esc(t.formLead)}</p>
${intro ? `<div class="intro">${esc(intro)}</div>` : ''}
<form id="rf" novalidate>
  <div class="hp" aria-hidden="true"><label>${esc(t.brandLine)}<input type="text" name="company_website" tabindex="-1" autocomplete="off"></label></div>
  <label>${esc(t.kindLabel)}</label>
  <div class="opts">${radios('type', ITEM_TYPE, itemTypeLabel, 'bug')}</div>
  <label for="f-title">${esc(t.titleLabel)}</label>
  <input type="text" id="f-title" name="title" maxlength="200" required placeholder="${esc(t.titlePlaceholder)}">
  <label for="f-desc">${esc(t.descLabel)}</label>
  <textarea id="f-desc" name="description" maxlength="6000" required placeholder="${esc(t.descPlaceholder)}"></textarea>
  <label for="f-where">${esc(t.whereLabel)}</label>
  <input type="text" id="f-where" name="where_text" maxlength="200" placeholder="${esc(t.wherePlaceholder)}">
  <label>${esc(t.urgencyLabel)}</label>
  <div class="opts">${radios('urgency', ITEM_URGENCY, itemUrgencyLabel, 'delays')}</div>
  ${identityFields(t, link?.identity_mode)}
  <label for="f-img">${esc(t.imagesLabel)}<span class="hint">${esc(t.imagesHint)}</span></label>
  <input type="file" id="f-img" accept="image/*" multiple>
  <button type="submit" class="btn" id="rb">${esc(t.submit)}</button>
  <div class="msg" id="rm"></div>
</form></div>`;

  // النصّ البرمجي محليٌّ في الصفحة: لا ملفَّ خارجياً لصفحةٍ يفتحها من ليس موظفاً، ولا حاجة.
  // والنصوص تُمرَّر إليه بياناتٍ مُرمَّزة لا نصاً مُدرَجاً في الشيفرة.
  const words = JSON.stringify({
    sending: t.sending, submit: t.submit, done: t.doneTitle, lead: t.doneLead,
    track: t.doneTrack, required: t.errRequired, generic: t.errGeneric,
  });
  const script = `<script>(function(){
var W=${words},B=document.getElementById('rb'),M=document.getElementById('rm'),F=document.getElementById('rf');
var TOKEN=${JSON.stringify(String(link?.token || ''))},LIMIT=${Number(imageLimit) || 5};
function bad(m){M.className='msg bad';M.textContent=m;B.disabled=false;B.textContent=W.submit;}
F.addEventListener('submit',async function(e){
  e.preventDefault();
  var d=new FormData(F),p={};d.forEach(function(v,k){p[k]=v;});
  if(!String(p.title||'').trim()||!String(p.description||'').trim())return bad(W.required);
  B.disabled=true;B.textContent=W.sending;M.className='msg';
  try{
    var r=await fetch('/p/'+encodeURIComponent(TOKEN)+'/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});
    var j=await r.json().catch(function(){return {};});
    if(!r.ok)return bad(j.error||W.generic);
    var files=Array.prototype.slice.call(document.getElementById('f-img').files||[],0,LIMIT);
    for(var i=0;i<files.length;i++){
      try{await fetch('/p/'+encodeURIComponent(TOKEN)+'/image/'+encodeURIComponent(j.ticket),
        {method:'POST',headers:{'content-type':files[i].type||'application/octet-stream'},body:files[i]});}catch(_){}
    }
    F.style.display='none';
    var h=document.createElement('div');
    h.innerHTML='<h1></h1><p class="lead"></p><p><a></a></p>';
    h.querySelector('h1').textContent=W.done;
    h.querySelector('.lead').textContent=W.lead+' ';
    var s=document.createElement('span');s.className='ref';s.textContent=j.item_key||'';
    h.querySelector('.lead').appendChild(s);
    var a=h.querySelector('a');a.textContent=W.track;a.href=j.tracking_url||'#';
    F.parentNode.appendChild(h);
    F.parentNode.querySelector('h1').style.display='none';
    F.parentNode.querySelector('.lead').style.display='none';
  }catch(_){bad(W.generic);}
});})();</script>`;

  return frame({ t, title: `${t.formTitle} · ${name}`, brandColor: brand(product), logoUrl: product?.logo_url, coName: name, body, script });
}

// ترتيب المحطّات كما يراها من أبلغ — لا كل الحالات: «مكرر» و«بحاجة لتوضيح» ليستا محطّةً في
// طريق، والمرفوض يقف عند محطّته الأخيرة. الترجمة كلها من `labels.js`.
const STEPS = ['NEW', 'TRIAGED', 'APPROVED', 'IN_PROGRESS', 'RESOLVED'];
const STEP_OF = { NEW: 0, NEEDS_INFO: 0, TRIAGED: 1, AWAITING_APPROVAL: 1, DUPLICATE: 1, APPROVED: 2, DECLINED: 2, IN_PROGRESS: 3, RESOLVED: 4 };

/**
 * صفحة المتابعة. `comments` تصل **مصفّاةً من الخادم** على ما يقرؤه من أبلغ — لا تصفية هنا:
 * ما لا يُرسَل لا يُعرض، وما يُرسَل يُعرض. وضعُ التصفية في العرض يجعل تسريبَ تعليقٍ داخلي
 * خطأً مطبعياً واحداً.
 */
export function trackingPage({ product, item, comments = [], lang = 'ar', replySent = false } = {}) {
  const t = pick(lang);
  const name = productName(product, lang);
  const at = STEP_OF[item?.status] ?? 0;
  const canReply = item?.status === 'NEEDS_INFO';
  const steps = STEPS.map((s, i) => `<li class="${i < at ? 'on' : ''}${i === at ? ' now' : ''}">${esc(itemStatusLabel(s))}</li>`).join('');
  const thread = comments.length
    ? `<ul class="thread">${comments.map((c) => `<li class="${c.from_reporter ? 'mine' : ''}">
        <div class="who">${esc(c.from_reporter ? t.you : t.team)} · ${esc(String(c.created_at || '').slice(0, 10))}</div>
        <div class="body">${esc(c.body)}</div></li>`).join('')}</ul>`
    : `<p class="empty">${esc(t.trackEmpty)}</p>`;

  const replyBox = canReply ? `<h2>${esc(t.replyLabel)}</h2>
<form id="qf">
  <textarea id="qb" name="body" maxlength="4000" required placeholder="${esc(t.replyPlaceholder)}"></textarea>
  <button type="submit" class="btn" id="qbtn">${esc(t.replySend)}</button>
  <div class="msg" id="qm">${replySent ? esc(t.replyDone) : ''}</div>
</form>` : '';

  const body = `<div class="card">
<h1>${esc(t.trackTitle)}</h1>
<p class="meta"><span class="ref">${esc(item?.item_key || '')}</span> · ${esc(name)} · ${esc(t.reportedOn)} ${esc(String(item?.created_at || '').slice(0, 10))}</p>
<h2>${esc(t.trackStatus)}</h2>
<ul class="steps">${steps}</ul>
<div class="intro"><strong>${esc(item?.title || '')}</strong>
${esc(itemTypeLabel(item?.type))} · ${esc(itemUrgencyLabel(item?.urgency))} · ${esc(itemStatusLabel(item?.status))}</div>
<h2>${esc(t.trackThread)}</h2>
${thread}
${replyBox}
</div>`;

  const script = canReply ? `<script>(function(){
var W=${JSON.stringify({ sending: t.sending, send: t.replySend, done: t.replyDone, generic: t.errGeneric, required: t.errRequired })};
var TR=${JSON.stringify(String(item?.tracking_token || ''))};
var F=document.getElementById('qf'),B=document.getElementById('qbtn'),M=document.getElementById('qm'),T=document.getElementById('qb');
F.addEventListener('submit',async function(e){
  e.preventDefault();
  if(!String(T.value||'').trim()){M.className='msg bad';M.textContent=W.required;return;}
  B.disabled=true;B.textContent=W.sending;
  try{
    var r=await fetch('/p/t/'+encodeURIComponent(TR)+'/reply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:T.value})});
    if(!r.ok)throw 0;
    M.className='msg good';M.textContent=W.done;T.value='';B.style.display='none';
  }catch(_){M.className='msg bad';M.textContent=W.generic;B.disabled=false;B.textContent=W.send;}
});})();</script>` : '';

  return frame({ t, title: `${t.trackTitle} · ${item?.item_key || ''}`, brandColor: brand(product), logoUrl: product?.logo_url, coName: name, body, script });
}
