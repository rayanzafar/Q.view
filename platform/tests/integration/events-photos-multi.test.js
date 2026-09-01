// «الفعاليات» v5.67 — البطاقة تحمل صوراً لا صورة (الترحيلة ٠٤١).
//
// الحادثة: في LEAP بطاقةٌ بوجهين — عربيٌّ وإنجليزي — ومعها كُتيّب. صوّر الملتقِط الوجه الأول ثم
// الثاني، فمحا الثاني الأول وهو لا يدري: الفهرس الفريد (kind, ref_id) كان يجعلها صفّاً واحداً.
//
// ما يحرسه هذا الملف بترتيب أهميته:
//   ١) الترحيلة ٠٤١: الفريد ذهب، وغيرُ الفريد جاء — وملفُها بلا علامة استفهام لاتينية ولا
//      تغييرٍ لبنية جدول، وعبارتاه اثنتان لا ثالثة لهما، وكلتاهما تُعاد بلا ضرر.
//   ٢) الإضافة إضافة: ثلاث صورٍ ثلاثةُ صفوف، والغلافُ أقدمُها فلا يتبدّل رابطُ المصغَّرة.
//   ٣) الصورة نفسها مرةً ثانية لا تكتب ولا تُؤثّر ولا تُحتسب — ويعود معرّفُ صفّها القائم.
//   ٤) السقف: ستٌّ لكل بطاقة، والرسالة عربيةٌ تقول «احذف واحدة» — وتسبق رسالةَ ميزانية اليوم
//      لأن الأولى في يد المستخدم والثانية ليست في يده.
//   ٥) القائمة بعقدها المعلن: الغلاف أولاً، واسمُ من رفع، وبلا بايتات — وحكمُ التعديل معها.
//   ٦) البايتات عبر الشبكة لكل صورةٍ بعينها: بصمتُها علامتَها، و«لم تتغيّر»، والتنزيل ملفاً —
//      ومعرّفُ صورةِ بطاقةٍ أخرى أو معرّفُ رمز كشكٍ لا يُقرأ من هنا (٤٠٤ بالعربية).
//   ٧) الحذف الواحد: الغلافُ يتولّاه ما بعده، وآخرُ صورةٍ تترك البطاقة بلا غلاف — وأثرٌ لكل حذف.
//   ٨) الحُرّاس (v5.67): كل من يحمل منح تعديل البطاقات يصحّح ويُرفق ويحذف صورةً — والمشاهد لا،
//      والخارجي لا. والقراءة لكل قارئ.
//   ٩) المحو مع البطاقة ومع الفعالية على العدد كلِّه، والعزل عن سجل العملاء وخطّ الفرص كما هو.
// الخدمات تُنادى مباشرةً، والبايتات عبر التطبيق الحقيقي بلا تطعيم (كما في events-photo.test.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'sanad-evmulti-'));
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

// صورٌ حقيقية التوقيع بحجم الاختبار: JPEG بترويسة JFIF، وPNG ١×١ كامل، وWEBP برأس RIFF —
// و«IMG(بذرة)» تولّد صوراً JPEG مختلفةَ البصمة للسقف وللحذف.
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(3000, 0x5A), Buffer.from([0xFF, 0xD9])]);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1A, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 '), Buffer.alloc(18, 0x11)]);
const IMG = (seed) => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]), Buffer.from('JFIF\0'),
  Buffer.alloc(300, seed), Buffer.from([0xFF, 0xD9])]);

let EV1, C1, C2, Q1, P1, P2, P3;
const n = async (sql, p = []) => Number((await db.get(sql, p)).n);
const blobs = (where = '', p = []) => n(`SELECT COUNT(*) AS n FROM event_blob ${where}`, p);
const audits = (action, resource, rid) => n('SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND resource = ? AND resource_id = ?', [action, resource, rid]);
const cardOf = (cid) => `/api/events/contacts/${cid}/photo`;
const photosOf = (cid) => `/api/events/contacts/${cid}/photos`;
// ينتظر حتى تتقدّم الساعة بملّي ثانية: ترتيب الصور بوقت رفعها، والمعرّفات عشوائية لا تُرتِّب.
const tick = async () => { const t = Date.now(); while (Date.now() === t) await new Promise((r) => setTimeout(r, 1)); };
// إضافةٌ بانتظارٍ قبلها — كي يكون «الأقدم» أقدمَ فعلاً لا بحسب المعرّف.
const add = async (u, cid, bytes, opts) => { await tick(); return ev.attachContactPhoto(CTX(u), cid, bytes, opts); };

// جلبٌ يقرأ الجسد دائماً بايتاتٍ — تركه غير مقروء يُبقي مقبساً معلّقاً يُسقط التفكيك.
async function http(path, { method = 'GET', as = 'sara', body, headers = {} } = {}) {
  const h = { ...headers };
  if (as) h.cookie = 'sanad_sid=sess_' + as + '; sanad_csrf=t';
  const r = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { /* بايتات لا حمولة */ }
  return { status: r.status, headers: r.headers, buf, json };
}

