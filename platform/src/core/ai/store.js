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

// نتائج القرار المسجَّلة (رموز داخلية لا تُعرض لأحد): مُجاب · مرفوض · معاينة · مطبَّقة.
export const OUTCOME = { OK: 'ok', DENIED: 'denied', PREVIEW: 'preview', APPLIED: 'applied', EMPTY: 'empty' };

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
  const r = await run(
    `UPDATE ai_activity_log SET applied = 1, applied_at = ?, approved_by = ?, outcome = ?
      WHERE id = ? AND user_id = ? AND applied = 0 AND expires_at > ?`,
    [now, user.id, OUTCOME.APPLIED, String(token), user.id, now]);
  if (Number(r.changes) === 1) {
    const row = await get('SELECT preview_json, sector_id, intent FROM ai_activity_log WHERE id = ?', [String(token)]);
    return { ok: true, preview: JSON.parse(row.preview_json), sectorId: row.sector_id, intent: row.intent };
  }
  // لماذا لم يُظفَر بها: التشخيص بعد المحاولة لا قبلها، فلا سباق بين الفحص والتحديث.
  const row = await get('SELECT user_id, applied, expires_at FROM ai_activity_log WHERE id = ?', [String(token)]);
  if (!row || row.user_id !== user.id) return { ok: false, reason: 'missing' };
  if (Number(row.applied) === 1) return { ok: false, reason: 'applied' };
  if (!row.expires_at || row.expires_at <= now) return { ok: false, reason: 'expired' };
  return { ok: false, reason: 'missing' };
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
