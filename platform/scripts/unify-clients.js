// صيانة بيانات العملاء (v2.2): دمج العملاء المكررين بالاسم + تصنيف نوع العميل الناقص.
// آمن التكرار (idempotent): لا يدمج ما دُمج، ولا يعيد تصنيف نوعاً مضبوطاً. كل تغيير يُدقَّق.
//   node --experimental-sqlite scripts/unify-clients.js          # تطبيق
//   node --experimental-sqlite scripts/unify-clients.js --dry     # عرض بلا كتابة
import { all, get, run, update, tx } from '../src/core/db/index.js';
import { audit } from '../src/core/audit/index.js';
import { nowIso } from '../src/core/util/ids.js';

const DRY = process.argv.includes('--dry');
const SYS = { user: { id: 'system', username: 'system', role_id: 'admin' }, ip: null };
// الجداول التي تحمل client_id ويجب إعادة توجيهها عند الدمج (contact/crm_activity/document فارغة الآن لكنها مشمولة للأمان)
const CHILD_TABLES = ['opportunity', 'project', 'contract', 'invoice', 'contact', 'crm_activity', 'document'];

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// تصنيف نوع العميل من اسمه — إشارات صريحة فقط، والباقي «حكومي» لأن البيانات حكومية الغالبية (يُسجَّل العدد للشفافية)
function inferType(name) {
  const n = norm(name);
  if (/(^|\s)(شركة|مجموعة|مصنع|مؤسسة\s|بنك|مصرف|القابضة|شركات)(\s|$)/.test(n)) return 'خاص';
  if (/رؤية الخبراء|EVC|القطاع الداخلي|إدارة داخلية/.test(n)) return 'داخلي';
  if (/أرامكو|سابك|صندوق الاستثمارات|نيوم|روشن|البحر الأحمر|القدية|الدرعية|طيران|الاتصالات السعودية|stc/i.test(n)) return 'شبه حكومي';
  if (/وزارة|هيئة|رئاسة|أمانة|ديوان|مجلس|جامعة|صندوق|بلدية|إمارة|محكمة|نيابة|مركز وطني|المركز الوطني|هيئات|سلطة|مدينة|محافظة/.test(n)) return 'حكومي';
  return 'حكومي';
}

async function dedupe() {
  const groups = await all(`SELECT TRIM(name_ar) k, COUNT(*) c FROM client WHERE deleted_at IS NULL GROUP BY TRIM(name_ar) HAVING COUNT(*) > 1`);
  let merged = 0;
  for (const g of groups) {
    const rows = await all('SELECT * FROM client WHERE TRIM(name_ar) = ? AND deleted_at IS NULL', [g.k]);
    if (rows.length < 2) continue;
    // القانوني = الأكثر سجلاتٍ مرتبطة، ثم الأقدم إنشاءً، ثم أصغر معرّف — حتمي وقابل للتتبع
    const scored = await Promise.all(rows.map(async (r) => {
      let links = 0;
      for (const t of CHILD_TABLES) {
        const q = await get(`SELECT COUNT(*) n FROM ${t} WHERE client_id = ?`, [r.id]).catch(() => ({ n: 0 }));
        links += q?.n || 0;
      }
      return { r, links };
    }));
    scored.sort((a, b) => b.links - a.links || String(a.r.created_at || '').localeCompare(String(b.r.created_at || '')) || String(a.r.id).localeCompare(String(b.r.id)));
    const canonical = scored[0].r;
    const losers = scored.slice(1).map((s) => s.r);
    for (const loser of losers) {
      const moved = {};
      for (const t of CHILD_TABLES) {
        const n = (await get(`SELECT COUNT(*) n FROM ${t} WHERE client_id = ?`, [loser.id]).catch(() => ({ n: 0 })))?.n || 0;
        if (n > 0) moved[t] = n;
      }
      console.log(`  دمج «${g.k}»: ${loser.id} → ${canonical.id}`, Object.keys(moved).length ? JSON.stringify(moved) : '(بلا سجلات)');
      if (!DRY) {
        await tx(async () => {
          for (const t of CHILD_TABLES) {
            if (moved[t]) await run(`UPDATE ${t} SET client_id = ? WHERE client_id = ?`, [canonical.id, loser.id]);
          }
          // نقل النوع للقانوني إن كان القانوني بلا نوع والخاسر مصنّفاً
          if (!canonical.type && loser.type) await update('client', canonical.id, { type: loser.type });
          await update('client', loser.id, { deleted_at: nowIso() });
          await audit(SYS, { action: 'delete', resource: 'client', resourceId: loser.id, detail: { clientMerge: true, into: canonical.id, name: g.k, moved } });
          await audit(SYS, { action: 'update', resource: 'client', resourceId: canonical.id, detail: { clientMergeReceived: loser.id, moved } });
        });
      }
      merged++;
    }
  }
  return merged;
}

async function classify() {
  const rows = await all(`SELECT id, name_ar, type FROM client WHERE deleted_at IS NULL AND (type IS NULL OR type = '')`);
  const counts = {};
  for (const r of rows) {
    const t = inferType(r.name_ar);
    counts[t] = (counts[t] || 0) + 1;
    if (!DRY) {
      await update('client', r.id, { type: t });
      await audit(SYS, { action: 'update', resource: 'client', resourceId: r.id, detail: { classifiedType: t, from: 'اسم العميل' } });
    }
  }
  return { classified: rows.length, counts };
}

async function main() {
  console.log(DRY ? '— عرض تجريبي (بلا كتابة) —' : '— تطبيق —');
  const merged = await dedupe();
  const cls = await classify();
  const remain = (await get('SELECT COUNT(*) n FROM client WHERE deleted_at IS NULL')).n;
  console.log(`\nالدمج: ${merged} سجلاً مكرراً${DRY ? ' (سيُدمج)' : ' دُمج'}.`);
  console.log(`التصنيف: ${cls.classified} عميلاً${DRY ? ' (سيُصنّف)' : ' صُنّف'} → ${JSON.stringify(cls.counts)}.`);
  console.log(`العملاء النشطون بعد الصيانة: ${remain}.`);
}

// تشغيل مباشر فقط (يُستورَد أيضاً كدالة للاختبار)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
export { dedupe, classify, inferType };
