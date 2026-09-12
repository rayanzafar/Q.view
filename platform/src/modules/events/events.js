// ══ الفعاليات — التقاط بطاقات الزوّار في المعارض ═══════════════════════════════════════
//
// قسمٌ مستقل للمعارض: نلتقط من نقابلهم بسرعة على الجوال، وبعد المعرض نراجع من يصير فرصةً
// ومن يصير شراكة — بلسان المالك (٢٠٢٦-٠٨-٢٧).
//
// ── القرار البنيوي: قسمٌ معزول، لا امتدادٌ لسجل العملاء ولا لخط الفرص ────────────────────
// هذا الملف لا يستورد من وحدة العملاء ولا من وحدة البيع، ولا يقرأ جدولاً منهما ولا يكتب فيه —
// والفحص البنيوي في tests/integration/events.test.js يحرس ذلك نصّاً. السبب مذكور في رأس
// الترحيلة ٠٣٨: بطاقة المعرض ليست جهة اتصال في سجل العملاء، وتحويلُها قرارٌ بشريّ لاحق.
//
// ── الحُرّاس الأربعة ────────────────────────────────────────────────────────────────────
//   • القراءة: منح «قراءة فعالية» — لكل موظف بنطاق الشركة، والمشاهد قراءةً فقط، والخارجي لا.
//   • الإدارة (إنشاء فعالية/تعديلها/إغلاقها/حذفها): منح على «فعالية» — لمدير النظام وقادة
//     القطاعات ومكتب الرئيس (ورئيس تطوير الأعمال بلا حذف — قاعدته العامة في المصفوفة).
//   • الالتقاط: منح «إنشاء» على الجهة الملتقطة أو الشراكة — كل حسابٍ تشغيلي؛ المشاهد يقرأ ولا يلتقط.
//   • التعديل على البطاقة (v5.67): منحُ «تعديل» على الجهة الملتقطة من المصفوفة **وحده**، بلا
//     مِلكية — كل حسابٍ تشغيلي يحمله، والمشاهد لا. وسببُه من LEAP: البطاقة تُلتقط في الزحام
//     ناقصةً أو بحرفٍ مقلوب، ويصحّحها من يجلس إليها بعد المعرض. فردُّ زميلٍ عن تصحيح رقمٍ
//     لأن غيره هو من صوّرها يُبقي الخطأ حيّاً إلى الأبد ويُحوّل الصواب إلى انتظار. البطاقة
//     أمانةُ الفريق لا أمانةُ ملتقِطها (ADR-0013، تعديل ٢٠٢٦-٠٨-٣١).
//   • الحذف: كما كان — المالك بمنح التعديل، أو من يحمل منحَ «حذف» من المصفوفة (قائد القطاع
//     ومكتب الرئيس). فالتصحيح يُبقي البطاقة والحذفُ يُغيّبها، وبابُ ما لا يُستعاد أضيق.
//     ورئيس تطوير الأعمال يعدّل كل بطاقة ولا يحذف إلا بطاقته — قاعدته العامة.
//   • الشراكة: على قاعدتها القديمة نفسِها — منحُ «تعديل» ثم مِلكيةٌ أو دورُ مراجعة (REVIEW_ROLES).
//   • الصور (E2، وقائمةً منذ v5.67): للبطاقة صورٌ لا صورةٌ واحدة — ستٌّ حدّاً أعلى، تُضاف ولا
//     تستبدل، وغلافُها أقدمُها (يُحسب عند القراءة ولا يُخزَّن). إضافتُها وحذفُ واحدةٍ منها
//     بمنح تعديل البطاقة نفسِه؛ ورموزُ الكشك بمنح تعديل الفعالية — من يدير الفعالية يقرّر ما
//     يُعرض في جناحها. والقراءة — الغلافُ وكلُّ صورةٍ بعينها — لكل من يقرأ الفعالية.
//
// ── كشف التكرار: داخل الفعالية الواحدة، وبثلاثة مفاتيح ──────────────────────────────────
// في معرضٍ يلتقط ثلاثة زملاء البطاقة نفسها. فكل التقاطٍ يُسأل: هل في هذه الفعالية بطاقةٌ
// بالجوال نفسه، أو بالبريد نفسه، أو بالاسم والجهة معاً (بعد طيّ الهمزات والتاء المربوطة
// ونزع الألقاب)؟ فإن وُجدت عُلِّمت الجديدة «قد تكون مكرّرة» وأُشير إلى الأقدم — ولا تُرفض:
// الزحام لا يحتمل حواراً، والدمج قرار مراجعةٍ بعد المعرض. ولا كشف عبر الفعاليات: الشخص
// نفسه في معرضين لقاءان لا تكرار.
//
// ── ما لا يتغيّر ────────────────────────────────────────────────────────────────────────
// raw_text — نصّ البطاقة كما أُلصق — لا يمرّ من التعديل أبداً: هو الأصل الذي يُرجَع إليه إذا
// اختلف اثنان على ما كان مكتوباً. والحذف ناعم كعرف المنصة، إلا صورة البطاقة فتُمحى فعلاً.
import { all, get, insert, update, run, tx } from '../../core/db/index.js';
import { createHash } from 'node:crypto';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { can } from '../../core/rbac/index.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { normalizeEntityName } from '../../core/org/entity-registry.js';
import { parseCardText, foldDigits } from './card-parser.js';
import { buildExport } from '../io/xlsx.js';
import { RIYADH_OFFSET_HOURS } from '../../core/i18n/time.js';
import { config } from '../../core/config.js';

export const CARD_KINDS = ['تعريف بالشركة', 'شراكة', 'تعاون', 'توظيف'];
export const OUTCOMES = ['لم تُراجع', 'تواصلنا', 'صارت فرصة', 'صارت شراكة', 'لا متابعة'];
export const PARTNER_KINDS = ['شراكة تقنية', 'تجارية / تسويقية', 'تنفيذ من الباطن', 'جهة حكومية', 'تدريب وتوظيف', 'أخرى'];
export const PARTNER_STATUSES = ['مبدئية', 'قيد النقاش', 'مذكّرة تفاهم', 'اتفاقية موقّعة', 'نشطة', 'متوقّفة'];
export const REVIEW_ROLES = ['admin', 'sector_lead', 'bd_head', 'ceo_office'];

const FIELD_MAX = 160;
const NOTE_MAX = 4000;
const RAW_MAX = 12000;

