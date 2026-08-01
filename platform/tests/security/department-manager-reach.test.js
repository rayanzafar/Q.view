// مدير الإدارة: يقرأ قطاعه، ويتصرّف في إدارته — ولا شيء غير ذلك.
//
// العيب الذي أغلقه هذا الحارس رآه المالك بعينه: «حساب ريان مو شايف ولا فرصة، الخانة كلها مو
// موجودة». والسبب أن منح الدور **لم يكن فيه «فرصة» إطلاقاً** — لا بنطاق ضيّق ولا واسع. وأثر
// الغياب ليس قائمةً فارغة بل **اختفاء الشاشة**: بوابة الصفحة تمرّ بوجود منحٍ على الموردـ فبلا
// منحٍ لا مدخل ولا خانة. ومدير إدارةٍ في قطاع الحلول لا يرى فرصةً واحدة ولا يفهم لماذا.
//
// والفحص يثبّت الحدّين معاً: القراءة تبلغ القطاع، والكتابة لا تتجاوز الإدارة. حارسٌ يثبّت
// الفتح وحده يفتح الباب على مصراعيه في أول تعديل.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// المنح تُقرأ من القاعدة (يبذرها seed-rbac من المصفوفة) — فيُبنى مخزنٌ حقيقي لا مصفوفةٌ مقروءة
// مباشرةً: الفحص يجب أن يمرّ بنفس الطريق الذي يمرّ به الطلب الحقيقي.
const dir = mkdtempSync(join(tmpdir(), 'sanad-dmreach-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let can;
before(async () => {
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  can = rbac.can;
});
after(() => rmSync(dir, { recursive: true, force: true }));

const DM = { id: 'u_dm', role_id: 'department_manager', scope: 'sector', sector_id: 'SOLUTIONS', department_id: 'dep_ai' };
const inSector = { sector_id: 'SOLUTIONS', department_id: 'dep_city' };   // إدارة أخرى داخل قطاعه
const myDept = { sector_id: 'SOLUTIONS', department_id: 'dep_ai' };
const otherSector = { sector_id: 'CONSULTING', department_id: 'dep_pmo' };

test('يرى الفرص — وهو ما كان غائباً كلياً فاختفت الخانة', () => {
  assert.equal(can(DM, 'read', 'opportunity', myDept), true,
    'لا يرى فرصةً واحدة — والمنح الغائب يُخفي الخانة كلها لا يُفرغها');
});

test('ومسار البيع كله معه: العميل وجهة الاتصال والعرض والخدمة', () => {
  for (const res of ['client', 'contact', 'proposal', 'service']) {
    assert.equal(can(DM, 'read', res, myDept), true, `لا يقرأ «${res}» — فتُعرض الفرصة بلا سياقها`);
  }
});

// حدٌّ مقصود لا نقص: أسماء أهل الإدارات الأخرى وكشوفهم ومهامّهم محجوبة عنه. حاولتُ توسيعه
// فأسقط اثني عشر حارساً كُتبت لتثبيته — والتوسيع المطلوب كان على الفرص لا على الناس.
// حدٌّ مقصود محروس: أسماء أهل الإدارات الأخرى وكشوفهم ومهامّهم محجوبة عنه. حاولتُ توسيعه
// فأسقط اثني عشر حارساً كُتبت لتثبيته بعينه — والمطلوب كان توسيعاً على الفرص لا على الناس.
test('ولا يتجاوز إدارته في الناس والعمل — الحدّ المحروس باقٍ', () => {
  for (const res of ['employee', 'project', 'task', 'timesheet', 'deliverable']) {
    assert.equal(can(DM, 'read', res, myDept), true, `لا يقرأ «${res}» في إدارته`);
    assert.equal(can(DM, 'read', res, inSector), false, `قرأ «${res}» لإدارةٍ أخرى — حدٌّ محروس انفتح`);
  }
});

test('ولا يتجاوز قطاعه إطلاقاً', () => {
  for (const res of ['opportunity', 'project', 'client', 'employee']) {
    assert.equal(can(DM, 'read', res, otherSector), false, `قرأ «${res}» في قطاع آخر`);
  }
});

test('والتصرّف يبقى في إدارته وحدها — يرى القطاع ولا يكتب فيه', () => {
  assert.equal(can(DM, 'update', 'task', myDept), true, 'لا يعدّل مهام إدارته');
  assert.equal(can(DM, 'update', 'task', inSector), false, 'عدّل مهمة إدارةٍ أخرى في قطاعه');
  assert.equal(can(DM, 'approve', 'timesheet', myDept), true, 'لا يعتمد كشوف إدارته');
  assert.equal(can(DM, 'approve', 'timesheet', inSector), false, 'اعتمد كشف إدارةٍ أخرى');
  for (const a of ['create', 'update', 'delete']) {
    assert.equal(can(DM, a, 'opportunity', myDept), false, `يملك «${a}» على الفرص — القراءة وحدها منحه`);
  }
});

// ── الهامش والكلفة صارا له بقرار مالك لاحق — والراتب وحده بقي مختوماً ──────────
// كان هذا الفحص يثبّت الثلاثة محجوبةً معاً، وهي القاعدة التي كانت سارية يوم كُتب. ثم قال
// المالك حرفاً: «لازم مدير الإدارة يشوف مركز القطاع من ناحية ربح وكم الإيراد وكم من التارقيت
// وكل الأمور هذه» — فصار الهامش والكلفة بنطاق **قطاعه** (انظر matrix.js). فالفحص لم يُضعَّف
// بل تبدّل معه الحدُّ الذي يحرسه، ويبقى يحرس ثلاثة أشياء لا يمسّها القرار الجديد:
//   ① **الراتب مختوم** — لمدير النظام وحده حتى تكامل Odoo، وهو أحسّ ما في المنصة.
//   ② **الاتساع محدود بقطاعه**: قطاعٌ آخر يُردّ، فالمنح قطاعيٌّ لا شركي.
//   ③ **الأرقام لا الأشخاص**: قراءتُه رقمَ القطاع لا تفتح له ملفات أهل الإدارات الأخرى —
//      وهو الحدّ الذي يسهل أن ينزلق مع أول توسيع، فيُثبَّت هنا صراحةً.
test('الراتب يبقى مختوماً — والهامش والكلفة بنطاق قطاعه وحده', () => {
  assert.equal(can(DM, 'read', 'salary', myDept), false, 'كُشف له الراتب — وهو مختوم لمدير النظام وحده');

  for (const res of ['margin', 'cost']) {
    assert.equal(can(DM, 'read', res, myDept), true,
      `حُجب عنه «${res}» — وقرار المالك أن يرى ربح قطاعه وكلفته`);
    assert.equal(can(DM, 'read', res, inSector), true,
      `«${res}» لإدارةٍ أخرى داخل قطاعه محجوب — والمنح قطاعيّ لا إداريّ`);
    assert.equal(can(DM, 'read', res, otherSector), false,
      `كُشف له «${res}» في قطاعٍ ليس قطاعه — المنح قطاعيّ لا شركيّ`);
  }
});

// الاستشاري لم يُمَسّ: منحه «فرصةٌ يملكها» وحدها، وهو المقصود — لا يرى مسار القطاع.
test('والاستشاري بقي على منحه: فرصه هو لا فرص القطاع', () => {
  const C = { id: 'u_c', role_id: 'consultant', scope: 'own', sector_id: 'SOLUTIONS', department_id: 'dep_ai' };
  assert.equal(can(C, 'read', 'opportunity', { owner_user_id: 'u_c', sector_id: 'SOLUTIONS' }), true, 'لا يرى فرصته');
  assert.equal(can(C, 'read', 'opportunity', { owner_user_id: 'u_other', sector_id: 'SOLUTIONS' }), false,
    'اتّسع منح الاستشاري إلى فرص غيره');
});
