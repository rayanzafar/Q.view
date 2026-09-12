// ── شاشة «إعدادات لوحة الفرص» — ما تَعِد به الشاشة هو ما تفعله الخدمة ─────────────────────
// الخدمة (`modules/crm/boards.js`) محروسة باختبارها الخاص. هذا الملف يحرس **الشاشة**، وهي
// الموضع الذي تُفقَد فيه الوعود عادةً:
//   ١) الفراغ في احتمال الفوز فراغٌ على الشاشة كما هو في القاعدة — لا صفرٌ مطبوع ولا حقلٌ
//      يعود بصفرٍ عند أول حفظ. هذا أخطر انحرافٍ ممكن هنا: يقلب «لا تفرض نسبة» إلى «الفوز مستبعد».
//   ٢) حذفُ مرحلةٍ فيها فرص يطلب الوجهة **في النموذج** لا بعد أن يردّ الخادم — والرسالة إن رُدّ
//      تُعرض بنصّها.
//   ٣) الصفة لا الاسم، والأرشفة إخفاءٌ لا محو: مكتوبتان على الشاشة لا في وثيقة بعيدة.
//   ٤) بوابةُ الشاشة منح الإدارة نفسه الذي تفحصه الخدمة — فلا تُعرض أزرارٌ يردّها الخادم.
//   ٥) لا مصطلح تقني ولا قيمة خام ولا فراغُ برمجةٍ في النص الذي يقرؤه المستخدم.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { visibleText, bannedTermIn } from '../../scripts/check-glossary.mjs';

