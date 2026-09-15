// ══ شاشة «ملاحظاتي» — دفتر الشخص داخل المنصة ══════════════════════════════════════════════
//
// «وأضيف مكان الواحد يكتب فيه النوت ويكون بشكل جميل، والنوت يكون بناءً على اليوم أو يكون في
// قائمة يكتب موضوع ويكتب فيه نوت وكذا» — بلسان المالك.
//
// ── لماذا شاشةٌ كاملة لا بطاقةٌ تحت قائمة المهام ──────────────────────────────────────────
// «احسه مره زحمه» — حكمُ المالك على صفحة المهام نفسها، وقد قُلّصت الإضافة والمرشّحات خلف أزرار
// بسببه. فبطاقةُ كتابةٍ تُضاف أسفل قائمةٍ طويلة تعني أن يُمرَّر الناس فوق كل عملهم كي يكتبوا
// سطراً، وأن يكون أضيقَ ما في الشاشة هو المكان الذي طُلب أن يكون «بشكل جميل».
// فالعدسة الثالثة (`/app/tasks?who=notes`) تجاور «مهامي» و«مهام فريقي» في الشريط نفسه: نقرةٌ
// واحدة من المهام إليها ونقرةٌ للعودة، وصفحةٌ كاملة للكتابة والقراءة.
//
// ── الخصوصية ─────────────────────────────────────────────────────────────────────────────
// لا بوابةَ منحٍ على هذه الشاشة ولا في سياسة الصفحات، وذلك **عمداً وبالحجّة نفسها المكتوبة
// لصفحة «صفحتي»**: كل ما فيها مقيَّد بمعرّف صاحبها في الاستعلام (`myNotes` لا تقرأ إلا
// `user_id = صاحب الطلب`). واشتراطُ منحٍ هنا يكون منعاً للموظف من قراءة ما كتب بيده.
import { layout } from '../layout.js';
import { icon } from '../icons.js';
import { myNotes } from '../../modules/pmo/notes.js';
import { teamTasksAccess } from '../../modules/pmo/tasks.js';
import { G } from '../i18n/glossary.js';
import { esc, workLens, WORK_LENS_CSS } from './_shared.js';
import { weekdayLabel } from '../i18n/glossary.js';
import { MONTHS_AR } from '../../core/i18n/time.js';
import { countAr } from '../../core/i18n/plural.js';

// اسم اليوم كما يُقال لا كما يُخزَّن: «اليوم» و«أمس» ثم اسم اليوم وتاريخه. التاريخ الخام
// وحده يجعل القارئ يحسب في رأسه أين هو من الأسبوع في كل عنوان مجموعة.
function dayHeading(iso, today) {
  if (!iso) return 'بلا يوم محدَّد';
  if (iso === today) return 'اليوم';
  const t = Date.parse(today + 'T00:00:00Z');
  const d = Date.parse(iso + 'T00:00:00Z');
  if (Number.isFinite(t) && Number.isFinite(d) && Math.round((t - d) / 86400000) === 1) return 'أمس';
  const dt = new Date(iso + 'T00:00:00Z');
  if (!Number.isFinite(dt.getTime())) return esc(iso);
  return `${weekdayLabel(dt.getUTCDay())} <span class="tnum">${dt.getUTCDate()}</span> ${MONTHS_AR[dt.getUTCMonth()]} <span class="tnum">${dt.getUTCFullYear()}</span>`;
}

