#!/usr/bin/env node
// ── إضافة مهامٍ نيابةً عن موظف، بعضها مُنجَزٌ رجعياً ─────────────────────────────
//
// أداة عامة قابلة لإعادة الاستعمال: مديرٌ (أو مدير النظام) يسجّل مهاماً كانت قد أُنجزت
// فعلاً لكنها لم تُكتب في حينها — أو مهاماً يريد إسنادها الآن نيابةً عن موظفه. لا شيء هنا
// خاصٌّ بموظفٍ بعينه؛ كل شيء يُقرأ من ملف مُدخَلٍ بصيغة JSON.
//
//   node scripts/add-tasks-on-behalf.mjs --file=<input.json>              ← معاينة (افتراضي، لا يُكتب شيء)
//   node scripts/add-tasks-on-behalf.mjs --file=<input.json> --apply      ← التنفيذ الفعلي
//
// ── صيغة ملف الإدخال ──────────────────────────────────────────────────────────
// {
//   "actor_email": "sysadmin@evc.sa",     // من يُنشئ المهمة (نيابةً)
//   "assignee_email": "person@evc.sa",    // صاحب المهمة الفعلي
//   "tasks": [
//     { "title": "...", "description": "...",            // description اختياري
//       "due_date": "YYYY-MM-DD",
//       "work_kind": "internal" | "project",
//       "project_id": "p_...",                            // مطلوب إن كان work_kind = "project"
//       "mark_done": true|false,
//       "completed_at": "ISO-8601",                        // اختياري: ختمٌ رجعي (تأريخ سابق)
//       "notify": false }                                  // موثَّق أدناه — لا يُطبَّق فعلياً بعد
//   ]
// }
//
// ── مسار الكتابة ─────────────────────────────────────────────────────────────
// كل مهمة تمر بخدمة `quickAddTask` (سياق الفاعل = actor) — فتُنسب إليه في created_by كما
// تُنسب أي مهمة أنشأها إنسانٌ حقيقي من الشاشة. فإن طُلب إنجازها فوراً (`mark_done`)، يلي ذلك
// نداءٌ ثانٍ إلى `updateTask` بسياقٍ مستقلٍّ مبنيٍّ على حساب **صاحب المهمة نفسه** — فيصير
// completed_by هويته هو لا هوية من أنشأها نيابةً عنه، وهذا معنى «أنجزها هو» الحرفي حتى مع
// أن من كتبها غيره. وإن حُدِّد `completed_at` صراحةً (ختمٌ سابقٌ على وقت التشغيل الفعلي)،
// فذلك تأريخٌ رجعي: `updateTask` يختم دائماً بالوقت الحاضر (لا سبيل غير ذلك عبر الخدمة)،
// فيلي ذلك تصحيحٌ مباشر على العمود مع سطر تدقيقٍ صريح يقول القديم والجديد والسبب — الاستدراك
// الرجعي لا يمرّ صامتاً.
//
// ── ما لا يفعله هذا الملف عمداً ───────────────────────────────────────────────
//   • لا TRUNCATE ولا DELETE — إدراجٌ وتحديثٌ لصفوفٍ جديدة فقط، عبر خدمات المنصة.
//   • لا حسابات جديدة ولا تغيير صلاحيات — actor و assignee كلاهما حسابٌ **قائم** يُقرأ
//     بالبريد، وإلا توقّف السكربت برسالة صريحة بدل افتراض أو إنشاء.
//   • لا معاينة تكتب: `--dry-run` (وهو الافتراضي بلا `--apply`) لا يفتح معاملة كتابة إطلاقاً.
//
// ── فجوةُ الإشعارات (موثَّقة لا مُصلَحة) ──────────────────────────────────────
// `quickAddTask` يُطلق إشعار «مهمة جديدة أُسندت إليك» متى كان المُسنَد إليه غير الكاتب —
// وهنا always (actor ≠ assignee بحكم الغرض). لا مفتاح سياقٍ ولا مُعامل في `tasks.js` أو
// `notify.js` يُسكت هذا النداء (بحث في المصدر: لا `suppressNotify`/`skipNotify` ولا مثيل).
// حقل `notify` في المُدخَل **موثَّقٌ فقط** حالياً؛ هذا السكربت لا يلتف حول داخليات وحدة
// الإشعارات لإسكاته (تعليمة صريحة) — فمن يُنجز مهامَّ رجعية عبره سيصله إشعار «مهمة جديدة»
// طازجاً عن مهمةٍ مُنجَزة أصلاً. صلاح ذلك يحتاج تغييراً في `tasks.js`/`notify.js` نفسهما
// (مفتاح ctx.suppressNotify مثلاً) — خارج نطاق هذا السكربت عمداً.
//
// ── ملاحظات تشغيل ────────────────────────────────────────────────────────────
//   • DATABASE_URL في البيئة يوجّه الاتصال إلى بوستجرس؛ غيابه يشغّل السكربت على سكويلايت
//     محلية (نفس ما تفعله بقية أدوات platform/scripts).
//   • كل مهمة تُنشأ عبر tx() ضمن quickAddTask — فشلُ مهمة واحدة لا يُسقط ما قبلها (كل مهمة
//     معاملتها الخاصة)، ويُطبع الفشل باسم المهمة ويُكمل الباقي.
//   • idempotent بحدود: إعادة تشغيل --apply على الملف نفسه تُنشئ مهاماً **جديدة** مكررة —
//     لا عمود «معرّف مستقر» (legacy_id) في جدول task لبناء ON CONFLICT عليه. شغّله مرة واحدة
//     لكل ملف إدخال، وتحقّق بالاستعلام قبل إعادة أي تشغيل.

