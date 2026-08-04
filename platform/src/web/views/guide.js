// صفحة «دليلي» — دليل الاستخدام الشخصي لكل موظف: من أنت في المنصة، وما شاشاتك بالترتيب،
// وماذا تفعل في كل شاشة أول مرة وكل أسبوع، وما مصطلحاتك، وما خارج نطاقك.
//
// مبدآن يحكمان هذه الصفحة:
//   ١) تُقرأ كاملة بلا جافاسكربت. كل الدليل يُبنى على الخادم؛ لا شيء يُجلب بعد فتح الصفحة.
//   ٢) لا إخفاء في المتصفح. الخدمة تُرجع ما يراه هذا المستخدم فعلاً (نفس بوابة الصلاحيات التي
//      تسمح أو تمنع كل شاشة)، فنعرض ما نستلمه كما هو — بلا ترشيح ولا تجميل.
//
// المحتوى كله من خدمة الدليل (src/modules/guide/guide.js) — الصفحة لا تكتب سطر إرشاد واحداً
// بنفسها ولا تُرشّح ما يصلها: الخدمة تمرّ بالمحتوى من بوابة الصلاحيات نفسها التي تسمح بفتح كل
// شاشة أو ترفضها. وإن تعذّرت القراءة تُعرض حالة مصمَّمة برسالة الخدمة العربية — لا محتوى مختلق.
import { layout } from '../layout.js';
import { icon } from '../icons.js';
import { esc } from './_shared.js';
import { guideFor } from '../../modules/guide/guide.js';

const isArabic = (s) => typeof s === 'string' && /[؀-ۿ]/.test(s);
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);

async function loadGuide(user) {
  try {
    const data = await guideFor(user);
    if (!data || !Array.isArray(data.pages)) return { state: 'error' };
    return { state: 'ok', data };
  } catch (e) {
    // رسالة الخدمة تُعرض حرفياً متى كانت عربية موجّهة للمستخدم؛ وغيرها لا يُعرض أبداً.
    return { state: 'error', msg: isArabic(e && e.message) ? e.message : null };
  }
}

// ── مساعدات العرض ────────────────────────────────────────────────────────────
// تمييز العدد في العربية: مفرد، مثنى، جمع قِلّة (٣–١٠)، ثم مفرد منصوب (١١ فأكثر).
const noun = (n, { one, two, few, many }) => {
  const v = Number(n) || 0;
  if (v === 1) return one;
  if (v === 2) return two;
  const r = v % 100;
  return r >= 3 && r <= 10 ? few : many;
};
const SCREEN = { one: 'شاشة واحدة', two: 'شاشتان', few: 'شاشات', many: 'شاشة' };
const TERM = { one: 'مصطلح واحد', two: 'مصطلحان', few: 'مصطلحات', many: 'مصطلحاً' };
// «٧ شاشات» — الرقم في خانة الأرقام الموحّدة، والمفرد والمثنى بلا رقم (كما تُقال بالعربية).
const countPhrase = (n, forms) => {
  const v = Number(n) || 0;
  const word = noun(v, forms);
  return v === 1 || v === 2 ? esc(word) : `<span class="tnum">${v}</span> ${esc(word)}`;
};
// مفتاح شاشة صالح للرابط فقط؛ أي قيمة أخرى لا تتحول إلى زر يقود إلى لا شيء.
const isPageKey = (k) => typeof k === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/i.test(k);
const para = (s) => esc(s).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');

// ── الحالات المصمَّمة ────────────────────────────────────────────────────────
function stateCard(ic, title, msg, action) {
  return `<div class="card"><div class="empty-state">${icon(ic)}
    <div class="t">${esc(title)}</div>
    <div class="s">${esc(msg)}</div>
    ${action || ''}</div></div>`;
}
const backToTasks = '<a class="btn btn-sm" href="/app/tasks">العودة إلى مهامي</a>';

