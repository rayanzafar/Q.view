// بطاقة «الفعالية الجارية» على «صفحتي» — «مؤقتاً، زر سريع للمعرض في الصفحة الرئيسية» بلسان
// المالك (٢٠٢٦-٠٨-٢٨).
//
// وما يُحرَس هنا ثلاثة أشياء، وكلها في الصفحة المرسومة لا في الخدمة وحدها:
//   • **الزمن يُشغّلها ويُطفئها**: تظهر ما دام اليوم بين تاريخي الفعالية، وتختفي بنفسها بعد
//     آخر يوم — فلا يُطلب من أحد أن يتذكّر إزالتها. وما انتهى أمس أو يبدأ غداً لا يُرى.
//   • **الإغلاق اليدوي يُسقطها فوراً**: من راجع المعرض وختمه لا يريد زرّ التقاطٍ يدعو إلى
//     بطاقاتٍ جديدة في فعاليةٍ مُغلقة.
//   • **لا وعدَ بشاشة يردّها الحارس**: الخارجي لا يفتح «الفعاليات»، فلا يرى زرّاً يقوده إليها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-evbanner-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, ev, nav, homePage;
const T = new Date().toISOString();
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

// مُنشئ الفعالية قائد قطاع (له إدارة الفعاليات)، والقارئ استشاري عادي بلا سجل موظف ولا مهام —
// أفقر صفحةٍ ممكنة، كي يثبت أن البطاقة لا تعتمد على شيءٍ آخر في الصفحة.
const LEAD = { id: 'u_lead', username: 'lead', name_ar: 'قائد القطاع', role_id: 'sector_lead', sector_id: 'SOL', scope: 'sector' };
const ME = { id: 'u_me', username: 'me', name_ar: 'سارة', role_id: 'consultant', sector_id: 'SOL', scope: 'own' };
const EXT = { id: 'u_ext', username: 'ext', name_ar: 'ضيف', role_id: 'external', sector_id: 'SOL', scope: 'own' };
const CTX = { user: LEAD, ip: '1' };

const LIVE_NAME = 'معرض التقنية الكبير';
const LIVE_VENUE = 'مركز الرياض للمعارض & المؤتمرات';   // «&» عمداً: تُثبت الهروب
const OLD_NAME = 'معرض انتهى أمس';
const NEXT_NAME = 'معرض يبدأ غداً';
let live;

const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const cards = (html) => (html.match(/class="card hm-ev"/g) || []).length;

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ev = await import('../../src/modules/events/events.js');
  nav = await import('../../src/web/nav.js');
  ({ homePage } = await import('../../src/web/views/home.js'));
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  for (const u of [LEAD, ME, EXT]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  live = await ev.createEvent(CTX, { name_ar: LIVE_NAME, venue: LIVE_VENUE, booth_no: 'B12', starts_on: day(-1), ends_on: day(1) });
  await ev.createEvent(CTX, { name_ar: OLD_NAME, venue: 'جدة', starts_on: day(-3), ends_on: day(-1) });
  await ev.createEvent(CTX, { name_ar: NEXT_NAME, venue: 'الدمام', starts_on: day(1), ends_on: day(3) });
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('ما دام المعرض جارياً تظهر بطاقته على «صفحتي» بزرٍّ واحد يفتح تبويب الالتقاط', async () => {
  assert.equal(live.status, 'جارية', 'الفعالية المزروعة ليست جارية — الفحص يقيس لا شيء');
  const main = mainOf(await homePage(ME, {}));
  assert.equal(cards(main), 1, 'بطاقة واحدة لفعاليةٍ جارية واحدة');
  assert.ok(main.includes(`${LIVE_NAME} يعمل الآن`), 'عنوان البطاقة «… يعمل الآن» غائب');
  assert.ok(main.includes('class="now-dot"'), 'نقطة «الآن» الذهبية غائبة');
  assert.ok(main.includes(`href="/app/event/${live.id}?tab=capture"`), 'الزر لا يقود إلى تبويب الالتقاط');
  assert.ok(main.includes('التقط جهة'), 'نص الزر غائب');
  assert.ok(main.includes('جناح B12'), 'رقم الجناح غائب من سطر المكان');
  const endDay = Number(live.ends_on.slice(8, 10));
  assert.ok(main.includes(`حتى <span class="tnum">${endDay}</span>`), 'آخر يوم في الفعالية غائب أو خارج خانة الأرقام');
});

test('وكل قيمة من الفعالية تُهرَّب — «&» في اسم المكان لا تمرّ خاماً', async () => {
  const main = mainOf(await homePage(ME, {}));
  assert.ok(main.includes('للمعارض &amp; المؤتمرات'), 'اسم المكان لم يُهرَّب');
  assert.ok(!main.includes('للمعارض & المؤتمرات'), 'اسم المكان طُبع خاماً');
});

test('وما انتهى أمس أو لم يبدأ بعد لا يُرى — البطاقة يُطفئها التاريخ لا يد أحد', async () => {
  const main = mainOf(await homePage(ME, {}));
  assert.ok(!main.includes(OLD_NAME), 'فعاليةٌ انتهت أمس ما زالت على الصفحة');
  assert.ok(!main.includes(NEXT_NAME), 'فعاليةٌ لم تبدأ بعد ظهرت على الصفحة');
  assert.equal(cards(main), 1);
});

test('ولا تسرّب قيمة خام ولا مصطلحاً تقنياً في الصفحة كلها', async () => {
  const html = await homePage(ME, {});
  for (const bad of ['undefined', 'NaN', '[object']) {
    assert.ok(!html.includes(bad), `ظهرت «${bad}» في صفحةٍ يقرؤها المستخدم`);
  }
});

test('والخارجي — الذي لا يفتح «الفعاليات» — لا يرى البطاقة: لا وعدَ بشاشة يردّها الحارس', async () => {
  assert.equal(nav.pageAllowed(EXT, 'events'), false, 'الفحص بلا دورٍ محروم لا يثبت شيئاً');
  assert.equal(nav.pageAllowed(ME, 'events'), true, 'الاستشاري محروم من الفعاليات — الفحص الأول يقيس لا شيء');
  const main = mainOf(await homePage(EXT, {}));
  assert.equal(cards(main), 0, 'بطاقة الفعالية ظهرت لمن لا يفتح شاشتها');
  assert.ok(!main.includes('يعمل الآن'));
  assert.ok(!main.includes('/app/event/'), 'رابط فعالية لمن يردّه حارس الصفحة');
  assert.ok(!main.includes(LIVE_NAME), 'اسم الفعالية تسرّب إلى صفحة الخارجي');
});

test('وإغلاق الفعالية يُسقط البطاقة فوراً — وإعادة فتحها تُعيدها', async () => {
  await ev.closeEvent(CTX, live.id);
  let main = mainOf(await homePage(ME, {}));
  assert.equal(cards(main), 0, 'فعاليةٌ مُغلقة ما زالت تدعو إلى الالتقاط');
  assert.ok(!main.includes('يعمل الآن'));
  assert.ok(!main.includes(LIVE_NAME));
  assert.ok(!main.includes('/app/event/'));

  await ev.closeEvent(CTX, live.id, { reopen: true });
  main = mainOf(await homePage(ME, {}));
  assert.equal(cards(main), 1, 'إعادة فتح الفعالية لم تُعد بطاقتها');
  assert.ok(main.includes(`href="/app/event/${live.id}?tab=capture"`));
});
