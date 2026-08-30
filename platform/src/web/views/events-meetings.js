// تبويب «الاجتماعات» في صفحة الفعالية — جدولُ أعمالٍ مجموعٌ باليوم، لا شبكة شهرٍ فارغة:
// المعرض أيامٌ ثلاثة أو أربعة، وشبكةُ ستةٍ وعشرين خليةً ميتة على شاشة جوّالٍ ضجيجٌ لا تقويم.
//
// القاعدة الأولى: «اجتماعاتي» أولاً — القائمة الافتراضية اجتماعاتُ الناظر وحده، و«الكل» بضغطة.
// والنموذج على الصفحة لا في نافذةٍ منبثقة — قاعدةُ نموذج الالتقاط نفسها: المنبثقة على الجوّال
// تُغلق بالخطأ وتضيع ما كُتب.
import { card } from '../layout.js';
import { esc, searchPicker, PICKER_CSS, ddWrap } from './_shared.js';
import { icon } from '../icons.js';
import { G } from '../i18n/glossary.js';
import { can } from '../../core/rbac/index.js';
import { riyadhDate } from '../../core/i18n/time.js';
import { pickablePeople } from '../../modules/org/people.js';
import { listMeetings, dayLabelOf } from '../../modules/events/meetings.js';

const STATE_TONE = { 'جارٍ الآن': 'background:#dcfce7;color:#047857', 'انتهى': 'background:#f1f5f9;color:#64748b' };
const statePill = (s) => (STATE_TONE[s] ? `<span class="pill" style="${STATE_TONE[s]}">${esc(s)}</span>` : '');
// «09:00–10:00» — أرقامٌ معزولة الاتجاه فلا يقلبها السياق العربي.
const timeSpan = (m) => `<span class="tnum" dir="ltr">${esc(m.start_time)}–${esc(m.end_time)}</span>`;

const MEETINGS_CSS = `<style>
.mt-tb{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.8rem}
.mt-tb .sp{flex:1 1 200px}
.mt-day{margin:1rem 0 .45rem;font-size:12px;font-weight:800;color:var(--muted);display:flex;align-items:center;gap:.5rem}
.mt-day.today{color:var(--brand)}
.mt-day .now-dot{width:8px;height:8px;border-radius:50%;background:var(--brand);display:inline-block}
.mt-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.7rem;align-items:center;
  padding:.75rem .9rem;margin-bottom:.55rem;cursor:pointer}
.mt-row .mt-time{display:grid;gap:.25rem;justify-items:start;flex:0 0 auto}
.mt-row .mt-main{min-width:0}
.mt-row .mt-main b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink2)}
.mt-sub{font-size:11.5px;color:var(--muted);margin-top:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mt-act{display:flex;align-items:center;gap:.35rem;flex:0 0 auto}
.mt-act .btn{min-height:44px}
.mt-form{margin-bottom:1rem}
.mt-form .field{margin-bottom:.7rem}
.mt-form .input,.mt-form select,.mt-form textarea{font-size:16px;min-height:44px}
.mt-form textarea{min-height:64px}
.mt-grid2{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
.mt-chips{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}
.mt-chip{display:inline-flex;align-items:center;gap:.35rem;background:#eef1f7;color:var(--ink2);
  border-radius:999px;padding:.25rem .3rem .25rem .7rem;font-size:12.5px;font-weight:700}
.mt-chip button{border:0;background:none;cursor:pointer;font-size:13px;color:var(--muted);
  min-width:28px;min-height:28px;border-radius:50%}
.mt-chip button:hover{background:#e2e8f0;color:var(--red)}
.mt-add{display:flex;gap:.5rem;align-items:flex-start}
.mt-add .btn{min-height:44px;flex:0 0 auto}
.mt-save{width:100%;min-height:48px;font-size:15px;justify-content:center;margin-top:.3rem}
@media(max-width:640px){
  .mt-row{grid-template-columns:auto minmax(0,1fr)}
  .mt-act{grid-column:1 / -1;justify-content:stretch}
  .mt-act .btn{flex:1 1 auto;justify-content:center}
  .mt-grid2{grid-template-columns:1fr}
}
${PICKER_CSS}
</style>`;

// ملخّص المدعوين لسطر القائمة: أول اسمين و«+الباقي» — والقائمة الكاملة في نافذة التفاصيل.
function attendeesSummary(m) {
  const names = m.attendees.map((a) => a.user_name).filter(Boolean);
  if (!names.length) return '';
  const head = names.slice(0, 2).join('، ');
  return names.length > 2 ? `${head} <span class="tnum">+${names.length - 2}</span>` : head;
}

const joinBtn = (m, small) => (m.join_url
  ? `<a class="btn btn-primary${small ? ' btn-sm' : ''}" target="_blank" rel="noopener noreferrer" href="${esc(m.join_url)}">${G.joinMeeting}</a>`
  : '');