// ── أقسام الصفحة ─────────────────────────────────────────────────────────────
function heroCard(g) {
  const roleName = (g.role && g.role.name_ar) || 'دورك في المنصة';
  const pages = Array.isArray(g.pages) ? g.pages : [];
  const terms = Array.isArray(g.glossary) ? g.glossary : [];
  return `<section class="card gd-hero">
    <div class="gd-hero-tx">
      <div class="gd-cap">دورك في المنصة</div>
      <h2 class="gd-role">${esc(roleName)}</h2>
      ${g.intro_ar ? `<p class="gd-intro">${para(g.intro_ar)}</p>` : ''}
      <div class="gd-chips">
        <span class="gd-chip">${countPhrase(pages.length, SCREEN)} لك</span>
        ${terms.length ? `<span class="gd-chip">${countPhrase(terms.length, TERM)} في هذه الصفحة</span>` : ''}
      </div>
    </div>
    <div class="gd-hero-note">
      <div class="gd-note-h">جولة على الشاشة نفسها</div>
      <div class="gd-note-s">زر «جولة إرشادية» أعلى كل شاشة يشرحها عليها خطوة بخطوة، ويمكنك إنهاؤه في أي لحظة.</div>
    </div>
  </section>`;
}

function screenCard(p, i) {
  const key = p && p.key;
  const linkable = isPageKey(key);
  const href = linkable ? '/app/' + encodeURIComponent(key) : '';
  const steps = list(p.first_steps_ar);
  const weekly = list(p.weekly_ar);
  const cols = [
    steps.length ? `<div class="gd-col">
      <div class="gd-col-h">أول خطواتك</div>
      <ol class="gd-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </div>` : '',
    weekly.length ? `<div class="gd-col">
      <div class="gd-col-h">عادتك الأسبوعية</div>
      <ul class="gd-weekly">${weekly.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    </div>` : '',
  ].join('');
  const body = cols
    ? `<div class="gd-cols">${cols}</div>`
    : '<div class="gd-none">لم تُسجَّل خطوات لهذه الشاشة بعد — افتحها وستجد شرح كل جزء داخل الجولة.</div>';
  const watch = typeof p.watch_out_ar === 'string' && p.watch_out_ar.trim()
    ? `<div class="alert warn gd-watch">${icon('risk')}<div><b>انتبه</b> — ${esc(p.watch_out_ar)}</div></div>` : '';
  const acts = linkable ? `<div class="gd-acts">
      <a class="btn btn-sm" href="${esc(href)}">افتح الشاشة</a>
      <a class="btn btn-primary btn-sm" href="${esc(href)}?tour=1">ابدأ الجولة</a>
    </div>` : '';
  return `<article class="card card-h gd-card" id="g-${esc(linkable ? key : 'p' + (i + 1))}">
    <header class="gd-card-h">
      <span class="gd-num tnum">${i + 1}</span>
      <div class="gd-card-tx">
        <h3 class="gd-name">${esc(p.nav_ar || 'شاشة بلا اسم')}</h3>
        ${p.purpose_ar ? `<p class="gd-purpose">${para(p.purpose_ar)}</p>` : ''}
      </div>
      ${acts}
    </header>
    <div class="gd-card-b">${body}${watch}</div>
  </article>`;
}

function screensSection(pages) {
  if (!pages.length) {
    return `<section class="gd-sec">
      <div class="gd-sec-h"><h2 class="gd-sec-t">شاشاتك</h2></div>
      ${stateCard('list', 'لم تُفتح لك شاشات بعد',
    'حسابك لا يشمل أي شاشة حتى الآن. اطلب من مدير النظام تفعيل ما يخص عملك، وسيظهر دليله هنا مباشرة.',
    backToTasks)}
    </section>`;
  }
  const index = pages.length > 2 ? `<div class="gd-index">
    <span class="gd-index-l">اقفز إلى:</span>
    ${pages.map((p, i) => `<a class="chip gd-jump" href="#g-${esc(isPageKey(p.key) ? p.key : 'p' + (i + 1))}">${esc(p.nav_ar || 'شاشة')}</a>`).join('')}
  </div>` : '';
  return `<section class="gd-sec">
    <div class="gd-sec-h">
      <h2 class="gd-sec-t">شاشاتك بالترتيب</h2>
      <span class="gd-sec-s">من أول ما تفتحه في يومك إلى آخر ما تُغلقه</span>
    </div>
    ${index}
    <div class="gd-cards">${pages.map(screenCard).join('')}</div>
  </section>`;
}

