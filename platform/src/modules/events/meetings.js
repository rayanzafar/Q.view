// «الاجتماعات» داخل الفعاليات — الترحيلة ٠٤٠، والقرار قرار ٢٠٢٦-٠٨-٣٠ (فكرة ريّان، بطلب حسين).
//
// موعدٌ له عنوانٌ ورابطٌ وحضورٌ يُدعَون بالاسم من حسابات المنصة. القواعد الثلاث الحاكمة:
//   • «اجتماعاتي أولاً»: القائمة الافتراضية اجتماعاتُ الناظر وحده، والكلُّ بضغطة — الشفافية
//     كاملة (القراءة للشركة كلها) والشاشة نظيفة.
//   • التعارضُ تنبيهٌ لا منع: من يُدعى وعنده اجتماعٌ آخر في الوقت نفسه — في أي فعالية —
//     يُنبَّه المُنشئ ويُحفَظ الاجتماع رغم ذلك. القرار قرارُ إنسان، والمنصة تُخبر ولا تحكم.
//   • الوقتُ ساعةُ حائط الرياض نصاً ('09:30' قبل '10:00' مقارنةً نصية) — عقدُ الترحيلة ٠٤٠،
//     ولا دوالَّ تاريخٍ في الاستعلامات (القاعدة المحمولة بين المحرّكين).
//
// الملكية على نسق البطاقات حرفاً بحرف: المصفوفة تُسأل أولاً، ثم من أنشأ الاجتماع أو من يدير
// الفعالية (can(update,'event') العاري يشمل أدوار الإدارة وحاملي منح v5.60 الشخصية معاً).
import { all, get, insert, update, run, tx } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { can } from '../../core/rbac/index.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { foldDigits } from './card-parser.js';
import { seesDemoAccounts } from '../org/people.js';
import { notify } from '../notifications/notify.js';
import { meetingInviteMail } from '../../core/mail/meeting-mail.js';
import { WEEKDAYS_AR, MONTHS_AR, RIYADH_OFFSET_HOURS, riyadhDate } from '../../core/i18n/time.js';
import { config } from '../../core/config.js';

const TITLE_MAX = 160;
const LOC_MAX = 160;
const NOTE_MAX = 2000;
const URL_MAX = 600;
const ATTENDEES_MAX = 100;

