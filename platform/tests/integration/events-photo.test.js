// «الفعاليات» E2 — صورة البطاقة ورموز الكشك: بايتاتٌ في القاعدة تُقبل بحقيقتها لا بترويستها.
//
// ما يحرسه هذا الملف بترتيب أهميته:
//   ١) جولة البايتات كاملة: إرفاقٌ ⟵ قراءةٌ بالبايتات نفسها والبصمة نفسها — خدمةً، ثم عبر الشبكة
//      بترويسات التنزيل الستّ و«لم تتغيّر» (٣٠٤) للمتصفّح العائد ببصمته.
//   ٢) الحقيقة من البايتات: ملفٌّ نصّي اسمه photo.jpg وترويسته image/jpeg يُردّ — الشمّ يحسم لا الاسم.
//   ٣) الإضافة إضافة لا استبدال (v5.67، الترحيلة ٠٤١): الصورة الثانية تنضمّ ولا تمحو، والغلاف
//      يبقى أقدمَها، والصورة نفسها مرةً ثانية لا تكتب ولا تُؤثّر. (وتفصيلُ القائمة في
//      events-photos-multi.test.js — وهذا الملف يحرس أن جولة البايتات لم تنكسر بها.)
//   ٤) الحُرّاس: من يحمل منح تعديل البطاقات يُرفق صورتها؛ رموز الكشك لمن يدير الفعالية؛ والقراءة لكل قارئ.
//   ٥) المحو الفعلي: حذفُ البطاقة يمحو صورتها، وحذفُ الفعالية يمحو كل صورها ورموزها.
//   ٦) الحدّ فوق ٨ ميغابايت يُردّ بالعربية على الطبقتين: الخدمة، والقارئ الخام في المسار (٤١٣ ⟵ ٤٠٠) —
//      وكذا كل تعثّرٍ في الاستلام (ترميزٌ مضغوط أو مجهول: ٤١٥ ⟵ ٤٠٠ بالعربية بلا كلمةٍ تقنية).
//   ٧) التخزين: «خاصّ، راجِع كل مرة» مع Vary: Cookie — وحين يجدّد وسيط الجلسة الكعكة على ردّ الصورة
//      نفسه يبقى «لا يُخزَّن» الذي وضعه؛ فلا كعكةَ موظّفٍ في ذاكرة وسيطٍ مشترك.
//   ٨) السقوف: رموز الجناح لكل فعالية، وميزانية اليوم لكل حساب ملفّاتٍ وبايتات — بالعربية وقبل الكتابة.
//   ٩) النصّ: القصّ بالحرف لا بوحدة UTF-16، والمحارف الضابطة تُنزَع؛ واسم التنزيل بصيغة UTF-8 بلا !'()* حرفية.
// الخدمات تُنادى مباشرةً (كما في events.test.js)، والمسارات عبر التطبيق الحقيقي بلا تطعيم
// (كما في api-mount.test.js) — فالبايتات لا تُختبر إلا حين تعبر الشبكة فعلاً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'sanad-evphoto-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, ev, server, base;
const T = new Date().toISOString();
const TODAY = T.slice(0, 10);
const user = (id, role, extra = {}) => ({
  id, username: id.replace(/^u_/, ''), role_id: role, sector_id: 'SOL', scope: 'own',
  projectIds: new Set(), teamIds: new Set(), ...extra,
});
const LEAD = user('u_lead', 'sector_lead', { name_ar: 'قائد القطاع', scope: 'sector' });
const SARA = user('u_sara', 'consultant', { name_ar: 'سارة' });
const KHALID = user('u_khalid', 'consultant', { name_ar: 'خالد' });
const VIEWER = user('u_viewer', 'viewer', { name_ar: 'مشاهد', scope: 'sector' });
const EXT = user('u_ext', 'external', { name_ar: 'زائر', sector_id: null });
const CTX = (u) => ({ user: u, ip: '127.0.0.1' });
const sha = (b) => createHash('sha256').update(b).digest('hex');

// صورٌ حقيقية التوقيع بحجم الاختبار: JPEG بترويسة JFIF وحشوٍ وخاتمة، وPNG ١×١ كامل، وWEBP برأس RIFF.
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(3000, 0x5A), Buffer.from([0xFF, 0xD9])]);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1A, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 '), Buffer.alloc(18, 0x11)]);
const TEXT = Buffer.from('هذا ملفٌّ نصّي اسمه photo.jpg وليس صورة — الترويسة تقول صورة والبايتات تقول لا');
// فوق الحدّ ببايتٍ واحد، وبتوقيع JPEG صحيح — فالرفض للحجم لا للصيغة.
const HUGE = Buffer.concat([JPEG.subarray(0, 4), Buffer.alloc(8 * 1024 * 1024 + 1 - 4)]);

let EV1, C_SARA, C_KHALID, Q1, Q2;
const n = async (sql, p = []) => Number((await db.get(sql, p)).n);
const blobs = (where = '', p = []) => n(`SELECT COUNT(*) AS n FROM event_blob ${where}`, p);
const audits = (action, resource, rid) => n('SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND resource = ? AND resource_id = ?', [action, resource, rid]);
const cardOf = (cid) => `/api/events/contacts/${cid}/photo`;
// ينتظر حتى تتقدّم الساعة بملّي ثانية: ترتيب الرموز بوقت إضافتها، والمعرّفات عشوائية لا تُرتِّب.
const tick = async () => { const t = Date.now(); while (Date.now() === t) await new Promise((r) => setTimeout(r, 1)); };

