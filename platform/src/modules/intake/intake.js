// Project intake — create a project either MANUALLY or auto-filled FROM a contract's text.
// AI extraction is best-effort (provider-agnostic); a deterministic heuristic covers no-key/failure
// so the feature always works. No external call ever receives more than the pasted contract text.
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { forbidden, badRequest, notFound } from '../../core/http/errors.js';
import { complete, aiMode } from '../../core/ai/provider.js';
import { ensureOpportunityForProject, projectIsUntouched } from '../crm/opp-project-sync.js';
import { createItem } from '../pmo/governance.js';

const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const cleanDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s.trim())) ? s.trim().slice(0, 10) : null;

function normalize(p) {
  return {
    title_ar: (p.title_ar || '').toString().trim().slice(0, 200) || null,
    client_name: (p.client_name || '').toString().trim().slice(0, 160) || null,
    value_sar: num(p.value_sar),
    start_date: cleanDate(p.start_date),
    end_date: cleanDate(p.end_date),
    deliverables: Array.isArray(p.deliverables)
      ? p.deliverables.filter((d) => d && d.name_ar).slice(0, 60)
        .map((d) => ({ name_ar: String(d.name_ar).trim().slice(0, 200), amount_sar: num(d.amount_sar) }))
      : [],
  };
}

// Deterministic fallback: largest SAR-looking figure = value; first ISO/dd-mm date; first heading line = title.
function heuristic(text) {
  const amounts = [...text.matchAll(/(\d[\d,\.]{3,})\s*(?:ريال|ر\.?س|SAR)?/g)]
    .map((m) => Number(m[1].replace(/[,\.]/g, ''))).filter((n) => n >= 1000);
  const value = amounts.length ? Math.max(...amounts) : null;
  const iso = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  const start_date = iso ? `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}` : null;
  const firstLine = (text.split('\n').map((l) => l.trim()).find((l) => l.length > 8 && l.length < 160)) || null;
  const clientM = text.match(/(?:العميل|الجهة|الطرف الأول|لصالح|المستفيد)\s*[:：]?\s*([^\n،.]{3,80})/);
  return { title_ar: firstLine, client_name: clientM ? clientM[1].trim() : null, value_sar: value, start_date, end_date: null, deliverables: [] };
}

const SYS = `أنت محلّل عقود خبير في شركة استشارية سعودية. استخرج من نص العقد الحقول التالية وأعِدها JSON فقط دون أي شرح أو أسوار كود:
{"title_ar":"موضوع/اسم المشروع","client_name":"اسم الجهة/العميل","value_sar":<القيمة الإجمالية بالريال رقمًا بلا فواصل أو null>,"start_date":"YYYY-MM-DD أو null","end_date":"YYYY-MM-DD أو null","deliverables":[{"name_ar":"اسم المخرج","amount_sar":<رقم أو null>}]}
القواعد: أرقام لا نصوص؛ استخدم null لأي حقل غائب؛ لا تخترع قيمًا؛ أعِد JSON صحيحًا فقط.`;

export async function parseContract(user, { text }) {
  if (!can(user, 'create', 'project')) throw forbidden('إنشاء المشاريع يتطلب صلاحية إدارة/تشغيل');
  if (!text || text.trim().length < 20) throw badRequest('ألصق نص العقد (٢٠ حرفًا على الأقل)');
  const clipped = text.slice(0, 12000);
  try {
    if (aiMode() === 'local') throw new Error('no_llm');
    const { text: out } = await complete({ system: SYS, user: clipped, maxTokens: 900 });
    const s = out.indexOf('{'), e = out.lastIndexOf('}');
    if (s < 0 || e < 0) throw new Error('no_json');
    const parsed = JSON.parse(out.slice(s, e + 1));
    return { ...normalize(parsed), _mode: aiMode() };
  } catch (err) {
    return { ...normalize(heuristic(text)), _mode: 'local', _note: 'استُخرج محليًا (بلا نموذج ذكي أو تعذّر التحليل) — يُرجى مراجعة الحقول قبل الإنشاء.' };
  }
}

