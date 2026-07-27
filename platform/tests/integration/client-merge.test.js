// هوية الجهة: كشف التكرار، ودمجه، وفكّه.
//
// العطل الحقيقي من البيئة الحيّة: الجهة الواحدة مسجَّلة مرتين، وانقسامها **يتبع قطاع EVC
// المنفِّذ** — «وزارة الاقتصاد والتخطيط» على قطاع الحلول و«… - الديوان العام» على قطاع
// الاستشارات، وهما وزارة واحدة. وأثره ليس تجميلياً: تركّز العميل وخط فرصه وأعمار ديونه وعمر
// علاقته تُقسَم نصفين، فيقرأ المالك جهتين متوسطتين مكان جهة كبيرة واحدة.
//
// وحارس الاسم القائم لا يمسكه: يقارن الاسم **المطابق** بعد التطبيع، و«وزارة س» ≠ «وزارة س -
// الديوان العام». فهنا يُفحص الكشف بالاحتواء، والدمج الذرّي، وحدود الصلاحية، وما لا يُدمج:
// «أمانة منطقة الرياض» و«أمانة منطقة الجوف» يتقاطعان بقوة وهما جهتان مختلفتان قطعاً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-client-merge.db');
process.env.SANAD_DB = TEST_DB;

let db, C, ids;
const T = '2026-01-01T00:00:00Z';
const U = (id, role, sector, scope) => ({ id, username: id, name_ar: 'مستخدم ' + id, role_id: role,
  sector_id: sector, scope, projectIds: new Set(), teamIds: new Set(), employee_id: null, department_id: null });
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });

const admin = U('u_admin', 'admin', null, 'company');
const bd = U('u_bd', 'bd_manager', 'SOL', 'own');

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  C = await import('../../src/modules/clients/clients.js');

  for (const [sid, n] of [['SOL', 'قطاع الحلول'], ['CON', 'قطاع الاستشارات']])
    await db.insert('sector', { id: sid, name_ar: n, active: 1, created_at: T });
  for (const [sid, n, w, l] of [['LEAD', 'رصد', 10, 0], ['WON', 'فوز', 100, 1]])
    await db.insert('stage', { id: sid, name_ar: n, default_win_pct: w, sort_order: 1, is_won: l, is_lost: 0 });

  ids = {};
  const mk = async (key, name, code = null) => {
    ids[key] = 'c_' + key;
    await db.insert('client', { id: ids[key], name_ar: name, code, type: 'حكومي', active: 1, created_at: T });
  };
  // الحالة الحيّة بالضبط: نفس الوزارة، صفّان، كلٌّ على قطاع مختلف.
  await mk('moe', 'وزارة الاقتصاد والتخطيط', 'MOE');
  await mk('moeDiwan', 'وزارة الاقتصاد والتخطيط - الديوان العام');
  // وحالتان مختلفتان قطعاً رغم تقاطع الكلمات — الحارس يجب ألا يبتلعهما.
  await mk('amanaRiyadh', 'أمانة منطقة الرياض');
  await mk('amanaJouf', 'أمانة منطقة الجوف');

  // عملٌ حقيقي على الصفّين: فرصة ومشروع وعقد وفاتورة ونشاط وجهة اتصال.
  await db.insert('opportunity', { id: 'o_sol', title_ar: 'فرصة الحلول', client_id: ids.moe,
    sector_id: 'SOL', stage_id: 'LEAD', value_halalas: 100000000, year: 2026, created_at: T });
  await db.insert('project', { id: 'p_con', name_ar: 'مشروع الاستشارات', client_id: ids.moeDiwan,
    sector_id: 'CON', status: 'ACTIVE', contract_value_halalas: 515000000, created_at: T });
  await db.insert('contract', { id: 't_con', code: 'CT-1', client_id: ids.moeDiwan, project_id: 'p_con',
    sector_id: 'CON', value_halalas: 515000000, status: 'ACTIVE', created_at: T });
  await db.insert('invoice', { id: 'i_con', code: 'INV-1', client_id: ids.moeDiwan, contract_id: 't_con',
    project_id: 'p_con', sector_id: 'CON', amount_halalas: 118382900, status: 'ISSUED',
    issue_date: '2026-04-24', created_at: T });
  await db.insert('crm_activity', { id: 'a_con', client_id: ids.moeDiwan, kind: 'meeting',
    at: '2026-03-01', title: 'اجتماع', source: 'app', created_at: T });
  await db.insert('contact', { id: 'ct_con', client_id: ids.moeDiwan, name: 'جهة اتصال', created_at: T });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