const dir = mkdtempSync(join(tmpdir(), 'sanad-cbs-page-'));
process.env.SANAD_DB = join(dir, 'p.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const T = '2026-01-05T00:00:00Z';
const mk = (o) => ({ projectIds: new Set(), teamIds: new Set(), productMemberships: new Set(), ...o });
const BD = mk({ id: 'u_bd', username: 'u_bd', name_ar: 'عضو تطوير الأعمال', role_id: 'bd_team', scope: 'company', sector_id: null });
const VIEWER = mk({ id: 'u_view', username: 'u_view', name_ar: 'قارئ', role_id: 'viewer', scope: 'sector', sector_id: 'SOL' });
const EMP = mk({ id: 'u_emp', username: 'u_emp', name_ar: 'موظف', role_id: 'employee', scope: 'own', sector_id: 'SOL' });

let db, page, PAGE_ACCESS, boards;
// ما بين وسمي <ol data-stages="BOARD_SALES"> — ترتيب الأعمدة كما يراه القارئ.
const orderOf = (html, boardId) => {
  const start = html.indexOf(`<ol class="cbs-list" data-stages="${boardId}"`);
  const end = html.indexOf('</ol>', start);
  return [...html.slice(start, end).matchAll(/data-stage="([^"]+)"/g)].map((m) => m[1]);
};
const templateOf = (html, id) => {
  const start = html.indexOf(`<template id="tpl-${id}">`);
  if (start === -1) return '';
  return html.slice(start, html.indexOf('</template>', start));
};

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  ({ crmBoardSettingsPage: page } = await import('../../src/web/pages.js'));
  ({ PAGE_ACCESS } = await import('../../src/core/policy/pages.js'));
  boards = await import('../../src/modules/crm/boards.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  for (const u of [BD, VIEWER, EMP]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id, sector_id: 'SOL', scope: u.scope, active: 1, created_at: T });
  }
  await db.insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  // أربع مراحل: واحدة بلا نسبة مقصودة، وواحدة فائزة، وواحدة خاسرة، واسمٌ فيه وسمٌ خبيث.
  for (const [id, ar, pct, won, lost, ord, color] of [
    ['LEAD', 'ترشيح <script>', 10, 0, 0, 1, '#94a3b8'],
    ['NOPCT', 'بلا نسبة', null, 0, 0, 2, '#0891b2'],
    ['WON', 'مكسوبة', 100, 1, 0, 3, '#059669'],
    ['LOST', 'مفقودة', 0, 0, 1, 4, '#dc2626'],
  ]) {
    await db.insert('stage', { id, name_ar: ar, default_win_pct: pct, is_won: won, is_lost: lost, sort_order: ord, color, board_id: 'BOARD_SALES', created_at: T });
  }
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة أولى', client_id: 'C1', sector_id: 'SOL', owner_user_id: BD.id,
    stage_id: 'LEAD', win_pct: 10, value_halalas: 100000_00, year: 2026, stage_changed_at: T, created_at: T, created_by: BD.id });
  await boards.createTag({ user: BD, ip: '127.0.0.1' }, { name_ar: 'قطاع حكومي', color: '#0EA5E9', description_ar: 'جهات حكومية' });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('اللوحة تُعرض بمراحلها بالترتيب: اللون والوصف والعدّاد وصفة الحسم', async () => {
  const html = await page(BD, {});
  assert.match(html, /إعدادات لوحة الفرص/);
  assert.match(html, /مسار البيع/, 'اللوحة الافتراضية معروضة باسمها');
  assert.deepEqual(orderOf(html, 'BOARD_SALES'), ['LEAD', 'NOPCT', 'WON', 'LOST'], 'المراحل بترتيبها المحفوظ');
  assert.match(html, /background:#059669/, 'لون المرحلة يُرسم كما حُفظ');
  assert.match(html, /تُحتسب فوزاً/, 'صفة الفوز ظاهرة على المرحلة');
  assert.match(html, /تُحتسب خسارة/, 'صفة الخسارة ظاهرة على المرحلة');
  assert.match(html, /الفرص عليها <b><span class="tnum">1<\/span><\/b>/, 'عدّاد فرص المرحلة');
  assert.match(html, /قطاع حكومي/, 'التصنيفات معروضة في الشاشة نفسها');
});

test('الفراغ في احتمال الفوز يبقى فراغاً على الشاشة وفي النموذج — لا يصير صفراً', async () => {
  const html = await page(BD, {});
  assert.match(html, /لا تُفرض نسبة/, 'المرحلة بلا نسبة تُقرأ جملةً لا رقماً');
  const form = templateOf(html, 'stage-edit-NOPCT');
  assert.ok(form, 'لكل مرحلة نموذج تعديل مبنيّ على الخادم');
  assert.match(form, /name="default_win_pct"[^>]*value=""/, 'الحقل يُفتح فارغاً كما هو محفوظ');
  assert.doesNotMatch(form, /name="default_win_pct"[^>]*value="0"/, 'الفراغ لا يُحوَّل صفراً في النموذج');
  // والصفر المحفوظ يبقى صفراً: «الفوز مستبعد» غير «لا تُفرض نسبة».
  assert.match(templateOf(html, 'stage-edit-LOST'), /name="default_win_pct"[^>]*value="0"/);
});

test('حذفُ مرحلةٍ فيها فرص يطلب الوجهة في النموذج قبل أي نداء', async () => {
  const html = await page(BD, {});
  const del = templateOf(html, 'stage-del-LEAD');
  assert.match(del, /name="moveToStageId"[^>]*required/, 'قائمة الوجهة إلزامية ما دامت المرحلة تحمل فرصاً');
  assert.match(del, /اختر المرحلة التي تنتقل إليها/, 'السبب مكتوب لا مفترض');
  assert.match(del, /value="WON"/, 'الوجهات مراحل حيّة أخرى');
  assert.doesNotMatch(del.slice(del.indexOf('<select')), /value="LEAD"/, 'لا تُعرض المرحلة نفسها وجهةً لنفسها');
  // ومرحلةٌ فارغة لا تطالب بوجهة — الطلب حيث له معنى فقط.
  const empty = templateOf(html, 'stage-del-NOPCT');
  assert.doesNotMatch(empty, /name="moveToStageId"/);
  assert.match(empty, /لا توجد فرص على هذه المرحلة/);
});

test('الشاشة تقول إن المعنى في الصفة لا في الاسم، وإن الأرشفة إخفاءٌ لا محو', async () => {
  const html = await page(BD, {});
  assert.match(html, /الفوز والخسارة يُقرآن من صفة العمود لا من اسمه/);
  assert.match(html, /الأرشفة تُخفي العمود ولا تمحو تاريخه/);
  assert.match(html, /id="dd-cbs-meaning"/, 'تفصيل المعنى مبنيّ على الخادم في قالبٍ خامل');
  assert.match(html, /data-action="cbs-dd" data-dd="cbs-meaning"/, 'ويُفتح بالتفويض لا بمعالجٍ داخل الوسم');
});

test('الترتيب بالسحب والإفلات: قائمةٌ واحدة تُرسل بنداءٍ واحد، ولكل مرحلة بديلٌ بلوحة المفاتيح', async () => {
  const html = await page(BD, {});
  assert.match(html, /<ol class="cbs-list" data-stages="BOARD_SALES"/, 'المراحل قائمةٌ مرتَّبة لا صفوف متفرقة');
  assert.match(html, /draggable="true"/);
  assert.match(html, /aria-label="نقل المرحلة خطوة للأعلى"/, 'من لا يسحب بالفأرة ينقل بالسهمين');
  const client = readFileSync(join(ROOT, 'src/web/public/pages/crm-board-settings.js'), 'utf8');
  assert.equal((client.match(/crm\/stages\/reorder/g) || []).length, 1, 'موضعٌ واحد يحفظ الترتيب — لا نداء لكل عمود');
  assert.match(client, /'\/crm\/stages\/reorder', 'POST', \{ order: order \}/);
});

test('البوابة: منح إدارة اللوحات هو ما يفتح الشاشة، ومن يقرأ فقط لا يرى زرّ تغيير', async () => {
  assert.equal(typeof PAGE_ACCESS['crm-board-settings'], 'function', 'للشاشة بوابة معلنة');
  assert.equal(PAGE_ACCESS['crm-board-settings'](BD), true, 'فريق تطوير الأعمال يدير اللوحات');
  assert.equal(PAGE_ACCESS['crm-board-settings'](mk({ role_id: 'admin', scope: 'company' })), true);
  assert.equal(PAGE_ACCESS['crm-board-settings'](mk({ role_id: 'bd_head', scope: 'company' })), true);
  for (const u of [EMP, VIEWER, mk({ role_id: 'project_manager', scope: 'own' })]) {
    assert.equal(PAGE_ACCESS['crm-board-settings'](u), false, `${u.role_id} لا يملك إدارة اللوحات`);
  }
  const html = await page(VIEWER, {});
  assert.doesNotMatch(html, /data-action="cbs-open"/, 'لا زرّ يفتح نموذج تعديل لمن لا يملكه');
  assert.doesNotMatch(html, /data-action="cbs-archive"/);
  assert.match(html, /لديك اطّلاع على الإعدادات دون تعديلها/, 'ويُقال له لماذا بجملة لا بصمت');
});

test('المؤرشف لا يظهر إلا بطلبه، ثم يُعاد بزرٍّ يقول ما يفعل', async () => {
  await boards.createStage({ user: BD, ip: '127.0.0.1' }, { id: 'PARKED', name_ar: 'مؤجّلة', board_id: 'BOARD_SALES' });
  await boards.updateStage({ user: BD, ip: '127.0.0.1' }, 'PARKED', { archived: true });
  const live = await page(BD, {});
  assert.doesNotMatch(live, /data-stage="PARKED"/, 'العمود المؤرشف خارج اللوحة');
  const all = await page(BD, { archived: '1' });
  assert.match(all, /data-stage="PARKED"/);
  assert.match(all, /مؤرشفة/);
  assert.match(all, /data-action="cbs-archive" data-id="PARKED" data-on="0"/, 'زرّ الإعادة يعرف حاله');
  assert.match(all, /إعادة العمود/);
});

test('لا وسمٌ يتسرّب من اسمٍ خبيث، ولا مصطلح تقني ولا فراغُ برمجةٍ في النص الظاهر', async () => {
  for (const opts of [{}, { archived: '1' }]) {
    const html = await page(BD, opts);
    assert.ok(!/<script>ترشيح|ترشيح <script>/.test(html), 'اسم المرحلة يُهرَّب قبل الطباعة');
    assert.match(html, /ترشيح &lt;script&gt;/);
    for (const rx of [/\bundefined\b/, /\bNaN\b/, /\[object/, /\bnull\b/]) {
      assert.doesNotMatch(html, rx, `تسرّبت قيمة برمجية إلى الصفحة: ${rx}`);
    }
    assert.equal(bannedTermIn(visibleText(html)), null, 'مصطلح محظور في نصٍّ يقرؤه المستخدم');
    // جسمُ الصفحة وحده: ما بعد </main> إطارٌ مشترك لا تملكه هذه الشاشة.
    const pageBody = html.slice(html.indexOf('<div class="cbs">'), html.indexOf('</main>'));
    assert.doesNotMatch(pageBody, / onclick=/, 'لا معالج داخل الوسم في هذه الشاشة');
    assert.match(pageBody, /data-action="cbs-/, 'الأفعال كلها بالتفويض');
  }
});
