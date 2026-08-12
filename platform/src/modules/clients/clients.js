// Clients (CRM 360) — service layer. Scope-aware lists, the composed clientOverview payload
// (contracts §6), contacts CRUD, the activity stream (crm_activity + derived business events),
// and client documents (metadata only). All writes: can() + audit(). Money = INTEGER halalas.
//
// Scoping model: `client` rows carry no sector_id. A client is visible to a sector-scoped user
// when the client has ANY footprint (opportunity / project / contract) in that user's sector —
// computed with EXISTS subqueries so the DB enforces the boundary, not the app.
import { all, get, insert, update, run, tx } from '../../core/db/index.js';
import { netSql } from '../finance/vat.js';
import { effectiveProgress } from '../pmo/progress.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, fmtSar } from '../../core/util/ids.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { config } from '../../core/config.js';
import { DELIVERY_SECTOR_SQL } from '../../core/org/kind.js';
import { matchEntity, entityCount } from '../../core/org/entity-registry.js';
// قاعدة نسبة الفاتورة إلى عميل — معرّفة مرة واحدة في وحدة المالية (صاحبة الفاتورة) ومستوردة هنا،
// حتى لا تختلف إجابة «لمن هذه الفاتورة؟» بين قائمة العملاء وصفحة العميل وشاشة المالية.
import { INVOICE_CLIENT_COL, INVOICE_CLIENT_JOIN } from '../finance/finance.js';
import { loadReadableOpportunity } from '../crm/opp-access.js';

const INV_CID = INVOICE_CLIENT_COL();   // COALESCE(i.client_id, p.client_id)
const INV_JOIN = INVOICE_CLIENT_JOIN(); // LEFT JOIN project p … AND p.deleted_at IS NULL

export const CLIENT_TYPES = ['حكومي', 'خاص', 'شبه حكومي', 'داخلي'];
export const ACTIVITY_KINDS = ['call', 'meeting', 'email', 'note', 'visit', 'proposal', 'update', 'other'];

// ── scope helpers ────────────────────────────────────────────────────────────
// WHERE fragment limiting `client c` rows to the user's reach. null = no permission at all.
function clientScopeClause(user, action = 'read') {
  const scope = effectiveScope(user, action, 'client');
  if (!scope) return null;
  if (scope === 'company') return { clause: '1=1', params: [] };
  // A freshly-created client has no footprint yet — its creator must keep seeing/editing it,
  // otherwise "add client" would make the record vanish for the very person who added it.
  if (scope === 'sector' || scope === 'department') {
    const f = footprintClause(user.sector_id);
    return { clause: `(${f.clause} OR c.created_by = ?)`, params: [...f.params, user.id] };
  }
  if (scope === 'project') {
    const ids = [...(user.projectIds || [])];
    if (!ids.length) return { clause: 'c.created_by = ?', params: [user.id] };
    return {
      clause: `(EXISTS (SELECT 1 FROM project p WHERE p.client_id = c.id AND p.deleted_at IS NULL AND p.id IN (${ids.map(() => '?').join(',')})) OR c.created_by = ?)`,
      params: [...ids, user.id],
    };
  }
  // own/team: clients on opportunities or projects the user owns, plus their own creations
  return {
    clause: `(EXISTS (SELECT 1 FROM opportunity o WHERE o.client_id = c.id AND o.deleted_at IS NULL AND o.owner_user_id = ?)
      OR EXISTS (SELECT 1 FROM project p WHERE p.client_id = c.id AND p.deleted_at IS NULL AND p.owner_user_id = ?)
      OR c.created_by = ?)`,
    params: [user.id, user.id, user.id],
  };
}
// Clients having any opportunity/project/contract in the given sector.
function footprintClause(sectorId) {
  return {
    clause: `(EXISTS (SELECT 1 FROM opportunity o WHERE o.client_id = c.id AND o.deleted_at IS NULL AND o.sector_id = ?)
      OR EXISTS (SELECT 1 FROM project p WHERE p.client_id = c.id AND p.deleted_at IS NULL AND p.sector_id = ?)
      OR EXISTS (SELECT 1 FROM contract t WHERE t.client_id = c.id AND t.deleted_at IS NULL AND t.sector_id = ?))`,
    params: [sectorId, sectorId, sectorId],
  };
}
// Fetch one client the user may act on (IDOR guard for reads AND writes on a specific row).
async function getVisibleClient(user, clientId, action = 'read') {
  const row = await get('SELECT * FROM client WHERE id = ? AND deleted_at IS NULL', [clientId]);
  if (!row) throw notFound('العميل غير موجود');
  const sc = clientScopeClause(user, action);
  if (!sc) throw forbidden();
  if (sc.clause !== '1=1') {
    const ok = await get(`SELECT c.id FROM client c WHERE c.id = ? AND ${sc.clause}`, [clientId, ...sc.params]);
    if (!ok) throw forbidden();
  }
  return row;
}

// ── relationship rule (contracts §6) ────────────────────────────────────────
// نشطة = نشاط ≤30 يوماً أو فرصة مفتوحة · فاترة ≤120 · خاملة غير ذلك
export function relationshipOf(lastActivityAt, openOppCount, now = Date.now()) {
  if ((openOppCount || 0) > 0) return 'نشطة';
  if (!lastActivityAt) return 'خاملة';
  const days = Math.floor((now - new Date(String(lastActivityAt).slice(0, 10) + 'T00:00:00Z').getTime()) / 86400000);
  if (days <= 30) return 'نشطة';
  if (days <= 120) return 'فاترة';
  return 'خاملة';
}

const maxAt = (...vals) => vals.filter(Boolean).map(String).sort().pop() || null;

// Per-client "last touch" dates from every real dated record class (logged activity + derived
// business events). Returns Map(client_id → ISO/date string). No fabrication: null dates drop out.
export async function lastTouchByClient() {
  const out = new Map();
  const feed = (rows) => { for (const r of rows) if (r.cid && r.at) out.set(r.cid, maxAt(out.get(r.cid), r.at)); };
  feed(await all(`SELECT client_id cid, MAX(at) at FROM crm_activity WHERE deleted_at IS NULL AND client_id IS NOT NULL GROUP BY client_id`));
  feed(await all(`SELECT o.client_id cid, MAX(o.stage_changed_at) at FROM opportunity o JOIN stage s ON s.id = o.stage_id
     WHERE o.deleted_at IS NULL AND o.client_id IS NOT NULL AND (s.is_won = 1 OR s.is_lost = 1) AND o.stage_changed_at IS NOT NULL GROUP BY o.client_id`));
  feed(await all(`SELECT client_id cid, MAX(COALESCE(signed_at, start_date)) at FROM contract
     WHERE deleted_at IS NULL AND client_id IS NOT NULL GROUP BY client_id`));
  // legacy invoices carry project_id only — resolve the client through the project when unset
  feed(await all(`SELECT ${INV_CID} cid, MAX(i.issue_date) at
     FROM invoice i ${INV_JOIN}
     WHERE i.deleted_at IS NULL AND i.issue_date IS NOT NULL AND i.status NOT IN ('DRAFT','CANCELLED')
       AND ${INV_CID} IS NOT NULL GROUP BY ${INV_CID}`));
  feed(await all(`SELECT ${INV_CID} cid, MAX(l.collected_at) at
     FROM collection l JOIN invoice i ON i.id = l.invoice_id ${INV_JOIN}
     WHERE i.deleted_at IS NULL AND l.collected_at IS NOT NULL
       AND ${INV_CID} IS NOT NULL GROUP BY ${INV_CID}`));
  feed(await all(`SELECT client_id cid, MAX(start_date) at FROM project
     WHERE deleted_at IS NULL AND client_id IS NOT NULL AND start_date IS NOT NULL GROUP BY client_id`));
  return out;
}