function meetingRow(m) {
  const sub = [attendeesSummary(m), m.location ? esc(m.location) : '', m.created_by_name ? `أنشأه ${esc(m.created_by_name)}` : '']
    .filter(Boolean).join(' · ');
  return `<div class="card mt-row" data-dd="mtg-${esc(m.id)}" role="button" tabindex="0" aria-label="تفاصيل ${esc(m.title)}">
    <div class="mt-time">${timeSpan(m)}${statePill(m.state)}</div>
    <div class="mt-main"><b>${esc(m.title)}</b>${sub ? `<div class="mt-sub">${sub}</div>` : ''}</div>
    <div class="mt-act">
      ${joinBtn(m, true)}
      ${m.may_edit ? `<button type="button" class="btn btn-ghost btn-sm" data-action="mt-edit" data-mid="${esc(m.id)}" aria-label="تعديل ${esc(m.title)}">${icon('edit')}</button>` : ''}
      ${m.may_delete ? `<button type="button" class="btn btn-ghost btn-sm" data-action="mt-del" data-mid="${esc(m.id)}" aria-label="حذف ${esc(m.title)}" style="color:var(--red)">${icon('x')}</button>` : ''}
    </div>
  </div>`;
}

// نافذة التفاصيل — قالبٌ خامل يُبنى مع الصفحة تحت نفس صلاحياتها، ويُفتح بلا نداء شبكة.
function meetingDD(m) {
  const li = (label, value) => (value ? `<div style="display:flex;gap:.6rem;font-size:13px;line-height:1.9">
    <span style="color:var(--muted);flex:0 0 84px">${label}</span><span style="min-width:0">${value}</span></div>` : '');
  const names = m.attendees.map((a) => esc(a.user_name || '')).filter(Boolean).join('، ');
  return ddWrap(`mtg-${esc(m.id)}`, esc(m.title), `${esc(dayLabelOf(m.meeting_date))} · ${m.start_time}–${m.end_time}`, `
    <div style="display:grid;gap:.2rem">
      ${li('الوقت', `<span class="tnum" dir="ltr">${esc(m.start_time)}–${esc(m.end_time)}</span> ${statePill(m.state)}`)}
      ${li('المكان', m.location ? esc(m.location) : '')}
      ${li(G.meetingAttendees, names)}
      ${li('أنشأه', m.created_by_name ? esc(m.created_by_name) : '')}
      ${li('ملاحظة', m.note ? esc(m.note).replace(/\n/g, '<br>') : '')}
    </div>
    ${m.join_url ? `<div style="margin-top:1rem">${joinBtn(m)}</div>` : ''}`);
}

function meetingForm(ev, people, today) {
  const inRange = today >= ev.starts_on && today <= ev.ends_on;
  const defDate = inRange ? today : ev.starts_on;
  const field = (id, label, inner) => `<div class="field"><label for="${id}">${label}</label>${inner}</div>`;
  return `<form id="mt-form" class="card mt-form ev-form" hidden autocomplete="off" novalidate style="padding:1rem 1.1rem">
    <h3 class="ev-sec-t" id="mt-form-t">${G.newMeeting}</h3>
    ${field('mt-title', G.meetingTitle, `<input class="input" id="mt-title" maxlength="160" required placeholder="مثال: عرضٌ تعريفي لوفد الوزارة">`)}
    ${field('mt-date', 'التاريخ', `<input class="input" id="mt-date" type="date" value="${esc(defDate || '')}">`)}
    <div class="mt-grid2">
      ${field('mt-start', 'من الساعة', `<input class="input" id="mt-start" type="time">`)}
      ${field('mt-end', 'إلى الساعة', `<input class="input" id="mt-end" type="time">`)}
    </div>
    ${field('mt-url', G.meetingLink, `<input class="input" id="mt-url" type="text" dir="ltr" inputmode="url" maxlength="600"
      autocapitalize="off" spellcheck="false" placeholder="https://teams.microsoft.com/...">
      <div class="ev-hint">اختياري — الاجتماع الحضوري في الجناح يُترك رابطه فارغاً.</div>`)}
    ${field('mt-location', 'المكان', `<input class="input" id="mt-location" maxlength="160" placeholder="اختياري — جناحنا، قاعة الاجتماعات…">`)}
    ${field('mt-note', 'ملاحظة', `<textarea id="mt-note" rows="2" maxlength="2000" placeholder="ما يستعدّ له الحاضرون — سطر يكفي"></textarea>`)}
    <div class="field"><label for="mt-people-q">${G.meetingAttendees}</label>
      <div class="mt-add">
        ${searchPicker({ idAttr: 'mt-people', label: G.meetingAttendees, placeholder: 'ابحث بالاسم ثم أضِف',
    lead: [{ value: '', name: 'اختر شخصاً' }],
    groups: [{ label: 'حسابات المنصة', items: people.map((p) => ({ value: p.id, name: p.name })) }] })}
        <button type="button" class="btn" data-action="mt-add-attendee">${G.addAttendee}</button>
      </div>
      <div class="mt-chips" id="mt-chips"></div>
      <input type="hidden" id="mt-attendees" value="[]">
      <div class="ev-hint">تُضاف أنت تلقائياً — والدعوة تصل المدعوين بالبريد وفيها ${G.meetingLink}.</div>
    </div>
    <div id="mt-conflict" class="alert warn" hidden role="status"></div>
    <button type="submit" class="btn btn-primary mt-save" data-action="mt-save">${icon('check')} ${G.saveMeeting}</button>
    <button type="button" class="btn btn-ghost" data-action="mt-cancel" style="width:100%;justify-content:center;margin-top:.4rem">${G.cancel}</button>
  </form>`;
}