// جلبٌ يقرأ الجسد دائماً بايتاتٍ (صورةً أو حمولةً) — تركه غير مقروء يُبقي مقبساً معلّقاً يُسقط التفكيك.
async function http(path, { method = 'GET', as = 'sara', body, headers = {} } = {}) {
  const h = { ...headers };
  if (as) h.cookie = 'sanad_sid=sess_' + as + '; sanad_csrf=t'; // كما يفعل المتصفّح: يحمل كعكة الحماية من صفحة الدخول، فلا يسكّها الوسيط على ردّ الصورة
  const r = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { /* بايتات لا حمولة */ }
  return { status: r.status, headers: r.headers, buf, json };
}

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ev = await import('../../src/modules/events/events.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  for (const u of [LEAD, SARA, KHALID, VIEWER, EXT]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
    await db.insert('session', { id: 'sess_' + u.username, user_id: u.id, created_at: T,
      expires_at: new Date(Date.now() + 86400000).toISOString() });
  }
  EV1 = await ev.createEvent(CTX(LEAD), { name_ar: 'معرض الصور', venue: 'الرياض', starts_on: TODAY, ends_on: TODAY });
  C_SARA = (await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعريف بالشركة', person_name: 'أحمد العلي', org_name: 'شركة النخبة', phone: '0501234567', sector_id: 'SOL' })).contact;
  C_KHALID = (await ev.createContact(CTX(KHALID), EV1.id, { kind: 'شراكة', person_name: 'نورة السالم', phone: '0559876543' })).contact;
  // **بلا تطعيم**: التطبيق كما يُقلع في الإنتاج — فالمسارات تُختبر مركَّبةً لا معزولة.
  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (ev) Object.assign(ev.UPLOAD_LIMITS, { qrPerEvent: 12, photosPerCard: 6, dailyFiles: 300, dailyBytes: 500 * 1024 * 1024 });
  server?.closeAllConnections?.();
  if (server) await new Promise((res) => server.close(res));
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ── الترحيلة ──────────────────────────────────────────────────────────────────
test('الترحيلة ٠٣٩ مطبَّقة مرة واحدة، وملفها بلا علامة استفهام لاتينية ولا «IF NOT EXISTS» على العمود — والعمود موجود', async () => {
  const applied = await db.all("SELECT version FROM schema_migration WHERE version = '039_event_blob_title.sql'");
  assert.equal(applied.length, 1, 'الترحيلة لم تُسجَّل مرة واحدة بالضبط');
  const sql = readFileSync(join(ROOT, 'migrations/039_event_blob_title.sql'), 'utf8');
  assert.ok(!sql.includes('?'), 'علامة استفهام لاتينية في الترحيلة — تُفسد الربط على Postgres');
  const code = sql.replace(/--[^\n]*/g, '');
  assert.match(code, /ALTER\s+TABLE\s+event_blob\s+ADD\s+COLUMN\s+title\s+TEXT/i);
  assert.ok(!/IF NOT EXISTS/i.test(code), '«ADD COLUMN IF NOT EXISTS» لا تعرفها سكويلايت');
  const cols = (await db.all('PRAGMA table_info(event_blob)')).map((c) => c.name);
  assert.ok(cols.includes('title'), 'عمود العنوان غائب عن جدول الصور');
});

// ── الشمّ ─────────────────────────────────────────────────────────────────────
test('النوع من البايتات لا من الاسم: JPEG وPNG وWEBP تُعرف بتوقيعها، وما سواها ليس صورة', () => {
  assert.equal(ev.sniffImageMime(JPEG), 'image/jpeg');
  assert.equal(ev.sniffImageMime(PNG), 'image/png');
  assert.equal(ev.sniffImageMime(WEBP), 'image/webp');
  assert.equal(ev.sniffImageMime(new Uint8Array(PNG)), 'image/png', 'ما يعيده سكويلايت (Uint8Array) يُشمّ كالبَفر');
  for (const bad of [TEXT, Buffer.from('GIF89a......'), Buffer.from('RIFF....WAVEfmt '), Buffer.alloc(0), Buffer.from([0xFF, 0xD8]),
    Buffer.from('%PDF-1.4 ......'), null, undefined, 'FFD8FF', 42, {}]) {
    assert.equal(ev.sniffImageMime(bad), null, `قُبل توقيعٌ ليس صورة: ${String(bad).slice(0, 12)}`);
  }
  assert.equal(ev.PHOTO_MAX_BYTES, 8 * 1024 * 1024);
  assert.match(ev.PHOTO_TOO_LARGE_MESSAGE, /8 ميغابايت/);
  assert.equal(ev.imageExt('image/jpeg'), 'jpg');
  assert.equal(ev.imageExt('image/webp'), 'webp');
});

// ── الإرفاق والقراءة ──────────────────────────────────────────────────────────
test('الإرفاق: صورة JPEG تُحفظ بايتاتٍ وبصمةً وتعود بحقيقتها ورابطها — والقوائم تحمل العلامة والبصمة لا البايتات', async () => {
  const r = await ev.attachContactPhoto(CTX(SARA), C_SARA.id, JPEG, { fileName: 'IMG_0001.jpg' });
  assert.match(r.id, /^evb_/);
  assert.deepEqual(r, { ok: true, id: r.id, sha256: sha(JPEG), size_bytes: JPEG.length, mime: 'image/jpeg', added: true,
    photo_count: 1, photo_url: cardOf(C_SARA.id) + '?v=' + sha(JPEG).slice(0, 12),
    url: `/api/events/contacts/${C_SARA.id}/photos/${r.id}` });
  const p = await ev.readContactPhoto(SARA, C_SARA.id);
  assert.ok(Buffer.isBuffer(p.content), 'المحتوى ليس بَفراً');
  assert.equal(Buffer.compare(p.content, JPEG), 0, 'البايتات المقروءة ليست هي المرفوعة');
  assert.deepEqual([p.mime, p.sha256, p.size_bytes], ['image/jpeg', sha(JPEG), JPEG.length]);
  const row = await db.get(`SELECT event_id, kind, ref_id, title, uploaded_by, size_bytes, sha256 FROM event_blob WHERE kind = 'card' AND ref_id = ?`, [C_SARA.id]);
  assert.deepEqual([row.event_id, row.title, row.uploaded_by, Number(row.size_bytes), row.sha256], [EV1.id, null, SARA.id, JPEG.length, sha(JPEG)]);
  const a = await db.get("SELECT user_id, sector_id, detail_json FROM audit_log WHERE action = 'photo' AND resource = 'event_contact' AND resource_id = ?", [C_SARA.id]);
  assert.ok(a, 'الإرفاق بلا أثر');
  assert.equal(a.user_id, SARA.id);
  assert.equal(a.sector_id, 'SOL');
  const d = JSON.parse(a.detail_json);
  assert.deepEqual([d.event_id, d.size_bytes, d.mime, d.added, d.blob_id, d.photo_count, d.file_name],
    [EV1.id, JPEG.length, 'image/jpeg', true, r.id, 1, 'IMG_0001.jpg']);
  const rows = await ev.listContacts(SARA, EV1.id, {});
  const mine = rows.find((c) => c.id === C_SARA.id);
  const other = rows.find((c) => c.id === C_KHALID.id);
  assert.deepEqual([mine.has_photo, mine.photo_sha, mine.photo_count], [1, sha(JPEG), 1]);
  assert.deepEqual([other.has_photo, other.photo_sha, other.photo_count], [0, null, 0]);
  assert.ok(rows.every((c) => !('content' in c)), 'القائمة تحمل البايتات');
  assert.equal((await ev.recentContacts(SARA, EV1.id, {})).rows.find((c) => c.id === C_SARA.id).photo_sha, sha(JPEG));
  assert.equal((await ev.getContact(VIEWER, C_SARA.id)).photo_sha, sha(JPEG));
});

test('الصورة نفسها مرةً ثانية (إعادة إرسال): لا كتابة ولا أثر — وadded يقول لا، ومعرّف الصفّ القائم يعود', async () => {
  const before = await audits('photo', 'event_contact', C_SARA.id);
  const have = await db.get(`SELECT id FROM event_blob WHERE kind = 'card' AND ref_id = ?`, [C_SARA.id]);
  const r = await ev.attachContactPhoto(CTX(SARA), C_SARA.id, Buffer.from(JPEG));
  assert.equal(r.added, false);
  assert.equal(r.sha256, sha(JPEG));
  assert.equal(r.id, have.id, 'إعادة الإرسال لم تعد بمعرّف الصفّ القائم');
  assert.equal(r.photo_count, 1);
  assert.equal(await audits('photo', 'event_contact', C_SARA.id), before, 'إعادة الإرسال كتبت أثراً');
  assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [C_SARA.id]), 1);
});

