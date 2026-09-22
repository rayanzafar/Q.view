#!/usr/bin/env node
// ── تصنيف المصروفات القديمة على بنود قائمة الدخل ─────────────────────────────────
//
// الترحيلة ٠٥٠ أضافت `expense.category` وتركته **فارغاً** على كل صفٍّ قديم عمداً: وضعُ «أخرى»
// على ما لم يقرأه أحدٌ تصنيفٌ مخترَع، ويُدخل رواتبَ وتعاقداً في سطر «مصاريف تشغيلية أخرى» فتكذب
// قائمة الدخل بسطرين لا بسطر. فالتصنيف الرجعي قرارٌ بشريّ: هذه الأداة تعرض ما هو مسجَّل فعلاً
// وتقترح خريطةً، والمالك يراجعها ويصحّحها، ثم تُطبَّق الخريطة **المعتمدة** صفاً صفاً بأثرٍ مدقَّق.
//
//   node scripts/backfill-expense-category.mjs --out proposal.json          ← معاينة (الافتراضي)
//   node scripts/backfill-expense-category.mjs --apply --map proposal.json --as <user_id>
//
// ── لماذا خطوتان ولا خطوة ─────────────────────────────────────────────────────────
// الكلمات المفتاحية أدناه تخمينٌ لا حكم: «اشتراك» قد يكون ترخيص برنامجٍ وقد يكون اشتراك موقف
// سيارات، و«مستشار» قد يكون أتعاب مستشارٍ خارجي وقد يكون سفر مستشارٍ موظف. فالأداة لا تكتب
// تخمينها أبداً: تكتبه في ملفٍ يقرؤه إنسان. و`--apply` بلا `--map` مرفوضة صراحةً.
// ولا تخمينَ في SQL: الاستعلام يقرأ ويجمع، والقرار كله في الخريطة المُمرَّرة.
//
// ── قواعد الاقتراح (كلمة في وصف المصروف ← بند) ───────────────────────────────────
//   راتب                          ← sal   (رواتب التشغيل)
//   مستشار | استشار               ← con   (أتعاب المستشارين)
//   تعاقد | مقاول | باطن          ← ctr   (مصاريف التعاقد)
//   ترخيص | رخصة | اشتراك         ← lic   (التراخيص)
//   إيجار                         ← rent  (الإيجار)
//   ما عدا ذلك                    ← oth   (مصاريف تشغيلية أخرى)
// الترتيب مقصود: أول قاعدة تنطبق هي التي تُقترح، فلا يتنازع وصفٌ واحد على بندين.
//
// ── ما لا تفعله الأداة عمداً ──────────────────────────────────────────────────────
//   • لا تمسّ صفاً له تصنيفٌ أصلاً (`category IS NOT NULL`) ولا صفاً محذوفاً ناعماً.
//   • لا تحذف ولا تغيّر مبلغاً ولا حالة — عمودٌ واحد فقط يُكتب.
//   • لا تُنشئ حساباً: الفاعل حسابٌ قائم يُمرَّر بـ`--as`، وإلا توقّفت برسالة صريحة.
//   • معاودة التشغيل آمنة: ما صُنِّف في الجولة الأولى يخرج من نطاق الثانية بحكم الشرط نفسه.

import { all, update as dbUpdate, tx, close } from '../src/core/db/index.js';
import { get } from '../src/core/db/index.js';
import { audit } from '../src/core/audit/index.js';
import { COST_KEYS, LINE_BY_KEY } from '../src/modules/finance/income-statement.js';
import { readFileSync, writeFileSync } from 'node:fs';

const RULES = [
  { key: 'sal', re: /راتب/ },
  { key: 'con', re: /مستشار|استشار/ },
  { key: 'ctr', re: /تعاقد|مقاول|باطن/ },
  { key: 'lic', re: /ترخيص|رخصة|اشتراك/ },
  { key: 'rent', re: /إيجار|ايجار/ },
];

export function proposeCategory(type) {
  const t = String(type ?? '');
  for (const r of RULES) if (r.re.test(t)) return { category: r.key, rule: r.re.source };
  return { category: 'oth', rule: 'لا كلمة مطابقة — يُقترح البند الأخير ويحتاج مراجعة' };
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    let val = m[2];
    if (val === undefined) {
      const next = argv[i + 1];
      val = (next && !next.startsWith('--')) ? (i++, next) : true;
    }
    o[m[1]] = val;
  }
  return o;
}