// ── شهود العزل ────────────────────────────────────────────────────────────────
// الجداول المحمية وعمود «آخر تعديل» في كلٍّ منها (منقولٌ حرفاً من events.test.js).
const PROTECTED = [
  ['opportunity', 'COALESCE(updated_at, created_at)'], ['client', 'COALESCE(updated_at, created_at)'],
  ['contact', 'created_at'], ['project', 'COALESCE(updated_at, created_at)'],
  ['document', 'created_at'], ['document_blob', 'created_at'],
];
async function snapshot() {
  const out = {};
  for (const [t, col] of PROTECTED) {
    const agg = await db.get(`SELECT COUNT(*) AS n, MAX(${col}) AS t FROM ${t}`);
    const rows = await db.all(`SELECT * FROM ${t} ORDER BY 1`);
    out[t] = { n: Number(agg.n), t: agg.t, body: JSON.stringify(rows) };
  }
  return out;
}
let SNAP0;

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
  await db.insert('client', { id: 'ISO-CL', name_ar: 'عميل شاهد', created_at: T });
  await db.insert('contact', { id: 'ISO-CT', client_id: 'ISO-CL', name: 'جهة اتصال شاهدة', created_at: T });
  await db.insert('opportunity', { id: 'ISO-OPP', title_ar: 'فرصة شاهدة', client_id: 'ISO-CL', sector_id: 'SOL', created_at: T });
  await db.insert('project', { id: 'ISO-PRJ', name_ar: 'مشروع شاهد', sector_id: 'SOL', status: 'ACTIVE', created_at: T });
  await db.insert('document', { id: 'ISO-DOC', name: 'مستند شاهد', project_id: 'ISO-PRJ', created_at: T });
  await db.insert('document_blob', { document_id: 'ISO-DOC', content: Buffer.from('شاهد'), mime: 'text/plain', created_at: T });
  SNAP0 = await snapshot();

  EV1 = await ev.createEvent(CTX(LEAD), { name_ar: 'معرض الوجهين', venue: 'الرياض', starts_on: TODAY, ends_on: TODAY });
  C1 = (await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعريف بالشركة', person_name: 'أحمد العلي', org_name: 'شركة النخبة', phone: '0501234567', sector_id: 'SOL' })).contact;
  C2 = (await ev.createContact(CTX(KHALID), EV1.id, { kind: 'شراكة', person_name: 'نورة السالم', phone: '0559876543' })).contact;
  Q1 = await ev.addQr(CTX(LEAD), EV1.id, IMG(0x40), { title: 'امسح لتسجيل بياناتك' });
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
test('الترحيلة ٠٤١ مطبَّقة مرة واحدة: الفريد ux_evb_ref ذهب وix_evb_ref جاء — وملفُها عبارتان لا ثالثة، بلا علامة استفهام لاتينية ولا تغييرٍ لبنية جدول', async () => {
  const applied = await db.all("SELECT version FROM schema_migration WHERE version = '041_event_card_photos.sql'");
  assert.equal(applied.length, 1, 'الترحيلة لم تُسجَّل مرة واحدة بالضبط');
  const sql = readFileSync(join(ROOT, 'migrations/041_event_card_photos.sql'), 'utf8');
  // علامة الاستفهام تُفحص في الملف كله — التعليق يمرّ على مُحوِّل العلامات كما تمرّ العبارة.
  assert.ok(!sql.includes('?'), 'علامة استفهام لاتينية في الترحيلة — تُفسد الربط على Postgres');
  // أما العبارات فتُفحص بعد إسقاط التعليقات (كفحص الترحيلة ٠٣٨): رأسُ الملف يذكر «ALTER TABLE»
  // ليمنعه لا ليفعله.
  const code = sql.replace(/--[^\n]*/g, '');
  assert.ok(!/ALTER\s+TABLE/i.test(code), 'تغييرُ بنية جدولٍ قائم ممنوع هنا (فخّ الترحيلة ٠٣٥)');
  const stmts = code.split(';').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
  assert.equal(stmts.length, 2, `عبارات الترحيلة ليست اثنتين: ${stmts.length}`);
  assert.match(stmts[0], /^DROP INDEX IF EXISTS ux_evb_ref$/i);
  assert.match(stmts[1], /^CREATE INDEX IF NOT EXISTS ix_evb_ref ON event_blob\(kind, ref_id, created_at\)$/i);
  // وفي القاعدة الحيّة: الفريد ذهب فعلاً — بقاؤه يعني أن الصورة الثانية ما زالت تمحو الأولى.
  const idx = (await db.all(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%evb%' ORDER BY name`)).map((r) => r.name);
  assert.ok(idx.includes('ix_evb_ref'), 'الفهرس ix_evb_ref غائب');
  assert.ok(idx.includes('ix_evb_event'), 'الفهرس ix_evb_event غائب');
  assert.ok(!idx.includes('ux_evb_ref'), 'الفهرس الفريد ux_evb_ref ما زال قائماً');
});

// ── الإضافة إضافة ─────────────────────────────────────────────────────────────
test('ثلاث صورٍ على بطاقةٍ واحدة: ثلاثة صفوف، وكلٌّ تقول «أُضيفت»، والعدّاد يتصاعد — والغلاف يبقى الأقدم ورابطُه ثابت', async () => {
  const link = cardOf(C1.id) + '?v=' + sha(JPEG).slice(0, 12);
  P1 = await add(SARA, C1.id, JPEG, { fileName: 'وجه عربي.jpg' });
  assert.deepEqual([P1.added, P1.photo_count, P1.sha256, P1.mime], [true, 1, sha(JPEG), 'image/jpeg']);
  assert.equal(P1.photo_url, link);
  assert.equal(P1.url, `${photosOf(C1.id)}/${P1.id}`);
  P2 = await add(SARA, C1.id, PNG, { fileName: 'وجه إنجليزي.png' });
  assert.deepEqual([P2.added, P2.photo_count, P2.sha256], [true, 2, sha(PNG)]);
  assert.equal(P2.photo_url, link, 'الصورة الثانية غيّرت الغلاف');
  // والثالثة من زميلٍ لم يلتقط البطاقة — البطاقة أمانةُ الفريق (v5.67).
  P3 = await add(KHALID, C1.id, WEBP, { fileName: 'كتيّب.webp' });
  assert.deepEqual([P3.added, P3.photo_count, P3.sha256], [true, 3, sha(WEBP)]);
  assert.equal(P3.photo_url, link, 'الصورة الثالثة غيّرت الغلاف');
  assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [C1.id]), 3, 'الصفوف ليست ثلاثة — إحداها محت ما قبلها');
  assert.equal(new Set([P1.id, P2.id, P3.id]).size, 3, 'معرّفان متطابقان');
  // وأثرٌ لكل إضافة، بمعرّف الصفّ وعدّاده.
  assert.equal(await audits('photo', 'event_contact', C1.id), 3);
  const a = await db.get("SELECT user_id, sector_id, detail_json FROM audit_log WHERE action = 'photo' AND resource_id = ? ORDER BY at DESC, id DESC LIMIT 1", [C1.id]);
  assert.equal(a.user_id, KHALID.id);
  assert.equal(a.sector_id, 'SOL');
  const d = JSON.parse(a.detail_json);
  assert.deepEqual([d.event_id, d.blob_id, d.added, d.photo_count, d.mime, d.file_name],
    [EV1.id, P3.id, true, 3, 'image/webp', 'كتيّب.webp']);
});

test('الغلاف أقدمُ الصور — خدمةً وعبر الشبكة — والقوائم تحمل عدّادها وبصمتَه لا بايتاتها', async () => {
  const cover = await ev.readContactPhoto(SARA, C1.id);
  assert.equal(Buffer.compare(cover.content, JPEG), 0, 'الغلاف ليس أوّل ما رُفع');
  assert.deepEqual([cover.mime, cover.sha256, cover.size_bytes], ['image/jpeg', sha(JPEG), JPEG.length]);
  const net = await http(cardOf(C1.id));
  assert.equal(net.status, 200);
  assert.equal(Buffer.compare(net.buf, JPEG), 0);
  assert.equal(net.headers.get('etag'), '"' + sha(JPEG) + '"');
  const c = await ev.getContact(SARA, C1.id);
  assert.equal(c.photo_sha, sha(JPEG), 'بصمة الصفّ ليست بصمة الغلاف');
  assert.deepEqual([c.has_photo, c.photo_count], [1, 3]);
  assert.equal(c.photos.length, 3);
  assert.equal(c.photos[0].is_cover, true);
  assert.deepEqual(c.photos.map((p) => p.is_cover), [true, false, false], 'أكثر من غلافٍ واحد');
  assert.deepEqual(c.photos.map((p) => p.sha256), [sha(JPEG), sha(PNG), sha(WEBP)], 'الترتيب ليس ترتيب الرفع');
  // القوائم: العدّاد رقمٌ، والبصمة بصمةُ الغلاف، ولا بايتات.
  const rows = await ev.listContacts(SARA, EV1.id, {});
  const mine = rows.find((r) => r.id === C1.id);
  const other = rows.find((r) => r.id === C2.id);
  assert.deepEqual([mine.has_photo, mine.photo_count, mine.photo_sha], [1, 3, sha(JPEG)]);
  assert.equal(typeof mine.photo_count, 'number');
  assert.deepEqual([other.has_photo, other.photo_count, other.photo_sha], [0, 0, null]);
  assert.ok(rows.every((r) => !('content' in r)), 'القائمة تحمل البايتات');
  const recent = (await ev.recentContacts(SARA, EV1.id, {})).rows.find((r) => r.id === C1.id);
  assert.deepEqual([recent.photo_count, recent.photo_sha], [3, sha(JPEG)]);
});

test('الصورة نفسها مرةً ثانية — أيّتها كانت: لا صفّ ولا أثر، وتعود بمعرّف صفّها القائم', async () => {
  const beforeRows = await blobs("WHERE kind = 'card' AND ref_id = ?", [C1.id]);
  const beforeAudit = await audits('photo', 'event_contact', C1.id);
  for (const [bytes, p] of [[JPEG, P1], [PNG, P2], [WEBP, P3]]) {
    const r = await ev.attachContactPhoto(CTX(LEAD), C1.id, Buffer.from(bytes));
    assert.deepEqual([r.ok, r.added, r.id, r.photo_count], [true, false, p.id, 3], `تكرارُ ${p.id} لم يُعرف`);
    assert.equal(r.photo_url, cardOf(C1.id) + '?v=' + sha(JPEG).slice(0, 12));
    assert.equal(r.url, `${photosOf(C1.id)}/${p.id}`);
  }
  assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [C1.id]), beforeRows, 'التكرار كتب صفّاً');
  assert.equal(await audits('photo', 'event_contact', C1.id), beforeAudit, 'التكرار كتب أثراً');
  assert.equal((await db.get(`SELECT uploaded_by FROM event_blob WHERE id = ?`, [P1.id])).uploaded_by, SARA.id,
    'التكرار سرق الرفع من صاحبه');
});

