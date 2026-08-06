// ── مركز القيادة لا يسرّب تفاصيل الصفقات لمن نطاقه أضيق من القطاع ─────────────
//
// الانحدار المسدود هنا: «ما تغيّر منذ…» كان يعرض حركات مراحل **كل** فرص القطاع (عنوان الفرصة
// وقيمتها وعميلها) وراء بوابة can(user,'read','opportunity') العارية — وهي تمرّ لمجرد وجود
// المنح مهما ضاق نطاقه. و«يحتاج انتباهك الآن» كان يسمّي الفرص المتوقفة بعناوينها وقيمها
// قطاعياً كذلك. فمدير تطوير الأعمال — الذي ضُيّقت قائمته إلى فرصه هو (قرار المالك ٢٠٢٦-٠٨) —
// كان يقرأ من مركز القيادة ما تحجبه عنه قائمة الفرص نفسها.
//
// القاعدة بعد السدّ: البنود المسمّاة تتبع نطاق قائمة الفرص نفسه (scopeFilter بنفس خيارات
// listOpportunities): BD فرصه، ومدير الإدارة إداراته، وقائد القطاع قطاعه كما كان. أما القمع
// المجمَّع وصفقات السنة المكسوبة فقطاعية عمداً بقرار «الأرقام لا الأشخاص» — خارج هذا الملف.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-feedscope-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { changesSince } = await import('../../src/core/reports/changes.js');
const { attentionFeed } = await import('../../src/core/reports/attention.js');

const T = '2026-01-05T08:00:00Z';
const TODAY = '2026-08-05';
const SINCE = '2026-07-01';
const IN = '2026-07-10T10:00:00.000Z';   // داخل النافذة
const TITLE_A = 'فرصة إدارة الابتكار المتوقفة';
const TITLE_B = 'فرصة الإدارة الأخرى المتوقفة';
const TITLE_MINE = 'فرصة يملكها مدير التطوير نفسه';

// نفس أشكال بقية فحوص التقارير: مستخدمون بحدّهم الأدنى، والقرار كله عند scopeFilter/can.
const bd = { id: 'u_bd', role_id: 'bd_manager', sector_id: 'S1', scope: 'own' };       // لا يملك من فرص الحركات شيئاً
const lead = { id: 'u_lead', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector' };
const dm = { id: 'u_dm', role_id: 'department_manager', sector_id: 'S1', scope: 'department', department_id: 'D_A' };

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T });
  await insert('department', { id: 'D_A', sector_id: 'S1', name_ar: 'إدارة الابتكار', active: 1, created_at: T });
  await insert('department', { id: 'D_B', sector_id: 'S1', name_ar: 'إدارة أخرى', active: 1, created_at: T });
  // LEAD له عتبة ركود (١٤ يوماً) — فالفرصتان أدناه «متوقفتان» قطعاً بعمرٍ من يناير.
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('stage', { id: 'QUALIFIED', name_ar: 'مؤهلة', default_win_pct: 40, sort_order: 2, is_won: 0, is_lost: 0 });
  await insert('client', { id: 'C1', name_ar: 'وزارة التخطيط', created_at: T });
  // مالكا الفرصتين — حسابان حقيقيان يرضيان قيد المفتاح الأجنبي على `owner_user_id`.
  for (const uid of ['u_colleague', 'u_colleague2']) {
    await insert('app_user', { id: uid, username: uid, name_ar: 'حساب ' + uid, role_id: 'bd_manager',
      sector_id: 'S1', scope: 'own', active: 1, created_at: T });
  }
  // فرصتا **زملاء** — لا يملك u_bd منهما شيئاً، ولكلٍّ إدارتها، وكلتاهما راكدة منذ يناير.
  await insert('opportunity', { id: 'O_A', title_ar: TITLE_A, sector_id: 'S1', department_id: 'D_A',
    owner_user_id: 'u_colleague', client_id: 'C1', stage_id: 'LEAD', value_halalas: 7_000_000,
    year: 2026, stage_changed_at: T, created_at: T });
  await insert('opportunity', { id: 'O_B', title_ar: TITLE_B, sector_id: 'S1', department_id: 'D_B',
    owner_user_id: 'u_colleague2', client_id: 'C1', stage_id: 'LEAD', value_halalas: 9_000_000,
    year: 2026, stage_changed_at: T, created_at: T });
  // حركتا مرحلة داخل النافذة — واحدة لكل فرصة.
  await insert('opportunity_stage_history', { id: 'H_A', opportunity_id: 'O_A', from_stage_id: null, to_stage_id: 'LEAD', changed_at: IN });
  await insert('opportunity_stage_history', { id: 'H_B', opportunity_id: 'O_B', from_stage_id: null, to_stage_id: 'LEAD', changed_at: IN });

  // فرصة يملكها u_bd نفسه (بلا حركات مراحل — لا تمسّ فحوص «الحركات» أعلاه) + سجلا إنشاء في
  // سجل النظام داخل النافذة: واحد لفرصته وواحد لفرصة زميله — بند «فرصة جديدة» يحمل العنوان.
  await insert('app_user', { id: 'u_bd', username: 'u_bd', name_ar: 'مدير التطوير', role_id: 'bd_manager',
    sector_id: 'S1', scope: 'own', active: 1, created_at: T });
  // حديثة العهد بمرحلتها وبخطوةٍ تالية — كي لا تدخل فحوص «المتوقفة/بلا خطوة» أعلاه وأدناه.
  await insert('opportunity', { id: 'O_MINE', title_ar: TITLE_MINE, sector_id: 'S1', department_id: 'D_A',
    owner_user_id: 'u_bd', client_id: 'C1', stage_id: 'QUALIFIED', value_halalas: 1_000_000,
    year: 2026, next_action: 'اجتماع تأهيل', stage_changed_at: '2026-08-01T08:00:00Z', created_at: IN });
  await insert('audit_log', { id: 'AUD_A', at: IN, username: 'u_colleague', action: 'create',
    resource: 'opportunity', resource_id: 'O_A', sector_id: 'S1' });
  await insert('audit_log', { id: 'AUD_MINE', at: IN, username: 'u_bd', action: 'create',
    resource: 'opportunity', resource_id: 'O_MINE', sector_id: 'S1' });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const stageItems = (r) => r.items.filter((i) => i.kind === 'stage');
