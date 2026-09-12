#!/usr/bin/env node
// بذرة السيناريوهات — بيانات تملأ كل شاشة لكل فئة مستخدم، وكلُّ صفٍّ منها **مُسجَّل** فيُمحى
// بأمرٍ واحد يوم يُطلَب ذلك (scripts/purge-demo.mjs).
//
//   node --experimental-sqlite scripts/seed-scenarios.mjs                 # محلياً
//   SANAD_DB=/path/db.sqlite node --experimental-sqlite scripts/seed-scenarios.mjs
//
// لماذا سيناريوهات لا «بيانات كثيرة»: الغاية أن يفتح كلُّ دور شاشته فيجدها **محكيّة** — قصةً
// لها بداية ونهاية يتعرّف فيها على عمله: فرصةٌ تتقدّم بين المراحل، مشروعٌ له مخرجات ومتأخر
// أحدها، موظفٌ عليه مهام متأخرة ومعطَّلة، ومعتمِدٌ ينتظره طلب. لا صفوفٌ عشوائية تملأ فراغاً.
//
// **كل إدراج هنا يمرّ بـ`add`** — الذي يُدرج ويُسجّل في نفس النَفَس. ولا يوجد في هذا الملف
// استدعاء `insert` مباشر: لو وُجد لصار صفاً تجريبياً لا يعرفه المحو، ويبقى في القاعدة أبداً.
import { insert, get, all, close } from '../src/core/db/index.js';
import { id, nowIso, toHalalas } from '../src/core/util/ids.js';
import { recordDemo, assertSeedable } from '../src/core/demo/registry.js';

export const BATCH = 'سيناريوهات-الدليل';
const now = nowIso();
const today = now.slice(0, 10);
const YEAR = Number(today.slice(0, 4));
const day = (n) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// عدّاد البذرة **داخل** التشغيلة لا خارجها: كان متغيّراً على مستوى الوحدة، فتشغيلةٌ ثانية
// (بعد محو) تُعيد ١٠٢ وقد بذرت ٥١ — رقمٌ يُقرأ في السجل وفي رسالة النهاية ويُصدَّق. أمسكه فحص
// «إعادة البذر بعد المحو».
function makeAdder(counter) {
  // الإدراج والتسجيل في نَفَسٍ واحد — لا سبيل لإدراج صفٍّ تجريبي غير مسجَّل من هذا الملف.
  return async function add(table, row, label) {
    assertSeedable(table);
    await insert(table, row);
    await recordDemo(BATCH, table, row.id, label || row.name_ar || row.title_ar || row.title || null);
    counter.n++;
    return row;
  };
}

