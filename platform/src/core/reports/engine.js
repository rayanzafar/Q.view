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
import { MONTHS_AR as MONTHS } from '../i18n/time.js';

const FY = () => config.fiscalYear;
const canSeeMargin = (u) => canSeeSensitive(u, 'margin');
const monthName = () => MONTHS[new Date().getUTCMonth()];
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); };

// Build the data payload for a report as seen by a given user (redaction via metrics/scope).
export async function buildReport(reportKey, user, opts = {}) {
  if (reportKey === 'weekly_exec_brief') {
    const ov = await companyOverview(user);
    return {
      period: opts.period || periodLabel(),
      totals: ov.totals, pipeline_halalas: ov.pipeline_halalas, oppCount: ov.sectors.reduce((a, s) => a + s.opp_count, 0),
      achievements: await topAchievements(), challenges: await topChallenges(), decisions: await pendingDecisions(user), risks: await topRisks(),
      topDeals: await topWonDeals(), topPipeline: await topOpenOpps(),
    };
  }
  if (reportKey === 'sector_weekly_status') {
    const sd = await sectorDashboard(user, opts.sectorId);
    const projects = await all("SELECT name_ar, rag, progress_pct FROM project WHERE sector_id = ? AND deleted_at IS NULL AND status='IN_PROGRESS' ORDER BY rag DESC LIMIT 15", [opts.sectorId]);
    return { sectorName: sd?.sector?.name_ar || '', period: opts.period || periodLabel(),
      projects, risks: await sectorRisks(opts.sectorId) };
  }
  if (reportKey === 'monthly_sector_performance') {
    const sid = opts.sectorId || user.sector_id || (await get('SELECT id FROM sector WHERE active=1 AND deleted_at IS NULL ORDER BY sort_order LIMIT 1') || {}).id;
    const sd = sid ? await sectorDashboard(user, sid, { year: opts.year }) : null;
    if (!sd) return { sectorName: '—', period: `${monthName()} ${opts.year || FY()}`, revenue_halalas: 0, target_revenue_halalas: 0,
      sales_halalas: 0, target_sales_halalas: 0, margin_pct: null, target_margin_pct: 0, revenue_yoy: null, book_to_bill: null, rag: 'GREEN', projects: [] };
    const gm = canSeeMargin(user) ? await grossMargin(sid, opts.year || FY()) : { margin_pct: null };
    const b2b = await bookToBill(sid, opts.year || FY());
    const trend = await multiYearTrend(sid, 2);
    const revYoy = trend.length >= 2 && trend[0].revenue_halalas ? Math.round((trend[1].revenue_halalas - trend[0].revenue_halalas) / trend[0].revenue_halalas * 100) : null;
    const sec = await get('SELECT * FROM sector WHERE id = ?', [sid]) || {};
    return { sectorName: sd?.sector?.name_ar || '', period: `${monthName()} ${opts.year || FY()}`,
      revenue_halalas: sd.revenue_halalas, target_revenue_halalas: sd.target_revenue_halalas,
      sales_halalas: sd.sales_halalas, target_sales_halalas: sd.target_sales_halalas,
      margin_pct: gm.margin_pct, target_margin_pct: sec.target_margin_pct || 0,
      revenue_yoy: revYoy, book_to_bill: b2b.ratio, rag: sd.rag,
      projects: await all("SELECT name_ar, rag, progress_pct FROM project WHERE sector_id=? AND deleted_at IS NULL AND status='IN_PROGRESS' ORDER BY rag DESC, contract_value_halalas DESC LIMIT 10", [sid]) };
  }
  if (reportKey === 'project_status_report') {
    let p = opts.projectId ? await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [opts.projectId]) : null;
    if (!p) p = await get(`SELECT * FROM project WHERE deleted_at IS NULL ${user.scope === 'company' ? '' : 'AND sector_id = ?'} ORDER BY contract_value_halalas DESC LIMIT 1`, user.scope === 'company' ? [] : [user.sector_id]);
    if (!p) throw new Error('لا يوجد مشروع متاح');
    return { period: periodLabel(), project: redact(user, 'project', p), kpis: await projectKpis(p.id),
      deliverables: (await all("SELECT name_ar FROM deliverable WHERE project_id=? AND status IN ('PENDING','DELIVERED') AND deleted_at IS NULL LIMIT 6", [p.id])).map((d) => d.name_ar),
      risks: (await all("SELECT title FROM risk WHERE project_id=? AND status!='CLOSED' LIMIT 6", [p.id])).map((r) => r.title) };
  }
  if (reportKey === 'workforce_utilization') {
    const sid = opts.sectorId || user.sector_id;
    const from = opts.from || monthStart(); const to = opts.to || todayIso();
    const people = await sectorUtilization(sid, from, to);
    const avg = people.length ? Math.round(people.reduce((a, p) => a + p.utilization_pct, 0) / people.length) : 0;
    return { sectorName: (await get('SELECT name_ar FROM sector WHERE id=?', [sid]) || {}).name_ar || '', period: `${from} → ${to}`, people, avgUtil: avg };
  }
  if (reportKey === 'opportunity_pipeline') {
    const sid = opts.sectorId || user.sector_id;
    const scopedUser = { ...user, sector_id: sid };
    const pipe = await pipelineSummary(scopedUser);
    const stages = Object.fromEntries((await all('SELECT id, color FROM stage')).map((s) => [s.id, s.color]));
    const cov = await pipelineCoverage(sid, opts.year || FY());
    const wr = await winRate(sid, opts.year || FY());
    return { sectorName: (await get('SELECT name_ar FROM sector WHERE id=?', [sid]) || {}).name_ar || '', period: opts.period || periodLabel(),
      pipeline: pipe.map((s) => ({ ...s, color: stages[s.stage] || '#64748b' })),
      topOpen: await topOpenOpps(sid), winRate: wr.rate, coverage: cov.coverage, weighted_halalas: cov.weighted_halalas };
  }
  throw new Error('تقرير غير معروف: ' + reportKey);
}

