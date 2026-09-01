// «الفعاليات» — قسمٌ معزول لالتقاط بطاقات الزوّار في المعارض (الترحيلة ٠٣٨، الوحدة modules/events).
//
// ما يحرسه هذا الملف بترتيب أهميته:
//   ١) **العزل**: سيناريو كامل في الفعاليات — فعاليتان وبطاقات ومكرَّرات وشراكات وأحوال وحذف —
//      لا يحرّك صفاً واحداً في الفرص والعملاء وجهات الاتصال والمشاريع والمستندات. وفحصٌ بنيويّ
//      يقرأ ملفات الوحدة نصّاً فلا يجد فيها جدولاً محمياً ولا استيراداً من وحدتَي العملاء والبيع.
//   ٢) الحُرّاس: من ينشئ الفعالية، ومن يلتقط، ومن يعدّل بطاقة غيره — المصفوفة أولاً ثم الملكية —
//      وكل رفضٍ بالعربية وقبل الكتابة. وما تحت فعاليةٍ محذوفة لا يُفتح بعنوانه المباشر.
//   ٣) كشف التكرار بثلاثة مفاتيح داخل الفعالية الواحدة، ولا شيء عبر الفعاليات.
//   ٤) ما لا يتغيّر: نصّ البطاقة الخام، وأثرُ كل كتابة في سجل التدقيق.
// الخدمات تُنادى مباشرةً (كما في personal-tasks-and-notes.test.js)، والقاعدة مؤقتة تُبنى
// بالترحيلات الحقيقية وتُبذر منحُها من المصفوفة الحقيقية.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-events-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, ev;
const T = new Date().toISOString();
const TODAY = T.slice(0, 10);
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

const user = (id, role, extra = {}) => ({
  id, username: id.replace(/^u_/, ''), role_id: role, sector_id: 'SOL', scope: 'own',
  projectIds: new Set(), teamIds: new Set(), ...extra,
});
// قائد القطاع يدير الفعالية، واستشاريان يلتقطان (أحدهما يحاول تعديل بطاقة الآخر)، ومشاهدٌ يقرأ
// فقط، وحسابُ بوابةٍ خارجية لا يرى شيئاً.
const LEAD = user('u_lead', 'sector_lead', { name_ar: 'قائد القطاع', scope: 'sector' });
const SARA = user('u_sara', 'consultant', { name_ar: 'سارة' });
const KHALID = user('u_khalid', 'consultant', { name_ar: 'خالد' });
const VIEWER = user('u_viewer', 'viewer', { name_ar: 'مشاهد', scope: 'sector' });
// رئيس تطوير الأعمال: دورُ مراجعةٍ يعدّل كل بطاقة، ولا منحَ حذفٍ له في المصفوفة (قاعدته العامة).
const BD_HEAD = user('u_bdhead', 'bd_head', { name_ar: 'رئيس تطوير الأعمال', scope: 'company' });
const EXT = user('u_ext', 'external', { name_ar: 'زائر', sector_id: null });
const CTX = (u) => ({ user: u, ip: '127.0.0.1' });
// صورٌ بحجم الاختبار لسيناريو العزل (E2): ترويسة JPEG صحيحة وحشوٌ يختلف بالبذرة فتختلف البصمة.
const IMG = (seed) => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(64, seed)]);

let EV1, EV2, C1, C2, C3, C4, C5, P1;

// الجداول المحمية وعمود «آخر تعديل» في كلٍّ منها (ليس لكلها updated_at).
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

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ev = await import('../../src/modules/events/events.js');
  for (const [id, name] of [['SOL', 'قطاع الحلول'], ['CONS', 'قطاع الاستشارات']]) {
    await db.insert('sector', { id, name_ar: name, kind: 'delivery', active: 1, created_at: T });
  }
  for (const u of [LEAD, SARA, KHALID, VIEWER, BD_HEAD, EXT]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  // شهودُ العزل: صفٌّ في كل جدولٍ محميّ، كي يكون «لم يتغيّر شيء» حكماً على شيءٍ موجود لا على فراغ.
  await db.insert('client', { id: 'ISO-CL', name_ar: 'عميل شاهد', created_at: T });
  await db.insert('contact', { id: 'ISO-CT', client_id: 'ISO-CL', name: 'جهة اتصال شاهدة', created_at: T });
  await db.insert('opportunity', { id: 'ISO-OPP', title_ar: 'فرصة شاهدة', client_id: 'ISO-CL', sector_id: 'SOL', created_at: T });
  await db.insert('project', { id: 'ISO-PRJ', name_ar: 'مشروع شاهد', sector_id: 'SOL', status: 'ACTIVE', created_at: T });
  await db.insert('document', { id: 'ISO-DOC', name: 'مستند شاهد', project_id: 'ISO-PRJ', created_at: T });
  await db.insert('document_blob', { document_id: 'ISO-DOC', content: Buffer.from('شاهد'), mime: 'text/plain', created_at: T });
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── الترحيلة ──────────────────────────────────────────────────────────────────
test('الترحيلة ٠٣٨ مطبَّقة مرة واحدة، وملفها بلا علامة استفهام لاتينية ولا ALTER TABLE، وكل عبارة فيها IF NOT EXISTS', async () => {
  const applied = await db.all("SELECT version FROM schema_migration WHERE version = '038_events.sql'");
  assert.equal(applied.length, 1, 'الترحيلة لم تُسجَّل مرة واحدة بالضبط');
  assert.ok(readdirSync(join(ROOT, 'migrations')).includes('038_events.sql'));
  const sql = readFileSync(join(ROOT, 'migrations/038_events.sql'), 'utf8');
  // علامة الاستفهام تُفحص في الملف كله — التعليق يمرّ على المُحوِّل كما تمرّ العبارة.
  assert.ok(!sql.includes('?'), 'علامة استفهام لاتينية في الترحيلة — تُفسد الربط على Postgres');
  // أما العبارات فتُفحص بعد إسقاط التعليقات: رأسُ الملف يذكر «ALTER TABLE» ليمنعه لا ليفعله.
  const code = sql.replace(/--[^\n]*/g, '');
  assert.ok(!/ALTER\s+TABLE/i.test(code), 'ALTER TABLE ممنوع هنا (فخّ الترحيلة ٠٣٥)');
  const creates = code.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b[^\n]*/gi) || [];
  assert.equal(creates.length, 14, 'أربعة جداول وعشرة فهارس');
  for (const c of creates) assert.match(c, /IF NOT EXISTS/, `عبارة بلا IF NOT EXISTS: ${c}`);
  const tables = (await db.all(`SELECT name FROM sqlite_master WHERE type = 'table'
     AND name IN ('event', 'event_contact', 'event_partner', 'event_blob') ORDER BY name`)).map((r) => r.name);
  assert.deepEqual(tables, ['event', 'event_blob', 'event_contact', 'event_partner']);
  const idx = (await db.all(`SELECT name FROM sqlite_master WHERE type = 'index'
     AND (name LIKE 'ix_ev%' OR name LIKE 'ux_ev%' OR name = 'ix_event_dates') ORDER BY name`)).map((r) => r.name);
  for (const must of ['ix_event_dates', 'ix_evc_event_time', 'ix_evc_event_phone', 'ix_evc_event_name', 'ix_evc_event_email',
    'ix_evc_captured_by', 'ux_evc_capture_key', 'ix_evp_event', 'ix_evb_ref', 'ix_evb_event']) {
    assert.ok(idx.includes(must), `الفهرس ${must} غائب`);
  }
  // والفهرس الفريد على (kind, ref_id) أُسقط في الترحيلة ٠٤١ — بقاؤه يعني أن البطاقة ما زالت
  // تحمل صورةً واحدة تمحو ما قبلها (حادثة LEAP)، وأن إدراج الصورة الثانية سيُردّ.
  assert.ok(!idx.includes('ux_evb_ref'), 'الفهرس الفريد ux_evb_ref ما زال قائماً — الترحيلة ٠٤١ لم تُطبَّق');
});