import { get } from '../src/core/db/index.js';
import { update as dbUpdate, close } from '../src/core/db/index.js';
import { audit } from '../src/core/audit/index.js';
import { initRbac } from '../src/core/rbac/index.js';
import { quickAddTask, updateTask } from '../src/modules/pmo/tasks.js';
import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const o = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) o[m[1]] = m[2] ?? true;
  }
  return o;
}

async function loadUserByEmail(email, label) {
  const row = await get(
    'SELECT * FROM app_user WHERE lower(email) = lower(?) AND deleted_at IS NULL AND active = 1', [email]);
  if (!row) throw new Error(`${label}: لا حساب دخول نشط بالبريد «${email}»`);
  return row;
}

function validateTask(t, i) {
  const where = `المهمة رقم ${i + 1}`;
  if (!t.title || !String(t.title).trim()) throw new Error(`${where}: العنوان مطلوب`);
  if (!t.due_date) throw new Error(`${where}: تاريخ الاستحقاق مطلوب`);
  if (!['internal', 'project'].includes(t.work_kind)) throw new Error(`${where}: work_kind يجب أن يكون internal أو project`);
  if (t.work_kind === 'project' && !t.project_id) throw new Error(`${where}: project_id مطلوب مع work_kind=project`);
}

export async function planTasks({ file, apply = false }) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!raw.actor_email) throw new Error('الملف: actor_email مطلوب');
  if (!raw.assignee_email) throw new Error('الملف: assignee_email مطلوب');
  if (!Array.isArray(raw.tasks) || !raw.tasks.length) throw new Error('الملف: tasks يجب أن تكون مصفوفة غير فارغة');
  raw.tasks.forEach(validateTask);

  const actor = await loadUserByEmail(raw.actor_email, 'actor_email');
  const assignee = await loadUserByEmail(raw.assignee_email, 'assignee_email');
  const ctxActor = { user: actor, ip: '127.0.0.1' };
  const ctxAssignee = { user: assignee, ip: '127.0.0.1' };

  const summary = { total: raw.tasks.length, internal: 0, project: 0, markDone: 0, backdated: 0 };
  for (const t of raw.tasks) {
    summary[t.work_kind === 'project' ? 'project' : 'internal']++;
    if (t.mark_done) summary.markDone++;
    if (t.mark_done && t.completed_at) summary.backdated++;
  }

  const created = [];
  const failures = [];
  if (apply) {
    await initRbac();
    for (const t of raw.tasks) {
      try {
        const row = await quickAddTask(ctxActor, {
          title: t.title,
          description: t.description || null,
          due_date: t.due_date,
          work_kind: t.work_kind,
          project_id: t.work_kind === 'project' ? t.project_id : null,
          assignee_user_id: assignee.id,
        });
        let completedAt = null;
        if (t.mark_done) {
          const done = await updateTask(ctxAssignee, row.id, { status: 'DONE' });
          completedAt = done.completed_at;
          if (t.completed_at && t.completed_at !== done.completed_at) {
            // تأريخٌ رجعي: الخدمة تختم بالوقت الحاضر دائماً، فيُصحَّح العمود مباشرة مع أثرٍ صريح.
            await dbUpdate('task', row.id, { completed_at: t.completed_at, updated_by: actor.id });
            await audit(ctxActor, {
              action: 'task.completed_at.backdated', resource: 'task', resourceId: row.id, sectorId: row.sector_id || null,
              detail: { from: done.completed_at, to: t.completed_at, reason: 'تعبئة رجعية عبر add-tasks-on-behalf.mjs — تاريخ إنجاز فعلي سابق لوقت التشغيل' },
            });
            completedAt = t.completed_at;
          }
        }
        created.push({ id: row.id, title: t.title, work_kind: t.work_kind, project_id: row.project_id,
          due_date: row.due_date, mark_done: !!t.mark_done, completed_at: completedAt });
      } catch (e) {
        failures.push({ title: t.title, reason: e?.message || String(e) });
      }
    }
  }

  return { actor, assignee, tasks: raw.tasks, summary, created, failures };
}

