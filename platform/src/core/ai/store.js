// سجل نشاط المساعد ومعايناته — **الوحدة الوحيدة التي تلمس جدول `ai_activity_log`**.
//
// كانت المعاينات في خريطة داخل الذاكرة: تختفي بإعادة التشغيل، ولا توجد أصلاً للعامل الثاني،
// وتبقى صالحة إلى الأبد ما دامت العملية حيّة، ولا تكتب من أكّدها. صارت صفوفاً في الجدول:
//   • صلاحية زمنية ١٥ دقيقة — الموافقة مرتبطة باللحظة التي رآها صاحبها، لا مفتوحة إلى الأبد.
//   • مقيَّدة بصاحبها — معاينة شخصٍ لا يؤكّدها غيره ولو عرف رمزها.
//   • **مزلاج ذرّي للاستعمال مرة واحدة**: التأكيد تحديثٌ مشروط يُحصى عدد صفوفه المتغيّرة، فلا
//     يمكن لطلبين متزامنين أن يفوزا معاً. (الفحص قبل التحديث سباقٌ لا حماية.)
//   • `approved_by` يُكتب أخيراً — كان عموداً موجوداً منذ أول ترحيلة ولم يُكتب فيه شيء قط.
import { all, get, run } from '../db/index.js';
import { can, effectiveScope } from '../rbac/index.js';
import { scopeFilter } from '../rbac/scope.js';
import { id, nowIso } from '../util/ids.js';
import { forbidden } from '../http/errors.js';

export const PREVIEW_TTL_MINUTES = 15;
// مهلةُ التأكيد أطول من مهلة المعاينة عمداً: المعاينة يقرؤها المساعد في ثانيته، أما التأكيد
// فينتظر إنساناً قد يكون في اجتماع. وطولُها لا يُرخي الحراسة: أداةُ التنفيذ تعيد قراءة السجل
// وتقارن بصمته قبل الكتابة، فما تحرّك بعد المعاينة يُردّ ويُطلب من جديد مهما كانت المهلة.
export const CONFIRM_TTL_MINUTES = 60;

// نتائج القرار المسجَّلة (رموز داخلية لا تُعرض لأحد): مُجاب · مرفوض · معاينة · بانتظار صاحبه ·
// مؤكَّدة منه · مطبَّقة · مردودة.
export const OUTCOME = {
  OK: 'ok', DENIED: 'denied', PREVIEW: 'preview', APPLIED: 'applied', EMPTY: 'empty',
  AWAITING: 'awaiting', CONFIRMED: 'confirmed', REJECTED: 'rejected',
};

const plusMinutes = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();

// يُستدعى **بعد** القرار لا قبله: السجل يقول ماذا طُلب وبمَ أُجيب. ونص الطلب لا يُحفظ لطلب
// مرفوض — الرفض لا يترك أثراً نصياً يُقرأ لاحقاً على صاحبه، والنية مسجَّلة بالنوع والنتيجة.
export async function logAsk(user, { intent, outcome, prompt = null, sectorId = null }) {
  const keepPrompt = outcome !== OUTCOME.DENIED && prompt ? String(prompt).slice(0, 500) : null;
  await run(
    `INSERT INTO ai_activity_log (id, at, user_id, prompt, intent, applied, preview_json, sector_id, outcome)
     VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    [id('ai'), nowIso(), user?.id || null, keepPrompt, intent || null, sectorId || null, outcome || null]);
}

// معاينة محفوظة = صفّ في السجل، رمزُه هو معرّف الصف. لا رمز عشوائي ثانٍ يُخزَّن في مكان آخر.
export async function savePreview(user, preview, { intent, sectorId = null } = {}) {
  const token = id('aiprev');
  const expiresAt = plusMinutes(PREVIEW_TTL_MINUTES);
  await run(
    `INSERT INTO ai_activity_log (id, at, user_id, prompt, intent, applied, preview_json, expires_at, sector_id, outcome)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [token, nowIso(), user.id, String(preview.summary || '').slice(0, 500), intent || null,
      JSON.stringify(preview), expiresAt, sectorId || null, OUTCOME.PREVIEW]);
  // اللحظة تُعاد مع الرمز: الواجهة تعرض «صالحة للتأكيد حتى …» بوقتٍ حقيقي لا بعبارة مبهمة.
  return { token, expiresAt };
}

// قراءة معاينة لصاحبها بلا استهلاكها (لعرضها ثانيةً). تعيد null لغير صاحبها.
export async function readPreview(user, token) {
  if (!token) return null;
  const row = await get('SELECT * FROM ai_activity_log WHERE id = ?', [String(token)]);
  if (!row || row.user_id !== user.id || !row.preview_json) return null;
  return { row, preview: JSON.parse(row.preview_json) };
}

