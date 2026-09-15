// Migrate the read-only legacy snapshot (single JSON doc) → relational schema.
// Idempotent-ish: clears migrated tables first (dev only). Produces a reconciliation report.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, config } from '../src/core/config.js';
import { run, get, insert, tx, exec } from '../src/core/db/index.js';
import { id, nowIso, toHalalas } from '../src/core/util/ids.js';

// Prefer the real (sensitive, gitignored) snapshot when present; otherwise fall back to the
// sanitized demo snapshot (salaries zeroed, login IPs stripped) so staging can seed real business
// structure without exposing compensation/IP data. Resolved lazily inside migrateLegacy() so that
// merely importing this module never throws when no data file is present.
const pick = (base) => {
  const real = resolve(ROOT, `seed/${base}.snapshot.json`);
  const demo = resolve(ROOT, `seed/${base}.demo.json`);
  if (existsSync(real)) return real;
  if (existsSync(demo)) return demo;
  throw new Error(`no data file for ${base} (looked for ${base}.snapshot.json / ${base}.demo.json)`);
};

const roleMap = { admin: 'admin', sector_manager: 'sector_lead', sector_lead: 'sector_lead',
  bd_manager: 'bd_manager', consultant: 'consultant', viewer: 'viewer', USER: 'employee', user: 'employee' };
const scopeFor = (role) => role === 'admin' ? 'company' : (role === 'sector_lead' || role === 'ceo_office') ? 'sector' : 'own';

// حارس تدمير: هذا السكربت يفرغ 50+ جدولاً (المهام، التسكين، العضويات، سجل الوقت) قبل إعادة
// التحميل. تشغيله مرة واحدة بالخطأ على بيئة حيّة يمحو كل عمل المستخدمين بلا رجعة. لذلك يرفض
// العمل ما لم تُعلَن النية صراحةً — ومع قاعدة Postgres (staging/prod) يلزم أيضاً تأكيد نسخة احتياطية.
function assertDestructiveAllowed() {
  const armed = process.env.SANAD_ALLOW_LEGACY_WIPE === '1';
  if (!armed) {
    throw new Error(
      'migrate-legacy يفرغ جداول البيانات قبل إعادة التحميل ولم يُصرَّح به.\n'
      + 'إن كنت متأكداً: SANAD_ALLOW_LEGACY_WIPE=1'
      + (config.databaseUrl ? ' SANAD_BACKUP_CONFIRMED=<اسم-ملف-النسخة-الاحتياطية>' : '')
    );
  }
  if (config.databaseUrl && !process.env.SANAD_BACKUP_CONFIRMED) {
    throw new Error(
      'قاعدة بيانات خارجية مكتشَفة (staging/prod): يلزم نسخة احتياطية مؤكدة قبل الإفراغ.\n'
      + 'شغّل scripts/pg-backup.sh ثم مرّر SANAD_BACKUP_CONFIRMED=<اسم-ملف-النسخة>'
    );
  }
}

