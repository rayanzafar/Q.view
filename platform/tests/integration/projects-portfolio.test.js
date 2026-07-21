// Portfolio page services (Lane B v2.1): listProjects year filter (duration overlap OR revenue
// lines in that year) + nextMilestones grouped query (earliest PENDING milestone per project,
// dated first, soft-deletes ignored, one query for the whole portfolio). Isolated temp DB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-projects-portfolio.db');
process.env.SANAD_DB = TEST_DB;

let db, svc;
const now = () => new Date().toISOString();
const lead = { id: 'u_lead', username: 'lead', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector', projectIds: new Set(), teamIds: new Set() };

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  svc = await import('../../src/modules/pmo/projects.js');
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع الاختبار', active: 1, created_at: now() });
  // P1: 2024→2025 · P2: 2025→مفتوح النهاية · P3: 2026 فقط · P4: بلا تواريخ لكن له إيراد 2024
  await db.insert('project', { id: 'P1', name_ar: 'مشروع ٢٠٢٤', sector_id: 'S1', status: 'IN_PROGRESS', start_date: '2024-03-01', end_date: '2025-06-30', created_at: now() });
  await db.insert('project', { id: 'P2', name_ar: 'مشروع مفتوح', sector_id: 'S1', status: 'IN_PROGRESS', start_date: '2025-02-01', end_date: null, created_at: now() });
  await db.insert('project', { id: 'P3', name_ar: 'مشروع ٢٠٢٦', sector_id: 'S1', status: 'IN_PROGRESS', start_date: '2026-01-15', end_date: '2026-12-31', created_at: now() });
  await db.insert('project', { id: 'P4', name_ar: 'مشروع بلا تواريخ', sector_id: 'S1', status: 'COMPLETED', start_date: null, end_date: null, created_at: now() });
  await db.insert('revenue_line', { id: 'rl1', project_id: 'P4', sector_id: 'S1', amount_halalas: 500000, month: 5, year: 2024, created_at: now() });
  // deleted project must never appear even when its dates match
  await db.insert('project', { id: 'P9', name_ar: 'محذوف', sector_id: 'S1', status: 'IN_PROGRESS', start_date: '2024-01-01', end_date: '2026-01-01', created_at: now(), deleted_at: now() });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

const ids = (rows) => rows.map((p) => p.id).sort();

test('listProjects without year keeps the previous behavior (all non-deleted, scope-filtered)', async () => {
  assert.deepEqual(ids(await svc.listProjects(lead)), ['P1', 'P2', 'P3', 'P4']);
});

test('listProjects year filter: duration overlap OR revenue lines in that year', async () => {
  assert.deepEqual(ids(await svc.listProjects(lead, { year: 2024 })), ['P1', 'P4'], '2024: overlap P1 + revenue P4');
  assert.deepEqual(ids(await svc.listProjects(lead, { year: 2025 })), ['P1', 'P2'], '2025: P1 ends mid-year, P2 starts');
  assert.deepEqual(ids(await svc.listProjects(lead, { year: 2026 })), ['P2', 'P3'], '2026: open-ended P2 + P3');
  assert.deepEqual(ids(await svc.listProjects(lead, { year: 2023 })), [], 'year before everything: empty');
  assert.deepEqual(ids(await svc.listProjects(lead, { year: 'ليس رقمًا' })), ['P1', 'P2', 'P3', 'P4'], 'garbage year is ignored, not a crash');
});

test('listProjects status filter: exact match, composes with year, empty is safe', async () => {
  assert.deepEqual(ids(await svc.listProjects(lead, { status: 'IN_PROGRESS' })), ['P1', 'P2', 'P3'], 'only in-progress (deleted P9 excluded)');
  assert.deepEqual(ids(await svc.listProjects(lead, { status: 'COMPLETED' })), ['P4'], 'only completed');
  assert.deepEqual(ids(await svc.listProjects(lead, { status: 'ON_HOLD' })), [], 'none on hold → empty result, not a crash');
  assert.deepEqual(ids(await svc.listProjects(lead, { status: 'IN_PROGRESS', year: 2024 })), ['P1'], 'status + year compose (completed P4 excluded despite 2024 revenue)');
});

test('nextMilestones: earliest PENDING per project in ONE grouped call; MET/MISSED and deleted ignored', async () => {
  await db.insert('milestone', { id: 'm_met', project_id: 'P1', name_ar: 'معلم محقق مبكر', due_date: '2026-01-10', status: 'MET', created_at: now() });
  await db.insert('milestone', { id: 'm_near', project_id: 'P1', name_ar: 'التقرير النصفي', due_date: '2026-08-01', status: 'PENDING', created_at: now() });
  await db.insert('milestone', { id: 'm_far', project_id: 'P1', name_ar: 'التقرير الختامي', due_date: '2026-11-01', status: 'PENDING', created_at: now() });
  await db.insert('milestone', { id: 'm_undated', project_id: 'P2', name_ar: 'ورشة الإطلاق', due_date: null, status: 'PENDING', created_at: now() });
  await db.insert('milestone', { id: 'm_deleted', project_id: 'P3', name_ar: 'معلم محذوف', due_date: '2026-07-01', status: 'PENDING', created_at: now(), deleted_at: now() });

  const out = await svc.nextMilestones(['P1', 'P2', 'P3', 'P4']);
  const by = Object.fromEntries(out.map((m) => [m.project_id, m]));
  assert.equal(by.P1.title, 'التقرير النصفي', 'earliest PENDING wins (MET ignored, later PENDING ignored)');
  assert.equal(by.P1.due_date, '2026-08-01');
  assert.equal(by.P2.title, 'ورشة الإطلاق', 'undated PENDING surfaces as a last resort');
  assert.equal(by.P2.due_date, null, 'undated milestone reports null due_date, not a fake date');
  assert.equal(by.P3, undefined, 'soft-deleted milestone leaves the project without a next step');
  assert.equal(by.P4, undefined, 'no milestones → absent from the result');
  assert.equal(out.length, 2, 'exactly one row per project that has a next step');
});

test('nextMilestones: soft-deleting the nearest milestone promotes the next one; empty input is safe', async () => {
  await db.update('milestone', 'm_near', { deleted_at: now() });
  const out = await svc.nextMilestones(['P1']);
  assert.equal(out[0].title, 'التقرير الختامي');
  assert.equal(out[0].due_date, '2026-11-01');
  assert.deepEqual(await svc.nextMilestones([]), [], 'no ids → no query, empty result');
});