function glossarySection(terms) {
  const rows = (Array.isArray(terms) ? terms : []).filter((t) => t && t.term_ar);
  if (!rows.length) return '';
  return `<section class="gd-sec">
    <div class="gd-sec-h">
      <h2 class="gd-sec-t">مصطلحاتك</h2>
      <span class="gd-sec-s">ما تعنيه الكلمات التي تراها على شاشاتك</span>
    </div>
    <div class="card gd-terms">
      <dl class="gd-dl">${rows.map((t) => `
        <div class="gd-term">
          <dt>${esc(t.term_ar)}</dt>
          <dd>${esc(t.meaning_ar || 'لم يُسجَّل شرح لهذا المصطلح بعد.')}</dd>
        </div>`).join('')}</dl>
    </div>
  </section>`;
}

function limitsSection(limits) {
  const rows = list(limits);
  if (!rows.length) return '';
  return `<section class="gd-sec">
    <div class="gd-sec-h">
      <h2 class="gd-sec-t">خارج نطاقك</h2>
      <span class="gd-sec-s">أعمال يملكها زملاء آخرون — لا تظهر لك ولا تُطالَب بها</span>
    </div>
    <div class="card gd-limits">
      <ul class="gd-limit-list">${rows.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="gd-limit-f">إن احتجت أحد هذه الأعمال في مهمة قادمة، اطلب تفعيله من مدير النظام.</div>
    </div>
  </section>`;
}