// ── الفعالية ──────────────────────────────────────────────────────────────────
test('قائد القطاع ينشئ فعالية ويُكتب أثرها — والاستشاري والمشاهد يُرَدّان بالعربية قبل أي كتابة', async () => {
  EV1 = await ev.createEvent(CTX(LEAD), { name_ar: 'معرض التقنية', venue: 'الرياض', starts_on: day(-1), ends_on: day(2), booth_no: 'H2-14' });
  assert.match(EV1.id, /^evt_/);
  assert.equal(EV1.status, 'جارية');
  assert.equal(EV1.created_by, LEAD.id);
  assert.equal(EV1.created_by_name, 'قائد القطاع');
  const a = await db.get("SELECT * FROM audit_log WHERE resource = 'event' AND action = 'create' AND resource_id = ?", [EV1.id]);
  assert.ok(a, 'إنشاء الفعالية بلا أثر');
  assert.equal(a.user_id, LEAD.id);
  const before = Number((await db.get('SELECT COUNT(*) AS n FROM event')).n);
  for (const u of [SARA, KHALID, VIEWER, EXT]) {
    await assert.rejects(() => ev.createEvent(CTX(u), { name_ar: 'محاولة', starts_on: TODAY, ends_on: TODAY }),
      (e) => e.status === 403 && /قائد القطاع أو مدير النظام/.test(e.message), `الدور ${u.role_id} أنشأ فعالية`);
  }
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM event')).n), before, 'الرفض كتب صفاً');
  await assert.rejects(() => ev.createEvent(CTX(LEAD), { starts_on: TODAY, ends_on: TODAY }),
    (e) => e.status === 400 && /اسم الفعالية/.test(e.message));
  await assert.rejects(() => ev.createEvent(CTX(LEAD), { name_ar: 'x', starts_on: '2026-09-10', ends_on: '2026-09-01' }),
    (e) => e.status === 400 && /قبل تاريخ البداية/.test(e.message));
  await assert.rejects(() => ev.createEvent(CTX(LEAD), { name_ar: 'x', starts_on: '10/09/2026', ends_on: '2026-09-11' }),
    (e) => e.status === 400 && /سنة-شهر-يوم/.test(e.message));
  await assert.rejects(() => ev.createEvent(CTX(LEAD), { name_ar: 'x', starts_on: '2026-02-30', ends_on: '2026-03-01' }),
    (e) => e.status === 400 && /سنة-شهر-يوم/.test(e.message), 'تاريخٌ لا وجود له يمرّ');
  const list = await ev.listEvents(SARA, {});
  const mine = list.find((e) => e.id === EV1.id);
  assert.ok(mine, 'الاستشاري لا يرى الفعالية');
  assert.equal(mine.contacts, 0);
  assert.equal(mine.status, 'جارية');
  assert.equal((await ev.getEvent(SARA, EV1.id)).booth_no, 'H2-14');
  await assert.rejects(() => ev.getEvent(SARA, 'evt_nope'), (e) => e.status === 404 && /الفعالية غير موجودة/.test(e.message));
});

test('حالة الفعالية تُحسب من تاريخيها وختم إغلاقها — والمُطبِّعات تُوحِّد الجوال والاسم والجهة والبريد', () => {
  const row = { starts_on: '2026-09-10', ends_on: '2026-09-12', closed_at: null };
  assert.equal(ev.eventStatus(row, '2026-09-01'), 'قادمة');
  assert.equal(ev.eventStatus(row, '2026-09-10'), 'جارية');
  assert.equal(ev.eventStatus(row, '2026-09-12'), 'جارية');
  assert.equal(ev.eventStatus(row, '2026-09-13'), 'منتهية');
  assert.equal(ev.eventStatus({ ...row, closed_at: T }, '2026-09-11'), 'مُغلقة');
  for (const raw of ['+966 50 123 4567', '00966501234567', '0501234567', '٠٥٠١٢٣٤٥٦٧', '501234567', '966-50-123-4567']) {
    assert.equal(ev.normalizePhone(raw), '0501234567', raw);
  }
  assert.equal(ev.normalizePhone('+971 50 123 4567'), '971501234567');
  assert.equal(ev.normalizePhone('12345'), null, 'أقل من سبعة أرقام ليس رقماً');
  assert.equal(ev.normalizePhone(null), null);
  assert.equal(ev.normalizePerson('م. أحمد العلي'), ev.normalizePerson('احمد العلي'));
  assert.equal(ev.normalizePerson('Eng. Ahmed Ali'), 'ahmed ali');
  assert.equal(ev.normalizePerson('محمد'), 'محمد', 'أوّل «محمد» ليس لقباً');
  assert.equal(ev.normalizeOrg('شركة النخبة'), ev.normalizeOrg('شركه النخبه'));
  assert.equal(ev.normalizeEmail(' A@B.SA '), 'a@b.sa');
  assert.equal(ev.normalizeEmail(''), null);
  assert.deepEqual(ev.CARD_KINDS, ['تعريف بالشركة', 'شراكة', 'تعاون', 'توظيف']);
  assert.deepEqual(ev.OUTCOMES, ['لم تُراجع', 'تواصلنا', 'صارت فرصة', 'صارت شراكة', 'لا متابعة']);
  assert.deepEqual(ev.REVIEW_ROLES, ['admin', 'sector_lead', 'bd_head', 'ceo_office']);
  assert.equal(ev.PARTNER_KINDS.length, 6);
  assert.equal(ev.PARTNER_STATUSES.length, 6);
});

// ── الالتقاط ──────────────────────────────────────────────────────────────────
test('الاستشارية تلتقط بطاقة فتعود البطاقة بمفاتيحها المطبَّعة ويُكتب الأثر', async () => {
  const r = await ev.createContact(CTX(SARA), EV1.id, {
    kind: 'تعريف بالشركة', person_name: 'م. أحمد العلي', org_name: 'شركة النخبة للاستشارات', job_title: 'مدير المبيعات',
    phone: '+966 50 123 4567', email: 'Ahmed@Elite.sa', website: 'www.elite.sa', note: 'مهتم بالتحول الرقمي',
    raw_text: 'م. أحمد العلي\nشركة النخبة للاستشارات\n+966 50 123 4567', capture_key: 'k-1', sector_id: 'SOL',
  });
  C1 = r.contact;
  assert.equal(r.resumed, false);
  assert.equal(r.possibleDuplicate, null);
  assert.match(C1.id, /^evc_/);
  assert.equal(C1.event_id, EV1.id);
  assert.equal(C1.phone_norm, '0501234567');
  assert.equal(C1.email_norm, 'ahmed@elite.sa');
  assert.equal(C1.name_norm, 'احمد العلي', 'اللقب لم يُنزع أو الهمزة لم تُطوَ');
  assert.equal(C1.org_norm, 'شركه النخبه للاستشارات');
  assert.equal(C1.outcome, 'لم تُراجع');
  assert.equal(C1.captured_by, SARA.id);
  assert.equal(C1.captured_by_name, 'سارة');
  assert.equal(C1.has_photo, 0);
  assert.equal(C1.possible_duplicate_of, null);
  assert.ok(C1.raw_text.includes('النخبة'), 'النصّ الخام لم يُحفظ');
  const a = await db.get("SELECT * FROM audit_log WHERE resource = 'event_contact' AND action = 'create' AND resource_id = ?", [C1.id]);
  assert.ok(a, 'الالتقاط بلا أثر');
  assert.equal(a.user_id, SARA.id);
  assert.equal(a.sector_id, 'SOL');
  const d = JSON.parse(a.detail_json);
  assert.equal(d.event_id, EV1.id);
  assert.equal(d.kind, 'تعريف بالشركة');
  assert.equal(d.dup, null);
});

test('إعادة إرسال مفتاح الالتقاط تعود بالصفّ نفسه — بلا صفّ ثانٍ ولا أثر ثانٍ، ومفتاح الزميل يُرَدّ', async () => {
  const before = Number((await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE resource = 'event_contact'")).n);
  const again = await ev.createContact(CTX(SARA), EV1.id, { kind: 'شراكة', person_name: 'اسم مختلف تماماً', capture_key: 'k-1' });
  assert.equal(again.resumed, true);
  assert.equal(again.contact.id, C1.id);
  assert.equal(again.contact.person_name, 'م. أحمد العلي', 'أُعيدت كتابة البطاقة بدل إعادتها كما هي');
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM event_contact WHERE event_id = ?', [EV1.id])).n), 1, 'صفٌّ ثانٍ بالمفتاح نفسه');
  assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE resource = 'event_contact'")).n), before, 'إعادة الإرسال كتبت أثراً');
  await assert.rejects(() => ev.createContact(CTX(KHALID), EV1.id, { kind: 'شراكة', person_name: 'خالد يعيد مفتاح غيره', capture_key: 'k-1' }),
    (e) => e.status === 400 && /زميل/.test(e.message));
});

test('التحقق: نوع البطاقة من القائمة، وحقلٌ واحد على الأقل، والقطاع موجود — والحقول الطويلة تُقصّ', async () => {
  await assert.rejects(() => ev.createContact(CTX(SARA), EV1.id, { kind: 'غير معروف', person_name: 'فلان الفلاني' }),
    (e) => e.status === 400 && /نوع البطاقة غير معروف/.test(e.message));
  await assert.rejects(() => ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', job_title: 'مدير' }),
    (e) => e.status === 400 && /حقل واحد يكفي/.test(e.message));
  await assert.rejects(() => ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'فلان الفلاني', sector_id: 'NOPE' }),
    (e) => e.status === 400 && /القطاع غير موجود/.test(e.message));
  await assert.rejects(() => ev.createContact(CTX(SARA), 'evt_nope', { kind: 'تعاون', person_name: 'فلان الفلاني' }),
    (e) => e.status === 404 && /الفعالية غير موجودة/.test(e.message));
  const big = await ev.createContact(CTX(SARA), EV1.id, { kind: 'توظيف', person_name: 'ن'.repeat(500), note: 'م'.repeat(5000), raw_text: 'ر'.repeat(20000) });
  assert.equal(big.contact.person_name.length, 160);
  assert.equal(big.contact.note.length, 4000);
  assert.equal(big.contact.raw_text.length, 12000);
  await ev.deleteContact(CTX(SARA), big.contact.id);
});

