// Report engine: builds report data (scope + redaction aware), renders via template,
// enqueues to email_queue. Permissions are evaluated at BUILD and SEND time per recipient.
import { all, get, insert, run, tx } from '../db/index.js';
import { effectiveProgress } from '../../modules/pmo/progress.js';
import { companyOverview, sectorDashboard, grossMargin, bookToBill, multiYearTrend,
  projectKpis, sectorUtilization, pipelineCoverage, winRate } from './metrics.js';
import { pipelineSummary } from '../../modules/crm/opportunities.js';
import { redact, canSeeSensitive } from '../rbac/index.js';
import { scopeFilter } from '../rbac/scope.js';
import { DELIVERY_SECTOR_SQL } from '../org/kind.js';
import { TEMPLATES } from '../mail/templates.js';
import { sendMail, DELIVERY } from '../mail/transport.js';
import { resolveUser } from '../http/context.js';
import { audit } from '../audit/index.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { id, nowIso, fmtSar } from '../util/ids.js';
import { config } from '../config.js';
import { MONTHS_AR as MONTHS } from '../i18n/time.js';
import { approvalTargetNames } from './periods.js';

// أسماء موارد الاعتماد بالعربية — لا يظهر اسم جدول لاتيني في بريد المالك.
const APPROVAL_RESOURCE_AR = { opportunity: 'فرصة', proposal: 'عرض', expense: 'مصروف',
  deliverable: 'مخرَج', timesheet: 'سجل وقت', invoice: 'فاتورة', project: 'مشروع', contract: 'عقد' };

const FY = () => config.fiscalYear;
const canSeeMargin = (u) => canSeeSensitive(u, 'margin');
const monthName = () => MONTHS[new Date().getUTCMonth()];
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); };

// Build the data payload for a report as seen by a given user (redaction via metrics/scope).
// نسبة الإنجاز المعروضة على صفوف مشاريع — من المصدر الواحد، ومكانها هنا كي لا تتكرّر السطران.
async function withEffectiveProgress(rows) {
  const pm = await effectiveProgress(rows);
  for (const r of rows) r.progress_effective_pct = pm.get(r.id)?.pct ?? 0;
  return rows;
}

