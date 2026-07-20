// تعبئة تاريخ المنصة القديمة إلى سجلات التدقيق — INSERT فقط، آمن الإعادة، لا يحذف شيئاً.
// - snapshot.activity[443] هي سجلات "state-save" (من حفظ الحالة ومتى وأي المجموعات تغيّرت)
//   → تُحمَّل إلى audit_log بمعرّفاتها الأصلية (action='legacy_save') فتظهر في سجل التدقيق.
// - snapshot.importLog → import_run (type='legacy') ليكتمل سجل عمليات الاستيراد تاريخياً.
// Usage: node --experimental-sqlite scripts/backfill-legacy-activity.js [--dry-run]
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { get, run, tx, close } from '../src/core/db/index.js';
import { ROOT } from '../src/core/config.js';

const DRY = process.argv.includes('--dry-run');
const file = ['seed/legacy-state.snapshot.json', 'seed/legacy-state.demo.json']
  .map((p) => resolve(ROOT, p)).find((p) => existsSync(p));
if (!file) { console.error('!! لا يوجد ملف snapshot/demo'); process.exit(1); }
const SNAP = JSON.parse(readFileSync(file, 'utf8'));

const acts = SNAP.activity || [];
const imps = SNAP.importLog || [];
console.log(`▶ backfill from ${file.split('/').pop()}: activity=${acts.length} importLog=${imps.length} ${DRY ? '(dry-run)' : ''}`);

async function main() {
  const beforeA = (await get("SELECT COUNT(*) n FROM audit_log WHERE action = 'legacy_save'"))?.n || 0;
  const beforeI = (await get("SELECT COUNT(*) n FROM import_run WHERE type = 'legacy'"))?.n || 0;

  let insA = 0, insI = 0;
  if (!DRY) {
    await tx(async () => {
      for (const a of acts) {
        // معرّف السجل القديم = المفتاح — إعادة التشغيل لا تكرر شيئاً
        const r = await run(
          `INSERT INTO audit_log (id, at, user_id, username, role_id, action, resource, resource_id, sector_id, detail_json, ip)
           VALUES (?, ?, ?, ?, ?, 'legacy_save', 'snapshot', ?, ?, ?, NULL)
           ON CONFLICT (id) DO NOTHING`,
          [a.id, a.at, a.userId || null, a.username || null, a.role || null, a.id, a.sectorId || null,
           JSON.stringify({ changes: a.changes || [], ignoredKeys: a.ignoredKeys || undefined })]);
        insA += r.changes || 0;
      }
      const admin = await get("SELECT id FROM app_user WHERE role_id = 'admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1");
      for (let i = 0; admin && i < imps.length; i++) {
        const im = imps[i];
        const iid = `imp_legacy_${i}_${(im.at || '').replace(/[^0-9]/g, '').slice(0, 14)}`;
        const r = await run(
          `INSERT INTO import_run (id, type, mode, status, file_name, counts_json, by_user_id, created_at, applied_at)
           VALUES (?, 'legacy', 'upsert', 'applied', ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`,
          [iid, im.type || 'legacy', JSON.stringify(im), admin.id, im.at || new Date().toISOString(), im.at || null]);
        insI += r.changes || 0;
      }
    });
  }

  const afterA = (await get("SELECT COUNT(*) n FROM audit_log WHERE action = 'legacy_save'"))?.n || 0;
  const afterI = (await get("SELECT COUNT(*) n FROM import_run WHERE type = 'legacy'"))?.n || 0;
  console.log(`✓ audit_log legacy_save: ${beforeA} → ${afterA} (+${insA})  | expected total ${acts.length}`);
  console.log(`✓ import_run legacy:    ${beforeI} → ${afterI} (+${insI})  | expected total ${imps.length}`);
  if (!DRY && (afterA < acts.length)) { console.error('!! عدد غير مكتمل — راجع قبل المتابعة'); process.exit(1); }
}

main().then(() => close()).catch((e) => { console.error('!! backfill failed:', e.message); process.exit(1); });
