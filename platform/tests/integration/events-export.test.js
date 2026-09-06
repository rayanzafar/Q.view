// «الفعاليات» v5.68 — تصدير الجهات الملتقطة ملفَّ Excel: ما على الشاشة هو ما ينزل في الملف،
// ولكلِّ من يقرأ الفعالية (قرار المالك ٢٠٢٦-٠٩-٠١، بعد أن كان لمن يديرها وحده).
//
// ما يحرسه هذا الملف بترتيب أهميته:
//   ١) الملف يُقرأ فعلاً: البايتات تعود جدولاً برؤوسه الستة عشر بترتيبها، وبصفوفه الثلاثة —
//      واسمُ القطاع محلولٌ من معرّفه، و«نعم» على ما قد يكون مكرَّراً، ورابطُ الصورة **مطلق**
//      لمن له صورة وفارغٌ لمن لا صورة له، ووقتُ الالتقاط بساعة الرياض لا بساعة غرينتش.
//   ٢) ما لا يخرج: النصّ الخام (raw_text) ليس في الملف — لا رأساً ولا خلية.
//   ٣) التصفية تُحترَم: تصديرٌ بنوعٍ واحد يُنزِل صفوف ذلك النوع وحدها.
//   ٤) الباب هو باب القراءة نفسه: القائد والمستشار والمشاهد وحاملُ المنح الشخصي (v5.60)
//      يصدّرون جميعاً، والخارجي وحده يُردّ لأنه لا يبلغ الفعاليات أصلاً.
//   ٥) التدقيق: كل تصديرٍ ناجح صفٌّ بعدد صفوفه وتصفيته — والتصديرُ المردود لا يكتب شيئاً.
//   ٦) عبر الشبكة: ترويسات التنزيل (نوعُ الملف، «مرفق» باسمين، «لا يُخزَّن»، «لا تخمين نوع»)،
//      والجسمُ يُقرأ جدولاً للقائد والمستشار والمشاهد؛ والمردودُ (الخارجي) حمولةٌ عربية؛
//      وفعاليةٌ محذوفة ٤٠٤.
// الخدمة تُنادى مباشرةً، والمسار عبر التطبيق الحقيقي بلا تطعيم — كما في events-photo.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseWorkbook } from '../../src/modules/io/xlsx.js';