const sar = (halalas) => (Math.round(Number(halalas || 0)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── المعاينة: ما هو مسجَّل فعلاً، ثم ما تقترحه الأداة بجانبه ──────────────────────
export async function buildProposal() {
  const rows = await all(`SELECT e.type AS "type", COUNT(*) AS "count", SUM(e.amount_halalas) AS "total_halalas"
       FROM expense e
      WHERE e.deleted_at IS NULL AND e.category IS NULL
      GROUP BY e.type
      ORDER BY SUM(e.amount_halalas) DESC, COUNT(*) DESC`);
  const entries = rows.map((r) => {
    const p = proposeCategory(r.type);
    return {
      type: r.type ?? null,
      count: Number(r.count || 0),
      total_halalas: Number(r.total_halalas || 0),
      total_sar: Math.round(Number(r.total_halalas || 0)) / 100,
      category: p.category,
      category_ar: LINE_BY_KEY[p.category].ar,
      rule: p.rule,
    };
  });
  return {
    generated_at: new Date().toISOString(),
    lines: COST_KEYS.map((k) => ({ key: k, name_ar: LINE_BY_KEY[k].ar })),
    distinct_types: entries.length,
    rows_without_category: entries.reduce((a, e) => a + e.count, 0),
    total_halalas: entries.reduce((a, e) => a + e.total_halalas, 0),
    map: entries,
  };
}

function renderProposal(p, outPath) {
  const L = []; const w = (s = '') => L.push(s);
  w('تصنيف المصروفات القديمة — معاينة (لا يُكتب شيء)');
  w('═'.repeat(86));
  w(`صفوف بلا بند: ${p.rows_without_category} · أوصاف مختلفة: ${p.distinct_types} · مجموعها: ${sar(p.total_halalas)} ريال`);
  w();
  if (!p.map.length) { w('لا صفوف بلا بند — لا شيء ليُصنَّف.'); return L.join('\n'); }
  w('الوصف المسجَّل'.padEnd(34) + 'العدد'.padStart(7) + 'المجموع (ريال)'.padStart(20) + '   البند المقترح');
  w('─'.repeat(86));
  for (const e of p.map) {
    const t = String(e.type ?? 'بلا وصف مسجَّل');
    w(t.slice(0, 32).padEnd(34) + String(e.count).padStart(7) + sar(e.total_halalas).padStart(20) + '   ' + e.category_ar + ` (${e.category})`);
  }
  w();
  w('الاقتراح تخمينٌ من كلمات الوصف — راجعه وصحّح ما يلزم قبل التطبيق.');
  if (outPath) w(`كُتب الاقتراح في: ${outPath}`);
  w('التطبيق بعد المراجعة: --apply --map <الملف> --as <معرّف الحساب>');
  return L.join('\n');
}

// ── التطبيق: الخريطة المُراجَعة وحدها، صفاً صفاً، بأثرٍ مدقَّق ────────────────────
export async function applyMap({ map, actor, ip = '127.0.0.1' }) {
  const byType = new Map();
  for (const e of map) {
    if (!COST_KEYS.includes(e.category)) {
      throw new Error(`الخريطة: البند «${e.category}» ليس من البنود الستة (${COST_KEYS.join(', ')}) — الوصف «${e.type ?? ''}»`);
    }
    byType.set(e.type ?? null, e.category);
  }
  const rows = await all(`SELECT id, type, sector_id, project_id, amount_halalas
       FROM expense WHERE deleted_at IS NULL AND category IS NULL`);
  const ctx = { user: actor, ip };
  const applied = []; const skipped = [];
  for (const r of rows) {
    const key = r.type ?? null;
    if (!byType.has(key)) { skipped.push({ id: r.id, type: r.type }); continue; }
    const category = byType.get(key);
    await tx(async () => {
      await dbUpdate('expense', r.id, { category });
      await audit(ctx, {
        action: 'update', resource: 'expense', resourceId: r.id, sectorId: r.sector_id || null,
        detail: { field: 'category', from: null, to: category, type: r.type,
          reason: 'تصنيف رجعي بخريطةٍ معتمدة — backfill-expense-category.mjs' },
      });
    });
    applied.push({ id: r.id, type: r.type, category });
  }
  return { applied, skipped };
}

async function loadActor(who) {
  const row = await get(`SELECT * FROM app_user
     WHERE (id = ? OR lower(email) = lower(?)) AND deleted_at IS NULL AND active = 1`, [who, who]);
  if (!row) throw new Error(`لا حساب نشط بالمعرّف «${who}» — مرّر حساب مدير النظام بـ--as`);
  return row;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const apply = o.apply === true || o.apply === 'true';
  if (!apply) {
    const p = await buildProposal();
    const out = typeof o.out === 'string' ? o.out : null;
    if (out) writeFileSync(out, JSON.stringify(p, null, 2) + '\n', 'utf8');
    console.log(renderProposal(p, out));
    return;
  }
  if (typeof o.map !== 'string') {
    console.error('التطبيق يحتاج خريطةً مُراجَعة: --apply --map <ملف الاقتراح بعد مراجعته> --as <معرّف الحساب>');
    process.exit(2);
  }
  if (typeof o.as !== 'string') {
    console.error('التطبيق يحتاج حساب الفاعل: --as <معرّف الحساب أو بريده> — كل كتابة تُنسب إلى إنسان');
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(o.map, 'utf8'));
  const map = Array.isArray(raw) ? raw : raw.map;
  if (!Array.isArray(map) || !map.length) throw new Error('الملف: لا خريطة فيه — يُنتظر مصفوفة «map» غير فارغة');
  const { initRbac } = await import('../src/core/rbac/index.js');
  await initRbac();
  const actor = await loadActor(o.as);
  const res = await applyMap({ map, actor });
  console.log(`تصنيف المصروفات القديمة — تنفيذ بحساب ${actor.name_ar || actor.username}`);
  console.log('═'.repeat(86));
  console.log(`صُنِّف: ${res.applied.length} صفاً · بقي بلا بند: ${res.skipped.length} (وصفه غير مذكور في الخريطة)`);
  for (const s of res.skipped.slice(0, 20)) console.log(`   • ${s.id} — ${s.type ?? 'بلا وصف مسجَّل'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => close?.())
    .catch(async (e) => { console.error('تعذّر إتمام العملية:', e.message); await close?.(); process.exit(1); });
}