// ── أدوات صغيرة (نسخٌ محلية مقصودة — الملف الناضج المجاور لا يُفتَح لتصدير دواخله) ────────
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (v, max = TITLE_MAX, { multi = false } = {}) => {
  let s = String(v == null ? '' : v).replace(CTRL_RE, '');
  s = multi ? s.replace(/\r\n?/g, '\n').replace(/ {2,}/g, ' ') : s.replace(/\s+/g, ' ');
  s = Array.from(s.trim()).slice(0, max).join('').trim();
  return s || null;
};
const truthy = (v) => v === true || v === 1 || ['1', 'true', 'yes', 'on'].includes(String(v == null ? '' : v).toLowerCase());
const nameOf = (user) => user?.name_ar || user?.username || null;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function asDay(v) {
  const s = foldDigits(String(v == null ? '' : v)).trim().slice(0, 10);
  if (!DAY_RE.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

// ساعةُ حائط الرياض الآن بصيغة ساعة:دقيقة — للحالة («جارٍ الآن») لا للتخزين.
export const riyadhNowHm = () => new Date(Date.now() + RIYADH_OFFSET_HOURS * 3600000).toISOString().slice(11, 16);

// «٠٩:٣٠» و«9:30» و«09:30» كلها 09:30 — والأرقام العربية تُطوى قبل الفحص (لوحات مفاتيح الجوال).
export function asTime(v) {
  const s = foldDigits(String(v == null ? '' : v)).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// تداخل مدّتين في اليوم نفسه — التلامس ليس تداخلاً: اجتماعٌ ينتهي 10:00 وآخر يبدأ 10:00 لا يتعارضان.
export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

// حالة الاجتماع تُحسب ولا تُخزَّن — واليوم والساعة يُحقنان في الاختبارات.
export function meetingState(m, { today = riyadhDate(), nowHm = riyadhNowHm() } = {}) {
  if (m.meeting_date > today) return 'قادم';
  if (m.meeting_date < today) return 'انتهى';
  if (nowHm < m.start_time) return 'قادم';
  if (nowHm >= m.end_time) return 'انتهى';
  return 'جارٍ الآن';
}

// «الأحد · 31 أغسطس 2026» — من مصدر الوقت الواحد، لرسائل البريد وعناوين المجموعات معاً.
export function dayLabelOf(day) {
  const d = new Date(day + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return day;
  return `${WEEKDAYS_AR[d.getUTCDay()]} · ${d.getUTCDate()} ${MONTHS_AR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ── الحُرّاس — المصفوفة أولاً، ثم الملكية ──────────────────────────────────────────────
function assertRead(user) {
  if (!can(user, 'read', 'event_meeting')) throw forbidden('الاجتماعات خارج صلاحياتك');
}
function assertCreate(user) {
  if (!can(user, 'create', 'event_meeting')) throw forbidden('صلاحيتك للمشاهدة فقط — إنشاء الاجتماعات لحسابات الموظفين');
}
export const mayEditMeeting = (user, row) => can(user, 'update', 'event_meeting')
  && (row.created_by === user.id || can(user, 'update', 'event'));
export const mayDeleteMeeting = (user, row) => (row.created_by === user.id && can(user, 'update', 'event_meeting'))
  || can(user, 'delete', 'event_meeting') || can(user, 'delete', 'event');

// ── القراءة ─────────────────────────────────────────────────────────────────────────────
const MEETING_COLS = ['id', 'event_id', 'title', 'meeting_date', 'start_time', 'end_time', 'join_url',
  'location', 'note', 'created_by', 'created_by_name', 'created_at', 'updated_at'];
const meetingSelect = (a = 'm') => MEETING_COLS.map((k) => `${a}.${k}`).join(', ');

async function loadEventRow(eventId) {
  const row = await get('SELECT id, name_ar, starts_on, ends_on, closed_at FROM event WHERE id = ? AND deleted_at IS NULL',
    [String(eventId || '')]);
  if (!row) throw notFound('الفعالية غير موجودة');
  return row;
}
async function loadMeeting(mid) {
  const row = await get(`SELECT ${meetingSelect('m')}, e.name_ar AS "event_name", e.closed_at AS "event_closed_at"
     FROM event_meeting m JOIN event e ON e.id = m.event_id AND e.deleted_at IS NULL
    WHERE m.id = ? AND m.deleted_at IS NULL`, [String(mid || '')]);
  if (!row) throw notFound('الاجتماع غير موجود');
  return row;
}

async function attendeesFor(meetingIds) {
  if (!meetingIds.length) return new Map();
  const rows = await all(
    `SELECT meeting_id, user_id, user_name FROM event_meeting_attendee
      WHERE meeting_id IN (${meetingIds.map(() => '?').join(',')}) ORDER BY added_at, id`, meetingIds);
  const byMeeting = new Map();
  for (const r of rows) {
    if (!byMeeting.has(r.meeting_id)) byMeeting.set(r.meeting_id, []);
    byMeeting.get(r.meeting_id).push({ user_id: r.user_id, user_name: r.user_name });
  }
  return byMeeting;
}

const decorate = (user, row, attendees, at) => ({
  ...row,
  attendees,
  state: meetingState(row, at),
  is_mine: row.created_by === user.id || attendees.some((a) => a.user_id === user.id),
  may_edit: mayEditMeeting(user, row),
  may_delete: mayDeleteMeeting(user, row),
});

export async function listMeetings(user, eventId, opts = {}) {
  assertRead(user);
  const ev = await loadEventRow(eventId);
  const at = { today: opts.today || riyadhDate(), nowHm: opts.nowHm || riyadhNowHm() };
  const rows = await all(`SELECT ${meetingSelect('m')} FROM event_meeting m
     WHERE m.event_id = ? AND m.deleted_at IS NULL
     ORDER BY m.meeting_date, m.start_time, m.id`, [ev.id]);
  const byMeeting = await attendeesFor(rows.map((r) => r.id));
  const out = rows.map((r) => decorate(user, r, byMeeting.get(r.id) || [], at));
  return truthy(opts.mine) ? out.filter((m) => m.is_mine) : out;
}

export async function getMeeting(user, mid) {
  assertRead(user);
  const row = await loadMeeting(mid);
  const byMeeting = await attendeesFor([row.id]);
  return decorate(user, row, byMeeting.get(row.id) || [], {});
}

// ── التحقق من المدخلات ─────────────────────────────────────────────────────────────────
// الرابط اختياري — الاجتماع الحضوري في الجناح بلا رابط. وإن وُجد فلا يُخزَّن إلا http(s):
// «teams.microsoft.com/…» تُكمَّل https:// تلقائياً، وكل مخطَّطٍ آخر يُرفض من بابه.
function asJoinUrl(v) {
  const s = clean(v, URL_MAX);
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s
    : (/^[\w-]+(\.[\w-]+)+([/:?#]|$)/.test(s) ? 'https://' + s : null);
  if (!withScheme || !/^https?:\/\/[^\s]+$/i.test(withScheme)) {
    throw badRequest('اكتب رابط الاجتماع كاملاً كما نسخته من تطبيق الاجتماعات');
  }
  return withScheme;
}

// الحقول المقبولة — عند الإنشاء كلها تُقرأ، وعند التعديل ما ورد في الطلب فقط (نسق eventPatch).
function meetingPatch(data, base = null) {
  const has = (k) => base === null || k in data;
  const p = {};
  if (has('title')) {
    p.title = clean(data.title, TITLE_MAX);
    if (!p.title) throw badRequest('اكتب عنوان الاجتماع — كلمتان تكفيان');
  }
  if (has('meeting_date')) {
    p.meeting_date = asDay(data.meeting_date);
    if (!p.meeting_date) throw badRequest('اكتب تاريخ الاجتماع بصيغة سنة-شهر-يوم');
  }
  if (has('start_time')) {
    p.start_time = asTime(data.start_time);
    if (!p.start_time) throw badRequest('اكتب وقت البداية بصيغة ساعة:دقيقة مثل 09:30');
  }
  if (has('end_time')) {
    p.end_time = asTime(data.end_time);
    if (!p.end_time) throw badRequest('اكتب وقت النهاية بصيغة ساعة:دقيقة مثل 10:30');
  }
  const s = p.start_time ?? base?.start_time;
  const e = p.end_time ?? base?.end_time;
  if (s && e && e <= s) throw badRequest('وقت النهاية قبل وقت البداية أو يساويه — صحّح أحد الوقتين');
  if (has('join_url')) p.join_url = asJoinUrl(data.join_url);
  if (has('location')) p.location = clean(data.location, LOC_MAX);
  if (has('note')) p.note = clean(data.note, NOTE_MAX, { multi: true });
  return p;
}

// المدعوون حساباتٌ نشطة في المنصة لا غير — والحسابات التجريبية لا تُدعى إلا من مدير النظام.
async function resolveAttendees(user, ids, creatorId) {
  const wanted = [...new Set([creatorId, ...(Array.isArray(ids) ? ids : [])].map((v) => clean(v, 80)).filter(Boolean))];
  if (wanted.length > ATTENDEES_MAX) throw badRequest('عدد المدعوين تجاوز الحد — مئة مدعوٍّ يكفون لاجتماع واحد');
  const rows = await all(
    `SELECT id, COALESCE(name_ar, username) AS "name", email, username FROM app_user
      WHERE id IN (${wanted.map(() => '?').join(',')}) AND active = 1 AND deleted_at IS NULL`, wanted);
  const allowDemo = seesDemoAccounts(user);
  const valid = rows.filter((r) => allowDemo || !String(r.username || '').startsWith('demo.') || r.id === creatorId);
  if (valid.length !== wanted.length) {
    throw badRequest('بعض المدعوين ليسوا حسابات نشطة — حدّث الصفحة واختر من جديد');
  }
  return wanted.map((wid) => {
    const r = valid.find((x) => x.id === wid);
    return { user_id: r.id, user_name: r.name, email: clean(r.email, 200) };
  });
}

// ── التعارض: عبر كل الفعاليات، تنبيهاً لا منعاً ───────────────────────────────────────
async function conflictsFor(day, start, end, userIds, exceptId = null) {
  if (!userIds.length) return [];
  const params = [day, ...userIds, end, start];
  let extra = '';
  if (exceptId) { extra = 'AND m.id <> ?'; params.push(exceptId); }
  return all(
    `SELECT a.user_id, a.user_name, m.id AS "meeting_id", m.title, m.start_time, m.end_time,
            m.event_id, e.name_ar AS "event_name"
       FROM event_meeting_attendee a
       JOIN event_meeting m ON m.id = a.meeting_id AND m.deleted_at IS NULL
       JOIN event e ON e.id = m.event_id AND e.deleted_at IS NULL
      WHERE m.meeting_date = ? AND a.user_id IN (${userIds.map(() => '?').join(',')})
        AND m.start_time < ? AND m.end_time > ? ${extra}
      ORDER BY m.start_time, m.id`, params);
}

// فحص التعارض الحيّ من النموذج — لا يكتب شيئاً، ولا يكشف إلا ما تكشفه القراءة العامة أصلاً.
export async function checkConflicts(user, data = {}) {
  assertRead(user);
  const day = asDay(data.meeting_date);
  const start = asTime(data.start_time);
  const end = asTime(data.end_time);
  if (!day || !start || !end || end <= start) return { conflicts: [] };
  const ids = [...new Set((Array.isArray(data.attendee_ids) ? data.attendee_ids : [])
    .map((v) => clean(v, 80)).filter(Boolean).concat(user.id))];
  const exceptId = clean(data.except_id, 80);
  return { conflicts: await conflictsFor(day, start, end, ids, exceptId) };
}

// ── دعوة تصل بالبريد: رسالةٌ واحدة لكل حدث، ولا تذكير (سياسة البريد المعلنة) ────────────
async function enqueueMeetingMail(kind, meeting, eventRow, attendees) {
  const emails = attendees.map((a) => a.email).filter(Boolean);
  if (!emails.length) return;
  const { subject, html } = meetingInviteMail({
    kind,
    title: meeting.title,
    eventName: eventRow.name_ar,
    dayLabel: dayLabelOf(meeting.meeting_date),
    startTime: meeting.start_time,
    endTime: meeting.end_time,
    location: meeting.location,
    joinUrl: meeting.join_url,
    eventId: meeting.event_id,
    platformUrl: config.platformUrl,
  });
  const qid = id('eq');
  const now = nowIso();
  await insert('email_queue', { id: qid, to_json: JSON.stringify(emails), cc_json: '[]',
    subject, html, status: 'QUEUED', created_at: now });
  await insert('email_log', { id: id('el'), queue_id: qid, event: 'enqueued',
    detail: kind === 'time' ? 'meeting_time_change' : 'meeting_invite', at: now });
}

// قائمة حضورٍ جاءت من الجدول لا من التحقق — عناوينها تُستكمل من الحسابات قبل الإرسال.
async function withEmails(list) {
  const ids = list.map((a) => a.user_id).filter(Boolean);
  if (!ids.length) return list;
  const rows = await all(
    `SELECT id, email FROM app_user WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const emailOf = new Map(rows.map((r) => [r.id, clean(r.email, 200)]));
  return list.map((a) => ({ ...a, email: a.email ?? emailOf.get(a.user_id) ?? null }));
}

const notifyAttendees = async (attendees, exceptUserId, title, body, mid) => {
  for (const a of attendees) {
    if (a.user_id === exceptUserId) continue;
    await notify(a.user_id, { kind: 'meeting', title, body, ref_resource: 'event_meeting', ref_id: mid });
  }
};

// ── الكتابة ─────────────────────────────────────────────────────────────────────────────
export async function createMeeting(ctx, eventId, data = {}) {
  const user = ctx.user;
  assertCreate(user);
  const ev = await loadEventRow(eventId);
  if (ev.closed_at) throw badRequest('هذه الفعالية مُغلقة — لا يُنشأ فيها اجتماع جديد');
  const p = meetingPatch(data, null);
  if (!p.meeting_date) throw badRequest('اكتب تاريخ الاجتماع بصيغة سنة-شهر-يوم');
  if (!p.start_time) throw badRequest('اكتب وقت البداية بصيغة ساعة:دقيقة مثل 09:30');
  if (!p.end_time) throw badRequest('اكتب وقت النهاية بصيغة ساعة:دقيقة مثل 10:30');
  const attendees = await resolveAttendees(user, data.attendee_ids, user.id);
  const conflicts = await conflictsFor(p.meeting_date, p.start_time, p.end_time,
    attendees.map((a) => a.user_id));
  const mid = id('mtg');
  const now = nowIso();
  await tx(async () => {
    await insert('event_meeting', { id: mid, event_id: ev.id, ...p,
      created_by: user.id, created_by_name: nameOf(user), created_at: now });
    for (const a of attendees) {
      await insert('event_meeting_attendee', { id: id('mta'), meeting_id: mid,
        user_id: a.user_id, user_name: a.user_name, added_by: user.id, added_at: now });
    }
    await audit(ctx, { action: 'create', resource: 'event_meeting', resourceId: mid, sectorId: null,
      detail: { event_id: ev.id, title: p.title, meeting_date: p.meeting_date,
        start_time: p.start_time, end_time: p.end_time, attendees: attendees.length } });
    await notifyAttendees(attendees, user.id, 'دُعيت إلى اجتماع',
      `${p.title} — ${dayLabelOf(p.meeting_date)} · ${p.start_time}`, mid);
    await enqueueMeetingMail('new', { ...p, event_id: ev.id }, ev, attendees);
  });
  return { meeting: await getMeeting(user, mid), conflicts };
}

export async function updateMeeting(ctx, mid, patch = {}) {
  const user = ctx.user;
  assertRead(user);
  const row = await loadMeeting(mid);
  if (!mayEditMeeting(user, row)) throw forbidden('تعديل هذا الاجتماع لمن أنشأه أو لمن يدير الفعالية');
  const p = meetingPatch(patch, row);
  const replaceAttendees = 'attendee_ids' in patch;
  if (!Object.keys(p).length && !replaceAttendees) throw badRequest('حدّد ما تريد تغييره في الاجتماع');

  const before = (await attendeesFor([row.id])).get(row.id) || [];
  // المُنشئ يبقى مدعوّاً دوماً — قائمةٌ بلا صاحبها تُربك «اجتماعاتي» أكثر مما تفيد.
  const wanted = replaceAttendees
    ? await resolveAttendees(user, patch.attendee_ids, row.created_by)
    : null;
  const added = wanted ? wanted.filter((w) => !before.some((b) => b.user_id === w.user_id)) : [];
  const removed = wanted ? before.filter((b) => !wanted.some((w) => w.user_id === b.user_id)) : [];

  const next = { ...row, ...p };
  const timeChanged = ['meeting_date', 'start_time', 'end_time'].some((k) => k in p && p[k] !== row[k]);
  const currentIds = (wanted || before).map((a) => a.user_id);
  const conflicts = await conflictsFor(next.meeting_date, next.start_time, next.end_time, currentIds, row.id);
  const ev = await loadEventRow(row.event_id);
  const now = nowIso();

  await tx(async () => {
    if (Object.keys(p).length) await update('event_meeting', row.id, { ...p, updated_at: now });
    if (wanted) {
      // فرقُ القائمتين لا مسحُها: صفوف الباقين تبقى بختم دعوتها الأول (حذف الحضور حذفٌ صُلب — عقد ٠٤٠).
      for (const r of removed) await run('DELETE FROM event_meeting_attendee WHERE meeting_id = ? AND user_id = ?', [row.id, r.user_id]);
      for (const a of added) {
        await insert('event_meeting_attendee', { id: id('mta'), meeting_id: row.id,
          user_id: a.user_id, user_name: a.user_name, added_by: user.id, added_at: now });
      }
    }
    await audit(ctx, { action: 'update', resource: 'event_meeting', resourceId: row.id, sectorId: null,
      detail: { fields: Object.keys(p),
        ...(wanted ? { added: added.map((a) => a.user_name), removed: removed.map((r) => r.user_name) } : {}) } });

    if (timeChanged) {
      await notifyAttendees(wanted || before, user.id, 'تغيّر موعد اجتماع',
        `${next.title} — ${dayLabelOf(next.meeting_date)} · ${next.start_time}`, row.id);
      await enqueueMeetingMail('time', next, ev, await withEmails(wanted || before));
    } else if (added.length) {
      await notifyAttendees(added, user.id, 'دُعيت إلى اجتماع',
        `${next.title} — ${dayLabelOf(next.meeting_date)} · ${next.start_time}`, row.id);
      await enqueueMeetingMail('new', next, ev, added);
    }
  });
  return { meeting: await getMeeting(user, row.id), conflicts };
}

export async function deleteMeeting(ctx, mid) {
  const user = ctx.user;
  assertRead(user);
  const row = await loadMeeting(mid);
  if (!mayDeleteMeeting(user, row)) throw forbidden('حذف هذا الاجتماع لمن أنشأه أو لقيادة الفريق');
  const attendees = (await attendeesFor([row.id])).get(row.id) || [];
  await tx(async () => {
    await update('event_meeting', row.id, { deleted_at: nowIso() });
    await audit(ctx, { action: 'delete', resource: 'event_meeting', resourceId: row.id, sectorId: null,
      detail: { title: row.title, meeting_date: row.meeting_date } });
    await notifyAttendees(attendees, user.id, 'أُلغي اجتماع',
      `${row.title} — ${dayLabelOf(row.meeting_date)} · ${row.start_time}`, row.id);
  });
  return { ok: true };
}