// ── list ─────────────────────────────────────────────────────────────────────
// listClients(user, {query, type, sort, sector}) → client cols + the per-client decision
// aggregates (contract fields kept; the rest are additive extensions):
//   open_pipeline_halalas / weighted_pipeline_halalas / open_opps — الفرص المفتوحة وقيمتها والمرجّح
//   won_count / won_value_halalas / hist_won_count / lost_count — سجل الفوز والخسارة (التاريخي على حدة)
//   contracts_count / contracts_value_halalas — العقود
//   open_ar_halalas / overdue_ar_halalas — المستحق (نفس منطق clientOverview حتى تتطابق الأرقام)
//   fy_revenue_halalas / prev_fy_revenue_halalas / active_projects
//   sectors[] (أسماء عربية) / rel_owner (+rel_owner_user_id) / last_activity_at / relationship
// Batching model: every aggregate is ONE grouped query over the whole table keyed by client_id
// (Map lookups afterwards) — never a query per client row.
export async function listClients(user, filters = {}) {
  const sc = clientScopeClause(user, 'read');
  if (!sc) return [];
  const where = ['c.deleted_at IS NULL', sc.clause];
  const params = [...sc.params];
  const q = (filters.query || '').toString().trim();
  if (q) {
    where.push('(c.name_ar LIKE ? OR c.name_en LIKE ? OR c.code LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const type = (filters.type || '').toString().trim();
  if (type) { where.push('c.type = ?'); params.push(type); }
  if (filters.sector) { // extra lens (company users): clients with footprint in that sector
    const f = footprintClause(filters.sector);
    where.push(f.clause); params.push(...f.params);
  }
  const clients = await all(`SELECT c.* FROM client c WHERE ${where.join(' AND ')} LIMIT 500`, params);
  if (!clients.length) return [];

  const fy = config.fiscalYear;
  const revRows = await all(`SELECT p.client_id cid, COALESCE(SUM(${netSql('r.amount_halalas', 'r.net_amount_halalas')}),0) v FROM revenue_line r
     JOIN project p ON p.id = r.project_id WHERE r.year = ? AND p.client_id IS NOT NULL AND p.deleted_at IS NULL GROUP BY p.client_id`, [fy]);
  // إيراد السنة الماضية لكل عميل — يغذي مؤشر «نمو الإيراد» في الشريط التحليلي
  const prevRevRows = await all(`SELECT p.client_id cid, COALESCE(SUM(${netSql('r.amount_halalas', 'r.net_amount_halalas')}),0) v FROM revenue_line r
     JOIN project p ON p.id = r.project_id WHERE r.year = ? AND p.client_id IS NOT NULL AND p.deleted_at IS NULL GROUP BY p.client_id`, [fy - 1]);
  // الفرص المفتوحة: العدد + الإجمالي + المرجّح (قيمة × احتمال الفوز) — نفس تعريف clientOverview
  const pipeRows = await all(`SELECT o.client_id cid, COUNT(*) n, COALESCE(SUM(o.value_halalas),0) v,
       COALESCE(SUM(o.value_halalas * COALESCE(o.win_pct,0) / 100.0),0) w
     FROM opportunity o LEFT JOIN stage s ON s.id = o.stage_id
     WHERE o.deleted_at IS NULL AND o.client_id IS NOT NULL AND COALESCE(s.is_won,0) = 0 AND COALESCE(s.is_lost,0) = 0 GROUP BY o.client_id`);
  const prjRows = await all(`SELECT client_id cid, COUNT(*) n FROM project
     WHERE deleted_at IS NULL AND client_id IS NOT NULL AND status = 'IN_PROGRESS' GROUP BY client_id`);
  // الفوز/الخسارة: الفوز المحتسب يستثني المستورد التاريخي (exclude_from_sales=1) ويعدّه على حدة
  const wlRows = await all(`SELECT o.client_id cid,
       SUM(CASE WHEN s.is_won = 1 AND COALESCE(o.exclude_from_sales,0) = 0 THEN 1 ELSE 0 END) won_n,
       COALESCE(SUM(CASE WHEN s.is_won = 1 AND COALESCE(o.exclude_from_sales,0) = 0 THEN o.value_halalas ELSE 0 END),0) won_v,
       SUM(CASE WHEN s.is_won = 1 AND COALESCE(o.exclude_from_sales,0) = 1 THEN 1 ELSE 0 END) hist_n,
       SUM(CASE WHEN s.is_lost = 1 THEN 1 ELSE 0 END) lost_n
     FROM opportunity o JOIN stage s ON s.id = o.stage_id
     WHERE o.deleted_at IS NULL AND o.client_id IS NOT NULL AND (s.is_won = 1 OR s.is_lost = 1)
     GROUP BY o.client_id`);
  const conRows = await all(`SELECT client_id cid, COUNT(*) n, COALESCE(SUM(value_halalas),0) v FROM contract
     WHERE deleted_at IS NULL AND client_id IS NOT NULL GROUP BY client_id`);
  // المستحق: فاتورة بفاتورة بنفس قواعد clientOverview بالضبط (سقف التحصيل عند قيمة الفاتورة،
  // لا سالب، عميل الفاتورة أو عميل مشروعها للفواتير القديمة) حتى يطابق الرقم صفحة العميل 360.
  const today = nowIso().slice(0, 10);
  const invRows = await all(`SELECT ${INV_CID} cid, i.id iid, i.amount_halalas amt,
       i.status st, i.due_date dd, COALESCE(SUM(l.amount_halalas),0) col
     FROM invoice i
     ${INV_JOIN}
     LEFT JOIN collection l ON l.invoice_id = i.id
     WHERE i.deleted_at IS NULL AND i.status NOT IN ('DRAFT','CANCELLED') AND ${INV_CID} IS NOT NULL
     GROUP BY ${INV_CID}, i.id, i.amount_halalas, i.status, i.due_date`);
  const ar = new Map();
  for (const r of invRows) {
    const out = Math.max(0, (r.amt || 0) - Math.min(r.col || 0, r.amt || 0));
    if (!out) continue;
    const cur = ar.get(r.cid) || { out: 0, overdue: 0 };
    cur.out += out;
    if (r.st === 'OVERDUE' || (r.dd && String(r.dd).slice(0, 10) < today)) cur.overdue += out;
    ar.set(r.cid, cur);
  }
  // القطاعات: اتحاد قطاعات الفرص والمشاريع والعقود لكل عميل (UNION يزيل التكرار)
  const secRows = await all(`SELECT client_id cid, sector_id sid FROM opportunity WHERE deleted_at IS NULL AND client_id IS NOT NULL AND sector_id IS NOT NULL
     UNION SELECT client_id cid, sector_id sid FROM project WHERE deleted_at IS NULL AND client_id IS NOT NULL AND sector_id IS NOT NULL
     UNION SELECT client_id cid, sector_id sid FROM contract WHERE deleted_at IS NULL AND client_id IS NOT NULL AND sector_id IS NOT NULL`);
  // شارات «القطاعات» على صف العميل = قطاعات تسليم فقط. وحدة المساندة ليست قطاعاً يتعامل معه
  // العميل، وظهورها في الشارات يقرأها المسؤول قطاعاً خامساً. الصف المنسوب إلى وحدة مساندة
  // يسقط من الشارات وحدها — لا من أرقام العميل (خط الفرص والعقود والمستحق تُحسب من صفوفها
  // كاملة أعلاه)، والسطر التالي يُسقط أصلاً كل معرّف قطاع لا نعرفه.
  const secMeta = new Map((await all(
    `SELECT id, name_ar, sort_order FROM sector WHERE deleted_at IS NULL AND ${DELIVERY_SECTOR_SQL}`))
    .map((s) => [s.id, s]));
  const secBy = new Map();
  for (const r of secRows) {
    if (!secMeta.has(r.sid)) continue;
    if (!secBy.has(r.cid)) secBy.set(r.cid, new Set());
    secBy.get(r.cid).add(r.sid);
  }
  // مالك العلاقة: أكثر مستخدم تملّكاً للفرص المفتوحة على العميل — لا فرص مفتوحة = لا مالك
  const ownRows = await all(`SELECT o.client_id cid, o.owner_user_id uid, u.name_ar oname, u.username ouser, COUNT(*) n
     FROM opportunity o
     LEFT JOIN stage s ON s.id = o.stage_id
     JOIN app_user u ON u.id = o.owner_user_id AND u.deleted_at IS NULL
     WHERE o.deleted_at IS NULL AND o.client_id IS NOT NULL AND o.owner_user_id IS NOT NULL
       AND COALESCE(s.is_won,0) = 0 AND COALESCE(s.is_lost,0) = 0
     GROUP BY o.client_id, o.owner_user_id, u.name_ar, u.username`);
  const owner = new Map();
  for (const r of ownRows) {
    const cur = owner.get(r.cid); // الأعلى عدداً يفوز؛ التعادل يُحسم بترتيب المعرّف (حتمي عبر التشغيلات)
    if (!cur || r.n > cur.n || (r.n === cur.n && String(r.uid) < String(cur.uid))) owner.set(r.cid, r);
  }

  const rev = new Map(revRows.map((r) => [r.cid, r.v]));
  const prevRev = new Map(prevRevRows.map((r) => [r.cid, r.v]));
  const pipe = new Map(pipeRows.map((r) => [r.cid, r]));
  const prj = new Map(prjRows.map((r) => [r.cid, r.n]));
  const winloss = new Map(wlRows.map((r) => [r.cid, r]));
  const contracts = new Map(conRows.map((r) => [r.cid, r]));
  const touch = await lastTouchByClient();

  const rows = clients.map((c) => {
    const p = pipe.get(c.id);
    const wl = winloss.get(c.id);
    const con = contracts.get(c.id);
    const a = ar.get(c.id);
    const own = owner.get(c.id);
    const sectors = [...(secBy.get(c.id) || [])]
      .map((sid) => secMeta.get(sid))
      .sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0) || String(x.name_ar).localeCompare(String(y.name_ar), 'ar'))
      .map((s) => s.name_ar);
    const lastAt = touch.get(c.id) || null;
    return {
      ...c,
      open_pipeline_halalas: Math.round(p?.v || 0),
      weighted_pipeline_halalas: Math.round(p?.w || 0),
      open_opps: p?.n || 0,
      won_count: wl?.won_n || 0,
      won_value_halalas: Math.round(wl?.won_v || 0),
      hist_won_count: wl?.hist_n || 0,
      lost_count: wl?.lost_n || 0,
      contracts_count: con?.n || 0,
      contracts_value_halalas: Math.round(con?.v || 0),
      open_ar_halalas: Math.round(a?.out || 0),
      overdue_ar_halalas: Math.round(a?.overdue || 0),
      fy_revenue_halalas: Math.round(rev.get(c.id) || 0),
      prev_fy_revenue_halalas: Math.round(prevRev.get(c.id) || 0),
      active_projects: prj.get(c.id) || 0,
      sectors,
      rel_owner: own ? (own.oname || own.ouser || null) : null,
      rel_owner_user_id: own?.uid || null,
      last_activity_at: lastAt,
      relationship: relationshipOf(lastAt, p?.n || 0),
    };
  });
  // الافتراضي: أكبر العلاقات أولاً (إيراد السنة ثم قيمة الفرص المفتوحة) — القرار قبل التمرير
  const sort = filters.sort || 'revenue';
  if (sort === 'activity') rows.sort((a, b) => String(b.last_activity_at || '').localeCompare(String(a.last_activity_at || ''))
    || b.fy_revenue_halalas - a.fy_revenue_halalas);
  else if (sort === 'pipeline') rows.sort((a, b) => b.open_pipeline_halalas - a.open_pipeline_halalas
    || b.fy_revenue_halalas - a.fy_revenue_halalas);
  else rows.sort((a, b) => b.fy_revenue_halalas - a.fy_revenue_halalas
    || b.open_pipeline_halalas - a.open_pipeline_halalas
    || String(a.name_ar || '').localeCompare(String(b.name_ar || ''), 'ar'));
  return rows;
}