test('المحارف الضابطة تُنزَع من كل حقل: NUL وسطرٌ جديد في الاسم يزولان، والملاحظة والنصّ الخام يحتفظان بأسطرهما بلا NUL — والقصّ بالحرف لا يشطر رمزاً تعبيرياً', async () => {
  const r = await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون',
    person_name: 'أحمد\u0000 \r\nالعلي', org_name: 'شركة\t\u001Fالنخبة  الرقمية', job_title: '\u0007مدير\u007F',
    note: 'سطر أول\r\nسطر\u0000 ثانٍ   بفراغات', raw_text: 'الاسم: أحمد\nالجهة: النخبة\u0000' });
  const c = r.contact;
  assert.equal(c.person_name, 'أحمد العلي');
  assert.equal(c.org_name, 'شركة النخبة الرقمية');
  assert.equal(c.job_title, 'مدير');
  assert.equal(c.note, 'سطر أول\nسطر ثانٍ بفراغات', 'الملاحظة فقدت سطرها أو أبقت NUL');
  assert.equal(c.raw_text, 'الاسم: أحمد\nالجهة: النخبة', 'النصّ الخام فقد سطره أو أبقى NUL');
  const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
  for (const v of [c.person_name, c.org_name, c.job_title, c.note, c.raw_text]) assert.ok(!CTRL.test(v), 'محرفٌ ضابط بقي');
  assert.equal(c.name_norm, 'احمد العلي', 'المفتاح المطبَّع بُني على النصّ قبل التنظيف');
  // القصّ بالحرف: رمزٌ تعبيري في الحرف المئة والستين يبقى كاملاً — لا نصفَ زوجٍ بديل.
  const long = await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'ن'.repeat(159) + '😀' + 'زيادة' });
  assert.ok(long.contact.person_name.isWellFormed(), 'نصفُ زوجٍ بديل في الاسم');
  assert.equal(Array.from(long.contact.person_name).length, 160);
  assert.ok(long.contact.person_name.endsWith('😀'));
  // وفي التعديل والمتابعة الطريقُ نفسه.
  const u = await ev.updateContact(CTX(SARA), c.id, { job_title: 'مدير\u0000 التقنية' });
  assert.equal(u.job_title, 'مدير التقنية');
  const o = await ev.setOutcome(CTX(SARA), c.id, { outcome: 'تواصلنا', outcome_note: 'اتصلنا\u0000\r\nوردّ' });
  assert.equal(o.outcome_note, 'اتصلنا\nوردّ');
  for (const x of [c, long.contact]) await ev.deleteContact(CTX(SARA), x.id);
});

// ── التكرار ───────────────────────────────────────────────────────────────────
test('التكرار يُكشف بالجوال ولو اختلفت صيغته — ويُشار إلى الأقدم ويُكتب في الأثر', async () => {
  const r = await ev.createContact(CTX(KHALID), EV1.id, { kind: 'شراكة', person_name: 'شخص آخر تماماً', phone: '0501234567', capture_key: 'k-2' });
  C2 = r.contact;
  assert.equal(C2.possible_duplicate_of, C1.id);
  assert.equal(r.possibleDuplicate.id, C1.id);
  assert.equal(r.possibleDuplicate.captured_by_name, 'سارة');
  assert.equal(r.possibleDuplicate.raw_text, undefined, 'ملخّص الأقدم لا يحمل نصّها الخام');
  const a = await db.get("SELECT detail_json FROM audit_log WHERE resource = 'event_contact' AND action = 'create' AND resource_id = ?", [C2.id]);
  assert.equal(JSON.parse(a.detail_json).dup, C1.id);
});

test('وبالاسم والجهة معاً رغم اختلاف الهمزة والتاء المربوطة واللقب', async () => {
  const r = await ev.createContact(CTX(KHALID), EV1.id, { kind: 'تعاون', person_name: 'احمد العلي', org_name: 'شركه النخبه للاستشارات', phone: '0555555555' });
  C3 = r.contact;
  assert.equal(C3.possible_duplicate_of, C1.id);
});

test('وبالبريد مهما اختلفت حالة الأحرف', async () => {
  const r = await ev.createContact(CTX(KHALID), EV1.id, { kind: 'توظيف', person_name: 'أبو أحمد', email: 'AHMED@ELITE.SA', capture_key: 'k-4' });
  C4 = r.contact;
  assert.equal(C4.possible_duplicate_of, C1.id);
});

test('ولا يُكشف عبر الفعاليات، ولا للاسم نفسه في جهة أخرى، ولا للفارغ بالفارغ', async () => {
  EV2 = await ev.createEvent(CTX(LEAD), { name_ar: 'مؤتمر البيانات', starts_on: day(-3), ends_on: day(-2) });
  assert.equal(EV2.status, 'منتهية');
  const other = await ev.createContact(CTX(SARA), EV2.id, { kind: 'شراكة', person_name: 'أحمد العلي', org_name: 'شركة النخبة للاستشارات', phone: '0501234567', email: 'ahmed@elite.sa' });
  assert.equal(other.contact.possible_duplicate_of, null, 'كُشف تكرار عبر فعاليتين');
  const r = await ev.createContact(CTX(SARA), EV1.id, { kind: 'شراكة', person_name: 'أحمد العلي', org_name: 'شركة أخرى', phone: '0566666666' });
  C5 = r.contact;
  assert.equal(C5.possible_duplicate_of, null, 'الاسم نفسه في جهة أخرى ليس تكراراً');
  const bare = await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', org_name: 'جهة بلا شخص' });
  const bare2 = await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', org_name: 'جهة أخرى بلا شخص' });
  assert.equal(bare.contact.possible_duplicate_of, null);
  assert.equal(bare2.contact.possible_duplicate_of, null, 'بطاقتان بلا جوال ولا بريد ولا اسم قورنتا فارغاً بفارغ');
});

// ── التعديل ───────────────────────────────────────────────────────────────────
test('نصّ البطاقة الخام لا يتغيّر بالتعديل — والتعديل يُعيد فحص التكرار على ما التُقط قبلها', async () => {
  const before = (await ev.getContact(SARA, C1.id)).raw_text;
  const u = await ev.updateContact(CTX(SARA), C1.id, { raw_text: 'نصّ مزوَّر', note: 'ملاحظة محدَّثة', job_title: 'المدير التنفيذي' });
  assert.equal(u.raw_text, before, 'النصّ الخام تغيّر عبر التعديل');
  assert.equal(u.note, 'ملاحظة محدَّثة');
  assert.equal(u.job_title, 'المدير التنفيذي');
  assert.ok(u.updated_at);
  assert.equal((await db.get('SELECT raw_text FROM event_contact WHERE id = ?', [C1.id])).raw_text, before);
  // الأصل لا يصير مكرَّراً لنسخه الأحدث بمجرد أن حُرِّر.
  assert.equal(u.possible_duplicate_of, null, 'الأصل أشار إلى نسخته الأحدث');
  // وبطاقةٌ تُعطى جوالَ بطاقةٍ أقدم تُعلَّم مكرَّرة.
  const u5 = await ev.updateContact(CTX(SARA), C5.id, { phone: '+966501234567' });
  assert.equal(u5.phone_norm, '0501234567');
  assert.equal(u5.possible_duplicate_of, C1.id);
  await assert.rejects(() => ev.updateContact(CTX(SARA), C1.id, { raw_text: 'x', capture_key: 'y', outcome: 'تواصلنا' }),
    (e) => e.status === 400 && /حدّد ما تريد تغييره/.test(e.message), 'حقولٌ لا تمرّ من التعديل عُدّت تغييراً');
  await assert.rejects(() => ev.updateContact(CTX(KHALID), C2.id, { person_name: '', phone: '' }),
    (e) => e.status === 400 && /حقل واحد يكفي/.test(e.message), 'بطاقة بلا اسم ولا جهة ولا جوال قُبلت');
  await assert.rejects(() => ev.updateContact(CTX(KHALID), C2.id, { kind: 'لا نوع' }), (e) => /نوع البطاقة/.test(e.message));
  const a = await db.get("SELECT detail_json FROM audit_log WHERE resource = 'event_contact' AND action = 'update' AND resource_id = ? ORDER BY at DESC LIMIT 1", [C5.id]);
  assert.deepEqual(JSON.parse(a.detail_json).fields, ['phone']);
});