export async function buildReport(reportKey, user, opts = {}) {
  if (reportKey === 'weekly_exec_brief') {
    const ov = await companyOverview(user);
    return {
      period: opts.period || periodLabel(),
      totals: ov.totals, pipeline_halalas: ov.pipeline_halalas, oppCount: ov.sectors.reduce((a, s) => a + s.opp_count, 0),
      achievements: await topAchievements(user), challenges: await topChallenges(user), decisions: await pendingDecisions(user), risks: await topRisks(),
      topDeals: await topWonDeals(), topPipeline: await topOpenOpps(user),
    };
  }
  if (reportKey === 'sector_weekly_status') {
    const sd = await sectorDashboard(user, opts.sectorId);
    // نسبة الإنجاز من مصدرها الواحد: التقرير يُرسَل بالبريد ويُقرأ سجلّاً، فلا يحمل رقماً
    // مستورداً لا يتحرّك مهما اعتُمدت مخرجات (انظر modules/pmo/progress.js).
    const projects = await all("SELECT id, name_ar, rag, status, progress_pct FROM project WHERE sector_id = ? AND deleted_at IS NULL AND status='IN_PROGRESS' ORDER BY rag DESC LIMIT 15", [opts.sectorId]);
    const pm1 = await effectiveProgress(projects);
    for (const p of projects) p.progress_effective_pct = pm1.get(p.id)?.pct ?? 0;
    return { sectorName: sd?.sector?.name_ar || '', period: opts.period || periodLabel(),
      projects, risks: await sectorRisks(opts.sectorId) };
  }
  if (reportKey === 'monthly_sector_performance') {
    // الاختيار التلقائي حين لا يذكر الطلب قطاعاً ولا يحمله حساب المستلم: أول **قطاع تسليم**.
    // بلا الشرط قد يقع الاختيار على وحدة مساندة (ترتيبها في الجدول لا يمنع ذلك) فيصل المالك
    // «تقرير أداء قطاع» شهري عن وحدة بلا مبيعات ولا هدف — تقرير لا يقول شيئاً ويُفقد الثقة بالبقية.
    const sid = opts.sectorId || user.sector_id || (await get(
      `SELECT id FROM sector WHERE active=1 AND deleted_at IS NULL AND ${DELIVERY_SECTOR_SQL}
        ORDER BY sort_order LIMIT 1`) || {}).id;
    const sd = sid ? await sectorDashboard(user, sid, { year: opts.year }) : null;
    if (!sd) return { sectorName: '—', period: `${monthName()} ${opts.year || FY()}`, revenue_halalas: 0, target_revenue_halalas: null,
      sales_halalas: 0, target_sales_halalas: null, margin_pct: null, target_margin_pct: null, revenue_yoy: null, book_to_bill: null, rag: 'GREEN', projects: [] };
    const gm = canSeeMargin(user) ? await grossMargin(sid, opts.year || FY()) : { margin_pct: null };
    const b2b = await bookToBill(sid, opts.year || FY());
    const trend = await multiYearTrend(sid, 2);
    const revYoy = trend.length >= 2 && trend[0].revenue_halalas ? Math.round((trend[1].revenue_halalas - trend[0].revenue_halalas) / trend[0].revenue_halalas * 100) : null;
    return { sectorName: sd?.sector?.name_ar || '', period: `${monthName()} ${opts.year || FY()}`,
      revenue_halalas: sd.revenue_halalas, target_revenue_halalas: sd.target_revenue_halalas,
      sales_halalas: sd.sales_halalas, target_sales_halalas: sd.target_sales_halalas,
      margin_pct: gm.margin_pct, target_margin_pct: sd.target_margin_pct,
      revenue_yoy: revYoy, book_to_bill: b2b.ratio, rag: sd.rag,
      projects: await withEffectiveProgress(
        await all("SELECT id, name_ar, rag, status, progress_pct FROM project WHERE sector_id=? AND deleted_at IS NULL AND status='IN_PROGRESS' ORDER BY rag DESC, contract_value_halalas DESC LIMIT 10", [sid])) };
  }
  if (reportKey === 'project_status_report') {
    let p = opts.projectId ? await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [opts.projectId]) : null;
    if (!p) p = await get(`SELECT * FROM project WHERE deleted_at IS NULL ${user.scope === 'company' ? '' : 'AND sector_id = ?'} ORDER BY contract_value_halalas DESC LIMIT 1`, user.scope === 'company' ? [] : [user.sector_id]);
    if (!p) throw new Error('لا يوجد مشروع متاح');
    return { period: periodLabel(), project: redact(user, 'project', p), kpis: await projectKpis(p.id),
      deliverables: (await all("SELECT name_ar FROM deliverable WHERE project_id=? AND status IN ('DRAFT','IN_PROGRESS','DELIVERED','REJECTED') AND deleted_at IS NULL LIMIT 6", [p.id])).map((d) => d.name_ar),
      risks: (await all("SELECT title FROM risk WHERE project_id=? AND status!='CLOSED' AND deleted_at IS NULL LIMIT 6", [p.id])).map((r) => r.title) };
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
      topOpen: await topOpenOpps(scopedUser, sid), winRate: wr.rate, coverage: cov.coverage, weighted_halalas: cov.weighted_halalas };
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

// ── مواعيد الجدولة ────────────────────────────────────────────────────────────
// كل الحساب في JS وبتوقيت UTC (لا دوال تاريخ في قاعدة البيانات — الاستعلامات محمولة).
// الموعد القادم يحترم الحقول المخزَّنة فعلاً في جدول الجدولة: send_time و day_of_week و day_of_month.
const DAY_MS = 86400000;
const FREQ_DAYS = { daily: 1, weekly: 7, biweekly: 14 };
const FREQ_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };
export const SCHEDULE_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom'];
// الأدوار التي تملك التحكم في الجدولة (إنشاء/إيقاف/تفعيل/حذف) — نفس القائمة لكل العمليات.
const SCHEDULE_ROLES = ['admin', 'sector_lead', 'ceo_office'];
const DEFAULT_SEND_TIME = '08:00';