// اللوحة كاملة. تُرجع الشيفرة وما يحتاجه المتصفّح (يُدمج في حزنة الصفحة الواحدة).
export async function meetingsPanel(user, ev, { cur, closed, link }) {
  const rows = await listMeetings(user, ev.id, {});
  const scopeAll = cur.scope === 'all';
  const mineRows = rows.filter((m) => m.is_mine);
  const shown = scopeAll ? rows : mineRows;
  const canCreate = can(user, 'create', 'event_meeting') && !closed;
  const people = canCreate ? await pickablePeople({ viewer: user }) : [];
  const today = riyadhDate();

  const chip = (label, on, href) => `<a class="chip${on ? ' on' : ''}" href="${esc(href)}"${on ? ' aria-current="page"' : ''}>${label}</a>`;
  const toolbar = `<div class="mt-tb">
    <div class="chips" style="margin-bottom:0" role="group" aria-label="نطاق العرض">
      ${chip(G.myMeetings, !scopeAll, link({ scope: '' }))}
      ${chip(G.all, scopeAll, link({ scope: 'all' }))}
    </div>
    <span style="flex:1"></span>
    ${canCreate ? `<button type="button" class="btn btn-primary" data-action="mt-new">${icon('plus')} ${G.newMeeting}</button>` : ''}
  </div>`;

  let list;
  if (shown.length) {
    const byDay = new Map();
    for (const m of shown) {
      if (!byDay.has(m.meeting_date)) byDay.set(m.meeting_date, []);
      byDay.get(m.meeting_date).push(m);
    }
    list = [...byDay.entries()].map(([d, ms]) => `
      <div class="mt-day${d === today ? ' today' : ''}">${d === today ? '<span class="now-dot"></span>اليوم — ' : ''}${esc(dayLabelOf(d))}</div>
      ${ms.map(meetingRow).join('')}`).join('');
  } else if (!scopeAll && rows.length) {
    // «اجتماعاتي» فارغة والفريق عنده اجتماعات — يُقال ذلك لا يُوحى بفراغ الكل.
    list = card(`<div class="empty-state">${icon('inbox')}
      <div class="t">لا اجتماعات لك هنا بعد</div>
      <div class="s">اعرض «${G.all}» لترى اجتماعات الفريق${canCreate ? '، أو أنشئ اجتماعاً وادعُ زملاءك' : ''}.</div>
      <a class="btn" href="${esc(link({ scope: 'all' }))}">${G.all}</a></div>`);
  } else {
    list = card(`<div class="empty-state">${icon('clock')}
      <div class="t">لا اجتماعات بعد</div>
      <div class="s">${canCreate ? 'أنشئ أول اجتماع وادعُ زملاءك — الدعوة تصلهم بالبريد وفيها رابط الاجتماع.'
    : closed ? 'هذه الفعالية مُغلقة — سجل اجتماعاتها كما انتهى.' : 'ستظهر اجتماعات الفريق هنا حين تُنشأ.'}</div>
      ${canCreate ? `<button type="button" class="btn btn-primary" data-action="mt-new">${icon('plus')} ${G.newMeeting}</button>` : ''}</div>`);
  }

  const dds = shown.map(meetingDD).join('');
  const html = `${MEETINGS_CSS}<section id="ev-panel-meetings" aria-label="${G.eventMeetings}">
    ${toolbar}${canCreate ? meetingForm(ev, people, today) : ''}${list}${dds}
  </section>`;

  // ما يحتاجه المتصفّح: قائمة الأشخاص للمنتقي، وصفوف ما يجوز له تعديله للتعبئة المسبقة.
  const editable = {};
  for (const m of rows) {
    if (!m.may_edit) continue;
    editable[m.id] = { title: m.title, meeting_date: m.meeting_date, start_time: m.start_time,
      end_time: m.end_time, join_url: m.join_url || '', location: m.location || '', note: m.note || '',
      attendee_ids: m.attendees.map((a) => a.user_id) };
  }
  return { html, mt: { canCreate, people, rows: editable } };
}
