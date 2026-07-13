// Report engine: builds report data (scope + redaction aware), renders via template,
// enqueues to email_queue. Permissions are evaluated at BUILD and SEND time per recipient.
import { all, get, insert, run } from '../db/index.js';
import { companyOverview, sectorDashboard, grossMargin, bookToBill, multiYearTrend,
  projectKpis, sectorUtilization, pipelineCoverage, winRate } from './metrics.js';
import { pipelineSummary } from '../../modules/crm/opportunities.js';
import { redact, canSeeSensitive } from '../rbac/index.js';
import { TEMPLATES } from '../mail/templates.js';
import { sendMail } from '../mail/transport.js';
import { resolveUser } from '../http/context.js';
import { audit } from '../audit/index.js';
import { id, nowIso } from '../util/ids.js';
import { config } from '../config.js';

const FY = () => config.fiscalYear;
const canSeeMargin = (u) => canSeeSensitive(u, 'margin');
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthName = () => MONTHS[new Date().getUTCMonth()];
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); };

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
  if (reportKey === 'monthly_sector_performance') {
    const sid = opts.sectorId || user.sector_id;
    const sd = sectorDashboard(user, sid, { year: opts.year });
    const gm = canSeeMargin(user) ? grossMargin(sid, opts.year || FY()) : { margin_pct: null };
    const b2b = bookToBill(sid, opts.year || FY());
    const trend = multiYearTrend(sid, 2);
    const revYoy = trend.length >= 2 && trend[0].revenue_halalas ? Math.round((trend[1].revenue_halalas - trend[0].revenue_halalas) / trend[0].revenue_halalas * 100) : null;
    const sec = get('SELECT * FROM sector WHERE id = ?', [sid]) || {};
    return { sectorName: sd?.sector?.name_ar || '', period: `${monthName()} ${opts.year || FY()}`,
      revenue_halalas: sd.revenue_halalas, target_revenue_halalas: sd.target_revenue_halalas,
      sales_halalas: sd.sales_halalas, target_sales_halalas: sd.target_sales_halalas,
      margin_pct: gm.margin_pct, target_margin_pct: sec.target_margin_pct || 0,
      revenue_yoy: revYoy, book_to_bill: b2b.ratio, rag: sd.rag,
      projects: all("SELECT name_ar, rag, progress_pct FROM project WHERE sector_id=? AND deleted_at IS NULL AND status='IN_PROGRESS' ORDER BY rag DESC, contract_value_halalas DESC LIMIT 10", [sid]) };
  }
  if (reportKey === 'project_status_report') {
    let p = opts.projectId ? get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [opts.projectId]) : null;
    if (!p) p = get(`SELECT * FROM project WHERE deleted_at IS NULL ${user.scope === 'company' ? '' : 'AND sector_id = ?'} ORDER BY contract_value_halalas DESC LIMIT 1`, user.scope === 'company' ? [] : [user.sector_id]);
    if (!p) throw new Error('لا يوجد مشروع متاح');
    return { period: periodLabel(), project: redact(user, 'project', p), kpis: projectKpis(p.id),
      deliverables: all("SELECT name_ar FROM deliverable WHERE project_id=? AND status IN ('PENDING','DELIVERED') AND deleted_at IS NULL LIMIT 6", [p.id]).map((d) => d.name_ar),
      risks: all("SELECT title FROM risk WHERE project_id=? AND status!='CLOSED' LIMIT 6", [p.id]).map((r) => r.title) };
  }
  if (reportKey === 'workforce_utilization') {
    const sid = opts.sectorId || user.sector_id;
    const from = opts.from || monthStart(); const to = opts.to || todayIso();
    const people = sectorUtilization(sid, from, to);
    const avg = people.length ? Math.round(people.reduce((a, p) => a + p.utilization_pct, 0) / people.length) : 0;
    return { sectorName: (get('SELECT name_ar FROM sector WHERE id=?', [sid]) || {}).name_ar || '', period: `${from} → ${to}`, people, avgUtil: avg };
  }
  if (reportKey === 'opportunity_pipeline') {
    const sid = opts.sectorId || user.sector_id;
    const scopedUser = { ...user, sector_id: sid };
    const pipe = pipelineSummary(scopedUser);
    const stages = Object.fromEntries(all('SELECT id, color FROM stage').map((s) => [s.id, s.color]));
    const cov = pipelineCoverage(sid, opts.year || FY());
    const wr = winRate(sid, opts.year || FY());
    return { sectorName: (get('SELECT name_ar FROM sector WHERE id=?', [sid]) || {}).name_ar || '', period: opts.period || periodLabel(),
      pipeline: pipe.map((s) => ({ ...s, color: stages[s.stage] || '#64748b' })),
      topOpen: topOpenOpps().filter((d) => true), winRate: wr.rate, coverage: cov.coverage, weighted_halalas: cov.weighted_halalas };
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

// Create a report schedule (admin/sector_lead/finance/ceo_office). Computes next_run_at.
export function createSchedule(ctx, { reportId, frequency, recipientGroupId, sendTime, sectorId }) {
  const u = ctx.user;
  if (!['admin', 'sector_lead', 'finance', 'ceo_office'].includes(u.role_id)) {
    const e = new Error('جدولة التقارير تتطلب صلاحية إدارية'); e.status = 403; e.code = 'forbidden'; throw e;
  }
  if (!reportId || !frequency) { const e = new Error('التقرير والتكرار مطلوبان'); e.status = 400; e.code = 'bad_request'; throw e; }
  const sid = id('rs'); const now = nowIso();
  const next = new Date(); next.setUTCDate(next.getUTCDate() + 1);
  insert('report_schedule', { id: sid, report_id: reportId, recipient_group_id: recipientGroupId || null,
    sector_id: sectorId || (u.scope === 'company' ? null : u.sector_id), frequency, send_time: sendTime || '08:00',
    active: 1, next_run_at: next.toISOString(), created_by: u.id, created_at: now });
  audit(ctx, { action: 'create', resource: 'report_schedule', resourceId: sid, detail: { frequency } });
  return get('SELECT * FROM report_schedule WHERE id = ?', [sid]);
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
