// حفظُ الأعطال — والخصائص التي تمنع أداةَ التشخيص من أن تصير هي الانقطاع.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-obsdb-'));
process.env.SANAD_DB = join(dir, 'o.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });

let db, cap, store;
before(async () => {
  db = await import('../../src/core/db/index.js');
  cap = await import('../../src/core/obs/capture.js');
  store = await import('../../src/core/obs/store.js');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const REQ = (extra = {}) => ({ method: 'GET', originalUrl: '/app/project/prj_AbC123xyz',
  ctx: { user: { username: 'ريان', role_id: 'employee' } }, ...extra });

test('العطب يُحفَظ صفّاً واحداً، وتكرارُه يزيد العدّ ولا يزيد الصفوف', async () => {
  const before = (await db.all('SELECT COUNT(*) n FROM error_event'))[0].n;
  const e = new TypeError('انفجار متكرّر');
  for (let i = 0; i < 5; i++) cap.captureHttpError(e, REQ(), 500);
  await cap.flushCaptures();
  const rows = await db.all("SELECT * FROM error_event WHERE message = 'انفجار متكرّر'");
  assert.equal(rows.length, 1, 'خمس وقعات صارت خمسة صفوف');
  assert.equal(rows[0].hits, 5, 'لم يُجمَع العدّ');
  assert.equal(rows[0].source, '/app/project/:id', 'لم يُقنَّع المسار');
  assert.equal((await db.all('SELECT COUNT(*) n FROM error_event'))[0].n, before + 1);
});

// أخطر ما في الالتقاط: أن يصير هو الانقطاع. مجمِّعٌ يضمن بياناً واحداً لكل بصمةٍ في الدفعة.
test('وعاصفةُ ألف وقعةٍ لا تكتب ألف صفّ', async () => {
  const e = new RangeError('عاصفة');
  for (let i = 0; i < 1000; i++) cap.captureHttpError(e, REQ(), 500);
  await cap.flushCaptures();
  const rows = await db.all("SELECT hits FROM error_event WHERE message = 'عاصفة'");
  assert.equal(rows.length, 1, 'انفجر الجدول تحت العاصفة');
  assert.equal(rows[0].hits, 1000, 'ضاع العدّ');
});

// وانفجارُ بصماتٍ مختلفة يدور حول أي حدٍّ لكل بصمة — فيلزم سقفٌ عام.
test('وانفجارُ بصماتٍ متمايزة يصطدم بسقفٍ عام', async () => {
  const before = (await db.all('SELECT COUNT(*) n FROM error_event'))[0].n;
  for (let i = 0; i < 400; i++) {
    const e = new Error('فريد');
    e.stack = `Error: فريد\n    at fn${i} (src/modules/x${i}.js:1:1)`;
    cap.captureHttpError(e, REQ(), 500);
  }
  await cap.flushCaptures();
  const after = (await db.all('SELECT COUNT(*) n FROM error_event'))[0].n;
  assert.ok(after - before <= 50, `كُتبت ${after - before} مجموعة في دفعة — لا سقف عام`);
});

test('ورتبةُ من أصابه العطب تُحفَظ بأعلاها — لا بآخر من أصابه', async () => {
  const e = new Error('أصابت قيادة');
  cap.captureHttpError(e, REQ({ ctx: { user: { username: 'أ', role_id: 'employee' } } }), 500);
  await cap.flushCaptures();
  cap.captureHttpError(e, REQ({ ctx: { user: { username: 'ب', role_id: 'sector_lead' } } }), 500);
  await cap.flushCaptures();
  cap.captureHttpError(e, REQ({ ctx: { user: { username: 'ج', role_id: 'employee' } } }), 500);
  await cap.flushCaptures();
  const r = (await db.all("SELECT top_role_rank, last_user FROM error_event WHERE message = 'أصابت قيادة'"))[0];
  assert.equal(r.top_role_rank, 2, 'هبطت الرتبة بعد أن أصاب العطبُ موظفاً بعد القائد');
  assert.equal(r.last_user, 'ج', 'آخر من أصابه لم يُحدَّث');
});

// ── قطعُ الحلقة: بنيوياً، لا بمهلة ──
test('عطبٌ من البريد يُحفَظ ويظهر — لكنه مَوسومٌ غيرَ قابلٍ للتنبيه', async () => {
  const e = new Error('عطب في قناة الإرسال');
  e.stack = 'Error\n    at send (src/core/mail/transport.js:70:5)';
  cap.captureHttpError(e, REQ(), 500);
  await cap.flushCaptures();
  const r = (await db.all("SELECT digestable FROM error_event WHERE message = 'عطب في قناة الإرسال'"))[0];
  assert.equal(r.digestable, 0, 'عطبُ البريد قابلٌ للتنبيه بالبريد — حلقةٌ لا تنتهي');
});

test('ومهمّةُ الطابور كذلك، وعطبُ منتَجٍ عاديٍّ يبقى قابلاً', async () => {
  cap.captureJobError('processQueue', new Error('فشل الطابور'));
  cap.captureJobError('fireDueSchedules', new Error('فشل الجدولة'));
  await cap.flushCaptures();
  const q = (await db.all("SELECT digestable FROM error_event WHERE message = 'فشل الطابور'"))[0];
  const s = (await db.all("SELECT digestable FROM error_event WHERE message = 'فشل الجدولة'"))[0];
  assert.equal(q.digestable, 0, 'مهمّة الطابور تُنبِّه بالبريد عن عطب البريد');
  assert.equal(s.digestable, 1, 'مهمّة عاديّة فقدت قابلية التنبيه');
});

// الالتقاط أداةٌ مساعدة: فشلُه لا يجوز أن يُسقط ما جاء يلتقطه.
test('والالتقاط لا يرمي مهما سُمِّم المُدخَل', async () => {
  const poisoned = { get message() { throw new Error('خاصية ترمي'); }, name: 'Weird' };
  const circular = new Error('دائري'); circular.self = circular;
  assert.doesNotThrow(() => cap.captureHttpError(poisoned, REQ(), 500));
  assert.doesNotThrow(() => cap.captureHttpError(circular, REQ(), 500));
  assert.doesNotThrow(() => cap.captureHttpError(null, undefined, 500));
  assert.doesNotThrow(() => cap.captureJobError('x', 'نصّ لا كائن'));
  await cap.flushCaptures();
});

test('والكنس يحترم المهلة، ولا يحذف بمهلةٍ مقلوبة', async () => {
  await db.run(`INSERT INTO error_event (fingerprint, kind, hits, first_at, last_at)
    VALUES ('old_one', 'http', 1, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`);
  const { removed } = await store.purgeFaults({ keepDays: 30 });
  assert.ok(removed >= 1, 'لم يُكنَس الصفّ القديم');
  assert.equal((await db.all("SELECT COUNT(*) n FROM error_event WHERE fingerprint = 'old_one'"))[0].n, 0);
  // مهلةٌ سالبة تعني قطعاً في المستقبل — تحذف كل شيء. الحارس يمنعها.
  const n0 = (await db.all('SELECT COUNT(*) n FROM error_event'))[0].n;
  await store.purgeFaults({ keepDays: -5 });
  assert.equal((await db.all('SELECT COUNT(*) n FROM error_event'))[0].n, n0, 'مهلةٌ مقلوبة أفرغت الجدول');
});

test('والقراءة تُرتّب بالرتبة ثم بالأحدث، والمُسكَت في الآخر', async () => {
  const groups = await store.faultGroups({ limit: 100 });
  assert.ok(groups.length > 0);
  const senior = groups.findIndex((g) => g.top_role_rank >= 2);
  assert.ok(senior === 0 || senior === -1, 'ما أصاب قيادةً ليس في الصدارة');
  const stats = await store.faultStats();
  assert.ok(stats.groups > 0 && stats.hits > 0, 'الإحصاء فارغ رغم وجود صفوف');
});
