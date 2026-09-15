#!/usr/bin/env node
// إصلاح الربط **القاطع وحده** بين حساب الدخول وسجل الموظف — معاينةٌ افتراضياً.
//
//   node --experimental-sqlite scripts/fix-org-links.mjs            ← معاينة: لا يُكتب صفٌّ واحد
//   node --experimental-sqlite scripts/fix-org-links.mjs --apply    ← التنفيذ
//
// ── ما يُعدّ «قاطعاً بلا شكّ» ─────────────────────────────────────────────────
// حالةٌ واحدة لا غير: **العلاقة مثبتة أصلاً في أحد العمودين والآخر فارغ**. القاعدة نفسها هي من
// يقول «هذا الحساب هو هذا الموظف» — نحن لا نستنتجها، نُكمل مرآتها. ولا منازع على أيٍّ من
// الطرفين (لا حساب ثانٍ يدّعي السجل، ولا سجل ثانٍ يدّعي الحساب).
//
// ── ما لا يفعله هذا السكربت، ولن يفعله ───────────────────────────────────────
//   • **لا تخمين بتشابه الأسماء إطلاقاً.** التوأم المرشَّح — حسابٌ وسجلٌّ باسمٍ واحد بلا رابط —
//     يُطبع في «تحتاج قرار إنسان» ويُترك كما هو، مهما بلغت درجة الثقة. اسمان متطابقان دليلٌ لا
//     إثبات، وربطٌ خاطئ يفتح لشخصٍ ملفَّ شخصٍ آخر: خطأٌ أسوأ بكثير من فراغٍ ظاهر.
//   • **لا يفعّل حساباً معطَّلاً ولا يرسل بريداً.** التفعيل والدعوة قرارٌ منفصل بيد المالك.
//     وهذا مبدأٌ مستقرّ في هذه الشجرة لا اجتهادٌ هنا: حارس `deactivated_at` في
//     scripts/seed-roles.js يقول حرفياً «ما أُغلق بقرارٍ لا تُعيده بذرة». نلتزم به: من عليه ختم
//     إغلاق يُصلَح ربطُه إن كان قاطعاً — ولا يُمسّ عمود `active` ولا `deactivated_at` أبداً.
//
// ── كيف يكتب ─────────────────────────────────────────────────────────────────
// كل كتابة عبر خدمة الهيكل في src/modules/org/org.js (`linkUserToEmployee` / `unlinkUserFrom-
// Employee`) — لا SQL خام، فيمر كل صف بتحققات الخدمة وسطور تدقيقها.
// وقابل لإعادة التشغيل بلا أثر مضاعف: بعد أول تنفيذ لا يبقى نصفُ ربطٍ يُلتقط، فالتشغيل الثاني
// يجد صفراً ولا يكتب شيئاً.
import { close } from '../src/core/db/index.js';
import { linkUserToEmployee, unlinkUserFromEmployee } from '../src/modules/org/org.js';
import { auditOrgLinks } from './audit-org-links.mjs';

// المُنفِّذ: مدير نظام بنطاق شركة — الإصلاح يعبر قطاعات متعددة، ونطاقٌ أضيق سيُسقط نصف الحالات
// بصمت. اسمه يظهر في كل سطر تدقيق فيُعرف أن هذا الصف كتبه السكربت لا إنسان.
export const FIXER = { id: 'fix-org-links', username: 'fix-org-links', name_ar: 'إصلاح ربط الحسابات',
  role_id: 'admin', scope: 'company', sector_id: null, projectIds: new Set(), teamIds: new Set() };
const fixerCtx = (over = {}) => ({ user: { ...FIXER, ...(over.user || {}) }, ip: over.ip || '127.0.0.1' });

// ─────────────────────────────────────────────────────────────────────────────
// الخطة — تُشتقّ من الكشف نفسه، فلا تفترق قاعدةُ «ما يُصلَح» عن قاعدة «ما يُكشَف».
// ─────────────────────────────────────────────────────────────────────────────
export async function planFixes(opts = {}) {
  const rep = opts.report || await auditOrgLinks(opts);

  // القاطع: نصفُ ربطٍ من أيّ الاتجاهين. الكشف سبق أن أخرج منه كل تعارضٍ ونزاعٍ وإشارةٍ مكسورة.
  const certain = [
    ...rep.halfLinks.fromUser.map((r) => ({ ...r, repair: 'mirror_to_employee',
      action: `يُكتب سجل الموظف «${r.employee_name_ar}» مشيراً إلى الحساب ${r.username}` })),
    ...rep.halfLinks.fromEmployee.map((r) => ({ ...r, repair: 'mirror_to_user',
      action: `يُكتب الحساب ${r.username} مشيراً إلى سجل الموظف «${r.employee_name_ar}»` })),
  ];

  // ما يُترك لقرار إنسان — بسببه صريحاً، لا «تعذّر».
  const human = [
    ...rep.twins.map((r) => ({ kind: 'توأم مرشَّح', who: `«${r.employee_name_ar}» ⟷ ${r.username}`,
      reason: `${r.basis} (ثقة ${r.confidence}) — لا يُربط بتشابه اسم` })),
    ...rep.halfLinks.conflicts.map((r) => ({ kind: r.kind, who: r.employee_name_ar || r.username, reason: r.why })),
    ...rep.halfLinks.broken.map((r) => ({ kind: 'إشارة مكسورة',
      who: r.employee_name_ar || r.username || r.points_to, reason: r.why })),
    ...rep.accountsNoEmployee.gaps.map((r) => ({ kind: 'حساب بلا سجل موظف', who: r.username,
      reason: 'لا سجل موظف يُربط به — يُنشأ السجل بيد إنسان' })),
    ...rep.employeesNoAccount.gaps.map((r) => ({ kind: 'سجل موظف بلا حساب', who: r.employee_name_ar,
      reason: 'لا حساب دخول يُربط به — إنشاء الحساب ودعوته قرارك' })),
    ...rep.placement.noSector.map((r) => ({ kind: 'موظف بلا قطاع', who: r.employee_name_ar, reason: r.impact })),
    ...rep.placement.noDepartment.map((r) => ({ kind: 'موظف بلا إدارة', who: r.employee_name_ar, reason: r.impact })),
    ...rep.departments.noManager.map((r) => ({ kind: 'إدارة بلا مسؤول', who: r.department_name_ar, reason: r.impact })),
    ...rep.dormantWithWork.map((r) => ({ kind: 'حساب مغلق وعليه عمل', who: `${r.employee_name_ar || r.user_name_ar} (${r.username})`,
      reason: `${r.work_phrase} — التفعيل والدعوة قرارك وحدك، ولا يمسّه هذا السكربت` })),
  ];

  return { today: rep.today, certain, human, report: rep };
}