// ── السقف ─────────────────────────────────────────────────────────────────────
test('سقف صور البطاقة: عند بلوغه يُردّ بالعربية قبل الكتابة ويُقال «احذف واحدة»، وحذفُ صورةٍ يفتح مكاناً — والحدّ يُخفَض في الاختبار ويُعاد', async () => {
  const card = (await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'بطاقة تبلغ سقفها' })).contact;
  const was = ev.UPLOAD_LIMITS.photosPerCard;
  ev.UPLOAD_LIMITS.photosPerCard = 3;
  try {
    const first = await add(SARA, card.id, IMG(1));
    await add(SARA, card.id, IMG(2));
    await add(SARA, card.id, IMG(3));
    assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [card.id]), 3);
    const beforeAudit = await audits('photo', 'event_contact', card.id);
    await assert.rejects(() => ev.attachContactPhoto(CTX(SARA), card.id, IMG(4)),
      (e) => e.status === 400 && /حدّ الصور \(3\)/.test(e.message) && /احذف واحدة/.test(e.message), 'الرابعة قُبلت أو رُدّت برسالة أخرى');
    assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [card.id]), 3, 'الرفض كتب');
    assert.equal(await audits('photo', 'event_contact', card.id), beforeAudit, 'الرفض ترك أثراً');
    // وعبر الشبكة الرسالة نفسها.
    const r = await http(cardOf(card.id), { method: 'POST', body: IMG(4), headers: { 'content-type': 'image/jpeg' } });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /حدّ الصور \(3\)/);
    // حذفُ واحدةٍ يفتح مكاناً للرابعة.
    await ev.deleteContactPhoto(CTX(SARA), card.id, first.id);
    const fourth = await add(SARA, card.id, IMG(4));
    assert.deepEqual([fourth.added, fourth.photo_count], [true, 3]);
  } finally { ev.UPLOAD_LIMITS.photosPerCard = was; }
  assert.deepEqual(ev.UPLOAD_LIMITS, { qrPerEvent: 12, photosPerCard: 6, dailyFiles: 300, dailyBytes: 500 * 1024 * 1024 });
});

