// بريد الاعتمادات — سياسةٌ يملكها مدير النظام من شاشة البريد، لا ثوابتُ في الكود:
//   • رسالة «طلب جديد»: فوريةٌ افتراضياً (تهدئة صفر) وفي أي ساعة — «كل طلبٍ يصل بريدُه» بقرار
//     المالك. والتهدئةُ رقمٌ بالدقائق يرفعه المدير متى شاء، والدفعُ مجمَّعٌ دوماً: الكنسةُ
//     الدقيقيّة تجمع ما تزامن في رسالةٍ واحدة تسرد **كل** المعلَّق لا الجديدَ وحده.
//   • التذكيرُ الدوري: مُطفأٌ افتراضياً. وحين يُفعَّل: كل N ساعة (يضبطها المدير) وداخل ساعات
//     العمل وحدها (٨–١٨ بتوقيت الرياض) — الليلُ للطلب الجديد الفوري لا للتذكير.
//
// ── حَكَمُ التزامن: ختمُ الإخطار على الطلب لا حسابُ الأزمنة ─────────────────────
// عند تهدئةٍ صفرية يجتاز شرطَ الوقت كلُّ النسخ معاً، فالقفلُ عضويةٌ دقيقة: «صفوفٌ لم
// تُذكر في رسالةٍ بعد» (`approval_request.notified_at IS NULL`)، والتحديثُ المشروط عليها
// هو الحَكَم — من ظفر به أرسل ومن خسره سكت. وهو أصدقُ من المقارنة بآخر إرسال: صفٌّ لم
// يُدَّعَ يبقى قابلاً للادّعاء أبداً، فلا يضيع طلبٌ بانحرافِ ساعةٍ بين كاتبٍ وكانس.
// وكلُّ كتلةِ مستخدمٍ (ختمٌ فحالٌ فرسالة) داخل معاملةٍ واحدة: لا ختمٌ بلا رسالةٍ تليه.
//
// والرسالة لا تُرسَل هنا مباشرةً بل تدخل طابور البريد القائم (`email_queue`): إعادةُ
// المحاولة والقيد والمآل المرئي في شاشة البريد كلها هناك، ولا ننسخها.
import { all, run, insert, tx } from '../../core/db/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { riyadhHour } from '../../core/i18n/time.js';
import { config } from '../../core/config.js';
import { audit } from '../../core/audit/index.js';
import { badRequest, forbidden } from '../../core/http/errors.js';
import { refreshSettings, settingValue, writeSettings } from '../../core/settings/index.js';
import { decorateApprovals } from './inbox.js';
import { newApprovalsMail, approvalReminderMail } from '../../core/mail/approval-mail.js';

// الافتراضات — تسري على قاعدةٍ بلا صفِّ إعدادٍ واحد، وهي قرار المالك الحالي حرفياً.
export const DEFAULT_RULES = {
  reminderEnabled: false,
  reminderIntervalMs: 24 * 3600000,
  newCooldownMs: 0,
  workStartH: 8,                     // بتوقيت الرياض (+٣ ثابتة) — نافذة التذكير وحده
  workEndH: 18,
};

const KEYS = {
  enabled: 'approval_reminder_enabled',
  hours: 'approval_reminder_hours',
  cooldown: 'approval_new_cooldown_minutes',
};
const BOUNDS = { hours: [1, 168], cooldown: [0, 1440] };

// قيمةٌ معطوبة تقع على افتراضها بصمت — إعدادٌ خربٌ لا يوقف بريد المنصة.
const intOr = (raw, fallback, [lo, hi]) => {
  const n = Number(String(raw ?? '').trim());
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
};

/** سياسة البريد الحالية من لقطة الإعدادات — تُقرأ مرةً لكل كنسة لا لكل مستخدم. */
export async function loadApprovalMailRules() {
  await refreshSettings();
  return {
    ...DEFAULT_RULES,
    reminderEnabled: settingValue(KEYS.enabled, '0') === '1',
    reminderIntervalMs: intOr(settingValue(KEYS.hours), 24, BOUNDS.hours) * 3600000,
    newCooldownMs: intOr(settingValue(KEYS.cooldown), 0, BOUNDS.cooldown) * 60000,
  };
}

/**
 * القرار النقي: أتُرسَل رسالةٌ لهذا الشخص الآن، وأيُّ رسالة.
 * «الجديد» عضويةٌ لا زمن: صفوفٌ لم تُختم بإخطارٍ بعد (`notified_at IS NULL`).
 *
 * @param {Date} now
 * @param {{last_sent_at?: string|null}|null} state حالُ بريد هذا المعتمِد
 * @param {Array<{notified_at?: string|null}>} pending الطلبات الموجَّهة المعلَّقة له
 * @param {object} rules سياسة المدير — الافتراض `DEFAULT_RULES`
 * @returns {{action: 'none'|'send', kind?: 'new'|'reminder', reason: string}}
 */
