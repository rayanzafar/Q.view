// وحدة: المساعد الذكي يحلّ اسم المشروع الحقيقي من نص المستخدم، لا معرّفاً داخلياً فقط.
// عطل حقيقي: extractProjectId كان يطابق فقط أنماط معرّف داخلي (p_.., PRJ-..) لا يعرفها أي
// مستخدم عادي، فيرد «حدّد المشروع» حتى بعد ذكر اسمه بوضوح — يبدو للمستخدم وكأن المساعد لا يردّ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-ai-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { ask } = await import('../../src/core/ai/assistant.js');

const T = '2026-07-01T00:00:00Z';
before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع الاختبار', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'S2', name_ar: 'قطاع آخر', active: 1, sort_order: 2, created_at: T });
  await insert('project', { id: 'p_test1', name_ar: 'منصة البيانات السعودية', sector_id: 'S1',
    status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 58, contract_value_halalas: 100000, created_at: T });
  await insert('project', { id: 'p_other', name_ar: 'مشروع في قطاع آخر', sector_id: 'S2',
    status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 10, contract_value_halalas: 50000, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('ask: يلخّص مشروعاً حقيقياً بذكر اسمه بالعربية فقط (بلا معرّف داخلي)', async () => {
  const user = { id: 'u1', role_id: 'admin', scope: 'company' };
  const r = await ask({ user, ip: '127.0.0.1' }, 'لخّص حالة مشروع منصة البيانات السعودية');
  assert.ok(!r.reply.includes('حدّد المشروع'), 'يجب ألا يطلب تحديد المشروع رغم ذكر اسمه: ' + r.reply);
  assert.ok(r.reply.includes('منصة البيانات السعودية'), 'يجب أن يذكر اسم المشروع في الرد');
  assert.ok(!r.reply.includes('IN_PROGRESS') && !r.reply.includes('GREEN'), 'لا قيم تعداد إنجليزية خام في رد عربي: ' + r.reply);
  assert.ok(r.reply.includes('قيد التنفيذ') || r.reply.includes('على المسار'), 'يجب أن تظهر التسمية العربية بالمعنى');
});

test('ask: مطابقة اسم جزئية تكفي (بدون الاسم الكامل حرفياً)', async () => {
  const user = { id: 'u1', role_id: 'admin', scope: 'company' };
  const r = await ask({ user, ip: '127.0.0.1' }, 'ملخص مشروع البيانات السعودية');
  assert.ok(r.reply.includes('منصة البيانات السعودية'), 'يجب أن تنجح المطابقة الجزئية: ' + r.reply);
});

test('ask: نطاق القطاع محترم — لا يسرّب مشروعاً خارج قطاع المستخدم بالاسم', async () => {
  const sectorUser = { id: 'u2', role_id: 'sector_lead', scope: 'sector', sector_id: 'S1' };
  const r = await ask({ user: sectorUser, ip: '127.0.0.1' }, 'لخّص حالة مشروع في قطاع آخر');
  assert.ok(r.reply.includes('حدّد المشروع'), 'لا يجوز أن يحلّ اسم مشروع خارج نطاق المستخدم: ' + r.reply);
});

test('ask: بلا أي إشارة مشروع يطلب التحديد بأدب', async () => {
  const user = { id: 'u1', role_id: 'admin', scope: 'company' };
  const r = await ask({ user, ip: '127.0.0.1' }, 'لخّص مشروع');
  assert.ok(r.reply.includes('حدّد المشروع'));
});