test('حين يجتمع سقفُ البطاقة وميزانيةُ اليوم: تُقال رسالة السقف — فهي التي بيد المستخدم حيلةٌ فيها', async () => {
  const card = (await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'بطاقة السقفين' })).contact;
  const saved = { ...ev.UPLOAD_LIMITS };
  ev.UPLOAD_LIMITS.photosPerCard = 1;
  try {
    await add(SARA, card.id, IMG(11));
    ev.UPLOAD_LIMITS.dailyFiles = 0;   // الميزانية مغلقة أيضاً — والرسالتان تتنازعان
    await assert.rejects(() => ev.attachContactPhoto(CTX(SARA), card.id, IMG(12)),
      (e) => e.status === 400 && /حدّ الصور \(1\)/.test(e.message) && !/لليوم/.test(e.message),
      'رسالة ميزانية اليوم سبقت رسالة سقف البطاقة');
    assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [card.id]), 1);
  } finally { Object.assign(ev.UPLOAD_LIMITS, saved); }
});

// ── القائمة ───────────────────────────────────────────────────────────────────
test('قائمة صور البطاقة بعقدها: الغلاف أولاً، واسمُ من رفع من سجل الحسابات، والحجم رقمٌ — وبلا بايتات؛ وحكمُ التعديل معها', async () => {
  const { photos, may_edit: mayEdit } = await ev.listContactPhotos(KHALID, C1.id);
  assert.equal(mayEdit, true, 'الزميل لا يعدّل — وهو يحمل المنح (v5.67)');
  assert.equal(photos.length, 3);
  assert.deepEqual(Object.keys(photos[0]).sort(),
    ['created_at', 'id', 'is_cover', 'mime', 'sha256', 'size_bytes', 'uploaded_by', 'uploaded_by_name', 'url'].sort());
  assert.ok(photos.every((p) => !('content' in p)), 'القائمة تحمل البايتات');
  assert.deepEqual(photos.map((p) => p.is_cover), [true, false, false]);
  assert.deepEqual(photos.map((p) => p.id), [P1.id, P2.id, P3.id]);
  assert.deepEqual(photos.map((p) => p.url), [P1.id, P2.id, P3.id].map((b) => `${photosOf(C1.id)}/${b}`));
  assert.deepEqual(photos.map((p) => p.uploaded_by), [SARA.id, SARA.id, KHALID.id]);
  assert.deepEqual(photos.map((p) => p.uploaded_by_name), ['سارة', 'سارة', 'خالد'], 'اسم من رفع لم يُقرأ من سجل الحسابات');
  assert.deepEqual(photos.map((p) => p.size_bytes), [JPEG.length, PNG.length, WEBP.length]);
  assert.ok(photos.every((p) => typeof p.size_bytes === 'number'), 'الحجم ليس رقماً');
  assert.ok(photos.every((p) => typeof p.created_at === 'string' && p.created_at.length > 10));
  // والمشاهد يقرأ القائمة ولا يعدّلها، والخارجي لا يقرؤها أصلاً.
  const asViewer = await ev.listContactPhotos(VIEWER, C1.id);
  assert.equal(asViewer.may_edit, false, 'المشاهد فُتح له التعديل');
  assert.deepEqual(asViewer.photos.map((p) => p.id), [P1.id, P2.id, P3.id]);
  await assert.rejects(() => ev.listContactPhotos(EXT, C1.id), (e) => e.status === 403 && /خارج صلاحياتك/.test(e.message));
  await assert.rejects(() => ev.listContactPhotos(SARA, 'evc_nope'), (e) => e.status === 404 && /البطاقة غير موجودة/.test(e.message));
  // ورافعٌ لا حساب له اليوم (حُذف بعد المعرض): الاسم فارغ ولا ينكسر شيء.
  const ghost = (await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'بطاقة رافعها مجهول' })).contact;
  await db.insert('event_blob', { id: 'evb_ghost', event_id: EV1.id, kind: 'card', ref_id: ghost.id, title: null,
    content: IMG(21), mime: 'image/jpeg', size_bytes: IMG(21).length, sha256: sha(IMG(21)), uploaded_by: 'u_gone', created_at: T });
  const g = await ev.listContactPhotos(SARA, ghost.id);
  assert.deepEqual([g.photos.length, g.photos[0].uploaded_by, g.photos[0].uploaded_by_name], [1, 'u_gone', null]);
  await ev.deleteContact(CTX(SARA), ghost.id);
});

