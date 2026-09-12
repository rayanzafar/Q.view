// ── إدارة لوحات الفرص ومراحلها وتصنيفاتها من الشاشة ──────────────────────────────────────
// ما تحرسه:
//   ١) الفريق ينشئ مرحلةً ويسمّيها ويلوّنها ويرتّبها — والتغيير يبقى (ليس إعداداً محلياً).
//   ٢) المعنى التشغيلي مربوطٌ بالعَلَم لا بالاسم: تغييرُ اسم «فائزة» لا يكسر توليد المشروع.
//   ٣) آخرُ مرحلةٍ فائزة لا تفقد عَلَمَها ولا تُحذف — التقاريرُ والتحويل مبنيّان عليه.
//   ٤) حذفُ مرحلةٍ فيها فرص لا يقع بلا وجهة، والنقلُ والحذف معاملةٌ واحدة لا تفقد فرصة.
//   ٥) المرحلةُ سير عمل والوسمُ تصنيف: الفرصة في مرحلةٍ واحدة وتحمل وسوماً كثيرة.
//   ٦) من لا يملك إدارة اللوحات يُردّ بجملة عربية — قراءةً كان أو كتابة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-boards-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { insert, get, all, run, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const boards = await import('../../src/modules/crm/boards.js');

const T = '2026-01-05T00:00:00Z';
const BD = { id: 'u_bd', username: 'u_bd', name_ar: 'عضو تطوير الأعمال', role_id: 'bd_team', sector_id: 'SOL', scope: 'company', projectIds: new Set(), teamIds: new Set() };
const EMP = { id: 'u_emp', username: 'u_emp', name_ar: 'موظف', role_id: 'employee', sector_id: 'SOL', scope: 'own', projectIds: new Set(), teamIds: new Set() };
const ctxOf = (u) => ({ user: u, ip: '127.0.0.1' });

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  for (const u of [BD, EMP]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id, sector_id: 'SOL', scope: u.scope, active: 1, created_at: T });
  }
  await insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  for (const [id, ar, pct, won, lost, ord] of [
    ['LEAD', 'ليدز', 10, 0, 0, 1], ['PROPOSAL', 'عرض مقدَّم', 50, 0, 0, 2],
    ['WON', 'فائزة', 100, 1, 0, 3], ['LOST', 'خسارة', 0, 0, 1, 4],
  ]) await insert('stage', { id, name_ar: ar, default_win_pct: pct, is_won: won, is_lost: lost, sort_order: ord, board_id: 'BOARD_SALES', created_at: T });
  await insert('opportunity', { id: 'O1', title_ar: 'فرصة أولى', client_id: 'C1', sector_id: 'SOL',
    owner_user_id: BD.id, stage_id: 'LEAD', win_pct: 10, value_halalas: 100000_00, year: 2026, stage_changed_at: T, created_at: T, created_by: BD.id });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('اللوحة الافتراضية موجودة بمراحلها، والفريق يملك إدارتها', async () => {
  const out = await boards.listBoards(BD);
  assert.equal(out.can_manage, true, 'فريق تطوير الأعمال يدير اللوحات');
  const b = out.boards.find((x) => x.id === 'BOARD_SALES');
  assert.ok(b, 'اللوحة الافتراضية من الترحيلة');
  assert.equal(b.is_default, true);
  assert.equal(b.stages.length, 4, 'المراحل الأربع تحت اللوحة');
  assert.equal(b.stages.find((s) => s.id === 'LEAD').opp_count, 1, 'عدّاد الفرص على المرحلة');
});

test('إنشاء مرحلة باسمها ولونها ووصفها وترتيبها — وتبقى بعد إعادة القراءة', async () => {
  const r = await boards.createStage(ctxOf(BD), {
    id: 'NEGOTIATION', name_ar: 'تفاوض', description_ar: 'مرحلة التفاوض النهائي على السعر',
    color: '#7C3AED', default_win_pct: 70, board_id: 'BOARD_SALES',
  });
  assert.ok(r.ok);
  // قراءةٌ جديدة من القاعدة: ليست حالةً في المتصفح تختفي بالتحديث
  const out = await boards.listBoards(BD);
  const s = out.boards.find((b) => b.id === 'BOARD_SALES').stages.find((x) => x.id === 'NEGOTIATION');
  assert.equal(s.name_ar, 'تفاوض');
  assert.equal(s.color, '#7c3aed');
  assert.equal(s.description_ar, 'مرحلة التفاوض النهائي على السعر');
  assert.equal(Number(s.default_win_pct), 70);
});

