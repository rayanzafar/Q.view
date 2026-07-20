// Clients (CRM 360) — service layer. Scope-aware lists, the composed clientOverview payload
// (contracts §6), contacts CRUD, the activity stream (crm_activity + derived business events),
// and client documents (metadata only). All writes: can() + audit(). Money = INTEGER halalas.
//
// Scoping model: `client` rows carry no sector_id. A client is visible to a sector-scoped user
// when the client has ANY footprint (opportunity / project / contract) in that user's sector —
// computed with EXISTS subqueries so the DB enforces the boundary, not the app.
import { all, get, insert, update } from '../../core/db/index.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, fmtSar } from '../../core/util/ids.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { config } from '../../core/config.js';

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
async function lastTouchByClient() {
  const out = new Map();
  const feed = (rows) => { for (const r of rows) if (r.cid && r.at) out.set(r.cid, maxAt(out.get(r.cid), r.at)); };
  feed(await all(`SELECT client_id cid, MAX(at) at FROM crm_activity WHERE deleted_at IS NULL AND client_id IS NOT NULL GROUP BY client_id`));
  feed(await all(`SELECT o.client_id cid, MAX(o.stage_changed_at) at FROM opportunity o JOIN stage s ON s.id = o.stage_id
     WHERE o.deleted_at IS NULL AND o.client_id IS NOT NULL AND (s.is_won = 1 OR s.is_lost = 1) AND o.stage_changed_at IS NOT NULL GROUP BY o.client_id`));
  feed(await all(`SELECT client_id cid, MAX(COALESCE(signed_at, start_date)) at FROM contract
     WHERE deleted_at IS NULL AND client_id IS NOT NULL GROUP BY client_id`));
  // legacy invoices carry project_id only — resolve the client through the project when unset
  feed(await all(`SELECT COALESCE(i.client_id, p.client_id) cid, MAX(i.issue_date) at
     FROM invoice i LEFT JOIN project p ON p.id = i.project_id
     WHERE i.deleted_at IS NULL AND i.issue_date IS NOT NULL AND i.status NOT IN ('DRAFT','CANCELLED')
       AND COALESCE(i.client_id, p.client_id) IS NOT NULL GROUP BY COALESCE(i.client_id, p.client_id)`));
  feed(await all(`SELECT COALESCE(i.client_id, p.client_id) cid, MAX(l.collected_at) at
     FROM collection l JOIN invoice i ON i.id = l.invoice_id LEFT JOIN project p ON p.id = i.project_id
     WHERE i.deleted_at IS NULL AND l.collected_at IS NOT NULL
       AND COALESCE(i.client_id, p.client_id) IS NOT NULL GROUP BY COALESCE(i.client_id, p.client_id)`));
  feed(await all(`SELECT client_id cid, MAX(start_date) at FROM project
     WHERE deleted_at IS NULL AND client_id IS NOT NULL AND start_date IS NOT NULL GROUP BY client_id`));
  return out;
}

// ── list ─────────────────────────────────────────────────────────────────────
// listClients(user, {query, type, sort, sector}) → client cols + open_pipeline_halalas,
// fy_revenue_halalas, active_projects, open_opps, last_activity_at, relationship.
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
  const revRows = await all(`SELECT p.client_id cid, COALESCE(SUM(r.amount_halalas),0) v FROM revenue_line r
     JOIN project p ON p.id = r.project_id WHERE r.year = ? AND p.client_id IS NOT NULL AND p.deleted_at IS NULL GROUP BY p.client_id`, [fy]);
  const pipeRows = await all(`SELECT o.client_id cid, COUNT(*) n, COALESCE(SUM(o.value_halalas),0) v FROM opportunity o
     LEFT JOIN stage s ON s.id = o.stage_id
     WHERE o.deleted_at IS NULL AND o.client_id IS NOT NULL AND COALESCE(s.is_won,0) = 0 AND COALESCE(s.is_lost,0) = 0 GROUP BY o.client_id`);
  const prjRows = await all(`SELECT client_id cid, COUNT(*) n FROM project
     WHERE deleted_at IS NULL AND client_id IS NOT NULL AND status = 'IN_PROGRESS' GROUP BY client_id`);
  const rev = new Map(revRows.map((r) => [r.cid, r.v]));
  const pipe = new Map(pipeRows.map((r) => [r.cid, r]));
  const prj = new Map(prjRows.map((r) => [r.cid, r.n]));
  const touch = await lastTouchByClient();

  const rows = clients.map((c) => {
    const p = pipe.get(c.id);
    const lastAt = touch.get(c.id) || null;
    return {
      ...c,
      open_pipeline_halalas: Math.round(p?.v || 0),
      open_opps: p?.n || 0,
      fy_revenue_halalas: Math.round(rev.get(c.id) || 0),
      active_projects: prj.get(c.id) || 0,
      last_activity_at: lastAt,
      relationship: relationshipOf(lastAt, p?.n || 0),
    };
  });
  const sort = filters.sort || 'activity';
  if (sort === 'revenue') rows.sort((a, b) => b.fy_revenue_halalas - a.fy_revenue_halalas);
  else if (sort === 'pipeline') rows.sort((a, b) => b.open_pipeline_halalas - a.open_pipeline_halalas);
  else rows.sort((a, b) => String(b.last_activity_at || '').localeCompare(String(a.last_activity_at || ''))
    || b.fy_revenue_halalas - a.fy_revenue_halalas);
  return rows;
}