test('قائمة الصور عبر الشبكة لكل قارئ — والخارجي يُرَدّ، وبلا جلسة ٤٠١', async () => {
  const r = await http(photosOf(C1.id));
  assert.equal(r.status, 200);
  assert.equal(r.json.may_edit, true);
  assert.deepEqual(r.json.photos.map((p) => p.id), [P1.id, P2.id, P3.id]);
  const v = await http(photosOf(C1.id), { as: 'viewer' });
  assert.equal(v.status, 200);
  assert.equal(v.json.may_edit, false);
  assert.equal((await http(photosOf(C1.id), { as: 'ext' })).status, 403);
  assert.equal((await http(photosOf(C1.id), { as: null })).status, 401);
  const gone = await http(photosOf('evc_nope'));
  assert.equal(gone.status, 404);
  assert.match(gone.json.error.message, /البطاقة غير موجودة/);
});

// ── بايتات صورةٍ بعينها ───────────────────────────────────────────────────────
test('كل صورةٍ بعينها عبر الشبكة: بايتاتُها وبصمتُها وترويساتها، و«لم تتغيّر»، والتنزيل ملفاً باسم صورتها', async () => {
  for (const [p, bytes, ext] of [[P1, JPEG, 'jpg'], [P2, PNG, 'png'], [P3, WEBP, 'webp']]) {
    const r = await http(`${photosOf(C1.id)}/${p.id}`);
    assert.equal(r.status, 200, `${p.id}: ${r.status}`);
    assert.equal(Buffer.compare(r.buf, bytes), 0, `${p.id}: بايتاتٌ أخرى`);
    assert.equal(r.headers.get('content-type'), p.mime);
    assert.equal(r.headers.get('content-length'), String(bytes.length));
    assert.equal(r.headers.get('etag'), '"' + sha(bytes) + '"');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('content-disposition'), `inline; filename="card-${p.id}.${ext}"`);
    const again = await http(`${photosOf(C1.id)}/${p.id}`, { headers: { 'if-none-match': '"' + sha(bytes) + '"' } });
    assert.equal(again.status, 304, `${p.id}: البصمة العائدة لم تُردّ بـ«لم تتغيّر»`);
    assert.equal(again.buf.length, 0);
    const dl = await http(`${photosOf(C1.id)}/${p.id}?download=1`);
    assert.equal(dl.headers.get('content-disposition'), `attachment; filename="card-${p.id}.${ext}"`);
    assert.equal(Buffer.compare(dl.buf, bytes), 0);
  }
  // والقراءة لكل قارئ، والخارجي يُرَدّ، وبلا جلسة ٤٠١.
  assert.equal((await http(`${photosOf(C1.id)}/${P2.id}`, { as: 'viewer' })).status, 200);
  assert.equal((await http(`${photosOf(C1.id)}/${P2.id}`, { as: 'ext' })).status, 403);
  assert.equal((await http(`${photosOf(C1.id)}/${P2.id}`, { as: null })).status, 401);
});

