// قراءةُ سجلّ الأعطال وكنسُه.
import { all, get, run } from '../db/index.js';
import { nowIso } from '../util/ids.js';

const KEEP_DAYS = 30;
const MAX_GROUPS = 500;
const BATCH = 2000;

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

// أحدثُ المجموعات. الترتيب بالرتبة أولاً: ما أصاب قيادةً يُقرأ قبل ما أصاب حساب تجربة.
export async function faultGroups({ limit = 100 } = {}) {
  return await all(
    `SELECT fingerprint, kind, source, method, status, err_kind, err_code, hits,
            first_at, last_at, last_user, last_role, top_role_rank, digestable, muted_at
       FROM error_event
      ORDER BY (CASE WHEN muted_at IS NULL THEN 0 ELSE 1 END), top_role_rank DESC, last_at DESC
      LIMIT ?`, [Math.min(Number(limit) || 100, 200)]);
}

export async function faultStats() {
  const since = daysAgo(1);
  const r = await get(
    `SELECT COUNT(*) groups, COALESCE(SUM(hits), 0) hits,
            COALESCE(SUM(CASE WHEN top_role_rank >= 2 THEN 1 ELSE 0 END), 0) senior,
            MAX(last_at) last_at
       FROM error_event WHERE muted_at IS NULL`) || {};
  const today = await get('SELECT COUNT(*) n FROM error_event WHERE last_at >= ?', [since]) || {};
  return { groups: Number(r.groups) || 0, hits: Number(r.hits) || 0, senior: Number(r.senior) || 0,
    lastAt: r.last_at || null, today: Number(today.n) || 0 };
}

// الإسكات يبقى بعد تكرار العطب — وإلا كان الزرّ كذبةً: أسكتّه فعاد بعد دقيقة.
export async function muteFault(fingerprint, muted = true) {
  await run('UPDATE error_event SET muted_at = ? WHERE fingerprint = ?', [muted ? nowIso() : null, String(fingerprint || '')]);
  return { ok: true };
}

// الكنس: عمرٌ ثم سقفٌ للصفوف. ودُفعاتٌ محدودة لأن حذفاً واحداً لملايين الصفوف بعد حادثةٍ
// كبيرة يصير هو الحادثة التالية — يحبس قفل الكتابة فتفشل طلباتٌ حيّة فتُنتج أعطاباً جديدة.
// وصيغة `id IN (SELECT … LIMIT ?)` محمولةٌ على المحرّكَين، خلافاً لـ`DELETE … LIMIT`.
export async function purgeFaults({ keepDays = KEEP_DAYS, maxGroups = MAX_GROUPS } = {}) {
  const cutoff = daysAgo(keepDays);
  // حارسٌ على المهلة نفسها: قيمةٌ مقلوبة أو غير رقمية تحذف كل شيء. لا يُحذف بمهلةٍ مستقبلية.
  if (!(cutoff < nowIso())) return { removed: 0 };
  let removed = 0;
  const old = await run(
    `DELETE FROM error_event WHERE fingerprint IN (
       SELECT fingerprint FROM error_event WHERE last_at < ? ORDER BY last_at LIMIT ?)`, [cutoff, BATCH]);
  removed += old?.changes || 0;
  const over = await run(
    `DELETE FROM error_event WHERE fingerprint IN (
       SELECT fingerprint FROM error_event ORDER BY last_at DESC LIMIT ? OFFSET ?)`, [BATCH, maxGroups]);
  removed += over?.changes || 0;
  return { removed };
}