test('اللون المعطوب يُردّ، واحتمال الفوز الفارغ يعني «لا تفرض نسبة» لا صفراً', async () => {
  await assert.rejects(() => boards.createStage(ctxOf(BD), { name_ar: 'تجربة', color: 'أزرق' }),
    (e) => { assert.match(e.message, /ست عشرية/); return true; });
  const r = await boards.createStage(ctxOf(BD), { id: 'NO_PCT', name_ar: 'بلا نسبة', default_win_pct: '' });
  const s = await get('SELECT default_win_pct FROM stage WHERE id = ?', [r.id]);
  assert.equal(s.default_win_pct, null, 'الفراغ يبقى فراغاً ولا يصير صفراً');
});

test('تغييرُ اسم «فائزة» لا يكسر العَلَم ولا التقارير', async () => {
  await boards.updateStage(ctxOf(BD), 'WON', { name_ar: 'مغلقة رابحة', color: '#065F46' });
  const s = await get('SELECT name_ar, is_won FROM stage WHERE id = ?', ['WON']);
  assert.equal(s.name_ar, 'مغلقة رابحة');
  assert.equal(Number(s.is_won), 1, 'العَلَم باقٍ — وعليه يقوم توليد المشروع لا على النص');
  // والمستدعي الحقيقي يجدها بالعَلَم
  const won = await get('SELECT id FROM stage WHERE is_won = 1 AND deleted_at IS NULL ORDER BY sort_order, id LIMIT 1');
  assert.equal(won.id, 'WON');
});

test('آخرُ مرحلةٍ فائزة لا تفقد عَلَمَها ولا تُحذف', async () => {
  await assert.rejects(() => boards.updateStage(ctxOf(BD), 'WON', { is_won: false }),
    (e) => { assert.match(e.message, /الوحيدة/); assert.match(e.message, /توليد/); return true; });
  await assert.rejects(() => boards.deleteStage(ctxOf(BD), 'WON'),
    (e) => { assert.match(e.message, /الوحيدة/); return true; });
  // ومرحلةٌ فائزة ثانية على اللوحة نفسها مرفوضة — الحسم رقمٌ واحد
  await assert.rejects(() => boards.createStage(ctxOf(BD), { name_ar: 'فوز آخر', is_won: true }),
    (e) => { assert.match(e.message, /بالفعل/); return true; });
});

test('حذفُ مرحلةٍ فيها فرص لا يقع بلا وجهة — ثم ينقل ويحذف معاً بلا فقد', async () => {
  await assert.rejects(() => boards.deleteStage(ctxOf(BD), 'LEAD'),
    (e) => { assert.match(e.message, /حدّد المرحلة التي تنتقل إليها/); return true; });
  // لم يقع شيء
  assert.equal((await get('SELECT deleted_at FROM stage WHERE id = ?', ['LEAD'])).deleted_at, null);
  assert.equal((await get('SELECT stage_id FROM opportunity WHERE id = ?', ['O1'])).stage_id, 'LEAD');

  const r = await boards.deleteStage(ctxOf(BD), 'LEAD', { moveToStageId: 'PROPOSAL' });
  assert.equal(r.moved, 1);
  assert.ok((await get('SELECT deleted_at FROM stage WHERE id = ?', ['LEAD'])).deleted_at, 'المرحلة محذوفة ناعماً');
  assert.equal((await get('SELECT stage_id FROM opportunity WHERE id = ?', ['O1'])).stage_id, 'PROPOSAL', 'الفرصة انتقلت لا ضاعت');
  // ولا فرصة بلا مرحلة حيّة
  const orphan = await get(`SELECT COUNT(*) n FROM opportunity o LEFT JOIN stage s ON s.id = o.stage_id AND s.deleted_at IS NULL
                             WHERE o.deleted_at IS NULL AND s.id IS NULL`);
  assert.equal(Number(orphan.n), 0, 'لا فرصة يتيمة بعد الحذف');
});

test('الترتيب بالسحب والإفلات يُحفظ نداءً واحداً', async () => {
  const before = (await boards.listBoards(BD)).boards[0].stages.map((s) => s.id);
  const flipped = [...before].reverse();
  await boards.reorderStages(ctxOf(BD), flipped);
  const after = (await boards.listBoards(BD)).boards[0].stages.map((s) => s.id);
  assert.deepEqual(after, flipped, 'الترتيب الجديد مقروءٌ من القاعدة');
  await boards.reorderStages(ctxOf(BD), before);
});