// v5.67: البطاقة أمانةُ الفريق لا أمانةُ ملتقِطها — التعديل بمنح المصفوفة وحده، والحذف على
// قاعدة الملكية كما كان (ADR-0013، تعديل ٢٠٢٦-٠٨-٣١).
test('التعديل بالمنح لا بالملكية: المشاهد والخارجي يُرَدّان قبل أي كتابة، ثم الزميل يعدّل بطاقة زميله ويحسم حالها، والملتقِط وقائد القطاع كما كانا', async () => {
  // ① الرفض أولاً — ولا يكتب شيئاً.
  await assert.rejects(() => ev.updateContact(CTX(VIEWER), C1.id, { note: 'من مشاهد' }),
    (e) => e.status === 403 && /ليس ضمن صلاحيتك/.test(e.message), 'المشاهد عدّل بطاقة غيره');
  await assert.rejects(() => ev.setOutcome(CTX(VIEWER), C1.id, { outcome: 'تواصلنا' }),
    (e) => e.status === 403 && /ليس ضمن صلاحيتك/.test(e.message));
  await assert.rejects(() => ev.updateContact(CTX(EXT), C1.id, { note: 'من خارجي' }),
    (e) => e.status === 403 && /خارج صلاحياتك/.test(e.message));
  // والحذف يبقى على قاعدته: الزميل لا يحذف بطاقة زميله وإن كان يعدّلها.
  await assert.rejects(() => ev.deleteContact(CTX(KHALID), C1.id),
    (e) => e.status === 403 && /لمن التقطها/.test(e.message), 'الزميل حذف بطاقة زميله');
  const row = await db.get('SELECT note, outcome, deleted_at FROM event_contact WHERE id = ?', [C1.id]);
  assert.equal(row.note, 'ملاحظة محدَّثة', 'الرفض كتب');
  assert.equal(row.outcome, 'لم تُراجع');
  assert.equal(row.deleted_at, null);
  // ② ثم النجاح: الزميل يصحّح بطاقة زميله ويحسم حالها — هذا ما تغيّر في v5.67.
  assert.equal((await ev.updateContact(CTX(KHALID), C1.id, { note: 'من زميل' })).note, 'من زميل');
  const o = await ev.setOutcome(CTX(KHALID), C1.id, { outcome: 'تواصلنا' });
  assert.deepEqual([o.outcome, o.outcome_by], ['تواصلنا', KHALID.id], 'الزميل حسم الحال ولم يُسجَّل باسمه');
  // ③ وقائد القطاع والملتقِط كما كانا.
  assert.equal((await ev.updateContact(CTX(LEAD), C1.id, { note: 'من قائد القطاع' })).note, 'من قائد القطاع');
  assert.equal((await ev.updateContact(CTX(KHALID), C2.id, { note: 'خالد يعدّل بطاقته' })).note, 'خالد يعدّل بطاقته');
  // وحال C1 يعود «لم تُراجع» كي تبقى بقية الملف على ما بُنيت عليه.
  await ev.setOutcome(CTX(SARA), C1.id, { outcome: 'لم تُراجع' });
  assert.equal((await db.get('SELECT outcome FROM event_contact WHERE id = ?', [C1.id])).outcome, 'لم تُراجع');
});

test('المشاهد يقرأ ولا يلتقط، والخارجي لا يقرأ شيئاً', async () => {
  assert.ok((await ev.listContacts(VIEWER, EV1.id, {})).length > 0, 'المشاهد لا يرى البطاقات');
  assert.ok((await ev.listEvents(VIEWER, {})).length > 0);
  assert.equal((await ev.getContact(VIEWER, C1.id)).id, C1.id);
  await assert.rejects(() => ev.createContact(CTX(VIEWER), EV1.id, { kind: 'تعاون', person_name: 'فلان الفلاني' }),
    (e) => e.status === 403 && /للمشاهدة فقط/.test(e.message));
  await assert.rejects(() => ev.parseCard(VIEWER, { text: 'نص بطاقة طويل بما يكفي' }), (e) => e.status === 403);
  await assert.rejects(() => ev.createPartner(CTX(VIEWER), EV1.id, { org_name: 'جهة' }),
    (e) => e.status === 403 && /للمشاهدة فقط/.test(e.message), 'الشراكة تُحرس بمنح إنشائها هي');
  for (const fn of [() => ev.listEvents(EXT, {}), () => ev.getEvent(EXT, EV1.id), () => ev.eventSummary(EXT, EV1.id),
    () => ev.listContacts(EXT, EV1.id, {}), () => ev.recentContacts(EXT, EV1.id, {}), () => ev.getContact(EXT, C1.id),
    () => ev.listPartners(EXT, EV1.id)]) {
    await assert.rejects(fn, (e) => e.status === 403 && /خارج صلاحياتك/.test(e.message));
  }
  await assert.rejects(() => ev.createContact(CTX(EXT), EV1.id, { kind: 'تعاون', person_name: 'فلان الفلاني' }), (e) => e.status === 403);
});

// ── الحال ─────────────────────────────────────────────────────────────────────
test('الحال: قيمة غير معروفة تُرَدّ، والمراجِع واسمه ووقته يُسجَّلون مع الأثر', async () => {
  await assert.rejects(() => ev.setOutcome(CTX(LEAD), C1.id, { outcome: 'صار شيئاً' }),
    (e) => e.status === 400 && /قيمة المتابعة غير معروفة/.test(e.message));
  const r = await ev.setOutcome(CTX(LEAD), C1.id, { outcome: 'صارت فرصة', outcome_note: 'تُفتح فرصة بعد الاجتماع' });
  assert.equal(r.outcome, 'صارت فرصة');
  assert.equal(r.outcome_by, LEAD.id);
  assert.equal(r.outcome_by_name, 'قائد القطاع');
  assert.ok(r.outcome_at);
  assert.equal(r.outcome_note, 'تُفتح فرصة بعد الاجتماع');
  const a = await db.get("SELECT detail_json, user_id FROM audit_log WHERE resource = 'event_contact' AND action = 'update' AND resource_id = ? ORDER BY at DESC LIMIT 1", [C1.id]);
  assert.equal(JSON.parse(a.detail_json).outcome, 'صارت فرصة');
  assert.equal(a.user_id, LEAD.id);
  const own = await ev.setOutcome(CTX(KHALID), C2.id, { outcome: 'لا متابعة' });
  assert.equal(own.outcome_by, KHALID.id, 'الملتقِط يحسم حال بطاقته');
  assert.equal(own.outcome_note, null);
});

// ── القوائم ───────────────────────────────────────────────────────────────────
test('القوائم: الأحدث أولاً، والبحث بالنصّ وبالرقم بأي صيغة، والمرشّحات، و«آخر ما التقطت» وعدّاد الفريق اليوم', async () => {
  const rows = await ev.listContacts(SARA, EV1.id, {});
  assert.equal(rows.length, 7);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].captured_at >= rows[i].captured_at, 'الأحدث ليس أولاً');
  assert.ok(rows.every((c) => c.raw_text === undefined), 'القائمة تحمل النصّ الخام');
  assert.ok(rows.every((c) => c.has_photo === 0));
  assert.ok(rows.every((c) => 'photo_sha' in c && c.photo_sha === null), 'بصمة الصورة غائبة عن القائمة أو غير فارغة بلا صورة');
  assert.deepEqual((await ev.listContacts(SARA, EV1.id, { q: 'النخبة' })).map((c) => c.id), [C1.id]);
  assert.deepEqual((await ev.listContacts(SARA, EV1.id, { q: 'ELITE' })).map((c) => c.id).sort(), [C1.id, C4.id].sort(), 'البحث في البريد بلا حساسية للحالة');
  assert.deepEqual((await ev.listContacts(SARA, EV1.id, { q: '+966 50 123 4567' })).map((c) => c.id).sort(), [C1.id, C2.id, C5.id].sort(), 'الرقم بصيغة أخرى لا يجد نظيره المطبَّع');
  assert.deepEqual((await ev.listContacts(SARA, EV1.id, { kind: 'توظيف' })).map((c) => c.id), [C4.id]);
  assert.deepEqual((await ev.listContacts(SARA, EV1.id, { outcome: 'صارت فرصة' })).map((c) => c.id), [C1.id]);
  const mine = await ev.listContacts(KHALID, EV1.id, { mine: '1' });
  assert.equal(mine.length, 3);
  assert.ok(mine.every((c) => c.captured_by === KHALID.id));
  const dups = await ev.listContacts(SARA, EV1.id, { dup: '1' });
  assert.equal(dups.length, 4);
  assert.ok(dups.every((c) => c.possible_duplicate_of === C1.id));
  assert.equal((await ev.listContacts(SARA, EV1.id, { limit: 2 })).length, 2);
  const recent = await ev.recentContacts(SARA, EV1.id, { limit: 3 });
  assert.equal(recent.rows.length, 3);
  assert.ok(recent.rows.every((c) => c.captured_by === SARA.id), '«آخر ما التقطت» أظهرت بطاقات زميل');
  assert.equal(recent.teamToday, 7, 'عدّاد الفريق اليوم لا يعدّ الفعالية كلها');
});

