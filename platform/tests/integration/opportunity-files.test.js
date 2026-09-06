// ── ملفات الفرص المرفوعة (v5.24) ─────────────────────────────────────────────
//
// «المستندات والروابط الخارجية يجب أن تعمل فعلياً end-to-end» — حزمة المالك. الروابط كانت
// تعمل؛ الرفع لم يكن موجوداً في المنصة إطلاقاً. البايتات تُحفظ في القاعدة (`document_blob`
// — الترحيلة 033، التعليل في ADR-0007) لأن نظام ملفات الحاوية يزول مع كل نشرة.
//
// يُفحص هنا ما يحمي المالك فعلاً: جولة بايتات كاملة (رفع ← تنزيل ← تطابق sha)، رفض
// الممنوع برسالة عربية، بوابة الوصول (من لا يقرأ الفرصة لا يحمّل ملفها)، الحذف يمحو
// البايتات فعلاً ويبقي الميتاداتا أثراً، والروابط القديمة لم تنكسر.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'sanad-oppfile-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps, docs;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };
const CTX = { user: ADMIN, ip: '1' };
let OID;

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  opps = await import('../../src/modules/crm/opportunities.js');
  docs = await import('../../src/modules/crm/oppdocs.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة الاقتصاد والتخطيط', created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  // قارئ خارج النطاق: مستشار في قطاع آخر لا يملك على الفرصة شيئاً.
  await db.insert('sector', { id: 'OTH', name_ar: 'قطاع آخر', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_out', username: 'outsider', name_ar: 'استشاري بعيد', role_id: 'consultant', sector_id: 'OTH', scope: 'own', active: 1, created_at: T });
  OID = (await opps.createOpportunity(CTX, { title_ar: 'منصة رفع الملفات', sector_id: 'SOL', client_id: 'CL', value_sar: 1150 })).id;
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('الترحيلة 033 مطبَّقة: جدول بايتات المستندات موجود بمفاتيحه', async () => {
  const row = await db.get(`SELECT version FROM schema_migration WHERE version = '033_document_blob.sql'`);
  assert.ok(row, 'الترحيلة 033 غير مسجَّلة');
  // أعمدته الخمسة تُقرأ بلا خطأ — بنية الجدول كما رُسمت.
  const cols = await db.get('SELECT document_id, content, mime, sha256, created_at FROM document_blob LIMIT 1');
  assert.equal(cols, undefined); // فارغ الآن، والبنية سليمة
});

let DOC;
const BYTES = Buffer.concat([Buffer.from('%PDF-1.4\nعرضٌ فنيٌّ حقيقي\n'), Buffer.alloc(4096, 7)]);

test('جولة كاملة: رفعٌ يحفظ البايتات وتنزيلٌ يعيدها بلا نقصان', async () => {
  DOC = await docs.uploadOpportunityFile(CTX, OID, {
    fileName: 'العرض الفني — النسخة الأولى.pdf', bytes: BYTES, kind: 'technical', note: 'قبل المراجعة',
  });
  assert.equal(DOC.kind, 'technical');
  assert.equal(DOC.url, null, 'صف الملف لا يحمل رابطاً');
  assert.equal(DOC.size_bytes, BYTES.length);
  const f = await docs.readOpportunityFileForDownload(ADMIN, DOC.id);
  assert.equal(f.mime, 'application/pdf');
  assert.equal(Buffer.compare(f.content, BYTES), 0, 'البايتات النازلة ليست هي المرفوعة');
  const blob = await db.get('SELECT sha256 FROM document_blob WHERE document_id = ?', [DOC.id]);
  assert.equal(blob.sha256, createHash('sha256').update(BYTES).digest('hex'));
});

test('وتظهر في قائمة المستندات بعلامة الملف، والروابط القديمة معها بلا كسر', async () => {
  await docs.addOpportunityDocument(CTX, OID, { name: 'كراسة الشروط', url: 'https://etimad.sa/x', kind: 'rfp_doc' });
  const r = await docs.opportunityDocuments(ADMIN, OID);
  const file = r.documents.find((d) => d.id === DOC.id);
  const link = r.documents.find((d) => d.kind === 'rfp_doc');
  assert.equal(Number(file.has_file), 1);
  assert.equal(Number(link.has_file), 0);
  assert.equal(link.url, 'https://etimad.sa/x');
});

test('الممنوع يُرَدّ برسالة عربية: امتداد خطر، وملف فارغ، وحجم فوق الحد', async () => {
  await assert.rejects(() => docs.uploadOpportunityFile(CTX, OID, { fileName: 'virus.exe', bytes: Buffer.from('MZ'), kind: 'other' }),
    (e) => /غير مدعوم/.test(e.message), 'قُبِل exe');
  await assert.rejects(() => docs.uploadOpportunityFile(CTX, OID, { fileName: 'فارغ.pdf', bytes: Buffer.alloc(0), kind: 'other' }),
    (e) => /فارغ/.test(e.message), 'قُبِل ملف فارغ');
  await assert.rejects(() => docs.uploadOpportunityFile(CTX, OID, { fileName: 'ضخم.pdf', bytes: Buffer.alloc(docs.OPP_FILE_MAX_BYTES + 1), kind: 'other' }),
    (e) => /يتجاوز الحد/.test(e.message), 'قُبِل ملف فوق الحد');
});

test('من لا يقرأ الفرصة لا يرفع ولا يحمّل — نفس بوابة الصفحة', async () => {
  const out = await db.get('SELECT * FROM app_user WHERE id = ?', ['u_out']);
  await assert.rejects(() => docs.uploadOpportunityFile({ user: out, ip: '1' }, OID, { fileName: 'a.pdf', bytes: Buffer.from('x'), kind: 'other' }));
  await assert.rejects(() => docs.readOpportunityFileForDownload(out, DOC.id));
});

test('تنزيل صف الرابط يقول الحقيقة: رابطٌ خارجي لا ملف مرفوع', async () => {
  const r = await docs.opportunityDocuments(ADMIN, OID);
  const link = r.documents.find((d) => d.kind === 'rfp_doc');
  await assert.rejects(() => docs.readOpportunityFileForDownload(ADMIN, link.id),
    (e) => /رابط خارجي/.test(e.message));
});

test('الرفع مُدوَّن في الأثر بحجمه وعلامة الملف', async () => {
  const a = await db.get(`SELECT detail_json FROM audit_log
     WHERE resource = 'document' AND resource_id = ? AND action = 'create'`, [DOC.id]);
  assert.ok(a, 'لا سطر تدقيق للرفع');
  const detail = JSON.parse(a.detail_json);
  assert.equal(detail.file, true);
  assert.equal(detail.size_bytes, BYTES.length);
});

test('الحذف يمحو البايتات فعلاً ويبقي الميتاداتا أثراً ناعماً', async () => {
  await docs.deleteOpportunityDocument(CTX, DOC.id);
  const blob = await db.get('SELECT document_id FROM document_blob WHERE document_id = ?', [DOC.id]);
  assert.equal(blob, undefined, 'البايتات بقيت بعد الحذف');
  const meta = await db.get('SELECT deleted_at FROM document WHERE id = ?', [DOC.id]);
  assert.ok(meta.deleted_at, 'الميتاداتا حُذفت حذفاً صلباً');
  const r = await docs.opportunityDocuments(ADMIN, OID);
  assert.ok(!r.documents.some((d) => d.id === DOC.id), 'المحذوف ما زال في القائمة');
});