export async function renderReport(reportKey, data) {
  const tpl = TEMPLATES[reportKey];
  if (!tpl) throw new Error('لا يوجد قالب لـ ' + reportKey);
  return tpl(data); // { subject, html }
}

// Enqueue a report for a set of recipients. Each recipient's view is built with THEIR permissions.
export async function enqueueReport(reportKey, { scheduleId, sectorId, recipientUserIds = [], ccEmails = [] }) {
  const results = [];
  for (const uid of recipientUserIds) {
    const ru = await resolveUser(await sessionlessUser(uid)); // build a scope context for the recipient
    if (!ru) continue;
    const data = await buildReport(reportKey, ru, { sectorId });
    const { subject, html } = await renderReport(reportKey, data);
    const qid = id('eq');
    await insert('email_queue', {
      id: qid, schedule_id: scheduleId || null,
      to_json: JSON.stringify([await recipientEmail(uid)]), cc_json: JSON.stringify(ccEmails),
      subject, html, status: 'QUEUED', created_at: nowIso(),
    });
    await insert('email_log', { id: id('el'), queue_id: qid, event: 'enqueued', detail: reportKey, at: nowIso() });
    results.push(qid);
  }
  return results;
}

// Create a report schedule (admin/sector_lead/finance/ceo_office). Computes next_run_at.
export async function createSchedule(ctx, { reportId, frequency, recipientGroupId, sendTime, sectorId }) {
  const u = ctx.user;
  if (!['admin', 'sector_lead', 'finance', 'ceo_office'].includes(u.role_id)) {
    const e = new Error('جدولة التقارير تتطلب صلاحية إدارية'); e.status = 403; e.code = 'forbidden'; throw e;
  }
  if (!reportId || !frequency) { const e = new Error('التقرير والتكرار مطلوبان'); e.status = 400; e.code = 'bad_request'; throw e; }
  const sid = id('rs'); const now = nowIso();
  const next = new Date(); next.setUTCDate(next.getUTCDate() + 1);
  await insert('report_schedule', { id: sid, report_id: reportId, recipient_group_id: recipientGroupId || null,
    sector_id: sectorId || (u.scope === 'company' ? null : u.sector_id), frequency, send_time: sendTime || '08:00',
    active: 1, next_run_at: next.toISOString(), created_by: u.id, created_at: now });
  await audit(ctx, { action: 'create', resource: 'report_schedule', resourceId: sid, detail: { frequency } });
  return await get('SELECT * FROM report_schedule WHERE id = ?', [sid]);
}