// ── الشراكات ──────────────────────────────────────────────────────────────────
test('الشراكات: إنشاء بتحقق، وربطٌ ببطاقة من الفعالية نفسها فقط، وملكية كالبطاقات', async () => {
  await assert.rejects(() => ev.createPartner(CTX(SARA), EV1.id, {}), (e) => e.status === 400 && /اسم جهة التعاون/.test(e.message));
  await assert.rejects(() => ev.createPartner(CTX(SARA), EV1.id, { org_name: 'علم', partner_kind: 'غير معروف' }), (e) => /نوع الشراكة/.test(e.message));
  await assert.rejects(() => ev.createPartner(CTX(SARA), EV1.id, { org_name: 'علم', status: 'ملغاة' }), (e) => /حالة الشراكة غير معروفة/.test(e.message));
  await assert.rejects(() => ev.createPartner(CTX(SARA), EV1.id, { org_name: 'علم', next_date: 'الأسبوع القادم' }), (e) => /سنة-شهر-يوم/.test(e.message));
  const foreign = (await ev.listContacts(SARA, EV2.id, {}))[0];
  await assert.rejects(() => ev.createPartner(CTX(SARA), EV1.id, { org_name: 'علم', contact_id: foreign.id }),
    (e) => e.status === 400 && /ليست من هذه الفعالية/.test(e.message));
  P1 = await ev.createPartner(CTX(SARA), EV1.id, { org_name: 'شركة علم', partner_kind: 'شراكة تقنية', contact_name: 'أحمد',
    phone: '٠٥٠٧٧٧٨٨٨٩', scope_note: 'تكامل تقني', next_step: 'اجتماع', next_date: day(7), contact_id: C1.id });
  assert.match(P1.id, /^evp_/);
  assert.equal(P1.status, 'مبدئية');
  assert.equal(P1.org_norm, 'شركه علم');
  assert.equal(P1.phone, '0507778889', 'الأرقام العربية-الهندية لم تُطوَ');
  assert.equal(P1.contact_id, C1.id);
  assert.equal(P1.captured_by_name, 'سارة');
  const a = await db.get("SELECT user_id FROM audit_log WHERE resource = 'event_partner' AND action = 'create' AND resource_id = ?", [P1.id]);
  assert.equal(a?.user_id, SARA.id, 'إنشاء الشراكة بلا أثر');
  await assert.rejects(() => ev.updatePartner(CTX(KHALID), P1.id, { status: 'نشطة' }),
    (e) => e.status === 403 && /لمن سجّلها/.test(e.message));
  assert.equal((await ev.updatePartner(CTX(LEAD), P1.id, { status: 'قيد النقاش', next_step: 'إرسال عرض' })).status, 'قيد النقاش');
  assert.equal((await ev.updatePartner(CTX(SARA), P1.id, { next_date: '' })).next_date, null);
  const P2 = await ev.createPartner(CTX(KHALID), EV1.id, { org_name: 'مؤسسة تجريبية' });
  await assert.rejects(() => ev.deletePartner(CTX(SARA), P2.id), (e) => e.status === 403);
  await ev.deletePartner(CTX(KHALID), P2.id);
  assert.deepEqual((await ev.listPartners(SARA, EV1.id)).map((p) => p.id), [P1.id]);
  await assert.rejects(() => ev.updatePartner(CTX(LEAD), P2.id, { status: 'نشطة' }), (e) => e.status === 404 && /الشراكة غير موجودة/.test(e.message));
});

test('ملخّص الفعالية: أعداد بنوع البطاقة وحالها واليوم والمكرَّر والشراكات — مطابقة للقوائم', async () => {
  const s = await ev.eventSummary(SARA, EV1.id);
  assert.equal(s.contacts, 7);
  assert.deepEqual(s.byKind, { 'تعريف بالشركة': 1, 'شراكة': 2, 'تعاون': 3, 'توظيف': 1 });
  assert.deepEqual(s.byOutcome, { 'صارت فرصة': 1, 'لا متابعة': 1, 'لم تُراجع': 5 });
  assert.equal(s.today, 7);
  assert.equal(s.unreviewed, 5);
  assert.equal(s.possibleDup, 4);
  assert.equal(s.partners, 1);
  const inList = (await ev.listEvents(SARA, {})).find((e) => e.id === EV1.id);
  assert.equal(inList.contacts, 7);
  assert.equal(inList.partners, 1);
});

// ── الإغلاق والحذف ────────────────────────────────────────────────────────────
test('الفعالية المُغلقة لا تقبل التقاطاً ولا شراكة — وتغيب عن القائمة إلا بطلب — وتعود بإعادة الفتح', async () => {
  const closed = await ev.closeEvent(CTX(LEAD), EV2.id, {});
  assert.equal(closed.status, 'مُغلقة');
  assert.ok(closed.closed_at);
  await assert.rejects(() => ev.createContact(CTX(SARA), EV2.id, { kind: 'تعاون', person_name: 'فلان الفلاني' }),
    (e) => e.status === 400 && /مُغلقة/.test(e.message));
  await assert.rejects(() => ev.createPartner(CTX(SARA), EV2.id, { org_name: 'جهة' }), (e) => e.status === 400 && /مُغلقة/.test(e.message));
  assert.ok(!(await ev.listEvents(SARA, {})).some((e) => e.id === EV2.id), 'المُغلقة ما زالت في القائمة');
  assert.ok((await ev.listEvents(SARA, { includeClosed: '1' })).some((e) => e.id === EV2.id), 'المُغلقة لا تظهر ولو طُلبت');
  await assert.rejects(() => ev.closeEvent(CTX(SARA), EV1.id, {}), (e) => e.status === 403);
  const reopened = await ev.closeEvent(CTX(LEAD), EV2.id, { reopen: true });
  assert.equal(reopened.closed_at, null);
  assert.equal(reopened.status, 'منتهية');
  const upd = await ev.updateEvent(CTX(LEAD), EV2.id, { venue: 'جدة', ends_on: day(1) });
  assert.equal(upd.venue, 'جدة');
  assert.equal(upd.status, 'جارية');
  await assert.rejects(() => ev.updateEvent(CTX(LEAD), EV2.id, { ends_on: day(-10) }), (e) => /قبل تاريخ البداية/.test(e.message));
  await assert.rejects(() => ev.updateEvent(CTX(LEAD), EV2.id, { name_ar: '' }), (e) => /اسم الفعالية/.test(e.message));
  await assert.rejects(() => ev.updateEvent(CTX(SARA), EV2.id, { venue: 'x' }), (e) => e.status === 403);
});

test('الفعاليات الجارية اليوم — بلا حارس، لمن يناديها من الصفحة الرئيسية', async () => {
  const ids = (await ev.activeEvents(TODAY)).map((e) => e.id);
  assert.ok(ids.includes(EV1.id) && ids.includes(EV2.id));
  assert.equal((await ev.activeEvents('2000-01-01')).length, 0);
});

test('حذف البطاقة ناعمٌ على الصفّ وقاطعٌ على صورتها — ومفتاحها بعد الحذف يُرَدّ بالعربية', async () => {
  await db.insert('event_blob', { id: 'evb_t1', event_id: EV1.id, kind: 'card', ref_id: C4.id, content: Buffer.from('img'),
    mime: 'image/jpeg', size_bytes: 3, sha256: 'x', uploaded_by: KHALID.id, created_at: T });
  assert.equal((await ev.getContact(SARA, C4.id)).has_photo, 1);
  assert.equal((await ev.getContact(SARA, C4.id)).photo_sha, 'x', 'بصمة الصورة لا تصحب البطاقة');
  await ev.deleteContact(CTX(KHALID), C4.id);
  const row = await db.get('SELECT deleted_at FROM event_contact WHERE id = ?', [C4.id]);
  assert.ok(row, 'مُحي الصفّ فعلياً بدل إخفائه');
  assert.ok(row.deleted_at);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM event_blob WHERE ref_id = ?', [C4.id])).n), 0, 'الصورة بقيت بلا بطاقة');
  await assert.rejects(() => ev.getContact(SARA, C4.id), (e) => e.status === 404 && /البطاقة غير موجودة/.test(e.message));
  assert.ok(!(await ev.listContacts(SARA, EV1.id, {})).some((c) => c.id === C4.id));
  await assert.rejects(() => ev.createContact(CTX(KHALID), EV1.id, { kind: 'توظيف', person_name: 'فلان الفلاني', capture_key: 'k-4' }),
    (e) => e.status === 400 && /حُذفت من قبل/.test(e.message), 'مفتاح بطاقة محذوفة انفجر بدل رسالة عربية');
});