function intInRange(v, lo, hi) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}
function parseSendTime(t) {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(String(t ?? ''));
  if (!m) return { h: 8, m: 0 };
  const h = Number(m[1]); const mi = Number(m[2]);
  if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return { h: 8, m: 0 };
  return { h, m: mi };
}
// يُخزَّن الوقت دائماً بصيغة HH:MM حتى تُقرأ منه الساعة والدقيقة بلا لبس.
function normalizeSendTime(t) {
  if (t === null || t === undefined || t === '') return DEFAULT_SEND_TIME;
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(t));
  const h = m ? Number(m[1]) : NaN; const mi = m ? Number(m[2]) : NaN;
  if (!m || !(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) {
    throw badRequest('وقت الإرسال يجب أن يكون بصيغة ساعة:دقيقة مثل 08:00 — صحّح الوقت وأعد المحاولة.');
  }
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
const lastDayOfMonth = (y, mo) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
const atUtc = (y, mo, day, h, mi) => new Date(Date.UTC(y, mo, day, h, mi, 0, 0));

/**
 * الموعد القادم لجدولة، دائماً في المستقبل (أكبر تماماً من اللحظة المرجعية).
 * @param {object} schedule صف الجدولة: { frequency, send_time, day_of_week (0=الأحد), day_of_month }
 * @param {Date|string} now اللحظة المرجعية (افتراضياً الآن)
 * @returns {string} موعد الإرسال القادم بصيغة نصية عالمية (UTC)
 */
export function nextRunAt(schedule = {}, now = new Date()) {
  const ref = now instanceof Date ? now : new Date(now);
  const base = Number.isNaN(ref.getTime()) ? new Date() : ref;
  const { h, m } = parseSendTime(schedule.send_time);
  const freq = String(schedule.frequency || '').trim().toLowerCase();

  // شهري/ربع سنوي/سنوي: اليوم من الشهر ثابت (يُقصَّر لآخر يوم في الأشهر القصيرة ثم يعود كما هو).
  if (FREQ_MONTHS[freq]) {
    const step = FREQ_MONTHS[freq];
    const wantedDay = intInRange(schedule.day_of_month, 1, 31) ?? base.getUTCDate();
    let idx = base.getUTCFullYear() * 12 + base.getUTCMonth();
    const candAt = (i) => {
      const y = Math.floor(i / 12); const mo = i % 12;
      return atUtc(y, mo, Math.min(wantedDay, lastDayOfMonth(y, mo)), h, m);
    };
    let cand = candAt(idx);
    for (let guard = 0; cand <= base && guard < 24; guard++) { idx += step; cand = candAt(idx); }
    return cand.toISOString();
  }

  // يومي/أسبوعي/كل أسبوعين — وأي تكرار غير معروف يبقى أسبوعياً كما كان السلوك السابق.
  const step = FREQ_DAYS[freq] || 7;
  let cand = atUtc(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), h, m);
  if (step >= 7) {
    const wantedDow = intInRange(schedule.day_of_week, 0, 6);
    if (wantedDow !== null) cand = new Date(cand.getTime() + ((wantedDow - cand.getUTCDay() + 7) % 7) * DAY_MS);
  }
  while (cand <= base) cand = new Date(cand.getTime() + step * DAY_MS);
  return cand.toISOString();
}