// ── سيناريوهات العمل ─────────────────────────────────────────────────────────
// تُعرض **قبل** كتالوج الشاشات عمداً: القارئ يتعلّم بالمشي في قصة لا بتصفّح قائمة شاشات.
// وكل سيناريو ثلاثة أجزاء — متى يقع، وماذا تفعل، وما الأثر — لأن دليلاً بلا أثرٍ معلن لا
// يعرف قارئه متى نجح. ولا يُعرض القسم أصلاً لدورٍ بلا سيناريوهات: عنوانٌ فوق فراغ أسوأ من غيابه.
function scenariosSection(list) {
  const items = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!items.length) return '';
  return `<section class="gd-sec">
    <div class="gd-sec-h">
      <h2 class="gd-sec-t">سيناريوهات عملك</h2>
      <span class="gd-sec-s">امشِ فيها على المنصة نفسها — كلٌّ منها ينتهي بأثرٍ تراه</span>
    </div>
    <div class="gd-scn-list">${items.map((s, i) => `<article class="gd-scn">
      <div class="gd-scn-h">
        <span class="gd-scn-n tnum">${i + 1}</span>
        <div style="min-width:0">
          <h3 class="gd-scn-t">${esc(s.title_ar || '')}</h3>
          ${s.when_ar ? `<div class="gd-scn-w">${esc(s.when_ar)}</div>` : ''}
        </div>
      </div>
      <ol class="gd-scn-steps">${(s.steps_ar || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      ${s.outcome_ar ? `<div class="gd-scn-out"><span class="gd-scn-out-l">الأثر</span> ${esc(s.outcome_ar)}</div>` : ''}
    </article>`).join('')}</div>
  </section>`;
}

// ── الصفحة ───────────────────────────────────────────────────────────────────
// جسم الدليل مبني من الحمولة وحدها (بلا قاعدة بيانات ولا وقت) — لذا يُختبر مباشرة.
export function guideManual(g) {
  const pages = Array.isArray(g && g.pages) ? g.pages.filter(Boolean) : [];
  return `<div class="gd-wrap">
    ${heroCard(g || {})}
    ${scenariosSection(g && g.scenarios)}
    ${screensSection(pages)}
    ${glossarySection(g && g.glossary)}
    ${limitsSection(g && g.limits_ar)}
    <p class="gd-foot">هذا الدليل يتبع صلاحياتك: ما لا تجده هنا لا يظهر لك في المنصة أصلاً.</p>
  </div>`;
}

export async function guidePage(user, opts = {}) {
  const year = Number(opts.year) || undefined;
  const res = await loadGuide(user);

  let body;
  let subtitle = 'شاشاتك، وخطواتك الأولى، وعادتك الأسبوعية';
  if (res.state === 'ok') {
    body = `<style>${PAGE_CSS}</style>${guideManual(res.data)}`;
    const roleName = res.data.role && res.data.role.name_ar;
    if (roleName) subtitle = `${roleName} · شاشاتك وخطواتك الأولى`;
  } else {
    body = `<style>${PAGE_CSS}</style><div class="gd-wrap">${stateCard('risk', 'تعذّر فتح دليلك الآن',
      res.msg || 'أعد تحميل الصفحة بعد قليل، وإن تكرّر الأمر أبلغ مدير النظام.',
      `<a class="btn btn-sm" href="/app/guide">أعد المحاولة</a> ${backToTasks}`)}</div>`;
  }

  return layout({ user, active: 'guide', title: 'دليلي', subtitle, body, year });
}

// ── التنسيق ──────────────────────────────────────────────────────────────────
const PAGE_CSS = `
.gd-wrap{font-size:13px;max-width:1080px}
.gd-sec{margin-top:1.5rem}
.gd-sec-h{display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap;margin:0 .1rem .6rem}
.gd-sec-t{font-size:var(--fs-title);font-weight:800;color:var(--ink2)}
.gd-sec-s{font-size:var(--fs-meta);color:var(--muted)}
.gd-scn-list{display:flex;flex-direction:column;gap:.7rem}
.gd-scn{background:#fff;border:1px solid var(--line);border-radius:14px;padding:.85rem 1rem}
.gd-scn-h{display:flex;align-items:flex-start;gap:.6rem}
.gd-scn-n{flex:none;width:24px;height:24px;border-radius:8px;display:grid;place-items:center;
  font-weight:800;font-size:12px;color:#fff;background:var(--brand-grad)}
.gd-scn-t{font-size:13.5px;font-weight:800;color:var(--ink2)}
.gd-scn-w{font-size:var(--fs-micro);color:var(--muted);margin-top:.1rem}
.gd-scn-steps{margin:.6rem 0 0;padding-inline-start:1.5rem;display:flex;flex-direction:column;gap:.35rem}
.gd-scn-steps li{font-size:var(--fs-body);color:var(--ink2);line-height:1.9}
.gd-scn-out{margin-top:.6rem;padding-top:.5rem;border-top:1px dashed var(--line);
  font-size:var(--fs-meta);color:var(--muted);line-height:1.8}
.gd-scn-out-l{font-weight:800;color:var(--green)}

/* بطاقة الهوية */
.gd-hero{display:flex;gap:1.2rem;align-items:stretch;padding:1.05rem 1.15rem;border-inline-start:3px solid var(--brand)}
.gd-hero-tx{flex:1 1 320px;min-width:0}
.gd-cap{font-size:var(--fs-micro);font-weight:800;letter-spacing:.05em;color:var(--muted)}
.gd-role{font-size:1.35rem;font-weight:800;letter-spacing:-.02em;color:var(--ink2);margin:.1rem 0 .35rem}
.gd-intro{margin:0;font-size:var(--fs-ui);color:var(--ink2);line-height:1.9;max-width:62ch}
.gd-chips{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.7rem}
.gd-chip{font-size:var(--fs-meta);font-weight:700;color:var(--muted);background:var(--bg);
  border:1px solid var(--line);border-radius:999px;padding:.2rem .7rem}
.gd-hero-note{flex:0 1 240px;align-self:center;border-inline-start:1px solid var(--line);padding-inline-start:1rem}
.gd-note-h{font-size:var(--fs-body);font-weight:800;color:var(--ink2)}
.gd-note-s{font-size:var(--fs-meta);color:var(--muted);line-height:1.8;margin-top:.15rem}

/* فهرس الشاشات */
.gd-index{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;margin-bottom:.85rem}
.gd-index-l{font-size:var(--fs-meta);font-weight:800;color:var(--muted)}
.gd-jump{font-size:var(--fs-meta);padding:.28rem .65rem}

/* بطاقة شاشة */
.gd-cards{display:flex;flex-direction:column;gap:.75rem}
.gd-card{overflow:hidden;scroll-margin-top:1rem}
.gd-card-h{display:flex;align-items:flex-start;gap:.75rem;padding:.85rem 1rem;border-bottom:1px solid var(--line);flex-wrap:wrap}
.gd-num{flex:0 0 auto;width:26px;height:26px;border-radius:8px;background:var(--brand-grad);color:#fff;
  display:flex;align-items:center;justify-content:center;font-size:var(--fs-body);font-weight:800}
.gd-card-tx{flex:1 1 260px;min-width:0}
.gd-name{font-size:var(--fs-title);font-weight:800;color:var(--ink2)}
.gd-purpose{margin:.15rem 0 0;font-size:var(--fs-body);color:var(--muted);line-height:1.8;max-width:70ch}
.gd-acts{flex:0 0 auto;display:flex;gap:.4rem;align-items:center;flex-wrap:wrap}
.gd-card-b{padding:.85rem 1rem}
.gd-cols{display:grid;grid-template-columns:1fr 1fr;gap:.9rem 1.4rem}
.gd-col-h{font-size:var(--fs-meta);font-weight:800;color:var(--muted);margin-bottom:.35rem}
.gd-steps,.gd-weekly{margin:0;padding-inline-start:1.2rem;display:flex;flex-direction:column;gap:.3rem}
.gd-steps li,.gd-weekly li{font-size:var(--fs-body);color:var(--ink2);line-height:1.85}
.gd-steps li::marker{font-variant-numeric:tabular-nums;font-weight:800;color:var(--brand)}
.gd-weekly{list-style:none;padding-inline-start:0}
.gd-weekly li{position:relative;padding-inline-start:.95rem}
.gd-weekly li::before{content:"";position:absolute;inset-inline-start:0;top:.62em;width:6px;height:6px;
  border-radius:50%;background:var(--brand2)}
.gd-none{font-size:var(--fs-body);color:var(--faint);line-height:1.8}
.gd-watch{margin-top:.85rem;align-items:flex-start}
.gd-watch svg{flex:0 0 auto;margin-top:.15rem}
.gd-watch b{font-weight:800}

/* المصطلحات */
.gd-terms{padding:.35rem 1rem}
.gd-dl{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:0 1.6rem}
.gd-term{padding:.6rem 0;border-bottom:1px dashed var(--line)}
.gd-term dt{font-size:var(--fs-body);font-weight:800;color:var(--ink2)}
.gd-term dd{margin:.1rem 0 0;font-size:var(--fs-body);color:var(--muted);line-height:1.8}

/* خارج النطاق */
.gd-limits{padding:.9rem 1rem}
.gd-limit-list{margin:0;padding-inline-start:1.1rem;display:flex;flex-direction:column;gap:.35rem}
.gd-limit-list li{font-size:var(--fs-body);color:var(--ink2);line-height:1.8}
.gd-limit-list li::marker{color:var(--faint)}
.gd-limit-f{margin-top:.7rem;padding-top:.6rem;border-top:1px dashed var(--line);font-size:var(--fs-meta);color:var(--muted)}

.gd-foot{margin:1.4rem .1rem 0;font-size:var(--fs-meta);color:var(--faint)}

@media(max-width:760px){
  .gd-hero{flex-direction:column;gap:.85rem}
  .gd-hero-note{border-inline-start:none;padding-inline-start:0;border-top:1px dashed var(--line);padding-top:.7rem;flex-basis:auto}
  .gd-dl{grid-template-columns:1fr}
}
@media(max-width:640px){
  .gd-cols{grid-template-columns:1fr}
  .gd-role{font-size:1.15rem}
  .gd-acts{width:100%}
  .gd-acts .btn{flex:1 1 0;justify-content:center}
}`;