// الجذع «متوقف» يلتقط كل صيغ العدد العربية: «فرصة واحدة متوقفة»، «فرصتان متوقفتان»…
const stalledOf = (items) => items.find((i) => String(i.title).includes('متوقف'));

test('«ما تغيّر»: BD بلا فرص يملكها لا يقرأ حركة مرحلةٍ واحدة لزميله — عداً وعناوين', async () => {
  const r = await changesSince(bd, 'S1', SINCE);
  assert.equal(r.counts.stage, 0, 'شارة الحركات ليست صفراً لمن قائمته فارغة');
  assert.equal(stageItems(r).length, 0, 'حركة مرحلة زميلٍ تسرّبت إلى بنوده');
  for (const it of r.items) {
    assert.ok(!String(it.title).includes(TITLE_A) && !String(it.title).includes(TITLE_B),
      `عنوان فرصة زميل في بند «${it.kind}»`);
  }
});

test('«ما تغيّر»: قائد القطاع كما كان — الحركتان كلتاهما تصلانه', async () => {
  const r = await changesSince(lead, 'S1', SINCE);
  assert.equal(r.counts.stage, 2, 'قطاعه نقص عليه');
  const titles = stageItems(r).map((i) => i.title).join(' ');
  assert.ok(titles.includes(TITLE_A) && titles.includes(TITLE_B));
});

test('«ما تغيّر»: مدير الإدارة يرى حركة إدارته وحدها — لا حركة الإدارة الأخرى', async () => {
  const r = await changesSince(dm, 'S1', SINCE);
  assert.equal(r.counts.stage, 1);
  const titles = stageItems(r).map((i) => i.title).join(' ');
  assert.ok(titles.includes(TITLE_A), 'حركة فرصة إدارته غائبة');
  assert.ok(!titles.includes(TITLE_B), 'حركة إدارةٍ أخرى تسرّبت إليه');
});

// بند «فرصة جديدة» من سجل النظام يحمل عنوان الفرصة ورابطها — نفس حقيقة حركات المراحل:
// البند الذي لا يفتحه القارئ يسقط (لا يُعاد تسميته)، وبنده هو يبقى.
const createdItems = (r) => r.items.filter((i) => i.kind === 'created' && String(i.title).includes('فرصة جديدة'));

test('«ما تغيّر»: بند «فرصة جديدة» لزميلٍ يسقط عمّن نطاقه فرصه هو — وبنده هو يصله', async () => {
  const r = await changesSince(bd, 'S1', SINCE);
  const titles = createdItems(r).map((i) => i.title).join(' ');
  assert.ok(!titles.includes(TITLE_A), 'عنوان فرصة زميلٍ ظهر في بند «فرصة جديدة» لمن لا يفتحها');
  assert.ok(titles.includes(TITLE_MINE), 'بند إنشاء فرصته هو غاب عنه');
  assert.equal(r.counts.created, 1, 'شارة «سجلات الإنشاء» تعدّ ما يُعرض له لا القطاع كله');
});

test('«ما تغيّر»: قائد القطاع كما كان — بندا الإنشاء كلاهما يصلانه', async () => {
  const r = await changesSince(lead, 'S1', SINCE);
  const titles = createdItems(r).map((i) => i.title).join(' ');
  assert.ok(titles.includes(TITLE_A) && titles.includes(TITLE_MINE), 'قطاعه نقص عليه');
  assert.equal(r.counts.created, 2);
});

test('«يحتاج انتباهك»: لا بند فرصٍ متوقفة لمن لا يقرأ فرصةً واحدة منها', async () => {
  const items = await attentionFeed(bd, 'S1', { year: 2026, today: TODAY });
  assert.equal(stalledOf(items), undefined, 'نُبِّه على فرص زملائه وهي محجوبة عن قائمته');
  const all_ = JSON.stringify(items);
  assert.ok(!all_.includes(TITLE_A) && !all_.includes(TITLE_B), 'عنوان فرصة زميل في بنوده');
});

test('«يحتاج انتباهك»: قائد القطاع يُنبَّه على الفرصتين، ومدير الإدارة على فرصة إدارته وحدها', async () => {
  const leadItems = await attentionFeed(lead, 'S1', { year: 2026, today: TODAY });
  const ls = stalledOf(leadItems);
  assert.ok(ls, 'بند الفرص المتوقفة غاب عن قائد القطاع');
  assert.ok(ls.sub.includes(TITLE_A) && ls.sub.includes(TITLE_B), 'فرص قطاعه ناقصة في التنبيه');

  const dmItems = await attentionFeed(dm, 'S1', { year: 2026, today: TODAY });
  const ds = stalledOf(dmItems);
  assert.ok(ds, 'بند الفرص المتوقفة غاب عن مدير الإدارة');
  assert.ok(ds.sub.includes(TITLE_A), 'فرصة إدارته غائبة عن تنبيهه');
  assert.ok(!JSON.stringify(dmItems).includes(TITLE_B), 'فرصة إدارةٍ أخرى في تنبيهه');
});