// ─────────────────────────────────────────────────────────────────────────────
// التنفيذ — لا يُستدعى إلا بـ--apply
// ─────────────────────────────────────────────────────────────────────────────
// اتجاهان، ومسارُ كتابةٍ مختلف لكلٍّ منهما — والفارق ليس تجميلاً:
//   • `mirror_to_user` (سجل الموظف يشير، والحساب فارغ): `linkUserToEmployee` تكفي وحدها.
//   • `mirror_to_employee` (الحساب يشير، وسجل الموظف فارغ): **لا تكفي**. الخدمة تفحص
//     `acc.employee_id === employeeId` فتردّ «مربوط بهذا الحساب مسبقاً — لا حاجة لإعادة الربط»
//     وتتوقف، بينما `employee.user_id` ما زال فارغاً. أي أن مسار الكتابة الوحيد للرابط لا يملك
//     إصلاح نصف ربطٍ من هذه الجهة إطلاقاً. فنفكّ ثم نربط: خطوتان، كلتاهما خدمةُ الهيكل نفسها
//     بتحققاتها وتدقيقها، ولا SQL خام — وأربعة سطور تدقيق تحكي القصة كاملة لمن يراجع لاحقاً.
// بلا معاملة جامعة حولهما عمداً: كل خدمة تفتح معاملتها، ومحرّك SQLite لا يقبل معاملة داخل
// معاملة (نفس القيد المذكور في scripts/seed-roles.js).
async function repairOne(item, ctx) {
  if (item.repair === 'mirror_to_employee') {
    await unlinkUserFromEmployee(ctx, { employeeId: item.employee_id, userId: item.user_id });
  }
  await linkUserToEmployee(ctx, { employeeId: item.employee_id, userId: item.user_id });
}

export async function applyFixes(opts = {}) {
  const plan = opts.plan || await planFixes(opts);
  const ctx = opts.ctx || fixerCtx(opts);
  const done = [], failed = [];
  for (const item of plan.certain) {
    try { await repairOne(item, ctx); done.push(item); }
    catch (e) { failed.push({ ...item, reason: e && e.message ? e.message : String(e) }); }
  }
  return { ...plan, applied: true, done, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// العرض
// ─────────────────────────────────────────────────────────────────────────────
export function renderPlan(res) {
  const L = [];
  const applied = !!res.applied;
  L.push(applied ? 'إصلاح ربط الحسابات — نُفِّذ' : 'إصلاح ربط الحسابات — معاينة فقط، لم يُكتب صفٌّ واحد');
  L.push(`بتاريخ ${res.today}`);

  L.push(`\n── قاطعٌ بلا شكّ (${res.certain.length}) ──`);
  if (!res.certain.length) L.push('  لا شيء — لا نصفَ ربطٍ في القاعدة.');
  for (const it of res.certain) L.push(`  • ${it.action}`);

  if (applied) {
    L.push(`\n  ✓ أُكمل ${res.done.length} ربطاً.`);
    if (res.failed.length) {
      L.push(`  ✗ تعذّر ${res.failed.length} — يبقى كما هو لإعادة المحاولة بعد معالجة السبب:`);
      for (const f of res.failed) L.push(`      · ${f.employee_name_ar || f.username}: ${f.reason}`);
    }
  }

  L.push(`\n── تحتاج قرار إنسان (${res.human.length}) ──`);
  if (!res.human.length) L.push('  لا شيء.');
  for (const it of res.human) L.push(`  • ${it.kind} — ${it.who}: ${it.reason}`);

  L.push('\nلم يُفعَّل حساب ولم يُرسَل بريد — التفعيل والدعوة قرارٌ منفصل بيدك.');
  if (!applied && res.certain.length) L.push('للتنفيذ: أضِف ‎--apply');
  return L.join('\n');
}

// ── التشغيل المباشر ─────────────────────────────────────────────────────────
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('fix-org-links.mjs');
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const opts = { sector: flag('--sector'), today: flag('--today'), year: flag('--year') };
  // خدمات الهيكل تسأل محرّك الصلاحيات في كل نداء، وهو يفشل **مغلقاً** ما لم تُحمَّل المنح —
  // فبلا هذا السطر يطبع السكربت خطة صحيحة ثم يتعذّر عليه كل صف. (الخادم يحمّلها عند إقلاعه؛
  // السكربت يقلع وحده.) الاختبارات تحمّلها في تهيئتها، فلا يُفرض هنا داخل الخدمة.
  const { initRbac } = await import('../src/core/rbac/index.js');
  await initRbac();
  const plan = await planFixes(opts);
  const res = argv.includes('--apply') ? await applyFixes({ ...opts, plan }) : plan;
  console.log(renderPlan(res));
  await close();
}
