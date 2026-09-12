// ── المرآة بين المشاريع والفرص ───────────────────────────────────────────────
// «المفروض أي شيء في المشاريع موجود في الفرص — مثلاً «خدمات مدارة» مكسوبة لقطاع الابتكار وهكذا
//  أي شيء. ولازم في طريقة لتعديل المشروع: قيمته أو مدّته أو أو أو. ولازم تتأكد أي مشروع مضاف في
//  المشاريع ينضاف مكسوباً، وأي فرصة توصل مكسوبة في الفرص على طول تنعكس بقيمتها وكل شيء مشروعاً —
//  بس أدخل عليه أحطّ بقية المعلومات كأنه مشروع جديد. وأرفق مثلاً المخرجات وخلّي الذكاء يسوّيها
//  ويستخرج المعلومات زي ما هو مكتوب» — بلسان المالك.
//
// وأثقل ما يُحرَس هنا **ألّا تنقلب المرآة على مصدرها**: الفرصة التي وُلد منها المشروع سجلٌّ لما
// عُرِض على الجهة، ومرآةُ المشروع سجلٌّ للفوز يتبع مشروعه. الخلطُ بينهما يكتب فوق تاريخٍ كتبه
// إنسان — ولذلك تُعلَّم كل مرآة بمصدرها ولا يُقاس اتجاه الحقيقة بالتخمين.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mirror-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps, projects, intake, sync, backfill;
const T = '2026-03-01T00:00:00Z';
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL' };
const CTX = { user: ADMIN, ip: '1' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  opps = await import('../../src/modules/crm/opportunities.js');
  projects = await import('../../src/modules/pmo/projects.js');
  intake = await import('../../src/modules/intake/intake.js');
  sync = await import('../../src/modules/crm/opp-project-sync.js');
  backfill = await import('../../scripts/backfill-project-opportunities.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('sector', { id: 'INN', name_ar: 'قطاع الابتكار', kind: 'delivery', active: 1, created_at: T });
  await db.insert('department', { id: 'D_INN', sector_id: 'INN', name_ar: 'إدارة الابتكار', active: 1, created_at: T });
  await db.insert('client', { id: 'CL', name_ar: 'جهة حكومية', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL', active: 1, created_at: T });
  for (const [id, ar, won, lost, ord] of [['LEAD', 'ترشيح', 0, 0, 1], ['WON', 'مكسوبة', 1, 0, 9], ['LOST', 'مفقودة', 0, 1, 10]]) {
    await db.insert('stage', { id, name_ar: ar, default_win_pct: won ? 100 : 10, sort_order: ord, is_won: won, is_lost: lost });
  }
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── ① الفرصة تبلغ الفوز ⟵ مشروعٌ بقيمتها ────────────────────────────────────
test('الفوز يربط مشروعاً بجهته وإدارته دون اعتماد قيمة العقد أو الصحة تلقائياً', async () => {
  const o = await opps.createOpportunity(CTX, { title_ar: 'خدمات مدارة', sector_id: 'INN', department_id: 'D_INN',
    client_id: 'CL', value_sar: 3_000_000, stage_id: 'LEAD' });
  const moved = await opps.moveStage(CTX, o.id, 'WON');
  const p = await db.get('SELECT * FROM project WHERE source_opp_id = ? AND deleted_at IS NULL', [o.id]);
  assert.ok(p, 'المشروع وُلد مع الفوز — لا بزرٍّ يُتذكَّر');
  assert.equal(moved.project_id, p.id, 'ويعود معرّفه في نتيجة النقل فتفتحه الشاشة مباشرة');
  assert.equal(p.name_ar, 'خدمات مدارة');
  assert.equal(p.sector_id, 'INN');
  assert.equal(p.department_id, 'D_INN', 'الإدارة تُورَث — بها تُحسب إيرادات آخر السنة');
  assert.equal(p.client_id, 'CL');
  assert.equal(p.contract_value_halalas, null, 'قيمة البيع لا تتحول إلى عقد بلا تأكيد');
  assert.equal(p.rag, null);
  assert.equal((await db.get('SELECT value_halalas FROM opportunity WHERE id = ?', [o.id])).value_halalas, 3_000_000 * 100);
  assert.equal(p.status, 'NOT_STARTED', 'ويبدأ «لم يبدأ» — بقية معلوماته تُكتب من صفحته');
});

test('والفوز مرتين لا يُولّد مشروعين — ازدواج المشروع ازدواجٌ للقيمة في المحفظة', async () => {
  const o = await opps.createOpportunity(CTX, { title_ar: 'فرصة تتكرّر', sector_id: 'SOL', value_sar: 1000, stage_id: 'LEAD' });
  await opps.moveStage(CTX, o.id, 'WON');
  await assert.rejects(() => opps.moveStage(CTX, o.id, 'LEAD', 'أُغلقت بالخطأ'), /لم يُحذف أي سجل/);
  await opps.moveStage(CTX, o.id, 'WON');
  const n = await db.all('SELECT id FROM project WHERE source_opp_id = ? AND deleted_at IS NULL', [o.id]);
  assert.equal(n.length, 1, 'مشروعٌ واحد مهما تكرّر النقل');
});

// ── ② المشروع يُنشأ ⟵ فرصةٌ مكسوبة ──────────────────────────────────────────
test('كل مشروع يُنشأ تُولَد له فرصة مكسوبة — «أي مشروع مضاف في المشاريع ينضاف مكسوباً»', async () => {
  const p = await projects.createProject(CTX, { name_ar: 'مشروع مباشر', sector_id: 'SOL',
    client_id: 'CL', contract_value_sar: 750_000, start_date: '2026-04-01' });
  const row = await db.get('SELECT source_opp_id FROM project WHERE id = ?', [p.id]);
  assert.ok(row.source_opp_id, 'الرابط يُكتب فوراً');
  const o = await db.get('SELECT * FROM opportunity WHERE id = ?', [row.source_opp_id]);
  assert.equal(o.stage_id, 'WON');
  assert.equal(o.value_halalas, 750_000 * 100);
  assert.equal(o.client_id, 'CL');
  assert.equal(o.source, 'project', 'معلَّمة بمصدرها — بها يُعرف اتجاه الحقيقة');
  assert.equal(o.year, null, 'لا تُستنتج سنة البيع من التنفيذ');
  assert.equal(o.exclude_from_sales, 1);
  const hist = await db.get('SELECT to_stage_id FROM opportunity_stage_history WHERE opportunity_id = ?', [o.id]);
  assert.equal(hist.to_stage_id, 'WON', 'وسجلّ المراحل يقول متى سُجِّل الفوز');
});

// ── ③ تعديل المشروع: قيمته ومدّته ورمزه ─────────────────────────────────────
test('قيمة المشروع ومدّته ورمزه تُعدَّل — ولم يكن في المنتج موضعٌ واحد يكتبها', async () => {
  const p = await projects.createProject(CTX, { name_ar: 'مشروع يُعدَّل', sector_id: 'SOL', contract_value_sar: 100 });
  const after1 = await projects.updateProject(CTX, p.id, { contract_value_sar: 250_000, code: 'PRJ-9',
    start_date: '2026-05-01', end_date: '2026-11-30' });
  assert.equal(after1.contract_value_halalas, 250_000 * 100);
  assert.equal(after1.code, 'PRJ-9');
  assert.equal(after1.start_date, '2026-05-01');
  assert.equal(after1.end_date, '2026-11-30');
});

test('ومدّةٌ تنتهي قبل أن تبدأ تُرَدّ — لا رقمَ جدولٍ سالباً يُقرأ «متأخر» بلا سبب', async () => {
  const p = await projects.createProject(CTX, { name_ar: 'مشروع بمدة مقلوبة', sector_id: 'SOL' });
  await assert.rejects(() => projects.updateProject(CTX, p.id, { start_date: '2026-09-01', end_date: '2026-08-01' }),
    /تاريخ الانتهاء قبل تاريخ البدء/);
  // والحدّ يسري ولو أُرسل طرفٌ واحد فقط — التاريخ الآخر يُقرأ من الصفّ لا يُفترَض غائباً
  await projects.updateProject(CTX, p.id, { start_date: '2026-09-01' });
  await assert.rejects(() => projects.updateProject(CTX, p.id, { end_date: '2026-08-15' }),
    /تاريخ الانتهاء قبل تاريخ البدء/);
});

test('وقيمةٌ سالبة أو خارج المعقول تُرَدّ برسالة تقول ماذا يُكتب', async () => {
  const p = await projects.createProject(CTX, { name_ar: 'مشروع بقيمة خاطئة', sector_id: 'SOL' });
  await assert.rejects(() => projects.updateProject(CTX, p.id, { contract_value_sar: -5 }), /رقماً بالريال/);
  await assert.rejects(() => projects.updateProject(CTX, p.id, { contract_value_sar: 1e12 }), /أكبر من المعقول/);
  await assert.rejects(() => projects.updateProject(CTX, p.id, { name_ar: '   ' }), /اسم المشروع مطلوب/);
});

// ── ④ المخرجات تُلصَق ويقرؤها المساعد ───────────────────────────────────────
test('نصّ المخرجات يُقرأ سطراً سطراً بأسمائه ومبالغه وأشهره — بلا نموذج ذكي أيضاً', async () => {
  const p = await projects.createProject(CTX, { name_ar: 'مشروع بمخرجات', sector_id: 'SOL' });
  const parsed = await intake.parseDeliverables(ADMIN, p.id, { text:
    '1. تقرير الوضع الراهن — 120000 — 2026-03\n'
    + '2. ورشة العمل التمهيدية | 45000 | 2026-04\n'
    + 'مسوّدة الاستراتيجية\n' });
  assert.equal(parsed.deliverables.length, 3, 'ثلاثة أسطر ⟵ ثلاثة مخرجات');
  assert.equal(parsed.deliverables[0].name_ar, 'تقرير الوضع الراهن', 'الترقيم والشرطات تُنزَع، والاسم كما كُتب');
  assert.equal(parsed.deliverables[0].amount_sar, 120000);
  assert.equal(parsed.deliverables[0].period, '2026-03');
  assert.equal(parsed.deliverables[2].amount_sar, null, 'وسطرٌ بلا مبلغ لا يُخترع له صفر');
  assert.ok(parsed._note, 'ويقول إنه استُخرج محلياً كي تُراجَع الحقول');
});

test('والمراجَع منها يُحفَظ عبر خدمة الحوكمة — لا إدراج يتخطّى حارسها', async () => {
  const p = await projects.createProject(CTX, { name_ar: 'مشروع يُحفظ له مخرجات', sector_id: 'SOL' });
  const r = await intake.addDeliverables(CTX, p.id, [
    { name_ar: 'مخرَج أول', amount_sar: 5000, period: '2026-06' },
    { name_ar: 'مخرَج ثانٍ' },
  ]);
  assert.equal(r.added, 2);
  const rows = await db.all('SELECT name_ar, amount_halalas, month, year FROM deliverable WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at', [p.id]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount_halalas, 5000 * 100, 'المبلغ هللات صحيحة');
  assert.equal(Number(rows[0].month), 6);
  assert.equal(Number(rows[0].year), 2026);
  await assert.rejects(() => intake.addDeliverables(CTX, p.id, []), /لا مخرجات لإضافتها/);
});

test('ومن لا يُدير المشروع لا يقرأ له نصّاً ولا يكتب فيه مخرَجاً', async () => {
  const p = await projects.createProject(CTX, { name_ar: 'مشروع محروس', sector_id: 'SOL' });
  const outsider = { id: 'u_out', username: 'out', role_id: 'employee', scope: 'own', sector_id: 'INN',
    projectIds: new Set(), teamIds: new Set() };
  await assert.rejects(() => intake.parseDeliverables(outsider, p.id, { text: 'مخرَج — 100' }), /صلاحي/);
  await assert.rejects(() => intake.addDeliverables({ user: outsider, ip: '1' }, p.id, [{ name_ar: 'مخرَج' }]), /صلاحي/);
});

// ── ⑤ الاستدراك: يربط قبل أن يُنشئ ──────────────────────────────────────────
test('الاستدراك يربط المشروع بفرصته القائمة بالاسم — ولا يُنشئ ثانيةً فتُحسب القيمة مرتين', async () => {
  await db.insert('opportunity', { id: 'O_LEGACY', title_ar: 'منظومة رصد دخول الحافلات للمشاعر',
    sector_id: 'SOL', stage_id: 'WON', value_halalas: 900_000_00, year: 2025, created_at: T });
  await db.insert('project', { id: 'P_LEGACY', name_ar: 'منظومة رصد دخول الحافلات للمشاعر المقدسة',
    sector_id: 'SOL', status: 'IN_PROGRESS', created_at: T });
  const before = (await db.get('SELECT COUNT(*) n FROM opportunity WHERE deleted_at IS NULL')).n;
  const r = await backfill.backfillProjectOpportunities({ force: true, now: new Date('2026-03-01T00:00:00Z') });
  assert.ok(r.linked.some((x) => x.project === 'منظومة رصد دخول الحافلات للمشاعر المقدسة'), 'رُبط بالاسم');
  assert.equal((await db.get('SELECT source_opp_id FROM project WHERE id = ?', ['P_LEGACY'])).source_opp_id, 'O_LEGACY');
  const afterN = (await db.get('SELECT COUNT(*) n FROM opportunity WHERE deleted_at IS NULL')).n;
  assert.equal(afterN, before, 'ولم تُنشأ فرصة له — الربط لا الإنشاء');
});

test('المشروع التاريخي بلا سنة بيع يبقى غير منسوب إلى سنة ومستبعداً من المبيعات', async () => {
  await db.insert('project', { id: 'P_OLD', name_ar: 'عملٌ قديم لا شبيه له', sector_id: 'SOL',
    status: 'COMPLETED', contract_value_halalas: 500_000_00, start_date: '2024-02-01', created_at: T });
  const r = await backfill.backfillProjectOpportunities({ force: true, now: new Date('2026-03-01T00:00:00Z') });
  assert.ok(r.created.some((x) => x.project === 'عملٌ قديم لا شبيه له' && x.year === null && x.historic));
  const oid = (await db.get('SELECT source_opp_id FROM project WHERE id = ?', ['P_OLD'])).source_opp_id;
  const o = await db.get('SELECT year, exclude_from_sales, value_halalas FROM opportunity WHERE id = ?', [oid]);
  assert.equal(o.year, null, 'السنة غير معروفة؛ لا نستنتجها من التنفيذ');
  assert.equal(Number(o.exclude_from_sales), 1, 'ومعلَّمة «تاريخي» كما تُعلَّم الفرص المستوردة');
  assert.equal(o.value_halalas, 500_000_00, 'وبقيمة مشروعها');
});

test('والاستدراك لا يُعاد بلا إلزام — طابعه في سجلّ «ما جرى مرةً واحدة»', async () => {
  const again = await backfill.backfillProjectOpportunities({});
  assert.equal(again.skipped, true, 'وإلا أُعيد إنشاء ما حذفه المالك بيده عند كل إقلاع');
});

// ── ⑥ المعاملة المتداخلة تنضمّ إلى أمّها ────────────────────────────────────
// عطلٌ بنيوي كشفه تركيب هذه الميزة: خدمةٌ بمعاملة تُنادى من خدمةٍ بمعاملة. سكويلايت كان يرمي،
// وبوستجريس كان يُثبِّت الداخلية على اتصالٍ آخر فتنجو من تراجع أمّها — نصفُ عملٍ مكتوب بصمت.
test('المعاملة داخل معاملة تنضمّ إليها: تراجع الأمّ يمحو ما كُتب في الابنة', async () => {
  await assert.rejects(() => db.tx(async () => {
    await db.insert('client', { id: 'CL_OUTER', name_ar: 'جهة خارجية', active: 1, created_at: T });
    await db.tx(async () => {
      await db.insert('client', { id: 'CL_INNER', name_ar: 'جهة داخلية', active: 1, created_at: T });
    });
    throw new Error('فشلٌ بعد الكتابتين');
  }), /فشلٌ بعد الكتابتين/);
  assert.equal(await db.get('SELECT id FROM client WHERE id = ?', ['CL_OUTER']), undefined);
  assert.equal(await db.get('SELECT id FROM client WHERE id = ?', ['CL_INNER']), undefined,
    'الابنة لا تنجو من تراجع أمّها — وإلا بقي نصف العمل مكتوباً بلا خطأ يقول ذلك');
});

// ── ⑦ الشاشة تعرض ما يُعدَّل فعلاً ──────────────────────────────────────────
test('صفحة المشروع تعرض شريط التعديل الكامل وبابَ المخرجات — لا وعدٌ في الخدمة بلا موضعٍ يستعمله', async () => {
  const { projectDetailPage } = await import('../../src/web/views/pmo.js');
  const p = await projects.createProject(CTX, { name_ar: 'مشروع للعرض', sector_id: 'SOL', contract_value_sar: 12_000 });
  const html = await projectDetailPage(ADMIN, p.id);
  assert.match(html, /تعديل بيانات المشروع/);
  for (const el of ['prj-name', 'prj-code', 'prj-value', 'prj-start', 'prj-end']) {
    assert.ok(html.includes(`id="${el}"`), `الحقل ${el} معروض`);
  }
  assert.match(html, /data-action="prj-identity-save"/);
  assert.match(html, /أضف المخرجات دفعة واحدة/);
  assert.match(html, /data-action="dlvx-parse"/);
});


test('استكمال المشروع يحفظ البيانات والفرصة المصدر ويظل قابلاً للاستئناف', async () => {
  const { projectDetailPage } = await import('../../src/web/views/pmo.js');
  const o = await opps.createOpportunity(CTX, { title_ar: 'مصدر البيع المحفوظ', sector_id: 'SOL', client_id: 'CL', value_sar: 54321, year: 2025, stage_id: 'LEAD' });
  const won = await opps.moveStage(CTX, o.id, 'WON');
  const original = await db.get('SELECT * FROM opportunity WHERE id = ?', [o.id]);
  let html = await projectDetailPage(ADMIN, won.project_id);
  assert.match(html, /id="project-setup"/);
  assert.match(html, /قيمة البيع المسجّلة/);
  assert.ok(html.includes((await import('../../src/core/util/ids.js')).fmtSar(5432100)));
  const setup = html.match(/<section id="project-setup"[\s\S]*?<\/section>/)[0];
  assert.match(setup, /مسجّل — راجعه/);
  assert.match(setup, /يحتاج استكمالاً/);
  assert.match(setup, /ليست نسبة إنجاز/);
  assert.equal((setup.match(/data-action="project-setup-open"/g) || []).length, 6);
  assert.match(html, /ليست تأكيداً لقيمة العقد/);
  assert.match(html, /غير مقيّم/);
  assert.match(html, /id="prj-value"[^>]+value=""/);
  await projects.updateProject(CTX, won.project_id, { start_date: '2026-01-01', end_date: '2026-12-31', contract_value_sar: 55000 });
  html = await projectDetailPage(ADMIN, won.project_id);
  assert.match(html, /value="2026-01-01"/);
  assert.match(html, /value="55000"/);
  assert.deepEqual(await db.get('SELECT * FROM opportunity WHERE id = ?', [o.id]), original);
  await sync.ensureProjectForWonOpportunity(CTX, original);
  const rows = await db.all('SELECT * FROM project WHERE source_opp_id = ? AND deleted_at IS NULL', [o.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contract_value_halalas, 5500000);
  assert.equal(rows[0].start_date, '2026-01-01');
  await projects.updateProject(CTX, won.project_id, { rag: 'AMBER' });
  await projects.updateProject(CTX, won.project_id, { rag: null });
  assert.equal((await db.get('SELECT rag FROM project WHERE id = ?', [won.project_id])).rag, null);
});

test('تأكيد سنة البيع يصلح المرآة الجديدة دون تغيير سنة التنفيذ أو الاستبعاد التاريخي', async () => {
  const p = await projects.createProject(CTX, { name_ar: 'سنة مستقلة', sector_id: 'SOL', start_date: '2026-01-01' });
  const link = await db.get('SELECT source_opp_id FROM project WHERE id = ?', [p.id]);
  const before = await db.get('SELECT * FROM opportunity WHERE id = ?', [link.source_opp_id]);
  assert.equal(before.year, null);
  assert.equal(before.exclude_from_sales, 1);
  const html = await (await import('../../src/web/views/pmo.js')).projectDetailPage(ADMIN, p.id);
  assert.match(html, /سنة البيع غير مؤكدة/);
  await assert.rejects(() => opps.updateOpportunity(CTX, link.source_opp_id, { year: 0 }), /السنة غير صحيحة/);
  await opps.updateOpportunity(CTX, link.source_opp_id, { year: 2025 });
  const after = await db.get('SELECT * FROM opportunity WHERE id = ?', [link.source_opp_id]);
  assert.equal(after.year, 2025);
  assert.equal(after.exclude_from_sales, 0);
  assert.equal((await db.get('SELECT start_date FROM project WHERE id = ?', [p.id])).start_date, '2026-01-01');
  await db.update('opportunity', link.source_opp_id, { exclude_from_sales: 1 });
  await opps.updateOpportunity(CTX, link.source_opp_id, { year: 2024 });
  assert.equal((await db.get('SELECT exclude_from_sales FROM opportunity WHERE id = ?', [link.source_opp_id])).exclude_from_sales, 1);
  const explicit = await projects.createProject(CTX, { name_ar: 'بيع مؤكد', sector_id: 'SOL', sale_year: 2025, start_date: '2026-02-01' });
  const e = await db.get('SELECT o.year,o.exclude_from_sales FROM opportunity o JOIN project p ON p.source_opp_id=o.id WHERE p.id=?', [explicit.id]);
  assert.equal(e.year, 2025); assert.equal(e.exclude_from_sales, 0);
  await assert.rejects(() => projects.createProject(CTX, { name_ar: 'سنة خاطئة', sector_id: 'SOL', sale_year: 'wrong' }), /سنة البيع غير صحيحة/);
});

// ── KI-112: التراجع المراجَع عن فوزٍ له مشروع — قرارٌ على الطرفين بلا حذف ─────────────────
test('التراجع المراجَع: «إلغاء المشروع» يُبقي السجل بحالة ملغى ويعيد الفرصة بسبب وأثر، و«إبقاؤه» يفكّ الربط ويولّد مرآة مستبعدة من المبيعات', async () => {
  const opp1 = await opps.createOpportunity(CTX, { title_ar: 'فرصة تراجع — إلغاء', client_id: 'CL', sector_id: 'SOL', value_sar: 50000, year: 2026 });
  await opps.moveStage(CTX, opp1.id, 'WON', 'فوز');
  const prj1 = await db.get('SELECT * FROM project WHERE source_opp_id = ?', [opp1.id]);
  assert.ok(prj1, 'الفوز ولّد مشروعاً');
  // الحارس القائم: النقل العادي يرفض
  await assert.rejects(() => opps.moveStage(CTX, opp1.id, 'LEAD', 'تراجع'), /لا يمكن التراجع تلقائياً/);
  // بلا سبب أو قرار: يُرفض
  await assert.rejects(() => opps.reviewedWonReversal(CTX, opp1.id, { to_stage: 'LEAD', project_action: 'cancel', reason: '' }), /سبب التراجع/);
  await assert.rejects(() => opps.reviewedWonReversal(CTX, opp1.id, { to_stage: 'LEAD', project_action: 'drop', reason: 'سبب كافٍ' }), /قرار المشروع/);
  await assert.rejects(() => opps.reviewedWonReversal(CTX, opp1.id, { to_stage: 'WON', project_action: 'cancel', reason: 'سبب كافٍ' }), /غير فائزة/);
  const r1 = await opps.reviewedWonReversal(CTX, opp1.id, { to_stage: 'LEAD', project_action: 'cancel', reason: 'الجهة ألغت التعاقد قبل البدء' });
  assert.equal(r1.project_action, 'cancel'); assert.equal(r1.stage_id, 'LEAD');
  const p1 = await db.get('SELECT status, deleted_at, source_opp_id FROM project WHERE id = ?', [prj1.id]);
  assert.equal(p1.status, 'CANCELLED'); assert.equal(p1.deleted_at, null, 'لا حذف'); assert.equal(p1.source_opp_id, opp1.id, 'الربط باقٍ للتاريخ');
  const h1 = await db.all('SELECT to_stage_id, note FROM opportunity_stage_history WHERE opportunity_id = ? ORDER BY changed_at', [opp1.id]);
  assert.equal(h1[h1.length - 1].to_stage_id, 'LEAD'); assert.match(h1[h1.length - 1].note, /تراجع مراجَع.*ألغت/);
  const a1 = await db.all("SELECT action, resource, detail_json FROM audit_log WHERE resource_id IN (?, ?) AND detail_json LIKE '%won_reversal%'", [opp1.id, prj1.id]);
  assert.ok(a1.some((a) => a.resource === 'project' && a.action === 'cancel'));
  assert.ok(a1.some((a) => a.resource === 'opportunity' && JSON.parse(a.detail_json).reviewed === true));

  const opp2 = await opps.createOpportunity(CTX, { title_ar: 'فرصة تراجع — إبقاء', client_id: 'CL', sector_id: 'SOL', value_sar: 70000, year: 2026 });
  await opps.moveStage(CTX, opp2.id, 'WON', 'فوز');
  const prj2 = await db.get('SELECT * FROM project WHERE source_opp_id = ?', [opp2.id]);
  const r2 = await opps.reviewedWonReversal(CTX, opp2.id, { to_stage: 'LOST', project_action: 'keep', reason: 'العمل استمر بتعاقد آخر خارج هذه الفرصة' });
  assert.equal(r2.project_action, 'keep'); assert.ok(r2.mirror_opportunity_id && r2.mirror_opportunity_id !== opp2.id, 'مرآة جديدة للمشروع');
  const p2 = await db.get('SELECT status, deleted_at, source_opp_id FROM project WHERE id = ?', [prj2.id]);
  assert.equal(p2.deleted_at, null); assert.equal(p2.source_opp_id, r2.mirror_opportunity_id, 'المشروع مربوط بمرآته الجديدة لا بالفرصة الأصل');
  assert.notEqual(p2.status, 'CANCELLED');
  const mirror = await db.get('SELECT stage_id, year, exclude_from_sales, source FROM opportunity WHERE id = ?', [r2.mirror_opportunity_id]);
  assert.equal(mirror.stage_id, 'WON'); assert.equal(mirror.year, null); assert.equal(Number(mirror.exclude_from_sales), 1, 'مستبعدة من المبيعات حتى تُؤكَّد سنتها'); assert.equal(mirror.source, 'project');
  const orig = await db.get('SELECT stage_id, deleted_at FROM opportunity WHERE id = ?', [opp2.id]);
  assert.equal(orig.stage_id, 'LOST'); assert.equal(orig.deleted_at, null, 'الفرصة الأصل باقية بتاريخها');
});

test('التراجع المراجَع يتطلب صلاحية تعديل الفرصة والمشروع معاً', async () => {
  const opp = await opps.createOpportunity(CTX, { title_ar: 'فرصة تراجع — صلاحية', client_id: 'CL', sector_id: 'SOL', value_sar: 1000, year: 2026 });
  await opps.moveStage(CTX, opp.id, 'WON', 'فوز');
  await db.insert('app_user', { id: 'u_viewer', username: 'viewer', role_id: 'viewer', scope: 'sector', sector_id: 'SOL', active: 1, created_at: T });
  const viewer = { user: { id: 'u_viewer', username: 'viewer', role_id: 'viewer', scope: 'sector', sector_id: 'SOL', projectIds: new Set(), teamIds: new Set() }, ip: '1' };
  await assert.rejects(() => opps.reviewedWonReversal(viewer, opp.id, { to_stage: 'LEAD', project_action: 'cancel', reason: 'محاولة بلا صلاحية' }), (e) => e.status === 403);
  const p = await db.get('SELECT status FROM project WHERE source_opp_id = ?', [opp.id]);
  assert.notEqual(p.status, 'CANCELLED');
});