// ── 360 overview (contracts §6 — exact payload; extra keys are additive extensions) ──
export async function clientOverview(user, clientId) {
  const client = await getVisibleClient(user, clientId, 'read');
  const fy = config.fiscalYear;
  const now = nowIso();
  const today = now.slice(0, 10);

  const contacts = await all('SELECT id, name, title, email, phone, created_at FROM contact WHERE client_id = ? AND deleted_at IS NULL ORDER BY created_at', [clientId]);

  // opportunities split open/won/lost
  const opps = await all(`SELECT o.id, o.code, o.title_ar, o.value_halalas, o.win_pct, o.stage_id, o.stage_changed_at,
       o.next_action, o.sector_id, o.year, s.name_ar stage_name_ar, COALESCE(s.is_won,0) is_won, COALESCE(s.is_lost,0) is_lost
     FROM opportunity o LEFT JOIN stage s ON s.id = o.stage_id
     WHERE o.client_id = ? AND o.deleted_at IS NULL ORDER BY o.value_halalas DESC`, [clientId]);
  const open = opps.filter((o) => !o.is_won && !o.is_lost);
  const won = opps.filter((o) => o.is_won);
  const lost = opps.filter((o) => o.is_lost);
  const decided = won.length + lost.length;
  const win_rate = decided ? Math.round((won.length / decided) * 100) : 0;

  const projects = await all(`SELECT id, code, name_ar, status, rag, progress_pct, start_date, end_date, sector_id,
       COALESCE(NULLIF(contract_value_halalas,0), NULLIF(budget_halalas,0), NULLIF(po_value_halalas,0), NULLIF(revenue_halalas,0), 0) value_halalas
     FROM project WHERE client_id = ? AND deleted_at IS NULL ORDER BY (status = 'IN_PROGRESS') DESC, start_date DESC`, [clientId]);

  const contracts = await all(`SELECT t.id, t.code, t.value_halalas, t.status, t.signed_at, t.start_date, t.end_date,
       t.project_id, p.name_ar project_name_ar
     FROM contract t LEFT JOIN project p ON p.id = t.project_id
     WHERE t.client_id = ? AND t.deleted_at IS NULL ORDER BY t.value_halalas DESC`, [clientId]);

  // invoices + collections → summary (open AR = outstanding; overdue = outstanding past due date).
  // Legacy invoices are linked by project only — count those attached via the client's projects too.
  const invoices = await all(`SELECT i.id, i.code, i.amount_halalas, i.status, i.issue_date, i.due_date,
       (SELECT COALESCE(SUM(l.amount_halalas),0) FROM collection l WHERE l.invoice_id = i.id) collected_halalas
     FROM invoice i WHERE i.deleted_at IS NULL AND i.status NOT IN ('DRAFT','CANCELLED')
       AND (i.client_id = ? OR (i.client_id IS NULL AND i.project_id IN (SELECT id FROM project WHERE client_id = ? AND deleted_at IS NULL)))
     ORDER BY i.issue_date DESC`, [clientId, clientId]);
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
  const yoy = await all(`SELECT r.year, COALESCE(SUM(r.amount_halalas),0) revenue_halalas FROM revenue_line r
     JOIN project p ON p.id = r.project_id WHERE p.client_id = ? AND p.deleted_at IS NULL AND r.year IS NOT NULL
     GROUP BY r.year ORDER BY r.year`, [clientId]);
  const fyRevenue = Math.round(yoy.find((y) => y.year === fy)?.revenue_halalas || 0);
  const lifetime = Math.round(yoy.reduce((a, y) => a + (y.revenue_halalas || 0), 0));
  const fyRevenueByProject = await all(`SELECT p.id, p.name_ar, COALESCE(SUM(r.amount_halalas),0) revenue_halalas
     FROM revenue_line r JOIN project p ON p.id = r.project_id
     WHERE p.client_id = ? AND p.deleted_at IS NULL AND r.year = ? GROUP BY p.id, p.name_ar ORDER BY revenue_halalas DESC`, [clientId, fy]);
  const companyFy = (await get('SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE year = ?', [fy]))?.v || 0;
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
  for (const l of await all(`SELECT l.amount_halalas, l.collected_at FROM collection l JOIN invoice i ON i.id = l.invoice_id
       WHERE i.deleted_at IS NULL AND l.collected_at IS NOT NULL
         AND (i.client_id = ? OR (i.client_id IS NULL AND i.project_id IN (SELECT id FROM project WHERE client_id = ? AND deleted_at IS NULL)))
       ORDER BY l.collected_at DESC LIMIT 50`, [clientId, clientId])) {
    derived.push({ kind: 'collection', at: l.collected_at, source: 'derived', title: 'تحصيل دفعة', detail: `بقيمة ${fmtSar(l.amount_halalas)}` });
  }
  for (const p of projects) {
    if (p.start_date) derived.push({ kind: 'project_started', at: p.start_date, source: 'derived',
      title: `بدء مشروع «${p.name_ar}»`, detail: null });
  }
  const activities = [...logged, ...derived]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 50);

  const last_activity_at = maxAt(...activities.map((a) => a.at));
  const openPipeline = Math.round(open.reduce((a, o) => a + (o.value_halalas || 0), 0));
  const weighted = Math.round(open.reduce((a, o) => a + (o.value_halalas || 0) * ((o.win_pct || 0) / 100), 0));
  const activeProjects = projects.filter((p) => p.status === 'IN_PROGRESS').length;

  return {
    client,
    contacts,
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
    opportunities: { open, won, lost, win_rate },
    projects,
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
    fy_revenue_by_project: fyRevenueByProject,
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
    const opp = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [data.opportunity_id]);
    if (!opp) throw notFound('الفرصة غير موجودة');
    if (!can(user, 'read', 'opportunity', opp)) throw forbidden();
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
    const opp = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [filters.opportunity_id]);
    if (!opp) throw notFound('الفرصة غير موجودة');
    if (!can(user, 'read', 'opportunity', opp)) throw forbidden();
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
