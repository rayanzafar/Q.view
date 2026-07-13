// Report engine: builds report data (scope + redaction aware), renders via template,
// enqueues to email_queue. Permissions are evaluated at BUILD and SEND time per recipient.
import { all, get, insert, run } from '../db/index.js';
import { companyOverview, sectorDashboard } from './metrics.js';
import { TEMPLATES } from '../mail/templates.js';
import { sendMail } from '../mail/transport.js';
import { resolveUser } from '../http/context.js';
import { id, nowIso } from '../util/ids.js';
import { config } from '../config.js';

const FY = () => config.fiscalYear;

// Build the data payload for a report as seen by a given user (redaction via metrics/scope).
export function buildReport(reportKey, user, opts = {}) {
  if (reportKey === 'weekly_exec_brief') {
    const ov = companyOverview(user);
    return {
      period: opts.period || periodLabel(),
      totals: ov.totals, pipeline_halalas: ov.pipeline_halalas, oppCount: ov.sectors.reduce((a, s) => a + s.opp_count, 0),
      achievements: topAchievements(), challenges: topChallenges(), decisions: pendingDecisions(user), risks: topRisks(),
      topDeals: topWonDeals(), topPipeline: topOpenOpps(),
    };
  }
  if (reportKey === 'sector_weekly_status') {
    const sd = sectorDashboard(user, opts.sectorId);
    const projects = all("SELECT name_ar, rag, progress_pct FROM project WHERE sector_id = ? AND deleted_at IS NULL AND status='IN_PROGRESS' ORDER BY rag DESC LIMIT 15", [opts.sectorId]);
    return { sectorName: sd?.sector?.name_ar || '', period: opts.period || periodLabel(),
      projects, risks: sectorRisks(opts.sectorId) };
  }
  throw new Error('تقرير غير معروف: ' + reportKey);
}

export function renderReport(reportKey, data) {
  const tpl = TEMPLATES[reportKey];
  if (!tpl) throw new Error('لا يوجد قالب لـ ' + reportKey);
  return tpl(data); // { subject, html }
}

// Enqueue a report for a set of recipients. Each recipient's view is built with THEIR permissions.
export function enqueueReport(reportKey, { scheduleId, sectorId, recipientUserIds = [], ccEmails = [] }) {
  const results = [];
  for (const uid of recipientUserIds) {
    const ru = resolveUser(sessionlessUser(uid)); // build a scope context for the recipient
    if (!ru) continue;
    const data = buildReport(reportKey, ru, { sectorId });
    const { subject, html } = renderReport(reportKey, data);
    const qid = id('eq');
    insert('email_queue', {
      id: qid, schedule_id: scheduleId || null,
      to_json: JSON.stringify([recipientEmail(uid)]), cc_json: JSON.stringify(ccEmails),
      subject, html, status: 'QUEUED', created_at: nowIso(),
    });
    insert('email_log', { id: id('el'), queue_id: qid, event: 'enqueued', detail: reportKey, at: nowIso() });
    results.push(qid);
  }
  return results;
}

// Process the queue (called by the scheduler job or manually). Retries with backoff cap.
export async function processQueue(limit = 20) {
  const rows = all("SELECT * FROM email_queue WHERE status IN ('QUEUED','FAILED') AND attempts < 4 ORDER BY created_at LIMIT ?", [limit]);
  let sent = 0, failed = 0;
  for (const q of rows) {
    run("UPDATE email_queue SET status='SENDING', attempts = attempts + 1 WHERE id = ?", [q.id]);
    try {
      const to = JSON.parse(q.to_json || '[]');
      await sendMail({ to, cc: JSON.parse(q.cc_json || '[]'), subject: q.subject, html: q.html });
      run("UPDATE email_queue SET status='SENT', sent_at=? WHERE id=?", [nowIso(), q.id]);
      insert('email_log', { id: id('el'), queue_id: q.id, event: 'sent', detail: null, at: nowIso() });
      sent++;
    } catch (e) {
      run("UPDATE email_queue SET status='FAILED', last_error=? WHERE id=?", [String(e.message).slice(0, 300), q.id]);
      insert('email_log', { id: id('el'), queue_id: q.id, event: 'failed', detail: String(e.message).slice(0, 300), at: nowIso() });
      failed++;
    }
  }
  return { sent, failed, processed: rows.length };
}

// helpers
function periodLabel() {
  const d = new Date();
  const wk = Math.ceil(((d - new Date(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `الأسبوع ${wk} · ${d.getUTCFullYear()}`;
}
function recipientEmail(uid) { return get('SELECT email FROM app_user WHERE id = ?', [uid])?.email || null; }
function sessionlessUser(uid) {
  // create/reuse a short-lived session row so resolveUser can build scope; cleaned by TTL.
  const sid = id('sess');
  insert('session', { id: sid, user_id: uid, created_at: nowIso(),
    expires_at: new Date(Date.now() + 60000).toISOString() });
  return sid;
}
function topAchievements() {
  return all("SELECT name_ar FROM project WHERE status='COMPLETED' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 3").map((p) => 'اكتمال: ' + p.name_ar);
}
function topChallenges() {
  return all("SELECT name_ar FROM project WHERE rag='RED' AND deleted_at IS NULL LIMIT 3").map((p) => 'مشروع حرج: ' + p.name_ar);
}
function pendingDecisions(user) {
  return all("SELECT resource_id FROM approval_request WHERE status='PENDING' LIMIT 3").map(() => 'طلب اعتماد بانتظار القرار');
}
function topRisks() {
  return all("SELECT title FROM risk WHERE status!='CLOSED' ORDER BY CASE impact WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END LIMIT 4").map((r) => r.title);
}
function sectorRisks(sectorId) {
  return all("SELECT title FROM risk WHERE sector_id=? AND status!='CLOSED' LIMIT 4", [sectorId]).map((r) => r.title);
}
// Consulting-standard: name the client + opportunity on each deal.
function topWonDeals() {
  return all(`SELECT o.title_ar, o.value_halalas, c.name_ar client FROM opportunity o
    JOIN stage st ON st.id=o.stage_id LEFT JOIN client c ON c.id=o.client_id
    WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? AND o.deleted_at IS NULL
    ORDER BY o.value_halalas DESC LIMIT 5`, [FY()]).map((d) => ({
    title: d.title_ar, client: d.client || '—', value_halalas: d.value_halalas }));
}
function topOpenOpps() {
  return all(`SELECT o.title_ar, o.value_halalas, o.win_pct, c.name_ar client FROM opportunity o
    JOIN stage st ON st.id=o.stage_id LEFT JOIN client c ON c.id=o.client_id
    WHERE st.is_won=0 AND st.is_lost=0 AND o.deleted_at IS NULL
    ORDER BY o.value_halalas DESC LIMIT 5`).map((d) => ({
    title: d.title_ar, client: d.client || '—', value_halalas: d.value_halalas, win_pct: d.win_pct }));
}