const dir = mkdtempSync(join(tmpdir(), 'sanad-evexport-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, ev, cfg, server, base;
const T = new Date().toISOString();
const TODAY = T.slice(0, 10);
const user = (uid, role, extra = {}) => ({
  id: uid, username: uid.replace(/^u_/, ''), role_id: role, sector_id: 'SOL', scope: 'own',
  projectIds: new Set(), teamIds: new Set(), ...extra,
});
const LEAD = user('u_lead', 'sector_lead', { name_ar: 'قائد القطاع', scope: 'sector' });
const SARA = user('u_sara', 'consultant', { name_ar: 'سارة' });
const VIEWER = user('u_viewer', 'viewer', { name_ar: 'مشاهد', scope: 'sector' });
const EXT = user('u_ext', 'external', { name_ar: 'زائر', sector_id: null });
// مدير النظام: بابُ حذف الفعالية وحده بعد قرار ٢٠٢٦-٠٩-٠١ — قائد القطاع يُنشئ ويعدّل ولا يحذف.
const ADMIN = user('u_admin', 'admin', { name_ar: 'مدير النظام', scope: 'company' });
// موظفٌ يحمل منح v5.60 الشخصية «يعدّل الفعاليات» — يصدّر دون أن يكون دوره إدارياً.
const MAZIN = user('u_mazin', 'employee', { name_ar: 'مازن',
  departmentGrants: [{ resource: 'event', action: 'update', department_id: 'D1' }] });
const CTX = (u) => ({ user: u, ip: '127.0.0.1' });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
// نصٌّ خامٌ مميَّز: إن ظهر حرفٌ منه في الملف فقد تسرّب الأصل الذي لا يُوزَّع.
const RAW = 'نصّ البطاقة الخام كما لُصق — سرٌّ لا يُصدَّر ٩٩٩';

// الرؤوس الستة عشر بترتيبها، مكتوبةً هنا حرفاً: لو أعاد أحدٌ ترتيبها أو غيّر كلمةً في المصدر
// وحده لانكسر هذا السطر — وهو المقصود، فالملف يُفتح على أجهزة الناس وأعمدتُه عقدٌ معهم.
const HEADERS = ['الشخص', 'الجهة', 'المنصب', 'الجوّال', 'البريد', 'الموقع الإلكتروني', 'نوع البطاقة',
  'القطاع المعني', 'المتابعة', 'ملاحظة المتابعة', 'ملاحظة', 'قد تكون مكرّرة', 'التقطها',
  'وقت الالتقاط', 'عدد الصور', 'رابط الصورة'];
const COL = Object.fromEntries(HEADERS.map((h, i) => [h, i]));

let EV1, EV_GONE, A, B, C;
const n = async (sql, p = []) => Number((await db.get(sql, p)).n);
const exportAudits = () => n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'export' AND resource = 'event_contact'");
// الملف ⟵ جدولاً: رؤوسٌ وصفوف، ودالةُ بحثٍ بالاسم كي لا يعتمد الفحص على ترتيب الصفوف.
function sheet(buffer) {
  const p = parseWorkbook(buffer, 'x.xlsx');
  return { ...p, byPerson: (name) => p.rows.find((r) => r[COL['الشخص']] === name) };
}

async function http(path, { as = 'lead' } = {}) {
  const headers = as ? { cookie: `sanad_sid=sess_${as}; sanad_csrf=t` } : {};
  const r = await fetch(base + path, { headers, redirect: 'manual' });
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
  ({ config: cfg } = await import('../../src/core/config.js'));
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  for (const u of [LEAD, SARA, VIEWER, EXT, MAZIN, ADMIN]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
    await db.insert('session', { id: 'sess_' + u.username, user_id: u.id, created_at: T,
      expires_at: new Date(Date.now() + 86400000).toISOString() });
  }
  EV1 = await ev.createEvent(CTX(LEAD), { name_ar: 'معرض التقنية 2026', venue: 'الرياض', starts_on: TODAY, ends_on: TODAY });
  EV_GONE = await ev.createEvent(CTX(LEAD), { name_ar: 'معرضٌ أُلغي', venue: 'جدة', starts_on: TODAY, ends_on: TODAY });
  await ev.deleteEvent(CTX(ADMIN), EV_GONE.id);

  // أ) بطاقةٌ كاملة: قطاعٌ محدَّد، ونصٌّ خام، وصورةٌ تُدرَج صفّاً مباشرةً في القاعدة.
  A = (await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعريف بالشركة', person_name: 'أحمد العلي',
    org_name: 'شركة النخبة', job_title: 'مدير المشتريات', phone: '0501234567', email: 'ahmad@nokhba.sa',
    website: 'nokhba.sa', sector_id: 'SOL', note: 'يريد عرضاً تقنياً', raw_text: RAW })).contact;
  await db.insert('event_blob', { id: 'evb_test_a', event_id: EV1.id, kind: 'card', ref_id: A.id,
    content: PNG, mime: 'image/png', size_bytes: PNG.length, sha256: createHash('sha256').update(PNG).digest('hex'),
    uploaded_by: SARA.id, created_at: T });
  // ب) البطاقة نفسها بجوّالها نفسه من زميلٍ آخر ⟵ «قد تكون مكرّرة» تُعلَّم تلقائياً.
  B = (await ev.createContact(CTX(LEAD), EV1.id, { kind: 'شراكة', person_name: 'أحمد العلي',
    org_name: 'شركة النخبة', phone: '0501234567' })).contact;
  // ج) بطاقةٌ بلا قطاعٍ ولا صورة — «غير محدَّد» ورابطٌ فارغ.
  C = (await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'نورة السالم',
    org_name: 'مؤسسة الأفق', phone: '0559876543' })).contact;
  await ev.setOutcome(CTX(LEAD), C.id, { outcome: 'تواصلنا', outcome_note: 'اتصلنا بها بعد المعرض' });

  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((res) => server.close(res));
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ── ١) الملف نفسه ─────────────────────────────────────────────────────────────
test('التصدير يعود ملفاً يُقرأ: ستة عشر رأساً بترتيبها، وثلاثة صفوف بما فيها من قطاعٍ وتكرارٍ ورابطِ صورة', async () => {
  const out = await ev.exportContacts(CTX(LEAD), EV1.id);
  assert.equal(out.mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(out.fileName, 'الجهات الملتقطة — معرض التقنية 2026.xlsx');
  assert.ok(Buffer.isBuffer(out.buffer) && out.buffer.length > 0, 'الملف فارغ');

  const s = sheet(out.buffer);
  assert.deepEqual(s.headers, HEADERS, 'رؤوس الأعمدة أو ترتيبها تغيّر');
  assert.deepEqual(s.headers, ev.EXPORT_HEADERS, 'رؤوس المصدر لا تطابق الرؤوس المتّفق عليها');
  assert.equal(s.rows.length, 3, 'عدد صفوف الملف ليس ثلاثة');

  const a = s.byPerson('أحمد العلي');
  assert.ok(a, 'صفّ أحمد العلي غائب عن الملف');
  assert.equal(a[COL['الجهة']], 'شركة النخبة');
  assert.equal(a[COL['المنصب']], 'مدير المشتريات');
  assert.equal(a[COL['الجوّال']], '0501234567');
  assert.equal(a[COL['البريد']], 'ahmad@nokhba.sa');
  assert.equal(a[COL['الموقع الإلكتروني']], 'nokhba.sa');
  assert.equal(a[COL['نوع البطاقة']], 'تعريف بالشركة');
  assert.equal(a[COL['القطاع المعني']], 'قطاع الحلول', 'اسم القطاع لم يُحلّ من معرّفه');
  assert.equal(a[COL['المتابعة']], 'لم تُراجع');
  assert.equal(a[COL['ملاحظة']], 'يريد عرضاً تقنياً');
  assert.equal(a[COL['التقطها']], 'سارة');
  assert.equal(a[COL['عدد الصور']], '1');
  assert.equal(a[COL['رابط الصورة']], `${cfg.platformUrl}/api/events/contacts/${A.id}/photo`, 'رابط الصورة ليس مطلقاً');

  // «قد تكون مكرّرة»: نعم للثانية، وفارغٌ لغيرها — لا «صواب/خطأ» ولا صفر.
  const b = s.rows.find((r) => r[COL['نوع البطاقة']] === 'شراكة');
  assert.equal(b[COL['قد تكون مكرّرة']], 'نعم');
  assert.equal(a[COL['قد تكون مكرّرة']], '');

  const c = s.byPerson('نورة السالم');
  assert.equal(c[COL['القطاع المعني']], 'غير محدَّد', 'البطاقة بلا قطاع يجب أن تقول «غير محدَّد»');
  assert.equal(c[COL['رابط الصورة']], '', 'بطاقةٌ بلا صورة يجب أن يكون رابطها فارغاً');
  assert.equal(c[COL['عدد الصور']], '0');
  assert.equal(c[COL['المتابعة']], 'تواصلنا');
  assert.equal(c[COL['ملاحظة المتابعة']], 'اتصلنا بها بعد المعرض');
});

test('وقت الالتقاط بساعة الرياض بصيغة سنة-شهر-يوم ثم ساعة ودقيقة', async () => {
  const out = await ev.exportContacts(CTX(LEAD), EV1.id);
  const cell = sheet(out.buffer).byPerson('أحمد العلي')[COL['وقت الالتقاط']];
  assert.match(cell, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, 'صيغة الوقت غير المتفق عليها');
  const riyadh = new Date(new Date(A.captured_at).getTime() + 3 * 3600000).toISOString();
  assert.equal(cell, `${riyadh.slice(0, 10)} ${riyadh.slice(11, 16)}`, 'الوقت ليس بساعة الرياض (+٣)');
});

// ── ٢) ما لا يخرج ─────────────────────────────────────────────────────────────
test('النصّ الخام لا يخرج في الملف — لا رأساً ولا خلية', async () => {
  const out = await ev.exportContacts(CTX(LEAD), EV1.id);
  const s = sheet(out.buffer);
  const text = [...s.headers, ...s.rows.flat()].join('\n');
  assert.ok(!text.includes(RAW), 'النصّ الخام تسرّب إلى الملف');
  assert.ok(!text.includes('سرٌّ لا يُصدَّر'), 'جزءٌ من النصّ الخام تسرّب إلى الملف');
  for (const banned of ['raw_text', 'capture_key', 'phone_norm', 'name_norm', 'org_norm', 'email_norm']) {
    assert.ok(!text.includes(banned), `${banned} ظهر في الملف`);
  }
});

// ── ٣) التصفية ────────────────────────────────────────────────────────────────
test('التصفية تُحترَم: تصديرٌ بنوعٍ واحد يُنزِل صفوف ذلك النوع وحدها', async () => {
  const out = await ev.exportContacts(CTX(LEAD), EV1.id, { kind: 'شراكة' });
  const s = sheet(out.buffer);
  assert.deepEqual(s.headers, HEADERS);
  assert.equal(s.rows.length, 1, 'التصفية بالنوع لم تُطبَّق');
  assert.equal(s.rows[0][COL['نوع البطاقة']], 'شراكة');

  // و«محتمَلة التكرار» و«بطاقاتي» كذلك — الشرط نفسه الذي تبني به الشاشة قائمتها.
  assert.equal(sheet((await ev.exportContacts(CTX(LEAD), EV1.id, { dup: '1' })).buffer).rows.length, 1);
  assert.equal(sheet((await ev.exportContacts(CTX(LEAD), EV1.id, { mine: '1' })).buffer).rows.length, 1);
  assert.equal(sheet((await ev.exportContacts(CTX(LEAD), EV1.id, { q: 'نورة' })).buffer).rows.length, 1);
});

// ── ٤) الباب ──────────────────────────────────────────────────────────────────
test('التصدير لكل من يقرأ الفعالية: القائد والمستشار والمشاهد وحاملُ المنح — والخارجي وحده يُردّ', async () => {
  // أربعةُ أبوابٍ تُفتح: قائدٌ يدير، وحاملُ منحٍ شخصيّ (v5.60)، ومستشارٌ يلتقط، ومشاهدٌ يقرأ
  // فقط — وكلُّهم ينالون الملف نفسه بصفوفه الثلاثة ورؤوسه الستة عشر، لا ملفاً منقوصاً.
  for (const u of [LEAD, MAZIN, SARA, VIEWER]) {
    const s = sheet((await ev.exportContacts(CTX(u), EV1.id)).buffer);
    assert.deepEqual(s.headers, HEADERS, `${u.name_ar}: رؤوس الملف ليست الرؤوس المتّفق عليها`);
    assert.equal(s.rows.length, 3, `${u.name_ar}: لم ينزل الملف بصفوفه الثلاثة`);
  }
  await assert.rejects(() => ev.exportContacts(CTX(EXT), EV1.id),
    (e) => e.status === 403 && /خارج صلاحياتك/.test(e.message));
  await assert.rejects(() => ev.exportContacts(CTX(LEAD), EV_GONE.id), (e) => e.status === 404);
});

// ── ٥) التدقيق ────────────────────────────────────────────────────────────────
test('كل تصديرٍ ناجح صفُّ تدقيقٍ بعدد صفوفه وتصفيته — والمردود لا يكتب شيئاً', async () => {
  const before = await exportAudits();
  await ev.exportContacts(CTX(LEAD), EV1.id);
  assert.equal(await exportAudits(), before + 1, 'التصدير لم يُسجَّل في التدقيق');

  const row = await db.get(`SELECT user_id, resource_id, sector_id, detail_json FROM audit_log
     WHERE action = 'export' AND resource = 'event_contact' ORDER BY at DESC, id DESC LIMIT 1`);
  assert.equal(row.user_id, LEAD.id);
  assert.equal(row.resource_id, EV1.id);
  assert.equal(row.sector_id, null);
  const detail = JSON.parse(row.detail_json);
  assert.equal(detail.event_id, EV1.id);
  assert.equal(detail.rows, 3);
  assert.deepEqual(detail.filters, { q: null, kind: null, outcome: null, mine: false, dup: false });

  // والمردود صار واحداً: الخارجي وحده — وردُّه لا يترك أثراً في التدقيق.
  const now = await exportAudits();
  await assert.rejects(() => ev.exportContacts(CTX(EXT), EV1.id), (e) => e.status === 403);
  assert.equal(await exportAudits(), now, 'تصديرٌ مردود كتب صفّاً في التدقيق');
});

// ── ٦) عبر الشبكة ─────────────────────────────────────────────────────────────
test('المسار: الملف ينزل بترويساته للقائد والمستشار والمشاهد، ويُردّ الخارجي بالعربية، والفعالية المحذوفة غير موجودة', async () => {
  const r = await http(`/api/events/${EV1.id}/contacts/export.xlsx`, { as: 'lead' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const cd = r.headers.get('content-disposition');
  assert.ok(cd.startsWith('attachment'), `«مرفق» غائبة عن الترويسة: ${cd}`);
  assert.ok(cd.includes(`filename="event-${EV1.id}-contacts.xlsx"`), `الاسم اللاتيني غائب: ${cd}`);
  assert.ok(cd.includes("filename*=UTF-8''"), `الاسم العربي بصيغة UTF-8 غائب: ${cd}`);
  assert.ok(!/[^\x20-\x7e]/.test(cd), 'الترويسة تحمل حرفاً غير لاتيني — العربية تُرمَّز');
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const s = sheet(r.buf);
  assert.deepEqual(s.headers, HEADERS);
  assert.equal(s.rows.length, 3);

  // والتصفية تعبر العنوان كما تعبر الشاشة
  const filtered = await http(`/api/events/${EV1.id}/contacts/export.xlsx?kind=${encodeURIComponent('شراكة')}`, { as: 'lead' });
  assert.equal(filtered.status, 200);
  assert.equal(sheet(filtered.buf).rows.length, 1);

  // والمستشار والمشاهد ينزل عليهما الملف نفسه بترويساته نفسها — لا صفحةَ رفضٍ ولا حمولةَ خطأ.
  for (const who of ['sara', 'viewer']) {
    const g = await http(`/api/events/${EV1.id}/contacts/export.xlsx`, { as: who });
    assert.equal(g.status, 200, `${who}: لم ينزل الملف`);
    assert.equal(g.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const gcd = g.headers.get('content-disposition');
    assert.ok(gcd.startsWith('attachment'), `${who}: «مرفق» غائبة عن الترويسة: ${gcd}`);
    assert.ok(gcd.includes(`filename="event-${EV1.id}-contacts.xlsx"`), `${who}: الاسم اللاتيني غائب: ${gcd}`);
    assert.ok(gcd.includes("filename*=UTF-8''"), `${who}: الاسم العربي بصيغة UTF-8 غائب: ${gcd}`);
    const gs = sheet(g.buf);
    assert.deepEqual(gs.headers, HEADERS, `${who}: رؤوس الملف تغيّرت`);
    assert.equal(gs.rows.length, 3, `${who}: عدد صفوف الملف ليس ثلاثة`);
  }

  // والخارجي وحده يُردّ — وردُّه حمولةٌ عربية تقول له أين هو، لا بايتات.
  const ext = await http(`/api/events/${EV1.id}/contacts/export.xlsx`, { as: 'ext' });
  assert.equal(ext.status, 403);
  assert.match(ext.json.error.message, /الفعاليات خارج صلاحياتك/);

  const gone = await http(`/api/events/${EV_GONE.id}/contacts/export.xlsx`, { as: 'lead' });
  assert.equal(gone.status, 404);
  assert.match(gone.json.error.message, /الفعالية غير موجودة/);
});
