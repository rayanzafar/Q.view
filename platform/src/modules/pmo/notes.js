// ══ دفتر الملاحظات الشخصي ═════════════════════════════════════════════════════════════════════
//
// «أضيف مكان الواحد يكتب فيه النوت ويكون بشكل جميل، والنوت يكون بناءً على اليوم أو يكون في
// قائمة يكتب موضوع ويكتب فيه نوت وكذا» — بلسان المالك، وفيه خياران قال «أو» بينهما.
//
// ── القرار: قائمة {موضوع · نصّ}، واليوم عمودٌ فيها لا نموذجٌ ثانٍ ──────────────────────────
// اخترنا «الموضوع والنصّ» لسببين:
//   ١) الاحتواء في اتجاه واحد. ملاحظةُ اليوم هي ملاحظةٌ موضوعها يوم — فقائمةُ المواضيع تعبّر
//      عن «دفتر اليوم» كاملاً. والعكس مستحيل: نموذج «ملاحظة واحدة لكل يوم» لا يسع «ملاحظات
//      اجتماع الترسية» إلا بأن يحشرها داخل يومٍ فتضيع تحت ما كُتب معها.
//   ٢) الاسترجاع. بعد شهرين يبحث المرء عن «ما اتُّفق عليه في اجتماع الترسية» لا عن «ما كتبته
//      يوم الثلاثاء». الموضوع مفتاحٌ يُتذكَّر، والتاريخ وحده ليس كذلك.
// وحتى لا يخسر الخيار الآخر شيئاً: كل ملاحظة تحمل `note_date` (اليوم افتراضاً)، والشاشة
// تعرضها **مجمَّعةً بالأيام** — فمن أراد يومياته قرأها يوماً بيوم، ومن أراد موضوعاً وجده
// باسمه. نموذجٌ واحد يخدم القراءتين، لا جدولان يتنافسان ثم يسأل صاحبهما «أين كتبتُها».
//
// ── الخصوصية: لا منح، والملكية هي البوابة ─────────────────────────────────────────────────
// الملاحظة تخصّ صاحبها وحده، ولذلك **لا `can(...)` في هذا الملف ولا منح في سياسة الصفحات**:
// اشتراطُ منحٍ على قراءة المرء لدفتره يعني منعَ الموظف من رؤية ما كتب بيده. وهي حرفياً حجّة
// صفحة «صفحتي» الموثّقة في core/policy/pages.js — «لا شيء فيها يخصّ غير صاحبها، وكل استعلام
// خلفها مقيَّد بمعرّفه هو».
// والحارس شرطٌ في **كل** استعلام — `user_id = ?` — لا فحصٌ منفصل يمكن أن يُنسى في مسار جديد:
// حتى قراءةُ ملاحظةٍ بمعرّفها تمرّ بالشرط نفسه، فملاحظةُ غيرك «غير موجودة» ولا يُكشف وجودها.
import { all, get, insert, update } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { notFound, badRequest } from '../../core/http/errors.js';

const SUBJECT_MAX = 120;
const BODY_MAX = 8000;

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
// تاريخٌ يُبنى في JS ويُربَط كنص — لا دوال تواريخ في الاستعلام (القاعدة المحمولة بين المحرّكين).
const asDay = (v, fallback) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').slice(0, 10))
  ? String(v).slice(0, 10) : fallback);

// الأعمدة التي تقرؤها الشاشة — تُسمَّى صراحةً فلا يتسرّب عمودٌ جديد إلى الواجهة بلا قرار.
const COLS = 'id, subject, body, note_date, pinned, created_at, updated_at';