// هل يملك المستخدم التحكم في الجدولة؟ (تستعملها الواجهة لإخفاء أزرار لا تعمل — القرار يبقى في الخدمة)
export function canControlSchedules(user) {
  return !!user && SCHEDULE_ROLES.includes(user.role_id);
}
// الصلاحية تُفحص داخل الخدمة لا في المسار: نفس أدوار الإنشاء تتحكم في الإيقاف والحذف.
function assertCanSchedule(u) {
  if (!canControlSchedules(u)) throw forbidden('جدولة التقارير تتطلب صلاحية إدارية');
}
// من نطاقه قطاع واحد لا يتحكم إلا في جدولة قطاعه.
function assertScheduleScope(u, row) {
  if (u.scope === 'company') return;
  if (!row.sector_id) throw forbidden('هذه الجدولة على مستوى الشركة — التحكم بها لمن نطاقه الشركة كاملة.');
  if (row.sector_id !== u.sector_id) throw forbidden('هذه الجدولة تخص قطاعاً آخر — راجع قائد ذلك القطاع.');
}
async function loadSchedule(scheduleId) {
  if (!scheduleId) throw badRequest('حدّد الجدولة المطلوبة أولاً — اخترها من قائمة التقارير المجدولة.');
  const row = await get('SELECT * FROM report_schedule WHERE id = ?', [scheduleId]);
  if (!row) throw notFound('الجدولة غير موجودة — حدّث الصفحة واختر جدولة من القائمة.');
  return row;
}

// Create a report schedule (admin/sector_lead/ceo_office). Computes next_run_at.
export async function createSchedule(ctx, { reportId, frequency, recipientGroupId, sendTime, sectorId, dayOfWeek, dayOfMonth } = {}) {
  const u = ctx?.user;
  assertCanSchedule(u);
  if (!reportId || !frequency) throw badRequest('التقرير والتكرار مطلوبان');
  const freq = String(frequency).trim().toLowerCase();
  if (!SCHEDULE_FREQUENCIES.includes(freq)) {
    throw badRequest('تكرار غير معروف — اختر: يومي أو أسبوعي أو كل أسبوعين أو شهري أو ربع سنوي أو سنوي.');
  }
  const sid = id('rs'); const now = nowIso(); const at = new Date();
  const row = {
    id: sid, report_id: reportId, recipient_group_id: recipientGroupId || null,
    sector_id: sectorId || (u.scope === 'company' ? null : u.sector_id), frequency: freq,
    day_of_week: intInRange(dayOfWeek, 0, 6), day_of_month: intInRange(dayOfMonth, 1, 31),
    send_time: normalizeSendTime(sendTime), active: 1, created_by: u.id, created_at: now,
  };
  // بلا يوم محدد نثبّت يوم الإنشاء صراحةً في الصف، فيبقى الموعد على اليوم نفسه في كل دورة قادمة.
  if (row.day_of_week === null && (freq === 'weekly' || freq === 'biweekly')) row.day_of_week = at.getUTCDay();
  if (row.day_of_month === null && FREQ_MONTHS[freq]) row.day_of_month = at.getUTCDate();
  row.next_run_at = nextRunAt(row, at);
  await tx(async () => {
    await insert('report_schedule', row);
    await audit(ctx, { action: 'create', resource: 'report_schedule', resourceId: sid, sectorId: row.sector_id,
      detail: { frequency: freq, send_time: row.send_time, next_run_at: row.next_run_at } });
  });
  return await get('SELECT * FROM report_schedule WHERE id = ?', [sid]);
}

// إيقاف/تفعيل جدولة قائمة — كان التغيير الوحيد الممكن تعديلاً مباشراً على البيانات.
export async function setScheduleActive(ctx, scheduleId, active) {
  const u = ctx?.user;
  assertCanSchedule(u);
  if (active === null || active === undefined || active === '') {
    throw badRequest('حدّد الحالة المطلوبة: إيقاف أو تفعيل.');
  }
  const row = await loadSchedule(scheduleId);
  assertScheduleScope(u, row);
  const flag = (active === true || active === 1 || active === '1' || active === 'true') ? 1 : 0;
  // عند التفعيل نعيد حساب الموعد القادم من اللحظة الحالية حتى لا يُرسَل التقرير فوراً بموعد قديم فات.
  const next = flag ? nextRunAt(row, new Date()) : (row.next_run_at || null);
  await tx(async () => {
    await run('UPDATE report_schedule SET active = ?, next_run_at = CAST(? AS TEXT) WHERE id = ?', [flag, next, scheduleId]);
    await audit(ctx, { action: 'update', resource: 'report_schedule', resourceId: scheduleId, sectorId: row.sector_id,
      detail: { active: flag, next_run_at: next } });
  });
  return await get('SELECT * FROM report_schedule WHERE id = ?', [scheduleId]);
}