// ── مخرجات مشروعٍ قائم: تُلصَق كما هي مكتوبة ويستخرجها الذكاء ────────────────
// «وأرفق مثلاً المخرجات وخلّي الذكاء يسوّيها ويستخرج المعلومات زي ما هو مكتوب» — المالك.
//
// الاستخراج كان محبوساً في نافذة «مشروع جديد» وحدها: من عنده جدول مخرجاتٍ لمشروعٍ قائم — وهو
// الحال الغالب، لأن المخرجات تصل بعد التوقيع لا معه — لا سبيل أمامه إلا كتابتها صفّاً صفّاً.
//
// وهذا المسار **يقرأ ولا يكتب**: يعيد ما فهمه للمراجعة، والكتابة نداءٌ ثانٍ بعد موافقة المستخدم.
// الفصل مقصود — استخراجُ نموذجٍ لغوي تخمينٌ مهما بلغ، وكتابةُ تخمينٍ بلا مراجعة تملأ سجلّ
// المخرجات بأسطر لم يقرأها أحد ثم تُبنى عليها نسبةُ إنجازٍ يقرأها المالك على أنها حقيقة.
const DLV_SYS = `أنت محلّل عقود خبير في شركة استشارية سعودية. أمامك نصّ يصف مخرجات مشروع (جدول أو قائمة أو فقرات).
استخرج المخرجات وأعِدها JSON فقط دون أي شرح أو أسوار كود:
{"deliverables":[{"name_ar":"اسم المخرج كما هو مكتوب","amount_sar":<رقم أو null>,"period":"YYYY-MM أو null"}]}
القواعد: انقل الاسم كما ورد ولا تُعِد صياغته؛ أرقام لا نصوص؛ استخدم null لأي حقل غائب؛ لا تخترع مخرجات ولا مبالغ؛ أعِد JSON صحيحًا فقط.`;

const PERIOD_RE = /\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/;
const cleanPeriod = (s) => {
  const m = PERIOD_RE.exec(String(s ?? ''));
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : null;
};
export const DELIVERABLES_MAX = 60;

function normalizeDeliverables(list) {
  return (Array.isArray(list) ? list : []).filter((d) => d && d.name_ar)
    .map((d) => ({ name_ar: String(d.name_ar).trim().slice(0, 200), amount_sar: num(d.amount_sar), period: cleanPeriod(d.period) }))
    .filter((d) => d.name_ar)
    .slice(0, DELIVERABLES_MAX);
}

// الاحتياط الحتمي: سطرٌ لكل مخرَج. يُقرأ آخر رقمٍ في السطر مبلغاً — وهو موضعه في كل جدول
// مخرجاتٍ رأيناه — ويُنظَّف السطر من ترقيمه وشرطاته وبقايا الجدول. ولو خلا السطر من اسمٍ سقط.
function deliverableHeuristic(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    let line = raw.replace(/[|\t]/g, ' ').trim();
    if (line.length < 3) continue;
    // الشهر يُقتطع من السطر أولاً: رقمه جزءٌ من تاريخ لا مبلغاً، وتركُه يجعل «٢٠٢٦-٠٣» آخر
    // رقمٍ في السطر — فيُقرأ ٣ مبلغاً أو يحجب المبلغ الحقيقي الذي قبله. وهذا ما كان يقع فعلاً.
    const period = cleanPeriod(line);
    const pm = PERIOD_RE.exec(line);
    if (pm) line = `${line.slice(0, pm.index)} ${line.slice(pm.index + pm[0].length)}`.trim();
    const nums = [...line.matchAll(/\d[\d,.]*/g)];
    const last = nums.length ? nums[nums.length - 1] : null;
    const val = last ? Number(last[0].replace(/[,.]/g, '')) : NaN;
    const amount = Number.isFinite(val) && val >= 100 ? val : null;
    let name = amount != null ? line.slice(0, last.index) : line;
    name = name.replace(/^[\s\-–—•*.\d)(]+/, '').replace(/[\s\-–—:|]+$/, '').trim();
    if (name.length < 3) continue;
    out.push({ name_ar: name.slice(0, 200), amount_sar: amount, period });
    if (out.length >= DELIVERABLES_MAX) break;
  }
  return out;
}

export async function parseDeliverables(user, projectId, { text }) {
  // الحارس صلاحية **تعديل هذا المشروع بعينه** لا صلاحية عامة: النصّ يُقرأ لمشروعٍ مقصود،
  // ومن لا يملك الكتابة فيه لا شأن له باستخراجٍ لأجله.
  const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'update', 'project', { ...p, project_id: p.id })) throw forbidden('إضافة المخرجات تتطلب صلاحية إدارة المشروع');
  if (!text || text.trim().length < 10) throw badRequest('ألصق نصّ المخرجات (١٠ أحرف على الأقل)');
  const clipped = text.slice(0, 12000);
  try {
    if (aiMode() === 'local') throw new Error('no_llm');
    const { text: out } = await complete({ system: DLV_SYS, user: clipped, maxTokens: 1200 });
    const s = out.indexOf('{'), e = out.lastIndexOf('}');
    if (s < 0 || e < 0) throw new Error('no_json');
    const items = normalizeDeliverables(JSON.parse(out.slice(s, e + 1)).deliverables);
    if (!items.length) throw new Error('empty');
    return { deliverables: items, _mode: aiMode() };
  } catch {
    return { deliverables: normalizeDeliverables(deliverableHeuristic(clipped)), _mode: 'local',
      _note: 'استُخرجت محليًا (بلا نموذج ذكي أو تعذّر التحليل) — راجِع الأسماء والمبالغ قبل الإضافة.' };
  }
}