test('حذف الفعالية ناعم ولقادة القطاعات وحدهم — وما تحتها يختفي معها', async () => {
  await assert.rejects(() => ev.deleteEvent(CTX(SARA), EV2.id), (e) => e.status === 403);
  await ev.deleteEvent(CTX(LEAD), EV2.id);
  await assert.rejects(() => ev.getEvent(SARA, EV2.id), (e) => e.status === 404);
  assert.ok((await db.get('SELECT deleted_at FROM event WHERE id = ?', [EV2.id])).deleted_at);
  await assert.rejects(() => ev.listContacts(SARA, EV2.id, {}), (e) => e.status === 404);
  assert.ok(!(await ev.listEvents(SARA, { includeClosed: '1' })).some((e) => e.id === EV2.id));
});

test('كل كتابة تترك أثراً — إنشاءً وتعديلاً وحذفاً على الفعالية والبطاقة والشراكة — ولا أثر لمن رُدّ', async () => {
  for (const resource of ['event', 'event_contact', 'event_partner']) {
    for (const action of ['create', 'update', 'delete']) {
      const a = await db.get('SELECT id FROM audit_log WHERE resource = ? AND action = ?', [resource, action]);
      assert.ok(a, `كتابةٌ «${action}» على «${resource}» بلا أثر`);
    }
  }
  for (const u of [VIEWER, EXT]) {
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?', [u.id])).n), 0,
      `${u.role_id} لم يكتب شيئاً فلا يكون له أثر`);
  }
});

// ── المصفوفة قبل الملكية (S1) ────────────────────────────────────────────────
test('المصفوفة أولاً ثم الملكية: رئيس تطوير الأعمال يعدّل بطاقة غيره ولا يحذفها، والمشاهد لا يعدّل بطاقته، وقائد القطاع يحذف بطاقة غيره', async () => {
  const mine = (await ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'بطاقة سارة للملكية' })).contact;
  // رئيس تطوير الأعمال: منح التعديل ⟵ يعدّل؛ ولا منح حذف ⟵ لا يحذف بطاقة غيره.
  assert.equal((await ev.updateContact(CTX(BD_HEAD), mine.id, { note: 'من رئيس تطوير الأعمال' })).note, 'من رئيس تطوير الأعمال');
  await assert.rejects(() => ev.deleteContact(CTX(BD_HEAD), mine.id),
    (e) => e.status === 403 && /لمن التقطها/.test(e.message), 'رئيس تطوير الأعمال حذف بطاقة غيره بلا منح حذف');
  assert.equal((await db.get('SELECT deleted_at FROM event_contact WHERE id = ?', [mine.id])).deleted_at, null, 'الرفض حذف');
  // ويحذف بطاقته هو: المالك بمنح التعديل.
  const own = (await ev.createContact(CTX(BD_HEAD), EV1.id, { kind: 'تعاون', person_name: 'بطاقة رئيس تطوير الأعمال' })).contact;
  await ev.deleteContact(CTX(BD_HEAD), own.id);
  assert.ok((await db.get('SELECT deleted_at FROM event_contact WHERE id = ?', [own.id])).deleted_at);
  // مشاهدٌ التقط بطاقةً (قبل أن يُنزَّل دوره مثلاً): الملكية لا تُعوِّض منح التعديل الغائب.
  const vid = 'evc_viewer_owned';
  await db.insert('event_contact', { id: vid, event_id: EV1.id, kind: 'تعاون', person_name: 'بطاقة التقطها مشاهد',
    outcome: 'لم تُراجع', captured_by: VIEWER.id, captured_by_name: 'مشاهد', captured_at: T });
  await assert.rejects(() => ev.updateContact(CTX(VIEWER), vid, { note: 'من صاحبها المشاهد' }), (e) => e.status === 403 && /ليس ضمن صلاحيتك/.test(e.message));
  await assert.rejects(() => ev.setOutcome(CTX(VIEWER), vid, { outcome: 'تواصلنا' }), (e) => e.status === 403);
  await assert.rejects(() => ev.deleteContact(CTX(VIEWER), vid), (e) => e.status === 403);
  const vrow = await db.get('SELECT note, outcome, deleted_at FROM event_contact WHERE id = ?', [vid]);
  assert.deepEqual([vrow.note, vrow.outcome, vrow.deleted_at], [null, 'لم تُراجع', null], 'رفض المشاهد كتب');
  // قائد القطاع يحذف بطاقة غيره: منح الحذف من المصفوفة.
  await ev.deleteContact(CTX(LEAD), mine.id);
  await ev.deleteContact(CTX(LEAD), vid);
  assert.ok((await db.get('SELECT deleted_at FROM event_contact WHERE id = ?', [mine.id])).deleted_at);
  assert.ok((await db.get('SELECT deleted_at FROM event_contact WHERE id = ?', [vid])).deleted_at);
  // والشراكة على القاعدة نفسها.
  const p = await ev.createPartner(CTX(SARA), EV1.id, { org_name: 'شراكة للملكية' });
  assert.equal((await ev.updatePartner(CTX(BD_HEAD), p.id, { status: 'نشطة' })).status, 'نشطة');
  await assert.rejects(() => ev.deletePartner(CTX(BD_HEAD), p.id), (e) => e.status === 403 && /لمن سجّلها/.test(e.message));
  await ev.deletePartner(CTX(LEAD), p.id);
  assert.ok(!(await ev.listPartners(SARA, EV1.id)).some((x) => x.id === p.id));
  // ولا أثر للمشاهد بعد كل هذا الرفض.
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?', [VIEWER.id])).n), 0);
});

// ── ما تحت فعاليةٍ محذوفة (S2) ───────────────────────────────────────────────
test('ما تحت فعاليةٍ محذوفة محذوفٌ معها: البطاقة والشراكة لا تُقرآن ولا تُعدَّلان ولا تُحذفان بعنوانهما المباشر', async () => {
  const E = await ev.createEvent(CTX(LEAD), { name_ar: 'فعالية تُحذف', starts_on: TODAY, ends_on: TODAY });
  const c = (await ev.createContact(CTX(SARA), E.id, { kind: 'تعاون', person_name: 'بطاقة تحت فعالية محذوفة', capture_key: 'k-gone' })).contact;
  const p = await ev.createPartner(CTX(SARA), E.id, { org_name: 'شراكة تحت فعالية محذوفة' });
  assert.equal((await ev.getContact(SARA, c.id)).id, c.id);
  await ev.deleteEvent(CTX(LEAD), E.id);
  const gone = (e) => e.status === 404;
  await assert.rejects(() => ev.getContact(SARA, c.id), gone, 'البطاقة تُقرأ بعد حذف فعاليتها');
  await assert.rejects(() => ev.updateContact(CTX(SARA), c.id, { note: 'x' }), gone);
  await assert.rejects(() => ev.setOutcome(CTX(LEAD), c.id, { outcome: 'تواصلنا' }), gone);
  await assert.rejects(() => ev.deleteContact(CTX(LEAD), c.id), gone);
  await assert.rejects(() => ev.updatePartner(CTX(SARA), p.id, { status: 'نشطة' }), gone);
  await assert.rejects(() => ev.deletePartner(CTX(LEAD), p.id), gone);
  await assert.rejects(() => ev.createContact(CTX(SARA), E.id, { kind: 'تعاون', person_name: 'فلان', capture_key: 'k-gone' }), gone);
  const row = await db.get('SELECT note, outcome, deleted_at FROM event_contact WHERE id = ?', [c.id]);
  assert.deepEqual([row.note, row.outcome, row.deleted_at], [null, 'لم تُراجع', null], 'الرفض كتب');
});

// ── حدود القوائم وأعمدتها (S4، N1) ───────────────────────────────────────────
test('حدّ القائمة عددٌ صحيح دائماً: كسرٌ أو نصٌّ أو صفر لا يُسقط الاستعلام', async () => {
  assert.equal((await ev.listContacts(SARA, EV1.id, { limit: 1.5 })).length, 1);
  assert.equal((await ev.recentContacts(SARA, EV1.id, { limit: '2.7' })).rows.length, 2);
  // كسرٌ دون الواحد يُقرأ صفراً فيسقط إلى الحدّ الافتراضي — لا إلى صفر صفوف ولا إلى خطأ.
  assert.equal((await ev.listContacts(SARA, EV1.id, { limit: 0.2 })).length, (await ev.listContacts(SARA, EV1.id, {})).length, 'كسرٌ دون الواحد أسقط صفوفاً');
  for (const bad of ['abc', 0, -3, null, '', {}, 1e9, '1e3', Infinity]) {
    await assert.doesNotReject(() => ev.listContacts(SARA, EV1.id, { limit: bad }), `الحدّ ${String(bad)} أسقط القائمة`);
    await assert.doesNotReject(() => ev.recentContacts(SARA, EV1.id, { limit: bad }), `الحدّ ${String(bad)} أسقط «آخر ما التقطت»`);
  }
});