// ── الكشف ───────────────────────────────────────────────────────────────────
test('التشابه: اللاحقة التي تميّز الجهة عن نفسها تُكشف بالاحتواء', () => {
  const sim = C.similarityOf('وزارة الاقتصاد والتخطيط', 'وزارة الاقتصاد والتخطيط - الديوان العام');
  assert.ok(sim, 'لم يُكشف — وهذا هو التكرار الذي عاش في البيانات');
  assert.equal(sim.kind, 'contained', 'الاحتواء أقوى دليل: اسمٌ هو الآخر وزيادة');
});

test('التشابه: جهتان إقليميتان مختلفتان لا تُصنَّفان احتواءً', () => {
  const sim = C.similarityOf('أمانة منطقة الرياض', 'أمانة منطقة الجوف');
  assert.notEqual(sim?.kind, 'contained',
    'الرياض والجوف أمانتان مستقلتان — لو صُنِّفتا احتواءً لأمكن دمج جهتين حقيقيتين');
});

test('التشابه لا يقع على كلمات لا تميّز — «الهيئة العامة» وحدها ليست تطابقاً', () => {
  assert.equal(C.similarityOf('الهيئة العامة للنقل', 'الهيئة العامة للإحصاء'), null,
    'الكلمات الشائعة لا تصنع جهةً واحدة');
});

test('قائمة التكرار المحتمل تُرتِّب الاحتواء أولاً وتحترم النطاق', async () => {
  const pairs = await C.likelyDuplicateClients(admin);
  assert.ok(pairs.length >= 1, 'الوزارة المكرّرة تظهر');
  assert.equal(pairs[0].kind, 'contained', 'الأقرب إلى تكرار حقيقي أولاً');
  const names = [pairs[0].a.name_ar, pairs[0].b.name_ar].sort();
  assert.deepEqual(names, ['وزارة الاقتصاد والتخطيط', 'وزارة الاقتصاد والتخطيط - الديوان العام'].sort());
});

// ── الدمج ───────────────────────────────────────────────────────────────────
test('من لا يملك الحذف لا يدمج — ولو ملك التعديل', async () => {
  await assert.rejects(
    () => C.mergeClients(ctx(bd), { keepId: ids.moe, mergeIds: [ids.moeDiwan] }),
    /صلاحي/, 'الدمج يخفي جهةً ويعيد نسبة مالها — أثره يفوق التعديل');
});

test('لا تُدمج الجهة في نفسها، ولا بلا هدف', async () => {
  await assert.rejects(() => C.mergeClients(ctx(admin), { keepId: ids.moe, mergeIds: [ids.moe] }), /نفسها/);
  await assert.rejects(() => C.mergeClients(ctx(admin), { keepId: ids.moe, mergeIds: [] }), /جهةً واحدة على الأقل/);
  await assert.rejects(() => C.mergeClients(ctx(admin), { keepId: 'c_ghost', mergeIds: [ids.moeDiwan] }), /غير موجود/);
});

test('الدمج ينقل كل عمل الجهة — الجداول السبعة بلا استثناء', async () => {
  const r = await C.mergeClients(ctx(admin), { keepId: ids.moe, mergeIds: [ids.moeDiwan] });
  assert.equal(r.merged.length, 1);
  // كل جدول يحمل الجهة يجب أن يكون قد تحرّك؛ إغفال واحد يعني عملاً يتيماً يشير إلى صفّ محذوف.
  for (const table of ['project', 'contract', 'invoice', 'crm_activity', 'contact']) {
    const left = await db.all(`SELECT id FROM ${table} WHERE client_id = ?`, [ids.moeDiwan]);
    assert.deepEqual(left, [], `${table}: بقي عمل على الجهة المدموجة`);
    const arrived = await db.all(`SELECT id FROM ${table} WHERE client_id = ?`, [ids.moe]);
    assert.ok(arrived.length >= 1, `${table}: لم يصل العمل إلى الجهة الباقية`);
  }
  // والفرصة التي كانت على الجهة الباقية لم تتحرّك
  const opp = await db.get('SELECT client_id FROM opportunity WHERE id = ?', ['o_sol']);
  assert.equal(opp.client_id, ids.moe);
});

test('الجهة المدموجة تختفي من القوائم وتشير إلى من ورثها — لا تُمحى', async () => {
  const row = await db.get('SELECT * FROM client WHERE id = ?', [ids.moeDiwan]);
  assert.ok(row, 'الصف باقٍ — الدمج ليس محواً');
  assert.equal(row.merged_into_client_id, ids.moe, 'يشير إلى الجهة الباقية');
  assert.ok(row.deleted_at, 'ومختوم بالحذف فيغيب عن القوائم');
  assert.equal(row.active, 0);
});

