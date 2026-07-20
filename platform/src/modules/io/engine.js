// محرك الاستيراد/التصدير المشترك — يملك القراءة والمطابقة والمعاينة والتنفيذ والتراجع ودفاتر
// import_run/import_row؛ المحوّلات تصف الأنواع فقط وتكتب حصراً عبر خدمات المنصة.
// المسار: upload (قراءة الملف وتخزين لقطة) → autoMap (مطابقة الترويسات) → preview (تحقّق + فروقات
// بلا أي كتابة) → apply (معاملة واحدة، صف-بصف، مع لقطات قبل/بعد للتراجع) → undo (7 أيام).
import { createHash } from 'node:crypto';
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { can, canSeeSensitive } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { HttpError, badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { parseWorkbook, buildExport } from './xlsx.js';
import { parseCell, makeLookup, normalizeText } from './parse.js';
import clients from './adapters/clients.js';
import employees from './adapters/employees.js';
import opportunities from './adapters/opportunities.js';
import projects from './adapters/projects.js';
import staffing from './adapters/staffing.js';
import revenues from './adapters/revenues.js';

export const ADAPTERS = { clients, employees, opportunities, projects, staffing, revenues };
const MODES = ['add', 'upsert', 'replace'];
const MAX_ROWS = 5000;
const UNDO_DAYS = 7;
const PREVIEW_ROWS = 500;

const sha256 = (x) => createHash('sha256').update(x).digest('hex');

export function getAdapter(type) {
  const a = ADAPTERS[type];
  if (!a) throw notFound('نوع البيانات غير معروف');
  return a;
}
const canExport = (user, a) => can(user, 'read', a.resource);
const canImport = (user, a) => can(user, 'create', a.resource) || can(user, 'update', a.resource);

// الأعمدة الظاهرة للمستخدم: الأعمدة الحسّاسة (الراتب…) تُحذف كلياً لغير المخوَّلين —
// لا تظهر في القالب ولا التصدير ولا المطابقة ولا التحقق.
export function visibleColumns(user, adapter) {
  return adapter.columns.filter((c) => !c.sensitive || canSeeSensitive(user, c.sensitive));
}

// ── الأنواع المتاحة ──
export function listTypes(user) {
  return Object.values(ADAPTERS)
    .map((a) => ({
      type: a.type, labelAr: a.labelAr,
      canExport: canExport(user, a), canImport: canImport(user, a),
      columns: visibleColumns(user, a).map((c) => ({ key: c.key, labelAr: c.labelAr, required: !!c.required })),
    }))
    .filter((t) => t.canExport || t.canImport);
}

// ── التصدير (ملف كامل أو قالب فارغ بصف مثال واحد) ──
export async function exportType(ctx, type, query = {}) {
  const user = ctx.user;
  const adapter = getAdapter(type);
  if (!canExport(user, adapter)) throw forbidden('تصدير هذا النوع يتطلب صلاحية قراءته');
  const columns = visibleColumns(user, adapter);
  const format = query.format === 'csv' ? 'csv' : 'xlsx';
  const template = query.template === '1' || query.template === 1 || query.template === true;
  const rows = template ? [adapter.exampleRow || {}] : await adapter.fetchRows(user, query);
  const out = buildExport({ columns, rows, format, sheetName: adapter.labelAr });
  await audit(ctx, { action: 'export', resource: adapter.resource, detail: { type, format, template, rows: rows.length } });
  const day = nowIso().slice(0, 10);
  return { ...out, fileName: `${template ? 'قالب-' : ''}${adapter.labelAr}-${day}.${out.ext}` };
}

// ── مطابقة الترويسات تلقائياً: labelAr المطابق > الاسم البديل > التطبيع > الاحتواء ──
export function autoMap(headers, columns) {
  const normHeaders = headers.map((h) => normalizeText(h));
  const used = new Set();
  const mapping = {};
  const claim = (col, idx) => { mapping[col.key] = idx; used.add(idx); };
  const passes = [
    (col, h, i) => headers[i].trim() === col.labelAr,
    (col, h) => (col.aliases || []).some((a) => normalizeText(a) === h),
    (col, h) => h && h === normalizeText(col.labelAr),
    (col, h) => {
      const l = normalizeText(col.labelAr);
      return h.length > 1 && l.length > 1 && (h.includes(l) || l.includes(h));
    },
  ];
  for (const pass of passes) {
    for (const col of columns) {
      if (mapping[col.key] != null) continue;
      const idx = normHeaders.findIndex((h, i) => !used.has(i) && pass(col, h, i));
      if (idx !== -1) claim(col, idx);
    }
  }
  return mapping;
}

// ── مصادر lookup (تُحمَّل مرة لكل عملية، حسب حاجة أعمدة المحوّل فقط) ──
const LOOKUP_SOURCES = {
  sector: { label: 'القطاعات', codeKeys: ['id'], nameKeys: ['name_ar', 'name_en'], sql: 'SELECT id, name_ar, name_en FROM sector WHERE deleted_at IS NULL' },
  stage: { label: 'المراحل', codeKeys: ['id'], nameKeys: ['name_ar', 'name_en'], sql: 'SELECT id, name_ar, name_en FROM stage' },
  user: { label: 'المستخدمين', codeKeys: ['username'], nameKeys: ['name_ar', 'username'], sql: 'SELECT id, username, name_ar FROM app_user WHERE deleted_at IS NULL AND active = 1' },
  client: { label: 'العملاء', codeKeys: ['code'], nameKeys: ['name_ar', 'name_en'], sql: 'SELECT id, code, name_ar, name_en FROM client WHERE deleted_at IS NULL' },
  employee: { label: 'الموظفين', codeKeys: [], nameKeys: ['name_ar', 'name_en'], sql: 'SELECT id, name_ar, name_en FROM employee WHERE deleted_at IS NULL' },
  project: { label: 'المشاريع', codeKeys: ['code'], nameKeys: ['name_ar'], sql: 'SELECT id, code, name_ar, sector_id FROM project WHERE deleted_at IS NULL' },
};
async function buildLookups(columns) {
  const names = [...new Set(columns.filter((c) => c.parse === 'lookup').map((c) => c.lookup))];
  const lookups = {};
  for (const n of names) {
    const src = LOOKUP_SOURCES[n];
    if (!src) continue;
    lookups[n] = makeLookup(await all(src.sql), src);
  }
  return lookups;
}

// ── الرفع: قراءة الملف → لقطة معيارية في import_run ──
export async function upload(ctx, type, buffer, fileName = '') {
  const user = ctx.user;
  const adapter = getAdapter(type);
  if (!canImport(user, adapter)) throw forbidden('استيراد هذا النوع يتطلب صلاحية الإضافة أو التعديل عليه');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw badRequest('لم يصل أي ملف — أرفق ملف Excel أو CSV وأعد المحاولة');
  let parsed;
  try { parsed = parseWorkbook(buffer, fileName); }
  catch { throw badRequest('تعذّرت قراءة الملف — تأكد أنه ملف Excel أو CSV سليم'); }
  const { headers, rows } = parsed;
  if (!headers.length || !rows.length) throw badRequest('الملف فارغ — الصف الأول ترويسات الأعمدة ثم صف واحد على الأقل من البيانات');
  if (rows.length > MAX_ROWS) throw badRequest(`الملف كبير — الحد الأقصى ${MAX_ROWS} صف في العملية الواحدة. قسّم الملف وأعد المحاولة`);
  const columns = visibleColumns(user, adapter);
  const runId = id('imp');
  await insert('import_run', {
    id: runId, type, mode: 'upsert', status: 'uploaded',
    file_name: fileName || null, file_hash: sha256(buffer),
    payload_json: JSON.stringify({ headers, rows }),
    by_user_id: user.id, sector_id: user.sector_id || null, created_at: nowIso(),
  });
  await audit(ctx, { action: 'import.upload', resource: 'import_run', resourceId: runId, detail: { type, rows: rows.length } });
  return {
    runId, headers, rowCount: rows.length, sample: rows.slice(0, 5),
    autoMapping: autoMap(headers, columns),
    columns: columns.map((c) => ({ key: c.key, labelAr: c.labelAr, required: !!c.required })),
  };
}

// تنقية المطابقة القادمة من الواجهة: مفاتيح معروفة وفهارس ترويسات صحيحة فقط.
function sanitizeMapping(mapping, columns, headerCount) {
  const out = {};
  const known = new Set(columns.map((c) => c.key));
  for (const [k, v] of Object.entries(mapping || {})) {
    const idx = Number(v);
    if (known.has(k) && Number.isInteger(idx) && idx >= 0 && idx < headerCount) out[k] = idx;
  }
  return out;
}

const labelOfCol = (columns, key) => columns.find((c) => c.key === key)?.labelAr || key;

/**
 * الخطة الموحّدة (تُستخدم في المعاينة والتنفيذ معاً): تحقّق مطبوع لكل خلية، كشف التكرار داخل
 * الملف، قرار إضافة/تحديث/تجاهل عبر المحوّل، وفحص صلاحية النطاق لكل صف — تجاوز النطاق خطأ صف
 * معلن لا تخطٍّ صامت.
 */
async function buildPlan(ctx, adapter, payload, mapping, mode, keyField) {
  const user = ctx.user;
  const columns = visibleColumns(user, adapter);
  const missing = columns.filter((c) => c.required && mapping[c.key] == null).map((c) => c.labelAr);
  if (missing.length) throw badRequest(`أعمدة مطلوبة غير مطابقة: ${missing.join('، ')} — اخترها من قائمة المطابقة`);
  const lookups = await buildLookups(columns);
  const opts = { keyField: keyField || null, cache: {} };
  const seenKeys = new Map();
  const planned = [];
  const counts = { total: payload.rows.length, create: 0, update: 0, skip: 0, error: 0 };

  for (let i = 0; i < payload.rows.length; i++) {
    const raw = payload.rows[i];
    const rowNo = i + 2; // الصف 1 في الملف هو الترويسات
    const mapped = {};
    const cellErrors = [];
    for (const col of columns) {
      const idx = mapping[col.key];
      const rawVal = idx == null ? '' : raw[idx];
      try {
        const v = parseCell(col, rawVal, lookups);
        if (v != null) mapped[col.key] = v;
      } catch (e) {
        cellErrors.push(`${col.labelAr} — ${e.message}`);
      }
    }
    if (cellErrors.length) {
      counts.error++;
      planned.push({ rowNo, action: 'error', error: `الصف ${rowNo}: ${cellErrors.join('؛ ')}`, label: '' });
      continue;
    }
    adapter.normalizeRow?.(ctx, mapped);

    // تكرار داخل الملف: أول مجموعة مفاتيح مكتملة القيم تُحدد هوية الصف
    const keySet = (adapter.keySets || []).find((ks) => ks.every((k) => mapped[k] != null));
    if (keySet) {
      const dupKey = keySet.map((k) => normalizeText(String(mapped[k]))).join('|');
      if (seenKeys.has(dupKey)) {
        counts.error++;
        planned.push({ rowNo, action: 'error', label: adapter.rowLabel?.(mapped, lookups) || '', error: `الصف ${rowNo}: سجل مكرر داخل الملف — نفس بيانات الصف ${seenKeys.get(dupKey)}. احذف أحدهما` });
        continue;
      }
      seenKeys.set(dupKey, rowNo);
    }

    let resolved;
    try {
      resolved = await adapter.resolveRow(ctx, mapped, opts);
    } catch (e) {
      counts.error++;
      planned.push({ rowNo, action: 'error', label: '', error: `الصف ${rowNo}: ${e.message}` });
      continue;
    }
    if (resolved.action === 'skip') {
      counts.skip++;
      planned.push({ rowNo, action: 'skip', mapped, resolved, label: adapter.rowLabel?.(mapped, lookups) || '', reason: 'مطابق تماماً — لا تغيير' });
      continue;
    }
    if (mode === 'add' && resolved.action !== 'create') {
      counts.skip++;
      planned.push({ rowNo, action: 'skip', mapped, resolved, label: adapter.rowLabel?.(mapped, lookups) || '', reason: 'موجود مسبقاً — الوضع «إضافة الجديد فقط»' });
      continue;
    }
    // صلاحية النطاق لكل صف
    const target = adapter.rowTarget ? adapter.rowTarget(mapped, resolved, user) : {};
    const action = resolved.action === 'create' ? 'create' : 'update';
    if (!can(user, action, adapter.resource, target)) {
      counts.error++;
      planned.push({ rowNo, action: 'error', label: adapter.rowLabel?.(mapped, lookups) || '', error: `الصف ${rowNo}: خارج نطاق صلاحيتك — هذا السجل يتبع قطاعاً لا تملك ${action === 'create' ? 'الإضافة' : 'التعديل'} فيه` });
      continue;
    }
    counts[resolved.action]++;
    planned.push({
      rowNo, action: resolved.action, mapped, resolved,
      label: adapter.rowLabel?.(mapped, lookups) || '',
      changes: (resolved.changes || []).map((k) => labelOfCol(columns, k)),
    });
  }
  return { planned, counts };
}

// جلب عملية يملكها المستخدم (أو أي عملية لمدير النظام).
async function ownRun(user, runId) {
  const run = await get('SELECT * FROM import_run WHERE id = ?', [runId]);
  if (!run) throw notFound('العملية غير موجودة');
  if (run.by_user_id !== user.id && user.role_id !== 'admin') throw forbidden('هذه العملية تخص مستخدماً آخر');
  return run;
}

const confirmTokenOf = (run) => sha256(`${run.payload_json}|${run.mapping_json}|${run.mode}`);

// ── المعاينة: تحقّق + فروقات بلا أي كتابة على بيانات الأعمال ──
export async function preview(ctx, type, { runId, mapping, mode = 'upsert', keyField } = {}) {
  const user = ctx.user;
  const adapter = getAdapter(type);
  if (!canImport(user, adapter)) throw forbidden('استيراد هذا النوع يتطلب صلاحية الإضافة أو التعديل عليه');
  const run = await ownRun(user, runId);
  if (run.type !== type) throw badRequest('العملية لا تخص هذا النوع من البيانات');
  if (!['uploaded', 'previewed'].includes(run.status)) throw badRequest('هذه العملية نُفّذت أو أُغلقت — ارفع الملف من جديد');
  if (!MODES.includes(mode)) throw badRequest('وضع الاستيراد غير معروف — اختر: إضافة، إضافة وتحديث، أو استبدال');
  if (mode === 'replace' && user.role_id !== 'admin') throw forbidden('وضع «استبدال كامل» متاح لمدير النظام فقط');
  const payload = JSON.parse(run.payload_json);
  const cleanMapping = sanitizeMapping(mapping, visibleColumns(user, adapter), payload.headers.length);
  const { planned, counts } = await buildPlan(ctx, adapter, payload, cleanMapping, mode, keyField);
  const mappingJson = JSON.stringify(cleanMapping);
  await update('import_run', run.id, {
    mapping_json: mappingJson, mode, status: 'previewed', counts_json: JSON.stringify(counts),
  });
  return {
    runId: run.id, mode, counts,
    rows: planned.slice(0, PREVIEW_ROWS).map((p) => ({
      row: p.rowNo, action: p.action, label: p.label,
      detail: p.error || p.reason || (p.changes?.length ? `سيتغير: ${p.changes.join('، ')}` : ''),
    })),
    errors: planned.filter((p) => p.action === 'error').map((p) => ({ row: p.rowNo, message: p.error })),
    confirmToken: confirmTokenOf({ payload_json: run.payload_json, mapping_json: mappingJson, mode }),
  };
}

// ── التنفيذ: معاملة واحدة، صف-بصف عبر المحوّل، مع لقطات قبل/بعد وتفعيل مهلة التراجع ──
export async function apply(ctx, type, { runId, confirmToken } = {}) {
  const user = ctx.user;
  const adapter = getAdapter(type);
  if (!canImport(user, adapter)) throw forbidden('استيراد هذا النوع يتطلب صلاحية الإضافة أو التعديل عليه');
  const run = await ownRun(user, runId);
  if (run.type !== type) throw badRequest('العملية لا تخص هذا النوع من البيانات');
  if (run.status === 'applied') throw badRequest('هذه العملية نُفّذت مسبقاً — لا يمكن تنفيذها مرتين');
  if (run.status !== 'previewed') throw badRequest('نفّذ المعاينة أولاً ثم أكّد الاستيراد');
  if (confirmToken !== confirmTokenOf(run)) throw badRequest('رمز التأكيد لا يطابق آخر معاينة — أعد المعاينة ثم أكّد من جديد');
  if (run.mode === 'replace' && user.role_id !== 'admin') throw forbidden('وضع «استبدال كامل» متاح لمدير النظام فقط');

  // وضع الاستبدال: نسخة تصدير تلقائية قبل التنفيذ تُخزَّن داخل العملية (شبكة أمان إضافية فوق التراجع)
  const preExport = run.mode === 'replace' ? await adapter.fetchRows(user, {}) : null;
  const payload = JSON.parse(run.payload_json);
  const mapping = JSON.parse(run.mapping_json || '{}');
  const counts = { total: payload.rows.length, create: 0, update: 0, skip: 0, error: 0 };
  const now = nowIso();
  const undoExpires = new Date(Date.now() + UNDO_DAYS * 86400000).toISOString();

  try {
    await tx(async () => {
      const { planned } = await buildPlan(ctx, adapter, payload, mapping, run.mode, null);
      for (const p of planned) {
        if (p.action === 'error') {
          counts.error++;
          await insert('import_row', { id: id('row'), run_id: run.id, row_no: p.rowNo, action: 'error', error: p.error });
          continue;
        }
        if (p.action === 'skip') {
          counts.skip++;
          await insert('import_row', {
            id: id('row'), run_id: run.id, row_no: p.rowNo, action: 'skip',
            resource: adapter.resource, resource_id: p.resolved?.existing?.id || null,
          });
          continue;
        }
        try {
          const r = await adapter.applyRow(ctx, p.mapped, p.resolved);
          counts[p.action]++;
          await insert('import_row', {
            id: id('row'), run_id: run.id, row_no: p.rowNo, action: p.action,
            resource: r.resource, resource_id: r.resourceId,
            before_json: r.before ? JSON.stringify(r.before) : null,
            after_json: r.after ? JSON.stringify(r.after) : null,
          });
        } catch (e) {
          // خطأ عمل معروف (صلاحية/تحقّق) → خطأ صف مسجَّل؛ أي عطل غير متوقع يُلغي العملية كاملة
          if (!(e instanceof HttpError)) throw e;
          counts.error++;
          await insert('import_row', { id: id('row'), run_id: run.id, row_no: p.rowNo, action: 'error', error: `الصف ${p.rowNo}: ${e.message}` });
        }
      }
      await update('import_run', run.id, {
        status: 'applied', applied_at: now, undo_expires_at: undoExpires,
        counts_json: JSON.stringify(preExport ? { ...counts, preExport } : counts),
      });
      await audit(ctx, { action: 'import.apply', resource: 'import_run', resourceId: run.id, sectorId: run.sector_id, detail: { type, mode: run.mode, ...counts } });
    });
  } catch (e) {
    await update('import_run', run.id, { status: 'failed', error: String(e.message || e).slice(0, 500) });
    if (e instanceof HttpError) throw e;
    throw badRequest('تعذّر إتمام الاستيراد — لم يُحفظ أي صف. راجع الملف وأعد المحاولة');
  }
  return { applied: true, runId: run.id, created: counts.create, updated: counts.update, skipped: counts.skip, errors: counts.error, undoExpiresAt: undoExpires };
}

// ── التراجع: يعكس صفوف العملية (الأحدث أولاً) ما دامت المهلة سارية ولم تلمسها عملية أحدث ──
export async function undo(ctx, runId) {
  const user = ctx.user;
  const run = await ownRun(user, runId);
  const adapter = getAdapter(run.type);
  if (!canImport(user, adapter)) throw forbidden('التراجع يتطلب نفس صلاحية الاستيراد');
  if (run.status !== 'applied') throw badRequest('لا يوجد ما يُتراجع عنه — العملية غير منفَّذة');
  if (!run.undo_expires_at || run.undo_expires_at < nowIso()) throw badRequest(`انتهت مهلة التراجع (${UNDO_DAYS} أيام من التنفيذ)`);
  const later = await get(`
    SELECT r2.id FROM import_row ir
    JOIN import_row ir2 ON ir2.resource = ir.resource AND ir2.resource_id = ir.resource_id AND ir2.run_id <> ir.run_id
    JOIN import_run r2 ON r2.id = ir2.run_id
    WHERE ir.run_id = ? AND ir.resource_id IS NOT NULL
      AND ir.action IN ('create','update') AND ir2.action IN ('create','update')
      AND r2.status = 'applied' AND r2.applied_at >= ? AND r2.id <> ?
    LIMIT 1`, [run.id, run.applied_at, run.id]);
  if (later) throw badRequest('لا يمكن التراجع — عملية استيراد أحدث عدّلت نفس السجلات. تراجَع عنها أولاً');

  let restored = 0;
  await tx(async () => {
    const rows = await all("SELECT * FROM import_row WHERE run_id = ? AND action IN ('create','update') ORDER BY row_no DESC", [run.id]);
    for (const r of rows) {
      await adapter.undoRow(ctx, {
        action: r.action, resource: r.resource, resource_id: r.resource_id,
        before: r.before_json ? JSON.parse(r.before_json) : null,
        after: r.after_json ? JSON.parse(r.after_json) : null,
      });
      restored++;
    }
    await update('import_run', run.id, { status: 'undone', undone_at: nowIso() });
    await audit(ctx, { action: 'import.undo', resource: 'import_run', resourceId: run.id, sectorId: run.sector_id, detail: { type: run.type, restored } });
  });
  return { undone: true, runId: run.id, restored };
}

// ── سجل العمليات ──
const runView = (r, users = {}) => {
  let counts = null;
  try { const c = JSON.parse(r.counts_json || 'null'); if (c) { delete c.preExport; counts = c; } } catch { counts = null; }
  return {
    id: r.id, type: r.type, typeLabel: ADAPTERS[r.type]?.labelAr || r.type, mode: r.mode, status: r.status,
    fileName: r.file_name, counts, by: users[r.by_user_id] || null, createdAt: r.created_at,
    appliedAt: r.applied_at, undoneAt: r.undone_at, undoExpiresAt: r.undo_expires_at, error: r.error,
    canUndo: r.status === 'applied' && !!r.undo_expires_at && r.undo_expires_at > nowIso(),
  };
};

export async function listRuns(user, { type, limit = 100 } = {}) {
  const where = ["type <> 'legacy'"];
  const params = [];
  if (user.role_id !== 'admin') { where.push('by_user_id = ?'); params.push(user.id); }
  if (type) { where.push('type = ?'); params.push(type); }
  const rows = await all(`SELECT * FROM import_run WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${Math.min(500, Number(limit) || 100)}`, params);
  const users = Object.fromEntries((await all('SELECT id, name_ar, username FROM app_user')).map((u) => [u.id, u.name_ar || u.username]));
  return rows.map((r) => runView(r, users));
}

export async function getRun(user, runId) {
  const run = await ownRun(user, runId);
  const users = Object.fromEntries((await all('SELECT id, name_ar, username FROM app_user')).map((u) => [u.id, u.name_ar || u.username]));
  const rows = await all('SELECT id, row_no, action, resource, resource_id, error FROM import_row WHERE run_id = ? ORDER BY row_no LIMIT 2000', [runId]);
  return { ...runView(run, users), rows };
}