test('صورةٌ مختلفة تُضاف ولا تستبدل: صفّان، والغلاف يبقى الأقدم ورابطه ثابت، وأثرٌ يقول أُضيفت', async () => {
  const before = await audits('photo', 'event_contact', C_SARA.id);
  await tick();
  const r = await ev.attachContactPhoto(CTX(SARA), C_SARA.id, PNG, { fileName: 'card.png' });
  assert.deepEqual([r.added, r.mime, r.sha256, r.size_bytes, r.photo_count], [true, 'image/png', sha(PNG), PNG.length, 2]);
  assert.equal(r.photo_url, cardOf(C_SARA.id) + '?v=' + sha(JPEG).slice(0, 12), 'الغلاف تغيّر بالإضافة');
  assert.equal(r.url, `/api/events/contacts/${C_SARA.id}/photos/${r.id}`);
  assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [C_SARA.id]), 2, 'الإضافة محت ما قبلها');
  // الغلاف الأولى، والثانية تُقرأ بمعرّفها.
  const cover = await ev.readContactPhoto(SARA, C_SARA.id);
  assert.equal(Buffer.compare(cover.content, JPEG), 0, 'الغلاف ليس أقدم الصور');
  assert.equal(cover.mime, 'image/jpeg');
  const second = await ev.readContactPhoto(SARA, C_SARA.id, r.id);
  assert.equal(Buffer.compare(second.content, PNG), 0);
  assert.equal(second.mime, 'image/png');
  assert.equal(await audits('photo', 'event_contact', C_SARA.id), before + 1);
  const a = await db.get("SELECT detail_json FROM audit_log WHERE action = 'photo' AND resource_id = ? ORDER BY at DESC LIMIT 1", [C_SARA.id]);
  assert.deepEqual([JSON.parse(a.detail_json).added, JSON.parse(a.detail_json).photo_count], [true, 2]);
  const c = await ev.getContact(SARA, C_SARA.id);
  assert.equal(c.photo_sha, sha(JPEG), 'بصمة الصفّ ليست بصمة الغلاف');
  assert.equal(c.photo_count, 2);
  assert.deepEqual(c.photos.map((p) => p.sha256), [sha(JPEG), sha(PNG)]);
});