// المزلاج: تحديثٌ مشروط واحد يقرّر كل شيء. `changes === 1` تعني «هذا الطلب هو من ظفر بها».
// يُستدعى **داخل معاملة** مع الكتابة نفسها: فشل الخدمة يُرجع المزلاج فتبقى المعاينة قابلة
// للتصحيح والتأكيد ثانيةً بدل أن تُحرق بلا كتابة.
export async function claimPreview(user, token) {
  if (!token) return { ok: false, reason: 'missing' };
  const now = nowIso();
  // شرطُ «ليست بانتظار صاحبها» في المزلاج نفسه لا في البوابة وحدها. البوابة تردّ النداء القادم
  // من مساعدٍ خارجي، وهذا يردّ الكتابة أيّاً كان الطريق إليها — فلو نُسي حارسٌ يوماً في مسارٍ
  // جديد، بقي الطلبُ المنتظِر غيرَ قابل للكتابة حتى يؤكّده صاحبه بيده.
  const r = await run(
    `UPDATE ai_activity_log SET applied = 1, applied_at = ?, approved_by = ?, outcome = ?
      WHERE id = ? AND user_id = ? AND applied = 0 AND expires_at > ?
        AND (outcome IS NULL OR outcome <> ?)`,
    [now, user.id, OUTCOME.APPLIED, String(token), user.id, now, OUTCOME.AWAITING]);
  if (Number(r.changes) === 1) {
    const row = await get('SELECT preview_json, sector_id, intent FROM ai_activity_log WHERE id = ?', [String(token)]);
    return { ok: true, preview: JSON.parse(row.preview_json), sectorId: row.sector_id, intent: row.intent };
  }
  // لماذا لم يُظفَر بها: التشخيص بعد المحاولة لا قبلها، فلا سباق بين الفحص والتحديث.
  const row = await get('SELECT user_id, applied, expires_at, outcome FROM ai_activity_log WHERE id = ?', [String(token)]);
  if (!row || row.user_id !== user.id) return { ok: false, reason: 'missing' };
  if (Number(row.applied) === 1) return { ok: false, reason: 'applied' };
  if (row.outcome === OUTCOME.AWAITING) return { ok: false, reason: 'awaiting' };
  if (row.outcome === OUTCOME.REJECTED) return { ok: false, reason: 'rejected' };
  if (!row.expires_at || row.expires_at <= now) return { ok: false, reason: 'expired' };
  return { ok: false, reason: 'missing' };
}

// ── طلبٌ ينتظر صاحبه ──────────────────────────────────────────────────────────────────────
// ثلاث حركات على الصفّ نفسه، كلٌّ منها تحديثٌ مشروط واحد يُحصى: يُؤجَّل، ثم يُؤكَّد أو يُرفض.
// لا فحصَ قبل التحديث في أيٍّ منها — الشرط في `WHERE` هو الحارس، فطلبان متزامنان لا يفوزان معاً.

/** معاينةٌ نادى مساعدٌ خارجي تنفيذها: تُعلَّق بانتظار صاحبها، وتُمدَّد مهلتها ليجد وقتاً يقرأ فيه. */
export async function deferToConfirmation(user, token, { applyTool, client = null } = {}) {
  if (!token) return { ok: false, reason: 'no_token' };
  const now = nowIso();
  const expiresAt = plusMinutes(CONFIRM_TTL_MINUTES);
  const r = await run(
    `UPDATE ai_activity_log SET outcome = ?, expires_at = ?, apply_tool = ?, asked_by_client = ?, asked_by_client_id = ?
      WHERE id = ? AND user_id = ? AND applied = 0 AND expires_at > ? AND outcome = ?`,
    [OUTCOME.AWAITING, expiresAt, String(applyTool || ''),
      client?.name_ar ? String(client.name_ar).slice(0, 120) : null, client?.id || null,
      String(token), user.id, now, OUTCOME.PREVIEW]);
  if (Number(r.changes) === 1) return { ok: true, expiresAt };
  const row = await get('SELECT user_id, applied, expires_at, outcome FROM ai_activity_log WHERE id = ?', [String(token)]);
  if (!row || row.user_id !== user.id) return { ok: false, reason: 'missing' };
  if (Number(row.applied) === 1) return { ok: false, reason: 'applied' };
  if (row.outcome === OUTCOME.AWAITING) return { ok: false, reason: 'awaiting', expiresAt: row.expires_at };
  if (row.outcome === OUTCOME.REJECTED) return { ok: false, reason: 'rejected' };
  if (row.outcome === OUTCOME.CONFIRMED) return { ok: false, reason: 'confirmed' };
  if (!row.expires_at || row.expires_at <= now) return { ok: false, reason: 'expired' };
  return { ok: false, reason: 'missing' };
}

/** ضغطةُ صاحب الحساب داخل سند: الطلبُ يصير مؤكَّداً فتُسمح كتابته — والكتابة نفسها بعدها. */
export async function confirmPending(user, token) {
  if (!token) return { ok: false, reason: 'missing' };
  const now = nowIso();
  const r = await run(
    `UPDATE ai_activity_log SET outcome = ?, decided_at = ?, approved_by = ?
      WHERE id = ? AND user_id = ? AND applied = 0 AND expires_at > ? AND outcome = ?`,
    [OUTCOME.CONFIRMED, now, user.id, String(token), user.id, now, OUTCOME.AWAITING]);
  if (Number(r.changes) !== 1) return { ok: false, ...(await pendingReason(user, token, now)) };
  const row = await get('SELECT apply_tool, preview_json, asked_by_client, asked_by_client_id FROM ai_activity_log WHERE id = ?', [String(token)]);
  return {
    ok: true, applyTool: row?.apply_tool || null,
    preview: row?.preview_json ? JSON.parse(row.preview_json) : null,
    // هويّةُ من طلب تعود مع الإفراج: الكتابةُ تقع بضغطة الإنسان، والأثرُ يبقى ناسباً الطلبَ
    // إلى مساعده — «طلبه المساعد، وأذن به صاحبُ الحساب» لا نصفَ الجملة.
    client: row?.asked_by_client_id || row?.asked_by_client
      ? { id: row.asked_by_client_id || null, name_ar: row.asked_by_client || null } : null,
  };
}