// حذف جدولة. جدول الجدولة لا يحمل عمود حذف ناعم اليوم، فالحذف = إيقاف دائم مع أثر في سجل التدقيق.
export async function deleteSchedule(ctx, scheduleId) {
  const u = ctx?.user;
  assertCanSchedule(u);
  const row = await loadSchedule(scheduleId);
  assertScheduleScope(u, row);
  await tx(async () => {
    await run('UPDATE report_schedule SET active = 0 WHERE id = ?', [scheduleId]);
    await audit(ctx, { action: 'delete', resource: 'report_schedule', resourceId: scheduleId, sectorId: row.sector_id,
      detail: { frequency: row.frequency, report_id: row.report_id } });
  });
  return { ok: true, id: scheduleId };
}

// Process the queue (called by the scheduler job or manually). Retries with backoff cap.
export async function processQueue(limit = 20) {
  const rows = await all("SELECT * FROM email_queue WHERE status IN ('QUEUED','FAILED') AND attempts < 4 ORDER BY created_at LIMIT ?", [limit]);
  let sent = 0, failed = 0, skipped = 0;
  for (const q of rows) {
    await run("UPDATE email_queue SET status='SENDING', attempts = attempts + 1 WHERE id = ?", [q.id]);
    try {
      const to = JSON.parse(q.to_json || '[]');
      const res = await sendMail({ to, cc: JSON.parse(q.cc_json || '[]'), subject: q.subject, html: q.html });
      // الحالة تصف ما جرى فعلاً: غادرت، أم عُوينت على القرص، أم حجبها حارس المستقبِلين.
      const status = res.delivery === DELIVERY.SENT ? 'SENT'
        : res.delivery === DELIVERY.BLOCKED ? 'BLOCKED' : 'PREVIEWED';
      // ولجوءُ القناة الاحتياطية يُكتب في الأثر: نجاحٌ عبر البديل يعني أن الأصلية معطوبة،
      // وبلا هذا السطر تعمل المنصة شهراً على قناةٍ ثانية ولا أحد يدري أن الأولى ساقطة.
      const detail = res.delivery === DELIVERY.BLOCKED
        ? `${res.reason} — ${(res.blocked || []).length} مستقبِلاً`
        : res.note ? res.note
          : (res.blocked || []).length ? `حُجب ${res.blocked.length} مستقبِلاً خارج قائمة السماح` : null;
      await run('UPDATE email_queue SET status=?, sent_at=? WHERE id=?', [status, nowIso(), q.id]);
      await insert('email_log', { id: id('el'), queue_id: q.id, event: status.toLowerCase(), detail, at: nowIso() });
      if (status === 'SENT') sent++; else skipped++;
    } catch (e) {
      await run("UPDATE email_queue SET status='FAILED', last_error=? WHERE id=?", [String(e.message).slice(0, 300), q.id]);
      await insert('email_log', { id: id('el'), queue_id: q.id, event: 'failed', detail: String(e.message).slice(0, 300), at: nowIso() });
      failed++;
    }
  }
  return { sent, failed, skipped, processed: rows.length };
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
// النطاق يُحترم كما في pendingDecisions أدناه: مستلمٌ نطاقُه قطاع لا تصله في بريده أسماءُ مشاريع
// قطاعٍ آخر (اكتمالاً أو حرَجاً). التقرير يُبنى بصلاحيات مستلمه، والبريد صادرٌ لا يُسترجَع.
async function topAchievements(user) {
  const where = ["status='COMPLETED'", 'deleted_at IS NULL']; const params = [];
  if (user && user.scope !== 'company') { where.push('sector_id = ?'); params.push(user.sector_id || ''); }
  return (await all(`SELECT name_ar FROM project WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 3`, params)).map((p) => 'اكتمال: ' + p.name_ar);
}
async function topChallenges(user) {
  const where = ["rag='RED'", 'deleted_at IS NULL']; const params = [];
  if (user && user.scope !== 'company') { where.push('sector_id = ?'); params.push(user.sector_id || ''); }
  return (await all(`SELECT name_ar FROM project WHERE ${where.join(' AND ')} LIMIT 3`, params)).map((p) => 'مشروع حرج: ' + p.name_ar);
}
// «القرارات المطلوبة» في الموجز التنفيذي كانت `.map(() => 'طلب اعتماد بانتظار القرار')`: تقرأ
// معرّف السجل ثم ترميه، فيصل المالك ثلاثة أسطر متطابقة حرفياً لا تقول أي فرصة ولا أي مصروف ولا
// كم بلغ. سطر لا يُميّز موضوعه لا يُتّخذ عليه قرار. الآن يحمل كل سطر هوية سجله الحقيقية —
// النوع بالعربية، واسم السجل من جدوله، والمبلغ إن وُجد — وبلا اختلاق اسم عند غيابه.
// والنطاق يُحترم: من نافذته قطاع لا تصله قرارات قطاع آخر في بريده.
async function pendingDecisions(user) {
  const where = ["ar.status = 'PENDING'"]; const params = [];
  if (user && user.scope !== 'company') { where.push('ar.sector_id = ?'); params.push(user.sector_id || ''); }
  const rows = await all(`SELECT ar.resource, ar.resource_id, ar.amount_halalas, wd.name_ar workflow
     FROM approval_request ar LEFT JOIN workflow_definition wd ON wd.id = ar.workflow_id
     WHERE ${where.join(' AND ')} ORDER BY ar.created_at LIMIT 3`, params);
  const names = await approvalTargetNames(rows);
  return rows.map((r) => {
    const kind = APPROVAL_RESOURCE_AR[r.resource] || 'طلب';
    const nm = names[r.resource]?.[r.resource_id];
    const amount = r.amount_halalas ? ` — ${fmtSar(r.amount_halalas)}` : '';
    return nm ? `${kind}: ${nm}${amount} — بانتظار القرار`
      : `${kind}${amount} — بانتظار القرار${r.workflow ? ` (${r.workflow})` : ''}`;
  });
}
async function topRisks() {
  return (await all("SELECT title FROM risk WHERE status!='CLOSED' AND deleted_at IS NULL ORDER BY CASE impact WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END LIMIT 4")).map((r) => r.title);
}
async function sectorRisks(sectorId) {
  return (await all("SELECT title FROM risk WHERE sector_id=? AND status!='CLOSED' AND deleted_at IS NULL LIMIT 4", [sectorId])).map((r) => r.title);
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
// ونطاق **المستلم** يُطبَّق فوقه بنفس خيارات قائمة الفرص: التقرير يُبنى بصلاحيات مستلمه
// (رأس هذا الملف)، ومستلمٌ ضُيّقت رؤيته إلى فرصه أو فرص إدارته كان يستلم بالبريد أسماء عملاء
// وقيم صفقاتٍ لا تعرضها له شاشة الفرص نفسها — والبريد صادرٌ لا يُسترجَع.
async function topOpenOpps(user, sectorId = null) {
  const f = scopeFilter(user, 'opportunity', 'read',
    { sectorCol: 'o.sector_id', ownerCol: 'o.owner_user_id', projectCol: 'o.id',
      grantCol: 'o.department_id', memberCol: 'o.id', deptCol: 'o.department_id' });
  const where = [f.clause, 'st.is_won=0', 'st.is_lost=0', 'o.deleted_at IS NULL'];
  const params = [...f.params];
  if (sectorId) { where.push('o.sector_id = ?'); params.push(sectorId); }
  return (await all(`SELECT o.title_ar, o.value_halalas, o.win_pct, c.name_ar client FROM opportunity o
    JOIN stage st ON st.id=o.stage_id LEFT JOIN client c ON c.id=o.client_id
    WHERE ${where.join(' AND ')}
    ORDER BY o.value_halalas DESC LIMIT 5`, params)).map((d) => ({
    title: d.title_ar, client: d.client || '—', value_halalas: d.value_halalas, win_pct: d.win_pct }));
}