// الكتابة تمرّ بخدمة الحوكمة سطراً سطراً لا بإدراجٍ مباشر: هناك حارسُ الصلاحية على الصفّ،
// وتدقيقُ المبلغ والشهر، وموائمةُ سطر الإيراد مع كل مخرَج. وإدراجٌ مباشر هنا كان سيتخطّاها كلها.
export async function addDeliverables(ctx, projectId, items) {
  const list = normalizeDeliverables(items);
  if (!list.length) throw badRequest('لا مخرجات لإضافتها — راجِع القائمة قبل الحفظ');
  const created = [];
  await tx(async () => {
    for (const d of list) {
      created.push(await createItem(ctx, projectId, 'deliverable',
        { name_ar: d.name_ar, ...(d.amount_sar == null ? {} : { amount_sar: d.amount_sar }), ...(d.period ? { period: d.period } : {}) }));
    }
  });
  return { project_id: projectId, added: created.length, deliverables: created };
}

// Create project + contract + deliverables (+ find-or-create client) in one transaction.
// Used by BOTH the manual form (no deliverables) and the from-contract flow.
// Coerce client-supplied money to a valid, in-range SAR integer so we never write NaN/float/negatives
// into the INTEGER-halalas columns. Out-of-range or non-numeric → 0 (fails safe).
const safeSar = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 1e13 ? n : 0; };