test('صورةٌ ليست لهذه البطاقة لا تُقرأ من عنوانها: صورةُ بطاقةٍ أخرى، ورمزُ كشك، ومعرّفٌ لا وجود له — ٤٠٤ بالعربية', async () => {
  const otherCard = await add(KHALID, C2.id, IMG(31));
  for (const bad of [otherCard.id, Q1.id, 'evb_nope', 'evb_../..']) {
    await assert.rejects(() => ev.readContactPhoto(SARA, C1.id, bad),
      (e) => e.status === 404 && /هذه الصورة غير موجودة — حدّث الصفحة/.test(e.message), `قُرئ ما ليس لهذه البطاقة: ${bad}`);
  }
  const r = await http(`${photosOf(C1.id)}/${otherCard.id}`);
  assert.equal(r.status, 404);
  assert.match(r.json.error.message, /هذه الصورة غير موجودة/);
  const q = await http(`${photosOf(C1.id)}/${Q1.id}`);
  assert.equal(q.status, 404, 'رمزُ كشكٍ قُرئ صورةَ بطاقة');
  // وصورةُ البطاقة الأخرى تُقرأ من عنوانها هي.
  assert.equal(Buffer.compare((await ev.readContactPhoto(SARA, C2.id, otherCard.id)).content, IMG(31)), 0);
  // والبطاقة التي لا صورة لها: رسالةُ الغلاف لا رسالةُ الصورة.
  const empty = (await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'بطاقة بلا صورة' })).contact;
  await assert.rejects(() => ev.readContactPhoto(SARA, empty.id),
    (e) => e.status === 404 && /لا صورة لهذه البطاقة بعد — أرفقها من القائمة/.test(e.message));
  await ev.deleteContact(CTX(SARA), empty.id);
});

// ── الحذف الواحد ──────────────────────────────────────────────────────────────
test('حذف صورةٍ واحدة: الغلافُ يتولّاه ما بعده، والوسطى لا تمسّه، وآخرُ صورةٍ تترك البطاقة بلا غلاف — وأثرٌ لكل حذف', async () => {
  const card = (await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'بطاقة الحذف' })).contact;
  const A = await add(SARA, card.id, IMG(41));
  const B = await add(SARA, card.id, IMG(42));
  const C = await add(SARA, card.id, IMG(43));
  const D = await add(SARA, card.id, IMG(44));
  const link = (bytes) => cardOf(card.id) + '?v=' + sha(bytes).slice(0, 12);
  assert.equal((await ev.getContact(SARA, card.id)).photo_sha, sha(IMG(41)));

  // ① حذف الغلاف: ما بعده يتولّاه.
  const r1 = await ev.deleteContactPhoto(CTX(SARA), card.id, A.id);
  assert.deepEqual(r1, { ok: true, photo_count: 3, cover_sha: sha(IMG(42)), photo_url: link(IMG(42)) });
  const c1 = await ev.getContact(SARA, card.id);
  assert.deepEqual([c1.photo_sha, c1.photo_count], [sha(IMG(42)), 3]);
  assert.equal(c1.photos[0].id, B.id);
  assert.equal(Buffer.compare((await ev.readContactPhoto(SARA, card.id)).content, IMG(42)), 0);
  await assert.rejects(() => ev.readContactPhoto(SARA, card.id, A.id), (e) => e.status === 404);
  const a1 = await db.get("SELECT user_id, sector_id, detail_json FROM audit_log WHERE action = 'delete' AND resource = 'event_blob' AND resource_id = ?", [A.id]);
  assert.ok(a1, 'حذف الصورة بلا أثر');
  assert.equal(a1.user_id, SARA.id);
  const d1 = JSON.parse(a1.detail_json);
  assert.deepEqual([d1.event_id, d1.kind, d1.contact_id, d1.sha256, d1.size_bytes],
    [EV1.id, 'card', card.id, sha(IMG(41)), IMG(41).length]);

  // ② حذف الوسطى: الغلاف لا يتحرّك.
  const r2 = await ev.deleteContactPhoto(CTX(SARA), card.id, C.id);
  assert.deepEqual(r2, { ok: true, photo_count: 2, cover_sha: sha(IMG(42)), photo_url: link(IMG(42)) });
  assert.deepEqual((await ev.listContactPhotos(SARA, card.id)).photos.map((p) => p.id), [B.id, D.id]);
  assert.equal(await audits('delete', 'event_blob', C.id), 1);

  // ③ ثم الباقيتان: آخرُ حذفٍ يترك البطاقة بلا غلاف ولا رابط.
  await ev.deleteContactPhoto(CTX(SARA), card.id, B.id);
  const r4 = await ev.deleteContactPhoto(CTX(SARA), card.id, D.id);
  assert.deepEqual(r4, { ok: true, photo_count: 0, cover_sha: null, photo_url: null });
  const c4 = await ev.getContact(SARA, card.id);
  assert.deepEqual([c4.has_photo, c4.photo_count, c4.photo_sha, c4.photos], [0, 0, null, []]);
  await assert.rejects(() => ev.readContactPhoto(SARA, card.id),
    (e) => e.status === 404 && /لا صورة لهذه البطاقة بعد/.test(e.message));
  assert.equal((await http(cardOf(card.id))).status, 404);
  assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [card.id]), 0, 'الحذف ناعمٌ لا قاطع');
  // والحذف مرةً ثانية: غير موجودة.
  await assert.rejects(() => ev.deleteContactPhoto(CTX(SARA), card.id, D.id),
    (e) => e.status === 404 && /هذه الصورة غير موجودة/.test(e.message));
  // وحذفُ صورةٍ ليست لهذه البطاقة يُرَدّ كذلك.
  await assert.rejects(() => ev.deleteContactPhoto(CTX(SARA), card.id, P1.id), (e) => e.status === 404);
  assert.equal(await blobs('WHERE id = ?', [P1.id]), 1, 'حذفٌ من عنوان بطاقةٍ أخرى مرّ');
  await ev.deleteContact(CTX(SARA), card.id);
});