function renderPlan({ actor, assignee, tasks, summary, created, failures }, { apply }) {
  const L = []; const p = (s = '') => L.push(s);
  p(apply ? 'إضافة مهام نيابة — تنفيذ' : 'إضافة مهام نيابة — معاينة (لا يُكتب شيء)');
  p('═'.repeat(78));
  p(`الفاعل (المُنشئ): ${actor.name_ar || actor.username} <${actor.email}>`);
  p(`صاحب المهام: ${assignee.name_ar || assignee.username} <${assignee.email}>`);
  p(`الإجمالي: ${summary.total} · داخلية: ${summary.internal} · مشروع: ${summary.project} · تُختم منجَزة: ${summary.markDone} · تأريخٌ رجعي: ${summary.backdated}`);
  p();
  if (!apply) {
    p('ما سيُنشأ'); p('─'.repeat(78));
    tasks.forEach((t, i) => {
      p(`   ${i + 1}. [${t.work_kind}${t.project_id ? ' ' + t.project_id : ''}] ${t.title}`);
      p(`      استحقاق ${t.due_date}${t.mark_done ? ` · يُختم منجَزة${t.completed_at ? ` بتاريخ ${t.completed_at} (رجعي)` : ' (بوقت التشغيل)'}` : ''}`);
    });
  } else {
    p('ما نُفِّذ'); p('─'.repeat(78));
    for (const c of created) {
      p(`   ✓ ${c.id} — ${c.title} [${c.work_kind}${c.project_id ? ' ' + c.project_id : ''}] استحقاق ${c.due_date}${c.mark_done ? ` · منجَزة${c.completed_at ? ' بتاريخ ' + c.completed_at : ''}` : ''}`);
    }
    if (failures.length) {
      p(`تعذّر: ${failures.length}`);
      for (const f of failures) p(`   ✗ ${f.title} — ${f.reason}`);
    }
  }
  p();
  p('ملاحظة: إشعار «مهمة جديدة أُسندت إليك» يصل لصاحب المهام عند كل إنشاء — لا مفتاح لإسكاته حالياً (انظر رأس الملف).');
  return L.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file) { console.error('استعمال: --file=<input.json> [--apply]'); process.exit(2); }
  const apply = opts.apply === true || opts.apply === 'true';
  const plan = await planTasks({ file: opts.file, apply });
  console.log(renderPlan(plan, { apply }));
  await close?.();
  if (!apply) return;
  if (plan.failures.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('تعذّر إتمام العملية:', e.message); process.exit(1); });
}