export async function createFromIntake(ctx, data) {
  const user = ctx.user;
  // الفرصة المصدر (اختيارية): الفرصة الفائزة «تتحول إلى مشروع». الربط هنا **مرجع لا نسخة**:
  // نكتب `source_opp_id` ونرث معرّف العميل نفسه — ولا ننقل قيمة الفرصة إلى قيمة العقد أبداً.
  // قيمة الفرصة هي ما عُرِض، وقيمة العقد هي ما وُقِّع؛ نسخ الأولى فوق الثانية يخلق رقماً ثالثاً
  // لا مصدر له ويُحتسب مرتين في المبيعات وفي المحفظة. لذلك القيمة تُدخَل من النموذج وحده.
  const srcOppId = (data.source_opp_id || '').toString().trim() || null;
  let srcOpp = null;
  if (srcOppId) {
    srcOpp = await get('SELECT id, title_ar, client_id, sector_id FROM opportunity WHERE id = ? AND deleted_at IS NULL', [srcOppId]);
    if (!srcOpp) throw badRequest('الفرصة المصدر غير موجودة');
    if (!can(user, 'read', 'opportunity', srcOpp)) throw forbidden('هذه الفرصة خارج نطاقك');
  }
  const sectorId = data.sector_id || srcOpp?.sector_id || user.sector_id;
  if (!can(user, 'create', 'project', { sector_id: sectorId })) throw forbidden('خارج نطاق قطاعك');
  const name = (data.name_ar || data.title_ar || '').trim().slice(0, 200);
  if (!name) throw badRequest('اسم المشروع مطلوب');
  const valueSar = safeSar(data.value_sar);
  const now = nowIso();
  const result = await tx(async () => {
    // فحص التكرار داخل المعاملة لا خارجها: فرصة واحدة تُنتج مشروعاً واحداً، وفحصٌ خارج المعاملة
    // يسمح لطلبين متزامنين بالمرور معاً فيصير للفرصة مشروعان — ومنه يبدأ ازدواج القيمة.
    // ── بذرةُ الفوز تُكمَّل، ولا يُنشأ مشروعٌ ثانٍ فوقها ──────────────────────
    // «أي فرصة توصل مكسوبة في الفرص على طول تنعكس بقيمتها وكل شيء مشروعاً — **بس أدخل عليه أحطّ
    //  بقية المعلومات كأنه مشروع جديد**». والفوز صار يُولّد المشروع بنفسه، فهذا النموذج لم يعد
    // بابَ إنشاءٍ بل بابَ **إكمال**: القيمة الموقَّعة والتواريخ والعقد والمخرجات.
    // ولو بقي يرفض لوجود مشروع، لصار كل فوزٍ يغلق على نفسه هذا الباب — ولا سبيل إلى تسجيل عقده.
    //
    // والحدّ يبقى قائماً حيث يلزم: مشروعٌ **فيه عمل** (عقد أو مخرَج أو مهمة أو تسكين أو فاتورة)
    // لا يُكتب فوقه — تلك محاولةُ إنشاء مشروعٍ ثانٍ للفرصة، ومنها يبدأ ازدواج القيمة.
    let seed = null;
    if (srcOppId) {
      const linked = await get('SELECT * FROM project WHERE source_opp_id = ? AND deleted_at IS NULL', [srcOppId]);
      if (linked) {
        if (!await projectIsUntouched(linked.id)) {
          throw badRequest(`لهذه الفرصة مشروع بالفعل: «${linked.name_ar}» — افتحه بدل إنشاء مشروع ثانٍ`);
        }
        seed = linked;
      }
    }
    let clientId = data.client_id || null;
    const clientName = (data.client_name || '').trim();
    if (!clientId && clientName) {
      const existing = await get('SELECT id FROM client WHERE name_ar = ? AND deleted_at IS NULL', [clientName]);
      if (existing) clientId = existing.id;
      else { clientId = id('cli'); await insert('client', { id: clientId, name_ar: clientName, active: 1, created_at: now, created_by: user.id }); }
    }
    // عميل الفرصة يُورَث بمعرّفه نفسه — لا يُنشأ عميل ثانٍ بالاسم نفسه فتنقسم أرقامه بين سجلّين.
    if (!clientId && srcOpp?.client_id) clientId = srcOpp.client_id;
    if (!clientId && seed?.client_id) clientId = seed.client_id;
    const pid = seed ? seed.id : id('prj');
    const row = {
      name_ar: name, sector_id: sectorId, client_id: clientId, owner_user_id: data.owner_user_id || seed?.owner_user_id || user.id,
      status: data.status || 'NOT_STARTED', rag: seed?.rag || 'GREEN', kind: 'external', source_opp_id: srcOppId,
      contract_value_halalas: toHalalas(valueSar), start_date: cleanDate(data.start_date), end_date: cleanDate(data.end_date),
    };
    if (seed) await update('project', pid, { ...row, updated_at: now, updated_by: user.id });
    else await insert('project', { id: pid, ...row, created_at: now, created_by: user.id });
    const cid = id('con');
    await insert('contract', {
      id: cid, code: (data.contract_code || '').toString().slice(0, 60) || null, client_id: clientId, project_id: pid, sector_id: sectorId,
      value_halalas: toHalalas(valueSar), start_date: cleanDate(data.start_date), end_date: cleanDate(data.end_date),
      status: 'ACTIVE', created_at: now, created_by: user.id,
    });
    let n = 0;
    for (const d of (data.deliverables || [])) {
      const nm = (d && d.name_ar || '').toString().trim().slice(0, 200); if (!nm) continue;
      await insert('deliverable', { id: id('dlv'), project_id: pid, name_ar: nm, amount_halalas: toHalalas(safeSar(d.amount_sar)),
        month: d.month || null, status: 'DRAFT', sector_id: sectorId, created_at: now });
      n++;
    }
    // «لازم تتأكد أي مشروع مضاف في المشاريع ينضاف مكسوباً» — وهذا الباب هو الذي تدخل منه أغلب
    // المشاريع (النموذج اليدوي، والتعبئة من نص العقد). المشروعُ المولود من فرصة له فرصته أصلاً،
    // فالمرآة لا تُنشئ ثانية: الحارس داخلها يقرأ `source_opp_id` ويعود بالموجود.
    const mirror = await ensureOpportunityForProject(ctx, await get('SELECT * FROM project WHERE id = ?', [pid]));
    return { project_id: pid, contract_id: cid, client_id: clientId, deliverables: n,
      source_opp_id: srcOppId || mirror.opportunity_id, opportunity_created: !!mirror.created };
  });
  await audit(ctx, { action: 'create', resource: 'project', resourceId: result.project_id, sectorId,
    detail: { via: srcOppId ? 'from-opportunity' : (data.deliverables?.length ? 'contract-intake' : 'manual'),
      deliverables: result.deliverables, contract: result.contract_id, source_opp_id: result.source_opp_id,
      ...(result.opportunity_created ? { opportunity_created: result.source_opp_id } : {}) } });
  return result;
}