test('المرحلة سير عمل والوسم تصنيف: فرصةٌ واحدة بمرحلةٍ واحدة ووسومٍ كثيرة', async () => {
  const a = await boards.createTag(ctxOf(BD), { name_ar: 'قطاع حكومي', color: '#0EA5E9' });
  const b = await boards.createTag(ctxOf(BD), { name_ar: 'أولوية عليا', color: '#DC2626' });
  await assert.rejects(() => boards.createTag(ctxOf(BD), { name_ar: 'قطاع حكومي' }),
    (e) => { assert.match(e.message, /يوجد تصنيف بهذا الاسم/); return true; });

  await boards.setOpportunityTags(ctxOf(BD), 'O1', [a.id, b.id]);
  const n = await get('SELECT COUNT(*) n FROM opportunity_tag WHERE opportunity_id = ?', ['O1']);
  assert.equal(Number(n.n), 2, 'وسمان على فرصةٍ واحدة');
  // ومرحلتُها ما زالت واحدة — لا تتكرّر الفرصة بتعدّد وسومها
  const stages = await all('SELECT stage_id FROM opportunity WHERE id = ?', ['O1']);
  assert.equal(stages.length, 1);

  // الكتابةُ مجموعةٌ نهائية لا فرقٌ تدريجي
  await boards.setOpportunityTags(ctxOf(BD), 'O1', [a.id]);
  assert.equal(Number((await get('SELECT COUNT(*) n FROM opportunity_tag WHERE opportunity_id = ?', ['O1'])).n), 1);

  // وحذفُ الوسم ينزعه عن الفرص ولا يمسّ الفرصة نفسها
  await boards.deleteTag(ctxOf(BD), a.id);
  assert.equal(Number((await get('SELECT COUNT(*) n FROM opportunity_tag WHERE opportunity_id = ?', ['O1'])).n), 0);
  assert.ok(await get('SELECT id FROM opportunity WHERE id = ? AND deleted_at IS NULL', ['O1']), 'الفرصة سليمة');
});

test('من لا يملك الإدارة يُردّ بجملة عربية', async () => {
  for (const [fn, args] of [
    [boards.createStage, [ctxOf(EMP), { name_ar: 'محاولة' }]],
    [boards.updateStage, [ctxOf(EMP), 'PROPOSAL', { name_ar: 'محاولة' }]],
    [boards.deleteStage, [ctxOf(EMP), 'PROPOSAL', {}]],
    [boards.createTag, [ctxOf(EMP), { name_ar: 'محاولة' }]],
    [boards.createBoard, [ctxOf(EMP), { name_ar: 'محاولة' }]],
  ]) {
    await assert.rejects(() => fn(...args), (e) => {
      assert.ok(/[؀-ۿ]/.test(e.message), 'الرسالة عربية');
      assert.match(e.message, /صلاحية/);
      return true;
    });
  }
});

test('اللوحة الافتراضية لا تُحذف ولا تُؤرشف، ولوحةٌ فيها مراحل لا تُحذف بلا وجهة', async () => {
  await assert.rejects(() => boards.deleteBoard(ctxOf(BD), 'BOARD_SALES', {}),
    (e) => { assert.match(e.message, /الافتراضية لا تُحذف/); return true; });
  await assert.rejects(() => boards.updateBoard(ctxOf(BD), 'BOARD_SALES', { archived: true }),
    (e) => { assert.match(e.message, /لا تُؤرشف/); return true; });
  const nb = await boards.createBoard(ctxOf(BD), { name_ar: 'مسار الشراكات' });
  await boards.createStage(ctxOf(BD), { id: 'PARTNER_LEAD', name_ar: 'ترشيح شريك', board_id: nb.id });
  await assert.rejects(() => boards.deleteBoard(ctxOf(BD), nb.id, {}),
    (e) => { assert.match(e.message, /اختر اللوحة التي تنتقل إليها/); return true; });
  const r = await boards.deleteBoard(ctxOf(BD), nb.id, { moveStagesTo: 'BOARD_SALES' });
  assert.equal(r.movedStages, 1);
  assert.equal((await get('SELECT board_id FROM stage WHERE id = ?', ['PARTNER_LEAD'])).board_id, 'BOARD_SALES');
});

test('كل تغيير على اللوحات مكتوبٌ في سجل التدقيق بصاحبه', async () => {
  const rows = await all("SELECT action, user_id FROM audit_log WHERE resource = 'crm_board' ORDER BY at DESC LIMIT 20");
  assert.ok(rows.length >= 5, 'التغييرات مسجَّلة');
  assert.ok(rows.every((r) => r.user_id === BD.id), 'كلٌّ باسم فاعله');
  assert.ok(rows.some((r) => r.action === 'create') && rows.some((r) => r.action === 'update') && rows.some((r) => r.action === 'delete'));
});
