// In-process scheduler for email queue + due report schedules (dev). Prod → external worker.
import { all, run } from '../db/index.js';
import { processQueue, enqueueReport } from '../reports/engine.js';
import { nowIso } from '../util/ids.js';

let timer = null;

export function startScheduler() {
  if (timer) return;
  // Tick every 60s: process the email queue and fire due schedules.
  timer = setInterval(tick, 60000);
  tick();
}
export function stopScheduler() { if (timer) { clearInterval(timer); timer = null; } }

async function tick() {
  try {
    await fireDueSchedules();
    await processQueue(30);
  } catch (e) { console.error('[scheduler]', e.message); }
}

async function fireDueSchedules() {
  const now = new Date();
  const due = await all("SELECT rs.*, rd.key rkey FROM report_schedule rs JOIN report_definition rd ON rd.id = rs.report_id WHERE rs.active = 1 AND (rs.next_run_at IS NULL OR rs.next_run_at <= ?)", [now.toISOString()]);
  for (const s of due) {
    const recips = (await all('SELECT user_id FROM recipient WHERE group_id = ? AND user_id IS NOT NULL', [s.recipient_group_id])).map((r) => r.user_id);
    if (recips.length) await enqueueReport(s.rkey, { scheduleId: s.id, sectorId: s.sector_id, recipientUserIds: recips });
    await run('UPDATE report_schedule SET last_run_at = ?, next_run_at = ? WHERE id = ?',
      [now.toISOString(), nextRun(s, now), s.id]);
  }
}

function nextRun(s, now) {
  const d = new Date(now);
  const add = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365 }[s.frequency] || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString();
}