/** رفضُه: قرارٌ مؤرَّخ لا فراغ. وتُحرق المهلة معه فلا يبقى للرمز طريقٌ إلى الكتابة. */
export async function rejectPending(user, token) {
  if (!token) return { ok: false, reason: 'missing' };
  const now = nowIso();
  const r = await run(
    `UPDATE ai_activity_log SET outcome = ?, decided_at = ?, expires_at = ?
      WHERE id = ? AND user_id = ? AND applied = 0 AND expires_at > ? AND outcome = ?`,
    [OUTCOME.REJECTED, now, now, String(token), user.id, now, OUTCOME.AWAITING]);
  if (Number(r.changes) !== 1) return { ok: false, ...(await pendingReason(user, token, now)) };
  return { ok: true };
}

async function pendingReason(user, token, now) {
  const row = await get('SELECT user_id, applied, expires_at, outcome FROM ai_activity_log WHERE id = ?', [String(token)]);
  if (!row || row.user_id !== user.id) return { reason: 'missing' };
  if (Number(row.applied) === 1) return { reason: 'applied' };
  if (row.outcome === OUTCOME.REJECTED) return { reason: 'rejected' };
  if (!row.expires_at || row.expires_at <= now) return { reason: 'expired' };
  return { reason: 'missing' };
}

/** ما ينتظر هذا الشخص الآن — لصفحته وحده، بترتيب الأحدث أولاً. المنتهية مهلتها لا تُعرض. */
export async function listAwaiting(user) {
  const now = nowIso();
  const rows = await all(
    `SELECT id, at, intent, preview_json, expires_at, apply_tool, asked_by_client, asked_by_client_id
       FROM ai_activity_log
      WHERE user_id = ? AND outcome = ? AND applied = 0 AND expires_at > ? AND preview_json IS NOT NULL
      ORDER BY at DESC
      LIMIT 25`, [user.id, OUTCOME.AWAITING, now]);
  return rows.map((r) => ({
    token: r.id, at: r.at, intent: r.intent || null,
    expiresAt: r.expires_at, applyTool: r.apply_tool || null,
    askedByClient: r.asked_by_client || null, askedByClientId: r.asked_by_client_id || null,
    preview: r.preview_json ? JSON.parse(r.preview_json) : null,
  }));
}

/** عدّادُ الشارة في القائمة الجانبية — سؤالٌ واحد لا يجرّ معه نصوص المعاينات. */
export async function countAwaiting(user) {
  if (!user?.id) return 0;
  const row = await get(
    `SELECT COUNT(*) AS n FROM ai_activity_log
      WHERE user_id = ? AND outcome = ? AND applied = 0 AND expires_at > ? AND preview_json IS NOT NULL`,
    [user.id, OUTCOME.AWAITING, nowIso()]);
  return Number(row?.n || 0);
}

// «نشاط المساعد» — بوابته منح قراءة التدقيق، ونطاقه نطاق صاحبه، ونص المعاينة لمدير النظام وحده.
export async function listActivity(user, opts = {}) {
  if (!can(user, 'read', 'audit')) {
    throw forbidden('سجل نشاط المساعد جزء من سجل التدقيق — اطلب صلاحية قراءة التدقيق من مدير النظام.');
  }
  const full = can(user, 'admin', 'audit'); // نص المعاينة كاملاً لمدير النظام وحده
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50));
  const f = scopeFilter(user, 'audit', 'read');
  // صاحب السجل يرى سجله دائماً ولو ضاق نطاقه — وما عداه محكوم بنطاق منحه.
  const rows = await all(
    `SELECT id, at, user_id, intent, applied, applied_at, approved_by, outcome, sector_id, expires_at, preview_json
       FROM ai_activity_log
      WHERE (${f.clause} OR user_id = ?)
      ORDER BY at DESC
      LIMIT ${limit}`, [...f.params, user.id]);
  return {
    scope: effectiveScope(user, 'read', 'audit') || 'own',
    rows: rows.map((r) => ({
      id: r.id, at: r.at, user_id: r.user_id, intent: r.intent,
      applied: Number(r.applied) === 1 ? 1 : 0, applied_at: r.applied_at || null,
      approved_by: r.approved_by || null, outcome: r.outcome || null, sector_id: r.sector_id || null,
      expires_at: r.expires_at || null,
      ...(full ? { preview_json: r.preview_json || null } : {}),
    })),
  };
}