// ── أدوات صغيرة ─────────────────────────────────────────────────────────────────────────
// المحارف الضابطة (C0 وDEL) تُنزَع من كل حقلٍ نصّي قبل أن يُربَط: NUL واحد في عمود TEXT رميةٌ على
// بوستجريس تُسقط الطلب كله بخطأ خادم — في الاسم كما في الملاحظة. والسطر الجديد يبقى في الحقول
// متعدّدة الأسطر وحدها (الملاحظات والنصّ الخام) ويُطوى فراغاً في سواها، وفراغاتٌ متتالية فراغٌ واحد.
// والقصّ بالحرف (نقطة الترميز) لا بوحدة UTF-16: رمزٌ تعبيري في آخر العنوان يبقى كاملاً أو يسقط
// كاملاً — لا نصفَ زوجٍ بديلٍ يُخزَّن ثم يُعرض علامةَ استفهام.
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const MULTI = { multi: true };
const clean = (v, max = FIELD_MAX, { multi = false } = {}) => {
  let s = String(v == null ? '' : v).replace(CTRL_RE, '');
  s = multi ? s.replace(/\r\n?/g, '\n').replace(/ {2,}/g, ' ') : s.replace(/\s+/g, ' ');
  s = Array.from(s.trim()).slice(0, max).join('').trim();
  return s || null;
};
const truthy = (v) => v === true || v === 1 || ['1', 'true', 'yes', 'on'].includes(String(v == null ? '' : v).toLowerCase());
const today = () => nowIso().slice(0, 10);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// تاريخٌ يُبنى في JS ويُربَط كنص — لا دوال تواريخ في الاستعلام (القاعدة المحمولة بين المحرّكين).
function asDay(v) {
  const s = foldDigits(String(v == null ? '' : v)).trim().slice(0, 10);
  if (!DAY_RE.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}
const nameOf = (user) => user?.name_ar || user?.username || null;
const count = async (sql, params) => Number((await get(sql, params))?.n || 0);

// ── التطبيع: مفاتيح كشف التكرار ─────────────────────────────────────────────────────────
// الجوال: أرقامٌ لاتينية فقط، بصيغة محلية واحدة — «+966 50 123 4567» و«0501234567» مفتاحٌ واحد.
export function normalizePhone(raw) {
  if (raw == null) return null;
  let d = foldDigits(raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^966\d{9}$/.test(d)) d = '0' + d.slice(3);
  else if (/^5\d{8}$/.test(d)) d = '0' + d;
  return d.length < 7 ? null : d;
}
// الألقاب تُنزع قبل الطيّ: «م. أحمد العلي» و«أحمد العلي» شخصٌ واحد. اللقب يُقبل بنقطةٍ أو
// مسافةٍ بعده فقط — كي لا يُقتطع أوّلُ «محمد» أو «دانة».
const HONORIFIC_RE = /^(?:(?:م|د|أ|المهندس|المهندسة|الدكتور|الدكتورة|الأستاذ|الأستاذة|الاستاذ|الاستاذة|الشيخ|السيد|السيدة|eng|dr|mr|ms|mrs|prof)(?:\.\s*|\s+))+/i;
const squash = (s) => normalizeEntityName(s).replace(/[«»"'().,\-–—]/g, ' ').replace(/\s+/g, ' ').trim() || null;
export function normalizePerson(s) {
  return squash(String(s == null ? '' : s).trim().replace(HONORIFIC_RE, ''));
}
export function normalizeOrg(s) { return squash(String(s == null ? '' : s)); }
export function normalizeEmail(s) {
  const n = String(s == null ? '' : s).trim().toLowerCase();
  return n || null;
}

// ── حالة الفعالية: تُحسب من تاريخيها وختم إغلاقها، ولا تُخزَّن ────────────────────────────
export function eventStatus(row, day = today()) {
  if (!row) return 'غير محدَّدة';
  if (row.closed_at) return 'مُغلقة';
  if (day < String(row.starts_on || '')) return 'قادمة';
  if (day > String(row.ends_on || '')) return 'منتهية';
  return 'جارية';
}

// ── الحُرّاس ─────────────────────────────────────────────────────────────────────────────
function assertRead(user) {
  if (!can(user, 'read', 'event')) throw forbidden('الفعاليات خارج صلاحياتك');
}
function assertManage(user, action) {
  if (can(user, action, 'event')) return;
  // رسالتان لا واحدة: بابُ الحذف صار مدير النظام وحده (قرار ٢٠٢٦-٠٩-٠١)، فرسالةٌ تقول «اطلبه من
  // قائد القطاع» تُرسل صاحبها إلى من لا يملكها هو الآخر — والرسالة التي تدلّ على باب مغلق أسوأ
  // من الصمت. ولا تُذكر بابُ الحذف بلا سببه: الحذف يمحو صور البطاقات والرموز محواً لا رجعة فيه.
  throw forbidden(action === 'delete'
    ? 'حذف الفعالية ليس ضمن صلاحيتك — بابه مدير النظام وحده، لأن الحذف يمحو صور البطاقات والرموز بلا رجعة'
    : 'إنشاء الفعاليات وتعديلها ليس ضمن صلاحيتك — اطلبه من قائد القطاع أو مدير النظام');
}
// resource: «event_contact» للبطاقة و«event_partner» للشراكة — لكلٍّ منحُ إنشائه في المصفوفة.
function assertCapture(user, resource) {
  if (!can(user, 'create', resource)) throw forbidden('صلاحيتك للمشاهدة فقط — اطلب من مدير النظام صلاحية الالتقاط');
}
// الشراكة: الملكية لا تُعوِّض منحاً غائباً — المصفوفة تُسأل أولاً، ثم من سجّل أو من يراجع.
const mayEdit = (user, row, resource) => can(user, 'update', resource)
  && (row.captured_by === user.id || REVIEW_ROLES.includes(user.role_id));
// البطاقة (v5.67): المصفوفة وحدها، بلا صفٍّ هدف ولا مِلكية — من يحمل منحَ التعديل يصحّح أي
// بطاقة ويدير صورها. سؤالٌ وجوديّ لا سؤالُ نطاق: المعرض معرضُ الشركة كلها (قرار المصفوفة).
const mayEditContact = (user) => can(user, 'update', 'event_contact');
const EDIT_DENIED = 'تعديل البطاقات ليس ضمن صلاحيتك — اطلب الصلاحية من مدير النظام';
const mayDelete = (user, row, resource) => (row.captured_by === user.id && can(user, 'update', resource))
  || can(user, 'delete', resource);

// ══ الفعاليات ═══════════════════════════════════════════════════════════════════════════
const EVENT_COLS = ['id', 'name_ar', 'venue', 'starts_on', 'ends_on', 'booth_no', 'created_by', 'created_by_name',
  'created_at', 'updated_at', 'closed_at'];
const eventSelect = (a = 'e') => EVENT_COLS.map((k) => `${a}.${k}`).join(', ');
const withStatus = (row, day) => ({ ...row, status: eventStatus(row, day) });

async function loadEvent(eventId) {
  const row = await get(`SELECT ${eventSelect('e')} FROM event e WHERE e.id = ? AND e.deleted_at IS NULL`, [String(eventId || '')]);
  if (!row) throw notFound('الفعالية غير موجودة');
  return row;
}

// الحقول المقبولة للفعالية — عند الإنشاء كلها تُقرأ، وعند التعديل ما ورد في الطلب فقط.
function eventPatch(data, base = null) {
  const has = (k) => base === null || k in data;
  const p = {};
  if (has('name_ar')) {
    const v = clean(data.name_ar);
    if (!v) throw badRequest('اكتب اسم الفعالية — كلمتان تكفيان، مثل: معرض التقنية 2026');
    p.name_ar = v;
  }
  if (has('venue')) p.venue = clean(data.venue);
  if (has('booth_no')) p.booth_no = clean(data.booth_no, 40);
  if (has('starts_on')) {
    p.starts_on = asDay(data.starts_on);
    if (!p.starts_on) throw badRequest('اكتب تاريخ بداية الفعالية بصيغة سنة-شهر-يوم');
  }
  if (has('ends_on')) {
    p.ends_on = asDay(data.ends_on);
    if (!p.ends_on) throw badRequest('اكتب تاريخ نهاية الفعالية بصيغة سنة-شهر-يوم');
  }
  const s = p.starts_on ?? base?.starts_on;
  const e = p.ends_on ?? base?.ends_on;
  if (s && e && e < s) throw badRequest('تاريخ النهاية قبل تاريخ البداية — صحّح أحد التاريخين');
  return p;
}

export async function listEvents(user, opts = {}) {
  assertRead(user);
  const includeClosed = truthy(opts.includeClosed);
  const rows = await all(`SELECT ${eventSelect('e')},
      (SELECT COUNT(*) FROM event_contact c WHERE c.event_id = e.id AND c.deleted_at IS NULL) AS contacts,
      (SELECT COUNT(*) FROM event_partner p WHERE p.event_id = e.id AND p.deleted_at IS NULL) AS partners
     FROM event e
     WHERE e.deleted_at IS NULL ${includeClosed ? '' : 'AND e.closed_at IS NULL'}
     ORDER BY e.starts_on DESC, e.created_at DESC`);
  const day = today();
  return rows.map((r) => withStatus({ ...r, contacts: Number(r.contacts || 0), partners: Number(r.partners || 0) }, day));
}

export async function getEvent(user, eventId) {
  assertRead(user);
  return withStatus(await loadEvent(eventId));
}

export async function eventSummary(user, eventId) {
  assertRead(user);
  const ev = await loadEvent(eventId);
  const base = 'FROM event_contact WHERE event_id = ? AND deleted_at IS NULL';
  const n = (extra = '', params = []) => count(`SELECT COUNT(*) AS n ${base} ${extra}`, [ev.id, ...params]);
  const byKind = {};
  for (const r of await all(`SELECT kind, COUNT(*) AS n ${base} GROUP BY kind`, [ev.id])) byKind[r.kind] = Number(r.n);
  const byOutcome = {};
  for (const r of await all(`SELECT outcome, COUNT(*) AS n ${base} GROUP BY outcome`, [ev.id])) byOutcome[r.outcome] = Number(r.n);
  return {
    contacts: await n(),
    byKind,
    byOutcome,
    today: await n('AND substr(captured_at, 1, 10) = ?', [today()]),
    unreviewed: await n('AND outcome = ?', [OUTCOMES[0]]),
    possibleDup: await n('AND possible_duplicate_of IS NOT NULL'),
    partners: await count('SELECT COUNT(*) AS n FROM event_partner WHERE event_id = ? AND deleted_at IS NULL', [ev.id]),
  };
}

// الفعاليات الجارية اليوم — بلا حارس: من يناديها (الصفحة الرئيسية، الشريط) يحرس بنفسه.
export async function activeEvents(day = today()) {
  return all(`SELECT ${eventSelect('e')} FROM event e
     WHERE e.starts_on <= ? AND e.ends_on >= ? AND e.closed_at IS NULL AND e.deleted_at IS NULL
     ORDER BY e.starts_on, e.name_ar`, [day, day]);
}

export async function createEvent(ctx, data = {}) {
  const user = ctx.user;
  assertManage(user, 'create');
  const p = eventPatch(data, null);
  const eid = id('evt');
  const now = nowIso();
  await tx(async () => {
    await insert('event', { id: eid, ...p, created_by: user.id, created_by_name: nameOf(user), created_at: now });
    await audit(ctx, { action: 'create', resource: 'event', resourceId: eid, sectorId: null,
      detail: { name_ar: p.name_ar, starts_on: p.starts_on, ends_on: p.ends_on } });
  });
  return withStatus(await loadEvent(eid));
}

export async function updateEvent(ctx, eventId, patch = {}) {
  const user = ctx.user;
  assertManage(user, 'update');
  const row = await loadEvent(eventId);
  const p = eventPatch(patch, row);
  if (!Object.keys(p).length) throw badRequest('حدّد ما تريد تغييره في الفعالية');
  p.updated_at = nowIso();
  await tx(async () => {
    await update('event', row.id, p);
    await audit(ctx, { action: 'update', resource: 'event', resourceId: row.id, sectorId: null,
      detail: { fields: Object.keys(p).filter((k) => k !== 'updated_at') } });
  });
  return withStatus(await loadEvent(row.id));
}

// الإغلاق ختمٌ يدوي بعد المراجعة: يوقف الالتقاط ويُخرج الفعالية من القائمة. ويُفتح بالمفتاح نفسه.
export async function closeEvent(ctx, eventId, opts = {}) {
  const user = ctx.user;
  assertManage(user, 'update');
  const row = await loadEvent(eventId);
  const reopen = truthy(opts.reopen);
  const now = nowIso();
  await tx(async () => {
    await update('event', row.id, { closed_at: reopen ? null : now, updated_at: now });
    await audit(ctx, { action: 'update', resource: 'event', resourceId: row.id, sectorId: null, detail: { closed: !reopen } });
  });
  return withStatus(await loadEvent(row.id));
}

export async function deleteEvent(ctx, eventId) {
  const user = ctx.user;
  assertManage(user, 'delete');
  const row = await loadEvent(eventId);
  await tx(async () => {
    await update('event', row.id, { deleted_at: nowIso() });
    // صورُ الفعالية — بطاقاتٍ ورموزَ كشك — تُمحى فعلاً: الصفّ يبقى أثراً ناعماً، والبايتات لا
    // تستحق مكانها في القاعدة بعد أن غاب ما يُقرأ بها (نفس قاعدة حذف البطاقة).
    await run('DELETE FROM event_blob WHERE event_id = ?', [row.id]);
    await audit(ctx, { action: 'delete', resource: 'event', resourceId: row.id, sectorId: null, detail: { name_ar: row.name_ar } });
  });
  return { ok: true };
}

// ══ البطاقات الملتقطة ═══════════════════════════════════════════════════════════════════
// raw_text خارج أعمدة القائمة: قد يبلغ اثني عشر ألف حرف للبطاقة، والقائمة مئة بطاقة. تُقرأ
// مع البطاقة الواحدة فقط.
// أعمدة القائمة هي ما تقرؤه الشاشة. والصور المطبَّعة (phone_norm وأخواتها) مفاتيحُ كشف التكرار
// لا بيانات عرض، ومفتاحُ الالتقاط شأنُ المتصفّح الذي ولّده — فلا يخرج أيٌّ منها في القوائم؛
// المطبَّعات تُقرأ مع البطاقة الواحدة فقط (المراجعة تحتاجها لتفهم لماذا عُلِّمت مكرَّرة)،
// ومفتاح الالتقاط لا يخرج أبداً.
const CONTACT_LIST_COLS = ['id', 'event_id', 'kind', 'person_name', 'org_name', 'job_title', 'phone',
  'email', 'website', 'note', 'sector_id',
  'possible_duplicate_of', 'outcome', 'outcome_note', 'outcome_by', 'outcome_by_name', 'outcome_at',
  'captured_by', 'captured_by_name', 'captured_at', 'updated_at'];
const CONTACT_FULL_COLS = [...CONTACT_LIST_COLS, 'phone_norm', 'email_norm', 'name_norm', 'org_norm', 'raw_text'];
const HAS_PHOTO = (a) => `CASE WHEN EXISTS (SELECT 1 FROM event_blob b WHERE b.kind = 'card' AND b.ref_id = ${a}.id) THEN 1 ELSE 0 END AS has_photo`;
// بصمة الغلاف مع الصفّ: الشاشة تبني بها رابط المصغَّرة فيتغيّر الرابط حين يتغيّر الغلاف — وإلا
// أبقى المتصفّح صورةً قديمة من ذاكرته. فارغةٌ حين لا صورة.
// و«ORDER BY … LIMIT 1» شرطُ صحّةٍ لا زينة منذ الترحيلة ٠٤١: البطاقة صارت تحمل صوراً عدّة،
// واستعلامٌ فرعيّ في قائمة الأعمدة يعيد صفّين يُسقط الطلب كله على بوستجريس بالرمز 21000
// («أعاد الاستعلام الفرعي أكثر من صفّ») — وسكويلايت يبتلعها صامتاً بصفٍّ عشوائي، وهو أسوأ.
// والترتيب هو ترتيب الغلاف نفسه في كل موضع: الأقدم أولاً، والمعرّف فاصلاً عند تساوي اللحظة.
const PHOTO_SHA = (a) => `(SELECT b.sha256 FROM event_blob b WHERE b.kind = 'card' AND b.ref_id = ${a}.id
     ORDER BY b.created_at ASC, b.id ASC LIMIT 1) AS photo_sha`;
// وعددُ الصور: الشاشة تكتب «٣ صور» على المصغَّرة، والعدّ في الاستعلام أرخص من قراءة صفوفها.
const PHOTO_COUNT = (a) => `(SELECT COUNT(*) FROM event_blob b WHERE b.kind = 'card' AND b.ref_id = ${a}.id) AS photo_count`;
const contactSelect = (a = 'c', full = false) =>
  `${(full ? CONTACT_FULL_COLS : CONTACT_LIST_COLS).map((k) => `${a}.${k}`).join(', ')}, ${HAS_PHOTO(a)}, ${PHOTO_SHA(a)}, ${PHOTO_COUNT(a)}`;
// العدّادان رقمان دائماً: سكويلايت يعيد عدداً، وبوستجريس يعيد عدداً كذلك — والتصريح هنا يجعل
// الشاشة تقرأ رقماً بلا سؤال عن المحرّك، وCASE يعود ٠ أو ١ لا صواباً وخطأً.
const normRow = (r) => (r ? { ...r, has_photo: Number(r.has_photo || 0), photo_count: Number(r.photo_count || 0) } : r);
const CONTACT_TEXT = ['person_name', 'org_name', 'job_title', 'phone', 'email', 'website'];

// البطاقة تحت فعاليةٍ محذوفة محذوفةٌ معها: الربط بالفعالية شرطُ القراءة لا زينة — وإلا فُتحت
// بطاقاتُ فعاليةٍ أُزيلت بعنوانها المباشر وعُدِّلت وهي لا تظهر في أي قائمة.
async function loadContact(cid) {
  const row = await get(`SELECT ${contactSelect('c', true)} FROM event_contact c
     JOIN event e ON e.id = c.event_id AND e.deleted_at IS NULL
     WHERE c.id = ? AND c.deleted_at IS NULL`, [String(cid || '')]);
  if (!row) throw notFound('البطاقة غير موجودة');
  return normRow(row);
}
const normsOf = (f) => ({
  phone_norm: normalizePhone(f.phone),
  email_norm: normalizeEmail(f.email),
  name_norm: normalizePerson(f.person_name),
  org_norm: normalizeOrg(f.org_name),
});
async function assertSector(sectorId) {
  if (!sectorId) return;
  const s = await get('SELECT id FROM sector WHERE id = ? AND deleted_at IS NULL', [sectorId]);
  if (!s) throw badRequest('القطاع غير موجود');
}
const textField = (k, v) => (k === 'phone' ? clean(foldDigits(String(v == null ? '' : v))) : clean(v));
// ما يُعرض عن البطاقة الأقدم المشابهة — ما يكفي ليقرّر الملتقِط، لا الصفّ كله.
const summarize = (r) => (r ? {
  id: r.id, kind: r.kind, person_name: r.person_name, org_name: r.org_name, phone: r.phone, email: r.email,
  outcome: r.outcome, captured_by_name: r.captured_by_name, captured_at: r.captured_at,
} : null);

// أقدم بطاقةٍ مشابهة في الفعالية نفسها: بالجوال، أو بالاسم والجهة معاً، أو بالبريد.
// تُبنى الشروط لما وُجد من مفاتيح فقط — فبطاقةٌ بلا جوال لا تُقارَن جوالاً فارغاً بفارغ.
// وعند إعادة الفحص بعد تعديل (beforeAt) تُقارَن البطاقة بما التُقط **قبلها** فقط: الأصلُ لا
// يصير «مكرَّراً» لنسخته الأحدث لمجرد أن صاحبه صحّح مسمّاه.
export async function findPossibleDuplicate(eventId, norms = {}, exceptId = null, beforeAt = null) {
  const ors = [];
  const orParams = [];
  if (norms.phone_norm) { ors.push('c.phone_norm = ?'); orParams.push(norms.phone_norm); }
  if (norms.name_norm && norms.org_norm) { ors.push('(c.name_norm = ? AND c.org_norm = ?)'); orParams.push(norms.name_norm, norms.org_norm); }
  if (norms.email_norm) { ors.push('c.email_norm = ?'); orParams.push(norms.email_norm); }
  if (!ors.length) return null;
  // ترتيب المعاملات يتبع ترتيب العلامات في النص حرفياً — الشروط العامة أولاً ثم مجموعة «أو».
  const params = [eventId];
  let sql = `SELECT ${contactSelect('c')} FROM event_contact c WHERE c.event_id = ? AND c.deleted_at IS NULL`;
  if (exceptId) { sql += ' AND c.id <> ?'; params.push(exceptId); }
  if (beforeAt) { sql += ' AND c.captured_at < ?'; params.push(beforeAt); }
  sql += ` AND (${ors.join(' OR ')}) ORDER BY c.captured_at ASC, c.id ASC LIMIT 1`;
  return (await get(sql, [...params, ...orParams])) || null;
}

// شرطُ التصفية واحدٌ للقائمة وللتصدير معاً (v5.68): ما تراه الشاشة هو ما ينزل في الملف
// حرفاً. ولو انفصل الشرطان لصدّر الملفُ غير ما عُرض وهو يدّعي أنه هو — وخطأٌ كهذا لا
// يُرى إلا بعد أن يُوزَّع الملف على الفريق. ويعود معه `applied`: التصفية كما فُهمت فعلاً
// لا كما وصلت، ليكتبها التدقيق فيُعرف ماذا خرج من المنصة لا ماذا طُلب.
function contactFilter(user, evId, opts = {}) {
  const where = ['c.event_id = ?', 'c.deleted_at IS NULL'];
  const params = [evId];
  const q = clean(opts.q, 80);
  if (q) {
    const like = '%' + q.toLowerCase() + '%';
    const ors = ["LOWER(COALESCE(c.person_name, '')) LIKE ?", "LOWER(COALESCE(c.org_name, '')) LIKE ?",
      "LOWER(COALESCE(c.phone, '')) LIKE ?", "LOWER(COALESCE(c.email, '')) LIKE ?"];
    params.push(like, like, like, like);
    // رقمٌ مكتوب بأي صيغة يُبحث عنه بصورته المطبَّعة أيضاً: «+966 50…» تجد «0501234567».
    const digits = foldDigits(q).replace(/\D/g, '');
    const pn = normalizePhone(q);
    for (const d of new Set([pn, digits.length >= 4 ? digits : null].filter(Boolean))) {
      ors.push("COALESCE(c.phone_norm, '') LIKE ?");
      params.push('%' + d + '%');
    }
    where.push(`(${ors.join(' OR ')})`);
  }
  const kind = clean(opts.kind);
  if (kind) { where.push('c.kind = ?'); params.push(kind); }
  const outcome = clean(opts.outcome);
  if (outcome) { where.push('c.outcome = ?'); params.push(outcome); }
  const mine = truthy(opts.mine);
  if (mine) { where.push('c.captured_by = ?'); params.push(user.id); }
  const dup = truthy(opts.dup);
  if (dup) where.push('c.possible_duplicate_of IS NOT NULL');
  return { sql: where.join(' AND '), params,
    applied: { q: q || null, kind: kind || null, outcome: outcome || null, mine, dup } };
}

export async function listContacts(user, eventId, opts = {}) {
  assertRead(user);
  const ev = await loadEvent(eventId);
  const f = contactFilter(user, ev.id, opts);
  // الحدّ عددٌ صحيح دائماً — «1.5» في العنوان لا يصل إلى الاستعلام نصاً.
  const limit = Math.max(1, Math.min(500, Math.floor(Number(opts.limit)) || 100));
  return (await all(`SELECT ${contactSelect('c')} FROM event_contact c
     WHERE ${f.sql}
     ORDER BY c.captured_at DESC, c.id DESC
     LIMIT ${limit}`, f.params)).map(normRow);
}

// «آخر ما التقطت» + عدّاد الفريق اليوم — ما يراه الملتقِط تحت النموذج بين لقاءين.
export async function recentContacts(user, eventId, opts = {}) {
  assertRead(user);
  const ev = await loadEvent(eventId);
  const limit = Math.max(1, Math.min(50, Math.floor(Number(opts.limit)) || 12));
  const rows = await all(`SELECT ${contactSelect('c')} FROM event_contact c
     WHERE c.event_id = ? AND c.deleted_at IS NULL AND c.captured_by = ?
     ORDER BY c.captured_at DESC, c.id DESC
     LIMIT ${limit}`, [ev.id, user.id]);
  const teamToday = await count(`SELECT COUNT(*) AS n FROM event_contact
     WHERE event_id = ? AND deleted_at IS NULL AND substr(captured_at, 1, 10) = ?`, [ev.id, today()]);
  return { rows: rows.map(normRow), teamToday };
}

// مع البطاقة الواحدة حكمُ التعديل جاهزاً وقائمةُ صورها كاملةً: نافذةُ المراجعة تعرض الحقول
// للكتابة أو للقراءة بحسب الحكم، وتعرض الصور شريطاً بغلافها أولاً — والقرار قرارُ الخدمة
// نفسها (mayEditContact) لا تخمينُ الشاشة، والصورُ نداءٌ واحد لا نداءان.
export async function getContact(user, cid) {
  assertRead(user);
  const row = await loadContact(cid);
  return { ...row, may_edit: mayEditContact(user), photos: await contactPhotos(row) };
}

// خرقُ التفرّد على (event_id, capture_key): سكويلايت يقولها في نصّ الخطأ، وبوستجريس برمزه.
export const isUniqueViolation = (e) => !!e
  && (String(e.code || '') === '23505' || /UNIQUE constraint failed/i.test(String(e.message || '')));

// الصفّ الذي يحمل مفتاح الالتقاط هذا في هذه الفعالية — لصاحبه وحده، وما حُذف لا يُستأنف.
async function resumeByKey(ev, captureKey, user) {
  const prior = await get('SELECT id, captured_by, deleted_at FROM event_contact WHERE event_id = ? AND capture_key = ?', [ev.id, captureKey]);
  if (!prior) return null;
  if (prior.deleted_at) throw badRequest('هذه البطاقة حُذفت من قبل — حدّث الصفحة وأعد الإدخال');
  if (prior.captured_by !== user.id) throw badRequest('هذا الالتقاط مسجَّل باسم زميل — حدّث الصفحة وأعد الإدخال');
  const contact = await loadContact(prior.id);
  const dup = contact.possible_duplicate_of
    ? await get(`SELECT ${contactSelect('c')} FROM event_contact c WHERE c.id = ?`, [contact.possible_duplicate_of]) : null;
  return { contact, possibleDuplicate: summarize(dup), resumed: true };
}

export async function createContact(ctx, eventId, data = {}) {
  const user = ctx.user;
  assertCapture(user, 'event_contact');
  const ev = await loadEvent(eventId);
  if (ev.closed_at) throw badRequest('هذه الفعالية مُغلقة — لا يُلتقط فيها جديد');

  // مفتاح الالتقاط: الشبكة انقطعت بعد الحفظ فأعاد المتصفّح الإرسال — نُعيد الصفّ نفسه بلا كتابة.
  const captureKey = clean(data.capture_key, 80);
  if (captureKey) {
    const resumed = await resumeByKey(ev, captureKey, user);
    if (resumed) return resumed;
  }

  const kind = clean(data.kind);
  if (!CARD_KINDS.includes(kind)) throw badRequest('نوع البطاقة غير معروف — اختر: تعريف بالشركة / شراكة / تعاون / توظيف');
  const f = {};
  for (const k of CONTACT_TEXT) f[k] = textField(k, data[k]);
  f.note = clean(data.note, NOTE_MAX, MULTI);
  f.raw_text = clean(data.raw_text, RAW_MAX, MULTI);
  f.sector_id = clean(data.sector_id, 80);
  if (!f.person_name && !f.org_name && !f.phone) throw badRequest('اكتب اسم الشخص أو جهته أو رقم جوّاله — حقل واحد يكفي');
  await assertSector(f.sector_id);
  const norms = normsOf(f);
  const dup = await findPossibleDuplicate(ev.id, norms, null);

  const cid = id('evc');
  const now = nowIso();
  try {
    await tx(async () => {
      await insert('event_contact', {
        id: cid, event_id: ev.id, kind, ...f, ...norms,
        capture_key: captureKey, possible_duplicate_of: dup ? dup.id : null,
        outcome: OUTCOMES[0],
        captured_by: user.id, captured_by_name: nameOf(user), captured_at: now,
      });
      await audit(ctx, { action: 'create', resource: 'event_contact', resourceId: cid, sectorId: f.sector_id || null,
        detail: { event_id: ev.id, kind, dup: dup ? dup.id : null } });
    });
  } catch (e) {
    // السباق: الطلبُ وإعادتُه وصلا معاً فمرّا كلاهما من فحص المفتاح قبل أن يكتب أحدهما — الفهرس
    // الفريد يوقف الثاني، فنعامله كإعادة إرسال لا كعطل: الصفّ الأول هو الجواب، ولا صفّ ثانٍ.
    if (captureKey && isUniqueViolation(e)) {
      const resumed = await resumeByKey(ev, captureKey, user);
      if (resumed) return resumed;
    }
    throw e;
  }
  return { contact: await loadContact(cid), possibleDuplicate: summarize(dup), resumed: false };
}

export async function updateContact(ctx, cid, patch = {}) {
  const user = ctx.user;
  assertRead(user);
  const row = await loadContact(cid);
  if (!mayEditContact(user)) throw forbidden(EDIT_DENIED);
  const p = {};
  if ('kind' in patch) {
    const kind = clean(patch.kind);
    if (!CARD_KINDS.includes(kind)) throw badRequest('نوع البطاقة غير معروف — اختر: تعريف بالشركة / شراكة / تعاون / توظيف');
    p.kind = kind;
  }
  for (const k of CONTACT_TEXT) if (k in patch) p[k] = textField(k, patch[k]);
  if ('note' in patch) p.note = clean(patch.note, NOTE_MAX, MULTI);
  if ('sector_id' in patch) { p.sector_id = clean(patch.sector_id, 80); await assertSector(p.sector_id); }
  // raw_text وcapture_key وحقول المتابعة لا تمرّ من هنا: الأول أثرٌ لا يُمَسّ، والمتابعة لها مسارها.
  if (!Object.keys(p).length) throw badRequest('حدّد ما تريد تغييره في البطاقة');
  const merged = { ...row, ...p };
  if (!merged.person_name && !merged.org_name && !merged.phone) throw badRequest('اكتب اسم الشخص أو جهته أو رقم جوّاله — حقل واحد يكفي');
  const changed = Object.keys(p);
  Object.assign(p, normsOf(merged));
  const dup = await findPossibleDuplicate(row.event_id, p, row.id, row.captured_at);
  p.possible_duplicate_of = dup ? dup.id : null;
  p.updated_at = nowIso();
  await tx(async () => {
    await update('event_contact', row.id, p);
    await audit(ctx, { action: 'update', resource: 'event_contact', resourceId: row.id, sectorId: merged.sector_id || null,
      detail: { event_id: row.event_id, fields: changed, dup: p.possible_duplicate_of } });
  });
  return loadContact(row.id);
}

export async function setOutcome(ctx, cid, data = {}) {
  const user = ctx.user;
  assertRead(user);
  const row = await loadContact(cid);
  if (!mayEditContact(user)) throw forbidden(EDIT_DENIED);
  const outcome = clean(data.outcome);
  if (!OUTCOMES.includes(outcome)) throw badRequest('قيمة المتابعة غير معروفة — اختر من القائمة');
  const now = nowIso();
  const p = { outcome, outcome_by: user.id, outcome_by_name: nameOf(user), outcome_at: now, updated_at: now };
  if ('outcome_note' in data) p.outcome_note = clean(data.outcome_note, NOTE_MAX, MULTI);
  await tx(async () => {
    await update('event_contact', row.id, p);
    await audit(ctx, { action: 'update', resource: 'event_contact', resourceId: row.id, sectorId: row.sector_id || null,
      detail: { event_id: row.event_id, outcome } });
  });
  return loadContact(row.id);
}

export async function deleteContact(ctx, cid) {
  const user = ctx.user;
  assertRead(user);
  const row = await loadContact(cid);
  if (!mayDelete(user, row, 'event_contact')) throw forbidden('حذف هذه البطاقة لمن التقطها أو لقيادة الفريق');
  await tx(async () => {
    await update('event_contact', row.id, { deleted_at: nowIso() });
    // الصور كلها تُمحى فعلاً لا ناعماً — واحدةً كانت أو ستّاً (الترحيلة ٠٤١): بايتاتٌ بلا
    // بطاقةٍ تُقرأ لا تستحق مكانها في القاعدة. والعبارة تمحو ما وجدت بلا عدّ، فهي محمولةٌ على العدد.
    await run(`DELETE FROM event_blob WHERE kind = 'card' AND ref_id = ?`, [row.id]);
    await audit(ctx, { action: 'delete', resource: 'event_contact', resourceId: row.id, sectorId: row.sector_id || null,
      detail: { event_id: row.event_id } });
  });
  return { ok: true };
}

// ══ تصدير الجهات الملتقطة ملفَّ Excel (v5.68) ═══════════════════════════════════════════
// بعد المعرض يُقسَّم ما التُقط على الفريق ويُوزَّع على القطاعات: ملفٌّ واحد يُفتح في الجدول،
// تُرتَّب فيه الصفوف وتُكتب المتابعة بجوارها. وهذا ما كان يُفعل باليد نسخاً من الشاشة.
//
// والباب هو باب القراءة نفسه (قرار المالك ٢٠٢٦-٠٩-٠١، بعد أن كان لمن يدير الفعالية وحده في
// v5.68): من يقرأ البطاقات على الشاشة يُنزِلها ملفاً — لا شيء في الملف زائدٌ على الشاشة. أما
// «الخارجي» فلا يبلغ الفعاليات أصلاً. وكلُّ تصدير يُكتب في التدقيق بعدد صفوفه وتصفيته.
//
// وما لا يخرج أبداً: النصّ الخام (raw_text)، ومفتاح الالتقاط، والمفاتيح المطبَّعة — الأول
// أصلٌ يُرجَع إليه عند الخلاف لا بيانٌ يُوزَّع، والباقي شأنُ الآلة لا شأنُ قارئ.
const EXPORT_COLUMNS = [
  { key: 'person_name', labelAr: 'الشخص' },
  { key: 'org_name', labelAr: 'الجهة' },
  { key: 'job_title', labelAr: 'المنصب' },
  { key: 'phone', labelAr: 'الجوّال' },
  { key: 'email', labelAr: 'البريد' },
  { key: 'website', labelAr: 'الموقع الإلكتروني' },
  { key: 'kind', labelAr: 'نوع البطاقة' },
  { key: 'sector_name', labelAr: 'القطاع المعني' },
  { key: 'outcome', labelAr: 'المتابعة' },
  { key: 'outcome_note', labelAr: 'ملاحظة المتابعة' },
  { key: 'note', labelAr: 'ملاحظة' },
  { key: 'dup', labelAr: 'قد تكون مكرّرة' },
  { key: 'captured_by_name', labelAr: 'التقطها' },
  { key: 'captured_at', labelAr: 'وقت الالتقاط' },
  { key: 'photo_count', labelAr: 'عدد الصور' },
  { key: 'photo_url', labelAr: 'رابط الصورة' },
];
// الرؤوس مُصدَّرة كي يقيسها الاختبار على مصدرها لا على نسخةٍ منها.
export const EXPORT_HEADERS = EXPORT_COLUMNS.map((c) => c.labelAr);
const SECTOR_UNSET = 'غير محدَّد';
// سقفٌ أعلى من أي معرض بمرات: أضخمُ ما يُلتقط مئاتٌ قليلة، والسقف حارسُ ذاكرةٍ لا قاعدةُ
// عمل — وعددُ ما خرج فعلاً مكتوبٌ في التدقيق فلا يُظنّ ناقصٌ كاملاً.
const EXPORT_MAX_ROWS = 5000;

// وقتُ الالتقاط بساعة الرياض لا بساعة غرينتش: من يقرأ الملف يقرأ ساعة الجناح. والإزاحة
// ثابتة (+٣ بلا توقيت صيفي) فهي جمعٌ لا جدولُ مناطق — مصدرها core/i18n/time.js.
const riyadhStamp = (iso) => {
  const t = new Date(String(iso || ''));
  if (Number.isNaN(t.getTime())) return '';
  const s = new Date(t.getTime() + RIYADH_OFFSET_HOURS * 3600000).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
};
// رابطٌ مطلق لا نسبيّ: الملف يُقرأ خارج المتصفّح فلا أصلَ يُكمَّل منه العنوان. والصورة تبقى
// خلف الدخول كما هي — الرابط يفتحها لمن يقرأ الفعالية، لا لمن وصله الملف.
const contactPhotoLink = (cid) =>
  `${String(config.platformUrl || '').replace(/\/+$/, '')}/api/events/contacts/${encodeURIComponent(cid)}/photo`;

export async function exportContacts(ctx, eventId, filters = {}) {
  const user = ctx.user;
  // بابُ التصدير هو بابُ القراءة نفسه (قرار المالك ٢٠٢٦-٠٩-٠١): الملف لا يحمل حرفاً لا يراه
  // صاحبه على الشاشة — الصفوف صفوفُها والتصفية تصفيتُها — فحجزُ الصيغة مع بقاء البيان مفتوحاً
  // قفلٌ على بابٍ بلا جدار. ويبقى لكل تصديرٍ صفٌّ في التدقيق: من صدّر، وكم صفّاً، وبأي تصفية.
  assertRead(user);
  const ev = await loadEvent(eventId);
  const f = contactFilter(user, ev.id, filters);
  // ترتيبُ الملف ترتيبُ الالتقاط (الأقدم أوّلاً) لا ترتيبُ الشاشة: الشاشة تعرض الجديد أوّلاً
  // لأن الملتقِط يراجع ما توّه التقطه، والملفُ يُقرأ بعد المعرض فيمشي مع اليوم كما جرى.
  const rows = (await all(`SELECT ${contactSelect('c')} FROM event_contact c
     WHERE ${f.sql}
     ORDER BY c.captured_at ASC, c.id ASC
     LIMIT ${EXPORT_MAX_ROWS}`, f.params)).map(normRow);
  // اسم القطاع يُقرأ استعلاماً واحداً لا استعلاماً لكل صفّ — والبطاقة تحمل معرّفه لا اسمه.
  const sectorName = new Map((await all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL'))
    .map((s) => [s.id, s.name_ar]));

  const data = rows.map((r) => ({
    person_name: r.person_name || '',
    org_name: r.org_name || '',
    job_title: r.job_title || '',
    phone: r.phone || '',
    email: r.email || '',
    website: r.website || '',
    kind: r.kind || '',
    sector_name: (r.sector_id && sectorName.get(r.sector_id)) || SECTOR_UNSET,
    outcome: r.outcome || '',
    outcome_note: r.outcome_note || '',
    note: r.note || '',
    dup: r.possible_duplicate_of ? 'نعم' : '',
    captured_by_name: r.captured_by_name || '',
    captured_at: riyadhStamp(r.captured_at),
    photo_count: r.photo_count || 0,
    photo_url: r.has_photo ? contactPhotoLink(r.id) : '',
  }));

  const out = buildExport({ columns: EXPORT_COLUMNS, rows: data, sheetName: 'الجهات الملتقطة' });
  await audit(ctx, { action: 'export', resource: 'event_contact', resourceId: ev.id, sectorId: null,
    detail: { event_id: ev.id, rows: rows.length, filters: f.applied } });
  return { buffer: out.buffer, mime: out.mime, fileName: `الجهات الملتقطة — ${ev.name_ar}.${out.ext}` };
}

// قراءة نصّ البطاقة — محلياً، بلا حفظ: الشاشة تعرض المقترَح ويراجعه الملتقِط ثم يحفظ بنفسه.
export async function parseCard(user, data = {}) {
  assertCapture(user, 'event_contact');
  // القصّ قبل التشذيب: نصٌّ من فراغاتٍ طويلة ثم كلام لا يُشذَّب كاملاً قبل أن يُحدّ.
  const text = String(data.text == null ? '' : data.text).slice(0, RAW_MAX).trim();
  if (text.length < 5) throw badRequest('الصق نصّ البطاقة أولاً — سطر واحد يكفي');
  return { ...parseCardText(text), _mode: 'local', _note: 'استُخرج محلياً من النصّ — راجع الحقول قبل الحفظ' };
}

// ══ الشراكات ════════════════════════════════════════════════════════════════════════════
const PARTNER_COLS = ['id', 'event_id', 'org_name', 'org_norm', 'partner_kind', 'contact_name', 'phone', 'email', 'website',
  'scope_note', 'status', 'next_step', 'next_date', 'contact_id', 'captured_by', 'captured_by_name', 'captured_at', 'updated_at'];
const partnerSelect = (a = 'p') => PARTNER_COLS.map((k) => `${a}.${k}`).join(', ');

// كالبطاقة: الشراكة تحت فعاليةٍ محذوفة لا تُقرأ ولا تُعدَّل.
async function loadPartner(pid) {
  const row = await get(`SELECT ${partnerSelect('p')} FROM event_partner p
     JOIN event e ON e.id = p.event_id AND e.deleted_at IS NULL
     WHERE p.id = ? AND p.deleted_at IS NULL`, [String(pid || '')]);
  if (!row) throw notFound('الشراكة غير موجودة');
  return row;
}

async function partnerPatch(data, base, eventId) {
  const has = (k) => base === null || k in data;
  const p = {};
  if (has('org_name')) {
    const v = clean(data.org_name);
    if (!v) throw badRequest('اكتب اسم جهة التعاون');
    p.org_name = v;
    p.org_norm = normalizeOrg(v) || v.toLowerCase();
  }
  if (has('partner_kind')) {
    p.partner_kind = clean(data.partner_kind, 60);
    if (p.partner_kind && !PARTNER_KINDS.includes(p.partner_kind)) throw badRequest('نوع الشراكة غير معروف — اختر من القائمة');
  }
  for (const k of ['contact_name', 'phone', 'email', 'website']) if (has(k)) p[k] = textField(k, data[k]);
  if (has('scope_note')) p.scope_note = clean(data.scope_note, NOTE_MAX, MULTI);
  if (has('next_step')) p.next_step = clean(data.next_step, 400);
  if (has('status')) {
    const v = clean(data.status, 60) || (base === null ? PARTNER_STATUSES[0] : null);
    if (!PARTNER_STATUSES.includes(v)) throw badRequest('حالة الشراكة غير معروفة — اختر من القائمة');
    p.status = v;
  }
  if (has('next_date')) {
    const raw = clean(data.next_date, 20);
    p.next_date = raw ? asDay(raw) : null;
    if (raw && !p.next_date) throw badRequest('اكتب موعد الخطوة التالية بصيغة سنة-شهر-يوم');
  }
  if (has('contact_id')) {
    p.contact_id = clean(data.contact_id, 80);
    if (p.contact_id) {
      const c = await get('SELECT id FROM event_contact WHERE id = ? AND event_id = ? AND deleted_at IS NULL', [p.contact_id, eventId]);
      if (!c) throw badRequest('البطاقة المختارة ليست من هذه الفعالية');
    }
  }
  return p;
}

export async function listPartners(user, eventId) {
  assertRead(user);
  const ev = await loadEvent(eventId);
  return all(`SELECT ${partnerSelect('p')} FROM event_partner p
     WHERE p.event_id = ? AND p.deleted_at IS NULL
     ORDER BY p.captured_at DESC, p.id DESC`, [ev.id]);
}

export async function createPartner(ctx, eventId, data = {}) {
  const user = ctx.user;
  assertCapture(user, 'event_partner');
  const ev = await loadEvent(eventId);
  if (ev.closed_at) throw badRequest('هذه الفعالية مُغلقة — لا يُلتقط فيها جديد');
  const p = await partnerPatch(data, null, ev.id);
  const pid = id('evp');
  const now = nowIso();
  await tx(async () => {
    await insert('event_partner', { id: pid, event_id: ev.id, ...p, captured_by: user.id, captured_by_name: nameOf(user), captured_at: now });
    await audit(ctx, { action: 'create', resource: 'event_partner', resourceId: pid, sectorId: null,
      detail: { event_id: ev.id, partner_kind: p.partner_kind || null, status: p.status } });
  });
  return loadPartner(pid);
}

export async function updatePartner(ctx, pid, patch = {}) {
  const user = ctx.user;
  assertRead(user);
  const row = await loadPartner(pid);
  if (!mayEdit(user, row, 'event_partner')) throw forbidden('تعديل هذه الشراكة لمن سجّلها أو لقيادة الفريق');
  const p = await partnerPatch(patch, row, row.event_id);
  if (!Object.keys(p).length) throw badRequest('حدّد ما تريد تغييره في الشراكة');
  const changed = Object.keys(p);
  p.updated_at = nowIso();
  await tx(async () => {
    await update('event_partner', row.id, p);
    await audit(ctx, { action: 'update', resource: 'event_partner', resourceId: row.id, sectorId: null,
      detail: { event_id: row.event_id, fields: changed, status: p.status || row.status } });
  });
  return loadPartner(row.id);
}

export async function deletePartner(ctx, pid) {
  const user = ctx.user;
  assertRead(user);
  const row = await loadPartner(pid);
  if (!mayDelete(user, row, 'event_partner')) throw forbidden('حذف هذه الشراكة لمن سجّلها أو لقيادة الفريق');
  await tx(async () => {
    await update('event_partner', row.id, { deleted_at: nowIso() });
    await audit(ctx, { action: 'delete', resource: 'event_partner', resourceId: row.id, sectorId: null,
      detail: { event_id: row.event_id } });
  });
  return { ok: true };
}

// ══ الصور: صورة البطاقة ورموز الكشك (E2) ═══════════════════════════════════════════════
// البايتات في القاعدة (الترحيلة ٠٣٨ على قرار ٠٣٣: قرص الحاوية يزول مع كل نشرة). صنفان في جدولٍ
// واحد: «card» صورةُ بطاقةٍ مرجعُها البطاقة — صفٌّ لكل صورة، وللبطاقة صورٌ عدّة منذ الترحيلة
// ٠٤١ التي أسقطت الفهرس الفريد (kind, ref_id)، والسقفُ في الخدمة لا في القاعدة — و«qr»
// صورةُ رمزٍ يُعرض على شاشة الجناح ليمسحه الزائر، مرجعُها نفسُها وعنوانُها ما يقرؤه الزائر
// (الترحيلة ٠٣٩).
//
// النوع من البايتات لا من ترويسة المتصفّح ولا من اسم الملف: الترويسة تصريحُ مرسِل، والاسم أهونُ
// منها — وما سنقدّمه لاحقاً بـ«صورة» يجب أن يكون صورة. والحدّ ثمانية ميغابايت: صورةُ كاميرا
// الجوال المضغوطة تقلّ عنه بكثير، وما فوقه ملفٌّ من الاستوديو بدقّته الخام لا التقاطٌ من الزرّ.
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_TOO_LARGE_MESSAGE = 'حجم الصورة يتجاوز الحدّ (8 ميغابايت) — التقطها بالكاميرا من الزرّ بدل الاستوديو';
const QR_TITLE_MAX = 120;

// ── سقوف التخزين ──────────────────────────────────────────────────────────────────────────
// البايتات في القاعدة، والقاعدة ليست قرصاً بلا قاع: حسابٌ واحد بمفتاح جلسةٍ صالح يستطيع — بلا
// هذه السقوف — أن يملأها في ساعةٍ بصورٍ من ثمانية ميغابايت. فلكل جناحٍ حدٌّ من رموز الزوّار
// (شاشةٌ واحدة لا تعرض أكثر)، ولكل بطاقةٍ حدٌّ من صورها (وجهاها وكُتيّبٌ وما زاد — والستّ سعةٌ
// لا ضيق)، ولكل حسابٍ ميزانيةُ يومٍ ملفّاتٍ وبايتات تُحسب على ما بقي له في القاعدة خلال الأربع
// والعشرين ساعة الماضية.
// كائنٌ قابلٌ للتعديل عمداً: الاختبار يخفضه ليبلغ السقف بثلاث صور لا بثلاثمئة.
export const UPLOAD_LIMITS = { qrPerEvent: 12, photosPerCard: 6, dailyFiles: 300, dailyBytes: 500 * 1024 * 1024 };
const DAILY_LIMIT_MESSAGE = 'بلغ حسابك حدّ رفع الصور لليوم — تواصل مع مدير النظام إن كان الجناح يحتاج أكثر';
// كل صورةٍ مقبولة إضافةٌ صافية منذ الترحيلة ٠٤١: لا استبدال يُطرح من الحساب، فلا معاملَ خصمٍ هنا
// — ما يُحتسب هو ما سيُكتب، وما يزول لا يزول إلا بحذفٍ صريح يسبق الرفع.
async function assertDailyBudget(user, addBytes) {
  const since = new Date(Date.now() - 86400000).toISOString();
  const r = await get('SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS b FROM event_blob WHERE uploaded_by = ? AND created_at >= ?', [user.id, since]);
  const files = Number(r?.n || 0);
  const bytes = Number(r?.b || 0);
  if (files >= UPLOAD_LIMITS.dailyFiles || bytes + addBytes > UPLOAD_LIMITS.dailyBytes) throw badRequest(DAILY_LIMIT_MESSAGE);
}
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const imageExt = (mime) => IMAGE_EXT[mime] || 'bin';

// توقيع الصورة في أوائل بايتاتها: JPEG وPNG وWEBP — وما سواها ليس صورةً نقبلها.
export function sniffImageMime(buf) {
  if (!buf || typeof buf !== 'object' || typeof buf.length !== 'number') return null;
  const at = (i, v) => buf[i] === v;
  if (buf.length >= 3 && at(0, 0xFF) && at(1, 0xD8) && at(2, 0xFF)) return 'image/jpeg';
  if (buf.length >= 8 && [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].every((v, i) => at(i, v))) return 'image/png';
  if (buf.length >= 12 && at(0, 0x52) && at(1, 0x49) && at(2, 0x46) && at(3, 0x46)
    && at(8, 0x57) && at(9, 0x45) && at(10, 0x42) && at(11, 0x50)) return 'image/webp';
  return null;
}

// الحُرّاس الثلاثة على كل صورة تُرفع — بالترتيب: فارغة، ثم فوق الحدّ، ثم ليست صورة.
function checkImage(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw badRequest('الصورة فارغة — أعد الالتقاط');
  if (bytes.length > PHOTO_MAX_BYTES) throw badRequest(PHOTO_TOO_LARGE_MESSAGE);
  const mime = sniffImageMime(bytes);
  if (!mime) throw badRequest('صيغة الصورة غير مدعومة — التقطها بالكاميرا من الزرّ وتُحفظ صورةً عادية');
  return { mime, sha256: createHash('sha256').update(bytes).digest('hex') };
}
// بايتات الصفّ كما يعيدها المحرّك: بوستجريس يعيد Buffer، وسكويلايت Uint8Array — والمرسِل يريد Buffer.
const asBuffer = (c) => (Buffer.isBuffer(c) ? c
  : ArrayBuffer.isView(c) ? Buffer.from(c.buffer, c.byteOffset, c.byteLength) : Buffer.from(c || []));
// رابط غلاف البطاقة ببصمته: يتغيّر حين يتغيّر الغلاف، فلا يعرض المتصفّح قديماً من ذاكرته.
const photoUrl = (cid, sha) => '/api/events/contacts/' + cid + '/photo?v=' + sha.slice(0, 12);
// ورابط صورةٍ بعينها بمعرّفها — المعرّف لا يتكرّر ولا يتغيّر محتواه، فلا حاجة لبصمةٍ فيه.
const photoPath = (cid, bid) => '/api/events/contacts/' + cid + '/photos/' + bid;

// أسماء من رفعوا الصور: «من صوّر هذه» سؤالٌ يُسأل في المراجعة، ورقمُ الحساب لا يجيبه. وقراءة
// `app_user` للأسماء داخل عقد العزل (ADR-0013): المحظور جداولُ الفرص والعملاء والمستندات.
async function uploaderNames(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await all(`SELECT id, COALESCE(name_ar, username) AS "name" FROM app_user
     WHERE id IN (${uniq.map(() => '?').join(', ')})`, uniq);
  return new Map(rows.map((r) => [r.id, r.name]));
}

// صور البطاقة بعقدها المعلن: الأقدم أولاً — وهو الغلاف — ثم ما بعده بترتيب التقاطه. و`is_cover`
// محسوبةٌ من الموضع لا مقروءةٌ من عمود: عمودٌ يُخزِّن الغلاف حقيقةٌ ثانية تكذب عند أول حذف.
async function contactPhotos(row) {
  const rows = await all(`SELECT b.id, b.sha256, b.mime, b.size_bytes, b.uploaded_by, b.created_at
     FROM event_blob b WHERE b.kind = 'card' AND b.ref_id = ?
     ORDER BY b.created_at ASC, b.id ASC`, [row.id]);
  const names = await uploaderNames(rows.map((r) => r.uploaded_by));
  return rows.map((r, i) => ({
    id: r.id, sha256: r.sha256, mime: r.mime, size_bytes: Number(r.size_bytes),
    uploaded_by: r.uploaded_by, uploaded_by_name: names.get(r.uploaded_by) || null,
    created_at: r.created_at, is_cover: i === 0, url: photoPath(row.id, r.id),
  }));
}
// صفوفُ صور البطاقة مرتَّبةً — بلا بايتات: الغلافُ أولُها، والعدُّ طولُها.
const cardBlobs = (contactId) => all(`SELECT id, sha256, size_bytes FROM event_blob
   WHERE kind = 'card' AND ref_id = ? ORDER BY created_at ASC, id ASC`, [contactId]);

// ── صور البطاقة: قائمةٌ لا صورةٌ واحدة (v5.67، الترحيلة ٠٤١) ──────────────────────────────
// من يحمل منح تعديل البطاقات يُرفق ويحذف. والفعالية المُغلقة لا تمنع: البطاقة قائمة، وصورتُها
// جزءٌ منها لا التقاطٌ جديد — أما ما تحت فعاليةٍ محذوفة فلا يُفتح أصلاً (loadContact).
//
// الإضافةُ إضافة: الوجه الثاني لا يمحو الأول، والكُتيّب لا يمحو البطاقة. والترتيب هو الأقدمية،
// وأقدمُها الغلاف — يُحسب هنا في كل قراءة ولا يُخزَّن في عمود.
export async function attachContactPhoto(ctx, cid, bytes, { fileName } = {}) {
  const user = ctx.user;
  assertRead(user);
  const row = await loadContact(cid);
  if (!mayEditContact(user)) throw forbidden(EDIT_DENIED);
  const { mime, sha256 } = checkImage(bytes);
  const have = await cardBlobs(row.id);
  const coverOf = (list) => (list.length ? photoUrl(row.id, list[0].sha256) : null);
  // الصورة نفسها مرةً ثانية (إعادة إرسال بعد انقطاع، أو ضغطةٌ مكرّرة): لا كتابة ولا أثر ولا
  // احتساب — الحقيقة لم تتغيّر، ويُعاد إليه معرّفُ الصفّ القائم كي يعرف المتصفّح أين هي.
  const same = have.find((b) => b.sha256 === sha256);
  if (same) {
    return { ok: true, id: same.id, sha256, mime, size_bytes: bytes.length, added: false,
      photo_count: have.length, photo_url: coverOf(have), url: photoPath(row.id, same.id) };
  }
  if (have.length >= UPLOAD_LIMITS.photosPerCard) {
    throw badRequest(`بلغت هذه البطاقة حدّ الصور (${UPLOAD_LIMITS.photosPerCard}) — احذف واحدة قبل إضافة أخرى`);
  }
  // ميزانية اليوم بعد سقف البطاقة: من بلغ ستّاً يُقال له «احذف واحدة» — وهو ما يستطيع فعله —
  // لا «بلغتَ حدّ اليوم» الذي لا حيلة له فيه.
  await assertDailyBudget(user, bytes.length);
  const bid = id('evb');
  const photoCount = have.length + 1;
  await tx(async () => {
    // إدراجٌ عادي: الفهرس الفريد (kind, ref_id) أُسقط في الترحيلة ٠٤١، و«عند التعارض حدِّث»
    // بعده خطأُ خادمٍ على بوستجريس (لا فهرس يطابق عناصر التعارض) لا حارساً.
    await insert('event_blob', { id: bid, event_id: row.event_id, kind: 'card', ref_id: row.id, title: null,
      content: bytes, mime, size_bytes: bytes.length, sha256, uploaded_by: user.id, created_at: nowIso() });
    await audit(ctx, { action: 'photo', resource: 'event_contact', resourceId: row.id, sectorId: row.sector_id || null,
      detail: { event_id: row.event_id, blob_id: bid, size_bytes: bytes.length, mime, added: true,
        photo_count: photoCount, file_name: clean(fileName) } });
  });
  // الغلاف لا يتغيّر بإضافةٍ إلا حين تكون الإضافة أولى الصور — فالرابط ثابتٌ لمن يعرضه.
  return { ok: true, id: bid, sha256, mime, size_bytes: bytes.length, added: true, photo_count: photoCount,
    photo_url: have.length ? coverOf(have) : photoUrl(row.id, sha256), url: photoPath(row.id, bid) };
}

// قائمة صور البطاقة لمن يقرأ الفعالية — ومعها حكمُ التعديل، فالشاشة تعرض أزرار الحذف بحسبه.
export async function listContactPhotos(user, cid) {
  assertRead(user);
  const row = await loadContact(cid);
  return { photos: await contactPhotos(row), may_edit: mayEditContact(user) };
}

// بلا معرّف: الغلاف (أقدم الصور). وبمعرّف: تلك الصورة وحدها — مقيَّدةً بصنفها وببطاقتها معاً،
// فمعرّفُ صورةِ بطاقةٍ أخرى أو معرّفُ رمز كشكٍ لا يُقرأ من هنا أبداً.
export async function readContactPhoto(user, cid, bid = null) {
  assertRead(user);
  const row = await loadContact(cid);
  const cols = 'content, mime, sha256, size_bytes';
  const b = bid
    ? await get(`SELECT ${cols} FROM event_blob WHERE id = ? AND kind = 'card' AND ref_id = ?`, [String(bid), row.id])
    : await get(`SELECT ${cols} FROM event_blob WHERE kind = 'card' AND ref_id = ?
         ORDER BY created_at ASC, id ASC LIMIT 1`, [row.id]);
  if (!b) throw notFound(bid ? 'هذه الصورة غير موجودة — حدّث الصفحة' : 'لا صورة لهذه البطاقة بعد — أرفقها من القائمة');
  return { mime: b.mime, content: asBuffer(b.content), sha256: b.sha256, size_bytes: Number(b.size_bytes) };
}

// حذف صورةٍ واحدة: محوٌ فعليّ كعرف الصور كلها في القسم، ويعود بالغلاف الجديد — فإن كانت
// المحذوفة هي الغلاف تولّى ما بعدها، وإن كانت الأخيرة فلا غلاف ولا رابط.
export async function deleteContactPhoto(ctx, cid, bid) {
  const user = ctx.user;
  assertRead(user);
  const row = await loadContact(cid);
  if (!mayEditContact(user)) throw forbidden(EDIT_DENIED);
  const b = await get(`SELECT id, sha256, size_bytes FROM event_blob WHERE id = ? AND kind = 'card' AND ref_id = ?`,
    [String(bid == null ? '' : bid), row.id]);
  if (!b) throw notFound('هذه الصورة غير موجودة — حدّث الصفحة');
  await tx(async () => {
    await run('DELETE FROM event_blob WHERE id = ?', [b.id]);
    await audit(ctx, { action: 'delete', resource: 'event_blob', resourceId: b.id, sectorId: row.sector_id || null,
      detail: { event_id: row.event_id, kind: 'card', contact_id: row.id, size_bytes: Number(b.size_bytes), sha256: b.sha256 } });
  });
  const rest = await cardBlobs(row.id);
  const cover = rest.length ? rest[0].sha256 : null;
  return { ok: true, photo_count: rest.length, cover_sha: cover, photo_url: cover ? photoUrl(row.id, cover) : null };
}

// ── رموز الكشك ─────────────────────────────────────────────────────────────────────────────
// شاشةُ الجناح تعرض رموزاً يمسحها الزائر بجواله (رابط الشركة، نموذج التسجيل، ملف التعريف).
// إضافتُها وحذفُها بمنح «تعديل الفعالية» — من يدير الفعالية يقرّر ما يُعرض في جناحها؛ وقراءتها
// لكل من يقرأ الفعالية. والفعالية المُغلقة تعرض ما فيها ولا تقبل جديداً.
const QR_COLS = 'b.id, b.title, b.mime, b.size_bytes, b.created_at, b.uploaded_by';
function assertQrManage(user, verb) {
  if (!can(user, 'update', 'event')) throw forbidden(`${verb} رموز الكشك لقادة القطاعات ومدير النظام`);
}
async function loadQr(eventId, bid, cols) {
  const b = await get(`SELECT ${cols} FROM event_blob b WHERE b.id = ? AND b.event_id = ? AND b.kind = 'qr'`, [String(bid || ''), eventId]);
  if (!b) throw notFound('الرمز غير موجود');
  return b;
}

export async function listQr(user, eventId) {
  assertRead(user);
  const ev = await loadEvent(eventId);
  const rows = await all(`SELECT ${QR_COLS} FROM event_blob b WHERE b.event_id = ? AND b.kind = 'qr'
     ORDER BY b.created_at ASC, b.id ASC`, [ev.id]);
  return rows.map((r) => ({ ...r, size_bytes: Number(r.size_bytes) }));
}

export async function addQr(ctx, eventId, bytes, { title, fileName } = {}) {
  const user = ctx.user;
  assertQrManage(user, 'إضافة');
  const ev = await loadEvent(eventId);
  if (ev.closed_at) throw badRequest('هذه الفعالية مُغلقة — لا يُضاف إليها رمزٌ جديد');
  const t = clean(title, QR_TITLE_MAX);
  if (!t) throw badRequest('اكتب عنوان الرمز — ما الذي يفتحه الزائر؟');
  const { mime, sha256 } = checkImage(bytes);
  const have = await count(`SELECT COUNT(*) AS n FROM event_blob WHERE event_id = ? AND kind = 'qr'`, [ev.id]);
  if (have >= UPLOAD_LIMITS.qrPerEvent) throw badRequest(`بلغ هذا الجناح حدّ رموز الزوّار (${UPLOAD_LIMITS.qrPerEvent}) — احذف رمزاً قبل إضافة آخر`);
  await assertDailyBudget(user, bytes.length);
  const bid = id('evb');
  await tx(async () => {
    // مرجع الرمز نفسُه: فريدٌ بالمفتاح الأساسي بلا حاجةٍ إلى فهرس (الترحيلة ٠٤١ أسقطته)،
    // ولا «صاحبَ» للرمز غير فعاليته — وسقفُ رموز الجناح أعلاه هو حارسُه.
    await insert('event_blob', { id: bid, event_id: ev.id, kind: 'qr', ref_id: bid, title: t,
      content: bytes, mime, size_bytes: bytes.length, sha256, uploaded_by: user.id, created_at: nowIso() });
    await audit(ctx, { action: 'create', resource: 'event_blob', resourceId: bid, sectorId: null,
      detail: { event_id: ev.id, kind: 'qr', title: t, size_bytes: bytes.length, mime, file_name: clean(fileName) } });
  });
  return { id: bid, title: t, mime, size_bytes: bytes.length, url: '/api/events/' + ev.id + '/qr/' + bid };
}

export async function readQr(user, eventId, bid) {
  assertRead(user);
  const ev = await loadEvent(eventId);
  const b = await loadQr(ev.id, bid, 'b.content, b.mime, b.sha256, b.size_bytes, b.title');
  return { mime: b.mime, content: asBuffer(b.content), sha256: b.sha256, size_bytes: Number(b.size_bytes), title: b.title };
}

export async function deleteQr(ctx, eventId, bid) {
  const user = ctx.user;
  assertQrManage(user, 'حذف');
  const ev = await loadEvent(eventId);
  const b = await loadQr(ev.id, bid, 'b.id, b.title');
  await tx(async () => {
    await run('DELETE FROM event_blob WHERE id = ?', [b.id]);
    await audit(ctx, { action: 'delete', resource: 'event_blob', resourceId: b.id, sectorId: null,
      detail: { event_id: ev.id, kind: 'qr', title: b.title } });
  });
  return { ok: true };
}