test('الممنوع يُردّ بالعربية قبل أي كتابة: فارغة، وبلا جسم، وفوق ٨ ميغابايت، وملفٌّ نصّي اسمه photo.jpg', async () => {
  const before = [await blobs(), await n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'photo'")];
  for (const [bytes, re, label] of [
    [Buffer.alloc(0), /فارغة — أعد الالتقاط/, 'فارغة'],
    [undefined, /فارغة/, 'بلا جسم'],
    ['ليست بايتات', /فارغة/, 'نصٌّ لا بايتات'],
    [{ length: 5 }, /فارغة/, 'كائنٌ يدّعي طولاً'],
    [HUGE, /8 ميغابايت/, 'فوق الحدّ ببايت'],
    [TEXT, /غير مدعومة/, 'نصّ باسم صورة'],
    [Buffer.from('GIF89a......'), /غير مدعومة/, 'صيغة غير مدعومة'],
  ]) {
    await assert.rejects(() => ev.attachContactPhoto(CTX(SARA), C_SARA.id, bytes, { fileName: 'photo.jpg' }),
      (e) => e.status === 400 && re.test(e.message), `${label}: قُبلت أو رُدّت برسالة أخرى`);
  }
  assert.deepEqual([await blobs(), await n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'photo'")], before, 'الرفض كتب');
  assert.equal((await ev.readContactPhoto(SARA, C_SARA.id)).sha256, sha(JPEG), 'الرفض مسّ الغلاف القائم');
});

test('الحُرّاس (v5.67): الزميل يُرفق على بطاقة زميله، والمشاهد والخارجي يُرَدّان، والقراءة لكل قارئ — ولا صورة تعني ٤٠٤ بالعربية', async () => {
  await assert.rejects(() => ev.attachContactPhoto(CTX(VIEWER), C_SARA.id, WEBP),
    (e) => e.status === 403 && /ليس ضمن صلاحيتك/.test(e.message), 'المشاهد أرفق صورة');
  await assert.rejects(() => ev.attachContactPhoto(CTX(EXT), C_SARA.id, WEBP), (e) => e.status === 403 && /خارج صلاحياتك/.test(e.message));
  await assert.rejects(() => ev.readContactPhoto(EXT, C_SARA.id), (e) => e.status === 403);
  assert.equal((await ev.readContactPhoto(VIEWER, C_SARA.id)).sha256, sha(JPEG), 'المشاهد لا يقرأ الصورة');
  assert.equal((await ev.readContactPhoto(KHALID, C_SARA.id)).sha256, sha(JPEG), 'الزميل لا يقرأ الصورة');
  // الزميل يُرفق على بطاقة زميله — هذا ما تغيّر في v5.67 (البطاقة أمانة الفريق).
  await tick();
  const r = await ev.attachContactPhoto(CTX(KHALID), C_SARA.id, WEBP);
  assert.deepEqual([r.added, r.mime, r.photo_count], [true, 'image/webp', 3]);
  // وقائد القطاع يرسل الصورة نفسها بعده: تكرارٌ لا كتابة — ولا يسرق رفعَها من صاحبه.
  const dup = await ev.attachContactPhoto(CTX(LEAD), C_SARA.id, WEBP);
  assert.deepEqual([dup.added, dup.id, dup.photo_count], [false, r.id, 3]);
  const newest = await db.get(`SELECT uploaded_by FROM event_blob WHERE kind = 'card' AND ref_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`, [C_SARA.id]);
  assert.equal(newest.uploaded_by, KHALID.id, 'آخر صورةٍ ليست باسم من رفعها');
  await assert.rejects(() => ev.readContactPhoto(SARA, C_KHALID.id),
    (e) => e.status === 404 && /لا صورة لهذه البطاقة بعد/.test(e.message));
  await assert.rejects(() => ev.readContactPhoto(SARA, 'evc_nope'), (e) => e.status === 404 && /البطاقة غير موجودة/.test(e.message));
  await assert.rejects(() => ev.attachContactPhoto(CTX(SARA), 'evc_nope', JPEG), (e) => e.status === 404);
  assert.equal(await n('SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?', [VIEWER.id]), 0, 'المشاهد رُدّ وله أثر');
});

test('الفعالية المُغلقة تقبل صورةً على بطاقةٍ قائمة — ليست التقاطاً جديداً — والمحذوفة لا تقبل ولا تُقرأ', async () => {
  const E = await ev.createEvent(CTX(LEAD), { name_ar: 'فعالية تُغلق ثم تُحذف', starts_on: TODAY, ends_on: TODAY });
  const c = (await ev.createContact(CTX(SARA), E.id, { kind: 'تعاون', person_name: 'بطاقة قبل الإغلاق' })).contact;
  await ev.closeEvent(CTX(LEAD), E.id, {});
  assert.equal((await ev.attachContactPhoto(CTX(SARA), c.id, JPEG)).ok, true, 'الإغلاق منع صورة بطاقةٍ قائمة');
  assert.equal((await ev.readContactPhoto(SARA, c.id)).sha256, sha(JPEG));
  await ev.deleteEvent(CTX(LEAD), E.id);
  await assert.rejects(() => ev.attachContactPhoto(CTX(SARA), c.id, PNG), (e) => e.status === 404);
  await assert.rejects(() => ev.readContactPhoto(SARA, c.id), (e) => e.status === 404);
  assert.equal(await blobs('WHERE event_id = ?', [E.id]), 0, 'حذف الفعالية أبقى صورة');
});

// ── عبر الشبكة ────────────────────────────────────────────────────────────────
test('عبر الشبكة: التنزيل يعيد البايتات نفسها بالترويسات الستّ، والبصمة العائدة تُردّ بـ«لم تتغيّر»، وبلا جلسة ٤٠١', async () => {
  const r = await http(cardOf(C_SARA.id));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal(r.headers.get('content-length'), String(JPEG.length));
  assert.equal(r.headers.get('content-disposition'), `inline; filename="card-${C_SARA.id}.jpg"`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cache-control'), 'private, no-cache');
  assert.equal(r.headers.get('vary'), 'Cookie');
  assert.equal(r.headers.get('set-cookie'), null, 'الردّ العادي لا يحمل كعكة');
  assert.equal(r.headers.get('etag'), '"' + sha(JPEG) + '"');
  assert.equal(Buffer.compare(r.buf, JPEG), 0, 'البايتات النازلة ليست هي المحفوظة');
  const again = await http(cardOf(C_SARA.id), { headers: { 'if-none-match': r.headers.get('etag') } });
  assert.equal(again.status, 304);
  assert.equal(again.buf.length, 0, '«لم تتغيّر» حملت بايتات');
  assert.equal(again.headers.get('etag'), '"' + sha(JPEG) + '"');
  assert.equal(again.headers.get('cache-control'), 'private, no-cache', '«لم تتغيّر» بلا قاعدة تخزين');
  assert.equal(again.headers.get('vary'), 'Cookie');
  const stale = await http(cardOf(C_SARA.id), { headers: { 'if-none-match': '"' + sha(WEBP) + '"' } });
  assert.equal(stale.status, 200, 'بصمةُ صورةٍ أخرى على البطاقة نفسها رُدّت بـ«لم تتغيّر»');
  assert.equal((await http(cardOf(C_SARA.id), { as: 'viewer' })).status, 200);
  assert.equal((await http(cardOf(C_SARA.id), { as: 'ext' })).status, 403);
  const anon = await http(cardOf(C_SARA.id), { as: null });
  assert.equal(anon.status, 401);
  const none = await http(cardOf(C_KHALID.id));
  assert.equal(none.status, 404);
  assert.match(none.json.error.message, /لا صورة لهذه البطاقة/);
});

test('عبر الشبكة: حين يجدّد وسيط الجلسة الكعكة على ردّ الصورة نفسه يبقى «لا يُخزَّن» — والطلب التالي يعود إلى «خاصّ، راجِع»', async () => {
  // جلسةٌ آخر نشاطها قبل ساعتين ونافذتها تنتهي بعد ساعة: الطلب التالي يدحرجها ويُصدر كعكةً معه.
  const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
  const inAnHour = new Date(Date.now() + 3600000).toISOString();
  await db.run('UPDATE session SET last_seen_at = ?, expires_at = ? WHERE id = ?', [twoHoursAgo, inAnHour, 'sess_sara']);
  const rolled = await http(cardOf(C_SARA.id));
  assert.equal(rolled.status, 200);
  assert.match(rolled.headers.get('set-cookie') || '', /sanad_sid=/, 'الكعكة لم تُجدَّد — السيناريو لم يتحقّق');
  assert.equal(rolled.headers.get('cache-control'), 'no-store', 'ردٌّ يحمل كعكة جلسة صار قابلاً للتخزين');
  assert.equal(rolled.headers.get('vary'), 'Cookie');
  assert.equal(Buffer.compare(rolled.buf, JPEG), 0);
  // والبصمة العائدة على ردٍّ يجدّد الكعكة: ٣٠٤ و«لا يُخزَّن» أيضاً.
  await db.run('UPDATE session SET last_seen_at = ?, expires_at = ? WHERE id = ?', [twoHoursAgo, inAnHour, 'sess_sara']);
  const rolled304 = await http(cardOf(C_SARA.id), { headers: { 'if-none-match': '"' + sha(JPEG) + '"' } });
  assert.equal(rolled304.status, 304);
  assert.match(rolled304.headers.get('set-cookie') || '', /sanad_sid=/);
  assert.equal(rolled304.headers.get('cache-control'), 'no-store');
  // الطلب التالي بلا تجديد (خانق خمس الدقائق): يعود إلى «خاصّ، راجِع كل مرة».
  const next = await http(cardOf(C_SARA.id));
  assert.equal(next.status, 200);
  assert.equal(next.headers.get('set-cookie'), null);
  assert.equal(next.headers.get('cache-control'), 'private, no-cache');
  await db.run('UPDATE session SET last_seen_at = NULL, expires_at = ? WHERE id = ?', [new Date(Date.now() + 86400000).toISOString(), 'sess_sara']);
});

test('عبر الشبكة: الرفع جسمٌ خام باسمٍ مرمَّز، والنصّ بترويسة صورة يُردّ بالعربية، وفوق الحدّ ٤٠٠ بالعربية لا ٤١٣', async () => {
  const up = await http(cardOf(C_KHALID.id), { method: 'POST', as: 'khalid', body: JPEG,
    headers: { 'content-type': 'image/jpeg', 'x-file-name': encodeURIComponent('بطاقة خالد.jpg') } });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.deepEqual([up.json.ok, up.json.sha256, up.json.added, up.json.mime, up.json.photo_count], [true, sha(JPEG), true, 'image/jpeg', 1]);
  assert.equal(up.json.url, `/api/events/contacts/${C_KHALID.id}/photos/${up.json.id}`);
  const a = await db.get("SELECT detail_json FROM audit_log WHERE action = 'photo' AND resource_id = ? ORDER BY at DESC LIMIT 1", [C_KHALID.id]);
  assert.equal(JSON.parse(a.detail_json).file_name, 'بطاقة خالد.jpg', 'اسم الملف العربي لم يُفكّ');
  const down = await http(cardOf(C_KHALID.id), { as: 'khalid' });
  assert.equal(down.status, 200);
  assert.equal(Buffer.compare(down.buf, JPEG), 0);
  // application/octet-stream مقبولٌ أيضاً — والنوع الحقيقي من البايتات.
  await tick();
  const oct = await http(cardOf(C_KHALID.id), { method: 'POST', as: 'khalid', body: PNG, headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(oct.status, 200);
  assert.deepEqual([oct.json.added, oct.json.mime, oct.json.photo_count], [true, 'image/png', 2]);
  // ملفٌّ نصّي بترويسة image/jpeg واسم photo.jpg: الشمّ يحسم.
  const lie = await http(cardOf(C_KHALID.id), { method: 'POST', as: 'khalid', body: TEXT, headers: { 'content-type': 'image/jpeg', 'x-file-name': 'photo.jpg' } });
  assert.equal(lie.status, 400);
  assert.match(lie.json.error.message, /غير مدعومة/);
  // بلا جسم.
  const empty = await http(cardOf(C_KHALID.id), { method: 'POST', as: 'khalid', headers: { 'content-type': 'image/jpeg' } });
  assert.equal(empty.status, 400);
  assert.match(empty.json.error.message, /فارغة/);
  // تسعة ميغابايت: القارئ الخام يوقفها قبل القراءة، والردّ عربيٌّ برقم ٤٠٠ لا ٤١٣ ولا ٥٠٠.
  const huge = Buffer.concat([JPEG.subarray(0, 4), Buffer.alloc(9 * 1024 * 1024 - 4)]);
  const big = await http(cardOf(C_KHALID.id), { method: 'POST', as: 'khalid', body: huge, headers: { 'content-type': 'image/jpeg' } });
  assert.equal(big.status, 400, `الجسم الضخم رُدّ بـ${big.status}`);
  assert.match(big.json.error.message, /8 ميغابايت/);
  // الزميل يمرّ (v5.67) — وهذه صورة الغلاف نفسها فتُردّ تكراراً بلا كتابة؛ والمشاهد ٤٠٣،
  // وبلا جلسة ٤٠١ — وكلاهما قبل أي كتابة.
  const other = await http(cardOf(C_SARA.id), { method: 'POST', as: 'khalid', body: JPEG, headers: { 'content-type': 'image/jpeg' } });
  assert.equal(other.status, 200, JSON.stringify(other.json));
  assert.equal(other.json.added, false);
  const viewer = await http(cardOf(C_SARA.id), { method: 'POST', as: 'viewer', body: WEBP, headers: { 'content-type': 'image/webp' } });
  assert.equal(viewer.status, 403);
  assert.match(viewer.json.error.message, /ليس ضمن صلاحيتك/);
  const anon = await http(cardOf(C_KHALID.id), { method: 'POST', as: null, body: JPEG, headers: { 'content-type': 'image/jpeg' } });
  assert.equal(anon.status, 401);
  assert.equal((await ev.readContactPhoto(KHALID, C_KHALID.id)).sha256, sha(JPEG), 'رفضٌ كتب فوق الغلاف');
  assert.equal((await ev.readContactPhoto(SARA, C_SARA.id)).sha256, sha(JPEG));
});

test('عبر الشبكة: جسمٌ مضغوط أو بترميزٍ مجهول يُردّ ٤٠٠ بالعربية لا ٤١٥ بالإنجليزية — وبلا كلمةٍ تقنية في الردّ', async () => {
  const garbage = Buffer.from('ليس gzip ولا صورة — بايتات لا معنى لها \x1f\x8b\x00\x00');
  for (const enc of ['gzip', 'deflate', 'br', 'xyz']) {
    const r = await http(cardOf(C_KHALID.id), { method: 'POST', as: 'khalid', body: garbage,
      headers: { 'content-type': 'image/jpeg', 'content-encoding': enc } });
    assert.equal(r.status, 400, `${enc}: رُدّ بـ${r.status}`);
    assert.match(r.json.error.message, /تعذّر استلام الصورة — أعد الالتقاط/, `${enc}: رسالة أخرى`);
    assert.ok(!/encoding|unsupported|gzip/i.test(JSON.stringify(r.json)), `${enc}: كلمة تقنية في الردّ`);
  }
  const q = await http(`/api/events/${EV1.id}/qr`, { method: 'POST', as: 'lead', body: garbage,
    headers: { 'content-type': 'image/png', 'x-title': 'x', 'content-encoding': 'gzip' } });
  assert.equal(q.status, 400);
  assert.match(q.json.error.message, /تعذّر استلام الصورة/);
  assert.equal((await ev.readContactPhoto(KHALID, C_KHALID.id)).sha256, sha(JPEG), 'رفضُ الاستلام كتب فوق الغلاف');
  assert.equal(await blobs("WHERE kind = 'qr'"), 0, 'رفضُ الاستلام كتب رمزاً');
});

test('حذف البطاقة يمحو صورها كلها فعلاً', async () => {
  assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [C_KHALID.id]), 2);
  await ev.deleteContact(CTX(KHALID), C_KHALID.id);
  assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [C_KHALID.id]), 0, 'صورةٌ بقيت بلا بطاقة');
  await assert.rejects(() => ev.readContactPhoto(SARA, C_KHALID.id), (e) => e.status === 404);
  assert.equal((await http(cardOf(C_KHALID.id))).status, 404);
});

// ── رموز الكشك ────────────────────────────────────────────────────────────────
test('رموز الكشك: من يدير الفعالية يضيف، والاستشاري والمشاهد يُرَدّان، والعنوان شرط، والبايتات تُشمّ — والأثر يُكتب', async () => {
  await assert.rejects(() => ev.addQr(CTX(SARA), EV1.id, PNG, { title: 'رابط' }),
    (e) => e.status === 403 && e.message === 'إضافة رموز الكشك لقادة القطاعات ومدير النظام');
  await assert.rejects(() => ev.addQr(CTX(VIEWER), EV1.id, PNG, { title: 'رابط' }), (e) => e.status === 403);
  await assert.rejects(() => ev.addQr(CTX(EXT), EV1.id, PNG, { title: 'رابط' }), (e) => e.status === 403);
  await assert.rejects(() => ev.addQr(CTX(LEAD), EV1.id, PNG, {}), (e) => e.status === 400 && /اكتب عنوان الرمز/.test(e.message));
  await assert.rejects(() => ev.addQr(CTX(LEAD), EV1.id, PNG, { title: '   ' }), (e) => e.status === 400 && /عنوان الرمز/.test(e.message));
  await assert.rejects(() => ev.addQr(CTX(LEAD), EV1.id, TEXT, { title: 'رابط' }), (e) => e.status === 400 && /غير مدعومة/.test(e.message));
  await assert.rejects(() => ev.addQr(CTX(LEAD), EV1.id, Buffer.alloc(0), { title: 'رابط' }), (e) => e.status === 400 && /فارغة/.test(e.message));
  await assert.rejects(() => ev.addQr(CTX(LEAD), EV1.id, HUGE, { title: 'رابط' }), (e) => e.status === 400 && /8 ميغابايت/.test(e.message));
  await assert.rejects(() => ev.addQr(CTX(LEAD), 'evt_nope', PNG, { title: 'رابط' }), (e) => e.status === 404);
  assert.equal(await blobs("WHERE kind = 'qr'"), 0, 'رفضٌ كتب رمزاً');
  Q1 = await ev.addQr(CTX(LEAD), EV1.id, PNG, { title: 'امسح لتسجيل بياناتك', fileName: 'qr-register.png' });
  assert.match(Q1.id, /^evb_/);
  assert.deepEqual(Q1, { id: Q1.id, title: 'امسح لتسجيل بياناتك', mime: 'image/png', size_bytes: PNG.length, url: `/api/events/${EV1.id}/qr/${Q1.id}` });
  await tick();
  Q2 = await ev.addQr(CTX(LEAD), EV1.id, JPEG, { title: 'م'.repeat(200) });
  assert.equal(Q2.title.length, 120, 'العنوان لا يُقصّ على مئة وعشرين');
  const row = await db.get('SELECT kind, ref_id, title, event_id, uploaded_by FROM event_blob WHERE id = ?', [Q1.id]);
  assert.deepEqual([row.kind, row.ref_id, row.title, row.event_id, row.uploaded_by], ['qr', Q1.id, 'امسح لتسجيل بياناتك', EV1.id, LEAD.id]);
  const a = await db.get("SELECT user_id, detail_json FROM audit_log WHERE action = 'create' AND resource = 'event_blob' AND resource_id = ?", [Q1.id]);
  assert.ok(a, 'إضافة الرمز بلا أثر');
  assert.equal(a.user_id, LEAD.id);
  const d = JSON.parse(a.detail_json);
  assert.deepEqual([d.event_id, d.kind, d.title, d.file_name], [EV1.id, 'qr', 'امسح لتسجيل بياناتك', 'qr-register.png']);
});

test('قائمة الرموز بترتيب إضافتها لكل قارئ، وقراءة الرمز بايتاتٍ وعنواناً — ورمزٌ من فعاليةٍ أخرى أو معرّفُ صورة بطاقة: غير موجود', async () => {
  const list = await ev.listQr(VIEWER, EV1.id);
  assert.deepEqual(list.map((q) => q.id), [Q1.id, Q2.id], 'الترتيب ليس ترتيب الإضافة');
  assert.deepEqual(Object.keys(list[0]).sort(), ['created_at', 'id', 'mime', 'size_bytes', 'title', 'uploaded_by']);
  assert.deepEqual([list[0].size_bytes, list[0].uploaded_by, list[0].title], [PNG.length, LEAD.id, 'امسح لتسجيل بياناتك']);
  const q = await ev.readQr(SARA, EV1.id, Q1.id);
  assert.ok(Buffer.isBuffer(q.content));
  assert.equal(Buffer.compare(q.content, PNG), 0);
  assert.deepEqual([q.title, q.sha256, q.mime, q.size_bytes], ['امسح لتسجيل بياناتك', sha(PNG), 'image/png', PNG.length]);
  await assert.rejects(() => ev.readQr(EXT, EV1.id, Q1.id), (e) => e.status === 403);
  await assert.rejects(() => ev.listQr(EXT, EV1.id), (e) => e.status === 403);
  const E = await ev.createEvent(CTX(LEAD), { name_ar: 'فعالية أخرى', starts_on: TODAY, ends_on: TODAY });
  await assert.rejects(() => ev.readQr(SARA, E.id, Q1.id), (e) => e.status === 404 && /الرمز غير موجود/.test(e.message), 'رمزُ فعاليةٍ قُرئ من أخرى');
  const card = await db.get(`SELECT id FROM event_blob WHERE kind = 'card' AND ref_id = ?`, [C_SARA.id]);
  await assert.rejects(() => ev.readQr(SARA, EV1.id, card.id), (e) => e.status === 404, 'صورةُ بطاقة قُرئت رمزاً');
  await assert.rejects(() => ev.readQr(SARA, EV1.id, 'evb_nope'), (e) => e.status === 404);
  await assert.rejects(() => ev.deleteQr(CTX(LEAD), E.id, Q1.id), (e) => e.status === 404, 'رمزُ فعاليةٍ حُذف من أخرى');
  assert.deepEqual(await ev.listQr(SARA, E.id), []);
  await ev.deleteEvent(CTX(LEAD), E.id);
  await assert.rejects(() => ev.listQr(SARA, E.id), (e) => e.status === 404);
});

test('عبر الشبكة: الرموز تُقرأ قائمةً وبايتاتٍ باسمٍ عربي مرمَّز، وتُضاف بعنوانٍ من الترويسة، وتُحذف — والضخم ٤٠٠ بالعربية', async () => {
  const list = await http(`/api/events/${EV1.id}/qr`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.map((q) => q.id), [Q1.id, Q2.id]);
  const r = await http(`/api/events/${EV1.id}/qr/${Q1.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('content-length'), String(PNG.length));
  assert.equal(r.headers.get('content-disposition'), `inline; filename="qr-${Q1.id}.png"; filename*=UTF-8''${encodeURIComponent('امسح لتسجيل بياناتك')}.png`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cache-control'), 'private, no-cache');
  assert.equal(r.headers.get('vary'), 'Cookie');
  assert.equal(r.headers.get('etag'), '"' + sha(PNG) + '"');
  assert.equal(Buffer.compare(r.buf, PNG), 0);
  assert.equal((await http(`/api/events/${EV1.id}/qr/${Q1.id}`, { headers: { 'if-none-match': '"' + sha(PNG) + '"' } })).status, 304);
  assert.equal((await http(`/api/events/${EV1.id}/qr/${Q1.id}`, { as: null })).status, 401);
  assert.equal((await http(`/api/events/${EV1.id}/qr/${Q1.id}`, { as: 'ext' })).status, 403);
  // إضافة عبر الشبكة: العنوان في ترويسة مرمَّزة — عربيٌّ ولاتيني (فيصير اسمُ الملف من عنوانه).
  const add = await http(`/api/events/${EV1.id}/qr`, { method: 'POST', as: 'lead', body: WEBP,
    headers: { 'content-type': 'image/webp', 'x-title': encodeURIComponent('ملف الشركة'), 'x-file-name': encodeURIComponent('ملف.webp') } });
  assert.equal(add.status, 200, JSON.stringify(add.json));
  assert.deepEqual([add.json.title, add.json.mime, add.json.size_bytes, add.json.url], ['ملف الشركة', 'image/webp', WEBP.length, `/api/events/${EV1.id}/qr/${add.json.id}`]);
  const latin = await http(`/api/events/${EV1.id}/qr`, { method: 'POST', as: 'lead', body: JPEG,
    headers: { 'content-type': 'image/jpeg', 'x-title': 'Company Profile 2026' } });
  assert.equal(latin.status, 200);
  const dl = await http(latin.json.url);
  assert.equal(dl.headers.get('content-disposition'), `inline; filename="company-profile-2026.jpg"; filename*=UTF-8''${encodeURIComponent('Company Profile 2026')}.jpg`);
  const noTitle = await http(`/api/events/${EV1.id}/qr`, { method: 'POST', as: 'lead', body: WEBP, headers: { 'content-type': 'image/webp' } });
  assert.equal(noTitle.status, 400);
  assert.match(noTitle.json.error.message, /عنوان الرمز/);
  const sara = await http(`/api/events/${EV1.id}/qr`, { method: 'POST', as: 'sara', body: WEBP, headers: { 'content-type': 'image/webp', 'x-title': 'x' } });
  assert.equal(sara.status, 403);
  assert.match(sara.json.error.message, /رموز الكشك/);
  const huge = Buffer.concat([JPEG.subarray(0, 4), Buffer.alloc(9 * 1024 * 1024 - 4)]);
  const big = await http(`/api/events/${EV1.id}/qr`, { method: 'POST', as: 'lead', body: huge, headers: { 'content-type': 'image/jpeg', 'x-title': 'x' } });
  assert.equal(big.status, 400, `الجسم الضخم رُدّ بـ${big.status}`);
  assert.match(big.json.error.message, /8 ميغابايت/);
  // الحذف عبر الشبكة: الاستشاري يُرَدّ، وقائد القطاع يحذف فيغيب الرمز.
  assert.equal((await http(`/api/events/${EV1.id}/qr/${add.json.id}`, { method: 'DELETE', as: 'sara' })).status, 403);
  const del = await http(`/api/events/${EV1.id}/qr/${add.json.id}`, { method: 'DELETE', as: 'lead' });
  assert.equal(del.status, 200);
  assert.deepEqual(del.json, { ok: true });
  assert.equal((await http(`/api/events/${EV1.id}/qr/${add.json.id}`)).status, 404);
  await ev.deleteQr(CTX(LEAD), EV1.id, latin.json.id);
  assert.deepEqual((await ev.listQr(SARA, EV1.id)).map((q) => q.id), [Q1.id, Q2.id]);
});

test('حذف الرمز قاطعٌ ولمن يدير الفعالية — والمُغلقة تعرض رموزها ولا تقبل جديداً', async () => {
  await assert.rejects(() => ev.deleteQr(CTX(SARA), EV1.id, Q2.id), (e) => e.status === 403 && /حذف رموز الكشك/.test(e.message));
  await assert.rejects(() => ev.deleteQr(CTX(VIEWER), EV1.id, Q2.id), (e) => e.status === 403);
  assert.equal(await blobs('WHERE id = ?', [Q2.id]), 1, 'الرفض حذف');
  assert.deepEqual(await ev.deleteQr(CTX(LEAD), EV1.id, Q2.id), { ok: true });
  assert.equal(await blobs('WHERE id = ?', [Q2.id]), 0, 'الحذف ناعمٌ لا قاطع');
  const a = await db.get("SELECT user_id, detail_json FROM audit_log WHERE action = 'delete' AND resource = 'event_blob' AND resource_id = ?", [Q2.id]);
  assert.ok(a, 'حذف الرمز بلا أثر');
  assert.equal(a.user_id, LEAD.id);
  assert.equal(JSON.parse(a.detail_json).kind, 'qr');
  await assert.rejects(() => ev.deleteQr(CTX(LEAD), EV1.id, Q2.id), (e) => e.status === 404);
  await ev.closeEvent(CTX(LEAD), EV1.id, {});
  await assert.rejects(() => ev.addQr(CTX(LEAD), EV1.id, PNG, { title: 'بعد الإغلاق' }), (e) => e.status === 400 && /مُغلقة/.test(e.message));
  assert.deepEqual((await ev.listQr(SARA, EV1.id)).map((q) => q.id), [Q1.id], 'المُغلقة أخفت رموزها');
  assert.equal((await ev.readQr(SARA, EV1.id, Q1.id)).sha256, sha(PNG));
  assert.equal((await http(`/api/events/${EV1.id}/qr/${Q1.id}`)).status, 200);
  assert.equal((await http(cardOf(C_SARA.id))).status, 200, 'المُغلقة أخفت صور بطاقاتها');
  await ev.closeEvent(CTX(LEAD), EV1.id, { reopen: true });
});

test("اسم التنزيل بصيغة UTF-8: الفاصلة العليا والأقواس والنجمة تُرمَّز — لا تصل حرفيةً بعد UTF-8''", async () => {
  const q = await ev.addQr(CTX(LEAD), EV1.id, PNG, { title: "it's (a) *test!" });
  const r = await http(`/api/events/${EV1.id}/qr/${q.id}`);
  assert.equal(r.status, 200);
  const cd = r.headers.get('content-disposition');
  const star = cd.split("filename*=UTF-8''")[1];
  assert.ok(star, 'لا اسم بصيغة UTF-8 في الترويسة');
  assert.ok(!/[!'()*]/.test(star), `محارف حرفية في الاسم: ${star}`);
  assert.equal(star, 'it%27s%20%28a%29%20%2Atest%21.png');
  assert.equal(decodeURIComponent(star), "it's (a) *test!.png");
  assert.match(cd, /^inline; filename="it-s-a-test\.png"; /);
  await ev.deleteQr(CTX(LEAD), EV1.id, q.id);
});

test('عنوان الرمز يُقصّ بالحرف لا بوحدة UTF-16: رمزٌ تعبيري في الحرف المئة والعشرين يبقى كاملاً — والمحارف الضابطة تُنزَع من العنوان واسم الملف', async () => {
  const E = await ev.createEvent(CTX(LEAD), { name_ar: 'فعالية العناوين', starts_on: TODAY, ends_on: TODAY });
  const q = await ev.addQr(CTX(LEAD), E.id, PNG, { title: 'م'.repeat(119) + '😀' + 'زيادة' });
  assert.ok(q.title.isWellFormed(), 'نصفُ زوجٍ بديل في العنوان');
  assert.equal(Array.from(q.title).length, 120);
  assert.ok(q.title.endsWith('😀'), 'الرمز التعبيري شُطر أو سقط');
  assert.equal((await db.get('SELECT title FROM event_blob WHERE id = ?', [q.id])).title, q.title);
  assert.equal((await ev.readQr(SARA, E.id, q.id)).title, q.title);
  await tick();
  const q2 = await ev.addQr(CTX(LEAD), E.id, JPEG, { title: 'امسح\u0000 هنا\r\n  للتسجيل', fileName: 'qr\u0000\u001F.png' });
  assert.equal(q2.title, 'امسح هنا للتسجيل');
  const a = await db.get("SELECT detail_json FROM audit_log WHERE action = 'create' AND resource = 'event_blob' AND resource_id = ?", [q2.id]);
  assert.equal(JSON.parse(a.detail_json).file_name, 'qr.png');
  await ev.deleteEvent(CTX(LEAD), E.id);
});

test('سقف رموز الجناح: عند بلوغه يُردّ بالعربية قبل الكتابة، وحذفُ رمزٍ يفتح مكاناً — والحدّ يُخفَض في الاختبار ويُعاد', async () => {
  const E = await ev.createEvent(CTX(LEAD), { name_ar: 'جناحٌ يبلغ سقفه', starts_on: TODAY, ends_on: TODAY });
  const was = ev.UPLOAD_LIMITS.qrPerEvent;
  ev.UPLOAD_LIMITS.qrPerEvent = 2;
  try {
    const first = await ev.addQr(CTX(LEAD), E.id, PNG, { title: 'الأول' });
    await tick();
    await ev.addQr(CTX(LEAD), E.id, JPEG, { title: 'الثاني' });
    await assert.rejects(() => ev.addQr(CTX(LEAD), E.id, WEBP, { title: 'الثالث' }),
      (e) => e.status === 400 && /حدّ رموز الزوّار \(2\)/.test(e.message) && /احذف رمزاً/.test(e.message));
    assert.equal(await blobs("WHERE event_id = ? AND kind = 'qr'", [E.id]), 2, 'الرفض كتب');
    const r = await http(`/api/events/${E.id}/qr`, { method: 'POST', as: 'lead', body: WEBP, headers: { 'content-type': 'image/webp', 'x-title': 'x' } });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /حدّ رموز الزوّار/);
    await ev.deleteQr(CTX(LEAD), E.id, first.id);
    const third = await ev.addQr(CTX(LEAD), E.id, WEBP, { title: 'الثالث بعد الحذف' });
    assert.match(third.id, /^evb_/);
    assert.equal(await blobs("WHERE event_id = ? AND kind = 'qr'", [E.id]), 2);
  } finally { ev.UPLOAD_LIMITS.qrPerEvent = was; }
  assert.equal(ev.UPLOAD_LIMITS.qrPerEvent, 12);
  await ev.deleteEvent(CTX(LEAD), E.id);
});

test('ميزانية اليوم لكل حساب: الثالثة تُردّ بالعربية، وإعادةُ الصورة نفسها لا تُحتسب، وكل صورةٍ جديدة تُحتسب ولو على بطاقةٍ مصوَّرة، والبايتات تُحاسَب — ورمز الكشك بالميزانية نفسها', async () => {
  const DANA = user('u_dana', 'consultant', { name_ar: 'دانة' });
  await db.insert('app_user', { id: DANA.id, username: DANA.username, name_ar: DANA.name_ar, role_id: DANA.role_id,
    sector_id: DANA.sector_id, scope: DANA.scope, active: 1, created_at: T });
  await db.insert('session', { id: 'sess_dana', user_id: DANA.id, created_at: T, expires_at: new Date(Date.now() + 86400000).toISOString() });
  const E = await ev.createEvent(CTX(LEAD), { name_ar: 'فعالية الميزانية', starts_on: TODAY, ends_on: TODAY });
  const cards = [];
  for (const nm of ['الأولى', 'الثانية', 'الثالثة', 'الرابعة']) cards.push((await ev.createContact(CTX(DANA), E.id, { kind: 'تعاون', person_name: nm })).contact);
  const saved = { ...ev.UPLOAD_LIMITS };
  const mine = () => blobs('WHERE uploaded_by = ?', [DANA.id]);
  ev.UPLOAD_LIMITS.dailyFiles = 2;
  try {
    await ev.attachContactPhoto(CTX(DANA), cards[0].id, JPEG);
    await ev.attachContactPhoto(CTX(DANA), cards[1].id, PNG);
    const before = await audits('photo', 'event_contact', cards[2].id);
    await assert.rejects(() => ev.attachContactPhoto(CTX(DANA), cards[2].id, WEBP),
      (e) => e.status === 400 && /بلغ حسابك حدّ رفع الصور لليوم/.test(e.message) && /مدير النظام/.test(e.message));
    assert.equal(await mine(), 2, 'الرفض كتب');
    assert.equal(await audits('photo', 'event_contact', cards[2].id), before, 'الرفض ترك أثراً');
    // الصورة نفسها مرةً ثانية: لا كتابة ولا اصطدام بالميزانية.
    assert.equal((await ev.attachContactPhoto(CTX(DANA), cards[0].id, Buffer.from(JPEG))).added, false);
    // وصورةٌ ثانية على بطاقةٍ مصوَّرة: إضافةٌ صافية منذ v5.67 — تُحتسب ملفاً، فتُردّ عند السقف.
    await assert.rejects(() => ev.attachContactPhoto(CTX(DANA), cards[0].id, WEBP),
      (e) => e.status === 400 && /حدّ رفع الصور لليوم/.test(e.message), 'الإضافة على بطاقةٍ مصوَّرة لم تُحتسب');
    assert.equal(await mine(), 2, 'الرفض كتب');
    // وعبر الشبكة الرسالة نفسها.
    const r = await http(cardOf(cards[2].id), { method: 'POST', as: 'dana', body: PNG, headers: { 'content-type': 'image/png' } });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /حدّ رفع الصور لليوم/);
    // الحدّ بالبايتات: عدد الملفات دون السقف لكن ما تبقّى من الميزانية أقلّ من الصورة القادمة.
    const used = JPEG.length + PNG.length;   // ما رفعته دانة فعلاً: صورةٌ على الأولى وأخرى على الثانية
    ev.UPLOAD_LIMITS.dailyFiles = 300;
    ev.UPLOAD_LIMITS.dailyBytes = used + JPEG.length - 1;
    await assert.rejects(() => ev.attachContactPhoto(CTX(DANA), cards[2].id, JPEG), (e) => e.status === 400 && /لليوم/.test(e.message));
    ev.UPLOAD_LIMITS.dailyBytes = used + JPEG.length;
    assert.equal((await ev.attachContactPhoto(CTX(DANA), cards[2].id, JPEG)).ok, true, 'ما يملأ الميزانية تماماً يُقبل');
    assert.equal(await mine(), 3);
    await assert.rejects(() => ev.attachContactPhoto(CTX(DANA), cards[3].id, PNG), (e) => e.status === 400 && /لليوم/.test(e.message));
    // رمز الكشك يُحاسَب بميزانية رافعه: قائد القطاع عند سقفه يُردّ برسالة اليوم لا برسالة الجناح.
    ev.UPLOAD_LIMITS.dailyBytes = saved.dailyBytes;
    ev.UPLOAD_LIMITS.dailyFiles = await blobs('WHERE uploaded_by = ?', [LEAD.id]);
    await assert.rejects(() => ev.addQr(CTX(LEAD), E.id, PNG, { title: 'رمز فوق الميزانية' }),
      (e) => e.status === 400 && /حدّ رفع الصور لليوم/.test(e.message));
    assert.equal(await blobs("WHERE event_id = ? AND kind = 'qr'", [E.id]), 0, 'الرفض كتب رمزاً');
    ev.UPLOAD_LIMITS.dailyFiles = saved.dailyFiles;
    assert.ok((await ev.addQr(CTX(LEAD), E.id, PNG, { title: 'رمز ضمن الميزانية' })).id);
  } finally { Object.assign(ev.UPLOAD_LIMITS, saved); }
  assert.deepEqual(ev.UPLOAD_LIMITS, { qrPerEvent: 12, photosPerCard: 6, dailyFiles: 300, dailyBytes: 500 * 1024 * 1024 });
  await ev.deleteEvent(CTX(LEAD), E.id);
});

test('حذف الفعالية يمحو كل صورها ورموزها فعلاً — وصور الفعاليات الأخرى لا تُمسّ', async () => {
  const E = await ev.createEvent(CTX(LEAD), { name_ar: 'فعالية تُحذف بصورها', starts_on: TODAY, ends_on: TODAY });
  const c1 = (await ev.createContact(CTX(SARA), E.id, { kind: 'تعاون', person_name: 'الأولى' })).contact;
  const c2 = (await ev.createContact(CTX(KHALID), E.id, { kind: 'تعاون', person_name: 'الثانية' })).contact;
  await ev.attachContactPhoto(CTX(SARA), c1.id, JPEG);
  await ev.attachContactPhoto(CTX(KHALID), c2.id, PNG);
  await ev.addQr(CTX(LEAD), E.id, WEBP, { title: 'رمز يُحذف مع فعاليته' });
  assert.equal(await blobs('WHERE event_id = ?', [E.id]), 3);
  const others = await blobs('WHERE event_id <> ?', [E.id]);
  assert.ok(others >= 2, 'لا شهود في الفعاليات الأخرى');
  await assert.rejects(() => ev.deleteEvent(CTX(SARA), E.id), (e) => e.status === 403);
  assert.equal(await blobs('WHERE event_id = ?', [E.id]), 3, 'الرفض محا');
  await ev.deleteEvent(CTX(LEAD), E.id);
  assert.equal(await blobs('WHERE event_id = ?', [E.id]), 0, 'حذف الفعالية أبقى صوراً');
  assert.equal(await blobs('WHERE event_id <> ?', [E.id]), others, 'حذف الفعالية مسّ صور غيرها');
  assert.ok((await db.get('SELECT deleted_at FROM event WHERE id = ?', [E.id])).deleted_at, 'الفعالية حُذفت حذفاً صلباً');
});

test('كل كتابةٍ على الصور لها أثر — إرفاقاً وإضافةً وإنشاء رمز وحذفه — ولا أثر لمن رُدّ', async () => {
  assert.ok(await n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'photo' AND resource = 'event_contact'") >= 5);
  assert.ok(await n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'create' AND resource = 'event_blob'") >= 3);
  assert.ok(await n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'delete' AND resource = 'event_blob'") >= 2);
  for (const u of [VIEWER, EXT]) {
    assert.equal(await n('SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?', [u.id]), 0, `${u.role_id} لم يكتب شيئاً فلا يكون له أثر`);
  }
});
