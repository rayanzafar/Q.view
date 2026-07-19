// Backfill finance signal so AR/DSO/bridge have real numbers:
//  - set invoice.owner_user_id from project PM, issue_date/due_date from deliverable
//  - PAID invoices → a matching collection; some ISSUED remain outstanding (AR)
// Idempotent-ish (dev). Never touches production.
import { all, get, run, insert } from '../src/core/db/index.js';
import { id, nowIso } from '../src/core/util/ids.js';

export async function deriveFinance() {
  const invoices = await all('SELECT * FROM invoice WHERE deleted_at IS NULL');
  let owners = 0, coll = 0, dated = 0;
  for (const inv of invoices) {
    const patch = {};
    if (!inv.owner_user_id && inv.project_id) {
      const p = await get('SELECT owner_user_id FROM project WHERE id=?', [inv.project_id]);
      if (p?.owner_user_id) { patch.owner_user_id = p.owner_user_id; owners++; }
    }
    if (!inv.issue_date) {
      const d = inv.deliverable_id ? await get('SELECT delivered_at, month, year FROM deliverable WHERE id=?', [inv.deliverable_id]) : null;
      const iso = d?.delivered_at || (d?.year && d?.month ? `${d.year}-${String(d.month).padStart(2, '0')}-15` : '2026-03-15');
      patch.issue_date = iso; dated++;
    }
    if (!inv.due_date) patch.due_date = addDays(patch.issue_date || inv.issue_date || '2026-03-15', 30);
    if (Object.keys(patch).length) await run(`UPDATE invoice SET ${Object.keys(patch).map((k) => k + '=?').join(',')} WHERE id=?`, [...Object.values(patch), inv.id]);
    // PAID invoice with no collection → create a collection (settles AR)
    if (String(inv.status).toUpperCase() === 'PAID') {
      const has = await get('SELECT id FROM collection WHERE invoice_id=?', [inv.id]);
      if (!has) {
        await insert('collection', { id: id('col'), invoice_id: inv.id, amount_halalas: inv.amount_halalas,
          collected_at: addDays(patch.issue_date || inv.issue_date || '2026-03-15', 40), method: 'تحويل', created_at: nowIso() });
        coll++;
      }
    } else if (String(inv.status).toUpperCase() === 'INVOICED') {
      // normalize legacy 'INVOICED' → 'ISSUED' (outstanding AR)
      await run("UPDATE invoice SET status='ISSUED' WHERE id=?", [inv.id]);
    }
  }
  console.log(`✓ finance derive: owners=${owners}, dated=${dated}, collections=${coll}, invoices=${invoices.length}`);
}
function addDays(iso, n) {
  const d = new Date((iso || '2026-03-15') + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const { close } = await import('../src/core/db/index.js');
  deriveFinance().then(() => close()).catch((e) => { console.error(e); process.exit(1); });
}