export async function seedScenarios({ quiet = false } = {}) {
  const say = (...a) => { if (!quiet) console.log(...a); };
  const counter = { n: 0 };
  const add = makeAdder(counter);
  if (await get('SELECT id FROM demo_record WHERE batch = ? AND purged_at IS NULL LIMIT 1', [BATCH])) {
    say('السيناريوهات مبذورة سلفاً — امسحها أولاً إن أردت إعادة البذر (scripts/purge-demo.mjs).');
    return { added: 0, skipped: true };
  }
  // القطاع والإدارة يُقرآن من القاعدة لا يُخترعان: السيناريوهات تسكن هيكل الشركة الحقيقي،
  // وإنشاء قطاعٍ تجريبي بجانبه يُنتج شجرةً فيها قطاعان اسمهما واحد ويُربك القارئ.
  const sector = (await get("SELECT id FROM sector WHERE id = 'SOLUTIONS' AND deleted_at IS NULL"))
    || (await get('SELECT id FROM sector WHERE deleted_at IS NULL ORDER BY sort_order LIMIT 1'));
  if (!sector) { say('لا قطاعات في القاعدة — تُبذر السيناريوهات فوق هيكلٍ قائم.'); return { added: 0 }; }
  const SEC = sector.id;
  const dep = await get('SELECT id FROM department WHERE sector_id = ? AND deleted_at IS NULL ORDER BY name_ar LIMIT 1', [SEC]);
  const DEP = dep ? dep.id : null;

  const stages = await all('SELECT id, name_ar, is_won, is_lost FROM stage ORDER BY sort_order');
  const stageBy = (pred) => (stages.find(pred) || {}).id || null;
  const openStages = stages.filter((s) => !s.is_won && !s.is_lost);

  // الحسابات التي تُسنَد إليها الأعمال: حسابات العرض القائمة — فيرى كلُّ دورٍ عملَه هو حين يدخل.
  const persona = async (u) => (await get('SELECT id, name_ar FROM app_user WHERE username = ? AND deleted_at IS NULL', [u])) || null;
  const P = {};
  for (const u of ['demo.consultant', 'demo.employee', 'demo.pm', 'demo.bd', 'demo.sectorlead', 'demo.deptmgr', 'demo.linemgr']) {
    P[u] = await persona(u);
  }
  const someone = P['demo.consultant'] || P['demo.employee'] || P['demo.sectorlead'];
  if (!someone) { say('لا حسابات عرض — شغّل scripts/seed.js أولاً.'); return { added: 0 }; }
  const empOf = async (userId) => (await get('SELECT id FROM employee WHERE user_id = ? OR id = (SELECT employee_id FROM app_user WHERE id = ?) LIMIT 1', [userId, userId]))?.id || null;

  // ── ١) جهات العمل ──
  const clients = [];
  for (const [nm, type] of [['أمانة العاصمة المقدسة', 'حكومي'], ['هيئة تطوير منطقة مكة', 'حكومي'], ['شركة نقل مسارات', 'خاص']]) {
    clients.push(await add('client', { id: id('cli'), name_ar: nm, type, active: 1, created_at: now }, nm));
  }

  // ── ٢) الفرص: مرحلةٌ لكل حالة، ومالكٌ لكل دور — فلا يفتح أحدٌ «فرصي» فيجدها فارغة ──
  // القصة: خطٌّ حيّ فيه ما يتقدّم وما توقّف وما رُبح وما خُسر. بلا مكسوبة ومفقودة لا يُقرأ
  // معدّل الفوز ولا تُملأ لوحة القيادة — وهي أول ما يفتحه المالك.
  const oppOwners = [P['demo.bd'], P['demo.sectorlead'], P['demo.consultant'], P['demo.pm']].filter(Boolean);
  const OPPS = [
    ['تطوير منصة تجربة الزائر', 2_400_000, 0, 'عرض العميل مراجعة داخلية قبل التقديم'],
    ['برنامج التحول الرقمي للخدمات', 1_800_000, 1, 'اجتماع تحديد النطاق الأسبوع القادم'],
    ['دراسة جدوى مركز البيانات', 950_000, 2, null],
    ['تشغيل غرفة العمليات الموسمية', 3_100_000, 0, 'بانتظار ردّ الجهة على العرض المالي'],
    ['منصة الخدمات المشتركة', 1_250_000, 1, 'إعداد العرض الفني'],
  ];
  const opps = [];
  for (const [i, [t, sar, st, next]] of OPPS.entries()) {
    const stage = openStages[st % Math.max(1, openStages.length)];
    opps.push(await add('opportunity', {
      id: id('opp'), title_ar: t, client_id: clients[i % clients.length].id, sector_id: SEC,
      owner_user_id: oppOwners[i % oppOwners.length].id, stage_id: stage ? stage.id : null,
      value_halalas: toHalalas(sar), win_pct: [25, 50, 40, 70, 35][i], year: YEAR,
      next_action: next, priority: i < 2 ? 'P1' : 'P2', created_at: now,
    }, t));
  }
  const wonId = stageBy((s) => s.is_won), lostId = stageBy((s) => s.is_lost);
  if (wonId) await add('opportunity', { id: id('opp'), title_ar: 'تأهيل الكوادر التشغيلية', client_id: clients[0].id,
    sector_id: SEC, owner_user_id: oppOwners[0].id, stage_id: wonId, value_halalas: toHalalas(1_600_000),
    win_pct: 100, year: YEAR, created_at: now }, 'تأهيل الكوادر التشغيلية (مكسوبة)');
  if (lostId) await add('opportunity', { id: id('opp'), title_ar: 'توريد أنظمة مراقبة', client_id: clients[2].id,
    sector_id: SEC, owner_user_id: oppOwners[0].id, stage_id: lostId, value_halalas: toHalalas(700_000),
    win_pct: 0, year: YEAR, created_at: now }, 'توريد أنظمة مراقبة (مفقودة)');

  // ── ٣) المشاريع: حالةٌ لكل لون، ومخرجاتٌ فيها المتأخر والمقبول ──
  const PRJ = [
    ['مشروع منصة تجربة الزائر', 'IN_PROGRESS', 'GREEN', 62, 2_400_000],
    ['برنامج تحديث الخدمات الرقمية', 'IN_PROGRESS', 'AMBER', 38, 1_900_000],
    ['مركز العمليات الموسمي', 'IN_PROGRESS', 'RED', 15, 3_100_000],
    ['دراسة الحوكمة المؤسسية', 'COMPLETED', 'GREEN', 100, 850_000],
  ];
  const projects = [];
  for (const [i, [nm, status, rag, pct, sar]] of PRJ.entries()) {
    projects.push(await add('project', {
      id: id('prj'), name_ar: nm, client_id: clients[i % clients.length].id, sector_id: SEC,
      owner_user_id: (P['demo.pm'] || someone).id, status, rag, progress_pct: pct,
      contract_value_halalas: toHalalas(sar), budget_halalas: toHalalas(sar * 0.72),
      revenue_halalas: toHalalas(sar * (pct / 100)), start_date: day(-120), end_date: day(i === 3 ? -10 : 150),
      kind: 'external', is_sector_project: 1, created_at: now,
    }, nm));
  }
  // مخرجات: مقبول · مُسلَّم بانتظار القبول · متأخر عن موعده — الحالات الثلاث التي تُقرأ منها الصحة
  const DLV = [
    [0, 'وثيقة المتطلبات التفصيلية', 'ACCEPTED', -60, 480_000],
    [0, 'النسخة التجريبية الأولى', 'DELIVERED', -12, 620_000],
    [1, 'خطة التحول ومؤشراتها', 'PENDING', -5, 380_000],
    [2, 'تصميم غرفة العمليات', 'PENDING', -20, 900_000],
    [3, 'التقرير الختامي للحوكمة', 'ACCEPTED', -15, 850_000],
  ];
  for (const [pi, nm, status, off, sar] of DLV) {
    await add('deliverable', {
      id: id('dlv'), project_id: projects[pi].id, name_ar: nm, sector_id: SEC,
      amount_halalas: toHalalas(sar), status, year: YEAR, month: Number(today.slice(5, 7)),
      delivered_at: status === 'PENDING' ? null : day(off),
      accepted_at: status === 'ACCEPTED' ? day(off + 3) : null,
      notes: status === 'PENDING' && off < -10 ? 'تأخّر عن موعده — بانتظار مراجعة الجهة' : null,
      created_at: now,
    }, nm);
  }

  // ── ٤) التسكين: من يعمل على ماذا — بدونه تبدو صفحة التسكين وبطاقات الأشخاص خاوية ──
  const staff = await all(`SELECT e.id, e.name_ar FROM employee e
     WHERE e.deleted_at IS NULL AND e.active = 1 AND e.sector_id = ? ORDER BY e.name_ar LIMIT 8`, [SEC]);
  for (const [i, e] of staff.entries()) {
    await add('allocation', {
      id: id('alc'), employee_id: e.id, person_name_ar: e.name_ar, project_id: projects[i % projects.length].id,
      project_name: projects[i % projects.length].name_ar, sector_id: SEC,
      type: i === 0 ? 'lead' : i === 1 ? 'advisor' : 'member', year: YEAR,
      month_start: 1, month_end: 12, source: 'scenario', created_at: now,
    }, `${e.name_ar} على ${projects[i % projects.length].name_ar}`);
  }

  // ── ٥) المهام: كل نطاقٍ زمني وكل حالة، ولكل شخصٍ نصيب ──
  // القصة التي يجب أن تُرى: متأخرة تحتاج بدءاً · مستحقة اليوم · خلال الأسبوع · بلا موعد ·
  // مُعطَّلة بسببٍ مكتوب · بلا خطوة تالية · ومُنجَزة حديثاً كي لا يبدو أن لا أحد ينجز شيئاً.
  const taskOwners = [P['demo.consultant'], P['demo.employee'], P['demo.pm'], P['demo.linemgr'], P['demo.deptmgr'], P['demo.bd']].filter(Boolean);
  const TASKS = [
    ['مراجعة وثيقة المتطلبات مع الجهة', -6, 'IN_PROGRESS', 'P0', 'إرسال النسخة المحدَّثة للمراجعة', null, 0],
    ['إغلاق ملاحظات النسخة التجريبية', -2, 'IN_PROGRESS', 'P1', null, null, 0],
    ['تجهيز عرض اللجنة التوجيهية', 0, 'IN_PROGRESS', 'P0', 'اعتماد الشرائح من قائد القطاع', null, 1],
    ['تحديث خطة التحول الربعية', 0, 'TODO', 'P1', 'جمع أرقام الربع من المالية', null, 1],
    ['تنسيق زيارة الموقع', 3, 'TODO', 'P2', 'تأكيد الموعد مع الجهة', null, 2],
    ['إعداد مصفوفة المخاطر', 5, 'TODO', 'P1', 'مراجعة سجل المخاطر السابق', null, 2],
    ['متابعة اعتماد العرض المالي', 2, 'BLOCKED', 'P0', 'رفع العائق مع الإدارة المالية', 'بانتظار ردّ الجهة على البند المالي', 3],
    ['تحديث دليل التشغيل', null, 'TODO', 'P3', null, null, 0],
    ['أرشفة مخرجات المرحلة الأولى', null, 'TODO', 'P3', 'تحديد مسؤول الأرشفة', null, 1],
    ['اعتماد التقرير الختامي', -20, 'DONE', 'P1', null, null, 3],
    ['تسليم النسخة التجريبية', -14, 'DONE', 'P1', null, null, 0],
  ];
  for (const [i, [t, due, status, prio, next, blocked, pi]] of TASKS.entries()) {
    const owner = taskOwners[i % taskOwners.length];
    await add('task', {
      id: id('tsk'), title: t, assignee_user_id: owner.id, sector_id: SEC, department_id: DEP,
      project_id: projects[pi] ? projects[pi].id : null,
      status, priority: prio, due_date: due === null ? null : day(due),
      next_step: next, blocked_reason: blocked,
      progress_pct: status === 'DONE' ? 100 : status === 'IN_PROGRESS' ? 45 : 0,
      completed_at: status === 'DONE' ? day(due || -10) + 'T10:00:00.000Z' : null,
      created_at: now,
    }, t);
  }
  // مهامٌ مربوطة بفرص — فتُقرأ عدسة «على فرصة» ولا تعود شريحةً بلا نتائج
  for (const [i, o] of opps.slice(0, 2).entries()) {
    await add('task', {
      id: id('tsk'), title: `إعداد العرض الفني — ${o.title_ar}`, assignee_user_id: oppOwners[i % oppOwners.length].id,
      sector_id: SEC, department_id: DEP, opportunity_id: o.id, status: 'IN_PROGRESS', priority: 'P1',
      due_date: day(4), next_step: 'مراجعة النطاق مع الفريق الفني', progress_pct: 30, created_at: now,
    }, `إعداد العرض الفني — ${o.title_ar}`);
  }

  // ── ٦) الأنشطة: سجلّ تواصلٍ يجعل صفحة الجهة تُقرأ كعلاقة لا كبطاقة بيانات ──
  const ACT = [
    ['meeting', 'اجتماع تحديد النطاق', 'حضره فريق الجهة وفريق المشروع، واتُّفق على تسليم الوثيقة خلال أسبوعين'],
    ['call', 'مكالمة متابعة العرض', 'الجهة طلبت تفصيل البند المالي الثالث'],
    ['email', 'إرسال العرض الفني', 'أُرسل العرض بنسخته النهائية بانتظار الردّ'],
    ['note', 'ملاحظة على أولوية الجهة', 'الأولوية عندهم للتشغيل الموسمي قبل التوسّع'],
  ];
  for (const [i, [kind, title, detail]] of ACT.entries()) {
    await add('crm_activity', {
      id: id('act'), kind, at: day(-(i * 3 + 1)) + 'T09:30:00.000Z',
      actor_user_id: oppOwners[i % oppOwners.length].id, actor_name: oppOwners[i % oppOwners.length].name_ar,
      client_id: clients[i % clients.length].id, opportunity_id: opps[i % opps.length].id, sector_id: SEC,
      title, detail, source: 'scenario', created_at: now,
    }, title);
  }

  // ── ٧) المال: عقدٌ وفواتير بحالاتها ومصروفات — فلا تُفتح شاشة المالية على أصفار ──
  const contract = await add('contract', {
    id: id('ctr'), code: 'C-' + YEAR + '-001', client_id: clients[0].id, project_id: projects[0].id,
    sector_id: SEC, value_halalas: toHalalas(2_400_000), start_date: day(-120), end_date: day(150),
    status: 'ACTIVE', signed_at: day(-125), created_at: now,
  }, 'عقد منصة تجربة الزائر');
  const INV = [['PAID', -75, 480_000], ['ISSUED', -20, 620_000], ['OVERDUE', -55, 380_000]];
  for (const [i, [status, off, sar]] of INV.entries()) {
    await add('invoice', {
      id: id('inv'), code: `INV-${YEAR}-00${i + 1}`, contract_id: contract.id, project_id: projects[0].id,
      client_id: clients[0].id, sector_id: SEC, amount_halalas: toHalalas(sar),
      issue_date: day(off), due_date: day(off + 30), status, created_at: now,
    }, `فاتورة ${i + 1}`);
  }
  for (const [i, [type, sar]] of [['أتعاب استشارية', 220_000], ['سفر وإقامة', 45_000], ['اشتراكات وأدوات', 30_000]].entries()) {
    await add('expense', {
      id: id('exp'), project_id: projects[i % projects.length].id, sector_id: SEC, type,
      amount_halalas: toHalalas(sar), incurred_year: YEAR, incurred_month: Number(today.slice(5, 7)),
      requested_by: (P['demo.pm'] || someone).id, status: i === 0 ? 'APPROVED' : 'PENDING', created_at: now,
    }, `مصروف: ${type}`);
  }

  say(`✓ السيناريوهات: ${counter.n} صفاً مسجَّلاً في دفعة «${BATCH}»`);
  say('  المحو: node --experimental-sqlite scripts/purge-demo.mjs "' + BATCH + '"');
  return { added: counter.n, batch: BATCH };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  await seedScenarios();
  await close();
}