// ── نسبة الفوز (توحيد المؤشر مع لوحة الفرص) ───────────────────────────────────
// تُحسب على نفس نطاق المستخدم وبنفس معادلة اللوحة تماماً — فوز ÷ (فوز+خسارة) عبر
// scopeFilter للفرص (لا حسب العملاء الظاهرين) — فيطابق الرقمُ ما تعرضه صفحة الفرص لنفس المستخدم:
//   • hist_win_rate = كل السنوات (شامل المستورد التاريخي) = بطاقة «نسبة الفوز» في اللوحة بالضبط.
//   • fy_win_rate  = فرص السنة المالية المحسومة (يستثني المستورد) = عدّاد «مكسوبة سنة FY» في عمود اللوحة.
// استعلام تجميعي واحد خفيف (لا استعلام لكل صف). لا صلاحية = لا صفوف ⇒ قيم صفرية ونِسَب فارغة.
export async function salesWinRate(user, fy = config.fiscalYear) {
  // نفس خيارات قائمة الفرص، مؤهَّلةً باسم الجدول لأن الاستعلام يضمّ `stage` — فالنسبة تُحسب
  // على نفس الصفوف التي تعرضها اللوحة والقائمة لنفس المستخدم، وإلا افترق الرقمان بلا سبب ظاهر.
  const f = scopeFilter(user, 'opportunity', 'read',
    { sectorCol: 'opportunity.sector_id', ownerCol: 'opportunity.owner_user_id',
      grantCol: 'opportunity.department_id', memberCol: 'opportunity.id',
      deptCol: 'opportunity.department_id' });
  const r = await get(`SELECT
      COALESCE(SUM(CASE WHEN stage.is_won = 1 AND COALESCE(opportunity.exclude_from_sales,0) = 0 AND opportunity.year = ? THEN 1 ELSE 0 END),0) fy_won,
      COALESCE(SUM(CASE WHEN stage.is_lost = 1 AND opportunity.year = ? THEN 1 ELSE 0 END),0) fy_lost,
      COALESCE(SUM(CASE WHEN stage.is_won = 1 THEN 1 ELSE 0 END),0) hist_won,
      COALESCE(SUM(CASE WHEN stage.is_lost = 1 THEN 1 ELSE 0 END),0) hist_lost
    FROM opportunity JOIN stage ON stage.id = opportunity.stage_id
    WHERE ${f.clause} AND opportunity.deleted_at IS NULL AND (stage.is_won = 1 OR stage.is_lost = 1)`,
    [fy, fy, ...f.params]);
  const fyDecided = (r?.fy_won || 0) + (r?.fy_lost || 0);
  const histDecided = (r?.hist_won || 0) + (r?.hist_lost || 0);
  return {
    fy,
    fy_won: r?.fy_won || 0, fy_lost: r?.fy_lost || 0,
    fy_win_rate: fyDecided ? Math.round(((r.fy_won || 0) / fyDecided) * 100) : null,
    hist_won: r?.hist_won || 0, hist_lost: r?.hist_lost || 0,
    hist_win_rate: histDecided ? Math.round(((r.hist_won || 0) / histDecided) * 100) : null,
  };
}