test('الدمج مُدقَّق على الطرفين — بالأسماء وبعدد ما انتقل', async () => {
  const gone = await db.get(
    "SELECT * FROM audit_log WHERE resource='client' AND resource_id=? AND action='delete' ORDER BY at DESC LIMIT 1",
    [ids.moeDiwan]);
  assert.ok(gone, 'اختفاء جهة حدثٌ يُسجَّل');
  const d = JSON.parse(gone.detail_json);
  assert.equal(d.merged_into, ids.moe);
  assert.equal(d.moved.invoice, 1, 'التدقيق يحمل ما انتقل فعلاً لا مجرد نيّة');

  const kept = await db.get(
    "SELECT * FROM audit_log WHERE resource='client' AND resource_id=? AND action='update' ORDER BY at DESC LIMIT 1",
    [ids.moe]);
  const k = JSON.parse(kept.detail_json);
  assert.equal(k.merged_from[0].name_ar, 'وزارة الاقتصاد والتخطيط - الديوان العام',
    'واسم الجهة المدموجة محفوظ نصاً — لأن صفّها قد يُقرأ لاحقاً بمعرّف لا يقول شيئاً');
});

test('الجهة المدموجة لا تظهر في قائمة التكرار المحتمل مرة أخرى', async () => {
  const pairs = await C.likelyDuplicateClients(admin);
  const stillPaired = pairs.some((p) => p.a.id === ids.moeDiwan || p.b.id === ids.moeDiwan);
  assert.equal(stillPaired, false, 'ما حُسم أمره لا يُعرَض للحسم ثانيةً');
});

test('لا تُدمج جهة مدموجة مرتين', async () => {
  await assert.rejects(
    () => C.mergeClients(ctx(admin), { keepId: ids.amanaRiyadh, mergeIds: [ids.moeDiwan] }),
    /غير موجود|مدموجة أصلاً/);
});

// ── فكّ الدمج ───────────────────────────────────────────────────────────────
test('فكّ الدمج يعيد الجهة ظاهرة — ولا يعد بما لا يستطيع', async () => {
  const back = await C.unmergeClient(ctx(admin), ids.moeDiwan);
  assert.equal(back.merged_into_client_id, null);
  assert.equal(back.deleted_at, null);
  assert.equal(back.active, 1);
  // العمل المنقول يبقى على الجهة الباقية: اختلط بعملها ولا سبيل لتمييزه — والتدقيق يقولها.
  const still = await db.get('SELECT client_id FROM invoice WHERE id = ?', ['i_con']);
  assert.equal(still.client_id, ids.moe, 'الفاتورة تبقى حيث نُقلت — لا استرجاع مُخترَع');
  const aud = await db.get(
    "SELECT detail_json FROM audit_log WHERE resource='client' AND resource_id=? ORDER BY at DESC LIMIT 1",
    [ids.moeDiwan]);
  assert.match(JSON.parse(aud.detail_json).note, /العمل المنقول يبقى/);
});

test('فكّ ما ليس مدموجاً خطأ واضح لا عملية صامتة', async () => {
  await assert.rejects(() => C.unmergeClient(ctx(admin), ids.amanaRiyadh), /غير مدموجة/);
});

// ── حارس القائمة ────────────────────────────────────────────────────────────
test('قائمة الجداول الحاملة للجهة مطابقة للمخطط — لا واحد منسيّ', async () => {
  const declared = new Set(C.CLIENT_OWNED_TABLES);
  const missing = [];
  for (const t of declared) {
    try { await db.all(`SELECT client_id FROM ${t} WHERE 1 = 0`); }
    catch (e) { missing.push(`${t} — ${e.message}`); }
  }
  assert.deepEqual(missing, [], `جدول معلَن لا يحمل الجهة:\n${missing.join('\n')}`);
  // والعكس: كل جدول في المخطط يحمل client_id يجب أن يكون معلَناً، وإلا بقي عملُه يتيماً.
  const { readFileSync } = await import('node:fs');
  const found = new Set();
  for (const f of ['migrations/001_init.sql', 'migrations/005_delivery2.sql']) {
    const sql = readFileSync(resolve(process.cwd(), f), 'utf8');
    const re = /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g;
    let m;
    while ((m = re.exec(sql))) if (/client_id\s+TEXT[^,]*REFERENCES client\(id\)/.test(m[2])) found.add(m[1]);
  }
  const forgotten = [...found].filter((t) => !declared.has(t));
  assert.deepEqual(forgotten, [],
    `جدول يحمل الجهة وغير معلَن في CLIENT_OWNED_TABLES — سيبقى عمله يتيماً بعد الدمج:\n${forgotten.join('، ')}`);
});