test('القوائم لا تحمل مفتاح الالتقاط ولا الصور المطبَّعة ولا النصّ الخام — والبطاقة الواحدة تحمل المطبَّعات والنصّ لا المفتاح', async () => {
  const hidden = ['capture_key', 'phone_norm', 'email_norm', 'name_norm', 'org_norm', 'raw_text'];
  const rows = await ev.listContacts(SARA, EV1.id, {});
  assert.ok(rows.length > 0);
  for (const c of rows) for (const k of hidden) assert.ok(!(k in c), `القائمة تحمل «${k}»`);
  for (const c of rows) assert.ok('has_photo' in c && 'photo_sha' in c && !('content' in c), 'القائمة بلا علامة الصورة وبصمتها — أو تحمل بايتاتها');
  for (const c of (await ev.recentContacts(SARA, EV1.id, {})).rows) for (const k of hidden) assert.ok(!(k in c), `«آخر ما التقطت» تحمل «${k}»`);
  const one = await ev.getContact(SARA, C1.id);
  assert.equal(one.phone_norm, '0501234567');
  assert.ok('raw_text' in one, 'البطاقة الواحدة بلا نصّها الخام');
  assert.ok(!('capture_key' in one), 'البطاقة الواحدة تُخرج مفتاح الالتقاط');
});

// ── سباق مفتاح الالتقاط (S5) ─────────────────────────────────────────────────
test('سباق مفتاح الالتقاط: صفٌّ سابق بالمفتاح نفسه، أو طلبان متزامنان — صفٌّ واحد وأثرٌ واحد وإعادةٌ لا عطل', async () => {
  // خرق التفرّد يُعرف بنصّ سكويلايت وبرمز بوستجريس، ولا يُخلط بغيره.
  assert.equal(ev.isUniqueViolation({ message: 'UNIQUE constraint failed: event_contact.event_id, event_contact.capture_key' }), true);
  assert.equal(ev.isUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "ux_evc_capture_key"' }), true);
  assert.equal(ev.isUniqueViolation({ message: 'NOT NULL constraint failed: event_contact.kind' }), false);
  assert.equal(ev.isUniqueViolation({ code: '23502' }), false);
  assert.equal(ev.isUniqueViolation(null), false);
  // صفٌّ سابق بالمفتاح نفسه لصاحبه (كُتب من خارج الخدمة): يُستأنف كما هو، ولا صفّ ثانٍ.
  await db.insert('event_contact', { id: 'evc_pre_key', event_id: EV1.id, kind: 'تعاون', person_name: 'سابقة بالمفتاح',
    outcome: 'لم تُراجع', capture_key: 'k-race-0', captured_by: SARA.id, captured_by_name: 'سارة', captured_at: T });
  const r0 = await ev.createContact(CTX(SARA), EV1.id, { kind: 'شراكة', person_name: 'أخرى', capture_key: 'k-race-0' });
  assert.equal(r0.resumed, true);
  assert.equal(r0.contact.id, 'evc_pre_key');
  assert.equal(r0.contact.person_name, 'سابقة بالمفتاح');
  const n = async (key) => Number((await db.get('SELECT COUNT(*) AS n FROM event_contact WHERE event_id = ? AND capture_key = ?', [EV1.id, key])).n);
  assert.equal(await n('k-race-0'), 1);
  // طلبان متزامنان بالمفتاح نفسه: كلاهما يمرّ من فحص المفتاح قبل أن يكتب أحدهما — الفهرس الفريد
  // يوقف الثاني فيُعاد الصفّ الأول (على سكويلايت الثاني ينضمّ إلى معاملة الأول ويفشل إدراجه وحده).
  const audits = async () => Number((await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE resource = 'event_contact' AND action = 'create'")).n);
  const before = await audits();
  const [a, b] = await Promise.all([
    ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'سباق أ', capture_key: 'k-race-1' }),
    ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'سباق ب', capture_key: 'k-race-1' }),
  ]);
  assert.equal(a.contact.id, b.contact.id, 'صفّان لمفتاحٍ واحد');
  assert.deepEqual([a.resumed, b.resumed].sort(), [false, true], 'واحدٌ كتب والآخر استأنف');
  assert.equal(await n('k-race-1'), 1);
  assert.equal(await audits(), before + 1, 'أثران لكتابةٍ واحدة');
  // ومفتاح الزميل في السباق يُرَدّ بالعربية لا بخطأ قاعدة.
  const settled = await Promise.allSettled([
    ev.createContact(CTX(SARA), EV1.id, { kind: 'تعاون', person_name: 'سباق ج', capture_key: 'k-race-2' }),
    ev.createContact(CTX(KHALID), EV1.id, { kind: 'تعاون', person_name: 'سباق د', capture_key: 'k-race-2' }),
  ]);
  const ok = settled.filter((s) => s.status === 'fulfilled');
  const ko = settled.filter((s) => s.status === 'rejected');
  assert.equal(ok.length, 1, 'واحدٌ فقط يكتب');
  assert.equal(ko.length, 1);
  assert.ok(ko[0].reason.status === 400 && /زميل/.test(ko[0].reason.message), `الزميل رُدّ بخطأ قاعدة: ${ko[0].reason.message}`);
  assert.equal(await n('k-race-2'), 1);
});

test('قراءة البطاقة: البوابة، والنصّ القصير، والوضع محلي دائماً مع تنبيه المراجعة', async () => {
  await assert.rejects(() => ev.parseCard(SARA, { text: 'قص' }), (e) => e.status === 400 && /سطر واحد يكفي/.test(e.message));
  // القصّ قبل التشذيب: فراغٌ أطول من الحدّ ثم كلام — يُحدّ أولاً فلا يبقى ما يُقرأ.
  await assert.rejects(() => ev.parseCard(SARA, { text: ' '.repeat(13000) + 'أحمد العلي' }), (e) => e.status === 400, 'التشذيب سبق القصّ');
  await assert.rejects(() => ev.parseCard(SARA, {}), (e) => e.status === 400);
  const r = await ev.parseCard(SARA, { text: 'أحمد العلي\nشركة النخبة\nجوال ٠٥٠١٢٣٤٥٦٧' });
  assert.equal(r._mode, 'local');
  assert.match(r._note, /محلياً/);
  assert.equal(r.phone, '0501234567');
  assert.equal(r.org_name, 'شركة النخبة');
  assert.equal(r.person_name, 'أحمد العلي');
});

