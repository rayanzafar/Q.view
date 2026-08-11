// بريد الاعتمادات: متى تُرسَل رسالة، ولمن، وبماذا — بقواعد المالك حرفياً:
//   • مجمَّعة دوماً: رسالةٌ واحدة تسرد كل المعلَّق لهذا الشخص — لا رسالة لكل طلب.
//   • بين رسالتين ثلاثون دقيقة على الأقل؛ وتمتد إلى أربع ساعات حين يكون قد أُخطر بركامٍ
//     يفوق ثلاثة بنود ما زال معلَّقاً — من يعلم بالكومة لا يُدَقّ بابه لكل ورقة جديدة.
//   • لا شيء خارج ساعات العمل (٨–١٨ بتوقيت الرياض): ما يصل ليلاً يلتقطه بريدُ الصباح.
//   • تذكيرٌ صباحيٌّ واحد في اليوم ما دام شيءٌ معلَّقاً — ولا شيء البتة حين لا شيء.
//
// القرار كله في دالةٍ نقية تُختبر بحقن اللحظة، والقيدُ في جدول `approval_mail_state`
// بتحديثٍ مشروط: الصفُّ هو قفل الإرسال، فلو عملت نسختان من الخادم معاً ظفر واحدٌ وسكت
// الآخر — لا رسالة تتكرر بتزامنٍ ولا بإعادة إقلاع.
//
// والرسالة لا تُرسَل هنا مباشرةً بل تدخل طابور البريد القائم (`email_queue`): إعادةُ
// المحاولة والقيد والمآل المرئي في شاشة البريد كلها هناك، ولا ننسخها. وحُجِبت الرسالة
// عند الإرسال (قائمة السماح) فالقيدُ هنا يبقى مستهلَكاً عمداً: الحجب سياسة بيئةٍ لا عطلٌ
// عابر، وإعادة المحاولة كل دقيقة ضجيجٌ بلا أثر — وبريدُ صباح الغد هو موعدها الصحيح.
import { all, run, insert } from '../../core/db/index.js';
import { id } from '../../core/util/ids.js';
import { riyadhHour, riyadhDate } from '../../core/i18n/time.js';
import { config } from '../../core/config.js';
import { decorateApprovals } from './inbox.js';
import { newApprovalsMail, approvalReminderMail } from '../../core/mail/approval-mail.js';

export const WORK_START_H = 8;                    // بتوقيت الرياض — لا توقيت صيفي
export const WORK_END_H = 18;
export const COOLDOWN_MS = 30 * 60000;            // بين رسالتين
export const BACKLOG_COOLDOWN_MS = 4 * 3600000;   // حين الركام المُخطَر به يفوق العتبة
export const BACKLOG_THRESHOLD = 3;               // «أكثر من ثلاثة» — حدّها الصارم

/**
 * القرار النقي: أتُرسَل رسالةٌ لهذا الشخص الآن، وأيُّ رسالة.
 * «المُخطَر به» يُحسب حياً: كل معلَّقٍ أُنشئ قبل آخر رسالة قد سبق ذكرُه فيها —
 * فلا عدّاد يفسد حين تُحسم بنودٌ بين رسالتين.
 *
 * @param {Date} now
 * @param {{last_sent_at?: string|null, last_reminder_date?: string|null}|null} state
 * @param {Array<{created_at: string}>} pending الطلبات الموجَّهة المعلَّقة لهذا الشخص
 * @returns {{action: 'none'|'send', kind?: 'new'|'reminder', cooldownMs?: number, reason: string}}
 */
export function approvalMailDecision(now, state, pending) {
  if (!pending.length) return { action: 'none', reason: 'لا معلَّق' };
  const h = riyadhHour(now);
  if (h < WORK_START_H || h >= WORK_END_H) return { action: 'none', reason: 'خارج ساعات العمل' };
  const lastSent = state?.last_sent_at ? Date.parse(state.last_sent_at) : null;
  const newItems = lastSent == null ? pending
    : pending.filter((p) => Date.parse(p.created_at) > lastSent);
  if (newItems.length) {
    const alreadyNotified = pending.length - newItems.length;
    const cooldownMs = alreadyNotified > BACKLOG_THRESHOLD ? BACKLOG_COOLDOWN_MS : COOLDOWN_MS;
    if (lastSent == null || now.getTime() - lastSent >= cooldownMs) {
      return { action: 'send', kind: 'new', cooldownMs, reason: 'جديدٌ خارج فترة التهدئة' };
    }
    return { action: 'none', reason: 'جديدٌ داخل فترة التهدئة' };
  }
  // لا جديد — يبقى التذكير الصباحي: أولُ فرصةٍ داخل النافذة كلَّ يومِ رياضٍ لم يُذكَّر فيه.
  // (لو تعطّل الخادم حتى الظهر يُرسَل ظهراً — تذكيرٌ متأخر خيرٌ من يومٍ بلا تذكير.)
  if ((state?.last_reminder_date || '') !== riyadhDate(now)) {
    return { action: 'send', kind: 'reminder', cooldownMs: COOLDOWN_MS, reason: 'تذكير اليوم لم يُرسَل' };
  }
  return { action: 'none', reason: 'لا جديد وتذكيرُ اليوم أُرسل' };
}

