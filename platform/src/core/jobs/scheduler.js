// In-process scheduler for email queue + due report schedules (dev). Prod → external worker.
import { all, run } from '../db/index.js';
import { processQueue, enqueueReport, nextRunAt } from '../reports/engine.js';

let timer = null;

export function startScheduler() {
  if (timer) return;
  // Tick every 60s: process the email queue and fire due schedules.
  timer = setInterval(tick, 60000);
  tick();
}
export function stopScheduler() { if (timer) { clearInterval(timer); timer = null; } }

async function tick() {
  // الطابور والجدولة معزولان: فشل أي منهما لا يمنع الآخر. كان الاثنان داخل حماية واحدة،
  // فأي جدولة تفشل كانت توقف إرسال كل بريد المنصة بصمت.
  try { await fireDueSchedules(); } catch (e) { console.error('[scheduler] fireDueSchedules:', e.message); }
  try { await processQueue(30); } catch (e) { console.error('[scheduler] processQueue:', e.message); }
}

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
