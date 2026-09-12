// إعدادات المنصة العامة — القاعدة مصدرُ الحقيقة والذاكرةُ مسارُ القراءة الساخن.
//
// نفس نموذج عناوين الحسابات في البريد حرفياً (`core/mail/accounts.js`) وللسبب نفسه:
// استعلامٌ لكل قراءةٍ ثقلٌ بلا داع، ودقيقةُ تقادمٍ لا يلحظها أحد. والافتراضاتُ في الكود
// لا في البذر — قاعدةٌ فارغة تعمل كاملةً بلا صفٍّ واحد، وهو ما تعتمده اختبارات الشاشات.
//
// هذه الوحدة **آلية** لا سلطة: القراءة والكتابة الخام. من يكتب إعداداً لمستخدمٍ ما عليه
// أن يحرس الصلاحية ويدقّق الأثر في وحدته هو (كما تفعل `setApprovalMailPolicy`).
import { all, run } from '../db/index.js';
import { nowIso } from '../util/ids.js';

const TTL_MS = 60_000;
let snapshot = new Map();
let loadedAt = 0;

/** لقطة الإعدادات — تُحدَّث كل دقيقة، و`force` يجدّدها فوراً (بعد كل كتابة).
 *  فشلُ القراءة يُبقي اللقطة السابقة: إعدادٌ قديمٌ بدقيقة خيرٌ من سقوط الكنسة كلها. */
export async function refreshSettings({ force = false } = {}) {
  if (!force && Date.now() - loadedAt < TTL_MS) return snapshot;
  try {
    const rows = await all('SELECT key, value FROM app_setting');
    snapshot = new Map(rows.map((r) => [r.key, String(r.value)]));
    loadedAt = Date.now();
  } catch { /* تبقى اللقطة السابقة */ }
  return snapshot;
}

/** قراءةٌ متزامنة من اللقطة — الفراغ يقع على الافتراض المُمرَّر. */
export function settingValue(key, fallback = null) {
  const v = snapshot.get(key);
  return v === undefined ? fallback : v;
}

/** كتابةُ مفاتيح دفعةً واحدة — تنضم إلى معاملة النادي إن كان داخل واحدة. */
export async function writeSettings(entries, { updatedBy = null } = {}) {
  const now = nowIso();
  for (const [key, value] of Object.entries(entries)) {
    await run(
      `INSERT INTO app_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [key, String(value), now, updatedBy]);
  }
}

/** للاختبارات وللإقلاع: تُفرغ اللقطة فتُقرأ القاعدة من جديد في أول نداء. */
export function resetSettings() { snapshot = new Map(); loadedAt = 0; }