// ملاحظةٌ بعينها **لصاحبها**: نفس الشرط في كل مسار، فالبوابة واحدة لا ثلاث.
async function ownNote(user, noteId) {
  const row = await get(`SELECT * FROM personal_note WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [String(noteId || ''), user.id]);
  // «غير موجودة» لا «ليست لك»: الثانية تؤكّد وجود ملاحظةٍ لشخصٍ آخر بهذا المعرّف، وهي بذاتها
  // تسريبٌ صغير. الأولى تقول القدر الذي يحتاجه صاحب الطلب ولا تزيد.
  if (!row) throw notFound('الملاحظة غير موجودة');
  return row;
}

// دفتر صاحب الطلب. الترتيب: المثبَّت أولاً، ثم الأحدث يوماً، ثم الأحدث كتابةً —
// كي يكون أعلى الشاشة ما يعود إليه المرء فعلاً لا أوّل ما كتبه في حياته.
export async function myNotes(user, opts = {}) {
  const where = ['user_id = ?', 'deleted_at IS NULL'];
  const params = [user.id];
  const q = clean(opts.q, 80).toLowerCase();
  if (q) {
    where.push('(LOWER(subject) LIKE ? OR LOWER(COALESCE(body, \'\')) LIKE ?)');
    params.push('%' + q + '%', '%' + q + '%');
  }
  const limit = Math.max(1, Math.min(300, Number(opts.limit) || 200));
  return await all(`SELECT ${COLS} FROM personal_note
     WHERE ${where.join(' AND ')}
     ORDER BY pinned DESC, COALESCE(note_date, substr(created_at, 1, 10)) DESC, created_at DESC
     LIMIT ${limit}`, params);
}

export async function createNote(ctx, data = {}) {
  const user = ctx.user;
  const subject = clean(data.subject, SUBJECT_MAX);
  const body = clean(data.body, BODY_MAX) || null;
  // الموضوع مطلوب لأنه مفتاح الاسترجاع — لا لأن الحقل «إلزامي». والرسالة تقول ما يُكتب لا أن
  // الحقل فارغ: «موضوع» بلا مثال يجعل الناس يكتبون «ملاحظة» فيعود الدفتر إلى ما هرب منه.
  if (!subject) throw badRequest('اكتب موضوع الملاحظة — كلمتان تكفيان لتجدها بعد شهر، مثل: اجتماع الترسية');
  const nid = id('pnt'); const now = nowIso();
  await insert('personal_note', {
    id: nid, user_id: user.id, subject, body,
    note_date: asDay(data.note_date, now.slice(0, 10)),
    pinned: data.pinned ? 1 : 0,
    created_at: now, created_by: user.id,
  });
  await audit(ctx, { action: 'create', resource: 'personal_note', resourceId: nid });
  return await get(`SELECT ${COLS} FROM personal_note WHERE id = ?`, [nid]);
}

export async function updateNote(ctx, noteId, data = {}) {
  const user = ctx.user;
  const row = await ownNote(user, noteId);
  const patch = {};
  if ('subject' in data) {
    const subject = clean(data.subject, SUBJECT_MAX);
    if (!subject) throw badRequest('اكتب موضوع الملاحظة — كلمتان تكفيان لتجدها بعد شهر، مثل: اجتماع الترسية');
    patch.subject = subject;
  }
  if ('body' in data) patch.body = clean(data.body, BODY_MAX) || null;
  if ('note_date' in data) patch.note_date = asDay(data.note_date, row.note_date || null);
  if ('pinned' in data) patch.pinned = data.pinned ? 1 : 0;
  if (!Object.keys(patch).length) throw badRequest('حدّد ما تريد تغييره في الملاحظة');
  patch.updated_at = nowIso(); patch.updated_by = user.id;
  await update('personal_note', row.id, patch);
  // نصّ الملاحظة **لا يدخل سجل الأثر**: السجل يُقرأ من شاشة التدقيق، ودفترُ الشخص لا يُقرأ
  // منها. يُسجَّل أن تغييراً وقع ومتى ومن أوقعه — لا ماذا كتب.
  await audit(ctx, { action: 'update', resource: 'personal_note', resourceId: row.id });
  return await get(`SELECT ${COLS} FROM personal_note WHERE id = ?`, [row.id]);
}

export async function deleteNote(ctx, noteId) {
  const user = ctx.user;
  const row = await ownNote(user, noteId);
  // إخفاء لا محو — قاعدة الحذف اللين في المنصة كلها: صفٌّ يبقى وتاريخُ إخفائه مكتوب.
  await update('personal_note', row.id, { deleted_at: nowIso(), updated_by: user.id });
  await audit(ctx, { action: 'delete', resource: 'personal_note', resourceId: row.id });
  return { ok: true };
}