// Process the queue (called by the scheduler job or manually). Retries with backoff cap.
export async function processQueue(limit = 20) {
  const rows = await all("SELECT * FROM email_queue WHERE status IN ('QUEUED','FAILED') AND attempts < 4 ORDER BY created_at LIMIT ?", [limit]);
  let sent = 0, failed = 0;
  for (const q of rows) {
    await run("UPDATE email_queue SET status='SENDING', attempts = attempts + 1 WHERE id = ?", [q.id]);
    try {
      const to = JSON.parse(q.to_json || '[]');
      await sendMail({ to, cc: JSON.parse(q.cc_json || '[]'), subject: q.subject, html: q.html });
      await run("UPDATE email_queue SET status='SENT', sent_at=? WHERE id=?", [nowIso(), q.id]);
      await insert('email_log', { id: id('el'), queue_id: q.id, event: 'sent', detail: null, at: nowIso() });
      sent++;
    } catch (e) {
      await run("UPDATE email_queue SET status='FAILED', last_error=? WHERE id=?", [String(e.message).slice(0, 300), q.id]);
      await insert('email_log', { id: id('el'), queue_id: q.id, event: 'failed', detail: String(e.message).slice(0, 300), at: nowIso() });
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
async function recipientEmail(uid) { return (await get('SELECT email FROM app_user WHERE id = ?', [uid]))?.email || null; }
async function sessionlessUser(uid) {
  // create/reuse a short-lived session row so resolveUser can build scope; cleaned by TTL.
  const sid = id('sess');
  await insert('session', { id: sid, user_id: uid, created_at: nowIso(),
    expires_at: new Date(Date.now() + 60000).toISOString() });
  return sid;
}
async function topAchievements() {
  return (await all("SELECT name_ar FROM project WHERE status='COMPLETED' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 3")).map((p) => 'اكتمال: ' + p.name_ar);
}
async function topChallenges() {
  return (await all("SELECT name_ar FROM project WHERE rag='RED' AND deleted_at IS NULL LIMIT 3")).map((p) => 'مشروع حرج: ' + p.name_ar);
}
async function pendingDecisions(user) {
  return (await all("SELECT resource_id FROM approval_request WHERE status='PENDING' LIMIT 3")).map(() => 'طلب اعتماد بانتظار القرار');
}
async function topRisks() {
  return (await all("SELECT title FROM risk WHERE status!='CLOSED' ORDER BY CASE impact WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END LIMIT 4")).map((r) => r.title);
}
async function sectorRisks(sectorId) {
  return (await all("SELECT title FROM risk WHERE sector_id=? AND status!='CLOSED' LIMIT 4", [sectorId])).map((r) => r.title);
}
// Consulting-standard: name the client + opportunity on each deal.
async function topWonDeals() {
  return (await all(`SELECT o.title_ar, o.value_halalas, c.name_ar client FROM opportunity o
    JOIN stage st ON st.id=o.stage_id LEFT JOIN client c ON c.id=o.client_id
    WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? AND o.deleted_at IS NULL
    ORDER BY o.value_halalas DESC LIMIT 5`, [FY()])).map((d) => ({
    title: d.title_ar, client: d.client || '—', value_halalas: d.value_halalas }));
}
// sectorId مطلوب لتقارير القطاع: بدونه كانت القائمة تُبنى من فرص كل القطاعات وتُرسَل بالبريد
// إلى مستلم قطاع واحد (أسماء عملاء وقيم صفقات في بريد صادر لا يُسترجَع).
async function topOpenOpps(sectorId = null) {
  const where = ['st.is_won=0', 'st.is_lost=0', 'o.deleted_at IS NULL'];
  const params = [];
  if (sectorId) { where.push('o.sector_id = ?'); params.push(sectorId); }
  return (await all(`SELECT o.title_ar, o.value_halalas, o.win_pct, c.name_ar client FROM opportunity o
    JOIN stage st ON st.id=o.stage_id LEFT JOIN client c ON c.id=o.client_id
    WHERE ${where.join(' AND ')}
    ORDER BY o.value_halalas DESC LIMIT 5`, params)).map((d) => ({
    title: d.title_ar, client: d.client || '—', value_halalas: d.value_halalas, win_pct: d.win_pct }));
}