export async function migrateLegacy() {
  assertDestructiveAllowed();
  const SNAP = JSON.parse(readFileSync(pick('legacy-state'), 'utf8'));
  const USERS = JSON.parse(readFileSync(pick('legacy-users'), 'utf8')).users || [];
  const report = { source: {}, target: {}, financial: {}, notes: [] };
  // Child-first order (SQLite DELETE honors FKs; PG TRUNCATE … CASCADE doesn't care about order).
  // Any table referencing the business set must appear BEFORE its parent. session cascades on app_user.
  const dataTables = [
    'email_log', 'email_queue', 'report_schedule', 'recipient',
    'import_row', 'import_run', 'crm_activity', 'saved_view', 'document',
    'notification', 'ai_activity_log',
    'dependency', 'time_entry', 'timesheet_period', 'task',
    'approval_action', 'approval_request',
    'pricing_line', 'proposal',
    'collection', 'invoice_line', 'contract_payment',
    'expense', 'purchase_order',
    'membership', 'team',
    'workstream', 'milestone', 'risk', 'issue', 'decision', 'change_request', 'action_item', 'lesson_learned',
    'allocation', 'revenue_line', 'cost_line', 'deliverable',
    'invoice', 'contract',
    'opportunity_sector', 'opportunity', 'project',
    'service_package', 'service', 'supplier',
    'employee', 'org_unit', 'department', 'position',
    'login_history', 'app_user',
    'client', 'budget', 'stage', 'sector'];

  await tx(async () => {
    // Reset the migrated tables before reloading. On Postgres a plain DELETE fails when a prior
    // seed already created rows that reference these tables (e.g. a report recipient → app_user);
    // TRUNCATE … CASCADE clears the data tables AND everything referencing them in one FK-safe step.
    // RBAC tables are parents (referenced BY app_user), so CASCADE never touches them. SQLite has no
    // TRUNCATE, but with foreign_keys=ON a child-first DELETE of just these tables suffices there.
    if (config.databaseUrl) await exec(`TRUNCATE ${dataTables.join(', ')} RESTART IDENTITY CASCADE`);
    else for (const t of dataTables) await exec(`DELETE FROM ${t}`);

    // sectors — display order fixed by owner directive (Solutions → Consulting → Strategic → SAP)
    const SECTOR_ORDER = { SOLUTIONS: 1, CONSULTING: 2, STRATEGIC: 3, SAP: 4 };
    for (const s of SNAP.sectors || []) {
      await insert('sector', { id: s.id, name_ar: s.nameAr, name_en: s.nameEn || null, color: s.color || null,
        lead_user_id: null, target_sales_halalas: toHalalas(s.targetSalesSar), target_revenue_halalas: toHalalas(s.targetRevenueSar),
        target_margin_pct: s.targetGrossMarginPct || 0, active: s.active ? 1 : 0, is_placeholder: s.placeholder ? 1 : 0,
        sort_order: SECTOR_ORDER[s.id] ?? 9, created_at: nowIso() });
    }
    // stages
    for (const st of SNAP.stages || []) {
      await insert('stage', { id: st.id, name_ar: st.nameAr, name_en: st.nameEn || null, default_win_pct: st.defaultWinPct ?? null,
        sort_order: st.order || 0, color: st.color || null, is_won: st.id === 'WON' ? 1 : 0, is_lost: st.id === 'LOST' ? 1 : 0 });
    }
    // clients
    for (const c of SNAP.clients || []) {
      await insert('client', { id: c.id, code: c.code || null, name_ar: c.nameAr, name_en: c.nameEn || null,
        type: c.type || null, active: c.active === false ? 0 : 1, created_at: nowIso() });
    }
    // suppliers
    for (const s of SNAP.suppliers || []) {
      await insert('supplier', { id: s.id, name_ar: s.nameAr, name_en: s.nameEn || null, org: s.org || null,
        contact_person: s.contactPerson || null, phone: s.phone || null, email: s.email || null,
        status: s.status || 'active', notes: s.notes || null, created_at: nowIso() });
    }
    // services + packages
    for (const sv of SNAP.services || []) {
      await insert('service', { id: sv.id, name_ar: sv.nameAr, name_en: sv.nameEn || null, category: sv.category || null,
        sector_id: sv.sectorId || null, owner_user_id: null, status: sv.status || 'active', summary: sv.summary || null,
        created_at: nowIso() });
      for (const pk of sv.packages || []) {
        await insert('service_package', { id: pk.id || id('pk'), service_id: sv.id, name_ar: pk.nameAr || '',
          price_halalas: toHalalas(pk.priceSar), cost_halalas: toHalalas(pk.costSar),
          supplier_id: pk.supplierId && pk.supplierId !== 'sup_x' ? pk.supplierId : null, notes: pk.notes || null });
      }
    }
    // employees (+ derive departments & positions from free-text)
    const deptCache = {}, posCache = {};
    for (const t of SNAP.team || []) {
      let deptId = null;
      if (t.dept) {
        const key = (t.sectorId || '') + '|' + t.dept;
        if (!deptCache[key]) {
          deptId = id('dep'); deptCache[key] = deptId;
          if (t.sectorId && (await get('SELECT id FROM sector WHERE id = ?', [t.sectorId])))
            await insert('department', { id: deptId, sector_id: t.sectorId, name_ar: t.dept, created_at: nowIso() });
          else deptCache[key] = null;
        }
        deptId = deptCache[key];
      }
      let posId = null;
      if (t.role) {
        if (!posCache[t.role]) { posId = id('pos'); posCache[t.role] = posId; await insert('position', { id: posId, title_ar: t.role, created_at: nowIso() }); }
        posId = posCache[t.role];
      }
      await insert('employee', { id: t.id, user_id: null, name_ar: t.nameAr, name_en: t.nameEn || null,
        sector_id: t.sectorId || null, department_id: deptId, position_id: posId, job_title: t.role || null,
        dept_label: t.dept || null, salary_halalas: toHalalas(t.salarySar), employment_type: t.type || 'أساسي',
        seasonal: t.seasonal ? 1 : 0, status: t.status || 'نشط', active: t.active === false ? 0 : 1, created_at: nowIso() });
    }
    // users (auth) — passwords not in snapshot → login disabled until set (except demo seeding)
    for (const u of USERS) {
      const role = roleMap[u.role] || 'employee';
      await insert('app_user', { id: u.id, username: u.username || null, email: u.email || null, name_ar: u.nameAr || null,
        name_en: u.nameEn || null, role_id: role, employee_id: (await get('SELECT id FROM employee WHERE name_ar = ?', [u.nameAr]))?.id || null,
        sector_id: u.sectorId || u.sector || null, scope: scopeFor(role), password_hash: null,
        active: u.active === false ? 0 : 1, must_change_pw: 1, created_at: u.createdAt || nowIso() });
      for (const h of (u.loginHistory || []).slice(-10)) {
        await insert('login_history', { id: id('lh'), user_id: u.id, at: h.at, ip: h.ip || null, user_agent: h.userAgent || null, ok: h.ok ? 1 : 0 });
      }
    }
    // opportunities (+ sector M:N self link)
    for (const o of SNAP.opportunities || []) {
      const sid = o.sectorId && (await get('SELECT id FROM sector WHERE id=?', [o.sectorId])) ? o.sectorId : null;
      await insert('opportunity', { id: o.id, code: o.code || null, title_ar: o.titleAr, client_id: (await get('SELECT id FROM client WHERE id=?', [o.clientId]))?.id || null,
        sector_id: sid, owner_user_id: (await get('SELECT id FROM app_user WHERE id=?', [o.ownerId]))?.id || null,
        stage_id: o.stage || 'LEAD', win_pct: o.winPct ?? null, value_halalas: toHalalas(o.valueSar),
        priority: o.priority || null, year: o.year || null, source: o.source || null, next_action: o.nextAction || null,
        notes: o.notes || null, exclude_from_sales: o.excludeFromSales ? 1 : 0, stage_changed_at: o.stageChangedAt || null,
        created_at: o.createdAt || nowIso() });
      if (sid) await insert('opportunity_sector', { opportunity_id: o.id, sector_id: sid });
    }
    // projects (+ derive contract from contractValueSar)
    for (const p of SNAP.projects || []) {
      const sid = p.sectorId && (await get('SELECT id FROM sector WHERE id=?', [p.sectorId])) ? p.sectorId : null;
      await insert('project', { id: p.id, code: p.code || null, financial_code: p.financialCode || null, name_ar: p.nameAr,
        client_id: (await get('SELECT id FROM client WHERE id=?', [p.clientId]))?.id || null, sector_id: sid,
        owner_user_id: (await get('SELECT id FROM app_user WHERE id=?', [p.ownerId]))?.id || null, pm_name: p.pm || null,
        source_opp_id: (await get('SELECT id FROM opportunity WHERE id=?', [p.sourceOppId]))?.id || null,
        status: p.status || 'IN_PROGRESS', rag: 'GREEN', kind: p.kind || 'external', is_sector_project: p.sectorProject ? 1 : 0,
        budget_halalas: toHalalas(p.budgetSar), actual_spend_halalas: toHalalas(p.actualSpendSar),
        revenue_halalas: toHalalas(p.revenueSar), contract_value_halalas: toHalalas(p.contractValueSar),
        po_value_halalas: toHalalas(p.poValueSar), margin_pct: p.marginPct ?? null, progress_pct: p.progressPct || 0,
        start_date: p.startDate || null, end_date: p.endDate || null, created_at: p.createdAt || nowIso() });
      if (Number(p.contractValueSar) > 0) {
        await insert('contract', { id: id('con'), code: p.code || null, client_id: (await get('SELECT id FROM client WHERE id=?', [p.clientId]))?.id || null,
          project_id: p.id, sector_id: sid, value_halalas: toHalalas(p.contractValueSar), start_date: p.startDate || null,
          end_date: p.endDate || null, status: p.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE', created_at: nowIso() });
      }
    }
    // deliverables (+ derive invoice for INVOICED/PAID)
    for (const d of SNAP.deliverables || []) {
      if (!(await get('SELECT id FROM project WHERE id=?', [d.projectId]))) continue;
      if (await get('SELECT id FROM deliverable WHERE id=?', [d.id])) continue; // skip legacy dup ids
      await insert('deliverable', { id: d.id, project_id: d.projectId, name_ar: d.nameAr, amount_halalas: toHalalas(d.amountSar),
        month: d.month || null, year: d.year || null, phase: d.phase || null, phase_name_ar: d.phaseNameAr || null,
        status: d.status || 'PENDING', delivered_at: d.deliveredAt || null, notes: d.notes || null,
        sector_id: d.sectorId || null, created_at: nowIso() });
      if (['INVOICED', 'PAID'].includes(String(d.status).toUpperCase())) {
        await insert('invoice', { id: id('inv'), project_id: d.projectId, deliverable_id: d.id, sector_id: d.sectorId || null,
          amount_halalas: toHalalas(d.amountSar), issue_date: d.deliveredAt || null,
          status: String(d.status).toUpperCase() === 'PAID' ? 'PAID' : 'ISSUED', created_at: nowIso() });
      }
    }
    // revenue lines — NEVER drop a financial record; if project link is missing, keep it unlinked.
    for (const r of SNAP.revenueLines || []) {
      if (await get('SELECT id FROM revenue_line WHERE id=?', [r.id])) continue; // true dup id only
      const linkedProject = (await get('SELECT id FROM project WHERE id=?', [r.projectId]))?.id || null;
      if (r.projectId && !linkedProject) report.notes.push(`سطر إيراد ${r.id} (${Math.round(r.amountSar)} ريال) رُحِّل بلا ربط مشروع (المشروع ${r.projectId} غير موجود).`);
      await insert('revenue_line', { id: r.id, project_id: linkedProject,
        sector_id: r.sectorId || null, deliverable_id: (await get('SELECT id FROM deliverable WHERE id=?', [r.derivedFrom]))?.id || null,
        amount_halalas: toHalalas(r.amountSar), month: r.month || null, year: r.year || null, label: r.label || null,
        auto: r.auto ? 1 : 0, rule_id: r.ruleId || null, created_at: nowIso() });
    }
    // cost lines — keep even when project link is missing (preserve the cost record).
    for (const c of SNAP.costLines || []) {
      const linkedProject = (await get('SELECT id FROM project WHERE id=?', [c.projectId]))?.id || null;
      await insert('cost_line', { id: id('cl'), project_id: linkedProject, sector_id: c.sectorId || null, type: c.type || null,
        amount_halalas: toHalalas(c.amountSar), month: c.month || null, year: c.year || null, source: c.source || null, created_at: nowIso() });
    }
    // allocations
    for (const a of SNAP.allocations || []) {
      await insert('allocation', { id: id('al'), employee_id: (await get('SELECT id FROM employee WHERE id=?', [a.personId]))?.id || null,
        person_name_ar: a.personNameAr || null, project_id: (await get('SELECT id FROM project WHERE id=?', [a.projectId]))?.id || null,
        project_name: a.projectName || null, sector_id: a.sectorId || null, type: a.type || null,
        monthly_json: JSON.stringify(a.monthly || {}), month_start: a.monthStart || null, month_end: a.monthEnd || null,
        year: a.year || null, source: a.source || null, created_at: nowIso() });
    }
    // budget
    const b = SNAP.budget;
    if (b) await insert('budget', { id: id('bud'), fiscal_year: b.fy || 2026, sector_id: null,
      target_revenue_halalas: toHalalas(b.targetRevenueSar), target_sales_halalas: toHalalas(b.targetSalesSar),
      target_margin_pct: b.targetGrossMarginPct || 0, cost_assumptions_json: JSON.stringify(b.costAssumptions || {}),
      monthly_json: JSON.stringify(b.monthlyRevenue || []), created_at: nowIso() });
  });

  // reconciliation
  const cnt = async (t) => (await get(`SELECT COUNT(*) n FROM ${t}`)).n;
  report.source = { sectors: (SNAP.sectors || []).length, clients: (SNAP.clients || []).length, opportunities: (SNAP.opportunities || []).length,
    projects: (SNAP.projects || []).length, deliverables: (SNAP.deliverables || []).length, team: (SNAP.team || []).length, users: USERS.length };
  report.target = { sector: await cnt('sector'), client: await cnt('client'), opportunity: await cnt('opportunity'), project: await cnt('project'),
    deliverable: await cnt('deliverable'), employee: await cnt('employee'), app_user: await cnt('app_user'), department: await cnt('department'),
    contract: await cnt('contract'), invoice: await cnt('invoice'), revenue_line: await cnt('revenue_line') };
  const sumSrc = (arr, f) => (arr || []).reduce((a, x) => a + (Number(x[f]) || 0), 0);
  report.financial = {
    revenue_src_sar: Math.round(sumSrc(SNAP.revenueLines, 'amountSar')),
    revenue_tgt_sar: (await get('SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line')).v / 100,
    opp_value_src_sar: Math.round(sumSrc(SNAP.opportunities, 'valueSar')),
    opp_value_tgt_sar: (await get('SELECT COALESCE(SUM(value_halalas),0) v FROM opportunity')).v / 100,
  };
  report.notes.push('كلمات المرور غير موجودة في اللقطة → المستخدمون المُرحّلون بلا دخول حتى يُضبط (must_change_pw=1).');
  report.notes.push('اشتُقّت العقود من contractValueSar والفواتير من المخرجات INVOICED/PAID.');
  writeFileSync(resolve(ROOT, 'data/migration-reconciliation.json'), JSON.stringify(report, null, 2));
  console.log('✓ legacy migration complete');
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { close } = await import('../src/core/db/index.js');
  migrateLegacy().then(() => close()).catch((e) => { console.error(e); process.exit(1); });
}
