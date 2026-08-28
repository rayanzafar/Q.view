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
//   • التعديل على البطاقة: منحُ «تعديل» من المصفوفة **ثم** مِلكيةٌ أو قيادة — من التقطها، أو
//     أدوار المراجعة (REVIEW_ROLES). فالبطاقة أمانة ملتقِطها حتى تُراجَع، ومراجعتها شأن قيادة
//     الفريق — والمصفوفة أولاً: من فقد منحَ التعديل (كالمشاهد) لا تفتحه له ملكيته.
//   • الحذف: المالك بمنح التعديل، أو من يحمل منحَ «حذف» من المصفوفة (قائد القطاع ومكتب
//     الرئيس). ورئيس تطوير الأعمال يعدّل كل بطاقة ولا يحذف إلا بطاقته — قاعدته العامة.
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
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { can } from '../../core/rbac/index.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { normalizeEntityName } from '../../core/org/entity-registry.js';
import { parseCardText, foldDigits } from './card-parser.js';

export const CARD_KINDS = ['تعريف بالشركة', 'شراكة', 'تعاون', 'توظيف'];
export const OUTCOMES = ['لم تُراجع', 'تواصلنا', 'صارت فرصة', 'صارت شراكة', 'لا متابعة'];
export const PARTNER_KINDS = ['شراكة تقنية', 'تجارية / تسويقية', 'تنفيذ من الباطن', 'جهة حكومية', 'تدريب وتوظيف', 'أخرى'];
export const PARTNER_STATUSES = ['مبدئية', 'قيد النقاش', 'مذكّرة تفاهم', 'اتفاقية موقّعة', 'نشطة', 'متوقّفة'];
export const REVIEW_ROLES = ['admin', 'sector_lead', 'bd_head', 'ceo_office'];

const FIELD_MAX = 160;
const NOTE_MAX = 4000;
const RAW_MAX = 12000;

// ── أدوات صغيرة ─────────────────────────────────────────────────────────────────────────
const clean = (v, max = FIELD_MAX) => {
  const s = String(v == null ? '' : v).trim();
  return s ? s.slice(0, max) : null;
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
  if (!can(user, action, 'event')) throw forbidden('إنشاء الفعاليات وتعديلها ليس ضمن صلاحيتك — اطلبه من قائد القطاع أو مدير النظام');
}
// resource: «event_contact» للبطاقة و«event_partner» للشراكة — لكلٍّ منحُ إنشائه في المصفوفة.
function assertCapture(user, resource) {
  if (!can(user, 'create', resource)) throw forbidden('صلاحيتك للمشاهدة فقط — اطلب من مدير النظام صلاحية الالتقاط');
}
// الملكية لا تُعوِّض منحاً غائباً: المصفوفة تُسأل أولاً، ثم من التقط أو من يراجع.
const mayEdit = (user, row, resource) => can(user, 'update', resource)
  && (row.captured_by === user.id || REVIEW_ROLES.includes(user.role_id));
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
const contactSelect = (a = 'c', full = false) =>
  `${(full ? CONTACT_FULL_COLS : CONTACT_LIST_COLS).map((k) => `${a}.${k}`).join(', ')}, ${HAS_PHOTO(a)}`;
const CONTACT_TEXT = ['person_name', 'org_name', 'job_title', 'phone', 'email', 'website'];

// البطاقة تحت فعاليةٍ محذوفة محذوفةٌ معها: الربط بالفعالية شرطُ القراءة لا زينة — وإلا فُتحت
// بطاقاتُ فعاليةٍ أُزيلت بعنوانها المباشر وعُدِّلت وهي لا تظهر في أي قائمة.
async function loadContact(cid) {
  const row = await get(`SELECT ${contactSelect('c', true)} FROM event_contact c
     JOIN event e ON e.id = c.event_id AND e.deleted_at IS NULL
     WHERE c.id = ? AND c.deleted_at IS NULL`, [String(cid || '')]);
  if (!row) throw notFound('البطاقة غير موجودة');
  return row;
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

export async function listContacts(user, eventId, opts = {}) {
  assertRead(user);
  const ev = await loadEvent(eventId);
  const where = ['c.event_id = ?', 'c.deleted_at IS NULL'];
  const params = [ev.id];
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
  if (truthy(opts.mine)) { where.push('c.captured_by = ?'); params.push(user.id); }
  if (truthy(opts.dup)) where.push('c.possible_duplicate_of IS NOT NULL');
  // الحدّ عددٌ صحيح دائماً — «1.5» في العنوان لا يصل إلى الاستعلام نصاً.
  const limit = Math.max(1, Math.min(500, Math.floor(Number(opts.limit)) || 100));
  return all(`SELECT ${contactSelect('c')} FROM event_contact c
     WHERE ${where.join(' AND ')}
     ORDER BY c.captured_at DESC, c.id DESC
     LIMIT ${limit}`, params);
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
  return { rows, teamToday };
}

export async function getContact(user, cid) {
  assertRead(user);
  return loadContact(cid);
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
  f.note = clean(data.note, NOTE_MAX);
  f.raw_text = clean(data.raw_text, RAW_MAX);
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
  if (!mayEdit(user, row, 'event_contact')) throw forbidden('تعديل هذه البطاقة لمن التقطها أو لقيادة الفريق');
  const p = {};
  if ('kind' in patch) {
    const kind = clean(patch.kind);
    if (!CARD_KINDS.includes(kind)) throw badRequest('نوع البطاقة غير معروف — اختر: تعريف بالشركة / شراكة / تعاون / توظيف');
    p.kind = kind;
  }
  for (const k of CONTACT_TEXT) if (k in patch) p[k] = textField(k, patch[k]);
  if ('note' in patch) p.note = clean(patch.note, NOTE_MAX);
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
  if (!mayEdit(user, row, 'event_contact')) throw forbidden('تعديل هذه البطاقة لمن التقطها أو لقيادة الفريق');
  const outcome = clean(data.outcome);
  if (!OUTCOMES.includes(outcome)) throw badRequest('قيمة المتابعة غير معروفة — اختر من القائمة');
  const now = nowIso();
  const p = { outcome, outcome_by: user.id, outcome_by_name: nameOf(user), outcome_at: now, updated_at: now };
  if ('outcome_note' in data) p.outcome_note = clean(data.outcome_note, NOTE_MAX);
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
    // الصورة تُمحى فعلاً لا ناعماً: بايتاتٌ بلا بطاقة تُقرأ لا تستحق مكانها في القاعدة.
    await run(`DELETE FROM event_blob WHERE kind = 'card' AND ref_id = ?`, [row.id]);
    await audit(ctx, { action: 'delete', resource: 'event_contact', resourceId: row.id, sectorId: row.sector_id || null,
      detail: { event_id: row.event_id } });
  });
  return { ok: true };
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
  if (has('scope_note')) p.scope_note = clean(data.scope_note, NOTE_MAX);
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