// ── 360 overview (contracts §6 — exact payload; extra keys are additive extensions) ──
export async function clientOverview(user, clientId) {
  const client = await getVisibleClient(user, clientId, 'read');
  const fy = config.fiscalYear;
  const now = nowIso();
  const today = now.slice(0, 10);

  const contacts = await all('SELECT id, name, title, email, phone, created_at FROM contact WHERE client_id = ? AND deleted_at IS NULL ORDER BY created_at', [clientId]);

  // opportunities split open/won/lost — البصمة كاملةً، تغذّي **المجاميع** وحدها (أدناه)
  const opps = await all(`SELECT o.id, o.code, o.title_ar, o.value_halalas, o.win_pct, o.stage_id, o.stage_changed_at,
       o.next_action, o.sector_id, o.year, s.name_ar stage_name_ar, COALESCE(s.is_won,0) is_won, COALESCE(s.is_lost,0) is_lost
     FROM opportunity o LEFT JOIN stage s ON s.id = o.stage_id
     WHERE o.client_id = ? AND o.deleted_at IS NULL ORDER BY o.value_halalas DESC`, [clientId]);
  const open = opps.filter((o) => !o.is_won && !o.is_lost);
  const won = opps.filter((o) => o.is_won);
  const lost = opps.filter((o) => o.is_lost);
  const decided = won.length + lost.length;
  const win_rate = decided ? Math.round((won.length / decided) * 100) : 0;
  // حدود «الأرقام لا الأشخاص» داخل صفحة العميل (نفس حدود مركز القيادة — sector-feed-scope):
  // مؤشرات العميل ومجاميعه — خط الفرص المفتوح والمرجّح وتقسيمة القطاعات ونسبة الفوز — تُحسب من
  // بصمته كاملةً: مجاميع بلا عناوين. أما **صفوف** الفرص المفتوحة — عنوانها وقيمتها واحتمالها
  // وخطوتها التالية — فتفاصيل صفقةٍ قبل ترسيتها، تُقصّ على نطاق قائمة الفرص نفسه (نفس خيارات
  // listOpportunities مؤهَّلةً بـ`o.`): صفٌّ لا يفتحه القارئ لا يُعرَض له. المكسوبة والمخسورة
  // بعد الحسم علنيةٌ داخل النطاق كما كانت.
  let openRows = open;
  const of_ = scopeFilter(user, 'opportunity', 'read',
    { sectorCol: 'o.sector_id', ownerCol: 'o.owner_user_id', projectCol: 'o.id',
      grantCol: 'o.department_id', memberCol: 'o.id', deptCol: 'o.department_id' });
  if (of_.clause !== '1=1') {
    const visible = new Set((await all(`SELECT o.id FROM opportunity o
       WHERE o.client_id = ? AND o.deleted_at IS NULL AND ${of_.clause}`,
    [clientId, ...of_.params])).map((r) => r.id));
    openRows = open.filter((o) => visible.has(o.id));
  }

  const projects = await all(`SELECT id, code, name_ar, status, rag, progress_pct, start_date, end_date, sector_id, department_id, owner_user_id,
       COALESCE(NULLIF(contract_value_halalas,0), NULLIF(budget_halalas,0), NULLIF(po_value_halalas,0), NULLIF(revenue_halalas,0), 0) value_halalas
     FROM project WHERE client_id = ? AND deleted_at IS NULL ORDER BY (status = 'IN_PROGRESS') DESC, start_date DESC`, [clientId]);
  // ── صفوف المشاريع: أرقامٌ للجميع، أسماءٌ لأهلها ───────────────────────────────
  // نفس حدّ الفرص أعلاه على صفحة العميل (v5.9، نظير سطر «الأرقام لا الأشخاص»): **مجاميع**
  // القطاع (عدد المشاريع وقيمتها والجارية منها) تبقى من البصمة كاملةً — أرقامٌ لا أشخاص —
  // أما **صفوف** المشاريع بأسمائها وحالاتها فتُقصّ على نطاق قائمة المشاريع نفسه (deptCol +
  // يتيم القطاع): مشروعُ إدارةٍ أخرى لا يُعرَض اسمُه لمدير إدارةٍ لا يقودها، كما لا يظهر في
  // قائمته ولا يُفتح صفّياً. `visibleProject` = null ⟵ نطاقٌ شركيّ (الكلّ ظاهر بلا استعلام).
  const pf = scopeFilter(user, 'project', 'read',
    { deptCol: 'department_id', sectorCol: 'sector_id', ownerCol: 'owner_user_id', memberCol: 'id' });
  let visibleProjectIds = null;
  if (pf.clause !== '1=1') {
    visibleProjectIds = new Set((await all(
      `SELECT id FROM project WHERE client_id = ? AND deleted_at IS NULL AND ${pf.clause}`,
      [clientId, ...pf.params])).map((r) => r.id));
  }
  const projectVisible = (p) => visibleProjectIds === null || visibleProjectIds.has(p.id);
  // نسبة الإنجاز من مصدرها الواحد لا من العمود المخزَّن: كانت الشاشة تطبع `progress_pct` خاماً،
  // فمشروعٌ اعتُمدت مخرجاته كلها يُقرأ مئةً في صفحته و٥٨٪ هنا — رقمان في اجتماع واحد.
  const progMap = await effectiveProgress(projects);
  for (const p of projects) p.progress_effective_pct = progMap.get(p.id)?.pct ?? 0;

  const contracts = await all(`SELECT t.id, t.code, t.value_halalas, t.status, t.signed_at, t.start_date, t.end_date,
       t.project_id, p.name_ar project_name_ar
     FROM contract t LEFT JOIN project p ON p.id = t.project_id
     WHERE t.client_id = ? AND t.deleted_at IS NULL ORDER BY t.value_halalas DESC`, [clientId]);
  // اسمُ المشروع على العقد صفٌّ لا رقم — يُقصّ على نطاق القارئ كبقيّة صفوف المشاريع (v5.9): العقدُ
  // وقيمتُه يبقيان (رقمٌ للجميع)، أما اسمُ مشروعٍ من إدارةٍ (أو قطاعٍ) خارج نطاقه فيُطوى — فلا يُعرَض
  // اسمُه هنا كما لا يظهر في قائمته ولا يُفتح صفّياً. الطيُّ آمنٌ: العرض يُخفي الاسم الفارغ أصلاً.
  for (const t of contracts) {
    if (visibleProjectIds !== null && t.project_id && !visibleProjectIds.has(t.project_id)) t.project_name_ar = null;
  }

  // invoices + collections → summary (open AR = outstanding; overdue = outstanding past due date).
  // Legacy invoices are linked by project only — count those attached via the client's projects too.
  const invoices = await all(`SELECT i.id, i.code, i.amount_halalas, i.status, i.issue_date, i.due_date,
       (SELECT COALESCE(SUM(l.amount_halalas),0) FROM collection l WHERE l.invoice_id = i.id) collected_halalas
     FROM invoice i ${INV_JOIN}
     WHERE i.deleted_at IS NULL AND i.status NOT IN ('DRAFT','CANCELLED') AND ${INV_CID} = ?
     ORDER BY i.issue_date DESC`, [clientId]);
  let invoiced = 0, collected = 0, outstanding = 0, overdue = 0;
  for (const i of invoices) {
    const col = Math.min(i.collected_halalas || 0, i.amount_halalas || 0);
    const out = Math.max(0, (i.amount_halalas || 0) - col);
    invoiced += i.amount_halalas || 0;
    collected += col;
    outstanding += out;
    if (out > 0 && (i.status === 'OVERDUE' || (i.due_date && String(i.due_date).slice(0, 10) < today))) overdue += out;
  }

  // revenue: FY + lifetime + YoY + per-project FY breakdown (drill-down)
  const yoy = await all(`SELECT r.year, COALESCE(SUM(${netSql('r.amount_halalas', 'r.net_amount_halalas')}),0) revenue_halalas FROM revenue_line r
     JOIN project p ON p.id = r.project_id WHERE p.client_id = ? AND p.deleted_at IS NULL AND r.year IS NOT NULL
     GROUP BY r.year ORDER BY r.year`, [clientId]);
  const fyRevenue = Math.round(yoy.find((y) => y.year === fy)?.revenue_halalas || 0);
  const lifetime = Math.round(yoy.reduce((a, y) => a + (y.revenue_halalas || 0), 0));
  const fyRevenueByProject = await all(`SELECT p.id, p.name_ar, COALESCE(SUM(r.amount_halalas),0) revenue_halalas
     FROM revenue_line r JOIN project p ON p.id = r.project_id
     WHERE p.client_id = ? AND p.deleted_at IS NULL AND r.year = ? GROUP BY p.id, p.name_ar ORDER BY revenue_halalas DESC`, [clientId, fy]);
  const companyFy = (await get(`SELECT COALESCE(SUM(${netSql('amount_halalas', 'net_amount_halalas')}),0) v FROM revenue_line WHERE year = ?`, [fy]))?.v || 0;
  const concentration_pct = companyFy > 0 ? Math.round((fyRevenue / companyFy) * 1000) / 10 : 0;

  const documents = await all(`SELECT id, name, kind, url, note, size_bytes, uploaded_by, created_at
     FROM document WHERE client_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [clientId]);

  // ── activity timeline: logged crm_activity ∪ derived business events (real dated records only) ──
  const logged = (await all(`SELECT id, kind, at, title, detail, actor_name, source, opportunity_id, project_id
     FROM crm_activity WHERE client_id = ? AND deleted_at IS NULL ORDER BY at DESC LIMIT 50`, [clientId]))
    .map((a) => ({ id: a.id, kind: a.kind, at: a.at, title: a.title, detail: a.detail, actor: a.actor_name, source: a.source }));
  const derived = [];
  for (const o of [...won, ...lost]) {
    if (!o.stage_changed_at) continue; // no fabrication — only real dated records
    derived.push({
      kind: o.is_won ? 'won' : 'lost', at: o.stage_changed_at, source: 'derived',
      title: `${o.is_won ? 'فوز بفرصة' : 'خسارة فرصة'} «${o.title_ar}»`,
      detail: o.value_halalas ? `القيمة ${fmtSar(o.value_halalas)}` : null,
    });
  }
  for (const t of contracts) {
    const at = t.signed_at || t.start_date;
    if (!at) continue;
    derived.push({ kind: 'contract_signed', at, source: 'derived',
      title: `توقيع عقد${t.code ? ' ' + t.code : ''}`, detail: t.value_halalas ? `قيمة العقد ${fmtSar(t.value_halalas)}` : null });
  }
  for (const i of invoices) {
    if (i.issue_date) derived.push({ kind: 'invoice_issued', at: i.issue_date, source: 'derived',
      title: `إصدار فاتورة${i.code ? ' ' + i.code : ''}`, detail: `بقيمة ${fmtSar(i.amount_halalas)}` });
  }
  for (const l of await all(`SELECT l.amount_halalas, l.collected_at FROM collection l
       JOIN invoice i ON i.id = l.invoice_id ${INV_JOIN}
       WHERE i.deleted_at IS NULL AND l.collected_at IS NOT NULL AND ${INV_CID} = ?
       ORDER BY l.collected_at DESC LIMIT 50`, [clientId])) {
    derived.push({ kind: 'collection', at: l.collected_at, source: 'derived', title: 'تحصيل دفعة', detail: `بقيمة ${fmtSar(l.amount_halalas)}` });
  }
  for (const p of projects) {
    // اسمُ المشروع في خطّ النشاط صفٌّ لا رقم — يُقصّ على نطاق القارئ كبقيّة الصفوف.
    if (p.start_date && projectVisible(p)) derived.push({ kind: 'project_started', at: p.start_date, source: 'derived',
      title: `بدء مشروع «${p.name_ar}»`, detail: null });
  }
  const activities = [...logged, ...derived]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 50);

  const last_activity_at = maxAt(...activities.map((a) => a.at));
  const openPipeline = Math.round(open.reduce((a, o) => a + (o.value_halalas || 0), 0));
  const weighted = Math.round(open.reduce((a, o) => a + (o.value_halalas || 0) * ((o.win_pct || 0) / 100), 0));
  const activeProjects = projects.filter((p) => p.status === 'IN_PROGRESS').length;

  // ── الجهة واحدة، والعمل عليها موزَّع على قطاعاتنا ──────────────────────────
  // قرار المالك: الجهة لا تُقسَم إلى عميلين لأن قطاعين يخدمانها — تبقى عميلاً واحداً
  // **ويظهر التقسيم هنا**، داخل صفحتها. فرقٌ جوهري: الأول يكسر هوية العميل ويقسم تركّزه
  // وأعمار ديونه نصفين، والثاني يجيب سؤال «مَن منّا يشتغل معهم وعلى ماذا» بلا كسر شيء.
  //
  // القطاع يُقرأ من صف العمل نفسه (`sector_id` على الفرصة والمشروع)، لا من صف العميل:
  // العميل لا يملك قطاعاً — القطاع صفةُ العمل لا صفةُ الجهة.
  const sectorNames = new Map((await all(
    'SELECT id, name_ar FROM sector WHERE deleted_at IS NULL')).map((s) => [s.id, s.name_ar]));
  const bySectorMap = new Map();
  const bucket = (sid) => {
    const key = sid || '';
    if (!bySectorMap.has(key)) {
      bySectorMap.set(key, {
        sector_id: sid || null,
        // «بلا قطاع» حالة حقيقية في البيانات وتُسمّى، لا تُخفى ولا تُلحق بقطاع بالتخمين.
        name_ar: sid ? (sectorNames.get(sid) || 'قطاع غير معروف') : 'بلا قطاع مسجَّل',
        open_opps: 0, open_value_halalas: 0, weighted_halalas: 0,
        won_opps: 0, lost_opps: 0,
        projects: 0, active_projects: 0, project_value_halalas: 0,
        project_names: [],
      });
    }
    return bySectorMap.get(key);
  };
  for (const o of opps) {
    const b = bucket(o.sector_id);
    if (o.is_won) b.won_opps++;
    else if (o.is_lost) b.lost_opps++;
    else {
      b.open_opps++;
      b.open_value_halalas += o.value_halalas || 0;
      b.weighted_halalas += Math.round((o.value_halalas || 0) * ((o.win_pct || 0) / 100));
    }
  }
  for (const p of projects) {
    const b = bucket(p.sector_id);
    b.projects++;
    if (p.status === 'IN_PROGRESS') b.active_projects++;
    b.project_value_halalas += p.value_halalas || 0;
    // أسماء المشاريع الجارية أولاً — «أيش شغّال معهم» سؤال عن الحاضر لا عن الأرشيف. والاسمُ
    // صفٌّ لا رقم: يُقصّ على نطاق القارئ، فيبقى العدّ والقيمة كاملَين والأسماءُ لأهلها (v5.9).
    if (projectVisible(p)) b.project_names.push({ id: p.id, name_ar: p.name_ar, status: p.status, rag: p.rag,
      progress_effective_pct: p.progress_effective_pct, active: p.status === 'IN_PROGRESS' });
  }
  const by_sector = [...bySectorMap.values()]
    .map((b) => ({ ...b, project_names: b.project_names.sort((x, y) => (y.active ? 1 : 0) - (x.active ? 1 : 0)) }))
    .sort((a, b) => (b.active_projects - a.active_projects)
      || (b.project_value_halalas - a.project_value_halalas)
      || (b.open_value_halalas - a.open_value_halalas));

  return {
    client,
    contacts,
    by_sector,
    kpis: {
      fy_revenue_halalas: fyRevenue,
      lifetime_revenue_halalas: lifetime,
      open_pipeline_halalas: openPipeline,
      weighted_pipeline_halalas: weighted,
      active_projects: activeProjects,
      open_ar_halalas: Math.round(outstanding),
      last_activity_at,
      relationship: relationshipOf(last_activity_at, open.length),
    },
    activities,
    opportunities: { open: openRows, won, lost, win_rate },
    projects: projects.filter(projectVisible),
    contracts,
    invoices_summary: {
      invoiced: Math.round(invoiced), collected: Math.round(collected),
      outstanding: Math.round(outstanding), overdue: Math.round(overdue),
    },
    documents,
    yoy: yoy.map((y) => ({ year: y.year, revenue_halalas: Math.round(y.revenue_halalas) })),
    concentration_pct,
    // additive extensions (contract allows extending, not contradicting): drill-down detail rows
    invoices,
    // تفصيل إيراد السنة بحسب المشروع صفوفٌ بأسماء المشاريع — تُقصّ على نطاق القارئ كبقيّتها.
    fy_revenue_by_project: fyRevenueByProject.filter((r) => visibleProjectIds === null || visibleProjectIds.has(r.id)),
    fiscal_year: fy,
  };
}

// ── client CRUD ──────────────────────────────────────────────────────────────
// Dedupe key: lowercase, whitespace-collapsed, hamza/teh-marbuta/alef-maqsura folded, no tatweel/diacritics.
export function normalizeName(s) {
  return String(s || '')
    .replace(/[ً-ْـ]/g, '')      // diacritics + tatweel
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim().toLowerCase();
}
async function findDuplicate(name, exceptId = null) {
  const key = normalizeName(name);
  if (!key) return null;
  const rows = await all('SELECT id, name_ar, name_en FROM client WHERE deleted_at IS NULL');
  return rows.find((c) => c.id !== exceptId && (normalizeName(c.name_ar) === key || (c.name_en && normalizeName(c.name_en) === key))) || null;
}

export async function createClient(ctx, data = {}) {
  const user = ctx.user;
  if (!can(user, 'create', 'client')) throw forbidden();
  const name = (data.name_ar || '').toString().trim();
  if (!name) throw badRequest('اسم العميل مطلوب');
  if (data.type && !CLIENT_TYPES.includes(data.type)) throw badRequest('نوع العميل غير معروف — اختر: ' + CLIENT_TYPES.join(' / '));
  if (await findDuplicate(name)) throw badRequest('العميل موجود مسبقاً بنفس الاسم — ابحث عنه بدل إنشائه من جديد');
  const cid = id('cli');
  await insert('client', {
    id: cid, code: (data.code || '').toString().trim() || null, name_ar: name,
    name_en: (data.name_en || '').toString().trim() || null, type: data.type || null,
    active: 1, created_at: nowIso(), created_by: user.id,
  });
  await audit(ctx, { action: 'create', resource: 'client', resourceId: cid, detail: { name_ar: name, type: data.type || null } });
  return await get('SELECT * FROM client WHERE id = ?', [cid]);
}

// ── هوية الجهة: التكرار الذي لا يُمسَك بالمطابقة الحرفية ─────────────────────
// `findDuplicate` أعلاه يمسك الاسم **المطابق** بعد التطبيع، ولا يمسك ما وقع فعلاً: الجهة
// الواحدة مسجَّلة مرتين باسمين متقاربين، وانقسامها يتبع قطاع EVC المنفِّذ — «وزارة الاقتصاد
// والتخطيط» على قطاع الحلول و«… - الديوان العام» على قطاع الاستشارات، وهما وزارة واحدة.
// وأثره ليس تجميلياً: تركّز العميل وأعمار ديونه وخط فرصه وعمر علاقته تُقسَم نصفين، فيقرأ
// المالك جهتين متوسطتين مكان جهة كبيرة واحدة، ويُقيَّم كل قطاع كأنه يخدم عميلاً مستقلاً.
//
// كلمات لا تميّز جهةً عن أخرى: تُحذف لبناء **بصمة** الاسم فقط، ولا تُحذف من العرض أبداً.
const ENTITY_STOPWORDS = new Set(['ال', 'و', 'في', 'من', 'على', 'الوطني', 'الوطنيه', 'السعودي',
  'السعوديه', 'العربيه', 'المملكه', 'العامه', 'العام', 'الديوان', 'بمنطقه', 'منطقه']);
export function entityTokens(name) {
  return normalizeName(name).split(' ').filter((w) => w && !ENTITY_STOPWORDS.has(w));
}

// درجتان لا واحدة، لأن الفرق بينهما هو الفرق بين قرارٍ آليّ وقرارٍ بشري:
//   • `contained` — كلمات أحد الاسمين مجموعةٌ جزئية من الآخر («وزارة س» ⊂ «وزارة س - الديوان
//     العام»). لاحقةٌ أُضيفت لتمييز جهة عن نفسها، وهي الحالة الغالبة في بياناتنا.
//   • `overlap` — تقاطع عالٍ بلا احتواء. **ليس دليلاً**: «أمانة منطقة الرياض» و«أمانة منطقة
//     الجوف» يتقاطعان بقوة وهما جهتان مختلفتان قطعاً. يُعرَض للمراجعة ولا يُدمَج تلقائياً.
export function similarityOf(a, b) {
  const ta = entityTokens(a); const tb = entityTokens(b);
  if (!ta.length || !tb.length) return null;
  const sa = new Set(ta); const sb = new Set(tb);
  const inter = [...sa].filter((w) => sb.has(w)).length;
  if (!inter) return null;
  const contained = inter === Math.min(sa.size, sb.size);
  const overlap = inter / Math.max(sa.size, sb.size);
  if (contained) return { kind: 'contained', overlap, shared: inter };
  if (overlap >= 0.6 && inter >= 2) return { kind: 'overlap', overlap, shared: inter };
  return null;
}

// ── مطابقة الأسماء على المرجع الرسمي ────────────────────────────────────────
// المرجع يمسك ما تعجز عنه مقارنة النصوص: لا رابط لغوي بين «هدف» و«صندوق تنمية الموارد
// البشرية»، ولا بين «سدايا» واسمها الرسمي — والمرجع يعرف أنهما واحد. فجهتان تتّفقان على
// **نفس السجل الرسمي** تكرارٌ قاطع مهما اختلف نصّاهما، وهو أقوى دليل من تشابه الكلمات.
export async function clientNameReview(user) {
  // الاسم المُعتمَد يخرج من المراجعة كلياً: بلا هذا الشرط تعود المنصة إلى **نفس الاقتراح
  // المرفوض** كلما فُتحت الشاشة — و«أرامكو السعودية» تُقترَح «شركة الزيت العربية السعودية»
  // أبداً. واقتراحٌ مرفوض يتكرّر ليس ضجيجاً فحسب: من يراه عشر مرات يضغطه في الحادية عشرة.
  const where = ['c.deleted_at IS NULL', 'c.merged_into_client_id IS NULL', 'c.name_confirmed_at IS NULL'];
  const params = [];
  const sc = clientScopeClause(user, 'read');
  if (!sc) throw forbidden();
  if (sc.clause !== '1=1') { where.push(sc.clause); params.push(...sc.params); }
  const rows = await all(`SELECT c.id, c.name_ar, c.code FROM client c
    WHERE ${where.join(' AND ')} ORDER BY c.name_ar`, params);

  const rename = []; const review = []; const unknown = [];
  const byEntity = new Map();
  for (const c of rows) {
    const m = matchEntity(c.name_ar);
    if (!m) { unknown.push(c); continue; }
    if (m.confidence === 'مؤكَّد') {
      const k = m.entity.id;
      (byEntity.get(k) || byEntity.set(k, []).get(k)).push({ client: c, match: m });
      // المطابق حرفاً بحرف لا يُقترح عليه شيء — هو الصواب أصلاً.
      if (!m.exact) rename.push({ client: c, official_name: m.official_name, abbr: m.abbr, reason_ar: m.reason_ar });
    } else {
      review.push({ client: c, official_name: m.official_name, abbr: m.abbr, reason_ar: m.reason_ar });
    }
  }
  // تكرار قاطع: صفّان مختلفان يشيران بيقين إلى جهة رسمية واحدة.
  const collisions = [...byEntity.values()].filter((g) => g.length > 1)
    .map((g) => ({ official_name: g[0].match.official_name, abbr: g[0].match.abbr,
      members: g.map((x) => ({ id: x.client.id, name_ar: x.client.name_ar, reason_ar: x.match.reason_ar })) }));

  return { total: rows.length, registry_size: entityCount(), collisions, rename, review, unknown };
}

// اعتماد اسم الجهة كما هو: قرارٌ بشري يُسكِت الاقتراح ولا يُغيّر شيئاً في البيانات.
// ويبقى قابلاً للرفع، فالمسمّى قد يتغيّر فعلاً ولا يصحّ أن يُقفَل الباب إلى الأبد.
export async function confirmClientName(ctx, clientId, { confirmed = true } = {}) {
  const user = ctx.user;
  if (!can(user, 'update', 'client')) throw forbidden();
  const row = await getVisibleClient(user, clientId, 'update');
  const at = confirmed ? nowIso() : null;
  await update('client', clientId, {
    name_confirmed_at: at, name_confirmed_by: confirmed ? user.id : null, updated_at: nowIso(),
  });
  await audit(ctx, { action: 'update', resource: 'client', resourceId: clientId,
    detail: { name_confirmed: confirmed, name_ar: row.name_ar } });
  return await get('SELECT * FROM client WHERE id = ?', [clientId]);
}

// الجهات المشتبه بتكرارها — تُستدعى من فحص صحة البيانات ومن شاشة العملاء.
// تقرأ الجهات غير المحذوفة وغير المدموجة فقط: الجهة المدموجة سبق أن حُسم أمرها.
// النطاق يُطبَّق بنفس شرط قائمة العملاء: من لا يرى جهةً لا يُخبَر بوجودها في قائمة تكرار.
export async function likelyDuplicateClients(user = null) {
  const where = ['c.deleted_at IS NULL', 'c.merged_into_client_id IS NULL'];
  const params = [];
  if (user) {
    const sc = clientScopeClause(user, 'read');
    if (!sc) throw forbidden();
    if (sc.clause !== '1=1') { where.push(sc.clause); params.push(...sc.params); }
  }
  const rows = await all(`SELECT c.id, c.code, c.name_ar, c.name_en FROM client c
    WHERE ${where.join(' AND ')} ORDER BY c.name_ar`, params);
  const pairs = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const sim = similarityOf(rows[i].name_ar, rows[j].name_ar);
      if (sim) pairs.push({ ...sim, a: rows[i], b: rows[j] });
    }
  }
  // الاحتواء أولاً: هو الأقرب إلى تكرار حقيقي، والأعلى تقاطعاً داخل كل درجة.
  pairs.sort((x, y) => (x.kind === y.kind ? y.overlap - x.overlap : (x.kind === 'contained' ? -1 : 1)));
  return pairs;
}

// الجداول التي تحمل الجهة. كل واحد منها يُنقَل عند الدمج — وإغفال واحد يعني عملاً يتيماً
// يشير إلى صفٍّ محذوف، فالقائمة مشتقّة من المخطط لا من الذاكرة، ويحرسها اختبار.
export const CLIENT_OWNED_TABLES = ['contact', 'opportunity', 'project', 'contract', 'invoice', 'crm_activity', 'document'];

// دمج جهتين فأكثر في واحدة. عملية واحدة ذرّية: إمّا انتقل كل شيء أو لم ينتقل شيء.
export async function mergeClients(ctx, { keepId, mergeIds = [], keepName = null } = {}) {
  const user = ctx.user;
  // الدمج يفوق التعديل أثراً — يُخفي جهةً ويعيد نسبة مالها — فيلزمه منح الحذف أيضاً.
  if (!can(user, 'update', 'client') || !can(user, 'delete', 'client')) {
    throw forbidden('دمج الجهات يحتاج صلاحية تعديل الجهات وحذفها.');
  }
  const ids = [...new Set((Array.isArray(mergeIds) ? mergeIds : [mergeIds]).filter(Boolean))];
  if (!keepId) throw badRequest('حدّد الجهة التي تبقى.');
  if (!ids.length) throw badRequest('حدّد جهةً واحدة على الأقل لدمجها.');
  if (ids.includes(keepId)) throw badRequest('لا يمكن دمج الجهة في نفسها — الجهة الباقية غير الجهة المدموجة.');

  const keep = await get('SELECT * FROM client WHERE id = ? AND deleted_at IS NULL', [keepId]);
  if (!keep) throw notFound('الجهة الباقية غير موجودة.');
  const losers = [];
  for (const cid of ids) {
    const row = await get('SELECT * FROM client WHERE id = ? AND deleted_at IS NULL', [cid]);
    if (!row) throw notFound(`الجهة المطلوب دمجها غير موجودة: ${cid}`);
    if (row.merged_into_client_id) throw badRequest(`«${row.name_ar}» مدموجة أصلاً — لا تُدمَج مرتين.`);
    losers.push(row);
  }
  // النطاق يُفحص على الطرفين: من لا يرى جهةً لا ينقل عملها ولا يخفيها.
  await getVisibleClient(user, keepId, 'update');
  for (const l of losers) await getVisibleClient(user, l.id, 'update');

  const moved = {};
  const at = nowIso();
  await tx(async () => {
    const ph = losers.map(() => '?').join(',');
    const lids = losers.map((l) => l.id);
    for (const table of CLIENT_OWNED_TABLES) {
      const before = await all(`SELECT id FROM ${table} WHERE client_id IN (${ph})`, lids);
      if (!before.length) continue;
      await run(`UPDATE ${table} SET client_id = ? WHERE client_id IN (${ph})`, [keepId, ...lids]);
      moved[table] = before.length;
    }
    // الاسم الباقي قرار المالك لا اشتقاق: قد يكون أطول الاسمين أو أقصرهما أو غيرهما.
    if (keepName && keepName.trim() && keepName.trim() !== keep.name_ar) {
      await update('client', keepId, { name_ar: keepName.trim(), updated_at: at });
    }
    for (const l of losers) {
      await update('client', l.id, {
        merged_into_client_id: keepId, active: 0, deleted_at: at, updated_at: at,
      });
    }
  });

  for (const l of losers) {
    await audit(ctx, { action: 'delete', resource: 'client', resourceId: l.id,
      detail: { merged_into: keepId, merged_into_name: keepName || keep.name_ar, name_ar: l.name_ar, moved } });
  }
  await audit(ctx, { action: 'update', resource: 'client', resourceId: keepId,
    detail: { merged_from: losers.map((l) => ({ id: l.id, name_ar: l.name_ar })), moved, renamed_to: keepName || null } });

  return {
    keep: await get('SELECT * FROM client WHERE id = ?', [keepId]),
    merged: losers.map((l) => ({ id: l.id, name_ar: l.name_ar })),
    moved,
  };
}

// فكّ الدمج — الدمج قرار كبير، ومن يملك اتخاذه يملك التراجع عنه. لا يعيد نسبة العمل
// تلقائياً (فقد اختلط بعمل الجهة الباقية ولا سبيل لتمييزه)، بل يعيد الجهة ظاهرةً فارغة
// ويقول ذلك صراحةً — فالوعد الكاذب بالاسترجاع أسوأ من الإقرار بحدوده.
export async function unmergeClient(ctx, clientId) {
  const user = ctx.user;
  const row = await get('SELECT * FROM client WHERE id = ?', [clientId]);
  if (!row) throw notFound('الجهة غير موجودة.');
  if (!row.merged_into_client_id) throw badRequest('هذه الجهة غير مدموجة — لا شيء يُفَكّ.');
  // النطاق يُفحص على الجهة الباقية (المدموج فيها) لا بمجرد وجود المنح: فحصٌ بلا هدف كان يمرّ لمن
  // يملك تعديل الجهات في أي نطاق فيفكّ دمجاً لا يخصّه. الجهة المدموجة محذوفةٌ ظاهرياً فلا تراها
  // getVisibleClient، لكن مِلكَ فكّ الدمج كمِلكِ الدمج (getVisibleClient على الطرفين قبله) —
  // تعديلٌ على الجهة التي ابتلعت الدمج، وهي ظاهرةٌ يُفحص نطاقها كما يُفحص في كل باب.
  await getVisibleClient(user, row.merged_into_client_id, 'update');
  await update('client', clientId, { merged_into_client_id: null, active: 1, deleted_at: null, updated_at: nowIso() });
  await audit(ctx, { action: 'update', resource: 'client', resourceId: clientId,
    detail: { unmerged_from: row.merged_into_client_id, note: 'أُعيدت الجهة ظاهرة؛ العمل المنقول يبقى على الجهة الباقية' } });
  return await get('SELECT * FROM client WHERE id = ?', [clientId]);
}

export async function updateClient(ctx, clientId, data = {}) {
  const user = ctx.user;
  if (!can(user, 'update', 'client')) throw forbidden();
  await getVisibleClient(user, clientId, 'update');
  const patch = {};
  for (const k of ['name_ar', 'name_en', 'type', 'sector_market', 'active']) if (k in data) patch[k] = data[k];
  if ('name_ar' in patch) {
    patch.name_ar = (patch.name_ar || '').toString().trim();
    if (!patch.name_ar) throw badRequest('اسم العميل مطلوب');
    if (await findDuplicate(patch.name_ar, clientId)) throw badRequest('العميل موجود مسبقاً بنفس الاسم');
  }
  if ('type' in patch && patch.type && !CLIENT_TYPES.includes(patch.type)) throw badRequest('نوع العميل غير معروف — اختر: ' + CLIENT_TYPES.join(' / '));
  if ('active' in patch) patch.active = patch.active ? 1 : 0;
  if (!Object.keys(patch).length) throw badRequest('لا يوجد تعديل لتطبيقه');
  patch.updated_at = nowIso();
  await update('client', clientId, patch);
  await audit(ctx, { action: 'update', resource: 'client', resourceId: clientId, detail: patch });
  return await get('SELECT * FROM client WHERE id = ?', [clientId]);
}

// ── contacts ─────────────────────────────────────────────────────────────────
export async function addContact(ctx, clientId, data = {}) {
  const user = ctx.user;
  if (!can(user, 'create', 'contact')) throw forbidden();
  await getVisibleClient(user, clientId, 'read');
  const name = (data.name || '').toString().trim();
  if (!name) throw badRequest('اسم جهة الاتصال مطلوب');
  const cid = id('cnt');
  await insert('contact', {
    id: cid, client_id: clientId, name,
    title: (data.title || '').toString().trim() || null,
    email: (data.email || '').toString().trim() || null,
    phone: (data.phone || '').toString().trim() || null,
    created_at: nowIso(),
  });
  await audit(ctx, { action: 'create', resource: 'contact', resourceId: cid, detail: { client_id: clientId, name } });
  return await get('SELECT * FROM contact WHERE id = ?', [cid]);
}

async function getContactChecked(user, contactId, action) {
  const row = await get('SELECT * FROM contact WHERE id = ? AND deleted_at IS NULL', [contactId]);
  if (!row) throw notFound('جهة الاتصال غير موجودة');
  if (!can(user, action, 'contact')) throw forbidden();
  await getVisibleClient(user, row.client_id, 'read'); // sector reach via the parent client
  return row;
}

export async function updateContact(ctx, contactId, data = {}) {
  const row = await getContactChecked(ctx.user, contactId, 'update');
  const patch = {};
  for (const k of ['name', 'title', 'email', 'phone']) if (k in data) patch[k] = (data[k] || '').toString().trim() || null;
  if ('name' in patch && !patch.name) throw badRequest('اسم جهة الاتصال مطلوب');
  if (!Object.keys(patch).length) throw badRequest('لا يوجد تعديل لتطبيقه');
  await update('contact', contactId, patch);
  await audit(ctx, { action: 'update', resource: 'contact', resourceId: contactId, sectorId: null, detail: { client_id: row.client_id, ...patch } });
  return await get('SELECT * FROM contact WHERE id = ?', [contactId]);
}

export async function deleteContact(ctx, contactId) {
  const row = await getContactChecked(ctx.user, contactId, 'delete');
  await update('contact', contactId, { deleted_at: nowIso() });
  await audit(ctx, { action: 'delete', resource: 'contact', resourceId: contactId, detail: { client_id: row.client_id } });
  return { ok: true };
}

// ── documents (metadata only — no blobs) ─────────────────────────────────────
export async function addDocument(ctx, clientId, data = {}) {
  const user = ctx.user;
  if (!can(user, 'update', 'client')) throw forbidden();
  await getVisibleClient(user, clientId, 'update');
  const name = (data.name || '').toString().trim();
  if (!name) throw badRequest('اسم المستند مطلوب');
  const url = (data.url || '').toString().trim() || null;
  if (url && !/^https?:\/\//i.test(url)) throw badRequest('رابط المستند يجب أن يبدأ بـ https://');
  const kind = ['contract', 'proposal', 'report', 'letter', 'other'].includes(data.kind) ? data.kind : 'other';
  const did = id('doc');
  await insert('document', {
    id: did, client_id: clientId, name, kind, url,
    note: (data.note || '').toString().trim() || null,
    uploaded_by: user.name_ar || user.username || null, created_at: nowIso(),
  });
  await audit(ctx, { action: 'create', resource: 'document', resourceId: did, detail: { client_id: clientId, name, kind } });
  return await get('SELECT * FROM document WHERE id = ?', [did]);
}

// ── activities ───────────────────────────────────────────────────────────────
// Writing an activity requires READ on the linked resource (you log a touchpoint you took part
// in) — the linked opportunity/project row check is the row-level guard; sector is inferred.
export async function logActivity(ctx, data = {}) {
  const user = ctx.user;
  const kind = (data.kind || '').toString();
  if (!ACTIVITY_KINDS.includes(kind)) throw badRequest('نوع النشاط غير معروف — اختر: اتصال / اجتماع / بريد / زيارة / ملاحظة');
  const title = (data.title || '').toString().trim();
  if (!title) throw badRequest('عنوان النشاط مطلوب');
  if (!data.client_id && !data.opportunity_id && !data.project_id) throw badRequest('اربط النشاط بعميل أو فرصة أو مشروع');

  let clientId = data.client_id || null, sectorId = null;
  if (data.opportunity_id) {
    // بابُ القراءة الواحد (v5.2): الإدارات المشاركة تلحق عبر loadReadableOpportunity —
    // من تُفتح له صفحةُ الفرصة يُسجِّل نشاطاً عليها، بلا فحصٍ ثانٍ أضيقَ من الأول.
    const opp = await loadReadableOpportunity(user, data.opportunity_id);
    clientId = clientId || opp.client_id;
    sectorId = opp.sector_id || sectorId;
  }
  if (data.project_id) {
    const project = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [data.project_id]);
    if (!project) throw notFound('المشروع غير موجود');
    if (!can(user, 'read', 'project', project)) throw forbidden();
    clientId = clientId || project.client_id;
    sectorId = sectorId || project.sector_id;
  }
  // an explicitly-addressed client must be within the caller's reach; a client inherited from a
  // readable opportunity/project is already covered by that row's check (linkGranted).
  if (data.client_id) await getVisibleClient(user, data.client_id, 'read');
  sectorId = sectorId || user.sector_id || null;

  const aid = id('act');
  await insert('crm_activity', {
    id: aid, kind, at: nowIso(),
    actor_user_id: user.id, actor_name: user.name_ar || user.username || null,
    client_id: clientId, opportunity_id: data.opportunity_id || null, project_id: data.project_id || null,
    sector_id: sectorId, title, detail: (data.detail || '').toString().trim() || null,
    source: 'app', created_at: nowIso(), created_by: user.id,
  });
  await audit(ctx, { action: 'create', resource: 'activity', resourceId: aid, sectorId, detail: { kind, client_id: clientId } });
  return await get('SELECT * FROM crm_activity WHERE id = ?', [aid]);
}

export async function listActivities(user, filters = {}) {
  if (!(can(user, 'read', 'client') || can(user, 'read', 'opportunity') || can(user, 'read', 'project'))) throw forbidden();
  const where = ['a.deleted_at IS NULL'];
  const params = [];
  let scopedByFilter = false;
  if (filters.opportunity_id) {
    // نفس باب القراءة الواحد: من يرى الفرصة يرشِّح نشاطها (شاملاً الإدارات المشاركة).
    await loadReadableOpportunity(user, filters.opportunity_id);
    where.push('a.opportunity_id = ?'); params.push(filters.opportunity_id); scopedByFilter = true;
  }
  if (filters.project_id) {
    const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [filters.project_id]);
    if (!p) throw notFound('المشروع غير موجود');
    if (!can(user, 'read', 'project', p)) throw forbidden();
    where.push('a.project_id = ?'); params.push(filters.project_id); scopedByFilter = true;
  }
  if (filters.client_id) {
    await getVisibleClient(user, filters.client_id, 'read');
    where.push('a.client_id = ?'); params.push(filters.client_id); scopedByFilter = true;
  }
  if (filters.sector_id) {
    if (user.scope !== 'company' && user.sector_id !== filters.sector_id) throw forbidden();
    where.push('a.sector_id = ?'); params.push(filters.sector_id); scopedByFilter = true;
  }
  if (!scopedByFilter && user.scope !== 'company') {
    where.push('a.sector_id = ?'); params.push(user.sector_id);
  }
  if (filters.before) { where.push('a.at < ?'); params.push(String(filters.before)); }
  const limit = Math.max(1, Math.min(100, Number(filters.limit) || 50));
  return await all(`SELECT a.* FROM crm_activity a WHERE ${where.join(' AND ')} ORDER BY a.at DESC LIMIT ${limit}`, params);
}