// ── العزل: بيت القصيد ─────────────────────────────────────────────────────────
test('العزل: سيناريو كامل في الفعاليات لا يحرّك صفاً واحداً في الفرص والعملاء وجهات الاتصال والمشاريع والمستندات', async () => {
  const before = await snapshot();
  for (const [t] of PROTECTED) assert.equal(before[t].n, 1, `الشاهد في ${t} غائب — الفحص يقيس لا شيء`);

  const A = await ev.createEvent(CTX(LEAD), { name_ar: 'معرض العزل الأول', starts_on: TODAY, ends_on: TODAY });
  const B = await ev.createEvent(CTX(LEAD), { name_ar: 'معرض العزل الثاني', starts_on: TODAY, ends_on: day(1) });
  // أسماءٌ تُطابق الشهود عمداً: «عميل شاهد» و«فرصة شاهدة» و«مشروع شاهد» — فلو حاول شيءٌ أن يربط
  // بطاقةً بسجلٍّ قائم بالاسم لظهر هنا.
  const a1 = (await ev.createContact(CTX(SARA), A.id, { kind: 'تعريف بالشركة', person_name: 'عميل شاهد', org_name: 'عميل شاهد',
    phone: '0501112222', email: 'iso@test.sa', raw_text: 'بطاقة العزل' })).contact;
  const a2 = (await ev.createContact(CTX(KHALID), A.id, { kind: 'شراكة', person_name: 'آخر مختلف', phone: '+966 50 111 2222' })).contact;
  const a3 = (await ev.createContact(CTX(KHALID), A.id, { kind: 'تعاون', person_name: 'عميل شاهد', org_name: 'عميل شاهد' })).contact;
  const a4 = (await ev.createContact(CTX(SARA), A.id, { kind: 'توظيف', person_name: 'خالد عبدالله', email: 'ISO@test.sa' })).contact;
  const b1 = (await ev.createContact(CTX(SARA), B.id, { kind: 'شراكة', person_name: 'عميل شاهد', org_name: 'عميل شاهد', phone: '0501112222' })).contact;
  const b2 = (await ev.createContact(CTX(SARA), B.id, { kind: 'تعاون', org_name: 'فرصة شاهدة', note: 'مشروع شاهد' })).contact;
  assert.equal(a2.possible_duplicate_of, a1.id);
  assert.equal(a3.possible_duplicate_of, a1.id);
  assert.equal(a4.possible_duplicate_of, a1.id);
  assert.equal(b1.possible_duplicate_of, null);
  assert.equal(b2.possible_duplicate_of, null);
  const p1 = await ev.createPartner(CTX(SARA), A.id, { org_name: 'عميل شاهد', partner_kind: 'شراكة تقنية', contact_id: a1.id });
  const p2 = await ev.createPartner(CTX(KHALID), B.id, { org_name: 'مشروع شاهد', status: 'قيد النقاش' });
  // صورٌ (E2): بطاقتان مصوَّرتان وصورةٌ ثانية على إحداهما (تُضاف ولا تستبدل منذ v5.67)، ورمزا
  // كشك — أحدهما يُحذف بنفسه والآخر مع فعاليته.
  await ev.attachContactPhoto(CTX(SARA), a1.id, IMG(1), { fileName: 'card.jpg' });
  await ev.attachContactPhoto(CTX(KHALID), a2.id, IMG(2));
  await ev.attachContactPhoto(CTX(LEAD), a1.id, IMG(3));
  const q1 = await ev.addQr(CTX(LEAD), A.id, IMG(4), { title: 'رابط التسجيل' });
  await ev.addQr(CTX(LEAD), B.id, IMG(5), { title: 'ملف الشركة' });
  await ev.setOutcome(CTX(LEAD), a1.id, { outcome: 'صارت فرصة', outcome_note: 'تُفتح فرصة يدوياً من شاشة الفرص' });
  await ev.setOutcome(CTX(LEAD), a3.id, { outcome: 'صارت شراكة' });
  await ev.setOutcome(CTX(SARA), a4.id, { outcome: 'لا متابعة' });
  await ev.updateContact(CTX(SARA), a1.id, { job_title: 'المدير' });
  await ev.updatePartner(CTX(KHALID), p2.id, { status: 'نشطة' });
  await ev.deleteContact(CTX(KHALID), a2.id);
  await ev.deletePartner(CTX(SARA), p1.id);
  await ev.deleteQr(CTX(LEAD), A.id, q1.id);
  await ev.closeEvent(CTX(LEAD), A.id, {});
  await ev.deleteEvent(CTX(LEAD), B.id);

  const after = await snapshot();
  for (const [t] of PROTECTED) {
    assert.equal(after[t].n, before[t].n, `${t}: تغيّر العدد`);
    assert.equal(after[t].t, before[t].t, `${t}: تغيّر آخر تعديل`);
    assert.equal(after[t].body, before[t].body, `${t}: تغيّر محتوى صفّ`);
  }
  // والجهة الأخرى تحرّكت فعلاً — وإلا فالفحص يقارن سكوناً بسكون.
  assert.ok(Number((await db.get('SELECT COUNT(*) AS n FROM event_contact')).n) >= 13);
  // والصور تحرّكت وزالت في مكانها: صورة a2 ذهبت مع بطاقتها، ورمز B ذهب مع فعاليته، ورمز A حُذف
  // بنفسه — وبطاقة a1 تحمل صورتيها معاً (الثانية أُضيفت ولم تمحُ الأولى — الترحيلة ٠٤١).
  const blobs = async (where, params) => Number((await db.get(`SELECT COUNT(*) AS n FROM event_blob ${where}`, params)).n);
  assert.equal(await blobs('WHERE ref_id = ?', [a1.id]), 2);
  assert.equal(await blobs('WHERE ref_id = ?', [a2.id]), 0);
  assert.equal(await blobs('WHERE event_id = ?', [B.id]), 0);
  assert.equal(await blobs("WHERE event_id = ? AND kind = 'qr'", [A.id]), 0);
  assert.ok(Number((await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE resource LIKE 'event%'")).n) >= 30);
});

test('البنية: وحدة الفعاليات لا تقرأ ولا تكتب جدولاً من الفرص والعملاء والمستندات، ولا تستورد وحدتَي العملاء والبيع', () => {
  const dirPath = join(ROOT, 'src/modules/events');
  const files = readdirSync(dirPath).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(files, ['card-parser.js', 'events.js', 'events.routes.js', 'meetings.js']);
  const FORBIDDEN_SQL = /\b(FROM|JOIN|INTO|UPDATE)\s+(opportunity|project|client|contact|document|document_blob)\b/i;
  // النمط نفسه يُفحص أولاً: يمسك الجدول المحمي ولا يخلط «event_contact» بـ«contact».
  assert.ok(FORBIDDEN_SQL.test('SELECT * FROM contact WHERE'), 'النمط لا يمسك «contact»');
  assert.ok(FORBIDDEN_SQL.test('INSERT INTO document_blob (x)'), 'النمط لا يمسك «document_blob»');
  assert.ok(FORBIDDEN_SQL.test('update project set'), 'النمط لا يمسك «project» بحروف صغيرة');
  assert.ok(!FORBIDDEN_SQL.test('SELECT * FROM event_contact c JOIN event_blob b'), 'النمط يخلط «event_contact» بـ«contact»');
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  for (const f of files) {
    const src = stripComments(readFileSync(join(dirPath, f), 'utf8'));
    assert.ok(!FORBIDDEN_SQL.test(src), `${f}: يمسّ جدولاً محمياً — ${src.match(FORBIDDEN_SQL)?.[0]}`);
    assert.ok(!/(?:insert|update)\(\s*['"](?:opportunity|project|client|contact|document|document_blob)['"]/.test(src),
      `${f}: يكتب في جدول محمي عبر مساعد القاعدة`);
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(!/modules\/(?:clients|crm)\b/.test(m[1]), `${f}: يستورد من ${m[1]}`);
    }
  }
});

// المسار نفسه هو ما يصل إليه المتصفّح: خدمةٌ سليمة خلف عنوانٍ غير مركَّب تعني ٤٠٤ في وجه
// المستخدم وحزمةً خضراء عندنا.
test('ومسارات الفعاليات مركَّبة فعلاً تحت واجهة البرمجة — والحرفية قبل «:id»', async () => {
  const { apiRouter } = await import('../../src/modules/api.routes.js');
  const paths = [];
  const walk = (layer) => {
    if (layer.route) paths.push(layer.route.path);
    else if (layer.handle && layer.handle.stack) layer.handle.stack.forEach(walk);
  };
  apiRouter.stack.forEach(walk);
  for (const p of ['/events', '/events/:id', '/events/:id/contacts', '/events/:id/contacts/recent', '/events/contacts/:cid',
    '/events/contacts/:cid/outcome', '/events/parse-card', '/events/:id/partners', '/events/partners/:pid', '/events/:id/close',
    '/events/contacts/:cid/photo', '/events/contacts/:cid/photos', '/events/contacts/:cid/photos/:bid',
    '/events/:id/qr', '/events/:id/qr/:bid',
    '/events/:id/meetings', '/events/meetings/:mid', '/events/meetings/check']) {
    assert.ok(paths.includes(p), `المسار ${p} غير مركَّب في api.routes.js`);
  }
  assert.ok(paths.indexOf('/events/parse-card') < paths.indexOf('/events/:id'), '«parse-card» بعد «:id» فيُقرأ معرّفاً');
  assert.ok(paths.indexOf('/events/contacts/:cid') < paths.indexOf('/events/:id'), '«contacts» بعد «:id» فيُقرأ معرّفاً');
  assert.ok(paths.indexOf('/events/contacts/:cid/photo') < paths.indexOf('/events/:id'), '«contacts/…/photo» بعد «:id» فيُقرأ معرّفاً');
  assert.ok(paths.indexOf('/events/contacts/:cid/photos') < paths.indexOf('/events/:id'), '«contacts/…/photos» بعد «:id» فيُقرأ معرّفاً');
  assert.ok(paths.indexOf('/events/contacts/:cid/photos/:bid') < paths.indexOf('/events/:id'), '«contacts/…/photos/:bid» بعد «:id» فيُقرأ معرّفاً');
  assert.ok(paths.indexOf('/events/meetings/check') < paths.indexOf('/events/meetings/:mid'), '«meetings/check» بعد «:mid» فيُقرأ معرّفاً');
  assert.ok(paths.indexOf('/events/meetings/:mid') < paths.indexOf('/events/:id'), '«meetings» بعد «:id» فيُقرأ معرّفاً');
});