// مقتطفٌ من نصّ الملاحظة يُعرض حين تُطوى — أول سطرين لا أول ١٨٠ حرفاً، فالقصّ في منتصف
// الكلمة يُقرأ عطلاً لا اختصاراً. والطيّ بالأنماط لا بالقصّ، فالنصّ كامل في الصفحة دائماً.
export async function notesPage(user, opts = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const q = String(opts.q || '').trim().slice(0, 80);
  const notes = await myNotes(user, { q });
  const canTeam = teamTasksAccess(user).canRead;

  const href = (over = {}) => {
    const p = new URLSearchParams({ who: 'notes' });
    const cur = { q: q || null, ...over };
    for (const [k, v] of Object.entries(cur)) if (v != null && v !== '') p.set(k, String(v));
    return '/app/tasks?' + p.toString();
  };
  const lensHref = (key) => (key === 'notes' ? href() : key === 'team' ? '/app/tasks?who=team' : '/app/tasks');
  const lens = workLens({ userId: user.id, who: 'notes', canTeam, openCount: notes.length, href: lensHref });

  // بيانات الملاحظة تُحمَل على البطاقة نفسها فيقرأها المحرِّر منها — لا استدعاء ثانٍ لقراءة
  // ما هو معروض أمام القارئ أصلاً.
  const noteCard = (n) => {
    const pinned = Number(n.pinned) === 1;
    const edited = n.updated_at && String(n.updated_at).slice(0, 10) !== String(n.created_at).slice(0, 10);
    return `<article class="nt${pinned ? ' on' : ''}" data-note="${esc(n.id)}"
      data-subject="${esc(n.subject)}" data-body="${esc(n.body || '')}"
      data-day="${esc(String(n.note_date || '').slice(0, 10))}" data-pinned="${pinned ? '1' : '0'}">
      <div class="nt-h">
        <h3 class="nt-s">${pinned ? '<span class="nt-pin" aria-hidden="true">◆</span>' : ''}${esc(n.subject)}</h3>
        <div class="nt-acts">
          <button type="button" class="nt-a" data-action="note-pin" aria-label="${pinned ? G.unpinNote : G.pinNote}" title="${pinned ? G.unpinNote : G.pinNote}">${pinned ? '◆' : '◇'}</button>
          <button type="button" class="nt-a" data-action="note-edit" aria-label="${G.noteEdit} الملاحظة" title="${G.noteEdit}">${icon('edit')}</button>
          <button type="button" class="nt-a nt-a-x" data-action="note-del" aria-label="${G.noteDelete} الملاحظة" title="${G.noteDelete}">✕</button>
        </div>
      </div>
      ${n.body ? `<div class="nt-b">${esc(n.body)}</div>` : '<div class="nt-b nt-b-none">بلا نصّ — الموضوع وحده</div>'}
      ${edited ? `<div class="nt-f">عُدِّلت <span class="tnum">${esc(String(n.updated_at).slice(0, 10))}</span></div>` : ''}
    </article>`;
  };

  // المثبَّتة أولاً في كتلة واحدة، ثم البقية مجمَّعةً بأيامها — وهذا هو «النوت بناءً على
  // اليوم» الذي طلبه المالك، مأخوذاً من العمود نفسه بلا نموذجٍ ثانٍ ولا جدولٍ ثانٍ.
  const pinned = notes.filter((n) => Number(n.pinned) === 1);
  const rest = notes.filter((n) => Number(n.pinned) !== 1);
  const groups = new Map();
  for (const n of rest) {
    const day = String(n.note_date || n.created_at || '').slice(0, 10) || '';
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(n);
  }
  const dayBlocks = [...groups.entries()].map(([day, items]) => `<section class="nt-day">
    <div class="nt-day-h"><span class="nt-day-t">${dayHeading(day, today)}</span>
      <span class="nt-day-n tnum">${items.length}</span></div>
    <div class="nt-grid">${items.map(noteCard).join('')}</div>
  </section>`).join('');

  const pinnedBlock = pinned.length ? `<section class="nt-day">
    <div class="nt-day-h"><span class="nt-day-t">${G.pinnedNotes}</span>
      <span class="nt-day-n tnum">${pinned.length}</span>
      <span class="nt-day-s">تبقى في الأعلى مهما كتبتَ بعدها</span></div>
    <div class="nt-grid">${pinned.map(noteCard).join('')}</div>
  </section>` : '';

  const empty = q
    ? `<div class="card"><div class="empty-state">${icon('search')}
        <div class="t">لا ملاحظة تطابق بحثك</div>
        <div class="s">جرّب كلمة أخرى من الموضوع أو من نصّ الملاحظة.</div>
        <a class="btn" href="${href({ q: null })}">إظهار الكل</a></div></div>`
    : `<div class="card"><div class="empty-state">${icon('edit')}
        <div class="t">دفترك فارغ بعد</div>
        <div class="s">اكتب موضوعاً ونصّاً — خلاصة اجتماع، قرار تحتاج تذكّره، أو ما ستقوله غداً.
          ما تكتبه هنا يبقى لك وحدك ولا يظهر لأحد في المنصة.</div></div></div>`;

  const composer = `<details class="card nt-add" id="nt-add"${notes.length ? '' : ' open'}>
    <summary class="nt-add-sum">${icon('plus')} ${G.newNote}</summary>
    <div class="nt-add-b">
      <input id="nn-subject" class="input" maxlength="120" placeholder="الموضوع — كلمتان تكفيان لتجدها بعد شهر" aria-label="${G.noteSubject}">
      <textarea id="nn-body" class="input nt-ta" rows="5" maxlength="8000" placeholder="اكتب ملاحظتك هنا…" aria-label="${G.noteBody}"></textarea>
      <div class="nt-add-f">
        <label class="nt-day-pick">${G.noteDay}
          <input id="nn-day" type="date" class="input" dir="ltr" value="${esc(today)}" aria-label="${G.noteDay}">
        </label>
        <button class="btn btn-primary" data-action="note-add">${G.add}</button>
        <span class="nt-hint">تُحفظ لك وحدك — لا يقرؤها مديرك ولا مدير النظام في أي شاشة.</span>
      </div>
    </div>
  </details>`;

  const searchForm = `<form method="get" action="/app/tasks" class="nt-search">
    <input type="hidden" name="who" value="notes">
    <div class="search">${icon('search')}<input class="input" type="search" name="q" value="${esc(q)}" placeholder="ابحث في مواضيع ملاحظاتك ونصوصها…" aria-label="بحث في الملاحظات"></div>
    <button class="btn btn-sm" type="submit">${G.search}</button>
    ${q ? `<a class="btn btn-sm" href="${href({ q: null })}">إظهار الكل</a>` : ''}
  </form>`;

  const editorTpl = `<template id="nt-editor">
    <div class="drawer-head">
      <div style="flex:1;min-width:0"><div style="font-size:11px;color:var(--muted);font-weight:700">${G.myNotes}</div>
        <h3 style="font-size:16px;margin-top:.2rem">${G.noteEdit}</h3></div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="note-close" aria-label="إغلاق">✕</button>
    </div>
    <div class="drawer-body">
      <div class="field"><label for="ne-subject">${G.noteSubject}</label>
        <input id="ne-subject" class="input" maxlength="120" data-f="subject"></div>
      <div class="field"><label for="ne-body">${G.noteBody}</label>
        <textarea id="ne-body" class="input nt-ta" rows="12" maxlength="8000" data-f="body"></textarea></div>
      <div class="field"><label for="ne-day">${G.noteDay}</label>
        <input id="ne-day" type="date" class="input" dir="ltr" data-f="day"></div>
      <div class="nt-err" data-f="error" hidden></div>
    </div>
    <div class="drawer-foot">
      <button type="button" class="btn btn-primary" data-action="note-save">${G.save}</button>
      <button type="button" class="btn" data-action="note-close">${G.cancel}</button>
    </div>
  </template>`;

  const styles = `<style>
    ${WORK_LENS_CSS}
    .nt-top{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.7rem}
    .nt-search{display:flex;gap:.4rem;align-items:center;margin-inline-start:auto}
    .nt-search .search input{min-width:210px}
    .nt-add{padding:0;margin-bottom:1rem}
    .nt-add[open]{padding:.8rem .95rem}
    .nt-add-sum{cursor:pointer;list-style:none;padding:.6rem .9rem;font-size:12.5px;font-weight:800;
      color:var(--brand);display:flex;align-items:center;gap:.4rem}
    .nt-add-sum::-webkit-details-marker{display:none}
    .nt-add-sum:hover{background:#f7f9fd}
    .nt-add[open] .nt-add-sum{padding:0 0 .5rem;color:var(--ink2)}
    .nt-add-sum:focus-visible{outline:2px solid var(--brand);outline-offset:-2px;border-radius:12px}
    .nt-add-b{display:flex;flex-direction:column;gap:.5rem}
    .nt-add-b .input{width:100%;border:1px solid var(--line);border-radius:10px;padding:.55rem .7rem;
      font-size:13px;font-family:inherit;background:#fff}
    .nt-add-b .input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(36,74,153,.14)}
    #nn-subject{font-weight:700;font-size:14px}
    .nt-ta{resize:vertical;line-height:1.95;min-height:96px}
    .nt-add-f{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
    .nt-day-pick{display:inline-flex;align-items:center;gap:.4rem;font-size:11.5px;font-weight:700;color:var(--muted)}
    .nt-day-pick .input{width:auto;padding:.35rem .5rem;font-size:12px}
    .nt-hint{font-size:10.5px;color:var(--faint);margin-inline-start:auto}
    .nt-day{margin-bottom:1.15rem}
    .nt-day-h{display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap;padding:0 .15rem .45rem}
    .nt-day-t{font-weight:800;font-size:12.5px;color:var(--ink2)}
    .nt-day-n{font-size:11px;color:var(--muted);background:#f1f5f9;border-radius:20px;
      padding:.05rem .5rem;font-weight:700;min-width:20px;text-align:center}
    .nt-day-s{font-size:10.5px;color:var(--faint)}
    /* شبكة لا قائمة: الملاحظة قصيرة غالباً، والقائمة العمودية تجعل سطراً واحداً يأخذ عرض
       الشاشة كله فلا يُقرأ من الدفتر إلا ثلاثُ ملاحظات في الشاشة الواحدة. */
    .nt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.65rem;align-items:start}
    .nt{background:#fff;border:1px solid var(--line);border-radius:14px;padding:.7rem .85rem;
      display:flex;flex-direction:column;gap:.4rem;transition:border-color .15s,box-shadow .15s}
    .nt:hover{border-color:#c9d3e8;box-shadow:0 6px 18px -12px rgba(16,32,70,.4)}
    .nt.on{border-color:#e7d7b0;background:linear-gradient(180deg,#fffdf6,#fff 55%)}
    .nt-h{display:flex;align-items:flex-start;gap:.45rem}
    .nt-s{flex:1;min-width:0;font-weight:800;font-size:13px;color:var(--ink2);line-height:1.6;word-break:break-word}
    .nt-pin{color:var(--gold);margin-inline-end:.25rem}
    .nt-acts{flex:none;display:flex;gap:.15rem;opacity:.35;transition:opacity .15s}
    .nt:hover .nt-acts,.nt-acts:focus-within{opacity:1}
    .nt-a{background:none;border:none;padding:.15rem .3rem;border-radius:7px;cursor:pointer;
      color:var(--muted);font:inherit;font-size:12px;line-height:1;display:inline-flex;align-items:center}
    .nt-a svg{width:14px;height:14px}
    .nt-a:hover{background:var(--bg);color:var(--brand)}
    .nt-a-x:hover{background:#fef2f2;color:#b91c1c}
    .nt-a:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
    /* سطور الملاحظة تُحفظ كما كُتبت: من كتب قائمةً بأسطر يراها قائمة لا فقرةً واحدة. */
    .nt-b{font-size:12.5px;color:var(--ink2);line-height:1.95;white-space:pre-wrap;word-break:break-word;
      max-height:15rem;overflow:hidden;position:relative}
    .nt-b-none{color:var(--faint);font-style:normal}
    .nt-f{font-size:10.5px;color:var(--faint)}
    .nt-err{font-size:11px;color:#991b1b;background:#fef2f2;border:1px solid #fecaca;
      border-radius:8px;padding:.4rem .55rem;line-height:1.8}
    .nt-err[hidden]{display:none}
    @media(max-width:640px){
      .nt-search{margin-inline-start:0;flex-basis:100%}
      .nt-search .search{flex:1}
      .nt-search .search input{min-width:0;width:100%}
      .nt-grid{grid-template-columns:1fr}
      .nt-acts{opacity:1}
      .nt-hint{margin-inline-start:0;flex-basis:100%}
    }
  </style>`;

  const body = `${styles}${lens}
    <div class="nt-top">${searchForm}</div>
    ${composer}
    ${notes.length ? pinnedBlock + dayBlocks : empty}
    ${editorTpl}`;

  const subtitle = notes.length
    ? `${countAr(notes.length, { one: 'ملاحظة واحدة', two: 'ملاحظتان', few: 'ملاحظات', many: 'ملاحظة' })} · ${G.personalOnlyYou}`
    : `دفترك الخاص — ${G.personalOnlyYou}`;

  return layout({ user, active: 'tasks', title: G.myNotes, subtitle, body,
    scripts: ['/static/pages/notes.js'] });
}