export function approvalMailDecision(now, state, pending, rules = DEFAULT_RULES) {
  if (!pending.length) return { action: 'none', reason: 'لا معلَّق' };
  const lastSent = state?.last_sent_at ? Date.parse(state.last_sent_at) : null;
  const unnotified = pending.filter((p) => !p.notified_at);
  if (unnotified.length) {
    // الجديد يُرسَل في أي ساعة — قرار المالك: «كل طلبٍ يصل بريدُه». والتهدئة إن رُفعت عن
    // الصفر تُمسك الدفعة، **ولا تذكير يتسلّل من تحتها**: تذكيرٌ أثناء الإمساك يهرّب الممسوك.
    if (rules.newCooldownMs === 0 || lastSent == null || now.getTime() - lastSent >= rules.newCooldownMs) {
      return { action: 'send', kind: 'new', reason: 'جديدٌ يُرسَل' };
    }
    return { action: 'none', reason: 'جديدٌ داخل فترة التهدئة' };
  }
  if (!rules.reminderEnabled) return { action: 'none', reason: 'التذكير موقوف' };
  const h = riyadhHour(now);
  if (h < rules.workStartH || h >= rules.workEndH) return { action: 'none', reason: 'خارج ساعات العمل' };
  // لا حالَ إرسالٍ محفوظاً وكلُّ المعلَّق مختوم: هيئةُ تعافٍ من عطبٍ — يُذكَّر فوراً لا يُنسى.
  if (lastSent == null || now.getTime() - lastSent >= rules.reminderIntervalMs) {
    return { action: 'send', kind: 'reminder', reason: 'مضى فاصل التذكير' };
  }
  return { action: 'none', reason: 'داخل فاصل التذكير' };
}

/**
 * الكنسة الدقيقيّة: كل المعلَّق الموجَّه بالشخص، مجموعاً بصاحبه، فقرارٌ نقي، فمعاملةٌ
 * تختم وتقيّد وتُرسل معاً. من لا بريد له يُتخطّى **بلا ختم** — فإن أُضيف بريدُه لاحقاً
 * وصلته طلباتُه القائمة من أول كنسة.
 */
export async function sweepApprovalMail(now = new Date(), rules = null) {
  rules ??= await loadApprovalMailRules();
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

  let enqueued = 0, skipped = 0;
  const nowTs = now.toISOString();
  for (const [uid, pending] of byUser) {
    const email = pending[0].recipient_email;
    if (!email) { skipped++; continue; }
    const d = approvalMailDecision(now, states.get(uid) || null, pending, rules);
    if (d.action !== 'send') { skipped++; continue; }

    // معاملةٌ واحدة: الختمُ الحَكَم، ثم الحالُ، ثم الرسالة — فلا ختمَ بلا رسالةٍ تليه،
    // ولا رسالةَ من نسختين: الخاسر يقرأ صفر تغييراتٍ فيسكت.
    const won = await tx(async () => {
      if (d.kind === 'new') {
        const ids = pending.filter((p) => !p.notified_at).map((p) => p.id);
        const claim = await run(
          `UPDATE approval_request SET notified_at = ?
            WHERE id IN (${ids.map(() => '?').join(',')}) AND notified_at IS NULL`,
          [nowTs, ...ids]);
        if (!claim.changes) return false;
        await run(
          `INSERT INTO approval_mail_state (user_id, last_sent_at, notified_count, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET last_sent_at = excluded.last_sent_at,
             notified_count = excluded.notified_count, updated_at = excluded.updated_at`,
          [uid, nowTs, pending.length, nowTs]);
      } else {
        // التذكير: حَكَمُه فاصلُه — تحديثٌ مشروط بمضيّ الفاصل، فلا تذكير مكرر بين النسخ.
        const cutoff = new Date(now.getTime() - rules.reminderIntervalMs).toISOString();
        const claim = await run(
          `INSERT INTO approval_mail_state (user_id, last_sent_at, notified_count, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET last_sent_at = excluded.last_sent_at,
             notified_count = excluded.notified_count, updated_at = excluded.updated_at
           WHERE approval_mail_state.last_sent_at IS NULL OR approval_mail_state.last_sent_at <= ?`,
          [uid, nowTs, pending.length, nowTs, cutoff]);
        if (!claim.changes) return false;
      }
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
      return true;
    });
    if (won) enqueued++; else skipped++;
  }
  return { enqueued, skipped };
}

/**
 * سياسة بريد الاعتمادات — لمدير النظام وحده، وتسري على المنصة كلها فوراً.
 * كتابةُ المفاتيح الثلاثة وأثرُ تدقيقٍ واحد داخل معاملة، ثم تجديدُ اللقطة بعد نجاحها
 * (خارج المعاملة عمداً: تراجُعها يجب ألّا يسمّم اللقطة بقيمٍ لم تُكتب).
 */
export async function setApprovalMailPolicy(ctx, { reminder_enabled, reminder_hours, cooldown_minutes } = {}) {
  const user = ctx.user;
  if (user?.role_id !== 'admin') throw forbidden('إعدادات بريد الاعتمادات من صلاحية مدير النظام وحده');

  const enabled = reminder_enabled === true || reminder_enabled === 1 || reminder_enabled === '1';
  const hours = Number(reminder_hours);
  if (!Number.isInteger(hours) || hours < BOUNDS.hours[0] || hours > BOUNDS.hours[1]) {
    throw badRequest('فاصل التذكير بالساعات من 1 إلى 168');
  }
  const minutes = Number(cooldown_minutes);
  if (!Number.isInteger(minutes) || minutes < BOUNDS.cooldown[0] || minutes > BOUNDS.cooldown[1]) {
    throw badRequest('تهدئة رسائل الطلبات الجديدة بالدقائق من 0 إلى 1440');
  }

  const before = await loadApprovalMailRules();
  await tx(async () => {
    await writeSettings({
      [KEYS.enabled]: enabled ? '1' : '0',
      [KEYS.hours]: String(hours),
      [KEYS.cooldown]: String(minutes),
    }, { updatedBy: user.id });
    await audit(ctx, {
      action: 'update', resource: 'app_setting', resourceId: 'approval_mail_policy',
      detail: {
        old: { enabled: before.reminderEnabled, hours: before.reminderIntervalMs / 3600000, minutes: before.newCooldownMs / 60000 },
        new: { enabled, hours, minutes },
      },
    });
  });
  await refreshSettings({ force: true });
  return { reminder_enabled: enabled, reminder_hours: hours, cooldown_minutes: minutes };
}