test('الحذف عبر الشبكة يعيد الغلاف الجديد — والمشاهد يُرَدّ قبل أي محو', async () => {
  const card = (await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'بطاقة الحذف عبر الشبكة' })).contact;
  const A = await add(SARA, card.id, IMG(51));
  const B = await add(SARA, card.id, IMG(52));
  const denied = await http(`${photosOf(card.id)}/${A.id}`, { method: 'DELETE', as: 'viewer' });
  assert.equal(denied.status, 403);
  assert.match(denied.json.error.message, /ليس ضمن صلاحيتك/);
  assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [card.id]), 2, 'الرفض محا');
  const del = await http(`${photosOf(card.id)}/${A.id}`, { method: 'DELETE', as: 'khalid' });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.deepEqual(del.json, { ok: true, photo_count: 1, cover_sha: sha(IMG(52)), photo_url: cardOf(card.id) + '?v=' + sha(IMG(52)).slice(0, 12) });
  assert.equal(Buffer.compare((await http(cardOf(card.id))).buf, IMG(52)), 0);
  assert.equal(await audits('delete', 'event_blob', B.id), 0);
  await ev.deleteContact(CTX(SARA), card.id);
});

// ── الحُرّاس ──────────────────────────────────────────────────────────────────
test('الحُرّاس (v5.67): الزميل يصحّح بطاقة زميله ويُرفق ويحذف صورةً، والمشاهد يُرَدّ بلا كتابة، والخارجي خارج الباب — والقراءة لكل قارئ', async () => {
  const card = (await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'بطاقة سارة للحُرّاس' })).contact;
  const first = await add(SARA, card.id, IMG(61));
  // ① الزميل: يُضيف ويحذف ويصحّح — كلُّها تمرّ.
  const added = await add(KHALID, card.id, IMG(62));
  assert.deepEqual([added.added, added.photo_count], [true, 2]);
  assert.deepEqual(await ev.deleteContactPhoto(CTX(KHALID), card.id, first.id),
    { ok: true, photo_count: 1, cover_sha: sha(IMG(62)), photo_url: cardOf(card.id) + '?v=' + sha(IMG(62)).slice(0, 12) });
  assert.equal((await ev.updateContact(CTX(KHALID), card.id, { job_title: 'مدير المشتريات' })).job_title, 'مدير المشتريات');
  assert.equal((await ev.setOutcome(CTX(KHALID), card.id, { outcome: 'تواصلنا' })).outcome_by, KHALID.id);
  // ② المشاهد: يُرَدّ في الثلاثة برسالةٍ واحدة، ولا يكتب شيئاً.
  const beforeRows = await blobs("WHERE kind = 'card' AND ref_id = ?", [card.id]);
  const beforeAudit = await n('SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?', [VIEWER.id]);
  for (const fn of [
    () => ev.attachContactPhoto(CTX(VIEWER), card.id, IMG(63)),
    () => ev.deleteContactPhoto(CTX(VIEWER), card.id, added.id),
    () => ev.updateContact(CTX(VIEWER), card.id, { note: 'من مشاهد' }),
    () => ev.setOutcome(CTX(VIEWER), card.id, { outcome: 'لا متابعة' }),
  ]) {
    await assert.rejects(fn, (e) => e.status === 403
      && /تعديل البطاقات ليس ضمن صلاحيتك — اطلب الصلاحية من مدير النظام/.test(e.message), 'المشاهد مرّ أو رُدّ برسالة أخرى');
  }
  assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [card.id]), beforeRows, 'رفضُ المشاهد كتب');
  assert.equal(await n('SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?', [VIEWER.id]), beforeAudit, 'رفضُ المشاهد ترك أثراً');
  assert.equal(beforeAudit, 0, 'المشاهد لم يكتب شيئاً فلا يكون له أثر');
  // ③ الخارجي: خارج القسم كله.
  for (const fn of [
    () => ev.attachContactPhoto(CTX(EXT), card.id, IMG(64)),
    () => ev.deleteContactPhoto(CTX(EXT), card.id, added.id),
    () => ev.updateContact(CTX(EXT), card.id, { note: 'من خارجي' }),
    () => ev.readContactPhoto(EXT, card.id, added.id),
  ]) {
    await assert.rejects(fn, (e) => e.status === 403 && /خارج صلاحياتك/.test(e.message));
  }
  // ④ والقراءة لكل قارئ — المشاهد يقرأ الغلاف وكل صورةٍ بعينها وقائمتها.
  assert.equal((await ev.readContactPhoto(VIEWER, card.id)).sha256, sha(IMG(62)));
  assert.equal((await ev.readContactPhoto(VIEWER, card.id, added.id)).sha256, sha(IMG(62)));
  assert.equal((await ev.listContactPhotos(VIEWER, card.id)).photos.length, 1);
  await ev.deleteContact(CTX(SARA), card.id);
});