/**
 * الكنسة الدقيقيّة: كل المعلَّق الموجَّه بالشخص، مجموعاً بصاحبه، فقرارٌ نقي، فقيدٌ مشروط،
 * فرسالةٌ في طابور البريد. من لا بريد له يُتخطّى **بلا قيد** — لا حالَ يتقدّم لمن لم
 * يُحاوَل له شيء، فإن أُضيف بريده لاحقاً وصلته الرسالة من أول كنسة.
 */
export async function sweepApprovalMail(now = new Date()) {
  const rows = await all(
    `SELECT ar.*, wd.name_ar workflow_name, u.email recipient_email
       FROM approval_request ar
       JOIN workflow_definition wd ON wd.id = ar.workflow_id
       JOIN app_user u ON u.id = ar.assignee_user_id AND u.active = 1 AND u.deleted_at IS NULL
      WHERE ar.status = 'PENDING' AND ar.assignee_user_id IS NOT NULL
        AND ar.requested_by <> ar.assignee_user_id
      ORDER BY ar.created_at`);
  if (!rows.length) return { enqueued: 0, skipped: 0 };

  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.assignee_user_id)) byUser.set(r.assignee_user_id, []);
    byUser.get(r.assignee_user_id).push(r);
  }
  const uids = [...byUser.keys()];
  const states = new Map();
  const stateRows = await all(
    `SELECT * FROM approval_mail_state WHERE user_id IN (${uids.map(() => '?').join(',')})`, uids);
  for (const s of stateRows) states.set(s.user_id, s);

  // كل الطوابع من اللحظة المحقونة نفسها التي قرّرت بها الدالة — لا ساعة ثانية في منتصف الكنسة.
  let enqueued = 0, skipped = 0;
  const nowTs = now.toISOString(), today = riyadhDate(now);
  for (const [uid, pending] of byUser) {
    const email = pending[0].recipient_email;
    if (!email) { skipped++; continue; }
    const d = approvalMailDecision(now, states.get(uid) || null, pending);
    if (d.action !== 'send') { skipped++; continue; }

    // القيد المشروط — الحَكَم الوحيد بين النسخ المتزامنة. شرطُ «جديد» هو نفس فترة التهدئة
    // التي قرّرت الدالة بها؛ وشرطُ «تذكير» هو يومُ الرياض نفسه. من خسر الشرط سكت.
    const cutoff = new Date(now.getTime() - d.cooldownMs).toISOString();
    const guard = d.kind === 'new'
      ? 'approval_mail_state.last_sent_at IS NULL OR approval_mail_state.last_sent_at <= ?'
      : "COALESCE(approval_mail_state.last_reminder_date, '') <> ?";
    const res = await run(
      `INSERT INTO approval_mail_state (user_id, last_sent_at, last_reminder_date, notified_count, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         last_sent_at = excluded.last_sent_at, last_reminder_date = excluded.last_reminder_date,
         notified_count = excluded.notified_count, updated_at = excluded.updated_at
       WHERE ${guard}`,
      [uid, nowTs, today, pending.length, nowTs, d.kind === 'new' ? cutoff : today]);
    if (!res.changes) { skipped++; continue; }   // نسخةٌ أخرى ظفرت بهذه الرسالة

    const items = (await decorateApprovals(pending)).map((it) => ({
      ...it,
      ageDays: Math.max(0, Math.floor((now.getTime() - Date.parse(it.created_at)) / 86400000)),
    }));
    const mail = d.kind === 'new'
      ? newApprovalsMail({ items, platformUrl: config.platformUrl })
      : approvalReminderMail({ items, platformUrl: config.platformUrl });
    const qid = id('eq');
    await insert('email_queue', {
      id: qid, schedule_id: null, to_json: JSON.stringify([email]), cc_json: JSON.stringify([]),
      subject: mail.subject, html: mail.html, status: 'QUEUED', created_at: nowTs,
    });
    await insert('email_log', { id: id('el'), queue_id: qid, event: 'enqueued', detail: `approval_${d.kind}`, at: nowTs });
    enqueued++;
  }
  return { enqueued, skipped };
}
