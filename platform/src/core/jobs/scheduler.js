// In-process scheduler for email queue + due report schedules (dev). Prod → external worker.
import { all, run } from '../db/index.js';
import { processQueue, enqueueReport, nextRunAt } from '../reports/engine.js';
import { purgeExpiredCodes } from '../auth/otp.js';
import { purgeExpiredSessions } from '../auth/service.js';
import { sweepApprovalMail } from '../../modules/workflow/approval-notify.js';

let timer = null;
// ── نبضةٌ واحدة في كل لحظة ──
// `setInterval` لا ينتظر دالةً غير متزامنة: إن تجاوزت النبضةُ الدقيقة انطلقت التالية فوقها.
// والأثر ليس بطئاً بل **إرسالاً مكرَّراً**: `processQueue` يختار الصفوف `QUEUED` ثم يضع
// `status='SENDING'` بتحديثٍ غير مشروط (لا مطالبة) — فنبضتان متوازيتان تلتقطان الصفّ نفسه
// وتُرسلان الرسالة مرتين. وخادمُ بريدٍ بطيء وحده كافٍ لإطالة النبضة (وقد صار له الآن سقفُ
// مهلةٍ صريح في smtp.js). القفلُ هنا يمنع التداخل، ويبقى ما فات دون تعويض عمداً: النبضة
// التالية تلتقط ما تأخّر، ولا طابور نبضاتٍ يتراكم فينفجر دفعةً حين تنفرج الأمور.
let running = false;

export function startScheduler() {
  if (timer) return;
  // Tick every 60s: process the email queue and fire due schedules.
  timer = setInterval(tick, 60000);
  tick();
}
export function stopScheduler() { if (timer) { clearInterval(timer); timer = null; } }

async function tick() {
  if (running) return;                      // نبضةٌ سابقة ما زالت تعمل — تُترك لتُكمل
  running = true;
  try { await tickBody(); } finally { running = false; }
}

async function tickBody() {
  // الطابور والجدولة معزولان: فشل أي منهما لا يمنع الآخر. كان الاثنان داخل حماية واحدة،
  // فأي جدولة تفشل كانت توقف إرسال كل بريد المنصة بصمت.
  try { await fireDueSchedules(); } catch (e) { console.error('[scheduler] fireDueSchedules:', e.message); }
  // بريد الاعتمادات قبل معالجة الطابور عمداً: ما يُقيَّد في هذه الدقيقة يغادر فيها لا في التالية.
  // والقرار كله داخل الكنسة (جدول الحال هو الحَكَم) — الدقّة هنا مجرد نبض.
  try { await sweepApprovalMail(); } catch (e) { console.error('[scheduler] sweepApprovalMail:', e.message); }
  try { await processQueue(30); } catch (e) { console.error('[scheduler] processQueue:', e.message); }
  // رموز الدخول المنتهية تُكنَس كل ساعة لا كل دقيقة: الجدول ينمو بصفٍّ لكل طلب دخول في
  // الشركة كلها، وكلٌّ منها أثرٌ لا حاجة إليه بعد انتهائه. والكنس رخيص، لكنه لا يستحق دقيقة.
  const hour = 3600000;
  if (Date.now() - lastPurge > hour) {
    lastPurge = Date.now();
    try { await purgeExpiredCodes(24); } catch (e) { console.error('[scheduler] purgeExpiredCodes:', e.message); }
    // والجلسات معها: جدولٌ لم يُكنَس منذ أول إصدار، ويُغذّيه محرّك التقارير بصفٍّ لكل تقرير
    // لكل مستقبِل (تعليقه يقول «cleaned by TTL» ولا شيء كان ينظّفها). كلٌّ في حمايته: فشلُ
    // أحدهما لا يمنع الآخر — نفس مبدأ العزل في أعلى الكنسة.
    // العدد يُطبع: الكنسة تُتلف صفوفاً، وإتلافٌ بلا أثرٍ في أي مكان لا يُراجَع ولا يُلاحَظ
    // لو انقلبت مهلتُه يوماً. (وليس سطر تدقيق: التدقيق لأفعال الناس لا لكنس الآلة.)
    try {
      const { removed } = await purgeExpiredSessions();
      if (removed) console.log(`[scheduler] كُنست ${removed} جلسة منتهية`);
    } catch (e) { console.error('[scheduler] purgeExpiredSessions:', e.message); }
  }
}
let lastPurge = 0;

// الجدولات المستحقة الآن. الموقوفة (active = 0) لا تُرسِل شيئاً — وهذا ما يجعل زر الإيقاف فعّالاً.
export async function dueSchedules(at = new Date()) {
  const iso = at instanceof Date ? at.toISOString() : String(at);
  return await all("SELECT rs.*, rd.key rkey FROM report_schedule rs JOIN report_definition rd ON rd.id = rs.report_id WHERE rs.active = 1 AND (rs.next_run_at IS NULL OR rs.next_run_at <= ?)", [iso]);
}

async function fireDueSchedules() {
  const now = new Date();
  const due = await dueSchedules(now);
  for (const s of due) {
    // كل جدولة داخل حمايتها الخاصة: فشل واحدة لا يوقف البقية.
    try {
      const recips = (await all('SELECT user_id FROM recipient WHERE group_id = ? AND user_id IS NOT NULL', [s.recipient_group_id])).map((r) => r.user_id);
      if (recips.length) await enqueueReport(s.rkey, { scheduleId: s.id, sectorId: s.sector_id, recipientUserIds: recips });
    } catch (e) {
      console.error(`[scheduler] schedule ${s.id} (${s.rkey}) failed:`, e.message);
    }
    // الموعد يتقدّم دائماً — حتى عند الفشل. كان يبقى مستحقاً أبداً فيُعاد المحاولة كل دقيقة بلا نهاية.
    try {
      await run('UPDATE report_schedule SET last_run_at = ?, next_run_at = ? WHERE id = ?',
        [now.toISOString(), nextRun(s, now), s.id]);
    } catch (e) { console.error(`[scheduler] could not advance schedule ${s.id}:`, e.message); }
  }
}

// الموعد القادم يحترم وقت الإرسال ويوم الأسبوع/الشهر المخزَّنة في صف الجدولة
// (كانت تُضاف أيام ثابتة فقط: شهري = ٣٠ يوماً، فيزحف الموعد شهراً بعد شهر ويُهمَل وقت الإرسال).
// الحساب كله في JS وبتوقيت UTC؛ راجع nextRunAt في محرك التقارير.
export function nextRun(s, now = new Date()) {
  return nextRunAt(s, now);
}