// ── المحو ─────────────────────────────────────────────────────────────────────
test('المحو على العدد كلِّه: حذفُ بطاقةٍ بثلاث صور يمحو ثلاثتها، وحذفُ فعاليةٍ يمحو صور بطاقاتها ورموزَها — وفعاليةٌ أخرى لا تُمسّ', async () => {
  const E = await ev.createEvent(CTX(LEAD), { name_ar: 'فعالية تُحذف بصورها', starts_on: TODAY, ends_on: TODAY });
  const x1 = (await ev.createContact(CTX(SARA), E.id, { kind: 'تعاون', person_name: 'الأولى' })).contact;
  const x2 = (await ev.createContact(CTX(KHALID), E.id, { kind: 'تعاون', person_name: 'الثانية' })).contact;
  const solo = (await ev.createContact(CTX(SARA), E.id, { kind: 'تعاون', person_name: 'تُحذف وحدها بصورها الثلاث' })).contact;
  for (const s of [71, 72, 73]) await add(SARA, solo.id, IMG(s));
  for (const s of [74, 75]) await add(SARA, x1.id, IMG(s));
  for (const s of [76, 77, 78]) await add(KHALID, x2.id, IMG(s));
  await ev.addQr(CTX(LEAD), E.id, IMG(79), { title: 'رمز يُحذف مع فعاليته' });
  assert.equal(await blobs('WHERE event_id = ?', [E.id]), 9, 'الشهود لم يكتملوا');
  const others = await blobs('WHERE event_id <> ?', [E.id]);
  assert.ok(others >= 4, 'لا شهود في الفعاليات الأخرى');

  await ev.deleteContact(CTX(SARA), solo.id);
  assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [solo.id]), 0, 'حذف البطاقة أبقى صوراً');
  assert.equal(await blobs('WHERE event_id = ?', [E.id]), 6);

  await ev.deleteEvent(CTX(LEAD), E.id);
  assert.equal(await blobs('WHERE event_id = ?', [E.id]), 0, 'حذف الفعالية أبقى صوراً');
  assert.equal(await blobs('WHERE event_id <> ?', [E.id]), others, 'حذف الفعالية مسّ صور غيرها');
  assert.equal(await blobs("WHERE kind = 'card' AND ref_id = ?", [C1.id]), 3, 'صور فعاليةٍ أخرى زالت');
});

// ── العزل ─────────────────────────────────────────────────────────────────────
test('العزل بعد كل هذا: لا صفٌّ تحرّك في الفرص والعملاء وجهات الاتصال والمشاريع والمستندات', async () => {
  for (const [t] of PROTECTED) assert.equal(SNAP0[t].n, 1, `الشاهد في ${t} غائب — الفحص يقيس لا شيء`);
  const after = await snapshot();
  for (const [t] of PROTECTED) {
    assert.equal(after[t].n, SNAP0[t].n, `${t}: تغيّر العدد`);
    assert.equal(after[t].t, SNAP0[t].t, `${t}: تغيّر آخر تعديل`);
    assert.equal(after[t].body, SNAP0[t].body, `${t}: تغيّر محتوى صفّ`);
  }
  // والجهة الأخرى تحرّكت فعلاً — وإلا فالفحص يقارن سكوناً بسكون.
  assert.ok(await n("SELECT COUNT(*) AS n FROM audit_log WHERE resource LIKE 'event%'") >= 20);
  assert.ok(await blobs() >= 4);
});
